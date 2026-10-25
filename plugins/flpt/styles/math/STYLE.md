# Math (16:9 port)

A manim-like explainer: coloured math on a near-black stage. Formulas are **Written** on (each glyph's outline draws, then its fill comes up, lagged left to right), axes, planes and graphs **sweep** in, equations **Transform** into each other by matching terms, a tracking dot carries a live readout, and a small pi-shaped hero watches. A 16:9 port of cth9191/animate's math style (MIT, see `LICENSE`); the kit is `kit.js`, reached as `ctx.kit` (`K`). On ones, eased with manim's `smooth` sigmoid. No grain, no wobble, no texture: clean strokes; the colour code does the work.

**The one rule: one colour per quantity, everywhere.** Write the code down first (x red, y green, the result yellow, an angle blue) and keep it in formula, figure, labels, readouts and captions. A term that changes identity keeps its colour through the Transform. The look promises rigour: every number shown is true at its precision.

## Palette (`K.MC`)
Stage `bg #0E0E10` (never pure black). `white` operators and neutral text; `grey`, `greyC`, `greyD` axes, ticks, guides. `blueD #29ABCA` number-plane lines only. Quantities: `red #FC6255`, `green #83C167`, `yellow #F7D96F` (often the result or the whole), `blue #58C4DD` (often the angle or parameter); more when needed: `teal`, `gold`, `purple`, `maroon`, `pink`, `orange`. `yellowP #FFFF00` is for `flashAt` and `circumscribe` only. `pi`, `piD` are the hero's, never a quantity's. Fills are the stroke colour at 14-35 %.

## Type
STIX Two Text (bundled, OFL), drawn from its outlines with kerning; `K.SERIF` for your own `ctx.text`. TeX conventions: variables italic (`K.mv`), digits, function names and units upright (`K.mn`), TeX spacing round operators, superscripts at 0.6, a true minus (`K.fmtNum`). Sizes: the main formula 96-112 px, a second line 64-80, figure labels 40-56, ticks 30-36, captions 50; nothing under 28.
- `writeText(segs, x, y, size, p, o)` (segs a string or `[{ s, c, it }]`), `mText`, `textW`.
- Formulas: tokens `K.mv(s, c, { sup, sub, id, supId })`, `K.mn(...)`, operator strings (`'+' '=' '−' '×' '·'`; `'→' '≤' '≥' '≠' '≈'` are drawn), `{ frac: [num, den] }`, `{ sqrt: toks }`, `{ sp: em }`. `writeTex(toks, x, y, size, p, o)` returns the screen layout; `texBox(lay, id)` the box of a term; `texW`. The font has no ∑ ∫ ∞ ∂: say them in words.
- `transformTex(A, B, x, y, size, u, { lift })`: terms with the same id and text glide, others cross-fade; `lift: { id: px }` sends a term over an arc (the exponent coming down in front: `supId`).
- Every word goes through the kit (registered with the text checks). Labels name things; no instructions.

## Plots and the camera
- `K.plane({ at, u | ux, uy, cam: { z, p, to }, x, y })` maps math to screen: `cam` puts math point p on screen at `to`, zoom z. Plots map rather than scale, so strokes keep their width at any zoom.
- `axes2(o)` (swept on: lines, then ticks, then labels; `step` a number or `'auto'` by zoom, `ystep`, `labels`), `numberPlane(A, o)` (finer lines come up as you zoom), `graphM(A, f, x0, x1, p, o)` (sampled over what's visible), `tangent(A, f, x, len, p, o)`, `slopeOf`, `dropLines`, `trackDot`, `readout(label, v, d, x, y, size, o)`.
- Marks: `segLine`, `showCreation(P, p, { closed, fill })`, `squareOn`, `cellGrid`, `mArrow`, `mBrace`, `rightAngle`, `angleArc`, `surround` (SurroundingRectangle), `flashAt` (a point or a lone glyph), `circumscribe(b, u)` (a term in a line: Flash rays would cross its neighbours), `indicateS`, `blob` (a shape mid-Transform; morph with `ctx.morph`).
- Type on a plane sits on a BackgroundRectangle (stage colour, 85 %) with strokes clipped out: no curve under a formula.
- The camera moves in math units: one deliberate push or pull at a time, eased (`keysM` on log zoom for a constant-rate zoom), a reveal by pulling back out. The page itself never shakes or tilts.

## Motion
On ones. Run times about 1 s: Write 0.7-1.0, ShowCreation 0.5-1.0, Transform 0.8-1.0, Flash 0.45. `runS(t0, d)` is a play starting at t0; `lagged(p, i, n, 0.5)` a LaggedStart; `keysM([[t, v], ...])` a smooth keyed value. Never linear but a value a tracker drives. Formulas are Written, never popped or typed. Build a figure in the order of the argument: axes before ticks before labels; sides, then squares, then cells, then the count. Decoration only on the hero (blink, breathe, `hop`) and a Flash or Circumscribe on the result.

## The hero
`piHero(x, y, s, { look, mood: 'calm' | 'wow' | 'happy', hop })`: feet at (x, y), about 150 px at s 1, low right, watching the step being made. It blinks on its own.

## Captions and headings
`caption(segs, t)` writes a line on a black BackgroundRectangle, bottom centre (on a Duet it moves right of x 420). `heading(str, x, y, t)` is a grey italic name with an underline, placed by the thing it names, never in a frame corner. One caption at a time, few words, only what the math supports.

## Sound
Default score `hush` (D major, no percussion), effects `soft`: a tick on each Write, a swish on a Transform, a whoosh on a zoom, a riser into the last push, a chime on a Flash. Give `hits(ctx)` those moments.

## Duet
`ctx.bubble` is set: keep x 0-380, y 700-1080 empty. The demo shifts right (the starter is framed clear of it); captions move right on their own.

## Frame checklist
1. One idea per frame: one formula Written, one figure built or one Transform. 2. Each quantity one colour, the same in formula, figure, labels, readouts. 3. The equation and the picture agree; readouts come from the tracker that moves the dot; rounded values still add up. 4. Real typesetting: italic variables, upright functions and digits, a true minus, no label on a stroke or on another label. 5. Motion explains: drawing a side defines it, a Transform is a substitution, a push is "look closer". 6. Words inside the 64 px safe area. 7. Quiet, true background life: a faint plane, ticks, cells, a right-angle mark. 8. No grain, gradients behind math, glows on UI or corner tags.

## Measured (M5 Max, pinned chrome-headless-shell 152, CPU raster; app/qa/style-math.mjs)
- In-page draw per frame: starter 1.2-1.5 ms mean (p95 1.9), demo 1.5-2.1 ms (p95 3.7), the 25.8 s showcase 1.5 ms (p95 1.9). `cost.msPerFrame` records 10.
- HyperFrames render, 4 workers, sandboxed: the demo 18-53 ms a frame (load; twice, identical; held last 0.5 s 71 dB); the showcase 774 frames in 13-30 s.
- Duet: no word in the corner (64 samples); edge density there 0 against the frame's median cell.
- Showcase: 25.8 s, 774 frames, 1920x1080, 30/1; held last 0.5 s 74 dB; mix -16.1 LUFS, -1.4 dBTP; bed (hush, ducked) -29.8 LUFS, 19 one-shots.
- Media: posters 26 and 29 KB, loops 188 and 195 KB (7 s, hush + soft, AAC 96k); the poster is the turn at 3.5 s, inside the 4:5 crop.

## Not matched (from the original)
9:16 at 24 fps (now 16:9 at 30, on ones); the morph-chain renderer's hooks (`window`, `heroPts`, `STYLE.backdrop`) and beat-cut timing; local system serifs and the mono stack (STIX Two Text is bundled; there is no mono face); the corner section tag (`mathTag`) became `heading`, placed by the scene; strokes now multiply the page's alpha.

## Notes: the showcase passes
- 1. Formula on the y-axis; nothing to compare the curve with. Fixed: a right column.
- 2. Small curve; the comb read as an outline. Fixed: 165 px a unit, dotted tangents, a pulse on "Up close".
- 3. The exponent crossed its base; readouts rounded apart. Fixed: `lift`; readouts from the value shown.
- 4. Comb ticks crossed; a blink in the hold. Fixed: shorter ticks, `blink: false`.
- 5 (review). The curve crossed the formula; the Flash struck through 2.00; ten seconds of one close-up; the comb an outline. Fixed: BackgroundRectangles; `circumscribe`; a chord to a point a fixed screen distance along (Δy/Δx 3.000 to 2.001) and an inset whose box shrinks at each push; the reveal 3.4 s earlier; slopes flying from the dimmed curve onto a small graph of y = 2x. Demo: squares clear of the caption, the big square Indicated.
