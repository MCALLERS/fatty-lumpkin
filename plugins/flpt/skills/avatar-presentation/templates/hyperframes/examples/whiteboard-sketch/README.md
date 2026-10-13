# Whiteboard sketch ("avocado toast") starter

A full-frame whiteboard takeover: hand-drawn doodles of concrete things draw themselves stroke by stroke, a marker riding the tip and changing colour with the ink, each doodle arriving as the narrator names it. Short labels are written on in Caveat with the same marker. Rendering this folder as-is plays the **doodle kit sheet** (33 s), a live catalogue of every piece.

Worked example (40 s, the first real use): `games-gtm/presentation/hyperframes/slide_05` ("a save file is a possible world": a game fork, a dragon, a reload, a treasure, then a plant with the same fork mirrored).

## Quick start

```bash
T=~/.claude/skills/avatar-presentation/templates/hyperframes
node $T/render.mjs --new presentation/hyperframes/slide_07 --from whiteboard-sketch
# edit SCENE in index.html (copy the kit doodles you need, move them, delete the rest) + beats.json
node $T/render.mjs presentation/hyperframes/slide_07 --out presentation/media/slide_07.mp4 --check-frames presentation/hyperframes/slide_07/check
```

Iterate on layout with fast stills instead of full renders (no Gemini call, nothing leaves the machine):
`npx hyperframes@0.8.80 snapshot <slide dir> -o <scratch dir> --at 12.5,39.9 --no-end --describe false`

## Files

| Path | What it is |
|---|---|
| `index.html` | Block 1 TOKENS (board `#FBFAF6`, inks, tints, stroke widths, Caveat). Block 2 FRAME + ENGINE HOOKS + BOARD + PEN: keep it, including the board texture and the marker `<g class="lv-pen">` as the **last** child of the stage SVG. Block 3 SCENE: the kit sheet; replace it. |
| `assets/live-slide.js` | Engine 1.1: the live-slide engine plus whiteboard pen features (below). Beats, cues and `align-beats.mjs` / `retime.py` work exactly as for any live slide. |
| `assets/hand.js` | Runs once before the engine: `data-arrow` arrowheads and `data-wobble` hand wobble. Deterministic. |
| `assets/fonts/` | Caveat 400 / 600 / 700 (latin woff2 from @fontsource/caveat) with `OFL-Caveat.txt`. No web font links. |

## Authoring doodles

1. **One stroke = one `<path>` with one subpath.** `draw` restarts the dash at every `M`, so never put two `M`s in a drawn path. A shape that needs two strokes (the A's crossbar, a `$`'s bar) is two paths. The pen draws a group's paths **in document order**, so order them the way a hand would: outline, then details.
2. **Structure per doodle:**
   ```html
   <g transform="translate(130 124)">                 <!-- placement only: never a beat target -->
     <g id="dragon-fill" class="fill"> …tints… </g>   <!-- fade, after the outline -->
     <g id="dragon" class="d ox" data-wobble="1.4" data-seed="dragon"> …strokes… </g>   <!-- draw + pen -->
   </g>
   ```
   Beat targets never carry a `transform` or CSS `opacity`. To `pop` a doodle (the save icon), target an inner `<g>` inside the placing wrapper.
3. **Stroke weight.** `.d path` is 7 px (marker), `.fine` 5 px (faces, ticks, fins), `.bold` 9 px (final circle, underline, cross-out), `.dot` is a zero-length path at 11 px (a round dot). Scaling a wrapper scales the strokes: keep doodles at scale 0.8–1.25, or add `reweight` to the stroke group (`class="d ox reweight"`) when you shrink lettering.
4. **Colour.** A colour class on the group (`ink`, `ox`, `blue`, `amber`) inks every stroke via `currentColor`; one path can switch (`class="fine amber"` for the dragon's fire). The marker's tip and cap take each stroke's colour automatically. For a stroke whose colour is a pale tint (gauge zones) or a white mask path, set `data-pen="var(--blue)"`.
5. **Hand wobble.** `data-wobble="1.4"` on a group (or path) resamples every path under it and bends it with a smooth, seeded noise field: about 1–1.5 for small doodles, 2–2.5 for big circles and long lines. `data-seed` fixes the pattern; paths of one doodle share it, so joints stay joined. Put `data-wobble="0"` on eyes, dots and sparkles. Don't wobble a path you later re-ink with a copy (a branch that turns oxblood when "taken"): leave both unwobbled and make the copy `.bold` so it covers.
6. **Arrowheads.** `data-arrow="20"` appends barb-tip-barb from the end tangent (still one subpath). Author the curve only.
7. **Fills.** Flat tints (`f-ox`, `f-blue`, `f-amber`, `f-ink`, `f-white`) in a `.fill` group placed before the strokes, nudged `translate(4 4)` off-register like real colouring-in, faded in (0.4 s) after the outline finishes.
8. **Write-on labels.** `<text class="hand ox">delay?</text>` inside the stage SVG, beat `anim: "wipe", pen: true`: the marker writes it left to right with a small handwriting bounce. About 0.35–0.6 s for a word, 1.2–1.5 s for a 35-character caption. Tilt with a `transform="rotate(-6 x y)"` attribute on the text to follow a branch; colour part of a label with `<tspan class="blue">`. Very short all-caps words can be drawn as strokes instead (the kit's GAME OVER).
9. **Dotted lines.** A dashed path can't draw on, so draw its **mask**: the visible `.dotted` path is masked by a solid `.reveal` path with the same `d` inside `<defs><mask>`; the beat draws the reveal path with `pen: true` and `data-pen` for the colour. Keep both in absolute (stage) coordinates, not inside a translated wrapper, and draw the arrowhead as its own small path after.
10. **Words on the board.** One to three words per label, 64 px from every edge, and nothing in the presenter keep-out (x 0–380, y 700–1080). The final frame is the deck poster: it should read on its own.
11. **File size.** HyperFrames lint warns above 300 lines of markup (the `<style>` block doesn't count). A 35-beat slide fits; keep comments short rather than splitting the scene into sub-compositions (the pen needs every stroke in one SVG).

## The pen (engine 1.1)

- `pen: true` on a group draws its strokes one after another, the marker lifting and hopping between them; `dur` is split by stroke length (plus `hop`, default 0.07 s, per lift).
- Pen beats less than 0.6 s apart share one pen-down: the marker glides to the next start instead of blinking off and on. One pen draws one thing at a time, so pen beats must not overlap; the engine logs `pen beats overlap at …s` (visible in `npx hyperframes check`). Re-check after `align-beats.mjs` moves the cues.
- The marker is `<g class="lv-pen lv" style="--in: 0">`, tip at (0, 0), with `.lv-pen-lift` inside. Delete it to fall back to the engine's plain dot nib.

## Timing

Roughly 1000–1300 px of ink per second reads as confident sketching: a 300 px doodle in 1.0–1.3 s, an overlay path in 0.7–0.9 s, a fill fade of 0.4 s after the outline. Cue each doodle 0.2 s before its word, chain its details with `after`, and finish the finale by `duration − hold` (after re-timing, the slide ends about 0.6 s after the last word, so the payoff has roughly two seconds from its cue).

## Kit

| Doodle | Ids | Origin, size |
|---|---|---|
| Figure with sword | `kit-figure` | between the feet, about 95 × 135 |
| Save icon (floppy) | `kit-save` (pop), `kit-save-ink`, `kit-save-fill` | centre, 84 × 84 |
| Dragon + fire | `kit-dragon`, `kit-dragon-fill`, `kit-fire` | top-left of a 376 × 240 box, faces right |
| Treasure chest + coins | `kit-chest`, `kit-chest-fill`, `kit-gold`, `kit-sparkles` | top-left of a 250 × 160 box |
| Pump | `kit-pump`, `kit-pump-fill` | housing centre, about 220 × 150 |
| Gauge | `kit-gauge`, `kit-gauge-fill` | centre, r 60 plus stand |
| Broken pump + money | `kit-broken`, `kit-broken-fill`, `kit-money` | housing centre |
| Arrow, rewind arrow | `kit-arrow`, `kit-rewind` | stage coordinates |
| Circle (> 360°) | `kit-circle` | stage coordinates |
| Check, cross-out | `kit-check`, `kit-cross` (over `kit-doomed`) | stage coordinates |
| Dotted line | `kit-dots`, `kit-dots-reveal` (mask), `kit-dots-head` | stage coordinates only |
| Stroke lettering, underline | `kit-letters`, `kit-underline` | top-left, cap height 54 |
