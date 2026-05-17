import React, { useState } from "react";
import { BotState } from "../store/appStore";

interface Props {
  bot: BotState;
}

export default function BotControls({ bot }: Props) {
  const [newNick, setNewNick] = useState("");
  const [showNickInput, setShowNickInput] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);

  async function handle(action: string, fn: () => Promise<any>) {
    setLoading(action);
    try { await fn(); } catch (err: any) { alert(err.message); }
    finally { setLoading(null); }
  }

  async function handleConnect() {
    if (bot.status === "online" || bot.status === "connecting") {
      await handle("disconnect", () => window.electronAPI.bot.disconnect(bot.id));
    } else {
      await handle("connect", () => window.electronAPI.bot.connect(bot.id));
    }
  }

  async function handleNickChange() {
    if (!newNick.trim()) return;
    await handle("nick", () => window.electronAPI.bot.setNick(bot.id, newNick.trim()));
    setNewNick("");
    setShowNickInput(false);
  }

  async function handleSurvivor() {
    if (bot.survivorMode) {
      await handle("survivor", () => window.electronAPI.bot.stopSurvivor(bot.id));
    } else {
      await handle("survivor", () => window.electronAPI.bot.startSurvivor(bot.id));
    }
  }

  async function handleToggleAI() {
    await handle("ai", () => window.electronAPI.bot.toggleAI(bot.id, !bot.config.aiEnabled));
  }

  async function handleDelete() {
    if (!confirm(`Удалить бота ${bot.config.nick}?`)) return;
    await window.electronAPI.bot.delete(bot.id);
  }

  const isConnected = bot.status === "online";
  const isConnecting = bot.status === "connecting";

  return (
    <div className="panel p-3">
      <div className="text-xs font-mono mb-2" style={{ color: "#7ecc49" }}>🎮 Управление</div>

      <div className="flex flex-col gap-2">
        <div className="flex gap-1.5 flex-wrap">
          <button
            className={`btn text-xs ${isConnected ? "btn-danger" : "btn-primary"}`}
            onClick={handleConnect}
            disabled={loading === "connect" || loading === "disconnect" || isConnecting}
          >
            {isConnecting ? "⏳ Подключение..." : isConnected ? "⏹ Отключиться" : "▶️ Подключиться"}
          </button>

          <button
            className={`btn text-xs ${bot.config.aiEnabled ? "" : ""}`}
            onClick={handleToggleAI}
            disabled={loading === "ai"}
            style={{
              borderColor: bot.config.aiEnabled ? "#7ecc49" : "#555",
              color: bot.config.aiEnabled ? "#7ecc49" : "#888",
            }}
          >
            {bot.config.aiEnabled ? "⚡ ИИ: Вкл" : "💤 ИИ: Выкл"}
          </button>
        </div>

        <div className="flex gap-1.5 flex-wrap">
          <button
            className="btn text-xs btn-warning"
            onClick={() => handle("stopAction", () => window.electronAPI.bot.stopAction(bot.id))}
            disabled={!isConnected || loading === "stopAction"}
          >
            ⛔ Стоп действие
          </button>

          <button
            className="btn text-xs"
            onClick={() => handle("stopMove", () => window.electronAPI.bot.stopMovement(bot.id))}
            disabled={!isConnected || loading === "stopMove"}
          >
            🚫 Стоп движение
          </button>
        </div>

        <button
          className={`btn text-xs w-full ${bot.survivorMode ? "btn-danger" : "btn-primary"}`}
          onClick={handleSurvivor}
          disabled={!isConnected || !bot.config.aiEnabled || loading === "survivor"}
          style={bot.survivorMode ? {} : { background: "#5b3000", borderColor: "#e67e22", color: "#e67e22" }}
        >
          {loading === "survivor"
            ? "⏳..."
            : bot.survivorMode
            ? "⏹ Остановить ВЫЖИВАЛЬЩИКА"
            : "⚔️ ВЫЖИВАЛЬЩИК"}
        </button>

        <div className="flex gap-1">
          {showNickInput ? (
            <>
              <input
                className="input flex-1 text-xs"
                value={newNick}
                onChange={(e) => setNewNick(e.target.value)}
                placeholder="Новый ник..."
                onKeyDown={(e) => e.key === "Enter" && handleNickChange()}
                autoFocus
              />
              <button className="btn btn-primary text-xs" onClick={handleNickChange}>✓</button>
              <button className="btn text-xs" onClick={() => setShowNickInput(false)}>✕</button>
            </>
          ) : (
            <button
              className="btn text-xs flex-1"
              onClick={() => setShowNickInput(true)}
            >
              ✏️ Сменить ник
            </button>
          )}
        </div>

        <button
          className="btn btn-danger text-xs"
          onClick={handleDelete}
        >
          🗑️ Удалить бота
        </button>
      </div>
    </div>
  );
}
