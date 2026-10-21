// core/listener.js (WP1): onsets, pitch-class voting, flush, mute, quiet (spec §2.4.2 and §5.1).
// Frames are fed every 25 ms from tests/synth.js plucks with -50 dB white noise, like the browser's
// analyser. The end of the file covers the pure helpers of the same work package: core/audio.js
// (sequence timing, mute tail, render layout, WAV) and core/keyboard.js (rangeFor).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Pitch = require('../pitch.js');
const Listener = require('../core/listener.js');
const Synth = require('./synth.js');
const Audio = require('../core/audio.js');
const Keyboard = require('../core/keyboard.js');

const SR = Synth.SR;
const mk = (params) => Listener.create({ detectPitch: Pitch.detectPitch, freqToMidi: Pitch.freqToMidi, params });
const notesOf = (evs) => evs.filter((e) => e.type === 'note');
const ofType = (evs, type) => evs.filter((e) => e.type === type);
const PERF = 5000; // feed(): page clock = audio clock + 5000 ms

// A stub detectPitch that returns a scripted list of midis, one per call.
function scripted(midis) {
  const calls = { n: 0 };
  const fn = () => {
    const m = midis[calls.n++];
    return m == null ? null : Pitch.midiToFreq(m);
  };
  return { fn, calls };
}

// Hot Cross Buns opening in eighths at 84 bpm: C4 x4, D4 x4, 357 ms apart.
const HCB = [60, 60, 60, 60, 62, 62, 62, 62];
const IOI = 0.357;

test('params match the spec defaults', () => {
  const T = mk();
  assert.deepEqual(T.params, {
    minGate: 0.002, floorMult: 3, quietMult: 0.6, retriggerMs: 110, rise: 1.7, riseRepeat: 1.35,
    riseLookback: 4, voteStartMs: 35, centsTol: 0.4, agree: 2, timeoutMs: 500, minHz: 70, maxHz: 1400,
  });
  assert.equal(mk({ agree: 3 }).params.agree, 3);
});

test('(a) one C4 pluck gives exactly one note, agree, decided within 100 ms', () => {
  for (const startMs of [0, 6, 12, 18, 24]) {
    const evs = Synth.feed(mk(), Synth.render([{ midi: 60, at: 0.5 }], SR, { length: 2 }), SR, { startMs });
    const notes = notesOf(evs);
    assert.equal(notes.length, 1, `hop phase ${startMs}`);
    const n = notes[0];
    assert.equal(n.midi, 60);
    assert.equal(n.reason, 'agree');
    assert.equal(n.confident, true);
    assert.ok(n.tConfirm - n.tOnset <= 100, `decided after ${(n.tConfirm - n.tOnset).toFixed(1)} ms`);
    assert.ok(Math.abs(n.cents) < 40, 'cents is small');
    assert.ok(Math.abs(n.tOnset - (n.at * 1000 + PERF)) < 1e-6, 'tOnset is at on the page clock');
    assert.equal(ofType(evs, 'onset').length, 1);
    assert.ok(ofType(evs, 'level').length > 50, 'a level event every hop');
  }
});

test('(b) E4 three times, re-attacked every 500 ms, gives 3 notes', () => {
  const sig = Synth.render([0, 0.5, 1].map((t) => ({ midi: 64, at: 0.3 + t, dur: 0.42 })), SR);
  const notes = notesOf(Synth.feed(mk(), sig, SR));
  assert.deepEqual(notes.map((n) => n.midi), [64, 64, 64]);
  assert.ok(notes.every((n) => n.reason === 'agree'));
});

test('(c) Hot Cross Buns eighths (C4 x4, D4 x4 at 357 ms) give 8 notes in order', () => {
  const sig = Synth.render(HCB.map((midi, i) => ({ midi, at: 0.3 + i * IOI, dur: IOI * 0.8 })), SR);
  const notes = notesOf(Synth.feed(mk(), sig, SR));
  assert.deepEqual(notes.map((n) => n.midi), HCB);
  notes.forEach((n, i) => assert.ok(Math.abs(n.at - (0.3 + i * IOI)) <= 0.005, `note ${i} onset error ${((n.at - 0.3 - i * IOI) * 1000).toFixed(1)} ms`));
});

test('(c) still 8 notes with +-5 ms hop jitter', () => {
  const sig = Synth.render(HCB.map((midi, i) => ({ midi, at: 0.3 + i * IOI, dur: IOI * 0.8 })), SR);
  for (const seed of [1, 2, 3]) {
    const notes = notesOf(Synth.feed(mk(), sig, SR, { jitterMs: 5, seed }));
    assert.deepEqual(notes.map((n) => n.midi), HCB, `seed ${seed}`);
  }
});

// Legato restrikes: the old note is cut by the new strike, and each new strike is `rise` times the
// level the old one had decayed to. 2 of the 6 restrikes rise only 1.5x (under the 1.7x rule). D4
// starts fresh after the damper (a short dip).
function legatoHcb() {
  const rises = [null, 1.5, 2.4, 2.2, null, 1.5, 2.3, 2.4];
  const events = [];
  let gain = 0.12;
  HCB.forEach((midi, i) => {
    const at = 0.3 + i * IOI;
    if (i > 0) {
      const prev = events[i - 1];
      if (rises[i] == null) { prev.dur = IOI * 0.8; gain = 0.12; } // key up before D4
      else { prev.dur = IOI; prev.damp = 0.0015; gain = prev.gain * Synth.envelope(IOI, { decay: 1.5 }) * rises[i]; }
    }
    events.push({ midi, at, gain, dur: Infinity });
  });
  events[events.length - 1].dur = 0.5;
  return Synth.render(events, SR);
}

test('(d) restrikes rising only 1.5x: 8 notes with expect({repeat:true}), at least 6 without', () => {
  const sig = legatoHcb();
  const withExpect = mk();
  withExpect.expect({ repeat: true });
  assert.deepEqual(notesOf(Synth.feed(withExpect, sig, SR)).map((n) => n.midi), HCB);
  const without = notesOf(Synth.feed(mk(), sig, SR)).map((n) => n.midi);
  assert.ok(without.length >= 6 && without.length < 8, `without expect: ${without.length} notes`);
  // expect({repeat:false}) goes back to the normal rule
  const toggled = mk();
  toggled.expect({ repeat: true });
  toggled.expect({ repeat: false });
  assert.equal(notesOf(Synth.feed(toggled, sig, SR)).length, without.length);
});

test('(e) octave flips 60, 72, 60: pitch class C after 2 votes, midi from the majority octave 60', () => {
  const stub = scripted([60, 72, 60]);
  const T = Listener.create({ detectPitch: stub.fn, freqToMidi: Pitch.freqToMidi });
  const notes = notesOf(Synth.feed(T, Synth.render([{ midi: 60, at: 0.4 }], SR, { length: 1.2 }), SR));
  assert.equal(notes.length, 1);
  assert.equal(notes[0].midi % 12, 0);
  assert.equal(notes[0].midi, 60);
  assert.equal(notes[0].reason, 'agree');
  assert.equal(stub.calls.n, 2, 'decided on the 2nd vote');
});

test('(e) the most common octave wins inside the pitch class', () => {
  assert.equal(Listener.decide([{ m: 72, raw: 72 }, { m: 60, raw: 60.1 }, { m: 72, raw: 71.9 }], 0).midi, 72);
  assert.equal(Listener.decide([{ m: 60, raw: 60 }, { m: 72, raw: 72 }], 0).midi, 60, 'tie: the lower octave');
  assert.ok(Math.abs(Listener.decide([{ m: 64, raw: 64.2 }, { m: 64, raw: 64.1 }], 4).cents - 15) < 1e-9, 'cents = mean deviation');
});

test('(f) a new onset before agreement flushes the old note (2 votes in one pitch class)', () => {
  // Note 1 at 0.4 s votes C, G, C, E, A, D, B (never 2 in a row); note 2 (F4) at 0.65 s.
  let tMs = 0;
  const first = [60, 67, 72, 64, 69, 62, 71, 66, 70];
  let k = 0;
  const detectPitch = () => {
    if (tMs < 650) { const m = first[k++]; return m == null ? null : Pitch.midiToFreq(m); }
    return Pitch.midiToFreq(65);
  };
  const T = Listener.create({ detectPitch, freqToMidi: Pitch.freqToMidi });
  const sig = Synth.render([{ midi: 60, at: 0.4, dur: 0.2 }, { midi: 65, at: 0.65, dur: 0.4 }], SR);
  const notes = notesOf(Synth.feed(T, sig, SR, { onHop: (t) => { tMs = t; } }));
  assert.equal(notes.length, 2);
  assert.equal(notes[0].reason, 'flush');
  assert.equal(notes[0].confident, false);
  assert.equal(notes[0].midi, 60, 'C, lower octave of the 60/72 tie');
  assert.ok(Math.abs(notes[0].at - 0.4) < 0.005, 'the flushed note keeps its own onset');
  assert.equal(notes[1].midi, 65);
  assert.equal(notes[1].reason, 'agree');
});

test('timeout: no agreement in 500 ms takes the majority pitch class (2+ votes), not confident', () => {
  const stub = scripted([60, 62, 72, 64, 65, 67, 69, 71, 61, 63, 66, 68, 70]);
  const T = Listener.create({ detectPitch: stub.fn, freqToMidi: Pitch.freqToMidi });
  const notes = notesOf(Synth.feed(T, Synth.render([{ midi: 60, at: 0.3, dur: 1 }], SR, { length: 1.6 }), SR));
  assert.equal(notes.length, 1);
  assert.equal(notes[0].reason, 'timeout');
  assert.equal(notes[0].confident, false);
  assert.equal(notes[0].midi, 60);
  assert.ok(notes[0].tConfirm - notes[0].tOnset >= 500);
  // one vote per pitch class: nothing at all
  const none = Listener.create({ detectPitch: scripted([60, 62, 64, 65, 67, 69, 71, 61, 63, 66, 68, 70]).fn, freqToMidi: Pitch.freqToMidi });
  assert.equal(notesOf(Synth.feed(none, Synth.render([{ midi: 60, at: 0.3, dur: 1 }], SR, { length: 1.6 }), SR)).length, 0);
});

test('(g) a muted window over 2 plucks gives 0 notes; the next unmuted pluck is detected', () => {
  const sig = Synth.render([
    { midi: 60, at: 0.3, dur: 0.4 }, { midi: 64, at: 0.8, dur: 0.4 }, { midi: 67, at: 1.8, dur: 0.4 },
  ], SR);
  const evs = Synth.feed(mk(), sig, SR, { muted: (t) => t >= 250 && t < 1400 });
  const notes = notesOf(evs);
  assert.deepEqual(notes.map((n) => n.midi), [67]);
  assert.ok(ofType(evs, 'onset').every((o) => o.at > 1.4), 'no onsets while muted');
  assert.ok(ofType(evs, 'level').some((l) => l.hopMs > 300 && l.hopMs < 1300), 'level events keep coming while muted');
});

test('(g) a mute cuts a note that is still being decided', () => {
  const evs = Synth.feed(mk(), Synth.render([{ midi: 60, at: 0.3, dur: 0.5 }], SR), SR, { muted: (t) => t >= 330 && t < 700 });
  assert.equal(notesOf(evs).length, 0);
});

test('(h) noise alone for 5 s gives no notes and no onsets', () => {
  const evs = Synth.feed(mk(), Synth.render([], SR, { length: 5 }), SR);
  assert.equal(notesOf(evs).length, 0);
  assert.equal(ofType(evs, 'onset').length, 0);
});

test('(i) a 2nd partial at 1.2x the fundamental still gives the right pitch class', () => {
  for (const midi of [55, 57, 60, 62, 64, 65, 67, 69, 71, 72, 76, 79]) {
    const sig = Synth.render([{ midi, at: 0.3, dur: 0.5, partials: [1, 1.2, 0.25] }], SR);
    const notes = notesOf(Synth.feed(mk(), sig, SR));
    assert.equal(notes.length, 1, `midi ${midi}`);
    assert.equal(notes[0].midi % 12, midi % 12, `midi ${midi} heard as ${notes[0].midi}`);
  }
});

test('(j) onset time `at` is within 5 ms of the true attack (midi 55..84, every hop phase)', () => {
  let worst = 0;
  for (let midi = 55; midi <= 84; midi++) {
    for (const startMs of [0, 5, 10, 15, 20]) {
      const sig = Synth.render([{ midi, at: 0.4, dur: 0.5 }], SR, { length: 1.2, seed: midi + startMs });
      const notes = notesOf(Synth.feed(mk(), sig, SR, { startMs }));
      assert.equal(notes.length, 1, `midi ${midi} phase ${startMs}`);
      worst = Math.max(worst, Math.abs(notes[0].at - 0.4) * 1000);
    }
  }
  assert.ok(worst <= 5, `worst onset error ${worst.toFixed(2)} ms`);
});

test('(k) a quiet event follows each decayed note, before the next onset', () => {
  const sig = Synth.render([0, 0.6, 1.2].map((t, i) => ({ midi: [60, 64, 67][i], at: 0.3 + t, dur: 0.35 })), SR);
  const evs = Synth.feed(mk(), sig, SR);
  const onsets = ofType(evs, 'onset').map((e) => e.tOnset);
  const quiets = ofType(evs, 'quiet').map((e) => e.tOnset);
  assert.equal(onsets.length, 3);
  assert.equal(quiets.length, 3);
  onsets.forEach((t, i) => {
    const next = onsets[i + 1] == null ? Infinity : onsets[i + 1];
    assert.ok(quiets.some((q) => q > t && q < next), `quiet after note ${i}`);
  });
});

test('no quiet event without an onset (e.g. after a mute over our own tone)', () => {
  const sig = Synth.render([{ midi: 72, at: 0.3, dur: 0.4 }], SR, { length: 2 });
  const evs = Synth.feed(mk(), sig, SR, { muted: (t) => t >= 250 && t < 900 });
  assert.equal(ofType(evs, 'quiet').length, 0);
  assert.equal(notesOf(evs).length, 0);
});

test('fast detached notes (150 ms apart) are all kept, in order', () => {
  const run = [60, 62, 64, 65, 67, 65, 64, 62, 60];
  const sig = Synth.render(run.map((midi, i) => ({ midi, at: 0.3 + i * 0.15, dur: 0.09 })), SR);
  assert.deepEqual(notesOf(Synth.feed(mk(), sig, SR)).map((n) => n.midi), run);
});

test('reset() forgets the state', () => {
  const T = mk();
  const sig = Synth.render([{ midi: 60, at: 0.3, dur: 0.5 }], SR);
  assert.equal(notesOf(Synth.feed(T, sig, SR)).length, 1);
  T.expect({ repeat: true });
  T.reset();
  assert.equal(notesOf(Synth.feed(T, sig, SR)).length, 1);
});

// ---------------------------------------------------------------- core/audio.js pure helpers
test('audio: sequenceEvents spaces notes by beats, skips rests, dur = max(0.25, beats*spb*0.92)', () => {
  const items = [
    { kind: 'note', midi: 64, beats: 1 }, { kind: 'rest', beats: 1 }, { kind: 'note', midi: 62, beats: 2 },
    { kind: 'note', midi: 60, beats: 0.5 },
  ];
  const { events, notes, beats, spb } = Audio.sequenceEvents(items, { bpm: 120 });
  assert.equal(spb, 0.5);
  assert.equal(beats, 4.5);
  assert.deepEqual(events.map((e) => e.at), [0, 1, 2]);
  assert.deepEqual(events.map((e) => +e.dur.toFixed(3)), [0.46, 0.92, 0.25]);
  assert.deepEqual(notes.map((n) => n.midi), [64, 62, 60]);
  const slow = Audio.sequenceEvents(items, { bpm: 120, speed: 0.5 });
  assert.deepEqual(slow.events.map((e) => e.at), [0, 2, 4]);
  // Pitch.parseNote objects (no kind) are notes too
  const parsed = Audio.sequenceEvents(['E4', 'D4:h'].map(Pitch.parseNote), { bpm: 60 });
  assert.deepEqual(parsed.events.map((e) => [e.midi, e.at]), [[64, 0], [62, 1]]);
});

test('audio: the mute tail is end + 250 ms + output latency', () => {
  assert.equal(Audio.muteEnd(1000, 0), 1250);
  assert.equal(Audio.muteEnd(1000, 0.12), 1370);
  assert.equal(Audio.STOP_RELEASE_MS, 300);
});

test('audio: piano voice partials', () => {
  const p = Audio.pianoPartials(440);
  assert.deepEqual(p.map((x) => x.gain), [1, 0.45, 0.2, 0.08]);
  assert.deepEqual(p.map((x) => +x.tau.toFixed(4)), [1.4, 0.7, 0.4667, 0.35]);
  p.forEach((x, i) => {
    const h = i + 1;
    assert.ok(Math.abs(x.freq - 440 * h * (1 + 0.0004 * h * h)) < 1e-9);
  });
});

test('audio: render layout puts tracks in a row with a gap, and a drone on each downbeat', () => {
  const mary = ['E4', 'D4', 'C4', 'D4', 'E4', 'E4', 'E4:h'].map((t) => Object.assign({ kind: 'note' }, Pitch.parseNote(t)));
  const plan = Audio.layoutTracks([
    { id: 'a', items: mary, bpm: 120 },
    { id: 'b', items: mary, bpm: 120, octaveShift: 1 },
  ], { gapSec: 1.5 });
  const [a, b] = plan.layout;
  assert.equal(a.noteTimes.length, 7);
  assert.ok(Math.abs(a.end - a.start - 4) < 1e-9, '8 beats at 120 bpm = 4 s');
  assert.ok(Math.abs(b.start - (a.end + 1.5)) < 1e-9);
  assert.ok(plan.duration > b.end);
  assert.equal(plan.notes.length, 14);
  assert.equal(plan.notes[7].midi, 76, 'octaveShift');
  // drone: with key 'C major' the tonic is C (without a key it would be the last note, E)
  const keyed = Audio.layoutTracks([{ id: 'a', items: mary, bpm: 120, key: 'C major' }], { gapSec: 1.5 });
  const firstBar = keyed.drones.filter((d) => Math.abs(d.t - keyed.layout[0].start) < 1e-9).map((d) => d.midi);
  assert.deepEqual(firstBar, [48, 55], 'C3 and G3, an octave below C4');
  assert.equal(keyed.drones.length, 4, '2 bars x tonic + fifth');
  assert.equal(Audio.layoutTracks([{ id: 'a', items: mary, bpm: 120 }], { drone: false }).drones.length, 0);
  // pickup: the first downbeat comes after the pickup beats
  const pick = Audio.layoutTracks([{ id: 'p', items: mary, bpm: 60, pickup: 1, key: 'C' }]);
  assert.ok(Math.abs(pick.drones[0].t - (pick.layout[0].start + 1)) < 1e-9);
});

test('audio: tonicPc reads key names', () => {
  assert.equal(Audio.tonicPc('C'), 0);
  assert.equal(Audio.tonicPc('G major'), 7);
  assert.equal(Audio.tonicPc('Bb'), 10);
  assert.equal(Audio.tonicPc('F# minor'), 6);
  assert.equal(Audio.tonicPc(null, 67), 7);
  assert.equal(Audio.tonicPc(62), 2);
});

test('audio: encodeWav writes a 16-bit mono WAV', () => {
  const wav = new DataView(Audio.encodeWav(new Float32Array([0, 0.5, -1, 2]), 16000));
  const str = (o, n) => String.fromCharCode(...Array.from({ length: n }, (_, i) => wav.getUint8(o + i)));
  assert.equal(str(0, 4), 'RIFF');
  assert.equal(str(8, 4), 'WAVE');
  assert.equal(wav.getUint16(22, true), 1, 'mono');
  assert.equal(wav.getUint32(24, true), 16000);
  assert.equal(wav.getUint16(34, true), 16);
  assert.equal(wav.getUint32(40, true), 8);
  assert.equal(wav.byteLength, 52);
  assert.deepEqual([0, 1, 2, 3].map((i) => wav.getInt16(44 + 2 * i, true)), [0, 16383, -32768, 32767]);
});

// ---------------------------------------------------------------- core/keyboard.js rangeFor
test('keyboard: rangeFor is white-aligned, at least C4..E5, and grows to cover the notes', () => {
  assert.deepEqual(Keyboard.rangeFor([60, 62, 64], { width: 375 }), { low: 60, high: 76 });
  assert.deepEqual(Keyboard.rangeFor([], { width: 375 }), { low: 60, high: 76 });
  assert.deepEqual(Keyboard.rangeFor([{ midi: 55 }, { midi: 67 }], { width: 375 }), { low: 55, high: 76 }, 'G3 tune: 13 white keys');
  assert.deepEqual(Keyboard.rangeFor([61, 78], { width: 800 }), { low: 60, high: 79 }, 'black ends widen to whites');
});

test('keyboard: rangeFor caps white keys (13 under 420 px, else 15) and keeps the most notes', () => {
  const whites = ({ low, high }) => { let n = 0; for (let m = low; m <= high; m++) if (!Keyboard.isBlack(m)) n++; return n; };
  const wide = [55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79]; // G3..G5
  const phone = Keyboard.rangeFor(wide, { width: 375 });
  assert.equal(whites(phone), 13);
  assert.deepEqual(Keyboard.rangeFor(wide, { width: 800 }), { low: 55, high: 79 });
  // most of the tune sits high: the window slides up
  const high = Keyboard.rangeFor([55, 72, 74, 76, 77, 79, 79, 77, 76], { width: 375 });
  assert.equal(whites(high), 13);
  assert.equal(high.high, 79);
  for (const w of [320, 375, 419, 420, 1024]) {
    const r = Keyboard.rangeFor([43, 48, 84, 91], { width: w });
    assert.ok(whites(r) <= (w < 420 ? 13 : 15), `width ${w}`);
    assert.ok(!Keyboard.isBlack(r.low) && !Keyboard.isBlack(r.high));
  }
});
