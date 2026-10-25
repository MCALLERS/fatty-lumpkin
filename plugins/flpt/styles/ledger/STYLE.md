# Ledger

An open ledger on a walnut desk under a brass lamp: laid parchment with fibres and foxing, blue ruling, a red double margin, iron-gall ink that goes on wet and dries, thermal receipts that print a line at a time, a vermilion stamp that thumps, numbers that roll like an odometer. FLPT's house look and the **Duet default**: the presenter's bubble lives in the page's margin. On ones. The kit is `kit.js` beside this file, reached as `ctx.kit`.

**The one rule: every mark is made by something on the desk.** Ink is written, receipts are printed, stamps are pressed, numbers roll. Nothing fades in, nothing floats, nothing glows.

## The world
- The neutral camera shows world (0,0)-(1920,1080) of the right-hand page. The page runs from the gutter (x -150) to x 2150, y -130 to 1300, on oxblood boards with gilt tooling; the desk lies well below (depth 0.9); an inkwell stands on the page (nearer: it leans as the camera passes).
- Ruling: blue lines every `K.RULE` (58) from `K.RULE0` (232); the red margin at `K.MARGIN` (420); the amount column `K.COLS` (1000, 1240), amounts right-aligned at about 1222.
- Duet: the bubble's corner (screen x 0–380, y 700–1080) is the margin. Words at world x ≥ 486, never in the corner, and nothing busy there (a receipt's barcode counts): lay a row of receipts right to left, so a printed one is never bottom-left of the next.
- The 4:5 tile is a centre crop (screen x 528–1392): the starter keeps every word in the centre 864 px.
- A frame: `view` → `desk` → page marks → receipts (`depth(g, 1.012)` … `depth(g, 1)`) → stamps → `inkwell` → the pen (`depth(g, 1.03 + lift)`, `nib`) → `motes`, `light`, `grain`.

## Palette and type
Paper `#EFE2C4`, iron-gall ink `#2A1D15` (wet `#120B07`), vermilion `#B3311C` (stamps and ticks only: red means checked), ruling blue `#6F879C`, receipt `#F6F2E8` with print `#353338`, walnut, oxblood cloth, brass.
One job per face: **Fraunces Italic** is the hand (headings, items); **Fraunces Display** the figure (amounts, the total, stamps); **IBM Plex Mono** the machine (receipts, printed eyebrows). Heading 124 · total 128 · lines 62 · eyebrow 34 · receipt label 44, amount 80.

## Kit API (`ctx.kit`)
World: `view(c)`, `depth(g, k)`, `desk(g)`, `book()`, `inkwell(g, x, y, { size, height })`, `PAGE`, `RULE0`, `RULE`, `MARGIN`, `COLS`, `FONT.{display, italic, mono}`.
Ink: `write(g, str, x, y, { font, size, at, dur | frac, align, id })` → `{ w, nib, u }`; `ink(g, str, x, y, { chars, … })`; `measure`; `leader(g, x0, x1, y, { frac })`; `pen`; `tick(g, x, y, { frac, s })`; `rule(g, x0, x1, y, { frac, double })`.
Objects: `nib(g, x, y, { lift, rot })`, `fountain(g, x, y, rot, len)`, `receipt(g, { x, y, w, len, feed, rot, scale, lift, key, draw })`, `slip(q, w, { label, value, key, ticked })`, `tape`.
Stamps and numbers: `press(g, str, x, y, t0, { size, rot, fall })` → jolt; `letters(g, str, x, y, { at, step, size, fall })` → jolt; `stamp`, `stampShadow`, `stampFace`; `odometer(g, v, x, y, { size, align })`; `fmt(n)`.
Atmosphere: `motes(g)`, `light(g, { flicker })`, `grain(g)`.

## Motion habits
- Ones: the camera is smooth, so everything else is keyed, never boiled.
- **Writes**: about 7 characters a second for headings (0.7–1 s), 0.3–0.45 s for lines; the nib rides the write edge. Mono eyebrows print two characters a step (`ink` with `chars`).
- **Receipts** print with the head stepping (26 steps over 0.9 s) from 0.2 s before the label's word; amounts roll to the spoken number and stop on its last word; tape goes on when the paper tears.
- **Stamps** fall 0.2 s (only the shadow, converging), land on the word (+ thump, + sub), throw ink, jolt the camera. A stamp never covers an amount. `letters`: `o.at` is the **first** landing, one letter every `step` (0.07–0.09 s), so the word should cover at + step × (n − 1).
- **Camera**: one world, travelled, `springTrack(…, 'heavy')`: a reveal that flows into the next move (never resting on empty paper), pushes to z ≈ 1.5 on what prints, a pull back to the book on the desk (z ≈ 0.6) for a close. Rarely a cut.
- Bookkeeping is the grammar: a receipt is ticked when its line is posted; a single rule before the total, a double rule when closed.

## Sound
`sound.score: drift-90` (E minor, 90 BPM) as the bed; narrated effects `soft`: `tick` for the print head, `swish` for writes and rules, `click` for ticks and letters, `thump` + `sub` for a stamp.

## Frame checklist
1. Every mark is ink, print, a stamp or paper: no glows, no fades. 2. Red only for ticks and stamps. 3. One hand, one figure, one machine. 4. The paper shows in every frame. 5. Numbers roll, never pop. 6. The light falls off to the corners; the bubble's corner is quiet (edge density ≤ 1.5 × the median tile). 7. No words in the corner; words inside the 64 px safe area, or wholly out of frame. 8. Sums add up; every number is said.

## Measured (W2-07: `node app/qa/style-ledger.mjs qa`, pinned toolchain, CPU raster, M5 Max)
- Cost per drawn frame (draw + capture, 4 pages): starter 33.7 + 116.9 = 151 ms, showcase 46.3 + 110.5 = 157 ms (`cost.msPerFrame` 157); about 66 ms of wall time a frame. The showcase (26.3 s, 789 frames) renders through HyperFrames, sandboxed, in 43 s.
- Determinism: 16 of 16 frames identical in order and shuffled, in fresh pages: starter, demo, showcase.
- The corner: no text box at any 0.2 s (starter 35 samples, showcase 132); edge density 1.03–1.08 × the median tile at the keyframes. No word rests outside the safe area. 4:5: every starter word inside the crop (29 samples).
- Landing: PAID's impact +69 ms after "paid"; the first COUNTS letter −8 ms from "counts".
- Sound: the showcase stem (drift-90, 53 soft effects) -30.1 LUFS under the voice; the mix -16.1 LUFS, -1.4 dBTP. Loops: drift-90 and 13 effects at -21 LUFS; posters 79 and 68 kB, loops 471 and 422 kB (7 s, 16:9 and 4:5).

## Not matched
- An FLPT original; no source. Beyond spike K6's Ledger Duet: a travelling camera, the book, desk and inkwell at their depths, textured iron-gall ink with a feathered write, receipt curl, the lamp's falloff and motes, a kinetic type move (`letters`).
- Not done: a real handwriting face, a page turn, a DOM layer.

## Notes: look passes on the showcase (narrated, 26.3 s)
1–4 (build): a feathered write and textured ink; the lamp shade dropped for depth; framings solved against the safe area and the corner; receipts ticked when posted.
5. Review: receipts small in the upper half for 9 s; a reveal landing on empty paper; "closed" only z 0.8; PAID over the figures; the eyebrow faded in; the book's edge flat; the 4:5 tile cut words. Fixed: the ledger above, receipts printed low (the page longer), a dive straight from the reveal onto a printing receipt, a push to z 1.5 on each; z 0.58 on "closed" with the desk at 0.9 and an inkwell at 1.1–1.15 sliding past; PAID over the entries; the eyebrow printed; boards with a bevel, gilt and a seam; the starter in the centre 864 px, checked.
6. Stills: a printed receipt's barcode in the corner (density 1.72); the inkwell a black box. Fixed: receipts laid right to left; the inkwell as glass with a knurled cap.
7. First render: the receipts' tops peeked into the ledger shots. Fixed: lower receipts, re-solved framings.
8. Final render: every check passes. Weakest left: the dive from the reveal crosses about 0.4 s of plain paper, and the receipts read right to left (Wages, Butter, Flour), against the spoken order.
