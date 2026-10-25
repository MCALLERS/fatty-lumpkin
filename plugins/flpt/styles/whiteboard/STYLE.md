# Whiteboard (FLPT original)

FLPT's "avocado toast" sketch, as a Live Motion style: a clean warm whiteboard, and hand-drawn doodles of concrete things that draw themselves stroke by stroke as the narration names them, a marker riding the tip in the stroke's colour. Flat, opaque marker ink. Short labels are written on in Caveat; big words are lettered by hand in stroke capitals; everything accumulates, and the punchline gets a loop drawn round it. **On ones** (a live pen). The kit is `kit.js` beside this file, reached as `ctx.kit` (`K` below).

**The one rule: the pen draws everything.** Nothing fades, pops or slides in. One idea through concrete things and a person (a figure whose face reacts), not boxes and arrows.

## Inks (`K.INK`) and tints (`K.TINT`)
ink `#17202b` (line work) · ox `#9b2f4c` (the punchline, a bold re-ink, a cross-out) · blue `#1f5a85` · green `#2e6e4a` · amber `#a2600f` (rays, warmth) · muted `#5b6573`. One or two accents per piece. A tint colours a shape in after its outline (`fill: 'blue'`), a hair off register; a hatch scribbles it in with the pen (`hatch: 'amber'`). Board `#fbfaf6`.

## A frame
1. A camera: `K.view(K.track([{ z, p }, { at, dur, z, p }, …]))`: the first stop holds; each next glides in over its `dur` (world units; z 1 shows 1920×1080). Start close, hold a few whole views, pull back to reveal.
2. `K.board()`: the surface (warm room light under the ink, faint tooth and mottle, ghosts of old drawings, a gloss slower than the board).
3. The drawings, each with its own `at` in seconds, chained and keyed to their word: `const a = K.doodle('clock', …, { at: cue('alarm') - 0.25, cue: 'alarm' }); K.write('cue', …, { at: a.end + 0.1 })`.
4. `K.pen(); K.light();` last.

**Call every drawing on every frame**, unconditionally: it draws nothing before its `at`, and the pen reads the frame's whole schedule to know where to be (on the tip, hopping between strokes, gliding between drawings under 0.6 s apart, lifting away after). Never wrap a drawing in `if (t > …)`.

## Kit API
Drawings (all take `at`, `dur` (else by ink length), `ink`, `alpha`, `pen: false`, `wobble`, `seed`, `cue`; return `{ at, end }`):
- `doodle(name, x, y, { s, rot, flip, fill, hatch, part, parts, key })`: a kit doodle centred on (x, y), ~200 px at s 1. `K.doodles()` lists them: bulb, clock, cup, shoe, person, bed, house, tree, sprout, sun, cloud, gear, plane, rocket, heart, star, coin, chart, calendar, envelope, magnifier, flag, target, box, book, laptop, phone, speech, thought, mountain, money. Parts draw on their own (`part: 'ring'`) or with it (`parts: [...]`, which replaces the defaults): bulb rays, clock ring, cup steam, shoe speed, bed zzz, sun rays, cloud rain, rocket flame, chart trend; person (feet at y): legs or run, arms, swing, cheer, point or hold, and a face: smile, grin, sleep or focus (`parts: ['run', 'swing', 'focus']`). The wobble is seeded by name and place, so two clocks are drawn twice by hand; `key` keeps one wobble anywhere (a doodle that moves).
- `sketch([d | [weight, d, ink]], x, y, o)`: your own doodle from path data (M L H V C S Q T Z); a new `M` is a new stroke, drawn in order. Weights: m marker 9 px, f fine 6.5, b bold 12, dot. `o.shape` (closed path data) takes a fill or hatch.
- `line(points, { head, weight })`, `arrow(a, b, { bend, head, weight })`, `dots(points | d, { gap, head })` (dabbed on), `loop(x, y, rx, ry, { a0 })` (bold ox, a bit over a turn), `underline(x0, x1, y)`, `box(x, y, w, h)`, `check(x, y, { size })`, `cross(x0, y0, x1, y1)`, `rays(x, y, r0, r1, n, { a0, span })`, `ellipse(…)` (points).
Words:
- `write(str, x, y, { size, weight, ink, align, rot, halo })`: Caveat written on by the pen (labels 80–100 px; 1–3 words). `halo: true` clears lines under it.
- `letters(str, x, y, { size, ink, align, rot, track })`: stroke capitals lettered by hand, cap height `size` (titles and the punchline, 70–160): heavy, tight, each letter a little turned, sized and lifted on its own (seeded by the word). A–Z, 0–9 and `! ? . , ' - + = / : $ %`.
- `writeW`, `lettersW`: widths, for layout.
Pen: `pen()` draws the marker; `jobs()` is the frame's schedule, `jobs({ boxes: true })` with each drawing's whole extent on screen (for checks).

## Motion habits
- Key each drawing to its word (`cue`) and start it 0.15–0.25 s before (QA allows 0–0.3). One pen: drawings never overlap in time (`K.jobs()`).
- Outline first, then details, then the tint or hatch. A doodle draws in 0.5–1 s (set `dur` when the narration is quick); a label in 0.3–0.5 s.
- Few, slow moves that glide (smoothstep): at most 35 px a frame at the frame's corners, pan and zoom together. Every held view (drift included) holds each drawing begun whole inside the 64 px safe area or wholly off screen; frame the next station before the pen gets there.
- Re-ink to deepen (the same arrow again, bold ox), tick at speed, cross out, loop the punchline.
- The last drawing ends at least 0.4 s before the hold, so the pen has lifted away by then.

## Frame checklist
1. Concrete doodles, each named in the narration; a person whose face fits the beat. 2. One idea per board; it accumulates and fills the frame (about 80 % at the reveal). 3. A hierarchy: stroke capitals for the title, Caveat labels, the punchline biggest and looped. 4. One or two accent inks. 5. Words 1–3 per label, ≥ 40 px on screen, inside the 64 px safe area. 6. The camera moves with purpose (close, whole views, a reveal). 7. A Duet keeps x 0–380, y 700–1080 plain at every frame, the moves included.

## Measured (W3-08, M-series, pinned shell, CPU raster, sandboxed)
Draw per frame (starter, direct renderer, 4 pages): mean 21–28 ms, p95 19–24 across runs (tiles, sprites, light made once a page). The board in H.264: #F7F6EF–#F9F7F3 at the centre, #EFEDE7–#F1EFEB at the corners, R > G (flat #fbfaf6 comes out #F7F7F3). Every frame of the starter, demo and showcase: corners move ≤ 15, 23, 32 px a frame; no hold slices a drawing; the pen ends 3.7, 1.1, 0.55 s before the hold; the showcase's 16 drawings start 0.03–0.28 s before their words. Fresh pages draw the same frames in any order; the demo with 2 and 6 HyperFrames workers is identical on the Mac and in K3's Linux container (Linux vs Mac ≥ 42.9 dB). The starter as a Duet: no word, no edge in the keep-out; its thought is done by 4.9 s in the middle 864 px, so the poster (5.4 s) and the 4:5 crop show it whole. Caveat as TrueType outlines.

## Not matched (from the HyperFrames whiteboard starter)
- SVG doodles and GSAP: path data drawn on the canvas; the pen's pose comes from t and the frame's schedule (the starter's pen moved with seek history, spike K3).
- `focus` (dim the rest): pass `alpha` to a drawing instead.
- The SVG noise filters on the board: seeded tiles made once (the same on every machine).

## Proven on
`starter/` (9 s: an idea takes off), `demo/` (8 s: day one to year ten), the showcase (23 s narrated, "Every habit is a little loop": a person asleep as the alarm rings, running, grinning over coffee; the loop round a month of ticks, deepened in ox; "decide?" crossed out; the reveal of "just TUESDAY." looped).

## Notes: the look passes
- **Passes 0–4 (first build):** softer ghosts, a gloss with parallax, ring timing, lifts by distance, a slower camera.
- **Pass 5 (beside the house's avocado toast, slide_05):** glossy tubes with dark joins; capitals like a geometric typeface; a grey-green board; sparse frames, no character; holds sliced the title and clock → flat opaque ink, 20–30 % heavier; capitals heavier, tighter, each letter off true; board #fbfaf6, half the mottle, a warm vignette; a person at each station, ~80 % filled at the reveal; every hold checked whole.
- **Pass 6 (the render, each hold):** the return arrow crossed "decide?", the loop crossed "just" → calendar up, arrow down, "just" inside the loop; the cue station held close, not lopsided; the centre a level dark → a pool of light under the ink.
