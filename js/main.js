// Main orchestrator: menus, game loop (20 TPS), input, interactions, spawning, weather.
import * as THREE from '../vendor/three.module.js';
import { World, SEA, Y0, YMAX, keyOf } from './world.js';
import { B, I, itemInfo, blockInfo, isFood, maxStack } from './blocks.js';
import { BIOME, BIOME_NAMES } from './worldgen.js';
import { Player } from './player.js';
import { UI } from './ui.js';
import { ItemEntity, XPOrb, Burst, Mob, spawnMob, Villager, IronGolem } from './entities.js';
import { atlasCanvas } from './atlas.js';
import { sfx } from './audio.js';

const $ = id => document.getElementById(id);
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 600);
camera.rotation.order = 'YXZ';
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

let scene = null, world = null, player = null, ui = null;
let state = 'menu';        // menu | loading | playing
let paused = false;
let worldSpawn = null;
const keys = {};
let mouseL = false, mouseR = false, rmbRepeat = 0;
let mining = { x: null, y: null, z: null, prog: 0 };
let fpsAcc = 0, fpsN = 0, fps = 0;
let debugOn = false;
let sleepLock = 0;
let highlight = null, sun = null, moon = null, rain = null;
let loadStep = null;
let currentSaveId = null, currentWorldName = '';

// ---------- save / load (localStorage) ----------
const SAVE_INDEX_KEY = 'overworld:index';
const saveKeyFor = id => 'overworld:save:' + id;

function listWorlds() {
  try { return JSON.parse(localStorage.getItem(SAVE_INDEX_KEY) || '[]'); }
  catch { return []; }
}
function writeIndex(list) {
  try { localStorage.setItem(SAVE_INDEX_KEY, JSON.stringify(list)); } catch (e) { console.error('save index failed', e); }
}
function deleteWorld(id) {
  const list = listWorlds().filter(w => w.id !== id);
  writeIndex(list);
  try { localStorage.removeItem(saveKeyFor(id)); } catch {}
  renderWorldList();
}
function saveWorld() {
  if (!world || !player || !currentSaveId) return false;
  const data = {
    world: world.serialize(),
    worldSpawn,
    player: {
      pos: player.pos, yaw: player.yaw, pitch: player.pitch,
      hp: player.hp, hunger: player.hunger, sat: player.sat, air: player.air,
      xp: player.xp, level: player.level,
      inv: player.inv, armor: player.armor, off: player.off, sel: player.sel,
      spawnPoint: player.spawnPoint, deathPos: player.deathPos,
    },
  };
  try {
    localStorage.setItem(saveKeyFor(currentSaveId), JSON.stringify(data));
  } catch (e) {
    console.error('save failed', e);
    ui?.msg('Save failed — storage full or unavailable');
    return false;
  }
  const list = listWorlds();
  const entry = { id: currentSaveId, name: currentWorldName, seed: world.seedStr, rdist: world.viewR, savedAt: Date.now() };
  const idx = list.findIndex(w => w.id === currentSaveId);
  if (idx >= 0) list[idx] = entry; else list.unshift(entry);
  writeIndex(list);
  return true;
}
function renderWorldList() {
  const box = $('worldlist');
  if (!box) return;
  const list = listWorlds().sort((a, b) => b.savedAt - a.savedAt);
  box.innerHTML = '';
  for (const w of list) {
    const row = document.createElement('div');
    row.className = 'wentry';
    const info = document.createElement('div');
    info.className = 'wname';
    info.textContent = w.name || w.seed;
    const meta = document.createElement('div');
    meta.className = 'wmeta';
    meta.textContent = new Date(w.savedAt).toLocaleString();
    const left = document.createElement('div');
    left.style.flex = '1'; left.style.overflow = 'hidden';
    left.appendChild(info); left.appendChild(meta);
    const playBtn = document.createElement('button');
    playBtn.textContent = 'Play';
    playBtn.onclick = () => loadWorld(w.id);
    const delBtn = document.createElement('button');
    delBtn.className = 'wdel'; delBtn.textContent = 'X';
    delBtn.onclick = (e) => { e.stopPropagation(); deleteWorld(w.id); };
    row.appendChild(left); row.appendChild(playBtn); row.appendChild(delBtn);
    box.appendChild(row);
  }
}
function loadWorld(id) {
  let raw;
  try { raw = localStorage.getItem(saveKeyFor(id)); } catch { raw = null; }
  if (!raw) { ui?.msg('Save data missing'); renderWorldList(); return; }
  let data;
  try { data = JSON.parse(raw); } catch { ui?.msg('Save data corrupted'); return; }
  const entry = listWorlds().find(w => w.id === id);
  currentSaveId = id;
  currentWorldName = entry?.name || '';
  startGame(data.world.seedStr, data.world.viewR, { saved: data });
}

// block tint colors for break particles (sampled from atlas)
const tintCache = new Map();
function blockTint(id) {
  if (tintCache.has(id)) return tintCache.get(id);
  const t = blockInfo[id]?.tiles?.side ?? 0;
  const g = atlasCanvas.getContext('2d');
  const d = g.getImageData((t % 16) * 16 + 8, ((t / 16) | 0) * 16 + 8, 1, 1).data;
  const c = (d[0] << 16) | (d[1] << 8) | d[2];
  tintCache.set(id, c);
  return c;
}

// ---------- world setup ----------
function findSpawn(gen) {
  for (let r = 0; r < 64; r++) {
    for (let a = 0; a < 8; a++) {
      const x = Math.round(Math.cos(a) * r * 24), z = Math.round(Math.sin(a) * r * 24);
      const c = gen.colInfo(x, z);
      if ([BIOME.PLAINS, BIOME.FOREST, BIOME.BIRCH].includes(c.biome)) return { x: x + 0.5, y: c.h + 2, z: z + 0.5 };
    }
  }
  return { x: 8.5, y: 90, z: 8.5 };
}

function startGame(seedStr, rdist, opts = {}) {
  const saved = opts.saved ?? null;
  scene = new THREE.Scene();
  world = new World(seedStr, scene, rdist);
  if (saved) world.loadSaved(saved.world); // restore edits/meta before any chunk generates
  player = new Player(world);
  world.player = player;
  worldSpawn = saved ? saved.worldSpawn : findSpawn(world.gen);
  if (saved) {
    const p = saved.player;
    player.pos = { ...p.pos }; player.prev = { ...p.pos };
    player.yaw = p.yaw; player.pitch = p.pitch;
    player.hp = p.hp; player.hunger = p.hunger; player.sat = p.sat; player.air = p.air;
    player.xp = p.xp; player.level = p.level;
    player.inv = p.inv; player.armor = p.armor; player.off = p.off; player.sel = p.sel;
    player.spawnPoint = p.spawnPoint; player.deathPos = p.deathPos;
  } else {
    player.pos = { ...worldSpawn }; player.prev = { ...worldSpawn };
  }
  ui = new UI(player, world);
  world.dropItem = (x, y, z, stack, vel) => world.entities.push(new ItemEntity(world, x, y, z, { ...stack }, vel));
  world.onXp = (x, y, z, amount) => {
    let left = amount;
    while (left > 0) { const v = Math.min(left, 1 + (Math.random() * 3 | 0)); left -= v; world.entities.push(new XPOrb(world, x, y, z, v)); }
  };
  player.onHurt = () => {
    $('damagefx').style.opacity = 1;
    setTimeout(() => $('damagefx').style.opacity = 0, 250);
  };
  // highlight box
  highlight = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
    new THREE.LineBasicMaterial({ color: 0x111111 }));
  highlight.visible = false;
  scene.add(highlight);
  // sun & moon
  const mkDisc = (color, size) => new THREE.Mesh(new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ color, fog: false, depthWrite: false }));
  sun = mkDisc(0xfff4a8, 24); moon = mkDisc(0xd8d8e8, 16);
  scene.add(sun); scene.add(moon);
  // rain
  const rn = 700, rpos = new Float32Array(rn * 3);
  for (let i = 0; i < rn; i++) {
    rpos[i * 3] = (Math.random() - 0.5) * 30; rpos[i * 3 + 1] = Math.random() * 20; rpos[i * 3 + 2] = (Math.random() - 0.5) * 30;
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.BufferAttribute(rpos, 3));
  rain = new THREE.Points(rg, new THREE.PointsMaterial({ color: 0x7899cc, size: 0.09, transparent: true, opacity: 0.7 }));
  rain.visible = false;
  scene.add(rain);

  // loading screen: pregenerate view area
  state = 'loading';
  $('menu').classList.add('hidden');
  $('loading').classList.remove('hidden');
  const total = (rdist * 2 + 1) ** 2;
  let loadDone = false;
  loadStep = () => {
    if (state !== 'loading' || loadDone) return;
    let pending;
    try { pending = world.update(player.pos.x, player.pos.z, 4); }
    catch (err) { console.error('loadStep failed:', err.message, err.stack); return; }
    $('loadbar').style.width = ((1 - pending / total) * 100) + '%';
    if (pending > 0) { setTimeout(loadStep, 30); return; }
    loadDone = true;
    if (!saved) {
      // fresh world: drop the player on solid ground at the chosen spawn
      const sy = world.surfaceY(Math.floor(player.pos.x), Math.floor(player.pos.z));
      player.pos.y = sy + 1.01; player.prev.y = player.pos.y;
      worldSpawn.y = player.pos.y;
    } // loaded world: keep the exact saved position (may legitimately be underground)
    $('loading').classList.add('hidden');
    $('hud').classList.remove('hidden');
    state = 'playing';
    ui.updateHUD();
    ui.msg('Punch a tree to get wood!');
    canvas.requestPointerLock();
  };
  window.__game = { get world() { return world; }, get player() { return player; }, get ui() { return ui; }, step: () => loadStep && loadStep(), tick: () => tick(), get paused() { return paused; }, get gameState() { return state; }, simFrame: (nowMs) => frame(nowMs), interact: () => interact() };
  loadStep();
}

// ---------- input ----------
document.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (state !== 'playing') return;
  if (e.code === 'KeyE') {
    e.preventDefault();
    if (ui.isOpen()) { ui.closeScreen(); canvas.requestPointerLock(); }
    else if (!paused && !player.dead) ui.openScreen('inv');
  }
  if (e.code === 'KeyQ' && !ui.isOpen() && !paused) dropHeld();
  if (e.code === 'F3') { e.preventDefault(); debugOn = !debugOn; $('debug').style.display = debugOn ? 'block' : 'none'; }
  if (/^Digit[1-9]$/.test(e.code) && !ui.isOpen()) ui.selectHotbar(+e.code.slice(5) - 1);
});
document.addEventListener('keyup', e => keys[e.code] = false);
addEventListener('wheel', e => {
  if (state !== 'playing' || ui.isOpen() || paused) return;
  ui.selectHotbar(((player.sel + (e.deltaY > 0 ? 1 : -1)) % 9 + 9) % 9);
});
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement !== canvas) return;
  player.yaw -= e.movementX * 0.0024;
  player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch - e.movementY * 0.0024));
});
canvas.addEventListener('mousedown', e => {
  if (state !== 'playing' || paused) return;
  if (document.pointerLockElement !== canvas) { canvas.requestPointerLock(); return; }
  if (e.button === 0) { mouseL = true; tryAttack(); }
  if (e.button === 2) { mouseR = true; rmbRepeat = 0.25; interact(); }
});
addEventListener('mouseup', e => {
  if (e.button === 0) { mouseL = false; mining.prog = 0; }
  if (e.button === 2) { mouseR = false; player.blocking = false; }
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== canvas && state === 'playing' &&
      !ui.isOpen() && !player.dead && sleepLock === 0) {
    paused = true;
    $('pause').classList.remove('hidden');
  }
});

$('playbtn').onclick = () => {
  const seed = $('seed').value.trim() || String((Math.random() * 1e9) | 0);
  const name = $('worldname').value.trim() || seed;
  currentSaveId = 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  currentWorldName = name;
  startGame(seed, +$('rdist').value);
  saveWorld(); // persist immediately so the world shows up in the list even before quitting
};
$('resumebtn').onclick = () => { paused = false; $('pause').classList.add('hidden'); canvas.requestPointerLock(); };
$('keepinvchk').onchange = () => { if (player) player.keepInventory = $('keepinvchk').checked; };
$('quitbtn').onclick = () => { saveWorld(); location.reload(); };
renderWorldList();
$('titlebtn').onclick = () => { saveWorld(); location.reload(); };
$('respawnbtn').onclick = () => {
  player.respawn(worldSpawn);
  $('death').classList.add('hidden');
  canvas.requestPointerLock();
};
$('respawndeathbtn').onclick = () => {
  player.respawn(worldSpawn, true);
  $('death').classList.add('hidden');
  canvas.requestPointerLock();
};
addEventListener('beforeunload', () => { if (state === 'playing') saveWorld(); });

function inputState() {
  return {
    f: keys['KeyW'], b: keys['KeyS'], l: keys['KeyA'], r: keys['KeyD'],
    jump: keys['Space'], sneak: keys['ShiftLeft'] || keys['ShiftRight'],
    sprint: keys['ControlLeft'] || keys['ControlRight'],
  };
}

function dropHeld() {
  const s = player.heldStack();
  if (!s) return;
  const one = { id: s.id, n: 1 };
  if (s.dur !== undefined) one.dur = s.dur;
  player.consumeHeld(1);
  const d = lookDir();
  world.dropItem(player.pos.x, player.pos.y + 1.4, player.pos.z, one,
    { x: d.x * 5, y: d.y * 5 + 1.5, z: d.z * 5 });
  ui.updateHUD();
}

function lookDir() {
  const cp = Math.cos(player.pitch);
  return { x: -Math.sin(player.yaw) * cp, y: Math.sin(player.pitch), z: -Math.cos(player.yaw) * cp };
}
function eyePos() {
  return { x: player.pos.x, y: player.pos.y + (player.sneaking ? 1.32 : 1.62), z: player.pos.z };
}
function blockRay(fluids = false) {
  const e = eyePos(), d = lookDir();
  return world.raycast(e.x, e.y, e.z, d.x, d.y, d.z, 4.5, fluids);
}

function entityRay(maxD = 3.2) {
  const e = eyePos(), d = lookDir();
  let best = null, bestT = maxD;
  for (const ent of world.entities) {
    if (!(ent instanceof Mob || ent instanceof Villager || ent instanceof IronGolem) || ent.dead) continue;
    const w2 = ent.w / 2 + 0.1;
    // slab test
    let t0 = 0, t1 = bestT, ok = true;
    const mins = [ent.pos.x - w2, ent.pos.y, ent.pos.z - w2];
    const maxs = [ent.pos.x + w2, ent.pos.y + ent.h, ent.pos.z + w2];
    const o = [e.x, e.y, e.z], dir = [d.x, d.y, d.z];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(dir[i]) < 1e-8) { if (o[i] < mins[i] || o[i] > maxs[i]) { ok = false; break; } continue; }
      let a = (mins[i] - o[i]) / dir[i], b = (maxs[i] - o[i]) / dir[i];
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) { ok = false; break; }
    }
    if (ok && t0 < bestT) { bestT = t0; best = ent; }
  }
  return best;
}

// ---------- combat ----------
function tryAttack() {
  if (ui.isOpen() || player.dead) return;
  const target = entityRay();
  if (!target) return;
  const now = performance.now() / 1000;
  const cd = player.attackCooldown();
  const charge = Math.min(1, (now - player.lastSwing) / cd);
  player.lastSwing = now;
  const scale = 0.2 + 0.8 * charge * charge;
  let dmg = player.attackDamage() * scale;
  const crit = player.vel.y < -0.5 && !player.onGround && !player.inWater;
  if (crit) {
    dmg *= 1.5;
    world.effects.push(new Burst(world, target.pos.x, target.pos.y + target.h, target.pos.z, 0xffe27a, 8));
  }
  const d = lookDir();
  const kbMul = player.sprinting ? 1.8 : 1;
  target.hurt(Math.round(dmg), { x: d.x * 0.5 * kbMul, y: 0.4, z: d.z * 0.5 * kbMul }, true);
  const held = player.heldStack();
  if (held && itemInfo[held.id]?.tool) player.damageTool(held, 1);
  player.exhaust(0.1);
}

// ---------- mining (per frame while LMB held) ----------
function updateMining(dt) {
  const bar = $('breakbar');
  if (!mouseL || ui.isOpen() || paused || player.dead) { mining.prog = 0; bar.style.display = 'none'; return; }
  if (entityRay()) { mining.prog = 0; bar.style.display = 'none'; tryAttackHeld(); return; }
  const hit = blockRay();
  if (!hit) { mining.prog = 0; bar.style.display = 'none'; return; }
  if (hit.x !== mining.x || hit.y !== mining.y || hit.z !== mining.z) {
    mining.x = hit.x; mining.y = hit.y; mining.z = hit.z; mining.prog = 0;
  }
  const t = player.breakTime(hit.id);
  if (t === Infinity) { bar.style.display = 'none'; return; }
  mining.prog += dt / t;
  bar.style.display = 'block';
  $('breakfill').style.width = Math.min(100, mining.prog * 100) + '%';
  if (mining.prog >= 1) {
    mining.prog = 0;
    const canHarvest = player.canHarvest(hit.id);
    world.effects.push(new Burst(world, hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, blockTint(hit.id), 14));
    sfx('break');
    world.breakBlock(hit.x, hit.y, hit.z, null, !canHarvest);
    const held = player.heldStack();
    if (held && itemInfo[held.id]?.tool && blockInfo[hit.id].hard > 0) player.damageTool(held, 1);
    player.exhaust(0.005);
  }
}
function tryAttackHeld() {
  const now = performance.now() / 1000;
  if (now - player.lastSwing >= player.attackCooldown()) tryAttack();
}

// ---------- right-click interactions ----------
function interact() {
  if (ui.isOpen() || paused || player.dead) return;
  const held = player.heldStack();
  const hInfo = held ? itemInfo[held.id] : null;

  // 0. right-click a villager to trade
  const entTarget = entityRay();
  if (entTarget instanceof Villager && !player.sneaking) {
    ui.openScreen('trade', entTarget);
    return;
  }

  const hit = blockRay();

  // 1. interactable blocks (unless sneaking)
  if (hit && !player.sneaking) {
    const id = hit.id;
    if (id === B.DOOR || id === B.DOOR_OPEN) {
      const other = blockInfo[world.getBlock(hit.x, hit.y + 1, hit.z)]?.kind === 'door' ? 1 :
        blockInfo[world.getBlock(hit.x, hit.y - 1, hit.z)]?.kind === 'door' ? -1 : 0;
      const nid = id === B.DOOR ? B.DOOR_OPEN : B.DOOR;
      world.setBlock(hit.x, hit.y, hit.z, nid, { force: true });
      if (other) world.setBlock(hit.x, hit.y + other, hit.z, nid, { force: true });
      sfx('door');
      return;
    }
    if (id === B.CRAFTING) { ui.openScreen('table'); return; }
    if (id === B.FURNACE) {
      const k = keyOf(hit.x, hit.y, hit.z);
      let m = world.meta.get(k);
      if (!m || !m.furnace) { m = { furnace: { items: [null, null, null], burn: 0, burnMax: 0, cook: 0 } }; world.meta.set(k, m); }
      world.furnaces.add(k);
      ui.openScreen('furnace', m.furnace);
      return;
    }
    if (id === B.CHEST) {
      const k = keyOf(hit.x, hit.y, hit.z);
      let m = world.meta.get(k);
      if (!m || !m.chest) { m = { chest: new Array(27).fill(null) }; world.meta.set(k, m); }
      ui.openScreen('chest', m.chest);
      return;
    }
    if (id === B.BED) { trySleep(hit); return; }
    if (id === B.WHEAT) {
      const m = world.getMeta(hit.x, hit.y, hit.z);
      if (m?.crop >= 7) { world.breakBlock(hit.x, hit.y, hit.z); sfx('pop'); return; }
    }
  }

  // 2. buckets
  if (held && (held.id === I.BUCKET || held.id === I.BUCKET_WATER || held.id === I.BUCKET_LAVA)) {
    if (held.id === I.BUCKET) {
      const fh = blockRay(true);
      if (fh) {
        const filled = fh.id === B.WATER ? I.BUCKET_WATER : I.BUCKET_LAVA;
        world.setBlock(fh.x, fh.y, fh.z, B.AIR, { force: true });
        player.consumeHeld(1);
        if (player.addStack({ id: filled, n: 1 }) > 0)
          world.dropItem(player.pos.x, player.pos.y + 1, player.pos.z, { id: filled, n: 1 });
        sfx('splash');
        ui.updateHUD();
      }
      return;
    }
    if (hit) {
      const tx = hit.x + hit.face[0], ty = hit.y + hit.face[1], tz = hit.z + hit.face[2];
      if (world.canFlowInto(world.getBlock(tx, ty, tz))) {
        world.setBlock(tx, ty, tz, held.id === I.BUCKET_WATER ? B.WATER : B.LAVA, { force: true });
        player.inv[player.sel] = { id: I.BUCKET, n: 1 };
        sfx('splash');
        ui.updateHUD();
      }
      return;
    }
  }

  // 3. food -> eat instantly, one tap (same feel as placing a block)
  if (hInfo?.food && player.hunger < 20) {
    player.hunger = Math.min(20, player.hunger + hInfo.food.h);
    player.sat = Math.min(player.hunger, player.sat + hInfo.food.sat);
    player.consumeHeld(1);
    sfx('eat');
    ui.updateHUD();
    return;
  }

  // 4. hoe -> farmland
  if (hInfo?.tool?.kind === 'hoe' && hit) {
    if ((hit.id === B.GRASS || hit.id === B.DIRT) && world.getBlock(hit.x, hit.y + 1, hit.z) === B.AIR) {
      world.setBlock(hit.x, hit.y, hit.z, B.FARMLAND);
      player.damageTool(held, 1);
      sfx('step', 0.8);
      return;
    }
  }

  // 5. bone meal
  if (held?.id === I.BONEMEAL && hit) {
    if (hit.id === B.WHEAT) {
      const m = world.getMeta(hit.x, hit.y, hit.z) ?? { crop: 0 };
      m.crop = Math.min(7, (m.crop ?? 0) + 2 + (Math.random() * 3 | 0));
      world.setMeta(hit.x, hit.y, hit.z, m);
      world.chunkAt(hit.x, hit.z).dirty = true;
      world.effects.push(new Burst(world, hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, 0xd8f0d8, 10));
      player.consumeHeld(1); ui.updateHUD();
      return;
    }
    if (hit.id === B.SAPLING) {
      world.setBlock(hit.x, hit.y, hit.z, B.AIR);
      world.gen.placeTree((ax, ay, az, bid) => {
        if (world.getBlock(ax, ay, az) === B.AIR || bid !== B.LEAF_OAK) world.setBlock(ax, ay, az, bid);
      }, hit.x, hit.y, hit.z, 'oak', Math.random.bind(Math));
      player.consumeHeld(1); ui.updateHUD();
      return;
    }
  }

  // 6. place blocks
  if (hInfo?.place !== undefined && hit) {
    placeBlock(held, hInfo.place, hit);
    return;
  }

  // 7. shield block
  if (held?.id === I.SHIELD || player.off?.id === I.SHIELD) player.blocking = true;
}

function placeBlock(held, blockId, hit) {
  const tx = hit.x + hit.face[0], ty = hit.y + hit.face[1], tz = hit.z + hit.face[2];
  const cur = world.getBlock(tx, ty, tz);
  if (!world.canFlowInto(cur) && cur !== B.WATER) return;
  const info = blockInfo[blockId];
  // seeds only on farmland
  if (blockId === B.WHEAT) {
    const below = world.getBlock(tx, ty - 1, tz);
    if (below !== B.FARMLAND && below !== B.FARMLAND_WET) return;
    world.setBlock(tx, ty, tz, B.WHEAT, { meta: { crop: 0 }, force: true });
    player.consumeHeld(1); sfx('place'); ui.updateHUD();
    return;
  }
  if (blockId === B.SAPLING || info.kind === 'cross') {
    const below = world.getBlock(tx, ty - 1, tz);
    if (below !== B.GRASS && below !== B.DIRT) return;
  }
  if (blockId === B.TORCH) {
    let support = false;
    for (const [dx, dy, dz] of [[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]])
      if (world.isSolid(tx + dx, ty + dy, tz + dz)) { support = true; break; }
    if (!support) return;
  }
  // don't place solid blocks inside the player or mobs
  if (info.solid) {
    const w2 = player.w / 2;
    const overlap = (px, py, pz, w, h) =>
      tx + 1 > px - w / 2 && tx < px + w / 2 && ty + 1 > py && ty < py + h && tz + 1 > pz - w / 2 && tz < pz + w / 2;
    if (overlap(player.pos.x, player.pos.y, player.pos.z, player.w, player.h)) return;
    for (const e of world.entities) if (e instanceof Mob && overlap(e.pos.x, e.pos.y, e.pos.z, e.w, e.h)) return;
  }
  if (blockId === B.DOOR) {
    if (!world.canFlowInto(world.getBlock(tx, ty + 1, tz))) return;
    world.setBlock(tx, ty, tz, B.DOOR, { meta: { door: { top: false } }, force: true });
    world.setBlock(tx, ty + 1, tz, B.DOOR, { meta: { door: { top: true } }, force: true });
    player.consumeHeld(1); sfx('place'); ui.updateHUD();
    return;
  }
  if (blockId === B.BED) {
    const d = lookDir();
    const hx = Math.abs(d.x) > Math.abs(d.z) ? Math.sign(d.x) : 0;
    const hz = hx === 0 ? Math.sign(d.z) || 1 : 0;
    const bx = tx + hx, bz = tz + hz;
    if (!world.canFlowInto(world.getBlock(bx, ty, bz))) return;
    if (!world.isSolid(tx, ty - 1, tz) || !world.isSolid(bx, ty - 1, bz)) return;
    world.setBlock(tx, ty, tz, B.BED, { meta: { bed: { head: false } }, force: true });
    world.setBlock(bx, ty, bz, B.BED, { meta: { bed: { head: true } }, force: true });
    player.consumeHeld(1); sfx('place'); ui.updateHUD();
    return;
  }
  world.setBlock(tx, ty, tz, blockId, { force: true });
  if (blockId === B.FURNACE) {
    world.setMeta(tx, ty, tz, { furnace: { items: [null, null, null], burn: 0, burnMax: 0, cook: 0 } });
    world.furnaces.add(keyOf(tx, ty, tz));
  }
  if (blockId === B.CHEST) world.setMeta(tx, ty, tz, { chest: new Array(27).fill(null) });
  player.consumeHeld(1);
  sfx('place');
  ui.updateHUD();
}

function trySleep(hit) {
  if (!world.isNight() && world.weather !== 'thunder') { ui.msg('You can only sleep at night'); return; }
  sleepLock = 1;
  player.sleeping = true;
  player.spawnPoint = { x: hit.x + 0.5, y: hit.y + 1, z: hit.z + 0.5 };
  ui.msg('Sleeping…');
  $('sleepfade').style.opacity = 1;
  setTimeout(() => {
    world.time = Math.ceil(world.time / 24000) * 24000;
    world.weather = 'clear';
    world.weatherTimer = 20 * 60 * (4 + Math.random() * 6);
    player.sleeping = false;
    $('sleepfade').style.opacity = 0;
    setTimeout(() => sleepLock = 0, 400);
  }, 1200);
}

// ---------- mob spawning ----------
function spawnTick() {
  // drain worldgen passive queue. Villages queue their villagers/golems the
  // moment the first overlapping chunk populates, which can happen while the
  // player is still well outside spawn range (a village's footprint reaches
  // up to 64 blocks from its trigger chunk). Entries still out of range are
  // kept for a later attempt instead of being dropped, otherwise those
  // villagers/golems would be lost forever the instant they're queued.
  const stillFar = [];
  while (world.spawnQueue.length) {
    const s = world.spawnQueue.pop();
    if (Math.hypot(s.x - player.pos.x, s.z - player.pos.z) >= world.viewR * 16 + 16) { stillFar.push(s); continue; }
    if (s.type === 'villager') world.entities.push(new Villager(world, s.x, s.y, s.z, { profession: s.profession, bed: s.bed, village: s.village }));
    else if (s.type === 'iron_golem') world.entities.push(new IronGolem(world, s.x, s.y, s.z, { village: s.village }));
    else spawnMob(world, s.type, s.x, s.y, s.z);
  }
  world.spawnQueue = stillFar;
  const mobs = world.entities.filter(e => e instanceof Mob);
  const hostiles = mobs.filter(m => m.spec.hostile);
  // despawn far hostiles
  for (const m of hostiles)
    if (Math.hypot(m.pos.x - player.pos.x, m.pos.z - player.pos.z) > 72) m.remove();
  if (hostiles.length >= 14) return;
  // attempt spawns near player at light level 0
  for (let i = 0; i < 6; i++) {
    const ang = Math.random() * Math.PI * 2;
    const dist = 18 + Math.random() * 26;
    const x = Math.floor(player.pos.x + Math.cos(ang) * dist);
    const z = Math.floor(player.pos.z + Math.sin(ang) * dist);
    let y;
    if (Math.random() < 0.5) y = world.surfaceY(x, z) + 1;   // surface
    else {                                                    // caves
      y = Y0 + 6 + (Math.random() * (world.surfaceY(x, z) - Y0 - 8) | 0);
      let guard = 0;
      while (guard++ < 24 && !(world.getBlock(x, y, z) === B.AIR && world.isSolid(x, y - 1, z))) y++;
    }
    if (world.getBlock(x, y, z) !== B.AIR || world.getBlock(x, y + 1, z) !== B.AIR) continue;
    if (!world.isSolid(x, y - 1, z)) continue;
    const L = world.lightAt(x, y, z);
    // 1.18 rule: hostile mobs only spawn at light level 0
    if (L.b > 0) continue;
    if (L.s > 0 && !world.isNight()) continue;
    const roll = Math.random();
    const type = roll < 0.35 ? 'zombie' : roll < 0.6 ? 'skeleton' : roll < 0.8 ? 'creeper' : 'spider';
    spawnMob(world, type, x + 0.5, y, z + 0.5);
    break;
  }
}

// ---------- feeding / breeding (RMB on mob) ----------
function tryFeedMob() {
  const held = player.heldStack();
  if (!held) return false;
  const m = entityRay();
  if (!m || !(m instanceof Mob) || m.spec.hostile || m.baby) return false;
  if (m.spec.food === held.id && m.loveTimer <= 0) {
    m.loveTimer = 600;
    player.consumeHeld(1);
    world.effects.push(new Burst(world, m.pos.x, m.pos.y + m.h + 0.3, m.pos.z, 0xff5a8a, 6));
    sfx('eat');
    ui.updateHUD();
    return true;
  }
  return false;
}

// ---------- 20 TPS tick ----------
function tick() {
  world.tick();
  player.tick();
  for (const e of world.entities) e.tick(0.05);
  world.entities = world.entities.filter(e => !e.dead);
  for (const e of world.effects) e.tick(0.05);
  world.effects = world.effects.filter(e => !e.dead);
  if (world.tickCount % 40 === 0) spawnTick();
  if (world.tickCount % 2400 === 0) saveWorld(); // autosave roughly every 2 minutes
  // furnace XP -> orbs
  if (world.tickCount % 100 === 0) {
    for (const k of world.furnaces) {
      const f = world.meta.get(k)?.furnace;
      if (f?.xpBank >= 2) {
        const [x, y, z] = k.split(',').map(Number);
        world.onXp(x + 0.5, y + 1, z + 0.5, Math.floor(f.xpBank));
        f.xpBank = 0;
      }
    }
  }
  // thunderstorm flashes
  if (world.weather === 'thunder' && Math.random() < 0.004) {
    const el = $('sleepfade');
    el.style.transition = 'opacity .1s'; el.style.background = '#dfe8ff'; el.style.opacity = 0.55;
    setTimeout(() => { el.style.opacity = 0; setTimeout(() => { el.style.background = '#000'; el.style.transition = 'opacity 1s'; }, 300); }, 120);
    sfx('thunder');
  }
  // death screen
  if (player.dead && $('death').classList.contains('hidden') && !$('menu').offsetParent) {
    $('deathscore').textContent = 'Score: ' + player.level + (player.deathCause ? ' — killed by ' + player.deathCause : '');
    $('death').classList.remove('hidden');
    document.exitPointerLock?.();
  }
  if (ui.isOpen() && ui.open === 'furnace') ui.updateFurnaceBars();
  ui.updateHUD();
}

// ---------- render loop ----------
let last = performance.now(), acc = 0;
const dayColor = new THREE.Color(0x87ceeb), nightColor = new THREE.Color(0x0a0e22);
const duskColor = new THREE.Color(0xd88a4a);
const skyCol = new THREE.Color();

function frame(now) {
  requestAnimationFrame(frame);
  // rawDt (unclamped, but bounded to 2s so an alt-tab doesn't jump multiple days)
  // drives the day/night clock directly off the wall clock. dt (clamped to 0.1s)
  // drives the fixed-step gameplay tick loop below. Without this split, any frame
  // hitch (chunk meshing, lighting BFS, a burst of mob AI) got its excess real time
  // silently discarded by the old dt clamp, so world.time fell behind the wall
  // clock and night dragged on far longer than the intended 7 real-world minutes.
  const rawDt = Math.min(2, Math.max(0, (now - last) / 1000));
  const dt = Math.min(0.1, rawDt);
  last = now;
  if (state === 'loading') { loadStep?.(); return; }
  if (state !== 'playing') return;
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }

  if (!paused) {
    if (!world.player.sleeping) world.time += rawDt * 20;
    acc += dt;
    let steps = 0;
    while (acc >= 0.05 && steps++ < 4) { acc -= 0.05; tick(); }
    if (!ui.isOpen() && !player.dead) {
      player.moveFrame(dt, inputState());
      updateMining(dt);
      if (mouseR) {
        rmbRepeat -= dt;
        if (rmbRepeat <= 0 && !player.blocking) { rmbRepeat = 0.25; if (!tryFeedMob()) interact(); }
      }
    }
    world.update(player.pos.x, player.pos.z, 2);
  }

  // camera
  const eye = eyePos();
  const swimOffset = player.headInWater ? -0.25 : 0;
  camera.position.set(eye.x, eye.y + swimOffset, eye.z);
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;
  const targetFov = player.sprinting ? 82 : 75;
  if (Math.abs(camera.fov - targetFov) > 0.5) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 10);
    camera.updateProjectionMatrix();
  }

  // sky, fog, lighting
  const df = world.dayFactor();
  const duskness = Math.max(0, 1 - Math.abs(df - 0.56) * 4);
  skyCol.copy(nightColor).lerp(dayColor, Math.max(0, (df - 0.12) / 0.88));
  skyCol.lerp(duskColor, duskness * 0.55);
  scene.background = skyCol;
  world.uniforms.dayLight.value = df;
  // a lit torch in the off-hand acts as a personal light source, independent
  // of the static per-block lighting: this only needs a shader-side distance
  // falloff (no re-meshing) since it moves every frame with the player
  const handTorch = player.off?.id === B.TORCH;
  world.uniforms.handLight.value = handTorch ? blockInfo[B.TORCH].light : 0;
  if (handTorch) world.uniforms.handLightPos.value.set(eye.x, eye.y, eye.z);
  if (player.headInWater) {
    world.uniforms.fogColor.value.setHex(0x1a3a8a);
    world.uniforms.fogNear.value = 1; world.uniforms.fogFar.value = 14;
    $('vignette-water').style.display = 'block';
  } else {
    world.uniforms.fogColor.value.copy(skyCol);
    world.uniforms.fogNear.value = world.viewR * 16 * 0.6;
    world.uniforms.fogFar.value = world.viewR * 16 * 1.05;
    $('vignette-water').style.display = 'none';
  }
  // sun & moon
  const ang = (world.time % 24000) / 24000 * Math.PI * 2 - Math.PI / 2;
  sun.position.set(eye.x + Math.cos(ang) * 300, eye.y + Math.sin(ang) * 300, eye.z);
  moon.position.set(eye.x - Math.cos(ang) * 300, eye.y - Math.sin(ang) * 300, eye.z);
  sun.lookAt(camera.position); moon.lookAt(camera.position);
  // rain
  if (world.weather !== 'clear' && world.biomeAt(player.pos.x, player.pos.z) !== BIOME.DESERT) {
    rain.visible = true;
    rain.position.set(eye.x, eye.y, eye.z);
    const rp = rain.geometry.attributes.position;
    for (let i = 0; i < rp.count; i++) {
      let y = rp.getY(i) - dt * 22;
      if (y < -8) y = 12;
      rp.setY(i, y);
    }
    rp.needsUpdate = true;
  } else rain.visible = false;

  // block highlight
  const hit = (!ui.isOpen() && !player.dead) ? blockRay() : null;
  if (hit) {
    highlight.visible = true;
    highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
  } else highlight.visible = false;

  // entities interpolation
  const alpha = Math.min(1, acc / 0.05);
  for (const e of world.entities) e.render(alpha);

  // debug overlay
  if (debugOn) {
    const bx = Math.floor(player.pos.x), by = Math.floor(player.pos.y), bz = Math.floor(player.pos.z);
    const L = world.lightAt(bx, by, bz);
    $('debug').textContent =
      `XYZ: ${player.pos.x.toFixed(1)} / ${player.pos.y.toFixed(1)} / ${player.pos.z.toFixed(1)}\n` +
      `Biome: ${BIOME_NAMES[world.biomeAt(player.pos.x, player.pos.z)]}\n` +
      `Time: ${(world.time % 24000)} (${world.isNight() ? 'night' : 'day'})  Weather: ${world.weather}\n` +
      `Light: sky ${L.s} block ${L.b}\n` +
      `FPS: ${fps}  Entities: ${world.entities.length}  Chunks: ${world.chunks.size}\n` +
      `HP ${player.hp.toFixed(0)} Hunger ${player.hunger} Sat ${player.sat.toFixed(1)} XP L${player.level}`;
  }

  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
