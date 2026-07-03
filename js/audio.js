// Tiny WebAudio synth for game feedback sounds.
let ctx = null;
function ac() {
  if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
let noiseBuf = null;
function noise() {
  const a = ac(); if (!a) return null;
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate * 0.4, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}
function tone(freq, dur, type = 'square', vol = 0.15, slide = 0) {
  const a = ac(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.value = freq;
  if (slide) o.frequency.linearRampToValueAtTime(freq + slide, a.currentTime + dur);
  g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
  o.connect(g); g.connect(a.destination);
  o.start(); o.stop(a.currentTime + dur);
}
function hiss(dur, vol = 0.12, freq = 1200) {
  const a = ac(); if (!a) return;
  const s = a.createBufferSource(); s.buffer = noise(); if (!s.buffer) return;
  const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq;
  const g = a.createGain();
  g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
  s.connect(f); f.connect(g); g.connect(a.destination);
  s.start(); s.stop(a.currentTime + dur);
}

export function sfx(name, pitch = 1) {
  switch (name) {
    case 'break': hiss(0.12, 0.18, 900 * pitch); break;
    case 'place': tone(180 * pitch, 0.08, 'square', 0.12); break;
    case 'step': hiss(0.05, 0.05, 700 * pitch); break;
    case 'hurt': tone(160, 0.15, 'sawtooth', 0.18, -60); break;
    case 'playerhurt': tone(120, 0.2, 'sawtooth', 0.22, -50); break;
    case 'death': tone(200, 0.5, 'sawtooth', 0.18, -160); break;
    case 'pop': tone(520, 0.07, 'sine', 0.14, 260); break;
    case 'xp': tone(900 + Math.random() * 500, 0.09, 'sine', 0.09, 200); break;
    case 'eat': hiss(0.09, 0.1, 500); tone(300, 0.06, 'square', 0.05); break;
    case 'click': tone(700, 0.03, 'square', 0.08); break;
    case 'explode': hiss(0.7, 0.4, 220); tone(60, 0.5, 'sine', 0.3, -30); break;
    case 'fuse': hiss(1.4, 0.12, 2400); break;
    case 'bow': tone(400, 0.1, 'sine', 0.1, 300); break;
    case 'thud': tone(140, 0.07, 'square', 0.1); break;
    case 'fizz': hiss(0.3, 0.15, 3000); break;
    case 'splash': hiss(0.25, 0.15, 1400); break;
    case 'levelup': tone(660, 0.12, 'sine', 0.14); setTimeout(() => tone(990, 0.2, 'sine', 0.14), 110); break;
    case 'door': tone(240, 0.08, 'square', 0.1, -60); break;
    case 'furnace': hiss(0.15, 0.06, 400); break;
    case 'thunder': hiss(1.5, 0.35, 150); tone(50, 1.2, 'sine', 0.25, -20); break;
    case 'toolbreak': tone(300, 0.15, 'square', 0.15, -200); break;
    case 'shield': tone(220, 0.1, 'triangle', 0.15); break;
  }
}
