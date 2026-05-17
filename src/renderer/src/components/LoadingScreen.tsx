import React, { useEffect, useState } from "react";

const LOADING_TIPS = [
  "Совет: Andy-4 — лучшая модель для Minecraft",
  "Совет: В режиме выживальщика бот сам ищет ресурсы",
  "Совет: Можно запускать несколько ботов одновременно",
  "Совет: Включи автоответ, чтобы бот отвечал игрокам",
  "Совет: Для лучшей скорости используй Micro-версию модели",
];

export default function LoadingScreen() {
  const [progress, setProgress] = useState(0);
  const [tip, setTip] = useState(LOADING_TIPS[0]);
  const [dots, setDots] = useState("");

  useEffect(() => {
    const tipIdx = Math.floor(Math.random() * LOADING_TIPS.length);
    setTip(LOADING_TIPS[tipIdx]);

    const progressInterval = setInterval(() => {
      setProgress((p) => {
        if (p >= 95) return p;
        return p + Math.random() * 8;
      });
    }, 200);

    const dotsInterval = setInterval(() => {
      setDots((d) => (d.length >= 3 ? "" : d + "."));
    }, 500);

    return () => {
      clearInterval(progressInterval);
      clearInterval(dotsInterval);
    };
  }, []);

  return (
    <div
      className="flex flex-col items-center justify-center w-full h-full"
      style={{ background: "#0d0d0d" }}
    >
      <div className="text-center" style={{ width: 320 }}>
        <div style={{ fontSize: 52, marginBottom: 16 }}>⛏️</div>

        <h1 className="text-2xl font-mono mb-1" style={{ color: "#7ecc49" }}>
          Призмарин Бот
        </h1>
        <p className="text-xs mb-6" style={{ color: "#555" }}>
          Minecraft AI Bot v2.0
        </p>

        <div
          style={{
            background: "#1a1a1a",
            border: "1px solid #2a2a2a",
            borderRadius: 4,
            height: 12,
            overflow: "hidden",
            marginBottom: 8,
          }}
        >
          <div
            style={{
              height: "100%",
              background: "linear-gradient(90deg, #3a6a20, #7ecc49)",
              width: `${progress}%`,
              transition: "width 0.2s ease",
              borderRadius: 4,
            }}
          />
        </div>

        <div className="flex justify-between text-xs mb-6" style={{ color: "#555" }}>
          <span>Инициализация{dots}</span>
          <span>{Math.min(Math.round(progress), 100)}%</span>
        </div>

        <div
          className="text-xs p-2 rounded text-left"
          style={{ background: "#111", border: "1px solid #2a2a2a", color: "#666" }}
        >
          {tip}
        </div>
      </div>
    </div>
  );
}
