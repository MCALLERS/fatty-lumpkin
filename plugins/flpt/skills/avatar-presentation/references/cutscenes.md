# Cut scenes: Higgsfield + Seedance 2.5

Researched 2026-09-27 with free, read-only Higgsfield MCP calls (`models_explore`, `balance`, `get_workflow_instructions`) and the user's cinema-director, storyboard-to-screen and ai-cinema skills. **No generation was run.**

## When to use one

- **One or two per video, about 20 s each.** A cut scene is a treat. A third one stops being special and costs about as much as the whole avatar render.
- **It dramatizes a story beat the slides can only state:**
  - the stakes ("what happens if we get this wrong")
  - a scenario or day-in-the-life
  - a metaphor made literal
  - a before and after
  - the "turn" of the talk
- **It never carries data.** Numbers, charts and claims stay on slides, where they can be checked.
- **Good slots:**
  1. **Cold open or hook,** before slide 1 or right after the title.
  2. **The turn,** where the talk pivots from problem to answer.
  3. **The close,** the image people leave with, just before the call to action.
- Never put one in the middle of an argument. It breaks the chain of reasoning the colleagues are following.
- **Treat it as a chapter break.** The avatar hands off into it ("picture this…") and picks up after it.

## Seedance 2.5 on Higgsfield (from `models_explore get seedance_2_5`)

| Property | Value |
|---|---|
| Model ID | `seedance_2_5` |
| Modes (`mode`) | `t2v` (default), `omni_reference` (image, video or audio refs), `video_edit` (billed by the source video's length), `video_extension` (requires `extension_mode`: `forward` or `backward`) |
| Duration | **4–30 s in one generation** (default 5). A 20 s scene fits in one pass. |
| Resolution | `480p`, `720p` (default), `1080p` |
| Aspect ratios | `auto`, `21:9`, `16:9`, `4:3`, `1:1`, `3:4`, `9:16` |
| Audio | `generate_audio` (default `true`), native: dialogue, ambience, foley |
| Media roles | `start_image`, `end_image`, `image_references`, `video_references`, `audio_references` |
| Other | `bitrate_mode`: `standard` or `high` |
| Frame rate | 24 fps native (per the Media MCP description; not shown in the Higgsfield schema) |

- **Credits (Higgsfield's blog, 10 s examples):** about 3 cr/s at 480p (30 cr / 10 s), about 7 cr/s at 720p (70 cr / 10 s), about 12 cr/s at 1080p (120 cr / 10 s). The 720p rate matches what the user measured on 25 Sept (7 cr/s). The blog prices credits at $0.05 each; the real rate depends on the plan.
- **Balance** on 27 Sept: 7,025 credits, Ultra plan.
- **Exact quotes are unverified.** The `get_cost:true` preflight was blocked by this session's permission classifier. Run it, with the user's OK, before the first real spend.

**Alternatives in the same catalog:**
- `kling3_0`: 3–15 s, multi-shot, start and end frames, 16:9, 9:16, 1:1.
- `cinematic_studio_3_0`: 4–15 s, up to 4k, `genre` hint, audio off by default.
- `seedance_2_0`: 4–15 s, up to 4k, `genre`.

Seedance 2.5 is the only one that does 20 s in a single pass with omni references.

## The grill-me question bank

Run it with the `grill-me` method: ask in rounds, only the questions whose prerequisites are settled, each with a recommended answer. Research facts yourself (deck, script, slide numbers); ask the user only for decisions.

**Round 1: purpose**
1. **Which story beat?** Offer the 2–3 candidate slots from the talk arc (hook, turn, close) and the line of script each would replace or follow. *Recommend* the slot where the talk currently says the most abstract thing.
2. **What should the viewer feel in the last second?** Unease, relief, wonder, urgency, recognition, amusement. One word. *Recommend* the emotion the next slide needs to land.
3. **Literal or metaphor?** A realistic scenario (a lawyer at 2 a.m. with a stack of redlines) or a visual metaphor (a paper tide rising in an office). *Recommend* the literal version for a colleague audience, unless the talk already leans on a metaphor.

**Round 2: world (after the beat and emotion are settled)**
4. **Setting.** Where, when, time of day, weather, era. Name one physical place.
5. **Characters.** Nobody, an anonymous figure, a fictional character with a visible face (fine; faces may be featured), a recurring fictional character, or **the user themselves**. The user said they may appear as a character. Always ask; never assume. If it's the user, go to the likeness rules below.
6. **Visual motif.** One object, colour or light that recurs, ideally also used in the deck's design: the talk's accent colour, a prop from the title slide, a shape from a diagram. *Recommend* the deck accent colour as practical light in the scene.
7. **Look.** Cinema capture (24 fps, anamorphic, grain) or phone/documentary capture. *Recommend* cinema for the signature style.

**Round 3: sound and bridges**
8. **Sound.** Diegetic only (house rule: no music in the generation), a music bed added at the edit, and whether the user's voice speaks over it (a short VO line in their Gemini voice, laid in at the edit). Dialogue lines are the user's to write.
9. **Bridge in.** What the avatar says or shows just before. A spoken hand-off, a match cut from a slide shape or colour to the first frame, or a hard cut to black.
10. **Bridge out.** The last frame's composition, and how it lands on the next slide: a match on colour or shape, a slide that answers the scene's question, or the avatar saying "…and that's the problem."

**Round 4: production**
11. **Shot plan.** One continuous take or 2–4 shots, and single-pass or stitched (see below).
12. **Budget and resolution.** Draft at 480p or 720p, final at 1080p. State the credit estimate and get a yes.
13. **Approvals.** Storyboard, then start frames, then video. The user approves each gate before any video spend.

## Production steps

Higgsfield MCP tools are `mcp__<your Higgsfield server>__<name>`, loaded with ToolSearch `"higgsfield"`. Every generate call puts its fields inside `params`.

### 0. Budget
- `balance` (free).
- Estimate with the rates above.
- With the user's OK, run `generate_video` with `params:{…, get_cost:true}` to preflight the exact quote. It submits no job, but this environment's permission classifier may ask first.
- The ai-cinema rule applies: quote and wait for a yes before any video spend.

### 1. Storyboard: 2–4 shots, about 20 s (Claude drafts, the user approves)
- Follow storyboard-to-screen step 1:
  - one table row per shot: `# · time · size/camera · action`
  - shots of 5–8 s, one beat each
  - vary shot sizes (establishing wide → medium → insert → close)
- Save to `presentation/cutscenes/<ID>/storyboard.md`.
- A 20 s scene is 3 shots of about 6–7 s, or 2 continuous takes of 10 s.
- House default from ai-cinema: prefer **one continuous shot** that moves through the scene, and cut only when the scene really needs a second vantage.

### 2. References
- **Location plate:** an empty world plate, no people. Use banana-pro-director-30 Mode 3 → `generate_image` `{model:"nano_banana_pro", resolution:"2k", aspect_ratio:"16:9", prompt}`.
- **Recurring fictional character:** use character-builder for a face lock on 18% gray, then an outfit sheet, and reuse the Higgsfield **job ID** as `image_references`. Job IDs work as refs with no re-upload.
- **Local files** (a slide PNG to match-cut from, or the user's photo): `media_upload` → PUT the bytes → `media_confirm` gives a `media_id`.
- `show_reference_elements` now lists a `create` action. storyboard-to-screen says the MCP can't create elements; that note predates this tool. Untested.

### 3. Start frames: one per shot (Claude)
- `generate_image` `{model:"nano_banana_pro", resolution:"2k", aspect_ratio:"16:9", medias:[{role:"image_references", value:<plate>}, {role:"image_references", value:<character lock>}], prompt:<exact first-frame composition + house look + "no legible text">}` (about 2 cr each).
- For a match cut in, compose frame 1 to echo the slide before it: same colour field, same shape position.
- Make a contact sheet with ffmpeg hstack/vstack → `presentation/cutscenes/<ID>/board.jpg`. **The user approves it before any video spend.**

### 4. Prompts
- Use **cinema-director** for the grammar:
  - shot header
  - CAPTURE CADENCE
  - NO ON-SCREEN TEXT (critical; the talk's own captions must not collide)
  - Subject Locks (no character names; wardrobe restated)
  - World Plate
  - Atmosphere
  - timecoded SHOT blocks
  - Cross-Frame Rules
  - Last Frame (write it to set up the bridge out)
  - Sound Bed ("No music…")
  - Camera & Capture Realism
- cinema-director caps a single prompt at 15 s. Seedance 2.5 can do 30 s, but that rule predates 2.5. Keep it for stitched takes. For a single 20 s pass, state the exception in one line.
- For a stitched shot, the short storyboard-to-screen template is enough: "Start from the reference frame. One continuous shot, N seconds, …".

### 5. Animate: stitched shots (default) or single pass

**A. Stitched shots (default).** This is the house workflow, proven on FIRST DAY. A bad beat costs one reshoot, and the start frames carry the consistency.
```
generate_video {params:{model:"seedance_2_5", mode:"omni_reference", duration:7, resolution:"720p", aspect_ratio:"16:9",
  generate_audio:true, medias:[{role:"start_image", value:<frame job id>}, {role:"image_references", value:<lock>}], prompt:<shot prompt>}}
```
- Run one call per shot, or `generate_video_batch` for all shots at once, then `jobs_wait`.
- Continuity between takes has three options:
  1. Chain with the last frame: ffmpeg-extract the final frame, `media_upload` it, and pass it as the next take's `start_image`.
  2. Use `mode:"video_extension", extension_mode:"forward"` on take 1.
  3. Use `end_image` to land a shot on an exact composition, such as the frame that match-cuts to the next slide.

**B. Single pass, 20 s multi-shot.** Seedance 2.5 organizes setup → turn → resolution inside one generation. Use it when the scene is one continuous camera move, or when you accept re-rolling all 20 s for one bad beat.
- Test the prompt at 480p first (about 60 cr), then run the final at 1080p (about 240 cr).
- **The 1080p final is a new roll, not an upscale of the draft.** To keep an exact 720p take, upscale it instead with `upscale_video {params:{provider:"topaz", video_id:<job>, resolution:"1080p"}}`. Upscales have no cost preflight.

**Gotchas from storyboard-to-screen:**
- Higgsfield may intercept with a preset suggestion; resubmit with `declined_preset_id`.
- Poll with `show_generations` if `jobs_wait` or `show_generation_by_ids` reject arrays from this client.
- Download from `results.rawUrl`.

**Model defaults:** draft at 480p or 720p, final at 1080p. Keep `generate_audio:true` for foley and ambience, with "No music" in the Sound Bed.

### 6. The user's own likeness (and any recurring person)
- **The user may cast themselves** in a cut scene (said 2026-09-27). It's their call per video. Match the look to their locked HeyGen presenter look so the bubble and the scene read as the same person, and try route 2 first.
- **Only the user's own face,** or people who have given explicit written consent. Never colleagues, clients, public figures, or look-alikes of real people.
- **Nothing the user wouldn't say or do on camera.** The user approves every line and action involving their likeness. Their dialogue is theirs to write (ai-cinema standing rule 1).
- **Disclose it.** The player page already carries the AI-presenter disclosure; extend it to say "includes AI-generated scenes."
- **Routes, safest first:**
  1. **Keep the face out:** back of head, silhouette, hands, over-the-shoulder, reflections. This is no longer the default (faces may be featured since 2026-09-27), but it's still the cheapest route when the user *isn't* in the scene and a face adds nothing.
  2. **HeyGen Cinematic Avatar** (`type:"cinematic_avatar"`, Seedance-backed): 1–3 of the user's HeyGen look IDs as identity refs, 4–15 s, 720p or 1080p, 16:9. It reuses the twin's verified HeyGen consent. Two takes of 10 s cover 20 s. Billed in HeyGen credits. See `heygen-consistency.md`.
  3. **Higgsfield with the user's photos as `image_references`.** Higgsfield's upload terms require that you hold the rights, and your own likeness qualifies. There is precedent: the user's face was locked for the Kuroda character on Higgsfield. **Untested:** whether `seedance_2_5` on Higgsfield accepts a real-face reference. ByteDance's own Seedance 2.0 spec refuses real faces, and third-party reports say Higgsfield gates this behind "Face Eligibility" verification. Test once at 480p.
  4. **Fallback:** the Media MCP routes human-likeness jobs to Kie. Use it only if the user asks.
- **For a recurring fictional character across videos,** keep one face lock and one outfit sheet in a talk-series library, and restate the Subject Lock every time.

### 7. Conform and deliver
- **Cut.** Use the storyboard-to-screen stitch rules: filter concat, pad or trim each clip's audio to its picture, force `-ar 48000`, and never `-f concat -c copy` with AAC, which drifts about 40 ms per join. Add the music bed at the edit.
- **Output spec for the compositor:** 1920×1080, 24 or 30 fps matching the talk's master timeline, H.264 (yuv420p) plus AAC 48 kHz stereo.
- **Save to** `presentation/media/cutscene_<ID>.mp4`. The `presentation/media.json` mapping format is owned by the compositor work; don't define it here.
- Example conform. Higgsfield 1080p may arrive as 10-bit or HEVC, so always re-encode:
  ```bash
  ffmpeg -i cut_raw.mp4 -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p" \
    -c:v libx264 -preset slow -crf 18 -profile:v high -c:a aac -b:a 192k -ar 48000 -ac 2 -movflags +faststart \
    presentation/media/cutscene_<ID>.mp4
  ```
  Use `fps=24` if the talk master is 24. HeyGen avatar clips come out at 25 fps, so the compositor resamples everything to one rate anyway.
- Keep the prompts verbatim, plus the job IDs and approved frames, in `presentation/cutscenes/<ID>/`.
- **Stitch 3 shots into one scene (used on Latham v2).** Seedance returns 24 fps with 32 kHz audio that can be very quiet. Normalise the room tone so it sits well under the narration:
  ```bash
  # per shot i: [i:v]fps=30,scale=1920:1080:flags=lanczos,setsar=1,format=yuv420p,trim=0:D,setpts=PTS-STARTPTS[vi];
  #             [i:a]aresample=48000,apad,atrim=0:D,asetpts=PTS-STARTPTS,afade=t=in:d=0.04,afade=t=out:st=D-0.04:d=0.04[ai];
  # then: [v0][a0][v1][a1][v2][a2]concat=n=3:v=1:a=1[v][ac];[ac]loudnorm=I=-26:TP=-3:LRA=11[a]
  ```
- **Music bed (at the edit, cut scenes only).**
  - Generate one ~21 s instrumental cue per scene with the ElevenLabs Music API, using the key already in `keys.env`:
    - `POST https://api.elevenlabs.io/v1/music?output_format=mp3_44100_192`, body `{"prompt": "...", "music_length_ms": 21000}`. It costs a few cents of credits; state that and get a yes.
    - Prompts that worked: *"Dark, minimal, modern tech-thriller. Near-silent sub drone, a slow soft synth pulse from ~7 s, a restrained swell at ~16 s, then decay. No drums, no vocals."* and *"Late-night office at 2 a.m. Sparse felt piano, a low sustained cello note, a single held chord of quiet resolve near the end. No drums, no vocals."*
  - Mix it: music `loudnorm I=-25:TP=-4` with a 1 s fade in and a 1.8 s fade out, then `amix` (normalize=0) with the room tone, then `loudnorm I=-21:TP=-2`.
  - Keep the no-music masters in `cutscenes/conformed_nomusic/`.

## Cost and time per 20 s cut scene

| Step | Credits (estimate) |
|---|---|
| Location plate + 3 start frames (NBP 2k) | about 8 |
| Draft pass, 3 shots × 7 s at 480p (or one 20 s pass) | about 60 |
| Final, 3 × 7 s at 1080p | about 250 |
| One or two re-rolls of a missed shot at 1080p | about 85–170 |
| **Total** | **about 400 credits (range 320–500)** |

- **In dollars:** about $20 at the blog's $0.05 per credit. The user's actual Ultra rate may be lower.
- **Two cut scenes:** about 800 credits, 11% of the current balance.
- **Wall time:** 1.5–3 hours including the three approval gates. Generation time per clip on Higgsfield has not been measured (expect minutes, not seconds). Grilling takes about 15 minutes.
- **A cheaper draft path:** 720p finals plus a Topaz 1080p upscale, if the upscale cost proves low.

## Sources

- Higgsfield MCP `models_explore` (seedance_2_5, kling3_0, cinematic_studio_3_0, nano_banana_pro schemas), read 2026-09-27
- Seedance 2.5 pricing (Higgsfield blog): https://higgsfield.ai/blog/seedance-2-5-pricing-2026
- Seedance 2.5 on Higgsfield (10 s credit examples): https://higgsfield.ai/blog/seedance-2-5-on-higgsfield-2026
- ByteDance Seedance 2.5 announcement (30 s one-take, multi-shot, references): https://seed.bytedance.com/en/blog/one-take-creation-flexible-referencing-introducing-seedance-2-5
- Seedance face policy and Higgsfield "Face Eligibility" (third-party): https://ruoqijin.com/blog/seedance-access-and-face-policy
- HeyGen Cinematic Avatar: https://developers.heygen.com/cinematic-avatar
- Local skills: `~/.claude/skills/cinema-director/SKILL.md`, `~/.claude/skills/storyboard-to-screen/SKILL.md`, `~/.claude/skills/ai-cinema/SKILL.md`

## Pattern: "the reload" (counterfactual cut scene), proven 2026-09-29
- Shot 1 (choice A) and shot 3 (choice B) start from **the same start frame**: the same moment, a different move. Shot 2 (A's consequence) starts from shot 1's **last frame**, uploaded with `media_upload` (the presigned PUT needs `-H "If-None-Match: *"`).
- In the edit: 1 → 2 → a 1.5 s tape rewind of (end of 1 + all of 2) → 3. See games-gtm `presentation/cutscenes/conform.sh` (`reverse`, `setpts`, `tmix`, `areverse`, `asetrate`) and `mix_music.sh` (a tension cue, silence under the rewind, then a calm cue).

## Learnings from *The Shadow of the Future* (2026-10-06: seven scenes, 1,312 credits)
- **Look at every start frame at full size.** Nano Banana Pro often bakes in a black border: measure the edges, crop to 16:9 and upload the crop. It also adds real logos or readable labels to devices; a 2-credit "no logo" edit fixes that.
- **Start and end frames made as edits of each other** gave the best motion control, for example a ticker wall turning from green to red, or a square being drawn and then divided.
- **Submit video jobs one at a time.** `generate_video_batch` timed out when `start_image` was an uploaded frame, but single `generate_video` calls worked.
- **Preset suggestions block preflights.** Once a preset is offered (such as "IN THE DARK"), pass `declined_preset_id`.
- **Renders took 10–40 minutes** under a shared load, so start the cut scenes first.
- **Loudness:** a two-pass `loudnorm` holds −21 LUFS. A single pass drifted between −20.2 and −22.4.
- **Real footage can open a scene.** Talk 2's "evening gun" opened on 3.5 s of the public-domain Somme howitzer film, graded to match, with a blast sound made locally because the film is silent. Check any archival clip for intertitles first.
- **On-screen text without `drawtext`:** render the line as a transparent PNG in headless Chrome (local Source Serif 4), then overlay it with ffmpeg and fade its alpha in and out.
- **Clip-slot placeholders.** When the user may drop in a real film moment, make the placeholder:
  - exactly the slot's length
  - beautiful but simple, with no imagery from the film
  - with the quote set in serif and credited
- **Rebuild kit:** keep each scene's prompts, `jobs.json`, frames, raw clips and a no-music master. A `conform.py <scene>` script rebuilds a scene, or remixes only its audio with `--mix-only`.

## Learnings from *Cut 'Em Up* (2026-10-07: two scenes, 352 credits)
- **A bookend's music:** generate it in the same ElevenLabs cue as the cold open's, then cut the cue apart. The bookend gets a true motif callback, in the same key.
- **Short sounds at the start:** the pipeline's 0.6 s fade-in eats anything in a scene's first 0.6 s, such as a truck's reverse beeper. Extend it locally.
- **Check the hands in every image edit.** One edit dropped the mug and added a second ball.
- **Trim after loudnorm:** the final two-pass loudnorm adds about 0.1 s of audio, so trim it back to the picture.
- **Hand the still over early:** save the approved end frame as a still for the animators as soon as it's approved. Slides 1 and 11 used it as a polaroid long before the video was finished.
