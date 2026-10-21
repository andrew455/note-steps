// Note Steps core: home screen, Practice mode, the microphone listener, sound and staff drawing.
// Other modes (perform.js, ...) plug in through window.NoteSteps; see "MODE HOOKS" below.
(function () {
  const { detectPitch, freqToMidi, midiToFreq, midiName } = window.Pitch;
  const { songs, levels } = window.NoteSongs;
  const LESSONS = songs;

  // ---------- storage (progress stays on this device) ----------
  // One shared object; modes add their own keys to it (never replace it) and call saveStore().
  const STORE_KEY = 'note-steps-v1';
  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
  }
  function saveStore() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch {}
  }
  const store = Object.assign({ done: {}, names: true }, loadStore());

  const $ = (id) => document.getElementById(id);
  const SVGNS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs, parent) {
    const el = document.createElementNS(SVGNS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  }
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const starText = (s) => '★'.repeat(s) + '☆'.repeat(3 - s);

  // ======================================================================
  // MODE HOOKS
  // A mode is { id, label, primary?, start(songIndex), stop(), passed?(song), played?(song),
  //             cardLine?(song) -> { stars?, text } | null, onNamesChange?(), onResize?(), onHidden?() }.
  // Its buttons appear on every unlocked song card. start() shows its screen with showScreen() and
  // takes mic notes with setNoteHandler().
  // ======================================================================
  const modes = [];
  let activeMode = null;
  let ready = false;

  function registerMode(mode) {
    modes.push(mode);
    if (ready && !$('home').hidden) renderHome();
  }
  function startMode(id, index) {
    const mode = modes.find((m) => m.id === id);
    if (!mode) return;
    stopActiveMode();
    activeMode = mode;
    mode.start(index);
  }
  function stopActiveMode() {
    if (activeMode && activeMode.stop) activeMode.stop();
    activeMode = null;
    noteHandler = null;
  }
  function goHome() {
    stopActiveMode();
    showScreen('home');
    renderHome();
  }
  // Shows one <main class="screen"> and hides the rest, along with any open dialog.
  function showScreen(id) {
    document.querySelectorAll('main.screen').forEach((s) => (s.hidden = s.id !== id));
    document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true));
    window.scrollTo(0, 0);
  }

  // ---------- progress and unlocks ----------
  function passed(song) {
    return Boolean(store.done[song.id]) || modes.some((m) => m.passed && m.passed(song));
  }
  function played(song) {
    return Boolean(store.done[song.id]) || modes.some((m) => m.played && m.played(song));
  }
  // Songs open in order: finish the one before (in Practice, or with 2 stars in Perform).
  // A song you've already played stays open even if you skipped ahead in an older version.
  function isUnlocked(i) {
    return i === 0 || passed(LESSONS[i - 1]) || played(LESSONS[i]);
  }

  // ---------- home ----------
  const LOCK_SVG = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M4 7V5a4 4 0 1 1 8 0v2h.5A1.5 1.5 0 0 1 14 8.5v5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5v-5A1.5 1.5 0 0 1 3.5 7H4zm1.8 0h4.4V5a2.2 2.2 0 1 0-4.4 0v2z"/></svg>';

  function renderHome() {
    const root = $('levels');
    root.innerHTML = '';
    levels.forEach((lv, li) => {
      const inLevel = LESSONS.filter((l) => l.level === li);
      if (!inLevel.length) return;
      const section = document.createElement('section');
      section.className = 'level';
      const head = document.createElement('div');
      head.className = 'level-head';
      const h2 = document.createElement('h2');
      h2.textContent = lv.title;
      const cnt = document.createElement('span');
      cnt.className = 'muted';
      cnt.textContent = `${inLevel.filter(played).length} of ${inLevel.length} played`;
      head.append(h2, cnt);
      const list = document.createElement('ul');
      list.className = 'lessons';
      inLevel.forEach((l) => list.appendChild(lessonCard(l)));
      section.append(head, list);
      root.appendChild(section);
    });
  }

  function lessonCard(l) {
    const i = l.index;
    const unlocked = isUnlocked(i);
    const practice = store.done[l.id];
    const li = document.createElement('li');
    li.className = 'lesson' + (passed(l) ? ' done' : '') + (unlocked ? '' : ' locked');
    li.innerHTML = `<span class="num"></span>
      <div class="meta"><strong></strong><span class="sub"></span></div>
      <div class="actions"></div>`;
    const num = li.querySelector('.num');
    if (!unlocked) { num.innerHTML = LOCK_SVG; num.setAttribute('aria-label', 'Locked'); }
    else num.textContent = passed(l) ? '✓' : i + 1;
    li.querySelector('strong').textContent = l.title;
    const meta = li.querySelector('.meta');
    const sub = li.querySelector('.sub');
    if (!unlocked) {
      sub.textContent = `Locked. Finish “${LESSONS[i - 1].title}” in Practice, or get 2 stars performing it.`;
      li.querySelector('.actions').remove();
      return li;
    }
    sub.textContent = practice
      ? `${l.notes.length} notes · Practice best: ${practice.mistakes === 0 ? 'no mistakes' : practice.mistakes + ' mistake' + (practice.mistakes === 1 ? '' : 's')}`
      : `${l.notes.length} notes · ${l.blurb}`;
    modes.forEach((m) => {
      const line = m.cardLine && m.cardLine(l);
      if (!line) return;
      const row = document.createElement('span');
      row.className = 'mode-line';
      if (line.stars != null) {
        const st = document.createElement('span');
        st.className = 'stars-sm';
        st.textContent = starText(line.stars) + ' ';
        st.setAttribute('aria-label', `${line.stars} of 3 stars. `);
        row.appendChild(st);
      }
      row.appendChild(document.createTextNode(line.text));
      meta.appendChild(row);
    });
    const actions = li.querySelector('.actions');
    modes.forEach((m) => {
      const b = document.createElement('button');
      b.className = 'btn small' + (m.primary ? ' primary' : '');
      b.textContent = m.label;
      b.setAttribute('aria-label', `${m.label} ${l.title}`);
      b.addEventListener('click', () => startMode(m.id, i));
      actions.appendChild(b);
    });
    return li;
  }

  function renderHeroNotes() {
    const g = $('heroNotes');
    const scale = LESSONS[0].notes;
    scale.forEach((n, i) => {
      const x = 80 + i * 34;
      const y = 68 - n.staffPos * 6;
      if (n.staffPos <= -2) svgEl('line', { x1: x - 11, x2: x + 11, y1: 80, y2: 80, stroke: 'currentColor', 'stroke-width': 1.2, opacity: 0.55 }, g);
      svgEl('ellipse', { cx: x, cy: y, rx: 7, ry: 5, transform: `rotate(-20 ${x} ${y})` }, g);
    });
  }

  function renderQr() {
    const onPhone = window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 820;
    const url = location.href.split('#')[0];
    const isLocal = /^(localhost|127\.|\[::1\])/.test(location.hostname) || location.protocol === 'file:';
    if (onPhone || typeof QRCode === 'undefined') return;
    $('qrBox').hidden = false;
    $('qrUrl').textContent = url;
    new QRCode($('qrCode'), { text: url, width: 240, height: 240, correctLevel: QRCode.CorrectLevel.M });
    if (isLocal) {
      $('qrUrl').textContent = url + ' (this is a local test address, so a phone can’t open it yet; once the app is online this code will work)';
    }
  }

  // ---------- drawing a note (shared by every mode) ----------
  const STEP = 6; // half the gap between staff lines
  const BOTTOM = 96; // y of bottom line (E4)

  // Draws one note in currentColor; the caller sets the color on `parent`.
  function drawNote(parent, x, note, showName) {
    const y = BOTTOM - note.staffPos * STEP;
    for (let p = -2; p >= note.staffPos; p -= 2) {
      const ly = BOTTOM - p * STEP;
      svgEl('line', { x1: x - 12, x2: x + 12, y1: ly, y2: ly, stroke: 'currentColor', 'stroke-width': 1.4 }, parent);
    }
    for (let p = 10; p <= note.staffPos; p += 2) {
      const ly = BOTTOM - p * STEP;
      svgEl('line', { x1: x - 12, x2: x + 12, y1: ly, y2: ly, stroke: 'currentColor', 'stroke-width': 1.4 }, parent);
    }
    const kind = note.dur[0];
    const hollow = kind === 'h' || kind === 'w';
    const head = svgEl('ellipse', {
      cx: x, cy: y, rx: 7.2, ry: 5.2,
      transform: `rotate(-20 ${x} ${y})`,
      stroke: 'currentColor', 'stroke-width': hollow ? 2 : 1,
    }, parent);
    head.style.fill = hollow ? 'var(--card)' : 'currentColor';
    if (kind !== 'w') {
      const up = note.staffPos < 4;
      const sx = up ? x + 6.4 : x - 6.4;
      const tip = up ? y - 36 : y + 36;
      svgEl('line', { x1: sx, x2: sx, y1: up ? y - 1 : y + 1, y2: tip, stroke: 'currentColor', 'stroke-width': 1.6 }, parent);
      const flags = kind === 'e' ? 1 : kind === 's' ? 2 : 0;
      for (let f = 0; f < flags; f++) {
        const fy = up ? tip + f * 7 : tip - f * 7;
        const d = up
          ? `M${sx} ${fy} c1 6 9 9 8 18 c-1-6-5-9-8-10 z`
          : `M${sx} ${fy} c1-6 9-9 8-18 c-1 6-5 9-8 10 z`;
        const flag = svgEl('path', { d, stroke: 'currentColor', 'stroke-width': 1 }, parent);
        flag.style.fill = 'currentColor';
      }
    }
    if (note.dur.endsWith('.')) {
      const dotY = note.staffPos % 2 === 0 ? y - STEP : y;
      const dot = svgEl('circle', { cx: x + 12, cy: dotY, r: 2.2 }, parent);
      dot.style.fill = 'currentColor';
    }
    if (showName) {
      const t = svgEl('text', {
        x, y: 150, 'text-anchor': 'middle', 'font-size': 15, 'font-weight': 700,
        'font-family': 'Atkinson Hyperlegible, system-ui, sans-serif',
      }, parent);
      t.style.fill = 'currentColor';
      t.textContent = note.letter;
    }
  }
  // How far a drawn note reaches to the right of its x (flags and dots stick out).
  function noteRightEdge(note) {
    const flagged = (note.dur[0] === 'e' || note.dur[0] === 's') && note.staffPos < 4;
    return note.dur.endsWith('.') ? 15 : flagged ? 16 : 8;
  }

  function drawStaffLines(svg, x1, x2) {
    for (let i = 0; i < 5; i++) {
      const y = BOTTOM - i * 2 * STEP;
      const l = svgEl('line', { x1, x2, y1: y, y2: y, 'stroke-width': 1.2 }, svg);
      l.style.stroke = 'var(--muted)';
    }
    const clef = svgEl('text', { x: 6, y: BOTTOM - 4, 'font-size': 76, 'font-family': 'Noto Music, Bravura, Apple Symbols, serif' }, svg);
    clef.style.fill = 'var(--ink)';
    clef.textContent = '𝄞';
  }

  // ======================================================================
  // PRACTICE MODE (untimed: waits for each note)
  // ======================================================================
  let lesson = null;
  let current = 0;
  let mistakes = 0;
  let flash = null; // { kind: 'bad' } after a wrong note
  let hintOn = false;

  function startLesson(i) {
    lesson = LESSONS[i];
    current = 0;
    mistakes = 0;
    flash = null;
    hintOn = false;
    showScreen('play');
    setNoteHandler((midi) => handleNote(midi));
    $('playEyebrow').textContent = `Practice · lesson ${i + 1} of ${LESSONS.length}`;
    $('playTitle').textContent = lesson.title;
    setFeedback('neutral', promptText(), store.names ? 'Find it on your keyboard and play it.' : 'Use the staff to work out the note, then play it.');
    renderPlay();
  }

  function promptText() {
    const n = lesson.notes[current];
    return store.names ? `Play ${n.letter}` : 'Play the blue note';
  }

  function setFeedback(kind, big, small) {
    const fb = $('feedback');
    fb.className = 'feedback' + (kind === 'good' ? ' good' : kind === 'bad' ? ' bad' : '');
    $('fbBig').textContent = big;
    $('fbSmall').textContent = small || '';
  }

  function renderPlay() {
    $('count').textContent = `${Math.min(current + 1, lesson.notes.length)} / ${lesson.notes.length}`;
    $('progressBar').style.width = (100 * current) / lesson.notes.length + '%';
    updateNamesButtons();
    renderStaff();
    renderKeyboard();
  }

  function perPage() {
    const w = $('staff').parentElement.clientWidth || 360;
    return Math.max(4, Math.min(10, Math.floor((w - 60) / 44)));
  }

  function renderStaff() {
    const svg = $('staff');
    svg.innerHTML = '';
    const n = perPage();
    const page = Math.floor(current / n);
    const start = page * n;
    const notes = lesson.notes.slice(start, start + n);
    const spacing = 52;
    const left = 74;
    const width = left + n * spacing + 10;
    svg.setAttribute('viewBox', `0 0 ${width} 156`);

    // highlight column behind current note
    const ci = current - start;
    if (ci >= 0 && ci < notes.length) {
      const r = svgEl('rect', { x: left + ci * spacing - 22, y: 22, width: 44, height: 118, rx: 10 }, svg);
      r.style.fill = flash && flash.kind === 'bad' ? 'var(--bad-soft)' : 'var(--accent-soft)';
    }
    drawStaffLines(svg, 4, width - 4);
    const end = svgEl('line', { x1: width - 4, x2: width - 4, y1: BOTTOM - 8 * STEP, y2: BOTTOM, 'stroke-width': 1.2 }, svg);
    end.style.stroke = 'var(--muted)';

    notes.forEach((note, k) => {
      const idx = start + k;
      let color = 'var(--ink)';
      if (idx < current) color = 'var(--good)';
      if (idx === current) color = flash && flash.kind === 'bad' ? 'var(--bad)' : 'var(--accent)';
      const g = svgEl('g', {}, svg);
      g.style.color = color;
      drawNote(g, left + k * spacing, note, store.names || idx < current);
    });
    const pages = Math.ceil(lesson.notes.length / n);
    svg.setAttribute('aria-label', `Music staff, part ${page + 1} of ${pages}. Current note is ${store.names ? lesson.notes[current]?.letter : 'highlighted'}.`);
  }

  // ---------- on-screen keyboards (one per screen) ----------
  const WHITE = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76];
  const BLACK = [61, 63, 66, 68, 70, 73, 75];
  let heardMidi = null;
  let heardTimer = null;

  // onKey(midi, pointerEvent) runs when a key is pressed.
  function buildKeyboard(kb, onKey) {
    kb.innerHTML = '';
    const w = 100 / WHITE.length;
    WHITE.forEach((m, i) => {
      const k = document.createElement('button');
      k.className = 'white' + (m === 60 ? ' middle-c' : '');
      k.style.left = i * w + '%';
      k.style.width = w + '%';
      k.dataset.midi = m;
      k.textContent = midiName(m);
      k.setAttribute('aria-label', midiName(m) + (m === 60 ? ' (middle C)' : ''));
      kb.appendChild(k);
    });
    BLACK.forEach((m) => {
      const whiteBelow = WHITE.indexOf(m - 1);
      const k = document.createElement('button');
      k.className = 'black';
      k.style.left = (whiteBelow + 1) * w - w * 0.3 + '%';
      k.style.width = w * 0.6 + '%';
      k.dataset.midi = m;
      k.setAttribute('aria-label', midiName(m));
      kb.appendChild(k);
    });
    kb.addEventListener('pointerdown', (e) => {
      const key = e.target.closest('[data-midi]');
      if (!key) return;
      e.preventDefault();
      onKey(Number(key.dataset.midi), e);
    });
  }

  function renderKeyboard() {
    const target = lesson ? lesson.notes[current] : null;
    document.querySelectorAll('#keyboard [data-midi]').forEach((k) => {
      const m = Number(k.dataset.midi);
      k.classList.toggle('heard', m === heardMidi);
      k.classList.toggle('hint', hintOn && target && m === target.midi && m !== heardMidi);
      if (k.classList.contains('white')) k.textContent = store.names || (hintOn && target && m === target.midi) ? midiName(m) : '';
    });
    document.querySelectorAll('.keyboard:not(#keyboard) [data-midi]').forEach((k) => {
      const m = Number(k.dataset.midi);
      k.classList.toggle('heard', m === heardMidi);
      if (k.classList.contains('white')) k.textContent = store.names ? midiName(m) : '';
    });
  }

  // Moves a note into the on-screen keyboard's range (C4 to E5) so it can be shown.
  function foldToKeyboard(m) {
    while (m < 60) m += 12;
    while (m > 76) m -= 12;
    return m;
  }

  function showHeard(m) {
    heardMidi = m;
    clearTimeout(heardTimer);
    heardTimer = setTimeout(() => { heardMidi = null; renderKeyboard(); }, 1400);
    renderKeyboard();
  }

  // ---------- judging a played note (practice) ----------
  function handleNote(midi) {
    if (!lesson || current >= lesson.notes.length || !$('doneOverlay').hidden) return;
    const target = lesson.notes[current];
    const shown = foldToKeyboard(midi);
    showHeard(shown);

    if (((midi - target.midi) % 12 + 12) % 12 === 0) {
      current++;
      flash = null;
      hintOn = false;
      if (current >= lesson.notes.length) {
        renderPlay();
        finishLesson();
        return;
      }
      const praise = ['Yes!', 'Nice!', 'Right!', 'Good!', 'Spot on!'][current % 5];
      setFeedback('good', `${praise} That was ${target.letter}.`, store.names ? `Next: play ${lesson.notes[current].letter}.` : 'Now read the next blue note.');
    } else {
      mistakes++;
      flash = { kind: 'bad' };
      setFeedback('bad', `You played ${midiName(midi)}. Try again.`, store.names
        ? `The note on the staff is ${target.letter}. ${target.midi > shown ? 'It’s further to the right.' : 'It’s further to the left.'}`
        : 'Count the lines and spaces, or tap “Show me the key”.');
    }
    renderPlay();
  }

  function finishLesson() {
    const nextIdx = lesson.index + 1;
    const wasUnlocked = nextIdx < LESSONS.length && isUnlocked(nextIdx);
    const prev = store.done[lesson.id];
    if (!prev || mistakes < prev.mistakes) store.done[lesson.id] = { mistakes, at: Date.now() };
    saveStore();
    const stars = mistakes === 0 ? 3 : mistakes <= 3 ? 2 : 1;
    $('doneStars').textContent = starText(stars);
    $('doneTitle').textContent = mistakes === 0 ? 'Perfect!' : 'Well played!';
    let text = `You played all ${lesson.notes.length} notes of ${lesson.title}` +
      (mistakes === 0 ? ' without a single mistake.' : ` with ${mistakes} wrong note${mistakes === 1 ? '' : 's'} along the way.`);
    if (!wasUnlocked && nextIdx < LESSONS.length) text += ` You’ve unlocked ${LESSONS[nextIdx].title}.`;
    $('doneText').textContent = text;
    $('nextBtn').hidden = nextIdx >= LESSONS.length;
    $('doneOverlay').hidden = false;
    setFeedback('good', 'Lesson complete!', '');
    playTone(lesson.notes[0].midi + 12, 0.3, 0.05);
  }

  modes.push({
    id: 'practice',
    label: 'Practice',
    start: startLesson,
    stop() { lesson = null; },
    onNamesChange() { if (lesson) { if (current < lesson.notes.length && !flash) setFeedback('neutral', promptText(), ''); renderPlay(); } },
    onResize() { if (lesson) renderStaff(); },
  });

  // ======================================================================
  // SOUND
  // ======================================================================
  let ctx = null; // the one AudioContext, shared by every mode (NoteSteps.audioContext())
  let muteUntil = 0;
  function audio() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  // How long between the audio clock and the sound leaving the speaker.
  function outLatency() {
    const ac = audio();
    const v = ac.outputLatency || ac.baseLatency || 0;
    return Math.min(0.25, Math.max(0, v));
  }
  // Audio-clock time of the sound reaching your ears at page time `perfMs` (default: now).
  function heardAt(perfMs = performance.now()) {
    const ac = audio();
    const ts = ac.getOutputTimestamp ? ac.getOutputTimestamp() : null;
    if (ts && ts.performanceTime > 0 && ts.contextTime > 0) return ts.contextTime + (perfMs - ts.performanceTime) / 1000;
    return ac.currentTime - outLatency() + (perfMs - performance.now()) / 1000;
  }
  function playTone(midi, dur = 1.2, delay = 0) {
    const ac = audio();
    const t = ac.currentTime + delay;
    const f = midiToFreq(midi);
    const out = ac.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    out.connect(ac.destination);
    [[1, 0.6, 'triangle'], [2, 0.18, 'sine'], [3, 0.06, 'sine']].forEach(([h, g, type]) => {
      const o = ac.createOscillator();
      const og = ac.createGain();
      o.type = type;
      o.frequency.value = f * h;
      og.gain.value = g;
      o.connect(og).connect(out);
      o.start(t);
      o.stop(t + dur + 0.05);
    });
    // Don't let the mic judge our own speaker.
    muteUntil = Math.max(muteUntil, performance.now() + (delay + dur) * 1000 + 200);
  }
  // Metronome click at audio-clock time t: a short high pip. The mic path low-passes below 1.4 kHz,
  // so clicks aren't heard as notes. Returns the oscillator so a caller can cancel it with .stop().
  function click(t, accent, freq) {
    const ac = audio();
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'sine';
    o.frequency.value = freq || (accent ? 4200 : 3300);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(accent ? 0.45 : 0.28, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    o.connect(g).connect(ac.destination);
    o.start(t);
    o.stop(t + 0.06);
    return o;
  }

  // ======================================================================
  // MICROPHONE LISTENING
  // Notes go to the handler set with setNoteHandler(fn): fn(midi, at, timeMs), where `at` is the
  // onset in audio-clock seconds and `timeMs` the same moment in page time (performance.now()).
  // ======================================================================
  let listening = false;
  let analyser = null;
  let micSource = null; // MediaStreamSource for the mic (NoteSteps.micSource()); other modes may attach to it
  let buf = null;
  let stream = null;
  let wakeLock = null;
  let timer = null;
  let micStarting = null;
  let noteHandler = null;

  function setNoteHandler(fn) {
    noteHandler = fn || null;
  }

  // Shows (or clears) the microphone message on every screen that has a [data-mic-notice].
  function micNotice(text) {
    document.querySelectorAll('[data-mic-notice]').forEach((el) => {
      el.hidden = !text;
      el.textContent = text || '';
    });
  }

  function updateMicUi() {
    const b = $('micBtn');
    b.textContent = listening ? '🎤 Listening… (tap to stop)' : '🎤 Start listening';
    b.classList.toggle('primary', !listening);
    b.classList.toggle('on', listening);
    document.querySelectorAll('[data-mic-meter-wrap]').forEach((el) => (el.hidden = !listening));
  }

  // Resolves true once listening. Calls made while the permission prompt is open share one request.
  function startMic() {
    if (listening) return Promise.resolve(true);
    if (!micStarting) micStarting = openMic().finally(() => { micStarting = null; });
    return micStarting;
  }

  async function openMic() {
    micNotice('');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      micNotice('This browser can’t use the microphone here. The page needs to be opened from a secure https:// link. You can still tap the on-screen keys.');
      return false;
    }
    try {
      const ac = audio();
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      micSource = ac.createMediaStreamSource(stream);
      // Two low-pass stages: piano notes pass, the metronome's high clicks don't.
      const lp1 = ac.createBiquadFilter();
      const lp2 = ac.createBiquadFilter();
      [lp1, lp2].forEach((f) => { f.type = 'lowpass'; f.frequency.value = 1400; f.Q.value = 0.707; });
      analyser = ac.createAnalyser();
      analyser.fftSize = 2048;
      micSource.connect(lp1).connect(lp2).connect(analyser);
      buf = new Float32Array(analyser.fftSize);
      listening = true;
      updateMicUi();
      try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
      clearInterval(timer);
      timer = setInterval(tick, 25);
      return true;
    } catch (err) {
      micNotice(err && err.name === 'NotAllowedError'
        ? 'Microphone access was blocked. Allow the microphone for this site in your browser settings, then try again. You can still tap the on-screen keys.'
        : 'Couldn’t start the microphone (' + (err && err.message ? err.message : err) + '). You can still tap the on-screen keys.');
      return false;
    }
  }

  function stopMic() {
    listening = false;
    clearInterval(timer);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    if (micSource) { try { micSource.disconnect(); } catch {} }
    micSource = null;
    try { wakeLock && wakeLock.release(); } catch {}
    wakeLock = null;
    updateMicUi();
  }

  // Finds where the attack starts inside the analyser buffer, as an audio-clock time.
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
    let k = pk;
    while (k > 0 && e[k - 1] > thr) k--;
    return now - (data.length - k * B) / sr;
  }

  // Onset + pitch: each new key press is judged once, so repeated notes (E E E) count separately.
  const rmsHist = [];
  let floor = 0.002;
  let quiet = true;
  let lastOnset = 0;
  let pending = null;

  function tick() {
    if (!listening) return;
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    const w = Math.min(100, rms * 900) + '%';
    document.querySelectorAll('[data-mic-meter]').forEach((el) => (el.style.width = w));
    const now = performance.now();

    floor += (rms - floor) * (rms < floor ? 0.3 : 0.002);
    const gate = Math.max(0.008, floor * 3);
    const before = rmsHist.length >= 4 ? rmsHist[rmsHist.length - 4] : 0;
    rmsHist.push(rms);
    if (rmsHist.length > 12) rmsHist.shift();

    if (now < muteUntil) { pending = null; quiet = false; return; }

    const onset = rms > gate && now - lastOnset > 110 && (quiet || rms > before * 1.7);
    if (onset) {
      const ctxNow = analyser.context.currentTime;
      const at = refineOnset(buf, analyser.context.sampleRate, ctxNow);
      pending = { t: now, at, atMs: now - (ctxNow - at) * 1000, votes: [] };
      lastOnset = now;
      quiet = false;
    } else if (rms < gate * 0.6) quiet = true;

    if (!pending) return;
    const age = now - pending.t;
    if (age > 35) {
      const f = detectPitch(buf, analyser.context.sampleRate, 70, 1400);
      if (f) {
        const m = freqToMidi(f);
        const r = Math.round(m);
        if (Math.abs(m - r) < 0.4) pending.votes.push(r);
      }
      const v = pending.votes;
      if (v.length >= 3 && v[v.length - 1] === v[v.length - 2] && v[v.length - 2] === v[v.length - 3]) {
        const p = pending;
        pending = null;
        heard(v[v.length - 1], p);
        return;
      }
    }
    if (age > 500) {
      const p = pending;
      const v = p.votes;
      pending = null;
      if (v.length >= 2) {
        const counts = {};
        v.forEach((x) => (counts[x] = (counts[x] || 0) + 1));
        const [best, c] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        if (c >= 2) heard(Number(best), p);
      }
    }
  }

  function heard(midi, p) {
    if (noteHandler) noteHandler(midi, p.at, p.atMs);
  }

  // ---------- names toggle (any button with data-names-toggle) ----------
  function updateNamesButtons() {
    document.querySelectorAll('[data-names-toggle]').forEach((nb) => {
      nb.textContent = `Note names: ${store.names ? 'on' : 'off'}`;
      nb.classList.toggle('on', store.names);
      nb.setAttribute('aria-pressed', String(store.names));
    });
  }
  function toggleNames() {
    store.names = !store.names;
    saveStore();
    updateNamesButtons();
    renderKeyboard();
    if (activeMode && activeMode.onNamesChange) activeMode.onNamesChange();
  }

  // ======================================================================
  // PUBLIC API for other modes (perform.js and future ones)
  // ======================================================================
  const debug = {};
  window.NoteSteps = {
    songs: LESSONS, levels, store, saveStore,
    $, svgEl, fmt, starText,
    STEP, BOTTOM, drawNote, drawStaffLines, noteRightEdge,
    audio, audioContext: audio, heardAt, outLatency, playTone, click,
    startMic, stopMic, isListening: () => listening, micSource: () => micSource, analyser: () => analyser,
    setNoteHandler, micNotice,
    buildKeyboard, renderKeyboard, showHeard, foldToKeyboard,
    registerMode, startMode, goHome, showScreen, renderHome, isUnlocked, passed, played,
    updateNamesButtons, toggleNames,
    debug,
  };

  // ======================================================================
  // WIRING
  // ======================================================================
  $('backBtn').addEventListener('click', goHome);
  $('listBtn').addEventListener('click', goHome);
  $('againBtn').addEventListener('click', () => startMode('practice', lesson.index));
  $('nextBtn').addEventListener('click', () => startMode('practice', lesson.index + 1));
  $('micBtn').addEventListener('click', () => (listening ? stopMic() : startMic()));
  $('hearBtn').addEventListener('click', () => {
    if (!lesson || current >= lesson.notes.length) return;
    playTone(lesson.notes[current].midi, 1.2);
  });
  $('hintBtn').addEventListener('click', () => {
    hintOn = true;
    renderKeyboard();
    const t = lesson.notes[current];
    setFeedback('neutral', `It’s ${t.letter}`, 'The green key on the keyboard below shows where it is.');
  });
  buildKeyboard($('keyboard'), (m) => {
    playTone(m, 0.9);
    handleNote(m);
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => activeMode && activeMode.onResize && activeMode.onResize(), 120);
  });
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden' && activeMode && activeMode.onHidden) activeMode.onHidden();
    if (document.visibilityState === 'visible' && listening) {
      try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
    }
  });

  // Mode scripts load after this file, so the home screen is drawn once they've all registered.
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-names-toggle]').forEach((b) => b.addEventListener('click', toggleNames));
    ready = true;
    renderHeroNotes();
    renderHome();
    renderQr();
  });
})();
