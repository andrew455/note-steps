// Perform mode: the song scrolls right-to-left past a play line in time, Guitar Hero style.
// Self-contained: it adds its own screen and results dialog to the page, and talks to the rest of
// the app only through window.NoteSteps (see app.js). Load after app.js; styles are in perform.css.
(function () {
  const NS = window.NoteSteps;
  const { $, svgEl, fmt, starText, store, saveStore, songs, STEP, BOTTOM } = NS;
  const { midiName } = window.Pitch;

  // Progress kept by this mode (all in the shared store, so it lives in localStorage).
  store.perf = store.perf || {}; // { [songId]: { [speed]: { score, accuracy, stars, maxCombo, at } } }
  if (store.speed == null) store.speed = 75;
  if (store.clickTrack == null) store.clickTrack = true;
  if (store.latency === undefined) store.latency = null; // seconds from playing a key to the mic hearing it

  const SPEEDS = [50, 75, 100];
  const PERFECT = 0.08; // seconds either side of the beat
  const GOOD = 0.18;
  const MIC_DECISION = 0.65; // the mic can take this long to name a note after it starts (500 ms fallback + ticks + onset lag)
  const PLAY_X = 108; // x of the play line, in the track's own units
  const CLIP_X = 74; // notes disappear behind the clef from here

  // ---------- markup ----------
  document.body.insertAdjacentHTML('beforeend', `
<main class="wrap screen" id="perform" hidden>
  <div class="topbar">
    <button class="back" id="pBackBtn" aria-label="Back to lessons">←</button>
    <div class="title">
      <span class="eyebrow" id="pEyebrow">Perform</span>
      <h2 id="pTitle"></h2>
    </div>
    <div class="score-box"><span class="eyebrow">Score</span><strong id="pScore">0</strong></div>
  </div>
  <div class="progress"><div id="pProgress"></div></div>

  <div class="staff-card track-card">
    <svg id="track" role="img" aria-label="Scrolling music staff. Play each note as it reaches the blue line."></svg>
    <div class="countin" id="countIn" aria-hidden="true" hidden></div>
  </div>

  <div class="hud" id="judge" aria-live="polite">
    <span class="big" id="judgeBig"></span>
    <span class="small" id="judgeSmall"></span>
    <span class="combo" id="combo"></span>
  </div>

  <section class="panel" id="readyPanel">
    <div class="speed-row">
      <span class="eyebrow" id="speedLabel">Speed</span>
      <div class="speed" id="speedPick" role="radiogroup" aria-labelledby="speedLabel">
        ${SPEEDS.map((s) => `<button role="radio" data-speed="${s}" aria-checked="false">${s}%</button>`).join('')}
      </div>
      <p class="muted small-text" id="speedNote"></p>
    </div>
    <div class="controls">
      <button class="btn primary" id="startBtn">▶ Start</button>
      <button class="btn" id="calBtn">Set up timing</button>
    </div>
    <div class="controls">
      <button class="btn on" id="clickBtn" aria-pressed="true">Click track: on</button>
      <button class="btn on" id="pNamesBtn" data-names-toggle aria-pressed="true">Note names: on</button>
    </div>
    <p class="muted small-text" id="latencyNote"></p>
  </section>

  <section class="panel" id="playingPanel" hidden>
    <div class="controls">
      <button class="btn" id="stopBtn">■ Stop</button>
      <div class="meter" data-mic-meter-wrap hidden><span>Mic</span><div class="bar"><div data-mic-meter></div></div></div>
    </div>
  </section>

  <section class="panel" id="calPanel" hidden>
    <h3>Set up timing</h3>
    <p id="calText"></p>
    <div class="cal-dots" id="calDots" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
    <div class="controls">
      <button class="btn primary" id="calDoneBtn" hidden>Done</button>
      <button class="btn" id="calAgainBtn" hidden>Try again</button>
      <button class="btn" id="calCancelBtn">Cancel</button>
    </div>
  </section>
  <p class="notice" data-mic-notice hidden></p>

  <div>
    <div class="keyboard" id="pKeyboard" aria-label="On-screen keyboard. Tap a key to play it."></div>
    <p class="muted" style="font-size:0.85rem;margin-top:8px">No piano nearby? Tap these keys in time instead. Any octave counts.</p>
  </div>
</main>

<div class="overlay" id="resultOverlay" hidden>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="rTitle">
    <div class="stars" id="rStars">★★★</div>
    <span class="badge" id="rNewBest" hidden>New best!</span>
    <h2 id="rTitle">Nicely done!</h2>
    <div class="stat-grid">
      <div class="stat"><strong id="rScore">0</strong><span>Score</span></div>
      <div class="stat"><strong id="rAccuracy">0%</strong><span>Accuracy</span></div>
      <div class="stat"><strong id="rCombo">0</strong><span>Longest combo</span></div>
      <div class="stat"><strong id="rBest">0</strong><span>Best at this speed</span></div>
    </div>
    <p class="muted" id="rBreakdown"></p>
    <p class="unlock" id="rUnlock" hidden></p>
    <div class="row">
      <button class="btn" id="rAgainBtn">Play again</button>
      <button class="btn primary" id="rNextBtn">Next song</button>
    </div>
    <button class="btn" id="rListBtn">All songs</button>
  </div>
</div>`);

  // ---------- progress ----------
  function bestPerf(id) {
    const bySpeed = store.perf[id] || {};
    let best = null;
    for (const sp in bySpeed) {
      const r = bySpeed[sp];
      if (!best || r.stars > best.stars || (r.stars === best.stars && r.score > best.score)) best = { ...r, speed: Number(sp) };
    }
    return best;
  }

  // ---------- state ----------
  // perf.state: 'ready' | 'countin' | 'playing' | 'cal'
  let perf = null;
  let perfTimer = null;
  let perfRaf = null;

  // With a USB keyboard the notes arrive exactly, so the mic (and its timing setup) isn't needed.
  const usbOn = () => Boolean(window.NS && window.NS.midi && window.NS.midi.isOn());

  function latency() {
    return store.latency != null ? store.latency : NS.outLatency() + 0.04;
  }

  function open(i) {
    const song = songs[i];
    perf = { song, state: 'ready' };
    NS.showScreen('perform');
    NS.setNoteHandler((midi, at, tOnset, src) => heard(midi, at, src === 'midi' ? 'tap' : 'mic'));
    $('pEyebrow').textContent = `Perform · lesson ${i + 1} of ${songs.length}`;
    $('pTitle').textContent = song.title;
    resetRun();
    renderReady();
    buildTrack();
    setJudge('ready', 'Ready when you are', 'Press Start. You’ll hear a count-in, then play each note as it reaches the blue line.');
  }

  function resetRun() {
    perf.notes = perf.song.notes.map((n) => ({ ...n, judged: null, dt: null, el: null }));
    perf.score = 0;
    perf.combo = 0;
    perf.maxCombo = 0;
    perf.counts = { perfect: 0, good: 0, miss: 0, wrong: 0 };
    $('pScore').textContent = '0';
    $('pProgress').style.width = '0%';
    $('combo').textContent = '';
  }

  function renderReady() {
    const song = perf.song;
    const speed = store.speed;
    document.querySelectorAll('#speedPick [data-speed]').forEach((b) => {
      const on = Number(b.dataset.speed) === speed;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    const best = (store.perf[song.id] || {})[speed];
    const bpm = Math.round((song.bpm * speed) / 100);
    $('speedNote').textContent = `${bpm} beats per minute. ` +
      (best ? `Your best at ${speed}%: ${fmt(best.score)} points, ${best.accuracy}% accuracy, ${starText(best.stars)}.` : `No score yet at ${speed}% speed.`);
    const ct = $('clickBtn');
    ct.textContent = `Click track: ${store.clickTrack ? 'on' : 'off'}`;
    ct.classList.toggle('on', store.clickTrack);
    ct.setAttribute('aria-pressed', String(store.clickTrack));
    $('calBtn').hidden = usbOn();
    $('latencyNote').textContent = usbOn()
      ? 'USB keyboard connected: timing is exact, no setup needed.'
      : store.latency != null
      ? `Timing is set up (${Math.round(store.latency * 1000)} ms mic delay).`
      : 'Timing isn’t set up yet. Do “Set up timing” once so the app knows your phone’s mic delay.';
    NS.updateNamesButtons();
    setPanel('ready');
  }

  function setPanel(which) {
    $('readyPanel').hidden = which !== 'ready';
    $('playingPanel').hidden = which !== 'playing';
    $('calPanel').hidden = which !== 'cal';
  }

  function setJudge(kind, big, small) {
    $('judge').className = 'hud ' + kind;
    $('judgeBig').textContent = big;
    $('judgeSmall').textContent = small || '';
  }

  // ---------- the scrolling track ----------
  function pxPerBeat(song) {
    const shortest = Math.min(...song.notes.map((n) => n.beats));
    return Math.max(72, 30 / shortest);
  }

  // One full bar of clicks, plus the beats before a pickup note.
  function countInBeats(song) {
    return song.beatsPerBar + ((song.beatsPerBar - (song.pickup || 0)) % song.beatsPerBar);
  }

  function buildTrack() {
    const song = perf.song;
    const svg = $('track');
    svg.innerHTML = '';
    const W = Math.max(300, Math.round(svg.parentElement.clientWidth - 8));
    svg.setAttribute('viewBox', `0 0 ${W} 156`);
    perf.ppb = pxPerBeat(song);

    const defs = svgEl('defs', {}, svg);
    const clip = svgEl('clipPath', { id: 'trackClip' }, defs);
    svgEl('rect', { x: CLIP_X, y: 0, width: W - CLIP_X, height: 156 }, clip);

    const band = svgEl('rect', { id: 'playBand', x: PLAY_X - 20, y: 22, width: 40, height: 118, rx: 10 }, svg);
    band.style.fill = 'var(--accent-soft)';
    NS.drawStaffLines(svg, 4, W - 4);
    const pl = svgEl('line', { x1: PLAY_X, x2: PLAY_X, y1: 26, y2: 136, 'stroke-width': 2.5, 'stroke-linecap': 'round' }, svg);
    pl.style.stroke = 'var(--accent)';

    const clipG = svgEl('g', { 'clip-path': 'url(#trackClip)' }, svg);
    const tg = svgEl('g', {}, clipG);
    const ppb = perf.ppb;
    // bar lines, midway between the last note of a bar (flags and dots included) and the next downbeat
    for (let b = song.pickup || song.beatsPerBar; b < song.endBeat - 0.01; b += song.beatsPerBar) {
      const before = perf.notes.filter((n) => n.beat < b - 1e-6).pop();
      const left = before ? before.beat * ppb + NS.noteRightEdge(before) : b * ppb - 26;
      const x = (left + b * ppb - 12) / 2;
      const bl = svgEl('line', { x1: x, x2: x, y1: BOTTOM - 8 * STEP, y2: BOTTOM, 'stroke-width': 1.2 }, tg);
      bl.style.stroke = 'var(--muted)';
    }
    const endX = song.endBeat * ppb;
    [0, 5].forEach((dx, j) => {
      const e = svgEl('line', { x1: endX + dx, x2: endX + dx, y1: BOTTOM - 8 * STEP, y2: BOTTOM, 'stroke-width': j ? 4 : 1.2 }, tg);
      e.style.stroke = 'var(--muted)';
    });
    perf.notes.forEach((n) => {
      const g = svgEl('g', { class: 'pn' }, tg);
      NS.drawNote(g, n.beat * ppb, n, store.names);
      n.el = g;
      if (n.judged) g.classList.add(n.judged);
    });
    perf.trackEl = tg;
    markNext();
    // Before Start, show the opening notes just past the line so you can read ahead.
    placeTrack(perf.state === 'ready' ? -0.75 : (NS.heardAt() - perf.t0) / perf.spb);
  }

  function placeTrack(songBeat) {
    if (perf && perf.trackEl) perf.trackEl.setAttribute('transform', `translate(${PLAY_X - songBeat * perf.ppb} 0)`);
  }

  function markNext() {
    let found = false;
    perf.notes.forEach((n) => {
      const isNext = !found && !n.judged;
      if (isNext) found = true;
      if (n.el) n.el.classList.toggle('next', isNext);
    });
  }

  // ---------- running a song ----------
  // Start and Set up timing both wait for the mic; only one may run at a time.
  function setWaiting(on) {
    $('startBtn').disabled = on;
    $('calBtn').disabled = on;
  }

  async function start() {
    const p = perf;
    if (!p || p.state !== 'ready' || $('startBtn').disabled) return;
    const ac = NS.audio();
    setWaiting(true);
    if (!usbOn()) await NS.startMic(); // taps still work if the mic can't start
    setWaiting(false);
    if (perf !== p || p.state !== 'ready' || $('perform').hidden) return;
    $('resultOverlay').hidden = true;
    const song = perf.song;
    resetRun();
    perf.speed = store.speed;
    perf.spb = 60 / ((song.bpm * perf.speed) / 100);
    perf.countIn = countInBeats(song);
    perf.countStart = ac.currentTime + 0.35;
    perf.t0 = perf.countStart + perf.countIn * perf.spb;
    perf.nextClick = 0;
    perf.lastClick = perf.countIn + Math.ceil(song.endBeat) - 1;
    perf.clicks = [];
    perf.useMic = NS.isListening();
    perf.state = 'countin';
    buildTrack();
    setPanel('playing');
    const extra = perf.countIn - song.beatsPerBar;
    setJudge('ready', 'Get ready…', extra
      ? `Count-in: ${perf.countIn} clicks. One bar of ${song.beatsPerBar}, then ${extra} more before the first note.`
      : `Count-in: ${perf.countIn} clicks, then the first note.`);
    clearInterval(perfTimer);
    perfTimer = setInterval(tick, 20);
    tick();
    cancelAnimationFrame(perfRaf);
    perfRaf = requestAnimationFrame(frame);
  }

  // Stops the song or timing setup. Clicks already queued with the audio clock are cancelled too.
  function stop() {
    clearInterval(perfTimer);
    cancelAnimationFrame(perfRaf);
    perfTimer = null;
    $('countIn').hidden = true;
    if (!perf) return;
    (perf.clicks || []).forEach((o) => { try { o.stop(); } catch {} });
    perf.clicks = [];
    if (perf.state !== 'ready') {
      perf.state = 'ready';
      perf.cal = null;
    }
  }

  function scheduleClicks(now) {
    const song = perf.song;
    while (perf.nextClick <= perf.lastClick) {
      const t = perf.countStart + perf.nextClick * perf.spb;
      if (t > now + 0.15) break;
      const k = perf.nextClick;
      perf.nextClick++;
      if (t < now - 0.02) continue;
      if (k >= perf.countIn && !store.clickTrack) continue;
      perf.clicks.push(NS.click(t, k % song.beatsPerBar === 0));
      if (perf.clicks.length > 8) perf.clicks.shift();
    }
  }

  // Song position in seconds. Mic onsets are audio-clock input times, so the mic delay comes off;
  // taps are already 'heard' times (what you heard when you tapped).
  function songSecFor(at, source) {
    return at - (source === 'mic' ? latency() : 0) - perf.t0;
  }

  function tick() {
    if (!perf) return;
    const now = NS.audio().currentTime;
    if (perf.state === 'cal') return calTick(now);
    if (perf.state !== 'countin' && perf.state !== 'playing') return;
    scheduleClicks(now);
    const heardNow = NS.heardAt();
    if (perf.state === 'countin' && heardNow >= perf.t0) perf.state = 'playing';

    // Notes nobody played become misses once the mic has had time to report them.
    const songNow = perf.useMic ? songSecFor(now, 'mic') : songSecFor(heardNow, 'tap');
    const grace = perf.useMic ? MIC_DECISION : 0.03;
    perf.notes.forEach((n) => {
      if (!n.judged && n.beat * perf.spb + GOOD + grace < songNow) judge(n, 'miss', null);
    });

    const last = perf.notes[perf.notes.length - 1];
    const endSec = Math.max(perf.song.endBeat * perf.spb - perf.spb, last.beat * perf.spb + 0.6);
    if (perf.notes.every((n) => n.judged) && heardNow - perf.t0 > endSec) finish();
  }

  function frame() {
    if (!perf || (perf.state !== 'countin' && perf.state !== 'playing')) return;
    perfRaf = requestAnimationFrame(frame);
    const vis = NS.heardAt();
    const songBeat = (vis - perf.t0) / perf.spb;
    placeTrack(songBeat);
    // the play line pulses on every beat
    const frac = songBeat - Math.floor(songBeat);
    $('playBand').style.opacity = String(0.45 + 0.55 * Math.pow(1 - frac, 3));
    const ci = $('countIn');
    if (vis < perf.t0 && vis >= perf.countStart - 0.05) {
      const k = Math.max(0, Math.floor((vis - perf.countStart) / perf.spb + 1e-6));
      ci.hidden = false;
      ci.textContent = String((k % perf.song.beatsPerBar) + 1);
    } else ci.hidden = true;
  }

  function multiplier(combo) {
    return Math.min(4, 1 + Math.floor((combo - 1) / 8));
  }

  function judge(n, kind, dt) {
    n.judged = kind;
    n.dt = dt;
    if (n.el) n.el.classList.add(kind);
    perf.counts[kind]++;
    if (kind === 'miss') {
      const broke = perf.combo >= 5;
      perf.combo = 0;
      setJudge('miss', 'Miss', `That was ${n.letter}.${broke ? ' Combo lost.' : ''}`);
    } else {
      perf.combo++;
      perf.maxCombo = Math.max(perf.maxCombo, perf.combo);
      perf.score += (kind === 'perfect' ? 100 : 50) * multiplier(perf.combo);
      const when = kind === 'good' ? (dt < 0 ? 'A little early.' : 'A little late.') : 'Right on the beat.';
      setJudge(kind, kind === 'perfect' ? 'Perfect!' : 'Good', `${n.letter}. ${when}`);
    }
    $('combo').textContent = perf.combo >= 2 ? `Combo ${perf.combo} · ×${multiplier(perf.combo)}` : '';
    $('pScore').textContent = fmt(perf.score);
    const done = perf.notes.filter((x) => x.judged).length;
    $('pProgress').style.width = (100 * done) / perf.notes.length + '%';
    markNext();
  }

  // A note from the mic (at = audio-clock onset time) or a tap (at = heard time).
  function heard(midi, at, source) {
    NS.showHeard(NS.foldToKeyboard(midi));
    if (!perf) return;
    if (perf.state === 'cal') { if (source === 'mic') perf.cal.onsets.push(at); return; }
    if (perf.state !== 'countin' && perf.state !== 'playing') return;
    const s = songSecFor(at, source);
    const pc = (m) => ((m % 12) + 12) % 12;
    // First come, first served: the earliest unplayed note whose window contains this moment.
    // An exact match wins; the same letter in another octave counts when there's no exact match.
    let exact = null;
    let sameLetter = null;
    let inWindow = false;
    for (const n of perf.notes) {
      if (n.judged) continue;
      const dt = s - n.beat * perf.spb;
      if (Math.abs(dt) > GOOD) continue;
      inWindow = true;
      if (!exact && n.midi === midi) exact = { n, dt };
      if (!sameLetter && pc(n.midi) === pc(midi)) sameLetter = { n, dt };
    }
    const best = exact || sameLetter;
    if (best) {
      judge(best.n, Math.abs(best.dt) <= PERFECT ? 'perfect' : 'good', best.dt);
    } else if (inWindow) {
      perf.counts.wrong++;
      perf.combo = 0;
      $('combo').textContent = '';
      setJudge('miss', 'Wrong note', `You played ${midiName(midi)}.`);
    } else {
      const next = perf.notes.find((n) => !n.judged);
      if (next && next.beat * perf.spb > s) setJudge('early', 'Too early', `Wait for ${next.letter} to reach the line.`);
      else setJudge('early', 'Too late', 'Play as the note touches the line.');
    }
  }

  function finish() {
    const song = perf.song;
    stop();
    const n = perf.notes.length;
    const c = perf.counts;
    const accuracy = Math.round((100 * (c.perfect + 0.75 * c.good)) / n);
    const stars = accuracy >= 90 ? 3 : accuracy >= 70 ? 2 : 1;
    const nextIdx = song.index + 1;
    const hasNext = nextIdx < songs.length;
    const wasUnlocked = hasNext && NS.isUnlocked(nextIdx);
    const bySpeed = (store.perf[song.id] = store.perf[song.id] || {});
    const prev = bySpeed[perf.speed];
    const newBest = !prev || perf.score > prev.score;
    // Each field keeps its own best, so a higher score with lower accuracy never takes stars away.
    bySpeed[perf.speed] = {
      score: Math.max(perf.score, prev ? prev.score : 0),
      accuracy: Math.max(accuracy, prev ? prev.accuracy : 0),
      stars: Math.max(stars, prev ? prev.stars : 0),
      maxCombo: Math.max(perf.maxCombo, prev ? prev.maxCombo : 0),
      at: newBest ? Date.now() : prev.at,
    };
    saveStore();
    const nowUnlocked = hasNext && NS.isUnlocked(nextIdx);

    $('rStars').textContent = starText(stars);
    $('rStars').setAttribute('aria-label', `${stars} of 3 stars`);
    $('rTitle').textContent = stars === 3 ? 'Brilliant!' : stars === 2 ? 'Nicely done!' : 'Keep going!';
    $('rNewBest').hidden = !newBest || !prev;
    $('rScore').textContent = fmt(perf.score);
    $('rAccuracy').textContent = accuracy + '%';
    $('rCombo').textContent = String(perf.maxCombo);
    $('rBest').textContent = fmt(bySpeed[perf.speed].score);
    $('rBreakdown').textContent = `${song.title} at ${perf.speed}% speed. Perfect ${c.perfect} · Good ${c.good} · Missed ${c.miss}` + (c.wrong ? ` · Wrong notes ${c.wrong}` : '') + '.';
    const unlock = $('rUnlock');
    if (!wasUnlocked && nowUnlocked) {
      unlock.hidden = false;
      unlock.textContent = `🔓 You unlocked ${songs[nextIdx].title}!`;
    } else if (!nowUnlocked && hasNext) {
      unlock.hidden = false;
      unlock.textContent = `Get 2 stars (70% accuracy) to unlock ${songs[nextIdx].title}. Slowing down to 50% can help.`;
    } else unlock.hidden = true;
    $('rNextBtn').hidden = !nowUnlocked;
    $('resultOverlay').hidden = false;
    renderReady();
    setJudge('ready', `${accuracy}% accuracy`, 'Press Start to play again.');
    NS.playTone(song.notes[0].midi + 12, 0.3, 0.05);
  }

  // Back to a fresh, unplayed track (after Stop or when the screen is hidden).
  function reset(big, small) {
    stop();
    resetRun();
    buildTrack();
    renderReady();
    setJudge('ready', big, small);
  }

  // ---------- timing calibration ----------
  const CAL_LEAD = 2;
  const CAL_N = 4;
  const CAL_GAP = 0.9;

  async function startCalibration() {
    const p = perf;
    if (!p || p.state !== 'ready' || $('calBtn').disabled) return;
    setWaiting(true);
    const ok = await NS.startMic(); // on failure startMic has already explained why
    setWaiting(false);
    if (!ok || perf !== p || p.state !== 'ready' || $('perform').hidden) return;
    const startAt = NS.audio().currentTime + 0.5;
    perf.cal = { start: startAt, onsets: [], end: startAt + (CAL_LEAD + CAL_N - 1) * CAL_GAP + 0.9 };
    perf.clicks = [];
    for (let k = 0; k < CAL_LEAD + CAL_N; k++) perf.clicks.push(NS.click(startAt + k * CAL_GAP, k >= CAL_LEAD, k >= CAL_LEAD ? 4200 : 2600));
    perf.state = 'cal';
    setPanel('cal');
    $('calText').textContent = 'Listen for 2 low clicks to get ready. Then play middle C on each of the 4 high clicks.';
    $('calDoneBtn').hidden = true;
    $('calAgainBtn').hidden = true;
    $('calCancelBtn').hidden = false;
    renderCalDots(-1);
    clearInterval(perfTimer);
    perfTimer = setInterval(tick, 20);
  }

  function renderCalDots(active) {
    document.querySelectorAll('#calDots span').forEach((d, i) => {
      d.classList.toggle('on', i === active);
      d.classList.toggle('past', i < active);
    });
  }

  function calTick(now) {
    const cal = perf.cal;
    if (!cal) return;
    const k = Math.floor((NS.heardAt() - cal.start) / CAL_GAP + 0.1) - CAL_LEAD;
    renderCalDots(Math.min(k, CAL_N));
    if (now < cal.end) return;
    clearInterval(perfTimer);
    perf.state = 'ready';
    const offsets = [];
    for (let i = 0; i < CAL_N; i++) {
      const c = cal.start + (CAL_LEAD + i) * CAL_GAP;
      const o = cal.onsets.find((t) => t - c > -0.25 && t - c < 0.5);
      if (o != null) offsets.push(o - c);
    }
    perf.cal = null;
    $('calCancelBtn').hidden = true;
    $('calAgainBtn').hidden = false;
    renderCalDots(CAL_N);
    if (offsets.length >= 3) {
      offsets.sort((a, b) => a - b);
      const h = offsets.length / 2;
      const mid = offsets.length % 2 ? offsets[Math.floor(h)] : (offsets[h - 1] + offsets[h]) / 2;
      store.latency = Math.min(0.5, Math.max(0, mid));
      saveStore();
      $('calText').textContent = `All set. Your phone hears notes about ${Math.round(store.latency * 1000)} ms after you play them, and scoring now allows for that.`;
      $('calDoneBtn').hidden = false;
    } else {
      $('calText').textContent = `I only heard ${offsets.length} of the 4 notes. Make sure “Listening” is on, play a little louder, and try again.`;
    }
  }

  // ---------- wiring ----------
  $('pBackBtn').addEventListener('click', NS.goHome);
  $('startBtn').addEventListener('click', start);
  $('stopBtn').addEventListener('click', () => reset('Stopped', 'Press Start to try again from the beginning.'));
  document.querySelectorAll('#speedPick [data-speed]').forEach((b) => b.addEventListener('click', () => {
    if (!perf || perf.state !== 'ready') return;
    store.speed = Number(b.dataset.speed);
    saveStore();
    renderReady();
  }));
  // Arrow keys move between speeds, as in any radio group.
  $('speedPick').addEventListener('keydown', (e) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!dir || !perf || perf.state !== 'ready') return;
    e.preventDefault();
    const i = Math.min(SPEEDS.length - 1, Math.max(0, SPEEDS.indexOf(store.speed) + dir));
    store.speed = SPEEDS[i];
    saveStore();
    renderReady();
    document.querySelector(`#speedPick [data-speed="${store.speed}"]`).focus();
  });
  $('clickBtn').addEventListener('click', () => {
    store.clickTrack = !store.clickTrack;
    saveStore();
    renderReady();
  });
  $('calBtn').addEventListener('click', startCalibration);
  $('calCancelBtn').addEventListener('click', () => { stop(); renderReady(); });
  $('calAgainBtn').addEventListener('click', startCalibration);
  $('calDoneBtn').addEventListener('click', renderReady);
  $('rAgainBtn').addEventListener('click', () => {
    $('resultOverlay').hidden = true;
    start();
  });
  $('rNextBtn').addEventListener('click', () => NS.startMode('perform', perf.song.index + 1));
  $('rListBtn').addEventListener('click', NS.goHome);
  NS.buildKeyboard($('pKeyboard'), (m, e) => {
    const at = NS.heardAt(e.timeStamp);
    NS.playTone(m, 0.4);
    heard(m, at, 'tap');
  });

  NS.registerMode({
    id: 'perform',
    label: 'Perform',
    primary: true,
    start: open,
    stop() { stop(); perf = null; },
    passed: (song) => { const b = bestPerf(song.id); return Boolean(b && b.stars >= 2); },
    played: (song) => Boolean(bestPerf(song.id)),
    cardLine(song) {
      const b = bestPerf(song.id);
      return b ? { stars: b.stars, text: `Perform best: ${fmt(b.score)} at ${b.speed}% speed` } : null;
    },
    onNamesChange() { if (perf && perf.state === 'ready') buildTrack(); },
    onResize() { if (perf && perf.trackEl) buildTrack(); },
    onHidden() {
      if (perf && (perf.state === 'countin' || perf.state === 'playing' || perf.state === 'cal')) {
        reset('Stopped', 'The song stopped because the screen was hidden. Press Start to play again.');
      }
    },
  });

  // A small hook for automated tests.
  NS.debug.perf = () => perf;
})();
