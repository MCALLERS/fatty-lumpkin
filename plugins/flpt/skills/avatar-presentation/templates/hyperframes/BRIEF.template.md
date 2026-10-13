# Brief: animate the deck's slides (HyperFrames) — template; fill in P and each agent's slide list

You're turning static deck slides into silent 1920×1080 / 30 fps HyperFrames clips. The video pipeline plays each clip in place of the slide's PNG, with narration and a presenter bubble on top. Four agents are each doing a few slides in parallel, so **consistency matters more than flourish.**

## Paths

| What | Where |
|---|---|
| Project | `<your project>/presentation/` (below, `P/`) |
| Template tools | `T=~/.claude/skills/avatar-presentation/templates/hyperframes` (`render.mjs`, `align-beats.mjs`, `live-slide/`, `examples/possible-worlds/`) |
| How-to, read it fully first | `~/.claude/skills/avatar-presentation/references/hyperframes-slides.md` (build steps, beats.json schema, engine rules, quality checklist) |
| Palette, type and motion constants | `~/.claude/skills/avatar-presentation/references/signature-style.md` |
| Per-slide layout and animation notes | `P/deck/animation_notes.md` |
| Slide source (exact layout, coordinates, copy) | `P/deck/project/slides/<id>.html` |
| Final-state reference | `P/slides/slide_NN.png` |
| Narration for cue phrases | `P/script.md`, under `## SLIDE N` |
| Estimated on-screen seconds | `P/video/est_durations.json` → `"N".est_s`. Make it before briefing: per slide, lead + (narration characters, tags stripped) / 16.5 + 0.5 s per [pause] + 0.3 s per [short pause] + tail (0.6, 0.8 before a cut scene, 1.6 on the last slide). `retime.py` fixes everything once real audio exists. Better: start the paid narration run first and take each real duration from `video/output/presentation.timeline.json`, minus one frame. |
| Your slide's working folder | `P/hyperframes/slide_NN/`, scaffolded with `node $T/render.mjs --new P/hyperframes/slide_NN` |
| Output | `P/media/slide_NN.mp4` |

## Rules

0. **The whiteboard-sketch slide** (if it's in your list) follows `hyperframes-slides.md` → "The whiteboard sketch": hand-drawn doodles on a board, a pen nib on every stroke, hand-lettered labels. It doesn't use the deck's editorial look, and rules 1–2 below don't apply to it.

1. **The final frame must match the static PNG.** Same layout, copy, colours and coordinates. Rebuild the slide's content inside block 3 of the template's `index.html`, porting from `<id>.html`. The PNG is the poster, so a viewer should see no jump between them. Small improvements that serve the animation are fine: for example, splitting a text block so its parts can arrive separately. Don't change any copy, number or source line.
2. **The eyebrow, title, background and source footer are visible from frame 0,** with no animation, on every slide except slide 1.
   - The pipeline crossfades 0.3 s between slides, so the slide's identity should already be there.
   - Slide 1 fades in from black after the cold-open cut scene, so its title may rise in at about 0.6 s.
   - Mark the eyebrow and title `data-nodim`.
3. **The body builds with the narration.** One idea at a time, each beat entering 0.15–0.25 s *before* its words.
   - Give **every** beat a `cue`: a short verbatim phrase from that slide's narration, 2–5 words, unique within the slide. `align-beats.mjs` can then re-time the beats against the real voice later.
   - Initial `t` values: `t ≈ lead + (characters of narration before the cue) / 16.5 + (0.5 s per [pause], 0.3 s per [short pause] before the cue) − 0.2`.
   - `lead` is 0.5 on slides 1 and 9 and 0 elsewhere. Strip `[...]` tags before counting characters.
   - **Once the real narration exists, align to it instead:** `python3 $T/real-words.py <slide WAV> narration.txt words.json`, then `node $T/align-beats.mjs P/hyperframes/slide_NN --words words.json --offset <lead>`. Read the span map that `real-words.py` prints.
4. **Duration.** Use `est_s − 1.0`, rounded to 0.1 s. That errs short on purpose, because shorter clips freeze on their last frame. Every motion must finish by `duration − hold` (use a hold of 1.5), so the hold test passes.
5. **Motion language, the same across all slides.**
   - Engine anims only: `rise`, `fade`, `pop`, `draw` (+`pen` for hand-drawn strokes), `wipe`, `grow`, `words`, `count`, `focus`/`unfocus`, `pulse` (once at most), and `to`.
   - Durations 0.5–0.9 s, eases `power2.out`/`power3.out` (the engine defaults). Talk pacing, not sizzle: no bounces, spins, glitch, shake, or camera whip.
   - Use `focus` sparingly to spotlight the thing being discussed, and `unfocus` before the final state so the last frame equals the PNG.
   - An element only ever targeted by `do:"out"` needs `class="lv"`, or it never fades.
   - When porting deck CSS, scope it as `:where(#slide) :where(p)`, so it can't outrank the engine's classes.
   - Re-encode any embedded video with `-g 30 -keyint_min 30`, or seeking freezes frames.
   - Photos get a slow Ken Burns: an inner `<img>` in an `overflow:hidden` frame, `do:"to"` scale 1.0→1.06–1.08 plus a small translate, starting at t≈0 and ending by `duration − hold`. The PNG shows scale 1.0, so either end the move at 1.0 (a gentle push-back) or accept a slight crop difference in the last frame. Prefer ending at 1.0 on slides where the photo framing matters.
6. **Keep the bubble corner empty:** x 0–380, y 700–1080. Nothing animates through it. Keep labels at least 64 px from the edges.
7. **Local assets only.** Copy the images you need into the slide folder's `assets/`. No web fonts, CDNs or Google Fonts links (the template ships local fonts). Don't install anything: no whisper-cpp, no brew. Don't use any paid service.
8. **Use a private scratch folder** (`P/hyperframes/slide_NN/build/`). Never write generic file names to a shared scratchpad, because a dozen agents collide there.
9. **Stay in your lane.** Only touch your own `P/hyperframes/slide_NN/` folders and `P/media/slide_NN.mp4` files. Don't edit the deck, script, slides PNGs, `media.json`, or the video pipeline, and don't run the video pipeline.

## Render and verify (per slide)

```bash
node $T/render.mjs P/hyperframes/slide_NN --out P/media/slide_NN.mp4 --check-frames P/hyperframes/slide_NN/check
```

- **Read all four check PNGs.** Look for overlaps, clipped text, anything in the bubble corner, and a wrong final state. Compare the last frame against `P/slides/slide_NN.png` side by side.
- The hold test must pass (≥ 45 dB). Fix any `render.mjs` warnings, such as missing ids or motion running into the hold.
- Iterate until clean. A slide renders in about 7–10 s.

## Report back (keep it short)

Per slide, give:
- the output path, duration and render time
- the beats as a one-line list (`t` · cue · what appears)
- whether the hold test passed
- anything you changed versus the PNG, and why
- any problems left over

The engine rules in `hyperframes-slides.md` each cost a render to learn. Read them before you start.
