# Riso

A three-ink risograph print on cream paper: halftone screens at their own angles, overprints instead of mixed colours, plates a few pixels off register, ink dropouts that sparkle in the darks. Flat, bright, a little worn, **on twos**. A 16:9 port of cth9191/animate's riso style (MIT, see `LICENSE`); the kit is `kit.js`, reached as `ctx.kit`.

**The one rule: nothing is painted, everything is printed.** A frame is a sheet of paper run through three spot-ink plates. A plate says how much ink goes where (a tone 0..1); its screen turns that into dots at the plate's angle; the inks multiply. No black ink, no white ink.

## Palette (plate tones, never RGB)
teal `{teal: 1}` (the key plate) · fluorescent pink `{pink: 1}` · yellow `{yellow: 1}` · `MIX.coral` (pink + yellow) · `MIX.green` (teal + yellow) · `MIX.blue` (teal + pink, the hero's ink-blue) · `MIX.dark` (all three: olive-black) · white = paper (`{}`, a knockout). Also `MIX.orange, peach, sky, lilac, olive, rust`; `tonesOf('#rrggbb')` for an outside colour.
Fields read best with one or two plates at 0.3–0.75 (an indigo `{teal: .72, pink: .58}`, a dusk `{pink: .4, yellow: .6}`): three plates at mid tones make a muddy rosette.

## Screens and layers
- Angles teal 15°, pink 75°, yellow 45°; 20 tone levels; tone 1 prints solid (crisp type and lines).
- Pitch belongs to the illustration and scales with the camera: `PITCH.fine` 7 (slips, cards), `PITCH.world` 10.8, `PITCH.field` 17.5 (a coarse far field). One layer = one pitch.
- A frame: `K.sheet()` → `K.printed(PITCH.field, { full: true }, fn)` → `K.printed(PITCH.world, { shapes: true }, fn)` → `K.endSheet()` → screen-space slips (`K.tag`, `K.card`, or `K.sheet(box)` + a printed layer + `K.endSheet()`). A full-frame layer costs ~50–100 ms: give small things a `box`.
- Fills knock out (unlisted plates go to paper); lines overprint unless `knock: true`. Glows: `fill(circ, { yellow: rad(...) }, { over: true })` in the field layer (in a `shapes` layer the glow's disc knocks the field out).
- Each plate inks a little unevenly in bands tied to the paper (`layer({ band: 0 })` turns it off).

## Camera
`ctx.apply(ctx.cam({ z, p, to }))` before the layers: every layer composes it, so the dots pan and zoom with the picture. **Parallax:** `ctx.apply(K.depth(cam, 0.4))` before a far layer (0 = pinned, 1 = the world); something above the world (a drum, a hand) draws in screen space, pushed out from the frame's centre by ~1.06 and scaled with it. **Reveals:** `K.iris(cx, cy, r, key, fn)` opens a world in a printed circle with a dry-brush rim; a push to z ≥ 2.5 shows the screen itself (the dots become the subject). In close-ups (z ≥ 1.5) a field pitch near 10 keeps the ground from turning to polka dots.

## Type (three faces, a real hierarchy)
- **Display** Fraunces Soft Black (900): headlines, 110–160 px.
- **Italic** Fraunces Soft italic (`face: 'italic'`): a secondary line, 40–60 px.
- **Mono** IBM Plex Mono SemiBold (`face: 'mono'`, `tracking: 4–6`): labels in capitals, 48–60 px, on a paper card or an ink slip.
Type is solid ink, misregistered with the rest, and registers its box. `type(str, x, y, size, tones, { face, tracking, align, frac, knock, plates, rot, id })`: `plates: { pink: [dx, dy] }` moves one plate's copy (a kinetic misregister); `frac` writes it on. `letters(str, x, y, size, tones, { at, stagger, from: 'drop'|'press'|'rise', plates, ... })` presses a word in letter by letter, each plate sliding into register: the style's kinetic type moment. Inside `place()` pass `id: false` and `ctx.registerBox` the box yourself.

## Kit API (`ctx.kit`)
Sheet and layers: `sheet(box?)`, `endSheet()`, `layer(pitch, { T: {s, x, y, rot}, box, full, auto, shapes, band })`, `print()`, `printed(pitch, o, fn)`.
Marks: `fill(path, tones, { over, mask, rule })`, `line(P, tones, { w, taper, rough, amt, knock, closed, frac, key })`, `type`, `letters`, `typeW(str, size, weight, { face, tracking })`, `rim(cx, cy, r, key, o)`, `rimLine(P, key, o)`, `iris`, `specks`, `clipTo(path)` / `unclip()`, `maskFill(path)`, `erase(path, inks)` (take inks back off: a plate not printed yet), `speedLines(cx, cy, r0, r1, angle, amount, tones, key)`.
Frames: `place({ x, y, rot, s }, fn, off)` (marks in a local frame; `off` moves single plates), `misregister({ pink: [dx, dy] }, fn)`, `depth(cam, d)`.
Paths: `circ`, `ell`, `poly`, `curvy`, `rect`, `rrect`, `hand(P, key, amt)` (wobbled on the boil), `boxPts`, `ringPts`, `ellipsePts`, `arcPts`; tones: `lin`, `rad`, `MIX`, `inkRGB`, `tonesOf`.
Hero: `hero(x, y, r, { key, mood: 'smile'|'happy'|'wow', arms: [l, r], look: [dx, dy], hop, blink, hold, shadow, sprout, tones })`, an ink-blue bean with paper eyes, pink cheeks and a green sprout (one hero only). Slips: `tag(str, x, y, size, o)`, `card(str, x, y, size, o)`; `popS(t)` for a back-eased pop.

## Motion habits
On twos (`ctx.TT`); wobble, registration, pressure and dropouts boil with `B`. Land each change on its word (anticipate 0.05–0.2 s), then hold: small life only (a bob, a blink, a plate drifting a few pixels). Springs for anything with mass; nothing fades in. One world, travelled: pushes, a tracking pan, at most one hard cut. Gallery loops are 7 s (the starter's 2–9 s): end where you began and give drifts a 7 s period, or the tile pops each time it wraps.

## Sound
Default score `pulse-112`, effects `soft` (ticks on labels, a thump when paper lands, swishes on passes).

## Duet
Duet-safe: keep text and fine detail out of x 0–380, y 700–1080 (shift the picture right when `ctx.bubble` is set; plain ground or field there). The demo and the starter both pass the keep-out audit as Duets.

## Measured (M5 Max, pinned shell, 1920×1080)
Draw incl. raster, per drawn frame (on twos, so half the frames): the starter 62 ms mean (p95 65) idle, 76–91 under load; `cost.msPerFrame` 92 is the under-load figure, kept as a conservative estimate. Capture ~88 ms. The showcase draws 94 ms (p95 145); its 24.1 s (723 frames) render in ~36 s, sandboxed. Paper (241.5, 235.5, 226.5); inks teal (54, 137, 171), pink (220, 68, 160), yellow (238, 222, 30); misregistration pink (+4, −3), yellow (−3, +4).

## Frame checklist
1. Every colour is plate tones. 2. Darks are three-ink overprints with specks; no pure black. 3. White is paper. 4. One pitch per layer; dots change size across a gradient. 5. Fringes visible on dark and ink-blue edges. 6. Fills knock, lines overprint. 7. No vignette, blur or `filter`. 8. Type printed, in one of the three faces. 9. A field layer covers the frame. 10. Words inside the 64 px safe area, never half off the frame in a held shot.

## Not matched
animate's morph-renderer hooks (`backdrop`, `window`, `blob`) and its 9:16 caption placement (`risoTag`/`risoCaption` positions) are left out; worlds open with `iris` instead. Its 24 fps / 120 BPM grid is FLPT's 30 fps with `pulse-112` (an 8th = 8 frames).

## Notes (the polish passes, W2-10)
1. Build (five passes): a muddy table, thin drums, slips clipped or hidden, a still Venn. Fixed: shaded drums, name slips, card labels, a drifting Venn.
2. Review: the first 10 s were thin (stripes on confetti, a blank sheet, the right half empty ~5 s); the caption pressed off-frame; the payoff hid the copies. Fixed: each drum prints its own disc on its pass (the `erase` wipe), so the sheet fills as it prints; the camera opens on the teal drum's end, then tracks the pass.
3. Table: one deep blue, `{teal .8, pink .4}` at pitch 10, not three plates on the field pitch (confetti).
4. Type: the caption presses in after the pull-back, ~60 px on a settled sheet; "all three" is a display word whose plates press in and stack.
5. End: two sheets land on "come out" and "quite", each off register its own way.
6. Motion (2 fps strip): the blank sheet held 1.5 s; the pass now leaves the rack rolling and prints from "drum"; slips fold before the frame's edge.
Weakest moment left: the Venn's ~3 s before "coral" (a push into the dots, no label yet).
