// Test helper (WP1): piano-like plucks rendered to a Float32Array, plus a feeder that hands a Listener
// one 2048-sample analyser frame every 25 ms, like core/audio.js does in the browser.
//
// A pluck has partials 1, 0.5, 0.25 (relative to the fundamental) with an exponential decay whose time
// constant is 1.5 s. Holding stops at `dur` (the key comes up): the damper then pulls the note down with
// a time constant of `damp` (12 ms). With dur = Infinity the note rings on.
'use strict';

const SR = 44100;

function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

// Seeded uniform numbers in [0, 1) (mulberry32, same as core/util.js).
function rng32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Gain envelope of one pluck at t seconds after its attack.
function envelope(t, { dur = Infinity, decay = 1.5, damp = 0.012, attack = 0.002 } = {}) {
  if (t < 0) return 0;
  let e = Math.exp(-t / decay) * Math.min(1, t / attack);
  if (t > dur) e *= Math.exp(-(t - dur) / damp);
  return e;
}

// Adds one pluck into sig (in place).
//   p = { midi | freq, at (sec), dur, gain = 0.3, partials = [1, 0.5, 0.25], decay = 1.5, damp, attack,
//         inharm = 0 }   partials may also be [[harmonic, amp], ...] for unusual spectra.
function addPluck(sig, p, sr = SR) {
  const f0 = p.freq || midiToFreq(p.midi);
  const gain = p.gain == null ? 0.3 : p.gain;
  const parts = (p.partials || [1, 0.5, 0.25]).map((a, i) => (Array.isArray(a) ? a : [i + 1, a]));
  const s0 = Math.max(0, Math.round(p.at * sr));
  const envOpts = { dur: p.dur == null ? Infinity : p.dur, decay: p.decay || 1.5, damp: p.damp || 0.012, attack: p.attack || 0.002 };
  const inharm = p.inharm || 0;
  const w = parts.map(([h]) => 2 * Math.PI * f0 * h * (1 + inharm * h * h));
  for (let i = s0; i < sig.length; i++) {
    const t = (i - s0) / sr;
    const env = envelope(t, envOpts);
    if (t > 0.05 && env < 1e-6) break;
    let v = 0;
    for (let k = 0; k < parts.length; k++) v += parts[k][1] * Math.sin(w[k] * t);
    sig[i] += gain * env * v;
  }
  return sig;
}

// White noise at `dB` RMS relative to full scale (e.g. -50 dB = 0.0032 RMS), added in place.
function noise(sig, dB = -50, seed = 7) {
  const r = rng32(seed);
  const amp = Math.pow(10, dB / 20) * Math.sqrt(3); // uniform in [-a, a] has RMS a/sqrt(3)
  for (let i = 0; i < sig.length; i++) sig[i] += amp * (2 * r() - 1);
  return sig;
}

// render(events, sr) -> Float32Array. opts: {length (sec), noiseDb (default -50; null = none), seed}.
function render(events, sr = SR, opts = {}) {
  const lastEnd = events.reduce((m, e) => Math.max(m, e.at + Math.min(e.dur == null ? 2 : e.dur + 0.2, 3)), 0);
  const length = opts.length || lastEnd + 0.5;
  const sig = new Float32Array(Math.ceil(length * sr));
  for (const e of events) addPluck(sig, e, sr);
  if (opts.noiseDb !== null) noise(sig, opts.noiseDb == null ? -50 : opts.noiseDb, opts.seed || 7);
  return sig;
}

// Feeds a listener one frame per hop. Returns every event, each tagged with the hop's time `hopMs`.
//   opts: { hopMs = 25, size = 2048, startMs = 13, perfOffset = 5000 (page clock = audio clock + offset),
//           muted(tMs) -> bool, jitterMs = 0, seed, onHop(tMs, listener) }
function feed(listener, sig, sr = SR, opts = {}) {
  const hopMs = opts.hopMs || 25;
  const size = opts.size || 2048;
  const perfOffset = opts.perfOffset == null ? 5000 : opts.perfOffset;
  const r = rng32(opts.seed || 3);
  const out = [];
  for (let tMs = (opts.startMs == null ? 13 : opts.startMs) + (size / sr) * 1000; ; tMs += hopMs) {
    const t = tMs + (opts.jitterMs ? (2 * r() - 1) * opts.jitterMs : 0);
    // Like an AnalyserNode: the frame ends at a render-quantum boundary (128 samples).
    const end = Math.floor((t / 1000) * sr / 128) * 128;
    if (end > sig.length) break;
    if (end < size) continue;
    const ctxTime = end / sr;
    if (opts.onHop) opts.onHop(ctxTime * 1000, listener);
    const muted = opts.muted ? opts.muted(ctxTime * 1000) : false;
    const evs = listener.process(sig.subarray(end - size, end), ctxTime * 1000 + perfOffset, ctxTime, sr, muted);
    for (const e of evs) out.push(Object.assign({ hopMs: ctxTime * 1000 }, e));
  }
  return out;
}

module.exports = { SR, midiToFreq, envelope, addPluck, noise, render, feed, rng32 };
