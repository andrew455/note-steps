// Chord vocabulary for hands-free commands. Every major and minor triad has an id ('C', 'Cm', 'F#',
// 'Bbm', ...). The app uses three commands: next (a major chord: go on), again (the minor chord on the
// same root: hear it / play again) and back (another major chord: done / go back). Which chords those
// are moves on as you learn more songs, so each stage teaches the same hand shape in a new place.
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const PRETTY = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

  // Stage n starts once you have finished SETS[n].after songs (in Practice or Perform).
  const SETS = [
    { after: 0, next: 'C', again: 'Cm', back: 'G' },
    { after: 5, next: 'F', again: 'Fm', back: 'C' },
    { after: 10, next: 'G', again: 'Gm', back: 'D' },
    { after: 15, next: 'D', again: 'Dm', back: 'A' },
    { after: 20, next: 'A', again: 'Am', back: 'E' },
  ];

  function parse(id) {
    const minor = /m$/.test(id);
    const r = ROOTS.indexOf(minor ? id.slice(0, -1) : id);
    return r < 0 ? null : { root: r, minor };
  }
  function idOf(rootPc, minor) { return ROOTS[((rootPc % 12) + 12) % 12] + (minor ? 'm' : ''); }
  function pcs(id) {
    const p = parse(id);
    if (!p) return [];
    return [p.root, (p.root + (p.minor ? 3 : 4)) % 12, (p.root + 7) % 12];
  }
  function name(id) {
    const p = parse(id);
    return p ? `${PRETTY[p.root]} ${p.minor ? 'minor' : 'major'}` : id;
  }
  // Root position around middle C: roots from C to F start on octave 4, G to B start below middle C,
  // so every chord fits a small keyboard from about G3 to C5.
  function midis(id) {
    const p = parse(id);
    if (!p) return [];
    const base = (p.root >= 7 ? 48 : 60) + p.root;
    return [base, base + (p.minor ? 3 : 4), base + 7];
  }
  function noteNames(id) {
    return midis(id).map((m) => {
      const pc = m % 12;
      return ROOTS[pc] + (Math.floor(m / 12) - 1);
    });
  }
  // Every id, for detectors.
  const ALL = [];
  for (let r = 0; r < 12; r++) { ALL.push(idOf(r, false)); ALL.push(idOf(r, true)); }

  function setFor(songsDone) {
    let s = SETS[0];
    for (const x of SETS) if (songsDone >= x.after) s = x;
    return s;
  }

  const api = { ROOTS, SETS, ALL, parse, idOf, pcs, name, midis, noteNames, setFor };
  if (isNode) { module.exports = api; return; }
  root.ChordSet = api;

  // ---------------------------------------------------------------- browser: current stage
  const NS = root.NS;
  if (!NS) return;
  const SEEN_KEY = 'note-steps-chordset-seen';
  function songsDone() {
    // Songs finished in Practice or Perform (v1 store: done{} and perf{}).
    try {
      const st = NS.store && NS.store.state ? NS.store.state() : null;
      const ids = new Set();
      const add = (o) => { if (o && typeof o === 'object') Object.keys(o).forEach((k) => ids.add(k)); };
      const sl = (st && st.slices) || {};
      if (sl.practice && sl.practice.songs) {
        Object.entries(sl.practice.songs).forEach(([k, v]) => { if (v && v.best) ids.add(k); });
      }
      if (sl.perform) add(sl.perform.perf);
      if (st) { add(st.done); add(st.perf); }
      return ids.size;
    } catch { return 0; }
  }
  function current() {
    const s = setFor(songsDone());
    return { stage: SETS.indexOf(s), next: s.next, again: s.again, back: s.back };
  }
  // True once per stage: the first time a stage's chords are used, the app introduces them.
  function isNewStage() {
    const st = current().stage;
    let seen = -1;
    try { seen = parseInt(localStorage.getItem(SEEN_KEY) || '-1', 10); } catch {}
    if (st > seen) {
      try { localStorage.setItem(SEEN_KEY, String(st)); } catch {}
      return st > 0;
    }
    return false;
  }
  NS.chordset = Object.assign({}, api, { current, songsDone, isNewStage });
})(typeof window !== 'undefined' ? window : globalThis);
