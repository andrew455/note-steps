// Adversarial runtime / integration tests for chords.js and chord-card.js.
// Run: node --test tests/   (or node --test tests/chords.attack-runtime.test.js)
//
// Each test encodes what a good chord detector / card should do. Cases that are genuinely
// ambiguous (no right answer from the audio alone) are marked skip with the reason.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sim = require('./audio-sim.js');

const ROOT = path.join(__dirname, '..');
const CD = require(path.join(ROOT, 'chords.js'));
const CC = require(path.join(ROOT, 'chord-card.js'));

const LEAD = 0.4; // seconds of mic noise before the first chord

// ------------------------------------------------------------------ helpers
function blank(sr, dur, noise = 0.0004, seed = 7) {
  const sig = new Float32Array(Math.round(sr * dur));
  sim.addNoise(sig, sr, noise, seed);
  return sig;
}
function chordSignal(notes, opts = {}) {
  const sr = opts.sr || 48000;
  const sig = blank(sr, opts.dur || 2.6, opts.noise, opts.noiseSeed);
  sim.addChord(sig, sr, opts.at != null ? opts.at : LEAD, notes, opts);
  return { sig, sr };
}
const names = (ev) => ev.map((e) => e.name);

// Feeds frames at explicit times (ms), like a browser timer that fires irregularly.
function runAt(signal, sr, det, times, opts = {}) {
  const fftSize = opts.fftSize || 16384;
  const an = new sim.AnalyserSim({ fftSize, smoothingTimeConstant: opts.smoothing != null ? opts.smoothing : 0.5, sampleRate: sr });
  const td = new Float32Array(fftSize);
  const db = new Float32Array(fftSize / 2);
  const ev = [];
  for (const t of times) {
    an.timeDomain(signal, t / 1000, td);
    an.frequencyData(td, db);
    const n = det.push(db, sr, fftSize, t, sim.tailRms(td, 2048));
    if (n) ev.push({ name: n, tMs: t });
  }
  return ev;
}
function irregularTimes(totalMs, minGap, maxGap, seed, stall) {
  const rand = sim.rng(seed);
  const out = [];
  let t = 10;
  while (t < totalMs) {
    out.push(t);
    t += minGap + rand() * (maxGap - minGap);
    if (stall && t > stall.at && t - stall.at < maxGap) t += stall.ms; // one long hiccup (GC, tab work)
  }
  return out;
}
function detect(sigObj, detOpts, runOpts) {
  return sim.runDetector(sigObj.sig, sigObj.sr, CD.createDetector(detOpts), runOpts);
}

// The app's own popup tone (app.js playTone): triangle + 2nd + 3rd harmonic sines, 10 ms attack,
// exponential decay to silence over `dur`. Heard through the phone speaker -> mic.
function addAppTone(out, sr, startSec, midi, dur = 0.3, level = 0.3) {
  const f = sim.midiToFreq(midi);
  const s = Math.round(startSec * sr);
  const n1 = Math.min(out.length - s, Math.round((dur + 0.05) * sr));
  const parts = [];
  for (let k = 1; k <= 15; k += 2) parts.push([f * k, 0.6 * (8 / (Math.PI * Math.PI)) * (((k - 1) / 2) % 2 ? -1 : 1) / (k * k)]);
  parts.push([2 * f, 0.18], [3 * f, 0.06]);
  for (let n = 0; n < n1; n++) {
    const t = n / sr;
    const g = t < 0.01 ? 0.0001 * Math.pow(0.3 / 0.0001, t / 0.01) : 0.3 * Math.pow(0.0001 / 0.3, Math.min(1, (t - 0.01) / (dur - 0.01)));
    let x = 0;
    for (const [fr, a] of parts) if (fr < sr / 2) x += a * Math.sin(2 * Math.PI * fr * t);
    out[s + n] += level * g * x;
  }
}

// ================================================================== 1. rolled chords
// Spec tolerance is "notes within ~80 ms". Stagger = gap between successive notes.
const ROLL_SETS = [
  ['C', ['C4', 'E4', 'G4']],
  ['Cm', ['C4', 'Eb4', 'G4']],
  ['C', ['E3', 'G3', 'C4']],
  ['Cm', ['G3', 'C4', 'Eb4']],
];
for (const staggerMs of [30, 40]) { // 60 / 80 ms total spread
  test(`rolled chord, ${staggerMs} ms between notes (${2 * staggerMs} ms total), up and down`, () => {
    for (const [id, notes] of ROLL_SETS) {
      for (const order of ['up', 'down']) {
        const n = order === 'up' ? notes : notes.slice().reverse();
        for (const sr of [44100, 48000]) {
          const ev = names(detect(chordSignal(n, { sr, rollMs: staggerMs, seed: 3 })));
          assert.deepEqual(ev, [id], `${n.join(' ')} rolled ${staggerMs} ms/note @${sr}`);
        }
      }
    }
  });
}

test('rolled chord, 80 ms between notes (160 ms spread) is recognised once', () => {
  for (const [id, notes] of ROLL_SETS) {
    for (const order of ['up', 'down']) {
      const n = order === 'up' ? notes : notes.slice().reverse();
      assert.deepEqual(names(detect(chordSignal(n, { rollMs: 80, seed: 5 }))), [id], `${n.join(' ')} rolled 80 ms/note`);
    }
  }
});

test('slow roll, 150 ms between notes (300 ms arpeggio then held): never the wrong chord, never twice', () => {
  for (const [id, notes] of ROLL_SETS) {
    for (const order of ['up', 'down']) {
      const n = order === 'up' ? notes : notes.slice().reverse();
      const ev = names(detect(chordSignal(n, { rollMs: 150, seed: 6, dur: 3 })));
      assert.ok(ev.length <= 1 && ev.every((x) => x === id), `${n.join(' ')} rolled 150 ms/note gave ${JSON.stringify(ev)}`);
    }
  }
});

test('slow roll, 150 ms between notes, then held: the chord is still recognised', () => {
  // After the third note the piano is sounding a plain, held C / Cm chord for > 1 s with a fresh
  // attack (the last note), so a good detector should report it.
  for (const [id, notes] of ROLL_SETS) {
    const ev = names(detect(chordSignal(notes, { rollMs: 150, seed: 6, dur: 3 })));
    assert.deepEqual(ev, [id], `${notes.join(' ')} rolled 150 ms/note`);
  }
});

test('a rolled C major never passes through a false C minor (and vice versa) on the way', () => {
  // E.g. rolling C - G - E: the intermediate C+G dyad must not be completed into the other chord.
  const sets = [['C', ['C4', 'G4', 'E4']], ['Cm', ['C4', 'G4', 'Eb4']], ['C', ['G3', 'E4', 'C4']], ['Cm', ['G3', 'Eb4', 'C4']]];
  for (const [id, notes] of sets) {
    for (const rollMs of [40, 80]) {
      assert.deepEqual(names(detect(chordSignal(notes, { rollMs, seed: 8 }))), [id], `${notes.join(' ')} roll ${rollMs}`);
    }
  }
});

// ================================================================== 2. staccato
test('staccato chord (~120 ms key down, then damped) is recognised', () => {
  // 120 ms of tone + damper ring-down; the 341 ms analysis window and the hold rule should still
  // see a stable chord for long enough at normal touch.
  for (const [id, notes] of [['C', ['C4', 'E4', 'G4']], ['Cm', ['C4', 'Eb4', 'G4']], ['C', ['G3', 'C4', 'E4']], ['Cm', ['Eb4', 'G4', 'C5']]]) {
    for (const sr of [44100, 48000]) {
      const ev = names(detect(chordSignal(notes, { sr, holdSec: 0.12, velocity: 0.2, seed: 9 })));
      assert.deepEqual(ev, [id], `${notes.join(' ')} staccato @${sr}`);
    }
  }
});

test('soft staccato chord (~120 ms): recognised or ignored, but never the wrong chord', () => {
  for (const [id, notes] of [['C', ['C4', 'E4', 'G4']], ['Cm', ['C4', 'Eb4', 'G4']]]) {
    const ev = names(detect(chordSignal(notes, { holdSec: 0.12, velocity: 0.04, seed: 10 })));
    assert.ok(ev.length <= 1 && ev.every((x) => x === id), `${notes.join(' ')} soft staccato gave ${ev}`);
  }
});

test.skip('a 20-40 ms "blip" chord', () => {
  // Not tested: shorter than the required hold time, and not a realistic way to play a chord.
});

// ================================================================== 3. chord while another rings
test('C minor released, C major played after the cooldown: both reported, in order', () => {
  const sr = 48000;
  const sig = blank(sr, 4.2);
  sim.addChord(sig, sr, 0.4, ['C4', 'Eb4', 'G4'], { holdSec: 0.9, seed: 1 });
  sim.addChord(sig, sr, 2.2, ['C4', 'E4', 'G4'], { holdSec: 1.2, seed: 2 });
  assert.deepEqual(names(detect({ sig, sr })), ['Cm', 'C']);
});

test('quick change: C major released and C minor struck 120 ms later (cooldown 0) gives C then Cm', () => {
  // The old chord is still inside the 341 ms analysis window when the new one starts. A good
  // detector waits for the new chord to dominate rather than reporting a mix or giving up.
  for (const [a, b, want] of [[['C4', 'E4', 'G4'], ['C4', 'Eb4', 'G4'], ['C', 'Cm']], [['C4', 'Eb4', 'G4'], ['C4', 'E4', 'G4'], ['Cm', 'C']]]) {
    const sr = 48000;
    const sig = blank(sr, 3.4);
    sim.addChord(sig, sr, 0.4, a, { holdSec: 0.7, seed: 11 });
    sim.addChord(sig, sr, 0.4 + 0.7 + 0.12, b, { seed: 12 });
    assert.deepEqual(names(detect({ sig, sr }, { cooldownMs: 0 })), want, `${a.join(' ')} -> ${b.join(' ')}`);
  }
});

test('quick change inside the default cooldown: only the first chord is reported', () => {
  const sr = 48000;
  const sig = blank(sr, 3);
  sim.addChord(sig, sr, 0.4, ['C4', 'E4', 'G4'], { holdSec: 0.5, seed: 13 });
  sim.addChord(sig, sr, 1.0, ['C4', 'Eb4', 'G4'], { seed: 14 });
  assert.deepEqual(names(detect({ sig, sr })), ['C']);
});

test('same chord struck again while the first is still ringing (pedal down), after the cooldown: reported twice', () => {
  const sr = 48000;
  const sig = blank(sr, 4.4);
  sim.addChord(sig, sr, 0.4, ['C4', 'E4', 'G4'], { seed: 15 });          // keeps ringing
  sim.addChord(sig, sr, 2.2, ['C4', 'E4', 'G4'], { seed: 16 });          // fresh strike, same chord
  assert.deepEqual(names(detect({ sig, sr })), ['C', 'C']);
});

test.skip('C minor struck while a C major is still sounding under the sustain pedal', () => {
  // Ambiguous: E and E-flat (and their overtones) are both physically present, so the mix is a
  // "C major + C minor clash". Answering null is defensible; so is an onset-weighted "Cm".
});

test('chord struck over the decaying popup tone from the speaker', () => {
  // app.js plays playTone(firstNote + 12, 0.3) when the popup opens. A chord right after it must
  // still be recognised, and the tone alone must not trigger anything.
  for (const [id, notes, toneMidi] of [['C', ['C4', 'E4', 'G4'], 72], ['Cm', ['C4', 'Eb4', 'G4'], 76], ['Cm', ['C4', 'Eb4', 'G4'], 64]]) {
    const sr = 48000;
    const sig = blank(sr, 3);
    addAppTone(sig, sr, 0.3, toneMidi, 0.3, 0.3);
    sim.addChord(sig, sr, 0.75, notes, { seed: 17 });
    assert.deepEqual(names(detect({ sig, sr })), [id], `tone ${toneMidi} then ${notes.join(' ')}`);
  }
});

test('the app popup tone alone (speaker -> mic, any lesson start note) is never a chord', () => {
  for (const midi of [60, 62, 64, 65, 67, 69, 71, 72, 76, 79]) {
    for (const level of [0.1, 0.5]) {
      const sr = 48000;
      const sig = blank(sr, 2);
      addAppTone(sig, sr, 0.4, midi, 0.3, level);
      assert.deepEqual(names(detect({ sig, sr })), [], `tone midi ${midi} level ${level}`);
    }
  }
});

test.skip('slow broken chord C4 ... E4 ... G4 (500 ms apart, all ringing)', () => {
  // Ambiguous: this is a melody whose notes end up sounding together; whether that "is" playing
  // the chord is a product decision, not something the audio decides.
});

// ================================================================== 4. frame timing
test('irregular frames (16-60 ms apart, random) still give exactly one correct report', () => {
  const cases = [['C', ['C4', 'E4', 'G4']], ['Cm', ['C4', 'Eb4', 'G4']], ['C', ['G3', 'C4', 'E4']], ['Cm', ['Eb4', 'G4', 'C5']], ['Cm', ['C3', 'Eb3', 'G3']]];
  for (const [id, notes] of cases) {
    for (const seed of [1, 2, 3]) {
      const { sig, sr } = chordSignal(notes, { seed: 20 + seed });
      const times = irregularTimes(2600, 16, 60, seed);
      const ev = runAt(sig, sr, CD.createDetector(), times);
      assert.deepEqual(names(ev), [id], `${notes.join(' ')} seed ${seed}`);
      const lat = ev[0].tMs - LEAD * 1000;
      assert.ok(lat >= 150 && lat < 1000, `latency ${lat.toFixed(0)} ms`);
    }
  }
});

test('frames at a steady 16 ms (requestAnimationFrame rate) and a steady 60 ms', () => {
  for (const gap of [16, 60]) {
    for (const [id, notes] of [['C', ['C4', 'E4', 'G4']], ['Cm', ['G3', 'C4', 'Eb4']]]) {
      const { sig, sr } = chordSignal(notes, { seed: 30 });
      const times = [];
      for (let t = gap; t < 2600; t += gap) times.push(t);
      const ev = runAt(sig, sr, CD.createDetector(), times);
      assert.deepEqual(names(ev), [id], `${gap} ms frames, ${notes.join(' ')}`);
      const lat = ev[0].tMs - LEAD * 1000;
      assert.ok(lat >= 150, `hold must still be ~150 ms+ at ${gap} ms frames (latency ${lat.toFixed(0)})`);
    }
  }
});

test('a single 250 ms stall in the timer during the hold neither loses nor doubles the chord', () => {
  for (const [id, notes] of [['C', ['C4', 'E4', 'G4']], ['Cm', ['C4', 'Eb4', 'G4']]]) {
    for (const stallAt of [450, 520, 600]) {
      const { sig, sr } = chordSignal(notes, { seed: 31 });
      const times = irregularTimes(2600, 25, 35, 4, { at: stallAt, ms: 250 });
      assert.deepEqual(names(runAt(sig, sr, CD.createDetector(), times)), [id], `stall at ${stallAt}`);
    }
  }
});

test('a held chord over 6 s with irregular frames is reported exactly once', () => {
  const { sig, sr } = chordSignal(['C4', 'Eb4', 'G4'], { dur: 6.5, seed: 32 });
  assert.deepEqual(names(runAt(sig, sr, CD.createDetector(), irregularTimes(6500, 16, 60, 9))), ['Cm']);
});

// ================================================================== 5. sample rates and FFT sizes
for (const sr of [44100, 48000, 96000]) {
  test(`sample rate ${sr} Hz, fftSize 16384: C and Cm at C4 and C5, root and 1st inversion`, () => {
    for (const id of ['C', 'Cm']) {
      const t = id === 'C' ? 'E' : 'Eb';
      for (const notes of [['C4', t + '4', 'G4'], [t + '4', 'G4', 'C5'], ['C5', t + '5', 'G5']]) {
        assert.deepEqual(names(detect(chordSignal(notes, { sr, seed: 40 }))), [id], `${notes.join(' ')} @${sr}`);
      }
    }
  });
}

test('sample rate 96000 Hz, fftSize 16384 (5.9 Hz bins): C3-octave chords', () => {
  // C3 / Eb3 / E3 are 131 / 156 / 165 Hz: 4+ bins apart even at 96 kHz, and their harmonics are
  // further apart still, so a good detector should manage the default attach() settings here.
  for (const [id, notes] of [['C', ['C3', 'E3', 'G3']], ['Cm', ['C3', 'Eb3', 'G3']], ['C', ['G3', 'C4', 'E4']], ['Cm', ['Eb3', 'G3', 'C4']]]) {
    assert.deepEqual(names(detect(chordSignal(notes, { sr: 96000, seed: 41 }))), [id], notes.join(' '));
  }
});

test('sample rate 96000 Hz, fftSize 32768: C3 octave', () => {
  for (const [id, notes] of [['C', ['C3', 'E3', 'G3']], ['Cm', ['C3', 'Eb3', 'G3']]]) {
    assert.deepEqual(names(detect(chordSignal(notes, { sr: 96000, seed: 42 }), undefined, { fftSize: 32768 })), [id], notes.join(' '));
  }
});

test('sample rate 96000 Hz: single notes and C+G stay silent', () => {
  for (const notes of [['C4'], ['C3'], ['C4', 'G4'], ['E4'], ['A3', 'C4', 'E4'], ['F3', 'A3', 'C4']]) {
    assert.deepEqual(names(detect(chordSignal(notes, { sr: 96000, velocity: 0.3, seed: 43 }))), [], notes.join(' '));
  }
});

for (const fftSize of [8192, 32768]) {
  test(`fftSize ${fftSize} at 48 kHz: C and Cm around C4 detected, non-chords silent`, () => {
    for (const [id, notes] of [['C', ['C4', 'E4', 'G4']], ['Cm', ['C4', 'Eb4', 'G4']], ['C', ['E4', 'G4', 'C5']], ['Cm', ['G4', 'C5', 'Eb5']]]) {
      assert.deepEqual(names(detect(chordSignal(notes, { seed: 44, dur: 3 }), undefined, { fftSize })), [id], `${notes.join(' ')} fft ${fftSize}`);
    }
    for (const notes of [['C4'], ['C3'], ['C4', 'G4'], ['A3', 'C4', 'E4']]) {
      assert.deepEqual(names(detect(chordSignal(notes, { velocity: 0.3, seed: 45, dur: 3 }), undefined, { fftSize })), [], `${notes.join(' ')} fft ${fftSize}`);
    }
  });
}

test('fftSize 32768 at 48 kHz: C3 octave chords', () => {
  for (const [id, notes] of [['C', ['C3', 'E3', 'G3']], ['Cm', ['C3', 'Eb3', 'G3']]]) {
    assert.deepEqual(names(detect(chordSignal(notes, { seed: 46, dur: 3 }), undefined, { fftSize: 32768 })), [id], notes.join(' '));
  }
});

test('coarse FFTs (2048, 4096): may miss chords, but never report the wrong one or a non-chord', () => {
  for (const fftSize of [2048, 4096]) {
    for (const [id, notes] of [['C', ['C4', 'E4', 'G4']], ['Cm', ['C4', 'Eb4', 'G4']], ['C', ['C3', 'E3', 'G3']], ['Cm', ['C3', 'Eb3', 'G3']]]) {
      const ev = names(detect(chordSignal(notes, { seed: 47 }), undefined, { fftSize }));
      assert.ok(ev.every((x) => x === id) && ev.length <= 1, `${notes.join(' ')} fft ${fftSize} -> ${ev}`);
    }
    for (const notes of [['C4'], ['C3'], ['C4', 'G4'], ['A3', 'C4', 'E4'], ['F3', 'A3', 'C4']]) {
      const ev = names(detect(chordSignal(notes, { velocity: 0.3, seed: 48 }), undefined, { fftSize }));
      assert.deepEqual(ev, [], `${notes.join(' ')} fft ${fftSize}`);
    }
  }
});

test('changing fftSize between frames does not throw or report garbage', () => {
  const det = CD.createDetector();
  const { sig, sr } = chordSignal(['C4', 'E4', 'G4']);
  const out = [];
  for (let t = 30, i = 0; t < 2600; t += 30, i++) {
    const fftSize = i % 2 ? 16384 : 8192;
    const db = sim.spectrumAt(sig, sr, t / 1000, { fftSize, warm: 0 });
    const n = det.push(db, sr, fftSize, t);
    if (n) out.push(n);
  }
  assert.ok(out.every((x) => x === 'C') && out.length <= 1, `got ${out}`);
});

// ================================================================== 6. CPU cost
function collectFrames(sig, sr, fftSize, totalMs) {
  const an = new sim.AnalyserSim({ fftSize, smoothingTimeConstant: 0.5, sampleRate: sr });
  const td = new Float32Array(fftSize);
  const frames = [];
  for (let t = 30; t < totalMs; t += 30) {
    an.timeDomain(sig, t / 1000, td);
    const db = new Float32Array(an.frequencyData(td));
    frames.push({ t, db, rms: sim.tailRms(td, 2048) });
  }
  return frames;
}
function busySignal(sr) {
  // Several chords, a loud cluster (lots of peaks), speech and noise: keeps the detector armed and
  // gives findNotes plenty of candidates.
  const sig = blank(sr, 6, 0.002);
  sim.addChord(sig, sr, 0.3, ['C3', 'Eb3', 'G3', 'C4', 'Eb4', 'G4'], { velocity: 0.35, holdSec: 1, seed: 50 });
  sim.addChord(sig, sr, 1.9, ['C4', 'C#4', 'D4', 'Eb4', 'E4', 'F4', 'F#4', 'G4', 'Ab4', 'A4', 'Bb4', 'B4'], { velocity: 0.3, holdSec: 1, seed: 51 });
  sim.addVoice(sig, sr, 3.4, 1.5, 0.3, 52);
  sim.addChord(sig, sr, 4.4, ['G3', 'C4', 'E4'], { velocity: 0.35, rollMs: 30, seed: 53 });
  return sig;
}
function timePushes(frames, sr, fftSize, withRms) {
  let best = null;
  for (let rep = 0; rep < 3; rep++) {
    const det = CD.createDetector({ cooldownMs: 0 });
    const ts = [];
    for (const f of frames) {
      const a = process.hrtime.bigint();
      det.push(f.db, sr, fftSize, f.t, withRms ? f.rms : undefined);
      ts.push(Number(process.hrtime.bigint() - a) / 1e6);
    }
    const warm = ts.slice(5).sort((x, y) => x - y);
    const mean = warm.reduce((s, x) => s + x, 0) / warm.length;
    const r = { mean, p90: warm[Math.floor(warm.length * 0.9)], max: warm[warm.length - 1] };
    if (!best || r.mean < best.mean) best = r;
  }
  return best;
}
for (const fftSize of [16384, 32768]) {
  test(`CPU: push() costs < 2 ms per frame (fftSize ${fftSize}, ${fftSize / 2} bins)`, () => {
    const sr = 48000;
    const frames = collectFrames(busySignal(sr), sr, fftSize, 6000);
    for (const withRms of [true, false]) {
      const r = timePushes(frames, sr, fftSize, withRms);
      const msg = `rms ${withRms ? 'given' : 'estimated'}: mean ${r.mean.toFixed(3)} ms, p90 ${r.p90.toFixed(3)} ms, max ${r.max.toFixed(3)} ms`;
      assert.ok(r.mean < 2, msg);
      assert.ok(r.p90 < 2, msg);
    }
  });
}

test('CPU: chromaFromSpectrum alone on the busiest frames is < 2 ms', () => {
  const sr = 48000;
  const frames = collectFrames(busySignal(sr), sr, 16384, 6000);
  // warm up the JIT
  for (const f of frames) CD.chromaFromSpectrum(f.db, sr, 16384);
  const ts = [];
  for (const f of frames) {
    const a = process.hrtime.bigint();
    CD.chromaFromSpectrum(f.db, sr, 16384);
    ts.push(Number(process.hrtime.bigint() - a) / 1e6);
  }
  ts.sort((x, y) => x - y);
  const p90 = ts[Math.floor(ts.length * 0.9)];
  assert.ok(p90 < 2, `p90 ${p90.toFixed(3)} ms, max ${ts[ts.length - 1].toFixed(3)} ms`);
});

// ================================================================== 7. attach() lifecycle
// A manual fake clock that replaces the global timer functions for one test.
function installFakeTimers() {
  const saved = { si: globalThis.setInterval, ci: globalThis.clearInterval, st: globalThis.setTimeout, ct: globalThis.clearTimeout };
  const c = { now: 0, nextId: 1, timers: new Map(), intervalsCreated: [], cleared: [], errors: [] };
  globalThis.setInterval = (fn, ms) => {
    const id = c.nextId++;
    c.timers.set(id, { fn, ms: Math.max(1, ms || 0), at: c.now + Math.max(1, ms || 0), repeat: true });
    c.intervalsCreated.push({ id, ms });
    return id;
  };
  globalThis.setTimeout = (fn, ms) => {
    const id = c.nextId++;
    c.timers.set(id, { fn, ms: ms || 0, at: c.now + (ms || 0), repeat: false });
    return id;
  };
  globalThis.clearInterval = globalThis.clearTimeout = (id) => { c.cleared.push(id); c.timers.delete(id); };
  // Advance to time `to`, firing due timers in order. jitter(ms) optionally delays each interval fire.
  c.advance = (to, jitter) => {
    for (;;) {
      let nextId = null, next = null;
      for (const [id, t] of c.timers) if (t.at <= to && (!next || t.at < next.at)) { nextId = id; next = t; }
      if (!next) break;
      c.now = next.at;
      if (next.repeat) next.at = c.now + next.ms + (jitter ? jitter() : 0);
      else c.timers.delete(nextId);
      try { next.fn(); } catch (e) { c.errors.push(e); }
    }
    c.now = to;
  };
  c.active = () => [...c.timers.values()].filter((t) => t.repeat).length;
  c.restore = () => { globalThis.setInterval = saved.si; globalThis.clearInterval = saved.ci; globalThis.setTimeout = saved.st; globalThis.clearTimeout = saved.ct; };
  return c;
}

function fakeAudio(signal, sr, clock) {
  const log = [];
  const analysers = [];
  const ctx = {
    sampleRate: sr,
    state: 'running',
    get currentTime() { return clock.now / 1000; },
    destination: { name: 'destination' },
    createAnalyser() {
      const an = {
        fftSize: 2048,
        smoothingTimeConstant: 0.8,
        minDecibels: -100,
        maxDecibels: -30,
        context: ctx,
        get frequencyBinCount() { return this.fftSize / 2; },
        reads: 0,
        _sim: null,
        _simFor() {
          if (!this._sim || this._sim.fftSize !== this.fftSize) {
            this._sim = new sim.AnalyserSim({ fftSize: this.fftSize, smoothingTimeConstant: this.smoothingTimeConstant, sampleRate: sr });
          }
          return this._sim;
        },
        getFloatFrequencyData(out) {
          this.reads++;
          const s = this._simFor();
          out.set(s.frequencyData(s.timeDomain(signal(), clock.now / 1000)));
        },
        getFloatTimeDomainData(out) {
          const s = this._simFor();
          out.set(s.timeDomain(signal(), clock.now / 1000).subarray(0, out.length));
        },
        connect(n) { log.push(['analyser.connect', n]); return n; },
        disconnect(n) { log.push(['analyser.disconnect', n]); },
      };
      analysers.push(an);
      return an;
    },
  };
  for (const m of ['createMediaStreamSource', 'createBiquadFilter', 'createGain', 'createOscillator', 'createScriptProcessor']) {
    ctx[m] = () => { log.push(['ctx.' + m]); return { connect() {}, disconnect() {} }; };
  }
  const source = {
    connect(n) { log.push(['source.connect', n]); return n; },
    disconnect(...a) { log.push(['source.disconnect', ...a]); },
  };
  return { ctx, source, log, analysers };
}

function withAttach(sr, signalRef, opts, fn) {
  const clock = installFakeTimers();
  try {
    const fa = fakeAudio(() => signalRef.sig, sr, clock);
    const heard = [];
    const h = CD.attach(fa.ctx, fa.source, Object.assign({ onChord: (n) => heard.push({ n, t: clock.now }), now: () => clock.now }, opts));
    return fn({ clock, fa, heard, h });
  } finally {
    clock.restore();
  }
}

test('attach(): one analyser of its own, tapped from the source, never routed to the speakers', () => {
  const ref = { sig: blank(48000, 3) };
  withAttach(48000, ref, {}, ({ clock, fa, h }) => {
    assert.equal(fa.analysers.length, 1, 'exactly one createAnalyser');
    const an = fa.analysers[0];
    assert.ok(an.fftSize >= 16384, `fftSize ${an.fftSize}`);
    assert.ok(an.smoothingTimeConstant >= 0.3 && an.smoothingTimeConstant <= 0.7, `smoothing ${an.smoothingTimeConstant}`);
    assert.deepEqual(fa.log, [['source.connect', an]], 'only source.connect(analyser)');
    assert.ok(!fa.log.some((e) => e[0] === 'analyser.connect'), 'analyser must not be connected onward (mic -> speaker feedback)');
    assert.equal(clock.intervalsCreated.length, 0, 'no timer before start()');
    clock.advance(1000);
    assert.equal(an.reads, 0, 'no analyser reads before start()');
    assert.equal(typeof h.start, 'function');
    assert.equal(typeof h.stop, 'function');
    assert.equal(typeof h.dispose, 'function');
  });
});

test('attach(): start() runs one ~30 ms loop; calling start() twice does not double it', () => {
  const ref = { sig: blank(48000, 3) };
  withAttach(48000, ref, {}, ({ clock, fa, h }) => {
    h.start();
    h.start();
    assert.equal(clock.active(), 1, 'one interval');
    const ms = clock.intervalsCreated[0].ms;
    assert.ok(ms >= 15 && ms <= 50, `interval ${ms} ms`);
    clock.advance(1000);
    const reads = fa.analysers[0].reads;
    assert.ok(reads >= 1000 / 50 && reads <= 1000 / 15 + 1, `reads in 1 s: ${reads}`);
    h.dispose();
  });
});

test('attach(): end to end at 44.1 kHz, C major then C minor, each reported once via onChord', () => {
  const sr = 44100;
  const sig = blank(sr, 5);
  sim.addChord(sig, sr, 0.5, ['C4', 'E4', 'G4'], { holdSec: 1, seed: 60 });
  sim.addChord(sig, sr, 2.8, ['G3', 'C4', 'Eb4'], { holdSec: 1.5, seed: 61 });
  withAttach(sr, { sig }, {}, ({ clock, heard, h }) => {
    h.start();
    clock.advance(4900);
    assert.deepEqual(heard.map((x) => x.n), ['C', 'Cm'], 'uses audioContext.sampleRate');
    assert.ok(heard[0].t > 500 + 150 && heard[0].t < 500 + 1000, `C at ${heard[0].t}`);
    h.dispose();
  });
});

test('attach(): stop() halts reads and callbacks; start() again works on a fresh state', () => {
  const sr = 48000;
  const sig = blank(sr, 6);
  sim.addChord(sig, sr, 1.0, ['C4', 'E4', 'G4'], { holdSec: 1.5, seed: 62 });
  sim.addChord(sig, sr, 4.0, ['C4', 'Eb4', 'G4'], { seed: 63 });
  withAttach(sr, { sig }, {}, ({ clock, fa, heard, h }) => {
    h.start();
    clock.advance(500);
    h.stop();
    assert.equal(clock.active(), 0, 'interval cleared');
    const reads = fa.analysers[0].reads;
    clock.advance(3500); // the C major chord comes and goes while stopped
    assert.equal(fa.analysers[0].reads, reads, 'no reads while stopped');
    assert.deepEqual(heard, [], 'no callbacks while stopped');
    h.start();
    clock.advance(5900);
    assert.deepEqual(heard.map((x) => x.n), ['Cm']);
    h.dispose();
  });
});

test('attach(): stopping mid-hold and restarting does not report the stale, half-held chord', () => {
  // Popup closes ~150 ms into a chord, then reopens 300 ms later while the chord still rings: no
  // fresh attack after start(), so nothing should fire until a new strike.
  const sr = 48000;
  const sig = blank(sr, 5);
  sim.addChord(sig, sr, 0.5, ['C4', 'E4', 'G4'], { seed: 64 });
  sim.addChord(sig, sr, 3.0, ['C4', 'Eb4', 'G4'], { seed: 65 });
  withAttach(sr, { sig }, {}, ({ clock, heard, h }) => {
    h.start();
    clock.advance(650);
    h.stop();
    clock.advance(950);
    h.start();
    clock.advance(2900);
    assert.deepEqual(heard, [], 'stale chord must not fire after restart');
    clock.advance(4900);
    assert.deepEqual(heard.map((x) => x.n), ['Cm']);
    h.dispose();
  });
});

test('attach(): start() while a chord is already ringing (popup opened over it) does not fire', () => {
  const sr = 48000;
  const sig = blank(sr, 4);
  sim.addChord(sig, sr, 0.3, ['C4', 'E4', 'G4'], { seed: 66 });
  withAttach(sr, { sig }, {}, ({ clock, heard, h }) => {
    clock.advance(500); // chord struck at 300 ms, popup opens at 500 ms
    h.start();
    clock.advance(3900);
    assert.deepEqual(heard, []);
    h.dispose();
  });
});

test('attach(): dispose() stops the loop and disconnects only its own analyser', () => {
  const sr = 48000;
  const sig = blank(sr, 4);
  sim.addChord(sig, sr, 1.5, ['C4', 'E4', 'G4'], { seed: 67 });
  withAttach(sr, { sig }, {}, ({ clock, fa, heard, h }) => {
    h.start();
    clock.advance(300);
    h.dispose();
    assert.equal(clock.active(), 0, 'interval cleared by dispose');
    const an = fa.analysers[0];
    const discs = fa.log.filter((e) => e[0] === 'source.disconnect');
    assert.equal(discs.length, 1, 'one source.disconnect');
    assert.equal(discs[0].length, 2, 'source.disconnect must name the analyser (a bare disconnect() would cut the app\'s pitch path)');
    assert.equal(discs[0][1], an);
    clock.advance(3900);
    assert.deepEqual(heard, [], 'nothing after dispose');
    h.start(); // must be a no-op now
    assert.equal(clock.active(), 0, 'start() after dispose() is a no-op');
    clock.advance(3950);
    assert.deepEqual(heard, []);
    h.dispose(); // twice is harmless
    assert.equal(fa.log.filter((e) => e[0] === 'source.disconnect').length, 1, 'second dispose does not disconnect again');
  });
});

test('attach(): stop() before start(), and stop() twice, are harmless', () => {
  const ref = { sig: blank(48000, 1) };
  withAttach(48000, ref, {}, ({ clock, h }) => {
    h.stop();
    h.stop();
    h.start();
    h.stop();
    h.stop();
    assert.equal(clock.active(), 0);
    h.dispose();
  });
});

test('attach(): a throwing onChord does not kill the loop, and the error is not swallowed', () => {
  const sr = 48000;
  const sig = blank(sr, 5);
  sim.addChord(sig, sr, 0.5, ['C4', 'E4', 'G4'], { holdSec: 1, seed: 68 });
  sim.addChord(sig, sr, 3.0, ['C4', 'Eb4', 'G4'], { seed: 69 });
  const clock = installFakeTimers();
  try {
    const fa = fakeAudio(() => sig, sr, clock);
    const heard = [];
    const h = CD.attach(fa.ctx, fa.source, {
      now: () => clock.now,
      onChord: (n) => { heard.push(n); if (heard.length === 1) throw new Error('app bug'); },
    });
    h.start();
    clock.advance(4900);
    assert.deepEqual(heard, ['C', 'Cm'], 'second chord still heard after the callback threw');
    assert.equal(clock.errors.length, 1, 'the error surfaces once (e.g. rethrown async)');
    assert.equal(clock.errors[0].message, 'app bug');
    h.dispose();
  } finally {
    clock.restore();
  }
});

test('attach(): no onChord given -> runs silently without throwing', () => {
  const sr = 48000;
  const sig = blank(sr, 3);
  sim.addChord(sig, sr, 0.5, ['C4', 'E4', 'G4'], { seed: 70 });
  const clock = installFakeTimers();
  try {
    const fa = fakeAudio(() => sig, sr, clock);
    const h = CD.attach(fa.ctx, fa.source, { now: () => clock.now });
    h.start();
    clock.advance(2900);
    assert.equal(clock.errors.length, 0);
    h.dispose();
  } finally {
    clock.restore();
  }
});

test('attach(): a jittery timer (fires 16-60 ms apart) still gives one report per chord', () => {
  const sr = 48000;
  const sig = blank(sr, 3);
  sim.addChord(sig, sr, 0.5, ['Eb4', 'G4', 'C5'], { seed: 71 });
  const rand = sim.rng(77);
  const clock = installFakeTimers();
  try {
    const fa = fakeAudio(() => sig, sr, clock);
    const heard = [];
    const h = CD.attach(fa.ctx, fa.source, { now: () => clock.now, onChord: (n) => heard.push(n), intervalMs: 30 });
    h.start();
    clock.advance(2900, () => -14 + rand() * 44); // 16..60 ms between fires
    assert.deepEqual(heard, ['Cm']);
    h.dispose();
  } finally {
    clock.restore();
  }
});

test('attach(): on a 96 kHz AudioContext, a C3-octave chord is still recognised end to end', () => {
  // Some phones/interfaces run at 96 kHz. attach() should keep enough frequency resolution there
  // (e.g. a larger fftSize), since chords in the C3 octave are only ~25-33 Hz apart.
  const sr = 96000;
  for (const [id, notes] of [['C', ['C3', 'E3', 'G3']], ['Cm', ['C3', 'Eb3', 'G3']]]) {
    const sig = blank(sr, 2.8);
    sim.addChord(sig, sr, 0.5, notes, { seed: 74 });
    const got = withAttach(sr, { sig }, {}, ({ clock, heard, h }) => { h.start(); clock.advance(2700); h.dispose(); return heard.map((x) => x.n); });
    assert.deepEqual(got, [id], notes.join(' '));
  }
});

test('attach(): holdMs / cooldownMs options are passed through to the detector', () => {
  const sr = 48000;
  const sig = blank(sr, 3.2);
  sim.addChord(sig, sr, 0.4, ['C4', 'E4', 'G4'], { holdSec: 0.4, seed: 72 });
  sim.addChord(sig, sr, 1.4, ['C4', 'Eb4', 'G4'], { seed: 73 });
  const run = (opts) => withAttach(sr, { sig }, opts, ({ clock, heard, h }) => { h.start(); clock.advance(3100); h.dispose(); return heard.map((x) => x.n); });
  assert.deepEqual(run({}), ['C'], 'default cooldown blocks the second chord');
  assert.deepEqual(run({ cooldownMs: 300 }), ['C', 'Cm'], 'cooldownMs honoured');
});

test('chords.js and chord-card.js load with no browser or app globals (no hidden dependencies)', () => {
  for (const file of ['chords.js', 'chord-card.js']) {
    const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const sandbox = { module: { exports: {} }, setTimeout, clearTimeout, setInterval, clearInterval };
    vm.runInNewContext(code, sandbox, { filename: file });
    assert.ok(Object.keys(sandbox.module.exports).length > 0, `${file} exports an API`);
  }
  // Browser style: no module -> sets window.X
  const win = {};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'chords.js'), 'utf8'), { window: win });
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'chord-card.js'), 'utf8'), { window: win });
  assert.equal(typeof win.ChordDetect.attach, 'function');
  assert.equal(typeof win.ChordCard.render, 'function');
});

// ================================================================== 8. chord-card.js
// A tiny DOM, just enough for chord-card.js, so its behaviour can be checked in node.
class FakeNode {
  constructor(doc, tag, ns) {
    this.ownerDocument = doc; this.tagName = tag; this.namespaceURI = ns || 'http://www.w3.org/1999/xhtml';
    this.attributes = new Map(); this.children = []; this.parentNode = null; this._text = '';
    this.dataset = {};
    const self = this;
    this.classList = {
      add(...c) { const s = self._cls(); c.forEach((x) => s.add(x)); self._setCls(s); },
      remove(...c) { const s = self._cls(); c.forEach((x) => s.delete(x)); self._setCls(s); },
      toggle(c, on) { const s = self._cls(); const want = on === undefined ? !s.has(c) : !!on; if (want) s.add(c); else s.delete(c); self._setCls(s); return want; },
      contains(c) { return self._cls().has(c); },
    };
  }
  _cls() { return new Set((this.attributes.get('class') || '').split(/\s+/).filter(Boolean)); }
  _setCls(s) { this.attributes.set('class', [...s].join(' ')); }
  get className() { return this.attributes.get('class') || ''; }
  set className(v) { this.attributes.set('class', String(v)); }
  get id() { return this.attributes.get('id') || ''; }
  set id(v) { this.attributes.set('id', String(v)); }
  get offsetWidth() { return 0; }
  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
  appendChild(n) { if (n.parentNode) n.remove(); n.parentNode = this; this.children.push(n); return n; }
  append(...ns) { for (const n of ns) this.appendChild(typeof n === 'string' ? this.ownerDocument.createTextNode(n) : n); }
  remove() { if (this.parentNode) { const p = this.parentNode; p.children = p.children.filter((c) => c !== this); this.parentNode = null; } }
  get textContent() { return this.tagName === '#text' ? this._text : this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { if (this.tagName === '#text') this._text = String(v); else { this.children = []; this.append(String(v)); } }
  *walk() { yield this; for (const c of this.children) yield* c.walk(); }
  findAll(pred) { return [...this.walk()].filter(pred); }
  byClass(c) { return this.findAll((n) => n.classList.contains(c)); }
}
function fakeDocument() {
  const doc = {};
  doc.createElement = (t) => new FakeNode(doc, t.toUpperCase());
  doc.createElementNS = (ns, t) => new FakeNode(doc, t, ns);
  doc.createTextNode = (s) => { const n = new FakeNode(doc, '#text'); n._text = s; return n; };
  doc.documentElement = doc.createElement('html');
  doc.head = doc.documentElement.appendChild(doc.createElement('head'));
  doc.body = doc.documentElement.appendChild(doc.createElement('body'));
  doc.getElementById = (id) => doc.documentElement.findAll((n) => n.id === id)[0] || null;
  return doc;
}
const CHORDS = [
  { id: 'C', title: 'C major', action: 'Next lesson', notes: ['C4', 'E4', 'G4'], fingers: [1, 3, 5] },
  { id: 'Cm', title: 'C minor', action: 'Play again', notes: ['C4', 'Eb4', 'G4'], fingers: [1, 3, 5] },
];
function mount(opts) {
  const doc = fakeDocument();
  const container = doc.body.appendChild(doc.createElement('div'));
  const api = CC.render(container, Object.assign({ chords: CHORDS, listening: true }, opts));
  return { doc, container, api };
}
const cardOf = (container, id) => container.byClass('cc-card').find((c) => c.dataset.chord === id);
const statusOf = (container) => container.findAll((n) => n.getAttribute('aria-live'))[0];

test('chord-card: renders two cards with name, instruction, hint and a C4-C5 keyboard with 1/3/5', () => {
  const { container, api } = mount();
  assert.equal(typeof api.flash, 'function');
  assert.equal(typeof api.setListening, 'function');
  assert.equal(typeof api.destroy, 'function');
  for (const c of CHORDS) {
    const card = cardOf(container, c.id);
    assert.ok(card, `card ${c.id}`);
    const text = card.textContent.replace(/\s+/g, ' ');
    assert.ok(text.includes(c.title), `${c.id} title`);
    assert.ok(/Play C (major|minor)\s*→/.test(text) && text.includes(c.action), `${c.id} instruction: ${text}`);
    assert.ok(text.includes('thumb on C') && text.includes('little finger on G'), `${c.id} hint`);
    assert.ok(text.includes(c.id === 'C' ? 'middle finger on E' : 'middle finger on E♭'), `${c.id} middle finger`);
    const rects = card.findAll((n) => n.tagName === 'rect');
    const whites = rects.filter((r) => r.classList.contains('cc-w'));
    const blacks = rects.filter((r) => r.classList.contains('cc-b'));
    assert.ok(whites.length >= 8, `white keys ${whites.length} (C4..C5 needs 8)`);
    assert.ok(blacks.length >= 5, `black keys ${blacks.length}`);
    const on = rects.filter((r) => r.classList.contains('cc-on'));
    assert.equal(on.length, 3, 'three keys coloured');
    assert.equal(on.filter((r) => r.classList.contains('cc-b')).length, c.id === 'Cm' ? 1 : 0, 'E-flat is the one black key');
    const nums = card.findAll((n) => n.tagName === 'text').map((t) => t.textContent);
    assert.deepEqual(nums, ['1', '3', '5']);
    const svg = card.findAll((n) => n.tagName === 'svg')[0];
    assert.ok(svg.getAttribute('aria-label'), 'keyboard has a text alternative');
  }
  api.destroy();
});

test('chord-card: one <style> injected however many times it renders, all classes prefixed cc-', () => {
  const doc = fakeDocument();
  const a = doc.body.appendChild(doc.createElement('div'));
  const b = doc.body.appendChild(doc.createElement('div'));
  const x = CC.render(a, { chords: CHORDS, listening: true });
  const y = CC.render(b, { chords: CHORDS, listening: false });
  const styles = doc.documentElement.findAll((n) => n.tagName === 'STYLE');
  assert.equal(styles.length, 1);
  for (const n of doc.body.walk()) {
    for (const c of n.className.split(/\s+/).filter(Boolean)) assert.ok(c.startsWith('cc-'), `class ${c}`);
  }
  x.destroy(); y.destroy();
});

test('chord-card: live status region; listening off explains how to use chords, buttons still work', () => {
  const { container, api } = mount({ listening: false });
  const st = statusOf(container);
  assert.ok(st, 'an aria-live element exists from the start');
  assert.ok(['polite', 'assertive'].includes(st.getAttribute('aria-live')));
  assert.ok(/start listening/i.test(st.textContent), st.textContent);
  assert.ok(/button/i.test(st.textContent), st.textContent);
  api.setListening(true);
  assert.ok(/listening/i.test(st.textContent) && !/start listening/i.test(st.textContent), st.textContent);
  api.setListening(false);
  assert.ok(/start listening/i.test(st.textContent));
  api.destroy();
});

test('chord-card: flash(id) highlights only that card, announces it, then settles back', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { container, api } = mount();
  const st = statusOf(container);
  api.flash('Cm');
  const cm = cardOf(container, 'Cm');
  const c = cardOf(container, 'C');
  assert.ok(cm.className !== c.className, 'matched card looks different');
  assert.ok(/C minor/.test(st.textContent), `announced: ${st.textContent}`);
  const flashed = cm.className;
  t.mock.timers.tick(3000);
  assert.notEqual(cm.className, flashed, 'highlight is brief');
  assert.equal(cm.className, c.className);
  assert.ok(/listening/i.test(st.textContent), 'status returns to listening');
  api.flash('nope'); // unknown id is harmless
  api.flash('C');
  assert.ok(/C major/.test(st.textContent));
  api.destroy();
  assert.equal(container.children.length, 0, 'destroy removes the card');
  t.mock.timers.tick(3000); // pending timers after destroy are harmless
  api.flash('C'); // and calls after destroy do not throw
});

test('chord-card: single-chord mode (last lesson: only C minor) works', () => {
  const { container, api } = mount({ chords: [CHORDS[1]] });
  assert.equal(container.byClass('cc-card').length, 1);
  assert.ok(cardOf(container, 'Cm'));
  api.flash('C'); // not shown; must not throw
  api.destroy();
});

// --- static review of chord-card.js CSS against index.html tokens
const CARD_SRC = fs.readFileSync(path.join(ROOT, 'chord-card.js'), 'utf8');
const CSS = (/const CSS = `([\s\S]*?)`;/.exec(CARD_SRC) || [])[1] || '';
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
function tokens(block) { const o = {}; for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) o[m[1]] = m[2].trim(); return o; }
const LIGHT = tokens((/:root\s*\{([\s\S]*?)\}/.exec(INDEX) || [])[1] || '');
const DARK = Object.assign({}, LIGHT, tokens((/prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([\s\S]*?)\}/.exec(INDEX) || [])[1] || ''));

test('chord-card CSS: only existing tokens, no hard-coded colours', () => {
  assert.ok(CSS.length > 100, 'found the CSS string');
  const allowed = new Set(['--paper', '--card', '--ink', '--muted', '--line', '--accent', '--accent-soft', '--good', '--good-soft', '--bad', '--key-white', '--key-black', '--font-display', '--font-body']);
  for (const m of CSS.matchAll(/var\(\s*(--[\w-]+)\s*(,([^()]*|[^()]*\([^()]*\)[^()]*))?\)/g)) {
    const name = m[1];
    if (name.startsWith('--cc-')) continue; // private
    assert.ok(allowed.has(name) || name in LIGHT, `${name} is not a token defined in index.html`);
  }
  const noVars = CSS.replace(/var\([^)]*\)/g, '');
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(noVars), 'hard-coded colour in chord-card CSS');
  assert.ok(!/:\s*(white|black|red|green|blue|gray|grey)\s*[;}]/i.test(noVars), 'named colour in chord-card CSS');
});

test('chord-card CSS: every tokens it relies on exists in both light and dark themes', () => {
  for (const m of CSS.matchAll(/var\(\s*(--[\w-]+)/g)) {
    const n = m[1];
    if (n.startsWith('--cc-')) continue;
    assert.ok(n in LIGHT, `${n} missing in light`);
    assert.ok(n in DARK, `${n} missing in dark`);
  }
});

function lum(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => parseInt(c + c, 16)) : [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r, g, b] = v.map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

test('chord-card: text contrast >= 4.5:1 in light and dark (resting and flashed card)', () => {
  // Pairs follow the CSS: card background is --paper (resting) / --good-soft (flashed); the status
  // line sits on the dialog's --card; finger numbers are --card on an --accent dot (--ink dot when
  // flashed), and on the black key --accent (--ink when flashed) on a --card dot.
  // (Updated with chord-card.js: light --good #1f8a5b is too light for small text, so the flashed
  // action, the "Heard ..." status and the flashed finger dot now use --ink; --good stays on
  // borders, key fills and the status LED only.)
  const pairs = [
    ['name', '--ink', '--paper'], ['notes/hint', '--muted', '--paper'], ['action', '--accent', '--paper'],
    ['flashed name', '--ink', '--good-soft'], ['flashed hint', '--muted', '--good-soft'], ['flashed action', '--ink', '--good-soft'],
    ['status', '--muted', '--card'], ['status heard', '--ink', '--card'],
    ['finger number', '--card', '--accent'], ['finger number flashed', '--card', '--ink'],
    ['black-key finger number', '--accent', '--card'], ['black-key finger number flashed', '--ink', '--card'],
  ];
  const bad = [];
  for (const [theme, T] of [['light', LIGHT], ['dark', DARK]]) {
    for (const [what, fg, bg] of pairs) {
      const r = contrast(T[fg], T[bg]);
      if (r < 4.5) bad.push(`${theme} ${what} ${fg} on ${bg}: ${r.toFixed(2)}`);
    }
  }
  assert.deepEqual(bad, []);
});

// Not tested: contrast between the finger dot and the coloured key fill. In dark mode --key-heard /
// --key-hint keep their light values (index.html has no dark override), so dot vs key is only ~2:1,
// but the finger number itself has good contrast against its dot, which is what carries the meaning.

test('chord-card CSS: reduced motion switches off every animation and transition', () => {
  const reduce = (/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(CSS) || [])[1];
  assert.ok(reduce, 'has a prefers-reduced-motion block');
  const outside = CSS.replace(/@media\s*\(prefers-reduced-motion[\s\S]*?\n\}/, '');
  for (const m of outside.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const sel = m[1].trim();
    if (sel.startsWith('@') || sel.startsWith('0%') || /^\d/.test(sel)) continue;
    const body = m[2];
    const moving = /(^|;|\s)animation\s*:(?!\s*none)/.test(body) || /(^|;|\s)transition\s*:(?!\s*none)/.test(body);
    if (!moving) continue;
    for (const s of sel.split(',').map((x) => x.trim())) {
      assert.ok(reduce.includes(s), `"${s}" animates but is not neutralised under reduced motion`);
    }
  }
});

test('chord-card: no use of app.js internals (ids, globals) — talks only through its API', () => {
  for (const id of ['doneOverlay', 'nextBtn', 'againBtn', 'listBtn', 'doneTitle', 'micBtn']) {
    assert.ok(!CARD_SRC.includes(id), `references #${id}`);
  }
  assert.ok(!/document\.(querySelector|getElementsBy)/.test(CARD_SRC), 'queries the page DOM');
  const ids = [...CARD_SRC.matchAll(/getElementById\(([^)]*)\)/g)].map((m) => m[1].trim());
  assert.ok(ids.every((x) => x === 'STYLE_ID'), `getElementById only for its own style tag: ${ids}`);
  assert.ok(!/\bwindow\.(?!ChordCard)\w+/.test(CARD_SRC), 'reads window globals');
});

test('chord-card at 375 px: two columns fit the 295 px dialog and nothing forces overflow', () => {
  // 375 viewport - 2 x 16 overlay padding - 2 x 24 dialog padding = 295 px of content.
  const content = 375 - 32 - 48;
  const bp = Number((/@container\s*\(min-width:\s*(\d+)px\)/.exec(CSS) || [])[1]);
  assert.ok(bp > 0 && bp <= content, `two-column breakpoint ${bp}px applies at ${content}px`);
  assert.ok(/minmax\(0,\s*1fr\)/.test(CSS), 'grid columns can shrink (minmax(0, 1fr))');
  assert.ok(/\.cc-card\s*\{[^}]*min-width:\s*0/.test(CSS), 'cards can shrink below their content');
  // In two columns each card has about (295 - 10) / 2 - 20 padding - 3 border = 119 px inside.
  for (const m of CSS.matchAll(/(?:^|[;{\s])(width|min-width)\s*:\s*(\d+)px/g)) {
    assert.ok(Number(m[2]) <= 119, `fixed ${m[1]} ${m[2]}px could overflow a 119 px card`);
  }
  assert.ok(!/@container[^{]*\{[^}]*\.cc-grid[^}]*repeat\(\s*[3-9]/.test(CSS), 'never more than two columns');
  assert.ok(/\.cc-kb\s*\{[^}]*width:\s*100%/.test(CSS), 'keyboard scales with its card');
  // container-type: inline-size needs a definite width from its parent: .dialog has width: 100%.
  assert.ok(/\.dialog\s*\{[^}]*width:\s*100%/.test(INDEX), '.dialog gives the card container a definite width');
});

test('chord-card at 375 px: finger numbers on the mini keyboard stay legible (>= 9 px)', () => {
  // Two columns at 295 px: each card is (295 - gap) / 2 wide, minus its padding and border.
  const content = 375 - 32 - 48;
  const gap = Number((/\.cc-grid\s*\{[^}]*gap:\s*(\d+)px/.exec(CSS) || [])[1] || 0);
  const pad = 2 * 10, border = 2 * 1.5;
  const cardInner = (content - gap) / 2 - pad - border;
  const doc = fakeDocument();
  const box = doc.body.appendChild(doc.createElement('div'));
  const api = CC.render(box, { chords: CHORDS, listening: true });
  const svg = box.findAll((n) => n.tagName === 'svg')[0];
  const vbW = Number(svg.getAttribute('viewBox').split(/\s+/)[2]);
  const maxW = Number((/\.cc-kb\s*\{[^}]*max-width:\s*(\d+)px/.exec(CSS) || [])[1] || Infinity);
  const scale = Math.min(cardInner, maxW) / vbW;
  const white = Number((/\.cc-num\s*\{[^}]*font-size:\s*(\d+(?:\.\d+)?)px/.exec(CSS) || [])[1]);
  const black = Number((/\.cc-num\.cc-onb\s*\{[^}]*font-size:\s*(\d+(?:\.\d+)?)px/.exec(CSS) || [])[1] || white);
  api.destroy();
  assert.ok(white * scale >= 9, `white-key finger number ${(white * scale).toFixed(1)} px`);
  assert.ok(black * scale >= 9, `black-key finger number ${(black * scale).toFixed(1)} px (E-flat's "3")`);
});
