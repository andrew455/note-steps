// Pitch detection (YIN) and note helpers. Works in the browser and in Node for testing.
(function (root) {
  const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const LETTER_SEMIS = [0, 2, 4, 5, 7, 9, 11];

  // Returns frequency in Hz, or null when no clear pitch is found.
  function detectPitch(buf, sampleRate, minHz = 60, maxHz = 1200) {
    const W = Math.floor(buf.length / 2);
    const tauMin = Math.max(2, Math.floor(sampleRate / maxHz));
    const tauMax = Math.min(W - 1, Math.floor(sampleRate / minHz));
    const d = new Float32Array(tauMax + 2);
    for (let tau = tauMin; tau <= tauMax + 1; tau++) {
      let sum = 0;
      for (let j = 0; j < W; j++) {
        const diff = buf[j] - buf[j + tau];
        sum += diff * diff;
      }
      d[tau] = sum;
    }
    // Cumulative mean normalized difference.
    let running = 0;
    for (let tau = 1; tau < tauMin; tau++) {
      let sum = 0;
      for (let j = 0; j < W; j++) {
        const diff = buf[j] - buf[j + tau];
        sum += diff * diff;
      }
      running += sum;
    }
    const cmnd = new Float32Array(tauMax + 2);
    for (let tau = tauMin; tau <= tauMax + 1; tau++) {
      running += d[tau];
      cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
    }
    const threshold = 0.15;
    let best = -1;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (cmnd[tau] < threshold) {
        while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
        best = tau;
        break;
      }
    }
    if (best < 0) return null;
    // Parabolic interpolation for sub-sample accuracy.
    const a = cmnd[best - 1] ?? cmnd[best];
    const b = cmnd[best];
    const c = cmnd[best + 1] ?? cmnd[best];
    const denom = a - 2 * b + c;
    const shift = denom !== 0 ? (a - c) / (2 * denom) : 0;
    return sampleRate / (best + shift);
  }

  function freqToMidi(f) { return 69 + 12 * Math.log2(f / 440); }
  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function midiName(m) { return NOTE_NAMES[((m % 12) + 12) % 12]; }

  // Length in beats: w h q e s (whole, half, quarter, eighth, sixteenth); a trailing "." makes it dotted.
  const DUR_BEATS = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25 };

  // "E4" -> { midi: 64, letter: 'E', staffPos: 0, dur: 'q', beats: 1 }  (staffPos 0 = bottom line of treble staff)
  // "D4:q." -> dotted quarter, 1.5 beats.
  function parseNote(token) {
    const [name, dur = 'q'] = token.split(':');
    const letter = name[0];
    const octave = parseInt(name.slice(1), 10);
    const li = LETTERS.indexOf(letter);
    return {
      letter,
      dur,
      beats: DUR_BEATS[dur[0]] * (dur.endsWith('.') ? 1.5 : 1),
      midi: 12 * (octave + 1) + LETTER_SEMIS[li],
      staffPos: octave * 7 + li - 30,
    };
  }

  const api = { detectPitch, freqToMidi, midiToFreq, midiName, parseNote, NOTE_NAMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Pitch = api;
})(typeof window !== 'undefined' ? window : globalThis);
