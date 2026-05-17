/**
 * Scripted task system — бот выполняет команды без AI на каждый шаг.
 * AI используется только для понимания команды, дальше скрипт сам рулит.
 */
const { goals } = require("mineflayer-pathfinder");
const log = require("electron-log");

class TaskManager {
  constructor(botInstance, emit) {
    this.instance = botInstance;
    this.emit = emit;
    this.currentTask = null;
    this._running = false;
    this._followInterval = null;
  }

  get bot() { return this.instance.bot; }

  _log(msg) {
    this.instance.chatHistory.push({ type: "survivor", text: `[ЗАДАЧА] ${msg}`, timestamp: Date.now() });
    this.emit("bot:survivorLog", { botId: this.instance.id, message: msg });
  }

  _chat(msg) {
    if (this.bot && msg) {
      const text = String(msg).slice(0, 100);
      this.bot.chat(text);
      this.instance.chatHistory.push({ type: "bot", text, timestamp: Date.now() });
      this.emit("bot:chat", { botId: this.instance.id, username: this.instance.config.nick, message: text, type: "bot" });
    }
  }

  async stopAll() {
    this._running = false;
    if (this._followInterval) { clearInterval(this._followInterval); this._followInterval = null; }
    this.currentTask = null;
    try { if (this.bot?.pathfinder) this.bot.pathfinder.stop(); } catch {}
    try { if (this.bot) this.bot.clearControlStates(); } catch {}
    this._log("Все задачи остановлены");
  }

  async runTask(name, args) {
    if (!args) args = {};
    if (this._running) {
      await this.stopAll();
    }
    this._running = true;
    this.currentTask = name;

    try {
      switch (name) {
        case "come_to":      await this._taskComeToPlayer(args.player); break;
        case "follow":       await this._taskFollowPlayer(args.player); break;
        case "stop":         await this.stopAll(); return;
        case "gather_wood":  await this._taskGatherWood(args.count || 20); break;
        case "gather_stone": await this._taskGatherBlock("cobblestone", args.count || 32, "Добываю камень"); break;
        case "gather_food":  await this._taskGatherFood(); break;
        case "build_farm":   await this._taskBuildFarm(args.size || 4); break;
        case "build_house":  await this._taskBuildHouse(); break;
        case "craft":        await this._taskCraft(args.item, args.count || 1); break;
        case "attack":       await this._taskAttackMob(args.target); break;
        case "walk_to":      await this._taskWalkTo(args.x, args.y, args.z); break;
        case "explore":      await this._taskExplore(); break;
        case "inventory":    this._reportInventory(); break;
        case "status":       this._reportStatus(); break;
        default:
          this._chat("Не знаю как это сделать");
      }
    } catch (err) {
      log.error("Task error:", err.message);
      this._chat("Ой, не получилось: " + err.message.slice(0, 50));
    }

    this._running = false;
    this.currentTask = null;
  }

  async _taskComeToPlayer(playerName) {
    const target = this._findPlayer(playerName);
    if (!target) {
      this._chat(playerName ? "Не вижу игрока " + playerName : "Не вижу никого рядом");
      return;
    }
    this._chat("Иду к тебе, " + target.username + "!");
    await this.bot.pathfinder.goto(
      new goals.GoalNear(target.position.x, target.position.y, target.position.z, 2)
    ).catch(() => {});
    this._chat("Я здесь!");
  }

  async _taskFollowPlayer(playerName) {
    const target = this._findPlayer(playerName);
    if (!target) {
      this._chat("Не вижу " + (playerName || "тебя"));
      return;
    }
    this._chat("Слежу за " + target.username + "! Напиши 'стоп' чтобы остановить");
    const deadline = Date.now() + 300_000; // 5 минут максимум

    while (this._running && Date.now() < deadline && target.isValid) {
      await this.bot.pathfinder.goto(new goals.GoalFollow(target, 2)).catch(() => {});
      await this._sleep(500);
    }
  }

  async _taskGatherWood(count) {
    this._chat("Иду рубить дерево, нужно " + count + " бревён!");
    const logIds = ["oak_log","birch_log","spruce_log","jungle_log","acacia_log","dark_oak_log","mangrove_log","cherry_log"]
      .map(n => this.bot.registry.blocksByName[n]?.id)
      .filter(Boolean);

    let collected = 0;
    while (this._running && collected < count) {
      const block = this.bot.findBlock({ matching: logIds, maxDistance: 64 });
      if (!block) { this._chat("Нет деревьев рядом!"); break; }

      await this.bot.pathfinder.goto(
        new goals.GoalBlock(block.position.x, block.position.y, block.position.z)
      ).catch(() => {});
      if (!this._running) break;

      await this.bot.dig(block).catch(() => {});
      collected++;
      if (collected % 5 === 0) this._log("Собрано " + collected + "/" + count + " бревён");
    }
    this._chat("Готово! Собрал " + collected + " бревён");
  }

  async _taskGatherBlock(blockName, count, label) {
    this._chat((label || "Добываю " + blockName) + "...");
    const blockType = this.bot.registry.blocksByName[blockName];
    if (!blockType) { this._chat("Не знаю блок: " + blockName); return; }

    let collected = 0;
    while (this._running && collected < count) {
      const block = this.bot.findBlock({ matching: blockType.id, maxDistance: 32 });
      if (!block) { this._chat("Не нашёл рядом!"); break; }
      await this.bot.pathfinder.goto(
        new goals.GoalBlock(block.position.x, block.position.y, block.position.z)
      ).catch(() => {});
      if (!this._running) break;
      await this.bot.dig(block).catch(() => {});
      collected++;
    }
    this._chat("Добыл " + collected + " " + blockName);
  }

  async _taskGatherFood() {
    this._chat("Ищу еду...");
    const animalNames = ["cow", "pig", "sheep", "chicken"];
    for (const name of animalNames) {
      const entity = Object.values(this.bot.entities).find(
        e => e.name === name && e.position.distanceTo(this.bot.entity.position) < 32
      );
      if (entity) {
        this._chat("Нашёл " + name + ", атакую!");
        for (let i = 0; i < 8 && this._running && entity.isValid; i++) {
          await this.bot.pathfinder.goto(new goals.GoalFollow(entity, 1)).catch(() => {});
          this.bot.attack(entity);
          await this._sleep(600);
        }
        return;
      }
    }
    this._chat("Нет животных рядом");
  }

  async _taskBuildFarm(size) {
    this._chat("Строю ферму " + size + "x" + size + "!");
    if (!this.bot?.entity) return;

    const seedItem = this.bot.inventory.items().find(i =>
      ["wheat_seeds","seeds","carrot","potato","beetroot_seeds"].includes(i.name)
    );
    if (!seedItem) {
      this._chat("Нет семян! Нужны wheat_seeds (семена пшеницы)");
      return;
    }

    const hoe = this.bot.inventory.items().find(i => i.name.includes("hoe"));
    const pos = this.bot.entity.position.clone().floor();
    let planted = 0;

    for (let dx = 0; dx < size && this._running; dx++) {
      for (let dz = 0; dz < size && this._running; dz++) {
        const tp = pos.offset(dx, 0, dz);
        await this.bot.pathfinder.goto(new goals.GoalNear(tp.x, tp.y, tp.z, 2)).catch(() => {});
        if (!this._running) break;

        const block = this.bot.blockAt(tp);
        if (!block) continue;

        if (hoe && (block.name === "dirt" || block.name === "grass_block")) {
          await this.bot.equip(hoe, "hand").catch(() => {});
          await this.bot.activateBlock(block).catch(() => {});
          await this._sleep(200);
        }

        await this.bot.equip(seedItem, "hand").catch(() => {});
        const tilled = this.bot.blockAt(tp);
        if (tilled) {
          await this.bot.activateBlock(tilled).catch(() => {});
          planted++;
        }
        await this._sleep(100);
      }
    }
    this._chat("Ферма готова! Посадил " + planted + " семян");
  }

  async _taskBuildHouse() {
    this._chat("Строю домик!");
    const buildBlock = this.bot.inventory.items().find(i =>
      i.name.includes("planks") || i.name.includes("cobblestone") || i.name.includes("log")
    );
    if (!buildBlock || buildBlock.count < 24) {
      this._chat("Нужно минимум 24 блока (доски/камень). Есть: " + (buildBlock?.count || 0));
      return;
    }
    await this.bot.equip(buildBlock, "hand").catch(() => {});
    const pos = this.bot.entity.position.clone().floor();
    let placed = 0;

    // Простой периметр 5x5, 3 блока высотой
    const size = 5;
    for (let y = 0; y < 3 && this._running; y++) {
      for (let dx = 0; dx < size && this._running; dx++) {
        for (let dz = 0; dz < size && this._running; dz++) {
          if (dx === 0 || dx === size-1 || dz === 0 || dz === size-1) {
            const tp = pos.offset(dx, y, dz);
            await this.bot.pathfinder.goto(new goals.GoalNear(tp.x, tp.y, tp.z, 3)).catch(() => {});
            const below = this.bot.blockAt(tp.offset(0, -1, 0));
            if (below) {
              await this.bot.placeBlock(below, new (require("vec3"))(0,1,0)).catch(() => {});
              placed++;
            }
            await this._sleep(100);
          }
        }
      }
    }
    this._chat("Домик готов! Поставил " + placed + " блоков");
  }

  async _taskCraft(itemName, count) {
    if (!itemName) { this._chat("Что скрафтить?"); return; }
    this._chat("Крафчу " + itemName + "...");
    const item = this.bot.registry.itemsByName[itemName];
    if (!item) { this._chat("Не знаю предмет: " + itemName); return; }
    const table = this.bot.findBlock({
      matching: this.bot.registry.blocksByName["crafting_table"]?.id,
      maxDistance: 16,
    });
    try {
      const recipe = this.bot.recipesFor(item.id, null, 1, table)[0];
      if (!recipe) { this._chat("Нет рецепта для " + itemName); return; }
      await this.bot.craft(recipe, count, table);
      this._chat("Готово! Скрафтил " + count + " " + itemName);
    } catch (err) {
      this._chat("Не получилось: " + err.message.slice(0, 50));
    }
  }

  async _taskAttackMob(targetName) {
    const entity = Object.values(this.bot.entities).find(e => {
      if (e.username === this.bot.username) return false;
      const nm = (e.name || "").toLowerCase();
      const dn = (e.displayName || "").toLowerCase();
      const tn = (targetName || "").toLowerCase();
      return (!tn || nm === tn || dn.includes(tn)) && e.position.distanceTo(this.bot.entity.position) < 32;
    });
    if (!entity) {
      this._chat("Не вижу " + (targetName || "врага") + " рядом");
      return;
    }
    this._chat("Атакую " + (entity.displayName || entity.name) + "!");
    while (this._running && entity.isValid && entity.health > 0) {
      await this.bot.pathfinder.goto(new goals.GoalFollow(entity, 2)).catch(() => {});
      this.bot.attack(entity);
      await this._sleep(500);
    }
    this._chat((entity.displayName || entity.name) + " побеждён!");
  }

  async _taskWalkTo(x, y, z) {
    if (x === undefined || x === null) return;
    const fy = y !== undefined && y !== null ? Math.round(y) : Math.round(this.bot.entity.position.y);
    this._chat("Иду к " + Math.round(x) + " " + fy + " " + Math.round(z));
    await this.bot.pathfinder.goto(new goals.GoalBlock(Math.round(x), fy, Math.round(z))).catch(() => {});
    this._chat("Пришёл!");
  }

  async _taskExplore() {
    this._chat("Исследую окрестности!");
    for (let i = 0; i < 5 && this._running; i++) {
      const dx = Math.floor(Math.random() * 60 - 30);
      const dz = Math.floor(Math.random() * 60 - 30);
      const p = this.bot.entity.position;
      await this.bot.pathfinder.goto(new goals.GoalNear(p.x + dx, p.y, p.z + dz, 2)).catch(() => {});
      await this._sleep(1200);
    }
    this._chat("Исследование завершено!");
  }

  _reportInventory() {
    const items = this.bot.inventory.items();
    if (!items.length) { this._chat("Инвентарь пустой"); return; }
    const top = items.sort((a,b) => b.count - a.count).slice(0,5)
      .map(i => (i.displayName || i.name) + " x" + i.count).join(", ");
    this._chat("Инвентарь: " + top);
  }

  _reportStatus() {
    const s = this.instance.stats;
    this._chat("HP:" + Math.round(s.health) + "/20 Еда:" + Math.round(s.food) + "/20 XP:" + s.experience + " Позиция:" + s.x + " " + s.y + " " + s.z);
  }

  _findPlayer(name) {
    return Object.values(this.bot.entities).find(e =>
      e.type === "player" &&
      e.username !== this.bot.username &&
      (!name || e.username?.toLowerCase().includes(name.toLowerCase()))
    ) || null;
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

// ===================================================================
// ПАРСЕР КОМАНД ИЗ ЧАТА (русский язык → задача)
// ===================================================================
function parseCommand(message, botName) {
  const raw = message.trim();
  const msg = raw.toLowerCase();
  const nick = (botName || "").toLowerCase();

  // Обращение к боту: по нику, "бот,", или команда начинается без имени если короткая
  const addressed = !nick ||
    msg.includes(nick) ||
    /^бот[ ,!]|^bot[ ,!]/.test(msg) ||
    msg.startsWith("!") ||
    msg.length < 20; // короткие сообщения — скорее команды

  if (!addressed) return null;

  // Чистим обращение
  const clean = msg
    .replace(new RegExp(nick, "g"), "")
    .replace(/^бот[ ,!]+|^bot[ ,!]+|^!/, "")
    .replace(/[,!?.]+/g, " ")
    .trim();

  // --- СТОП ---
  if (/^(стоп|stop|останов|хватит|отмен|замри)/.test(clean)) {
    return { task: "stop" };
  }

  // --- ИНВЕНТАРЬ ---
  if (/инвентар|что (у тебя|есть)|покажи (что|вещи)|items|inventory/.test(clean)) {
    return { task: "inventory" };
  }

  // --- СТАТУС ---
  if (/статус|жизн|сколько хп|где ты|позиц|координат|status/.test(clean)) {
    return { task: "status" };
  }

  // --- ПОДОЙДИ / ИДИ СЮДА ---
  if (/иди (сюда|ко мне|ко мн|до мене|здесь)|come( here| to me)?|подойди|ко мне/.test(clean)) {
    return { task: "come_to" };
  }

  // --- СЛЕДУЙ ---
  if (/следуй|следи за мной|иди за мной|follow/.test(clean)) {
    return { task: "follow" };
  }

  // --- ДЕРЕВО ---
  if (/руби|сруб|добудь дерев|принеси дерев|gather wood|заготов дерев/.test(clean)) {
    const m = clean.match(/(\d+)/);
    return { task: "gather_wood", count: m ? parseInt(m[1]) : 20 };
  }

  // --- КАМЕНЬ / COBBLE ---
  if (/добудь камень|накопай камн|камень|cobblestone|cobble/.test(clean)) {
    const m = clean.match(/(\d+)/);
    return { task: "gather_stone", count: m ? parseInt(m[1]) : 32 };
  }

  // --- ЕДА ---
  if (/найди еду|добудь еду|поохоться|убей (корову|свинью|курицу|овцу)|food|hunt/.test(clean)) {
    return { task: "gather_food" };
  }

  // --- ФЕРМА ---
  if (/построй ферм|сделай ферм|посади (семена|пшениц|ферм|огород)|farm/.test(clean)) {
    const m = clean.match(/(\d+)/);
    return { task: "build_farm", size: m ? Math.min(parseInt(m[1]), 8) : 4 };
  }

  // --- ДОМ ---
  if (/построй (дом|домик|укрытие|базу)|build (house|home|shelter)/.test(clean)) {
    return { task: "build_house" };
  }

  // --- АТАКА ---
  const mobMap = {
    "зомби": "zombie", "скелет": "skeleton", "паук": "spider",
    "крипер": "creeper", "корова": "cow", "свинья": "pig",
    "курица": "chicken", "овца": "sheep", "эндермен": "enderman",
    "фантом": "phantom", "утопленник": "drowned", "zombie": "zombie",
    "skeleton": "skeleton", "creeper": "creeper",
  };
  if (/убей|атакуй|kill|attack|напади/.test(clean)) {
    for (const [ru, en] of Object.entries(mobMap)) {
      if (clean.includes(ru)) return { task: "attack", target: en };
    }
    return { task: "attack", target: null };
  }

  // --- КРАФТ ---
  const craftMap = {
    "верстак": "crafting_table", "стол": "crafting_table",
    "деревянный меч": "wooden_sword", "меч": "wooden_sword",
    "деревянная кирка": "wooden_pickaxe", "кирку": "wooden_pickaxe", "кирка": "wooden_pickaxe",
    "топор": "wooden_axe", "лопата": "wooden_shovel",
    "доски": "oak_planks", "факел": "torch", "лестница": "ladder",
  };
  if (/скрафти|сделай|изготов|craft/.test(clean)) {
    for (const [ru, en] of Object.entries(craftMap)) {
      if (clean.includes(ru)) return { task: "craft", item: en };
    }
    return { task: "craft", item: "crafting_table" };
  }

  // --- ИССЛЕДОВАНИЕ ---
  if (/исследуй|погуляй|похо|explore|прогуляйс/.test(clean)) {
    return { task: "explore" };
  }

  // --- КООРДИНАТЫ (3 числа) ---
  const coordM = clean.match(/(-?\d+)\s+(-?\d+)\s+(-?\d+)/);
  if (coordM) {
    return { task: "walk_to", x: parseInt(coordM[1]), y: parseInt(coordM[2]), z: parseInt(coordM[3]) };
  }

  return null; // не распознали → ответит AI
}

module.exports = { TaskManager, parseCommand };
