# Cut Paper (16:9 port)

Torn-edge paper shapes with soft drop shadows, grain and crayon in every fill, patterns clipped inside (stripes, dots, gingham, wood grain), full-bleed colour worlds, and characters with simple faces. Collage animation: warm, playful, busy with small life, **on twos**. A 16:9 port of cth9191/animate's cut paper (MIT, see `LICENSE`); the kit is `kit.js` beside this file, reached as `ctx.kit` (`K` below).

**The one rule: everything is cut from paper.** No bare shape, no flat fill, no gradient wall. A shape is `K.cut(points, colour, o)`: a torn, gently boiling edge, a shadow that follows the camera's zoom, the paper's grain, optional crayon and a pattern.

## Palette (`K.PAL`)
ink `#2a1d18` · paper `#fbf6ea` · cream `#f3ead6` · blank `#efe5cf` (the bare sheet for bridges) · navy `#26315f` · night `#141c40` · wood `#c08048` · mustard `#d9a441` · yellow `#f6cf55` · teal `#3f9f9a` · mint `#a9d9c6` · pink `#f3a3bf` · sky `#cfe2ee` · purple `#8c7ad8` · blue `#4c6fb5` · green `#5aa05a` · skin1–3, charcoal, brick. **Orange `#ec7a4f` is the hero's alone** (the spark); never a prop, a wall or a word.

## A frame
1. A camera: `ctx.apply(ctx.cam(K.layerCam(cam, f)))` per depth (`f` 0.2 sky, 0.8 wall, 1 the set, 1.2+ near). Pans and pushes move each layer at its own rate: that is the parallax.
2. One wall colour per world: `K.wall(colour, K.pat.stripes(…))`, then `K.floor(y, colour, pattern)` (a desk, a table, grass).
3. Props in front: `K.cut` and the kit's props; then the hero acting.
4. Writing in the world: `K.page` (ruled paper; draw on it), `K.tag` (a torn tag with tape), `K.bubble` (a speech bubble), or, in screen space, `K.caption` (a paper strip). Never bare type.
5. `ctx.screen(); K.grain()` last.

## Kit API
Medium: `cut(P, fill, {key, tear, amt, shadow, sb, sx, sy, pat, crayon, crAl, grain, shade, line, alpha})`, `wall`, `floor`, `pat.{stripes, dots, gingham, lines, grainWood, checks, both}`, `ink(P, {w, color, frac, double})` (a sketchy stroke; `frac` writes it on), `dot`, `glow`, `sparkle`, `pencil`, `torn`, `grain`.
Shapes: `rect`, `ellipsePts`, `rrectPts`, `arcPts`, `capsulePts`, `rot`, `xform`, `bbox`, `resample`, `subPath`, `wobble`.
Characters: `spark(x, y, r, {rays, mood, look, s, key})` (the hero: an orange starburst with a face; bobs, blinks and sways on its own), `face(x, y, s, mood)` (smile, happy, wow, sad, focus), `person(x, y, s, {shirt, shirtPat, skin, hair, long, glasses, beard, mood, look, raise, side})` (a bust; `raise` 0–1 slides one arm up out of the shoulder, behind the head, and returns the mitten's centre), `arm(sx, sy, wx, wy, s, skin, sleeve, {elbow, a, part})` (shoulder to wrist; `part` puts a held thing between sleeve and mitten), `armPose`, `hand`.
Props: `clock`, `cat` (`awake`), `mug` (steam), `plant`, `books`, `house` (`lit`), `tree` (`bare`), `cloud`, `sun` (`face`), `moon` (a crescent cut out), `bird` (`flap`), `bunting`, `gear`, `bubble`, `page`, `lamp`, `star`, `confetti`.
Type: `handText(str, x, y, size, colour, {frac, weight, align})` in Caveat; `tag`, `caption`; `cutLetters(str, x, y, size, {times | at + stagger, colors, align, ripple})`: each glyph cut from its own colour of paper (Fraunces Soft Black) with a cream margin, dropping and settling. All of them register their boxes.
Transitions: `tear(u, key, inside, {dir})` (a new sheet slides over with a torn edge, the paper's white core showing), `windowCut(P, key, inside)` (a world seen through a torn hole: a bridge, a reveal). Timing: `popS(t)`, `springIn(t)`.

## Motion habits
- On twos; the edges boil a hair every two frames (paper life, not jitter).
- Things arrive by pop (`popS`) or drop (a `playful` spring), words by write-on (`frac`) or cut letters. Never by fading.
- Land each change on its word (cue the noun; anticipate 2–4 frames), then let it breathe: idle life keeps a held frame alive (steam, blinks, a moth, a cloud, z's). Give kinetic type a second of rest.
- Arms grow from the shoulder, never across a face; a held thing is pinned to its mitten.
- Worlds join by a torn wipe, a push through a window, or a shape bridge on blank paper (the moon becomes the sun: `ctx.morph`). Keep a bridge object ≥ 150 px.
- A device you can say in a sentence: the spark gains a ray at each step of the story.

## Frame checklist
1. A character with a face, acting. 2. A full-bleed world (one wall colour) with a floor or ground. 3. Torn edges, shadows, crayon and at least one pattern in view. 4. Three or more details of background life. 5. Words only on paper in the world (page, tag, bubble, strip, cut letters). 6. Orange only on the hero. 7. Nothing that matters smaller than 100 px; text ≥ 40 px. 8. Content inside the 64 px safe area. 9. A Duet keeps x 0–380, y 700–1080 plain (no text, no props).

## Measured (W2-13, M-series, pinned shell, CPU raster, sandboxed)
Draw per drawn frame (direct renderer, 4 pages, mean / p95): starter 31 / 32 ms, demo 24 / 36, showcase 41 / 72; capture ≈ 80 ms. The 26 s showcase (782 frames, 384 drawn on twos): HyperFrames 31–55 s, direct 23 s. Demo and showcase: the same frames in two fresh pages, in order and shuffled. The starter as a Duet: no text box and no edges in the keep-out at any frame. Poster 60 KB, tall 46 KB; loops 361 KB and 319 KB with the score. Fonts: Caveat Regular and Bold, Fraunces Soft Black, as TrueType outlines.

## Not matched
- animate's morph renderer (`STYLE.window/blob/backdrop`): FLPT has no era renderer; bridges are written in the scene with `windowCut` and `ctx.morph` (see `demo/`).
- System handwriting fonts: replaced by bundled Caveat (OFL), so type is the same on every machine.
- Per-shape stipple grain and pencil crayon: drawn from seeded tiles (the same look at a fraction of the cost); `pencil` keeps the boiling strokes for scribbles.
- 9:16 safe areas, `DEFER`, `yearTag`/`capStrip` corner tags: 16:9 has captions as paper strips; no labels in corners.

## Proven on
`starter/` (8 s), `demo/` (8 s, the moon becomes the sun), the showcase (26 s narrated: five worlds, a push, a tilt, a pan, a reveal through a window, a spark-shaped hole, one kinetic type moment).

## Notes: the showcase's look passes
- **Pass 0 (stills):** worked first time; a cropped hero in the close-up and the tilt, a lamp beam that read grey on navy, a jar that read as a box, tiny hands in act 6 → reframed, tissue-paper beam, a glass dome, a row of people passing the page.
- **Pass 1 (render, vs the K6 proofs):** texture, camera and sync beat K6; but the opening was lopsided (a big blank page, the spark off-centre), the town a flat frieze with a stray wire, a dead band on the card, everyone blinking at once, the end page repeating the narration → the spark asleep mid-page, a far row of houses and a picket fence for depth, everyone cheers under the letters, blinks keyed per face, a doodle of the town instead of words.
- **Pass 2 (2 fps strip):** the first two seconds barely moved, the reader didn't act, the ending was cluttered and the hero no longer sat where it began → the push starts at once and goes further, the reader reads (focus), turns (wow) and tells (happy), the spark ends on the page's corner where it woke.
- **Pass 3 (full-size frames):** the spark-shaped hole opened on bare wall, losing the callback; a hand covered the "i" of "idea?" → the hole now grows out of the hero itself, centred where the day's spark sits; the reader holds the page by its lower corners.
- **Pass 4 (review):** arms drawn over faces and a page floating above the hands; the hole on the type 0.45 s after it landed; the lamp under the shelf; a mitten in empty air; an empty window on "By morning"; a gradient sky → `raise` and `arm`, the page pinned to the holder's mitten, a second's rest and a ripple on "Until", the hole grown from the page's spark, a wrench on the first gear's hub, the window opening on rooftops, torn sky bands.
