// HUD + inventory / crafting / furnace / chest / trade screens.
import { B, I, itemInfo, matchRecipe, maxStack, TRADES } from './blocks.js';
import { tileIcon } from './atlas.js';
import { sfx } from './audio.js';

const PROFESSION_NAMES = { farmer: 'Farmer', fletcher: 'Fletcher', cleric: 'Cleric', armorer: 'Armorer', librarian: 'Librarian' };

const $ = id => document.getElementById(id);

export class UI {
  constructor(player, world) {
    this.player = player; this.world = world;
    this.open = null;
    this.cursor = null;
    this.craft = Array(9).fill(null); this.craftW = 2;
    this.chestItems = null; this.furnace = null;
    this.msgTimer = null;
    // hotbar DOM
    const hb = $('hotbar'); hb.innerHTML = '';
    this.hotEls = [];
    for (let i = 0; i < 9; i++) {
      const d = document.createElement('div');
      d.className = 'hslot';
      hb.appendChild(d);
      this.hotEls.push(d);
      const idx = i;
      this.attachTip(d, () => player.inv[idx]);
    }
    this.mouseX = 0; this.mouseY = 0;
    document.addEventListener('mousemove', e => {
      this.mouseX = e.clientX; this.mouseY = e.clientY;
      const c = $('cursoritem');
      c.style.left = (e.clientX - 20) + 'px';
      c.style.top = (e.clientY - 20) + 'px';
      if (this.tipShown) this.positionTip();
    });
  }

  // hover tooltip: shows the item's display name (e.g. "Coal") near the cursor
  attachTip(el, getStack) {
    el.addEventListener('mouseenter', () => {
      const s = getStack();
      if (!s) return;
      const info = itemInfo[s.id];
      if (!info) return;
      const tip = $('tooltip');
      tip.textContent = info.name;
      tip.style.display = 'block';
      this.tipShown = true;
      this.positionTip();
    });
    el.addEventListener('mouseleave', () => this.hideTip());
  }
  positionTip() {
    const tip = $('tooltip');
    tip.style.left = (this.mouseX + 16) + 'px';
    tip.style.top = (this.mouseY + 16) + 'px';
  }
  hideTip() {
    $('tooltip').style.display = 'none';
    this.tipShown = false;
  }

  msg(text) {
    const el = $('hudmsg');
    el.textContent = text; el.style.opacity = 1;
    clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => el.style.opacity = 0, 1800);
  }

  stackHTML(s) {
    if (!s) return '';
    const info = itemInfo[s.id];
    if (!info) return '';
    let html = `<img class="slotimg" src="${tileIcon(info.tile)}" draggable="false">`;
    if (s.n > 1) html += `<span class="slotn">${s.n}</span>`;
    const cap = info.tool?.dur ?? info.armor?.dur ?? info.dur;
    if (cap && s.dur !== undefined && s.dur < cap)
      html += `<div class="slotdur"><div style="width:${(s.dur / cap * 100) | 0}%"></div></div>`;
    return html;
  }

  updateHUD() {
    const p = this.player;
    const heart = (i) => {
      const v = p.hp - i * 2;
      return `<span style="opacity:${v >= 2 ? 1 : v >= 1 ? 0.55 : 0.15}">❤</span>`;
    };
    const shank = (i) => {
      const v = p.hunger - i * 2;
      return `<span style="opacity:${v >= 2 ? 1 : v >= 1 ? 0.55 : 0.15}">🍖</span>`;
    };
    let h = ''; for (let i = 0; i < 10; i++) h += heart(i);
    $('hearts').innerHTML = h;
    let f = ''; for (let i = 9; i >= 0; i--) f += shank(i);
    $('hunger').innerHTML = f;
    $('bubbles').textContent = p.headInWater || p.air < 300 ? '●'.repeat(Math.max(0, Math.ceil(p.air / 30))) : '';
    $('xpfill').style.width = (p.xp / p.xpNeed() * 100) + '%';
    $('xplevel').textContent = p.level > 0 ? p.level : '';
    for (let i = 0; i < 9; i++) {
      this.hotEls[i].className = 'hslot' + (i === p.sel ? ' sel' : '');
      this.hotEls[i].innerHTML = this.stackHTML(p.inv[i]);
    }
  }

  selectHotbar(i) {
    this.player.sel = i;
    const s = this.player.inv[i];
    if (s) this.msg(itemInfo[s.id]?.name ?? '');
  }

  // ---------- screens ----------
  isOpen() { return this.open !== null; }

  openScreen(mode, extra) {
    this.open = mode;
    this.chestItems = null; this.furnace = null; this.tradeVillager = null;
    this.craftW = mode === 'table' ? 3 : 2;
    this.craft = Array(9).fill(null);
    if (mode === 'chest') this.chestItems = extra;
    if (mode === 'furnace') this.furnace = extra;
    if (mode === 'trade') this.tradeVillager = extra;
    $('invtitle').textContent = mode === 'table' ? 'Crafting' : mode === 'furnace' ? 'Furnace' : mode === 'chest' ? 'Chest' :
      mode === 'trade' ? (PROFESSION_NAMES[extra.profession] ?? 'Villager') : 'Inventory';
    $('invscreen').classList.remove('hidden');
    document.exitPointerLock?.();
    this.render();
  }

  closeScreen() {
    // return crafting grid contents
    for (let i = 0; i < 9; i++) {
      if (this.craft[i]) {
        const left = this.player.addStack(this.craft[i]);
        if (left > 0 && this.world.dropItem)
          this.world.dropItem(this.player.pos.x, this.player.pos.y + 1, this.player.pos.z, { ...this.craft[i], n: left });
        this.craft[i] = null;
      }
    }
    if (this.cursor) {
      const left = this.player.addStack(this.cursor);
      if (left > 0 && this.world.dropItem)
        this.world.dropItem(this.player.pos.x, this.player.pos.y + 1, this.player.pos.z, { ...this.cursor, n: left });
      this.cursor = null;
    }
    this.open = null;
    $('invscreen').classList.add('hidden');
    $('cursoritem').style.display = 'none';
    this.hideTip();
  }

  // slot accessor helpers
  acc(arr, i) {
    return { get: () => arr[i], set: v => arr[i] = v };
  }

  makeSlot(accessor, opts = {}) {
    const d = document.createElement('div');
    d.className = 'slot' + (opts.result ? ' result' : '');
    d.innerHTML = this.stackHTML(accessor.get());
    d.addEventListener('mousedown', e => {
      e.preventDefault();
      if (opts.result) this.takeResult(e.shiftKey);
      else if (e.shiftKey && e.button === 0) this.shiftMove(accessor, opts);
      else if (e.button === 0) this.leftClick(accessor, opts);
      else if (e.button === 2) this.rightClick(accessor, opts);
      sfx('click');
      this.render();
    });
    d.addEventListener('contextmenu', e => e.preventDefault());
    this.attachTip(d, () => accessor.get());
    return d;
  }

  accepts(opts, stack) {
    if (!stack) return true;
    if (opts.armorSlot !== undefined) return itemInfo[stack.id]?.armor?.slot === opts.armorSlot;
    if (opts.fuelOnly) return true;
    return true;
  }

  leftClick(a, opts) {
    const s = a.get();
    if (this.cursor && !this.accepts(opts, this.cursor)) return;
    if (!this.cursor) { a.set(null); this.cursor = s; }
    else if (!s) {
      if (opts.armorSlot !== undefined || maxStack(this.cursor.id) === 1) {
        a.set(this.cursor); this.cursor = null;
      } else { a.set(this.cursor); this.cursor = null; }
    } else if (s.id === this.cursor.id && s.dur === undefined && this.cursor.dur === undefined) {
      const max = maxStack(s.id), take = Math.min(max - s.n, this.cursor.n);
      s.n += take; this.cursor.n -= take;
      if (this.cursor.n <= 0) this.cursor = null;
    } else { a.set(this.cursor); this.cursor = s; }
  }

  rightClick(a, opts) {
    const s = a.get();
    if (!this.cursor && s) {
      const half = Math.ceil(s.n / 2);
      this.cursor = { ...s, n: half };
      s.n -= half;
      if (s.n <= 0) a.set(null);
    } else if (this.cursor && this.accepts(opts, this.cursor)) {
      if (!s) {
        a.set({ ...this.cursor, n: 1 });
        this.cursor.n--; if (this.cursor.n <= 0) this.cursor = null;
      } else if (s.id === this.cursor.id && s.n < maxStack(s.id) && s.dur === undefined) {
        s.n++; this.cursor.n--; if (this.cursor.n <= 0) this.cursor = null;
      }
    }
  }

  shiftMove(a, opts) {
    const s = a.get();
    if (!s) return;
    if (opts.zone === 'ext') {           // chest/furnace/craft -> inventory
      const left = this.player.addStack(s);
      a.set(left > 0 ? { ...s, n: left } : null);
    } else {                              // inventory -> open container / armor
      if (this.open === 'chest' && this.chestItems) {
        const left = this.addToArray(this.chestItems, s);
        a.set(left > 0 ? { ...s, n: left } : null);
      } else if (this.open === 'furnace' && this.furnace) {
        const f = this.furnace;
        // put smeltables in input, fuels in fuel slot
        const slot = (s.id in SMELT_KEYS) ? 0 : 1;
        if (!f.items[slot]) { f.items[slot] = s; a.set(null); }
        else if (f.items[slot].id === s.id) {
          const max = maxStack(s.id), take = Math.min(max - f.items[slot].n, s.n);
          f.items[slot].n += take; s.n -= take;
          if (s.n <= 0) a.set(null);
        }
      } else {
        const armor = itemInfo[s.id]?.armor;
        if (armor && !this.player.armor[armor.slot]) {
          this.player.armor[armor.slot] = s; a.set(null);
        } else {
          // hotbar <-> main swap zones
          const idx = this.player.inv.indexOf(s);
          const targetRange = idx < 9 ? [9, 36] : [0, 9];
          for (let i = targetRange[0]; i < targetRange[1]; i++) {
            if (!this.player.inv[i]) { this.player.inv[i] = s; a.set(null); break; }
          }
        }
      }
    }
  }

  addToArray(arr, s) {
    let n = s.n;
    const max = maxStack(s.id);
    for (let i = 0; i < arr.length && n > 0; i++) {
      if (arr[i] && arr[i].id === s.id && arr[i].dur === undefined && arr[i].n < max) {
        const take = Math.min(max - arr[i].n, n); arr[i].n += take; n -= take;
      }
    }
    for (let i = 0; i < arr.length && n > 0; i++) {
      if (!arr[i]) { arr[i] = { ...s, n: Math.min(max, n) }; n -= arr[i].n; }
    }
    return n;
  }

  currentRecipe() {
    const w = this.craftW;
    const cells = [];
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) cells.push(this.craft[y * 3 + x]);
    return matchRecipe(cells, w);
  }

  takeResult(shift) {
    const doOnce = () => {
      const r = this.currentRecipe();
      if (!r) return false;
      const out = { id: r.out.id, n: r.out.n };
      if (shift) {
        if (this.player.addStack(out) > 0) return false;
      } else {
        if (!this.cursor) this.cursor = out;
        else if (this.cursor.id === out.id && this.cursor.n + out.n <= maxStack(out.id)) this.cursor.n += out.n;
        else return false;
      }
      for (let i = 0; i < 9; i++) {
        if (this.craft[i]) { this.craft[i].n--; if (this.craft[i].n <= 0) this.craft[i] = null; }
      }
      sfx('pop');
      return true;
    };
    if (shift) { let guard = 0; while (doOnce() && ++guard < 64); }
    else doOnce();
  }

  renderTrade() {
    const p = this.player;
    const villager = this.tradeVillager;
    const wrap = document.createElement('div');
    wrap.id = 'tradewrap';
    const emeraldRow = document.createElement('div');
    emeraldRow.id = 'tradeemeralds';
    emeraldRow.innerHTML = `<img src="${tileIcon(itemInfo[I.EMERALD].tile)}"><span>${p.countItem(I.EMERALD)} Emeralds</span>`;
    wrap.appendChild(emeraldRow);
    const list = TRADES[villager?.profession] ?? [];
    if (list.length === 0) {
      const none = document.createElement('div');
      none.className = 'traderow-empty';
      none.textContent = 'This villager has no job and nothing to trade.';
      wrap.appendChild(none);
      return wrap;
    }
    list.forEach((t, idx) => {
      const row = document.createElement('div');
      row.className = 'traderow';
      const giveInfo = itemInfo[t.give.id], getInfo = itemInfo[t.get.id];
      const have = p.countItem(t.give.id);
      const canAfford = have >= t.give.n;
      row.innerHTML = `
        <div class="tradeitem"><img src="${tileIcon(giveInfo.tile)}"><span>${t.give.n}</span></div>
        <div class="tradearrow">→</div>
        <div class="tradeitem"><img src="${tileIcon(getInfo.tile)}"><span>${t.get.n}</span></div>
        <button class="tradebtn" ${canAfford ? '' : 'disabled'}>${canAfford ? 'Trade' : `Need ${t.give.n - have} more`}</button>`;
      row.querySelector('.tradebtn').addEventListener('click', () => { this.doTrade(idx); });
      wrap.appendChild(row);
    });
    return wrap;
  }

  doTrade(idx) {
    const p = this.player, villager = this.tradeVillager;
    const t = (TRADES[villager?.profession] ?? [])[idx];
    if (!t) return;
    if (p.countItem(t.give.id) < t.give.n) return;
    p.removeItem(t.give.id, t.give.n);
    const left = p.addStack({ id: t.get.id, n: t.get.n });
    if (left > 0 && this.world.dropItem)
      this.world.dropItem(p.pos.x, p.pos.y + 1, p.pos.z, { id: t.get.id, n: left });
    sfx('pop');
    this.render();
  }

  furnaceSignature() {
    const f = this.furnace;
    return f ? f.items.map(s => s ? s.id + ':' + s.n : '_').join(',') : '';
  }

  // Called every tick while a furnace is open. A full render() rebuilds every
  // slot's DOM node from scratch, which — done 20x/second — kept destroying
  // the slot under the cursor before its mouseenter could refire, making the
  // hover tooltip flash on and off. Slot contents only actually change a few
  // times a minute (fuel consumed, item smelted), so only rebuild when that
  // signature changes; otherwise just nudge the two progress bar widths.
  updateFurnaceBars() {
    if (this.open !== 'furnace' || !this.furnace) return;
    const sig = this.furnaceSignature();
    if (sig !== this.furnaceSig) { this.render(); return; }
    const f = this.furnace;
    const burnBar = $('furnburn')?.firstElementChild;
    if (burnBar) burnBar.style.width = (f.burnMax ? (f.burn / f.burnMax * 100) | 0 : 0) + '%';
    const cookBar = $('furncook')?.firstElementChild;
    if (cookBar) cookBar.style.width = ((f.cook || 0) / 200 * 100 | 0) + '%';
  }

  render() {
    if (!this.open) return;
    this.hideTip(); // slot DOM nodes are about to be replaced; avoid a stale tooltip
    const p = this.player;
    const top = $('topzone');
    top.innerHTML = '';
    if (this.open === 'inv' || this.open === 'table') {
      const w = this.craftW;
      const wrap = document.createElement('div');
      wrap.className = 'rowflex';
      if (this.open === 'inv') {
        const ag = document.createElement('div');
        ag.className = 'grid'; ag.style.gridTemplateColumns = '44px';
        for (let s = 0; s < 4; s++) ag.appendChild(this.makeSlot(this.acc(p.armor, s), { armorSlot: s }));
        wrap.appendChild(ag);
        const og = document.createElement('div');
        og.className = 'grid'; og.style.gridTemplateColumns = '44px'; og.style.margin = '0 10px';
        og.appendChild(this.makeSlot({ get: () => p.off, set: v => p.off = v }, {}));
        const lbl = document.createElement('div'); lbl.style.fontSize = '10px'; lbl.textContent = 'off-hand';
        og.appendChild(lbl);
        wrap.appendChild(og);
      }
      const cg = document.createElement('div');
      cg.className = 'grid';
      cg.style.gridTemplateColumns = `repeat(${w},44px)`;
      for (let y = 0; y < w; y++) for (let x = 0; x < w; x++)
        cg.appendChild(this.makeSlot(this.acc(this.craft, y * 3 + x), { zone: 'ext' }));
      wrap.appendChild(cg);
      const arrow = document.createElement('div'); arrow.id = 'craftarrow'; arrow.textContent = '→';
      wrap.appendChild(arrow);
      const r = this.currentRecipe();
      const res = this.makeSlot({ get: () => r ? { id: r.out.id, n: r.out.n } : null, set: () => {} }, { result: true });
      wrap.appendChild(res);
      top.appendChild(wrap);
    } else if (this.open === 'furnace') {
      const f = this.furnace;
      const row = document.createElement('div'); row.id = 'furnrow';
      const col = document.createElement('div'); col.id = 'furncol';
      col.appendChild(this.makeSlot(this.acc(f.items, 0), { zone: 'ext' }));
      const burn = document.createElement('div'); burn.className = 'fprog'; burn.id = 'furnburn';
      burn.innerHTML = `<div style="width:${f.burnMax ? (f.burn / f.burnMax * 100) | 0 : 0}%;background:#e83c1c"></div>`;
      col.appendChild(burn);
      col.appendChild(this.makeSlot(this.acc(f.items, 1), { zone: 'ext' }));
      row.appendChild(col);
      const cook = document.createElement('div'); cook.className = 'fprog'; cook.id = 'furncook';
      cook.innerHTML = `<div style="width:${((f.cook || 0) / 200 * 100) | 0}%"></div>`;
      row.appendChild(cook);
      row.appendChild(this.makeSlot(this.acc(f.items, 2), { zone: 'ext', output: true }));
      top.appendChild(row);
      this.furnaceSig = this.furnaceSignature();
    } else if (this.open === 'chest') {
      const g = document.createElement('div');
      g.className = 'grid'; g.style.gridTemplateColumns = 'repeat(9,44px)';
      for (let i = 0; i < 27; i++) g.appendChild(this.makeSlot(this.acc(this.chestItems, i), { zone: 'ext' }));
      top.appendChild(g);
    } else if (this.open === 'trade') {
      top.appendChild(this.renderTrade());
    }
    const mg = $('maingrid'); mg.innerHTML = '';
    for (let i = 9; i < 36; i++) mg.appendChild(this.makeSlot(this.acc(p.inv, i), {}));
    const hg = $('hotgrid'); hg.innerHTML = '';
    for (let i = 0; i < 9; i++) hg.appendChild(this.makeSlot(this.acc(p.inv, i), {}));
    // cursor
    const c = $('cursoritem');
    if (this.cursor) {
      c.style.display = 'block';
      c.querySelector('img').src = tileIcon(itemInfo[this.cursor.id].tile);
      c.querySelector('span').textContent = this.cursor.n > 1 ? this.cursor.n : '';
    } else c.style.display = 'none';
    this.updateHUD();
  }
}

// smeltable ids for shift-click routing
import { SMELT } from './blocks.js';
const SMELT_KEYS = SMELT;
