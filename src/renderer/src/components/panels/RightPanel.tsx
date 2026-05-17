import React, { useState, useRef, useEffect } from "react";
import { BotState, ChatMessage } from "../../store/appStore";

interface Props {
  bot: BotState | null;
}

export default function RightPanel({ bot }: Props) {
  const [input, setInput] = useState("");
  const [autoResponse, setAutoResponse] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [bot?.chatHistory]);

  useEffect(() => {
    if (bot) {
      setAutoResponse(!!(bot.config as any).autoResponse);
    }
  }, [bot?.id]);

  async function handleAutoResponseToggle(checked: boolean) {
    setAutoResponse(checked);
    if (bot) {
      await window.electronAPI.bot.updateConfig(bot.id, { autoResponse: checked });
    }
  }

  async function handleSend() {
    if (!input.trim() || !bot) return;
    await window.electronAPI.bot.sendChat(bot.id, input.trim());
    setInput("");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function getMsgColor(type: ChatMessage["type"]) {
    switch (type) {
      case "user": return "#7fb3d3";
      case "player": return "#e8e8e8";
      case "bot": return "#7ecc49";
      case "ai": return "#9b59b6";
      case "system": return "#888888";
      case "server": return "#bdc3c7";
      case "survivor": return "#e67e22";
      default: return "#e8e8e8";
    }
  }

  function formatTime(ts: number) {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  }

  const messages = bot?.chatHistory || [];

  return (
    <div className="panel flex-shrink-0 flex flex-col" style={{ width: 320 }}>
      <div
        className="flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: "#3a3a3a" }}
      >
        <span className="text-xs font-mono" style={{ color: "#7ecc49" }}>
          {bot?.status === "online" ? "Игровой чат" : "Оффлайн чат"}
        </span>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: autoResponse ? "#7ecc49" : "#888" }}>
          <input
            type="checkbox"
            checked={autoResponse}
            onChange={(e) => handleAutoResponseToggle(e.target.checked)}
            style={{ accentColor: "#7ecc49" }}
          />
          Автоответ
        </label>
      </div>

      <div
        className="flex-1 overflow-y-auto p-2"
        style={{ fontFamily: "'Courier New', monospace", fontSize: 12, lineHeight: 1.5 }}
      >
        {messages.length === 0 ? (
          <div className="text-center mt-8" style={{ color: "#555" }}>
            {bot ? "Сообщений нет" : "Выберите бота"}
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className="mb-0.5">
              <span style={{ color: "#555", marginRight: 4 }}>[{formatTime(msg.timestamp)}]</span>
              <span style={{ color: getMsgColor(msg.type) }}>{msg.text}</span>
            </div>
          ))
        )}
        <div ref={chatEndRef} />
      </div>

      <div className="p-2 border-t" style={{ borderColor: "#3a3a3a" }}>
        <div className="flex gap-1">
          <input
            className="input flex-1 text-xs"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={bot?.status === "online" ? "Написать в чат..." : "Спросить у ИИ..."}
            disabled={!bot}
          />
          <button
            className="btn btn-primary text-xs px-3"
            onClick={handleSend}
            disabled={!bot || !input.trim()}
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  );
}
