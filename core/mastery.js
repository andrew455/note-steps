// Per-note mastery. Pure part (UMD): Mastery.* (NS.Mastery in the browser, require('./mastery.js') in
// Node). Browser wrapper: NS.mastery, which reads and writes the 'notes', 'shapes', 'course' and 'log'
// sections of NS.store and emits mastery:changed, note:known / note:unknown and unit:introduced.
//
// Rules: spec §3.2 (binding). A note is locked (no record), new (seen < 4), learning, or known (k = 1);
// rusty is a flag on known notes past their review day. Evidence is an accuracy EWMA weighted by source,
// plus a Leitner box that only moves once per practice day (rollDay), so cramming can't promote twice.
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const Util = isNode ? require('./util.js') : root.Util;
  const { dayKey, addDays, clamp01 } = Util;

  const W_SRC = { song: 1, intro: 1, flash: 1, hear: 0.6, perform: 0.5, ear: 0, free: 0 };
  const INTERVALS = [0, 1, 2, 4, 8, 16, 32];
  const T = { acc0: 0.5, alpha: 0.15, knownAcc: 0.85, demoteAcc: 0.6, knownStreak: 5, knownRt: 3000, knownReads: 12, knownBox: 2, newSeen: 4 };

  function newRecord(today) {
    return {
      acc: T.acc0, n: 0, seen: 0, reads: 0, miss: 0, asst: 0, streak: 0, rt: null, box: 0, due: today,
      k: 0, intro: today, knownAt: 0, last: 0, day: null, conf: {},
    };
  }

  const songFactor = (plays) => (plays < 3 ? 1 : plays <= 5 ? 0.7 : 0.5);

  const copy = (rec) => Object.assign({}, rec, { day: rec.day && Object.assign({}, rec.day), conf: Object.assign({}, rec.conf) });

  // Closes the previous practice day: a good day on or after `due` moves the box up, a lapse day drops it 2.
  // Mutates and returns rec (record() passes a copy).
  function rollDay(rec, now) {
    const today = dayKey(now);
    if (!rec.day) { rec.day = { d: today, r: 0, m: 0 }; return rec; }
    if (rec.day.d >= today) return rec; // same day, or the clock went backwards
    const { d, r: g, m } = rec.day;
    const tot = g + m;
    const good = g >= 3 && g / tot >= 0.8;
    const lapse = tot >= 3 && m / tot > 0.34;
    if (good && d >= rec.due) { rec.box = Math.min(rec.box + 1, INTERVALS.length - 1); rec.due = addDays(d, INTERVALS[rec.box]); }
    else if (lapse) { rec.box = Math.max(0, rec.box - 2); rec.due = addDays(d, 1); }
    rec.day = { d: today, r: 0, m: 0 };
    return rec;
  }

  function updateKnown(rec, now) {
    const was = rec.k;
    if (!rec.k && rec.box >= T.knownBox && rec.acc >= T.knownAcc && rec.streak >= T.knownStreak &&
        rec.rt != null && rec.rt <= T.knownRt && rec.reads >= T.knownReads) {
      rec.k = 1;
      rec.knownAt = now;
    } else if (rec.k && (rec.acc < T.demoteAcc || rec.box < T.knownBox)) rec.k = 0;
    return { rec, change: was === rec.k ? null : rec.k ? 'known' : 'unknown' };
  }

  // ev: {outcome:'read'|'assisted'|'miss', source, rtMs, repeat, playedKey, songPlays, confident, firstToken, ts}
  // Pure: returns a new record. A locked note (no record) is ignored, never auto-introduced.
  function record(rec, ev, now) {
    if (!rec) return { rec, change: null };
    rec = rollDay(copy(rec), now);
    if (ev.outcome === 'miss' && ev.confident === false) return { rec, change: null };
    let w = (W_SRC[ev.source] ?? 0) * songFactor(ev.songPlays || 0);
    if (ev.repeat) w *= 0.5;
    if (ev.outcome === 'assisted') w *= 0.5;
    rec.seen++; // drives new -> learning even when w = 0
    if (w > 0) {
      const x = ev.outcome === 'read' ? 1 : ev.outcome === 'assisted' ? 0.7 : 0;
      rec.acc = clamp01(rec.acc + T.alpha * w * (x - rec.acc));
      rec.n += w;
      if (ev.outcome === 'read' && w >= 0.5 && !ev.repeat) {
        rec.streak++; rec.reads++; rec.day.r++;
        if (ev.rtMs != null && ev.rtMs <= 15000 && !ev.firstToken) {
          rec.rt = rec.rt == null ? ev.rtMs : rec.rt + 0.25 * (Math.min(ev.rtMs, 8000) - rec.rt);
        }
      } else if (ev.outcome === 'miss') {
        rec.streak = 0; rec.day.m++; rec.miss++;
        if (ev.playedKey) rec.conf[ev.playedKey] = (rec.conf[ev.playedKey] || 0) + 1;
      } else rec.asst++;
    }
    rec.last = ev.ts ?? now;
    return updateKnown(rec, now);
  }

  function state(rec) {
    if (!rec) return 'locked';
    if (rec.k) return 'known';
    return rec.seen < T.newSeen ? 'new' : 'learning';
  }

  const rusty = (rec, now) => Boolean(rec && rec.k && dayKey(now) > rec.due);

  // How long (ms) before a note's name label appears. Infinity = never; 0 = straight away. §3.2.5
  function labelDelay(rec, { labels = 'auto', refresh = 0, guard = false } = {}) {
    if (labels === 'always') return 0;
    if (refresh > 0) return 0;
    if (labels === 'never') return Infinity;
    const st = state(rec);
    if (st === 'locked') return 0;
    if (st === 'known') return Infinity;
    if (guard && st !== 'new') return 0;
    if (st === 'new') return rec.seen < 2 ? 0 : 1000;
    return rec.acc < 0.6 ? 1500 : rec.acc < 0.8 ? 3000 : 5000;
  }

  // Display ring, 0..100.
  function pct(rec) {
    if (!rec) return 0;
    const rtScore = rec.rt == null ? 0 : clamp01((6000 - rec.rt) / 4000);
    return Math.round(100 * (0.5 * rec.acc + 0.2 * Math.min(rec.streak / 5, 1) + 0.2 * Math.min(rec.box / 2, 1) + 0.1 * rtScore));
  }

  // Comprehension weight for song comfort, §3.8.2.
  function fam(rec, now) {
    const st = state(rec);
    if (st === 'locked') return 0;
    if (st === 'known') return rusty(rec, now) ? 0.9 : 1;
    if (st === 'learning') return 0.5 + 0.4 * rec.acc;
    return 0.4;
  }

  const api = { W_SRC, INTERVALS, T, newRecord, songFactor, rollDay, updateKnown, record, state, rusty, labelDelay, pct, fam };
  if (isNode) { module.exports = api; return; }
  const NS = (root.NS = root.NS || {});
  NS.Mastery = api;

  // ======================================================================
  // BROWSER WRAPPER: NS.mastery (store.js and curriculum.js load after this file, so look them up lazily)
  // ======================================================================
  const store = () => NS.store;
  const notes = () => NS.store.section('notes');
  const C = () => NS.curriculum;
  const emit = (evt, payload) => NS.bus && NS.bus.emit(evt, payload);
  const COURSE_KEYS = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G5'];

  function noteKeyOf(note) {
    if (!note) return null;
    if (typeof note === 'string') return note;
    if (note.key) return note.key;
    if (NS.notation && NS.notation.noteKey) { try { return NS.notation.noteKey(note); } catch { /* fall through */ } }
    const oct = note.octave != null ? note.octave : Math.floor((note.midi - (note.acc === '#' ? 1 : note.acc === 'b' ? -1 : 0)) / 12) - 1;
    return note.letter + (note.acc || '') + oct;
  }

  // Close yesterday's practice day for every note, once per load (and again after another tab's write).
  let rolled = false;
  function ensureRolled() {
    if (rolled || !store()) return;
    rolled = true;
    const N = notes();
    const now = Date.now();
    let dirty = false;
    for (const key in N) {
      const before = state(N[key]);
      const prevDay = N[key].day && N[key].day.d;
      const { rec, change } = updateKnown(rollDay(copy(N[key]), now), now);
      if (rec.day.d !== prevDay || change) { N[key] = rec; dirty = true; }
      if (change) announce(key, before, state(rec), change);
    }
    if (dirty) store().save();
  }
  function announce(key, before, after, change) {
    if (before !== after) emit('mastery:changed', { key, before, after });
    if (change === 'known') emit('note:known', { key });
    if (change === 'unknown') emit('note:unknown', { key });
  }
  if (NS.bus) NS.bus.on('store:changed', ({ section } = {}) => { if (section === '*' || section === 'notes') rolled = false; });

  function logDay(now, dr, dm, ms) {
    const log = store().section('log');
    const d = dayKey(now);
    const e = (log[d] = log[d] || { r: 0, m: 0, ms: 0 });
    e.r += dr; e.m += dm; e.ms += ms;
    const cutoff = addDays(d, -90);
    for (const k in log) if (k < cutoff) delete log[k];
  }

  function recordEv(ev) {
    if (!ev || !store()) return { change: null };
    ensureRolled();
    const key = ev.key || noteKeyOf(ev.note);
    const N = notes();
    const cur = N[key];
    if (!cur) return { change: null }; // locked notes are ignored
    const now = ev.ts ?? Date.now();
    const before = state(cur);
    const { rec, change } = record(cur, ev, now);
    N[key] = rec;
    const counted = rec.seen !== cur.seen;
    if (counted) {
      const isRead = rec.reads !== cur.reads;
      const isMiss = rec.miss !== cur.miss;
      logDay(now, isRead ? 1 : 0, isMiss ? 1 : 0, ev.rtMs != null ? Math.min(Math.max(0, ev.rtMs), 15000) : 0);
    }
    store().save();
    emit('store:changed', { section: 'notes' });
    announce(key, before, state(rec), change);
    return { change, state: state(rec) };
  }

  function get(key) { ensureRolled(); return notes()[key]; }

  function summary() {
    ensureRolled();
    const N = notes();
    const now = Date.now();
    const out = { known: 0, learning: 0, new: 0, locked: 0, rusty: 0 };
    for (const k of COURSE_KEYS) {
      out[state(N[k])]++;
      if (rusty(N[k], now)) out.rusty++;
    }
    return out;
  }

  function wrapLabelDelay(key, ctx = {}) {
    const labels = ctx.labels || store().settings().labels;
    return labelDelay(get(key), Object.assign({}, ctx, { labels }));
  }

  // ---------- shape hints (stats in the 'shapes' section) ----------
  const SHAPE_WORD = { same: 'Repeated notes', step: 'Steps', skip: 'Skips', leap: 'Leaps' };
  const SHAPE_LOW = { same: 'repeated notes', step: 'steps', skip: 'skips', leap: 'leaps' };
  function shapeStatKey(a, b) {
    const Sh = NS.shapes;
    return Sh.statKey(Sh.classify(a, b).kind);
  }
  function shapeLevel(a, b, ctx = {}) {
    const Sh = NS.shapes;
    if (!Sh || !a || !b) return 0;
    const sk = shapeStatKey(a, b);
    const stat = store().section('shapes')[sk] || { n: 0, acc: 0.5 };
    return Sh.pairLevel({
      typeLevel: Sh.typeLevel(stat, sk),
      stateA: state(get(noteKeyOf(a))),
      stateB: state(get(noteKeyOf(b))),
      setting: ctx.setting || store().settings().shapes,
      showIt: Boolean(ctx.showIt),
      guard: Boolean(ctx.guard),
    });
  }
  // Credit from Practice and Meet's mixed phrase only. Emits 'shape:level' {kind, before, after} and shows
  // the level-up toast when a type's level drops (§3.5).
  function recordShape(a, b, outcome, shownLevel) {
    const Sh = NS.shapes;
    if (!Sh || !a || !b || outcome === 'assisted') return;
    if (outcome !== 'read' && outcome !== 'miss') return;
    const sk = shapeStatKey(a, b);
    const shapes = store().section('shapes');
    const stat = shapes[sk] || { n: 0, acc: 0.5 };
    const before = Sh.typeLevel(stat, sk);
    shapes[sk] = Sh.updateStat(stat, outcome === 'read' ? 1 : 0, shownLevel === 2 ? 0.5 : 1);
    const after = Sh.typeLevel(shapes[sk], sk);
    store().save();
    emit('store:changed', { section: 'shapes' });
    if (after !== before) emit('shape:level', { kind: sk, before, after });
    if (after < before && NS.ui && NS.ui.toast) {
      NS.ui.toast(after === 1 && sk !== 'same'
        ? `${SHAPE_WORD[sk]} are getting easy, so their labels are hiding now.`
        : `You read ${SHAPE_LOW[sk]} at a glance now, so their ${sk === 'same' ? 'marks' : 'arrows'} are gone.`);
    }
  }

  // ---------- the course ----------
  function liveState() { return store().state(); }
  function introduce(unitIdx) {
    const S = liveState();
    const unit = C().UNITS[unitIdx];
    if (!unit) return [];
    const fresh = unit.notes.filter((k) => !S.notes[k]);
    C().introduce(S, unitIdx, dayKey(Date.now()));
    store().save();
    emit('store:changed', { section: 'notes' });
    fresh.forEach((key) => emit('mastery:changed', { key, before: 'locked', after: state(S.notes[key]) }));
    emit('unit:introduced', { unit: unitIdx, keys: unit.notes.slice() });
    return fresh;
  }
  function introduced() { return C().introducedKeys(liveState()); }
  function introGate() { ensureRolled(); return C().introGate(liveState(), Date.now()); }

  // Note check (§3.3.4). results: [{key, cards:[{ok, rtMs}]}] or [{key, reads, total, rt}], where `reads`
  // counts cards read right in under 4 s. opts.single (or one result with >= 5 cards) is the
  // "I already know this" check: all of at least 5 cards fast promotes, anything else changes nothing.
  function applyPlacement(results, opts = {}) {
    ensureRolled();
    const S = liveState();
    const out = C().placement(S, results || [], Object.assign({ now: Date.now() }, opts));
    store().save();
    emit('store:changed', { section: '*' });
    out.changes.forEach(({ key, before, after }) => {
      if (before !== after) emit('mastery:changed', { key, before, after });
      if (after === 'known' && before !== 'known') emit('note:known', { key });
      if (before === 'known' && after !== 'known') emit('note:unknown', { key });
    });
    out.units.forEach((u) => emit('unit:introduced', { unit: u, keys: C().UNITS[u].notes.slice() }));
    return out;
  }

  NS.mastery = {
    record: recordEv,
    get,
    state: (key) => state(get(key)),
    rusty: (key) => rusty(get(key), Date.now()),
    all() { ensureRolled(); return Object.assign({}, notes()); },
    summary,
    labelDelay: wrapLabelDelay,
    shapeLevel,
    recordShape,
    introduce,
    introduced,
    introGate,
    applyPlacement,
    keyOf: noteKeyOf,
  };
})(typeof window !== 'undefined' ? window : globalThis);
