// Block & item registry, recipes, smelting — 1.18 rules.
import { TILES } from './atlas.js';

export const B = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, DEEPSLATE: 4, BEDROCK: 5, SAND: 6, GRAVEL: 7,
  WATER: 8, LAVA: 9, LOG_OAK: 10, LEAF_OAK: 11, LOG_BIRCH: 12, LEAF_BIRCH: 13,
  LOG_SPRUCE: 14, LEAF_SPRUCE: 15, PLANKS: 16, COBBLE: 17,
  ORE_COAL: 18, ORE_COPPER: 19, ORE_IRON: 20, ORE_GOLD: 21, ORE_LAPIS: 22,
  ORE_REDSTONE: 23, ORE_DIAMOND: 24, ORE_EMERALD: 25,
  CRAFTING: 26, FURNACE: 27, CHEST: 28, TORCH: 29, SNOW: 30, ICE: 31, CACTUS: 32,
  DEADBUSH: 33, TALLGRASS: 34, FLOWER: 35, WHEAT: 36, FARMLAND: 37, FARMLAND_WET: 38,
  OBSIDIAN: 39, GLASS: 40, WOOL: 41, BED: 42, DOOR: 43, DOOR_OPEN: 44, SAPLING: 45,
  LOG_DARK: 46, LEAF_DARK: 47,
  PATH: 48, HAY: 49, COMPOSTER: 50, FLETCHING_TABLE: 51, BLAST_FURNACE: 52,
  BREWING_STAND: 53, LECTERN: 54,
};

export const I = {
  STICK: 100, COAL: 101, RAW_IRON: 102, IRON_INGOT: 103, RAW_GOLD: 104, GOLD_INGOT: 105,
  RAW_COPPER: 106, COPPER_INGOT: 107, DIAMOND: 108, EMERALD: 109, LAPIS: 110, REDSTONE: 111,
  WHEAT: 112, SEEDS: 113, BREAD: 114, APPLE: 115,
  PORK_RAW: 116, PORK_COOKED: 117, BEEF_RAW: 118, BEEF_COOKED: 119,
  CHICKEN_RAW: 120, CHICKEN_COOKED: 121, MUTTON_RAW: 122, MUTTON_COOKED: 123,
  LEATHER: 124, FEATHER: 125, EGG: 126, BONE: 127, BONEMEAL: 128, STRING: 129,
  SPIDER_EYE: 130, GUNPOWDER: 131, ROTTEN_FLESH: 132,
  BUCKET: 133, BUCKET_WATER: 134, BUCKET_LAVA: 135, ARROW: 136,
  BED_ITEM: 137, DOOR_ITEM: 138, SHIELD: 160,
  // tools: 140 + tier*5 + kind  (kind: 0 pick,1 axe,2 shovel,3 sword,4 hoe)
};
export const TIERS = ['wood', 'stone', 'iron', 'diamond'];
export const KINDS = ['pickaxe', 'axe', 'shovel', 'sword', 'hoe'];
export const toolId = (tier, kind) => 140 + tier * 5 + kind;
const ARMOR_BASE = { iron: 161, leather: 165, diamond: 169 };
export const armorId = (mat, slot) => ARMOR_BASE[mat] + slot; // slot 0-3 helm..boots

const T = TILES;
// blockInfo[id] = {name, hard, tool, tier, tiles:{top,side,bot}, kind, opaque, light, drop(rng)->[stacks]}
export const blockInfo = [];
function defB(id, name, o) {
  blockInfo[id] = Object.assign({
    name, hard: 1, tool: null, tier: 0, kind: 'cube', opaque: true, light: 0,
    tiles: null, drop: null, solid: true,
  }, o);
}
const tile3 = (top, side, bot) => ({ top, side: side ?? top, bot: bot ?? side ?? top });
const dropSelf = id => () => [{ id, n: 1 }];

defB(B.AIR, 'Air', { opaque: false, solid: false, hard: 0 });
defB(B.GRASS, 'Grass Block', { hard: 0.6, tool: 'shovel', tiles: tile3(T.grass_top, T.grass_side, T.dirt), drop: () => [{ id: B.DIRT, n: 1 }] });
defB(B.DIRT, 'Dirt', { hard: 0.5, tool: 'shovel', tiles: tile3(T.dirt), drop: dropSelf(B.DIRT) });
defB(B.STONE, 'Stone', { hard: 1.5, tool: 'pickaxe', tier: 1, tiles: tile3(T.stone), drop: () => [{ id: B.COBBLE, n: 1 }] });
defB(B.DEEPSLATE, 'Deepslate', { hard: 3, tool: 'pickaxe', tier: 1, tiles: tile3(T.deepslate), drop: () => [{ id: B.COBBLE, n: 1 }] });
defB(B.BEDROCK, 'Bedrock', { hard: -1, tiles: tile3(T.bedrock) });
defB(B.SAND, 'Sand', { hard: 0.5, tool: 'shovel', tiles: tile3(T.sand), drop: dropSelf(B.SAND) });
defB(B.GRAVEL, 'Gravel', { hard: 0.6, tool: 'shovel', tiles: tile3(T.gravel), drop: dropSelf(B.GRAVEL) });
defB(B.WATER, 'Water', { opaque: false, solid: false, hard: -1, kind: 'fluid', tiles: tile3(T.water) });
defB(B.LAVA, 'Lava', { opaque: false, solid: false, hard: -1, kind: 'fluid', light: 15, tiles: tile3(T.lava) });
for (const [log, leaf, ls, ll, sap] of [
  [B.LOG_OAK, B.LEAF_OAK, T.log_oak, T.leaves_oak, 'Oak'],
  [B.LOG_BIRCH, B.LEAF_BIRCH, T.log_birch, T.leaves_birch, 'Birch'],
  [B.LOG_SPRUCE, B.LEAF_SPRUCE, T.log_spruce, T.leaves_spruce, 'Spruce'],
  [B.LOG_DARK, B.LEAF_DARK, T.log_dark, T.leaves_dark, 'Dark Oak'],
]) {
  defB(log, ll + ' Log', { hard: 2, tool: 'axe', tiles: tile3(T.log_top, ls, T.log_top), drop: dropSelf(log) });
  defB(leaf, ll + ' Leaves', { hard: 0.2, opaque: false, kind: 'leaves', tiles: tile3(ll === 'Oak' ? T.leaves_oak : ll === 'Birch' ? T.leaves_birch : ll === 'Spruce' ? T.leaves_spruce : T.leaves_dark), drop: (r) => {
    const out = [];
    if (r() < 0.08) out.push({ id: B.SAPLING, n: 1 });
    if ((leaf === B.LEAF_OAK || leaf === B.LEAF_DARK) && r() < 0.05) out.push({ id: I.APPLE, n: 1 });
    return out;
  } });
}
defB(B.PLANKS, 'Oak Planks', { hard: 2, tool: 'axe', tiles: tile3(T.planks), drop: dropSelf(B.PLANKS) });
defB(B.COBBLE, 'Cobblestone', { hard: 2, tool: 'pickaxe', tier: 1, tiles: tile3(T.cobble), drop: dropSelf(B.COBBLE) });
const ore = (id, name, tier, tile, drop, xp) =>
  defB(id, name, { hard: 3, tool: 'pickaxe', tier, tiles: tile3(tile), drop, xp });
ore(B.ORE_COAL, 'Coal Ore', 1, T.ore_coal, () => [{ id: I.COAL, n: 1 }], 1);
ore(B.ORE_COPPER, 'Copper Ore', 2, T.ore_copper, r => [{ id: I.RAW_COPPER, n: 2 + (r() * 2 | 0) }], 0);
ore(B.ORE_IRON, 'Iron Ore', 2, T.ore_iron, () => [{ id: I.RAW_IRON, n: 1 }], 0);
ore(B.ORE_GOLD, 'Gold Ore', 3, T.ore_gold, () => [{ id: I.RAW_GOLD, n: 1 }], 0);
ore(B.ORE_LAPIS, 'Lapis Ore', 2, T.ore_lapis, r => [{ id: I.LAPIS, n: 4 + (r() * 5 | 0) }], 3);
ore(B.ORE_REDSTONE, 'Redstone Ore', 3, T.ore_redstone, r => [{ id: I.REDSTONE, n: 4 + (r() * 2 | 0) }], 2);
ore(B.ORE_DIAMOND, 'Diamond Ore', 3, T.ore_diamond, () => [{ id: I.DIAMOND, n: 1 }], 5);
ore(B.ORE_EMERALD, 'Emerald Ore', 3, T.ore_emerald, () => [{ id: I.EMERALD, n: 1 }], 5);
defB(B.CRAFTING, 'Crafting Table', { hard: 2.5, tool: 'axe', tiles: tile3(T.crafting_top, T.crafting_side, T.planks), drop: dropSelf(B.CRAFTING) });
defB(B.FURNACE, 'Furnace', { hard: 3.5, tool: 'pickaxe', tier: 1, tiles: tile3(T.furnace_side, T.furnace_front, T.furnace_side), drop: dropSelf(B.FURNACE) });
defB(B.CHEST, 'Chest', { hard: 2.5, tool: 'axe', tiles: tile3(T.chest_side, T.chest_front, T.chest_side), drop: dropSelf(B.CHEST) });
defB(B.TORCH, 'Torch', { hard: 0, opaque: false, solid: false, kind: 'torch', light: 14, tiles: tile3(T.torch), drop: dropSelf(B.TORCH) });
defB(B.SNOW, 'Snow Block', { hard: 0.5, tool: 'shovel', tiles: tile3(T.snow), drop: dropSelf(B.SNOW) });
defB(B.ICE, 'Ice', { hard: 0.5, tool: 'pickaxe', opaque: false, tiles: tile3(T.ice), drop: () => [] });
defB(B.CACTUS, 'Cactus', { hard: 0.4, opaque: false, tiles: tile3(T.cactus), drop: dropSelf(B.CACTUS) });
defB(B.DEADBUSH, 'Dead Bush', { hard: 0, opaque: false, solid: false, kind: 'cross', tiles: tile3(T.deadbush), drop: () => [{ id: I.STICK, n: 1 }] });
defB(B.TALLGRASS, 'Grass', { hard: 0, opaque: false, solid: false, kind: 'cross', tiles: tile3(T.tallgrass), drop: r => r() < 0.4 ? [{ id: I.SEEDS, n: 1 }] : [] });
defB(B.FLOWER, 'Flower', { hard: 0, opaque: false, solid: false, kind: 'cross', tiles: tile3(T.flower), drop: dropSelf(B.FLOWER) });
defB(B.WHEAT, 'Wheat Crop', { hard: 0, opaque: false, solid: false, kind: 'crop', tiles: tile3(T.wheat0), drop: () => [] });
defB(B.FARMLAND, 'Farmland', { hard: 0.6, tool: 'shovel', tiles: tile3(T.farmland_dry, T.dirt), drop: () => [{ id: B.DIRT, n: 1 }] });
defB(B.FARMLAND_WET, 'Farmland', { hard: 0.6, tool: 'shovel', tiles: tile3(T.farmland_wet, T.dirt), drop: () => [{ id: B.DIRT, n: 1 }] });
defB(B.OBSIDIAN, 'Obsidian', { hard: 50, tool: 'pickaxe', tier: 3, tiles: tile3(T.obsidian), drop: dropSelf(B.OBSIDIAN) });
defB(B.GLASS, 'Glass', { hard: 0.3, opaque: false, tiles: tile3(T.glass), drop: () => [] });
defB(B.WOOL, 'Wool', { hard: 0.8, tiles: tile3(T.wool), drop: dropSelf(B.WOOL) });
defB(B.BED, 'Bed', { hard: 0.2, opaque: false, solid: false, kind: 'bed', tiles: tile3(T.bed_top, T.wool), drop: () => [{ id: I.BED_ITEM, n: 1 }] });
defB(B.DOOR, 'Door', { hard: 3, tool: 'axe', opaque: false, kind: 'door', tiles: tile3(T.door), drop: () => [{ id: I.DOOR_ITEM, n: 1 }] });
defB(B.DOOR_OPEN, 'Door', { hard: 3, tool: 'axe', opaque: false, solid: false, kind: 'door', tiles: tile3(T.door), drop: () => [{ id: I.DOOR_ITEM, n: 1 }] });
defB(B.SAPLING, 'Sapling', { hard: 0, opaque: false, solid: false, kind: 'cross', tiles: tile3(T.sapling), drop: dropSelf(B.SAPLING) });
defB(B.PATH, 'Dirt Path', { hard: 0.5, tool: 'shovel', tiles: tile3(T.path_top, T.dirt), drop: () => [{ id: B.DIRT, n: 1 }] });
defB(B.HAY, 'Hay Bale', { hard: 0.5, tiles: tile3(T.hay_top, T.hay), drop: dropSelf(B.HAY) });
defB(B.COMPOSTER, 'Composter', { hard: 0.6, tool: 'axe', tiles: tile3(T.composter), drop: dropSelf(B.COMPOSTER) });
defB(B.FLETCHING_TABLE, 'Fletching Table', { hard: 2.5, tool: 'axe', tiles: tile3(T.fletching_table, T.fletching_table, T.planks), drop: dropSelf(B.FLETCHING_TABLE) });
defB(B.BLAST_FURNACE, 'Blast Furnace', { hard: 3.5, tool: 'pickaxe', tier: 1, tiles: tile3(T.blast_furnace), drop: dropSelf(B.BLAST_FURNACE) });
defB(B.BREWING_STAND, 'Brewing Stand', { hard: 0.5, tool: 'pickaxe', opaque: false, tiles: tile3(T.brewing_stand), drop: dropSelf(B.BREWING_STAND) });
defB(B.LECTERN, 'Lectern', { hard: 2.5, tool: 'axe', tiles: tile3(T.lectern), drop: dropSelf(B.LECTERN) });

// ---- items -----------------------------------------------------------------
// itemInfo[id] = {name, tile, stack, food:{h,sat}, tool:{kind,tier,dmg,dur,cd}, armor:{slot,pts,dur}, place}
export const itemInfo = {};
function defI(id, name, tile, o = {}) { itemInfo[id] = Object.assign({ name, tile, stack: 64 }, o); }
// block items share block ids
for (const [name, id] of Object.entries(B)) {
  if (id === 0 || id === B.WATER || id === B.LAVA || id === B.DOOR_OPEN) continue;
  const bi = blockInfo[id];
  defI(id, bi.name, bi.tiles ? (bi.kind === 'cube' || bi.kind === 'leaves' ? bi.tiles.side : bi.tiles.top) : 0, { place: id });
}
itemInfo[B.BED] && (itemInfo[B.BED].tile = TILES.i_bed);
defI(I.STICK, 'Stick', T.i_stick);
defI(I.COAL, 'Coal', T.i_coal);
defI(I.RAW_IRON, 'Raw Iron', T.i_raw_iron);
defI(I.IRON_INGOT, 'Iron Ingot', T.i_iron_ingot);
defI(I.RAW_GOLD, 'Raw Gold', T.i_raw_gold);
defI(I.GOLD_INGOT, 'Gold Ingot', T.i_gold_ingot);
defI(I.RAW_COPPER, 'Raw Copper', T.i_raw_copper);
defI(I.COPPER_INGOT, 'Copper Ingot', T.i_copper_ingot);
defI(I.DIAMOND, 'Diamond', T.i_diamond);
defI(I.EMERALD, 'Emerald', T.i_emerald);
defI(I.LAPIS, 'Lapis Lazuli', T.i_lapis);
defI(I.REDSTONE, 'Redstone Dust', T.i_redstone);
defI(I.WHEAT, 'Wheat', T.i_wheat);
defI(I.SEEDS, 'Wheat Seeds', T.i_seeds, { place: B.WHEAT });
defI(I.BREAD, 'Bread', T.i_bread, { food: { h: 5, sat: 6 } });
defI(I.APPLE, 'Apple', T.i_apple, { food: { h: 4, sat: 2.4 } });
defI(I.PORK_RAW, 'Raw Porkchop', T.i_pork_raw, { food: { h: 3, sat: 1.8 } });
defI(I.PORK_COOKED, 'Cooked Porkchop', T.i_pork_cooked, { food: { h: 8, sat: 12.8 } });
defI(I.BEEF_RAW, 'Raw Beef', T.i_beef_raw, { food: { h: 3, sat: 1.8 } });
defI(I.BEEF_COOKED, 'Steak', T.i_beef_cooked, { food: { h: 8, sat: 12.8 } });
defI(I.CHICKEN_RAW, 'Raw Chicken', T.i_chicken_raw, { food: { h: 2, sat: 1.2 } });
defI(I.CHICKEN_COOKED, 'Cooked Chicken', T.i_chicken_cooked, { food: { h: 6, sat: 7.2 } });
defI(I.MUTTON_RAW, 'Raw Mutton', T.i_mutton_raw, { food: { h: 2, sat: 1.2 } });
defI(I.MUTTON_COOKED, 'Cooked Mutton', T.i_mutton_cooked, { food: { h: 6, sat: 9.6 } });
defI(I.LEATHER, 'Leather', T.i_leather);
defI(I.FEATHER, 'Feather', T.i_feather);
defI(I.EGG, 'Egg', T.i_egg, { stack: 16 });
defI(I.BONE, 'Bone', T.i_bone);
defI(I.BONEMEAL, 'Bone Meal', T.i_bonemeal);
defI(I.STRING, 'String', T.i_string);
defI(I.SPIDER_EYE, 'Spider Eye', T.i_spidereye);
defI(I.GUNPOWDER, 'Gunpowder', T.i_gunpowder);
defI(I.ROTTEN_FLESH, 'Rotten Flesh', T.i_rottenflesh, { food: { h: 4, sat: 0.8 } });
defI(I.BUCKET, 'Bucket', T.i_bucket, { stack: 16 });
defI(I.BUCKET_WATER, 'Water Bucket', T.i_bucket_water, { stack: 1 });
defI(I.BUCKET_LAVA, 'Lava Bucket', T.i_bucket_lava, { stack: 1 });
defI(I.ARROW, 'Arrow', T.i_arrow);
defI(I.BED_ITEM, 'Bed', T.i_bed, { stack: 1, place: B.BED });
defI(I.DOOR_ITEM, 'Oak Door', T.i_door, { place: B.DOOR });
defI(I.SHIELD, 'Shield', T.i_shield, { stack: 1, shield: true, dur: 336 });

// stats verified against Java Edition's tool-tier and weapon tables (mining
// speed, durability, attack damage, attack-speed cooldowns).
const DUR = [59, 131, 250, 1561];
const SPEED = [2, 4, 6, 8];
const SWORD_DMG = [4, 5, 6, 7], AXE_DMG = [7, 9, 9, 9], PICK_DMG = [2, 3, 4, 5], SHOVEL_DMG = [2.5, 3.5, 4.5, 5.5];
const AXE_CD = [1.25, 1.25, 1.11, 1.0];
const HOE_CD = [1.0, 0.5, 1 / 3, 0.25]; // hoe attack speed 1/2/3/4 -> cooldown 20/speed ticks
for (let t = 0; t < 4; t++) {
  const cap = s => s[0].toUpperCase() + s.slice(1);
  const tn = cap(TIERS[t]) + ' ';
  defI(toolId(t, 0), tn + 'Pickaxe', T[`t_${t}_pickaxe`], { stack: 1, tool: { kind: 'pickaxe', tier: t + 1, dmg: PICK_DMG[t], dur: DUR[t], speed: SPEED[t], cd: 0.83 } });
  defI(toolId(t, 1), tn + 'Axe', T[`t_${t}_axe`], { stack: 1, tool: { kind: 'axe', tier: t + 1, dmg: AXE_DMG[t], dur: DUR[t], speed: SPEED[t], cd: AXE_CD[t] } });
  defI(toolId(t, 2), tn + 'Shovel', T[`t_${t}_shovel`], { stack: 1, tool: { kind: 'shovel', tier: t + 1, dmg: SHOVEL_DMG[t], dur: DUR[t], speed: SPEED[t], cd: 1.0 } });
  defI(toolId(t, 3), tn + 'Sword', T[`t_${t}_sword`], { stack: 1, tool: { kind: 'sword', tier: t + 1, dmg: SWORD_DMG[t], dur: DUR[t], speed: 1.5, cd: 0.625 } });
  // hoe attack damage is flat 1 regardless of material in vanilla — only
  // durability and attack-speed (recovery time) scale with tier
  defI(toolId(t, 4), tn + 'Hoe', T[`t_${t}_hoe`], { stack: 1, tool: { kind: 'hoe', tier: t + 1, dmg: 1, dur: DUR[t], speed: 1, cd: HOE_CD[t] } });
}
const ARMOR_NAMES = ['Helmet', 'Chestplate', 'Leggings', 'Boots'];
const IRON_PTS = [2, 6, 5, 2], LEATHER_PTS = [1, 3, 2, 1], DIAMOND_PTS = [3, 8, 6, 3];
// durability is per-slot (helmet/chest/legs/boots need different amounts of
// material and so take different damage before breaking), not a single flat
// number per material — chest > legs > boots > helmet, consistently
const IRON_DUR = [165, 240, 225, 195], LEATHER_DUR = [55, 80, 75, 65], DIAMOND_DUR = [363, 528, 495, 429];
for (let s = 0; s < 4; s++) {
  defI(armorId('iron', s), 'Iron ' + ARMOR_NAMES[s], T[`a_iron_${s}`], { stack: 1, armor: { slot: s, pts: IRON_PTS[s], dur: IRON_DUR[s] } });
  defI(armorId('leather', s), 'Leather ' + ARMOR_NAMES[s], T[`a_leather_${s}`], { stack: 1, armor: { slot: s, pts: LEATHER_PTS[s], dur: LEATHER_DUR[s] } });
  defI(armorId('diamond', s), 'Diamond ' + ARMOR_NAMES[s], T[`a_diamond_${s}`], { stack: 1, armor: { slot: s, pts: DIAMOND_PTS[s], dur: DIAMOND_DUR[s] } });
}

// ---- crafting --------------------------------------------------------------
// tokens: number = exact item id, 'LOG' group, 0 = empty
const LOGS = [B.LOG_OAK, B.LOG_BIRCH, B.LOG_SPRUCE, B.LOG_DARK];
const matchTok = (tok, id) => tok === 'LOG' ? LOGS.includes(id) : tok === id;

export const RECIPES = [];
function defR(grid, outId, outN = 1) { RECIPES.push({ grid, out: { id: outId, n: outN } }); }
defR([['LOG']], B.PLANKS, 4);
defR([[B.PLANKS], [B.PLANKS]], I.STICK, 4);
defR([[B.PLANKS, B.PLANKS], [B.PLANKS, B.PLANKS]], B.CRAFTING, 1);
defR([[B.COBBLE, B.COBBLE, B.COBBLE], [B.COBBLE, 0, B.COBBLE], [B.COBBLE, B.COBBLE, B.COBBLE]], B.FURNACE, 1);
defR([[B.PLANKS, B.PLANKS, B.PLANKS], [B.PLANKS, 0, B.PLANKS], [B.PLANKS, B.PLANKS, B.PLANKS]], B.CHEST, 1);
defR([[I.COAL], [I.STICK]], B.TORCH, 4);
defR([[I.IRON_INGOT, 0, I.IRON_INGOT], [0, I.IRON_INGOT, 0]], I.BUCKET, 1);
defR([[I.WHEAT, I.WHEAT, I.WHEAT]], I.BREAD, 1);
defR([[I.BONE]], I.BONEMEAL, 3);
defR([[B.WOOL, B.WOOL, B.WOOL], [B.PLANKS, B.PLANKS, B.PLANKS]], I.BED_ITEM, 1);
defR([[B.PLANKS, B.PLANKS], [B.PLANKS, B.PLANKS], [B.PLANKS, B.PLANKS]], I.DOOR_ITEM, 3);
defR([[B.PLANKS, I.IRON_INGOT, B.PLANKS], [B.PLANKS, B.PLANKS, B.PLANKS], [0, B.PLANKS, 0]], I.SHIELD, 1);
defR([[I.WHEAT, I.WHEAT, I.WHEAT], [I.WHEAT, I.WHEAT, I.WHEAT], [I.WHEAT, I.WHEAT, I.WHEAT]], B.HAY, 1);
defR([[B.HAY]], I.WHEAT, 9);
defR([[B.SAND]], B.GLASS, 0); // placeholder removed below
RECIPES.pop();
const MATS = [B.PLANKS, B.COBBLE, I.IRON_INGOT, I.DIAMOND];
for (let t = 0; t < 4; t++) {
  const M = MATS[t], S = I.STICK;
  defR([[M, M, M], [0, S, 0], [0, S, 0]], toolId(t, 0)); // pickaxe
  defR([[M, M], [M, S], [0, S]], toolId(t, 1));          // axe
  defR([[M], [S], [S]], toolId(t, 2));                    // shovel
  defR([[M], [M], [S]], toolId(t, 3));                    // sword
  defR([[M, M], [0, S], [0, S]], toolId(t, 4));           // hoe
}
for (const [mat, matId] of [['iron', I.IRON_INGOT], ['leather', I.LEATHER], ['diamond', I.DIAMOND]]) {
  const M = matId;
  defR([[M, M, M], [M, 0, M]], armorId(mat, 0));
  defR([[M, 0, M], [M, M, M], [M, M, M]], armorId(mat, 1));
  defR([[M, M, M], [M, 0, M], [M, 0, M]], armorId(mat, 2));
  defR([[M, 0, M], [M, 0, M]], armorId(mat, 3));
}

// Match a crafting grid (array of stacks, w*w). Returns recipe or null.
export function matchRecipe(cells, w) {
  // bounding box of non-empty cells
  let x0 = w, y0 = w, x1 = -1, y1 = -1;
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++)
    if (cells[y * w + x]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  if (x1 < 0) return null;
  const gw = x1 - x0 + 1, gh = y1 - y0 + 1;
  outer: for (const r of RECIPES) {
    const rh = r.grid.length, rw = Math.max(...r.grid.map(row => row.length));
    if (rw !== gw || rh !== gh) continue;
    for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
      const tok = r.grid[y][x] ?? 0;
      const cell = cells[(y0 + y) * w + (x0 + x)];
      if (tok === 0) { if (cell) continue outer; }
      else { if (!cell || !matchTok(tok, cell.id)) continue outer; }
    }
    return r;
  }
  return null;
}

// ---- smelting --------------------------------------------------------------
export const SMELT = {
  [I.RAW_IRON]: { id: I.IRON_INGOT, n: 1, xp: 1 },
  [I.RAW_GOLD]: { id: I.GOLD_INGOT, n: 1, xp: 1 },
  [I.RAW_COPPER]: { id: I.COPPER_INGOT, n: 1, xp: 1 },
  [I.PORK_RAW]: { id: I.PORK_COOKED, n: 1, xp: 1 },
  [I.BEEF_RAW]: { id: I.BEEF_COOKED, n: 1, xp: 1 },
  [I.CHICKEN_RAW]: { id: I.CHICKEN_COOKED, n: 1, xp: 1 },
  [I.MUTTON_RAW]: { id: I.MUTTON_COOKED, n: 1, xp: 1 },
  [B.COBBLE]: { id: B.STONE, n: 1, xp: 0 },
  [B.SAND]: { id: B.GLASS, n: 1, xp: 0 },
};
// fuel: number of items one unit smelts
export const FUEL = {
  [I.COAL]: 8, [B.PLANKS]: 1.5, [I.STICK]: 0.5,
  [B.LOG_OAK]: 1.5, [B.LOG_BIRCH]: 1.5, [B.LOG_SPRUCE]: 1.5, [B.LOG_DARK]: 1.5,
  [B.CRAFTING]: 1.5, [B.CHEST]: 1.5, [B.SAPLING]: 0.5,
};

export const maxStack = id => itemInfo[id]?.stack ?? 64;
export const isFood = id => !!itemInfo[id]?.food;
export const CROP_TILES = [T.wheat0, T.wheat1, T.wheat2, T.wheat3, T.wheat4, T.wheat5, T.wheat6, T.wheat7];

// ---- villager trades ---------------------------------------------------
// Librarian's real trade (paper/enchanted books) needs sugar cane + an
// enchanting system neither of which exist here, so it's substituted with
// bones/bone meal — noted as a deliberate simplification.
export const TRADES = {
  farmer: [
    { give: { id: I.WHEAT, n: 20 }, get: { id: I.EMERALD, n: 1 } },
    { give: { id: I.EMERALD, n: 1 }, get: { id: I.BREAD, n: 6 } },
  ],
  fletcher: [
    { give: { id: I.STICK, n: 32 }, get: { id: I.EMERALD, n: 1 } },
    { give: { id: I.EMERALD, n: 1 }, get: { id: I.ARROW, n: 16 } },
  ],
  cleric: [
    { give: { id: I.ROTTEN_FLESH, n: 32 }, get: { id: I.EMERALD, n: 1 } },
    { give: { id: I.EMERALD, n: 1 }, get: { id: I.REDSTONE, n: 6 } },
  ],
  armorer: [
    { give: { id: I.COAL, n: 15 }, get: { id: I.EMERALD, n: 1 } },
    { give: { id: I.EMERALD, n: 5 }, get: { id: armorId('iron', 0), n: 1 } },
    { give: { id: I.EMERALD, n: 6 }, get: { id: armorId('iron', 1), n: 1 } },
  ],
  librarian: [
    { give: { id: I.BONE, n: 5 }, get: { id: I.EMERALD, n: 1 } },
    { give: { id: I.EMERALD, n: 1 }, get: { id: I.BONEMEAL, n: 8 } },
  ],
};
