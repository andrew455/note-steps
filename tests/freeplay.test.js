// Free Play (WP8): quantizer, timed layout, wording, playback timing, "I know that tune!" and scales.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../modes/freeplay-core.js');
const N = require('../core/notation.js');

// ---------- fixtures: the legacy song strings (titles only, no lyrics) ----------
const RAW = [
  { id: 'scale-up', kind: 'exercise', title: 'C major scale, going up', music: 'C4 D4 E4 F4 G4 A4 B4 C5:h' },
  { id: 'mary', kind: 'song', title: 'Mary Had a Little Lamb', music: 'E4 D4 C4 D4 E4 E4 E4:h D4 D4 D4:h E4 G4 G4:h E4 D4 C4 D4 E4 E4 E4 E4 D4 D4 E4 D4 C4:w' },
  { id: 'ode', kind: 'song', title: 'Ode to Joy', music: 'E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4:q. D4:e D4:h E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4:q. C4:e C4:h' },
  { id: 'twinkle', kind: 'song', title: 'Twinkle Twinkle Little Star', music: 'C4 C4 G4 G4 A4 A4 G4:h F4 F4 E4 E4 D4 D4 C4:h' },
  { id: 'jingle', kind: 'song', family: 'jingle', title: 'Jingle Bells', music: 'E4 E4 E4:h E4 E4 E4:h E4 G4 C4:q. D4:e E4:w F4 F4 F4:q. F4:e F4 E4 E4' },
  { id: 'jingle-chorus', kind: 'song', family: 'jingle', title: 'Jingle Bells (chorus)', music: 'E4 E4 E4:h E4 E4 E4:h E4 G4 C4:q. D4:e E4:w' },
  { id: 'frere', kind: 'song', title: 'Frère Jacques', music: 'C4 D4 E4 C4 C4 D4 E4 C4 E4 F4 G4:h E4 F4 G4:h' },
  { id: 'birthday', kind: 'song', title: 'Happy Birthday', music: 'G4:e. G4:s A4 G4 C5 B4:h G4:e. G4:s A4 G4 D5 C5:h' },
];
const SONGS = RAW.map((r) => Object.assign({}, r, { notes: N.parseMelody(r.music).notes }));
const song = (id) => SONGS.find((s) => s.id === id);
const midis = (id) => song(id).notes.map((n) => n.midi);
const recognizer = (opts) => F.createRecognizer(F.buildIndex(SONGS), opts);
const pushAll = (R, list) => list.map((m) => R.push(m));

// ---------- quantizer ----------
test('quantizer grid at 80 bpm: 375 / 750 / 1125 / 1500 / 3000 ms give e / q / q. / h / w', () => {
  const beat = 750;
  assert.deepEqual([375, 750, 1125, 1500, 3000].map((ioi) => F.quantize(ioi, beat).dur), ['e', 'q', 'q.', 'h', 'w']);
  assert.deepEqual(F.quantize(2250, beat).dur, 'h.');
  assert.equal(F.quantize(100, beat).dur, 'e', 'very short gaps are eighths');
  assert.equal(F.quantize(3300, beat).dur, 'w', 'up to 4.5 beats is still one note');
  [375, 750, 1125, 1500, 3000].forEach((ioi) => assert.deepEqual(F.quantize(ioi, beat).rests, []));
});

test('quantizer: a 5 s gap with the note off at 700 ms gives a quarter plus rests', () => {
  const q = F.quantize(5000, 750, 700);
  assert.equal(q.dur, 'q');
  assert.equal(q.beats, 1);
  assert.deepEqual(q.rests.map((r) => r.dur), ['w', 'h']);
  assert.equal(q.beats + q.rests.reduce((s, r) => s + r.beats, 0), 7);
  // without an offset the note sounds for one beat
  assert.equal(F.quantize(5000, 750, null).dur, 'q');
  // a long held note (off at 2.2 s) is a half plus rests; a gap under 0.75 beat adds no rest
  const held = F.quantize(4000, 750, 2200);
  assert.equal(held.dur, 'h.');
  assert.deepEqual(held.rests.map((r) => r.beats), [2]);
});

test('the open (newest) note grows from quarter to half to whole while held', () => {
  assert.equal(F.provisional(100, 750).dur, 'q');
  assert.equal(F.provisional(1500, 750).dur, 'h');
  assert.equal(F.provisional(3000, 750).dur, 'w');
  assert.equal(F.provisional(9000, 750).dur, 'w');
  assert.equal(F.provisional(9000, 750, 1500).dur, 'h', 'once the note has ended its length is fixed');
});

test('tempo: 80 bpm until 3 notes, then the median of the last 8 gaps, clamped to 375..1200 ms', () => {
  assert.equal(F.estimateBeatMs([], 'auto'), 750);
  assert.equal(F.estimateBeatMs([0, 700], 'auto'), 750);
  assert.equal(F.estimateBeatMs([0, 700, 1400, 2100], 'auto'), 700);
  assert.equal(F.estimateBeatMs([0, 600, 1300, 1900, 9000], 'auto'), 650);
  assert.equal(F.estimateBeatMs([0, 100, 200, 300], 'auto'), 375);
  assert.equal(F.estimateBeatMs([0, 3000, 6000, 9000], 'auto'), 1200);
  assert.equal(F.estimateBeatMs([0, 700, 1400], 120), 500, 'a fixed tempo wins');
  // only the last 8 gaps count
  const on = [0, 2000, 4000, 6000];
  for (let i = 1; i <= 8; i++) on.push(6000 + i * 600);
  assert.equal(F.estimateBeatMs(on, 'auto'), 600);
});

// ---------- layout ----------
const entry = (key, tOnset, off = null) => {
  const note = N.parseToken(key);
  return { midi: note.midi, tOnset, off, place: { note, heard: note, fold: 0, zone: 'core' } };
};

test('even layout: the newest note is the right-most of N, older notes are pruned', () => {
  assert.deepEqual([F.layoutEven(3, 6).offset, F.layoutEven(6, 6).offset, F.layoutEven(10, 6).offset], [0, 0, 4]);
  const l = F.layoutEven(10, 6);
  assert.equal(l.translate, -4 * 52);
  assert.equal(l.firstDrawn, 2);
  assert.equal(l.xOf(9) + l.translate, 74 + 5 * 52);
  assert.equal(F.layoutEven(20, 6, 3).offset, 0, 'playback scrolls back to the playing note');
});

test('timed layout: advance 36 + 14 per beat, bar lines after each 4 beats, bar-long accidentals', () => {
  const e = [
    entry('F#4', 0), entry('F#4', 750), entry('F4', 1500), entry('G4', 2250), // bar 1: 4 quarters
    entry('F#4', 3000), entry('F#4', 4500), // bar 2: half, then the open note
  ];
  const lay = F.layoutTimed(e, { beatMs: 750, now: 4600 });
  const notes = lay.items.filter((it) => it.kind === 'note');
  assert.deepEqual(notes.map((it) => it.dur), ['q', 'q', 'q', 'q', 'h', 'q']);
  assert.deepEqual(notes.map((it) => it.acc), ['#', null, 'n', null, '#', null]);
  assert.deepEqual(notes.map((it) => it.x), [74, 124, 174, 224, 274, 338]);
  assert.equal(lay.bars.length, 1);
  assert.ok(lay.bars[0] > 224 && lay.bars[0] < 274 - 16, 'bar line between beat 4 and the next bar');
  assert.ok(notes[5].open);
  // a long silence turns into rests
  const r = F.layoutTimed([entry('C4', 0, 700), entry('D4', 5000)], { beatMs: 750, now: 5100 });
  assert.deepEqual(r.items.map((it) => it.kind + ':' + it.dur), ['note:q', 'rest:w', 'rest:h', 'note:q']);
});

// ---------- wording ----------
test('describe: name, position and the interval from the last note', () => {
  const g = N.placeOnStaff(67, { mode: 'heard' });
  const e = N.placeOnStaff(64, { mode: 'heard' });
  const d = F.describe(g, e);
  assert.equal(d.big, 'G');
  assert.ok(d.small.startsWith('G4 · '), d.small);
  assert.ok(d.small.endsWith(' · a skip up from E'), d.small);
  const c = F.describe(N.placeOnStaff(60, { mode: 'heard' }), null);
  assert.ok(c.small.startsWith('C4 · middle C, '), c.small);
  const fs = N.placeOnStaff(66, { mode: 'heard', prefer: 'sharp' });
  assert.equal(F.describe(fs, g).big, 'F♯');
  assert.equal(F.describe(N.placeOnStaff(66, { mode: 'heard', prefer: 'flat' }), g).big, 'G♭');
  assert.ok(F.describe(e, e).small.endsWith('the same note again'));
});

test('describe: folded notes explain the 8va / 8vb badge', () => {
  const c3 = { note: N.spellMidi(60), heard: N.spellMidi(48), fold: -1, zone: 'folded' };
  assert.equal(F.describe(c3, null).small, 'C3 · lower than this staff shows, so it’s drawn an octave up (8vb)');
  const low = { note: N.spellMidi(60), heard: N.spellMidi(36), fold: -2, zone: 'folded' };
  assert.equal(F.describe(low, null).small, 'C2 · lower than this staff shows, so it’s drawn two octaves up (15mb)');
  const d7 = { note: N.spellMidi(86 - 12), heard: N.spellMidi(86), fold: 1, zone: 'folded' };
  assert.equal(F.describe(d7, null).small, 'D6 · higher than this staff shows, so it’s drawn an octave down (8va)');
  assert.deepEqual([1, 2, -1, -2, 0].map(F.badgeFor), ['8va', '15ma', '8vb', '15mb', null]);
});

// ---------- play back ----------
test('play back (even): real gaps clamped to 0.15..2 s, dur = min(gap * 0.92, 1.2), last note 0.8 s', () => {
  const e = [entry('C4', 0), entry('D4', 100), entry('E4', 600), entry('F4', 4600), entry('G4', 5000)];
  const ev = F.playbackEvents(e, { rhythm: 'even' });
  assert.deepEqual(ev.map((x) => x.midi), [60, 62, 64, 65, 67]);
  const at = ev.map((x) => Math.round(x.at * 1000));
  assert.deepEqual(at, [0, 150, 650, 2650, 3050]);
  assert.ok(Math.abs(ev[0].dur - 0.138) < 1e-9);
  assert.equal(ev[3].dur, 0.4 * 0.92);
  assert.equal(ev[2].dur, 1.2);
  assert.equal(ev[4].dur, 0.8);
  // only the last 64 notes play
  const many = [];
  for (let i = 0; i < 80; i++) many.push(entry('C4', i * 500));
  assert.equal(F.playbackEvents(many).length, 64);
});

test('play back (timed): quantized beats at the tempo, rests keep their time', () => {
  const e = [entry('C4', 0, 700), entry('D4', 5000), entry('E4', 5750)];
  const ev = F.playbackEvents(e, { rhythm: 'timed', beatMs: 750, now: 5800 });
  assert.deepEqual(ev.map((x) => +x.at.toFixed(3)), [0, 5.25, 6]);
});

// ---------- "I know that tune!" ----------
test('index: songs only (scales and exercises are left out), intervals folded to -5..+6', () => {
  const idx = F.buildIndex(SONGS);
  assert.ok(!idx.some((s) => s.id === 'scale-up'));
  assert.equal(idx.length, SONGS.length - 1);
  assert.deepEqual(idx.find((s) => s.id === 'ode').iv.slice(0, 6), [0, 1, 2, 0, -2, -1]);
  assert.equal(F.normIv(12), 0);
  assert.equal(F.normIv(-7), 5);
  assert.equal(F.normIv(7), -5);
  assert.equal(F.normIv(6), 6);
  // without `kind` (the v1 library), scales are recognised by id
  assert.ok(!F.buildIndex([{ id: 'scale-down', title: 'x', notes: SONGS[0].notes }]).length);
});

test('Ode to Joy from E: a soft hint at note 5, the announcement at note 7', () => {
  const R = recognizer();
  const ev = pushAll(R, midis('ode').slice(0, 7));
  assert.deepEqual(ev.slice(0, 4), [[], [], [], []]);
  assert.equal(ev[4].length, 1);
  assert.equal(ev[4][0].type, 'hint');
  assert.equal(ev[4][0].text, 'Sounds like Ode to Joy…');
  assert.equal(ev[5][0].type, 'hint');
  const found = ev[6].find((x) => x.type === 'found');
  assert.ok(found, 'announced at note 7');
  assert.equal(found.id, 'ode');
  assert.equal(found.tr, 0);
  assert.equal(found.text, 'You’re playing Ode to Joy!');
  assert.equal(R.following().id, 'ode');
  assert.equal(R.following().pos, 7);
});

test('Ode to Joy transposed to start on G: tr 3 and "(starting on G instead of E)"', () => {
  const R = recognizer();
  const ev = pushAll(R, midis('ode').slice(0, 7).map((m) => m + 3)).flat();
  const found = ev.find((x) => x.type === 'found');
  assert.ok(found);
  assert.equal(found.tr, 3);
  assert.equal(found.text, 'You’re playing Ode to Joy! (starting on G instead of E)');
  // an octave higher is not a transposition
  const R2 = recognizer();
  const f2 = pushAll(R2, midis('ode').slice(0, 7).map((m) => m + 12)).flat().find((x) => x.type === 'found');
  assert.equal(f2.tr, 0);
  assert.equal(f2.text, 'You’re playing Ode to Joy!');
  // octave jumps in the middle still match
  const R3 = recognizer();
  const mixed = midis('ode').slice(0, 7).map((m, i) => (i % 2 ? m + 12 : m));
  assert.ok(pushAll(R3, mixed).flat().some((x) => x.type === 'found' && x.id === 'ode'));
});

test('flats spelling names the transposed start with a flat', () => {
  const R = recognizer({ prefer: 'flat' });
  const found = pushAll(R, midis('ode').slice(0, 7).map((m) => m + 2)).flat().find((x) => x.type === 'found');
  assert.equal(found.text, 'You’re playing Ode to Joy! (starting on G♭ instead of E)');
});

test('Mary’s first 5 notes give a soft match only', () => {
  const R = recognizer();
  const ev = pushAll(R, midis('mary').slice(0, 5)).flat();
  assert.deepEqual(ev.map((x) => x.type), ['hint']);
  assert.equal(ev[0].text, 'Sounds like Mary Had a Little Lamb…');
  assert.equal(R.following(), null);
});

test('the Jingle Bells family counts as one match', () => {
  const R = recognizer();
  const ev = pushAll(R, midis('jingle').slice(0, 8)).flat();
  const found = ev.filter((x) => x.type === 'found');
  assert.equal(found.length, 1);
  assert.equal(found[0].id, 'jingle');
  assert.ok(!ev.some((x) => x.type === 'found' && x.id === 'jingle-chorus'));
});

test('two different tunes with the same opening give no hint until they differ', () => {
  const twin = [
    { id: 'a', kind: 'song', title: 'Tune A', notes: N.parseMelody('C4 D4 E4 F4 G4 A4 G4 C4').notes },
    { id: 'b', kind: 'song', title: 'Tune B', notes: N.parseMelody('C4 D4 E4 F4 G4 E4 C4 C4').notes },
  ];
  const R = F.createRecognizer(F.buildIndex(twin));
  const ev = pushAll(R, [60, 62, 64, 65, 67]);
  assert.deepEqual(ev.flat(), []);
  const next = R.push(69);
  assert.equal(next[0].type, 'hint');
  assert.equal(next[0].id, 'a');
});

test('following: progress text, a wrong note is forgiven, then 2 more wrong notes drop it', () => {
  const R = recognizer();
  const ode = midis('ode');
  pushAll(R, ode.slice(0, 7));
  const p = R.push(ode[7]);
  assert.equal(p[0].type, 'progress');
  assert.equal(p[0].text, 'Ode to Joy · 8 of 30 notes');
  assert.equal(R.push(81)[0].type, 'progress', 'one wrong note: still following');
  assert.equal(R.following().misses, 1);
  assert.equal(R.push(ode[8])[0].pos, 9, 'the right note carries on');
  assert.equal(R.following().misses, 0);
  R.push(81);
  R.push(81);
  assert.ok(R.following(), 'two wrong notes: still following');
  const lost = R.push(81);
  assert.equal(lost[0].type, 'lost');
  assert.equal(R.following(), null);
});

test('following: one skipped note is forgiven', () => {
  const R = recognizer();
  const ode = midis('ode');
  pushAll(R, ode.slice(0, 7));
  const ev = R.push(ode[8]); // note 8 skipped
  assert.equal(ev[0].pos, 9);
});

test('following to the end: "You played all of Ode to Joy!" and each tune is announced once per Clear', () => {
  const R = recognizer();
  const ode = midis('ode');
  const ev = pushAll(R, ode).flat();
  const done = ev.find((x) => x.type === 'complete');
  assert.ok(done);
  assert.equal(done.text, 'You played all of Ode to Joy!');
  assert.equal(done.small, 'From memory, too.');
  assert.equal(R.following(), null);
  // playing it again doesn't announce it again
  assert.ok(!pushAll(R, ode.slice(0, 10)).flat().some((x) => x.type === 'found' || x.type === 'hint'));
  // after Clear it does
  R.clear();
  assert.ok(pushAll(R, ode.slice(0, 7)).flat().some((x) => x.type === 'found'));
});

test('a tune is found after some other notes first', () => {
  const R = recognizer();
  const ev = pushAll(R, [72, 59, 70, ...midis('ode').slice(0, 7)]).flat();
  assert.ok(ev.some((x) => x.type === 'found' && x.id === 'ode'));
});

test('Clear + Undo: the recognizer state can be restored', () => {
  const R = recognizer();
  pushAll(R, midis('ode').slice(0, 7));
  const snap = R.state();
  R.clear();
  assert.equal(R.following(), null);
  R.setState(snap);
  assert.equal(R.following().pos, 7);
  assert.equal(R.push(midis('ode')[7])[0].pos, 8);
});

// ---------- scales ----------
test('scale bonus: a whole scale up, and going down', () => {
  const up = [60, 62, 64, 65, 67, 69, 71, 72];
  assert.deepEqual(F.detectScale(up), { dir: 'up', from: 'C', text: 'That’s a whole scale, C to C!' });
  const down = up.slice().reverse();
  assert.equal(F.detectScale(down).text, 'That’s a whole scale going down, C to C!');
  assert.equal(F.detectScale([67, 69, 71, 72, 74, 76, 78, 79]).text, 'That’s a whole scale, G to G!');
  assert.equal(F.detectScale([57, 59, 60, 62, 64, 65, 67, 69]).dir, 'up', 'A minor works too');
  assert.equal(F.detectScale(up.slice(0, 7)), null, 'needs 8 notes');
  assert.equal(F.detectScale([60, 61, 62, 63, 64, 65, 66, 67]), null, 'chromatic is not a scale');
  assert.equal(F.detectScale([60, 62, 64, 66, 68, 70, 72, 74]), null, 'whole tones are not');
  assert.equal(F.detectScale([60, 62, 64, 65, 64, 65, 67, 72]), null, 'one direction only');
  assert.equal(F.detectScale([60, 61, 63, 65, 67, 69, 71, 72]), null, 'two half steps side by side are not diatonic');
});

test('the recognizer reports a scale once, then again after 7 more notes', () => {
  const R = recognizer();
  const up = [60, 62, 64, 65, 67, 69, 71, 72];
  const ev = pushAll(R, up).flat();
  assert.equal(ev.filter((x) => x.type === 'scale').length, 1);
  const more = pushAll(R, [74, 76, 77, 79, 81, 83, 84]).flat();
  assert.equal(more.filter((x) => x.type === 'scale').length, 1, 'the next octave counts once');
  const down = pushAll(R, [83, 81, 79, 77, 76, 74, 72]).flat();
  const sc = down.filter((x) => x.type === 'scale');
  assert.equal(sc.length, 1);
  assert.equal(sc[0].dir, 'down');
});

test('no lyrics or long strings in the matcher output', () => {
  const R = recognizer();
  const ev = pushAll(R, midis('ode')).flat();
  ev.forEach((x) => ['text', 'small'].forEach((k) => { if (x[k]) assert.ok(x[k].length < 80, x[k]); }));
});
