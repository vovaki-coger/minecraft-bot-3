declare global {
  interface Window {
    electronAPI: {
      config: {
        get: () => Promise<any>;
        set: (key: string, value: any) => Promise<boolean>;
        setGlobalPassword: (pw: string) => Promise<boolean>;
        getGlobalPassword: () => Promise<string>;
      };
      ollama: {
        check: () => Promise<{ installed: boolean; running: boolean; models: any[] }>;
        install: () => Promise<{ success: boolean; message?: string }>;
        listModels: () => Promise<any[]>;
        pullModel: (name: string) => Promise<{ success: boolean }>;
        deleteModel: (name: string) => Promise<{ success: boolean }>;
        chat: (params: any) => Promise<{ content: string; model: string }>;
        getRunningModels: () => Promise<any[]>;
        loadCustomModel: (path: string) => Promise<{ success: boolean; modelName: string }>;
        onPullProgress: (cb: (data: any) => void) => () => void;
      };
      bot: {
        create: (config: any) => Promise<any>;
        connect: (id: string) => Promise<any>;
        disconnect: (id: string) => Promise<any>;
        delete: (id: string) => Promise<any>;
        sendChat: (id: string, msg: string) => Promise<void>;
        stopAction: (id: string) => Promise<any>;
        stopMovement: (id: string) => Promise<any>;
        startSurvivor: (id: string) => Promise<any>;
        stopSurvivor: (id: string) => Promise<any>;
        setNick: (id: string, nick: string) => Promise<any>;
        toggleAI: (id: string, enabled: boolean) => Promise<any>;
        getAll: () => Promise<any[]>;
        updateConfig: (id: string, config: any) => Promise<any>;
        testProxy: (proxy: string) => Promise<{ success: boolean; ip?: string; error?: string }>;
      };
      proxy: {
        check: (proxy: string) => Promise<{ success: boolean; ip?: string; error?: string }>;
      };
      dialog: {
        openFile: () => Promise<string | null>;
      };
      shell: {
        openExternal: (url: string) => Promise<void>;
      };
      on: (channel: string, cb: (data: any) => void) => () => void;
    };
  }
}

export {};
