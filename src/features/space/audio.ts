// Ambient sounds made on the spot with Web Audio (no recording, no stream, nothing to
// license): rain, café, fireplace, forest, library, brown noise. Everyone at a table hears
// the same ambience; each person can mute it or turn it down for themselves.
import type { Sound } from "./protocol";

let ctx: AudioContext | null = null;
let current: { sound: Sound; stop: () => void } | null = null;
let master: GainNode | null = null;
let volume = 0.5;
let muted = false;

function audio(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(ctx.destination);
  }
  return ctx;
}

function noise(a: AudioContext, kind: "white" | "pink" | "brown"): AudioBufferSourceNode {
  const len = a.sampleRate * 4;
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === "white") d[i] = w * 0.5;
    else if (kind === "brown") {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
    }
  }
  const src = a.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  return src;
}

function filtered(a: AudioContext, kind: "white" | "pink" | "brown", type: BiquadFilterType, freq: number, gain: number, out: AudioNode): () => void {
  const src = noise(a, kind);
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(out);
  src.start();
  return () => src.stop();
}

/** Short random events (drops, crackles, birds, cups) on top of a bed of noise. */
function events(a: AudioContext, out: AudioNode, every: [number, number], make: (t: number) => void): () => void {
  let timer = 0;
  const loop = () => {
    make(a.currentTime);
    timer = window.setTimeout(loop, every[0] + Math.random() * (every[1] - every[0]));
  };
  timer = window.setTimeout(loop, every[0]);
  void out;
  return () => window.clearTimeout(timer);
}

function blip(a: AudioContext, out: AudioNode, freq: number, dur: number, gain: number, type: OscillatorType = "sine", sweep = 0) {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime);
  if (sweep) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + sweep), a.currentTime + dur);
  g.gain.setValueAtTime(gain, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g).connect(out);
  o.start();
  o.stop(a.currentTime + dur + 0.05);
}

function crackle(a: AudioContext, out: AudioNode, gain: number) {
  const src = noise(a, "white");
  const f = a.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = 1800;
  const g = a.createGain();
  g.gain.setValueAtTime(gain, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.04 + Math.random() * 0.05);
  src.connect(f).connect(g).connect(out);
  src.start();
  src.stop(a.currentTime + 0.15);
}

function build(sound: Sound): () => void {
  const a = audio();
  const out = master!;
  const parts: Array<() => void> = [];
  switch (sound) {
    case "rain":
      parts.push(filtered(a, "pink", "lowpass", 2600, 0.55, out), filtered(a, "white", "highpass", 5000, 0.05, out));
      parts.push(events(a, out, [60, 220], () => crackle(a, out, 0.05)));
      break;
    case "cafe":
      parts.push(filtered(a, "brown", "bandpass", 450, 0.9, out), filtered(a, "pink", "bandpass", 1200, 0.12, out));
      parts.push(events(a, out, [2500, 9000], () => blip(a, out, 2200 + Math.random() * 900, 0.25, 0.04, "triangle")));
      break;
    case "fire":
      parts.push(filtered(a, "brown", "lowpass", 500, 0.9, out));
      parts.push(events(a, out, [80, 600], () => crackle(a, out, 0.12 + Math.random() * 0.1)));
      break;
    case "forest":
      parts.push(filtered(a, "pink", "lowpass", 900, 0.35, out));
      parts.push(events(a, out, [1800, 7000], () => {
        const f = 2400 + Math.random() * 1500;
        blip(a, out, f, 0.12, 0.05, "sine", 600);
        window.setTimeout(() => blip(a, out, f * 1.1, 0.1, 0.04, "sine", -400), 140);
      }));
      break;
    case "library":
      parts.push(filtered(a, "brown", "lowpass", 300, 0.45, out));
      parts.push(events(a, out, [7000, 20000], () => crackle(a, out, 0.03)));
      break;
    case "brown":
      parts.push(filtered(a, "brown", "lowpass", 800, 0.8, out));
      break;
  }
  return () => parts.forEach((p) => p());
}

/** Plays `sound` (or silence with `null`). Starting the same sound again does nothing. */
export function play(sound: Sound | null) {
  if (current?.sound === sound) return;
  current?.stop();
  current = null;
  if (!sound) return;
  try {
    const stop = build(sound);
    void ctx?.resume();
    current = { sound, stop };
  } catch {
    current = null;
  }
}

export function setVolume(v: number) {
  volume = Math.min(1, Math.max(0, v));
  if (master) master.gain.value = muted ? 0 : volume;
}

export function setMuted(m: boolean) {
  muted = m;
  if (master) master.gain.value = muted ? 0 : volume;
}

/** Stops everything and frees the audio device (leaving TekSpace). */
export function shutdown() {
  current?.stop();
  current = null;
  void ctx?.close();
  ctx = null;
  master = null;
}
