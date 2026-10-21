// songs.js (WP4): the graded song library (spec §2.4.11, §2.5, §3.8, §5.1).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Pitch = require('../pitch.js');
const Notation = require('../core/notation.js');
const Curriculum = require('../core/curriculum.js');
const Songs = require('../songs.js');

const SONGS_PATH = path.join(__dirname, '..', 'songs.js');
const VERIFIED_PATH = path.join(__dirname, '..', 'docs', 'verified-songs.json');
const byId = (id) => Songs.get(id);
const all = Songs.all();

// The note strings shipped in v1 (commit 954cd27 / b39bea5). Perform best scores depend on these.
const V1 = {
  'scale-up': 'C4 D4 E4 F4 G4 A4 B4 C5:h',
  'scale-down': 'C5 B4 A4 G4 F4 E4 D4 C4:h',
  mary: 'E4 D4 C4 D4 E4 E4 E4:h D4 D4 D4:h E4 G4 G4:h E4 D4 C4 D4 E4 E4 E4 E4 D4 D4 E4 D4 C4:w',
  ode: 'E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4:q. D4:e D4:h E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4:q. C4:e C4:h',
  twinkle: 'C4 C4 G4 G4 A4 A4 G4:h F4 F4 E4 E4 D4 D4 C4:h G4 G4 F4 F4 E4 E4 D4:h G4 G4 F4 F4 E4 E4 D4:h C4 C4 G4 G4 A4 A4 G4:h F4 F4 E4 E4 D4 D4 C4:h',
  jingle: 'E4 E4 E4:h E4 E4 E4:h E4 G4 C4:q. D4:e E4:w F4 F4 F4:q. F4:e F4 E4 E4 E4:e E4:e E4 D4 D4 E4 D4:h G4:h ' +
    'E4 E4 E4:h E4 E4 E4:h E4 G4 C4:q. D4:e E4:w F4 F4 F4:q. F4:e F4 E4 E4 E4:e E4:e G4 G4 F4 D4 C4:w',
  frere: 'C4 D4 E4 C4 C4 D4 E4 C4 E4 F4 G4:h E4 F4 G4:h G4:e A4:e G4:e F4:e E4 C4 G4:e A4:e G4:e F4:e E4 C4 C4 G3 C4:h C4 G3 C4:h',
  birthday: 'G4:e. G4:s A4 G4 C5 B4:h G4:e. G4:s A4 G4 D5 C5:h G4:e. G4:s G5 E5 C5 B4 A4 F5:e. F5:s E5 C5 D5 C5:h.',
};

// §3.8.1: the 23 entries, with their exact titles and origins.
const TABLE = {
  'ping-pong': ['Ping Pong', 'Note Steps original'],
  'step-and-back': ['Step and Back', 'Note Steps original'],
  'three-little-steps': ['Three Little Steps', 'Note Steps original'],
  'four-step-march': ['Four Step March', 'Note Steps original'],
  'f-fanfare': ['F Fanfare', 'Note Steps original'],
  'little-ladder': ['The Little Ladder', 'Note Steps original'],
  'when-the-saints': ['When the Saints Go Marching In (first line)', 'Traditional American spiritual'],
  'up-to-b': ['Up to B', 'Note Steps original'],
  'evening-bells': ['Evening Bells', 'Note Steps original'],
  'up-the-hill': ['Up the Hill', 'Note Steps original'],
  'skylark': ['Skylark', 'Note Steps original'],
  'top-line-waltz': ['Top Line Waltz', 'Note Steps original'],
  'sky-high': ['Sky High', 'Note Steps original'],

  'hot-cross-buns': ['Hot Cross Buns', 'Traditional English street cry'],
  'au-clair-de-la-lune': ['Au Clair de la Lune (first phrase)', 'Traditional French, 18th century'],
  mary: ['Mary Had a Little Lamb', 'Traditional American, 19th century'],
  ode: ['Ode to Joy', 'Ludwig van Beethoven (1770–1827)'],
  'go-tell-aunt-rhody': ['Go Tell Aunt Rhody', 'Traditional American'],
  'lightly-row': ['Lightly Row', 'German folk song'],
  jingle: ['Jingle Bells (chorus)', 'James Lord Pierpont, 1857'],
  'row-row-row-your-boat': ['Row, Row, Row Your Boat', 'Traditional, 19th century'],
  'all-my-little-ducklings': ['All My Little Ducklings', 'German folk song'],
  twinkle: ['Twinkle Twinkle Little Star', 'French folk tune, 18th century'],
  'london-bridge': ['London Bridge', 'Traditional English'],
  'old-macdonald': ['Old MacDonald Had a Farm', 'Traditional'],
  'frere-jacques': ['Frère Jacques', 'Traditional French'],
  frere: ['Frère Jacques (low)', 'Traditional French'],
  'scale-up': ['C major scale, going up', 'Exercise'],
  'scale-down': ['C major scale, going down', 'Exercise'],
  'amazing-grace': ['Amazing Grace (first phrase)', 'Traditional American tune, 1829'],
  'can-can': ['Can-Can (Galop)', 'Jacques Offenbach (1819–1880)'],
  'silent-night': ['Silent Night', 'Franz Xaver Gruber (1787–1863)'],
  'auld-lang-syne': ['Auld Lang Syne', 'Traditional Scottish'],
  'jingle-bells-verse': ['Jingle Bells (verse)', 'James Lord Pierpont, 1857'],
  'yankee-doodle': ['Yankee Doodle', 'Traditional American, 18th century'],
  birthday: ['Happy Birthday', 'Mildred J. Hill and Patty Hill, 1893'],
};

// Verified-library ids that are the same tune as a legacy id.
const VERIFIED_TO_LEGACY = {
  'mary-had-a-little-lamb': 'mary', 'ode-to-joy': 'ode', 'twinkle-twinkle': 'twinkle',
  'jingle-bells-chorus': 'jingle', 'c-scale-up': 'scale-up', 'c-scale-down': 'scale-down', 'happy-birthday': 'birthday',
};

const tokensOf = (music) => music.trim().split(/\s+/);
const noteTokens = (music) => tokensOf(music).filter((t) => t !== '|' && t !== '/');
const pick = (n) => ({ letter: n.letter, midi: n.midi, staffPos: n.staffPos, dur: n.dur, beats: n.beats, beat: n.beat });

function v1Parse(str) {
  let beat = 0;
  const notes = str.trim().split(/\s+/).map((tok) => {
    const n = Pitch.parseNote(tok);
    n.beat = beat;
    beat += n.beats;
    return n;
  });
  return { notes, endBeat: beat };
}

// ---------- ids, legacy and content ----------

test('ids are unique and the library is the 23 entries of §3.8.1 plus the added songs', () => {
  const ids = all.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...ids].sort(), Object.keys(TABLE).sort());
  assert.equal(Songs.RAW.length, 36);
});

test('every legacy id is present and its notes match the v1 string exactly', () => {
  assert.deepEqual(Songs.LEGACY_IDS, ['scale-up', 'scale-down', 'mary', 'ode', 'twinkle', 'jingle', 'frere', 'birthday']);
  for (const id of Songs.LEGACY_IDS) {
    const s = byId(id);
    assert.ok(s, id);
    const v1 = v1Parse(V1[id]);
    assert.deepEqual(s.notes.map(pick), v1.notes.map(pick), id);
    assert.equal(s.endBeat, v1.endBeat, id);
    assert.equal(noteTokens(s.music).join(' '), V1[id], `${id}: only "|" and "/" marks were added`);
  }
});

test('titles, origins, kinds and families follow §3.8.1', () => {
  for (const s of all) {
    const [title, origin] = TABLE[s.id];
    assert.equal(s.title, title, s.id);
    assert.equal(s.origin, origin, s.id);
    assert.equal(s.pd, true, s.id);
    assert.ok(typeof s.origin === 'string' && s.origin.trim().length > 0, s.id);
    assert.ok(Array.isArray(s.tags), s.id);
    for (const t of s.tags) assert.ok(['folk', 'classical', 'holiday', 'kids'].includes(t), `${s.id} tag ${t}`);
  }
  assert.equal(byId('scale-up').kind, 'exercise');
  assert.equal(byId('scale-down').kind, 'exercise');
  assert.ok(all.filter((s) => !s.id.startsWith('scale-')).every((s) => s.kind === 'song'));
  assert.equal(byId('jingle').family, 'jingle');
  assert.equal(byId('jingle-bells-verse').family, 'jingle');
  assert.equal(byId('frere').family, 'frere');
  assert.equal(byId('frere-jacques').family, 'frere');
});

test('the verified tunes are merged note for note', { skip: !fs.existsSync(VERIFIED_PATH) && 'docs/verified-songs.json missing' }, () => {
  const verified = JSON.parse(fs.readFileSync(VERIFIED_PATH, 'utf8'));
  assert.equal(verified.length, 22);
  for (const v of verified) {
    const id = VERIFIED_TO_LEGACY[v.id] || v.id;
    const s = byId(id);
    assert.ok(s, `${v.id} -> ${id}`);
    const want = Notation.parseMelody(v.notes).notes.map((n) => [n.midi, n.beats]);
    assert.deepEqual(s.notes.map((n) => [n.midi, n.beats]), want, id);
    const [num] = v.timeSig.split('/').map(Number);
    if (!VERIFIED_TO_LEGACY[v.id]) {
      assert.equal(s.bpm, v.bpm, id);
      assert.equal(s.pickup, v.pickupBeats, id);
      assert.equal(s.timeSig, v.timeSig, id);
      assert.equal(s.beatsPerBar, num === 6 ? 3 : num, id); // 6/8 is written in quarter-note beats
    }
    // notesUsed recomputed from the notation (the verified list's own notesUsed is not trusted)
    assert.deepEqual(new Set(s.keys), new Set(Notation.parseMelody(v.notes).notes.map((n) => n.key)), id);
  }
});

// ---------- notation ----------

test('every token parses and every note is within G3..C6', () => {
  const lo = Pitch.parseNote('G3').midi;
  const hi = Pitch.parseNote('C6').midi;
  for (const s of all) {
    for (const tok of noteTokens(s.music)) {
      const n = Notation.parseToken(tok);
      assert.ok(n.kind === 'note' || n.kind === 'rest', `${s.id} ${tok}`);
      assert.ok(Number.isFinite(n.beats) && n.beats > 0, `${s.id} ${tok}`);
    }
    for (const n of s.notes) assert.ok(n.midi >= lo && n.midi <= hi, `${s.id} ${n.key}`);
  }
});

test('bars add up: every bar line is written and every bar has beatsPerBar beats', () => {
  for (const s of all) {
    const bars = [];
    let cur = 0;
    for (const tok of tokensOf(s.music)) {
      if (tok === '/') continue;
      if (tok === '|') { bars.push(cur); cur = 0; continue; }
      cur += Notation.parseToken(tok).beats;
    }
    bars.push(cur);
    const bpb = s.beatsPerBar;
    const first = s.pickup || bpb;
    assert.equal(bars[0], first, `${s.id} first bar`);
    for (let i = 1; i < bars.length - 1; i++) assert.equal(bars[i], bpb, `${s.id} bar ${i + 1}`);
    if (bars.length > 1) {
      const last = bars[bars.length - 1];
      assert.ok(last === bpb || (s.pickup && last === bpb - s.pickup), `${s.id} last bar has ${last} beats`);
    }
    // total length is whole bars plus the pickup
    assert.equal((s.endBeat - (s.pickup || 0)) % bpb === 0 || (s.endBeat % bpb === 0), true, `${s.id} length`);
  }
});

test('phrases are marked, contiguous, cover every note and have 2..10 notes each', () => {
  for (const s of all) {
    assert.ok(tokensOf(s.music).includes('/'), `${s.id} has phrase marks`);
    assert.ok(s.phrases.length >= 2, s.id);
    let at = 0;
    for (const [from, to] of s.phrases) {
      assert.equal(from, at, `${s.id} phrases are contiguous`);
      assert.ok(to - from >= 2 && to - from <= 10, `${s.id} phrase [${from},${to}) has ${to - from} notes`);
      at = to;
    }
    assert.equal(at, s.notes.length, `${s.id} phrases cover every note`);
  }
});

test('legacy phrases match the Ear First expectations of §3.7.6', () => {
  const lens = (id) => byId(id).phrases.map(([a, b]) => b - a);
  assert.deepEqual(lens('twinkle'), [7, 7, 7, 7, 7, 7]);
  assert.deepEqual(lens('ode'), [8, 7, 8, 7]);
  assert.deepEqual(lens('mary'), [7, 3, 3, 8, 5]);
  assert.deepEqual(lens('hot-cross-buns'), [3, 3, 8, 3]);
});

// ---------- no lyrics ----------

test('no lyrics: only music holds song text, no lyric-like keys, short titles', () => {
  const BANNED = new Set(['lyrics', 'lyric', 'words', 'text', 'verse', 'teachingNote']);
  function walk(obj, where, top) {
    for (const [k, v] of Object.entries(obj)) {
      assert.ok(!BANNED.has(k), `${where} has a key named ${k}`);
      if (typeof v === 'string') {
        if (!(top && k === 'music')) assert.ok(v.length <= 60, `${where}.${k} is ${v.length} characters`);
      } else if (v && typeof v === 'object') walk(v, `${where}.${k}`, false);
    }
  }
  for (const raw of Songs.RAW) walk(raw, `RAW ${raw.id}`, true);
  for (const s of all) {
    walk(s, s.id, true);
    assert.ok(s.title.length < 60, s.id);
    assert.ok(!Object.keys(s).includes('source'), `${s.id}: source is not an own enumerable field`);
    assert.equal(s.source, s.music, `${s.id}: v1 source still reads the music`);
  }
  for (const e of [...Songs.etudesFor(3), Songs.moreLike(byId('mary'), 9), Songs.run(4, null)]) walk(e, e.id, true);
});

// ---------- tempo, metre and the fields Perform reads ----------

test('bpm is 50..160, beatsPerBar is 2, 3 or 4, and key and time signature are set', () => {
  for (const s of all) {
    assert.ok(s.bpm >= 50 && s.bpm <= 160, `${s.id} bpm ${s.bpm}`);
    assert.ok([2, 3, 4].includes(s.beatsPerBar), `${s.id} beatsPerBar ${s.beatsPerBar}`);
    assert.ok(Number.isFinite(s.pickup) && s.pickup >= 0 && s.pickup < s.beatsPerBar, s.id);
    assert.match(s.key, /^[A-G][♯♭]? (major|minor)$/, s.id);
    assert.match(s.timeSig, /^(2|3|4|6)\/(4|8)$/, s.id);
  }
  assert.equal(byId('mary').key, 'C major');
  assert.equal(byId('frere-jacques').key, 'G major');
  assert.equal(byId('old-macdonald').key, 'F major');
  assert.equal(byId('silent-night').timeSig, '6/8');
});

test('Perform fields (§2.5): index, notes without rests, endBeat', () => {
  all.forEach((s, i) => {
    assert.equal(s.index, i);
    for (const f of ['id', 'title']) assert.equal(typeof s[f], 'string', `${s.id}.${f}`);
    for (const f of ['bpm', 'beatsPerBar', 'pickup', 'endBeat']) assert.ok(Number.isFinite(s[f]), `${s.id}.${f}`);
    assert.ok(s.notes.length > 0, s.id);
    for (const n of s.notes) {
      for (const f of ['letter', 'dur']) assert.equal(typeof n[f], 'string', `${s.id} note.${f}`);
      for (const f of ['midi', 'staffPos', 'beats', 'beat']) assert.ok(Number.isFinite(n[f]), `${s.id} note.${f}`);
      assert.notEqual(n.kind, 'rest');
    }
    for (let j = 1; j < s.notes.length; j++) assert.ok(s.notes[j].beat >= s.notes[j - 1].beat + s.notes[j - 1].beats - 1e-9);
    const last = s.notes[s.notes.length - 1];
    assert.ok(s.endBeat >= last.beat + last.beats - 1e-9, s.id);
  });
});

test('parseNotes keeps the v1 shape and counts rests in endBeat', () => {
  const p = Songs.parseNotes('E4 D4:h | R:q / C4:w');
  assert.deepEqual(p.notes.map((n) => [n.letter, n.beat, n.beats]), [['E', 0, 1], ['D', 1, 2], ['C', 4, 4]]);
  assert.equal(p.endBeat, 8);
});

// ---------- levels vs notes ----------

test('each course unit adds at most 2 new notes', () => {
  const seen = new Set();
  for (const u of Curriculum.UNITS) {
    assert.ok(u.notes.length >= 1 && u.notes.length <= 2);
    for (const k of u.notes) { assert.ok(!seen.has(k)); seen.add(k); }
  }
});

test('levels vs notes: unit, stage and level are computed from the notes the song uses', () => {
  for (const s of all) {
    const keys = [...new Set(s.notes.map((n) => n.key))];
    assert.deepEqual([...s.keys].sort(), keys.sort(), `${s.id} keys`);
    const inCourse = keys.every((k) => k in Curriculum.UNIT_OF);
    if (!inCourse) {
      assert.equal(s.unit, Infinity, s.id);
      assert.equal(s.stage, 'extra', s.id);
      assert.equal(s.level, 4, s.id);
      continue;
    }
    const unit = Math.max(...keys.map((k) => Curriculum.UNIT_OF[k]));
    assert.equal(s.unit, unit, `${s.id} unit`);
    // every note is in the song's unit or an earlier one, and the song uses its unit's new note
    const allowed = new Set(Curriculum.UNITS.slice(0, unit + 1).flatMap((u) => u.notes));
    for (const k of keys) assert.ok(allowed.has(k), `${s.id} uses ${k} beyond unit ${unit}`);
    assert.ok(Curriculum.UNITS[unit].notes.some((k) => keys.includes(k)), `${s.id} uses a note of its own unit`);
    assert.equal(s.stage, Curriculum.UNITS[unit].stage, `${s.id} stage`);
    assert.equal(s.level, s.stage - 1, `${s.id} level`);
    assert.equal(s.grade, Songs.gradeFor(keys), `${s.id} grade agrees with its notes`);
  }
});

test('the songs the verified list mis-levelled are re-levelled from their notes', () => {
  assert.equal(byId('hot-cross-buns').unit, 1);
  assert.equal(byId('mary').unit, 3);
  assert.equal(byId('frere').stage, 'extra'); // low G3
  const row = byId('row-row-row-your-boat'); // climbs to treble C
  assert.ok(row.keys.includes('C5'));
  assert.equal(row.unit, Curriculum.UNIT_OF.C5);
  assert.equal(row.stage, 3);
  assert.equal(row.grade, 4);
  const fj = byId('frere-jacques'); // reaches E5
  assert.ok(fj.keys.includes('E5'));
  assert.equal(fj.unit, Curriculum.UNIT_OF.E5);
  assert.equal(fj.stage, 4);
  assert.equal(fj.grade, 5);
});

test('library order is (stage, unit, diff, title) with extras last; levels name the stages', () => {
  const rank = (s) => (s.stage === 'extra' ? 99 : s.stage);
  const unit = (s) => (Number.isFinite(s.unit) ? s.unit : 99);
  for (let i = 1; i < all.length; i++) {
    const a = all[i - 1];
    const b = all[i];
    const c = rank(a) - rank(b) || unit(a) - unit(b) || a.diff - b.diff || a.title.localeCompare(b.title);
    assert.ok(c <= 0, `${a.id} before ${b.id}`);
  }
  assert.equal(all[all.length - 1].id, 'frere');
  assert.deepEqual(Songs.levels.map((l) => l.title), [
    'Stage 1 · Middle C home', 'Stage 2 · Up to G', 'Stage 3 · Up to treble C', 'Stage 4 · Top of the staff', 'Extras',
  ]);
  for (const s of all) assert.ok(Songs.levels[s.level], s.id);
  // grade never goes down along the course
  const course = all.filter((s) => s.stage !== 'extra');
  for (let i = 1; i < course.length; i++) assert.ok(course[i].grade >= course[i - 1].grade);
});

test('stages 1–3 each have at least 4 pieces to read (songs plus Little steps)', () => {
  const lib = Songs.byStage();
  const withEtudes = Songs.byStage({ etudes: true });
  for (const k of [1, 2, 3]) assert.ok(withEtudes[k].length >= 4, `stage ${k}`);
  assert.ok(lib[2].length >= 4 && lib[3].length >= 4);
  // Stage 1 (C D E): the two verified tunes plus the originals written for the first notes.
  assert.deepEqual(lib[1].map((s) => s.id).sort(), ['au-clair-de-la-lune', 'hot-cross-buns', 'ping-pong', 'step-and-back', 'three-little-steps']);
  assert.deepEqual(lib.extra.map((s) => s.id), ['frere']);
  const counted = [1, 2, 3, 4].reduce((n, k) => n + lib[k].length, lib.extra.length);
  assert.equal(counted, all.length);
  // each unit's group ends with its 5 etudes
  const s1 = withEtudes[1].map((s) => s.id);
  // unit 0's group (its songs, then its 5 etudes) comes before unit 1's
  const u0 = ['etude-u0-0', 'etude-u0-1', 'etude-u0-2', 'etude-u0-3', 'etude-u0-4'];
  u0.forEach((id) => assert.ok(s1.includes(id), id));
  assert.ok(s1.indexOf('etude-u0-4') < s1.indexOf('hot-cross-buns'));
  assert.deepEqual(s1.slice(-5), ['etude-u1-0', 'etude-u1-1', 'etude-u1-2', 'etude-u1-3', 'etude-u1-4']);
});

// ---------- generated reading ----------

test('etudesFor(3, 5) is deterministic and uses only keys of units <= 3', () => {
  const a = Songs.etudesFor(3, 5);
  delete require.cache[require.resolve('../songs.js')];
  const b = require('../songs.js').etudesFor(3, 5);
  assert.equal(a.length, 5);
  assert.deepEqual(a.map((s) => s.music), b.map((s) => s.music));
  assert.deepEqual(a.map((s) => s.id), ['etude-u3-0', 'etude-u3-1', 'etude-u3-2', 'etude-u3-3', 'etude-u3-4']);
  const pool = new Set(Curriculum.UNITS.slice(0, 4).flatMap((u) => u.notes));
  for (const s of a) {
    for (const n of s.notes) assert.ok(pool.has(n.key), `${s.id} uses ${n.key}`);
    assert.ok(s.unit <= 3, s.id);
    assert.equal(s.stage, Curriculum.UNITS[s.unit].stage);
    assert.equal(s.index, -1);
    assert.equal(s.etude, true);
    assert.equal(s.pd, true);
    assert.ok(s.notes.length >= 4);
  }
  assert.deepEqual(Songs.etudesFor(99), []);
});

test('get() resolves library, etude, more-like and run ids', () => {
  assert.equal(Songs.get('mary'), byId('mary'));
  const e = Songs.get('etude-u2-4');
  assert.equal(e.id, 'etude-u2-4');
  assert.equal(e, Songs.etudesFor(2)[4]);
  const m = Songs.moreLike(byId('mary'), 42);
  assert.equal(Songs.get('more-mary-42'), m);
  for (const n of m.notes) assert.ok(byId('mary').keys.includes(n.key));
  const r = Songs.get('run-7');
  assert.equal(r.id, 'run-7');
  assert.ok(r.notes.length >= 8);
  assert.equal(Songs.get('nope'), null);
  assert.equal(Songs.get('etude-u42-0'), null);
  assert.equal(Songs.get('more-nope-1'), null);
});

// ---------- browser build ----------

test('in the browser it sets window.NoteSongs and NS.songs', () => {
  const win = { NS: { notation: Notation, curriculum: Curriculum } };
  vm.runInNewContext(fs.readFileSync(SONGS_PATH, 'utf8'), { window: win });
  assert.ok(win.NoteSongs && Array.isArray(win.NoteSongs.songs));
  assert.equal(win.NoteSongs.songs.length, Songs.RAW.length);
  assert.equal(typeof win.NoteSongs.parseNotes, 'function');
  assert.equal(win.NoteSongs.levels.length, 5);
  assert.equal(win.NS.songs.all(), win.NoteSongs.songs);
  assert.equal(JSON.stringify(win.NoteSongs.songs.map((s) => s.id)), JSON.stringify(all.map((s) => s.id)));
});
