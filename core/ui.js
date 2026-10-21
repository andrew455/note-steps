// Shared UI pieces: colour tokens, screen frame, feedback panel, mic bar, dialogs, sheets, toasts,
// chips, segmented controls, comfort pills, note chips, the sound check and the mic check. NS.ui.
// Load after core/audio.js. Styles in core/ui.css. Spec §2.4.12.
//
// Pure part (UMD, for node tests): UiCore = {COMFORT_TEXT, STATE_WORD, keyLetter, listLetters,
// comfortText, heardInOrder}. In the browser it is also NS.ui.core.
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;

  // ======================================================================
  // PURE
  // ======================================================================
  const COMFORT_TEXT = { easy: 'Easy', right: 'Just right', stretch: 'Stretch', tough: 'Tough', locked: 'Locked' };
  const STATE_WORD = { known: 'Known', learning: 'Learning', new: 'New', locked: 'Coming up' };
  const ACC = { '#': '♯', b: '♭', '♯': '♯', '♭': '♭' };

  // 'F#4' -> 'F♯', 'Bb4' -> 'B♭', 'E4' -> 'E'.
  function keyLetter(key) {
    const m = /^([A-G])([#b♯♭]?)(-?\d+)?$/.exec(String(key || ''));
    if (!m) return String(key || '');
    return m[1] + (m[2] ? ACC[m[2]] : '');
  }
  // ['F4','A4'] -> 'F, A'. When a letter repeats at another octave, every copy keeps its octave
  // ('C4','D4','C5' -> 'C4, D, C5') so the list never reads 'C, D, C'. `context` (e.g. all of a
  // song's keys) also counts: listLetters(['G5'], ['G4','G5']) -> 'G5'.
  function listLetters(keys, context) {
    const uniq = [...new Set(keys || [])];
    const count = {};
    [...new Set(uniq.concat(context || []))].forEach((k) => { const l = keyLetter(k); count[l] = (count[l] || 0) + 1; });
    return uniq.map((k) => {
      const l = keyLetter(k);
      if (count[l] < 2) return l;
      const oct = /(-?\d+)$/.exec(k);
      return l + (oct ? oct[1] : '');
    }).join(', ');
  }

  // Curriculum.comfort(...) -> {label, text, known, detail}
  //   text   'Just right'               (the pill)
  //   known  '92% known' | null          (null when nothing is known yet)
  //   detail 'Learn G to unlock' | '1 new note: G' | '2 new notes: F, A' | ''
  function comfortText(c, { context } = {}) {
    if (!c || !c.label) return { label: 'right', text: COMFORT_TEXT.right, known: null, detail: '' };
    const label = COMFORT_TEXT[c.label] ? c.label : 'right';
    const share = Number.isFinite(c.knownShare) ? Math.round(c.knownShare * 100) : 0;
    let detail = '';
    if (label === 'locked') {
      const keys = (c.lockedKeys || []).length ? c.lockedKeys : [];
      detail = keys.length ? `Learn ${listLetters(keys, context)} to unlock` : 'Learn its notes to unlock';
    } else if ((c.newKeys || []).length) {
      const n = c.newKeys.length;
      detail = `${n} new note${n === 1 ? '' : 's'}: ${listLetters(c.newKeys, context)}`;
    }
    return { label, text: COMFORT_TEXT[label], known: share > 0 && label !== 'locked' ? `${share}% known` : null, detail };
  }

  // True when the pitch classes `pcs` appear in `heard` (midis) in that order, other notes allowed between.
  function heardInOrder(heard, pcs = [0, 4, 7]) {
    let i = 0;
    for (const m of heard || []) {
      if (i < pcs.length && (((m % 12) + 12) % 12) === pcs[i]) i++;
    }
    return i >= pcs.length;
  }

  const Core = { COMFORT_TEXT, STATE_WORD, keyLetter, listLetters, comfortText, heardInOrder };
  if (isNode) { module.exports = Core; return; }

  // ======================================================================
  // BROWSER
  // ======================================================================
  const NS = root.NS;

  const TOKEN_NAMES = {
    paper: '--paper', card: '--card', ink: '--ink', muted: '--muted', line: '--line', accent: '--accent',
    accentSoft: '--accent-soft', good: '--good', goodSoft: '--good-soft', bad: '--bad', badSoft: '--bad-soft',
    gold: '--gold', learn: '--learn', learnSoft: '--learn-soft', listen: '--listen', listenSoft: '--listen-soft',
    shape: '--shape', keyPlaying: '--key-playing',
    // extras (§7.2 compare colours, keyboard)
    song: '--song', yours: '--yours', match: '--match', keyHint: '--key-hint', keyHeard: '--key-heard',
  };
  function tokens() {
    const cs = getComputedStyle(document.documentElement);
    const out = {};
    for (const k in TOKEN_NAMES) out[k] = cs.getPropertyValue(TOKEN_NAMES[k]).trim();
    return out;
  }

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  let uid = 0;
  const nextId = (p) => `${p}${++uid}`;

  // ---------- frame: top bar with back button, eyebrow and title ----------
  function frame(rootEl, { eyebrow = '', title = '', back = true, right } = {}) {
    const bar = el('div', 'topbar');
    if (back) {
      const b = el('button', 'back', '←');
      b.setAttribute('aria-label', 'Back');
      b.addEventListener('click', () => (typeof back === 'function' ? back() : NS.shell.back()));
      bar.appendChild(b);
    }
    const t = el('div', 'title');
    const eb = el('span', 'eyebrow', eyebrow);
    const h = el('h2', null, title);
    t.append(eb, h);
    bar.appendChild(t);
    if (right) bar.appendChild(right);
    const body = el('div', 'frame-body');
    rootEl.append(bar, body);
    return { body, bar, setTitle: (s) => (h.textContent = s), setEyebrow: (s) => (eb.textContent = s) };
  }

  // ---------- feedback panel (aria-live). kind: 'good' | 'bad' | 'neutral' ----------
  function feedback(container) {
    const fb = el('div', 'feedback');
    fb.setAttribute('aria-live', 'polite');
    const big = el('span', 'big');
    const small = el('span', 'muted');
    fb.append(big, small);
    container.appendChild(fb);
    return {
      el: fb,
      set(kind, b, s) {
        fb.className = 'feedback' + (kind === 'good' ? ' good' : kind === 'bad' ? ' bad' : '');
        big.textContent = b;
        small.textContent = s || '';
      },
    };
  }

  // ---------- mic button, meter and notice (every [data-mic-*] on the page) ----------
  let lastMicMessage = '';
  function updateMicUi() {
    const on = NS.mic.isOn();
    document.querySelectorAll('[data-mic-btn]').forEach((b) => {
      b.textContent = on ? '🎤 Listening… (tap to stop)' : '🎤 Start listening';
      b.classList.toggle('primary', !on);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    document.querySelectorAll('[data-mic-meter-wrap]').forEach((e) => (e.hidden = !on));
  }
  function micNotice(text) {
    lastMicMessage = text || '';
    document.querySelectorAll('[data-mic-notice]').forEach((e) => {
      e.hidden = !text;
      e.textContent = text || '';
    });
  }
  NS.bus.on('mic:state', (s) => {
    updateMicUi();
    if (s.on) micNotice('');
    else if (s.message) micNotice(s.message);
  });
  NS.bus.on('mic:level', ({ rms }) => {
    const w = Math.min(100, rms * 900) + '%';
    document.querySelectorAll('[data-mic-meter]').forEach((m) => (m.style.width = w));
  });

  // The same mic control on every screen: a button and a level meter, plus (opt-in) the notice line.
  function micBar(container, { notice = false } = {}) {
    const wrap = el('div', 'micbar');
    const row = el('div', 'controls');
    const btn = el('button', 'btn primary', '🎤 Start listening');
    btn.setAttribute('data-mic-btn', '');
    btn.setAttribute('aria-pressed', 'false');
    const meter = el('div', 'meter');
    meter.setAttribute('data-mic-meter-wrap', '');
    meter.setAttribute('aria-hidden', 'true');
    meter.hidden = true;
    meter.innerHTML = '<span>Mic</span><div class="bar"><div data-mic-meter></div></div>';
    // Sensitivity: how much the app boosts the mic. Cycles Normal (x2), High (x4), Max (x10).
    const LEVELS = [[2, 'Normal'], [4, 'High'], [10, 'Max']];
    const sens = el('button', 'btn');
    sens.type = 'button';
    const label = () => {
      const b = NS.mic.boost ? NS.mic.boost() : 4;
      const cur = LEVELS.reduce((a, l) => (Math.abs(l[0] - b) < Math.abs(a[0] - b) ? l : a));
      sens.textContent = `Sensitivity: ${cur[1]}`;
      return cur;
    };
    label();
    sens.addEventListener('click', () => {
      const cur = label();
      const next = LEVELS[(LEVELS.indexOf(cur) + 1) % LEVELS.length];
      NS.mic.setBoost(next[0]);
      label();
    });
    row.append(btn, sens, meter);
    let noteEl = null;
    const onClick = () => {
      NS.audio.resume();
      if (NS.mic.isOn()) NS.mic.stop(); else NS.mic.start();
    };
    btn.addEventListener('click', onClick);
    if (notice) {
      noteEl = el('p', 'notice');
      noteEl.setAttribute('data-mic-notice', '');
      noteEl.setAttribute('role', 'status');
      noteEl.hidden = !lastMicMessage;
      noteEl.textContent = lastMicMessage;
    }
    // Without the notice the row itself is returned as .el (Practice swaps it into its own slot).
    let outer = row;
    if (noteEl) { wrap.append(row, noteEl); outer = wrap; }
    if (container) container.appendChild(outer);
    updateMicUi();
    return {
      el: outer,
      destroy() { btn.removeEventListener('click', onClick); outer.remove(); },
    };
  }

  // ---------- layers: dialogs and sheets ----------
  const layers = new Set(); // {close(value), ov}
  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

  function openLayer(ov, panel, { onEscape, initialFocus } = {}) {
    const before = document.activeElement;
    const onKey = (e) => {
      if (![...layers].length || [...layers].pop().ov !== ov) return; // only the top layer reacts
      if (e.key === 'Escape') { e.preventDefault(); onEscape(); return; }
      if (e.key !== 'Tab') return;
      const f = [...panel.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
    document.documentElement.classList.add('ui-locked');
    const target = initialFocus || panel.querySelector('.primary') || panel.querySelector(FOCUSABLE);
    if (target) target.focus({ preventScroll: true });
    return function teardown() {
      document.removeEventListener('keydown', onKey);
      ov.remove();
      if (![...document.querySelectorAll('.ui-dialog, .ui-sheet')].length) document.documentElement.classList.remove('ui-locked');
      if (before && before.isConnected && typeof before.focus === 'function') before.focus({ preventScroll: true });
    };
  }

  // dialog({title, body: string|Node, actions:[{label, value, primary, cancel}]}) -> Promise<value>
  // Escape (or closeAll on a route change) resolves with the `cancel` action's value, or null.
  // The promise also has .close(value) and .el, so callers (micCheck) can update or close it.
  function dialog({ title = '', body = '', actions = [{ label: 'OK', value: true, primary: true }], className = '' } = {}) {
    let resolveFn;
    const promise = new Promise((r) => (resolveFn = r));
    const ov = el('div', 'overlay ui-dialog');
    const d = el('div', 'dialog' + (className ? ' ' + className : ''));
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-modal', 'true');
    const h = el('h2', null, title);
    h.id = nextId('uiDialogTitle');
    d.setAttribute('aria-labelledby', h.id);
    d.appendChild(h);
    if (typeof body === 'string') { const p = el('p', 'muted', body); p.id = nextId('uiDialogBody'); d.setAttribute('aria-describedby', p.id); d.appendChild(p); }
    else if (body) d.appendChild(body);
    const row = el('div', 'row');
    let done = false;
    const cancelVal = (actions.find((a) => a.cancel) || {}).value;
    const layer = { ov, close: (v) => finish(v) };
    function finish(v) {
      if (done) return;
      done = true;
      layers.delete(layer);
      teardown();
      resolveFn(v);
    }
    actions.forEach((a) => {
      const b = el('button', 'btn' + (a.primary ? ' primary' : ''), a.label);
      if (a.value !== undefined) b.dataset.value = String(a.value);
      b.addEventListener('click', () => finish(a.value));
      row.appendChild(b);
    });
    if (actions.length) d.appendChild(row);
    ov.appendChild(d);
    layers.add(layer);
    const teardown = openLayer(ov, d, { onEscape: () => finish(cancelVal === undefined ? null : cancelVal) });
    promise.close = (v) => finish(v === undefined ? (cancelVal === undefined ? null : cancelVal) : v);
    promise.el = d;
    promise.actions = row;
    return promise;
  }

  // sheet({title, content, onClose}) -> {close, el, body}. A bottom sheet; tap outside or Escape closes.
  function sheet({ title = '', content, onClose } = {}) {
    const ov = el('div', 'overlay ui-sheet');
    const s = el('div', 'dialog sheet');
    s.setAttribute('role', 'dialog');
    s.setAttribute('aria-modal', 'true');
    const head = el('div', 'sheet-head');
    const h = el('h2', null, title);
    h.id = nextId('uiSheetTitle');
    s.setAttribute('aria-labelledby', h.id);
    const closeBtn = el('button', 'back', '×');
    closeBtn.setAttribute('aria-label', 'Close');
    head.append(h, closeBtn);
    const body = el('div', 'sheet-body');
    if (content) body.appendChild(content);
    s.append(head, body);
    ov.appendChild(s);
    let done = false;
    const layer = { ov, close: () => close() };
    function close() {
      if (done) return;
      done = true;
      layers.delete(layer);
      teardown();
      if (onClose) { try { onClose(); } catch (err) { console.error('[ui] sheet onClose failed', err); } }
    }
    closeBtn.addEventListener('click', close);
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    layers.add(layer);
    const teardown = openLayer(ov, s, { onEscape: close, initialFocus: closeBtn });
    return { close, el: s, body };
  }

  // Closes every open dialog and sheet (the shell calls this on each route change).
  function closeAll() { [...layers].reverse().forEach((l) => l.close()); }

  // ---------- toast ----------
  let toastEl = null;
  let toastTimer = null;
  function toast(text, { action, ms = 3500 } = {}) {
    if (!toastEl) {
      toastEl = el('div', 'ui-toast');
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    toastEl.innerHTML = '';
    toastEl.appendChild(el('span', null, text));
    if (action) {
      const b = el('button', 'btn small', action.label);
      b.addEventListener('click', () => { toastEl.hidden = true; action.fn(); });
      toastEl.appendChild(b);
    }
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), ms);
  }

  // ---------- chips and segmented controls ----------
  function chip(label, { pressed = false, onClick } = {}) {
    const b = el('button', 'btn small chip' + (pressed ? ' on' : ''), label);
    b.setAttribute('aria-pressed', String(Boolean(pressed)));
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }

  // seg(options, value, onChange, {label}) -> radiogroup. options: values or {value, label}.
  function seg(options, value, onChange, { label } = {}) {
    const wrap = el('div', 'speed seg');
    wrap.setAttribute('role', 'radiogroup');
    if (label) wrap.setAttribute('aria-label', label);
    const opts = options.map((o) => (typeof o === 'object' ? o : { value: o, label: String(o) }));
    const buttons = [];
    function select(i, focus) {
      buttons.forEach((b, j) => {
        const on = j === i;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
      });
      if (focus) buttons[i].focus();
    }
    opts.forEach((opt, i) => {
      const b = el('button', '', opt.label);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => {
        const was = buttons.findIndex((x) => x.classList.contains('on'));
        select(i, false);
        if (was !== i && onChange) onChange(opt.value);
      });
      buttons.push(b);
      wrap.appendChild(b);
    });
    wrap.addEventListener('keydown', (e) => {
      const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      const cur = buttons.findIndex((x) => x.classList.contains('on'));
      const i = Math.min(buttons.length - 1, Math.max(0, cur + dir));
      if (i === cur) return;
      select(i, true);
      if (onChange) onChange(opts[i].value);
    });
    const start = opts.findIndex((o) => o.value === value);
    select(start < 0 ? 0 : start, false);
    return wrap;
  }

  // ---------- comfort pill and note chips (Home, library, song sheet, Practice intro) ----------
  // comfortPill(comfort, {known:true, detail:false, lockedDetail:true}) -> <span class="pill-line">
  //   detail: add '1 new note: G' / 'Learn G to unlock'; lockedDetail:false drops the unlock text
  //   (when the row shows its own reason).
  function comfortPill(c, { known = true, detail = false, lockedDetail = true, keys } = {}) {
    const t = comfortText(c, { context: keys });
    const line = el('span', 'pill-line');
    const pill = el('span', `pill pill-${t.label}`, t.text);
    line.appendChild(pill);
    const extra = [];
    const showDetail = t.detail && (t.label === 'locked' ? lockedDetail : detail);
    if (showDetail) extra.push(t.detail);
    if (known && t.known) extra.push(t.known);
    if (extra.length) line.appendChild(el('span', 'pill-extra', extra.join(' · ')));
    return line;
  }

  const STATE_MARK = { known: '✓', learning: '◐', new: '•', locked: '' };
  // noteChips(keys, stateOf(key) -> 'known'|'learning'|'new'|'locked', {rusty(key)}) -> <ul class="note-chips">
  function noteChips(keys, stateOf, { rusty } = {}) {
    const ul = el('ul', 'note-chips');
    ul.setAttribute('aria-label', 'Notes in this song');
    const multi = {};
    (keys || []).forEach((k) => { const l = keyLetter(k); multi[l] = (multi[l] || 0) + 1; });
    (keys || []).forEach((k) => {
      const st = (stateOf && stateOf(k)) || 'new';
      const r = Boolean(rusty && rusty(k));
      const li = el('li', `note-chip st-${st}${r ? ' rusty' : ''}`);
      const l = keyLetter(k);
      const name = multi[l] > 1 ? l + (/(-?\d+)$/.exec(k) || ['', ''])[1] : l;
      li.appendChild(el('span', 'nc-letter', name));
      if (STATE_MARK[st]) { const m = el('span', 'nc-mark', STATE_MARK[st]); m.setAttribute('aria-hidden', 'true'); li.appendChild(m); }
      li.appendChild(el('span', 'sr-only', `, ${STATE_WORD[st] || st}${r ? ', due for review' : ''}`));
      li.title = `${name}: ${STATE_WORD[st] || st}${r ? ' (due for review)' : ''}`;
      ul.appendChild(li);
    });
    return ul;
  }

  // ---------- sound check: plays C5, asks "Did you hear that?" ----------
  function setFirstRun(key) {
    try {
      const fr = Object.assign({ sound: false, mic: false }, NS.store.settings().firstRun);
      if (fr[key]) return;
      fr[key] = true;
      NS.store.setSetting('firstRun', fr);
    } catch (err) { /* settings are optional here */ }
  }
  async function soundCheck() {
    const play = () => { NS.audio.resume(); NS.audio.playTone(72, 1.2, 0.05, { voice: 'piano', muteMic: true }); };
    play();
    for (;;) {
      const v = await dialog({
        title: 'Sound check',
        body: 'Did you hear that?',
        actions: [{ label: 'No', value: 'no' }, { label: 'Yes', value: 'yes', primary: true }],
      });
      if (v === 'yes') { setFirstRun('sound'); return true; }
      if (v == null) return false;
      const again = await dialog({
        title: 'No sound?',
        body: 'Check the silent switch and the volume.',
        actions: [{ label: 'OK', value: 'ok', cancel: true }, { label: 'Play it again', value: 'again', primary: true }],
      });
      if (again !== 'again') return false;
      play();
    }
  }

  // ---------- mic check: "Play C, then E, then G." within 10 s ----------
  const CHECK_PCS = [0, 4, 7];
  const CHECK_NAMES = ['C', 'E', 'G'];
  async function micCheck({ ms = 10000 } = {}) {
    NS.audio.resume();
    if (!NS.mic.isOn()) {
      const r = await NS.mic.start();
      if (!r || !r.ok) {
        await dialog({ title: 'Mic check', body: (r && r.message) || 'The microphone didn’t start.', actions: [{ label: 'OK', value: true, primary: true }] });
        return { ok: false, heard: [] };
      }
    }
    const body = el('div', 'mic-check');
    body.appendChild(el('p', null, 'Play C, then E, then G.'));
    const targets = el('ol', 'mc-targets');
    const items = CHECK_NAMES.map((n) => {
      const li = el('li', 'mc-target');
      li.appendChild(el('span', 'nc-letter', n));
      const sr = el('span', 'sr-only', ', waiting');
      li.appendChild(sr);
      targets.appendChild(li);
      return { li, sr };
    });
    body.appendChild(targets);
    const status = el('p', 'muted mc-status');
    status.setAttribute('aria-live', 'polite');
    body.appendChild(status);

    const heard = [];
    let step = 0;
    let ok = false;
    const deadline = performance.now() + ms;
    const p = dialog({ title: 'Mic check', body, actions: [{ label: 'Cancel', value: 'cancel', cancel: true }] });
    const showLeft = () => {
      const left = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
      if (!ok) status.textContent = step === 0 ? `Listening… ${left} s left.` : `Heard ${CHECK_NAMES.slice(0, step).join(', ')}. ${left} s left.`;
    };
    showLeft();
    const tick = setInterval(() => {
      showLeft();
      if (performance.now() >= deadline) p.close('timeout');
    }, 250);
    const off = NS.input.on((ev) => {
      if (ev.source !== 'mic' || ok) return;
      heard.push(ev.midi);
      if (((ev.midi % 12) + 12) % 12 === CHECK_PCS[step]) {
        items[step].li.classList.add('heard');
        items[step].sr.textContent = ', heard';
        step++;
      }
      if (heardInOrder(heard, CHECK_PCS)) {
        ok = true;
        status.textContent = 'Your mic hears you. All set!';
        setTimeout(() => p.close('ok'), 900);
      } else showLeft();
    });
    const result = await p;
    clearInterval(tick);
    off();
    if (ok || result === 'ok') { setFirstRun('mic'); return { ok: true, heard }; }
    if (result === 'cancel' || result == null) return { ok: false, heard };
    const again = await dialog({
      title: 'Mic check',
      body: heard.length
        ? 'I didn’t hear C, E and G in that order. Play each note on its own, a little louder, with the phone near the piano.'
        : 'I didn’t hear anything. Move the phone closer to the piano and play a little louder.',
      actions: [{ label: 'OK', value: 'ok', cancel: true }, { label: 'Try again', value: 'again', primary: true }],
    });
    if (again === 'again') return micCheck({ ms });
    return { ok: false, heard };
  }

  NS.ui = {
    tokens, frame, feedback, micBar, micNotice, dialog, sheet, closeAll, toast, chip, seg,
    comfortPill, noteChips, soundCheck, micCheck, core: Core,
  };
})(typeof window !== 'undefined' ? window : globalThis);
