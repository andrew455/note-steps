// Adversarial acoustics suite for chords.js. Run: node --test tests/
//
// Every test states what a good detector should do with a real-world chord spectrum, even where the
// current implementation does not manage it. Cases that cannot be decided from the spectrum alone are
// written as skipped tests (with the reason), and paired with a "safety" test that only demands the
// detector does not report the WRONG chord (null is acceptable there).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const sim = require('./audio-sim.js');
const CD = require(path.join(__dirname, '..', 'chords.js'));

const LEAD = 0.4;           // seconds of room noise before the chord
const SRS = [44100, 48000];
const SCRATCH = 2.6;        // default render length (s)

// ------------------------------------------------------------------ local helpers
function blank(sr, dur, noise, seed) {
  const sig = new Float32Array(Math.round(sr * (dur || SCRATCH)));
  sim.addNoise(sig, sr, noise != null ? noise : 0.0004, seed || 7);
  return sig;
}

function chord(notes, opts = {}) {
  const sr = opts.sr || 48000;
  const sig = blank(sr, opts.dur, opts.noise, opts.noiseSeed);
  sim.addChord(sig, sr, opts.at != null ? opts.at : LEAD, notes, opts);
  return { sig, sr };
}

function run({ sig, sr }, detOpts, runOpts) {
  return sim.runDetector(sig, sr, CD.createDetector(detOpts), runOpts).map((e) => e.name);
}

function wrongOf(id) { return id === 'C' ? 'Cm' : 'C'; }

function expectExactly(r, id, label, detOpts, runOpts) {
  const got = run(r, detOpts, runOpts);
  assert.deepEqual(got, id ? [id] : [], `${label}: expected ${id ? '[' + id + ']' : '[]'}, got [${got}]`);
}

// For ambiguous inputs: nothing or the right chord is fine, the wrong chord is not.
function expectNotWrong(r, id, label) {
  const got = run(r);
  assert.ok(!got.includes(wrongOf(id)), `${label}: reported the wrong chord [${got}]`);
  assert.ok(got.length <= 1, `${label}: reported more than once [${got}]`);
}

// Collects failures across a loop so a test reports every failing configuration at once.
function sweep(cases, fn) {
  const bad = [];
  for (const c of cases) {
    try { fn(c); } catch (e) { bad.push(e.message.split('\n')[0]); }
  }
  assert.equal(bad.length, 0, `${bad.length}/${cases.length} configurations failed:\n  ` + bad.join('\n  '));
}

function freqOf(note, a4) {
  return sim.midiToFreq(sim.noteToMidi(note)) * ((a4 || 440) / 440);
}

// A tone with an explicit partial spectrum (amps[0] = fundamental), for digital pianos and speakers
// with a weak bass, or acoustic notes with an unusually strong 5th partial.
function addTone(out, sr, startSec, f0, amps, o = {}) {
  const rand = sim.rng(o.seed != null ? o.seed : Math.round(f0 * 13) + 5);
  const B = o.B != null ? o.B : 0.0001;
  const vel = o.velocity != null ? o.velocity : 0.2;
  const start = Math.round(startSec * sr);
  const len = Math.min(out.length - start, Math.round((o.dur || 4) * sr));
  const attack = Math.round(0.004 * sr);
  let norm = 0;
  for (const a of amps) norm += a;
  amps.forEach((a, i) => {
    const h = i + 1;
    const f = h * f0 * Math.sqrt(1 + B * h * h);
    if (!a || f > sr * 0.45) return;
    const w = (2 * Math.PI * f) / sr;
    const ph = 2 * Math.PI * rand();
    const tau = (o.decay || 1.4) / (1 + 0.2 * (h - 1));
    const k = Math.exp(-1 / (tau * sr));
    let env = 1;
    const amp = (a / norm) * vel * 1.6;
    for (let n = 0; n < len; n++) {
      out[start + n] += amp * env * (n < attack ? n / attack : 1) * Math.sin(w * n + ph);
      env *= k;
    }
  });
  // short key/hammer click
  const thump = (o.thump != null ? o.thump : 0.15) * vel;
  for (let n = 0, y = 0; n < Math.min(len, 0.03 * sr); n++) {
    y = 0.9 * y + 0.1 * (rand() * 2 - 1);
    out[start + n] += thump * 6 * y * Math.exp(-n / (0.006 * sr));
  }
  return out;
}

// Spectrum of a cheap digital piano heard through its own small speakers: weak fundamental,
// 2nd harmonic dominant, smooth roll-off.
function weakBassSpectrum(fund) { return [fund, 1, 0.55, 0.4, 0.25, 0.16, 0.1, 0.07, 0.05, 0.035, 0.025, 0.018]; }

function digitalChord(notes, fund, opts = {}) {
  const sr = opts.sr || 48000;
  const sig = blank(sr, opts.dur, opts.noise);
  notes.forEach((n, i) => addTone(sig, sr, LEAD + i * (opts.rollMs || 0) / 1000, freqOf(n), weakBassSpectrum(fund),
    { velocity: opts.velocity || 0.2, seed: 50 + i * 7 + (opts.seed || 0) }));
  return { sig, sr };
}

// Schroeder reverb (4 parallel combs + 2 all-passes), mixed back into the signal.
function addReverb(sig, sr, rt60, wet) {
  const dry = Float32Array.from(sig);
  const wetBuf = new Float32Array(sig.length);
  for (const ms of [29.7, 37.1, 41.1, 43.7]) {
    const d = Math.round((ms / 1000) * sr);
    const g = Math.pow(10, (-3 * ms / 1000) / rt60);
    const buf = new Float32Array(sig.length);
    for (let n = 0; n < sig.length; n++) {
      buf[n] = dry[n] + (n >= d ? g * buf[n - d] : 0);
      wetBuf[n] += buf[n] * 0.25;
    }
  }
  let x = wetBuf;
  for (const [ms, g] of [[5.0, 0.7], [1.7, 0.7]]) {
    const d = Math.round((ms / 1000) * sr);
    const y = new Float32Array(x.length);
    for (let n = 0; n < x.length; n++) {
      const xd = n >= d ? x[n - d] : 0;
      const yd = n >= d ? y[n - d] : 0;
      y[n] = -g * x[n] + xd + g * yd;
    }
    x = y;
  }
  // Scale the wet path so `wet` is roughly the reverberant/direct energy ratio.
  let ed = 0, ew = 0;
  for (let n = 0; n < sig.length; n++) { ed += dry[n] * dry[n]; ew += x[n] * x[n]; }
  const k = wet * Math.sqrt(ed / Math.max(ew, 1e-20));
  for (let n = 0; n < sig.length; n++) sig[n] = dry[n] + k * x[n];
  return sig;
}

// Steady mains hum (fundamental + harmonics), present from the first sample.
function addHum(sig, sr, base, level) {
  for (let h = 1; h <= 10; h++) {
    const w = (2 * Math.PI * base * h) / sr;
    const a = level / h;
    const ph = h * 1.3;
    for (let n = 0; n < sig.length; n++) sig[n] += a * Math.sin(w * n + ph);
  }
  return sig;
}

// Small loudspeaker / phone-mic low cut: `stages` cascaded 2nd-order Butterworth high-passes at fc.
// 4 stages = 48 dB/octave, like a tablet or a cheap keyboard's own speakers.
function highPass(sig, sr, fc, stages) {
  for (let s = 0; s < stages; s++) {
    const w = (2 * Math.PI * fc) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * Math.SQRT1_2);
    const b0 = (1 + c) / 2, b1 = -(1 + c), b2 = (1 + c) / 2, a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let n = 0; n < sig.length; n++) {
      const x = sig[n];
      const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      sig[n] = y;
    }
  }
  return sig;
}

function rms(sig, s, e) {
  let acc = 0;
  for (let n = s; n < e; n++) acc += sig[n] * sig[n];
  return Math.sqrt(acc / (e - s));
}

const third = (id) => (id === 'C' ? 'E' : 'Eb');
function voicing(id, R, inv) {
  const t = third(id);
  if (inv === 0) return ['C' + R, t + R, 'G' + R];
  if (inv === 1) return [t + R, 'G' + R, 'C' + (R + 1)];
  return ['G' + R, 'C' + (R + 1), t + (R + 1)];
}
const ALL = [];
for (const id of ['C', 'Cm']) for (const R of [3, 4, 5]) for (let inv = 0; inv < 3; inv++) ALL.push({ id, R, inv });

// ================================================================== 1. low-octave chords
test('C3 register: C / Cm across seeds, inversions, both sample rates (C\'s 5th partial sits on E5)', () => {
  const cases = [];
  for (const id of ['C', 'Cm']) for (let inv = 0; inv < 3; inv++) for (const seed of [11, 23, 37, 41]) for (const sr of SRS) {
    cases.push({ id, inv, seed, sr });
  }
  sweep(cases, ({ id, inv, seed, sr }) => {
    const notes = voicing(id, 3, inv);
    expectExactly(chord(notes, { sr, seed, velocity: 0.15 + (seed % 4) * 0.05 }), id, `${notes.join(' ')} seed ${seed} ${sr}`);
  });
});

test('C minor at C3 whose C has a 5th partial as loud as its fundamental -> Cm, never C', () => {
  // A C3 struck so that its 5th partial (≈ E5, 654 Hz) is as strong as the fundamental; E-flat soft.
  const Cspec = [1, 0.8, 0.6, 0.5, 1.0, 0.35, 0.25, 0.2, 0.15, 0.1];
  const piano = [1, 0.7, 0.5, 0.4, 0.3, 0.2, 0.15, 0.1, 0.07, 0.05];
  sweep(SRS.flatMap((sr) => [[0.12, sr], [0.2, sr]]), ([ebVel, sr]) => {
    const sig = blank(sr);
    addTone(sig, sr, LEAD, freqOf('C3'), Cspec, { velocity: 0.35, B: 0.0004 });
    addTone(sig, sr, LEAD, freqOf('Eb3'), piano, { velocity: ebVel, B: 0.0004 });
    addTone(sig, sr, LEAD, freqOf('G3'), piano, { velocity: 0.22, B: 0.0004 });
    expectExactly({ sig, sr }, 'Cm', `C3 (strong 5th) Eb3 @${ebVel} G3, ${sr}`);
  });
});

test('single loud C3 with a strong 5th partial -> nothing', () => {
  const Cspec = [1, 0.8, 0.7, 0.5, 1.0, 0.35, 0.25, 0.2, 0.15, 0.1];
  sweep(SRS, (sr) => {
    const sig = blank(sr);
    addTone(sig, sr, LEAD, freqOf('C3'), Cspec, { velocity: 0.45, B: 0.0004 });
    expectExactly({ sig, sr }, null, `C3 strong 5th, ${sr}`);
  });
});

// ================================================================== 2. wide / spread voicings
test('wide voicings without coincident partials: C3 G3 E4, C3 G3 Eb4, E3 C4 G4, Eb3 C4 G4, C4 G4 E5, C4 G4 Eb5', () => {
  const cases = [
    ['C', ['C3', 'G3', 'E4']], ['Cm', ['C3', 'G3', 'Eb4']],
    ['C', ['E3', 'C4', 'G4']], ['Cm', ['Eb3', 'C4', 'G4']],
    ['C', ['C4', 'G4', 'E5']], ['Cm', ['C4', 'G4', 'Eb5']],
    ['C', ['G3', 'E4', 'C5']], ['Cm', ['G3', 'Eb4', 'C5']],
  ].flatMap((c) => SRS.map((sr) => c.concat(sr)));
  sweep(cases, ([id, notes, sr]) => expectExactly(chord(notes, { sr }), id, `${notes.join(' ')} ${sr}`));
});

test.skip('open voicing C3 E4 G4 / C3 Eb4 G4 -> C / Cm (AMBIGUOUS: every partial of G4 coincides with C3\'s 3rd, 6th, 9th partials; ' +
  'only an amplitude model of C3 could tell a played G4 from C3\'s own overtones)', () => {});

test('open voicing C3 E4 G4 / C3 Eb4 G4: never the wrong chord (null is acceptable)', () => {
  for (const sr of SRS) {
    expectNotWrong(chord(['C3', 'E4', 'G4'], { sr }), 'C', `C3 E4 G4 ${sr}`);
    expectNotWrong(chord(['C3', 'Eb4', 'G4'], { sr }), 'Cm', `C3 Eb4 G4 ${sr}`);
  }
});

// ================================================================== 3. doubled notes
test('doubled roots and fifths: C4 E4 G4 C5, C3 E3 G3 C4, G3 C4 E4 G4 and the minor versions', () => {
  const cases = [];
  for (const id of ['C', 'Cm']) {
    const t = third(id);
    for (const notes of [['C4', t + '4', 'G4', 'C5'], ['C3', t + '3', 'G3', 'C4'], ['G3', 'C4', t + '4', 'G4'], ['C4', t + '4', 'G4', 'C5', t + '5']]) {
      for (const sr of SRS) cases.push({ id, notes, sr });
    }
  }
  sweep(cases, ({ id, notes, sr }) => expectExactly(chord(notes, { sr, velocity: 0.16 }), id, `${notes.join(' ')} ${sr}`));
});

test('two hands: left C3 G3 + right C4 E4 G4 (or C4 Eb4 G4)', () => {
  const cases = [];
  for (const id of ['C', 'Cm']) for (const sr of SRS) cases.push({ id, sr, notes: ['C3', 'G3', 'C4', third(id) + '4', 'G4'] });
  sweep(cases, ({ id, notes, sr }) => expectExactly(chord(notes, { sr, velocity: 0.15 }), id, `${notes.join(' ')} ${sr}`));
});

test.skip('bass octave + triad C3 C4 E4 G4 -> C (AMBIGUOUS: the only G is G4, which coincides with C3\'s 3rd partial, ' +
  'as in the open voicing above)', () => {});

test('bass octave + triad C3 C4 E4 G4 / C3 C4 Eb4 G4: never the wrong chord', () => {
  for (const sr of SRS) {
    expectNotWrong(chord(['C3', 'C4', 'E4', 'G4'], { sr }), 'C', `C3 C4 E4 G4 ${sr}`);
    expectNotWrong(chord(['C3', 'C4', 'Eb4', 'G4'], { sr }), 'Cm', `C3 C4 Eb4 G4 ${sr}`);
  }
});

// ================================================================== 4. inharmonicity
test('strong inharmonicity B = 0.001 in every octave and inversion', () => {
  const cases = ALL.flatMap((c) => SRS.map((sr) => Object.assign({ sr }, c)));
  sweep(cases, ({ id, R, inv, sr }) => {
    const notes = voicing(id, R, inv);
    expectExactly(chord(notes, { sr, B: 0.001, seed: R * 3 + inv }), id, `${notes.join(' ')} B=0.001 ${sr}`);
  });
});

test('register-dependent inharmonicity (B 0.0003 at C3 rising to ~0.0012 at C6), loud', () => {
  const Bof = (n) => 0.0003 * Math.pow(2, (sim.noteToMidi(n) - 48) / 18);
  sweep(ALL, ({ id, R, inv }) => {
    const notes = voicing(id, R, inv);
    const sr = 48000;
    const sig = blank(sr);
    notes.forEach((n, i) => sim.addPianoNote(sig, sr, LEAD, n, { velocity: 0.3, B: Bof(n), seed: 900 + i }));
    expectExactly({ sig, sr }, id, `${notes.join(' ')} per-note B`);
  });
});

test('upright piano treble: B doubling each octave (C4 0.0008, C5 0.0016, C6 0.0032) for the C5-octave inversions', () => {
  // Small uprights are this inharmonic in the treble. NOTE: this goes beyond the B <= 0.001 in the
  // brief for the top notes (C6, E-flat6, E6); it is how the "C5" inversions really sound on one.
  const cases = [];
  for (const id of ['C', 'Cm']) for (const inv of [0, 1, 2]) for (const sr of SRS) cases.push({ id, inv, sr });
  sweep(cases, ({ id, inv, sr }) => {
    const notes = voicing(id, 5, inv);
    const sig = blank(sr);
    notes.forEach((n, i) => sim.addPianoNote(sig, sr, LEAD, n, { velocity: 0.2, B: 0.0008 * Math.pow(2, (sim.noteToMidi(n) - 60) / 12), seed: 500 + i }));
    expectExactly({ sig, sr }, id, `${notes.join(' ')} upright B ${sr}`);
  });
});

// ================================================================== 5. digital pianos / small speakers
test('digital piano through small speakers (fundamental -9 dB under the 2nd harmonic): C3 and C4 chords', () => {
  const cases = [];
  for (const id of ['C', 'Cm']) for (const R of [3, 4]) for (const inv of [0, 1, 2]) for (const sr of SRS) cases.push({ id, R, inv, sr });
  sweep(cases, ({ id, R, inv, sr }) => {
    const notes = voicing(id, R, inv);
    expectExactly(digitalChord(notes, 0.35, { sr }), id, `${notes.join(' ')} fund 0.35 ${sr}`);
  });
});

test('digital piano, fundamental -20 dB under the 2nd harmonic (phone + tiny speaker): C3 chords', () => {
  // The ear still hears C3 (missing-fundamental pitch); the chroma must too, without C3's 5th partial
  // (E5) leaking into C minor.
  const cases = [];
  for (const id of ['C', 'Cm']) for (const inv of [0, 1, 2]) for (const sr of SRS) cases.push({ id, inv, sr });
  sweep(cases, ({ id, inv, sr }) => {
    const notes = voicing(id, 3, inv);
    expectExactly(digitalChord(notes, 0.1, { sr }), id, `${notes.join(' ')} fund 0.1 ${sr}`);
  });
});

test('digital piano with almost no fundamental (-30 dB): never the wrong chord', () => {
  sweep(['C', 'Cm'].flatMap((id) => [0, 1, 2].map((inv) => ({ id, inv }))), ({ id, inv }) => {
    const notes = voicing(id, 3, inv);
    expectNotWrong(digitalChord(notes, 0.03), id, `${notes.join(' ')} fund 0.03`);
  });
});

test('single notes and dyads with weak fundamentals are not chords (C3, C4, G3, C3+G3, C3+E3, C3+Eb3)', () => {
  // A weak-fundamental C3 has partials 2,3,5 = C4, G4, E5: a "C major" if the C3 itself is lost.
  const cases = [];
  for (const notes of [['C3'], ['C4'], ['G3'], ['C3', 'G3'], ['C3', 'E3'], ['C3', 'Eb3'], ['C4', 'G4']]) {
    for (const fund of [0.35, 0.1, 0.03]) cases.push({ notes, fund });
  }
  sweep(cases, ({ notes, fund }) => expectExactly(digitalChord(notes, fund, { velocity: 0.3 }), null, `${notes.join('+')} fund ${fund}`));
});

test('acoustic piano with the fundamental reduced to 0.15 (phone mic high-pass) in the C3 register', () => {
  const cases = [];
  for (const id of ['C', 'Cm']) for (const inv of [0, 1, 2]) cases.push({ id, inv });
  sweep(cases, ({ id, inv }) => {
    const notes = voicing(id, 3, inv);
    expectExactly(chord(notes, { fundamentalGain: 0.15, velocity: 0.25 }), id, `${notes.join(' ')} fundamentalGain 0.15`);
  });
});

test('single C3 with its fundamental lost (28 dB down or absent) is one note, not C major', () => {
  // The ear hears one C3 (missing-fundamental pitch). Its partials 2, 3 and 5 are C4, G4 and E5,
  // so a detector that loses the fundamental must not rebuild them into a C major triad.
  const cases = [];
  for (const fundamentalGain of [0.04, 0.02, 0]) for (const sr of SRS) for (const velocity of [0.25, 0.4]) cases.push({ fundamentalGain, sr, velocity });
  sweep(cases, ({ fundamentalGain, sr, velocity }) =>
    expectExactly(chord(['C3'], { sr, velocity, fundamentalGain }), null, `C3 fundamentalGain ${fundamentalGain} vel ${velocity} ${sr}`));
});

test('single notes and octaves played through small speakers (48 dB/oct low cut at 200-300 Hz) are not chords', () => {
  const cases = [];
  for (const notes of [['C3'], ['C3', 'C4'], ['C3', 'G3']]) for (const fc of [200, 250, 300]) for (const velocity of [0.2, 0.4]) cases.push({ notes, fc, velocity });
  sweep(cases, ({ notes, fc, velocity }) => {
    const r = chord(notes, { velocity });
    highPass(r.sig, r.sr, fc, 4);
    expectExactly(r, null, `${notes.join('+')} through ${fc} Hz speaker, vel ${velocity}`);
  });
});

test('C3 and C4 chords through a small speaker with a 200 Hz low cut', () => {
  const cases = [];
  for (const id of ['C', 'Cm']) for (const R of [3, 4]) for (const inv of [0, 1, 2]) cases.push({ id, R, inv });
  sweep(cases, ({ id, R, inv }) => {
    const notes = voicing(id, R, inv);
    const r = chord(notes, { velocity: 0.25 });
    highPass(r.sig, r.sr, 200, 4);
    expectExactly(r, id, `${notes.join(' ')} through 200 Hz speaker`);
  });
});

test.skip('C3-register chords through a 300 Hz low-cut speaker -> C / Cm (HARD, NOT REQUIRED: all three fundamentals ' +
  'are 30-50 dB down; only a missing-fundamental pitch model could recover them, and the C3 partials 2/3/5 then mimic C4 G4 E5)', () => {});

test('C3-register chords through a 300 Hz low-cut speaker: never the wrong chord', () => {
  for (const id of ['C', 'Cm']) for (let inv = 0; inv < 3; inv++) {
    const r = chord(voicing(id, 3, inv), { velocity: 0.25 });
    highPass(r.sig, r.sr, 300, 4);
    expectNotWrong(r, id, `${voicing(id, 3, inv).join(' ')} through 300 Hz speaker`);
  }
});

test('C minor at C3 with a heavy thumb and a weak C3 fundamental (upright piano, phone mic) -> Cm', () => {
  // C3 at 0.4, E-flat 0.15, G 0.2 (thumb ~8 dB louder than the middle finger is ordinary touch);
  // C3's fundamental 16 dB weaker than usual. C3's 5th partial (E5) must not be heard as an E.
  const cases = [];
  for (const sr of SRS) for (const seed of [1, 2, 3]) for (const fundamentalGain of [0.15, 0.12]) cases.push({ sr, seed, fundamentalGain });
  sweep(cases, ({ sr, seed, fundamentalGain }) => {
    const sig = blank(sr);
    sim.addPianoNote(sig, sr, LEAD, 'C3', { velocity: 0.4, fundamentalGain, seed });
    sim.addPianoNote(sig, sr, LEAD, 'Eb3', { velocity: 0.15, seed: seed + 10 });
    sim.addPianoNote(sig, sr, LEAD, 'G3', { velocity: 0.2, seed: seed + 20 });
    expectExactly({ sig, sr }, 'Cm', `C3(fund ${fundamentalGain}) Eb3 G3 seed ${seed} ${sr}`);
  });
});

test('same heavy-thumb C minor with the C3 fundamental almost gone: never C major', () => {
  for (const sr of SRS) for (const fundamentalGain of [0.06, 0.03]) for (const ebVel of [0.15, 0.06, 0.03]) {
    const sig = blank(sr);
    sim.addPianoNote(sig, sr, LEAD, 'C3', { velocity: 0.4, fundamentalGain, seed: 1 });
    sim.addPianoNote(sig, sr, LEAD, 'Eb3', { velocity: ebVel, seed: 11 });
    sim.addPianoNote(sig, sr, LEAD, 'G3', { velocity: 0.2, seed: 21 });
    expectNotWrong({ sig, sr }, 'Cm', `C3(fund ${fundamentalGain}) Eb3@${ebVel} G3 ${sr}`);
  }
});

// ================================================================== 6. reverb and sustain
test('room reverb (RT60 1.2 s, reverberant energy = direct): chords in C3 and C4, reported once', () => {
  const cases = [];
  for (const id of ['C', 'Cm']) for (const R of [3, 4]) for (const inv of [0, 2]) cases.push({ id, R, inv });
  sweep(cases, ({ id, R, inv }) => {
    const notes = voicing(id, R, inv);
    const r = chord(notes, { dur: 3.5 });
    addReverb(r.sig, r.sr, 1.2, 1.0);
    expectExactly(r, id, `${notes.join(' ')} reverb`);
  });
});

test('very live room (RT60 2.5 s, reverb twice the direct sound), C4 chords', () => {
  sweep(['C', 'Cm'], (id) => {
    const r = chord(voicing(id, 4, 0), { dur: 3.5 });
    addReverb(r.sig, r.sr, 2.5, 2.0);
    expectExactly(r, id, `${voicing(id, 4, 0).join(' ')} big reverb`);
  });
});

test('reverberant tail of the lesson melody (... E4 D4 C4) under the chord', () => {
  // The melody ends 0.7 s before the chord; its reverb tail is still audible (about 20 dB down).
  sweep(['C', 'Cm'], (id) => {
    const sr = 48000;
    const sig = blank(sr, 3.6);
    ['E4', 'D4', 'C4'].forEach((n, i) => sim.addPianoNote(sig, sr, 0.1 + i * 0.35, n, { velocity: 0.2, holdSec: 0.3, seed: 70 + i }));
    sim.addChord(sig, sr, 1.5, voicing(id, 4, 0), { velocity: 0.2, seed: 9 });
    addReverb(sig, sr, 1.5, 1.0);
    expectExactly({ sig, sr }, id, `${id} after reverberant melody`);
  });
});

test('sustain pedal: a chord tone from the lesson still ringing under the chord (G4, C5, C4)', () => {
  const cases = [];
  for (const id of ['C', 'Cm']) for (const prev of ['G4', 'C5', 'C4']) cases.push({ id, prev });
  sweep(cases, ({ id, prev }) => {
    const sr = 48000;
    const sig = blank(sr, 3.6);
    sim.addPianoNote(sig, sr, 0.1, prev, { velocity: 0.25, seed: 5 }); // never released
    sim.addChord(sig, sr, 1.2, voicing(id, 4, 0), { velocity: 0.2, seed: 6 });
    expectExactly({ sig, sr }, id, `${id} over pedalled ${prev}`);
  });
});

test('sustain pedal: the other third (E4 or Eb4) still ringing under the chord -> never the wrong chord', () => {
  for (const [id, prev] of [['Cm', 'E4'], ['C', 'Eb4']]) {
    const sr = 48000;
    const sig = blank(sr, 3.6);
    sim.addPianoNote(sig, sr, 0.1, prev, { velocity: 0.25, seed: 5 });
    sim.addChord(sig, sr, 1.2, voicing(id, 4, 0), { velocity: 0.2, seed: 6 });
    expectNotWrong({ sig, sr }, id, `${id} over pedalled ${prev}`);
  }
});

test('a held chord under the pedal in a reverberant room is reported exactly once', () => {
  for (const id of ['C', 'Cm']) {
    const r = chord(voicing(id, 3, 0), { dur: 6, velocity: 0.3 });
    addReverb(r.sig, r.sr, 2.0, 1.5);
    expectExactly(r, id, `${id} held 6 s with reverb`);
  }
});

// ================================================================== 7. very soft playing
test('pp chord just above a noisy room (chord RMS ~0.0075, noise 0.0008, about 19 dB SNR)', () => {
  const cases = [];
  for (const id of ['C', 'Cm']) for (const R of [3, 4]) for (const sr of SRS) cases.push({ id, R, sr });
  sweep(cases, ({ id, R, sr }) => {
    const notes = voicing(id, R, 0);
    expectExactly(chord(notes, { sr, velocity: 0.015, noise: 0.0008 }), id, `${notes.join(' ')} pp in noise ${sr}`);
  });
});

test('pp chord in a quiet room with mic AGC off (chord about -50 dBFS, room about -80 dBFS)', () => {
  // With autoGainControl:false a phone 1-2 m from the piano records soft playing this low.
  const cases = [];
  for (const id of ['C', 'Cm']) for (const R of [3, 4]) cases.push({ id, R });
  sweep(cases, ({ id, R }) => {
    const notes = voicing(id, R, 0);
    const r = chord(notes, { velocity: 0.006, noise: 0.0001 });
    const level = rms(r.sig, Math.round((LEAD + 0.05) * r.sr), Math.round((LEAD + 0.3) * r.sr));
    assert.ok(level > 0.002 && level < 0.005, `test setup: chord RMS ${level}`);
    expectExactly(r, id, `${notes.join(' ')} at RMS ${level.toFixed(4)}`);
  });
});

test('ppp chord in a quiet room with mic AGC off (chord about -54 dBFS, room about -86 dBFS, 30+ dB SNR)', () => {
  // A MEMS phone mic (~-26 dBFS at 94 dB SPL) 1-2 m from a piano played pp (~55-60 dB SPL) records
  // around -60 dBFS once autoGainControl is off; the harmonic peaks are still 40+ dB clear of the room.
  const cases = [];
  for (const id of ['C', 'Cm']) for (const R of [3, 4]) for (const sr of SRS) cases.push({ id, R, sr });
  sweep(cases, ({ id, R, sr }) => {
    const notes = voicing(id, R, 0);
    const r = chord(notes, { sr, velocity: 0.004, noise: 0.00005 });
    const level = rms(r.sig, Math.round((LEAD + 0.05) * r.sr), Math.round((LEAD + 0.3) * r.sr));
    assert.ok(level > 0.0012 && level < 0.0028, `test setup: chord RMS ${level}`);
    expectExactly(r, id, `${notes.join(' ')} at RMS ${level.toFixed(4)} ${sr}`);
  });
});

test('overall input gain does not change the answer (the same recording at x0.05, x0.2, x0.5, x2)', () => {
  const cases = [];
  for (const id of ['C', 'Cm']) for (const g of [0.05, 0.2, 0.5, 2]) cases.push({ id, g });
  sweep(cases, ({ id, g }) => {
    const r = chord(voicing(id, 4, 1), { velocity: 0.08, noise: 0.0004 });
    for (let n = 0; n < r.sig.length; n++) r.sig[n] *= g;
    expectExactly(r, id, `${id} gain x${g}`);
  });
});

test('soft notes at the noise floor never become the wrong chord (velocity 0.004 in 0.0008 noise)', () => {
  for (const id of ['C', 'Cm']) expectNotWrong(chord(voicing(id, 4, 0), { velocity: 0.004, noise: 0.0008 }), id, `${id} ppp`);
});

// ================================================================== 8. tuning
test('A = 432 Hz and A = 445 Hz tuning, every octave and inversion', () => {
  const cases = [];
  for (const c of ALL) for (const a4 of [432, 445]) cases.push(Object.assign({ a4 }, c));
  sweep(cases, ({ id, R, inv, a4 }) => {
    const notes = voicing(id, R, inv);
    const tuneCents = 1200 * Math.log2(a4 / 440);
    expectExactly(chord(notes, { tuneCents, seed: R + inv }), id, `${notes.join(' ')} A=${a4}`);
  });
});

test('neglected piano: A = 435 plus up to ±12 cents per note, C3 and C4', () => {
  const cases = [];
  for (const id of ['C', 'Cm']) for (const R of [3, 4]) for (const pattern of [[12, -12, 8], [-12, 12, -8], [10, 10, -12]]) cases.push({ id, R, pattern });
  sweep(cases, ({ id, R, pattern }) => {
    const notes = voicing(id, R, 0);
    const sr = 48000;
    const sig = blank(sr);
    const base = 1200 * Math.log2(435 / 440);
    notes.forEach((n, i) => sim.addPianoNote(sig, sr, LEAD, n, { velocity: 0.2, tuneCents: base + pattern[i], seed: 300 + i }));
    expectExactly({ sig, sr }, id, `${notes.join(' ')} cents ${pattern}`);
  });
});

test('three slightly mistuned unison strings per note (±3 cents, beating), C3 to C5', () => {
  const cases = [];
  for (const id of ['C', 'Cm']) for (const R of [3, 4, 5]) cases.push({ id, R });
  sweep(cases, ({ id, R }) => {
    const notes = voicing(id, R, 0);
    const sr = 48000;
    const sig = blank(sr, 3);
    notes.forEach((n, i) => [-3, 0.5, 3].forEach((c, j) =>
      sim.addPianoNote(sig, sr, LEAD, n, { velocity: 0.2 / Math.sqrt(3), tuneCents: c, seed: 400 + i * 10 + j, thump: j ? 0 : 0.4 })));
    expectExactly({ sig, sr }, id, `${notes.join(' ')} unisons`);
  });
});

test.skip('quarter-tone-out piano (±50 cents) (AMBIGUOUS: E-flat +50 cents is exactly halfway to E)', () => {});

// ================================================================== 9. room noise sources
test('steady mains hum (50 / 60 Hz with harmonics, ~26 dB under the chord) does not block the chord', () => {
  const cases = [];
  for (const id of ['C', 'Cm']) for (const base of [50, 60]) for (const R of [3, 4]) cases.push({ id, base, R });
  sweep(cases, ({ id, base, R }) => {
    const notes = voicing(id, R, 0);
    const r = chord(notes, { velocity: 0.2 });
    addHum(r.sig, r.sr, base, 0.006);
    expectExactly(r, id, `${notes.join(' ')} with ${base} Hz hum`);
  });
});

test('steady hum alone, then a single C3 over it -> nothing', () => {
  for (const base of [50, 60]) {
    const sr = 48000;
    const sig = blank(sr);
    addHum(sig, sr, base, 0.006);
    sim.addPianoNote(sig, sr, LEAD, 'C3', { velocity: 0.35 });
    expectExactly({ sig, sr }, null, `C3 over ${base} Hz hum`);
  }
});

// ================================================================== 10. near-miss chords (must stay null)
test('near-miss chords sharing two notes with C or Cm are not reported (Ab, Cm7, Am7, Ab/C, C6, Cadd-b6)', () => {
  const cases = [
    ['Ab major Ab3 C4 Eb4', ['Ab3', 'C4', 'Eb4']],
    ['Ab/C C4 Eb4 Ab4', ['C4', 'Eb4', 'Ab4']],
    ['Cm7 C4 Eb4 G4 Bb4', ['C4', 'Eb4', 'G4', 'Bb4']],
    ['Am7 A3 C4 E4 G4', ['A3', 'C4', 'E4', 'G4']],
    ['C6 C4 E4 G4 A4', ['C4', 'E4', 'G4', 'A4']],
    ['C minor + Ab C4 Eb4 G4 Ab4', ['C4', 'Eb4', 'G4', 'Ab4']],
    ['Em/C C3 E3 G3 B3', ['C3', 'E3', 'G3', 'B3']],
  ].flatMap((c) => SRS.map((sr) => c.concat(sr)));
  sweep(cases, ([label, notes, sr]) => expectExactly(chord(notes, { sr }), null, `${label} ${sr}`));
});

test('loud near-miss chords and C3 dyads with B = 0.001 are not reported', () => {
  const cases = [['F major', ['F3', 'A3', 'C4']], ['Ab major', ['Ab3', 'C4', 'Eb4']], ['A minor', ['A3', 'C4', 'E4']], ['C+G', ['C3', 'G3']], ['C3 ringing', ['C3']]];
  sweep(cases, ([label, notes]) => expectExactly(chord(notes, { B: 0.001, velocity: 0.35 }), null, `${label} B=0.001 loud`));
});

// ================================================================== 11. randomised real-world mix
test('randomised acoustic conditions: right chord exactly once, wrong chord never', () => {
  const rand = sim.rng(20261021);
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const cases = [];
  for (let i = 0; i < 24; i++) {
    const id = i % 2 ? 'Cm' : 'C';
    cases.push({
      i, id,
      R: pick([3, 4, 4, 5]),
      inv: pick([0, 1, 2]),
      sr: pick(SRS),
      B: 0.0002 + rand() * 0.0008,
      tune: (rand() - 0.5) * 50, // ±25 cents, whole instrument
      vels: [0, 1, 2].map(() => 0.06 + rand() * 0.3),
      rollMs: pick([0, 0, 15, 30]),
      digital: rand() < 0.3,
      reverb: rand() < 0.4,
      noise: pick([0.0002, 0.0005, 0.001]),
    });
  }
  sweep(cases, (c) => {
    const notes = voicing(c.id, c.R, c.inv);
    const r = chord(notes, { sr: c.sr, B: c.digital ? undefined : c.B, tuneCents: c.tune, velocities: c.vels, rollMs: c.rollMs, digital: c.digital, noise: c.noise, seed: c.i + 1, dur: 3 });
    if (c.reverb) addReverb(r.sig, r.sr, 1.0, 0.8);
    const got = run(r);
    const desc = `#${c.i} ${notes.join(' ')} sr=${c.sr} B=${c.B.toFixed(4)} tune=${c.tune.toFixed(0)}c vel=${c.vels.map((v) => v.toFixed(2))} roll=${c.rollMs} dig=${c.digital} rev=${c.reverb} noise=${c.noise}`;
    assert.ok(!got.includes(wrongOf(c.id)), `${desc}: WRONG chord [${got}]`);
    assert.deepEqual(got, [c.id], `${desc}: got [${got}]`);
  });
});
