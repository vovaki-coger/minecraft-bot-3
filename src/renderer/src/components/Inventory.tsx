import React, { useState } from "react";
import { BotState, InventoryItem } from "../store/appStore";

interface Props {
  bot: BotState;
}

// Конвертация имени предмета в URL иконки Minecraft Wiki
function getItemIconUrl(name: string): string {
  // Преобразуем oak_log → Oak_Log
  const formatted = name
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("_");
  return `https://minecraft.wiki/images/Invicon_${formatted}.png`;
}

// Эмодзи-фолбэк если картинка не загрузилась
function getItemEmoji(name: string): string {
  if (name.includes("log") || name.includes("wood")) return "🪵";
  if (name.includes("cobblestone") || name.includes("stone")) return "🪨";
  if (name.includes("iron")) return "⚙️";
  if (name.includes("gold")) return "🥇";
  if (name.includes("diamond")) return "💎";
  if (name.includes("coal")) return "🖤";
  if (name.includes("emerald")) return "💚";
  if (name.includes("lapis")) return "🔵";
  if (name.includes("redstone")) return "🔴";
  if (name.includes("sword")) return "⚔️";
  if (name.includes("pickaxe")) return "⛏️";
  if (name.includes("axe")) return "🪓";
  if (name.includes("shovel")) return "🪣";
  if (name.includes("bow")) return "🏹";
  if (name.includes("arrow")) return "→";
  if (name.includes("apple") || name.includes("bread") || name.includes("beef") || name.includes("food")) return "🍖";
  if (name.includes("torch")) return "🔦";
  if (name.includes("chest")) return "📦";
  if (name.includes("crafting_table")) return "🪚";
  if (name.includes("furnace")) return "🔥";
  if (name.includes("bucket")) return "🪣";
  if (name.includes("dirt") || name.includes("grass")) return "🟫";
  if (name.includes("sand")) return "🟡";
  if (name.includes("gravel")) return "⬜";
  if (name.includes("planks")) return "🪵";
  if (name.includes("seed") || name.includes("wheat")) return "🌾";
  if (name.includes("carrot")) return "🥕";
  if (name.includes("potato")) return "🥔";
  if (name.includes("bone")) return "🦴";
  if (name.includes("string")) return "〰️";
  if (name.includes("feather")) return "🪶";
  if (name.includes("slime")) return "🟩";
  if (name.includes("egg")) return "🥚";
  if (name.includes("book")) return "📖";
  if (name.includes("stick")) return "|";
  if (name.includes("glass")) return "🪟";
  if (name.includes("wool")) return "🟥";
  return "📦";
}

const TOTAL_SLOTS = 36;

function ItemSlot({ item, active }: { item: InventoryItem | null; active: boolean }) {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <div
      style={{
        width: 36,
        height: 36,
        background: active ? "#1a2a0a" : "#1a1a1a",
        border: `2px solid ${active ? "#7ecc49" : "#555"}`,
        borderBottomColor: active ? "#4a8c19" : "#333",
        borderRightColor: active ? "#4a8c19" : "#333",
        imageRendering: "pixelated",
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: item ? "pointer" : "default",
        flexShrink: 0,
        boxSizing: "border-box",
      }}
      title={item ? `${item.displayName || item.name} x${item.count}` : ""}
    >
      {item && (
        <>
          {!imgFailed ? (
            <img
              src={getItemIconUrl(item.name)}
              alt={item.name}
              width={28}
              height={28}
              style={{ imageRendering: "pixelated", display: "block" }}
              onError={() => setImgFailed(true)}
            />
          ) : (
            <span style={{ fontSize: 18, lineHeight: 1 }}>{getItemEmoji(item.name)}</span>
          )}
          {item.count > 1 && (
            <span
              style={{
                position: "absolute",
                bottom: 1,
                right: 2,
                fontSize: 9,
                color: "#fff",
                textShadow: "1px 1px 0 #000, -1px -1px 0 #000",
                fontWeight: "bold",
                fontFamily: "monospace",
                lineHeight: 1,
                pointerEvents: "none",
              }}
            >
              {item.count}
            </span>
          )}
        </>
      )}
    </div>
  );
}

export default function Inventory({ bot }: Props) {
  const { inventory, hotbarSlot } = bot.stats;

  // Создаём массив 36 слотов (9 столбцов × 3 строки + хотбар)
  const slots: (InventoryItem | null)[] = Array(TOTAL_SLOTS).fill(null);
  for (const item of inventory) {
    if (item.slot >= 9 && item.slot < 45) {
      slots[item.slot - 9] = item;
    }
  }

  const mainSlots = slots.slice(0, 27);   // 3 строки × 9
  const hotbarSlots = slots.slice(27, 36); // хотбар

  const totalItems = inventory.length;
  const totalCount = inventory.reduce((s, i) => s + i.count, 0);

  return (
    <div
      className="panel p-3"
      style={{ background: "#141414" }}
    >
      {/* Заголовок */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-mono" style={{ color: "#7ecc49" }}>
          🎒 Инвентарь
        </span>
        <span className="text-xs" style={{ color: "#555" }}>
          {totalItems} видов · {totalCount} шт
        </span>
      </div>

      {/* Сетка Minecraft-стиле */}
      <div
        style={{
          background: "#8B8B8B",
          padding: 4,
          borderRadius: 2,
          border: "2px solid #000",
          display: "inline-block",
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        {/* Основной инвентарь (3 строки) */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(9, 36px)",
            gap: 2,
            justifyContent: "center",
            marginBottom: 4,
          }}
        >
          {mainSlots.map((item, i) => (
            <ItemSlot key={i} item={item} active={false} />
          ))}
        </div>

        {/* Разделитель */}
        <div style={{ height: 2, background: "#555", margin: "4px 0" }} />

        {/* Хотбар */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(9, 36px)",
            gap: 2,
            justifyContent: "center",
          }}
        >
          {hotbarSlots.map((item, i) => (
            <ItemSlot key={i} item={item} active={i === hotbarSlot} />
          ))}
        </div>
      </div>

      {/* Пусто */}
      {totalItems === 0 && (
        <div className="text-center text-xs mt-2" style={{ color: "#555" }}>
          Инвентарь пуст
        </div>
      )}
    </div>
  );
}
