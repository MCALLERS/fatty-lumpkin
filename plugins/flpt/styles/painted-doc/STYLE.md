# Painted Documentary

The animated-history documentary, drawn in code: painted plates that hold still while the camera pushes, parallax between them, painted cut-out puppets with fine ink lines and three values toward one light, one dramatic light, ink-wipes between beats, motes in the light, film grain and a heavy vignette. **On twos.** The kit is `kit.js`, reached as `ctx.kit`. An FLPT original (MIT).

**The one rule: the painting holds still; the camera, the light and the puppets move.** Paint every plate once, in `setup` (`K.world`); a frame only composites them, then adds what lives: a puppet's look, a flame, a star, the water.

## Palette
Teal and amber with aged cream, one oxblood accent. `ink #191411` (outlines, wipes) · `night #0D1619` · `deep #163035` · `teal #2E5D61` · `haze #7FA19B` · `amber #DE9C48` · `ember #F2C26E` (light) · `cream #EEE0BF` (type, highlights) · `rust #A35F2A` · `moss #5B6741` · `umber #4B3A2A` · `oxblood #7B292B` (once per piece: a scarf, a shawl, an underline). `K.col(name)` gives RGB; `K.rgba(rgb, a)`.

## Worlds and depths
`K.world(key, { time, horizon, light, glow, stars, band, clouds, far, mid, hill, near, calm })` paints a stack: sky 0.22 · far 0.45 · mid 0.7 · hill 1 (the subject's plane) · near 1.3. `time` is `night|dawn|dusk|day`. A ridge spec: `{ base, amp, scale, seed, peak: [x, y, w], peaks, trees, rocks, props: [{ kind: log|bag|stone, x, h }], grass, fields, rim }`; a near ridge with `peaks` at the corners and a prop makes a dark foreground. `K.draw(world, { between: { 1.01: fn } })` draws your puppets and props at a depth, in that layer's coordinates. `K.ground(world, 'hill', x)` is where feet go.

## Camera
`K.view(K.breathe(K.path(T, keys), T, shotStart))`. Keys `[[t, { z, p: [x, y] }, ease]]` put world point p at the centre; each move eases into its key and holds. **Land every move on a word** (the key's time is the cue), then let `breathe` creep it (0.3–0.5 % a second, a little sway) so nothing is ever dead. Moves to use: the slow push per beat; the crane (a reveal: sky to land or back); the pan that follows a look. Limits, or a plate's edge shows: x within ±300 px of the centre; y down to the ground and up to the sky plate's top (p.y −800) for a crane; z 1–1.7.

## Puppets
`K.figure(x, y, { h, face, kind: coat|dress|tunic, hat: wide|bowler|top|cap|hood, beard, longHair, shawl, cloak, bag, sit, staff, arms: [[shoulder, elbow], [shoulder, elbow]], look, tilt, lean, blink, light, rim, warm, dark, cast, key })`. Painted cut-outs: smooth parts, limbs that taper through a visible elbow and knee, hands that close round a staff, a profile head. Three values per part toward the one `light` (a warm plane, a half-shade, a core shadow), one soft rim stroke only on edges that face it, a fine ink line; hems swing a little on the twos. Give each figure a silhouette you could read in black: a hat or hood, a cloak, a bag, a staff. Limited animation: a look of 10–30°, a tilt of 1–3°, an arm raised on its word (`ctx.spring(T - cue, 'heavy')`), `blink: K.blinking(T, key)`; rest hands on knees with a bent elbow (`arms: [[12, 46], [16, 44]]`). Backlit: `dark: .9, rim: 1` (a true silhouette). By a fire: `dark: .1, warm: .6, cast: .85`, `light` the fire. Seated puppets get a stone (`seat: false` to draw your own); `dress` sits with a lap and a robe falling from the knee.

## Light, water, particles
One light per shot. `K.glow`, `K.shaft({ from, to, w0, w1 })`, `K.star(x, y, r, { a })`, `K.motes(box, { in })` only inside the light, `K.twinkle(box)` for a sky. A camp: `K.firelight(x, y, s)` first (the warm pool on the ground), then the people round it, then `K.fire(x, y, s, { pool: false })` (a ring of stones, charred logs with glowing ends, brushed flames that change on the twos, embers). Rivers: `K.flood(path, { spread, glow, c1, c2, night })`, the path far to near, starting thin at a ridge line, one S toward the viewer (no hooks); it fades in from the distance, mirrors the sky (`c1` the horizon, `c2` the sky above), breaks into level ripples, carries the light's streak under `glow`; `night: true` keeps only the streak. No particle bursts: every particle has a source.

## Between beats
`K.wipe(T, t0, 0.7, shotA, shotB, { dir })`: a loaded brush crosses on a slight diagonal: a wet core, dry-brush streaks dragged behind it, spatter flung ahead, every mark travelling with the front. One or two per piece; camera reveals carry the rest.

## Type
Three voices, never more. `K.label(id, str, x, y, { at, until })`: tracked mono caps with a painted rule (place, date, chapter), brushed on and off. `K.title(id, str, x, y, { at, size, font: 'italic' })`: painted cream serif with an ink shadow, brushed on from the left. `K.line(id, [{ str, at }], x, y, { under })`: the kinetic moment, words that land on their own words (rise, tracking closing in, a heavy spring) with an oxblood underline painted after. Left-aligned on the painting, never centred on a gradient, never in a corner; in a Duet start at `K.safe().x`.

## Finish and sound
`K.finish({ warm, light, grain })` last in every frame: a warm soft-light wash from the light, grain on twos, the gate and the vignette. Score `drift-90`, effects `soft`: `whoosh` on a wipe, `chime` when a star appears, `tick` per repeated beat, `riser` into the last line, `thump` as it lands.

## Duet
`duetSafe`. Give the world `calm: [x0, y0, x1, y1]` (plate coordinates, wide enough for the push) so the corner gets no grass or detail; `finish` darkens x 0–380, y 700–1080 further; type starts at `K.safe().x`.

## Frame checklist
1. One light, and everything faces it: rims toward it, shade away. 2. Teal shadows, amber light, cream highlights; oxblood once. 3. Every plate painted in setup. 4. The camera lands on a word, then breathes. 5. Puppets move on their words, a little. 6. Depth reads: far is paler. 7. Grain and vignette on every frame. 8. Type in three voices, left on the painting. 9. Nothing in the Duet corner. 10. Inside the 64 px safe area.

## Measured (flpt-live 1.0.0, this Mac, pinned Chromium, sandboxed)
Draw cost (direct renderer, every drawn frame): starter 41.3 ms mean / 56.5 p95, demo 34.6 / 51.2, the 25.8 s showcase 36.2 / 54.1; `cost.msPerFrame` 60. HyperFrames renders the showcase's 775 frames in 36–45 s; hold 59.2–59.3 dB. A world paints in about 1 s of setup. Demo (Duet): 0 text boxes in the keep-out over 28 times; the corner's edges 0.45–0.54 of the frame's median tile. Posters 42 KB and 41 KB, loops 0.36 MB with drift-90 at -21 LUFS.

## Not matched
The Cosmos cartoons are generated paintings with drawn characters; here everything is procedural. Puppets are painted cut-outs in profile (no three-quarter faces, no fingers, a few poses); crowds, animals, buildings and machines aren't in the kit; water is a river, not a sea. Use real stills (`ctx.asset`) for anything the kit can't paint.

## Lessons (rules)
- Open on something, not empty sky: land the first move on a subject within 2 s.
- Subjects fill a third of the frame: push to 1.3–1.7 on puppets; never a wide of tiny figures.
- Seat every sitter; frame a camp low and close, the people on the lower third and the lit ground below them.
- Water starts at a ridge line and fades in; no hard edge round it, no pale band across dark land.
- A star or an arc that matters is drawn solid and repeated on its word, never faint.
