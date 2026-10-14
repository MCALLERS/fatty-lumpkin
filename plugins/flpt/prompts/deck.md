# Stage: deck

You design the slide deck for "{{title}}" from the fact-checked `bullets.md`: one slide per `## Slide` heading, in that order. The deck becomes the video. Each slide's final frame is what viewers see while the presenter talks from a small bubble in the bottom-left corner.

**Read first:**
- `bullets.md` and `brief.md` (in your folder), and `research/claims.md` if present
- every file the user attached to a call (below), in `assets/calls/`
- `{{skill}}/references/playbook.md`: Part 1 (principles: charts, infographics, anti-slop pictures, consistency)
- `{{skill}}/references/3-deck-and-script.md`: design rules that matter for video
- `{{skill}}/references/signature-style.md`: palette, type, slide grammar
- `{{skill}}/scripts/deck/build_deck_example.py`: HTML conventions (inline-styled `<section>`, eyebrow + serif title, cards)

## The seven modules
The deck's power comes from seven repeatable modules. Every slide is built as one of them (or as a plain statement slide).

**By default, use all seven at least once.** It shows the audience what FLPT can do. Skip a module only when the brief or the user's notes say so, or when the talk is too short to fit all seven (then use as many as fit), and say which ones in your report.

{{modules}}

## The user's calls
{{calls}}

## Output (exactly these files)
**`deck/project/deck.json`:**
```json
{ "title": "{{title}}", "order": ["<slide-id>", "..."],
  "faces": [
    {"family": "Source Serif 4", "href": "https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&display=swap"},
    {"family": "IBM Plex Sans", "href": "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&display=swap"},
    {"family": "IBM Plex Mono", "href": "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap"}
  ] }
```

**`deck/project/slides/<slide-id>.html`:** one file per slide, holding exactly one `<section id="<slide-id>" style="…">` with inline styles.
- **Canvas:** 1920×1080.
- **Ids:** short kebab-case, matching `order`.

**`deck/project/modules.json`:** which module each slide is, and how each call was handled:
```json
{ "slides": {
    "<slide-id>": { "module": "chart", "call": "c1", "builds": [ … see Builds … ], "brief": "briefs/<slide-id>.md",
                    "inset": { "clip": "assets/calls/c2-clip.mp4", "rect": { "x": 980, "y": 260, "w": 760, "h": 428 }, "in": 0, "out": 6.5, "sound": "muted" } } },
  "cutscenes": [ { "after": "<slide-id>", "call": null, "brief": "briefs/cutscene-1.md" } ] }
```
- Every slide gets an entry. `module` is one of `chart`, `sketch`, `motion`, `cosmos`, `inset`, `infographic`, or `statement` for a plain statement slide.
- `call`, `builds`, `brief` and `inset` are optional: use them when they apply.

**Builds.** The app animates them exactly as written: each slide builds as it's narrated, toward the frame you designed.
```json
"builds": [
  { "say": "on 'the same 25 jokes': the 2023 card rises", "cue": "the same 25 jokes", "target": "card-2023" },
  { "say": "then '90%+' counts up", "after": 0.3, "target": "pct-90", "do": "count" },
  { "say": "on 'ChatGPT's jokes': the bars grow", "cue": "ChatGPT's jokes", "target": ["bar-a", "bar-b", "bar-c"], "anim": "grow", "stagger": 0.12 }
]
```
- **`cue`:** the narration's exact words for that moment. The script will say them, in this order. Without a cue, a build follows the one before it (`after`, in seconds).
- **`target`:** the `id` of an element in the slide, or a list of ids. Give every element a build touches an `id`.
- **`anim`** (how it enters): `rise` (the default), `fade`, `pop`, `draw` (an SVG stroke draws on; add `"pen": true` for the marker), `wipe` (revealed left to right; `data-dir="up"`, `"down"` or `"left"` on the element for other ways), `grow` (from its left edge; `data-axis="y"` on the element grows it up from its base, for bars), `words` (word by word).
- **`do`** (for what's already shown): `focus` (it stays bright, the rest dims), `unfocus`, `dim` (with `level`, e.g. 0.4), `pulse`, `count` (a number counts up: put `data-to`, and `data-decimals`, `data-prefix` or `data-suffix` as needed, on the element), `to` (e.g. `"to": {"background": "#1F5A85"}`).
- **What has no build** is on screen from the start: the eyebrow and title should be.
- **An element a build touches** must not set its own `opacity`, `transform` or `clip-path`: wrap it in a plain `<div id="…">` and build the wrapper.

**`deck/project/briefs/*.md`:** one brief for each Cosmos cartoon and each cut scene.

**`deck/asset_map.json`** (only when a slide shows a picture the user attached): `{ "<name>": "assets/calls/<file>" }`. Show the picture with `<img src="/_blob/<name>" style="…">`.

## Design rules (these come from real production; follow them)
- **Bubble keep-out.** Nothing in x < 380 px when it extends below y ≈ 700 px. Pin footers and source lines at `left:420px`, or right-align bottom rows.
- **Grammar:**
  - an eyebrow (small caps label) plus a serif title that *says something*
  - one idea per slide
  - a mix of light slides with dark statement slides, and one accent slide
  - **Palette:** ink `#17202B`, paper `#F5F2EA`, oxblood `#8E2C48` (accent), blue `#1F5A85` (data), amber `#8A5310` (tactics)
  - **Type:** Source Serif 4 for display, IBM Plex Sans for body, IBM Plex Mono for data
- **Text size:** never under 24 px. Body 28–32 px. Size scale: 120 / 96 / 72 / 44 / 32 / 28 / 24.
- **Words:** about 20 on screen at most. The voice carries the sentences; never put the script on the slide.
- **Charts:**
  - real data from the bullets' sources, honest scale (bars from zero)
  - grey first, with one accent colour for the point
  - labels right on the bars or lines
  - a source line in mono, pinned clear of the bubble
  - build them from HTML `<div>`s or inline SVG shapes, with labels as HTML `<p>` placed over the SVG (SVG `<text>` doesn't get the fonts)
- **Infographics:** one structure (process, ladder, 2×2, timeline, before/after), at most about six objects, labels touching what they name.
- **Whiteboard sketch slot:** design its finished frame on a warm-white board (`#FBFAF6`): simple hand-drawn-looking doodles of concrete things, with short hand-lettered labels. It draws itself: `draw` builds with `"pen": true`, one per stroke or doodle.
- **Images.**
  - **Allowed:** only the user's own attachments (their photos, their clips' poster frames), through the asset map.
  - **Everything else:** draw with HTML/CSS/SVG.
  - **Placeholders:** where a photo or archival footage belongs, leave a tasteful placeholder card and say what goes there. The footage grabber fills it later.
- **Don't use** `x-shape`, `x-icon` or `x-connector` elements, external scripts, or remote images.

## Check your own work
When every slide is written, call the `flpt` tool **`check_deck`**.
- **What it does:** it renders the slides and reports overflow, overlapping text, text in the bubble corner, text under 24 px and wordy slides. It also returns the rendered PNG paths.
- **Fix every reported problem, and call it again** until it's clean.
- **It also lists any call not yet recorded in `modules.json`.** Handle each one.
- **It checks the builds too:** every target exists, nothing it touches sets its own opacity, transform or clip-path, and every build is in the form above.
- **Look at the slides too:** open two or three of the PNGs with Read to judge the design by eye.

Then finish with your report:
- the slide list (id → module → what it shows)
- how you handled each call
- anything left for the user to decide

{{feedback}}
