// Entities: physics base, dropped items, XP orbs, arrows, particles, mobs + AI.
import * as THREE from '../vendor/three.module.js';
import { B, I, itemInfo } from './blocks.js';
import { atlasCanvas, tileUV } from './atlas.js';
import { sfx } from './audio.js';

let atlasTex = null;
function getAtlasTex() {
  if (!atlasTex) {
    atlasTex = new THREE.CanvasTexture(atlasCanvas);
    atlasTex.magFilter = THREE.NearestFilter; atlasTex.minFilter = THREE.NearestFilter;
    atlasTex.generateMipmaps = false;
  }
  return atlasTex;
}
const spriteMat = () => new THREE.MeshBasicMaterial({
  map: getAtlasTex(), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide,
});
const tileGeoCache = new Map();
function tileGeo(tile, size = 0.45) {
  const k = tile + ':' + size;
  if (tileGeoCache.has(k)) return tileGeoCache.get(k);
  const g = new THREE.PlaneGeometry(size, size);
  const [u0, v0, u1, v1] = tileUV(tile);
  g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, v1, u1, v1, u0, v0, u1, v0], 2));
  tileGeoCache.set(k, g);
  return g;
}

// ---------- shared voxel AABB physics ----------
export function boxHits(world, x0, y0, z0, x1, y1, z1) {
  for (let x = Math.floor(x0); x <= Math.floor(x1 - 1e-7); x++)
    for (let y = Math.floor(y0); y <= Math.floor(y1 - 1e-7); y++)
      for (let z = Math.floor(z0); z <= Math.floor(z1 - 1e-7); z++)
        if (world.isSolid(x, y, z)) return true;
  return false;
}

export function stepPhysics(e, world, dt, gravity = 32) {
  const w2 = e.w / 2;
  e.onGround = false; e.hitWall = false;
  // Y
  let ny = e.pos.y + e.vel.y * dt;
  if (e.vel.y !== 0) {
    if (boxHits(world, e.pos.x - w2, ny, e.pos.z - w2, e.pos.x + w2, ny + e.h, e.pos.z + w2)) {
      if (e.vel.y < 0) {
        ny = Math.floor(ny) + 1;
        e.onGround = true;
        if (e.fall > 3 && !e.inWater) e.onLand?.(e.fall - 3);
        e.fall = 0;
      } else { ny = e.pos.y; }
      e.vel.y = 0;
    }
  }
  if (e.vel.y < 0) e.fall += e.pos.y - ny;
  e.pos.y = ny;
  // X
  let nx = e.pos.x + e.vel.x * dt;
  if (boxHits(world, nx - w2, e.pos.y, e.pos.z - w2, nx + w2, e.pos.y + e.h, e.pos.z + w2)) {
    nx = e.pos.x; e.vel.x = 0; e.hitWall = true;
  }
  e.pos.x = nx;
  // Z
  let nz = e.pos.z + e.vel.z * dt;
  if (boxHits(world, e.pos.x - w2, e.pos.y, nz - w2, e.pos.x + w2, e.pos.y + e.h, nz + w2)) {
    nz = e.pos.z; e.vel.z = 0; e.hitWall = true;
  }
  e.pos.z = nz;
  // fluids
  const bid = world.getBlock(Math.floor(e.pos.x), Math.floor(e.pos.y + 0.3), Math.floor(e.pos.z));
  e.inWater = bid === B.WATER;
  e.inLava = bid === B.LAVA;
  if (e.inWater || e.inLava) e.fall = 0;
  // gravity & drag
  const g = e.inWater ? gravity * 0.3 : gravity;
  e.vel.y -= g * dt;
  if (e.inWater) e.vel.y = Math.max(e.vel.y, -3);
  const drag = e.onGround ? 0.6 : 0.98;
  e.vel.x *= Math.pow(drag, dt * 20); e.vel.z *= Math.pow(drag, dt * 20);
}

export class Entity {
  constructor(world, x, y, z, w, h) {
    this.world = world;
    this.pos = { x, y, z }; this.prev = { x, y, z };
    this.vel = { x: 0, y: 0, z: 0 };
    this.w = w; this.h = h;
    this.dead = false; this.onGround = false; this.inWater = false; this.inLava = false;
    this.age = 0; this.fall = 0; this.mesh = null;
  }
  snapshot() { this.prev.x = this.pos.x; this.prev.y = this.pos.y; this.prev.z = this.pos.z; }
  render(alpha) {
    if (!this.mesh) return;
    this.mesh.position.set(
      this.prev.x + (this.pos.x - this.prev.x) * alpha,
      this.prev.y + (this.pos.y - this.prev.y) * alpha,
      this.prev.z + (this.pos.z - this.prev.z) * alpha);
  }
  remove() {
    this.dead = true;
    if (this.mesh) { this.world.scene.remove(this.mesh); }
  }
}

// ---------- dropped item ----------
export class ItemEntity extends Entity {
  constructor(world, x, y, z, stack, vel) {
    super(world, x, y, z, 0.25, 0.25);
    this.stack = stack;
    this.pickupDelay = 15;
    this.vel.x = vel?.x ?? (Math.random() - 0.5) * 1.2;
    this.vel.y = vel?.y ?? 3;
    this.vel.z = vel?.z ?? (Math.random() - 0.5) * 1.2;
    const tile = itemInfo[stack.id]?.tile ?? 0;
    this.mesh = new THREE.Mesh(tileGeo(tile, 0.4), spriteMat());
    world.scene.add(this.mesh);
  }
  tick(dt) {
    this.snapshot();
    this.age++;
    if (this.age > 6000) return this.remove();       // 5 min despawn
    stepPhysics(this, this.world, dt, 24);
    if (this.inLava) { sfx('fizz'); return this.remove(); } // destroyed in lava
    const p = this.world.player;
    if (p && !p.dead && this.pickupDelay-- <= 0) {
      const d = Math.hypot(p.pos.x - this.pos.x, (p.pos.y + 0.8) - this.pos.y, p.pos.z - this.pos.z);
      if (d < 1.25) {
        const left = p.addStack(this.stack);
        if (left === 0) { sfx('pop'); return this.remove(); }
        this.stack.n = left;
      }
    }
    this.mesh.rotation.y += 0.06;
    this.mesh.position.y = this.pos.y + 0.25 + Math.sin(this.age * 0.08) * 0.05;
  }
  render(a) {
    if (!this.mesh) return;
    this.mesh.position.x = this.prev.x + (this.pos.x - this.prev.x) * a;
    this.mesh.position.z = this.prev.z + (this.pos.z - this.prev.z) * a;
  }
}

export class XPOrb extends Entity {
  constructor(world, x, y, z, value) {
    super(world, x, y, z, 0.2, 0.2);
    this.value = value;
    this.vel.x = (Math.random() - 0.5) * 2; this.vel.y = 3; this.vel.z = (Math.random() - 0.5) * 2;
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0x9fe832 }));
    world.scene.add(this.mesh);
  }
  tick(dt) {
    this.snapshot();
    if (++this.age > 6000) return this.remove();
    const p = this.world.player;
    if (p && !p.dead) {
      const dx = p.pos.x - this.pos.x, dy = (p.pos.y + 0.8) - this.pos.y, dz = p.pos.z - this.pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < 0.6) { p.addXp(this.value); sfx('xp'); return this.remove(); }
      if (d < 3.5) { this.vel.x += dx / d * 12 * dt; this.vel.y += dy / d * 12 * dt; this.vel.z += dz / d * 12 * dt; }
    }
    stepPhysics(this, this.world, dt, 20);
  }
}

export class Arrow extends Entity {
  constructor(world, x, y, z, vel, dmg) {
    super(world, x, y, z, 0.12, 0.12);
    this.vel = vel; this.dmg = dmg; this.stuck = false;
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xd8d0c0 }));
    world.scene.add(this.mesh);
  }
  tick(dt) {
    this.snapshot();
    if (++this.age > 400) return this.remove();
    if (this.stuck) return;
    this.vel.y -= 18 * dt;
    this.pos.x += this.vel.x * dt; this.pos.y += this.vel.y * dt; this.pos.z += this.vel.z * dt;
    if (this.world.isSolid(Math.floor(this.pos.x), Math.floor(this.pos.y), Math.floor(this.pos.z))) {
      this.stuck = true; sfx('thud'); return;
    }
    this.mesh.lookAt(this.pos.x + this.vel.x, this.pos.y + this.vel.y, this.pos.z + this.vel.z);
    const p = this.world.player;
    if (p && !p.dead) {
      const w2 = p.w / 2;
      if (this.pos.x > p.pos.x - w2 && this.pos.x < p.pos.x + w2 &&
          this.pos.y > p.pos.y && this.pos.y < p.pos.y + p.h &&
          this.pos.z > p.pos.z - w2 && this.pos.z < p.pos.z + w2) {
        const d = Math.hypot(this.vel.x, this.vel.z) || 1;
        p.damage(this.dmg, { x: this.vel.x / d * 0.6, y: 0.4, z: this.vel.z / d * 0.6 }, 'Skeleton');
        return this.remove();
      }
    }
  }
}

// ---------- particles ----------
export class Burst extends Entity {
  constructor(world, x, y, z, color, n = 12) {
    super(world, x, y, z, 0, 0);
    this.life = 14;
    this.pts = [];
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      this.pts.push({ x, y, z, vx: (Math.random() - 0.5) * 4, vy: Math.random() * 4, vz: (Math.random() - 0.5) * 4 });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.mesh = new THREE.Points(g, new THREE.PointsMaterial({ color, size: 0.12 }));
    world.scene.add(this.mesh);
  }
  tick(dt) {
    if (--this.life <= 0) return this.remove();
    const a = this.mesh.geometry.attributes.position;
    this.pts.forEach((p, i) => {
      p.vy -= 12 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      a.setXYZ(i, p.x, p.y, p.z);
    });
    a.needsUpdate = true;
  }
  render() {}
}

// ---------- mobs ----------
const SPECS = {
  pig:      { hp: 10, speed: 1.6, w: 0.9, h: 0.9, hostile: false, food: I.WHEAT,
              colors: { body: 0xf0a0a8, head: 0xf0a0a8, leg: 0xd88890 },
              drops: r => [{ id: I.PORK_RAW, n: 1 + (r() * 2 | 0) }] },
  cow:      { hp: 10, speed: 1.4, w: 0.9, h: 1.3, hostile: false, food: I.WHEAT,
              colors: { body: 0x4a3626, head: 0x4a3626, leg: 0x3a2a1c },
              drops: r => [{ id: I.BEEF_RAW, n: 1 + (r() * 2 | 0) }, { id: I.LEATHER, n: 1 + (r() * 2 | 0) }] },
  sheep:    { hp: 8, speed: 1.4, w: 0.9, h: 1.2, hostile: false, food: I.WHEAT,
              colors: { body: 0xe8e8e8, head: 0xd8c8b8, leg: 0xc8c8c8 },
              drops: () => [{ id: I.MUTTON_RAW, n: 1 }, { id: B.WOOL, n: 1 }] },
  chicken:  { hp: 4, speed: 1.5, w: 0.5, h: 0.7, hostile: false, food: I.SEEDS,
              colors: { body: 0xe8e8e8, head: 0xe8e8e8, leg: 0xe8a020 },
              drops: () => [{ id: I.CHICKEN_RAW, n: 1 }, { id: I.FEATHER, n: 1 }] },
  zombie:   { hp: 20, speed: 1.9, w: 0.6, h: 1.9, hostile: true, dmg: 3, burns: true, xp: 5,
              colors: { body: 0x2a7a5a, head: 0x44aa66, leg: 0x28285a },
              drops: r => [{ id: I.ROTTEN_FLESH, n: 1 + (r() * 2 | 0) }] },
  skeleton: { hp: 20, speed: 2.0, w: 0.6, h: 1.9, hostile: true, ranged: true, burns: true, xp: 5,
              colors: { body: 0xc8c8c0, head: 0xd8d8d0, leg: 0xb8b8b0 },
              drops: r => [{ id: I.BONE, n: (r() * 3 | 0) }, { id: I.ARROW, n: (r() * 3 | 0) }].filter(s => s.n > 0) },
  creeper:  { hp: 20, speed: 2.0, w: 0.6, h: 1.7, hostile: true, creeper: true, xp: 5,
              colors: { body: 0x4dae3c, head: 0x4dae3c, leg: 0x3a8a2c },
              drops: r => [{ id: I.GUNPOWDER, n: 1 + (r() * 2 | 0) }] },
  spider:   { hp: 16, speed: 2.6, w: 1.2, h: 0.9, hostile: true, dmg: 2, spider: true, xp: 5,
              colors: { body: 0x2a2a2a, head: 0x3a3a3a, leg: 0x222222 },
              drops: r => [{ id: I.STRING, n: (r() * 3 | 0) }, ...(r() < 0.33 ? [{ id: I.SPIDER_EYE, n: 1 }] : [])].filter(s => s.n > 0) },
};

export class Mob extends Entity {
  constructor(world, type, x, y, z, baby = false) {
    const spec = SPECS[type];
    super(world, x, y, z, spec.w * (baby ? 0.5 : 1), spec.h * (baby ? 0.5 : 1));
    this.type = type; this.spec = spec;
    this.hp = spec.hp;
    this.baby = baby; this.growTimer = baby ? 4800 : 0;
    this.dir = Math.random() * Math.PI * 2;
    this.moveTimer = 0; this.moving = false;
    this.attackCd = 0; this.hurtFlash = 0; this.fireTicks = 0;
    this.fuse = 0; this.eggTimer = 6000 + Math.random() * 6000;
    this.loveTimer = 0; this.panicTimer = 0; this.provoked = false;
    this.lavaCd = 0; this.lightCd = 0;
    this.buildMesh();
  }
  buildMesh() {
    const g = new THREE.Group();
    const c = this.spec.colors;
    this.mats = [];
    const box = (w, h, d, color, x, y, z) => {
      const m = new THREE.MeshBasicMaterial({ color });
      m.userData = { base: new THREE.Color(color) };
      this.mats.push(m);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      g.add(mesh);
      return mesh;
    };
    const tall = this.spec.hostile && !this.spec.spider;
    if (tall) {
      box(0.5, 0.7, 0.28, c.body, 0, 1.05, 0);
      this.head = box(0.45, 0.45, 0.45, c.head, 0, 1.65, 0);
      this.legA = box(0.2, 0.7, 0.2, c.leg, -0.13, 0.35, 0);
      this.legB = box(0.2, 0.7, 0.2, c.leg, 0.13, 0.35, 0);
      if (this.type !== 'creeper') {
        box(0.16, 0.6, 0.16, c.body, -0.34, 1.1, 0);
        box(0.16, 0.6, 0.16, c.body, 0.34, 1.1, 0);
      }
    } else if (this.spec.spider) {
      box(1.0, 0.45, 1.2, c.body, 0, 0.45, 0);
      this.head = box(0.5, 0.4, 0.5, c.head, 0, 0.5, 0.75);
      for (let i = 0; i < 4; i++) {
        this.legA = box(0.12, 0.4, 0.12, c.leg, -0.6, 0.2, -0.4 + i * 0.28);
        this.legB = box(0.12, 0.4, 0.12, c.leg, 0.6, 0.2, -0.4 + i * 0.28);
      }
      const eye = box(0.08, 0.08, 0.05, 0xd82020, -0.12, 0.58, 1.0);
      box(0.08, 0.08, 0.05, 0xd82020, 0.12, 0.58, 1.0);
    } else {
      const bh = this.type === 'chicken' ? 0.35 : 0.55;
      box(0.6, bh, 0.9, c.body, 0, 0.6, 0);
      this.head = box(0.4, 0.4, 0.4, c.head, 0, 0.85, 0.55);
      this.legA = box(0.15, 0.4, 0.15, c.leg, -0.2, 0.2, 0.3);
      this.legB = box(0.15, 0.4, 0.15, c.leg, 0.2, 0.2, 0.3);
      box(0.15, 0.4, 0.15, c.leg, -0.2, 0.2, -0.3);
      box(0.15, 0.4, 0.15, c.leg, 0.2, 0.2, -0.3);
      if (this.type === 'pig') box(0.16, 0.12, 0.08, 0xe08890, 0, 0.8, 0.78);
    }
    const s = this.baby ? 0.5 : 1;
    g.scale.set(s * this.spec.w / 0.9, s, s * this.spec.w / 0.9);
    this.mesh = g;
    this.world.scene.add(g);
  }

  hurt(dmg, kb, byPlayer = false) {
    if (this.dead) return;
    this.hp -= dmg;
    this.hurtFlash = 8;
    sfx('hurt');
    if (kb) { this.vel.x += kb.x * 6; this.vel.y += (kb.y ?? 0.4) * 6; this.vel.z += kb.z * 6; }
    if (byPlayer) this.provoked = true;
    if (!this.spec.hostile) { this.panicTimer = 80; }
    if (this.hp <= 0) this.die(byPlayer);
  }
  die(byPlayer) {
    const w = this.world;
    sfx('death');
    if (w.dropItem) for (const d of this.spec.drops(Math.random.bind(Math)))
      w.dropItem(this.pos.x, this.pos.y + 0.3, this.pos.z, d);
    if (byPlayer && w.onXp) w.onXp(this.pos.x, this.pos.y + 0.5, this.pos.z, this.spec.xp ?? (1 + (Math.random() * 3 | 0)));
    this.remove();
  }
  onLand(dist) { this.hurt(Math.floor(dist), null); }

  tick(dt) {
    this.snapshot();
    this.age++;
    const w = this.world, p = w.player;
    if (this.hurtFlash > 0) this.hurtFlash--;
    if (this.attackCd > 0) this.attackCd--;
    if (this.loveTimer > 0) this.loveTimer--;
    if (this.baby && --this.growTimer <= 0) {
      this.baby = false; this.w = this.spec.w; this.h = this.spec.h;
      this.mesh.scale.set(this.spec.w / 0.9, 1, this.spec.w / 0.9);
    }
    // sunlight burning
    if (this.spec.burns && this.lightCd-- <= 0) {
      this.lightCd = 20;
      const L = w.lightAt(Math.floor(this.pos.x), Math.floor(this.pos.y + this.h), Math.floor(this.pos.z));
      if (w.dayFactor() > 0.6 && L.s > 10 && !this.inWater) this.fireTicks = 60;
    }
    if (this.inLava) { if (this.lavaCd-- <= 0) { this.lavaCd = 10; this.hurt(4, null); } this.fireTicks = 120; }
    if (this.fireTicks > 0) {
      this.fireTicks--;
      if (this.inWater) this.fireTicks = 0;
      else if (this.fireTicks % 20 === 0) this.hurt(1, null);
      this.mats.forEach(m => m.color.setHex(0xff6820));
    }
    if (this.dead) return;

    // ---- AI ----
    const distP = p && !p.dead ? Math.hypot(p.pos.x - this.pos.x, p.pos.y - this.pos.y, p.pos.z - this.pos.z) : 999;
    const feetL = w.lightAt(Math.floor(this.pos.x), Math.floor(this.pos.y), Math.floor(this.pos.z));
    const daySafe = w.dayFactor() > 0.6 && feetL.s > 8;   // spiders neutral in daylight
    let aggro = this.spec.hostile && distP < 16 &&
      (!this.spec.spider || !daySafe || this.provoked);
    let speed = this.spec.speed;

    if (this.spec.creeper) {
      if (distP < 3) {
        this.fuse++;
        if (this.fuse === 1) sfx('fuse');
        this.mats.forEach(m => { if (this.fuse % 10 < 5) m.color.setHex(0xffffff); });
        if (this.fuse >= 30) { // 1.5 s
          w.explode(this.pos.x, this.pos.y + 0.5, this.pos.z, 3);
          sfx('explode');
          w.effects.push(new Burst(w, this.pos.x, this.pos.y + 1, this.pos.z, 0x888888, 24));
          return this.remove();
        }
      } else if (distP > 6) this.fuse = 0;
    }

    if (this.panicTimer > 0) {
      this.panicTimer--;
      if (this.panicTimer % 20 === 0) this.dir = Math.random() * Math.PI * 2;
      this.moving = true; speed *= 1.6;
    } else if (aggro) {
      const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
      this.dir = Math.atan2(dx, dz);
      if (this.spec.ranged) {
        this.moving = distP > 9 ? true : distP < 6 ? (this.dir += Math.PI, true) : false;
        if (distP < 14 && this.attackCd <= 0) {
          this.attackCd = 45;
          const d = distP;
          const vel = { x: dx / d * 16, y: (p.pos.y + 1.4 - this.pos.y - 1.5) / d * 16 + d * 0.35, z: dz / d * 16 };
          w.entities.push(new Arrow(w, this.pos.x, this.pos.y + 1.5, this.pos.z, vel, 3));
          sfx('bow');
        }
      } else {
        this.moving = true;
        if (distP < (this.spec.spider ? 1.6 : 1.5) + this.w / 2 && this.attackCd <= 0 && !this.spec.creeper) {
          this.attackCd = 20;
          const d = distP || 1;
          p.damage(this.spec.dmg ?? 2, { x: dx / d * 0.5, y: 0.35, z: dz / d * 0.5 }, this.type);
        }
        if (this.spec.creeper && distP < 3) this.moving = false;
      }
    } else {
      // wander
      if (--this.moveTimer <= 0) {
        this.moveTimer = 40 + Math.random() * 100;
        this.moving = Math.random() < 0.55;
        this.dir = Math.random() * Math.PI * 2;
      }
      // move toward loved partner
      if (this.loveTimer > 0) {
        const mate = w.entities.find(e => e !== this && e instanceof Mob && e.type === this.type && e.loveTimer > 0 && !e.baby);
        if (mate) {
          const dx = mate.pos.x - this.pos.x, dz = mate.pos.z - this.pos.z;
          const d = Math.hypot(dx, dz);
          this.dir = Math.atan2(dx, dz); this.moving = d > 1.2;
          if (d < 1.4 && this.loveTimer > 1 && mate.loveTimer > 1) {
            this.loveTimer = 0; mate.loveTimer = 0;
            w.entities.push(new Mob(w, this.type, this.pos.x, this.pos.y, this.pos.z, true));
            if (w.onXp) w.onXp(this.pos.x, this.pos.y + 1, this.pos.z, 2);
            sfx('pop');
          }
        }
      }
    }

    if (this.moving) {
      this.vel.x += Math.sin(this.dir) * speed * 6 * dt;
      this.vel.z += Math.cos(this.dir) * speed * 6 * dt;
      const hv = Math.hypot(this.vel.x, this.vel.z);
      if (hv > speed) { this.vel.x *= speed / hv; this.vel.z *= speed / hv; }
      if (this.hitWall && this.onGround) this.vel.y = 8.5;                 // hop up blocks
      if (this.spec.spider && this.hitWall) this.vel.y = 3;                // wall climb
      if (this.inWater) this.vel.y = Math.max(this.vel.y, 2);
    }
    stepPhysics(this, w, dt, this.type === 'chicken' ? 12 : 32);
    if (this.type === 'chicken') {
      this.vel.y = Math.max(this.vel.y, -2);
      if (--this.eggTimer <= 0) {
        this.eggTimer = 6000 + Math.random() * 6000;
        if (w.dropItem) w.dropItem(this.pos.x, this.pos.y, this.pos.z, { id: I.EGG, n: 1 });
        sfx('pop');
      }
    }
    // fall out of world
    if (this.pos.y < -70) return this.remove();

    // visuals
    this.mesh.rotation.y = this.dir;
    const t = this.age * 0.35;
    const swing = this.moving ? Math.sin(t) * 0.6 : 0;
    if (this.legA) { this.legA.rotation.x = swing; this.legB.rotation.x = -swing; }
    if (this.hurtFlash > 0) this.mats.forEach(m => m.color.setHex(0xff3030));
    else if (this.fireTicks <= 0 && (!this.spec.creeper || this.fuse === 0)) {
      const L = w.lightAt(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.5), Math.floor(this.pos.z));
      const f = 0.15 + 0.85 * Math.max(L.b, L.s * w.dayFactor()) / 15;
      this.mats.forEach(m => { m.color.copy(m.userData.base).multiplyScalar(f); });
    }
  }
}

function buildHumanoidMesh(colors) {
  const g = new THREE.Group();
  const mats = [];
  const box = (w, h, d, color, x, y, z) => {
    const m = new THREE.MeshBasicMaterial({ color });
    m.userData = { base: new THREE.Color(color) };
    mats.push(m);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };
  return { g, mats, box };
}

// ---------- villager ----------
export class Villager extends Entity {
  constructor(world, x, y, z, opts = {}) {
    super(world, x, y, z, 0.6, 1.9);
    this.profession = opts.profession ?? null;
    this.bed = opts.bed ?? null;
    this.homeWx = opts.village?.wx ?? x;
    this.homeWz = opts.village?.wz ?? z;
    this.groundY = opts.village?.groundY ?? Math.floor(y);
    this.hp = 20;
    this.dir = Math.random() * Math.PI * 2;
    this.moveTimer = 0; this.moving = false; this.sleeping = false;
    this.harvestCd = 40; this.farmTarget = null;
    this.hurtFlash = 0;
    this.buildMesh();
  }
  buildMesh() {
    const { g, mats, box } = buildHumanoidMesh();
    this.mats = mats;
    box(0.5, 0.9, 0.3, 0x5c4632, 0, 1.15, 0);   // robe
    this.head = box(0.4, 0.4, 0.4, 0xcfa276, 0, 1.75, 0); // head
    box(0.12, 0.2, 0.14, 0xb8895c, 0, 1.72, 0.24); // nose
    this.legA = box(0.18, 0.7, 0.18, 0x38343f, -0.13, 0.35, 0);
    this.legB = box(0.18, 0.7, 0.18, 0x38343f, 0.13, 0.35, 0);
    this.mesh = g;
    this.world.scene.add(g);
  }
  hurt(dmg, kb, byPlayer = false) {
    if (this.dead) return;
    this.hp -= dmg;
    this.hurtFlash = 8;
    sfx('hurt');
    if (kb) { this.vel.x += kb.x * 5; this.vel.y += (kb.y ?? 0.35) * 5; this.vel.z += kb.z * 5; }
    if (byPlayer) {
      // punching a villager makes every iron golem permanently hostile to the player
      for (const e of this.world.entities) if (e instanceof IronGolem) e.aggroPlayer = true;
    }
    if (this.hp <= 0) this.die();
  }
  die() {
    sfx('death');
    this.remove();
  }
  tryFarm() {
    const w = this.world, y = this.groundY + 1;
    let best = null, bestD = Infinity;
    // gardens can be placed up to ~28 blocks from the village well (see
    // buildVillageLayout's radius range), so the search has to reach that far
    for (let dx = -30; dx <= 30; dx++) for (let dz = -30; dz <= 30; dz++) {
      const x = Math.round(this.homeWx) + dx, z = Math.round(this.homeWz) + dz;
      if (w.getBlock(x, y, z) !== B.WHEAT) continue;
      const m = w.getMeta(x, y, z);
      if (!m || (m.crop ?? 0) < 7) continue;
      const d = (x - this.pos.x) ** 2 + (z - this.pos.z) ** 2;
      if (d < bestD) { bestD = d; best = { x, z }; }
    }
    this.farmTarget = best;
  }
  harvestCrop() {
    const w = this.world, t = this.farmTarget, y = this.groundY + 1;
    if (!t || w.getBlock(t.x, y, t.z) !== B.WHEAT) return;
    w.setBlock(t.x, y, t.z, B.WHEAT, { meta: { crop: 0 }, force: true }); // harvest + instant replant
    if (w.dropItem) w.dropItem(t.x + 0.5, y + 0.5, t.z + 0.5, { id: I.WHEAT, n: 1 });
  }
  tick(dt) {
    this.snapshot();
    this.age++;
    const w = this.world;
    if (this.hurtFlash > 0) this.hurtFlash--;
    if (this.dead) return;
    const night = w.isNight();
    if (night && this.bed) {
      this.sleeping = true;
      // beds sit behind a door, and this AI has no real pathfinding — heading
      // straight for the bed makes villagers walk into the exterior wall and
      // get stuck. Every entrance is a double door (see widenDoorway()); the
      // second leaf starts open, so the reliably-passable column is that one
      // (the main door defaults closed). Direct-line steering can't reliably
      // thread a 1-wide column without occasionally wedging into the wall
      // beside it, so lateral alignment into that column is snapped directly
      // (bypassing collision, since it's known-open by default) while forward
      // progress through it still goes through normal physics. If a player
      // shuts that second door, this simple AI has no way to reopen it and
      // may get stuck there, same as at any other closed door.
      const doorZ = this.bed.door?.z, doorX = this.bed.door?.x;
      const gapCenterX = doorX + 1.5;
      if (doorZ !== undefined && Math.abs(this.pos.z - (doorZ + 0.5)) < 2.5 && Math.abs(this.pos.x - gapCenterX) > 0.03) {
        this.pos.x += Math.max(-0.12, Math.min(0.12, gapCenterX - this.pos.x));
      }
      const passedDoor = doorZ !== undefined && this.pos.z > doorZ + 0.5;
      const useDoor = doorZ !== undefined && !passedDoor;
      const tx = useDoor ? gapCenterX : this.bed.x + 0.5;
      const tz = useDoor ? doorZ + 1.5 : this.bed.z + 0.5;
      const dx = tx - this.pos.x, dz = tz - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.7) { this.dir = Math.atan2(dx, dz); this.moving = true; }
      else this.moving = false;
    } else {
      this.sleeping = false;
      if (this.profession === 'farmer') {
        if (--this.harvestCd <= 0) { this.harvestCd = 80; this.tryFarm(); }
        if (this.farmTarget) {
          const dx = this.farmTarget.x + 0.5 - this.pos.x, dz = this.farmTarget.z + 0.5 - this.pos.z;
          const d = Math.hypot(dx, dz);
          if (d > 0.8) { this.dir = Math.atan2(dx, dz); this.moving = true; }
          else { this.harvestCrop(); this.farmTarget = null; this.moving = false; }
        } else if (--this.moveTimer <= 0) this.wander();
      } else if (--this.moveTimer <= 0) this.wander();
    }
    if (this.moving) {
      const speed = 1.3;
      this.vel.x += Math.sin(this.dir) * speed * 6 * dt;
      this.vel.z += Math.cos(this.dir) * speed * 6 * dt;
      const hv = Math.hypot(this.vel.x, this.vel.z);
      if (hv > speed) { this.vel.x *= speed / hv; this.vel.z *= speed / hv; }
      if (this.hitWall && this.onGround) this.vel.y = 8;
      if (this.inWater) this.vel.y = Math.max(this.vel.y, 2); // swim up — otherwise a villager that falls in water can never climb back out
    }
    stepPhysics(this, w, dt, 30);
    if (this.pos.y < -70) return this.remove();
    this.mesh.rotation.y = this.dir;
    const swing = this.moving ? Math.sin(this.age * 0.3) * 0.5 : 0;
    this.legA.rotation.x = swing; this.legB.rotation.x = -swing;
    if (this.hurtFlash > 0) this.mats.forEach(m => m.color.setHex(0xff3030));
    else {
      const L = w.lightAt(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.5), Math.floor(this.pos.z));
      const f = 0.15 + 0.85 * Math.max(L.b, L.s * w.dayFactor()) / 15;
      this.mats.forEach(m => m.color.copy(m.userData.base).multiplyScalar(f));
    }
  }
  wander() {
    this.moveTimer = 60 + Math.random() * 120;
    this.moving = Math.random() < 0.5;
    this.dir = Math.random() * Math.PI * 2;
    const distHome = Math.hypot(this.pos.x - this.homeWx, this.pos.z - this.homeWz);
    if (distHome > 20) this.dir = Math.atan2(this.homeWx - this.pos.x, this.homeWz - this.pos.z);
  }
}

// ---------- iron golem ----------
export class IronGolem extends Entity {
  constructor(world, x, y, z, opts = {}) {
    super(world, x, y, z, 1.4, 2.7);
    this.hp = 100; this.maxHp = 100;
    this.homeWx = opts.village?.wx ?? x;
    this.homeWz = opts.village?.wz ?? z;
    this.aggroPlayer = false;
    this.dir = Math.random() * Math.PI * 2;
    this.moveTimer = 0; this.moving = false;
    this.attackCd = 0; this.hurtFlash = 0;
    this.buildMesh();
  }
  buildMesh() {
    const { g, mats, box } = buildHumanoidMesh();
    this.mats = mats;
    box(1.0, 1.2, 0.6, 0xb8b8b0, 0, 1.7, 0);
    this.head = box(0.5, 0.5, 0.5, 0xb0b0a8, 0, 2.55, 0);
    box(0.4, 1.0, 0.4, 0xacaca4, -0.75, 1.4, 0);
    box(0.4, 1.0, 0.4, 0xacaca4, 0.75, 1.4, 0);
    this.legA = box(0.38, 1.0, 0.38, 0x9a9a92, -0.3, 0.5, 0);
    this.legB = box(0.38, 1.0, 0.38, 0x9a9a92, 0.3, 0.5, 0);
    this.mesh = g;
    this.world.scene.add(g);
  }
  hurt(dmg, kb, byPlayer = false) {
    if (this.dead) return;
    this.hp -= dmg;
    this.hurtFlash = 8;
    sfx('hurt');
    if (byPlayer) this.aggroPlayer = true; // punched -> permanently hostile to that player
    if (kb) { this.vel.x += kb.x * 3; this.vel.y += (kb.y ?? 0.3) * 3; this.vel.z += kb.z * 3; }
    if (this.hp <= 0) this.die();
  }
  die() {
    const w = this.world;
    sfx('death');
    if (w.dropItem) {
      w.dropItem(this.pos.x, this.pos.y + 1, this.pos.z, { id: I.IRON_INGOT, n: 3 + (Math.random() * 3 | 0) });
      const poppies = (Math.random() * 3) | 0;
      if (poppies > 0) w.dropItem(this.pos.x, this.pos.y + 1, this.pos.z, { id: B.FLOWER, n: poppies });
    }
    this.remove();
  }
  tick(dt) {
    this.snapshot();
    this.age++;
    const w = this.world, p = w.player;
    if (this.hurtFlash > 0) this.hurtFlash--;
    if (this.attackCd > 0) this.attackCd--;
    if (this.dead) return;
    let target = null, bestD = 12 * 12;
    if (this.aggroPlayer && p && !p.dead) {
      const d = (p.pos.x - this.pos.x) ** 2 + (p.pos.z - this.pos.z) ** 2;
      if (d < bestD) { target = p; bestD = d; }
    }
    for (const e of w.entities) {
      if (e === this || !(e instanceof Mob) || !e.spec?.hostile) continue;
      const d = (e.pos.x - this.pos.x) ** 2 + (e.pos.z - this.pos.z) ** 2;
      if (d < bestD) { target = e; bestD = d; }
    }
    if (target) {
      const dx = target.pos.x - this.pos.x, dz = target.pos.z - this.pos.z;
      const d = Math.sqrt(bestD) || 1;
      this.dir = Math.atan2(dx, dz);
      this.moving = d > 2.2;
      if (d < 2.4 && this.attackCd <= 0) {
        this.attackCd = 30;
        const kx = dx / d, kz = dz / d;
        // heavy upward swing: big knockup, and enough raw damage to one-shot a
        // basic zombie (20 HP) outright rather than relying on inconsistent
        // fall-damage follow-through once it's airborne
        if (target === p) p.damage(8, { x: kx * 0.8, y: 1.0, z: kz * 0.8 }, 'Iron Golem');
        else target.hurt(20, { x: kx * 0.8, y: 1.0, z: kz * 0.8 }, false);
        sfx('thud');
      }
    } else if (--this.moveTimer <= 0) {
      this.moveTimer = 60 + Math.random() * 120;
      this.moving = Math.random() < 0.6;
      this.dir = Math.random() * Math.PI * 2;
      const distHome = Math.hypot(this.pos.x - this.homeWx, this.pos.z - this.homeWz);
      if (distHome > 16) this.dir = Math.atan2(this.homeWx - this.pos.x, this.homeWz - this.pos.z);
    }
    if (this.moving) {
      const speed = 1.1;
      this.vel.x += Math.sin(this.dir) * speed * 6 * dt;
      this.vel.z += Math.cos(this.dir) * speed * 6 * dt;
      const hv = Math.hypot(this.vel.x, this.vel.z);
      if (hv > speed) { this.vel.x *= speed / hv; this.vel.z *= speed / hv; }
      if (this.hitWall && this.onGround) this.vel.y = 9;
      if (this.inWater) this.vel.y = Math.max(this.vel.y, 2); // swim up — otherwise a golem that falls in water can never climb back out
    }
    stepPhysics(this, w, dt, 32);
    if (this.pos.y < -70) return this.remove();
    this.mesh.rotation.y = this.dir;
    const swing = this.moving ? Math.sin(this.age * 0.25) * 0.5 : 0;
    this.legA.rotation.x = swing; this.legB.rotation.x = -swing;
    if (this.hurtFlash > 0) this.mats.forEach(m => m.color.setHex(0xff3030));
    else {
      const L = w.lightAt(Math.floor(this.pos.x), Math.floor(this.pos.y + 1), Math.floor(this.pos.z));
      const f = 0.2 + 0.8 * Math.max(L.b, L.s * w.dayFactor()) / 15;
      this.mats.forEach(m => m.color.copy(m.userData.base).multiplyScalar(f));
    }
  }
}

export function spawnMob(world, type, x, y, z) {
  const m = new Mob(world, type, x, y, z);
  world.entities.push(m);
  return m;
}
export { SPECS };
