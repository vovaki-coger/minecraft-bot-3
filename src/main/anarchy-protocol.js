/**
 * AnarchyProtocol — протокол анархии.
 *
 * Цикл:
 *  1. Выполняет задачу пользователя через AIBrain/Andy-4
 *  2. Когда инвентарь полон (>28 стаков) ИЛИ прошло N минут → идёт на базу (/home)
 *  3. На базе: складывает ресурсы в сундук, берёт еду и инструменты
 *  4. Возвращается к задаче
 *  5. Повторяет пока не остановят
 */

const { goals } = require("mineflayer-pathfinder");
const log = require("electron-log");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Предметы которые НЕ сдаём на базе (всегда носим с собой)
const KEEP_ITEMS = new Set([
  "iron_sword","diamond_sword","netherite_sword","stone_sword","wooden_sword",
  "iron_pickaxe","diamond_pickaxe","netherite_pickaxe","stone_pickaxe","wooden_pickaxe",
  "iron_axe","diamond_axe","netherite_axe","stone_axe","wooden_axe",
  "iron_shovel","diamond_shovel","netherite_shovel","stone_shovel","wooden_shovel",
  "iron_helmet","diamond_helmet","netherite_helmet","iron_chestplate","diamond_chestplate",
  "netherite_chestplate","iron_leggings","diamond_leggings","netherite_leggings",
  "iron_boots","diamond_boots","netherite_boots",
  "elytra","shield","bow","crossbow","trident",
  "torch","crafting_table","furnace",
  // Еда — берём с запасом, но сдаём излишки
]);

// Еда которую берём с базы
const FOOD_ITEMS = [
  "cooked_beef","cooked_porkchop","cooked_chicken","cooked_mutton",
  "cooked_salmon","cooked_cod","bread","golden_apple","enchanted_golden_apple",
  "golden_carrot","cooked_rabbit","mushroom_stew","suspicious_stew",
  "apple","carrot","baked_potato","dried_kelp",
];

class AnarchyProtocol {
  constructor(instance, ollamaManager, emit) {
    this.instance = instance;
    this.ollamaManager = ollamaManager;
    this.emit = emit;
    this.isRunning = false;
    this._task = "";
    this._homeCommand = "/home";
    this._cycleMinutes = 5;
    this._maxInventorySlots = 28;
    this._loop = null;
    this._phase = "idle";  // idle | task | going_home | depositing | resuming
    this._cycleCount = 0;
    this._log = [];
  }

  get bot() { return this.instance.bot; }

  // ── Запуск ──────────────────────────────────────────────────────────

  async start({ task, homeCommand = "/home", cycleMinutes = 5, maxInventory = 28 }) {
    if (this.isRunning) await this.stop();
    this._task = task;
    this._homeCommand = homeCommand;
    this._cycleMinutes = cycleMinutes;
    this._maxInventorySlots = maxInventory;
    this.isRunning = true;
    this._cycleCount = 0;
    this._log = [];

    this._addLog(`🏴‍☠️ Протокол анархии запущен. Задача: "${task}"`);
    this._addLog(`🏠 База: ${homeCommand} | Цикл: ${cycleMinutes} мин`);
    this.emit("bot:anarchyStarted", { botId: this.instance.id, task, homeCommand });

    this._runLoop();
  }

  stop() {
    this.isRunning = false;
    this._phase = "idle";
    if (this._loop) { clearTimeout(this._loop); this._loop = null; }
    this._addLog("🛑 Протокол анархии остановлен");
    this.emit("bot:anarchyStopped", { botId: this.instance.id });
    log.info("[Anarchy] Stopped");
  }

  getState() {
    return {
      isRunning: this.isRunning,
      task: this._task,
      homeCommand: this._homeCommand,
      phase: this._phase,
      cycleCount: this._cycleCount,
      log: this._log.slice(-50),
    };
  }

  // ── Главный цикл ────────────────────────────────────────────────────

  async _runLoop() {
    while (this.isRunning) {
      try {
        await this._doTaskPhase();
        if (!this.isRunning) break;
        await this._goHomeAndDeposit();
        if (!this.isRunning) break;
        this._cycleCount++;
        this._addLog(`✅ Цикл ${this._cycleCount} завершён. Возобновляю задачу...`);
      } catch (err) {
        log.error("[Anarchy] Loop error:", err.message);
        this._addLog(`⚠️ Ошибка: ${err.message}. Продолжаю...`);
        await sleep(5000);
      }
    }
  }

  // ── Фаза выполнения задачи ────────────────────────────────────────────

  async _doTaskPhase() {
    this._setPhase("task");
    const bot = this.bot;
    if (!bot?.entity) { await sleep(3000); return; }

    this._addLog(`⚙️ Выполняю задачу: "${this._task}"`);

    const startTime = Date.now();
    const maxMs = this._cycleMinutes * 60 * 1000;

    // Отправляем задачу в AIBrain
    if (this.instance.aiBrain) {
      this.instance.aiBrain.respondToPlayer("AnarchyProtocol", this._task).catch(() => {});
    } else {
      // Fallback: отправляем как Andy-4 команду напрямую
      bot.chat(this._task.slice(0, 100));
    }

    // Ждём N минут ИЛИ пока инвентарь не заполнится
    while (this.isRunning && (Date.now() - startTime) < maxMs) {
      await sleep(15000);  // проверяем каждые 15 секунд

      // Проверяем заполненность инвентаря
      const items = bot.inventory?.items() || [];
      if (items.length >= this._maxInventorySlots) {
        this._addLog(`📦 Инвентарь заполнен (${items.length} слотов). Иду на базу...`);
        break;
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const remaining = Math.round((maxMs - (Date.now() - startTime)) / 1000);

      if (elapsed % 60 < 15) {  // логируем раз в минуту
        const items_count = items.length;
        this._addLog(`⏱️ Задача: ${elapsed}с из ${this._cycleMinutes * 60}с | Инвентарь: ${items_count}/${this._maxInventorySlots}`);
      }

      // Повторно напоминаем AIBrain о задаче каждые 2 минуты
      if (elapsed > 0 && elapsed % 120 < 15 && this.instance.aiBrain) {
        this.instance.aiBrain.respondToPlayer("AnarchyProtocol", 
          `Продолжай задачу: ${this._task}`
        ).catch(() => {});
      }
    }
  }

  // ── Фаза возврата на базу ────────────────────────────────────────────

  async _goHomeAndDeposit() {
    const bot = this.bot;
    if (!bot?.entity) return;

    // 1. Останавливаем текущее движение
    this._setPhase("going_home");
    this._addLog(`🏠 Иду домой: ${this._homeCommand}`);

    try { bot.pathfinder.stop(); } catch {}
    await sleep(500);

    // 2. Отправляем /home команду
    bot.chat(this._homeCommand);

    // Ждём телепортацию (до 10 сек)
    const posBefore = bot.entity.position.clone();
    let teleported = false;
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      if (!bot.entity) break;
      const dist = bot.entity.position.distanceTo(posBefore);
      if (dist > 5) { teleported = true; break; }
    }

    if (!teleported) {
      this._addLog(`⚠️ Телепортация не сработала. Продолжаю без похода на базу.`);
      return;
    }

    this._addLog(`✅ Прибыл на базу!`);
    await sleep(2000);  // ждём загрузку чанков

    // 3. Ищем сундуки рядом
    this._setPhase("depositing");
    await this._depositToChest();

    // 4. Берём еду и материалы из сундука
    await this._takeSupplies();

    this._addLog(`✅ База готова. Возвращаюсь к задаче.`);
    this._setPhase("resuming");
    await sleep(1000);
  }

  // ── Сдать ресурсы в сундук ───────────────────────────────────────────

  async _depositToChest() {
    const bot = this.bot;
    const mcData = require("minecraft-data")(bot.version);

    // Ищем ближайший сундук
    const chestIds = [
      mcData.blocksByName["chest"]?.id,
      mcData.blocksByName["barrel"]?.id,
    ].filter(Boolean);

    const chestBlock = bot.findBlock({
      matching: b => chestIds.includes(b.type),
      maxDistance: 20,
    });

    if (!chestBlock) {
      this._addLog(`⚠️ Сундук не найден рядом с базой`);
      return;
    }

    // Подходим к сундуку
    try {
      await bot.pathfinder.goto(
        new goals.GoalNear(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 2)
      );
    } catch {}

    try {
      const chest = await bot.openContainer(chestBlock);
      await sleep(300);

      const items = bot.inventory.items();
      let deposited = 0;

      for (const item of items) {
        // Не сдаём инструменты, броню и ключевые предметы
        if (KEEP_ITEMS.has(item.name)) continue;
        // Не сдаём маленький запас еды (до 8 штук)
        if (FOOD_ITEMS.includes(item.name) && item.count <= 8) continue;

        try {
          await chest.deposit(item.type, null, item.count);
          deposited++;
          await sleep(100);
        } catch {}
      }

      await bot.closeWindow(chest);
      this._addLog(`📦 Сдал ${deposited} видов предметов в сундук`);
    } catch (err) {
      this._addLog(`⚠️ Ошибка при сдаче вещей: ${err.message}`);
    }
  }

  // ── Взять провизию из сундука ─────────────────────────────────────────

  async _takeSupplies() {
    const bot = this.bot;
    const mcData = require("minecraft-data")(bot.version);

    const chestIds = [
      mcData.blocksByName["chest"]?.id,
      mcData.blocksByName["barrel"]?.id,
    ].filter(Boolean);

    const chestBlock = bot.findBlock({
      matching: b => chestIds.includes(b.type),
      maxDistance: 20,
    });
    if (!chestBlock) return;

    try {
      await bot.pathfinder.goto(
        new goals.GoalNear(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 2)
      );

      const chest = await bot.openContainer(chestBlock);
      await sleep(300);

      const chestItems = chest.containerItems() || [];
      let took = 0;

      // Берём еду (до 32 штук)
      for (const item of chestItems) {
        if (!FOOD_ITEMS.includes(item.name)) continue;
        const inInv = bot.inventory.items().find(i => i.name === item.name);
        const alreadyHave = inInv?.count || 0;
        if (alreadyHave >= 16) continue;
        const toTake = Math.min(32 - alreadyHave, item.count);
        if (toTake <= 0) continue;
        try {
          await chest.withdraw(item.type, null, toTake);
          took++;
          await sleep(100);
        } catch {}
      }

      await bot.closeWindow(chest);
      if (took > 0) this._addLog(`🍖 Взял ${took} видов еды и ресурсов`);
    } catch (err) {
      this._addLog(`⚠️ Ошибка при взятии вещей: ${err.message}`);
    }
  }

  // ── Утилиты ─────────────────────────────────────────────────────────

  _setPhase(phase) {
    this._phase = phase;
    this.emit("bot:anarchyPhase", { botId: this.instance.id, phase });
  }

  _addLog(msg) {
    const entry = { msg, time: Date.now() };
    this._log.push(entry);
    if (this._log.length > 200) this._log.shift();
    log.info("[Anarchy]", msg);
    this.emit("bot:anarchyLog", { botId: this.instance.id, msg, time: entry.time });
  }
}

module.exports = { AnarchyProtocol };
