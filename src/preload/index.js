const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  config: {
    get: () => ipcRenderer.invoke("config:get"),
    set: (key, value) => ipcRenderer.invoke("config:set", key, value),
    setGlobalPassword: (pw) => ipcRenderer.invoke("config:setGlobalPassword", pw),
    getGlobalPassword: () => ipcRenderer.invoke("config:getGlobalPassword"),
  },
  ollama: {
    check: () => ipcRenderer.invoke("ollama:check"),
    install: () => ipcRenderer.invoke("ollama:install"),
    listModels: () => ipcRenderer.invoke("ollama:listModels"),
    listInstalledModels: () => ipcRenderer.invoke("ollama:listInstalledModels"),
    pullModel: (name) => ipcRenderer.invoke("ollama:pullModel", name),
    deleteModel: (name) => ipcRenderer.invoke("ollama:deleteModel", name),
    chat: (params) => ipcRenderer.invoke("ollama:chat", params),
    getRunningModels: () => ipcRenderer.invoke("ollama:getRunningModels"),
    loadCustomModel: (path) => ipcRenderer.invoke("ollama:loadCustomModel", path),
    onPullProgress: (cb) => {
      ipcRenderer.on("ollama:pullProgress", (_e, data) => cb(data));
      return () => ipcRenderer.removeAllListeners("ollama:pullProgress");
    },
  },
  bot: {
    create: (config) => ipcRenderer.invoke("bot:create", config),
    connect: (id) => ipcRenderer.invoke("bot:connect", id),
    disconnect: (id) => ipcRenderer.invoke("bot:disconnect", id),
    delete: (id) => ipcRenderer.invoke("bot:delete", id),
    sendChat: (id, msg) => ipcRenderer.invoke("bot:sendChat", id, msg),
    stopAction: (id) => ipcRenderer.invoke("bot:stopAction", id),
    stopMovement: (id) => ipcRenderer.invoke("bot:stopMovement", id),
    startSurvivor: (id) => ipcRenderer.invoke("bot:startSurvivor", id),
    stopSurvivor: (id) => ipcRenderer.invoke("bot:stopSurvivor", id),
    setNick: (id, nick) => ipcRenderer.invoke("bot:setNick", id, nick),
    toggleAI: (id, enabled) => ipcRenderer.invoke("bot:toggleAI", id, enabled),
    getAll: () => ipcRenderer.invoke("bot:getAll"),
    updateConfig: (id, config) => ipcRenderer.invoke("bot:updateConfig", id, config),
    testProxy: (proxy) => ipcRenderer.invoke("bot:testProxy", proxy),
    // Anarchy Protocol
    startAnarchy: (id, opts) => ipcRenderer.invoke("bot:startAnarchy", id, opts),
    stopAnarchy: (id) => ipcRenderer.invoke("bot:stopAnarchy", id),
    getAnarchyState: (id) => ipcRenderer.invoke("bot:getAnarchyState", id),
  },
  proxy: {
    check: (proxy) => ipcRenderer.invoke("proxy:check", proxy),
  },
  dialog: {
    openFile: () => ipcRenderer.invoke("dialog:openFile"),
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
  },
  on: (channel, cb) => {
    const allowedChannels = [
      "bot:created", "bot:deleted", "bot:statusChanged", "bot:statsUpdated",
      "bot:chat", "bot:serverMessage", "bot:aiMessage", "bot:death",
      "bot:error", "bot:actionStopped", "bot:inventoryUpdated",
      "bot:survivorStarted", "bot:survivorStopped", "bot:survivorLog",
      "bot:aiToggled", "bot:windowOpen",
      "bot:anarchyStarted", "bot:anarchyStopped", "bot:anarchyPhase", "bot:anarchyLog",
      "ollama:pullProgress",
      "coordinator:statusUpdate", "coordinator:taskAssigned", "coordinator:groupChat",
    ];
    if (!allowedChannels.includes(channel)) return () => {};
    const handler = (_e, data) => cb(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
