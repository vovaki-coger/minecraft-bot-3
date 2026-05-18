/**
 * Парсер команд модели Andy-4 (sweaterdog/andy-4) и любых thinking-моделей.
 *
 * Обрабатывает:
 *  - <think>...</think> блоки (deepseek-r1, qwen и др.) — удаляются полностью
 *  - !commandName("arg1", arg2) — извлекаются и выполняются, из текста удаляются
 *  - startConversation(...) / newAction(...) — служебные Andy-4, игнорируются
 */
const { goals } = require("mineflayer-pathfinder");
const log = require("electron-log");

// ======================================================
// ОЧИСТКА ТЕКСТА
// ======================================================

/**
 * Удаляет <think>...</think> блоки любой вложенности.
 * Также обрезает лишние пробелы и переносы строк.
 */
function stripThinkBlocks(text) {
  // Удаляем <think>...</think> (в том числе многострочные)
  let result = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  // Удаляем оставшиеся открытые <think> без закрытия (на случай обрезанного ответа)
  result = result.replace(/<think>[\s\S]*/gi, "");
  return result.trim();
}

/**
 * Парсит аргументы в скобках: "arg1", 3, 'arg2' → ["arg1", 3, "arg2"]
 */
function parseArgs(raw) {
  const args = [];
  const re = /"([^"]*)"|'([^']*)'|(-?\d+\.?\d*)/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    if (m[1] !== undefined) args.push(m[1]);
    else if (m[2] !== undefined) args.push(m[2]);
    else args.push(parseFloat(m[3]));
  }
  return args;
}

/**
 * Разбирает ответ Andy-4 / любой модели на:
 *  - chatText: что бот скажет в чат (без think-блоков и команд)
 *  - commands: массив команд для выполнения
 */
function parseAndy4Response(text) {
  // 1. Убираем think-блоки
  let cleaned = stripThinkBlocks(text);

  // 2. Извлекаем все !команды и обычные Andy-4 функции
  const commands = [];
  // Паттерн: !commandName(...) или wordName(...) если это известная Andy-4 функция
  const cmdPattern = /(!?\w+)\s*\(([^)]*)\)/g;
  const matches = [...cleaned.matchAll(cmdPattern)];

  for (const m of matches) {
    const name = m[1];
    const args = parseArgs(m[2]);
    commands.push({ name, args, raw: m[0] });
    // Удаляем команду из текста
    cleaned = cleaned.replace(m[0], " ");
  }

  // 3. Чистим текст от служебных маркеров Andy-4
  let chatText = cleaned
    .replace(/\*[^*]*\*/g, "")           // *actions*
    .replace(/\[[^\]]*\]/g, "")           // [context]
    .replace(/^(Sure[,!.]?|Alright[,!.]?|Okay[,!.]?|OK[,!.]?)\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);

  return { chatText, commands };
}

// ======================================================
// ВЫПОЛНЕНИЕ КОМАНД Andy-4
// ======================================================

async function executeAndy4Command(cmd, instance, taskManager) {
  const { name, args } = cmd;
  const bot = instance.bot;
  if (!bot?.entity) return false;

  const cmdLower = name.toLowerCase().replace(/^!/, "");
  log.info("[Andy4 exec]", cmdLower, args);

  switch (cmdLower) {

    // --- Движение к игроку ---
    case "gotoplayer":
    case "movetoplayer":
    case "approachplayer": {
      const dist = typeof args[1] === "number" ? args[1] : 2;
      const target = _findPlayer(bot, args[0]);
      if (target) {
        bot.pathfinder.goto(
          new goals.GoalNear(target.position.x, target.position.y, target.position.z, dist)
        ).catch(() => {});
      }
      return true;
    }

    // --- Следовать ---
    case "followplayer":
    case "follow": {
      const dist = typeof args[1] === "number" ? args[1] : 3;
      const target = _findPlayer(bot, args[0]);
      if (target) {
        bot.pathfinder.goto(new goals.GoalFollow(target, dist)).catch(() => {});
      }
      return true;
    }

    // --- Стоп ---
    case "stop":
    case "stopmoving":
    case "cancelaction":
    case "abort": {
      try { bot.pathfinder.stop(); } catch {}
      try { bot.clearControlStates(); } catch {}
      if (taskManager) taskManager.stopAll().catch(() => {});
      return true;
    }

    // --- Поиск и сбор блока ---
    case "searchforblock":
    case "collectblock":
    case "mineblock":
    case "digblock":
    case "harvestblock": {
      const blockName = args[0] || "oak_log";
      const count = typeof args[1] === "number" ? Math.min(args[1], 64) : 5;
      if (taskManager) {
        const isWood = /log|wood/.test(blockName);
        const isStone = /stone|cobble/.test(blockName);
        if (isWood) taskManager.runTask("gather_wood", { count }).catch(() => {});
        else if (isStone) taskManager.runTask("gather_stone", { count }).catch(() => {});
        else taskManager.runTask("gather_wood", { count }).catch(() => {});
      }
      return true;
    }

    // --- Поиск сущности ---
    case "searchforentity":
    case "findentity": {
      const entityName = args[0];
      if (taskManager) taskManager.runTask("attack", { target: entityName }).catch(() => {});
      return true;
    }

    // --- Атака ---
    case "attacknearest":
    case "attackentity":
    case "killentity":
    case "kill":
    case "attack": {
      if (taskManager) taskManager.runTask("attack", { target: args[0] }).catch(() => {});
      return true;
    }

    // --- Крафт ---
    case "craftitem":
    case "craft":
    case "make": {
      const count = typeof args[1] === "number" ? args[1] : 1;
      if (taskManager) taskManager.runTask("craft", { item: args[0], count }).catch(() => {});
      return true;
    }

    // --- Место блока ---
    case "placeblock":
    case "place": {
      // Простое размещение — просто подтверждаем команду
      return true;
    }

    // --- Координаты ---
    case "gotoxyz":
    case "movetoxyz":
    case "walkto":
    case "goto": {
      const x = args[0], y = args[1], z = args[2];
      if (x !== undefined && z !== undefined) {
        bot.pathfinder.goto(new goals.GoalBlock(
          Math.round(x),
          Math.round(y ?? bot.entity.position.y),
          Math.round(z)
        )).catch(() => {});
      }
      return true;
    }

    // --- Прыжок ---
    case "jump": {
      bot.setControlState("jump", true);
      setTimeout(() => bot.setControlState("jump", false), 500);
      return true;
    }

    // --- Еда ---
    case "eatfood":
    case "eat": {
      const food = bot.inventory.items().find(i => i.foodPoints > 0);
      if (food) bot.equip(food, "hand").then(() => bot.consume()).catch(() => {});
      return true;
    }

    // --- Взгляд ---
    case "lookat":
    case "looktowards": {
      const target = _findPlayer(bot, args[0]);
      if (target) bot.lookAt(target.position.offset(0, 1.6, 0)).catch(() => {});
      return true;
    }

    // --- Экипировка ---
    case "equip":
    case "equipitem": {
      const item = bot.inventory.items().find(i =>
        i.name === args[0] || i.name.includes(args[0] || "")
      );
      if (item) bot.equip(item, "hand").catch(() => {});
      return true;
    }

    // --- Сохранить/запомнить позицию ---
    case "rememberpos":
    case "savepos":
    case "save":
    case "remember": {
      log.info("[Andy4] remember position:", bot.entity.position);
      return true;
    }

    // --- Служебные Andy-4 (игнорируем) ---
    case "startconversation":
    case "endconversation":
    case "newaction":
    case "respond":
    case "think":
    case "forget":
    case "searchentities":
    case "searchwiki":
    case "log":
    case "say":
      return true;

    default:
      // Если начинается с ! — скорее всего команда которую мы не знаем, но молча принимаем
      if (name.startsWith("!")) {
        log.warn("[Andy4] Unknown command (ignored):", name, args);
        return true;
      }
      return false;
  }
}

function _findPlayer(bot, name) {
  return Object.values(bot.entities).find(e =>
    e.type === "player" &&
    e.username !== bot.username &&
    (!name || e.username?.toLowerCase().includes((name || "").toLowerCase()))
  ) || null;
}

function isAndy4Model(modelName) {
  const m = (modelName || "").toLowerCase();
  return m.includes("andy") || m.includes("sweaterdog");
}

module.exports = { parseAndy4Response, executeAndy4Command, isAndy4Model, stripThinkBlocks };
