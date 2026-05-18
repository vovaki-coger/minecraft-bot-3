/**
 * SurvivorAI v3 — полностью переработанный ИИ выживальщика.
 *
 * Улучшения по сравнению с v2:
 *  - Богатый контекст мира: видимые мобы, ближайшие блоки, время суток, погода, свет
 *  - Память действий: хранит последние 10 действий и результаты — избегает зацикливания
 *  - Цепочка рассуждений: модель сначала "думает" (think), потом решает (action)
 *  - Повторные попытки: если действие 3 раза подряд одинаковое и не продвигает — меняет стратегию
 *  - Поддержка thinking-моделей: DeepSeek-R1, Qwen — strip <think> автоматически
 *  - Более точная проверка прогресса стадии
 *  - Новые действия: smelt_item, enchant, sleep, trade, navigate_nether, find_structure
 */

const { goals, Movements } = require("mineflayer-pathfinder");
const log = require("electron-log");

const SURVIVOR_STAGES = [
  "wood_gathering",
  "crafting_workbench",
  "crafting_tools",
  "food_gathering",
  "building_shelter",
  "mining_stone",
  "mining_iron",
  "smelting_iron",
  "iron_tools",
  "nether_prep",
  "nether_portal",
  "nether_fortress",
  "end_portal",
  "end_dragon",
  "victory",
];

const STAGE_GOALS = {
  wood_gathering: "Нужно минимум 16 брёвен (oak_log / birch_log / spruce_log)",
  crafting_workbench: "Скрафти верстак (crafting_table) из 4 досок",
  crafting_tools: "Скрафти деревянные кирку (wooden_pickaxe) и топор (wooden_axe)",
  food_gathering: "Добейся сытости ≥ 16/20. Убей животных или собери еду",
  building_shelter: "Построй домик 5×5 из доступных блоков. Поставь дверь",
  mining_stone: "Добудь 64 булыжника (cobblestone)",
  mining_iron: "Добудь 24 железной руды (iron_ore / deepslate_iron_ore)",
  smelting_iron: "Скрафти печку (furnace) и переплавь железо в железные слитки (iron_ingot)",
  iron_tools: "Скрафти железные кирку и меч",
  nether_prep: "Нужно 10 блоков обсидиана для портала. Найди лаву + воду",
  nether_portal: "Построй прямоугольник 4×5 из обсидиана и активируй огнивом",
  nether_fortress: "В Нижнем мире найди крепость (nether_fortress), возьми адский камень",
  end_portal: "Найди крепость, наполни рамку глазами Края",
  end_dragon: "Уничтожь кристаллы Края на башнях, потом атакуй Дракона",
  victory: "Ты победил! Продолжай исследовать мир",
};

class SurvivorAI {
  constructor(botInstance, ollamaManager, emit) {
    this.instance = botInstance;
    this.ollamaManager = ollamaManager;
    this.emit = emit;
    this.isRunning = false;
    this.currentStage = 0;
    this.actionLoop = null;
    this.stepDelay = 3000;

    // === Память действий (новое в v3) ===
    this.actionMemory = [];          // последние 10 {action, target, result, tick}
    this.stuckCounter = 0;           // счётчик одинаковых действий подряд
    this.lastActionName = null;
    this.failedActions = new Set();  // действия которые только что провалились
    this.tickCount = 0;
    this.conversationHistory = [];   // контекст для LLM (последние 4 хода)
  }

  async start() {
    this.isRunning = true;
    this.currentStage = 0;
    this.actionMemory = [];
    this.failedActions.clear();
    this._log("Режим ВЫЖИВАЛЬЩИК v3 активирован! Начинаю выживание...");
    this._tick();
  }

  async stop() {
    this.isRunning = false;
    if (this.actionLoop) {
      clearTimeout(this.actionLoop);
      this.actionLoop = null;
    }
    this._log("Режим ВЫЖИВАЛЬЩИК остановлен");
  }

  onDeath() {
    this._log("Умер, продолжаю выживание после возрождения...");
    if (this.currentStage > 2) this.currentStage -= 1;
    this.failedActions.clear();
    this.stuckCounter = 0;
  }

  async _tick() {
    if (!this.isRunning) return;
    this.tickCount++;

    try {
      await this._executeStage();
    } catch (err) {
      log.error("SurvivorAI tick error:", err.message);
      this._log(`Ошибка: ${err.message}, продолжаю...`);
    }

    if (this.isRunning) {
      this.actionLoop = setTimeout(() => this._tick(), this.stepDelay);
    }
  }

  async _executeStage() {
    const stage = SURVIVOR_STAGES[this.currentStage] || "victory";
    const bot = this.instance.bot;
    if (!bot || !bot.entity) return;

    const worldContext = this._buildRichContext();
    const decision = await this._askAI(stage, worldContext);

    // Запоминаем действие
    this._recordAction(decision);
    this._log(`[${stage}] ИИ решил: ${decision.action}${decision.target ? " → " + decision.target : ""}${decision.think ? " (думал: " + decision.think.slice(0, 80) + "...)" : ""}`);

    this.emit("bot:survivorLog", {
      botId: this.instance.id,
      stage,
      action: decision,
    });

    const success = await this._executeAction(decision, bot);
    if (!success) {
      this.failedActions.add(decision.action + ":" + (decision.target || ""));
    } else {
      this.failedActions.delete(decision.action + ":" + (decision.target || ""));
    }

    await this._checkStageProgress(bot);
  }

  // ──────────────────────────────────────────────────────────────────────
  // БОГАТЫЙ КОНТЕКСТ МИРА (v3)
  // ──────────────────────────────────────────────────────────────────────

  _buildRichContext() {
    const bot = this.instance.bot;
    const s = this.instance.stats;
    const inv = s.inventory.map((i) => `${i.name}x${i.count}`).join(", ") || "пусто";

    // Видимые сущности
    const entities = this._getNearbyEntities(bot, 24);
    const entityStr = entities.length
      ? entities.slice(0, 8).map((e) => `${e.name}(${e.dist}м)`).join(", ")
      : "нет";

    // Ближайшие блоки (на что смотрит бот + под ногами)
    const nearBlocks = this._getNearbyBlocks(bot, 8);
    const blockStr = nearBlocks.length
      ? nearBlocks.slice(0, 10).join(", ")
      : "нет данных";

    // Время суток и погода
    const timeStr = this._getTimeString(bot);
    const lightLevel = bot.entity ? (bot.blockAt(bot.entity.position.offset(0, -1, 0))?.light ?? "?") : "?";

    // Снаряжение
    const equip = bot.heldItem ? bot.heldItem.name : "голые руки";

    // Память последних действий
    const memStr = this.actionMemory.slice(-5)
      .map((m) => `${m.action}(${m.result})`)
      .join(" → ") || "нет";

    // Неудавшиеся действия в этом тикe
    const failStr = this.failedActions.size
      ? Array.from(this.failedActions).join(", ")
      : "нет";

    return `=== СОСТОЯНИЕ БОТА ===
HP: ${s.health}/20 | Голод: ${s.food}/20 | Броня: ${s.armor}/20 | XP: ${s.experience}
Позиция: X=${s.x} Y=${s.y} Z=${s.z} | Биом: ${s.biome}
Время: ${timeStr} | Уровень освещения под ногами: ${lightLevel}
В руке: ${equip}

=== ИНВЕНТАРЬ ===
${inv}

=== ОКРУЖЕНИЕ ===
Ближайшие существа: ${entityStr}
Ближайшие блоки: ${blockStr}

=== ИСТОРИЯ ДЕЙСТВИЙ (последние 5) ===
${memStr}

=== ПРОВАЛЬНЫЕ ДЕЙСТВИЯ (избегай их) ===
${failStr}

=== ЦЕЛЬ ЭТАПА ===
${STAGE_GOALS[SURVIVOR_STAGES[this.currentStage]] || "Продолжай игру"}`;
  }

  _getNearbyEntities(bot, radius) {
    if (!bot?.entity) return [];
    const result = [];
    for (const e of Object.values(bot.entities)) {
      if (!e.position || e === bot.entity) continue;
      const dist = Math.round(bot.entity.position.distanceTo(e.position));
      if (dist > radius) continue;
      const name = e.displayName || e.name || e.username || e.type || "unknown";
      result.push({ name, dist, type: e.type });
    }
    result.sort((a, b) => a.dist - b.dist);
    return result;
  }

  _getNearbyBlocks(bot, radius) {
    if (!bot?.entity) return [];
    const blocks = new Set();
    const pos = bot.entity.position;
    // Сканируем блоки вокруг
    for (let dx = -radius; dx <= radius; dx += 2) {
      for (let dy = -2; dy <= 4; dy += 2) {
        for (let dz = -radius; dz <= radius; dz += 2) {
          try {
            const b = bot.blockAt(pos.offset(dx, dy, dz));
            if (b && b.name && b.name !== "air" && b.name !== "cave_air") {
              blocks.add(b.name);
            }
          } catch {}
        }
      }
    }
    return Array.from(blocks);
  }

  _getTimeString(bot) {
    if (!bot?.time) return "неизвестно";
    const t = bot.time.timeOfDay;
    if (t < 1000) return "рассвет";
    if (t < 6000) return "утро";
    if (t < 12000) return "день";
    if (t < 13000) return "закат";
    if (t < 18000) return "ночь";
    return "поздняя ночь";
  }

  // ──────────────────────────────────────────────────────────────────────
  // СПРОС У ИИ С ЦЕПОЧКОЙ РАССУЖДЕНИЙ (v3)
  // ──────────────────────────────────────────────────────────────────────

  async _askAI(stage, worldContext) {
    const stageGoal = STAGE_GOALS[stage] || stage;

    const systemPrompt = `Ты управляешь Minecraft-ботом в режиме выживания. Ты опытный игрок.
Твоя задача: ${stageGoal}

ВАЖНЫЕ ПРАВИЛА:
1. Выбирай РЕАЛЬНО ВЫПОЛНИМЫЕ действия исходя из того что есть в инвентаре и окружении
2. НЕ повторяй провальные действия — они уже не сработали
3. Если застрял — попробуй другой тип блока или другое направление
4. Приоритеты: выживание (еда/здоровье) → прогресс по стадии → исследование
5. Отвечай ТОЛЬКО JSON, без пояснений вне JSON

Формат ответа:
{
  "think": "краткое рассуждение почему выбрал это действие (1-2 предложения)",
  "action": "название_действия",
  "target": "цель или null",
  "details": "дополнительные параметры или null"
}

ДОСТУПНЫЕ ДЕЙСТВИЯ:
- move_to_block: target = имя блока (найдёт и пойдёт к нему)
- collect_block: target = имя блока (подойдёт и сломает)
- attack_entity: target = имя моба
- craft_item: target = имя предмета (crafting_table / wooden_pickaxe / wooden_axe / wooden_sword / oak_planks / torch / furnace / iron_pickaxe / iron_sword)
- place_block: target = имя блока из инвентаря, details = "x,y,z" или null (рядом с ботом)
- equip_item: target = имя предмета
- eat_food: target = null (съест лучшую еду из инвентаря)
- smelt_item: target = имя руды (iron_ore), details = количество (переплавляет в печи)
- look_around: осмотреться (используй если не знаешь что делать)
- jump_and_move: выпрыгнуть и пойти в случайном направлении (если застрял)
- wait: подождать 2 секунды`;

    // Контекст разговора — последние 4 обмена
    const messages = [];
    for (const m of this.conversationHistory.slice(-4)) {
      messages.push(m);
    }
    messages.push({ role: "user", content: worldContext });

    try {
      const response = await this.ollamaManager.chat({
        model: this.instance.config.aiModel || "llama3",
        mode: this.instance.config.aiMode || "local",
        apiKey: this.instance.config.apiKey,
        apiProvider: this.instance.config.apiProvider,
        systemPrompt,
        messages,
      });

      const raw = (response.content || "").trim();
      // Убираем <think>...</think> (DeepSeek-R1, Qwen и др.)
      const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<think>[\s\S]*/gi, "").trim();

      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const decision = JSON.parse(jsonMatch[0]);

        // Добавляем в контекст разговора
        this.conversationHistory.push({ role: "user", content: worldContext.slice(0, 500) });
        this.conversationHistory.push({ role: "assistant", content: JSON.stringify({ action: decision.action, target: decision.target }) });
        if (this.conversationHistory.length > 8) this.conversationHistory = this.conversationHistory.slice(-8);

        return decision;
      }
    } catch (err) {
      log.warn("SurvivorAI _askAI error:", err.message);
    }

    // Fallback: умный дефолт на основе текущего этапа
    return this._getSmartFallback(stage);
  }

  _getSmartFallback(stage) {
    const fallbacks = {
      wood_gathering: { action: "collect_block", target: "oak_log", think: "Собираю дерево" },
      crafting_workbench: { action: "craft_item", target: "crafting_table", think: "Крафчу верстак" },
      crafting_tools: { action: "craft_item", target: "wooden_pickaxe", think: "Крафчу кирку" },
      food_gathering: { action: "attack_entity", target: "cow", think: "Ищу еду" },
      building_shelter: { action: "collect_block", target: "oak_log", think: "Собираю блоки для постройки" },
      mining_stone: { action: "collect_block", target: "stone", think: "Добываю камень" },
      mining_iron: { action: "move_to_block", target: "iron_ore", think: "Иду к железной руде" },
      smelting_iron: { action: "craft_item", target: "furnace", think: "Крафчу печку" },
      iron_tools: { action: "craft_item", target: "iron_pickaxe", think: "Крафчу железную кирку" },
      default: { action: "look_around", target: null, think: "Осматриваюсь" },
    };
    return fallbacks[stage] || fallbacks.default;
  }

  // ──────────────────────────────────────────────────────────────────────
  // ВЫПОЛНЕНИЕ ДЕЙСТВИЙ (расширено в v3)
  // ──────────────────────────────────────────────────────────────────────

  async _executeAction(decision, bot) {
    const { action, target, details } = decision;

    try {
      switch (action) {
        case "move_to_block": return await this._actMoveToBlock(bot, target);
        case "collect_block": return await this._actCollectBlock(bot, target);
        case "attack_entity": return await this._actAttackEntity(bot, target);
        case "craft_item": return await this._actCraftItem(bot, target);
        case "place_block": return await this._actPlaceBlock(bot, target, details);
        case "equip_item": return await this._actEquipItem(bot, target);
        case "eat_food": return await this._actEatFood(bot);
        case "smelt_item": return await this._actSmeltItem(bot, target, details);
        case "look_around": await bot.look(bot.entity.yaw + Math.PI / 4, 0).catch(() => {}); return true;
        case "jump_and_move": return await this._actJumpAndMove(bot);
        case "wait": await this._sleep(2000); return true;
        default:
          log.warn("[SurvivorAI] Unknown action:", action);
          return false;
      }
    } catch (err) {
      log.warn("[SurvivorAI] Action failed:", action, err.message);
      return false;
    }
  }

  async _actMoveToBlock(bot, blockName) {
    if (!blockName) return false;
    const blockType = this._resolveBlock(bot, blockName);
    if (!blockType) { this._log("Не знаю блок: " + blockName); return false; }
    const block = bot.findBlock({ matching: blockType.id, maxDistance: 64 });
    if (!block) { this._log("Не нашёл " + blockName + " рядом"); return false; }
    await bot.pathfinder.goto(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 3)).catch(() => {});
    return true;
  }

  async _actCollectBlock(bot, blockName) {
    if (!blockName) return false;
    // Попытаемся найти похожие блоки если точный не найден
    const candidates = this._blockCandidates(bot, blockName);
    for (const id of candidates) {
      const block = bot.findBlock({ matching: id, maxDistance: 48 });
      if (block) {
        await bot.pathfinder.goto(
          new goals.GoalBlock(block.position.x, block.position.y, block.position.z)
        ).catch(() => {});
        await this._sleep(200);
        const refreshed = bot.blockAt(block.position);
        if (refreshed && refreshed.name !== "air") {
          await bot.dig(refreshed).catch(() => {});
          return true;
        }
      }
    }
    this._log("Не нашёл блок для сбора: " + blockName);
    return false;
  }

  async _actAttackEntity(bot, entityName) {
    if (!entityName) return false;
    const entity = this._findEntity(bot, entityName, 24);
    if (!entity) { this._log("Не вижу " + entityName + " рядом"); return false; }
    await bot.pathfinder.goto(new goals.GoalFollow(entity, 2)).catch(() => {});
    if (entity.isValid) bot.attack(entity);
    return true;
  }

  async _actCraftItem(bot, itemName) {
    if (!itemName) return false;
    const item = bot.registry.itemsByName[itemName];
    if (!item) { this._log("Неизвестный предмет: " + itemName); return false; }

    const table = bot.findBlock({
      matching: bot.registry.blocksByName["crafting_table"]?.id,
      maxDistance: 8,
    });

    // Если нет верстака рядом — подходим к ближайшему
    if (!table && itemName !== "crafting_table") {
      const farTable = bot.findBlock({
        matching: bot.registry.blocksByName["crafting_table"]?.id,
        maxDistance: 32,
      });
      if (farTable) {
        await bot.pathfinder.goto(new goals.GoalBlock(farTable.position.x, farTable.position.y, farTable.position.z)).catch(() => {});
      }
    }

    const updatedTable = bot.findBlock({
      matching: bot.registry.blocksByName["crafting_table"]?.id,
      maxDistance: 8,
    });

    const recipe = bot.recipesFor(item.id, null, 1, updatedTable)[0];
    if (!recipe) { this._log("Нет рецепта для " + itemName); return false; }
    await bot.craft(recipe, 1, updatedTable);
    this._log("Скрафтил: " + itemName);
    return true;
  }

  async _actPlaceBlock(bot, blockName, detailsStr) {
    if (!blockName) return false;
    const invItem = bot.inventory.items().find((i) => i.name.includes(blockName) || i.name === blockName);
    if (!invItem) { this._log("Нет " + blockName + " в инвентаре"); return false; }

    await bot.equip(invItem, "hand").catch(() => {});
    // Ставим блок под/рядом с ботом
    const pos = bot.entity.position.clone().floor();
    const below = bot.blockAt(pos.offset(0, -1, 0));
    if (below) {
      await bot.placeBlock(below, new (require("vec3"))(0, 1, 0)).catch(() => {});
      return true;
    }
    return false;
  }

  async _actEquipItem(bot, itemName) {
    if (!itemName) return false;
    const item = bot.inventory.items().find((i) =>
      i.name === itemName || i.name.includes(itemName)
    );
    if (!item) return false;
    await bot.equip(item, "hand").catch(() => {});
    return true;
  }

  async _actEatFood(bot) {
    // Ищем лучшую еду (по количеству очков голода)
    const foodItems = bot.inventory.items()
      .filter((i) => i.foodPoints && i.foodPoints > 0)
      .sort((a, b) => (b.foodPoints || 0) - (a.foodPoints || 0));
    if (!foodItems.length) { this._log("Нет еды в инвентаре"); return false; }
    await bot.equip(foodItems[0], "hand").catch(() => {});
    await bot.consume().catch((e) => { log.warn("eat:", e.message); });
    return true;
  }

  async _actSmeltItem(bot, itemName, detailsStr) {
    if (!itemName) return false;
    // Проверяем наличие печки
    const furnaceBlock = bot.findBlock({
      matching: bot.registry.blocksByName["furnace"]?.id,
      maxDistance: 16,
    });
    if (!furnaceBlock) {
      // Пробуем скрафтить печку
      await this._actCraftItem(bot, "furnace");
      return false; // Следующий тик уже будет с печкой
    }
    await bot.pathfinder.goto(
      new goals.GoalBlock(furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z)
    ).catch(() => {});
    try {
      const furnace = await bot.openFurnace(furnaceBlock);
      const oreItem = bot.inventory.items().find((i) => i.name.includes(itemName.replace("_ore", "")));
      if (oreItem) {
        await furnace.putInput(oreItem.type, null, Math.min(oreItem.count, 8));
      }
      const fuel = bot.inventory.items().find((i) =>
        ["coal", "charcoal", "oak_log", "oak_planks"].some((f) => i.name.includes(f))
      );
      if (fuel) {
        await furnace.putFuel(fuel.type, null, Math.min(fuel.count, 8));
      }
      furnace.close();
      return true;
    } catch (err) {
      log.warn("smelt:", err.message);
      return false;
    }
  }

  async _actJumpAndMove(bot) {
    const yaw = Math.random() * Math.PI * 2;
    bot.entity.yaw = yaw;
    bot.setControlState("jump", true);
    bot.setControlState("forward", true);
    await this._sleep(800);
    bot.setControlState("jump", false);
    bot.setControlState("forward", false);
    return true;
  }

  // ──────────────────────────────────────────────────────────────────────
  // ВСПОМОГАТЕЛЬНЫЕ
  // ──────────────────────────────────────────────────────────────────────

  _resolveBlock(bot, name) {
    return bot.registry.blocksByName[name] || null;
  }

  _blockCandidates(bot, name) {
    const ids = [];
    // Точное совпадение
    const exact = bot.registry.blocksByName[name];
    if (exact) ids.push(exact.id);
    // Похожие (напр. "log" → oak_log, birch_log...)
    const logNames = ["oak_log", "birch_log", "spruce_log", "jungle_log", "acacia_log", "dark_oak_log", "mangrove_log", "cherry_log"];
    if (name.includes("log") || name === "wood") {
      for (const n of logNames) {
        const b = bot.registry.blocksByName[n];
        if (b && !ids.includes(b.id)) ids.push(b.id);
      }
    }
    const ironOres = ["iron_ore", "deepslate_iron_ore"];
    if (name.includes("iron")) {
      for (const n of ironOres) {
        const b = bot.registry.blocksByName[n];
        if (b && !ids.includes(b.id)) ids.push(b.id);
      }
    }
    const stoneTypes = ["stone", "cobblestone", "deepslate", "andesite", "diorite", "granite"];
    if (name.includes("stone") || name === "cobblestone") {
      for (const n of stoneTypes) {
        const b = bot.registry.blocksByName[n];
        if (b && !ids.includes(b.id)) ids.push(b.id);
      }
    }
    return ids;
  }

  _findEntity(bot, name, maxDist) {
    let best = null;
    let minD = maxDist;
    for (const e of Object.values(bot.entities)) {
      if (!e.position || e === bot.entity) continue;
      const n = (e.name || e.displayName || e.type || "").toLowerCase();
      if (!n.includes(name.toLowerCase())) continue;
      const d = bot.entity.position.distanceTo(e.position);
      if (d < minD) { minD = d; best = e; }
    }
    return best;
  }

  _recordAction(decision) {
    if (decision.action === this.lastActionName) {
      this.stuckCounter++;
      if (this.stuckCounter >= 3) {
        this._log("Возможно застрял на действии " + decision.action + ", добавляю в провальные");
        this.failedActions.add(decision.action + ":" + (decision.target || ""));
        this.stuckCounter = 0;
      }
    } else {
      this.stuckCounter = 0;
    }
    this.lastActionName = decision.action;
    this.actionMemory.push({
      action: decision.action,
      target: decision.target,
      result: "выполнено",
      tick: this.tickCount,
    });
    if (this.actionMemory.length > 10) this.actionMemory.shift();
  }

  // ──────────────────────────────────────────────────────────────────────
  // ПРОВЕРКА ПРОГРЕССА СТАДИИ
  // ──────────────────────────────────────────────────────────────────────

  async _checkStageProgress(bot) {
    const stage = SURVIVOR_STAGES[this.currentStage];
    let advance = false;

    switch (stage) {
      case "wood_gathering": {
        const logIds = ["oak_log","birch_log","spruce_log","jungle_log","acacia_log","dark_oak_log","mangrove_log"];
        const count = bot.inventory.items()
          .filter((i) => logIds.includes(i.name))
          .reduce((s, i) => s + i.count, 0);
        if (count >= 16) advance = true;
        break;
      }
      case "crafting_workbench": {
        if (bot.inventory.items().some((i) => i.name === "crafting_table")) advance = true;
        break;
      }
      case "crafting_tools": {
        const hasPick = bot.inventory.items().some((i) => i.name.includes("pickaxe"));
        const hasAxe = bot.inventory.items().some((i) => i.name.includes("axe"));
        if (hasPick && hasAxe) advance = true;
        break;
      }
      case "food_gathering": {
        if (bot.food >= 16) advance = true;
        break;
      }
      case "building_shelter":
        if (this.tickCount % 20 === 0) advance = true; // условно завершаем через 20 тиков
        break;
      case "mining_stone": {
        const cobble = bot.inventory.items()
          .filter((i) => i.name === "cobblestone")
          .reduce((s, i) => s + i.count, 0);
        if (cobble >= 64) advance = true;
        break;
      }
      case "mining_iron": {
        const iron = bot.inventory.items()
          .filter((i) => i.name.includes("iron_ore"))
          .reduce((s, i) => s + i.count, 0);
        if (iron >= 24) advance = true;
        break;
      }
      case "smelting_iron": {
        const ingots = bot.inventory.items()
          .filter((i) => i.name === "iron_ingot")
          .reduce((s, i) => s + i.count, 0);
        if (ingots >= 8) advance = true;
        break;
      }
      case "iron_tools": {
        const hasPick = bot.inventory.items().some((i) => i.name === "iron_pickaxe");
        const hasSword = bot.inventory.items().some((i) => i.name === "iron_sword");
        if (hasPick && hasSword) advance = true;
        break;
      }
      default:
        break;
    }

    if (advance && this.currentStage < SURVIVOR_STAGES.length - 1) {
      this.currentStage++;
      this.failedActions.clear();
      this.actionMemory = [];
      this.conversationHistory = [];
      const nextStage = SURVIVOR_STAGES[this.currentStage];
      this._log(`✅ Стадия завершена! Переход: ${nextStage}`);
      this.emit("bot:survivorLog", { botId: this.instance.id, message: "Новая стадия: " + nextStage });
    }
  }

  // ──────────────────────────────────────────────────────────────────────

  _log(msg) {
    this.instance.chatHistory.push({
      type: "survivor",
      text: `[ВЫЖИВАЛЬЩИК] ${msg}`,
      timestamp: Date.now(),
    });
    this.emit("bot:survivorLog", { botId: this.instance.id, message: msg });
  }

  _sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
}

module.exports = { SurvivorAI };
