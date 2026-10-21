// Ear First mode (#/ear), inspired by the Suzuki method (spec §3.7). Listen, copy by ear phrase by
// phrase, play the whole tune from memory, then see it written and read it in Practice.
//
// Routes: #/ear (Hub) · #/ear/room (Listening Room) · #/ear/remix (Rhythm Remix R1/R2) · #/ear/concert
//         #/ear/:songId?step=listen|echo|whole|see|remix|review[&try=1][&brush=P]
// Pure rules live in modes/ear-core.js (NS.EarCore). State lives in NS.store.slice('ear') (§4.1).
// Ear never introduces notes and never marks them known: the only reading evidence it writes is
// Reveal B, with source 'ear' (weight 0, `seen` only).
(function (root) {
  const NS = root.NS;
  const EC = NS.EarCore;
  const U = NS.util;

  // ======================================================================
  // COPY (§3.7.13, exact strings)
  // ======================================================================
  const COPY = {
    'hub.title': 'Ear First',
    'hub.tile': 'Listen, copy, then see it written',
    'hub.sub': 'Learn tunes the way you learned to talk: listen a lot, copy what you hear, and only then see it written down.',
    'hub.footer': 'Inspired by the Suzuki method: listen every day, learn by ear, read later.',
    'hub.today': 'Today’s ten minutes',
    'hub.reps': 'Reps today: {today} · All time: {total}',
    'hub.hand': 'Hand shape check: thumb on {key}, curved fingers.',
    'listen.cta': 'Start listening',
    'listen.streak': 'Day {n} of listening',
    'listen.restDay': 'Rest day used. Your streak is safe.',
    'listen.comingNext': 'Get your ears ready',
    'listen.ready': 'You’ve heard {title} {n} times. Your ears are ready for it.',
    'listen.startAnyway': 'Start anyway',
    'know.ask': 'Do you know this tune already?',
    'know.yes': 'Yes, I know it',
    'know.no': 'Not yet',
    'know.diag': 'Great. Play it from memory once, and I’ll find the bits worth practising.',
    'hand.title': 'Hand position',
    'hand.text': 'Thumb on {key}, one finger per key.',
    'hand.move': 'Move your hand: thumb on {key}.',
    'echo.listen': 'Listen…',
    'echo.watch': 'Listen and watch the keys light up.',
    'echo.yourTurn': 'Your turn',
    'echo.startKey': 'Start on the green key.',
    'echo.anyOctave': 'Any octave is fine. Higher or lower counts.',
    'echo.praise': ['That’s it.', 'Exactly like that.', 'Spot on.', 'Your ears got that one.', 'Lovely and clean.'],
    'echo.bead': '{n} of {target}',
    'echo.oneMore': 'One more for luck',
    'echo.chunkDone': 'Phrase {k} is in your hands.',
    'echo.next': 'Next phrase',
    'echo.joinIntro': 'Now join them: phrase {a} flowing into phrase {b}.',
    'echo.memoryIntro': 'From memory now: phrase {a} to phrase {b}. I’ll give you the first two notes.',
    'echo.slip': 'Close. A note or two wandered.',
    'echo.selfFix': 'You found it yourself. That’s your ear working. Now one clean one.',
    'echo.selfFixGuided': 'You found it. Now one clean one.',
    'echo.lost': 'Lost the thread?',
    'echo.again': 'Hear it again',
    'echo.tryAgain': 'Try again',
    'echo.idle': 'Take your time. Tap Hear it again whenever you like.',
    'echo.blackKey': 'That was a black key. This tune lives on the white keys.',
    'echo.fewPhrases': 'Good news: this tune only has {u} different phrases.',
    'echo.repeatSkip': 'You already know this one. It comes back here.',
    'echo.shape': 'Same shape as phrase {k}, just starting on a different note.',
    'echo.variant': 'Starts like phrase {k}. Listen for the new ending.',
    'echo.groove': 'Nice, steady rhythm too.',
    'echo.knowIt': 'I know this already',
    'echo.lag': 'Read {title} first, so your reading keeps up with your ears.',
    'hint.again': 'Hear it again',
    'hint.slow': 'Slower',
    'hint.shape': 'Show the shape',
    'hint.firstKey': 'Show the first key',
    'hint.noteByNote': 'One note at a time',
    'hint.lights': 'Follow the lights',
    'hint.offer.slow': 'Want a hand? Try hearing it slower.',
    'hint.offer.shape': 'Tricky bit. Want to see which way the notes go?',
    'hint.offer.nbn': 'Let’s take it one note at a time.',
    'hint.offer.split': 'This one’s long. Want to split it in two?',
    'hint.afterGuided': 'Now without the lights. You’ve got this.',
    'whole.intro': 'The whole tune, from memory. I’ll play it once first.',
    'whole.skipCall': 'I know how it goes',
    'whole.prompt': 'Here’s how it goes on.',
    'whole.done': 'You can play {title} by ear. That’s a real skill.',
    'reveal.title': 'Now see it',
    'reveal.sub': 'This is what you’ve been playing. Every dot is a note your fingers already know.',
    'reveal.play': 'Play it while you watch the notes.',
    'reveal.spotPhrase': 'Which phrase did I just play? Tap it.',
    'reveal.spotNote': 'I’ll play one note from this phrase. Tap it on the staff.',
    'reveal.spotWrong': 'Not that one. Here it is.',
    'reveal.toRead': 'Read it in Practice',
    'practice.badge': 'You know this one by ear. Now let your eyes catch up.',
    'practice.cold': 'Read a new tune with these notes',
    'review.intro': 'Warm-up: an old friend.',
    'review.clean': 'Still there. That one’s yours for keeps.',
    'review.stay': 'Pretty good. We’ll play it again tomorrow.',
    'review.rusty': 'A little rusty, which is completely normal. Let’s brush up the tricky bit.',
    'review.skip': 'Not today',
    'remix.intro': 'Same note, new rhythm. Copy what you hear. Any key is fine.',
    'remix.good': 'Right in the pocket.',
    'remix.early': 'Almost. Note {k} came in a little early.',
    'remix.late': 'Almost. The gap before note {k} was a little long.',
    'remix.short': 'Almost. Wait a little longer on the long note.',
    'remix.unsteady': 'The notes are right. Now try keeping an even pulse.',
    'remix.tempo': 'That was very fast. Try it a bit more relaxed.',
    'noisy': 'It’s a bit noisy, so I’m hearing extra sounds. Try moving the phone closer to the keys.',
    'micOff': 'Turn on listening so I can hear you, or tap the keys on screen.',
    'unlock.next': 'New tune unlocked: {title}. It’s already in your Listening Room.',
    'milestone.reps': '{n} repetitions. This is exactly how hands learn.',
    'concert.intro': 'Your concert: every tune you know, back to back.',
    'welcomeBack': 'Welcome back. Here’s where we were.',
  };
  const HOW_IT_WORKS = 'Ear First is inspired by the Suzuki method: you learn a tune by listening and copying before you read it. It’s right hand only, because the microphone hears one note at a time. Suzuki piano uses both hands and is built around a teacher and a parent at home; this is a way to practise ear-first on your own, not the method itself. Note Steps isn’t connected to any Suzuki association. No pedal for now: let each note stop before the next.';
  const PEDAL_LINE = 'No pedal for now. Let each note stop before the next.';
  const PEDAL_TIP = 'Sounds like the pedal is down or the room is ringing. Try without the pedal.';
  const FOCUS_COPY = {
    steady: 'Focus: keep a steady pulse.', softly: 'Focus: play it softly.', octave: 'Focus: play it an octave higher.', plain: '',
  };
  const MILESTONES = [100, 250, 500, 1000, 2500, 5000];

  function t(key, vars) {
    let s = COPY[key];
    if (Array.isArray(s)) s = s[0];
    if (s == null) return key;
    return s.replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] != null ? String(vars[k]) : ''));
  }
  let praiseIdx = 0;
  const praise = () => COPY['echo.praise'][praiseIdx++ % COPY['echo.praise'].length];

  // ======================================================================
  // SMALL HELPERS
  // ======================================================================
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const k in props || {}) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'hidden') e.hidden = Boolean(v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    kids.flat(Infinity).forEach((c) => { if (c != null && c !== false) e.append(c.nodeType ? c : String(c)); });
    return e;
  }
  const btn = (label, cls, onclick, extra) => h('button', Object.assign({ class: 'btn ' + (cls || ''), type: 'button', onclick }, extra || {}), label);
  const svgEl = (tag, attrs, parent) => U.svgEl(tag, attrs, parent);
  const nowPerf = () => performance.now();
  const today = () => U.dayKey(Date.now());
  const pcOf = (m) => ((m % 12) + 12) % 12;
  const keyName = (key) => String(key || '').replace(/-?\d+$/, '').replace('#', '♯').replace(/^([A-G])b$/, '$1♭');
  const noteKey = (n) => EC.keyOf(n);

  // Collects every subscription, timer and sound a screen starts, so unmount can undo all of it.
  function makeScope() {
    const offs = [];
    const timers = new Set();
    const sounds = new Set();
    let alive = true;
    return {
      get alive() { return alive; },
      on(off) { if (typeof off === 'function') offs.push(off); return off; },
      timeout(fn, ms) {
        const id = setTimeout(() => { timers.delete(id); if (alive) fn(); }, ms);
        timers.add(id);
        return id;
      },
      interval(fn, ms) { const id = setInterval(() => { if (alive) fn(); }, ms); timers.add(id); return id; },
      clear(id) { if (id == null) return; clearTimeout(id); clearInterval(id); timers.delete(id); },
      sound(hd) {
        if (!hd) return hd;
        sounds.add(hd);
        if (hd.done && hd.done.then) hd.done.then(() => sounds.delete(hd));
        return hd;
      },
      stopSounds() { sounds.forEach((x) => { try { x.stop(); } catch {} }); sounds.clear(); },
      destroy() {
        alive = false;
        offs.splice(0).forEach((f) => { try { f(); } catch (err) { console.error('[ear] cleanup failed', err); } });
        timers.forEach((id) => { clearTimeout(id); clearInterval(id); });
        timers.clear();
        this.stopSounds();
      },
    };
  }

  // ---------- songs ----------
  function getSong(id) {
    if (!id) return null;
    const s = NS.songs && NS.songs.get ? NS.songs.get(id) : null;
    return s || (root.NoteSongs.songs.find((x) => x.id === id) || null);
  }
  const library = () => (NS.songs && NS.songs.all ? NS.songs.all() : root.NoteSongs.songs);
  const pathTunes = () => EC.pathTunes(getSong);
  const keysOf = (song) => song.keys || [...new Set(song.notes.map(noteKey))];

  // Notation items (with the rests between contiguous notes) for playSequence / render.
  function itemsFor(list) {
    const out = [];
    list.forEach((n, k) => {
      const prev = list[k - 1];
      if (prev && n.i != null && prev.i != null && n.i === prev.i + 1 && n.beat != null && prev.beat != null) {
        const gap = n.beat - (prev.beat + (prev.beats || 1));
        if (gap > 1e-6) out.push({ kind: 'rest', beats: gap, dur: 'q' });
      }
      out.push({ kind: 'note', midi: n.midi, beats: n.beats || 1, dur: n.dur || 'q', key: n.key });
    });
    return out;
  }
  function withIndex(song) {
    song.notes.forEach((n, k) => { if (n.i == null) n.i = k; });
    return song;
  }

  // ======================================================================
  // STORAGE (slices.ear, §4.1). get() is the live object; every write goes through write().
  // ======================================================================
  const slice = () => NS.store.slice('ear');
  function defaults() {
    return {
      settings: { startKey: 'auto', beadsPerStep: 'standard', tempoPct: 100, names: false, fingers: true },
      firstRunDone: false,
      listening: { streak: { count: 0, lastDay: null, restDays: [] }, days: {}, heard: {}, session: { startedAt: null, posAtStart: 0 } },
      remix: { r1: {}, r2: {}, skipped: false },
      tunes: {},
      today: { day: null, reps: 0, warmupDone: false, newBitDone: false },
      totals: { reps: 0, milestonesShown: [] },
    };
  }
  const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  function fillDeep(target, base) {
    for (const k in base) {
      if (target[k] === undefined || target[k] === null && base[k] !== null) target[k] = JSON.parse(JSON.stringify(base[k]));
      else if (isObj(base[k]) && isObj(target[k])) fillDeep(target[k], base[k]);
    }
    return target;
  }
  function fill(e) {
    fillDeep(e, defaults());
    const day = today();
    if (e.today.day !== day) e.today = { day, reps: 0, warmupDone: false, newBitDone: false, skipped: [] };
    if (!Array.isArray(e.today.skipped)) e.today.skipped = [];
    return e;
  }
  function read() {
    let e = slice().get();
    if (!isObj(e)) { slice().set(defaults()); e = slice().get(); }
    return fill(e);
  }
  function write(fn) {
    let out;
    slice().update((cur) => {
      const e = fill(isObj(cur) ? cur : defaults());
      out = fn(e);
      return e;
    });
    return out;
  }
  function freshTune() {
    return {
      stage: null, step: 0, planHash: null, known: null, diag: null, chunks: {}, whole: { beads: 0, attempts: 0 },
      phraseErr: [], seenAt: null, readAt: null, coldReadAt: null, polish: { level: 0, due: null, last: null, focusIdx: 0 },
      remix: {}, startedAt: null, byEarAt: null,
    };
  }
  function tuneRec(e, id) {
    if (!isObj(e.tunes[id])) e.tunes[id] = freshTune();
    return fillDeep(e.tunes[id], freshTune());
  }
  const peekTune = (id) => { const e = read(); return e.tunes[id] ? fillDeep(e.tunes[id], freshTune()) : freshTune(); };

  // Raises a tune's stage (never lowers it) and announces it on the bus.
  function raiseStage(id, stage) {
    if (EC.rank(stage) <= EC.rank(peekTune(id).stage)) return false;
    let changed = false;
    let unlockedNext = null;
    write((e) => {
      const tn = tuneRec(e, id);
      if (EC.rank(stage) > EC.rank(tn.stage)) {
        const before = EC.unlocks(e, NS.store.state(), getSong);
        tn.stage = stage;
        if (!tn.startedAt) tn.startedAt = Date.now();
        changed = true;
        const after = EC.unlocks(e, NS.store.state(), getSong);
        unlockedNext = pathTunes().find((s) => after[s.id] && after[s.id].listen && !(before[s.id] && before[s.id].listen)) || null;
      }
    });
    if (changed) {
      NS.bus.emit('ear:stage', { songId: id, stage });
      if (unlockedNext) NS.ui.toast(t('unlock.next', { title: unlockedNext.title }));
    }
    return changed;
  }

  function addReps(e, n) {
    e.today.reps += n;
    e.totals.reps += n;
    const hit = MILESTONES.filter((m) => e.totals.reps >= m && !e.totals.milestonesShown.includes(m));
    if (hit.length) {
      const m = hit[hit.length - 1];
      e.totals.milestonesShown.push(...hit);
      setTimeout(() => NS.ui.toast(t('milestone.reps', { n: NS.util.fmt(m) })), 900);
    }
  }

  // Listening counts: heard per tune, today's seconds and listens, the streak.
  function addListening({ secs = 0, counts = {} } = {}) {
    let restUsed = false;
    write((e) => {
      const L = e.listening;
      const d = today();
      L.days[d] = L.days[d] || { secs: 0, listens: 0 };
      L.days[d].secs = Math.round((L.days[d].secs + secs) * 10) / 10;
      for (const id in counts) {
        L.heard[id] = (L.heard[id] || 0) + counts[id];
        L.days[d].listens += counts[id];
      }
      restUsed = EC.updateStreak(L, d).restUsed;
    });
    if (restUsed) NS.ui.toast(t('listen.restDay'));
  }

  // ---------- stage helpers for the hub, the path list and badges ----------
  function currentTune(e, u) {
    const list = pathTunes();
    return list.find((s) => u[s.id] && u[s.id].listen && !EC.byEar(e.tunes[s.id])) ||
      list.find((s) => EC.byEar(e.tunes[s.id]) && !EC.isRead(e.tunes[s.id])) ||
      list.find((s) => u[s.id] && u[s.id].listen) || list[0] || null;
  }
  function stepForTune(song, e, u) {
    const tn = e.tunes[song.id] || freshTune();
    const un = u[song.id] || {};
    if (!un.listen) return { step: 'listen', label: 'Locked' };
    if (EC.isRead(tn)) return { step: 'see', label: 'Read ✓' };
    if (EC.byEar(tn)) return { step: 'see', label: tn.seenAt ? 'Read it in Practice' : t('reveal.title') };
    if (EC.rank(tn.stage) >= EC.rank('echo') && un.echo) {
      const plan = planFor(song, tn, e);
      const st = plan.steps[Math.min(tn.step || 0, plan.steps.length - 1)];
      return { step: st && st.type === 'whole' ? 'whole' : 'echo', label: st ? stepLabel(st) : 'Echo' };
    }
    return { step: 'listen', label: 'Listen' };
  }
  function planFor(song, tn, e) {
    const known = tn.known === true && tn.diag && Array.isArray(tn.diag.phraseErr);
    return EC.buildChunkPlan(withIndex(song), { known, phraseErr: known ? tn.diag.phraseErr : null, beads: e.settings.beadsPerStep });
  }
  function stepLabel(step) {
    const c = (step.chunk || []).map((x) => x + 1);
    if (step.type === 'whole') return 'Whole tune';
    if (step.type === 'remix') return 'Rhythm remix';
    if (step.join) return `Join ${c[0]} and ${c[1]}`;
    if (step.type === 'memory') return `From memory: ${c[0]} to ${c[c.length - 1]}`;
    if (step.part) return `Phrase ${c[0]}, part ${step.part}`;
    return `Phrase ${c[0]}`;
  }
  function tuneStatus(song, e, u) {
    const tn = e.tunes[song.id];
    const un = u[song.id] || {};
    const heard = e.listening.heard[song.id] || 0;
    const beads = tn ? Object.values(tn.chunks || {}).reduce((s, c) => s + (c.beads || 0) + (c.bonus || 0), 0) + ((tn.whole && tn.whole.beads) || 0) : 0;
    let text;
    if (!un.listen) text = 'Locked';
    else if (tn && EC.isRead(tn)) text = 'Read ✓';
    else if (tn && tn.seenAt) text = 'Seen';
    else if (tn && EC.byEar(tn)) text = 'By ear';
    else if (tn && EC.rank(tn.stage) >= EC.rank('echo')) {
      const plan = planFor(song, tn, e);
      const uniques = plan.repeats.filter((r) => r.repeatOf == null).length;
      const learned = plan.repeats.map((r, p) => p).filter((p) => r0(plan.repeats[p]) && phraseLearned(tn, p)).length;
      const st = plan.steps[Math.min(tn.step || 0, plan.steps.length - 1)];
      text = st && st.type === 'whole' ? 'Whole tune' : `Phrase ${Math.min(uniques, learned + 1)} of ${uniques}`;
    } else text = heard ? `Heard ${heard}×` : 'Listen first';
    return { text, beads };
  }
  const r0 = (r) => r.repeatOf == null;
  function phraseLearned(tn, p) {
    const c = tn.chunks && tn.chunks['p' + p];
    return Boolean(EC.byEar(tn) || (c && (c.done || (c.beads >= (c.target || 2)))));
  }

  // Reviews due today (§3.7.11): the most recent by-ear tune other than the current one, plus the most overdue.
  function dueReviews(e, cur) {
    const d = today();
    const cand = pathTunes().filter((s) => {
      const tn = e.tunes[s.id];
      return tn && EC.byEar(tn) && (!cur || s.id !== cur.id) && tn.polish && tn.polish.due && tn.polish.due <= d && !e.today.skipped.includes(s.id);
    });
    if (!cand.length) return [];
    const recent = cand.slice().sort((a, b) => (e.tunes[b.id].byEarAt || 0) - (e.tunes[a.id].byEarAt || 0))[0];
    const overdue = cand.slice().sort((a, b) => (e.tunes[a.id].polish.due < e.tunes[b.id].polish.due ? -1 : 1))[0];
    return [...new Set([recent, overdue])];
  }

  // ======================================================================
  // SHARED WIDGETS
  // ======================================================================
  // Bead counter (§3.7.8): an SVG 100% wide and 44 px tall; earned beads slide right and turn gold.
  function beadCounter(container) {
    const wrap = h('div', { class: 'ef-beads' });
    const svg = svgEl('svg', { viewBox: '0 0 300 44', role: 'img', preserveAspectRatio: 'xMidYMid meet' });
    const txt = h('span', { class: 'ef-beads-text' });
    wrap.append(svg, txt);
    container.appendChild(wrap);
    let slots = -1;
    let circles = [];
    const R = 11;
    function build(n) {
      svg.innerHTML = '';
      svgEl('line', { x1: 8, x2: 292, y1: 22, y2: 22, class: 'ef-rod' }, svg);
      circles = [];
      for (let k = 0; k < n; k++) circles.push(svgEl('circle', { r: R, cx: 0, cy: 0, class: 'ef-bead' }, svg));
      slots = n;
    }
    function set(n, target, bonus = 0) {
      const total = Math.max(target, 5) + bonus;
      if (total !== slots) build(total);
      const step = Math.min(26, 270 / Math.max(1, total));
      const earned = Math.min(n, target) + bonus;
      circles.forEach((c, k) => {
        const isEarned = k < earned;
        const x = isEarned ? 288 - R - (earned - 1 - k) * step : 12 + R + (k - earned) * step;
        c.style.transform = `translate(${x}px, 22px)`;
        c.classList.toggle('on', isEarned);
        c.classList.toggle('bonus', isEarned && k >= Math.min(n, target));
      });
      txt.textContent = t('echo.bead', { n: Math.min(n, target), target }) + (bonus ? ` · +${bonus}` : '');
      svg.setAttribute('aria-label', `${Math.min(n, target)} of ${target} clean repetitions`);
    }
    return { el: wrap, set };
  }

  // Note-dot row: equal height, width by beats, optional finger numbers; or a contour ("Show the shape").
  function dotRow(container) {
    const svg = svgEl('svg', { class: 'ef-dots', role: 'img', 'aria-label': 'The notes of this bit, as dots' });
    container.appendChild(svg);
    let notes = [];
    let states = [];
    let fingers = null;
    let contour = false;
    let els = [];
    function draw() {
      svg.innerHTML = '';
      els = [];
      const W = 320;
      const total = notes.reduce((s, n) => s + (n.beats || 1), 0) || 1;
      const unit = (W - 8) / total;
      const sp = notes.map((n) => n.staffPos);
      const hi = Math.max(...sp, 0);
      const lo = Math.min(...sp, 0);
      const H = contour ? (hi - lo) * 4 + 76 : 40;
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.classList.toggle('contour', contour);
      let x = 4;
      const centres = [];
      notes.forEach((n, k) => {
        const w = Math.max(6, (n.beats || 1) * unit - 4);
        const y = contour ? 20 + (hi - n.staffPos) * 4 : 8;
        const hgt = contour ? 14 : 24;
        const g = svgEl('g', { class: 'ef-dot ' + (states[k] || 'idle') }, svg);
        svgEl('rect', { x, y, width: w, height: hgt, rx: Math.min(hgt / 2, w / 2) }, g);
        if (fingers && fingers[k] != null && w >= 12) {
          const tx = svgEl('text', { x: x + w / 2, y: y + hgt / 2 + 4, 'text-anchor': 'middle', class: 'ef-finger' }, g);
          tx.textContent = String(fingers[k]);
        }
        centres.push({ x: x + w / 2, y: y + hgt / 2, x0: x, x1: x + w });
        els.push(g);
        x += (n.beats || 1) * unit;
      });
      if (contour) {
        for (let k = 1; k < notes.length; k++) {
          const a = centres[k - 1];
          const b = centres[k];
          if (notes[k].staffPos === notes[k - 1].staffPos) continue;
          svgEl('line', { x1: a.x1 - 2, y1: a.y, x2: b.x0 + 2, y2: b.y, class: 'ef-arrow', 'marker-end': '' }, svg);
          const sh = NS.shapes && NS.shapes.classify ? NS.shapes.classify(notes[k - 1], notes[k]) : null;
          if (sh && b.x0 - a.x1 > -40) {
            const tx = svgEl('text', { x: (a.x + b.x) / 2, y: Math.max(a.y, b.y) + 24, 'text-anchor': 'middle', class: 'ef-shape-word' }, svg);
            tx.textContent = sh.short;
          }
        }
      }
    }
    return {
      el: svg,
      set(list, { fingers: f = null } = {}) { notes = list.slice(); states = notes.map(() => 'idle'); fingers = f; draw(); },
      state(k, s) {
        if (k < 0 || k >= notes.length) return;
        states[k] = s;
        if (els[k]) els[k].setAttribute('class', 'ef-dot ' + s);
      },
      all(s) { states = notes.map(() => s); els.forEach((g) => g.setAttribute('class', 'ef-dot ' + s)); },
      upTo(i, s) { for (let k = 0; k < notes.length; k++) this.state(k, k < i ? s : states[k] === s ? 'idle' : states[k]); },
      shake(k) {
        if (!els[k]) return;
        const prev = states[k];
        els[k].setAttribute('class', 'ef-dot bad ef-shake');
        setTimeout(() => { if (els[k]) els[k].setAttribute('class', 'ef-dot ' + (states[k] === 'bad' ? 'idle' : prev === 'bad' ? 'idle' : states[k])); }, 300);
      },
      setContour(on) { contour = Boolean(on); draw(); },
      setFingers(f) { fingers = f; draw(); },
      get contour() { return contour; },
    };
  }

  // Phrase map strip: P1..Pn, "= 1" for repeats; grey / in this chunk (outline) / learned (green).
  function phraseMap(container, phrases, reps, { big = false, onTap } = {}) {
    const wrap = h('div', { class: 'ef-map' + (big ? ' big' : ''), role: onTap ? 'group' : 'list', 'aria-label': 'Phrases of the tune' });
    const pills = phrases.map((_, p) => {
      const label = reps[p] && reps[p].repeatOf != null ? `${p + 1} = ${reps[p].repeatOf + 1}` : `${p + 1}`;
      const el = onTap
        ? h('button', { class: 'ef-ph', type: 'button', onclick: () => onTap(p), 'aria-label': `Phrase ${p + 1}` }, label)
        : h('span', { class: 'ef-ph', role: 'listitem' }, label);
      wrap.appendChild(el);
      return el;
    });
    container.appendChild(wrap);
    return {
      el: wrap,
      set({ learned = () => false, inChunk = () => false, current = -1, pulse = -1 } = {}) {
        pills.forEach((el, p) => {
          el.classList.toggle('learned', Boolean(learned(p)));
          el.classList.toggle('in', Boolean(inChunk(p)));
          el.classList.toggle('cur', p === current);
          el.classList.toggle('pulse', p === pulse);
          const st = learned(p) ? 'learned' : inChunk(p) ? 'in this bit' : 'not yet';
          if (!onTap) el.setAttribute('aria-label', `Phrase ${p + 1}: ${st}`);
        });
        const c = pills[current >= 0 ? current : pulse];
        if (c && c.scrollIntoView && wrap.scrollWidth > wrap.clientWidth) {
          const left = c.offsetLeft - wrap.clientWidth / 2 + c.offsetWidth / 2;
          wrap.scrollLeft = Math.max(0, left);
        }
      },
      pill: (p) => pills[p],
    };
  }

  // Melody ribbon: dots with widths by beats, no staff.
  function ribbon(container, notes) {
    const svg = svgEl('svg', { class: 'ef-ribbon', role: 'img', 'aria-label': 'The tune as a row of dots' });
    container.appendChild(svg);
    let els = [];
    function draw(list) {
      svg.innerHTML = '';
      els = [];
      const total = list.reduce((s, n) => s + (n.beats || 1), 0) || 1;
      const W = 320;
      const unit = (W - 4) / total;
      const sp = list.map((n) => n.staffPos);
      const hi = Math.max(...sp, 0);
      const lo = Math.min(...sp, 0);
      const H = Math.max(36, (hi - lo) * 2 + 16);
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      let x = 2;
      list.forEach((n) => {
        const w = Math.max(3, (n.beats || 1) * unit - 2);
        const y = 6 + (hi - n.staffPos) * 2;
        els.push(svgEl('rect', { x, y, width: w, height: 4, rx: 2, class: 'ef-rb' }, svg));
        x += (n.beats || 1) * unit;
      });
    }
    draw(notes || []);
    return {
      el: svg,
      set: draw,
      light(i) { els.forEach((r, k) => r.classList.toggle('on', k === i)); els.forEach((r, k) => r.classList.toggle('past', k < i)); },
      clear() { els.forEach((r) => r.classList.remove('on', 'past')); },
    };
  }

  // Rhythm bars (Rhythm Remix): blocks with width by beats. `widths` in beats.
  function bars(container, label) {
    const row = h('div', { class: 'ef-bars-row' });
    const lab = h('span', { class: 'ef-bars-label' }, label);
    const track = h('div', { class: 'ef-bars' });
    row.append(lab, track);
    container.appendChild(row);
    return {
      el: row,
      set(widths, { worst = -1, states = [] } = {}) {
        track.innerHTML = '';
        const total = widths.reduce((s, w) => s + w, 0) || 1;
        widths.forEach((w, k) => {
          const b = h('span', { class: 'ef-bar' + (k === worst ? ' worst' : '') + (states[k] ? ' ' + states[k] : '') });
          b.style.flexGrow = String(w / total * 100);
          track.appendChild(b);
        });
      },
      state(k, s) { const b = track.children[k]; if (b) { b.classList.remove('listen', 'good', 'bad'); if (s) b.classList.add(s); } },
      clearStates() { [...track.children].forEach((b) => b.classList.remove('listen', 'good', 'bad')); },
    };
  }

  // A card with a mini keyboard and the thumb key marked (§3.7.4 hand-position card).
  function handCard(container, { thumbKey, fingersOn, onToggle, onDone, moveText }) {
    const card = h('section', { class: 'ef-card ef-hand', 'aria-label': t('hand.title') });
    card.appendChild(h('h3', null, t('hand.title')));
    card.appendChild(h('p', null, moveText || t('hand.text', { key: keyName(thumbKey) })));
    const kbEl = h('div', { class: 'keyboard ef-minikb', 'aria-hidden': 'true' });
    card.appendChild(kbEl);
    const thumbMidi = NS.notation.fromKey(thumbKey).midi;
    const K = NS.keyboard.create(kbEl, { low: Math.min(60, thumbMidi), high: Math.max(72, thumbMidi + 9), labels: 'none', emit: false, sound: false });
    K.setHint(thumbMidi);
    const fing = {};
    let m = thumbMidi;
    for (let f = 1; f <= 5; f++) {
      fing[m] = f;
      m++;
      while ([1, 3, 6, 8, 10].includes(pcOf(m))) m++;
    }
    K.setFingers(fing);
    const tog = h('label', { class: 'ef-toggle' });
    const cb = h('input', { type: 'checkbox' });
    cb.checked = fingersOn;
    cb.addEventListener('change', () => onToggle(cb.checked));
    tog.append(cb, ' Show finger numbers');
    card.appendChild(tog);
    card.appendChild(btn('Got it', 'primary', () => { K.destroy(); card.remove(); onDone(); }));
    container.appendChild(card);
    return { el: card, destroy() { K.destroy(); card.remove(); } };
  }

  function howItWorks() {
    NS.ui.sheet({ title: 'How this works', content: h('div', { class: 'ef-how' }, h('p', null, HOW_IT_WORKS)) });
  }

  // Pedal / ringing-room tip (§3.7.12): quiet never comes back for over 3 s after a note and the level
  // stays above twice its session median.
  function pedalWatch(S, sess) {
    let lastOnset = -Infinity;
    let quietSince = true;
    const levels = [];
    S.on(NS.bus.on('mic:onset', () => { lastOnset = nowPerf(); quietSince = false; }));
    S.on(NS.bus.on('mic:quiet', () => { quietSince = true; }));
    S.on(NS.bus.on('mic:level', ({ rms }) => {
      if (levels.length < 2000) levels.push(rms);
      if (sess.pedalShown || quietSince || levels.length < 80) return;
      const med = U.median(levels);
      if (nowPerf() - lastOnset > 3000 && rms > 2 * med && med > 0) {
        sess.pedalShown = true;
        NS.ui.toast(PEDAL_TIP, { ms: 6000 });
      }
    }));
  }

  // ======================================================================
  // HUB (#/ear)
  // ======================================================================
  function Hub(rootEl, ctx) {
    const S = makeScope();
    const f = NS.ui.frame(rootEl, { eyebrow: 'Ear First', title: 'Your tunes' });
    ctx.setTitle('Ear First');
    const body = f.body;

    function render() {
      body.innerHTML = '';
      const e = read();
      const u = EC.unlocks(e, NS.store.state(), getSong);
      const list = pathTunes();
      const cur = currentTune(e, u);
      const d = today();
      const streak = EC.streakNow(e.listening, d);

      body.appendChild(h('p', { class: 'muted ef-sub' }, t('hub.sub')));

      // first run: sound check, mic check, pedal line (started from a tap, so audio can play)
      if (!e.firstRunDone) {
        const card = h('section', { class: 'ef-card ef-first' },
          h('h3', null, 'Before you start'),
          h('p', null, 'A quick sound check, so you can hear the tunes clearly.'));
        card.appendChild(btn('Start the sound check', 'primary', async () => {
          NS.audio.resume();
          await NS.ui.soundCheck();
          if (!S.alive) return;
          if (NS.mic.isOn()) await NS.ui.micCheck();
          if (!S.alive) return;
          await NS.ui.dialog({ title: 'One more thing', body: PEDAL_LINE, actions: [{ label: 'OK', value: true, primary: true }] });
          write((x) => { x.firstRunDone = true; });
          if (S.alive) render();
        }));
        card.appendChild(btn('Skip', 'small', () => { write((x) => { x.firstRunDone = true; }); render(); }));
        body.appendChild(card);
      }

      // read celebrations (set on practice:finished from any route)
      const celebrate = list.find((s) => e.tunes[s.id] && e.tunes[s.id].readCelebrate);
      if (celebrate) {
        write((x) => { tuneRec(x, celebrate.id).readCelebrate = false; });
        NS.ui.dialog({
          title: `You read ${celebrate.title}`,
          body: 'You learned it by ear, saw it written, and now you’ve read it too.',
          actions: [{ label: 'Nice', value: true, primary: true }],
        });
      }

      // ---- Today's ten minutes ----
      const todayCard = h('section', { class: 'ef-card ef-today', 'aria-label': t('hub.today') });
      todayCard.appendChild(h('h3', null, t('hub.today')));
      const dayRec = e.listening.days[d] || { secs: 0, listens: 0 };
      const listenDone = dayRec.secs >= 120 || dayRec.listens >= 5;
      todayCard.appendChild(todayRow('Listen', `2 min${streak ? ' · ' + t('listen.streak', { n: streak }) : ''}`, listenDone,
        btn(t('listen.cta'), 'small' + (listenDone ? '' : ' primary'), () => ctx.go('#/ear/room'))));
      const due = dueReviews(e, cur);
      due.forEach((s) => {
        todayCard.appendChild(todayRow('Warm-up', s.title, false, btn('Warm up', 'small', () => ctx.go(`#/ear/${encodeURIComponent(s.id)}?step=review`))));
      });
      const r1 = u['remix-start'];
      if (r1.stage !== 'done') {
        const row = todayRow('New bit', 'Rhythm warm-up · Any key', false, btn('Start', 'small primary', () => ctx.go('#/ear/remix')));
        todayCard.appendChild(row);
        const skip = h('button', { class: 'ef-link', type: 'button', onclick: () => { write((x) => { x.remix.skipped = true; }); const tune1 = list[0]; if (tune1) NS.ui.toast(t('unlock.next', { title: tune1.title })); render(); } }, 'Skip warm-up');
        todayCard.appendChild(skip);
      } else if (cur) {
        const st = stepForTune(cur, e, u);
        const route = `#/ear/${encodeURIComponent(cur.id)}?step=${st.step}`;
        todayCard.appendChild(todayRow('New bit', `${cur.title} · ${st.label}`, Boolean(e.today.newBitDone), btn('Go', 'small primary', () => ctx.go(route))));
      }
      if (cur) {
        const fing = EC.fingering(withIndex(cur).notes, EC.phrasesFor(cur));
        todayCard.appendChild(h('p', { class: 'muted ef-hand-line' }, t('hub.hand', { key: keyName(fing.thumbKey) })));
      }
      body.appendChild(todayCard);

      // ---- path ----
      const pathHead = h('div', { class: 'level-head' }, h('h2', null, 'The path'), h('span', { class: 'muted' }, `${list.filter((s) => EC.byEar(e.tunes[s.id])).length} of ${list.length} by ear`));
      body.appendChild(pathHead);
      const ul = h('ul', { class: 'lessons ef-path' });
      ul.appendChild(remixRow(e, u));
      list.forEach((s) => ul.appendChild(tuneRow(s, e, u)));
      body.appendChild(ul);

      // ---- more ----
      const more = h('div', { class: 'ef-more' });
      more.appendChild(btn('Listening Room', '', () => ctx.go('#/ear/room')));
      more.appendChild(btn('Rhythm Remix', '', () => ctx.go('#/ear/remix')));
      const concert = EC.concertOpen(e);
      more.appendChild(btn('Concert', '', () => ctx.go('#/ear/concert'), concert ? {} : { disabled: true, 'aria-describedby': 'efConcertWhy' }));
      body.appendChild(more);
      if (!concert) body.appendChild(h('p', { class: 'muted ef-small', id: 'efConcertWhy' }, 'The concert opens when 3 tunes are polished.'));

      body.appendChild(h('p', { class: 'ef-reps' }, t('hub.reps', { today: NS.util.fmt(e.today.reps), total: NS.util.fmt(e.totals.reps) })));
      const foot = h('footer', { class: 'ef-foot' }, h('p', { class: 'muted' }, t('hub.footer')));
      const row = h('div', { class: 'ef-more' });
      row.appendChild(btn('How this works', 'small', howItWorks));
      row.appendChild(btn('Ear settings', 'small', settingsSheet));
      foot.appendChild(row);
      body.appendChild(foot);
    }

    function todayRow(label, text, done, button) {
      return h('div', { class: 'ef-trow' },
        h('span', { class: 'ef-sdot' + (done ? ' done' : ''), 'aria-hidden': 'true' }),
        h('div', { class: 'ef-tmeta' }, h('strong', null, label), h('span', { class: 'muted' }, text + (done ? ' · done' : ''))),
        button);
    }

    function chipRow(items) {
      const row = h('div', { class: 'ef-steps' });
      items.forEach(([label, enabled, fn]) => {
        const b = h('button', { class: 'btn chip ef-chip', type: 'button', onclick: fn }, label);
        if (!enabled) b.disabled = true;
        row.appendChild(b);
      });
      return row;
    }

    function remixRow(e, u) {
      const r = u['remix-start'];
      const done = r.stage === 'done';
      const li = h('li', { class: 'lesson ef-row' + (done ? ' done' : '') });
      li.appendChild(h('span', { class: 'num', 'aria-hidden': 'true' }, done ? '✓' : '♪'));
      const beads = Object.values(e.remix.r1 || {}).reduce((s, x) => s + x, 0);
      li.appendChild(h('div', { class: 'meta' }, h('strong', null, 'Rhythm warm-up'),
        h('span', { class: 'sub' }, done ? (e.remix.skipped && !EC.r1Done(e) ? 'Skipped' : `Done · ${beads} beads`) : 'Copy a rhythm on any key')));
      li.appendChild(h('div', { class: 'actions' }, btn(done ? 'Play again' : 'Start', 'small' + (done ? '' : ' primary'), () => ctx.go('#/ear/remix'))));
      return li;
    }

    function tuneRow(s, e, u) {
      const un = u[s.id];
      const tn = e.tunes[s.id] || freshTune();
      const st = tuneStatus(s, e, u);
      const li = h('li', { class: 'lesson ef-row' + (EC.isRead(tn) ? ' done' : '') + (un.listen ? '' : ' locked') });
      const num = h('span', { class: 'num' }, EC.isRead(tn) ? '✓' : String(un.n + 1));
      if (!un.listen) { num.innerHTML = LOCK_SVG; num.setAttribute('aria-label', 'Locked'); }
      li.appendChild(num);
      const meta = h('div', { class: 'meta' }, h('strong', null, s.title));
      meta.appendChild(h('span', { class: 'sub' }, h('span', { class: 'ef-pill' + (EC.byEar(tn) ? ' good' : '') }, st.text), st.beads ? ` · ${st.beads} beads` : ''));
      const nn = EC.newNotesIn(s.id, getSong);
      if (nn.length) {
        const states = nn.map((k) => {
          const ms = NS.mastery && NS.mastery.state ? NS.mastery.state(k) : null;
          const word = { locked: 'not met yet', new: 'new', learning: 'learning' }[ms];
          return keyName(k) + (word ? ` (${word})` : '');
        });
        meta.appendChild(h('span', { class: 'mode-line' }, 'New notes in this tune: ' + states.join(', ')));
      }
      if (tn.focusTicks) meta.appendChild(h('span', { class: 'mode-line' }, `Focus ticks: ${'✓'.repeat(Math.min(5, tn.focusTicks))}`));
      if (un.why === 'lag' && un.listen) meta.appendChild(h('span', { class: 'mode-line' }, t('echo.lag', { title: un.lagTitle })));
      li.appendChild(meta);
      const go = (step) => () => ctx.go(`#/ear/${encodeURIComponent(s.id)}?step=${step}`);
      const actions = h('div', { class: 'actions' });
      if (!un.listen) {
        actions.appendChild(btn('Try anyway', 'small', () => ctx.go(`#/ear/${encodeURIComponent(s.id)}?step=listen&try=1`)));
      } else {
        actions.appendChild(chipRow([
          ['Listen', true, go('listen')],
          ['Echo', un.echo, go('echo')],
          ['Whole', un.echo && EC.rank(tn.stage) >= EC.rank('whole'), go('whole')],
          ['See', un.see, go('see')],
          ['Read', un.read, () => ctx.go(`#/practice/${encodeURIComponent(s.id)}?from=ear`)],
          ['Remix', un.remix, go('remix')],
        ]));
        if (EC.isRead(tn) && !tn.coldReadAt) actions.appendChild(btn(t('practice.cold'), 'small primary', () => startColdRead(s, ctx)));
      }
      li.appendChild(actions);
      return li;
    }

    function settingsSheet() {
      const e = read();
      const box = h('div', { class: 'ef-settings' });
      const set = (k, v) => { write((x) => { x.settings[k] = v; }); };
      const row = (label, opts, value, key) => {
        box.appendChild(h('p', { class: 'ef-set-label' }, label));
        box.appendChild(NS.ui.seg(opts, value, (v) => set(key, v)));
      };
      row('Start key (the green key before you play)', [{ value: 'auto', label: 'Show' }, { value: 'never', label: 'Off' }], e.settings.startKey, 'startKey');
      row('Clean reps per step', [{ value: 'light', label: 'Fewer' }, { value: 'standard', label: 'Standard' }, { value: 'thorough', label: 'More' }], e.settings.beadsPerStep, 'beadsPerStep');
      row('Call tempo', [{ value: 80, label: '80%' }, { value: 100, label: '100%' }], e.settings.tempoPct, 'tempoPct');
      row('Key names on the keyboard', [{ value: false, label: 'Off' }, { value: true, label: 'On' }], e.settings.names, 'names');
      row('Finger numbers', [{ value: true, label: 'On' }, { value: false, label: 'Off' }], e.settings.fingers, 'fingers');
      NS.ui.sheet({ title: 'Ear settings', content: box });
    }

    S.on(NS.bus.on('store:changed', ({ section }) => { if (section === '*') render(); }));
    render();
    return {
      destroy() { S.destroy(); },
      debug: () => ({ screen: 'hub', unlocks: EC.unlocks(read(), NS.store.state(), getSong) }),
    };
  }
  const LOCK_SVG = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M4 7V5a4 4 0 1 1 8 0v2h.5A1.5 1.5 0 0 1 14 8.5v5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5v-5A1.5 1.5 0 0 1 3.5 7H4zm1.8 0h4.4V5a2.2 2.2 0 1 0-4.4 0v2z"/></svg>';

  // Cold read ★ (§3.7.10): a new tune with the same notes, never practised, every key introduced.
  function startColdRead(song, ctx) {
    const st = NS.store.state();
    const practised = (id) => Boolean(st.slices && st.slices.practice && st.slices.practice.songs && st.slices.practice.songs[id]);
    const introduced = new Set(NS.mastery && NS.mastery.introduced ? NS.mastery.introduced() : []);
    const pick = EC.pickColdRead(song, library(), {
      pathIds: EC.EAR_PATH,
      tunes: read().tunes,
      practised,
      introduced: (k) => introduced.has(k),
      known: (k) => NS.mastery && NS.mastery.state && NS.mastery.state(k) === 'known',
      comfort: (s) => (NS.curriculum && NS.curriculum.comfort ? NS.curriculum.comfort(s, st, Date.now()).label : 'right'),
    });
    let route;
    let target;
    if (pick) { target = pick.id; route = `#/practice/${encodeURIComponent(pick.id)}`; }
    else {
      const seed = 1 + (parseInt(U.hash(song.id), 16) % 997);
      target = 'run-' + seed;
      route = `#/practice/run?seed=${seed}`;
    }
    write((e) => { tuneRec(e, song.id).coldTarget = target; });
    ctx.go(route);
  }

  // ======================================================================
  // ATTEMPT ENGINE: a matcher plus the lost / prompter timer, shared by Echo, Whole, Review, Concert.
  // ======================================================================
  function attemptFor(S, exp, o) {
    const M = EC.makeMatcher(exp, {
      callEndPerf: o.callEndPerf != null ? o.callEndPerf : nowPerf(), attemptIdx: o.attemptIdx || 0, callBpm: o.callBpm || 90,
      sessionRms: o.sess.rms, tangleAt: o.tangleAt != null ? o.tangleAt : null, maxMerged: o.maxMerged != null ? o.maxMerged : 2,
    });
    let ended = false;
    let prompted = 0;
    const promptAt = [];
    const timer = S.interval(() => {
      if (ended) return;
      const tk = M.tick(nowPerf());
      if (!tk.fresh) return;
      if (o.whole) { prompted++; promptAt.push(M.i); if (o.onPrompt) o.onPrompt(M.i); }
      else if (o.onLost) o.onLost();
    }, 250);
    return {
      M,
      push(ev) {
        if (ended) return M.push(ev);
        const r = M.push(ev);
        if (r.kind === 'noisy') {
          const now = nowPerf();
          if (now - o.sess.noisyAt > 30000) { o.sess.noisyAt = now; if (o.onNoisy) o.onNoisy(); }
          return r;
        }
        if (['match', 'merged', 'swallowed'].includes(r.kind) && ev.rms != null) o.sess.rms.push(ev.rms);
        if (r.status !== 'playing') { ended = true; S.clear(timer); if (o.onEnd) o.onEnd(M.state(), { prompted, promptAt }); }
        return r;
      },
      stop() { ended = true; S.clear(timer); },
      get prompted() { return prompted; },
      promptAt,
      get ended() { return ended; },
    };
  }

  // Shared session info for one mounted screen (noise guard, one-off tips).
  const newSession = () => ({ rms: [], noisyAt: -Infinity, blackShown: false, octaveShown: false, pedalShown: false, lastInput: -Infinity });

  // ======================================================================
  // TUNE SCREENS (#/ear/:songId)
  // ======================================================================
  function TuneScreen(rootEl, ctx, song, query) {
    withIndex(song);
    const e = read();
    const u = EC.unlocks(e, NS.store.state(), getSong);
    const inPath = EC.EAR_PATH.includes(song.id);
    const un = u[song.id] || { listen: true, echo: true, see: true, read: true, remix: true, why: null };
    const tn = e.tunes[song.id] || freshTune();
    let step = query.get('step');
    const tryMode = query.get('try') === '1' || !inPath || !un.listen;
    if (!step) step = EC.byEar(tn) ? 'see' : EC.rank(tn.stage) >= EC.rank('echo') ? 'echo' : 'listen';
    if (!inPath && (step === 'listen' || !step)) step = 'echo';
    const echoAllowed = un.echo || tryMode;
    if ((step === 'echo' || step === 'whole') && !echoAllowed) step = 'listen';
    if (step === 'see' && !EC.byEar(tn) && !tryMode) step = un.echo ? 'echo' : 'listen';
    if (!tryMode && un.listen) raiseStage(song.id, 'listen');
    const opts = { tryMode, un, brush: query.has('brush') ? Number(query.get('brush')) : null };
    if (step === 'listen') return ListenScreen(rootEl, ctx, song, opts);
    if (step === 'see') return RevealScreen(rootEl, ctx, song, opts);
    if (step === 'remix') return RemixScreen(rootEl, ctx, { song, level: 'r3' });
    if (step === 'review') return ReviewScreen(rootEl, ctx, song, opts);
    return EchoScreen(rootEl, ctx, song, Object.assign(opts, { startWhole: step === 'whole' }));
  }

  // ---------- Listen (a tune's first stage: hear it, no staff) ----------
  function ListenScreen(rootEl, ctx, song, opts) {
    const S = makeScope();
    const f = NS.ui.frame(rootEl, { eyebrow: 'Ear First · Listen', title: song.title });
    ctx.setTitle(song.title);
    const card = h('section', { class: 'ef-card ef-now' });
    card.appendChild(h('p', { class: 'muted' }, song.origin || ''));
    const rb = ribbon(card, song.notes);
    const prog = h('div', { class: 'progress' }, h('div'));
    card.appendChild(prog);
    const heardLine = h('p', { class: 'ef-heard', 'aria-live': 'polite' });
    card.appendChild(heardLine);
    const playB = btn('▶ Play the tune', 'primary', toggle);
    card.appendChild(h('div', { class: 'controls' }, playB));
    f.body.appendChild(card);
    const next = h('div', { class: 'ef-card ef-next' });
    f.body.appendChild(next);
    f.body.appendChild(h('p', { class: 'muted ef-small' }, 'There’s no music to read yet. Just listen, and hum along if you like.'));
    f.body.appendChild(h('div', { class: 'ef-more' }, btn('Listening Room', 'small', () => ctx.go('#/ear/room')), btn('All tunes', 'small', () => ctx.go('#/ear'))));
    let hd = null;
    function renderNext() {
      const e = read();
      const n = e.listening.heard[song.id] || 0;
      heardLine.textContent = n >= 3 ? t('listen.ready', { title: song.title, n }) : n ? `Heard ${n}×. ${t('listen.comingNext')}.` : t('listen.comingNext') + '.';
      next.innerHTML = '';
      const un = EC.unlocks(e, NS.store.state(), getSong)[song.id] || opts.un;
      const echoOk = un.echo || opts.tryMode;
      if (!echoOk) {
        next.appendChild(h('p', null, un.why === 'lag' ? t('echo.lag', { title: un.lagTitle }) : `Learn ${un.prevTitle || 'the tune before'} by ear first. Keep listening to this one meanwhile.`));
        next.appendChild(btn('Try anyway', 'small', () => ctx.go(`#/ear/${encodeURIComponent(song.id)}?step=echo&try=1`)));
        return;
      }
      const ready = n >= 3;
      next.appendChild(h('p', null, ready ? 'Ready to copy it, phrase by phrase?' : 'Listen 3 times and your ears will be ready. Or start now.'));
      next.appendChild(btn(ready ? 'Start copying' : t('listen.startAnyway'), ready ? 'primary' : '', () => ctx.go(`#/ear/${encodeURIComponent(song.id)}?step=echo${opts.tryMode ? '&try=1' : ''}`)));
    }
    function toggle() {
      if (hd) { hd.stop(); return; }
      NS.audio.resume();
      const e = read();
      const bpm = song.bpm * (e.settings.tempoPct || 100) / 100;
      const started = Date.now();
      const total = song.notes.length;
      playB.textContent = '■ Stop';
      hd = S.sound(NS.audio.playSequence(itemsFor(song.notes), {
        bpm, voice: 'piano', id: 'ear-listen',
        onNote: (i) => { rb.light(i); prog.firstChild.style.width = (100 * (i + 1)) / total + '%'; },
      }));
      hd.done.then((reason) => {
        hd = null;
        if (!S.alive) return;
        playB.textContent = '▶ Play it again';
        rb.clear();
        prog.firstChild.style.width = '0';
        const secs = (Date.now() - started) / 1000;
        addListening({ secs, counts: reason === 'ended' ? { [song.id]: 1 } : {} });
        renderNext();
      });
    }
    renderNext();
    return { destroy() { S.destroy(); }, debug: () => ({ screen: 'listen', songId: song.id, playing: Boolean(hd) }) };
  }

  // ---------- Echo and Whole (§3.7.4, §3.7.5, §3.7.7, §3.7.8) ----------
  function EchoScreen(rootEl, ctx, song, opts) {
    const S = makeScope();
    const sess = newSession();
    const id = song.id;
    const notes = song.notes;
    const phrases = EC.phrasesFor(song);
    const reps = EC.findRepeats(phrases, notes);
    const fing = EC.fingering(notes, phrases);
    const uniques = reps.filter((r) => r.repeatOf == null).length;
    const phraseOf = (k) => phrases.findIndex(([a, b]) => k >= a && k < b);
    const tempChunks = {};

    let plan = null;
    let steps = [];
    let stepIdx = 0;
    let step = null;
    let exp = [];
    let phase = 'intro'; // intro | know | CALL | WAIT | PLAY | DONE | PAUSED | DIAG-CALL
    let pausedFrom = null;
    let att = null; // current attempt
    let callHd = null;
    let callEndPerf = -Infinity;
    let callBpm = 90;
    let lit = [];
    let hintKey = null;
    let flags = null; // per attempt: {startKey, lights, blocking, guided, test, bonus}
    const chunkSess = { slow: 1, suppress: 0, wrongByPhrase: {} };
    let hints = { shape: false, firstKey: false, nbn: false, lights: false };
    let diag = null; // {phase:'call'|'play', att}
    let returnTo = null; // after temporary split steps
    let idleTimer = null;

    // ---- layout ----
    const countChip = h('span', { class: 'count' });
    const f = NS.ui.frame(rootEl, { eyebrow: song.title, title: '', right: countChip });
    ctx.setTitle(song.title);
    const body = f.body;
    const top = h('div', { class: 'ef-top' });
    body.appendChild(top);
    const mapBox = h('div', { class: 'ef-mapbox' });
    body.appendChild(mapBox);
    const pmap = phraseMap(mapBox, phrases, reps, {});
    const callCard = h('section', { class: 'ef-card ef-call' });
    const stateLabel = h('p', { class: 'ef-state', 'aria-live': 'polite' }, '');
    const introLine = h('p', { class: 'ef-intro' });
    const tipLine = h('p', { class: 'muted ef-intro ef-tip' });
    callCard.append(stateLabel, introLine, tipLine);
    const dots = dotRow(callCard);
    const progressLine = h('p', { class: 'muted ef-small ef-progress', hidden: true });
    callCard.appendChild(progressLine);
    const startBtn = btn('▶ Listen', 'primary', () => {
      NS.audio.resume();
      if (diag && diag.phase === 'intro') diagCall();
      else startCall();
    });
    const callCtl = h('div', { class: 'controls' }, startBtn);
    callCard.appendChild(callCtl);
    body.appendChild(callCard);
    const fb = NS.ui.feedback(body);
    fb.el.classList.add('ef-fb');
    const offer = h('div', { class: 'ef-offer', hidden: true, role: 'status' });
    body.appendChild(offer);
    const beads = beadCounter(body);
    const doneRow = h('div', { class: 'controls ef-done', hidden: true });
    body.appendChild(doneRow);
    const micSlot = h('div');
    body.appendChild(micSlot);
    const micBar = NS.ui.micBar(micSlot);
    body.appendChild(h('p', { class: 'notice', 'data-mic-notice': '', hidden: true }));
    const againB = btn(t('echo.again'), '', () => hearAgain());
    const helpB = btn('Help', '', () => helpSheet());
    const knowB = btn(t('echo.knowIt'), '', () => knowIt());
    const skipCallB = btn(t('whole.skipCall'), '', () => skipCall(), { hidden: true });
    body.appendChild(h('div', { class: 'controls ef-buttons' }, againB, helpB, knowB, skipCallB));
    const kbWrap = h('div', { class: 'ef-kbwrap' });
    const kbEl = h('div', { class: 'keyboard', 'aria-label': 'On-screen keyboard. Tap a key to play it.' });
    kbWrap.appendChild(kbEl);
    kbWrap.appendChild(h('p', { class: 'muted ef-small' }, 'No piano nearby? Tap these keys instead.'));
    body.appendChild(kbWrap);

    const settings = () => read().settings;
    let range = NS.keyboard.rangeFor(notes, { width: rootEl.clientWidth || window.innerWidth });
    const K = NS.keyboard.create(kbEl, { low: range.low, high: range.high, labels: settings().names ? 'all' : 'none', tapDur: 0.4 });
    function setLit(arr, tone = 'call') { lit = arr ? arr.slice() : []; K.setLit(arr && arr.length ? arr : null, { tone }); }
    function setHint(m) { hintKey = m; K.setHint(m == null ? null : m); }

    // ---- plan and storage ----
    function loadPlan() {
      const e = read();
      const tn0 = e.tunes[id] || freshTune();
      const known = tn0.known === true && tn0.diag && Array.isArray(tn0.diag.phraseErr);
      plan = EC.buildChunkPlan(song, { known, phraseErr: known ? tn0.diag.phraseErr : null, beads: e.settings.beadsPerStep });
      if (tn0.planHash !== plan.hash) {
        write((x) => {
          const tn = tuneRec(x, id);
          const keepWhole = tn.whole;
          tn.chunks = EC.carryChunks(tn.chunks, plan);
          tn.whole = keepWhole;
          tn.planHash = plan.hash;
          tn.step = firstIncomplete(tn);
        });
      }
      steps = plan.steps.slice();
      if (opts.brush != null && phrases[opts.brush]) {
        const p = opts.brush;
        steps = [{ type: 'echo', chunk: [p], beads: 2, key: 'brush:p' + p, temp: true, idx: range0(phrases[p][0], phrases[p][1]), brush: true }];
      }
    }
    const range0 = (a, b) => { const r = []; for (let k = a; k < b; k++) r.push(k); return r; };
    function chunkOf(tn, st) {
      if (st.temp) {
        tempChunks[st.key] = tempChunks[st.key] || { beads: 0, bonus: 0, target: st.beads, attempts: 0, nonClean: 0, calls: 0, hints: 0 };
        return tempChunks[st.key];
      }
      if (st.type === 'whole') {
        tn.whole = Object.assign({ beads: 0, attempts: 0, bonus: 0, target: st.beads, calls: 0, nonClean: 0, hints: 0 }, tn.whole || {});
        if (tn.whole.target == null) tn.whole.target = st.beads;
        return tn.whole;
      }
      if (!tn.chunks[st.key]) tn.chunks[st.key] = { beads: 0, bonus: 0, target: st.beads, attempts: 0, nonClean: 0, hints: 0, calls: 0, cleanAt: null, sig: st.sig };
      return tn.chunks[st.key];
    }
    function peekChunk(st) {
      if (st.temp) return chunkOf(null, st);
      const tn = peekTune(id);
      if (st.type === 'whole') return Object.assign({ beads: 0, attempts: 0, bonus: 0, target: st.beads, calls: 0, nonClean: 0 }, tn.whole || {});
      return tn.chunks[st.key] || { beads: 0, bonus: 0, target: st.beads, attempts: 0, nonClean: 0, calls: 0 };
    }
    function updChunk(st, fn) {
      if (st.temp) return fn(chunkOf(null, st), null);
      return write((x) => { const tn = tuneRec(x, id); return fn(chunkOf(tn, st), tn, x); });
    }
    function stepDone(st, tn) {
      const c = st.temp ? chunkOf(null, st) : st.type === 'whole' ? Object.assign({ beads: 0, target: st.beads }, tn.whole || {}) : tn.chunks[st.key];
      if (!c) return false;
      if (st.type === 'recognise') return Boolean(c.done);
      return c.beads >= (c.target != null ? c.target : st.beads);
    }
    function firstIncomplete(tn) {
      const k = plan.steps.findIndex((st) => !stepDone(st, tn));
      return k < 0 ? plan.steps.length - 1 : k;
    }
    function learned(p) {
      const tn = peekTune(id);
      if (EC.byEar(tn)) return true;
      const r = reps[p];
      const own = r.repeatOf != null ? plan.steps.find((s) => s.type === 'recognise' && s.of === p) : plan.steps.find((s) => s.chunk && s.chunk.length === 1 && s.chunk[0] === p && s.type !== 'whole');
      return own ? stepDone(own, tn) : false;
    }

    // ---- rendering ----
    function renderStatic() {
      const c = peekChunk(step);
      const target = c.target != null ? c.target : step.beads;
      beads.set(c.beads || 0, target, c.bonus || 0);
      countChip.textContent = step.temp ? (step.brush ? 'Brush up' : 'Extra step') : `Step ${stepIdx + 1} of ${steps.length}`;
      f.setTitle(stepLabel(step));
      const whole = step.type === 'whole';
      mapBox.classList.toggle('big', whole);
      pmap.el.classList.toggle('big', whole);
      pmap.set({
        learned,
        inChunk: (p) => !whole && (step.type === 'memory' && !step.join ? p >= step.chunk[0] && p <= step.chunk[step.chunk.length - 1] : step.chunk.includes(p)),
        pulse: whole && att ? phraseOf(Math.min(att.M.i, notes.length - 1)) : -1,
      });
      dots.el.style.display = whole ? 'none' : '';
      progressLine.hidden = !whole;
      knowB.hidden = step.type === 'recognise' || whole;
    }
    function fingersFor(list) {
      if (!settings().fingers || !fing.fingers) return null;
      return list.map((n) => (n.i != null ? fing.fingers[n.i] : null));
    }
    function keyFingers(list) {
      const fl = fingersFor(list);
      if (!fl) { K.setFingers(null); return; }
      const map = {};
      list.forEach((n, k) => { if (fl[k] != null && map[n.midi] == null) map[n.midi] = fl[k]; });
      K.setFingers(map);
    }
    function setState(text, tip) {
      stateLabel.textContent = text;
      if (tip != null) tipLine.textContent = tip;
    }

    // ---- entering a step ----
    function enterStep(idx, { autoCall = false } = {}) {
      stopCall();
      S.clear(idleTimer);
      if (att) att.stop();
      att = null;
      stepIdx = Math.max(0, Math.min(idx, steps.length - 1));
      step = steps[stepIdx];
      exp = step.idx.map((k) => notes[k]);
      hints = { shape: false, firstKey: false, nbn: false, lights: false };
      chunkSess.slow = 1;
      chunkSess.suppress = 0;
      chunkSess.wrongByPhrase = {};
      offer.hidden = true;
      doneRow.hidden = true;
      if (!step.temp) write((x) => { const tn = tuneRec(x, id); tn.step = stepIdx; });
      if (step.type === 'whole' && !opts.tryMode) raiseStage(id, 'whole');
      dots.set(exp, { fingers: fingersFor(exp) });
      dots.setContour(false);
      keyFingers(exp);
      setLit(null);
      setHint(null);
      K.setPlaying(null);
      skipCallB.hidden = step.type !== 'whole';
      introLine.textContent = introFor(step);
      setState(t('echo.listen'), '');
      fb.set('neutral', '', '');
      phase = 'intro';
      startBtn.hidden = false;
      startBtn.textContent = step.type === 'whole' ? '▶ Hear it first' : '▶ Listen';
      renderStatic();
      // a moved hand position for this bit
      const mv = fing.moves.find((m) => step.chunk && step.chunk[0] === m.phrase && step.type !== 'whole');
      if (mv) fb.set('neutral', t('hand.move', { key: keyName(mv.thumbKey) }), '');
      if (stepDone(step, peekTune(id)) && !step.temp) showDone(false);
      else if (autoCall) startCall();
    }
    function introFor(st) {
      const c = (st.chunk || []).map((x) => x + 1);
      if (st.type === 'whole') return t('whole.intro');
      if (st.type === 'recognise') return t('echo.repeatSkip');
      if (st.type === 'memory') return t('echo.memoryIntro', { a: c[0], b: c[c.length - 1] });
      if (st.join) return t('echo.joinIntro', { a: c[0], b: c[1] });
      if (st.note === 'shape' && st.ref != null) return t('echo.shape', { k: st.ref + 1 });
      if (st.note === 'variant' && st.ref != null) return t('echo.variant', { k: st.ref + 1 });
      return '';
    }

    // ---- CALL ----
    function startCall({ full = false } = {}) {
      if (!step) return;
      stopCall();
      if (att) { att.stop(); att = null; }
      offer.hidden = true;
      const e = read();
      const c = peekChunk(step);
      const callsBefore = c.calls || 0;
      callBpm = EC.callBpmFor(exp, { bpm: song.bpm || 90, tempoPct: e.settings.tempoPct || 100, slow: chunkSess.slow });
      let list = exp;
      if (step.type === 'memory' && !full) list = exp.slice(0, 2);
      if (step.type === 'whole' && !full) list = exp;
      const lights = callsBefore === 0 ? 'all' : callsBefore === 1 ? 'first' : 'none';
      flags = { startKey: false, lights: lights !== 'none', blocking: false, guided: false, test: false, bonus: flags && flags.bonus };
      phase = 'CALL';
      startBtn.hidden = true;
      setState(t('echo.listen'), lights !== 'none' && step.type !== 'whole' ? t('echo.watch') : '');
      dots.all('idle');
      setHint(null);
      setLit(null);
      NS.audio.resume();
      callHd = S.sound(NS.audio.playSequence(itemsFor(list), {
        bpm: callBpm, voice: 'piano', id: 'ear-call',
        onNote: (i, note) => {
          if (phase !== 'CALL') return;
          dots.state(i, 'listen');
          if (i > 0) dots.state(i - 1, 'heard');
          if (step.type === 'whole') { progressLine.textContent = `Note ${i + 1} of ${list.length}`; pmap.set({ learned, pulse: phraseOf(exp[i] ? exp[i].i : 0) }); }
          if (lights === 'all' || (lights === 'first' && i === 0)) setLit([note.midi], 'call');
          else setLit(null);
        },
      }));
      updChunk(step, (ch) => { ch.calls = (ch.calls || 0) + 1; });
      const hd = callHd;
      callHd.done.then((reason) => {
        if (hd !== callHd) return;
        callHd = null;
        if (reason === 'ended' && phase === 'CALL' && S.alive) toWait(callsBefore, { fromCall: true });
      });
    }
    function stopCall() {
      if (callHd) { const hd = callHd; callHd = null; hd.stop(); }
      setLit(null);
    }
    function skipCall() {
      if (diag) { stopCall(); diagPlay(); return; }
      if (phase === 'CALL') stopCall();
      toWait(1);
    }

    // ---- WAIT / PLAY ----
    function toWait(callsBefore, { test = false, bonus = false, fromCall = false } = {}) {
      phase = 'WAIT';
      skipCallB.hidden = true;
      startBtn.hidden = true;
      callEndPerf = nowPerf();
      setLit(null);
      K.setPlaying(null);
      dots.all('idle');
      const e = read();
      const c = peekChunk(step);
      const attemptIdx = c.attempts || 0;
      flags = Object.assign(flags || {}, { startKey: false, blocking: false, guided: false, test, bonus });
      flags.lights = Boolean(fromCall && flags.lights);
      const small = [];
      if (e.settings.startKey !== 'never' && (attemptIdx === 0 || callsBefore === 1) && step.type !== 'whole') {
        setHint(exp[0].midi);
        flags.startKey = true;
        small.push(t('echo.startKey'));
      }
      if (hints.firstKey) { setHint(exp[0].midi); flags.startKey = true; }
      if (hints.lights) { setLit([exp[0].midi], 'guide'); flags.blocking = true; flags.guided = true; }
      if (hints.shape) flags.blocking = true;
      if (hints.nbn) flags.blocking = true;
      // focus hint for the 2nd and 3rd reps (never required)
      if ((c.beads === 1 || c.beads === 2) && step.type !== 'whole' && step.type !== 'recognise') {
        const tn = peekTune(id);
        const fc = FOCUS_COPY[EC.FOCUS[((tn.polish && tn.polish.focusIdx) || 0) + c.beads - 1 & 3]];
        if (fc) small.push(fc);
      }
      if (sess.afterGuided) { small.unshift(t('hint.afterGuided')); sess.afterGuided = false; }
      setState(t('echo.yourTurn'), small.join(' '));
      const whole = step.type === 'whole';
      att = attemptFor(S, exp, {
        sess, callEndPerf, attemptIdx, callBpm, whole,
        tangleAt: whole ? Math.max(8, Math.ceil(exp.length / 4)) : null,
        onLost: () => showLost(),
        onPrompt: (i) => prompter(i),
        onNoisy: () => fb.set('neutral', '', t('noisy')),
        onEnd: (st, extra) => judge(st, extra),
      });
      if (whole) progressLine.textContent = `Note 1 of ${exp.length}`;
      renderStatic();
      if (hints.nbn) nbnPlay(0);
      S.clear(idleTimer);
      idleTimer = S.timeout(() => { if (phase === 'WAIT') tipLine.textContent = t('echo.idle'); }, 10000);
    }
    // One note at a time (hint 5): the app plays the next note, you copy it.
    function nbnPlay(i) {
      if (!hints.nbn || !exp[i]) return;
      phase = 'CALL';
      const hd = S.sound(NS.audio.playSequence(itemsFor([exp[i]]), { bpm: 70, voice: 'piano', id: 'ear-nbn', onNote: () => dots.state(i, 'listen') }));
      hd.done.then(() => { if (S.alive && phase === 'CALL') { phase = att && att.M.i > 0 ? 'PLAY' : 'WAIT'; dots.state(i, 'idle'); } });
    }
    function showLost() {
      offer.innerHTML = '';
      offer.append(h('span', null, t('echo.lost') + ' '), btn(t('echo.again'), 'small', () => hearAgain()));
      offer.hidden = false;
    }
    function prompter(i) {
      const next = [exp[i], exp[i + 1]].filter(Boolean).map((n) => n.midi);
      setLit(next, 'guide');
      fb.set('neutral', t('whole.prompt'), '');
      const p = phraseOf(exp[i] ? exp[i].i : 0);
      if (p >= 0) chunkSess.wrongByPhrase[p] = (chunkSess.wrongByPhrase[p] || 0) + 1;
    }

    function onInput(ev) {
      sess.lastInput = nowPerf();
      if (diag && diag.phase === 'play') return diagInput(ev);
      if (phase === 'CALL' || phase === 'intro' || phase === 'PAUSED' || phase === 'know' || phase === 'DONE' || phase === 'JUDGE') {
        if (phase === 'DONE' && att) att.push(ev); // grace after success
        return;
      }
      if (!att) return;
      if (phase === 'WAIT') { phase = 'PLAY'; S.clear(idleTimer); tipLine.textContent = ''; }
      offer.hidden = true;
      K.setHeard(ev.midi);
      const r = att.push(ev);
      handleResult(r, ev);
    }
    function handleResult(r, ev) {
      if (!r) return;
      if (r.kind === 'match' || r.kind === 'merged' || r.kind === 'swallowed') {
        dots.upTo(r.i, 'good');
        if (step.type === 'whole') { progressLine.textContent = `Note ${Math.min(r.i + 1, exp.length)} of ${exp.length}`; renderStatic(); }
        if (Math.abs(r.octave || 0) >= 12 && !sess.octaveShown) { sess.octaveShown = true; fb.set('good', t('echo.anyOctave'), ''); }
        if (NS.mic.expect) NS.mic.expect({ repeat: Boolean(r.nextRepeat) });
        if (r.i >= 1 && hintKey != null) setHint(null);
        if (lit.length) setLit(hints.lights && exp[r.i] ? [exp[r.i].midi] : null, 'guide');
        if (hints.nbn && r.status === 'playing') S.timeout(() => nbnPlay(r.i), 250);
      } else if (r.kind === 'wrong') {
        dots.shake(r.i);
        const p = phraseOf(exp[r.i] ? exp[r.i].i : 0);
        if (p >= 0) chunkSess.wrongByPhrase[p] = (chunkSess.wrongByPhrase[p] || 0) + 1;
        if (r.black && !sess.blackShown) { sess.blackShown = true; fb.set('neutral', t('echo.blackKey'), ''); }
      }
    }

    // ---- JUDGE ----
    function judge(st, extra) {
      phase = 'JUDGE';
      setLit(null);
      setHint(null);
      const whole = step.type === 'whole';
      const success = st.status === 'success';
      const allowed = whole ? Math.floor(exp.length / 20) : 0;
      const prompted = extra.prompted > 0;
      const clean = success && st.wrong <= allowed && !flags.blocking && !prompted;
      let groove = null;
      if (clean && exp.length >= 3) {
        groove = EC.judgeRhythm(exp.map((n) => n.beats || 1), st.onsets, { callBpm });
      }
      const wasDone = stepDone(step, peekTune(id));
      let nowDone = false;
      updChunk(step, (c, tn, x) => {
        c.attempts = (c.attempts || 0) + 1;
        if (c.attempts === 1 && !clean && step.type !== 'recognise' && !flags.test) c.target = Math.max(c.target || step.beads, step.beads + 1);
        if (!clean) c.nonClean = (c.nonClean || 0) + 1;
        if (clean) {
          if (flags.test) c.beads = Math.max(c.beads || 0, c.target || step.beads);
          else if ((c.beads || 0) < (c.target || step.beads)) c.beads = (c.beads || 0) + 1;
          else c.bonus = (c.bonus || 0) + 1;
          c.cleanAt = Date.now();
          if (x) addReps(x, 1);
        }
        if (step.type === 'recognise') c.done = true;
        if (whole && tn) {
          tn.phraseErr = phrases.map((_, p) => (tn.phraseErr[p] || 0));
          st.wrongAt.forEach((k) => { const p = phraseOf(exp[Math.min(k, exp.length - 1)].i); if (p >= 0) tn.phraseErr[p] += 1; });
          extra.promptAt.forEach((k) => { const p = phraseOf(exp[Math.min(k, exp.length - 1)].i); if (p >= 0) tn.phraseErr[p] += 1; });
        }
        nowDone = step.type === 'recognise' ? true : c.beads >= (c.target || step.beads);
        if (x && nowDone && !wasDone) x.today.newBitDone = true;
      });
      if (clean && step.temp) write((x) => addReps(x, 1));
      if (clean) NS.audio.cue('bead');
      if (flags.guided) sess.afterGuided = true;
      hints = { shape: false, firstKey: false, nbn: false, lights: false };
      if (dots.contour) dots.setContour(false);
      renderStatic();

      // feedback
      if (clean) {
        let small = '';
        if (groove && groove.status === 'ok' && groove.pass) small = t('echo.groove');
        fb.set('good', praise(), small);
      } else if (success && st.selfFixed) {
        fb.set('good', (flags.startKey || flags.lights) ? t('echo.selfFixGuided') : t('echo.selfFix'), '');
      } else if (success) {
        fb.set('neutral', t('echo.slip'), prompted ? t('whole.prompt') : '');
      } else {
        fb.set('bad', t('echo.slip'), '');
        offer.innerHTML = '';
        offer.append(btn(t('echo.again'), 'small', () => hearAgain()), btn(t('echo.tryAgain'), 'small primary', () => tryAgain()));
        offer.hidden = false;
      }
      if (flags.blocking || hints.lights) chunkSess.suppress = 2;
      else if (chunkSess.suppress > 0) chunkSess.suppress--;

      if (step.type === 'recognise' || (nowDone && !wasDone) || (flags.test && clean)) {
        if (whole) return wholeDone();
        if (step.type !== 'recognise') {
          const c = step.chunk.map((x) => x + 1);
          NS.ui.toast(t('echo.chunkDone', { k: c.length > 1 ? `${c[0]} to ${c[c.length - 1]}` : c[0] }));
        }
        return showDone(true);
      }
      if (nowDone && wasDone) return showDone(false); // a bonus bead
      if (!clean) maybeOffer();
      // next attempt: your turn again (no automatic replay), after the success grace
      S.timeout(() => { if (phase === 'JUDGE') toWait(2); }, success ? 650 : 400);
    }

    function maybeOffer() {
      if (chunkSess.suppress > 0) return;
      const c = peekChunk(step);
      const n = c.nonClean || 0;
      let text = null;
      let actions = [];
      if (n === 2) { text = t('hint.offer.slow'); actions = [[t('hint.slow'), () => applyHint('slow')]]; }
      else if (n === 4) { text = t('hint.offer.shape'); actions = [[t('hint.shape'), () => applyHint('shape')], [t('hint.firstKey'), () => applyHint('firstKey')]]; }
      else if (n === 6) { text = t('hint.offer.nbn'); actions = [[t('hint.noteByNote'), () => applyHint('nbn')]]; }
      else if (n === 8 && canSplit()) { text = t('hint.offer.split'); actions = [['Split it', () => applyHint('split')]]; }
      if (!text) return;
      S.timeout(() => {
        offer.innerHTML = '';
        offer.append(h('span', null, text + ' '), ...actions.map(([l, fn]) => btn(l, 'small', fn)), btn('No thanks', 'small', () => { offer.hidden = true; }));
        offer.hidden = false;
      }, 700);
    }

    function canSplit() {
      if (step.temp) return false;
      if (step.join || step.type === 'memory') return true;
      return step.type === 'echo' && exp.length > 5;
    }

    function applyHint(kind) {
      offer.hidden = true;
      if (kind === 'again') return hearAgain();
      if (kind === 'slow') { chunkSess.slow = 0.75; return startCall({ full: true }); }
      if (kind === 'shape') {
        hints.shape = !dots.contour;
        dots.setContour(hints.shape);
        if (flags && hints.shape) flags.blocking = true;
        chunkSess.suppress = 2;
        return;
      }
      if (kind === 'firstKey') { hints.firstKey = true; setHint(exp[0].midi); if (flags) flags.startKey = true; return; }
      if (kind === 'nbn') { hints.nbn = true; chunkSess.suppress = 2; return toWait(2); }
      if (kind === 'lights') {
        hints.lights = true;
        chunkSess.suppress = 2;
        if (flags) { flags.blocking = true; flags.guided = true; }
        const i = att ? att.M.i : 0;
        if (exp[i]) setLit([exp[i].midi], 'guide');
        if (phase !== 'WAIT' && phase !== 'PLAY') toWait(2);
        return;
      }
      if (kind === 'split') return split();
    }

    // Split (hint 8): a join or memory chunk goes back to its shakiest member phrase; a single phrase
    // over 5 notes splits at its middle bar line into two temporary sub-chunks.
    function split() {
      const base = step;
      let extra = [];
      if (base.join || base.type === 'memory') {
        const members = base.type === 'memory' && !base.join ? range0(base.chunk[0], base.chunk[base.chunk.length - 1] + 1) : base.chunk;
        let worst = members[members.length - 1];
        let most = -1;
        members.forEach((p) => { const w = chunkSess.wrongByPhrase[p] || 0; if (w > most) { most = w; worst = p; } });
        extra = [{ type: 'echo', chunk: [worst], beads: 2, key: `tmp:p${worst}`, temp: true, idx: range0(phrases[worst][0], phrases[worst][1]) }];
      } else {
        const [a, b] = phrases[base.chunk[0]];
        const mid = (notes[a].beat + notes[b - 1].beat + (notes[b - 1].beats || 1)) / 2;
        const bpb = song.beatsPerBar || 4;
        let k = -1;
        for (let j = a + 2; j <= b - 2; j++) {
          const r = (((notes[j].beat - (song.pickup || 0)) % bpb) + bpb) % bpb;
          if (r < 1e-6 && (k < 0 || Math.abs(notes[j].beat - mid) < Math.abs(notes[k].beat - mid))) k = j;
        }
        if (k < 0) k = a + Math.floor((b - a) / 2);
        const p = base.chunk[0];
        extra = [
          { type: 'echo', chunk: [p], part: 1, beads: 2, key: `tmp:p${p}a`, temp: true, idx: range0(a, k) },
          { type: 'echo', chunk: [p], part: 2, beads: 2, key: `tmp:p${p}b`, temp: true, idx: range0(k, b) },
        ];
      }
      returnTo = returnTo || { key: base.key };
      steps.splice(stepIdx, 0, ...extra);
      enterStep(stepIdx, { autoCall: true });
    }

    function hearAgain() {
      offer.hidden = true;
      doneRow.hidden = true;
      if (att) { att.stop(); att = null; }
      NS.audio.resume();
      startCall({ full: true });
    }
    function tryAgain() {
      offer.hidden = true;
      if (att) { att.stop(); att = null; }
      toWait(2);
    }
    function knowIt() {
      if (!step || step.type === 'whole' || step.type === 'recognise') return;
      stopCall();
      if (att) { att.stop(); att = null; }
      fb.set('neutral', 'One go from memory. A clean one fills this step.', '');
      flags = { lights: false };
      toWait(2, { test: true });
    }

    function showDone(fresh) {
      phase = 'DONE';
      skipCallB.hidden = true;
      offer.hidden = true;
      doneRow.innerHTML = '';
      const last = stepIdx >= steps.length - 1;
      const nextLabel = step.type === 'recognise' || (steps[stepIdx + 1] && steps[stepIdx + 1].type === 'whole') ? 'Next' : t('echo.next');
      if (!last) doneRow.appendChild(btn(nextLabel, 'primary', () => nextStep()));
      if (step.type !== 'recognise') doneRow.appendChild(btn(t('echo.oneMore'), '', () => { doneRow.hidden = true; flags = { lights: false }; toWait(2, { bonus: true }); }));
      doneRow.appendChild(btn('All tunes', '', () => ctx.go('#/ear')));
      doneRow.hidden = false;
      startBtn.hidden = true;
      setState(step.type === 'recognise' ? 'Done' : 'Learned', '');
      if (fresh && !last) {
        // auto-advance after 1500 ms only if nothing was played in the last 1200 ms (P0)
        const t0 = nowPerf();
        const check = () => {
          if (phase !== 'DONE') return;
          const now = nowPerf();
          if (now - t0 >= 1500 && now - sess.lastInput >= 1200) nextStep();
          else if (now - t0 < 8000) S.timeout(check, 200);
        };
        S.timeout(check, 1500);
      }
      if (step.brush && fresh) {
        doneRow.innerHTML = '';
        doneRow.appendChild(btn('Back to your tunes', 'primary', () => ctx.go('#/ear')));
      }
    }
    function nextStep() {
      if (phase !== 'DONE' && phase !== 'intro' && phase !== 'JUDGE') return;
      if (returnTo && steps[stepIdx].temp) {
        const nextIdx = stepIdx + 1;
        if (steps[nextIdx] && steps[nextIdx].temp) return enterStep(nextIdx, { autoCall: true });
        // back to the step that was split
        steps = steps.filter((s) => !s.temp);
        const back = steps.findIndex((s) => s.key === returnTo.key);
        returnTo = null;
        return enterStep(back < 0 ? 0 : back, { autoCall: true });
      }
      if (stepIdx + 1 < steps.length) enterStep(stepIdx + 1, { autoCall: true });
    }

    function wholeDone() {
      phase = 'DONE';
      const already = EC.byEar(peekTune(id));
      if (!opts.tryMode && !already) {
        write((x) => {
          const tn = tuneRec(x, id);
          tn.byEarAt = Date.now();
          tn.polish = Object.assign({ level: 0, last: null, focusIdx: 0 }, tn.polish || {}, { due: U.addDays(today(), 1) });
        });
        raiseStage(id, 'see');
        write((x) => { x.today.newBitDone = true; });
      }
      const tn = peekTune(id);
      const total = Object.values(tn.chunks || {}).reduce((s, c) => s + (c.beads || 0) + (c.bonus || 0), 0) + ((tn.whole && tn.whole.beads) || 0);
      const bodyEl = h('div', { class: 'ef-celebrate' });
      const m = phraseMap(bodyEl, phrases, reps, {});
      m.set({ learned: () => true });
      bodyEl.appendChild(h('p', { class: 'muted' }, `${total} clean repetitions on this tune.`));
      showDone(false);
      NS.ui.dialog({
        title: t('whole.done', { title: song.title }),
        body: bodyEl,
        actions: [{ label: 'All tunes', value: 'hub' }, { label: t('reveal.title'), value: 'see', primary: true }],
      }).then((v) => {
        if (!S.alive) return;
        if (v === 'see') ctx.go(`#/ear/${encodeURIComponent(id)}?step=see${opts.tryMode ? '&try=1' : ''}`);
        else if (v === 'hub') ctx.go('#/ear');
      });
    }

    // ---- hint sheet ----
    function helpSheet() {
      const box = h('div', { class: 'ef-help' });
      let sheet = null;
      const item = (label, kind, enabled = true) => {
        const b = btn(label, '', () => { if (sheet) sheet.close(); applyHint(kind); });
        if (!enabled) b.disabled = true;
        box.appendChild(b);
      };
      item(t('hint.again'), 'again');
      item(t('hint.slow'), 'slow');
      item(dots.contour ? 'Hide the shape' : t('hint.shape'), 'shape', step.type !== 'whole');
      item(t('hint.firstKey'), 'firstKey');
      item(t('hint.noteByNote'), 'nbn', step.type !== 'whole');
      item(t('hint.lights'), 'lights');
      if (canSplit()) item('Split it in two', 'split');
      box.appendChild(h('p', { class: 'muted ef-small' }, 'Hearing it again is always free. The other helps are fine to use; that go just won’t count as a clean one.'));
      sheet = NS.ui.sheet({ title: 'Help', content: box });
      updChunk(step, (c) => { c.hints = (c.hints || 0) + 1; });
    }

    // ---- "Do you know this tune?" and the diagnostic (§3.7.7) ----
    function askKnow(then) {
      phase = 'know';
      const card = h('section', { class: 'ef-card ef-know' }, h('h3', null, t('know.ask')));
      const row = h('div', { class: 'controls' });
      row.appendChild(btn(t('know.yes'), 'primary', () => { card.remove(); startDiag(); }));
      row.appendChild(btn(t('know.no'), '', () => { card.remove(); write((x) => { tuneRec(x, id).known = false; }); then(); }));
      card.appendChild(row);
      top.appendChild(card);
      callCard.hidden = true;
    }
    function startDiag() {
      callCard.hidden = false;
      exp = notes.slice();
      step = { type: 'whole', chunk: [], idx: range0(0, notes.length), beads: 2, key: 'whole', diag: true };
      dots.el.style.display = 'none';
      progressLine.hidden = false;
      mapBox.classList.add('big');
      pmap.el.classList.add('big');
      f.setTitle('Play it from memory');
      countChip.textContent = 'Check';
      introLine.textContent = t('know.diag');
      setState(t('echo.listen'), '');
      skipCallB.hidden = false;
      startBtn.hidden = false;
      startBtn.textContent = '▶ Hear it first';
      diag = { phase: 'intro' };
    }
    function diagCall() {
      diag.phase = 'call';
      startBtn.hidden = true;
      const e = read();
      callBpm = EC.callBpmFor(notes, { bpm: song.bpm || 90, tempoPct: e.settings.tempoPct || 100 });
      callHd = S.sound(NS.audio.playSequence(itemsFor(notes), {
        bpm: callBpm, voice: 'piano', id: 'ear-diag',
        onNote: (i) => { progressLine.textContent = `Note ${i + 1} of ${notes.length}`; pmap.set({ pulse: phraseOf(i) }); },
      }));
      const hd = callHd;
      hd.done.then((r) => { if (hd === callHd) callHd = null; if (r === 'ended' && diag && diag.phase === 'call' && S.alive) diagPlay(); });
    }
    function diagPlay() {
      diag.phase = 'play';
      startBtn.hidden = true;
      skipCallB.hidden = true;
      callEndPerf = nowPerf();
      setState(t('echo.yourTurn'), '');
      const stopB = btn('I’m stuck', 'small', () => diagEnd(null));
      offer.innerHTML = '';
      offer.append(stopB);
      offer.hidden = false;
      diag.att = attemptFor(S, notes, {
        sess, callEndPerf, attemptIdx: 0, callBpm, whole: true, tangleAt: Math.max(8, Math.ceil(notes.length / 4)),
        onPrompt: (i) => { setLit([notes[i], notes[i + 1]].filter(Boolean).map((n) => n.midi), 'guide'); fb.set('neutral', t('whole.prompt'), ''); },
        onEnd: (st, extra) => diagEnd(st, extra),
      });
    }
    function diagInput(ev) {
      K.setHeard(ev.midi);
      const r = diag.att.push(ev);
      if (r && ['match', 'merged', 'swallowed'].includes(r.kind)) {
        setLit(null);
        progressLine.textContent = `Note ${Math.min(r.i + 1, notes.length)} of ${notes.length}`;
        pmap.set({ pulse: phraseOf(Math.min(r.i, notes.length - 1)) });
        if (NS.mic.expect) NS.mic.expect({ repeat: Boolean(r.nextRepeat) });
      }
    }
    function diagEnd(st, extra) {
      if (!diag) return;
      const a = diag.att;
      if (a) a.stop();
      const s = st || (a ? a.M.state() : { i: 0, wrongAt: [], status: 'quit', wrong: 0 });
      const ex = extra || { promptAt: a ? a.promptAt : [] };
      offer.hidden = true;
      setLit(null);
      const err = phrases.map(() => 0);
      (s.wrongAt || []).forEach((k) => { const p = phraseOf(Math.min(k, notes.length - 1)); if (p >= 0) err[p] = 1; });
      (ex.promptAt || []).forEach((k) => { const p = phraseOf(Math.min(k, notes.length - 1)); if (p >= 0) err[p] = 1; });
      if (s.status !== 'success') for (let p = Math.max(0, phraseOf(Math.min(s.i, notes.length - 1))); p < phrases.length; p++) err[p] = 1;
      const clean = s.status === 'success' && err.every((x) => x === 0);
      diag = null;
      write((x) => {
        const tn = tuneRec(x, id);
        tn.known = true;
        tn.diag = { phraseErr: err, clean, at: Date.now() };
        if (clean) { tn.whole = Object.assign({ beads: 0, attempts: 0 }, tn.whole || {}); tn.whole.beads = Math.max(tn.whole.beads || 0, 1); tn.whole.attempts = (tn.whole.attempts || 0) + 1; addReps(x, 1); }
      });
      if (clean) NS.audio.cue('bead');
      loadPlan();
      const tn = peekTune(id);
      const wholeIdx = steps.findIndex((x) => x.type === 'whole');
      if (clean) {
        write((x) => { tuneRec(x, id).step = wholeIdx; });
        enterStep(wholeIdx);
        fb.set('good', 'You know it already!', 'One more clean play from memory and it’s yours.');
      } else {
        enterStep(firstIncomplete(tn));
        fb.set('neutral', 'Thanks. I found the bits worth practising.', '');
      }
    }

    // ---- pause / resume ----
    function pause() {
      if (!['CALL', 'WAIT', 'PLAY'].includes(phase) && !(diag && diag.phase !== 'intro')) return;
      pausedFrom = phase;
      stopCall();
      S.stopSounds();
      NS.audio.stopAll();
      if (att) { att.stop(); att = null; }
      if (diag) { if (diag.att) diag.att.stop(); diag = null; }
      setLit(null);
      phase = 'PAUSED';
      offer.innerHTML = '';
      offer.append(h('span', null, t('welcomeBack') + ' '), btn('Carry on', 'small primary', () => { offer.hidden = true; resume(); }));
      offer.hidden = false;
    }
    function resume() {
      phase = 'intro';
      if (step && step.diag) { startDiag(); return; }
      enterStep(stepIdx, { autoCall: pausedFrom === 'CALL' });
      if (pausedFrom !== 'CALL') toWait(2);
    }

    // ---- wiring ----
    S.on(NS.input.on(onInput));
    S.on(NS.bus.on('visibility', ({ hidden }) => { if (hidden) pause(); }));
    S.on(NS.bus.on('mic:state', ({ on }) => {
      if (!on && (phase === 'CALL' || phase === 'PLAY' || phase === 'WAIT')) { pause(); fb.set('neutral', t('micOff'), ''); }
    }));
    S.on(NS.bus.on('resize', () => {
      const r = NS.keyboard.rangeFor(notes, { width: rootEl.clientWidth || window.innerWidth });
      if (r.low !== range.low || r.high !== range.high) { range = r; K.setRange(r.low, r.high); keyFingers(exp); }
    }));
    S.on(NS.bus.on('store:changed', ({ section }) => {
      if (section !== 'ear') return;
      const names = settings().names;
      K.setLabels(names ? 'all' : 'none');
    }));
    S.on(() => K.destroy());
    S.on(() => micBar.destroy());
    S.on(() => { if (NS.mic.expect) NS.mic.expect({ repeat: false }); });
    pedalWatch(S, sess);

    // ---- start ----
    loadPlan();
    const first = peekTune(id);
    if (!first.startedAt || EC.rank(first.stage) < EC.rank('echo')) {
      if (!opts.tryMode) raiseStage(id, 'echo');
      write((x) => { const tn = tuneRec(x, id); if (!tn.startedAt) tn.startedAt = Date.now(); });
    }
    let idx0 = opts.brush != null ? 0 : firstIncomplete(peekTune(id));
    if (opts.startWhole) idx0 = steps.findIndex((s) => s.type === 'whole');
    enterStep(idx0);
    const preface = [];
    if (!first.handShown && opts.brush == null) {
      preface.push((next) => {
        phase = 'know';
        callCard.hidden = true;
        handCard(top, {
          thumbKey: fing.thumbKey,
          fingersOn: settings().fingers,
          onToggle: (on) => { write((x) => { x.settings.fingers = on; }); dots.setFingers(fingersFor(exp)); keyFingers(exp); },
          onDone: () => { write((x) => { tuneRec(x, id).handShown = true; }); callCard.hidden = false; next(); },
        });
      });
    }
    if (first.known == null && !opts.startWhole && opts.brush == null) preface.push((next) => askKnow(next));
    (function runPreface(k) {
      if (k >= preface.length) {
        callCard.hidden = false;
        if (phase === 'know') phase = 'intro';
        if (diag) return;
        enterStep(stepIdx);
        if (uniques <= 4 && !peekTune(id).fewShown && opts.brush == null) {
          fb.set('neutral', t('echo.fewPhrases', { u: uniques }), '');
          write((x) => { tuneRec(x, id).fewShown = true; });
        }
        return;
      }
      preface[k](() => runPreface(k + 1));
    })(0);

    return {
      destroy() { if (att) att.stop(); S.destroy(); },
      debug: () => {
        const c = step ? peekChunk(step) : {};
        return {
          screen: step && step.type === 'whole' ? 'whole' : 'echo', songId: id, phase, step: stepIdx, steps: steps.length,
          key: step && step.key, type: step && step.type, label: step && stepLabel(step),
          i: att ? att.M.i : diag && diag.att ? diag.att.M.i : 0, n: exp.length,
          expected: exp.map((n) => n.midi), beats: exp.map((n) => n.beats || 1), bpm: callBpm, beads: c.beads || 0, target: c.target != null ? c.target : step && step.beads,
          calls: c.calls || 0, lit: lit.slice(), startKey: hintKey, wrong: att ? att.M.state().wrong : 0,
          diag: diag ? diag.phase : null, plan: steps.map((s) => s.key),
        };
      },
    };
  }

  // ---------- Now see it (Reveal, §3.7.4) ----------
  function RevealScreen(rootEl, ctx, song, opts) {
    const S = makeScope();
    const id = song.id;
    const notes = song.notes;
    const phrases = EC.phrasesFor(song);
    const reps = EC.findRepeats(phrases, notes);
    const f = NS.ui.frame(rootEl, { eyebrow: song.title, title: t('reveal.title') });
    ctx.setTitle(song.title);
    f.body.appendChild(h('p', { class: 'muted' }, t('reveal.sub')));
    const pmap = phraseMap(f.body, phrases, reps, { onTap: (p) => onPhraseTap(p) });
    const card = h('section', { class: 'staff-card ef-staff' });
    const pageNote = h('div', { class: 'page-note' });
    const svg = svgEl('svg', { role: 'img', 'aria-label': 'Music staff' });
    card.append(svg, pageNote);
    const pager = h('div', { class: 'ef-pager' });
    const prevB = btn('‹ Back', 'small', () => { pageIdx = Math.max(0, pageIdx - 1); draw(); }, { 'aria-label': 'Previous part' });
    const nextB = btn('Next ›', 'small', () => { pageIdx = Math.min(pages.length - 1, pageIdx + 1); draw(); }, { 'aria-label': 'Next part' });
    pager.append(prevB, nextB);
    f.body.append(card, pager);
    const fb = NS.ui.feedback(f.body);
    const stepsBox = h('section', { class: 'ef-card ef-reveal-steps' });
    f.body.appendChild(stepsBox);
    const micSlot = h('div');
    f.body.appendChild(micSlot);
    const micBar = NS.ui.micBar(micSlot);
    f.body.appendChild(h('p', { class: 'notice', 'data-mic-notice': '', hidden: true }));
    const kbEl = h('div', { class: 'keyboard', 'aria-label': 'On-screen keyboard. Tap a key to play it.' });
    const range = NS.keyboard.rangeFor(notes, { width: rootEl.clientWidth || window.innerWidth });
    f.body.appendChild(kbEl);
    const K = NS.keyboard.create(kbEl, { low: range.low, high: range.high, labels: read().settings.names ? 'all' : 'none' });
    S.on(() => K.destroy());
    S.on(() => micBar.destroy());

    // pages: by phrase, at most perPage notes each (longer phrases split across pages)
    const per = () => NS.staff.perPage((card.clientWidth || 360) - 8);
    let pages = [];
    function buildPages() {
      pages = [];
      const n = per();
      phrases.forEach(([a, b], p) => {
        const len = b - a;
        const parts = Math.ceil(len / n);
        const size = Math.ceil(len / parts);
        for (let k = a; k < b; k += size) pages.push({ phrase: p, from: k, to: Math.min(b, k + size) });
      });
    }
    buildPages();
    let pageIdx = 0;
    let revealUpTo = -1;
    let mode = 'A'; // A ink in, B play while you watch, C spot it, done
    let cursor = -1;
    let badAt = -1;
    let pulseNote = -1;
    let labelShownFor = -1;
    let labelTimer = null;
    let spot = null; // {round, phrase, note}
    let inkHd = null;
    const pageOfNote = (i) => Math.max(0, pages.findIndex((pg) => i >= pg.from && i < pg.to));
    const settingsLabels = () => (NS.store.settings ? NS.store.settings().labels : 'auto');

    function draw() {
      const pg = pages[Math.min(pageIdx, pages.length - 1)];
      if (!pg) return;
      const labels = settingsLabels();
      NS.staff.render(svg, {
        notes, range: [pg.from, pg.to], current: mode === 'B' ? cursor : pulseNote,
        state: (i) => (i === badAt ? 'bad' : mode === 'B' ? (i < cursor ? 'done' : i === cursor ? 'current' : 'upcoming') : i === pulseNote ? 'current' : 'upcoming'),
        revealUpTo: mode === 'A' ? revealUpTo : undefined,
        label: (i) => {
          if (labels === 'never') return null;
          if (labels === 'always') return true;
          if (mode === 'B') return i < cursor || (i === cursor && labelShownFor === cursor) ? true : null;
          return null;
        },
        brackets: [{ from: phrases[pg.phrase][0], to: phrases[pg.phrase][1], label: String(pg.phrase + 1), color: 'var(--accent)' }],
        onTapBracket: () => onPhraseTap(pg.phrase),
        onTapNote: mode === 'C' && spot && spot.round > 0 ? (i) => onNoteTap(i) : undefined,
        shapes: NS.mastery && NS.mastery.shapeLevel ? (i) => (i > 0 ? { level: NS.mastery.shapeLevel(notes[i - 1], notes[i], { showIt: false, guard: false }) } : null) : undefined,
        beatsPerBar: song.beatsPerBar || 4, pickup: song.pickup || 0,
        ariaLabel: `Music staff, phrase ${pg.phrase + 1}, part ${pageIdx + 1} of ${pages.length}.`,
      });
      pageNote.textContent = `Phrase ${pg.phrase + 1} · part ${pageIdx + 1} of ${pages.length}`;
      prevB.disabled = pageIdx === 0 || mode === 'B';
      nextB.disabled = pageIdx >= pages.length - 1 || mode === 'B';
      pmap.set({ learned: () => true, current: pg.phrase });
    }

    function renderSteps() {
      stepsBox.innerHTML = '';
      const tn = peekTune(id);
      const row = (label, state, text, buttons) => h('div', { class: 'ef-trow' },
        h('span', { class: 'ef-sdot' + (state === 'done' ? ' done' : state === 'now' ? ' now' : ''), 'aria-hidden': 'true' }),
        h('div', { class: 'ef-tmeta' }, h('strong', null, label), h('span', { class: 'muted' }, text)), ...(buttons || []));
      const aDone = mode !== 'A' || Boolean(tn.seenAt);
      stepsBox.appendChild(row('A. Ink it in', mode === 'A' ? 'now' : 'done', 'Watch the notes appear as the tune plays.',
        mode === 'A' ? [btn(inkHd ? '■ Stop' : '▶ Play', 'small primary', () => inkIn())] : []));
      stepsBox.appendChild(row('B. Play while you watch', mode === 'B' ? 'now' : aDone && mode !== 'A' && mode !== 'B' ? 'done' : '', t('reveal.play'),
        mode === 'B' ? [btn('Skip', 'small', () => startC())] : mode === 'A' ? [] : []));
      stepsBox.appendChild(row('C. Spot it', mode === 'C' ? 'now' : mode === 'done' ? 'done' : '', 'Three quick taps, no playing needed.',
        mode === 'C' ? [btn('Skip', 'small', () => finish())] : []));
      if (mode === 'done' || tn.seenAt) {
        const cta = btn(t('reveal.toRead'), 'primary', () => ctx.go(`#/practice/${encodeURIComponent(id)}?from=ear`));
        stepsBox.appendChild(h('div', { class: 'controls' }, cta, btn('Rhythm remix', 'small', () => ctx.go(`#/ear/${encodeURIComponent(id)}?step=remix`)), btn('All tunes', 'small', () => ctx.go('#/ear'))));
      }
    }

    // A. Ink in (required): revealUpTo grows on each note of the playback.
    function inkIn() {
      if (inkHd) { inkHd.stop(); return; }
      NS.audio.resume();
      revealUpTo = -1;
      pageIdx = 0;
      draw();
      fb.set('neutral', 'Listen and watch.', '');
      const e = read();
      inkHd = S.sound(NS.audio.playSequence(itemsFor(notes), {
        bpm: song.bpm * (e.settings.tempoPct || 100) / 100, voice: 'piano', id: 'ear-ink',
        onNote: (i) => { revealUpTo = i; const p = pageOfNote(i); pageIdx = p; draw(); },
      }));
      renderSteps();
      inkHd.done.then((r) => {
        inkHd = null;
        if (!S.alive) return;
        if (r === 'ended') {
          revealUpTo = notes.length - 1;
          if (!opts.tryMode) {
            write((x) => { const tn = tuneRec(x, id); if (!tn.seenAt) tn.seenAt = Date.now(); });
          }
          startB();
        } else renderSteps();
      });
    }
    // B. Play while you watch: a cursor that waits; wrong notes flash red for 600 ms.
    let noteStart = 0;
    let missedHere = false;
    function startB() {
      mode = 'B';
      cursor = 0;
      pageIdx = 0;
      fb.set('neutral', t('reveal.play'), 'Play the blue note.');
      armLabel();
      draw();
      renderSteps();
    }
    function armLabel() {
      clearTimeout(labelTimer);
      noteStart = nowPerf();
      missedHere = false;
      labelShownFor = -1;
      if (settingsLabels() !== 'auto' || cursor >= notes.length) return;
      const key = noteKey(notes[cursor]);
      let delay = 0;
      try { delay = NS.mastery.labelDelay(key, { labels: 'auto', refresh: 0, guard: false }); } catch { delay = 0; }
      if (delay === Infinity) return;
      const at = cursor;
      labelTimer = setTimeout(() => { if (mode === 'B' && cursor === at) { labelShownFor = at; draw(); } }, Math.max(0, delay));
    }
    S.on(() => clearTimeout(labelTimer));
    function onInput(ev) {
      if (mode !== 'B' || cursor >= notes.length) return;
      K.setHeard(ev.midi);
      const exp = notes[cursor];
      if (pcOf(ev.midi) === pcOf(exp.midi)) {
        try {
          NS.mastery.record({
            key: noteKey(exp), outcome: missedHere ? 'assisted' : labelShownFor === cursor ? 'assisted' : 'read', source: 'ear',
            rtMs: Math.round(nowPerf() - noteStart), repeat: cursor > 0 && notes[cursor - 1].midi === exp.midi,
            confident: ev.source === 'screen' ? true : Boolean(ev.confident), firstToken: cursor === 0, ts: Date.now(),
          });
        } catch (err) { console.error('[ear] mastery.record failed', err); }
        cursor++;
        badAt = -1;
        if (cursor >= notes.length) { fb.set('good', 'You read the whole tune while you played it.', ''); startC(); return; }
        pageIdx = pageOfNote(cursor);
        armLabel();
        draw();
      } else {
        missedHere = true;
        badAt = cursor;
        draw();
        S.timeout(() => { if (badAt === cursor) { badAt = -1; draw(); } }, 600);
      }
    }
    // C. Spot it: which phrase, then 2 notes in it, by tapping (no mic).
    function startC() {
      mode = 'C';
      cursor = -1;
      badAt = -1;
      clearTimeout(labelTimer);
      const uniq = phrases.map((_, p) => p).filter((p) => reps[p].repeatOf == null);
      spot = { round: 0, phrase: uniq[Math.floor(Math.random() * uniq.length)], note: -1 };
      renderSteps();
      draw();
      spotRound();
    }
    function spotRound() {
      if (!spot) return;
      NS.audio.resume();
      if (spot.round === 0) {
        fb.set('neutral', t('reveal.spotPhrase'), '');
        const [a, b] = phrases[spot.phrase];
        S.sound(NS.audio.playSequence(itemsFor(notes.slice(a, b)), { bpm: song.bpm || 90, voice: 'piano', id: 'ear-spot' }));
      } else {
        const [a, b] = phrases[spot.phrase];
        const pg = pages.findIndex((x) => x.phrase === spot.phrase);
        pageIdx = Math.max(0, pg);
        const page = pages[pageIdx];
        let k = page.from + Math.floor(Math.random() * (page.to - page.from));
        if (spot.round === 2 && page.to - page.from > 1 && k === spot.note) k = k + 1 < page.to ? k + 1 : page.from;
        spot.note = Math.min(Math.max(k, a), b - 1);
        fb.set('neutral', t('reveal.spotNote'), '');
        draw();
        S.sound(NS.audio.playTone(notes[spot.note].midi, 1.0, 0.05, { voice: 'piano' }));
      }
    }
    function onPhraseTap(p) {
      if (mode !== 'C' || !spot || spot.round !== 0) {
        const pg = pages.findIndex((x) => x.phrase === p);
        if (pg >= 0 && mode !== 'B') { pageIdx = pg; draw(); }
        return;
      }
      const group = (x) => (reps[x].repeatOf != null ? reps[x].repeatOf : x);
      if (group(p) === group(spot.phrase)) fb.set('good', reps[p].repeatOf != null || phrases.some((_, q) => reps[q].repeatOf === p) ? 'Yes, that one. It comes back later too.' : 'Yes, that one.', '');
      else {
        fb.set('neutral', t('reveal.spotWrong'), '');
        const pill = pmap.pill(spot.phrase);
        if (pill) { pill.classList.add('pulse'); setTimeout(() => pill.classList.remove('pulse'), 1200); }
      }
      spot.round = 1;
      S.timeout(spotRound, 1200);
    }
    function onNoteTap(i) {
      if (mode !== 'C' || !spot || spot.round < 1) return;
      if (i === spot.note || notes[i].midi === notes[spot.note].midi) fb.set('good', 'Spot on.', '');
      else {
        fb.set('neutral', t('reveal.spotWrong'), '');
        pulseNote = spot.note;
        draw();
        S.timeout(() => { pulseNote = -1; draw(); }, 1200);
      }
      spot.round++;
      if (spot.round > 2) S.timeout(finish, 1300);
      else S.timeout(spotRound, 1300);
    }
    function finish() {
      mode = 'done';
      spot = null;
      pulseNote = -1;
      if (!opts.tryMode) write((x) => { const tn = tuneRec(x, id); if (!tn.seenAt) tn.seenAt = Date.now(); });
      fb.set('good', 'Now you’ve seen it.', t('practice.badge'));
      draw();
      renderSteps();
    }

    S.on(NS.input.on(onInput));
    S.on(NS.bus.on('resize', () => { buildPages(); pageIdx = Math.min(pageIdx, pages.length - 1); draw(); }));
    S.on(NS.bus.on('store:changed', ({ section }) => { if (section === 'settings') draw(); }));
    if (peekTune(id).seenAt) { mode = 'done'; revealUpTo = notes.length - 1; fb.set('neutral', 'Here it is again.', 'Play through it, or go and read it in Practice.'); }
    draw();
    renderSteps();
    return {
      destroy() { S.destroy(); },
      debug: () => ({ screen: 'see', songId: id, mode, revealUpTo, cursor, page: pageIdx, pages: pages.length, spot: spot && Object.assign({}, spot) }),
    };
  }

  // ---------- Warm-up review (§3.7.11): one whole-tune attempt from memory ----------
  function ReviewScreen(rootEl, ctx, song, opts) {
    const S = makeScope();
    const sess = newSession();
    const id = song.id;
    const notes = song.notes;
    const phrases = EC.phrasesFor(song);
    const reps = EC.findRepeats(phrases, notes);
    const phraseOf = (k) => phrases.findIndex(([a, b]) => k >= a && k < b);
    const tn0 = peekTune(id);
    const focus = EC.FOCUS[(tn0.polish && tn0.polish.focusIdx) || 0];
    const f = NS.ui.frame(rootEl, { eyebrow: 'Warm-up', title: song.title });
    ctx.setTitle(song.title);
    const card = h('section', { class: 'ef-card ef-call' });
    const stateLabel = h('p', { class: 'ef-state', 'aria-live': 'polite' }, t('review.intro'));
    card.appendChild(stateLabel);
    if (FOCUS_COPY[focus]) card.appendChild(h('p', { class: 'muted' }, FOCUS_COPY[focus]));
    const mapBox = h('div', { class: 'ef-mapbox big' });
    card.appendChild(mapBox);
    const pmap = phraseMap(mapBox, phrases, reps, { big: true });
    const prog = h('p', { class: 'muted ef-small' }, '');
    card.appendChild(prog);
    const ctl = h('div', { class: 'controls' });
    card.appendChild(ctl);
    f.body.appendChild(card);
    const fb = NS.ui.feedback(f.body);
    const micSlot = h('div');
    f.body.appendChild(micSlot);
    const micBar = NS.ui.micBar(micSlot);
    f.body.appendChild(h('p', { class: 'notice', 'data-mic-notice': '', hidden: true }));
    const kbEl = h('div', { class: 'keyboard', 'aria-label': 'On-screen keyboard. Tap a key to play it.' });
    f.body.appendChild(kbEl);
    const range = NS.keyboard.rangeFor(notes, { width: rootEl.clientWidth || window.innerWidth });
    const K = NS.keyboard.create(kbEl, { low: range.low, high: range.high, labels: read().settings.names ? 'all' : 'none' });
    S.on(() => K.destroy());
    S.on(() => micBar.destroy());
    let att = null;
    let heardFirst = false;
    let callHd = null;
    let phase = 'intro';
    const callBpm = EC.callBpmFor(notes, { bpm: song.bpm || 90, tempoPct: read().settings.tempoPct || 100 });

    function controls() {
      ctl.innerHTML = '';
      if (phase === 'intro') {
        ctl.append(btn('Start', 'primary', () => begin()), btn('Hear it first', '', () => hearFirst()), btn(t('review.skip'), '', () => skip()));
      } else if (phase === 'play') {
        ctl.append(btn('I’m stuck', '', () => finish(null)));
      }
    }
    function hearFirst() {
      heardFirst = true;
      NS.audio.resume();
      phase = 'call';
      controls();
      stateLabel.textContent = t('echo.listen');
      callHd = S.sound(NS.audio.playSequence(itemsFor(notes), { bpm: callBpm, voice: 'piano', id: 'ear-review', onNote: (i) => pmap.set({ learned: () => true, pulse: phraseOf(i) }) }));
      callHd.done.then((r) => { callHd = null; if (S.alive && phase === 'call') begin(); });
    }
    function begin() {
      phase = 'play';
      controls();
      stateLabel.textContent = t('echo.yourTurn');
      prog.textContent = `Note 1 of ${notes.length}`;
      att = attemptFor(S, notes, {
        sess, callEndPerf: nowPerf(), attemptIdx: 2, callBpm, whole: true, tangleAt: Math.max(8, Math.ceil(notes.length / 4)),
        onPrompt: (i) => { K.setLit([notes[i], notes[i + 1]].filter(Boolean).map((n) => n.midi), { tone: 'guide' }); fb.set('neutral', t('whole.prompt'), ''); },
        onNoisy: () => fb.set('neutral', '', t('noisy')),
        onEnd: (st, extra) => finish(st, extra),
      });
      pmap.set({ learned: () => true, pulse: 0 });
    }
    function skip() {
      write((x) => { if (!x.today.skipped.includes(id)) x.today.skipped.push(id); });
      ctx.go('#/ear');
    }
    S.on(NS.input.on((ev) => {
      if (phase !== 'play' || !att) return;
      K.setHeard(ev.midi);
      const r = att.push(ev);
      if (r && ['match', 'merged', 'swallowed'].includes(r.kind)) {
        K.setLit(null);
        prog.textContent = `Note ${Math.min(r.i + 1, notes.length)} of ${notes.length}`;
        pmap.set({ learned: () => true, pulse: phraseOf(Math.min(r.i, notes.length - 1)) });
        if (NS.mic.expect) NS.mic.expect({ repeat: Boolean(r.nextRepeat) });
      }
    }));
    function finish(st, extra) {
      if (phase !== 'play') return;
      phase = 'done';
      const a = att;
      if (a) a.stop();
      const s = st || a.M.state();
      const quit = !st || s.status !== 'success';
      const prompted = extra ? extra.prompted : a.prompted;
      const result = { wrong: s.wrong, n: notes.length, prompted, quit, heardFirst };
      const med = s.matchedRms.length ? U.median(s.matchedRms) : 0;
      let worstPhrase = 0;
      const err = phrases.map(() => 0);
      s.wrongAt.forEach((k) => { const p = phraseOf(Math.min(k, notes.length - 1)); if (p >= 0) err[p]++; });
      ((extra && extra.promptAt) || a.promptAt).forEach((k) => { const p = phraseOf(Math.min(k, notes.length - 1)); if (p >= 0) err[p]++; });
      err.forEach((x, p) => { if (x > err[worstPhrase]) worstPhrase = p; });
      const rhythm = s.status === 'success' ? EC.judgeRhythm(notes.map((n) => n.beats || 1), s.onsets, { callBpm }) : null;
      let outcome = 'stay';
      let met = false;
      write((x) => {
        const tn = tuneRec(x, id);
        const before = tn.polish || {};
        met = !quit && EC.focusMet(focus, { rhythm, medianRms: med, prevMedianRms: tn.rmsMedian || 0, octaveShare: s.matched ? s.octaveUp / s.matched : 0 });
        tn.polish = EC.scheduleReview(before, result, today());
        outcome = tn.polish.lastOutcome;
        if (met) tn.focusTicks = (tn.focusTicks || 0) + 1;
        if (med > 0) tn.rmsMedian = med;
        tn.phraseErr = phrases.map((_, p) => (tn.phraseErr[p] || 0) + err[p]);
        if (outcome === 'clean') addReps(x, 1);
        if (!x.today.skipped.includes(id)) x.today.skipped.push(id);
        x.today.warmupDone = true;
        if (EC.isRead(tn) && tn.polish.level >= 1 && EC.rank(tn.stage) < EC.rank('polish')) tn.stage = 'polish';
      });
      if (outcome === 'clean') NS.audio.cue('bead');
      K.setLit(null);
      stateLabel.textContent = outcome === 'clean' ? 'Clean' : outcome === 'stay' ? 'Good' : 'Rusty';
      fb.set(outcome === 'rusty' ? 'neutral' : 'good', t('review.' + outcome), met && FOCUS_COPY[focus] ? 'Focus met: ✓' : '');
      ctl.innerHTML = '';
      if (outcome === 'rusty') ctl.append(btn('Brush up', 'primary', () => ctx.go(`#/ear/${encodeURIComponent(id)}?step=echo&brush=${worstPhrase}`)));
      ctl.append(btn('All tunes', outcome === 'rusty' ? '' : 'primary', () => ctx.go('#/ear')));
    }
    fb.set('neutral', 'Play it from memory. I won’t play it first unless you ask.', '');
    controls();
    pmap.set({ learned: () => true });
    return { destroy() { if (att) att.stop(); S.destroy(); }, debug: () => ({ screen: 'review', songId: id, phase, i: att ? att.M.i : 0, focus }) };
  }

  // ======================================================================
  // RHYTHM REMIX (#/ear/remix for R1/R2, #/ear/:id?step=remix for R3)
  // ======================================================================
  function RemixScreen(rootEl, ctx, { song = null, level = null } = {}) {
    const S = makeScope();
    const e0 = read();
    let lvl = song ? 'r3' : level === 'r2' ? 'r2' : 'r1';
    const f = NS.ui.frame(rootEl, { eyebrow: song ? song.title : 'Ear First', title: 'Rhythm Remix' });
    ctx.setTitle('Rhythm Remix');
    f.body.appendChild(h('p', { class: 'muted' }, t('remix.intro')));
    if (!song) {
      f.body.appendChild(NS.ui.seg([{ value: 'r1', label: 'R1 · Any key' }, { value: 'r2', label: 'R2 · Two notes' }], lvl, (v) => { lvl = v; reset(); }));
    }
    const chipsBox = h('div', { class: 'ef-steps ef-patterns', role: 'group', 'aria-label': 'Rhythm patterns' });
    f.body.appendChild(chipsBox);
    const card = h('section', { class: 'ef-card ef-call' });
    const stateLabel = h('p', { class: 'ef-state', 'aria-live': 'polite' }, t('echo.listen'));
    card.appendChild(stateLabel);
    const tuneBars = bars(card, 'Tune');
    const youBars = bars(card, 'You');
    youBars.el.hidden = true;
    const ctl = h('div', { class: 'controls' });
    card.appendChild(ctl);
    f.body.appendChild(card);
    const fb = NS.ui.feedback(f.body);
    const beadsW = beadCounter(f.body);
    const micSlot = h('div');
    f.body.appendChild(micSlot);
    const micBar = NS.ui.micBar(micSlot);
    f.body.appendChild(h('p', { class: 'notice', 'data-mic-notice': '', hidden: true }));
    const kbEl = h('div', { class: 'keyboard', 'aria-label': 'On-screen keyboard. Tap a key to play it.' });
    f.body.appendChild(kbEl);
    const K = NS.keyboard.create(kbEl, { low: 60, high: 76, labels: e0.settings.names ? 'all' : 'none', tapDur: 0.25 });
    S.on(() => K.destroy());
    S.on(() => micBar.destroy());
    if (!song) {
      f.body.appendChild(h('div', { class: 'ef-more' },
        btn('Skip warm-up', 'small', () => { write((x) => { x.remix.skipped = true; }); ctx.go('#/ear'); }),
        btn('All tunes', 'small', () => ctx.go('#/ear'))));
    }

    let pIdx = 0;
    let items = [];
    let phase = 'intro';
    let onsets = [];
    let callHd = null;
    let callBpm = 90;
    let M = null;
    let wrong = 0;
    let quietTimer = null;
    const pattern = () => EC.REMIX_PATTERNS[pIdx];
    function store() {
      const e = read();
      if (lvl === 'r1') return e.remix.r1;
      if (lvl === 'r2') return e.remix.r2;
      return (e.tunes[song.id] && e.tunes[song.id].remix) || {};
    }
    function melody() {
      if (lvl !== 'r3') return EC.REMIX_LEVELS[lvl].melody;
      const ph = EC.phrasesFor(withIndex(song));
      const [a, b] = ph[0] || [0, Math.min(4, song.notes.length)];
      return song.notes.slice(a, Math.min(b, a + 6)).map((n) => n.midi);
    }
    function renderChips() {
      chipsBox.innerHTML = '';
      const st = store();
      EC.REMIX_PATTERNS.forEach((p, k) => {
        const n = st[p.id] || 0;
        const b = NS.ui.chip(`${p.name} ${n >= 2 ? '✓' : n ? n + '/2' : ''}`.trim(), { pressed: k === pIdx, onClick: () => { pIdx = k; reset(); } });
        chipsBox.appendChild(b);
      });
    }
    function reset() {
      stopCall();
      phase = 'intro';
      items = EC.remixItems(pattern(), melody());
      callBpm = lvl === 'r3' ? Math.min(song.bpm || 80, EC.REMIX_LEVELS.r3.capBpm) : 90;
      tuneBars.set(items.map((x) => x.beats));
      youBars.el.hidden = true;
      onsets = [];
      wrong = 0;
      M = null;
      const n = store()[pattern().id] || 0;
      beadsW.set(n, 2, Math.max(0, n - 2));
      stateLabel.textContent = `${pattern().name}`;
      fb.set('neutral', lvl === 'r1' ? 'Any key is fine. Copy the rhythm.' : lvl === 'r2' ? 'Now with two notes: C, then G.' : 'Your tune’s first phrase, in a new rhythm.', '');
      ctl.innerHTML = '';
      ctl.append(btn('▶ Listen', 'primary', () => call()));
      renderChips();
      if (NS.mic.expect) NS.mic.expect({ repeat: lvl === 'r1' });
    }
    function stopCall() { if (callHd) { const hd = callHd; callHd = null; hd.stop(); } }
    function call() {
      NS.audio.resume();
      stopCall();
      phase = 'CALL';
      youBars.el.hidden = true;
      tuneBars.clearStates();
      stateLabel.textContent = t('echo.listen');
      ctl.innerHTML = '';
      ctl.append(btn(t('echo.again'), '', () => call()));
      callHd = S.sound(NS.audio.playSequence(items, { bpm: callBpm, voice: 'piano', id: 'ear-remix', onNote: (i) => { tuneBars.clearStates(); tuneBars.state(i, 'listen'); } }));
      const hd = callHd;
      hd.done.then((r) => {
        if (hd !== callHd) return;
        callHd = null;
        if (r === 'ended' && S.alive && phase === 'CALL') {
          phase = 'WAIT';
          tuneBars.clearStates();
          onsets = [];
          wrong = 0;
          M = lvl === 'r1' ? null : EC.makeMatcher(items, { callEndPerf: nowPerf(), callBpm, maxMerged: 0, tangleAt: 99, doubledSec: 0.1 });
          stateLabel.textContent = t('echo.yourTurn');
          if (lvl !== 'r1') K.setHint(items[0].midi);
        }
      });
    }
    function onOnset(at, tOnset, midi) {
      if (phase !== 'WAIT' && phase !== 'PLAY') return;
      phase = 'PLAY';
      K.setHint(null);
      if (lvl === 'r1') {
        onsets.push(at);
        youBars.el.hidden = false;
        youBars.set(onsets.map(() => 1), { states: onsets.map(() => 'good') });
      } else {
        const r = M.push({ midi, at, tOnset, source: 'screen', rms: null });
        if (r.kind === 'wrong') wrong++;
        onsets = M.state().onsets.slice(0, M.i);
        youBars.el.hidden = false;
        youBars.set(onsets.map(() => 1), { states: onsets.map(() => 'good') });
      }
      clearTimeout(quietTimer);
      const done = lvl === 'r1' ? onsets.length >= items.length : M.i >= items.length;
      if (done) S.timeout(judge, 150);
      else quietTimer = S.timeout(() => { if (phase === 'PLAY') { phase = 'WAIT'; onsets = []; if (M) M = EC.makeMatcher(items, { callEndPerf: -Infinity, callBpm, maxMerged: 0, tangleAt: 99, doubledSec: 0.1 }); fb.set('neutral', t('echo.idle'), `I heard part of it. Start again from the first note.`); youBars.el.hidden = true; } }, 3500);
    }
    function judge() {
      if (phase !== 'PLAY') return;
      phase = 'JUDGE';
      const beats = items.map((x) => x.beats);
      const r = EC.judgeRhythm(beats, onsets, { callBpm });
      let msg;
      let pass = false;
      if (wrong > 0) msg = t('echo.slip');
      else if (r.status === 'na') msg = r.reason === 'tempo' && r.beatMs < 250 ? t('remix.tempo') : t('remix.unsteady');
      else if (r.pass) { msg = t('remix.good'); pass = true; }
      else if (r.short) msg = t('remix.short');
      else if (!r.steady) msg = t('remix.unsteady');
      else msg = r.worst.dir === 'early' ? t('remix.early', { k: r.worst.i + 2 }) : t('remix.late', { k: r.worst.i + 2 });
      // Tune / You comparison: your gaps in beats, the worst gap outlined
      if (r.status === 'ok') {
        const widths = onsets.map((o, k) => (k + 1 < onsets.length && onsets[k + 1] != null && o != null ? ((onsets[k + 1] - o) * 1000) / r.beatMs : beats[k]));
        youBars.set(widths, { worst: r.pass ? -1 : r.worst.i, states: widths.map((_, k) => (!r.pass && k === r.worst.i ? 'bad' : 'good')) });
        tuneBars.set(beats, { worst: r.pass ? -1 : r.worst.i });
      }
      let unlocked = null;
      if (pass) {
        const pid = pattern().id;
        const before = EC.unlocks(read(), NS.store.state(), getSong);
        write((x) => {
          const tgt = lvl === 'r1' ? x.remix.r1 : lvl === 'r2' ? x.remix.r2 : tuneRec(x, song.id).remix;
          tgt[pid] = (tgt[pid] || 0) + 1;
          addReps(x, 1);
        });
        NS.audio.cue('bead');
        const after = EC.unlocks(read(), NS.store.state(), getSong);
        unlocked = pathTunes().find((s) => after[s.id].listen && !before[s.id].listen);
      }
      const n = store()[pattern().id] || 0;
      beadsW.set(n, 2, Math.max(0, n - 2));
      fb.set(pass ? 'good' : 'neutral', msg, r.tempoNote === 'faster' ? 'A bit faster than mine.' : r.tempoNote === 'slower' ? 'A bit slower than mine.' : '');
      if (unlocked) NS.ui.toast(t('unlock.next', { title: unlocked.title }));
      renderChips();
      ctl.innerHTML = '';
      ctl.append(btn(t('echo.again'), '', () => call()));
      if (n >= 2 && pIdx + 1 < EC.REMIX_PATTERNS.length) ctl.append(btn('Next rhythm', 'primary', () => { pIdx++; reset(); }));
      else ctl.append(btn(t('echo.tryAgain'), 'primary', () => { phase = 'WAIT'; onsets = []; wrong = 0; M = lvl === 'r1' ? null : EC.makeMatcher(items, { callEndPerf: -Infinity, callBpm, maxMerged: 0, tangleAt: 99, doubledSec: 0.1 }); youBars.el.hidden = true; stateLabel.textContent = t('echo.yourTurn'); }));
      if (unlocked || (lvl === 'r1' && EC.r1Done(read()) && !song)) ctl.append(btn('To your first tune', '', () => ctx.go('#/ear')));
      S.timeout(() => { if (phase === 'JUDGE') { phase = 'WAIT'; onsets = []; wrong = 0; if (lvl !== 'r1') M = EC.makeMatcher(items, { callEndPerf: -Infinity, callBpm, maxMerged: 0, tangleAt: 99, doubledSec: 0.1 }); } }, 900);
    }
    // R1: raw onsets from the mic plus screen taps; R2/R3: pitched input events.
    S.on(NS.bus.on('mic:onset', (ev) => { if (lvl === 'r1') onOnset(ev.at, ev.tOnset, null); }));
    S.on(NS.input.on((ev) => {
      if (lvl === 'r1') { if (ev.source === 'screen') onOnset(ev.at, ev.tOnset, ev.midi); return; }
      onOnset(ev.at, ev.tOnset, ev.midi);
    }));
    S.on(() => { if (NS.mic.expect) NS.mic.expect({ repeat: false }); });
    reset();
    return { destroy() { S.destroy(); }, debug: () => ({ screen: 'remix', level: lvl, pattern: pattern().id, phase, onsets: onsets.length, n: items.length }) };
  }

  // ======================================================================
  // LISTENING ROOM (#/ear/room). One rendered session file in a looping <audio>; the mic is never judged.
  // ======================================================================
  let roomCache = null; // {sig, url, duration, layout}

  function Room(rootEl, ctx) {
    const S = makeScope();
    const f = NS.ui.frame(rootEl, { eyebrow: 'Ear First', title: 'Listening Room' });
    ctx.setTitle('Listening Room');
    const e = read();
    const u = EC.unlocks(e, NS.store.state(), getSong);
    const list = pathTunes();
    const cur = currentTune(e, u) || list[0];
    const curIdx = list.indexOf(cur);
    const next = list[curIdx + 1] || null;
    const friends = list.filter((s) => s !== cur && EC.byEar(e.tunes[s.id])).sort((a, b) => (e.tunes[b.id].byEarAt || 0) - (e.tunes[a.id].byEarAt || 0)).slice(0, 3);
    const tr = (s, octaveShift = 0) => ({ id: s.id, items: s.items || itemsFor(withIndex(s).notes), bpm: s.bpm || 90, octaveShift, key: s.key, beatsPerBar: s.beatsPerBar, pickup: s.pickup || 0 });
    const tracks = [];
    if (cur) tracks.push(tr(cur), tr(cur));
    if (next) tracks.push(tr(next), tr(next, 1));
    friends.forEach((s) => tracks.push(tr(s)));
    const sig = tracks.map((x) => x.id + ':' + x.octaveShift).join(',');

    const card = h('section', { class: 'ef-card ef-now' });
    const nowTitle = h('h3', null, cur ? cur.title : '');
    const nowOrigin = h('p', { class: 'muted' }, cur ? cur.origin || '' : '');
    const rbBox = h('div');
    const rb = ribbon(rbBox, cur ? cur.notes : []);
    const prog = h('div', { class: 'progress' }, h('div'));
    const status = h('p', { class: 'muted ef-small', 'aria-live': 'polite' }, 'Getting the music ready…');
    const playB = btn('▶ Play', 'primary', () => toggle(), { disabled: true });
    const prevB = btn('⏮', '', () => seek(-1), { 'aria-label': 'Previous tune', disabled: true });
    const nextB = btn('⏭', '', () => seek(1), { 'aria-label': 'Next tune', disabled: true });
    const loopB = NS.ui.chip('Loop all', { pressed: true, onClick: () => { audio.loop = !audio.loop; loopB.classList.toggle('on', audio.loop); loopB.setAttribute('aria-pressed', String(audio.loop)); } });
    let rate = 1;
    const speedB = NS.ui.chip('Speed 100%', { onClick: () => { settle(); rate = rate === 1 ? 0.8 : 1; audio.playbackRate = rate; speedB.textContent = `Speed ${Math.round(rate * 100)}%`; } });
    card.append(nowTitle, nowOrigin, rbBox, prog, h('div', { class: 'controls ef-transport' }, prevB, playB, nextB), h('div', { class: 'controls' }, loopB, speedB), status);
    f.body.appendChild(card);

    const lists = h('section', { class: 'ef-card ef-playlist' });
    if (cur) lists.append(h('p', null, h('strong', null, 'Now learning: '), cur.title));
    if (next) lists.append(h('p', null, h('strong', null, 'Coming next: '), next.title, ' ', h('span', { class: 'ef-pill learn' }, t('listen.comingNext'))));
    if (friends.length) lists.append(h('p', null, h('strong', null, 'Old friends: '), friends.map((s) => s.title).join(', ')));
    f.body.appendChild(lists);
    f.body.appendChild(h('p', { class: 'muted' }, 'Leave it playing while you cook or tidy up. Your ears keep learning even when you’re not paying attention.'));
    const todayLine = h('p', { class: 'ef-reps' });
    f.body.appendChild(todayLine);
    f.body.appendChild(h('p', { class: 'muted ef-small' }, 'Listening is switched off here: nothing you play is judged in the Room.'));

    const audio = h('audio', { loop: true, preload: 'auto' });
    audio.loop = true;
    f.body.appendChild(audio);
    let layout = [];
    let duration = 0;
    let playing = false;
    let session = null; // {playStartedAt, posAtStart}
    let live = null; // fallback when render isn't available: {hd, k}

    function showToday() {
      const x = read();
      const d = x.listening.days[today()] || { secs: 0, listens: 0 };
      const streak = EC.streakNow(x.listening, today());
      todayLine.textContent = `Today: ${Math.floor(d.secs / 60)} min ${Math.round(d.secs % 60)} s · ${d.listens} listens` + (streak ? ` · ${t('listen.streak', { n: streak })}` : '');
    }
    showToday();

    // Adds the play time and the listens since the last settle (also covers time while JS was paused).
    function settle() {
      if (!session || !playing || live) return;
      const now = Date.now();
      const elapsedReal = Math.max(0, (now - session.playStartedAt) / 1000);
      const r = EC.countListens(layout, duration, session.posAtStart, elapsedReal * rate, audio.loop);
      addListening({ secs: elapsedReal, counts: r.counts });
      session = { playStartedAt: now, posAtStart: audio.currentTime || r.endPos };
      write((x) => { x.listening.session = { startedAt: session.playStartedAt, posAtStart: session.posAtStart }; });
      showToday();
    }

    function toggle() {
      NS.audio.resume();
      if (live) return toggleLive();
      if (playing) audio.pause(); else audio.play().catch(() => { status.textContent = 'Tap play again to start.'; });
    }
    function seek(dir) {
      if (!layout.length || live) return;
      settle();
      const tNow = audio.currentTime;
      let k = layout.findIndex((L) => tNow < L.end + 0.75);
      if (k < 0) k = layout.length - 1;
      const target = dir < 0 ? (tNow - layout[k].start > 2 ? k : Math.max(0, k - 1)) : Math.min(layout.length - 1, k + 1);
      audio.currentTime = layout[target].start;
      if (session) session.posAtStart = audio.currentTime;
    }
    audio.addEventListener('play', () => {
      playing = true;
      if (NS.mic.isOn()) NS.mic.stop();
      NS.audio.setSessionType('playback');
      session = { playStartedAt: Date.now(), posAtStart: audio.currentTime };
      playB.textContent = '❚❚ Pause';
      mediaSession(true);
    });
    audio.addEventListener('pause', () => { settle(); playing = false; session = null; playB.textContent = '▶ Play'; mediaSession(false); });
    audio.addEventListener('ended', () => { settle(); playing = false; session = null; playB.textContent = '▶ Play'; });
    S.on(NS.bus.on('visibility', () => settle()));
    S.interval(() => { settle(); }, 15000);
    S.interval(() => {
      if (!layout.length || live) return;
      const tNow = audio.currentTime;
      prog.firstChild.style.width = (100 * tNow) / (duration || 1) + '%';
      const k = layout.findIndex((L) => tNow >= L.start - 0.05 && tNow < L.end + 0.75);
      if (k >= 0) {
        const s = getSong(layout[k].id);
        if (s && nowTitle.dataset.id !== s.id + k) {
          nowTitle.dataset.id = s.id + k;
          nowTitle.textContent = s.title;
          nowOrigin.textContent = s.origin || '';
          rb.set(s.notes);
          mediaSession(playing, s.title);
        }
        const times = layout[k].noteTimes || [];
        let i = -1;
        for (let j = 0; j < times.length; j++) if (times[j] <= tNow) i = j;
        rb.light(i);
      }
    }, 200);

    function mediaSession(on, title) {
      const ms = navigator.mediaSession;
      if (!ms) return;
      try {
        if (root.MediaMetadata) ms.metadata = new root.MediaMetadata({ title: title || (cur ? cur.title : 'Listening Room'), artist: 'Note Steps', album: 'Listening Room' });
        ms.playbackState = on ? 'playing' : 'paused';
        ms.setActionHandler('play', () => audio.play());
        ms.setActionHandler('pause', () => audio.pause());
        ms.setActionHandler('previoustrack', () => seek(-1));
        ms.setActionHandler('nexttrack', () => seek(1));
      } catch {}
    }

    // Fallback: live synth playback, one track after another (needs the screen on).
    function toggleLive() {
      if (live.hd) { live.hd.stop(); return; }
      if (NS.mic.isOn()) NS.mic.stop();
      const playTrack = () => {
        const trk = tracks[live.k % tracks.length];
        const s = getSong(trk.id);
        nowTitle.textContent = s.title;
        nowOrigin.textContent = s.origin || '';
        rb.set(s.notes);
        const started = Date.now();
        live.hd = S.sound(NS.audio.playSequence(trk.items.map((x) => Object.assign({}, x, x.midi != null ? { midi: x.midi + 12 * trk.octaveShift } : {})), {
          bpm: trk.bpm * rate, voice: 'piano', id: 'ear-room', onNote: (i) => rb.light(i),
        }));
        playB.textContent = '■ Stop';
        live.hd.done.then((r) => {
          live.hd = null;
          addListening({ secs: (Date.now() - started) / 1000, counts: r === 'ended' ? { [trk.id]: 1 } : {} });
          showToday();
          if (!S.alive) return;
          if (r === 'ended') { live.k++; S.timeout(playTrack, 1500); } else playB.textContent = '▶ Play';
        });
      };
      playTrack();
    }

    function ready(res) {
      if (!S.alive) return;
      layout = res.layout || [];
      duration = res.duration || 0;
      audio.src = res.url;
      playB.disabled = false;
      prevB.disabled = false;
      nextB.disabled = false;
      status.textContent = `${Math.round(duration / 60 * 10) / 10} min of music, on a loop. It keeps playing with the screen locked.`;
    }
    if (!tracks.length) {
      status.textContent = 'Your tunes will appear here.';
    } else if (roomCache && roomCache.sig === sig) {
      ready(roomCache);
    } else {
      Promise.resolve()
        .then(() => NS.audio.render(tracks, { voice: 'piano', drone: true, sampleRate: 16000, gapSec: 1.5 }))
        .then((res) => {
          if (!res || !res.blob || !res.blob.size || !res.duration) throw new Error('empty render');
          if (roomCache && roomCache.url) URL.revokeObjectURL(roomCache.url);
          roomCache = { sig, url: URL.createObjectURL(res.blob), duration: res.duration, layout: res.layout };
          ready(roomCache);
        })
        .catch(() => {
          if (!S.alive) return;
          live = { hd: null, k: 0 };
          playB.disabled = false;
          status.textContent = 'This browser plays the tunes live here, so keep the screen on while you listen.';
        });
    }

    S.on(() => {
      settle();
      try { audio.pause(); } catch {}
      audio.removeAttribute('src');
      try { audio.load(); } catch {}
      if (roomCache && roomCache.url) { URL.revokeObjectURL(roomCache.url); roomCache = null; }
      NS.audio.setSessionType('auto');
      const ms = navigator.mediaSession;
      if (ms) { try { ['play', 'pause', 'previoustrack', 'nexttrack'].forEach((a) => ms.setActionHandler(a, null)); ms.playbackState = 'none'; } catch {} }
    });
    return {
      destroy() { S.destroy(); },
      debug: () => ({ screen: 'room', tracks: tracks.map((x) => x.id), playing: playing || Boolean(live && live.hd), live: Boolean(live), duration, micOn: NS.mic.isOn() }),
    };
  }

  // ======================================================================
  // CONCERT (#/ear/concert): every polished tune, back to back, no calls.
  // ======================================================================
  function Concert(rootEl, ctx) {
    const S = makeScope();
    const sess = newSession();
    const f = NS.ui.frame(rootEl, { eyebrow: 'Ear First', title: 'Concert' });
    ctx.setTitle('Concert');
    const e = read();
    const program = pathTunes().filter((s) => e.tunes[s.id] && e.tunes[s.id].polish && e.tunes[s.id].polish.level >= 2).map(withIndex);
    f.body.appendChild(h('p', null, t('concert.intro')));
    if (!EC.concertOpen(e)) {
      f.body.appendChild(h('p', { class: 'muted' }, 'The concert opens when 3 tunes are polished. Keep up the warm-ups!'));
      f.body.appendChild(btn('All tunes', 'primary', () => ctx.go('#/ear')));
      return { destroy() { S.destroy(); }, debug: () => ({ screen: 'concert', open: false }) };
    }
    const prog = h('ol', { class: 'ef-program' });
    const rows = program.map((s) => { const li = h('li', null, s.title); prog.appendChild(li); return li; });
    f.body.appendChild(h('section', { class: 'ef-card' }, h('h3', null, 'Programme'), prog));
    const stateLabel = h('p', { class: 'ef-state', 'aria-live': 'polite' }, 'Ready when you are.');
    f.body.appendChild(stateLabel);
    const fb = NS.ui.feedback(f.body);
    const ctl = h('div', { class: 'controls' });
    f.body.appendChild(ctl);
    const micSlot = h('div');
    f.body.appendChild(micSlot);
    const micBar = NS.ui.micBar(micSlot);
    const kbEl = h('div', { class: 'keyboard', 'aria-label': 'On-screen keyboard. Tap a key to play it.' });
    f.body.appendChild(kbEl);
    const all = program.flatMap((s) => s.notes);
    const range = NS.keyboard.rangeFor(all, { width: rootEl.clientWidth || window.innerWidth });
    const K = NS.keyboard.create(kbEl, { low: range.low, high: range.high, labels: e.settings.names ? 'all' : 'none' });
    S.on(() => K.destroy());
    S.on(() => micBar.destroy());
    let k = -1;
    let att = null;
    const results = [];
    function nextTune() {
      k++;
      if (k >= program.length) {
        const clean = results.filter(Boolean).length;
        stateLabel.textContent = 'Bravo!';
        fb.set('good', `${clean} of ${program.length} tunes clean.`, 'That was your concert.');
        ctl.innerHTML = '';
        ctl.append(btn('All tunes', 'primary', () => ctx.go('#/ear')));
        return;
      }
      const s = program[k];
      rows.forEach((r, j) => r.classList.toggle('now', j === k));
      stateLabel.textContent = `Now: ${s.title}`;
      fb.set('neutral', 'Play it from memory.', '');
      const callBpm = EC.callBpmFor(s.notes, { bpm: s.bpm || 90 });
      att = attemptFor(S, s.notes, {
        sess, callEndPerf: nowPerf(), attemptIdx: 2, callBpm, whole: true, tangleAt: Math.max(8, Math.ceil(s.notes.length / 4)),
        onPrompt: (i) => { K.setLit([s.notes[i], s.notes[i + 1]].filter(Boolean).map((n) => n.midi), { tone: 'guide' }); fb.set('neutral', t('whole.prompt'), ''); },
        onEnd: (st, extra) => {
          const clean = st.status === 'success' && st.wrong <= Math.floor(s.notes.length / 20) && extra.prompted === 0;
          results.push(clean);
          rows[k].classList.add(clean ? 'clean' : 'played');
          rows[k].setAttribute('aria-label', `${s.title}: ${clean ? 'clean' : 'played'}`);
          K.setLit(null);
          if (clean) NS.audio.cue('good');
          fb.set(clean ? 'good' : 'neutral', clean ? 'Clean!' : 'Played to the end.', program[k + 1] ? `Next: ${program[k + 1].title}` : '');
          S.timeout(nextTune, 2500);
        },
      });
    }
    S.on(NS.input.on((ev) => {
      if (!att || att.ended) return;
      K.setHeard(ev.midi);
      const r = att.push(ev);
      if (r && ['match', 'merged', 'swallowed'].includes(r.kind)) { K.setLit(null); if (NS.mic.expect) NS.mic.expect({ repeat: Boolean(r.nextRepeat) }); }
    }));
    ctl.append(btn('Start the concert', 'primary', () => { ctl.innerHTML = ''; ctl.append(btn('Skip this tune', '', () => { if (att) { att.stop(); results.push(false); rows[k].classList.add('played'); nextTune(); } })); nextTune(); }));
    return { destroy() { if (att) att.stop(); S.destroy(); }, debug: () => ({ screen: 'concert', open: true, k, results: results.slice() }) };
  }

  // ======================================================================
  // READ AND COLD READ (practice:finished from any route, subscribed once at load)
  // ======================================================================
  if (!NS.__earFinishedSub) {
    NS.__earFinishedSub = NS.bus.on('practice:finished', ({ songId } = {}) => {
      if (!songId) return;
      const events = [];
      write((e) => {
        for (const id in e.tunes) {
          const tn = e.tunes[id];
          if (!tn) continue;
          if (id === songId && EC.byEar(tn) && !tn.readAt) {
            tn.readAt = Date.now();
            if (EC.rank(tn.stage) < EC.rank('read')) { tn.stage = 'read'; events.push({ songId: id, stage: 'read' }); }
            tn.readCelebrate = true;
          }
          const target = tn.coldTarget;
          if (target && !tn.coldReadAt && (songId === target || (String(target).startsWith('run') && String(songId).startsWith('run')))) {
            tn.coldReadAt = Date.now();
          }
        }
      });
      events.forEach((ev) => NS.bus.emit('ear:stage', ev));
    });
  }

  // ======================================================================
  // MODE
  // ======================================================================
  let screen = null;
  function mount(rootEl, params, ctx) {
    rootEl.classList.add('ef');
    const arg = params.arg;
    const q = params.query || new URLSearchParams();
    try {
      if (!arg) screen = Hub(rootEl, ctx);
      else if (arg === 'room') screen = Room(rootEl, ctx);
      else if (arg === 'remix') screen = RemixScreen(rootEl, ctx, { level: q.get('level') });
      else if (arg === 'concert') screen = Concert(rootEl, ctx);
      else {
        const song = getSong(arg);
        if (!song) { NS.ui.toast('That song isn’t here any more.'); ctx.go('#/'); return; }
        screen = TuneScreen(rootEl, ctx, song, q);
      }
    } catch (err) {
      console.error('[ear] mount failed', err);
      throw err;
    }
  }
  function unmount() {
    if (screen) { try { screen.destroy(); } catch (err) { console.error('[ear] unmount failed', err); } }
    screen = null;
  }

  NS.modes.register({
    id: 'ear',
    title: 'Ear First',
    blurb: t('hub.tile'),
    order: 2,
    needsSong: false,
    icon: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M7 9a5 5 0 1 1 9 3c-1.4 1.5-2.5 2.3-2.5 4.5a2.5 2.5 0 0 1-5 0"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M10 9.5a2 2 0 1 1 3.5 1.3"/></svg>',
    mount,
    unmount,
    songBadge(songId) {
      const tn = read().tunes[songId];
      if (!tn) return null;
      if (EC.isRead(tn)) return { text: 'Ear: by ear, read', tone: 'good' };
      if (EC.byEar(tn)) return { text: 'Ear: by ear', tone: 'good' };
      if (EC.rank(tn.stage) >= EC.rank('echo')) return { text: 'Ear: learning', tone: 'learn' };
      return null;
    },
    songLocked(songId) {
      const u = EC.unlocks(read(), NS.store.state(), getSong)[songId];
      if (!u) return { locked: false };
      return u.listen ? { locked: false } : { locked: true, why: 'Unlocks as you go along the Ear First path.' };
    },
    tileChip() {
      const n = EC.streakNow(read().listening, today());
      return n > 0 ? t('listen.streak', { n }) : null;
    },
    debugState: () => (screen && screen.debug ? screen.debug() : null),
  });

  // Small test/debug surface (no behaviour): the copy table and the store accessors.
  NS.earfirst = { COPY, t, read, getSong };
})(typeof window !== 'undefined' ? window : globalThis);
