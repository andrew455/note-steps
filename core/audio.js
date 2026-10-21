// Sound out (synth and piano voices, metronome click, cues, sequences, offline renders), the microphone
// and the screen wake lock. NS.audio, NS.mic, NS.wake. Load after core/ns.js, core/listener.js and
// pitch.js. Spec §2.4.3.
//
// Rules kept here so every mode gets them for free:
//   - Every tone, sequence or event batch mutes the mic until its sound ends + 250 ms + outLatency, so
//     the mic never judges our own speaker (a Bluetooth speaker adds its latency to the tail).
//   - stop() on a handle releases the mic 300 ms later (muteMicUntil(now + 300, {force:true})).
//   - Clicks and cues never touch the mute: they sit above the mic path's two 1.4 kHz low-pass stages.
//   - isBusy() is true while a tone, sequence or event batch is still sounding. Key taps on the
//     on-screen keyboard play with {busy:false}, so a tap never blocks the next tap.
//
// The timing and file helpers at the top are pure and load in Node (require('./audio.js')) for tests.
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports && typeof window === 'undefined';

  // ======================================================================
  // PURE HELPERS
  // ======================================================================
  const midiToFreqPure = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const pcOf = (m) => ((m % 12) + 12) % 12;

  const MUTE_TAIL_MS = 250;
  const STOP_RELEASE_MS = 300;

  // The perf time until which the mic stays muted for a sound that ends at endPerf.
  function muteEnd(endPerf, outLatSec = 0) { return endPerf + MUTE_TAIL_MS + outLatSec * 1000; }

  // 'piano' voice: partials 1-4 at gains 1, 0.45, 0.2, 0.08; partial h decays with tau = 1.4 s / h;
  // slight inharmonicity, f * h * (1 + 0.0004 h^2).
  const PIANO = { partials: [1, 0.45, 0.2, 0.08], tau: 1.4, inharm: 0.0004, attack: 0.008, damp: 0.035, norm: 0.6 };
  function pianoPartials(freq) {
    return PIANO.partials.map((g, i) => {
      const h = i + 1;
      return { freq: freq * h * (1 + PIANO.inharm * h * h), gain: g, tau: PIANO.tau / h };
    });
  }

  // Seconds a voice keeps sounding after its nominal end (release tail).
  const tailOf = (voice) => (voice === 'piano' ? 4 * PIANO.damp : 0.05);

  // Notation items (notes and rests) -> timed events. i counts notes only. Anything with a midi and no
  // kind:'rest' is a note (so Pitch.parseNote objects work too).
  //   -> { events:[{midi, at, dur, beat}], notes:[item], beats (total), spb }
  function sequenceEvents(items, { bpm = 90, speed = 1 } = {}) {
    const spb = 60 / (Math.max(1, bpm) * (speed > 0 ? speed : 1));
    const events = [];
    const notes = [];
    let beat = 0;
    (items || []).forEach((it) => {
      if (!it) return;
      const beats = it.beats > 0 ? it.beats : 1;
      if (it.kind !== 'rest' && Number.isFinite(it.midi)) {
        events.push({ midi: it.midi, at: beat * spb, dur: Math.max(0.25, beats * spb * 0.92), beat });
        notes.push(it);
      }
      beat += beats;
    });
    return { events, notes, beats: beat, spb };
  }

  // Tonic pitch class from a key name ('C', 'G major', 'Bb', 'F#m'), a number (midi or pc), or null.
  const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function tonicPc(key, fallbackMidi) {
    if (typeof key === 'number' && Number.isFinite(key)) return pcOf(key);
    if (typeof key === 'string') {
      const m = /^\s*([A-Ga-g])\s*([#♯b♭]?)/.exec(key);
      if (m) {
        let pc = LETTER_PC[m[1].toUpperCase()];
        if (m[2] === '#' || m[2] === '♯') pc += 1;
        if (m[2] === 'b' || m[2] === '♭') pc -= 1;
        return pcOf(pc);
      }
    }
    return fallbackMidi == null ? 0 : pcOf(fallbackMidi);
  }

  // Lays out the tracks of an offline render, one after another with gapSec between them.
  //   tracks: [{id, items, bpm = 90, octaveShift = 0, beatsPerBar = 4, pickup = 0, key?}]
  //   -> { notes:[{midi, t, dur}], drones:[{midi, t, dur}], layout:[{id, start, end, noteTimes}], duration }
  // The drone (when on) is the tonic and the fifth an octave below the track's lowest note, struck on
  // every bar's downbeat. The tonic comes from track.key, else the last note's pitch class.
  function layoutTracks(tracks, { gapSec = 1.5, drone = true, lead = 0.3, ringOut = 1.2 } = {}) {
    const notes = [];
    const drones = [];
    const layout = [];
    let cursor = lead;
    (tracks || []).forEach((tr) => {
      const shift = 12 * (tr.octaveShift || 0);
      const { events, beats, spb } = sequenceEvents(tr.items, { bpm: tr.bpm || 90 });
      const start = cursor;
      const noteTimes = [];
      events.forEach((ev) => {
        notes.push({ midi: ev.midi + shift, t: start + ev.at, dur: ev.dur });
        noteTimes.push(start + ev.at);
      });
      const end = start + beats * spb;
      if (drone && events.length) {
        const lowest = Math.min(...events.map((e) => e.midi + shift));
        const pc = tonicPc(tr.key, events[events.length - 1].midi);
        let tonic = lowest - 12;
        while (pcOf(tonic) !== pc) tonic--;
        const bpb = tr.beatsPerBar || 4;
        const barSec = bpb * spb;
        for (let b = tr.pickup || 0; b < beats - 1e-6; b += bpb) {
          const t = start + b * spb;
          const dur = Math.min(barSec, end - t) * 0.95;
          drones.push({ midi: tonic, t, dur }, { midi: tonic + 7, t, dur });
        }
      }
      layout.push({ id: tr.id, start, end, noteTimes });
      cursor = end + gapSec;
    });
    const last = layout.length ? layout[layout.length - 1].end : 0;
    return { notes, drones, layout, duration: last + ringOut };
  }

  // 16-bit PCM mono WAV. -> ArrayBuffer
  function encodeWav(samples, sampleRate) {
    const n = samples.length;
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const s = Math.max(-1, Math.min(1, samples[i] || 0));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buf;
  }

  const pure = { muteEnd, pianoPartials, sequenceEvents, tonicPc, layoutTracks, encodeWav, PIANO, MUTE_TAIL_MS, STOP_RELEASE_MS };
  if (isNode) { module.exports = pure; return; }

  // ======================================================================
  // BROWSER
  // ======================================================================
  const NS = root.NS;
  const { detectPitch, freqToMidi } = root.Pitch;
  const midiToFreq = root.Pitch.midiToFreq || midiToFreqPure;
  const quietly = (p) => { if (p && typeof p.catch === 'function') p.catch(() => {}); };

  // ---------- clocks ----------
  let ac = null; // the one AudioContext, shared by every mode
  let unlocked = false;
  function ctx() {
    if (!ac) ac = new (root.AudioContext || root.webkitAudioContext)();
    if (ac.state === 'suspended') { try { quietly(ac.resume()); } catch {} }
    return ac;
  }
  // Call synchronously inside every click / pointer handler: iOS only starts audio from a gesture.
  function resume() {
    const c = ctx();
    if (c.state !== 'running') { try { quietly(c.resume()); } catch {} }
    if (!unlocked) {
      unlocked = true;
      try { // a silent one-sample buffer unlocks output on older iOS
        const b = c.createBuffer(1, 1, c.sampleRate);
        const s = c.createBufferSource();
        s.buffer = b;
        s.connect(c.destination);
        s.start(0);
      } catch {}
    }
    return c;
  }
  // How long between the audio clock and the sound leaving the speaker.
  function outLatency() {
    const c = ctx();
    const v = c.outputLatency || c.baseLatency || 0;
    return Math.min(0.25, Math.max(0, v));
  }
  // Audio-clock time of the sound reaching your ears at page time `perfMs` (default: now).
  function heardAt(perfMs = performance.now()) {
    const c = ctx();
    const ts = c.getOutputTimestamp ? c.getOutputTimestamp() : null;
    if (ts && ts.performanceTime > 0 && ts.contextTime > 0) return ts.contextTime + (perfMs - ts.performanceTime) / 1000;
    return c.currentTime - outLatency() + (perfMs - performance.now()) / 1000;
  }
  // Plain conversions between the audio clock (seconds) and page time (performance.now() ms).
  function ctxToPerf(sec) { const c = ctx(); return performance.now() + (sec - c.currentTime) * 1000; }
  function perfToCtx(ms) { const c = ctx(); return c.currentTime + (ms - performance.now()) / 1000; }

  // ---------- mic mute (so the mic never judges our own speaker) ----------
  let manualMute = 0;
  const soundMutes = new Map(); // handle -> perf ms until which that sound mutes the mic
  function muteMicUntil(perfMs, { force = false } = {}) {
    manualMute = force ? perfMs : Math.max(manualMute, perfMs);
  }
  function micMuted(perfMs = performance.now()) {
    if (perfMs < manualMute) return true;
    for (const [h, until] of soundMutes) {
      if (until > perfMs) return true;
      if (until < performance.now()) soundMutes.delete(h);
    }
    return false;
  }

  // ---------- voices ----------
  // Schedules one note into `dest` on context `c` at ctx time t. Returns the oscillators (to stop early).
  function scheduleVoice(c, dest, midi, t, dur, gain, voice) {
    const f = midiToFreq(midi);
    const oscs = [];
    if (voice === 'piano') {
      pianoPartials(f).forEach((p) => {
        if (p.freq >= c.sampleRate / 2) return;
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = 'sine';
        o.frequency.value = p.freq;
        const peak = gain * PIANO.norm * p.gain;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(peak, t + PIANO.attack);
        g.gain.setTargetAtTime(0, t + PIANO.attack, p.tau);
        g.gain.setTargetAtTime(0, t + Math.max(PIANO.attack, dur), PIANO.damp); // key up: the damper
        o.connect(g).connect(dest);
        o.start(t);
        o.stop(t + dur + tailOf('piano') + 0.02);
        oscs.push(o);
      });
      return oscs;
    }
    const out = c.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    out.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.02, dur));
    out.connect(dest);
    [[1, 0.6, 'triangle'], [2, 0.18, 'sine'], [3, 0.06, 'sine']].forEach(([h, g, type]) => {
      const o = c.createOscillator();
      const og = c.createGain();
      o.type = type;
      o.frequency.value = f * h;
      og.gain.value = g;
      o.connect(og).connect(out);
      o.start(t);
      o.stop(t + dur + tailOf('synth'));
      oscs.push(o);
    });
    return oscs;
  }

  // ---------- handles ----------
  const active = new Set(); // sounding handles: {endPerf, busy, stop}
  function track(h, untilPerf) {
    active.add(h);
    h._t = setTimeout(() => active.delete(h), Math.max(0, untilPerf - performance.now()) + 20);
    return h;
  }
  function untrack(h) { clearTimeout(h._t); active.delete(h); }

  // A batch of notes sharing one output gain, one mute window and one stop().
  function startBatch(kind, notes, { id, gain = 0.3, voice = 'synth', muteMic = true, busy = true, dest, onNote, onEnd, payload } = {}) {
    const c = ctx();
    const lat = outLatency();
    const bus = c.createGain();
    bus.gain.value = 1;
    bus.connect(dest || c.destination);
    const oscs = [];
    let lastEnd = c.currentTime;
    notes.forEach((n) => {
      const t = Math.max(c.currentTime, n.t);
      oscs.push(...scheduleVoice(c, bus, n.midi, t, n.dur, n.gain != null ? n.gain : gain, voice));
      lastEnd = Math.max(lastEnd, t + n.dur + (voice === 'piano' ? tailOf('piano') : 0));
    });
    const endPerf = ctxToPerf(lastEnd);
    const timers = [];
    let finished = false;
    let resolveDone;
    const done = new Promise((r) => (resolveDone = r));
    const h = { id, kind, endPerf, done, busy };
    if (muteMic) soundMutes.set(h, muteEnd(endPerf, lat));
    if (busy) NS.bus.emit('audio:play-start', { kind, id });

    if (onNote || kind !== 'tone') {
      notes.forEach((n, i) => {
        const tPerf = ctxToPerf(Math.max(c.currentTime, n.t)) + lat * 1000;
        timers.push(setTimeout(() => {
          if (finished) return;
          const note = payload ? payload[i] : n;
          if (kind !== 'tone') NS.bus.emit('seq:note', { seqId: id, i, note, tPerf });
          if (onNote) onNote(i, note, tPerf);
        }, Math.max(0, tPerf - performance.now())));
      });
    }
    function end(reason) {
      if (finished) return;
      finished = true;
      timers.forEach(clearTimeout);
      untrack(h);
      if (busy) NS.bus.emit('audio:play-end', { kind, id, reason });
      if (onEnd) { try { onEnd(reason); } catch (err) { console.error('[NS.audio] onEnd failed', err); } }
      resolveDone(reason);
    }
    timers.push(setTimeout(() => end('ended'), Math.max(0, endPerf + lat * 1000 - performance.now())));
    h.stop = () => {
      if (finished) return;
      const now = c.currentTime;
      try {
        bus.gain.cancelScheduledValues(now);
        bus.gain.setValueAtTime(bus.gain.value, now);
        bus.gain.setTargetAtTime(0, now, 0.008);
      } catch {}
      oscs.forEach((o) => { try { o.stop(now + 0.06); } catch {} });
      setTimeout(() => { try { bus.disconnect(); } catch {} }, 120);
      if (soundMutes.delete(h) || muteMic) muteMicUntil(performance.now() + STOP_RELEASE_MS, { force: true });
      end('stopped');
    };
    return track(h, endPerf + lat * 1000);
  }

  // One note. {busy:false} for key taps (they must not block input). -> {stop(), endPerf, done}
  function playTone(midi, dur = 1.2, delay = 0, { gain = 0.3, muteMic = true, voice = 'synth', dest, busy = true } = {}) {
    const c = ctx();
    return startBatch('tone', [{ midi, t: c.currentTime + Math.max(0, delay), dur }], { gain, muteMic, voice, dest, busy });
  }

  // Timed notes. events: [{midi, at (sec from start), dur, gain?}].
  function playEvents(events, { startDelay = 0.12, id, gain, voice = 'synth', muteMic = true, onNote, onEnd } = {}) {
    const c = ctx();
    const t0 = c.currentTime + Math.max(0, startDelay);
    const list = (events || []).filter((e) => e && Number.isFinite(e.midi));
    const notes = list.map((e) => ({ midi: e.midi, t: t0 + (e.at || 0), dur: Math.max(0.05, e.dur || 0.4), gain: e.gain }));
    return startBatch('events', notes, { id, gain: gain == null ? 0.3 : gain, voice, muteMic, onNote, onEnd, payload: list });
  }

  // Notation items (notes and rests) at a tempo. i counts notes only; dur per note = max(0.25,
  // beats * spb * 0.92). onNote(i, note, tPerf) fires when the note reaches your ears.
  function playSequence(items, { bpm = 90, speed = 1, startDelay = 0.25, id, gain, voice = 'synth', muteMic = true, onNote, onEnd } = {}) {
    const c = ctx();
    const t0 = c.currentTime + Math.max(0, startDelay);
    const { events, notes } = sequenceEvents(items, { bpm, speed });
    const sched = events.map((e) => ({ midi: e.midi, t: t0 + e.at, dur: e.dur }));
    return startBatch('sequence', sched, { id, gain: gain == null ? 0.3 : gain, voice, muteMic, onNote, onEnd, payload: notes });
  }

  // Metronome click at audio-clock time t: a short high pip. The mic path low-passes below 1.4 kHz,
  // so clicks aren't heard as notes. Returns the oscillator so a caller can cancel it with .stop().
  function click(t, accent, freq) {
    const c = ctx();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.value = freq || (accent ? 4200 : 3300);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(accent ? 0.45 : 0.28, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + 0.06);
    return o;
  }

  // Short high feedback pips (40-80 ms, 2.6-4.4 kHz, gain <= 0.08): above the mic's low-pass, so they
  // never mute the mic and are never busy.
  const CUES = {
    bead: [[3520, 0.06, 0]],
    good: [[2640, 0.045, 0], [3520, 0.06, 0.05]],
    done: [[3300, 0.05, 0], [4400, 0.08, 0.06]],
    bad: [[2600, 0.07, 0]],
    tick: [[3960, 0.04, 0]],
  };
  function cue(kind) {
    const spec = CUES[kind];
    if (!spec) return;
    const c = ctx();
    spec.forEach(([freq, len, off]) => {
      const t = c.currentTime + 0.01 + off;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.08, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g).connect(c.destination);
      o.start(t);
      o.stop(t + len + 0.02);
    });
  }

  // Offline render of tracks to a 16-bit mono WAV (OfflineAudioContext). See layoutTracks().
  //   -> Promise<{blob, duration, layout:[{id, start, end, noteTimes}]}>
  function render(tracks, { gapSec = 1.5, voice = 'piano', drone = true, sampleRate = 16000, gain = 0.3 } = {}) {
    const plan = layoutTracks(tracks, { gapSec, drone });
    const Offline = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    if (!Offline) return Promise.reject(new Error('OfflineAudioContext is not available'));
    let sr = sampleRate;
    let oc;
    const make = (rate) => new Offline(1, Math.max(1, Math.ceil(plan.duration * rate)), rate);
    try { oc = make(sr); } catch { sr = 22050; oc = make(sr); } // older Safari needs >= 22050
    plan.notes.forEach((n) => scheduleVoice(oc, oc.destination, n.midi, n.t, n.dur, gain, voice));
    plan.drones.forEach((n) => scheduleVoice(oc, oc.destination, n.midi, n.t, n.dur, 0.08, voice));
    const rendered = new Promise((resolve, reject) => {
      oc.oncomplete = (e) => resolve(e.renderedBuffer);
      try {
        const p = oc.startRendering();
        if (p && typeof p.then === 'function') p.then(resolve, reject);
      } catch (err) { reject(err); }
    });
    return rendered.then((buffer) => ({
      blob: new Blob([encodeWav(buffer.getChannelData(0), buffer.sampleRate)], { type: 'audio/wav' }),
      duration: buffer.duration,
      layout: plan.layout,
    }));
  }

  // iOS 16.4+/17: tell the OS whether we record too (keeps the speaker loud with the mic on).
  function setSessionType(type) {
    try {
      const s = navigator.audioSession;
      if (s && 'type' in s) s.type = type;
    } catch {}
  }

  function stopAll() { [...active].forEach((h) => { try { h.stop(); } catch {} }); }
  function isBusy() {
    const now = performance.now();
    const lat = ac ? outLatency() * 1000 : 0;
    for (const h of active) if (h.busy && h.endPerf + lat > now) return true;
    return false;
  }

  NS.audio = {
    ctx, resume, outLatency, heardAt, ctxToPerf, perfToCtx,
    playTone, playSequence, playEvents, click, cue, render, setSessionType,
    stopAll, isBusy, muteMicUntil, micMuted,
    sequenceEvents, // pure: items -> timed events (same timing as playSequence)
  };

  // A suspended or interrupted context (iOS phone call, tab switch) is resumed when the page is back.
  NS.bus.on('visibility', ({ hidden }) => {
    if (!hidden && ac && ac.state !== 'running' && ac.state !== 'closed') { try { quietly(ac.resume()); } catch {} }
  });

  // ======================================================================
  // WAKE LOCK (ref-counted; re-acquired when the page is visible again)
  // ======================================================================
  const holders = new Set();
  let wakeLock = null;
  let acquiring = null;
  function acquire() {
    if (wakeLock || !holders.size || !navigator.wakeLock) return Promise.resolve();
    if (document.visibilityState === 'hidden') return Promise.resolve();
    if (!acquiring) {
      acquiring = navigator.wakeLock.request('screen').then((lock) => {
        wakeLock = lock;
        lock.addEventListener?.('release', () => { if (wakeLock === lock) wakeLock = null; });
        if (!holders.size) { try { lock.release(); } catch {} wakeLock = null; }
      }, () => { wakeLock = null; }).finally(() => { acquiring = null; });
    }
    return acquiring;
  }
  NS.wake = {
    hold(reason = 'default') { holders.add(reason); return acquire(); },
    release(reason = 'default') {
      holders.delete(reason);
      if (!holders.size && wakeLock) { try { quietly(wakeLock.release()); } catch {} wakeLock = null; }
    },
  };
  NS.bus.on('visibility', ({ hidden }) => { if (!hidden) { wakeLock = null; acquire(); } });

  // ======================================================================
  // MICROPHONE
  // Every confirmed note goes to NS.input.emit({..., source:'mic'}). Bus: 'mic:state' {on, reason?,
  // message?}, 'mic:level' {rms}, 'mic:onset' {at, tOnset, rms}, 'mic:quiet' {tOnset}.
  // ======================================================================
  const micBus = NS.emitter();
  let listening = false;
  let analyser = null;
  let micSource = null;
  let buf = null;
  let stream = null;
  let timer = null;
  let hopMs = 25;
  let micStarting = null;
  let level = 0;
  let boostNode = null;
  const BOOST_KEY = 'note-steps-mic-boost';
  let boost = 4;
  try { const b = parseFloat(localStorage.getItem(BOOST_KEY)); if (b > 0) boost = b; } catch {}
  const listener = NS.listener.create({ detectPitch, freqToMidi });

  const MSG = {
    unsupported: 'This browser can’t use the microphone here. The page needs to be opened from a secure https:// link. You can still tap the on-screen keys.',
    denied: 'Microphone access was blocked. Allow the microphone for this site in your browser settings, then try again. You can still tap the on-screen keys.',
    error: (m) => 'Couldn’t start the microphone (' + m + '). You can still tap the on-screen keys.',
    ended: 'The microphone stopped. Tap Start listening to turn it back on.',
  };

  function setState(on, extra) {
    const payload = Object.assign({ on }, extra || {});
    NS.bus.emit('mic:state', payload);
    micBus.emit('state', payload);
  }

  // Resolves {ok:true} once listening. Calls made while the permission prompt is open share one request.
  function start() {
    if (listening) return Promise.resolve({ ok: true });
    if (!micStarting) micStarting = openMic().finally(() => { micStarting = null; });
    return micStarting;
  }

  async function openMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const r = { ok: false, reason: 'unsupported', message: MSG.unsupported };
      setState(false, r);
      return r;
    }
    try {
      const c = ctx();
      setSessionType('play-and-record');
      stream = await navigator.mediaDevices.getUserMedia({
        // Auto gain on: phone mics are very quiet with it off, and a piano a metre away barely registers.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
      });
      micSource = c.createMediaStreamSource(stream);
      // Two low-pass stages: piano notes pass, the metronome's high clicks don't.
      const lp1 = c.createBiquadFilter();
      const lp2 = c.createBiquadFilter();
      [lp1, lp2].forEach((f) => { f.type = 'lowpass'; f.frequency.value = 1400; f.Q.value = 0.707; });
      // Extra boost on top (the Sensitivity setting). Pitch detection doesn't mind the level, but the
      // note gate does, so quiet phones need it.
      boostNode = c.createGain();
      boostNode.gain.value = boost;
      analyser = c.createAnalyser();
      analyser.fftSize = 2048;
      micSource.connect(lp1).connect(lp2).connect(boostNode).connect(analyser);
      buf = new Float32Array(analyser.fftSize);
      const s = stream;
      stream.getAudioTracks().forEach((t) => t.addEventListener('ended', () => {
        if (stream === s && listening) { stop(); setState(false, { reason: 'error', message: MSG.ended }); }
      }));
      listener.reset();
      listening = true;
      setState(true);
      NS.wake.hold('mic');
      clearInterval(timer);
      timer = setInterval(tick, hopMs);
      return { ok: true };
    } catch (err) {
      const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      const r = denied
        ? { ok: false, reason: 'denied', message: MSG.denied }
        : { ok: false, reason: 'error', message: MSG.error(err && err.message ? err.message : err) };
      setState(false, r);
      return r;
    }
  }

  function stop() {
    const was = listening;
    listening = false;
    clearInterval(timer);
    timer = null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    if (micSource) { try { micSource.disconnect(); } catch {} }
    micSource = null;
    level = 0;
    listener.reset();
    NS.wake.release('mic');
    if (was) setState(false, { reason: 'stopped' });
  }

  function tick() {
    if (!listening || !analyser) return;
    analyser.getFloatTimeDomainData(buf);
    const now = performance.now();
    const events = listener.process(buf, now, analyser.context.currentTime, analyser.context.sampleRate, micMuted(now));
    for (const ev of events) {
      if (ev.type === 'level') {
        level = ev.rms;
        NS.bus.emit('mic:level', { rms: ev.rms });
        micBus.emit('level', ev);
      } else if (ev.type === 'onset') {
        NS.bus.emit('mic:onset', { at: ev.at, tOnset: ev.tOnset, rms: ev.rms });
        micBus.emit('onset', ev);
      } else if (ev.type === 'quiet') {
        NS.bus.emit('mic:quiet', { tOnset: ev.tOnset });
        micBus.emit('quiet', ev);
      } else if (ev.type === 'note') {
        micBus.emit('note', ev);
        NS.input.emit({
          midi: ev.midi, at: ev.at, tOnset: ev.tOnset, source: 'mic',
          confident: ev.confident, reason: ev.reason, rms: ev.rms, cents: ev.cents,
        });
      }
    }
  }

  NS.mic = {
    start,
    stop,
    isOn: () => listening,
    level: () => level,
    on: (evt, fn) => micBus.on(evt, fn),
    expect: (o) => listener.expect(o),
    setHopMs(ms = 25) {
      hopMs = Math.max(10, ms);
      if (listening) { clearInterval(timer); timer = setInterval(tick, hopMs); }
    },
    // Not in the §2.4.3 contract: the raw nodes, for detectors that attach to the mic (chords.js).
    source: () => micSource,
    boost: () => boost,
    setBoost(x) {
      boost = x;
      if (boostNode) boostNode.gain.value = x;
      try { localStorage.setItem(BOOST_KEY, String(x)); } catch {}
      NS.bus.emit('mic:boost', { boost: x });
    },
    analyser: () => analyser,
  };
})(typeof window !== 'undefined' ? window : globalThis);
