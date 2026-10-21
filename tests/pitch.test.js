// pitch.js (frozen) as the listener uses it: YIN on 2048-sample frames of piano-like plucks (spec §5.1).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Pitch = require('../pitch.js');
const Synth = require('./synth.js');

const SR = Synth.SR;
const N = 2048;

function sine(freq, sr, n) {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = 0.4 * Math.sin((2 * Math.PI * freq * i) / sr);
  return buf;
}
const cents = (f, midi) => 1200 * Math.log2(f / Pitch.midiToFreq(midi));
// One 2048-sample frame starting `afterMs` after the attack of a single pluck.
function frameAfterAttack(pluck, afterMs = 80, noiseDb = -50, seed = 1) {
  const sig = Synth.render([Object.assign({ at: 0.1 }, pluck)], SR, { length: 0.5, noiseDb, seed });
  const s0 = Math.round((0.1 + afterMs / 1000) * SR);
  return sig.subarray(s0, s0 + N);
}

test('detectPitch finds A4 in a 440 Hz sine', () => {
  const f = Pitch.detectPitch(sine(440, SR, N), SR, 70, 1400);
  assert.ok(f, 'a pitch was found');
  assert.ok(Math.abs(1200 * Math.log2(f / 440)) < 10, `within 10 cents (got ${f.toFixed(2)} Hz)`);
  assert.equal(Math.round(Pitch.freqToMidi(f)), 69);
});

test('detectPitch returns null for silence', () => {
  assert.equal(Pitch.detectPitch(new Float32Array(N), SR, 70, 1400), null);
});

test('detectPitch on plucks 80 ms after the attack, midi 55..84: 30 cents in >= 95%, pitch class always', () => {
  let within = 0;
  let total = 0;
  const misses = [];
  for (let midi = 55; midi <= 84; midi++) {
    const f = Pitch.detectPitch(frameAfterAttack({ midi }, 80, -50, midi), SR, 70, 1400);
    total++;
    assert.ok(f, `a pitch for midi ${midi}`);
    const m = Pitch.freqToMidi(f);
    assert.equal(((Math.round(m) % 12) + 12) % 12, midi % 12, `pitch class of midi ${midi} (got ${m.toFixed(2)})`);
    if (Math.abs(cents(f, midi)) <= 30) within++;
    else misses.push(`${midi}: ${cents(f, midi).toFixed(1)}c`);
  }
  assert.ok(within / total >= 0.95, `within 30 cents: ${within}/${total} (${misses.join(', ')})`);
});

test('detectPitch keeps the pitch class when the 2nd partial is louder than the fundamental', () => {
  for (const midi of [55, 60, 64, 67, 72, 76]) {
    const f = Pitch.detectPitch(frameAfterAttack({ midi, partials: [1, 1.2, 0.25] }), SR, 70, 1400);
    assert.ok(f, `a pitch for midi ${midi}`);
    assert.equal(((Math.round(Pitch.freqToMidi(f)) % 12) + 12) % 12, midi % 12, `pitch class of midi ${midi}`);
  }
});

test('parseNote reads dotted lengths', () => {
  assert.equal(Pitch.parseNote('D4:q.').beats, 1.5);
  assert.deepEqual(Pitch.parseNote('E4'), { letter: 'E', dur: 'q', beats: 1, midi: 64, staffPos: 0 });
});
