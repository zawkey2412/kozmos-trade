// Writes the coin sounds in sounds/ from synthesized metal clinks (node tools/make-sounds.mjs).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RATE = 44_100;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Partials of a struck coin: frequency ratio, loudness and how fast it dies away per second.
const PARTIALS = [
  [1, 1, 28],
  [2.76, 0.55, 38],
  [5.4, 0.35, 52],
  [8.93, 0.2, 70],
];

// Seeded random numbers, so the files come out the same every run.
/** @param {number} seed */
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * @param {Float32Array} buffer
 * @param {{ at: number, pitch: number, gain: number }} clink
 * @param {() => number} random
 */
function addClink(buffer, { at, pitch, gain }, random) {
  const start = Math.floor(at * RATE);
  const base = 2_300 * pitch;
  for (let i = 0; start + i < buffer.length; i++) {
    const t = i / RATE;
    let sample = 0;
    for (const [ratio, loudness, decay] of PARTIALS) sample += loudness * Math.exp(-decay * t) * Math.sin(2 * Math.PI * base * ratio * t);
    if (t < 0.002) sample += (random() * 2 - 1) * (1 - t / 0.002) * 0.6;
    buffer[start + i] += sample * gain;
  }
}

/**
 * @param {number} seconds
 * @param {{ at: number, pitch: number, gain: number }[]} clinks
 * @param {number} seed
 */
function render(seconds, clinks, seed) {
  const random = seeded(seed);
  const buffer = new Float32Array(Math.ceil(seconds * RATE));
  for (const clink of clinks) addClink(buffer, clink, random);
  const fade = Math.floor(0.05 * RATE);
  for (let i = 0; i < fade; i++) buffer[buffer.length - 1 - i] *= i / fade;
  const peak = buffer.reduce((max, value) => Math.max(max, Math.abs(value)), 0) || 1;
  return buffer.map((value) => (value / peak) * 0.8);
}

/** @param {Float32Array} samples */
function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((value, index) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32_767), index * 2));
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const random = seeded(7);
const pile = Array.from({ length: 9 }, (_, index) => ({
  at: index * 0.07 + random() * 0.04,
  pitch: 0.85 + random() * 0.35,
  gain: 0.45 + random() * 0.55,
}));

const sounds = {
  "coin.wav": render(0.4, [{ at: 0, pitch: 1, gain: 1 }, { at: 0.07, pitch: 1.08, gain: 0.35 }], 1),
  "coins.wav": render(1.2, pile, 2),
};

mkdirSync(join(ROOT, "sounds"), { recursive: true });
for (const [name, samples] of Object.entries(sounds)) writeFileSync(join(ROOT, "sounds", name), wav(samples));
console.log(`Wrote ${Object.keys(sounds).length} sounds.`);
