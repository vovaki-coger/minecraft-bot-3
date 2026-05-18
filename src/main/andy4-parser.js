/**
 * Andy-4 Parser & Executor — ПОЛНАЯ реализация всех команд
 * 
 * Поддерживает все команды из Mindcraft/Andy-4:
 *   Движение: !goToPlayer !followPlayer !goToCoordinates !searchForBlock !searchForEntity !moveAway !goToSurface
 *   Память:   !rememberHere !goToRememberedPlace
 *   Инвентарь: !consume !equip !discard !givePlayer
 *   Блоки:    !collectBlocks !placeHere !digDown
 *   Крафт:    !craftRecipe (все рецепты через mineflayer API)
 *   Плавка:   !smeltItem !clearFurnace
 *   Сундуки:  !putInChest !takeFromChest !viewChest
 *   Бой:      !attack !attackPlayer
 *   Отдых:    !goToBed !stay
 *   Инфо:     !stats !inventory !nearbyBlocks !craftable !entities
 *   Прочее:   !stop !lookAtPlayer !lookAtPosition !useOn
 *   Торговля: !showVillagerTrades !tradeWithVillager
 */

const { goals, Movements } = require("mineflayer-pathfinder");
const Vec3 = require("vec3");
const log = require("electron-log");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ══════════════════════════════════════════════════════════════
// ВРАЖДЕБНЫЕ МОБЫ
// ══════════════════════════════════════════════════════════════

const HOSTILE_MOBS = new Set([
  "zombie","skeleton","creeper","spider","enderman","witch","blaze","ghast",
  "slime","magma_cube","husk","stray","drowned","pillager","vindicator",
  "ravager","phantom","silverfish","cave_spider","wither_skeleton","piglin_brute",
  "zombified_piglin","hoglin","zoglin","vex","evoker","illusioner","guardian",
  "elder_guardian","shulker","endermite","chicken_jockey","spider_jockey",
  "warden","breeze","bogged","creaking",
]);

// ══════════════════════════════════════════════════════════════
// РЕЦЕПТЫ КРАФТА — все ключевые рецепты для выживания
// (используется как справочник; реальный крафт идёт через mineflayer API)
// ══════════════════════════════════════════════════════════════

const SMELTABLE = {
  // руды → слитки
  "iron_ore":         { output: "iron_ingot",     fuel: 8 },
  "raw_iron":         { output: "iron_ingot",     fuel: 8 },
  "gold_ore":         { output: "gold_ingot",     fuel: 8 },
  "raw_gold":         { output: "gold_ingot",     fuel: 8 },
  "copper_ore":       { output: "copper_ingot",   fuel: 8 },
  "raw_copper":       { output: "copper_ingot",   fuel: 8 },
  "ancient_debris":   { output: "netherite_scrap",fuel: 8 },
  // еда
  "porkchop":         { output: "cooked_porkchop",fuel: 10 },
  "beef":             { output: "cooked_beef",    fuel: 10 },
  "chicken":          { output: "cooked_chicken", fuel: 10 },
  "mutton":           { output: "cooked_mutton",  fuel: 10 },
  "rabbit":           { output: "cooked_rabbit",  fuel: 10 },
  "salmon":           { output: "cooked_salmon",  fuel: 10 },
  "cod":              { output: "cooked_cod",     fuel: 10 },
  "potato":           { output: "baked_potato",   fuel: 10 },
  // другое
  "sand":             { output: "glass",          fuel: 8 },
  "cobblestone":      { output: "stone",          fuel: 8 },
  "stone":            { output: "smooth_stone",   fuel: 8 },
  "clay_ball":        { output: "brick",          fuel: 10 },
  "netherrack":       { output: "nether_brick",   fuel: 8 },
  "cactus":           { output: "green_dye",      fuel: 8 },
  "kelp":             { output: "dried_kelp",     fuel: 8 },
  "wood":             { output: "charcoal",       fuel: 8 },
  "log":              { output: "charcoal",       fuel: 8 },
};

// Хорошее топливо в порядке приоритета
const FUEL_PRIORITY = [
  "coal","charcoal","coal_block","blaze_rod","dried_kelp_block",
  "oak_planks","spruce_planks","birch_planks","jungle_planks","acacia_planks","dark_oak_planks",
  "oak_log","spruce_log","birch_log","jungle_log","acacia_log","dark_oak_log",
  "stick","bamboo",
];

// ══════════════════════════════════════════════════════════════
// ОБРЕЗКА THINK-БЛОКОВ
// ══════════════════════════════════════════════════════════════

function stripThinkBlocks(text) {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*/gi, "")
    .trim();
}

// ══════════════════════════════════════════════════════════════
// ПАРСИНГ АРГУМЕНТОВ И КОМАНД
// ══════════════════════════════════════════════════════════════

function parseArgs(raw) {
  if (!raw || !raw.trim()) return [];
  const args = [];
  // Поддержка: "string", 'string', number, boolean
  const re = /"([^"]*)"|'([^']*)'|(true|false)|(-?\d+\.?\d*)/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    if (m[1] !== undefined) args.push(m[1]);
    else if (m[2] !== undefined) args.push(m[2]);
    else if (m[3] !== undefined) args.push(m[3] === "true");
    else args.push(parseFloat(m[4]));
  }
  return args;
}

function parseAndy4Response(text) {
  let cleaned = stripThinkBlocks(text);
  const commands = [];

  // Паттерн: !commandName(...) или !commandName без скобок
  const cmdPattern = /!(\w+)(?:\(([^)]*)\))?/g;
  for (const m of cleaned.matchAll(cmdPattern)) {
    const name = "!" + m[1];
    const args = parseArgs(m[2] || "");
    commands.push({ name, args, raw: m[0] });
    cleaned = cleaned.replace(m[0], " ");
  }

  // Убираем служебный мусор из текста
  let chatText = cleaned
    .replace(/\*[^*]*\*/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/^(Sure[,!.]?|Alright[,!.]?|Okay[,!.]?|OK[,!.]?)\s*/i, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 100);

  return { chatText, commands };
}

// ══════════════════════════════════════════════════════════════
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ══════════════════════════════════════════════════════════════

function findPlayer(bot, name) {
  if (!name) {
    return Object.values(bot.entities).find(e =>
      e.type === "player" && e.username !== bot.username
    ) || null;
  }
  return Object.values(bot.entities).find(e =>
    e.type === "player" &&
    e.username !== bot.username &&
    e.username?.toLowerCase().includes(name.toLowerCase())
  ) || null;
}

function findEntity(bot, type) {
  const t = (type || "").toLowerCase();
  return Object.values(bot.entities).find(e =>
    e !== bot.entity &&
    e?.position &&
    (
      (e.mobType || e.name || e.type || "").toLowerCase().includes(t) ||
      (e.username || "").toLowerCase().includes(t)
    )
  ) || null;
}

function findNearestHostile(bot, maxDist = 16) {
  const pos = bot.entity.position;
  return Object.values(bot.entities)
    .filter(e => e !== bot.entity && e?.position && HOSTILE_MOBS.has(e.mobType || e.name || ""))
    .map(e => ({ e, d: e.position.distanceTo(pos) }))
    .filter(x => x.d < maxDist)
    .sort((a, b) => a.d - b.d)
    [0]?.e || null;
}

function getInventoryItem(bot, name) {
  if (!name) return null;
  const n = name.toLowerCase().replace(/ /g, "_");
  return bot.inventory.items().find(i =>
    i.name === n || i.name.includes(n) || (i.displayName || "").toLowerCase().includes(n)
  ) || null;
}

function getBestFood(bot) {
  return bot.inventory.items()
    .filter(i => i.foodPoints > 0)
    .sort((a, b) => b.foodPoints - a.foodPoints)[0] || null;
}

function getBestFuel(bot) {
  for (const fuel of FUEL_PRIORITY) {
    const item = bot.inventory.items().find(i => i.name === fuel);
    if (item) return item;
  }
  return null;
}

function getBestWeapon(bot) {
  const weapons = bot.inventory.items().filter(i =>
    /sword|axe/.test(i.name) && !i.name.includes("pickaxe")
  );
  if (weapons.length === 0) return null;
  const mat = { netherite:5, diamond:4, iron:3, stone:2, gold:1, wooden:0 };
  weapons.sort((a, b) => {
    const aM = Object.keys(mat).find(m => a.name.includes(m)) || "";
    const bM = Object.keys(mat).find(m => b.name.includes(m)) || "";
    return (mat[bM] || 0) - (mat[aM] || 0);
  });
  return weapons[0];
}

async function equipBestWeapon(bot) {
  const weapon = getBestWeapon(bot);
  if (weapon) {
    try { await bot.equip(weapon, "hand"); } catch {}
  }
}

async function equipBestArmor(bot) {
  const slots = { head: "helmet", torso: "chestplate", legs: "leggings", feet: "boots" };
  const matOrder = ["netherite","diamond","iron","golden","chainmail","leather"];
  for (const [slot, suffix] of Object.entries(slots)) {
    const current = bot.inventory.slots[{ head:5, torso:6, legs:7, feet:8 }[slot]];
    for (const mat of matOrder) {
      const item = bot.inventory.items().find(i => i.name === `${mat}_${suffix}`);
      if (item) {
        try { await bot.equip(item, slot); } catch {}
        break;
      }
    }
  }
}

async function gotoPosition(bot, x, y, z, closeness = 1) {
  await bot.pathfinder.goto(
    new goals.GoalNear(Math.round(x), Math.round(y ?? bot.entity.position.y), Math.round(z), Math.max(1, closeness))
  );
}

async function findAndGoToBlock(bot, blockName, maxDist = 64) {
  const block = bot.findBlock({
    matching: b => b.name === blockName,
    maxDistance: maxDist,
  });
  if (!block) return null;
  await bot.pathfinder.goto(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 2));
  return block;
}

// ══════════════════════════════════════════════════════════════
// КРАФТИНГ — умный крафт через mineflayer API
// ══════════════════════════════════════════════════════════════

async function craftItem(bot, itemName, count = 1) {
  const mcData = require("minecraft-data")(bot.version);
  const normalizedName = itemName.toLowerCase().replace(/ /g, "_");

  // Находим item по имени
  const item = mcData.itemsByName[normalizedName];
  if (!item) {
    // Пробуем частичное совпадение
    const candidates = Object.values(mcData.itemsByName)
      .filter(i => i.name.includes(normalizedName));
    if (candidates.length === 0) return { success: false, msg: `Предмет '${itemName}' не найден` };
    return craftItem(bot, candidates[0].name, count);
  }

  // Проверяем рецепты без верстака
  let recipes = bot.recipesFor(item.id, null, 1, null);
  let craftingTable = null;

  if (!recipes || recipes.length === 0) {
    // Нужен верстак
    recipes = bot.recipesFor(item.id, null, 1, true);
    if (!recipes || recipes.length === 0) {
      return { success: false, msg: `Нет рецепта для '${itemName}' или не хватает ресурсов` };
    }

    // Ищем верстак поблизости
    craftingTable = bot.findBlock({ matching: mcData.blocksByName["crafting_table"]?.id, maxDistance: 16 });

    if (!craftingTable) {
      // Пробуем поставить свой верстак
      const tableItem = getInventoryItem(bot, "crafting_table");
      if (!tableItem) {
        return { success: false, msg: "Нужен верстак для крафта '" + itemName + "', но его нет в инвентаре" };
      }
      const pos = bot.entity.position.offset(1, 0, 0);
      try {
        const refBlock = bot.blockAt(pos.offset(0, -1, 0));
        if (refBlock) {
          await bot.equip(tableItem, "hand");
          await bot.placeBlock(refBlock, new Vec3(0, 1, 0));
          await sleep(500);
          craftingTable = bot.findBlock({ matching: mcData.blocksByName["crafting_table"]?.id, maxDistance: 8 });
        }
      } catch {}
    }

    if (craftingTable) {
      await bot.pathfinder.goto(new goals.GoalNear(craftingTable.position.x, craftingTable.position.y, craftingTable.position.z, 2));
      recipes = bot.recipesFor(item.id, null, 1, craftingTable);
    }
  }

  if (!recipes || recipes.length === 0) {
    return { success: false, msg: `Не удалось найти рецепт для '${itemName}'` };
  }

  try {
    await bot.craft(recipes[0], count, craftingTable);
    return { success: true, msg: `Скрафтил ${count}x ${itemName}` };
  } catch (err) {
    return { success: false, msg: `Ошибка крафта: ${err.message}` };
  }
}

// ══════════════════════════════════════════════════════════════
// ПЛАВКА — умная плавка через mineflayer furnace API
// ══════════════════════════════════════════════════════════════

async function smeltItem(bot, itemName, count = 1) {
  const mcData = require("minecraft-data")(bot.version);
  const normalizedName = itemName.toLowerCase().replace(/ /g, "_");

  // Находим предмет в инвентаре
  const inputItem = getInventoryItem(bot, normalizedName);
  if (!inputItem) {
    return { success: false, msg: `'${itemName}' не найден в инвентаре` };
  }

  const actualCount = Math.min(count, inputItem.count);

  // Ищем или ставим печку
  let furnaceBlock = bot.findBlock({
    matching: b => b.name === "furnace",
    maxDistance: 32,
  });

  if (!furnaceBlock) {
    const furnaceItem = getInventoryItem(bot, "furnace");
    if (!furnaceItem) {
      // Нет печки — пробуем скрафтить
      const craftResult = await craftItem(bot, "furnace", 1);
      if (!craftResult.success) {
        return { success: false, msg: "Нет печки и не удалось скрафтить" };
      }
    }
    // Ставим печку
    const refBlock = bot.blockAt(bot.entity.position.offset(1, -1, 0));
    if (refBlock) {
      try {
        const fi = getInventoryItem(bot, "furnace");
        if (fi) {
          await bot.equip(fi, "hand");
          await bot.placeBlock(refBlock, new Vec3(0, 1, 0));
          await sleep(600);
          furnaceBlock = bot.findBlock({ matching: b => b.name === "furnace", maxDistance: 8 });
        }
      } catch {}
    }
  }

  if (!furnaceBlock) {
    return { success: false, msg: "Не удалось найти или поставить печку" };
  }

  // Подходим к печке
  await bot.pathfinder.goto(new goals.GoalNear(
    furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z, 2
  ));

  try {
    const furnace = await bot.openFurnace(furnaceBlock);
    await sleep(300);

    // Кладём топливо
    const fuel = getBestFuel(bot);
    if (!fuel) {
      await bot.closeWindow(furnace);
      return { success: false, msg: "Нет топлива для плавки" };
    }
    await furnace.putFuel(fuel.type, null, Math.min(actualCount + 2, fuel.count));
    await sleep(200);

    // Кладём предмет
    await furnace.putInput(inputItem.type, null, actualCount);

    // Ждём результат (каждый предмет ~10 сек, ждём максимум 90 сек)
    const waitTime = Math.min(actualCount * 10500, 90000);
    await sleep(waitTime);

    // Берём результат
    if (furnace.outputItem()) {
      await furnace.takeOutput();
    }

    await bot.closeWindow(furnace);
    return { success: true, msg: `Переплавил ${actualCount}x ${itemName}` };
  } catch (err) {
    return { success: false, msg: `Ошибка плавки: ${err.message}` };
  }
}

// ══════════════════════════════════════════════════════════════
// СУНДУКИ
// ══════════════════════════════════════════════════════════════

async function openNearestChest(bot) {
  const mcData = require("minecraft-data")(bot.version);
  const chestIds = [
    mcData.blocksByName["chest"]?.id,
    mcData.blocksByName["trapped_chest"]?.id,
    mcData.blocksByName["barrel"]?.id,
  ].filter(Boolean);

  const chestBlock = bot.findBlock({
    matching: b => chestIds.includes(b.type),
    maxDistance: 16,
  });
  if (!chestBlock) return null;

  await bot.pathfinder.goto(new goals.GoalNear(
    chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 2
  ));
  const chest = await bot.openContainer(chestBlock);
  return chest;
}

// ══════════════════════════════════════════════════════════════
// КОМАНДЫ ИНФОРМАЦИИ (queries)
// ══════════════════════════════════════════════════════════════

function cmdStats(bot) {
  const pos = bot.entity.position;
  const time = bot.time?.timeOfDay ?? 0;
  const timeStr = time < 6000 ? "Утро" : time < 12000 ? "День" : time < 18000 ? "Вечер" : "Ночь";
  const weather = bot.isRaining ? "Дождь" : "Ясно";
  const items = (bot.inventory?.items() || []);
  const nearby = Object.values(bot.entities || {})
    .filter(e => e !== bot.entity && e?.position && e.position.distanceTo(pos) < 20)
    .length;

  return [
    `📊 СТАТУС`,
    `Позиция: x=${Math.round(pos.x)} y=${Math.round(pos.y)} z=${Math.round(pos.z)}`,
    `Здоровье: ${Math.round(bot.health || 20)}/20  Голод: ${Math.round(bot.food || 20)}/20`,
    `Время: ${timeStr} (${time})  Погода: ${weather}`,
    `Предметов: ${items.length}/36  Существ рядом: ${nearby}`,
  ].join("\n");
}

function cmdInventory(bot) {
  const items = bot.inventory?.items() || [];
  if (items.length === 0) return "🎒 Инвентарь пуст";
  const lines = items.map(i => `  ${i.count}x ${i.name}`);
  // Броня
  const slots = bot.inventory.slots;
  const armor = [slots[5], slots[6], slots[7], slots[8]].filter(Boolean).map(i => i.name);
  return `🎒 ИНВЕНТАРЬ\n${lines.join("\n")}\nБРОНЯ: ${armor.join(", ") || "нет"}`;
}

function cmdNearbyBlocks(bot) {
  const pos = bot.entity.position;
  const seen = new Set();
  const result = [];
  for (let dx = -8; dx <= 8; dx += 2) {
    for (let dy = -4; dy <= 4; dy += 2) {
      for (let dz = -8; dz <= 8; dz += 2) {
        const b = bot.blockAt(pos.offset(dx, dy, dz));
        if (b && b.name !== "air" && b.name !== "cave_air" && !seen.has(b.name)) {
          seen.add(b.name);
          result.push(b.name);
        }
      }
    }
  }
  return `🧱 БЛИЖАЙШИЕ БЛОКИ:\n${result.slice(0, 20).join(", ")}`;
}

function cmdCraftable(bot) {
  try {
    const mcData = require("minecraft-data")(bot.version);
    const craftable = [];
    const inventoryCounts = {};
    for (const item of bot.inventory.items()) {
      inventoryCounts[item.type] = (inventoryCounts[item.type] || 0) + item.count;
    }
    // Проверяем 100 самых важных предметов
    const keyItems = [
      "crafting_table","furnace","chest","torch","stick","planks",
      "wooden_pickaxe","stone_pickaxe","iron_pickaxe","wooden_sword","stone_sword",
      "iron_sword","bow","arrow","ladder","door","fence","gate","boat",
      "bucket","water_bucket","iron_ingot","gold_ingot","iron_boots",
      "iron_helmet","iron_chestplate","iron_leggings","iron_axe","iron_shovel",
      "iron_hoe","shears","flint_and_steel","compass","clock","fishing_rod",
      "bread","cake","bowl","mushroom_stew","suspicious_stew","anvil",
      "bookshelf","enchanting_table","brewing_stand","cauldron","hopper",
      "dispenser","dropper","piston","sticky_piston","observer","repeater",
      "comparator","lever","button","pressure_plate","tripwire_hook",
    ];
    for (const name of keyItems) {
      const item = mcData.itemsByName[name];
      if (!item) continue;
      const recipes = bot.recipesFor(item.id, null, 1, null);
      if (recipes && recipes.length > 0) craftable.push(name);
    }
    return `🔨 МОЖНО СКРАФТИТЬ:\n${craftable.join(", ") || "ничего"}`;
  } catch {
    return "🔨 МОЖНО СКРАФТИТЬ: ошибка расчёта";
  }
}

function cmdEntities(bot) {
  const pos = bot.entity.position;
  const entities = Object.values(bot.entities || {})
    .filter(e => e !== bot.entity && e?.position)
    .map(e => ({
      name: e.mobType || e.name || e.type || "?",
      dist: Math.round(e.position.distanceTo(pos)),
      hostile: HOSTILE_MOBS.has(e.mobType || e.name || ""),
      isPlayer: e.type === "player",
      username: e.username,
    }))
    .filter(e => e.dist < 32)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 15);

  if (entities.length === 0) return "👁 Нет существ поблизости";
  return "👁 СУЩЕСТВА РЯДОМ:\n" + entities.map(e =>
    `  ${e.isPlayer ? "👤" : e.hostile ? "☠" : "🐾"} ${e.username || e.name} (${e.dist}м)`
  ).join("\n");
}

// ══════════════════════════════════════════════════════════════
// ГЛАВНЫЙ ОБРАБОТЧИК КОМАНД Andy-4
// ══════════════════════════════════════════════════════════════

async function executeAndy4Command(cmd, instance, taskManager) {
  const { name, args } = cmd;
  const bot = instance.bot;
  if (!bot?.entity) return false;

  const cmdName = name.toLowerCase();
  log.info(`[Andy4] ${cmdName}`, args);

  try {
    switch (cmdName) {

      // ─── ДВИЖЕНИЕ ──────────────────────────────────────────

      case "!gotoplayer":
      case "!movetoplayer":
      case "!approachplayer": {
        const playerName = args[0];
        const dist = typeof args[1] === "number" ? args[1] : 2;
        const target = findPlayer(bot, playerName);
        if (!target) return false;
        await bot.pathfinder.goto(new goals.GoalNear(
          target.position.x, target.position.y, target.position.z, dist
        ));
        return true;
      }

      case "!followplayer":
      case "!follow": {
        const playerName = args[0];
        const dist = typeof args[1] === "number" ? args[1] : 3;
        const target = findPlayer(bot, playerName);
        if (!target) return false;
        bot.pathfinder.goto(new goals.GoalFollow(target, dist)).catch(() => {});
        return true;
      }

      case "!gotocoordinates":
      case "!gotoxyz":
      case "!movetoxyz":
      case "!walkto":
      case "!goto": {
        const x = args[0], y = args[1], z = args[2];
        const closeness = typeof args[3] === "number" ? args[3] : 1;
        if (x !== undefined && z !== undefined) {
          await gotoPosition(bot, x, y, z, closeness);
        }
        return true;
      }

      case "!searchforblock":
      case "!gotonearest":
      case "!gotoblock": {
        const blockType = args[0];
        const range = typeof args[1] === "number" ? args[1] : 64;
        if (!blockType) return false;
        const block = await findAndGoToBlock(bot, blockType, range);
        return !!block;
      }

      case "!searchforentity":
      case "!findentity":
      case "!gotoentity": {
        const entityType = args[0];
        const range = typeof args[1] === "number" ? args[1] : 32;
        const entity = Object.values(bot.entities)
          .filter(e => e !== bot.entity && e?.position &&
            (e.mobType || e.name || "").toLowerCase().includes((entityType || "").toLowerCase()))
          .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))
          [0];
        if (!entity) return false;
        await bot.pathfinder.goto(new goals.GoalNear(
          entity.position.x, entity.position.y, entity.position.z, 2
        ));
        return true;
      }

      case "!moveaway": {
        const distance = typeof args[0] === "number" ? args[0] : 10;
        const pos = bot.entity.position;
        const angle = Math.random() * Math.PI * 2;
        const target = pos.offset(
          Math.cos(angle) * distance, 0, Math.sin(angle) * distance
        );
        await bot.pathfinder.goto(new goals.GoalXZ(Math.round(target.x), Math.round(target.z)));
        return true;
      }

      case "!gotorememberedplace": {
        const placeName = args[0];
        if (instance._memory?.knownLocations?.[placeName]) {
          const loc = instance._memory.knownLocations[placeName];
          await gotoPosition(bot, loc.x, loc.y, loc.z, 2);
          return true;
        }
        return false;
      }

      case "!gotosurface": {
        const pos = bot.entity.position;
        let y = Math.round(pos.y);
        // Ищем первый воздух выше
        for (let dy = 0; dy < 128; dy++) {
          const b = bot.blockAt(pos.offset(0, dy, 0));
          if (b && (b.name === "air" || b.name === "cave_air")) {
            await bot.pathfinder.goto(new goals.GoalBlock(Math.round(pos.x), y + dy, Math.round(pos.z)));
            break;
          }
        }
        return true;
      }

      // ─── СТОП ─────────────────────────────────────────────

      case "!stop":
      case "!stopmoving":
      case "!cancelaction":
      case "!abort":
      case "!stfu": {
        try { bot.pathfinder.stop(); } catch {}
        try { bot.clearControlStates(); } catch {}
        if (taskManager) taskManager.stopAll().catch(() => {});
        return true;
      }

      // ─── ПАМЯТЬ ────────────────────────────────────────────

      case "!rememberhere":
      case "!savepos":
      case "!save": {
        const name2 = args[0] || "last";
        if (!instance._memory) instance._memory = { knownLocations: {} };
        if (!instance._memory.knownLocations) instance._memory.knownLocations = {};
        instance._memory.knownLocations[name2] = bot.entity.position.clone();
        log.info(`[Andy4] Saved position '${name2}':`, bot.entity.position);
        return true;
      }

      // ─── ИНВЕНТАРЬ / ПРЕДМЕТЫ ──────────────────────────────

      case "!consume":
      case "!eatfood":
      case "!eat":
      case "!drink": {
        const itemName = args[0];
        let foodItem = itemName
          ? getInventoryItem(bot, itemName)
          : getBestFood(bot);
        if (!foodItem) return false;
        await bot.equip(foodItem, "hand");
        await bot.consume();
        return true;
      }

      case "!equip":
      case "!equipitem": {
        const itemName = args[0];
        if (!itemName) return false;
        const item = getInventoryItem(bot, itemName);
        if (!item) return false;
        // Определяем слот по типу предмета
        let slot = "hand";
        if (/helmet|cap/.test(itemName)) slot = "head";
        else if (/chestplate|tunic|elytra/.test(itemName)) slot = "torso";
        else if (/leggings|pants/.test(itemName)) slot = "legs";
        else if (/boots|shoes/.test(itemName)) slot = "feet";
        else if (/shield/.test(itemName)) slot = "off-hand";
        await bot.equip(item, slot);
        return true;
      }

      case "!discard":
      case "!dropitem":
      case "!drop":
      case "!throw": {
        const itemName = args[0];
        const count = typeof args[1] === "number" ? args[1] : -1;
        if (!itemName) return false;
        const item = getInventoryItem(bot, itemName);
        if (!item) return false;
        const amount = count > 0 ? Math.min(count, item.count) : item.count;
        await bot.toss(item.type, null, amount);
        return true;
      }

      case "!giveplayer":
      case "!give": {
        const playerName = args[0];
        const itemName = args[1];
        const count = typeof args[2] === "number" ? args[2] : 1;
        const item = getInventoryItem(bot, itemName);
        if (!item) return false;
        const target = findPlayer(bot, playerName);
        if (target) {
          await bot.pathfinder.goto(new goals.GoalNear(
            target.position.x, target.position.y, target.position.z, 2
          ));
        }
        await bot.toss(item.type, null, Math.min(count, item.count));
        return true;
      }

      case "!equiparmor":
      case "!weararmor": {
        await equipBestArmor(bot);
        return true;
      }

      // ─── КРАФТ ─────────────────────────────────────────────

      case "!craftrecipe":
      case "!craftitem":
      case "!craft":
      case "!make": {
        const itemName = args[0];
        const count = typeof args[1] === "number" ? Math.max(1, args[1]) : 1;
        if (!itemName) return false;
        const result = await craftItem(bot, itemName, count);
        log.info(`[Andy4 craft] ${itemName} x${count}:`, result.msg);
        return result.success;
      }

      // ─── ПЛАВКА ────────────────────────────────────────────

      case "!smeltitem":
      case "!smelt":
      case "!cook": {
        const itemName = args[0];
        const count = typeof args[1] === "number" ? Math.max(1, args[1]) : 1;
        if (!itemName) return false;
        const result = await smeltItem(bot, itemName, count);
        log.info(`[Andy4 smelt] ${itemName} x${count}:`, result.msg);
        return result.success;
      }

      case "!clearfurnace": {
        const furnaceBlock = bot.findBlock({ matching: b => b.name === "furnace", maxDistance: 32 });
        if (!furnaceBlock) return false;
        await bot.pathfinder.goto(new goals.GoalNear(
          furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z, 2
        ));
        const furnace = await bot.openFurnace(furnaceBlock);
        await sleep(300);
        if (furnace.outputItem()) await furnace.takeOutput();
        if (furnace.inputItem()) await furnace.takeInput();
        if (furnace.fuelItem()) await furnace.takeFuel();
        await bot.closeWindow(furnace);
        return true;
      }

      // ─── ДОБЫЧА БЛОКОВ ─────────────────────────────────────

      case "!collectblocks":
      case "!collectblock":
      case "!mineblock":
      case "!digblock":
      case "!harvestblock":
      case "!mine": {
        const blockType = args[0];
        const count = typeof args[1] === "number" ? Math.min(args[1], 64) : 1;
        if (!blockType || !taskManager) return false;

        if (/log|wood/.test(blockType)) {
          taskManager.runTask("gather_wood", { count }).catch(() => {});
        } else if (/stone|cobble/.test(blockType)) {
          taskManager.runTask("gather_stone", { count }).catch(() => {});
        } else if (/iron_ore|raw_iron/.test(blockType)) {
          taskManager.runTask("gather_stone", { count, target: blockType }).catch(() => {});
        } else {
          // Универсальная добыча
          (async () => {
            let mined = 0;
            while (mined < count) {
              const block = bot.findBlock({ matching: b => b.name === blockType, maxDistance: 64 });
              if (!block) break;
              await bot.pathfinder.goto(new goals.GoalNear(
                block.position.x, block.position.y, block.position.z, 2
              ));
              if (bot.entity.position.distanceTo(block.position) < 4) {
                try {
                  await bot.dig(block);
                  mined++;
                } catch { break; }
              }
            }
          })().catch(() => {});
        }
        return true;
      }

      case "!placehere":
      case "!placeblock":
      case "!place": {
        const blockName = args[0];
        if (!blockName) return false;
        const item = getInventoryItem(bot, blockName);
        if (!item) return false;
        await bot.equip(item, "hand");
        const pos = bot.entity.position;
        const refBlock = bot.blockAt(pos.offset(0, -1, 0));
        if (refBlock) {
          await bot.placeBlock(refBlock, new Vec3(0, 1, 0));
        }
        return true;
      }

      case "!digdown": {
        const distance = typeof args[0] === "number" ? args[0] : 5;
        const pos = bot.entity.position;
        for (let i = 0; i < distance; i++) {
          const block = bot.blockAt(pos.offset(0, -(i + 1), 0));
          if (!block || block.name === "air") break;
          if (block.name === "lava" || block.name === "water") break;
          try { await bot.dig(block); } catch { break; }
          await sleep(300);
        }
        return true;
      }

      // ─── БОЙ ──────────────────────────────────────────────

      case "!attack":
      case "!attacknearest":
      case "!attackentity":
      case "!killentity":
      case "!kill":
      case "!fight": {
        const targetType = args[0];
        if (taskManager) {
          taskManager.runTask("attack", { target: targetType || "zombie" }).catch(() => {});
          return true;
        }
        // Прямая атака
        const entity = targetType
          ? findEntity(bot, targetType)
          : findNearestHostile(bot);
        if (!entity) return false;
        await equipBestWeapon(bot);
        await bot.pathfinder.goto(new goals.GoalNear(
          entity.position.x, entity.position.y, entity.position.z, 2
        ));
        await bot.attack(entity);
        return true;
      }

      case "!attackplayer": {
        const playerName = args[0];
        const target = findPlayer(bot, playerName);
        if (!target) return false;
        await equipBestWeapon(bot);
        await bot.pathfinder.goto(new goals.GoalNear(
          target.position.x, target.position.y, target.position.z, 2
        ));
        await bot.attack(target);
        return true;
      }

      case "!defend":
      case "!defendself": {
        const entity = findNearestHostile(bot, 20);
        if (!entity) return true;
        await equipBestWeapon(bot);
        await bot.pathfinder.goto(new goals.GoalNear(
          entity.position.x, entity.position.y, entity.position.z, 1
        ));
        await bot.attack(entity);
        return true;
      }

      case "!flee":
      case "!runaway":
      case "!escapefrom": {
        const targetType = args[0];
        const dist = typeof args[1] === "number" ? args[1] : 20;
        const entity = targetType ? findEntity(bot, targetType) : findNearestHostile(bot);
        if (!entity) return true;
        const pos = bot.entity.position;
        const away = pos.plus(pos.minus(entity.position).normalize().scaled(dist));
        bot.pathfinder.goto(new goals.GoalXZ(Math.round(away.x), Math.round(away.z))).catch(() => {});
        return true;
      }

      // ─── СОН ──────────────────────────────────────────────

      case "!gotobed":
      case "!sleep": {
        const bedBlock = bot.findBlock({
          matching: b => b.name.endsWith("_bed"),
          maxDistance: 32,
        });
        if (!bedBlock) return false;
        await bot.pathfinder.goto(new goals.GoalNear(
          bedBlock.position.x, bedBlock.position.y, bedBlock.position.z, 2
        ));
        try {
          await bot.sleep(bedBlock);
        } catch {}
        return true;
      }

      case "!stay": {
        const seconds = typeof args[0] === "number" ? args[0] : 10;
        if (seconds > 0) await sleep(seconds * 1000);
        return true;
      }

      // ─── СУНДУКИ ──────────────────────────────────────────

      case "!putinchest":
      case "!store": {
        const itemName = args[0];
        const count = typeof args[1] === "number" ? args[1] : -1;
        if (!itemName) return false;
        const chest = await openNearestChest(bot);
        if (!chest) return false;
        const item = getInventoryItem(bot, itemName);
        if (item) {
          const amount = count > 0 ? Math.min(count, item.count) : item.count;
          await chest.deposit(item.type, null, amount);
        }
        await bot.closeWindow(chest);
        return !!item;
      }

      case "!takefromchest":
      case "!take": {
        const itemName = args[0];
        const count = typeof args[1] === "number" ? args[1] : 1;
        if (!itemName) return false;
        const chest = await openNearestChest(bot);
        if (!chest) return false;
        const mcData = require("minecraft-data")(bot.version);
        const item = (chest.containerItems() || []).find(i =>
          i.name.includes((itemName || "").toLowerCase().replace(/ /g, "_"))
        );
        if (item) {
          await chest.withdraw(item.type, null, Math.min(count, item.count));
        }
        await bot.closeWindow(chest);
        return !!item;
      }

      case "!viewchest": {
        const chest = await openNearestChest(bot);
        if (!chest) return false;
        const items = chest.containerItems() || [];
        log.info("[Andy4 viewChest]", items.map(i => `${i.count}x${i.name}`).join(", "));
        await bot.closeWindow(chest);
        return true;
      }

      // ─── ВЗГЛЯД ────────────────────────────────────────────

      case "!lookat":
      case "!looktowards":
      case "!lookatplayer": {
        const target = findPlayer(bot, args[0]);
        if (target) {
          await bot.lookAt(target.position.offset(0, 1.6, 0));
        }
        return true;
      }

      case "!lookatposition": {
        const x = args[0], y = args[1], z = args[2];
        if (x !== undefined) {
          await bot.lookAt(new Vec3(x, y ?? bot.entity.position.y, z ?? bot.entity.position.z));
        }
        return true;
      }

      // ─── ИСПОЛЬЗОВАНИЕ ПРЕДМЕТОВ ───────────────────────────

      case "!useon":
      case "!use":
      case "!rightclick": {
        const toolName = args[0];
        const targetType = args[1];
        if (toolName && toolName !== "hand") {
          const tool = getInventoryItem(bot, toolName);
          if (tool) await bot.equip(tool, "hand");
        }
        if (targetType && targetType !== "nothing") {
          const block = bot.findBlock({ matching: b => b.name.includes(targetType), maxDistance: 8 });
          if (block) await bot.activateBlock(block);
          else {
            const entity = findEntity(bot, targetType);
            if (entity) await bot.useOn(entity);
          }
        } else {
          await bot.activateItem();
        }
        return true;
      }

      // ─── ИНФОРМАЦИЯ (queries) ──────────────────────────────

      case "!stats": {
        const info = cmdStats(bot);
        bot.chat(info.slice(0, 200));
        return true;
      }

      case "!inventory": {
        const info = cmdInventory(bot);
        bot.chat(info.slice(0, 200));
        return true;
      }

      case "!nearbyblocks": {
        const info = cmdNearbyBlocks(bot);
        bot.chat(info.slice(0, 200));
        return true;
      }

      case "!craftable": {
        const info = cmdCraftable(bot);
        bot.chat(info.slice(0, 200));
        return true;
      }

      case "!entities": {
        const info = cmdEntities(bot);
        bot.chat(info.slice(0, 200));
        return true;
      }

      // ─── ПРЫЖОК ────────────────────────────────────────────

      case "!jump": {
        bot.setControlState("jump", true);
        setTimeout(() => bot.setControlState("jump", false), 400);
        return true;
      }

      // ─── ТОРГОВЛЯ С ЖИТЕЛЯМИ ───────────────────────────────

      case "!showvillagertrades": {
        const id = args[0];
        const villager = id
          ? Object.values(bot.entities).find(e => e.id === id)
          : Object.values(bot.entities).find(e => e.name === "villager" && e.position.distanceTo(bot.entity.position) < 8);
        if (!villager) return false;
        await bot.pathfinder.goto(new goals.GoalNear(
          villager.position.x, villager.position.y, villager.position.z, 2
        ));
        const window = await bot.openEntity(villager);
        const trades = window.trades || [];
        log.info("[Andy4 villager trades]", trades.slice(0, 5));
        await bot.closeWindow(window);
        return true;
      }

      case "!tradewithvillager": {
        const id = args[0];
        const index = (typeof args[1] === "number" ? args[1] : 1) - 1;
        const count = typeof args[2] === "number" ? args[2] : 1;
        const villager = id
          ? Object.values(bot.entities).find(e => e.id === id)
          : Object.values(bot.entities).find(e => e.name === "villager" && e.position.distanceTo(bot.entity.position) < 8);
        if (!villager) return false;
        await bot.pathfinder.goto(new goals.GoalNear(
          villager.position.x, villager.position.y, villager.position.z, 2
        ));
        const window = await bot.openEntity(villager);
        if (window.trades?.[index]) {
          for (let i = 0; i < count; i++) {
            await window.trade(index, 1);
            await sleep(200);
          }
        }
        await bot.closeWindow(window);
        return true;
      }

      // ─── СЛУЖЕБНЫЕ — игнорируем без ошибки ────────────────

      case "!newaction":
      case "!startconversation":
      case "!endconversation":
      case "!setchat":
      case "!setmode":
      case "!goal":
      case "!endgoal":
      case "!clearchat":
      case "!restart":
      case "!respond":
      case "!think":
      case "!forget":
      case "!searchwiki":
      case "!log":
      case "!say":
        return true;

      default:
        if (name.startsWith("!")) {
          log.warn(`[Andy4] Unknown command: ${name}`, args);
        }
        return false;
    }
  } catch (err) {
    log.error(`[Andy4] Error executing ${name}:`, err.message);
    return false;
  }
}

// ══════════════════════════════════════════════════════════════
// УТИЛИТЫ
// ══════════════════════════════════════════════════════════════

function isAndy4Model(modelName) {
  const m = (modelName || "").toLowerCase();
  return m.includes("andy") || m.includes("sweaterdog");
}

module.exports = {
  parseAndy4Response,
  executeAndy4Command,
  isAndy4Model,
  stripThinkBlocks,
  craftItem,
  smeltItem,
  equipBestWeapon,
  equipBestArmor,
  getBestFood,
  getInventoryItem,
};
