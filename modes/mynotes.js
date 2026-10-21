// My notes mode (#/notes), spec §3.4: what you know so far. A note map on a mini staff, a chip per
// note with a progress ring, a legend, your most common mix-ups, the path of units and a detail sheet
// per note (Hear it, Drill this note, I already know this, Learn it now).
//
// The pure part (wording and small models) is UMD: NS.myNotesCore in the browser,
// require('../modes/mynotes.js') in Node. The browser part registers the mode. Needs modes/drill.js.
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const D = isNode ? require('./drill.js') : root.NS.drillCore;

  // ======================================================================
  // PURE CORE
  // ======================================================================
  const STATE_WORD = { known: 'Known', learning: 'Learning', new: 'New', locked: 'Coming up' };

  // counts = {known, learning, new, locked} -> '7 known · 2 learning · 1 new · 1 to come'
  function countsText(c) {
    const parts = [];
    if (c.known) parts.push(`${c.known} known`);
    if (c.learning) parts.push(`${c.learning} learning`);
    if (c.new) parts.push(`${c.new} new`);
    if (c.locked) parts.push(`${c.locked} to come`);
    return parts.join(' · ');
  }
  function countStates(states) {
    const c = { known: 0, learning: 0, new: 0, locked: 0, rusty: 0 };
    Object.values(states).forEach((st) => {
      c[st.state] = (c[st.state] || 0) + 1;
      if (st.rusty) c.rusty++;
    });
    return c;
  }

  // The top n confusions across notes: [{seen, played, count}], most frequent first. A single slip is
  // not a pattern, so an entry needs at least `min` occurrences.
  function mixups(notes, { n = 3, min = 2 } = {}) {
    const out = [];
    for (const seen in notes || {}) {
      const conf = (notes[seen] && notes[seen].conf) || {};
      for (const played in conf) if (conf[played] >= min && played !== seen) out.push({ seen, played, count: conf[played] });
    }
    return out.sort((a, b) => b.count - a.count || D.ORDER.indexOf(a.seen) - D.ORDER.indexOf(b.seen)).slice(0, n);
  }
  function mixupText(m) {
    const keys = [m.seen, m.played];
    return `You sometimes play ${D.nameFor(m.played, keys)} when you see ${D.nameFor(m.seen, keys)}.`;
  }

  // 'today' | 'tomorrow' | 'in 3 days'; null without a due day.
  function reviewText(due, today, daysBetween) {
    if (!due || !today) return null;
    const d = daysBetween(today, due);
    if (d <= 0) return 'today';
    if (d === 1) return 'tomorrow';
    return `in ${d} days`;
  }
  function firstTryPct(rec) {
    if (!rec) return null;
    const tot = (rec.reads || 0) + (rec.miss || 0);
    return tot ? Math.round((100 * (rec.reads || 0)) / tot) : null;
  }
  function topConf(rec) {
    const e = Object.entries((rec && rec.conf) || {}).sort((a, b) => b[1] - a[1])[0];
    return e ? e[0] : null;
  }
  // Shown as "Practised: on 2 separate days".
  function daysText(box) {
    if (!box) return 'not on separate days yet';
    return `on ${box} separate day${box === 1 ? '' : 's'}`;
  }
  function chipAria(key, stateWord, rusty) {
    const pos = D.shortPos(key);
    return `${key}${pos ? ', ' + pos : ''}, ${stateWord.toLowerCase()}${rusty ? ', due for review' : ''}`;
  }

  // Status of a unit on the path: 'known' | 'learning' | 'new' | 'next' | 'later'.
  function unitStatus(unit, idx, states, courseUnit) {
    const st = unit.notes.map((k) => (states[k] ? states[k].state : 'locked'));
    if (st.every((x) => x === 'known')) return 'known';
    if (st.some((x) => x === 'learning' || x === 'known')) return 'learning';
    if (st.some((x) => x === 'new')) return 'new';
    return idx === courseUnit ? 'next' : 'later';
  }
  const UNIT_WORD = { known: 'Known', learning: 'Learning', new: 'New', next: 'Up next', later: 'Coming up' };

  // What the "Learn {next}" action says and does for each gate (§3.2.6).
  // settling = letters of introduced notes that aren't known yet.
  function gateAction(gate, nextLetters, settling) {
    const L = D.listLetters(nextLetters);
    if (gate === 'done') return { kind: 'done', text: 'All the treble notes are known. Next stage coming soon.' };
    if (gate === 'open') return { kind: 'open', label: `Meet ${L}`, text: `Ready for a new note: ${L}` };
    if (gate === 'soft') {
      return {
        kind: 'soft', label: `Meet ${L}`,
        text: `You’re still settling in ${D.listLetters(settling)}. Meet ${L} now, or practise first?`,
      };
    }
    return {
      kind: 'closed', label: `Learn ${L} anyway`,
      text: `Your notes ${D.listLetters(settling)} are still settling. You can meet ${L} now, but a quick drill first will make it easier.`,
    };
  }

  // The note just before `key` in the course order, for "Comes after A".
  function comesAfter(key) {
    const i = D.ORDER.indexOf(key);
    return i > 0 ? D.ORDER[i - 1] : null;
  }

  const core = {
    STATE_WORD, countsText, countStates, mixups, mixupText, reviewText, firstTryPct, topConf, daysText,
    chipAria, unitStatus, UNIT_WORD, gateAction, comesAfter,
  };
  if (isNode) { module.exports = core; return; }

  // ======================================================================
  // BROWSER
  // ======================================================================
  const NS = root.NS;
  NS.myNotesCore = core;
  const { svgEl } = NS.util;
  const Cur = () => NS.curriculum;
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const btn = (label, cls, fn) => {
    const b = el('button', 'btn' + (cls ? ' ' + cls : ''), label);
    b.addEventListener('click', fn);
    return b;
  };

  let m = null; // the mounted screen

  const allKeys = () => Object.keys(Cur().UNIT_OF);
  function readStates() {
    const out = {};
    allKeys().forEach((k) => {
      const rec = NS.mastery.get(k);
      const st = rec ? NS.mastery.state(k) : 'locked';
      out[k] = { key: k, rec, state: st, rusty: rec ? NS.mastery.rusty(k) : false, pct: rec && NS.Mastery ? NS.Mastery.pct(rec) : 0 };
    });
    return out;
  }
  const courseUnit = () => {
    const st = NS.store.state();
    return (st && st.course && st.course.unit) || 0;
  };

  // ---------- mini staff (viewBox 0 0 W H, bottom line at BOT, half-gap 6) ----------
  const STEP = 6;
  function miniStaff(svg, { width, height, bottom, left = 4 }) {
    svg.innerHTML = '';
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    for (let i = 0; i < 5; i++) {
      const y = bottom - i * 2 * STEP;
      const l = svgEl('line', { x1: left, x2: width - 4, y1: y, y2: y, 'stroke-width': 1.2 }, svg);
      l.style.stroke = 'var(--muted)';
    }
    const clef = svgEl('text', { x: left + 2, y: bottom - 2, 'font-size': 62, 'font-family': 'Noto Music, Bravura, Apple Symbols, serif' }, svg);
    clef.style.fill = 'var(--ink)';
    clef.textContent = '𝄞';
    return (staffPos) => bottom - staffPos * STEP;
  }
  // A notehead in one of the state styles. Ledger lines for notes off the staff.
  function head(svg, x, staffPos, yOf, style) {
    const g = svgEl('g', { class: 'mn-head mn-' + style }, svg);
    for (let p = -2; p >= staffPos; p -= 2) {
      const ly = yOf(p);
      const l = svgEl('line', { x1: x - 11, x2: x + 11, y1: ly, y2: ly, 'stroke-width': 1.3 }, g);
      l.style.stroke = 'var(--muted)';
    }
    for (let p = 10; p <= staffPos; p += 2) {
      const ly = yOf(p);
      const l = svgEl('line', { x1: x - 11, x2: x + 11, y1: ly, y2: ly, 'stroke-width': 1.3 }, g);
      l.style.stroke = 'var(--muted)';
    }
    const y = yOf(staffPos);
    svgEl('ellipse', { cx: x, cy: y, rx: 7, ry: 5, transform: `rotate(-20 ${x} ${y})`, class: 'mn-notehead' }, g);
    return g;
  }

  // ---------- render ----------
  function mount(rootEl, params, ctx) {
    m = { root: rootEl, ctx, offs: [], frame: NS.ui.frame(rootEl, { eyebrow: 'Your progress', title: 'My notes' }), sheet: null };
    ctx.setTitle('My notes');
    const rerender = () => { if (m) render(); };
    m.offs.push(
      NS.bus.on('store:changed', ({ section }) => { if (section !== 'settings') rerender(); }),
      NS.bus.on('mastery:changed', rerender),
      NS.bus.on('unit:introduced', rerender),
    );
    render();
  }
  function unmount() {
    if (!m) return;
    m.offs.forEach((off) => off());
    if (m.sheet) m.sheet.close();
    m = null;
  }

  function render() {
    const body = m.frame.body;
    body.innerHTML = '';
    const states = readStates();
    const counts = core.countStates(states);
    m.states = states;
    const anyIntro = allKeys().some((k) => states[k].state !== 'locked');
    if (!anyIntro) return renderEmpty(body);

    body.appendChild(el('p', 'muted mn-sub', core.countsText(counts)));
    body.appendChild(renderMap(states));
    body.appendChild(renderLegend());
    body.appendChild(renderChips(states));
    const mx = renderMixups();
    if (mx) body.appendChild(mx);
    body.appendChild(renderPath(states));
  }

  function renderEmpty(body) {
    const box = el('section', 'mn-empty');
    box.append(el('h3', null, 'Your first notes are middle C and D.'),
      el('p', 'muted', 'Meet them, and this page fills in as you learn each new note.'));
    const first = Cur().UNITS[0].notes;
    box.appendChild(btn(`Meet ${D.listLetters(first.map(D.displayLetter))}`, 'primary', () => m.ctx.go('#/drill?meet=' + first.join(','))));
    body.appendChild(box);
  }

  const MAP = { W: 376, H: 130, BOT: 88, X0: 54, DX: 28 };
  function renderMap(states) {
    const card = el('div', 'staff-card mn-map');
    const svg = svgEl('svg', { role: 'img' });
    card.appendChild(svg);
    const yOf = miniStaff(svg, { width: MAP.W, height: MAP.H, bottom: MAP.BOT });
    const aria = [];
    allKeys().forEach((k, i) => {
      const st = states[k];
      const p = D.parseKey(k);
      const x = MAP.X0 + i * MAP.DX;
      head(svg, x, p.staffPos, yOf, st.state);
      if (st.rusty) {
        const dot = svgEl('circle', { cx: x, cy: yOf(p.staffPos) - 12, r: 3, class: 'mn-rusty-dot' }, svg);
        dot.style.fill = 'var(--learn)';
      }
      const t = svgEl('text', { x, y: 122, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, class: 'mn-map-letter' }, svg);
      t.textContent = D.displayLetter(k);
      const hit = svgEl('rect', { x: x - 14, y: 4, width: 28, height: 122, fill: 'transparent', class: 'mn-hit', 'data-key': k }, svg);
      hit.addEventListener('click', () => openDetail(k));
      aria.push(`${k} ${core.STATE_WORD[st.state].toLowerCase()}${st.rusty ? ' (review)' : ''}`);
    });
    svg.setAttribute('aria-label', 'Note map. ' + aria.join(', ') + '.');
    return card;
  }

  function renderLegend() {
    const ul = el('ul', 'mn-legend');
    ul.setAttribute('aria-label', 'Legend');
    [['known', 'Known'], ['learning', 'Learning'], ['new', 'New'], ['locked', 'Coming up'], ['rusty', 'Due for review']].forEach(([cls, word]) => {
      const li = el('li', 'mn-leg-' + cls);
      const sw = el('span', 'mn-swatch');
      sw.setAttribute('aria-hidden', 'true');
      li.append(sw, document.createTextNode(word));
      ul.appendChild(li);
    });
    return ul;
  }

  function renderChips(states) {
    const grid = el('div', 'mn-grid');
    allKeys().forEach((k) => {
      const st = states[k];
      const p = D.parseKey(k);
      const word = core.STATE_WORD[st.state];
      const b = el('button', `mn-chip mn-${st.state}${st.rusty ? ' mn-is-rusty' : ''}`);
      b.dataset.key = k;
      b.setAttribute('aria-label', core.chipAria(k, word, st.rusty));
      const ring = el('span', 'mn-ring');
      ring.style.setProperty('--p', st.state === 'locked' ? 0 : Math.round(st.pct || 0));
      ring.setAttribute('aria-hidden', 'true');
      const name = el('span', 'mn-letter', D.displayLetter(k));
      const oct = el('span', 'mn-oct', String(p.octave));
      ring.append(name, oct);
      b.append(ring, el('span', 'mn-word', word));
      if (st.rusty) b.appendChild(el('span', 'mn-review', 'review'));
      b.addEventListener('click', () => openDetail(k));
      grid.appendChild(b);
    });
    return grid;
  }

  function renderMixups() {
    const list = core.mixups(NS.store.state().notes || {});
    if (!list.length) return null;
    const sec = el('section', 'mn-section mn-mixups');
    sec.appendChild(el('h3', null, 'Mix-ups'));
    list.forEach((mu) => {
      const row = el('div', 'mn-mixup');
      const svg = svgEl('svg', { role: 'img', class: 'mn-mix-staff' });
      const yOf = miniStaff(svg, { width: 150, height: 120, bottom: 84 });
      const a = D.parseKey(mu.seen);
      const b = D.parseKey(mu.played);
      head(svg, 82, a.staffPos, yOf, 'seen');
      if (b) head(svg, 124, b.staffPos, yOf, 'played');
      const ta = svgEl('text', { x: 82, y: 114, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, class: 'mn-map-letter' }, svg);
      ta.textContent = D.displayLetter(mu.seen);
      const tb = svgEl('text', { x: 124, y: 114, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, class: 'mn-played-letter' }, svg);
      tb.textContent = D.displayLetter(mu.played);
      svg.setAttribute('aria-label', `${D.displayLetter(mu.seen)} on the staff, and ${D.displayLetter(mu.played)}, the note you sometimes play instead.`);
      const txt = el('div', 'mn-mix-text');
      txt.append(el('p', null, core.mixupText(mu)), el('p', 'muted', `${mu.count} times so far.`));
      row.append(svg, txt);
      sec.appendChild(row);
    });
    return sec;
  }

  function renderPath(states) {
    const sec = el('section', 'mn-section mn-path');
    sec.appendChild(el('h3', null, 'Your path'));
    const C = Cur();
    const cu = courseUnit();
    const ol = el('ol', 'mn-stages');
    C.STAGES.forEach((title, si) => {
      const li = el('li', 'mn-stage');
      li.appendChild(el('strong', null, `Stage ${si + 1} · ${title}`));
      const ul = el('ul', 'mn-units');
      C.UNITS.forEach((u, ui) => {
        if (u.stage !== si + 1) return;
        const status = core.unitStatus(u, ui, states, cu);
        const row = el('li', 'mn-unit mn-u-' + status);
        row.append(el('span', 'mn-unit-notes', u.notes.map(D.displayLetter).join(' ')), el('span', 'mn-unit-word', core.UNIT_WORD[status]));
        ul.appendChild(row);
      });
      li.appendChild(ul);
      ol.appendChild(li);
    });
    sec.appendChild(ol);

    const actions = el('div', 'controls');
    const intro = allKeys().filter((k) => states[k].state !== 'locked');
    if (intro.length) actions.appendChild(btn('Drill my weakest notes', '', () => m.ctx.go('#/drill?weak=1')));
    const ga = nextGate(states);
    if (ga) {
      if (ga.kind === 'done') sec.appendChild(el('p', 'muted', ga.text));
      else actions.appendChild(btn(ga.label, ga.kind === 'open' ? 'primary' : '', () => learnNext()));
    }
    sec.appendChild(actions);
    return sec;
  }

  function nextGate(states) {
    const C = Cur();
    const cu = courseUnit();
    const gate = NS.mastery.introGate();
    if (gate === 'done' || cu >= C.UNITS.length) return core.gateAction('done', [], []);
    const next = C.UNITS[cu].notes.map(D.displayLetter);
    const settling = allKeys().filter((k) => states[k].state === 'new' || states[k].state === 'learning').map(D.displayLetter);
    return core.gateAction(gate, next, settling);
  }

  // "Learn {next}" through the gate: open goes straight to Meet; soft asks (Meet or a quick drill);
  // closed asks for confirmation ("Learn A anyway").
  async function learnNext() {
    if (!m) return;
    const C = Cur();
    const cu = courseUnit();
    if (cu >= C.UNITS.length) return;
    const keys = C.UNITS[cu].notes;
    const route = '#/drill?meet=' + keys.join(',');
    const ga = nextGate(m.states || readStates());
    const ctx = m.ctx;
    if (m.sheet) { m.sheet.close(); m.sheet = null; }
    if (ga.kind === 'open') return ctx.go(route);
    const L = D.listLetters(keys.map(D.displayLetter));
    const choice = await NS.ui.dialog({
      title: ga.kind === 'soft' ? `Meet ${L}?` : `Learn ${L} anyway?`,
      body: ga.text,
      actions: ga.kind === 'soft'
        ? [{ label: 'Quick drill', value: 'drill' }, { label: `Meet ${L}`, value: 'meet', primary: true }]
        : [{ label: 'Not now', value: null }, { label: `Learn ${L} anyway`, value: 'meet', primary: true }],
    });
    if (choice === 'meet') ctx.go(route);
    else if (choice === 'drill') ctx.go('#/drill');
  }

  // ---------- detail sheet ----------
  function openDetail(key) {
    if (!m) return;
    const st = (m.states || readStates())[key];
    const rec = st.rec;
    const inf = D.info(key, Cur().NOTE_INFO);
    const L = D.displayLetter(key);
    const content = el('div', 'mn-detail');

    const svg = svgEl('svg', { role: 'img', class: 'mn-detail-staff' });
    const yOf = miniStaff(svg, { width: 150, height: 120, bottom: 84 });
    const p = D.parseKey(key);
    head(svg, 104, p.staffPos, yOf, st.state === 'locked' ? 'new' : st.state);
    svg.setAttribute('aria-label', `${L} on the staff, ${D.shortPos(key) || ''}.`);
    const staffCard = el('div', 'staff-card mn-detail-card');
    staffCard.appendChild(svg);
    const text = el('div', 'mn-detail-text');
    text.append(el('p', 'mn-state-line', `${core.STATE_WORD[st.state]}${st.rusty ? ' · due for review' : ''}`), el('p', null, inf.text));
    let anchor = null;
    try { anchor = Cur().anchorText ? Cur().anchorText(key) : null; } catch { anchor = null; }
    if (anchor == null) anchor = D.anchorText(inf.anchor);
    else if (anchor && !/[.!?]$/.test(anchor)) anchor += '.';
    if (anchor) text.appendChild(el('p', 'muted', anchor));
    const top = el('div', 'mn-detail-top');
    top.append(staffCard, text);
    content.appendChild(top);

    const actions = el('div', 'controls');
    actions.appendChild(btn('Hear it', '', () => { NS.audio.resume(); NS.audio.playTone(p.midi, 1.2); }));

    if (st.state === 'locked') {
      const after = core.comesAfter(key);
      const cu = courseUnit();
      const isNext = Cur().UNIT_OF[key] === cu;
      content.appendChild(el('p', 'muted', isNext ? `${L} is your next note.` : after ? `Comes after ${D.displayLetter(after)}.` : ''));
      if (isNext) {
        actions.appendChild(btn('Learn it now', 'primary', () => learnNext()));
        actions.appendChild(btn('I already know this', '', () => m.ctx.go('#/drill?check=' + key)));
      }
    } else {
      const dl = el('dl', 'mn-stats');
      const add = (dt, dd) => { dl.append(el('dt', null, dt), el('dd', null, dd)); };
      const ftp = core.firstTryPct(rec);
      add('First try', ftp == null ? 'Not yet' : `${ftp}%`);
      add('Average time', rec && rec.rt != null ? `${(rec.rt / 1000).toFixed(1)} s` : 'Not yet');
      add('Practised', core.daysText(rec && rec.box));
      const rv = core.reviewText(rec && rec.due, NS.util.dayKey(Date.now()), NS.util.daysBetween);
      if (rv) add('Next review', rv);
      const tc = core.topConf(rec);
      if (tc) add('Mix-up', `Often played as ${D.nameFor(tc, [tc, key])}`);
      content.appendChild(dl);
      actions.appendChild(btn('Drill this note', 'primary', () => m.ctx.go('#/drill?focus=' + key)));
      if (st.state !== 'known') actions.appendChild(btn('I already know this', '', () => m.ctx.go('#/drill?check=' + key)));
    }
    content.appendChild(actions);
    if (m.sheet) m.sheet.close();
    m.sheet = NS.ui.sheet({ title: `${L} (${key})`, content });
  }

  NS.modes.register({
    id: 'notes',
    title: 'My notes',
    blurb: 'What you know so far',
    order: 6,
    needsSong: false,
    icon: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><g fill="currentColor"><circle cx="6" cy="16" r="2.6"/><circle cx="12" cy="12" r="2.6"/><circle cx="18" cy="8" r="2.6"/></g></svg>',
    mount,
    unmount,
    songBadge: () => null,
    tileChip() {
      const states = readStates();
      const c = core.countStates(states);
      return c.known ? `${c.known} / ${allKeys().length}` : null;
    },
    debugState() {
      if (!m) return null;
      const states = m.states || readStates();
      return {
        counts: core.countStates(states),
        states: Object.fromEntries(Object.keys(states).map((k) => [k, states[k].state])),
        sheetOpen: Boolean(document.querySelector('.ui-sheet')),
      };
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
