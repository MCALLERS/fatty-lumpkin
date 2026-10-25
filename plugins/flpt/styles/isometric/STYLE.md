# Isometric (16:9 port)

Calm, precise product illustration: objects in 2:1 dimetric on a white ground, drawn only with constant hairlines. Grey silhouettes and edges, lighter inner and receding lines, faces filled white so nearer objects hide farther lines. Rounded slabs with visible thickness, stacked plates, grids of repeated parts (keys, vents, blades, columns) and **one small dark accent per frame**. Motion **on ones** with spring settles; otherwise still. A 16:9 port of cth9191/animate's isometric (MIT, see `LICENSE`); the kit is `kit.js` beside this file, reached as `ctx.kit` (`K` below).

**The one rule: every line is a hairline, and every face is white.** Lines are 2.4 px on the 1920x1080 frame at any camera zoom (`K.hair` divides the zoom out); only their colour changes. No shadows, gradients, grain or colour.

## Palette (`K.PAL`)
`paper`/`face` #ffffff (the ground and every face: white fills do the hidden-line work) · `edge` #a4a4ac (silhouettes, the cap facing you, sharp edges) · `inner` #e0e0e4 (receding and inner lines: creases, bezels, vents, lanes) · `accent` #232327 (the focus: a cursor, a live LED; one per frame, plus the hero's eyes) · `text` #5c5c64, `textD` #9a9aa2. `K.ground({ dark: true })` switches one frame to the dark theme (ground #101014, accent #f4f4f6: the focus becomes the brightest thing). Lit things are light grey fills (`K.lamp`, a rack's `glow`), never dark.

## A frame
1. `K.ground()` (or rely on the runtime's white), then `K.setIso({ ox, oy, u })`: one projection; x runs right-down, y left-down, z up; one unit along x or y is `u` px.
2. A camera: `ctx.apply(ctx.cam({ z, p, to }))`. Still, a slow push of a few percent, or a deliberate push or pull-back; hairlines stay constant. Ease big zooms in log space.
3. Draw back to front (painter's order): smaller x + y first, lower z first in a stack, riders last. `K.isoGrid(nx, ny, fn)` walks a grid in that order.
4. Words: set into faces (`K.isoText`), as a mono callout (`K.label`), a figure tag (`K.tag`), a caption (`K.caption`) or a display line (`K.title`), after `ctx.screen()` for screen-space ones.

## Kit API (signatures in style.json's api)
Projection: `setIso`, `iso(x, y, z)`, `isoP`, `subIso(x, y, z, k)` (a sub-world, e.g. a model city on a plinth), `toScreen`, `screenPts`, vectors. Lines: `hair`, `polyPath`, `line3`, `hull2`, `zoomNow`; detail that thins as the camera pulls back: `seen(len)`, `lod(px)`, `soft(color, v)`.
Solids: `isoSlab` (a rounded rectangle extruded; it fills its convex hull, so build L-shapes from two), `isoBox`, `isoPanelX/Y`, `isoCyl`, `isoPlates`, `isoGrid`. Faces (u right, v down): `faceOf`, `slabFace`, `boxTop/Front/Side`, `faceRR`, `faceEll`, `faceLine`, `faceSlab` (a key, a pill), `facePts`, `accentDot`, `lamp`.
Motion: `spring(t, t0, { k, damp })`, `kick`, `springTo`, `drop(t0, h)`, `wave(t0, i, j)`, `blinkOn`.
Props and devices: `isoMug`, `isoPlant`, `isoCable`, `laptop` (+ `laptopFaces`), `rack` (+ `rackFaces`; slide, lit, glow, live with `liveMin` px, names at `nameSize`, detail, fine, edge), `tower` (lamp windows, roof: step, tank or mast), `phone`, `card`, `bars`, `block` (base-ten blocks), `lane`, `packet`, `along`, `curve3`.
Type (IBM Plex Sans 300/400 and Mono 400 as outlines; every box registered): `isoText`, `line`, `title`, `caption`, `tag`, `label` (a callout), `mark` (a focus ring), `textW`.
Hero: `cubeBot(x, y, z, s, { key, hop, look, faceX })`, `heroPts`. Bridges (animate's morph renderer): `bridgeAt(tc, A, B, drawA, drawB)`: world A shrinks into its object through a window, the outline becomes B's, world B opens out of it; `through`, `blob`, `bridge`, `kCover`.

## Motion habits
- On ones: smooth, nothing boils. Held frames are still apart from small idle life (the hero's bob and blink, a lamp, steam, a leaf).
- Every move settles on a spring: things **drop in** (`K.drop`), **rise** in a diagonal wave (`K.wave`, 0.028 s a step), **open** on a hinge (a lid, k 80), **slide** (a blade, k 55, damp 0.72), **hop**. Never all at once.
- Land each change on its word (cue the noun; anticipate 2-4 frames), then let it breathe.
- The accent travels: give the focus to one dark thing and move it (a cursor becomes a blade's LED); never add a second, never drop it (far back, `liveMin` keeps it a few px; a blink leaves it hollow).
- To single one out, set the others back to inner grey (`rack`'s `edge`) and light the one (`glow` 0.8-0.9).
- Worlds join by a push into a face, a pull-back (the same world seen from farther: hairlines stay crisp, `lod` thins detail), or `bridgeAt` (an object's outline becomes the next world's).
- Put a count in the picture (things arriving one by one, lanes filling), not over a still one.
- Repeated parts seen small turn to hatching: swap them for their silhouette (racks to a `tower`) under about 14 px.

## Frame checklist
1. Every edge on an iso axis (slope +/-0.5 or vertical), except a part visibly rotating. 2. Hairlines constant and one weight; only the colour changes. 3. Nearer faces white and hiding what is behind (check the painter's order where things overlap). 4. One dark accent, and it is the focus. 5. Detail from repetition (keys, vents, blades, columns), never texture; big faces stay empty. 6. Slabs with thickness and rounded corners; stacks show their layers. 7. White space round the object group; nothing that matters touching the frame edge. 8. Every move settles on a spring, then holds still. 9. Text >= 22 px on screen whenever it shows, words in faces included (face units x u x zoom; `rack` shows names only then); content inside the 64 px safe area. 10. A Duet keeps x 0-380, y 700-1080 bare.

## Measured (W3-14, M-series, pinned shell, CPU raster, sandboxed; app/qa/style-isometric.mjs)
Draw per frame (direct, 4 pages, mean / p95): starter 2.6 / 2.8 ms, demo 4.2 / 5.9, showcase 11.6 / 29.8; capture 43-49 ms. `cost.msPerFrame` 30 is a narrated piece's (the showcase's p95). Demo and showcase: the same frames in two fresh pages, in order and shuffled; the starter by the deep lint. Hairlines on screen at camera zooms ≈ 15, 3.75 and 0.95: 2.38, 2.38 and 2.26 px. Dark blobs: at most 3 in any still, at least 1 in every still after the first beat (a morph's ±0.25 s aside). The starter as a Duet: no text and no edges in the keep-out. Poster 30 KB, tall 31 KB; loops 0.21 MB with the score (drift-90, -21 LUFS). Fonts: IBM Plex Sans Light and Regular, IBM Plex Mono Regular, IBM's own TrueType files.

## Not matched
- 9:16, 24 fps, 2.0 px lines: now 16:9, 30 fps, 2.4 px (thinner lines vanish after compression).
- System fonts (Segoe UI, Consolas): bundled IBM Plex instead, the same on every machine.
- `DEFER`, `SPARK_AT`, `STYLE.post`, era backdrops, hero-to-hero bridges: screen-space type draws at once; `bridgeAt` covers shape bridges on the ground.
- Bevels and non-convex plates: not primitives, as in the original.

## Proven on
`starter/` (8 s: a week of numbers, a callout on the peak, a push to it), `demo/` (7 s: animate's demo, a cursor becoming a server blade), the showcase (24 s narrated: one desk; the cursor becomes a blade in a model city at its far end; ten requests enter one by one; racks stack into towers; the pull-back finds the city smaller than the laptop).

## Notes: the look passes
- **1-5:** the count to the top left, blades thinning (`fine`), one pull-back from "Requests", packets on the cable at the end.
- **6 (review):** two equal plinths, a count over a still hall, no accent when wide, the city as hatching → one desk, the city a model on its stand (0.34x), ten packets entering one by one, the LED kept at 5 px, stacks become towers.
- **7:** the lid's edge in the city shots → the stand moved out; the first and last shots share a framing.
- **8:** "small" didn't read → the others to inner grey, the one lit on the lower third.
- **9 (starter):** faint at Gallery size, still after 3.8 s → u 1.36 (58% of the width), labels in text grey, a push and a ring at 5 s.
