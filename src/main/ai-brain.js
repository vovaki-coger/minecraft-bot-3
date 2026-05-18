/**
 * AIBrain v3 — настоящий "мозг" бота: мост между Mineflayer и Ollama.
 *
 * Архитектура: ReAct-петля (Reasoning + Acting)
 *
 *  1. OBSERVE  — собирает полный снимок состояния мира через Mineflayer API
 *  2. THINK    — отправляет снимок в Ollama, модель рассуждает (chain-of-thought)
 *  3. ACT      — выполняет решение через Mineflayer
 *  4. FEEDBACK — наблюдает результат (успех/неудача) и добавляет в контекст
 *  5. → повтор
 *
 * Ключевые отличия от простого вызова AI:
 *  - Персистентная память (episodic + semantic) — бот помнит прошлые события
 *  - Мультишаговое рассуждение — LLM видит цепочку действий и их результаты
 *  - Инструменты (tools) — LLM вызывает конкретные Mineflayer-функции
 *  - Самооценка — модель оценивает выполнение и корректирует план
 *  - Персонаж — бот имеет системную личность и ценности
 */

const { goals } = require("mineflayer-pathfinder");
const log = require("electron-log");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ══════════════════════════════════════════════════════════════
// ИНСТРУМЕНТЫ — функции которые LLM может вызывать
// ══════════════════════════════════════════════════════════════

const TOOL_DEFINITIONS = `
Ты можешь вызывать ИНСТРУМЕНТЫ указывая JSON-команду в своём ответе.
Формат: {"tool": "имя_инструмента", "args": {...}}

ДОСТУПНЫЕ ИНСТРУМЕНТЫ:

[Движение]
{"tool": "goto_block", "args": {"block": "oak_log", "max_distance": 64}}
  → Найти и подойти к ближайшему блоку этого типа

{"tool": "goto_entity", "args": {"type": "cow", "max_distance": 32}}
  → Подойти к ближайшей сущности этого типа

{"tool": "goto_xyz", "args": {"x": 100, "y": 64, "z": -200}}
  → Пойти к точным координатам

{"tool": "follow_player", "args": {"name": "имя_игрока", "distance": 3}}
  → Следовать за игроком

{"tool": "stop_moving", "args": {}}
  → Остановить движение

[Добыча]
{"tool": "dig_block", "args": {"block": "oak_log", "count": 10}}
  → Найти и сломать N блоков этого типа

{"tool": "collect_drops", "args": {"radius": 8}}
  → Подобрать все выпавшие предметы в радиусе

[Бой]
{"tool": "attack", "args": {"target": "zombie", "max_distance": 16}}
  → Атаковать ближайшую цель

{"tool": "defend", "args": {"radius": 8}}
  → Атаковать ближайшего враждебного моба

{"tool": "flee", "args": {"from": "creeper", "distance": 20}}
  → Убежать от опасности

[Крафт и инвентарь]
{"tool": "craft", "args": {"item": "crafting_table", "count": 1}}
  → Скрафтить предмет (нужен верстак для сложных рецептов)

{"tool": "equip", "args": {"item": "iron_sword", "slot": "hand"}}
  → Экипировать предмет (slot: hand/head/torso/legs/feet)

{"tool": "eat", "args": {"item": "cooked_beef"}}
  → Съесть еду (если item не указан — лучшая из инвентаря)

{"tool": "drop_item", "args": {"item": "dirt", "count": 64}}
  → Выбросить предметы

{"tool": "place_block", "args": {"item": "oak_planks", "direction": "up"}}
  → Поставить блок (direction: up/down/north/south/east/west)

[Информация]
{"tool": "look_around", "args": {}}
  → Осмотреться (получить список видимых блоков и существ)

{"tool": "read_sign", "args": {}}
  → Прочитать табличку рядом

{"tool": "check_inventory", "args": {}}
  → Показать содержимое инвентаря

{"tool": "check_surroundings", "args": {"radius": 16}}
  → Сканировать окружение (блоки, существа, освещение)

[Общение]
{"tool": "chat", "args": {"message": "Привет!"}}
  → Написать в чат сервера

{"tool": "whisper", "args": {"player": "имя", "message": "текст"}}
  → Личное сообщение игроку

[Строительство]
{"tool": "build_wall", "args": {"material": "cobblestone", "width": 5, "height": 3}}
  → Построить стену из доступного материала

{"tool": "build_shelter", "args": {"material": "oak_planks"}}
  → Построить быстрое укрытие 5x5x3

[Ожидание]
{"tool": "wait", "args": {"seconds": 3, "reason": "жду рассвета"}}
  → Подождать N секунд
`;

// ══════════════════════════════════════════════════════════════
// СИСТЕМНЫЙ ПРОМТ — ЛИЧНОСТЬ БОТА
// ══════════════════════════════════════════════════════════════

function buildSystemPrompt(botConfig) {
  const personality = botConfig.systemPrompt ||
    "Ты умный Minecraft-бот. Ты самостоятельно думаешь и принимаешь решения.";

  return `${personality}

═══════════════════════════════════════════════
ПРАВИЛА МЫШЛЕНИЯ
═══════════════════════════════════════════════

Ты — автономный агент в Minecraft. Ты ДУМАЕШЬ перед каждым действием.

ФОРМАТ ОТВЕТА (обязательный):
{
  "думаю": "рассуждение почему делаю именно это (1-3 предложения)",
  "план": ["шаг 1", "шаг 2", "шаг 3"],
  "действие": {"tool": "имя_инструмента", "args": {...}},
  "говорю": "что сказать игроку (null если молчать)"
}

ПРИНЦИПЫ ПОВЕДЕНИЯ:
1. Выживание — приоритет: HP < 10 → срочно лечись, Голод < 8 → срочно ешь
2. Безопасность: ночью не выходи без оружия и брони
3. Эффективность: думай о ресурсах, не трать зря
4. Честность: если не можешь сделать — скажи почему
5. Инициатива: если нет задачи — сам находи полезное занятие
6. Память: используй историю действий, не повторяй ошибки

${TOOL_DEFINITIONS}`;
}

// ══════════════════════════════════════════════════════════════
// НАБЛЮДАТЕЛЬ МИРА (Perception Module)
// ══════════════════════════════════════════════════════════════

class WorldObserver {
  constructor(bot) {
    this.bot = bot;
  }

  observe() {
    const bot = this.bot;
    if (!bot?.entity) return null;

    const pos = bot.entity.position;
    const inv = this._getInventory();
    const entities = this._getNearbyEntities(24);
    const blocks = this._getInterestingBlocks(16);
    const threats = entities.filter((e) => e.hostile).slice(0, 5);
    const animals = entities.filter((e) => e.type === "animal").slice(0, 5);
    const players = entities.filter((e) => e.type === "player").slice(0, 5);
    const equipment = this._getEquipment();
    const timeInfo = this._getTimeInfo();
    const biome = bot.world?.getBiome?.(pos)?.name || this.bot?.biome || "неизвестно";

    return {
      // Состояние
      hp: Math.round(bot.health),
      maxHp: 20,
      food: Math.round(bot.food),
      maxFood: 20,
      xp: bot.experience?.level || 0,
      oxygen: bot.oxygenLevel || 20,

      // Позиция
      x: Math.round(pos.x),
      y: Math.round(pos.y),
      z: Math.round(pos.z),
      biome,
      onGround: bot.entity.onGround,
      onFire: bot.entity.onFire || false,
      inWater: bot.entity.isInWater || false,

      // Время
      ...timeInfo,

      // Снаряжение
      heldItem: bot.heldItem?.name || "ничего",
      equipment,

      // Инвентарь
      inventory: inv,
      emptySlots: 36 - inv.length,

      // Окружение
      nearbyThreats: threats,
      nearbyAnimals: animals,
      nearbyPlayers: players,
      nearbyBlocks: blocks,

      // Последний блок под ногами
      blockBelow: bot.blockAt(pos.offset(0, -1, 0))?.name || "void",
    };
  }

  _getInventory() {
    return this.bot.inventory.items().map((i) => ({
      name: i.name,
      count: i.count,
      displayName: i.displayName || i.name,
    }));
  }

  _getEquipment() {
    const slots = { head: "head", chest: "torso", legs: "legs", feet: "feet" };
    const result = {};
    for (const [slot, label] of Object.entries(slots)) {
      const item = this.bot.inventory.slots[this.bot.getEquipmentDestSlot?.(slot)];
      if (item) result[label] = item.name;
    }
    return result;
  }

  _getNearbyEntities(radius) {
    const bot = this.bot;
    const result = [];
    const HOSTILES = new Set(["zombie","skeleton","creeper","spider","enderman","witch","pillager","phantom","drowned","husk","stray","blaze","ghast","slime","magma_cube"]);
    const ANIMALS = new Set(["cow","pig","sheep","chicken","rabbit","horse","wolf","cat","fox","mooshroom"]);

    for (const e of Object.values(bot.entities)) {
      if (!e.position || e === bot.entity) continue;
      const dist = Math.round(bot.entity.position.distanceTo(e.position));
      if (dist > radius) continue;
      const name = (e.name || e.type || "").toLowerCase();
      const username = e.username;
      let type = "other";
      if (username && username !== bot.username) type = "player";
      else if (HOSTILES.has(name)) type = "hostile";
      else if (ANIMALS.has(name)) type = "animal";

      result.push({
        id: e.id,
        name: username || e.displayName || name,
        type,
        hostile: type === "hostile",
        dist,
        hp: e.health || null,
      });
    }
    result.sort((a, b) => a.dist - b.dist);
    return result;
  }

  _getInterestingBlocks(radius) {
    const bot = this.bot;
    const INTERESTING = new Set([
      "oak_log","birch_log","spruce_log","acacia_log","dark_oak_log","mangrove_log",
      "iron_ore","deepslate_iron_ore","coal_ore","deepslate_coal_ore",
      "gold_ore","deepslate_gold_ore","diamond_ore","deepslate_diamond_ore",
      "crafting_table","furnace","chest","bed","door",
      "wheat","carrots","potatoes","sugar_cane",
      "water","lava","obsidian","nether_portal",
    ]);

    const found = {};
    const pos = bot.entity.position;
    for (let dx = -radius; dx <= radius; dx += 3) {
      for (let dy = -4; dy <= 4; dy += 2) {
        for (let dz = -radius; dz <= radius; dz += 3) {
          try {
            const b = bot.blockAt(pos.offset(dx, dy, dz));
            if (b && INTERESTING.has(b.name)) {
              const dist = Math.round(Math.sqrt(dx*dx + dy*dy + dz*dz));
              if (!found[b.name] || found[b.name] > dist) {
                found[b.name] = dist;
              }
            }
          } catch {}
        }
      }
    }
    return Object.entries(found).map(([name, dist]) => ({ name, dist })).sort((a, b) => a.dist - b.dist);
  }

  _getTimeInfo() {
    const t = this.bot?.time?.timeOfDay ?? 0;
    const isNight = t > 13000 && t < 23000;
    let timeStr;
    if (t < 1000) timeStr = "рассвет";
    else if (t < 6000) timeStr = "утро";
    else if (t < 12000) timeStr = "день";
    else if (t < 13000) timeStr = "закат";
    else if (t < 18000) timeStr = "ночь";
    else timeStr = "поздняя ночь";
    return { time: timeStr, isNight };
  }
}

// ══════════════════════════════════════════════════════════════
// ИСПОЛНИТЕЛЬ ИНСТРУМЕНТОВ (Action Module)
// ══════════════════════════════════════════════════════════════

class ToolExecutor {
  constructor(instance, taskManager, emit) {
    this.instance = instance;
    this.taskManager = taskManager;
    this.emit = emit;
  }

  get bot() { return this.instance.bot; }

  async execute(toolCall) {
    if (!toolCall?.tool) return { success: false, error: "нет tool" };
    const { tool, args } = toolCall;

    try {
      switch (tool) {
        case "goto_block": return await this._gotoBlock(args);
        case "goto_entity": return await this._gotoEntity(args);
        case "goto_xyz": return await this._gotoXYZ(args);
        case "follow_player": return await this._followPlayer(args);
        case "stop_moving": return this._stopMoving();
        case "dig_block": return await this._digBlock(args);
        case "collect_drops": return await this._collectDrops(args);
        case "attack": return await this._attack(args);
        case "defend": return await this._defend(args);
        case "flee": return await this._flee(args);
        case "craft": return await this._craft(args);
        case "equip": return await this._equip(args);
        case "eat": return await this._eat(args);
        case "drop_item": return await this._dropItem(args);
        case "place_block": return await this._placeBlock(args);
        case "look_around": return this._lookAround();
        case "check_inventory": return this._checkInventory();
        case "check_surroundings": return this._checkSurroundings(args);
        case "chat": return this._chat(args);
        case "whisper": return this._whisper(args);
        case "build_shelter": return await this._buildShelter(args);
        case "wait": return await this._wait(args);
        default: return { success: false, error: "неизвестный инструмент: " + tool };
      }
    } catch (err) {
      log.warn("[ToolExecutor] Tool", tool, "failed:", err.message);
      return { success: false, error: err.message };
    }
  }

  async _gotoBlock({ block, max_distance = 64 }) {
    const bot = this.bot;
    const types = this._resolveBlockIds(bot, block);
    if (!types.length) return { success: false, error: "неизвестный блок: " + block };
    const found = bot.findBlock({ matching: types, maxDistance: max_distance });
    if (!found) return { success: false, error: "блок " + block + " не найден в радиусе " + max_distance };
    await bot.pathfinder.goto(new goals.GoalNear(found.position.x, found.position.y, found.position.z, 3)).catch(() => {});
    return { success: true, result: "подошёл к " + found.name + " (" + Math.round(bot.entity.position.distanceTo(found.position)) + "м)" };
  }

  async _gotoEntity({ type, max_distance = 32 }) {
    const bot = this.bot;
    const entity = this._findEntity(type, max_distance);
    if (!entity) return { success: false, error: "существо " + type + " не найдено рядом" };
    await bot.pathfinder.goto(new goals.GoalNear(entity.position.x, entity.position.y, entity.position.z, 3)).catch(() => {});
    return { success: true, result: "подошёл к " + (entity.name || type) };
  }

  async _gotoXYZ({ x, y, z }) {
    const bot = this.bot;
    const fy = y ?? Math.round(bot.entity.position.y);
    await bot.pathfinder.goto(new goals.GoalBlock(Math.round(x), Math.round(fy), Math.round(z))).catch(() => {});
    return { success: true, result: "пришёл к " + Math.round(x) + " " + fy + " " + Math.round(z) };
  }

  async _followPlayer({ name, distance = 3 }) {
    const bot = this.bot;
    const player = Object.values(bot.entities).find((e) =>
      e.type === "player" && e.username !== bot.username &&
      (!name || e.username?.toLowerCase().includes(name.toLowerCase()))
    );
    if (!player) return { success: false, error: "игрок " + name + " не найден" };
    bot.pathfinder.goto(new goals.GoalFollow(player, distance)).catch(() => {});
    return { success: true, result: "следую за " + player.username };
  }

  _stopMoving() {
    try { this.bot.pathfinder.stop(); } catch {}
    try { this.bot.clearControlStates(); } catch {}
    return { success: true, result: "остановился" };
  }

  async _digBlock({ block, count = 1 }) {
    const bot = this.bot;
    const types = this._resolveBlockIds(bot, block);
    if (!types.length) return { success: false, error: "неизвестный блок: " + block };
    let dug = 0;
    const maxCount = Math.min(count, 64);
    while (dug < maxCount) {
      const found = bot.findBlock({ matching: types, maxDistance: 48 });
      if (!found) break;
      await bot.pathfinder.goto(new goals.GoalBlock(found.position.x, found.position.y, found.position.z)).catch(() => {});
      await sleep(100);
      const b = bot.blockAt(found.position);
      if (b && b.name !== "air") {
        await bot.dig(b).catch(() => {});
        dug++;
      } else break;
    }
    return { success: dug > 0, result: "сломал " + dug + " " + block };
  }

  async _collectDrops({ radius = 8 }) {
    const bot = this.bot;
    const drops = Object.values(bot.entities).filter((e) =>
      e.type === "object" && e.objectType === "Item" &&
      e.position.distanceTo(bot.entity.position) < radius
    );
    for (const d of drops.slice(0, 20)) {
      await bot.pathfinder.goto(new goals.GoalNear(d.position.x, d.position.y, d.position.z, 1)).catch(() => {});
    }
    return { success: true, result: "собрал " + drops.length + " предмет(ов)" };
  }

  async _attack({ target, max_distance = 16 }) {
    const bot = this.bot;
    const entity = this._findEntity(target, max_distance);
    if (!entity) return { success: false, error: target + " не найден рядом" };
    await bot.pathfinder.goto(new goals.GoalFollow(entity, 2)).catch(() => {});
    if (entity.isValid) bot.attack(entity);
    return { success: true, result: "атакую " + (entity.displayName || target) };
  }

  async _defend({ radius = 8 }) {
    const bot = this.bot;
    const HOSTILES = ["zombie","skeleton","creeper","spider","enderman","witch","pillager","phantom","drowned","blaze"];
    let nearest = null, minD = radius;
    for (const e of Object.values(bot.entities)) {
      if (!e.position) continue;
      const n = (e.name || "").toLowerCase();
      if (!HOSTILES.some((h) => n.includes(h))) continue;
      const d = bot.entity.position.distanceTo(e.position);
      if (d < minD) { minD = d; nearest = e; }
    }
    if (!nearest) return { success: false, error: "нет врагов рядом" };
    await bot.lookAt(nearest.position.offset(0, nearest.height ?? 1, 0)).catch(() => {});
    bot.attack(nearest);
    return { success: true, result: "атакую врага: " + nearest.name };
  }

  async _flee({ from, distance = 20 }) {
    const bot = this.bot;
    const entity = this._findEntity(from, 32);
    if (!entity) return { success: false, error: from + " не найден рядом" };
    const dir = bot.entity.position.clone().subtract(entity.position).normalize();
    const target = bot.entity.position.clone().add(dir.scale(distance));
    await bot.pathfinder.goto(new goals.GoalNear(target.x, bot.entity.position.y, target.z, 2)).catch(() => {});
    return { success: true, result: "убежал от " + from };
  }

  async _craft({ item, count = 1 }) {
    const bot = this.bot;
    const itemDef = bot.registry.itemsByName[item];
    if (!itemDef) return { success: false, error: "неизвестный предмет: " + item };
    const table = bot.findBlock({ matching: bot.registry.blocksByName["crafting_table"]?.id, maxDistance: 8 });
    if (!table && item !== "crafting_table") {
      const farTable = bot.findBlock({ matching: bot.registry.blocksByName["crafting_table"]?.id, maxDistance: 32 });
      if (farTable) await bot.pathfinder.goto(new goals.GoalBlock(farTable.position.x, farTable.position.y, farTable.position.z)).catch(() => {});
    }
    const updatedTable = bot.findBlock({ matching: bot.registry.blocksByName["crafting_table"]?.id, maxDistance: 8 });
    const recipe = bot.recipesFor(itemDef.id, null, 1, updatedTable)[0];
    if (!recipe) return { success: false, error: "нет рецепта для " + item + " (нужен верстак или материалы?)" };
    await bot.craft(recipe, Math.min(count, 64), updatedTable);
    return { success: true, result: "скрафтил " + count + " " + item };
  }

  async _equip({ item, slot = "hand" }) {
    const bot = this.bot;
    const invItem = bot.inventory.items().find((i) => i.name === item || i.name.includes(item));
    if (!invItem) return { success: false, error: item + " нет в инвентаре" };
    const dest = slot === "hand" ? "hand" : slot;
    await bot.equip(invItem, dest).catch(() => {});
    return { success: true, result: "экипировал " + invItem.name };
  }

  async _eat({ item } = {}) {
    const bot = this.bot;
    let food;
    if (item) {
      food = bot.inventory.items().find((i) => i.name === item);
    } else {
      food = bot.inventory.items()
        .filter((i) => i.foodPoints && i.foodPoints > 0)
        .sort((a, b) => (b.foodPoints || 0) - (a.foodPoints || 0))[0];
    }
    if (!food) return { success: false, error: "нет еды" + (item ? " " + item : "") };
    await bot.equip(food, "hand").catch(() => {});
    await bot.consume().catch(() => {});
    return { success: true, result: "съел " + food.name };
  }

  async _dropItem({ item, count = 1 }) {
    const bot = this.bot;
    const invItem = bot.inventory.items().find((i) => i.name === item || i.name.includes(item));
    if (!invItem) return { success: false, error: item + " нет в инвентаре" };
    await bot.toss(invItem.type, null, Math.min(count, invItem.count));
    return { success: true, result: "выбросил " + count + " " + item };
  }

  async _placeBlock({ item, direction = "up" }) {
    const bot = this.bot;
    const invItem = bot.inventory.items().find((i) => i.name === item || i.name.includes(item));
    if (!invItem) return { success: false, error: item + " нет в инвентаре" };
    await bot.equip(invItem, "hand").catch(() => {});
    const dir = { up: [0,1,0], down: [0,-1,0], north: [0,0,-1], south: [0,0,1], west: [-1,0,0], east: [1,0,0] }[direction] || [0,1,0];
    const pos = bot.entity.position.clone().floor();
    const refBlock = bot.blockAt(pos.offset(-dir[0], -dir[1]-1, -dir[2]));
    if (!refBlock) return { success: false, error: "нет опорного блока" };
    const { default: Vec3 } = await import("vec3").catch(() => ({ default: require("vec3") }));
    await bot.placeBlock(refBlock, new Vec3(...dir)).catch(() => {});
    return { success: true, result: "поставил " + item };
  }

  _lookAround() {
    const obs = new WorldObserver(this.bot).observe();
    if (!obs) return { success: false, error: "нет данных" };
    return {
      success: true,
      result: "Вижу: " + obs.nearbyBlocks.slice(0,5).map((b) => b.name + "(" + b.dist + "м)").join(", ") +
        " | Существа: " + (obs.nearbyThreats.map((e) => e.name).join(", ") || "нет угроз") +
        " | Животные: " + (obs.nearbyAnimals.map((e) => e.name).join(", ") || "нет")
    };
  }

  _checkInventory() {
    const items = this.bot.inventory.items();
    if (!items.length) return { success: true, result: "инвентарь пустой" };
    const topItems = items.sort((a,b) => b.count - a.count).slice(0,10)
      .map((i) => (i.displayName || i.name) + " x" + i.count).join(", ");
    return { success: true, result: "Инвентарь: " + topItems };
  }

  _checkSurroundings({ radius = 16 } = {}) {
    const obs = new WorldObserver(this.bot).observe();
    return {
      success: true,
      result: JSON.stringify({
        threats: obs.nearbyThreats,
        animals: obs.nearbyAnimals,
        players: obs.nearbyPlayers,
        blocks: obs.nearbyBlocks.slice(0, 10),
        light: obs.blockBelow,
      })
    };
  }

  _chat({ message }) {
    if (!message) return { success: false, error: "нет сообщения" };
    const text = String(message).slice(0, 100);
    this.bot.chat(text);
    this.emit("bot:chat", {
      botId: this.instance.id,
      username: this.instance.config.nick,
      message: text,
      type: "bot",
    });
    this.instance.chatHistory.push({ type: "bot", text, timestamp: Date.now() });
    return { success: true, result: "написал: " + text };
  }

  _whisper({ player, message }) {
    if (!player || !message) return { success: false, error: "нужны player и message" };
    const text = `/tell ${player} ${String(message).slice(0, 90)}`;
    this.bot.chat(text);
    return { success: true, result: "написал " + player + ": " + message };
  }

  async _buildShelter({ material = "oak_planks" }) {
    if (this.taskManager) {
      this.taskManager.runTask("build_house", {}).catch(() => {});
      return { success: true, result: "строю укрытие из " + material };
    }
    return { success: false, error: "TaskManager недоступен" };
  }

  async _wait({ seconds = 2 }) {
    await sleep(seconds * 1000);
    return { success: true, result: "подождал " + seconds + " секунд" };
  }

  // ── Вспомогательные ───────────────────────────────────────────────────

  _resolveBlockIds(bot, name) {
    const ids = [];
    const exact = bot.registry.blocksByName[name];
    if (exact) ids.push(exact.id);
    const ALIASES = {
      log: ["oak_log","birch_log","spruce_log","jungle_log","acacia_log","dark_oak_log","mangrove_log"],
      wood: ["oak_log","birch_log","spruce_log","jungle_log","acacia_log","dark_oak_log","mangrove_log"],
      iron_ore: ["iron_ore","deepslate_iron_ore"],
      coal_ore: ["coal_ore","deepslate_coal_ore"],
      gold_ore: ["gold_ore","deepslate_gold_ore"],
      diamond_ore: ["diamond_ore","deepslate_diamond_ore"],
      stone: ["stone","cobblestone","deepslate","andesite","diorite","granite"],
    };
    const alias = ALIASES[name] || Object.entries(ALIASES).find(([k]) => name.includes(k))?.[1];
    if (alias) {
      for (const n of alias) {
        const b = bot.registry.blocksByName[n];
        if (b && !ids.includes(b.id)) ids.push(b.id);
      }
    }
    return ids;
  }

  _findEntity(name, maxDist) {
    const bot = this.bot;
    let best = null, minD = maxDist;
    for (const e of Object.values(bot.entities)) {
      if (!e.position || e === bot.entity) continue;
      const n = (e.name || e.displayName || e.username || e.type || "").toLowerCase();
      if (!n.includes((name || "").toLowerCase())) continue;
      const d = bot.entity.position.distanceTo(e.position);
      if (d < minD) { minD = d; best = e; }
    }
    return best;
  }
}

// ══════════════════════════════════════════════════════════════
// ПАМЯТЬ (Memory Module)
// ══════════════════════════════════════════════════════════════

class BotMemory {
  constructor(maxEpisodic = 20) {
    this.episodic = [];       // [{timestamp, situation, action, result}]
    this.maxEpisodic = maxEpisodic;
    this.goals = [];          // текущие цели
    this.conversationHistory = []; // последние обмены LLM
    this.knownLocations = {}; // {имя: {x,y,z}} — запомненные места
    this.playerRelations = {};// {имя: "friend/enemy/neutral"}
  }

  addEpisode(situation, action, result) {
    this.episodic.push({
      timestamp: Date.now(),
      situation: situation.slice(0, 200),
      action,
      result,
    });
    if (this.episodic.length > this.maxEpisodic) this.episodic.shift();
  }

  addConversation(role, content) {
    this.conversationHistory.push({ role, content: content.slice(0, 1000) });
    // Держим не более 10 последних сообщений в контексте
    if (this.conversationHistory.length > 10) {
      this.conversationHistory = this.conversationHistory.slice(-10);
    }
  }

  getRecentEpisodes(n = 5) {
    return this.episodic.slice(-n).map((e) =>
      `• Делал: ${e.action} → Результат: ${e.result}`
    ).join("\n");
  }

  rememberLocation(name, pos) {
    this.knownLocations[name] = { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) };
  }

  getLocationsString() {
    const locs = Object.entries(this.knownLocations);
    if (!locs.length) return "нет";
    return locs.map(([n, p]) => `${n}: (${p.x}, ${p.y}, ${p.z})`).join(", ");
  }
}

// ══════════════════════════════════════════════════════════════
// ГЛАВНЫЙ КЛАСС — AI BRAIN
// ══════════════════════════════════════════════════════════════

class AIBrain {
  constructor(instance, ollamaManager, taskManager, emit) {
    this.instance = instance;
    this.ollamaManager = ollamaManager;
    this.taskManager = taskManager;
    this.emit = emit;

    this.observer = new WorldObserver(null); // lazy init
    this.executor = new ToolExecutor(instance, taskManager, emit);
    this.memory = new BotMemory();

    this._active = false;
    this._autonomousLoop = null;
    this._currentTask = null;     // задача от игрока
    this._isProcessing = false;
    this._lastThinkTime = 0;
  }

  get bot() { return this.instance.bot; }

  // ── Запуск автономного режима ──────────────────────────────────────────

  startAutonomous(intervalMs = 8000) {
    if (this._active) return;
    this._active = true;
    this._autonomous_interval = intervalMs;
    this._scheduleNext();
    log.info("[AIBrain] Autonomous mode started");
  }

  stopAutonomous() {
    this._active = false;
    if (this._autonomousLoop) {
      clearTimeout(this._autonomousLoop);
      this._autonomousLoop = null;
    }
    log.info("[AIBrain] Autonomous mode stopped");
  }

  _scheduleNext() {
    if (!this._active) return;
    this._autonomousLoop = setTimeout(() => this._autonomousTick(), this._autonomous_interval);
  }

  async _autonomousTick() {
    if (!this._active || !this.bot?.entity || this._isProcessing) {
      this._scheduleNext();
      return;
    }
    await this.think(null, null); // автономное решение (нет команды)
    this._scheduleNext();
  }

  // ── Ответ на сообщение игрока ─────────────────────────────────────────

  async respondToPlayer(playerName, message) {
    if (this._isProcessing) return; // не перебиваем себя
    await this.think(playerName, message);
  }

  // ── Главный метод мышления ────────────────────────────────────────────

  async think(playerName, playerMessage) {
    if (this._isProcessing) return;
    this._isProcessing = true;

    try {
      // 1. OBSERVE
      this.observer.bot = this.bot;
      const worldState = this.observer.observe();
      if (!worldState) return;

      // 2. Строим prompt
      const situationText = this._buildSituation(worldState, playerName, playerMessage);

      // 3. THINK — отправляем в Ollama
      const llmResponse = await this._callLLM(situationText);
      if (!llmResponse) return;

      // 4. Парсим ответ модели
      const decision = this._parseDecision(llmResponse);
      if (!decision) return;

      // 5. ACT — выполняем инструмент
      let actionResult = { success: false, result: "не выполнено" };
      if (decision.action?.tool) {
        log.info("[AIBrain] Executing tool:", decision.action.tool, decision.action.args);
        actionResult = await this.executor.execute(decision.action);
      }

      // 6. Говорим в чат если нужно
      if (decision.говорю) {
        this.executor._chat({ message: decision.говорю });
      }

      // 7. FEEDBACK — запоминаем эпизод
      const actionDesc = decision.action?.tool
        ? `${decision.action.tool}(${JSON.stringify(decision.action.args || {}).slice(0, 80)})`
        : "ничего";
      this.memory.addEpisode(situationText, actionDesc, actionResult.result || actionResult.error || "?");

      // 8. Логируем рассуждение
      if (decision.думаю) {
        log.info("[AIBrain] Thought:", decision.думаю);
        this.emit("bot:aiMessage", {
          botId: this.instance.id,
          message: `💭 ${decision.думаю}`,
        });
      }

      this._lastThinkTime = Date.now();

    } catch (err) {
      log.error("[AIBrain] think() error:", err.message);
    } finally {
      this._isProcessing = false;
    }
  }

  // ── Построение ситуации ───────────────────────────────────────────────

  _buildSituation(ws, playerName, playerMessage) {
    const inv = ws.inventory.slice(0, 12).map((i) => `${i.name} x${i.count}`).join(", ") || "пусто";
    const threats = ws.nearbyThreats.slice(0, 3).map((e) => `${e.name}(${e.dist}м)`).join(", ") || "нет";
    const animals = ws.nearbyAnimals.slice(0, 3).map((e) => `${e.name}(${e.dist}м)`).join(", ") || "нет";
    const players = ws.nearbyPlayers.slice(0, 3).map((e) => `${e.name}(${e.dist}м)`).join(", ") || "нет";
    const blocks = ws.nearbyBlocks.slice(0, 8).map((b) => `${b.name}(${b.dist}м)`).join(", ") || "нет";

    let situationStr = `
══ СОСТОЯНИЕ ══
HP: ${ws.hp}/20 | Голод: ${ws.food}/20 | XP: ${ws.xp}
Позиция: X=${ws.x} Y=${ws.y} Z=${ws.z} | Биом: ${ws.biome}
Время: ${ws.time}${ws.isNight ? " ⚠️ НОЧЬ" : ""} | Горю: ${ws.onFire ? "ДА ⚠️" : "нет"} | В воде: ${ws.inWater ? "да" : "нет"}
В руке: ${ws.heldItem} | Свободных слотов: ${ws.emptySlots}

══ ИНВЕНТАРЬ ══
${inv}

══ ОКРУЖЕНИЕ ══
Враги: ${threats}
Животные: ${animals}
Игроки: ${players}
Блоки: ${blocks}

══ ПАМЯТЬ (последние действия) ══
${this.memory.getRecentEpisodes(4) || "нет"}

══ ЗАПОМНЕННЫЕ МЕСТА ══
${this.memory.getLocationsString()}`;

    if (playerName && playerMessage) {
      situationStr += `\n\n══ СООБЩЕНИЕ ОТ ИГРОКА ══\n${playerName} написал: "${playerMessage}"`;
    } else {
      situationStr += `\n\n══ РЕЖИМ ══\nАвтономный — нет команды от игрока. Сам реши что сейчас полезно.`;
    }

    if (this._currentTask) {
      situationStr += `\n\n══ ТЕКУЩАЯ ЗАДАЧА ══\n${this._currentTask}`;
    }

    return situationStr;
  }

  // ── Вызов LLM ────────────────────────────────────────────────────────

  async _callLLM(situationText) {
    const systemPrompt = buildSystemPrompt(this.instance.config);

    // Добавляем в историю разговора
    this.memory.addConversation("user", situationText);

    const messages = [...this.memory.conversationHistory];

    try {
      const response = await this.ollamaManager.chat({
        model: this.instance.config.aiModel || "llama3",
        mode: this.instance.config.aiMode || "local",
        apiKey: this.instance.config.apiKey,
        apiProvider: this.instance.config.apiProvider,
        systemPrompt,
        messages,
      });

      const raw = (response?.content || "").trim();
      // Убираем <think>...</think> (DeepSeek-R1, Qwen3 и др.)
      const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<think>[\s\S]*/gi, "").trim();

      // Добавляем ответ в историю
      this.memory.addConversation("assistant", cleaned);

      return cleaned;
    } catch (err) {
      log.error("[AIBrain] LLM call failed:", err.message);
      return null;
    }
  }

  // ── Парсинг решения ──────────────────────────────────────────────────

  _parseDecision(raw) {
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        // Модель написала обычный текст без JSON — попробуем всё равно ответить
        const text = raw.replace(/<[^>]+>/g, "").trim().slice(0, 100);
        if (text) {
          return { думаю: text, план: [], action: { tool: "chat", args: { message: text } }, говорю: null };
        }
        return null;
      }
      return JSON.parse(jsonMatch[0]);
    } catch (err) {
      log.warn("[AIBrain] Parse failed:", err.message, "raw:", raw.slice(0, 100));
      return null;
    }
  }

  // ── Установить текущую задачу ────────────────────────────────────────

  setTask(taskDescription) {
    this._currentTask = taskDescription;
    log.info("[AIBrain] New task:", taskDescription);
  }

  clearTask() {
    this._currentTask = null;
  }

  rememberLocation(name) {
    if (this.bot?.entity) {
      this.memory.rememberLocation(name, this.bot.entity.position);
    }
  }
}

module.exports = { AIBrain, WorldObserver, ToolExecutor, BotMemory };
