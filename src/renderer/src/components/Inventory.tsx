import React, { useState } from "react";
import { BotState, InventoryItem } from "../store/appStore";

interface Props { bot: BotState; }

function getItemIconUrl(name: string): string {
  const formatted = name.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("_");
  return `https://minecraft.wiki/images/Invicon_${formatted}.png`;
}

type Category = "all" | "weapons" | "tools" | "armor" | "food" | "blocks" | "misc";

function getCategory(name: string): Category {
  if (/sword|bow|crossbow|axe(?!_)|trident|mace/.test(name)) return "weapons";
  if (/pickaxe|shovel|hoe|fishing_rod|flint_and_steel|shears/.test(name)) return "tools";
  if (/helmet|chestplate|leggings|boots|shield/.test(name)) return "armor";
  if (/apple|bread|beef|pork|chicken|mutton|salmon|cod|carrot|potato|melon|golden|cookie|cake|rabbit|stew|soup|pie|berry|food/.test(name)) return "food";
  if (/log|wood|planks|stone|cobble|dirt|sand|gravel|glass|brick|concrete|wool|terracotta|ore|coal|iron|gold|diamond|emerald|quartz|obsidian|netherrack|soul/.test(name)) return "blocks";
  return "misc";
}

const CATEGORY_COLOR: Record<Category, string> = {
  all: "#7ecc49",
  weapons: "#e74c3c",
  tools: "#f39c12",
  armor: "#3498db",
  food: "#e67e22",
  blocks: "#95a5a6",
  misc: "#9b59b6",
};

const CATEGORY_LABEL: Record<Category, string> = {
  all: "Всё",
  weapons: "⚔ Оружие",
  tools: "⛏ Инструменты",
  armor: "🛡 Броня",
  food: "🍖 Еда",
  blocks: "🧱 Блоки",
  misc: "📦 Прочее",
};

function getItemEmoji(name: string): string {
  if (/log|wood/.test(name)) return "🪵";
  if (/cobblestone|stone/.test(name)) return "🪨";
  if (/iron/.test(name)) return "⚙️";
  if (/gold/.test(name)) return "🥇";
  if (/diamond/.test(name)) return "💎";
  if (/coal/.test(name)) return "🖤";
  if (/emerald/.test(name)) return "💚";
  if (/sword/.test(name)) return "⚔️";
  if (/pickaxe/.test(name)) return "⛏️";
  if (/axe/.test(name)) return "🪓";
  if (/shovel/.test(name)) return "🪣";
  if (/bow/.test(name)) return "🏹";
  if (/helmet|chestplate|leggings|boots/.test(name)) return "🛡️";
  if (/apple|bread|beef|pork|chicken|food|cookie/.test(name)) return "🍖";
  if (/torch/.test(name)) return "🔦";
  if (/chest/.test(name)) return "📦";
  if (/crafting_table/.test(name)) return "🪚";
  if (/furnace/.test(name)) return "🔥";
  if (/planks/.test(name)) return "🪵";
  if (/wheat|seed/.test(name)) return "🌾";
  if (/carrot/.test(name)) return "🥕";
  if (/bone/.test(name)) return "🦴";
  if (/arrow/.test(name)) return "→";
  return "📦";
}

function getDurabilityColor(pct: number): string {
  if (pct > 0.6) return "#7ecc49";
  if (pct > 0.3) return "#f39c12";
  return "#e74c3c";
}

function ItemSlot({ item, active, highlight }: { item: InventoryItem | null; active: boolean; highlight: boolean }) {
  const [imgFailed, setImgFailed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const cat = item ? getCategory(item.name) : "misc";
  const catColor = item ? CATEGORY_COLOR[cat] : "#555";
  const hasDurability = item && item.durabilityUsed !== undefined && item.maxDurability !== undefined && item.maxDurability > 0;
  const durPct = hasDurability ? 1 - (item!.durabilityUsed! / item!.maxDurability!) : 1;
  const borderColor = active ? "#7ecc49" : highlight ? catColor : "#555";

  return (
    <div
      style={{ position: "relative", display: "inline-block" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        style={{
          width: 38, height: 38,
          background: active ? "#1e2e0f" : highlight ? `${catColor}18` : "#1a1a1a",
          border: `2px solid ${borderColor}`,
          borderBottomColor: active ? "#4a8c19" : highlight ? catColor : "#333",
          borderRightColor: active ? "#4a8c19" : highlight ? catColor : "#333",
          imageRendering: "pixelated",
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          boxSizing: "border-box",
          transition: "border-color 0.1s",
        }}
      >
        {item && (
          <>
            {!imgFailed ? (
              <img
                src={getItemIconUrl(item.name)}
                alt={item.name}
                width={28} height={28}
                style={{ imageRendering: "pixelated", display: "block" }}
                onError={() => setImgFailed(true)}
              />
            ) : (
              <span style={{ fontSize: 18, lineHeight: 1 }}>{getItemEmoji(item.name)}</span>
            )}
            {item.count > 1 && (
              <span style={{
                position: "absolute", bottom: 1, right: 2,
                fontSize: 9, color: "#fff",
                textShadow: "1px 1px 0 #000, -1px -1px 0 #000",
                fontWeight: "bold", fontFamily: "monospace",
                lineHeight: 1, pointerEvents: "none",
              }}>{item.count}</span>
            )}
            {hasDurability && (
              <div style={{
                position: "absolute", bottom: 0, left: 1, right: 1, height: 2,
                background: "#111", borderRadius: 1,
              }}>
                <div style={{
                  width: `${Math.round(durPct * 100)}%`, height: "100%",
                  background: getDurabilityColor(durPct), borderRadius: 1,
                }} />
              </div>
            )}
          </>
        )}
      </div>

      {/* Tooltip */}
      {hovered && item && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 4px)", left: "50%",
          transform: "translateX(-50%)", zIndex: 100,
          background: "#1a1a2e", border: `1px solid ${catColor}`,
          borderRadius: 4, padding: "5px 8px",
          pointerEvents: "none", whiteSpace: "nowrap",
          boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
          minWidth: 120,
        }}>
          <div style={{ color: catColor, fontSize: 11, fontWeight: "bold", fontFamily: "monospace" }}>
            {(item.displayName || item.name).replace(/_/g, " ")}
          </div>
          <div style={{ color: "#888", fontSize: 10, marginTop: 2 }}>
            Количество: <span style={{ color: "#ccc" }}>{item.count}</span>
          </div>
          {hasDurability && (
            <div style={{ color: "#888", fontSize: 10 }}>
              Прочность: <span style={{ color: getDurabilityColor(durPct) }}>{Math.round(durPct * 100)}%</span>
            </div>
          )}
          <div style={{ color: "#555", fontSize: 9, marginTop: 2 }}>
            {CATEGORY_LABEL[cat]}
          </div>
        </div>
      )}
    </div>
  );
}

const CATEGORIES: Category[] = ["all", "weapons", "tools", "armor", "food", "blocks", "misc"];

export default function Inventory({ bot }: Props) {
  const [activeCategory, setActiveCategory] = useState<Category>("all");
  const { inventory, hotbarSlot } = bot.stats;

  const slots: (InventoryItem | null)[] = Array(36).fill(null);
  for (const item of inventory) {
    if (item.slot >= 9 && item.slot < 45) slots[item.slot - 9] = item;
  }
  const mainSlots = slots.slice(0, 27);
  const hotbarSlots = slots.slice(27, 36);

  const totalItems = inventory.length;
  const totalCount = inventory.reduce((s, i) => s + i.count, 0);
  const weightPct = Math.round((totalItems / 36) * 100);

  const shouldHighlight = (item: InventoryItem | null) =>
    activeCategory === "all" || (item !== null && getCategory(item.name) === activeCategory);

  const categoryCounts: Partial<Record<Category, number>> = {};
  for (const item of inventory) {
    const c = getCategory(item.name);
    categoryCounts[c] = (categoryCounts[c] || 0) + 1;
  }

  return (
    <div style={{ background: "#141414", borderRadius: 4, padding: "10px 10px 8px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ color: "#7ecc49", fontSize: 12, fontFamily: "monospace", fontWeight: "bold" }}>
          🎒 Инвентарь
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#555", fontSize: 10 }}>{totalCount} шт</span>
          <div style={{ width: 60, height: 4, background: "#2a2a2a", borderRadius: 2 }}>
            <div style={{
              width: `${weightPct}%`, height: "100%",
              background: weightPct > 80 ? "#e74c3c" : "#7ecc49", borderRadius: 2,
              transition: "width 0.3s",
            }} />
          </div>
          <span style={{ color: "#555", fontSize: 10 }}>{totalItems}/36</span>
        </div>
      </div>

      {/* Category filter tabs */}
      <div style={{ display: "flex", gap: 3, marginBottom: 8, flexWrap: "wrap" }}>
        {CATEGORIES.filter(c => c === "all" || (categoryCounts[c] || 0) > 0).map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            style={{
              background: activeCategory === cat ? CATEGORY_COLOR[cat] + "33" : "transparent",
              border: `1px solid ${activeCategory === cat ? CATEGORY_COLOR[cat] : "#333"}`,
              borderRadius: 3, padding: "2px 6px",
              color: activeCategory === cat ? CATEGORY_COLOR[cat] : "#555",
              fontSize: 9, fontFamily: "monospace", cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            {cat === "all" ? `Всё (${totalItems})` : `${CATEGORY_LABEL[cat].split(" ")[0]} ${categoryCounts[cat] || 0}`}
          </button>
        ))}
      </div>

      {/* Inventory Grid */}
      <div style={{
        background: "#8B8B8B", padding: 4, borderRadius: 2,
        border: "2px solid #000", display: "inline-block",
        width: "100%", boxSizing: "border-box",
      }}>
        {/* Main 3 rows */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(9, 38px)",
          gap: 2, justifyContent: "center", marginBottom: 4,
        }}>
          {mainSlots.map((item, i) => (
            <ItemSlot key={i} item={item} active={false} highlight={shouldHighlight(item)} />
          ))}
        </div>
        <div style={{ height: 2, background: "#555", margin: "4px 0" }} />
        {/* Hotbar */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(9, 38px)", gap: 2, justifyContent: "center" }}>
          {hotbarSlots.map((item, i) => (
            <ItemSlot key={i} item={item} active={i === hotbarSlot} highlight={shouldHighlight(item)} />
          ))}
        </div>
      </div>

      {/* Legend */}
      {activeCategory === "all" && totalItems > 0 && (
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          {(Object.keys(categoryCounts) as Category[]).map(cat => (
            <div key={cat} style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <div style={{ width: 6, height: 6, background: CATEGORY_COLOR[cat], borderRadius: 1 }} />
              <span style={{ color: "#555", fontSize: 9 }}>{CATEGORY_LABEL[cat].replace(/[⚔⛏🛡🍖🧱📦] /, "")} {categoryCounts[cat]}</span>
            </div>
          ))}
        </div>
      )}

      {totalItems === 0 && (
        <div style={{ textAlign: "center", color: "#555", fontSize: 11, marginTop: 8 }}>
          Инвентарь пуст
        </div>
      )}
    </div>
  );
}
