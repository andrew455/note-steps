// Free Play logic. UMD: NS.FreeCore in the browser, require('./freeplay-core.js') in Node.
//
// Pure parts (Node-testable, spec §3.6):
//   quantize / provisional / estimateBeatMs   timed-mode rhythm (§3.6.3)
//   layoutEven / layoutTimed                  where each played note goes on the scrolling staff
//   describe / noteName / fullName / badgeFor feedback wording for one played note (§3.6.2)
//   playbackEvents                            what "Play back" plays (§3.6.4)
//   buildIndex / createRecognizer             "I know that tune!" (§3.6.6)
//   detectScale                               the whole-scale bonus
// Browser part (touches the DOM only when called):
//   createLiveStaff(svg, opts)                the live scrolling staff. Free Play uses it, and so does the
//                                             Play by Ear Practise step (§7.2).
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const NotationMod = isNode ? require('../core/notation.js') : null;
  const ShapesMod = isNode ? require('../core/shapes.js') : null;
  // Resolved on use, so the browser picks up whatever core/notation.js and core/shapes.js define.
  const Notation = () => NotationMod || root.NS.notation;
  const Shapes = () => ShapesMod || root.NS.shapes;

  const pc = (m) => ((m % 12) + 12) % 12;
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

  // ======================================================================
  // RHYTHM (timed mode)
  // ======================================================================
  const GRID = [0.5, 1, 1.5, 2, 3, 4];
  const GRID_DUR = ['e', 'q', 'q.', 'h', 'h.', 'w'];
  const REST_BEATS = [4, 2, 1];
  const REST_DUR = { 4: 'w', 2: 'h', 1: 'q' };
  const DEFAULT_BEAT_MS = 750; // 80 bpm until there are 3 notes to measure
  const MIN_BEAT_MS = 375;
  const MAX_BEAT_MS = 1200;

  // Index into GRID nearest to x beats, by |log2(x / g)|.
  function nearestGrid(x) {
    const v = Math.max(1e-6, x);
    let best = 0;
    let bestD = Infinity;
    GRID.forEach((g, k) => {
      const d = Math.abs(Math.log2(v / g));
      if (d < bestD - 1e-12) { bestD = d; best = k; }
    });
    return best;
  }

  // ioiMs: gap from this onset to the next one. beatMs: beat length. soundMs: how long the note sounded
  // (off - onset), or null when no offset was heard. -> {dur, beats, rests:[{dur, beats}], raw}
  function quantize(ioiMs, beatMs, soundMs = null) {
    const raw = ioiMs / beatMs;
    let k;
    const rests = [];
    if (raw < 0.35) k = 0;
    else if (raw <= 4.5) k = nearestGrid(raw);
    else {
      const sound = (soundMs != null && soundMs > 0 ? soundMs : beatMs) / beatMs;
      k = nearestGrid(Math.min(sound, 4));
      const gap = raw - GRID[k];
      if (gap >= 0.75) {
        let left = Math.round(gap);
        REST_BEATS.forEach((b) => {
          while (left >= b) { rests.push({ dur: REST_DUR[b], beats: b }); left -= b; }
        });
      }
    }
    return { dur: GRID_DUR[k], beats: GRID[k], rests, raw };
  }

  // The newest note has no next onset yet. It is drawn as at least a quarter and grows while it is held
  // (quarter, half, whole). soundMs (when an offset was heard) fixes its length.
  function provisional(elapsedMs, beatMs, soundMs = null) {
    const x = (soundMs != null && soundMs > 0 ? soundMs : elapsedMs) / beatMs;
    const k = nearestGrid(clamp(x, 1, 4));
    return { dur: GRID_DUR[k], beats: GRID[k], rests: [], raw: x };
  }

  // Beat length from the last 8 inter-onset gaps (median), clamped to 375..1200 ms.
  // bpm: 'auto' or a number (a fixed tempo from the Tempo chip).
  function estimateBeatMs(onsets, bpm = 'auto') {
    if (typeof bpm === 'number' && bpm > 0) return 60000 / bpm;
    if (!onsets || onsets.length < 3) return DEFAULT_BEAT_MS;
    const recent = onsets.slice(-9);
    const iois = [];
    for (let i = 1; i < recent.length; i++) iois.push(recent[i] - recent[i - 1]);
    const s = iois.slice().sort((a, b) => a - b);
    const h = s.length >> 1;
    const med = s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
    return clamp(med, MIN_BEAT_MS, MAX_BEAT_MS);
  }

  // ======================================================================
  // LAYOUT
  // ======================================================================
  const LEFT = 74; // x of the first note
  const SPACING = 52; // even mode
  const CLIP_X = 50; // notes slide under the clef from here

  function perPage(containerWidth) {
    const w = containerWidth || 360;
    return Math.max(4, Math.min(10, Math.floor((w - 60) / 44)));
  }

  // Even mode: the newest note (or `focus`) is the right-most of N visible notes.
  function layoutEven(count, N, focus = count - 1) {
    const offset = clamp(focus + 1 - N, 0, Math.max(0, count - N));
    return { offset, translate: -offset * SPACING, xOf: (i) => LEFT + i * SPACING, firstDrawn: Math.max(0, offset - 2) };
  }

  // Timed mode. entries: [{tOnset, off, place:{note}}]. Each note advances 36 + 14*beats. A 4/4 bar line
  // follows the item that reaches or crosses each multiple of 4 beats. Accidentals last until the bar
  // line; a return to the natural shows a natural sign ('n').
  // -> {items:[{kind:'note', idx, x, dur, beats, open, acc} | {kind:'rest', x, dur, beats}], bars:[x], endX, beatMs}
  function layoutTimed(entries, { beatMs = DEFAULT_BEAT_MS, now = 0, startX = LEFT, beatsPerBar = 4 } = {}) {
    const items = [];
    const bars = [];
    let x = startX;
    let cum = 0;
    let nextBar = beatsPerBar;
    let barAcc = {};
    let prevX = null;
    const advance = (beats) => 36 + 14 * beats;
    const checkBar = (itemX) => {
      if (cum >= nextBar - 1e-9) {
        bars.push((itemX + x) / 2 - 6);
        while (nextBar <= cum + 1e-9) nextBar += beatsPerBar;
        barAcc = {};
      }
    };
    entries.forEach((e, i) => {
      const last = i === entries.length - 1;
      const sound = e.off != null ? e.off - e.tOnset : null;
      const q = last ? provisional(now - e.tOnset, beatMs, sound) : quantize(entries[i + 1].tOnset - e.tOnset, beatMs, sound);
      const note = e.place.note;
      const want = note.acc || '';
      const had = barAcc[note.staffPos] || '';
      const acc = want !== had ? (want || 'n') : null;
      barAcc[note.staffPos] = want;
      const itemX = x;
      items.push({ kind: 'note', idx: i, x: itemX, dur: q.dur, beats: q.beats, open: last, acc });
      x += advance(q.beats);
      cum += q.beats;
      checkBar(itemX);
      q.rests.forEach((r) => {
        const rx = x;
        items.push({ kind: 'rest', x: rx, dur: r.dur, beats: r.beats });
        x += advance(r.beats);
        cum += r.beats;
        checkBar(rx);
      });
      prevX = itemX;
    });
    return { items, bars, endX: x, lastX: prevX, beatMs };
  }

  // ======================================================================
  // WORDING
  // ======================================================================
  const ACC_SYMBOL = { '#': '♯', b: '♭', '': '' };
  const noteName = (n) => n.letter + (ACC_SYMBOL[n.acc || ''] || '');
  const fullName = (n) => noteName(n) + (n.octave != null ? n.octave : Math.floor(n.midi / 12) - 1);
  const BADGE = { 1: '8va', 2: '15ma', '-1': '8vb', '-2': '15mb' };
  const badgeFor = (fold) => BADGE[fold] || null;

  // place: Notation.placeOnStaff result; prev: the previous note's place (or null).
  // -> {big:'F♯', small:'F♯4 · on the bottom line · a step up from E'}
  function describe(place, prev) {
    const heard = place.heard;
    const full = fullName(heard);
    const big = noteName(heard);
    if (place.zone === 'folded' && place.fold) {
      const f = place.fold;
      const how = Math.abs(f) === 2 ? 'two octaves' : 'an octave';
      const small = f < 0
        ? `${full} · lower than this staff shows, so it’s drawn ${how} up (${badgeFor(f)})`
        : `${full} · higher than this staff shows, so it’s drawn ${how} down (${badgeFor(f)})`;
      return { big, small };
    }
    const pos = Notation().describePosition(place.note);
    let small;
    const moved = Math.round((place.note.midi - heard.midi) / 12);
    if (moved) {
      const how = Math.abs(moved) === 2 ? 'two octaves' : 'an octave';
      small = `${full} · moved ${how} ${moved > 0 ? 'up' : 'down'} to fit, ${pos}`;
    } else if (heard.midi === 60) small = `${full} · middle C, ${pos}`;
    else small = `${full} · ${pos}`;
    if (prev) {
      const c = Shapes().classify(prev.note, place.note);
      small += c.kind === 'same' ? ' · the same note again' : ` · ${c.long} from ${noteName(prev.heard)}`;
    }
    return { big, small };
  }

  // ======================================================================
  // PLAY BACK
  // ======================================================================
  const PLAY_MAX = 64;

  // entries: the notes since Clear. -> [{midi, at (sec from start), dur}] for NS.audio.playEvents.
  // even: the real onset gaps, each clamped to 0.15..2.0 s; dur = min(gap * 0.92, 1.2); last note 0.8 s.
  // timed: the quantized beats (rests included) at beatMs.
  function playbackEvents(entries, { rhythm = 'even', beatMs = DEFAULT_BEAT_MS, now = 0 } = {}) {
    const list = entries.slice(-PLAY_MAX);
    const out = [];
    if (rhythm === 'timed') {
      const spb = beatMs / 1000;
      let beat = 0;
      const lay = layoutTimed(list, { beatMs, now });
      lay.items.forEach((it) => {
        if (it.kind === 'note') out.push({ midi: list[it.idx].midi, at: beat * spb, dur: Math.max(0.15, it.beats * spb * 0.92) });
        beat += it.beats;
      });
      return out;
    }
    let at = 0;
    list.forEach((e, i) => {
      const next = list[i + 1];
      if (!next) { out.push({ midi: e.midi, at, dur: 0.8 }); return; }
      const gap = clamp((next.tOnset - e.tOnset) / 1000, 0.15, 2.0);
      out.push({ midi: e.midi, at, dur: Math.min(gap * 0.92, 1.2) });
      at += gap;
    });
    return out;
  }

  // ======================================================================
  // "I KNOW THAT TUNE!"
  // ======================================================================
  // Interval in semitones folded to -5..+6, so the same tune in another octave still matches.
  const normIv = (d) => {
    const r = pc(d);
    return r > 6 ? r - 12 : r;
  };
  const ivs = (midis) => {
    const out = [];
    for (let i = 1; i < midis.length; i++) out.push(normIv(midis[i] - midis[i - 1]));
    return out;
  };

  // songs: NS.songs.all() (kind 'song' only), or NoteSongs.songs (scales left out when there's no kind).
  function buildIndex(songs) {
    return (songs || [])
      .filter((s) => s && s.notes && s.notes.length >= 2 && (s.kind ? s.kind === 'song' : !/^scale-/.test(s.id)))
      .map((s, order) => {
        const midis = s.notes.map((n) => n.midi);
        return {
          id: s.id, title: s.title, family: s.family || s.id, song: s, order,
          len: midis.length, midis, pcs: midis.map(pc), firstPc: pc(midis[0]), iv: ivs(midis),
        };
      });
  }

  const sameArr = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

  function createRecognizer(index, { prefer = 'sharp' } = {}) {
    let spell = prefer;
    let played = []; // midis since clear (the last 64)
    let total = 0; // notes since clear
    let announced = new Set(); // families announced since clear
    let follow = null; // {entry, pos, tr, misses}
    let lastScaleAt = -Infinity;

    const nameOf = (midi) => noteName(Notation().spellMidi(midi, spell));
    const songStart = (entry) => {
      const n = entry.song.notes[0];
      return n.acc != null && n.letter ? noteName(n) : nameOf(entry.midis[0]);
    };
    const progress = (f) => ({
      type: 'progress', song: f.entry.song, id: f.entry.id, pos: f.pos, total: f.entry.len, misses: f.misses,
      text: `${f.entry.title} · ${f.pos} of ${f.entry.len} notes`,
    });
    const complete = (entry) => ({
      type: 'complete', song: entry.song, id: entry.id, text: `You played all of ${entry.title}!`, small: 'From memory, too.',
    });

    function step(midi) {
      const f = follow;
      const want = (k) => k < f.entry.len && pc(midi) === pc(f.entry.midis[k] + f.tr);
      if (want(f.pos)) { f.pos += 1; f.misses = 0; }
      else if (want(f.pos + 1)) { f.pos += 2; f.misses = 0; } // one missed note is forgiven
      else {
        f.misses += 1;
        if (f.misses > 2) {
          follow = null;
          return [{ type: 'lost', song: f.entry.song, id: f.entry.id }];
        }
        return [progress(f)];
      }
      if (f.pos >= f.entry.len) {
        follow = null;
        return [complete(f.entry)];
      }
      return [progress(f)];
    }

    function detect() {
      const n = played.length;
      for (let L = Math.min(10, n); L >= 5; L--) {
        const win = played.slice(n - L);
        const wiv = ivs(win);
        const matches = index.filter((s) => s.len >= L && sameArr(s.iv.slice(0, L - 1), wiv));
        if (!matches.length) continue;
        const fams = [];
        matches.forEach((m) => { if (!fams.some((f) => f.family === m.family)) fams.push(m); });
        if (fams.length > 1) return []; // could be more than one tune: wait for more notes
        const s = fams[0];
        if (announced.has(s.family)) return [];
        const tr = normIv(pc(win[0]) - s.firstPc);
        if (L >= 7 || L === s.len) {
          announced.add(s.family);
          const from = nameOf(win[0]);
          const orig = songStart(s);
          const text = `You’re playing ${s.title}!` + (tr !== 0 ? ` (starting on ${from} instead of ${orig})` : '');
          const out = [{ type: 'found', song: s.song, id: s.id, L, tr, text, from, orig }];
          if (L >= s.len) out.push(complete(s));
          else follow = { entry: s, pos: L, tr, misses: 0 };
          return out;
        }
        return [{ type: 'hint', song: s.song, id: s.id, L, tr, text: `Sounds like ${s.title}…` }];
      }
      return [];
    }

    return {
      // One played note -> events: hint | found | progress | complete | lost | scale.
      push(midi) {
        played.push(midi);
        if (played.length > 64) played.shift();
        total += 1;
        let out = [];
        if (follow) out = step(midi);
        else out = detect();
        if (total - lastScaleAt >= 7) {
          const sc = detectScale(played.slice(-8), { prefer: spell });
          if (sc) { lastScaleAt = total; out.push(Object.assign({ type: 'scale' }, sc)); }
        }
        return out;
      },
      clear() { played = []; total = 0; announced = new Set(); follow = null; lastScaleAt = -Infinity; },
      following: () => (follow ? { song: follow.entry.song, id: follow.entry.id, pos: follow.pos, tr: follow.tr, misses: follow.misses } : null),
      setPrefer(p) { spell = p === 'flat' ? 'flat' : 'sharp'; },
      // Snapshot for Clear + Undo.
      state: () => ({ played: played.slice(), total, announced: [...announced], follow: follow ? Object.assign({}, follow) : null, lastScaleAt }),
      setState(s) {
        played = s.played.slice();
        total = s.total;
        announced = new Set(s.announced);
        follow = s.follow ? Object.assign({}, s.follow) : null;
        lastScaleAt = s.lastScaleAt;
      },
    };
  }

  // 8 notes, 7 diatonic steps (two half steps, not next to each other) in one direction, same pitch
  // class at both ends. -> {dir:'up'|'down', from, text} | null
  function detectScale(midis, { prefer = 'sharp' } = {}) {
    if (!midis || midis.length < 8) return null;
    const w = midis.slice(-8);
    const d = [];
    for (let i = 1; i < 8; i++) d.push(w[i] - w[i - 1]);
    const dir = Math.sign(d[0]);
    if (!dir || !d.every((x) => Math.sign(x) === dir && (Math.abs(x) === 1 || Math.abs(x) === 2))) return null;
    if (Math.abs(w[7] - w[0]) !== 12) return null;
    const halves = [];
    d.forEach((x, i) => { if (Math.abs(x) === 1) halves.push(i); });
    if (halves.length !== 2) return null;
    const gap = halves[1] - halves[0];
    if (gap === 1 || gap === 6) return null;
    const from = noteName(Notation().spellMidi(w[0], prefer));
    return {
      dir: dir > 0 ? 'up' : 'down',
      from,
      text: dir > 0 ? `That’s a whole scale, ${from} to ${from}!` : `That’s a whole scale going down, ${from} to ${from}!`,
    };
  }

  // ======================================================================
  // LIVE SCROLLING STAFF (browser only)
  // Geometry from spec §2.4.7: STEP 6, bottom line y 108, notes from x 74, labels at y 162,
  // height 172 (200 with the shape band), 8va / 8vb badges at y 14 / 158.
  // ======================================================================
  const STEP = 6;
  const BOTTOM = 108;
  const LABEL_Y = 162;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const SHAPE_RISE = { half: 1.5, step: 3, skip: 5.5, leap: 8 };
  const MAX_NOTES = 200;
  let uid = 0;

  // opts: {labels:'on'|'quiz'|'off', prefer:'sharp'|'flat', octave:'heard'|'fold', shapes:boolean,
  //        rhythm:'even'|'timed', bpm:'auto'|number, maxNotes, onTapNote(entry, index), emptyText}
  function createLiveStaff(svg, opts = {}) {
    const doc = svg.ownerDocument;
    const o = Object.assign({
      labels: 'on', prefer: 'sharp', octave: 'heard', shapes: true, rhythm: 'even', bpm: 'auto',
      maxNotes: MAX_NOTES, onTapNote: null, emptyText: 'Your notes will appear here',
    }, opts);
    const clipId = 'fp-clip-' + (++uid);
    let entries = [];
    let nextId = 1;
    let playing = null;
    let dims = null; // {N, width, height}
    let track = null;
    let emptyEl = null;
    let openTimer = null;
    let labelTimer = null;
    let destroyed = false;
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

    function mk(tag, attrs, parent) {
      const e = doc.createElementNS(SVGNS, tag);
      for (const k in attrs) e.setAttribute(k, attrs[k]);
      if (parent) parent.appendChild(e);
      return e;
    }
    const y = (staffPos) => BOTTOM - staffPos * STEP;
    const place = (midi) => Notation().placeOnStaff(midi, { mode: o.octave === 'fold' ? 'fold' : 'heard', prefer: o.prefer });

    function measure() {
      const w = (svg.parentElement && svg.parentElement.clientWidth) || 360;
      const N = (root.NS && root.NS.staff && root.NS.staff.perPage) ? root.NS.staff.perPage(w) : perPage(w);
      return { N, width: LEFT + N * SPACING + 10, height: o.shapes ? 200 : 172 };
    }

    // Staff lines, clef and the clipped track. Rebuilt only when the size changes.
    function build(d) {
      svg.innerHTML = '';
      svg.setAttribute('viewBox', `0 0 ${d.width} ${d.height}`);
      const defs = mk('defs', {}, svg);
      const cp = mk('clipPath', { id: clipId }, defs);
      mk('rect', { x: CLIP_X, y: 0, width: d.width - CLIP_X - 4, height: d.height }, cp);
      for (let i = 0; i < 5; i++) {
        const l = mk('line', { x1: 4, x2: d.width - 4, y1: y(i * 2), y2: y(i * 2), 'stroke-width': 1.2, class: 'fp-line' }, svg);
        l.style.stroke = 'var(--muted)';
      }
      const clef = mk('text', { x: 6, y: BOTTOM - 4, 'font-size': 76, 'font-family': 'Noto Music, Bravura, Apple Symbols, serif', 'aria-hidden': 'true' }, svg);
      clef.style.fill = 'var(--ink)';
      clef.textContent = '𝄞';
      const wrap = mk('g', { 'clip-path': `url(#${clipId})` }, svg);
      track = mk('g', { class: 'fp-track' }, wrap);
      emptyEl = mk('text', { x: (CLIP_X + d.width) / 2, y: 88, 'text-anchor': 'middle', 'font-size': 14, class: 'fp-empty' }, svg);
      emptyEl.style.fill = 'var(--muted)';
      emptyEl.textContent = o.emptyText;
    }

    // ---------- glyphs (all drawn in currentColor) ----------
    function drawAccidental(g, kind, x, cy) {
      const cx = x - 17;
      if (kind === '#') {
        const p = mk('path', {
          class: 'fp-acc', 'data-acc': 'sharp',
          d: `M${cx - 3} ${cy - 9}h1.3v19h-1.3z M${cx + 1.7} ${cy - 10}h1.3v19h-1.3z ` +
             `M${cx - 5.5} ${cy - 1.2}L${cx + 5.5} ${cy - 4.2}v-2.6L${cx - 5.5} ${cy - 3.8}z ` +
             `M${cx - 5.5} ${cy + 5.8}L${cx + 5.5} ${cy + 2.8}v-2.6L${cx - 5.5} ${cy + 3.2}z`,
        }, g);
        p.style.fill = 'currentColor';
      } else if (kind === 'b') {
        const p = mk('path', {
          class: 'fp-acc', 'data-acc': 'flat', fill: 'none', 'stroke-width': 1.6, 'stroke-linejoin': 'round',
          d: `M${cx - 3} ${cy - 15}V${cy + 5} C${cx + 1} ${cy + 2.5} ${cx + 5} ${cy} ${cx + 5} ${cy - 3} C${cx + 5} ${cy - 6} ${cx + 1} ${cy - 6.5} ${cx - 3} ${cy - 2.5}`,
        }, g);
        p.style.stroke = 'currentColor';
      } else if (kind === 'n') {
        const p = mk('path', {
          class: 'fp-acc', 'data-acc': 'natural',
          d: `M${cx - 3.2} ${cy - 11}h1.3v16h-1.3z M${cx + 1.9} ${cy - 5}h1.3v16h-1.3z ` +
             `M${cx - 3.2} ${cy - 1.2}L${cx + 3.2} ${cy - 3.4}v-2.4L${cx - 3.2} ${cy - 3.6}z ` +
             `M${cx - 3.2} ${cy + 5.6}L${cx + 3.2} ${cy + 3.4}v-2.4L${cx - 3.2} ${cy + 3.2}z`,
        }, g);
        p.style.fill = 'currentColor';
      }
    }

    function drawRest(parent, x, dur) {
      const g = mk('g', { class: 'fp-rest', 'data-dur': dur }, parent);
      g.style.color = 'var(--ink)';
      if (dur === 'w') {
        const r = mk('rect', { x: x - 7, y: y(6), width: 14, height: 5 }, g);
        r.style.fill = 'currentColor';
      } else if (dur === 'h') {
        const r = mk('rect', { x: x - 7, y: y(4) - 5, width: 14, height: 5 }, g);
        r.style.fill = 'currentColor';
      } else {
        const p = mk('path', {
          fill: 'none', 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
          d: `M${x - 2} ${y(7)}L${x + 3} ${y(5.6)}L${x - 2} ${y(4.4)}L${x + 3} ${y(3)}C${x - 3} ${y(2.6)} ${x - 3} ${y(1.4)} ${x + 1} ${y(1.2)}`,
        }, g);
        p.style.stroke = 'currentColor';
      }
      return g;
    }

    // One played note at x. info: {acc (to draw, or null), dur, color, opacity, column, label, labelClass}
    function drawEntry(i, x, info) {
      const e = entries[i];
      const pl = e.place;
      const note = pl.note;
      const ny = y(note.staffPos);
      const g = mk('g', { class: 'fp-note', 'data-i': i, 'data-midi': e.midi, 'data-zone': pl.zone, 'data-dur': info.dur }, track);
      if (info.state) g.setAttribute('data-state', info.state);
      g.style.color = info.color;
      if (info.opacity != null && info.opacity < 1) g.setAttribute('opacity', info.opacity);
      if (info.column) {
        const r = mk('rect', { x: x - 22, y: 24, width: 44, height: 130, rx: 10, class: 'fp-col' }, g);
        r.style.fill = info.column;
      }
      // a wide transparent hit area, so a tap anywhere in the column plays the note
      const hit = mk('rect', { x: x - 24, y: 0, width: 48, height: dims.height, class: 'fp-hit' }, g);
      hit.style.fill = 'transparent';
      for (let p = -2; p >= note.staffPos; p -= 2) {
        mk('line', { x1: x - 12, x2: x + 12, y1: y(p), y2: y(p), stroke: 'currentColor', 'stroke-width': 1.4 }, g);
      }
      for (let p = 10; p <= note.staffPos; p += 2) {
        mk('line', { x1: x - 12, x2: x + 12, y1: y(p), y2: y(p), stroke: 'currentColor', 'stroke-width': 1.4 }, g);
      }
      if (info.acc) drawAccidental(g, info.acc, x, ny);
      const kind = info.dur[0];
      const hollow = kind === 'h' || kind === 'w';
      const head = mk('ellipse', {
        class: 'fp-head', cx: x, cy: ny, rx: 7.2, ry: 5.2, transform: `rotate(-20 ${x} ${ny})`,
        stroke: 'currentColor', 'stroke-width': hollow ? 2 : 1,
      }, g);
      head.style.fill = hollow ? 'var(--card)' : 'currentColor';
      if (kind !== 'w') {
        const up = note.staffPos < 4;
        const sx = up ? x + 6.4 : x - 6.4;
        const tip = up ? ny - 36 : ny + 36;
        mk('line', { x1: sx, x2: sx, y1: up ? ny - 1 : ny + 1, y2: tip, stroke: 'currentColor', 'stroke-width': 1.6 }, g);
        if (kind === 'e') {
          const d = up ? `M${sx} ${tip} c1 6 9 9 8 18 c-1-6-5-9-8-10 z` : `M${sx} ${tip} c1-6 9-9 8-18 c-1 6-5 9-8 10 z`;
          const flag = mk('path', { d, stroke: 'currentColor', 'stroke-width': 1 }, g);
          flag.style.fill = 'currentColor';
        }
      }
      if (info.dur.endsWith('.')) {
        const dot = mk('circle', { cx: x + 12, cy: note.staffPos % 2 === 0 ? ny - STEP : ny, r: 1.9 }, g);
        dot.style.fill = 'currentColor';
      }
      const badge = pl.zone === 'folded' ? badgeFor(pl.fold) : null;
      if (badge) {
        const high = pl.fold > 0;
        const t = mk('text', {
          class: 'fp-badge', 'data-badge': badge, x, y: high ? 14 : 158, 'text-anchor': 'middle',
          'font-size': 11, 'font-weight': 700, 'font-style': 'italic', 'font-family': 'Atkinson Hyperlegible, system-ui, sans-serif',
        }, g);
        t.style.fill = 'currentColor';
        t.textContent = badge;
      } else if (pl.zone === 'ledger') {
        const high = note.staffPos > 8;
        const cy = high ? 18 : 152;
        const p = mk('path', {
          class: 'fp-caret', fill: 'none', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
          d: high ? `M${x - 4} ${cy + 2}L${x} ${cy - 2}L${x + 4} ${cy + 2}` : `M${x - 4} ${cy - 2}L${x} ${cy + 2}L${x + 4} ${cy - 2}`,
        }, g);
        p.style.stroke = 'var(--muted)';
      }
      if (info.label) {
        const t = mk('text', {
          class: 'fp-label' + (info.labelClass ? ' ' + info.labelClass : ''), x,
          y: badge && pl.fold < 0 ? 168 : LABEL_Y, 'text-anchor': 'middle', 'font-size': 15, 'font-weight': 700,
          'font-family': 'Atkinson Hyperlegible, system-ui, sans-serif',
        }, g);
        t.style.fill = 'currentColor';
        t.textContent = noteName(pl.heard);
      }
      if (o.onTapNote) {
        g.style.cursor = 'pointer';
        g.addEventListener('click', () => o.onTapNote(entries[i], i));
      }
      return g;
    }

    // Shape hint between two drawn notes (always level 2 here: arrow plus word). Spec §3.5 geometry.
    function drawShape(parent, xA, a, xB, b, emphasis) {
      const c = Shapes().classify(a, b);
      const g = mk('g', { class: 'fp-shape', 'data-kind': c.kind, 'aria-hidden': 'true' }, parent);
      g.style.color = emphasis ? 'var(--accent)' : 'var(--shape)';
      const mx = (xA + xB) / 2;
      const yc = 180;
      if (c.kind === 'same') {
        [-2, 2].forEach((dy) => mk('line', { x1: mx - 7, x2: mx + 7, y1: yc + dy, y2: yc + dy, stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' }, g));
      } else {
        const r = SHAPE_RISE[c.kind] || 8;
        const up = c.dir > 0;
        const x1 = mx - 9;
        const x2 = mx + 9;
        const y1 = up ? yc + r : yc - r;
        const y2 = up ? yc - r : yc + r;
        mk('line', { x1, y1, x2, y2, stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' }, g);
        const len = Math.hypot(x2 - x1, y2 - y1);
        const ux = (x2 - x1) / len;
        const uy = (y2 - y1) / len;
        const bx = x2 - ux * 5;
        const by = y2 - uy * 5;
        mk('polyline', {
          points: `${bx - uy * 3.5},${by + ux * 3.5} ${x2},${y2} ${bx + uy * 3.5},${by - ux * 3.5}`,
          fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        }, g);
      }
      const t = mk('text', { x: mx, y: 195, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, 'font-family': 'Atkinson Hyperlegible, system-ui, sans-serif' }, g);
      t.style.fill = 'currentColor';
      t.textContent = c.short;
    }

    function labelShown(e, i, t) {
      if (e.showUntil && e.showUntil > t) return true;
      if (o.labels === 'on') return true;
      if (o.labels === 'quiz') return e.revealed !== false;
      return false;
    }

    function render({ instant = false } = {}) {
      if (destroyed) return;
      const d = measure();
      if (!dims || d.N !== dims.N || d.width !== dims.width || d.height !== dims.height || !track || !svg.contains(track)) {
        dims = d;
        build(d);
        instant = true;
      }
      track.classList.toggle('fp-instant', instant);
      if (instant) void track.getBoundingClientRect(); // apply the "no transition" class before moving
      track.innerHTML = '';
      emptyEl.style.display = entries.length ? 'none' : '';
      const n = entries.length;
      const t = now();
      const newest = n - 1;
      const drawn = []; // [{i, x}]
      let translate = 0;
      let soonest = Infinity;
      const colorOf = (i) => (playing === i ? 'var(--listen)' : playing == null && i === newest ? 'var(--accent)' : 'var(--ink)');
      const columnOf = (i) => (playing === i ? 'var(--listen-soft)' : playing == null && i === newest ? 'var(--accent-soft)' : null);
      const stateOf = (i) => (playing === i ? 'playing' : playing == null && i === newest ? 'newest' : 'old');
      const labelInfo = (i) => {
        const e = entries[i];
        const show = labelShown(e, i, t);
        if (e.showUntil && e.showUntil > t) soonest = Math.min(soonest, e.showUntil);
        return { label: show, labelClass: show && e.justRevealed ? 'fp-reveal' : '' };
      };

      if (o.rhythm === 'timed') {
        const beatMs = estimateBeatMs(entries.map((e) => e.tOnset), o.bpm);
        const lay = layoutTimed(entries, { beatMs, now: t });
        const focusItem = lay.items.find((it) => it.kind === 'note' && it.idx === (playing != null ? playing : newest));
        const focusX = focusItem ? focusItem.x : LEFT;
        const scroll = Math.max(0, focusX - (d.width - 60));
        translate = -scroll;
        lay.bars.forEach((bx) => {
          if (bx < scroll + CLIP_X - 10 || bx > scroll + d.width) return;
          const l = mk('line', { class: 'fp-bar', x1: bx, x2: bx, y1: y(8), y2: y(0), 'stroke-width': 1.2 }, track);
          l.style.stroke = 'var(--muted)';
        });
        lay.items.forEach((it) => {
          if (it.x < scroll - 110 || it.x > scroll + d.width + 30) return;
          if (it.kind === 'rest') { drawRest(track, it.x, it.dur); return; }
          const i = it.idx;
          drawEntry(i, it.x, Object.assign({
            acc: it.acc === '' ? null : it.acc, dur: it.dur, color: colorOf(i), column: columnOf(i), state: stateOf(i),
            opacity: it.open ? 0.85 : 1,
          }, labelInfo(i)));
          drawn.push({ i, x: it.x });
        });
      } else {
        const lay = layoutEven(n, d.N, playing != null ? playing : newest);
        translate = lay.translate;
        for (let i = lay.firstDrawn; i < n; i++) {
          const x = lay.xOf(i);
          const opacity = lay.offset > 0 && i === lay.offset ? 0.55 : lay.offset > 0 && i === lay.offset + 1 ? 0.8 : 1;
          drawEntry(i, x, Object.assign({
            acc: entries[i].place.note.acc || null, dur: 'q', color: colorOf(i), column: columnOf(i), state: stateOf(i), opacity,
          }, labelInfo(i)));
          drawn.push({ i, x });
        }
      }

      if (o.shapes && drawn.length > 1) {
        const band = mk('g', { class: 'fp-shapes', 'aria-hidden': 'true' }, track);
        for (let k = 1; k < drawn.length; k++) {
          const A = drawn[k - 1];
          const B = drawn[k];
          if (B.i !== A.i + 1) continue;
          drawShape(band, A.x, entries[A.i].place.note, B.x, entries[B.i].place.note, B.i === (playing != null ? playing : newest));
        }
      }
      track.style.transform = `translateX(${translate}px)`;
      entries.forEach((e) => { e.justRevealed = false; });

      // Re-render when a tapped label should hide again.
      clearTimeout(labelTimer);
      if (soonest < Infinity) labelTimer = setTimeout(() => render({ instant: true }), Math.max(20, soonest - t + 10));
      // Timed mode: the open note grows while held; re-evaluate every 100 ms.
      const wantOpen = o.rhythm === 'timed' && n > 0 && playing == null;
      if (wantOpen && !openTimer) openTimer = setInterval(() => render({ instant: true }), 100);
      if (!wantOpen && openTimer) { clearInterval(openTimer); openTimer = null; }
    }

    function makeEntry(midi, info = {}) {
      const t = info.tOnset != null ? info.tOnset : now();
      return {
        id: nextId++, midi, at: info.at != null ? info.at : null, tOnset: t, off: null,
        source: info.source || 'screen', place: place(midi), revealed: o.labels !== 'quiz', showUntil: 0,
      };
    }

    const L = {
      push(midi, info) {
        const e = makeEntry(midi, info);
        entries.push(e);
        if (entries.length > o.maxNotes) entries.splice(0, entries.length - o.maxNotes);
        render();
        return e;
      },
      // A 'quiet' after the onset of the newest note: the note has ended.
      noteOff(tOnset) {
        const e = entries[entries.length - 1];
        if (e && e.off == null && tOnset > e.tOnset) { e.off = tOnset; if (o.rhythm === 'timed') render({ instant: true }); }
      },
      clear() {
        const old = entries;
        entries = [];
        playing = null;
        render();
        return old;
      },
      restore(list) {
        entries = (list || []).slice();
        entries.forEach((e) => { e.place = place(e.midi); });
        playing = null;
        render({ instant: true });
      },
      entries: () => entries.slice(),
      count: () => entries.length,
      last: () => entries[entries.length - 1] || null,
      options: () => Object.assign({}, o),
      setOptions(part) {
        const replace = ('octave' in part && part.octave !== o.octave) || ('prefer' in part && part.prefer !== o.prefer);
        if ('labels' in part && part.labels !== o.labels) entries.forEach((e) => { e.revealed = true; });
        Object.assign(o, part);
        if (replace) entries.forEach((e) => { e.place = place(e.midi); });
        render({ instant: true });
      },
      setPlaying(i) { playing = i == null ? null : i; render(); },
      // Quiz: show the label of note i (with a fade).
      reveal(i) {
        const e = entries[i];
        if (!e || e.revealed) return;
        e.revealed = true;
        e.justRevealed = true;
        render({ instant: true });
      },
      // Show note i's label for ms (a tap on the staff).
      showLabel(i, ms = 2000) {
        const e = entries[i];
        if (!e) return;
        e.showUntil = now() + ms;
        render({ instant: true });
      },
      beatMs: () => estimateBeatMs(entries.map((e) => e.tOnset), o.bpm),
      render,
      destroy() {
        destroyed = true;
        clearInterval(openTimer);
        clearTimeout(labelTimer);
        openTimer = null;
        svg.innerHTML = '';
      },
    };
    render({ instant: true });
    return L;
  }

  const api = {
    GRID, GRID_DUR, LEFT, SPACING, MAX_NOTES, PLAY_MAX,
    nearestGrid, quantize, provisional, estimateBeatMs,
    perPage, layoutEven, layoutTimed,
    noteName, fullName, badgeFor, describe,
    playbackEvents,
    normIv, buildIndex, createRecognizer, detectScale,
    createLiveStaff,
  };
  if (isNode) module.exports = api;
  else (root.NS = root.NS || {}).FreeCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
