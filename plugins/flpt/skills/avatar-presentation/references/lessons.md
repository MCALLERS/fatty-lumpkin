# Lessons log

Add 3–6 bullets per session: what worked, what the user changed, and any new costs or timings. Promote anything that should always apply into SKILL.md or signature-style.md.

## 2026-09-26/27: "Why would a law firm buy GPUs?" (first video)

- **Research.** Four parallel research agents with a strict card template worked well. Spot-check the facts that will be said aloud, because the cost premise and one quote attribution were wrong. The user valued the candid corrections.
- **Identity assets.** Guessing the avatar and cloning a voice from an inferred recording both failed. Show a contact sheet and samples, then store the IDs. HeyGen sheet numbers change as the user adds looks: 27 became 31, then 22, within a day.
- **Tone.** The user found the polished script "too AI". Default to the `unscripted` skill at roughness 3.
- **Bubble.** The user wants it bottom-left: a rounded window, Loom-style.
- **Costs.** HeyGen photo look on Avatar IV ≈ $0.04/s all-in, so a full 17-minute talk cost ≈ $39 and took about 23 minutes at a concurrency of 8. A Digital Twin on Avatar IV rendered very slowly, about 20 minutes per clip.
- **Keys.** The hidden macOS dialog (`set_keys.py`) was the easiest way to collect keys.
- **Launchers.** File links in the app don't run `.command` files; launch them with `open`.

## 2026-09-27: workflow build session

- **HyperFrames 0.8.80.** `npx hyperframes skills update` installs 10 core skills; it also symlinks into other agents' skill folders. Telemetry is on by default: `npx hyperframes telemetry disable`. The live-slide template (`templates/hyperframes/`) renders 30 s in about 7 s.
- **Student kit** (`~/Projects/hyperframes-student-kit`). `video-storytelling` (one persistent scene, a spotlight on one thing, timing to word starts) is the most useful skill for slides. Its card libraries (Vox-explainer, Kallaway) cover the motion-graphics slides.
- **Reference style:** Nate Herk's "avocado toast" whiteboard edit, with hand-drawn SVG strokes and a pen nib, each step appearing as it's said. The template's `draw` beat with `pen` does this.
- **YouTube:** yt-dlp captions now hit HTTP 429 (a token is required), so read captions in the browser pane instead.
- **Presenter profile.** Created because HeyGen looks change often. The user re-made their avatar and voice; every look links to one voice, and one look is locked in the presenter profile.
- **Bubble.** Moved to the bottom-left. Old decks laid out for the bottom-right collide with it, so design new decks with the bottom-left clear.
- **Voices.** Gemini 3.8 Flash TTS clones (`voice_…`) work through the API with a same-project key. In the A/B on slide 8 (same text, look and bubble), the user chose the **HeyGen voice**, which is the locked default. The Gemini clone "Michael 1" (`voice_0arekjf8g8p0`, expires 2027-09-27) stays available via `TTS_PROVIDER=gemini`.
- **Bubble shape.** The user chose the rounded square (locked).
- **Unscripted.** The first test on slide 8 at roughness 3 was "spot on" per the user, so keep 3 as the default.

## 2026-09-27: Latham v2 cut scenes

- **Start frames.** `nano_banana_pro` 2k at 2 credits each (the job reports it as `nano_banana_2`). Six frames at about 2 minutes total. The frames for cut scene A doubled as slide 2's photos.
- **Seedance 2.5 on Higgsfield.** 1080p with audio costs 12 credits/s, about 84 per 7 s shot (confirmed via `get_cost:true`). The first batch was intercepted with a preset suggestion ("IN THE DARK"), so resubmit with `declined_preset_id`.
- **Faces.** The user relaxed the faces-out rule: fictional faces are OK, the user's own face never appears.
- **Seedance returns.** Six shots finished in about 6 minutes: 1920×1080 at 24 fps, 32 kHz audio, 7.05 s or 6.05 s each. The diegetic sound came out very quiet (scene B averaged about −42 dB). Conform each scene with a filter-graph concat (fps 30, 48 kHz, 40 ms audio fades at the joins), then `loudnorm I=-26:TP=-3` so the room tone sits well under the narration.
- **Cut scenes need no media.json.** `## CUTSCENE X` headings plus `media/cutscene_X.mp4` are enough. The free draft (37 s to build for a 10:40 talk) shows them in place.
- **Slide stills from cut scenes.** Upload them to the deck artifact in one `Artifact publish asset:true file_paths:[…]` call, then put the `/_blob/` URLs into the builder. A late frame from a shot (for example the lit rack at 6.4 s of A3) can beat the start frame as a still.
- **Voice rate.** Over the full v2 run the locked HeyGen voice averaged about 16.7 characters/s including break markup (604 s of narration). The opening slide ran slower (14.6) and dense slides faster (17). The pipeline's 14.5 is deliberately conservative for cost estimates. The 12-min brief came out at 10:55.
- **Venv.** A fresh project folder failed `--check` for lack of `requests`. `scaffold.py` now creates `video/.venv` with requests.

## 2026-09-27: Latham v2 final (the first full run of the new flow)

- **Cost and time.** $24.86 for 10:55: 604 s of narrated avatar video at about $0.041/s, from wallet readings before and after. It took 16:40 wall time: narration runs one slide at a time (about 6 min), then 14 clips four at a time. `HEYGEN_MAX_CONCURRENT=8` is now in presenter.env (the user approved it on 2026-09-27), which roughly halves the clip phase.
- **Order that worked.**
  1. Build the animations on *estimated* durations.
  2. Run the paid render in parallel. It uses static PNGs, and clips don't depend on the visuals.
  3. `retime.py` re-times and re-renders all 14 slides against the real narration. That took about 5 min, with no warnings, and every cue matched.
  4. Re-run `--final`. It re-composited in 47 s with 0 paid work.
- **Parallel animators.** Four agents took 3–4 slides each, with one shared `BRIEF.md` (now `templates/hyperframes/BRIEF.template.md`). That gave a consistent motion language in about 20 min.
  - Give each agent its own scratch subfolder: they overwrote each other's helper scripts in the shared scratchpad.
  - Ask for a verbatim `cue` on every beat, and `after` for sub-steps. That's what made the re-time automatic.
- **HyperFrames gotchas the agents hit.**
  - The template's local fonts are Latin-only subsets, so Greek (Δ) falls back to a system font. Draw the symbol as an inline SVG instead.
  - The drawElement fast capture sometimes fails its self-check. HyperFrames then falls back to screenshots and turns parallel capture off for the install (`HF_DE_PARALLEL_ROUTER=true` turns it back on). The output is fine but slower.
  - The encoded paper colour comes out about 3/255 darker than the PNG.
  - Keep the deck's own header size (72 px) rather than the template's 64 px, and scope the template's `border-box` rule so card sizes stay exact.
  - Counters showed "$0M" for seconds while waiting for their number. Reveal a counter only when it starts counting.
- **Music.** The ElevenLabs Music API (`POST /v1/music`, `music_length_ms`) worked with the existing key. Two 21 s instrumental cues were loudness-normalised to −25 LUFS under the diegetic sound, and the mix came out at about −21 LUFS. Keep the no-music masters beside the mixed files.
- **Whisper.** The user asked whether they needed Whisper. They don't: `pseudo-words.py` (silence spans plus punctuation-anchored DTW) anchored 13–24 pauses per slide, and the beats landed on their words.

## 2026-09-27: the user's verdict on Latham v2

- **Quality: "very good, well done."** Keep this bar. The things that made it: every slide animated to the words, a consistent motion language from one shared brief, cinematic cut scenes with a quiet music bed, the locked presenter, the unscripted riff at roughness 3, and the automatic re-time to the real voice.
- **Missing: the avocado-toast animation.** Diagram builds in the deck style aren't what the user means. From now on, every video needs at least one **whiteboard sketch**: hand-drawn doodles of concrete things, pen nib, hand-lettered labels (`hyperframes-slides.md` → The whiteboard sketch). It's in the signature checklist.
- **Faces.** Faces may be featured in cut scenes, and the user may cast themselves as a character (their call per video; see `cutscenes.md` §6). This supersedes the 2026-09-27 cut-scene entry above that said the user's own face never appears.
- **Script voice.** The user's own verbal signatures are now in the `unscripted` skill: "It's like, x, y, z" (a few per talk), and "my dude" for impact (at most once per presentation).
- **Skill-loader gotcha.** In SKILL.md, a dollar sign followed by a digit is replaced by the skill's arguments when the skill loads (for example "0.04/s" came out as "New.04/s"). Write costs as "25 US dollars" in SKILL.md. Reference files are safe.

## 2026-09-29: "Let them play it" (Games and GTM), the second full run of the flow
- **Result and cost.**
  - The video runs 8:10: 12 slides, all animated, plus the whiteboard sketch and 2 cut scenes.
  - HeyGen cost **$18.10** (wallet 199.42 → 181.32) for 7.3 min of narration, about $0.041/s.
  - With `HEYGEN_MAX_CONCURRENT=8`, the whole paid run took 14.5 min.
  - Higgsfield used about 500 credits (4 start frames + 6 shots). ElevenLabs music cost a few cents.
- **Reading a video source with no captions (an X post).** In the browser pane, seek the page's `<video>` (a blob MSE stream, same-origin) and `drawImage` frames onto an in-page canvas laid out as a grid. Screenshot that to read the slides. There's no audio this way, so cite slide text only and don't quote the speaker. Paywalled summaries didn't help.
- **The pasted research from another model mostly held up, but check it.** The IBM CityOne "top lead source" claim was the speaker's own anecdote, so it was dropped. The Wouters meta-analysis cuts against photorealism (schematic d = 0.46 vs photoreal 0.14, n.s.). The talk used that candidly as a design rule, which strengthened it.
- **Cut scene "the reload".**
  - B1 and B3 share **the same start frame**, so the counterfactual is the same moment with a different choice.
  - B2 starts from B1's last frame, uploaded via `media_upload`. The presigned PUT needs `-H "If-None-Match: *"`, otherwise it's rejected.
  - The rewind is ffmpeg `reverse,setpts=PTS/k,tmix` plus `areverse,asetrate` for a tape sound. See `presentation/cutscenes/conform.sh` in games-gtm.
  - The music is two cues, tension and then calm, spliced at the rewind.
- **Higgsfield latency.** Start frames take about 2 min. Seedance shots took 8–40 min: B2 queued for about 35 min during a stretch of API 503s. Submit shots as soon as their frames are approved, and run everything else in parallel.
- **Start the paid render early.** If a cut scene isn't ready, a black placeholder of about the right length lets `--final` run (avatar clips don't depend on cut-scene content). Swap the real file in and re-composite for free.
- **Script length.** The first unscripted draft ran short (about 1,000 words ≈ 7 min). Budget about 100–115 words per slide at this voice for 35–40 s slides.
- **Re-time gotchas.**
  - The real voice pushed slide 5's finale into the hold. Fix it by tightening the last beats and lowering the hold to 1.2.
  - `retime.py` used to abort on the first failure. It now carries on and reports the failing slides at the end.
- **Artifact host.** The Slides deck hit repeated Cloudflare 502s on publish. After three identical rejections the tool says to stop. Report it and retry later with the user's OK.
- **Safety check.** `rm -f $S/*` is blocked when S could be empty. Use `"${S:?}"/…` or a new folder.
- **User feedback applied.** This run included the whiteboard sketch, a featured face in the cut scene, and the user's verbal signatures ("It's like," ×3; "my dude" ×1, on the $8.2B beat).
- **Voice "delay" in CapCut (reported after the Games video).**
  - **The master was fine.** It was voice-early by 15–25 ms vs HeyGen's lips, measured by cross-correlating 5 ms loudness envelopes of the final mix against the cached clip audio.
  - **The cause is the MP4 edit lists:** video media_time 66.7 ms (B-frames) and audio 21.3 ms (AAC priming). CapCut doesn't apply them the way browsers do.
  - **The fix:** `scripts/video/make_edit_master.sh` writes `presentation_for_editing.mov`. It has no B-frames, constant 30 fps, PCM audio, no edit lists and the voice +20 ms, and measures ±5 ms.
  - **From now on**, hand users this file whenever they'll edit the video in another app.

## 2026-10-06: HeyGen speech API change and an expressive-voice option
- **The speech request now needs a voice engine.** `POST /v3/voices/speech` rejected our voice with "the requested or saved voice engine is not available". The request needs `"engine"`, set to one of the voice's `available_engines` from `GET /v3/voices?type=private`. Our voice lists `starfish, orca, elevenlabs, elevenlabs_v3`.
  - The pipeline now sends `HEYGEN_VOICE_ENGINE`, defaulting to `starfish`, the original sound. The cache key is unchanged for starfish.
- **`elevenlabs_v3` on the user's own HeyGen voice keeps audio tags** (`[laughs]`, `[chuckles]`, `[sighs]`, `[breath]`) and bracketed pauses. That's the way to get real laughs and breaths without switching voices.
  - A/B samples are in `shadow-series/research/voice_test/`: A starfish, B elevenlabs_v3, C the Gemini clone. The user picks by ear.
- **Voice B chosen (2026-10-06).** The user picked the HeyGen voice on `elevenlabs_v3` over the starfish engine and the Gemini clone, for the natural, disfluent delivery.
  - It's now the profile default (`HEYGEN_VOICE_ENGINE=elevenlabs_v3`).
  - Earlier projects pin `starfish` in their own `api_keys.txt`, so re-running them won't re-voice or re-bill.

## 2026-10-06: *The Shadow of the Future*, scripts and decks (four talks)
- **Fact-check before the deck agents finish, not after.** Four parallel fact agents (about 80 claims per talk) found 5–20 corrections per talk, some of them outright errors:
  - "World Heritage" was really *intangible* heritage.
  - Blockbuster's 9,000 stores were the 2004 peak, not 1995.
  - Late fees were revenue, not profit.
  - Coase didn't coin "transaction costs" in 1937.
  - Grady's racing line was a paraphrase.
  - Send each deck agent its corrections mid-run with `SendMessage`, and have every deck parse `script.md` at build time, so a script fix refreshes the speaker notes on a rebuild.
- **Corrections can be upgrades.** Coase's 1937 telephone footnote ("if it cuts market costs more, firms get smaller") turned a weak claim into the talk's thesis. Read the fact file's notes, not just its statuses.
- **Plants and payoffs across talks must be patched together.** T1's racing line and T4's "It's raining" payoff had to change in one edit. When a fact changes, grep every script in the series for it.
- **Deck agents ship text collisions.** First renders had labels crossing chart lines, card text spilling out of its card, and a subtitle wider than its paper. Before the final render, require an automated check in headless Chrome:
  - any element whose `scrollWidth`/`scrollHeight` exceeds its client box
  - any two text boxes whose bounding rects intersect
- **Natural-mode dosage.** First drafts undershot at about 6 ums per talk. The calibrated target is about 1 per 130–150 words, or 15 per talk. See the unscripted skill.

## 2026-10-06: *The Shadow of the Future*, filming (four talks, about 55 minutes of video)
- **Paid narration first, then animation.** The avatar and voice run went first (two lanes, about 35 minutes for four talks). The animators then built against the real audio from the start, so no retime pass was needed. Keep this order.
- **pseudo-words.py misreads expressive voices.** On `elevenlabs_v3`, long pauses and voiced laughs threw cues 1.5–3.6 s off. `templates/hyperframes/real-words.py` (voiced spans mapped to clauses by a dynamic program) is now `retime.py`'s default aligner. Read the span map it prints.
- **Hidden bubble for documentary segments.** Six cartoon slides used `"bubble": false`: no clip and no cost, and the bubble fades out and back in on the neighbouring slides.
- **Cosmos-style cartoons work.** Six cartoons by two makers cost 460 credits. Each one used:
  - a locked style frame passed as `image_references` on every image
  - 4–6 Nano Banana Pro keyframes
  - cut-out layers for parallax
  - one 5 s Seedance hero shot

  See `hyperframes-slides.md` → Cartoon slides.
- **Use real footage wherever it exists.** A grabber pulled public-domain segments from Wikimedia Commons, archive.org and the LoC with remote ffmpeg seeks: about 0.3 GB, nothing from YouTube. Verify every range by eye. The scout's ranges were wrong twice, and the manifest missed an intertitle inside one clip.
- **Copyrighted clips become clip slots.** The video ships with a placeholder: a generated scene with the quote set in serif, or a public-domain stand-in. `CAPCUT_CLIP_GUIDE.md` gives the final timecodes, how to handle the sound and the inset rectangles for dropping in the real clip.
- **Costs:**
  - HeyGen: about 114 US dollars for about 55 avatar-minutes, at 4.1 cents a second.
  - Higgsfield:
    - seven cut scenes: 1,312 credits, about 190 each at 1080p
    - six cartoons: 460 credits
    - stills and style frames: 14 credits
- **Reconcile credits from the transaction log, not the balance.** The account is shared with the user's other work. During this run it also showed about 1,920 credits of jobs that no agent here made. Per-agent ledgers plus `transactions` made that clear.
- **Twelve or more agents in one shared scratchpad collide** on generic file names. Give each agent a private scratch subfolder in its brief.
- **The disclosure must cover everything generated.** The player's AI notice now takes a `media_note` (in `player_config.json`) for cartoons and archival footage, not just cut scenes.

## 2026-10-07: the user's verdict on *The Shadow of the Future*
- "The laughing isn't really working… everything else works great." Laughs are paused in `unscripted` and `signature-style.md`. Ums, pauses, thinking beats and self-repairs stay.

## 2026-10-07: *Cut 'Em Up* (a new Part 4, built from the user's own notes)
- **Notes to published player in about six hours.**
  - Steps: review → deck → the user's go → paid narration first → four animators, the cartoon and two cut scenes in parallel → composite.
  - Paid-narration-first held up again: every animator aligned to the real voice, and no re-time pass was needed.
- **Detailed notes:** follow them closely, and offer improvements as removable extras. Here those were a callback to an earlier talk, a tie-in to the previous part, Calvinball and real pivots. The user kept the title, swapped one joke for a gentler, on-theme one, and said go.
- **Fact-checkers hit the API content filter twice** when asked to reproduce copyrighted text verbatim (a modern translation, a comedy routine, a poem).
  - Split fact-checks by topic.
  - Ask for short phrases (≤ 15 words) plus a paraphrase.
  - Quote public-domain texts in full.
  - The classics were then verified straight from the saved public-domain copies.
- **A remembered joke can differ from the real bit.** Tell the real version, then frame the user's embellishment as theirs ("in my head that turned into one guy"). It kept their image and stayed honest.
- **Re-check balances before quoting a constraint.** Between sessions, Higgsfield went from 270 to 15,075 credits and HeyGen from 67 to 317 US dollars.
- **Costs:**
  - HeyGen: 28.30 US dollars for 12:49 (15 clips; the cartoon slide had no presenter).
  - Higgsfield: 461 credits. Cut scenes took 352 (A 242, B 110) and the cartoon 109.
- **`real-words.py` blind spot:** a slow "um" pulled the next clause into its span, 0.9 s early. Read the span map and fix it by hand against the loudness envelope.

## 2026-10-08: tightening Parts 2–4 after filming
- **The ask:** the user fixed Part 1's pauses by hand in CapCut, then asked for Parts 2–4: "dead space… silent for just a bit too long", and cut the laughs.
- **What fixed it:** `scripts/video/tighten.py`, driven by Scribe word timings plus the loudness envelope. It made 84 cuts and 79 s across three talks, cut three laughs, and stayed in sync to a fraction of a millisecond.
- **The default to change:** the `elevenlabs_v3` voice renders `[pause]` as 1.5–2.8 s, which is too long for this user.
  - Use `[short pause]` for most beats.
  - Keep `[pause]` for rare dramatic moments.
  - Or run `tighten.py` before delivery as a standard step.

## 2026-10-12: what Michael added in CapCut (*The Shadow of the Future*, Eps 1–4), and the FLPT spin-off
- **His layer is half the show.** The finals ran 17:49, 18:20, 24:07 and 26:34 against masters of 12:27–15:01, so his own material was 19 → 32 → 48 → 52 % of each episode.
  - **The skeleton:** title card + announcer → cold open → "before Part N" bookend → "Your training video will begin shortly…" → the master → reel runout → "after" bookend / B-plot → "Thank you for your attention to this matter."
  - **The source:** his CapCut drafts are plain JSON, so `scripts/edit/capcut_study.py` reads them exactly. The evidence is in `~/Projects/fatty-lumpkin-presentation-tool/docs/research/finals-study.md`.
  - **What to do:** `references/wrapper-and-extras.md`.
- **The master survives.** He used 97–100 % of it. Hand trims fell from 31 s (Ep 1) to almost nothing after `tighten.py`, so tightening is now a default delivery step.
- **He punctuates rather than re-cuts:**
  - reaction cutaways from his own library (0–10 per episode)
  - our clip slots as small picture-in-picture (so always give inset rectangles)
  - character interruptions and a heckler stinger
  - B-roll that pays off a script line (two 10 s Higgsfield shots, 240 credits)
  - transitions only at seams, music in patches
- **Levels were the hidden chore.** Our master is −13.8 LUFS, but the extras arrived at about −16 (shorts), −21 (cutaways), −20 (stingers) and −31 (screen recordings).
  - He made 18 hand boosts of up to +17 dB, and the exports peaked at +0.4 to +1.2 dBTP.
  - `scripts/video/loudmatch.py` (−14 LUFS / −1 dBTP; beds at −26 and −16) fixes this at the source.
  - **Gotcha:** ffmpeg's built-in AAC encoder overshot to +1.8 dBTP after `atempo`. Apple's `aac_at`, or `-cutoff 18000`, stays at about −1.
- **The Slack pack** is one recipe: x264 medium CRF 22, maxrate 5M / bufsize 10M, AAC 192 kbps 48 kHz, plus a 1.25x cut (`setpts=PTS/1.25,fps=30` + `atempo=1.25`), an MP3 and a cover. It's now `scripts/video/slack_pack.py`.
- **The extras cost far more than the presentation.** The Cinema shorts and pickups came to roughly 125,000 OpenArt credits, against about 30 US dollars of HeyGen per episode.
  - **Michael's call for a general tool (FLPT):** default to Kie.ai and Higgsfield, with OpenArt as an opt-in "film quality" upgrade.
  - Price the wrapper piece by piece in the spend gate.
