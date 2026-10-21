// Song library shared by every mode. Load after pitch.js.
//
// window.NoteSongs = { levels, songs, parseNotes }
//   levels[i]   = { title }
//   songs[i]    = { id, level, index, title, blurb, bpm, beatsPerBar, pickup, notes, endBeat, source }
//     bpm         full (100%) speed in beats per minute
//     beatsPerBar 3 or 4
//     pickup      beats before the first bar line (0 when the song starts on beat 1)
//     notes[j]    = { letter, midi, staffPos, dur, beats, beat }  (beat = start, in beats from the first note)
//     endBeat     total length in beats
//     source      the original note string
// Note tokens: letter + octave, then optional ":" + length (w h q e s, add "." for dotted). "E4" is a quarter note.
(function (root) {
  const { parseNote } = root.Pitch;

  const levels = [
    { title: 'Level 1 · C major, right hand' },
    { title: 'Level 2 · Rhythm and bigger jumps' },
  ];

  const RAW = [
    {
      id: 'scale-up', level: 0, bpm: 90, beatsPerBar: 3,
      title: 'C major scale, going up',
      blurb: 'C D E F G A B C, from middle C upward',
      notes: 'C4 D4 E4 F4 G4 A4 B4 C5:h',
    },
    {
      id: 'scale-down', level: 0, bpm: 90, beatsPerBar: 3,
      title: 'C major scale, going down',
      blurb: 'The same eight notes, from high C back to middle C',
      notes: 'C5 B4 A4 G4 F4 E4 D4 C4:h',
    },
    {
      id: 'mary', level: 0, bpm: 100, beatsPerBar: 4,
      title: 'Mary Had a Little Lamb',
      blurb: 'Only four notes: C, D, E and G',
      notes: 'E4 D4 C4 D4 E4 E4 E4:h D4 D4 D4:h E4 G4 G4:h E4 D4 C4 D4 E4 E4 E4 E4 D4 D4 E4 D4 C4:w',
    },
    {
      id: 'ode', level: 0, bpm: 100, beatsPerBar: 4,
      title: 'Ode to Joy',
      blurb: 'Five notes in a row, C to G',
      notes: 'E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4:q. D4:e D4:h E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4:q. C4:e C4:h',
    },
    {
      id: 'twinkle', level: 0, bpm: 100, beatsPerBar: 4,
      title: 'Twinkle Twinkle Little Star',
      blurb: 'Six notes, C to A, with a big jump',
      notes: 'C4 C4 G4 G4 A4 A4 G4:h F4 F4 E4 E4 D4 D4 C4:h G4 G4 F4 F4 E4 E4 D4:h G4 G4 F4 F4 E4 E4 D4:h C4 C4 G4 G4 A4 A4 G4:h F4 F4 E4 E4 D4 D4 C4:h',
    },
    {
      id: 'jingle', level: 1, bpm: 110, beatsPerBar: 4,
      title: 'Jingle Bells',
      blurb: 'Lots of repeated notes and a quick dotted rhythm',
      notes: 'E4 E4 E4:h E4 E4 E4:h E4 G4 C4:q. D4:e E4:w F4 F4 F4:q. F4:e F4 E4 E4 E4:e E4:e E4 D4 D4 E4 D4:h G4:h ' +
        'E4 E4 E4:h E4 E4 E4:h E4 G4 C4:q. D4:e E4:w F4 F4 F4:q. F4:e F4 E4 E4 E4:e E4:e G4 G4 F4 D4 C4:w',
    },
    {
      id: 'frere', level: 1, bpm: 100, beatsPerBar: 4,
      title: 'Frère Jacques',
      blurb: 'Quick eighth notes and a low G below middle C',
      notes: 'C4 D4 E4 C4 C4 D4 E4 C4 E4 F4 G4:h E4 F4 G4:h G4:e A4:e G4:e F4:e E4 C4 G4:e A4:e G4:e F4:e E4 C4 C4 G3 C4:h C4 G3 C4:h',
    },
    {
      id: 'birthday', level: 1, bpm: 90, beatsPerBar: 3, pickup: 1,
      title: 'Happy Birthday',
      blurb: 'Three beats in a bar, with notes above the staff',
      notes: 'G4:e. G4:s A4 G4 C5 B4:h G4:e. G4:s A4 G4 D5 C5:h G4:e. G4:s G5 E5 C5 B4 A4 F5:e. F5:s E5 C5 D5 C5:h.',
    },
  ];

  // "E4 D4:h" -> parsed notes with start beats; also returns the total length.
  function parseNotes(str) {
    let beat = 0;
    const notes = str.trim().split(/\s+/).map((tok) => {
      const n = parseNote(tok);
      n.beat = beat;
      beat += n.beats;
      return n;
    });
    return { notes, endBeat: beat };
  }

  const songs = RAW.map((s, index) => {
    const { notes, endBeat } = parseNotes(s.notes);
    return { pickup: 0, ...s, index, notes, endBeat, source: s.notes };
  });

  root.NoteSongs = { levels, songs, parseNotes };
})(window);
