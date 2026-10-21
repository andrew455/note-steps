// Free Play mode (#/free): a sandbox. Every note you play (mic or on-screen keys) appears on a live
// scrolling staff, with its name, where it sits and the shape from the last note. Play back, Clear
// with Undo, an optional timed mode, and "I know that tune!". Free Play never records mastery.
// Spec §3.6. Pure logic and the live staff are in modes/freeplay-core.js (NS.FreeCore).
(function (root) {
  const NS = root.NS;
  const FC = NS.FreeCore;

  const DEFAULTS = { labels: 'on', rhythm: 'even', bpm: 'auto', octave: 'heard', shapes: true, spelling: null, found: {} };
  const QUIZ_MS = 1500;
  const UNDO_MS = 4000;
  const KB_LOW = 60; // C4
  const KB_HIGH = 79; // G5

  // Chip values and their wording.
  const CHIPS = [
    { key: 'labels', name: 'Names', values: ['on', 'quiz', 'off'], text: (v) => v },
    { key: 'rhythm', name: 'Rhythm', values: ['even', 'timed'], text: (v) => v },
    { key: 'bpm', name: 'Tempo', values: ['auto', 60, 80, 100, 120], text: (v) => String(v) },
    { key: 'octave', name: 'Octave', values: ['heard', 'fold'], text: (v) => (v === 'fold' ? 'keep on staff' : 'as heard') },
    { key: 'shapes', name: 'Shapes', values: [true, false], text: (v) => (v ? 'on' : 'off') },
    { key: 'spelling', name: 'Spelling', values: ['sharp', 'flat'], text: (v) => (v === 'flat' ? 'flats' : 'sharps') },
  ];

  const ICON = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M9 17.5a3 3 0 1 1-2-2.83V4.5l11-2v12a3 3 0 1 1-2-2.83V6.9l-7 1.27z"/><path fill="currentColor" d="M20.5 18.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/></svg>';

  const TEMPLATE = `
  <div class="topbar">
    <button class="back" data-ref="back" aria-label="Back">←</button>
    <div class="title">
      <span class="eyebrow">Explore</span>
      <h2>Free play</h2>
    </div>
    <span class="count" data-ref="count" aria-live="off">0 notes</span>
  </div>

  <div class="staff-card fp-card">
    <svg class="fp-staff" data-ref="staff" role="img" aria-label="Music staff showing the notes you play"></svg>
    <p class="fp-status" data-ref="status"><span class="fp-beat" data-ref="beat" aria-hidden="true" hidden></span><span data-ref="statusText"></span></p>
  </div>

  <div data-ref="fbSlot"></div>

  <div class="fp-song" data-ref="song" role="status" aria-live="polite" hidden>
    <span class="fp-song-text" data-ref="songText"></span>
    <button class="btn small primary" data-ref="practise" hidden>Practise it</button>
  </div>

  <div data-ref="micSlot"></div>
  <p class="notice" data-mic-notice hidden></p>

  <div class="controls">
    <button class="btn" data-ref="play">▶ Play back</button>
    <button class="btn" data-ref="clear">Clear</button>
  </div>

  <div class="fp-chips" data-ref="chips" role="group" aria-label="Free play settings"></div>

  <p class="muted fp-found" data-ref="found"></p>

  <div>
    <div class="keyboard" data-ref="keyboard" aria-label="On-screen keyboard. Tap a key to play it."></div>
    <p class="muted fp-kb-note">The blue key shows the note your phone heard. You can also tap these keys.</p>
  </div>`;

  // ---------- state (one mounted screen at a time) ----------
  let ui = null;
  let ctxRef = null;
  let set = null; // settings (the slices.free object, merged with defaults)
  let staff = null; // FC.createLiveStaff
  let rec = null; // FC.createRecognizer
  let kb = null;
  let micBar = null;
  let fb = null;
  let undoBtn = null;
  let offs = [];
  let timers = {};
  let playback = null; // NS.audio.playEvents handle
  let undo = null; // {entries, rec, total}
  let total = 0; // notes since Clear
  let lastFeedback = null; // {big, small}
  let songTarget = null; // song id for Practise it
  let mounted = false;

  const prefer = () => set.spelling || NS.store.settings().spelling || 'sharp';
  const clearTimer = (k) => { clearTimeout(timers[k]); clearInterval(timers[k]); delete timers[k]; };

  function loadSettings(ctx) {
    let saved = {};
    try { saved = (ctx.store && ctx.store.get()) || {}; } catch { saved = {}; }
    const s = Object.assign({}, DEFAULTS, saved);
    s.found = Object.assign({}, saved.found || {});
    return s;
  }
  function saveSettings() {
    if (!ctxRef || !ctxRef.store) return;
    const out = {};
    Object.keys(DEFAULTS).forEach((k) => { out[k] = set[k]; });
    try { ctxRef.store.update((cur) => Object.assign(cur || {}, out)); } catch { try { ctxRef.store.set(out); } catch {} }
    try { NS.store.save(); } catch {}
  }

  function songList() {
    try { if (NS.songs && NS.songs.all) return NS.songs.all(); } catch { /* fall through */ }
    return (root.NoteSongs && root.NoteSongs.songs) || [];
  }

  // ======================================================================
  // MOUNT
  // ======================================================================
  function mount(rootEl, params, ctx) {
    ctxRef = ctx;
    set = loadSettings(ctx);
    total = 0;
    undo = null;
    playback = null;
    songTarget = null;
    lastFeedback = null;
    rootEl.classList.add('fp');
    rootEl.innerHTML = TEMPLATE;
    ui = {};
    rootEl.querySelectorAll('[data-ref]').forEach((e) => (ui[e.dataset.ref] = e));
    if (ctx.setTitle) ctx.setTitle('Free play');

    fb = NS.ui.feedback(ui.fbSlot);
    ui.fbSlot.replaceWith(fb.el);
    fb.el.classList.add('fp-feedback');
    undoBtn = document.createElement('button');
    undoBtn.className = 'btn small fp-undo';
    undoBtn.textContent = 'Undo';
    undoBtn.hidden = true;
    undoBtn.addEventListener('click', doUndo);
    fb.el.appendChild(undoBtn);

    micBar = NS.ui.micBar(ui.micSlot);
    ui.micSlot.replaceWith(micBar.el);

    staff = FC.createLiveStaff(ui.staff, Object.assign(staffOpts(), { onTapNote: tapNote }));
    rec = FC.createRecognizer(FC.buildIndex(songList()), { prefer: prefer() });
    kb = NS.keyboard.create(ui.keyboard, { low: KB_LOW, high: KB_HIGH, labels: keyLabels(), tapDur: 0.4, onPress: onKeyPress });

    ui.back.addEventListener('click', () => ctx.back ? ctx.back() : ctx.go('#/'));
    ui.play.addEventListener('click', togglePlayback);
    ui.clear.addEventListener('click', doClear);
    ui.practise.addEventListener('click', () => { if (songTarget) ctx.go(`#/practice/${encodeURIComponent(songTarget)}`); });

    buildChips();
    offs = [
      NS.input.on(onInput),
      NS.mic.on('quiet', (ev) => { if (staff) staff.noteOff(ev.tOnset); }),
      NS.bus.on('resize', () => staff && staff.render({ instant: true })),
      NS.bus.on('theme', () => staff && staff.render({ instant: true })),
      NS.bus.on('mic:state', () => updateStatus()),
    ];
    mounted = true;
    setFeedback('Play anything', 'Every note you play shows up on the staff.');
    updateCount();
    updateFound();
    updateStatus();
    updateBeatTimer();
  }

  function unmount() {
    mounted = false;
    offs.forEach((off) => { try { off(); } catch {} });
    offs = [];
    Object.keys(timers).forEach(clearTimer);
    if (playback) { try { playback.stop(); } catch {} }
    playback = null;
    if (staff) staff.destroy();
    if (kb) kb.destroy();
    if (micBar) micBar.destroy();
    staff = null;
    kb = null;
    micBar = null;
    rec = null;
    fb = null;
    undoBtn = null;
    ui = null;
    ctxRef = null;
  }

  const staffOpts = () => ({
    labels: set.labels, prefer: prefer(), octave: set.octave, shapes: Boolean(set.shapes), rhythm: set.rhythm, bpm: set.bpm,
  });
  const keyLabels = () => (set.labels === 'on' && NS.store.settings().keyLabels !== false ? 'all' : 'none');

  // ======================================================================
  // INPUT
  // ======================================================================
  function onInput(ev) {
    if (!mounted) return;
    if (playback) return; // the mic is ignored while we play back; a key tap stops it (onKeyPress)
    if (ev.source === 'mic' && NS.audio.isBusy()) return;
    addNote(ev);
  }

  function onKeyPress() {
    if (playback) stopPlayback();
  }

  function addNote(ev) {
    const prev = staff.last();
    const e = staff.push(ev.midi, { at: ev.at, tOnset: ev.tOnset, source: ev.source });
    total += 1;
    hideUndo();
    kb.setHeard(ev.midi);
    updateCount();
    const idx = staff.count() - 1;
    const d = FC.describe(e.place, prev ? prev.place : null);
    clearTimer('quiz');
    if (set.labels === 'quiz') {
      setFeedback('?', 'Say the name out loud before it appears.');
      timers.quiz = setTimeout(() => {
        delete timers.quiz;
        if (!staff) return;
        staff.reveal(idx);
        setFeedback(d.big, d.small);
      }, QUIZ_MS);
    } else {
      setFeedback(d.big, d.small);
    }
    handleTune(rec.push(ev.midi));
    if (set.rhythm === 'timed') { updateChipLabels(); updateStatus(); }
  }

  // A tap on a note on the staff plays it (true octave) and shows its name for 2 s.
  function tapNote(entry, i) {
    if (!entry) return;
    NS.audio.resume();
    NS.audio.playTone(entry.midi, 0.8);
    staff.showLabel(i, 2000);
  }

  // ======================================================================
  // "I KNOW THAT TUNE!"
  // ======================================================================
  function showSong(text, id) {
    ui.song.hidden = false;
    ui.songText.textContent = text;
    songTarget = id || null;
    ui.practise.hidden = !id;
  }
  function hideSong() {
    ui.song.hidden = true;
    ui.songText.textContent = '';
    songTarget = null;
    ui.practise.hidden = true;
  }

  function handleTune(events) {
    events.forEach((ev) => {
      if (ev.type === 'hint') showSong(ev.text, null);
      else if (ev.type === 'found') { showSong(ev.text, ev.id); try { NS.audio.cue('good'); } catch {} }
      else if (ev.type === 'progress') showSong(ev.text, ev.id);
      else if (ev.type === 'lost') hideSong();
      else if (ev.type === 'complete') {
        set.found[ev.id] = (set.found[ev.id] || 0) + 1;
        saveSettings();
        updateFound();
        clearTimer('quiz');
        setFeedback(ev.text, ev.small);
        showSong(ev.text, ev.id);
        try { NS.audio.cue('done'); } catch {}
      } else if (ev.type === 'scale') {
        if (!rec.following()) showSong(ev.text, null);
      }
    });
  }

  // ======================================================================
  // PLAY BACK
  // ======================================================================
  function togglePlayback() {
    NS.audio.resume();
    if (playback) { stopPlayback(); return; }
    const all = staff.entries();
    if (!all.length) {
      setFeedback('Nothing to play yet', 'Play a few notes first, then play them back.');
      return;
    }
    const list = all.slice(-FC.PLAY_MAX);
    const base = all.length - list.length;
    const events = FC.playbackEvents(list, { rhythm: set.rhythm, beatMs: staff.beatMs(), now: performance.now() });
    clearTimer('quiz');
    playback = NS.audio.playEvents(events, {
      id: 'free-playback',
      onNote: (i, ev) => {
        if (!staff) return;
        staff.setPlaying(base + i);
        kb.setPlaying(NS.notation.foldToRange(ev.midi, KB_LOW, KB_HIGH));
      },
      onEnd: () => endPlayback(),
    });
    ui.play.textContent = '■ Stop';
    ui.play.classList.add('on');
    setFeedback('Playing back…', `Your last ${list.length} note${list.length === 1 ? '' : 's'}. The mic is paused while it plays.`);
    updateStatus();
  }

  function stopPlayback() {
    if (playback) { try { playback.stop(); } catch {} }
    endPlayback();
  }

  function endPlayback() {
    if (!playback && ui && ui.play.textContent === '▶ Play back') return;
    playback = null;
    if (!ui) return;
    if (staff) staff.setPlaying(null);
    if (kb) kb.setPlaying(null);
    ui.play.textContent = '▶ Play back';
    ui.play.classList.remove('on');
    setFeedback('Your turn', 'Play anything. Every note shows up on the staff.');
    updateStatus();
  }

  // ======================================================================
  // CLEAR + UNDO
  // ======================================================================
  function doClear() {
    if (playback) stopPlayback();
    clearTimer('quiz');
    const snap = { rec: rec.state(), total };
    snap.entries = staff.clear();
    rec.clear();
    total = 0;
    hideSong();
    updateCount();
    setFeedback('Cleared', 'Play anything to start again.');
    if (snap.entries.length) {
      undo = snap;
      undoBtn.hidden = false;
      clearTimer('undo');
      timers.undo = setTimeout(hideUndo, UNDO_MS);
    }
  }

  function doUndo() {
    if (!undo) return;
    const u = undo;
    hideUndo();
    staff.restore(u.entries);
    rec.setState(u.rec);
    total = u.total;
    updateCount();
    const list = staff.entries();
    const last = list[list.length - 1];
    const prev = list[list.length - 2];
    if (last) {
      const d = FC.describe(last.place, prev ? prev.place : null);
      setFeedback(d.big, d.small);
    }
    const f = rec.following();
    if (f) showSong(`${f.song.title} · ${f.pos} of ${f.song.notes.length} notes`, f.id);
  }

  function hideUndo() {
    undo = null;
    clearTimer('undo');
    if (undoBtn) undoBtn.hidden = true;
  }

  // ======================================================================
  // CHIPS
  // ======================================================================
  function chipValue(c) {
    if (c.key === 'spelling') return prefer();
    return set[c.key];
  }
  function chipLabel(c) {
    const v = chipValue(c);
    if (c.key === 'bpm' && v === 'auto') {
      const n = staff ? staff.count() : 0;
      return n >= 3 ? `Tempo: auto (≈${Math.round(60000 / staff.beatMs())})` : 'Tempo: auto';
    }
    return `${c.name}: ${c.text(v)}`;
  }

  function buildChips() {
    ui.chips.innerHTML = '';
    CHIPS.forEach((c) => {
      const b = document.createElement('button');
      b.className = 'btn small chip fp-chip';
      b.dataset.chip = c.key;
      b.addEventListener('click', () => cycle(c));
      ui.chips.appendChild(b);
    });
    updateChipLabels();
  }

  function updateChipLabels() {
    if (!ui) return;
    CHIPS.forEach((c) => {
      const b = ui.chips.querySelector(`[data-chip="${c.key}"]`);
      if (!b) return;
      const label = chipLabel(c);
      b.textContent = label;
      b.setAttribute('aria-label', `${label}. Tap to change.`);
      b.classList.toggle('on', chipValue(c) !== c.values[0]);
      if (c.key === 'bpm') b.hidden = set.rhythm !== 'timed';
    });
  }

  function cycle(c) {
    const cur = chipValue(c);
    const i = c.values.indexOf(cur);
    const next = c.values[(i + 1) % c.values.length];
    set[c.key] = next;
    saveSettings();
    if (c.key === 'spelling') rec.setPrefer(next);
    staff.setOptions(staffOpts());
    if (c.key === 'labels') {
      kb.setLabels(keyLabels());
      clearTimer('quiz');
      const last = staff.last();
      if (last) {
        const list = staff.entries();
        const prev = list[list.length - 2];
        const d = FC.describe(last.place, prev ? prev.place : null);
        setFeedback(d.big, d.small);
      }
      if (next === 'quiz' && !last) setFeedback('Play anything', 'Say each note’s name out loud before it appears.');
    } else if (c.key === 'spelling' || c.key === 'octave') {
      const list = staff.entries();
      const last = list[list.length - 1];
      if (last) {
        const d = FC.describe(last.place, list.length > 1 ? list[list.length - 2].place : null);
        if (set.labels !== 'quiz' || last.revealed) setFeedback(d.big, d.small);
      }
    }
    updateChipLabels();
    updateStatus();
    updateBeatTimer();
  }

  // ======================================================================
  // SMALL UI BITS
  // ======================================================================
  function setFeedback(big, small) {
    lastFeedback = { big, small };
    if (fb) fb.set('neutral', big, small);
  }

  function updateCount() {
    if (!ui) return;
    ui.count.textContent = `${total} note${total === 1 ? '' : 's'}`;
  }

  function updateFound() {
    if (!ui) return;
    const n = Object.keys(set.found || {}).filter((k) => set.found[k] > 0).length;
    ui.found.textContent = n
      ? `Tunes you’ve found by ear: ${n}`
      : 'Tunes you’ve found by ear: 0. Play a tune you know from memory and see if the app spots it.';
  }

  function updateStatus() {
    if (!ui) return;
    let text;
    if (playback) text = 'Playing back. Tap a key to stop.';
    else if (set.rhythm === 'timed') {
      const bpm = Math.round(60000 / staff.beatMs());
      text = `Timed · 4/4 · ${set.bpm === 'auto' ? '≈' : ''}${bpm} beats a minute`;
    } else if (!NS.mic.isOn() && !(NS.midi && NS.midi.isOn())) text = 'Connect your USB keyboard, or tap the keys below.';
    else text = staff && staff.count() ? 'Newest note on the right. Tap a note to hear it.' : 'Listening…';
    ui.statusText.textContent = text;
    ui.beat.hidden = set.rhythm !== 'timed' || Boolean(playback);
  }

  // Timed mode: a blinking dot on the beat. There's no audio metronome, because a click would mute the mic.
  function updateBeatTimer() {
    clearTimer('beat');
    if (!ui || set.rhythm !== 'timed') return;
    timers.beat = setInterval(() => {
      if (!ui || !staff) return;
      const beat = staff.beatMs();
      const last = staff.last();
      const t0 = last ? last.tOnset : 0;
      const phase = ((performance.now() - t0) % beat + beat) % beat;
      ui.beat.classList.toggle('on', phase < 140);
    }, 50);
  }

  NS.modes.register({
    id: 'free',
    title: 'Free Play',
    blurb: 'See what you play',
    order: 5,
    icon: ICON,
    needsSong: false,
    mount,
    unmount,
    songBadge(songId) {
      let found = {};
      try { found = (NS.store.slice('free').get() || {}).found || {}; } catch { found = {}; }
      return found[songId] ? { text: 'Found by ear', tone: 'good' } : null;
    },
    tileChip: () => null,
    debugState() {
      if (!ui || !staff) return null;
      const list = staff.entries();
      return {
        count: total,
        notes: list.map((e) => ({ midi: e.midi, drawn: e.place.note.midi, key: e.place.note.key, zone: e.place.zone, fold: e.place.fold })),
        settings: Object.assign({}, set, { spelling: prefer() }),
        feedback: lastFeedback,
        following: rec ? rec.following() : null,
        playing: Boolean(playback),
        undo: Boolean(undo),
        song: ui.song.hidden ? null : ui.songText.textContent,
        beatMs: staff.beatMs(),
      };
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
