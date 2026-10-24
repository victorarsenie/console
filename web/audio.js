// Synthesised machine cues. No samples, no files: everything is oscillators and noise,
// so tuning a cue is editing a number, not hunting an asset.
//
// Autoplay rules mean nothing sounds until the user interacts: `start()` is called from
// the first click/keypress, and the hum begins then.
const MUTE_KEY = "muther.muted";

let ctx = null;
let master = null;
let hum = null;
let muted = localStorage.getItem(MUTE_KEY) === "1";

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.22;
  master.connect(ctx.destination);
  return ctx;
}

function noiseBuffer(seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

// A low drone: two detuned saws through a low-pass, plus filtered noise as "air".
function startHum() {
  if (!ensure() || hum) return;
  const g = ctx.createGain();
  g.gain.value = 0.16;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 220;
  filter.Q.value = 0.7;

  const a = ctx.createOscillator();
  a.type = "sawtooth";
  a.frequency.value = 54;
  const b = ctx.createOscillator();
  b.type = "sawtooth";
  b.frequency.value = 56.5;

  const air = ctx.createBufferSource();
  air.buffer = noiseBuffer(2);
  air.loop = true;
  const airGain = ctx.createGain();
  airGain.gain.value = 0.05;

  a.connect(filter); b.connect(filter);
  air.connect(airGain).connect(filter);
  filter.connect(g).connect(master);
  a.start(); b.start(); air.start();

  // slow wobble, the difference between "drone" and "machine room"
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.11;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.04;
  lfo.connect(lfoGain).connect(g.gain);
  lfo.start();

  hum = { a, b, air, lfo, g };
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

export const cue = {
  key: () => blip(1200 + Math.random() * 240, 28, "square", 0.05),
  bay: () => { blip(660, 60, "triangle", 0.08); setTimeout(() => blip(880, 70, "triangle", 0.07), 70); },
  ok: () => blip(990, 90, "sine", 0.1),
  alert: () => { blip(320, 140, "sawtooth", 0.1, -80); setTimeout(() => blip(220, 200, "sawtooth", 0.1, -60), 150); },
  boot: () => {
    for (let i = 0; i < 7; i++) setTimeout(() => blip(600 + i * 90, 35, "square", 0.05), i * 110);
  },
};

export function start() {
  if (!ensure()) return;
  if (ctx.state === "suspended") ctx.resume();
  startHum();
}

export function setMuted(value) {
  muted = value;
  localStorage.setItem(MUTE_KEY, value ? "1" : "0");
  if (master) master.gain.value = value ? 0 : 0.22;
}

export function isMuted() { return muted; }
