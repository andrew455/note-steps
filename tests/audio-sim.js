// Shared test helpers: a piano-like synth and a faithful emulation of AnalyserNode.getFloatFrequencyData,
// so detector tests can run in plain Node without a browser.
'use strict';

const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

function noteToMidi(name) {
  const m = /^([A-G](?:#|b)?)(-?\d)$/.exec(name);
  if (!m) throw new Error('bad note name ' + name);
  return 12 * (Number(m[2]) + 1) + PC[m[1]];
}
function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

// Small deterministic PRNG (mulberry32).
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rand) {
  const u = Math.max(1e-12, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

// Adds one piano-like note into `out` (Float32Array) starting at startSec.
// opts: velocity (peak-ish amplitude), B (inharmonicity), digital (smoother sampled-piano spectrum),
// tuneCents, fundamentalGain, holdSec (key released after this), seed, thump (attack noise level).
function addPianoNote(out, sr, startSec, note, opts = {}) {
  const midi = typeof note === 'number' ? note : noteToMidi(note);
  const rand = rng(opts.seed != null ? opts.seed : midi * 7919 + Math.round(startSec * 1000));
  const vel = opts.velocity != null ? opts.velocity : 0.2;
  const digital = !!opts.digital;
  const B = opts.B != null ? opts.B : digital ? 0.0001 : 0.0004;
  const f0 = midiToFreq(midi) * Math.pow(2, (opts.tuneCents || 0) / 1200);
  const holdSec = opts.holdSec != null ? opts.holdSec : 10;
  const start = Math.round(startSec * sr);
  const nyq = sr / 2;
  const strike = 1 / (7.5 + rand()); // hammer strike point along the string
  // Brightness grows with velocity: loud notes keep more upper partials.
  const tilt = digital ? 1.5 : 1.15 - 0.25 * Math.min(1, vel / 0.5);

  const partials = [];
  for (let h = 1; h <= 24; h++) {
    const f = h * f0 * Math.sqrt(1 + B * h * h);
    if (f > Math.min(8000, nyq * 0.9)) break;
    let a = Math.pow(h, -tilt) * (0.6 + 0.8 * rand());
    if (!digital) a *= 0.15 + 0.85 * Math.abs(Math.sin(Math.PI * h * strike));
    if (h === 1) a *= opts.fundamentalGain != null ? opts.fundamentalGain : 1;
    const tFast = (0.45 * Math.pow(262 / f0, 0.6)) / (1 + 0.25 * (h - 1));
    partials.push({ w: 2 * Math.PI * f / sr, a, ph: 2 * Math.PI * rand(), tFast, tSlow: tFast * 5 });
  }
  let norm = 0;
  for (const p of partials) norm += p.a;
  const scale = vel / Math.max(norm, 1e-9) * 1.6;

  const len = Math.min(out.length - start, Math.round((holdSec + 0.6) * sr));
  const attack = Math.round(0.003 * sr);
  const rel = Math.round(holdSec * sr);
  for (const p of partials) {
    const kf = Math.exp(-1 / (p.tFast * sr));
    const ks = Math.exp(-1 / (p.tSlow * sr));
    const kr = Math.exp(-1 / (0.07 * sr));
    let ef = 0.65, es = 0.35, er = 1;
    const amp = p.a * scale;
    for (let n = 0; n < len; n++) {
      const env = (n < attack ? n / attack : 1) * (ef + es) * er;
      out[start + n] += amp * env * Math.sin(p.w * n + p.ph);
      ef *= kf; es *= ks;
      if (n >= rel) er *= kr;
    }
  }
  // Hammer thump: a short burst of low-passed noise.
  const thump = (opts.thump != null ? opts.thump : 0.25) * vel;
  if (thump > 0) {
    const n1 = Math.min(len, Math.round(0.05 * sr));
    const lp = Math.exp(-2 * Math.PI * 900 / sr);
    let y = 0;
    for (let n = 0; n < n1; n++) {
      y = lp * y + (1 - lp) * gauss(rand);
      out[start + n] += thump * 6 * y * Math.exp(-n / (0.008 * sr));
    }
  }
  return out;
}

// Adds a chord. notes: ['C4','E4','G4']; opts.rollMs spreads the onsets; opts.velocities per note.
function addChord(out, sr, startSec, notes, opts = {}) {
  notes.forEach((n, i) => {
    const v = opts.velocities ? opts.velocities[i] : opts.velocity;
    addPianoNote(out, sr, startSec + ((opts.rollMs || 0) * i) / 1000, n, Object.assign({}, opts, {
      velocity: v != null ? v : 0.2,
      seed: (opts.seed || 1) * 1000 + i * 31 + noteToMidi(n),
    }));
  });
  return out;
}

function addNoise(out, sr, level, seed = 99, startSec = 0, endSec = Infinity) {
  const rand = rng(seed);
  const s = Math.max(0, Math.round(startSec * sr));
  const e = Math.min(out.length, Math.round(endSec * sr));
  for (let n = s; n < e; n++) out[n] += level * gauss(rand);
  return out;
}

// A crude talking voice: gliding glottal pulse train through three formants.
function addVoice(out, sr, startSec, durSec, level = 0.1, seed = 5) {
  const rand = rng(seed);
  const s = Math.round(startSec * sr);
  const n1 = Math.min(out.length - s, Math.round(durSec * sr));
  const formants = [[700, 110], [1220, 120], [2600, 160]].map(([f, bw]) => {
    const r = Math.exp(-Math.PI * bw / sr);
    return { a1: -2 * r * Math.cos(2 * Math.PI * f / sr), a2: r * r, y1: 0, y2: 0 };
  });
  let phase = 0;
  for (let n = 0; n < n1; n++) {
    const t = n / sr;
    const f0 = 120 + 35 * Math.sin(2 * Math.PI * 1.7 * t) + 20 * Math.sin(2 * Math.PI * 0.6 * t + 1);
    phase += f0 / sr;
    let x = 0;
    if (phase >= 1) { phase -= 1; x = 1; }
    x += 0.02 * gauss(rand);
    let y = 0;
    for (const fm of formants) {
      const v = x - fm.a1 * fm.y1 - fm.a2 * fm.y2;
      fm.y2 = fm.y1; fm.y1 = v;
      y += v;
    }
    const syl = 0.5 + 0.5 * Math.sin(2 * Math.PI * 3.5 * t);
    out[s + n] += level * 0.02 * y * syl;
  }
  return out;
}

// ---------------------------------------------------------------- FFT + AnalyserNode
const fftCache = new Map();
function fftTables(N) {
  let t = fftCache.get(N);
  if (t) return t;
  const bits = Math.log2(N);
  const rev = new Uint32Array(N);
  for (let i = 0; i < N; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(N / 2);
  const sin = new Float64Array(N / 2);
  for (let i = 0; i < N / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / N); sin[i] = -Math.sin((2 * Math.PI * i) / N); }
  const win = new Float64Array(N);
  // Blackman window exactly as the Web Audio spec defines it (alpha = 0.16).
  const a0 = 0.42, a1 = 0.5, a2 = 0.08;
  for (let n = 0; n < N; n++) win[n] = a0 - a1 * Math.cos((2 * Math.PI * n) / N) + a2 * Math.cos((4 * Math.PI * n) / N);
  t = { rev, cos, sin, win };
  fftCache.set(N, t);
  return t;
}
function fft(re, im) {
  const N = re.length;
  const { rev, cos, sin } = fftTables(N);
  for (let i = 0; i < N; i++) {
    const j = rev[i];
    if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1;
    const step = N / size;
    for (let i = 0; i < N; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const wr = cos[k], wi = sin[k];
        const a = i + j, b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
}

// Emulates one AnalyserNode reading a fixed signal. The node's buffer only advances in 128-frame
// render quanta, like the real thing.
class AnalyserSim {
  constructor({ fftSize = 16384, smoothingTimeConstant = 0.5, sampleRate = 48000 } = {}) {
    this.fftSize = fftSize;
    this.smoothingTimeConstant = smoothingTimeConstant;
    this.sampleRate = sampleRate;
    this.frequencyBinCount = fftSize / 2;
    this.prev = new Float64Array(fftSize / 2);
    this.re = new Float64Array(fftSize);
    this.im = new Float64Array(fftSize);
  }
  // Most recent fftSize samples ending at time tSec (zeros before the signal starts).
  timeDomain(signal, tSec, out) {
    const N = this.fftSize;
    const end = Math.floor((tSec * this.sampleRate) / 128) * 128;
    const td = out || new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const n = end - N + i;
      td[i] = n >= 0 && n < signal.length ? signal[n] : 0;
    }
    return td;
  }
  // getFloatFrequencyData: Blackman window, FFT / N, temporal smoothing, 20*log10.
  frequencyData(td, out) {
    const N = this.fftSize;
    const { win } = fftTables(N);
    const re = this.re, im = this.im;
    for (let i = 0; i < N; i++) { re[i] = td[i] * win[i]; im[i] = 0; }
    fft(re, im);
    const tau = this.smoothingTimeConstant;
    const db = out || new Float32Array(N / 2);
    for (let k = 0; k < N / 2; k++) {
      const mag = Math.hypot(re[k], im[k]) / N;
      const s = tau * this.prev[k] + (1 - tau) * mag;
      this.prev[k] = isFinite(s) ? s : 0;
      db[k] = s > 0 ? 20 * Math.log10(s) : -Infinity;
    }
    return db;
  }
}

function tailRms(buf, n = 2048) {
  const len = Math.min(buf.length, n);
  let s = 0;
  for (let i = buf.length - len; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / len);
}

// Feeds a signal frame by frame into a detector (from ChordDetect.createDetector).
// Returns [{ name, tMs }].
function runDetector(signal, sampleRate, detector, opts = {}) {
  const fftSize = opts.fftSize || 16384;
  const an = new AnalyserSim({ fftSize, smoothingTimeConstant: opts.smoothing != null ? opts.smoothing : 0.5, sampleRate });
  const interval = opts.intervalMs || 30;
  const jitter = opts.jitterMs || 0;
  const rand = rng(opts.seed || 3);
  const td = new Float32Array(fftSize);
  const db = new Float32Array(fftSize / 2);
  const events = [];
  const total = (signal.length / sampleRate) * 1000;
  for (let t = interval; t <= total; t += interval) {
    const tm = t + (jitter ? (rand() - 0.5) * 2 * jitter : 0);
    an.timeDomain(signal, tm / 1000, td);
    an.frequencyData(td, db);
    const name = detector.push(db, sampleRate, fftSize, tm, tailRms(td, 2048));
    if (name) events.push({ name, tMs: tm });
  }
  return events;
}

// One spectrum of a signal at time tSec (with `warm` smoothed frames before it, like a live analyser).
function spectrumAt(signal, sampleRate, tSec, opts = {}) {
  const fftSize = opts.fftSize || 16384;
  const an = new AnalyserSim({ fftSize, smoothingTimeConstant: opts.smoothing != null ? opts.smoothing : 0.5, sampleRate });
  const td = new Float32Array(fftSize);
  const db = new Float32Array(fftSize / 2);
  const warm = opts.warm != null ? opts.warm : 3;
  for (let i = warm; i >= 0; i--) {
    an.timeDomain(signal, tSec - (i * 30) / 1000, td);
    an.frequencyData(td, db);
  }
  return db;
}

module.exports = {
  noteToMidi, midiToFreq, rng, addPianoNote, addChord, addNoise, addVoice,
  fft, AnalyserSim, tailRms, runDetector, spectrumAt,
};
