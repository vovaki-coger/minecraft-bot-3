/**
 * BotManager v3 — с интеграцией AIBrain (ReAct-петля).
 *
 * Главное изменение: вместо простого вызова ollamaManager.chat()
 * теперь используется AIBrain — полноценный мозг бота с памятью,
 * наблюдением за миром и мультишаговым рассуждением.
 */

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
const { parseAndy4Response, executeAndy4Command, isAndy4Model, stripThinkBlocks } = require("./andy4-parser");
const { AgentLoop } = require("./agent-loop");
const { AIBrain } = require("./ai-brain");

const RUSSIAN_OVERRIDE = `ВАЖНО: Ты общаешься НА РУССКОМ ЯЗЫКЕ. Все твои ответы должны быть на русском. `;

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
    this.agentLoop = null;
    this.aiBrain = null;
    this.reconnectTimer = null;
    this._lastAIResponse = 0;
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

    bot.loadPlugin(pathfinder);

    bot.once("spawn", () => {
      instance.status = "online";
      instance.captchaHandler = new CaptchaHandler(instance, this.ollamaManager);
      instance.taskManager = new TaskManager(instance, this.emit);
      instance.agentLoop = new AgentLoop(instance, this.emit);

      // === ИНИЦИАЛИЗАЦИЯ AI BRAIN (v3) ===
      if (instance.aiEnabled) {
        // Авто-определение Andy-4: если модель не задана или "auto" — выбираем лучшую
        const configuredModel = instance.config.aiModel || "";
        const needsAutoDetect = !configuredModel || configuredModel === "auto";
        if (needsAutoDetect) {
          this.ollamaManager.getPreferredModel().then(preferred => {
            if (preferred) {
              instance.config.aiModel = preferred;
              log.info("[BotManager] Auto-selected model:", preferred);
              this.emit("bot:modelDetected", { botId, model: preferred });
            }
          }).catch(() => {});
        }

        instance.aiBrain = new AIBrain(
          instance,
          this.ollamaManager,
          instance.taskManager,
          this.emit
        );
        // Запускаем автономный режим: бот сам думает каждые 10 секунд
        instance.aiBrain.startAutonomous(10000);
        log.info("[BotManager] AIBrain started for bot", botId);
      }

      const movements = new Movements(bot);
      movements.allowSprinting = true;
      movements.canDig = true;
      movements.allow1by1towers = true;
      bot.pathfinder.setMovements(movements);

      this.emit("bot:statusChanged", { botId, status: "online" });
      this._addChat(instance, "system", "Бот подключился к серверу. ИИ-мозг активирован.");
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

      await this._handleAutoLogin(instance, message);
      await instance.captchaHandler?.handleChatCaptcha(message);

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
      instance.agentLoop?.stop();
      instance.agentLoop = null;
      instance.aiBrain?.stopAutonomous();
      this._addChat(instance, "system", "Кик: " + reason);
      this.emit("bot:statusChanged", { botId, status: "offline", reason });
      this._scheduleReconnect(instance);
    });

    bot.on("end", (reason) => {
      instance.status = "offline";
      instance.agentLoop?.stop();
      instance.agentLoop = null;
      instance.aiBrain?.stopAutonomous();
      this.emit("bot:statusChanged", { botId, status: "offline", reason });
      this._scheduleReconnect(instance);
    });

    bot.on("error", (err) => {
      log.error("Bot " + botId + " error:", err.message);
      this.emit("bot:error", { botId, error: err.message });
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // ОБРАБОТКА СООБЩЕНИЙ — через AIBrain (v3)
  // ══════════════════════════════════════════════════════════════════════

  async _handlePlayerMessage(instance, username, message) {
    if (!instance.bot?.entity) return;

    // 1. Сначала проверяем скриптовые команды (быстрые, без AI)
    const scriptCmd = parseCommand(message, instance.config.nick);
    if (scriptCmd) {
      log.info("[Script] Task:", scriptCmd.task);
      if (scriptCmd.task === "come_to" || scriptCmd.task === "follow") scriptCmd.player = username;
      instance.taskManager?.runTask(scriptCmd.task, scriptCmd).catch((e) =>
        log.error("Task error:", e.message)
      );
      return;
    }

    // 2. Throttle: не чаще раза в 3 сек
    const now = Date.now();
    if (now - instance._lastAIResponse < 3000) return;
    instance._lastAIResponse = now;

    // 3. Если AIBrain активен — используем его (ReAct-петля)
    if (instance.aiBrain && instance.aiEnabled) {
      log.info("[BotManager] Routing to AIBrain:", username, message);
      await instance.aiBrain.respondToPlayer(username, message);
      return;
    }

    // 4. Fallback — старый метод через andy4 / json
    await this._legacyAIRespond(instance, username, message);
  }

  // Старый метод — оставляем как запасной
  async _legacyAIRespond(instance, username, message) {
    if (!instance.aiEnabled || !instance.bot) return;

    const useAndy4 = isAndy4Model(instance.config.aiModel);
    const ctx = this._buildLegacyContext(instance);
    let sysPrompt = instance.config.systemPrompt || "";

    if (useAndy4) {
      sysPrompt = RUSSIAN_OVERRIDE +
        "Ты Minecraft-бот. Отвечай на русском.\n" + ctx;
    } else {
      sysPrompt = (sysPrompt || "") + "\n\nСостояние: " + ctx +
        "\nОтвечай по-русски. Для действий: {\"action\":\"chat\",\"message\":\"текст\"}";
    }

    try {
      const response = await this.ollamaManager.chat({
        model: instance.config.aiModel || "llama3",
        mode: instance.config.aiMode || "local",
        apiKey: instance.config.apiKey,
        apiProvider: instance.config.apiProvider,
        systemPrompt: sysPrompt,
        messages: [{ role: "user", content: username + ": " + message }],
      });

      if (!response?.content) return;
      const rawText = stripThinkBlocks(response.content.trim());

      if (useAndy4) {
        await this._handleAndy4Response(instance, rawText, username);
      } else {
        await this._handleJsonResponse(instance, rawText, username);
      }
    } catch (err) {
      log.error("Legacy AI respond error:", err.message);
    }
  }

  async _handleAndy4Response(instance, rawText, username) {
    const { chatText, commands } = parseAndy4Response(rawText);
    for (const cmd of commands) {
      const executed = await executeAndy4Command(cmd, instance, instance.taskManager);
      if (executed) log.info("[Andy4 exec]", cmd.name, cmd.args);
    }
    if (chatText && chatText.length > 0) {
      const enRu = { "Sure": "Хорошо", "Alright": "Ладно", "Got it": "Понял", "Done": "Готово" };
      let text = chatText;
      for (const [en, ru] of Object.entries(enRu)) text = text.replace(new RegExp(en, "gi"), ru);
      this._sendBotChat(instance, text.slice(0, 100));
    }
  }

  async _handleJsonResponse(instance, rawText, username) {
    const jsonMatch = rawText.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        const cmd = JSON.parse(jsonMatch[0]);
        if (cmd.action === "walk_to" && cmd.x !== undefined) {
          instance.taskManager?.runTask("walk_to", { x: cmd.x, y: cmd.y, z: cmd.z });
        } else if (cmd.action === "follow") {
          instance.taskManager?.runTask("follow", { player: cmd.target || username });
        } else if (cmd.action === "chat" && cmd.message) {
          this._sendBotChat(instance, String(cmd.message).slice(0, 100));
        } else if (cmd.action === "attack") {
          instance.taskManager?.runTask("attack", { target: cmd.target });
        }
        return;
      } catch {}
    }
    const reply = rawText.replace(/\{[\s\S]*?\}/g, "").trim().slice(0, 100);
    if (reply) this._sendBotChat(instance, reply);
  }

  _sendBotChat(instance, text) {
    if (!instance.bot || !text) return;
    instance.bot.chat(text);
    this._addChat(instance, "bot", text);
    this.emit("bot:chat", {
      botId: instance.id, username: instance.config.nick, message: text, type: "bot",
    });
  }

  async _handleAutoLogin(instance, message) {
    const pass = this.configManager.getGlobalPassword();
    if (!pass) return;
    const m = message.toLowerCase();
    if (instance.config.autoRegister && (m.includes("/register") || m.includes("registration"))) {
      setTimeout(() => {
        instance.bot?.chat("/register " + pass + " " + pass);
        this._addChat(instance, "system", "Авто-регистрация выполнена");
      }, 1500);
    } else if (instance.config.autoLogin && (m.includes("/login") || m.includes("please log in"))) {
      setTimeout(() => {
        instance.bot?.chat("/login " + pass);
        this._addChat(instance, "system", "Авто-логин выполнен");
      }, 1500);
    }
  }

  _buildLegacyContext(instance) {
    const s = instance.stats;
    const inv = instance.bot?.inventory.items().slice(0, 8)
      .map((i) => i.name + "x" + i.count).join(", ") || "пусто";
    return "HP=" + s.health + "/20 Еда=" + s.food + "/20 X=" + s.x + " Y=" + s.y + " Z=" + s.z + " Инв:[" + inv + "]";
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
      this.connectBot(instance.id).catch((e) => log.error("Reconnect failed:", e.message));
    }, instance.config.reconnectDelay || 5000);
  }

  async disconnectBot(botId) {
    const instance = this.bots.get(botId);
    if (!instance) return;
    if (instance.reconnectTimer) { clearTimeout(instance.reconnectTimer); instance.reconnectTimer = null; }
    instance.config.autoReconnect = false;
    instance.aiBrain?.stopAutonomous();
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
        systemPrompt: RUSSIAN_OVERRIDE + (instance.config.systemPrompt || "Ты умный помощник по Minecraft. Отвечай по-русски."),
        messages: [{ role: "user", content: message }],
      });
      if (response?.content) {
        const cleaned = stripThinkBlocks(response.content);
        this._addChat(instance, "ai", cleaned);
        this.emit("bot:aiMessage", { botId: instance.id, message: cleaned });
      }
    } catch (err) {
      this._addChat(instance, "system", "Ошибка ИИ: " + err.message);
    }
  }

  stopAction(botId) {
    const instance = this.bots.get(botId);
    if (!instance) return;
    instance.aiBrain?.stopAutonomous();
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
    // Останавливаем AIBrain чтобы не конфликтовал с SurvivorAI
    instance.aiBrain?.stopAutonomous();
    instance.survivorAI = new SurvivorAI(instance, this.ollamaManager, this.emit);
    await instance.survivorAI.start();
    this.emit("bot:survivorStarted", { botId });
    return { success: true };
  }

  async stopSurvivorMode(botId) {
    const instance = this.bots.get(botId);
    if (instance?.survivorAI) {
      await instance.survivorAI.stop().catch(() => {});
      instance.survivorAI = null;
    }
    // Возобновляем AIBrain
    if (instance?.aiBrain && instance?.aiEnabled) {
      instance.aiBrain.startAutonomous(10000);
    }
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
    if (enabled && instance.bot && instance.status === "online" && !instance.aiBrain) {
      instance.aiBrain = new AIBrain(instance, this.ollamaManager, instance.taskManager, this.emit);
      instance.aiBrain.startAutonomous(10000);
    } else if (!enabled && instance.aiBrain) {
      instance.aiBrain.stopAutonomous();
    }
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
    return Array.from(this.bots.values()).map((b) => b.getPublicState());
  }

  async disconnectAll() {
    for (const [botId] of this.bots) await this.disconnectBot(botId).catch(() => {});
  }
}

module.exports = { BotManager };
