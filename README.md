# Note Steps

A web app for learning to read music on a piano or keyboard. It shows a note on a treble-clef staff, you play it on a real keyboard, and the phone's microphone checks whether you played the right note.

Level 1 (C major, right hand): the scale going up, the scale going down, Mary Had a Little Lamb, Ode to Joy, and Twinkle Twinkle Little Star.

- `index.html`: the page layout and styles
- `app.js`: lessons, the staff drawing, the on-screen keyboard and the listening logic
- `pitch.js`: pitch detection (YIN)

Progress is saved in the phone's browser, so there are no accounts or keys.

The microphone only works from an `https://` address (or `localhost`), so put it on GitHub Pages to use it on a phone.

Run it locally with `python3 -m http.server 5173`, then open http://localhost:5173.
