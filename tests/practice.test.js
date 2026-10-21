// WP6: the pure rules behind Practice and Hear It First (modes/practice.js, PracticeCore).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../modes/practice.js');
const Notation = require('../core/notation.js');
const Util = require('../core/util.js');

const note = (tok) => Notation.parseToken(tok);
const ev = (o) => Object.assign({ midi: 64, tOnset: 0, confident: true, source: 'mic' }, o);

test('practice.js loads in Node and exposes the core (no DOM needed)', () => {
  for (const fn of ['newAttempt', 'outcomeFor', 'countsAsWrong', 'listenRange', 'itemsInRange', 'sourceFor', 'createGuard', 'updateSongRecord']) {
    assert.equal(typeof P[fn], 'function', fn);
  }
});

test('attempt start waits for the mic to come back after our own playback', () => {
  assert.equal(P.newAttempt({ now: 1000 }).start, 1000);
  assert.equal(P.newAttempt({ now: 1000, mutedUntil: 1800 }).start, 1800);
  const a = P.newAttempt({ now: 1000, mutedUntil: 200, lastCorrectAt: 900 });
  assert.equal(a.start, 1000);
  assert.equal(a.lastCorrectAt, 900);
  assert.deepEqual([a.labelAt, a.wrong, a.hinted, a.heardNote, a.playedKey], [null, 0, false, false, null]);
});

test('outcome: read before the label shows, assisted after it, miss after a counted wrong note', () => {
  const att = P.newAttempt({ now: 0 });
  assert.equal(P.outcomeFor(att, ev({ tOnset: 1000 }), 'auto'), 'read');
  att.labelAt = 5000; // label faded in at 5 s
  assert.equal(P.outcomeFor(att, ev({ tOnset: 4999 }), 'auto'), 'read', 'onset before the label: read');
  assert.equal(P.outcomeFor(att, ev({ tOnset: 6000 }), 'auto'), 'assisted');
  const heard = Object.assign(P.newAttempt({ now: 0 }), { heardNote: true });
  assert.equal(P.outcomeFor(heard, ev({ tOnset: 10 }), 'auto'), 'assisted', 'Hear the note makes it assisted');
  assert.equal(P.outcomeFor(P.newAttempt({ now: 0 }), ev({}), 'always'), 'assisted', 'names always on');
  const hinted = Object.assign(P.newAttempt({ now: 0 }), { hinted: true });
  assert.equal(P.outcomeFor(hinted, ev({}), 'auto'), 'miss', 'Show me the key is a miss');
  const wrong = Object.assign(P.newAttempt({ now: 0 }), { wrong: 1, labelAt: 0 });
  assert.equal(P.outcomeFor(wrong, ev({ tOnset: 10 }), 'auto'), 'miss');
});

test('a wrong note counts only when confident and not sustain bleed from the last correct note', () => {
  const att = P.newAttempt({ now: 1000, lastCorrectAt: 1000 });
  assert.equal(P.countsAsWrong(att, ev({ tOnset: 1200, confident: true })), false, 'within 300 ms: bleed');
  assert.equal(P.countsAsWrong(att, ev({ tOnset: 1301, confident: true })), true);
  assert.equal(P.countsAsWrong(att, ev({ tOnset: 5000, confident: false })), false, 'flush / timeout notes give feedback only');
  assert.equal(P.countsAsWrong(P.newAttempt({ now: 0 }), ev({ tOnset: 5, confident: true })), true, 'first note has no bleed window');
});

test('played key is spelled at the octave nearest the target', () => {
  assert.equal(P.playedKeyFor(77, 64), 'F4'); // F5 played for E4
  assert.equal(P.playedKeyFor(65, 64), 'F4');
  assert.equal(P.playedKeyFor(53, 64), 'F4'); // F3
  assert.equal(P.playedKeyFor(59, 60), 'B3');
  assert.equal(P.playedKeyFor(66, 64), 'F#4');
  assert.equal(P.directionText(64, 77), 'It’s further to the left.');
  assert.equal(P.directionText(67, 65), 'It’s further to the right.');
});

test('the prompt never names a note whose label is hidden', () => {
  assert.equal(P.promptText(note('E4'), false), 'Play the blue note');
  assert.equal(P.promptText(note('E4'), true), 'Play E');
  assert.equal(P.promptText(note('F#4'), true), 'Play F♯');
  assert.doesNotMatch(P.promptText(note('G4'), false), /G/);
});

test('octave tolerance: same pitch class matches across octaves', () => {
  assert.ok(P.samePc(76, 64)); // E5 for E4
  assert.ok(P.samePc(48, 60)); // C3 for C4
  assert.ok(!P.samePc(65, 64));
});

test('Hear It First ranges: whole tune and the phrase holding the current note', () => {
  const ctx = { phrases: [[0, 7], [7, 10], [10, 13], [13, 26]], n: 26 };
  assert.deepEqual(P.listenRange(ctx, 'whole', 8), { from: 0, to: 26 });
  assert.deepEqual(P.listenRange(ctx, 'part', 8), { from: 7, to: 10 });
  assert.deepEqual(P.listenRange(ctx, 'part', 0), { from: 0, to: 7 });
  assert.deepEqual(P.listenRange(ctx, 'part', 25), { from: 13, to: 26 });
  assert.deepEqual(P.listenRange({ phrases: [], n: 5 }, 'part', 2), { from: 0, to: 5 }, 'no phrases: whole');
});

test('items in range keep the rests inside the range only', () => {
  const m = Notation.parseMelody('C4 D4 R:q E4 F4 R:h G4');
  const it = P.itemsInRange(m.items, 1, 4); // D4 .. F4
  assert.deepEqual(it.map((x) => (x.kind === 'rest' ? 'R' : x.key)), ['D4', 'R', 'E4', 'F4']);
  const all = P.itemsInRange(m.items, 0, 5);
  assert.equal(all.length, 7);
  // Legacy songs: items are plain notes without `kind`.
  const legacy = [{ midi: 60 }, { midi: 62 }, { midi: 64 }];
  assert.deepEqual(P.itemsInRange(legacy, 1, 3).map((x) => x.midi), [62, 64]);
});

test('speed cycles 100 -> 75 -> 50 -> 100', () => {
  assert.equal(P.nextSpeed(1), 0.75);
  assert.equal(P.nextSpeed(0.75), 0.5);
  assert.equal(P.nextSpeed(0.5), 1);
  assert.equal(P.nextSpeed(undefined), 1);
  assert.equal(P.speedLabel(0.75), 'Speed 75%');
});

test('evidence source: listened notes and ?from=ear count as hear', () => {
  const heard = new Set([0, 1, 2]);
  assert.equal(P.sourceFor(1, heard, false), 'hear');
  assert.equal(P.sourceFor(5, heard, false), 'song');
  assert.equal(P.sourceFor(5, heard, true), 'hear');
  assert.equal(P.sourceFor(0, new Set(), false), 'song');
});

test('session guard turns on when the first-try rate drops below 0.7, and stays on', () => {
  const g = P.createGuard();
  const seq = [1, 1, 1, 1, 1, 1, 1, 1];
  seq.forEach((x) => assert.equal(g.push(x), false));
  assert.equal(g.active, false);
  assert.equal(g.push(0), false); // 8/9
  assert.equal(g.push(0), false); // 8/10
  assert.equal(g.push(0), false); // 7/10
  assert.equal(g.push(0), true, 'turns on at 6/10'); // 6/10 = 0.6
  assert.equal(g.active, true);
  for (let i = 0; i < 10; i++) assert.equal(g.push(1), false);
  assert.equal(g.active, true, 'for the rest of the run');
  const early = P.createGuard();
  assert.equal(early.push(0), false, 'one miss is not enough to judge');
});

test('finish record: plays, last, best (fewer mistakes wins), stars, ftp', () => {
  let r = P.updateSongRecord(undefined, { mistakes: 2, ftp: 0.9, now: 10 });
  assert.deepEqual(r, { plays: 1, last: 10, best: { mistakes: 2, at: 10 }, stars: 2, ftp: 0.9 });
  r = P.updateSongRecord(r, { mistakes: 5, ftp: 0.7, now: 20 });
  assert.deepEqual(r.best, { mistakes: 2, at: 10 });
  assert.equal(r.plays, 2);
  assert.equal(r.stars, 2);
  r = P.updateSongRecord(r, { mistakes: 0, ftp: 1, now: 30 });
  assert.deepEqual(r.best, { mistakes: 0, at: 30 });
  assert.equal(r.stars, 3);
  // Migrated v1 record (plays 1, best from v1, ftp null) carries its stars.
  const v1 = { plays: 1, last: 1, best: { mistakes: 1, at: 1 }, stars: 2, ftp: null };
  const after = P.updateSongRecord(v1, { mistakes: 6, ftp: 0.5, now: 40 });
  assert.equal(after.stars, 2);
  assert.deepEqual(after.best, { mistakes: 1, at: 1 });
  assert.deepEqual([P.starsFor(0), P.starsFor(3), P.starsFor(4)], [3, 2, 1]);
});

test('log adds up per day and prunes after 90 days', () => {
  const log = { '2026-01-01': { r: 1, m: 0, ms: 5 } };
  P.addLog(log, '2026-10-21', { r: 10, m: 2, ms: 6000 }, { addDays: Util.addDays });
  P.addLog(log, '2026-10-21', { r: 5, m: 1, ms: 1000.4 }, { addDays: Util.addDays });
  assert.deepEqual(log, { '2026-10-21': { r: 15, m: 3, ms: 7000 } });
});

test('finish summary lines', () => {
  const lines = P.summaryLines({
    accBefore: { E4: 0.6, F4: 0.7, G4: 0.5, C4: 0.9 },
    accAfter: { E4: 0.7, F4: 0.72, G4: 0.6, C4: 0.95 },
    promoted: ['C4'],
    missedKeys: ['F4', 'A4'],
  });
  assert.deepEqual(lines.map((l) => l.text), [
    'Getting stronger: E, G',
    'New: you know C now',
    'Try a quick drill on F and A',
  ]);
  assert.deepEqual(P.summaryLines({}), []);
  assert.equal(P.finishText({ title: 'Mary', notes: 26, mistakes: 0 }), 'You played all 26 notes of Mary without a single mistake.');
  assert.equal(P.finishText({ title: 'Mary', notes: 26, mistakes: 1 }), 'You played all 26 notes of Mary with 1 wrong note along the way.');
});

test('Hear it first is the primary button for a song never played or listened to', () => {
  assert.equal(P.hearFirstPrimary('ask', null, 0), true);
  assert.equal(P.hearFirstPrimary('ask', null, 2), false);
  assert.equal(P.hearFirstPrimary('ask', { plays: 1, best: { mistakes: 0 } }, 0), false);
  assert.equal(P.hearFirstPrimary('always', { plays: 9 }, 9), true);
});

test('shape level-up toast copy', () => {
  assert.equal(P.shapeToastText('step', 2, 1), 'Steps are getting easy, so their labels are hiding now.');
  assert.equal(P.shapeToastText('step', 1, 0), 'You read steps at a glance now, so their arrows are gone.');
  assert.equal(P.shapeToastText('skip', 2, 1), 'Skips are getting easy, so their labels are hiding now.');
  assert.equal(P.shapeToastText('leap', 1, 0), 'You read leaps at a glance now, so their arrows are gone.');
  assert.equal(P.shapeToastText('step', 1, 2), null);
});

test('next song: first recommendation other than this one, else the next in order', () => {
  const songs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(P.pickNextSong({ kind: 'song', song: songs[0], alts: [songs[2]] }, 'a', songs, 0).id, 'c');
  assert.equal(P.pickNextSong({ kind: 'song', song: songs[1], alts: [] }, 'a', songs, 0).id, 'b');
  assert.equal(P.pickNextSong({ kind: 'run' }, 'a', songs, 0).id, 'b');
  assert.equal(P.pickNextSong({ kind: 'meet', unit: 3 }, 'c', songs, 2), null);
});

test('cold read target: unread library tune with known/ear notes, right or easy', () => {
  const mk = (id, keys, comfort) => ({ id, keys, comfort });
  const songs = [
    mk('hcb', ['C4', 'D4', 'E4'], 'easy'), // the ear tune itself
    mk('practised', ['C4', 'D4', 'E4'], 'easy'),
    mk('new-note', ['C4', 'D4', 'E4', 'G4'], 'right'), // G4 not introduced
    mk('tough', ['C4', 'D4'], 'tough'),
    mk('in-ear', ['C4', 'D4'], 'easy'),
    mk('ok', ['D4', 'E4', 'C4'], 'right'),
  ];
  const base = {
    songId: 'hcb', songs, earTunes: { 'in-ear': {} }, practiced: { practised: { plays: 2 } },
    introduced: new Set(['C4', 'D4', 'E4', 'F4']), known: new Set(), comfortOf: (s) => s.comfort,
    earKeys: new Set(['C4', 'D4', 'E4']),
  };
  assert.equal(P.coldReadTarget(base).id, 'ok');
  assert.equal(P.coldReadTarget(Object.assign({}, base, { earKeys: new Set(['C4']) })), null, 'keys must be heard or known');
});

test('letters for keys and notes', () => {
  assert.equal(P.letterOfKey('E4'), 'E');
  assert.equal(P.letterOfKey('F#4'), 'F♯');
  assert.equal(P.letterOfKey('Bb4'), 'B♭');
  assert.equal(P.noteKeyOf({ letter: 'E', midi: 64, staffPos: 0, dur: 'q' }), 'E4');
  assert.equal(P.joinAnd(['E']), 'E');
  assert.equal(P.joinAnd(['E', 'F', 'G']), 'E, F and G');
});

test('no lyrics in practice.js copy (no long quoted strings beyond UI copy)', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../modes/practice.js'), 'utf8');
  assert.doesNotMatch(src, /lyrics|\bwords:/i);
});
