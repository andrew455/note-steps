// WP3: the course (spec §3.2.1, §3.2.6, §3.2.7, §3.3.1, §3.3.4, §3.8.2; test plan §5.1).
// Songs are built here from note strings with the frozen pitch.js, so these tests don't depend on
// songs.js; one block at the end also checks the real library when it loads.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core/curriculum.js');
const M = require('../core/mastery.js');
const Util = require('../core/util.js');
const Pitch = require('../pitch.js');

const NOW = Date.UTC(2026, 9, 21, 12);
const TODAY = Util.dayKey(NOW);

function song(id, str, title = id) {
  const notes = str.split(/\s+/).filter((t) => t && t !== '/' && t !== '|').map((t) => {
    const n = Pitch.parseNote(t);
    return Object.assign(n, { key: n.letter + (Math.floor(n.midi / 12) - 1) });
  });
  return { id, title, notes, keys: [...new Set(notes.map((n) => n.key))] };
}
const LIB = [
  song('au-clair-de-la-lune', 'C4 C4 C4 D4 E4:h D4:h C4 E4 D4 D4 C4:w C4 C4 C4 D4 E4:h D4:h C4 E4 D4 D4 C4:w'),
  song('hot-cross-buns', 'E4 D4 C4:h E4 D4 C4:h C4:e C4:e C4:e C4:e D4:e D4:e D4:e D4:e E4 D4 C4:h'),
  song('mary', 'E4 D4 C4 D4 E4 E4 E4:h D4 D4 D4:h E4 G4 G4:h E4 D4 C4 D4 E4 E4 E4 E4 D4 D4 E4 D4 C4:w'),
  song('ode', 'E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4:q. D4:e D4:h E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4:q. C4:e C4:h'),
  song('twinkle', 'C4 C4 G4 G4 A4 A4 G4:h F4 F4 E4 E4 D4 D4 C4:h G4 G4 F4 F4 E4 E4 D4:h G4 G4 F4 F4 E4 E4 D4:h C4 C4 G4 G4 A4 A4 G4:h F4 F4 E4 E4 D4 D4 C4:h'),
  song('frere', 'C4 D4 E4 C4 C4 D4 E4 C4 E4 F4 G4:h E4 F4 G4:h G4:e A4:e G4:e F4:e E4 C4 G4:e A4:e G4:e F4:e E4 C4 C4 G3 C4:h C4 G3 C4:h'),
  song('scale-up', 'C4 D4 E4 F4 G4 A4 B4 C5:h'),
];
const byId = (id) => LIB.find((s) => s.id === id);

function state(unit = 0) {
  return { v: 2, migratedFrom: null, course: { unit, checkDone: true, placementAt: null, checkSnoozeUntil: null }, notes: {}, slices: { practice: { songs: {} } } };
}
function withNotes(spec, unit) {
  // spec: {C4:{...fields}} -> records on top of newRecord
  const S = state(unit);
  for (const k in spec) S.notes[k] = Object.assign(M.newRecord(TODAY), spec[k]);
  return S;
}
const LEARN = (acc, n = 8) => ({ seen: 10, acc, n });
const KNOWN = (o = {}) => Object.assign({ seen: 20, acc: 0.95, n: 20, k: 1, box: 2, due: Util.addDays(TODAY, 2), rt: 1200, streak: 6, reads: 14 }, o);

// ---------- tables ----------
test('units: 11 of them, each with at most 2 notes, UNIT_OF covering C4..G5', () => {
  assert.equal(C.UNITS.length, 11);
  assert.ok(C.UNITS.every((u) => u.notes.length >= 1 && u.notes.length <= 2));
  assert.deepEqual(Object.keys(C.UNIT_OF), ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G5']);
  C.UNITS.forEach((u, i) => u.notes.forEach((k) => assert.equal(C.UNIT_OF[k], i)));
  assert.deepEqual(C.UNITS.map((u) => u.stage), [1, 1, 2, 2, 3, 3, 3, 4, 4, 4, 4]);
  assert.equal(C.STAGES.length, 4);
});

test('NOTE_INFO: every course note, anchors point at earlier notes, no mnemonics', () => {
  for (const k of Object.keys(C.UNIT_OF)) {
    const info = C.NOTE_INFO[k];
    assert.ok(info && info.text, k);
    assert.doesNotMatch(info.text, /every|good|boy|face|cow|fine/i);
    if (k === 'C4') assert.equal(info.anchor, null);
    else assert.ok(C.UNIT_OF[info.anchor.from] <= C.UNIT_OF[k] && info.anchor.from !== k, `${k} anchor`);
  }
  assert.equal(C.anchorText('A4'), 'One step up from G');
  assert.equal(C.anchorText('C5'), 'An octave up from middle C');
  assert.equal(C.anchorText('G4'), 'One skip up from E');
});

// ---------- songs ----------
test('songLevel', () => {
  assert.equal(C.songLevel(byId('mary')), 3);
  assert.equal(C.songLevel(byId('hot-cross-buns')), 1);
  assert.equal(C.songLevel(byId('frere')), Infinity);
  assert.equal(C.songLevel(byId('scale-up')), 6);
  assert.equal(C.songLevel({ notes: [{ letter: 'C', midi: 60 }, { letter: 'E', midi: 64 }] }), 1, 'keys derived from notes');
});

test('songDiff grows with leaps, skips, length and rhythm types', () => {
  const flat = song('a', 'C4 D4 E4 D4 C4');
  const jumpy = song('b', 'C4 G4 C4 G4 C4');
  const rhythm = song('c', 'C4 D4:q. E4:e D4 C4');
  assert.ok(C.songDiff(jumpy) > C.songDiff(flat));
  assert.ok(Math.abs(C.songDiff(rhythm) - C.songDiff(flat) - 1) < 1e-9, 'two dotted/eighth types add 0.5 each');
  assert.ok(C.songDiff(byId('twinkle')) > C.songDiff(byId('mary')));
});

test('comfort labels on fixture states', () => {
  const hcb = byId('hot-cross-buns');
  assert.equal(C.comfort(hcb, state(0), NOW).label, 'locked');
  assert.deepEqual(C.comfort(hcb, withNotes({ C4: KNOWN(), D4: KNOWN() }, 1), NOW).lockedKeys, ['E4']);
  const allKnown = withNotes({ C4: KNOWN(), D4: KNOWN(), E4: KNOWN() }, 2);
  let c = C.comfort(hcb, allKnown, NOW);
  assert.equal(c.label, 'easy');
  assert.equal(c.C, 1);
  assert.equal(c.knownShare, 1);
  // E learning at acc 0.75 -> fam 0.8; 3 of 17 tokens: C = (14 + 3*0.8)/17 = 0.965 -> right
  c = C.comfort(hcb, withNotes({ C4: KNOWN(), D4: KNOWN(), E4: LEARN(0.75) }, 2), NOW);
  assert.equal(c.label, 'right');
  assert.ok(Math.abs(c.C - (14 + 3 * 0.8) / 17) < 1e-9);
  // E new (0.4): C = (14 + 1.2)/17 = 0.894 -> right; D new too: (7 + 10*0.4)/17 = 0.647 -> tough
  assert.equal(C.comfort(hcb, withNotes({ C4: KNOWN(), D4: KNOWN(), E4: {} }, 2), NOW).label, 'right');
  c = C.comfort(hcb, withNotes({ C4: KNOWN(), D4: {}, E4: {} }, 2), NOW);
  assert.equal(c.label, 'tough');
  assert.deepEqual(c.newKeys.sort(), ['D4', 'E4']);
  // stretch: C learning at 0.5 (0.7), D and E known -> (7*0.7 + 10)/17 = 0.876 right; all learning 0.5 -> 0.7 stretch
  assert.equal(C.comfort(hcb, withNotes({ C4: LEARN(0.5), D4: LEARN(0.5), E4: LEARN(0.5) }, 2), NOW).label, 'stretch');
  // rusty known counts 0.9
  const rusty = withNotes({ C4: KNOWN({ due: Util.addDays(TODAY, -3) }), D4: KNOWN(), E4: KNOWN() }, 2);
  assert.ok(C.comfort(hcb, rusty, NOW).C < 1);
  // keys outside the course never lock a song
  c = C.comfort(byId('frere'), withNotes({ C4: KNOWN(), D4: KNOWN(), E4: KNOWN(), F4: KNOWN(), G4: KNOWN(), A4: KNOWN() }, 5), NOW);
  assert.notEqual(c.label, 'locked');
  assert.deepEqual(c.outsideKeys, ['G3']);
});

// ---------- the introduction gate ----------
test('introGate: open for a new user; done after the last unit', () => {
  assert.equal(C.introGate(state(0)), 'open');
  assert.equal(C.introGate(state(11)), 'done');
});

test('introGate: 4 learning notes at acc 0.85, n 8 -> soft (budget); after 2 become known -> open', () => {
  const S = withNotes({ C4: LEARN(0.85), D4: LEARN(0.85), E4: LEARN(0.85), F4: LEARN(0.85) }, 3);
  assert.equal(C.introGate(S), 'soft');
  Object.assign(S.notes.C4, KNOWN());
  Object.assign(S.notes.D4, KNOWN());
  assert.equal(C.introGate(S), 'open');
});

test('introGate: C, D, E, F still learning keep G closed until the solid rule holds', () => {
  const S = withNotes({ C4: KNOWN(), D4: KNOWN(), E4: LEARN(0.65, 5), F4: LEARN(0.6, 4) }, 3);
  assert.equal(C.introGate(S), 'closed');
  Object.assign(S.notes.E4, LEARN(0.75, 7));
  Object.assign(S.notes.F4, LEARN(0.72, 6));
  assert.equal(C.introGate(S), 'soft');
  Object.assign(S.notes.E4, LEARN(0.82, 9));
  Object.assign(S.notes.F4, LEARN(0.81, 8));
  assert.equal(C.introGate(S), 'open');
});

test('introduce adds new records for the unit and moves the course line', () => {
  const S = state(0);
  C.introduce(S, 0, TODAY);
  assert.deepEqual(Object.keys(S.notes), ['C4', 'D4']);
  assert.equal(M.state(S.notes.C4), 'new');
  assert.equal(S.course.unit, 1);
  S.notes.C4.acc = 0.9;
  C.introduce(S, 0, TODAY);
  assert.equal(S.notes.C4.acc, 0.9, 'never resets an existing record');
  assert.equal(S.course.unit, 1);
  C.introduce(S, 1, TODAY);
  assert.equal(S.course.unit, 2);
  assert.deepEqual(C.introducedKeys(S), ['C4', 'D4', 'E4']);
});

// ---------- recommendation ----------
test('recommend: a fresh state with C-E introduced picks Hot Cross Buns', () => {
  const S = state(0);
  C.introduce(S, 0, TODAY);
  C.introduce(S, 1, TODAY);
  const r = C.recommend(S, LIB, NOW);
  assert.equal(r.kind, 'song');
  assert.equal(r.song.id, 'hot-cross-buns');
  assert.deepEqual(r.alts.map((s) => s.id), ['au-clair-de-la-lune']);
  // and with C, D a little practised and E just met
  const S2 = withNotes({ C4: LEARN(0.5, 4), D4: LEARN(0.5, 4), E4: {} }, 2);
  assert.equal(C.recommend(S2, LIB, NOW).song.id, 'hot-cross-buns');
});

test('recommend: gate open and every candidate easy -> meet the next unit', () => {
  const S = withNotes({ C4: KNOWN({ rt: 2000 }), D4: KNOWN({ rt: 2000 }), E4: KNOWN({ rt: 2000 }) }, 2);
  const r = C.recommend(S, LIB, NOW);
  assert.deepEqual(r, { kind: 'meet', unit: 2 });
});

test('recommend: no candidates -> meet when the gate is open, else a reading run', () => {
  assert.equal(C.recommend(withNotes({ C4: KNOWN(), D4: KNOWN() }, 1), LIB, NOW).kind, 'meet');
  assert.equal(C.recommend(withNotes({ C4: LEARN(0.5, 2), D4: LEARN(0.5, 2) }, 1), LIB, NOW).kind, 'run');
});

test('recommend: recently played and often played songs drop down', () => {
  const S = withNotes({ C4: LEARN(0.8), D4: LEARN(0.8), E4: LEARN(0.8), F4: LEARN(0.8), G4: LEARN(0.8) }, 4);
  const first = C.recommend(S, LIB, NOW).song.id;
  S.slices.practice.songs[first] = { plays: 1, last: NOW - 60000 };
  assert.notEqual(C.recommend(S, LIB, NOW).song.id, first);
  // songs with a locked key or above the course line are never candidates
  for (const s of [C.recommend(S, LIB, NOW).song, ...C.recommend(S, LIB, NOW).alts]) assert.ok(C.songLevel(s) < 4);
});

test('recommend: fast lane offers two single-note units together', () => {
  const S = withNotes({ C4: KNOWN(), D4: KNOWN(), E4: KNOWN(), F4: KNOWN(), G4: KNOWN() }, 4);
  assert.deepEqual(C.recommend(S, LIB, NOW), { kind: 'meet', unit: 4, pair: 5 });
  S.notes.G4.rt = 2000;
  assert.deepEqual(C.recommend(S, LIB, NOW), { kind: 'meet', unit: 4 });
  // unit 0 has two notes already: never paired
  assert.equal(C.fastLane(state(0)), false);
});

test('nextStep: check, first notes, meet, song and run', () => {
  const migrated = withNotes({ C4: LEARN(0.75, 4) }, 1);
  migrated.migratedFrom = 1;
  migrated.course.checkDone = false;
  assert.deepEqual(C.nextStep(migrated, LIB, NOW).route, '#/drill?check=1');
  migrated.course.checkSnoozeUntil = NOW + 1000;
  assert.notEqual(C.nextStep(migrated, LIB, NOW).kind, 'check', 'Not now snoozes it');

  const n0 = C.nextStep(state(0), LIB, NOW);
  assert.equal(n0.kind, 'meet');
  assert.equal(n0.route, '#/drill?meet=C4,D4');
  assert.equal(n0.sub, 'Your first notes are middle C and D.');

  const meet = C.nextStep(withNotes({ C4: KNOWN(), D4: KNOWN(), E4: KNOWN(), F4: KNOWN(), G4: KNOWN({ rt: 2000 }) }, 4), LIB, NOW);
  assert.equal(meet.kind, 'meet');
  assert.equal(meet.title, 'Meet a new note: A');
  assert.equal(meet.sub, 'Second space. One step up from G.');
  assert.equal(meet.route, '#/drill?meet=A4');

  const pair = C.nextStep(withNotes({ C4: KNOWN(), D4: KNOWN(), E4: KNOWN(), F4: KNOWN(), G4: KNOWN() }, 4), LIB, NOW);
  assert.equal(pair.title, 'Meet A and B together');
  assert.equal(pair.route, '#/drill?meet=A4,B4');

  const S = state(0);
  C.introduce(S, 0, TODAY);
  C.introduce(S, 1, TODAY);
  const s = C.nextStep(S, LIB, NOW);
  assert.equal(s.kind, 'song');
  assert.equal(s.title, 'Read: hot-cross-buns');
  assert.equal(s.route, '#/practice/hot-cross-buns');
  assert.match(s.sub, /^(Easy|Just right|Stretch|Tough) · \d+% known$/);

  const run = C.nextStep(withNotes({ C4: LEARN(0.5, 2), D4: LEARN(0.5, 2) }, 1), LIB, NOW);
  assert.equal(run.kind, 'run');
  assert.equal(run.route, '#/practice/run?seed=' + parseInt(Util.hash(TODAY), 16));
});

// ---------- generated reading ----------
const toks = (str) => str.split(' ').filter((t) => t !== '/');
const keyOf = (t) => t.split(':')[0];

test('genPhrase: only pool keys, ends on C4 / G4 / C5 as a half note, deterministic, phrase marks every 4', () => {
  const pool = ['C4', 'D4', 'E4', 'F4', 'G4'];
  for (let seed = 1; seed <= 20; seed++) {
    const p = C.genPhrase(pool, ['F4'], { seed });
    const t = toks(p);
    assert.equal(t.length, 12);
    t.forEach((x) => assert.ok(pool.includes(keyOf(x)), x));
    assert.match(t[11], /^(C4|G4|C5):h$/);
    t.slice(0, 11).forEach((x) => assert.ok(!x.includes(':'), 'quarter notes until the end'));
    assert.equal(p, C.genPhrase(pool, ['F4'], { seed }));
    assert.equal(p.split(' / ').length, 3);
  }
  assert.notEqual(C.genPhrase(pool, ['F4'], { seed: 1 }), C.genPhrase(pool, ['F4'], { seed: 2 }));
});

test('genPhrase: focus share 0.35 +- 0.1 over 20 seeds', () => {
  const pool = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4'];
  let focus = 0;
  let total = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const t = toks(C.genPhrase(pool, ['A4'], { seed, len: 12, focusShare: 0.35 }));
    focus += t.filter((x) => keyOf(x) === 'A4').length;
    total += t.length;
  }
  const share = focus / total;
  assert.ok(Math.abs(share - 0.35) <= 0.1, `share ${share}`);
});

test('genPhrase: mostly steps (walk weights)', () => {
  const pool = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
  let steps = 0;
  let leaps = 0;
  let n = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const t = toks(C.genPhrase(pool, [], { seed, len: 20 })).slice(0, -1).map((x) => C.staffPosOf(keyOf(x)));
    for (let i = 1; i < t.length; i++) {
      const d = Math.abs(t[i] - t[i - 1]);
      n++;
      if (d === 1) steps++;
      if (d >= 3) leaps++;
    }
  }
  assert.ok(steps / n > 0.45, `steps ${steps / n}`);
  assert.ok(leaps / n < 0.12, `leaps ${leaps / n}`);
});

test('readingRun: 16 notes over the introduced notes', () => {
  const S = withNotes({ C4: KNOWN(), D4: KNOWN(), E4: LEARN(0.7), F4: {} }, 3);
  const t = toks(C.readingRun(S, 7));
  assert.equal(t.length, 16);
  t.forEach((x) => assert.ok(['C4', 'D4', 'E4', 'F4'].includes(keyOf(x))));
  assert.equal(C.readingRun(S, 7), C.readingRun(S, 7));
  assert.equal(toks(C.readingRun(null, 3)).length, 16, 'works with no state');
});

// ---------- Note Drill deck ----------
function noAdjacent(deck) {
  for (let i = 1; i < deck.length; i++) assert.notEqual(deck[i], deck[i - 1], `repeat at ${i}: ${deck.join(' ')}`);
}

test('flashDeck: 15 cards, no adjacent repeats, every pool key within 10 decks', () => {
  const S = withNotes({ C4: KNOWN(), D4: KNOWN(), E4: LEARN(0.7), F4: LEARN(0.5), G4: {} }, 4);
  const rng = Util.mulberry32(1);
  const seen = new Set();
  for (let i = 0; i < 10; i++) {
    const deck = C.flashDeck(S, { rng, now: NOW });
    assert.equal(deck.length, 15);
    noAdjacent(deck);
    deck.forEach((k) => seen.add(k));
  }
  assert.deepEqual([...seen].sort(), ['C4', 'D4', 'E4', 'F4', 'G4']);
});

test('flashDeck: at least 70% of cards from comfortable keys', () => {
  const S = withNotes({ C4: KNOWN(), D4: KNOWN(), E4: KNOWN(), F4: LEARN(0.4), G4: {} }, 4);
  const rng = Util.mulberry32(5);
  for (let i = 0; i < 20; i++) {
    const deck = C.flashDeck(S, { rng, now: NOW });
    const hard = deck.filter((k) => k === 'F4' || k === 'G4').length;
    assert.ok(hard <= 4, `hard ${hard}`);
  }
});

test('flashDeck: a focus key fills at least 40% of the deck', () => {
  const S = withNotes({ C4: KNOWN(), D4: KNOWN(), E4: LEARN(0.5), F4: LEARN(0.7), G4: KNOWN(), A4: {} }, 5);
  const rng = Util.mulberry32(3);
  for (let i = 0; i < 10; i++) {
    const deck = C.flashDeck(S, { focusKey: 'E4', rng, now: NOW });
    noAdjacent(deck);
    assert.ok(deck.filter((k) => k === 'E4').length / deck.length >= 0.4, deck.join(' '));
  }
});

test('flashDeck: 1 or 2 keys alternate; no keys gives an empty deck', () => {
  assert.deepEqual(C.flashDeck(state(0), { now: NOW }), []);
  const two = C.flashDeck(withNotes({ C4: {}, D4: {} }, 1), { size: 6, rng: Util.mulberry32(2), now: NOW });
  assert.equal(two.length, 6);
  noAdjacent(two);
  assert.deepEqual(C.flashDeck(withNotes({ C4: {} }, 1), { size: 3, now: NOW }), ['C4', 'C4', 'C4']);
});

test('flashDeck: weak notes and their mix-up partners come up more', () => {
  const S = withNotes({ C4: KNOWN(), D4: KNOWN(), E4: LEARN(0.5), F4: KNOWN(), G4: KNOWN() }, 4);
  S.notes.E4.conf = { F4: 4 };
  const rng = Util.mulberry32(11);
  const count = {};
  for (let i = 0; i < 40; i++) C.flashDeck(S, { rng, now: NOW }).forEach((k) => (count[k] = (count[k] || 0) + 1));
  assert.ok(count.E4 > count.C4 && count.F4 > count.C4, JSON.stringify(count));
});

// ---------- Note check ----------
test('placementOrder: introduced notes, or C4..G5 by unit for a new user', () => {
  assert.deepEqual(C.placementOrder(state(0)), Object.keys(C.UNIT_OF));
  assert.deepEqual(C.placementOrder(withNotes({ E4: {}, C4: {}, D4: {} }, 2)), ['C4', 'D4', 'E4']);
});

const fast = (key) => ({ key, cards: [{ ok: true, rtMs: 1500 }, { ok: true, rtMs: 1700 }] });
const missed = (key, n = 2) => ({ key, cards: Array(n).fill({ ok: false, rtMs: null }) });

test('placement: perfect fast answers for C4..G4 then 3 misses -> unit 4, C4..G4 known, checkDone', () => {
  const S = state(0);
  const out = C.placement(S, ['C4', 'D4', 'E4', 'F4', 'G4'].map(fast).concat([missed('A4'), missed('B4', 1)]), { now: NOW });
  assert.equal(S.course.unit, 4);
  assert.equal(S.course.checkDone, true);
  assert.equal(S.course.placementAt, NOW);
  for (const k of ['C4', 'D4', 'E4', 'F4', 'G4']) {
    const r = S.notes[k];
    assert.equal(r.k, 1, k);
    assert.equal(M.state(r), 'known');
    assert.equal(r.acc, 0.9);
    assert.equal(r.box, 2);
    assert.equal(r.streak, 5);
    assert.equal(r.reads, 12);
    assert.equal(r.rt, 1600);
    assert.equal(r.due, Util.addDays(TODAY, 2));
  }
  assert.equal(S.notes.A4, undefined, 'a note never met and never read stays to come');
  assert.deepEqual(out.units, [0, 1, 2, 3]);
  assert.deepEqual(out.promoted, ['C4', 'D4', 'E4', 'F4', 'G4']);
  // the known notes stay known through the next day's roll
  const { rec } = M.record(S.notes.C4, { outcome: 'read', source: 'flash', rtMs: 1000 }, NOW + 86400000);
  assert.equal(rec.k, 1);
});

test('placement: one read -> learning at 0.75, none -> learning at 0.5 for a note already met', () => {
  const S = withNotes({ C4: {}, D4: {}, E4: KNOWN() }, 2);
  C.placement(S, [
    { key: 'C4', cards: [{ ok: true, rtMs: 1000 }, { ok: true, rtMs: 6000 }] },
    { key: 'D4', reads: 0, total: 2 },
    missed('E4'),
  ], { now: NOW });
  assert.equal(M.state(S.notes.C4), 'learning');
  assert.equal(S.notes.C4.acc, 0.75);
  assert.equal(S.notes.D4.acc, 0.5);
  assert.equal(M.state(S.notes.D4), 'learning');
  assert.equal(S.notes.E4.k, 0, 'a known note that is missed goes back to learning');
  assert.equal(S.course.unit, 2);
});

test('placement: "I already know this" needs all 5 fast; otherwise nothing changes', () => {
  const S = withNotes({ C4: KNOWN(), D4: KNOWN(), E4: LEARN(0.6) }, 2);
  const snap = JSON.stringify(S);
  let out = C.placement(S, [{ key: 'E4', cards: Array(5).fill({ ok: true, rtMs: 1200 }).concat([]).map((c, i) => (i === 4 ? { ok: true, rtMs: 4500 } : c)) }], { now: NOW, single: true });
  assert.deepEqual(out.promoted, []);
  assert.equal(JSON.stringify(S), snap);
  out = C.placement(S, [{ key: 'E4', cards: Array(5).fill({ ok: true, rtMs: 1200 }) }], { now: NOW });
  assert.deepEqual(out.promoted, ['E4']);
  assert.equal(S.notes.E4.k, 1);
  assert.equal(S.course.checkDone, true, 'single check leaves checkDone alone');
});

// ---------- the real library (skipped when songs.js can't load yet) ----------
let real = null;
try { real = require('../songs.js'); } catch { real = null; }

test('real library: levels and the first recommendation', { skip: !real && 'songs.js not loadable' }, () => {
  const get = (id) => real.songs.find((s) => s.id === id);
  assert.equal(C.songLevel(get('mary')), 3);
  assert.equal(C.songLevel(get('hot-cross-buns')), 1);
  assert.equal(C.songLevel(get('frere')), Infinity);
  const S = state(0);
  C.introduce(S, 0, TODAY);
  C.introduce(S, 1, TODAY);
  assert.equal(C.recommend(S, real.songs, NOW).song.id, 'hot-cross-buns');
  const easy = withNotes({ C4: KNOWN(), D4: KNOWN(), E4: KNOWN() }, 2);
  assert.equal(C.recommend(easy, real.songs, NOW).kind, 'meet');
});
