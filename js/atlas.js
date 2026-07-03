// Procedural 16x16 texture atlas (256px canvas, 16x16 tiles), Minecraft-style pixel art.
import { mulberry32 } from './noise.js';

export const TILE = 16, ADIM = 16;
export const TILES = {};
const painters = [];
function def(name, fn) { TILES[name] = painters.length; painters.push(fn); }

// ---- painter helpers -------------------------------------------------------
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, ((n >> 16) & 255) * f)) | 0;
  const g = Math.min(255, Math.max(0, ((n >> 8) & 255) * f)) | 0;
  const b = Math.min(255, Math.max(0, (n & 255) * f)) | 0;
  return `rgb(${r},${g},${b})`;
}
function noisy(p, base, lo = 0.82, hi = 1.12) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++)
    p.set(x, y, shade(base, lo + p.rnd() * (hi - lo)));
}
function specks(p, color, count, size = 2) {
  for (let i = 0; i < count; i++) {
    const x = 1 + (p.rnd() * 13) | 0, y = 1 + (p.rnd() * 13) | 0;
    p.rect(x, y, size, size, color);
    p.set(x + size - 1, y + size - 1, shade(color, 0.7));
  }
}
function oreTile(p, gem, deep = false) {
  noisy(p, deep ? '#4c4c52' : '#7d7d7d');
  specks(p, gem, 5, 2);
}
function blob(p, color, r = 5) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5);
    if (d < r) p.set(x, y, shade(color, 0.85 + p.rnd() * 0.3));
    if (d > r - 1.4 && d < r) p.set(x, y, shade(color, 0.6));
  }
}
function ingot(p, color) {
  p.rect(2, 8, 12, 5, shade(color, 0.75));
  p.rect(3, 6, 11, 5, color);
  p.rect(3, 6, 11, 2, shade(color, 1.25));
}
function meat(p, color, cooked) {
  blob(p, cooked ? '#8a4a21' : color, 6);
  p.rect(5, 5, 5, 4, cooked ? '#b06a35' : shade(color, 1.25));
}
function toolIcon(p, kind, mat) {
  const stick = '#7a5b2b';
  // diagonal handle
  for (let i = 0; i < 8; i++) p.rect(4 + i, 11 - i, 2, 2, stick);
  const m = mat, d = shade(mat, 0.7), l = shade(mat, 1.25);
  if (kind === 'pickaxe') {
    p.rect(3, 2, 10, 2, m); p.rect(2, 3, 2, 3, m); p.rect(12, 3, 2, 3, m); p.rect(3, 2, 10, 1, l);
  } else if (kind === 'axe') {
    p.rect(8, 1, 5, 3, m); p.rect(7, 2, 3, 5, m); p.rect(8, 1, 5, 1, l); p.rect(7, 6, 2, 2, d);
  } else if (kind === 'shovel') {
    p.rect(10, 1, 4, 5, m); p.rect(11, 0, 2, 7, m); p.rect(10, 1, 4, 1, l);
  } else if (kind === 'sword') {
    for (let i = 0; i < 9; i++) p.rect(5 + i, 10 - i, 2, 2, i > 6 ? d : m);
    p.rect(4, 11, 4, 1, '#4a3418'); p.rect(6, 9, 1, 4, '#4a3418');
  } else if (kind === 'hoe') {
    p.rect(7, 1, 7, 2, m); p.rect(7, 1, 2, 4, m); p.rect(7, 1, 7, 1, l);
  }
}
function armorIcon(p, slot, mat) {
  const m = mat, d = shade(mat, 0.7);
  if (slot === 0) { p.rect(3, 5, 10, 6, m); p.rect(4, 8, 3, 3, '#0000'); p.clear(5, 9, 6, 3); p.rect(3, 5, 10, 2, shade(mat, 1.2)); }
  if (slot === 1) { p.rect(3, 2, 10, 11, m); p.clear(6, 2, 4, 3); p.rect(3, 2, 3, 4, d); p.rect(10, 2, 3, 4, d); }
  if (slot === 2) { p.rect(4, 2, 8, 4, m); p.rect(4, 6, 3, 8, m); p.rect(9, 6, 3, 8, d); }
  if (slot === 3) { p.rect(4, 8, 3, 5, m); p.rect(9, 8, 3, 5, m); p.rect(3, 11, 5, 2, d); p.rect(8, 11, 5, 2, d); }
}

// ---- block tiles -----------------------------------------------------------
def('grass_top', p => noisy(p, '#5fae3c', 0.8, 1.1));
def('grass_side', p => { noisy(p, '#8a6038'); for (let x = 0; x < 16; x++) { const h = 2 + (p.rnd() * 3) | 0; p.rect(x, 0, 1, h, shade('#5fae3c', 0.85 + p.rnd() * 0.3)); } });
def('dirt', p => noisy(p, '#8a6038'));
def('stone', p => noisy(p, '#7d7d7d'));
def('deepslate', p => { noisy(p, '#4c4c52'); for (let i = 0; i < 4; i++) p.rect((p.rnd() * 12) | 0, (p.rnd() * 16) | 0, 4, 1, '#3a3a40'); });
def('bedrock', p => { noisy(p, '#565656', 0.4, 1.4); });
def('sand', p => noisy(p, '#dbcf9c', 0.9, 1.08));
def('gravel', p => { noisy(p, '#847e7a'); specks(p, '#6a6460', 6, 2); specks(p, '#9c968f', 5, 2); });
def('log_oak', p => { noisy(p, '#6b5327'); for (let x = 0; x < 16; x += 3) p.rect(x, 0, 1, 16, shade('#6b5327', 0.75)); });
def('log_top', p => { noisy(p, '#b8945f'); for (let r = 2; r < 8; r += 2) { for (let a = 0; a < 40; a++) { const t = a / 40 * 6.28; p.set(8 + Math.cos(t) * r | 0, 8 + Math.sin(t) * r | 0, '#8a6d3b'); } } });
def('leaves_oak', p => { noisy(p, '#3d7a24', 0.7, 1.2); for (let i = 0; i < 10; i++) p.clear((p.rnd() * 16) | 0, (p.rnd() * 16) | 0, 1, 1); });
def('log_birch', p => { noisy(p, '#d7d3c8', 0.9, 1.05); for (let i = 0; i < 6; i++) p.rect((p.rnd() * 13) | 0, (p.rnd() * 15) | 0, 3, 1, '#2e2e2a'); });
def('leaves_birch', p => { noisy(p, '#6a9e4b', 0.75, 1.2); for (let i = 0; i < 10; i++) p.clear((p.rnd() * 16) | 0, (p.rnd() * 16) | 0, 1, 1); });
def('log_spruce', p => { noisy(p, '#4a3620'); for (let x = 0; x < 16; x += 4) p.rect(x, 0, 1, 16, shade('#4a3620', 0.7)); });
def('leaves_spruce', p => { noisy(p, '#2c5432', 0.75, 1.2); for (let i = 0; i < 8; i++) p.clear((p.rnd() * 16) | 0, (p.rnd() * 16) | 0, 1, 1); });
def('planks', p => { noisy(p, '#a3824a', 0.9, 1.08); p.rect(0, 3, 16, 1, '#7d6234'); p.rect(0, 7, 16, 1, '#7d6234'); p.rect(0, 11, 16, 1, '#7d6234'); p.rect(0, 15, 16, 1, '#7d6234'); p.rect(5, 0, 1, 4, '#7d6234'); p.rect(11, 4, 1, 4, '#7d6234'); p.rect(4, 8, 1, 4, '#7d6234'); p.rect(12, 12, 1, 4, '#7d6234'); });
def('cobble', p => { noisy(p, '#7d7d7d'); for (let i = 0; i < 7; i++) { const x = (p.rnd() * 12) | 0, y = (p.rnd() * 12) | 0, s = 3 + (p.rnd() * 3) | 0; p.rect(x, y, s, s, shade('#7d7d7d', 0.75 + p.rnd() * 0.5)); p.rect(x, y, s, 1, shade('#7d7d7d', 1.15)); } });
def('ore_coal', p => oreTile(p, '#2b2b2b'));
def('ore_copper', p => oreTile(p, '#c06c43'));
def('ore_iron', p => oreTile(p, '#d8af93'));
def('ore_gold', p => oreTile(p, '#f5d93c'));
def('ore_lapis', p => oreTile(p, '#2b4fc4'));
def('ore_redstone', p => oreTile(p, '#d61f1f', true));
def('ore_diamond', p => oreTile(p, '#4fdbd6', true));
def('ore_emerald', p => oreTile(p, '#17c455'));
def('crafting_top', p => { noisy(p, '#a3824a', 0.9, 1.08); p.rect(1, 1, 14, 14, '#0000'); p.rectO(1, 1, 14, 14, '#6b5327'); p.rect(8, 1, 1, 14, '#6b5327'); p.rect(1, 8, 14, 1, '#6b5327'); });
def('crafting_side', p => { noisy(p, '#a3824a', 0.9, 1.08); p.rect(0, 0, 16, 3, '#6b5327'); p.rect(2, 5, 5, 6, '#7d6234'); p.rect(9, 5, 5, 6, '#8d7244'); });
def('furnace_front', p => { noisy(p, '#7d7d7d'); p.rect(4, 8, 8, 6, '#1c1c1c'); p.rect(5, 9, 6, 4, '#3a2a12'); p.rect(3, 2, 10, 3, '#5c5c5c'); });
def('furnace_side', p => { noisy(p, '#7d7d7d'); p.rectO(0, 0, 16, 16, '#5c5c5c'); });
def('chest_front', p => { noisy(p, '#9a6b2f', 0.9, 1.05); p.rectO(0, 0, 16, 16, '#5c3d16'); p.rect(0, 7, 16, 1, '#5c3d16'); p.rect(7, 5, 2, 4, '#8f8f8f'); });
def('chest_side', p => { noisy(p, '#9a6b2f', 0.9, 1.05); p.rectO(0, 0, 16, 16, '#5c3d16'); p.rect(0, 7, 16, 1, '#5c3d16'); });
def('torch', p => { p.clearAll(); p.rect(7, 6, 2, 10, '#7a5b2b'); p.rect(7, 4, 2, 2, '#ffd83c'); p.rect(7, 3, 2, 1, '#ff9d2e'); });
def('snow', p => noisy(p, '#f2f6f6', 0.94, 1.03));
def('ice', p => { noisy(p, '#7fa8f4', 0.9, 1.1); specks(p, '#a8c8ff', 4, 2); });
def('cactus', p => { noisy(p, '#4c7a2a', 0.85, 1.1); p.rect(0, 0, 1, 16, '#31541a'); p.rect(15, 0, 1, 16, '#31541a'); for (let i = 0; i < 5; i++) p.set(2 + (p.rnd() * 12) | 0, (p.rnd() * 16) | 0, '#dfe8ba'); });
def('deadbush', p => { p.clearAll(); for (let i = 0; i < 7; i++) { let x = 8, y = 15; const dx = p.rnd() < 0.5 ? -1 : 1; for (let s = 0; s < 8; s++) { p.set(x, y, '#7a5b2b'); y--; if (p.rnd() < 0.4) x += dx; } } });
def('tallgrass', p => { p.clearAll(); for (let i = 0; i < 9; i++) { const x = 2 + (p.rnd() * 12) | 0, h = 6 + (p.rnd() * 8) | 0; p.rect(x, 16 - h, 1, h, shade('#5fae3c', 0.7 + p.rnd() * 0.5)); } });
def('flower', p => { p.clearAll(); p.rect(7, 8, 2, 8, '#3d7a24'); const c = p.rnd() < 0.5 ? '#e8c23c' : '#d94040'; p.rect(5, 3, 6, 5, c); p.rect(6, 2, 4, 7, c); p.rect(7, 4, 2, 2, '#5c3d16'); });
for (let s = 0; s < 8; s++) def('wheat' + s, p => {
  p.clearAll();
  const h = 3 + s * 1.6 | 0, col = s >= 7 ? '#c8a743' : (s >= 5 ? '#8aa03c' : '#3d9e3c');
  for (let i = 0; i < 8; i++) { const x = 1 + i * 2; p.rect(x, 16 - h, 1, h, shade(col, 0.8 + p.rnd() * 0.4)); if (s >= 5) p.rect(x - 1, 16 - h, 3, 2, shade('#c8a743', 0.9)); }
});
def('farmland_dry', p => { noisy(p, '#8a6038', 0.75, 1); for (let y = 0; y < 16; y += 4) p.rect(0, y, 16, 1, '#6a4826'); });
def('farmland_wet', p => { noisy(p, '#54381e', 0.75, 1); for (let y = 0; y < 16; y += 4) p.rect(0, y, 16, 1, '#3d2814'); });
def('obsidian', p => { noisy(p, '#15101f', 0.7, 1.3); specks(p, '#3d2a5c', 4, 1); });
def('glass', p => { p.clearAll(); p.rectO(0, 0, 16, 16, '#d8ecee'); p.set(3, 3, '#fff'); p.set(4, 4, '#fff'); p.set(12, 11, '#d8ecee'); });
def('wool', p => { noisy(p, '#e8e8e8', 0.88, 1.02); });
def('bed_top', p => { p.rect(0, 0, 16, 16, '#8f1e1e'); p.rect(0, 0, 16, 5, '#e8e8e8'); p.rect(0, 5, 16, 1, '#6a1414'); });
def('door', p => { noisy(p, '#a3824a', 0.9, 1.05); p.rectO(0, 0, 16, 16, '#6b5327'); p.rect(2, 2, 5, 5, '#6b5327'); p.rect(9, 2, 5, 5, '#6b5327'); p.rect(2, 9, 5, 5, '#6b5327'); p.rect(9, 9, 5, 5, '#6b5327'); p.set(12, 8, '#333'); });
def('sapling', p => { p.clearAll(); p.rect(7, 9, 2, 7, '#6b5327'); p.rect(4, 3, 8, 7, '#3d7a24'); p.clear(4, 3, 2, 2); p.clear(10, 3, 2, 2); });
def('log_dark', p => { noisy(p, '#3c2c14', 0.85, 1.1); for (let x = 0; x < 16; x += 3) p.rect(x, 0, 1, 16, shade('#3c2c14', 0.7)); });
def('leaves_dark', p => { noisy(p, '#2a5c1a', 0.7, 1.2); for (let i = 0; i < 8; i++) p.clear((p.rnd() * 16) | 0, (p.rnd() * 16) | 0, 1, 1); });
def('water', p => { noisy(p, '#3657d8', 0.85, 1.1); });
def('lava', p => { noisy(p, '#d84a10', 0.8, 1.2); specks(p, '#ffc83c', 5, 2); });
def('path_top', p => { noisy(p, '#9c7c48', 0.88, 1.05); p.rectO(0, 0, 16, 16, '#7d6234'); specks(p, '#7d6234', 4, 1); });
def('hay', p => { noisy(p, '#c8a020', 0.85, 1.1); for (let y = 1; y < 16; y += 3) p.rect(0, y, 16, 1, shade('#c8a020', 0.6)); });
def('hay_top', p => { noisy(p, '#dcb038', 0.88, 1.05); for (let r = 2; r < 8; r += 2) { for (let a = 0; a < 30; a++) { const t = a / 30 * 6.28; p.set(8 + Math.cos(t) * r | 0, 8 + Math.sin(t) * r | 0, '#a8801c'); } } });
def('composter', p => { noisy(p, '#8a6038', 0.8, 1.05); p.rectO(1, 1, 14, 14, '#5c3d16'); p.rectO(2, 2, 12, 12, '#5c3d16'); p.rect(3, 10, 10, 4, '#3d7a24'); });
def('fletching_table', p => { noisy(p, '#a3824a', 0.9, 1.05); p.rect(1, 10, 14, 5, '#7d6234'); p.rect(2, 3, 5, 6, '#e8e4d4'); p.rect(2, 3, 5, 1, '#d61f1f'); p.rect(9, 3, 5, 6, '#e8e4d4'); });
def('blast_furnace', p => { noisy(p, '#5c6a72'); p.rect(3, 7, 10, 7, '#1c1c1c'); p.rect(4, 8, 8, 5, '#e8701c'); p.rect(2, 1, 12, 4, '#7d8a90'); });
def('brewing_stand', p => { p.clearAll(); p.rect(7, 1, 2, 9, '#3a3a3a'); p.rect(2, 10, 12, 2, '#5c5c5c'); p.rect(2, 12, 3, 4, '#7a5cae'); p.rect(11, 12, 3, 4, '#7a5cae'); p.rect(6, 12, 4, 4, '#3ea0c8'); });
def('lectern', p => { noisy(p, '#a3824a', 0.9, 1.05); p.rect(3, 9, 10, 6, '#7d6234'); p.rect(2, 3, 12, 6, '#e8e4d4'); p.rectO(2, 3, 12, 6, '#a08430'); p.rect(7, 3, 1, 6, '#a08430'); });

// ---- item tiles ------------------------------------------------------------
def('i_stick', p => { p.clearAll(); for (let i = 0; i < 10; i++) p.rect(3 + i, 12 - i, 2, 2, '#7a5b2b'); });
def('i_coal', p => { p.clearAll(); blob(p, '#2b2b2b', 5); });
def('i_raw_iron', p => { p.clearAll(); blob(p, '#c89678', 5); });
def('i_iron_ingot', p => { p.clearAll(); ingot(p, '#d8d8d8'); });
def('i_raw_gold', p => { p.clearAll(); blob(p, '#e8c23c', 5); });
def('i_gold_ingot', p => { p.clearAll(); ingot(p, '#f5d93c'); });
def('i_raw_copper', p => { p.clearAll(); blob(p, '#c06c43', 5); });
def('i_copper_ingot', p => { p.clearAll(); ingot(p, '#d87c4b'); });
def('i_diamond', p => { p.clearAll(); blob(p, '#4fdbd6', 5); p.set(6, 6, '#fff'); });
def('i_emerald', p => { p.clearAll(); blob(p, '#17c455', 4); });
def('i_lapis', p => { p.clearAll(); blob(p, '#2b4fc4', 4); });
def('i_redstone', p => { p.clearAll(); specks(p, '#d61f1f', 9, 2); });
def('i_wheat', p => { p.clearAll(); for (let i = 0; i < 4; i++) { const x = 3 + i * 3; p.rect(x, 4, 1, 11, '#a08430'); p.rect(x - 1, 2, 3, 5, '#c8a743'); } });
def('i_seeds', p => { p.clearAll(); specks(p, '#3d9e3c', 8, 1); });
def('i_bread', p => { p.clearAll(); p.rect(2, 6, 12, 5, '#b8863c'); p.rect(2, 5, 12, 2, '#d8a85c'); });
def('i_apple', p => { p.clearAll(); blob(p, '#d61f1f', 5); p.rect(7, 1, 2, 3, '#6b5327'); p.rect(9, 2, 2, 1, '#3d7a24'); });
def('i_pork_raw', p => { p.clearAll(); meat(p, '#f0a0a8', false); });
def('i_pork_cooked', p => { p.clearAll(); meat(p, '', true); });
def('i_beef_raw', p => { p.clearAll(); meat(p, '#c4383d', false); });
def('i_beef_cooked', p => { p.clearAll(); meat(p, '', true); });
def('i_chicken_raw', p => { p.clearAll(); meat(p, '#e8c8b0', false); });
def('i_chicken_cooked', p => { p.clearAll(); meat(p, '', true); });
def('i_mutton_raw', p => { p.clearAll(); meat(p, '#d4666a', false); });
def('i_mutton_cooked', p => { p.clearAll(); meat(p, '', true); });
def('i_leather', p => { p.clearAll(); p.rect(3, 4, 10, 9, '#a0562b'); p.rect(3, 4, 10, 2, '#c46f38'); });
def('i_feather', p => { p.clearAll(); for (let i = 0; i < 9; i++) { p.rect(4 + i, 13 - i, 2, 2, '#e8e8e8'); p.set(5 + i, 12 - i, '#b8b8b8'); } });
def('i_egg', p => { p.clearAll(); blob(p, '#e8dcc0', 4); });
def('i_bone', p => { p.clearAll(); for (let i = 0; i < 8; i++) p.rect(4 + i, 11 - i, 2, 2, '#e8e4d4'); p.rect(2, 11, 4, 4, '#e8e4d4'); p.rect(10, 2, 4, 4, '#e8e4d4'); });
def('i_bonemeal', p => { p.clearAll(); specks(p, '#e8e4d4', 9, 2); });
def('i_string', p => { p.clearAll(); for (let i = 0; i < 12; i++) p.set(2 + i, 8 + Math.sin(i) * 3 | 0, '#e8e8e8'); p.rect(2, 5, 1, 8, '#e8e8e8'); });
def('i_spidereye', p => { p.clearAll(); blob(p, '#8f1e3c', 4); p.rect(7, 7, 2, 2, '#fff'); });
def('i_gunpowder', p => { p.clearAll(); specks(p, '#5c5c5c', 9, 2); });
def('i_rottenflesh', p => { p.clearAll(); blob(p, '#8a5c30', 5); specks(p, '#5c7a30', 3, 2); });
def('i_bucket', p => { p.clearAll(); p.rect(4, 6, 8, 7, '#b8b8b8'); p.rect(3, 5, 10, 2, '#d8d8d8'); p.rect(4, 2, 8, 1, '#8f8f8f'); p.set(3, 3, '#8f8f8f'); p.set(12, 3, '#8f8f8f'); });
def('i_bucket_water', p => { p.clearAll(); p.rect(4, 6, 8, 7, '#b8b8b8'); p.rect(3, 5, 10, 2, '#3657d8'); p.rect(4, 2, 8, 1, '#8f8f8f'); });
def('i_bucket_lava', p => { p.clearAll(); p.rect(4, 6, 8, 7, '#b8b8b8'); p.rect(3, 5, 10, 2, '#d84a10'); p.rect(4, 2, 8, 1, '#8f8f8f'); });
def('i_shield', p => { p.clearAll(); p.rect(3, 2, 10, 9, '#7a5b2b'); p.rect(4, 11, 8, 2, '#7a5b2b'); p.rect(6, 13, 4, 1, '#7a5b2b'); p.rect(7, 2, 2, 11, '#b8b8b8'); });
def('i_bed', p => { p.clearAll(); p.rect(1, 8, 14, 4, '#8f1e1e'); p.rect(1, 7, 5, 2, '#e8e8e8'); p.rect(1, 12, 2, 3, '#6b5327'); p.rect(13, 12, 2, 3, '#6b5327'); });
def('i_door', p => { p.clearAll(); p.rect(4, 1, 8, 14, '#a3824a'); p.rectO(4, 1, 8, 14, '#6b5327'); p.set(10, 8, '#333'); });
def('i_arrow', p => { p.clearAll(); for (let i = 0; i < 10; i++) p.set(3 + i, 12 - i, '#7a5b2b'); p.rect(11, 2, 3, 3, '#b8b8b8'); p.rect(2, 11, 3, 3, '#e8e8e8'); });

const TOOL_MATS = ['#a3824a', '#8f8f8f', '#d8d8d8', '#4fdbd6'];
const TOOL_KINDS = ['pickaxe', 'axe', 'shovel', 'sword', 'hoe'];
for (let t = 0; t < 4; t++) for (const k of TOOL_KINDS)
  def(`t_${t}_${k}`, p => { p.clearAll(); toolIcon(p, k, TOOL_MATS[t]); });
for (let s = 0; s < 4; s++) def(`a_iron_${s}`, p => { p.clearAll(); armorIcon(p, s, '#d8d8d8'); });
for (let s = 0; s < 4; s++) def(`a_leather_${s}`, p => { p.clearAll(); armorIcon(p, s, '#a0562b'); });

// ---- build the atlas -------------------------------------------------------
function makePixelAPI(ctx, ox, oy, seed) {
  const rnd = mulberry32(seed * 7919 + 13);
  return {
    rnd,
    set(x, y, c) { if (x < 0 || y < 0 || x > 15 || y > 15) return; ctx.fillStyle = c; ctx.fillRect(ox + x, oy + y, 1, 1); },
    rect(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(ox + Math.max(0, x), oy + Math.max(0, y), Math.min(w, 16 - x), Math.min(h, 16 - y)); },
    rectO(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(ox + x, oy + y, w, 1); ctx.fillRect(ox + x, oy + y + h - 1, w, 1); ctx.fillRect(ox + x, oy + y, 1, h); ctx.fillRect(ox + x + w - 1, oy + y, 1, h); },
    clear(x, y, w, h) { ctx.clearRect(ox + x, oy + y, w, h); },
    clearAll() { ctx.clearRect(ox, oy, 16, 16); },
  };
}

export const atlasCanvas = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = TILE * ADIM;
  const ctx = c.getContext('2d');
  painters.forEach((fn, i) => {
    const ox = (i % ADIM) * TILE, oy = ((i / ADIM) | 0) * TILE;
    fn(makePixelAPI(ctx, ox, oy, i));
  });
  return c;
})();

// UV rect for a tile, slightly inset to avoid bleeding. v is flipped for GL.
export function tileUV(t) {
  const inset = 0.02 / ADIM;
  const u0 = (t % ADIM) / ADIM + inset, v1 = 1 - ((t / ADIM) | 0) / ADIM - inset;
  const u1 = u0 + 1 / ADIM - 2 * inset, v0 = v1 - 1 / ADIM + 2 * inset;
  return [u0, v0, u1, v1];
}

// Draw a tile into a 32x32 icon canvas, returns dataURL (cached).
const iconCache = new Map();
export function tileIcon(t) {
  if (iconCache.has(t)) return iconCache.get(t);
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(atlasCanvas, (t % ADIM) * TILE, ((t / ADIM) | 0) * TILE, TILE, TILE, 0, 0, 32, 32);
  const url = c.toDataURL();
  iconCache.set(t, url);
  return url;
}
