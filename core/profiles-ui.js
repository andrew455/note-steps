// "Playing as ..." on Home, and the "Who's playing?" picker (core/profiles.js keeps the data).
(function (root) {
  const NS = root.NS;
  const P = root.Profiles;
  if (!NS || !P) return;

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const initial = (name) => (String(name || '?').trim()[0] || '?').toUpperCase();
  function avatar(p, size = 36) {
    const a = el('span', 'pf-avatar', initial(p.name));
    a.style.background = P.color(p);
    a.style.width = a.style.height = size + 'px';
    a.style.fontSize = Math.round(size * 0.45) + 'px';
    return a;
  }

  // "Delete my progress" at the bottom of Home, with a confirm step on the page.
  function resetRow(main) {
    if (!main || main.querySelector('.pf-reset')) return;
    const box = el('div', 'pf-reset');
    const btn = el('button', 'btn pf-reset-btn', 'Delete my progress');
    btn.type = 'button';
    btn.addEventListener('click', () => {
      const me = P.current();
      box.innerHTML = '';
      const msg = el('p', null, `Delete all of ${me.name}’s progress? Songs, scores and known notes go back to the start. This can’t be undone.`);
      const yes = el('button', 'btn pf-danger', 'Yes, delete it');
      yes.type = 'button';
      const no = el('button', 'btn', 'Keep my progress');
      no.type = 'button';
      yes.addEventListener('click', () => P.resetCurrent());
      no.addEventListener('click', () => { box.remove(); resetRow(main); });
      const row = el('div', 'pf-reset-row');
      row.append(yes, no);
      box.append(msg, row);
    });
    box.appendChild(btn);
    main.appendChild(box);
  }

  function homeBar(main) {
    resetRow(main);
    if (!main || main.querySelector('.pf-bar')) return;
    const me = P.current();
    const bar = el('button', 'pf-bar');
    bar.type = 'button';
    const txt = el('span', 'pf-bar-text');
    txt.append(el('span', 'pf-bar-eyebrow', 'Playing as'), el('strong', null, me.name));
    bar.append(avatar(me), txt, el('span', 'pf-bar-switch', P.list().length > 1 ? 'Switch player' : 'Add a player'));
    bar.setAttribute('aria-label', `Playing as ${me.name}. Switch or add a player.`);
    bar.addEventListener('click', () => openPicker());
    main.prepend(bar);
  }

  let sheet = null;
  function closePicker() { if (sheet) { sheet.remove(); sheet = null; } }
  function openPicker({ welcome = false } = {}) {
    closePicker();
    sheet = el('div', 'pf-overlay');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', 'pfTitle');
    const box = el('div', 'pf-sheet');
    const h = el('h2', null, 'Who’s playing?');
    h.id = 'pfTitle';
    box.appendChild(h);
    if (welcome) box.appendChild(el('p', 'muted', 'Pick your name so your progress is saved to you.'));
    const me = P.current();
    const ul = el('ul', 'pf-list');
    P.list().forEach((p) => {
      const li = el('li', 'pf-row' + (p.id === me.id ? ' on' : ''));
      const pick = el('button', 'pf-pick');
      pick.type = 'button';
      pick.append(avatar(p, 44), el('span', 'pf-name', p.name));
      if (p.id === me.id) pick.appendChild(el('span', 'pf-here', 'Playing now'));
      pick.addEventListener('click', () => { if (p.id === me.id) closePicker(); else P.switchTo(p.id); });
      const ren = el('button', 'pf-icon', '✎');
      ren.type = 'button';
      ren.setAttribute('aria-label', `Rename ${p.name}`);
      ren.addEventListener('click', () => editName(li, p));
      li.append(pick, ren);
      if (p.id !== 'p1') {
        const del = el('button', 'pf-icon', '🗑');
        del.type = 'button';
        del.setAttribute('aria-label', `Remove ${p.name}`);
        del.addEventListener('click', () => confirmRemove(li, p));
        li.appendChild(del);
      }
      ul.appendChild(li);
    });
    box.appendChild(ul);

    const form = el('form', 'pf-add');
    const input = el('input');
    input.id = 'pfNewName';
    input.placeholder = 'New player’s name';
    input.maxLength = 24;
    input.autocomplete = 'off';
    const add = el('button', 'btn primary', 'Add player');
    add.type = 'submit';
    form.append(input, add);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!input.value.trim()) { input.focus(); return; }
      const p = P.add(input.value);
      P.switchTo(p.id);
    });
    box.appendChild(form);
    const done = el('button', 'btn', 'Close');
    done.type = 'button';
    done.addEventListener('click', closePicker);
    box.appendChild(done);
    sheet.appendChild(box);
    sheet.addEventListener('click', (e) => { if (e.target === sheet) closePicker(); });
    document.body.appendChild(sheet);
  }

  function editName(li, p) {
    li.innerHTML = '';
    const f = el('form', 'pf-edit');
    const i = el('input');
    i.value = p.name;
    i.maxLength = 24;
    i.setAttribute('aria-label', 'Name');
    const ok = el('button', 'btn primary', 'Save');
    ok.type = 'submit';
    f.append(i, ok);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      P.rename(p.id, i.value);
      openPicker();
      refreshHome();
    });
    li.appendChild(f);
    i.focus();
    i.select();
  }
  function confirmRemove(li, p) {
    li.innerHTML = '';
    const msg = el('p', null, `Remove ${p.name} and all their progress?`);
    const yes = el('button', 'btn', 'Remove');
    yes.style.color = 'var(--bad)';
    const no = el('button', 'btn', 'Keep');
    yes.addEventListener('click', () => { P.remove(p.id); openPicker(); refreshHome(); });
    no.addEventListener('click', () => openPicker());
    li.append(msg, yes, no);
  }
  function refreshHome() {
    const main = [...document.querySelectorAll('main.wrap')].find((m) => !m.hidden && m.dataset.mode === 'home');
    if (!main) return;
    const old = main.querySelector('.pf-bar');
    if (old) old.remove();
    homeBar(main);
  }

  const css = el('style');
  css.textContent = `
  .pf-bar { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 12px; border-radius: 14px;
    border: 1.5px solid var(--line); background: var(--card); color: var(--ink); font: inherit; text-align: left; cursor: pointer; }
  .pf-avatar { display: inline-grid; place-items: center; border-radius: 50%; color: #fff; font-weight: 800; flex: none; }
  .pf-bar-text { display: flex; flex-direction: column; flex: 1; min-width: 0; line-height: 1.2; }
  .pf-bar-eyebrow { font-size: 0.7rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); font-weight: 700; }
  .pf-bar-switch { font-size: 0.85rem; font-weight: 700; color: var(--accent); }
  .pf-overlay { position: fixed; inset: 0; z-index: 60; background: rgba(10,14,22,0.55); display: grid; place-items: center; padding: 16px; }
  .pf-sheet { background: var(--card); color: var(--ink); border-radius: 20px; padding: 20px; width: 100%; max-width: 420px;
    display: flex; flex-direction: column; gap: 12px; max-height: 90vh; overflow-y: auto; }
  .pf-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .pf-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .pf-pick { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; padding: 8px 10px; border-radius: 14px;
    border: 1.5px solid var(--line); background: var(--paper); color: var(--ink); font: inherit; cursor: pointer; text-align: left; }
  .pf-row.on .pf-pick { border-color: var(--accent); background: var(--accent-soft); }
  .pf-name { font-weight: 800; font-size: 1.05rem; flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .pf-here { font-size: 0.75rem; color: var(--accent); font-weight: 700; }
  .pf-icon { width: 44px; height: 44px; border-radius: 12px; border: 1.5px solid var(--line); background: var(--card); font-size: 1.1rem; cursor: pointer; color: var(--ink); }
  .pf-reset { display: flex; flex-direction: column; gap: 8px; padding-top: 8px; }
  .pf-reset p { margin: 0; }
  .pf-reset-btn, .pf-danger { color: var(--bad); border-color: var(--bad); align-self: flex-start; }
  .pf-reset-row { display: flex; gap: 8px; flex-wrap: wrap; }
  .pf-add, .pf-edit { display: flex; gap: 8px; width: 100%; }
  .pf-add input, .pf-edit input { flex: 1; min-width: 0; font: inherit; padding: 10px 12px; border-radius: 12px; border: 1.5px solid var(--line); background: var(--paper); color: var(--ink); }`;
  document.head.appendChild(css);

  NS.bus.on('route', ({ modeId }) => {
    if (modeId !== 'home') return;
    setTimeout(() => {
      const main = [...document.querySelectorAll('main.wrap')].find((m) => !m.hidden && m.dataset.mode === 'home');
      homeBar(main);
    }, 0);
  });
  // With more than one player, ask who's playing when the app opens.
  let picked = false;
  try { picked = sessionStorage.getItem('ns-picked') === '1'; } catch {}
  if (P.list().length > 1 && !picked) {
    try { sessionStorage.setItem('ns-picked', '1'); } catch {}
    const show = () => setTimeout(() => openPicker({ welcome: true }), 300);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show); else show();
  }
  NS.profilesUi = { openPicker };
})(typeof window !== 'undefined' ? window : globalThis);

// A house button next to Back on every screen: straight to Home from anywhere.
(function (root) {
  const NS = root.NS;
  if (!NS) return;
  const ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/></svg>';
  function addHome() {
    document.querySelectorAll('main.wrap:not([hidden])').forEach((main) => {
      if (main.dataset.mode === 'home' || main.id === 'home') return;
      const back = main.querySelector('button.back, #pBackBtn');
      if (!back || back.parentElement.querySelector('.homebtn')) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'homebtn';
      b.innerHTML = ICON;
      b.setAttribute('aria-label', 'Home');
      b.title = 'Home';
      b.addEventListener('click', () => { try { NS.audio.stopAll && NS.audio.stopAll(); } catch {} location.hash = '#/'; });
      back.insertAdjacentElement('afterend', b);
    });
  }
  const css = document.createElement('style');
  css.textContent = `.homebtn { width: 44px; height: 44px; flex: none; display: inline-grid; place-items: center; border-radius: 12px;
    border: 1.5px solid var(--line); background: var(--card); color: var(--ink); cursor: pointer; margin-left: 6px; }`;
  document.head.appendChild(css);
  NS.bus.on('route', () => setTimeout(addHome, 0));
  new MutationObserver(() => { clearTimeout(addHome.t); addHome.t = setTimeout(addHome, 80); }).observe(document.body, { childList: true, subtree: true });
})(typeof window !== 'undefined' ? window : globalThis);
