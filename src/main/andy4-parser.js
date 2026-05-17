/**
 * Парсер команд модели Andy-4 (sweaterdog/andy-4)
 * Andy-4 возвращает текст + !commandName("arg1", arg2) в конце
 *
 * Примеры:
 *   "Sure, I'll follow you. !followPlayer("KLABA666", 3)"
 *   "Alright! !goToPlayer("KLABA666", 3)"
 *   "Sure, I'll stop. !stop"
 *   "startConversation("KLABA666", "Hey!")"
 *   "!collectBlock("oak_log", 10)"
 *   "!attackNearest("zombie")"
 */
const { goals } = require("mineflayer-pathfinder");
const log = require("electron-log");

// Паттерн: !имяКоманды или имяКоманды без ! (startConversation)
const CMD_RE = /(!?\w+)\s*\(([^)]*)\)/g;

function parseArgs(raw) {
  // "arg1", 3, "arg2" → ["arg1", 3, "arg2"]
  const args = [];
  const re = /"([^"]*)"|'([^']*)'|(\d+\.?\d*)/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    args.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : parseFloat(m[3]));
  }
  return args;
}

/**
 * Разбирает ответ Andy-4 на:
 *  - chatText: текст который бот скажет в чат (без команд)
 *  - commands: массив команд для выполнения
 */
function parseAndy4Response(text) {
  let chatText = text;
  const commands = [];

  // Находим все команды
  const matches = [...text.matchAll(/(!?\w+)\s*\(([^)]*)\)/g)];
  for (const m of matches) {
    const name = m[1];
    const args = parseArgs(m[2]);
    commands.push({ name, args, raw: m[0] });
    chatText = chatText.replace(m[0], "").trim();
  }

  // Убираем служебные строки Andy-4
  chatText = chatText
    .replace(/^(Sure|Alright|Okay|OK)[,!.]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);

  return { chatText, commands };
}

/**
 * Выполняет Andy-4 команду через mineflayer + pathfinder
 * Возвращает true если команда выполнена
 */
async function executeAndy4Command(cmd, instance, taskManager) {
  const { name, args } = cmd;
  const bot = instance.bot;
  if (!bot?.entity) return false;

  const cmdLower = name.toLowerCase().replace(/^!/, "");
  log.info("[Andy4]", name, args);

  switch (cmdLower) {
    // --- Движение к игроку ---
    case "gotoplayer":
    case "goto":
    case "movetoplayer": {
      const playerName = args[0];
      const dist = typeof args[1] === "number" ? args[1] : 3;
      const target = _findPlayer(bot, playerName);
      if (target) {
        bot.pathfinder.goto(new goals.GoalNear(
          target.position.x, target.position.y, target.position.z, dist
        )).catch(() => {});
      }
      return true;
    }

    // --- Следовать за игроком ---
    case "followplayer":
    case "follow": {
      const playerName = args[0];
      const dist = typeof args[1] === "number" ? args[1] : 3;
      const target = _findPlayer(bot, playerName);
      if (target) {
        bot.pathfinder.goto(new goals.GoalFollow(target, dist)).catch(() => {});
      }
      return true;
    }

    // --- Стоп ---
    case "stop":
    case "stopmoving":
    case "cancelaction": {
      try { bot.pathfinder.stop(); } catch {}
      try { bot.clearControlStates(); } catch {}
      if (taskManager) await taskManager.stopAll().catch(() => {});
      return true;
    }

    // --- Собрать/добыть блок ---
    case "collectblock":
    case "mineblock":
    case "digblock": {
      const blockName = args[0] || "oak_log";
      const count = typeof args[1] === "number" ? args[1] : 1;
      if (taskManager) {
        const isWood = blockName.includes("log") || blockName === "wood";
        taskManager.runTask(isWood ? "gather_wood" : "gather_stone", { count }).catch(() => {});
      }
      return true;
    }

    // --- Атака ---
    case "attacknearest":
    case "attack":
    case "killeentity": {
      const mobName = args[0];
      if (taskManager) taskManager.runTask("attack", { target: mobName }).catch(() => {});
      return true;
    }

    // --- Крафт ---
    case "craftitem":
    case "craft": {
      const itemName = args[0];
      const count = typeof args[1] === "number" ? args[1] : 1;
      if (taskManager) taskManager.runTask("craft", { item: itemName, count }).catch(() => {});
      return true;
    }

    // --- Идти к координатам ---
    case "gotoxyz":
    case "movetoxyz":
    case "walkto": {
      const x = args[0], y = args[1], z = args[2];
      if (x !== undefined) {
        bot.pathfinder.goto(new goals.GoalBlock(Math.round(x), Math.round(y || bot.entity.position.y), Math.round(z))).catch(() => {});
      }
      return true;
    }

    // --- Прыжок ---
    case "jump": {
      bot.setControlState("jump", true);
      setTimeout(() => bot.setControlState("jump", false), 500);
      return true;
    }

    // --- Съесть ---
    case "eatfood":
    case "eat": {
      const food = bot.inventory.items().find(i => i.foodPoints > 0);
      if (food) {
        bot.equip(food, "hand").then(() => bot.consume()).catch(() => {});
      }
      return true;
    }

    // --- Посмотреть ---
    case "lookat":
    case "look": {
      const playerName = args[0];
      const target = _findPlayer(bot, playerName);
      if (target) bot.lookAt(target.position.offset(0, 1.6, 0)).catch(() => {});
      return true;
    }

    // --- Игнорируемые служебные команды Andy-4 ---
    case "startconversation":
    case "endconversation":
    case "newaction":
    case "respond":
    case "think":
    case "remember":
    case "forget":
      return true; // просто игнорируем

    default:
      log.warn("[Andy4] Unknown command:", name, args);
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

/**
 * Определяет использует ли модель формат Andy-4
 */
function isAndy4Model(modelName) {
  const m = (modelName || "").toLowerCase();
  return m.includes("andy") || m.includes("sweaterdog");
}

module.exports = { parseAndy4Response, executeAndy4Command, isAndy4Model };
