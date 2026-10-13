<!-- Worked brief from *The Shadow of the Future* (2026-10-06): six cartoons by two maker agents, 460 credits in all. For a new video, keep the structure and rules; replace the assignments, per-talk notes and paths. Make and lock your own style frame, and pass its Higgsfield job id as `image_references` on every image so all the cartoons share one look. -->

# Brief: the Cosmos-style cartoons (six segments, two makers)

Each cartoon replaces one narrated slide. The avatar's voice keeps talking, but the presenter bubble is **hidden**, so the frame is a short documentary in painted 2D: limited animation, camera moves over near-still art, small character moves, light and particles, the odd real archival insert, and one fully animated hero shot.

You make the art **and** build the slide's HyperFrames clip.

## Read first
- `<series>/CARTOON_STYLE.md`: the style, the production steps and **the storyboards with cue phrases**. The cue phrases there predate a few script edits, so always re-check them against `script.md`.
- **The locked style frame:** `shadow-series/assets/cartoons/style/STYLE_FRAME.png`, plus `STYLE_FRAME.md`.
  - Its Higgsfield job id. Pass it as `{"role": "image_references", "value": "<job id>"}` on **every** image generation, so all six cartoons share one look.
- `shadow-series/ANIMATION_BRIEF.md` and everything it points to (the HyperFrames base brief, `hyperframes-slides.md`, the engine rules, rendering and verifying). The cartoon slide is a HyperFrames slide like any other, with the differences below.
- Your talk's `presentation/script.md` for the narration and stage notes, and `presentation/video/est_durations.json` for the duration. If `presentation/video/output/presentation.timeline.json` exists, use its real duration.

## Make the art (Higgsfield MCP: `mcp__70607e9b-aa57-4029-8942-2745a1ed5025__*`, load with ToolSearch)
1. **Keyframes:** 4–6 per cartoon, one per storyboard beat.
   - `generate_image`, model `nano_banana_pro`, `resolution: "2k"`, `aspect_ratio: "16:9"`, with the style-frame reference.
   - Start every prompt with the style block from the style frame:
     > 2D digital painting, storybook limited-animation style; bold dark ink outlines with a slight hand-inked wobble; angular simplified faces; two-tone cel shading on figures; painterly textured backgrounds with brush strokes and paper grain; one dramatic light source; deep chiaroscuro; heavy vignette; muted teal-and-amber palette with aged-cream highlights and one oxblood accent; no text, no lettering, no logos, no photorealism, no 3D look, no anime.
   - Then write the beat.
   - Historical people are **clearly stylized**, never photoreal look-alikes.
   - **Character continuity.** For anyone in two or more beats (young Coase; Whistler; the Golden Balls pair; Flood, Dresher, Alchian, Williams and Nash; the Chicago room), generate one character reference first. Then pass it as a second `image_references` on the beats it appears in.
   - **Read every image before you use it.** Re-roll anything off-style, any garbled anatomy and any text that crept in. A re-roll is 2 credits, and quality beats speed.
2. **Layers for parallax** on 2–3 beats per cartoon: separate the figure(s) from the background.
   - Either generate the character on a flat background and cut it out with `remove_background`, or split a keyframe with `generate_image` model `image_decompose`.
   - Download everything into `shadow-series/assets/cartoons/<cartoon-id>/` (`curl` the result URLs), with a `frames.md` log: prompt, job id, which beat.
3. **The hero shot:** one per cartoon. It's the beat marked ★ in `CARTOON_STYLE.md`, unless that beat is real archival film.
   - `generate_video`, model `seedance_2_5`, `mode: "omni_reference"`, `start_image` = that keyframe's job id, plus the style frame as `image_references`. `resolution: "1080p"`, `duration: 5`, `aspect_ratio: "16:9"`, `generate_audio: false`.
   - In the prompt, lock the style: "2D painted limited animation; keep the exact illustration style, line work and palette of the start image; subtle, deliberate motion only; no morphing faces; no new characters; no text."
   - Preflight with `get_cost: true` (about 60 credits).
   - Re-roll at most once. If it still morphs, fall back to a HyperFrames camera move on the still.
4. **Budget:** your hard cap is **300 credits**. Keep a tally in `assets/cartoons/LEDGER_<your-name>.md`.

## Build the slide (HyperFrames)
- Scaffold `P/hyperframes/slide_NN/` from the blank `live-slide` starter.
- The whole 1920×1080 frame is the painting. There's no deck header and no series badge, except a small `CARTOON · TITLE` label in the deck's amber eyebrow style, top-left, that fades in and then out by 3 s.
- **The bubble is hidden on these slides,** so the bottom-left corner may hold art. Keep faces and anything essential out of the bottom-left 380×380 anyway, because the bubble fades back in on the next slide.
- **The grammar:**
  - Each beat's keyframe is on screen from its cue, with a slow camera push or pan (GSAP on a wrapper: scale 1.0 → 1.08 plus a small translate).
  - Parallax layers move at different rates.
  - A cut-out figure can get a tiny "puppet" move: a 1–3° head tilt, an arm raised, a blink by swapping to a second frame.
  - Particles where they fit: dust motes, drizzle, candle flicker, chalk dust.
  - Between beats, an **ink-wipe** transition: a hand-painted-edge mask sweeping across over 0.6–0.8 s. Make one mask PNG or SVG and reuse it.
  - Over everything, a static film-grain overlay (a tiled noise PNG at low opacity, with a slow offset jitter) and a soft vignette.
  - The hero shot plays inside the sequence on its beat. It's a `<video>` element, muted, with the same grain on top.
- **Real public-domain art inside a cartoon** comes from `shadow-series/assets/pd/` and its `manifest.json` (still landing; check again before your final render):
  - **T1 · 1906:** the real 14-bis film (`assets/pd/t1/`) **is** the hero beat ("two hundred and twenty meters"). Grade it warm, put the grain on it, and frame it as a projected film inside the painting, or full-frame with an ink-wipe. Credit it small: "Santos-Dumont's 14-bis, 1906 · public domain".
  - **T4 · Whistler:**
    - beat 2 uses the real *Nocturne* (held up in a painted frame)
    - beat 4 cuts to the 1890 transcript page
    - beat 5 dissolves the spinning farthing into *Punch*'s 1878 cartoon

    Credit each one small.
  - **T3 · Chicago:** beat 1 can open on the 1959 Coast Guard aerial, then ink-wipe into the painted living room.
  - **Talk 2, the Golden Balls cartoon:** no show branding and no likeness of the real contestants. Write SPLIT and STEAL on the balls as HTML overlays in the deck's mono font, not in the generated art.
- Every beat has a `cue` (verbatim narration). Same render and verify loop as the other slides, including the hold test and reading the check frames.

## Assignments
- **Maker 1:** T1 slide 11 "1906" · T3 slide 3 "Coase at twenty-one" · T4 slide 13 "The knowledge of a lifetime" (Whistler)
- **Maker 2:** T2 slide 1 "Split or steal" · T2 slide 3 "RAND, 1950" · T3 slide 8 "Two and two make four" (the Chicago dinner)

## Rules
- Use only Higgsfield (within your cap) and local tools.
- Touch only your slides' `hyperframes/slide_NN/` folders, their `media/slide_NN.mp4` outputs and `assets/cartoons/`.

## Report back
Per cartoon:
- the output path and duration
- keyframes (count, and a contact sheet path: make one with ffmpeg hstack/vstack)
- the hero shot (job id and credits)
- beats and cues
- the hold test result
- credits spent

Then your total spend.
