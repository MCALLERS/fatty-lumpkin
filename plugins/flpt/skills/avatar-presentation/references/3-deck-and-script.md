# Stage 3: Deck and script

Write the script first. The deck's speaker notes and the video narration are both generated from `presentation/script.md`, so the two can't drift apart.

## Script: `presentation/script.md`

```
## SLIDE 1 — Why would a law firm buy GPUs?

> Stage direction for presenting live (never spoken).

Narration paragraph…
```

- **One heading per slide, numbered 1..N** to match the deck order. Narration runs until the next heading, and lines starting with `>` aren't spoken.
- **Budget about 150 words a minute.** 2,500 words is roughly 17 minutes. Check per-slide counts with a quick split on `^## SLIDE`.
- **Write for the ear.**
  - First person, in the user's voice, using their own anecdotes and never invented ones.
  - Short sentences, numbers phrased the way they're said, and no citations out loud (sources go on the slides).
- **Only verified facts.** Paraphrase long quotes, and keep quoted fragments exact.

## Deck: a Slides artifact

1. Run `Artifact` `action: "quickstart"` with `intent: "slides"`. Then create the deck with the returned `type_url`, a `title`, and `auto_open: "after_first_write"`. Follow the type's instructions: they're authoritative for the file format.
2. Upload the deck's images as assets in one call (`asset: true`, `file_paths`), and record the returned `/_blob/<id>` urls.
3. Copy `scripts/deck/build_deck_example.py` to `presentation/deck/build_deck.py` and adapt it.
   - Keep the helpers and palette; replace `BLOBS`, the slides, `ORDER`, `SECTIONS` and `FACES`.
   - Running it writes `project/deck.json`, one `project/slides/<id>.html` per slide, and `asset_map.json` (blob → local file, used by the renderer).
   - It also injects each slide's narration from the script as its `<aside>` speaker notes.
4. Publish in one call: `url`, `root` = `presentation/deck`, `file_path` = `…/project/deck.json`, and `files` mapping every `project/slides/*.html`.
5. **When revising:** read the changed slide files from the artifact first (someone may have edited them live). Then publish only those files, and send `deck.json` only if the order, title or sections changed.

### Design rules that matter for the video

- **Presenter-bubble safe zone.** The signature bubble sits at the **bottom left**: about 300 px at a 48 px margin, so roughly x 48–348 and y 732–1032 on the 1920×1080 canvas. Keep content out of x < 380 whenever it extends below y ≈ 720.
  - Pin footers and source lines to `left:420px` rather than `left:128px`, or keep bottom rows right-aligned.
  - If the presenter profile sets `BUBBLE_POSITION` elsewhere, mirror the zone to match.
- **Legibility at 720p.** Text must be at least 24px; prefer 28–32px for body text. Scale: 120 / 96 / 72 / 44 / 32 / 28 / 24.
- **Avoid `x-shape`, `x-icon` and `x-connector`.** The local renderer can't draw them. Use painted divs, and SVG with `<p>` labels pinned over it (SVG `<text>` doesn't get the fonts).
- **One idea per slide,** in a consistent eyebrow-plus-title block. Mix in dark statement slides and one accent slide. Tint neutrals toward the palette.

## Render and check

```bash
python3 presentation/video/render_slides.py        # → presentation/slides/slide_NN.png (skips unchanged)
ffmpeg -i presentation/slides/slide_%02d.png -vf "scale=640:360,tile=3x7:padding=8:color=white" -frames:v 1 sheet.png
```

Look at the contact sheet once. Fix any overflow, empty space or bubble-zone collisions, rebuild, then re-publish only the slides that changed. The Slides type says not to verify its rendering. The local render is for the video, and it's also a fair proxy check.
