import React, { useRef, useEffect } from "react";
import { useAppStore } from "../../store/appStore";

export default function CoordinatorTab() {
  const { bots, groupChat } = useAppStore();
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [groupChat]);

  const onlineBots = bots.filter((b) => b.status === "online");

  function formatTime(ts: number) {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b text-xs font-mono" style={{ borderColor: "#3a3a3a", color: "#7ecc49" }}>
        🔗 Кооперация ботов
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        <div className="panel p-3">
          <h3 className="text-xs font-mono mb-2" style={{ color: "#7ecc49" }}>
            🤖 Активные боты ({onlineBots.length})
          </h3>
          {onlineBots.length === 0 ? (
            <p className="text-xs" style={{ color: "#555" }}>Нет подключённых ботов</p>
          ) : (
            <div className="flex flex-col gap-1">
              {onlineBots.map((bot) => (
                <div
                  key={bot.id}
                  className="flex items-center justify-between p-1.5 rounded text-xs"
                  style={{ background: "#1a2a1a", border: "1px solid #3a5a3a" }}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: bot.config.aiEnabled ? "#7ecc49" : "#888" }}
                    />
                    <span style={{ color: "#e8e8e8" }}>{bot.config.nick}</span>
                  </div>
                  <div className="flex items-center gap-2" style={{ color: "#666" }}>
                    <span>{bot.config.host}</span>
                    {bot.survivorMode && (
                      <span style={{ color: "#e67e22" }}>⚔️</span>
                    )}
                    {bot.config.aiEnabled ? (
                      <span style={{ color: "#7ecc49", fontSize: 9 }}>⚡ИИ</span>
                    ) : (
                      <span style={{ color: "#888", fontSize: 9 }}>💤</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="panel p-3 flex flex-col" style={{ minHeight: 200 }}>
          <h3 className="text-xs font-mono mb-2" style={{ color: "#7ecc49" }}>
            💬 Групповой чат ботов
          </h3>
          <div className="flex-1 overflow-y-auto" style={{ maxHeight: 200, fontSize: 11, fontFamily: "monospace" }}>
            {groupChat.length === 0 ? (
              <p className="text-xs text-center mt-4" style={{ color: "#555" }}>
                Здесь будут сообщения ботов между собой
              </p>
            ) : (
              groupChat.map((msg, i) => (
                <div key={i} className="mb-0.5">
                  <span style={{ color: "#555" }}>[{formatTime(msg.timestamp)}]</span>
                  <span style={{ color: "#7ecc49", marginLeft: 4 }}>{msg.text}</span>
                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>
        </div>

        <div className="panel p-3">
          <h3 className="text-xs font-mono mb-2" style={{ color: "#7ecc49" }}>📊 Статистика</h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="text-center p-2 rounded" style={{ background: "#1a2a1a" }}>
              <div className="text-2xl font-bold" style={{ color: "#7ecc49" }}>
                {bots.length}
              </div>
              <div style={{ color: "#888" }}>Всего ботов</div>
            </div>
            <div className="text-center p-2 rounded" style={{ background: "#1a2a1a" }}>
              <div className="text-2xl font-bold" style={{ color: "#7ecc49" }}>
                {onlineBots.length}
              </div>
              <div style={{ color: "#888" }}>Онлайн</div>
            </div>
            <div className="text-center p-2 rounded" style={{ background: "#1a2a1a" }}>
              <div className="text-2xl font-bold" style={{ color: "#7ecc49" }}>
                {bots.filter((b) => b.config.aiEnabled).length}
              </div>
              <div style={{ color: "#888" }}>С ИИ</div>
            </div>
            <div className="text-center p-2 rounded" style={{ background: "#1a2a1a" }}>
              <div className="text-2xl font-bold" style={{ color: "#e67e22" }}>
                {bots.filter((b) => b.survivorMode).length}
              </div>
              <div style={{ color: "#888" }}>Выживальщик</div>
            </div>
          </div>
        </div>

        <div className="panel p-3 text-xs" style={{ color: "#555" }}>
          <p className="mb-1" style={{ color: "#888" }}>ℹ️ Как работает кооперация:</p>
          <p>• Боты общаются через локальный WebSocket сервер</p>
          <p>• Координатор распределяет задачи автоматически</p>
          <p>• Каждый бот видит статус других ботов</p>
          <p>• Порт координатора: 29485</p>
        </div>
      </div>
    </div>
  );
}
