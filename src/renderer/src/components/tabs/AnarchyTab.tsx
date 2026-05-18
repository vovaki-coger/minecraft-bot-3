import React, { useState, useEffect, useRef } from "react";
import { useAppStore } from "../../store/appStore";

const PHASE_LABELS: Record<string, string> = {
  idle:         "⬜ Ожидание",
  task:         "⚙️ Выполняю задачу",
  going_home:   "🏠 Иду домой",
  depositing:   "📦 Сдаю ресурсы",
  resuming:     "▶️ Возобновляю",
};

const PHASE_COLOR: Record<string, string> = {
  idle:         "#555",
  task:         "#2ec4b6",
  going_home:   "#f39c12",
  depositing:   "#e67e22",
  resuming:     "#7ecc49",
};

interface AnarchyState {
  isRunning: boolean;
  task: string;
  homeCommand: string;
  phase: string;
  cycleCount: number;
  log: { msg: string; time: number }[];
}

export default function AnarchyTab() {
  const { bots, selectedBotId } = useAppStore();
  const bot = bots.find(b => b.id === selectedBotId) || bots[0] || null;

  const [task, setTask] = useState("Добывай дерево и камень для строительства");
  const [homeCmd, setHomeCmd] = useState("/home");
  const [cycleMin, setCycleMin] = useState(5);
  const [maxInv, setMaxInv] = useState(28);
  const [state, setState] = useState<AnarchyState | null>(null);
  const [log, setLog] = useState<{ msg: string; time: number }[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  // Подписываемся на события анархии
  useEffect(() => {
    if (!window.electronAPI) return;
    const unsubs = [
      window.electronAPI.on("bot:anarchyStarted", (data: any) => {
        if (data.botId !== bot?.id) return;
        setState(s => ({ ...s!, isRunning: true, phase: "task", cycleCount: 0 } as AnarchyState));
      }),
      window.electronAPI.on("bot:anarchyStopped", (data: any) => {
        if (data.botId !== bot?.id) return;
        setState(s => s ? { ...s, isRunning: false, phase: "idle" } : null);
      }),
      window.electronAPI.on("bot:anarchyPhase", (data: any) => {
        if (data.botId !== bot?.id) return;
        setState(s => s ? { ...s, phase: data.phase } : null);
      }),
      window.electronAPI.on("bot:anarchyLog", (data: any) => {
        if (data.botId !== bot?.id) return;
        setLog(prev => [...prev.slice(-99), { msg: data.msg, time: data.time }]);
        setState(s => s ? { ...s, cycleCount: s.cycleCount } : null);
      }),
    ];
    return () => { unsubs.forEach(fn => fn && fn()); };
  }, [bot?.id]);

  // Прокрутка лога
  useEffect(() => {
    logRef.current?.scrollTo({ top: 9999, behavior: "smooth" });
  }, [log]);

  // Загружаем состояние при смене бота
  useEffect(() => {
    if (!bot?.id || !window.electronAPI?.bot?.getAnarchyState) return;
    (window.electronAPI.bot as any).getAnarchyState(bot.id).then((s: AnarchyState) => {
      if (s) { setState(s); setLog(s.log || []); }
    }).catch(() => {});
  }, [bot?.id]);

  async function startAnarchy() {
    if (!bot?.id) return;
    await (window.electronAPI?.bot as any).startAnarchy(bot.id, {
      task, homeCommand: homeCmd, cycleMinutes: cycleMin, maxInventory: maxInv,
    });
  }

  async function stopAnarchy() {
    if (!bot?.id) return;
    await (window.electronAPI?.bot as any).stopAnarchy(bot.id);
  }

  const isRunning = state?.isRunning ?? false;
  const phase = state?.phase ?? "idle";
  const phaseColor = PHASE_COLOR[phase] ?? "#555";

  function fmtTime(ts: number) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b flex items-center justify-between"
        style={{ borderColor: "#1a3a3a", background: "#141f1f" }}>
        <span className="text-xs font-mono font-bold" style={{ color: "#e74c3c" }}>
          🏴‍☠️ Протокол Анархии
        </span>
        {isRunning && (
          <div className="flex items-center gap-2">
            <span style={{
              width: 8, height: 8, borderRadius: "50%",
              background: phaseColor, display: "inline-block",
              boxShadow: `0 0 6px ${phaseColor}`,
              animation: "pulse 1.5s ease-in-out infinite",
            }} />
            <span className="text-xs font-mono" style={{ color: phaseColor }}>
              {PHASE_LABELS[phase] ?? phase}
            </span>
            <span className="text-xs" style={{ color: "#555" }}>
              Цикл #{state?.cycleCount ?? 0}
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">

        {/* Bot selector */}
        {!bot && (
          <div className="panel p-3 text-center text-xs" style={{ color: "#555" }}>
            Выберите бота на вкладке "Боты"
          </div>
        )}

        {/* Config */}
        <div className="panel p-3" style={{ background: "#0f1a1a", border: "1px solid #1a3a3a" }}>
          <div className="text-xs font-mono mb-3" style={{ color: "#e74c3c" }}>
            ⚙️ Конфигурация
          </div>

          <div className="flex flex-col gap-2">
            <div>
              <label className="text-xs mb-1 block" style={{ color: "#888" }}>
                Задача (что делать бесконечно):
              </label>
              <textarea
                value={task}
                onChange={e => setTask(e.target.value)}
                disabled={isRunning}
                rows={3}
                className="w-full text-xs p-2 rounded"
                style={{
                  background: "#1a1a1a", border: "1px solid #1a3a3a",
                  color: isRunning ? "#555" : "#e8e8e8", resize: "vertical",
                  fontFamily: "monospace", outline: "none",
                }}
                placeholder="Например: Добывай железо и уголь, крафти инструменты"
              />
            </div>

            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs mb-1 block" style={{ color: "#888" }}>
                  Команда дома:
                </label>
                <input
                  type="text"
                  value={homeCmd}
                  onChange={e => setHomeCmd(e.target.value)}
                  disabled={isRunning}
                  className="w-full text-xs p-2 rounded"
                  style={{
                    background: "#1a1a1a", border: "1px solid #1a3a3a",
                    color: isRunning ? "#555" : "#e8e8e8", fontFamily: "monospace", outline: "none",
                  }}
                  placeholder="/home"
                />
              </div>
              <div style={{ width: 80 }}>
                <label className="text-xs mb-1 block" style={{ color: "#888" }}>
                  Цикл (мин):
                </label>
                <input
                  type="number"
                  value={cycleMin}
                  onChange={e => setCycleMin(Math.max(1, parseInt(e.target.value) || 5))}
                  disabled={isRunning}
                  min={1} max={60}
                  className="w-full text-xs p-2 rounded text-center"
                  style={{
                    background: "#1a1a1a", border: "1px solid #1a3a3a",
                    color: isRunning ? "#555" : "#e8e8e8", outline: "none",
                  }}
                />
              </div>
              <div style={{ width: 80 }}>
                <label className="text-xs mb-1 block" style={{ color: "#888" }}>
                  Макс. слотов:
                </label>
                <input
                  type="number"
                  value={maxInv}
                  onChange={e => setMaxInv(Math.max(10, parseInt(e.target.value) || 28))}
                  disabled={isRunning}
                  min={10} max={36}
                  className="w-full text-xs p-2 rounded text-center"
                  style={{
                    background: "#1a1a1a", border: "1px solid #1a3a3a",
                    color: isRunning ? "#555" : "#e8e8e8", outline: "none",
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Start/Stop */}
        <div className="flex gap-2">
          {!isRunning ? (
            <button
              onClick={startAnarchy}
              disabled={!bot || bot.status !== "online"}
              className="flex-1 py-2 text-sm font-mono font-bold rounded"
              style={{
                background: bot?.status === "online" ? "#7b1515" : "#2a2a2a",
                color: bot?.status === "online" ? "#ff5555" : "#555",
                border: "1px solid " + (bot?.status === "online" ? "#c0392b" : "#333"),
                cursor: bot?.status === "online" ? "pointer" : "default",
              }}
            >
              🏴‍☠️ ЗАПУСТИТЬ ПРОТОКОЛ АНАРХИИ
            </button>
          ) : (
            <button
              onClick={stopAnarchy}
              className="flex-1 py-2 text-sm font-mono font-bold rounded"
              style={{
                background: "#2a1a1a", color: "#e74c3c",
                border: "1px solid #7b1515", cursor: "pointer",
              }}
            >
              🛑 ОСТАНОВИТЬ
            </button>
          )}
        </div>

        {/* Status panel */}
        {isRunning && (
          <div className="panel p-3" style={{ background: "#0f1a0f", border: "1px solid #1a3a1a" }}>
            <div className="text-xs font-mono mb-2" style={{ color: "#7ecc49" }}>
              📊 Статус
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div style={{ color: "#888" }}>Фаза:</div>
              <div style={{ color: phaseColor, fontWeight: "bold" }}>{PHASE_LABELS[phase] ?? phase}</div>
              <div style={{ color: "#888" }}>Задача:</div>
              <div style={{ color: "#ccc" }} className="truncate">{state?.task}</div>
              <div style={{ color: "#888" }}>Циклов завершено:</div>
              <div style={{ color: "#2ec4b6" }}>{state?.cycleCount ?? 0}</div>
              <div style={{ color: "#888" }}>База:</div>
              <div style={{ color: "#f39c12", fontFamily: "monospace" }}>{state?.homeCommand}</div>
            </div>
          </div>
        )}

        {/* How it works */}
        <div className="panel p-3" style={{ border: "1px solid #1a1a1a" }}>
          <div className="text-xs font-mono mb-2" style={{ color: "#555" }}>ℹ️ Как работает</div>
          <div className="text-xs flex flex-col gap-1" style={{ color: "#444" }}>
            <div>⚙️ Выполняет задачу указанное число минут</div>
            <div>📦 При заполнении инвентаря или по таймеру → телепортируется домой</div>
            <div>🏠 На базе: сдаёт ресурсы в сундук, берёт еду</div>
            <div>🔄 Возвращается к задаче</div>
            <div>♾️ Повторяет бесконечно до остановки</div>
            <div style={{ color: "#333", marginTop: 4 }}>Инструменты, броня и оружие НЕ сдаются</div>
          </div>
        </div>

        {/* Log */}
        <div className="panel flex flex-col" style={{ minHeight: 120 }}>
          <div className="px-3 py-1.5 border-b text-xs font-mono" style={{ borderColor: "#2a2a2a", color: "#555" }}>
            📋 Журнал ({log.length})
          </div>
          <div
            ref={logRef}
            className="flex-1 overflow-y-auto p-2"
            style={{ maxHeight: 200, fontFamily: "monospace", fontSize: 10 }}
          >
            {log.length === 0 ? (
              <div className="text-center mt-4" style={{ color: "#333" }}>Журнал пуст</div>
            ) : (
              log.map((entry, i) => (
                <div key={i} className="mb-0.5">
                  <span style={{ color: "#3a3a3a" }}>[{fmtTime(entry.time)}] </span>
                  <span style={{ color: entry.msg.startsWith("⚠") ? "#e67e22" : entry.msg.startsWith("🛑") ? "#e74c3c" : "#7ecc49" }}>
                    {entry.msg}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
