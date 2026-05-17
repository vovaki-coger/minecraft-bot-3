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
  "nether_prep",
  "nether_portal",
  "nether_fortress",
  "end_portal",
  "end_dragon",
  "victory",
];

class SurvivorAI {
  constructor(botInstance, ollamaManager, emit) {
    this.instance = botInstance;
    this.ollamaManager = ollamaManager;
    this.emit = emit;
    this.isRunning = false;
    this.currentStage = 0;
    this.actionLoop = null;
    this.stepDelay = 3000;
  }

  async start() {
    this.isRunning = true;
    this.currentStage = 0;
    this._log("Режим ВЫЖИВАЛЬЩИК активирован! Начинаю выживание...");
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
  }

  async _tick() {
    if (!this.isRunning) return;

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

    const context = this._buildContext();
    const decision = await this._askAI(stage, context);

    this._log(`[${stage}] ИИ решил: ${decision.action}`);
    this.emit("bot:survivorLog", {
      botId: this.instance.id,
      stage,
      action: decision,
    });

    await this._executeAction(decision, bot);
    await this._checkStageProgress(bot);
  }

  async _askAI(stage, context) {
    const stageDescriptions = {
      wood_gathering: "Собери дерево. Найди дерево и руби его.",
      crafting_workbench: "Скрафти верстак из досок.",
      crafting_tools: "Скрафти деревянные инструменты: кирку, топор, меч.",
      food_gathering: "Найди еду: убей животное или собери яблоки.",
      building_shelter: "Построй простое укрытие 5x5 из доступных блоков до ночи.",
      mining_stone: "Добудь камень для крафта каменных инструментов.",
      mining_iron: "Найди и добудь железную руду.",
      nether_prep: "Добудь обсидиан для нижнего портала (нужно 10 блоков).",
      nether_portal: "Построй и активируй портал в Нижний мир.",
      nether_fortress: "В Нижнем мире найди крепость и собери Адский камень.",
      end_portal: "Найди крепость и активируй портал Края.",
      end_dragon: "В Крае уничтожь кристаллы Края и убей дракона Края.",
      victory: "Ты победил! Продолжай исследовать мир.",
    };

    const prompt = `Ты управляешь Minecraft-ботом в режиме выживания.
Текущая задача: ${stageDescriptions[stage] || stage}

${context}

Выбери ОДНО конкретное действие и верни JSON:
{"action": "название_действия", "target": "цель или null", "details": "описание"}

Доступные действия: move_to_block, attack_entity, collect_block, craft_item, place_block, equip_item, eat_food, look_around, wait

Отвечай ТОЛЬКО JSON без пояснений.`;

    try {
      const response = await this.ollamaManager.chat({
        model: this.instance.config.aiModel || "llama3",
        mode: this.instance.config.aiMode || "local",
        apiKey: this.instance.config.apiKey,
        apiProvider: this.instance.config.apiProvider,
        systemPrompt: this.instance.config.systemPrompt,
        messages: [{ role: "user", content: prompt }],
      });

      const text = response.content.trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (err) {
      log.warn("AI decision error:", err.message);
    }

    return { action: "look_around", target: null, details: "Осматриваюсь" };
  }

  async _executeAction(decision, bot) {
    const { action, target } = decision;

    switch (action) {
      case "move_to_block": {
        const blockName = target;
        if (!blockName) break;
        const blockType = bot.registry.blocksByName[blockName];
        if (!blockType) break;
        const block = bot.findBlock({ matching: blockType.id, maxDistance: 64 });
        if (block) {
          await bot.pathfinder.goto(new goals.GoalBlock(block.position.x, block.position.y, block.position.z)).catch(() => {});
        }
        break;
      }

      case "attack_entity": {
        const entityName = target;
        const entity = Object.values(bot.entities).find(
          (e) => e.name === entityName && e.position.distanceTo(bot.entity.position) < 20
        );
        if (entity) {
          await bot.pathfinder.goto(new goals.GoalFollow(entity, 2)).catch(() => {});
          bot.attack(entity);
        }
        break;
      }

      case "collect_block": {
        const blockName = target;
        if (!blockName) break;
        const blockType = bot.registry.blocksByName[blockName];
        if (!blockType) break;
        const block = bot.findBlock({ matching: blockType.id, maxDistance: 32 });
        if (block) {
          await bot.dig(block).catch(() => {});
        }
        break;
      }

      case "craft_item": {
        const itemName = target;
        if (!itemName) break;
        const item = bot.registry.itemsByName[itemName];
        if (!item) break;
        const craftingTable = bot.findBlock({
          matching: bot.registry.blocksByName["crafting_table"]?.id,
          maxDistance: 8,
        });
        try {
          const recipe = bot.recipesFor(item.id, null, 1, craftingTable)[0];
          if (recipe) {
            await bot.craft(recipe, 1, craftingTable);
          }
        } catch {}
        break;
      }

      case "place_block": {
        break;
      }

      case "equip_item": {
        const itemName = target;
        if (!itemName) break;
        const item = bot.inventory.items().find((i) => i.name === itemName);
        if (item) {
          await bot.equip(item, "hand").catch(() => {});
        }
        break;
      }

      case "eat_food": {
        const food = bot.inventory.items().find((i) => i.foodPoints > 0);
        if (food) {
          await bot.equip(food, "hand").catch(() => {});
          await bot.consume().catch(() => {});
        }
        break;
      }

      case "look_around": {
        await bot.look(bot.entity.yaw + Math.PI / 4, 0).catch(() => {});
        break;
      }

      case "wait":
      default:
        await new Promise((r) => setTimeout(r, 1000));
        break;
    }
  }

  async _checkStageProgress(bot) {
    const stage = SURVIVOR_STAGES[this.currentStage];
    let advance = false;

    switch (stage) {
      case "wood_gathering": {
        const wood = bot.inventory.items().filter((i) => i.name.includes("log"));
        if (wood.reduce((s, i) => s + i.count, 0) >= 10) advance = true;
        break;
      }
      case "crafting_workbench": {
        const bench = bot.inventory.items().find((i) => i.name === "crafting_table");
        if (bench) advance = true;
        break;
      }
      case "crafting_tools": {
        const pickaxe = bot.inventory.items().find((i) => i.name.includes("pickaxe"));
        if (pickaxe) advance = true;
        break;
      }
      case "food_gathering": {
        if (bot.food >= 16) advance = true;
        break;
      }
      case "building_shelter":
        advance = true;
        break;
      case "mining_stone": {
        const stone = bot.inventory.items().filter((i) => i.name.includes("cobblestone"));
        if (stone.reduce((s, i) => s + i.count, 0) >= 32) advance = true;
        break;
      }
      case "mining_iron": {
        const iron = bot.inventory.items().filter((i) => i.name === "iron_ingot");
        if (iron.reduce((s, i) => s + i.count, 0) >= 16) advance = true;
        break;
      }
      default:
        break;
    }

    if (advance && this.currentStage < SURVIVOR_STAGES.length - 1) {
      this.currentStage++;
      this._log(`Переход к следующему этапу: ${SURVIVOR_STAGES[this.currentStage]}`);
    }
  }

  _buildContext() {
    const s = this.instance.stats;
    const inv = s.inventory.map((i) => `${i.name}x${i.count}`).join(", ");
    return `HP: ${s.health}/20, Голод: ${s.food}/20
Координаты: X=${s.x} Y=${s.y} Z=${s.z}
Инвентарь: ${inv || "пусто"}
Биом: ${s.biome}`;
  }

  _log(msg) {
    this.instance.chatHistory.push({
      type: "survivor",
      text: `[ВЫЖИВАЛЬЩИК] ${msg}`,
      timestamp: Date.now(),
    });
    this.emit("bot:survivorLog", { botId: this.instance.id, message: msg });
  }
}

module.exports = { SurvivorAI };
