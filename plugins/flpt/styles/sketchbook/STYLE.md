# Sketchbook (16:9 port)

Graphite and one accent colour on a warm sketchbook page. Every line is drawn by hand and boils on twos. Things are **pencilled in, inked over, then coloured with a quick scribble**, and hand lettering on the page does the narrating. The page is the world: its dot grid, spiral binding, smudges and coffee ring stay in view, and the camera moves across the page instead of cutting away from it. A 16:9 port of cth9191/animate's sketchbook (MIT, see `LICENSE`); the kit is `kit.js` beside this file, reached as `ctx.kit` (`K` below).

## Palette (`K.SK`)
paper `#f2ead8` · ink `#2a2420` (what is settled) · graphite `#6f6a63`, light `#9a948b` (construction, the mess, hatching) · **terracotta `#d97757` (shade `#b85c3f`) is the hero's alone** · highlighter `#f7d64a` (the one word to read, or one glowing thing) · red marker `#e0483a` (a title underline or a stamp, once) · green `#4f9d5d` (a check) · prop colours, kept small: pencil `#f1bf2c`, wood `#ecc995`, eraser `#ef9aa6`, tape `#efe2b4`, card `#fffdf6`, blue `#3b5c8c`.

## A frame
1. A camera: `ctx.apply(ctx.cam({ z, p }))`. Lean in on the subject, pull back to show the world, always across the same page.
2. The page: `K.sketchPage({ grid })` (frame-sized; paper runs 220 px past it) or `K.sketchPage({ w, h, edge: true })` for a big sheet the camera travels across, on `K.desk(...)` for the pull-back reveal.
3. One thing drawn at a time, the pencil on it: `K.gpencil` (part) first, then `K.gline` (part), then `K.scribbleFill` (part). `K.pencilTool` sits at `K.writeEnd(P, part)`.
4. The hero acting: `K.doodleHero` (mood, look, squash, hop, arms, legs; `part` draws it on).
5. Lettering: in the world (`K.handLetter`, `K.highlight`, `K.underline`), or after `ctx.screen()`: `K.pageTag`, `K.pageCaption`.
6. `ctx.screen(); K.grain()` last.

## Kit API
Lines: `gline(P, {w, col, a, key, amp, part, step, second, closed})` (ink: a confident stroke and a thin second pass), `gpencil(P, {w, col, a, key, amp, part, passes, closed})` (graphite), `gwob`, `writeOn`, `writeEnd`, `closeP`, `loopPts(cx, cy, rx, ry, over)`, `sketchBox(x, y, w, h, r, over)` (closed; `over` 0 for a fill), `crossOut(x0, y0, x1, y1, part, {ink})`, `circleIt(cx, cy, rx, ry, part)`, `dashed(P, {part, dash})`.
Colour and shade: `gfill(P, col, {a, off})` (laid a few px off the ink), `gclip`, `ghatch(x0, y0, x1, y1, {ang, gap})` inside a clip, `litHatch(P)` (a lit circle top left), `scribbleFill(P, col, {part, gap, base})`, `graphiteScribble(cx, cy, w, h, key, {part, loops})` (a scribble ball), `smudge`.
Lettering (Caveat, glyph outlines, boxes registered): `handLetter(str, x, y, size, {face: 'hand' | 'marker', col, align, reveal, ghost, ripple, rot, id})` returns `[left, right]`, `letterW`, `highlight(x0, x1, y, h, part)`, `underline`, `pageTag(str, {at, x, y, size})`, `pageCaption(lines, [[line, 'word']], {at, x, y, size, col})` (in screen space, or in the world after `ctx.apply`).
Page: `sketchPage`/`pageTex` (`{w, h, grid, edge, binding, ghosts, coffee}`; `ghosts: false` or `[fx0, fy0, fx1, fy1]` places the erased lines), `desk`, `bare` (the bare page in screen space, for a bridge).
Props: `pencilTool`, `eraserTool`, `crumbs`, `paperPlane`, `noteCard`, `inkStamp`, `checkMark`, `sparkle`, `arrowPencil`, `sweat`, `doodleStar`, `doodleBird`, `scrap`, `tapeStrip`, `ant`, `bulbPts`, `cloudPts`, `doodleCloud`, `doodleSun`, `doodleHouse`, `doodleTree`, `flag` (each world prop takes a `part` to draw it on).
Hero: `doodleHero(x, y, r, {mood: calm | wow | happy | puzzled, look, sx, sy, rot, legs, step, arms, part})`, `heroPts`.
Bridges: `windowFrame(P, key, inside)` (the world through a graphite outline lifted by a soft smudge shadow), `blob(P, col, key)` (the shape mid-morph). Timing: `popS`, `hop`. Post: `grain`.

## Motion habits
- On twos; everything boils, the grain included. Structure is keyed (`key`), only the tremor changes with the boil.
- Things are drawn, not popped: pencil, then ink, then colour, the pencil prop following the line. Only a reaction pops: a `!`, a stamp, a hop.
- Mess is graphite (`graphiteScribble`, crossed-out tries); what is settled is inked, neat and few.
- Land each change on its word (cue the noun; the pencil starts a hair before), then breathe: the ant, the paper plane looping the margin, margin stars, birds, chimney smoke keep a held frame alive, small and graphite.
- Worlds join on the bare page: the camera closes a window on a shape, `ctx.morph` turns it into the next, and a window opens out of it (`demo/`). Keep a bridge object over 150 px.
- The camera travels one page: lean, pan, tilt, push, track, and pull back to show it all.

## Frame checklist
1. Graphite carries everything; terracotta only on the hero, yellow only on the word to read or the one glowing thing.
2. The lettering narrates: short, one highlighted word, readable at phone size.
3. Some page shows in every frame: the grid, the binding, a smudge or an edge. Leave paper.
4. Write-ons instead of pops.
5. One subject, one gesture: one thing is being drawn at a time.
6. Nothing slides smoothly on ones but the camera.
7. Content inside the 64 px safe area; text at 40 px or more on screen, a closing pull-back included (at z 0.55: 73 px in the world).
8. A Duet keeps x 0-380, y 700-1080 bare page (no lettering, no props).

## Measured (W3-06, M-series, pinned shell, CPU raster, sandboxed)
One run (`style-sketchbook.mjs qa`, 2026-10-23, load average about 30; reruns drift 10-20 % with load). Draw per frame (direct, 4 pages, mean / p95): starter 14 / 16 ms, demo 19 / 30, showcase 26 / 42; capture about 96 ms. A cold page pays once for its texture. HyperFrames: starter 13 s, demo 18 s (240 frames), showcase 38 s (710). Demo and showcase: the same frames in two fresh pages, in order and shuffled. The starter as a Duet: no text box in the keep-out at any frame.

## Not matched
- animate's morph renderer (`STYLE.window/blob/backdrop`): FLPT has no era renderer; bridges are written in the scene with `windowFrame`, `blob` and `ctx.morph` (see `demo/`).
- System hand fonts (Ink Free, Segoe Print, Marker Felt): replaced by bundled Caveat (OFL); the marker face is Caveat Bold with a heavier pen.
- 9:16 safe areas and `DEFER`: captions are drawn after `ctx.screen()`; the tag sits top left under the binding, captions at the bottom, centred.
- `graphiteScribble` circles in small loops while its centre wanders (animate's jumped point to point).
- `sketchBox` closes (animate's last stroke stopped past the top-left corner, leaving the top open).

## Proven on
`starter/` (8 s, Duet-safe), `demo/` (8 s, the lightbulb becomes the sun), the showcase (23.7 s narrated: the mess over the hero at a cliff edge, the gap, a pan across three ideas, the bridge drawn at full size with its passes lettered under it, the walk, the page on a desk).

## Notes: the showcase's look passes
- **Passes 1-3 (stills):** a cropped hero, the desk too early, cluttered labels, zig-zag tangles, a dead lower half, box 3 with no pencil → a wider page, labels beside each box, a loopy scribble, pencil on every drawing, a letter ripple on "map", a tilt at the pull-back.
- **Pass 4 (render):** cliff shading read as grey panels, the bridge as a cage, the route ran under the bridge → ragged hatching bands, fewer hangers, a route from the mess to the flag.
- **Pass 5 (review; stills, then render frames):** boxes open at the top → `sketchBox` closes. The opening cut the hero at the knees → ground 126 px up, the bubble over the hero, the cliff edge in the right third. The ideas held 5 s with a dead middle band → the camera rises to the mess and pans the row (6 % push), each box drawn as its idea comes, landing on box 3 on "bridge"; the far side out. No caption before the end → "pencil / ink / colour" lettered in the gap on its words. Also: crosses clear of the numbers, labels 74-76 px, ghosts off the row, crumbs on the desk, birds above the route.
