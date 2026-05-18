/**
 * AgentLoop v3 — автономное поведение бота.
 *
 * Улучшения:
 *  - История позиций: реальная детекция зависания (не двигался 10+ сек)
 *  - Умный анти-застрял: 3 попытки с разными направлениями
 *  - Расширенный список мобов (включая боссов)
 *  - Смарт-выбор оружия перед атакой
 *  - Авто-экипировка лучшей брони при спавне
 *  - Сбор дропа после убийства моба
 */
const { goals } = require("mineflayer-pathfinder");
const log = require("electron-log");

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const HOSTILE_MOBS = new Set([
  "zombie", "skeleton", "creeper", "spider", "enderman", "witch",
  "pillager", "phantom", "drowned", "husk", "stray", "slime",
  "magma_cube", "blaze", "wither_skeleton", "vindicator", "ravager",
  "cave_spider", "silverfish", "guardian", "elder_guardian",
]);

class AgentLoop {
  constructor(instance, emit) {
    this.instance = instance;
    this.emit = emit;
    this._active = true;
    this._deathPos = null;
    this._lastEat = 0;
    this._lastDefend = 0;
    this._mainLoop = null;

    // История позиций для детекции зависания
    this._posHistory = [];
    this._lastPosRecord = 0;
    this._stuckAttempts = 0;

    this._attachBotEvents();
    this._startLoop();
  }

  get bot() { return this.instance.bot; }

  // ── Привязка к событиям ──────────────────────────────────────────────

  _attachBotEvents() {
    const bot = this.bot;
    bot.on("death", () => this._onDeath());
    bot.on("health", () => this._onHealthTick());
    bot.on("entityHurt", (entity) => {
      if (entity === bot.entity) this._onDamaged();
    });
    // Авто-экипировка брони при спавне
    bot.once("spawn", () => {
      setTimeout(() => this._autoEquipArmor(), 2000);
    });
  }

  // ── Смерть ───────────────────────────────────────────────────────────

  _onDeath() {
    if (this.bot?.entity) {
      this._deathPos = this.bot.entity.position.clone();
      log.info("[AgentLoop] Death at", this._deathPos);
    }
    setTimeout(() => this._collectDroppedItems(), 4000);
  }

  async _collectDroppedItems() {
    const bot = this.bot;
    if (!bot?.entity || !this._active) return;

    const radius = 32;
    const droppedItems = Object.values(bot.entities).filter((e) => {
      if (e.type !== "object" || e.objectType !== "Item") return false;
      if (!this._deathPos) return true;
      return e.position.distanceTo(this._deathPos) < radius;
    });

    if (droppedItems.length === 0) {
      if (this._deathPos) {
        this._chat("Иду забрать вещи...");
        try {
          await bot.pathfinder.goto(
            new goals.GoalBlock(
              Math.round(this._deathPos.x),
              Math.round(this._deathPos.y),
              Math.round(this._deathPos.z)
            )
          );
        } catch {}
      }
      return;
    }

    this._chat(`Подбираю ${droppedItems.length} предмет(ов)...`);
    for (const item of droppedItems.slice(0, 20)) {
      if (!this._active || !bot.entity) break;
      try {
        await bot.pathfinder.goto(
          new goals.GoalNear(item.position.x, item.position.y, item.position.z, 1)
        );
        await delay(300);
      } catch {}
    }
  }

  // ── Еда ──────────────────────────────────────────────────────────────

  async _onHealthTick() {
    const bot = this.bot;
    if (!bot || !this._active) return;
    const now = Date.now();
    if (now - this._lastEat < 10000) return;

    if (bot.food < 15) {
      // Выбираем еду с наибольшим foodPoints
      const food = bot.inventory.items()
        .filter((i) => i.foodPoints && i.foodPoints > 0)
        .sort((a, b) => (b.foodPoints || 0) - (a.foodPoints || 0))[0];

      if (food) {
        this._lastEat = now;
        log.info("[AgentLoop] Eating", food.name, "food:", bot.food);
        try {
          await bot.equip(food, "hand");
          await bot.consume();
        } catch (e) {
          log.warn("[AgentLoop] Eat failed:", e.message);
        }
      }
    }
  }

  // ── Защита при атаке ─────────────────────────────────────────────────

  async _onDamaged() {
    const bot = this.bot;
    if (!bot?.entity || !this._active) return;
    const now = Date.now();
    if (now - this._lastDefend < 3000) return;
    this._lastDefend = now;

    const enemy = this._findNearestHostile();
    if (!enemy) return;

    log.info("[AgentLoop] Defending against", enemy.name);

    try {
      // Экипируем лучшее оружие перед атакой
      await this._equipBestWeapon();
      await bot.lookAt(enemy.position.offset(0, enemy.height ?? 1, 0));
      const dist = bot.entity.position.distanceTo(enemy.position);
      if (dist < 5) {
        await bot.attack(enemy);
      } else {
        // Если враг далеко — убегаем
        const flee = bot.entity.position.clone().subtract(enemy.position).normalize().scale(10).add(bot.entity.position);
        bot.pathfinder.goto(new goals.GoalNear(flee.x, flee.y, flee.z, 2)).catch(() => {});
      }
    } catch (e) {
      log.warn("[AgentLoop] Defend failed:", e.message);
    }
  }

  _findNearestHostile() {
    const bot = this.bot;
    let nearest = null;
    let minDist = 16;
    for (const entity of Object.values(bot.entities)) {
      if (!entity.position || entity === bot.entity) continue;
      const name = (entity.name || entity.mobType || "").toLowerCase();
      if (!Array.from(HOSTILE_MOBS).some((h) => name.includes(h))) continue;
      const dist = bot.entity.position.distanceTo(entity.position);
      if (dist < minDist) { minDist = dist; nearest = entity; }
    }
    return nearest;
  }

  // ── Авто-экипировка оружия и брони ───────────────────────────────────

  async _equipBestWeapon() {
    const bot = this.bot;
    const WEAPON_TIERS = ["netherite_sword", "diamond_sword", "iron_sword", "stone_sword", "wooden_sword", "golden_sword"];
    for (const name of WEAPON_TIERS) {
      const item = bot.inventory.items().find((i) => i.name === name);
      if (item) {
        try { await bot.equip(item, "hand"); return; } catch {}
      }
    }
  }

  async _autoEquipArmor() {
    const bot = this.bot;
    if (!bot?.entity) return;
    const slots = ["helmet", "chestplate", "leggings", "boots"];
    const TIERS = ["netherite", "diamond", "iron", "chainmail", "golden", "leather"];
    for (const slot of slots) {
      for (const tier of TIERS) {
        const pieceName = tier + "_" + slot;
        const item = bot.inventory.items().find((i) => i.name === pieceName);
        if (item) {
          try { await bot.equip(item, slot); break; } catch {}
        }
      }
    }
  }

  // ── Главный цикл ─────────────────────────────────────────────────────

  _startLoop() {
    this._mainLoop = setInterval(() => this._tick(), 5000);
  }

  async _tick() {
    const bot = this.bot;
    if (!bot?.entity || !this._active) return;

    // Если горим — ищем воду
    if (bot.entity.onFire) {
      await this._escapeFireOrWater();
      return;
    }

    // Записываем позицию раз в 10 сек
    const now = Date.now();
    if (now - this._lastPosRecord > 10000) {
      this._lastPosRecord = now;
      const pos = { x: Math.round(bot.entity.position.x), z: Math.round(bot.entity.position.z) };
      this._posHistory.push(pos);
      if (this._posHistory.length > 6) this._posHistory.shift();
    }

    // Реальная детекция зависания: не сдвинулись за последние 3 замера
    if (this._posHistory.length >= 3) {
      const last3 = this._posHistory.slice(-3);
      const moved = last3.some((p, i) => i > 0 &&
        (Math.abs(p.x - last3[i-1].x) > 2 || Math.abs(p.z - last3[i-1].z) > 2)
      );
      if (!moved) {
        this._stuckAttempts++;
        if (this._stuckAttempts <= 3) {
          await this._unstuck(this._stuckAttempts);
        }
        return;
      } else {
        this._stuckAttempts = 0;
      }
    }
  }

  async _escapeFireOrWater() {
    const bot = this.bot;
    log.info("[AgentLoop] On fire!");
    const water = bot.findBlock({
      matching: (b) => b.type === (bot.registry.blocksByName.water?.id || 0),
      maxDistance: 20,
    });
    if (water) {
      try {
        await bot.pathfinder.goto(
          new goals.GoalBlock(water.position.x, water.position.y, water.position.z)
        );
      } catch {}
    } else {
      // Прыгаем в случайном направлении
      await this._unstuck(1);
    }
  }

  async _unstuck(attempt) {
    const bot = this.bot;
    log.info("[AgentLoop] Unstuck attempt", attempt);
    this._posHistory = []; // сбрасываем историю

    try { bot.pathfinder.stop(); } catch {}

    const directions = [0, Math.PI / 2, Math.PI, -Math.PI / 2, Math.PI / 4, -Math.PI / 4];
    const yaw = directions[(attempt - 1) % directions.length];
    bot.entity.yaw = yaw;

    bot.setControlState("jump", true);
    bot.setControlState("forward", true);
    await delay(1000);
    bot.setControlState("jump", false);

    if (attempt >= 2) {
      // Более агрессивный выход
      bot.setControlState("back", true);
      await delay(500);
      bot.setControlState("back", false);
    }
    bot.setControlState("forward", false);
  }

  // ── Утилиты ───────────────────────────────────────────────────────────

  _chat(text) {
    const bot = this.bot;
    if (!bot || !text) return;
    const msg = String(text).slice(0, 100);
    try { bot.chat(msg); } catch {}
    this.instance.chatHistory.push({ type: "system", text: `[AUTO] ${msg}`, timestamp: Date.now() });
    this.emit("bot:chat", {
      botId: this.instance.id,
      username: this.instance.config.nick,
      message: `[AUTO] ${msg}`,
      type: "system",
    });
  }

  stop() {
    this._active = false;
    if (this._mainLoop) { clearInterval(this._mainLoop); this._mainLoop = null; }
    log.info("[AgentLoop] Stopped for bot", this.instance.id);
  }
}

module.exports = { AgentLoop };
