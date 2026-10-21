// Play by Ear core (§7.2): alignment, chord stripping, folding and the summary text.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../modes/byear-core.js');

// Mary Had a Little Lamb as midi (26 notes), the same tune as songs.js 'mary'.
const E = 64, D = 62, C = 60, G = 67, F = 65, A = 69;
const MARY = [E, D, C, D, E, E, E, D, D, D, E, G, G, E, D, C, D, E, E, E, E, D, D, E, D, C];

const kinds = (r) => r.columns.map((c) => c.kind);

test('identical take: 100% and every column is a match', () => {
  const r = B.align(MARY, MARY.slice());
  assert.equal(r.total, 26);
  assert.equal(r.matched, 26);
  assert.equal(r.pct, 100);
  assert.equal(r.columns.length, 26);
  assert.ok(r.columns.every((c, i) => c.kind === 'match' && c.songIndex === i && c.takeIndex === i));
  assert.equal(B.summaryText(r), '26 of 26 notes matched (100%)');
});

test('one wrong note gives one sub at that column', () => {
  const take = MARY.slice();
  take[8] = F; // the song has D
  const r = B.align(MARY, take);
  assert.deepEqual(B.counts(r), { match: 25, sub: 1, missed: 0, extra: 0 });
  const sub = r.columns.find((c) => c.kind === 'sub');
  assert.equal(sub.songIndex, 8);
  assert.equal(sub.song, D);
  assert.equal(sub.take, F);
  assert.equal(r.pct, 96);
});

test('a far wrong note is still a substitution, not a gap pair', () => {
  const take = MARY.slice();
  take[11] = 71; // B4 for G4: 4 semitones away, cost 1 < missed + extra (2)
  assert.deepEqual(B.counts(B.align(MARY, take)), { match: 25, sub: 1, missed: 0, extra: 0 });
});

test('one missing note gives missed', () => {
  const take = MARY.slice();
  take.splice(11, 1); // drop the first G
  const r = B.align(MARY, take);
  assert.deepEqual(B.counts(r), { match: 25, sub: 0, missed: 1, extra: 0 });
  const miss = r.columns.find((c) => c.kind === 'missed');
  assert.equal(miss.song, G);
  assert.equal(miss.take, undefined);
  assert.equal(r.columns.length, 26);
});

test('one extra note gives extra in its own column', () => {
  const take = MARY.slice();
  take.splice(5, 0, A);
  const r = B.align(MARY, take);
  assert.deepEqual(B.counts(r), { match: 26, sub: 0, missed: 0, extra: 1 });
  assert.equal(r.columns.length, 27);
  const ex = r.columns.find((c) => c.kind === 'extra');
  assert.equal(ex.take, A);
  assert.equal(ex.song, undefined);
  assert.equal(ex.takeIndex, 5);
  assert.equal(r.pct, 100);
});

test('a take an octave higher (or mixed octaves) still matches', () => {
  const up = MARY.map((m) => m + 12);
  assert.equal(B.align(MARY, up).pct, 100);
  const mixed = MARY.map((m, i) => m + (i % 3 === 0 ? -12 : i % 3 === 1 ? 12 : 0));
  const r = B.align(MARY, mixed);
  assert.equal(r.matched, 26);
  assert.ok(kinds(r).every((k) => k === 'match'));
});

test('the e2e take: 2 wrong, 1 missing, 1 extra -> 23 / 2 / 1 / 1', () => {
  const take = MARY.slice();
  take[3] = F;            // sub (song D)
  take[21] = 71;          // sub (song D, played B)
  take.splice(17, 0, A);  // extra A after note 17
  take.splice(12, 1);     // missed: the second G
  const r = B.align(MARY, take);
  assert.deepEqual(B.counts(r), { match: 23, sub: 2, missed: 1, extra: 1 });
  assert.equal(B.summaryText(r), '23 of 26 notes matched (88%)');
});

test('near misses (within 2 semitones) align as substitutions', () => {
  // song C D E, take C D♯ E: a near-miss sub, not missed + extra
  const r = B.align([60, 62, 64], [60, 63, 64]);
  assert.deepEqual(kinds(r), ['match', 'sub', 'match']);
  assert.equal(B.COST.near < B.COST.sub, true);
});

test('ties prefer substitution, then deletion', () => {
  // song [C, D], take [E]: sub+missed or missed+sub cost the same; the traceback starts from the end,
  // so the last song note takes the substitution and the first is missed.
  const r = B.align([60, 62], [64]);
  assert.deepEqual(kinds(r), ['missed', 'sub']);
  // song [C], take [D, E]: sub + extra; never missed + 2 extras.
  assert.deepEqual(B.counts(B.align([60], [62, 64])), { match: 0, sub: 1, missed: 0, extra: 1 });
});

test('empty inputs', () => {
  assert.deepEqual(B.align([], []), { columns: [], matched: 0, total: 0, pct: 0 });
  const r = B.align([60, 62], []);
  assert.deepEqual(kinds(r), ['missed', 'missed']);
  assert.equal(r.pct, 0);
  assert.deepEqual(kinds(B.align([], [60])), ['extra']);
});

test('chord stripping removes chord notes inside the window only', () => {
  const at = 10; // C chord recognised at t = 10 s
  const take = [
    { midi: 60, at: 9.8 },   // C, inside (-0.2): stripped
    { midi: 64, at: 9.9 },   // E, inside: stripped
    { midi: 67, at: 10.25 }, // G, inside (+0.25): stripped
    { midi: 62, at: 10.1 },  // D inside the window but not in the chord: kept
    { midi: 60, at: 10.6 },  // melody C 600 ms later: kept
    { midi: 55, at: 9.7 },   // G3 at -0.3, outside the window: kept
    { midi: 72, at: 10.3 },  // C5 at exactly +0.3: stripped (edge counts)
  ];
  const out = B.stripChordNotes(take, [{ chord: 'C', at }]);
  assert.deepEqual(out.map((n) => [n.midi, n.at]), [[62, 10.1], [60, 10.6], [55, 9.7]]);
});

test('chord stripping handles the end G chord and C minor', () => {
  const take = [
    { midi: 64, at: 1.0 }, { midi: 62, at: 1.5 },
    { midi: 67, at: 19.9 }, { midi: 71, at: 20.0 }, { midi: 74, at: 20.05 }, // G B D around the G at 20
    { midi: 64, at: 20.1 }, // E is not in G major: kept
  ];
  const out = B.stripChordNotes(take, [{ chord: 'C', at: 0.5 }, { chord: 'G', at: 20 }]);
  assert.deepEqual(out.map((n) => n.midi), [64, 62, 64]);
  const cm = B.stripChordNotes([{ midi: 63, at: 5 }, { midi: 64, at: 5 }], [{ chord: 'Cm', at: 5 }]);
  assert.deepEqual(cm.map((n) => n.midi), [64]);
  // no gestures: nothing removed, and the input is not mutated
  assert.equal(B.stripChordNotes(take, []).length, take.length);
  assert.equal(take.length, 6);
});

test('chord stripping reaches back to the chord attack when the gesture has one', () => {
  // The detector recognises a chord about 0.4 s after its attack: the attack's notes still go.
  const take = [{ midi: 62, at: 4.0 }, { midi: 67, at: 9.6 }, { midi: 74, at: 9.62 }, { midi: 64, at: 9.61 }];
  const g = { chord: 'G', at: 10, from: 9.6 };
  assert.deepEqual(B.stripChordNotes(take, [g]).map((n) => n.midi), [62, 64]);
  // without `from`, the 250 ms window alone keeps them (spec default)
  assert.deepEqual(B.stripChordNotes(take, [{ chord: 'G', at: 10 }]).map((n) => n.midi), [62, 67, 74, 64]);
  // a `from` after `at` never narrows the window
  assert.equal(B.stripChordNotes([{ midi: 67, at: 9.8 }], [{ chord: 'G', at: 10, from: 10.2 }]).length, 0);
});

test('layout folds your notes to the octave nearest the song note, inside C4..G5', () => {
  const r = B.align([64, 67, 72], [64 - 24, 67 + 12, 74 - 12]);
  const cols = B.layout(r);
  assert.deepEqual(cols.map((c) => c.draw), [64, 67, 74]);
  // extra uses the previous drawn note
  const r2 = B.align([60, 62], [60, 86, 62]); // 86 = D6, an extra after C4
  const c2 = B.layout(r2);
  const ex = c2.find((c) => c.kind === 'extra');
  assert.equal(ex.draw, 62); // D nearest C4 is D4
  // folding keeps everything in 60..79
  const r3 = B.layout(B.align([79], [81 + 12]));
  assert.ok(r3[0].draw >= 60 && r3[0].draw <= 79);
  assert.equal(B.nearestOctave(71, 60), 59);
  assert.equal(B.nearestOctave(66, 60), 66);
});

test('spellNear keeps the song letter for half-step misses', () => {
  assert.deepEqual(B.spellNear(63, 64), { letter: 'E', acc: 'b', name: 'E♭' });
  assert.deepEqual(B.spellNear(61, 60), { letter: 'C', acc: '#', name: 'C♯' });
  assert.deepEqual(B.spellNear(65, 60), { letter: 'F', acc: '', name: 'F' });
  assert.equal(B.spellNear(66, 69, 'flat').name, 'G♭');
  assert.equal(B.spellNear(65, 64).name, 'F');   // never E♯
  assert.equal(B.spellNear(59, 60).name, 'B');   // never C♭
  assert.equal(B.noteName(70), 'A♯');
  assert.equal(B.noteName(70, 'flat'), 'B♭');
});

test('differences: plain language, song order, at most 5', () => {
  const take = MARY.slice();
  take[8] = F;
  take.splice(14, 0, D); // extra D after note 14
  const r = B.align(MARY, take);
  const d = B.differences(r);
  assert.deepEqual(d, ['Note 9: the song has D, you played F.', 'After note 14 you added an extra D.']);
  const miss = B.differences(B.align([60, 62, 64], [60, 64]));
  assert.deepEqual(miss, ['Note 2: you missed the D.']);
  assert.deepEqual(B.differences(B.align([60], [67, 60])), ['Before note 1 you added an extra G.']);
  const many = B.differences(B.align(MARY, MARY.map((m) => m + 5)));
  assert.equal(many.length, 5);
  assert.deepEqual(B.differences(B.align([64], [63]), { songNames: ['E'] }), ['Note 1: the song has E, you played E♭.']);
});

test('takeEvents keeps real gaps, clamped, for playback', () => {
  const ev = B.takeEvents([{ midi: 60, at: 1 }, { midi: 62, at: 1.05 }, { midi: 64, at: 1.55 }, { midi: 65, at: 9 }]);
  assert.deepEqual(ev.map((e) => e.midi), [60, 62, 64, 65]);
  assert.equal(ev[0].at, 0);
  assert.ok(Math.abs(ev[1].at - 0.15) < 1e-9);          // 50 ms gap clamped up to 0.15
  assert.ok(Math.abs(ev[2].at - 0.65) < 1e-9);          // 0.5 s gap
  assert.ok(Math.abs(ev[3].at - 2.65) < 1e-9);          // 7.45 s gap clamped down to 2.0
  assert.ok(Math.abs(ev[1].dur - 0.46) < 1e-9);          // 0.5 s gap * 0.92
  assert.equal(ev[2].dur, 1.2);                          // capped
  assert.equal(ev[3].dur, 0.8);
  assert.deepEqual(B.takeEvents([]), []);
});

test('isNewBest', () => {
  assert.equal(B.isNewBest(null, 50), true);
  assert.equal(B.isNewBest(null, 0), false);
  assert.equal(B.isNewBest({ pct: 80, at: 1 }, 80), false);
  assert.equal(B.isNewBest({ pct: 80, at: 1 }, 81), true);
});

test('no lyrics or song text in the core', () => {
  const src = require('node:fs').readFileSync(require.resolve('../modes/byear-core.js'), 'utf8');
  assert.ok(!/little lamb|fleece|twinkle little/i.test(src));
});
