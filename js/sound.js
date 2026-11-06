// Ses efektleri: Web Audio ile anlık sentezlenir (dosya yok, çevrimdışı çalışır).
// iOS: AudioContext ancak bir kullanıcı dokunuşu sırasında başlatılabilir; unlock() her dokunuşta çağrılır.
// Not: iPhone sessiz moddayken (yan anahtar) Web Audio sesleri duyulmaz.

let ctx = null;
let master = null;
let primed = false;

export function isEnabled() {
  try { return localStorage.getItem('sound') !== 'off'; } catch { return true; }
}
export function setEnabled(on) {
  try { localStorage.setItem('sound', on ? 'on' : 'off'); } catch { /* yok */ }
}

function getCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp).connect(ctx.destination);
  return ctx;
}

/** Kullanıcı dokunuşu içinde çağrılmalı. */
export function unlock() {
  if (!isEnabled()) return;
  const c = getCtx();
  if (!c) return;
  if (c.state !== 'running') c.resume().catch(() => {});
  if (!primed) {
    const s = c.createBufferSource();
    s.buffer = c.createBuffer(1, 1, 22050);
    s.connect(c.destination);
    s.start(0);
    primed = true;
  }
}

function env(g, t, peak, attack, decay) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function osc(c, t, { freq, toFreq, type = 'sine', peak, attack = 0.004, decay }) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (toFreq) o.frequency.exponentialRampToValueAtTime(toFreq, t + attack + decay);
  env(g, t, peak, attack, decay);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + attack + decay + 0.05);
}

let noiseBuf = null;
function noise(c, t, { dur, peak, freq, toFreq, q = 1.2, type = 'bandpass' }) {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 0.6, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (toFreq) f.frequency.exponentialRampToValueAtTime(toFreq, t + dur);
  const g = c.createGain();
  env(g, t, peak, 0.01, dur);
  s.connect(f).connect(g).connect(master);
  s.start(t);
  s.stop(t + dur + 0.05);
}

// Çan benzeri metalik ton: harmonik olmayan kısmi frekanslar.
function bell(c, t, f, peak) {
  const partials = [[1, 1, 0.9], [2.76, 0.35, 0.45], [5.4, 0.16, 0.25], [8.93, 0.08, 0.14]];
  for (const [mul, amp, dec] of partials) osc(c, t, { freq: f * mul, peak: peak * amp, decay: dec });
}

/** Para girişi: yazar kasa "dırınk" — kısa mekanik tık + iki parlak çan notası. */
export function playIncome() {
  if (!isEnabled()) return;
  const c = getCtx();
  if (!c) return;
  const t = c.currentTime + 0.02;
  noise(c, t, { dur: 0.05, peak: 0.35, freq: 3500, q: 2 });
  osc(c, t, { freq: 180, toFreq: 90, type: 'triangle', peak: 0.25, decay: 0.07 });
  bell(c, t + 0.06, 1318.5, 0.32);  // Mi6
  bell(c, t + 0.15, 1975.5, 0.36);  // Si6
  noise(c, t + 0.15, { dur: 0.5, peak: 0.05, freq: 7000, q: 0.8, type: 'highpass' }); // parıltı
}

/** Para çıkışı: hızlı "vıııt" süzülmesi + alçalan kısa ton. */
export function playExpense() {
  if (!isEnabled()) return;
  const c = getCtx();
  if (!c) return;
  const t = c.currentTime + 0.02;
  noise(c, t, { dur: 0.28, peak: 0.4, freq: 2600, toFreq: 350, q: 1.4 });
  osc(c, t + 0.02, { freq: 740, toFreq: 300, type: 'triangle', peak: 0.28, attack: 0.01, decay: 0.22 });
  osc(c, t + 0.02, { freq: 370, toFreq: 150, type: 'sine', peak: 0.18, attack: 0.01, decay: 0.25 });
}
