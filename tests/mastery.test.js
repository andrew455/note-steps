// WP3: per-note mastery rules (spec §3.2.2-§3.2.5, test plan §5.1).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../core/mastery.js');
const Util = require('../core/util.js');

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 21, 12);
const day = (n) => NOW + (n - 1) * DAY; // day(1) = NOW
const read = (extra = {}) => Object.assign({ outcome: 'read', source: 'song', rtMs: 1200, confident: true }, extra);

function apply(rec, evs, now) {
  for (const ev of evs) rec = M.record(rec, ev, now).rec;
  return rec;
}
const times = (n, ev) => Array.from({ length: n }, () => ev);

test('newRecord starts new, at acc 0.5, due today', () => {
  const r = M.newRecord('2026-10-21');
  assert.equal(M.state(r), 'new');
  assert.equal(r.acc, 0.5);
  assert.equal(r.due, '2026-10-21');
  assert.equal(r.day, null);
  assert.equal(M.state(undefined), 'locked');
});

test('songFactor', () => {
  assert.equal(M.songFactor(0), 1);
  assert.equal(M.songFactor(2), 1);
  assert.equal(M.songFactor(3), 0.7);
  assert.equal(M.songFactor(5), 0.7);
  assert.equal(M.songFactor(6), 0.5);
});

test('record is pure: the input record is not changed', () => {
  const r0 = M.newRecord(Util.dayKey(NOW));
  const snap = JSON.stringify(r0);
  const { rec } = M.record(r0, read({ playedKey: 'F4', outcome: 'miss' }), NOW);
  assert.equal(JSON.stringify(r0), snap);
  assert.notEqual(rec, r0);
  assert.equal(rec.conf.F4, 1);
});

test('12 fast reads on day 1 never give known (box 0)', () => {
  let r = M.newRecord(Util.dayKey(day(1)));
  r = apply(r, times(12, read()), day(1));
  assert.equal(r.box, 0);
  assert.equal(r.k, 0);
  assert.equal(M.state(r), 'learning');
  assert.ok(r.acc > 0.9 && r.streak === 12 && r.reads === 12 && r.rt <= 3000);
});

test('good days on day 1 and day 3 give box 2, then known when acc, streak and rt hold', () => {
  let r = M.newRecord(Util.dayKey(day(1)));
  r = apply(r, times(12, read()), day(1));
  r = apply(r, times(4, read()), day(3)); // rolling day 1 -> box 1, due day 2
  assert.equal(r.box, 1);
  assert.equal(r.k, 0);
  const out = M.record(r, read(), day(4)); // rolling day 3 (>= due) -> box 2 -> known
  assert.equal(out.rec.box, 2);
  assert.equal(out.rec.k, 1);
  assert.equal(out.change, 'known');
  assert.equal(M.state(out.rec), 'known');
  assert.equal(out.rec.knownAt, day(4));
  assert.equal(out.rec.due, Util.addDays(Util.dayKey(day(3)), 2));
});

test('cramming 30 reads before due does not promote twice', () => {
  let r = M.newRecord(Util.dayKey(day(1)));
  r = apply(r, times(30, read()), day(1));
  r = M.rollDay(JSON.parse(JSON.stringify(r)), day(2));
  assert.equal(r.box, 1, 'one good day is one box, however many reads');
  // Box 2 after day 2, due day 4. Cram on day 3 (before due): rolling it does not move the box.
  r = apply(r, times(5, read()), day(2));
  r = apply(r, times(30, read()), day(3));
  assert.equal(r.box, 2);
  assert.equal(r.due, Util.dayKey(day(4)));
  r = M.record(r, read(), day(4)).rec;
  assert.equal(r.box, 2, 'day 3 was before due');
});

function knownRecord() {
  let r = M.newRecord(Util.dayKey(day(1)));
  r = apply(r, times(12, read()), day(1));
  r = apply(r, times(4, read()), day(3));
  r = M.record(r, read(), day(4)).rec;
  assert.equal(r.k, 1);
  return r;
}

test('a lapse day (2 reads, 3 misses) gives box - 2 and demotes a known note', () => {
  let r = knownRecord();
  const miss = { outcome: 'miss', source: 'song', confident: true, playedKey: 'F4' };
  r = apply(r, [miss, read(), miss, read(), miss], day(6));
  assert.ok(r.acc >= 0.6, `still above the acc floor (${r.acc})`);
  assert.equal(r.k, 1, 'acc alone did not demote');
  assert.equal(r.conf.F4, 3);
  const out = M.record(r, read(), day(7));
  assert.equal(out.rec.box, 0);
  assert.equal(out.rec.k, 0);
  assert.equal(out.change, 'unknown');
  assert.equal(out.rec.due, Util.addDays(Util.dayKey(day(6)), 1));
});

test('known demotes when acc falls below 0.6', () => {
  let r = knownRecord();
  const miss = { outcome: 'miss', source: 'song', confident: true };
  let change = null;
  for (let i = 0; i < 6 && !change; i++) ({ rec: r, change } = M.record(r, miss, day(4)));
  assert.equal(change, 'unknown');
  assert.ok(r.acc < 0.6);
});

test('assisted-only play levels off at acc 0.7 and is never known', () => {
  let r = M.newRecord(Util.dayKey(day(1)));
  for (let d = 1; d <= 10; d++) r = apply(r, times(10, { outcome: 'assisted', source: 'song', rtMs: 900 }), day(d));
  assert.ok(Math.abs(r.acc - 0.7) <= 0.03, `acc ${r.acc}`);
  assert.equal(r.k, 0);
  assert.equal(r.streak, 0);
  assert.equal(r.reads, 0);
  assert.equal(r.asst, 100);
});

test('a miss with confident:false changes nothing', () => {
  const r0 = apply(M.newRecord(Util.dayKey(NOW)), [read(), read()], NOW);
  const { rec, change } = M.record(r0, { outcome: 'miss', source: 'song', confident: false, playedKey: 'G4' }, NOW);
  assert.equal(change, null);
  for (const k of ['acc', 'n', 'seen', 'streak', 'miss', 'last']) assert.equal(rec[k], r0[k], k);
  assert.deepEqual(rec.conf, {});
});

test('ear and free sources raise seen only', () => {
  for (const source of ['ear', 'free']) {
    const r0 = M.newRecord(Util.dayKey(NOW));
    const r = apply(r0, times(5, read({ source })), NOW);
    assert.equal(r.seen, 5);
    assert.equal(r.acc, 0.5);
    assert.equal(r.n, 0);
    assert.equal(r.streak, 0);
    assert.equal(r.reads, 0);
    assert.equal(M.state(r), 'learning', 'seen drives new -> learning');
  }
});

test('repeat halves the weight and does not extend the streak', () => {
  const a = M.record(M.newRecord(Util.dayKey(NOW)), read(), NOW).rec;
  const b = M.record(M.newRecord(Util.dayKey(NOW)), read({ repeat: true }), NOW).rec;
  assert.equal(a.n, 1);
  assert.equal(b.n, 0.5);
  assert.ok(Math.abs((b.acc - 0.5) * 2 - (a.acc - 0.5)) < 1e-9);
  assert.equal(a.streak, 1);
  assert.equal(b.streak, 0);
  assert.equal(b.reads, 0);
});

test('weights: hear 0.6, perform 0.5, song plays factor, assisted half', () => {
  const n = (ev) => M.record(M.newRecord(Util.dayKey(NOW)), ev, NOW).rec.n;
  assert.equal(n(read({ source: 'hear' })), 0.6);
  assert.equal(n(read({ source: 'perform' })), 0.5);
  assert.equal(n(read({ songPlays: 4 })), 0.7);
  assert.equal(n(read({ songPlays: 9 })), 0.5);
  assert.equal(n({ outcome: 'assisted', source: 'song' }), 0.5);
  assert.equal(n({ outcome: 'read', source: 'mystery' }), 0);
});

test('rt: first token and very slow answers are not timed; long ones are capped at 8 s', () => {
  let r = M.record(M.newRecord(Util.dayKey(NOW)), read({ rtMs: 900, firstToken: true }), NOW).rec;
  assert.equal(r.rt, null);
  r = M.record(r, read({ rtMs: 20000 }), NOW).rec;
  assert.equal(r.rt, null);
  r = M.record(r, read({ rtMs: 2000 }), NOW).rec;
  assert.equal(r.rt, 2000);
  r = M.record(r, read({ rtMs: 12000 }), NOW).rec;
  assert.equal(r.rt, 2000 + 0.25 * (8000 - 2000));
});

test('rollDay: a new day resets the day tally; the clock going backwards changes nothing', () => {
  let r = apply(M.newRecord(Util.dayKey(day(2))), times(3, read()), day(2));
  assert.deepEqual(r.day, { d: Util.dayKey(day(2)), r: 3, m: 0 });
  const back = M.rollDay(JSON.parse(JSON.stringify(r)), day(1));
  assert.deepEqual(back.day, r.day);
  assert.equal(back.box, 0);
});

test('labelDelay', () => {
  const rec = (o) => Object.assign(M.newRecord('2026-10-21'), o);
  const ctx = { labels: 'auto' };
  assert.equal(M.labelDelay(rec({ seen: 0 }), ctx), 0);
  assert.equal(M.labelDelay(rec({ seen: 3 }), ctx), 1000);
  assert.equal(M.labelDelay(rec({ seen: 6, acc: 0.5 }), ctx), 1500);
  assert.equal(M.labelDelay(rec({ seen: 6, acc: 0.7 }), ctx), 3000);
  assert.equal(M.labelDelay(rec({ seen: 6, acc: 0.9 }), ctx), 5000);
  assert.equal(M.labelDelay(rec({ seen: 20, k: 1 }), ctx), Infinity);
  assert.equal(M.labelDelay(rec({ seen: 20, k: 1 }), { labels: 'auto', refresh: 1 }), 0);
  assert.equal(M.labelDelay(rec({ seen: 6 }), { labels: 'never' }), Infinity);
  assert.equal(M.labelDelay(rec({ seen: 20, k: 1 }), { labels: 'always' }), 0);
  assert.equal(M.labelDelay(undefined, ctx), 0, 'locked notes always show their name');
  assert.equal(M.labelDelay(rec({ seen: 6, acc: 0.9 }), { labels: 'auto', guard: true }), 0);
  assert.equal(M.labelDelay(rec({ seen: 3 }), { labels: 'auto', guard: true }), 1000);
});

test('rusty the day after due, and only for known notes', () => {
  const r = Object.assign(M.newRecord('2026-10-21'), { k: 1, seen: 20, due: '2026-10-21' });
  assert.equal(M.rusty(r, NOW), false);
  assert.equal(M.rusty(r, NOW + DAY), true);
  assert.equal(M.rusty(Object.assign({}, r, { k: 0 }), NOW + DAY), false);
  assert.equal(M.rusty(undefined, NOW), false);
  assert.equal(M.fam(r, NOW), 1);
  assert.equal(M.fam(r, NOW + DAY), 0.9);
});

test('pct and fam', () => {
  const r = M.newRecord('2026-10-21');
  assert.equal(M.pct(r), 25);
  assert.equal(M.pct(Object.assign({}, r, { acc: 1, streak: 5, box: 2, rt: 2000 })), 100);
  assert.equal(M.pct(undefined), 0);
  assert.equal(M.fam(undefined, NOW), 0);
  assert.equal(M.fam(r, NOW), 0.4);
  assert.equal(M.fam(Object.assign({}, r, { seen: 5, acc: 0.5 }), NOW), 0.7);
});
