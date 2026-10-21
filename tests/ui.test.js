// WP5: the pure helpers behind NS.ui (comfort pill text, note letters, mic check order).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Ui = require('../core/ui.js');

test('keyLetter: naturals, sharps and flats', () => {
  assert.equal(Ui.keyLetter('E4'), 'E');
  assert.equal(Ui.keyLetter('F#4'), 'F♯');
  assert.equal(Ui.keyLetter('Bb4'), 'B♭');
  assert.equal(Ui.keyLetter('C♯5'), 'C♯');
  assert.equal(Ui.keyLetter(''), '');
});

test('listLetters: letters, with octaves only when a letter repeats', () => {
  assert.equal(Ui.listLetters(['F4', 'A4']), 'F, A');
  assert.equal(Ui.listLetters(['C4', 'D4', 'C5']), 'C4, D, C5');
  assert.equal(Ui.listLetters(['G4', 'G4']), 'G');
  assert.equal(Ui.listLetters([]), '');
  assert.equal(Ui.listLetters(['G5', 'A4'], ['G4', 'G5', 'A4']), 'G5, A', 'the song context keeps G5 apart from G4');
});

test('comfortText: labels from the curriculum rules (§3.8.2)', () => {
  const t = (c) => Ui.comfortText(c);
  assert.equal(t({ label: 'easy', C: 0.98, knownShare: 1, newKeys: [] }).text, 'Easy');
  const right = t({ label: 'right', C: 0.9, knownShare: 0.92, lockedKeys: [], newKeys: ['G4'] });
  assert.equal(right.text, 'Just right');
  assert.equal(right.known, '92% known');
  assert.equal(right.detail, '1 new note: G');
  assert.equal(t({ label: 'stretch', knownShare: 0.5, newKeys: ['F4', 'A4'] }).detail, '2 new notes: F, A');
  assert.equal(t({ label: 'tough', knownShare: 0 }).known, null, 'no "0% known"');
  const locked = t({ label: 'locked', knownShare: 0.4, lockedKeys: ['A4'] });
  assert.equal(locked.text, 'Locked');
  assert.equal(locked.detail, 'Learn A to unlock');
  assert.equal(locked.known, null);
  assert.equal(t({ label: 'locked', lockedKeys: [] }).detail, 'Learn its notes to unlock');
  assert.equal(Ui.comfortText({ label: 'locked', lockedKeys: ['G5'] }, { context: ['G4', 'G5'] }).detail, 'Learn G5 to unlock');
  assert.equal(t(null).text, 'Just right', 'a missing comfort does not throw');
  assert.equal(t({ label: 'weird' }).label, 'right');
});

test('heardInOrder: C then E then G, other notes allowed between, any octave', () => {
  assert.ok(Ui.heardInOrder([60, 64, 67]));
  assert.ok(Ui.heardInOrder([48, 62, 76, 55]), 'octaves and stray notes are fine');
  assert.ok(!Ui.heardInOrder([64, 60, 67]), 'E before C does not count as C first');
  assert.ok(Ui.heardInOrder([64, 60, 64, 67]));
  assert.ok(!Ui.heardInOrder([60, 64]));
  assert.ok(!Ui.heardInOrder([]));
  assert.ok(Ui.heardInOrder([67, 71, 74], [7, 11, 2]), 'custom pitch classes');
});

test('state words cover every note state', () => {
  for (const s of ['known', 'learning', 'new', 'locked']) assert.ok(Ui.STATE_WORD[s]);
  assert.deepEqual(Object.keys(Ui.COMFORT_TEXT), ['easy', 'right', 'stretch', 'tough', 'locked']);
});
