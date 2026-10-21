// Chord command bar (§7.1): fixed to the bottom of a screen, one chip per chord command.
// window.ChordBar and NS.chordbar: show({commands:[{chord:'C'|'Cm'|'G', label, run()}], listening})
//   -> {flash(chord), setListening(bool), hide()}
//
// WP0 STUB with the final signature: renders nothing and runs nothing. WP12 owns this file (it owns
// its own CSS with the cb- prefix and may reuse chord-card.js drawing helpers).
(function (root) {
  function show({ commands = [], listening = false } = {}) {
    return { flash() {}, setListening() {}, hide() {} };
  }
  const api = { show };
  root.ChordBar = api;
  if (root.NS) root.NS.chordbar = api;
})(typeof window !== 'undefined' ? window : globalThis);
