// WP3: v2 storage schema and migration from v1 (spec §2.4.8, §4; test plan §5.1).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Store = require('../core/store.js');
const M = require('../core/mastery.js');
const Util = require('../core/util.js');
const Pitch = require('../pitch.js');

const NOW = Date.UTC(2026, 9, 21, 12);
const TODAY = Util.dayKey(NOW);

function song(id, str) {
  const notes = str.split(/\s+/).map((t) => {
    const n = Pitch.parseNote(t);
    return Object.assign(n, { key: n.letter + (Math.floor(n.midi / 12) - 1) });
  });
  return { id, title: id, notes, keys: [...new Set(notes.map((n) => n.key))] };
}
const SONGS = [
  song('mary', 'E4 D4 C4 D4 E4 E4 E4:h D4 D4 D4:h E4 G4 G4:h E4 D4 C4 D4 E4 E4 E4 E4 D4 D4 E4 D4 C4:w'),
  song('ode', 'E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4:q. D4:e D4:h E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4:q. C4:e C4:h'),
  song('frere', 'C4 D4 E4 C4 C4 D4 E4 C4 E4 F4 G4:h E4 F4 G4:h G4:e A4:e G4:e F4:e E4 C4 G4:e A4:e G4:e F4:e E4 C4 C4 G3 C4:h C4 G3 C4:h'),
];

const V1 = '{"done":{"mary":{"mistakes":0,"at":1}},"names":false,"perf":{"mary":{"75":{"score":900,"stars":2}}},"speed":50,"best":{"x":1}}';

test('keys', () => {
  assert.equal(Store.KEY, 'note-steps-v2');
  assert.equal(Store.LEGACY_KEY, 'note-steps-v1');
});

test('fresh: the v2 shape with every slice, including byear', () => {
  const f = Store.fresh(NOW);
  assert.equal(f.v, 2);
  assert.equal(f.created, NOW);
  assert.equal(f.migratedFrom, null);
  assert.deepEqual(f.settings, { labels: 'auto', shapes: 'auto', keyLabels: true, hearFirst: 'ask', spelling: 'sharp', cues: true, firstRun: { sound: false, mic: false } });
  assert.deepEqual(f.course, { unit: 0, checkDone: true, placementAt: null, checkSnoozeUntil: null });
  assert.deepEqual(f.notes, {});
  assert.deepEqual(Object.keys(f.shapes), ['same', 'step', 'skip', 'leap']);
  assert.deepEqual(Object.keys(f.slices).sort(), ['byear', 'drill', 'ear', 'free', 'legacyExtra', 'perform', 'practice', 'shell']);
  assert.deepEqual(f.slices.byear, { best: {}, practiceSecs: 120, speed: 1 });
  assert.deepEqual(f.slices.perform, { perf: {}, speed: 75, clickTrack: true, latency: null });
  assert.notEqual(Store.fresh(NOW).slices, f.slices, 'a new object every time');
});

test('migrate(null, v1): settings, practice, perform, legacy extras and seeded notes', () => {
  const { state, backup } = Store.migrate(null, V1, { now: NOW, songs: SONGS });
  assert.equal(backup, undefined);
  assert.equal(state.v, 2);
  assert.equal(state.migratedFrom, 1);
  assert.equal(state.settings.labels, 'never');
  assert.equal(state.slices.practice.songs.mary.stars, 3);
  assert.deepEqual(state.slices.practice.songs.mary.best, { mistakes: 0, at: 1 });
  assert.equal(state.slices.practice.songs.mary.plays, 1);
  assert.equal(state.slices.perform.perf.mary['75'].score, 900);
  assert.equal(state.slices.perform.speed, 50);
  assert.equal(state.slices.perform.clickTrack, true);
  assert.equal(state.slices.perform.latency, null);
  assert.equal(state.slices.legacyExtra.best.x, 1);
  // mary uses C, D, E and G, so units 0-3 are introduced as learning
  assert.deepEqual(Object.keys(state.notes).sort(), ['C4', 'D4', 'E4', 'F4', 'G4']);
  for (const k of ['C4', 'D4', 'E4', 'F4', 'G4']) {
    assert.equal(M.state(state.notes[k]), 'learning', k);
    assert.equal(state.notes[k].seen, 4);
    assert.equal(state.notes[k].n, 4);
    assert.equal(state.notes[k].intro, TODAY);
  }
  for (const k of ['C4', 'D4', 'E4', 'G4']) assert.equal(state.notes[k].acc, 0.75, `${k} is in a clean song`);
  assert.equal(state.notes.F4.acc, 0.65, 'F4 was introduced by unit but is in no finished song (§4.2 code)');
  assert.equal(state.course.unit, 4);
  assert.equal(state.course.checkDone, false);
  assert.equal(state.slices.byear.practiceSecs, 120, 'new slices default in');
});

test('migrate: v1 stars, names on, missing perform fields, and songs with notes outside the course', () => {
  const v1 = JSON.stringify({ done: { mary: { mistakes: 2, at: 5 }, frere: { mistakes: 7, at: 6 }, gone: { mistakes: 0, at: 7 } }, names: true });
  const { state } = Store.migrate(null, v1, { now: NOW, songs: SONGS });
  assert.equal(state.settings.labels, 'auto');
  assert.equal(state.slices.practice.songs.mary.stars, 2);
  assert.equal(state.slices.practice.songs.frere.stars, 1);
  assert.equal(state.slices.practice.songs.gone.stars, 3, 'unknown ids keep their result');
  assert.deepEqual(state.slices.perform, { perf: {}, speed: 75, clickTrack: true, latency: null });
  // frere reaches A4 (unit 4) and G3 (outside the course, ignored)
  assert.equal(state.course.unit, 5);
  assert.equal(state.notes.G3, undefined);
  assert.equal(state.notes.A4.acc, 0.65);
  assert.equal(state.notes.C4.acc, 0.65, 'no song finished cleanly');
});

test('migrate: a v1 save with nothing finished seeds no notes and needs no check', () => {
  const { state } = Store.migrate(null, '{"names":true,"perf":{"ode":{"50":{"score":10}}}}', { now: NOW, songs: SONGS });
  assert.equal(state.migratedFrom, 1);
  assert.deepEqual(state.notes, {});
  assert.equal(state.course.unit, 0);
  assert.equal(state.course.checkDone, true);
  assert.equal(state.slices.perform.perf.ode['50'].score, 10);
});

test('migrate never changes the v1 string (rollback stays possible)', () => {
  const copy = String(V1);
  Store.migrate(null, copy, { now: NOW, songs: SONGS });
  assert.equal(copy, V1);
});

test('migrate(validV2, anything) returns v2 with defaults deep-merged', () => {
  const partial = {
    v: 2, created: 123, migratedFrom: 1,
    settings: { labels: 'always' },
    course: { unit: 3, checkDone: false },
    notes: { C4: { acc: 0.9, seen: 9 } },
    slices: { practice: { songs: { ode: { plays: 4 } } }, perform: { perf: { ode: { 75: { score: 5 } } }, speed: 100 }, custom: { a: 1 } },
  };
  const { state, backup } = Store.migrate(JSON.stringify(partial), V1, { now: NOW, songs: SONGS });
  assert.equal(backup, undefined);
  assert.equal(state.created, 123);
  assert.equal(state.settings.labels, 'always');
  assert.equal(state.settings.shapes, 'auto');
  assert.deepEqual(state.settings.firstRun, { sound: false, mic: false });
  assert.equal(state.course.unit, 3);
  assert.equal(state.course.checkDone, false);
  assert.equal(state.course.checkSnoozeUntil, null);
  assert.equal(state.notes.C4.acc, 0.9);
  assert.equal(state.notes.C4.box, 0, 'note records get every field');
  assert.deepEqual(state.notes.C4.conf, {});
  assert.equal(state.slices.practice.songs.ode.plays, 4);
  assert.deepEqual(state.slices.practice.listen, { speed: 1, scope: 'whole' });
  assert.equal(state.slices.perform.perf.ode['75'].score, 5);
  assert.equal(state.slices.perform.speed, 100);
  assert.equal(state.slices.perform.clickTrack, true);
  assert.deepEqual(state.slices.byear, { best: {}, practiceSecs: 120, speed: 1 });
  assert.equal(state.slices.ear.settings.tempoPct, 100);
  assert.deepEqual(state.slices.custom, { a: 1 }, 'unknown slices are kept');
  assert.equal(state.slices.practice.songs.mary, undefined, 'v1 is not looked at when v2 exists');
});

test('migrate(badV2, v1) keeps a backup and falls back to the v1 migration', () => {
  for (const bad of ['{bad', '[1,2]', '"text"', 'null', '5']) {
    const { state, backup } = Store.migrate(bad, V1, { now: NOW, songs: SONGS });
    assert.equal(backup, bad);
    assert.equal(state.v, 2);
    assert.equal(state.migratedFrom, 1);
    assert.equal(state.slices.perform.perf.mary['75'].score, 900);
  }
  const r = Store.migrate('{bad', null, { now: NOW });
  assert.equal(r.backup, '{bad');
  assert.deepEqual(r.state, Store.fresh(NOW));
});

test('migrate(null, null) returns fresh with checkDone true and unit 0', () => {
  const { state, backup } = Store.migrate(null, null, { now: NOW, songs: SONGS });
  assert.equal(backup, undefined);
  assert.deepEqual(state, Store.fresh(NOW));
  assert.equal(state.course.checkDone, true);
  assert.equal(state.course.unit, 0);
  assert.deepEqual(Store.migrate(null, '{bad v1', { now: NOW }).state, Store.fresh(NOW), 'unreadable v1 -> fresh');
});

test('a migrated state round-trips through JSON as a valid v2', () => {
  const a = Store.migrate(null, V1, { now: NOW, songs: SONGS }).state;
  const b = Store.migrate(JSON.stringify(a), null, { now: NOW + 1000, songs: SONGS });
  assert.equal(b.backup, undefined);
  assert.deepEqual(b.state, a);
});

test('deepMerge: over wins, arrays replace, base fills gaps, inputs untouched', () => {
  const base = { a: 1, b: { c: 2, d: [1, 2] }, e: { f: 1 } };
  const over = { b: { d: [3] }, e: null, g: 4 };
  const out = Store.deepMerge(base, over);
  assert.deepEqual(out, { a: 1, b: { c: 2, d: [3] }, e: null, g: 4 });
  assert.deepEqual(base, { a: 1, b: { c: 2, d: [1, 2] }, e: { f: 1 } });
});

// The real library, when songs.js loads in Node.
let real = null;
try { real = require('../songs.js'); } catch { real = null; }
test('migrate with the real library', { skip: !real && 'songs.js not loadable' }, () => {
  const { state } = Store.migrate(null, V1, { now: NOW, songs: real.songs });
  assert.deepEqual(Object.keys(state.notes).sort(), ['C4', 'D4', 'E4', 'F4', 'G4']);
  assert.equal(state.course.unit, 4);
  assert.equal(state.course.checkDone, false);
});
