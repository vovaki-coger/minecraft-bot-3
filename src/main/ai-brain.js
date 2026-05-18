/**
 * AIBrain v3 — мозг бота с нативной поддержкой Andy-4.
 *
 * Два режима работы:
 *  - ANDY4 MODE  (sweaterdog/andy-4, любая *andy* модель)
 *      Контекст в формате Stats/Nearby Blocks/Nearby Entities — именно так обучена модель.
 *      Ответы парсятся через andy4-parser (!commands).
 *  - REACT MODE  (любая другая модель: deepseek, qwen, llama...)
 *      ReAct-петля с JSON-инструментами.
 */

const { goals } = require("mineflayer-pathfinder");
const log = require("electron-log");
const { parseAndy4Response, executeAndy4Command, isAndy4Model, stripThinkBlocks } = require("./andy4-parser");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ══════════════════════════════════════════════════════════════
// ANDY-4 СИСТЕМНЫЙ ПРОМТ (формат обучения sweaterdog)
// ══════════════════════════════════════════════════════════════

function buildAndy4SystemPrompt(botConfig) {
  const name = botConfig.nick || "Andy";
  const custom = botConfig.systemPrompt || "";

  return `You are a Minecraft bot named ${name}. ${custom}
You are friendly, helpful, and capable of playing Minecraft autonomously.
You can perform tasks, answer questions, and take initiative to survive and thrive.

IMPORTANT RULES:
- Respond naturally in chat, then use !commands to take action
- Always prioritize survival: heal when hurt, eat when hungry, avoid danger
- Be proactive: if no task is given, find something useful to do
- Remember previous actions and don't repeat failures
- If in danger (health < 10), immediately flee or seek safety
- At night or when hostile mobs are near, be extra cautious
- Speak concisely in chat (1-2 sentences max)

AVAILABLE COMMANDS:
!goToPlayer("playerName", distance) - go to a specific player
!followPlayer("playerName", distance) - continuously follow a player
!goToXYZ(x, y, z) - move to specific coordinates
!stop() - stop current action
!collectBlock("blockType", count) - find and collect blocks (e.g. "oak_log", 10)
!searchForBlock("blockType", maxDistance) - find a specific block
!attackNearest("mobType") - attack nearest entity of this type
!defendSelf("mobType") - defend against nearest hostile
!craftItem("itemName", count) - craft an item (e.g. "crafting_table", 1)
!placeBlock("blockType", x, y, z) - place a block
!equipItem("itemName") - equip an item from inventory
!eatFood() - eat the best available food
!dropItem("itemName", count) - drop items from inventory
!searchForEntity("entityType") - look for a specific entity
!remember("key", "value") - remember something for later
!lookAt("playerName") - look at a player

When you want to do something in Minecraft, first say what you're going to do in chat,
then issue the !command. Example:
"I'll go find some wood for us! !collectBlock("oak_log", 10)"

If you can't do something, explain why honestly.
If you're just chatting and no action is needed, respond normally without commands.`;
}

// ══════════════════════════════════════════════════════════════
// ANDY-4 КОНТЕКСТ МИРА (тот самый формат, на котором обучена модель)
// ══════════════════════════════════════════════════════════════

function buildAndy4Context(bot, memory) {
  if (!bot?.entity) return "";

  const pos = bot.entity.position;
  const health = Math.round(bot.health || 20);
  const food = Math.round(bot.food || 20);
  const gamemode = bot.game?.gameMode || "survival";

  // Время суток
  const timeOfDay = bot.time?.timeOfDay ?? 6000;
  let timeLabel = "day";
  if (timeOfDay < 1000 || timeOfDay > 23000) timeLabel = "dawn";
  else if (timeOfDay > 13000 && timeOfDay < 23000) timeLabel = "night";
  else if (timeOfDay > 11000) timeLabel = "dusk";

  // Биом
  const biome = (() => {
    try {
      const chunk = bot.world?.getColumnAt?.(pos);
      return chunk ? "plains" : "unknown";
    } catch { return "unknown"; }
  })();

  // Погода
  const weather = bot.isRaining ? "rain" : "clear";

  // Инвентарь
  const items = bot.inventory?.items() || [];
  const invStr = items.length === 0
    ? "empty"
    : items.slice(0, 12).map(i => `${i.count}x ${i.name}`).join(", ");
  const invCount = items.length;

  // Ближайшие блоки
  const nearbyBlocks = [];
  try {
    const seen = new Set();
    for (let dx = -6; dx <= 6; dx += 2) {
      for (let dy = -3; dy <= 3; dy += 2) {
        for (let dz = -6; dz <= 6; dz += 2) {
          const bpos = pos.offset(dx, dy, dz);
          const block = bot.blockAt(bpos);
          if (block && block.name !== "air" && block.name !== "cave_air" && !seen.has(block.name)) {
            seen.add(block.name);
            const dist = Math.round(Math.sqrt(dx*dx + dy*dy + dz*dz));
            nearbyBlocks.push(`- ${block.name} (${dist} away)`);
            if (nearbyBlocks.length >= 10) break;
          }
        }
        if (nearbyBlocks.length >= 10) break;
      }
      if (nearbyBlocks.length >= 10) break;
    }
  } catch {}

  // Ближайшие существа
  const HOSTILE = new Set(["zombie","skeleton","creeper","spider","enderman","witch",
    "blaze","ghast","slime","magma_cube","husk","stray","drowned","pillager",
    "vindicator","ravager","phantom","silverfish","cave_spider","wither_skeleton"]);
  const nearbyEntities = [];
  try {
    const entities = Object.values(bot.entities || {})
      .filter(e => e !== bot.entity && e?.position && e?.type !== "object")
      .map(e => {
        const dist = Math.round(e.position.distanceTo(pos));
        const hostile = HOSTILE.has(e.mobType || e.name || "");
        return { name: e.mobType || e.name || e.type || "unknown", dist, hostile, hp: Math.round(e.health || 0) };
      })
      .filter(e => e.dist < 24)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 10);

    for (const e of entities) {
      const tag = e.hostile ? "hostile" : "passive";
      const hpStr = e.hp > 0 ? `, health: ${e.hp}` : "";
      nearbyEntities.push(`- ${e.name} (${tag}, ${e.dist} away${hpStr})`);
    }
  } catch {}

  // Активное действие из памяти
  const currentAction = memory?.currentAction || "none";
  const recentGoals = memory?.goals?.slice(-2).join("; ") || "none";
  const alerts = [];
  if (health <= 10) alerts.push("⚠ CRITICAL HEALTH - seek safety immediately!");
  if (food <= 6) alerts.push("⚠ VERY HUNGRY - eat food now!");
  if (timeLabel === "night") alerts.push("⚠ Night time - hostile mobs active!");

  return `
CONTEXT:
Stats:
- position: x=${Math.round(pos.x)}, y=${Math.round(pos.y)}, z=${Math.round(pos.z)}
- gamemode: ${gamemode}
- health: ${health} / 20
- hunger: ${food} / 20
- biome: ${biome}
- weather: ${weather}
- time: ${timeLabel} (${timeOfDay})
- current action: ${currentAction}
- inventory (${invCount}/36): ${invStr}

Nearby Blocks:
${nearbyBlocks.length > 0 ? nearbyBlocks.join("\n") : "- none visible"}

Nearby Entities:
${nearbyEntities.length > 0 ? nearbyEntities.join("\n") : "- none visible"}

Current Goals:
${recentGoals}

System Alerts:
${alerts.length > 0 ? alerts.join("\n") : "none"}
`;
}

// ══════════════════════════════════════════════════════════════
// REACT РЕЖИМ — для не-Andy моделей
// ══════════════════════════════════════════════════════════════

const REACT_TOOLS = `
AVAILABLE TOOLS — respond with JSON {"tool":"name","args":{...}}:

goto_xyz(x,y,z) | goto_block(block,max_distance) | goto_entity(type,max_distance)
follow_player(name,distance) | stop_moving()
dig_block(block,count) | collect_drops(radius)
attack(target,max_distance) | defend(radius) | flee(from,distance)
craft(item,count) | equip(item,slot) | eat(item) | drop_item(item,count)
place_block(item,direction) | look_around() | chat(message) | wait(seconds,reason)
`;

function buildReActSystemPrompt(botConfig) {
  const personality = botConfig.systemPrompt || "Ты умный Minecraft-бот.";
  return `${personality}

Ты автономный Minecraft-агент. Отвечай ТОЛЬКО валидным JSON:
{
  "думаю": "1-2 предложения рассуждения",
  "действие": {"tool": "имя", "args": {...}},
  "говорю": "текст в чат или null"
}

ПРИОРИТЕТЫ: HP < 10 → лечись, Голод < 8 → ешь, Ночью → будь осторожен.
Не повторяй провальные действия. Будь инициативен без задачи.

${REACT_TOOLS}`;
}

function buildReActContext(bot, memory) {
  if (!bot?.entity) return "";
  const pos = bot.entity.position;
  const items = (bot.inventory?.items() || []).slice(0, 8).map(i => `${i.count}x${i.name}`).join(",");
  const entities = Object.values(bot.entities || {})
    .filter(e => e !== bot.entity && e?.position)
    .map(e => ({ n: e.mobType || e.name || "?", d: Math.round(e.position.distanceTo(pos)) }))
    .filter(e => e.d < 16).sort((a,b) => a.d - b.d).slice(0, 6)
    .map(e => `${e.n}(${e.d}m)`).join(",");

  const timeOfDay = bot.time?.timeOfDay ?? 6000;
  const night = timeOfDay > 13000 && timeOfDay < 23000;

  return `
Мир: HP=${Math.round(bot.health||20)}/20 Голод=${Math.round(bot.food||20)}/20 Поз=(${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)}) ${night?"НОЧЬ":"День"}
Инвентарь: ${items || "пусто"}
Существа рядом: ${entities || "нет"}
Последнее действие: ${memory?.lastAction || "нет"}
`;
}

// ══════════════════════════════════════════════════════════════
// ИСПОЛНИТЕЛЬ ИНСТРУМЕНТОВ (ReAct режим)
// ══════════════════════════════════════════════════════════════

class ToolExecutor {
  constructor(bot, taskManager) {
    this.bot = bot;
    this.taskManager = taskManager;
  }

  async execute(tool, args) {
    const bot = this.bot;
    if (!bot?.entity) return "Bot not spawned";

    const pos = bot.entity.position;
    const HOSTILE = new Set(["zombie","skeleton","creeper","spider","enderman","witch","blaze","ghast","slime","husk","stray","drowned","pillager","phantom"]);

    try {
      switch (tool) {
        case "goto_xyz": {
          const x = args.x ?? args[0], y = args.y ?? args[1] ?? pos.y, z = args.z ?? args[2];
          if (x != null && z != null) {
            await bot.pathfinder.goto(new goals.GoalBlock(Math.round(x), Math.round(y), Math.round(z)));
            return `Arrived at (${Math.round(x)},${Math.round(y)},${Math.round(z)})`;
          }
          return "Missing coordinates";
        }
        case "goto_block": {
          const block = bot.findBlock({ matching: b => b.name === args.block, maxDistance: args.max_distance || 64 });
          if (block) {
            await bot.pathfinder.goto(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 2));
            return `Found and approached ${args.block}`;
          }
          return `Block ${args.block} not found nearby`;
        }
        case "goto_entity": {
          const entity = Object.values(bot.entities).find(e =>
            e !== bot.entity && (e.mobType || e.name || "").toLowerCase().includes((args.type || "").toLowerCase()) &&
            e.position.distanceTo(pos) < (args.max_distance || 32)
          );
          if (entity) {
            await bot.pathfinder.goto(new goals.GoalNear(entity.position.x, entity.position.y, entity.position.z, 2));
            return `Approached ${args.type}`;
          }
          return `${args.type} not found nearby`;
        }
        case "follow_player": {
          const player = Object.values(bot.entities).find(e => e.type === "player" && e.username !== bot.username &&
            (!args.name || e.username?.toLowerCase().includes(args.name.toLowerCase())));
          if (player) {
            bot.pathfinder.goto(new goals.GoalFollow(player, args.distance || 3)).catch(() => {});
            return `Following ${player.username}`;
          }
          return "Player not found";
        }
        case "stop_moving": {
          try { bot.pathfinder.stop(); } catch {}
          bot.clearControlStates();
          if (this.taskManager) this.taskManager.stopAll().catch(() => {});
          return "Stopped";
        }
        case "dig_block": {
          if (this.taskManager) {
            const b = args.block || "oak_log";
            if (/log|wood/.test(b)) this.taskManager.runTask("gather_wood", { count: args.count || 5 }).catch(() => {});
            else if (/stone|cobble|ore/.test(b)) this.taskManager.runTask("gather_stone", { count: args.count || 5 }).catch(() => {});
            return `Mining ${b} started`;
          }
          return "No task manager";
        }
        case "attack": {
          const target = Object.values(bot.entities).find(e =>
            e !== bot.entity && (e.mobType || e.name || "").toLowerCase().includes((args.target || "").toLowerCase()) &&
            e.position.distanceTo(pos) < (args.max_distance || 16)
          );
          if (target) {
            await bot.attack(target);
            return `Attacked ${args.target}`;
          }
          return `${args.target} not in range`;
        }
        case "defend": {
          const nearest = Object.values(bot.entities).find(e =>
            e !== bot.entity && HOSTILE.has(e.mobType || e.name || "") &&
            e.position.distanceTo(pos) < (args.radius || 8)
          );
          if (nearest) {
            await bot.attack(nearest);
            return `Defending against ${nearest.mobType || nearest.name}`;
          }
          return "No immediate threats";
        }
        case "flee": {
          const threat = Object.values(bot.entities).find(e =>
            e !== bot.entity && (e.mobType || e.name || "").toLowerCase().includes((args.from || "").toLowerCase())
          );
          if (threat) {
            const away = pos.plus(pos.minus(threat.position).normalize().scaled(args.distance || 20));
            bot.pathfinder.goto(new goals.GoalXZ(Math.round(away.x), Math.round(away.z))).catch(() => {});
            return `Fleeing from ${args.from}`;
          }
          return "Threat not found";
        }
        case "craft": {
          if (this.taskManager) {
            this.taskManager.runTask("craft", { item: args.item, count: args.count || 1 }).catch(() => {});
            return `Crafting ${args.item}`;
          }
          return "No task manager";
        }
        case "equip": {
          const item = bot.inventory.items().find(i => i.name.includes(args.item || ""));
          if (item) {
            await bot.equip(item, args.slot || "hand");
            return `Equipped ${item.name}`;
          }
          return `${args.item} not in inventory`;
        }
        case "eat": {
          let food = args.item
            ? bot.inventory.items().find(i => i.name.includes(args.item))
            : bot.inventory.items().filter(i => i.foodPoints > 0).sort((a,b) => b.foodPoints - a.foodPoints)[0];
          if (food) {
            await bot.equip(food, "hand");
            await bot.consume();
            return `Ate ${food.name}`;
          }
          return "No food in inventory";
        }
        case "drop_item": {
          const item = bot.inventory.items().find(i => i.name.includes(args.item || ""));
          if (item) {
            await bot.toss(item.type, null, Math.min(args.count || item.count, item.count));
            return `Dropped ${args.item}`;
          }
          return `${args.item} not found`;
        }
        case "chat": {
          bot.chat(String(args.message || "").slice(0, 100));
          return "Message sent";
        }
        case "wait": {
          await sleep((args.seconds || 3) * 1000);
          return `Waited ${args.seconds || 3}s`;
        }
        case "look_around":
        case "check_surroundings":
          return "Observing surroundings...";
        default:
          return `Unknown tool: ${tool}`;
      }
    } catch (err) {
      return `Error: ${err.message}`;
    }
  }
}

// ══════════════════════════════════════════════════════════════
// ПАМЯТЬ БОТА
// ══════════════════════════════════════════════════════════════

class BotMemory {
  constructor() {
    this.conversationHistory = [];
    this.episodicMemory = [];     // что делал и с каким результатом
    this.knownLocations = {};     // запомненные места
    this.goals = [];              // текущие цели
    this.currentAction = "none";
    this.lastAction = null;
    this.failedActions = new Set(); // что не работает
    this.kv = {};                 // произвольные ключ-значения
  }

  addEpisode(action, result, success) {
    this.episodicMemory.push({ action, result, success, time: Date.now() });
    if (this.episodicMemory.length > 20) this.episodicMemory.shift();
    this.lastAction = action;
    if (!success) this.failedActions.add(action);
    else this.failedActions.delete(action);
  }

  addMessage(role, content) {
    this.conversationHistory.push({ role, content });
    // Держим максимум 30 сообщений в истории
    if (this.conversationHistory.length > 30) {
      // Оставляем первый системный промт + последние 28
      const system = this.conversationHistory.find(m => m.role === "system");
      const rest = this.conversationHistory.filter(m => m.role !== "system").slice(-28);
      this.conversationHistory = system ? [system, ...rest] : rest;
    }
  }

  getRecentEpisodes(n = 5) {
    return this.episodicMemory.slice(-n)
      .map(e => `${e.success ? "✓" : "✗"} ${e.action}: ${e.result}`)
      .join("\n");
  }

  remember(key, value) { this.kv[key] = value; }
  recall(key) { return this.kv[key]; }
}

// ══════════════════════════════════════════════════════════════
// ГЛАВНЫЙ КЛАСС AIBrain
// ══════════════════════════════════════════════════════════════

class AIBrain {
  constructor(bot, config, ollamaManager, emit, botId) {
    this.bot = bot;
    this.config = config;
    this.ollama = ollamaManager;
    this.emit = emit;
    this.botId = botId;
    this.memory = new BotMemory();
    this.isRunning = false;
    this.autonomousTimer = null;
    this.taskManager = null;  // set externally

    const model = config.aiModel || "";
    this.isAndy4 = isAndy4Model(model);

    log.info(`[AIBrain] Mode: ${this.isAndy4 ? "ANDY-4 NATIVE" : "REACT JSON"} | Model: ${model}`);

    // Инициализируем историю системным промтом
    const systemPrompt = this.isAndy4
      ? buildAndy4SystemPrompt(config)
      : buildReActSystemPrompt(config);
    this.memory.addMessage("system", systemPrompt);
  }

  // ── Запустить автономный режим ──────────────────────────────
  startAutonomous(intervalMs = 12000) {
    this.isRunning = true;
    this.autonomousTimer = setInterval(() => {
      if (!this.bot?.entity || !this.isRunning) return;
      this._autonomousTick().catch(err => log.warn("[AIBrain] autonomous tick error:", err.message));
    }, intervalMs);
    log.info("[AIBrain] Autonomous mode started");
  }

  stopAutonomous() {
    this.isRunning = false;
    if (this.autonomousTimer) {
      clearInterval(this.autonomousTimer);
      this.autonomousTimer = null;
    }
    log.info("[AIBrain] Autonomous mode stopped");
  }

  // ── Автономный тик — бот думает сам ────────────────────────
  async _autonomousTick() {
    // Срочные состояния — проверяем без LLM
    const hp = this.bot.health || 20;
    const food = this.bot.food || 20;

    if (hp <= 6) {
      this.memory.currentAction = "emergency_heal";
      const food = (this.bot.inventory?.items() || []).find(i => i.foodPoints > 0);
      if (food) {
        await this.bot.equip(food, "hand").catch(() => {});
        await this.bot.consume().catch(() => {});
        this.memory.addEpisode("emergency_eat", "ate food at low HP", true);
      }
      return;
    }

    if (food <= 5) {
      const foodItem = (this.bot.inventory?.items() || []).find(i => i.foodPoints > 0);
      if (foodItem) {
        await this.bot.equip(foodItem, "hand").catch(() => {});
        await this.bot.consume().catch(() => {});
        this.memory.addEpisode("eat", "ate food", true);
        return;
      }
    }

    // Спрашиваем LLM что делать
    const prompt = this.isAndy4
      ? this._buildAndy4AutoPrompt()
      : this._buildReActAutoPrompt();

    const response = await this._callOllama(prompt, false);
    if (response) await this._processResponse(response, null);
  }

  // ── Ответить на сообщение игрока ────────────────────────────
  async respondToPlayer(playerName, message) {
    if (!this.bot?.entity) return;

    log.info(`[AIBrain] Player message from ${playerName}: ${message}`);

    const userMsg = this.isAndy4
      ? `${playerName}: ${message}`
      : `Игрок ${playerName} написал: "${message}"\n${buildReActContext(this.bot, this.memory)}`;

    this.memory.addMessage("user", userMsg);
    const response = await this._callOllama(null, true);
    if (response) await this._processResponse(response, playerName);
  }

  // ── Вызов Ollama ─────────────────────────────────────────────
  async _callOllama(extraUserMsg, useHistory) {
    try {
      let messages;

      if (useHistory) {
        // Использовать накопленную историю
        messages = [...this.memory.conversationHistory];
      } else {
        // Одиночный запрос (автономный тик) — только системный + новый запрос
        const sys = this.memory.conversationHistory.find(m => m.role === "system");
        messages = sys ? [sys, { role: "user", content: extraUserMsg }] : [{ role: "user", content: extraUserMsg }];
      }

      const model = this.config.aiModel || "sweaterdog/andy-4";
      const result = await this.ollama.chat({
        model,
        messages,
        stream: false,
        options: { temperature: 0.7, num_predict: 400 }
      });

      const text = result?.message?.content || result?.content || "";
      log.info("[AIBrain] Raw response:", text.slice(0, 200));

      if (useHistory) {
        this.memory.addMessage("assistant", text);
      }

      return text;
    } catch (err) {
      log.error("[AIBrain] Ollama error:", err.message);
      return null;
    }
  }

  // ── Построение промтов ───────────────────────────────────────

  _buildAndy4AutoPrompt() {
    const ctx = buildAndy4Context(this.bot, this.memory);
    const recent = this.memory.getRecentEpisodes(3);
    return `${ctx}\nRecent actions:\n${recent || "none"}\n\nWhat will you do now? Act autonomously to survive and thrive.`;
  }

  _buildReActAutoPrompt() {
    const ctx = buildReActContext(this.bot, this.memory);
    const recent = this.memory.getRecentEpisodes(3);
    return `${ctx}\nПоследние действия:\n${recent || "нет"}\n\nЧто делаешь сейчас? Отвечай JSON.`;
  }

  // ── Обработка ответа модели ──────────────────────────────────

  async _processResponse(text, playerName) {
    const executor = new ToolExecutor(this.bot, this.taskManager);

    if (this.isAndy4) {
      await this._processAndy4Response(text, playerName, executor);
    } else {
      await this._processReActResponse(text, playerName, executor);
    }
  }

  async _processAndy4Response(text, playerName, executor) {
    const clean = stripThinkBlocks(text);
    const { chatText, commands } = parseAndy4Response(clean);

    // Сначала говорим
    if (chatText && chatText.length > 2) {
      this.bot.chat(chatText.slice(0, 100));
      this.emit("bot:message", {
        botId: this.botId,
        message: chatText,
        sender: this.bot.username,
        isBot: true
      });
    }

    // Потом выполняем команды
    for (const cmd of commands) {
      log.info("[AIBrain Andy4] Executing:", cmd.name, cmd.args);
      this.memory.currentAction = cmd.name;
      const success = await executeAndy4Command(cmd, { bot: this.bot }, this.taskManager);
      this.memory.addEpisode(cmd.name, success ? "ok" : "failed", success);
    }

    if (commands.length === 0 && !chatText) {
      log.info("[AIBrain Andy4] No action taken");
    }
  }

  async _processReActResponse(text, playerName, executor) {
    const clean = stripThinkBlocks(text);

    // Парсим JSON
    let parsed = null;
    try {
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    } catch {
      // Не JSON — просто говорим это
      if (clean.length > 2) this.bot.chat(clean.slice(0, 100));
      return;
    }

    if (!parsed) return;

    const says = parsed["говорю"] || parsed["say"] || null;
    const action = parsed["действие"] || parsed["action"] || null;
    const thinks = parsed["думаю"] || parsed["think"] || "";

    log.info("[AIBrain ReAct] Thinks:", thinks);

    // Говорим игроку
    if (says && says !== "null") {
      this.bot.chat(String(says).slice(0, 100));
      this.emit("bot:message", {
        botId: this.botId,
        message: String(says),
        sender: this.bot.username,
        isBot: true
      });
    }

    // Выполняем действие
    if (action?.tool) {
      log.info("[AIBrain ReAct] Executing tool:", action.tool, action.args);
      this.memory.currentAction = action.tool;
      const result = await executor.execute(action.tool, action.args || {});
      const success = !result.startsWith("Error") && !result.startsWith("Unknown") && !result.includes("not found");
      this.memory.addEpisode(action.tool, result, success);
      log.info("[AIBrain ReAct] Result:", result);

      // Фидбэк в историю для следующего запроса
      this.memory.addMessage("user", `Результат действия ${action.tool}: ${result}`);
    }
  }
}

module.exports = { AIBrain };
