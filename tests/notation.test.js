// WP2: core/notation.js (spec §2.4.5, §3.7.6, §5.1).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Pitch = require('../pitch.js');
const N = require('../core/notation.js');

// The committed v1 strings (songs.js at b39bea5) plus Hot Cross Buns from §3.7.6.
const LEGACY = {
  mary: 'E4 D4 C4 D4 E4 E4 E4:h D4 D4 D4:h E4 G4 G4:h E4 D4 C4 D4 E4 E4 E4 E4 D4 D4 E4 D4 C4:w',
  ode: 'E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4:q. D4:e D4:h E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4:q. C4:e C4:h',
  twinkle: 'C4 C4 G4 G4 A4 A4 G4:h F4 F4 E4 E4 D4 D4 C4:h G4 G4 F4 F4 E4 E4 D4:h G4 G4 F4 F4 E4 E4 D4:h C4 C4 G4 G4 A4 A4 G4:h F4 F4 E4 E4 D4 D4 C4:h',
  hcb: 'E4 D4 C4:h E4 D4 C4:h C4:e C4:e C4:e C4:e D4:e D4:e D4:e D4:e E4 D4 C4:h',
};
const sizes = (phrases) => phrases.map(([a, b]) => b - a);

function coversAll(phrases, n) {
  let at = 0;
  for (const [a, b] of phrases) {
    assert.equal(a, at, 'phrases are contiguous');
    assert.ok(b > a, 'phrase not empty');
    at = b;
  }
  assert.equal(at, n, 'phrases cover every note');
}

test('every natural token C3..C6 with every length matches Pitch.parseNote', () => {
  const durs = ['w', 'h', 'q', 'e', 's', 'w.', 'h.', 'q.', 'e.', 's.'];
  let count = 0;
  for (let oct = 3; oct <= 6; oct++) {
    for (const L of ['C', 'D', 'E', 'F', 'G', 'A', 'B']) {
      if (oct === 6 && L !== 'C') continue;
      for (const d of durs) {
        const tok = `${L}${oct}:${d}`;
        const a = N.parseToken(tok);
        const b = Pitch.parseNote(tok);
        for (const k of ['letter', 'midi', 'staffPos', 'dur', 'beats']) assert.equal(a[k], b[k], `${tok} ${k}`);
        assert.equal(a.kind, 'note');
        assert.equal(a.acc, '');
        count++;
      }
    }
  }
  assert.equal(count, 22 * 10);
  // default length is a quarter, as in pitch.js
  assert.equal(N.parseToken('E4').dur, 'q');
  assert.equal(N.parseToken('E4').beats, 1);
});

// Note: §2.4.5 / §5.1 quote staffPos 3 for F#4 and 6 for Bb4, but those are the letter indices. The
// binding formula (octave*7 + letterIndex - 30, same as Pitch.parseNote) puts F#4 in the first space
// (1) and Bb4 on the middle line (4), and that is what is drawn.
test('accidentals and rests', () => {
  const fs = N.parseToken('F#4:q.');
  assert.deepEqual(
    { kind: fs.kind, letter: fs.letter, acc: fs.acc, octave: fs.octave, midi: fs.midi, pc: fs.pc, staffPos: fs.staffPos, dur: fs.dur, beats: fs.beats, key: fs.key },
    { kind: 'note', letter: 'F', acc: '#', octave: 4, midi: 66, pc: 6, staffPos: 1, dur: 'q.', beats: 1.5, key: 'F#4' },
  );
  const bb = N.parseToken('Bb4');
  assert.equal(bb.acc, 'b');
  assert.equal(bb.midi, 70);
  assert.equal(bb.staffPos, 4);
  assert.equal(bb.staffPos, N.parseToken('B4').staffPos);
  assert.equal(fs.staffPos, N.parseToken('F4').staffPos);
  assert.equal(N.parseToken('E4').acc, '');
  // unicode signs read the same as # and b
  assert.equal(N.parseToken('F♯4').midi, 66);
  assert.equal(N.parseToken('B♭4').key, 'Bb4');
  // B#3 / Cb4 keep their letter on the staff
  assert.equal(N.parseToken('Cb4').midi, 59);
  assert.equal(N.parseToken('Cb4').staffPos, -2);
  const r = N.parseToken('R:h');
  assert.deepEqual(r, { kind: 'rest', dur: 'h', beats: 2 });
  assert.equal(N.parseToken('R').beats, 1);
  assert.throws(() => N.parseToken('H4'));
  assert.throws(() => N.parseToken('C4:x'));
  assert.throws(() => N.parseToken('C'));
});

test('parseMelody: "/" phrase marks and "|" bar marks', () => {
  const m = N.parseMelody('E4 D4 C4:h / E4 | D4 C4:h');
  assert.deepEqual(m.phrases, [[0, 3], [3, 6]]);
  assert.equal(m.marked, true);
  assert.deepEqual(m.bars, [4]);
  assert.equal(m.notes.length, 6);
  assert.equal(m.endBeat, 8);
  assert.deepEqual(m.notes.map((n) => n.beat), [0, 1, 2, 4, 5, 6]);
  assert.deepEqual(m.notes.map((n) => n.i), [0, 1, 2, 3, 4, 5]);
  // marks may touch tokens
  const t = N.parseMelody('E4 D4 C4:h/ E4| D4 C4:h');
  assert.deepEqual(t.phrases, [[0, 3], [3, 6]]);
  assert.deepEqual(t.bars, [4]);
  // unmarked strings use autoPhrases
  const u = N.parseMelody(LEGACY.hcb);
  assert.equal(u.marked, false);
  assert.deepEqual(sizes(u.phrases), [3, 3, 8, 3]);
});

test('parseMelody: rests stay in items, leave notes, and count in endBeat and beats', () => {
  const m = N.parseMelody('C4 D4 R E4:h R:h G4');
  assert.equal(m.items.length, 6);
  assert.equal(m.notes.length, 4);
  assert.deepEqual(m.notes.map((n) => n.beat), [0, 1, 3, 7]);
  assert.equal(m.endBeat, 8);
  assert.deepEqual(m.items.filter((x) => x.kind === 'rest').map((x) => x.beat), [2, 5]);
  assert.ok(m.notes.every((n) => n.kind === 'note'));
});

test('parseMelody: marked phrases outside 2..10 notes are fixed up', () => {
  // a 1-note phrase joins the next one
  const a = N.parseMelody('C4 / D4 E4 F4 / G4 A4');
  assert.deepEqual(a.phrases, [[0, 4], [4, 6]]);
  // a 1-note last phrase joins the previous one
  const b = N.parseMelody('C4 D4 E4 / F4');
  assert.deepEqual(b.phrases, [[0, 4]]);
  // a 12-note marked span is split by the auto rules
  const c = N.parseMelody('C4 D4 E4 F4 G4 A4 G4 F4 E4 D4 C4 D4 / E4 D4 C4:h');
  coversAll(c.phrases, 15);
  assert.ok(c.phrases.every(([x, y]) => y - x >= 2 && y - x <= 10));
  assert.deepEqual(c.phrases[c.phrases.length - 1], [12, 15]);
});

test('autoPhrases on the legacy strings', () => {
  const exp = { twinkle: [7, 7, 7, 7, 7, 7], ode: [8, 7, 8, 7], mary: [7, 3, 3, 8, 5], hcb: [3, 3, 8, 3] };
  for (const [id, want] of Object.entries(exp)) {
    const { notes } = N.parseMelody(LEGACY[id]);
    const ph = N.autoPhrases(notes, { beatsPerBar: 4, pickup: 0 });
    assert.deepEqual(sizes(ph), want, id);
    coversAll(ph, notes.length);
  }
});

test('autoPhrases: works on notes without .beat, empty input, rests and the 10-note cap', () => {
  assert.deepEqual(N.autoPhrases([], {}), []);
  const bare = LEGACY.hcb.split(' ').map((t) => Pitch.parseNote(t)); // no .beat
  assert.deepEqual(sizes(N.autoPhrases(bare, {})), [3, 3, 8, 3]);
  // a rest closes a phrase (R1)
  const r = N.parseMelody('C4 D4 E4 R F4 G4 A4 R B4 C5 D5');
  assert.deepEqual(sizes(r.phrases), [3, 3, 3]);
  // 24 even quarters with no long notes: every phrase stays within 3..8 notes
  const run = N.parseMelody(Array(24).fill('C4 D4 E4 F4').join(' ').split(' ').slice(0, 24).join(' '));
  coversAll(run.phrases, 24);
  assert.ok(run.phrases.every(([a, b]) => b - a >= 3 && b - a <= 8), JSON.stringify(run.phrases));
  // eighths only, no bar line on a valid split: still capped at 10 (R4)
  const eighths = N.parseMelody(Array(14).fill('C4:e').join(' '), { beatsPerBar: 4 });
  coversAll(eighths.phrases, 14);
  assert.ok(eighths.phrases.every(([a, b]) => b - a <= 10));
  // pickup shifts the bar lines
  const bday = N.parseMelody('G4:e. G4:s A4 G4 C5 B4:h G4:e. G4:s A4 G4 D5 C5:h G4:e. G4:s G5 E5 C5 B4 A4 F5:e. F5:s E5 C5 D5 C5:h.', { beatsPerBar: 3, pickup: 1 });
  coversAll(bday.phrases, bday.notes.length);
  assert.deepEqual(sizes(bday.phrases).slice(0, 2), [6, 6]);
  assert.ok(bday.phrases.every(([a, b]) => b - a >= 3 && b - a <= 10));
});

test('noteKey, fromKey, samePitchClass', () => {
  assert.equal(N.noteKey(N.parseToken('F#4:h')), 'F#4');
  assert.equal(N.noteKey(N.parseToken('E4')), 'E4');
  assert.equal(N.noteKey(Pitch.parseNote('G3')), 'G3'); // pitch.js notes have no octave field
  const f = N.fromKey('Bb4');
  assert.equal(f.midi, 70);
  assert.equal(f.key, 'Bb4');
  assert.equal(N.samePitchClass(60, 72), true);
  assert.equal(N.samePitchClass(N.parseToken('C4'), N.parseToken('C5')), true);
  assert.equal(N.samePitchClass(N.parseToken('C#4'), N.parseToken('Db5')), true);
  assert.equal(N.samePitchClass(60, 62), false);
});

test('spellMidi', () => {
  const bb = N.spellMidi(70, 'flat');
  assert.equal(bb.key, 'Bb4');
  assert.equal(bb.staffPos, 4);
  const cs = N.spellMidi(61);
  assert.equal(cs.key, 'C#4');
  assert.equal(cs.staffPos, -2);
  const sharps = [];
  const flats = [];
  for (let m = 60; m < 72; m++) {
    sharps.push(N.displayName(N.spellMidi(m, 'sharp')));
    flats.push(N.displayName(N.spellMidi(m, 'flat')));
  }
  assert.deepEqual(sharps, ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']);
  assert.deepEqual(flats, ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B']);
  // same staffPos formula as parseNote for every natural
  for (let m = 43; m <= 96; m++) {
    const s = N.spellMidi(m);
    if (s.acc) continue;
    assert.equal(s.staffPos, Pitch.parseNote(s.letter + s.octave).staffPos, s.key);
    assert.equal(s.midi, m);
  }
});

test('foldToRange', () => {
  assert.equal(N.foldToRange(48, 60, 76), 60);
  assert.equal(N.foldToRange(84, 60, 76), 72);
  assert.equal(N.foldToRange(64, 60, 76), 64);
  assert.equal(N.foldToRange(30, 60, 79), 66);
});

test('placeOnStaff', () => {
  let p = N.placeOnStaff(55);
  assert.equal(p.note.key, 'G3');
  assert.equal(p.zone, 'ledger');
  assert.equal(p.fold, 0);
  p = N.placeOnStaff(50);
  assert.equal(p.note.key, 'D4');
  assert.equal(p.heard.key, 'D3');
  assert.equal(p.fold, -1);
  assert.equal(p.zone, 'folded');
  p = N.placeOnStaff(45);
  assert.equal(p.note.key, 'A4');
  assert.equal(p.fold, -2);
  p = N.placeOnStaff(81);
  assert.equal(p.note.key, 'A5');
  assert.equal(p.zone, 'ledger');
  p = N.placeOnStaff(86);
  assert.equal(p.note.key, 'D5');
  assert.equal(p.heard.key, 'D6');
  assert.equal(p.fold, 1);
  p = N.placeOnStaff(64);
  assert.equal(p.zone, 'core');
  assert.equal(p.note.key, 'E4');
  // flats spelling flows through
  p = N.placeOnStaff(66, { prefer: 'flat' });
  assert.equal(p.note.key, 'Gb4');
  // fold mode: always folded into the core, fold reported as 0
  for (const m of [45, 50, 55, 81, 86, 64, 36, 96]) {
    const f = N.placeOnStaff(m, { mode: 'fold' });
    assert.equal(f.zone, 'core', String(m));
    assert.equal(f.fold, 0);
    assert.ok(f.note.staffPos >= -2 && f.note.staffPos <= 9, `${m} -> ${f.note.key}`);
    assert.equal(((f.note.midi - m) % 12 + 12) % 12, 0);
  }
  // the whole mic range lands on the drawable staff with |fold| <= 2
  for (let m = 36; m <= 90; m++) {
    const h = N.placeOnStaff(m);
    assert.ok(h.note.staffPos >= -5 && h.note.staffPos <= 12, String(m));
    assert.ok(Math.abs(h.fold) <= 2, String(m));
    assert.equal(h.note.midi + 12 * h.fold, m);
  }
});

test('describePosition: plain words for -5..12, no mnemonics', () => {
  const seen = new Set();
  for (let p = -5; p <= 12; p++) {
    const t = N.describePosition({ staffPos: p });
    assert.equal(typeof t, 'string', String(p));
    assert.ok(t.length > 0);
    assert.doesNotMatch(t, /every|good|boy|face|cow/i);
    seen.add(t);
  }
  assert.equal(seen.size, 18, 'each position has its own wording');
  assert.equal(N.describePosition(N.parseToken('E4')), 'on the bottom line');
  assert.equal(N.describePosition(N.parseToken('A4')), 'in the second space');
  assert.equal(N.describePosition(N.parseToken('C4')), 'on a short line below the staff');
  assert.equal(N.describePosition(9), 'just above the top line');
  assert.equal(typeof N.describePosition(-9), 'string');
  assert.equal(typeof N.describePosition(20), 'string');
  assert.equal(N.RANGE.low, 'G3');
  assert.equal(N.RANGE.high, 'C6');
});

test('accidentalMarks: each note, or the bar rule with naturals on a return', () => {
  const m = N.parseMelody('F#4 F#4 F4 G4 | F4 F#4 Bb4 B4');
  assert.deepEqual(N.accidentalMarks(m.notes), ['#', '#', '', '', '', '#', 'b', '']);
  assert.deepEqual(N.accidentalMarks(m.notes, { policy: 'bar', bars: m.bars }), ['#', '', 'n', '', '', '#', 'b', 'n']);
  // without bars[], bar lines come from beats
  assert.deepEqual(N.accidentalMarks(m.notes, { policy: 'bar', beatsPerBar: 4 }), ['#', '', 'n', '', '', '#', 'b', 'n']);
  // the rule is per octave: F#4 does not carry to F5
  const o = N.parseMelody('F#4 F5');
  assert.deepEqual(N.accidentalMarks(o.notes, { policy: 'bar' }), ['#', '']);
});
