// Ear First logic (UMD, pure, no DOM): NS.EarCore in the browser, require('./ear-core.js') in Node.
// Spec §3.7. Everything here takes its inputs as arguments (times, today, rng); nothing reads the clock.
//
//   EAR_PATH, REMIX_PATTERNS
//   phrasesFor(song) / segment(notes, {beatsPerBar, pickup})   phrases as [from, toExclusive) note indices
//   findRepeats(phrases, notes)        -> [{repeatOf?, shapeOf?, variantOf?, divergeAt?}]
//   buildChunkPlan(song, opts)         -> {steps:[Step], hash, phrases, repeats}
//   chunkKey(step)                     -> 'p0' | 'p0-1' | 'p0..2' | 'whole' | 'remix:walk'
//   makeMatcher(expected, opts)        -> forgiving cursor for one echo attempt (§3.7.5)
//   judgeRhythm(beats, onsets, opts)   -> §3.7.9
//   scheduleReview(polish, result, today) -> polish (§3.7.11)
//   fingering(notes, phrases)          -> {thumbKey, fingers, moves}
//   unlocks(earSlice, S, songs)        -> {[id]: {listen, echo, see, read, remix, ...}}
//   countListens / updateStreak / streakNow   Listening Room counting (§3.7.4)
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const Util = isNode ? require('../core/util.js') : root.Util;
  const pc = (m) => ((m % 12) + 12) % 12;
  const EPS = 1e-6;

  // ======================================================================
  // PATH AND PATTERNS
  // ======================================================================
  // §3.7.3: index 0 is the Rhythm Remix warm-up, then the tunes (all public domain, not in Suzuki order).
  const EAR_PATH = [
    'remix-start',
    'hot-cross-buns', 'au-clair-de-la-lune', 'mary', 'lightly-row', 'go-tell-aunt-rhody', 'ode',
    'all-my-little-ducklings', 'twinkle', 'london-bridge', 'jingle', 'old-macdonald', 'row-row-row-your-boat',
    'frere-jacques', 'amazing-grace', 'can-can', 'silent-night', 'auld-lang-syne', 'yankee-doodle',
  ];

  // §3.7.9: our own names; each pattern fills 2 beats of one melody note.
  const REMIX_PATTERNS = [
    { id: 'walk', name: 'Walk', rhythm: ['q', 'q'], beats: [1, 1] },
    { id: 'hold', name: 'Hold', rhythm: ['h'], beats: [2] },
    { id: 'pair-step', name: 'Pair, step', rhythm: ['e', 'e', 'q'], beats: [0.5, 0.5, 1] },
    { id: 'step-pair', name: 'Step, pair', rhythm: ['q', 'e', 'e'], beats: [1, 0.5, 0.5] },
    { id: 'lilt', name: 'Lilt', rhythm: ['q.', 'e'], beats: [1.5, 0.5] },
    { id: 'quad', name: 'Quick four', rhythm: ['e', 'e', 'e', 'e'], beats: [0.5, 0.5, 0.5, 0.5] },
  ];
  // Melodies the patterns are applied to (R1 any key, R2 two notes).
  const REMIX_LEVELS = {
    r1: { id: 'r1', name: 'Any key', melody: [60, 60, 60, 60], pitch: false },
    r2: { id: 'r2', name: 'Two notes', melody: [60, 60, 67, 67], pitch: true },
    r3: { id: 'r3', name: 'Remix a phrase', melody: null, pitch: true, capBpm: 80 },
  };
  const DUR_OF = { 0.25: 's', 0.5: 'e', 0.75: 'e.', 1: 'q', 1.5: 'q.', 2: 'h', 3: 'h.', 4: 'w' };

  // A pattern applied to melody notes (midis): note items {kind, midi, beats, dur, beat}.
  function remixItems(pattern, melody) {
    const out = [];
    let beat = 0;
    melody.forEach((m) => {
      pattern.beats.forEach((b, k) => {
        out.push({ kind: 'note', midi: m, beats: b, dur: pattern.rhythm[k], beat });
        beat += b;
      });
    });
    return out;
  }

  // ======================================================================
  // PHRASES (§3.7.6). Phrases normally come from song.phrases (Notation.autoPhrases); `segment` is the
  // same rule set, used when a song arrives without valid phrases.
  // ======================================================================
  function beatsOf(notes) {
    let b = 0;
    return notes.map((n) => {
      const start = Number.isFinite(n.beat) ? n.beat : b;
      b = start + (n.beats || 1);
      return start;
    });
  }

  function segment(notes, { beatsPerBar = 4, pickup = 0 } = {}) {
    const n = (notes || []).length;
    if (!n) return [];
    if (n < 3) return [[0, n]];
    const start = beatsOf(notes);
    const len = (i) => notes[i].beats || 1;
    const end = (i) => start[i] + len(i);
    const onBar = (k) => {
      const r = (((start[k] - pickup) % beatsPerBar) + beatsPerBar) % beatsPerBar;
      return r < EPS || beatsPerBar - r < EPS;
    };
    // R1: close after a long note (>= 2 beats) or a rest, once the span has 3 notes.
    let spans = [];
    let from = 0;
    for (let i = 0; i < n; i++) {
      const restAfter = i < n - 1 && start[i + 1] - end(i) > EPS;
      if (i - from + 1 >= 3 && (len(i) >= 2 || restAfter)) { spans.push([from, i + 1]); from = i + 1; }
    }
    if (from < n) spans.push([from, n]);

    // The bar line closest to the span's beat midpoint, keeping `minSide` notes each side.
    function bestBar(a, b, minSide) {
      const mid = (start[a] + end(b - 1)) / 2;
      let best = -1;
      for (let k = a + minSide; k <= b - minSide; k++) {
        if (!onBar(k)) continue;
        if (best < 0 || Math.abs(start[k] - mid) < Math.abs(start[best] - mid) - EPS) best = k;
      }
      return best;
    }
    // R2: more than 8 notes or 8 beats -> split at the middle bar line (3 notes each side), recursively.
    function splitLong([a, b]) {
      if (b - a > 8 || end(b - 1) - start[a] > 8 + EPS) {
        const k = bestBar(a, b, 3);
        if (k > 0) return [...splitLong([a, k]), ...splitLong([k, b])];
      }
      return [[a, b]];
    }
    spans = spans.flatMap(splitLong);

    // R3: a span under 3 notes merges into the next one; the last merges into the previous one.
    const merged = [];
    let carry = null;
    spans.forEach((s, idx) => {
      let cur = carry ? [carry[0], s[1]] : s;
      carry = null;
      if (cur[1] - cur[0] < 3 && idx < spans.length - 1) carry = cur;
      else merged.push(cur);
    });
    if (merged.length > 1) {
      const last = merged[merged.length - 1];
      if (last[1] - last[0] < 3) { merged.pop(); merged[merged.length - 1] = [merged[merged.length - 1][0], last[1]]; }
    }

    // R4: hard maximum of 10 notes, split at the nearest bar line (or the middle note).
    function capTen([a, b]) {
      if (b - a <= 10) return [[a, b]];
      let k = bestBar(a, b, 2);
      if (k < 0) k = a + Math.floor((b - a) / 2);
      return [...capTen([a, k]), ...capTen([k, b])];
    }
    return merged.flatMap(capTen);
  }

  function validPhrases(phrases, n) {
    if (!Array.isArray(phrases) || !phrases.length) return false;
    let at = 0;
    for (const p of phrases) {
      if (!Array.isArray(p) || p[0] !== at || p[1] <= p[0]) return false;
      const len = p[1] - p[0];
      if (len > 10 || (len < 2 && n >= 2)) return false;
      at = p[1];
    }
    return at === n;
  }

  // The song's own phrases when they are usable, otherwise the auto rules.
  function phrasesFor(song) {
    const notes = (song && song.notes) || [];
    if (validPhrases(song && song.phrases, notes.length)) return song.phrases.map((p) => [p[0], p[1]]);
    return segment(notes, { beatsPerBar: (song && song.beatsPerBar) || 4, pickup: (song && song.pickup) || 0 });
  }

  // ======================================================================
  // REPEATS (§3.7.6)
  // ======================================================================
  function findRepeats(phrases, notes) {
    const seq = phrases.map(([a, b]) => notes.slice(a, b));
    const same = (x, y) => x.midi === y.midi && Math.abs((x.beats || 1) - (y.beats || 1)) < EPS;
    const identical = (A, B) => A.length === B.length && A.every((x, k) => same(x, B[k]));
    const sameShape = (A, B) => A.length === B.length && A[0].midi !== B[0].midi &&
      A.every((x, k) => Math.abs((x.beats || 1) - (B[k].beats || 1)) < EPS && (k === 0 || x.midi - A[k - 1].midi === B[k].midi - B[k - 1].midi));
    const prefix = (A, B) => {
      let k = 0;
      while (k < A.length && k < B.length && same(A[k], B[k])) k++;
      return k;
    };
    const out = [];
    seq.forEach((P, i) => {
      const r = {};
      for (let j = 0; j < i; j++) if (out[j].repeatOf == null && identical(P, seq[j])) { r.repeatOf = j; break; }
      if (r.repeatOf == null) {
        for (let j = 0; j < i; j++) if (out[j].repeatOf == null && sameShape(P, seq[j])) { r.shapeOf = j; break; }
      }
      if (r.repeatOf == null && r.shapeOf == null) {
        for (let j = 0; j < i; j++) {
          if (out[j].repeatOf != null) continue;
          const k = prefix(P, seq[j]);
          if (k >= 3 && k >= Math.ceil(P.length / 2) && k < Math.max(P.length, seq[j].length)) {
            r.variantOf = j;
            r.divergeAt = k;
            break;
          }
        }
      }
      out.push(r);
    });
    return out;
  }

  // ======================================================================
  // CHUNK PLAN (§3.7.7)
  // ======================================================================
  const MAX_CALL_NOTES = 16;

  function chunkKey(step) {
    if (!step) return 'p0';
    if (step.type === 'whole') return 'whole';
    if (step.type === 'remix') return 'remix:' + step.pattern;
    const c = step.chunk || [0];
    if (c.length === 1) return 'p' + c[0];
    if (step.type === 'memory' && !step.join) return `p${c[0]}..${c[c.length - 1]}`;
    return `p${c[0]}-${c[c.length - 1]}`;
  }

  function sigOf(notes, idx) {
    return Util.hash(idx.map((i) => notes[i].midi + ':' + (notes[i].beats || 1)).join(' '));
  }

  function buildChunkPlan(song, { known = false, phraseErr = null, beads = 'standard' } = {}) {
    const notes = song.notes || [];
    const phrases = phrasesFor(song);
    const reps = findRepeats(phrases, notes);
    const adj = beads === 'light' ? -1 : beads === 'thorough' ? 1 : 0;
    const B = (b) => Math.max(1, b + adj);
    const range = (a, b) => { const r = []; for (let k = a; k < b; k++) r.push(k); return r; };
    const idxOfPhrase = (p) => range(phrases[p][0], phrases[p][1]);
    const steps = [];

    function push(step) {
      if (step.type === 'whole') step.idx = range(0, notes.length);
      else if (step.type === 'memory' && !step.join) step.idx = range(phrases[step.chunk[0]][0], phrases[step.chunk[step.chunk.length - 1]][1]);
      else step.idx = step.chunk.flatMap(idxOfPhrase);
      step.key = chunkKey(step);
      step.sig = sigOf(notes, step.idx);
      steps.push(step);
    }
    function pushJoin(a, b) {
      const n = phrases[a][1] - phrases[a][0] + phrases[b][1] - phrases[b][0];
      push({ type: n > MAX_CALL_NOTES ? 'memory' : 'echo', chunk: [a, b], join: true, beads: B(2) });
    }
    function noteFor(i) { return reps[i].shapeOf != null ? 'shape' : reps[i].variantOf != null ? 'variant' : null; }

    const uniques = phrases.map((_, i) => i).filter((i) => reps[i].repeatOf == null);

    if (known && phraseErr) {
      // "Do you know this tune?" = yes, after the diagnostic. A unique phrase counts its repeats' errors too.
      const err = (u) => phrases.reduce((s, _, i) => s + ((i === u || reps[i].repeatOf === u) ? (phraseErr[i] || 0) : 0), 0);
      let prev = null;
      uniques.forEach((u) => {
        if (err(u) === 0) push({ type: 'recognise', chunk: [u], of: u, beads: 1 });
        else push({ type: 'echo', chunk: [u], beads: B(2), note: noteFor(u) });
        if (prev != null && (err(prev) > 0 || err(u) > 0)) pushJoin(prev, u);
        prev = u;
      });
      push({ type: 'whole', chunk: [], beads: B(2) });
    } else {
      // More than 4 unique phrases: two sections split at the middle unique phrase.
      const half = uniques.length > 4 ? Math.ceil(uniques.length / 2) : uniques.length;
      const sectionStarts = new Set([uniques[0], uniques.length > half ? uniques[half] : undefined].filter((x) => x != null));
      let learned = [];
      let section = [];
      let sectionStart = uniques[0];
      phrases.forEach((_, i) => {
        if (reps[i].repeatOf != null) { push({ type: 'recognise', chunk: [i], of: i, beads: 1 }); return; }
        if (sectionStarts.has(i) && i !== sectionStart) { sectionStart = i; section = []; }
        push({ type: 'echo', chunk: [i], beads: B(2), note: noteFor(i), ref: reps[i].shapeOf ?? reps[i].variantOf ?? null });
        if (learned.length >= 1) pushJoin(learned[learned.length - 1], i);
        learned.push(i);
        section.push(i);
        if (section.length >= 3 && section.length % 2 === 1) push({ type: 'memory', chunk: range(sectionStart, i + 1), beads: B(2) });
      });
      push({ type: 'whole', chunk: [], beads: B(2) });
    }
    const hash = Util.hash(JSON.stringify({ n: notes.map((x) => [x.midi, x.beats || 1]), p: phrases, k: Boolean(known) }));
    return { steps, hash, phrases, repeats: reps };
  }

  // Copies bead progress from an old chunk table to a new plan, for keys whose notes are unchanged.
  function carryChunks(oldChunks, plan) {
    const out = {};
    plan.steps.forEach((s) => {
      const c = oldChunks && oldChunks[s.key];
      if (c && c.sig === s.sig) out[s.key] = c;
    });
    return out;
  }

  // Call tempo for a chunk (§3.7.5): song bpm x tempo %, capped at 90 when a short note repeats its
  // neighbour's pitch, otherwise 120.
  function callBpmFor(notes, { bpm = 90, tempoPct = 100, slow = 1 } = {}) {
    let cap = 120;
    for (let k = 1; k < notes.length; k++) if ((notes[k].beats || 1) < 1 && notes[k].midi === notes[k - 1].midi) cap = 90;
    return Math.min((bpm * tempoPct) / 100, cap) * slow;
  }

  // ======================================================================
  // MATCHER (§3.7.5): a forgiving cursor over the expected notes for one attempt.
  // ======================================================================
  function makeMatcher(expected, {
    callEndPerf = -Infinity, attemptIdx = 0, callBpm = 90, tangleAt = null, maxMerged = 2, graceMs = 600,
    sessionRms = null, swallowMs = 1500, doubledSec = 0.25,
  } = {}) {
    const exp = expected || [];
    const n = exp.length;
    const spb = 60000 / callBpm;
    let longest = 0;
    for (let k = 0; k < n - 1; k++) longest = Math.max(longest, (exp[k].beats || 1) * spb);
    const lostMs = Math.max(4000, 2.5 * longest);
    const tangleLimit = tangleAt != null ? tangleAt : attemptIdx < 2 ? 6 : 4;
    const whiteTune = exp.every((e) => ![1, 3, 6, 8, 10].includes(pc(e.midi)));

    let i = 0;
    const onsets = new Array(n).fill(undefined);
    const merged = [];
    const wrongAt = [];
    const matchedRms = [];
    let wrong = 0;
    let swallowed = false;
    let doubled = 0;
    let selfFixed = false;
    let pendingFix = -1;
    let status = 'playing'; // playing | success | tangle
    let successAt = null;
    let lastInput = null;
    let lastMatch = null;
    let lostFlag = false;
    let octaveUp = 0;
    let matched = 0;
    const recent = [];

    const isBlack = (m) => [1, 3, 6, 8, 10].includes(pc(m));
    const nextRepeat = () => i > 0 && i < n && exp[i].midi === exp[i - 1].midi;
    const result = (kind, extra) => Object.assign({ kind, i, n, status, done: status !== 'playing', nextRepeat: nextRepeat() }, extra || {});

    function advance(ev, t, k) {
      onsets[k] = ev.at;
      if (ev.rms != null) matchedRms.push(ev.rms);
      if (ev.midi >= exp[k].midi + 12) octaveUp++;
      matched++;
      lastMatch = t;
    }

    function push(ev) {
      const t = ev.tOnset != null ? ev.tOnset : ev.at * 1000;
      if (status === 'success') return result(t - successAt < graceMs ? 'grace' : 'after');
      if (status !== 'playing') return result('ended');
      // 0. noise guards
      while (recent.length && t - recent[0] > 1000) recent.shift();
      recent.push(t);
      if (recent.length > 6) return result('noisy', { reason: 'burst' });
      if (sessionRms && ev.rms != null && sessionRms.length >= 4 && ev.rms < Util.median(sessionRms) / 5.6) {
        return result('noisy', { reason: 'quiet' });
      }
      lastInput = t;
      lostFlag = false;
      const p = pc(ev.midi);
      // 1. match
      if (p === pc(exp[i].midi)) {
        const k = i;
        advance(ev, t, k);
        if (pendingFix === k) selfFixed = true;
        pendingFix = -1;
        i++;
        if (i >= n) { status = 'success'; successAt = t; }
        return result('match', { index: k, octave: ev.midi - exp[k].midi });
      }
      // 2. doubled detection of the note just matched
      if (i > 0 && p === pc(exp[i - 1].midi) && onsets[i - 1] != null && ev.at - onsets[i - 1] < doubledSec &&
          pc(exp[i].midi) !== pc(exp[i - 1].midi)) {
        doubled++;
        return result('doubled');
      }
      // 3. merged repeat (a repeated note heard once)
      if (i > 0 && i + 1 < n && exp[i].midi === exp[i - 1].midi && p === pc(exp[i + 1].midi) && merged.length < maxMerged) {
        onsets[i] = null;
        merged.push(i);
        advance(ev, t, i + 1);
        pendingFix = -1;
        i += 2;
        if (i >= n) { status = 'success'; successAt = t; }
        return result('merged', { index: i - 1 });
      }
      // 4. swallowed first note (the call's tail masked it)
      if (i === 0 && n > 1 && p === pc(exp[1].midi) && t - callEndPerf < swallowMs) {
        onsets[0] = null;
        swallowed = true;
        advance(ev, t, 1);
        i = 2;
        if (i >= n) { status = 'success'; successAt = t; }
        return result('swallowed', { index: 1 });
      }
      // 5. wrong
      wrong++;
      wrongAt.push(i);
      pendingFix = i;
      if (wrong >= tangleLimit) status = 'tangle';
      return result('wrong', { black: whiteTune && isBlack(ev.midi), expected: exp[i] && exp[i].midi });
    }

    // Silence check, called on a timer. "Lost" never fires before the first note or during a held note.
    function tick(nowPerf) {
      if (status !== 'playing' || i === 0 || i >= n || lastInput == null) return { lost: false, lostMs };
      const held = (exp[i - 1].beats || 1) * spb;
      const lost = nowPerf - lastInput >= lostMs && (lastMatch == null || nowPerf - lastMatch >= held);
      const fresh = lost && !lostFlag;
      if (lost) lostFlag = true;
      return { lost, fresh, lostMs };
    }

    function state() {
      return {
        i, n, status, onsets: onsets.slice(), merged: merged.slice(), wrong, wrongAt: wrongAt.slice(), selfFixed,
        swallowed, doubled, matchedRms: matchedRms.slice(), octaveUp, matched, lostMs, tangleLimit, lastInput,
      };
    }
    return { push, tick, state, get i() { return i; }, get n() { return n; }, lostMs };
  }

  // ======================================================================
  // RHYTHM (§3.7.9)
  // ======================================================================
  function judgeRhythm(beats, onsets, { callBpm = 90, excludeHesitation = true } = {}) {
    let gaps = [];
    for (let i = 0; i + 1 < onsets.length; i++) {
      const a = onsets[i];
      const b = onsets[i + 1];
      if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) continue;
      gaps.push({ i, ioi: (b - a) * 1000, E: beats[i] || 1 });
    }
    if (gaps.length < 2) return { status: 'na' };
    const per = (gs) => Util.median(gs.map((g) => g.ioi / g.E));
    let beatMs = per(gaps);
    if (beatMs < 250 || beatMs > 1500) return { status: 'na', reason: 'tempo', beatMs };
    const hesitations = [];
    if (excludeHesitation) {
      // A hesitation is the odd long gap while finding a key. When many gaps are "long", they are the
      // rhythm itself (e.g. a lilt played evenly), so nothing is excluded.
      const long = gaps.filter((g) => g.ioi / g.E > 2 * beatMs);
      const allowed = Math.max(1, Math.floor(gaps.length / 4));
      const drop = long.length <= allowed ? new Set(long) : new Set();
      const kept = gaps.filter((g) => !drop.has(g));
      drop.forEach((g) => hesitations.push(g.i));
      if (kept.length < 2) return { status: 'na', hesitations };
      gaps = kept;
      beatMs = per(gaps);
      if (beatMs < 250 || beatMs > 1500) return { status: 'na', reason: 'tempo', beatMs };
    }
    const graded = gaps.map((g) => {
      const expMs = beatMs * g.E;
      const dev = g.ioi / expMs;
      const grade = Math.abs(g.ioi - expMs) <= 90 || (dev >= 0.77 && dev <= 1.3) ? 'good' : dev >= 0.62 && dev <= 1.6 ? 'close' : 'off';
      return { i: g.i, dev, grade, ioi: g.ioi, E: g.E };
    });
    // Long-short integrity: a note worth twice another must sound clearly longer.
    let short = false;
    graded.forEach((a) => {
      graded.forEach((b) => {
        if (a.E >= 2 * b.E && !(a.ioi > 1.4 * b.ioi)) {
          if (a.grade !== 'off') a.grade = 'off';
          a.short = true;
          short = true;
        }
      });
    });
    const ratios = gaps.map((g) => g.ioi / g.E);
    const mean = ratios.reduce((s, x) => s + x, 0) / ratios.length;
    const sd = Math.sqrt(ratios.reduce((s, x) => s + (x - mean) * (x - mean), 0) / ratios.length);
    const cv = mean > 0 ? sd / mean : 1;
    const steady = cv < 0.25;
    const good = graded.filter((g) => g.grade === 'good').length;
    const off = graded.filter((g) => g.grade === 'off').length;
    const pass = good / graded.length >= 0.8 && off === 0 && steady;
    let worst = graded[0];
    graded.forEach((g) => { if (Math.abs(Math.log(g.dev)) > Math.abs(Math.log(worst.dev))) worst = g; });
    const shortGap = graded.find((g) => g.short);
    if (shortGap) worst = shortGap;
    const bpm = 60000 / beatMs;
    const tempoRatio = bpm / callBpm;
    const tempoNote = tempoRatio > 1.5 ? 'faster' : tempoRatio < 0.67 ? 'slower' : null;
    return {
      status: 'ok', pass, beatMs, bpm, gaps: graded.map(({ i, dev, grade }) => ({ i, dev, grade })),
      worst: { i: worst.i, dir: worst.dev < 1 ? 'early' : 'late', short: Boolean(worst.short) },
      tempoRatio, tempoNote, steady, cv, short, hesitations,
    };
  }

  // ======================================================================
  // REVIEW (§3.7.11)
  // ======================================================================
  const REVIEW_INTERVALS = [0, 1, 2, 4, 7];
  const FOCUS = ['steady', 'softly', 'octave', 'plain'];

  // result: {wrong, n, prompted (bool|count), quit, heardFirst}
  function reviewOutcome(result) {
    const r = result || {};
    const prompts = typeof r.prompted === 'number' ? r.prompted : r.prompted ? 1 : 0;
    const n = r.n || 0;
    if (r.quit) return 'rusty';
    if ((r.wrong || 0) <= Math.floor(n / 20) && prompts === 0) return r.heardFirst ? 'stay' : 'clean';
    if ((r.wrong || 0) <= 4 && prompts <= 1) return 'stay';
    return 'rusty';
  }

  function scheduleReview(polish, result, today) {
    const p = Object.assign({ level: 0, due: null, last: null, focusIdx: 0 }, polish || {});
    const outcome = reviewOutcome(result);
    let level = p.level || 0;
    let due;
    if (outcome === 'clean') {
      level = Math.min(REVIEW_INTERVALS.length - 1, level + 1);
      due = Util.addDays(today, REVIEW_INTERVALS[level]);
    } else if (outcome === 'stay') {
      due = Util.addDays(today, 1);
    } else {
      level = Math.max(Math.min(level, 1), level - 1);
      due = Util.addDays(today, 1);
    }
    return Object.assign({}, p, {
      level, due, last: today, focusIdx: ((p.focusIdx || 0) + 1) % FOCUS.length, lastOutcome: outcome, brushUp: outcome === 'rusty',
    });
  }

  // Did a review meet its focus? ctx: {rhythm (judgeRhythm result), medianRms, prevMedianRms, octaveShare}
  function focusMet(focus, ctx) {
    const c = ctx || {};
    if (focus === 'steady') return Boolean(c.rhythm && c.rhythm.status === 'ok' && c.rhythm.pass);
    if (focus === 'softly') return c.medianRms > 0 && c.prevMedianRms > 0 && c.medianRms <= c.prevMedianRms / 2; // 6 dB
    if (focus === 'octave') return c.octaveShare >= 0.7;
    return true; // plain
  }

  // ======================================================================
  // FINGERING (§3.7.4 hand-position card)
  // ======================================================================
  const keyOf = (n) => n.key || n.letter + (n.acc || '') + (n.octave != null ? n.octave : Math.floor(n.midi / 12) - 1);

  function fingering(notes, phrases) {
    const list = notes || [];
    if (!list.length) return { thumbKey: 'C4', fingers: null, moves: [] };
    const lowest = (arr) => arr.reduce((lo, x) => (x.staffPos < lo.staffPos ? x : lo), arr[0]);
    const span = (arr) => Math.max(...arr.map((x) => x.staffPos)) - Math.min(...arr.map((x) => x.staffPos)) + 1;
    if (span(list) <= 5) {
      const thumb = lowest(list);
      return { thumbKey: keyOf(thumb), fingers: list.map((x) => x.staffPos - thumb.staffPos + 1), moves: [] };
    }
    const ph = phrases && phrases.length ? phrases : [[0, list.length]];
    const fingers = new Array(list.length).fill(null);
    const moves = [];
    let thumb = null;
    let firstThumb = null;
    ph.forEach(([a, b], p) => {
      const part = list.slice(a, b);
      if (span(part) > 5) return; // no numbers where a phrase spans more than 5 keys
      const fits = thumb && part.every((x) => x.staffPos >= thumb.staffPos && x.staffPos <= thumb.staffPos + 4);
      if (!fits) {
        const next = lowest(part);
        if (thumb) moves.push({ phrase: p, thumbKey: keyOf(next) });
        thumb = next;
        if (!firstThumb) firstThumb = next;
      }
      for (let k = a; k < b; k++) fingers[k] = list[k].staffPos - thumb.staffPos + 1;
    });
    const any = fingers.some((f) => f != null);
    return { thumbKey: keyOf(firstThumb || lowest(list)), fingers: any ? fingers : null, moves };
  }

  // ======================================================================
  // STAGES AND UNLOCKS (§3.7.10)
  // ======================================================================
  const STAGES = ['locked', 'listen', 'echo', 'whole', 'see', 'read', 'polish'];
  const rank = (s) => Math.max(0, STAGES.indexOf(s || 'locked'));
  const byEar = (t) => Boolean(t && (t.byEarAt || rank(t.stage) >= rank('see')));
  const isRead = (t) => Boolean(t && (t.readAt || rank(t.stage) >= rank('read')));
  const isSeen = (t) => Boolean(t && (t.seenAt || isRead(t)));

  // The path's tunes that exist in the library, in order. `songs` is an array or a get(id) function.
  function pathTunes(songs) {
    const get = typeof songs === 'function' ? songs : (id) => (songs || []).find((s) => s.id === id);
    return EAR_PATH.slice(1).map((id) => get(id)).filter(Boolean);
  }

  function r1Done(ear) {
    const r1 = (ear && ear.remix && ear.remix.r1) || {};
    return Object.keys(r1).some((k) => r1[k] >= 2);
  }

  function unlocks(earSlice, S, songs) {
    const ear = earSlice || {};
    const tunes = ear.tunes || {};
    const list = pathTunes(songs);
    const out = {};
    const opened = r1Done(ear) || Boolean(ear.remix && ear.remix.skipped);
    out['remix-start'] = { listen: true, echo: true, see: false, read: false, remix: true, r2: opened, stage: opened ? 'done' : 'listen' };
    list.forEach((song, n) => {
      const t = tunes[song.id] || {};
      const prev = n > 0 ? tunes[list[n - 1].id] || {} : null;
      const prev2 = n > 1 ? tunes[list[n - 2].id] || {} : null;
      const listen = n === 0 ? opened : rank(prev.stage) >= rank('echo') || rank(t.stage) >= rank('listen');
      const prevByEar = n === 0 ? true : byEar(prev);
      const lagOk = n < 2 ? true : isRead(prev2) && Boolean(prev2.coldReadAt);
      const echo = listen && prevByEar && lagOk;
      const heard = (ear.listening && ear.listening.heard && ear.listening.heard[song.id]) || 0;
      out[song.id] = {
        n,
        stage: rank(t.stage) > 0 ? t.stage : listen ? 'listen' : 'locked',
        listen,
        echo,
        earsReady: heard >= 3,
        whole: echo,
        see: byEar(t),
        read: isSeen(t),
        remix: byEar(t),
        why: !listen ? 'locked' : !prevByEar ? 'prev' : !lagOk ? 'lag' : null,
        lagTitle: !lagOk && n >= 2 ? list[n - 2].title : null,
        prevTitle: n > 0 ? list[n - 1].title : null,
      };
    });
    return out;
  }

  function concertOpen(earSlice) {
    const tunes = (earSlice && earSlice.tunes) || {};
    return Object.keys(tunes).filter((id) => tunes[id] && tunes[id].polish && tunes[id].polish.level >= 2).length >= 3;
  }

  // ======================================================================
  // LISTENING ROOM COUNTING (§3.7.4)
  // ======================================================================
  // Moves the play position from `fromPos` by `elapsedSec` of track time and counts every tune span
  // whose 80% point is passed. layout: [{id, start, end}] in seconds.
  function countListens(layout, duration, fromPos, elapsedSec, loop) {
    const counts = {};
    if (!(duration > 0) || !(elapsedSec > 0)) return { counts, endPos: fromPos || 0, ended: false };
    const p0 = fromPos || 0;
    let p1 = p0 + elapsedSec;
    let ended = false;
    if (!loop && p1 >= duration) { p1 = duration; ended = true; }
    (layout || []).forEach((L) => {
      const t80 = L.start + 0.8 * (L.end - L.start);
      let c = 0;
      if (loop) {
        for (let k = Math.floor((p0 - t80) / duration); t80 + k * duration <= p1 + EPS; k++) {
          const t = t80 + k * duration;
          if (t > p0 + EPS && t <= p1 + EPS) c++;
        }
      } else if (t80 > p0 + EPS && t80 <= p1 + EPS) c = 1;
      if (c) counts[L.id] = (counts[L.id] || 0) + c;
    });
    return { counts, endPos: loop ? p1 % duration : p1, ended };
  }

  // A day counts at 120 s or 5 listens. One rest day per rolling 7 days keeps the streak.
  function updateStreak(listening, today) {
    const L = listening;
    L.days = L.days || {};
    L.streak = L.streak || { count: 0, lastDay: null, restDays: [] };
    L.streak.restDays = L.streak.restDays || [];
    const d = L.days[today] || { secs: 0, listens: 0 };
    const qualifies = d.secs >= 120 || d.listens >= 5;
    let restUsed = false;
    if (qualifies && L.streak.lastDay !== today) {
      const gap = L.streak.lastDay ? Util.daysBetween(L.streak.lastDay, today) : Infinity;
      const restRecent = L.streak.restDays.some((r) => Util.daysBetween(r, today) < 7);
      if (gap === 1) L.streak.count += 1;
      else if (gap === 2 && !restRecent) {
        L.streak.restDays.push(Util.addDays(today, -1));
        L.streak.count += 1;
        restUsed = true;
      } else L.streak.count = 1;
      L.streak.lastDay = today;
    }
    // prune: listening days to 60, rest days to 14
    Object.keys(L.days).forEach((k) => { if (Util.daysBetween(k, today) > 60) delete L.days[k]; });
    L.streak.restDays = L.streak.restDays.filter((r) => Util.daysBetween(r, today) <= 14);
    return { listening: L, restUsed };
  }

  // The streak as shown today (0 once it has lapsed).
  function streakNow(listening, today) {
    const s = listening && listening.streak;
    if (!s || !s.lastDay || !s.count) return 0;
    const gap = Util.daysBetween(s.lastDay, today);
    if (gap <= 1) return s.count;
    const restRecent = (s.restDays || []).some((r) => Util.daysBetween(r, today) < 7);
    if (gap === 2 && !restRecent) return s.count;
    return 0;
  }

  // ======================================================================
  // COLD READ TARGET (§3.7.10 ★)
  // ======================================================================
  // songs: library array; ctx: {pathIds, tunes, practised(id), introduced(key), known(key), comfort(song)}
  function pickColdRead(tune, songs, ctx) {
    const c = ctx || {};
    const tuneKeys = new Set(tune.keys || (tune.notes || []).map(keyOf));
    const skip = new Set(c.pathIds || []);
    return (songs || []).find((s) => {
      if (s.id === tune.id || skip.has(s.id) || (c.tunes && c.tunes[s.id])) return false;
      if (c.practised && c.practised(s.id)) return false;
      const keys = s.keys || [...new Set((s.notes || []).map(keyOf))];
      if (!keys.every((k) => (c.introduced ? c.introduced(k) : true))) return false;
      const label = c.comfort ? c.comfort(s) : 'right';
      if (label !== 'right' && label !== 'easy') return false;
      return keys.every((k) => tuneKeys.has(k) || (c.known ? c.known(k) : false));
    }) || null;
  }

  // New notes in a path tune: its keys minus the keys of earlier path tunes.
  function newNotesIn(songId, songs) {
    const list = pathTunes(songs);
    const seen = new Set();
    for (const s of list) {
      const keys = s.keys || [...new Set((s.notes || []).map(keyOf))];
      if (s.id === songId) return keys.filter((k) => !seen.has(k));
      keys.forEach((k) => seen.add(k));
    }
    return [];
  }

  const api = {
    EAR_PATH, REMIX_PATTERNS, REMIX_LEVELS, DUR_OF, STAGES, REVIEW_INTERVALS, FOCUS, MAX_CALL_NOTES,
    remixItems, segment, phrasesFor, validPhrases, findRepeats, buildChunkPlan, carryChunks, chunkKey, callBpmFor,
    makeMatcher, judgeRhythm, reviewOutcome, scheduleReview, focusMet, fingering, keyOf,
    rank, byEar, isRead, isSeen, pathTunes, unlocks, concertOpen, r1Done,
    countListens, updateStreak, streakNow, pickColdRead, newNotesIn,
  };
  if (isNode) module.exports = api;
  else (root.NS = root.NS || {}).EarCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
