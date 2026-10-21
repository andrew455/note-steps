// Hands-free chord bar. On any screen it shows the three command chords of the current stage
// (core/chordset.js) and what each does here, found from the screen itself:
//   next  (major chord) -> the screen's main button (.btn.primary: Start, Next song, Start reading...)
//   again (minor chord) -> its hear / replay / play again button
//   back  (another major) -> its Back button
// Playing the chord (USB keyboard, or the mic) presses that button; the chips can be tapped too.
// Screens with their own chord controls (Play by Ear's steps, the Practice finish card) and Free Play
// (where chords are music, not commands) are left alone.
(function (root) {
  const NS = root.NS;

  // Kept for Play by Ear, which draws its own bar when this returns nothing.
  function show() { return { flash() {}, setListening() {}, hide() {} }; }
  const api = { show };
  root.ChordBar = api;
  if (!NS) return;
  NS.chordbar = api;

  const AGAIN_RE = /^\W*(hear|listen|replay|play again|try again|again|start over|restart|play it)/i;
  let bar = null;
  let cmds = [];       // [{role, chord, label, button}]
  let det = null;
  let timer = null;
  let releaseWait = null;

  // getClientRects also sees position:fixed elements (offsetParent is null for those).
  const visible = (e) => e && !e.disabled && !e.closest('[hidden]') && e.getClientRects().length > 0;
  const clean = (t) => String(t || '').replace(/[▶←×🎤🎹■]/g, '').replace(/\s+/g, ' ').trim();
  // A short label for a chip: a song row's title, or the button's first line, at most ~30 characters.
  function labelOf(b) {
    const strong = (b.classList.contains('song-row') || b.classList.contains('be-row')) && b.querySelector('strong');
    let t = clean(strong ? strong.textContent : (b.innerText || b.textContent).split('\n')[0]);
    if (t.length > 30) t = t.slice(0, 28).trim() + '…';
    return t;
  }

  function screenEl() {
    const overlays = [...document.querySelectorAll('.overlay, [role="dialog"]')].filter(visible);
    return overlays.pop() || [...document.querySelectorAll('main.wrap')].find((m) => !m.hidden) || null;
  }
  function excluded(scr) {
    if (!scr) return true;
    const main = [...document.querySelectorAll('main.wrap')].find((m) => !m.hidden);
    if (main && (main.dataset.mode === 'free' || main.dataset.mode === 'home')) return true; // Home has a chord on every box
    if (document.querySelector('.be-chordbar') && visible(document.querySelector('.be-chordbar'))) return true;
    if ([...document.querySelectorAll('.cc-card')].some(visible)) return true;
    if ([...document.querySelectorAll('.pf-overlay')].some(visible)) return true;
    return false;
  }

  function scan() {
    timer = null;
    const scr = screenEl();
    const v = NS.chordset ? NS.chordset.current() : { next: 'C', again: 'Cm', back: 'G' };
    const next = [];
    if (!excluded(scr)) {
      const buttons = [...scr.querySelectorAll('button')].filter(visible);
      // "Go" is the screen's start/next action; listen/replay buttons belong to "again".
      const GO_RE = /^\W*(start|next|begin|continue|go$|go on|read|play$|perform|let's|ok|done|finish)/i;
      const short = (b) => clean(b.textContent).length <= 32;
      const cands = buttons.filter((b) => !b.matches('[data-mic-btn], [data-midi-btn], .back, .homebtn, .song-row, .be-row') && !AGAIN_RE.test(clean(b.textContent)));
      // On a song list, "go" opens the first song you can play.
      const firstSong = [...scr.querySelectorAll('.song-row-wrap:not(.locked) .song-row, .be-row')].find(visible);
      const primary = cands.find((b) => b.classList.contains('primary') && short(b) && GO_RE.test(clean(b.textContent)))
        || cands.find((b) => b.classList.contains('primary') && short(b))
        || cands.find((b) => short(b) && GO_RE.test(clean(b.textContent)))
        || firstSong;
      const again = buttons.find((b) => b !== primary && AGAIN_RE.test(clean(b.textContent)));
      let back = buttons.find((b) => b.classList.contains('back'));
      if (!back && scr.matches('.overlay, [role="dialog"]')) {
        const main = [...document.querySelectorAll('main.wrap')].find((m) => !m.hidden);
        back = null; // in a dialog, "back" means its own close/list button if it has one
        const list = buttons.find((b) => /all (songs|lessons)|back|close|done/i.test(clean(b.textContent)) && b !== primary);
        if (list) back = list;
        void main;
      }
      if (primary) next.push({ role: 'next', chord: v.next, label: labelOf(primary) || 'Go', button: primary });
      if (again) next.push({ role: 'again', chord: v.again, label: labelOf(again), button: again });
      if (back) next.push({ role: 'back', chord: v.back, label: clean(back.getAttribute('aria-label') || back.textContent) || 'Back', button: back });
    }
    const sig = next.map((c) => c.chord + c.label).join('|');
    const old = cmds.map((c) => c.chord + c.label).join('|');
    cmds = next;
    if (sig !== old || (bar && !document.body.contains(bar))) render();
    attach();
  }
  function schedule() { if (!timer) timer = setTimeout(scan, 120); }

  function keysSvg(id) {
    const CS = root.ChordSet;
    const keys = CS ? CS.midis(id) : [];
    const W = 8;
    const whites = [];
    for (let m = 55; m <= 76; m++) if (![1, 3, 6, 8, 10].includes(m % 12)) whites.push(m);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${whites.length * W + 1} 30`);
    svg.setAttribute('class', 'hb-keys');
    svg.setAttribute('aria-hidden', 'true');
    const rect = (x, y, w, h, fill, stroke) => {
      const r = document.createElementNS(ns, 'rect');
      r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', w); r.setAttribute('height', h); r.setAttribute('rx', 1.2);
      r.style.fill = fill; if (stroke) { r.style.stroke = stroke; r.style.strokeWidth = 1; }
      svg.appendChild(r);
    };
    whites.forEach((m, i) => rect(i * W + 0.5, 0.5, W, 29, keys.includes(m) ? 'var(--accent)' : 'var(--key-white)', 'var(--line)'));
    for (let m = 56; m <= 75; m++) {
      if (![1, 3, 6, 8, 10].includes(m % 12)) continue;
      const below = whites.indexOf(m - 1);
      rect((below + 1) * W - 2.4 + 0.5, 0.5, 4.8, 17, keys.includes(m) ? 'var(--accent)' : 'var(--key-black)');
    }
    return svg;
  }

  function render() {
    if (!cmds.length) { if (bar) bar.remove(); bar = null; document.body.classList.remove('has-hbar'); return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'hbar';
      bar.setAttribute('role', 'group');
      bar.setAttribute('aria-label', 'Chord commands');
    }
    bar.innerHTML = '';
    const CS = root.ChordSet;
    cmds.forEach((c) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'hb-chip';
      chip.dataset.chord = c.chord;
      const txt = document.createElement('span');
      txt.className = 'hb-text';
      const strong = document.createElement('strong');
      strong.textContent = CS ? CS.name(c.chord) : c.chord;
      txt.append(strong, document.createTextNode(c.label));
      chip.append(keysSvg(c.chord), txt);
      chip.setAttribute('aria-label', `${CS ? CS.name(c.chord) : c.chord}: ${c.label}`);
      chip.addEventListener('click', () => press(c, false));
      bar.appendChild(chip);
    });
    if (!document.body.contains(bar)) document.body.appendChild(bar);
    document.body.classList.add('has-hbar');
  }

  function attach() {
    const targets = cmds.map((c) => c.chord);
    const key = targets.join(',');
    if (det && det.key === key) return;
    if (det) { try { det.h.dispose(); } catch {} det = null; }
    if (!targets.length || !root.ChordDetect) return;
    const src = NS.mic && NS.mic.isOn() && NS.mic.source ? NS.mic.source() : null;
    const h = root.ChordDetect.attach(src ? NS.audio.ctx() : null, src, {
      targets,
      muted: () => NS.audio.micMuted(performance.now()),
      onChord: (name) => { const c = cmds.find((x) => x.chord === name); if (c) press(c, true); },
    });
    h.start();
    det = { key, h };
  }

  // A chord that starts playback waits until the keys are let go (so the sound isn't under the chord).
  function press(c, viaChord) {
    const chip = bar && bar.querySelector(`[data-chord="${c.chord}"]`);
    if (chip) { chip.classList.add('flash'); setTimeout(() => chip.classList.remove('flash'), 600); }
    const go = () => { if (document.body.contains(c.button) && visible(c.button)) c.button.click(); schedule(); };
    if (!viaChord || c.role !== 'again') { go(); return; }
    clearTimeout(releaseWait);
    const t0 = performance.now();
    let freeAt = null;
    const check = () => {
      const held = NS.midi && NS.midi.heldCount ? NS.midi.heldCount() : 0;
      const now = performance.now();
      if (held === 0 && freeAt === null) freeAt = now;
      if (held > 0) freeAt = null;
      if ((freeAt !== null && now - freeAt >= 700) || now - t0 > 5000) go();
      else releaseWait = setTimeout(check, 50);
    };
    check();
  }

  // New chords for a new stage: say so once.
  function introduceStage() {
    try {
      if (!NS.chordset.isNewStage()) return;
      const v = NS.chordset.current();
      const CS = root.ChordSet;
      NS.ui.toast(`New chords unlocked! ${CS.name(v.next)} = go, ${CS.name(v.again)} = again, ${CS.name(v.back)} = back. Same hand shape: thumb, middle finger, little finger.`, { ms: 9000 });
    } catch { /* optional */ }
  }

  const css = document.createElement('style');
  css.textContent = `
  .hbar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; display: flex; gap: 8px; justify-content: center;
    padding: 8px max(12px, env(safe-area-inset-right, 0px)) calc(8px + env(safe-area-inset-bottom, 0px)) max(12px, env(safe-area-inset-left, 0px));
    background: var(--card); border-top: 1.5px solid var(--line); box-shadow: 0 -4px 16px rgba(0,0,0,0.08); }
  .hb-chip { flex: 1 1 0; min-width: 0; max-width: 220px; display: flex; flex-direction: column; align-items: center; gap: 4px;
    padding: 6px; border-radius: 10px; border: 1.5px solid var(--line); background: var(--paper); color: var(--ink); font: inherit; cursor: pointer; }
  .hb-chip.flash { border-color: var(--good); background: var(--good-soft); }
  .hb-keys { width: 100%; max-width: 150px; height: auto; display: block; }
  .hb-text { display: flex; flex-direction: column; align-items: center; text-align: center; font-size: 0.78rem; line-height: 1.25; min-width: 0; }
  .hb-text strong { font-size: 0.82rem; }
  body.has-hbar { padding-bottom: calc(110px + env(safe-area-inset-bottom, 0px)); }
  @media (prefers-reduced-motion: reduce) { .hb-chip { transition: none; } }`;
  document.head.appendChild(css);

  const start = () => {
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled', 'class'] });
    NS.bus.on('route', () => { schedule(); setTimeout(introduceStage, 400); });
    NS.bus.on('midi:state', () => { if (det) { try { det.h.dispose(); } catch {} det = null; } schedule(); });
    NS.bus.on('mic:state', () => { if (det) { try { det.h.dispose(); } catch {} det = null; } schedule(); });
    schedule();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(typeof window !== 'undefined' ? window : globalThis);
