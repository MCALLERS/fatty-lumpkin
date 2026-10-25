# Stage 4: Video and player page

The pipeline lives in `presentation/video/` (copied by `scripts/scaffold.py`). The user-facing guide is `presentation/video/SETUP.md`.

## 0. Free draft first

```bash
cd presentation/video
python3 render_slides.py
python3 generate_presentation_video.py --draft          # Mac `say` voice + placeholder bubble, offline
python3 generate_presentation_video.py --draft --web    # web parts FROM the draft (render the draft first)
```

Then build the player page and publish it, so the user has the link early:

1. Edit `presentation/player/player_config.json`: `page_title` (2–4 words), `title`, `eyebrow`, `subtitle`, and `deck_url`. The first run of `build_player.py` creates it with placeholders.
2. Run `python3 presentation/player/build_player.py`.
3. Publish with `Artifact`:
   - `file_path` = `presentation/player/index.html`
   - `root` = `presentation/player`
   - `files` = `media/part_*.mp4` and `media/poster.jpg`
   - `icon` = `video` on the first publish only
4. Tell the user that artifacts are private until shared from the page's Share menu.

The page shows a "Draft preview" notice while `parts.json` says draft, and an AI-presenter disclosure once it's final.

## 1. Settings: profile, keys, project

Settings merge in this order, with later non-blank values winning:
1. `~/.config/avatar-presentation/presenter.env`: the signature presenter (look, voice, engine, bubble). Set it once.
2. `~/.config/avatar-presentation/keys.env`: API keys (chmod 600), shared by every project.
3. `presentation/video/api_keys.txt`: overrides for this project only.

`.venv/bin/python generate_presentation_video.py --profile show` prints the merged values, with keys masked and the source of each one.

```bash
open presentation/video/RUN_ME.command               # first run: makes .venv
python3 presentation/video/set_keys.py --global      # hidden-input dialogs → keys.env (heygen, elevenlabs, gemini)
```

After writing `api_keys.txt`, never re-open it in TextEdit; a stale TextEdit window can overwrite it. Change values with small Python `re.sub` edits, and print only masked keys.

## 2. The user picks the avatar and voice

```bash
.venv/bin/python heygen_picker.py looks                  # numbered contact sheet → output/picker/looks.png
.venv/bin/python heygen_picker.py voices --sample-slide 12   # private voices + a short sample each (pennies)
.venv/bin/python heygen_picker.py frame 24               # gridded still of the chosen look, for framing
```

Send the sheet and samples with `SendUserFile` and ask the user by number. Then **immediately resolve the number to its look ID** from `output/picker/looks.json` and store the ID. Numbers shift whenever the user adds looks or voices in HeyGen (27 looks became 31 overnight in the first run). Then write these to `api_keys.txt`:

```
TTS_PROVIDER=heygen                  # or elevenlabs (ELEVENLABS_VOICE_ID = their clone)
HEYGEN_VOICE_ID=<chosen voice>
HEYGEN_AVATAR_ID=<chosen look id>
HEYGEN_CHARACTER_TYPE=talking_photo  # photo-avatar look; `avatar` for a Digital Twin
HEYGEN_ENGINE=avatar_iv              # avatar_iii = cheaper/faster twin; check supported engines in --check
BUBBLE_POSITION=bottom-left          # bottom-left | bottom-right | top-left | top-right
BUBBLE_SHAPE=circle                  # circle | rounded (Loom-style rounded square)
BUBBLE_ZOOM=1.6                      # head ≈ 55% of the crop height
BUBBLE_FOCUS_X=0.50                  # face centre, as a fraction of width
BUBBLE_FOCUS_Y=0.32                  # face-and-shoulders centre, as a fraction of height
HEYGEN_MAX_CONCURRENT=8
```

**ElevenLabs instead.** Create an Instant Voice Clone through the API (`POST /v1/voices/add`, multipart `files`) from a clean 1–3 minute recording that the user has confirmed is them. Check `GET /v1/user/subscription` first (`can_use_instant_voice_cloning`, remaining characters).

## 2b. Voice engine options (`references/voice-options.md`)

- `TTS_PROVIDER=heygen`: the voice linked to the user's HeyGen looks. Pauses only.
- `TTS_PROVIDER=gemini`: the user's Gemini 3.8 clone (`GEMINI_VOICE=voice_…`, `GEMINI_TTS_MODEL=gemini-3.8-flash-tts`). Most expressive tags; about $0.23 a talk. The audio drives HeyGen's lip-sync.
- `TTS_PROVIDER=elevenlabs`: an ElevenLabs clone.

Before switching a presenter's voice, run a one-slide A/B test, and store the winner in `presenter.env`.

## 2c. Video slides and cut scenes: `presentation/media.json`

See `presentation/video/media.example.json` and SETUP.md for the full schema. In short:
- `"slides": {"5": {"video": "media/slide_05.mp4", "fit": "cover", "pad": "freeze", "audio": "mute"}}` replaces slide 5's PNG with a video (a HyperFrames render, motion graphics, B-roll). The bubble still overlays it.
- `"cutscenes": [{"id": "A", "after_slide": 7, "title": "…", "video": "media/cutscene_A.mp4", "audio": "keep", "fade": 0.6}]` plays full screen with no bubble and fades through black on both sides. A `## CUTSCENE A — Title` heading in script.md is equivalent, and text under it becomes optional voiceover.
- `"slides": {"11": {"video": "media/slide_11.mp4", "bubble": false}}` keeps the slide narrated but **hides the presenter**: no HeyGen clip is made or billed, and the bubble fades out and back in (0.4 s) on the neighbouring slides. Use it for documentary-style segments such as the Cosmos-style cartoons (added 2026-10-06; `{"bubble": false}` alone, with no video, also works).

In `--draft`, missing media shows as a titled placeholder card, so timing can be previewed before anything is generated.

**Cost trap:** adding a cut scene next to a slide that's already rendered changes that slide's lead or tail and re-bills its clip. Plan cut scenes before the full paid run.

## 3. Check, test one slide, then run everything

```bash
.venv/bin/python generate_presentation_video.py --check                  # free: keys, IDs, wallet, estimate
.venv/bin/python generate_presentation_video.py --final --slides 12 --yes # only after the user says yes to ~$1
```

1. **Test:** after the one-slide render, `mv output/presentation_slides_12-12.mp4 output/tests/…`.
   - Crop the bubble from a few frames to check the framing. Re-framing is free, because clips are cached.
   - Send the clip to the user.
   - Compare the wallet before and after to learn the real rate.
2. **Full run:** only on an explicit yes with the number stated. Run it in the background: `--final --yes > output/full_run.log 2>&1`.
3. **Screen every new take's pitch** as soon as the narration WAVs land (before animators align to them):
   `python3 scripts/video/pitch_screen.py cache/audio/heygen/<id>.wav …` (needs numpy; exit 1 if anything is flagged).
   - It uses YIN on clearly voiced frames only. It flagged Part 5's octave-jump take at 213 Hz, and passed the one-word
     "Yes." / "not tell." tails the old autocorrelation screen cried wolf on.
   - Fix a real flag by changing the text slightly (e.g. add `[short pause]`): HeyGen's voice is deterministic per text.
4. **Resuming:** runs pick up where they stopped. Finished clips are never billed twice, and slides without a clip get a still bubble (exit code 3).
5. **After the run:** `--web`, then `build_player.py`, then republish the player page with the same `file_path`, so the URL stays the same.

## Editing later

Change a slide's text in `script.md`, then run `--final --slides N --yes`. Only that slide is re-voiced and re-rendered. Rebuild the full video with a plain `--final` (everything else comes from cache), then run `--web`, `build_player.py`, and republish.

## Gotchas learned

- **API version.** HeyGen's v1/v2 API retires after Oct 31 2026; v3 is the default.
- **Private voices** are listed with `GET /v3/voices?type=private` (the `ownership` parameter returns stock voices). Speech comes from `POST /v3/voices/speech`.
- **Render time.** A Digital Twin on Avatar IV took about 20 minutes to render a 24-second clip, and Avatar III about 3 minutes. Photo looks rendered faster in bulk: 20 clips in about 23 minutes at a concurrency of 8.
- **Framing.** The twin footage may frame the face low; photo looks usually put it in the top third. Always check with `frame`.
- **Artifact file limits.** Each binary is limited to 15 MB, so web parts stay under 14 MB. Publish them as supporting `files`; no capabilities are needed.
- **ffmpeg without `drawtext`.** Make labeled sheets as HTML and screenshot them with headless Chrome.
- **`--draft --web`** means web parts made from the draft. It doesn't render one.

## Editing master for CapCut and other editors (always delivered)
- **What `--final` also writes:** `output/<name>_for_editing.mov`. It has H.264 with no B-frames at constant 30 fps, PCM audio, **no MP4 edit lists**, and the voice +`EDIT_NUDGE_MS` (default 20). It's about 35 MB per minute.
- **Commands:**
  - `--edit-master` remakes it from an existing final without rendering.
  - `--no-edit-master` skips it.
  - `scripts/video/make_edit_master.sh` is the same thing as a shell script.
- **Why:**
  - The web MP4's edit lists (video +66.7 ms, audio +21.3 ms) are applied by browsers but not by CapCut, so the voice looks late or early by a frame or two.
  - The master's own voice-to-lips offset measured 15–25 ms early. After the nudge it's ±5 ms, checked by cross-correlating the final audio with the cached HeyGen clip audio.
  - If a future voice or engine measures differently, set `EDIT_NUDGE_MS` in presenter.env.
- **If the user says the lips look off in CapCut:**
  - Measure before changing anything: `python3 scripts/video/measure_av_sync.py <talk dir>` (needs numpy).
  - On 2026-10-07 all five Shadow talks measured −3 ms (.mov) and −23 ms (.mp4), so the files were right.
  - The usual culprits in CapCut:
    - the `.mp4` placed instead of the `.mov`
    - preview lag on a large 1080p file (check an export; turn on proxy or lower the preview quality)
    - a project frame rate other than 30 fps
    - audio unlinked and moved during the edit


## Clip slots (copyrighted moments the user drops in)
- **In the script,** mark a slot in a stage note (`CLIP SLOT` or `Optional clip slot`). Give the source, the in and out points, and what ships without the clip.
- **Ship a placeholder of exactly the slot's length:**
  - for a cut scene, a generated scene with the quote set in serif
  - for an inset inside a slide, a public-domain stand-in or a clean rectangle
- **After the final render, write `CAPCUT_CLIP_GUIDE.md`.** Per slot, give:
  - the in and out timecodes, from `presentation.timeline.json` plus the beat cue times
  - keep or mute the clip's sound: mute it wherever the narration runs
  - for an inset, the rectangle in pixels and the scale
- **Disclosure:** set `media_note` in `player/player_config.json` when the video has AI cartoons or archival footage. It replaces the default sentence that only covers cut scenes.

## Tightening a finished video (over-long pauses, unwanted laughs)
Use this when the user says some silences run "a bit too long", or wants laughs cut, after filming. It's free: nothing is re-voiced.
1. **Transcribe the finished narration.** Run ElevenLabs Scribe on the mp4's audio, with word timestamps and `tag_audio_events=true` so laughs are tagged. Save the JSON as `output/tighten/scribe.json`. It costs cents.
2. **Find each laugh's edges** with the loudness envelope (in 50 ms bins: words, silence, the laugh's bursts, a breath, silence). Cut the bursts, plus enough silence to leave a sentence gap of about 0.5–0.65 s.
3. **Plan, then apply:** `python3 scripts/video/tighten.py <talk dir> [--laughs a-b,…] [--hold t=secs,…]`, then the same with `--apply` (needs numpy). It works like this:
   - **Holds:** check the plan against the script's `[long pause]` tags. A scripted beat ("Could someone… one-prompt Interval? [long pause]") would otherwise shrink like dead air, and to only 0.6 s if Scribe dropped the "?". `--hold t=1.2` keeps the pause containing master time t at 1.2 s (2026-10-12, Part 5 v2).
   - **Pauses inside a slide:** over 1.1 s shrink to 0.75 s at a sentence end or a "Hmm.", and to 0.6 s mid-sentence.
   - **Pauses across slides:** shrink to 1.0 s.
   - **Never cut** in cut scenes, a slide's first 0.4 s (the crossfade) or its last frame.
   - **Frame snapping:** cuts snap to whole frames, so picture and sound drop the same time.
   - **Placement:** each cut slides to where the slide (not the bubble) changes least. Over moving footage it's shortened, or skipped if it would show. A required cut over motion (a laugh) gets a 0.2 s video-and-audio dissolve.
   - **Outputs:** it keeps the originals as `*_uncut.*` and rewrites the timeline, so chapters stay right.
4. **Rebuild** with `--edit-master`, then `--web`, then `build_player.py`, then republish. Re-map any clip-slot timecodes in the CapCut guide.

On 2026-10-08, Shadow Parts 2–4 lost 27, 30 and 23 s (about 3.5%) and three laughs. Words after the cuts sat within 0.3 ms of their predicted spots.

## After delivery: levels, extras and the Slack pack (2026-10-12)
- **What ships, and where:** `references/delivery.md`.
- **Extras:** level them to the master before handing them over: `python3 scripts/video/loudmatch.py <files/folders> --out <folder>` (−14 LUFS, −1 dBTP; `--bed` for music beds).
- **The Slack pack:** after the user's own final export, run `python3 scripts/video/slack_pack.py "<final>.mp4" --verify`. It makes the (vF), the 1.25x cut, the MP3 and the cover.
- **The user's CapCut edit:** for the retro, read it with `scripts/edit/capcut_study.py`.
