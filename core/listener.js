// Note listener: onset + pitch decisions from microphone frames. Pure (no DOM, no audio graph), so it
// runs in Node for testing. Browser: NS.listener (used by core/audio.js). Node: require('./listener.js').
//
// A port of the v1 app.js tick() with the pitch-class voting and flush change (spec §2.4.2):
//   - onset: rms over the gate, 110 ms since the last onset, and either quiet before or a rise of
//     `rise` (1.7x) over the quietest of the last 4 hops since the previous onset (`riseRepeat`,
//     1.35x, while expect({repeat:true})).
//   - from 35 ms after the attack (the refined onset time, not the hop that saw it), YIN runs on every
//     hop; a vote is kept when it is within 0.4 of a
//     semitone. Votes are counted by pitch class, so octave flips (60, 72, 60) don't stall a decision.
//   - 2 votes in a row in one pitch class decide the note at once ('agree', confident).
//   - a new onset while a note is still undecided first emits the old one if a pitch class has 2 votes
//     ('flush', not confident), so fast notes aren't lost.
//   - 500 ms after the onset, the majority pitch class with at least 2 votes wins ('timeout').
//   - the reported midi is the most common octave in the winning pitch class; on a tie, the lower one
//     (YIN's usual slip on a piano tone is up an octave, onto the strong 2nd partial).
// Onset timing (`at`, audio-clock seconds) comes from refineOnset() on the frame, joined to the part of
// the previous hop's frame that comes before it, so a late-detected restrike still finds its attack.
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;

  const DEFAULT_PARAMS = {
    minGate: 0.008, floorMult: 3, quietMult: 0.6, retriggerMs: 110, rise: 1.7, riseRepeat: 1.35,
    riseLookback: 4, voteStartMs: 35, centsTol: 0.4, agree: 2, timeoutMs: 500, minHz: 70, maxHz: 1400,
  };

  const pcOf = (m) => ((m % 12) + 12) % 12;

  // Finds where the attack starts inside the frame, as an audio-clock time. `now` is the audio-clock
  // time of the frame's last sample. v1's method (64-sample energy blocks, 30% of the way from the
  // quietest block before the peak up to the peak), with the walk-back smoothed.
  function refineOnset(data, sr, now) {
    const B = 64;
    const nb = Math.floor(data.length / B);
    const e = new Float32Array(nb);
    for (let k = 0; k < nb; k++) {
      let s = 0;
      for (let j = k * B; j < (k + 1) * B; j++) s += data[j] * data[j];
      e[k] = Math.sqrt(s / B);
    }
    let pk = 0;
    for (let k = 1; k < nb; k++) if (e[k] > e[pk]) pk = k;
    let lo = e[pk];
    for (let k = 0; k <= pk; k++) lo = Math.min(lo, e[k]);
    const thr = lo + 0.3 * (e[pk] - lo);
    // Walk back over a running max of 3 blocks (4.4 ms), so a block that falls near a zero crossing of
    // the waveform doesn't stop the walk inside the note.
    const env = (k) => Math.max(e[k], k > 0 ? e[k - 1] : 0, k > 1 ? e[k - 2] : 0);
    let k = pk;
    while (k > 0 && env(k - 1) > thr) k--;
    return now - (data.length - k * B) / sr;
  }

  // Picks the winner among votes [{m (rounded midi), raw}] for one pitch class.
  function decide(votes, pc) {
    const inPc = votes.filter((v) => pcOf(v.m) === pc);
    const counts = new Map();
    inPc.forEach((v) => counts.set(v.m, (counts.get(v.m) || 0) + 1));
    let midi = null;
    let best = -1;
    counts.forEach((c, m) => {
      if (c > best || (c === best && m < midi)) { best = c; midi = m; }
    });
    const cents = inPc.length ? (100 * inPc.reduce((s, v) => s + (v.raw - v.m), 0)) / inPc.length : null;
    return { midi, cents, n: inPc.length };
  }

  // The pitch class with the most votes (ties: the one voted most recently).
  function majorityPc(votes) {
    const counts = new Map();
    const last = new Map();
    votes.forEach((v, i) => {
      const pc = pcOf(v.m);
      counts.set(pc, (counts.get(pc) || 0) + 1);
      last.set(pc, i);
    });
    let pc = null;
    let best = 0;
    counts.forEach((c, p) => {
      if (c > best || (c === best && last.get(p) > last.get(pc))) { best = c; pc = p; }
    });
    return { pc, count: best };
  }

  function create({ detectPitch, freqToMidi, params } = {}) {
    if (!detectPitch || !freqToMidi) throw new Error('Listener.create needs detectPitch and freqToMidi');
    const P = Object.assign({}, DEFAULT_PARAMS, params || {});
    const rmsHist = [];
    let floor = 0.002;
    let quiet = true;
    let armed = false; // an onset happened since the last 'quiet' event
    let lastOnset = -Infinity;
    let pending = null;
    let riseCur = P.rise;
    let prev = null; // the previous hop's frame: {data:Float32Array, ctxTime, sr}

    function noteEvent(p, pc, nowMs, reason, rms) {
      const { midi, cents } = decide(p.votes, pc);
      return {
        type: 'note', midi, cents, at: p.at, tOnset: p.atMs, tConfirm: nowMs,
        confident: reason === 'agree', reason, rms,
      };
    }

    // The frame with the earlier part of the previous hop's frame in front of it (when the two are
    // contiguous on the audio clock), so refineOnset can look back past the start of this frame.
    function withLookback(frame, ctxTime, sr) {
      if (!prev || prev.sr !== sr) return frame;
      const n = Math.round((ctxTime - prev.ctxTime) * sr);
      if (n <= 0 || n > prev.data.length) return frame;
      const out = new Float32Array(n + frame.length);
      out.set(prev.data.subarray(0, n), 0);
      out.set(frame, n);
      return out;
    }

    function remember(frame, ctxTime, sr) {
      if (!prev || prev.data.length !== frame.length) prev = { data: new Float32Array(frame.length) };
      prev.data.set(frame);
      prev.ctxTime = ctxTime;
      prev.sr = sr;
    }

    // One analyser frame. Returns the events it produced, in order.
    function process(frame, nowMs, ctxTime, sampleRate, muted) {
      const out = [];
      let sum = 0;
      for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
      const rms = Math.sqrt(sum / frame.length);
      out.push({ type: 'level', rms });

      floor += (rms - floor) * (rms < floor ? 0.3 : 0.002);
      const gate = Math.max(P.minGate, floor * P.floorMult);
      // The quietest of the last `riseLookback` hops since the last onset: a restrike after the damper
      // has pulled the old note down counts from the dip, not from the old note's level.
      let before = Infinity;
      for (let i = Math.max(0, rmsHist.length - P.riseLookback); i < rmsHist.length; i++) {
        if (rmsHist[i].t > lastOnset) before = Math.min(before, rmsHist[i].rms);
      }
      if (before === Infinity) before = 0;
      rmsHist.push({ rms, t: nowMs });
      if (rmsHist.length > 12) rmsHist.shift();

      if (muted) {
        pending = null;
        quiet = false;
        remember(frame, ctxTime, sampleRate);
        return out;
      }

      const onset = rms > gate && nowMs - lastOnset > P.retriggerMs && (quiet || rms > before * riseCur);
      if (onset) {
        // Flush: the note still being decided is emitted first if one pitch class has 2 votes.
        if (pending) {
          const { pc, count } = majorityPc(pending.votes);
          if (count >= 2) out.push(noteEvent(pending, pc, nowMs, 'flush', rms));
        }
        const at = refineOnset(withLookback(frame, ctxTime, sampleRate), sampleRate, ctxTime);
        pending = { t: nowMs, at, atMs: nowMs - (ctxTime - at) * 1000, votes: [] };
        lastOnset = nowMs;
        quiet = false;
        armed = true;
        out.push({ type: 'onset', tOnset: nowMs, at, rms });
      } else if (rms < gate * P.quietMult) {
        if (!quiet && armed) { out.push({ type: 'quiet', tOnset: nowMs }); armed = false; }
        quiet = true;
      }
      remember(frame, ctxTime, sampleRate);

      if (!pending) return out;
      const age = nowMs - pending.atMs;
      if (age > P.voteStartMs) {
        const f = detectPitch(frame, sampleRate, P.minHz, P.maxHz);
        if (f) {
          const m = freqToMidi(f);
          const r = Math.round(m);
          if (Math.abs(m - r) < P.centsTol) pending.votes.push({ m: r, raw: m });
        }
        const v = pending.votes;
        const n = P.agree;
        if (v.length >= n) {
          const pc = pcOf(v[v.length - 1].m);
          if (v.slice(-n).every((x) => pcOf(x.m) === pc)) {
            const p = pending;
            pending = null;
            out.push(noteEvent(p, pc, nowMs, 'agree', rms));
            return out;
          }
        }
      }
      if (age > P.timeoutMs) {
        const p = pending;
        pending = null;
        const { pc, count } = majorityPc(p.votes);
        if (count >= 2) out.push(noteEvent(p, pc, nowMs, 'timeout', rms));
      }
      return out;
    }

    // While repeat is true the onset rule accepts a smaller restrike rise (repeated notes).
    function expect({ repeat } = {}) { riseCur = repeat ? P.riseRepeat : P.rise; }

    function reset() {
      rmsHist.length = 0;
      floor = 0.002;
      quiet = true;
      armed = false;
      lastOnset = -Infinity;
      pending = null;
      prev = null;
      riseCur = P.rise;
    }

    return { params: P, process, expect, reset };
  }

  const api = { create, refineOnset, decide, majorityPc, DEFAULT_PARAMS };
  if (isNode) module.exports = api;
  else (root.NS = root.NS || {}).listener = api;
})(typeof window !== 'undefined' ? window : globalThis);
