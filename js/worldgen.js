// 1.18-style world generation: noise terrain, biomes, caves, aquifers, ores, trees, villages.
import { Perlin, mulberry32, hash2, hashSeed } from './noise.js';
import { B, I } from './blocks.js';

export const SEA = 63, Y0 = -64, YMAX = 319, WH = 384, CS = 16;
export const BIOME = { OCEAN: 0, RIVER: 1, PLAINS: 2, FOREST: 3, BIRCH: 4, TAIGA: 5, DESERT: 6, MOUNTAIN: 7, PEAKS: 8, BEACH: 9 };
export const BIOME_NAMES = ['Ocean', 'River', 'Plains', 'Forest', 'Birch Forest', 'Taiga', 'Desert', 'Mountains', 'Snowy Peaks', 'Beach'];
const VILLAGE_REGION = 6; // chunks per village-region cell (one village attempt per region)
const JOB_SITES = ['farmer', 'fletcher', 'armorer', 'cleric', 'librarian'];
const JOB_BLOCK = { farmer: B.COMPOSTER, fletcher: B.FLETCHING_TABLE, armorer: B.BLAST_FURNACE, cleric: B.BREWING_STAND, librarian: B.LECTERN };

export class WorldGen {
  constructor(seedStr) {
    this.seed = hashSeed(String(seedStr));
    const s = this.seed;
    this.cont = new Perlin(s ^ 1); this.mnt = new Perlin(s ^ 2); this.mask = new Perlin(s ^ 3);
    this.riv = new Perlin(s ^ 4); this.tmp = new Perlin(s ^ 5); this.moi = new Perlin(s ^ 6);
    this.cave1 = new Perlin(s ^ 7); this.cave2 = new Perlin(s ^ 8); this.cave3 = new Perlin(s ^ 9);
    this.aq = new Perlin(s ^ 10); this.ds = new Perlin(s ^ 11);
    this.colCache = new Map();
    this.villageCache = new Map(); // region key -> village descriptor | null
  }

  colInfo(x, z) {
    const k = x + ',' + z;
    let c = this.colCache.get(k);
    if (c) return c;
    const cont = this.cont.fbm2(x * 0.0016, z * 0.0016, 4);
    let h = 66 + cont * 24;
    // ridged noise (1-|noise|) makes sharp mountain spines. The steepness comes
    // mostly from the FINE octaves (each doubling frequency adds detail on a
    // shorter wavelength), so a lower fbm gain — which weights those fine
    // octaves down — smooths short-distance jaggedness far more effectively
    // than just lowering the overall amplitude or exponent did.
    const ridgeRaw = 1 - Math.abs(this.mnt.fbm2(x * 0.0016, z * 0.0016, 4, 2, 0.35));
    const ridge = Math.pow(Math.max(0, ridgeRaw), 1.4);
    const mMask = Math.min(1, Math.max(0, this.mask.fbm2(x * 0.0011 + 100, z * 0.0011) - 0.05) * 1.5);
    const mh = ridge * 80 * mMask;
    h += mh;
    const rv = Math.abs(this.riv.fbm2(x * 0.0011 + 55, z * 0.0011 - 33, 3));
    let river = false;
    if (rv < 0.03) {
      // river strength used to cut off hard at mh===25 — right at that
      // boundary a column could go from "carved to ~63" to "full mountain
      // height" between two adjacent samples, a 30+ block cliff out of
      // nowhere. Fading it out smoothly as terrain gets hillier removes that
      // discontinuity entirely instead of just moving it around.
      const t = 1 - rv / 0.03;
      const riverStrength = Math.max(0, 1 - mh / 25);
      const pull = t * riverStrength;
      const carved = h - pull * (h - 59);
      if (carved < h) { h = carved; river = pull > 0.4 && h < SEA + 0.5; }
    }
    h = Math.round(Math.max(Y0 + 10, Math.min(YMAX - 12, h)));
    let temp = this.tmp.fbm2(x * 0.0009 + 7, z * 0.0009, 3) - Math.max(0, h - 90) * 0.004;
    const moist = this.moi.fbm2(x * 0.0011 - 40, z * 0.0011 + 21, 3);
    let biome;
    if (h < SEA - 3) biome = BIOME.OCEAN;
    else if (river) biome = BIOME.RIVER;
    else if (h >= 130 || (h > 105 && temp < -0.35)) biome = BIOME.PEAKS;
    else if (mh > 26) biome = BIOME.MOUNTAIN;
    else if (h <= SEA + 1) biome = BIOME.BEACH;
    else if (temp > 0.32 && moist < 0.05) biome = BIOME.DESERT;
    else if (moist > 0.22) biome = temp < -0.18 ? BIOME.TAIGA : BIOME.FOREST;
    else if (moist > 0.05 && temp > -0.1 && temp < 0.22) biome = BIOME.BIRCH;
    else biome = temp < -0.3 ? BIOME.TAIGA : BIOME.PLAINS;
    c = { h, biome, temp, mh };
    if (this.colCache.size > 60000) this.colCache.clear();
    this.colCache.set(k, c);
    return c;
  }

  carve(x, y, z) {
    if (y <= Y0 + 4) return 0;
    // cheese caves: big open caverns, more common deeper
    const bias = y < 0 ? 0.04 : 0;
    if (this.cave1.fbm3(x * 0.013, y * 0.026, z * 0.013, 2) > 0.42 - bias) return 1;
    // spaghetti tunnels
    const a = this.cave2.fbm3(x * 0.02, y * 0.032, z * 0.02, 2);
    const b = this.cave3.fbm3(x * 0.02 + 90, y * 0.032, z * 0.02 - 60, 2);
    if (Math.abs(a) < 0.055 && Math.abs(b) < 0.055) return 2;
    // noodle caves: thin claustrophobic variant
    const c = this.cave2.noise3(x * 0.055 + 300, y * 0.07, z * 0.055);
    const d = this.cave3.noise3(x * 0.055 - 300, y * 0.07, z * 0.055 + 200);
    if (Math.abs(c) < 0.045 && Math.abs(d) < 0.045) return 3;
    return 0;
  }

  generate(chunk, world) {
    const cx = chunk.cx, cz = chunk.cz;
    const rng = mulberry32(this.seed ^ (cx * 341873128 | 0) ^ (cz * 132897987 | 0));
    const sb = (lx, y, lz, id) => {
      if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || y < Y0 || y > YMAX) return;
      chunk.b[((lx << 4 | lz) * WH) + (y - Y0)] = id;
    };
    const gb = (lx, y, lz) => {
      if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || y < Y0 || y > YMAX) return B.STONE;
      return chunk.b[((lx << 4 | lz) * WH) + (y - Y0)];
    };
    const cols = [];
    for (let lx = 0; lx < 16; lx++) for (let lz = 0; lz < 16; lz++) {
      const wx = cx * 16 + lx, wz = cz * 16 + lz;
      const col = this.colInfo(wx, wz);
      cols[lx << 4 | lz] = col;
      const { h, biome, temp } = col;
      const snowy = biome === BIOME.PEAKS;
      for (let y = Y0; y <= Math.max(h, SEA); y++) {
        let id = B.AIR;
        if (y <= h) {
          if (y === Y0 || (y < Y0 + 4 && hash2(this.seed, wx * 91 + y, wz * 47) < 0.4)) id = B.BEDROCK;
          else {
            // stone -> deepslate transition between Y=0 and Y=-8
            if (y <= -8) id = B.DEEPSLATE;
            else if (y < 0) id = hash2(this.seed ^ 99, wx * 3 + y * 7, wz * 5) < (-y / 8) ? B.DEEPSLATE : B.STONE;
            else id = B.STONE;
            // surface layers
            const d = h - y;
            if (d < 4) {
              if (biome === BIOME.DESERT || biome === BIOME.BEACH) id = B.SAND;
              else if (biome === BIOME.OCEAN) id = d < 2 ? (hash2(this.seed ^ 7, wx, wz) < 0.5 ? B.GRAVEL : B.SAND) : id;
              else if (biome === BIOME.RIVER) id = d < 2 ? B.GRAVEL : B.DIRT;
              else if (snowy) id = d === 0 ? B.SNOW : id;
              else if (biome === BIOME.MOUNTAIN && h > 118) id = id; // bare stone
              else id = d === 0 ? B.GRASS : B.DIRT;
            }
            // caves
            if (id !== B.BEDROCK && d >= 1) {
              const cv = this.carve(wx, y, wz);
              if (cv) {
                if (y <= -54) id = B.LAVA;
                else if (y <= SEA - 10 && this.aq.fbm3(wx * 0.008, y * 0.012, wz * 0.008, 2) > 0.28) id = B.WATER;
                else id = B.AIR;
              }
            }
          }
        } else if (y <= SEA && (biome === BIOME.OCEAN || biome === BIOME.RIVER)) {
          id = (y === SEA && temp < -0.42) ? B.ICE : B.WATER;
        }
        if (id !== B.AIR) sb(lx, y, lz, id);
      }
    }

    // ---- ores (1.18 distribution) ----
    const tri = (min, max, peak) => {
      // triangular distribution sample
      const u = rng(), c = (peak - min) / (max - min);
      return Math.round(u < c ? min + Math.sqrt(u * (max - min) * (peak - min)) : max - Math.sqrt((1 - u) * (max - min) * (max - peak)));
    };
    const vein = (oreId, y, size) => {
      let x = (rng() * 16) | 0, z = (rng() * 16) | 0;
      for (let i = 0; i < size; i++) {
        const cur = gb(x, y, z);
        if (cur === B.STONE || cur === B.DEEPSLATE) sb(x, y, z, oreId);
        x += (rng() * 3 | 0) - 1; z += (rng() * 3 | 0) - 1; y += (rng() * 3 | 0) - 1;
        if (y < Y0 + 5 || y > YMAX) break;
      }
    };
    const maxH = Math.max(...cols.map(c => c.h));
    const isMountain = cols.some(c => c.biome === BIOME.MOUNTAIN || c.biome === BIOME.PEAKS);
    for (let i = 0; i < 14; i++) vein(B.ORE_COAL, tri(0, Math.min(320, maxH), 96), 8);
    for (let i = 0; i < 8; i++) vein(B.ORE_COPPER, tri(-16, Math.min(112, maxH), 48), 8);
    for (let i = 0; i < 9; i++) vein(B.ORE_IRON, tri(-64, 72, 16), 6);
    if (maxH > 130) for (let i = 0; i < 5; i++) vein(B.ORE_IRON, tri(128, Math.min(320, maxH), Math.min(232, maxH)), 6);
    for (let i = 0; i < 4; i++) vein(B.ORE_GOLD, tri(-64, 32, -16), 4);
    for (let i = 0; i < 3; i++) vein(B.ORE_LAPIS, tri(-64, 64, 0), 5);
    for (let i = 0; i < 6; i++) vein(B.ORE_REDSTONE, tri(-64, 15, -59), 6);
    for (let i = 0; i < 5; i++) vein(B.ORE_DIAMOND, tri(-64, 16, -59), 4);
    if (isMountain) for (let i = 0; i < 8; i++) vein(B.ORE_EMERALD, tri(-16, Math.min(320, maxH), Math.min(232, maxH)), 1);

    // ---- flora & trees ----
    const surfAt = (lx, lz) => cols[lx << 4 | lz].h;
    const treeSpots = [];
    const density = { [BIOME.FOREST]: 7, [BIOME.BIRCH]: 6, [BIOME.TAIGA]: 6, [BIOME.PLAINS]: 1, [BIOME.MOUNTAIN]: 2 };
    for (let attempt = 0; attempt < 10; attempt++) {
      const lx = 2 + (rng() * 12) | 0, lz = 2 + (rng() * 12) | 0;
      const col = cols[lx << 4 | lz];
      const need = density[col.biome] ?? 0;
      if (attempt >= need) continue;
      if (col.biome === BIOME.PLAINS && rng() > 0.4) continue;
      const y = surfAt(lx, lz);
      if (gb(lx, y, lz) !== B.GRASS && gb(lx, y, lz) !== B.DIRT) continue;
      let type = 'oak';
      if (col.biome === BIOME.TAIGA || col.biome === BIOME.MOUNTAIN) type = 'spruce';
      else if (col.biome === BIOME.BIRCH) type = 'birch';
      else if (col.biome === BIOME.FOREST && rng() < 0.18) type = 'dark';
      this.placeTree(sb, lx, y + 1, lz, type, rng);
      treeSpots.push(lx + ',' + lz);
    }
    // grass, flowers, desert flora
    for (let i = 0; i < 14; i++) {
      const lx = (rng() * 16) | 0, lz = (rng() * 16) | 0;
      const col = cols[lx << 4 | lz], y = surfAt(lx, lz);
      if (col.biome === BIOME.DESERT) {
        if (gb(lx, y, lz) !== B.SAND || gb(lx, y + 1, lz) !== B.AIR) continue;
        if (rng() < 0.35) { const ch = 1 + (rng() * 3 | 0); for (let j = 1; j <= ch; j++) sb(lx, y + j, lz, B.CACTUS); }
        else sb(lx, y + 1, lz, B.DEADBUSH);
      } else if ([BIOME.PLAINS, BIOME.FOREST, BIOME.BIRCH, BIOME.TAIGA].includes(col.biome)) {
        if (gb(lx, y, lz) !== B.GRASS || gb(lx, y + 1, lz) !== B.AIR) continue;
        sb(lx, y + 1, lz, rng() < 0.12 ? B.FLOWER : B.TALLGRASS);
      }
    }

    // ---- village (clustered, deterministic across chunk boundaries) ----
    const center = cols[8 << 4 | 8];
    const sbW = (wx, y, wz, id) => sb(wx - cx * 16, y, wz - cz * 16, id);
    const myRgx = Math.floor(cx / VILLAGE_REGION), myRgz = Math.floor(cz / VILLAGE_REGION);
    for (let drg = -1; drg <= 1; drg++) for (let drz = -1; drz <= 1; drz++) {
      const v = this.villageAt(myRgx + drg, myRgz + drz);
      if (!v) continue;
      // only bother if this village's footprint could plausibly reach this chunk
      if (Math.abs(v.wx - (cx * 16 + 8)) > 64 || Math.abs(v.wz - (cz * 16 + 8)) > 64) continue;
      this.placeVillageInChunk(chunk, world, v, sbW);
    }

    // ---- passive mob spawn spots ----
    if (rng() < 0.3 && [BIOME.PLAINS, BIOME.FOREST, BIOME.BIRCH, BIOME.TAIGA].includes(center.biome)) {
      const types = ['pig', 'cow', 'sheep', 'chicken'];
      const type = types[(rng() * 4) | 0], n = 2 + (rng() * 2 | 0);
      for (let i = 0; i < n; i++) {
        const lx = (rng() * 16) | 0, lz = (rng() * 16) | 0;
        world.spawnQueue.push({ type, x: cx * 16 + lx + 0.5, y: surfAt(lx, lz) + 1, z: cz * 16 + lz + 0.5 });
      }
    }
  }

  placeTree(sb, x, y, z, type, rng) {
    const set = (dx, dy, dz, id) => sb(x + dx, y + dy, z + dz, id);
    if (type === 'spruce') {
      const th = 6 + (rng() * 3 | 0);
      for (let i = 0; i < th; i++) set(0, i, 0, B.LOG_SPRUCE);
      for (let dy = 2; dy <= th; dy += 1) {
        const r = dy === th ? 0 : Math.max(1, 2 - ((dy - 2) % 3));
        for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
          if (dx === 0 && dz === 0 && dy < th) continue;
          if (Math.abs(dx) === r && Math.abs(dz) === r && r > 1) continue;
          set(dx, dy, dz, B.LEAF_SPRUCE);
        }
      }
      set(0, th, 0, B.LEAF_SPRUCE);
      return;
    }
    const [log, leaf, th] =
      type === 'birch' ? [B.LOG_BIRCH, B.LEAF_BIRCH, 5 + (rng() * 3 | 0)] :
      type === 'dark' ? [B.LOG_DARK, B.LEAF_DARK, 5 + (rng() * 2 | 0)] :
      [B.LOG_OAK, B.LEAF_OAK, 4 + (rng() * 3 | 0)];
    const rad = type === 'dark' ? 3 : 2;
    for (let i = 0; i < th; i++) set(0, i, 0, log);
    for (let dy = th - 2; dy <= th + 1; dy++) {
      const r = dy > th - 1 ? 1 : rad;
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (dx === 0 && dz === 0 && dy < th) continue;
        if (Math.abs(dx) === r && Math.abs(dz) === r && rng() < 0.6) continue;
        set(dx, dy, dz, leaf);
      }
    }
  }

  // ---------- villages: clustered layout, deterministic per region ----------
  // Returns a village descriptor for the 1-in-~2.5 regions that roll one, or null.
  // Cached so every chunk that overlaps a village reuses the same layout instead
  // of re-rolling it (buildings must line up identically regardless of which
  // chunk happens to be generating).
  villageAt(rgx, rgz) {
    const key = rgx + ',' + rgz;
    if (this.villageCache.has(key)) return this.villageCache.get(key);
    const vrng = mulberry32(this.seed ^ (rgx * 668265263 | 0) ^ (rgz * 374761393 | 0) ^ 0x5111);
    let result = null;
    if (vrng() < 0.4) {
      const vcx = rgx * VILLAGE_REGION + 2 + ((vrng() * (VILLAGE_REGION - 4)) | 0);
      const vcz = rgz * VILLAGE_REGION + 2 + ((vrng() * (VILLAGE_REGION - 4)) | 0);
      const wx = vcx * 16 + 8, wz = vcz * 16 + 8;
      const col = this.colInfo(wx, wz);
      if ((col.biome === BIOME.PLAINS || col.biome === BIOME.DESERT) && col.h > SEA + 2) {
        const offs = [[-24, -24], [24, -24], [-24, 24], [24, 24], [0, -24], [0, 24], [-24, 0], [24, 0]];
        const samples = offs.map(([dx, dz]) => this.colInfo(wx + dx, wz + dz).h);
        samples.push(col.h);
        if (Math.max(...samples) - Math.min(...samples) <= 7) result = this.buildVillageLayout(wx, wz, col.h, vrng);
      }
    }
    this.villageCache.set(key, result);
    if (this.villageCache.size > 4000) this.villageCache.clear();
    return result;
  }

  // Places the well, 4+ distinct building blueprints (guaranteeing at least one
  // garden/profession/house/hut), hay bales, and villager/golem spawn points —
  // all as offsets from a shared center, so the whole cluster stays tight
  // (12-28 blocks out) instead of scattering across the map.
  buildVillageLayout(wx, wz, groundY, vrng) {
    const buildings = [];
    const occupied = [];
    const overlaps = (a, b) => !(a[2] < b[0] - 2 || a[0] > b[2] + 2 || a[3] < b[1] - 2 || a[1] > b[3] + 2);
    const tryPlace = (type) => {
      const size = type === 'hut' ? [5, 5] : type === 'house' ? [7, 6] : type === 'garden' ? [9, 9] : [5, 5];
      for (let i = 0; i < 10; i++) {
        const ang = vrng() * Math.PI * 2;
        const rad = 12 + vrng() * 16;
        const bx = Math.round(wx + Math.cos(ang) * rad);
        const bz = Math.round(wz + Math.sin(ang) * rad);
        const x0 = bx - (size[0] >> 1), z0 = bz - (size[1] >> 1);
        const foot = [x0, z0, x0 + size[0] - 1, z0 + size[1] - 1];
        if (occupied.some(o => overlaps(o, foot))) continue;
        const h1 = this.colInfo(x0, z0).h, h2 = this.colInfo(x0 + size[0], z0 + size[1]).h;
        if (Math.abs(h1 - groundY) > 4 || Math.abs(h2 - groundY) > 4) continue;
        occupied.push(foot);
        const job = type === 'profession' ? JOB_SITES[(vrng() * JOB_SITES.length) | 0] : null;
        const b = { type, x0, z0, w: size[0], d: size[1], job, door: { x: x0 + (size[0] >> 1), z: z0 - 1 } };
        buildings.push(b);
        return b;
      }
      return null;
    };
    tryPlace('garden'); tryPlace('profession'); tryPlace('house'); tryPlace('hut'); tryPlace('hut');
    if (vrng() < 0.5) tryPlace('house');
    if (vrng() < 0.6) tryPlace('hut');

    const hayAnchor = buildings[buildings.length - 1] ?? { x0: wx - 1, z0: wz - 1 };
    const hay = { x: hayAnchor.x0 - 2, z: hayAnchor.z0 + 1 };

    let beds = 0;
    const villagerSpawns = [];
    for (const b of buildings) {
      if (b.type === 'hut' || b.type === 'house') {
        beds++;
        const bedSpot = { x: b.x0 + 1, z: b.z0 + b.d - 2, door: { x: b.door.x, z: b.door.z } };
        const n = b.type === 'house' ? 2 : 1;
        for (let i = 0; i < n; i++) villagerSpawns.push({ x: b.x0 + 1 + i, z: b.door.z + 1, profession: null, bed: bedSpot });
      } else if (b.type === 'profession') {
        villagerSpawns.push({ x: b.door.x, z: b.door.z + 1, profession: b.job, bed: null });
      }
    }
    return { wx, wz, groundY, buildings, beds, villagerSpawns, hay, spawned: false };
  }

  placeVillageInChunk(chunk, world, v, sbW) {
    this.placeWell(sbW, v.wx, v.wz, v.groundY);
    for (const b of v.buildings) {
      if (b.type === 'hut') this.buildHutBP(sbW, world, b, v.groundY);
      else if (b.type === 'house') this.buildHouseBP(sbW, world, b, v.groundY);
      else if (b.type === 'garden') this.buildGardenBP(sbW, world, b, v.groundY);
      else if (b.type === 'profession') this.buildProfessionBP(sbW, world, b, v.groundY);
      this.drawPath(sbW, b.door.x, b.door.z, v.wx, v.wz);
    }
    this.placeHay(sbW, v.hay.x, v.hay.z, this.colInfo(v.hay.x, v.hay.z).h);
    if (!v.spawned) {
      v.spawned = true;
      for (const vs of v.villagerSpawns) {
        const h = this.colInfo(vs.x, vs.z).h;
        world.spawnQueue.push({ type: 'villager', x: vs.x + 0.5, y: h + 1, z: vs.z + 0.5, profession: vs.profession, bed: vs.bed, village: v });
      }
      if (v.beds >= 3 && v.villagerSpawns.length >= 3) {
        world.spawnQueue.push({ type: 'iron_golem', x: v.wx + 2.5, y: v.groundY + 1, z: v.wz + 0.5, village: v });
        if (Math.random() < 0.3) world.spawnQueue.push({ type: 'iron_golem', x: v.wx - 2.5, y: v.groundY + 1, z: v.wz - 0.5, village: v });
      }
    }
  }

  placeWell(sbW, wx, wz, groundY) {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const x = wx + dx, z = wz + dz;
      if (dx === 0 && dz === 0) { sbW(x, groundY - 1, z, B.WATER); sbW(x, groundY, z, B.AIR); }
      else { sbW(x, groundY, z, B.COBBLE); sbW(x, groundY + 1, z, B.COBBLE); }
    }
  }

  placeHay(sbW, x, z, groundY) {
    sbW(x, groundY + 1, z, B.HAY); sbW(x, groundY + 2, z, B.HAY);
    sbW(x + 1, groundY + 1, z, B.HAY);
  }

  // straight-line dirt path from a building's door to the village well,
  // leaving the well's own 3x3 footprint alone
  drawPath(sbW, x1, z1, x2, z2) {
    const dx = x2 - x1, dz = z2 - z1;
    const steps = Math.max(Math.abs(dx), Math.abs(dz));
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps;
      const x = Math.round(x1 + dx * t), z = Math.round(z1 + dz * t);
      if (Math.hypot(x - x2, z - z2) < 2.5) continue;
      sbW(x, this.colInfo(x, z).h, z, B.PATH);
    }
  }

  buildFoundationAndShell(sbW, b, groundY, wallTopDy) {
    const { x0, z0, w, d } = b, y = groundY;
    for (let dx = 0; dx < w; dx++) for (let dz = 0; dz < d; dz++) {
      const x = x0 + dx, z = z0 + dz;
      sbW(x, y - 1, z, B.DIRT); sbW(x, y - 2, z, B.DIRT);
      sbW(x, y, z, B.COBBLE);
      const edge = dx === 0 || dz === 0 || dx === w - 1 || dz === d - 1;
      const corner = (dx === 0 || dx === w - 1) && (dz === 0 || dz === d - 1);
      for (let dy = 1; dy <= wallTopDy; dy++) sbW(x, y + dy, z, edge ? (corner ? B.LOG_OAK : B.PLANKS) : B.AIR);
      for (let dy = wallTopDy + 2; dy <= wallTopDy + 4; dy++) sbW(x, y + dy, z, B.AIR);
    }
  }

  // a single 1-wide door is too tight for an entity hitbox plus imprecise
  // steering (no real pathfinding here), so every entrance gets a second,
  // real door leaf right next to the main one (a proper double door) rather
  // than a bare hole punched in the wall. It starts open so villagers/golems
  // can walk straight through, but it's still a normal openable/closable
  // door block — if the player swings it shut, mobs can get briefly stuck
  // there same as they can at any closed door, since there's no pathfinding.
  widenDoorway(sbW, world, doorX, doorZ, y) {
    const wx = doorX + 1;
    sbW(wx, y + 1, doorZ, B.DOOR_OPEN); sbW(wx, y + 2, doorZ, B.DOOR_OPEN);
    world.meta.set(world.keyOf(wx, y + 1, doorZ), { door: { top: false } });
    world.meta.set(world.keyOf(wx, y + 2, doorZ), { door: { top: true } });
  }

  // 5x5, single door, one bed — the smallest village dwelling
  buildHutBP(sbW, world, b, groundY) {
    const { x0, z0, w, d } = b, y = groundY;
    this.buildFoundationAndShell(sbW, b, groundY, 2);
    for (let dx = 0; dx < w; dx++) for (let dz = 0; dz < d; dz++) sbW(x0 + dx, y + 3, z0 + dz, B.PLANKS);
    const doorX = b.door.x, doorZ = z0;
    sbW(doorX, y + 1, doorZ, B.DOOR); sbW(doorX, y + 2, doorZ, B.DOOR);
    world.meta.set(world.keyOf(doorX, y + 1, doorZ), { door: { top: false } });
    world.meta.set(world.keyOf(doorX, y + 2, doorZ), { door: { top: true } });
    this.widenDoorway(sbW, world, doorX, doorZ, y);
    sbW(x0 + 1, y + 1, z0 + d - 2, B.BED); sbW(x0 + 1, y + 1, z0 + d - 3, B.BED);
    world.meta.set(world.keyOf(x0 + 1, y + 1, z0 + d - 2), { bed: { head: false } });
    world.meta.set(world.keyOf(x0 + 1, y + 1, z0 + d - 3), { bed: { head: true } });
    sbW(x0 + w - 2, y + 2, z0 + d - 2, B.TORCH);
  }

  // 7x6, bed + chest, a raised gable ridge along the long axis for a pitched-roof look
  buildHouseBP(sbW, world, b, groundY) {
    const { x0, z0, w, d } = b, y = groundY;
    this.buildFoundationAndShell(sbW, b, groundY, 3);
    for (let dx = 0; dx < w; dx++) for (let dz = 0; dz < d; dz++) sbW(x0 + dx, y + 4, z0 + dz, B.PLANKS);
    if (w >= d) for (let dx = 1; dx < w - 1; dx++) sbW(x0 + dx, y + 5, z0 + (d >> 1), B.PLANKS);
    else for (let dz = 1; dz < d - 1; dz++) sbW(x0 + (w >> 1), y + 5, z0 + dz, B.PLANKS);
    const doorX = b.door.x, doorZ = z0;
    sbW(doorX, y + 1, doorZ, B.DOOR); sbW(doorX, y + 2, doorZ, B.DOOR);
    world.meta.set(world.keyOf(doorX, y + 1, doorZ), { door: { top: false } });
    world.meta.set(world.keyOf(doorX, y + 2, doorZ), { door: { top: true } });
    this.widenDoorway(sbW, world, doorX, doorZ, y);
    sbW(x0, y + 2, z0 + (d >> 1), B.GLASS); sbW(x0 + w - 1, y + 2, z0 + (d >> 1), B.GLASS);
    sbW(x0 + 1, y + 1, z0 + d - 2, B.BED); sbW(x0 + 1, y + 1, z0 + d - 3, B.BED);
    world.meta.set(world.keyOf(x0 + 1, y + 1, z0 + d - 2), { bed: { head: false } });
    world.meta.set(world.keyOf(x0 + 1, y + 1, z0 + d - 3), { bed: { head: true } });
    const r = mulberry32(this.seed ^ (x0 * 7919) ^ (z0 * 104729) ^ 0xBEEF);
    sbW(x0 + w - 2, y + 1, z0 + 1, B.CHEST);
    const loot = new Array(27).fill(null);
    loot[3] = { id: I.BREAD, n: 2 + (r() * 3 | 0) };
    loot[9] = { id: I.EMERALD, n: 1 + (r() * 3 | 0) };
    if (r() < 0.5) loot[14] = { id: I.IRON_INGOT, n: 1 + (r() * 2 | 0) };
    world.meta.set(world.keyOf(x0 + w - 2, y + 1, z0 + 1), { chest: loot });
    sbW(x0 + 1, y + 2, z0 + 1, B.TORCH);
  }

  // bordered 9x9 crop plot: oak-log fence, a center water source hydrating the
  // whole plot, wheat planted at a mix of growth stages
  buildGardenBP(sbW, world, b, groundY) {
    const { x0, z0, w, d } = b, y = groundY;
    const cx = x0 + (w >> 1), cz = z0 + (d >> 1);
    const r = mulberry32(this.seed ^ (x0 * 7919) ^ (z0 * 104729) ^ 0xFA12);
    for (let dx = 0; dx < w; dx++) for (let dz = 0; dz < d; dz++) {
      const x = x0 + dx, z = z0 + dz;
      const border = dx === 0 || dz === 0 || dx === w - 1 || dz === d - 1;
      sbW(x, y - 1, z, B.DIRT);
      if (border) { sbW(x, y, z, B.LOG_OAK); sbW(x, y + 1, z, B.AIR); continue; }
      if (x === cx && z === cz) { sbW(x, y, z, B.WATER); sbW(x, y + 1, z, B.AIR); continue; }
      sbW(x, y, z, B.FARMLAND_WET);
      sbW(x, y + 1, z, B.WHEAT);
      world.meta.set(world.keyOf(x, y + 1, z), { crop: (r() * 8) | 0 });
    }
  }

  // 5x5 with the assigned profession's job-site block inside
  buildProfessionBP(sbW, world, b, groundY) {
    const { x0, z0, w, d, job } = b, y = groundY;
    this.buildFoundationAndShell(sbW, b, groundY, 2);
    for (let dx = 0; dx < w; dx++) for (let dz = 0; dz < d; dz++) sbW(x0 + dx, y + 3, z0 + dz, B.PLANKS);
    const doorX = b.door.x, doorZ = z0;
    sbW(doorX, y + 1, doorZ, B.DOOR); sbW(doorX, y + 2, doorZ, B.DOOR);
    world.meta.set(world.keyOf(doorX, y + 1, doorZ), { door: { top: false } });
    world.meta.set(world.keyOf(doorX, y + 2, doorZ), { door: { top: true } });
    this.widenDoorway(sbW, world, doorX, doorZ, y);
    sbW(x0 + (w >> 1), y + 1, z0 + d - 2, JOB_BLOCK[job] ?? B.COMPOSTER);
    sbW(x0 + 1, y + 2, z0 + 1, B.TORCH);
  }
}
