// Chord recognition for the lesson-complete popup: listens for a C major (C E G) or C minor (C E♭ G)
// chord on a real piano. Works in the browser (window.ChordDetect) and in Node for testing.
//
// How it works, per analyser frame:
//   1. Pick spectral peaks (50 Hz - 8 kHz) that stand well above the local noise floor and are
//      narrow on at least one side (a neighbouring partial may fill the other).
//   2. Treat each peak between ~110 Hz and ~1.4 kHz as a possible note and score it by how many of its
//      harmonics are present. The stretch window for string inharmonicity grows with pitch, since
//      treble strings are stiffer.
//   3. Walk the candidates from low to high. A candidate that sits on a harmonic of a note already
//      accepted is an overtone, not a note. This is what keeps the 5th harmonic of C (which lands almost
//      exactly on E) from turning C minor into C major, and the 3rd harmonic of E♭ / 5th of G from
//      adding B♭ or B.
//   4. Anchors: a note below the range (C2) or with a weak or missing fundamental (small speakers,
//      phone mics) is not found by step 3, and its partials then pose as notes: C3's 2nd, 3rd and 5th
//      partials are C4, G4, E5, a C major. Such a lower note replaces the "notes" it explains only when
//      its harmonic comb has peaks nothing else explains (its own fundamental, or partials 7, 11, 13,
//      which no equal-tempered key can sit on). An open voicing C4 G4 E5 has none, so it stays a chord.
//   5. Fold the notes into a 12-bin chroma (0 = C) and compare it with the two chord shapes.
(function (root) {
  'use strict';

  const DEFAULTS = {
    fMin: 50,             // lowest frequency looked at for peaks (Hz)
    fMax: 8000,           // highest frequency looked at for peaks (Hz)
    f0Min: 110,           // lowest chord-note fundamental (just under C3's lowest inversion)
    f0Max: 1400,          // highest note fundamental considered (above E6)
    harmonics: 10,        // harmonics scored per candidate note
    tol: 0.012,           // frequency tolerance for a harmonic match (fraction)
    bMax: 0.0008,         // largest piano inharmonicity coefficient allowed for, up to bRef Hz...
    bRef: 220,            // ...growing in proportion to f0 above it (treble strings are stiffer)
    bCap: 0.006,
    prominenceDb: 12,     // a peak must stand this far above the local noise floor
    sharpnessDb: 6,       // and this far above the bin 4 away on at least one side (sines are narrow)
    rangeDb: 50,          // and be within this many dB of the loudest peak
    relSalience: 0.1,     // a note must score at least this fraction of the strongest note
    minSupport: 2,        // and have at least this many of harmonics 2..5 present
    fundRatio: 0.1,       // and its own first partial must reach this fraction of its loudest of 2..4
    // Anchors: a low note below f0Min, or a note whose fundamental is weak or missing, whose
    // partials would otherwise be heard as separate notes (C3's 2nd, 3rd and 5th = C4, G4, E5).
    anchorMin: 55,        // lowest anchor fundamental (Hz)
    anchorH: 13,          // harmonics checked for anchor evidence
    anchorEvidence: 2,    // peaks on the anchor's comb that no other note explains
    anchorEvidenceDb: 28, // evidence peaks within this many dB of the strongest absorbed note
    anchorFundDb: 40,     // a real fundamental peak counts down to this many dB under it
    anchorLowPartials: 4, // of harmonics 2..6, at least this many present
    // classify()
    minTone: 0.12,        // each chord tone must reach this fraction of the strongest pitch class
    thirdRatio: 0.35,     // the wrong third may be at most this fraction of the right third
    maxOther: 0.25,       // non-chord pitch classes may be at most this fraction of the strongest
    otherVsTone: 0.6,     // ...and at most this fraction of the weakest chord tone
  };

  // Harmonic numbers with a prime factor >= 7: these partials are 30-50 cents away from any
  // equal-tempered note, so a played key cannot sit on them.
  const OFF_TUNE = [];
  for (let h = 0; h <= 40; h++) {
    let m = h;
    for (const p of [2, 3, 5]) while (m > 1 && m % p === 0) m /= p;
    OFF_TUNE[h] = h > 1 && m > 1;
  }
  const CHORDS = { C: [0, 4, 7], Cm: [0, 3, 7], G: [7, 11, 2] };
  const NON_CHORD = [1, 2, 5, 6, 8, 9, 10, 11];

  function withDefaults(opts) {
    if (!opts) return DEFAULTS;
    if (opts.__chordOpts) return opts;
    const o = { __chordOpts: true };
    for (const k in DEFAULTS) o[k] = opts[k] !== undefined ? opts[k] : DEFAULTS[k];
    return o;
  }

  function freqToMidi(f) { return 69 + 12 * Math.log2(f / 440); }

  // Inharmonicity allowance for a note whose first partial is f1.
  function bFor(f1, o) { return Math.min(o.bCap, o.bMax * Math.max(1, f1 / o.bRef)); }

  // Upper edge of the search window for harmonic h of a partial-1 frequency f1 (string stretch included).
  function stretch(h, b) { return Math.sqrt((1 + b * h * h) / (1 + b)); }
  function winLo(f1, h, o) { return h * f1 * (1 - o.tol); }
  function winHi(f1, h, o) { return h * f1 * stretch(h, bFor(f1, o)) * (1 + o.tol); }

  // ---------------------------------------------------------------- peaks
  // Returns { f: Float64Array, a: Float64Array, n } sorted by frequency; a is linear magnitude.
  function pickPeaks(db, sampleRate, fftSize, o) {
    const binHz = sampleRate / fftSize;
    const k0 = Math.max(3, Math.floor(o.fMin / binHz));
    const k1 = Math.min(db.length - 5, Math.ceil(Math.min(o.fMax, sampleRate * 0.47) / binHz));
    const out = { f: new Float64Array(0), a: new Float64Array(0), n: 0 };
    if (k1 <= k0) return out;
    const val = (k) => { const v = db[k]; return v > -300 ? v : -300; };

    // Noise floor: 25th percentile of 32-bin blocks, median of 3 neighbouring blocks, then interpolated.
    const B = 32;
    const nb = Math.ceil((k1 - k0 + 1) / B);
    const raw = new Float64Array(nb);
    const tmp = new Float64Array(B);
    let gmax = -300;
    for (let b = 0; b < nb; b++) {
      const s = k0 + b * B;
      const e = Math.min(k1 + 1, s + B);
      let m = 0;
      for (let k = s; k < e; k++) {
        const v = val(k);
        tmp[m++] = v;
        if (v > gmax) gmax = v;
      }
      const t = tmp.subarray(0, m).sort();
      raw[b] = t[Math.floor(m * 0.25)];
    }
    const blk = new Float64Array(nb);
    for (let b = 0; b < nb; b++) {
      const x = raw[Math.max(0, b - 1)], y = raw[b], z = raw[Math.min(nb - 1, b + 1)];
      blk[b] = Math.max(Math.min(x, y), Math.min(Math.max(x, y), z));
    }
    const floorAt = (k) => {
      const p = (k - k0) / B - 0.5;
      const i = Math.max(0, Math.min(nb - 1, Math.floor(p)));
      const j = Math.min(nb - 1, i + 1);
      const t = Math.max(0, Math.min(1, p - i));
      return blk[i] + (blk[j] - blk[i]) * t;
    };

    const fs = [];
    const as = [];
    const minDb = gmax - o.rangeDb;
    for (let k = k0; k <= k1; k++) {
      const v = val(k);
      if (v < minDb) continue;
      if (!(v > val(k - 1) && v >= val(k + 1) && v > val(k - 2) && v >= val(k + 2))) continue;
      if (v < floorAt(k) + o.prominenceDb) continue;
      // Narrow on at least one side: a neighbouring partial's main lobe may fill the other side.
      if (v < Math.min(val(k - 4), val(k + 4)) + o.sharpnessDb) continue;
      const a = val(k - 1), c = val(k + 1);
      const den = a - 2 * v + c;
      const p = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
      fs.push((k + p) * binHz);
      as.push(Math.pow(10, (v - 0.25 * (a - c) * p) / 20));
    }
    out.f = Float64Array.from(fs);
    out.a = Float64Array.from(as);
    out.n = fs.length;
    return out;
  }

  // Index of the first peak with f >= lo.
  function firstAtOrAbove(pk, lo) {
    let l = 0, r = pk.n;
    while (l < r) { const m = (l + r) >> 1; if (pk.f[m] < lo) l = m + 1; else r = m; }
    return l;
  }

  // Index of the loudest peak with lo <= f <= hi, or -1.
  function loudestIn(pk, lo, hi) {
    let best = -1;
    for (let i = firstAtOrAbove(pk, lo); i < pk.n && pk.f[i] <= hi; i++) if (best < 0 || pk.a[i] > pk.a[best]) best = i;
    return best;
  }

  // Is frequency f a harmonic (h >= hMin) of a note whose first partial is f1?
  function isHarmonicOf(f, f1, o, hMin) {
    const h0 = hMin || 2;
    const r = f / f1;
    if (r < h0 * (1 - o.tol)) return false;
    const hMax = Math.min(32, Math.ceil(r) + 1);
    for (let h = h0; h <= hMax; h++) {
      if (f >= winLo(f1, h, o) && f <= winHi(f1, h, o)) return true;
    }
    return false;
  }
  // Which harmonic (h >= 2) of f1 the frequency f is, or 0.
  function harmonicIndex(f, f1, o) {
    const r = f / f1;
    if (r < 2 * (1 - o.tol)) return 0;
    const hMax = Math.min(32, Math.ceil(r) + 1);
    for (let h = 2; h <= hMax; h++) if (f >= winLo(f1, h, o) && f <= winHi(f1, h, o)) return h;
    return 0;
  }
  function explainedBy(f, notes, o) {
    for (const n of notes) if (Math.abs(f / n.f - 1) <= o.tol || isHarmonicOf(f, n.f, o)) return true;
    return false;
  }

  // Harmonic comb of a candidate fundamental f0 (harmonics 2..o.harmonics).
  function comb(pk, f0, o) {
    let sal = 0;
    let support = 0;
    let loudLow = 0;
    for (let h = 2; h <= o.harmonics; h++) {
      const lo = winLo(f0, h, o);
      if (lo > o.fMax) break;
      const j = loudestIn(pk, lo, winHi(f0, h, o));
      if (j < 0) continue;
      sal += pk.a[j] / Math.sqrt(h);
      if (h <= 5) support++;
      if (h <= 4 && pk.a[j] > loudLow) loudLow = pk.a[j];
    }
    return { sal, support, loudLow };
  }

  function makeNote(f, salience, support) {
    const midi = freqToMidi(f);
    const r = Math.round(midi);
    return { f, midi, pc: ((r % 12) + 12) % 12, salience, support };
  }

  // ---------------------------------------------------------------- notes
  // Returns the notes heard in one frame: [{ f, midi, pc, salience, support }], low to high.
  function findNotes(db, sampleRate, fftSize, opts) {
    const o = withDefaults(opts);
    const pk = pickPeaks(db, sampleRate, fftSize, o);
    const cands = [];
    const doubtful = []; // real peaks that may be the (weak) fundamental of a note: anchor candidates
    for (let i = 0; i < pk.n; i++) {
      const f0 = pk.f[i];
      if (f0 < o.anchorMin || f0 > o.f0Max) continue;
      const c = comb(pk, f0, o);
      // A "note" whose fundamental is far weaker than its overtones is either a gap between other
      // notes or a real note heard mostly through its overtones: decide that later, as an anchor.
      if (f0 < o.f0Min || pk.a[i] < o.fundRatio * c.loudLow) {
        doubtful.push({ f: f0, a: pk.a[i] });
        continue;
      }
      cands.push({ f: f0, a: pk.a[i], salience: pk.a[i] + c.sal, support: c.support });
    }
    let smax = 0;
    for (const c of cands) if (c.support >= o.minSupport && c.salience > smax) smax = c.salience;
    let notes = [];
    for (const c of cands) {
      if (c.support < o.minSupport || c.salience < o.relSalience * smax) continue;
      if (notes.some((n) => isHarmonicOf(c.f, n.f, o))) continue;
      notes.push(makeNote(c.f, c.salience, c.support));
    }
    if (!notes.length) return notes;
    return resolveAnchors(pk, notes, doubtful, o);
  }

  // A low note (below f0Min) or one with a weak / missing fundamental shows up as several "notes"
  // made of its own partials: C3 without its fundamental reads as C4 + G4 + E5, a C major. Such a
  // note (the anchor) replaces the notes it explains, but only if its harmonic comb has peaks that
  // the notes already found cannot explain (its fundamental, or odd partials like the 7th and 11th).
  // A real open voicing C4 G4 E5 has no such peaks, so it stays a chord.
  function resolveAnchors(pk, notes, doubtful, o) {
    const anchors = [];
    const add = (f, real) => {
      if (f < o.anchorMin) return;
      for (const a of anchors) if (Math.abs(f / a.f - 1) < 0.02) { a.real = a.real || real; return; }
      anchors.push({ f, real });
    };
    for (const d of doubtful) add(d.f, true);
    for (const d of doubtful) { add(d.f / 2, false); add(d.f / 3, false); }
    for (const n of notes) { add(n.f / 2, false); add(n.f / 3, false); add(n.f / 4, false); }
    // Real (weak) fundamentals first: they are direct evidence of a note, and must not be used up as
    // "evidence" for a virtual note an octave or a twelfth below them.
    anchors.sort((x, y) => (y.real - x.real) || x.f - y.f);

    for (const an of anchors) {
      const f1 = an.f;
      // Already a note, or an overtone of one.
      if (notes.some((n) => Math.abs(f1 / n.f - 1) < 0.03 || isHarmonicOf(f1, n.f, o))) continue;
      const absorbed = [];
      const plausible = []; // notes that could still be real chord tones if the anchor is real
      for (const n of notes) {
        const h = harmonicIndex(n.f, f1, o);
        if (h) absorbed.push(n);
        // Partials 7, 11, 13 ... of any note sit far from equal-tempered pitches, so a "note" there
        // is that partial, not a key that was played.
        if (!h || !OFF_TUNE[h]) plausible.push(n);
      }
      if (!absorbed.length) continue;
      let ref = 0;
      for (const n of absorbed) {
        const j = loudestIn(pk, n.f * (1 - o.tol), n.f * (1 + o.tol));
        if (j >= 0 && pk.a[j] > ref) ref = pk.a[j];
      }
      const minA = ref * Math.pow(10, -o.anchorEvidenceDb / 20);
      const minFundA = ref * Math.pow(10, -o.anchorFundDb / 20);
      let evidence = 0;
      let fundSeen = false;
      let lowCount = 0;
      let sal = 0;
      for (let h = 1; h <= o.anchorH; h++) {
        const lo = h === 1 ? f1 * (1 - 2 * o.tol) : winLo(f1, h, o);
        const hi = h === 1 ? f1 * (1 + 2 * o.tol) : winHi(f1, h, o);
        if (lo > o.fMax) break;
        let hit = false, any = false, hitA = 0;
        for (let i = firstAtOrAbove(pk, lo); i < pk.n && pk.f[i] <= hi; i++) {
          if (pk.a[i] < (h === 1 ? minFundA : minA)) continue;
          any = true;
          if (h === 1 && !an.real) continue;
          if (explainedBy(pk.f[i], plausible, o)) continue;
          hit = true;
          hitA = Math.max(hitA, pk.a[i]);
        }
        if (any && h >= 2 && h <= 6) lowCount++;
        if (hit) {
          evidence++;
          sal = Math.max(sal, hitA);
          if (h === 1) fundSeen = true;
        }
      }
      // A real note has most of its low partials; it must explain two "notes" (or show its own
      // fundamental), and have at least anchorEvidence partials nothing else explains.
      if (lowCount < o.anchorLowPartials) continue;
      if (absorbed.length < 2 && !fundSeen) continue;
      if (evidence < o.anchorEvidence) continue;
      for (const n of absorbed) sal += n.salience;
      const keep = notes.filter((n) => absorbed.indexOf(n) < 0);
      keep.push(makeNote(f1, sal, absorbed.length));
      keep.sort((x, y) => x.f - y.f);
      notes = keep;
    }
    return notes;
  }

  // dB spectrum (AnalyserNode.getFloatFrequencyData) -> Float32Array(12), index 0 = C.
  function chromaFromSpectrum(dbData, sampleRate, fftSize, opts) {
    const chroma = new Float32Array(12);
    const notes = findNotes(dbData, sampleRate, fftSize, opts);
    for (const n of notes) chroma[n.pc] += n.salience;
    return chroma;
  }

  // ---------------------------------------------------------------- classify
  // opts.targets: which chords may be reported (default C and Cm; G major is also known).
  function classify(chroma, opts) {
    const o = withDefaults(opts);
    const targets = (opts && opts.targets) || ['C', 'Cm'];
    let max = 0;
    for (let i = 0; i < 12; i++) if (chroma[i] > max) max = chroma[i];
    const scores = {};
    for (const id of targets) scores[id] = 0;
    if (!(max > 0)) return { name: null, scores, confidence: 0 };
    const c = new Float64Array(12);
    for (let i = 0; i < 12; i++) c[i] = chroma[i] / max;

    let name = null;
    let best = 0;
    for (const id of targets) {
      if (!CHORDS[id]) continue;
      const [r, third, fifth] = CHORDS[id];
      // The other third (major vs minor) is judged on its own; every other pitch class is "other".
      const wrong = (third - r + 12) % 12 === 4 ? (third + 11) % 12 : (third + 1) % 12;
      let other = 0;
      for (let i = 0; i < 12; i++) {
        if (i === r || i === third || i === fifth || i === wrong) continue;
        if (c[i] > other) other = c[i];
      }
      const weakest = Math.min(c[r], c[third], c[fifth]);
      const ok = weakest >= o.minTone &&
        c[wrong] <= o.thirdRatio * c[third] &&
        other <= o.maxOther && other <= o.otherVsTone * weakest;
      const sc = Math.max(0, Math.min(1, weakest - c[wrong] - other));
      scores[id] = sc;
      if (ok && sc > best) { best = sc; name = id; }
    }
    return { name, scores, confidence: name ? best : 0 };
  }

  // ---------------------------------------------------------------- detector
  // Frame-by-frame state machine. A chord is reported once, only after a fresh attack and a stable
  // classification held for holdMs; afterwards nothing is reported for cooldownMs.
  function createDetector(opts) {
    const o = Object.assign({
      holdMs: 180,
      cooldownMs: 1200,
      maxWaitMs: 1000,   // give up on an attack that never settles into a chord
      onsetRatio: 1.6,   // RMS must jump by this factor over the recent minimum
      onsetLookMs: 250,
      gateRatio: 2.5,    // ...and stand this far above the tracked room-noise floor (about 8 dB)
      minRms: 1e-4,      // absolute floor for the gate (-80 dBFS): the gate is relative to the room
      graceFrames: 1,    // null frames tolerated inside a hold
    }, opts || {});
    const so = withDefaults(o); // spectral options, resolved once
    let hist, floor, armedAt, armFloor, lastOnset, cand, candSince, misses, cooldownUntil;

    function reset() {
      hist = [];
      floor = 0;
      armedAt = null;
      armFloor = 0;
      lastOnset = -Infinity;
      cand = null;
      candSince = 0;
      misses = 0;
      cooldownUntil = -Infinity;
    }
    reset();

    // flags (optional): { clipped: true } when the input is overloaded; such frames are not
    // classified, since clipping creates intermodulation tones (C + G clipped grows an E).
    function push(dbData, sampleRate, fftSize, nowMs, rms, flags) {
      if (rms == null || !isFinite(rms)) rms = rmsFromSpectrum(dbData);
      floor = floor === 0 ? rms : floor + (rms - floor) * (rms < floor ? 0.3 : 0.004);
      const gate = Math.max(o.minRms, floor * o.gateRatio);
      while (hist.length && nowMs - hist[0].t > o.onsetLookMs) hist.shift();
      let low = Infinity;
      for (const h of hist) if (h.rms < low) low = h.rms;
      hist.push({ t: nowMs, rms });

      const onset = rms > gate && (low === Infinity || rms > low * o.onsetRatio) && nowMs - lastOnset > 50;
      if (onset) lastOnset = nowMs;
      if (nowMs < cooldownUntil) { armedAt = null; return null; }
      if (onset) {
        // A new attack (or the next note of a rolled chord) starts the hold again.
        if (armedAt === null || nowMs - armedAt > 400) {
          armedAt = nowMs;
          // The room level before this attack. The tracked floor creeps up while a loud chord
          // rings, so the give-up test below uses this value instead.
          armFloor = Math.min(floor, low === Infinity ? floor : low);
        }
        cand = null;
        misses = 0;
      }
      if (armedAt === null) return null;
      // Give up when the attack never settles, or the sound has died back to the room level.
      // (A staccato chord is still in the 340 ms analysis window after its level has dropped.)
      if (nowMs - armedAt > o.maxWaitMs || rms < Math.max(o.minRms, armFloor * 1.5)) {
        armedAt = null; cand = null; return null;
      }
      if (flags && flags.clipped) { cand = null; misses = 0; return null; }

      const res = classify(chromaFromSpectrum(dbData, sampleRate, fftSize, so), Object.assign({}, so, { targets: o.targets }));
      if (res.name && res.name === cand) {
        misses = 0;
        if (nowMs - candSince >= o.holdMs) {
          armedAt = null;
          cand = null;
          cooldownUntil = nowMs + o.cooldownMs;
          return res.name;
        }
      } else if (res.name) {
        cand = res.name;
        candSince = nowMs;
        misses = 0;
      } else if (cand && ++misses > o.graceFrames) {
        cand = null;
      }
      return null;
    }

    return { push, reset };
  }

  // Rough level estimate from a dB spectrum, for callers that have no time-domain RMS.
  function rmsFromSpectrum(db) {
    let s = 0;
    for (let k = 1; k < db.length; k++) {
      const v = db[k];
      if (v > -200) s += Math.pow(10, v / 10);
    }
    // Blackman-windowed, 1/N-scaled bins: sum |X|^2 ≈ rms^2 * 0.30 / 2.
    return Math.sqrt(s / 0.15);
  }

  // RMS of the last n samples of a buffer (the newest audio sits at the end).
  function tailRms(buf, n) {
    const len = Math.min(buf.length, n || 2048);
    let s = 0;
    for (let i = buf.length - len; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / len);
  }

  // A hard-clipped buffer has many samples sitting exactly on its largest magnitude. Unclipped
  // music reaches its peak once (sines spend time near, not at, their peak).
  function isClipped(buf) {
    let max = 0;
    for (let i = 0; i < buf.length; i++) { const v = buf[i] < 0 ? -buf[i] : buf[i]; if (v > max) max = v; }
    if (max < 0.05) return false;
    const thr = max * (1 - 1e-5);
    let n = 0;
    for (let i = 0; i < buf.length; i++) if (buf[i] >= thr || buf[i] <= -thr) n++;
    return n >= Math.max(8, buf.length * 0.001);
  }

  // ---------------------------------------------------------------- browser glue
  // Taps the mic source with a long FFT of its own and calls onChord('C' | 'Cm').
  function attach(audioContext, sourceNode, opts) {
    const o = opts || {};
    const an = audioContext.createAnalyser();
    // Keep about 3 Hz per bin (C3-octave chord tones are only 8-10 Hz apart at their fundamentals'
    // neighbours): 16384 at 44.1 / 48 kHz, 32768 (the AnalyserNode maximum) at 88.2 / 96 kHz.
    an.fftSize = o.fftSize || (audioContext.sampleRate > 64000 ? 32768 : 16384);
    an.smoothingTimeConstant = o.smoothingTimeConstant != null ? o.smoothingTimeConstant : 0.5;
    an.minDecibels = -100;
    an.maxDecibels = -30;
    sourceNode.connect(an);
    const freq = new Float32Array(an.frequencyBinCount);
    const td = new Float32Array(an.fftSize);
    const det = createDetector(o);
    const interval = o.intervalMs || 30;
    const rmsLen = Math.max(2048, Math.round(audioContext.sampleRate * 0.043));
    let clipUntil = -Infinity;
    let timer = null;
    let connected = true;
    const now = typeof o.now === 'function' ? o.now
      : () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

    function tick() {
      an.getFloatFrequencyData(freq);
      an.getFloatTimeDomainData(td);
      const t = now();
      if (typeof o.muted === 'function' && o.muted()) { det.reset(); return; }
      // An overloaded input (flat-topped waveform) is not classified while it is in the analysis
      // window, nor for a few frames after while the analyser's smoothing forgets it.
      if (isClipped(td)) clipUntil = t + 150;
      const name = det.push(freq, audioContext.sampleRate, an.fftSize, t, tailRms(td, rmsLen), { clipped: t < clipUntil });
      if (name && typeof o.onChord === 'function') {
        try { o.onChord(name); } catch (e) { setTimeout(() => { throw e; }); }
      }
    }
    function start() {
      if (timer || !connected) return;
      det.reset();
      timer = setInterval(tick, interval);
    }
    function stop() {
      clearInterval(timer);
      timer = null;
    }
    function dispose() {
      stop();
      if (connected) {
        try { sourceNode.disconnect(an); } catch (e) { /* already gone */ }
        connected = false;
      }
    }
    return { start, stop, dispose, analyser: an };
  }

  const api = { chromaFromSpectrum, classify, createDetector, attach, findNotes, tailRms, isClipped, DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ChordDetect = api;
})(typeof window !== 'undefined' ? window : globalThis);
