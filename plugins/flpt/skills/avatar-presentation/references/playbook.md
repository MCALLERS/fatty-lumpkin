# The Loom-style video playbook

Written 2026-10-12 from five videos and the four-episode series *The Shadow of the Future*, including Michael's own CapCut finals.

**What we make.** A narrated slide talk, presented by the author's AI avatar in a small bubble in the bottom-left corner:
- every slide alive
- real charts, infographics and a hand-drawn whiteboard sketch
- a painted cartoon, a cinematic cut scene or two, and real archival footage
- a voice that sounds like a person thinking

Then, for a series, it gets wrapped as an *episode*: a title card, a cold open, bookend scenes, stingers and a sign-off.

The bar is **"shock and awe", consistent from one episode to the next.**

**How to use this file:**
- **New to the format?** Read Part 1 (the principles) and the checklists in Part 7.
- **Making a video?** Follow Part 2 stage by stage. Each stage names the reference with the detail.
- **Building or running the app (FLPT)?** Part 2 is the state machine, and Part 5 is the provider and cost table.

```
 Intake → Bullets → Fact-check → Deck → Script → [GATE: content + spend]
   → Narration + avatar (paid, first) → crews in parallel → Composite → Tighten → Deliver
   → (series) Wrapper: title card · cold open · bookends · stingers · B-roll · sign-off → Slack pack
```

---

## Part 1 · Core principles

These are the product. Everything in Part 2 exists to deliver them.

### 1. Every slide moves, timed to the voice (motion graphics)
**The rule:** nothing appears before it's said, and every element lands **0.15–0.25 s before its word**.

**Motion vocabulary.** Calm and purposeful, from a small set of moves:
- rise, fade and pop
- draw (strokes), wipe and grow
- word-by-word type, count-ups
- focus/dim and pulse

**Never inside a talk:** bounces, springs, spins, glitches or infinite loops.

**One focal element at a time.** The picture *accumulates*: shown things stay and dim to context (`--dim` about 0.4), they don't vanish.

**End still:**
- All motion finishes at least the hold (1–1.5 s) before the slide ends.
- The last frame reads as a finished slide and matches the deck slide.
- Any paused frame should look finished too.

**Make it deterministic:** seeded noise, never `Math.random()`, local fonts only. The same input gives the same frames.

**The bubble keep-out:** x 0–380, y 700–1080 stays empty on every slide. Labels sit at least 64 px from the edges.

**Detail:**
- `hyperframes-slides.md`: the template, `beats.json`, engine rules, the ideas bank
- `templates/hyperframes/BRIEF.template.md`: the shared animator brief

### 2. Charts: real data, shown honestly
- **At least one real chart per video.** Real data, scaled honestly (bars start at zero), sourced on the slide.
- **Pick the form from the headline's verb:**
  - compare or rank → bar
  - share of a whole → stacked or 100 % bar
  - change over time → line
  - spread → histogram
  - relate → scatter
- **Start with grey.** Earn back one colour for the series that carries the point.
- **Label directly** on the bars and lines, with no legends. Split tangled series into small multiples.
- **Build in reading order:** axes, then bars or line, then the one annotated value.
  - Counters use tabular numerals and appear only when they start counting.
  - Pulse once at most.
- **Never invent a number.** Mark anything illustrative as illustrative. A sourced number earns a **receipt lower-third** (source · date · figure).
- **Detail:** ideas bank #2 and #8 in `hyperframes-slides.md`, plus the bar recipes from the Games run.

### 3. Infographics that explain one structure
- **Use one when the idea is a structure that grows:**
  - a process or flow, a timeline, a ladder
  - a 2×2, before/after, hub and ring
  - a map, an anatomy
- **One message per slide.** At most about six distinct objects. If it needs two ideas, it's two slides.
- **Labels touch the thing they name.** Use a short connector, never a far-off legend.
- **The graphic can dominate** (55–60 % of the frame). The title stays small and up top.
- **For metaphor slides, sketch variants first.** Make a quick sheet of 3–6 visual metaphors:
  - V01 is the safe baseline
  - V02 onwards try different materials, objects and references
  - The user picks, which avoids the "safe default" look
  - `master-slides`' graphics-sheet template and concept-to-metaphor list help here. Re-colour them to our palette and drop their watermark and loops.
- **Illustrations need form.** Shading, weight and wobble, never flat clip art.
- **Detail:** ideas bank #1, #3–#7, #9 and #10 in `hyperframes-slides.md`.

### 4. The whiteboard sketch ("avocado toast"): once per video, required
- **What it is:** a full-frame whiteboard takeover where doodles of *concrete things* draw themselves stroke by stroke, with a marker nib riding the tip, each one exactly as it's named.
- **What counts:** a building, a GPU box, a dragon. Boxes and arrows don't count.
- **How it's drawn:**
  - **Strokes:** one continuous subpath per stroke, 6–10 px with round caps and a slight hand wobble.
  - **Ink:** ink plus one or two accent inks.
  - **Labels:** hand-lettered in Caveat, 1–3 words.
  - **Ending:** finish with an underline or circle around the punchline.
- **Slot:** the most abstract idea in the talk that has an everyday metaphor. Show the user a 3–5 beat sketch plan first.
- **Detail:** `hyperframes-slides.md` → The whiteboard sketch, and the `--from whiteboard-sketch` starter.

### 5. Cartoons (Cosmos-style), 1–2 per video
- **What it is:** a narrated slide becomes a short painted documentary. The bubble is hidden (`"bubble": false`), so there's no avatar cost, and the narration runs on.
- **Lock one style frame for the series.** Pass it as an image reference on every image.
- **Per cartoon:**
  - 4–6 painted keyframes, each cued to a verbatim narration phrase
  - a character reference for anyone who appears twice
  - cut-out layers for parallax
  - one 5 s animated hero shot: draft at 480p, then finalise
- **Grammar:**
  - slow push or pan on each keyframe (1.0 → 1.08 scale), parallax
  - tiny puppet moves (1–3° tilt, blinks)
  - ink-wipes between beats (0.6–0.8 s), grain and vignette
  - a small `CARTOON · TITLE` label that fades out by 3 s
- **Text the story needs** goes in overlays in the deck's fonts, never in the generated art.
- **Historical people** are clearly stylised, never look-alikes.
- **The Shadow style ("storybook limited animation"):**
  - **Palette:** ink/teal shadows, amber up to candle gold, one oxblood accent per scene, paper highlights.
  - **Never:** photoreal, 3D, anime, glossy skin, legible text or logos.
  - **Assets:** prepare art at 1.1× the frame (2112×1188) so camera pushes never show an edge. Give anyone who recurs a 3:4 character reference first.
  - **Hero shot:** `omni_reference`, with the keyframe as start image and the style frame as reference, 1080p 5 s, `generate_audio: false`. Prompt: "subtle, deliberate motion only; no morphing faces; no new characters; no text".
- **Real public-domain film or art beats a generated hero.** To hold a real print inside a painting, generate hands holding a chroma-green sheet and key the print in behind.
- **Narration per cartoon:** 40–70 s. Cartoons cost 29–109 credits each in Shadow.
- **Detail:** `hyperframes-slides.md` → Cartoon slides, and `templates/hyperframes/examples/cartoon/BRIEF.md`.

### 6. Moving pictures: photos in motion, cut scenes and B-roll
- **Photos in motion,** at least once: real or licensed photos with a Ken Burns move, parallax or a masked reveal.
- **Cut scenes, 1–2 per video, about 8–20 s:**
  - **Purpose:** they dramatise the stakes, a scenario, a metaphor made literal, or the turn.
  - **Slots:** the cold open, the turn, or the close. Never mid-argument.
  - **Never carry data.**
  - **Edit:** fade through black over 0.5–0.6 s on both sides. Cinema look (24 fps, anamorphic, grain).
  - **Sound:** diegetic only in the generation. A quiet music bed goes in at the edit (−21 LUFS mix).
  - **Proven recipe:**
    - **Frames:** start **and** end frames lock the action. Re-roll frames, not videos.
    - **Audio:** diegetic master at −26 LUFS (TP −3); the music bed at −25 (TP −4) with a 1 s fade in and a 1.8 s fade out; final two-pass linear loudnorm to −21 LUFS (TP −2, LRA 11).
    - **Encode:** x264 slow CRF 18, Lanczos scaling with error-diffusion dither, and a touch of temporal grain (`noise=c0s=4`) to hide banding.
    - **Length:** match the placeholder's exact frame count, so nothing downstream shifts.
    - **Cost:** about 110–240 credits per scene in Shadow.
  - **Detail:** `cutscenes.md`.
- **B-roll payoffs** (from the finals): a 10 s cinematic shot for a literal-image line in the script ("wiped out by space ninjas in F-16s"). They're cheap and the audience loves them. Detail: `wrapper-and-extras.md` §4.5.

### 7. Real footage first
- **Where the story has a real image, use it:**
  - **Sources:** public-domain or openly licensed archival film and photos (Library of Congress, Wikimedia Commons, NARA, the Internet Archive).
  - **Credit:** credited on screen and on the player page.
  - **Motion:** a slow move.
- **How to grab it:**
  - Use remote ffmpeg seeks, and check every range by eye. Scouted ranges are often wrong, and old films hide intertitles.
  - **Never download from YouTube.** Its terms bar downloaders even for CC BY clips; go through the uploader or a Commons import instead.
- **Read the licence from the source's own metadata:** the Commons API, archive.org `licenseurl`, LoC rights JSON, NARA IDs.
  - Prelinger items with no licence field aren't cleared.
  - CC BY and BY-SA items need attribution.
- **Record every item in a manifest:** file, source page, licence, credit, in/out, notes.
- **Credit format:** "Creator, *Title* (date). Institution (ID). Licence, via Platform." Put it on the slide in footer style.
- **In a slide:** archival film plays muted inside a frame, with grain, a gentle push (1.00 → 1.04) and a light grade. Hold its last frame if the slide outlasts it, and never run it full-bleed in the bubble corner.
- **Copyrighted moments become clip slots.**
  - A placeholder ships: a beautiful, simple stand-in of exactly the slot's length.
  - The user drops the real clip in their editor. The clip guide gives timecodes, the sound policy and inset rectangles, because most slots get used as picture-in-picture.
- **Detail:** `4-video.md` → Clip slots, `lessons.md` 2026-10-06.

### 8. Anti-slop: words, pictures and edit
**Narration** (the `unscripted` skill, natural mode, roughness 3½). A smart person glancing at bullets and talking, a "B+, 85/100" delivery:
- **The texture:**
  - real ums, about 1 per 130–150 words
  - 1–2 thinking beats per talk
  - self-repairs, asides, uneven rhythm
  - the speaker's verbal signatures, used sparingly
- **Laughs are off.** The voice engine's laughs didn't land.
- **Pauses:** prefer `[short pause]`. `[pause]` renders at 1.5–2.8 s on `elevenlabs_v3`.
- **Banned:**
  - rule-of-three lists, a zinger on every paragraph, "It's not X, it's Y", "Here's the thing", "Let's dive in", em-dash drama, rhetorical questions that answer themselves
  - the AI word list (delve, leverage, seamless, robust, unlock, elevate, landscape, journey, tapestry, testament and the rest)
  - One memorable line per slide at most, said plainly.
- **Check:** score each slide 0–100 for "sounds unscripted but competent", and aim for 80–88. Present Studio's linter is a good automatic check (`slop.js`, a port of SlopMonster's `deslop.py`). Its loop: lint → a rival-model cleanse → re-lint → fix.

**Slide copy:**
- **Titles say something:** a claim or a sharp phrase ("Cheaper by the unit, bigger by the bill"), not a label.
- **Don't put the script on the slide.** The voice says the sentence; the slide shows a cue plus a picture, about 20 words at most.
- **Concrete beats abstract:** "saves 4 hours a week", not "improves efficiency".
- **One unforgettable beat per talk:** a full-bleed image or one giant number. Let it breathe.

**Pictures:**
- No clip art, no generic AI imagery, and no text baked into generated images.
- One accent per slide, and it needs a reason you could say out loud.
- Check every generated still at full size before spending on video:
  - crop baked-in borders
  - remove real logos and readable labels
  - check the hands

**Edit:**
- Hard cuts inside the talk. Film-style transitions only at seams.
- Music in patches, never wall to wall.

**Sources:** the slide rules here are adapted from the `slide-principles` skill (RoboNuggets, CC BY 4.0, drawing on Minto, Duarte, Mayer, Medina, Knaflic and Schwabish). The banned list draws on SlopMonster, stop-slop and `humanizer`.

### 9. Facts stay exact
- **However rough the delivery,** every number, name, date and quote is right. Quoted words are verbatim.
- **Fact-check before the deck is final, not after.** Use 2–4 fact agents split by topic, about 80 claims per talk. Expect 5–20 corrections.
- **A correction can become a better line.** Read the notes, not just the verdicts.
- **When a fact changes, grep every script in the series.** Plants and payoffs must change together.
- **Copyrighted text** (modern translations, poems, routines): quote at most 15 words, plus a paraphrase. Public-domain texts can be quoted in full.
- **Remembered anecdotes:** tell the real version, and frame the speaker's embellishment as theirs.

### 10. Consistent, recognisable and honest
- **Signature constants** stay fixed across a series (`signature-style.md`):
  - the presenter (the same look, voice, engine and bubble)
  - palette and type tokens, slide grammar (eyebrow plus serif title, dark statement slides, one accent slide)
- **Honest:** the player page discloses the AI presenter, generated scenes and cartoons, archival sources and music credits. Real people appear only with consent.

**Series devices, with exact specs.** These are the specs that held up. Give animators exact specs, or they diverge.

| Device | Spec |
|---|---|
| **Badge** | `SERIES TITLE · PART n`, top-right (right 128, top 64). On screen from frame 0, never animated, and not on cartoons. |
| **Receipt lower-third** | A torn-top paper slip: source · date · one figure, in IBM Plex Mono 24 px, ink on paper, at left 420 / bottom 64 (clear of the bubble) or top-right. **It prints on the cue where the number is said, and stays.** The print is a *stationary* upward wipe (stepped `clip-path: inset()`, about 0.5 s) with the shadow landing one frame later. The paper never slides. Multi-line receipts print line by line. |
| **Question card** | Full-bleed ink, a thin oxblood rule, one centred serif line in paper colour. The rule draws 0.2 s ahead, the line fades in over 0.6 s, and it holds. Every talk ends on one, and it can also open an act. |
| **"Previously…"** | A 15 s recap at the top of Part 2 onwards: a callback visual (the rink redrawn, three cards plus a polaroid), not just a line. |
| **Next-time teaser** | A spoken line plus a visual on the last slide. |
| **Motifs** | One or two images that recur and change meaning: Shadow's "two clocks" (world vs game; moves vs rules), the rink, the receipt, the save file. |

**Arc rules for a persuasive series** (from Shadow's "inception" plan):
- Hold the thesis back until the episode that proposes it.
- Raise the strongest objection yourself.
- Prove the point with a working thing.
- Keep the user's own jokes and phrasing.

### Settled where the old briefs disagree
- **Receipts:** the stationary 0.5 s wipe above. The earlier "slides up 0.35 s" and "rises 40 px" versions are retired.
- **Re-timing:** when animators build against the real audio (the normal order now), **don't run `retime.py`**. Use `real-words.py` + `align-beats.mjs --offset <lead>` per slide. `retime.py` is only for slides built before the audio existed.
- **Laughs:** none. `tighten.py` cuts any that slip through.
- **Cartoon hero shots:** one per cartoon, at 1080p directly (about 60 credits). A 480p draft (15) plus finalise (60) costs more, so draft only when the motion is risky. Re-roll at most once, then fall back to a camera move on the still.
- **Duration estimates:** use `est_durations.py` (16.5 characters/s, +0.5 s per `[pause]`, +0.3 s per `[short pause]`). Measured voices run 14.6–17 characters/s.
- **"lead":** 0.2 s is the beat pre-roll in `beats.json`. 0.5 s is the narration lead before slide 1 and after a cut scene. They're different things.
- **Episode length:** aim for 12–14 minutes of presentation. The wrapper is extra.

---

## Part 2 · The production workstreams

| # | Stage | Who | Output | Human gate | Read |
|---|---|---|---|---|---|
| 1 | **Intake** | director | `brief.md`: topic, the point, audience, length (about 150 words a minute), tone, what they brought | answers short questions | SKILL.md → Intake |
| 2 | **Bullets** | director, plus research agents | `bullets.md`: per slide a title, 2–5 bullets and a visual note | "locked" | `1-research.md`, `2-framework.md` |
| 3 | **Fact-check** | 2–4 fact agents | a claims table: verified, corrected or unverified, with safe wording and sources | — | Part 1 §9 |
| 4 | **Deck** | deck agent | a Slides artifact, a contact sheet, an overflow and collision check, a bubble-corner check. A signature element is planned per slide. | review | `3-deck-and-script.md` |
| 4b | **Wrapper plan** (series) | director | the episode skeleton, the cast, punctuation candidates (B-roll lines, interruption beats, reaction moments), and costs | review | `wrapper-and-extras.md` |
| 5 | **Script** | director (`unscripted`) | `script.md`: narration with delivery tags, stage notes, cut-scene blocks, clip slots | review and edit live | `unscripted`, `tts-tags.md` |
| 6 | **Spend** | director | an itemised estimate per provider: avatar minutes, generation, music, wrapper pieces | **explicit yes** | Part 5 |
| 7 | **Narration + avatar** (paid, run first) | pipeline | TTS and one avatar clip per slide, a draft composite, and **the real timeline** | — | `4-video.md` |
| 8 | **Crews, in parallel** | about 4 animators; a cartoon maker; a cut-scene director; a footage grabber; (series) a wrapper director | slide clips, cartoons, cut scenes, archival segments, wrapper pieces | spot reviews; still frames before any video spend | `hyperframes-slides.md`, `cutscenes.md`, `wrapper-and-extras.md` |
| 9 | **Composite** | pipeline | the master, the exact timeline JSON, chapters. A dry run must say "0 characters, 0 clips". | — | `4-video.md` |
| 10 | **Tighten** | pipeline | pauses over 1.1 s shortened, laughs cut, sync kept | default on | `4-video.md` → Tightening |
| 11 | **Deliver** | pipeline | the editing master, web parts, player page, clip guide, wrapper kit, all levelled | — | `delivery.md` |
| 12 | **Slack pack** | pipeline | (vF), 1.25×, MP3 and cover from the user's final export | — | `delivery.md` §4 |
| 13 | **Retro** | director | `capcut_study.py` on the user's edit, and new lessons | — | `lessons.md` |

**The ordering lesson:** record the narration **before** animating.
- Avatar clips don't depend on the visuals, so the paid run starts as soon as the script is approved.
- The animators then time every beat to the real voice, so no re-timing pass is needed.
- A cut scene that isn't ready can be a black placeholder of the same length, swapped in later for free.
- Plan cut scenes before the paid run: adding one next to a rendered slide re-bills that slide.

**Script conventions** (`script.md` is the single source; the deck's speaker notes and the narration are both generated from it):
- **A header** naming the skill and roughness, the signature counts, the target length, the tags and the facts file, then `---`.
- **`## SLIDE n — Title`** starts each narrated slide. **`## CUTSCENE X — Title`** marks a scene with no narration; text under it becomes optional voiceover.
- **`>` stage notes are never spoken.** Each one opens with its device's name, so tools and agents can find them:
  - `COLD OPEN`, `Cosmos-style cartoon, narrated, bubble hidden`, `WHITEBOARD SKETCH`
  - `Live chart:` (points, scale, receipt), `Infographic`, `Public domain:` (item plus credit)
  - `Receipt: source · date · number`, `QUESTION CARD:`, `Optional clip slot: <official URL, in–out>`
  - New for the wrapper: `INTERRUPTION:` (who, the line, the narration it replaces), `B-ROLL PAYOFF:` (the line, the image), `REACTION SLOT:` (the moment, what kind of clip).

**Deck QA before any render** (an automated check in headless Chrome, plus a contact sheet):
- overflow, where `scrollWidth`/`scrollHeight` exceeds the box by more than 2 px
- intersecting text boxes, and strokes through text
- anything in the bubble corner (a pixel check on the contact sheet)
- fonts that failed to load
- Then write `animation_notes.md`: key coordinates per slide, plus an "Animate:" build order with verbatim cues for the animators.

**The crew briefs** (each agent gets one written brief, a private scratch folder, and a cap):
- **Animators** (3–4 slides each):
  - Use the shared `BRIEF.md`, and align beats to the real audio with `real-words.py` + `align-beats.mjs`.
  - Set the duration from the timeline minus one frame, and run the hold test.
  - The final frame equals the deck slide.
- **Cartoon maker:** the series style frame, keyframes cued to the words, cut-outs, and one hero shot. Cap about 150 credits.
- **Cut-scene director:** storyboard → start frames (looked at before spending) → video → music → two-pass loudnorm → conform. Hand the key still to the animators early. Cap about 450 credits.
- **Footage grabber:** public-domain segments by remote seek, a manifest (licence, credit, in/out), and an eyeball check of every range.
- **Wrapper director** (series): title and hand-off cards, the cold open and bookends (Lane D method), stingers, B-roll payoffs, transitions, beds, the run-sheet, all levelled.

**Shared rules for every agent:**
- stay in your own files
- use verbatim cue phrases
- report paths, durations, problems and spend
- never print keys

---

## Part 3 · The wrapper: from presentation to episode
Michael's own layer grew from 19 % to 52 % of each episode. **It's half the show.** The skeleton:

| Beat | Typical length |
|---|---|
| Title card + announcer | 2–15 s |
| Cold open | 5 s – 2:30 |
| Bookend "before Part N" | 1–3 min |
| Hand-off card | 3–10 s |
| **The presentation** | 12–15 min |
| Reel runout | 3 s |
| Bookend "after" / B-plot | 1–7 min |
| Sign-off ("Thank you for your attention to this matter.") | 3–35 s |

**Inside the talk he punctuates rather than re-cuts:**
- reaction cutaways (the user's own clips)
- clip slots as picture-in-picture
- character interruptions and heckler stingers
- B-roll payoffs
- hold-the-slide loops for overlay montages
- transitions only at seams, music in patches

**Plan it with the deck, price it in the spend gate, and deliver it levelled and ready to drop in.** Everything about the wrapper is in `wrapper-and-extras.md`.

## Part 4 · Delivery and levels
- **Always:**
  - the `.mp4` for the web and the `.mov` editing master for CapCut (point users to the `.mov`)
  - the player page with disclosure
  - the clip guide with inset rectangles
- **Levels:** everything an editor gets sits at −14 LUFS and −1 dBTP. Beds come at −26 (`.bed`) and −16 (`.full`). Use `scripts/video/loudmatch.py`.
- **The Slack pack** from the user's final export: `scripts/video/slack_pack.py` makes the (vF), the 1.25× cut, the MP3 and the cover.
- **One named folder per episode, full paths always.**
- **Detail:** `delivery.md`.

## Part 5 · Providers, defaults and costs

| Job | Default | Alternatives | Real costs |
|---|---|---|---|
| Director and crews | Claude (Agent SDK / Claude Code) | — | — |
| Avatar video + voice | HeyGen v3: photo avatar on Avatar IV, the user's HeyGen voice on the `elevenlabs_v3` engine | Gemini 3.8 TTS clone or an ElevenLabs clone driving HeyGen lip-sync | about 4.1 US cents per second of avatar video, so 28–35 dollars per 13-min episode |
| Stills (start frames, keyframes, plates) | Nano Banana Pro via **Higgsfield** (2 credits at 2K) or **Kie.ai** | GPT Image 2.5 | cents |
| Video (cut scenes, hero shots, B-roll, bookends) | Seedance 2.5 via **Kie.ai** or **Higgsfield** | **OpenArt** (Seedance 2.5) as the opt-in "film quality" upgrade; BytePlus direct; Kling 3.0 | Kie about 0.32/s at 720p and 0.63/s at 1080p; Higgsfield about 7 credits/s at 720p and 12/s at 1080p. A 20 s scene is about 250–400 credits with re-rolls. |
| Music beds | ElevenLabs Music API; the user's licensed library | CC BY tracks, with credit | cents |
| Transcription (tighten, QC) | ElevenLabs Scribe | whisper-cpp (local, free) | cents |
| Stinger voices, word patches | ElevenLabs v3 | Fish Audio S2.1 Pro | cents |
| Slop cleanse (optional) | a rival model (OpenAI) | — | cents |

- **Provider choice (Michael, 2026-10-12):** a general tool defaults to **Kie.ai and Higgsfield**. OpenArt's film quality is better, but it's too expensive to be the default. It's an opt-in upgrade.
- **What a Shadow episode cost:**
  - the presentation: about 30 US dollars of HeyGen plus 450–600 Higgsfield credits
  - the extras, made on OpenArt: roughly 125,000 OpenArt credits across the series
  - so the wrapper is where budgets go, and it must be priced piece by piece
- **Reconcile spend** from provider transaction logs, not balances, because accounts are shared.

## Part 6 · House rules
1. **Every spend is explicit.** State the cost, wait for a yes. Free checks first (`--check`, cost preflights).
2. **Keys never appear in chat, logs or files we create.** They live in `~/.config/avatar-presentation/keys.env` (or the Keychain in FLPT), entered through hidden dialogs.
3. **Never guess identity assets.** Look, voice and recordings are picked from a contact sheet or samples, and stored by ID.
4. **Copyright:**
   - Link, don't copy, paid sources.
   - Never download from YouTube.
   - Copyrighted clips become clip slots the user fills, unless the user hands over their own file. Then drop it in:
     check its first and last frames for flash frames, conform it, level it (dialogue about −16.6 LUFS), and credit it
     in the player's `media_note` as for internal viewing. Rubio, Downton, Hedberg and "More Cowbell" were done this way
     (2026-10-13/14).
   - Never bundle copyrighted clips, celebrity likenesses or sound-alike voices.
5. **Consent:** only the user's own likeness, people who've consented in writing, or original characters.
6. **Disclosure** on every player page.
7. **Long jobs run in the background** with a one-line status. Deliver to a named folder, with full paths.
8. **Learn:** after every video, add 3–6 bullets to `lessons.md`, and promote what should always apply.

## Part 7 · Checklists

**A. Before filming (signature checklist):**
- [ ] Motion graphics: every slide builds as it's narrated
- [ ] A photo in motion
- [ ] A real chart: sourced, honest scale, grey-first, labelled directly
- [ ] An infographic: one structure, at most about six objects
- [ ] A live HyperFrames build that lands on its words
- [ ] The whiteboard sketch: concrete doodles, pen nib
- [ ] Cut scenes (1–2) and cartoons (1–2), with stills approved before video spend
- [ ] Real archival footage where the story has it; clip slots marked
- [ ] The script: natural mode, no laughs, signatures counted, `[short pause]` preferred, facts checked
- [ ] Slides: titles say something; no script on the slide; one thing pops; the bubble corner is empty; no overflow or collisions
- [ ] The presenter profile is unchanged (or a one-slide sample is approved)
- [ ] (Series) The wrapper plan and its costs are approved

**B. Before delivery:**
- [ ] The dry run says "0 characters, 0 clips"
- [ ] `tighten.py` has run
- [ ] The editing master `.mov` is made; A/V sync measured within ±10 ms if anyone doubts it
- [ ] The player page has chapters, a transcript, and disclosure with a `media_note`
- [ ] The clip guide has timecodes, the sound policy and inset rectangles
- [ ] Extras are levelled (−14 LUFS / −1 dBTP; beds at −26 and −16)
- [ ] One named folder per episode, full paths reported

**C. The episode wrapper:**
- [ ] Title card(s) and the flyer (with the 1.25× note)
- [ ] Cold open
- [ ] Bookend "before" and "after", full runs, likeness-gated, ASR-checked
- [ ] Hand-off card and announcer line
- [ ] Reel runout and seam transitions (with blend modes noted)
- [ ] Stingers (original voices), B-roll payoffs, beds
- [ ] Sign-off card and line
- [ ] `RUNSHEET.md` and `CREDITS.md`
- [ ] After the user's edit: the Slack pack, and `capcut_study.py` for the retro
