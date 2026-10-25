# flpt-tween

FLPT's own seekable tween engine, in place of GSAP (W3-12). The method's moving slides (the beat engine `live-slide.js`,
its three starters, the slides FLPT composes from the deck and the animator crew's folders) were written against GSAP's
timeline API; `flpt-tween.js` gives them the part of that API they use, as `window.gsap`, so nothing FLPT distributes
(the app, the plugin, the web image) carries GSAP.

## Where each part comes from

| Part | Source |
|---|---|
| Timeline, positions, seeking, callbacks | FLPT's own design ("How a seek works", below); times in whole flicks, the unit Oculus published (1/705,600,000 s, github.com/OculusVR/Flicks) so every common frame rate's frames are whole numbers of it |
| Easing curves | Robert Penner's easing equations (BSD License: the notice is in the file's header and in `THIRD-PARTY-NOTICES.md`), each family's `easeIn`, `easeOut` and `easeInOut` written out as he wrote them; `steps(n)` is CSS Easing Level 1's `steps(n + 1, jump-none)`, by its step easing algorithm (credited in `docs/notices/flpt-tween.md`) |
| Colours | The browser's own CSS parser (a canvas reads any CSS colour), mixed premultiplied by alpha as CSS Color Level 4 specifies; outside a browser, hex, `rgb()` and `transparent` only |
| Transforms | CSS Transforms Level 1's matrices, composed and taken apart with FLPT's own matrix code, written on HTML as one `translate()` (px plus the share of the box, in `calc()`) and one `matrix()`; `transform-origin` read by CSS's own grammar; the share of an element's box in its own CSS translate (`translate(-50%, -50%)`) read from CSS Typed OM |
| Numbers | Written to CSS with six decimals, as CSSOM serializes a `<number>`; a plain object's numbers with a double's 15 significant digits (ISO C's `DBL_DIG`) |

GSAP 3.14.2 was the reference the slides were compared against, as a black box: whole renders of every fixture
(`app/qa/flpt-tween.mjs`) and values measured from it in Chrome and in Node (`app/test/flpt-tween.test.mjs`).
Where Penner's equations and GSAP differ, the slides follow Penner: `expo` (GSAP shapes it; under 0.01 apart),
`elastic` with an amplitude under 1 (taken as 1), `elastic.in` and `.inOut` with an amplitude over 1 (Penner writes each
form; GSAP reflects its out curve) and `back.inOut` (Penner scales the overshoot by 1.525). None of the method's slides
or starters uses the last two.

## Where it goes

- `engine/tools/patches/35_gsap_free.py` (`FLPT_GSAP_FREE_V1`) puts a byte copy in each of the engine's three starters
  (`live-slide`, `possible-worlds`, `whiteboard-sketch`), loads it where they loaded `gsap.min.js`, and removes GSAP from
  them. The global skills in `~/.claude/skills` keep GSAP. A changed `flpt-tween.js` reaches the starters at the next
  `python3 engine/tools/apply_patches.py` (a test checks the copies). The same module gives `render.mjs` its checks
  (below).
- `motion.compose` and the animator's `start_slide` copy it from here into every moving slide's `assets/`.

## The subset

| | Supported | Anything else |
|---|---|---|
| Timelines | `gsap.timeline({ paused, defaults: { duration, ease } })`; `to`, `from`, `fromTo`, `set`, `call`, `add` (tweens, timelines, functions, arrays), `remove` | labels, `addPause`, `reverse`, `repeat`, `yoyo`, timeline callbacks |
| Positions | seconds, `"+=n"` / `"-=n"` (from the end), `"<"` / `">"` (the last child's start / end), `"<+=n"` | labels, percentages |
| Tweens outside a timeline | `gsap.set` (renders at once), `gsap.to` / `from` / `fromTo` (render once added to a timeline) | playing on GSAP's global timeline |
| Vars | `duration`, `delay`, `ease`, `stagger` (number, `{ each \| amount, from }`, function), `immediateRender`, `onStart`, `onUpdate`, `onComplete`, `onReverseComplete` (+ `Params`), `callbackScope`, `id`, `data`, `overwrite: false` | `repeat`, `yoyo`, `keyframes`, `overwrite: true \| "auto"`, `clearProps`, plugin properties |
| Properties | CSS properties (numbers with units, colours, strings with numbers such as `clipPath` insets, a switch at the end otherwise), `--custom` properties, transforms (`x`, `y`, `xPercent`, `yPercent`, `rotation`, `skewX`, `skewY`, `scale`, `scaleX`, `scaleY`, `transformOrigin`, `svgOrigin`, `smoothOrigin`; `force3D` is taken and changes nothing: transforms are written in 2D), `autoAlpha`, `attr: {…}`, `css: {…}`, plain objects' numbers | 3D transforms, `transform` strings, plugins (`motionPath`, `drawSVG`, `morphSVG`, `text`, …) |
| Units | `x` / `y`: px or %; angles: deg, rad or turn; `xPercent` / `yPercent`: a number or %; scales: a number. A CSS length changes unit through px: %, em, rem, vw, vh, vmin, vmax | any other unit on a transform; any other change of a length's unit |
| Values | numbers, strings with units, `"+="` / `"-="` / `"*="`, functions `(i, target, targets)` | |
| Eases | `none`, `linear`, `power0`–`power4` (`quad`, `cubic`, `quart`, `quint`, `strong`), `sine`, `expo`, `circ`, `back(overshoot)`, `elastic(amplitude, period)`, `bounce`, `steps(n)`, each `.in` / `.out` / `.inOut`; `Power2.easeOut`-style names; functions; `gsap.registerEase` (one function, no settings in its name) | `CustomEase`, `rough`, `slow`, `expoScale`, `steps(n, …)` |
| For HyperFrames | `play`, `pause`, `paused`, `resume`, `restart`, `seek`, `time`, `totalTime`, `progress`, `totalProgress`, `duration`, `totalDuration`, `timeScale`, `isActive`, `getChildren`, `eventCallback`, `startTime`, `endTime`, `targets`, `kill`, `revert`, `invalidate`; `gsap.parseEase`, `registerEase`, `registerPlugin` (registering is fine; using a plugin's property isn't), `getProperty`, `defaults`, `config`, `ticker.tick()` | `gsap.utils`, the ticker's `add` / `remove` / `lagSmoothing` / `fps`, `globalTimeline`, `quickTo`, `quickSetter`, `context`, `matchMedia`, `delayedCall` |

flpt-tween has no clock: HyperFrames' player and renderer move a timeline by seeking it. So `play`, `pause`, `resume` and
`restart` only seek (when given a time) and set the paused flag, and `timeScale` is remembered without changing a seek.
`ticker.tick()` has nothing to do (HyperFrames' snapshot calls it after each seek).

## Anything outside the subset

Everything in the right-hand column throws `FlptTweenUnsupported`, whose `what` names it. Where that reaches:

- **The page.** A move it can't make (a tween's vars or ease, a position, a seek) is reported where it's asked for,
  whoever catches the throw, as is any other such error the page doesn't catch: listed in `window.__flptTweenErrors`,
  logged with `console.error("FlptTweenUnsupported: …")` and shown in red across the bottom of the page. (HyperFrames'
  render queues a slide's `to` / `from` / `fromTo` / `set` / `add` calls and replays them inside its own `page.evaluate`,
  where a throw never reaches the page's error event; so it's reported at the call.)
- **render.mjs** (the engine's copy, through `35_gsap_free.py`) on a slide that loads `assets/flpt-tween.js`: when it
  syncs, every beat's `to` vars, `ease` and `strokeEase` go through `check()` (the same checks, without a page), each
  failing one a `✗ beat N (target): FlptTweenUnsupported: …` line; `--out` renders nothing while one is left (exit 2).
  After HyperFrames has run the page, any `FlptTweenUnsupported:` line in its log removes the clip and fails the render
  (exit 2) with a `✗ FlptTweenUnsupported: …` line. A CSS property name can only be checked on the page.
- **The crew and the pipeline.** `align_beats` shows the sync's lines; `render_preview` says the render failed and
  shows them; `snapshot` lists them under Problems, and its stills show the red line; `motion.render` names them on
  the slide that stays still.

## How a seek works

The picture at time *t* depends only on *t*. Each seek:

1. puts every property the timeline animates back as it was: the page's own (inline) values, then the first values of
   `from()` and `fromTo()` tweens, which render at once;
2. renders every tween that has started by *t*, in timeline order (a nested timeline or a stagger as a unit at its place),
   each at its own eased progress;
3. writes the page once, then calls `onUpdate` for every tween that has started, in timeline order (`onStart` and
   `onComplete` as the playhead crosses them). The method's callbacks draw from their own tween's values (the pen's
   nib, a count's text), so what they leave depends on *t* alone, and a frame that lands exactly on a pen stroke's start
   puts the nib there. Tweens that a seek had moved past are taken back to their start, last first, for their callbacks
   (`onReverseComplete`). A `call()` is a child of its own with no length: its function runs whenever a seek crosses its
   time, forward or back.

Times (positions, durations, stagger offsets and the playhead) are whole flicks, so sums are exact: a child placed at
16.8 + 1.35 + 0.75 s (18.900000000000002 in seconds) starts on frame 567 exactly. Seconds go in and come out.

Starting values are recorded once, as if the playhead had run to the end: each tween starts where the ones before it
ended. An element's transform is kept as components (`x`, `y`, `xPercent`, `yPercent`, `rotation`, `skewX`, `skewY`,
`scaleX`, `scaleY`), read once from it and replaced by the tween's values: on HTML a `translate(…) matrix(…)` CSS
transform (rotate · skew · scale as one matrix, in 2D throughout), on SVG a `matrix(…)` attribute about an origin in the
element's own coordinates (its box's top-left by default, kept still when the origin moves). A component a tween leaves
where it is draws nothing, so an element no tween moves keeps the page's own transform (any transform but `none` makes
an element a stacking context and a containing block). The CSS `translate`, `rotate` and `scale` properties are left to
the page. Numbers are written to six places (CSSOM's), colour channels whole; a plain object's to 15 significant digits.

## Tests

- `app/test/flpt-tween.test.mjs`: eases (Penner's, beside GSAP's measured values), timeline semantics, determinism
  (shuffled seeks and HyperFrames' own nudge), callbacks, CSS, colours, units, transforms (beside GSAP's measured
  matrices), HyperFrames' calls, the errors, `check()`, the reporting, render.mjs's checks (a stand-in HyperFrames for
  the page's), the animator's `snapshot` and `motion.render` naming them, the starters, the patch module, and no GSAP in
  the engine, the DMG's roots or the plugin's marketplace folder.
- `app/qa/flpt-tween.mjs`: every moving-slide fixture and the three starters rendered through the pinned HyperFrames
  on both engines (K1's deterministic capture and one worker, so frames are drawn in order), compared at 12 sampled
  frames (the card's 40 dB floor) and over every frame (how many frames are identical is reported as seen; it moves
  from run to run); flpt-tween's 4-worker render against its own (HyperFrames' variance); HyperFrames' `snapshot` and
  `check` on each page; the same 12 moments sought in three orders in the pinned Chrome, where every visible element's
  state must be identical; then two moves outside the subset (one render.mjs can check, one only the page finds),
  through render.mjs, the animator's `render_preview` and `snapshot`, and the still.

## D14 audit result (2026-10-23, W4-12)

Two auditors new to the code compared `flpt-tween.js` 1.1.0 with GSAP 3.14.2's `gsap.min.js` (literal and structural
matches) and traced every constant and table to a published source. Rewritten from the published source in 1.2.0:

- **The HTML transform string** (derived: GSAP's renderer term for term, with its 3D-mid-tween rule and fallback): now
  one `translate()` and one `matrix()` from FLPT's own matrix code, 2D throughout; `force3D` changes nothing.
- **The eases' forms** (derived: one curve per family, its other forms reflected, as GSAP builds them): sine, expo,
  circ, back, elastic and bounce are now Penner's own equations, three per family. `back.inOut` and `elastic.in` /
  `.inOut` above amplitude 1 now follow Penner (accepted differences, above); the test that held GSAP's
  `elastic.in(2, 0.5)` holds Penner's.
- **Times** (GSAP's 1e-7 rounding, constant and placement): whole flicks.
- **`transform-origin`** (GSAP's keyword decomposition): CSS's grammar, by axis; a lone `top` or `bottom` is now
  centred horizontally, as CSS says (1.1.0 put it at the left).
- **`call()`** (GSAP's delayed-call construction): a child of its own kind.
- **A plain object's numbers** (GSAP's 1e6 rounding for plain objects): 15 significant digits.
- Smaller: the "unchanged transform component isn't drawn" rule keeps its behaviour, decided once and justified by CSS
  (stacking context, containing block) rather than by 3D drawing; relative values through a table; the transform
  name and setting lists out of GSAP's order; the missing-target warning reworded.

Kept, as interface (what the slides call through `window.gsap`, from GSAP's public documentation; ruled out of D14's
scope on 2026-10-24, below): ease names and which of Penner's curves each power name is (`power1` Quad
… `power4` Quint, `strong` Quint), the documented defaults
(0.5 s, `power1.out`, `immediateRender` for `from` / `fromTo`), the transform property names, `autoAlpha`'s
`inherit` / `hidden`, `smoothOrigin` on SVG, an SVG origin from its own box, `xPercent` on SVG, the position syntax,
`callbackScope` and `…Params` (a callback's `this` and arguments). Also kept: standard math and browser APIs the audits
cleared (Penner's curve constants, bounce, `steps`, colours, matrix parsing and decomposition, SVG origin algebra,
unit conversion, string tweens, stagger). One more behaviour beside GSAP, not a provenance matter: a stagger's
`each` with `from: "center"`, `"edges"` or an index spaces targets by their distance from it (GSAP spreads them over
the whole set: 0, 0.1, 0.2 here against GSAP's 0, 0.2, 0.4); the method's beats only use a number.

Measured on 1.2.0 (`app/qa/flpt-tween.mjs`, the 10 fixtures against GSAP 3.14.2): every sampled frame 49.2 dB or more
(the bar is 40), the worst frame of any clip 47.2 dB, the 12 seeks identical in three orders on every page,
HyperFrames' `snapshot` and `check` passing, both moves outside the subset named with no clip. Drawing in 2D where GSAP
composites a moving element in 3D costs about 10 dB on those frames (demo-05: 1.1.0 identical to GSAP, 1.2.0 49.2 dB;
demo-03: 62.6 → 51.1), on the edges of moving text, well below what shows. `qa/motion.sh` and `qa/animate.sh` clean.

**1.2.1, from the review of 1.2.0 and the rest of the audits' "unclear" items that matched GSAP.**

- **The power family** (Quad, Cubic, Quart, Quint) was still GSAP's: one `Math.pow` curve of the exponent, its out the
  reflection of in, its inOut GSAP's. Now Penner's twelve polynomials, one per degree and form. `bounce.inOut` calls his
  `easeInBounce`, as his equation does.
- **Elastic, bounce and steps** were his math in FLPT's own arrangement: one elastic helper settled amplitude, shift and
  angular frequency once per period for all three forms (the shape of GSAP's configured elastic), bounce's arcs were a
  table, `steps` a one-line formula. Now each of his three elastic equations sets its own period, amplitude and shift
  as he wrote it, bounce is his if-chain, and `steps(n)` is CSS Easing's step algorithm, step by step. Every form of
  every family (back at three overshoots, elastic at five amplitude and period settings) equals a literal transcription
  of his equations at 1001 points, and `steps(n)` CSS's algorithm (`flpt-tween.test.mjs`).
- **Which elements are SVG** (GSAP's three-member test, `getBBox`, `getCTM`, `ownerSVGElement`): CSS Transforms 1's
  own rule, its user agent style sheet's `*:not(svg), *:not(foreignObject) > svg` in the SVG namespace. The SVG
  writer's `transform-origin` is that sheet's `0 0`.
- **`getChildren`** (GSAP's recursion, `ignoreBeforeTime` on the top level only): a walk of this timeline in time
  order, `ignoreBeforeTime` on its own clock for nested children too.
- **`eventCallback`** (GSAP's get / set / delete shape): a callback and its parameters are replaced together.
- **A registered ease with settings in its name** (GSAP's `config.apply`): outside the subset; a registered ease is
  one function.
- Fixes found on the way: an elastic period of 0 is Penner's default (it gave NaN); a margin's or padding's `%` is of
  the width on every side (CSS 2.1 §8.3–8.4).

A normalized token scan of 1.2.1 (run again with elastic, bounce and steps finished: the same) against `gsap.min.js`
3.14.2 (local names folded, property names, numbers and strings kept; runs of 22 tokens) finds one shared run:
`matrix3d`'s 2D part at indices 0, 1, 4, 5, 12, 13, which CSS Transforms 2 sets (at 16 tokens, Penner's back formula
and function openings too). Shared numbers are Penner's constants, small integers, 180, 255, 360 and CSSOM's 1e6;
shared strings are API names and CSS words.

Measured on 1.2.1 as finished (2026-10-24; `app/qa/flpt-tween.mjs`, the same 10 fixtures against GSAP 3.14.2): every
sampled frame 49.2 dB or more (the bar is 40), the worst frame of any clip 47.2 dB, the 12 seeks identical in three
orders on every page, HyperFrames' `snapshot` and `check` passing, both moves outside the subset named with no clip.
`qa/motion.sh` (5 clips, last frame against the slide 31.4–45.7 dB) and `qa/animate.sh` (the sketch animated, Ready, in
the free draft) clean.

**1.2.2, from D14's re-audit of 1.2.1** (two auditors new to it: literal and structural matches; constants and their
sources). Everything else they read was cleared as Penner's, CSS's, a browser API's or FLPT's own. What still matched
GSAP 3.14.2, each rewritten:

- **The timeline's unsupported methods** (derived: the throwing stubs listed in the order of GSAP's Timeline
  prototype, `nextLabel`, `previousLabel`, `currentLabel` among them): now alphabetical.
- **The timeline's bookkeeping** (unclear: GSAP's private field names, and the steps of its `_uncache`,
  `_addToTimeline` and `remove`). FLPT's own names now (`_owner`, `_at`, `_wait`, `_run`, `_curve`, `_subjects`,
  `_playhead`, `_length()`), and two steps are gone. No "most recent" child is kept: `<` and `>` read the latest
  placed child still in the timeline from the numbers children get as they're placed, so a removal has nothing to
  update. No dirty flag walks up the tree: each change to a timeline takes the next number, and a seek records again
  when anything in its tree is newer than its recording. Behaviour unchanged; a test holds both (a removed last child,
  a change inside a nested timeline after a seek). `parent`, one of those fields, is gone with them: neither FLPT nor
  the pinned HyperFrames reads it, and the subset never listed it.
- **`zOrigin`** (unclear: no published source; an internal field of GSAP's transform cache) is out of the 3D list. On a
  page it still stops, as a name that isn't a CSS property; `check()`, without a page, no longer names it.

No private field name in `flpt-tween.js` now appears in `gsap.min.js`; the properties both have are GSAP's documented
`vars` and `data`. The API surface (the "Kept, as interface" items above, which no rewrite can clear) went to the
lead: ruled out of scope (below).

Measured on 1.2.2 (2026-10-24; `app/qa/flpt-tween.mjs`, the same 10 fixtures against GSAP 3.14.2): the same as 1.2.1,
every sampled frame 49.2 dB or more (the bar is 40), the worst frame of any clip 47.2 dB, the 12 seeks identical in
three orders on every page, HyperFrames' `snapshot` and `check` passing, both moves outside the subset named with no
clip. `qa/motion.sh` (5 clips, last frame against the slide 31.4–45.7 dB) and `qa/animate.sh` (Ready, in the free
draft) clean.

**D14 re-audit clean (API surface ruled out of scope)** (2026-10-24, the lead's ruling after INT-4; merged into Wave 5
by R-01). Both re-audits of 1.2.2 found no GSAP table, constant, ordering or structure. What they still matched is the
interface under "Kept, as interface": the names, defaults and syntax existing moving slides and crews call through
`window.gsap`, built from what GSAP documents publicly. D14 is about GSAP's code, and an interface implemented from its
documentation isn't its code, so that surface is out of D14's scope. This file and `flpt-tween.js` describe the
subset in FLPT's own words; keep it that way (no GSAP documentation text copied in).
