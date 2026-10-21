// modes/ear-core.js (WP7): phrases, repeats, chunk plans, the forgiving matcher, rhythm, review,
// fingering, unlocks and Listening Room counting. Spec §3.7 and §5.1.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Pitch = require('../pitch.js');
const Util = require('../core/util.js');
const EC = require('../modes/ear-core.js');

// ---------- fixtures (the committed v1 strings, plus Hot Cross Buns from §3.7.6) ----------
const STR = {
  mary: 'E4 D4 C4 D4 E4 E4 E4:h D4 D4 D4:h E4 G4 G4:h E4 D4 C4 D4 E4 E4 E4 E4 D4 D4 E4 D4 C4:w',
  ode: 'E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4:q. D4:e D4:h E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4:q. C4:e C4:h',
  twinkle: 'C4 C4 G4 G4 A4 A4 G4:h F4 F4 E4 E4 D4 D4 C4:h G4 G4 F4 F4 E4 E4 D4:h G4 G4 F4 F4 E4 E4 D4:h C4 C4 G4 G4 A4 A4 G4:h F4 F4 E4 E4 D4 D4 C4:h',
  hcb: 'E4 D4 C4:h E4 D4 C4:h C4:e C4:e C4:e C4:e D4:e D4:e D4:e D4:e E4 D4 C4:h',
};
const LENS = { mary: [7, 3, 3, 8, 5], ode: [8, 7, 8, 7], twinkle: [7, 7, 7, 7, 7, 7], hcb: [3, 3, 8, 3] };

function parse(str) {
  let beat = 0;
  return str.trim().split(/\s+/).map((tok, i) => {
    const n = Pitch.parseNote(tok);
    n.beat = beat;
    n.i = i;
    n.key = n.letter + (Math.floor(n.midi / 12) - 1);
    beat += n.beats;
    return n;
  });
}
function phrasesFromLens(lens) {
  let at = 0;
  return lens.map((l) => [at, (at += l)]);
}
function song(id, { withPhrases = true, bpm = 100 } = {}) {
  const notes = parse(STR[id]);
  return { id, title: id, bpm, beatsPerBar: 4, pickup: 0, notes, phrases: withPhrases ? phrasesFromLens(LENS[id]) : undefined };
}
const lens = (phrases) => phrases.map(([a, b]) => b - a);

// ======================================================================
// phrases and repeats
// ======================================================================
test('segment (the auto phrase rules) reproduces the §3.7.6 phrase table', () => {
  for (const id of Object.keys(STR)) {
    const s = song(id, { withPhrases: false });
    assert.deepEqual(lens(EC.phrasesFor(s)), LENS[id], id);
  }
});

test('phrasesFor keeps valid song phrases and replaces a single long stub phrase', () => {
  const s = song('mary');
  assert.deepEqual(EC.phrasesFor(s), s.phrases);
  const stub = Object.assign({}, s, { phrases: [[0, s.notes.length]] });
  assert.deepEqual(lens(EC.phrasesFor(stub)), LENS.mary);
});

test('findRepeats on the 4 fixtures matches §3.7.6', () => {
  const rep = (id) => { const s = song(id); return EC.findRepeats(s.phrases, s.notes); };
  // Twinkle: P4 = P3, P5 = P1, P6 = P2 -> 3 unique
  const tw = rep('twinkle');
  assert.equal(tw[3].repeatOf, 2);
  assert.equal(tw[4].repeatOf, 0);
  assert.equal(tw[5].repeatOf, 1);
  assert.equal(tw.filter((r) => r.repeatOf == null).length, 3);
  // Ode: P3 = P1; P4 variantOf P2, divergeAt 4
  const ode = rep('ode');
  assert.equal(ode[2].repeatOf, 0);
  assert.equal(ode[3].variantOf, 1);
  assert.equal(ode[3].divergeAt, 4);
  assert.deepEqual(ode[1], {});
  // Mary: P4 variantOf P1, divergeAt 6
  const mary = rep('mary');
  assert.equal(mary[3].variantOf, 0);
  assert.equal(mary[3].divergeAt, 6);
  assert.deepEqual([mary[1], mary[2], mary[4]], [{}, {}, {}]);
  // Hot Cross Buns: P2 = P1, P4 = P1 -> 2 unique
  const hcb = rep('hcb');
  assert.equal(hcb[1].repeatOf, 0);
  assert.equal(hcb[3].repeatOf, 0);
  assert.equal(hcb.filter((r) => r.repeatOf == null).length, 2);
});

test('findRepeats finds a shape (same intervals, different start)', () => {
  const notes = parse('C4 D4 E4:h G4 A4 B4:h');
  const r = EC.findRepeats([[0, 3], [3, 6]], notes);
  assert.equal(r[1].shapeOf, 0);
});

// ======================================================================
// chunk plan
// ======================================================================
test('buildChunkPlan(twinkle) gives the 10 steps of §3.7.7 with the right keys', () => {
  const plan = EC.buildChunkPlan(song('twinkle'));
  assert.equal(plan.steps.length, 10);
  assert.deepEqual(plan.steps.map((s) => s.type), ['echo', 'echo', 'echo', 'echo', 'echo', 'memory', 'recognise', 'recognise', 'recognise', 'whole']);
  assert.deepEqual(plan.steps.map((s) => s.key), ['p0', 'p1', 'p0-1', 'p2', 'p1-2', 'p0..2', 'p3', 'p4', 'p5', 'whole']);
  assert.deepEqual(plan.steps.map((s) => EC.chunkKey(s)), plan.steps.map((s) => s.key));
  const memory = plan.steps[5];
  assert.ok(memory.idx.length > 16, 'the memory step covers more than 16 notes');
  assert.deepEqual(memory.chunk, [0, 1, 2]);
  assert.equal(plan.steps[9].beads, 2);
  assert.ok(plan.steps.slice(6, 9).every((s) => s.beads === 1));
  assert.match(plan.hash, /^[0-9a-f]{8}$/);
});

test('buildChunkPlan(twinkle, known) echoes only P2 and recognises P1 and P3', () => {
  const plan = EC.buildChunkPlan(song('twinkle'), { known: true, phraseErr: [0, 1, 0, 0, 0, 0] });
  const singles = plan.steps.filter((s) => s.type === 'echo' && !s.join);
  assert.deepEqual(singles.map((s) => s.chunk), [[1]]);
  assert.deepEqual(plan.steps.filter((s) => s.type === 'recognise').map((s) => s.of), [0, 2]);
  assert.ok(plan.steps.every((s) => s.type !== 'memory' || s.join), 'no memory steps');
  const whole = plan.steps[plan.steps.length - 1];
  assert.equal(whole.type, 'whole');
  assert.equal(whole.beads, 2);
  // joins only next to the phrase with errors
  assert.deepEqual(plan.steps.filter((s) => s.join).map((s) => s.key), ['p0-1', 'p1-2']);
  assert.notEqual(plan.hash, EC.buildChunkPlan(song('twinkle')).hash);
});

test('buildChunkPlan: beadsPerStep, shapes and variants, Hot Cross Buns, long joins', () => {
  const light = EC.buildChunkPlan(song('twinkle'), { beads: 'light' });
  assert.equal(light.steps[0].beads, 1);
  const thorough = EC.buildChunkPlan(song('twinkle'), { beads: 'thorough' });
  assert.equal(thorough.steps[0].beads, 3);
  const mary = EC.buildChunkPlan(song('mary'));
  const p3 = mary.steps.find((s) => s.key === 'p3');
  assert.equal(p3.note, 'variant');
  assert.equal(p3.ref, 0);
  const hcb = EC.buildChunkPlan(song('hcb'));
  assert.deepEqual(hcb.steps.map((s) => s.key), ['p0', 'p1', 'p2', 'p0-2', 'p3', 'whole']);
  // two 9-note phrases joined make 18 notes: a memory step (cue only)
  const long = { notes: parse('C4 D4 E4 F4 G4 F4 E4 D4 C4:h E4 F4 G4 A4 G4 F4 E4 D4 C4:h'), phrases: [[0, 9], [9, 18]], bpm: 90 };
  const lp = EC.buildChunkPlan(long);
  const join = lp.steps.find((s) => s.join);
  assert.equal(join.type, 'memory');
  assert.equal(join.key, 'p0-1');
});

test('buildChunkPlan splits more than 4 unique phrases into two sections', () => {
  const str = 'C4 D4 E4:h D4 E4 F4:h E4 F4 G4:h F4 G4 A4:h G4 A4 B4:h A4 B4 C5:h';
  const s = { notes: parse(str), phrases: [[0, 3], [3, 6], [6, 9], [9, 12], [12, 15], [15, 18]], bpm: 90 };
  const plan = EC.buildChunkPlan(s);
  const memories = plan.steps.filter((x) => x.type === 'memory' && !x.join).map((x) => x.key);
  assert.deepEqual(memories, ['p0..2', 'p3..5']);
});

test('carryChunks keeps beads only where the notes are unchanged', () => {
  const plan = EC.buildChunkPlan(song('twinkle'));
  const old = { p0: { beads: 2, sig: plan.steps[0].sig }, p1: { beads: 1, sig: 'deadbeef' } };
  assert.deepEqual(Object.keys(EC.carryChunks(old, plan)), ['p0']);
});

test('callBpmFor caps at 90 for short repeated notes, else 120', () => {
  assert.equal(EC.callBpmFor(parse('C4:e C4:e D4'), { bpm: 140 }), 90);
  assert.equal(EC.callBpmFor(parse('C4 D4 E4'), { bpm: 140 }), 120);
  assert.equal(EC.callBpmFor(parse('C4 D4 E4'), { bpm: 100, tempoPct: 80 }), 80);
});

// ======================================================================
// matcher
// ======================================================================
const ev = (midi, at, extra) => Object.assign({ midi, at, tOnset: at * 1000, source: 'mic', rms: 0.05 }, extra || {});
function play(M, midis, { start = 10, gap = 0.5 } = {}) {
  return midis.map((m, k) => M.push(ev(m, start + k * gap)));
}

test('matcher (1): a clean path', () => {
  const exp = parse('E4 D4 C4:h');
  const M = EC.makeMatcher(exp, { callEndPerf: 9000 });
  const r = play(M, [64, 62, 60]);
  assert.deepEqual(r.map((x) => x.kind), ['match', 'match', 'match']);
  const s = M.state();
  assert.equal(s.status, 'success');
  assert.equal(s.wrong, 0);
  assert.deepEqual(s.onsets, [10, 10.5, 11]);
  assert.equal(M.push(ev(60, 11.3)).kind, 'grace');
});

test('matcher (2): a doubled D4 at +120 ms is ignored and the attempt stays clean', () => {
  const exp = parse('E4 D4 C4:h');
  const M = EC.makeMatcher(exp, { callEndPerf: 9000 });
  M.push(ev(64, 10));
  M.push(ev(62, 10.5));
  assert.equal(M.push(ev(62, 10.62)).kind, 'doubled');
  M.push(ev(60, 11));
  assert.equal(M.state().status, 'success');
  assert.equal(M.state().wrong, 0);
});

test('matcher (3): Mary’s E E E with one E missing is accepted as a merged repeat', () => {
  const exp = parse('E4 D4 C4 D4 E4 E4 E4:h D4 D4 D4:h');
  const M = EC.makeMatcher(exp, { callEndPerf: 9000 });
  const r = play(M, [64, 62, 60, 62, 64, 64, 62, 62, 62]);
  assert.equal(r[6].kind, 'merged');
  const s = M.state();
  assert.equal(s.status, 'success');
  assert.equal(s.wrong, 0);
  assert.equal(s.merged.length, 1);
  assert.equal(s.onsets[6], null);
});

test('matcher: no more than 2 merged repeats per attempt', () => {
  const exp = parse('E4 E4 D4 D4 C4 C4 E4');
  const M = EC.makeMatcher(exp, { callEndPerf: 0 });
  play(M, [64, 62, 62, 60, 60, 64], { start: 10 }); // drops 3 of the repeats? only allowed twice
  M.push(ev(64, 20));
  const s = M.state();
  assert.ok(s.merged.length <= 2);
});

test('matcher (4): a swallowed first note is accepted 800 ms after the call, wrong at 2000 ms', () => {
  const exp = parse('C4 D4 E4');
  const callEnd = 10000;
  const A = EC.makeMatcher(exp, { callEndPerf: callEnd });
  assert.equal(A.push(ev(62, 10.8)).kind, 'swallowed');
  A.push(ev(64, 11.3));
  assert.equal(A.state().status, 'success');
  assert.equal(A.state().wrong, 0);
  assert.equal(A.state().onsets[0], null);
  const B = EC.makeMatcher(exp, { callEndPerf: callEnd });
  assert.equal(B.push(ev(62, 12)).kind, 'wrong');
});

test('matcher (5): a wrong note then a fix gives selfFixed', () => {
  const exp = parse('C4 D4 E4');
  const M = EC.makeMatcher(exp, { callEndPerf: 0 });
  M.push(ev(60, 10));
  assert.equal(M.push(ev(65, 10.5)).kind, 'wrong');
  M.push(ev(62, 11));
  M.push(ev(64, 11.5));
  const s = M.state();
  assert.equal(s.selfFixed, true);
  assert.equal(s.wrong, 1);
  assert.deepEqual(s.wrongAt, [1]);
  assert.equal(s.status, 'success');
});

test('matcher (6): 6 wrong notes on attempt 0 tangle; on attempt 2 the 4th does', () => {
  const exp = parse('C4 D4 E4');
  const A = EC.makeMatcher(exp, { callEndPerf: 0, attemptIdx: 0 });
  const r = [];
  for (let k = 0; k < 6; k++) r.push(A.push(ev(71, 10 + k * 0.4)));
  assert.equal(r[4].status, 'playing');
  assert.equal(r[5].status, 'tangle');
  const B = EC.makeMatcher(exp, { callEndPerf: 0, attemptIdx: 2 });
  const q = [];
  for (let k = 0; k < 4; k++) q.push(B.push(ev(71, 10 + k * 0.4)));
  assert.equal(q[2].status, 'playing');
  assert.equal(q[3].status, 'tangle');
});

test('matcher (7): an octave-shifted match passes', () => {
  const exp = parse('E4 D4 C4:h');
  const M = EC.makeMatcher(exp, { callEndPerf: 0 });
  play(M, [76, 74, 72]);
  const s = M.state();
  assert.equal(s.status, 'success');
  assert.equal(s.octaveUp, 3);
});

test('matcher: black key flag, noise guards, lost timer', () => {
  const exp = parse('C4 D4 E4 F4 G4:h');
  const M = EC.makeMatcher(exp, { callEndPerf: 0, sessionRms: [0.05, 0.05, 0.05, 0.05], callBpm: 100 });
  assert.equal(M.push(ev(61, 10)).black, true);
  assert.equal(M.push(ev(60, 10.5, { rms: 0.002 })).kind, 'noisy');
  M.push(ev(60, 11));
  M.push(ev(62, 11.5));
  assert.equal(M.tick(11500 + 3000).lost, false);
  const t = M.tick(11500 + 4100);
  assert.equal(t.lost, true);
  assert.equal(t.fresh, true);
  assert.equal(M.tick(11500 + 4200).fresh, false);
  M.push(ev(64, 16));
  assert.equal(M.tick(16100).lost, false);
  // a burst of more than 6 onsets in a second is ignored
  const N = EC.makeMatcher(exp, { callEndPerf: 0, tangleAt: 99 });
  const kinds = [];
  for (let k = 0; k < 8; k++) kinds.push(N.push(ev(71, 20 + k * 0.1)).kind);
  assert.equal(kinds[6], 'noisy');
  assert.equal(kinds[7], 'noisy');
});

test('matcher: lost never fires during a held note', () => {
  const exp = parse('C4 D4:w E4');
  const M = EC.makeMatcher(exp, { callEndPerf: 0, callBpm: 40 }); // a whole note lasts 6 s
  M.push(ev(60, 10));
  M.push(ev(62, 11.5));
  assert.equal(M.tick(11500 + 5000).lost, false);
  assert.equal(M.tick(11500 + 15100).lost, true);
});

// ======================================================================
// rhythm
// ======================================================================
const twinkleBeats = [1, 1, 1, 1, 1, 1, 2];
const onsetsFor = (beats, bpm, jitter = () => 0, t0 = 1) => {
  const spb = 60 / bpm;
  let t = t0;
  return beats.map((b) => { const o = t + jitter(); t += b * spb; return o; });
};

test('judgeRhythm: perfect onsets pass', () => {
  const r = EC.judgeRhythm(twinkleBeats, onsetsFor(twinkleBeats, 84), { callBpm: 84 });
  assert.equal(r.status, 'ok');
  assert.equal(r.pass, true);
  assert.ok(Math.abs(r.bpm - 84) < 0.5);
  assert.equal(r.tempoNote, null);
});

test('judgeRhythm: ±25 ms and ±60 ms jitter at 84 bpm pass', () => {
  for (const j of [0.025, 0.06]) {
    const rng = Util.mulberry32(7);
    const r = EC.judgeRhythm(twinkleBeats, onsetsFor(twinkleBeats, 84, () => (rng() * 2 - 1) * j), { callBpm: 84 });
    assert.equal(r.pass, true, `jitter ${j}`);
    let k = 0;
    const alt = EC.judgeRhythm(twinkleBeats, onsetsFor(twinkleBeats, 84, () => (k++ % 2 ? -j : j)), { callBpm: 84 });
    assert.equal(alt.pass, true, `alternating jitter ${j}`);
  }
});

test('judgeRhythm: a lilt (q. e) played evenly fails the long-short check', () => {
  const beats = [1.5, 0.5, 1.5, 0.5, 1.5, 0.5, 2];
  const even = beats.map((_, i) => 1 + i * 0.5);
  const r = EC.judgeRhythm(beats, even, { callBpm: 90 });
  assert.equal(r.status, 'ok');
  assert.equal(r.pass, false);
  assert.equal(r.short, true);
  const good = EC.judgeRhythm(beats, onsetsFor(beats, 90), { callBpm: 90 });
  assert.equal(good.pass, true);
  // an odd number of gaps (8 notes played evenly): the short gaps must not be thrown away as hesitations
  const b8 = [1.5, 0.5, 1.5, 0.5, 1.5, 0.5, 1.5, 0.5];
  const even8 = b8.map((_, i) => 1 + i * 0.667);
  const r8 = EC.judgeRhythm(b8, even8, { callBpm: 90 });
  assert.equal(r8.status, 'ok');
  assert.equal(r8.pass, false);
  assert.deepEqual(r8.hesitations, []);
});

test('judgeRhythm: 2x tempo passes with tempoNote faster', () => {
  const r = EC.judgeRhythm(twinkleBeats, onsetsFor(twinkleBeats, 168), { callBpm: 84 });
  assert.equal(r.pass, true);
  assert.equal(r.tempoNote, 'faster');
  const slow = EC.judgeRhythm(twinkleBeats, onsetsFor(twinkleBeats, 50), { callBpm: 84 });
  assert.equal(slow.tempoNote, 'slower');
});

test('judgeRhythm: one 3x gap is excluded as a hesitation and still passes', () => {
  const on = onsetsFor(twinkleBeats, 84);
  const extra = 2 * (60 / 84);
  for (let k = 3; k < on.length; k++) on[k] += extra; // gap 2 is 3 beats long
  const r = EC.judgeRhythm(twinkleBeats, on, { callBpm: 84 });
  assert.equal(r.pass, true);
  assert.deepEqual(r.hesitations, [2]);
});

test('judgeRhythm: a null onset excludes its gaps; fewer than 2 IOIs give na', () => {
  const on = onsetsFor(twinkleBeats, 84);
  on[3] = null;
  const r = EC.judgeRhythm(twinkleBeats, on, { callBpm: 84 });
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.gaps.map((g) => g.i), [0, 1, 4, 5]);
  assert.equal(EC.judgeRhythm([1, 1, 1], [1, null, 2], { callBpm: 84 }).status, 'na');
  assert.equal(EC.judgeRhythm([1, 1], [1, 1.5], { callBpm: 84 }).status, 'na');
  assert.equal(EC.judgeRhythm([1, 1, 1], [1, 1.1, 1.2], { callBpm: 84 }).reason, 'tempo');
});

test('judgeRhythm: an uneven pulse is not steady', () => {
  const beats = [1, 1, 1, 1, 1, 1, 1];
  const on = [0, 0.4, 1.3, 1.7, 2.6, 3.0, 3.9];
  const r = EC.judgeRhythm(beats, on, { callBpm: 90 });
  assert.equal(r.status, 'ok');
  assert.equal(r.steady, false);
  assert.equal(r.pass, false);
});

// ======================================================================
// review
// ======================================================================
const day = '2026-10-21';
test('scheduleReview: clean, cap, stay and rusty', () => {
  const clean = { wrong: 0, n: 26, prompted: false };
  const a = EC.scheduleReview({ level: 0, focusIdx: 0 }, clean, day);
  assert.equal(a.level, 1);
  assert.equal(a.due, Util.addDays(day, 1));
  assert.equal(a.focusIdx, 1);
  const b = EC.scheduleReview({ level: 3 }, clean, day);
  assert.equal(b.level, 4);
  assert.equal(b.due, Util.addDays(day, 7));
  const c = EC.scheduleReview({ level: 4 }, clean, day);
  assert.equal(c.level, 4);
  assert.equal(c.due, Util.addDays(day, 7));
  const stay = EC.scheduleReview({ level: 2 }, { wrong: 3, n: 26, prompted: false }, day);
  assert.equal(stay.level, 2);
  assert.equal(stay.due, Util.addDays(day, 1));
  assert.equal(stay.lastOutcome, 'stay');
  const rusty = EC.scheduleReview({ level: 1 }, { wrong: 9, n: 26, prompted: 2 }, day);
  assert.equal(rusty.level, 1);
  assert.equal(rusty.due, Util.addDays(day, 1));
  assert.equal(rusty.brushUp, true);
  assert.equal(EC.scheduleReview({ level: 3 }, { quit: true }, day).level, 2);
  // "Hear it first" caps a clean result at stay
  assert.equal(EC.scheduleReview({ level: 2 }, Object.assign({ heardFirst: true }, clean), day).level, 2);
  // a 26-note tune allows floor(26/20) = 1 wrong note for clean
  assert.equal(EC.reviewOutcome({ wrong: 1, n: 26 }), 'clean');
  assert.equal(EC.reviewOutcome({ wrong: 0, n: 26, prompted: 1 }), 'stay');
});

test('focusMet rules', () => {
  assert.equal(EC.focusMet('steady', { rhythm: { status: 'ok', pass: true } }), true);
  assert.equal(EC.focusMet('softly', { medianRms: 0.02, prevMedianRms: 0.05 }), true);
  assert.equal(EC.focusMet('softly', { medianRms: 0.04, prevMedianRms: 0.05 }), false);
  assert.equal(EC.focusMet('octave', { octaveShare: 0.75 }), true);
});

// ======================================================================
// fingering
// ======================================================================
test('fingering: Mary gives thumb C4 with E = 3 and G = 5', () => {
  const s = song('mary');
  const f = EC.fingering(s.notes, s.phrases);
  assert.equal(f.thumbKey, 'C4');
  const at = (key) => f.fingers[s.notes.findIndex((n) => n.key === key)];
  assert.equal(at('E4'), 3);
  assert.equal(at('G4'), 5);
  assert.equal(at('C4'), 1);
  assert.deepEqual(f.moves, []);
});

test('fingering: a tune spanning C4..A4 has a move', () => {
  const notes = parse('C4 D4 E4 F4 G4:h A4 G4 F4 E4 D4:h');
  const f = EC.fingering(notes, [[0, 5], [5, 10]]);
  assert.equal(f.thumbKey, 'C4');
  assert.deepEqual(f.moves, [{ phrase: 1, thumbKey: 'D4' }]);
  assert.equal(f.fingers[5], 5); // A with thumb on D
  // Twinkle's first phrase spans 6 keys, so it has no numbers
  const tw = song('twinkle');
  const g = EC.fingering(tw.notes, tw.phrases);
  assert.equal(g.fingers[0], null);
  assert.equal(g.fingers[7], 4); // F with thumb on C
});

// ======================================================================
// unlocks
// ======================================================================
const LIB = ['hot-cross-buns', 'au-clair-de-la-lune', 'mary', 'lightly-row'].map((id) => ({ id, title: id, notes: parse('C4 D4 E4') }));

test('unlocks: R1 opens tune 1; tune N+1 listens when N echoes; echo needs N by ear', () => {
  const ear = { remix: { r1: {}, r2: {}, skipped: false }, tunes: {}, listening: { heard: {} } };
  let u = EC.unlocks(ear, {}, LIB);
  assert.equal(u['hot-cross-buns'].listen, false);
  ear.remix.r1.walk = 2;
  u = EC.unlocks(ear, {}, LIB);
  assert.equal(u['hot-cross-buns'].listen, true);
  assert.equal(u['hot-cross-buns'].echo, true);
  assert.equal(u['au-clair-de-la-lune'].listen, false);
  ear.tunes['hot-cross-buns'] = { stage: 'echo' };
  u = EC.unlocks(ear, {}, LIB);
  assert.equal(u['au-clair-de-la-lune'].listen, true);
  assert.equal(u['au-clair-de-la-lune'].echo, false);
  assert.equal(u['au-clair-de-la-lune'].why, 'prev');
  ear.tunes['hot-cross-buns'] = { stage: 'see', byEarAt: 1 };
  u = EC.unlocks(ear, {}, LIB);
  assert.equal(u['au-clair-de-la-lune'].echo, true);
  assert.equal(u['hot-cross-buns'].see, true);
  assert.equal(u['hot-cross-buns'].read, false);
  // skipping the warm-up also opens tune 1
  assert.equal(EC.unlocks({ remix: { r1: {}, skipped: true }, tunes: {} }, {}, LIB)['hot-cross-buns'].listen, true);
});

test('unlocks: the lag limit blocks tune 3’s Echo until tune 1 has readAt and coldReadAt', () => {
  const ear = {
    remix: { r1: { walk: 2 } },
    tunes: { 'hot-cross-buns': { stage: 'see', byEarAt: 1 }, 'au-clair-de-la-lune': { stage: 'see', byEarAt: 2 } },
    listening: { heard: { mary: 3 } },
  };
  let u = EC.unlocks(ear, {}, LIB);
  assert.equal(u.mary.listen, true);
  assert.equal(u.mary.echo, false);
  assert.equal(u.mary.why, 'lag');
  assert.equal(u.mary.lagTitle, 'hot-cross-buns');
  assert.equal(u.mary.earsReady, true);
  ear.tunes['hot-cross-buns'] = { stage: 'read', byEarAt: 1, seenAt: 2, readAt: 3 };
  assert.equal(EC.unlocks(ear, {}, LIB).mary.echo, false);
  ear.tunes['hot-cross-buns'].coldReadAt = 4;
  assert.equal(EC.unlocks(ear, {}, LIB).mary.echo, true);
});

test('unlocks skips path ids missing from the library; concert needs 3 polished tunes', () => {
  const u = EC.unlocks({ remix: { skipped: true }, tunes: {} }, {}, [{ id: 'mary', title: 'Mary', notes: [] }]);
  assert.equal(u.mary.n, 0);
  assert.equal(u.mary.listen, true);
  const tunes = { a: { polish: { level: 2 } }, b: { polish: { level: 3 } }, c: { polish: { level: 1 } } };
  assert.equal(EC.concertOpen({ tunes }), false);
  tunes.c.polish.level = 2;
  assert.equal(EC.concertOpen({ tunes }), true);
});

// ======================================================================
// listening room
// ======================================================================
test('countListens counts 80% crossings, also across loops and while JS was paused', () => {
  const layout = [{ id: 'a', start: 0, end: 30 }, { id: 'b', start: 31.5, end: 61.5 }];
  const dur = 63;
  assert.deepEqual(EC.countListens(layout, dur, 0, 20, true).counts, {});
  assert.deepEqual(EC.countListens(layout, dur, 0, 25, true).counts, { a: 1 });
  // 2 full loops plus a bit, computed in one go on resume
  const r = EC.countListens(layout, dur, 0, 2 * dur + 25, true);
  assert.deepEqual(r.counts, { a: 3, b: 2 });
  assert.ok(Math.abs(r.endPos - 25) < 1e-6);
  const once = EC.countListens(layout, dur, 10, 500, false);
  assert.deepEqual(once.counts, { a: 1, b: 1 });
  assert.equal(once.ended, true);
});

test('updateStreak: a day counts at 120 s or 5 listens, one rest day per 7 days', () => {
  const L = { streak: { count: 0, lastDay: null, restDays: [] }, days: {} };
  L.days['2026-10-18'] = { secs: 130, listens: 0 };
  EC.updateStreak(L, '2026-10-18');
  assert.equal(L.streak.count, 1);
  L.days['2026-10-19'] = { secs: 10, listens: 5 };
  EC.updateStreak(L, '2026-10-19');
  assert.equal(L.streak.count, 2);
  // skip the 20th, listen on the 21st: rest day used
  L.days['2026-10-21'] = { secs: 200, listens: 2 };
  const r = EC.updateStreak(L, '2026-10-21');
  assert.equal(r.restUsed, true);
  assert.equal(L.streak.count, 3);
  assert.deepEqual(L.streak.restDays, ['2026-10-20']);
  // a second missed day within 7 days resets
  L.days['2026-10-23'] = { secs: 200, listens: 0 };
  assert.equal(EC.updateStreak(L, '2026-10-23').restUsed, false);
  assert.equal(L.streak.count, 1);
  // not enough listening does not count, and the same day never counts twice
  L.days['2026-10-24'] = { secs: 100, listens: 4 };
  EC.updateStreak(L, '2026-10-24');
  assert.equal(L.streak.count, 1);
  assert.equal(EC.streakNow(L, '2026-10-24'), 1);
  assert.equal(EC.streakNow(L, '2026-10-30'), 0);
});

// ======================================================================
// misc
// ======================================================================
test('remixItems applies a pattern to each melody note', () => {
  const lilt = EC.REMIX_PATTERNS.find((p) => p.id === 'lilt');
  const items = EC.remixItems(lilt, [60, 67]);
  assert.deepEqual(items.map((x) => [x.midi, x.beats]), [[60, 1.5], [60, 0.5], [67, 1.5], [67, 0.5]]);
  assert.equal(EC.REMIX_PATTERNS.length, 6);
  assert.ok(EC.REMIX_PATTERNS.every((p) => p.beats.reduce((a, b) => a + b, 0) === 2));
});

test('EAR_PATH starts with the remix warm-up and lists the §3.7.3 tunes', () => {
  assert.equal(EC.EAR_PATH[0], 'remix-start');
  assert.equal(EC.EAR_PATH[1], 'hot-cross-buns');
  assert.equal(EC.EAR_PATH.length, 19);
  assert.equal(new Set(EC.EAR_PATH).size, EC.EAR_PATH.length);
});

test('newNotesIn and pickColdRead', () => {
  const lib = [
    { id: 'hot-cross-buns', keys: ['E4', 'D4', 'C4'], notes: [] },
    { id: 'mary', keys: ['E4', 'D4', 'C4', 'G4'], notes: [] },
    { id: 'other', keys: ['C4', 'D4', 'E4'], notes: [] },
    { id: 'wide', keys: ['C4', 'A4'], notes: [] },
  ];
  assert.deepEqual(EC.newNotesIn('mary', lib), ['G4']);
  const pick = EC.pickColdRead(lib[0], lib, {
    pathIds: EC.EAR_PATH, tunes: {}, practised: () => false, introduced: () => true, known: () => false, comfort: () => 'easy',
  });
  assert.equal(pick.id, 'other');
  assert.equal(EC.pickColdRead(lib[0], lib, { pathIds: EC.EAR_PATH, practised: (id) => id === 'other', comfort: () => 'easy' }), null);
});
