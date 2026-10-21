// Note Drill mode (#/drill), spec §3.3 and §3.2.8. One route, four flows:
//   #/drill               15-card weighted deck of the notes you have met (source 'flash')
//   #/drill?focus=E4      the deck focused on one note;  #/drill?weak=1  the 4 weakest notes only
//   #/drill?meet=F4[,G4]  Meet a note: card, find it 3 times, a mixed phrase, then a first song (source 'intro')
//   #/drill?check=1       Note check (placement);  #/drill?check=E4  "I already know this" for one note
//
// The pure part (deck, card run, placement rules, outcome rule, plain wording) is UMD: NS.drillCore in
// the browser, require('../modes/drill.js') in Node. The browser part registers the mode.
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;

  // ======================================================================
  // PURE CORE
  // ======================================================================
  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const PC_OF = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const ORDER = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G5'];

  const T = {
    deckSize: 15,
    reinsertGap: 3, // a missed card comes back this many cards later
    maxReinsert: 2, // per note per drill
    quickMs: 1500, // "quick!" tag
    bleedMs: 300, // a wrong note this soon after a right one is sustain bleed, not a miss
    easyShare: 0.7, // at least this share of cards from notes with acc >= 0.6 or known
    checkFastMs: 4000, // placement: a read under this counts as fast
    checkStopAfter: 3, // placement stops after this many misses in a row
    oneCards: 5, // "I already know this": scored cards
    weakCount: 4, // ?weak=1 keeps this many notes
  };

  // Where each note sits, in plain words (never a mnemonic). Used after a right answer: "E, bottom line".
  const SHORT_POS = {
    C4: 'middle C, on its own short line', D4: 'just below the bottom line', E4: 'bottom line', F4: 'first space',
    G4: 'second line', A4: 'second space', B4: 'middle line', C5: 'third space', D5: 'fourth line',
    E5: 'top space', F5: 'top line', G5: 'just above the top line',
  };
  // Fallback copy of the §3.2.1 table, used only when Curriculum.NOTE_INFO has no entry for a key.
  const INFO = {
    C4: { text: 'Middle C. Its own short line below the staff.', anchor: null },
    D4: { text: 'Hangs just below the bottom line.', anchor: { from: 'C4', dist: 'step up' } },
    E4: { text: 'Bottom line.', anchor: { from: 'D4', dist: 'step up' } },
    F4: { text: 'First space.', anchor: { from: 'E4', dist: 'step up' } },
    G4: { text: 'Second line. The treble clef curls around it.', anchor: { from: 'E4', dist: 'skip up' } },
    A4: { text: 'Second space.', anchor: { from: 'G4', dist: 'step up' } },
    B4: { text: 'Middle line.', anchor: { from: 'G4', dist: 'skip up' } },
    C5: { text: 'Third space. Treble C, an octave above middle C.', anchor: { from: 'C4', dist: 'octave up' } },
    D5: { text: 'Fourth line.', anchor: { from: 'C5', dist: 'step up' } },
    E5: { text: 'Top space.', anchor: { from: 'C5', dist: 'skip up' } },
    F5: { text: 'Top line.', anchor: { from: 'E5', dist: 'step up' } },
    G5: { text: 'Sits just above the top line.', anchor: { from: 'F5', dist: 'step up' } },
  };

  // 'F#4' -> {key, letter, acc, octave, staffPos, midi}; same formulas as Notation.parseToken.
  function parseKey(key) {
    const m = /^([A-G])([#b♯♭]?)(-?\d+)$/.exec(String(key));
    if (!m) return null;
    const letter = m[1];
    const acc = m[2] === '♯' ? '#' : m[2] === '♭' ? 'b' : m[2];
    const octave = parseInt(m[3], 10);
    const midi = 12 * (octave + 1) + PC_OF[letter] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0);
    return { key: letter + acc + octave, letter, acc, octave, staffPos: octave * 7 + LETTERS.indexOf(letter) - 30, midi };
  }
  const pc = (m) => ((m % 12) + 12) % 12;
  const displayLetter = (key) => {
    const p = parseKey(key);
    return p ? p.letter + (p.acc === '#' ? '♯' : p.acc === 'b' ? '♭' : '') : String(key);
  };
  // Letters for a set of keys; adds the octave only where two keys share a letter (C4 and C5).
  function nameFor(key, allKeys) {
    const l = displayLetter(key);
    const clash = (allKeys || []).some((k) => k !== key && displayLetter(k) === l);
    return clash ? key.replace('#', '♯').replace(/b(?=-?\d)/, '♭') : l;
  }
  function listLetters(letters) {
    const a = [...letters];
    if (a.length <= 1) return a.join('');
    return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  }
  const shortPos = (key) => SHORT_POS[key] || null;
  function info(key, noteInfo) {
    return (noteInfo && noteInfo[key]) || INFO[key] || { text: '', anchor: null };
  }
  // {from:'G4', dist:'step up'} -> 'One step up from G.'
  function anchorText(anchor) {
    if (!anchor || !anchor.from) return '';
    return `One ${anchor.dist} from ${displayLetter(anchor.from)}.`;
  }

  // ---------- the deck (§3.3.1) ----------
  const isEasy = (n) => n.state === 'known' || (n.acc != null && n.acc >= 0.6);
  const isWeak = (n) => Boolean(n.rusty) || (n.state === 'learning' && (n.acc ?? 0.5) < 0.8);

  // Keys that weak notes are most often played as (top 2 confusion entries of each weak note).
  function confusionPartners(pool) {
    const out = new Set();
    pool.filter(isWeak).forEach((n) => {
      Object.entries(n.conf || {}).sort((a, b) => b[1] - a[1]).slice(0, 2).forEach(([k]) => out.add(k));
    });
    return out;
  }

  // n = {key, state, acc, rusty, rt, conf}; ctx = {focus: parseKey(focusKey)|null, partners:Set}
  function weightOf(n, { focus = null, partners = null } = {}) {
    if (focus) {
      if (n.key === focus.key) return 10;
      const p = parseKey(n.key);
      return p && Math.abs(p.staffPos - focus.staffPos) <= 2 ? 3 : 0.3;
    }
    let w = n.state === 'new' ? 3 : n.state === 'learning' ? 2 + 3 * (1 - (n.acc ?? 0.5)) : 0.5;
    if (n.rusty) w += 2;
    if (n.rt != null && n.rt > 3000) w += 1;
    if (partners && partners.has(n.key)) w += 1.5;
    return w;
  }

  function weightedPick(cands, weights, rng) {
    const total = cands.reduce((s, c) => s + weights.get(c.key), 0);
    let r = rng() * total;
    for (const c of cands) {
      r -= weights.get(c.key);
      if (r < 0) return c;
    }
    return cands[cands.length - 1];
  }

  // Our own deck, per §3.3.1. pool: [{key, state, acc, rusty, rt, conf}].
  function localDeck(pool, { focusKey = null, size = T.deckSize, rng = Math.random } = {}) {
    if (!pool.length) return [];
    if (pool.length === 1) return Array(size).fill(pool[0].key);
    const focus = focusKey && pool.some((p) => p.key === focusKey) ? parseKey(focusKey) : null;
    const partners = confusionPartners(pool);
    const W = new Map(pool.map((p) => [p.key, weightOf(p, { focus, partners })]));
    if (pool.length === 2) {
      // A pool of 2 alternates, starting with the heavier one.
      const [a, b] = [...pool].sort((x, y) => W.get(y.key) - W.get(x.key)).map((p) => p.key);
      return Array.from({ length: size }, (_, i) => (i % 2 ? b : a));
    }
    const easy = new Set(pool.filter(isEasy).map((p) => p.key));
    // A focused deck is about one note, so the easy-share rule does not apply to it.
    const hardBudget = focus || !easy.size ? size : Math.floor(size * (1 - T.easyShare));
    const out = [];
    let hard = 0;
    let prev = null;
    // A focused deck gives the focus note at least 40% of the cards (every other card at most).
    const need = focus ? Math.ceil(size * 0.4) : 0;
    let focusCount = 0;
    for (let i = 0; i < size; i++) {
      let cands = pool.filter((p) => p.key !== prev);
      if (focus && prev !== focus.key && need - focusCount >= Math.ceil((size - i) / 2)) cands = cands.filter((p) => p.key === focus.key);
      if (hard >= hardBudget) {
        const e = cands.filter((p) => easy.has(p.key));
        if (e.length) cands = e;
      }
      const pick = weightedPick(cands, W, rng);
      out.push(pick.key);
      if (focus && pick.key === focus.key) focusCount++;
      if (!easy.has(pick.key)) hard++;
      prev = pick.key;
    }
    return out;
  }

  // Cleans a deck from Curriculum.flashDeck: keeps only pool keys and removes back-to-back repeats
  // (a pool of 1 is the only exception). Returns null when too little is left to be worth using.
  function sanitizeDeck(keys, poolKeys, { size = T.deckSize } = {}) {
    if (!Array.isArray(keys)) return null;
    const pool = new Set(poolKeys);
    const left = keys.filter((k) => pool.has(k)).slice(0, size);
    if (pool.size === 1) return left.length >= Math.ceil(size * 0.6) ? left : null;
    const out = [];
    while (left.length) {
      const prev = out[out.length - 1];
      const j = left.findIndex((k) => k !== prev);
      if (j < 0) break;
      out.push(left.splice(j, 1)[0]);
    }
    return out.length >= Math.ceil(size * 0.6) ? out : null;
  }

  function buildDeck(pool, { focusKey = null, size = T.deckSize, rng = Math.random, flashDeck = null } = {}) {
    const poolKeys = pool.map((p) => p.key);
    let keys = null;
    if (typeof flashDeck === 'function') {
      try { keys = sanitizeDeck(flashDeck(), poolKeys, { size }); } catch { keys = null; }
      // A focused deck must actually be about the focus note.
      if (keys && focusKey && poolKeys.length > 1 && keys.filter((k) => k === focusKey).length < size * 0.3) keys = null;
    }
    return keys || localDeck(pool, { focusKey, size, rng });
  }

  // ?weak=1: the n notes with the lowest pct.
  function weakest(pool, n = T.weakCount) {
    return [...pool].sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0)).slice(0, n);
  }

  // ---------- a run of cards with reinsertion (§3.3.2) ----------
  function createRun(keys, { gap = T.reinsertGap, maxReinsert = T.maxReinsert } = {}) {
    const cards = keys.map((key, i) => ({ key, orig: true, n: i, missed: false, result: null }));
    const reinserted = {};
    let pos = 0;

    // Where to put the copy: as close to `gap` cards later as possible without the same note twice in a
    // row. Where that can't be done with one card (a deck that alternates 2 notes, or the very end), a
    // different note goes in front of it as a filler.
    function placeFor(key) {
      const others = [...new Set(cards.map((c) => c.key))].filter((k) => k !== key);
      for (const off of [gap, gap + 1, gap - 1, gap + 2, gap + 3]) {
        const at = Math.min(pos + off, cards.length);
        if (at <= pos) continue;
        const before = cards[at - 1];
        const after = cards[at];
        if (at > pos + 1 && before.key !== key && (!after || after.key !== key)) return { at, filler: null };
        const filler = others.find((k) => k !== before.key);
        if (filler && (!after || after.key !== key)) return { at, filler };
      }
      return null;
    }

    return {
      cards,
      get pos() { return pos; },
      current: () => cards[pos] || null,
      done: () => pos >= cards.length,
      // The first counted miss on the current card: reinsert the same note 3 cards later, at most twice
      // per note per drill. Returns the index of the new card, or -1.
      miss() {
        const c = cards[pos];
        if (!c || c.missed) return -1;
        c.missed = true;
        if ((reinserted[c.key] || 0) >= maxReinsert) return -1;
        const spot = placeFor(c.key);
        if (!spot) return -1;
        const copy = { key: c.key, orig: false, n: -1, missed: false, result: null };
        if (spot.filler) cards.splice(spot.at, 0, { key: spot.filler, orig: false, filler: true, n: -1, missed: false, result: null }, copy);
        else cards.splice(spot.at, 0, copy);
        reinserted[c.key] = (reinserted[c.key] || 0) + 1;
        return spot.filler ? spot.at + 1 : spot.at;
      },
      answer(result) {
        if (pos < cards.length) cards[pos].result = result;
        pos++;
      },
    };
  }

  // before: {[key]: {rt}} captured when the drill started.
  function summarize(cards, before = {}) {
    const orig = cards.filter((c) => c.orig && c.result);
    const keys = [];
    orig.forEach((c) => { if (!keys.includes(c.key)) keys.push(c.key); });
    const rows = keys.map((key) => {
      const mine = orig.filter((c) => c.key === key);
      const rts = cards.filter((c) => c.key === key && c.result && c.result.firstTry && c.result.rtMs != null).map((c) => c.result.rtMs);
      const avgRt = rts.length ? rts.reduce((s, x) => s + x, 0) / rts.length : null;
      const old = before[key] && before[key].rt;
      return {
        key, name: nameFor(key, keys), shown: mine.length, firstTry: mine.filter((c) => c.result.firstTry).length,
        avgRt, faster: avgRt != null && old != null && avgRt < old,
      };
    });
    return { firstTry: orig.filter((c) => c.result.firstTry).length, total: orig.length, rows };
  }
  function rowText(r) {
    let t = `${r.name} · ${r.firstTry}/${r.shown}`;
    if (r.avgRt != null) t += ` · ${(r.avgRt / 1000).toFixed(1)} s`;
    if (r.faster) t += ' · faster than last time';
    return t;
  }

  // ---------- the attempt rule, as in Practice (§3.1.3) ----------
  // att = {wrong, hinted, heardNote, labelAt}
  function attemptOutcome(att, tOnset, labels) {
    if (att.wrong || att.hinted) return 'miss';
    if ((att.labelAt != null && tOnset >= att.labelAt) || att.heardNote || labels === 'always') return 'assisted';
    return 'read';
  }
  // A wrong note counts only when the detector was sure and it isn't the last right note still ringing.
  function countsAsWrong(att, ev) {
    return ev.confident !== false && (att.lastCorrectAt == null || ev.tOnset - att.lastCorrectAt > T.bleedMs);
  }
  // The played note spelled at the octave nearest the target (for the confusion table).
  function nearestOctave(midi, targetMidi) {
    let d = pc(midi - targetMidi);
    if (d > 6) d -= 12;
    return targetMidi + d;
  }

  // ---------- Note check (§3.3.4) ----------
  // Two cards per note, interleaved so the same note never comes twice in a row: k0 k1 k0 k2 k1 k3 k2 ...
  function checkSequence(keys) {
    const seq = [];
    keys.forEach((k, i) => {
      seq.push(k);
      if (i > 0) seq.push(keys[i - 1]);
    });
    if (keys.length) seq.push(keys[keys.length - 1]);
    return seq;
  }
  // Same reading as Curriculum.placement: only a read under 4 s counts. Both fast -> known; one -> 'one'.
  function verdictOf({ fast, total = 2 }) {
    return fast >= total ? 'known' : fast >= 1 ? 'one' : 'none';
  }

  function createCheck(keys, { stopAfter = T.checkStopAfter, fastMs = T.checkFastMs } = {}) {
    const seq = checkSequence(keys);
    const tally = {};
    keys.forEach((k) => (tally[k] = { key: k, cards: [] }));
    let pos = 0;
    let inRow = 0;
    return {
      seq,
      get pos() { return pos; },
      current: () => (isDone() ? null : seq[pos]),
      done: isDone,
      answer(read, rtMs) {
        tally[seq[pos]].cards.push({ ok: Boolean(read), rtMs: read ? rtMs : null });
        inRow = read ? 0 : inRow + 1;
        pos++;
      },
      // Only notes that got both cards are judged. Shape: what NS.mastery.applyPlacement takes,
      // [{key, cards:[{ok, rtMs}]}], plus fast / verdict for our own summary.
      results() {
        return keys.map((k) => tally[k]).filter((t) => t.cards.length >= 2).map((t) => resultOf(t.key, t.cards, fastMs));
      },
    };
    function isDone() { return pos >= seq.length || inRow >= stopAfter; }
  }

  function resultOf(key, cards, fastMs = T.checkFastMs) {
    const fast = cards.filter((c) => c.ok && c.rtMs != null && c.rtMs < fastMs).length;
    return { key, cards: cards.map((c) => ({ ok: c.ok, rtMs: c.rtMs })), fast, verdict: verdictOf({ fast, total: cards.length }) };
  }

  // "I already know this" for one note: 5 scored cards, with other met notes in between (not scored) so
  // the same note is never shown twice in a row.
  function oneCheckCards(key, others, rng = Math.random, n = T.oneCards) {
    const pool = (others || []).filter((k) => k !== key);
    const out = [];
    for (let i = 0; i < n; i++) {
      if (i > 0 && pool.length) out.push({ key: pool[Math.floor(rng() * pool.length)], scored: false });
      out.push({ key, scored: true });
    }
    return out;
  }
  function onePasses(answers, { fastMs = T.checkFastMs, n = T.oneCards } = {}) {
    const scored = answers.filter((a) => a.scored);
    return scored.length >= n && scored.every((a) => a.read && a.rtMs < fastMs);
  }

  const core = {
    T, ORDER, SHORT_POS, INFO, parseKey, displayLetter, nameFor, listLetters, shortPos, info, anchorText,
    isEasy, isWeak, confusionPartners, weightOf, localDeck, sanitizeDeck, buildDeck, weakest,
    createRun, summarize, rowText, attemptOutcome, countsAsWrong, nearestOctave,
    checkSequence, verdictOf, resultOf, createCheck, oneCheckCards, onePasses,
  };
  if (isNode) { module.exports = core; return; }

  // ======================================================================
  // BROWSER: the mode
  // ======================================================================
  const NS = root.NS;
  NS.drillCore = core;
  const { svgEl } = NS.util;
  const Cur = () => NS.curriculum;
  const Not = () => NS.notation;

  const TEMPLATE = `
  <div class="progress"><div data-ref="progress"></div></div>
  <div class="staff-card drill-staff" data-ref="staffCard">
    <svg data-ref="staff" role="img" aria-label="Music staff"></svg>
  </div>
  <div data-ref="fbSlot"></div>
  <p class="drill-info" data-ref="info" hidden></p>
  <div class="controls drill-actions" data-ref="actions">
    <button class="btn" data-ref="hear">Hear the note</button>
    <button class="btn" data-ref="hint">Show me the key</button>
    <button class="btn" data-ref="skip" hidden>Not sure</button>
    <button class="btn primary" data-ref="next" hidden>Next</button>
  </div>
  <div data-ref="micSlot"></div>
  <p class="notice" data-mic-notice hidden></p>
  <div data-ref="kbWrap">
    <div class="keyboard" data-ref="keyboard" aria-label="On-screen keyboard. Tap a key to play it."></div>
  </div>
  <section class="drill-summary" data-ref="summary" hidden aria-live="polite"></section>`;

  let s = null; // everything about the mounted drill

  const settings = () => NS.store.settings();
  const labelsSetting = () => settings().labels || 'auto';
  const later = (fn, ms) => {
    const id = setTimeout(() => { s && s.timers.delete(id); fn(); }, ms);
    s.timers.add(id);
    return id;
  };
  const clearTimers = () => { if (s) { s.timers.forEach(clearTimeout); s.timers.clear(); } };
  const noteInfo = (key) => core.info(key, Cur().NOTE_INFO);
  // NOTE_INFO text plus the anchor ("One step up from G"), as one line.
  const infoLine = (key) => {
    const inf = noteInfo(key);
    let a = null;
    try { a = Cur().anchorText ? Cur().anchorText(key) : null; } catch { a = null; }
    if (a == null) a = core.anchorText(inf.anchor);
    else if (a && !/[.!?]$/.test(a)) a += '.';
    return [inf.text, a].filter(Boolean).join(' ');
  };
  const songsAll = () => (NS.songs && NS.songs.all ? NS.songs.all() : root.NoteSongs.songs);
  const courseUnit = () => {
    const st = NS.store.state();
    return (st && st.course && st.course.unit) || 0;
  };
  const introduced = () => (NS.mastery.introduced() || []).filter((k) => k in Cur().UNIT_OF);
  const poolEntry = (key) => {
    const rec = NS.mastery.get(key);
    return {
      key, state: NS.mastery.state(key), acc: rec ? rec.acc : 0.5, rusty: NS.mastery.rusty(key),
      rt: rec ? rec.rt : null, conf: (rec && rec.conf) || {}, pct: rec && NS.Mastery ? NS.Mastery.pct(rec) : 0,
    };
  };
  const noteOf = (key, dur = 'w') => {
    try { return Not().parseToken(key + ':' + dur); } catch { const p = core.parseKey(key); return Object.assign({ kind: 'note', dur, beats: 4 }, p); }
  };
  const rngNow = () => NS.util.mulberry32((Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0);

  function mount(rootEl, { query }, ctx) {
    s = {
      ctx, root: rootEl, timers: new Set(), offs: [], ui: {}, kb: null, micBar: null, frame: null, fb: null,
      variant: 'drill', phase: null, target: null, att: null, refresh: {}, prevKey: null, recorded: 0,
      newlyKnown: [], locked: false, mistakes: 0,
    };
    const q = query || new URLSearchParams();
    const meet = q.get('meet');
    const check = q.get('check');
    const right = document.createElement('span');
    right.className = 'count';
    s.frame = NS.ui.frame(rootEl, { eyebrow: 'Note Drill', title: 'Note Drill', right });
    s.ui.count = right;
    s.frame.body.innerHTML = TEMPLATE;
    s.frame.body.querySelectorAll('[data-ref]').forEach((e) => (s.ui[e.dataset.ref] = e));
    s.fb = NS.ui.feedback(s.ui.fbSlot);
    s.ui.fbSlot.replaceWith(s.fb.el);
    s.micBar = NS.ui.micBar(s.ui.micSlot);
    s.ui.micSlot.replaceWith(s.micBar.el);

    s.ui.hear.addEventListener('click', onHear);
    s.ui.hint.addEventListener('click', onHint);
    s.ui.skip.addEventListener('click', onSkip);
    s.ui.next.addEventListener('click', onNext);
    s.offs.push(
      NS.input.on(onInput),
      NS.bus.on('note:known', ({ key }) => {
        if (!s || s.newlyKnown.includes(key)) return;
        s.newlyKnown.push(key);
        if (s.variant === 'drill' || s.variant === 'meet') NS.ui.toast(`You know ${core.displayLetter(key)} now. Its name will stay hidden.`);
      }),
      NS.bus.on('resize', () => { if (s && s.phase === 'phrase') drawPhrase(); }),
    );

    if (meet) return startMeet(meet.split(',').map((k) => k.trim()).filter(Boolean));
    if (check) return check === '1' ? startCheck() : startOneCheck(check);
    return startDrill({ focusKey: q.get('focus'), weak: q.get('weak') === '1' });
  }

  function unmount() {
    if (!s) return;
    clearTimers();
    s.offs.forEach((off) => off());
    if (s.kb) s.kb.destroy();
    if (s.micBar) s.micBar.destroy();
    s = null;
  }

  function setHeader(eyebrow, title) {
    s.frame.setEyebrow(eyebrow);
    s.frame.setTitle(title);
    s.ctx.setTitle(title);
  }
  function setCount(i, n) {
    s.ui.count.textContent = n ? `${Math.min(i + 1, n)} / ${n}` : '';
    s.ui.progress.style.width = n ? (100 * Math.min(i, n)) / n + '%' : '0';
  }
  function showButtons({ hear = false, hint = false, skip = false, next = false, nextLabel = 'Next' } = {}) {
    s.ui.hear.hidden = !hear;
    s.ui.hint.hidden = !hint;
    s.ui.skip.hidden = !skip;
    s.ui.next.hidden = !next;
    s.ui.next.textContent = nextLabel;
  }
  function setInfo(text) {
    s.ui.info.hidden = !text;
    s.ui.info.textContent = text || '';
  }
  function buildKeyboard(keys) {
    if (s.kb) s.kb.destroy();
    const r = NS.keyboard.rangeFor(keys.map((k) => core.parseKey(k).midi), { width: root.innerWidth });
    s.kb = NS.keyboard.create(s.ui.keyboard, {
      low: r.low, high: r.high, tapDur: 0.6,
      labels: settings().keyLabels === false ? 'none' : 'all',
    });
    s.range = r;
  }
  const fold = (m) => (s && s.range ? Not().foldToRange(m, s.range.low, s.range.high) : m);

  // ---------- the single-note staff ----------
  const CARD_W = 200;
  const CARD_X = 128;
  function drawCard({ key, color = 'var(--accent)', fill = 'var(--accent-soft)', label = false, fade = false }) {
    const svg = s.ui.staff;
    s.ui.staffCard.classList.add('single');
    const S = NS.staff.create(svg, { width: CARD_W, height: 172 });
    S.clear();
    S.drawHighlight(CARD_X, { fill });
    S.drawStaff({ clef: true, endBar: true });
    S.drawNote(noteOf(key), CARD_X, {
      color, accidental: true, label: label ? core.displayLetter(key) : null,
      labelOpacity: fade ? 0.8 : 1, labelFade: fade, className: 'drill-note',
    });
    const where = Not().describePosition(noteOf(key));
    svg.setAttribute('aria-label', label ? `The note ${core.displayLetter(key)}, ${where}.` : `A note ${where}.`);
  }

  // ---------- one attempt at one target (§3.1.3 rules) ----------
  function newAttempt(key, { labelDelay = null } = {}) {
    const start = performance.now();
    s.att = { key, start, labelAt: null, wrong: 0, hinted: false, heardNote: false, playedKey: null, lastCorrectAt: s.att ? s.att.lastCorrectAt : null };
    s.target = core.parseKey(key);
    s.locked = false;
    if (s.labelTimer) clearTimeout(s.labelTimer);
    const delay = labelDelay != null ? labelDelay : delayFor(key);
    if (delay === 0) s.att.labelAt = start;
    else if (Number.isFinite(delay)) {
      s.labelTimer = later(() => {
        if (!s || !s.att || s.att.key !== key || s.locked) return;
        s.att.labelAt = performance.now();
        if (s.phase === 'phrase') drawPhrase(true); else drawCard({ key, label: true, fade: true });
        if (s.phase === 'phrase' || s.phase === 'drill' || s.phase === 'find') s.fb.set('neutral', `Play ${core.displayLetter(key)}`, '');
      }, delay);
    }
  }
  // Label timing: labelDelay, but a known note never shows its name on its own.
  function delayFor(key) {
    if (s.variant === 'check') return Infinity;
    const st = NS.mastery.state(key);
    if (st === 'known' && labelsSetting() !== 'always' && !(s.refresh[key] > 0)) return Infinity;
    const d = NS.mastery.labelDelay(key, { labels: labelsSetting(), refresh: s.refresh[key] || 0, guard: false });
    return typeof d === 'number' ? d : Infinity;
  }
  const labelVisible = () => Boolean(s.att && s.att.labelAt != null);
  const promptText = () => (labelVisible() ? `Play ${core.displayLetter(s.att.key)}` : 'Play the blue note');

  function onInput(ev) {
    if (!s || s.locked || !s.att || !s.target) return;
    if (!['find', 'drill', 'phrase', 'check', 'one'].includes(s.phase)) return;
    if (NS.audio.isBusy()) return; // our own sound; the mic is muted anyway, this also catches taps
    const target = s.target;
    if (s.kb) s.kb.setHeard(fold(ev.midi));
    const ok = pc(ev.midi) === pc(target.midi);
    if (s.phase === 'check' || s.phase === 'one') return judgeCheck(ev, ok);
    if (ok) onRight(ev); else onWrong(ev);
  }

  function recordRight(ev, source) {
    const att = s.att;
    const outcome = core.attemptOutcome(att, ev.tOnset, labelsSetting());
    const rtMs = Math.max(0, Math.round(ev.tOnset - att.start));
    NS.mastery.record({
      key: att.key, outcome, source, rtMs, repeat: att.key === s.prevKey, playedKey: att.playedKey,
      songPlays: 0, confident: true, firstToken: s.recorded === 0, ts: Date.now(),
    });
    s.recorded++;
    s.prevKey = att.key;
    if (s.refresh[att.key] > 0) s.refresh[att.key]--;
    att.lastCorrectAt = ev.tOnset;
    return { outcome, rtMs };
  }

  function onRight(ev) {
    if (s.phase === 'phrase') return phraseRight(ev);
    const key = s.att.key;
    const source = s.phase === 'find' ? 'intro' : 'flash';
    const { outcome, rtMs } = recordRight(ev, source);
    s.locked = true;
    if (s.kb) s.kb.setHint(null);
    drawCard({ key, color: 'var(--good)', fill: 'var(--good-soft)', label: true });
    const quick = outcome !== 'miss' && rtMs < core.T.quickMs;
    const pos = core.shortPos(key);
    s.fb.set('good', `Yes! ${core.displayLetter(key)}${pos ? ', ' + pos : ''}.`, quick ? 'quick!' : '');
    setInfo('');
    if (s.phase === 'drill') {
      s.run.answer({ firstTry: outcome !== 'miss' && !s.run.current().missed, outcome, rtMs });
      later(nextDrillCard, 650);
    } else {
      s.findPos++;
      later(nextFindCard, 650);
    }
  }

  function onWrong(ev) {
    const att = s.att;
    const target = s.target;
    const counted = core.countsAsWrong(att, ev);
    const played = NS.notation.spellMidi(core.nearestOctave(ev.midi, target.midi));
    s.refresh[att.key] = 2;
    if (att.labelAt == null) att.labelAt = performance.now(); // show it and retry
    if (counted) {
      att.wrong++;
      s.mistakes++;
      if (!att.playedKey) att.playedKey = played.key;
      if (s.phase === 'drill') s.run.miss();
    }
    const heardName = core.displayLetter(played.key);
    const dir = target.midi > fold(ev.midi) ? 'It’s further to the right.' : 'It’s further to the left.';
    if (s.phase === 'phrase') {
      s.phraseBad = true;
      drawPhrase();
      const rescue = s.phraseIdx > 0 && NS.shapes ? ' ' + NS.shapes.rescueText(s.phrase[s.phraseIdx - 1], s.phrase[s.phraseIdx], true) : '';
      s.fb.set('bad', `You played ${heardName}. Try again.`, `The note on the staff is ${target.letter}. ${dir}${rescue}`);
      if (att.wrong >= 2 && s.kb) s.kb.setHint(target.midi);
      return;
    }
    drawCard({ key: att.key, color: 'var(--bad)', fill: 'var(--bad-soft)', label: true });
    if (counted) {
      if (s.kb) s.kb.setHint(target.midi);
      setInfo(infoLine(att.key));
      s.fb.set('bad', `You played ${heardName}. Try again.`, `This one is ${target.letter}. ${dir} The green key shows where.`);
    } else {
      s.fb.set('bad', `You played ${heardName}. Try again.`, `This one is ${target.letter}.`);
    }
  }

  function onHear() {
    if (!s || !s.target) return;
    NS.audio.resume();
    if (s.att) s.att.heardNote = true;
    NS.audio.playTone(s.target.midi, 1.2);
  }
  function onHint() {
    if (!s || !s.target || !s.att) return;
    s.att.hinted = true;
    if (s.kb) s.kb.setHint(s.target.midi);
    s.fb.set('neutral', `It’s ${s.target.letter}`, 'The green key on the keyboard below shows where it is.');
  }

  // ======================================================================
  // NOTE DRILL (§3.3.1–3.3.3)
  // ======================================================================
  function startDrill({ focusKey, weak }) {
    s.variant = 'drill';
    const intro = introduced();
    if (!intro.length) {
      const unit = Cur().UNITS[Math.min(courseUnit(), Cur().UNITS.length - 1)];
      s.ctx.go('#/drill?meet=' + unit.notes.join(','));
      return;
    }
    let pool = intro.map(poolEntry);
    if (weak) pool = core.weakest(pool);
    if (focusKey && !pool.some((p) => p.key === focusKey)) focusKey = null;
    const rng = rngNow();
    const S = NS.store.state();
    const keys = pool.map((p) => p.key);
    const sub = weak ? Object.assign({}, S, { notes: Object.fromEntries(keys.map((k) => [k, S.notes && S.notes[k]]).filter((e) => e[1])) }) : S;
    const deck = core.buildDeck(pool, {
      focusKey, rng, size: core.T.deckSize,
      flashDeck: () => Cur().flashDeck(sub, { focusKey, size: core.T.deckSize, rng, now: Date.now() }),
    });
    s.before = Object.fromEntries(pool.map((p) => [p.key, { rt: p.rt }]));
    s.statesBefore = Object.fromEntries(pool.map((p) => [p.key, p.state]));
    s.run = core.createRun(deck);
    s.focusKey = focusKey;
    s.weak = weak;
    setHeader(focusKey ? `Note Drill · ${core.displayLetter(focusKey)}` : weak ? 'Note Drill · weakest notes' : 'Note Drill', 'Quick note drill');
    buildKeyboard(keys);
    s.phase = 'drill';
    s.fb.set('neutral', 'Play the blue note', 'One note at a time. No rush, there’s no timer.');
    nextDrillCard(true);
  }

  function nextDrillCard(first) {
    if (!s) return;
    if (s.run.done()) return finishDrill();
    const card = s.run.current();
    setCount(s.run.pos, s.run.cards.length);
    if (s.kb) s.kb.setHint(null);
    setInfo('');
    newAttempt(card.key);
    drawCard({ key: card.key, label: labelVisible() });
    showButtons({ hear: true, hint: true });
    if (!first) s.fb.set('neutral', promptText(), card.orig ? '' : 'This one again.');
  }

  function finishDrill() {
    s.phase = 'summary';
    s.target = null;
    setCount(s.run.cards.length, s.run.cards.length);
    const sum = core.summarize(s.run.cards, s.before);
    s.summary = sum;
    s.ctx.store.update((d) => Object.assign({}, d, { rounds: ((d && d.rounds) || 0) + 1, lastAt: Date.now() }));
    const promoted = s.run.cards.map((c) => c.key).filter((k, i, a) => a.indexOf(k) === i)
      .filter((k) => s.newlyKnown.includes(k) || (s.statesBefore[k] !== 'known' && NS.mastery.state(k) === 'known'));
    s.promoted = promoted;
    const box = s.ui.summary;
    box.innerHTML = '';
    const h = document.createElement('h2');
    h.textContent = `Note drill: ${sum.firstTry} of ${sum.total} first try`;
    box.appendChild(h);
    if (promoted.length) {
      const p = document.createElement('p');
      p.className = 'drill-celebrate';
      p.textContent = `New: you know ${core.listLetters(promoted.map((k) => core.nameFor(k, promoted)))} now!`;
      box.appendChild(p);
    }
    const ul = document.createElement('ul');
    ul.className = 'drill-rows';
    sum.rows.forEach((r) => {
      const li = document.createElement('li');
      li.textContent = core.rowText(r);
      if (r.firstTry === r.shown) li.classList.add('all');
      ul.appendChild(li);
    });
    box.appendChild(ul);
    const row = document.createElement('div');
    row.className = 'controls';
    row.append(button('Again', true, () => s.ctx.go(currentRoute())), button('Back home', false, () => s.ctx.go('#/')));
    box.appendChild(row);
    showSummary();
    NS.audio.cue('done');
    s.fb.set('good', 'Drill done!', `${sum.firstTry} of ${sum.total} right on the first try.`);
  }

  function currentRoute() {
    const c = NS.shell.current();
    return (c && c.route) || '#/drill';
  }
  function button(label, primary, fn) {
    const b = document.createElement('button');
    b.className = 'btn' + (primary ? ' primary' : '');
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  }
  function showSummary() {
    s.ui.staffCard.hidden = true;
    s.ui.actions.hidden = true;
    s.ui.kbWrap.hidden = true;
    s.ui.info.hidden = true;
    s.ui.summary.hidden = false;
    s.ui.progress.style.width = '100%';
    const first = s.ui.summary.querySelector('button.primary');
    if (first) first.focus();
  }

  // ======================================================================
  // MEET A NOTE (§3.2.8)
  // ======================================================================
  function startMeet(keys) {
    s.variant = 'meet';
    const UNIT_OF = Cur().UNIT_OF;
    const unit = courseUnit();
    keys = keys.filter((k) => k in UNIT_OF);
    // Only notes up to the next unit can be met; anything further on means "meet the next one first".
    if (!keys.length || keys.some((k) => UNIT_OF[k] > unit)) {
      const next = Cur().UNITS[Math.min(unit, Cur().UNITS.length - 1)];
      if (keys.length) NS.ui.toast(`Meet ${core.listLetters(next.notes.map(core.displayLetter))} first.`);
      s.ctx.go('#/drill?meet=' + next.notes.join(','));
      return;
    }
    s.meetKeys = keys;
    s.meetUnits = [...new Set(keys.map((k) => UNIT_OF[k]))].sort((a, b) => a - b);
    const letters = core.listLetters(keys.map((k) => core.displayLetter(k)));
    setHeader('Meet a note', `Meet ${letters}`);
    buildKeyboard([...new Set([...introduced(), ...keys])]);
    s.cardIdx = 0;
    showMeetCard();
  }

  function showMeetCard() {
    s.phase = 'card';
    const key = s.meetKeys[s.cardIdx];
    s.target = core.parseKey(key);
    s.att = null;
    setCount(0, 0);
    drawCard({ key, label: true });
    setInfo(infoLine(key));
    s.kb.setHint(s.target.midi);
    s.fb.set('neutral', `This is ${core.displayLetter(key)}`, 'Listen to it and find it on your keyboard. The green key shows where it is.');
    showButtons({ hear: true, next: true, nextLabel: s.cardIdx < s.meetKeys.length - 1 ? 'Next note' : 'Next' });
    s.ui.hear.textContent = 'Hear it';
  }

  function onNext() {
    if (!s) return;
    if (s.phase === 'card') {
      if (s.cardIdx < s.meetKeys.length - 1) { s.cardIdx++; showMeetCard(); return; }
      s.meetUnits.forEach((u) => NS.mastery.introduce(u));
      startFind();
    }
  }

  function startFind() {
    s.phase = 'find';
    s.ui.hear.textContent = 'Hear the note';
    // Only the new note(s), 3 times each, with the label showing.
    s.findSeq = [];
    for (let i = 0; i < 3; i++) s.meetKeys.forEach((k) => s.findSeq.push(k));
    s.findPos = 0;
    s.kb.setHint(null);
    nextFindCard();
  }
  function nextFindCard() {
    if (!s) return;
    if (s.findPos >= s.findSeq.length) return startPhrase();
    const key = s.findSeq[s.findPos];
    setCount(s.findPos, s.findSeq.length);
    if (s.kb) s.kb.setHint(null);
    setInfo('');
    newAttempt(key, { labelDelay: 0 });
    drawCard({ key, label: true });
    showButtons({ hear: true, hint: true });
    s.fb.set('neutral', `Find ${core.displayLetter(key)}`, `${s.findPos + 1} of ${s.findSeq.length}. Play it on your keyboard.`);
  }

  // A 12-note mixed phrase from the notes you know, under the normal label rules (Practice-style).
  function startPhrase(seedBump = 0) {
    s.phase = 'phrase';
    let pool = introduced();
    if (!pool.length) pool = s.meetKeys.slice();
    const seed = (Date.now() + seedBump) >>> 0;
    let notes = [];
    try {
      const tokens = Cur().genPhrase(pool, s.meetKeys, { len: 12, focusShare: 0.35, seed });
      notes = Not().parseMelody(tokens).notes;
    } catch (err) { console.error('[drill] phrase failed', err); }
    if (!notes.length) notes = s.meetKeys.map((k) => noteOf(k, 'q'));
    s.phrase = notes;
    s.phraseIdx = 0;
    s.phraseBad = false;
    s.ui.staffCard.classList.remove('single');
    showButtons({ hear: true, hint: true });
    setInfo('');
    s.fb.set('neutral', 'Now read a short tune', 'It mixes your new note with the ones you know. Play each blue note.');
    nextPhraseNote(true);
  }
  function nextPhraseNote(first) {
    if (s.phraseIdx >= s.phrase.length) return finishMeet();
    const n = s.phrase[s.phraseIdx];
    s.phraseBad = false;
    newAttempt(Not().noteKey(n));
    s.target = { key: Not().noteKey(n), letter: n.letter, midi: n.midi, staffPos: n.staffPos };
    if (s.kb) s.kb.setHint(null);
    setCount(s.phraseIdx, s.phrase.length);
    drawPhrase();
    if (!first) s.fb.set('neutral', promptText(), '');
  }
  function shapeFor(i) {
    if (i < 1 || i < s.phraseIdx || i > s.phraseIdx + 3) return null;
    const showIt = s.phraseBad && i === s.phraseIdx;
    const level = NS.mastery.shapeLevel(s.phrase[i - 1], s.phrase[i], { showIt, guard: false });
    return { level, emphasis: i === s.phraseIdx, rescue: showIt };
  }
  function drawPhrase(fade = false) {
    const cur = s.phraseIdx;
    const labelOn = (i) => i < cur || (i === cur && labelVisible()) || (i > cur && delayFor(Not().noteKey(s.phrase[i])) === 0);
    NS.staff.render(s.ui.staff, {
      notes: s.phrase, current: cur, paging: 'page',
      state: (i) => (i < cur ? 'done' : i === cur ? (s.phraseBad ? 'bad' : 'current') : 'upcoming'),
      label: (i) => (labelOn(i) ? s.phrase[i].letter : null),
      labelOpacity: (i) => (i < cur ? 0.6 : 0.8),
      labelFade: (i) => fade && i === cur,
      tint: (i) => {
        if (i <= cur) return null;
        const st = NS.mastery.state(Not().noteKey(s.phrase[i]));
        return st === 'new' || st === 'learning' ? st : null;
      },
      shapes: shapeFor,
      ariaLabel: ({ page, pages }) => `Music staff, part ${page + 1} of ${pages}. Current note is ${labelVisible() ? s.phrase[cur].letter : 'highlighted'}.`,
    });
  }
  function phraseRight(ev) {
    const i = s.phraseIdx;
    const sh = shapeFor(i);
    const { outcome } = recordRight(ev, 'intro');
    if (i > 0) NS.mastery.recordShape(s.phrase[i - 1], s.phrase[i], outcome, sh ? sh.level : 0);
    const n = s.phrase[i];
    s.phraseIdx++;
    const praise = ['Yes!', 'Nice!', 'Right!', 'Good!', 'Spot on!'][s.phraseIdx % 5];
    nextPhraseNote();
    if (s.phraseIdx < s.phrase.length) s.fb.set('good', `${praise} That was ${n.letter}.`, 'Now read the next blue note.');
  }

  function finishMeet() {
    s.phase = 'summary';
    s.target = null;
    setCount(s.phrase.length, s.phrase.length);
    const letters = core.listLetters(s.meetKeys.map(core.displayLetter));
    const top = Math.max(...s.meetUnits);
    const C = Cur();
    let song = null;
    songsAll().forEach((x) => {
      let lv;
      try { lv = C.songLevel(x); } catch { lv = Infinity; }
      if (lv !== top) return;
      const d = C.songDiff(x);
      if (!song || d < song.d) song = { song: x, d };
    });
    const box = s.ui.summary;
    box.innerHTML = '';
    const h = document.createElement('h2');
    h.textContent = `You’ve met ${letters}!`;
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = song ? `Next, read your first song with ${letters} in it.` : 'Read one more short tune to help it stick.';
    const row = document.createElement('div');
    row.className = 'controls';
    if (song) row.appendChild(button(`Read: ${song.song.title}`, true, () => s.ctx.go(`#/practice/${encodeURIComponent(song.song.id)}`)));
    else {
      row.appendChild(button('Read another short tune', true, () => {
        s.ui.summary.hidden = true;
        s.ui.staffCard.hidden = false;
        s.ui.actions.hidden = false;
        s.ui.kbWrap.hidden = false;
        startPhrase(7919);
      }));
    }
    row.appendChild(button('Back home', false, () => s.ctx.go('#/')));
    box.append(h, p, row);
    s.meetSong = song ? song.song.id : null;
    showSummary();
    NS.audio.cue('done');
    s.fb.set('good', `You’ve met ${letters}!`, '');
  }

  // ======================================================================
  // NOTE CHECK (§3.3.4)
  // ======================================================================
  function startCheck() {
    s.variant = 'check';
    let order = [];
    try { order = Cur().placementOrder(NS.store.state()) || []; } catch { order = []; }
    order = order.filter((k) => k in Cur().UNIT_OF);
    if (!order.length) order = core.ORDER.slice();
    s.check = core.createCheck(order);
    setHeader('Note check', 'Note check');
    buildKeyboard(order);
    s.phase = 'check';
    s.fb.set('neutral', 'Play each note you see', 'No names this time. If you don’t know one, tap “Not sure”. That’s fine, it just tells the app where to start.');
    nextCheckCard(true);
  }
  function startOneCheck(key) {
    s.variant = 'check';
    const p = core.parseKey(key);
    if (!p || !(p.key in Cur().UNIT_OF)) { s.ctx.go('#/notes'); return; }
    s.oneKey = p.key;
    const others = introduced().filter((k) => k !== p.key);
    s.oneCards = core.oneCheckCards(p.key, others, rngNow());
    s.onePos = 0;
    s.oneAnswers = [];
    setHeader('Note check', `Do you know ${core.displayLetter(p.key)}?`);
    buildKeyboard([p.key, ...others]);
    s.phase = 'one';
    s.fb.set('neutral', 'Play each note you see', `Read ${core.displayLetter(p.key)} 5 times, quickly and without its name, and it counts as known.`);
    nextCheckCard(true);
  }
  function checkKey() {
    return s.phase === 'one' ? (s.oneCards[s.onePos] && s.oneCards[s.onePos].key) : s.check.current();
  }
  function nextCheckCard(first) {
    if (!s) return;
    const key = checkKey();
    if (!key || (s.phase === 'check' && s.check.done())) return finishCheck();
    if (s.phase === 'one') setCount(s.onePos, s.oneCards.length); else setCount(s.check.pos, s.check.seq.length);
    newAttempt(key, { labelDelay: Infinity });
    drawCard({ key });
    setInfo('');
    if (s.kb) s.kb.setHint(null);
    showButtons({ skip: true });
    if (!first) s.fb.set('neutral', 'Play the blue note', '');
  }
  function judgeCheck(ev, ok) {
    const key = s.att.key;
    const rtMs = Math.max(0, Math.round(ev.tOnset - s.att.start));
    if (!ok && !core.countsAsWrong(s.att, ev)) {
      s.fb.set('neutral', 'I didn’t catch that clearly', 'Play it again.');
      return;
    }
    s.locked = true;
    if (ok) s.att.lastCorrectAt = ev.tOnset;
    checkAnswer(ok, rtMs, key);
  }
  function onSkip() {
    if (!s || s.locked || !s.att || (s.phase !== 'check' && s.phase !== 'one')) return;
    s.locked = true;
    checkAnswer(false, null, s.att.key);
  }
  function checkAnswer(read, rtMs, key) {
    const pos = core.shortPos(key);
    const where = `${core.displayLetter(key)}${pos ? ', ' + pos : ''}`;
    if (read) {
      drawCard({ key, color: 'var(--good)', fill: 'var(--good-soft)', label: true });
      s.fb.set('good', `Yes! ${where}.`, '');
    } else {
      drawCard({ key, color: 'var(--ink)', fill: 'var(--accent-soft)', label: true });
      s.fb.set('neutral', `That was ${where}.`, 'No problem. On to the next one.');
    }
    if (s.phase === 'one') {
      const card = s.oneCards[s.onePos];
      s.oneAnswers.push({ key, scored: card.scored, read, rtMs });
      s.onePos++;
      const failed = card.scored && !(read && rtMs < core.T.checkFastMs);
      later(failed ? finishCheck : nextCheckCard, read ? 650 : 1400);
    } else {
      s.check.answer(read, rtMs);
      later(nextCheckCard, read ? 650 : 1400);
    }
  }

  function finishCheck() {
    if (!s || s.phase === 'summary') return;
    const one = s.phase === 'one';
    s.phase = 'summary';
    s.target = null;
    const box = s.ui.summary;
    box.innerHTML = '';
    const h = document.createElement('h2');
    const p = document.createElement('p');
    p.className = 'muted';
    const row = document.createElement('div');
    row.className = 'controls';
    if (one) {
      const pass = core.onePasses(s.oneAnswers);
      const L = core.displayLetter(s.oneKey);
      if (pass) {
        s.results = [core.resultOf(s.oneKey, s.oneAnswers.filter((a) => a.scored).map((a) => ({ ok: a.read, rtMs: a.rtMs })))];
        NS.mastery.applyPlacement(s.results, { single: true });
        h.textContent = `You know ${L}!`;
        p.textContent = `${L} counts as known now, so its name will stay hidden.`;
        NS.audio.cue('done');
      } else {
        s.results = [];
        h.textContent = `Keep going with ${L}`;
        p.textContent = 'Not quite yet. A few more reads and it’ll stick.';
      }
      row.append(button('My notes', true, () => s.ctx.go('#/notes')), button('Back home', false, () => s.ctx.go('#/')));
      box.append(h, p, row);
    } else {
      s.results = s.check.results();
      NS.mastery.applyPlacement(s.results, { single: false });
      const known = s.results.filter((r) => r.verdict === 'known');
      h.textContent = 'Note check done';
      p.textContent = known.length
        ? `You can already read ${core.listLetters(known.map((r) => core.nameFor(r.key, known.map((x) => x.key))))}. The app will start you from there.`
        : 'Thanks! The app will start you from the first notes and build up from there.';
      const ul = document.createElement('ul');
      ul.className = 'drill-rows';
      const all = s.results.map((r) => r.key);
      s.results.forEach((r) => {
        const li = document.createElement('li');
        li.textContent = `${core.nameFor(r.key, all)} · ${r.verdict === 'known' ? 'known' : r.verdict === 'one' ? 'still learning' : 'not yet'}`;
        if (r.verdict === 'known') li.classList.add('all');
        ul.appendChild(li);
      });
      row.append(button('Back home', true, () => s.ctx.go('#/')), button('My notes', false, () => s.ctx.go('#/notes')));
      box.append(h, p);
      if (s.results.length) box.appendChild(ul);
      box.appendChild(row);
      NS.audio.cue('done');
    }
    showSummary();
    s.fb.set('good', h.textContent, '');
  }

  // ======================================================================
  // REGISTER
  // ======================================================================
  NS.modes.register({
    id: 'drill',
    title: 'Note Drill',
    blurb: 'Quick single notes',
    order: 4,
    needsSong: false,
    icon: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 8h20M2 12h20M2 16h20"/></g><ellipse cx="12" cy="12" rx="3.6" ry="2.6" transform="rotate(-20 12 12)" fill="currentColor"/></svg>',
    mount,
    unmount,
    songBadge: () => null,
    tileChip() {
      const n = introduced().filter((k) => NS.mastery.rusty(k)).length;
      return n ? `${n} to review` : null;
    },
    debugState() {
      if (!s) return null;
      return {
        variant: s.variant, phase: s.phase,
        target: s.target ? { key: s.target.key, midi: s.target.midi } : null,
        pos: s.phase === 'drill' || (s.phase === 'summary' && s.run) ? s.run.pos : s.phase === 'phrase' ? s.phraseIdx : s.phase === 'find' ? s.findPos : s.phase === 'one' ? s.onePos : s.check ? s.check.pos : 0,
        cards: s.run ? s.run.cards.map((c) => c.key) : s.check ? s.check.seq.slice() : s.findSeq ? s.findSeq.slice() : null,
        labelVisible: labelVisible(), mistakes: s.mistakes, summary: s.summary || null, results: s.results || null,
        newlyKnown: s.newlyKnown.slice(), meetSong: s.meetSong || null,
      };
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
