import React from "react";
import { useAppStore } from "../store/appStore";

export default function TopBar() {
  const { ollamaStatus, bots } = useAppStore();
  const onlineBots = bots.filter((b) => b.status === "online").length;
  const hasAndy = bots.some(b => (b.config.aiModel || "").toLowerCase().includes("andy"));

  return (
    <div
      className="flex items-center justify-between px-3 py-1.5 border-b"
      style={{ borderColor: "#1a3a3a", background: "#141f1f", minHeight: 36 }}
    >
      <div className="flex items-center gap-3">
        {/* Prismarine crystal icon — cyan diamond SVG inline */}
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <polygon points="10,1 18,7 14,19 6,19 2,7" fill="#2ec4b6" opacity="0.85"/>
          <polygon points="10,1 18,7 10,5" fill="#48dfd0" opacity="0.9"/>
          <polygon points="10,1 2,7 10,5" fill="#1a9e94" opacity="0.8"/>
          <polygon points="10,5 18,7 14,19 6,19 2,7" fill="#26a69a" opacity="0.6"/>
          <polygon points="10,5 14,19 10,14" fill="#2ec4b6" opacity="0.5"/>
          <polygon points="10,5 6,19 10,14" fill="#1a9e94" opacity="0.5"/>
        </svg>
        <span className="font-mono font-bold" style={{ color: "#2ec4b6", fontSize: 14, letterSpacing: "0.02em" }}>
          Prismarine Bot
        </span>
        <span className="text-xs" style={{ color: "#2a5a55" }}>v3.0.0</span>
        {hasAndy && (
          <span style={{
            fontSize: 9, background: "#2ec4b611", border: "1px solid #2ec4b644",
            color: "#2ec4b6", borderRadius: 3, padding: "1px 5px", fontFamily: "monospace",
          }}>
            Andy-4
          </span>
        )}
      </div>

      <div className="flex items-center gap-4 text-xs" style={{ color: "#2a5a55" }}>
        <div className="flex items-center gap-1.5">
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: onlineBots > 0 ? "#2ec4b6" : "#2a4a47" }}
          />
          <span style={{ color: onlineBots > 0 ? "#2ec4b6" : "#2a5a55" }}>
            Ботов онлайн: {onlineBots}/{bots.length}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: ollamaStatus?.running ? "#2ec4b6" : "#c0392b" }}
          />
          <span style={{ color: ollamaStatus?.running ? "#2ec4b6" : "#555" }}>
            Ollama: {ollamaStatus?.running ? "активна" : "выкл"}
          </span>
        </div>
      </div>
    </div>
  );
}
