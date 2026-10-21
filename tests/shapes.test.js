// WP2: core/shapes.js (spec §2.4.6, §3.5, §5.1).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../core/notation.js');
const Sh = require('../core/shapes.js');

const n = (k) => N.parseToken(k);

test('classify: same, half, step, skip, leaps and the octave', () => {
  let c = Sh.classify(n('E4'), n('E4'));
  assert.equal(c.kind, 'same');
  assert.equal(c.dir, 0);
  assert.equal(c.short, '=');
  assert.equal(c.long, 'the same note');

  c = Sh.classify(n('C4'), n('C#4'));
  assert.equal(c.kind, 'half');
  assert.equal(c.dir, 1);
  assert.equal(c.dist, 0);
  assert.equal(c.long, 'a half step up');
  assert.equal(Sh.classify(n('C#4'), n('C4')).long, 'a half step down');

  c = Sh.classify(n('C4'), n('D4'));
  assert.deepEqual([c.kind, c.dir, c.dist, c.num, c.short, c.long], ['step', 1, 1, 2, 'step', 'a step up']);
  c = Sh.classify(n('G4'), n('E4'));
  assert.deepEqual([c.kind, c.dir, c.dist, c.num, c.short, c.long], ['skip', -1, 2, 3, 'skip', 'a skip down']);
  // a step by staff distance even when it is a whole tone with an accidental
  assert.equal(Sh.classify(n('E4'), n('F#4')).kind, 'step');

  c = Sh.classify(n('C4'), n('F4'));
  assert.deepEqual([c.kind, c.num, c.short, c.long], ['leap', 4, '4th', 'a leap up a 4th']);
  c = Sh.classify(n('G4'), n('C4'));
  assert.deepEqual([c.kind, c.dir, c.short, c.long], ['leap', -1, '5th', 'a leap down a 5th']);
  assert.equal(Sh.classify(n('C4'), n('A4')).short, '6th');
  assert.equal(Sh.classify(n('C4'), n('B4')).short, '7th');
  c = Sh.classify(n('C4'), n('C5'));
  assert.deepEqual([c.kind, c.dist, c.num, c.short], ['leap', 7, 8, '8ve']);
  assert.equal(c.long, 'a leap up an octave');
  c = Sh.classify(n('C4'), n('E5'));
  assert.equal(c.short, '>8ve');
  assert.equal(c.long, 'a leap up of more than an octave');
});

test('statKey: half tallies as step', () => {
  assert.equal(Sh.statKey('half'), 'step');
  for (const k of ['same', 'step', 'skip', 'leap']) assert.equal(Sh.statKey(k), k);
});

test('typeLevel thresholds', () => {
  assert.equal(Sh.typeLevel({ n: 14, acc: 0.9 }, 'step'), 2);
  assert.equal(Sh.typeLevel({ n: 15, acc: 0.75 }, 'step'), 1);
  assert.equal(Sh.typeLevel({ n: 40, acc: 0.9 }, 'step'), 0);
  assert.equal(Sh.typeLevel({ n: 40, acc: 0.89 }, 'skip'), 1);
  assert.equal(Sh.typeLevel({ n: 15, acc: 0.74 }, 'leap'), 2);
  assert.equal(Sh.typeLevel({ n: 10, acc: 0.9 }, 'same'), 0);
  assert.equal(Sh.typeLevel({ n: 9, acc: 0.95 }, 'same'), 1);
  // missing or fresh stats need the most help
  assert.equal(Sh.typeLevel(undefined, 'step'), 2);
  assert.equal(Sh.typeLevel({ n: 0, acc: 0.5 }, 'skip'), 2);
  assert.equal(Sh.typeLevel(undefined, 'same'), 1);
});

test('pairLevel rules', () => {
  const base = { typeLevel: 1, stateA: 'learning', stateB: 'learning', setting: 'auto', showIt: false, guard: false };
  assert.equal(Sh.pairLevel(Object.assign({}, base, { setting: 'off', showIt: true })), 0);
  assert.equal(Sh.pairLevel(Object.assign({}, base, { setting: 'always', typeLevel: 0 })), 2);
  assert.equal(Sh.pairLevel(Object.assign({}, base, { showIt: true, typeLevel: 0 })), 2);
  assert.equal(Sh.pairLevel(Object.assign({}, base, { guard: true, typeLevel: 0 })), 2);
  // both known and the type is at level 1 or below: nothing
  assert.equal(Sh.pairLevel(Object.assign({}, base, { stateA: 'known', stateB: 'known', typeLevel: 1 })), 0);
  assert.equal(Sh.pairLevel(Object.assign({}, base, { stateA: 'known', stateB: 'known', typeLevel: 2 })), 2);
  // a new note at type level 0 still gets the arrow
  assert.equal(Sh.pairLevel(Object.assign({}, base, { stateA: 'known', stateB: 'new', typeLevel: 0 })), 1);
  assert.equal(Sh.pairLevel(Object.assign({}, base, { stateA: 'new', stateB: 'known', typeLevel: 2 })), 2);
  assert.equal(Sh.pairLevel(Object.assign({}, base, { stateB: 'locked', typeLevel: 0 })), 1);
  // otherwise the type level
  assert.equal(Sh.pairLevel(Object.assign({}, base, { typeLevel: 0 })), 0);
  assert.equal(Sh.pairLevel(Object.assign({}, base, { typeLevel: 1 })), 1);
  // §3.5 acceptance: auto + fresh stats, a step into a new note draws at level 2
  const L = Sh.typeLevel(undefined, Sh.statKey(Sh.classify(n('C4'), n('D4')).kind));
  assert.equal(Sh.pairLevel({ typeLevel: L, stateA: 'learning', stateB: 'new', setting: 'auto' }), 2);
  // §3.5 acceptance: step {n:40, acc:.95} and both notes known draws nothing
  const L2 = Sh.typeLevel({ n: 40, acc: 0.95 }, 'step');
  assert.equal(Sh.pairLevel({ typeLevel: L2, stateA: 'known', stateB: 'known', setting: 'auto' }), 0);
});

test('updateStat: n grows by w and acc converges toward x', () => {
  let s = { n: 0, acc: 0.5 };
  const s1 = Sh.updateStat(s, 1, 1);
  assert.equal(s1.n, 1);
  assert.ok(Math.abs(s1.acc - 0.55) < 1e-9);
  assert.equal(s.acc, 0.5, 'input not mutated');
  for (let k = 0; k < 200; k++) s = Sh.updateStat(s, 1, 1);
  assert.ok(s.acc > 0.99 && s.acc <= 1);
  assert.equal(s.n, 200);
  for (let k = 0; k < 200; k++) s = Sh.updateStat(s, 0, 0.5);
  assert.ok(s.acc < 0.01 && s.acc >= 0);
  assert.equal(s.n, 300);
  // starting from nothing uses acc0 0.5
  const fresh = Sh.updateStat(undefined, 0, 1);
  assert.equal(fresh.n, 1);
  assert.ok(Math.abs(fresh.acc - 0.45) < 1e-9);
});

test('describe and rescueText', () => {
  assert.equal(Sh.describe(n('C4'), n('D4')), 'Next note is a step up.');
  assert.equal(Sh.describe(n('G4'), n('C4')), 'Next note is a leap down a 5th.');
  assert.equal(Sh.rescueText(n('E4'), n('G4'), true), "It's a skip up from E.");
  assert.equal(Sh.rescueText(n('E4'), n('G4'), false), "It's a skip up from the last note.");
  assert.equal(Sh.rescueText(n('F#4'), n('E4'), true), "It's a step down from F♯.");
  assert.equal(Sh.rescueText(n('E4'), n('E4'), true), "It's the same note as E.");
  assert.equal(Sh.rescueText(n('E4'), n('E4'), false), "It's the same note as the last one.");
});

test('levelUpText: once per downward crossing', () => {
  assert.equal(Sh.levelUpText('step', 2, 1), 'Steps are getting easy, so their labels are hiding now.');
  assert.equal(Sh.levelUpText('step', 1, 0), 'You read steps at a glance now, so their arrows are gone.');
  assert.equal(Sh.levelUpText('skip', 2, 1), 'Skips are getting easy, so their labels are hiding now.');
  assert.equal(Sh.levelUpText('leap', 1, 0), 'You read leaps at a glance now, so their arrows are gone.');
  assert.equal(Sh.levelUpText('step', 1, 2), null);
  assert.equal(Sh.levelUpText('step', 1, 1), null);
});
