// Shape hints between two notes: the same note, a half step, a step, a skip or a leap, counted by
// staff distance (what the eye counts). Plus the fading rules for the hints (spec §2.4.6, §3.5).
// UMD and pure: NS.shapes in the browser, require('./shapes.js') in Node.
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;

  const LEAP_SHORT = { 3: '4th', 4: '5th', 5: '6th', 6: '7th', 7: '8ve' };
  const ACC_GLYPH = { '': '', '#': '♯', b: '♭' };
  const STAT0 = { n: 0, acc: 0.5 };

  const nameOf = (note) => (note && note.letter ? note.letter + (ACC_GLYPH[note.acc || ''] || '') : 'the last note');

  // a, b: notes with staffPos and midi.
  function classify(a, b) {
    const d = b.staffPos - a.staffPos;
    const dist = Math.abs(d);
    let kind;
    let dir = Math.sign(d);
    if (d === 0) {
      kind = a.midi === b.midi ? 'same' : 'half';
      dir = Math.sign(b.midi - a.midi);
    } else kind = dist === 1 ? 'step' : dist === 2 ? 'skip' : 'leap';
    const short = kind === 'same' ? '=' : kind === 'leap' ? LEAP_SHORT[dist] || '>8ve' : kind;
    const way = dir > 0 ? 'up' : 'down';
    let long;
    if (kind === 'same') long = 'the same note';
    else if (kind === 'half') long = `a half step ${way}`;
    else if (kind === 'leap') {
      long = dist === 7 ? `a leap ${way} an octave`
        : dist > 7 ? `a leap ${way} of more than an octave`
        : `a leap ${way} a ${short}`;
    } else long = `a ${kind} ${way}`;
    return { kind, dir, dist, num: dist + 1, short, long };
  }

  // 'half' tallies with steps.
  const statKey = (kind) => (kind === 'half' ? 'step' : kind);

  // How much help a type of interval still needs: 2 arrow + word, 1 arrow only, 0 nothing.
  function typeLevel(stat, key) {
    const s = stat || STAT0;
    const n = s.n || 0;
    const acc = s.acc == null ? STAT0.acc : s.acc;
    if (key === 'same') return n >= 10 && acc >= 0.9 ? 0 : 1;
    if (n >= 40 && acc >= 0.9) return 0;
    if (n >= 15 && acc >= 0.75) return 1;
    return 2;
  }

  // The level to draw for one pair. 'locked' (a note not met yet) counts like 'new'.
  function pairLevel({ typeLevel: L = 2, stateA, stateB, setting = 'auto', showIt = false, guard = false } = {}) {
    if (setting === 'off') return 0;
    if (setting === 'always') return 2;
    if (showIt || guard) return 2;
    if (stateA === 'known' && stateB === 'known' && L <= 1) return 0;
    const fresh = (s) => s === 'new' || s === 'locked';
    if (fresh(stateA) || fresh(stateB)) return Math.max(L, 1);
    return L;
  }

  // x: 1 read, 0 miss. w: 0.5 when the hint was fully shown, else 1. Returns a new object.
  function updateStat(stat, x, w) {
    const s = stat || STAT0;
    const acc0 = s.acc == null ? STAT0.acc : s.acc;
    const acc = Math.min(1, Math.max(0, acc0 + 0.1 * w * (x - acc0)));
    return Object.assign({}, s, { n: (s.n || 0) + w, acc });
  }

  function describe(a, b) {
    return `Next note is ${classify(a, b).long}.`;
  }

  function rescueText(a, b, nameVisible) {
    const c = classify(a, b);
    if (c.kind === 'same') return nameVisible ? `It's the same note as ${nameOf(a)}.` : "It's the same note as the last one.";
    return nameVisible ? `It's ${c.long} from ${nameOf(a)}.` : `It's ${c.long} from the last note.`;
  }

  // Toast when an interval type's level drops (once per crossing). null when nothing to say.
  const PLURAL = { same: 'Repeated notes', step: 'Steps', skip: 'Skips', leap: 'Leaps' };
  function levelUpText(key, from, to) {
    const P = PLURAL[key];
    if (!P || !(to < from)) return null;
    const p = P.toLowerCase();
    if (to === 0) return `You read ${p} at a glance now, so their arrows are gone.`;
    if (to === 1) return `${P} are getting easy, so their labels are hiding now.`;
    return null;
  }

  // Band geometry shared with core/staff.js (§3.5): arrow rise per kind, in px.
  const RISE = { same: 0, half: 1.5, step: 3, skip: 5.5, leap: 8 };

  const api = { classify, statKey, typeLevel, pairLevel, updateStat, describe, rescueText, levelUpText, RISE };
  if (isNode) module.exports = api;
  else (root.NS = root.NS || {}).shapes = api;
})(typeof window !== 'undefined' ? window : globalThis);
