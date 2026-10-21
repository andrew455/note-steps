// Chord cards for the lesson-complete popup: a mini keyboard per chord with the right-hand fingering,
// the chord name, what playing it does, and a plain-words fingering hint. Sets window.ChordCard.
(function (root) {
  'use strict';

  const SVG = 'http://www.w3.org/2000/svg';
  const STYLE_ID = 'cc-style';
  const FINGER = { 1: 'thumb', 2: 'index finger', 3: 'middle finger', 4: 'ring finger', 5: 'little finger' };
  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const LETTER_SEMIS = [0, 2, 4, 5, 7, 9, 11];
  const BLACK = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5 }; // black-key semitone -> index of the white key on its left
  const WK = 18;  // white key width in SVG units
  const WH = 54;  // white key height
  const BW = 11;  // black key width
  const BH = 34;  // black key height

  const CSS = `
.cc-root { container-type: inline-size; display: flex; flex-direction: column; gap: 10px; text-align: center; }
.cc-eyebrow { font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); font-weight: 700; margin: 0; }
.cc-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
@container (min-width: 280px) { .cc-grid.cc-two { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.cc-card { --cc-hi: var(--accent); --cc-hi-key: var(--key-heard, var(--accent-soft)); --cc-text: var(--accent); --cc-dot: var(--accent); background: var(--paper); border: 1.5px solid var(--line); border-radius: 14px; padding: 10px 10px 12px; display: flex; flex-direction: column; gap: 6px; min-width: 0; transition: background 0.2s ease, border-color 0.2s ease; }
.cc-name { font-family: var(--font-display); font-weight: 800; font-size: 1.1rem; line-height: 1.15; margin: 0; color: var(--ink); }
.cc-notes { display: block; font-family: var(--font-body); font-weight: 400; font-size: 0.8rem; color: var(--muted); margin-top: 2px; }
.cc-do { margin: 0; font-size: 0.9rem; line-height: 1.3; color: var(--ink); }
.cc-do strong { color: var(--cc-text); }
.cc-kb { display: block; width: 100%; max-width: 220px; height: auto; margin: 2px auto 0; overflow: visible; }
.cc-w { fill: var(--key-white); stroke: var(--line); stroke-width: 1.2; }
.cc-b { fill: var(--key-black); }
.cc-w.cc-on { fill: var(--cc-hi-key); stroke: var(--cc-hi); stroke-width: 1.6; }
.cc-b.cc-on { fill: var(--cc-hi); stroke: var(--key-black); stroke-width: 1; }
.cc-dot { fill: var(--cc-dot); }
.cc-dot.cc-onb { fill: var(--card); stroke: var(--key-black); stroke-width: 1; }
.cc-num { fill: var(--card); font-family: var(--font-display); font-weight: 800; font-size: 12px; }
.cc-num.cc-onb { fill: var(--cc-dot); font-size: 12px; }
.cc-hint { margin: 0; font-size: 0.8rem; line-height: 1.35; color: var(--muted); text-wrap: pretty; }
.cc-status { margin: 0; font-size: 0.88rem; line-height: 1.4; color: var(--muted); min-height: 1.4em; }
.cc-status .cc-led { display: inline-block; width: 9px; height: 9px; margin-right: 7px; vertical-align: 0.05em; border-radius: 50%; background: var(--accent); animation: cc-pulse 1.6s ease-in-out infinite; }
.cc-status.cc-off .cc-led { background: var(--line); animation: none; }
.cc-status.cc-got { color: var(--ink); font-weight: 700; }
.cc-status.cc-got .cc-led { background: var(--good); animation: none; }
.cc-card.cc-flash { --cc-hi: var(--good); --cc-hi-key: var(--key-hint, var(--good-soft)); --cc-text: var(--ink); --cc-dot: var(--ink); background: var(--good-soft); border-color: var(--good); animation: cc-pop 0.45s ease-out; }
.cc-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
@keyframes cc-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
@keyframes cc-pop { 0% { transform: scale(1); } 40% { transform: scale(1.04); } 100% { transform: scale(1); } }
@media (prefers-reduced-motion: reduce) {
  .cc-card, .cc-card.cc-flash { transition: none; animation: none; }
  .cc-status .cc-led { animation: none; }
}
`;

  function injectStyle(doc) {
    if (doc.getElementById(STYLE_ID)) return;
    const s = doc.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(s);
  }

  // 'Eb4' -> { midi: 63, label: 'E♭', black: true, desc: 'E♭, the black key just left of E' }
  function parse(name) {
    const m = /^([A-G])([#b♯♭]?)(-?\d)$/.exec(String(name).trim());
    if (!m) throw new Error('ChordCard: bad note ' + name);
    const li = LETTERS.indexOf(m[1]);
    const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
    const midi = 12 * (Number(m[3]) + 1) + LETTER_SEMIS[li] + acc;
    const label = m[1] + (acc > 0 ? '♯' : acc < 0 ? '♭' : '');
    const black = ((midi % 12) + 12) % 12 in BLACK;
    let desc = label;
    if (black) desc = acc < 0 ? `${label} (the black key just left of ${m[1]})` : `${label} (the black key just right of ${m[1]})`;
    return { midi, label, black, desc };
  }

  function fingeringHint(notes, fingers) {
    const parts = notes.map((n, i) => `${FINGER[fingers[i]] || 'finger ' + fingers[i]} on ${n.desc}`);
    return 'Right hand: ' + parts.join(', ') + '.';
  }

  function svgEl(tag, attrs, parent) {
    const el = parent.ownerDocument.createElementNS(SVG, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    parent.appendChild(el);
    return el;
  }

  // Mini keyboard from the C at or below the lowest note to the C above (at least C4 to C5).
  function keyboard(doc, notes, fingers, label) {
    const lo = Math.min(60, ...notes.map((n) => n.midi));
    const hi = Math.max(72, ...notes.map((n) => n.midi));
    const start = lo - (((lo % 12) + 12) % 12);
    const end = hi + ((12 - (((hi % 12) + 12) % 12)) % 12);
    const whites = [];
    for (let m = start; m <= end; m++) if (!(((m % 12) + 12) % 12 in BLACK)) whites.push(m);
    const wrap = doc.createElement('div');
    const svg = doc.createElementNS(SVG, 'svg');
    wrap.appendChild(svg);
    const W = whites.length * WK;
    svg.setAttribute('viewBox', `-1 -1 ${W + 2} ${WH + 2}`);
    svg.setAttribute('class', 'cc-kb');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
    const fingerOf = new Map(notes.map((n, i) => [n.midi, fingers[i]]));
    const xOf = new Map();

    whites.forEach((m, i) => {
      const on = fingerOf.has(m);
      xOf.set(m, i * WK);
      svgEl('rect', { x: i * WK, y: 0, width: WK, height: WH, rx: 2.5, class: 'cc-w' + (on ? ' cc-on' : '') }, svg);
    });
    for (let m = start; m < end; m++) {
      const pc = ((m % 12) + 12) % 12;
      if (!(pc in BLACK)) continue;
      const leftWhite = xOf.get(m - 1);
      const x = leftWhite + WK - BW / 2;
      xOf.set(m, x);
      svgEl('rect', { x, y: 0, width: BW, height: BH, rx: 1.5, class: 'cc-b' + (fingerOf.has(m) ? ' cc-on' : '') }, svg);
    }
    // Finger numbers sit on the keys they press.
    notes.forEach((n, i) => {
      const x = xOf.get(n.midi);
      if (x == null) return;
      const black = n.black;
      const cx = black ? x + BW / 2 : x + WK / 2;
      const cy = black ? BH - 9 : WH - 11;
      const r = 7.5; // the black-key dot overhangs the 11-unit key slightly so its 12-unit digit fits
      svgEl('circle', { cx, cy, r, class: 'cc-dot' + (black ? ' cc-onb' : '') }, svg);
      const t = svgEl('text', {
        x: cx, y: cy + 0.5, 'text-anchor': 'middle', 'dominant-baseline': 'central',
        class: 'cc-num' + (black ? ' cc-onb' : ''),
      }, svg);
      t.textContent = String(fingers[i]);
    });
    svg.setAttribute('focusable', 'false');
    return svg;
  }

  function render(container, opts) {
    const doc = container.ownerDocument || document;
    injectStyle(doc);
    const chords = (opts && opts.chords) || [];
    const rootEl = doc.createElement('div');
    rootEl.className = 'cc-root';

    const eyebrow = doc.createElement('p');
    eyebrow.className = 'cc-eyebrow';
    eyebrow.textContent = chords.length > 1 ? 'Or play a chord' : 'Or play this chord';
    rootEl.appendChild(eyebrow);

    const grid = doc.createElement('div');
    grid.className = 'cc-grid' + (chords.length > 1 ? ' cc-two' : '');
    rootEl.appendChild(grid);

    const cards = new Map();
    chords.forEach((c) => {
      const notes = c.notes.map(parse);
      const fingers = c.fingers || [1, 3, 5];
      const card = doc.createElement('div');
      card.className = 'cc-card';
      card.dataset.chord = c.id;

      const name = doc.createElement('p');
      name.className = 'cc-name';
      name.textContent = c.title;
      const noteLine = doc.createElement('span');
      noteLine.className = 'cc-notes';
      noteLine.textContent = notes.map((n) => n.label).join(' · ');
      name.appendChild(noteLine);
      card.appendChild(name);

      const doLine = doc.createElement('p');
      doLine.className = 'cc-do';
      doLine.append(`Play ${c.title} `);
      const arrow = doc.createElement('span');
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '→ ';
      const sr = doc.createElement('span');
      sr.className = 'cc-sr';
      sr.textContent = 'for ';
      const act = doc.createElement('strong');
      act.textContent = c.action;
      doLine.append(arrow, sr, act);
      card.appendChild(doLine);

      const hint = fingeringHint(notes, fingers);
      card.appendChild(keyboard(doc, notes, fingers, `${c.title} on the keyboard. ${hint}`));
      const hintEl = doc.createElement('p');
      hintEl.className = 'cc-hint';
      hintEl.textContent = hint;
      card.appendChild(hintEl);

      grid.appendChild(card);
      cards.set(c.id, { el: card, chord: c });
    });

    const status = doc.createElement('p');
    status.className = 'cc-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const led = doc.createElement('span');
    led.className = 'cc-led';
    led.setAttribute('aria-hidden', 'true');
    const statusText = doc.createElement('span');
    status.append(led, statusText);
    rootEl.appendChild(status);

    container.appendChild(rootEl);

    let listening = !!(opts && opts.listening);
    let flashTimer = null;
    let gotTimer = null;

    function showListening() {
      status.classList.remove('cc-got');
      status.classList.toggle('cc-off', !listening);
      statusText.textContent = listening
        ? 'Listening for a chord…'
        : 'Tap Start listening to use chords. The buttons work too.';
    }
    showListening();

    function flash(id) {
      const entry = cards.get(id);
      if (!entry) return;
      cards.forEach((v) => v.el.classList.remove('cc-flash'));
      void entry.el.offsetWidth; // restart the animation
      entry.el.classList.add('cc-flash');
      status.classList.remove('cc-off');
      status.classList.add('cc-got');
      statusText.textContent = `Heard ${entry.chord.title}. ${entry.chord.action}.`;
      clearTimeout(flashTimer);
      clearTimeout(gotTimer);
      flashTimer = setTimeout(() => entry.el.classList.remove('cc-flash'), 1200);
      gotTimer = setTimeout(showListening, 2500);
    }

    function setListening(on) {
      listening = !!on;
      if (!status.classList.contains('cc-got')) showListening();
    }

    function destroy() {
      clearTimeout(flashTimer);
      clearTimeout(gotTimer);
      rootEl.remove();
    }

    return { flash, setListening, destroy, element: rootEl };
  }

  const api = { render, fingeringHint: (names, fingers) => fingeringHint(names.map(parse), fingers) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ChordCard = api;
})(typeof window !== 'undefined' ? window : globalThis);
