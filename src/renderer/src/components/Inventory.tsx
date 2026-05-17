import React from "react";
import { BotState, InventoryItem } from "../store/appStore";

interface Props {
  bot: BotState;
}

const ITEM_COLORS: Record<string, string> = {
  log: "#8B6914",
  wood: "#8B6914",
  planks: "#c8a84b",
  stone: "#888",
  cobblestone: "#777",
  dirt: "#8B6914",
  sand: "#e4d5a0",
  gravel: "#888",
  iron_ore: "#c87137",
  iron_ingot: "#c0c0c0",
  gold_ore: "#ffd700",
  gold_ingot: "#ffd700",
  diamond: "#5cdce8",
  coal: "#333",
  sword: "#c0c0c0",
  pickaxe: "#c0c0c0",
  axe: "#c0c0c0",
  shovel: "#c0c0c0",
  hoe: "#c0c0c0",
  apple: "#e74c3c",
  bread: "#d4a843",
  beef: "#c0392b",
  porkchop: "#e67e22",
  chicken: "#e8e8e8",
  crafting_table: "#8B6914",
  furnace: "#888",
  chest: "#c8a84b",
  torch: "#f1c40f",
  ladder: "#c8a84b",
  default: "#7ecc49",
};

function getItemColor(name: string): string {
  for (const [key, color] of Object.entries(ITEM_COLORS)) {
    if (name.includes(key)) return color;
  }
  return ITEM_COLORS.default;
}

function getItemEmoji(name: string): string {
  if (name.includes("log") || name.includes("wood")) return "🪵";
  if (name.includes("stone") || name.includes("cobblestone")) return "🪨";
  if (name.includes("iron")) return "⚙️";
  if (name.includes("gold")) return "🥇";
  if (name.includes("diamond")) return "💎";
  if (name.includes("coal")) return "🖤";
  if (name.includes("sword")) return "⚔️";
  if (name.includes("pickaxe")) return "⛏️";
  if (name.includes("axe")) return "🪓";
  if (name.includes("food") || name.includes("apple") || name.includes("bread") || name.includes("beef")) return "🍖";
  if (name.includes("bow")) return "🏹";
  if (name.includes("arrow")) return "➹";
  if (name.includes("torch")) return "🔦";
  if (name.includes("crafting_table")) return "🪚";
  return "📦";
}

const TOTAL_SLOTS = 36;

export default function Inventory({ bot }: Props) {
  const { inventory, hotbarSlot } = bot.stats;

  const slots: (InventoryItem | null)[] = Array(TOTAL_SLOTS).fill(null);
  for (const item of inventory) {
    if (item.slot >= 9 && item.slot < 45) {
      slots[item.slot - 9] = item;
    }
  }

  const mainSlots = slots.slice(0, 27);
  const hotbarSlots = slots.slice(27, 36);

  return (
    <div className="panel p-3">
      <div className="text-xs font-mono mb-2" style={{ color: "#7ecc49" }}>🎒 Инвентарь</div>

      <div className="flex flex-col gap-1">
        <div className="grid grid-cols-9 gap-0.5">
          {mainSlots.map((item, i) => (
            <Slot key={i} item={item} active={false} />
          ))}
        </div>

        <div className="h-px my-1" style={{ background: "#3a3a3a" }} />

        <div className="grid grid-cols-9 gap-0.5">
          {hotbarSlots.map((item, i) => (
            <Slot key={i} item={item} active={i === hotbarSlot} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Slot({ item, active }: { item: InventoryItem | null; active: boolean }) {
  return (
    <div
      className="mc-slot"
      style={{
        width: 36,
        height: 36,
        borderColor: active ? "#7ecc49" : "#555",
        background: active ? "#1a2a0a" : "#1a1a1a",
        fontSize: 9,
        position: "relative",
        overflow: "hidden",
      }}
      title={item ? `${item.displayName || item.name} x${item.count}` : ""}
    >
      {item && (
        <>
          <span style={{ fontSize: 16, lineHeight: 1 }}>{getItemEmoji(item.name)}</span>
          {item.count > 1 && (
            <span
              style={{
                position: "absolute",
                bottom: 1,
                right: 2,
                fontSize: 9,
                color: "#fff",
                textShadow: "1px 1px 0 #000",
                fontWeight: "bold",
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
