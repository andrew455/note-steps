# Note Steps

A web app for learning to read music on a piano or keyboard. It shows notes on a treble-clef staff, you play them on a real keyboard, and the phone's microphone checks whether you played the right note.

Every song has two modes:

- **Practice** waits for you on each note, with no timer.
- **Perform** scrolls the song past a play line in time, Guitar Hero style. It scores each note as Perfect, Good or Miss, builds a combo multiplier, and gives 1 to 3 stars. You can play at 50%, 75% or 100% speed, and your best score is kept for each speed. "Set up timing" measures your phone's mic delay so scoring is fair.

Songs unlock in order: finish the previous one in Practice, or get 2 stars performing it.

- Level 1 (C major, right hand): the scale going up, the scale going down, Mary Had a Little Lamb, Ode to Joy, Twinkle Twinkle Little Star
- Level 2 (rhythm and bigger jumps): Jingle Bells, Frère Jacques, Happy Birthday

Files:

- `index.html`: the page layout and shared styles
- `songs.js`: the song library (notes, rhythm, tempo, level), shared by every mode
- `app.js`: the home screen, Practice mode, the microphone listener, sound, staff drawing, and the `window.NoteSteps` API that modes plug into
- `perform.js`, `perform.css`: Perform mode
- `pitch.js`: pitch detection (YIN) and note parsing

Progress is saved in the phone's browser, so there are no accounts or keys.

The microphone only works from an `https://` address (or `localhost`), so put it on GitHub Pages to use it on a phone.

Run it locally with `python3 -m http.server 5173`, then open http://localhost:5173.
