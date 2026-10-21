// Note and melody parsing, spelling and staff placement. A superset of pitch.js parseNote that adds
// accidentals, rests, phrase marks and bar marks. UMD and pure: NS.notation in the browser,
// require('./notation.js') in Node (spec §2.4.5, phrase rules §3.7.6).
//
// Tokens: letter, optional accidental (# b ♯ ♭), octave, then optional ':' + length.
//   'E4' quarter E, 'F#4:q.' dotted-quarter F sharp, 'Bb4:h' half B flat, 'R:h' half rest.
//   Lengths: w h q e s (whole, half, quarter, eighth, sixteenth), add '.' for dotted. Default q.
// Melody marks: '/' = phrase break, '|' = bar line (cosmetic). They may stand alone or touch a token.
// staffPos 0 = bottom line of the treble staff (E4); each step is one line or space.
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;

  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const LETTER_SEMIS = [0, 2, 4, 5, 7, 9, 11];
  const SHARP = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'];
  const SHARP_ACC = ['', '#', '', '#', '', '', '#', '', '#', '', '#', ''];
  const FLAT = ['C', 'D', 'D', 'E', 'E', 'F', 'G', 'G', 'A', 'A', 'B', 'B'];
  const FLAT_ACC = ['', 'b', '', 'b', '', '', 'b', '', 'b', '', 'b', ''];
  const ACC_SEMIS = { '': 0, '#': 1, b: -1 };
  const ACC_GLYPH = { '': '', '#': '♯', b: '♭', n: '♮' };
  const DUR_BEATS = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25 };
  const EPS = 1e-6;

  // The drawable range: G3 (staffPos -5, two short lines below) to C6 (staffPos 12, two above).
  const POS_LOW = -5;
  const POS_HIGH = 12;
  // The staff core: middle C's short line to just above the top line.
  const CORE_LOW = -2;
  const CORE_HIGH = 9;

  const pc = (m) => ((m % 12) + 12) % 12;
  const posOf = (letter, octave) => octave * 7 + LETTERS.indexOf(letter) - 30;

  function durBeats(dur) {
    if (!/^[whqes]\.?$/.test(dur)) throw new Error('Bad note length "' + dur + '"');
    return DUR_BEATS[dur[0]] * (dur.endsWith('.') ? 1.5 : 1);
  }

  function makeNote(letter, acc, octave, dur) {
    const midi = 12 * (octave + 1) + LETTER_SEMIS[LETTERS.indexOf(letter)] + ACC_SEMIS[acc];
    return {
      kind: 'note', letter, acc, octave, midi, pc: pc(midi), staffPos: posOf(letter, octave),
      dur, beats: durBeats(dur), key: letter + acc + octave,
    };
  }

  // 'F#4:q.' -> Note ; 'R:h' -> Rest. Throws on a token it can't read.
  function parseToken(tok) {
    const s = String(tok).trim();
    const colon = s.indexOf(':');
    const name = colon < 0 ? s : s.slice(0, colon);
    const dur = colon < 0 ? 'q' : s.slice(colon + 1);
    if (name === 'R' || name === 'r') return { kind: 'rest', dur, beats: durBeats(dur) };
    const m = /^([A-G])([#b♯♭]?)(-?\d+)$/.exec(name);
    if (!m) throw new Error('Bad note token "' + tok + '"');
    const acc = m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : m[2];
    return makeNote(m[1], acc, parseInt(m[3], 10), dur);
  }

  function tokenize(str) {
    return String(str || '').replace(/([/|])/g, ' $1 ').trim().split(/\s+/).filter(Boolean);
  }

  // Parses a whole melody string. notes[] has rests removed; every note gets .beat (start, in beats
  // from the first item) and .i (its index in notes). Rests stay in items[] and count in endBeat.
  function parseMelody(str, { beatsPerBar = 4, pickup = 0 } = {}) {
    const items = [];
    const notes = [];
    const bars = [];
    const breaks = [];
    let beat = 0;
    for (const tok of tokenize(str)) {
      if (tok === '/') { if (notes.length && breaks[breaks.length - 1] !== notes.length) breaks.push(notes.length); continue; }
      if (tok === '|') { if (bars[bars.length - 1] !== notes.length) bars.push(notes.length); continue; }
      const it = parseToken(tok);
      it.beat = beat;
      beat += it.beats;
      items.push(it);
      if (it.kind === 'note') { it.i = notes.length; notes.push(it); }
    }
    const marked = breaks.length > 0;
    const opts = { beatsPerBar, pickup };
    let phrases;
    if (marked) {
      const spans = [];
      let from = 0;
      for (const to of [...breaks, notes.length]) {
        if (to > from) spans.push([from, to]);
        from = to;
      }
      phrases = fixMarked(spans, notes, opts);
    } else phrases = autoPhrases(notes, opts);
    return { items, notes, endBeat: beat, phrases, marked, bars };
  }

  // Marked spans are used as they are when each has 2 to 10 notes. A 1-note span joins its
  // neighbour; a span over 10 notes is split by the auto rules.
  function fixMarked(spans, notes, opts) {
    const merged = [];
    for (let k = 0; k < spans.length; k++) {
      const [a, b] = spans[k];
      if (b - a < 2 && k + 1 < spans.length) { spans[k + 1] = [a, spans[k + 1][1]]; continue; }
      if (b - a < 2 && merged.length) { merged[merged.length - 1] = [merged[merged.length - 1][0], b]; continue; }
      merged.push([a, b]);
    }
    const out = [];
    for (const [a, b] of merged) {
      if (b - a <= 10) out.push([a, b]);
      else autoPhrases(notes.slice(a, b), opts).forEach(([x, y]) => out.push([a + x, a + y]));
    }
    return out;
  }

  // ---------- automatic phrases (§3.7.6) ----------
  function withBeats(notes) {
    let beat = 0;
    return notes.map((n) => {
      const b = n.beat != null ? n.beat : beat;
      beat = b + n.beats;
      return { beat: b, beats: n.beats };
    });
  }

  // Note index k (from < k < to) where a split falls on a bar line, closest to the span's beat midpoint,
  // leaving at least `min` notes each side. -1 when there is none. With anyNote, any note start counts.
  function splitPoint(nb, from, to, opts, min, anyNote) {
    const bpb = opts.beatsPerBar || 4;
    const pickup = opts.pickup || 0;
    const mid = (nb[from].beat + nb[to - 1].beat + nb[to - 1].beats) / 2;
    let best = -1;
    let bestD = Infinity;
    for (let k = from + min; k <= to - min; k++) {
      const pos = nb[k].beat - pickup;
      const onBar = Math.abs(pos / bpb - Math.round(pos / bpb)) * bpb < EPS;
      if (!anyNote && !onBar) continue;
      const d = Math.abs(nb[k].beat - mid);
      if (d < bestD - EPS) { best = k; bestD = d; }
    }
    return best;
  }

  function spanBeats(nb, a, b) { return nb[b - 1].beat + nb[b - 1].beats - nb[a].beat; }

  // R2 (over 8 notes or 8 beats: split at the bar line nearest the middle, 3+ notes a side) and
  // R4 (hard maximum of 10 notes), applied recursively.
  function splitSpan(nb, a, b, opts, out) {
    const len = b - a;
    if (len > 8 || spanBeats(nb, a, b) > 8 + EPS) {
      let k = splitPoint(nb, a, b, opts, 3, false);
      if (k < 0 && len > 10) {
        k = splitPoint(nb, a, b, opts, 1, false);
        if (k < 0) k = splitPoint(nb, a, b, opts, 3, true);
      }
      if (k > 0) {
        splitSpan(nb, a, k, opts, out);
        splitSpan(nb, k, b, opts, out);
        return;
      }
    }
    out.push([a, b]);
  }

  function autoPhrases(notes, { beatsPerBar = 4, pickup = 0 } = {}) {
    if (!notes || !notes.length) return [];
    const nb = withBeats(notes);
    const n = nb.length;
    // R1: close a span after a long note (2+ beats) or before a rest, once it has 3+ notes.
    const spans = [];
    let from = 0;
    for (let k = 0; k < n; k++) {
      const restAfter = k + 1 < n && nb[k + 1].beat > nb[k].beat + nb[k].beats + EPS;
      if ((nb[k].beats >= 2 - EPS || restAfter) && k + 1 - from >= 3) {
        spans.push([from, k + 1]);
        from = k + 1;
      }
    }
    if (from < n) spans.push([from, n]);
    // R3: a span under 3 notes merges into the next one; the last merges into the previous one.
    const merged = [];
    for (let k = 0; k < spans.length; k++) {
      const [a, b] = spans[k];
      if (b - a < 3 && k + 1 < spans.length) { spans[k + 1] = [a, spans[k + 1][1]]; continue; }
      if (b - a < 3 && merged.length) { merged[merged.length - 1] = [merged[merged.length - 1][0], b]; continue; }
      merged.push([a, b]);
    }
    const out = [];
    for (const [a, b] of merged) splitSpan(nb, a, b, { beatsPerBar, pickup }, out);
    return out;
  }

  // ---------- keys, spelling, folding ----------
  const noteKey = (note) => note.letter + (note.acc || '') + (note.octave != null ? note.octave : Math.floor(note.midi / 12) - 1);
  const fromKey = (key) => parseToken(String(key).split(':')[0]);
  const samePitchClass = (a, b) => pc(a && a.midi != null ? a.midi : a) === pc(b && b.midi != null ? b.midi : b);

  // midi -> Note spelled with sharps (C C♯ D D♯ E F F♯ G G♯ A A♯ B) or flats (C D♭ D E♭ E F G♭ G A♭ A B♭ B).
  function spellMidi(midi, prefer = 'sharp') {
    const p = pc(midi);
    const flat = prefer === 'flat';
    const letter = flat ? FLAT[p] : SHARP[p];
    const acc = flat ? FLAT_ACC[p] : SHARP_ACC[p];
    const octave = Math.floor(midi / 12) - 1;
    return makeNote(letter, acc, octave, 'q');
  }

  function foldToRange(midi, low, high) {
    let m = midi;
    while (m < low) m += 12;
    while (m > high) m -= 12;
    return m;
  }

  // Where to draw a heard midi. heard = the true spelling. note = what is drawn.
  // 'heard': the true octave inside G3..C6 (zone 'core' on [-2, 9], else 'ledger'); outside that,
  //          folded by octaves into [-2, 9] with fold > 0 when the real note is higher than drawn.
  // 'fold':  always folded into [-2, 9]; fold is reported as 0 and zone as 'core'.
  function placeOnStaff(midi, { mode = 'heard', prefer = 'sharp' } = {}) {
    const heard = spellMidi(midi, prefer);
    const p = heard.staffPos;
    if (mode !== 'fold' && p >= POS_LOW && p <= POS_HIGH) {
      return { note: heard, heard, fold: 0, zone: p >= CORE_LOW && p <= CORE_HIGH ? 'core' : 'ledger' };
    }
    if (p >= CORE_LOW && p <= CORE_HIGH) return { note: heard, heard, fold: 0, zone: 'core' };
    // fewest octaves that bring the note into the core
    let fold = 0;
    if (p < CORE_LOW) fold = -Math.ceil((CORE_LOW - p) / 7);
    else fold = Math.ceil((p - CORE_HIGH) / 7);
    const note = spellMidi(midi - 12 * fold, prefer);
    if (mode === 'fold') return { note, heard, fold: 0, zone: 'core' };
    return { note, heard, fold, zone: 'folded' };
  }

  // Plain wording for a staff position, never a mnemonic. Takes a Note or a staffPos number.
  const POSITION_TEXT = {
    '-5': 'below the second short line',
    '-4': 'on the second short line below the staff',
    '-3': 'just below that short line',
    '-2': 'on a short line below the staff',
    '-1': 'just below the bottom line',
    0: 'on the bottom line',
    1: 'in the first space',
    2: 'on the second line',
    3: 'in the second space',
    4: 'on the middle line',
    5: 'in the third space',
    6: 'on the fourth line',
    7: 'in the fourth space',
    8: 'on the top line',
    9: 'just above the top line',
    10: 'on a short line above the staff',
    11: 'just above that short line',
    12: 'on the second short line above the staff',
  };
  function describePosition(note) {
    const p = typeof note === 'number' ? note : note && note.staffPos;
    if (p == null || Number.isNaN(p)) return 'on the staff';
    if (POSITION_TEXT[p]) return POSITION_TEXT[p];
    return p < POS_LOW ? 'lower than the short lines below the staff' : 'higher than the short lines above the staff';
  }

  // Display name with real accidental signs: 'F♯', 'B♭', 'E'. withOctave adds the octave: 'F♯4'.
  function displayName(note, withOctave = false) {
    return note.letter + (ACC_GLYPH[note.acc || ''] || '') + (withOctave ? note.octave : '');
  }

  // Which accidental sign each note needs. policy 'each': every sharp or flat shows, naturals never
  // (Free Play's even mode). policy 'bar': standard rule in C major: an accidental lasts until the next
  // bar line, and a natural sign ('n') shows on a return. Bars come from bars[] (note indices after
  // each '|') or, failing that, from beats with beatsPerBar / pickup.
  function accidentalMarks(notes, { policy = 'each', bars = null, beatsPerBar = 4, pickup = 0 } = {}) {
    if (policy !== 'bar') return notes.map((n) => n.acc || '');
    const barSet = bars ? new Set(bars) : null;
    const nb = withBeats(notes);
    let state = {};
    let barNo = null;
    return notes.map((n, i) => {
      if (barSet) {
        if (barSet.has(i)) state = {};
      } else {
        const b = Math.floor((nb[i].beat - pickup + EPS) / beatsPerBar);
        if (b !== barNo) { state = {}; barNo = b; }
      }
      const slot = n.letter + n.octave;
      const acc = n.acc || '';
      const prev = state[slot] != null ? state[slot] : '';
      state[slot] = acc;
      if (acc === prev) return '';
      return acc === '' ? 'n' : acc;
    });
  }

  const api = {
    parseToken, parseMelody, autoPhrases, noteKey, fromKey, samePitchClass, spellMidi, foldToRange,
    placeOnStaff, describePosition, displayName, accidentalMarks, durBeats,
    ACC_GLYPH, RANGE: { low: 'G3', high: 'C6' },
  };
  if (isNode) module.exports = api;
  else (root.NS = root.NS || {}).notation = api;
})(typeof window !== 'undefined' ? window : globalThis);
