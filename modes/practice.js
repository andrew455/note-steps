// Practice mode (#/practice/:songId[?from=ear][?cold=<earSongId>], #/practice/run?seed=N): untimed
// reading that waits for each note, with Hear It First (spec §3.1), per-note label fading (§3.2.5),
// shape hints (§3.5) and per-occurrence mastery evidence (§3.1.3).
//
// Two parts:
//   PracticeCore (pure, UMD): the attempt rules, outcomes, guard, listen ranges, finish bookkeeping.
//     Browser: NS.PracticeCore. Node: require('../modes/practice.js') (tests/practice.test.js).
//   The mode (browser only): the screen, Hear It First playback, judging NS.input events.
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const Notation = isNode ? require('../core/notation.js') : root.NS.notation;

  // ======================================================================
  // PURE CORE
  // ======================================================================
  const SPEEDS = [1, 0.75, 0.5];
  const WRONG_BLEED_MS = 300; // a wrong pitch this soon after the last correct onset is sustain bleed
  const LABEL_OPACITY = 0.8;
  const PLAYED_LABEL_OPACITY = 0.6;
  const LABELS_TEXT = { auto: 'auto', always: 'all', never: 'off' };
  const LABELS_NEXT = { auto: 'always', always: 'never', never: 'auto' };
  const SHAPES_NEXT = { auto: 'always', always: 'off', off: 'auto' };
  const COMFORT_TEXT = { locked: 'Locked', easy: 'Easy', right: 'Just right', stretch: 'Stretch', tough: 'Tough' };
  const PRAISE = ['Yes!', 'Nice!', 'Right!', 'Good!', 'Spot on!'];
  const ACC_SYMBOL = { '#': '♯', b: '♭', '': '' };

  const pc = (m) => ((m % 12) + 12) % 12;
  const samePc = (a, b) => pc(a) === pc(b);
  const starsFor = (mistakes) => (mistakes == null ? 1 : mistakes === 0 ? 3 : mistakes <= 3 ? 2 : 1);

  function nextSpeed(s) {
    const i = SPEEDS.indexOf(s);
    return SPEEDS[(i + 1) % SPEEDS.length];
  }
  const speedLabel = (s) => `Speed ${Math.round((s || 1) * 100)}%`;

  // 'E4' -> 'E', 'F#4' -> 'F♯', 'Bb4' -> 'B♭'
  function letterOfKey(key) {
    const m = /^([A-G])([#b]?)(-?\d+)$/.exec(String(key));
    return m ? m[1] + ACC_SYMBOL[m[2]] : String(key);
  }
  function noteKeyOf(note) {
    if (note.key) return note.key;
    if (Notation && Notation.noteKey) return Notation.noteKey(note);
    return note.letter + (note.acc || '') + (Math.floor(note.midi / 12) - 1);
  }
  // The display letter of a parsed note: 'E', 'F♯'.
  const letterOf = (note) => note.letter + (ACC_SYMBOL[note.acc || ''] || '');

  // §3.1.3 attempt state. `start` waits for the mic to come back after our own playback.
  function newAttempt({ now, mutedUntil = 0, lastCorrectAt = -Infinity } = {}) {
    return {
      start: Math.max(now, mutedUntil || 0), labelAt: null, wrong: 0, hinted: false, heardNote: false,
      playedKey: null, lastCorrectAt, shownLevel: 0,
    };
  }

  // A wrong note counts (towards att.wrong and mistakes) only when the detector was sure of it and it
  // isn't the ringing tail of the previous, correct note.
  function countsAsWrong(att, ev) {
    return Boolean(ev.confident) && ev.tOnset - att.lastCorrectAt > WRONG_BLEED_MS;
  }

  // §3.1.3: miss if a counted wrong note or "Show me the key"; assisted if the label was visible at the
  // onset, "Hear the note" was used or names are always on; otherwise read.
  function outcomeFor(att, ev, labels) {
    if (att.wrong || att.hinted) return 'miss';
    if ((att.labelAt != null && ev.tOnset >= att.labelAt) || att.heardNote || labels === 'always') return 'assisted';
    return 'read';
  }

  // The wrong note's key, spelled at the octave nearest the target (F5 played for E4 -> 'F4').
  function nearestOctave(midi, targetMidi) {
    let m = midi;
    while (m - targetMidi > 6) m -= 12;
    while (targetMidi - m > 6) m += 12;
    return m;
  }
  function playedKeyFor(midi, targetMidi, prefer = 'sharp') {
    const m = nearestOctave(midi, targetMidi);
    if (Notation && Notation.spellMidi) return Notation.spellMidi(m, prefer).key;
    return String(m);
  }
  function directionText(targetMidi, playedMidi) {
    return targetMidi > nearestOctave(playedMidi, targetMidi) ? 'It’s further to the right.' : 'It’s further to the left.';
  }

  // The prompt never names a note whose label is hidden.
  const promptText = (target, labelVisible) => (labelVisible ? `Play ${letterOf(target)}` : 'Play the blue note');

  // Session guard: when the first-try rate over the last `size` judged notes drops below `threshold`,
  // names come back for the tricky notes for the rest of the run.
  function createGuard({ size = 10, min = 5, threshold = 0.7 } = {}) {
    const win = [];
    let active = false;
    return {
      push(firstTry) {
        win.push(firstTry ? 1 : 0);
        if (win.length > size) win.shift();
        if (!active && win.length >= min && this.rate() < threshold) { active = true; return true; }
        return false;
      },
      rate: () => (win.length ? win.reduce((a, b) => a + b, 0) / win.length : 1),
      get active() { return active; },
    };
  }

  // [from, to) of the phrase that contains note `idx`.
  function phraseOf(phrases, idx, n) {
    for (const p of phrases || []) if (idx >= p[0] && idx < p[1]) return [p[0], p[1]];
    return [0, n];
  }
  function listenRange({ phrases, n }, scope, current) {
    if (scope !== 'part') return { from: 0, to: n };
    const [from, to] = phraseOf(phrases, Math.min(Math.max(0, current), n - 1), n);
    return { from, to };
  }
  // Notation items (notes and the rests between them) for notes [from, to). Items without `kind` are notes.
  function itemsInRange(items, from, to) {
    const out = [];
    let ni = 0;
    for (const it of items || []) {
      const isNote = it.kind !== 'rest';
      if (isNote) {
        if (ni >= from && ni < to) out.push(it);
        ni++;
      } else if (ni > from && ni < to) out.push(it); // rests strictly inside the range
    }
    return out;
  }

  // Notes heard in a Listen during this run (or every note, from Ear First) count as 'hear' evidence.
  const sourceFor = (idx, heardIdx, fromEar) => (fromEar || (heardIdx && heardIdx.has(idx)) ? 'hear' : 'song');

  function hearFirstPrimary(setting, songRec, listened) {
    if (setting === 'always') return true;
    const played = Boolean(songRec && ((songRec.plays || 0) > 0 || songRec.best));
    return setting !== 'never' && !played && !(listened > 0);
  }

  // §3.1.4 slices.practice.songs[id] after a finished run. Fewer mistakes wins `best`; stars follow it.
  function updateSongRecord(prev, { mistakes, ftp, now }) {
    const p = prev || {};
    const best = !p.best || !Number.isFinite(p.best.mistakes) || mistakes < p.best.mistakes ? { mistakes, at: now } : p.best;
    return Object.assign({}, p, {
      plays: (p.plays || 0) + 1, last: now, best, stars: Math.max(p.stars || 0, starsFor(best.mistakes)), ftp,
    });
  }

  // log[day] += {r, m, ms}; days older than keepDays are pruned (day keys sort as text).
  function addLog(log, day, { r = 0, m = 0, ms = 0 }, { keepDays = 90, addDays } = {}) {
    const cur = log[day] || { r: 0, m: 0, ms: 0 };
    log[day] = { r: (cur.r || 0) + r, m: (cur.m || 0) + m, ms: (cur.ms || 0) + Math.round(ms) };
    if (addDays) {
      const cutoff = addDays(day, -keepDays);
      for (const d of Object.keys(log)) if (d < cutoff) delete log[d];
    }
    return log;
  }

  function joinAnd(list) {
    if (list.length <= 1) return list.join('');
    return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
  }

  // Lines for the finish dialog: stronger notes, newly known notes, and a drill suggestion after misses.
  function summaryLines({ accBefore = {}, accAfter = {}, promoted = [], missedKeys = [] }) {
    const lines = [];
    const stronger = Object.keys(accAfter)
      .filter((k) => accBefore[k] != null && accAfter[k] != null && accAfter[k] - accBefore[k] >= 0.05 && !promoted.includes(k))
      .map(letterOfKey);
    if (stronger.length) lines.push({ kind: 'stronger', text: `Getting stronger: ${[...new Set(stronger)].join(', ')}` });
    if (promoted.length) lines.push({ kind: 'known', text: `New: you know ${joinAnd([...new Set(promoted.map(letterOfKey))])} now` });
    if (missedKeys.length) {
      lines.push({ kind: 'drill', text: `Try a quick drill on ${joinAnd([...new Set(missedKeys.map(letterOfKey))])}`, keys: [...new Set(missedKeys)] });
    }
    return lines;
  }

  function finishText({ title, notes, mistakes }) {
    return `You played all ${notes} notes of ${title}` +
      (mistakes === 0 ? ' without a single mistake.' : ` with ${mistakes} wrong note${mistakes === 1 ? '' : 's'} along the way.`);
  }

  // Shape level-up toast copy (§3.5), once per crossing.
  const SHAPE_WORD = { same: ['Repeated notes', 'repeated notes'], step: ['Steps', 'steps'], skip: ['Skips', 'skips'], leap: ['Leaps', 'leaps'] };
  function shapeToastText(statKey, from, to) {
    const [Cap, low] = SHAPE_WORD[statKey] || SHAPE_WORD.step;
    if (from === 2 && to === 1) return `${Cap} are getting easy, so their labels are hiding now.`;
    if (from >= 1 && to === 0) return `You read ${low} at a glance now, so their arrows are gone.`;
    return null;
  }

  // "Next song" in the finish dialog: the first recommended song other than this one, else the next
  // song in library order.
  function pickNextSong(rec, currentId, songs, currentIndex) {
    const cands = [];
    if (rec && rec.kind === 'song') { if (rec.song) cands.push(rec.song); (rec.alts || []).forEach((s) => cands.push(s)); }
    const hit = cands.find((s) => s && s.id !== currentId);
    if (hit) return hit;
    if (currentIndex != null && currentIndex >= 0 && songs[currentIndex + 1]) return songs[currentIndex + 1];
    return null;
  }

  const songKeys = (song) => song.keys || [...new Set((song.notes || []).map(noteKeyOf))];

  // §3.7.10 cold read: the first library song not in the ear progress, never practised, every key
  // introduced, comfort right/easy, keys within (this tune's keys ∪ known keys). null if none.
  function coldReadTarget({ songId, songs, earTunes = {}, practiced = {}, introduced, known, comfortOf, earKeys }) {
    return songs.find((s) => {
      if (s.id === songId || s.id in earTunes) return false;
      const r = practiced[s.id];
      if (r && ((r.plays || 0) > 0 || r.best)) return false;
      const keys = songKeys(s);
      if (!keys.length || !keys.every((k) => introduced.has(k))) return false;
      if (!keys.every((k) => earKeys.has(k) || known.has(k))) return false;
      return ['right', 'easy'].includes(comfortOf(s));
    }) || null;
  }

  const core = {
    SPEEDS, LABEL_OPACITY, PLAYED_LABEL_OPACITY, LABELS_TEXT, LABELS_NEXT, SHAPES_NEXT, COMFORT_TEXT, PRAISE,
    pc, samePc, starsFor, nextSpeed, speedLabel, letterOfKey, letterOf, noteKeyOf, newAttempt, countsAsWrong,
    outcomeFor, nearestOctave, playedKeyFor, directionText, promptText, createGuard, phraseOf, listenRange,
    itemsInRange, sourceFor, hearFirstPrimary, updateSongRecord, addLog, joinAnd, summaryLines, finishText,
    shapeToastText, pickNextSong, songKeys, coldReadTarget,
  };
  if (isNode) { module.exports = core; return; }

  // ======================================================================
  // THE MODE (browser)
  // ======================================================================
  const NS = root.NS;
  NS.PracticeCore = core;
  const { midiName } = root.Pitch;
  const { starText } = NS.util;
  const librarySongs = () => root.NoteSongs.songs;
  const reducedMotion = () => Boolean(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const TEMPLATE = `
  <div class="topbar">
    <button class="back" data-ref="back" aria-label="Back">←</button>
    <div class="title">
      <span class="eyebrow" data-ref="eyebrow">Practice</span>
      <h2 data-ref="title"></h2>
    </div>
    <span class="count" data-ref="count"></span>
  </div>

  <section class="pr-intro" data-ref="intro" aria-labelledby="prIntroTitle">
    <div class="pr-intro-head">
      <h3 id="prIntroTitle" data-ref="introTitle"></h3>
      <span class="pr-pill" data-ref="pill" hidden></span>
    </div>
    <p class="muted pr-origin" data-ref="origin"></p>
    <p class="pr-sub" data-ref="introSub" hidden></p>
    <div class="pr-uses">
      <span class="muted">Uses</span>
      <ul class="pr-chips" data-ref="chips" aria-label="Notes in this tune"></ul>
    </div>
    <div class="pr-intro-actions">
      <button class="btn" data-ref="hearFirst">▶ Hear it first</button>
      <button class="btn" data-ref="startBtn">Start reading</button>
    </div>
  </section>

  <div class="staff-card">
    <svg id="staff" data-ref="staff" role="img" aria-label="Music staff"></svg>
  </div>
  <div class="progress" data-ref="progressWrap" role="progressbar" aria-label="Notes played" aria-valuemin="0"><div data-ref="progress"></div></div>
  <div class="pr-slot" data-ref="fbSlot"></div>
  <div class="pr-slot" data-ref="micSlot"></div>
  <p class="notice" data-mic-notice hidden></p>

  <div class="controls pr-listen" data-ref="listenRow">
    <button class="btn" data-ref="listenBtn" aria-pressed="false">▶ Listen</button>
    <div class="pr-slot" data-ref="scopeSlot"></div>
    <button class="btn small chip" data-ref="speedBtn"></button>
  </div>
  <div class="controls">
    <button class="btn" data-ref="hear">Hear the note</button>
    <button class="btn" data-ref="hint">Show me the key</button>
    <button class="btn small chip" data-ref="namesBtn"></button>
    <button class="btn small chip" data-ref="shapesBtn"></button>
  </div>

  <div>
    <div class="keyboard" id="keyboard" data-ref="keyboard" aria-label="On-screen keyboard. Tap a key to play it."></div>
    <p class="muted pr-kb-tip">The blue key shows the note your phone heard. No piano nearby? You can also tap these keys.</p>
  </div>

  <div class="overlay pr-done" id="doneOverlay" data-ref="done" hidden>
    <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="doneTitle">
      <div class="stars" data-ref="doneStars" aria-hidden="true">★★★</div>
      <h2 id="doneTitle" data-ref="doneTitle" tabindex="-1">Well played!</h2>
      <p class="muted" data-ref="doneText"></p>
      <ul class="pr-summary" data-ref="doneSummary"></ul>
      <div class="row">
        <button class="btn" data-ref="again">Play again</button>
        <button class="btn primary" data-ref="next">Next song</button>
      </div>
      <div class="row">
        <button class="btn" data-ref="more">Another short one</button>
        <button class="btn" data-ref="list">All songs</button>
      </div>
      <button class="btn" data-ref="cold" hidden>Read a new tune with these notes</button>
      <div class="pr-chords" data-ref="chords"></div>
      <button class="btn" type="button" data-ref="chordMic" hidden>🎤 Start listening for chords</button>
    </div>
  </div>`;

  // Generated songs (Another short one, runs) waiting to be opened by id.
  const pending = new Map();
  function remember(song) {
    pending.set(song.id, song);
    while (pending.size > 12) pending.delete(pending.keys().next().value);
  }

  let ses = null; // the one mounted run
  // One-time tips already shown in this page (backs up the stored flags if the store drops them).
  const tipsShown = new Set();

  // ---------- songs ----------
  function generated(id, title, tokens, extra) {
    const m = Notation.parseMelody(tokens, { beatsPerBar: 4, pickup: 0 });
    return Object.assign({
      id, title, origin: 'Little steps', bpm: 90, beatsPerBar: 4, pickup: 0, kind: 'exercise', generated: true,
      notes: m.notes, items: m.items, phrases: m.phrases, endBeat: m.endBeat, source: tokens,
      keys: [...new Set(m.notes.map(noteKeyOf))], stage: 'extra',
    }, extra || {});
  }
  function makeRun(seed) {
    const S = NS.store.state();
    if (NS.songs && NS.songs.run) {
      try { const s = NS.songs.run(seed, S); if (s && s.notes && s.notes.length) return s; } catch (err) { console.error('[practice] run', err); }
    }
    return generated(`run-${seed}`, 'A short reading run', NS.curriculum.readingRun(S, seed));
  }
  function makeMoreLike(song) {
    const seed = Date.now() % 2147483647;
    if (NS.songs && NS.songs.moreLike) {
      try { const s = NS.songs.moreLike(song, seed); if (s && s.notes && s.notes.length) return s; } catch (err) { console.error('[practice] moreLike', err); }
    }
    const keys = core.songKeys(song);
    const tokens = NS.curriculum.genPhrase(keys, [], { len: 12, focusShare: 0.35, seed });
    return generated(`more-${seed}`, `More like ${song.title}`, tokens);
  }
  function resolveSong(arg, query) {
    if (!arg) return null;
    if (pending.has(arg)) return pending.get(arg);
    if (arg === 'run') {
      const seed = Number(query.get('seed')) || parseInt(NS.util.hash(NS.util.dayKey(Date.now())), 16) % 100000;
      return makeRun(seed);
    }
    if (NS.songs && NS.songs.get) {
      try { const s = NS.songs.get(arg); if (s) return s; } catch {}
    }
    return librarySongs().find((s) => s.id === arg) || null;
  }
  // Copies the notes with key/i and fills phrases/items when songs.js doesn't provide them yet.
  function prepare(song) {
    const notes = song.notes.map((n, i) => Object.assign({}, n, { key: noteKeyOf(n), i }));
    let phrases = song.phrases;
    if (!phrases && song.source) {
      try { phrases = Notation.parseMelody(song.source, { beatsPerBar: song.beatsPerBar || 4, pickup: song.pickup || 0 }).phrases; } catch {}
    }
    if (!phrases || !phrases.length) phrases = [[0, notes.length]];
    const lib = librarySongs();
    const libIndex = lib.indexOf(song) >= 0 ? lib.indexOf(song) : lib.findIndex((s) => s.id === song.id && !song.generated);
    return { notes, phrases, items: song.items || song.notes, keys: core.songKeys(Object.assign({}, song, { notes })), libIndex };
  }

  // ---------- helpers on the mounted run ----------
  const settings = () => NS.store.settings();
  const practiceSlice = () => NS.store.slice('practice');
  const target = () => (ses && ses.current < ses.notes.length ? ses.notes[ses.current] : null);
  const listenActive = () => Boolean(ses && ses.listen);
  const latMs = () => { try { return NS.audio.outLatency() * 1000; } catch { return 0; } };

  function labelDelayFor(key) {
    const st = settings();
    return NS.mastery.labelDelay(key, { labels: st.labels, refresh: ses.refresh[key] || 0, guard: ses.guard.active });
  }

  function shapeLevelFor(i) {
    if (i < 1 || i >= ses.notes.length) return 0;
    const setting = settings().shapes || 'auto';
    if (setting === 'off') return 0;
    if (setting === 'always') return 2;
    const showIt = ses.flash === 'bad' && i === ses.current;
    return NS.mastery.shapeLevel(ses.notes[i - 1], ses.notes[i], { showIt, guard: ses.guard.active }) || 0;
  }

  function setFeedback(kind, big, small) {
    ses.fbKind = kind;
    ses.fb.set(kind, big, small);
  }
  function promptSmall() {
    if (ses.firstTimeHint) return 'New tune. Tap ▶ Listen to hear it first.';
    return ses.labelShown ? 'Find it on your keyboard and play it.' : 'Use the staff to work out the note, then play it.';
  }
  function setPrompt(small) {
    const t = target();
    if (!t) return;
    setFeedback('neutral', core.promptText(t, ses.labelShown), small != null ? small : promptSmall());
  }

  // ---------- attempts and labels ----------
  function startAttempt() {
    clearTimeout(ses.labelTimer);
    cancelAnimationFrame(ses.fadeRaf);
    ses.labelShown = false;
    ses.labelOpacity = 0;
    ses.att = core.newAttempt({ now: performance.now(), mutedUntil: ses.muteEnd, lastCorrectAt: ses.lastCorrectAt });
    scheduleLabel();
  }

  function scheduleLabel() {
    clearTimeout(ses.labelTimer);
    const t = target();
    if (!t || ses.labelShown) return;
    const d = labelDelayFor(t.key);
    if (d === 0) { showLabel(false); return; }
    if (settings().labels === 'auto') maybeFadeTip();
    if (!Number.isFinite(d)) return;
    const wait = Math.max(0, ses.att.start + d - performance.now());
    ses.labelTimer = setTimeout(() => { if (ses && !ses.finished) showLabel(true); }, wait);
  }

  function showLabel(fade) {
    if (ses.labelShown) return;
    ses.labelShown = true;
    ses.att.labelAt = performance.now();
    clearTimeout(ses.labelTimer);
    if (ses.fbKind === 'neutral' && !listenActive()) setPrompt();
    else if (ses.fbKind === 'good' && target()) ses.fb.set('good', ses.fbBig || '', `Next: play ${core.letterOf(target())}.`);
    if (!fade || reducedMotion()) {
      ses.labelOpacity = core.LABEL_OPACITY;
      renderStaff();
      return;
    }
    const t0 = performance.now();
    const step = () => {
      if (!ses || !ses.labelShown) return;
      const k = Math.min(1, (performance.now() - t0) / 300);
      ses.labelOpacity = core.LABEL_OPACITY * k;
      renderStaff();
      if (k < 1) ses.fadeRaf = requestAnimationFrame(step);
    };
    ses.labelOpacity = 0.05;
    renderStaff();
    ses.fadeRaf = requestAnimationFrame(step);
  }

  // Settings or the guard changed: show a now-due label, hide one that names are now off for.
  function reevaluateLabel() {
    const t = target();
    if (!t) return;
    if (ses.labelShown && settings().labels === 'never' && !(ses.refresh[t.key] > 0) && !ses.hintOn && ses.flash !== 'bad') {
      ses.labelShown = false;
      ses.labelOpacity = 0;
    }
    scheduleLabel();
  }

  function maybeFadeTip() {
    const p = practiceSlice().get();
    if (tipsShown.has('labelFade') || (p.tips && p.tips.labelFade)) return;
    tipsShown.add('labelFade');
    NS.ui.toast('Names fade as you learn each note. Wait a moment and the name appears.', { ms: 5000 });
    practiceSlice().update((s) => { s.tips = Object.assign({}, s.tips, { labelFade: true }); return s; });
  }

  // ---------- rendering ----------
  function renderStaff() {
    if (!ses || !ses.ui) return;
    const { notes } = ses;
    const cur = ses.current;
    const playing = ses.listen ? ses.listen.playingIdx : null;
    const inListen = listenActive();
    const st = settings();
    const delays = new Map();
    const delayOf = (key) => { if (!delays.has(key)) delays.set(key, labelDelayFor(key)); return delays.get(key); };
    const shapeCache = new Map();
    const levelOf = (i) => { if (!shapeCache.has(i)) shapeCache.set(i, shapeLevelFor(i)); return shapeCache.get(i); };

    const opts = {
      notes,
      current: inListen ? -1 : cur,
      paging: 'page',
      state: (i) => {
        if (playing != null && i === playing) return 'listen';
        if (i < cur) return 'done';
        if (i === cur && !inListen) return ses.flash === 'bad' ? 'bad' : 'current';
        return 'upcoming';
      },
      label: (i) => {
        const n = notes[i];
        if (i < cur) return core.letterOf(n);
        if (i === cur) return ses.labelShown ? core.letterOf(n) : null;
        return delayOf(n.key) === 0 ? core.letterOf(n) : null;
      },
      labelOpacity: (i) => (i < cur ? core.PLAYED_LABEL_OPACITY : i === cur ? ses.labelOpacity : core.LABEL_OPACITY),
      tint: (i) => {
        if (i <= cur) return null;
        const s = NS.mastery.state(notes[i].key);
        return s === 'new' || s === 'learning' ? s : null;
      },
      shapes: (i) => {
        if (i < 1 || i < cur || i > cur + 3) return null;
        const level = levelOf(i);
        if (!level) return null;
        const bad = ses.flash === 'bad' && i === cur;
        return { level, emphasis: i === cur, rescue: bad };
      },
      ariaLabel: ({ page, pages }) => {
        if (inListen) return `Music staff, part ${page + 1} of ${pages}. Playing note ${(playing ?? ses.listen.from) + 1} of ${notes.length}.`;
        const t = target();
        if (!t) return `Music staff. All ${notes.length} notes played.`;
        let s = `Music staff, part ${page + 1} of ${pages}. Current note is ${ses.labelShown ? core.letterOf(t) : 'the blue note'}.`;
        if (cur > 0 && st.shapes !== 'off' && levelOf(cur) > 0 && NS.shapes) s += ' ' + NS.shapes.describe(notes[cur - 1], t);
        return s;
      },
    };
    if (inListen) opts.pageOf = playing != null ? playing : ses.listen.from;
    NS.staff.render(ses.ui.staff, opts);
    if (!inListen && target()) ses.att.shownLevel = Math.max(ses.att.shownLevel, levelOf(cur));
  }

  function renderKeyboard() {
    const t = target();
    ses.kb.setHint(ses.hintOn && t ? t.midi : null);
    if (ses.kb.refresh) ses.kb.refresh();
  }

  function renderChrome() {
    const { ui, notes } = ses;
    const n = notes.length;
    const shown = Math.min(ses.current + 1, n);
    ui.count.textContent = `${shown} / ${n}`;
    ui.count.setAttribute('aria-label', `Note ${shown} of ${n}`);
    ui.progress.style.width = (100 * ses.current) / n + '%';
    ui.progressWrap.setAttribute('aria-valuemax', String(n));
    ui.progressWrap.setAttribute('aria-valuenow', String(ses.current));
    const st = settings();
    const labels = st.labels || 'auto';
    ui.namesBtn.textContent = `Names: ${core.LABELS_TEXT[labels] || labels}`;
    ui.namesBtn.setAttribute('aria-label', `Note names: ${core.LABELS_TEXT[labels] || labels}. Tap to change.`);
    ui.namesBtn.classList.toggle('on', labels !== 'never');
    const shapes = st.shapes || 'auto';
    ui.shapesBtn.textContent = `Shapes: ${shapes}`;
    ui.shapesBtn.setAttribute('aria-label', `Shape hints: ${shapes}. Tap to change.`);
    ui.shapesBtn.classList.toggle('on', shapes !== 'off');
    ui.speedBtn.textContent = core.speedLabel(ses.speed);
    ui.speedBtn.setAttribute('aria-label', `Listening ${core.speedLabel(ses.speed).toLowerCase()}. Tap to change.`);
    const playing = listenActive();
    ui.listenBtn.textContent = playing ? '■ Stop' : '▶ Listen';
    ui.listenBtn.setAttribute('aria-pressed', String(playing));
    ui.listenBtn.classList.toggle('on', playing);
    ui.listenBtn.disabled = ses.finished;
    ui.hear.disabled = ses.finished;
    ui.hint.disabled = ses.finished;
  }

  function renderAll() {
    renderChrome();
    renderStaff();
    renderKeyboard();
  }

  // ---------- Hear It First ----------
  function startListen(scope) {
    stopListen();
    if (!ses || ses.finished) return;
    const { from, to } = core.listenRange({ phrases: ses.phrases, n: ses.notes.length }, scope, ses.current);
    const items = core.itemsInRange(ses.items, from, to);
    if (!items.length) return;
    NS.audio.resume();
    const l = { from, to, scope, playingIdx: null, handle: null };
    ses.listen = l;
    ses.firstTimeHint = false;
    const h = NS.audio.playSequence(items, {
      bpm: ses.song.bpm || 90, speed: ses.speed, voice: 'piano', id: 'practice-listen',
      onNote: (i) => {
        if (!ses || ses.listen !== l) return;
        const idx = from + i;
        l.playingIdx = idx;
        ses.heardIdx.add(idx);
        ses.kb.setPlaying(ses.notes[idx].midi);
        renderStaff();
      },
      onEnd: (reason) => onListenEnd(l, reason),
    });
    l.handle = h;
    if (ses.listen !== l) return; // ended synchronously
    ses.muteEnd = Math.max(ses.muteEnd, (h.endPerf || performance.now()) + 250 + latMs());
    setFeedback('neutral', scope === 'part' ? 'Listen: this part' : `Listen: ${ses.song.title}`, 'Follow the notes with your eyes. Your mic is paused.');
    renderAll();
  }

  function stopListen() {
    if (!ses || !ses.listen) return;
    const l = ses.listen;
    if (l.handle) l.handle.stop(); // calls onListenEnd(l, 'stopped')
    if (ses.listen === l) onListenEnd(l, 'stopped');
  }

  function onListenEnd(l, reason) {
    if (!ses || ses.listen !== l) return;
    ses.listen = null;
    const now = performance.now();
    ses.muteEnd = reason === 'stopped' ? now + 300 : Math.max(ses.muteEnd, now);
    if (ses.kb) ses.kb.setPlaying(null);
    if (reason === 'ended' && l.scope !== 'part') {
      const id = ses.song.id;
      practiceSlice().update((p) => {
        p.listened = Object.assign({}, p.listened);
        p.listened[id] = (p.listened[id] || 0) + 1;
        return p;
      });
    }
    if (ses.unmounting || !ses.ui) return;
    if (!ses.finished && ses.att) {
      // Listening time isn't reading time: the attempt (and the label clock) restarts after the mute.
      ses.att.start = Math.max(ses.att.start, ses.muteEnd);
      scheduleLabel();
      setPrompt('Your turn. Start from the blue note.');
    }
    renderAll();
  }

  // ---------- judging ----------
  function onInput(ev) {
    if (!ses || ses.finished || !ses.ui) return;
    if (listenActive()) {
      if (ev.source === 'screen') stopListen(); // a key tap stops playback and is not judged
      return;
    }
    if (ev.source === 'mic' && NS.audio.isBusy()) return; // our own sound; the mic is muted anyway
    ses.kb.setHeard(ev.midi);
    if (ses.introOpen) closeIntro();
    if (!ses.startedAt) ses.startedAt = performance.now();
    const t = target();
    if (!t) return;
    if (core.samePc(ev.midi, t.midi)) onCorrect(ev, t);
    else onWrong(ev, t);
  }

  function onWrong(ev, t) {
    const att = ses.att;
    const counted = core.countsAsWrong(att, ev);
    if (!att.playedKey) att.playedKey = core.playedKeyFor(ev.midi, t.midi, settings().spelling || 'sharp');
    if (counted) { att.wrong++; ses.mistakes++; }
    ses.flash = 'bad';
    ses.refresh[t.key] = 2;
    if (counted && att.wrong >= 2) ses.hintOn = true;
    if (!ses.labelShown) showLabel(false);
    let small = `The note on the staff is ${core.letterOf(t)}. ${core.directionText(t.midi, ev.midi)}`;
    if (ses.current > 0 && NS.shapes) small += ' ' + NS.shapes.rescueText(ses.notes[ses.current - 1], t, true);
    if (ses.hintOn) small += ' The green key shows where it is.';
    setFeedback('bad', `You played ${midiName(ev.midi)}. Try again.`, small);
    renderAll();
  }

  function onCorrect(ev, t) {
    const att = ses.att;
    const i = ses.current;
    const prev = i > 0 ? ses.notes[i - 1] : null;
    const st = settings();
    const outcome = core.outcomeFor(att, ev, st.labels);
    const rec = {
      key: t.key, outcome, source: core.sourceFor(i, ses.heardIdx, ses.fromEar),
      rtMs: Math.max(0, Math.round(ev.tOnset - att.start)), repeat: Boolean(prev && prev.key === t.key),
      playedKey: att.playedKey, songPlays: ses.plays, confident: true, firstToken: i === 0, ts: Date.now(),
    };
    try { NS.mastery.record(rec); } catch (err) { console.error('[practice] mastery.record', err); }
    ses.records.push(Object.assign({ i, shownLevel: att.shownLevel }, rec));
    if (ses.records.length > 60) ses.records.shift();
    if (prev) recordShape(prev, t, outcome, att.shownLevel);
    if (outcome === 'miss') ses.missedKeys.add(t.key); else ses.firstTry++;
    if (outcome === 'miss') ses.missCount++;
    const guardOn = ses.guard.push(outcome !== 'miss');
    if (ses.refresh[t.key] > 0) ses.refresh[t.key]--;
    ses.lastCorrectAt = ev.tOnset;
    ses.current++;
    ses.flash = null;
    ses.hintOn = false;
    if (ses.current >= ses.notes.length) {
      renderAll();
      finish();
      return;
    }
    startAttempt();
    const next = target();
    const big = `${core.PRAISE[ses.current % core.PRAISE.length]} That was ${core.letterOf(t)}.`;
    let small = ses.labelShown ? `Next: play ${core.letterOf(next)}.` : 'Now read the next blue note.';
    if (guardOn) small = 'Names are back on for the tricky notes.';
    ses.fbBig = big;
    setFeedback('good', big, small);
    renderAll();
  }

  function recordShape(a, b, outcome, shownLevel) {
    const Sh = NS.shapes;
    let sk = null;
    let before = null;
    try {
      sk = Sh.statKey(Sh.classify(a, b).kind);
      const stats = NS.store.section('shapes');
      before = stats && stats[sk] ? Sh.typeLevel(Object.assign({}, stats[sk]), sk) : null;
    } catch {}
    // NS.mastery may announce the level change itself ('shape:level' + its own toast); then we stay quiet.
    let announced = false;
    const off = NS.bus.on('shape:level', () => { announced = true; });
    try { NS.mastery.recordShape(a, b, outcome, shownLevel); } catch (err) { console.error('[practice] recordShape', err); }
    off();
    if (announced || sk == null || before == null) return;
    let after = null;
    try { const stats = NS.store.section('shapes'); after = stats && stats[sk] ? Sh.typeLevel(stats[sk], sk) : null; } catch {}
    if (after == null || after >= before) return;
    const crossing = `${before}-${after}`;
    const p = practiceSlice().get();
    const seen = (p.shapeToasts && p.shapeToasts[sk]) || [];
    if (seen.includes(crossing) || tipsShown.has(`shape:${sk}:${crossing}`)) return;
    tipsShown.add(`shape:${sk}:${crossing}`);
    const text = (Sh.levelUpText && Sh.levelUpText(sk, before, after)) || core.shapeToastText(sk, before, after);
    if (!text) return;
    NS.ui.toast(text, { ms: 4500 });
    practiceSlice().update((s) => {
      s.shapeToasts = Object.assign({}, s.shapeToasts, { [sk]: [...seen, crossing] });
      return s;
    });
  }

  // ---------- finish ----------
  function logSnapshot() {
    try { return JSON.stringify(NS.store.section('log')[NS.util.dayKey(Date.now())] || null); } catch { return null; }
  }

  function finish() {
    stopListen();
    clearTimeout(ses.labelTimer);
    cancelAnimationFrame(ses.fadeRaf);
    ses.finished = true;
    const { song, notes } = ses;
    const n = notes.length;
    const mistakes = ses.mistakes;
    const stars = core.starsFor(mistakes);
    const now = Date.now();
    const lib = librarySongs();
    const isLibrary = ses.libIndex >= 0;
    const nextIdx = ses.libIndex + 1;
    const wasUnlocked = isLibrary && nextIdx < lib.length && NS.compat.isUnlocked(nextIdx);

    if (isLibrary) {
      practiceSlice().update((p) => {
        p.songs = Object.assign({}, p.songs);
        p.songs[song.id] = core.updateSongRecord(p.songs[song.id], { mistakes, ftp: n ? ses.firstTry / n : null, now });
        return p;
      });
    }
    try {
      // NS.mastery may already log each judged note; only add our totals if nothing logged during the run.
      const log = NS.store.section('log');
      if (logSnapshot() === ses.logBefore) core.addLog(log, NS.util.dayKey(now), { r: ses.firstTry, m: ses.missCount, ms: performance.now() - (ses.startedAt || performance.now()) }, { addDays: NS.util.addDays });
      NS.store.save();
    } catch (err) { console.error('[practice] log', err); }

    NS.bus.emit('practice:finished', Object.assign(
      { songId: song.id, mistakes, stars, from: ses.fromEar ? 'ear' : null, notes: n },
      ses.coldFor ? { coldFor: ses.coldFor } : {},
    ));

    // ---------- dialog ----------
    const ui = ses.ui;
    ui.doneStars.textContent = starText(stars);
    ui.doneTitle.textContent = mistakes === 0 ? 'Perfect!' : 'Well played!';
    let text = core.finishText({ title: song.title, notes: n, mistakes });
    if (isLibrary && !wasUnlocked && nextIdx < lib.length && NS.compat.isUnlocked(nextIdx)) text += ` You’ve unlocked ${lib[nextIdx].title}.`;
    ui.doneText.textContent = text;

    const accAfter = {};
    ses.keys.forEach((k) => { const r = NS.mastery.get(k); if (r && r.acc != null) accAfter[k] = r.acc; });
    const lines = core.summaryLines({ accBefore: ses.accBefore, accAfter, promoted: [...ses.promoted], missedKeys: [...ses.missedKeys] });
    ui.doneSummary.innerHTML = '';
    lines.forEach((ln) => {
      const li = document.createElement('li');
      li.className = 'pr-sum-' + ln.kind;
      if (ln.kind === 'drill') {
        const b = document.createElement('button');
        b.className = 'btn small';
        b.textContent = ln.text;
        const q = ln.keys.length === 1 ? `focus=${encodeURIComponent(ln.keys[0])}` : 'weak=1';
        b.addEventListener('click', () => ses.go(`#/drill?${q}`));
        li.appendChild(b);
      } else li.textContent = ln.text;
      ui.doneSummary.appendChild(li);
    });
    ui.doneSummary.hidden = !lines.length;

    let rec = null;
    try { rec = NS.curriculum.recommend(NS.store.state(), lib, now); } catch {}
    const next = core.pickNextSong(rec, song.id, lib, ses.libIndex >= 0 ? ses.libIndex : null);
    ses.nextRoute = next ? `#/practice/${encodeURIComponent(next.id)}` : null;
    ui.next.hidden = !next;
    ui.next.textContent = 'Next song';
    ui.next.setAttribute('aria-label', next ? `Next song: ${next.title}` : 'Next song');

    ui.cold.hidden = !ses.fromEar;
    if (ses.fromEar) ses.coldRoute = coldRoute();

    ui.done.hidden = false;
    setFeedback('good', 'Song complete!', '');
    NS.audio.cue('done');
    showChordCard(Boolean(next));
    (next ? ui.next : ui.again).focus();
    renderChrome();
  }

  function coldRoute() {
    const lib = librarySongs();
    const S = NS.store.state();
    const introduced = new Set(NS.mastery.introduced ? NS.mastery.introduced() : []);
    const known = new Set([...introduced].filter((k) => NS.mastery.state(k) === 'known'));
    const earTunes = (S.slices && S.slices.ear && S.slices.ear.tunes) || {};
    const practiced = practiceSlice().get().songs || {};
    const comfortOf = (s) => { try { return NS.curriculum.comfort(s, S, Date.now()).label; } catch { return 'tough'; } };
    const t = core.coldReadTarget({ songId: ses.song.id, songs: lib, earTunes, practiced, introduced, known, comfortOf, earKeys: new Set(ses.keys) });
    const q = `cold=${encodeURIComponent(ses.song.id)}`;
    if (t) return `#/practice/${encodeURIComponent(t.id)}?${q}`;
    const seed = Date.now() % 100000;
    return `#/practice/run?seed=${seed}&${q}`;
  }

  // Chord commands on the finish dialog (§7.1): C -> Next song (All songs when there's none), Cm -> Play again.
  function showChordCard(hasNext) {
    const slot = ses.ui.chords;
    slot.innerHTML = '';
    if (!root.ChordCard) return;
    const cAction = hasNext ? 'Next song' : 'All songs';
    const actions = {
      C: () => (hasNext ? goNext() : goList()),
      Cm: () => playAgain(),
    };
    const card = root.ChordCard.render(slot, {
      chords: [
        { id: 'C', title: 'C major', action: cAction, notes: ['C4', 'E4', 'G4'], fingers: [1, 3, 5] },
        { id: 'Cm', title: 'C minor', action: 'Play again', notes: ['C4', 'Eb4', 'G4'], fingers: [1, 3, 5] },
      ],
      listening: NS.mic.isOn(),
    });
    ses.chord = { card, det: null, quietUntil: 0, actions, timer: null };
    attachChords();
  }
  function attachChords() {
    const c = ses && ses.chord;
    if (!c) return;
    if (c.det) { try { c.det.dispose(); } catch {} c.det = null; }
    c.card.setListening(NS.mic.isOn() || Boolean(NS.midi && NS.midi.isOn()));
    // The popup covers the main mic button, so offer one inside it.
    const micBtn = ses.ui.chordMic;
    if (micBtn) {
      micBtn.hidden = NS.mic.isOn();
      micBtn.onclick = () => { NS.audio.resume && NS.audio.resume(); NS.mic.start(); };
    }
    const src = NS.mic.isOn() && NS.mic.source ? NS.mic.source() : null;
    const midiOn = NS.midi && NS.midi.isOn();
    if ((!src && !midiOn) || !root.ChordDetect) return;
    c.det = root.ChordDetect.attach(NS.audio.ctx(), src, {
      targets: ['C', 'Cm'],
      muted: () => NS.audio.micMuted(performance.now()),
      onChord: (name, info) => {
        const now = performance.now();
        const usb = info && info.via === 'midi';
        if (!ses || ses.chord !== c || !c.actions[name] || (!usb && NS.audio.micMuted(now)) || now < c.quietUntil) return;
        c.quietUntil = now + 800;
        c.card.flash(name);
        clearTimeout(c.timer);
        c.timer = setTimeout(() => { if (ses && ses.chord === c) c.actions[name](); }, 450);
      },
    });
    c.det.start();
  }
  function disposeChords() {
    const c = ses && ses.chord;
    if (!c) return;
    clearTimeout(c.timer);
    if (c.det) { try { c.det.dispose(); } catch {} }
    try { c.card.destroy(); } catch {}
    ses.chord = null;
  }

  // ---------- navigation ----------
  function playAgain() {
    if (ses.song.generated) remember(ses.song);
    ses.go(ses.route);
  }
  function goNext() { if (ses.nextRoute) ses.go(ses.nextRoute); }
  function goList() { ses.go('#/songs/practice'); }
  function goMore() {
    const more = makeMoreLike(ses.song);
    remember(more);
    ses.go(`#/practice/${encodeURIComponent(more.id)}`);
  }

  // ---------- intro card ----------
  function renderIntro() {
    const { ui, song } = ses;
    ui.introTitle.textContent = song.title;
    ui.origin.textContent = song.origin || song.blurb || '';
    ui.origin.hidden = !ui.origin.textContent;
    if (ses.fromEar) {
      ui.introSub.textContent = 'You already know how this sounds. Now see what it looks like.';
      ui.introSub.hidden = false;
    }
    let comfort = null;
    try { comfort = NS.curriculum.comfort(song, NS.store.state(), Date.now()); } catch {}
    if (comfort && COMFORT_TEXT[comfort.label]) {
      const pct = Math.round(100 * (comfort.knownShare || 0));
      ui.pill.textContent = `${COMFORT_TEXT[comfort.label]} · ${pct}% known`;
      ui.pill.dataset.tone = comfort.label;
      ui.pill.hidden = false;
    }
    const keys = [...ses.keys].sort((a, b) => Notation.fromKey(a).midi - Notation.fromKey(b).midi);
    const letters = keys.map(core.letterOfKey);
    const dup = new Set(letters.filter((l, i) => letters.indexOf(l) !== i));
    ui.chips.innerHTML = '';
    keys.forEach((k, i) => {
      const s = NS.mastery.state(k);
      const word = s === 'locked' ? 'to come' : s;
      const li = document.createElement('li');
      li.className = 'pr-chip';
      li.dataset.state = s;
      li.setAttribute('aria-label', `${k}, ${word}`);
      const b = document.createElement('strong');
      b.textContent = dup.has(letters[i]) ? k.replace('#', '♯').replace(/b(?=-?\d)/, '♭') : letters[i];
      const w = document.createElement('span');
      w.textContent = word;
      li.append(b, w);
      ui.chips.appendChild(li);
    });
    const p = practiceSlice().get();
    const primary = core.hearFirstPrimary(settings().hearFirst || 'ask', p.songs && p.songs[song.id], (p.listened || {})[song.id] || 0);
    ui.hearFirst.classList.toggle('primary', primary);
    ui.startBtn.classList.toggle('primary', !primary);
  }
  function closeIntro() {
    ses.introOpen = false;
    ses.ui.intro.hidden = true;
  }

  // ---------- mount / unmount ----------
  function mount(rootEl, params, ctx) {
    if (ses) unmount();
    const query = params.query || new URLSearchParams();
    const song = resolveSong(params.arg, query);
    if (!song || !song.notes || !song.notes.length) {
      NS.ui.toast('That song isn’t here any more.');
      ctx.go('#/');
      return;
    }
    const prep = prepare(song);
    const fromEar = query.get('from') === 'ear';
    const p = practiceSlice().get();
    const speed = core.SPEEDS.includes(p.listen && p.listen.speed) ? p.listen.speed : 1;
    const scope = p.listen && p.listen.scope === 'part' ? 'part' : 'whole';
    const songRec = p.songs && p.songs[song.id];
    const accBefore = {};
    prep.keys.forEach((k) => { const r = NS.mastery.get(k); if (r && r.acc != null) accBefore[k] = r.acc; });

    rootEl.id = 'play';
    rootEl.innerHTML = TEMPLATE;
    const ui = {};
    rootEl.querySelectorAll('[data-ref]').forEach((e) => (ui[e.dataset.ref] = e));

    ses = Object.assign(prep, {
      song, fromEar, coldFor: query.get('cold') || null, go: ctx.go, back: ctx.back || (() => ctx.go('#/')),
      route: location.hash || `#/practice/${encodeURIComponent(song.id)}`,
      ui, current: 0, mistakes: 0, missCount: 0, firstTry: 0, flash: null, hintOn: false, refresh: {},
      guard: core.createGuard(), heardIdx: new Set(), listen: null, labelShown: false, labelOpacity: 0,
      labelTimer: null, fadeRaf: 0, muteEnd: 0, lastCorrectAt: -Infinity, plays: (songRec && songRec.plays) || 0,
      accBefore, promoted: new Set(), missedKeys: new Set(), records: [], startedAt: 0, finished: false,
      introOpen: true, speed, scope, fbKind: 'neutral', fbBig: '', chord: null, unmounting: false,
      firstTimeHint: !((p.listened || {})[song.id] > 0), att: null, nextRoute: null, coldRoute: null,
    });

    // Top bar
    const stage = song.stage;
    ui.eyebrow.textContent = fromEar ? 'Practice · You know this one by ear'
      : song.generated || /^run-|^etude-/.test(song.id) ? 'Practice · Little steps'
      : stage === 'extra' ? 'Practice · Extras'
      : Number.isFinite(stage) ? `Practice · Stage ${stage}`
      : Number.isFinite(song.level) ? `Practice · Stage ${song.level + 1}` : 'Practice';
    ui.title.textContent = song.title;
    if (ctx.setTitle) ctx.setTitle(song.title);

    // Shared pieces
    ses.fb = NS.ui.feedback(ui.fbSlot);
    ses.fb.el.id = 'feedback';
    ses.micBar = NS.ui.micBar(ui.micSlot);
    const seg = NS.ui.seg([{ value: 'whole', label: 'Whole tune' }, { value: 'part', label: 'This part' }], scope, (v) => {
      ses.scope = v;
      practiceSlice().update((s) => { s.listen = Object.assign({}, s.listen, { scope: v }); return s; });
    });
    seg.setAttribute('aria-label', 'What to play');
    ui.scopeSlot.appendChild(seg);
    const width = ui.keyboard.clientWidth || root.innerWidth || 375;
    const range = NS.keyboard.rangeFor(ses.notes, { width });
    ses.range = range;
    ses.kb = NS.keyboard.create(ui.keyboard, {
      low: range.low, high: range.high,
      labels: (m) => settings().keyLabels !== false || (ses && ses.hintOn && target() && m === target().midi),
    });

    // Buttons
    ui.back.addEventListener('click', () => { stopListen(); ses.back(); });
    ui.startBtn.addEventListener('click', () => {
      NS.audio.resume();
      closeIntro();
      if (!ses.startedAt) ses.startedAt = performance.now();
      startAttempt();
      setPrompt();
      renderAll();
      ui.staff.scrollIntoView && ui.staff.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    });
    ui.hearFirst.addEventListener('click', () => { closeIntro(); startListen('whole'); });
    ui.listenBtn.addEventListener('click', () => {
      if (listenActive()) stopListen();
      else { if (ses.introOpen) closeIntro(); startListen(ses.scope); }
    });
    ui.speedBtn.addEventListener('click', () => {
      ses.speed = core.nextSpeed(ses.speed);
      practiceSlice().update((s) => { s.listen = Object.assign({}, s.listen, { speed: ses.speed }); return s; });
      renderChrome();
    });
    ui.hear.addEventListener('click', () => {
      const t = target();
      if (!t) return;
      stopListen();
      NS.audio.resume();
      const h = NS.audio.playTone(t.midi, 1.2);
      ses.att.heardNote = true;
      ses.muteEnd = Math.max(ses.muteEnd, ((h && h.endPerf) || performance.now() + 1200) + 250 + latMs());
    });
    ui.hint.addEventListener('click', () => {
      const t = target();
      if (!t) return;
      stopListen();
      ses.att.hinted = true;
      ses.hintOn = true;
      if (!ses.labelShown) showLabel(false);
      setFeedback('neutral', `It’s ${core.letterOf(t)}`, 'The green key on the keyboard below shows where it is.');
      renderAll();
    });
    ui.namesBtn.addEventListener('click', () => {
      const cur = settings().labels || 'auto';
      NS.store.setSetting('labels', core.LABELS_NEXT[cur] || 'auto'); // -> store:changed -> onSettings
    });
    ui.shapesBtn.addEventListener('click', () => {
      const cur = settings().shapes || 'auto';
      NS.store.setSetting('shapes', core.SHAPES_NEXT[cur] || 'auto');
    });
    ui.again.addEventListener('click', playAgain);
    ui.next.addEventListener('click', goNext);
    ui.list.addEventListener('click', goList);
    ui.more.addEventListener('click', goMore);
    ui.cold.addEventListener('click', () => { if (ses.coldRoute) ses.go(ses.coldRoute); });

    // Bus and input
    ses.offs = [
      NS.input.on(onInput),
      NS.bus.on('resize', () => {
        if (!ses) return;
        const r = NS.keyboard.rangeFor(ses.notes, { width: ses.ui.keyboard.clientWidth || root.innerWidth });
        if (r.low !== ses.range.low || r.high !== ses.range.high) { ses.range = r; ses.kb.setRange(r.low, r.high); }
        renderAll();
      }),
      NS.bus.on('theme', () => { if (ses) renderStaff(); }),
      NS.bus.on('visibility', ({ hidden }) => { if (hidden) stopListen(); }),
      NS.bus.on('store:changed', ({ section }) => {
        if (!ses || ses.finished) return;
        if (section === 'settings' || section === '*') { reevaluateLabel(); renderAll(); }
      }),
      NS.bus.on('note:known', ({ key }) => {
        if (!ses) return;
        ses.promoted.add(key);
        NS.ui.toast(`You know ${core.letterOfKey(key)} now. Its name will stay hidden.`);
      }),
      NS.bus.on('mic:state', () => { if (ses && ses.chord) attachChords(); }),
      NS.bus.on('midi:state', () => { if (ses && ses.chord) attachChords(); }),
    ];

    ses.logBefore = logSnapshot();
    renderIntro();
    startAttempt();
    setPrompt();
    renderAll();
  }

  function unmount() {
    if (!ses) return;
    ses.unmounting = true;
    stopListen();
    clearTimeout(ses.labelTimer);
    cancelAnimationFrame(ses.fadeRaf);
    disposeChords();
    (ses.offs || []).forEach((off) => off());
    if (ses.kb) ses.kb.destroy();
    if (ses.micBar) ses.micBar.destroy();
    ses = null;
  }

  // ---------- library hooks ----------
  function songBadge(songId) {
    const s = practiceSlice().get().songs[songId];
    if (!s || !s.best) return null;
    const stars = s.stars || core.starsFor(s.best.mistakes);
    return { text: `${starText(stars)} Practice`, tone: stars === 3 ? 'good' : 'muted', stars, plain: 'Practice' };
  }
  function songLocked(songId) {
    const song = librarySongs().find((s) => s.id === songId) || (NS.songs && NS.songs.get && NS.songs.get(songId));
    if (!song) return { locked: false };
    const level = NS.curriculum.songLevel(song);
    if (!Number.isFinite(level)) return { locked: false }; // extras are always open
    const unit = (NS.store.section('course') || {}).unit || 0;
    if (level < unit) return { locked: false };
    const UNIT_OF = NS.curriculum.UNIT_OF;
    const missing = core.songKeys(song).filter((k) => UNIT_OF[k] >= unit).sort((a, b) => UNIT_OF[a] - UNIT_OF[b]);
    return { locked: true, why: `Learn ${core.joinAnd([...new Set(missing.map(core.letterOfKey))])} to unlock` };
  }

  NS.modes.register({
    id: 'practice',
    title: 'Practice',
    blurb: 'Read at your own pace',
    order: 1,
    needsSong: true,
    mount,
    unmount,
    songBadge,
    songLocked,
    tileChip: () => null,
    debugState: () => {
      if (!ses) return null;
      const t = target();
      return {
        songId: ses.song.id, index: ses.current, mistakes: ses.mistakes, done: ses.finished, intro: ses.introOpen,
        target: t ? { midi: t.midi, key: t.key } : null, labelVisible: ses.labelShown, guard: ses.guard.active,
        listening: listenActive(), listen: ses.listen ? { from: ses.listen.from, to: ses.listen.to, scope: ses.listen.scope, playing: ses.listen.playingIdx } : null,
        heardIdx: [...ses.heardIdx], speed: ses.speed, scope: ses.scope, fromEar: ses.fromEar,
        attempt: ses.att ? Object.assign({}, ses.att) : null, records: ses.records.slice(-20),
        lastRecord: ses.records[ses.records.length - 1] || null,
      };
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
