# Your AI-presenter video: setup

This folder turns the slide deck and `script.md` into a narrated video. The slides fill the screen, and a small "you" in a corner (bottom-left by default, round or a rounded square) speaks the script in your own voice.

- **Voice:** an ElevenLabs voice clone (the default), a HeyGen voice of yours (`TTS_PROVIDER=heygen`), or Gemini TTS, including a Gemini voice clone (`TTS_PROVIDER=gemini`).
- **Face:** your HeyGen Digital Twin or one of your HeyGen photo-avatar "looks", lip-synced to that exact audio.
- **Extras:** slides can play a video instead of a still, and full-screen cut scenes can play between slides. See [Video slides and cut scenes](#video-slides-and-cut-scenes-mediajson).
- **Same presenter everywhere:** keep your voice, look and bubble settings in one presenter profile, so every project inherits them. See [Presenter profile](#presenter-profile-same-avatar-in-every-project).

**Fastest path if you already have a HeyGen avatar and voice:**
1. Save your keys: `python3 set_keys.py`. This opens hidden-input dialogs, so nothing is pasted into a chat.
2. See your looks and voices: `.venv/bin/python heygen_picker.py looks`, then `... voices --sample-slide 1`. Pick by number and by ear.
3. Put the IDs in your presenter profile, `~/.config/avatar-presentation/presenter.env`, so every project uses them: `HEYGEN_AVATAR_ID`, `HEYGEN_CHARACTER_TYPE`, `TTS_PROVIDER=heygen` and `HEYGEN_VOICE_ID`. They can go in this project's `api_keys.txt` instead.
4. Test one short slide, then do the full run.

Nothing is charged until you answer **y** to "Proceed with paid generation?".

---

## 0. Free preview first (no accounts needed)

Double-click **`DRAFT.command`**. It renders the slides and makes `output/draft_presentation.mp4`, using the Mac's built-in voice and a placeholder circle. Watch it to check:

- the slide order,
- the timing,
- that the script and the slides line up.

If you'd like your photo in the draft circle, save a headshot here as `presenter.jpg`.

> **Tip:** the draft voice sounds much better with a "Premium" Mac voice. Go to System Settings → Accessibility → Spoken Content → System Voice → Manage Voices, and download e.g. *Ava (Premium)*. The draft picks it up automatically.

## 1. ElevenLabs: clone your voice

1. **Choose a plan.** Sign up at elevenlabs.io. An **Instant Voice Clone** needs the **Starter** plan or higher. The pricing page listed Starter at $6/month with 30,000 credits on 26 Sep 2026.
2. **Record 1–2 minutes** of yourself reading naturally.
   - Use a quiet room and one microphone.
   - Have no music or other voices in the background.
   - Speak at your presenting pace. ElevenLabs advises against going over about 3 minutes.
3. **Create the clone.** In ElevenLabs, go to **Voices → Create/Add a voice → Instant Voice Clone**. Upload the recording and confirm you have the right to clone the voice.
   - *Professional Voice Clone* is optional and more lifelike. It needs the **Creator** plan or higher and at least 30 minutes of audio. It also involves a short verification recording and takes a few hours to train.
4. **Get an API key.** Go to **Developers → API Keys → Create**. Keys are restricted by default: allow **Text to Speech** and **Voices (read)**, and **User (read)** so the check can show your remaining credits. The full key is shown only once, so paste it into `api_keys.txt` straight away.
5. **Find your voice ID** after step 3 below: run `--list-voices` (see "Commands"). Your clone is marked `← your clone`.

## 2. HeyGen: create your Digital Twin

1. **Start a Digital Twin.** Sign up at heygen.com, then go to **Avatars → Create → Digital Twin**. HeyGen's help pages said on 26 Sep 2026 that free accounts include one Digital Twin slot.
2. **Record 2–5 minutes of video** of yourself talking.
   - Record at 1080p/30fps or better.
   - Face the camera and look into the lens.
   - Use a plain background that doesn't move.
   - Keep your hands away from your face.
   - Pause naturally now and then; this teaches the avatar how to "idle".
3. **Record the consent clip.** HeyGen also asks for a short **consent video**: you, on camera, saying you agree to the avatar being made. Processing takes roughly 10–20 minutes.
4. **Set up API access.** In HeyGen, go to **Settings → API**, copy your **API token**, and add credit. The token is shown only when generated, so paste it into `api_keys.txt` straight away.
   - The API is billed **separately** from any HeyGen web subscription, as pay-as-you-go credit.
   - HeyGen says there are **no free API credits** (since Feb 2026) and that API credit expires after 12 months.
5. **Find your avatar ID:** run `--list-avatars`. Your twin is listed under "Digital Twins".
   - Copy its ID; its status must be `completed`.
   - HeyGen's docs don't say in so many words that a twin made in the web app is usable through the API. They list your own avatars through the API, though, and `--list-avatars` shows you right away whether yours is there.

## 3. Fill in `api_keys.txt` (or your presenter profile)

If you already have a presenter profile and global keys (see the next section), you can skip this step.

Otherwise, double-click `RUN_ME.command` once. It creates `api_keys.txt` and opens it in TextEdit. Paste the values after the `=` signs and save:

```
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...        (from --list-voices)
HEYGEN_API_KEY=...
HEYGEN_AVATAR_ID=...           (from --list-avatars)
HEYGEN_CHARACTER_TYPE=avatar   (use talking_photo if you made a photo avatar)
```

Keep this file private. It is excluded from git, and the scripts only ever print keys masked, like `0dd6…e094`.

## Presenter profile (same avatar in every project)

Your voice, avatar look and bubble framing shouldn't drift between talks, so keep them in one place. Settings are read in three layers. A later layer overrides an earlier one, and a **blank value (`KEY=`) never overrides anything**.

| Order | File | What goes in it |
|---|---|---|
| 1 | `~/.config/avatar-presentation/presenter.env` | Your **presenter profile**: `TTS_PROVIDER`, voice IDs (`HEYGEN_VOICE_ID`, `ELEVENLABS_VOICE_ID`, `GEMINI_VOICE` …), `HEYGEN_AVATAR_ID`, `HEYGEN_CHARACTER_TYPE`, `HEYGEN_ENGINE`, `HEYGEN_RESOLUTION`, optional `HEYGEN_BACKGROUND`, and all `BUBBLE_*` settings. **No API keys.** |
| 2 | `~/.config/avatar-presentation/keys.env` | API keys shared by every project (`chmod 600`). |
| 3 | `presentation/video/api_keys.txt` | This project's keys and any per-project overrides. |

Both files use the same `KEY=VALUE` format as `api_keys.txt`, and `#` starts a comment. To move the folder, set `AVATAR_PRESENTATION_CONFIG_DIR` or pass `--config-dir`.

| Task | Command |
|---|---|
| Save keys once for all projects (hidden dialogs; writes `keys.env` with `chmod 600`) | `python3 set_keys.py --global` (or `--global gemini`) |
| See every setting, where it came from, and the keys masked | `python3 generate_presentation_video.py --profile show` (or `python3 set_keys.py --profile show`) |
| Copy this project's voice/avatar/bubble settings into the profile | `python3 generate_presentation_video.py --profile save` (never copies keys) |

A new project's `api_keys.txt` starts with these settings blank, so the profile applies. To change something for one talk only, set it in that project's `api_keys.txt`.

## Gemini voice (`TTS_PROVIDER=gemini`)

This uses Google's Gemini TTS, including a voice you cloned there. The audio goes to HeyGen for lip-sync exactly like ElevenLabs audio does.

1. **Get a key.** Go to aistudio.google.com and choose **Get API key**. Save it with `python3 set_keys.py --global gemini`.
2. **Set the voice** in `presenter.env`:
   ```
   TTS_PROVIDER=gemini
   GEMINI_TTS_MODEL=gemini-3.8-flash-tts   # "Gemini 3.8 TTS"; gemini-3.8-flash-lite-tts is cheaper
   GEMINI_VOICE=voice_…                    # your cloned voice's ID, or a prebuilt name like Kore or Charon
   # GEMINI_STYLE_PROMPT=warm, unhurried    # optional; keep it short and the same for every slide
   # GEMINI_LANGUAGE=en-US                  # optional; the language is auto-detected
   ```
3. **Find your cloned voice's ID** with `.venv/bin/python generate_presentation_video.py --list-voices`. With `TTS_PROVIDER=gemini`, this lists your cloned ("replicated") voices, then the 30 prebuilt names.

Things to know:
- **Clones need a 3.8 model.** Cloned voices (`voice_…`, or a temporary `voicekey_…`) work only with the `gemini-3.8-flash-tts` or `gemini-3.8-flash-lite-tts` models.
- **Long slides are split.** Each slide is normally one request. A slide over about 4,000 characters (roughly 4.5 minutes of speech) is split at sentence ends and joined with a 0.25-second gap.
- **The style note is separate from the text.** `GEMINI_STYLE_PROMPT` is sent as `speech_metadata.style`. Gemini 3.8 reads the text word for word, so never put "Say cheerfully:" in the script.
- **`--check` is free.** It confirms the key and model with a GET request and nothing is synthesized.
- **Cost.** Google listed `gemini-3.8-flash-tts` at about $0.0023 per 10 seconds of audio (Sept 2026), doubling from 2027-01-01. Check the current rate before a full run.

## Delivery tags in the script

You can write tags like `[pause]`, `[long pause]`, `[laughs]`, `[sighs]`, `[breath]` or `<break time="1s"/>` into `script.md`. Each voice converts them into what it supports and silently drops the rest, so a tag is never read aloud. The draft voice turns pauses into real silences.

The run prints which tags a voice left out. The transcript on the video page never shows tags. The cheat sheet, including each voice's own extra tags, is in the skill's `references/tts-tags.md`.

## Video slides and cut scenes (`media.json`)

Put a `media.json` file next to `script.md` (in the `presentation/` folder), with the clips in `presentation/media/`. To use a file somewhere else, pass `--media`. Start from `media.example.json`. Paths are relative to `media.json`, and keys starting with `_` are ignored.

```json
{
  "slides": {
    "5": {"video": "media/slide_05.mp4", "fit": "cover", "pad": "freeze", "audio": "mute"}
  },
  "cutscenes": [
    {"id": "A", "after_slide": 7, "video": "media/cutscene_A.mp4", "title": "The courtroom at dawn",
     "audio": "keep", "fade": 0.6}
  ]
}
```

**Video slides** replace a slide's picture with a clip, such as a HyperFrames animation, B-roll or motion graphics. The slide still needs its place in the deck; its PNG is only the poster. The narration still decides how long the slide lasts, and the presenter bubble sits on top.

| Key | Values | Default | Meaning |
|---|---|---|---|
| `video` | path | — (required) | The clip. |
| `fit` | `cover` · `contain` · `stretch` | `cover` | `cover` fills the frame and crops the edges. `contain` letterboxes on black. |
| `pad` | `freeze` · `loop` | `freeze` | When the clip is shorter than the narration, hold its last frame or loop it. A longer clip is cut at the end of the slide. |
| `audio` | `mute` · `mix` | `mute` | `mix` plays the clip's own sound under the narration at `volume`. |
| `volume` | 0–4 | 0.25 | The clip's sound level with `"audio": "mix"`. |
| `start` | seconds | 0 | Skip the start of the clip. |

**Cut scenes** are full-screen cinematic clips of about 20 seconds (for example from Higgsfield or Seedance) that play *between* slides, with no presenter bubble and no narration.
- The slide before one fades to black over 0.5 seconds.
- The cut scene fades in, plays with its own sound, and fades out.
- The next slide fades in from black. Its narration starts after a 0.5-second lead.

| Key | Values | Default | Meaning |
|---|---|---|---|
| `id` | text | A, B, C… | Must be unique. |
| `after_slide` | slide number (0 = before slide 1) | from the script heading | Where the cut scene plays. |
| `video` | path | `media/cutscene_<id>.mp4` | The clip. |
| `title` | text | from the script heading | Shown as "Cut scene: \<title\>" in the chapters. |
| `audio` | `keep` · `mute` | `keep` | The clip's own sound. |
| `fade` | seconds | 0.6 | Fade in from black and out to black. |
| `volume` | 0–4 | 1.0 | The clip's sound level. |
| `start`, `duration` | seconds | whole clip | Trim the clip. In a draft with no file yet, `duration` sets the placeholder's length (default 20 s). |
| `fit` | as for slides | `cover` | |
| `voiceover` | `true` · `false` · text | `true` | Narration from the script heading (see below); `false` silences it; text replaces it. |
| `voiceover_bed` | 0–4 | 0.35 | The clip's sound level under a voiceover. |

**Marking a cut scene in the script instead.** You can write a heading in `script.md` rather than a `media.json` entry:

```
## CUTSCENE A — The courtroom at dawn
> Stage notes (never spoken).
```

The cut scene plays after the slide section above the heading. Any normal text under the heading is spoken as an optional **voiceover**. The voiceover starts once the cut scene has faded in, over the clip's sound turned down to `voiceover_bed`. A heading with no text has no narration.

If both the heading and a `media.json` entry use the same `id`, their fields merge and `media.json` wins.

**Previewing before the media exists.** In `--draft`, a missing video or cut-scene file becomes a dark title card, so you can check the timing first. `--check` and the final render stop if any file is missing.

`--slides 3-5` includes a cut scene only when the slides on both sides of it are chosen.

Cut scenes appear in the timeline, in `output/web/parts.json` (a `chapters` list) and in the video page's chapter list as "Cut scene: \<title\>".

## 4. Make the real video

Double-click **`RUN_ME.command`**. It:

1. Renders the slides.
2. Runs a free check. It confirms your keys and IDs, that the voice really is a clone, that the twin is ready, and how many credits you have.
3. Shows exactly what will be paid for.
4. Asks **"Proceed with paid generation? (y/N)"**.
5. On **y**, makes `output/presentation.mp4`, then web copies in `output/web/`. The web copies are 720p parts under 14 MB each, plus `parts.json` listing which slides each part holds.

**Check the bubble framing.** After the first run, look at how your face sits in the bubble. To adjust it, set `BUBBLE_ZOOM` / `BUBBLE_FOCUS_Y` in `presenter.env` or `api_keys.txt` and run again. Also try `BUBBLE_POSITION` (`bottom-left` by default, or `bottom-right`, `top-left`, `top-right`), `BUBBLE_SHAPE` (`circle` or `rounded`), `BUBBLE_SIZE` (300) and `BUBBLE_MARGIN` (48). The same settings exist as flags: `--bubble-position`, `--bubble-shape`, `--bubble-size` and `--bubble-margin`. Re-framing costs nothing, because everything already generated is reused.

## 5. Publish to the video page

The video page (a claude.ai artifact) starts out showing the free draft. After a successful run, RUN_ME rebuilds the page in `../player/` with your final video. Then ask Claude to **"publish the final video"**. Claude republishes the same link, so anyone you've shared it with sees the new version. The "Draft preview" label changes automatically to an "AI presenter" disclosure.

If you change the script or slides later, run RUN_ME again (only changed slides are re-billed), then ask Claude to publish again.

---

## What it costs (honest version)

`--check` prints your script's length. As a guide, 2,500 words is about 14,800 characters and **17–18 minutes** of speech.

| | What you pay for | Estimate |
|---|---|---|
| **ElevenLabs** | characters of speech (Multilingual v2 = 1 credit per character) | ≈ 14,800 credits per full run. **Starter** (30,000/month) covers one full run plus some re-dos. **Creator** gives far more room. |
| **HeyGen API** | seconds of avatar video | ≈ 1,050 seconds of video per full run. |

About the HeyGen estimate:

- HeyGen publishes per-second rates only for Enterprise accounts: Avatar IV Digital Twin at 0.1 credit/s, with 1 credit = $0.50. That is ≈ **$3/min, ≈ $50–55** for this talk. The older, cheaper **Avatar III** engine is ≈ $0.50/min (≈ $9).
- **I could not verify the self-serve pay-as-you-go price.** It is only shown after you log in. Check it in HeyGen's API settings before topping up.

**Rates measured from real runs (Sept 2026, HeyGen pay-as-you-go wallet):**

| Avatar | Engine | Measured | Full ~17 min talk |
|---|---|---|---|
| Digital Twin | Avatar III | ≈ $0.017/s | ≈ $17 |
| Digital Twin | Avatar IV | ≈ $0.067/s (≈ 20 min of render time per clip) | ≈ $68 |
| Photo avatar ("look") | Avatar IV | ≈ $0.04/s including HeyGen speech | ≈ $40 |
| HeyGen speech only | text-to-speech | ≈ $0.002/s | ≈ $2 |

Check the wallet before and after a one-slide test (`--check` prints it) to confirm current rates.

The free check prints your remaining credits and the minutes to be generated.

**Re-dos are cheap.** Each slide is generated separately and remembered. If you change one slide's wording, only that slide is re-voiced and re-filmed, and unchanged slides are never charged twice. An interrupted run picks up where it stopped. That includes HeyGen jobs that were still rendering, which are collected rather than paid for again.

HeyGen's resolution doesn't change the price, so clips are requested at **1080p**. HeyGen has paused 4K for its current avatar engines (Sept 2026), and 1080p is already sharper than the 300-pixel circle needs.

---

## Commands (for Terminal, if you prefer)

Open Terminal and first run:

```
cd "<your project>/presentation/video"
```

| Task | Command | Cost |
|---|---|---|
| Render slides | `python3 render_slides.py` | free |
| Draft video | `python3 generate_presentation_video.py --draft` | free, offline |
| Web copies of the draft | `python3 generate_presentation_video.py --draft --web` | free |
| List your voices (ElevenLabs, or Gemini with `TTS_PROVIDER=gemini`) | `.venv/bin/python generate_presentation_video.py --list-voices` | free |
| Show merged settings (keys masked) | `python3 generate_presentation_video.py --profile show` | free |
| Save keys for every project | `python3 set_keys.py --global` | free |
| List your avatars | `.venv/bin/python generate_presentation_video.py --list-avatars` | free |
| Check keys and IDs | `.venv/bin/python generate_presentation_video.py --check` | free |
| Final video | `.venv/bin/python generate_presentation_video.py --final` | **paid** (asks first) |
| Web copies of the final | `.venv/bin/python generate_presentation_video.py --web` | free |
| Redo slides 3–5 only | `.venv/bin/python generate_presentation_video.py --final --slides 3-5 --regen-avatar` | paid, only those slides |
| No presenter bubble | add `--no-avatar` | — |
| Other bubble corner/shape, just this run | add `--bubble-position top-right --bubble-shape rounded` | — |

(`.venv` is created by the first double-click of RUN_ME.)

## Troubleshooting

| Problem | What to do |
|---|---|
| "RUN_ME.command can't be opened" / "unidentified developer" | Right-click it → **Open** → **Open**. Or go to System Settings → Privacy & Security → **Open Anyway**. |
| "Permission denied" when double-clicking | In Terminal: `chmod +x RUN_ME.command DRAFT.command` (in this folder). |
| "media files are missing" | Put the clips where `media.json` says (default `presentation/media/`), or preview with `--draft`, which uses title cards. |
| A tag was read aloud | This shouldn't happen: every tag a voice can't use is dropped. Check the spelling against `references/tts-tags.md`. Only `[letters]`, `<known tag>` and `<break time="…"/>` count as tags. |
| Gemini **400 / 403 / 404** | 403: the key is wrong (save a new one with `set_keys.py --global gemini`). 400/404: check `GEMINI_TTS_MODEL`, and that a cloned `voice_…` is used with a 3.8 model. |
| A setting is ignored | Run `--profile show`: a non-blank value in `api_keys.txt` overrides `presenter.env`. |
| ElevenLabs **401** | The key is wrong, expired, or lacks permissions. Make a new key (step 1.4) and paste it into `api_keys.txt`. |
| HeyGen **401 / 403** | Copy the API token again. Also make sure API access has credit (it is separate from the web plan). |
| "insufficient credit / quota" | Top up. Then double-click RUN_ME again; finished slides are not charged again. |
| "this is NOT a cloned voice" | `ELEVENLABS_VOICE_ID` points at a stock voice. Use the ID marked `← your clone` in `--list-voices`. |
| "not one of your private avatar looks" / "not ready" | The twin is still training, or the ID is wrong. Re-run `--list-avatars` and wait for `completed`. |
| "photo avatar — set HEYGEN_CHARACTER_TYPE=talking_photo" | Do what it says in `api_keys.txt`. |
| Some slides show a **still** face | HeyGen failed or is still rendering that clip. Double-click RUN_ME again later; only those slides are redone. |
| Face too small, cut off or off-centre in the bubble | Adjust `BUBBLE_ZOOM` (bigger = closer) and `BUBBLE_FOCUS_Y` (smaller = higher), then run again. This is free. |
| A word is mispronounced | Spell it the way it sounds in `script.md` (only that slide is regenerated). Lines starting with `>` are never spoken. |
| Warnings that the script and slides don't match | Each slide needs a heading `## SLIDE <n> — <title>`, numbered 1, 2, 3… to match the deck order. |
| Slides look wrong or out of date | RUN_ME and DRAFT re-render changed slides automatically. Fonts need an internet connection. |
| "ffmpeg not found" | In Terminal: `brew install ffmpeg`. |
| A web part is over the host's limit | Parts are kept under 14 MB. For a different cap, run `--web --web-max-mb 9`. |
