# Note Steps v2: implementation spec

This spec covers Ear First, Free Play, Hear It First, per-note mastery (with Note Drill and My notes), shape hints, and the graded song library.

Status: design only. Implementers get this document as written. The live code at `/Users/andy/wkspaces/Music App` was read to write it: `index.html`, `app.js`, `pitch.js`, `songs.js`, `perform.js`, `perform.css`, `README.md` and `.claude/launch.json`. No files were changed.

---

## 0. Ground truth and resolved conflicts

### 0.1 What the code looks like today (working tree, uncommitted)

- The **Performance session is mid-refactor.**
  - `perform.js` and `perform.css` exist. `perform.js` injects its own `#perform` screen and `#resultOverlay`.
  - It talks to the app only through `window.NoteSteps`, using these names: `$, svgEl, fmt, starText, store, saveStore, songs, STEP, BOTTOM, outLatency, showScreen, setNoteHandler, updateNamesButtons, drawStaffLines, drawNote, heardAt, audio, startMic, isListening, click, foldToKeyboard, showHeard, isUnlocked, playTone, micNotice, goHome, startMode, buildKeyboard, registerMode, debug`.
  - It calls `NS.registerMode({id:'perform', label, primary, start(i), stop(), passed(song), played(song), cardLine(song), onNamesChange(), onResize(), onHidden()})`.
  - Performance data lives in the v1 store: `store.perf[id][speed] = {score, accuracy, stars, maxCombo, at}`, plus `store.speed`, `store.clickTrack` and `store.latency`.
- **`songs.js`** sets `window.NoteSongs = {levels, songs, parseNotes}`.
  - Each song is `{id, level, index, title, blurb, bpm, beatsPerBar, pickup, notes:[{letter, midi, staffPos, dur, beats, beat}], endBeat, source}`.
  - The 8 ids are `scale-up, scale-down, mary, ode, twinkle, jingle, frere, birthday`.
- **`app.js`** still holds Practice and the old copy of Perform.
  - `tick()` calls `heard(midi, at)`, where `at` is the audio-clock onset from `refineOnset`.
  - Real constants: re-trigger gate 110 ms, RMS rise ratio ×1.7 over 4 frames back, votes start at 35 ms, 3 identical votes in a row confirm a note, 500 ms fallback that takes the majority with at least 2 votes.
  - `playTone` sets `muteUntil = now + (delay+dur)·1000 + 200`.
  - `click()` is a 3.3 or 4.2 kHz pip that does not mute the mic, because the mic path runs through two 1.4 kHz low-pass stages.
  - `showScreen()` hides only `home`, `play` and `perform`.
  - The store key is `note-steps-v1`, with shape `{done:{[id]:{mistakes,at}}, names, perf, speed, clickTrack, latency}`.
  - Practice stars: 0 mistakes gives 3, up to 3 gives 2, otherwise 1.
- **`pitch.js`** has an uncommitted `beats` / dotted-note change from the Performance session.
- The tokens in `index.html` include `--gold` (light `#b97a06`, dark `#f2b84b`).
- The launch config is `note-steps` (python http.server on port 5173).

### 0.2 Precondition (hard)

Nothing in this plan starts until the Performance session has **committed** `app.js`, `index.html`, `pitch.js`, `songs.js`, `perform.js` and `perform.css`.

- WP0 checks with `git status --short`. Those files must be clean, and `perform.js` must be tracked.
- If they aren't, WP0 stops and reports that it is blocked.

### 0.3 Conflict resolutions (binding)

| Topic | Inputs disagreed | Decision |
|---|---|---|
| Module layout and interfaces | Ear design (`window.NS` with small hooks in app.js), Free-play design (`window.NoteSteps` hooks), Architecture (`core/*`, `NS.*`, plugin modes, hash router) | **Architecture wins.** Use `core/*` and `modes/*` with `window.NS`. `window.NoteSteps` survives only as a **compat shim** (`core/compat.js`) so `perform.js` runs **unmodified**. |
| Mic event timing | `pending.t` (Ear, Curriculum) vs `at` (Critic) | Input events carry both. `at` (audio-clock seconds, from `refineOnset`) is used for all timing. `tOnset` (perf ms) is derived from it. |
| Detector | Unchanged (Architecture) vs pitch-class voting and flush (Critic P0-2) | **Critic wins.** It is a shared change in `core/listener.js` that also benefits Perform. |
| Mastery model | Architecture (strength `s` with half-life, five statuses) vs Curriculum (acc EWMA plus Leitner box, `locked/new/learning/known` plus `rusty`) | **Curriculum wins on rules.** It is exposed through the Architecture-style API (`Mastery.*` pure, `NS.mastery.*` wrapper). The state name `unmet` becomes `locked`. There is no `familiar` state. |
| Units | Architecture (11 units, including B3, A3, F♯, B♭, G3) vs Curriculum (C4..G5 stepwise) | **Curriculum wins.** v1 is 11 units from C4 to G5. Below-C and accidental units are data-only later extensions. Notation still parses accidentals. |
| Label fading | Architecture (4 s / 10 s) vs Curriculum `labelDelay` | **Curriculum wins.** |
| Comfort labels | easy/good/stretch/locked vs Easy / Just right / Stretch / Tough / Locked | **Curriculum wins.** |
| Shape hints fading | Architecture (opacity from statuses and plays), Free-play (score 0..100), Curriculum (`S.shapes` acc/n, levels 0..2) | **Curriculum wins on rules.** Classification and drawing interfaces come from Architecture and Free-play. Free Play shows hints descriptively and records nothing. |
| Drill | Architecture (20 notes) vs Curriculum flash (15 cards, weighted deck) | **Curriculum rules**, under the Architecture mode name "Note Drill" (`modes/drill.js`). |
| Ear storage | Its own key `note-steps-ear-v1` vs Architecture `slices.ear` | Use **`slices.ear`** inside `note-steps-v2`. |
| Phrase marks in song strings | `|` (Ear) vs `/` phrase and `|` bar (Architecture) | **`/` = phrase break, `|` = bar line (cosmetic).** |
| Hear It First scheduler | Its own `listen.js` vs `NS.audio.playSequence` | Use `NS.audio.playSequence` and `NS.audio.playEvents`. The UI lives in Practice. |
| Ear First behaviour | Ear design vs Critic | All Critic **P0** fixes apply, plus the P1 items marked ★ in §3.7. Web MIDI, wired-headphone play-along and "Hum it" are deferred (§3.7.15). |
| Reading evidence from Ear | Reveal step B at weight 0.5 (Ear) vs `ear` = 0 (Curriculum) vs Critic's honesty point | Reveal B calls `record` with `source:'ear'`: weight 0, only `seen` increases. Practice opened from Ear uses `source:'hear'` (weight 0.6). |
| Song ids | Verified-library ids vs legacy ids | The **8 legacy ids stay canonical** for the same tunes. Perform best scores depend on them. New tunes use the verified ids. See §3.8. |
| Happy Birthday | Architecture said leave it out | **Keep it** (`birthday`). It is already shipped, it is in the verified list, and the 1893 melody by the Hill sisters is public domain. Credit it as "Mildred J. Hill and Patty Hill, 1893". |

---

## 1. Overview, home screen and mode map

### 1.1 Product summary

The user is an adult beginner. The phone sits propped on the piano and listens through the microphone, one note at a time, matching by pitch class. The app teaches reading through lots of easy, comprehensible reading (in the spirit of LingQ). Each new step adds only 1 or 2 notes. Name labels fade per note as each note is learned. Shape hints (step, skip, leap) fade by interval type. Ear First adds an ear-first path inspired by the Suzuki method. Free Play is a sandbox, and Hear It First lets the user hear any song before reading it. Perform (built in the other session) is left as it is.

### 1.2 Routes (hash router in `core/shell.js`)

| Route | Owner | Purpose |
|---|---|---|
| `#/` | shell | Home |
| `#/songs/:mode` | shell | Library for `practice`, `ear` or `perform` |
| `#/practice/:songId[?from=ear]` | practice | Read at your own pace, with Hear It First |
| `#/practice/run?seed=N` | practice | Generated reading run (`NS.songs.run(seed)`) |
| `#/ear` | earfirst | Ear First Hub |
| `#/ear/:songId[?step=listen\|echo\|whole\|see\|remix]` | earfirst | Ear First tune screens |
| `#/ear/room` | earfirst | Listening Room |
| `#/ear/remix` | earfirst | Rhythm Remix (R1/R2 onboarding) |
| `#/ear/concert` | earfirst | Concert |
| `#/perform/:songId` | perform.js via compat | Performance (unchanged) |
| `#/free` | freeplay | Free Play |
| `#/drill[?meet=F4,G4][?focus=E4][?weak=1][?check=1\|E4]` | drill | Note Drill, Meet a note, Note check |
| `#/notes` | mynotes | My notes dashboard |

An unknown route or song id goes to Home and shows the toast "That song isn't here any more."

All URLs are relative, because GitHub Pages serves the app from `/note-steps/`. Hash routing needs no server configuration.

### 1.3 Home (375 px first, one column, top to bottom)

1. **Hero**: the existing small staff and the "Note Steps" wordmark.
   - **Today strip** below it: a row of 11 tiny dots coloured by note state, plus the text "7 notes known · 2 learning". Tapping it goes to `#/notes`.
   - New user: "Your first notes are middle C and D."
2. **Note check invite**, shown only when `course.checkDone === false` after a v1 migration. "Welcome back! Take a 2-minute note check so the app knows what you can already read." Button **Take the check** goes to `#/drill?check=1`. A **Not now** link hides it for 7 days.
3. **Up next card**, from `Curriculum.nextStep()`.
   - Eyebrow "Up next". Title, for example "Meet a new note: A", "Read: London Bridge" or "A short reading run". Subtitle, for example "A sits in the second space, one step up from G." or "Just right · 92% known".
   - One primary button **Start**. Below it, "or try:" with up to 2 alternative song links.
4. **Quick note drill card**, shown when at least one introduced note is new, rusty, or learning with acc < 0.8.
   - "Quick note drill · 2 min", subtitle listing the notes ("F, A"). Goes to `#/drill`.
5. **Mic bar**: `NS.ui.micBar`, the same component on every screen. "🎤 Start listening" plus a level meter.
6. **Modes grid**: 2 columns, generated from `NS.modes.list()` (sorted by `order`), each tile at least 88 px tall.

   | order | id | Title | Blurb | Extra chip |
   |---|---|---|---|---|
   | 1 | practice | Practice | Read at your own pace | none |
   | 2 | ear | Ear First | Listen, copy, then see it written | "Day 4 of listening" if streak > 0 |
   | 3 | perform | Perform | Play along in time | none |
   | 4 | drill | Note Drill | Quick single notes | "2 to review" if any are rusty |
   | 5 | free | Free Play | See what you play | none |
   | 6 | notes | My notes | What you know so far | "7 / 11" |

7. **Songs for you**: the top 5 from `Curriculum.recommend()` (its main song plus alternatives), then more by score.
   - Each row: title, origin, comfort pill, "92% known", and any per-mode badges.
   - Tapping a row opens the **song sheet** (§3.8.4). A link **Browse all songs** goes to `#/songs/practice`.
8. **Settings row**, which opens the settings sheet:
   - Note names: Auto / All / Off
   - Shape hints: Auto / Always / Off
   - Key labels on the on-screen keyboard: On / Off
   - Hear tunes first: Ask / Always
   - Sound check and Mic check buttons
   - Reset note progress (asks for confirmation)
   - When names are set to All, the hint "With names always shown, notes stay in Learning."
9. The existing middle-C tip, the "Play one note at a time" tip, and the desktop QR block, all unchanged.

### 1.4 Mode map

```
Home ─┬─ Up next ─────────────► Drill(meet) | Practice(song) | Practice(run)
      ├─ Practice ─► #/songs/practice ─► #/practice/:id ──(Listen ▶ = Hear It First)
      ├─ Ear First ─► Hub ─► Listening Room · Remix · tune: Listen → Echo → Whole → See → Read(Practice ?from=ear) → Polish/Concert
      ├─ Perform ───► #/songs/perform ─► #/perform/:id   (perform.js, unchanged)
      ├─ Note Drill ► 15-card deck · Meet a note · Note check
      ├─ Free Play ─► live staff of whatever you play, playback, "I know that tune!"
      └─ My notes ──► note map, chips, detail sheet (Drill this note / I already know this)
Shared engines: NS.input (mic+screen) · NS.audio (synth, sequences, cues) · NS.mastery · NS.staff · Shapes
```

---

## 2. Module and file plan, work packages and interfaces

### 2.1 File tree, owners and phases

| Phase | WP | Agent | Owns (creates or edits **only** these) |
|---|---|---|---|
| — | Perf | Performance session | `perform.js`, `perform.css`. No edits are required by this plan. |
| **0 (first, alone)** | WP0 | Skeleton and split | `index.html`, `app.js`, `core/ns.js`, `core/util.js`. Creates **all** other files below as working moves or stubs (§2.6). Owns `index.html` and `app.js` until WP10. |
| 1 | WP1 | Audio and input | `core/listener.js`, `core/audio.js`, `core/keyboard.js`, `tests/listener.test.js`, `tests/pitch.test.js`, `tests/synth.js` |
| 1 | WP2 | Notation, staff, shapes | `core/notation.js`, `core/shapes.js`, `core/staff.js`, `tests/notation.test.js`, `tests/shapes.test.js` |
| 1 | WP3 | Learning model | `core/store.js`, `core/mastery.js`, `core/curriculum.js`, `tests/store.test.js`, `tests/mastery.test.js`, `tests/curriculum.test.js` |
| 1 | WP4 | Library | `songs.js`, `tests/songs.test.js` |
| 1 | WP5 | Shell, UI, compat | `core/ui.js`, `core/ui.css`, `core/shell.js`, `core/compat.js` |
| 1 | WP6 | Practice and Hear It First | `modes/practice.js`, `modes/practice.css` |
| 1 | WP7 | Ear First | `modes/ear-core.js`, `modes/earfirst.js`, `modes/earfirst.css`, `tests/ear-core.test.js` |
| 1 | WP8 | Free Play | `modes/freeplay-core.js`, `modes/freeplay.js`, `modes/freeplay.css`, `tests/freeplay.test.js` |
| 1 | WP9 | Mastery UX | `modes/drill.js`, `modes/mynotes.js`, `modes/mastery.css` |
| **2 (last)** | WP10 | QA and integration | `tests/fakemic.js`, `tests/e2e.js`, `README.md`. Takes over `index.html` and `app.js`. Reports bugs to owners and does not edit their files. |

**Rules:**

- An agent never edits a file it doesn't own. If an interface needs to change, send the request to the owner. The owner updates the signature, this spec's §2.4 contract, and the stub together.
- `pitch.js` is **frozen**. Nobody edits it. `core/notation.js` is a superset of it.
- Phase 1 agents work against the WP0 stubs (safe no-ops with the final signatures) and their own Node tests.
- No bundler. Plain `<script>` tags. Pure modules use the UMD pattern so `node --test tests/` can `require()` them. All pure functions take `now` (ms) and `rng` as parameters, never `Date.now()` or `Math.random()` directly.
- No new CDN libraries. The existing qrcodejs is the only one.

### 2.2 Load order (`index.html`, fixed; WP0 writes it, WP10 maintains it)

```html
<!-- head, after the inline <style> with tokens + base CSS -->
<link rel="stylesheet" href="core/ui.css">
<link rel="stylesheet" href="modes/practice.css">
<link rel="stylesheet" href="modes/earfirst.css">
<link rel="stylesheet" href="modes/freeplay.css">
<link rel="stylesheet" href="modes/mastery.css">
<link rel="stylesheet" href="perform.css">
<!-- end of body -->
<div id="app"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js" defer></script>
<script src="pitch.js"></script>
<script src="core/util.js"></script>
<script src="core/ns.js"></script>
<script src="core/notation.js"></script>
<script src="core/shapes.js"></script>
<script src="core/mastery.js"></script>
<script src="core/curriculum.js"></script>
<script src="songs.js"></script>
<script src="core/store.js"></script>
<script src="core/listener.js"></script>
<script src="core/audio.js"></script>
<script src="core/keyboard.js"></script>
<script src="core/staff.js"></script>
<script src="core/ui.js"></script>
<script src="core/shell.js"></script>
<script src="core/compat.js"></script>      <!-- defines window.NoteSteps before perform.js -->
<script src="modes/practice.js"></script>
<script src="modes/ear-core.js"></script>
<script src="modes/earfirst.js"></script>
<script src="modes/freeplay-core.js"></script>
<script src="modes/freeplay.js"></script>
<script src="modes/drill.js"></script>
<script src="modes/mynotes.js"></script>
<script src="perform.js"></script>
<script src="app.js"></script>              <!-- NS.shell.start(); if NS.isTest load tests/fakemic.js -->
```

### 2.3 Shared conventions

**UMD template** (every pure module):

```js
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const Dep = isNode ? require('./notation.js') : root.NS.notation;
  const api = { /* pure */ };
  if (isNode) module.exports = api; else (root.NS = root.NS || {}).notation = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

`songs.js` sits at the repo root and requires `./core/notation.js`, `./core/curriculum.js` and `./core/util.js`. Test files require `../core/x.js`.

**`core/util.js`** (UMD, owned by WP0, frozen after WP0):

```js
Util.dayKey(ts)            // local date of (ts - 4h) as 'YYYY-MM-DD'  (practice after midnight counts for the previous day)
Util.addDays(dayKey, n)    // -> dayKey
Util.daysBetween(a, b)     // b - a in whole days (dayKeys)
Util.mulberry32(seed)      // -> rng() in [0,1)
Util.median(arr); Util.clamp01(x); Util.clamp(x, lo, hi)
Util.pc(midi)              // ((midi % 12) + 12) % 12
Util.hash(str)             // 32-bit FNV-1a -> 8-char hex (for planHash etc.)
```

**CSS tokens.** WP0 adds these to the inline `<style>` in `index.html`, in light `:root` and in the `@media (prefers-color-scheme: dark) :root` block:

| token | light | dark | use |
|---|---|---|---|
| `--learn` | `#a85f00` | `#f2b04c` | learning notes, rusty dot |
| `--learn-soft` | `#fbecd6` | `#3d2f17` | learning tint |
| `--listen` | `#b7791f` | `#f0b955` | "the app is playing" note/key |
| `--listen-soft` | `#fff1cc` | `#3d3220` | listen column |
| `--key-playing` | `#ffe7a3` | `#6b5420` | key lit during playback |
| `--shape` | `#7a8396` | `#8d96a8` | shape-hint ink |

There are no other new colours. Beads use `--gold`. Known uses `--good`, new uses `--accent`, and locked uses `--line`. Every state also has a text label, so colour is never the only signal. The SVG code reads colours through `NS.ui.tokens()` and re-renders on the `theme` bus event.

**Accessibility and layout:**

- Tap targets are at least 44 px. Chips are at least 36 px tall.
- Every screen keeps `document.documentElement.scrollWidth <= innerWidth` at 375 px.
- The existing `prefers-reduced-motion` rule stays. Any new motion (shake, bead slide, fade) needs a colour-only fallback.

### 2.4 Interfaces (exact)

#### 2.4.1 `core/ns.js` (WP0)

```js
NS.emitter() -> { on(evt, fn) -> off, once(evt, fn) -> off, emit(evt, payload) }
NS.bus                                   // app-wide emitter
NS.input = { on(fn) -> off, emit(ev), count() -> int }   // count() for leak tests
NS.modes = { register(def), get(id), list() }            // list sorted by def.order
NS.isTest = /[?&]test=1/.test(location.search)
NS.debug = { mode() -> object|null, inputListeners() -> int }   // filled by shell when isTest
NS.util = Util plus { $(id), svgEl(tag, attrs, parent), fmt(n), starText(s) }
// ns.js also emits: 'theme' {dark} on matchMedia change, 'resize' {width} debounced 120 ms,
// 'visibility' {hidden} on visibilitychange
```

**InputEvent**: the only shape that modes receive.

```js
{ midi:int,              // as heard (true octave from YIN; screen = key pressed)
  at:number,             // audio-clock seconds of the onset (mic: refineOnset; screen: NS.audio.heardAt(e.timeStamp))
  tOnset:number,         // performance.now() ms of the onset (mic: derived from at via ctxToPerf; screen: e.timeStamp)
  source:'mic'|'screen',
  confident:boolean,     // mic: reason==='agree'; screen: true
  reason:'agree'|'flush'|'timeout'|'tap',
  rms:number|null, cents:number|null }
```

**Bus events:**

| event | emitter | payload |
|---|---|---|
| `route` | shell | `{route, modeId, arg, query}` |
| `theme` / `resize` / `visibility` | ns | see above |
| `mic:state` | audio | `{on, reason?}` |
| `mic:level` | audio | `{rms}` (each hop) |
| `mic:onset` | audio | `{at, tOnset, rms}` (raw onset, before any pitch decision) |
| `mic:quiet` | audio | `{tOnset}` (signal fell below `gate*0.6` after an onset: note offset) |
| `audio:play-start` / `audio:play-end` | audio | `{kind:'tone'\|'sequence'\|'events', id?}` |
| `seq:note` | audio | `{seqId, i, note, tPerf}` |
| `mastery:changed` | mastery | `{key, before, after}` (states) |
| `note:known` / `note:unknown` | mastery | `{key}` |
| `unit:introduced` | mastery | `{unit, keys}` |
| `store:changed` | store | `{section}` |
| `practice:finished` | practice | `{songId, mistakes, stars, from:'ear'\|null, notes:int}` |
| `ear:stage` | earfirst | `{songId, stage}` |

**Mode contract:**

```js
NS.modes.register({
  id, title, blurb, order, icon /* inline SVG, currentColor */,
  needsSong: boolean,                  // tile -> #/songs/:id when true
  mount(root, params, ctx) {},         // root = fresh <main class="wrap" data-mode=id>; params = {arg, query:URLSearchParams}
  unmount() {},                        // MUST remove every NS.input / NS.bus / NS.mic subscription, timers, own sequences
  songBadge(songId) -> {text, tone:'good'|'learn'|'muted'} | null,   // library rows
  songLocked(songId) -> {locked:boolean, why?:string},               // optional
  tileChip() -> string|null,           // optional home tile chip
  debugState() -> object,              // e2e
});
// ctx = { go(route), back(), setTitle(text), store: NS.store.slice(id) }
```

The shell calls the current mode's `unmount()` and then `NS.audio.stopAll()` before **every** route change, and shows only the new mode's root. The shell hides **every** `main.wrap` that isn't the active one (this fixes Critic A3). The mic stays on across routes, and so does the wake lock while it is on.

#### 2.4.2 `core/listener.js` (WP1, UMD, pure)

This is a port of `tick()` with the Critic P0-2 fix.

```js
Listener.create({ detectPitch, freqToMidi, params? }) -> T
T.params = { minGate:0.008, floorMult:3, quietMult:0.6, retriggerMs:110, rise:1.7, riseRepeat:1.35,
             riseLookback:4, voteStartMs:35, centsTol:0.4, agree:2, timeoutMs:500, minHz:70, maxHz:1400 }
T.process(frame:Float32Array, nowMs, ctxTime, sampleRate, muted:boolean) -> Event[]
//  {type:'level', rms}                                       always
//  {type:'onset', tOnset:nowMs, at, rms}                      on onset
//  {type:'note', midi, cents, at, tOnset, tConfirm:nowMs, confident, reason, rms}
//  {type:'quiet', tOnset:nowMs}                               when quiet flips false->true
T.expect({ repeat:boolean })   // while true, the onset rule uses riseRepeat instead of rise
T.reset()
```

Algorithm:

1. Floor and gate update as today: `floor += (rms - floor) * (rms < floor ? 0.3 : 0.002)` and `gate = max(minGate, floor*floorMult)`.
2. When `muted`, clear `pending`, set `quiet = false` and return only the level event.
3. Onset rule: `rms > gate && now - lastOnset > retriggerMs && (quiet || rms > before*riseCur)`.
4. **On a new onset while `pending` exists (flush):** if `pending.votes` contains a pitch class with at least 2 votes, first emit that note with `reason:'flush'` and `confident:false`. Then start the new pending.
5. From `voteStartMs` onward, run YIN on every hop. Keep the rounded midi when it is within `centsTol` semitones of the nearest note.
6. **Vote by pitch class.** When the last `agree` (2) votes share a pitch class, emit at once with `reason:'agree'` and `confident:true`.
7. The reported `midi` is the most common octave among the votes in that pitch class. On a tie, take the most recent.
8. At `timeoutMs`: take the majority pitch class if it has at least 2 votes, `reason:'timeout'`, `confident:false`. Otherwise emit nothing.
9. `cents` is the mean deviation of the winning votes.

This makes the typical decision latency about 60 to 85 ms. Octave flips (60, 72, 60) no longer stall the decision, and fast notes are no longer lost.

#### 2.4.3 `core/audio.js` (WP1)

```js
NS.audio.ctx() -> AudioContext            // lazy; resume() if suspended
NS.audio.resume()                         // call synchronously inside every click handler (iOS)
NS.audio.outLatency() -> sec              // min(0.25, outputLatency||baseLatency||0)
NS.audio.heardAt(perfMs?) -> ctx sec      // identical to app.js heardAt
NS.audio.ctxToPerf(sec) -> ms ; NS.audio.perfToCtx(ms) -> sec
NS.audio.playTone(midi, dur=1.2, delay=0, {gain=0.3, muteMic=true, voice='synth'|'piano', dest}={}) -> {stop(), endPerf}
NS.audio.playSequence(items, {bpm=90, speed=1, startDelay=0.25, id, gain, voice:'synth',
                      onNote(i, note, tPerf), onEnd(reason)}) -> {stop(), done:Promise<'ended'|'stopped'>, endPerf}
//   items: Notation items (Note|Rest). i counts Notes only (rests skipped). dur per note = max(0.25, beats*spb*0.92).
//   onNote is fired by setTimeout at perf time  ctxToPerf(t_i) + outLatency*1000  (so lights match what you hear).
NS.audio.playEvents(events:[{midi, at /*sec from start*/, dur}], {startDelay=0.12, id, onNote(i, ev, tPerf), onEnd}) -> same handle
NS.audio.click(t, accent, freq)           // unchanged metronome pip (for perform); never mutes
NS.audio.cue('bead'|'good'|'done'|'bad'|'tick')  // 40–80 ms sine pips at 2.6–4.4 kHz, gain ≤0.08; NEVER touches mic mute
NS.audio.render(tracks:[{id, items, bpm, octaveShift=0}], {gapSec=1.5, voice='piano', drone=true, sampleRate=16000})
     -> Promise<{blob:Blob /*16-bit mono WAV*/, duration, layout:[{id, start, end, noteTimes:[sec]}]}>   // OfflineAudioContext
NS.audio.setSessionType('play-and-record'|'playback'|'auto')   // navigator.audioSession?.type, feature-detected; no-op elsewhere
NS.audio.stopAll(); NS.audio.isBusy() -> boolean               // busy = any tone/sequence/events still sounding
NS.audio.muteMicUntil(perfMs, {force=false})   // force=true may SHORTEN the mute (used by stop())
NS.audio.micMuted(perfMs=performance.now()) -> boolean

NS.mic.start() -> Promise<{ok:true}|{ok:false, reason:'unsupported'|'denied'|'error', message}>
NS.mic.stop(); NS.mic.isOn(); NS.mic.level() -> rms
NS.mic.on('note'|'onset'|'level'|'state'|'quiet', fn) -> off
NS.mic.expect({repeat:boolean})            // forwards to Listener.expect
NS.mic.setHopMs(ms=25)
NS.wake.hold(reason) / NS.wake.release(reason)   // ref-counted; re-acquired on visibility
```

Rules:

- **Mute tail.** Every tone, sequence or event batch mutes the mic until `end + 250 ms + outLatency·1000`. This fixes the Bluetooth case (Critic #19).
- `stop()` calls `muteMicUntil(now + 300, {force:true})`, so a stopped sequence releases the mic.
- **Mic routing.** Every mic `note` event is forwarded to `NS.input.emit({..., source:'mic'})`. The `onset` and `quiet` events are re-emitted on the bus as `mic:onset` and `mic:quiet`.
- The getUserMedia constraints and the two 1.4 kHz low-pass stages stay as they are today.
- Before `getUserMedia`, call `setSessionType('play-and-record')` (Critic P0-5).
- **Voice `'piano'`:** additive partials 1, 2, 3, 4 at gains 1, 0.45, 0.2, 0.08. Each partial decays exponentially with τ = 1.4 s / h. 8 ms attack, slight inharmonicity ×(1 + 0.0004h²). Used for renders and calls.
- **`drone`** (renders only): tonic and fifth an octave below the song's lowest note, at gain 0.08, on each bar's downbeat. It is our own, simple and original.

#### 2.4.4 `core/keyboard.js` (WP1)

```js
NS.keyboard.create(container, { low=60, high=76, labels:'all'|'none'|((midi)=>bool), emit=true, sound=true,
                                tapDur=0.4, onPress?(midi, e) }) -> K
K.setHeard(midi|null, ms=1400)        // folded into range; folded keys get a small ▲/▼ mark
K.setHint(midi|midi[]|null)           // green
K.setLit(midi[]|null, {tone:'call'|'guide'})   // call = --key-playing ; guide = --key-hint
K.setPlaying(midi|null)               // amber, during playback
K.setMarks({[midi]: 'new'|'learning'|'target'|'dim'})
K.setFingers({[midi]: 1..5} | null)   // small numerals above the key
K.setLabels(mode); K.setRange(low, high); K.destroy()
NS.keyboard.rangeFor(notes, {width}) -> {low, high}
//   white-aligned; at least C4..E5; extends to cover all notes (G3..G5 typical);
//   max whites: 13 when width < 420, 15 otherwise; notes beyond are folded and marked ▲/▼
```

`pointerdown` runs `NS.audio.resume()` and then plays `playTone(m, tapDur, 0, {muteMic:true})` when `sound` is on. With the defaults, the mic is muted for about 0.65 s plus outLatency, against 1.1 s today. It then emits `NS.input.emit({midi, at:heardAt(e.timeStamp), tOnset:e.timeStamp, source:'screen', confident:true, reason:'tap'})` when `emit` is on, and calls `onPress(midi, e)`.

#### 2.4.5 `core/notation.js` (WP2, UMD)

```js
Notation.parseToken(tok) -> Note | Rest
//  'F#4:q.' -> {kind:'note', letter:'F', acc:'#', octave:4, midi:66, pc:6, staffPos:3, dur:'q.', beats:1.5, key:'F#4'}
//  'Bb4' -> acc:'b', midi:70, staffPos:6 ; 'E4' -> acc:'' ; 'R:h' -> {kind:'rest', dur:'h', beats:2}
//  default dur 'q'; durations w h q e s with optional '.'; accepts # b ♯ ♭.
//  For naturals: midi/staffPos/beats/letter/dur identical to Pitch.parseNote.
Notation.parseMelody(str, {beatsPerBar=4, pickup=0}) ->
  { items:(Note|Rest)[], notes:Note[] /* rests removed; each has .beat (start) and .i */,
    endBeat, phrases:[[from, toExclusive]] /* note indices */, marked:boolean, bars:number[] /* note idx after each '|' */ }
//  '/' = phrase break, '|' = bar (cosmetic). No '/' -> phrases = autoPhrases(...)
Notation.autoPhrases(notes, {beatsPerBar, pickup}) -> [[from, to)]           // rules in §3.7.6
Notation.noteKey(note) -> 'F#4' ; Notation.fromKey('F#4') -> Note
Notation.samePitchClass(a, b) -> boolean
Notation.spellMidi(midi, prefer='sharp'|'flat') -> Note
//   sharp: C C♯ D D♯ E F F♯ G G♯ A A♯ B ; flat: C D♭ D E♭ E F G♭ G A♭ A B♭ B
//   staffPos = octave*7 + letterIndex - 30 (same formula as parseNote)
Notation.foldToRange(midi, low, high) -> midi
Notation.placeOnStaff(midi, {mode:'heard'|'fold', prefer}) -> {note /*as drawn*/, heard /*true spelling*/, fold:-2..2, zone:'core'|'ledger'|'folded'}
//   heard: true octave if staffPos in [-5, 12] (G3..C6); zone 'core' for [-2, 9]; else 'ledger'.
//   Outside [-5, 12]: fold by octaves into [-2, 9] and set fold (+ = real note higher than drawn).
//   fold mode: always fold into [-2, 9], fold reported as 0, zone 'core'.
Notation.describePosition(note) -> string   // plain wording, never a mnemonic:
//   staffPos 0,2,4,6,8: 'on the bottom line','on the second line','on the middle line','on the fourth line','on the top line'
//   1,3,5,7: 'in the first space' … 'in the fourth space'; -1 'just below the bottom line'; 9 'just above the top line'
//   -2 'on a short line below the staff'; -3 'just below that short line'; -4 'on the second short line below the staff'
//   -5 'below the second short line'; 10 'on a short line above the staff'; 11 'just above that short line'
//   12 'on the second short line above the staff'
Notation.RANGE = { low:'G3', high:'C6' }
```

#### 2.4.6 `core/shapes.js` (WP2, UMD, pure)

```js
Shapes.classify(a, b) -> { kind:'same'|'half'|'step'|'skip'|'leap', dir:-1|0|1, dist, num, short, long }
//  d = b.staffPos - a.staffPos; dist=|d|; num=dist+1
//  d==0: kind = a.midi===b.midi ? 'same' : 'half' (dir from midi); |d|==1 step; 2 skip; >=3 leap
//  short: 'same' -> '=', 'half' -> 'half', 'step', 'skip', leap -> '4th','5th','6th','7th','8ve', '>8ve'
//  long:  'the same note','a half step up','a step up','a skip up','a leap up a 5th' (down variants)
Shapes.statKey(kind) -> 'same'|'step'|'skip'|'leap'     // 'half' tallies as 'step'
Shapes.typeLevel(stat:{n, acc}, statKey) -> 0|1|2
//  same: (n>=10 && acc>=0.9) ? 0 : 1
//  else: (n>=40 && acc>=0.9) ? 0 : (n>=15 && acc>=0.75) ? 1 : 2
Shapes.pairLevel({ typeLevel, stateA, stateB, setting:'auto'|'always'|'off', showIt:boolean, guard:boolean }) -> 0|1|2
//  off -> 0 ; always -> 2 ; showIt||guard -> 2 ;
//  L = typeLevel; if stateA==='known' && stateB==='known' && L<=1 -> 0 ; if either 'new' -> max(L,1)
Shapes.updateStat(stat, x /*1 read, 0 miss*/, w /*0.5|1*/) -> stat    // n += w; acc += 0.1*w*(x-acc)  (acc0 0.5)
Shapes.describe(a, b) -> 'Next note is a step up.'
Shapes.rescueText(a, b, nameVisible) -> "It's a skip up from E." (nameVisible) | "It's a skip up from the last note."
```

#### 2.4.7 `core/staff.js` (WP2, browser)

**Geometry for every mode except Perform:**

- Notes: STEP 6, notehead ellipse rx 7.2 ry 5.2 rotated −20°, stems 36 long, stems flip at staffPos ≥ 4.
- Vertical: `BOTTOM = 108` (bottom line), so the lines sit at y 108, 96, 84, 72, 60. C6 is at y 36 and G3 at y 138.
- Horizontal: left margin 74, spacing 52.
- Labels at y 162. viewBox height **172**, or **200** with the shape band.
- Shape band: arrow centre y 180, word y 195.
- The 8va / 8vb badges sit at y 14 and y 158 (`8vb` sits above the label row; with labels on, the label moves to y 168).

```js
NS.staff.create(svg, {width, height, bottom=108}) -> S
S.clear(); S.drawStaff({clef:true, endBar:true}); S.y(staffPos) -> y
S.drawNote(note, x, {color, hollow?, label?, labelOpacity?, accidental:true, fold?, zone?, finger?}) -> <g>
S.drawHighlight(x, {fill}) ; S.drawCursor(x) ; S.drawBracket(x1, x2, label, color)
S.drawShape(xA, noteA, xB, noteB, {level:1|2, color, rescue:boolean}) ; S.drawRest(x, beats, color) ; S.drawBarline(x)
S.group() -> <g>
NS.staff.render(svg, opts) -> {pageStart, pageSize, xOf(i)}
opts = {
  notes, current:int|-1, paging:'page'|'follow'|'none', pageOf?:int /*override focus index for paging*/,
  state(i) -> 'done'|'current'|'bad'|'upcoming'|'ghost'|'listen',
  label(i) -> string|null, labelOpacity(i) -> 0..1,
  tint(i) -> 'new'|'learning'|null,
  shapes(i) -> {level:0|1|2, emphasis:boolean, rescue:boolean} | null,    // hint between i-1 and i
  brackets?: [{from, to, label}], revealUpTo?: int, finger?(i) -> 1..5|null,
  onTapNote?(i), ariaLabel
}
NS.staff.perPage(containerWidth) -> clamp(4, 10, floor((w-60)/44))     // same as today (6 at 375 px)
NS.staff.legacy = { STEP:6, BOTTOM:96, drawNote(parent, x, note, showName), drawStaffLines(svg, x1, x2) }
//   byte-for-byte the app.js output (used by perform.js through compat; DO NOT change)
```

- Hollow heads use `note.dur[0] === 'h' || 'w'`. This fixes dotted halves, which are drawn filled today.
- Dots: r 1.9 at x+12, raised into the space above when the note sits on a line.
- Accidentals are drawn as paths, using the free-play design §1.3 geometry, not font glyphs.
- When the shape band is on, the band is part of the SVG height, so nothing above it moves.

#### 2.4.8 `core/store.js` (WP3, UMD for `migrate` / `fresh`)

```js
Store.KEY = 'note-steps-v2'; Store.LEGACY_KEY = 'note-steps-v1'
Store.fresh(now) -> StateV2
Store.migrate(rawV2:string|null, rawV1:string|null, {now, songs}) -> {state, backup?:string}   // pure; §4
NS.store.state()                       // read-only view
NS.store.settings() ; NS.store.setSetting(key, value)        // emits store:changed {section:'settings'}
NS.store.slice(name) -> { get(), set(obj), update(fn) }       // names: practice ear free drill shell perform
NS.store.section(name) -> live object  // 'notes' | 'course' | 'shapes' | 'log' (NS.mastery only)
NS.store.save()                        // debounced 500 ms
NS.store.flush()                       // immediate; also on visibilitychange hidden + pagehide
NS.store.persistent() -> boolean       // false when localStorage throws (in-memory + one-time toast)
NS.store.reset('notes'|'all')          // 'notes' clears notes, shapes, course only
// storage event for KEY from another tab -> reload state, emit store:changed {section:'*'}
```

#### 2.4.9 `core/mastery.js` (WP3, UMD pure plus browser wrapper)

```js
Mastery.W_SRC = { song:1, intro:1, flash:1, hear:0.6, perform:0.5, ear:0, free:0 }
Mastery.INTERVALS = [0,1,2,4,8,16,32]
Mastery.T = { acc0:0.5, alpha:0.15, knownAcc:0.85, demoteAcc:0.6, knownStreak:5, knownRt:3000, knownReads:12, knownBox:2, newSeen:4 }
Mastery.newRecord(today) -> NoteRecord
Mastery.songFactor(plays) -> plays<3 ? 1 : plays<=5 ? 0.7 : 0.5
Mastery.rollDay(rec, now) -> rec                         // §3.2.4
Mastery.record(rec, ev, now) -> { rec, change:'known'|'unknown'|null }   // §3.2.3; pure, returns a new object
Mastery.state(rec|undefined) -> 'locked'|'new'|'learning'|'known'
Mastery.rusty(rec, now) -> boolean
Mastery.labelDelay(rec, {labels, refresh:int, guard:boolean}) -> ms | Infinity   // §3.2.5
Mastery.pct(rec) -> 0..100                                // display ring
Mastery.fam(rec, now) -> 0..1                             // comprehension weight, §3.8.2

// browser wrapper
NS.mastery.record(ev)          // ev: {key, outcome:'read'|'assisted'|'miss', source, rtMs, repeat, playedKey, songPlays,
                               //      confident, firstToken, ts}
NS.mastery.get(key); NS.mastery.state(key); NS.mastery.rusty(key); NS.mastery.all()
NS.mastery.summary() -> {known, learning, new, locked, rusty}
NS.mastery.labelDelay(key, ctx)
NS.mastery.shapeLevel(noteA, noteB, ctx:{showIt, guard}) -> 0|1|2
NS.mastery.recordShape(noteA, noteB, outcome, shownLevel)   // x: read 1, miss 0, assisted skipped; w = shownLevel===2 ? 0.5 : 1
NS.mastery.introduce(unitIdx); NS.mastery.introduced() -> keys[]; NS.mastery.introGate() -> 'open'|'soft'|'closed'|'done'
NS.mastery.applyPlacement(results)   // §3.3.4
```

#### 2.4.10 `core/curriculum.js` (WP3, UMD, pure)

```js
Curriculum.UNITS = [ {notes:['C4','D4'], stage:1}, {notes:['E4'], stage:1}, {notes:['F4'], stage:2}, {notes:['G4'], stage:2},
                     {notes:['A4'], stage:3}, {notes:['B4'], stage:3}, {notes:['C5'], stage:3},
                     {notes:['D5'], stage:4}, {notes:['E5'], stage:4}, {notes:['F5'], stage:4}, {notes:['G5'], stage:4} ]
Curriculum.STAGES = ['Middle C home', 'Up to G', 'Up to treble C', 'Top of the staff']
Curriculum.UNIT_OF = {C4:0,D4:0,E4:1,F4:2,G4:3,A4:4,B4:5,C5:6,D5:7,E5:8,F5:9,G5:10}
Curriculum.NOTE_INFO = { C4:{text, anchor:null}, …, A4:{text:'Second space.', anchor:{from:'G4', dist:'step up'}}, … }  // §3.2.1
Curriculum.songLevel(song) -> max UNIT_OF over song.keys (Infinity if any key not in UNIT_OF)
Curriculum.songDiff(song) -> number          // distinct + 6*leapRate + 3*skipRate + len/40 + 0.5*(#dotted/eighth types)
Curriculum.comfort(song, S, now) -> {label:'locked'|'easy'|'right'|'stretch'|'tough', C, knownShare, lockedKeys, newKeys}
Curriculum.introGate(S, now) -> 'open'|'soft'|'closed'|'done'
Curriculum.introduce(S, unitIdx, today) -> S
Curriculum.recommend(S, songs, now) -> {kind:'meet', unit} | {kind:'song', song, alts} | {kind:'run'}
Curriculum.nextStep(S, songs, now) -> {kind:'check'|'meet'|'song'|'run', title, sub, route}
Curriculum.genPhrase(poolKeys, focusKeys, {len=12, focusShare=0.35, seed}) -> token string
Curriculum.readingRun(S, seed) -> token string     // 16 notes, focusShare 0.15 on learning notes
Curriculum.flashDeck(S, {focusKey=null, size=15, rng, now}) -> keys[]
Curriculum.placementOrder(S) -> keys[]             // introduced notes, or C4..G5 by unit for a new user
```

#### 2.4.11 `songs.js` (WP4, UMD)

```js
// raw entry (source of truth in the file)
{ id, title, origin, pd:true, kind:'song'|'exercise', tags:['folk'|'classical'|'holiday'|'kids'],
  family?:string, grade:1..5 /* verified-library grade, display only */,
  bpm, beatsPerBar, pickup?:0, music:'E4 D4 C4:h / E4 D4 C4:h / …' }
// parsed Song (cached)
Song = raw + { index, notes /*Notation notes with beat; NO rests*/, items, endBeat, phrases, keys:string[] /*distinct*/,
               unit /*Curriculum.songLevel*/, stage /*1..4 or 'extra'*/, diff, blurb /*generated: 'Uses C D E G'*/, source /*= music*/ }
window.NoteSongs = { levels:[{title}], songs:Song[] /* sorted, index = position */, parseNotes(str) }   // KEEP (perform.js)
NS.songs.all(); NS.songs.get(id) /* also resolves 'etude-u{u}-{k}' and 'run-{seed}' */ ; NS.songs.byStage() -> {1:[…],2,3,4,extra}
NS.songs.etudesFor(unit, n=5) -> Song[]      // Curriculum.genPhrase(pool=keys of units<=unit, focus=unit notes, seed=unit*100+k)
NS.songs.moreLike(song, seed) -> Song        // genPhrase over song.keys
NS.songs.run(seed, S) -> Song                // Curriculum.readingRun
NS.songs.LEGACY_IDS = ['scale-up','scale-down','mary','ode','twinkle','jingle','frere','birthday']
```

**Sort order (this defines `index`):** `(stage, unit, diff, title)`, with `extra` last. `NoteSongs.levels[k].title` is `'Stage k+1 · ' + STAGES[k]`, then `'Extras'`. `song.level` is set to the stage index, to stay compatible.

#### 2.4.12 `core/ui.js` (WP5)

```js
NS.ui.tokens() -> {paper, card, ink, muted, line, accent, accentSoft, good, goodSoft, bad, badSoft, gold, learn, learnSoft, listen, listenSoft, shape, keyPlaying}
NS.ui.frame(root, {eyebrow, title, back:true, right?:HTMLElement}) -> {body, setTitle(t), setEyebrow(t)}
NS.ui.feedback(container) -> {el, set(kind:'good'|'bad'|'neutral', big, small?)}   // aria-live=polite
NS.ui.micBar(container) -> {destroy}     // button + meter; updates every [data-mic-btn] [data-mic-meter-wrap] [data-mic-meter]
NS.ui.dialog({title, body, actions:[{label, value, primary}]}) -> Promise<value>
NS.ui.sheet({title, content:HTMLElement}) -> {close}
NS.ui.toast(text, {action?:{label, fn}, ms=3500})
NS.ui.chip(label, {pressed, onClick}) ; NS.ui.seg(options, value, onChange)
NS.ui.soundCheck() -> Promise<boolean>   // plays C5; "Did you hear that?" [Yes] [No] -> tip "Check the silent switch and the volume."
NS.ui.micCheck() -> Promise<{ok, heard:int[]}>   // "Play C, then E, then G." 10 s; ok when 3 pcs heard in order
```

#### 2.4.13 `core/shell.js` (WP5)

```js
NS.shell.start(); NS.shell.go(route); NS.shell.back(); NS.shell.current() -> {route, modeId, params}
NS.shell.songSheet(songId)               // §3.8.4
```

#### 2.4.14 `core/compat.js` (WP5): `window.NoteSteps` for `perform.js`

perform.js destructures these names at load time, so they are built eagerly:

```js
window.NoteSteps = {
  $, svgEl, fmt, starText,                     // NS.util
  store,                                       // live object, see below
  saveStore: () => NS.store.save(),
  songs: window.NoteSongs.songs,
  STEP: 6, BOTTOM: 96, drawNote: NS.staff.legacy.drawNote, drawStaffLines: NS.staff.legacy.drawStaffLines,
  outLatency: NS.audio.outLatency, heardAt: NS.audio.heardAt, audio: NS.audio.ctx, click: NS.audio.click,
  playTone: (m, d, delay) => NS.audio.playTone(m, d, delay),
  startMic: async () => (await NS.mic.start()).ok, isListening: NS.mic.isOn, micNotice: (t) => /* sets every .notice[data-mic-notice] incl #pNotice */,
  showScreen(id),                              // hide every main.wrap except #id; hide .overlay; scrollTo(0,0)
  setNoteHandler(fn),                          // replaces the previous handler; subscribes NS.input, calls fn(ev.midi, ev.at) for source 'mic' only;
                                               // auto-unsubscribed when the route leaves the legacy mode
  updateNamesButtons(),                        // every [data-names-toggle]: "Note names: on|off" (on = settings.labels !== 'never')
  foldToKeyboard: (m) => NS.notation.foldToRange(m, 60, 76),
  showHeard: (m) => legacyKeyboards.forEach(K => K.setHeard(m)),
  buildKeyboard(el, fn),                       // NS.keyboard.create(el, {emit:false, sound:false, onPress:fn}); kept in legacyKeyboards
  isUnlocked(i),                               // §3.8.5
  goHome: () => NS.shell.go('#/'), startMode: (id, i) => NS.shell.go(`#/${id}/${NoteSongs.songs[i].id}`),
  registerMode(def),                           // wraps a legacy def into NS.modes.register (below)
  debug: NS.debug,
  audioContext: NS.audio.ctx,                  // old test hook
};
```

- **`store` live object.** `perf`, `speed`, `clickTrack` and `latency` are getters and setters onto `NS.store.slice('perform')`. They return the live nested object, so `store.perf[id][speed] = …` followed by `saveStore()` persists.
  - `names` getter: `settings.labels !== 'never'`. Setter: `true` sets `'auto'`, `false` sets `'never'`.
  - `done` getter: `{[id]: practice.songs[id].best}` for songs that have a best (read-only).
- **Names toggle.** A delegated click on any `[data-names-toggle]` toggles `labels` between `'never'` and `'auto'`. It then calls `updateNamesButtons()` and the current legacy def's `onNamesChange()`.
- **`registerMode(def)`** registers `{id:def.id, title:def.label, blurb:'Play along in time', order:3, needsSong:true, legacy:true, …}`:
  - `mount(root, {arg})` hides `root`, finds the index from `arg` (the song id), and calls `def.start(index)`. perform.js shows its own `#perform`.
  - `unmount()` calls `def.stop()`.
  - `songBadge(id)` comes from `def.cardLine(song)`: `{text:'★★☆ ' + text}`.
  - `resize` and `visibility:hidden` bus events are forwarded to `def.onResize` / `def.onHidden` while the mode is mounted.

### 2.5 How Performance reads the library (no perform.js edits)

- perform.js reads `NoteSteps.songs`, which is the same array as `window.NoteSongs.songs`. It uses `songs[i]` and `song.index`, with fields `id, title, bpm, beatsPerBar, pickup, notes[{letter, midi, staffPos, dur, beats, beat}], endBeat`.
- WP4 guarantees these fields on every song, with rests excluded from `notes` but counted in `endBeat`. A test asserts this (§5.1).
- "Next song" in Perform is `index + 1` in the new sorted order. Best scores are keyed by id, so they carry over.
- Perform unlocks use `NoteSteps.isUnlocked(i)` (§3.8.5).
- Optional and not required: the Performance session may later call `NS.mastery.record({…, source:'perform'})` (weight 0.5) for notes hit in the timing window. It may also add a "Listen" demo using `NS.audio.playSequence`.

### 2.6 WP0: Skeleton and split (must go first; one agent)

Goal: **no behaviour change.** After WP0, Practice and Perform behave exactly as they do today, and every new file exists.

1. Check the precondition (§0.2).
2. Create `core/util.js` and `core/ns.js` in full (§2.3, §2.4.1).
3. **Mechanical moves** from `app.js`, keeping the code as close to verbatim as possible:
   - `tick` / `refineOnset` / onset state go to `core/listener.js` (wrapped in `Listener.create`, current constants, current 3-vote rule).
   - Audio, mic and wake lock go to `core/audio.js`, keyboard to `core/keyboard.js`, drawing to `core/staff.js` (as `legacy` plus a minimal `render`).
   - Store goes to `core/store.js`. In WP0 it still reads and writes `note-steps-v1` under the slice API. WP3 replaces it.
   - Home goes to `core/shell.js`, lessons to `modes/practice.js`, and the compat object to `core/compat.js`.
   - Move the `#home` / `#play` / `#doneOverlay` markup into JS templates in their new owners. Remove from `index.html` any markup that `perform.js` injects itself.
4. Create **stubs** with the final signatures and safe no-op bodies for `notation.js`, `shapes.js`, `mastery.js`, `curriculum.js`, `ear-core.js`, `earfirst.js`, `freeplay-core.js`, `freeplay.js`, `drill.js`, `mynotes.js`, and all CSS files.
   - `NS.mastery.record` does nothing. `NS.mastery.state` returns `'new'`. `Curriculum.recommend` returns `{kind:'run'}`.
   - Each mode stub registers with a placeholder screen "Coming soon".
5. `index.html`: add the tokens (§2.3), `<div id="app">`, and all tags (§2.2).
6. `app.js` becomes only `NS.shell.start(); if (NS.isTest) { const s = document.createElement('script'); s.src = 'tests/fakemic.js'; document.body.append(s); }`.
7. `tests/` gets a smoke `tests/pitch.test.js` (YIN on a 440 Hz sine), and `package.json` gets `"scripts":{"test":"node --test tests/"}`. Add `package.json` to WP0's owned files.

**Acceptance:**

- `node --test tests/` passes.
- On `localhost:5173`, at 375 px, light and dark: Practice works for Mary, and Perform starts, counts in and scores with taps.
- `NoteSteps.isUnlocked(1)` matches today.
- There are no console errors.
- Nothing is written to `note-steps-v2` yet.

### 2.7 WP10: QA and integration (last)

1. Pull every WP. Run `node --test tests/`. Run `tests/e2e.js` (§5.2) through the Browser pane with launch config `note-steps`, at `http://localhost:5173/?test=1`.
2. Check at 375×812, light and dark, on every route (§5.2 S20).
3. File bugs to the owners as `file:line, expected, actual`. WP10 edits only `index.html`, `app.js`, `README.md` and the `tests/` harness files.
4. Update `README.md` with the file map and the `npm test` and e2e instructions.
5. Write the manual real-piano checklist (§5.3) for the user.

---

## 3. Feature specs

### 3.1 Practice and Hear It First (WP6)

#### 3.1.1 Screen (`#/practice/:songId`)

**Top bar:**
- Back.
- Eyebrow `Practice · Stage 2`, or `Practice · You know this one by ear` when opened from Ear.
- Title.
- Count `8 / 26`.

**Intro card** (shown on mount; dismissed by Start):
- Title, origin, comfort pill, and note chips coloured by state (e.g. "Uses C D E G").
- Buttons **Hear it first** and **Start reading**.
- With `?from=ear` the subtitle is "You already know how this sounds. Now see what it looks like."
- If `settings.hearFirst === 'always'`, or (`'ask'` and the song has never been played and was never listened to), the **Hear it first** button is the primary button.

**Body:**

1. Staff card.
2. Progress bar.
3. Feedback.
4. Mic bar.
5. **Listen row:** `▶ Listen` · seg [Whole tune | This part] · chip `Speed 100%`.
6. Controls: Hear the note · Show me the key · `Names: auto` chip · `Shapes: auto` chip.
7. Keyboard, sized by `NS.keyboard.rangeFor(song.notes)`.

#### 3.1.2 Hear It First

- **Range:**
  - *Whole tune* plays notes `0..n`.
  - *This part* plays the phrase that contains `current` (from `song.phrases`).
- **Speed** cycles 100% → 75% → 50%. It is saved to `slices.practice.listen.speed`. The scope is saved to `.scope`.
- `▶ Listen` calls `NS.audio.playSequence(itemsInRange, {bpm: song.bpm, speed, voice:'piano', onNote})`. While playing, the button reads `■ Stop`.
  - Feedback: big `Listen: {title}` (or `Listen: this part`), small "Follow the notes with your eyes. Your mic is paused."
- **`onNote(i)`:**
  - The staff pages to the playing note (`render({pageOf: from+i})`) and draws it in `--listen` with a `--listen-soft` column. The current-note column is hidden during playback.
  - `K.setPlaying(midi)` lights the key.
- **On end:**
  - The listen focus clears.
  - Feedback returns to the prompt, with small text "Your turn. Start from the blue note."
  - A completed whole-tune listen does `slices.practice.listened[id]++`.
- **Stop triggers:** a screen key tap, Back, Hear the note, the done overlay opening, `visibility:hidden`, or a route change (`stopAll`).
- **Input while playing:** `NS.input` events that arrive while `NS.audio.isBusy()` are ignored. The mic is muted anyway; this check also catches taps.
- **Mastery effect:** every note index that was played in a Listen during this run joins `heardIdx`. A later occurrence at an index in `heardIdx` is recorded with `source:'hear'` instead of `'song'`. When the route has `?from=ear`, every note uses `'hear'`.
- **First-time hint** when the song has never been listened to: small feedback "New tune. Tap ▶ Listen to hear it first."

#### 3.1.3 Reading loop: per-occurrence attempt state

State `att = {start, labelAt:null, wrong:0, hinted:false, heardNote:false, playedKey:null, lastCorrectAt}`. It resets when `current` changes, with `start = max(performance.now(), NS.audio micMuted-until)`.

- **Label timer.** `delay = NS.mastery.labelDelay(key, {refresh: refresh[key]||0, guard})`. The label fades in after `delay` (300 ms fade, opacity 0.8). Set `att.labelAt = now` when it shows. `Infinity` means it never shows.
- **Upcoming notes on the page** show a label only when their delay is 0. **Played notes** keep a muted label, as they do today.
- **Prompt text must not leak names.** `promptText()` says `Play {letter}` only while the current label is visible. Otherwise it says "Play the blue note". "Yes! That was E." after a correct note is fine.
- **Wrong note** (pitch class differs):
  - Show `.feedback.bad` as today, with the direction hint ("further to the right/left").
  - The label shows immediately (show it and retry). Set `refresh[key] = 2`.
  - Set `att.wrong++` only if `ev.confident` and `ev.tOnset - att.lastCorrectAt > 300`. This protects against sustain bleed.
  - `mistakes++` follows the same rule.
  - Record `playedKey` for the first wrong note, spelled at the octave nearest the target.
  - After the 2nd counted wrong note, the key hint shows automatically.
- **Hint use:**
  - "Show me the key" sets `att.hinted = true`.
  - "Hear the note" sets `att.heardNote = true`. That makes the outcome at least `assisted`.
- **Correct note:**
  - `outcome = (att.wrong || att.hinted) ? 'miss' : (att.labelAt && ev.tOnset >= att.labelAt) || att.heardNote || settings.labels==='always' ? 'assisted' : 'read'`.
  - Call `NS.mastery.record({key, outcome, source, rtMs: ev.tOnset - att.start, repeat: key===prevKey, playedKey: att.playedKey, songPlays: plays, confident:true, firstToken: current===0, ts:Date.now()})`.
  - Then, if `current > 0`: `NS.mastery.recordShape(prev, target, outcome, shownLevel)`.
  - Then `current++`. Decrement `refresh[key]` when it is above 0.
- **Shape hints:** `shapes(i)` gives `{level: NS.mastery.shapeLevel(notes[i-1], notes[i], {showIt: flash && i===current, guard}), emphasis: i===current, rescue: flash && i===current}`, but only for `i` in `[current, current+3]`. Other notes get `null`.
  - On a wrong note, append `Shapes.rescueText(prev, target, labelVisible)` to the small feedback text.
- **Mastery tint:** upcoming notes in state new or learning get `tint` behind them.
- **Session guard:** track the last 10 judged occurrences. If the first-try rate drops below 0.7, set `guard = true` for the rest of the run. Learning notes then get label delay 0 and shape level 2. Feedback small text: "Names are back on for the tricky notes."
- **Known toast:** on `note:known`, toast "You know {L} now. Its name will stay hidden."

#### 3.1.4 Finish

- Update `slices.practice.songs[id]`: `plays++`, `last`, `best` (fewer mistakes wins), `stars` (0 → 3, ≤3 → 2, else 1), and `ftp` = first-try share.
- Update `log[today]` with `{r, m, ms}`.
- Emit `practice:finished`.
- **Dialog:**
  - Stars, title, text (as today).
  - "Getting stronger: E, F" for notes whose `acc` rose by at least 0.05.
  - "New: you know E now" for notes promoted during the run.
  - Guard summary: "Try a quick drill on F and A" when any miss happened.
- **Buttons:**
  - Play again.
  - **Another short one** (`NS.songs.moreLike(song, Date.now())`).
  - Next song (the first from `recommend` other than this one).
  - All songs.
  - With `from=ear`: also **Read a new tune with these notes** (Ear's cold read, §3.7.10).
- The done chime is `NS.audio.cue('done')`, which does not mute the mic.

**Acceptance (Practice and Hear It First):**

- Listen plays the whole tune or the current phrase at 100/75/50%. The playing note is amber on the staff and keyboard. Plucks during playback are ignored. The first pluck 300 ms after Stop is judged.
- The prompt never shows a letter for a note whose label is hidden.
- A note played before its label appears is recorded as `read`. One played after the label appeared is `assisted`. A note preceded by a confident wrong note is a `miss`. A wrong note with `confident:false` gives feedback but no `miss`.
- Notes in a listened range are recorded with `source:'hear'`. `?from=ear` records all notes as `'hear'`.
- Legacy song ids open, and stars carry over after migration.

### 3.2 Per-note mastery and curriculum (WP3; rules are binding)

#### 3.2.1 Note order and facts

Units (index: notes): `0: C4 D4 · 1: E4 · 2: F4 · 3: G4 · 4: A4 · 5: B4 · 6: C5 · 7: D5 · 8: E5 · 9: F5 · 10: G5`.

Stages: 1 = units 0–1, 2 = 2–3, 3 = 4–6, 4 = 7–10.

Landmarks are taught as anchors, never with mnemonics:

| key | text | anchor |
|---|---|---|
| C4 | "Middle C. Its own short line below the staff." | none |
| D4 | "Hangs just below the bottom line." | {from:'C4', dist:'step up'} |
| E4 | "Bottom line." | {from:'D4', dist:'step up'} |
| F4 | "First space." | {from:'E4', dist:'step up'} |
| G4 | "Second line. The treble clef curls around it." | {from:'E4', dist:'skip up'} |
| A4 | "Second space." | {from:'G4', dist:'step up'} |
| B4 | "Middle line." | {from:'G4', dist:'skip up'} |
| C5 | "Third space. Treble C, an octave above middle C." | {from:'C4', dist:'octave up'} |
| D5 | "Fourth line." | {from:'C5', dist:'step up'} |
| E5 | "Top space." | {from:'C5', dist:'skip up'} |
| F5 | "Top line." | {from:'E5', dist:'step up'} |
| G5 | "Sits just above the top line." | {from:'F5', dist:'step up'} |

**Fast lane.** When the gate is `open` and every introduced note is known with `rt ≤ 1500`, the Meet card offers "Meet A and B together", which introduces two consecutive single-note units. That never means more than 2 new notes at once.

#### 3.2.2 States

| State | Rule |
|---|---|
| `locked` | no record |
| `new` | record, `seen < 4` |
| `learning` | `seen ≥ 4`, `k = 0` |
| `known` | `k = 1` |
| `rusty` (flag) | known and `today > due` (amber dot; the label stays hidden; extra drill weight) |

#### 3.2.3 Evidence (`Mastery.record`)

- **Outcomes:**
  - `read`: right on the first try, no hint, label not visible at onset.
  - `assisted`: right on the first try, but the label was visible, or "Hear the note" was used.
  - `miss`: one or more confident wrong notes before the right one, or "Show me the key" was used.
- **Weights:** `w = W_SRC[source] × songFactor(songPlays) × (repeat ? 0.5 : 1) × (assisted ? 0.5 : 1)`.

```js
function record(rec, ev, now) {
  if (!rec) return { rec, change: null };            // locked: ignore (never auto-introduce)
  rec = rollDay({ ...rec, day: rec.day && { ...rec.day }, conf: { ...rec.conf } }, now);
  if (ev.outcome === 'miss' && ev.confident === false) return { rec, change: null };
  let w = (W_SRC[ev.source] ?? 0) * songFactor(ev.songPlays || 0);
  if (ev.repeat) w *= 0.5;
  if (ev.outcome === 'assisted') w *= 0.5;
  rec.seen++;                                        // drives new -> learning even when w = 0
  if (w > 0) {
    const x = ev.outcome === 'read' ? 1 : ev.outcome === 'assisted' ? 0.7 : 0;
    rec.acc = clamp01(rec.acc + T.alpha * w * (x - rec.acc));
    rec.n += w;
    if (ev.outcome === 'read' && w >= 0.5 && !ev.repeat) {
      rec.streak++; rec.reads++; rec.day.r++;
      if (ev.rtMs != null && ev.rtMs <= 15000 && !ev.firstToken)
        rec.rt = rec.rt == null ? ev.rtMs : rec.rt + 0.25 * (Math.min(ev.rtMs, 8000) - rec.rt);
    } else if (ev.outcome === 'miss') {
      rec.streak = 0; rec.day.m++; rec.miss++;
      if (ev.playedKey) rec.conf[ev.playedKey] = (rec.conf[ev.playedKey] || 0) + 1;
    } else rec.asst++;
  }
  rec.last = ev.ts ?? now;
  return updateKnown(rec, now);                      // -> {rec, change}
}
```

#### 3.2.4 Spacing and promotion

```js
function rollDay(rec, now) {
  const today = dayKey(now);
  if (!rec.day) { rec.day = { d: today, r: 0, m: 0 }; return rec; }
  if (rec.day.d >= today) return rec;                // same day or clock went backwards
  const { d, r: g, m } = rec.day, tot = g + m;
  const good = g >= 3 && g / tot >= 0.8, lapse = tot >= 3 && m / tot > 0.34;
  if (good && d >= rec.due) { rec.box = Math.min(rec.box + 1, 6); rec.due = addDays(d, INTERVALS[rec.box]); }
  else if (lapse)           { rec.box = Math.max(0, rec.box - 2); rec.due = addDays(d, 1); }
  rec.day = { d: today, r: 0, m: 0 };
  return rec;                                        // record() then calls updateKnown
}
function updateKnown(rec, now) {
  const was = rec.k;
  if (!rec.k && rec.box >= 2 && rec.acc >= 0.85 && rec.streak >= 5 && rec.rt != null && rec.rt <= 3000 && rec.reads >= 12)
    { rec.k = 1; rec.knownAt = now; }
  else if (rec.k && (rec.acc < 0.6 || rec.box < 2)) rec.k = 0;
  return { rec, change: was === rec.k ? null : rec.k ? 'known' : 'unknown' };
}
```

`NS.mastery` also calls `rollDay` on every record when it loads (lazily), and emits change events.

Display ring percentage: `round(100*(0.5*acc + 0.2*min(streak/5,1) + 0.2*min(box/2,1) + 0.1*rtScore))`, where `rtScore = rt==null ? 0 : clamp01((6000-rt)/4000)`.

#### 3.2.5 Label fading (replaces the global names toggle)

`settings.labels` is `'auto' | 'always' | 'never'`. The UI chip cycles "Names: auto / all / off".

```js
function labelDelay(rec, { labels, refresh = 0, guard = false }) {
  if (labels === 'always') return 0;
  if (refresh > 0) return 0;
  if (labels === 'never') return Infinity;
  const st = state(rec);
  if (st === 'locked') return 0;
  if (st === 'known')  return Infinity;
  if (guard && st !== 'new') return 0;
  if (st === 'new') return rec.seen < 2 ? 0 : 1000;
  return rec.acc < 0.6 ? 1500 : rec.acc < 0.8 ? 3000 : 5000;
}
```

- Key labels on the keyboard follow a separate setting, `settings.keyLabels` (default on).
- The first time labels fade, show the one-time tip "Names fade as you learn each note. Wait a moment and the name appears."

#### 3.2.6 Introduction gate

```js
const MAX_LEARNING = 4;
function introGate(S) {
  const next = UNITS[S.course.unit]; if (!next) return 'done';
  const notKnown = introducedKeys(S).filter(k => state(S.notes[k]) !== 'known');
  const solid = notKnown.every(k => S.notes[k].acc >= 0.8 && S.notes[k].n >= 8);
  const okish = notKnown.every(k => S.notes[k].acc >= 0.7 && S.notes[k].n >= 6);
  if (solid && notKnown.length + next.notes.length <= MAX_LEARNING) return 'open';
  return okish ? 'soft' : 'closed';
}
function introduce(S, u, today) {
  for (const k of UNITS[u].notes) S.notes[k] ??= newRecord(today);
  // newRecord = {acc:0.5, n:0, seen:0, reads:0, miss:0, asst:0, streak:0, rt:null, box:0, due:today, k:0, intro:today, knownAt:0, last:0, day:null, conf:{}}
  S.course.unit = Math.max(S.course.unit, u + 1);
  return S;
}
```

Gate copy:

| Gate | Copy and behaviour |
|---|---|
| open | "Ready for a new note: A" |
| soft | "You're still settling in F and G. Meet A now, or practise first?" with buttons [Meet A] [Quick drill] |
| closed | The card is hidden. My notes has the link "Learn A anyway", which asks for confirmation. |
| done | "All 11 treble notes known. Next stage coming soon." |

#### 3.2.7 Recommendation and Next up

`Curriculum.recommend(S, songs, now)`:

- Candidates are songs with `unit < S.course.unit` and no locked key.
- Score each candidate:

```
  score = -20·|C−0.92| + 4·weakShare + (uses newest introduced note ? 1.5 : 0) + (plays==0 ? 2 : 0)
          − (played in the last 30 min ? 5 : 0) − 0.3·min(plays,10) − 0.05·max(0, len−40)
```

  - `weakShare` is the share of tokens that are learning with acc < 0.8, or rusty.
- If the gate is `open` and (there are no candidates or the best has `C ≥ 0.95`), return `{kind:'meet', unit}`.
- Else, with no candidates, return `{kind:'run'}`.
- Else return `{kind:'song', song: best, alts: next 2}`.

`nextStep` wraps it:

| Condition | kind | route |
|---|---|---|
| `!course.checkDone && migrated` | `check` | `#/drill?check=1` |
| `course.unit === 0` | `meet` | `#/drill?meet=C4,D4` |
| meet | meet | `#/drill?meet=<unit notes>` |
| song | song | `#/practice/:id` |
| run | run | `#/practice/run?seed=<dayKey hash>` |

#### 3.2.8 Meet a note (`#/drill?meet=A4`; source `intro`)

1. **Card:** a big staff with the new note in accent colour and its label, the NOTE_INFO text, and the anchor ("One step up from G"). Buttons [Hear it] [Next]. Not judged.
2. **Find it, 3 times:** only the new note, label shown. Outcomes are `assisted`, so `seen` goes up.
3. **Mixed phrase:** 12 notes from `genPhrase(introduced, newKeys, {len:12, focusShare:0.35, seed})`, under normal label rules.
4. **First song:** the lowest-diff song at the new unit's level, or a second generated phrase if there is none.

`genPhrase`:

- A seeded stepwise random walk over the pool, sorted by staffPos.
- Neighbour weights: step 0.6, skip 0.25, repeat 0.1, leap 0.05.
- With probability `focusShare`, jump to a focus note (when not already on one).
- Ends on the nearest of C4 / G4 / C5 that is in the pool, as a half note.
- Phrase marks every 4 notes.
- Same seed, same output.

**Acceptance (curriculum):** a brand-new user sees Meet C & D. After C, D, E and F are introduced and still learning, the gate keeps G closed until the solid rule holds, or the user confirms "Learn G anyway".

### 3.3 Note Drill (WP9, `modes/drill.js`, source `flash`)

#### 3.3.1 Deck (15 cards, about 2 minutes, untimed)

```js
// weight per introduced key
w = state==='new' ? 3 : state==='learning' ? 2 + 3*(1-acc) : 0.5;
if (rusty) w += 2; if (rt != null && rt > 3000) w += 1; if (isConfusionPartnerOfWeak(key)) w += 1.5;  // top-2 conf entries of weak notes
if (focusKey) w = key===focusKey ? 10 : |staffPos−focus.staffPos| <= 2 ? 3 : 0.3;
// draw with rng: never the same key twice in a row; ≥70% of cards from keys with acc>=0.6 or known
```

- A pool of 1 or 2 keys alternates them.
- With an empty pool, Drill is not offered and the route redirects to Meet.

#### 3.3.2 Card flow

- One whole note, centred on the staff (paging `'none'`). Labels follow `labelDelay`, but known notes never show one.
- **Correct:** green flash, then the name and position ("E, bottom line"), a 400 ms pause, then the next card.
  - A quick answer (under 1.5 s) gets the tag "quick!". There is never a countdown.
- **Miss** (show it and retry):
  - The label, the key hint and the NOTE_INFO line appear. The user plays until correct.
  - The same note is reinserted 3 cards later, at most twice per note per drill.
- Mastery is recorded exactly as in Practice, with `source:'flash'` and `songPlays:0`.
- **Summary:**
  - Heading "Note drill: 13 of 15 first try".
  - Rows like "F · 4/4 · 1.8 s", plus "faster than last time" when the run's average rt beats the stored rt.
  - Celebrate newly known notes.
  - Buttons [Again] [Back home].
  - Set `slices.drill.rounds++`, `lastAt`.

#### 3.3.3 Variants

- `?focus=E4`: the deck is focused on that note.
- `?weak=1`: the deck is restricted to the 4 weakest notes by `pct`.
- `?meet=…`: the Meet flow (§3.2.8).

#### 3.3.4 Note check (placement, `?check=1`, or `?check=E4` for "I already know this")

- **Order:** introduced notes, or for a new user C4 → G5 by unit. The check stops after 3 misses in a row. Each note gets 2 cards with no labels.
- **Per-note result:**
  - Both read in under 4 s: `introduce`, then set `acc 0.9, streak 5, reads 12, rt measured, box 2, due today+2, k 1` (known).
  - One read: learning, acc 0.75.
  - None: learning, acc 0.5.
- Then `course.unit` becomes the highest unit with a known or learning note, plus 1. Set `course.checkDone = true` and `placementAt`.
- `?check=E4`: 5 cards. 5 of 5 in under 4 s promotes the note as above. Otherwise nothing changes, with "Not quite yet. A few more reads and it'll stick."

**Acceptance:** the deck never repeats a key back to back. A miss reinserts the card 3 later. Placement on a fresh store with perfect fast answers for C4..G4 then 3 misses gives `course.unit === 4` and C4..G4 known.

### 3.4 My notes (WP9, `modes/mynotes.js`)

- **Header:** "My notes". Subtitle "7 known · 2 learning · 1 new · 1 to come".
- **Mini staff:** SVG viewBox `0 0 360 130`, scaled to width. Clef, then 11 noteheads C4..G5 at `x = 54 + i·28`, with a ledger line for C4. Each head has a ≥28 px transparent hit rect.

  | state | fill / stroke |
  |---|---|
  | known | `--good` fill |
  | learning | `--learn` fill |
  | new | `--accent` stroke, `--accent-soft` fill |
  | locked | dashed `--line`, hollow |
  | rusty | `--learn` dot above the head |

- **Chip grid:** `repeat(auto-fill, minmax(76px, 1fr))`, gap 8.
  - Each chip is a `<button>` showing the letter (large), octave (small), state word, and a conic-gradient ring of `pct`.
  - `aria-label`, for example "E4, bottom line, known".
- **Legend:** Known / Learning / New / Coming up.
- **Mix-ups:** the top 3 confusions across notes, e.g. "You sometimes play F when you see E.", with a mini staff showing both notes. The section is hidden when there are none.
- **Path:** the stages and units with status, plus the links "Drill my weakest notes" (`?weak=1`) and "Learn {next} anyway" (gate confirmation).
- **Detail sheet** (opened by a chip or notehead):
  - NOTE_INFO, the anchor, and a staff showing the note.
  - Stats: first-try % (`reads/(reads+miss)`), average time (rt, in seconds), "practised on N separate days" (N = box), next review ("today" / "in 2 days"), and "often played as G" (top `conf` entry).
  - Buttons: [Hear it] [Drill this note] (`?focus=`) [I already know this] (`?check=KEY`, hidden when known).
  - For a locked note: "Comes after A". For the next unit, a [Learn it now] button that goes through the gate.
- **Empty state:** "Your first notes are middle C and D." with the button [Meet C & D].

**Acceptance:**
- At 375 px the staff and grid fit with no horizontal scroll.
- Every state is readable without colour.
- Chips meet the 44 px target.

### 3.5 Shape hints (WP2 drawing and rules, WP3 stats, WP6/WP8 use)

- **Classification:** `Shapes.classify` (§2.4.6) by staff distance, which is what the eye counts. `same` and `half` share staff position 0.
- **Drawing** (`S.drawShape`) in the band below the labels:
  - Centre `mx` halfway between the two noteheads (`xB − 26` in Practice).
  - Arrow at yc 180, half-width 9. Rise by kind: half 1.5, step 3, skip 5.5, leap 8. Up goes from (mx−9, yc+r) to (mx+9, yc−r).
  - Arrowhead: a polyline 5 back along the line, ±3.5 across it, stroke 2, round caps.
  - `same`: two 14-wide lines at yc ±2.
  - Word at (mx, 195), size 11, weight 700, Atkinson Hyperlegible.
- **Levels:**
  - Level 2: arrow plus word, opacity 1.
  - Level 1: arrow only, opacity 0.45.
  - Level 0: not drawn, and the band height collapses when no pair on the page is visible (height 172).
  - Ink: `--shape`. The interval into the current note uses `--accent` (`emphasis`). Rescue uses `--accent` with class `shape-rescue`, which pulses twice (no pulse under reduced motion).
- **Fading rules:** `Shapes.typeLevel` and `pairLevel` (curriculum). Stats live in `S.shapes[statKey] = {n, acc}`, starting at `{n:0, acc:0.5}`.
  - Credit comes only from Practice (and Meet step 3, the mixed phrase) via `recordShape`.
  - Free Play, Ear, Perform and Drill write nothing.
- **Pairs drawn in Practice:** only the pairs ending at `current..current+3`.
- **Level-up toasts,** once per crossing, when a type's level drops:
  - 2 → 1: "Steps are getting easy, so their labels are hiding now."
  - 1 → 0: "You read steps at a glance now, so their arrows are gone."
  - With skip and leap variants.
- **Settings:** `settings.shapes` is `auto | always | off`. The chip cycles "Shapes: auto / always / off".
- **Screen readers:** the band is `aria-hidden`. The staff `aria-label` appends `Shapes.describe(prev, current)` while hints are on.

**Acceptance:**
- With `auto` and fresh stats, a step into a new note draws at level 2.
- After setting `S.shapes.step = {n:40, acc:0.95}` and both notes known, step pairs draw nothing.
- A wrong note forces level 2 plus a pulse on the incoming pair.
- Free Play always draws level 2 when its chip is on.

### 3.6 Free Play (WP8)

#### 3.6.1 Entry and screen (`#/free`)

**Top bar:** Back, eyebrow "Explore", title "Free play", count "12 notes".

**Body:**

1. Staff card. SVG with `aria-label` "Music staff showing the notes you play", plus a status line.
2. Feedback. Default big "Play anything", small "Every note you play shows up on the staff."
3. Song toast row (hidden): text plus **Practise it**.
4. Mic bar.
5. Row: **▶ Play back** · **Clear**.
6. Chips:

   | Chip | Values | Default |
   |---|---|---|
   | Names | on / quiz / off | on |
   | Rhythm | even / timed | even |
   | Tempo | auto / 60 / 80 / 100 / 120 (shown only when timed) | auto |
   | Octave | as heard / keep on staff | as heard |
   | Shapes | on / off | on |
   | Spelling | sharps / flats | sharps |

7. "Tunes you've found by ear: 3".
8. Keyboard, range C4..G5. It shows heard keys.

Settings are saved in `slices.free`. Free Play never records mastery.

#### 3.6.2 State and input

- Buffer: `buf = [{id, midi, at, tOnset, off:null, place:Notation.placeOnStaff(midi, {mode, prefer}), source}]`, at most 200 entries (oldest dropped).
- Subscribe to `NS.input` (ignored while `NS.audio.isBusy()`) and to `NS.mic.on('quiet')`, which sets `off` on the last note.
- **Even mode (default):**
  - `N = perPage`. Notes sit at `x = 74 + i·52` inside a clip-path group that starts at x 50 (behind the clef), translated by `−offset·52`, with `offset = max(0, count − N)` and a 180 ms transition.
  - Every note is a filled quarter with its own accidental. Naturals are never drawn.
  - Newest note in `--accent` with an `--accent-soft` column. Older notes in ink. The two left-most visible notes at opacity 0.55 and 0.8.
  - Groups older than `offset − 2` are pruned from the DOM.
  - Full re-render on resize, theme or settings change.
- **Out of range:** zone `ledger` draws the true position plus a range caret. Zone `folded` draws the folded note plus a `8va`/`8vb`/`15ma`/`15mb` badge.
- **Labels:**
  - `on`: the name (e.g. "F♯").
  - `quiz`: the newest note's label appears after 1500 ms with a fade. Big feedback shows "?" until then. Small text: "Say the name out loud before it appears."
  - `off`: none.
  - Tapping a note on the staff plays it (true octave) and shows its label for 2 s.
- **Feedback per note:**
  - Big: the name.
  - Small: `{full} · {describePosition}` plus `· {Shapes.classify(prev,cur).long} from {prevLetter}`. Examples: "G4 · on the second line · a skip up from E", or for middle C "C4 · middle C, on a short line below the staff".
  - Folded: "C3 · lower than this staff shows, so it's drawn an octave up (8vb)", with matching higher and "two octaves" wording.
- **Empty state:** centred text "Your notes will appear here".

#### 3.6.3 Timed mode (optional)

- `beatMs` = the median of the last 8 IOIs, clamped to 375..1200 ms. 80 bpm until 3 notes exist. The chip shows "Tempo: auto (≈84)".
- **Quantize** (pure, in `freeplay-core.js`):

```
GRID = [0.5, 1, 1.5, 2, 3, 4] -> 'e','q','q.','h','h.','w';  nearest by |log2(x/g)|
raw = ioi/beatMs; raw < 0.35 -> 0.5; raw <= 4.5 -> nearest(raw);
else sound = (off ? off-t : beatMs)/beatMs -> nearest(min(sound,4)); rests = greedy [4,2,1] over round(raw-beats) (drop if < 0.75)
```

- The open note is drawn provisionally at opacity 0.85 and re-evaluated every 100 ms, so a held note grows from quarter to half to whole.
- Layout advance per note: `36 + 14·beats`.
- 4/4 bar lines are drawn after the note that reaches or crosses each multiple of 4.
- The accidental bar rule applies: it lasts until the bar line, and a natural sign appears on a return.
- **No audio metronome**, only a blinking visual dot, because a click would mute the mic.

#### 3.6.4 Play back

- Plays the last 64 notes since Clear through `NS.audio.playEvents`, using the true heard midi.
  - Even mode: real onset gaps, each clamped to 0.15..2.0 s, `dur = min(gap·0.92, 1.2)`, and the last note 0.8 s.
  - Timed mode: quantized beats at the current tempo.
- While playing: the playing note is drawn in `--listen` with the track scrolled to it, the key is `setPlaying`, and the button reads "■ Stop". A screen key tap stops playback.

#### 3.6.5 Clear

Empties the buffer. Feedback "Cleared", small "Play anything to start again.", with an inline **Undo** for 4 s. There is no confirmation dialog.

#### 3.6.6 "I know that tune!" (pure matcher in `freeplay-core.js`)

- **Index:** `NS.songs.all()` with `kind==='song'`. For each song store `iv` = successive midi differences normalised to −5..+6 (octave-tolerant) and the first pitch class.
- **Following** (`follow = {song, pos, tr, misses}`):
  - If `pc(midi) === pc(song.notes[pos].midi + tr)`, advance `pos` and reset misses. Otherwise `misses++`, and stop following after 2.
  - Progress text: "Ode to Joy · 14 of 30 notes".
  - At the end: big "You played all of {title}!", small "From memory, too." Then `found[id]++`.
- **Detect** for L = min(10, len) down to 5: match the last L played intervals against `iv[0..L−2]`. Songs with the same `family` count as one match.
  - L ≥ 5 with a unique match: soft hint "Sounds like {title}…".
  - L ≥ 7, or the whole song if it is shorter: toast "You're playing {title}!", plus " (starting on {X} instead of {Y})" when transposed. Start following.
  - **Practise it** goes to `#/practice/:id`.
  - Each song is announced at most once per Clear.
- **Scale bonus:** 8 notes making 7 diatonic steps in one direction, starting and ending on the same pitch class: "That's a whole scale, C to C!" (or "going down").
- Titles only, never lyrics.

**Acceptance (Free Play):**
- Plucking C4 E4 G4 F♯4 gives 4 heads, a sharp path element, and big "F♯".
- Flats spelling turns it into G♭.
- Plucking C3 shows C4 with an `8vb` badge in "as heard" mode, and no badge in "keep on staff" mode.
- Playback lights each note in amber, and the mic is ignored while it plays.
- Seven notes of Ode to Joy starting on G announce "You're playing Ode to Joy! (starting on G instead of E)".
- Clear followed by Undo restores the notes.

### 3.7 Ear First (WP7): inspired by the Suzuki method

Ear First uses no Suzuki book text, arrangements, song order or rhythm-variation names. Fixes from the critic are marked **[P0]**. The P1 items applied are marked ★.

#### 3.7.1 Principles mapped to mechanics

| Idea | Mechanic |
|---|---|
| Hear a lot before playing; read later | Fixed order per tune: Listen → Echo → Whole → See → Read. No staff until "Now see it". |
| Daily listening, including upcoming pieces | **Listening Room** (works with the screen locked). Streak with one rest day per 7. "Get your ears ready" for the next tune. |
| Learn by watching and copying | **Phrase echo** (call and response). On a new chunk's first call, the on-screen keys light in time ("watch the hands"). This fades over later calls. **[P0]** |
| Tiny steps, mastered | Phrases of 3 to 8 notes. Growing chunks. Each new tune adds at most 1 or 2 notes. |
| Repetition | A **bead counter** (a counter many teachers use). Only clean reps count. ★ |
| Constant review, each time with a focus | A review warm-up opens each session. The interval is capped at 7 days. A rotating focus point the mic can judge. ★ |
| Encouragement | Praise effort and self-correction. Never count failures out loud. |
| Hand position from the start | A **hand-position card** before each tune. Optional finger numbers on dots and keys. ★ |
| Read music you already know | **Now see it** (ink-in plus Spot it), then **Read it in Practice**, then a **cold read** of a new tune with the same notes. ★ |

**How this works** sheet (exact copy) ★:

> "Ear First is inspired by the Suzuki method: you learn a tune by listening and copying before you read it. It's right hand only, because the microphone hears one note at a time. Suzuki piano uses both hands and is built around a teacher and a parent at home; this is a way to practise ear-first on your own, not the method itself. Note Steps isn't connected to any Suzuki association. No pedal for now: let each note stop before the next."

#### 3.7.2 Files

- `modes/ear-core.js` (UMD, pure, no DOM):

  ```js
  EarCore.findRepeats(phrases, notes) -> [{repeatOf?, shapeOf?, variantOf?, divergeAt?}]
  EarCore.buildChunkPlan(song, {known:false, phraseErr:null, beads:'standard'}) -> {steps:[Step], hash}
  EarCore.chunkKey(step) -> 'p0' | 'p0-1' | 'p0..2' | 'whole' | 'remix:walk'
  EarCore.makeMatcher(expected:Note[], {callEndPerf}) -> M   // forgiving cursor, §3.7.5
  EarCore.judgeRhythm(beats[], onsets[], opts) -> result     // §3.7.9
  EarCore.scheduleReview(polish, result, today) -> polish    // §3.7.11
  EarCore.fingering(notes, phrases) -> {thumbKey, fingers:int[]|null, moves:[{phrase, thumbKey}]}
  EarCore.EAR_PATH ; EarCore.REMIX_PATTERNS ; EarCore.unlocks(earSlice, S, songs) -> {[id]: {listen, echo, see, read, remix}}
  ```

  `EarCore.segment` is `Notation.autoPhrases`. Phrases come from `song.phrases`.
- `modes/earfirst.js`: screens, state machines, and storage in `slices.ear`.
- `modes/earfirst.css`: uses existing tokens only, with beads in `--gold`.
- `tests/ear-core.test.js`.

#### 3.7.3 Path (`EAR_PATH`, all public domain, not in Suzuki order)

| # | id | Why here |
|---|---|---|
| 0 | `remix-start` | Rhythm Remix R1 and R2 onboarding (any key, then C and G) |
| 1 | `hot-cross-buns` | C D E |
| 2 | `au-clair-de-la-lune` | C D E, a less familiar tune, so listening comes first for real |
| 3 | `mary` | adds G |
| 4 | `lightly-row` | C–G, less familiar |
| 5 | `go-tell-aunt-rhody` | C–G, less familiar |
| 6 | `ode` | adds F |
| 7 | `all-my-little-ducklings` | adds A, less familiar |
| 8 | `twinkle` | C–A |
| 9 | `london-bridge` | C–A |
| 10 | `jingle` | repeated notes |
| 11 | `old-macdonald` | |
| 12 | `row-row-row-your-boat` | adds C5 |
| 13 | `frere-jacques` | upper version |
| 14+ | `amazing-grace`, `can-can`, `silent-night`, `auld-lang-syne`, `yankee-doodle` | |

- Notes always come from `NS.songs.get(id)`. A missing id is skipped.
- **New notes in this tune** for the Hub: `song.keys` minus the union of keys of earlier path tunes. Their mastery state is shown when available.

#### 3.7.4 Screens (375 px first)

**Hub (`#/ear`):**

1. Top bar: eyebrow "Ear First", title "Your tunes".
2. **Today's ten minutes** card, with three rows. Each has a state dot and a button:
   - **Listen** · "2 min · Day 4 of listening" → Room.
   - **Warm-up** · `{reviewTitle}`, hidden if nothing is due.
   - **New bit** · `{tune} · {step label}`.
   - Plus the line "Hand shape check: thumb on {thumbKey}, curved fingers." ★
3. **Path list** using `.lesson` rows:
   - The `num` badge per state: Locked / Heard 2× / Phrase 2 of 3 / By ear / Seen / Read ✓ / bead total.
   - Step chips: Listen, Echo, Whole, See, Read, Remix.
   - "New notes in this tune: F".
   - Locked rows offer "Try anyway", which opens the tune without changing the unlock chain.
4. **Reps strip:** "Reps today: 23 · All time: 412".
5. Footer: "Inspired by the Suzuki method: listen every day, learn by ear, read later." plus the **How this works** sheet.

**First run** in Ear (once):

- `NS.ui.soundCheck()` **[P0]**.
- Then `NS.ui.micCheck()` ★ when the mic is on.
- Then one line: "No pedal for now. Let each note stop before the next."

**Hand-position card** ★, before the first Echo of a tune, and whenever `fingering().moves` changes the position:

- A mini keyboard with the thumb key marked. "Thumb on {C}, one finger per key."
- Toggle "Show finger numbers" (`ear.settings.fingers`, default on).
- **Finger numbers:** if the tune spans at most 5 white keys, `finger = staffPos − thumb.staffPos + 1`. Otherwise this is computed per phrase, with a move card "Move your hand: thumb on {X}". There are no numbers where a phrase spans more than 5 keys.

**Listening Room (`#/ear/room`):**

- Now-playing card:
  - Title and origin line ("French folk tune, 18th century").
  - A **melody ribbon** (dots with widths proportional to beats, no staff) and a progress bar.
  - Play/pause, previous/next (seek within the session file), a **Loop all** toggle, and a Speed chip (100% / 80%).
- Playlist sections:
  - "Now learning: …"
  - "Coming next: …", tagged "Get your ears ready"
  - "Old friends: …", up to 3 tunes
- Note: "Leave it playing while you cook or tidy up. Your ears keep learning even when you're not paying attention."
- **Tech ★:**
  - Render **one** session track with `NS.audio.render([...tracks], {voice:'piano', drone:true, sampleRate:16000, gapSec:1.5})`. Tracks: current tune ×2, next tune ×2 (one an octave up), then the old friends. About 2–3 minutes and 4–6 MB.
  - Play it through a single `<audio loop>` element. The Blob URL is cached in memory and revoked on unmount.
  - Call `NS.audio.setSessionType('playback')`. Set `navigator.mediaSession` metadata and the play/pause handlers.
  - **The mic is never judged in this view.**
- **Counting ★:**
  - Record `{playStartedAt: Date.now(), posAtStart}` on play, pause, `visibilitychange`, and on resume.
  - Elapsed play time is `Date.now()` deltas while playing.
  - The track position is derived from `currentTime` modulo the layout.
  - A "listen" counts per tune when a playthrough passes 80% of that tune's span. These are computed on resume from the elapsed time, so they also count while JS was paused.
- **Streak:** a day counts at 120 s or 5 counted listens. One rest day per rolling 7 days keeps the streak, with the toast "Rest day used. Your streak is safe."

**Echo screen (`#/ear/:id?step=echo`), top to bottom:**

1. Top bar: eyebrow = tune title, title = step label ("Phrase 2", "Join 1 and 2", "From memory: 1 to 3"), and a `count` chip "Step 4 of 10".
2. **Phrase map strip:** pills P1..Pn. A repeat shows "= 1". States: grey, accent outline (in this chunk), green fill (learned). It scrolls inside its own container.
3. **Call/response card:**
   - A big state label: "Listen…" or "Your turn". It is announced through the aria-live feedback.
   - The **note-dot row**: equal height, widths proportional to beats, and finger numbers if enabled.
   - App playing: dots light in `--listen`. User playing: dots fill `--good` as matched. A wrong note shakes the current dot in `--bad` for 300 ms (colour change only under reduced motion).
   - "Show the shape" turns the row into a contour (`y = −staffPos·4`) with level-2 shape arrows.
4. Feedback (aria-live).
5. **Bead counter** (§3.7.8).
6. Mic bar.
7. Buttons: **Hear it again** (always free, not a hint) · **Help** (hint sheet) · **I know this already** (one test attempt; a clean pass fills the step).
8. Keyboard: `rangeFor(song.notes)`, so G3 tunes get 13 white keys at 375 px ★. Names follow `ear.settings.names` (default off) ★. It shows the heard key, call lights, the start key and guide lights.

**Whole tune screen:** same layout. The enlarged phrase map is the progress display, with the current phrase pulsing. Copy `whole.intro`, with skip button `whole.skipCall`.

**Now see it (Reveal):**

- Title "Now see it", subtitle `reveal.sub`.
- The staff is paged by phrase (6 notes per page at 375 px; longer phrases split across 2 pages), with brackets 1, 2, 3 matching the phrase map colours.
- **A. Ink in** (required): plays the tune, and `revealUpTo` grows on each `onNote` with a 150 ms fade-in. Shape arrows are drawn at the user's normal shape levels.
- **B. Play while you watch:** a Practice-like cursor that waits on a wrong note (red for 600 ms). Labels follow the global `labels` setting. Each note calls `NS.mastery.record({…, source:'ear'})` (weight 0, `seen` only). Skippable.
- **C. Spot it** (3 taps, no mic):
  1. "Which phrase did I just play? Tap it." (tap a bracket)
  2. and 3. "I'll play one note from this phrase. Tap it on the staff."
  - Wrong taps: "Not that one. Here it is." with a pulse on the right note. Skippable.
- CTA **Read it in Practice** goes to `#/practice/:id?from=ear`.

**Rhythm Remix (`#/ear/remix`, and per tune `?step=remix`):**

- Patterns shown as rhythm bars (blocks with width proportional to beats). They switch to notation only after the tune is revealed.
- Flow as in Echo, with 2 beads per pattern.
- After each attempt, a **Tune / You** comparison: two rows of bars, with the worst gap outlined.
- **Levels:**
  - **R1 "Any key":** pitch ignored. Uses raw `mic:onset` events plus screen taps, with `NS.mic.expect({repeat:true})` for the whole step ★.
  - **R2 "Two notes":** C4 then G4, pitch checked.
  - **R3 "Remix a phrase":** a pattern applied to the first learned phrase. The call is capped at 80 bpm.

**Celebrations:**
- Chunk learned: inline toast.
- By ear, seen, read: `.dialog`. The "by ear" dialog shows the phrase map fully green and the tune's bead total.
- Reps milestones at 100, 250, 500, 1000, 2500 and 5000: "{n} repetitions. This is exactly how hands learn."
- The bead sound is `NS.audio.cue('bead')`, which never mutes **[P0]**.

#### 3.7.5 Echo attempt engine **[P0 fixes]**

States: `CALL → WAIT → PLAY → JUDGE`. `PAUSED` is entered on `visibility:hidden`, mic off, or route change.

**CALL:**

- `h = NS.audio.playSequence(chunkItems, {bpm: callBpm, voice:'piano', onNote})`, where `callBpm = min(song.bpm·tempoPct/100, cap)`.
  - `cap` is 90 when the chunk has a note under 1 beat that repeats the previous pitch. Otherwise 120. Memory steps play only the first 2 notes as a cue.
- **Watch-and-copy lights [P0]:** depend on how many times this chunk has been called (`chunk.calls`):
  - 0: `K.setLit([midi], {tone:'call'})` on each `onNote`.
  - 1: only the first note is lit.
  - 2 or more: none.
  - "Follow the lights" (hint 6) brings them back during PLAY.
- Inputs are dropped while `isBusy()`.

**WAIT:**

- Starts when `h.done` resolves, or at `endPerf`.
- Label "Your turn".
- **Start key** ★: `K.setHint(exp[0].midi)` on attempt 0 of every chunk and whenever `chunk.calls === 1`. Setting `startKey:'never'` turns it off. Copy "Start on the green key."
- After 10 s idle: `echo.idle` (text only).

**PLAY:** a matcher `M = EarCore.makeMatcher(exp, {callEndPerf})`. For each input event, the checks run in this order:

0. **Noise guards:**
   - With at least 4 matched notes this session, if `ev.rms < medianMatchedRms / 5.6` (−15 dB): ignore the event, and show `noisy` at most once per 30 s.
   - More than 6 onsets in 1000 ms: ignore that burst and show `noisy`.
1. **Match:** `pc(ev.midi) === pc(exp[i].midi)` sets `onset[i] = ev.at` and fills the dot, then `i++`.
2. **Doubled detection:** `i > 0 && pc(ev) === pc(exp[i−1]) && ev.at − onset[i−1] < 0.25 && pc(exp[i]) !== pc(exp[i−1])`. Ignore the event; it is not wrong.
3. **Merged repeat:** `exp[i].midi === exp[i−1].midi && pc(ev) === pc(exp[i+1])`. Set `onset[i] = null`, `onset[i+1] = ev.at`, `merged.push(i)`, `i += 2`. At most 2 per attempt; after that, it falls through to rule 5. The attempt stays clean.
4. **Swallowed first note:** `i === 0 && pc(ev) === pc(exp[1]) && ev.tOnset − callEndPerf < 1500`. Set `onset[0] = null`, `onset[1] = ev.at`, `i = 2`. Clean.
5. **Wrong:** `wrong++`, `wrongAt.push(i)`, shake the dot.
   - A black key in a white-key tune shows `echo.blackKey` once per session.
   - If the next event at the same `i` matches, set `selfFixed = true`.

After each advance: `NS.mic.expect({repeat: exp[i]?.midi === exp[i−1]?.midi})`.

The matcher also ends the attempt:

- **Success:** `i === n`. Onsets within the next 600 ms are ignored (grace).
- **Lost:** silence of at least `max(4000, 2.5 × longest expected IOI at callBpm)` mid-chunk, never during a held note. Show the offer "Lost the thread? **[Hear it again]**". **No automatic replay [P0].** The cursor stays where it is, and the next matching note resumes it.
- **Tangle:** `wrong >= (attemptIdx < 2 ? 6 : 4)`. End the attempt as not clean. Show `echo.slip` with [Hear it again] and [Try again] (cursor reset, no call). **No automatic replay [P0].**

**JUDGE:**

- `clean = wrong === 0 && !blockingHint`. Blocking hints are levels 3, 5 and 6. The start key and call lights do not block.
- A clean attempt adds a bead, plus `today.reps++` and `totals.reps++`.
- **Bead target [P0]:** 2. It becomes 3 when this chunk's first attempt wasn't clean. `beadsPerStep` adjusts it: light −1 (minimum 1), thorough +1.
- **Groove check:** `judgeRhythm` runs on clean attempts with `n ≥ 3`. It never blocks. A pass shows `echo.groove`.
- **Feedback:** praise (rotating); selfFix (only when no start key or lights were shown in this attempt ★); slip; or lost.
- **Chunk target reached:**
  - Toast `echo.chunkDone`. A "Next phrase" button appears.
  - Auto-advance after 1500 ms only if there was no input in the last 1200 ms **[P0]**.
  - Then "One more for luck" becomes available. Bonus beads are outlined gold and never auto-advance.
- **Auto hint offers** (banner, never forced), counted in non-clean attempts on this chunk:
  - 2: Slower.
  - 4: Show the shape or Show the first key.
  - 6: One note at a time.
  - 8: Split. A join or memory chunk goes back to its last unlearned member. A single phrase over 5 notes splits at its middle bar line into two temporary sub-chunks.
  - After a level 3–6 hint, auto-offers are suppressed for 2 attempts.

#### 3.7.6 Phrases (`Notation.autoPhrases`) and repeats

**Auto rules,** scanning left to right:

- **R1:** close a span after a note with `beats ≥ 2` (or a rest) once the span has at least 3 notes.
- **R2:** if a closed span has more than 8 notes or more than 8 beats, split it at the bar line (`(beat − pickup) mod beatsPerBar === 0`) closest to the span's beat midpoint, leaving at least 3 notes on each side. Recurse.
- **R3:** a span with fewer than 3 notes merges into the next one. The last span merges into the previous one.
- **R4:** hard maximum of 10 notes, split at the nearest bar line.
- **Marked** phrases (`/`) are used as they are, if each has 2 to 10 notes. Otherwise the auto rules apply to that span.

**`findRepeats`,** comparing each phrase with earlier ones:

| Result | Condition |
|---|---|
| `repeatOf: j` | identical midi and beats sequences |
| `shapeOf: j` | identical intervals and beats, different start |
| `variantOf: j, divergeAt: k` | the first ≥ 50% of notes (minimum 3) match exactly, then they differ |
| unique | otherwise |

Expected results on the legacy strings:

| Tune | Phrases | Repeats |
|---|---|---|
| Twinkle | 6 × 7 notes | P4 = P3, P5 = P1, P6 = P2 → 3 unique |
| Ode | 8, 7, 8, 7 | P3 = P1; P4 variantOf P2, divergeAt 4 |
| Mary | 7, 3, 3, 8, 5 | P4 variantOf P1, divergeAt 6 |
| Hot Cross Buns (`E4 D4 C4:h E4 D4 C4:h C4:e C4:e C4:e C4:e D4:e D4:e D4:e D4:e E4 D4 C4:h`) | 3, 3, 8, 3 | P2 = P1, P4 = P1 → 2 unique |

When a tune has 4 or fewer unique phrases, show `echo.fewPhrases` once.

#### 3.7.7 Chunk plan (`buildChunkPlan`)

```
if known && phraseErr:                                  // "Do you know this tune?" = yes, after the diagnostic  [P0]
  for each unique phrase p: phraseErr[p] == 0 ? {type:'recognise', of:p, beads:1} : {type:'echo', chunk:[p], beads:2}
  joins only where either neighbour had errors (beads 2); no memory steps; then {type:'whole', beads:2}
else:
  learned = []
  for each phrase Pi:
    if repeatOf: push {type:'recognise', of:i, beads:1}; continue
    push {type:'echo', chunk:[i], beads:2, note: shapeOf ? 'shape' : variantOf ? 'variant' : null}
    if learned.length >= 1: push {type:'echo', chunk:[prev unique, i], beads:2}
    learned.push(i)
    if learned.length >= 3 && learned.length % 2 == 1: push {type:'memory', chunk:[sectionStart..i], beads:2}
  push {type:'whole', beads:2}
```

- An echo call plays at most 16 notes. A longer chain becomes type `memory`: the cue is 2 notes, and "Hear it again" plays the full span.
- When there are more than 4 unique phrases, sections split at the midpoint of the unique phrases, so a chain never covers more than 4 phrases.
- **Twinkle (not known)** gives exactly 10 steps: echo P1, echo P2, join P1–P2, echo P3, join P2–P3, memory P1..P3, recognise P4, recognise P5, recognise P6, whole.
- A `recognise` step: the app plays the phrase, the user plays it once, and any result moves on (a clean one adds a bead). Copy `echo.repeatSkip`.
- `hash = Util.hash(JSON of notes, phrases, known)`. On mismatch, rebuild the plan and keep beads for chunk keys whose note content is identical.

**Do you know this tune? [P0]:** asked on first entering Echo, with [Yes, I know it] [Not yet].

- Yes runs the **diagnostic**: plays the whole tune once (skippable), then one whole-tune attempt from memory using the Whole rules.
- `phraseErr[p] = 1` for any phrase with a wrong note or a prompt.
- A fully clean diagnostic counts as 1 whole bead.

#### 3.7.8 Bead counter and Whole tune

- **Bead counter:** an SVG 100% wide by 44 px, with `max(target, 5)` beads. Waiting beads are in `--line`. Earned beads slide right in 300 ms and turn `--gold`. Bonus beads are outlined gold.
  - Text "{n} of {target}". `aria-label` "{n} of {target} clean repetitions".
  - Persisted per chunk key.
- **Whole tune:** one cursor across all notes.
  - A bead needs `wrong ≤ floor(n/20)` and no prompt.
  - **Prompter [P0]:** after silence over max(4 s, 2.5 × the longest IOI), light the first 2 keys of the next phrase (`K.setLit`, tone `'guide'`) with `whole.prompt`. **No audio.** The attempt is marked `prompted`.
  - Per-phrase wrong counts accumulate in `phraseErr[]`.

#### 3.7.9 `judgeRhythm(beats, onsets, {callBpm, excludeHesitation=true})`

Onsets are `at` seconds. `null` marks a merged or swallowed note.

1. `IOI_i = onset[i+1] − onset[i]` for pairs where both are non-null, with `E_i = beats[i]`. Gaps touching a `null` are excluded. The last note's length is never judged.
2. `beatMs = median(IOI_i/E_i)·1000`.
   - If there are fewer than 2 usable IOIs: `{status:'na'}`.
   - If `beatMs < 250` or `> 1500`: `{status:'na', reason:'tempo'}`.
3. With `excludeHesitation`, drop any gap whose `IOI/E > 2·beatMs` (finding the key isn't a rhythm fault), then recompute `beatMs` once.
4. Grade each gap, with `dev = IOI/(beatMs·E)`:
   - **good:** `|IOI − exp| ≤ 90 ms` or `0.77 ≤ dev ≤ 1.30`.
   - **close:** `0.62–1.60`.
   - **off:** otherwise.
5. **Long-short integrity:** for every pair (a, b) with `E_a ≥ 2E_b`, require `IOI_a > 1.4·IOI_b`. A violation marks gap a as off ("held too short").
6. **Steadiness:** the coefficient of variation of `IOI/E` must be below 0.25.
7. `pass = good/(gaps) ≥ 0.8 && off === 0 && steady`.
8. `tempoRatio = (60000/beatMs)/callBpm`. Set `tempoNote = 'faster'` when the ratio is above 1.5, `'slower'` when below 0.67. This is non-blocking, with copy "A bit faster than mine." / "A bit slower than mine."
9. Return `{status:'ok', pass, beatMs, bpm, gaps:[{i, dev, grade}], worst:{i, dir: dev<1 ? 'early' : 'late'}, tempoRatio, tempoNote}`.

Timing precision: `at` is accurate to about 1.3 ms. The re-trigger gate is 110 ms.

**`REMIX_PATTERNS`** (our own names, 2 beats per melody note; the shortest IOI is 333 ms at the 90 bpm call):

| id | name | rhythm |
|---|---|---|
| walk | Walk | q q |
| hold | Hold | h |
| pair-step | Pair, step | e e q |
| step-pair | Step, pair | q e e |
| lilt | Lilt | q. e |
| quad | Quick four | e e e e |

In Remix, a bead requires `pass`.

#### 3.7.10 Tune stages and unlocks

Stages: `locked | listen | echo | whole | see | read | polish`.

- Remix R1 is always open. Tune 1 opens after R1 has one pattern at target, or via "Skip warm-up".
- Tune N+1 becomes `listen` (and joins the Room as "Coming next") when tune N enters `echo`.
- **Echo of tune N+1** is enabled when tune N is by ear (whole done).
- Echo is "ears ready" at `heard ≥ 3`. Before that, "Start anyway" is allowed.
- See unlocks at by ear. Read unlocks at seen. Remix R3 unlocks at by ear. Concert needs 3 tunes at polish ≥ 2.
- **`read` stage:** set on `practice:finished` for that song id, from any route. Ear's module subscribes to the bus at load time, idempotently.
- **Cold read ★:** after `read`, the Hub and Practice offer "Read a new tune with these notes". The target is the first library song not in the ear-path progress, never practised, with every key introduced, comfort `right` or `easy`, and keys a subset of (this tune's keys ∪ known keys). If none exists, use `NS.songs.run(seed)`. Completing it sets `tunes[id].coldReadAt`.
- **Lag limit ★:** the Echo of tune N+2 also requires tune N `read` **and** `coldReadAt` set. Copy: "Read {title N} first, so your reading keeps up with your ears."
- Ear never introduces notes and never marks them known.

#### 3.7.11 Review and polish ★

- **Intervals by level:** `[0, 1, 2, 4, 7]`, levels 0–4. "Polished" means level ≥ 2.
- **Warm-up** picks up to 2 tunes: the most recent by-ear tune other than the current one, plus the most overdue. Each can be skipped with "Not today".
- A warm-up is one whole-tune attempt from memory. "Hear it first" is available, but using it caps the result at "stay".
- `scheduleReview`:
  - Clean (`wrong ≤ floor(n/20)`, no prompt): level+1, due = today + interval.
  - Up to 4 wrong or 1 prompt: level stays, due tomorrow.
  - Worse, or quit: level−1 (minimum 1), due tomorrow, plus a **Brush up** offer: echo the phrase with the highest `phraseErr` for 2 beads.
- **Focus** rotates per review over `['steady', 'softly', 'octave', 'plain']`. It is a goal, not a gate. Meeting it adds a "focus" tick on the tune row.
  - steady: `judgeRhythm` pass.
  - softly: median matched RMS at least 6 dB below that tune's previous median.
  - octave: at least 70% of matched notes with `midi ≥ expected + 12`.
  - Copy: "Focus: keep a steady pulse." / "Focus: play it softly." / "Focus: play it an octave higher."
  - The same rotation varies the 2nd and 3rd reps of a chunk (shown as a small hint, never required).
- **Concert:** every tune at polish ≥ 2 is played back to back with no calls. Clean tunes light up on a "program" card.

#### 3.7.12 Edge cases

| Case | Behaviour |
|---|---|
| No mic | Screen taps go through `NS.input`, so every step works. |
| Playing during a call | Ignored. The label stays "Listen…". |
| Octave errors | Accepted. `echo.anyOctave` shows once. |
| G3 tunes | The keyboard extends to G3 ★. |
| Tab hidden | `PAUSED`: `stopAll`, keep the step. On return: "Welcome back. Here's where we were." and the user taps to resume. |
| Pedal ★ | If `quiet` never becomes true for more than 3 s and the floor stays above 2× its session median, show the tip once per session: "Sounds like the pedal is down or the room is ringing. Try without the pedal." |
| Song data changed | `planHash` rebuild (§3.7.7). |
| Performance mode | Not a concern. Only the mounted mode subscribes to `NS.input`. |

#### 3.7.13 Ear First copy (exact strings; `{}` are placeholders)

**Hub and Listening**

| key | text |
|---|---|
| `hub.title` | Ear First |
| `hub.tile` | Listen, copy, then see it written |
| `hub.sub` | Learn tunes the way you learned to talk: listen a lot, copy what you hear, and only then see it written down. |
| `hub.footer` | Inspired by the Suzuki method: listen every day, learn by ear, read later. |
| `hub.today` | Today's ten minutes |
| `hub.reps` | Reps today: {today} · All time: {total} |
| `hub.hand` | Hand shape check: thumb on {key}, curved fingers. |
| `listen.cta` | Start listening |
| `listen.streak` | Day {n} of listening |
| `listen.restDay` | Rest day used. Your streak is safe. |
| `listen.comingNext` | Get your ears ready |
| `listen.ready` | You've heard {title} {n} times. Your ears are ready for it. |
| `listen.startAnyway` | Start anyway |
| `know.ask` | Do you know this tune already? |
| `know.yes` | Yes, I know it |
| `know.no` | Not yet |
| `know.diag` | Great. Play it from memory once, and I'll find the bits worth practising. |

**Hand position**

| key | text |
|---|---|
| `hand.title` | Hand position |
| `hand.text` | Thumb on {key}, one finger per key. |
| `hand.move` | Move your hand: thumb on {key}. |

**Echo**

| key | text |
|---|---|
| `echo.listen` | Listen… |
| `echo.watch` | Listen and watch the keys light up. |
| `echo.yourTurn` | Your turn |
| `echo.startKey` | Start on the green key. |
| `echo.anyOctave` | Any octave is fine. Higher or lower counts. |
| `echo.praise` (rotate) | That's it. / Exactly like that. / Spot on. / Your ears got that one. / Lovely and clean. |
| `echo.bead` | {n} of {target} |
| `echo.oneMore` | One more for luck |
| `echo.chunkDone` | Phrase {k} is in your hands. |
| `echo.next` | Next phrase |
| `echo.joinIntro` | Now join them: phrase {a} flowing into phrase {b}. |
| `echo.memoryIntro` | From memory now: phrase {a} to phrase {b}. I'll give you the first two notes. |
| `echo.slip` | Close. A note or two wandered. |
| `echo.selfFix` | You found it yourself. That's your ear working. Now one clean one. |
| `echo.selfFixGuided` | You found it. Now one clean one. |
| `echo.lost` | Lost the thread? |
| `echo.again` | Hear it again |
| `echo.tryAgain` | Try again |
| `echo.idle` | Take your time. Tap Hear it again whenever you like. |
| `echo.blackKey` | That was a black key. This tune lives on the white keys. |
| `echo.fewPhrases` | Good news: this tune only has {u} different phrases. |
| `echo.repeatSkip` | You already know this one. It comes back here. |
| `echo.shape` | Same shape as phrase {k}, just starting on a different note. |
| `echo.variant` | Starts like phrase {k}. Listen for the new ending. |
| `echo.groove` | Nice, steady rhythm too. |
| `echo.knowIt` | I know this already |
| `echo.lag` | Read {title} first, so your reading keeps up with your ears. |

**Hints**

| key | text |
|---|---|
| `hint.again` | Hear it again |
| `hint.slow` | Slower |
| `hint.shape` | Show the shape |
| `hint.firstKey` | Show the first key |
| `hint.noteByNote` | One note at a time |
| `hint.lights` | Follow the lights |
| `hint.offer.slow` | Want a hand? Try hearing it slower. |
| `hint.offer.shape` | Tricky bit. Want to see which way the notes go? |
| `hint.offer.nbn` | Let's take it one note at a time. |
| `hint.offer.split` | This one's long. Want to split it in two? |
| `hint.afterGuided` | Now without the lights. You've got this. |

**Whole and Reveal**

| key | text |
|---|---|
| `whole.intro` | The whole tune, from memory. I'll play it once first. |
| `whole.skipCall` | I know how it goes |
| `whole.prompt` | Here's how it goes on. |
| `whole.done` | You can play {title} by ear. That's a real skill. |
| `reveal.title` | Now see it |
| `reveal.sub` | This is what you've been playing. Every dot is a note your fingers already know. |
| `reveal.play` | Play it while you watch the notes. |
| `reveal.spotPhrase` | Which phrase did I just play? Tap it. |
| `reveal.spotNote` | I'll play one note from this phrase. Tap it on the staff. |
| `reveal.spotWrong` | Not that one. Here it is. |
| `reveal.toRead` | Read it in Practice |
| `practice.badge` | You know this one by ear. Now let your eyes catch up. |
| `practice.cold` | Read a new tune with these notes |

**Review, Remix, misc**

| key | text |
|---|---|
| `review.intro` | Warm-up: an old friend. |
| `review.clean` | Still there. That one's yours for keeps. |
| `review.stay` | Pretty good. We'll play it again tomorrow. |
| `review.rusty` | A little rusty, which is completely normal. Let's brush up the tricky bit. |
| `review.skip` | Not today |
| `remix.intro` | Same note, new rhythm. Copy what you hear. Any key is fine. |
| `remix.good` | Right in the pocket. |
| `remix.early` | Almost. Note {k} came in a little early. |
| `remix.late` | Almost. The gap before note {k} was a little long. |
| `remix.short` | Almost. Wait a little longer on the long note. |
| `remix.unsteady` | The notes are right. Now try keeping an even pulse. |
| `remix.tempo` | That was very fast. Try it a bit more relaxed. |
| `noisy` | It's a bit noisy, so I'm hearing extra sounds. Try moving the phone closer to the keys. |
| `micOff` | Turn on listening so I can hear you, or tap the keys on screen. |
| `unlock.next` | New tune unlocked: {title}. It's already in your Listening Room. |
| `milestone.reps` | {n} repetitions. This is exactly how hands learn. |
| `concert.intro` | Your concert: every tune you know, back to back. |
| `welcomeBack` | Welcome back. Here's where we were. |

#### 3.7.14 Acceptance (Ear First)

- The staff never appears before "Now see it".
- On a new chunk's first call, every key lights in time. On the 2nd call only the first key lights. From the 3rd call, none.
- A correct phrase with one doubled detection, one merged repeat, or a swallowed first note still earns a bead.
- No automatic playback ever starts while the user might be playing: no replay on lost or tangle, and the Whole prompter lights keys without sound.
- The bead cue does not mute the mic. A note played 50 ms after a bead is detected.
- The Twinkle plan has 10 steps (§3.7.7). "I know it" with a clean diagnostic lands on Whole with 1 bead.
- The Listening Room keeps playing with the screen locked (iOS, Android). Listens count on resume. The mic stays off.
- The lag limit blocks the Echo of tune N+2 until tune N is read and cold-read.
- Ear writes reading evidence only as `source:'ear'` (`seen` only). Practice from Ear writes `'hear'`.
- Hub, Echo and Room fit 375 px in light and dark.

#### 3.7.15 Deferred (not in this build)

- Web MIDI input. `NS.input` would carry `source:'midi'` later.
- A wired-headphones play-along mode that turns off the mute.
- "Hum it first", judged by contour only.

### 3.8 Song library integration and unlock rules (WP4 content, WP5 UI)

#### 3.8.1 Content (23 entries; titles and origins only, **no lyrics anywhere**)

The 8 legacy ids keep their **current note strings exactly**, because Perform best scores depend on them. Phrase marks `/` may be added; they don't change `notes`. A verified-library tune that is the same melody maps onto its legacy id. All other tunes use the verified transcriptions and ids.

| id | Title | origin (exact string) | grade |
|---|---|---|---|
| `hot-cross-buns` | Hot Cross Buns | Traditional English street cry | 1 |
| `au-clair-de-la-lune` | Au Clair de la Lune (first phrase) | Traditional French, 18th century | 1 |
| `mary` | Mary Had a Little Lamb | Traditional American, 19th century | 2 |
| `ode` | Ode to Joy | Ludwig van Beethoven (1770–1827) | 2 |
| `go-tell-aunt-rhody` | Go Tell Aunt Rhody | Traditional American | 2 |
| `lightly-row` | Lightly Row | German folk song | 2 |
| `jingle` | Jingle Bells (chorus) | James Lord Pierpont, 1857 | 2 |
| `row-row-row-your-boat` | Row, Row, Row Your Boat | Traditional, 19th century | 2 |
| `all-my-little-ducklings` | All My Little Ducklings | German folk song | 3 |
| `twinkle` | Twinkle Twinkle Little Star | French folk tune, 18th century | 3 |
| `london-bridge` | London Bridge | Traditional English | 3 |
| `old-macdonald` | Old MacDonald Had a Farm | Traditional | 3 |
| `frere-jacques` | Frère Jacques | Traditional French | 3 |
| `frere` | Frère Jacques (low) | Traditional French | 3 |
| `scale-up` | C major scale, going up | Exercise | 4 |
| `scale-down` | C major scale, going down | Exercise | 4 |
| `amazing-grace` | Amazing Grace (first phrase) | Traditional American tune, 1829 | 4 |
| `can-can` | Can-Can (Galop) | Jacques Offenbach (1819–1880) | 4 |
| `silent-night` | Silent Night | Franz Xaver Gruber (1787–1863) | 5 |
| `auld-lang-syne` | Auld Lang Syne | Traditional Scottish | 5 |
| `jingle-bells-verse` | Jingle Bells (verse) | James Lord Pierpont, 1857 | 5 |
| `yankee-doodle` | Yankee Doodle | Traditional American, 18th century | 5 |
| `birthday` | Happy Birthday | Mildred J. Hill and Patty Hill, 1893 | 5 |

- `scale-up` and `scale-down` have `kind:'exercise'`. `jingle` and `jingle-bells-verse` share `family:'jingle'`. `frere` and `frere-jacques` share `family:'frere'`.
- **Stage and unit are computed** by `Curriculum.songLevel`, never assigned by hand. `frere` contains G3, so it lands in `stage:'extra'`.
- `grade` is display only.
- **Adding tunes:** only from the architecture's candidate list (§12 there), and only after checking the melody against a public-domain source. Each needs an `origin` naming the tradition or the composer with dates. Never copy a method-book arrangement.
- **Endless easy reading:** each unit's group ends with 5 deterministic **Little steps** etudes (`NS.songs.etudesFor`). Next up falls back to reading runs.

#### 3.8.2 Comfort (curriculum rules)

```
fam(key) = locked ? 0 : known ? (rusty ? 0.9 : 1) : learning ? 0.5 + 0.4*acc : new ? 0.4
C(song) = mean over note tokens of fam ; knownShare = share of tokens known
```

| Label | Rule |
|---|---|
| locked | any token locked → "Learn {X} to unlock" |
| easy | C ≥ 0.97 |
| right | 0.85 ≤ C < 0.97 ("Just right") |
| stretch | 0.70 ≤ C < 0.85 |
| tough | below 0.70 |

#### 3.8.3 Library screen (`#/songs/:mode`)

- Filter chips: All · Folk · Classical · Holiday · Little steps.
- Groups: "Stage 1 · Middle C home" … "Stage 4 · Top of the staff", then "Extras (beyond this course)".
- **Row:** title, origin, comfort pill with "92% known", and badges from every mode's `songBadge` (Practice ★★☆, Perform best, Ear "Ear: by ear").
- **Locked rows** are dimmed but still tappable. They open the sheet, which offers "Try anyway".
  - In Practice, "Try anyway" works normally. Locked notes are ignored by mastery, and their labels are shown (delay 0).

#### 3.8.4 Song sheet (bottom sheet)

- Title, origin, note chips by state, and the comfort pill ("Just right · 1 new note: G").
- **Buttons:**
  - **Hear it** (plays in the sheet; Stop).
  - **Read it** → `#/practice/:id`.
  - **Learn by ear** → `#/ear/:id` (if in `EAR_PATH`; otherwise it opens Echo in "Try anyway" mode).
  - **Play along** → `#/perform/:id`, disabled when `NoteSteps.isUnlocked(index)` is false, with the reason.

#### 3.8.5 Unlock rules (summary)

| Mode | Rule |
|---|---|
| Practice | Song available when `Curriculum.songLevel(song) < course.unit` (all notes introduced). Otherwise locked, with "Try anyway". Extras are always available. |
| Perform (`NoteSteps.isUnlocked(i)`) | `i === 0` **or** the previous song by index passed (Practice best exists, or Perform ≥ 2 stars) **or** the song is available in Practice. |
| Ear First | §3.7.10 |
| Etudes and runs | Always available for any unit ≤ `course.unit − 1`. |

**Acceptance (library):**
- `NoteSongs.songs` is sorted by stage, unit and diff, and `songs[i].index === i`.
- Perform's "Next song" opens `songs[i+1]`.
- A v1 user who had finished Mary still sees Mary as passed for Perform, even before introducing G.
- No song object has a field other than `music` holding song text. The library test enforces this.

---

## 4. Storage schema and migration (WP3)

### 4.1 Key `note-steps-v2`

`note-steps-v1` is never modified, so the user can roll back.

```js
StateV2 = {
  v: 2,
  created: 1761040000000,
  migratedFrom: 1 | null,
  settings: { labels:'auto'|'always'|'never', shapes:'auto'|'always'|'off', keyLabels:true,
              hearFirst:'ask'|'always', spelling:'sharp'|'flat', cues:true, firstRun:{sound:false, mic:false} },
  course:   { unit:0, checkDone:true, placementAt:null, checkSnoozeUntil:null },
  notes:    { 'E4': { acc:0.82, n:14.5, seen:19, reads:12, miss:3, asst:4, streak:4, rt:2100, box:1, due:'2026-10-22',
                      k:0, intro:'2026-10-20', knownAt:0, last:1761050000000, day:{d:'2026-10-21', r:5, m:1}, conf:{'F4':2} } },
  shapes:   { same:{n:12, acc:0.95}, step:{n:30, acc:0.81}, skip:{n:9, acc:0.6}, leap:{n:2, acc:0.5} },
  log:      { '2026-10-21': { r:40, m:5, ms:600000 } },             // pruned to the last 90 days
  slices: {
    practice: { songs:{ mary:{ plays:3, last:1761050000000, best:{mistakes:0, at:1761050000000}, stars:3, ftp:0.92 } },
                listen:{ speed:1, scope:'whole' }, listened:{ mary:2 } },
    ear: {
      settings: { startKey:'auto'|'never', beadsPerStep:'light'|'standard'|'thorough', tempoPct:100, names:false, fingers:true },
      firstRunDone:false,
      listening: { streak:{count:4, lastDay:'2026-10-21', restDays:['2026-10-18']},
                   days:{ '2026-10-21':{secs:185, listens:6} },          // pruned to the last 60 days
                   heard:{ twinkle:7 }, session:{ startedAt:null, posAtStart:0 } },
      remix: { r1:{ walk:2 }, r2:{}, skipped:false },
      tunes: { twinkle: { stage:'echo', step:4, planHash:'a91f03c2', known:null, diag:null,
                          chunks:{ p0:{beads:2, target:2, attempts:3, hints:0, calls:2, cleanAt:1761040000000} },
                          whole:{beads:0, attempts:0}, phraseErr:[0,2,1,0,0,0],
                          seenAt:null, readAt:null, coldReadAt:null,
                          polish:{level:0, due:null, last:null, focusIdx:0}, remix:{walk:2},
                          startedAt:1761030000000, byEarAt:null } },
      today: { day:'2026-10-21', reps:23, warmupDone:true, newBitDone:false },
      totals: { reps:412, milestonesShown:[100, 250] }
    },
    free:    { labels:'on', rhythm:'even', bpm:'auto', octave:'heard', shapes:true, spelling:null /*null = settings.spelling*/, found:{} },
    drill:   { rounds:0, lastAt:0 },
    shell:   { lastRoute:'#/', libraryFilter:'all' },
    perform: { perf:{ mary:{ '75':{score, accuracy, stars, maxCombo, at} } }, speed:75, clickTrack:true, latency:null },  // opaque, owned by perform.js via compat
    legacyExtra: { /* any unknown v1 top-level keys, verbatim */ }
  }
}
```

- Every read is defensive: missing nested objects are filled from `Store.fresh()` defaults with a deep merge on load.
- All day keys use `Util.dayKey` (4 am cutoff).
- About 3–6 KB typical.

### 4.2 Load, migrate, save

```js
function load(now) {
  let raw2 = null, raw1 = null;
  try { raw2 = localStorage.getItem(KEY); raw1 = localStorage.getItem(LEGACY_KEY); }
  catch { return { state: fresh(now), persistent: false }; }            // in-memory + toast "Progress can't be saved in this browser window."
  const { state, backup } = migrate(raw2, raw1, { now, songs: NS.songs.all() });
  if (backup) safeSet('note-steps-corrupt-' + now, backup);
  if (!raw2 || backup) safeSet(KEY, JSON.stringify(state));
  return { state, persistent: true };
}
function migrate(raw2, raw1, { now, songs }) {
  if (raw2) { try { return { state: upgrade(deepMerge(fresh(now), JSON.parse(raw2))) }; } catch { /* fall through */ }
              const r = migrate(null, raw1, { now, songs }); return { state: r.state, backup: raw2 }; }
  let v1 = null; try { v1 = raw1 && JSON.parse(raw1); } catch {}
  if (!v1 || typeof v1 !== 'object') return { state: fresh(now) };
  const s = fresh(now); s.migratedFrom = 1;
  const { done = {}, names, perf, speed, clickTrack, latency, ...rest } = v1;
  s.settings.labels = names === false ? 'never' : 'auto';
  s.slices.perform = { perf: perf || {}, speed: speed ?? 75, clickTrack: clickTrack ?? true, latency: latency ?? null };
  for (const id in done) {
    const d = done[id]; const m = d && Number.isFinite(d.mistakes) ? d.mistakes : null;
    s.slices.practice.songs[id] = { plays: 1, last: d?.at || 0, best: d, stars: m == null ? 1 : m === 0 ? 3 : m <= 3 ? 2 : 1, ftp: null };
  }
  s.slices.legacyExtra = rest;
  // Seed notes conservatively: v1 had no per-note data and names defaulted on, so it is not reading evidence.
  const lib = Object.fromEntries(songs.map(x => [x.id, x]));
  const seen = new Set(Object.keys(done).flatMap(id => (lib[id]?.keys || []).filter(k => k in UNIT_OF)));
  if (seen.size) {
    const maxUnit = Math.max(...[...seen].map(k => UNIT_OF[k]));
    const today = dayKey(now);
    for (let u = 0; u <= maxUnit; u++) introduce(s, u, today);
    for (const k in s.notes) {
      const clean = Object.keys(done).some(id => done[id]?.mistakes === 0 && lib[id]?.keys.includes(k));
      Object.assign(s.notes[k], { seen: 4, n: 4, acc: clean ? 0.75 : 0.65 });
    }
    s.course.checkDone = false;            // Home shows the Note check invite
  }
  return { state: s };
}
function upgrade(s) { /* v3+ migrations chain here */ return s; }
```

**Save and sync:**
- Save is debounced 500 ms, with a flush on `visibilitychange` (hidden) and `pagehide`.
- A `storage` event from another tab reloads the state, last write wins.
- "Reset note progress" (with confirmation) clears `notes`, `shapes` and `course` only.

**Perform data path:**
- Perform mutates `slices.perform` through the compat `store` accessors.
- v1 is never written again.
- Rolling back to the v1 build shows the v1 data as it was at migration time. This is documented in the README.

---

## 5. Test plan

### 5.1 Node unit tests (`npm test`, i.e. `node --test tests/`, Node ≥ 18)

Helpers: an injected `now` (`Date.UTC(2026,9,21,12)`), a seeded rng (`Util.mulberry32(1)`), and `tests/synth.js` (harmonic pluck: partials 1, 0.5, 0.25, exp decay 1.5 s, 44.1 kHz; `+noise(dB)`; `render(events, sr)` returns a Float32Array).

**tests/pitch.test.js (WP1)**
- `detectPitch` on 2048-sample frames taken 80 ms after the attack, for every midi 55..84: within 30 cents in at least 95% of cases, and the pitch class right in 100%.
- `parseNote('D4:q.').beats === 1.5`.

**tests/listener.test.js (WP1).** Frames are fed every 25 ms from synth signals with −50 dB white noise.

| Case | Input | Expected |
|---|---|---|
| (a) | one C4 pluck | exactly 1 note, midi 60, `reason:'agree'`, `tConfirm − tOnset ≤ 100` |
| (b) | E4 ×3 re-attacked at 500 ms | 3 notes |
| (c) | Hot Cross Buns eighths, C4 ×4 and D4 ×4 at 357 ms | 8 notes in order |
| (d) | the same with `expect({repeat:true})` and a restrike rise of only 1.5× | still 8 notes; without `expect`, at least 6 |
| (e) | YIN votes forced 60, 72, 60 (stub `detectPitch`) | reported pitch class C after 2 votes; midi = majority octave 60 |
| (f) | new onset after 2 agreeing-pc votes and before agreement | first note flushed with `reason:'flush'`, `confident:false` |
| (g) | a muted window covering 2 plucks | 0 notes; the next unmuted pluck is detected |
| (h) | noise only for 5 s | 0 notes |
| (i) | tone with 2nd harmonic at 1.2× the fundamental | correct pitch class |
| (j) | `at` against the true attack | error ≤ 5 ms |
| (k) | `quiet` event | follows each decayed note |

**tests/notation.test.js (WP2)**
- Every natural token from C3 to C6, with every duration: midi, staffPos and beats equal `Pitch.parseNote`.
- `F#4` gives 66 / 3. `Bb4` gives 70 / 6. `R:h` is a rest of 2 beats.
- `parseMelody('E4 D4 C4:h / E4 | D4 C4:h')` gives phrases `[[0,3],[3,6]]` and `marked:true`.
- `autoPhrases` on the legacy strings: Twinkle `[7×6]`, Ode `[8,7,8,7]`, Mary `[7,3,3,8,5]`, Hot Cross Buns `[3,3,8,3]`.
- `spellMidi(70,'flat')` is Bb4. `spellMidi(61)` is C#4 at staffPos −2.
- `placeOnStaff`: 55 → G3 zone ledger. 50 (D3) → D4 fold −1. 45 → A4 fold −2. 81 → A5 ledger. 86 (D6) → D5 fold +1. Fold mode → zone core.
- `describePosition` for staffPos −5..12: never undefined, and contains no mnemonic words (regex `/every|good|boy|face|cow/i` must not match).

**tests/shapes.test.js (WP2)**
- `classify`: same, half (C4 → C#4), step, skip, a 4th, and an octave labelled "8ve".
- `typeLevel`: `{n:14, acc:.9}` step → 2; `{n:15, acc:.75}` → 1; `{n:40, acc:.9}` → 0; same `{n:10, acc:.9}` → 0.
- `pairLevel`: off → 0; always → 2; showIt → 2; known+known at L1 → 0; new note at L0 → 1.
- `updateStat` converges toward x.

**tests/mastery.test.js (WP3)**
- 12 fast reads on day 1 never give known (box 0). Good days on day 1 and day 3 give box 2 and known when acc, streak and rt hold.
- Cramming 30 reads on day 1 before `due` doesn't promote twice.
- A lapse day (2 reads, 3 misses) gives `box − 2` and demotes a known note.
- Assisted-only play levels off at acc ≈ 0.7 (within ±0.03 after 100 events) and is never known.
- A miss with `confident:false` changes nothing.
- `ear` / `free` sources raise `seen` only.
- `repeat` halves the weight and doesn't extend the streak.
- `labelDelay`: new with seen 0 → 0; new with seen 3 → 1000; learning at acc 0.5 / 0.7 / 0.9 → 1500 / 3000 / 5000; known → Infinity; refresh → 0; never → Infinity.
- `rusty` the day after `due`.

**tests/curriculum.test.js (WP3)**
- Every unit has ≤ 2 notes. `UNIT_OF` covers C4..G5.
- `introGate`: 4 learning notes at acc 0.85, n 8 → `soft`, not `open` (budget). After 2 become known → `open`.
- `songLevel(mary) === 3`, `songLevel(hot-cross-buns) === 1`, `songLevel(frere) === Infinity`.
- `comfort` labels on fixture states.
- `recommend`: a fresh state with C–E introduced picks Hot Cross Buns. With the gate open and all candidates easy → meet.
- `genPhrase`: only pool keys, focus share 0.35 ± 0.1 over 20 seeds, ends on C4 / G4 / C5, same seed gives the same output.
- `flashDeck`: no adjacent repeats, a focus key ≥ 40% of the deck, every pool key appears within 10 decks.

**tests/store.test.js (WP3)**
- `migrate(null, '{"done":{"mary":{"mistakes":0,"at":1}},"names":false,"perf":{"mary":{"75":{"score":900,"stars":2}}},"speed":50,"best":{"x":1}}')` gives:
  - labels `'never'`
  - practice mary stars 3
  - `slices.perform.perf.mary['75'].score === 900` and `speed === 50`
  - `legacyExtra.best.x === 1`
  - C4, D4, E4, F4, G4 introduced as learning at acc 0.75 (mary uses C, D, E, G, so units 0–3 are introduced)
  - `course.unit === 4` and `checkDone === false`
- `migrate(validV2, anything)` returns v2 with defaults deep-merged.
- `migrate('{bad', null)` returns fresh plus a backup.
- `migrate(null, null)` returns fresh with `checkDone:true` and unit 0.

**tests/songs.test.js (WP4)**
- Ids are unique. All `LEGACY_IDS` are present, and their `notes` match the committed v1 strings exactly.
- Every token parses. Notes are within G3..C6. Phrases are contiguous and cover all notes with 2..10 notes each.
- Every entry has `pd === true` and a non-empty `origin`.
- **No lyrics:** no key other than `music` holds a string longer than 60 characters, no key is named `lyrics`, `words` or `text`, and titles are under 60 characters.
- `bpm` is within 50..160. `beatsPerBar` is 2, 3 or 4.
- `NoteSongs.songs[i].index === i`.
- Every note has `{letter, midi, staffPos, dur, beats, beat}`. `endBeat` ≥ the last `beat + beats`.
- Stages 1–3 each have at least 4 songs.
- `etudesFor(3, 5)` is deterministic and uses only keys of units ≤ 3.

**tests/ear-core.test.js (WP7)**
- `findRepeats` on the 4 fixtures matches §3.7.6.
- `buildChunkPlan(twinkle)` gives exactly the 10 steps of §3.7.7, in order, with the right chunk keys (`p0`, `p1`, `p0-1`, `p2`, `p1-2`, `p0..2`, …, `whole`). The memory step has more than 16 notes.
- `buildChunkPlan(twinkle, {known:true, phraseErr:[0,1,0,0,0,0]})`: echo only P2; recognise P1 and P3; whole with 2 beads.
- **Matcher:**
  - (1) Clean path.
  - (2) A doubled D4 at +120 ms ignored, still clean.
  - (3) Mary's `E E E` with one E missing (E E then D) is accepted with `merged.length === 1`.
  - (4) A swallowed first note 800 ms after the call end is accepted; at 2000 ms it is wrong.
  - (5) A wrong note then a fix gives `selfFixed`.
  - (6) 6 wrong notes on attempt 0 → tangle. On attempt 2, the 4th wrong note → tangle.
  - (7) An octave-shifted match passes.
- **`judgeRhythm`:**
  - perfect onsets pass;
  - ±25 ms jitter at 84 bpm passes;
  - ±60 ms jitter at 84 bpm passes;
  - a lilt (q. e) played evenly fails the long-short check;
  - 2× tempo passes with `tempoNote:'faster'`;
  - one 3× gap is excluded as a hesitation and still passes;
  - a null onset excludes its gaps;
  - fewer than 2 IOIs give `na`.
- **`scheduleReview`:**
  - clean 0 → 1 due +1;
  - 3 → 4 due +7;
  - 4 → stays 4 with due +7 (cap);
  - "stay" keeps the level and makes it due tomorrow;
  - rusty at level 1 stays at 1 (minimum).
- **`fingering`:** Mary gives thumb C4 with fingers E = 3, G = 5. A tune spanning C4..A4 has a move.
- **`unlocks`:** the lag limit blocks tune 3's Echo until tune 1 has `readAt` and `coldReadAt`.

**tests/freeplay.test.js (WP8)**
- Quantizer grid at 80 bpm: IOIs of 375 / 750 / 1125 / 1500 / 3000 ms give e / q / q. / h / w. A 5 s gap with off at 700 ms gives q plus rests.
- Recognition:
  - Ode from E gives an announcement at note 7.
  - Ode transposed to G gives `tr` 3 with "(starting on G instead of E)".
  - Mary's first 5 notes give a soft match only.
  - The Jingle family counts as one match.
  - A wrong note while following, then 2 more wrong notes, drops following.
- Scale detection, up and down.

### 5.2 Browser tests with a fake mic (WP10, Browser pane)

**Setup.** Start the dev server with `preview_start` (name `note-steps`) and open `http://localhost:5173/?test=1`. `app.js` then loads `tests/fakemic.js`:

```js
window.FakeMic = {
  install() { const ac = NS.audio.ctx(); this.dest = ac.createMediaStreamDestination();
              navigator.mediaDevices.getUserMedia = async () => this.dest.stream; },
  denyNext() { navigator.mediaDevices.getUserMedia = async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); }; },
  pluck(midi, { at = 0, dur = 0.5, gain = 0.35 } = {}) { /* harmonic stack + exp decay -> this.dest ONLY (never ac.destination) */ },
  playSeq(tokens, bpm = 100, startAt = 0.1) { /* NS.notation.parseMelody, schedule plucks; Promise resolves at end */ },
  waitIdle() { /* resolves when !NS.audio.isBusy() + 300 ms */ },
};
```

Flow per scenario:

1. `localStorage.clear()` or a seeded fixture, then reload.
2. Click the page (resumes audio).
3. `FakeMic.install()`.
4. Click "Start listening".
5. Assert through `javascript_tool` reads of `NS.debug.mode()`, the DOM, and `NS.store.state()`.
6. Check that `read_console_messages` shows no errors.

| # | Scenario | Steps | Assertions |
|---|---|---|---|
| S1 | WP0 parity | Practice Mary with taps; Perform Mary 100% with taps on schedule | Both complete; Perform score > 0; `NoteSteps.isUnlocked(1)` |
| S2 | Practice reading | `#/practice/mary`, Start reading, `playSeq('E4 D4 C4 D4 E4 E4 E4')` | `index === 7`; `.feedback.good`; `NS.mastery.get('E4').seen ≥ 1` (C, D, E introduced via fixture) |
| S3 | Wrong then right | Pluck F4 when E4 is expected, then F4 again, then E4 | `.bad` plus direction text; after the 2nd wrong note the hint key is green; record outcome `miss` with `playedKey 'F4'` |
| S4 | Octave tolerance | E5 for E4, C3 for C4 | Both advance |
| S5 | Repeated notes | E4 ×3 at 150 bpm | 3 advances |
| S6 | Hear It First mute | ▶ Listen (whole); pluck during playback; `waitIdle`; pluck | No judgement during playback; the post-idle pluck is judged; notes in the listened range record `source:'hear'` |
| S7 | Label fading | Seed E4 learning at acc 0.9 (delay 5000); pluck E4 at 1 s | Label not in the DOM at 1 s; outcome `read`. Next E4 waits 6 s: label visible; outcome `assisted` |
| S8 | Shape hints | `shapes:'auto'`, fresh stats; then seed step `{n:40, acc:.95}` and C4/D4 known | `g.shapes` present at level 2 into a new note, then absent for C4 → D4 |
| S9 | Meet a note | `#/drill?meet=F4`: card, then 3× F4, then 12 mixed (`debugState().target.midi`) | F4 record exists; `course.unit` incremented; `unit:introduced` fired |
| S10 | Note Drill | 15 cards answered from `debugState()`, 1 deliberate miss | Card reinserted 3 later; summary "14 of 15 first try" |
| S11 | Note check | Fresh store, `#/drill?check=1`, answer C4..G4 correctly and fast, then 3 misses | `course.unit === 4`; C4..G4 `k === 1`; `checkDone` |
| S12 | Free Play | `#/free`, pluck C4 E4 G4 F#4 | 4 note groups, a sharp path, "F♯"; flats chip gives G♭; C3 gives an `8vb` badge; Play back lights `--listen` and ignores the mic; Ode from G gives the toast |
| S13 | Ear: echo with lights fading | `#/ear/hot-cross-buns`, R1 skipped; wait for `audio:play-end`; record `.playing` / lit keys during call 1; `playSeq` phrase 1 | Call 1 lit 3 keys, call 2 only 1, call 3 none; a bead per clean attempt; `chunks.p0.beads` increments |
| S14 | Ear: forgiving matcher | During Mary P1, fake a doubled D4 (two plucks 100 ms apart) and drop one repeated E | Attempt clean; bead earned |
| S15 | Ear: no auto replay | Go silent 6 s mid-chunk; then 6 wrong plucks | "Lost the thread?" offer shown; `NS.audio.isBusy()` stays false throughout; tangle shows buttons; no playback starts |
| S16 | Ear: bead cue doesn't mute | Pluck 50 ms after the bead event | `NS.audio.micMuted()` is false; note detected |
| S17 | Ear: full tune to Practice | Hot Cross Buns: all steps; Reveal A–C; Read it in Practice; complete | Stage `read`; Practice records `source:'hear'`; cold-read suggestion offered; `ear:stage` events in order |
| S18 | Listening Room | Open the Room, play 5 s, `visibilitychange` hidden 60 s (fake time), visible | Mic off; `listening.days[today].secs ≥ 60`; `<audio loop>` element exists |
| S19 | Migration | Set `note-steps-v1 = {"done":{"mary":{"mistakes":2,"at":1}},"names":true,"perf":{"mary":{"75":{"score":900,"accuracy":80,"stars":2,"maxCombo":5,"at":1}}},"speed":50}` and reload | Mary 2 stars in Practice; Perform best 900 shown; `settings.labels === 'auto'`; Note check invite visible; v1 key unchanged |
| S20 | Layout | `resize_window` mobile 375×812, light then dark, on every route in §1.2 | `scrollWidth <= innerWidth`; tokens differ between schemes; screenshots reviewed; no console errors |
| S21 | Route hygiene | Start a sequence, then navigate away; mount and unmount each mode 5 times | `isBusy() === false` after the route change; `NS.debug.inputListeners()` back to baseline |
| S22 | Mic denied | `FakeMic.denyNext()`, then Start | Blocked notice shown; screen taps advance Practice and Ear |
| S23 | Perform via compat | `#/perform/ode` at 50%; feed plucks at `NS.debug.perf()` schedule times | Score > 0; best saved in `slices.perform`; results "Next song" opens `songs[index+1]` |

### 5.3 Manual check on a real piano (the user, GitHub Pages, on a phone)

1. Mary in Practice: do labels fade, and are there any octave mistakes?
2. Hear It First at 75%.
3. Free Play with fast repeated notes (Hot Cross Buns eighths).
4. Ear First: one Hot Cross Buns phrase. Check the call volume while the mic is on (iPhone), plus the sound check and mic check.
5. Listening Room with the screen locked for 2 minutes.
6. Perform: one song at 75%.

Note any missed onsets, double counts, or calls you couldn't hear.

---

## 6. Definition of done

- Every WP's Node tests pass.
- Every browser scenario S1–S23 passes with no console errors.
- Every screen works at 375 px in light and dark with no horizontal scroll.
- `perform.js` and `perform.css` are byte-identical to the Performance session's commit.
- `note-steps-v1` is untouched after migration.
- No lyrics anywhere in code, data, copy or comments.
- "Ear First" copy says "inspired by the Suzuki method" and includes the honest "How this works" sheet.
- The README is updated with the file map, `npm test`, and the e2e instructions.
---

## 7. Addendum A: chord commands and the Play by Ear mode (binding; added after the user's request)

### 7.1 Chord commands everywhere (WP12)

The user controls the app hands-free by playing chords on the piano. One vocabulary is used across the whole app, so a chord always means the same kind of thing.

| Chord | Notes (right hand 1-3-5) | Meaning | Example labels |
|---|---|---|---|
| **C major** | C E G | Go on / yes / next | "Next lesson", "I'm ready to practise", "Start the real take", "Next song" |
| **C minor** | C E♭ G | Again | "Play again", "Hear it again", "Start the take over", "Try again" |
| **G major** | G B D | Done / stop | "I'm done" |

Rules:
- **Every screen that accepts chords shows them all the time** in a chord bar fixed to the bottom of the screen (safe-area aware), above the on-screen keyboard if one is shown. Each chip shows:
  - a mini keyboard with the 3 keys lit and finger numbers
  - the chord name
  - the action, written as "C major → Start the real take"
- Chips are also tappable buttons that do the same action, so chords are always optional.
- When the mic is off, the bar keeps the chips and shows one line: "Tap Start listening to use chords".
- On recognition, the chip flashes, an `aria-live` region announces "Heard C major: starting the real take", and the action runs.
- Chord detection is muted while the app's own synth plays, using the same mute window as the note listener.
- After an action, chord detection waits 800 ms before accepting the next chord, so a ringing chord can't trigger twice.
- `chords.js` is generalised from C/Cm to a target list:
  - `createDetector({targets:['C','Cm','G']})` and `attach(ctx, src, {targets, onChord})`. It only ever reports a member of `targets`.
  - It must return null for non-targets, including the chords that share notes with targets: Em (E G B), Am (A C E), F, Gm, Dm, G7, C7, and C+G or G+D dyads.
  - Existing C/Cm tests stay. New suites add G major at G3 and G4, in root position and both inversions, plus the confusion set above, using the existing `tests/audio-sim.js`.
- New file `core/chordbar.js`, which owns its own CSS with the `cb-` prefix:
  - `ChordBar.show({commands:[{chord:'C'|'Cm'|'G', label, run()}], listening})` returns `{flash(chord), setListening(bool), hide()}`.
  - It reuses `chord-card.js` drawing helpers for the mini keyboard if available, otherwise draws its own.
- The lesson-complete popup keeps its `chord-card.js` fingering card: C → Next lesson (or All lessons on the final lesson), Cm → Play again.

### 7.2 Play by Ear mode (WP11): a new mode on Home

**Purpose:** whole-song ear training. You hear a song, and the screen tells you only its key and first note. You work it out by ear, record a real take, then see your take and the real song on one staff.

It is separate from Ear First (§3.7). Ear First is guided and goes phrase by phrase. Play by Ear is a challenge on the whole song.

- Route `#/byear` shows the song list. Route `#/byear/:songId` shows the steps.
- Home card: "**Play by Ear**: Hear a song, work it out yourself, then compare your take with the real thing."
- Songs: the whole library, ordered by level.
  - Each row shows the song's comfort label from mastery (§3.2).
  - Each row shows your best take score, e.g. "Best take: 92%".
  - Nothing is locked. Songs whose notes you don't know yet are marked "Stretch".

#### Steps and chord commands (one screen with 4 steps; a step indicator at the top: Listen · Practise · Real take · Compare)

1. **Listen**
   - Shows **Key: C major** (from the song's key, defaulting to C major), the time signature, and the **first note**: its letter, a single notehead on a mini treble staff, and the key lit on a mini keyboard.
   - The song itself is NOT shown on a staff (ear first). A progress bar runs while it plays.
   - It plays automatically once, at the song's bpm × the speed setting. The speed setting is 75% or 100%, defaulting to 100%.
   - Buttons: Play / Replay, and Speed (75%/100%).
   - Chords: **Cm → Hear it again**, **C → I'm ready to practise**.
2. **Practise**
   - Free play, not scored. The notes you play appear on a live scrolling staff, using the Free Play renderer from WP8 `freeplay-core.js`.
   - A gentle 2:00 countdown ring is shown. When it reaches zero it just says "Ready when you are". It never forces you on. A setting can change the length to 1, 2 or 5 minutes, or off.
   - "Hear it again" is available. While the song plays, the practice staff pauses and the mic is muted.
   - Chords: **Cm → Hear it again**, **C → Start the real take**.
3. **Real take**
   - Recording starts when the C chord is recognised. A small red "Recording" dot shows.
   - Every detected note is recorded as `{midi, at}`.
   - Chord notes are stripped from the take. Remove recorded notes whose onset falls inside the recognised chord gesture (from 250 ms before recognition to 300 ms after) and whose pitch class is in that chord. This applies to the start chord (the C) and the end chord (the G).
   - The take staff is hidden during the take, so you play from memory. Only a live note count shows, e.g. "14 notes so far".
   - Chords: **G → I'm done**, **Cm → Start the take over**. Start over clears the take and begins recording again immediately.
4. **Compare**
   - One treble staff shows the real song and your take aligned column by column. Details are below.
   - Summary: "**20 of 26 notes matched (77%)**", "Best take: 92%". A "New best!" pill appears when relevant.
   - Up to 5 plain-language differences, e.g. "Note 9: the song has E, you played F." and "After note 14 you added an extra D."
   - Buttons: Hear the song, Hear your take. Each highlights the columns as they play.
   - Chords: **C → Next song**, **Cm → Try again**. Try again goes back to Practise with the timer reset.

#### Compare rendering (binding)

**Alignment.** `ByEar.align(songMidis, takeMidis)` is pure, in `modes/byear-core.js`. It is a Needleman–Wunsch global alignment on pitch class:
- match 0
- substitution 1 (0.9 when within 2 semitones, so near-misses align as substitutions instead of gaps)
- insertion 1
- deletion 1
- Ties prefer substitution, then deletion.

It returns columns `[{kind:'match'|'sub'|'missed'|'extra', song?:midi, take?:midi, songIndex?, takeIndex?}]` and `{matched, total: songMidis.length, pct}`.

**Layout.** Columns are spaced equally, at the staff spacing from §3.6. They page or scroll horizontally inside the staff card. Bar lines are omitted.

**Colours and shapes.** These are new tokens in light and dark:
- `--song` (blue): the real song
- `--yours` (red): your take
- `--match` (green): both the same

| kind | drawn |
|---|---|
| match | one **green** notehead at the song's pitch |
| sub | **blue** notehead at the song's pitch and **red** notehead at your pitch, in the same column. If both land on the same staff position (e.g. E vs E♭), offset red by +9 px and draw its accidental. |
| missed | **blue** notehead with a small "missed" tick label under the staff |
| extra | **red** notehead only, in its own column |

**Second encoding, for colour-blind users:**
- your notes are drawn **hollow with a thick ring**
- song notes are **filled**
- matches are filled green with a small ✓ under the column

**Octave folding.** Your note is drawn at the octave nearest the aligned song note. For an `extra`, use the previous drawn note. Fold into C4..G5.

**Legend** above the staff: "● Blue = the song · ○ Red = what you played · ● Green = the same".

**Labels.** A note-names toggle shows letters under each column; your letter sits under the song's letter in red for `sub`.

#### Storage

`slices.byear = { best: { [songId]: { pct, at } }, practiceSecs: 120, speed: 1 }`. Add it to the v2 store schema, with migration defaulting to empty.

#### Files and owners

| WP | Files |
|---|---|
| **WP11** | `modes/byear-core.js` (pure: align, strip-chord-notes, summary text), `modes/byear.js`, `modes/byear.css`, `tests/byear-core.test.js` |
| **WP12** | `chords.js` (generalised), `core/chordbar.js`, `tests/chords.g-major.test.js` |

WP10 wires both into `index.html`, the Home and the router.

#### Acceptance

- **Unit tests** in `byear-core.test.js`:
  - identical take gives 100% and all `match`
  - one wrong note gives one `sub`
  - one missing note gives `missed`
  - one extra note gives `extra`
  - a transposed-octave take still matches
  - chord-stripping removes C/E/G notes inside the window, keeps a melody C played 600 ms later, and keeps non-chord pitch classes inside the window
- **Fake-mic end-to-end:**
  1. Open Mary Had a Little Lamb in Play by Ear. The synth plays it, and the mic is muted, so no notes are recorded.
  2. Pluck C major: you move to Practise.
  3. Pluck a few notes, then C major: the real take starts.
  4. Pluck the song with 2 wrong notes, 1 missing and 1 extra, then G major: Compare shows `data-kind` counts match=23, sub=2, missed=1, extra=1, and "23 of 26 notes matched".
  5. Cm: you return to Practise.
  6. The chord bar is visible on every step, with the right labels.
