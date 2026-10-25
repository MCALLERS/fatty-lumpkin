---
name: avatar-presentation
description: The user's signature workflow for making an "avatar presentation", a Loom-style video in which their own HeyGen AI avatar presents a slide deck they built together. It covers intake, shaping ideas into bullets, a full deck pass then slide-by-slide iteration with the signature elements (motion graphics, photo-plus-motion, a chart, an infographic, a live HyperFrames animation, a hand-drawn whiteboard sketch in the "avocado toast" style, and 1–2 cinematic Higgsfield/Seedance cut scenes), an off-the-cuff script with speech tags, filming with the user's locked presenter profile, and the final MP4 and player page. Trigger on "let's make an avatar presentation", "avatar video", "make a presentation video", "have my avatar present…", "Loom-style video of my deck", and on any stage of this work (bullets, deck, script, cut scene, animation slide, filming, re-rendering a slide), even when only one stage is asked for.
---

# Avatar Presentation

This is the user's signature format: a deck that shows off (motion graphics, photos in motion, a real chart, an infographic, a live HyperFrames animation, a hand-drawn whiteboard sketch, 1–2 cinematic cut scenes), presented by their own HeyGen avatar in a bottom-left bubble, in a voice that sounds like them riffing live. Every video repeats the same signature elements, so over time the style becomes recognizably theirs.

**Start here in a new project:** the `video-studio-handbook` skill (2026-10-15), if you have it. It covers the user's standing rules and taste, the crew model, the newest recipes, benchmarks and the back catalogue with links.

**The whole method on one page:** `references/playbook.md` (added 2026-10-12). It has the core principles, the workstreams, the episode wrapper, delivery and costs.

**How to work:**
- **Iterate.** Take a full pass first, then refine with the user, one stage at a time.
- **Ask, don't assume.** If you have a grill-me skill (`~/.claude/skills/grill-me/SKILL.md`), read it and follow it, because it only runs when the user types `/grill-me`. Ask short, pointed questions until the picture is clear, each with a recommended answer, and use multiple choice (AskUserQuestion) when the options are known.
- **Remind.** At each stage, check the signature checklist and raise anything missing.
- **Learn.** When a session teaches something reusable, add it to `references/lessons.md` and adjust this skill.

## The flow

| # | Step | You produce | User does | Read |
|---|---|---|---|---|
| 1 | **Kickoff:** "let's make an avatar presentation" | project folder + `presentation/` (`scripts/scaffold.py`) | — | — |
| 2 | **Intake** | brief (topic, length, audience, purpose, tone, what they bring) | answers the gaps | this file → Intake |
| 3 | **Shape** | bullets per slide: what they'd present from live; research if needed | edits until "locked" | `references/1-research.md`, `references/2-framework.md` |
| 4 | **Deck, full pass** | a complete Slides artifact with a signature element planned per slide | reacts | `references/3-deck-and-script.md`, `references/signature-style.md` |
| 5 | **Deck, slide by slide** | suggestions first, then builds: HyperFrames slides, charts, infographics, photos, cut scenes | chooses and approves spend | `references/hyperframes-slides.md`, `references/cutscenes.md` |
| 6 | **Script** | an off-the-cuff script from the bullets, with delivery tags | edits live | `unscripted` skill, `references/tts-tags.md` |
| 7 | **Film** | a sample slide (optional), the full render, MP4 + player page | approves the cost | `references/4-video.md`, `references/heygen-consistency.md` |
| 8 | **Retro** | new lessons in `references/lessons.md`, and skill tweaks | — | — |
| + | **Episode wrapper** (optional: series or "hero" videos, or when the user asks) | title card, cold open, bookends, stingers, B-roll payoffs, sign-off, a run-sheet; then the Slack pack from their final export | approves the plan and the spend | `references/wrapper-and-extras.md`, `references/delivery.md` |

### 2. Intake

Collect:
- the topic and the point, meaning what should change in the audience's head
- the length in minutes: about 150 words a minute, and about 45–60 seconds a slide
- the audience and setting
- the deadline
- the tone
- **what they're bringing:**
  - just an idea
  - bullets
  - stream-of-consciousness notes
  - a full script
  - assets (photos, video, PDF, HTML, links) to include or use as reference

Ask only about what's missing, one or two questions at a time. Save the brief to `presentation/brief.md`.

### 3. Shape into bullets

Bullets are the backbone. They're what the user would build a deck from and glance at while presenting. For each slide: a title, 2–5 bullets, and a one-line note on what it will show.
- **Only an idea:** find the through line first (`references/2-framework.md`), and research facts if needed (`references/1-research.md`).
- **Notes or a draft:** extract the bullets and keep the user's own words and stories.

Iterate until the user says the bullets are locked, then save them to `presentation/bullets.md`. The deck and script both come from this file.

### 4–5. Deck: full pass, then slide by slide

1. **Full pass.** Build every slide at once (the Slides artifact, `references/3-deck-and-script.md`). Put **a planned signature element on every slide where one fits**, and use placeholders for media that doesn't exist yet. Show the signature checklist below as a table of slide → element.
2. **Slide by slide.** For each slide, open with 1–3 concrete suggestions (e.g. "animate this as a HyperFrames build", "turn this stat into a bar chart", "cut scene after this slide: the negotiation room at 2 a.m."), then build what they pick. Propose the whiteboard-sketch slot early, with a 3–5 beat sketch plan.
3. **Cut scenes** are their own mini-workstream. Raise them early, since they take the longest. Run the question bank in `references/cutscenes.md`, write the Seedance prompts with the `cinema-director` skill, and quote the Higgsfield cost before generating.
4. **HyperFrames slides** follow `references/hyperframes-slides.md` (template, beats, render).
   - Animating most of the deck is the default: every slide builds as it's narrated.
   - Split the slides across about four parallel agents, 3–4 slides each. Give them one shared brief, copied from `templates/hyperframes/BRIEF.template.md`, and a scratch subfolder each.
   - Build on estimated durations. The real re-time happens after filming (step 7).

### Signature checklist (every video)

Track this on screen during steps 4–5 and again before filming:

- [ ] **Motion graphics.** At least one slide.
- [ ] **Photos in motion.** At least one slide: real photos with Ken Burns, parallax or reveals.
- [ ] **A useful chart.** At least one slide with real data, correctly scaled and sourced.
- [ ] **An infographic.** At least one slide.
- [ ] **A live HyperFrames animation.** At least one slide that builds on screen as the avatar talks.
- [ ] **A whiteboard sketch ("avocado toast").** At least one full-frame whiteboard takeover where hand-drawn doodles of concrete things draw themselves with a pen nib as the avatar names them (`references/hyperframes-slides.md` → The whiteboard sketch). Diagram builds in the deck style don't count. The user asked for this in every video after v2 had none.
- [ ] **Cut scenes.** 1–2 cinematic clips of about 20 seconds (Higgsfield + Seedance 2.5), with fade out → cut scene → fade in.
- [ ] **Signature constants.** The presenter profile (the same look, voice and bubble), the style tokens and the recurring touches in `references/signature-style.md`.

Quality bar: epic, show-off quality, but consistent from one video to the next. When something works especially well, promote it into `signature-style.md` so it repeats.

### 6. Script

Write the narration from the **bullets** using the `unscripted` skill: roughness 3/5 by default, the B+ riff, with the user's verbal signatures. Budget about 100–115 words per 35–40 s slide; the first draft of the Games talk ran short. It should sound like the avatar is thinking on the fly while looking at the slides.
- Use delivery tags from `references/tts-tags.md` (neutral tags like `[pause]`; the pipeline translates them per voice engine and never reads them aloud).
- Show the script, invite live edits to `presentation/script.md`, and point the user to the tag legend.
- Re-read the file before filming, because the user may have edited it.

### 7. Film

- **Presenter:** the look, voice, engine and bubble come from the presenter profile `~/.config/avatar-presentation/presenter.env`, and keys come from `keys.env`. Don't re-pick them unless the user asks. If there's no profile yet, build one with `heygen_picker.py` (`references/4-video.md`).
- **Order:**
  1. Run `--check` (free).
  2. Offer a one-slide sample if anything changed since the last video (voice, look or script style).
  3. Do the full run, with the cost stated and approved. At about 4 US cents per second of avatar video, an 11-minute talk costs about 25 US dollars (never write a dollar sign before a digit in SKILL.md: the skill loader treats it as an argument placeholder).
  4. **Start the paid run before the animations** (since 2026-10-06). Avatar clips don't depend on the visuals, and animators who build against the real audio skip the re-time pass.
     - Before the run, mark any slide that hides the presenter (`"bubble": false` in `media.json`, for a cartoon, say), so it isn't billed.
     - If a cut scene isn't finished yet, drop in a black placeholder of about the right length so `--final` can run. Then swap in the real file and re-composite for free.
- **Re-time, then re-composite (free):** once the real narration exists:
  1. For any slide built before the real audio existed, run `python3 <skill>/templates/hyperframes/retime.py presentation`. It aligns every beat with free word timings (`real-words.py`, built for expressive voices; no whisper needed), sets each duration from the timeline and re-renders.
  2. Map the clips in `media.json`.
  3. Run `--final` again. The run summary must say "0 characters, 0 clips" before you pass `--yes`.
  4. Run `--web`, then `player/build_player.py`, then publish.
- **Media:** video slides go in `presentation/media.json`. Cut scenes only need the `## CUTSCENE X` headings plus `media/cutscene_X.mp4` (see `references/4-video.md`). A music bed under cut scenes comes from the ElevenLabs Music API (`references/cutscenes.md`, `lessons.md`).
- **Deliver, every video, always all three:**
  1. `presentation/video/output/presentation.mp4`, the master for the web and player.
  2. **`presentation/video/output/presentation_for_editing.mov`, the CapCut-safe editing master.** It has no edit lists, PCM audio, constant 30 fps, and the voice nudged +20 ms to the lips. `--final` writes it automatically; `--edit-master` remakes it.
  3. The player page artifact.
  4. When the video has clip slots (copyrighted film or YouTube moments the user may drop in), a `CAPCUT_CLIP_GUIDE.md`. Per slot it gives the final timecodes, whether to keep or mute the clip's sound, and any inset rectangle (`references/4-video.md`).
  The user edits in CapCut (intros, effects), so point them to the `.mov`, not the `.mp4`. The `.mp4` drifts a frame or two in CapCut.
- **Extras and Slack (added 2026-10-12):**
  - **Levelled extras:** hand over any extra (bookends, stingers, B-roll, beds) levelled to the master with `scripts/video/loudmatch.py`: −14 LUFS and −1 dBTP; beds `--bed`.
  - **The Slack pack:** after the user's own final export, offer it with `scripts/video/slack_pack.py`. It makes the (vF), the 1.25x cut, the MP3 and the cover.
  - **Where the detail is:** `references/delivery.md`.

### 8. Retro

In 3–6 bullets, note what worked, what the user changed, and any new costs or timings. Append them to `references/lessons.md`. Update this skill, or `signature-style.md`, when a change should apply to every future video.

**If the user finished the video in CapCut,** read their edit first: `python3 <skill>/scripts/edit/capcut_study.py "<CapCut project folder>" --out <folder>`. It's read-only. It shows what they added before, inside and after the master, what they trimmed, and what they boosted by hand. Whatever they keep building by hand is the next thing to automate.

## Ground rules

- **Facts stay exact.** A rough delivery never means rough facts. Verify numbers and quotes, and flag shaky premises candidly.
- **Never guess identity assets.** Look, voice and recordings are the user's call, picked from a contact sheet or samples. Store IDs, not sheet numbers.
- **Keys never go in chat.** Use `set_keys.py` (hidden dialogs); keys live in `~/.config/avatar-presentation/keys.env`.
- **Every spend is explicit.** State the cost and wait for a yes for HeyGen renders, Higgsfield generations and TTS runs over a few dollars.
- **Copyright.** Link rather than copy paid sources.
  - Use licensed, public-domain or generated images and footage. Never download from YouTube; copyrighted clips become clip slots the user fills.
  - Disclose the AI presenter on the player page, plus any generated cartoons and the archival footage (`media_note` in `player_config.json`).
- **Long jobs run in the background,** with a one-line status. Launch `.command` files with `open`.

## Reference map

- `references/1-research.md`: research fan-out and resource cards
- `references/2-framework.md`: through line and arc
- `references/3-deck-and-script.md`: Slides artifact build and design rules (bubble safe zone at the **bottom-left**)
- `references/signature-style.md`: the user's recurring style (tokens, motifs, transitions)
- `references/hyperframes-slides.md`: the live-animation slide template
- `references/cutscenes.md`: cut-scene questions and production
- `references/tts-tags.md`: the delivery-tag legend per voice engine
- `references/voice-options.md`: HeyGen voice vs Gemini vs ElevenLabs
- `references/heygen-consistency.md`: locking the avatar's look and performance
- `references/4-video.md`: pipeline commands, `media.json`, costs and gotchas
- `references/lessons.md`: a running log of what each session taught
- `references/playbook.md`: the whole method on one page (principles → workstreams → wrapper → delivery → costs → checklists)
- `references/wrapper-and-extras.md`: the episode wrapper: title cards, cold opens, bookends, stingers, transitions, B-roll payoffs, flyers
- `references/delivery.md`: deliverables, loudness standard, the Slack pack, folders and credits
- `scripts/video/slack_pack.py`, `scripts/video/loudmatch.py`, `scripts/edit/capcut_study.py`: the Slack pack, levelling extras, studying the user's CapCut edit
