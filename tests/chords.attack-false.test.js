// Adversarial false-trigger tests for the chord detector (chords.js).
// Run: node --test tests/
//
// Every case here is something a user (or the room, or the app itself) might produce while the
// lesson-complete popup is open that is NOT a C major or C minor chord. A good detector reports
// nothing for these. A few cases also check that one chord press fires exactly once, and that a
// genuine re-strike after the cooldown fires again.
//
// Each test encodes the behaviour a good detector should have, whether or not chords.js passes it.
// Cases that are ambiguous in principle (the sound really is C-E-G, or the spectrum cannot be told
// apart from a real chord) are marked { skip } with a comment instead of being asserted.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const sim = require('./audio-sim.js');
const CD = require(path.join(__dirname, '..', 'chords.js'));

const SRS = [44100, 48000];
const MIC_NOISE = 0.0004;

// ------------------------------------------------------------------ local helpers
function blank(sr, dur, seed = 7) {
  const sig = new Float32Array(Math.round(sr * dur));
  sim.addNoise(sig, sr, MIC_NOISE, seed);
  return sig;
}

// Runs a detector over a signal. Unlike sim.runDetector this can start reading part-way through
// (startMs), which is what happens when attach().start() is called as the popup appears: the
// analyser has not been read before, so its smoothing memory starts at zero.
function run(sig, sr, { startMs = 0, intervalMs = 30, detOpts, fftSize = 16384 } = {}) {
  const det = CD.createDetector(detOpts);
  const an = new sim.AnalyserSim({ fftSize, smoothingTimeConstant: 0.5, sampleRate: sr });
  const td = new Float32Array(fftSize);
  const db = new Float32Array(fftSize / 2);
  const total = (sig.length / sr) * 1000;
  const events = [];
  for (let t = startMs + intervalMs; t <= total; t += intervalMs) {
    an.timeDomain(sig, t / 1000, td);
    an.frequencyData(td, db);
    const name = det.push(db, sr, fftSize, t, sim.tailRms(td, 2048));
    if (name) events.push({ name, tMs: t });
  }
  return events;
}
const names = (ev) => ev.map((e) => e.name);
const fmt = (ev) => JSON.stringify(ev.map((e) => `${e.name}@${Math.round(e.tMs)}ms`));

// The app's own synth (app.js playTone): output gain ramps exponentially 0.0001 -> 0.3 in 10 ms and
// then down to 0.0001 at dur; a band-limited triangle fundamental (gain 0.6) plus sine 2nd (0.18)
// and 3rd (0.06) harmonics. `level` scales what reaches the mic through the phone speaker.
function addAppTone(out, sr, startSec, midi, dur = 1.2, level = 1) {
  const f = sim.midiToFreq(midi);
  const s = Math.round(startSec * sr);
  const n1 = Math.min(out.length - s, Math.round((dur + 0.05) * sr));
  const rise = 0.01 * sr;
  const fall = dur * sr;
  // Triangle as the Web Audio periodic wave: odd harmonics, amplitude 8/(pi^2 h^2), alternating sign.
  const parts = [];
  for (let h = 1; h * f < sr / 2; h += 2) parts.push([h, 0.6 * (8 / (Math.PI * Math.PI * h * h)) * (((h - 1) / 2) % 2 ? -1 : 1)]);
  parts.push([2, 0.18], [3, 0.06]);
  for (let n = 0; n < n1; n++) {
    const t = n / sr;
    let g;
    if (n < rise) g = 0.0001 * Math.pow(0.3 / 0.0001, n / rise);
    else if (n < fall) g = 0.3 * Math.pow(0.0001 / 0.3, (n - rise) / (fall - rise));
    else g = 0.0001;
    let x = 0;
    for (const [h, a] of parts) x += a * Math.sin(2 * Math.PI * f * h * t);
    out[s + n] += level * g * x;
  }
  return out;
}

// Plays notes one after another, legato: each key is released just after the next one goes down.
function addSequence(out, sr, startSec, notes, stepSec, opts = {}) {
  notes.forEach((n, i) => {
    const last = i === notes.length - 1;
    sim.addPianoNote(out, sr, startSec + i * stepSec, n, Object.assign({
      velocity: 0.2,
      holdSec: last ? (opts.lastHold != null ? opts.lastHold : 3) : stepSec + (opts.overlap != null ? opts.overlap : 0.03),
      seed: 500 + i * 13 + sim.noteToMidi(n),
    }, opts.note || {}));
  });
  return out;
}

// A hand clap: a few milliseconds of band-passed noise with a fast decay.
function addClap(out, sr, startSec, level = 0.3, seed = 1) {
  const rand = sim.rng(seed);
  const s = Math.round(startSec * sr);
  const n1 = Math.min(out.length - s, Math.round(0.08 * sr));
  // Two-pole resonator around 1.1 kHz, bandwidth ~800 Hz.
  const r = Math.exp(-Math.PI * 800 / sr);
  const a1 = -2 * r * Math.cos(2 * Math.PI * 1100 / sr), a2 = r * r;
  let y1 = 0, y2 = 0;
  for (let n = 0; n < n1; n++) {
    const env = n < 0.001 * sr ? n / (0.001 * sr) : Math.exp(-(n - 0.001 * sr) / (0.012 * sr));
    const x = (rand() * 2 - 1) * env;
    const y = x - a1 * y1 - a2 * y2;
    y2 = y1; y1 = y;
    out[s + n] += level * 0.25 * y;
  }
  return out;
}

// A knock on the piano lid or a table: a damped low resonance plus a click.
function addKnock(out, sr, startSec, level = 0.3, freq = 180, seed = 2) {
  const rand = sim.rng(seed);
  const s = Math.round(startSec * sr);
  const n1 = Math.min(out.length - s, Math.round(0.25 * sr));
  for (let n = 0; n < n1; n++) {
    const t = n / sr;
    out[s + n] += level * (Math.exp(-t / 0.04) * Math.sin(2 * Math.PI * freq * t) +
      0.5 * Math.exp(-t / 0.025) * Math.sin(2 * Math.PI * freq * 2.31 * t) +
      (n < 0.003 * sr ? 0.6 * (rand() * 2 - 1) : 0));
  }
  return out;
}

// Pure-sine notification beep(s): partials = [[ratio, amp]], exponential decay tau.
function addBeep(out, sr, startSec, freq, durSec, level = 0.2, { partials = [[1, 1]], tau = Infinity, square = false } = {}) {
  const s = Math.round(startSec * sr);
  const n1 = Math.min(out.length - s, Math.round(durSec * sr));
  const ramp = 0.004 * sr;
  const parts = square
    ? Array.from({ length: 40 }, (_, i) => [2 * i + 1, 1 / (2 * i + 1)]).filter(([h]) => h * freq < sr / 2)
    : partials;
  for (let n = 0; n < n1; n++) {
    const t = n / sr;
    const env = Math.min(1, n / ramp, (n1 - n) / ramp) * Math.exp(-t / tau);
    let x = 0;
    for (const [h, a] of parts) x += a * Math.sin(2 * Math.PI * freq * h * t);
    out[s + n] += level * env * x;
  }
  return out;
}

// A sustained sung/hummed vowel at a fixed pitch with light vibrato: harmonic source through formants.
function addSungVowel(out, sr, startSec, durSec, f0, level = 0.15, formants = [[700, 110], [1220, 120], [2600, 160]]) {
  const s = Math.round(startSec * sr);
  const n1 = Math.min(out.length - s, Math.round(durSec * sr));
  const fl = formants.map(([f, bw]) => {
    const r = Math.exp(-Math.PI * bw / sr);
    return { a1: -2 * r * Math.cos(2 * Math.PI * f / sr), a2: r * r, y1: 0, y2: 0 };
  });
  let ph = 0;
  for (let n = 0; n < n1; n++) {
    const t = n / sr;
    ph += (f0 * (1 + 0.01 * Math.sin(2 * Math.PI * 5.5 * t))) / sr;
    let x = 0;
    if (ph >= 1) { ph -= 1; x = 1; }
    let y = 0;
    for (const f of fl) {
      const v = x - f.a1 * f.y1 - f.a2 * f.y2;
      f.y2 = f.y1; f.y1 = v;
      y += v;
    }
    const env = Math.min(1, t / 0.05, (durSec - t) / 0.05);
    out[s + n] += level * 0.02 * y * env;
  }
  return out;
}

// Whispered speech: white noise through formant resonators with a syllable envelope, plus "s" bursts.
function addWhisper(out, sr, startSec, durSec, level = 0.2, seed = 8) {
  const rand = sim.rng(seed);
  const s = Math.round(startSec * sr);
  const n1 = Math.min(out.length - s, Math.round(durSec * sr));
  const fl = [[500, 150], [1500, 200], [2500, 250]].map(([f, bw]) => {
    const r = Math.exp(-Math.PI * bw / sr);
    return { a1: -2 * r * Math.cos(2 * Math.PI * f / sr), a2: r * r, y1: 0, y2: 0 };
  });
  let hp = 0, prev = 0;
  for (let n = 0; n < n1; n++) {
    const t = n / sr;
    const x = rand() * 2 - 1;
    let y = 0;
    for (const f of fl) {
      const v = x - f.a1 * f.y1 - f.a2 * f.y2;
      f.y2 = f.y1; f.y1 = v;
      y += v;
    }
    hp = 0.9 * (hp + x - prev); prev = x;
    const syl = Math.max(0, Math.sin(2 * Math.PI * 3 * t));
    const sib = Math.sin(2 * Math.PI * 0.7 * t) > 0.8 ? 1 : 0;
    out[s + n] += level * (0.03 * y * syl + 0.3 * hp * sib);
  }
  return out;
}

// Mains hum (and harmonics) switched on, e.g. a fridge or amplifier.
function addHum(out, sr, startSec, base = 50, level = 0.05) {
  const s = Math.round(startSec * sr);
  for (let n = s; n < out.length; n++) {
    const t = (n - s) / sr;
    let x = 0;
    for (let h = 1; h <= 12; h++) x += Math.sin(2 * Math.PI * base * h * t + h) / h;
    out[n] += level * Math.min(1, t / 0.01) * x;
  }
  return out;
}

function assertNone(ev, msg) {
  assert.deepEqual(names(ev), [], `${msg}: expected nothing, got ${fmt(ev)}`);
}

// ================================================================== 1. the lesson's last note
// The real endings of the app's lessons (app.js LESSONS), played legato at ~100 bpm. The popup
// appears ~300 ms after the final note, and app.js then plays its own popup tone
// (playTone(firstNote + 12, 0.3, 0.05)) through the speaker while the last piano note still rings.
const ENDINGS = [
  ['C major scale, going up', ['A4', 'B4', 'C5'], 'C5'],
  ['C major scale, going down', ['E4', 'D4', 'C4'], 'C5'],
  ['Mary Had a Little Lamb', ['E4', 'D4', 'C4'], 'E4'],
  ['Ode to Joy', ['D4', 'C4', 'C4'], 'E4'],
  ['Twinkle Twinkle', ['D4', 'D4', 'C4'], 'C4'],
  ['Jingle Bells', ['F4', 'D4', 'C4'], 'E4'],
  ['Frere Jacques', ['C4', 'G3', 'C4'], 'C4'],
  ['Happy Birthday', ['C5', 'D5', 'C5'], 'G4'],
];
for (const [title, tail, first] of ENDINGS) {
  for (const sr of SRS) {
    test(`last notes of "${title}" (${tail.join(' ')}) ringing + popup tone, ${sr} Hz -> nothing`, () => {
      const sig = blank(sr, 4.5);
      const step = 0.6;
      addSequence(sig, sr, 0.3, tail, step, { lastHold: 4 });
      const lastOn = 0.3 + step * (tail.length - 1);
      const popup = lastOn + 0.3;
      addAppTone(sig, sr, popup + 0.05, sim.noteToMidi(first) + 12, 0.3, 0.5);
      // (a) attach().start() called as the popup appears (the recommended wiring)
      assertNone(run(sig, sr, { startMs: popup * 1000 }), 'started at popup');
      // (b) detector already running through the whole ending
      assertNone(run(sig, sr), 'running throughout');
    });
  }
}

test('last note C4 / C5 / C3 still ringing loudly when the popup opens -> nothing', () => {
  for (const sr of SRS) {
    for (const [note, velocity] of [['C4', 0.35], ['C5', 0.35], ['C3', 0.45], ['C4', 0.05]]) {
      const sig = blank(sr, 4);
      sim.addPianoNote(sig, sr, 0.3, note, { velocity, holdSec: 4 });
      for (const startMs of [0, 400, 700]) assertNone(run(sig, sr, { startMs }), `${note} v${velocity} start ${startMs}ms ${sr}`);
    }
  }
});

test('ringing last note C4 re-struck a couple of times -> nothing', () => {
  for (const sr of SRS) {
    const sig = blank(sr, 4);
    for (const [i, t] of [0.3, 0.9, 1.5, 2.1].entries()) {
      sim.addPianoNote(sig, sr, t, i % 2 ? 'C3' : 'C4', { velocity: 0.35, holdSec: 0.62, seed: 40 + i });
    }
    assertNone(run(sig, sr), `C4/C3 repeated ${sr}`);
  }
});

// ================================================================== 2. single notes in sequence
test('C, E, G played one at a time (legato, ~0.5 s apart) -> nothing', () => {
  for (const sr of SRS) {
    for (const [seq, step, velocity] of [
      [['C4', 'E4', 'G4'], 0.5, 0.2],
      [['G4', 'E4', 'C4'], 0.5, 0.2],
      [['C3', 'E3', 'G3'], 0.55, 0.35],
      [['C4', 'Eb4', 'G4'], 0.5, 0.2],
      [['E4', 'G4', 'C5'], 0.6, 0.2],
      [['C4', 'E4', 'G4', 'E4', 'C4'], 0.5, 0.2],
    ]) {
      const sig = blank(sr, 1 + step * seq.length + 1.5);
      addSequence(sig, sr, 0.3, seq, step, { note: { velocity }, lastHold: 1.5 });
      assertNone(run(sig, sr), `${seq.join(' ')} @${step}s ${sr}`);
    }
  }
});

test('scale fragment C D E F G played as single notes -> nothing', () => {
  for (const sr of SRS) {
    const seq = ['C4', 'D4', 'E4', 'F4', 'G4', 'F4', 'E4', 'D4', 'C4'];
    const sig = blank(sr, 0.6 + seq.length * 0.35 + 1.5);
    addSequence(sig, sr, 0.3, seq, 0.35, { lastHold: 1.5 });
    assertNone(run(sig, sr), `scale ${sr}`);
  }
});

// A fast broken chord (C E G with 250 ms between notes) puts all three notes inside one 340 ms FFT
// window and inside the 400 ms "rolled chord" allowance. It is literally the notes of the chord, so
// reporting C major here is defensible. Ambiguous: not asserted.
test('fast broken chord C-E-G at 250 ms per note (ambiguous: is it a chord?)', { skip: 'ambiguous: a fast arpeggio is a broken C major chord' }, () => {});

// Holding each key down while adding the next (finger pedalling) produces a sounding C major chord.
test('arpeggio with every key held (ambiguous: sounds as a chord)', { skip: 'ambiguous: the result really is a sounding C major chord' }, () => {});

// ================================================================== 3. incomplete and other chords
const OTHER = [
  // dyads
  ['C4 + E4', ['C4', 'E4']],
  ['C3 + E3 loud', ['C3', 'E3'], { velocity: 0.4 }],
  ['C5 + E5', ['C5', 'E5']],
  ['C4 + Eb4', ['C4', 'Eb4']],
  ['C3 + Eb3 loud', ['C3', 'Eb3'], { velocity: 0.4 }],
  ['C4 + G4 power chord', ['C4', 'G4']],
  ['C3 + G3 + C4 power chord, loud', ['C3', 'G3', 'C4'], { velocity: 0.4 }],
  ['C4 + G4 + C5 power chord', ['C4', 'G4', 'C5']],
  ['E4 + G4', ['E4', 'G4']],
  ['E3 + G3 loud', ['E3', 'G3'], { velocity: 0.4 }],
  ['Eb4 + G4', ['Eb4', 'G4']],
  ['Eb3 + G3 loud', ['Eb3', 'G3'], { velocity: 0.4 }],
  ['G3 + E4 (sixth)', ['G3', 'E4']],
  ['octaves C3 + C4 + C5, loud', ['C3', 'C4', 'C5'], { velocity: 0.4 }],
  // sevenths and colours
  ['C7 (C4 E4 G4 Bb4)', ['C4', 'E4', 'G4', 'Bb4']],
  ['C7 (C3 E3 G3 Bb3)', ['C3', 'E3', 'G3', 'Bb3']],
  ['C7 (C4 E4 G4 Bb4), Bb a bit softer', ['C4', 'E4', 'G4', 'Bb4'], { velocities: [0.2, 0.2, 0.2, 0.12] }],
  ['Cm7 (C4 Eb4 G4 Bb4)', ['C4', 'Eb4', 'G4', 'Bb4']],
  ['Cmaj7 (C4 E4 G4 B4)', ['C4', 'E4', 'G4', 'B4']],
  ['Cmaj7 (C3 E3 G3 B3)', ['C3', 'E3', 'G3', 'B3']],
  ['Cmaj7 open (C3 G3 B3 E4)', ['C3', 'G3', 'B3', 'E4']],
  ['C6 / Am7 (C4 E4 G4 A4)', ['C4', 'E4', 'G4', 'A4']],
  ['Cadd9 (C4 D4 E4 G4)', ['C4', 'D4', 'E4', 'G4']],
  ['Csus4 (C4 F4 G4)', ['C4', 'F4', 'G4']],
  ['Csus2 (C4 D4 G4)', ['C4', 'D4', 'G4']],
  ['C dim (C4 Eb4 Gb4)', ['C4', 'Eb4', 'Gb4']],
  // neighbouring triads that share two notes with C or Cm
  ['A minor (A3 C4 E4)', ['A3', 'C4', 'E4']],
  ['A minor (E4 A4 C5)', ['E4', 'A4', 'C5']],
  ['A minor loud (A2 E3 A3 C4 E4)', ['A2', 'E3', 'A3', 'C4', 'E4'], { velocity: 0.35 }],
  ['E minor (E4 G4 B4)', ['E4', 'G4', 'B4']],
  ['E minor (G3 B3 E4)', ['G3', 'B3', 'E4']],
  ['Eb major (Eb4 G4 Bb4)', ['Eb4', 'G4', 'Bb4']],
  ['Eb major (G3 Bb3 Eb4)', ['G3', 'Bb3', 'Eb4']],
  ['Ab major (Ab3 C4 Eb4)', ['Ab3', 'C4', 'Eb4']],
  ['Ab major (C4 Eb4 Ab4)', ['C4', 'Eb4', 'Ab4']],
  ['F minor (F3 Ab3 C4)', ['F3', 'Ab3', 'C4']],
  ['F minor (C4 F4 Ab4)', ['C4', 'F4', 'Ab4']],
  ['F major (F3 A3 C4)', ['F3', 'A3', 'C4']],
  ['G major (G3 B3 D4)', ['G3', 'B3', 'D4']],
  ['G7 (G3 B3 D4 F4)', ['G3', 'B3', 'D4', 'F4']],
  ['E major (E4 G#4 B4)', ['E4', 'G#4', 'B4']],
];
for (const [label, notes, extra] of OTHER) {
  test(`${label} -> nothing`, () => {
    for (const sr of SRS) {
      const sig = blank(sr, 2.8);
      sim.addChord(sig, sr, 0.4, notes, Object.assign({ velocity: 0.2, seed: 3 }, extra));
      assertNone(run(sig, sr), `${notes.join(' ')} ${sr}`);
    }
  });
}

// Cmaj7 voiced with the B exactly a 12th above the E (C4 E4 G4 B5): B5 coincides with E4's 3rd
// partial, so its spectrum is nearly identical to C4 E4 G4 with a slightly louder E4 3rd partial.
test('Cmaj7 with B a 12th above E (C4 E4 G4 B5, C3 E3 G3 B4; Cm7 C3 Eb3 G3 Bb4)', { skip: 'ambiguous: B5 sits on E4\'s 3rd partial' }, () => {});

test('C or C minor triad (octave 3 and 4) with one wrong note added -> nothing', () => {
  // Excludes the 12th-above-the-third voicings, which are skipped above as ambiguous.
  const extras = ['Db', 'D', 'F', 'F#', 'Ab', 'A', 'Bb', 'B'];
  const bad = [];
  for (const sr of SRS) {
    for (const [third, R] of [['E', 3], ['Eb', 3], ['E', 4], ['Eb', 4]]) {
      for (const x of extras) {
        const notes = ['C' + R, third + R, 'G' + R, x + R];
        const sig = blank(sr, 2.4);
        sim.addChord(sig, sr, 0.4, notes, { velocity: 0.2, seed: 3 });
        const ev = run(sig, sr);
        if (ev.length) bad.push(`${notes.join(' ')} @${sr} -> ${fmt(ev)}`);
      }
    }
  }
  assert.deepEqual(bad, [], `false triggers:\n  ${bad.join('\n  ')}`);
});

// ================================================================== 4. single notes the overtone trap
test('single low C2 (below the note range, its partials spell C-G-C-E) -> nothing', () => {
  for (const sr of SRS) {
    for (const velocity of [0.1, 0.2, 0.4]) {
      const sig = blank(sr, 2.8);
      sim.addPianoNote(sig, sr, 0.4, 'C2', { velocity });
      assertNone(run(sig, sr), `C2 v${velocity} ${sr}`);
    }
  }
});

test('left-hand octave C2 + C3 -> nothing', () => {
  for (const sr of SRS) {
    const sig = blank(sr, 2.8);
    sim.addChord(sig, sr, 0.4, ['C2', 'C3'], { velocity: 0.3, seed: 4 });
    assertNone(run(sig, sr), `C2+C3 ${sr}`);
  }
});

test('single C3 with a weak fundamental (phone mic roll-off: 16, 20 and 22 dB down) -> nothing', () => {
  // Partials 2, 3, 5 of C3 are C4, G4, E5. With a quiet (but still clearly present) 131 Hz
  // fundamental there is one harmonic series; a good detector explains all peaks with one C3.
  for (const sr of SRS) {
    for (const fundamentalGain of [0.15, 0.1, 0.08]) {
      const sig = blank(sr, 2.8);
      sim.addPianoNote(sig, sr, 0.4, 'C3', { velocity: 0.35, fundamentalGain });
      assertNone(run(sig, sr), `C3 fundamental x${fundamentalGain} ${sr}`);
    }
  }
});

test('single C4 with a weak fundamental -> nothing', () => {
  for (const sr of SRS) {
    const sig = blank(sr, 2.8);
    sim.addPianoNote(sig, sr, 0.4, 'C4', { velocity: 0.3, fundamentalGain: 0.1 });
    assertNone(run(sig, sr), `C4 weak fundamental ${sr}`);
  }
});

// With the fundamental entirely gone, C3's partials C4, G4, E5 cannot be told from an open C major
// voicing (C4 G4 E5), whose own partials land on the same frequencies.
test('single C3 with no fundamental at all', { skip: 'ambiguous: identical peaks to the chord C4 G4 E5' }, () => {});

test('single C3 on a very inharmonic small upright (B = 0.0012) -> nothing', () => {
  for (const sr of SRS) {
    const sig = blank(sr, 2.8);
    sim.addPianoNote(sig, sr, 0.4, 'C3', { velocity: 0.45, B: 0.0012 });
    assertNone(run(sig, sr), `C3 B=0.0012 ${sr}`);
  }
});

test('single low notes whose partials include C, E or G (A2, F2, Ab2, E2) -> nothing', () => {
  for (const sr of SRS) {
    for (const note of ['A2', 'F2', 'Ab2', 'E2', 'G2']) {
      const sig = blank(sr, 2.8);
      sim.addPianoNote(sig, sr, 0.4, note, { velocity: 0.35 });
      assertNone(run(sig, sr), `${note} ${sr}`);
    }
  }
});

test('C minor played loudly with a dominant C is never reported as C major', () => {
  for (const sr of SRS) {
    for (const [notes, opts] of [
      [['C3', 'Eb3', 'G3'], { velocities: [0.5, 0.12, 0.22], B: 0.0012 }],
      [['C3', 'G3', 'Eb4'], { velocities: [0.5, 0.25, 0.15] }],
      [['C3', 'C4', 'Eb4', 'G4'], { velocities: [0.45, 0.3, 0.12, 0.2] }],
    ]) {
      const sig = blank(sr, 2.8);
      sim.addChord(sig, sr, 0.4, notes, opts);
      const ev = names(run(sig, sr));
      assert.ok(!ev.includes('C'), `${notes.join(' ')} ${JSON.stringify(opts)} ${sr}: got ${ev}`);
      assert.ok(ev.length <= 1, `fired ${ev.length} times`);
    }
  }
});

test('C major played with a loud G is never reported as C minor', () => {
  for (const sr of SRS) {
    const sig = blank(sr, 2.8);
    sim.addChord(sig, sr, 0.4, ['G3', 'C4', 'E4'], { velocities: [0.5, 0.2, 0.12] });
    const ev = names(run(sig, sr));
    assert.ok(!ev.includes('Cm'), `got ${ev}`);
    assert.ok(ev.length <= 1, `fired ${ev.length} times`);
  }
});

// ================================================================== 5. voices, transients, the room
test('speech-like formant noise (whisper with "s" sounds) -> nothing', () => {
  for (const sr of SRS) {
    for (const level of [0.1, 0.4]) {
      const sig = blank(sr, 4);
      addWhisper(sig, sr, 0.4, 3.2, level);
      assertNone(run(sig, sr), `whisper ${level} ${sr}`);
    }
  }
});

test('talking (gliding voiced speech, men and women) -> nothing', () => {
  for (const sr of SRS) {
    for (const [level, seed] of [[0.1, 3], [0.35, 4]]) {
      const sig = blank(sr, 4);
      sim.addVoice(sig, sr, 0.3, 3.4, level, seed);
      assertNone(run(sig, sr), `voice ${level} ${sr}`);
    }
  }
});

test('someone humming or singing a steady C (C3, C4) -> nothing', () => {
  // One harmonic voice: its 3rd and 5th harmonics are G and E, but it is a single note.
  for (const sr of SRS) {
    for (const [f0, formants] of [
      [130.81, [[700, 110], [1220, 120], [2600, 160]]], // "ah", male
      [130.81, [[300, 80], [870, 90], [2250, 120]]],   // "oo"
      [261.63, [[850, 100], [1220, 120], [2800, 160]]], // "ah", female
      [261.63, [[400, 80], [2000, 100], [2550, 130]]], // "ee"
    ]) {
      const sig = blank(sr, 3.2);
      addSungVowel(sig, sr, 0.4, 2.4, f0, 0.2, formants);
      assertNone(run(sig, sr), `sung ${f0} Hz ${JSON.stringify(formants[0])} ${sr}`);
    }
  }
});

test('hand claps and knocks -> nothing', () => {
  for (const sr of SRS) {
    const sig = blank(sr, 4);
    [0.4, 0.9, 1.4, 1.9].forEach((t, i) => addClap(sig, sr, t, 0.4, i + 1));
    addKnock(sig, sr, 2.6, 0.3, 180);
    addKnock(sig, sr, 3.1, 0.4, 130.8); // a resonance that happens to sit on C3
    assertNone(run(sig, sr), `claps/knocks ${sr}`);
  }
});

test('claps while the last C4 is still ringing -> nothing', () => {
  for (const sr of SRS) {
    const sig = blank(sr, 4);
    sim.addPianoNote(sig, sr, 0.3, 'C4', { velocity: 0.3, holdSec: 4 });
    [1.0, 1.6, 2.2].forEach((t, i) => addClap(sig, sr, t, 0.4, i + 7));
    assertNone(run(sig, sr, { startMs: 600 }), `claps over C4 ${sr}`);
  }
});

test('talking while the last C4 is still ringing -> nothing', () => {
  for (const sr of SRS) {
    const sig = blank(sr, 4);
    sim.addPianoNote(sig, sr, 0.3, 'C4', { velocity: 0.3, holdSec: 4 });
    sim.addVoice(sig, sr, 0.9, 2.8, 0.25, 9);
    assertNone(run(sig, sr, { startMs: 600 }), `talk over C4 ${sr}`);
  }
});

test('mains hum (50 / 60 Hz with harmonics) switching on -> nothing', () => {
  for (const sr of SRS) {
    for (const base of [50, 60]) {
      const sig = blank(sr, 3);
      addHum(sig, sr, 0.8, base, 0.03);
      assertNone(run(sig, sr), `hum ${base} ${sr}`);
    }
  }
});

test('phone notification sounds -> nothing', () => {
  for (const sr of SRS) {
    const cases = {
      'three 1 kHz beeps': (s) => { for (const t of [0.4, 0.65, 0.9]) addBeep(s, sr, t, 1000, 0.15, 0.25); },
      'two-tone ding 880+1320': (s) => addBeep(s, sr, 0.4, 880, 1.2, 0.25, { partials: [[1, 1], [1.5, 0.6]], tau: 0.35 }),
      'ding-dong sines E5 then C5': (s) => {
        addBeep(s, sr, 0.4, 659.26, 1.4, 0.25, { tau: 0.5 });
        addBeep(s, sr, 0.75, 523.25, 1.4, 0.25, { tau: 0.5 });
      },
      'square-wave beep on C4': (s) => addBeep(s, sr, 0.4, 261.63, 0.5, 0.15, { square: true }),
      'square-wave beep on C5': (s) => addBeep(s, sr, 0.4, 523.25, 0.5, 0.15, { square: true }),
      'sawtooth beep on C3': (s) => addBeep(s, sr, 0.4, 130.81, 0.6, 0.12,
        { partials: Array.from({ length: 60 }, (_, i) => [i + 1, 1 / (i + 1)]).filter(([h]) => h * 130.81 < sr / 2) }),
      'marimba-ish ping on C5 (partials 1, 3.9, 9.2)': (s) =>
        addBeep(s, sr, 0.4, 523.25, 1.0, 0.3, { partials: [[1, 1], [3.9, 0.3], [9.2, 0.1]], tau: 0.25 }),
      'sine chime C6 + E6 + G6 together': (s) => {
        // Pure sines with no harmonics: no piano would sound like this. (G6 is above the note range.)
        for (const f of [1046.5, 1318.5, 1568]) addBeep(s, sr, 0.4, f, 1.0, 0.12, { tau: 0.4 });
      },
    };
    for (const [label, add] of Object.entries(cases)) {
      const sig = blank(sr, 3);
      add(sig);
      assertNone(run(sig, sr), `${label} ${sr}`);
    }
  }
});

// A ringtone that plays a harmonic-rich C-E-G chord is acoustically a C major chord.
test('ringtone with a harmonic C major arpeggio', { skip: 'ambiguous: it is a C major chord' }, () => {});

// ================================================================== 6. the app's own synth
test('the app synth playing a single C (C3, C4, C5; hear button / key taps) -> nothing', () => {
  for (const sr of SRS) {
    for (const [midi, dur] of [[48, 1.2], [60, 1.2], [72, 1.2], [60, 0.9], [72, 0.3]]) {
      for (const level of [0.4, 1]) {
        const sig = blank(sr, 2.6);
        addAppTone(sig, sr, 0.4, midi, dur, level);
        assertNone(run(sig, sr), `synth midi ${midi} dur ${dur} level ${level} ${sr}`);
      }
    }
  }
});

test('the app synth popup tone on top of a ringing piano C4 -> nothing', () => {
  for (const sr of SRS) {
    for (const popupMidi of [72, 76, 67]) { // C5, E5, G4 (first note + 12 of the lessons)
      const sig = blank(sr, 3.5);
      sim.addPianoNote(sig, sr, 0.3, 'C4', { velocity: 0.25, holdSec: 4 });
      addAppTone(sig, sr, 0.65, popupMidi, 0.3, 0.8);
      assertNone(run(sig, sr, { startMs: 600 }), `C4 + synth ${popupMidi} ${sr}`);
    }
  }
});

// ================================================================== 7. exactly once / fires again
test('one chord press rings for 5 s -> reported exactly once', () => {
  for (const sr of SRS) {
    for (const [id, notes, opts] of [
      ['C', ['C4', 'E4', 'G4'], {}],
      ['Cm', ['C4', 'Eb4', 'G4'], {}],
      ['C', ['C3', 'E3', 'G3'], { velocity: 0.4 }],
      ['Cm', ['G3', 'C4', 'Eb4'], { velocity: 0.05 }],
      ['C', ['E4', 'G4', 'C5'], { digital: true }],
      ['Cm', ['C4', 'Eb4', 'G4'], { rollMs: 70 }],
    ]) {
      const sig = blank(sr, 5.5);
      sim.addChord(sig, sr, 0.4, notes, Object.assign({ velocity: 0.2, seed: 5 }, opts));
      assert.deepEqual(names(run(sig, sr)), [id], `${notes.join(' ')} ${JSON.stringify(opts)} ${sr}`);
    }
  }
});

test('one chord press with claps/knocks while it rings after the cooldown -> still exactly once', () => {
  // The claps are attacks, but nothing new was played: the ringing chord must not be re-reported.
  for (const sr of SRS) {
    for (const [id, notes] of [['C', ['C4', 'E4', 'G4']], ['Cm', ['C4', 'Eb4', 'G4']]]) {
      const sig = blank(sr, 5.5);
      sim.addChord(sig, sr, 0.4, notes, { velocity: 0.25, seed: 6 });
      addClap(sig, sr, 2.4, 0.4, 3);
      addClap(sig, sr, 3.0, 0.4, 4);
      addKnock(sig, sr, 4.0, 0.3, 180);
      const ev = run(sig, sr);
      assert.deepEqual(names(ev), [id], `${notes.join(' ')} ${sr}: ${fmt(ev)}`);
    }
  }
});

test('one chord press with talking while it rings after the cooldown -> still exactly once', () => {
  for (const sr of SRS) {
    for (const [id, notes] of [['C', ['C4', 'E4', 'G4']], ['Cm', ['C4', 'Eb4', 'G4']]]) {
      const sig = blank(sr, 5.5);
      sim.addChord(sig, sr, 0.4, notes, { velocity: 0.25, seed: 6 });
      sim.addVoice(sig, sr, 2.3, 2.5, 0.25, 12);
      const ev = run(sig, sr);
      assert.deepEqual(names(ev), [id], `${notes.join(' ')} ${sr}: ${fmt(ev)}`);
    }
  }
});

test('a chord on a slightly out-of-tune piano (beating unison strings) held 7 s -> exactly once', () => {
  // Three strings per note, detuned by up to ±2 cents: partial amplitudes beat slowly as it rings.
  for (const sr of SRS) {
    for (const [id, notes] of [['C', ['C3', 'E3', 'G3']], ['Cm', ['C4', 'Eb4', 'G4']]]) {
      const sig = blank(sr, 7.5);
      notes.forEach((n, i) => {
        [-2, 2, 0.6].forEach((tuneCents, k) => sim.addPianoNote(sig, sr, 0.4, n,
          { velocity: 0.08, tuneCents, seed: 100 + i * 7 + k * 31, thump: k ? 0 : 0.25 }));
      });
      const ev = run(sig, sr);
      assert.deepEqual(names(ev), [id], `${notes.join(' ')} ${sr}: ${fmt(ev)}`);
    }
  }
});

test('overloaded mic: a loud C + G power chord that clips is not reported as C major (attach)', async (t) => {
  // Clipping a C3+G3 dyad creates intermodulation at f(C)+f(G) = 327 Hz, about 14 cents below E4,
  // with "harmonics" on other combination tones, so the spectrum spells C-E-G. The user played no
  // third. attach() reads the time-domain buffer every tick, so flat-topped (clipped) frames are
  // easy to spot there and should not be classified.
  t.mock.timers.enable({ apis: ['setInterval'] });
  const sr = 48000;
  const base = blank(sr, 2.8);
  sim.addChord(base, sr, 0.4, ['C3', 'G3'], { velocity: 0.4, seed: 3 });
  let peak = 0;
  for (const v of base) peak = Math.max(peak, Math.abs(v));
  const clip = 0.35 * peak; // about 2.7 % of samples clipped: an obvious overload
  const sig = Float32Array.from(base, (x) => Math.max(-clip, Math.min(clip, x)));
  let clock = 0;
  const an = {
    fftSize: 2048, smoothingTimeConstant: 0.8, sim: null,
    get frequencyBinCount() { return this.fftSize / 2; },
    s() { return (this.sim = this.sim || new sim.AnalyserSim({ fftSize: this.fftSize, smoothingTimeConstant: this.smoothingTimeConstant, sampleRate: sr })); },
    getFloatTimeDomainData(out) { out.set(this.s().timeDomain(sig, clock / 1000)); },
    getFloatFrequencyData(out) { out.set(this.s().frequencyData(this.s().timeDomain(sig, clock / 1000))); },
  };
  const ctx = { sampleRate: sr, createAnalyser: () => an };
  const source = { connect(n) { return n; }, disconnect() {} };
  const heard = [];
  const h = CD.attach(ctx, source, { onChord: (n) => heard.push(n), now: () => clock });
  h.start();
  for (clock = 30; clock <= 2700; clock += 30) t.mock.timers.tick(30);
  h.dispose();
  assert.deepEqual(heard, [], `clipped C3+G3 was heard as ${heard}`);
});

test('a single extra note struck while the chord rings', { skip: 'ambiguous: the sounding chord is still C major' }, () => {});

test('a genuine re-strike after the cooldown fires again', () => {
  for (const sr of SRS) {
    for (const [first, second, expect] of [
      [['C4', 'E4', 'G4'], ['C4', 'E4', 'G4'], ['C', 'C']],
      [['C4', 'Eb4', 'G4'], ['C4', 'Eb4', 'G4'], ['Cm', 'Cm']],
      [['C4', 'Eb4', 'G4'], ['C4', 'E4', 'G4'], ['Cm', 'C']],
      [['G3', 'C4', 'E4'], ['C3', 'Eb3', 'G3'], ['C', 'Cm']],
    ]) {
      const sig = blank(sr, 5);
      sim.addChord(sig, sr, 0.4, first, { velocity: 0.2, holdSec: 1.6, seed: 8 });
      sim.addChord(sig, sr, 2.2, second, { velocity: 0.2, seed: 9 });
      const ev = run(sig, sr);
      assert.deepEqual(names(ev), expect, `${first.join(' ')} then ${second.join(' ')} ${sr}: ${fmt(ev)}`);
    }
  }
});

test('re-striking the same chord without releasing it (keys held, struck again) fires again', () => {
  // The first strike is still ringing (keys held) when the same chord is struck again after the
  // cooldown. The new attack is a real chord attack, so it should count.
  for (const sr of SRS) {
    const sig = blank(sr, 5);
    sim.addChord(sig, sr, 0.4, ['C4', 'E4', 'G4'], { velocity: 0.15, seed: 10 });
    sim.addChord(sig, sr, 2.3, ['C4', 'E4', 'G4'], { velocity: 0.3, seed: 11 });
    const ev = run(sig, sr);
    assert.deepEqual(names(ev), ['C', 'C'], `${sr}: ${fmt(ev)}`);
  }
});
