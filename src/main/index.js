const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const { OllamaManager } = require("./ollama-manager");
const { BotManager } = require("./bot-manager");
const { CoordinatorServer } = require("./coordinator");
const { ConfigManager } = require("./config-manager");
const log = require("electron-log");

log.initialize({ preload: true });
log.transports.file.level = "debug";

const isDev = process.env.NODE_ENV === "development";

let mainWindow = null;
let ollamaManager = null;
let botManager = null;
let coordinatorServer = null;
let configManager = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#1A1A1A",
    titleBarStyle: "default",
    title: "Призмарин Бот v3.0",
    icon: path.join(__dirname, "../../assets/icon.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "../preload/index.js"),
      webSecurity: !isDev,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:3456");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function initialize() {
  configManager = new ConfigManager();
  ollamaManager = new OllamaManager(configManager);
  botManager = new BotManager(configManager, ollamaManager, (event, data) => {
    if (mainWindow) mainWindow.webContents.send(event, data);
  });
  coordinatorServer = new CoordinatorServer(botManager, (event, data) => {
    if (mainWindow) mainWindow.webContents.send(event, data);
  });

  setupIpcHandlers();
  await coordinatorServer.start();
}

function setupIpcHandlers() {
  ipcMain.handle("config:get", () => configManager.getAll());
  ipcMain.handle("config:set", (_e, key, value) => configManager.set(key, value));
  ipcMain.handle("config:setGlobalPassword", (_e, password) =>
    configManager.setGlobalPassword(password)
  );
  ipcMain.handle("config:getGlobalPassword", () =>
    configManager.getGlobalPassword()
  );

  ipcMain.handle("ollama:check", () => ollamaManager.checkOllama());
  ipcMain.handle("ollama:install", () => ollamaManager.installOllama());
  ipcMain.handle("ollama:listModels", () => ollamaManager.listModels());
  ipcMain.handle("ollama:listInstalledModels", () => ollamaManager.listInstalledModels());
  ipcMain.handle("ollama:pullModel", (_e, modelName) =>
    ollamaManager.pullModel(modelName, (progress) => {
      if (mainWindow)
        mainWindow.webContents.send("ollama:pullProgress", { modelName, progress });
    })
  );
  ipcMain.handle("ollama:deleteModel", (_e, modelName) =>
    ollamaManager.deleteModel(modelName)
  );
  ipcMain.handle("ollama:chat", (_e, params) => ollamaManager.chat(params));
  ipcMain.handle("ollama:getRunningModels", () => ollamaManager.getRunningModels());
  ipcMain.handle("ollama:loadCustomModel", (_e, filePath) =>
    ollamaManager.loadCustomModel(filePath)
  );

  ipcMain.handle("bot:create", (_e, config) => botManager.createBot(config));
  ipcMain.handle("bot:connect", (_e, botId) => botManager.connectBot(botId));
  ipcMain.handle("bot:disconnect", (_e, botId) => botManager.disconnectBot(botId));
  ipcMain.handle("bot:delete", (_e, botId) => botManager.deleteBot(botId));
  ipcMain.handle("bot:sendChat", (_e, botId, message) =>
    botManager.sendChat(botId, message)
  );
  ipcMain.handle("bot:stopAction", (_e, botId) => botManager.stopAction(botId));
  ipcMain.handle("bot:stopMovement", (_e, botId) => botManager.stopMovement(botId));
  ipcMain.handle("bot:startSurvivor", (_e, botId) =>
    botManager.startSurvivorMode(botId)
  );
  ipcMain.handle("bot:stopSurvivor", (_e, botId) => botManager.stopSurvivorMode(botId));
  ipcMain.handle("bot:setNick", (_e, botId, nick) =>
    botManager.setNick(botId, nick)
  );
  ipcMain.handle("bot:toggleAI", (_e, botId, enabled) =>
    botManager.toggleAI(botId, enabled)
  );
  ipcMain.handle("bot:getAll", () => botManager.getAllBots());
  ipcMain.handle("bot:updateConfig", (_e, botId, config) =>
    botManager.updateBotConfig(botId, config)
  );
  ipcMain.handle("bot:testProxy", (_e, proxy) => botManager.testProxy(proxy));

  ipcMain.handle("proxy:check", (_e, proxy) => botManager.testProxy(proxy));

  ipcMain.handle("bot:startAnarchy", (_e, botId, opts) =>
    botManager.startAnarchyProtocol(botId, opts)
  );
  ipcMain.handle("bot:stopAnarchy", (_e, botId) =>
    botManager.stopAnarchyProtocol(botId)
  );
  ipcMain.handle("bot:getAnarchyState", (_e, botId) =>
    botManager.getAnarchyState(botId)
  );


  ipcMain.handle("dialog:openFile", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters: [{ name: "GGUF Model", extensions: ["gguf"] }],
    });
    return result.filePaths[0] || null;
  });

  ipcMain.handle("shell:openExternal", (_e, url) => shell.openExternal(url));
}

app.whenReady().then(async () => {
  await initialize();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", async () => {
  await botManager?.disconnectAll();
  await coordinatorServer?.stop();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async () => {
  await botManager?.disconnectAll();
});
