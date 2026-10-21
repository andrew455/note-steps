// The course: units of new notes, song levels and comfort, what to do next, generated reading, the
// drill deck and the note check. UMD, pure: NS.curriculum in the browser, require('./curriculum.js') in
// Node. Rules: spec §3.2.1, §3.2.6, §3.2.7, §3.3.1, §3.3.4 and §3.8.2 (binding).
//
// S is the v2 store state (or any object with {notes, course, slices?}). Functions that change the
// course (introduce, placement) mutate S and return it; the rest only read.
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const Util = isNode ? require('./util.js') : root.Util;
  const Mastery = isNode ? require('./mastery.js') : root.NS.Mastery;
  const { dayKey, addDays, mulberry32, median, hash } = Util;

  const UNITS = [
    { notes: ['C4', 'D4'], stage: 1 }, { notes: ['E4'], stage: 1 }, { notes: ['F4'], stage: 2 }, { notes: ['G4'], stage: 2 },
    { notes: ['A4'], stage: 3 }, { notes: ['B4'], stage: 3 }, { notes: ['C5'], stage: 3 },
    { notes: ['D5'], stage: 4 }, { notes: ['E5'], stage: 4 }, { notes: ['F5'], stage: 4 }, { notes: ['G5'], stage: 4 },
  ];
  const STAGES = ['Middle C home', 'Up to G', 'Up to treble C', 'Top of the staff'];
  const UNIT_OF = {};
  UNITS.forEach((u, i) => u.notes.forEach((k) => (UNIT_OF[k] = i)));
  const COURSE_KEYS = Object.keys(UNIT_OF);

  // Landmarks, taught as anchors (never mnemonics).
  const NOTE_INFO = {
    C4: { text: 'Middle C. Its own short line below the staff.', anchor: null },
    D4: { text: 'Hangs just below the bottom line.', anchor: { from: 'C4', dist: 'step up' } },
    E4: { text: 'Bottom line.', anchor: { from: 'D4', dist: 'step up' } },
    F4: { text: 'First space.', anchor: { from: 'E4', dist: 'step up' } },
    G4: { text: 'Second line. The treble clef curls around it.', anchor: { from: 'E4', dist: 'skip up' } },
    A4: { text: 'Second space.', anchor: { from: 'G4', dist: 'step up' } },
    B4: { text: 'Middle line.', anchor: { from: 'G4', dist: 'skip up' } },
    C5: { text: 'Third space. Treble C, an octave above middle C.', anchor: { from: 'C4', dist: 'octave up' } },
    D5: { text: 'Fourth line.', anchor: { from: 'C5', dist: 'step up' } },
    E5: { text: 'Top space.', anchor: { from: 'C5', dist: 'skip up' } },
    F5: { text: 'Top line.', anchor: { from: 'E5', dist: 'step up' } },
    G5: { text: 'Sits just above the top line.', anchor: { from: 'F5', dist: 'step up' } },
  };
  const COMFORT_TEXT = { locked: 'Locked', easy: 'Easy', right: 'Just right', stretch: 'Stretch', tough: 'Tough' };

  // ---------- keys ----------
  const LETTERS = 'CDEFGAB';
  const letterOf = (key) => key[0];
  // 'One step up from G' (or null for C4).
  function anchorText(key) {
    const info = NOTE_INFO[key];
    if (!info || !info.anchor) return null;
    const { from, dist } = info.anchor;
    return `${dist === 'octave up' ? 'An octave' : 'One ' + dist.replace(' up', '')} up from ${from === 'C4' ? 'middle C' : letterOf(from)}`;
  }
  function staffPosOf(key) {
    const m = /^([A-G])([#b♯♭]?)(-?\d)$/.exec(key);
    if (!m) return 0;
    return Number(m[3]) * 7 + LETTERS.indexOf(m[1]) - 30;
  }
  const noteKey = (n) => n.key || n.letter + (n.acc || '') + (n.octave != null ? n.octave : Math.floor(n.midi / 12) - 1);
  const tokens = (song) => (song.notes || []).map(noteKey);
  function songKeys(song) {
    if (song.keys) return song.keys;
    return [...new Set(tokens(song))];
  }
  const notesOf = (S) => (S && S.notes) || {};
  // Introduced course notes, in unit order.
  const introducedKeys = (S) => COURSE_KEYS.filter((k) => notesOf(S)[k]);
  const stateOf = (S, k) => Mastery.state(notesOf(S)[k]);

  // ---------- songs ----------
  function songLevel(song) {
    let max = -1;
    for (const k of songKeys(song)) {
      if (!(k in UNIT_OF)) return Infinity;
      max = Math.max(max, UNIT_OF[k]);
    }
    return max;
  }

  // distinct + 6*leapRate + 3*skipRate + len/40 + 0.5*(#dotted/eighth types)
  function songDiff(song) {
    const ns = song.notes || [];
    const pos = ns.map((n) => (n.staffPos != null ? n.staffPos : staffPosOf(noteKey(n))));
    let leaps = 0;
    let skips = 0;
    for (let i = 1; i < pos.length; i++) {
      const d = Math.abs(pos[i] - pos[i - 1]);
      if (d >= 3) leaps++;
      else if (d === 2) skips++;
    }
    const iv = Math.max(1, pos.length - 1);
    const types = new Set(ns.map((n) => n.dur || 'q').filter((d) => d.endsWith('.') || d[0] === 'e' || d[0] === 's'));
    return new Set(tokens(song)).size + 6 * (leaps / iv) + 3 * (skips / iv) + ns.length / 40 + 0.5 * types.size;
  }

  // Keys outside the course (G3 in the low Frère Jacques) can never be introduced: they count like a new
  // note (0.4) and are listed in outsideKeys, never in lockedKeys.
  function comfort(song, S, now) {
    const N = notesOf(S);
    const toks = tokens(song);
    const lockedKeys = [];
    const newKeys = [];
    const outsideKeys = [];
    let sum = 0;
    let known = 0;
    const famOf = {};
    for (const k of songKeys(song)) {
      if (!(k in UNIT_OF)) { outsideKeys.push(k); famOf[k] = 0.4; continue; }
      const st = Mastery.state(N[k]);
      if (st === 'locked') lockedKeys.push(k);
      if (st === 'new') newKeys.push(k);
      famOf[k] = Mastery.fam(N[k], now);
    }
    for (const k of toks) {
      sum += famOf[k] ?? 0.4;
      if (Mastery.state(N[k]) === 'known') known++;
    }
    const C = toks.length ? Math.round((sum / toks.length) * 1e9) / 1e9 : 1; // rounded so 0.7 stays 0.7
    const label = lockedKeys.length ? 'locked' : C >= 0.97 ? 'easy' : C >= 0.85 ? 'right' : C >= 0.7 ? 'stretch' : 'tough';
    return { label, C, knownShare: toks.length ? known / toks.length : 0, lockedKeys, newKeys, outsideKeys };
  }

  // ---------- introducing notes ----------
  const MAX_LEARNING = 4;
  function introGate(S) {
    const next = UNITS[S.course.unit];
    if (!next) return 'done';
    const N = notesOf(S);
    const notKnown = introducedKeys(S).filter((k) => Mastery.state(N[k]) !== 'known');
    const solid = notKnown.every((k) => N[k].acc >= 0.8 && N[k].n >= 8);
    const okish = notKnown.every((k) => N[k].acc >= 0.7 && N[k].n >= 6);
    if (solid && notKnown.length + next.notes.length <= MAX_LEARNING) return 'open';
    return okish ? 'soft' : 'closed';
  }
  function introduce(S, u, today) {
    S.notes = S.notes || {};
    for (const k of UNITS[u].notes) if (!S.notes[k]) S.notes[k] = Mastery.newRecord(today);
    S.course.unit = Math.max(S.course.unit, u + 1);
    return S;
  }

  // Fast lane: every introduced note known with rt <= 1500 -> offer the next two single-note units.
  function fastLane(S) {
    const N = notesOf(S);
    const keys = introducedKeys(S);
    const u = S.course.unit;
    return keys.length > 0 && keys.every((k) => N[k].k && N[k].rt != null && N[k].rt <= 1500) &&
      UNITS[u] && UNITS[u + 1] && UNITS[u].notes.length === 1 && UNITS[u + 1].notes.length === 1;
  }

  // ---------- what to do next ----------
  function weakShare(song, S, now) {
    const N = notesOf(S);
    const toks = tokens(song);
    if (!toks.length) return 0;
    let weak = 0;
    for (const k of toks) {
      const r = N[k];
      const st = Mastery.state(r);
      if ((st === 'learning' && r.acc < 0.8) || Mastery.rusty(r, now)) weak++;
    }
    return weak / toks.length;
  }
  const practiceOf = (S, id) => (S.slices && S.slices.practice && S.slices.practice.songs && S.slices.practice.songs[id]) || {};

  function recommend(S, songs, now) {
    const u = S.course.unit;
    const newest = u > 0 && UNITS[u - 1] ? UNITS[u - 1].notes : [];
    const scored = [];
    for (const song of songs || []) {
      if (!(songLevel(song) < u)) continue;
      const c = comfort(song, S, now);
      if (c.lockedKeys.length) continue;
      const p = practiceOf(S, song.id);
      const plays = p.plays || 0;
      const keys = songKeys(song);
      const len = (song.notes || []).length;
      const score = -20 * Math.abs(c.C - 0.92) + 4 * weakShare(song, S, now) +
        (newest.some((k) => keys.includes(k)) ? 1.5 : 0) + (plays === 0 ? 2 : 0) -
        (p.last && now - p.last < 30 * 60000 ? 5 : 0) - 0.3 * Math.min(plays, 10) - 0.05 * Math.max(0, len - 40);
      scored.push({ song, score, len, C: c.C, comfort: c });
    }
    // Ties (e.g. every note still new) go to the shorter song, then library order (the sort is stable).
    scored.sort((a, b) => (Math.abs(b.score - a.score) > 1e-9 ? b.score - a.score : a.len - b.len));
    const gate = introGate(S, now);
    if (gate === 'open' && (!scored.length || scored[0].C >= 0.95)) {
      const out = { kind: 'meet', unit: u };
      if (fastLane(S)) out.pair = u + 1;
      return out;
    }
    if (!scored.length) return { kind: 'run' };
    return { kind: 'song', song: scored[0].song, alts: scored.slice(1, 3).map((x) => x.song), C: scored[0].C, comfort: scored[0].comfort };
  }

  const nameOf = (key) => (key === 'C4' ? 'middle C' : letterOf(key));
  const listText = (arr) => (arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1]);
  const runSeed = (now) => parseInt(hash(dayKey(now)), 16);

  function meetStep(S, unit, pair) {
    const keys = UNITS[unit].notes.concat(pair != null && UNITS[pair] ? UNITS[pair].notes : []);
    const letters = keys.map(letterOf);
    if (unit === 0) {
      return { kind: 'meet', unit, keys, title: 'Meet your first notes: C and D', sub: 'Your first notes are middle C and D.', route: '#/drill?meet=' + keys.join(',') };
    }
    const k = keys[0];
    const anchor = anchorText(k);
    return {
      kind: 'meet', unit, keys,
      title: keys.length > 1 ? `Meet ${listText(letters)} together` : `Meet a new note: ${letters[0]}`,
      sub: NOTE_INFO[k].text + (anchor ? ` ${anchor}.` : ''),
      route: '#/drill?meet=' + keys.join(','),
    };
  }

  // -> {kind:'check'|'meet'|'song'|'run', title, sub, route, ...}
  function nextStep(S, songs, now) {
    const c = S.course;
    if (!c.checkDone && S.migratedFrom && !(c.checkSnoozeUntil && now < c.checkSnoozeUntil)) {
      return { kind: 'check', title: 'Take a 2-minute note check', sub: 'So the app knows what you can already read.', route: '#/drill?check=1' };
    }
    if (c.unit === 0) return meetStep(S, 0);
    const r = recommend(S, songs, now);
    if (r.kind === 'meet') return meetStep(S, r.unit, r.pair);
    if (r.kind === 'song') {
      return {
        kind: 'song', song: r.song, alts: r.alts,
        title: 'Read: ' + r.song.title,
        sub: `${COMFORT_TEXT[r.comfort.label]} · ${Math.round(100 * r.C)}% known`,
        route: '#/practice/' + r.song.id,
        altRoutes: r.alts.map((s) => ({ title: s.title, route: '#/practice/' + s.id })),
      };
    }
    const seed = runSeed(now);
    return { kind: 'run', seed, title: 'A short reading run', sub: '16 notes, all ones you have met.', route: '#/practice/run?seed=' + seed };
  }

  // ---------- generated reading ----------
  // Neighbour weights by distance in the (staff-sorted) pool: repeat 0.1, step 0.6, skip 0.25, leap 0.05.
  function walkPick(pool, cur, allowed, rng) {
    const cand = [];
    let leaps = 0;
    for (let i = 0; i < pool.length; i++) if (allowed(i) && Math.abs(i - cur) >= 3) leaps++;
    for (let i = 0; i < pool.length; i++) {
      if (!allowed(i)) continue;
      const d = cur < 0 ? 1 : Math.abs(i - cur);
      const w = d === 0 ? 0.1 : d === 1 ? 0.3 : d === 2 ? 0.125 : 0.05 / leaps;
      cand.push([i, w]);
    }
    if (!cand.length) return cur;
    let total = 0;
    cand.forEach((c) => (total += c[1]));
    let x = rng() * total;
    for (const [i, w] of cand) { x -= w; if (x < 0) return i; }
    return cand[cand.length - 1][0];
  }

  function genPhrase(poolKeys, focusKeys, { len = 12, focusShare = 0.35, seed = 1 } = {}) {
    let pool = [...new Set(poolKeys && poolKeys.length ? poolKeys : ['C4', 'D4'])];
    pool.sort((a, b) => staffPosOf(a) - staffPosOf(b));
    const focus = new Set((focusKeys || []).filter((k) => pool.includes(k)));
    const rng = mulberry32(seed);
    const isFocus = (i) => focus.has(pool[i]);
    const anyNon = pool.some((k) => !focus.has(k));
    const out = [];
    let cur = -1;
    for (let t = 0; t < len - 1; t++) {
      const wantFocus = focus.size && (rng() < focusShare || !anyNon);
      cur = walkPick(pool, cur, wantFocus ? isFocus : focus.size ? (i) => !isFocus(i) : () => true, rng);
      out.push(pool[cur]);
    }
    // End on the nearest home note (C4 / G4 / C5) in the pool, as a half note.
    const homes = ['C4', 'G4', 'C5'].filter((k) => pool.includes(k));
    const lastPos = cur < 0 ? staffPosOf(pool[0]) : staffPosOf(pool[cur]);
    const end = homes.length
      ? homes.reduce((a, b) => (Math.abs(staffPosOf(b) - lastPos) < Math.abs(staffPosOf(a) - lastPos) ? b : a))
      : pool[cur < 0 ? 0 : cur];
    out.push(end + ':h');
    const parts = [];
    out.forEach((tok, i) => { parts.push(tok); if (i % 4 === 3 && i < out.length - 1) parts.push('/'); });
    return parts.join(' ');
  }

  // 16 notes over the introduced notes, leaning a little (0.15) on the ones still being learned.
  function readingRun(S, seed) {
    const pool = introducedKeys(S);
    const focus = pool.filter((k) => stateOf(S, k) === 'learning');
    return genPhrase(pool.length ? pool : ['C4', 'D4'], focus, { len: 16, focusShare: 0.15, seed });
  }

  // ---------- Note Drill deck (§3.3.1) ----------
  function flashDeck(S, { focusKey = null, size = 15, rng = null, now = 0 } = {}) {
    const N = notesOf(S);
    const keys = introducedKeys(S);
    if (!keys.length) return [];
    rng = rng || mulberry32(Math.floor(now) || 1);
    const isWeak = (k) => (Mastery.state(N[k]) === 'learning' && N[k].acc < 0.8) || Mastery.rusty(N[k], now);
    const partners = new Set();
    keys.filter(isWeak).forEach((k) => {
      Object.entries(N[k].conf || {}).sort((a, b) => b[1] - a[1]).slice(0, 2).forEach(([p]) => partners.add(p));
    });
    const fpos = focusKey ? staffPosOf(focusKey) : 0;
    const weight = {};
    for (const k of keys) {
      const r = N[k];
      const st = Mastery.state(r);
      let w = st === 'new' ? 3 : st === 'learning' ? 2 + 3 * (1 - r.acc) : 0.5;
      if (Mastery.rusty(r, now)) w += 2;
      if (r.rt != null && r.rt > 3000) w += 1;
      if (partners.has(k)) w += 1.5;
      if (focusKey) w = k === focusKey ? 10 : Math.abs(staffPosOf(k) - fpos) <= 2 ? 3 : 0.3;
      weight[k] = w;
    }
    if (keys.length === 1) return Array(size).fill(keys[0]);
    if (keys.length === 2) {
      const first = weight[keys[0]] >= weight[keys[1]] ? 0 : 1;
      return Array.from({ length: size }, (_, i) => keys[(first + i) % 2]);
    }
    // At least 70% of cards from comfortable keys (acc >= 0.6 or known); the focus key is exempt.
    const easy = (k) => k === focusKey || N[k].k === 1 || N[k].acc >= 0.6;
    const haveEasy = keys.some(easy);
    const maxHard = Math.floor(size * 0.3);
    const deck = [];
    let hard = 0;
    let focusN = 0;
    const focusMin = focusKey && keys.includes(focusKey) ? Math.ceil(size * 0.4) : 0;
    for (let i = 0; i < size; i++) {
      const prev = deck[i - 1];
      let cand = keys.filter((k) => k !== prev);
      // A focused deck keeps the focus key at >= 40%: after any other card it comes back 80% of the
      // time, and always when that is the only way left to reach 40%.
      if (focusMin && prev !== focusKey) {
        const left = size - i;
        if (focusMin - focusN >= Math.ceil(left / 2) || rng() < 0.8) cand = [focusKey];
      } else if (focusMin) cand = cand.filter((k) => k !== focusKey);
      if (haveEasy && hard >= maxHard) {
        const e = cand.filter(easy);
        if (e.length) cand = e;
      }
      let total = 0;
      cand.forEach((k) => (total += weight[k]));
      let x = rng() * total;
      let pick = cand[cand.length - 1];
      for (const k of cand) { x -= weight[k]; if (x < 0) { pick = k; break; } }
      if (!easy(pick)) hard++;
      if (pick === focusKey) focusN++;
      deck.push(pick);
    }
    return deck;
  }

  // ---------- Note check (§3.3.4) ----------
  function placementOrder(S) {
    const intro = introducedKeys(S);
    return intro.length ? intro : COURSE_KEYS.slice();
  }

  const FAST_MS = 4000;
  function normResult(r) {
    if (Array.isArray(r.cards)) {
      const ok = r.cards.filter((c) => c.ok);
      return {
        key: r.key,
        reads: ok.filter((c) => c.rtMs != null && c.rtMs < FAST_MS).length,
        total: r.cards.length,
        rt: ok.length ? median(ok.map((c) => c.rtMs).filter((x) => x != null)) : null,
      };
    }
    return { key: r.key, reads: r.reads || 0, total: r.total ?? 2, rt: r.rt ?? null };
  }
  function promote(rec, rt, now, today) {
    Object.assign(rec, {
      acc: Math.max(rec.acc, 0.9), streak: Math.max(rec.streak, 5), reads: Math.max(rec.reads, 12),
      seen: Math.max(rec.seen, 12), n: Math.max(rec.n, 12), box: Math.max(rec.box, 2), due: addDays(today, 2),
      k: 1, knownAt: now, day: { d: today, r: 0, m: 0 },
    });
    if (rt != null && Number.isFinite(rt)) rec.rt = rt;
    else if (rec.rt == null) rec.rt = 2500;
  }
  const asLearning = (rec, acc) => Object.assign(rec, { acc, k: 0, seen: Math.max(rec.seen, 4), n: Math.max(rec.n, 4) });

  // results: [{key, cards:[{ok, rtMs}]}] | [{key, reads, total, rt}]. Mutates S.
  // -> {changes:[{key, before, after}], units:int[] newly introduced, promoted:keys[], unit}
  function placement(S, results, { now = 0, single = false } = {}) {
    const today = dayKey(now);
    S.notes = S.notes || {};
    const N = S.notes;
    const rs = results.map(normResult).filter((r) => r.key in UNIT_OF);
    const before = {};
    COURSE_KEYS.forEach((k) => (before[k] = Mastery.state(N[k])));
    const hadUnit = UNITS.map((u) => u.notes.some((k) => N[k]));
    const promoted = [];
    const ensure = (k) => (N[k] = N[k] || Mastery.newRecord(today));

    if (single || (rs.length === 1 && rs[0].total >= 5)) {
      const r = rs[0];
      if (r && r.total >= 5 && r.reads === r.total) {
        promote(ensure(r.key), r.rt, now, today);
        promoted.push(r.key);
        S.course.unit = Math.max(S.course.unit, UNIT_OF[r.key] + 1);
      }
    } else {
      for (const r of rs) {
        if (r.total >= 2 && r.reads === r.total) { promote(ensure(r.key), r.rt, now, today); promoted.push(r.key); }
        else if (r.reads >= 1) asLearning(ensure(r.key), 0.75);
        else if (N[r.key]) asLearning(N[r.key], 0.5); // tested, none read: only notes already met stay in
      }
      let top = -1;
      for (const k of COURSE_KEYS) {
        const st = Mastery.state(N[k]);
        if (st === 'known' || st === 'learning') top = Math.max(top, UNIT_OF[k]);
      }
      S.course.unit = Math.max(S.course.unit, top + 1);
      S.course.checkDone = true;
      S.course.placementAt = now;
    }
    // Every note below the course line has a record (a skipped one starts as new).
    for (let u = 0; u < S.course.unit && u < UNITS.length; u++) UNITS[u].notes.forEach(ensure);
    const changes = COURSE_KEYS.map((k) => ({ key: k, before: before[k], after: Mastery.state(N[k]) })).filter((c) => c.before !== c.after);
    const units = UNITS.map((u, i) => i).filter((i) => !hadUnit[i] && UNITS[i].notes.some((k) => N[k]));
    return { changes, units, promoted, unit: S.course.unit };
  }

  const api = {
    UNITS, STAGES, UNIT_OF, NOTE_INFO, COMFORT_TEXT, MAX_LEARNING, songLevel, songDiff, comfort, introGate, introduce,
    recommend, nextStep, genPhrase, readingRun, flashDeck, placementOrder,
    // extras for the browser wrapper, WP4 and WP9
    songKeys, staffPosOf, introducedKeys, anchorText, placement, fastLane,
  };
  if (isNode) module.exports = api;
  else (root.NS = root.NS || {}).curriculum = api;
})(typeof window !== 'undefined' ? window : globalThis);
