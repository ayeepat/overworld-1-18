// Chunked voxel world: storage, lighting, meshing, fluids, random ticks, furnaces.
import * as THREE from '../vendor/three.module.js';
import { B, blockInfo, SMELT, FUEL, maxStack, CROP_TILES } from './blocks.js';
import { atlasCanvas, tileUV } from './atlas.js';
import { WorldGen, SEA, Y0, YMAX, WH, CS, BIOME } from './worldgen.js';

export { SEA, Y0, YMAX, WH, CS };
export const keyOf = (x, y, z) => x + ',' + y + ',' + z;
const numKey = (x, y, z) => (x * 2097152 + z) * 1024 + (y - Y0);
const cKey = (cx, cz) => cx + ',' + cz;
const idxOf = (lx, y, lz) => ((lx << 4 | lz) * WH) + (y - Y0);

const FACES = [
  { d: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.6, uvm: p => [p[2], p[1]] },
  { d: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.6, uvm: p => [p[2], p[1]] },
  { d: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.0, uvm: p => [p[0], p[2]] },
  { d: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.5, uvm: p => [p[0], p[2]] },
  { d: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.8, uvm: p => [p[0], p[1]] },
  { d: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.8, uvm: p => [p[0], p[1]] },
];

class Chunk {
  constructor(cx, cz) {
    this.cx = cx; this.cz = cz;
    this.b = new Uint8Array(CS * CS * WH);
    this.sky = new Uint8Array(CS * CS * WH);
    this.bl = new Uint8Array(CS * CS * WH);
    this.hmap = new Int16Array(CS * CS).fill(Y0);
    this.lights = new Set();
    this.mesh = null; this.wmesh = null;
    this.dirty = true; this.lightDirty = true; this.everLit = false;
    this.generated = false; this.inScene = false;
  }
}

const VERT = `
attribute float skyl; attribute float bll;
varying vec2 vUv; varying float vS; varying float vB; varying float vDist; varying vec3 vWorldPos;
void main(){ vUv=uv; vS=skyl; vB=bll;
  vec4 wp = modelMatrix * vec4(position,1.0);
  vWorldPos = wp.xyz;
  vec4 mv = viewMatrix * wp;
  vDist = -mv.z;
  gl_Position = projectionMatrix*mv; }`;
const FRAG = `
uniform sampler2D map; uniform float dayLight; uniform vec3 fogColor;
uniform float fogNear; uniform float fogFar; uniform float alpha; uniform float cutout;
uniform vec3 handLightPos; uniform float handLight;
varying vec2 vUv; varying float vS; varying float vB; varying float vDist; varying vec3 vWorldPos;
void main(){
  vec4 c = texture2D(map,vUv);
  if(cutout>0.5 && c.a<0.5) discard;
  float handDist = length(vWorldPos - handLightPos);
  float handL = max(0.0, handLight - handDist);
  float l = max(max(vB, vS*dayLight), handL)/15.0;
  l = 0.05 + 0.95*pow(l,1.4);
  float f = smoothstep(fogNear, fogFar, vDist);
  gl_FragColor = vec4(mix(c.rgb*l, fogColor, f), c.a*alpha);
}`;

export class World {
  constructor(seedStr, scene, viewR = 4) {
    this.seedStr = seedStr;
    this.gen = new WorldGen(seedStr);
    this.scene = scene;
    this.viewR = viewR;
    this.chunks = new Map();
    this.meta = new Map();
    this.keyOf = keyOf;
    this.flu = new Map();          // numKey -> fluid level (absent for full sources)
    this.fluQ = new Map();         // numKey -> due tick
    this.furnaces = new Set();     // string keys
    this.spawnQueue = [];
    this.entities = [];
    this.effects = [];
    this.player = null;
    this.time = 1000; this.tickCount = 0;
    this.weather = 'clear'; this.weatherTimer = 20 * 60 * 6;
    this.onXp = null; this.dropItem = null; // hooks set by main
    // save/load: only deliberate (force:true) block edits are recorded, bucketed
    // by chunk for O(1) lookup when a chunk streams back in. Transient fluid
    // spread updates are intentionally NOT recorded (they'd bloat the save and
    // just re-simulate similarly anyway) — see setBlock().
    this.editsByChunk = new Map(); // cKey(cx,cz) -> Map(localKey -> blockId)
    this.villageInfo = new Map();  // cKey(cx,cz) region -> village descriptor (see worldgen.js)

    const tex = new THREE.CanvasTexture(atlasCanvas);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    this.uniforms = {
      dayLight: { value: 1 }, fogColor: { value: new THREE.Color(0x87ceeb) },
      fogNear: { value: viewR * 16 * 0.6 }, fogFar: { value: viewR * 16 * 1.05 },
      handLightPos: { value: new THREE.Vector3() }, handLight: { value: 0 },
    };
    const mk = (alpha, cutout, transparent) => new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, alpha: { value: alpha }, cutout: { value: cutout },
        dayLight: this.uniforms.dayLight, fogColor: this.uniforms.fogColor,
        fogNear: this.uniforms.fogNear, fogFar: this.uniforms.fogFar,
        handLightPos: this.uniforms.handLightPos, handLight: this.uniforms.handLight },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent, side: THREE.DoubleSide, depthWrite: !transparent,
    });
    this.matSolid = mk(1, 1, false);
    this.matWater = mk(0.72, 0, true);
  }

  chunkAt(x, z) { return this.chunks.get(cKey(Math.floor(x / 16), Math.floor(z / 16))); }

  getBlock(x, y, z) {
    if (y < Y0 || y > YMAX) return B.AIR;
    const c = this.chunkAt(x, z);
    if (!c || !c.generated) return B.AIR;
    return c.b[idxOf(x & 15, y, z & 15)];
  }
  getBlockRaw(x, y, z) {
    if (y < Y0) return B.BEDROCK;
    if (y > YMAX) return B.AIR;
    const c = this.chunkAt(x, z);
    if (!c || !c.generated) return -1;
    return c.b[idxOf(x & 15, y, z & 15)];
  }
  isSolid(x, y, z) {
    const id = this.getBlock(x, y, z);
    return blockInfo[id]?.solid && id !== B.AIR;
  }
  lightAt(x, y, z) {
    if (y > YMAX) return { s: 15, b: 0 };
    if (y < Y0) return { s: 0, b: 0 };
    const c = this.chunkAt(x, z);
    if (!c || !c.generated) return { s: 15, b: 0 };
    const i = idxOf(x & 15, y, z & 15);
    return { s: c.sky[i], b: c.bl[i] };
  }
  getMeta(x, y, z) { return this.meta.get(keyOf(x, y, z)); }
  setMeta(x, y, z, m) { this.meta.set(keyOf(x, y, z), m); }
  delMeta(x, y, z) { this.meta.delete(keyOf(x, y, z)); }
  biomeAt(x, z) { return this.gen.colInfo(Math.floor(x), Math.floor(z)).biome; }
  surfaceY(x, z) {
    const c = this.chunkAt(x, z);
    if (!c) return SEA + 1;
    return c.hmap[(x & 15) << 4 | (z & 15)];
  }

  setBlock(x, y, z, id, opts = {}) {
    if (y < Y0 || y > YMAX) return;
    const c = this.chunkAt(x, z);
    if (!c || !c.generated) return;
    const lx = x & 15, lz = z & 15, i = idxOf(lx, y, lz);
    const old = c.b[i];
    if (old === id && !opts.force) return;
    c.b[i] = id;
    // lights bookkeeping
    if (blockInfo[old]?.light) c.lights.delete(i);
    if (blockInfo[id]?.light) c.lights.add(i);
    // heightmap
    const hi = lx << 4 | lz;
    if (id !== B.AIR && y > c.hmap[hi]) c.hmap[hi] = y;
    else if (id === B.AIR && y === c.hmap[hi]) {
      let yy = y - 1;
      while (yy > Y0 && c.b[idxOf(lx, yy, lz)] === B.AIR) yy--;
      c.hmap[hi] = yy;
    }
    // fluid bookkeeping
    const wasFluid = old === B.WATER || old === B.LAVA;
    const isFluid = id === B.WATER || id === B.LAVA;
    const nk = numKey(x, y, z);
    if (wasFluid && !isFluid) this.flu.delete(nk);
    if (isFluid) {
      if (opts.lv !== undefined) this.flu.set(nk, opts.lv); else this.flu.delete(nk);
      this.schedFluid(x, y, z, id === B.LAVA ? 30 : 5);
    }
    for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
      const nb = this.getBlock(x + dx, y + dy, z + dz);
      if (nb === B.WATER) this.schedFluid(x + dx, y + dy, z + dz, 5);
      else if (nb === B.LAVA) this.schedFluid(x + dx, y + dy, z + dz, 30);
    }
    // meta
    if (opts.meta) this.setMeta(x, y, z, opts.meta);
    else if (id === B.AIR) { this.furnaces.delete(keyOf(x, y, z)); this.delMeta(x, y, z); }
    // save/load edit log — only deliberate changes (force:true), not fluid spread
    if (opts.force) this.recordEdit(x, y, z, id);
    // dirty flags
    c.dirty = true; c.lightDirty = true;
    const markN = (dcx, dcz, light) => {
      const n = this.chunks.get(cKey(c.cx + dcx, c.cz + dcz));
      if (n) { n.dirty = true; if (light) n.lightDirty = true; }
    };
    const emitter = blockInfo[old]?.light || blockInfo[id]?.light;
    // boundary edits always need to re-run light BFS on the neighbor, since sky
    // light now propagates sideways across chunk borders (not just straight down).
    // a column at the exact corner of a chunk touches a diagonal neighbor too
    // (e.g. lx=0,lz=0 also borders the NW chunk, not just W and N) — missing that
    // left the diagonal chunk's lighting stale (often solid black) right at the
    // seam until something else happened to mark it dirty on its own.
    const dxEdge = lx === 0 ? -1 : lx === 15 ? 1 : 0;
    const dzEdge = lz === 0 ? -1 : lz === 15 ? 1 : 0;
    if (dxEdge) markN(dxEdge, 0, true);
    if (dzEdge) markN(0, dzEdge, true);
    if (dxEdge && dzEdge) markN(dxEdge, dzEdge, true);
    if (emitter) for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) markN(a, b, true);
    // support checks: things sitting on removed block fall/pop
    if (id === B.AIR || !blockInfo[id]?.solid) {
      const above = this.getBlock(x, y + 1, z);
      const ai = blockInfo[above];
      if (ai && (ai.kind === 'cross' || ai.kind === 'crop' || above === B.TORCH)) {
        this.breakBlock(x, y + 1, z, null, true);
      }
    }
  }

  // break with drops; silent=true → no drops
  breakBlock(x, y, z, rng, silent = false) {
    const id = this.getBlock(x, y, z);
    if (id === B.AIR) return;
    const info = blockInfo[id];
    const meta = this.getMeta(x, y, z);
    if (!silent && this.dropItem) {
      const r = rng || Math.random.bind(Math);
      let drops = info.drop ? info.drop(r) : [];
      if (info.kind === 'crop' && meta?.crop >= 7) drops = [{ id: 112, n: 1 }, { id: 113, n: 1 + (r() * 3 | 0) }];
      else if (info.kind === 'crop') drops = [{ id: 113, n: 1 }];
      if (meta?.chest) for (const s of meta.chest) if (s) drops.push(s);
      for (const d of drops) this.dropItem(x + 0.5, y + 0.5, z + 0.5, d);
      if (info.xp && this.onXp) this.onXp(x + 0.5, y + 0.5, z + 0.5, info.xp);
    }
    // doors & beds occupy two blocks
    if (info.kind === 'door') {
      const top = meta?.door?.top;
      this.setBlock(x, y, z, B.AIR, { force: true });
      const oy = top ? y - 1 : y + 1;
      if (blockInfo[this.getBlock(x, oy, z)]?.kind === 'door') { this.delMeta(x, oy, z); this.setBlock(x, oy, z, B.AIR, { force: true }); }
      return;
    }
    if (info.kind === 'bed') {
      this.setBlock(x, y, z, B.AIR, { force: true });
      for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        if (this.getBlock(x + dx, y, z + dz) === B.BED) { this.delMeta(x + dx, y, z + dz); this.setBlock(x + dx, y, z + dz, B.AIR, { force: true }); break; }
      }
      return;
    }
    this.setBlock(x, y, z, B.AIR, { force: true });
  }

  // ---------- fluids ----------
  schedFluid(x, y, z, delay) {
    const nk = numKey(x, y, z);
    if (!this.fluQ.has(nk)) this.fluQ.set(nk, this.tickCount + delay);
  }
  fluidLv(x, y, z) { return this.flu.get(numKey(x, y, z)) ?? 8; }
  isSource(x, y, z) { return !this.flu.has(numKey(x, y, z)); }

  tickFluids() {
    if (this.fluQ.size === 0) return;
    const due = [];
    for (const [nk, t] of this.fluQ) if (t <= this.tickCount) due.push(nk);
    let n = 0;
    for (const nk of due) {
      if (n++ > 300) break;
      this.fluQ.delete(nk);
      this.updateFluid(...this.decodeNum(nk));
    }
  }
  decodeNum(nk) {
    let y = ((nk % 1024) + 1024) % 1024;
    let rest = Math.round((nk - y) / 1024);
    let z = ((rest % 2097152) + 2097152 + 1048576) % 2097152 - 1048576;
    let x = Math.round((rest - z) / 2097152);
    return [x, y + Y0, z];
  }

  canFlowInto(id) {
    if (id === B.AIR) return true;
    const info = blockInfo[id];
    return info && (info.kind === 'cross' || info.kind === 'crop' || id === B.TORCH);
  }

  updateFluid(x, y, z) {
    const id = this.getBlock(x, y, z);
    if (id !== B.WATER && id !== B.LAVA) return;
    const isLava = id === B.LAVA;
    const nk = numKey(x, y, z);
    let hasEntry = this.flu.has(nk);
    const lv = hasEntry ? this.flu.get(nk) : 8;
    // lava + water contact
    if (isLava) {
      let touched = false;
      for (const [dx, dy, dz] of [[0,1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]])
        if (this.getBlock(x + dx, y + dy, z + dz) === B.WATER) { touched = true; break; }
      if (touched) {
        this.flu.delete(nk);
        this.setBlock(x, y, z, !hasEntry ? B.OBSIDIAN : B.COBBLE, { force: true });
        return;
      }
    } else {
      // water sitting on a lava source -> obsidian handled from lava side; water flowing onto lava below:
      const below = this.getBlock(x, y - 1, z);
      if (below === B.LAVA) this.schedFluid(x, y - 1, z, 2);
      // a flowing block touching 2+ source neighbors becomes a source itself —
      // the vanilla rule that turns e.g. a 2x2 diagonally-poured pool into a
      // stable infinite source, instead of one that quietly drains away once
      // the two originally-poured source blocks get scooped out
      if (hasEntry) {
        let sources = 0;
        for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]])
          if (this.getBlock(x + dx, y, z + dz) === B.WATER && this.isSource(x + dx, y, z + dz)) sources++;
        if (sources >= 2) { this.flu.delete(nk); hasEntry = false; }
      }
    }
    // support check for flowing blocks
    if (hasEntry) {
      const above = this.getBlock(x, y + 1, z);
      let ok = above === id;
      if (!ok && lv < 8) {
        for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const n = this.getBlock(x + dx, y, z + dz);
          if (n === id && this.fluidLv(x + dx, y, z + dz) > lv) { ok = true; break; }
        }
      }
      if (!ok) {
        this.flu.delete(nk);
        this.setBlock(x, y, z, B.AIR, { force: true });
        for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
          const nb = this.getBlock(x + dx, y + dy, z + dz);
          if (nb === id) this.schedFluid(x + dx, y + dy, z + dz, isLava ? 30 : 5);
        }
        return;
      }
    }
    const delay = isLava ? 30 : 5;
    // flow down first
    const below = this.getBlock(x, y - 1, z);
    if (this.canFlowInto(below)) {
      this.setBlock(x, y - 1, z, id, { lv: 8 });
      return;
    }
    // spread horizontally (water 7 blocks from source, lava 3)
    if (blockInfo[below]?.solid || below === id) {
      const spread = (hasEntry ? lv : 8) - (isLava ? 2 : 1);
      if (spread >= 1) {
        for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const t = this.getBlock(x + dx, y, z + dz);
          if (this.canFlowInto(t)) this.setBlock(x + dx, y, z + dz, id, { lv: spread });
          else if (t === id && this.flu.has(numKey(x + dx, y, z + dz)) && this.fluidLv(x + dx, y, z + dz) < spread) {
            this.flu.set(numKey(x + dx, y, z + dz), spread);
            this.schedFluid(x + dx, y, z + dz, delay);
          }
        }
      }
    }
  }

  // ---------- ticking ----------
  dayFactor() {
    const t = this.time % 24000;
    if (t < 12000) return 1;
    if (t < 13800) return 1 - (t - 12000) / 1800 * 0.88;
    if (t < 22200) return 0.12;
    return 0.12 + (t - 22200) / 1800 * 0.88;
  }
  isNight() { return this.dayFactor() < 0.35; }

  tick() {
    // NOTE: this.time (day/night clock) is advanced in main.js's render loop using
    // real unclamped elapsed time, not here — see comment there for why.
    this.tickCount++;
    this.tickFluids();
    // weather
    if (--this.weatherTimer <= 0) {
      const r = Math.random();
      if (this.weather === 'clear') this.weather = r < 0.75 ? 'rain' : 'thunder';
      else this.weather = 'clear';
      this.weatherTimer = 20 * 60 * (3 + Math.random() * 7);
    }
    // random ticks + furnaces
    this.randomTicks();
    this.tickFurnaces();
  }

  randomTicks() {
    const p = this.player;
    if (!p) return;
    const pcx = Math.floor(p.pos.x / 16), pcz = Math.floor(p.pos.z / 16);
    for (let a = -this.viewR; a <= this.viewR; a++) for (let b = -this.viewR; b <= this.viewR; b++) {
      const c = this.chunks.get(cKey(pcx + a, pcz + b));
      if (!c || !c.generated) continue;
      for (let i = 0; i < 2; i++) {
        const lx = (Math.random() * 16) | 0, lz = (Math.random() * 16) | 0;
        const wx = c.cx * 16 + lx, wz = c.cz * 16 + lz;
        const y = c.hmap[lx << 4 | lz];
        const surf = c.b[idxOf(lx, y, lz)];
        if (surf === B.WHEAT || (y >= Y0 && c.b[idxOf(lx, Math.min(y + 1, YMAX), lz)] === B.WHEAT)) { /* handled below */ }
        // pick the actual random y near surface for farm blocks
        const checkY = surf === B.WHEAT ? y : y + 1;
        const id = this.getBlock(wx, checkY, wz);
        if (id === B.WHEAT) {
          const below = this.getBlock(wx, checkY - 1, wz);
          const m = this.getMeta(wx, checkY, wz) || { crop: 0 };
          const hydrated = below === B.FARMLAND_WET || this.weather !== 'clear';
          if (m.crop < 7 && Math.random() < (hydrated ? 0.3 : 0.08)) {
            m.crop++; this.setMeta(wx, checkY, wz, m);
            c.dirty = true;
          }
        } else if (id === B.SAPLING) {
          if (Math.random() < 0.12) {
            this.setBlock(wx, checkY, wz, B.AIR);
            const rng = Math.random.bind(Math);
            this.gen.placeTree((ax, ay, az, bid) => {
              if (this.getBlock(ax, ay, az) === B.AIR || bid !== B.LEAF_OAK) this.setBlock(ax, ay, az, bid);
            }, wx, checkY, wz, 'oak', rng);
          }
        }
        const fy = checkY - 1;
        const fid = this.getBlock(wx, fy, wz);
        if (fid === B.FARMLAND || fid === B.FARMLAND_WET) {
          let wet = this.weather !== 'clear';
          for (let dx = -4; dx <= 4 && !wet; dx++) for (let dz = -4; dz <= 4; dz++)
            if (this.getBlock(wx + dx, fy, wz + dz) === B.WATER) { wet = true; break; }
          if (wet && fid === B.FARMLAND) this.setBlock(wx, fy, wz, B.FARMLAND_WET);
          else if (!wet && fid === B.FARMLAND_WET) this.setBlock(wx, fy, wz, B.FARMLAND);
          else if (!wet && fid === B.FARMLAND && this.getBlock(wx, fy + 1, wz) !== B.WHEAT && Math.random() < 0.3)
            this.setBlock(wx, fy, wz, B.DIRT);
        }
      }
    }
  }

  tickFurnaces() {
    for (const k of [...this.furnaces]) {
      const m = this.meta.get(k);
      if (!m || !m.furnace) { this.furnaces.delete(k); continue; }
      const f = m.furnace;
      const input = f.items[0], fuel = f.items[1], out = f.items[2];
      const rec = input ? SMELT[input.id] : null;
      const canOut = rec && (!out || (out.id === rec.id && out.n + rec.n <= maxStack(out.id)));
      if (f.burn > 0) f.burn--;
      if (f.burn <= 0 && rec && canOut && fuel && FUEL[fuel.id]) {
        f.burnMax = f.burn = Math.round(FUEL[fuel.id] * 200);
        fuel.n--; if (fuel.n <= 0) f.items[1] = null;
      }
      if (f.burn > 0 && rec && canOut) {
        f.cook = (f.cook || 0) + 1;
        if (f.cook >= 200) { // 10 seconds per item
          f.cook = 0;
          input.n--; if (input.n <= 0) f.items[0] = null;
          if (out) out.n += rec.n; else f.items[2] = { id: rec.id, n: rec.n };
          f.xpBank = (f.xpBank || 0) + (rec.xp || 0);
        }
      } else f.cook = 0;
    }
  }

  // ---------- explosions ----------
  explode(x, y, z, power) {
    const r = Math.ceil(power);
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > power) continue;
      const bx = Math.round(x + dx), by = Math.round(y + dy), bz = Math.round(z + dz);
      const id = this.getBlock(bx, by, bz);
      if (id === B.AIR || id === B.WATER || id === B.LAVA) continue;
      const info = blockInfo[id];
      if (info.hard < 0 || info.hard > 10) continue;
      if (Math.random() < 0.3 && this.dropItem && info.drop) {
        for (const dr of info.drop(Math.random.bind(Math))) this.dropItem(bx + 0.5, by + 0.5, bz + 0.5, dr);
      }
      this.setBlock(bx, by, bz, B.AIR, { force: true });
    }
    const hurt = e => {
      const d = Math.hypot(e.pos.x - x, e.pos.y - y, e.pos.z - z);
      if (d < power * 2) {
        const dmg = Math.round((1 - d / (power * 2)) * power * 7);
        const kx = (e.pos.x - x) / (d + 0.01), kz = (e.pos.z - z) / (d + 0.01);
        e.hurt(dmg, { x: kx * 1.2, y: 0.6, z: kz * 1.2 });
      }
    };
    for (const e of this.entities) if (e.hurt) hurt(e);
    if (this.player) hurt(this.player);
  }

  // ---------- raycast (Amanatides & Woo DDA) ----------
  raycast(ox, oy, oz, dx, dy, dz, maxD, fluids = false) {
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const stepX = Math.sign(dx) || 1, stepY = Math.sign(dy) || 1, stepZ = Math.sign(dz) || 1;
    const tdx = Math.abs(1 / (dx || 1e-9)), tdy = Math.abs(1 / (dy || 1e-9)), tdz = Math.abs(1 / (dz || 1e-9));
    let tx = (stepX > 0 ? x + 1 - ox : ox - x) * tdx;
    let ty = (stepY > 0 ? y + 1 - oy : oy - y) * tdy;
    let tz = (stepZ > 0 ? z + 1 - oz : oz - z) * tdz;
    let face = [0, 0, 0], t = 0;
    for (let i = 0; i < 256; i++) {
      const id = this.getBlock(x, y, z);
      if (fluids && (id === B.WATER || id === B.LAVA) && this.isSource(x, y, z))
        return { x, y, z, id, face, dist: t };
      if (!fluids && id !== B.AIR && id !== B.WATER && id !== B.LAVA)
        return { x, y, z, id, face, dist: t };
      if (tx < ty && tx < tz) { x += stepX; t = tx; tx += tdx; face = [-stepX, 0, 0]; }
      else if (ty < tz) { y += stepY; t = ty; ty += tdy; face = [0, -stepY, 0]; }
      else { z += stepZ; t = tz; tz += tdz; face = [0, 0, -stepZ]; }
      if (t > maxD) return null;
    }
    return null;
  }

  // ---------- chunk lifecycle ----------
  update(px, pz, budget = 2) {
    const pcx = Math.floor(px / 16), pcz = Math.floor(pz / 16);
    const R = this.viewR;
    const want = [];
    for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++)
      want.push([pcx + a, pcz + b, a * a + b * b]);
    want.sort((p, q) => p[2] - q[2]);
    let gens = 0, meshes = 0;
    for (const [cx, cz] of want) {
      let c = this.chunks.get(cKey(cx, cz));
      if (!c) { c = new Chunk(cx, cz); this.chunks.set(cKey(cx, cz), c); }
      if (!c.generated && gens < budget) {
        this.gen.generate(c, this);
        this.applyEditsToChunk(c);
        c.generated = true;
        this.postGenScan(c);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          const n = this.chunks.get(cKey(cx + a, cz + b));
          if (n && n.generated) { n.dirty = true; }
        }
        gens++;
      }
    }
    // relight first, in its own budgeted pass, decoupled from mesh readiness
    // below — a chunk's own light BFS doesn't need its neighbors to have
    // meshed, only to relight the ones it can currently see. Gating this on
    // "ready" too would deadlock two adjacent brand-new chunks that each
    // wait on the other to be lit first.
    let lights = 0;
    for (const [cx, cz] of want) {
      const c = this.chunks.get(cKey(cx, cz));
      if (!c || !c.generated) continue;
      if (c.lightDirty && lights < budget) { this.relight(c); c.lightDirty = false; lights++; }
    }
    for (const [cx, cz] of want) {
      const c = this.chunks.get(cKey(cx, cz));
      if (!c || !c.generated) continue;
      // don't mesh until cardinal neighbors that will generate soon exist AND
      // have completed at least one relight pass — otherwise this chunk's
      // boundary faces sample a neighbor's still zero-initialized light
      // arrays and render solid black until something else happens to mark
      // this chunk dirty again for a re-mesh.
      let ready = true;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = this.chunks.get(cKey(cx + dx, cz + dz));
        if ((!n || !n.generated || !n.everLit) &&
            Math.max(Math.abs(cx + dx - pcx), Math.abs(cz + dz - pcz)) <= R) { ready = false; break; }
      }
      if (!ready) continue;
      if (c.dirty && meshes < budget) {
        this.buildMesh(c);
        c.dirty = false;
        meshes++;
      }
      if (c.mesh && !c.inScene) {
        this.scene.add(c.mesh); if (c.wmesh) this.scene.add(c.wmesh);
        c.inScene = true;
      }
    }
    // unload far chunks (freeze: keep data, drop meshes)
    for (const c of this.chunks.values()) {
      const d = Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz));
      if (d > R + 2 && c.inScene) {
        this.scene.remove(c.mesh); c.mesh.geometry.dispose(); c.mesh = null;
        if (c.wmesh) { this.scene.remove(c.wmesh); c.wmesh.geometry.dispose(); c.wmesh = null; }
        c.inScene = false; c.dirty = true;
      }
    }
    return this.pendingWork(pcx, pcz);
  }

  pendingWork(pcx, pcz) {
    let n = 0;
    const R = this.viewR;
    for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) {
      const c = this.chunks.get(cKey(pcx + a, pcz + b));
      if (!c || !c.generated || c.dirty || c.lightDirty) n++;
    }
    return n;
  }

  // ---------- save / load ----------
  recordEdit(x, y, z, id) {
    const cx = x >> 4, cz = z >> 4;
    const key = cKey(cx, cz);
    let m = this.editsByChunk.get(key);
    if (!m) { m = new Map(); this.editsByChunk.set(key, m); }
    m.set(keyOf(x, y, z), id);
  }
  applyEditsToChunk(c) {
    const m = this.editsByChunk.get(cKey(c.cx, c.cz));
    if (!m) return;
    for (const [k, id] of m) {
      const parts = k.split(',');
      const x = +parts[0], y = +parts[1], z = +parts[2];
      c.b[idxOf(x & 15, y, z & 15)] = id;
    }
  }

  // returns a plain JSON-safe object describing everything needed to
  // reconstruct this world (procedural regen + these overrides)
  serialize() {
    const edits = [];
    for (const m of this.editsByChunk.values())
      for (const [k, id] of m) {
        const parts = k.split(',');
        edits.push(+parts[0], +parts[1], +parts[2], id);
      }
    const meta = [];
    for (const [k, v] of this.meta) meta.push([k, v]);
    return {
      seedStr: this.seedStr, viewR: this.viewR,
      time: this.time, weather: this.weather, weatherTimer: this.weatherTimer,
      edits, meta,
    };
  }
  // restores edits + meta BEFORE any chunks generate, so applyEditsToChunk()
  // and getMeta() naturally pick everything up as chunks stream in
  loadSaved(data) {
    this.time = data.time ?? this.time;
    this.weather = data.weather ?? 'clear';
    this.weatherTimer = data.weatherTimer ?? this.weatherTimer;
    const edits = data.edits ?? [];
    for (let i = 0; i < edits.length; i += 4) this.recordEdit(edits[i], edits[i + 1], edits[i + 2], edits[i + 3]);
    for (const [k, v] of (data.meta ?? [])) this.meta.set(k, v);
    for (const [k, v] of this.meta) if (v?.furnace) this.furnaces.add(k);
  }

  postGenScan(c) {
    // heightmap + light sources in one pass
    for (let lx = 0; lx < 16; lx++) for (let lz = 0; lz < 16; lz++) {
      let top = Y0;
      for (let y = YMAX; y >= Y0; y--) {
        const id = c.b[idxOf(lx, y, lz)];
        if (id !== B.AIR) { top = y; break; }
      }
      c.hmap[lx << 4 | lz] = top;
      for (let y = Y0; y <= top; y++) {
        const i = idxOf(lx, y, lz);
        if (blockInfo[c.b[i]]?.light) c.lights.add(i);
      }
    }
  }

  // ---------- lighting ----------
  relight(c) {
    // sky: vertical seed pass — opaque blocks cut light, leaves/water attenuate it.
    // this alone only lights columns with a clear shot straight up, so a sideways
    // tunnel dug off a lit shaft would stay pitch black even though light is
    // right next door. the BFS pass below fixes that by spreading sky light
    // sideways (and back upward around corners) through any non-opaque block.
    for (let lx = 0; lx < 16; lx++) for (let lz = 0; lz < 16; lz++) {
      let light = 15;
      const base = (lx << 4 | lz) * WH;
      for (let y = YMAX; y >= Y0; y--) {
        const i = base + (y - Y0);
        const id = c.b[i];
        if (id !== B.AIR && light > 0) {
          const info = blockInfo[id];
          if (info.opaque) light = 0;
          else if (id === B.WATER || id === B.ICE || info.kind === 'leaves') light = Math.max(0, light - 2);
        }
        c.sky[i] = light;
      }
    }

    const x0 = c.cx * 16, z0 = c.cz * 16;
    const nbrs = [];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++)
      nbrs[(a + 1) * 3 + (b + 1)] = this.chunks.get(cKey(c.cx + a, c.cz + b));
    const getRaw = (x, y, z) => {
      if (y < Y0 || y > YMAX) return -1;
      const dcx = (x >> 4) - c.cx, dcz = (z >> 4) - c.cz;
      if (dcx < -1 || dcx > 1 || dcz < -1 || dcz > 1) return -1;
      const n = nbrs[(dcx + 1) * 3 + (dcz + 1)];
      if (!n || !n.generated) return -1;
      return n.b[(((x & 15) << 4 | (z & 15)) * WH) + (y - Y0)];
    };

    // sky-light horizontal propagation: seed from every cell that's already lit
    // (underground only — open air above the heightmap is already correct and
    // seeding it too would flood the BFS with tens of thousands of no-op nodes),
    // plus a one-block-thick read-only border sampled from the 4 direct
    // neighbors' own sky arrays, then flood-fill through non-opaque blocks.
    {
      const seen = new Map();
      const queue = [];
      const baseline = (x, y, z) => {
        if (x >= x0 && x < x0 + 16 && z >= z0 && z < z0 + 16) return c.sky[(((x - x0) << 4 | (z - z0)) * WH) + (y - Y0)];
        const dcx = (x >> 4) - c.cx, dcz = (z >> 4) - c.cz;
        if (dcx < -1 || dcx > 1 || dcz < -1 || dcz > 1) return 15;
        const n = nbrs[(dcx + 1) * 3 + (dcz + 1)];
        if (!n || !n.generated) return 0;
        return n.sky[(((x & 15) << 4 | (z & 15)) * WH) + (y - Y0)];
      };
      // seed: enqueue every already-lit frontier cell unconditionally (no baseline
      // check here — a seed's baseline trivially equals itself, so that check would
      // reject every single seed and the BFS would never start)
      const seed = (x, y, z, lvl) => {
        if (lvl <= 0) return;
        const nk = numKey(x, y, z);
        if ((seen.get(nk) || 0) >= lvl) return;
        seen.set(nk, lvl);
        queue.push([x, y, z, lvl]);
      };
      for (let lx = 0; lx < 16; lx++) for (let lz = 0; lz < 16; lz++) {
        const base = (lx << 4 | lz) * WH;
        const top = c.hmap[lx << 4 | lz];
        for (let y = Y0; y <= Math.min(top + 1, YMAX); y++) {
          const v = c.sky[base + (y - Y0)];
          if (v > 0) seed(x0 + lx, y, z0 + lz, v);
        }
      }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = nbrs[(dx + 1) * 3 + (dz + 1)];
        if (!n || !n.generated) continue;
        const edgeLx = dx === 1 ? 0 : dx === -1 ? 15 : null;
        const edgeLz = dz === 1 ? 0 : dz === -1 ? 15 : null;
        if (edgeLx !== null) {
          for (let lz = 0; lz < 16; lz++) {
            const top = n.hmap[edgeLx << 4 | lz];
            for (let y = Y0; y <= Math.min(top + 1, YMAX); y++) {
              const v = n.sky[((edgeLx << 4 | lz) * WH) + (y - Y0)];
              if (v > 0) seed(n.cx * 16 + edgeLx, y, n.cz * 16 + lz, v);
            }
          }
        } else {
          for (let lx = 0; lx < 16; lx++) {
            const top = n.hmap[lx << 4 | edgeLz];
            for (let y = Y0; y <= Math.min(top + 1, YMAX); y++) {
              const v = n.sky[((lx << 4 | edgeLz) * WH) + (y - Y0)];
              if (v > 0) seed(n.cx * 16 + lx, y, n.cz * 16 + edgeLz, v);
            }
          }
        }
      }
      // expand: propagate to neighbors, pruned by baseline so we stop the instant
      // we reach a cell that's already at least this lit (e.g. open sky)
      let head = 0;
      while (head < queue.length) {
        const [x, y, z, lvl] = queue[head++];
        if (x >= x0 && x < x0 + 16 && z >= z0 && z < z0 + 16) {
          const i = (((x - x0) << 4 | (z - z0)) * WH) + (y - Y0);
          if (lvl > c.sky[i]) c.sky[i] = lvl;
        }
        if (lvl <= 1) continue;
        for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
          const nx = x + dx, ny = y + dy, nz = z + dz;
          if (nx < x0 - 16 || nx > x0 + 31 || nz < z0 - 16 || nz > z0 + 31) continue;
          const id = getRaw(nx, ny, nz);
          if (id < 0 || blockInfo[id].opaque) continue;
          const nlvl = lvl - 1;
          if (nlvl <= baseline(nx, ny, nz)) continue;
          const nk = numKey(nx, ny, nz);
          if ((seen.get(nk) || 0) >= nlvl) continue;
          seen.set(nk, nlvl);
          queue.push([nx, ny, nz, nlvl]);
        }
      }
    }

    // block light BFS from torches/lava in this + neighbor chunks
    c.bl.fill(0);
    const queue = [];
    let lavaCount = 0;
    for (const n of nbrs) {
      if (!n || !n.generated) continue;
      for (const i of n.lights) {
        const lx = (i / WH | 0) >> 4, lz = (i / WH | 0) & 15, y = (i % WH) + Y0;
        const wx = n.cx * 16 + lx, wz = n.cz * 16 + lz;
        if (wx < x0 - 14 || wx > x0 + 29 || wz < z0 - 14 || wz > z0 + 29) continue;
        const id = n.b[i];
        const lvl = blockInfo[id].light;
        if (id === B.LAVA) {
          if (lavaCount > 120) continue;
          // only surface lava (with a transparent neighbor) emits, and sample sparsely
          if (((wx ^ wz) & 1) !== 0) continue;
          let open = false;
          for (const [dx, dy, dz] of [[0,1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]]) {
            const nb = getRaw(wx + dx, y + dy, wz + dz);
            if (nb === B.AIR || (nb > 0 && !blockInfo[nb].opaque && nb !== B.LAVA && nb !== B.WATER)) { open = true; break; }
          }
          if (!open) continue;
          lavaCount++;
        }
        queue.push([wx, y, wz, lvl]);
      }
    }
    if (queue.length) {
      const seen = new Map();
      for (const q of queue) seen.set(numKey(q[0], q[1], q[2]), q[3]);
      let head = 0;
      while (head < queue.length) {
        const [x, y, z, lvl] = queue[head++];
        if (x >= x0 && x < x0 + 16 && z >= z0 && z < z0 + 16 && y >= Y0 && y <= YMAX) {
          const i = idxOf(x & 15, y, z & 15);
          if (lvl > c.bl[i]) c.bl[i] = lvl;
        }
        if (lvl <= 1) continue;
        // keep BFS inside the 3x3 neighborhood
        for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
          const nx = x + dx, ny = y + dy, nz = z + dz;
          if (nx < x0 - 15 || nx > x0 + 30 || nz < z0 - 15 || nz > z0 + 30) continue;
          const id = getRaw(nx, ny, nz);
          if (id < 0 || blockInfo[id].opaque) continue;
          const nk2 = numKey(nx, ny, nz);
          if ((seen.get(nk2) || 0) >= lvl - 1) continue;
          seen.set(nk2, lvl - 1);
          queue.push([nx, ny, nz, lvl - 1]);
        }
      }
    }
    c.everLit = true;
  }

  // ---------- meshing ----------
  buildMesh(c) {
    const sp = [], su = [], ss = [], sb2 = [], si = [];   // solid
    const wp = [], wu = [], ws = [], wb = [], wi = [];    // water
    const x0 = c.cx * 16, z0 = c.cz * 16;

    // cached neighbor-chunk access (hot path)
    const nbrs = [];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++)
      nbrs[(a + 1) * 3 + (b + 1)] = this.chunks.get(cKey(c.cx + a, c.cz + b));
    const chunkFor = (x, z) => {
      const dcx = (x >> 4) - c.cx, dcz = (z >> 4) - c.cz;
      if (dcx < -1 || dcx > 1 || dcz < -1 || dcz > 1) return null;
      const n = nbrs[(dcx + 1) * 3 + (dcz + 1)];
      return (n && n.generated) ? n : null;
    };
    const getRaw = (x, y, z) => {
      if (y < Y0) return B.BEDROCK;
      if (y > YMAX) return B.AIR;
      const n = chunkFor(x, z);
      if (!n) return -1;
      return n.b[(((x & 15) << 4 | (z & 15)) * WH) + (y - Y0)];
    };
    const L15 = { s: 15, b: 0 }, L0 = { s: 0, b: 0 };
    const lightOf = (x, y, z) => {
      if (y > YMAX) return L15;
      if (y < Y0) return L0;
      const n = chunkFor(x, z);
      if (!n) return L15;
      const i = (((x & 15) << 4 | (z & 15)) * WH) + (y - Y0);
      return { s: n.sky[i], b: n.bl[i] };
    };
    const quad = (arrs, verts, uvs, s, b) => {
      const [P, U, S, BL, IX] = arrs;
      const base = P.length / 3;
      for (let i = 0; i < 4; i++) {
        P.push(verts[i][0], verts[i][1], verts[i][2]);
        U.push(uvs[i][0], uvs[i][1]);
        S.push(s); BL.push(b);
      }
      IX.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    const solidArrs = [sp, su, ss, sb2, si], waterArrs = [wp, wu, ws, wb, wi];

    const emitFace = (arrs, lx, y, lz, f, tile, s, b, ylo = 0, yhi = 1, inset = 0) => {
      const [u0, v0, u1, v1] = tileUV(tile);
      const verts = [], uvs = [];
      for (const cn of f.c) {
        let vx = cn[0], vy = cn[1], vz = cn[2];
        if (inset) {
          vx = vx === 0 ? inset : 1 - inset;
          vz = vz === 0 ? inset : 1 - inset;
        }
        vy = vy === 0 ? ylo : yhi;
        verts.push([lx + vx, y + vy, lz + vz]);
        const m = f.uvm([vx, vy, vz]);
        uvs.push([u0 + m[0] * (u1 - u0), v0 + m[1] * (v1 - v0)]);
      }
      quad(arrs, verts, uvs, s, b);
    };
    const emitBox = (lx, y, lz, min, max, tile, s, b) => {
      const [u0, v0, u1, v1] = tileUV(tile);
      for (const f of FACES) {
        const verts = [], uvs = [];
        for (const cn of f.c) {
          const vx = cn[0] ? max[0] : min[0], vy = cn[1] ? max[1] : min[1], vz = cn[2] ? max[2] : min[2];
          verts.push([lx + vx, y + vy, lz + vz]);
          const m = f.uvm([vx, vy, vz]);
          uvs.push([u0 + m[0] * (u1 - u0), v0 + m[1] * (v1 - v0)]);
        }
        quad(solidArrs, verts, uvs, s * f.shade, b * f.shade);
      }
    };
    const emitCross = (lx, y, lz, tile, s, b) => {
      const [u0, v0, u1, v1] = tileUV(tile);
      for (const [ax, az, bx, bz] of [[0.1, 0.1, 0.9, 0.9], [0.1, 0.9, 0.9, 0.1]]) {
        quad(solidArrs,
          [[lx + ax, y, lz + az], [lx + bx, y, lz + bz], [lx + bx, y + 1, lz + bz], [lx + ax, y + 1, lz + az]],
          [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], s, b);
      }
    };

    for (let lx = 0; lx < 16; lx++) for (let lz = 0; lz < 16; lz++) {
      const wx = x0 + lx, wz = z0 + lz;
      const top = c.hmap[lx << 4 | lz];
      for (let y = Y0; y <= Math.min(top + 1, YMAX); y++) {
        const id = c.b[idxOf(lx, y, lz)];
        if (id === B.AIR) continue;
        const info = blockInfo[id];
        const selfL = lightOf(wx, y, wz);
        if (info.kind === 'cross') { emitCross(lx, y, lz, info.tiles.top, selfL.s, selfL.b); continue; }
        if (info.kind === 'crop') {
          const g = this.getMeta(wx, y, wz)?.crop ?? 0;
          emitCross(lx, y, lz, CROP_TILES[Math.min(7, g)], selfL.s, selfL.b); continue;
        }
        if (info.kind === 'torch') { emitBox(lx, y, lz, [0.4375, 0, 0.4375], [0.5625, 0.65, 0.5625], info.tiles.top, selfL.s, 14); continue; }
        if (info.kind === 'bed') { emitBox(lx, y, lz, [0.02, 0, 0.02], [0.98, 0.56, 0.98], info.tiles.top, selfL.s, selfL.b); continue; }
        if (info.kind === 'door') {
          const open = id === B.DOOR_OPEN;
          const box = open ? [[0, 0, 0], [0.19, 1, 1]] : [[0, 0, 0], [1, 1, 0.19]];
          emitBox(lx, y, lz, box[0], box[1], info.tiles.top, selfL.s, selfL.b); continue;
        }
        if (id === B.WATER || id === B.LAVA) {
          const isW = id === B.WATER;
          const arrs = isW ? waterArrs : solidArrs;
          const above = getRaw(wx, y + 1, wz);
          const yhi = (above === id) ? 1 : 0.85;
          for (const f of FACES) {
            const nx = wx + f.d[0], ny = y + f.d[1], nz = wz + f.d[2];
            const nb = getRaw(nx, ny, nz);
            if (nb === id || nb < 0) continue;
            if (nb >= 0 && blockInfo[nb].opaque) continue;
            const L = lightOf(nx, ny, nz);
            const b2 = isW ? L.b : 15;
            emitFace(arrs, lx, y, lz, f, info.tiles.top, L.s * f.shade, b2 * f.shade, 0, yhi);
          }
          continue;
        }
        // regular cube
        for (const f of FACES) {
          const nx = wx + f.d[0], ny = y + f.d[1], nz = wz + f.d[2];
          const nb = getRaw(nx, ny, nz);
          if (nb < 0) continue;
          const nInfo = blockInfo[nb];
          if (nInfo.opaque) continue;
          if (info.kind === 'leaves' && nInfo.kind === 'leaves') continue;
          const tile = f.d[1] === 1 ? info.tiles.top : f.d[1] === -1 ? info.tiles.bot : info.tiles.side;
          const L = lightOf(nx, ny, nz);
          emitFace(solidArrs, lx, y, lz, f, tile, L.s * f.shade, L.b * f.shade);
        }
      }
      // below-top blocks fully buried are skipped by the y<=top+1 bound — but caves
      // exist below top; the loop above already covers y<=top, caves included.
    }

    const build = (arrs, mat) => {
      const [P, U, S, BL, IX] = arrs;
      if (P.length === 0) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
      g.setAttribute('skyl', new THREE.Float32BufferAttribute(S, 1));
      g.setAttribute('bll', new THREE.Float32BufferAttribute(BL, 1));
      g.setIndex(IX);
      const m = new THREE.Mesh(g, mat);
      m.position.set(x0, 0, z0);
      m.frustumCulled = true;
      return m;
    };
    if (c.mesh) { this.scene.remove(c.mesh); c.mesh.geometry.dispose(); }
    if (c.wmesh) { this.scene.remove(c.wmesh); c.wmesh.geometry.dispose(); }
    c.mesh = build(solidArrs, this.matSolid);
    c.wmesh = build(waterArrs, this.matWater);
    c.inScene = false;
    if (c.mesh) { this.scene.add(c.mesh); c.inScene = true; }
    if (c.wmesh) this.scene.add(c.wmesh);
    if (!c.mesh) c.inScene = true; // nothing to add
  }
}
