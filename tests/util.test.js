// core/util.js (WP0).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Util = require('../core/util.js');

test('dayKey uses a 4 am cutoff in local time', () => {
  const at = (h, m = 0) => new Date(2026, 9, 21, h, m).getTime();
  assert.equal(Util.dayKey(at(12)), '2026-10-21');
  assert.equal(Util.dayKey(at(3, 59)), '2026-10-20');
  assert.equal(Util.dayKey(at(4, 0)), '2026-10-21');
});

test('addDays and daysBetween cross months and years', () => {
  assert.equal(Util.addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(Util.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(Util.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(Util.daysBetween('2026-10-21', '2026-11-04'), 14);
  assert.equal(Util.daysBetween('2026-11-04', '2026-10-21'), -14);
});

test('mulberry32 is deterministic and in [0, 1)', () => {
  const a = Util.mulberry32(1);
  const b = Util.mulberry32(1);
  for (let i = 0; i < 1000; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
  assert.notEqual(Util.mulberry32(2)(), Util.mulberry32(1)());
});

test('median, clamp, clamp01, pc', () => {
  assert.equal(Util.median([3, 1, 2]), 2);
  assert.equal(Util.median([4, 1, 3, 2]), 2.5);
  assert.ok(Number.isNaN(Util.median([])));
  assert.equal(Util.clamp(5, 0, 3), 3);
  assert.equal(Util.clamp01(-1), 0);
  assert.equal(Util.pc(60), 0);
  assert.equal(Util.pc(-1), 11);
});

test('hash is 8-char FNV-1a hex', () => {
  assert.equal(Util.hash(''), '811c9dc5');
  assert.equal(Util.hash('a'), 'e40c292c');
  assert.match(Util.hash('twinkle'), /^[0-9a-f]{8}$/);
});
