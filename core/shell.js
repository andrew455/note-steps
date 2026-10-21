// The shell: hash router, Home, the song library (#/songs/:mode), the song sheet and the settings
// sheet. NS.shell. Load after core/ui.js; app.js calls NS.shell.start() once every mode has registered.
// Spec §1.2-1.4, §2.4.13, §3.8.3-3.8.5, §7.2 (Play by Ear tile).
//
// Routes: #/ Home · #/songs/:mode library · #/<modeId>[/<arg>][?query] for every registered mode.
// Before every route change the shell unmounts the current mode, stops all app audio, closes dialogs
// and sheets, and hides every main.wrap except the new one. The mic stays on across routes.
//
// Pure part (UMD, for node tests): ShellCore = {parseRoute, stageOf, groupByStage, FILTERS,
// matchesFilter, isEtude, practiceAvailable, noteCheckVisible, quickDrillKeys, summaryText,
// songsForYou, comfortScore, nextStack, backTarget, songKeys}. In the browser it is NS.shell.core.
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;

  // ======================================================================
  // PURE
  // ======================================================================
  const STAGE_NAMES = ['Middle C home', 'Up to G', 'Up to treble C', 'Top of the staff'];
  const DAY = 86400000;

  // '#/practice/mary?from=ear' -> {route:'#/practice/mary?from=ear', path:'/practice/mary', modeId:'practice', arg:'mary', query}
  function parseRoute(hash) {
    const h = String(hash || '').replace(/^#/, '') || '/';
    const qi = h.indexOf('?');
    const path0 = qi < 0 ? h : h.slice(0, qi);
    const qs = qi < 0 ? '' : h.slice(qi + 1);
    const path = path0.startsWith('/') ? path0 : '/' + path0;
    const parts = path.split('/').filter(Boolean);
    let arg = null;
    try { arg = parts.slice(1).map(decodeURIComponent).join('/') || null; } catch { arg = parts.slice(1).join('/') || null; }
    let modeId = 'home';
    try { modeId = parts[0] ? decodeURIComponent(parts[0]) : 'home'; } catch { modeId = parts[0]; }
    return { route: '#' + path + (qs ? '?' + qs : ''), path, modeId, arg, query: new URLSearchParams(qs) };
  }

  // Distinct note keys of a song ('E4', 'F#4'). Uses song.keys (WP4) when present.
  function songKeys(song) {
    if (!song) return [];
    if (Array.isArray(song.keys)) return song.keys;
    const out = [];
    (song.notes || []).forEach((n) => {
      const k = n.key || (n.letter ? n.letter + (n.acc || '') + (Math.floor(n.midi / 12) - 1) : null);
      if (k && !out.includes(k)) out.push(k);
    });
    return out;
  }

  // 1..4 or 'extra'. Uses song.stage (WP4) when present, else Curriculum.songLevel + UNITS.
  function stageOf(song, C) {
    if (song && song.stage != null) return song.stage;
    let u = song && song.unit != null ? song.unit : null;
    if (u == null && C && C.songLevel) { try { u = C.songLevel(song); } catch { u = Infinity; } }
    if (u == null || !Number.isFinite(u)) return 'extra';
    if (u < 0) return 1;
    const unit = C && C.UNITS && C.UNITS[u];
    return unit ? unit.stage : 'extra';
  }

  // -> [{key, title, songs}] in stage order, then extras; empty groups left out.
  function groupByStage(songs, stageFn, stageNames = STAGE_NAMES) {
    const groups = new Map();
    stageNames.forEach((n, i) => groups.set(i + 1, { key: i + 1, title: `Stage ${i + 1} · ${n}`, songs: [] }));
    groups.set('extra', { key: 'extra', title: 'Extras (beyond this course)', songs: [] });
    (songs || []).forEach((s) => {
      const st = stageFn(s);
      const g = groups.get(st) || groups.get('extra');
      g.songs.push(s);
    });
    return [...groups.values()].filter((g) => g.songs.length);
  }

  const FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'folk', label: 'Folk' },
    { id: 'classical', label: 'Classical' },
    { id: 'holiday', label: 'Holiday' },
    { id: 'steps', label: 'Little steps' },
  ];
  const isEtude = (song) => Boolean(song && (song.kind === 'etude' || /^etude-/.test(song.id || '')));
  function matchesFilter(song, filter) {
    if (!filter || filter === 'all') return true;
    if (filter === 'steps') return isEtude(song);
    return Array.isArray(song.tags) && song.tags.includes(filter);
  }

  // §3.8.5 Practice: available when every note is introduced (songLevel < course.unit). Extras
  // (level Infinity, e.g. notes below middle C) are always available.
  function practiceAvailable(level, courseUnit) {
    if (level == null || !Number.isFinite(level)) return true;
    return level < (courseUnit || 0);
  }

  // §1.3 item 2: only after a v1 migration (checkDone === false), and not while snoozed.
  function noteCheckVisible(course, now) {
    if (!course || course.checkDone !== false) return false;
    return !(course.checkSnoozeUntil && now < course.checkSnoozeUntil);
  }
  const snoozeUntil = (now) => now + 7 * DAY;

  // §1.3 item 4: introduced notes that are new, rusty, or learning with acc < 0.8.
  // info(key) -> {state, acc, rusty}
  function quickDrillKeys(keys, info) {
    return (keys || []).filter((k) => {
      const i = info(k) || {};
      return i.state === 'new' || Boolean(i.rusty) || (i.state === 'learning' && (i.acc == null || i.acc < 0.8));
    });
  }

  // {known, learning, new} -> '7 notes known · 2 learning' | null (nothing met yet)
  function summaryText(sum) {
    const s = sum || {};
    const known = s.known || 0;
    const learning = s.learning || 0;
    const fresh = s.new || 0;
    if (!known && !learning && !fresh) return null;
    const parts = [];
    if (known) parts.push(`${known} note${known === 1 ? '' : 's'} known`);
    if (learning) parts.push(`${learning} learning`);
    if (fresh) parts.push(known || learning ? `${fresh} new` : `${fresh} new note${fresh === 1 ? '' : 's'}`);
    if (s.rusty) parts.push(`${s.rusty} to review`);
    return parts.join(' · ');
  }

  // How well a song suits the reader now: closest to "just right" (C = 0.92) first, unplayed a little ahead.
  function comfortScore(c, plays) {
    const C = c && Number.isFinite(c.C) ? c.C : 0;
    return -Math.abs(C - 0.92) + (plays ? 0 : 0.02);
  }

  // §1.3 item 7: the recommendation (main song + alts), then the best of the rest by score; n songs, no repeats.
  function songsForYou(rec, candidates, scoreOf, n = 5) {
    const out = [];
    const seen = new Set();
    const add = (s) => { if (s && s.id && !seen.has(s.id) && out.length < n) { seen.add(s.id); out.push(s); } };
    if (rec && rec.kind === 'song') { add(rec.song); (rec.alts || []).forEach(add); }
    (candidates || []).map((s, i) => ({ s, i, sc: scoreOf(s) }))
      .sort((a, b) => b.sc - a.sc || a.i - b.i)
      .forEach(({ s }) => add(s));
    return out;
  }

  // In-app back stack: going to the route just below the top pops; anything else pushes.
  // Steps inside one screen (e.g. #/ear/mary?step=echo, #/drill?meet=C4) share a base path: they
  // replace each other on the stack, so Back always leaves the screen instead of stepping through it.
  const basePath = (r) => String(r || '').split('?')[0];
  function nextStack(stack, route) {
    const s = stack || [];
    if (s.length && s[s.length - 1] === route) return s;
    if (s.length >= 2 && basePath(s[s.length - 2]) === basePath(route)) return s.slice(0, -2).concat(route);
    if (route === '#/') return ['#/'];
    if (s.length && basePath(s[s.length - 1]) === basePath(route)) return s.slice(0, -1).concat(route);
    return s.concat(route).slice(-50);
  }
  function backTarget(stack) {
    const s = stack || [];
    const here = basePath(s[s.length - 1]);
    for (let i = s.length - 2; i >= 0; i--) if (basePath(s[i]) !== here) return s[i];
    // Nothing earlier (opened from a link or a reload): a song screen goes to its mode's list.
    const m = /^#\/(practice|perform|ear|byear)\/[^/?]+/.exec(here);
    if (m) return m[1] === 'practice' || m[1] === 'perform' ? `#/songs/${m[1]}` : `#/${m[1]}`;
    return '#/';
  }

  const Core = {
    STAGE_NAMES, parseRoute, songKeys, stageOf, groupByStage, FILTERS, isEtude, matchesFilter,
    practiceAvailable, noteCheckVisible, snoozeUntil, quickDrillKeys, summaryText, comfortScore,
    songsForYou, nextStack, backTarget,
  };
  if (isNode) { module.exports = Core; return; }

  // ======================================================================
  // BROWSER
  // ======================================================================
  const NS = root.NS;
  const { svgEl, starText } = NS.util;
  const MISSING = 'That song isn’t here any more.';

  // ---------- data access (works with the WP0 stubs and with the full modules) ----------
  const Curr = () => NS.curriculum || root.Curriculum || null;
  const allSongs = () => (NS.songs && NS.songs.all ? NS.songs.all() : root.NoteSongs.songs);
  function getSong(id) {
    if (!id) return null;
    try { if (NS.songs && NS.songs.get) return NS.songs.get(id) || null; } catch { /* fall through */ }
    return root.NoteSongs.songs.find((s) => s.id === id) || null;
  }
  const appState = () => { try { return NS.store.state(); } catch { return {}; } };
  function course() {
    try { return NS.store.section('course') || {}; } catch { return appState().course || {}; }
  }
  function levelOf(song) {
    if (song.unit != null) return song.unit;
    const C = Curr();
    try { return C && C.songLevel ? C.songLevel(song) : Infinity; } catch { return Infinity; }
  }
  function comfortOf(song, S, now) {
    const C = Curr();
    try { return C && C.comfort ? C.comfort(song, S, now) : null; } catch (err) { return null; }
  }
  const noteState = (k) => { try { return NS.mastery.state(k) || 'new'; } catch { return 'new'; } };
  const noteRusty = (k) => { try { return Boolean(NS.mastery.rusty(k)); } catch { return false; } };
  const noteRec = (k) => { try { return NS.mastery.get(k) || null; } catch { return null; } };
  const practiceSongs = () => { try { return NS.store.slice('practice').get().songs || {}; } catch { return {}; } };
  const isPracticeAvailable = (song) => practiceAvailable(levelOf(song), course().unit || 0);
  const performUnlocked = (song) => song.index != null && NS.compat ? NS.compat.isUnlocked(song.index) : false;
  const earPath = () => {
    const p = (NS.EarCore && NS.EarCore.EAR_PATH) || [];
    return p.map((x) => (typeof x === 'string' ? x : x && x.id)).filter(Boolean);
  };

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const enc = encodeURIComponent;

  // ======================================================================
  // ROUTER
  // ======================================================================
  let cur = null; // { route, modeId, params, def, root }
  let stack = [];
  let started = false;
  let routed = false;

  function unmountCurrent() {
    if (!cur) return;
    try { if (cur.def.unmount) cur.def.unmount(); } catch (err) { console.error('[shell] unmount failed', err); }
    NS.audio.stopAll();
    if (cur.root) cur.root.remove();
    cur = null;
  }

  function replace(r) {
    const target = r.startsWith('#') ? r : '#' + r;
    if (location.hash === target) { route(); return; }
    try { history.replaceState(null, '', target); route(); } catch { location.hash = target; }
  }

  function route() {
    const p = parseRoute(location.hash);
    let def = null;
    if (p.modeId === 'home') def = HOME;
    else if (p.modeId === 'songs') def = LIBRARY;
    else def = NS.modes.get(p.modeId);
    if (!def) {
      NS.ui.toast(MISSING);
      replace('#/');
      return;
    }
    // A song mode without a song goes to its library.
    if (def.needsSong && !p.arg) { replace(`#/songs/${enc(def.id)}`); return; }
    if (def === LIBRARY && !libraryModeOk(p.arg)) {
      NS.ui.toast(MISSING);
      replace('#/');
      return;
    }

    unmountCurrent();
    NS.ui.closeAll();
    const main = document.createElement('main');
    main.className = 'wrap';
    main.dataset.mode = def.id;
    main.tabIndex = -1;
    (document.getElementById('app') || document.body).appendChild(main);
    // Show only this mode's screen; hide every other main.wrap (perform.js's own too) and any overlay.
    document.querySelectorAll('main.wrap').forEach((m) => (m.hidden = m !== main));
    document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true));
    window.scrollTo(0, 0);

    const params = { arg: p.arg, query: p.query };
    stack = nextStack(stack, p.route);
    cur = { route: p.route, modeId: def.id, params, def, root: main };
    try { NS.store.slice('shell').update((s) => { s.lastRoute = p.route; return s; }); } catch { /* optional */ }
    const ctx = {
      go, back,
      setTitle: (t) => { document.title = t ? `${t} · Note Steps` : 'Note Steps'; },
      store: def === HOME || def === LIBRARY ? NS.store.slice('shell') : NS.store.slice(def.id),
    };
    document.title = 'Note Steps';
    NS.bus.emit('route', { route: p.route, modeId: def.id, arg: p.arg, query: p.query });
    try { def.mount(main, params, ctx); } catch (err) { console.error(`[shell] mount ${def.id} failed`, err); }
    // Move focus to the new screen for screen readers (not on first load, not when a legacy mode hid it).
    if (routed && !main.hidden && !main.contains(document.activeElement)) main.focus({ preventScroll: true });
    routed = true;
  }

  function go(r) {
    const target = r.startsWith('#') ? r : '#' + r;
    if (location.hash === target || (target === '#/' && (location.hash === '' || location.hash === '#'))) route();
    else location.hash = target;
  }
  function back() { go(backTarget(stack)); }
  function current() { return cur ? { route: cur.route, modeId: cur.modeId, params: cur.params } : null; }

  function start() {
    if (started) return;
    started = true;
    const boot = () => {
      window.addEventListener('hashchange', route);
      route();
    };
    // Deferred scripts (qrcode) and late mode registrations finish before DOMContentLoaded.
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }

  NS.debug.mode = () => (cur && cur.def.debugState ? cur.def.debugState() : null);
  NS.debug.shell = () => ({ route: cur && cur.route, modeId: cur && cur.modeId, stack: stack.slice() });

  // ======================================================================
  // SHARED PIECES
  // ======================================================================
  const LOCK_SVG = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M4 7V5a4 4 0 1 1 8 0v2h.5A1.5 1.5 0 0 1 14 8.5v5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5v-5A1.5 1.5 0 0 1 3.5 7H4zm1.8 0h4.4V5a2.2 2.2 0 1 0-4.4 0v2z"/></svg>';

  // Small default tile icons (a mode may give its own def.icon).
  const ICONS = {
    practice: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
    ear: '<path d="M6 9a6 6 0 1 1 12 0c0 3-2 4-3 5.5S14 18 12 19a3 3 0 0 1-4-1"/><path d="M10 9a2 2 0 1 1 4 0"/>',
    perform: '<circle cx="12" cy="12" r="9"/><path d="M10 8l6 4-6 4z" fill="currentColor"/>',
    drill: '<rect x="3" y="6" width="13" height="15" rx="2"/><path d="M8 3h11a2 2 0 0 1 2 2v13"/>',
    free: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M7 5v8M12 5v8M17 5v8"/>',
    notes: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    byear: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="2" y="14" width="5" height="7" rx="2"/><rect x="17" y="14" width="5" height="7" rx="2"/>',
  };
  function iconFor(def) {
    if (def.icon) return def.icon;
    const p = ICONS[def.id] || '<circle cx="12" cy="12" r="8"/>';
    return `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  }

  // Badges from every mode's songBadge(songId), as small muted lines.
  function badgesFor(songId) {
    const out = [];
    NS.modes.list().forEach((m) => {
      let line = null;
      try { line = m.songBadge ? m.songBadge(songId) : null; } catch { line = null; }
      if (!line || !line.text) return;
      const b = el('span', `mode-badge tone-${line.tone || 'muted'}`);
      if (line.stars != null) {
        const st = el('span', 'stars-sm', starText(line.stars) + ' ');
        st.setAttribute('aria-hidden', 'true');
        b.append(st, el('span', 'sr-only', `${line.stars} of 3 stars. `));
        b.appendChild(document.createTextNode(line.plain != null ? line.plain : line.text));
      } else b.textContent = line.text;
      out.push(b);
    });
    return out;
  }

  // Which library modes exist: every registered mode that takes a song, plus Ear First.
  function libraryModeOk(id) {
    if (!id) return false;
    const def = NS.modes.get(id);
    return Boolean(def && (def.needsSong || id === 'ear'));
  }

  // Lock state of a song in a library mode -> {locked, why}
  function lockFor(modeId, song) {
    const def = NS.modes.get(modeId);
    if (def && def.songLocked) {
      try { const r = def.songLocked(song.id); if (r) return { locked: Boolean(r.locked), why: r.why || '' }; } catch { /* default below */ }
    }
    if (modeId === 'practice') {
      if (isPracticeAvailable(song)) return { locked: false };
      const t = NS.ui.core.comfortText(comfortOf(song, appState(), Date.now()), { context: songKeys(song) });
      return { locked: true, why: t.label === 'locked' ? t.detail : 'Meet its notes first to unlock it.' };
    }
    if (modeId === 'perform') {
      if (performUnlocked(song)) return { locked: false };
      return { locked: true, why: performWhy(song) };
    }
    return { locked: false };
  }
  function performWhy(song) {
    const prev = song.index > 0 ? allSongs()[song.index - 1] : null;
    return prev
      ? `Opens when you finish “${prev.title}” in Practice, get 2 stars performing it, or meet all of this song’s notes.`
      : 'Not available yet.';
  }

  // One song row. opts: {onMain, onMore, mainLabel, locked, why, comfort}
  function songRow(song, { onMain, onMore, mainLabel, locked = false, why = '', comfort } = {}) {
    const li = el('li', 'song-row-wrap' + (locked ? ' locked' : ''));
    li.dataset.song = song.id;
    const main = el('button', 'song-row');
    main.type = 'button';
    const title = el('span', 'sr-title');
    title.appendChild(el('strong', null, song.title));
    if (locked) { const lk = el('span', 'sr-lock'); lk.innerHTML = LOCK_SVG; title.appendChild(lk); }
    main.appendChild(title);
    const origin = song.origin || song.blurb;
    if (origin) main.appendChild(el('span', 'sr-origin', origin));
    const line = el('span', 'sr-line');
    if (comfort !== undefined) line.appendChild(NS.ui.comfortPill(comfort, { lockedDetail: !(locked && why), keys: songKeys(song) }));
    badgesFor(song.id).forEach((b) => line.appendChild(b));
    if (line.childNodes.length) main.appendChild(line);
    if (locked && why) main.appendChild(el('span', 'sr-why', why));
    const hint = [locked ? 'Locked' : '', mainLabel || ''].filter(Boolean).join(', ');
    if (hint) main.appendChild(el('span', 'sr-only', `. ${hint}.`));
    main.addEventListener('click', onMain);
    li.appendChild(main);
    if (onMore) {
      const more = el('button', 'btn small more', '⋯');
      more.type = 'button';
      more.setAttribute('aria-label', `More about ${song.title}`);
      more.addEventListener('click', onMore);
      li.appendChild(more);
    }
    return li;
  }

  // ======================================================================
  // SONG SHEET (§3.8.4)
  // ======================================================================
  function songSheet(songId) {
    const song = getSong(songId);
    if (!song) { NS.ui.toast(MISSING); return null; }
    const S = appState();
    const now = Date.now();
    const comfort = comfortOf(song, S, now);
    const keys = songKeys(song);
    const etude = isEtude(song) || song.index == null;

    const box = el('div', 'song-sheet');
    const origin = song.origin || song.blurb;
    if (origin) box.appendChild(el('p', 'muted ss-origin', origin));
    if (comfort) box.appendChild(NS.ui.comfortPill(comfort, { detail: true, keys }));
    if (keys.length) box.appendChild(NS.ui.noteChips(keys, noteState, { rusty: noteRusty }));

    const status = el('p', 'muted ss-status');
    status.setAttribute('aria-live', 'polite');

    const actions = el('div', 'ss-actions');
    let handle = null;
    const hear = el('button', 'btn', '▶ Hear it');
    const stopHear = () => { if (handle) { const h = handle; handle = null; h.stop(); } };
    const resetHear = () => { handle = null; hear.textContent = '▶ Hear it'; hear.setAttribute('aria-pressed', 'false'); };
    hear.setAttribute('aria-pressed', 'false');
    hear.addEventListener('click', () => {
      NS.audio.resume();
      if (handle) { stopHear(); resetHear(); status.textContent = ''; return; }
      handle = NS.audio.playSequence(song.items || song.notes, {
        bpm: song.bpm || 90, voice: 'piano', id: 'song-sheet',
        onEnd: () => { resetHear(); status.textContent = ''; },
      });
      hear.textContent = '■ Stop';
      hear.setAttribute('aria-pressed', 'true');
      status.textContent = `Playing ${song.title}. Your mic is paused.`;
    });
    actions.appendChild(hear);

    const goTo = (r) => { sh.close(); go(r); };
    if (NS.modes.get('practice')) {
      const avail = isPracticeAvailable(song);
      const read = el('button', 'btn primary', avail ? 'Read it' : 'Try anyway');
      read.setAttribute('aria-label', avail ? `Read ${song.title} in Practice` : `Try ${song.title} in Practice anyway`);
      read.addEventListener('click', () => goTo(`#/practice/${enc(song.id)}`));
      actions.appendChild(read);
      if (!avail) box.appendChild(el('p', 'ss-note', 'You can still try it in Practice: notes you haven’t met yet show their names.'));
    }
    if (!etude && NS.modes.get('ear')) {
      const inPath = earPath().includes(song.id);
      const ear = el('button', 'btn', 'Learn by ear');
      ear.addEventListener('click', () => goTo(inPath ? `#/ear/${enc(song.id)}` : `#/ear/${enc(song.id)}?step=echo&try=1`));
      actions.appendChild(ear);
    }
    if (!etude && NS.modes.get('perform')) {
      const ok = performUnlocked(song);
      const pa = el('button', 'btn', 'Play along');
      pa.disabled = !ok;
      if (ok) pa.addEventListener('click', () => goTo(`#/perform/${enc(song.id)}`));
      actions.appendChild(pa);
      if (!ok) {
        const why = el('p', 'muted ss-why', `Play along: ${performWhy(song)}`);
        why.id = 'ssWhy' + song.index;
        pa.setAttribute('aria-describedby', why.id);
        box.appendChild(why);
      }
    }
    if (!etude && NS.modes.get('byear')) {
      const be = el('button', 'btn', 'Play by ear');
      be.addEventListener('click', () => goTo(`#/byear/${enc(song.id)}`));
      actions.appendChild(be);
    }
    box.appendChild(actions);
    box.appendChild(status);
    const badges = badgesFor(song.id);
    if (badges.length) {
      const bl = el('div', 'ss-badges');
      badges.forEach((b) => bl.appendChild(b));
      box.appendChild(bl);
    }
    const sh = NS.ui.sheet({ title: song.title, content: box, onClose: stopHear });
    return sh;
  }

  // ======================================================================
  // SETTINGS SHEET (§1.3 item 8)
  // ======================================================================
  function settingsSheet() {
    const st = NS.store.settings();
    const box = el('div', 'settings');
    const row = (label, control, hintEl) => {
      const r = el('div', 'set-row');
      const lab = el('span', 'set-label', label);
      lab.id = 'set' + label.replace(/\W+/g, '');
      control.setAttribute('aria-labelledby', lab.id);
      r.append(lab, control);
      if (hintEl) r.appendChild(hintEl);
      box.appendChild(r);
    };
    const set = (k, v) => { NS.store.setSetting(k, v); NS.store.save(); };

    const namesHint = el('p', 'muted set-hint', 'With names always shown, notes stay in Learning.');
    namesHint.hidden = st.labels !== 'always';
    row('Note names', NS.ui.seg([{ value: 'auto', label: 'Auto' }, { value: 'always', label: 'All' }, { value: 'never', label: 'Off' }], st.labels || 'auto', (v) => {
      set('labels', v);
      namesHint.hidden = v !== 'always';
      if (root.NoteSteps && root.NoteSteps.updateNamesButtons) root.NoteSteps.updateNamesButtons();
    }), namesHint);
    row('Shape hints', NS.ui.seg([{ value: 'auto', label: 'Auto' }, { value: 'always', label: 'Always' }, { value: 'off', label: 'Off' }], st.shapes || 'auto', (v) => set('shapes', v)));
    row('Key labels on the on-screen keyboard', NS.ui.seg([{ value: true, label: 'On' }, { value: false, label: 'Off' }], st.keyLabels !== false, (v) => set('keyLabels', v)));
    row('Hear tunes first', NS.ui.seg([{ value: 'ask', label: 'Ask' }, { value: 'always', label: 'Always' }], st.hearFirst || 'ask', (v) => set('hearFirst', v)));

    const checks = el('div', 'set-actions');
    const sound = el('button', 'btn', 'Sound check');
    sound.addEventListener('click', () => NS.ui.soundCheck());
    const mic = el('button', 'btn', 'Mic check');
    mic.addEventListener('click', () => NS.ui.micCheck());
    checks.append(sound, mic);
    box.appendChild(checks);

    const reset = el('button', 'btn danger', 'Reset note progress');
    reset.addEventListener('click', async () => {
      const v = await NS.ui.dialog({
        title: 'Reset note progress?',
        body: 'This forgets which notes you know and starts the course again from middle C and D. Your song stars and Perform scores stay.',
        actions: [{ label: 'Cancel', value: false, cancel: true }, { label: 'Reset', value: true, primary: true }],
      });
      if (!v) return;
      NS.store.reset('notes');
      NS.store.save();
      NS.ui.toast('Note progress reset.');
    });
    box.appendChild(reset);
    return NS.ui.sheet({ title: 'Settings', content: box });
  }

  // ======================================================================
  // HOME (§1.3)
  // ======================================================================
  const HOME_HTML = `
  <section class="hero">
    <svg class="hero-staff" viewBox="0 0 360 90" aria-hidden="true">
      <g stroke="currentColor" stroke-width="1.2" opacity="0.55">
        <line x1="0" x2="360" y1="20" y2="20"/><line x1="0" x2="360" y1="32" y2="32"/><line x1="0" x2="360" y1="44" y2="44"/><line x1="0" x2="360" y1="56" y2="56"/><line x1="0" x2="360" y1="68" y2="68"/>
      </g>
      <text x="4" y="66" font-size="62" fill="currentColor" font-family="Noto Music, serif">𝄞</text>
      <g fill="currentColor" data-hero-notes></g>
    </svg>
    <span class="eyebrow">Learn to read music</span>
    <h1>Note Steps</h1>
    <p class="muted">Read the note on the staff, then play it on your piano or keyboard. Your phone listens and tells you if you got it right.</p>
    <button class="today" type="button" data-today>
      <span class="today-main">
        <span class="today-dots" data-today-dots aria-hidden="true"></span>
        <span class="today-text" data-today-text></span>
      </span>
      <span class="chev" aria-hidden="true">›</span>
    </button>
  </section>

  <section class="card invite" data-invite hidden aria-labelledby="inviteH">
    <h2 id="inviteH">Welcome back!</h2>
    <p>Take a 2-minute note check so the app knows what you can already read.</p>
    <div class="row">
      <button class="btn primary" type="button" data-invite-go>Take the check</button>
      <button class="linkbtn" type="button" data-invite-later>Not now</button>
    </div>
  </section>

  <section class="card upnext" data-upnext aria-labelledby="upTitle">
    <span class="eyebrow">Up next</span>
    <h2 id="upTitle" data-up-title></h2>
    <p class="muted" data-up-sub></p>
    <div class="row"><button class="btn primary" type="button" data-up-start>Start</button></div>
    <div class="up-gate" data-up-gate hidden></div>
    <div class="up-alts" data-up-alts hidden></div>
  </section>

  <button class="card drillcard" type="button" data-drill hidden>
    <span class="dc-title">Quick note drill · 2 min</span>
    <span class="muted dc-sub" data-drill-sub></span>
  </button>

  <div data-micbar></div>

  <section aria-labelledby="modesH">
    <h2 id="modesH" class="sr-only">Ways to play</h2>
    <div class="modes-grid" data-modes></div>
  </section>

  <section class="for-you" aria-labelledby="forYouH">
    <div class="section-head">
      <h2 id="forYouH">Songs for you</h2>
      <a class="linkbtn" href="#/songs/practice">Browse all songs</a>
    </div>
    <ul class="song-rows" data-foryou></ul>
  </section>

  <button class="settings-row" type="button" data-settings>
    <span><strong>Settings</strong><span class="muted" data-settings-sub></span></span>
    <span class="chev" aria-hidden="true">›</span>
  </button>

  <p class="tip"><strong>Finding middle C:</strong> look for a group of two black keys near the middle of your keyboard. The white key just to the left of them is C. On the staff, middle C sits on its own short line just below the five lines.</p>
  <p class="tip"><strong>Play one note at a time.</strong> Let each note sound on its own before you play the next one, and keep the phone close to the piano so it can hear you.</p>

  <section class="qr" data-qr-box hidden>
    <div class="qr-code" data-qr-code></div>
    <div class="meta">
      <strong>Open on your phone</strong>
      <span class="muted">Point your phone's camera at this code, then prop the phone near your keyboard.</span>
      <span class="url" data-qr-url></span>
    </div>
  </section>`;

  let home = null; // { root, micBar, offs, timer, debug }

  function renderHeroNotes(rootEl) {
    const g = rootEl.querySelector('[data-hero-notes]');
    [-2, -1, 0, 1, 2, 3, 4, 5].forEach((pos, i) => { // the C major scale, middle C up
      const x = 80 + i * 34;
      const y = 68 - pos * 6;
      if (pos <= -2) svgEl('line', { x1: x - 11, x2: x + 11, y1: 80, y2: 80, stroke: 'currentColor', 'stroke-width': 1.2, opacity: 0.55 }, g);
      svgEl('ellipse', { cx: x, cy: y, rx: 7, ry: 5, transform: `rotate(-20 ${x} ${y})` }, g);
    });
  }

  function renderQr(rootEl) {
    const onPhone = window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 820;
    const url = location.href.split('#')[0];
    const isLocal = /^(localhost|127\.|\[::1\])/.test(location.hostname) || location.protocol === 'file:';
    if (onPhone || typeof root.QRCode === 'undefined') return;
    const box = rootEl.querySelector('[data-qr-box]');
    const urlEl = rootEl.querySelector('[data-qr-url]');
    box.hidden = false;
    urlEl.textContent = url;
    new root.QRCode(rootEl.querySelector('[data-qr-code]'), { text: url, width: 240, height: 240, correctLevel: root.QRCode.CorrectLevel.M });
    if (isLocal) {
      urlEl.textContent = url + ' (this is a local test address, so a phone can’t open it yet; once the app is online this code will work)';
    }
  }

  function renderToday(q) {
    const C = Curr();
    const keys = C && C.UNIT_OF ? Object.keys(C.UNIT_OF) : [];
    const dots = q('[data-today-dots]');
    dots.innerHTML = '';
    let sum = { known: 0, learning: 0, new: 0, locked: 0, rusty: 0 };
    try { sum = Object.assign(sum, NS.mastery.summary()); } catch { /* stub */ }
    const anyMet = sum.known + sum.learning + sum.new > 0;
    keys.forEach((k) => {
      const st = anyMet ? noteState(k) : 'locked';
      const d = el('span', `tdot st-${st}${noteRusty(k) ? ' rusty' : ''}`);
      dots.appendChild(d);
    });
    const text = summaryText(sum) || 'Your first notes are middle C and D.';
    q('[data-today-text]').textContent = text;
    q('[data-today]').setAttribute('aria-label', `${text} Open My notes.`);
    q('[data-today]').hidden = !NS.modes.get('notes') && !keys.length;
  }

  function renderInvite(q) {
    const c = course();
    q('[data-invite]').hidden = !(noteCheckVisible(c, Date.now()) && NS.modes.get('drill'));
  }

  function upNextStep(S, songs, now) {
    const C = Curr();
    // The invite card handles the note check, so Up next is worked out as if it were done.
    const Sx = S && S.course && S.course.checkDone === false ? Object.assign({}, S, { course: Object.assign({}, S.course, { checkDone: true }) }) : S;
    try { if (C && C.nextStep) { const st = C.nextStep(Sx, songs, now); if (st && st.route) return st; } } catch (err) { console.error('[shell] nextStep failed', err); }
    return { kind: 'run', title: 'A short reading run', sub: 'A few easy notes to read.', route: '#/practice/run?seed=1' };
  }

  function renderUpNext(q, S, songs, now) {
    const step = upNextStep(S, songs, now);
    q('[data-up-title]').textContent = step.title || 'Keep reading';
    const sub = q('[data-up-sub]');
    sub.textContent = step.sub || '';
    sub.hidden = !step.sub;
    const startBtn = q('[data-up-start]');
    startBtn.setAttribute('aria-label', `Start: ${step.title || 'up next'}`);
    startBtn.onclick = () => { NS.audio.resume(); go(step.route); };

    // Intro gate copy (§3.2.6).
    const gateBox = q('[data-up-gate]');
    gateBox.innerHTML = '';
    gateBox.hidden = true;
    let gate = 'open';
    try { gate = NS.mastery.introGate(); } catch { gate = 'open'; }
    const C = Curr();
    const unit = course().unit || 0;
    const next = C && C.UNITS ? C.UNITS[unit] : null;
    if (gate === 'soft' && next && step.kind !== 'meet') {
      let settling = [];
      try { settling = NS.mastery.introduced().filter((k) => noteState(k) !== 'known'); } catch { settling = []; }
      const nextName = NS.ui.core.listLetters(next.notes).replace(/, ([^,]*)$/, ' and $1');
      const settlingText = NS.ui.core.listLetters(settling).replace(/, ([^,]*)$/, ' and $1');
      gateBox.appendChild(el('p', null, `You’re still settling in ${settlingText || 'your notes'}. Meet ${nextName} now, or practise first?`));
      const r = el('div', 'row');
      const meet = el('button', 'btn small', `Meet ${nextName}`);
      meet.addEventListener('click', () => go(`#/drill?meet=${next.notes.join(',')}`));
      const drill = el('button', 'btn small', 'Quick drill');
      drill.addEventListener('click', () => go('#/drill'));
      r.append(meet, drill);
      gateBox.appendChild(r);
      gateBox.hidden = !NS.modes.get('drill');
    } else if (gate === 'done' && step.kind !== 'check') {
      gateBox.appendChild(el('p', 'muted', 'All 11 treble notes known. Next stage coming soon.'));
      gateBox.hidden = false;
    }

    // "or try:" up to 2 alternative songs.
    const alts = q('[data-up-alts]');
    alts.innerHTML = '';
    let altSongs = [];
    if (step.kind === 'song') {
      try {
        const rec = C.recommend(S, songs, now);
        altSongs = rec && rec.kind === 'song' ? (rec.alts || []).filter((s) => s && s.id).slice(0, 2) : [];
      } catch { altSongs = []; }
    }
    if (altSongs.length) {
      alts.appendChild(el('span', 'muted', 'or try: '));
      altSongs.forEach((s, i) => {
        const b = el('button', 'linkbtn', s.title);
        b.addEventListener('click', () => go(`#/practice/${enc(s.id)}`));
        alts.appendChild(b);
        if (i < altSongs.length - 1) alts.appendChild(document.createTextNode(' · '));
      });
    }
    alts.hidden = !altSongs.length;
    return step;
  }

  function renderDrillCard(q) {
    let keys = [];
    try { keys = NS.mastery.introduced(); } catch { keys = []; }
    const weak = quickDrillKeys(keys, (k) => ({ state: noteState(k), acc: (noteRec(k) || {}).acc, rusty: noteRusty(k) }));
    const card = q('[data-drill]');
    card.hidden = !weak.length || !NS.modes.get('drill');
    const sub = NS.ui.core.listLetters(weak);
    q('[data-drill-sub]').textContent = sub;
    card.setAttribute('aria-label', `Quick note drill, 2 minutes: ${sub}`);
    return weak;
  }

  function renderModes(q) {
    const grid = q('[data-modes]');
    grid.innerHTML = '';
    const defs = NS.modes.list().filter((m) => !m.hidden);
    defs.forEach((m, i) => {
      const b = el('button', 'mode-tile');
      b.type = 'button';
      b.dataset.mode = m.id;
      if (defs.length % 2 === 1 && i === defs.length - 1) b.classList.add('wide');
      const ic = el('span', 'mt-icon');
      ic.innerHTML = iconFor(m);
      const t = el('span', 'mt-title', m.title || m.id);
      const bl = el('span', 'mt-blurb', m.blurb || '');
      b.append(ic, t, bl);
      let chipText = null;
      try { chipText = m.tileChip ? m.tileChip() : null; } catch { chipText = null; }
      if (chipText) b.appendChild(el('span', 'mt-chip', chipText));
      b.setAttribute('aria-label', [m.title, m.blurb, chipText].filter(Boolean).join('. '));
      b.addEventListener('click', () => { NS.audio.resume(); go(m.needsSong ? `#/songs/${enc(m.id)}` : `#/${enc(m.id)}`); });
      grid.appendChild(b);
    });
  }

  function renderForYou(q, S, songs, now) {
    const list = q('[data-foryou]');
    list.innerHTML = '';
    const ps = practiceSongs();
    // Course songs only: extras (beyond the course's notes) stay in the library.
    const pool = songs.filter((s) => !isEtude(s) && Number.isFinite(levelOf(s)) && isPracticeAvailable(s));
    const comforts = new Map();
    const cOf = (s) => { if (!comforts.has(s.id)) comforts.set(s.id, comfortOf(s, S, now)); return comforts.get(s.id); };
    let rec = null;
    try { const C = Curr(); rec = C && C.recommend ? C.recommend(S, songs, now) : null; } catch { rec = null; }
    const picks = songsForYou(rec, pool, (s) => comfortScore(cOf(s), (ps[s.id] || {}).plays), 5);
    if (!picks.length) {
      const li = el('li', 'empty');
      li.appendChild(el('p', 'muted', 'Songs open up as you meet new notes. Start with Up next, or browse every song and try one anyway.'));
      list.appendChild(li);
    }
    picks.forEach((s) => list.appendChild(songRow(s, { comfort: cOf(s), mainLabel: 'open song details', onMain: () => songSheet(s.id) })));
    return picks.map((s) => s.id);
  }

  function renderSettingsRow(q) {
    const st = NS.store.settings();
    const names = { auto: 'auto', always: 'all', never: 'off' }[st.labels] || 'auto';
    const shapes = { auto: 'auto', always: 'always', off: 'off' }[st.shapes] || 'auto';
    q('[data-settings-sub]').textContent = ` Names: ${names} · Shapes: ${shapes} · Sound and mic checks`;
  }

  function renderHome() {
    if (!home) return;
    const q = (s) => home.root.querySelector(s);
    const S = appState();
    const now = Date.now();
    const songs = allSongs();
    renderToday(q);
    renderInvite(q);
    const step = renderUpNext(q, S, songs, now);
    const weak = renderDrillCard(q);
    renderModes(q);
    const forYou = renderForYou(q, S, songs, now);
    renderSettingsRow(q);
    home.debug = { screen: 'home', upNext: step.kind, upRoute: step.route, quickDrill: weak, forYou };
  }
  const scheduleHome = () => {
    if (!home || home.timer) return;
    home.timer = setTimeout(() => { if (home) { home.timer = null; renderHome(); } }, 30);
  };

  const HOME = {
    id: 'home',
    mount(rootEl) {
      rootEl.id = 'home';
      rootEl.innerHTML = HOME_HTML;
      home = { root: rootEl, offs: [], timer: null, debug: { screen: 'home' } };
      const q = (s) => rootEl.querySelector(s);
      renderHeroNotes(rootEl);
      const slot = q('[data-micbar]');
      home.micBar = NS.ui.micBar(slot, { notice: true });
      q('[data-today]').addEventListener('click', () => go(NS.modes.get('notes') ? '#/notes' : '#/songs/practice'));
      q('[data-invite-go]').addEventListener('click', () => go('#/drill?check=1'));
      q('[data-invite-later]').addEventListener('click', () => {
        const c = course();
        c.checkSnoozeUntil = snoozeUntil(Date.now());
        NS.store.save();
        q('[data-invite]').hidden = true;
        NS.ui.toast('OK. I’ll ask again in a week.');
      });
      q('[data-drill]').addEventListener('click', () => go('#/drill'));
      q('[data-settings]').addEventListener('click', settingsSheet);
      renderHome();
      renderQr(rootEl);
      ['store:changed', 'modes:changed', 'mastery:changed', 'unit:introduced', 'practice:finished']
        .forEach((evt) => home.offs.push(NS.bus.on(evt, scheduleHome)));
    },
    unmount() {
      if (!home) return;
      home.offs.forEach((off) => off());
      clearTimeout(home.timer);
      if (home.micBar) home.micBar.destroy();
      home = null;
    },
    debugState: () => (home ? Object.assign({}, home.debug) : null),
  };

  // ======================================================================
  // LIBRARY (#/songs/:mode, §3.8.3)
  // ======================================================================
  const LIB_TITLES = {
    practice: ['Practice', 'Pick a song to read at your own pace.'],
    perform: ['Perform', 'Pick a song to play along in time.'],
    ear: ['Ear First', 'Pick a tune to learn by ear.'],
  };
  let lib = null; // { root, mode, offs, timer, debug }

  function libraryGroups(modeId, songs) {
    const C = Curr();
    if (NS.songs && NS.songs.byStage) {
      try {
        const by = NS.songs.byStage();
        const names = (C && C.STAGES) || STAGE_NAMES;
        const out = [];
        names.forEach((n, i) => { if ((by[i + 1] || []).length) out.push({ key: i + 1, title: `Stage ${i + 1} · ${n}`, songs: by[i + 1] }); });
        if ((by.extra || []).length) out.push({ key: 'extra', title: 'Extras (beyond this course)', songs: by.extra });
        if (out.length) return out;
      } catch { /* compute below */ }
    }
    return groupByStage(songs, (s) => stageOf(s, C), (C && C.STAGES) || STAGE_NAMES);
  }

  // Little steps etudes (practice only): units already introduced, grouped under their stage.
  function etudesByStage() {
    const out = {};
    const C = Curr();
    if (!(NS.songs && NS.songs.etudesFor) || !C || !C.UNITS) return out;
    const upto = course().unit || 0;
    for (let u = 0; u < Math.min(upto, C.UNITS.length); u++) {
      let list = [];
      try { list = NS.songs.etudesFor(u, 5) || []; } catch { list = []; }
      if (!list.length) continue;
      const st = C.UNITS[u].stage;
      (out[st] = out[st] || []).push({ unit: u, notes: C.UNITS[u].notes, songs: list });
    }
    return out;
  }

  function etudeRow(group) {
    const li = el('li', 'etude-row');
    const names = NS.ui.core.listLetters(group.notes).replace(/, ([^,]*)$/, ' and $1');
    li.appendChild(el('span', 'er-title', `Little steps with ${names}`));
    const r = el('div', 'er-chips');
    group.songs.forEach((s, k) => {
      const b = el('button', 'btn small chip', String(k + 1));
      b.setAttribute('aria-label', `${s.title || 'Little steps'} ${k + 1} of ${group.songs.length}, with ${names}`);
      b.addEventListener('click', () => go(`#/practice/${enc(s.id)}`));
      r.appendChild(b);
    });
    li.appendChild(r);
    return li;
  }

  function renderLibrary() {
    if (!lib) return;
    const { mode, body, filtersEl, listEl } = lib;
    const S = appState();
    const now = Date.now();
    const songs = allSongs().filter((s) => !isEtude(s));
    const shellSlice = NS.store.slice('shell').get() || {};
    const etudes = mode === 'practice' ? etudesByStage() : {};
    const hasEtudes = Object.keys(etudes).length > 0;
    // Filters: hide those that match nothing here.
    const available = FILTERS.filter((f) => f.id === 'all' || (f.id === 'steps' ? hasEtudes : songs.some((s) => matchesFilter(s, f.id))));
    let filter = shellSlice.libraryFilter || 'all';
    if (!available.some((f) => f.id === filter)) filter = 'all';
    filtersEl.innerHTML = '';
    filtersEl.hidden = available.length < 2;
    available.forEach((f) => {
      filtersEl.appendChild(NS.ui.chip(f.label, {
        pressed: f.id === filter,
        onClick: () => {
          NS.store.slice('shell').update((s) => { s.libraryFilter = f.id; return s; });
          NS.store.save();
          scheduleLibrary();
        },
      }));
    });

    listEl.innerHTML = '';
    const rows = [];
    libraryGroups(mode, songs).forEach((g) => {
      const inGroup = filter === 'steps' ? [] : g.songs.filter((s) => !isEtude(s) && matchesFilter(s, filter));
      const etGroups = (filter === 'all' || filter === 'steps') ? (etudes[g.key] || []) : [];
      if (!inGroup.length && !etGroups.length) return;
      const sec = el('section', 'lib-group');
      const head = el('div', 'level-head');
      head.appendChild(el('h2', null, g.title));
      if (mode === 'practice' && inGroup.length) {
        const ps = practiceSongs();
        head.appendChild(el('span', 'muted', `${inGroup.filter((s) => ps[s.id] && ps[s.id].best).length} of ${inGroup.length} read`));
      }
      sec.appendChild(head);
      const ul = el('ul', 'song-rows');
      inGroup.forEach((s) => {
        const lk = lockFor(mode, s);
        const open = () => { NS.audio.resume(); go(`#/${enc(mode)}/${enc(s.id)}`); };
        ul.appendChild(songRow(s, {
          comfort: comfortOf(s, S, now),
          locked: lk.locked,
          why: lk.locked ? lk.why : '',
          mainLabel: lk.locked ? 'open song details' : `open in ${LIB_TITLES[mode] ? LIB_TITLES[mode][0] : mode}`,
          onMain: lk.locked ? () => songSheet(s.id) : open,
          onMore: () => songSheet(s.id),
        }));
        rows.push({ id: s.id, locked: lk.locked });
      });
      etGroups.forEach((eg) => ul.appendChild(etudeRow(eg)));
      sec.appendChild(ul);
      listEl.appendChild(sec);
    });
    if (!rows.length && !listEl.childNodes.length) listEl.appendChild(el('p', 'muted', 'No songs match this filter.'));
    lib.debug = { screen: 'songs', mode, filter, rows };
  }
  const scheduleLibrary = () => {
    if (!lib || lib.timer) return;
    lib.timer = setTimeout(() => { if (lib) { lib.timer = null; renderLibrary(); } }, 30);
  };

  const LIBRARY = {
    id: 'songs',
    mount(rootEl, { arg }) {
      const mode = arg;
      const def = NS.modes.get(mode);
      const [title, sub] = LIB_TITLES[mode] || [def.title || mode, def.blurb || ''];
      rootEl.id = 'songs';
      const f = NS.ui.frame(rootEl, { eyebrow: 'Songs', title });
      document.title = `${title} songs · Note Steps`;
      if (sub) f.body.appendChild(el('p', 'muted', sub));
      const filtersEl = el('div', 'lib-filters');
      filtersEl.setAttribute('role', 'group');
      filtersEl.setAttribute('aria-label', 'Filter songs');
      const listEl = el('div', 'lib-list');
      f.body.append(filtersEl, listEl);
      lib = { root: rootEl, mode, body: f.body, filtersEl, listEl, offs: [], timer: null, debug: null };
      renderLibrary();
      ['store:changed', 'modes:changed', 'mastery:changed', 'unit:introduced']
        .forEach((evt) => lib.offs.push(NS.bus.on(evt, scheduleLibrary)));
    },
    unmount() {
      if (!lib) return;
      lib.offs.forEach((off) => off());
      clearTimeout(lib.timer);
      lib = null;
    },
    debugState: () => (lib ? Object.assign({}, lib.debug) : null),
  };

  NS.shell = { start, go, back, current, songSheet, settingsSheet, core: Core };
})(typeof window !== 'undefined' ? window : globalThis);
