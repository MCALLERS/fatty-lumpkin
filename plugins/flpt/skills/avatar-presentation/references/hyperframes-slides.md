# HyperFrames slides: the "live animation" slide

A live slide is a slide whose picture builds on screen while the avatar talks. The actual world appears as it's named, then a ring of options draws around it, then the answer lights up. It's rendered with HyperFrames (HTML → MP4) as a silent 1920×1080, 30 fps clip. The video pipeline plays it in place of that slide's PNG, with the narration and presenter bubble on top.

The look comes from the user's reference, the "Avocado toast" segment of Nate Herk's *Opus 5.5 Just Changed Video Editing Forever* (10:40). There, Claude Code built a HyperFrames edit from one prompt: hand-authored SVG doodles draw on stroke by stroke with a pen nib riding the tip, one idea at a time, timed to the transcript. Some scenes are full-frame whiteboard takeovers, and others are a whiteboard half beside the speaker. We keep that grammar (build step by step, draw strokes live, time everything to the words) in the deck's editorial palette.

## The whiteboard sketch ("avocado toast"): required, once per video

**Why this section exists.** In Latham v2 every slide was animated, but all of them were *diagram builds in the deck's editorial style*. The user noticed there was no avocado-toast-style animation and asked for one in every video from now on (2026-09-27). A diagram build doesn't count. The sketch is its own signature element.

**What it is.** A full-frame whiteboard takeover where simple **hand-drawn doodles of concrete things** draw themselves stroke by stroke. A visible pen nib rides the tip, and each drawing appears exactly as the avatar names it. Think: a law-firm building, a GPU box carried into it, a Go stone turning into a stack of redlines, a partner's thought bubble. These are objects and little scenes, not boxes and arrows. It explains one idea through a concrete drawn metaphor over about 20–45 s of narration.

**The grammar:**
- **Surface.** A warm white board (`#FBFAF6` with a faint deterministic texture and a soft vignette, as in the starter), full frame. There's no deck header, or at most a small hand-lettered title.
- **Strokes.** Hand-authored SVG, **one continuous subpath per stroke** (the `draw` rule), with round caps and joins and marker-weight lines (6–10 px). Give them a slight hand wobble. Never perfect geometry, never clip art.
- **Ink.** Ink `#17202B` for line work, plus 1–2 accent inks from the palette (oxblood, blue) for the thing that matters. Optional flat fills can "colour in" a shape after its outline draws (`fade` on a fill layer under the stroke).
- **Pen.** `pen: true` on every doodle. In the whiteboard starter's engine, `pen: true` on a group draws its strokes one after another in document order (outline first, then details) with a marker riding the tip in the stroke's colour. Close pen beats glide instead of blinking; overlapping ones log `pen beats overlap`.
- **Words.** Hand-lettered labels, short (1–3 words). Caveat (400/600/700, OFL, local woff2 plus licence) ships with the starter: `wipe` + `pen: true` on an SVG `<text>` writes it on with the marker. Very short all-caps words can be drawn as strokes (the kit's GAME OVER). Never a web `<link>`.
- **Pacing.** One doodle per idea, entering 0.15–0.25 s before its word. Everything accumulates, uses `focus` to point, and ends with an underline or circle drawn around the punchline.
- **Bubble corner.** It stays empty, as on every slide.
- **Reuse.** Borrow from the registry and student kit: `whiteboard-ink`, `hw-arrow`, `hw-box-label`, `hw-underline`, `hw-callout-circle`, `hw-boil` (jitter; off by the final hold). Also borrow from the `video-storytelling` whiteboard patterns.

**Picking the slot.** In step 5, propose 1–2 candidate slides: the most abstract idea in the talk that has a concrete everyday metaphor. Show the user a 3–5 beat sketch plan (what gets drawn, on which words) before building.

**Build it from the starter:** `node $T/render.mjs --new presentation/hyperframes/slide_NN --from whiteboard-sketch`. The folder (`templates/hyperframes/examples/whiteboard-sketch/`) holds the board surface, the marker pen, Caveat, `hand.js` (`data-wobble` hand wobble, `data-arrow` arrowheads) and a doodle kit rendered as a sheet: figure, save icon, dragon, chest, pump, gauge, broken pump and `$`, arrow, rewind arrow, circle, underline, check, cross-out, dotted line (mask) and stroke lettering. Copy the doodles you need into SCENE, place each with a wrapper `translate`, write one beat per doodle cued to its word, and render as usual. **Read its `README.md` first**: single subpaths, stroke weights, wobble, fills, write-on labels, dotted lines, pen timing. Iterate on layout with `npx hyperframes@0.8.80 snapshot <dir> --at <t,…> --no-end --describe false` (stills in seconds) before full renders. Worked example: `games-gtm/presentation/hyperframes/slide_05` (40 s, 35 beats: a game fork, a dragon, a reload, a treasure, then a plant with the same fork mirrored). Later option to explore: the reference's "whiteboard half beside the speaker" layout, with a larger avatar on one side. That needs a pipeline layout mode, because today there's only the bubble.

## When to use one

- **Use it** for the one or two slides per talk where the idea is a *structure that grows*: a diagram, a process, a set of options, a before/after, a number that should land. It's a signature element (`signature-style.md`), with at least one per video.
- **Use a static slide** when the content is read rather than watched (quotes with sources, dense tables, references), or when the narration for it is under ~12 s.
- **Use a registry block instead of hand-building** when a named effect already exists (charts, maps, counters, hand-drawn arrows). See the ideas bank below.
- **Use a cut scene** (`cutscenes.md`) for cinematic footage with no narration. A live slide is always narrated.

## What's in the template

`templates/hyperframes/` in this skill:

| Path | What it is |
|---|---|
| `live-slide/` | The blank starter. Copy it per slide. It's self-contained: `index.html`, `beats.json`, generated `beats.js`, and `assets/` (`flpt-tween.js`, FLPT's own seekable subset of GSAP's timeline<!-- FLPT_GSAP_FREE_V1 -->, `live-slide.js` engine, local woff2 files with their OFL licences: Source Serif 4 400, 400 italic, 600 and 600 italic; IBM Plex Sans 400, 400 italic, 500, 600 and 600 italic; IBM Plex Mono 400, 500 and 600). |
| `examples/possible-worlds/` | Worked 30 s example: actual world → ring of feasible worlds → remote worlds → Tactic / Strategy / "No-regrets move = □ every feasible world". Copy it when your slide is a diagram. |
| `examples/whiteboard-sketch/` | The whiteboard sketch ("avocado toast") starter: board, marker pen, Caveat, `hand.js`, a doodle kit sheet and a `README.md` on authoring doodles. Its engine (1.1) adds stroke-by-stroke pen drawing, pen colour per stroke, pen-written labels and pen glides; everything else matches `live-slide/`. `--from whiteboard-sketch`. |
| `render.mjs` | Scaffold (`--new`), sync (`--sync`), and render + verify (`--out`). |
| `align-beats.mjs` | Sets beat times from word timestamps (`cue` phrases). |
| `real-words.py` | Free word timestamps aligned to the real voice: a dynamic program maps voiced spans to clauses, scored on speaking rate and pauses on punctuation. The default aligner, built for `elevenlabs_v3` (long pauses, laughs). It prints a span map to check. |
| `pseudo-words.py` | Free word timestamps from a narration WAV and its text (silence detection plus punctuation anchoring). Fine for steady voices; it drifted up to 3.6 s on expressive ones (`retime.py --aligner pseudo`). |
| `retime.py` | Re-times and re-renders every slide against the real narration in one command (`real-words.py` by default). |

`index.html` has three blocks. **1 TOKENS** holds every colour, font and size as CSS variables: ink `#17202B`, paper `#F5F2EA`, oxblood `#8E2C48`, blue `#1F5A85`, amber `#8A5310`, plus soft tints, `--dim`, and the bubble geometry. **2 FRAME + ENGINE HOOKS** stays as is. **3 SCENE** is yours. To restyle one slide without editing CSS, put overrides in `beats.json` → `"tokens": {"--ox": "#…"}`.

## Build one, step by step

Paths assume the project layout from SKILL.md. `$T` is `<this skill>/templates/hyperframes`.

1. **Scaffold** next to the deck:
   ```bash
   node $T/render.mjs --new presentation/hyperframes/slide_07                      # blank
   node $T/render.mjs --new presentation/hyperframes/slide_07 --from possible-worlds  # start from the example
   ```
2. **Author the scene** in block 3 of `index.html`. Keep the eyebrow and serif title (`data-nodim` keeps them bright during a spotlight). Give every element a beat will touch an `id` (or a shared class). For diagrams, use one full-frame `<svg class="stage" viewBox="0 0 1920 1080">`, where SVG units equal video pixels.
3. **Keep the bubble corner empty.** The presenter bubble sits bottom-left at x 48–348, y 732–1032, plus its ring and shadow. Treat **x 0–380, y 700–1080** as empty. Also keep labels at least 64 px from every edge.
4. **Set the duration** to the slide's on-screen time:
   - After any pipeline run (a free `--draft` run is enough to get the layout, but its `say` voice has different timing), read `presentation/video/output/*.timeline.json` → `slides[n].duration` for the real voice.
   - Or take the length of the slide's narration audio, plus the pipeline's tail pause.

   A shorter clip is padded with its frozen last frame, so erring short is safe. A longer clip is cut at the end of the slide, so an animation that runs long loses its payoff. Set it with `node $T/render.mjs <dir> --duration 27.4 --sync`, or edit `"duration"` in `beats.json`.
5. **Write the beats** in `beats.json`, one per line (schema below). Time each beat 0.15–0.25 s **before** the word it illustrates. Finish all motion by `duration − hold` (the default hold is 1–1.5 s). That makes the last frame still, which is what makes freeze-padding invisible.
6. **Align to the voice** once real narration exists. You need word timestamps for that slide's audio:
   - **Free, local:** `npx hyperframes transcribe <slide-audio> --json` writes word-level `transcript.json`. It needs whisper-cpp (`brew install whisper-cpp`, plus a one-time model download), so ask the user before installing.
   - **ElevenLabs voice:** the text-to-speech "with timestamps" response (character alignment) works as-is. Only use it if that call is already being paid for.
   - **Neither (the default, free):** `python3 $T/pseudo-words.py <slide.wav> <text> --out words.json`. It spreads the words over the voiced stretches that ffmpeg `silencedetect` finds, and it anchors the pauses to the script's punctuation with a small DTW alignment. On the Latham v2 voice, all 19 of 19 pauses on slide 1 anchored, and the timings came out within a few tenths of a second. The user doesn't need whisper for this.
   - **One command for the whole deck:** after the final (or `--no-avatar`) run, `python3 $T/retime.py presentation` does pseudo-words, align-beats (with the right lead), duration from the timeline, and a re-render for every `hyperframes/slide_NN`. Then re-run `--final`: avatar clips are cached, so only compositing is redone.
   - Before the real audio exists, set the first `t` values with the voice's measured rate. The locked HeyGen voice runs at about 14.5–16 characters/s including pauses.

   Then run:
   ```bash
   node $T/align-beats.mjs presentation/hyperframes/slide_07 --words transcript.json [--offset 0.5] [--set-duration] --dry-run
   node $T/align-beats.mjs presentation/hyperframes/slide_07 --words transcript.json [--offset 0.5] [--set-duration]
   ```
   Beats with a `cue` snap to their phrase, and beats that use `after` move with the beat before them. Use `--offset` when the slide's picture starts before its voice. At the time of writing the pipeline adds a 0.5 s lead before the first slide and before the slide after a cut scene (`FIRST_LEAD_S` / `CUT_LEAD_S` in `generate_presentation_video.py`; check the current values). Slides also crossfade for 0.3 s, so put nothing important in the first 0.3 s.
7. **Preview** (optional): `node $T/render.mjs <dir> --sync`, then `npx hyperframes preview` in the slide folder. Studio scrubs the real timeline.
8. **Render and check:**
   ```bash
   node $T/render.mjs presentation/hyperframes/slide_07 \
     --out presentation/media/slide_07.mp4 --check-frames presentation/hyperframes/slide_07/check
   ```
   This regenerates `beats.js`, stamps `data-duration`, renders with `--strict` (lint errors fail it), and verifies 1920×1080, 30/1 fps and the exact frame count with ffprobe. It also writes 4 PNGs (20 %, 45 %, 70 % and the last frame) and runs a **hold test** (PSNR between `duration − hold` and the last frame; ≥ 45 dB passes). **Open the PNGs with Read** and look for overlaps, clipped labels, anything in the bubble corner, and wrong final state. For a layout check, add `--guides` (it shows the safe area and bubble keep-out; never deliver that render) or `--check` (HyperFrames' layout, contrast and runtime audit). Measured on this Mac: a 30 s slide renders in about 7–8 s at `--quality delivery` (default) and is about 1.8 MB.

The render uses `npx hyperframes@0.8.80` (change it with `--hf <version>`) with telemetry off (`DO_NOT_TRACK=1`, `HYPERFRAMES_NO_TELEMETRY=1`). Everything it needs is local. Don't add Google Fonts `<link>`s or named fallback fonts like Georgia/Arial, because the compiler fetches substitutes for those from the web.

## Handing it to the video pipeline

- **Output path:** `presentation/media/slide_NN.mp4`, with `NN` = the two-digit slide number, the same numbering as `presentation/slides/slide_NN.png`. Keep the source in `presentation/hyperframes/slide_NN/` so the slide can be re-timed and re-rendered later.
- **What the clip guarantees:** silent (no audio stream), exactly 1920×1080 at 30 fps (so a `cover` fit is a no-op), a still last frame (so freeze-padding is invisible), and the bubble corner kept empty.
- **Mapping:** the pipeline decides which slide plays which clip through its mapping file (currently `presentation/media.json`). **The pipeline work owns that format.** Read `scripts/video/SETUP.md` → "Video slides and cut scenes" for the current keys rather than copying them from here. The slide still needs its place in the deck. Its PNG is only the poster, so make the deck slide resemble the final frame.
- **Re-timing after a script edit:** re-run `align-beats.mjs` against the new audio, re-render to the same path, then re-run the pipeline for that slide.

## beats.json

```json
{ "slide": "possible-worlds", "duration": 30, "fps": 30, "hold": 1.5, "lead": 0.2,
  "tokens": {}, "guides": false, "narration": "…full text, for reference…",
  "beats": [
    { "t": 2.0, "cue": "the actual world", "target": "actual", "anim": "pop" },
    { "after": 0.35, "target": "actual-label" },
    { "t": 5.0, "cue": "a ring of feasible worlds", "target": "spokes", "anim": "draw", "drawStagger": 0.06 },
    { "after": 0.3, "target": ".node", "anim": "pop", "stagger": 0.07 },
    { "t": 18.4, "target": "strategy-arc", "anim": "draw", "dur": 1.4, "pen": true },
    { "after": 0.6, "target": ["n1","n2"], "do": "to", "to": {"fill": "var(--ox-soft)", "stroke": "var(--ox)"} },
    { "t": 25.0, "target": ["feasible", "center"], "do": "focus" }
  ] }
```

| Field | Meaning |
|---|---|
| `t` / `after` | Seconds from the start of the slide, or seconds after the previous beat. |
| `target` | An id (`"actual"`), a CSS selector (`".node"`, `"#remote circle"`), or a list of them. |
| `do` | `in` (default), `out`, `focus` (targets full strength, everything else already shown goes to `--dim`), `unfocus` (no target needed), `dim`, `pulse`, `count` (numbers: `data-from`/`data-to`/`data-decimals`/`data-prefix`/`data-suffix` on the element, or `value`), and `to` (GSAP-style vars inside flpt-tween's subset: CSS properties, `--custom` properties, 2D transforms, `attr`; `var(--token)` is resolved; anything else stops the render with a `✗ … FlptTweenUnsupported` line that names it). |
| `anim` | For `in`: `rise` (default), `fade`, `pop`, `draw` (SVG stroke draws on), `wipe` (clip reveal left to right), `grow` (scaleX from `data-origin`), `words` (word-by-word). An element can set its default with `data-anim`. |
| `dur`, `ease`, `stagger`, `drawStagger`, `level` | Overrides. `level` is the dim opacity for `focus`/`dim`. |
| `pen` | `draw` on one SVG shape: a pen nib rides the drawing tip (the whiteboard look). |
| `cue`, `say` | The narration phrase `align-beats.mjs` matches, and a free-text note. |

**Engine rules** (they cost a render each to learn):
- Don't set CSS `opacity` on anything a beat targets. The engine owns it through `--in` × `--lit`. Use `fill-opacity`/`stroke-opacity`, or a wrapper.
- Don't put CSS `transform` on an element that rises, pops or grows. Position it with `left`/`top` or SVG coordinates.
- `draw` needs **one continuous subpath** per shape, because SVG restarts dashes at every `M`. Draw an arrow as `M a L tip L barb1 L tip L barb2`. To draw a dashed or dotted line, draw a solid stroke inside a `<mask>` (see `boundary-reveal` in the example).
- The diagram accumulates: once something is on screen it stays and gets dimmed, rather than disappearing. Use `focus` to say "look here", and `unfocus` before the next build.
- `render.mjs` warns when motion runs into the hold, or when a beat's id doesn't exist in `index.html`. Read the warnings.

## Skills to load

Official HyperFrames skills (installed in `~/.claude/skills/`):
- **`hyperframes-core`**: the composition contract (root `data-*`, one paused timeline, determinism, fonts). Read it before changing blocks 1–2 or the root.
- **`hyperframes-animation`**: `rules/svg-path-draw.md`, `rules/counting-dynamic-scale.md`, `blueprints/constellation-hub.md`, `blueprints/dataviz-countup.md`, and `rules-index.md` for anything new.
- **`hyperframes-cli`**: lint / check / preview / render / transcribe flags.
- **`hyperframes-registry`**: search before hand-building a named effect: `npx hyperframes catalog --query "<the move, in English>"`, then `npx hyperframes add <name>`. Adapt the block's colours and fonts to the tokens.
- **`hyperframes-creative`**: `references/beat-direction.md` and `narration.md` for pacing a build to speech.
- **`hyperframes-keyframes`**: only for camera moves (push-ins, pans across a big diagram).
- **Not needed:** the `/hyperframes` router's intent interview and the creation workflows (`general-video` and friends), because this template already fixes the brief. `media-use` only for sourcing an icon or image, and its paid generators need the user's yes with a number.

From the student kit (`~/Projects/hyperframes-student-kit`, skills symlinked into `~/.claude/skills/`):
- **`video-storytelling`**: the most useful companion. It covers one persistent world that never resets, a spotlight on exactly one thing, ~20 words on screen per scene, entering 0.15–0.25 s ahead of the word, no label within 60 px of the edge, and checking motion on contiguous frames, not just beat frames.
- **`hyperframes-video-beats`**: copy rules (readable at a glance, one mental model per card) and pacing.
- **`style-library`** + `style-library/registry.json`: 406 draft cards (Vox-explainer and Kallaway styles; tier-1 stat / overview / section takeovers, tier-2 labels). Mine them for layouts and re-token them to the deck palette. They load GSAP and Google Fonts from CDNs, so localize before rendering.
- `MOTION_PHILOSOPHY.md` for motion vocabulary. Its fast sizzle pacing is wrong for a talk.
- Not for slides: `edit-video`, `cut-silences`, `cut-mistakes`, `short-form-*`, `motion-showreel`. They work on recorded footage and reels.

## Ideas bank

Each idea lists how to build it in this template, plus registry blocks to reuse or borrow from.

1. **Build-up list.** Three to five points arrive as they're said. The one being discussed stays lit and the rest dim to context. Use `rise` per item plus `focus`. Registry: `mk-specs-list`, `marker-checklist-card`.
2. **Number that lands.** A stat counts up, holds, then a short caption explains it. Use `count` (tabular numerals) plus `fade` on the caption, and `pulse` once at most. Registry: `count-up`, `mk-progress-stat`, `number-wheel`, `conic-progress-ring`.
3. **Timeline.** An axis draws left to right and events pop on as the story reaches them, with the "now" marker last. Use `draw` + `pen` on the axis, `pop` on the dots, and `rise` on the labels (the starter slide is a mini version). Registry: `beat-timeline`, `state-chip-rail`.
4. **Process flow.** Boxes and connectors draw in sequence, and a token travels along the path at the step being explained. Use `draw` for connectors, `rise` for boxes, and `to` to move or recolour the active step. Registry: `hw-pipeline`, `flowchart`, `decision-tree`.
5. **Hub and ring (the example).** A centre concept, options around it, and a boundary for what's feasible, then highlight a subset. Use `pop` + `draw` + `focus`. Registry: `constellation-hub`, `locked-nucleus-orbit`.
6. **Before / after wipe.** Two states of the same picture, with a divider sweeping across on "but now…". Use two layers with `wipe` on the top one. Registry: `before-after-wipe`, `comparison-split`.
7. **Map.** The region fills as places are named, and arrows show flows (for example "where the GPUs sit"). Registry: `us-map`, `world-map`, `us-map-flow`, `us-map-bubble`. Re-token the fills to the palette and check the projection.
8. **Chart that builds.** Axes, then bars or a line in reading order, then the one annotated value. It uses real data, scaled correctly, with the source on the slide. Registry: `chart-story`, `data-chart`, `mk-line-graph`, `animated-bar-chart`.
9. **2×2 or comparison matrix.** The axes draw, the quadrant labels rise, then items drop into cells one by one, and the winning cell gets a focus. Use `draw`, `rise`, `pop` and `focus`.
10. **Annotated quote or document.** The quote types in word by word, then a marker underlines or circles the phrase that matters. Use `words`, plus `draw` + `pen` on an underline path. Registry: `marker-highlight`, `vox-annotate`, `hw-underline`, `hw-callout-circle`, `inline-highlight`.
11. **Whiteboard sketch** (closest to the reference). A simple doodle draws itself stroke by stroke while the idea is explained. Use `draw` + `pen` on hand-authored single-subpath SVG. Registry: `whiteboard-ink`, `hw-arrow`, `hw-box-label`, `hw-boil` (hand-drawn jitter; keep it off by the final hold).

## Quality checklist

- [ ] Nothing important in x 0–380, y 700–1080. Labels are ≥ 64 px from the edges (`--guides` render).
- [ ] Each beat enters just before its words, and nothing appears before it's mentioned.
- [ ] One focal element at a time, and dimmed context is still readable (`--dim` 0.4).
- [ ] At most ~20 words on screen, with the title and labels in the deck's voice.
- [ ] Motion ends ≥ `hold` seconds before the end, and the hold test passes.
- [ ] The final frame reads as a complete slide on its own. It's also the poster, and what shows if the pipeline pads.
- [ ] `render.mjs` exits 0, and the 4 check frames were opened and looked at.

## Recipes the animators found (Games & GTM run, 2026-09-29)
- **Upright bars:** `do:"to"` with `{"attr":{"y":…,"height":…}}` starting from height 0. The engine's `grow` only stretches horizontally.
- **Value labels that ride their bar:** wrap the label in a div with a CSS translate as its start offset. Then `do:"to"` `{x:0}`/`{y:0}` with the bar's duration and ease, plus a `count` of the same duration.
- **Hatched (n.s.) bars:** reveal them by tweening the width of a clip rect, so the hatching never stretches.
- **Soft layers (fog, veils):** HTML wrapper divs with their start transform and opacity set in CSS, then `do:"to"` on the wrappers.
- **An element only ever targeted by `do:"out"`** needs `class="lv"`, or it never fades.
- **Dimming a whole group:** use `to` on `--lit` rather than per-element `focus`. Per-element dimming made chips see-through, so lines showed through them.
- **Glyphs:** the local Source Serif subset has no "→". Draw an SVG wedge (or use the sans arrow). IBM Plex Mono 600 and the 600 italics ship in the template since 2026-10-06; any other weight needs a local fontsource file (OFL), or it's synthesized.
- **The whiteboard engine (1.1)** in `examples/whiteboard-sketch/` is a backward-compatible superset: a stroke-by-stroke pen on groups, a coloured pen, written labels and pen glides. The slide 3 animator used it for a regular slide too. Consider promoting it into `live-slide/`.
- **The finale beat on the last words of a slide** often lands in the hold after re-timing. Keep finales short (≤ 1.3 s in total) or cue them one phrase earlier.

## Recipes from *The Shadow of the Future* (2026-10-06)
- **Build against the real audio.** Start the paid narration run before the animators. Then each animator:
  1. Finds the slide's WAV, the newest `video/cache/audio/<engine>/*.wav` whose `.json` says `"item": "slide N"` (the same file `retime.py` uses).
  2. Runs `python3 $T/real-words.py <slide WAV> narration.txt words.json`.
  3. Runs `node $T/align-beats.mjs <slide dir> --words words.json --offset <lead>`.
  4. Sets the duration from the timeline, minus one frame.
- **`retime.py` stretches** any beat that starts by 1 s and runs 8 s or more across the whole slide. For a Ken Burns that should cover only one phase, chain it with `after` instead.
- **Embedded video:** re-encode clips with `-g 30 -keyint_min 30`, or seeking freezes frames. Grain over video makes big renders (up to about 90 MB), which is fine for compositing.
- **Archival insets locked to a cue:** step a frame sequence from the beat timeline. A `<video>` takes its start from a static `data-start`, so it drifts when beats move.
- **Porting deck CSS:** scope it as `:where(#slide) :where(p)`. A plain `#slide p` outranks class styles, and it silently resized badges, rows and receipts.
- **Series devices need exact specs,** or animators diverge. The receipt lower-third prints with a stationary upward wipe: a stepped `clip-path: inset()` per block, about 0.5 s, with the shadow landing one frame later. The paper never slides.

## Cartoon slides (Cosmos-style), from 2026-10-06
A narrated slide can become a short painted documentary: limited 2D animation, the presenter hidden (`"bubble": false`) and the narration running on. Use one or two per video. The worked brief is `templates/hyperframes/examples/cartoon/BRIEF.md`.
- **Lock the look first.** Generate one style frame, get the user's approval, and pass its job id as `image_references` on every image, so every cartoon shares one look. Start every prompt with the style block from that brief.
- **Per cartoon:**
  - 4–6 Nano Banana Pro keyframes, one per beat, each with a verbatim narration cue
  - a character reference for anyone in two or more beats
  - cut-out layers on 2–3 beats (`remove_background` or `image_decompose`)
  - one 5 s Seedance 2.5 hero shot (`omni_reference`, about 60 credits)

  Budget about 70–100 credits per cartoon. Historical people are clearly stylized, never look-alikes.
- **The grammar in HyperFrames:**
  - a slow push or pan on each keyframe (scale 1.0 → 1.08)
  - parallax layers moving at different rates
  - tiny puppet moves: a 1–3° head tilt, or a blink by swapping frames
  - particles where they fit
  - an ink-wipe between beats (one hand-painted mask, 0.6–0.8 s)
  - a tiled grain overlay with a slow jitter, and a vignette
  - a small `CARTOON · TITLE` label that fades out by 3 s
- **Real public-domain art can sit inside a cartoon** (a projected film, a painting in a frame, a document page), credited small.
- **Text the story needs** (like SPLIT and STEAL on the golden balls) goes in HTML overlays in the deck's fonts, never in the generated art.
- **Keep faces out of the bottom-left 380×380** anyway, because the bubble fades back in on the next slide.
- **Check every keyframe's corners at full size.** Background plates from a cut-out or `image_decompose` can carry hard-edged black blocks where the figure was. A shade drawn *over* the figure only half-hides them. Put a feathered radial shade *under* the figure layer instead (opaque to about 80% of its radius), so the blocks read as foreground shadow and the figure stays lit (*Shadow of the Future*, Talk 1, slide 11).

## Recipes from *Cut 'Em Up* (2026-10-07)
- **One whiteboard across several slides:**
  - Give every board slide to one animator.
  - Start each slide on the previous slide's exact last frame (seams matched at 48–56 dB), so the pipeline's 0.3 s crossfades vanish.
  - Move the camera between quadrants: push in, pull back, warp.
  - Generate every doodle from the deck's own drawing code with the same seeds, so final frames match the PNGs.
- **Cartoon hero shots:**
  - Draft at 480p first (15 credits) to check the motion, then finalize at 1080p (60).
  - When editing one plate into variants, lock the sky colour in the prompt, or it drifts.
  - Never ask for a "dark, empty corner": the model paints a black box. Use a feathered shade under the figure instead.
- **Real art held inside a cartoon:** paint the hands holding a green card and key the real print in behind them. Check for leftover green pixels.
- **CJK glyphs** (e.g. 围棋) render with the Mac's own PingFang. No OFL CJK font ships with the template, so a render on another machine substitutes a different face.
- **Typing big words:** one-frame letter reveals read best. Plex Mono italic needs `font-synthesis: none` to match the deck.

## Recipes from *A Modest Proposal* (Part 5 re-cut, 2026-10-12)
- **Whiteboard seams at ~59 dB.** Build the seam replica of the previous slide's last frame with the same markup as the live slide, down to one span per typed character. Close is not enough: a different text structure re-flows the antialiasing.
- **Wait for fonts before building the timeline** on whiteboard slides (`await document.fonts.load(...)`), so pen write-ons follow the real glyph outlines.
- **Retire masked layers** (fade them to 0) once their wipe ends, so HyperFrames' layout audit doesn't report them as overlapping.
- **Mixed looks in one run:** slides 20 and 21 were whiteboards, and 19 and 22 kept the deck's serif-and-cards look on the same paper ground. Seams still matched, because each slide opens on its neighbour's last frame.
- **On-screen text follows its own words.** A line card quoting the narration goes in on those words, not on a later keyword. Our spec cued one card 14 s late, and it read as a non sequitur.
- **No long dead holds under a lead-in.** When a slide holds still for 15 s or more under narration that leads into a cut scene, give it one slow beat on a cue word that leads into the scene. For example, the lights dim to about 55 % on "deep in the mines" before Gandalf in Moria.
- **A still stirred, not static.** To animate one element of a generated still, paint it out with ffmpeg, cut it out as its own layer, and sway it a degree or two about a natural pivot. Check at 100 % for a smooth strip where it was painted out.
- **Footage under a split screen:** a 640×360 archival clip at about 0.72× speed reads as silent-film pace and fills a 22 s slot. End on the deck still's exact frame so the hold matches the PNG.

## Recipes from *The Response* (2026-10-13)
- **Beats that return to rest.** When a slide sits still too long, add motion that ends where it began: a tag sinks 6 px and settles, a card lifts 10 px with a deeper shadow and settles. The last frame still matches the deck PNG, so nothing downstream needs rebuilding.
- **Don't use a staggered `do:"out"` on things that enter one by one** (per-character carets). GSAP nests a staggered tween in a timeline that renders before later "in" tweens on the same frame, so they stay stuck visible. Hide them through a CSS variable (`--lit`) instead.
- **Seek-safe custom motion** (planets riding their orbits): recompute every frame from `tl.time()` in the timeline's `onUpdate`, with fx beats carrying the cues. Never run a free `requestAnimationFrame` loop.
- **A negative `after`** starts a beat before its cue word while keeping it chained to the cue.
- **Judge the hold test at delivery quality.** Draft renders can fail it on encoder noise alone (42.9 dB on one slide that passed at delivery).
- **The local Source Serif has no → glyph,** so the browser falls back to Times' thinner arrow. Where a frame must match the deck PNG, draw the deck's arrow over the glyph or use an SVG arrow.
- **"Lights go down" on a print:** use a darkened copy for about 0.6 s, with the words untouched. A semi-transparent dark overlay does the same without a new file.
