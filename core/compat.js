// window.NoteSteps: the v1 mode API that perform.js uses, rebuilt on NS.* so perform.js runs unmodified.
// Also NS.compat = {isUnlocked, passed, played, legacyKeyboards} for the shell and the modes.
// Load after core/shell.js, before perform.js. Spec §2.4.14, §2.5, §3.8.5.
//
// Pure part (UMD, for node tests): CompatCore = {unlockRule, badgeFromCardLine, namesFromLabels,
// labelsFromNames}.
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;

  // ======================================================================
  // PURE
  // ======================================================================
  // §3.8.5 Perform: song i is open when it is the first song, or the previous song (by index) is
  // passed (Practice best exists, or Perform >= 2 stars), or the song is available in Practice (all
  // its notes introduced; extras always). A song already played stays open (v1 rule, so nobody is
  // locked out of a song they have scores for).
  function unlockRule(i, songs, { passed, played, available }) {
    if (!songs || !Number.isInteger(i) || i < 0 || i >= songs.length) return false;
    if (i === 0) return true;
    return Boolean(passed(songs[i - 1]) || (available && available(songs[i])) || (played && played(songs[i])));
  }
  // def.cardLine(song) -> {stars?, text} | null  ->  songBadge {text, tone, stars, plain}
  function badgeFromCardLine(line, starText) {
    if (!line || !line.text) return null;
    const hasStars = line.stars != null;
    return {
      text: hasStars ? starText(line.stars) + ' ' + line.text : line.text,
      tone: hasStars && line.stars >= 2 ? 'good' : 'muted',
      stars: hasStars ? line.stars : undefined,
      plain: line.text,
    };
  }
  const namesFromLabels = (labels) => labels !== 'never';
  const labelsFromNames = (on) => (on ? 'auto' : 'never');

  const Core = { unlockRule, badgeFromCardLine, namesFromLabels, labelsFromNames };
  if (isNode) { module.exports = Core; return; }

  // ======================================================================
  // BROWSER
  // ======================================================================
  const NS = root.NS;
  const U = NS.util;
  const songs = root.NoteSongs.songs; // the same array as NS.songs.all() (perform.js uses songs[i])

  // ---------- the live store object perform.js reads and writes ----------
  // perf / speed / clickTrack / latency are getters and setters onto slices.perform; they return the
  // live nested objects, so `store.perf[id][speed] = …; saveStore()` persists.
  const store = {};
  const perfSlice = () => NS.store.slice('perform').get();
  ['perf', 'speed', 'clickTrack', 'latency'].forEach((k) => Object.defineProperty(store, k, {
    enumerable: true,
    get: () => perfSlice()[k],
    set: (v) => { perfSlice()[k] = v; },
  }));
  Object.defineProperty(store, 'names', {
    enumerable: true,
    get: () => namesFromLabels(NS.store.settings().labels),
    set: (v) => NS.store.setSetting('labels', labelsFromNames(v)),
  });
  Object.defineProperty(store, 'done', {
    enumerable: true,
    get: () => {
      const out = {};
      const s = NS.store.slice('practice').get().songs || {};
      for (const id in s) if (s[id] && s[id].best) out[id] = s[id].best;
      return out;
    },
  });

  // ---------- unlocks ----------
  const legacyDefs = [];
  function bestPassed(song) {
    return Boolean(song) && (Boolean(store.done[song.id]) || legacyDefs.some((m) => m.passed && m.passed(song)));
  }
  function played(song) {
    return Boolean(song) && (Boolean(store.done[song.id]) || legacyDefs.some((m) => m.played && m.played(song)));
  }
  function courseUnit() {
    try { return (NS.store.section('course') || {}).unit || 0; } catch { /* fall back */ }
    try { return (NS.store.state().course || {}).unit || 0; } catch { return 0; }
  }
  function availableInPractice(song) {
    let level = song.unit;
    if (level == null) {
      const C = NS.curriculum || root.Curriculum;
      try { level = C && C.songLevel ? C.songLevel(song) : Infinity; } catch { level = Infinity; }
    }
    if (level == null || !Number.isFinite(level)) return true; // extras are always available
    return level < courseUnit();
  }
  function isUnlocked(i) {
    return unlockRule(i, songs, { passed: bestPassed, played, available: availableInPractice });
  }

  // ---------- legacy modes ----------
  let mounted = null; // the legacy def whose route is showing
  let noteOff = null; // NS.input subscription made by setNoteHandler
  let busOffs = [];

  // Replaces the previous handler. Calls fn(midi, at, tOnset) for mic notes only (perform.js taps
  // call its own handler); unsubscribed when the route leaves the legacy mode.
  function setNoteHandler(fn) {
    if (noteOff) noteOff();
    noteOff = null;
    if (fn) noteOff = NS.input.on((ev) => { if (ev.source === 'mic') fn(ev.midi, ev.at, ev.tOnset); });
  }

  function showScreen(id) {
    document.querySelectorAll('main.wrap').forEach((s) => (s.hidden = s.id !== id));
    document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true));
    window.scrollTo(0, 0);
  }

  function registerMode(def) {
    legacyDefs.push(def);
    NS.modes.register({
      id: def.id,
      title: def.label,
      blurb: 'Play along in time',
      order: 3,
      needsSong: true,
      legacy: true,
      primary: Boolean(def.primary),
      mount(rootEl, { arg }) {
        rootEl.hidden = true;
        const index = songs.findIndex((s) => s.id === arg);
        if (index < 0) {
          NS.ui.toast('That song isn’t here any more.');
          NS.shell.go('#/');
          return;
        }
        mounted = def;
        busOffs = [
          NS.bus.on('resize', () => { if (def.onResize) def.onResize(); }),
          NS.bus.on('visibility', ({ hidden }) => { if (hidden && def.onHidden) def.onHidden(); }),
        ];
        def.start(index);
      },
      unmount() {
        busOffs.forEach((off) => off());
        busOffs = [];
        setNoteHandler(null);
        if (mounted === def && def.stop) def.stop();
        mounted = null;
      },
      songBadge(songId) {
        const song = songs.find((s) => s.id === songId);
        return song && def.cardLine ? badgeFromCardLine(def.cardLine(song), U.starText) : null;
      },
      songLocked(songId) {
        const i = songs.findIndex((s) => s.id === songId);
        if (i < 0) return { locked: true, why: 'This one can’t be played along with.' };
        if (isUnlocked(i)) return { locked: false };
        return {
          locked: true,
          why: `Opens when you finish “${songs[i - 1].title}” in Practice, get 2 stars performing it, or meet all of this song’s notes.`,
        };
      },
      debugState: () => ({ mode: def.id, legacy: true }),
    });
  }

  // ---------- keyboards and names ----------
  const legacyKeyboards = [];
  const namesOn = () => store.names;
  function buildKeyboard(el, fn) {
    const K = NS.keyboard.create(el, { emit: false, sound: false, labels: namesOn, onPress: fn });
    legacyKeyboards.push(K);
    return K;
  }

  // Every [data-names-toggle]: "Note names: on|off" (on = settings.labels !== 'never').
  function updateNamesButtons() {
    const on = store.names;
    document.querySelectorAll('[data-names-toggle]').forEach((nb) => {
      nb.textContent = `Note names: ${on ? 'on' : 'off'}`;
      nb.classList.toggle('on', on);
      nb.setAttribute('aria-pressed', String(on));
    });
  }
  // Any [data-names-toggle] button, on any screen (delegated, so mode templates need no wiring).
  // Toggles labels between 'never' and 'auto', then tells the mounted legacy mode.
  document.addEventListener('click', (e) => {
    if (!e.target.closest || !e.target.closest('[data-names-toggle]')) return;
    store.names = !store.names; // emits store:changed {section:'settings'}
    NS.store.save();
    updateNamesButtons();
    legacyKeyboards.forEach((K) => K.setLabels(namesOn));
    if (mounted && mounted.onNamesChange) mounted.onNamesChange();
  });
  // Settings changed elsewhere (settings sheet, another tab): keep the legacy keyboards in step.
  NS.bus.on('store:changed', ({ section }) => {
    if (section !== 'settings' && section !== '*') return;
    legacyKeyboards.forEach((K) => { try { K.setLabels(namesOn); } catch { /* destroyed */ } });
  });

  NS.compat = { isUnlocked, passed: bestPassed, played, availableInPractice, legacyKeyboards, core: Core };

  window.NoteSteps = {
    songs, levels: root.NoteSongs.levels, store, saveStore: () => NS.store.save(),
    $: U.$, svgEl: U.svgEl, fmt: U.fmt, starText: U.starText,
    STEP: NS.staff.legacy.STEP, BOTTOM: NS.staff.legacy.BOTTOM,
    drawNote: NS.staff.legacy.drawNote, drawStaffLines: NS.staff.legacy.drawStaffLines,
    noteRightEdge: NS.staff.legacy.noteRightEdge, // used by perform.js; missing from the §2.4.14 list
    audio: NS.audio.ctx, audioContext: NS.audio.ctx,
    heardAt: NS.audio.heardAt, outLatency: NS.audio.outLatency, click: NS.audio.click,
    playTone: (m, d, delay) => NS.audio.playTone(m, d, delay),
    startMic: async () => (await NS.mic.start()).ok,
    stopMic: () => NS.mic.stop(),
    isListening: () => NS.mic.isOn(),
    micSource: () => NS.mic.source(), analyser: () => NS.mic.analyser(),
    setNoteHandler, micNotice: (t) => NS.ui.micNotice(t),
    buildKeyboard,
    renderKeyboard: () => legacyKeyboards.forEach((K) => K.refresh()),
    showHeard: (m) => legacyKeyboards.forEach((K) => K.setHeard(m)),
    foldToKeyboard: (m) => NS.notation.foldToRange(m, 60, 76),
    registerMode,
    startMode: (id, i) => {
      const s = songs[i];
      NS.shell.go(s ? `#/${id}/${encodeURIComponent(s.id)}` : `#/songs/${id}`);
    },
    goHome: () => NS.shell.go('#/'),
    showScreen, renderHome: () => {}, isUnlocked, passed: bestPassed, played,
    updateNamesButtons,
    toggleNames: () => { store.names = !store.names; NS.store.save(); updateNamesButtons(); },
    debug: NS.debug,
  };
})(typeof window !== 'undefined' ? window : globalThis);
