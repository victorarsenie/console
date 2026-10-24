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
  key: () => blip(1200 + Math.random() * 240, 28, "square", 0.05),
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
    lp.frequency.linearRampToValueAtTime(900, ctx.currentTime + 1.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.06, ctx.currentTime + 0.6);
    g.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 1.8);
    swell.connect(lp).connect(g).connect(master);
    swell.start();
    swell.stop(ctx.currentTime + 1.9);
    [55, 66, 82, 110].forEach((f, i) => {
      setTimeout(() => {
        blip(f, 420, "sawtooth", 0.08);
        tick(300 + i * 120, 120, 0.04, 2);
      }, i * 380);
    });
  },
  // typewriter: a dry mechanical tick, quieter than a keystroke
  type: () => tick(1800 + Math.random() * 900, 14, 0.06, 8),
  // standby: the machine's slow sonar while it works - low ping, faint echo
  think: () => {
    blip(58, 320, "sawtooth", 0.075);
    blip(87, 260, "triangle", 0.03);
    tick(420, 90, 0.035, 3);
  },
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
}

export function setMuted(value) {
  muted = value;
  localStorage.setItem(MUTE_KEY, value ? "1" : "0");
  if (master) master.gain.value = value ? 0 : 0.22;
}

export function isMuted() { return muted; }
