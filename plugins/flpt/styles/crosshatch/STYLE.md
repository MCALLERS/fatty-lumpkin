# Crosshatch (16:9 port)

Sketchy ink that redraws itself every two frames, shaded by hand with hatch, cross-hatch, coloured pencil and stipple clipped inside each shape, over paper grain. Two worlds: warm cream paper and wood **outside**, a navy world with periwinkle lines and glowing accents **inside the machine**. A 16:9 port of cth9191/animate's crosshatch style (MIT, see `LICENSE`); the kit is `kit.js`, reached as `ctx.kit`. On twos.

**The one rule: every filled shape is shaded, never flat.** Fill, then a texture clipped inside, shaped by light from the top-left (a density function `dens(x, y) -> 0..1`, darker toward the bottom-right), then the ink outline. Only paper may stay plain.

## Palette (`K.C`)
Outside: ink `#3a2417`, paper `#f4ecd9`, cream `#efe5cf`, wood `#d6a466`, yellow `#f0c55a`, green `#5f9c5c`, sky `#9cc4d6`, rose `#d98b8b`. Inside: navy `#0c0d1c` / `navy2` `#15173a` / `navy3` `#1d2150`, periwinkle `#c8d0f0` (`peri`, `periD`), cyan `#52d6c4`, magenta `#e0368f`, glow green `#5de37a`. **Terracotta `#d97757` is the hero.** Red pencil dashes (`C.plan`) mean a plan, never the thing itself. Give each colour one meaning for the whole piece.

## The medium
- `ink(P, { w, color, amt, key, frac, double, dash, alpha })`: a wobbly stroke, re-wobbled every boil step; `frac` writes it on.
- `paint(P, { fill, line, w, key, tex: [...] })`: textures `{ k: 'hatch' | 'cross' | 'pencil' | 'stipple', c, al, gap, a, dash, per, dens }`.
- `planInk(P, o)` the plan; `noteSheet`, `inkMug`, `drawPencil`, `pill(label, arg, x, y, t)` (a tool-call tag: keep it true), `hero(x, y, r, { mood: 'smile'|'happy'|'wow'|'worried', look, squash, dark })`.
- Worlds: `paperSheet`, `woodSurface`, `stripedCloth`, `darkWorld(key, { drift })`; marks: `hexGrid`, `construct`, `ruler`, `burst` (paper impacts), `sparkBurst` (dark-world sparks), `star4`, `rainbow`, `asterisk`.
- `irisHole(cx, cy, r, { c, inner })`: a ragged hatched hole between worlds; `inner(r)` draws what's through it (screen space).
- Geometry: `ellipsePts`, `rrectPts`, `arcPts`, `box`, `xform`, `resample`, `subPath`, `pointAt`, `bbox`, `wobble`, `trace`.
- `grain()` last, over every frame (in the dark world pass darker specks: `{ dark: 'rgba(10,10,30,0.22)', light: 'rgba(200,210,255,0.10)' }`).
- `globalAlpha` multiplies through the kit, so a prop can dissolve; nothing should simply fade in, though.

## Type
Three voices, all registered with the text checks:
- **Display / kinetic:** `letters(str, x, y, size, { each(i, n, ch) -> { dx, dy, s, rot, al } })`, Caveat Bold. One kinetic moment per piece, big (≥ 120 px on screen): the words themselves move.
- **Labels:** `hand(str, x, y, size, { weight, frac, outline })` and `label(str, x, y, t, { arrow, size, color })`, Caveat 400/700, 56-130 px. Labels live **in the world** (the camera carries them), written on, with an inked arrow when they point at something. Never pin a label to a frame corner.
- **The machine:** `mono(str, x, y, size, color, { count, caret })`, IBM Plex Mono SemiBold, each glyph jittered by hand; `count` types it.
- `card(str, x, y, size)` and `caption(str, t)` (bottom centre, screen space) for the rare caption. Words ≥ 34 px on screen, ≤ 3.5 a second.

## Camera and motion
- The camera is the storyteller: `ctx.apply(ctx.cam({ z, p, to }))`; chain pushes with `ctx.push` or your own key list. Use a push, a reveal (a pull-out that shows the map, a pan that brings the subject in) and parallax: `ctx.apply(K.depth(cam, 0.35))` for a far layer (stars, hex floor), screen-space layers that slide faster than the world for the near one.
- Cross between worlds with `irisHole` (into navy: hole colour `C.navy`; back to paper: `C.paper`) or a match cut on a shape (the coffee becomes the moon). Keep the object that crosses on top, continuous in size.
- On twos: the line boils even in a held frame. Small life everywhere: the hero bobs and blinks, steam curls, nodes tick.
- Land each change on its word (anticipate 0.05-0.2 s), then let the frame breathe; springs for anything with mass (`ctx.spring(dt, 'playful')` for the hero's landings).

## Sound
Default score `drift-90`, effects `soft`: a tick or a click when ink writes or types, a swish for a plan, a whoosh then a sub on an iris, a thump when something lands, a chime on done. Give `hits(ctx)` those moments.

## Duet
`ctx.bubble` is set: keep x 0-380, y 700-1080 empty and calm. The starter and the demo shift their framing right when `ctx.bubble` is set; labels and captions stay right of x 420.

## Frame checklist
1. Every filled shape has a texture shaped by light; no flat fills but paper, and no flat glow bands (a hatched halo and an inked double rim instead). 2. The line boils in held frames. 3. The two worlds read apart on a contact sheet (cream and ink outside, navy and periwinkle inside). 4. The hero keeps its terracotta in both worlds (a glow inside). 5. Textures keyed by name, so they stay put when the camera moves. 6. A plan is red dashes; the doing is ink. 7. No label in a frame corner; no generic sparkle; no centred title on a gradient. 8. Text inside the 64 px safe area, never in the Duet corner.

## Measured (M5 Max, pinned chrome-headless-shell 152, CPU raster; app/qa/style-crosshatch.mjs)
- In-page draw per frame: starter 24.6 ms mean (p95 43), demo 23.6 ms (p95 25), the 24.5 s showcase 57 ms (p95 373 ms, the iris frames). `cost.msPerFrame` records 60.
- HyperFrames render, 4 workers, sandboxed: the demo 35 ms a frame (twice, identical frames); the showcase's 736 frames in 51-123 s (70-167 ms a frame; machine load).
- Duet: no word in the corner (60 samples); edge density there at most 0.99x the frame's median cell.
- Showcase: 24.53 s, 736 frames, 1920x1080, 30/1; held last 0.5 s 63.2 dB; mix -16.0 LUFS, -1.4 dBTP; bed -27.3 LUFS (drift-90, ducked), 32 one-shots.
- Media: posters 82 and 59 KB, loops 706 and 669 KB (7 s, the score muxed in: drift-90 + soft, AAC 96k, -21 LUFS). The poster is the iris at 3.5 s: the moon, the hero and "inside"; the inside's wide fits the centre 4:5 crop.

## Not matched (from the original)
9:16 framing and 24 fps (now 16:9 at 30, the boil every two frames); the morph-chain renderer's hooks (`window`, `blob`, `STYLE.post`) and beat-cut timing; the hero's asterisk mark (the hero is a plain terracotta drop with eyes); local system handwriting and mono fonts (Caveat and IBM Plex Mono are bundled, drawn from outlines); the single-stroke `handwrite` glyphs; `inkTag` (a corner tag) became `label`.

## Notes: the showcase passes
- Pass 1. Weak: a static desk camera, a drop that didn't read (the hole hid behind the note), an empty navy frame, corner tags (a banned default), flat type, a generic sparkle, cables that read as smudges. Fixed: close on the key then a pan that reveals the note, the hole snaps open around the note and swallows it, a closer inside frame, labels moved into the world, a display push at "whole" with the letters rippling, the sparkle cut, cables drawn as hatched tubes in a screen layer.
- Pass 2. Weak: the opening cropped the note mid-sentence; map nodes dead still; number tabs unreadable in the pile. Fixed: the note starts out of frame, nodes tick over, tabs keep their size.
- Pass 3. Weakest shot: the wide map (packets too small, roads sinking). Fixed: bigger packets on the road, lighter road bands. Still the weakest shot; it carries the story in motion more than in a still.
- Pass 4 (review). Weak: the hero hid "#3"; the cables hid "bridge"; the glow read as a flat grey UI border; the map was sparse and its tabs small. Fixed: the hero stands on its tab, the roads drawn closer and the cables lower, a hatched halo with a double rim, a tighter wide with relay boxes, hex mounds and ports, tabs at 36 px or more, roads fanned off A's and B's rims.
