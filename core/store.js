// Saved progress. Pure part (UMD): Store.KEY, Store.fresh(now), Store.migrate(raw2, raw1, {now, songs}).
// Browser part: NS.store, on the 'note-steps-v2' key (spec §2.4.8, §4).
//
// 'note-steps-v1' is read once, to migrate, and never written again, so rolling back to the v1 build
// shows the v1 data as it was at migration time. Perform's data moves to slices.perform, which compat
// exposes to perform.js as the live v1-shaped `store` object.
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const Util = isNode ? require('./util.js') : root.Util;
  const Curriculum = isNode ? require('./curriculum.js') : root.NS.curriculum;
  const Mastery = isNode ? require('./mastery.js') : root.NS.Mastery;

  const KEY = 'note-steps-v2';
  const LEGACY_KEY = 'note-steps-v1';
  const CORRUPT_PREFIX = 'note-steps-corrupt-';

  function fresh(now) {
    return {
      v: 2,
      created: now,
      migratedFrom: null,
      settings: {
        labels: 'auto', shapes: 'auto', keyLabels: true, hearFirst: 'ask', spelling: 'sharp', cues: true,
        firstRun: { sound: false, mic: false },
      },
      course: { unit: 0, checkDone: true, placementAt: null, checkSnoozeUntil: null },
      notes: {},
      shapes: { same: { n: 0, acc: 0.5 }, step: { n: 0, acc: 0.5 }, skip: { n: 0, acc: 0.5 }, leap: { n: 0, acc: 0.5 } },
      log: {},
      slices: {
        practice: { songs: {}, listen: { speed: 1, scope: 'whole' }, listened: {} },
        ear: {
          settings: { startKey: 'auto', beadsPerStep: 'standard', tempoPct: 100, names: false, fingers: true },
          firstRunDone: false,
          listening: { streak: { count: 0, lastDay: null, restDays: [] }, days: {}, heard: {}, session: { startedAt: null, posAtStart: 0 } },
          remix: { r1: {}, r2: {}, skipped: false },
          tunes: {},
          today: { day: null, reps: 0, warmupDone: false, newBitDone: false },
          totals: { reps: 0, milestonesShown: [] },
        },
        free: { labels: 'on', rhythm: 'even', bpm: 'auto', octave: 'heard', shapes: true, spelling: null, found: {} },
        drill: { rounds: 0, lastAt: 0 },
        shell: { lastRoute: '#/', libraryFilter: 'all' },
        perform: { perf: {}, speed: 75, clickTrack: true, latency: null },
        byear: { best: {}, practiceSecs: 120, speed: 1 },
        legacyExtra: {},
      },
    };
  }

  const isObj = (x) => x != null && typeof x === 'object' && !Array.isArray(x);
  // Fills missing keys of `over` from `base` (recursively); values in `over` win. Returns new objects.
  function deepMerge(base, over) {
    if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
    const out = Object.assign({}, base);
    for (const k in over) out[k] = isObj(base[k]) && isObj(over[k]) ? deepMerge(base[k], over[k]) : over[k];
    return out;
  }

  const starsFor = (m) => (m == null ? 1 : m === 0 ? 3 : m <= 3 ? 2 : 1);

  // Defensive repair after a merge: every note record gets every field, sections keep their types.
  function normalize(s, now) {
    const today = Util.dayKey(now);
    if (!isObj(s.notes)) s.notes = {};
    for (const k in s.notes) {
      if (!isObj(s.notes[k])) { delete s.notes[k]; continue; }
      const rec = s.notes[k];
      s.notes[k] = Object.assign(Mastery.newRecord(rec.intro || today), rec);
      if (!isObj(s.notes[k].conf)) s.notes[k].conf = {};
    }
    if (!Number.isFinite(s.course.unit)) s.course.unit = 0;
    if (!isObj(s.log)) s.log = {};
    return s;
  }
  function upgrade(s) { /* v3+ migrations chain here */ return s; }

  function songsById(songs) {
    const lib = {};
    (songs || []).forEach((x) => { if (x && x.id) lib[x.id] = x; });
    return lib;
  }

  // Pure. -> {state, backup?} where backup is an unreadable v2 string to keep aside.
  function migrate(raw2, raw1, { now = 0, songs = [] } = {}) {
    if (raw2) {
      try {
        const parsed = JSON.parse(raw2);
        if (isObj(parsed)) return { state: upgrade(normalize(deepMerge(fresh(now), parsed), now)) };
      } catch { /* fall through */ }
      const r = migrate(null, raw1, { now, songs });
      return { state: r.state, backup: raw2 };
    }
    let v1 = null;
    try { v1 = raw1 && JSON.parse(raw1); } catch { v1 = null; }
    if (!isObj(v1)) return { state: fresh(now) };
    const s = fresh(now);
    s.migratedFrom = 1;
    const { done: rawDone, names, perf, speed, clickTrack, latency, ...rest } = v1;
    const done = isObj(rawDone) ? rawDone : {};
    s.settings.labels = names === false ? 'never' : 'auto';
    s.slices.perform = { perf: isObj(perf) ? perf : {}, speed: speed ?? 75, clickTrack: clickTrack ?? true, latency: latency ?? null };
    for (const id in done) {
      const d = done[id];
      const m = d && Number.isFinite(d.mistakes) ? d.mistakes : null;
      s.slices.practice.songs[id] = { plays: 1, last: (d && d.at) || 0, best: d, stars: starsFor(m), ftp: null };
    }
    s.slices.legacyExtra = rest;
    // Seed notes conservatively: v1 had no per-note data and names defaulted on, so it is not reading evidence.
    const lib = songsById(songs);
    const keysOf = (id) => (lib[id] ? Curriculum.songKeys(lib[id]) : []);
    const seen = new Set(Object.keys(done).flatMap((id) => keysOf(id).filter((k) => k in Curriculum.UNIT_OF)));
    if (seen.size) {
      const maxUnit = Math.max(...[...seen].map((k) => Curriculum.UNIT_OF[k]));
      const today = Util.dayKey(now);
      for (let u = 0; u <= maxUnit; u++) Curriculum.introduce(s, u, today);
      for (const k in s.notes) {
        const clean = Object.keys(done).some((id) => done[id] && done[id].mistakes === 0 && keysOf(id).includes(k));
        Object.assign(s.notes[k], { seen: 4, n: 4, acc: clean ? 0.75 : 0.65 });
      }
      s.course.checkDone = false; // Home shows the Note check invite
    }
    return { state: s };
  }

  const api = { KEY, LEGACY_KEY, CORRUPT_PREFIX, fresh, migrate, deepMerge };
  if (isNode) { module.exports = api; return; }
  root.Store = api;
  const NS = (root.NS = root.NS || {});
  NS.Store = api;

  // ======================================================================
  // BROWSER: NS.store
  // ======================================================================
  let persistent = true;
  let toastShown = false;
  let S = null;
  let saveTimer = null;

  function libSongs() {
    try {
      if (NS.songs && NS.songs.all) return NS.songs.all();
    } catch { /* not ready */ }
    return (root.NoteSongs && root.NoteSongs.songs) || [];
  }
  function safeSet(key, value) {
    try { localStorage.setItem(key, value); return true; } catch { return false; }
  }
  function cantSave() {
    persistent = false;
    if (toastShown) return;
    toastShown = true;
    // ui.js loads after this file: wait for it.
    const show = () => NS.ui && NS.ui.toast && NS.ui.toast('Progress can’t be saved in this browser window.');
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(show, 0));
    else setTimeout(show, 0);
  }

  function load(now) {
    let raw2 = null;
    let raw1 = null;
    try { raw2 = localStorage.getItem(KEY); raw1 = localStorage.getItem(LEGACY_KEY); } catch {
      cantSave();
      return fresh(now);
    }
    const { state, backup } = migrate(raw2, raw1, { now, songs: libSongs() });
    if (backup) safeSet(CORRUPT_PREFIX + now, backup);
    if (!raw2 || backup) { if (!safeSet(KEY, JSON.stringify(state))) cantSave(); }
    return state;
  }
  S = load(Date.now());

  const changed = (section) => NS.bus && NS.bus.emit('store:changed', { section });

  function flush() {
    clearTimeout(saveTimer);
    saveTimer = null;
    // A failed write keeps the state in memory (the toast shows once); a later success clears the flag.
    if (safeSet(KEY, JSON.stringify(S))) persistent = true;
    else cantSave();
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 500);
  }
  root.addEventListener('pagehide', () => { if (saveTimer) flush(); });
  if (NS.bus) NS.bus.on('visibility', ({ hidden } = {}) => { if (hidden && saveTimer) flush(); });

  // Another tab saved: take its state (last write wins).
  root.addEventListener('storage', (e) => {
    if (e.key !== KEY && e.key !== null) return; // null = localStorage.clear() elsewhere
    clearTimeout(saveTimer);
    saveTimer = null;
    let raw1 = null;
    try { raw1 = localStorage.getItem(LEGACY_KEY); } catch { /* ignore */ }
    const raw2 = e.key === null ? null : e.newValue;
    S = migrate(raw2, raw1, { now: Date.now(), songs: libSongs() }).state;
    changed('*');
  });

  function settings() { return S.settings; }
  function setSetting(key, value) {
    S.settings[key] = value;
    save();
    changed('settings');
  }

  const SECTIONS = ['notes', 'course', 'shapes', 'log'];
  function sliceObj(name) {
    if (!isObj(S.slices[name])) {
      const def = fresh(0).slices[name];
      S.slices[name] = def ? def : {};
    }
    return S.slices[name];
  }
  // get() is the live object: change it in place and call save(), or use set / update.
  function slice(name) {
    return {
      get: () => sliceObj(name),
      set(obj) { S.slices[name] = obj; save(); changed(name); },
      update(fn) {
        const cur = sliceObj(name);
        const r = fn(cur);
        if (r !== undefined && r !== cur) S.slices[name] = r;
        save();
        changed(name);
      },
    };
  }

  function section(name) {
    if (!SECTIONS.includes(name)) throw new Error('Unknown store section ' + name);
    return S[name];
  }

  function reset(which) {
    const f = fresh(Date.now());
    if (which === 'all') {
      S = f;
    } else {
      S.notes = f.notes;
      S.shapes = f.shapes;
      S.course = f.course;
    }
    flush();
    changed('*');
  }

  NS.store = {
    state: () => S, // the live state: read it; change it only through the calls below
    settings,
    setSetting,
    slice,
    section,
    save,
    flush,
    reset,
    persistent: () => persistent,
  };
})(typeof window !== 'undefined' ? window : globalThis);
