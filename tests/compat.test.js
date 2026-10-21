// WP5: window.NoteSteps compat rules that perform.js depends on (unlocks, badges, names).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Compat = require('../core/compat.js');

const songs = ['scale-up', 'scale-down', 'mary', 'ode', 'twinkle'].map((id, index) => ({ id, index }));

test('unlockRule: first song, previous passed, available in Practice, or already played', () => {
  const none = () => false;
  const rule = (i, o) => Compat.unlockRule(i, songs, Object.assign({ passed: none, played: none, available: none }, o));
  assert.equal(rule(0), true, 'the first song is always open');
  assert.equal(rule(1), false);
  assert.equal(rule(1, { passed: (s) => s.id === 'scale-up' }), true, 'previous song passed');
  assert.equal(rule(2, { passed: (s) => s.id === 'scale-up' }), false, 'only the song right after a pass opens');
  assert.equal(rule(3, { available: (s) => s.id === 'ode' }), true, 'all notes introduced opens it');
  assert.equal(rule(4, { played: (s) => s.id === 'twinkle' }), true, 'a song with scores stays open');
  assert.equal(rule(-1), false);
  assert.equal(rule(5), false);
  assert.equal(rule(1.5), false);
  assert.equal(Compat.unlockRule(1, songs, { passed: none }), false, 'available and played are optional');
});

test('a v1 user who finished Mary sees Ode open for Perform, before any notes are introduced', () => {
  const done = { mary: { mistakes: 2, at: 1 } };
  const passed = (s) => Boolean(done[s.id]);
  assert.equal(Compat.unlockRule(3, songs, { passed, played: passed, available: () => false }), true);
  assert.equal(Compat.unlockRule(2, songs, { passed, played: passed, available: () => false }), true, 'Mary itself stays open');
});

test('badgeFromCardLine: stars + text, tone, and the plain text Home draws', () => {
  const starText = (s) => '★'.repeat(s) + '☆'.repeat(3 - s);
  const b = Compat.badgeFromCardLine({ stars: 2, text: 'Perform best: 900 at 75% speed' }, starText);
  assert.equal(b.text, '★★☆ Perform best: 900 at 75% speed');
  assert.equal(b.plain, 'Perform best: 900 at 75% speed');
  assert.equal(b.stars, 2);
  assert.equal(b.tone, 'good');
  assert.equal(Compat.badgeFromCardLine({ stars: 1, text: 'x' }, starText).tone, 'muted');
  assert.equal(Compat.badgeFromCardLine({ text: 'plain' }, starText).text, 'plain');
  assert.equal(Compat.badgeFromCardLine(null, starText), null);
});

test('names <-> labels: on = anything but never; toggling sets auto / never', () => {
  assert.equal(Compat.namesFromLabels('auto'), true);
  assert.equal(Compat.namesFromLabels('always'), true);
  assert.equal(Compat.namesFromLabels('never'), false);
  assert.equal(Compat.labelsFromNames(true), 'auto');
  assert.equal(Compat.labelsFromNames(false), 'never');
});
