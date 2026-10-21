// USB keyboards (Web MIDI). A key press becomes the same NS.input event a mic note does (source 'midi'),
// with an exact onset time, and three keys pressed together as C, C minor or G major become a chord
// command ('midi:chord' on NS.bus, which chords.js passes on to every chord listener).
// Web MIDI works in Chrome/Edge on Android and desktop; no iPhone browser has it.
(function (root) {
  const NS = root.NS;
  const KEY = 'note-steps-midi';
  const CHORD_PCS = { C: [0, 4, 7], Cm: [0, 3, 7], G: [7, 11, 2] };
  const CHORD_WINDOW_MS = 400; // a chord's keys go down within this time

  let access = null;
  let on = false;
  let names = [];
  const held = new Map(); // midi -> perf ms it went down
  let chordFired = false;

  const supported = () => typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';

  function audioAt(stampMs) {
    try {
      const c = NS.audio.ctx();
      return c.currentTime - Math.max(0, performance.now() - stampMs) / 1000;
    } catch { return stampMs / 1000; }
  }

  function onMessage(e) {
    const [status, note, vel] = e.data;
    const cmd = status & 0xf0;
    const stamp = e.timeStamp || performance.now();
    if (cmd === 0x90 && vel > 0) {
      held.set(note, stamp);
      const at = audioAt(stamp);
      NS.bus.emit('mic:onset', { at, tOnset: stamp, rms: vel / 127 });
      NS.input.emit({ midi: note, at, tOnset: stamp, source: 'midi', confident: true, reason: 'midi', rms: vel / 127, cents: 0 });
      checkChord(stamp);
    } else if (cmd === 0x80 || (cmd === 0x90 && vel === 0)) {
      held.delete(note);
      // The next chord can come once the hand has let go of most of this one.
      if (held.size < 2) chordFired = false;
    }
  }

  const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  // Command ids used by the app; any other major or minor triad is still named in a message.
  const ROOT_IDS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

  // Which triad do these pitch classes make (any inversion, notes doubled in other octaves)?
  function triadOf(pcs) {
    if (pcs.length !== 3) return null;
    for (const r of pcs) {
      const has = (i) => pcs.includes((r + i) % 12);
      if (has(7) && has(4)) return { root: r, quality: 'maj' };
      if (has(7) && has(3)) return { root: r, quality: 'min' };
    }
    return null;
  }

  function checkChord(now) {
    // Forget keys that have been "held" for ages (a lost key-up must not block chords for good).
    for (const [m, t] of held) if (now - t > 15000) held.delete(m);
    if (chordFired) return;
    const recent = [...held].filter(([, t]) => now - t <= CHORD_WINDOW_MS).map(([m]) => ((m % 12) + 12) % 12);
    const pcs = [...new Set(recent)];
    const tri = triadOf(pcs);
    if (!tri) return;
    chordFired = true;
    const id = ROOT_IDS[tri.root] + (tri.quality === 'min' ? 'm' : '');
    const label = `${NAMES[tri.root]} ${tri.quality === 'maj' ? 'major' : 'minor'}`;
    // Is it one of the chords the app is using right now?
    let cur = null;
    try { cur = NS.chordset.current(); } catch {}
    const used = cur ? [cur.next, cur.again, cur.back].includes(id) : false;
    NS.bus.emit('midi:chordname', { label, id, used });
    NS.bus.emit('midi:chord', { name: id });
  }

  function wire() {
    names = [];
    access.inputs.forEach((input) => {
      input.onmidimessage = onMessage;
      names.push(input.name || 'USB keyboard');
    });
    on = names.length > 0;
    // Keep the screen on and bright while a keyboard is plugged in (no dimming, no auto-lock).
    if (on) NS.wake.hold('midi'); else NS.wake.release('midi');
    NS.bus.emit('midi:state', { on, names: names.slice() });
  }

  async function connect() {
    if (!supported()) {
      const r = { ok: false, reason: 'unsupported' };
      NS.bus.emit('midi:state', Object.assign({ on: false }, r));
      return r;
    }
    try {
      access = access || await navigator.requestMIDIAccess();
      access.onstatechange = wire;
      wire();
      try { localStorage.setItem(KEY, '1'); } catch {}
      return { ok: on, reason: on ? null : 'none' };
    } catch (err) {
      const r = { ok: false, reason: 'denied' };
      NS.bus.emit('midi:state', Object.assign({ on: false }, r));
      return r;
    }
  }

  function disconnect() {
    if (access) access.inputs.forEach((i) => { i.onmidimessage = null; });
    held.clear();
    on = false;
    NS.wake.release('midi');
    try { localStorage.removeItem(KEY); } catch {}
    NS.bus.emit('midi:state', { on: false, names: [] });
  }

  document.addEventListener('pointerdown', () => { if (on) NS.wake.hold('midi'); }, { passive: true });

  NS.midi = {
    supported,
    connect,
    disconnect,
    isOn: () => on,
    heldCount: () => held.size,
    names: () => names.slice(),
  };

  // Reconnect automatically when it was used before (Chrome remembers the permission).
  let wanted = false;
  try { wanted = localStorage.getItem(KEY) === '1'; } catch {}
  if (wanted && supported()) setTimeout(connect, 0);
})(typeof window !== 'undefined' ? window : globalThis);
