import React from "react";
import { BotState } from "../store/appStore";

interface Props {
  bot: BotState;
}

function StatBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="flex items-center gap-2 text-xs">
      <span style={{ color: "#888", width: 50, flexShrink: 0 }}>{label}</span>
      <div className="progress-bar flex-1">
        <div className="progress-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span style={{ color: "#e8e8e8", width: 40, textAlign: "right", flexShrink: 0 }}>
        {Math.round(value)}/{max}
      </span>
    </div>
  );
}

export default function BotStats({ bot }: Props) {
  const s = bot.stats;

  return (
    <div className="panel p-3 flex flex-col gap-2.5">
      <div className="text-xs font-mono mb-1" style={{ color: "#7ecc49" }}>📊 Статус</div>

      <StatBar label="❤️ HP" value={s.health} max={20} color="#e74c3c" />
      <StatBar label="🍗 Голод" value={s.food} max={20} color="#e67e22" />
      <StatBar label="🛡️ Броня" value={s.armor} max={20} color="#95a5a6" />
      <StatBar label="⭐ Опыт" value={s.experience} max={Math.max(s.experience, 10)} color="#f1c40f" />

      <div className="flex gap-3 text-xs mt-1 pt-2 border-t" style={{ borderColor: "#3a3a3a" }}>
        <div>
          <span style={{ color: "#888" }}>X: </span>
          <span style={{ color: "#7fb3d3" }}>{s.x}</span>
        </div>
        <div>
          <span style={{ color: "#888" }}>Y: </span>
          <span style={{ color: "#7fb3d3" }}>{s.y}</span>
        </div>
        <div>
          <span style={{ color: "#888" }}>Z: </span>
          <span style={{ color: "#7fb3d3" }}>{s.z}</span>
        </div>
        <div>
          <span style={{ color: "#888" }}>Биом: </span>
          <span style={{ color: "#7fb3d3" }}>{s.biome}</span>
        </div>
      </div>
    </div>
  );
}
