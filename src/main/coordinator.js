const { WebSocketServer } = require("ws");
const log = require("electron-log");

class CoordinatorServer {
  constructor(botManager, emit) {
    this.botManager = botManager;
    this.emit = emit;
    this.wss = null;
    this.clients = new Set();
    this.PORT = 29485;
    this.taskAssignments = new Map();
  }

  async start() {
    this.wss = new WebSocketServer({ port: this.PORT });

    this.wss.on("connection", (ws) => {
      this.clients.add(ws);
      log.info("Bot coordinator client connected");

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this._handleMessage(ws, msg);
        } catch {}
      });

      ws.on("close", () => {
        this.clients.delete(ws);
      });

      ws.on("error", (err) => {
        log.warn("Coordinator WS error:", err.message);
      });

      ws.send(JSON.stringify({ type: "welcome", port: this.PORT }));
    });

    log.info(`Coordinator server started on port ${this.PORT}`);
  }

  async stop() {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }

  _handleMessage(ws, msg) {
    switch (msg.type) {
      case "bot:status":
        this._updateBotStatus(msg.botId, msg.data);
        break;
      case "request:task":
        this._assignTask(msg.botId, ws);
        break;
      case "bot:chat":
        this._broadcastBotChat(msg.botId, msg.message);
        break;
    }
  }

  _updateBotStatus(botId, data) {
    this._broadcast({ type: "coordinator:statusUpdate", botId, data });
    this.emit("coordinator:statusUpdate", { botId, data });
  }

  _assignTask(botId, ws) {
    const bots = this.botManager.getAllBots().filter((b) => b.status === "online");
    const tasks = [
      "wood_gathering",
      "food_gathering",
      "mining",
      "shelter_building",
      "exploration",
    ];

    const usedTasks = new Set(this.taskAssignments.values());
    const availableTasks = tasks.filter((t) => !usedTasks.has(t));
    const task = availableTasks[0] || tasks[Math.floor(Math.random() * tasks.length)];

    this.taskAssignments.set(botId, task);

    ws.send(
      JSON.stringify({
        type: "task:assigned",
        botId,
        task,
        allies: bots
          .filter((b) => b.id !== botId)
          .map((b) => ({ id: b.id, nick: b.config.nick, task: this.taskAssignments.get(b.id) })),
      })
    );

    this._broadcast({
      type: "coordinator:taskAssigned",
      botId,
      task,
    });

    this.emit("coordinator:taskAssigned", { botId, task });
  }

  _broadcastBotChat(botId, message) {
    this._broadcast({ type: "bot:groupChat", botId, message });
    this.emit("coordinator:groupChat", { botId, message });
  }

  _broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.readyState === 1) {
        client.send(data);
      }
    }
  }
}

module.exports = { CoordinatorServer };
