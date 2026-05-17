const Store = require("electron-store");
const CryptoJS = require("crypto-js");
const { v4: uuidv4 } = require("uuid");

const ENCRYPTION_KEY = "mc-bot-secret-key-2024";

class ConfigManager {
  constructor() {
    this.store = new Store({
      name: "minecraft-bot-config",
      defaults: {
        globalPassword: "",
        globalProxy: "",
        bots: [],
        settings: {
          theme: "dark",
          language: "ru",
          autoSave: true,
        },
      },
    });
  }

  getAll() {
    return {
      globalProxy: this.store.get("globalProxy", ""),
      settings: this.store.get("settings", {}),
      bots: this.store.get("bots", []).map((b) => ({ ...b, password: undefined })),
    };
  }

  set(key, value) {
    this.store.set(key, value);
    return true;
  }

  get(key, defaultValue) {
    return this.store.get(key, defaultValue);
  }

  setGlobalPassword(password) {
    const encrypted = CryptoJS.AES.encrypt(password, ENCRYPTION_KEY).toString();
    this.store.set("globalPassword", encrypted);
    return true;
  }

  getGlobalPassword() {
    const encrypted = this.store.get("globalPassword", "");
    if (!encrypted) return "";
    try {
      const bytes = CryptoJS.AES.decrypt(encrypted, ENCRYPTION_KEY);
      return bytes.toString(CryptoJS.enc.Utf8);
    } catch {
      return "";
    }
  }

  saveBotConfig(botConfig) {
    const bots = this.store.get("bots", []);
    const idx = bots.findIndex((b) => b.id === botConfig.id);
    const safeConfig = { ...botConfig };
    if (idx >= 0) {
      bots[idx] = safeConfig;
    } else {
      bots.push(safeConfig);
    }
    this.store.set("bots", bots);
  }

  deleteBotConfig(botId) {
    const bots = this.store.get("bots", []).filter((b) => b.id !== botId);
    this.store.set("bots", bots);
  }

  getBotConfigs() {
    return this.store.get("bots", []);
  }

  createDefaultBotConfig() {
    return {
      id: uuidv4(),
      nick: `Призмарин_${Math.floor(Math.random() * 9999)}`,
      host: "localhost",
      port: 25565,
      version: "1.20.1",
      authType: "offline",
      aiEnabled: true,
      aiModel: "sweaterdog/andy-4:micro-q8_0",
      aiMode: "local",
      apiKey: "",
      apiProvider: "openai",
      systemPrompt:
        "Ты умный Minecraft-бот. Всегда отвечай ТОЛЬКО по-русски. Ты можешь ходить, собирать ресурсы, строить и общаться. Когда нужно выполнить действие — отвечай JSON: {\"action\": \"chat\", \"message\": \"текст\"} или {\"action\": \"walk_to\", \"x\": 0, \"y\": 0, \"z\": 0} или {\"action\": \"collect\", \"block\": \"oak_log\"}. На вопросы отвечай по-русски.",
      proxy: "",
      autoLogin: true,
      autoRegister: true,
      autoReconnect: true,
      autoResponse: true,
      reconnectDelay: 5000,
    };
  }
}

module.exports = { ConfigManager };
