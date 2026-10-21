// Song library shared by every mode. UMD: window.NoteSongs and NS.songs in the browser,
// require('./songs.js') in Node. Load after core/notation.js and core/curriculum.js.
//
// Raw entry (the source of truth below; titles and origins only, never any words of the songs):
//   { id, title, origin, pd:true, kind:'song'|'exercise', tags:[], family?, grade:1..5 (display only),
//     key ('C major'), timeSig ('4/4'), bpm, beatsPerBar, pickup?, music }
//   music: note tokens (letter + octave, then optional ":" + length: w h q e s, "." for dotted; "R" is a
//   rest), "|" a bar line (cosmetic) and "/" a phrase break. Every bar line is written in, so the bars
//   can be checked; a phrase break that falls on a bar line is written "| /".
//
// Parsed Song = raw + { index, level, notes, items, endBeat, phrases, keys, unit, stage, diff, blurb, source }
//   notes[j]   Notation notes, rests removed: { letter, midi, staffPos, dur, beats, beat, key, ... }
//   endBeat    total length in beats (rests included)
//   keys       distinct note keys, low to high ('C4', 'D4', ...)
//   unit       Curriculum.songLevel: the highest course unit the song needs (Infinity when it goes
//              outside the course), so a song only ever uses notes from its own unit and the ones before
//   stage      1..4 from the unit, or 'extra'; level = stage - 1 (4 for extras), as v1 levels
//   source     the same string as music (a non-enumerable getter kept for v1 readers)
//
// window.NoteSongs = { levels, songs, parseNotes }  (perform.js reads this through NoteSteps.songs)
// NS.songs = { all, get, byStage, etudesFor, moreLike, run, gradeFor, LEGACY_IDS }
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const Notation = isNode ? require('./core/notation.js') : root.NS.notation;
  const Curriculum = isNode ? require('./core/curriculum.js') : root.NS.curriculum;

  // The 8 ids from v1. Perform best scores are keyed by these, and their notes never change.
  const LEGACY_IDS = ['scale-up', 'scale-down', 'mary', 'ode', 'twinkle', 'jingle', 'frere', 'birthday'];

  const RAW = [
    // ---- C, D and E ----
    {
      id: 'hot-cross-buns', title: 'Hot Cross Buns', origin: 'Traditional English street cry',
      kind: 'song', tags: ['folk', 'kids'], grade: 1, bpm: 96, beatsPerBar: 4,
      music: 'E4 D4 C4:h | / E4 D4 C4:h | / C4:e C4:e C4:e C4:e D4:e D4:e D4:e D4:e | / E4 D4 C4:h',
    },
    {
      id: 'au-clair-de-la-lune', title: 'Au Clair de la Lune (first phrase)', origin: 'Traditional French, 18th century',
      kind: 'song', tags: ['folk'], grade: 1, bpm: 90, beatsPerBar: 4,
      music: 'C4 C4 C4 D4 | E4:h D4:h | / C4 E4 D4 D4 | C4:w | / C4 C4 C4 D4 | E4:h D4:h | / C4 E4 D4 D4 | C4:w',
    },
    // ---- up to G ----
    {
      id: 'mary', title: 'Mary Had a Little Lamb', origin: 'Traditional American, 19th century',
      kind: 'song', tags: ['folk', 'kids'], grade: 2, bpm: 100, beatsPerBar: 4,
      music: 'E4 D4 C4 D4 | E4 E4 E4:h | / D4 D4 D4:h | / E4 G4 G4:h | / E4 D4 C4 D4 | E4 E4 E4 E4 | / D4 D4 E4 D4 | C4:w',
    },
    {
      id: 'ode', title: 'Ode to Joy', origin: 'Ludwig van Beethoven (1770–1827)',
      kind: 'song', tags: ['classical'], grade: 2, bpm: 100, beatsPerBar: 4,
      music: 'E4 E4 F4 G4 | G4 F4 E4 D4 | / C4 C4 D4 E4 | E4:q. D4:e D4:h | / E4 E4 F4 G4 | G4 F4 E4 D4 | / C4 C4 D4 E4 | D4:q. C4:e C4:h',
    },
    {
      id: 'go-tell-aunt-rhody', title: 'Go Tell Aunt Rhody', origin: 'Traditional American',
      kind: 'song', tags: ['folk'], grade: 2, bpm: 92, beatsPerBar: 4,
      music: 'E4:h E4 D4 | C4:h C4:h | / D4:h D4 F4 | E4 D4 C4:h | / G4:h G4 F4 | E4:h E4:h | / D4 C4 D4 E4 | C4:w',
    },
    {
      id: 'lightly-row', title: 'Lightly Row', origin: 'German folk song',
      kind: 'song', tags: ['folk', 'kids'], grade: 2, bpm: 104, beatsPerBar: 4,
      music: 'G4 E4 E4:h | F4 D4 D4:h | / C4 D4 E4 F4 | G4 G4 G4:h | / G4 E4 E4:h | F4 D4 D4:h | / C4 E4 G4 G4 | C4:w | ' +
        '/ D4 D4 D4 D4 | D4 E4 F4:h | / E4 E4 E4 E4 | E4 F4 G4:h | / G4 E4 E4:h | F4 D4 D4:h | / C4 E4 G4 G4 | C4:w',
    },
    {
      id: 'jingle', title: 'Jingle Bells (chorus)', origin: 'James Lord Pierpont, 1857',
      kind: 'song', tags: ['holiday'], family: 'jingle', grade: 2, bpm: 110, beatsPerBar: 4,
      music: 'E4 E4 E4:h | E4 E4 E4:h | / E4 G4 C4:q. D4:e | E4:w | / F4 F4 F4:q. F4:e | F4 E4 E4 E4:e E4:e | ' +
        '/ E4 D4 D4 E4 | D4:h G4:h | / E4 E4 E4:h | E4 E4 E4:h | / E4 G4 C4:q. D4:e | E4:w | ' +
        '/ F4 F4 F4:q. F4:e | F4 E4 E4 E4:e E4:e | / G4 G4 F4 D4 | C4:w',
    },
    // ---- up to treble C ----
    {
      id: 'all-my-little-ducklings', title: 'All My Little Ducklings', origin: 'German folk song',
      kind: 'song', tags: ['folk', 'kids'], grade: 3, bpm: 96, beatsPerBar: 4,
      music: 'C4 D4 E4 F4 | G4:h G4:h | / A4 A4 A4 A4 | G4:w | / A4 A4 A4 A4 | G4:w | / F4 F4 F4 F4 | E4:h E4:h | / D4 D4 D4 D4 | C4:w',
    },
    {
      id: 'twinkle', title: 'Twinkle Twinkle Little Star', origin: 'French folk tune, 18th century',
      kind: 'song', tags: ['folk', 'kids'], grade: 3, bpm: 100, beatsPerBar: 4,
      music: 'C4 C4 G4 G4 | A4 A4 G4:h | / F4 F4 E4 E4 | D4 D4 C4:h | / G4 G4 F4 F4 | E4 E4 D4:h | ' +
        '/ G4 G4 F4 F4 | E4 E4 D4:h | / C4 C4 G4 G4 | A4 A4 G4:h | / F4 F4 E4 E4 | D4 D4 C4:h',
    },
    {
      id: 'london-bridge', title: 'London Bridge', origin: 'Traditional English',
      kind: 'song', tags: ['folk', 'kids'], grade: 3, bpm: 104, beatsPerBar: 4,
      music: 'G4:q. A4:e G4 F4 | E4 F4 G4:h | / D4 E4 F4:h | E4 F4 G4:h | / G4:q. A4:e G4 F4 | E4 F4 G4:h | / D4:h G4:h | E4 C4:h.',
    },
    {
      id: 'old-macdonald', title: 'Old MacDonald Had a Farm', origin: 'Traditional',
      kind: 'song', tags: ['folk', 'kids'], grade: 3, key: 'F major', bpm: 108, beatsPerBar: 4,
      music: 'F4 F4 F4 C4 | D4 D4 C4:h | / A4 A4 G4 G4 | F4:h. C4 | / F4 F4 F4 C4 | D4 D4 C4:h | / A4 A4 G4 G4 | F4:w',
    },
    {
      id: 'row-row-row-your-boat', title: 'Row, Row, Row Your Boat', origin: 'Traditional, 19th century',
      // The verified list had this at grade 2, but it climbs to treble C (C5), so it belongs with C5.
      kind: 'song', tags: ['folk', 'kids'], grade: 4, timeSig: '6/8', bpm: 100, beatsPerBar: 3,
      music: 'C4:q. C4:q. | C4 D4:e E4:q. | / E4 D4:e E4 F4:e | G4:h. | / C5:e C5:e C5:e G4:e G4:e G4:e | ' +
        '/ E4:e E4:e E4:e C4:e C4:e C4:e | / G4 F4:e E4 D4:e | C4:h.',
    },
    {
      id: 'frere', title: 'Frère Jacques (low)', origin: 'Traditional French',
      kind: 'song', tags: ['folk', 'kids'], family: 'frere', grade: 3, bpm: 100, beatsPerBar: 4,
      music: 'C4 D4 E4 C4 | / C4 D4 E4 C4 | / E4 F4 G4:h | / E4 F4 G4:h | / G4:e A4:e G4:e F4:e E4 C4 | ' +
        '/ G4:e A4:e G4:e F4:e E4 C4 | / C4 G3 C4:h | / C4 G3 C4:h',
    },
    {
      id: 'scale-up', title: 'C major scale, going up', origin: 'Exercise',
      kind: 'exercise', tags: [], grade: 4, bpm: 90, beatsPerBar: 3,
      music: 'C4 D4 E4 | F4 / G4 A4 | B4 C5:h',
    },
    {
      id: 'scale-down', title: 'C major scale, going down', origin: 'Exercise',
      kind: 'exercise', tags: [], grade: 4, bpm: 90, beatsPerBar: 3,
      music: 'C5 B4 A4 | G4 / F4 E4 | D4 C4:h',
    },
    {
      id: 'amazing-grace', title: 'Amazing Grace (first phrase)', origin: 'Traditional American tune, 1829',
      kind: 'song', tags: ['folk'], grade: 4, key: 'F major', bpm: 76, beatsPerBar: 3, pickup: 1,
      music: 'C4 | F4:h A4:e F4:e | A4:h G4 | F4:h D4 | C4:h / C4 | F4:h A4:e F4:e | A4:h G4 | C5:h.',
    },
    {
      id: 'can-can', title: 'Can-Can (Galop)', origin: 'Jacques Offenbach (1819–1880)',
      kind: 'song', tags: ['classical'], grade: 4, bpm: 120, beatsPerBar: 4,
      music: 'C4:h D4:e F4:e E4:e D4:e | / G4 G4 G4:e A4:e E4:e F4:e | / D4 D4 D4:e F4:e E4:e D4:e | ' +
        '/ C4:e C5:e B4:e A4:e G4:e F4:e E4:e D4:e | / C4:h D4:e F4:e E4:e D4:e | / G4 G4 G4:e A4:e E4:e F4:e | ' +
        '/ D4 D4 D4:e F4:e E4:e D4:e | / C4:e G4:e D4:e E4:e C4:h',
    },
    // ---- top of the staff ----
    {
      id: 'frere-jacques', title: 'Frère Jacques', origin: 'Traditional French',
      // The verified list had this at grade 3, but it reaches E5 at the top of the staff.
      kind: 'song', tags: ['folk', 'kids'], family: 'frere', grade: 5, key: 'G major', bpm: 100, beatsPerBar: 4,
      music: 'G4 A4 B4 G4 | / G4 A4 B4 G4 | / B4 C5 D5:h | / B4 C5 D5:h | / D5:e E5:e D5:e C5:e B4 G4 | ' +
        '/ D5:e E5:e D5:e C5:e B4 G4 | / G4 D4 G4:h | / G4 D4 G4:h',
    },
    {
      id: 'silent-night', title: 'Silent Night', origin: 'Franz Xaver Gruber (1787–1863)',
      kind: 'song', tags: ['holiday'], grade: 5, timeSig: '6/8', bpm: 84, beatsPerBar: 3,
      music: 'G4:q. A4:e G4 | E4:h. | / G4:q. A4:e G4 | E4:h. | / D5:h D5 | B4:h. | / C5:h C5 | G4:h. | ' +
        '/ A4:h A4 | C5:q. B4:e A4 | G4:q. A4:e G4 | E4:h. | / A4:h A4 | C5:q. B4:e A4 | G4:q. A4:e G4 | E4:h.',
    },
    {
      id: 'auld-lang-syne', title: 'Auld Lang Syne', origin: 'Traditional Scottish',
      kind: 'song', tags: ['folk', 'holiday'], grade: 5, key: 'F major', bpm: 80, beatsPerBar: 4, pickup: 1,
      music: 'C4 | F4:q. F4:e F4 A4 | G4:q. F4:e G4 A4 | / F4:q. F4:e A4 C5 | D5:h. / D5 | ' +
        'C5:q. A4:e A4 F4 | G4:q. F4:e G4 A4 | / F4:q. D4:e D4 C4 | F4:w',
    },
    {
      id: 'jingle-bells-verse', title: 'Jingle Bells (verse)', origin: 'James Lord Pierpont, 1857',
      kind: 'song', tags: ['holiday'], family: 'jingle', grade: 5, bpm: 112, beatsPerBar: 4,
      music: 'G4 E5 D5 C5 | G4:h. G4:e G4:e | / G4 E5 D5 C5 | A4:w | / A4 F5 E5 D5 | B4:w | / G5 G5 F5 D5 | E5:w',
    },
    {
      id: 'yankee-doodle', title: 'Yankee Doodle', origin: 'Traditional American, 18th century',
      kind: 'song', tags: ['folk'], grade: 5, bpm: 120, beatsPerBar: 4,
      music: 'C5 C5 D5 E5 | C5 E5 D5 G4 | / C5 C5 D5 E5 | C5:h B4:h | / C5 C5 D5 E5 | F5 E5 D5 C5 | / B4 G4 A4 B4 | C5:h C5:h',
    },
    {
      id: 'birthday', title: 'Happy Birthday', origin: 'Mildred J. Hill and Patty Hill, 1893',
      kind: 'song', tags: ['kids'], grade: 5, bpm: 90, beatsPerBar: 3, pickup: 1,
      music: 'G4:e. G4:s | A4 G4 C5 | B4:h / G4:e. G4:s | A4 G4 D5 | C5:h / G4:e. G4:s | G5 E5 C5 | B4 A4 / F5:e. F5:s | E5 C5 D5 | C5:h.',
    },
  ];

  // ---------- parsing ----------

  // v1 helper kept for perform.js and anyone else: "E4 D4:h" -> { notes (rests removed, with .beat), endBeat }.
  // Also accepts "|" bar lines, "/" phrase marks and "R" rests.
  function parseNotes(str) {
    const m = Notation.parseMelody(str);
    return { notes: m.notes, endBeat: m.endBeat };
  }

  const LETTER_SHOW = { '#': '♯', b: '♭', '': '' };
  const keySort = (a, b) => Notation.fromKey(a).midi - Notation.fromKey(b).midi;
  const distinctKeys = (notes) => [...new Set(notes.map((n) => n.key || Notation.noteKey(n)))].sort(keySort);
  const blurbFor = (keys) => 'Uses ' + keys.map((k) => {
    const n = Notation.fromKey(k);
    return n.letter + LETTER_SHOW[n.acc || ''];
  }).join(' ');

  // The verified library's grade, worked out from the notes so it can't drift from them:
  // 1 = C D E, 2 = up to G, 3 = A, 4 = B and treble C, 5 = above treble C. Notes outside the course
  // (like the low G in 'frere') don't count. Display only.
  const GRADE_OF = { C4: 1, D4: 1, E4: 1, F4: 2, G4: 2, A4: 3, B4: 4, C5: 4, D5: 5, E5: 5, F5: 5, G5: 5 };
  const gradeFor = (keys) => Math.max(1, ...keys.map((k) => GRADE_OF[k] || 0));

  function stageOf(unit) {
    return Number.isFinite(unit) && Curriculum.UNITS[unit] ? Curriculum.UNITS[unit].stage : 'extra';
  }

  // raw -> Song (without index). Shared by the library and the generated pieces.
  function build(raw) {
    const beatsPerBar = raw.beatsPerBar || 4;
    const pickup = raw.pickup || 0;
    const m = Notation.parseMelody(raw.music, { beatsPerBar, pickup });
    const keys = distinctKeys(m.notes);
    const song = {
      pd: true, key: 'C major', timeSig: beatsPerBar + '/4', tags: [], ...raw,
      beatsPerBar, pickup,
      notes: m.notes, items: m.items, endBeat: m.endBeat, phrases: m.phrases, bars: m.bars, keys,
      blurb: blurbFor(keys),
    };
    song.unit = Curriculum.songLevel(song);
    song.stage = stageOf(song.unit);
    song.level = song.stage === 'extra' ? STAGE_COUNT : song.stage - 1;
    song.diff = Curriculum.songDiff(song);
    Object.defineProperty(song, 'source', { get() { return this.music; }, enumerable: false });
    return song;
  }

  const STAGE_COUNT = Curriculum.STAGES.length;
  const levels = Curriculum.STAGES.map((t, k) => ({ title: `Stage ${k + 1} · ${t}` })).concat([{ title: 'Extras' }]);

  // Sort order defines index: (stage, unit, diff, title), extras last.
  const rank = (s) => (s.stage === 'extra' ? Infinity : s.stage);
  function compare(a, b) {
    return rank(a) - rank(b) || (a.unit === b.unit ? 0 : a.unit < b.unit ? -1 : 1) ||
      a.diff - b.diff || a.title.localeCompare(b.title);
  }

  const songs = RAW.map(build).sort(compare);
  songs.forEach((s, i) => (s.index = i));
  const byId = new Map(songs.map((s) => [s.id, s]));

  // ---------- generated reading (Little steps etudes, More like this, reading runs) ----------

  const generated = new Map(); // id -> Song
  function generatedSong(id, raw) {
    if (!generated.has(id)) {
      const song = build({
        pd: true, kind: 'exercise', tags: [], grade: null, bpm: 80, beatsPerBar: 4, pickup: 0,
        origin: 'Made up by the app for reading practice', ...raw, id,
      });
      song.index = -1; // not in NoteSongs.songs
      song.generated = true;
      if (song.grade == null) song.grade = gradeFor(song.keys);
      generated.set(id, song);
    }
    return generated.get(id);
  }

  // Five (or n) short pieces for one unit: every note so far, leaning on the unit's own new notes.
  function etudesFor(unit, n = 5) {
    const u = Curriculum.UNITS[unit];
    if (!u) return [];
    const pool = Curriculum.UNITS.slice(0, unit + 1).flatMap((x) => x.notes);
    const out = [];
    for (let k = 0; k < n; k++) {
      out.push(generatedSong(`etude-u${unit}-${k}`, {
        title: `Little steps ${unit + 1}.${k + 1}`,
        tags: ['little-steps'],
        etude: true,
        music: Curriculum.genPhrase(pool, u.notes, { seed: unit * 100 + k }),
      }));
    }
    return out;
  }

  // Another short piece with only this song's notes.
  function moreLike(song, seed) {
    const s = typeof song === 'string' ? byId.get(song) : song;
    if (!s) return null;
    const sd = Math.abs(Math.floor(Number(seed) || 0));
    return generatedSong(`more-${s.id}-${sd}`, {
      title: `Another short one like ${s.title}`,
      tags: ['little-steps'],
      music: Curriculum.genPhrase(s.keys, [], { seed: sd }),
    });
  }

  // A reading run of the notes you have met (S = the store state; mastery picks the focus).
  function run(seed, S) {
    const sd = Math.abs(Math.floor(Number(seed) || 0));
    return generatedSong(`run-${sd}`, {
      title: 'A short reading run',
      tags: ['little-steps'],
      music: Curriculum.readingRun(S, sd),
    });
  }

  function currentState() {
    const st = root.NS && root.NS.store;
    try { return st && st.state ? st.state() : null; } catch (e) { return null; }
  }

  // Library ids, plus the generated ones: 'etude-u{u}-{k}', 'more-{songId}-{seed}' and 'run-{seed}'.
  function get(id) {
    if (byId.has(id)) return byId.get(id);
    if (generated.has(id)) return generated.get(id);
    let m = /^etude-u(\d+)-(\d+)$/.exec(id || '');
    if (m) {
      const unit = Number(m[1]);
      const k = Number(m[2]);
      if (!Curriculum.UNITS[unit] || k > 99) return null;
      return etudesFor(unit, k + 1)[k];
    }
    m = /^more-(.+)-(\d+)$/.exec(id || '');
    if (m) return byId.has(m[1]) ? moreLike(byId.get(m[1]), Number(m[2])) : null;
    m = /^run-(\d+)$/.exec(id || '');
    if (m) return run(Number(m[1]), currentState());
    return null;
  }

  // { 1:[...], 2:[...], 3:[...], 4:[...], extra:[...] } in library order. With {etudes:true}, each unit's
  // songs are followed by that unit's Little steps etudes (the library screen's groups).
  function byStage({ etudes = false } = {}) {
    const out = { extra: [] };
    for (let k = 1; k <= STAGE_COUNT; k++) out[k] = [];
    if (!etudes) {
      songs.forEach((s) => out[s.stage].push(s));
      return out;
    }
    Curriculum.UNITS.forEach((u, unit) => {
      songs.filter((s) => s.unit === unit).forEach((s) => out[u.stage].push(s));
      out[u.stage].push(...etudesFor(unit));
    });
    songs.filter((s) => s.stage === 'extra').forEach((s) => out.extra.push(s));
    return out;
  }

  const api = {
    LEGACY_IDS, RAW, levels, songs, parseNotes, gradeFor,
    all: () => songs, get, byStage, etudesFor, moreLike, run,
  };
  if (isNode) module.exports = api;
  else {
    root.NoteSongs = { levels, songs, parseNotes };
    (root.NS = root.NS || {}).songs = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
