const mineflayer = require("mineflayer");
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder");
const { SocksProxyAgent } = require("socks-proxy-agent");
const { HttpProxyAgent } = require("http-proxy-agent");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { v4: uuidv4 } = require("uuid");
const log = require("electron-log");
const { SurvivorAI } = require("./survivor-ai");
const { CaptchaHandler } = require("./captcha-handler");

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
    this.reconnectTimer = null;
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

    const savedBots = configManager.getBotConfigs();
    for (const cfg of savedBots) {
      const instance = new BotInstance(cfg, emit);
      this.bots.set(instance.id, instance);
    }
  }

  createBot(config) {
    const fullConfig = {
      ...this.configManager.createDefaultBotConfig(),
      ...config,
    };
    fullConfig.id = fullConfig.id || uuidv4();

    const instance = new BotInstance(fullConfig, this.emit);
    this.bots.set(instance.id, instance);
    this.configManager.saveBotConfig(fullConfig);

    this.emit("bot:created", instance.getPublicState());
    return instance.getPublicState();
  }

  async connectBot(botId) {
    const instance = this.bots.get(botId);
    if (!instance) throw new Error(`Bot ${botId} not found`);
    if (instance.bot) await this.disconnectBot(botId);

    instance.status = "connecting";
    this.emit("bot:statusChanged", { botId, status: "connecting" });

    try {
      const opts = this._buildMineflayerOptions(instance.config);
      instance.bot = mineflayer.createBot(opts);
      this._attachBotEvents(instance);
      return { success: true };
    } catch (err) {
      instance.status = "offline";
      this.emit("bot:statusChanged", { botId, status: "offline", error: err.message });
      throw err;
    }
  }

  _buildMineflayerOptions(config) {
    const opts = {
      host: config.host,
      port: parseInt(config.port) || 25565,
      username: config.nick,
      version: config.version || "1.20.1",
      auth: config.authType === "offline" ? "offline" : "microsoft",
      hideErrors: false,
      checkTimeoutInterval: 60000,
    };

    const proxy = config.proxy || this.configManager.get("globalProxy", "");
    if (proxy) {
      opts.agent = this._createProxyAgent(proxy);
    }

    return opts;
  }

  _createProxyAgent(proxyStr) {
    try {
      let url = proxyStr;
      if (!url.includes("://")) url = "socks5://" + url;
      if (url.startsWith("socks4://") || url.startsWith("socks5://")) {
        return new SocksProxyAgent(url);
      } else if (url.startsWith("https://")) {
        return new HttpsProxyAgent(url);
      } else {
        return new HttpProxyAgent(url);
      }
    } catch (err) {
      log.error("Failed to create proxy agent:", err);
      return null;
    }
  }

  _attachBotEvents(instance) {
    const { bot, id: botId, config } = instance;

    bot.loadPlugin(pathfinder);

    bot.once("spawn", () => {
      instance.status = "online";
      instance.captchaHandler = new CaptchaHandler(instance, this.ollamaManager);
      this.emit("bot:statusChanged", { botId, status: "online" });
      this._addChat(instance, "system", "Бот подключился к серверу");

      const defaultMove = new Movements(bot);
      defaultMove.allowSprinting = true;
      defaultMove.canDig = true;
      bot.pathfinder.setMovements(defaultMove);
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

    bot.on("windowOpen", (window) => {
      this.emit("bot:windowOpen", { botId, windowType: window.type });
    });

    bot.on("inventoryUpdate", () => {
      instance.stats.inventory = this._getInventoryItems(bot);
      instance.stats.hotbarSlot = bot.quickBarSlot;
      this.emit("bot:inventoryUpdated", { botId, inventory: instance.stats.inventory, hotbarSlot: instance.stats.hotbarSlot });
    });

    bot.on("chat", async (username, message) => {
      if (username === bot.username) return;
      this._addChat(instance, "player", `[${username}]: ${message}`);
      this.emit("bot:chat", { botId, username, message, type: "player" });

      await this._handleAutoLogin(instance, message);
      await instance.captchaHandler?.handleChatCaptcha(message);

      if (config.autoResponse && instance.aiEnabled) {
        await this._aiRespond(instance, username, message);
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
      if (instance.survivorAI?.isRunning) {
        instance.survivorAI.onDeath();
      }
    });

    bot.on("kicked", (reason) => {
      instance.status = "offline";
      this._addChat(instance, "system", `Кик: ${reason}`);
      this.emit("bot:statusChanged", { botId, status: "offline", reason });
      this._scheduleReconnect(instance);
    });

    bot.on("end", (reason) => {
      instance.status = "offline";
      this.emit("bot:statusChanged", { botId, status: "offline", reason });
      this._scheduleReconnect(instance);
    });

    bot.on("error", (err) => {
      log.error(`Bot ${botId} error:`, err.message);
      this.emit("bot:error", { botId, error: err.message });
    });
  }

  async _handleAutoLogin(instance, message) {
    const globalPass = this.configManager.getGlobalPassword();
    if (!globalPass) return;

    const lower = message.toLowerCase();
    const isRegister = lower.includes("/register") || lower.includes("зарегистрируй") || lower.includes("registration");
    const isLogin = lower.includes("/login") || lower.includes("войди") || lower.includes("авториз");

    if (instance.config.autoRegister && isRegister) {
      setTimeout(() => {
        instance.bot.chat(`/register ${globalPass} ${globalPass}`);
        this._addChat(instance, "system", "Авто-регистрация выполнена");
      }, 1500);
    } else if (instance.config.autoLogin && isLogin) {
      setTimeout(() => {
        instance.bot.chat(`/login ${globalPass}`);
        this._addChat(instance, "system", "Авто-логин выполнен");
      }, 1500);
    }
  }

  async _aiRespond(instance, username, playerMessage) {
    if (!instance.aiEnabled || !instance.bot) return;
    try {
      const context = this._buildAIContext(instance);
      const response = await this.ollamaManager.chat({
        model: instance.config.aiModel || "llama3",
        mode: instance.config.aiMode || "local",
        apiKey: instance.config.apiKey,
        apiProvider: instance.config.apiProvider,
        systemPrompt: instance.config.systemPrompt,
        messages: [
          {
            role: "user",
            content: `${context}\n\nИгрок ${username} написал в чат: "${playerMessage}"\n\nОтветь по-русски. Если нужно выполнить действие — верни JSON: {"action": "walk_to", "x": 100, "y": 64, "z": 200} или {"action": "chat", "message": "текст"} или {"action": "collect", "block": "oak_log"}. Если просто отвечаешь — пиши текст до 100 символов.`,
          },
        ],
      });

      if (!response.content) return;
      const text = response.content.trim();

      // Try to parse JSON command
      const jsonMatch = text.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        try {
          const cmd = JSON.parse(jsonMatch[0]);
          await this._executeBotCommand(instance, cmd);
          return;
        } catch {}
      }

      // Plain text reply — send to chat (max 100 chars)
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

  async _executeBotCommand(instance, cmd) {
    const { bot } = instance;
    if (!bot || !bot.entity) return;

    log.info(`Bot command: ${JSON.stringify(cmd)}`);
    this._addChat(instance, "system", `[ИИ] Действие: ${cmd.action}`);

    switch (cmd.action) {
      case "chat": {
        const msg = String(cmd.message || "").slice(0, 100);
        if (msg) {
          bot.chat(msg);
          this._addChat(instance, "bot", msg);
          this.emit("bot:chat", { botId: instance.id, username: instance.config.nick, message: msg, type: "bot" });
        }
        break;
      }

      case "walk_to":
      case "move_to": {
        const x = Math.round(Number(cmd.x) || 0);
        const y = Math.round(Number(cmd.y) || bot.entity.position.y);
        const z = Math.round(Number(cmd.z) || 0);
        bot.pathfinder.goto(new goals.GoalBlock(x, y, z)).catch((err) => {
          log.warn("Pathfinder error:", err.message);
        });
        break;
      }

      case "follow": {
        const target = Object.values(bot.entities).find(
          (e) => e.type === "player" && e.username === cmd.target
        );
        if (target) {
          bot.pathfinder.goto(new goals.GoalFollow(target, 2)).catch(() => {});
        }
        break;
      }

      case "collect":
      case "collect_block": {
        const blockName = cmd.block || cmd.target;
        if (!blockName) break;
        const blockType = bot.registry.blocksByName[blockName];
        if (!blockType) break;
        const block = bot.findBlock({ matching: blockType.id, maxDistance: 32 });
        if (block) {
          await bot.pathfinder.goto(new goals.GoalBlock(block.position.x, block.position.y, block.position.z)).catch(() => {});
          await bot.dig(block).catch(() => {});
        }
        break;
      }

      case "attack": {
        const entityName = cmd.target;
        const entity = Object.values(bot.entities).find(
          (e) => (e.name === entityName || e.username === entityName) &&
                  e.position.distanceTo(bot.entity.position) < 20
        );
        if (entity) {
          await bot.pathfinder.goto(new goals.GoalFollow(entity, 2)).catch(() => {});
          bot.attack(entity);
        }
        break;
      }

      case "stop":
        if (bot.pathfinder) bot.pathfinder.stop();
        bot.clearControlStates();
        break;

      case "jump":
        bot.setControlState("jump", true);
        setTimeout(() => bot.setControlState("jump", false), 500);
        break;

      default:
        // fallback: send as chat if there's a message
        if (cmd.message) {
          const msg = String(cmd.message).slice(0, 100);
          bot.chat(msg);
          this._addChat(instance, "bot", msg);
        }
        break;
    }
  }

  _buildAIContext(instance) {
    const s = instance.stats;
    const invSummary = s.inventory
      .slice(0, 10)
      .map((i) => `${i.name} x${i.count}`)
      .join(", ");
    return `Статус: HP=${s.health}/20, Голод=${s.food}/20, Опыт=${s.experience}, Броня=${s.armor}\nКоординаты: X=${s.x} Y=${s.y} Z=${s.z}, Биом: ${s.biome}\nИнвентарь: [${invSummary || "пусто"}]`;
  }

  _getInventoryItems(bot) {
    return bot.inventory.slots
      .filter(Boolean)
      .map((item) => ({
        name: item.name,
        count: item.count,
        slot: item.slot,
        displayName: item.displayName,
      }));
  }

  _addChat(instance, type, text) {
    instance.chatHistory.push({ type, text, timestamp: Date.now() });
    if (instance.chatHistory.length > 500) instance.chatHistory.shift();
  }

  _scheduleReconnect(instance) {
    if (!instance.config.autoReconnect) return;
    if (instance.reconnectTimer) clearTimeout(instance.reconnectTimer);
    const delay = instance.config.reconnectDelay || 5000;
    instance.reconnectTimer = setTimeout(() => {
      log.info(`Auto-reconnecting bot ${instance.id}`);
      this.connectBot(instance.id).catch((e) =>
        log.error("Reconnect failed:", e.message)
      );
    }, delay);
  }

  async disconnectBot(botId) {
    const instance = this.bots.get(botId);
    if (!instance) return;

    if (instance.reconnectTimer) {
      clearTimeout(instance.reconnectTimer);
      instance.reconnectTimer = null;
    }
    instance.config.autoReconnect = false;

    if (instance.survivorAI?.isRunning) {
      await instance.survivorAI.stop();
    }

    if (instance.bot) {
      try { instance.bot.quit(); } catch {}
      instance.bot = null;
    }

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
    if (!instance?.bot) {
      const inst = this.bots.get(botId);
      if (inst) {
        this._offlineAIChat(inst, message);
      }
      return;
    }
    instance.bot.chat(message);
    this._addChat(instance, "bot", message);
    this.emit("bot:chat", { botId, username: instance.config.nick, message, type: "bot" });
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
      if (response.content) {
        this._addChat(instance, "ai", response.content);
        this.emit("bot:aiMessage", { botId: instance.id, message: response.content });
      }
    } catch (err) {
      this._addChat(instance, "system", `Ошибка ИИ: ${err.message}`);
      this.emit("bot:error", { botId: instance.id, error: err.message });
    }
  }

  stopAction(botId) {
    const instance = this.bots.get(botId);
    if (!instance?.bot) return;
    if (instance.bot.pathfinder) instance.bot.pathfinder.stop();
    if (instance.bot.pvp) instance.bot.pvp.stop();
    instance.bot.clearControlStates();
    this._addChat(instance, "system", "Действие остановлено");
    this.emit("bot:actionStopped", { botId });
  }

  stopMovement(botId) {
    const instance = this.bots.get(botId);
    if (!instance?.bot) return;
    if (instance.bot.pathfinder) instance.bot.pathfinder.stop();
    instance.bot.clearControlStates();
    this._addChat(instance, "system", "Движение остановлено");
  }

  async startSurvivorMode(botId) {
    const instance = this.bots.get(botId);
    if (!instance?.bot) throw new Error("Bot not connected");
    if (!instance.aiEnabled) throw new Error("AI is disabled for this bot");

    instance.survivorAI = new SurvivorAI(instance, this.ollamaManager, this.emit);
    await instance.survivorAI.start();
    this.emit("bot:survivorStarted", { botId });
    return { success: true };
  }

  async stopSurvivorMode(botId) {
    const instance = this.bots.get(botId);
    if (instance?.survivorAI) {
      await instance.survivorAI.stop();
      instance.survivorAI = null;
    }
    this.emit("bot:survivorStopped", { botId });
    return { success: true };
  }

  setNick(botId, nick) {
    const instance = this.bots.get(botId);
    if (!instance) throw new Error("Bot not found");
    instance.config.nick = nick;
    this.configManager.saveBotConfig(instance.config);
    this._addChat(instance, "system", `Ник изменён на ${nick} (вступит в силу при следующем подключении)`);
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
      const agent = this._createProxyAgent(proxyStr);
      const { default: fetch } = await import("node-fetch");
      const resp = await fetch("https://api.ipify.org?format=json", {
        agent,
        timeout: 10000,
      });
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
    for (const [botId] of this.bots) {
      await this.disconnectBot(botId).catch(() => {});
    }
  }
}

module.exports = { BotManager };
