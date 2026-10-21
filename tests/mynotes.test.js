// WP9: My notes pure helpers (modes/mynotes.js), spec §3.4.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../modes/mynotes.js');
const Util = require('../core/util.js');
const Curriculum = require('../core/curriculum.js');

test('header counts', () => {
  assert.equal(M.countsText({ known: 7, learning: 2, new: 1, locked: 1 }), '7 known · 2 learning · 1 new · 1 to come');
  assert.equal(M.countsText({ known: 0, learning: 2, new: 0, locked: 10 }), '2 learning · 10 to come');
  const c = M.countStates({ C4: { state: 'known' }, D4: { state: 'known', rusty: true }, E4: { state: 'learning' }, F4: { state: 'locked' } });
  assert.deepEqual(c, { known: 2, learning: 1, new: 0, locked: 1, rusty: 1 });
});

test('mix-ups: top 3 across notes, at least 2 times, plain sentence', () => {
  const notes = {
    E4: { conf: { F4: 3, D4: 1 } }, A4: { conf: { G4: 5 } }, B4: { conf: { C5: 2 } }, C5: { conf: { C4: 2, D5: 4 } }, D4: {},
  };
  const top = M.mixups(notes);
  assert.deepEqual(top.map((m) => `${m.seen}>${m.played}`), ['A4>G4', 'C5>D5', 'E4>F4']);
  assert.equal(M.mixupText(top[2]), 'You sometimes play F when you see E.');
  assert.equal(M.mixupText({ seen: 'C5', played: 'C4' }), 'You sometimes play C4 when you see C5.');
  assert.equal(M.mixupText({ seen: 'G4', played: 'F#4' }), 'You sometimes play F♯ when you see G.');
  assert.deepEqual(M.mixups({ E4: { conf: { F4: 1 } } }), []);
  assert.deepEqual(M.mixups({}), []);
});

test('detail stats wording', () => {
  assert.equal(M.reviewText('2026-10-21', '2026-10-21', Util.daysBetween), 'today');
  assert.equal(M.reviewText('2026-10-19', '2026-10-21', Util.daysBetween), 'today');
  assert.equal(M.reviewText('2026-10-22', '2026-10-21', Util.daysBetween), 'tomorrow');
  assert.equal(M.reviewText('2026-10-23', '2026-10-21', Util.daysBetween), 'in 2 days');
  assert.equal(M.reviewText(null, '2026-10-21', Util.daysBetween), null);
  assert.equal(M.firstTryPct({ reads: 9, miss: 3 }), 75);
  assert.equal(M.firstTryPct({ reads: 0, miss: 0 }), null);
  assert.equal(M.topConf({ conf: { G4: 1, F4: 3 } }), 'F4');
  assert.equal(M.topConf({ conf: {} }), null);
  assert.equal(M.daysText(0), 'not on separate days yet');
  assert.equal(M.daysText(1), 'on 1 separate day');
  assert.equal(M.daysText(3), 'on 3 separate days');
});

test('chip aria-label says the note, where it sits and its state', () => {
  assert.equal(M.chipAria('E4', 'Known', false), 'E4, bottom line, known');
  assert.equal(M.chipAria('A4', 'Learning', true), 'A4, second space, learning, due for review');
  assert.equal(M.chipAria('G5', 'Coming up', false), 'G5, just above the top line, coming up');
});

test('path: unit status', () => {
  const U = Curriculum.UNITS;
  const states = { C4: { state: 'known' }, D4: { state: 'known' }, E4: { state: 'learning' }, F4: { state: 'new' } };
  assert.equal(M.unitStatus(U[0], 0, states, 3), 'known');
  assert.equal(M.unitStatus(U[1], 1, states, 3), 'learning');
  assert.equal(M.unitStatus(U[2], 2, states, 3), 'new');
  assert.equal(M.unitStatus(U[3], 3, states, 3), 'next');
  assert.equal(M.unitStatus(U[4], 4, states, 3), 'later');
  assert.equal(M.unitStatus(U[0], 0, { C4: { state: 'known' }, D4: { state: 'learning' } }, 1), 'learning');
});

test('gate copy (§3.2.6)', () => {
  assert.equal(M.gateAction('open', ['A'], []).text, 'Ready for a new note: A');
  const soft = M.gateAction('soft', ['A'], ['F', 'G']);
  assert.equal(soft.text, 'You’re still settling in F and G. Meet A now, or practise first?');
  assert.equal(soft.label, 'Meet A');
  assert.equal(M.gateAction('closed', ['A'], ['F', 'G']).label, 'Learn A anyway');
  assert.equal(M.gateAction('done', [], []).kind, 'done');
  assert.equal(M.gateAction('open', ['C', 'D'], []).label, 'Meet C and D');
});

test('locked notes say what they come after', () => {
  assert.equal(M.comesAfter('B4'), 'A4');
  assert.equal(M.comesAfter('C4'), null);
  assert.equal(M.STATE_WORD.locked, 'Coming up');
});
