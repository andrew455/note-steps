// G major as the "done" chord (§7.1): recognised in every octave and inversion when it is a target,
// and C / C minor / look-alike chords are never misread as G.
const test = require('node:test');
const assert = require('node:assert');
const sim = require('./audio-sim.js');
const CD = require('../chords.js');

const TARGETS = ['C', 'Cm', 'G'];
function render(notes, { sr = 48000, velocity = 0.2, seed = 1 } = {}) {
  const sig = new Float32Array(Math.round(sr * 2.2));
  sim.addNoise(sig, sr, 0.0004, seed);
  sim.addChord(sig, sr, 0.4, notes, { velocity, seed });
  return { sig, sr };
}
const run = (notes, o) => {
  const { sig, sr } = render(notes, o);
  return sim.runDetector(sig, sr, CD.createDetector({ targets: TARGETS })).map((e) => e.name);
};

const G = { 0: (R) => ['G' + R, 'B' + R, 'D' + (R + 1)], 1: (R) => ['B' + R, 'D' + (R + 1), 'G' + (R + 1)], 2: (R) => ['D' + R, 'G' + R, 'B' + R] };
for (const R of [3, 4]) for (const inv of [0, 1, 2]) for (const [dyn, v] of [['soft', 0.04], ['loud', 0.3]]) {
  test(`G major octave ${R} inversion ${inv} ${dyn} -> G`, () => {
    assert.deepEqual(run(G[inv](R), { velocity: v, seed: R * 7 + inv }), ['G']);
  });
}
for (const [id, notes] of [['C', ['C4', 'E4', 'G4']], ['Cm', ['C4', 'Eb4', 'G4']]]) {
  test(`${id} is still ${id} when G is also a target`, () => assert.deepEqual(run(notes), [id]));
}
for (const [label, notes] of [
  ['E minor', ['E4', 'G4', 'B4']], ['G minor', ['G4', 'Bb4', 'D5']], ['G7', ['G4', 'B4', 'D5', 'F5']],
  ['D major', ['D4', 'F#4', 'A4']], ['G+D', ['G4', 'D5']], ['single G4', ['G4']], ['B dim', ['B3', 'D4', 'F4']],
]) {
  test(`${label} is not a command`, () => assert.deepEqual(run(notes), []));
}
test('G is not reported when it is not a target', () => {
  const { sig, sr } = render(['G4', 'B4', 'D5']);
  assert.deepEqual(sim.runDetector(sig, sr, CD.createDetector()).map((e) => e.name), []);
});
