// On-screen piano keyboard. NS.keyboard.create(container, opts) -> K; NS.keyboard.rangeFor(notes, {width}).
// Load after core/audio.js. Spec §2.4.4.
//
// A key press (pointerdown, or Enter / Space on a focused key) resumes audio, plays the note (a short
// tap tone that mutes the mic but never makes NS.audio busy), emits an InputEvent {source:'screen'} on
// NS.input and calls onPress(midi, e). Key states, highest priority first: heard (blue), hint (green),
// playing (amber, during playback), lit 'call' (amber) / 'guide' (green). Notes outside the range are
// folded in by octaves and the folded key gets a small ▲ / ▼. The keyboard's own CSS (kb- prefix) is
// injected once; the base .keyboard rules live in index.html.
//
// rangeFor() is pure and also loads in Node (require('./keyboard.js')).
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports && typeof window === 'undefined';
  const pcOf = (m) => ((m % 12) + 12) % 12;
  const isBlack = (m) => [1, 3, 6, 8, 10].includes(pcOf(m));

  // White-aligned range for a set of notes (midi numbers or {midi}). At least C4..E5; grows to cover
  // every note; at most 13 white keys when width < 420 (15 otherwise). When the notes need more, the
  // window that holds the most notes wins (ties: the one nearest middle C), and the rest are folded.
  function rangeFor(notes, { width } = {}) {
    if (width == null) width = typeof root.innerWidth === 'number' ? root.innerWidth : 1024;
    const maxWhites = width < 420 ? 13 : 15;
    const midis = (notes || []).map((n) => (typeof n === 'number' ? n : n && n.midi)).filter(Number.isFinite);
    let low = 60;
    let high = 76;
    midis.forEach((m) => { if (m < low) low = m; if (m > high) high = m; });
    if (isBlack(low)) low--;
    if (isBlack(high)) high++;
    const whites = [];
    for (let m = low; m <= high; m++) if (!isBlack(m)) whites.push(m);
    if (whites.length <= maxWhites) return { low, high };
    let best = null;
    for (let i = 0; i + maxWhites <= whites.length; i++) {
      const lo = whites[i];
      const hi = whites[i + maxWhites - 1];
      const inside = midis.filter((m) => m >= lo && m <= hi).length;
      const dist = Math.abs((lo + hi) / 2 - 66); // 66 = the middle of C4..C5
      if (!best || inside > best.inside || (inside === best.inside && dist < best.dist)) best = { lo, hi, inside, dist };
    }
    return { low: best.lo, high: best.hi };
  }

  if (isNode) { module.exports = { rangeFor, isBlack }; return; }

  const NS = root.NS;
  const { midiName } = root.Pitch;

  const CSS = `
.keyboard [data-midi] { overflow: hidden; }
.keyboard [data-midi]:focus-visible { outline: 3px solid var(--accent); outline-offset: -3px; z-index: 3; }
.keyboard .white:active { filter: brightness(0.93); }
.keyboard .white.playing, .keyboard .white.lit-call { background: var(--key-playing); box-shadow: inset 0 -6px 0 var(--listen); color: var(--ink); }
.keyboard .black.playing, .keyboard .black.lit-call { background: var(--listen); }
.keyboard .white.lit-guide { background: var(--key-hint); box-shadow: inset 0 -6px 0 var(--good); }
.keyboard .black.lit-guide { background: var(--good); }
.keyboard .mark-dim { opacity: 0.45; }
.keyboard .kb-label { pointer-events: none; }
.keyboard .kb-finger { position: absolute; top: 5px; left: 0; right: 0; text-align: center; font-size: 0.72rem; font-weight: 700; line-height: 1; color: inherit; pointer-events: none; }
.keyboard .black .kb-finger { color: var(--key-white); }
.keyboard .kb-fold { position: absolute; top: 20px; left: 0; right: 0; text-align: center; font-size: 0.62rem; line-height: 1; color: inherit; pointer-events: none; }
.keyboard .black .kb-fold { color: var(--key-white); }
.keyboard .kb-mark { position: absolute; top: 34px; left: 50%; width: 8px; height: 8px; margin-left: -4px; border-radius: 50%; pointer-events: none; }
.keyboard .mark-new .kb-mark { background: var(--accent); }
.keyboard .mark-learning .kb-mark { background: var(--learn); }
.keyboard .mark-target .kb-mark { background: transparent; box-shadow: 0 0 0 2px var(--accent); }
.keyboard .black .kb-mark { top: auto; bottom: 8px; }
.keyboard.kb-narrow .middle-c::after { content: "mid"; }
`;
  function injectCss() {
    if (typeof document === 'undefined' || document.getElementById('ns-keyboard-css')) return;
    const s = document.createElement('style');
    s.id = 'ns-keyboard-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function create(container, {
    low = 60, high = 76, labels = 'all', emit = true, sound = true, tapDur = 0.4, onPress,
  } = {}) {
    injectCss();
    let lo = low;
    let hi = high;
    let labelMode = labels;
    let heard = null; // the midi as heard (folded when drawn)
    let heardTimer = null;
    let hint = [];
    let lit = [];
    let litTone = 'call';
    let playing = null;
    let marks = {};
    let fingers = null;
    let destroyed = false;

    // Folds a midi into the range by octaves. -> {m, dir: 'up' (it was higher) | 'down' | ''}
    function fold(m) {
      if (m == null || !Number.isFinite(m)) return null;
      let f = m;
      while (f < lo) f += 12;
      while (f > hi) f -= 12;
      if (f < lo) return null; // range narrower than an octave and no match
      return { m: f, dir: m > hi ? 'up' : m < lo ? 'down' : '' };
    }
    const asArr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
    const foldAll = (v) => asArr(v).map(fold).filter(Boolean);
    const foldMap = (obj) => {
      const out = {};
      Object.keys(obj || {}).forEach((k) => { const f = fold(Number(k)); if (f && out[f.m] == null) out[f.m] = obj[k]; });
      return out;
    };

    // Letter names go on white keys only (as in v1); the black keys are too narrow at 375 px.
    function showLabel(m) {
      if (isBlack(m) || labelMode === 'none' || !labelMode) return false;
      if (typeof labelMode === 'function') {
        try { return Boolean(labelMode(m)); } catch { return false; }
      }
      return true;
    }

    function keyEl(m, cls, left, width) {
      const k = document.createElement('button');
      k.type = 'button';
      k.className = cls + (m === 60 ? ' middle-c' : '');
      k.style.left = left + '%';
      k.style.width = width + '%';
      k.dataset.midi = m;
      k.setAttribute('aria-label', midiName(m) + (m === 60 ? ' (middle C)' : ''));
      k.innerHTML = '<span class="kb-finger" aria-hidden="true"></span><span class="kb-fold" aria-hidden="true"></span>'
        + '<span class="kb-mark" aria-hidden="true"></span><span class="kb-label" aria-hidden="true"></span>';
      return k;
    }

    function build() {
      container.innerHTML = '';
      const whites = [];
      for (let m = lo; m <= hi; m++) if (!isBlack(m)) whites.push(m);
      const w = 100 / whites.length;
      container.classList.toggle('kb-narrow', whites.length > 10);
      whites.forEach((m, i) => container.appendChild(keyEl(m, 'white', i * w, w)));
      for (let m = lo; m <= hi; m++) {
        if (!isBlack(m)) continue;
        const whiteBelow = whites.indexOf(m - 1);
        if (whiteBelow < 0 || whiteBelow === whites.length - 1) continue;
        container.appendChild(keyEl(m, 'black', (whiteBelow + 1) * w - w * 0.3, w * 0.6));
      }
      refresh();
    }

    function refresh() {
      if (destroyed) return;
      const hintF = foldAll(hint);
      const litF = foldAll(lit);
      const playF = fold(playing);
      const marksF = foldMap(marks);
      const fingersF = fingers ? foldMap(fingers) : null;
      const heardF = fold(heard);
      const dirs = {};
      [playF, ...litF, ...hintF, heardF].forEach((f) => { if (f && f.dir) dirs[f.m] = f.dir; });
      container.querySelectorAll('[data-midi]').forEach((k) => {
        const m = Number(k.dataset.midi);
        const isHeard = !!heardF && heardF.m === m;
        const isHint = !isHeard && hintF.some((f) => f.m === m);
        const isPlaying = !isHeard && !isHint && !!playF && playF.m === m;
        const litHere = !isHeard && !isHint && !isPlaying && litF.some((f) => f.m === m);
        k.classList.toggle('heard', isHeard);
        k.classList.toggle('hint', isHint);
        k.classList.toggle('playing', isPlaying);
        k.classList.toggle('lit-call', litHere && litTone !== 'guide');
        k.classList.toggle('lit-guide', litHere && litTone === 'guide');
        ['new', 'learning', 'target', 'dim'].forEach((c) => k.classList.toggle('mark-' + c, marksF[m] === c));
        const fin = fingersF && fingersF[m];
        k.querySelector('.kb-finger').textContent = fin ? String(fin) : '';
        if (fin) k.dataset.finger = fin; else delete k.dataset.finger;
        k.querySelector('.kb-fold').textContent = dirs[m] === 'up' ? '▲' : dirs[m] === 'down' ? '▼' : '';
        k.querySelector('.kb-label').textContent = showLabel(m) ? midiName(m) : '';
        let label = midiName(m) + (m === 60 ? ' (middle C)' : '');
        if (fin) label += ', finger ' + fin;
        k.setAttribute('aria-label', label);
      });
    }

    function press(m, e) {
      NS.audio.resume();
      if (sound) NS.audio.playTone(m, tapDur, 0, { muteMic: true, busy: false });
      if (emit) {
        NS.input.emit({
          midi: m, at: NS.audio.heardAt(e.timeStamp), tOnset: e.timeStamp, source: 'screen',
          confident: true, reason: 'tap', rms: null, cents: null,
        });
      }
      if (onPress) onPress(m, e);
    }
    function keyOf(e) {
      const key = e.target && e.target.closest ? e.target.closest('[data-midi]') : null;
      return key && container.contains(key) ? key : null;
    }
    function onDown(e) {
      if (e.button != null && e.button > 0) return; // right / middle mouse button
      const key = keyOf(e);
      if (!key) return;
      e.preventDefault();
      press(Number(key.dataset.midi), e);
    }
    // Keyboard activation (Enter / Space) arrives as a click with detail 0; pointer clicks were handled.
    function onClick(e) {
      const key = keyOf(e);
      if (!key || e.detail !== 0) return;
      press(Number(key.dataset.midi), e);
    }
    container.addEventListener('pointerdown', onDown);
    container.addEventListener('click', onClick);
    build();

    return {
      setHeard(midi, ms = 1400) {
        heard = Number.isFinite(midi) ? midi : null;
        clearTimeout(heardTimer);
        if (heard != null) heardTimer = setTimeout(() => { heard = null; refresh(); }, ms);
        refresh();
      },
      setHint(v) { hint = asArr(v); refresh(); },
      setLit(arr, { tone = 'call' } = {}) { lit = asArr(arr); litTone = tone; refresh(); },
      setPlaying(m) { playing = m == null ? null : m; refresh(); },
      setMarks(obj) { marks = obj || {}; refresh(); },
      setFingers(obj) { fingers = obj || null; refresh(); },
      setLabels(mode) { labelMode = mode; refresh(); },
      setRange(l, h) {
        if (!Number.isFinite(l) || !Number.isFinite(h) || h < l) return;
        lo = isBlack(l) ? l - 1 : l;
        hi = isBlack(h) ? h + 1 : h;
        build();
      },
      range: () => ({ low: lo, high: hi }),
      refresh,
      destroy() {
        destroyed = true;
        clearTimeout(heardTimer);
        container.removeEventListener('pointerdown', onDown);
        container.removeEventListener('click', onClick);
        container.innerHTML = '';
      },
    };
  }

  NS.keyboard = { create, rangeFor, isBlack };
})(typeof window !== 'undefined' ? window : globalThis);
