// Play by Ear logic (UMD, pure, no DOM): NS.ByEar in the browser, require('./byear-core.js') in Node.
// Spec §7.2. Aligns a recorded take against the song, strips the notes of the command chords out of a
// take, folds your notes onto the staff next to the song's, and writes the plain-language summary.
//
//   align(songMidis, takeMidis) -> {columns, matched, total, pct}
//   stripChordNotes(take, gestures, {before=0.25, after=0.3}) -> take without the chords' notes
//   layout(result, {low=60, high=79}) -> columns with the midi to draw for your note (octave folded)
//   differences(result, {max=5, songNames?, prefer}) -> ['Note 9: the song has E, you played F.', ...]
//   summaryText(result) -> '20 of 26 notes matched (77%)'
//   takeEvents(take) -> [{midi, at, dur}] for NS.audio.playEvents (real gaps, clamped)
//   isNewBest(prev, pct) ; noteName(midi, prefer) ; spellNear(midi, refMidi, prefer)
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;

  const pc = (m) => ((Math.round(m) % 12) + 12) % 12;
  // Shortest distance between two pitch classes, 0..6 semitones.
  const pcDist = (a, b) => { const d = Math.abs(pc(a) - pc(b)); return Math.min(d, 12 - d); };

  // Pitch classes of the command chords (§7.1).
  const CHORD_PCS = { C: [0, 4, 7], Cm: [0, 3, 7], G: [7, 11, 2] };
  const CHORD_NAMES = { C: 'C major', Cm: 'C minor', G: 'G major' };

  // ======================================================================
  // ALIGNMENT: Needleman–Wunsch on pitch class
  // ======================================================================
  // Costs in tenths so ties compare exactly: match 0, near substitution (within 2 semitones) 0.9,
  // other substitution 1, insertion (extra) 1, deletion (missed) 1.
  const COST = { match: 0, near: 9, sub: 10, gap: 10 };
  function subCost(a, b) {
    if (pc(a) === pc(b)) return COST.match;
    return pcDist(a, b) <= 2 ? COST.near : COST.sub;
  }

  // -> { columns:[{kind:'match'|'sub'|'missed'|'extra', song?, take?, songIndex?, takeIndex?}], matched, total, pct }
  function align(songMidis, takeMidis) {
    const S = (songMidis || []).filter((m) => Number.isFinite(m));
    const T = (takeMidis || []).filter((m) => Number.isFinite(m));
    const n = S.length;
    const m = T.length;
    // D[i][j]: cheapest way to line up the first i song notes with the first j take notes.
    const D = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = 1; i <= n; i++) D[i][0] = i * COST.gap;
    for (let j = 1; j <= m; j++) D[0][j] = j * COST.gap;
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        D[i][j] = Math.min(
          D[i - 1][j - 1] + subCost(S[i - 1], T[j - 1]),
          D[i - 1][j] + COST.gap,
          D[i][j - 1] + COST.gap,
        );
      }
    }
    // Trace back from the end. Ties prefer the diagonal (match or substitution), then a deletion
    // (a missed song note), then an insertion (an extra note of yours).
    const cols = [];
    let i = n;
    let j = m;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + subCost(S[i - 1], T[j - 1])) {
        const same = pc(S[i - 1]) === pc(T[j - 1]);
        cols.push({ kind: same ? 'match' : 'sub', song: S[i - 1], take: T[j - 1], songIndex: i - 1, takeIndex: j - 1 });
        i--; j--;
      } else if (i > 0 && D[i][j] === D[i - 1][j] + COST.gap) {
        cols.push({ kind: 'missed', song: S[i - 1], songIndex: i - 1 });
        i--;
      } else {
        cols.push({ kind: 'extra', take: T[j - 1], takeIndex: j - 1 });
        j--;
      }
    }
    cols.reverse();
    const matched = cols.filter((c) => c.kind === 'match').length;
    const total = n;
    const pct = total ? Math.round((matched / total) * 100) : 0;
    return { columns: cols, matched, total, pct };
  }

  function counts(result) {
    const out = { match: 0, sub: 0, missed: 0, extra: 0 };
    ((result && result.columns) || []).forEach((c) => { out[c.kind] = (out[c.kind] || 0) + 1; });
    return out;
  }

  // ======================================================================
  // CHORD STRIPPING
  // ======================================================================
  // take: [{midi, at, ...}] (at = audio-clock seconds of the onset).
  // gestures: [{chord:'C'|'Cm'|'G', at, from?}] (at = when the chord was recognised, same clock;
  // from = optional onset of the chord's attack, which the detector recognises about 0.4 s later).
  // Removes a note when its onset falls inside [min(at, from) - before, at + after] AND its pitch
  // class belongs to that chord. Melody notes outside the window, and other pitch classes inside it,
  // are kept.
  function stripChordNotes(take, gestures, { before = 0.25, after = 0.3 } = {}) {
    const gs = (gestures || []).filter((g) => g && CHORD_PCS[g.chord] && Number.isFinite(g.at));
    const lo = (g) => Math.min(g.at, Number.isFinite(g.from) ? g.from : g.at) - before;
    return (take || []).filter((note) => !gs.some((g) =>
      note.at >= lo(g) && note.at <= g.at + after && CHORD_PCS[g.chord].includes(pc(note.midi))));
  }

  // ======================================================================
  // STAFF LAYOUT (octave folding)
  // ======================================================================
  // The octave of `midi` nearest to `ref`.
  function nearestOctave(midi, ref) {
    let m = ref + ((pc(midi) - pc(ref) + 12) % 12);
    if (m - ref > 6) m -= 12;
    return m;
  }
  function foldInto(midi, low, high) {
    let m = midi;
    while (m < low) m += 12;
    while (m > high) m -= 12;
    return m;
  }
  // Adds `draw` (the midi to draw your note at) to each column that has a take note: the octave nearest
  // the aligned song note, or for an extra the previous drawn note, folded into C4..G5. Song notes are
  // drawn where they are written.
  function layout(result, { low = 60, high = 79 } = {}) {
    const cols = (result && result.columns) || [];
    const firstSong = cols.find((c) => c.song != null);
    let prev = firstSong ? firstSong.song : 64;
    return cols.map((c) => {
      const out = Object.assign({}, c);
      if (c.take != null) {
        const ref = c.song != null ? c.song : prev;
        out.draw = foldInto(nearestOctave(c.take, ref), low, high);
        prev = out.draw;
      } else if (c.song != null) prev = c.song;
      return out;
    });
  }

  // ======================================================================
  // NAMES AND TEXT
  // ======================================================================
  const SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const FLAT = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
  const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const noteName = (midi, prefer = 'sharp') => (prefer === 'flat' ? FLAT : SHARP)[pc(midi)];

  // Spells `midi` so that a near miss shares the letter of the song note it replaces (E vs E♭, not D♯),
  // which puts both on the same staff position. Otherwise uses `prefer`.
  // -> {letter, acc:''|'#'|'b', name}
  function spellNear(midi, refMidi, prefer = 'sharp') {
    const p = pc(midi);
    const black = [1, 3, 6, 8, 10].includes(p); // white keys keep their own name (F, never E♯)
    if (refMidi != null && black) {
      const rp = pc(refMidi);
      const refLetter = Object.keys(LETTER_PC).find((l) => LETTER_PC[l] === rp);
      if (refLetter) {
        if ((p - rp + 12) % 12 === 1) return { letter: refLetter, acc: '#', name: refLetter + '♯' };
        if ((rp - p + 12) % 12 === 1) return { letter: refLetter, acc: 'b', name: refLetter + '♭' };
      }
    }
    const name = noteName(p, prefer);
    return { letter: name[0], acc: name[1] === '♯' ? '#' : name[1] === '♭' ? 'b' : '', name };
  }

  function summaryText(result) {
    return `${result.matched} of ${result.total} notes matched (${result.pct}%)`;
  }

  // Up to `max` plain-language differences, in song order.
  // songNames: optional names for the song notes (by song index), e.g. from the song's own spelling.
  function differences(result, { max = 5, songNames = null, prefer = 'sharp' } = {}) {
    const out = [];
    const songName = (c) => (songNames && songNames[c.songIndex]) || noteName(c.song, prefer);
    let lastSong = -1; // song index of the last column that had a song note
    for (const c of (result && result.columns) || []) {
      if (out.length >= max) break;
      if (c.kind === 'sub') {
        out.push(`Note ${c.songIndex + 1}: the song has ${songName(c)}, you played ${spellNear(c.take, c.song, prefer).name}.`);
      } else if (c.kind === 'missed') {
        out.push(`Note ${c.songIndex + 1}: you missed the ${songName(c)}.`);
      } else if (c.kind === 'extra') {
        const name = noteName(c.take, prefer);
        out.push(lastSong < 0
          ? `Before note 1 you added an extra ${name}.`
          : `After note ${lastSong + 1} you added an extra ${name}.`);
      }
      if (c.songIndex != null) lastSong = c.songIndex;
    }
    return out;
  }

  // The take as timed events for playback: real gaps between onsets, each clamped to 0.15..2.0 s,
  // dur = min(gap * 0.92, 1.2); the last note lasts 0.8 s.
  function takeEvents(take) {
    const notes = (take || []).filter((n) => n && Number.isFinite(n.midi));
    const out = [];
    let t = 0;
    notes.forEach((n, i) => {
      const next = notes[i + 1];
      const raw = next && Number.isFinite(n.at) && Number.isFinite(next.at) ? next.at - n.at : 0.5;
      const gap = Math.min(2, Math.max(0.15, raw));
      out.push({ midi: n.midi, at: t, dur: next ? Math.min(gap * 0.92, 1.2) : 0.8 });
      t += gap;
    });
    return out;
  }

  // True when `pct` beats the stored best (any score beats no best at all, except an empty 0%).
  function isNewBest(prev, pct) {
    if (!prev || !Number.isFinite(prev.pct)) return pct > 0;
    return pct > prev.pct;
  }

  const api = {
    CHORD_PCS, CHORD_NAMES, COST,
    align, counts, stripChordNotes, layout, nearestOctave, differences, summaryText, takeEvents, isNewBest,
    noteName, spellNear, pc, pcDist,
  };
  if (isNode) module.exports = api;
  else (root.NS = root.NS || {}).ByEar = api;
})(typeof window !== 'undefined' ? window : globalThis);
