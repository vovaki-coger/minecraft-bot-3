const mineflayer = require("mineflayer");
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder");
const { SocksProxyAgent } = require("socks-proxy-agent");
const { HttpProxyAgent } = require("http-proxy-agent");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { v4: uuidv4 } = require("uuid");
const log = require("electron-log");
const { SurvivorAI } = require("./survivor-ai");
const { CaptchaHandler } = require("./captcha-handler");
const { TaskManager, parseCommand } = require("./bot-tasks");

class BotInstance {
  constructor(config, emit) {
    this.id = config.id || uuidv4();
    this.config = { ...config };
    this.bot = null;
    this.emit = emit;
    this.status = "offline";
    this.aiEnabled = config.aiEnabled !== false;
    this.chatHistory = [];
    this.survivorAI = null;
    this.captchaHandler = null;
    this.taskManager = null;
    this.reconnectTimer = null;
    this._lastAIResponse = 0; // throttle AI responses
    this.stats = {
      health: 20, food: 20, armor: 0, experience: 0,
      x: 0, y: 0, z: 0, biome: "unknown",
      inventory: [], hotbarSlot: 0,
    };
  }

  getPublicState() {
    return {
      id: this.id,
      config: {
        nick: this.config.nick,
        host: this.config.host,
        port: this.config.port,
        version: this.config.version,
        aiEnabled: this.aiEnabled,
        aiModel: this.config.aiModel,
        aiMode: this.config.aiMode,
        systemPrompt: this.config.systemPrompt,
        proxy: this.config.proxy,
        autoLogin: this.config.autoLogin,
        autoRegister: this.config.autoRegister,
        autoResponse: this.config.autoResponse,
      },
      status: this.status,
      stats: this.stats,
      chatHistory: this.chatHistory.slice(-100),
      survivorMode: this.survivorAI?.isRunning || false,
    };
  }
}

class BotManager {
  constructor(configManager, ollamaManager, emit) {
    this.configManager = configManager;
    this.ollamaManager = ollamaManager;
    this.emit = emit;
    this.bots = new Map();

    for (const cfg of configManager.getBotConfigs()) {
      const instance = new BotInstance(cfg, emit);
      this.bots.set(instance.id, instance);
    }
  }

  createBot(config) {
    const fullConfig = { ...this.configManager.createDefaultBotConfig(), ...config };
    fullConfig.id = fullConfig.id || uuidv4();
    fullConfig.port = parseInt(fullConfig.port) || 25565;

    const instance = new BotInstance(fullConfig, this.emit);
    this.bots.set(instance.id, instance);
    this.configManager.saveBotConfig(fullConfig);
    this.emit("bot:created", instance.getPublicState());
    return instance.getPublicState();
  }

  async connectBot(botId) {
    const instance = this.bots.get(botId);
    if (!instance) throw new Error("Bot not found: " + botId);
    if (instance.bot) await this.disconnectBot(botId);

    instance.status = "connecting";
    this.emit("bot:statusChanged", { botId, status: "connecting" });

    try {
      const opts = this._buildOptions(instance.config);
      instance.bot = mineflayer.createBot(opts);
      this._attachEvents(instance);
      return { success: true };
    } catch (err) {
      instance.status = "offline";
      this.emit("bot:statusChanged", { botId, status: "offline", error: err.message });
      throw err;
    }
  }

  _buildOptions(config) {
    const opts = {
      host: config.host,
      port: parseInt(config.port) || 25565,
      username: config.nick,
      version: config.version || "1.20.1",
      auth: config.authType === "microsoft" ? "microsoft" : "offline",
      hideErrors: false,
      checkTimeoutInterval: 60000,
    };
    const proxy = config.proxy || this.configManager.get("globalProxy", "");
    if (proxy) opts.agent = this._proxyAgent(proxy);
    return opts;
  }

  _proxyAgent(proxyStr) {
    try {
      let url = proxyStr;
      if (!url.includes("://")) url = "socks5://" + url;
      if (url.startsWith("socks4://") || url.startsWith("socks5://")) return new SocksProxyAgent(url);
      if (url.startsWith("https://")) return new HttpsProxyAgent(url);
      return new HttpProxyAgent(url);
    } catch (err) {
      log.error("Proxy agent error:", err.message);
      return null;
    }
  }

  _attachEvents(instance) {
    const { bot } = instance;
    const botId = instance.id;

    // === Загружаем pathfinder ===
    bot.loadPlugin(pathfinder);

    bot.once("spawn", () => {
      instance.status = "online";
      instance.captchaHandler = new CaptchaHandler(instance, this.ollamaManager);
      instance.taskManager = new TaskManager(instance, this.emit);

      // Настраиваем движение
      const movements = new Movements(bot);
      movements.allowSprinting = true;
      movements.canDig = true;
      movements.allow1by1towers = true;
      bot.pathfinder.setMovements(movements);

      this.emit("bot:statusChanged", { botId, status: "online" });
      this._addChat(instance, "system", "Бот подключился к серверу");
    });

    bot.on("health", () => {
      instance.stats.health = bot.health;
      instance.stats.food = bot.food;
      this.emit("bot:statsUpdated", { botId, stats: instance.stats });
    });

    bot.on("physicsTick", () => {
      if (bot.entity) {
        instance.stats.x = Math.round(bot.entity.position.x);
        instance.stats.y = Math.round(bot.entity.position.y);
        instance.stats.z = Math.round(bot.entity.position.z);
      }
    });

    bot.on("experience", () => {
      instance.stats.experience = bot.experience.level;
      this.emit("bot:statsUpdated", { botId, stats: instance.stats });
    });

    bot.on("chat", async (username, message) => {
      if (username === bot.username) return;

      this._addChat(instance, "player", "[" + username + "]: " + message);
      this.emit("bot:chat", { botId, username, message, type: "player" });

      // Авто-логин
      await this._handleAutoLogin(instance, message);
      // Капча
      await instance.captchaHandler?.handleChatCaptcha(message);

      // Обработка команды / ответ ИИ
      if (instance.config.autoResponse && instance.aiEnabled) {
        await this._handlePlayerMessage(instance, username, message);
      }
    });

    bot.on("message", (jsonMsg) => {
      const text = jsonMsg.toString();
      this._addChat(instance, "server", text);
      this.emit("bot:serverMessage", { botId, text });
    });

    bot.on("death", () => {
      this._addChat(instance, "system", "Бот умер");
      this.emit("bot:death", { botId });
      instance.survivorAI?.onDeath();
    });

    bot.on("kicked", (reason) => {
      instance.status = "offline";
      this._addChat(instance, "system", "Кик: " + reason);
      this.emit("bot:statusChanged", { botId, status: "offline", reason });
      this._scheduleReconnect(instance);
    });

    bot.on("end", (reason) => {
      instance.status = "offline";
      this.emit("bot:statusChanged", { botId, status: "offline", reason });
      this._scheduleReconnect(instance);
    });

    bot.on("error", (err) => {
      log.error("Bot " + botId + " error:", err.message);
      this.emit("bot:error", { botId, error: err.message });
    });
  }

  // ===================================================================
  // ГЛАВНЫЙ ОБРАБОТЧИК СООБЩЕНИЙ ОТ ИГРОКОВ
  // ===================================================================
  async _handlePlayerMessage(instance, username, message) {
    if (!instance.bot?.entity) return;

    // 1. Сначала пробуем распознать команду скриптово (без AI)
    const cmd = parseCommand(message, instance.config.nick);
    if (cmd) {
      log.info("Scripted task:", cmd.task, JSON.stringify(cmd));
      if (cmd.task === "come_to" || cmd.task === "follow") {
        cmd.player = username; // всегда идём к тому кто написал
      }
      instance.taskManager?.runTask(cmd.task, cmd).catch(e => log.error("Task run error:", e.message));
      return;
    }

    // 2. Если команду не распознали — проверяем throttle (не чаще раза в 3 сек)
    const now = Date.now();
    if (now - instance._lastAIResponse < 3000) return;
    instance._lastAIResponse = now;

    // 3. Отвечаем через AI
    await this._aiRespond(instance, username, message);
  }

  async _aiRespond(instance, username, message) {
    if (!instance.aiEnabled || !instance.bot) return;
    try {
      const ctx = this._buildContext(instance);
      const response = await this.ollamaManager.chat({
        model: instance.config.aiModel || "llama3",
        mode: instance.config.aiMode || "local",
        apiKey: instance.config.apiKey,
        apiProvider: instance.config.apiProvider,
        systemPrompt: instance.config.systemPrompt,
        messages: [{
          role: "user",
          content:
            ctx + "\n\nИгрок " + username + " написал: \"" + message + "\"\n\n" +
            "Ответь по-русски. Если нужно выполнить физическое действие — верни JSON:\n" +
            "{\"action\":\"walk_to\",\"x\":0,\"y\":64,\"z\":0} или\n" +
            "{\"action\":\"follow\",\"target\":\"" + username + "\"} или\n" +
            "{\"action\":\"chat\",\"message\":\"текст\"}\n" +
            "Если просто разговор — напиши текст (до 100 символов).",
        }],
      });

      if (!response?.content) return;
      const text = response.content.trim();

      // Парсим JSON если AI решил выполнить действие
      const jsonMatch = text.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        try {
          const cmd = JSON.parse(jsonMatch[0]);
          if (cmd.action === "walk_to" && cmd.x !== undefined) {
            await instance.taskManager?.runTask("walk_to", { x: cmd.x, y: cmd.y, z: cmd.z });
          } else if (cmd.action === "follow") {
            await instance.taskManager?.runTask("follow", { player: cmd.target || username });
          } else if (cmd.action === "chat" && cmd.message) {
            const msg = String(cmd.message).slice(0, 100);
            instance.bot.chat(msg);
            this._addChat(instance, "bot", msg);
            this.emit("bot:chat", { botId: instance.id, username: instance.config.nick, message: msg, type: "bot" });
          }
          return;
        } catch {}
      }

      // Обычный текстовый ответ
      const reply = text.replace(/\{[\s\S]*?\}/g, "").trim().slice(0, 100);
      if (reply) {
        instance.bot.chat(reply);
        this._addChat(instance, "bot", reply);
        this.emit("bot:chat", { botId: instance.id, username: instance.config.nick, message: reply, type: "bot" });
      }
    } catch (err) {
      log.error("AI respond error:", err.message);
    }
  }

  async _handleAutoLogin(instance, message) {
    const pass = this.configManager.getGlobalPassword();
    if (!pass) return;
    const m = message.toLowerCase();
    if (instance.config.autoRegister && (m.includes("/register") || m.includes("зарегистрируй") || m.includes("registration"))) {
      setTimeout(() => {
        instance.bot?.chat("/register " + pass + " " + pass);
        this._addChat(instance, "system", "Авто-регистрация выполнена");
      }, 1500);
    } else if (instance.config.autoLogin && (m.includes("/login") || m.includes("войди") || m.includes("авториз"))) {
      setTimeout(() => {
        instance.bot?.chat("/login " + pass);
        this._addChat(instance, "system", "Авто-логин выполнен");
      }, 1500);
    }
  }

  _buildContext(instance) {
    const s = instance.stats;
    const inv = instance.bot?.inventory.items().slice(0, 8)
      .map(i => (i.name + "x" + i.count)).join(", ") || "пусто";
    return "HP=" + s.health + "/20 Еда=" + s.food + "/20 XP=" + s.experience +
      " Позиция: X=" + s.x + " Y=" + s.y + " Z=" + s.z +
      " Инвентарь: [" + inv + "]";
  }

  _addChat(instance, type, text) {
    instance.chatHistory.push({ type, text, timestamp: Date.now() });
    if (instance.chatHistory.length > 500) instance.chatHistory.shift();
  }

  _scheduleReconnect(instance) {
    if (!instance.config.autoReconnect) return;
    if (instance.reconnectTimer) clearTimeout(instance.reconnectTimer);
    instance.reconnectTimer = setTimeout(() => {
      log.info("Auto-reconnecting", instance.id);
      this.connectBot(instance.id).catch(e => log.error("Reconnect failed:", e.message));
    }, instance.config.reconnectDelay || 5000);
  }

  async disconnectBot(botId) {
    const instance = this.bots.get(botId);
    if (!instance) return;
    if (instance.reconnectTimer) { clearTimeout(instance.reconnectTimer); instance.reconnectTimer = null; }
    instance.config.autoReconnect = false;
    if (instance.survivorAI?.isRunning) await instance.survivorAI.stop().catch(() => {});
    if (instance.taskManager) await instance.taskManager.stopAll().catch(() => {});
    if (instance.bot) { try { instance.bot.quit(); } catch {} instance.bot = null; }
    instance.status = "offline";
    this.emit("bot:statusChanged", { botId, status: "offline" });
  }

  deleteBot(botId) {
    this.disconnectBot(botId);
    this.bots.delete(botId);
    this.configManager.deleteBotConfig(botId);
    this.emit("bot:deleted", { botId });
    return { success: true };
  }

  sendChat(botId, message) {
    const instance = this.bots.get(botId);
    if (!instance) return;
    if (instance.bot && instance.status === "online") {
      instance.bot.chat(message);
      this._addChat(instance, "bot", message);
      this.emit("bot:chat", { botId, username: instance.config.nick, message, type: "bot" });
    } else {
      this._offlineAIChat(instance, message);
    }
  }

  async _offlineAIChat(instance, message) {
    this._addChat(instance, "user", message);
    this.emit("bot:chat", { botId: instance.id, username: "Вы", message, type: "user" });
    if (!instance.aiEnabled) return;
    try {
      const response = await this.ollamaManager.chat({
        model: instance.config.aiModel || "llama3",
        mode: instance.config.aiMode || "local",
        apiKey: instance.config.apiKey,
        apiProvider: instance.config.apiProvider,
        systemPrompt: instance.config.systemPrompt,
        messages: [{ role: "user", content: message }],
      });
      if (response?.content) {
        this._addChat(instance, "ai", response.content);
        this.emit("bot:aiMessage", { botId: instance.id, message: response.content });
      }
    } catch (err) {
      this._addChat(instance, "system", "Ошибка ИИ: " + err.message);
    }
  }

  stopAction(botId) {
    const instance = this.bots.get(botId);
    if (!instance) return;
    instance.taskManager?.stopAll();
    instance.survivorAI?.stop();
    this._addChat(instance, "system", "Действие остановлено");
    this.emit("bot:actionStopped", { botId });
  }

  stopMovement(botId) {
    const instance = this.bots.get(botId);
    if (!instance?.bot) return;
    try { instance.bot.pathfinder?.stop(); } catch {}
    try { instance.bot.clearControlStates(); } catch {}
    this._addChat(instance, "system", "Движение остановлено");
  }

  async startSurvivorMode(botId) {
    const instance = this.bots.get(botId);
    if (!instance?.bot) throw new Error("Бот не подключён");
    if (!instance.aiEnabled) throw new Error("ИИ отключён у этого бота");
    instance.survivorAI = new SurvivorAI(instance, this.ollamaManager, this.emit);
    await instance.survivorAI.start();
    this.emit("bot:survivorStarted", { botId });
    return { success: true };
  }

  async stopSurvivorMode(botId) {
    const instance = this.bots.get(botId);
    if (instance?.survivorAI) { await instance.survivorAI.stop().catch(() => {}); instance.survivorAI = null; }
    this.emit("bot:survivorStopped", { botId });
    return { success: true };
  }

  setNick(botId, nick) {
    const instance = this.bots.get(botId);
    if (!instance) throw new Error("Bot not found");
    instance.config.nick = nick;
    this.configManager.saveBotConfig(instance.config);
    this._addChat(instance, "system", "Ник изменён на " + nick);
    return { success: true };
  }

  toggleAI(botId, enabled) {
    const instance = this.bots.get(botId);
    if (!instance) throw new Error("Bot not found");
    instance.aiEnabled = enabled;
    instance.config.aiEnabled = enabled;
    this.configManager.saveBotConfig(instance.config);
    this.emit("bot:aiToggled", { botId, aiEnabled: enabled });
    return { success: true };
  }

  updateBotConfig(botId, config) {
    const instance = this.bots.get(botId);
    if (!instance) throw new Error("Bot not found");
    Object.assign(instance.config, config);
    this.configManager.saveBotConfig(instance.config);
    return instance.getPublicState();
  }

  async testProxy(proxyStr) {
    try {
      const agent = this._proxyAgent(proxyStr);
      const { default: fetch } = await import("node-fetch");
      const resp = await fetch("https://api.ipify.org?format=json", { agent, timeout: 10000 });
      const data = await resp.json();
      return { success: true, ip: data.ip };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  getAllBots() {
    return Array.from(this.bots.values()).map(b => b.getPublicState());
  }

  async disconnectAll() {
    for (const [botId] of this.bots) await this.disconnectBot(botId).catch(() => {});
  }
}

module.exports = { BotManager };
