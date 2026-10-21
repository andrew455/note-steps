// "Keyboard check": shows whether Chrome allows the USB keyboard, whether one is plugged in, and a
// live key test, with plain steps to fix whichever part is wrong.
(function (root) {
  const NS = root.NS;
  if (!NS || !NS.midi) return;
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const noteName = (m) => NAMES[m % 12] + (Math.floor(m / 12) - 1);

  let ov = null;
  let offs = [];
  function close() {
    offs.forEach((f) => { try { f(); } catch {} });
    offs = [];
    if (ov) ov.remove();
    ov = null;
  }

  async function open() {
    close();
    ov = el('div', 'mc-overlay');
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    const box = el('div', 'mc-box');
    box.appendChild(el('h2', null, 'Keyboard check'));
    const rows = el('ul', 'mc-rows');
    const rPerm = el('li');
    const rKb = el('li');
    const rKey = el('li');
    rows.append(rPerm, rKb, rKey);
    const help = el('div', 'mc-help');
    const btns = el('div', 'mc-btns');
    const again = el('button', 'btn primary', 'Try again');
    const disc = el('button', 'btn', 'Disconnect');
    const shut = el('button', 'btn', 'Close');
    [again, disc, shut].forEach((b) => { b.type = 'button'; });
    btns.append(again, disc, shut);
    box.append(rows, help, btns);
    ov.appendChild(box);
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    shut.addEventListener('click', close);
    disc.addEventListener('click', () => { NS.midi.disconnect(); render(); });
    again.addEventListener('click', async () => { NS.audio.resume && NS.audio.resume(); await NS.midi.connect({ fresh: true }); render(); });
    document.body.appendChild(ov);

    const row = (li, ok, label, text) => {
      li.className = ok === true ? 'ok' : ok === false ? 'bad' : 'wait';
      li.innerHTML = '';
      li.append(el('span', 'mc-dot', ok === true ? '✓' : ok === false ? '✗' : '…'), el('strong', null, label), el('span', 'mc-val', text));
    };
    let lastKey = null;
    async function render() {
      if (!ov) return;
      const sup = NS.midi.supported();
      const perm = sup ? await NS.midi.permission() : 'unsupported';
      const on = NS.midi.isOn();
      help.innerHTML = '';
      if (!sup) {
        row(rPerm, false, 'Browser', 'This browser can’t read USB keyboards');
        row(rKb, null, 'Keyboard', '—');
        row(rKey, null, 'Key test', '—');
        help.append(el('p', null, 'Use Chrome on an Android phone or tablet, or Chrome on a computer. iPhone browsers can’t read USB keyboards.'));
        again.hidden = true; disc.hidden = true;
        return;
      }
      const permText = { granted: 'Allowed', denied: 'Blocked', prompt: 'Not allowed yet', unknown: on ? 'Allowed' : 'Unknown' }[perm] || perm;
      row(rPerm, perm === 'granted' || on ? true : perm === 'denied' ? false : null, 'Chrome permission', permText);
      row(rKb, on ? true : (perm === 'granted' ? false : null), 'Keyboard', on ? NS.midi.names().join(', ') : 'Not found');
      row(rKey, lastKey ? true : null, 'Key test', lastKey ? `Heard ${lastKey}` : (on ? 'Press any key on your keyboard' : '—'));
      disc.hidden = !on;
      again.hidden = on;
      if (perm === 'denied') {
        help.append(el('p', null, 'Chrome is blocking the keyboard for this site. To allow it:'));
        const ol = el('ol');
        ['Tap the icon just left of the web address (a padlock or sliders).',
          'Tap Permissions (or Site settings).',
          'Find MIDI devices and choose Allow. If you can’t see it, tap Reset permissions.',
          'Come back here and tap Try again.'].forEach((t) => ol.appendChild(el('li', null, t)));
        help.appendChild(ol);
        help.append(el('p', 'muted', 'Or: Chrome menu ⋮ → Settings → Site settings → MIDI devices → andrew455.github.io → Allow.'));
      } else if (!on && perm !== 'prompt') {
        help.append(el('p', null, 'Chrome allows it, but no keyboard is talking to the phone. Check:'));
        const ul = el('ul');
        ['The keyboard is switched on.',
          'The cable is in the keyboard’s “To Host” port (not “To Device”).',
          'The adapter is pushed all the way into the phone (an OTG / USB-C adapter for Android).',
          'Unplug the cable at both ends, plug it back in, then tap Try again.',
          'If the keyboard has a USB mode setting, set it to MIDI.'].forEach((t) => ul.appendChild(el('li', null, t)));
        help.appendChild(ul);
      } else if (!on) {
        help.append(el('p', null, 'Plug the keyboard’s “To Host” port into the phone, then tap Try again. Chrome will ask to allow MIDI devices: tap Allow.'));
      } else if (!lastKey) {
        help.append(el('p', 'muted', 'Everything is connected. Press a key to test it.'));
      }
    }
    offs.push(
      NS.bus.on('midi:state', render),
      NS.input.on((ev) => { if (ev.source === 'midi') { lastKey = noteName(ev.midi); render(); } }),
      NS.bus.on('midi:chordname', ({ label }) => { lastKey = label; render(); }),
    );
    render();
  }

  const css = document.createElement('style');
  css.textContent = `
  .mc-overlay { position: fixed; inset: 0; z-index: 70; background: rgba(10,14,22,0.55); display: grid; place-items: center; padding: 16px; }
  .mc-box { background: var(--card); color: var(--ink); border-radius: 20px; padding: 20px; width: 100%; max-width: 440px;
    display: flex; flex-direction: column; gap: 12px; max-height: 90vh; overflow-y: auto; }
  .mc-rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .mc-rows li { display: grid; grid-template-columns: 28px auto 1fr; gap: 8px; align-items: center; padding: 10px 12px; border-radius: 12px; border: 1.5px solid var(--line); }
  .mc-rows li.ok { border-color: var(--good); background: var(--good-soft); }
  .mc-rows li.bad { border-color: var(--bad); background: var(--bad-soft); }
  .mc-dot { font-weight: 800; text-align: center; }
  .mc-val { text-align: right; color: var(--muted); min-width: 0; overflow-wrap: anywhere; }
  .mc-help ol, .mc-help ul { margin: 6px 0 0; padding-left: 20px; display: flex; flex-direction: column; gap: 4px; }
  .mc-help p { margin: 0; }
  .mc-btns { display: flex; gap: 8px; flex-wrap: wrap; }`;
  document.head.appendChild(css);

  NS.midiCheck = { open, close };
})(typeof window !== 'undefined' ? window : globalThis);
