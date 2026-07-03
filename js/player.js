// Player: movement state machine, survival stats, inventory, combat helpers.
import { B, I, itemInfo, blockInfo, maxStack } from './blocks.js';
import { boxHits } from './entities.js';
import { sfx } from './audio.js';

export class Player {
  constructor(world) {
    this.world = world;
    this.pos = { x: 8.5, y: 90, z: 8.5 }; this.prev = { x: 8.5, y: 90, z: 8.5 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0; this.pitch = 0;
    this.w = 0.6; this.h = 1.8;
    this.hp = 20; this.hunger = 20; this.sat = 5; this.exh = 0;
    this.air = 300;
    this.xp = 0; this.level = 0;
    this.inv = Array(36).fill(null);   // 0-8 = hotbar
    this.armor = Array(4).fill(null);  // helmet, chest, legs, boots
    this.off = null;                   // off-hand (shield/torch)
    this.sel = 0;
    this.dead = false; this.sleeping = false;
    this.onGround = false; this.inWater = false; this.inLava = false; this.headInWater = false;
    this.sneaking = false; this.sprinting = false; this.blocking = false;
    this.fall = 0; this.fireTicks = 0;
    this.lastSwing = -99;
    this.spawnPoint = null;
    this.regenTimer = 0; this.starveTimer = 0; this.hurtCd = 0; this.lavaCd = 0; this.drownCd = 0;
    this.stepAcc = 0;
    this.onHurt = null; // UI hook
    this.deathCause = '';
  }

  heldStack() { return this.inv[this.sel]; }
  heldTool() { const s = this.heldStack(); return s ? itemInfo[s.id]?.tool : null; }

  addStack(stack) {
    let n = stack.n;
    const max = maxStack(stack.id);
    if (max > 1 && stack.dur === undefined) {
      for (let i = 0; i < 36 && n > 0; i++) {
        const s = this.inv[i];
        if (s && s.id === stack.id && s.dur === undefined && s.n < max) {
          const take = Math.min(max - s.n, n); s.n += take; n -= take;
        }
      }
    }
    for (let i = 0; i < 36 && n > 0; i++) {
      if (!this.inv[i]) {
        const take = Math.min(max, n);
        this.inv[i] = { id: stack.id, n: take };
        if (stack.dur !== undefined) this.inv[i].dur = stack.dur;
        n -= take;
      }
    }
    return n;
  }
  consumeHeld(n = 1) {
    const s = this.inv[this.sel];
    if (!s) return;
    s.n -= n;
    if (s.n <= 0) this.inv[this.sel] = null;
  }
  countItem(id) {
    let n = 0;
    for (const s of this.inv) if (s && s.id === id) n += s.n;
    return n;
  }
  removeItem(id, n) {
    for (let i = 0; i < this.inv.length && n > 0; i++) {
      const s = this.inv[i];
      if (s && s.id === id) {
        const take = Math.min(s.n, n);
        s.n -= take; n -= take;
        if (s.n <= 0) this.inv[i] = null;
      }
    }
  }
  damageTool(slotStack, amount = 1) {
    if (!slotStack) return;
    const info = itemInfo[slotStack.id];
    const cap = info?.tool?.dur ?? info?.armor?.dur ?? info?.dur;
    if (!cap) return;
    if (slotStack.dur === undefined) slotStack.dur = cap;
    slotStack.dur -= amount;
    if (slotStack.dur <= 0) {
      sfx('toolbreak');
      for (let i = 0; i < 36; i++) if (this.inv[i] === slotStack) this.inv[i] = null;
      for (let i = 0; i < 4; i++) if (this.armor[i] === slotStack) this.armor[i] = null;
      if (this.off === slotStack) this.off = null;
    }
  }

  exhaust(n) {
    this.exh += n;
    while (this.exh >= 4) {
      this.exh -= 4;
      if (this.sat > 0) this.sat = Math.max(0, this.sat - 1);
      else this.hunger = Math.max(0, this.hunger - 1);
    }
  }
  armorPoints() {
    let p = 0;
    for (const a of this.armor) if (a) p += itemInfo[a.id]?.armor?.pts ?? 0;
    return p;
  }

  damage(dmg, kb, source = '') {
    if (this.dead || this.hurtCd > 0) return;
    // shield: blocks 100% of frontal hits while raised
    if (this.blocking && (this.off?.id === I.SHIELD || this.heldStack()?.id === I.SHIELD)) {
      let frontal = true;
      if (kb) {
        const lx = Math.sin(this.yaw) * -1, lz = Math.cos(this.yaw) * -1; // look dir
        const len = Math.hypot(kb.x, kb.z) || 1;
        // attack comes from -kb direction
        const dot = (-kb.x / len) * lx + (-kb.z / len) * lz;
        frontal = dot > 0.35; // ~90° cone
      }
      if (frontal) {
        sfx('shield');
        const sh = this.off?.id === I.SHIELD ? this.off : this.heldStack();
        this.damageTool(sh, Math.max(1, Math.round(dmg)));
        this.hurtCd = 5;
        return;
      }
    }
    const reduce = Math.min(0.8, this.armorPoints() * 0.04);
    dmg = Math.max(0, dmg * (1 - reduce));
    this.hp -= dmg;
    this.hurtCd = 10;
    if (kb) { this.vel.x += kb.x * 6; this.vel.y += (kb.y ?? 0.35) * 6; this.vel.z += kb.z * 6; }
    // armor durability
    const worn = this.armor.filter(Boolean);
    if (worn.length && dmg > 0) this.damageTool(worn[(Math.random() * worn.length) | 0], 1);
    sfx('playerhurt');
    this.onHurt?.();
    if (this.hp <= 0) this.die(source);
  }
  envDamage(n, source = '') {
    if (this.dead) return;
    this.hp -= n;
    sfx('playerhurt');
    this.onHurt?.();
    if (this.hp <= 0) this.die(source);
  }

  die(source) {
    this.dead = true;
    this.deathCause = source;
    this.deathPos = { x: this.pos.x, y: this.pos.y, z: this.pos.z };
    const w = this.world;
    if (w.dropItem) {
      const dropAll = arr => arr.forEach((s, i) => {
        if (s) { w.dropItem(this.pos.x, this.pos.y + 1, this.pos.z, s); arr[i] = null; }
      });
      dropAll(this.inv); dropAll(this.armor);
      if (this.off) { w.dropItem(this.pos.x, this.pos.y + 1, this.pos.z, this.off); this.off = null; }
    }
    sfx('death');
  }
  respawn(worldSpawn, atDeath = false) {
    const p = atDeath && this.deathPos ? this.deathPos : (this.spawnPoint ?? worldSpawn);
    this.pos = { x: p.x, y: p.y, z: p.z }; this.prev = { ...this.pos };
    if (atDeath) {
      // nudge upward out of solid ground in case terrain settled/changed since death
      let guard = 0;
      while (guard++ < 10 && this.world.isSolid(Math.floor(this.pos.x), Math.floor(this.pos.y), Math.floor(this.pos.z))) {
        this.pos.y++; this.prev.y = this.pos.y;
      }
    }
    this.vel = { x: 0, y: 0, z: 0 };
    this.hp = 20; this.hunger = 20; this.sat = 5; this.exh = 0;
    this.air = 300; this.fireTicks = 0; this.fall = 0;
    this.dead = false;
  }

  addXp(n) {
    this.xp += n;
    while (this.xp >= this.xpNeed()) { this.xp -= this.xpNeed(); this.level++; sfx('levelup'); }
  }
  xpNeed() { return 7 + this.level * 2; }

  // 20 TPS survival logic
  tick() {
    if (this.dead || this.sleeping) return;
    if (this.hurtCd > 0) this.hurtCd--;
    // hunger: regen at >=18, starve at 0
    if (this.hunger >= 18 && this.hp < 20) {
      if (++this.regenTimer >= 80) { this.regenTimer = 0; this.hp = Math.min(20, this.hp + 1); this.exhaust(1.5); }
    } else if (this.hunger <= 0) {
      if (++this.starveTimer >= 80) {
        this.starveTimer = 0;
        if (this.hp > 1) this.envDamage(1, 'starvation');
      }
    } else { this.regenTimer = 0; this.starveTimer = 0; }
    // oxygen: 10 bubbles / 15 seconds
    if (this.headInWater) {
      this.air--;
      if (this.air <= 0 && ++this.drownCd >= 20) { this.drownCd = 0; this.envDamage(1, 'drowning'); }
    } else { this.air = Math.min(300, this.air + 8); this.drownCd = 0; }
    // lava & fire
    if (this.inLava) {
      this.fireTicks = 160;
      if (++this.lavaCd >= 10) { this.lavaCd = 0; this.envDamage(4, 'lava'); }
    }
    if (this.fireTicks > 0) {
      this.fireTicks--;
      if (this.inWater || (this.world.weather !== 'clear' && this.world.lightAt(Math.floor(this.pos.x), Math.floor(this.pos.y + 2), Math.floor(this.pos.z)).s > 12)) this.fireTicks = 0;
      else if (this.fireTicks % 20 === 0) this.envDamage(1, 'fire');
    }
  }

  // per-frame movement with sneak edge protection
  moveFrame(dt, input) {
    if (this.dead || this.sleeping) return;
    const world = this.world;
    dt = Math.min(dt, 0.05);
    this.sneaking = input.sneak && this.onGround;
    this.sprinting = input.sprint && input.f && !this.sneaking && this.hunger > 6 && !this.blocking;
    const swimming = this.headInWater;
    this.h = this.sneaking ? 1.5 : 1.8;

    let speed = this.sneaking ? 1.3 : this.sprinting ? 5.6 : 4.32;
    if (this.inWater) speed *= 0.55;
    if (this.blocking) speed = Math.min(speed, 1.3);
    let mx = 0, mz = 0;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    if (input.f) { mx -= sy; mz -= cy; }
    if (input.b) { mx += sy; mz += cy; }
    if (input.l) { mx -= cy; mz += sy; }
    if (input.r) { mx += cy; mz -= sy; }
    const ml = Math.hypot(mx, mz);
    if (ml > 0) { mx = mx / ml * speed; mz = mz / ml * speed; }
    const accel = this.onGround ? 14 : (this.inWater ? 6 : 3.5);
    this.vel.x += (mx - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (mz - this.vel.z) * Math.min(1, accel * dt);

    if (input.jump) {
      if (this.inWater) this.vel.y = Math.min(this.vel.y + 24 * dt, 3.2);
      else if (this.onGround) {
        this.vel.y = 9;
        this.exhaust(this.sprinting ? 0.2 : 0.05);
      }
    }
    // gravity
    const g = this.inWater ? 10 : 32;
    this.vel.y -= g * dt;
    if (this.inWater) this.vel.y = Math.max(this.vel.y, -3);

    const w2 = this.w / 2;
    const wasGround = this.onGround;
    // Y axis
    let ny = this.pos.y + this.vel.y * dt;
    this.onGround = false;
    if (boxHits(world, this.pos.x - w2, ny, this.pos.z - w2, this.pos.x + w2, ny + this.h, this.pos.z + w2)) {
      if (this.vel.y < 0) {
        ny = Math.floor(ny) + 1;
        this.onGround = true;
        if (this.fall > 3 && !this.inWater) {
          this.envDamage(Math.floor(this.fall - 3), 'fall');
          sfx('thud');
        }
        this.fall = 0;
      } else ny = this.pos.y;
      this.vel.y = 0;
    }
    if (this.vel.y < 0) this.fall += this.pos.y - ny;
    if (this.inWater) this.fall = 0;
    this.pos.y = ny;
    // X / Z with sneak edge rule
    const tryAxis = (axis) => {
      const v = this.vel[axis] * dt;
      if (v === 0) return;
      const cand = { x: this.pos.x, z: this.pos.z };
      cand[axis] += v;
      if (boxHits(world, cand.x - w2, this.pos.y, cand.z - w2, cand.x + w2, this.pos.y + this.h, cand.z + w2)) {
        this.vel[axis] = 0;
        return;
      }
      if (this.sneaking && wasGround) {
        const groundBelow = boxHits(world, cand.x - w2, this.pos.y - 0.1, cand.z - w2, cand.x + w2, this.pos.y, cand.z + w2);
        if (!groundBelow) { this.vel[axis] = 0; return; }
      }
      this.pos[axis] = cand[axis];
    };
    tryAxis('x'); tryAxis('z');

    // fluid state
    const bx = Math.floor(this.pos.x), bz = Math.floor(this.pos.z);
    const bodyId = world.getBlock(bx, Math.floor(this.pos.y + 0.4), bz);
    const wasInWater = this.inWater;
    this.inWater = bodyId === B.WATER;
    this.inLava = bodyId === B.LAVA;
    const eyeId = world.getBlock(bx, Math.floor(this.pos.y + this.h * 0.9), bz);
    this.headInWater = eyeId === B.WATER;
    if (this.inWater && !wasInWater && this.vel.y < -3) sfx('splash');

    // footsteps + movement exhaustion (plain walking drains a little too, not just
    // sprinting/jumping/swimming — otherwise standing still or walking normally
    // never triggers hunger loss at all, which read as "hunger doesn't work")
    const hDist = Math.hypot(this.pos.x - this.prev.x, this.pos.z - this.prev.z);
    if (hDist > 0.0001) this.exhaust((this.sprinting ? 0.1 : 0.03) * hDist);
    if (this.onGround && hDist > 0.001) {
      this.stepAcc += hDist;
      if (this.stepAcc > 2.2) {
        this.stepAcc = 0;
        const below = world.getBlock(bx, Math.floor(this.pos.y - 0.5), bz);
        const pitch = [B.LOG_OAK, B.PLANKS, B.CRAFTING, B.CHEST].includes(below) ? 0.6 :
          [B.SAND, B.GRAVEL].includes(below) ? 1.4 :
          [B.STONE, B.COBBLE, B.DEEPSLATE].includes(below) ? 1.1 : 0.9;
        sfx('step', pitch);
      }
    }
    this.prev.x = this.pos.x; this.prev.y = this.pos.y; this.prev.z = this.pos.z;
  }

  // mining time in seconds for a block (Infinity = unbreakable)
  breakTime(id) {
    const info = blockInfo[id];
    if (!info || info.hard < 0) return Infinity;
    if (info.hard === 0) return 0.03;
    const tool = this.heldTool();
    const correct = info.tool && tool && tool.kind === info.tool;
    const canHarvest = !(info.tier > 0) || (correct && tool.tier >= info.tier);
    const speed = correct ? tool.speed : 1;
    let t = info.hard * (canHarvest ? 1.5 : 5) / speed;
    if (this.headInWater) t *= 5;
    if (!this.onGround) t *= 2;
    return t;
  }
  canHarvest(id) {
    const info = blockInfo[id];
    if (!info) return false;
    if (!(info.tier > 0)) return true;
    const tool = this.heldTool();
    return !!(tool && tool.kind === info.tool && tool.tier >= info.tier);
  }
  attackDamage() {
    const tool = this.heldTool();
    return tool ? tool.dmg : 1;
  }
  attackCooldown() {
    const tool = this.heldTool();
    return tool ? tool.cd : 0.25;
  }
}
