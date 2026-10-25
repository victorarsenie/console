// Synthesised machine cues. No samples, no files: everything is oscillators and noise,
// so tuning a cue is editing a number, not hunting an asset.
//
// Autoplay rules mean nothing sounds until the user interacts: `start()` is called from
// the first click/keypress. There is no drone - only short cues.
const MUTE_KEY = "muther.muted";

let ctx = null;
let master = null;
let muted = localStorage.getItem(MUTE_KEY) === "1";

function ensure() {
  if (ctx) return ctx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.22;
    master.connect(ctx.destination);
    return ctx;
  } catch (err) {
    ctx = null;
    return null;
  }
}

function noiseBuffer(seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function blip(freq = 880, ms = 45, type = "square", gain = 0.09, slide = 0) {
  if (!ensure() || muted) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), ctx.currentTime + ms / 1000);
  g.gain.setValueAtTime(gain, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms / 1000);
  osc.connect(g).connect(master);
  osc.start();
  osc.stop(ctx.currentTime + ms / 1000 + 0.02);
}


// A short band-passed noise burst: mechanical, not musical.
function tick(freq = 2200, ms = 18, gain = 0.05, q = 6) {
  if (!ensure() || muted) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(0.06);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms / 1000);
  src.connect(bp).connect(g).connect(master);
  src.start();
  src.stop(ctx.currentTime + ms / 1000 + 0.01);
}

export const cue = {
  key: () => { blip(1100 + Math.random() * 300, 26, "square", 0.14); tick(2400, 12, 0.05, 2); },
  bay: () => { blip(660, 60, "triangle", 0.08); setTimeout(() => blip(880, 70, "triangle", 0.07), 70); },
  ok: () => blip(990, 90, "sine", 0.1),
  alert: () => { blip(320, 140, "sawtooth", 0.1, -80); setTimeout(() => blip(220, 200, "sawtooth", 0.1, -60), 150); },
  // boot: a machine waking up - rising detuned pairs under a soft air swell
  boot: () => {
    if (!ensure() || muted) return;
    const swell = ctx.createBufferSource();
    swell.buffer = noiseBuffer(2);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(180, ctx.currentTime);
    lp.frequency.linearRampToValueAtTime(1800, ctx.currentTime + 1.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.13, ctx.currentTime + 0.5);
    g.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 2.0);
    swell.connect(lp).connect(g).connect(master);
    swell.start();
    swell.stop(ctx.currentTime + 2.1);
    [60, 72, 90, 120].forEach((f, i) => {
      setTimeout(() => {
        blip(f, 420, "sawtooth", 0.14);
        blip(f * 4, 260, "triangle", 0.05);
        tick(500 + i * 260, 120, 0.05, 2);
      }, i * 360);
    });
    setTimeout(() => blip(880, 180, "sine", 0.07), 1500);
  },
  // typewriter: a dry mechanical tick, quieter than a keystroke
  type: () => {
    typeFlip = !typeFlip;
    tick(typeFlip ? 1250 : 1620, 18, 0.14, 1.6);
  },
  // standby: the machine's slow sonar while it works - low ping, faint echo
  think: () => tick(380 + Math.random() * 120, 70, 0.09, 3),
};

export function start() {
  if (!ensure()) return;
  if (ctx.state !== "running") {
    ctx.resume().catch(() => {});
  }
  if (ctx.state !== "running") {
    const kick = () => { if (ctx) ctx.resume().catch(() => {}); };
    window.addEventListener("pointerdown", kick, { once: true });
    window.addEventListener("keydown", kick, { once: true });
  }
}


let standby = null;
let typeFlip = false;

export function standbyOn() {
  if (standby || !ensure() || muted) return;
  const g = ctx.createGain();
  g.gain.value = 0.0001;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 750;
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.value = 72;
  const osc2 = ctx.createOscillator();
  osc2.type = "triangle";
  osc2.frequency.value = 146;
  const g2 = ctx.createGain();
  g2.gain.value = 0.5;
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(2);
  noise.loop = true;
  const ng = ctx.createGain();
  ng.gain.value = 0.28;
  osc.connect(lp);
  osc2.connect(g2).connect(lp);
  noise.connect(ng).connect(lp);
  lp.connect(g).connect(master);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.6;
  const lg = ctx.createGain();
  lg.gain.value = 0.005;
  lfo.connect(lg).connect(g.gain);
  osc.start(); osc2.start(); noise.start(); lfo.start();
  g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.4);
  standby = { osc, osc2, noise, lfo, g };
}

export function standbyOff() {
  if (!standby) return;
  const s = standby;
  standby = null;
  try {
    s.g.gain.cancelScheduledValues(ctx.currentTime);
    s.g.gain.setValueAtTime(Math.max(s.g.gain.value, 0.0001), ctx.currentTime);
    s.g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    setTimeout(() => {
      try { s.osc.stop(); s.osc2.stop(); s.noise.stop(); s.lfo.stop(); } catch (err) {}
    }, 600);
  } catch (err) {}
}

export function audioState() {
  return { state: ctx ? ctx.state : "none", muted };
}

export function bootCue() {
  if (!ensure()) return;
  let fired = false;
  const fire = () => {
    if (fired) return;
    fired = true;
    setTimeout(() => cue.boot(), 150);
  };
  if (ctx.state === "running") { fire(); return; }
  ctx.resume().catch(() => {});
  let tries = 0;
  const timer = setInterval(() => {
    if (ctx && ctx.state === "running") { clearInterval(timer); fire(); }
    else if (++tries > 30) clearInterval(timer);
  }, 100);
  const unlock = () => {
    if (!ctx) return;
    ctx.resume().then(fire).catch(() => {});
  };
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}

export function setMuted(value) {
  muted = value;
  localStorage.setItem(MUTE_KEY, value ? "1" : "0");
  if (master) master.gain.value = value ? 0 : 0.22;
}

export function isMuted() { return muted; }
