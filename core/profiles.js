// Player profiles on this device ("Who's playing?"). Each player has their own progress: every
// localStorage key that starts with "note-steps" is stored under that player's prefix. The first player
// keeps the original keys, so progress from before profiles existed belongs to them. Device settings
// (the USB keyboard, mic boost) are shared by everyone.
// Must load before any other app script reads localStorage.
(function (root) {
  const LIST_KEY = 'ns-profiles';
  const CUR_KEY = 'ns-profile';
  const SHARED = new Set(['note-steps-midi', 'note-steps-mic-boost']);
  const proto = root.Storage && root.Storage.prototype;
  let list = [];
  let current = 'p1';

  const raw = {
    get: proto ? proto.getItem : null,
    set: proto ? proto.setItem : null,
    remove: proto ? proto.removeItem : null,
  };
  function readRaw(k) { try { return raw.get.call(root.localStorage, k); } catch { return null; } }
  function writeRaw(k, v) { try { raw.set.call(root.localStorage, k, v); } catch {} }

  try { list = JSON.parse(readRaw(LIST_KEY) || '[]'); } catch { list = []; }
  if (!Array.isArray(list) || !list.length) list = [{ id: 'p1', name: 'Player 1', color: 0 }];
  current = readRaw(CUR_KEY) || list[0].id;
  if (!list.some((p) => p.id === current)) current = list[0].id;

  // p1 uses the plain keys; other players get "note-steps@<id>:" in front.
  const mapKey = (k) => {
    if (typeof k !== 'string' || !k.startsWith('note-steps') || SHARED.has(k) || current === 'p1') return k;
    return `note-steps@${current}:${k}`;
  };
  if (proto && raw.get) {
    proto.getItem = function (k) { return raw.get.call(this, this === root.localStorage ? mapKey(k) : k); };
    proto.setItem = function (k, v) { return raw.set.call(this, this === root.localStorage ? mapKey(k) : k, v); };
    proto.removeItem = function (k) { return raw.remove.call(this, this === root.localStorage ? mapKey(k) : k); };
  }

  function save() { writeRaw(LIST_KEY, JSON.stringify(list)); }
  const COLORS = ['#3b6cf0', '#e05ad6', '#f0682b', '#109f8f', '#e8a10c', '#2f9e44'];

  const api = {
    list: () => list.map((p) => Object.assign({}, p)),
    current: () => Object.assign({}, list.find((p) => p.id === current)),
    color: (p) => COLORS[(p && p.color) % COLORS.length],
    add(name) {
      const n = String(name || '').trim().slice(0, 24) || `Player ${list.length + 1}`;
      let i = list.length + 1;
      while (list.some((p) => p.id === 'p' + i)) i++;
      const p = { id: 'p' + i, name: n, color: list.length % COLORS.length };
      list.push(p);
      save();
      return p;
    },
    rename(id, name) {
      const p = list.find((x) => x.id === id);
      if (!p) return;
      p.name = String(name || '').trim().slice(0, 24) || p.name;
      save();
    },
    remove(id) {
      if (id === 'p1' || list.length < 2) return; // the first player holds the original progress
      // Delete that player's saved progress too.
      try {
        const ls = root.localStorage;
        const pre = `note-steps@${id}:`;
        const keys = [];
        for (let i = 0; i < ls.length; i++) { const k = ls.key(i); if (k && k.startsWith(pre)) keys.push(k); }
        keys.forEach((k) => raw.remove.call(ls, k));
      } catch {}
      list = list.filter((p) => p.id !== id);
      save();
      if (current === id) api.switchTo(list[0].id);
    },
    // Switching reloads the app so every screen starts fresh with that player's progress.
    switchTo(id) {
      if (!list.some((p) => p.id === id)) return;
      writeRaw(CUR_KEY, id);
      try { sessionStorage.setItem('ns-picked', '1'); } catch {}
      root.location.hash = '#/';
      root.location.reload();
    },
  };
  root.Profiles = api;
})(typeof window !== 'undefined' ? window : globalThis);
