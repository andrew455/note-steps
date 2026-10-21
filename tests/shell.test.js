// WP5: the shell's pure helpers (router parsing, library grouping and filters, Home card rules).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Shell = require('../core/shell.js');
const C = require('../core/curriculum.js');

const now = Date.UTC(2026, 9, 21, 12);
const DAY = 86400000;

test('parseRoute: home, modes, args, queries and encoded ids', () => {
  assert.equal(Shell.parseRoute('').modeId, 'home');
  assert.equal(Shell.parseRoute('#').route, '#/');
  assert.equal(Shell.parseRoute('#/').modeId, 'home');
  const p = Shell.parseRoute('#/practice/mary?from=ear');
  assert.equal(p.modeId, 'practice');
  assert.equal(p.arg, 'mary');
  assert.equal(p.query.get('from'), 'ear');
  assert.equal(p.route, '#/practice/mary?from=ear');
  const d = Shell.parseRoute('#/drill?meet=F4,G4');
  assert.equal(d.modeId, 'drill');
  assert.equal(d.arg, null);
  assert.equal(d.query.get('meet'), 'F4,G4');
  assert.equal(Shell.parseRoute('#/songs/perform').arg, 'perform');
  assert.equal(Shell.parseRoute('#/ear/room').arg, 'room');
  assert.equal(Shell.parseRoute('#/practice/fr%C3%A8re').arg, 'frère');
  assert.equal(Shell.parseRoute('#/practice/%E0%A4%A').arg, '%E0%A4%A', 'a bad escape does not throw');
  assert.equal(Shell.parseRoute('practice/run?seed=3').query.get('seed'), '3');
});

const song = (id, keys, extra) => Object.assign({ id, title: id, keys }, extra);

test('stageOf: from song.stage, else from Curriculum.songLevel and UNITS', () => {
  assert.equal(Shell.stageOf({ stage: 3 }, C), 3);
  assert.equal(Shell.stageOf({ stage: 'extra' }, C), 'extra');
  assert.equal(Shell.stageOf(song('hcb', ['E4', 'D4', 'C4']), C), 1);
  assert.equal(Shell.stageOf(song('mary', ['E4', 'D4', 'C4', 'G4']), C), 2);
  assert.equal(Shell.stageOf(song('twinkle', ['C4', 'G4', 'A4', 'F4', 'E4', 'D4']), C), 3);
  assert.equal(Shell.stageOf(song('bday', ['G4', 'G5']), C), 4);
  assert.equal(Shell.stageOf(song('frere', ['C4', 'G3']), C), 'extra');
  assert.equal(Shell.stageOf({ unit: 6 }, C), 3);
});

test('songKeys: song.keys, else distinct keys from notes', () => {
  assert.deepEqual(Shell.songKeys({ keys: ['C4'] }), ['C4']);
  assert.deepEqual(Shell.songKeys({ notes: [{ letter: 'E', midi: 64 }, { letter: 'D', midi: 62 }, { letter: 'E', midi: 64 }, { letter: 'G', midi: 55 }] }), ['E4', 'D4', 'G3']);
  assert.deepEqual(Shell.songKeys(null), []);
});

test('groupByStage: stage order, extras last, empty groups dropped, titles per spec', () => {
  const songs = [song('a', ['C4', 'G3']), song('b', ['C4', 'G4']), song('c', ['C4']), song('d', ['C4', 'D4', 'E4'])];
  const g = Shell.groupByStage(songs, (s) => Shell.stageOf(s, C), C.STAGES);
  assert.deepEqual(g.map((x) => x.key), [1, 2, 'extra']);
  assert.equal(g[0].title, 'Stage 1 · Middle C home');
  assert.equal(g[1].title, 'Stage 2 · Up to G');
  assert.equal(g[2].title, 'Extras (beyond this course)');
  assert.deepEqual(g[0].songs.map((s) => s.id), ['c', 'd'], 'keeps library order inside a group');
});

test('filters: tags, Little steps, all', () => {
  assert.deepEqual(Shell.FILTERS.map((f) => f.label), ['All', 'Folk', 'Classical', 'Holiday', 'Little steps']);
  const folk = { id: 'x', tags: ['folk', 'kids'] };
  const et = { id: 'etude-u3-1' };
  assert.ok(Shell.matchesFilter(folk, 'all'));
  assert.ok(Shell.matchesFilter(folk, 'folk'));
  assert.ok(!Shell.matchesFilter(folk, 'holiday'));
  assert.ok(!Shell.matchesFilter(folk, 'steps'));
  assert.ok(Shell.matchesFilter(et, 'steps'));
  assert.ok(Shell.isEtude({ id: 'y', kind: 'etude' }));
  assert.ok(!Shell.isEtude({ id: 'mary', kind: 'song' }));
  assert.ok(!Shell.matchesFilter({ id: 'z' }, 'folk'), 'no tags matches no tag filter');
});

test('practiceAvailable: all notes introduced (level < course.unit); extras always', () => {
  assert.equal(Shell.practiceAvailable(3, 4), true);
  assert.equal(Shell.practiceAvailable(3, 3), false);
  assert.equal(Shell.practiceAvailable(0, 0), false, 'a new user has nothing open yet');
  assert.equal(Shell.practiceAvailable(Infinity, 0), true, 'extras are always available');
});

test('noteCheckVisible: only after a v1 migration, hidden for 7 days after Not now', () => {
  assert.equal(Shell.noteCheckVisible({ checkDone: true }, now), false);
  assert.equal(Shell.noteCheckVisible({ checkDone: false, checkSnoozeUntil: null }, now), true);
  const until = Shell.snoozeUntil(now);
  assert.equal(until, now + 7 * DAY);
  assert.equal(Shell.noteCheckVisible({ checkDone: false, checkSnoozeUntil: until }, now + 6 * DAY), false);
  assert.equal(Shell.noteCheckVisible({ checkDone: false, checkSnoozeUntil: until }, now + 7 * DAY + 1), true);
  assert.equal(Shell.noteCheckVisible(null, now), false);
});

test('quickDrillKeys: new, rusty, or learning below 80%', () => {
  const info = {
    C4: { state: 'known', acc: 0.95, rusty: false },
    D4: { state: 'known', acc: 0.9, rusty: true },
    E4: { state: 'learning', acc: 0.85 },
    F4: { state: 'learning', acc: 0.7 },
    G4: { state: 'new', acc: 0.5 },
  };
  assert.deepEqual(Shell.quickDrillKeys(Object.keys(info), (k) => info[k]), ['D4', 'F4', 'G4']);
  assert.deepEqual(Shell.quickDrillKeys([], () => ({})), []);
});

test('summaryText: the today strip line', () => {
  assert.equal(Shell.summaryText({ known: 7, learning: 2, new: 0 }), '7 notes known · 2 learning');
  assert.equal(Shell.summaryText({ known: 1, learning: 0 }), '1 note known');
  assert.equal(Shell.summaryText({ known: 0, learning: 0, new: 2 }), '2 new notes');
  assert.equal(Shell.summaryText({ known: 0, learning: 0, new: 1 }), '1 new note');
  assert.equal(Shell.summaryText({ known: 0, learning: 3, new: 1 }), '3 learning · 1 new');
  assert.equal(Shell.summaryText({ known: 4, learning: 0, rusty: 1 }), '4 notes known · 1 to review');
  assert.equal(Shell.summaryText({ known: 0, learning: 0, new: 0 }), null, 'new user: Home shows the first-notes line');
});

test('songsForYou: recommendation first, then best by score, no repeats, at most 5', () => {
  const s = (id) => ({ id });
  const pool = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(s);
  const score = { a: 0.1, b: 0.9, c: 0.5, d: 0.5, e: 0.2, f: 0.8, g: 0 };
  const rec = { kind: 'song', song: s('c'), alts: [s('g'), s('c')] };
  const out = Shell.songsForYou(rec, pool, (x) => score[x.id], 5).map((x) => x.id);
  assert.deepEqual(out, ['c', 'g', 'b', 'f', 'd']);
  assert.deepEqual(Shell.songsForYou({ kind: 'run' }, pool.slice(0, 2), (x) => score[x.id]).map((x) => x.id), ['b', 'a']);
  assert.deepEqual(Shell.songsForYou(null, [], () => 0), []);
});

test('comfortScore: just right (0.92) ranks above easy and tough; unplayed a little ahead', () => {
  const right = Shell.comfortScore({ C: 0.92 }, 0);
  const easy = Shell.comfortScore({ C: 1 }, 0);
  const tough = Shell.comfortScore({ C: 0.6 }, 0);
  assert.ok(right > easy && easy > tough);
  assert.ok(Shell.comfortScore({ C: 0.9 }, 0) > Shell.comfortScore({ C: 0.9 }, 3));
  assert.ok(Number.isFinite(Shell.comfortScore(null, 0)));
});

test('back stack: push, pop on going back, Home resets', () => {
  let st = [];
  st = Shell.nextStack(st, '#/');
  st = Shell.nextStack(st, '#/songs/practice');
  st = Shell.nextStack(st, '#/practice/mary');
  assert.equal(Shell.backTarget(st), '#/songs/practice');
  st = Shell.nextStack(st, '#/songs/practice');
  assert.deepEqual(st, ['#/', '#/songs/practice']);
  assert.equal(Shell.backTarget(st), '#/');
  st = Shell.nextStack(st, '#/songs/practice');
  assert.deepEqual(st, ['#/', '#/songs/practice'], 'a re-render of the same route does not push');
  st = Shell.nextStack(st, '#/');
  assert.deepEqual(st, ['#/']);
  assert.equal(Shell.backTarget(['#/perform/ode']), '#/', 'a deep link goes back Home');
  assert.equal(Shell.backTarget([]), '#/');
  let long = [];
  for (let i = 0; i < 80; i++) long = Shell.nextStack(long, '#/x/' + i);
  assert.equal(long.length, 50);
});
