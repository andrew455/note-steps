// Chord detector tests. Run: node --test tests/
// Everything is synthesized: piano-like tones go through an AnalyserNode emulation frame by frame.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const sim = require('./audio-sim.js');
const CD = require(path.join(__dirname, '..', 'chords.js'));

const LEAD = 0.4; // seconds of mic noise before the chord

function render(notes, opts = {}) {
  const sr = opts.sr || 48000;
  const sig = new Float32Array(Math.round(sr * (opts.dur || 2.6)));
  sim.addNoise(sig, sr, opts.noise != null ? opts.noise : 0.0004, opts.seed || 7);
  if (notes && notes.length) sim.addChord(sig, sr, opts.at != null ? opts.at : LEAD, notes, opts);
  return { sig, sr };
}

function detect({ sig, sr }, detOpts, runOpts) {
  return sim.runDetector(sig, sr, CD.createDetector(detOpts), runOpts);
}

function names(events) { return events.map((e) => e.name); }

// Voicings with the chord's C at octave R: root position, first inversion (E in the bass),
// second inversion (G in the bass).
function voicing(id, R, inv) {
  const third = id === 'C' ? 'E' : 'Eb';
  if (inv === 0) return ['C' + R, third + R, 'G' + R];
  if (inv === 1) return [third + R, 'G' + R, 'C' + (R + 1)];
  return ['G' + R, 'C' + (R + 1), third + (R + 1)];
}
const INV = ['root position', '1st inversion', '2nd inversion'];

// ------------------------------------------------------------------ the main matrix
for (const id of ['C', 'Cm']) {
  for (const R of [3, 4, 5]) {
    for (let inv = 0; inv < 3; inv++) {
      for (const [dyn, velocity] of [['soft', 0.03], ['loud', 0.35]]) {
        for (const sr of [44100, 48000]) {
          const notes = voicing(id, R, inv);
          test(`${id} at C${R}, ${INV[inv]} (${notes.join(' ')}), ${dyn}, ${sr} Hz -> ${id}`, () => {
            const ev = detect(render(notes, { sr, velocity, seed: R * 10 + inv }));
            assert.deepEqual(names(ev), [id]);
            const latency = ev[0].tMs - LEAD * 1000;
            assert.ok(latency > 150 && latency < 800, `latency ${latency.toFixed(0)} ms`);
          });
        }
      }
    }
  }
}

// ------------------------------------------------------------------ things that are not C or Cm
const NULL_CASES = [
  ['single C4', ['C4']],
  ['single C3, loud and ringing (5th harmonic is E)', ['C3'], { velocity: 0.5 }],
  ['single C4, soft', ['C4'], { velocity: 0.03 }],
  ['single E4', ['E4']],
  ['single Eb4', ['Eb4']],
  ['C4 + G4 (no third)', ['C4', 'G4']],
  ['C3 + G3, loud (no third)', ['C3', 'G3'], { velocity: 0.45 }],
  ['C4 + E4 (no fifth)', ['C4', 'E4']],
  ['C4 + Eb4 (no fifth)', ['C4', 'Eb4']],
  ['F major (F3 A3 C4)', ['F3', 'A3', 'C4']],
  ['F major (C4 F4 A4)', ['C4', 'F4', 'A4']],
  ['G major (G3 B3 D4)', ['G3', 'B3', 'D4']],
  ['A minor (A3 C4 E4)', ['A3', 'C4', 'E4']],
  ['A minor (C4 E4 A4)', ['C4', 'E4', 'A4']],
  ['E minor (E4 G4 B4)', ['E4', 'G4', 'B4']],
  ['Eb major (Eb4 G4 Bb4)', ['Eb4', 'G4', 'Bb4']],
  ['C7 (C4 E4 G4 Bb4)', ['C4', 'E4', 'G4', 'Bb4']],
  ['Cmaj7 (C4 E4 G4 B4)', ['C4', 'E4', 'G4', 'B4']],
  ['C sus4 (C4 F4 G4)', ['C4', 'F4', 'G4']],
  ['C augmented (C4 E4 G#4)', ['C4', 'E4', 'G#4']],
  ['C major + C minor clash (C4 Eb4 E4 G4)', ['C4', 'Eb4', 'E4', 'G4']],
];
for (const [label, notes, extra] of NULL_CASES) {
  for (const sr of [44100, 48000]) {
    test(`${label}, ${sr} Hz -> nothing`, () => {
      const ev = detect(render(notes, Object.assign({ sr, velocity: 0.2 }, extra)));
      assert.deepEqual(names(ev), []);
    });
  }
}

test('silence (mic self-noise only) -> nothing', () => {
  for (const sr of [44100, 48000]) assert.deepEqual(names(detect(render([], { sr, dur: 3 }))), []);
});

test('white noise switched on suddenly -> nothing', () => {
  for (const [level, sr] of [[0.02, 48000], [0.1, 44100], [0.3, 48000]]) {
    const r = render([], { sr, dur: 3 });
    sim.addNoise(r.sig, r.sr, level, 11, 0.5, 2.5);
    assert.deepEqual(names(detect(r)), [], `noise level ${level}`);
  }
});

test('speech-like voice -> nothing', () => {
  for (const sr of [44100, 48000]) {
    const r = render([], { sr, dur: 4 });
    sim.addVoice(r.sig, r.sr, 0.5, 3, 0.2, 21);
    assert.deepEqual(names(detect(r)), []);
  }
});

// ------------------------------------------------------------------ realistic playing
test('rolled chords (notes up to 80 ms apart) still count', () => {
  for (const [id, notes] of [['C', ['C4', 'E4', 'G4']], ['Cm', ['C4', 'Eb4', 'G4']], ['C', ['G3', 'C4', 'E4']], ['Cm', ['C3', 'Eb3', 'G3']]]) {
    for (const rollMs of [25, 40]) {
      assert.deepEqual(names(detect(render(notes, { rollMs }))), [id], `${notes.join(' ')} rolled ${rollMs} ms/note`);
    }
  }
});

test('digital piano spectra (smooth, near-harmonic)', () => {
  for (const id of ['C', 'Cm']) {
    for (const R of [3, 4, 5]) {
      for (const sr of [44100, 48000]) {
        const notes = voicing(id, R, R % 3);
        assert.deepEqual(names(detect(render(notes, { sr, digital: true }))), [id], notes.join(' '));
      }
    }
  }
});

test('strong inharmonicity (B = 0.001) and an out-of-tune piano (±30 cents)', () => {
  for (const id of ['C', 'Cm']) {
    for (const [B, tuneCents] of [[0.001, 0], [0.0004, 30], [0.0004, -30]]) {
      for (const R of [3, 4]) {
        const notes = voicing(id, R, 0);
        assert.deepEqual(names(detect(render(notes, { B, tuneCents }))), [id], `${notes.join(' ')} B=${B} tune=${tuneCents}`);
      }
    }
  }
});

test('uneven touch: one note much softer than the others', () => {
  for (const id of ['C', 'Cm']) {
    for (const velocities of [[0.3, 0.1, 0.2], [0.1, 0.3, 0.2], [0.2, 0.2, 0.07]]) {
      const notes = voicing(id, 4, 0);
      assert.deepEqual(names(detect(render(notes, { velocities }))), [id], `${notes.join(' ')} ${velocities}`);
    }
  }
});

test('weak fundamentals (small phone mic, low notes)', () => {
  for (const id of ['C', 'Cm']) {
    for (const inv of [0, 1, 2]) {
      const notes = voicing(id, 3, inv);
      assert.deepEqual(names(detect(render(notes, { fundamentalGain: 0.3 }))), [id], notes.join(' '));
    }
  }
});

test('C minor with C much louder than E-flat is not heard as C major', () => {
  // The loud C's 5th harmonic is almost exactly E: the classic trap.
  for (const R of [3, 4]) {
    const notes = voicing('Cm', R, 0);
    const ev = names(detect(render(notes, { velocities: [0.45, 0.12, 0.25] })));
    assert.ok(!ev.includes('C'), `${notes.join(' ')} gave ${ev}`);
    assert.deepEqual(ev, ['Cm']);
  }
});

test('chord played while the last lesson note is still dying away', () => {
  for (const [prev, id] of [['E4', 'Cm'], ['Eb4', 'C'], ['C5', 'C'], ['G4', 'Cm']]) {
    const r = render([], { dur: 3.4 });
    sim.addPianoNote(r.sig, r.sr, 0.2, prev, { velocity: 0.2, holdSec: 0.5 });
    sim.addChord(r.sig, r.sr, 1.0, voicing(id, 4, 0), { velocity: 0.2 });
    assert.deepEqual(names(detect(r)), [id], `after ${prev}`);
  }
});

test('irregular frame timing (setInterval jitter) and 25/40 ms intervals', () => {
  for (const id of ['C', 'Cm']) {
    for (const runOpts of [{ jitterMs: 10 }, { intervalMs: 25 }, { intervalMs: 40, jitterMs: 8 }]) {
      assert.deepEqual(names(detect(render(voicing(id, 4, 1)), undefined, runOpts)), [id], JSON.stringify(runOpts));
    }
  }
});

// ------------------------------------------------------------------ detector behaviour
test('a held chord is reported exactly once', () => {
  const ev = detect(render(['C4', 'E4', 'G4'], { dur: 5 }));
  assert.deepEqual(names(ev), ['C']);
});

test('two separate strikes are reported twice; a re-strike inside the cooldown is not', () => {
  const r = render([], { dur: 5 });
  sim.addChord(r.sig, r.sr, 0.4, ['C4', 'Eb4', 'G4'], { holdSec: 0.8, seed: 1 });
  sim.addChord(r.sig, r.sr, 2.8, ['C4', 'E4', 'G4'], { holdSec: 1, seed: 2 });
  assert.deepEqual(names(detect(r)), ['Cm', 'C']);

  const q = render([], { dur: 3 });
  sim.addChord(q.sig, q.sr, 0.4, ['C4', 'E4', 'G4'], { holdSec: 0.4, seed: 3 });
  sim.addChord(q.sig, q.sr, 1.1, ['C4', 'E4', 'G4'], { seed: 4 });
  assert.deepEqual(names(detect(q)), ['C']);
});

test('holdMs and cooldownMs options are honoured', () => {
  const r = render(['C4', 'E4', 'G4']);
  const fast = detect(r, { holdMs: 150 })[0].tMs;
  const slow = detect(r, { holdMs: 250 })[0].tMs;
  assert.ok(slow - fast >= 90, `hold 150 -> ${fast}, hold 250 -> ${slow}`);

  const q = render([], { dur: 3 });
  sim.addChord(q.sig, q.sr, 0.4, ['C4', 'E4', 'G4'], { holdSec: 0.4, seed: 3 });
  sim.addChord(q.sig, q.sr, 1.4, ['C4', 'Eb4', 'G4'], { seed: 4 });
  assert.deepEqual(names(detect(q, { cooldownMs: 300 })), ['C', 'Cm']);
});

test('reset() clears the state', () => {
  const r = render(['C4', 'E4', 'G4']);
  const det = CD.createDetector();
  assert.deepEqual(names(sim.runDetector(r.sig, r.sr, det)), ['C']);
  det.reset();
  assert.deepEqual(names(sim.runDetector(r.sig, r.sr, det)), ['C']);
});

test('no rms argument: the detector estimates the level from the spectrum', () => {
  const { sig, sr } = render(['C4', 'Eb4', 'G4']);
  const an = new sim.AnalyserSim({ sampleRate: sr });
  const det = CD.createDetector();
  const out = [];
  for (let t = 30; t < 2600; t += 30) {
    const db = an.frequencyData(an.timeDomain(sig, t / 1000));
    const n = det.push(db, sr, 16384, t);
    if (n) out.push(n);
  }
  assert.deepEqual(out, ['Cm']);
});

// ------------------------------------------------------------------ the pure functions
test('chromaFromSpectrum: C minor at C3 keeps E (the 5th harmonic of C) out of the chroma', () => {
  for (const sr of [44100, 48000]) {
    const { sig } = render(['C3', 'Eb3', 'G3'], { sr, velocities: [0.4, 0.15, 0.2] });
    const db = sim.spectrumAt(sig, sr, LEAD + 0.4);
    const ch = CD.chromaFromSpectrum(db, sr, 16384);
    assert.ok(ch instanceof Float32Array && ch.length === 12);
    const max = Math.max(...ch);
    assert.ok(ch[3] > 0.2 * max, 'E-flat present');
    assert.ok(ch[4] < 0.05 * max, `E leaked: ${(ch[4] / max).toFixed(3)}`);
    assert.ok(ch[0] > 0.2 * max && ch[7] > 0.2 * max, 'C and G present');
  }
});

test('chromaFromSpectrum: silence and -Infinity bins give an all-zero chroma', () => {
  const db = new Float32Array(8192).fill(-Infinity);
  assert.deepEqual(Array.from(CD.chromaFromSpectrum(db, 48000, 16384)), new Array(12).fill(0));
});

test('classify: shapes, margins and rejections', () => {
  const ch = (o) => { const c = new Float32Array(12); for (const k in o) c[k] = o[k]; return c; };
  const major = CD.classify(ch({ 0: 1, 4: 0.8, 7: 0.9 }));
  assert.equal(major.name, 'C');
  assert.ok(major.confidence > 0.5 && major.scores.C > major.scores.Cm);
  assert.equal(CD.classify(ch({ 0: 1, 3: 0.8, 7: 0.9 })).name, 'Cm');
  assert.equal(CD.classify(ch({ 0: 1, 3: 0.8, 4: 0.1, 7: 0.9 })).name, 'Cm');
  assert.equal(CD.classify(ch({ 0: 1, 3: 0.6, 4: 0.6, 7: 0.9 })).name, null, 'both thirds');
  assert.equal(CD.classify(ch({ 0: 1, 7: 0.9 })).name, null, 'no third');
  assert.equal(CD.classify(ch({ 0: 1, 4: 0.8 })).name, null, 'no fifth');
  assert.equal(CD.classify(ch({ 0: 1, 4: 0.8, 7: 0.9, 10: 0.7 })).name, null, 'C7');
  assert.equal(CD.classify(ch({ 0: 1, 4: 0.8, 9: 0.9 })).name, null, 'A minor');
  assert.equal(CD.classify(ch({ 0: 1, 4: 0.8, 7: 0.9, 2: 0.1 })).name, 'C', 'a little leakage is fine');
  assert.equal(CD.classify(new Float32Array(12)).name, null);
  const none = CD.classify(new Float32Array(12));
  assert.deepEqual(none.scores, { C: 0, Cm: 0 });
  assert.equal(none.confidence, 0);
});

// ------------------------------------------------------------------ browser glue
test('attach(): own analyser on the source, interval loop, onChord, stop and dispose', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const sr = 48000;
  const { sig } = render(['G3', 'C4', 'Eb4'], { sr });
  let clock = 0;
  const connections = [];
  const fakeAnalyser = {
    fftSize: 2048,
    smoothingTimeConstant: 0.8,
    get frequencyBinCount() { return this.fftSize / 2; },
    sim: null,
    td: null,
    getFloatTimeDomainData(out) {
      this.sim = this.sim || new sim.AnalyserSim({ fftSize: this.fftSize, smoothingTimeConstant: this.smoothingTimeConstant, sampleRate: sr });
      this.td = this.sim.timeDomain(sig, clock / 1000);
      out.set(this.td);
    },
    getFloatFrequencyData(out) {
      this.sim = this.sim || new sim.AnalyserSim({ fftSize: this.fftSize, smoothingTimeConstant: this.smoothingTimeConstant, sampleRate: sr });
      out.set(this.sim.frequencyData(this.sim.timeDomain(sig, clock / 1000)));
    },
  };
  const ctx = { sampleRate: sr, createAnalyser: () => fakeAnalyser };
  const source = {
    connect(n) { connections.push(['connect', n]); return n; },
    disconnect(n) { connections.push(['disconnect', n]); },
  };
  const heard = [];
  const h = CD.attach(ctx, source, { onChord: (n) => heard.push(n), now: () => clock });
  assert.equal(fakeAnalyser.fftSize, 16384);
  assert.equal(fakeAnalyser.smoothingTimeConstant, 0.5);
  assert.deepEqual(connections, [['connect', fakeAnalyser]]);

  h.start();
  for (clock = 30; clock <= 2500; clock += 30) t.mock.timers.tick(30);
  assert.deepEqual(heard, ['Cm']);

  h.stop();
  const before = heard.length;
  t.mock.timers.tick(3000);
  assert.equal(heard.length, before);
  h.dispose();
  assert.deepEqual(connections[1], ['disconnect', fakeAnalyser]);
  h.dispose(); // twice is harmless
});

// ------------------------------------------------------------------ fingering text (chord-card.js)
test('chord-card fingering hints read plainly', () => {
  const CC = require(path.join(__dirname, '..', 'chord-card.js'));
  assert.equal(CC.fingeringHint(['C4', 'E4', 'G4'], [1, 3, 5]),
    'Right hand: thumb on C, middle finger on E, little finger on G.');
  assert.equal(CC.fingeringHint(['C4', 'Eb4', 'G4'], [1, 3, 5]),
    'Right hand: thumb on C, middle finger on E♭ (the black key just left of E), little finger on G.');
});
