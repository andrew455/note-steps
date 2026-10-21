// Small pure helpers shared by every module. Works in the browser (window.Util, and NS.util in ns.js)
// and in Node for testing. Frozen after WP0: ask the owner (WP0/WP10) before changing a signature.
(function (root) {
  const DAY_MS = 86400000;
  const CUTOFF_MS = 4 * 3600000; // practice after midnight (until 4 am) counts for the previous day

  const pad = (n) => String(n).padStart(2, '0');

  // Local date of (ts - 4h) as 'YYYY-MM-DD'.
  function dayKey(ts) {
    const d = new Date(ts - CUTOFF_MS);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // Calendar arithmetic on day keys (done in UTC so daylight saving never shifts a day).
  function keyToUtc(key) {
    const [y, m, d] = key.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  }
  function addDays(key, n) {
    const d = new Date(keyToUtc(key) + n * DAY_MS);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  // b - a in whole days.
  function daysBetween(a, b) {
    return Math.round((keyToUtc(b) - keyToUtc(a)) / DAY_MS);
  }

  // Seeded random numbers in [0, 1).
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function rng() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function median(arr) {
    if (!arr || !arr.length) return NaN;
    const s = [...arr].sort((a, b) => a - b);
    const h = s.length >> 1;
    return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
  }
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const clamp01 = (x) => clamp(x, 0, 1);
  const pc = (midi) => ((midi % 12) + 12) % 12;

  // 32-bit FNV-1a of a string, as 8 hex characters.
  function hash(str) {
    let h = 0x811c9dc5;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  const api = { dayKey, addDays, daysBetween, mulberry32, median, clamp01, clamp, pc, hash };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Util = api;
})(typeof window !== 'undefined' ? window : globalThis);
