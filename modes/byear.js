// Play by Ear mode (spec §7.2). #/byear lists every song; #/byear/:songId runs one song in 4 steps:
//   Listen    the key, time signature and first note only (the tune is not shown); it plays once.
//   Practise  free play on a live scrolling staff, with a gentle countdown ring. Nothing is scored.
//   Real take recording from memory (the staff is hidden), started by the C chord, ended by G.
//   Compare   your take and the real song on one staff, column by column (NS.ByEar.align).
// Chord commands (§7.1) are shown on every step through window.ChordBar when it renders a bar,
// otherwise through plain buttons with the same labels. Logic that can be tested lives in
// modes/byear-core.js. Saved in slices.byear = {best:{[id]:{pct, at}}, practiceSecs, speed}.
(function (root) {
  const NS = root.NS;
  const B = NS.ByEar;
  const { svgEl } = NS.util;

  const STEPS = [['listen', 'Listen'], ['practise', 'Practise'], ['take', 'Real take'], ['compare', 'Compare']];
  const CHORD_ORDER = ['C', 'Cm', 'G'];
  const CHORD_KEYS = { C: [60, 64, 67], Cm: [60, 63, 67], G: [67, 71, 74] };
  const COMFORT = {
    easy: ['Easy', 'good'], right: ['Just right', 'good'], stretch: ['Stretch', 'learn'],
    tough: ['Tough', 'learn'], locked: ['Stretch', 'learn'], // nothing is locked here (§7.2)
  };
  const TIMER_OPTIONS = [{ value: 60, label: '1 min' }, { value: 120, label: '2 min' }, { value: 300, label: '5 min' }, { value: 0, label: 'Off' }];
  const SPEED_OPTIONS = [{ value: 0.75, label: '75%' }, { value: 1, label: '100%' }];
  const REFRACTORY_MS = 800; // after an action, a ringing chord can't trigger again
  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

  // Staff geometry shared with the other reading screens (§2.4.7).
  const STEP = 6;
  const BOTTOM = 108;
  const LEFT = 74;
  const SPACING = 52;

  // ======================================================================
  // SONGS AND SAVED DATA
  // ======================================================================
  function library() {
    const all = (NS.songs && NS.songs.all ? NS.songs.all() : root.NoteSongs.songs) || [];
    return all.slice().sort((a, b) => (levelOf(a) - levelOf(b)) || (a.index - b.index));
  }
  const levelOf = (s) => (Number.isFinite(s.level) ? s.level : 99);
  function findSong(id) {
    if (!id) return null;
    return library().find((s) => s.id === id) || null;
  }
  const songMidis = (song) => song.notes.map((n) => n.midi);
  const accOf = (n) => (n.acc === '#' || n.acc === '♯' ? '#' : n.acc === 'b' || n.acc === '♭' ? 'b' : '');
  const nameOf = (n) => n.letter + (accOf(n) === '#' ? '♯' : accOf(n) === 'b' ? '♭' : '');
  function keyText(song) {
    const k = song.keySig || song.keyName || (typeof song.key === 'string' && /major|minor/i.test(song.key) ? song.key : null);
    return k || 'C major';
  }
  const timeText = (song) => song.timeSig || `${song.beatsPerBar || 4}/4`;

  function slice() {
    const sl = NS.store.slice('byear');
    const s = sl.get() || {};
    if (!s.best || typeof s.best !== 'object') s.best = {};
    if (!Number.isFinite(s.practiceSecs)) s.practiceSecs = 120;
    if (s.speed !== 0.75 && s.speed !== 1) s.speed = 1;
    return { sl, s };
  }
  function saveSlice(mut) {
    const { sl } = slice();
    sl.update((s) => {
      const o = s && typeof s === 'object' ? s : {};
      if (!o.best || typeof o.best !== 'object') o.best = {};
      mut(o);
      return o;
    });
    NS.store.save();
  }
  const bestOf = (id) => slice().s.best[id] || null;
  const prefer = () => {
    try { return NS.store.settings().spelling === 'flat' ? 'flat' : 'sharp'; } catch { return 'sharp'; }
  };

  function comfortOf(song) {
    try {
      const c = NS.curriculum.comfort(song, NS.store.state(), Date.now());
      return COMFORT[c && c.label] || null;
    } catch { return null; }
  }

  // ======================================================================
  // SMALL DRAWING HELPERS (inline SVG, colours from the tokens)
  // ======================================================================
  const yOf = (staffPos) => BOTTOM - staffPos * STEP;
  // Staff position of a midi note spelled as {letter, acc}.
  function staffPosOf(midi, letter, acc) {
    const off = acc === '#' ? 1 : acc === 'b' ? -1 : 0;
    const octave = Math.floor((midi - off) / 12) - 1;
    return octave * 7 + LETTERS.indexOf(letter) - 30;
  }
  function spellPlain(midi, pref) {
    const s = NS.notation.spellMidi(midi, pref);
    return { letter: s.letter, acc: s.acc || '' };
  }

  function drawStaffLines(svg, x1, x2, { clef = true, endBar = false } = {}) {
    for (let i = 0; i < 5; i++) {
      const l = svgEl('line', { x1, x2, y1: yOf(i * 2), y2: yOf(i * 2), 'stroke-width': 1.2 }, svg);
      l.style.stroke = 'var(--muted)';
    }
    if (clef) {
      const c = svgEl('text', { x: 6, y: BOTTOM - 4, 'font-size': 76, 'font-family': 'Noto Music, Bravura, Apple Symbols, serif' }, svg);
      c.style.fill = 'var(--ink)';
      c.textContent = '𝄞';
    }
    if (endBar) {
      const e = svgEl('line', { x1: x2, x2, y1: yOf(8), y2: yOf(0), 'stroke-width': 1.2 }, svg);
      e.style.stroke = 'var(--muted)';
    }
  }
  function drawLedgers(g, x, staffPos) {
    const ys = [];
    for (let p = -2; p >= staffPos; p -= 2) ys.push(yOf(p));
    for (let p = 10; p <= staffPos; p += 2) ys.push(yOf(p));
    ys.forEach((y) => {
      const l = svgEl('line', { x1: x - 12, x2: x + 12, y1: y, y2: y, 'stroke-width': 1.4 }, g);
      l.style.stroke = 'var(--ink)';
    });
  }
  // A notehead. Filled (song / match) or hollow with a thick ring (your take).
  function drawHead(g, x, staffPos, color, { hollow = false } = {}) {
    const y = yOf(staffPos);
    const h = svgEl('ellipse', {
      cx: x, cy: y, rx: 7.2, ry: 5.2, transform: `rotate(-20 ${x} ${y})`,
      'stroke-width': hollow ? 3 : 1,
    }, g);
    h.style.stroke = color;
    h.style.fill = hollow ? 'var(--card)' : color;
    return h;
  }
  function drawStem(g, x, staffPos, color) {
    const y = yOf(staffPos);
    const up = staffPos < 4;
    const sx = up ? x + 6.4 : x - 6.4;
    const l = svgEl('line', { x1: sx, x2: sx, y1: up ? y - 1 : y + 1, y2: up ? y - 36 : y + 36, 'stroke-width': 1.6 }, g);
    l.style.stroke = color;
  }
  // Sharp or flat as a path (never a font glyph), centred at (cx, y of staffPos).
  function drawAccidental(g, cx, staffPos, acc, color) {
    if (!acc) return null;
    const y = yOf(staffPos);
    const d = acc === '#'
      ? `M${cx - 2} ${y - 9}V${y + 9}M${cx + 2} ${y - 10}V${y + 8}M${cx - 5} ${y - 2}L${cx + 5} ${y - 4.5}M${cx - 5} ${y + 4}L${cx + 5} ${y + 1.5}`
      : `M${cx - 3} ${y - 13}V${y + 5}C${cx + 5} ${y + 1} ${cx + 5} ${y - 6} ${cx - 3} ${y - 1}`;
    const p = svgEl('path', { d, fill: 'none', 'stroke-width': acc === '#' ? 1.5 : 1.6, 'stroke-linecap': 'round', 'data-acc': acc }, g);
    p.style.stroke = color;
    return p;
  }
  function svgText(g, x, y, text, color, { size = 13, weight = 700 } = {}) {
    const t = svgEl('text', { x, y, 'text-anchor': 'middle', 'font-size': size, 'font-weight': weight, 'font-family': 'Atkinson Hyperlegible, system-ui, sans-serif' }, g);
    t.style.fill = color;
    t.textContent = text;
    return t;
  }

  // Mini keyboard for a chord chip: C4..E5 with the 3 keys lit and finger numbers 1-3-5.
  function chordKeysSvg(chord) {
    const keys = CHORD_KEYS[chord] || [];
    const W = 9;
    const whites = [];
    for (let m = 60; m <= 76; m++) if (![1, 3, 6, 8, 10].includes(m % 12)) whites.push(m);
    const svg = svgEl('svg', { viewBox: `0 0 ${whites.length * W + 1} 40`, width: whites.length * W + 1, height: 40, 'aria-hidden': 'true', class: 'be-cb-keys' });
    whites.forEach((m, i) => {
      const lit = keys.includes(m);
      const r = svgEl('rect', { x: i * W + 0.5, y: 11, width: W, height: 28, rx: 1.5, 'stroke-width': 1 }, svg);
      r.style.fill = lit ? 'var(--accent)' : 'var(--key-white)';
      r.style.stroke = 'var(--line)';
    });
    for (let m = 61; m <= 75; m++) {
      if (![1, 3, 6, 8, 10].includes(m % 12)) continue;
      const below = whites.indexOf(m - 1);
      const lit = keys.includes(m);
      const r = svgEl('rect', { x: (below + 1) * W - 2.7 + 0.5, y: 11, width: 5.4, height: 17, rx: 1 }, svg);
      r.style.fill = lit ? 'var(--accent)' : 'var(--key-black)';
    }
    keys.forEach((m, k) => {
      const wi = whites.indexOf(m);
      const x = wi >= 0 ? wi * W + 0.5 + W / 2 : (whites.indexOf(m - 1) + 1) * W + 0.5;
      svgText(svg, x, 9, String([1, 3, 5][k]), 'var(--ink)', { size: 9 });
    });
    return svg;
  }

  // ======================================================================
  // MOUNTED STATE (one screen at a time)
  // ======================================================================
  let S = null;

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const audioNow = () => { try { return NS.audio.ctx().currentTime; } catch { return performance.now() / 1000; } };

  function mount(rootEl, params, ctx) {
    S = {
      root: rootEl, ctx, song: null, step: 'list', offs: [], timers: new Set(), raf: 0,
      bar: null, fallback: null, commands: [], lastFire: -Infinity, det: null, onsets: [],
      play: null, playing: false, playKind: null, autoPlayed: false,
      kb: null, miniKb: null, micBar: null, live: null, pbuf: [],
      take: [], takeNotes: [], gestures: [], recording: false, takeStartAt: 0, closeAt: 0,
      result: null, newBest: false, prevBest: null, names: true, timer: null,
    };
    rootEl.classList.add('be');
    const song = params && params.arg ? findSong(params.arg) : null;
    if (params && params.arg && !song) {
      NS.ui.toast('That song isn’t here any more.');
      ctx.go('#/');
      return;
    }
    if (!song) { renderList(); return; }
    S.song = song;
    try { S.names = NS.store.settings().labels !== 'never'; } catch { S.names = true; }
    renderSongScreen();
  }

  function unmount() {
    if (!S) return;
    stopPlayback();
    stopTimer();
    cancelAnimationFrame(S.raf);
    S.timers.forEach(clearTimeout);
    S.offs.forEach((off) => { try { off(); } catch {} });
    detachDetector();
    clearCommands();
    if (S.kb) S.kb.destroy();
    if (S.miniKb) S.miniKb.destroy();
    if (S.micBar) S.micBar.destroy();
    S = null;
  }

  function later(fn, ms) {
    const t = setTimeout(() => { if (S) S.timers.delete(t); fn(); }, ms);
    S.timers.add(t);
    return t;
  }

  // ======================================================================
  // SONG LIST (#/byear)
  // ======================================================================
  function topbar(eyebrow, title, onBack, backLabel) {
    const bar = el('div', 'topbar');
    const b = el('button', 'back', '←');
    b.setAttribute('aria-label', backLabel);
    b.addEventListener('click', onBack);
    const t = el('div', 'title');
    const eb = el('span', 'eyebrow', eyebrow);
    const h = el('h2', null, title);
    t.append(eb, h);
    bar.append(b, t);
    return { bar, eb, h };
  }

  function renderList() {
    const r = S.root;
    S.ctx.setTitle('Play by Ear');
    const { bar } = topbar('Ear training', 'Play by Ear', () => S.ctx.go('#/'), 'Back to home');
    const intro = el('p', 'muted', 'Hear a song, work it out yourself, then compare your take with the real thing. Every song is open. The screen only tells you the key and the first note.');
    r.append(bar, intro);
    const levels = (root.NoteSongs && root.NoteSongs.levels) || [];
    const groups = new Map();
    library().forEach((s) => {
      const k = levelOf(s);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    });
    const wrap = el('div', 'be-groups');
    groups.forEach((list, lv) => {
      const sec = el('section', 'be-group');
      sec.appendChild(el('h3', 'be-group-title', (levels[lv] && levels[lv].title) || 'More songs'));
      const ul = el('ul', 'be-list');
      list.forEach((song) => ul.appendChild(listRow(song)));
      sec.appendChild(ul);
      wrap.appendChild(sec);
    });
    r.appendChild(wrap);
  }

  function listRow(song) {
    const li = el('li');
    const b = el('button', 'be-row');
    b.dataset.song = song.id;
    const meta = el('span', 'be-row-meta');
    meta.append(el('strong', null, song.title));
    const sub = song.origin || song.blurb;
    if (sub) meta.append(el('span', 'muted be-row-sub', sub));
    const pills = el('span', 'be-row-pills');
    const c = comfortOf(song);
    if (c) {
      const p = el('span', 'be-pill ' + c[1], c[0]);
      p.dataset.comfort = c[0];
      pills.appendChild(p);
    }
    const best = bestOf(song.id);
    pills.appendChild(el('span', 'be-pill ' + (best ? 'best' : 'muted'), best ? `Best take: ${best.pct}%` : 'No take yet'));
    meta.append(pills);
    b.append(meta, el('span', 'be-row-go', '›'));
    b.setAttribute('aria-label', `${song.title}. ${c ? c[0] + '. ' : ''}${best ? 'Best take ' + best.pct + ' percent' : 'No take yet'}`);
    b.addEventListener('click', () => { NS.audio.resume(); S.ctx.go(`#/byear/${encodeURIComponent(song.id)}`); });
    li.appendChild(b);
    return li;
  }

  // ======================================================================
  // SONG SCREEN (#/byear/:id): frame shared by the 4 steps
  // ======================================================================
  function renderSongScreen() {
    const r = S.root;
    const song = S.song;
    r.classList.add('be-has-bar');
    S.ctx.setTitle(`${song.title} · Play by Ear`);
    const { bar } = topbar('Play by Ear', song.title, () => S.ctx.go('#/byear'), 'Back to the song list');
    const steps = el('ol', 'be-steps');
    steps.setAttribute('aria-label', 'Steps');
    S.stepEls = {};
    STEPS.forEach(([id, label], i) => {
      const li = el('li', null);
      li.dataset.step = id;
      li.append(el('span', 'be-step-num', String(i + 1)), el('span', 'be-step-label', label));
      steps.appendChild(li);
      S.stepEls[id] = li;
    });
    S.body = el('div', 'be-body');
    const micSlot = el('div');
    const notice = el('p', 'notice');
    notice.setAttribute('data-mic-notice', '');
    notice.hidden = true;
    S.live = el('p', 'be-sr');
    S.live.setAttribute('aria-live', 'polite');
    S.live.setAttribute('role', 'status');
    r.append(bar, steps, S.body, micSlot, notice, S.live);
    S.micBar = NS.ui.micBar(micSlot);
    micSlot.replaceWith(S.micBar.el);

    S.offs.push(
      NS.input.on(onInput),
      NS.bus.on('mic:state', onMicState),
      NS.bus.on('mic:onset', ({ at }) => {
        if (!S || !Number.isFinite(at)) return;
        S.onsets.push(at);
        if (S.onsets.length > 16) S.onsets.shift();
      }),
      NS.bus.on('resize', () => { if (S && S.step === 'practise') renderLive(true); }),
      NS.bus.on('visibility', ({ hidden }) => { if (hidden) stopPlayback(); }),
    );
    if (NS.mic.isOn()) attachDetector();
    showListen();
  }

  function setStep(id) {
    S.step = id;
    const idx = STEPS.findIndex(([s]) => s === id);
    STEPS.forEach(([s], i) => {
      const li = S.stepEls[s];
      li.classList.toggle('on', i === idx);
      li.classList.toggle('done', i < idx);
      if (i === idx) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    if (S.kb) { S.kb.destroy(); S.kb = null; }
    if (S.miniKb) { S.miniKb.destroy(); S.miniKb = null; }
    stopTimer();
    S.body.innerHTML = '';
    S.body.dataset.step = id;
  }

  // ======================================================================
  // CHORD COMMANDS
  // ======================================================================
  // list: [{chord, label, announce, run(info)}]; info = {chord, at (audio clock s), via:'chord'|'tap'|'bar'}
  function setCommands(list) {
    clearCommands();
    S.commands = list.slice().sort((a, b) => CHORD_ORDER.indexOf(a.chord) - CHORD_ORDER.indexOf(b.chord));
    if (!S.commands.length) return;
    const cmds = S.commands.map((c) => ({
      chord: c.chord, label: c.label,
      run: (arg) => fire(c.chord, viaOf(arg)),
    }));
    if (root.ChordBar && typeof root.ChordBar.show === 'function') {
      try { S.bar = root.ChordBar.show({ commands: cmds, listening: NS.mic.isOn() }); } catch (err) {
        console.error('[byear] ChordBar.show failed', err);
        S.bar = null;
      }
    }
    // The WP0 stub of ChordBar renders nothing; then (or with no ChordBar at all) draw plain buttons.
    if (!S.bar || !document.querySelector('[class^="cb-"], [class*=" cb-"]')) renderFallbackBar(cmds);
  }
  function clearCommands() {
    if (!S) return;
    if (S.bar) { try { S.bar.hide(); } catch {} }
    S.bar = null;
    if (S.fallback) S.fallback.remove();
    S.fallback = null;
    S.commands = [];
  }
  // How a command was triggered when ChordBar calls run(arg): a DOM event means a tap.
  function viaOf(arg) {
    if (arg && typeof Event !== 'undefined' && arg instanceof Event) return 'tap';
    if (arg && (arg.source === 'tap' || arg.via === 'tap' || arg.type === 'click')) return 'tap';
    if (arg && (arg.source === 'chord' || arg.via === 'chord' || typeof arg === 'string')) return 'chord';
    return 'bar';
  }

  function renderFallbackBar(cmds) {
    const bar = el('div', 'be-chordbar');
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Chord commands');
    const row = el('div', 'be-cb-row');
    cmds.forEach((c) => {
      const b = el('button', 'be-cb-chip');
      b.dataset.chord = c.chord;
      const txt = el('span', 'be-cb-text');
      txt.append(el('strong', null, B.CHORD_NAMES[c.chord]), document.createTextNode(' → ' + c.label));
      b.append(chordKeysSvg(c.chord), txt);
      b.setAttribute('aria-label', `${B.CHORD_NAMES[c.chord]}: ${c.label}`);
      b.addEventListener('click', () => { NS.audio.resume(); fire(c.chord, 'tap'); });
      row.appendChild(b);
    });
    const hint = el('p', 'be-cb-hint muted', 'Tap Start listening to use chords');
    hint.dataset.cbHint = '';
    hint.hidden = NS.mic.isOn();
    bar.append(row, hint);
    document.body.appendChild(bar);
    S.fallback = bar;
  }

  function fire(chord, via) {
    if (!S) return;
    const now = performance.now();
    const cmd = S.commands.find((c) => c.chord === chord);
    if (!cmd) return;
    if (now - S.lastFire < REFRACTORY_MS) return;
    S.lastFire = now;
    const at = audioNow();
    // The chord's attack: the latest mic onset in the 0.8 s before recognition (the detector needs
    // about 0.4 s to recognise a chord), so the chord's own notes can be stripped from a take.
    // Only for a recognised chord: after a tap the latest onset is a melody note, not a chord.
    const from = via === 'chord' ? S.onsets.filter((t) => t <= at && t >= at - 0.8).pop() : null;
    if (via === 'chord') {
      if (S.bar && S.bar.flash) { try { S.bar.flash(chord); } catch {} }
      flashFallback(chord);
      announce(`Heard ${B.CHORD_NAMES[chord]}: ${cmd.announce}`);
    }
    cmd.run({ chord, at, from: Number.isFinite(from) ? from : null, via });
  }
  function flashFallback(chord) {
    if (!S.fallback) return;
    const chip = S.fallback.querySelector(`[data-chord="${chord}"]`);
    if (!chip) return;
    chip.classList.add('flash');
    later(() => chip.classList.remove('flash'), 700);
  }
  function announce(text) {
    if (!S || !S.live) return;
    S.live.textContent = '';
    later(() => { if (S && S.live) S.live.textContent = text; }, 30);
  }

  // Our own chord listener on the mic, used unless the chord bar says it listens itself.
  function attachDetector() {
    detachDetector();
    const CD = root.ChordDetect;
    const src = NS.mic.source && NS.mic.source();
    if (!CD || typeof CD.attach !== 'function' || !src || !NS.mic.isOn()) return;
    if (root.ChordBar && root.ChordBar.detects) return;
    try {
      S.det = CD.attach(NS.audio.ctx(), src, { targets: CHORD_ORDER.slice(), onChord: onChord, muted: () => Boolean(S && S.playing) || NS.audio.micMuted() });
      S.det.start();
    } catch (err) {
      console.error('[byear] chord detector failed', err);
      S.det = null;
    }
  }
  function detachDetector() {
    if (S && S.det) { try { S.det.dispose(); } catch {} S.det = null; }
  }
  function onChord(name) {
    if (!S || !CHORD_ORDER.includes(name)) return;
    // Muted while our own synth plays, with the same mute window as the note listener.
    if (S.playing || NS.audio.micMuted()) return;
    fire(name, 'chord');
  }
  function onMicState(st) {
    if (!S) return;
    if (st.on) attachDetector(); else detachDetector();
    if (S.bar && S.bar.setListening) { try { S.bar.setListening(Boolean(st.on)); } catch {} }
    if (S.fallback) { const h = S.fallback.querySelector('[data-cb-hint]'); if (h) h.hidden = Boolean(st.on); }
  }

  // ======================================================================
  // PLAYBACK
  // ======================================================================
  const speed = () => slice().s.speed;

  // kind: 'song' | 'take'. onNote(i) highlights; the input is ignored and the mic muted while it plays.
  function play(kind, onNote) {
    stopPlayback();
    NS.audio.resume();
    const song = S.song;
    let h;
    const onEnd = () => {
      if (!S || S.play !== h) return;
      S.play = null;
      S.playing = false;
      S.playKind = null;
      cancelAnimationFrame(S.raf);
      onPlayChange();
    };
    if (kind === 'song') {
      h = NS.audio.playSequence(song.items || song.notes, {
        bpm: song.bpm || 90, speed: speed(), id: 'byear-song', onNote: onNote ? (i) => onNote(i) : null, onEnd,
      });
    } else {
      h = NS.audio.playEvents(B.takeEvents(S.takeNotes), { id: 'byear-take', onNote: onNote ? (i) => onNote(i) : null, onEnd });
    }
    S.play = h;
    S.playing = true;
    S.playKind = kind;
    S.playStart = performance.now();
    onPlayChange();
    return h;
  }
  function stopPlayback() {
    if (!S || !S.play) return;
    const h = S.play;
    S.play = null;
    S.playing = false;
    S.playKind = null;
    cancelAnimationFrame(S.raf);
    try { h.stop(); } catch {}
    onPlayChange();
  }
  function onPlayChange() {
    if (!S) return;
    if (S.step === 'listen') updateListenUi();
    else if (S.step === 'practise') updatePractiseUi();
    else if (S.step === 'compare') updateCompareUi();
  }

  // ======================================================================
  // INPUT
  // ======================================================================
  function onInput(ev) {
    if (!S || S.playing) return;
    if (ev.source === 'mic' && S.kb) S.kb.setHeard(ev.midi);
    if (S.step === 'practise') practiseNote(ev);
    else if (S.step === 'take') takeNote(ev);
  }

  // ======================================================================
  // STEP 1: LISTEN
  // ======================================================================
  function showListen() {
    setStep('listen');
    const song = S.song;
    const first = song.notes[0];
    const facts = el('div', 'be-facts');
    const key = el('div', 'be-fact');
    key.append(el('span', 'eyebrow', 'Key'), el('strong', null, keyText(song)));
    const time = el('div', 'be-fact');
    time.append(el('span', 'eyebrow', 'Time'), el('strong', null, timeText(song)));
    facts.append(key, time);

    const firstCard = el('section', 'be-first');
    const fHead = el('div', 'be-first-head');
    fHead.append(el('span', 'eyebrow', 'First note'), el('strong', 'be-first-name', nameOf(first)));
    firstCard.appendChild(fHead);
    const row = el('div', 'be-first-row');
    const svg = svgEl('svg', { viewBox: '0 0 136 150', class: 'be-mini-staff', role: 'img', 'aria-label': `The first note, ${nameOf(first)}, on the staff` });
    drawStaffLines(svg, 4, 132, { clef: true, endBar: false });
    const g = svgEl('g', {}, svg);
    const pos = Number.isFinite(first.staffPos) ? first.staffPos : staffPosOf(first.midi, first.letter, accOf(first));
    drawLedgers(g, 100, pos);
    drawAccidental(g, 85, pos, accOf(first), 'var(--ink)');
    drawHead(g, 100, pos, 'var(--ink)');
    drawStem(g, 100, pos, 'var(--ink)');
    const kbEl = el('div', 'keyboard be-mini-kb');
    kbEl.setAttribute('aria-label', `Keyboard with the first note, ${nameOf(first)}, lit. Tap it to hear it.`);
    row.append(svg, kbEl);
    firstCard.appendChild(row);

    const note = el('p', 'muted be-ear-note', 'The tune isn’t shown. Listen, then work it out on your piano.');
    const prog = el('div', 'progress be-progress');
    prog.setAttribute('role', 'progressbar');
    prog.setAttribute('aria-label', 'Song playing');
    prog.setAttribute('aria-valuemin', '0');
    prog.setAttribute('aria-valuemax', '100');
    const fill = el('div');
    prog.appendChild(fill);
    const controls = el('div', 'controls');
    const playBtn = el('button', 'btn primary', '▶ Play');
    playBtn.dataset.ref = 'play';
    playBtn.addEventListener('click', () => { if (S.playing) stopPlayback(); else playListen(); });
    const spWrap = el('div', 'be-speed');
    spWrap.append(el('span', 'muted', 'Speed'), NS.ui.seg(SPEED_OPTIONS, speed(), (v) => saveSlice((s) => { s.speed = v; })));
    controls.append(playBtn, spWrap);
    S.body.append(facts, firstCard, note, prog, controls);
    S.listenUi = { playBtn, fill, prog, played: false };

    // One octave, C to C, around the first note.
    const low = first.midi - (((first.midi % 12) + 12) % 12);
    S.miniKb = NS.keyboard.create(kbEl, { low, high: low + 12, emit: false, sound: true, labels: (m) => m === first.midi });
    S.miniKb.setHint(first.midi);

    setCommands([
      { chord: 'Cm', label: 'Hear it again', announce: 'playing the song again', run: () => playListen() },
      { chord: 'C', label: 'I’m ready to practise', announce: 'time to practise', run: () => showPractise() },
    ]);
    updateListenUi();
    if (!S.autoPlayed) {
      S.autoPlayed = true;
      later(() => { if (S && S.step === 'listen') playListen(); }, 300);
    }
  }

  function playListen() {
    if (!S || S.step !== 'listen') return;
    S.listenUi.played = true;
    const h = play('song');
    const tick = () => {
      if (!S || S.play !== h || !S.listenUi) return;
      const span = Math.max(1, h.endPerf - S.playStart);
      const p = Math.min(1, Math.max(0, (performance.now() - S.playStart) / span));
      S.listenUi.fill.style.width = (p * 100).toFixed(1) + '%';
      S.listenUi.prog.setAttribute('aria-valuenow', String(Math.round(p * 100)));
      S.raf = requestAnimationFrame(tick);
    };
    S.raf = requestAnimationFrame(tick);
  }
  function updateListenUi() {
    const u = S.listenUi;
    if (!u) return;
    u.playBtn.textContent = S.playing ? '■ Stop' : u.played ? '▶ Replay' : '▶ Play';
    u.playBtn.setAttribute('aria-label', S.playing ? 'Stop the song' : u.played ? 'Play the song again' : 'Play the song');
    if (!S.playing) {
      u.fill.style.width = u.played ? '100%' : '0%';
      u.prog.setAttribute('aria-valuenow', u.played ? '100' : '0');
    }
  }

  // ======================================================================
  // STEP 2: PRACTISE (free play, not scored)
  // ======================================================================
  function showPractise() {
    stopPlayback();
    setStep('practise');
    S.pbuf = [];
    S.pcount = 0;
    const head = el('div', 'be-practise-head');
    const ring = svgEl('svg', { viewBox: '0 0 60 60', class: 'be-ring', 'aria-hidden': 'true' });
    const track = svgEl('circle', { cx: 30, cy: 30, r: 24, fill: 'none', 'stroke-width': 5 }, ring);
    track.style.stroke = 'var(--line)';
    const arc = svgEl('circle', { cx: 30, cy: 30, r: 24, fill: 'none', 'stroke-width': 5, 'stroke-linecap': 'round', transform: 'rotate(-90 30 30)' }, ring);
    arc.style.stroke = 'var(--accent)';
    const ringText = svgText(ring, 30, 35, '2:00', 'var(--ink)', { size: 13 });
    const timerText = el('div', 'be-timer-text');
    const tLabel = el('strong', null, 'Take your time');
    tLabel.setAttribute('role', 'timer');
    timerText.append(tLabel, el('span', 'muted', 'Work the song out by ear. Nothing here is scored.'));
    const timerSeg = el('div', 'be-speed');
    timerSeg.append(el('span', 'muted', 'Timer'), NS.ui.seg(TIMER_OPTIONS, slice().s.practiceSecs, (v) => {
      saveSlice((s) => { s.practiceSecs = v; });
      startTimer();
    }));
    head.append(ring, timerText);

    const card = el('div', 'staff-card be-live-card');
    const svg = svgEl('svg', { class: 'be-live', role: 'img', 'aria-label': 'Music staff showing the notes you play' });
    const status = el('p', 'page-note be-live-status');
    card.append(svg, status);
    const controls = el('div', 'controls');
    const hear = el('button', 'btn', '▶ Hear it again');
    hear.addEventListener('click', () => { if (S.playing) stopPlayback(); else play('song'); });
    controls.append(hear);
    const keys = keysBlock();
    S.body.append(head, timerSeg, card, controls, keys);
    S.practiseUi = { ring, arc, ringText, tLabel, svg, status, hear };
    renderLive(true);
    startTimer();
    setCommands([
      { chord: 'Cm', label: 'Hear it again', announce: 'playing the song again', run: () => play('song') },
      { chord: 'C', label: 'Start the real take', announce: 'starting the real take', run: (info) => startTake(info) },
    ]);
    updatePractiseUi();
  }

  // On-screen keys for when there is no piano nearby (they feed NS.input like the mic does).
  function keysBlock() {
    const d = el('details', 'be-keys');
    d.appendChild(el('summary', null, 'No piano? Use the on-screen keys'));
    const kbEl = el('div', 'keyboard');
    kbEl.setAttribute('aria-label', 'On-screen keyboard. Tap a key to play it.');
    d.appendChild(kbEl);
    const range = NS.keyboard.rangeFor(S.song.notes, { width: root.innerWidth });
    let names = true;
    try { names = NS.store.settings().labels !== 'never'; } catch {}
    S.kb = NS.keyboard.create(kbEl, { low: range.low, high: range.high, labels: names ? 'all' : 'none' });
    return d;
  }

  function startTimer() {
    stopTimer();
    const u = S.practiseUi;
    const secs = slice().s.practiceSecs;
    if (!u) return;
    u.ring.style.display = secs ? '' : 'none';
    if (!secs) { u.tLabel.textContent = 'Take your time'; return; }
    const end = performance.now() + secs * 1000;
    const C = 2 * Math.PI * 24;
    u.arc.setAttribute('stroke-dasharray', C.toFixed(2));
    const tick = () => {
      if (!S || !S.practiseUi) return;
      const left = Math.max(0, Math.ceil((end - performance.now()) / 1000));
      u.arc.setAttribute('stroke-dashoffset', (C * (1 - left / secs)).toFixed(2));
      const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      u.ringText.textContent = left ? mmss : '✓';
      u.tLabel.textContent = left ? `${mmss} to practise` : 'Ready when you are';
      if (!left) stopTimer();
    };
    tick();
    S.timer = setInterval(tick, 500);
  }
  function stopTimer() {
    if (S && S.timer) { clearInterval(S.timer); S.timer = null; }
  }

  function practiseNote(ev) {
    S.pbuf.push({ midi: ev.midi, at: ev.at });
    if (S.pbuf.length > 200) S.pbuf.shift();
    S.pcount = (S.pcount || 0) + 1;
    renderLive(false);
  }

  // Live scrolling staff (the Free Play "even" layout, §3.6.2): notes at x = 74 + i·52 inside a clip
  // group that slides left as new notes arrive. Newest note in the accent colour.
  function renderLive(full) {
    const u = S.practiseUi;
    if (!u) return;
    const svg = u.svg;
    const N = NS.staff.perPage(svg.parentElement && svg.parentElement.clientWidth);
    const W = LEFT + N * SPACING + 10;
    const H = 172;
    if (full || !u.track || u.N !== N) {
      svg.innerHTML = '';
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      drawStaffLines(svg, 4, W - 4, { clef: true });
      const defs = svgEl('defs', {}, svg);
      const clip = svgEl('clipPath', { id: 'beLiveClip' }, defs);
      svgEl('rect', { x: 50, y: 0, width: W - 50, height: H }, clip);
      const outer = svgEl('g', { 'clip-path': 'url(#beLiveClip)' }, svg);
      u.track = svgEl('g', { class: 'be-live-track' }, outer);
      u.empty = svgText(svg, (W + 50) / 2, 40, 'Your notes will appear here', 'var(--muted)', { size: 14, weight: 400 });
      u.N = N;
      u.drawn = 0;
    }
    const total = S.pcount || 0;
    const base = total - S.pbuf.length;
    // draw any new notes
    for (let a = Math.max(u.drawn, base); a < total; a++) {
      const n = S.pbuf[a - base];
      const place = NS.notation.placeOnStaff(n.midi, { mode: 'heard', prefer: prefer() });
      const note = place.note;
      const g = svgEl('g', { 'data-i': a }, u.track);
      const x = LEFT + a * SPACING;
      const col = svgEl('rect', { x: x - 22, y: 22, width: 44, height: 130, rx: 10, class: 'be-col' }, g);
      col.style.fill = 'var(--accent-soft)';
      const ink = svgEl('g', { class: 'be-ink' }, g);
      drawLedgers(ink, x, note.staffPos);
      drawAccidental(ink, x - 15, note.staffPos, note.acc, 'currentColor');
      drawHead(ink, x, note.staffPos, 'currentColor');
      drawStem(ink, x, note.staffPos, 'currentColor');
      if (place.fold) svgText(ink, x, place.fold > 0 ? 16 : 150, place.fold > 0 ? '8va' : '8vb', 'currentColor', { size: 10 });
      let names = true;
      try { names = NS.store.settings().labels !== 'never'; } catch {}
      if (names) svgText(ink, x, 166, B.noteName(n.midi, prefer()), 'currentColor', { size: 14 });
    }
    u.drawn = total;
    const offset = Math.max(0, total - N);
    u.track.style.transform = `translateX(${-offset * SPACING}px)`;
    // prune, then colour: newest accent, older ink, the two left-most visible faded
    u.track.querySelectorAll('g[data-i]').forEach((g) => {
      const a = Number(g.dataset.i);
      if (a < offset - 2) { g.remove(); return; }
      const newest = a === total - 1;
      g.querySelector('.be-col').style.display = newest ? '' : 'none';
      g.querySelector('.be-ink').style.color = newest ? 'var(--accent)' : 'var(--ink)';
      g.style.opacity = total > N && a === offset ? '0.55' : total > N && a === offset + 1 ? '0.8' : '1';
    });
    u.empty.style.display = total ? 'none' : '';
    updatePractiseUi();
  }

  function updatePractiseUi() {
    const u = S.practiseUi;
    if (!u) return;
    u.hear.textContent = S.playing ? '■ Stop' : '▶ Hear it again';
    const n = S.pcount || 0;
    u.status.textContent = S.playing
      ? 'The song is playing, so the staff is paused.'
      : n ? `${n} note${n === 1 ? '' : 's'} played. When you’re ready, play C major to start the real take.` : 'Play anything. Your notes show up here.';
    u.svg.classList.toggle('paused', S.playing);
  }

  // ======================================================================
  // STEP 3: REAL TAKE
  // ======================================================================
  function startTake(info = {}) {
    stopPlayback();
    setStep('take');
    S.take = [];
    S.gestures = [];
    const at = Number.isFinite(info.at) ? info.at : audioNow();
    // A command chord's own notes are stripped later (§7.2); a tap has no chord to strip.
    if (info.via !== 'tap') S.gestures.push({ chord: info.chord || 'C', at, from: info.from });
    S.takeStartAt = info.via === 'tap' ? at : at - 0.25;
    S.recording = true;
    const rec = el('div', 'be-rec');
    const dot = el('span', 'be-rec-dot');
    dot.setAttribute('aria-hidden', 'true');
    rec.append(dot, el('strong', null, 'Recording'));
    const count = el('p', 'be-count', '0 notes so far');
    const tip = el('p', 'muted', 'Play the whole song from memory. The staff stays hidden until you finish. Play G major when you’re done.');
    const keys = keysBlock();
    S.body.append(rec, count, tip, keys);
    S.takeUi = { count };
    announce('Recording');
    setCommands([
      { chord: 'Cm', label: 'Start the take over', announce: 'starting the take over', run: (i) => startTake(i) },
      { chord: 'G', label: 'I’m done', announce: 'comparing your take with the song', run: (i) => finishTake(i) },
    ]);
  }

  function takeNote(ev) {
    if (!S.recording) return;
    if (!Number.isFinite(ev.at) || ev.at < S.takeStartAt) return;
    if (S.recording === 'closing' && ev.at > S.closeAt) return;
    S.take.push({ midi: ev.midi, at: ev.at, tOnset: ev.tOnset, source: ev.source });
    if (S.takeUi) S.takeUi.count.textContent = `${S.take.length} note${S.take.length === 1 ? '' : 's'} so far`;
  }

  function finishTake(info = {}) {
    if (S.step !== 'take' || S.recording !== true) return;
    const at = Number.isFinite(info.at) ? info.at : audioNow();
    if (info.via !== 'tap') S.gestures.push({ chord: 'G', at, from: info.from });
    // Notes whose onset came just before the G are confirmed a little later: wait for them.
    S.recording = 'closing';
    S.closeAt = info.via === 'tap' ? at : at + 0.3;
    clearCommands();
    later(() => {
      if (!S || S.step !== 'take') return;
      S.recording = false;
      computeResult();
      showCompare();
    }, 350);
  }

  function computeResult() {
    S.takeNotes = B.stripChordNotes(S.take, S.gestures).sort((a, b) => a.at - b.at);
    S.result = B.align(songMidis(S.song), S.takeNotes.map((n) => n.midi));
    S.prevBest = bestOf(S.song.id);
    S.newBest = B.isNewBest(S.prevBest, S.result.pct);
    if (S.newBest) {
      const pct = S.result.pct;
      const id = S.song.id;
      saveSlice((s) => { s.best[id] = { pct, at: Date.now() }; });
    }
  }

  // ======================================================================
  // STEP 4: COMPARE
  // ======================================================================
  function showCompare() {
    stopPlayback();
    setStep('compare');
    const r = S.result;
    const sum = el('section', 'be-summary');
    const h = el('h3', 'be-summary-main', B.summaryText(r));
    const bestRow = el('div', 'be-best');
    const best = bestOf(S.song.id);
    bestRow.appendChild(el('span', null, `Best take: ${best ? best.pct : r.pct}%`));
    if (S.newBest) bestRow.appendChild(el('span', 'be-pill best', 'New best!'));
    sum.append(h, bestRow);

    const legend = el('p', 'be-legend');
    legend.innerHTML = '<span class="be-lg song">● Blue = the song</span> · <span class="be-lg yours">○ Red = what you played</span> · <span class="be-lg match">● Green = the same</span>';
    const card = el('div', 'staff-card be-compare-card');
    const scroller = el('div', 'be-scroll');
    scroller.tabIndex = 0;
    scroller.setAttribute('aria-label', 'Comparison staff. Scroll sideways to see every note.');
    const svg = svgEl('svg', { class: 'be-compare', role: 'img' });
    scroller.appendChild(svg);
    card.appendChild(scroller);

    const tools = el('div', 'controls');
    const hearSong = el('button', 'btn', '▶ Hear the song');
    const hearTake = el('button', 'btn', '▶ Hear your take');
    hearTake.disabled = !S.takeNotes.length;
    const namesBtn = el('button', 'btn' + (S.names ? ' on' : ''), `Note names: ${S.names ? 'on' : 'off'}`);
    namesBtn.setAttribute('aria-pressed', String(S.names));
    hearSong.addEventListener('click', () => {
      if (S.playKind === 'song') { stopPlayback(); return; }
      play('song', (i) => highlight((c) => c.songIndex === i));
    });
    hearTake.addEventListener('click', () => {
      if (S.playKind === 'take') { stopPlayback(); return; }
      play('take', (i) => highlight((c) => c.takeIndex === i));
    });
    namesBtn.addEventListener('click', () => {
      S.names = !S.names;
      namesBtn.textContent = `Note names: ${S.names ? 'on' : 'off'}`;
      namesBtn.classList.toggle('on', S.names);
      namesBtn.setAttribute('aria-pressed', String(S.names));
      drawCompare();
    });
    tools.append(hearSong, hearTake, namesBtn);

    const diffs = B.differences(r, { max: 5, songNames: S.song.notes.map(nameOf), prefer: prefer() });
    const dBox = el('section', 'be-diffs');
    dBox.appendChild(el('h3', null, diffs.length ? 'What was different' : 'No differences'));
    if (diffs.length) {
      const ul = el('ul');
      diffs.forEach((t) => ul.appendChild(el('li', null, t)));
      dBox.appendChild(ul);
    } else {
      dBox.appendChild(el('p', 'muted', r.total ? 'You played every note of the song, by ear. Well done!' : ''));
    }
    if (!S.takeNotes.length) dBox.appendChild(el('p', 'muted', 'No notes were recorded in this take. Start listening, or open the on-screen keys, and try again.'));

    S.body.append(sum, legend, card, tools, dBox);
    S.compareUi = { svg, scroller, hearSong, hearTake };
    drawCompare();
    announce(`${B.summaryText(r)}.${S.newBest ? ' New best!' : ''}`);
    setCommands([
      { chord: 'C', label: 'Next song', announce: 'opening the next song', run: () => nextSong() },
      { chord: 'Cm', label: 'Try again', announce: 'back to practice', run: () => showPractise() },
    ]);
  }

  function nextSong() {
    const list = library();
    const i = list.findIndex((s) => s.id === S.song.id);
    const next = list[i + 1];
    S.ctx.go(next ? `#/byear/${encodeURIComponent(next.id)}` : '#/byear');
  }

  // One treble staff, one column per alignment column (§7.2 "Compare rendering").
  function drawCompare() {
    const u = S.compareUi;
    if (!u) return;
    const svg = u.svg;
    const pref = prefer();
    const cols = B.layout(S.result);
    const n = Math.max(cols.length, 3);
    const W = LEFT + n * SPACING + 12;
    const H = S.names ? 196 : 158;
    svg.innerHTML = '';
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    const c = B.counts(S.result);
    svg.setAttribute('aria-label', `Your take and the song on one staff: ${c.match} the same, ${c.sub} different, ${c.missed} missed, ${c.extra} extra.`);
    u.cols = [];
    const hlLayer = svgEl('g', {}, svg);
    drawStaffLines(svg, 4, W - 4, { clef: true, endBar: true });
    cols.forEach((col, k) => {
      const x = LEFT + k * SPACING;
      const hl = svgEl('rect', { x: x - 24, y: 24, width: 48, height: H - 30, rx: 10, class: 'be-hl' }, hlLayer);
      hl.style.fill = 'var(--listen-soft)';
      hl.style.opacity = '0';
      const g = svgEl('g', { 'data-kind': col.kind, 'data-col': k }, svg);
      let songPos = null;
      let songName = null;
      if (col.song != null) {
        const sn = S.song.notes[col.songIndex];
        const acc = accOf(sn);
        songPos = Number.isFinite(sn.staffPos) ? sn.staffPos : staffPosOf(sn.midi, sn.letter, acc);
        songName = nameOf(sn);
        const color = col.kind === 'match' ? 'var(--match)' : 'var(--song)';
        drawLedgers(g, x, songPos);
        drawAccidental(g, x - 15, songPos, acc, color);
        drawHead(g, x, songPos, color).setAttribute('data-who', col.kind === 'match' ? 'both' : 'song');
      }
      let takeName = null;
      if (col.kind === 'sub' || col.kind === 'extra') {
        const sp = col.kind === 'sub' ? B.spellNear(col.draw, col.song, pref) : spellPlain(col.draw, pref);
        takeName = sp.name || B.noteName(col.draw, pref);
        const pos = staffPosOf(col.draw, sp.letter, sp.acc);
        // Same (or touching) staff position as the song note: shift yours right so both stay visible.
        const shifted = songPos != null && Math.abs(pos - songPos) <= 1;
        const tx = shifted ? x + 9 : x;
        drawLedgers(g, tx, pos);
        if (sp.acc) drawAccidental(g, shifted ? tx + 14 : tx - 15, pos, sp.acc, 'var(--yours)');
        drawHead(g, tx, pos, 'var(--yours)', { hollow: true }).setAttribute('data-who', 'yours');
      }
      // marks row under the staff
      if (col.kind === 'match') svgText(g, x, 146, '✓', 'var(--match)', { size: 14 });
      if (col.kind === 'missed') {
        const t = svgEl('line', { x1: x, x2: x, y1: 132, y2: 137, 'stroke-width': 1.5 }, g);
        t.style.stroke = 'var(--song)';
        svgText(g, x, 148, 'missed', 'var(--song)', { size: 10.5, weight: 700 });
      }
      if (S.names) {
        if (songName) svgText(g, x, 170, songName, col.kind === 'match' ? 'var(--match)' : 'var(--song)', { size: 14 });
        if (takeName) svgText(g, x, col.kind === 'sub' ? 188 : 170, takeName, 'var(--yours)', { size: 14 });
      }
      u.cols.push({ col, hl, x });
    });
  }

  function highlight(pred) {
    const u = S && S.compareUi;
    if (!u || !u.cols) return;
    let shown = null;
    u.cols.forEach((e) => {
      const on = pred(e.col);
      e.hl.style.opacity = on ? '1' : '0';
      if (on && !shown) shown = e;
    });
    if (shown) {
      const target = Math.max(0, shown.x - u.scroller.clientWidth / 2);
      const reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
      try { u.scroller.scrollTo({ left: target, behavior: reduce ? 'auto' : 'smooth' }); } catch { u.scroller.scrollLeft = target; }
    }
  }

  function updateCompareUi() {
    const u = S.compareUi;
    if (!u) return;
    u.hearSong.textContent = S.playKind === 'song' ? '■ Stop' : '▶ Hear the song';
    u.hearTake.textContent = S.playKind === 'take' ? '■ Stop' : '▶ Hear your take';
    if (!S.playing && u.cols) u.cols.forEach((e) => (e.hl.style.opacity = '0'));
  }

  // e2e hook (?test=1 only): act as if the chord detector recognised `name` right now. Lets a test
  // drive chords the detector can't hear yet, with the same muting, refractory and stripping rules.
  if (NS.isTest) NS.debug.byearChord = (name) => onChord(name);

  // ======================================================================
  // REGISTER
  // ======================================================================
  NS.modes.register({
    id: 'byear',
    title: 'Play by Ear',
    blurb: 'Hear a song, work it out yourself, then compare your take with the real thing.',
    order: 7,
    needsSong: false,
    icon: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M7 10a5 5 0 0 1 10 0c0 3-3 4-3 7a3 3 0 0 1-5 2M10 10a2 2 0 0 1 4 0"/></svg>',
    mount,
    unmount,
    songBadge(songId) {
      const b = bestOf(songId);
      return b ? { text: `Best take by ear: ${b.pct}%`, tone: b.pct >= 90 ? 'good' : 'learn' } : null;
    },
    songLocked: () => ({ locked: false }),
    tileChip: () => null,
    debugState() {
      if (!S) return { screen: 'byear', mounted: false };
      return {
        screen: S.song ? 'byear-song' : 'byear-list',
        songId: S.song ? S.song.id : null,
        step: S.step,
        playing: S.playing,
        recording: S.recording,
        take: S.take.map((n) => n.midi),
        gestures: S.gestures.slice(),
        result: S.result ? Object.assign({ counts: B.counts(S.result) }, { matched: S.result.matched, total: S.result.total, pct: S.result.pct }) : null,
        commands: S.commands.map((c) => `${B.CHORD_NAMES[c.chord]} → ${c.label}`),
        chordBar: S.fallback ? 'fallback' : S.bar ? 'chordbar' : null,
        detector: Boolean(S.det),
      };
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
