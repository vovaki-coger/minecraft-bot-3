import React from "react";
import { BotState } from "../../store/appStore";
import BotStats from "../BotStats";
import Inventory from "../Inventory";
import BotControls from "../BotControls";

interface Props {
  bot: BotState | null;
}

export default function CenterPanel({ bot }: Props) {
  if (!bot) {
    return (
      <div className="panel flex-1 flex items-center justify-center" style={{ color: "#555" }}>
        <div className="text-center">
          <div className="text-4xl mb-3">⛏️</div>
          <p>Выберите бота или создайте нового</p>
        </div>
      </div>
    );
  }

  return (
    <div className="panel flex-1 flex flex-col overflow-hidden">
      <div
        className="flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: "#3a3a3a" }}
      >
        <div className="flex items-center gap-2">
          <span
            className="w-2.5 h-2.5 rounded-full"
            style={{
              background:
                bot.status === "online"
                  ? "#7ecc49"
                  : bot.status === "connecting"
                  ? "#f1c40f"
                  : "#555",
            }}
          />
          <span className="font-mono text-sm" style={{ color: "#7ecc49" }}>
            {bot.config.nick}
          </span>
          <span className="text-xs" style={{ color: "#888" }}>
            {bot.status === "online"
              ? "В игре"
              : bot.status === "connecting"
              ? "Подключение..."
              : "Оффлайн"}
          </span>
          {bot.survivorMode && (
            <span
              className="text-xs px-1.5 py-0.5 rounded pulse"
              style={{ background: "#2a1a00", color: "#e67e22", border: "1px solid #e67e22" }}
            >
              ⚔️ ВЫЖИВАЛЬЩИК
            </span>
          )}
        </div>
        <span className="text-xs" style={{ color: "#555" }}>
          {bot.config.host}:{bot.config.port}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        <BotStats bot={bot} />
        <Inventory bot={bot} />
        <BotControls bot={bot} />
      </div>
    </div>
  );
}
