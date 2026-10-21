// The app's namespace: window.NS. Event emitters, the app-wide bus, the single input stream that every
// mode listens to, the mode registry, test flags and the small DOM helpers. Load after core/util.js.
// Emits on NS.bus: 'theme' {dark} on a colour-scheme change, 'resize' {width} (debounced 120 ms),
// 'visibility' {hidden} on visibilitychange.
(function (root) {
  const NS = (root.NS = root.NS || {});

  // ---------- emitters ----------
  NS.emitter = function emitter() {
    const map = new Map();
    function on(evt, fn) {
      if (!map.has(evt)) map.set(evt, new Set());
      map.get(evt).add(fn);
      return () => off(evt, fn);
    }
    function off(evt, fn) {
      const s = map.get(evt);
      if (s) s.delete(fn);
    }
    function once(evt, fn) {
      const offFn = on(evt, (p) => { offFn(); fn(p); });
      return offFn;
    }
    function emit(evt, payload) {
      const s = map.get(evt);
      if (!s) return;
      [...s].forEach((fn) => {
        try { fn(payload); } catch (err) { console.error(`[NS] '${evt}' listener failed`, err); }
      });
    }
    function count(evt) {
      if (evt != null) return map.has(evt) ? map.get(evt).size : 0;
      let n = 0;
      map.forEach((s) => (n += s.size));
      return n;
    }
    return { on, once, emit, count };
  };

  NS.bus = NS.emitter();

  // ---------- input: one stream of InputEvents from the mic and the on-screen keys ----------
  // InputEvent = { midi, at, tOnset, source:'mic'|'screen', confident, reason, rms, cents }
  const inputBus = NS.emitter();
  NS.input = {
    on: (fn) => inputBus.on('input', fn),
    emit: (ev) => inputBus.emit('input', ev),
    count: () => inputBus.count('input'),
  };

  // ---------- modes ----------
  const modeDefs = new Map();
  NS.modes = {
    register(def) {
      if (!def || !def.id) throw new Error('NS.modes.register needs an id');
      modeDefs.set(def.id, def);
      NS.bus.emit('modes:changed', { id: def.id });
      return def;
    },
    get: (id) => modeDefs.get(id) || null,
    list: () => [...modeDefs.values()].sort((a, b) => (a.order ?? 99) - (b.order ?? 99)),
  };

  // ---------- test hooks ----------
  NS.isTest = typeof location !== 'undefined' && /[?&]test=1/.test(location.search);
  // Filled in by the shell; perform.js adds debug.perf through window.NoteSteps.debug.
  NS.debug = NS.debug || {};
  NS.debug.mode = NS.debug.mode || (() => null);
  NS.debug.inputListeners = () => NS.input.count();

  // ---------- util (pure helpers plus small DOM ones) ----------
  const SVGNS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs, parent) {
    const el = document.createElementNS(SVGNS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  }
  NS.util = Object.assign({}, root.Util, {
    $: (id) => document.getElementById(id),
    svgEl,
    fmt: (n) => Math.round(n).toLocaleString('en-US'),
    starText: (s) => '★'.repeat(s) + '☆'.repeat(3 - s),
  });

  // ---------- environment events ----------
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    if (mq) {
      const onTheme = () => NS.bus.emit('theme', { dark: mq.matches });
      if (mq.addEventListener) mq.addEventListener('change', onTheme);
      else if (mq.addListener) mq.addListener(onTheme);
    }
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => NS.bus.emit('resize', { width: window.innerWidth }), 120);
    });
    document.addEventListener('visibilitychange', () => {
      NS.bus.emit('visibility', { hidden: document.visibilityState === 'hidden' });
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
