# Pixel (16:9 port)

Pixel art at a true low resolution: each picture is a small buffer of whole pixels in a limited palette, scaled up hard to 1920x1080. Bayer dither instead of gradients, a 5x7 bitmap font, sprites from string rows, a device's screen. **Resolution tells time:** an early era is chunkier with fewer colours, so a story gets sharper as it goes. A 16:9 port of cth9191/animate's pixel style (MIT, `LICENSE`); the kit is `ctx.kit`. On twos.

## Eras: a resolution and a palette each
`K.lowres([w, h], draw, { fx: { pal }, post })`: inside `draw(w, h)` coordinates are that era's pixels and every primitive lands on whole pixels; `fx.pal` snaps the buffer to the era's palette. Pick sizes that divide 1920x1080 and keep at least a 2x step between eras.

| res | pixel | feels like | glyphs across |
|---|---|---|---|
| 80x45 | 24 px | the first, roughest version | 13 |
| 160x90 | 12 px | a handheld, an early computer | 26 |
| 320x180 | 6 px | a 16-colour arcade, the late era | 53 |

Palettes (`K.PAL16` by name, `K.HANDHELD` four greens darkest first, `K.PAL8`, `K.MONO`): one per era, and a different one when the eras are different devices. Ink `#14101e` is the paper. Mixed colours are dithered, never blended.

## The medium
- Primitives (world pixels): `pset`, `prect`, `pline`, `pcircle`, `pellipse(…, { ring })`, `ppoly`, `pfill`; `pdither(x, y, w, h, a, b, f)`, `pgrad(x, y, w, h, cols)`, `pglow(cx, cy, r0, r1, c, amt)`. A gradient is two or three palette colours and a dither.
- Sprites: `sprite(rows, map, x, y, { flip, scale, anchor })`, stock `K.SPR` (spark, twinkle, heart, beetle, slime, bird, coin, lamp, rail). Two frames, flipped on the beat.
- The hero: `pixHero(x, y, r, { pal, mood: 'smile'|'wow'|'happy', look, hop, walk, key })` (`HERO_PAL` orange, `HERO_HH`, `HERO_8`), rasterised at the era's size: a later era's hero has more pixels, not bigger ones. Returns `{ head, foot }` in the current view's world pixels (place a bubble from them).
- World props: `stars`, `ridge(key, x0, x1, y, amp, c, { sharp, rim, dark, lightX, snow })`, `pine`, `tree`, `cloud`, `water`, `house`, `building`, `lamp`, `fireflies`, `birds`, `grass`, `coin`. Detail is seeded (`ctx.rng`, `K.hash01`), so it never swims.
- Screen: `post: { lcd }` for a handheld (about 0.1, not graph paper), `{ scan }` for a tube: alphas over the picture, off-palette by design. A curved tube is `fx: { vignette: 2 }`: stepped bands, each a palette colour darker. `fx: { noise, blocks, flicker }` for a rough early era.

## Camera
- **Whole-pixel pans and parallax:** `K.withView(view, fn)`, `K.view({ z, p, to })` in the era's pixels, `K.depth(view, 0.3)` for a far layer. `ctx.push` and `ctx.cam` results work as views.
- **A push re-rasterises:** shapes are drawn again on the same grid (more pixels, never bigger ones); sprites and type scale by whole numbers (type rounds down, so it never outgrows its board). Step the zoom (`Math.round(z * 16) / 16`); a whole-number zoom (2 to 1 on a word) is a native cut.
- **Between eras:** `K.eraMorph(T, { t0, t1, t2, a, b, at, r0, Ga, Gm, Gb, morph, rim })`: the bridge object morphs over the old era (`K.blob`, its grid stepping), then a stepped window with one-pixel rims opens round `at` onto the new era, its grid stepping `Gm` to `Gb`. The object keeps its place and size; only its pixel size changes. `K.stepWindow` for your own.

## Type
- Only the bitmap font, in the era's own pixels: chunkier early, finer late. Never a system font: no `ctx.text` here (`tokens.font` is only the runtime's fallback); words are `pixText`, `pixLetters` and the panels built on them.
- `pixText(str, x, y, colour, { scale, count, cursor, shadow, outline })`: `count` types it on. Every line is registered with the text checks, never under 34 px on screen.
- Hierarchy by whole-number scale, an ink outline and colour; no drop shadow on a board (it doubles a scale-1 stroke: a V reads as a U). One kinetic moment: `pixLetters(str, x, y, c, { each(i, n, ch) -> { dy, dx, show, c } })` drops letters in with a whole-pixel bounce.
- Labels live in the world: `pixSign` on a post, `pixTag(str, x, y)` popping in at double size, `pixBubble` with text or an icon, `palette(cols, x, y)` for an era's colours, `pixCaption` for the rare caption. Never pin a tag to a frame corner.

## Motion
- On twos: TT steps at 15 fps; whole-pixel moves only (`Math.round`, `Math.floor(T * speed)`).
- Things blink rather than fade (stars, windows, lanterns) on `ctx.B` or the beat. Jumps are whole-pixel parabolas; feet, tufts and tree tips flip on the beat.
- Land each change on its word, then let it breathe; something new every 2-4 s.

## Sound
Default score `pulse-112`, effects `on`: pops on bubbles and landings, ticks for swatches, clicks for planks, a crack when something gives, a whoosh into a new era, a chime on arrival.

## Duet
`ctx.bubble` is set: keep x 0-380, y 700-1080 calm. The starter and the demo move the hero and every word right of it; the ground there stays plain (no dither, tufts, vignette).

## Frame checklist
1. Every edge a staircase of equal squares. 2. One palette per era (`fx.pal`). 3. Silhouettes read at the true resolution (dark on a lighter band, a one-pixel rim). 4. The hero acts: it looks, hops, says "!". 5. Three or more details of background life. 6. A full-bleed world. 7. Words in the bitmap font, 34 px or more, in the world. 8. Resolution tells time: later eras sharper and more colourful. 9. Words inside the 64 px safe area, never in the Duet corner.

## Measured (M5 Max, pinned chrome-headless-shell 152, CPU raster; app/qa/style-pixel.mjs)
- In-page draw per frame: starter 5.3 ms mean (p95 10), demo 6.6 (p95 14), showcase 3.9 (p95 7); `cost.msPerFrame` 15. Capture is the cost (about 40 ms a frame).
- HyperFrames, 4 workers, sandboxed: the demo twice, 180 of 180 frames identical.
- Stills of six eras (starter night, morning; the demo's arcade with its fx vignette; showcase V1-V3): every cell of the frame, corners included, is one colour of its era's palette (4, 8, 16): 100 % of 3,600 to 57,600 cells per era. Only the screen lines (LCD gaps, scanlines: alphas) are left out.
- Duet: no word in the corner (56 samples); edge density there at most 0.65x the frame's median cell. Words stay inside the 64 px safe area (a test, Solo and Duet).
- Showcase: 21.77 s, 653 frames, 1920x1080, 30/1; held last 0.5 s 69.7 dB; mix -16.0 LUFS, -1.6 dBTP (pulse-112 + 32 effects, on).
- Media: posters 117 and 112 KB, loops 333 and 276 KB (7 s, the score muxed in). The poster: the window half open at 3.5 s, the 80x45 night outside, the 320x180 morning inside.

## Not matched (from the original)
9:16 framing and 24 fps (now 16:9 at 30, the boil every two frames); the morph-chain renderer's hooks (`window`, `blob`, `STYLE.post`, `ERA_RES`/`ERA_POST` globals) became `eraMorph`, `stepWindow`, `blob` and `lowres`'s `post`; `fx.blur` (it breaks the palette); the deferred overlay queue (draw a caption after the world); the corner `pixTag` (a tag takes a place in the world); `pieceCam` returning null (a re-rasterising camera).

## Notes: the look passes
- Starter. 1: a saw of peaks, slash pines: shadowed, snowy peaks, rimmed pines, a river. 2: dark-on-dark night: a lighter horizon. 3: a tent-like tree: lit, outlined. 4 (review): a dirt mound: a road curving from the hero's feet, sunlit verges, flowers.
- Showcase. 1-4: critters on the sign, a dull chasm, dash planks, a cut sign. 5 (review): V1 held half the piece: re-timed (V1 6.6 s, V2 5.8 s with its own ask, V3 9.3 s, a hold). 6: V1 a handheld screen: LCD 0.11, a dithered band, a rimmed far ridge, 2:1 on the hero, 3x2 planks on a rope. 7: V3's payoff: the sun over the chasm, clear of the hero; the last push on the bridge and the hero; no vignette; the heart from the hero's head. 8: type outgrew its board at 1.25x: it rounds down.
- Demo: captions inside the safe area; the arcade's vignette palette-true.
