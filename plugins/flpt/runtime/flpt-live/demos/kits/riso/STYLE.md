# Riso (16:9 port)

A three-ink risograph print on cream paper: halftone screens at their own angles, overprints instead of mixed colours, plates a few pixels off register, ink dropouts that sparkle in the darks. Flat, bright, a little worn, **on twos**. A 16:9 port of cth9191/animate's riso style (MIT, see `LICENSE`); the kit is `kit.js` beside this file, reached as `ctx.kit`.

**The one rule: nothing is painted, everything is printed.** A frame is a sheet of paper run through three spot-ink plates. A plate only says how much ink goes where (a tone 0..1). The screen turns that tone into dots at the plate's angle, and the inks multiply. There is no black ink and no white ink.

## Palette (plate tones, never RGB)
teal `{teal: 1}` (the key plate) · fluorescent pink `{pink: 1}` · yellow `{yellow: 1}` · `MIX.coral` (pink + yellow) · `MIX.green` (teal + yellow) · `MIX.blue` (teal + pink: the hero's ink-blue) · `MIX.dark` (all three: olive-black, never pure black) · white = paper (`{}`, a knockout). Also `MIX.orange, peach, sky, lilac, olive, rust`.

## Screens and layers
- Angles: teal 15°, pink 75°, yellow 45°. 20 tone levels. Tone 1 prints solid (crisp type and lines).
- Pitch belongs to the illustration and scales with the camera: `PITCH.fine` 7 (tags, small props), `PITCH.world` 10.8 (a world), `PITCH.field` 17.5 (a coarse far field). One layer = one pitch. In close-ups (camera z ≥ 1.5) a field pitch of ~10 keeps the ground from turning into polka dots.
- A frame: `K.sheet()` → `K.printed(pitch, { full: true }, fn)` (the field, whole frame) → `K.printed(PITCH.world, { shapes: true }, fn)` (the world over it) → `K.endSheet()` → screen-space slips (`K.tag`, `K.card`, your own small sheets with a `box`). Each full-frame layer costs ~50–100 ms; give small things a `box`.
- **Fills knock out** (unlisted plates go to paper). **Lines overprint** unless `knock: true`. A glow is `fill(circ, { yellow: rad(...) }, { over: true })`. Put glows in the field layer: in a `shapes` layer the glow's shape becomes mask and knocks the ground out (a pale disc).
- The camera: set it with `ctx.apply(ctx.cam({ z, p, to }))` before the layers; every layer composes it, so the dots pan and zoom with the picture. `ctx.screen()` for captions.

## Kit API (`ctx.kit`)
Sheet and layers: `sheet(box?)`, `endSheet()`, `layer(pitch, { T: {s, x, y, rot}, box, full, auto, shapes })`, `print()`, `printed(pitch, o, fn)`.
Marks: `fill(path, tones, { over, mask, rule })`, `line(P, tones, { w, taper, rough, amt, knock, closed, frac, key })`, `type(str, x, y, size, tones, { knock, align, frac, weight, key, id })`, `rim(cx, cy, r, key, o)`, `rimLine(P, key, o)` (the dry-brush rim), `specks(x0, y0, x1, y1, n, key)`, `clipTo(path)` / `unclip()`, `speedLines(cx, cy, r0, r1, angle, amount, tones, key)`.
Paths: `circ`, `ell`, `poly`, `curvy`, `rect`, `hand(P, key, amt)` (wobbled on the boil), `boxPts`, `ringPts`, `ellipsePts`, `arcPts`; tones: `lin`, `rad`, `MIX`, `inkRGB`.
Hero: `hero(x, y, r, { key, mood: 'smile'|'happy'|'wow', arms: [l, r], look: [dx, dy], hop, hold, shadow, sprout, tones })`: an ink-blue bean with paper eyes, pink cheeks and (by default) a green sprout. Give the sprout to one hero only: it's the identity cue.
Slips: `tag(str, x, y, size, { s, rot, tones, ink, frac, id })` (a yellow slip on a pink shadow), `card(str, x, y, size, o)` (a paper card with a teal rim); `popS(t)` for a back-eased pop.
Geometry: `wobble`, `resample`, `subPath`, `pathLen`, `bbox`, `dist`.

## Motion habits
On twos (`ctx.TT`); wobble, registration, pressure and dropouts boil with `B`. Events and cuts on the words. A world opens or is revealed by a camera move; keep at most one hard cut. Springs for anything with mass.

## Frame checklist
1. Every colour is plate tones. 2. Darks are three-ink overprints with specks; no pure black. 3. White is paper. 4. One pitch per layer, dots visibly change size across a gradient. 5. Fringes visible on dark and ink-blue edges. 6. Fills knock, lines overprint. 7. The paper is flat: no vignette, no blur, no `filter`. 8. Type is printed (solid, misregistered). 9. A field layer covers the frame. 10. Content inside the 64 px safe area.
