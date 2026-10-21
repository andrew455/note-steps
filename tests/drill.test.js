// WP9: Note Drill pure core (modes/drill.js): deck, card run and reinsertion, the attempt rule,
// Note check sequence and placement rules (spec §3.3).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../modes/drill.js');
const Util = require('../core/util.js');
const Mastery = require('../core/mastery.js');
const Curriculum = require('../core/curriculum.js');

const NOW = Date.UTC(2026, 9, 21, 12);
const entry = (key, state, acc = 0.5, extra = {}) => Object.assign({ key, state, acc, rusty: false, rt: null, conf: {} }, extra);
const noAdjacent = (keys) => keys.every((k, i) => i === 0 || k !== keys[i - 1]);

test('parseKey matches the Notation formulas', () => {
  assert.deepEqual(D.parseKey('C4'), { key: 'C4', letter: 'C', acc: '', octave: 4, staffPos: -2, midi: 60 });
  assert.equal(D.parseKey('E4').staffPos, 0);
  assert.equal(D.parseKey('G5').midi, 79);
  assert.equal(D.parseKey('F#4').midi, 66);
  assert.equal(D.parseKey('Bb4').midi, 70);
  assert.equal(D.parseKey('nope'), null);
});

test('plain wording: short positions, anchors, no mnemonics', () => {
  for (const k of D.ORDER) {
    assert.ok(D.shortPos(k), k);
    assert.ok(D.info(k).text, k);
    assert.doesNotMatch(D.shortPos(k) + D.info(k).text, /every|good|boy|face|cow/i);
  }
  assert.equal(D.anchorText({ from: 'G4', dist: 'step up' }), 'One step up from G.');
  for (const k of D.ORDER) assert.equal(D.info(k, Curriculum.NOTE_INFO).text, Curriculum.NOTE_INFO[k].text, 'fallback table matches §3.2.1');
  assert.equal(D.anchorText(null), '');
  assert.equal(D.listLetters(['F']), 'F');
  assert.equal(D.listLetters(['F', 'G']), 'F and G');
  assert.equal(D.listLetters(['E', 'F', 'G']), 'E, F and G');
  assert.equal(D.nameFor('C4', ['C4', 'D4']), 'C');
  assert.equal(D.nameFor('C4', ['C4', 'C5']), 'C4');
});

test('weights follow §3.3.1', () => {
  assert.equal(D.weightOf(entry('C4', 'new')), 3);
  assert.equal(D.weightOf(entry('C4', 'learning', 0.5)), 3.5);
  assert.equal(D.weightOf(entry('C4', 'known', 0.9)), 0.5);
  assert.equal(D.weightOf(entry('C4', 'known', 0.9, { rusty: true, rt: 3500 })), 3.5);
  assert.equal(D.weightOf(entry('F4', 'known', 0.9), { partners: new Set(['F4']) }), 2);
  const focus = D.parseKey('E4');
  assert.equal(D.weightOf(entry('E4', 'known'), { focus }), 10);
  assert.equal(D.weightOf(entry('G4', 'new'), { focus }), 3); // 2 staff positions away
  assert.equal(D.weightOf(entry('C5', 'new'), { focus }), 0.3);
  const pool = [entry('E4', 'learning', 0.5, { conf: { F4: 3, D4: 1, G4: 2 } }), entry('F4', 'known', 0.9)];
  assert.deepEqual([...D.confusionPartners(pool)].sort(), ['F4', 'G4']);
});

test('deck: 15 cards, pool keys only, never the same key twice in a row', () => {
  const pool = [entry('C4', 'known', 0.9), entry('D4', 'known', 0.9), entry('E4', 'learning', 0.7), entry('F4', 'new'), entry('G4', 'new')];
  for (let seed = 1; seed <= 60; seed++) {
    const deck = D.localDeck(pool, { rng: Util.mulberry32(seed) });
    assert.equal(deck.length, 15);
    assert.ok(deck.every((k) => pool.some((p) => p.key === k)));
    assert.ok(noAdjacent(deck), `seed ${seed}: ${deck}`);
    // at least 70% from notes with acc >= 0.6 or known
    const easy = deck.filter((k) => ['C4', 'D4', 'E4'].includes(k)).length;
    assert.ok(easy / deck.length >= 0.7, `seed ${seed}: ${easy}/15 easy`);
  }
});

test('deck: weaker notes come up more often', () => {
  // learning notes at acc 0.65 still count as "easy" for the 70% rule, so weights decide
  const pool = [entry('C4', 'known', 0.95), entry('D4', 'known', 0.95), entry('E4', 'learning', 0.65), entry('F4', 'learning', 0.65)];
  let weak = 0;
  let strong = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const deck = D.localDeck(pool, { rng: Util.mulberry32(seed) });
    weak += deck.filter((k) => k === 'E4' || k === 'F4').length;
    strong += deck.filter((k) => k === 'C4' || k === 'D4').length;
  }
  assert.ok(weak > strong, `${weak} weak vs ${strong} strong`);
});

test('deck: a focus key fills at least 40% of the deck', () => {
  const pool = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4'].map((k) => entry(k, 'known', 0.9));
  for (let seed = 1; seed <= 30; seed++) {
    const deck = D.localDeck(pool, { focusKey: 'E4', rng: Util.mulberry32(seed) });
    assert.ok(noAdjacent(deck));
    assert.ok(deck.filter((k) => k === 'E4').length >= 6, `seed ${seed}: ${deck}`);
  }
});

test('deck: a pool of 2 alternates, a pool of 1 repeats, an empty pool gives nothing', () => {
  const two = D.localDeck([entry('C4', 'known', 0.9), entry('D4', 'new')], { rng: Util.mulberry32(3) });
  assert.equal(two.length, 15);
  assert.equal(two[0], 'D4'); // the heavier one first
  assert.ok(noAdjacent(two));
  assert.deepEqual(D.localDeck([entry('E4', 'new')], { size: 5 }), ['E4', 'E4', 'E4', 'E4', 'E4']);
  assert.deepEqual(D.localDeck([]), []);
});

test('buildDeck uses Curriculum.flashDeck when it is usable, else its own deck', () => {
  const pool = ['C4', 'D4', 'E4', 'F4'].map((k) => entry(k, 'learning', 0.7));
  const good = ['C4', 'D4', 'E4', 'F4', 'C4', 'D4', 'E4', 'F4', 'C4', 'D4', 'E4', 'F4', 'C4', 'D4', 'E4'];
  assert.deepEqual(D.buildDeck(pool, { flashDeck: () => good }), good);
  // adjacent repeats are taken apart
  const rep = D.buildDeck(pool, { flashDeck: () => ['C4', 'C4', 'D4', 'D4', 'E4', 'E4', 'F4', 'F4', 'C4', 'D4', 'E4', 'F4', 'C4', 'D4', 'E4'] });
  assert.ok(noAdjacent(rep));
  // keys you haven't met are dropped; a deck that is mostly foreign falls back to ours
  const foreign = D.buildDeck(pool, { rng: Util.mulberry32(1), flashDeck: () => Array(15).fill('A4') });
  assert.equal(foreign.length, 15);
  assert.ok(foreign.every((k) => ['C4', 'D4', 'E4', 'F4'].includes(k)) && noAdjacent(foreign));
  // a throwing flashDeck falls back too
  assert.equal(D.buildDeck(pool, { rng: Util.mulberry32(1), flashDeck: () => { throw new Error('x'); } }).length, 15);
  // a "focused" deck without the focus note falls back to our focused deck
  const f = D.buildDeck(pool, { focusKey: 'F4', rng: Util.mulberry32(2), flashDeck: () => good.map((k) => (k === 'F4' ? 'C4' : k)) });
  assert.ok(f.filter((k) => k === 'F4').length >= 6);
  // the WP0 stub deck (C4 D4 E4 repeating) still works for a C-E pool
  const stub = Curriculum.flashDeck({}, { size: 15 });
  const cde = ['C4', 'D4', 'E4'].map((k) => entry(k, 'new'));
  assert.ok(noAdjacent(D.buildDeck(cde, { flashDeck: () => stub })));
});

test('weakest keeps the 4 notes with the lowest pct', () => {
  const pool = [['C4', 90], ['D4', 20], ['E4', 50], ['F4', 10], ['G4', 70], ['A4', 30]].map(([k, pct]) => Object.assign(entry(k, 'learning'), { pct }));
  assert.deepEqual(D.weakest(pool).map((p) => p.key), ['F4', 'D4', 'A4', 'E4']);
});

test('run: a miss reinserts the same note 3 cards later', () => {
  const deck = ['C4', 'D4', 'E4', 'F4', 'C4', 'D4', 'E4', 'F4', 'C4', 'D4', 'E4', 'F4', 'C4', 'D4', 'E4'];
  const run = D.createRun(deck);
  run.answer({ firstTry: true, rtMs: 900 }); // C4
  assert.equal(run.current().key, 'D4');
  const at = run.miss();
  assert.equal(at, run.pos + 3);
  assert.equal(run.cards[at].key, 'D4');
  assert.equal(run.cards[at].orig, false);
  assert.equal(run.miss(), -1, 'a second miss on the same card does not reinsert again');
  assert.equal(run.cards.length, 16);
  assert.ok(noAdjacent(run.cards.map((c) => c.key)));
});

test('run: at most 2 reinserts per note per drill, and never back to back', () => {
  const deck = ['C4', 'D4', 'C4', 'D4', 'C4', 'D4', 'C4', 'D4', 'C4', 'D4', 'C4', 'D4', 'C4', 'D4', 'C4'];
  const run = D.createRun(deck);
  let reins = 0;
  while (!run.done()) {
    if (run.current().key === 'D4' && run.miss() >= 0) reins++;
    run.answer({ firstTry: false, rtMs: 2000 });
  }
  assert.equal(reins, 2);
  assert.equal(run.cards.filter((c) => !c.orig && !c.filler && c.key === 'D4').length, 2);
  assert.equal(run.cards.filter((c) => c.orig).length, 15);
  assert.ok(noAdjacent(run.cards.map((c) => c.key)), run.cards.map((c) => c.key).join(' '));
});

test('run: a miss on the last card comes back after a filler, not straight after itself', () => {
  const run = D.createRun(['C4', 'D4']);
  run.answer({ firstTry: true });
  assert.equal(run.miss(), 3);
  assert.deepEqual(run.cards.map((c) => c.key), ['C4', 'D4', 'C4', 'D4']);
  assert.equal(run.cards[2].filler, true);
  const run2 = D.createRun(['C4', 'D4', 'E4']);
  run2.answer({ firstTry: true });
  assert.equal(run2.miss(), 3); // D4 goes to the end, after E4
});

test('summary: "14 of 15 first try" after 1 miss, rows and "faster than last time"', () => {
  const deck = ['C4', 'D4', 'E4', 'F4', 'C4', 'D4', 'E4', 'F4', 'C4', 'D4', 'E4', 'F4', 'C4', 'D4', 'E4'];
  const run = D.createRun(deck);
  let answered = 0;
  while (!run.done()) {
    const c = run.current();
    if (run.pos === 2) { run.miss(); run.answer({ firstTry: false, outcome: 'miss', rtMs: 4000 }); } else run.answer({ firstTry: true, outcome: 'read', rtMs: c.key === 'F4' ? 1800 : 1000 });
    answered++;
  }
  assert.equal(answered, 16);
  const sum = D.summarize(run.cards, { F4: { rt: 2500 }, C4: { rt: 800 } });
  assert.equal(sum.firstTry, 14);
  assert.equal(sum.total, 15);
  const f = sum.rows.find((r) => r.key === 'F4');
  assert.equal(D.rowText(f), 'F · 3/3 · 1.8 s · faster than last time');
  const c = sum.rows.find((r) => r.key === 'C4');
  assert.equal(c.faster, false);
  const e = sum.rows.find((r) => r.key === 'E4');
  assert.equal(`${e.firstTry}/${e.shown}`, '3/4');
});

test('attempt rule: read, assisted and miss as in Practice', () => {
  const att = (o) => Object.assign({ wrong: 0, hinted: false, heardNote: false, labelAt: null }, o);
  assert.equal(D.attemptOutcome(att({}), 1000, 'auto'), 'read');
  assert.equal(D.attemptOutcome(att({ labelAt: 1500 }), 1000, 'auto'), 'read', 'played before the label appeared');
  assert.equal(D.attemptOutcome(att({ labelAt: 500 }), 1000, 'auto'), 'assisted');
  assert.equal(D.attemptOutcome(att({ labelAt: 0 }), 1000, 'auto'), 'assisted', 'label at time 0 still counts');
  assert.equal(D.attemptOutcome(att({ heardNote: true }), 1000, 'auto'), 'assisted');
  assert.equal(D.attemptOutcome(att({}), 1000, 'always'), 'assisted');
  assert.equal(D.attemptOutcome(att({ wrong: 1 }), 1000, 'auto'), 'miss');
  assert.equal(D.attemptOutcome(att({ hinted: true }), 1000, 'auto'), 'miss');
  // only confident wrong notes outside the sustain-bleed window count
  assert.equal(D.countsAsWrong({ lastCorrectAt: null }, { confident: true, tOnset: 50 }), true);
  assert.equal(D.countsAsWrong({ lastCorrectAt: 1000 }, { confident: true, tOnset: 1200 }), false);
  assert.equal(D.countsAsWrong({ lastCorrectAt: 1000 }, { confident: true, tOnset: 1400 }), true);
  assert.equal(D.countsAsWrong({ lastCorrectAt: null }, { confident: false, tOnset: 5000 }), false);
  assert.equal(D.nearestOctave(77, 64), 65); // F5 heard for E4 -> F4
  assert.equal(D.nearestOctave(50, 64), 62); // D3 -> D4
});

test('note check: two cards per note, interleaved, stops after 3 misses in a row', () => {
  assert.deepEqual(D.checkSequence(['C4', 'D4', 'E4']), ['C4', 'D4', 'C4', 'E4', 'D4', 'E4']);
  assert.deepEqual(D.checkSequence(['C4']), ['C4', 'C4']);
  assert.ok(noAdjacent(D.checkSequence(D.ORDER)));
  const chk = D.createCheck(D.ORDER);
  const knows = new Set(['C4', 'D4', 'E4', 'F4', 'G4']);
  let shown = 0;
  while (!chk.done()) {
    const k = chk.current();
    chk.answer(knows.has(k), knows.has(k) ? 1200 : null);
    shown++;
  }
  const res = chk.results();
  assert.deepEqual(res.filter((r) => r.verdict === 'known').map((r) => r.key), ['C4', 'D4', 'E4', 'F4', 'G4']);
  assert.ok(shown < D.checkSequence(D.ORDER).length, 'stopped early');
  const a4 = res.find((r) => r.key === 'A4');
  assert.equal(a4.verdict, 'none');
  assert.deepEqual(a4.cards, [{ ok: false, rtMs: null }, { ok: false, rtMs: null }]);
  assert.ok(!res.some((r) => r.key === 'C5'), 'notes with fewer than 2 cards are not judged');
  // slow reads are reads, but not fast
  const slow = D.createCheck(['C4']);
  slow.answer(true, 5000);
  slow.answer(true, 1000);
  assert.equal(slow.results()[0].verdict, 'one');
});

// The check's results go to NS.mastery.applyPlacement, which runs Curriculum.placement (WP3). These
// tests drive the real rules with our results, so the contract between the two is checked here.
const fresh = () => ({ notes: {}, course: { unit: 0, checkDone: true, placementAt: null } });

test('placement acceptance: fresh store, C4..G4 fast then 3 misses -> unit 4, C4..G4 known', () => {
  const S = fresh();
  const chk = D.createCheck(Curriculum.placementOrder(S));
  const knows = new Set(['C4', 'D4', 'E4', 'F4', 'G4']);
  while (!chk.done()) { const k = chk.current(); chk.answer(knows.has(k), knows.has(k) ? 1500 : null); }
  const res = chk.results();
  assert.ok(res.every((r) => Array.isArray(r.cards) && r.cards.length === 2));
  Curriculum.placement(S, res, { now: NOW });
  assert.equal(S.course.unit, 4);
  assert.equal(S.course.checkDone, true);
  for (const k of ['C4', 'D4', 'E4', 'F4', 'G4']) {
    assert.equal(S.notes[k].k, 1, k);
    assert.equal(Mastery.state(S.notes[k]), 'known', k);
    assert.equal(S.notes[k].rt, 1500, k);
  }
  assert.ok(!('A4' in S.notes), 'A4 was never read, so it stays locked');
});

test('placement: slow or single reads give learning; a single check needs 5 of 5 fast', () => {
  const S = fresh();
  const chk = D.createCheck(['C4', 'D4', 'E4']);
  // C4 fast twice, D4 one fast + one slow, E4 slow twice
  const rt = { C4: [900, 900], D4: [900, 5000], E4: [5000, 6000] };
  while (!chk.done()) { const k = chk.current(); chk.answer(true, rt[k].shift()); }
  const res = chk.results();
  assert.deepEqual(res.map((r) => r.verdict), ['known', 'one', 'none']);
  Curriculum.placement(S, res, { now: NOW });
  assert.equal(Mastery.state(S.notes.C4), 'known');
  assert.equal(S.notes.D4.acc, 0.75);
  assert.equal(Mastery.state(S.notes.D4), 'learning');
  assert.ok(!('E4' in S.notes) || Mastery.state(S.notes.E4) !== 'known');

  const S2 = { notes: { C4: Mastery.newRecord('2026-10-01'), D4: Mastery.newRecord('2026-10-01'), E4: Mastery.newRecord('2026-10-01') }, course: { unit: 2, checkDone: false } };
  const pass = D.resultOf('E4', [900, 1000, 1200, 800, 3900].map((rtMs) => ({ ok: true, rtMs })));
  assert.equal(pass.verdict, 'known');
  Curriculum.placement(S2, [pass], { now: NOW, single: true });
  assert.equal(Mastery.state(S2.notes.E4), 'known');
  assert.equal(S2.course.checkDone, false, 'a single check never completes the placement');
  const S3 = { notes: { E4: Mastery.newRecord('2026-10-01') }, course: { unit: 2 } };
  const fail = D.resultOf('E4', [900, 1000, 4200, 800, 900].map((rtMs) => ({ ok: true, rtMs })));
  assert.equal(fail.verdict, 'one');
  Curriculum.placement(S3, [fail], { now: NOW, single: true });
  assert.equal(S3.notes.E4.k, 0, 'one slow card: nothing changes');
});

test('"I already know this": 5 scored cards, never the same note twice in a row, all fast to pass', () => {
  const cards = D.oneCheckCards('E4', ['C4', 'D4', 'F4'], Util.mulberry32(4));
  assert.equal(cards.filter((c) => c.scored).length, 5);
  assert.ok(cards.every((c) => c.key === 'E4' || !c.scored));
  assert.ok(noAdjacent(cards.map((c) => c.key)));
  assert.deepEqual(D.oneCheckCards('E4', []).map((c) => c.key), ['E4', 'E4', 'E4', 'E4', 'E4']);
  const ans = (rts) => rts.map((rt) => ({ scored: true, read: rt != null, rtMs: rt }));
  assert.equal(D.onePasses(ans([900, 1000, 1200, 800, 3900])), true);
  assert.equal(D.onePasses(ans([900, 1000, 1200, 800, 4100])), false);
  assert.equal(D.onePasses(ans([900, 1000, null, 800, 900])), false);
  assert.equal(D.onePasses(ans([900, 1000, 900])), false);
});

test('no lyrics or song text in the drill module', () => {
  const src = require('node:fs').readFileSync(require.resolve('../modes/drill.js'), 'utf8');
  assert.doesNotMatch(src, /lyrics|twinkle,? twinkle|little star|mary had/i);
});
