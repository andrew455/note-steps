// Final independent accuracy trial for chords.js: a fresh randomized set of C major / C minor chords
// and non-target sounds, synthesized and run frame by frame through the AnalyserNode emulation.
// Run: node --test tests/chords.final.test.js   (CHORD_SEED=<n> for a different draw)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const sim = require('./audio-sim.js');
const CD = require(path.join(__dirname, '..', 'chords.js'));

const SEED = Number(process.env.CHORD_SEED || 271828);
const rand = sim.rng(SEED);
const uni = (a, b) => a + (b - a) * rand();
const logUni = (a, b) => Math.exp(uni(Math.log(a), Math.log(b)));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const nameOf = (m) => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

// Close voicing of pitch classes `shape` (semitones above root) at root midi, inversion inv.
function voice(root, shape, inv) {
  const ms = shape.map((s) => root + s);
  for (let i = 0; i < inv; i++) ms.push(ms.shift() + 12);
  return ms;
}

// Random rendering parameters for one trial.
function params() {
  const digital = rand() < 0.25;
  return {
    sr: rand() < 0.5 ? 44100 : 48000,
    velocity: logUni(0.025, 0.4),
    B: digital ? uni(0.00005, 0.00015) : uni(0.0002, 0.0008),
    digital,
    noise: logUni(0.00005, 0.003),
    rollMs: rand() < 0.5 ? 0 : uni(0, 80),
    at: uni(0.3, 0.7),
    jitterMs: uni(0, 6),
    seed: Math.floor(rand() * 1e6),
  };
}

function run(midis, p) {
  const sr = p.sr;
  const sig = new Float32Array(Math.round(sr * 2.6));
  sim.addNoise(sig, sr, p.noise, p.seed + 1);
  midis.forEach((m, i) => {
    sim.addPianoNote(sig, sr, p.at + (p.rollMs * i) / 1000, m, {
      velocity: p.velocity * uni(0.75, 1.25),
      B: p.B,
      digital: p.digital,
      tuneCents: uni(-15, 15),
      seed: p.seed * 13 + i * 101 + m,
    });
  });
  return sim.runDetector(sig, sr, CD.createDetector(), { jitterMs: p.jitterMs, seed: p.seed + 2 }).map((e) => e.name);
}

// ---------------------------------------------------------------- trial definitions
const TRIALS = [];
for (const id of ['C', 'Cm']) {
  for (let i = 0; i < 40; i++) {
    const R = pick([3, 4, 5]);
    const inv = Math.floor(rand() * 3);
    const midis = voice(12 * (R + 1), id === 'C' ? [0, 4, 7] : [0, 3, 7], inv);
    TRIALS.push({ group: id, expect: id, midis, p: params(), label: `inv${inv}` });
  }
}
const TRIAD_SHAPES = { maj: [0, 4, 7], min: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8], sus4: [0, 5, 7], sus2: [0, 2, 7] };
const SEVENTHS = { dom7: [0, 4, 7, 10], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10] };
for (let i = 0; i < 80; i++) {
  const kind = i % 4; // 20 single notes, 20 dyads, 20 other triads, 20 sevenths
  let midis, label;
  if (kind === 0) {
    // Half of the single notes are a C (the 5th-harmonic trap), the rest anywhere C3..C6.
    const m = i % 8 === 0 ? 12 * Math.floor(uni(4, 7)) : Math.floor(uni(48, 85));
    midis = [m];
    label = 'single';
  } else if (kind === 1) {
    // Dyads: a third of them are C+G (no third), C+E or C+Eb (no fifth); the rest random intervals.
    const lo = 12 * Math.floor(uni(4, 6));
    const special = [[0, 7], [0, 4], [0, 3], [4, 7], [3, 7], [0, 16], [0, 19]];
    midis = rand() < 0.5 ? pick(special).map((s) => lo + s) : (() => { const a = Math.floor(uni(48, 76)); return [a, a + Math.floor(uni(1, 13))]; })();
    label = 'dyad';
  } else if (kind === 2) {
    let root, shapeName;
    do {
      root = Math.floor(uni(0, 12));
      shapeName = pick(Object.keys(TRIAD_SHAPES));
    } while (root === 0 && (shapeName === 'maj' || shapeName === 'min'));
    const R = 12 * Math.floor(uni(4, 6)) + root;
    midis = voice(R > 79 ? R - 12 : R, TRIAD_SHAPES[shapeName], Math.floor(rand() * 3));
    label = NAMES[root] + ' ' + shapeName;
  } else {
    const root = rand() < 0.5 ? 0 : Math.floor(uni(0, 12));
    const shapeName = pick(Object.keys(SEVENTHS));
    midis = voice(12 * Math.floor(uni(4, 6)) + root, SEVENTHS[shapeName], Math.floor(rand() * 4));
    label = NAMES[root] + ' ' + shapeName;
  }
  TRIALS.push({ group: ['single', 'dyad', 'triad', 'seventh'][kind], expect: null, midis, p: params(), label });
}

// ---------------------------------------------------------------- run + matrix
const results = [];
for (const t of TRIALS) {
  t.got = run(t.midis, t.p);
  results.push(t);
}

function rate(n, d) { return d ? `${n}/${d} (${((100 * n) / d).toFixed(1)}%)` : '-'; }
const lines = [`seed ${SEED}`];
const failures = [];
for (const id of ['C', 'Cm']) {
  const g = results.filter((t) => t.group === id);
  const tp = g.filter((t) => t.got.length === 1 && t.got[0] === id).length;
  const wrong = g.filter((t) => t.got.some((n) => n !== id)).length;
  const miss = g.filter((t) => t.got.length === 0).length;
  const dup = g.filter((t) => t.got.length > 1).length;
  lines.push(`${id}: TP ${rate(tp, g.length)}  confused ${wrong}  missed ${miss}  duplicate ${dup}`);
  g.filter((t) => !(t.got.length === 1 && t.got[0] === id)).forEach((t) => failures.push(t));
}
let fpTotal = 0;
for (const grp of ['single', 'dyad', 'triad', 'seventh']) {
  const g = results.filter((t) => t.group === grp);
  const fp = g.filter((t) => t.got.length > 0);
  fpTotal += fp.length;
  lines.push(`${grp}: FP ${rate(fp.length, g.length)}`);
  fp.forEach((t) => failures.push(t));
}
lines.push(`non-targets overall: FP ${rate(fpTotal, 80)}`);
for (const t of failures) {
  const p = t.p;
  lines.push(`  FAIL ${t.group} ${t.label} [${t.midis.map(nameOf).join(' ')}] -> [${t.got.join(',')}]  ` +
    `sr ${p.sr} vel ${p.velocity.toFixed(3)} B ${p.B.toFixed(5)}${p.digital ? ' digital' : ''} noise ${p.noise.toFixed(5)} roll ${p.rollMs.toFixed(0)}ms`);
}
console.log('\n' + lines.join('\n'));

test('C major true-positive rate >= 90%', () => {
  const g = results.filter((t) => t.group === 'C');
  const tp = g.filter((t) => t.got.length === 1 && t.got[0] === 'C').length;
  assert.ok(tp / g.length >= 0.9, lines.join('\n'));
});
test('C minor true-positive rate >= 90%', () => {
  const g = results.filter((t) => t.group === 'Cm');
  const tp = g.filter((t) => t.got.length === 1 && t.got[0] === 'Cm').length;
  assert.ok(tp / g.length >= 0.9, lines.join('\n'));
});
test('no C major read as C minor or vice versa', () => {
  const bad = results.filter((t) => t.expect && t.got.some((n) => n !== t.expect));
  assert.equal(bad.length, 0, lines.join('\n'));
});
test('non-target false-positive rate <= 5%', () => {
  assert.ok(fpTotal / 80 <= 0.05, lines.join('\n'));
});
