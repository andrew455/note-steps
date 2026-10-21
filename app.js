// Note Steps: read a note on the staff, play it on a real keyboard, the mic checks it.
(function () {
  const { detectPitch, freqToMidi, midiToFreq, midiName, parseNote } = window.Pitch;

  const LESSONS = [
    {
      id: 'scale-up',
      title: 'C major scale, going up',
      blurb: 'C D E F G A B C, from middle C upward',
      notes: 'C4 D4 E4 F4 G4 A4 B4 C5:h',
    },
    {
      id: 'scale-down',
      title: 'C major scale, going down',
      blurb: 'The same eight notes, from high C back to middle C',
      notes: 'C5 B4 A4 G4 F4 E4 D4 C4:h',
    },
    {
      id: 'mary',
      title: 'Mary Had a Little Lamb',
      blurb: 'Only four notes: C, D, E and G',
      notes: 'E4 D4 C4 D4 E4 E4 E4:h D4 D4 D4:h E4 G4 G4:h E4 D4 C4 D4 E4 E4 E4 E4 D4 D4 E4 D4 C4:w',
    },
    {
      id: 'ode',
      title: 'Ode to Joy',
      blurb: 'Five notes in a row, C to G',
      notes: 'E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4 D4 D4:h E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4 C4 C4:h',
    },
    {
      id: 'twinkle',
      title: 'Twinkle Twinkle Little Star',
      blurb: 'Six notes, C to A, with a big jump',
      notes: 'C4 C4 G4 G4 A4 A4 G4:h F4 F4 E4 E4 D4 D4 C4:h G4 G4 F4 F4 E4 E4 D4:h G4 G4 F4 F4 E4 E4 D4:h C4 C4 G4 G4 A4 A4 G4:h F4 F4 E4 E4 D4 D4 C4:h',
    },
  ].map((l) => ({ ...l, notes: l.notes.split(/\s+/).map(parseNote) }));

  // ---------- storage (progress stays on this device) ----------
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

  // ---------- home ----------
  function renderHome() {
    const list = $('lessons');
    list.innerHTML = '';
    let doneCount = 0;
    LESSONS.forEach((l, i) => {
      const best = store.done[l.id];
      if (best) doneCount++;
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.className = 'lesson' + (best ? ' done' : '');
      b.innerHTML = `<span class="num">${best ? '✓' : i + 1}</span>
        <span class="meta"><strong></strong><span></span></span>
        <span class="go" aria-hidden="true">›</span>`;
      b.querySelector('strong').textContent = l.title;
      b.querySelector('.meta span').textContent = best
        ? `${l.notes.length} notes · best: ${best.mistakes === 0 ? 'no mistakes' : best.mistakes + ' mistake' + (best.mistakes === 1 ? '' : 's')}`
        : `${l.notes.length} notes · ${l.blurb}`;
      b.addEventListener('click', () => startLesson(i));
      li.appendChild(b);
      list.appendChild(li);
    });
    $('levelCount').textContent = `${doneCount} of ${LESSONS.length} done`;
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

  // ---------- lesson state ----------
  let lesson = null;
  let current = 0;
  let mistakes = 0;
  let flash = null; // { index, kind: 'good'|'bad' }
  let hintOn = false;

  function startLesson(i) {
    lesson = LESSONS[i];
    lesson.index = i;
    current = 0;
    mistakes = 0;
    flash = null;
    hintOn = false;
    $('home').hidden = true;
    $('play').hidden = false;
    $('doneOverlay').hidden = true;
    $('playEyebrow').textContent = `Lesson ${i + 1} of ${LESSONS.length}`;
    $('playTitle').textContent = lesson.title;
    setFeedback('neutral', promptText(), store.names ? 'Find it on your keyboard and play it.' : 'Use the staff to work out the note, then play it.');
    renderPlay();
    window.scrollTo(0, 0);
  }

  function promptText() {
    const n = lesson.notes[current];
    return store.names ? `Play ${n.letter}` : 'Play the blue note';
  }

  function goHome() {
    $('play').hidden = true;
    $('doneOverlay').hidden = true;
    $('home').hidden = false;
    lesson = null;
    renderHome();
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
    const nb = $('namesBtn');
    nb.textContent = `Note names: ${store.names ? 'on' : 'off'}`;
    nb.classList.toggle('on', store.names);
    nb.setAttribute('aria-pressed', String(store.names));
    renderStaff();
    renderKeyboard();
  }

  // ---------- staff drawing ----------
  const STEP = 6; // half the gap between staff lines
  const BOTTOM = 96; // y of bottom line (E4)
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
    const height = 156;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue('--ink').trim();
    const line = css.getPropertyValue('--muted').trim();
    const accent = css.getPropertyValue('--accent').trim();
    const accentSoft = css.getPropertyValue('--accent-soft').trim();
    const good = css.getPropertyValue('--good').trim();
    const bad = css.getPropertyValue('--bad').trim();
    const card = css.getPropertyValue('--card').trim();

    // highlight column behind current note
    const ci = current - start;
    if (ci >= 0 && ci < notes.length) {
      svgEl('rect', { x: left + ci * spacing - 22, y: 22, width: 44, height: 118, rx: 10, fill: flash && flash.kind === 'bad' ? css.getPropertyValue('--bad-soft').trim() : accentSoft }, svg);
    }
    for (let i = 0; i < 5; i++) {
      const y = BOTTOM - i * 2 * STEP;
      svgEl('line', { x1: 4, x2: width - 4, y1: y, y2: y, stroke: line, 'stroke-width': 1.2 }, svg);
    }
    svgEl('line', { x1: width - 4, x2: width - 4, y1: BOTTOM - 8 * STEP, y2: BOTTOM, stroke: line, 'stroke-width': 1.2 }, svg);
    const clef = svgEl('text', { x: 6, y: BOTTOM - 4, 'font-size': 76, fill: ink, 'font-family': 'Noto Music, Bravura, Apple Symbols, serif' }, svg);
    clef.textContent = '𝄞';

    notes.forEach((note, k) => {
      const idx = start + k;
      const x = left + k * spacing;
      const y = BOTTOM - note.staffPos * STEP;
      let color = ink;
      if (idx < current) color = good;
      if (idx === current) color = flash && flash.kind === 'bad' ? bad : accent;

      // ledger lines below / above the staff
      for (let p = -2; p >= note.staffPos; p -= 2) {
        const ly = BOTTOM - p * STEP;
        svgEl('line', { x1: x - 12, x2: x + 12, y1: ly, y2: ly, stroke: color, 'stroke-width': 1.4 }, svg);
      }
      for (let p = 10; p <= note.staffPos; p += 2) {
        const ly = BOTTOM - p * STEP;
        svgEl('line', { x1: x - 12, x2: x + 12, y1: ly, y2: ly, stroke: color, 'stroke-width': 1.4 }, svg);
      }
      const hollow = note.dur === 'h' || note.dur === 'w';
      svgEl('ellipse', {
        cx: x, cy: y, rx: 7.2, ry: 5.2,
        transform: `rotate(-20 ${x} ${y})`,
        fill: hollow ? card : color,
        stroke: color, 'stroke-width': hollow ? 2 : 1,
      }, svg);
      if (note.dur !== 'w') {
        if (note.staffPos < 4) svgEl('line', { x1: x + 6.4, x2: x + 6.4, y1: y - 1, y2: y - 36, stroke: color, 'stroke-width': 1.6 }, svg);
        else svgEl('line', { x1: x - 6.4, x2: x - 6.4, y1: y + 1, y2: y + 36, stroke: color, 'stroke-width': 1.6 }, svg);
      }
      if (store.names || idx < current) {
        const t = svgEl('text', {
          x, y: 150, 'text-anchor': 'middle', 'font-size': 15, 'font-weight': 700,
          fill: color, 'font-family': 'Atkinson Hyperlegible, system-ui, sans-serif',
        }, svg);
        t.textContent = note.letter;
      }
    });
    const pages = Math.ceil(lesson.notes.length / n);
    svg.setAttribute('aria-label', `Music staff, part ${page + 1} of ${pages}. Current note is ${store.names ? lesson.notes[current]?.letter : 'highlighted'}.`);
  }

  // ---------- on-screen keyboard ----------
  const WHITE = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76];
  const BLACK = [61, 63, 66, 68, 70, 73, 75];
  let heardMidi = null;
  let heardTimer = null;

  function buildKeyboard() {
    const kb = $('keyboard');
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
      const m = Number(key.dataset.midi);
      playTone(m, 0.9);
      handleNote(m);
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
  }

  function showHeard(m) {
    heardMidi = m;
    clearTimeout(heardTimer);
    heardTimer = setTimeout(() => { heardMidi = null; if (lesson) renderKeyboard(); }, 1400);
  }

  // ---------- judging a played note ----------
  let finished = false;
  function handleNote(midi) {
    if (!lesson || current >= lesson.notes.length || !$('doneOverlay').hidden) return;
    const target = lesson.notes[current];
    // Fold the heard note into the keyboard's range so it can be shown.
    let shown = midi;
    while (shown < 60) shown += 12;
    while (shown > 76) shown -= 12;
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
    const prev = store.done[lesson.id];
    if (!prev || mistakes < prev.mistakes) store.done[lesson.id] = { mistakes, at: Date.now() };
    saveStore();
    const stars = mistakes === 0 ? 3 : mistakes <= 3 ? 2 : 1;
    $('doneStars').textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
    $('doneTitle').textContent = mistakes === 0 ? 'Perfect!' : 'Well played!';
    $('doneText').textContent = `You played all ${lesson.notes.length} notes of ${lesson.title}` +
      (mistakes === 0 ? ' without a single mistake.' : ` with ${mistakes} wrong note${mistakes === 1 ? '' : 's'} along the way.`);
    const hasNext = lesson.index + 1 < LESSONS.length;
    $('nextBtn').hidden = !hasNext;
    $('doneOverlay').hidden = false;
    setFeedback('good', 'Lesson complete!', '');
    playTone(lesson.notes[0].midi + 12, 0.3, 0.05);
  }

  // ---------- sound ----------
  let ctx = null;
  let muteUntil = 0;
  function audio() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
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

  // ---------- microphone listening ----------
  let listening = false;
  let analyser = null;
  let buf = null;
  let stream = null;
  let wakeLock = null;
  let timer = null;

  async function startMic() {
    const notice = $('micNotice');
    notice.hidden = true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      notice.hidden = false;
      notice.textContent = 'This browser can’t use the microphone here. The page needs to be opened from a secure https:// link. You can still tap the on-screen keys.';
      return;
    }
    try {
      const ac = audio();
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const src = ac.createMediaStreamSource(stream);
      analyser = ac.createAnalyser();
      analyser.fftSize = 2048;
      src.connect(analyser);
      buf = new Float32Array(analyser.fftSize);
      listening = true;
      $('micBtn').textContent = '🎤 Listening… (tap to stop)';
      $('micBtn').classList.remove('primary');
      $('micBtn').classList.add('on');
      $('meter').hidden = false;
      try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
      clearInterval(timer);
      timer = setInterval(tick, 25);
    } catch (err) {
      notice.hidden = false;
      notice.textContent = err && err.name === 'NotAllowedError'
        ? 'Microphone access was blocked. Allow the microphone for this site in your browser settings, then tap Start listening again.'
        : 'Couldn’t start the microphone: ' + (err && err.message ? err.message : err);
    }
  }

  function stopMic() {
    listening = false;
    clearInterval(timer);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    try { wakeLock && wakeLock.release(); } catch {}
    wakeLock = null;
    $('micBtn').textContent = '🎤 Start listening';
    $('micBtn').classList.add('primary');
    $('micBtn').classList.remove('on');
    $('meter').hidden = true;
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
    $('meterBar').style.width = Math.min(100, rms * 900) + '%';
    const now = performance.now();

    floor += (rms - floor) * (rms < floor ? 0.3 : 0.002);
    const gate = Math.max(0.008, floor * 3);
    const before = rmsHist.length >= 4 ? rmsHist[rmsHist.length - 4] : 0;
    rmsHist.push(rms);
    if (rmsHist.length > 12) rmsHist.shift();

    if (now < muteUntil) { pending = null; quiet = false; return; }

    const onset = rms > gate && now - lastOnset > 160 && (quiet || rms > before * 1.8);
    if (onset) { pending = { t: now, votes: [] }; lastOnset = now; quiet = false; }
    else if (rms < gate * 0.6) quiet = true;

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
        const m = v[v.length - 1];
        pending = null;
        handleNote(m);
        return;
      }
    }
    if (age > 500) {
      const v = pending.votes;
      pending = null;
      if (v.length >= 2) {
        const counts = {};
        v.forEach((x) => (counts[x] = (counts[x] || 0) + 1));
        const [best, c] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        if (c >= 2) handleNote(Number(best));
      }
    }
  }

  // ---------- wiring ----------
  $('backBtn').addEventListener('click', goHome);
  $('listBtn').addEventListener('click', goHome);
  $('againBtn').addEventListener('click', () => startLesson(lesson.index));
  $('nextBtn').addEventListener('click', () => startLesson(lesson.index + 1));
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
  $('namesBtn').addEventListener('click', () => {
    store.names = !store.names;
    saveStore();
    if (lesson && current < lesson.notes.length && !flash) setFeedback('neutral', promptText(), '');
    renderPlay();
  });
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => lesson && renderStaff(), 120);
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => lesson && renderStaff());
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && listening) {
      try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
    }
  });

  buildKeyboard();
  renderHeroNotes();
  renderHome();
  renderQr();
})();
