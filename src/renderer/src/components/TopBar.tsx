import React, { useState } from "react";
import { useAppStore } from "../store/appStore";

export default function TopBar() {
  const { ollamaStatus, bots } = useAppStore();
  const onlineBots = bots.filter((b) => b.status === "online").length;
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div
      className="flex items-center justify-between px-3 py-1.5 border-b"
      style={{ borderColor: "#3a3a3a", background: "#222", minHeight: 36 }}
    >
      <div className="flex items-center gap-3">
        <span className="font-mono font-bold" style={{ color: "#7ecc49", fontSize: 14 }}>
          ⛏️ Minecraft Bot
        </span>
        <span className="text-xs" style={{ color: "#555" }}>v1.0.0</span>
      </div>

      <div className="flex items-center gap-4 text-xs" style={{ color: "#888" }}>
        <div className="flex items-center gap-1.5">
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: onlineBots > 0 ? "#7ecc49" : "#555" }}
          />
          <span>Ботов онлайн: {onlineBots}/{bots.length}</span>
        </div>

        <div className="flex items-center gap-1.5">
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: ollamaStatus?.running ? "#7ecc49" : "#c0392b" }}
          />
          <span>Ollama: {ollamaStatus?.running ? "активна" : "выкл"}</span>
        </div>
      </div>
    </div>
  );
}
