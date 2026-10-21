// WP0 skeleton: every pure (UMD) module loads in Node with its final API, and the moved listener
// still turns piano-like plucks into notes with the v1 rule. Owners replace stubs; keep this passing.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Pitch = require('../pitch.js');

const API = {
  '../core/util.js': ['dayKey', 'addDays', 'daysBetween', 'mulberry32', 'median', 'clamp01', 'clamp', 'pc', 'hash'],
  '../core/listener.js': ['create', 'refineOnset'],
  '../core/notation.js': ['parseToken', 'parseMelody', 'autoPhrases', 'noteKey', 'fromKey', 'samePitchClass', 'spellMidi', 'foldToRange', 'placeOnStaff', 'describePosition'],
  '../core/shapes.js': ['classify', 'statKey', 'typeLevel', 'pairLevel', 'updateStat', 'describe', 'rescueText'],
  '../core/mastery.js': ['newRecord', 'songFactor', 'rollDay', 'record', 'state', 'rusty', 'labelDelay', 'pct', 'fam'],
  '../core/curriculum.js': ['songLevel', 'songDiff', 'comfort', 'introGate', 'introduce', 'recommend', 'nextStep', 'genPhrase', 'readingRun', 'flashDeck', 'placementOrder'],
  '../core/store.js': ['fresh', 'migrate'],
  '../modes/ear-core.js': ['findRepeats', 'buildChunkPlan', 'chunkKey', 'makeMatcher', 'judgeRhythm', 'scheduleReview', 'fingering', 'unlocks'],
  '../modes/freeplay-core.js': [],
  '../modes/byear-core.js': ['align'],
};

for (const [file, fns] of Object.entries(API)) {
  test(`${file} loads in Node with its API`, () => {
    const mod = require(file);
    assert.equal(typeof mod, 'object');
    for (const fn of fns) assert.equal(typeof mod[fn], 'function', `${file} exports ${fn}()`);
  });
}

test('curriculum tables cover C4..G5 in 11 units', () => {
  const C = require('../core/curriculum.js');
  assert.equal(C.UNITS.length, 11);
  assert.deepEqual(Object.keys(C.UNIT_OF), ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G5']);
  assert.ok(C.UNITS.every((u) => u.notes.length <= 2));
});

test('notation parses naturals exactly like Pitch.parseNote', () => {
  const N = require('../core/notation.js');
  for (const tok of ['C4', 'E4:h', 'D4:q.', 'G3', 'C6:w', 'A4:e']) {
    const a = N.parseToken(tok);
    const b = Pitch.parseNote(tok);
    for (const k of ['letter', 'midi', 'staffPos', 'dur', 'beats']) assert.equal(a[k], b[k], `${tok} ${k}`);
  }
  assert.equal(N.foldToRange(48, 60, 76), 60);
  assert.equal(N.foldToRange(84, 60, 76), 72);
});

test('store: fresh, and migrate of a v1 save (no note seeding in WP0)', () => {
  const Store = require('../core/store.js');
  const now = Date.UTC(2026, 9, 21, 12);
  const f = Store.fresh(now);
  assert.equal(f.v, 2);
  assert.equal(f.course.unit, 0);
  assert.equal(f.course.checkDone, true);
  assert.deepEqual(f.slices.byear, { best: {}, practiceSecs: 120, speed: 1 });
  const v1 = '{"done":{"mary":{"mistakes":0,"at":1}},"names":false,"perf":{"mary":{"75":{"score":900,"stars":2}}},"speed":50,"best":{"x":1}}';
  const { state } = Store.migrate(null, v1, { now, songs: [] });
  assert.equal(state.settings.labels, 'never');
  assert.equal(state.slices.practice.songs.mary.stars, 3);
  assert.equal(state.slices.perform.perf.mary['75'].score, 900);
  assert.equal(state.slices.perform.speed, 50);
  assert.equal(state.slices.legacyExtra.best.x, 1);
  const bad = Store.migrate('{bad', null, { now });
  assert.equal(bad.backup, '{bad');
  assert.equal(bad.state.v, 2);
});

// ---------- listener: synthesized plucks fed every 25 ms, like the browser's analyser ----------
const SR = 44100;
const N = 2048;
function render(events, totalSec) {
  const sig = new Float32Array(Math.round(totalSec * SR));
  let seed = 12345;
  const noise = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296 - 0.5; };
  for (let i = 0; i < sig.length; i++) sig[i] = 0.0006 * noise();
  for (const { midi, at } of events) {
    const f0 = Pitch.midiToFreq(midi);
    const s0 = Math.round(at * SR);
    for (let i = s0; i < sig.length; i++) {
      const t = (i - s0) / SR;
      const env = Math.exp(-t / 0.6) * Math.min(1, t / 0.004);
      sig[i] += 0.3 * env * (Math.sin(2 * Math.PI * f0 * t) + 0.5 * Math.sin(4 * Math.PI * f0 * t) + 0.25 * Math.sin(6 * Math.PI * f0 * t));
    }
  }
  return sig;
}
function run(sig, mutedUntilSec = -1) {
  const L = require('../core/listener.js').create({ detectPitch: Pitch.detectPitch, freqToMidi: Pitch.freqToMidi });
  const out = [];
  for (let end = N; end <= sig.length; end += Math.round(0.025 * SR)) {
    const t = end / SR;
    out.push(...L.process(sig.subarray(end - N, end), t * 1000, t, SR, t < mutedUntilSec));
  }
  return out;
}

test('listener: one C4 pluck gives one note with an accurate onset', () => {
  const ev = run(render([{ midi: 60, at: 0.5 }], 1.5));
  const notes = ev.filter((e) => e.type === 'note');
  assert.equal(notes.length, 1);
  assert.equal(notes[0].midi, 60);
  assert.equal(notes[0].reason, 'agree');
  assert.ok(Math.abs(notes[0].at - 0.5) < 0.02, `onset at ${notes[0].at}`);
  assert.ok(ev.some((e) => e.type === 'onset'));
  assert.ok(ev.filter((e) => e.type === 'level').length > 10);
});

test('listener: repeated E4 plucks 500 ms apart each count', () => {
  const ev = run(render([{ midi: 64, at: 0.3 }, { midi: 64, at: 0.8 }, { midi: 64, at: 1.3 }], 2.2));
  assert.deepEqual(ev.filter((e) => e.type === 'note').map((e) => e.midi), [64, 64, 64]);
});

test('listener: muted frames give no notes', () => {
  const ev = run(render([{ midi: 67, at: 0.3 }], 1.5), 1.5);
  assert.equal(ev.filter((e) => e.type === 'note').length, 0);
});

test('listener: noise alone gives no notes', () => {
  const ev = run(render([], 3));
  assert.equal(ev.filter((e) => e.type === 'note').length, 0);
});
