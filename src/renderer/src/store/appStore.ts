import { create } from "zustand";

export interface BotStats {
  health: number;
  food: number;
  armor: number;
  experience: number;
  x: number;
  y: number;
  z: number;
  biome: string;
  inventory: InventoryItem[];
  hotbarSlot: number;
}

export interface InventoryItem {
  name: string;
  count: number;
  slot: number;
  displayName: string;
}

export interface ChatMessage {
  type: "user" | "player" | "bot" | "ai" | "system" | "server" | "survivor";
  text: string;
  timestamp: number;
}

export interface BotState {
  id: string;
  config: {
    nick: string;
    host: string;
    port: number;
    version: string;
    aiEnabled: boolean;
    aiModel: string;
    aiMode: "local" | "api";
    systemPrompt: string;
    proxy: string;
    autoLogin: boolean;
    autoRegister: boolean;
    apiKey?: string;
    apiProvider?: string;
  };
  status: "offline" | "connecting" | "online";
  stats: BotStats;
  chatHistory: ChatMessage[];
  survivorMode: boolean;
}

export interface OllamaStatus {
  installed: boolean;
  running: boolean;
  models: any[];
}

export interface ModelInfo {
  name: string;
  displayName: string;
  size: string;
  vram: string;
  description: string;
  installed: boolean;
  tag?: string;
  isLocal?: boolean;
}

export interface InstalledModelInfo {
  name: string;
  size: string;
  modifiedAt: string;
}

export interface PullProgress {
  modelName: string;
  progress: {
    status: string;
    downloaded: number;
    total: number;
    percent: number;
    done: boolean;
  };
}

interface AppState {
  bots: BotState[];
  selectedBotId: string | null;
  ollamaStatus: OllamaStatus | null;
  models: ModelInfo[];
  installedModels: InstalledModelInfo[];
  pullProgresses: Record<string, PullProgress["progress"]>;
  globalPassword: string;
  globalProxy: string;
  groupChat: ChatMessage[];
  activeTab: "bots" | "models" | "settings" | "coordinator";

  setOllamaStatus: (s: OllamaStatus) => void;
  setModels: (m: ModelInfo[]) => void;
  setInstalledModels: (m: InstalledModelInfo[]) => void;
  setSelectedBot: (id: string | null) => void;
  setActiveTab: (tab: AppState["activeTab"]) => void;
  loadBots: () => Promise<void>;
  loadConfig: () => Promise<void>;

  onBotCreated: (d: BotState) => void;
  onBotDeleted: (d: { botId: string }) => void;
  onBotStatusChanged: (d: { botId: string; status: string; error?: string }) => void;
  onBotStatsUpdated: (d: { botId: string; stats: BotStats }) => void;
  onBotChat: (d: { botId: string; username: string; message: string; type: string }) => void;
  onBotServerMessage: (d: { botId: string; text: string }) => void;
  onBotAiMessage: (d: { botId: string; message: string }) => void;
  onBotDeath: (d: { botId: string }) => void;
  onBotError: (d: { botId: string; error: string }) => void;
  onInventoryUpdated: (d: { botId: string; inventory: InventoryItem[]; hotbarSlot: number }) => void;
  onSurvivorLog: (d: { botId: string; message: string }) => void;
  onSurvivorStarted: (d: { botId: string }) => void;
  onSurvivorStopped: (d: { botId: string }) => void;
  onAiToggled: (d: { botId: string; aiEnabled: boolean }) => void;
  onPullProgress: (d: PullProgress) => void;
  onGroupChat: (d: { botId: string; message: string }) => void;
}

function updateBot(bots: BotState[], botId: string, updater: (b: BotState) => BotState): BotState[] {
  return bots.map((b) => (b.id === botId ? updater(b) : b));
}

function addChatMessage(bot: BotState, msg: ChatMessage): BotState {
  const history = [...bot.chatHistory, msg].slice(-200);
  return { ...bot, chatHistory: history };
}

export const useAppStore = create<AppState>((set, get) => ({
  bots: [],
  selectedBotId: null,
  ollamaStatus: null,
  models: [],
  installedModels: [],
  pullProgresses: {},
  globalPassword: "",
  globalProxy: "",
  groupChat: [],
  activeTab: "bots",

  setOllamaStatus: (s) => set({ ollamaStatus: s }),
  setModels: (m) => set({ models: m }),
  setInstalledModels: (m) => set({ installedModels: m }),
  setSelectedBot: (id) => set({ selectedBotId: id }),
  setActiveTab: (tab) => set({ activeTab: tab }),

  loadBots: async () => {
    const bots = await window.electronAPI.bot.getAll();
    set({ bots });
    if (bots.length > 0 && !get().selectedBotId) {
      set({ selectedBotId: bots[0].id });
    }
  },

  loadConfig: async () => {
    const cfg = await window.electronAPI.config.get();
    const pw = await window.electronAPI.config.getGlobalPassword();
    set({ globalPassword: pw, globalProxy: cfg.globalProxy || "" });
  },

  onBotCreated: (d) => {
    set((s) => ({
      bots: [...s.bots, d],
      selectedBotId: s.selectedBotId || d.id,
    }));
  },

  onBotDeleted: ({ botId }) => {
    set((s) => {
      const bots = s.bots.filter((b) => b.id !== botId);
      const selectedBotId = s.selectedBotId === botId ? (bots[0]?.id || null) : s.selectedBotId;
      return { bots, selectedBotId };
    });
  },

  onBotStatusChanged: ({ botId, status }) => {
    set((s) => ({ bots: updateBot(s.bots, botId, (b) => ({ ...b, status: status as any })) }));
  },

  onBotStatsUpdated: ({ botId, stats }) => {
    set((s) => ({ bots: updateBot(s.bots, botId, (b) => ({ ...b, stats: { ...b.stats, ...stats } })) }));
  },

  onBotChat: ({ botId, username, message, type }) => {
    const text = type === "player" ? `[${username}]: ${message}` : message;
    const msgType = (type === "bot" ? "bot" : type === "player" ? "player" : "system") as ChatMessage["type"];
    set((s) => ({ bots: updateBot(s.bots, botId, (b) => addChatMessage(b, { type: msgType, text, timestamp: Date.now() })) }));
  },

  onBotServerMessage: ({ botId, text }) => {
    set((s) => ({ bots: updateBot(s.bots, botId, (b) => addChatMessage(b, { type: "server", text, timestamp: Date.now() })) }));
  },

  onBotAiMessage: ({ botId, message }) => {
    set((s) => ({ bots: updateBot(s.bots, botId, (b) => addChatMessage(b, { type: "ai", text: `[ИИ]: ${message}`, timestamp: Date.now() })) }));
  },

  onBotDeath: ({ botId }) => {
    set((s) => ({ bots: updateBot(s.bots, botId, (b) => addChatMessage(b, { type: "system", text: "💀 Бот умер", timestamp: Date.now() })) }));
  },

  onBotError: ({ botId, error }) => {
    set((s) => ({ bots: updateBot(s.bots, botId, (b) => addChatMessage(b, { type: "system", text: `[Ошибка] ${error}`, timestamp: Date.now() })) }));
  },

  onInventoryUpdated: ({ botId, inventory, hotbarSlot }) => {
    set((s) => ({ bots: updateBot(s.bots, botId, (b) => ({ ...b, stats: { ...b.stats, inventory, hotbarSlot } })) }));
  },

  onSurvivorLog: ({ botId, message }) => {
    set((s) => ({ bots: updateBot(s.bots, botId, (b) => addChatMessage(b, { type: "survivor", text: `[ВЫЖИВАЛЬЩИК] ${message}`, timestamp: Date.now() })) }));
  },

  onSurvivorStarted: ({ botId }) => {
    set((s) => ({ bots: updateBot(s.bots, botId, (b) => ({ ...b, survivorMode: true })) }));
  },

  onSurvivorStopped: ({ botId }) => {
    set((s) => ({ bots: updateBot(s.bots, botId, (b) => ({ ...b, survivorMode: false })) }));
  },

  onAiToggled: ({ botId, aiEnabled }) => {
    set((s) => ({
      bots: updateBot(s.bots, botId, (b) => ({
        ...b,
        config: { ...b.config, aiEnabled },
      })),
    }));
  },

  onPullProgress: ({ modelName, progress }) => {
    set((s) => ({ pullProgresses: { ...s.pullProgresses, [modelName]: progress } }));
  },

  onGroupChat: ({ botId, message }) => {
    const newMsg: ChatMessage = { type: "bot", text: `[Bot:${botId.slice(0, 6)}]: ${message}`, timestamp: Date.now() };
    set((s) => ({
      groupChat: [...s.groupChat, newMsg].slice(-200),
    }));
  },
}));
