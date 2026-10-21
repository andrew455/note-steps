// Staff drawing (browser). Load after core/ns.js, core/notation.js and core/shapes.js (spec §2.4.7, §3.5).
//
//   NS.staff.legacy        the exact app.js drawing that perform.js uses through window.NoteSteps.
//                          DO NOT change it (bottom line y 96, labels y 150).
//   NS.staff.create(svg)   a drawing surface with the v2 geometry (bottom line y 108): staff, notes with
//                          accidentals / ledger lines / dots / labels / 8va badges / finger numbers,
//                          highlights, cursor, brackets, rests, bar lines and shape hints.
//   NS.staff.render(svg)   the paged reading staff every mode except Perform uses (one note per column).
//   NS.staff.renderColumns(svg)  columns that can hold several noteheads each (Play by Ear compare view).
//
// Colours are CSS custom properties (var(--accent) and so on), so a theme change recolours the SVG
// without a re-render. The few animations (label fade, reveal fade, rescue pulse) live in a small
// stylesheet this file injects once, and all of them switch off under prefers-reduced-motion.
(function (root) {
  const NS = root.NS;
  const { svgEl } = NS.util;

  // ======================================================================
  // LEGACY (app.js drawing; used by perform.js through compat)
  // ======================================================================
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

  const legacy = { STEP, BOTTOM, drawNote, drawStaffLines, noteRightEdge };

  // ======================================================================
  // V2 GEOMETRY (every mode except Perform)
  // ======================================================================
  const GEOM = {
    STEP: 6, // half the gap between staff lines
    BOTTOM: 108, // y of the bottom line (E4); C6 sits at y 36 and G3 at y 138
    LEFT: 74, // x of the first note
    SPACING: 52, // x between notes
    HEIGHT: 172, // viewBox height without the shape band
    BAND_HEIGHT: 200, // viewBox height with the shape band
    LABEL_Y: 162, // note-name row
    LABEL_Y_LOW: 168, // the label row when an 8vb badge sits above it
    LABEL_ROW: 15, // extra label rows (compare view) step down by this
    BAND_Y: 180, // shape arrow centre
    WORD_Y: 195, // shape word baseline
    BADGE_HIGH_Y: 14, // 8va / 15ma
    BADGE_LOW_Y: 156, // 8vb / 15mb (spec says 158; 156 clears the label row at 168)
    COL_TOP: 24, // highlight column
    COL_BOTTOM: 150,
    MARK_Y: 153, // compare view marks (✓, missed) under the staff
    ACC_X: -18, // accidental centre, relative to the note's x
    HEAD_RX: 7.2,
    HEAD_RY: 5.2,
    STEM: 36,
  };
  const FONT = 'Atkinson Hyperlegible, system-ui, sans-serif';
  const CLEF_FONT = 'Noto Music, Bravura, Apple Symbols, serif';
  const ACC_GLYPH = { '#': '♯', b: '♭', n: '♮' };
  const STATE_COLOR = {
    done: 'var(--good)', current: 'var(--accent)', bad: 'var(--bad)', upcoming: 'var(--ink)',
    ghost: 'var(--line)', listen: 'var(--listen, var(--gold))',
  };
  const COLUMN_FILL = {
    current: 'var(--accent-soft)', bad: 'var(--bad-soft)', listen: 'var(--listen-soft, var(--accent-soft))',
  };
  const TINT = {
    new: { fill: 'var(--accent-soft)', stroke: 'var(--accent)', dash: '3 2' },
    learning: { fill: 'var(--learn-soft, var(--accent-soft))', stroke: 'none', dash: null },
  };
  const EPS = 1e-6;

  const CSS = `
.ns-staff .note-label { transition: opacity .3s ease; }
.ns-staff .label-fade { animation: ns-staff-fade .3s ease-out both; }
.ns-staff .reveal-in { animation: ns-staff-fade .15s ease-out both; }
.ns-staff .shape-rescue { animation: ns-staff-pulse .45s ease-in-out 2; transform-box: fill-box; transform-origin: center; }
.ns-staff .hit { cursor: pointer; outline: none; }
.ns-staff .hit:focus-visible { stroke: var(--accent); stroke-width: 2.5; }
@keyframes ns-staff-fade { from { opacity: 0; } }
@keyframes ns-staff-pulse { 50% { transform: scale(1.35); } }
@media (prefers-reduced-motion: reduce) {
  .ns-staff *, .ns-staff .shape-rescue, .ns-staff .label-fade, .ns-staff .reveal-in { animation: none !important; transition: none !important; }
}`;
  function ensureStyle() {
    if (typeof document === 'undefined' || document.getElementById('ns-staff-style')) return;
    const st = document.createElement('style');
    st.id = 'ns-staff-style';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  const notation = () => NS.notation;
  const shapes = () => NS.shapes;
  const asNote = (n) => (typeof n === 'number' ? notation().spellMidi(n) : n);
  const nameOf = (note) => (notation().displayName ? notation().displayName(note) : note.letter);

  function line(parent, x1, y1, x2, y2, width, extra) {
    const l = svgEl('line', Object.assign({ x1, y1, x2, y2, stroke: 'currentColor', 'stroke-width': width }, extra || {}), parent);
    return l;
  }
  function text(parent, x, y, str, { size = 15, weight = 700, color, opacity, anchor = 'middle', cls } = {}) {
    const t = svgEl('text', { x, y, 'text-anchor': anchor, 'font-size': size, 'font-weight': weight, 'font-family': FONT }, parent);
    t.style.fill = color || 'currentColor';
    if (opacity != null && opacity !== 1) t.style.opacity = String(opacity);
    if (cls) t.setAttribute('class', cls);
    t.textContent = str;
    return t;
  }

  // Accidentals as filled paths (no font glyphs), centred on (cx, y), about 10 px wide and 20 tall.
  function accidentalPath(kind, cx, y) {
    const r = (n) => Math.round(n * 100) / 100;
    const P = (pts) => 'M' + pts.map(([px, py]) => `${r(cx + px)} ${r(y + py)}`).join(' L') + ' Z';
    if (kind === '#') {
      return [
        P([[-2.9, -8], [-1.7, -8.3], [-1.7, 10], [-2.9, 10.3]]),
        P([[1.7, -10.3], [2.9, -10], [2.9, 8.3], [1.7, 8]]),
        P([[-5.2, -0.2], [5.2, -3.4], [5.2, -5.8], [-5.2, -2.6]]),
        P([[-5.2, 5.8], [5.2, 2.6], [5.2, 0.2], [-5.2, 3.4]]),
      ].join(' ');
    }
    if (kind === 'n') {
      return [
        P([[-3.1, -10], [-1.9, -10], [-1.9, 4.8], [-3.1, 4.8]]),
        P([[1.9, -4.8], [3.1, -4.8], [3.1, 10], [1.9, 10]]),
        P([[-3.1, -0.8], [3.1, -2.6], [3.1, -5], [-3.1, -3.2]]),
        P([[-3.1, 5], [3.1, 3.2], [3.1, 0.8], [-3.1, 2.6]]),
      ].join(' ');
    }
    if (kind === 'b') {
      // stem plus a bowl that is thick on the right, as an outer and inner curve (even-odd fill)
      const x0 = cx - 3.4;
      return `M${r(x0)} ${r(y - 13)} L${r(x0 + 1.3)} ${r(y - 13)} L${r(x0 + 1.3)} ${r(y - 1.2)}` +
        ` C${r(x0 + 3.6)} ${r(y - 4.4)} ${r(x0 + 8.6)} ${r(y - 4.2)} ${r(x0 + 7.8)} ${r(y - 0.6)}` +
        ` C${r(x0 + 7.2)} ${r(y + 2.2)} ${r(x0 + 3.6)} ${r(y + 4.2)} ${r(x0)} ${r(y + 5.6)} Z` +
        ` M${r(x0 + 1.3)} ${r(y + 3.4)} C${r(x0 + 3.6)} ${r(y + 2.2)} ${r(x0 + 6)} ${r(y + 0.4)} ${r(x0 + 5.8)} ${r(y - 1.2)}` +
        ` C${r(x0 + 5.6)} ${r(y - 3)} ${r(x0 + 3)} ${r(y - 2.6)} ${r(x0 + 1.3)} ${r(y - 0.6)} Z`;
    }
    return '';
  }
  const ACC_CLASS = { '#': 'acc acc-sharp', b: 'acc acc-flat', n: 'acc acc-natural' };

  // Rest glyphs. Each fits one column and sits where engravers put it.
  function restGlyph(parent, x, beats, by) {
    const y = (p) => by - p * GEOM.STEP;
    const g = svgEl('g', { class: 'rest' }, parent);
    const base = beats >= 4 - EPS ? 4 : beats >= 2 - EPS ? 2 : beats >= 1 - EPS ? 1 : beats >= 0.5 - EPS ? 0.5 : 0.25;
    const dotted = Math.abs(beats - base * 1.5) < EPS;
    const fill = (el) => { el.style.fill = 'currentColor'; return el; };
    if (base === 4) fill(svgEl('rect', { x: x - 6, y: y(6), width: 12, height: 5 }, g));
    else if (base === 2) fill(svgEl('rect', { x: x - 6, y: y(4) - 5, width: 12, height: 5 }, g));
    else if (base === 1) {
      const p = svgEl('path', {
        d: `M${x - 2} ${y(7) + 1} L${x + 4} ${y(6) + 2} L${x - 1} ${y(4) + 2} L${x + 4} ${y(3) + 1}` +
          ` Q${x - 4} ${y(2) + 4} ${x + 1} ${y(1) + 2}`,
        fill: 'none', stroke: 'currentColor', 'stroke-width': 2.4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      }, g);
      p.style.fill = 'none';
    } else {
      const flags = base === 0.5 ? 1 : 2;
      line(g, x + 4, y(5) - 1, x - 2, y(1) + 2, 1.6, { 'stroke-linecap': 'round' });
      for (let f = 0; f < flags; f++) {
        const fy = y(5) + 2 + f * 7;
        const fx = x + 4 - f * 2.2;
        fill(svgEl('circle', { cx: fx - 6, cy: fy - 1, r: 2.3 }, g));
        const c = svgEl('path', { d: `M${fx - 6} ${fy + 1} Q${fx - 2} ${fy + 2} ${fx} ${fy - 3}`, stroke: 'currentColor', 'stroke-width': 1.4 }, g);
        c.style.fill = 'none';
      }
    }
    if (dotted) fill(svgEl('circle', { cx: x + 9, cy: y(5), r: 1.9 }, g));
    return g;
  }
  const REST_SIZES = [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.25];
  function splitRest(beats) {
    const out = [];
    let left = beats;
    while (left > EPS && out.length < 8) {
      const s = REST_SIZES.find((v) => v <= left + EPS);
      if (!s) break;
      out.push(s);
      left -= s;
    }
    return out;
  }

  // ======================================================================
  // DRAWING SURFACE
  // ======================================================================
  function create(svg, { width = 360, height = GEOM.HEIGHT, bottom = GEOM.BOTTOM } = {}) {
    ensureStyle();
    svg.classList.add('ns-staff');
    let W = width;
    let H = height;
    const shift = bottom - GEOM.BOTTOM; // every fixed y moves with the bottom line
    const y = (staffPos) => bottom - staffPos * GEOM.STEP;
    const setBox = () => svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    setBox();

    function drawStaff({ clef = true, endBar = true, x1 = 4, x2 = W - 4, parent = svg } = {}) {
      const g = svgEl('g', { class: 'staff-lines' }, parent);
      for (let i = 0; i < 5; i++) {
        const l = svgEl('line', { x1, x2, y1: y(i * 2), y2: y(i * 2), 'stroke-width': 1.2 }, g);
        l.style.stroke = 'var(--muted)';
      }
      if (clef) {
        const c = svgEl('text', { x: 6, y: bottom - 4, 'font-size': 76, 'font-family': CLEF_FONT, 'aria-hidden': 'true' }, g);
        c.style.fill = 'var(--ink)';
        c.textContent = '𝄞';
      }
      if (endBar) {
        const e = svgEl('line', { x1: x2, x2, y1: y(8), y2: y(0), 'stroke-width': 1.2 }, g);
        e.style.stroke = 'var(--muted)';
      }
      return g;
    }

    // note: a Notation Note (or a midi number). opts:
    //   color         CSS colour for the whole note (default ink)
    //   hollow        override the head fill (default: half and whole notes are hollow)
    //   ring          hollow head with a thick ring (the compare view's "your take")
    //   stem          false draws the head only (default true; whole notes never have one)
    //   dx            shifts the head, stem, dot and ledger lines right (second head in one column)
    //   accidental    true: the note's own sign; false: none; '#', 'b', 'n' / 'natural': that sign
    //   accX          accidental centre relative to x (default -18); it does not move with dx
    //   label         string, or true for the note's name ('F♯'); labelOpacity, labelY, labelColor
    //   labelFade     fade the label in (300 ms)
    //   fold          -2..2: draws 8va / 15ma above or 8vb / 15mb below (the drawn note is folded)
    //   zone          'ledger' adds a small range caret above or below the staff
    //   finger        1..5 numeral above the staff
    //   opacity, className, parent
    function drawNote(noteIn, x, opts = {}) {
      const note = asNote(noteIn);
      const parent = opts.parent || svg;
      const g = svgEl('g', { class: 'note' + (opts.className ? ' ' + opts.className : '') }, parent);
      g.style.color = opts.color || 'var(--ink)';
      if (opts.opacity != null && opts.opacity !== 1) g.style.opacity = String(opts.opacity);
      const dx = opts.dx || 0;
      const hx = x + dx;
      const p = note.staffPos;
      const hy = y(p);
      const dur = note.dur || 'q';
      const kind = dur[0];

      // ledger lines
      for (let lp = -2; lp >= p; lp -= 2) line(g, hx - 12, y(lp), hx + 12, y(lp), 1.4, { class: 'ledger' });
      for (let lp = 10; lp <= p; lp += 2) line(g, hx - 12, y(lp), hx + 12, y(lp), 1.4, { class: 'ledger' });

      // accidental
      let acc = opts.accidental;
      if (acc === undefined || acc === true) acc = note.acc || '';
      else if (acc === false || acc == null) acc = '';
      else if (acc === 'natural') acc = 'n';
      if (ACC_CLASS[acc]) {
        const a = svgEl('path', { d: accidentalPath(acc, x + (opts.accX != null ? opts.accX : GEOM.ACC_X), hy), class: ACC_CLASS[acc], 'fill-rule': 'evenodd' }, g);
        a.style.fill = 'currentColor';
      }

      // head
      const ring = Boolean(opts.ring);
      const hollow = ring || (opts.hollow != null ? Boolean(opts.hollow) : kind === 'h' || kind === 'w');
      const head = svgEl('ellipse', {
        cx: hx, cy: hy, rx: ring ? GEOM.HEAD_RX - 0.9 : GEOM.HEAD_RX, ry: ring ? GEOM.HEAD_RY - 0.9 : GEOM.HEAD_RY,
        transform: `rotate(-20 ${hx} ${hy})`, stroke: 'currentColor', 'stroke-width': ring ? 2.8 : hollow ? 2 : 1,
        class: 'notehead' + (ring ? ' ring' : hollow ? ' hollow' : ''),
      }, g);
      head.style.fill = hollow ? 'var(--card)' : 'currentColor';

      // stem and flags
      if (kind !== 'w' && opts.stem !== false) {
        const up = p < 4;
        const sx = up ? hx + 6.4 : hx - 6.4;
        const tip = up ? hy - GEOM.STEM : hy + GEOM.STEM;
        line(g, sx, up ? hy - 1 : hy + 1, sx, tip, 1.6, { class: 'stem' });
        const flags = kind === 'e' ? 1 : kind === 's' ? 2 : 0;
        for (let f = 0; f < flags; f++) {
          const fy = up ? tip + f * 7 : tip - f * 7;
          const d = up ? `M${sx} ${fy} c1 6 9 9 8 18 c-1-6-5-9-8-10 z` : `M${sx} ${fy} c1-6 9-9 8-18 c-1 6-5 9-8 10 z`;
          const flag = svgEl('path', { d, stroke: 'currentColor', 'stroke-width': 1, class: 'flag' }, g);
          flag.style.fill = 'currentColor';
        }
      }
      // dot: raised into the space above when the note sits on a line
      if (dur.endsWith('.') && opts.stem !== false) {
        const dot = svgEl('circle', { cx: hx + 12, cy: p % 2 === 0 ? hy - GEOM.STEP : hy, r: 1.9, class: 'dot' }, g);
        dot.style.fill = 'currentColor';
      }

      // 8va / 8vb badges and the range caret
      const fold = opts.fold || 0;
      if (fold) {
        const word = (Math.abs(fold) >= 2 ? '15' : '8') + (fold > 0 ? (Math.abs(fold) >= 2 ? 'ma' : 'va') : (Math.abs(fold) >= 2 ? 'mb' : 'vb'));
        const t = text(g, x, (fold > 0 ? GEOM.BADGE_HIGH_Y : GEOM.BADGE_LOW_Y) + shift, word, { size: 10, cls: 'oct-badge oct-' + word });
        t.setAttribute('font-style', 'italic');
      }
      if (opts.zone === 'ledger') {
        const upC = p > 9;
        const cy = (upC ? GEOM.COL_TOP - 2 : GEOM.COL_BOTTOM) + shift;
        const d = upC ? `M${x - 4} ${cy} L${x} ${cy - 5} L${x + 4} ${cy}` : `M${x - 4} ${cy - 5} L${x} ${cy} L${x + 4} ${cy - 5}`;
        const c = svgEl('path', { d, stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'range-caret' }, g);
        c.style.fill = 'none';
      }
      if (opts.finger) text(g, x, GEOM.COL_TOP + 2 + shift, String(opts.finger), { size: 11, cls: 'finger' });

      // label
      if (opts.label) {
        const str = opts.label === true ? nameOf(note) : String(opts.label);
        const ly = opts.labelY != null ? opts.labelY : (fold < 0 ? GEOM.LABEL_Y_LOW : GEOM.LABEL_Y) + shift;
        text(g, x, ly, str, {
          color: opts.labelColor, opacity: opts.labelOpacity != null ? opts.labelOpacity : 1,
          cls: 'note-label' + (opts.labelFade ? ' label-fade' : ''),
        });
      }
      return g;
    }

    function drawHighlight(x, { fill = 'var(--accent-soft)', parent = svg, top = GEOM.COL_TOP + shift, bottomY = GEOM.COL_BOTTOM + shift } = {}) {
      const r = svgEl('rect', { x: x - 22, y: top, width: 44, height: bottomY - top, rx: 10, class: 'column' }, parent);
      r.style.fill = fill;
      return r;
    }

    // A small caret under the staff that marks where the player is.
    function drawCursor(x, { color = 'var(--accent)', parent = svg } = {}) {
      const cy = GEOM.COL_BOTTOM + 2 + shift;
      const c = svgEl('path', { d: `M${x - 6} ${cy} L${x} ${cy - 7} L${x + 6} ${cy} Z`, class: 'cursor' }, parent);
      c.style.fill = color;
      return c;
    }

    // A bracket over the notes from x1 to x2 (note centres), with a short label.
    function drawBracket(x1, x2, label, color = 'var(--muted)', { parent = svg, onTap } = {}) {
      const g = svgEl('g', { class: 'bracket' }, parent);
      g.style.color = color;
      const by = 30 + shift;
      const a = x1 - 14;
      const b = x2 + 14;
      const p = svgEl('path', { d: `M${a} ${by + 6} L${a} ${by} L${b} ${by} L${b} ${by + 6}`, stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
      p.style.fill = 'none';
      if (label != null && label !== '') text(g, (a + b) / 2, by - 5, String(label), { size: 11 });
      if (onTap) addHit(g, a, by - 18, b - a, 26, `Phrase ${label}`, onTap);
      return g;
    }

    // Shape hint for the interval from noteA (at xA) to noteB (at xB), in the band under the labels.
    // level 2: arrow and word; level 1: arrow only at opacity 0.45; level 0: nothing (returns null).
    function drawShape(xA, noteA, xB, noteB, { level = 2, color = 'var(--shape)', rescue = false, parent = svg } = {}) {
      if (!level) return null;
      const c = shapes().classify(noteA, noteB);
      const mx = (xA + xB) / 2;
      const yc = GEOM.BAND_Y + shift;
      const g = svgEl('g', { class: `shape shape-${c.kind} level-${level}` + (rescue ? ' shape-rescue' : ''), 'data-kind': c.kind, 'data-level': level }, parent);
      g.style.color = color;
      if (level === 1) g.style.opacity = '0.45';
      const arrow = svgEl('g', { class: 'shape-arrow' }, g);
      if (c.kind === 'same') {
        line(arrow, mx - 7, yc - 2, mx + 7, yc - 2, 2, { 'stroke-linecap': 'round' });
        line(arrow, mx - 7, yc + 2, mx + 7, yc + 2, 2, { 'stroke-linecap': 'round' });
      } else {
        const r = shapes().RISE[c.kind] || 3;
        const x0 = mx - 9;
        const x1 = mx + 9;
        const y0 = yc + r * c.dir;
        const y1 = yc - r * c.dir;
        line(arrow, x0, y0, x1, y1, 2, { 'stroke-linecap': 'round' });
        const len = Math.hypot(x1 - x0, y1 - y0);
        const ux = (x1 - x0) / len;
        const uy = (y1 - y0) / len;
        const bx = x1 - 5 * ux;
        const byy = y1 - 5 * uy;
        const nx = -uy * 3.5;
        const ny = ux * 3.5;
        const head = svgEl('polyline', {
          points: `${bx + nx},${byy + ny} ${x1},${y1} ${bx - nx},${byy - ny}`,
          stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        }, arrow);
        head.style.fill = 'none';
      }
      if (level >= 2) text(g, mx, GEOM.WORD_Y + shift, c.kind === 'same' ? 'same' : c.short, { size: 11, cls: 'shape-word' });
      return g;
    }

    function drawRest(x, beats, color = 'var(--ink)', { parent = svg } = {}) {
      const g = svgEl('g', { class: 'rests' }, parent);
      g.style.color = color;
      const parts = splitRest(beats);
      const step = 14;
      parts.forEach((b, k) => restGlyph(g, x + (k - (parts.length - 1) / 2) * step, b, bottom));
      return g;
    }

    function drawBarline(x, { parent = svg } = {}) {
      const l = svgEl('line', { x1: x, x2: x, y1: y(8), y2: y(0), 'stroke-width': 1.2, class: 'barline' }, parent);
      l.style.stroke = 'var(--muted)';
      return l;
    }

    function drawLabel(x, str, { y: ly = GEOM.LABEL_Y + shift, color, opacity, size = 15, parent = svg, cls = 'note-label' } = {}) {
      return text(parent, x, ly, str, { color, opacity, size, cls });
    }

    return {
      get width() { return W; },
      get height() { return H; },
      svg,
      clear() { svg.innerHTML = ''; setBox(); },
      resize(w, h) { W = w; H = h == null ? H : h; setBox(); },
      drawStaff, y, drawNote, drawHighlight, drawCursor, drawBracket, drawShape, drawRest, drawBarline, drawLabel,
      group: (parent) => svgEl('g', {}, parent || svg),
    };
  }

  // A transparent, focusable tap target (≥ 44 px wide at 375 px once the SVG is scaled).
  function addHit(parent, x, y, w, h, label, fn) {
    const r = svgEl('rect', { x, y, width: w, height: h, class: 'hit', tabindex: '0', role: 'button', 'aria-label': label }, parent);
    r.style.fill = 'transparent';
    r.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    r.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
    });
    return r;
  }

  // ======================================================================
  // LAYOUT (shared by render and renderColumns)
  // ======================================================================
  function perPage(containerWidth) {
    const w = containerWidth || 360;
    return Math.max(4, Math.min(10, Math.floor((w - 60) / 44)));
  }
  const widthFor = (n) => GEOM.LEFT + n * GEOM.SPACING + 10;

  // paging: 'page' (fixed pages of perPage notes), 'follow' (the focus note stays second from the
  // left), 'none' (every note in one view, scaled to fit), 'scroll' (every note at page scale; the SVG
  // gets a pixel width so a scrolling parent can pan it). range: [from, to) shows exactly those notes.
  function layout(svg, count, opts, focusDefault) {
    const parent = svg.parentElement;
    const cw = (parent && parent.clientWidth) || 360;
    const focus = Math.max(0, opts.pageOf != null ? opts.pageOf : focusDefault);
    const paging = opts.paging || 'page';
    let start = 0;
    let n;
    if (opts.range) {
      start = Math.max(0, opts.range[0]);
      n = Math.max(1, Math.min(count, opts.range[1]) - start);
    } else if (paging === 'none' || paging === 'scroll') {
      n = Math.max(1, count);
    } else {
      n = opts.pageSize || perPage(cw);
      if (paging === 'follow') start = Math.max(0, Math.min(focus - 1, count - n));
      else start = Math.floor(focus / n) * n;
    }
    // 'none' with fewer notes than a page: keep the page scale and centre the notes after the clef
    let x0 = GEOM.LEFT;
    let width = widthFor(n);
    if (paging === 'none' && !opts.range) {
      const minN = opts.pageSize || perPage(cw);
      if (n < minN) {
        width = widthFor(minN);
        x0 = GEOM.LEFT + ((minN - n) * GEOM.SPACING) / 2;
      }
    }
    if (paging === 'scroll' && !opts.range) {
      const k = cw / widthFor(opts.pageSize || perPage(cw));
      svg.style.width = Math.round(width * k) + 'px';
      svg.style.maxWidth = 'none';
    } else {
      svg.style.width = '';
      svg.style.maxWidth = '';
    }
    const page = n ? Math.floor(start / n) : 0;
    const pages = Math.max(1, Math.ceil(count / n));
    return { start, n, width, x0, page, pages, focus, cw, scroll: paging === 'scroll' };
  }

  function keepInView(svg, lay, x) {
    if (!lay.scroll) return;
    const parent = svg.parentElement;
    if (!parent || parent.scrollWidth <= parent.clientWidth) return;
    const k = parseFloat(svg.style.width) / lay.width;
    const want = x * k - parent.clientWidth / 2;
    parent.scrollLeft = Math.max(0, want);
  }

  function ariaText(opts, lay) {
    return typeof opts.ariaLabel === 'function' ? opts.ariaLabel({ page: lay.page, pages: lay.pages }) : opts.ariaLabel;
  }

  // ======================================================================
  // PAGED READING STAFF: one note per column
  // ======================================================================
  // opts = {
  //   notes, current:int|-1, paging:'page'|'follow'|'none'|'scroll', pageOf?, range?:[from,to), pageSize?,
  //   state(i) -> 'done'|'current'|'bad'|'upcoming'|'ghost'|'listen',
  //   label(i) -> string|true|null, labelOpacity(i) -> 0..1, labelFade?(i) -> boolean,
  //   tint(i) -> 'new'|'learning'|null,
  //   shapes(i) -> {level:0|1|2, emphasis:boolean, rescue:boolean} | null,   // hint between i-1 and i
  //   brackets?: [{from, to /*exclusive*/, label, color?}], onTapBracket?(k),
  //   revealUpTo?: int  (notes after it are not drawn; the note at it fades in),
  //   finger?(i) -> 1..5|null, fold?(i) -> -2..2, zone?(i) (both default to note.fold / note.zone),
  //   accidentals?: 'each'|'bar', bars?: note indices after each '|', beatsPerBar?, pickup?,
  //   drawBars?: boolean (bar lines from bars[]), rests?: boolean (default true: rests between notes),
  //   cursor?: int (a caret under that note), onTapNote?(i), ariaLabel: string | ({page, pages}) => string
  // }
  // Returns {pageStart, pageSize, xOf(i), page, pages, height}.
  function render(svg, opts) {
    const notes = opts.notes || [];
    const current = opts.current == null ? -1 : opts.current;
    const state = opts.state || ((i) => (i < current ? 'done' : i === current ? 'current' : 'upcoming'));
    const label = opts.label || (() => null);
    const labelOpacity = opts.labelOpacity || (() => 1);
    const reveal = opts.revealUpTo;
    const lay = layout(svg, notes.length, opts, current);
    const { start, n, width } = lay;
    const end = Math.min(notes.length, start + n);
    const xOf = (i) => lay.x0 + (i - start) * GEOM.SPACING;
    const visible = (i) => reveal == null || i <= reveal;

    // shape hints first: the band adds height only when something on this page is drawn
    const hints = [];
    if (opts.shapes) {
      for (let i = Math.max(1, start); i < end; i++) {
        if (!visible(i)) continue;
        const sh = opts.shapes(i);
        if (sh && sh.level > 0) hints.push({ i, sh });
      }
    }
    const height = hints.length ? GEOM.BAND_HEIGHT : GEOM.HEIGHT;
    const S = create(svg, { width, height });
    S.clear();
    svg.setAttribute('data-shapes', hints.length ? 'on' : 'off');

    // columns behind notes
    for (let i = start; i < end; i++) {
      if (!visible(i)) continue;
      const st = state(i);
      if (COLUMN_FILL[st]) S.drawHighlight(xOf(i), { fill: COLUMN_FILL[st] });
    }
    S.drawStaff({ clef: true, endBar: opts.endBar !== false });

    if (opts.drawBars && opts.bars) {
      for (const b of opts.bars) if (b > start && b < end) S.drawBarline(xOf(b) - GEOM.SPACING / 2);
    }
    if (opts.brackets) {
      opts.brackets.forEach((br, k) => {
        const a = Math.max(br.from, start);
        const b = Math.min(br.to, end) - 1;
        if (b < a) return;
        S.drawBracket(xOf(a), xOf(b), br.label, br.color || 'var(--muted)', {
          onTap: opts.onTapBracket ? () => opts.onTapBracket(k) : null,
        });
      });
    }

    const marks = notation().accidentalMarks(notes, {
      policy: opts.accidentals || 'each', bars: opts.bars || null,
      beatsPerBar: opts.beatsPerBar || 4, pickup: opts.pickup || 0,
    });

    const notesG = svgEl('g', { class: 'staff-notes' }, svg);
    for (let i = start; i < end; i++) {
      if (!visible(i)) continue;
      const note = notes[i];
      const x = xOf(i);
      const st = state(i);
      const t = opts.tint && opts.tint(i);
      if (t && TINT[t]) {
        const c = svgEl('circle', { cx: x, cy: S.y(note.staffPos), r: 11.5, class: 'tint tint-' + t, stroke: TINT[t].stroke, 'stroke-width': 1.2 }, notesG);
        if (TINT[t].dash) c.setAttribute('stroke-dasharray', TINT[t].dash);
        c.style.fill = TINT[t].fill;
      }
      const lbl = label(i);
      const fold = opts.fold ? opts.fold(i) : note.fold || 0;
      const g = S.drawNote(note, x, {
        parent: notesG,
        color: STATE_COLOR[st] || 'var(--ink)',
        label: lbl === false ? null : lbl,
        labelOpacity: lbl ? labelOpacity(i) : 1,
        labelFade: Boolean(lbl && opts.labelFade && opts.labelFade(i)),
        accidental: marks[i],
        fold,
        zone: opts.zone ? opts.zone(i) : note.zone,
        finger: opts.finger ? opts.finger(i) : null,
        className: 'state-' + st + (reveal != null && i === reveal ? ' reveal-in' : ''),
      });
      g.setAttribute('data-i', String(i));
      // a rest between this note and the next one
      if (opts.rests !== false && i + 1 < notes.length && note.beat != null && notes[i + 1].beat != null) {
        const gap = notes[i + 1].beat - (note.beat + note.beats);
        if (gap > EPS && visible(i + 1)) S.drawRest(x + GEOM.SPACING / 2 - (marks[i + 1] ? 5 : 0), gap, 'var(--muted)', { parent: notesG });
      }
    }
    if (opts.cursor != null && opts.cursor >= start && opts.cursor < end) S.drawCursor(xOf(opts.cursor));

    if (hints.length) {
      const band = svgEl('g', { class: 'shapes', 'aria-hidden': 'true' }, svg);
      for (const { i, sh } of hints) {
        const xB = xOf(i);
        S.drawShape(xB - GEOM.SPACING, notes[i - 1], xB, notes[i], {
          parent: band, level: sh.level, rescue: Boolean(sh.rescue),
          color: sh.rescue || sh.emphasis ? 'var(--accent)' : 'var(--shape)',
        });
      }
    }

    if (opts.onTapNote) {
      const hits = svgEl('g', { class: 'hits' }, svg);
      for (let i = start; i < end; i++) {
        if (!visible(i)) continue;
        const nm = nameOf(notes[i]);
        const shown = lbl0(label(i));
        addHit(hits, xOf(i) - GEOM.SPACING / 2, GEOM.COL_TOP, GEOM.SPACING, height - GEOM.COL_TOP, `Note ${i + 1}${shown ? ', ' + nm : ''}`, () => opts.onTapNote(i));
      }
    }

    // accessible name; while hints are on, it also says the shape into the current note
    let aria = ariaText(opts, lay);
    const curHint = hints.find((h) => h.i === current);
    if (curHint && current > 0) {
      const said = shapes().describe(notes[current - 1], notes[current]);
      if (!aria || aria.indexOf(said) < 0) aria = ((aria ? aria + ' ' : '') + said).trim(); // callers may add it themselves
    }
    if (aria) svg.setAttribute('aria-label', aria);
    if (!svg.getAttribute('role')) svg.setAttribute('role', opts.onTapNote ? 'group' : 'img');

    if (current >= 0) keepInView(svg, lay, xOf(Math.max(start, Math.min(current, end - 1))));
    return { pageStart: start, pageSize: n, xOf, page: lay.page, pages: lay.pages, height };
  }
  const lbl0 = (l) => l != null && l !== false && l !== '';

  // ======================================================================
  // COLUMNS: several noteheads per column (Play by Ear compare view, §7.2)
  // ======================================================================
  // opts = {
  //   columns: [{
  //     heads: [{ note /*Note or midi*/, color, ring?, hollow?, dx?, accidental?, accX?, stem? }],
  //     labels?: [{ text, color? }]   // stacked under the column (song letter, then yours)
  //     mark?: string | { text, color }   // a small mark just under the staff ('✓', 'missed')
  //     kind?: string                 // written to data-kind
  //   }],
  //   current?, pageOf?, paging, range?, pageSize?, showLabels? (default true),
  //   highlight?(i) -> CSS colour | null, onTapColumn?(i), ariaLabel
  // }
  // Heads are drawn without rhythm (no stems, dots or flags unless stem:true). Returns like render().
  function renderColumns(svg, opts) {
    const cols = opts.columns || [];
    const current = opts.current == null ? -1 : opts.current;
    const lay = layout(svg, cols.length, opts, current);
    const { start, n, width } = lay;
    const end = Math.min(cols.length, start + n);
    const xOf = (i) => lay.x0 + (i - start) * GEOM.SPACING;
    const showLabels = opts.showLabels !== false;
    let rows = 0;
    if (showLabels) for (let i = start; i < end; i++) rows = Math.max(rows, (cols[i].labels || []).length);
    const height = rows > 1 ? GEOM.HEIGHT + GEOM.LABEL_ROW * (rows - 1) : GEOM.HEIGHT;
    const S = create(svg, { width, height });
    S.clear();
    for (let i = start; i < end; i++) {
      const fill = opts.highlight ? opts.highlight(i) : null;
      if (fill) S.drawHighlight(xOf(i), { fill });
    }
    S.drawStaff({ clef: true, endBar: opts.endBar !== false });
    for (let i = start; i < end; i++) {
      const col = cols[i];
      const x = xOf(i);
      const g = svgEl('g', { class: 'col', 'data-i': String(i) }, svg);
      if (col.kind) g.setAttribute('data-kind', col.kind);
      (col.heads || []).forEach((h) => {
        const base = asNote(h.note);
        const note = Object.assign({}, base, { dur: h.stem ? base.dur || 'q' : 'q' });
        S.drawNote(note, x, {
          parent: g, color: h.color, ring: h.ring, hollow: h.hollow != null ? h.hollow : false, dx: h.dx,
          accidental: h.accidental, accX: h.accX, stem: Boolean(h.stem), className: h.className,
        });
      });
      if (col.mark) {
        const m = typeof col.mark === 'string' ? { text: col.mark } : col.mark;
        S.drawLabel(x, m.text, { y: GEOM.MARK_Y, color: m.color || 'var(--muted)', size: 10, parent: g, cls: 'col-mark' });
      }
      if (showLabels) {
        (col.labels || []).forEach((l, k) => {
          S.drawLabel(x, l.text, { y: GEOM.LABEL_Y + 3 + k * GEOM.LABEL_ROW, color: l.color, parent: g, cls: 'note-label' });
        });
      }
    }
    if (opts.onTapColumn) {
      const hits = svgEl('g', { class: 'hits' }, svg);
      for (let i = start; i < end; i++) addHit(hits, xOf(i) - GEOM.SPACING / 2, GEOM.COL_TOP, GEOM.SPACING, height - GEOM.COL_TOP, `Column ${i + 1}`, () => opts.onTapColumn(i));
    }
    const aria = ariaText(opts, lay);
    if (aria) svg.setAttribute('aria-label', aria);
    if (!svg.getAttribute('role')) svg.setAttribute('role', opts.onTapColumn ? 'group' : 'img');
    if (current >= 0) keepInView(svg, lay, xOf(Math.max(start, Math.min(current, end - 1))));
    return { pageStart: start, pageSize: n, xOf, page: lay.page, pages: lay.pages, height };
  }

  NS.staff = { create, render, renderColumns, perPage, legacy, GEOM };
})(typeof window !== 'undefined' ? window : globalThis);
