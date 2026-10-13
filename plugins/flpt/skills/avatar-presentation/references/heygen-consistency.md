# HeyGen: same face, same voice, every video

Researched 2026-09-27 against the v3 API docs and the HeyGen Help Center. Where two HeyGen pages disagree, the API reference (`/reference/create-video`) wins, and the conflict is noted.

## The short version

1. **Pin the IDs, never the defaults.** Every request passes an explicit `avatar_id` (the look ID), `voice_id` (or `audio_asset_id`) and `engine`. Don't rely on the look's default voice or on the server's default engine.
2. **Pin the frame.** Send the same `engine`, `resolution`, `aspect_ratio`, `fit` and `background` or `output_format` on every clip in a talk. Never mix engines across slides.
3. **Freeze the audio.** There is no seed and no determinism. The same script re-rendered gives a different performance. Generate the narration once per slide, upload it, pass `audio_asset_id`, and cache every finished clip. Re-render only the slides whose text changed.

## Lock identity: what to save after the user picks

Save these to `api_keys.txt` and to the talk's profile right away. The user re-made the twin and voice, so the old IDs are stale.

| Key | Where it comes from | Why |
|---|---|---|
| Look ID (`avatar_id`) | `GET /v3/avatars/looks?avatar_type=digital_twin&ownership=private` → `id` | A look is one outfit, setting and framing of the person. The ID is stable, but picker numbers are not. |
| Group ID | same response → `group_id` | The character. Its `default_voice_id` controls fallbacks. |
| Voice ID | the new twin's `avatar_item.default_voice_id`, or the user's chosen clone | Creating a twin clones a voice from the footage automatically. A linked group voice takes precedence over it. |
| Engine | `supported_api_engines` on `GET /v3/avatars/looks/{look_id}` | Requesting an engine that isn't listed returns 400 or `invalid_parameter`. |
| Framing | `resolution`, `aspect_ratio`, `fit`, `background` or `output_format` | These decide where the head sits in the corner bubble. |

**Default voice behaviour.** Looks and groups carry `default_voice_id`. If `voice_id` is omitted with a `script`, HeyGen falls back to the character's default voice, and a linked group voice wins over the look's own clone. Always send `voice_id`. To make the new voice the character default everywhere, including the web app, `PATCH /v3/avatars/{group_id}` with `default_voice_id`.

## Digital Twin vs Photo Avatar looks

| | Digital Twin (video look) | Photo Avatar (photo look) |
|---|---|---|
| Source | Footage of the person (15–600 s, one person, facing camera, audible speech). Consent step is required. | One still image. No consent step. |
| Motion | Learned from the person's own footage | Synthesized |
| Engines | III, IV, V (V is opt-in per look) | III, IV (V only when the group has a twin to borrow motion from) |
| `motion_prompt` | Avatar V only (rejected on IV for video avatars) | IV and V |
| `expressiveness` | Not supported | IV only (`low` is the default, then `medium`, `high`) |
| Background removal | Needs a twin trained with matting; new twins have it by default | Supported |
| Web-app credits/min | IV 31 · V 48 · III 4 | IV 16 · V 48 · III 7 |

**For this user: use the Digital Twin look.** Its motion comes from their real mannerisms, which makes it the most "them" and the most repeatable option. The Avatar V recording tips say the output is only as good as the input. Use the same base look for the whole project.

## Engines and consistency between generations

| Engine | `engine` value | What it does | Use it when |
|---|---|---|---|
| Avatar V | `{"type":"avatar_v"}` (optionally `reference_look_id`, a twin look in the same group) | Cross-reference animation, the highest fidelity. HeyGen's own advice: choose V for consistency. Performance is driven first by the audio, then by the base look's expression, then by prompts. | Default for this user, if the new look lists `avatar_v` |
| Avatar IV | `{"type":"avatar_iv"}` (the server default) | Broadest support, and expressiveness for photo looks | V isn't listed for the look |
| Avatar III | `{"type":"avatar_iii"}` | Cheapest and fastest. Native 4K for twins. No motion_prompt and no expressiveness. | Budget drafts |

- **No seed and no consistency parameter exists** on `POST /v3/videos`. HeyGen's FAQ says the same prompt won't produce the same output twice ("AI randomness"). Consistency comes from fixed inputs (look, engine, frame, audio) plus caching, not from regeneration.
- **Don't mix engines inside one talk.** IV and V clips of the same look move and light differently side by side.
- Avatar IV and V render the avatar at up to 1080p. `4k` only composites onto a 4K canvas.
- **Avatar videos come out at 25 fps.** The compositor must resample to the project rate (24 or 30), or every clip will judder slightly at cuts.

## Knobs that change the performance (leave them fixed once chosen)

- **`motion_prompt`** is natural-language gesture and expression control, for example "nodding gently". It is valid for twins only on `avatar_v`. The Digital Twin guide claims both IV and V support it; the API reference says IV rejects it for video avatars, and the reference wins. In the web app, custom motion is capped at 10 s and then loops or holds. Recommendation: send none. If the user wants a signature energy, pick one short string and send it identically on every clip.
- **`expressiveness`** applies to photo looks on IV only. Avatar V rejects it with a validation error.
- **The audio itself** is the biggest lever on Avatar V. Livelier audio produces a livelier face. See `voice-options.md`.
- **`voice_settings`** (`speed` 0.5–1.5, `pitch` ±50, `volume`, `locale`, and `engine_settings` for ElevenLabs, Fish or Starfish voices) apply only with `script`. Uploaded audio bypasses them.
- **`<break time="1s"/>`** works inside `script`. It is the only markup HeyGen supports, and wrapping text in `<speak>` can add spoken artifacts.
- **`brand_glossary_id`** fixes pronunciation of names and terms when HeyGen synthesizes the speech.

## Background and framing

- `background`: `{"type":"color","value":"#0b1220"}` or `{"type":"image","url":…}` (or `asset_id`). Keep one constant solid colour for the corner bubble.
- `remove_background: true` needs a twin trained with matting.
- `output_format: "webm"` returns alpha. Any `background` is then rejected and removal is automatic. This is the cleanest option for compositing, if the compositor handles WebM alpha.
- `aspect_ratio`: `16:9 | 9:16 | 4:5 | 5:4 | 1:1 | auto`. The API default is `16:9`, while the docs recommend `auto`, which follows the source footage. `fit`: `cover` (may crop) or `contain` (may letterbox); when omitted, the server chooses. Pin both, so a server-side default change can't move the head.
- Captions are off unless requested. Download `video_url`, not `captioned_video_url`.
- For framing checks, keep using `heygen_picker.py frame` and the `BUBBLE_*` settings. The twin may frame the face low.

## Limits worth knowing

- Script: 5,000 characters. Audio input: 10 minutes per the Usage Limits page (the Audio-to-Video page says 30). Per-slide clips stay well under both.
- Audio upload: MP3 or WAV, 32 MB or less, via `POST /v3/assets` → `audio_asset_id`, or a public `audio_url`.
- The v1/v2 API retires after Oct 31 2026. Stay on v3.

## Related: Cinematic Avatar (for cut scenes with the user's likeness)

`type: "cinematic_avatar"` is a prompt-driven, Seedance-backed mode. It takes 1–3 of the user's look IDs as identity references, plus up to 9 images and 3 videos, and supports 4–15 s at 720p or 1080p in 16:9, 9:16 or 1:1. There is no script or voice. It reuses the twin's existing HeyGen consent, so it is a clean route for putting the user in a cinematic shot. See `cutscenes.md`.

## Sources

- Digital Twin guide (engines, optional parameters): https://developers.heygen.com/generate-avatar-video
- Create Video API reference (authoritative field rules: motion_prompt, expressiveness, fit, background, VoiceSettings, AvatarVEngineConfig): https://developers.heygen.com/reference/create-video
- Models comparison table: https://developers.heygen.com/models
- Avatar V: https://developers.heygen.com/avatar-v · Avatar IV: https://developers.heygen.com/avatar-iv · Avatar III: https://developers.heygen.com/avatar-iii
- Avatar Looks (look vs group, `default_voice_id`, `supported_api_engines`): https://developers.heygen.com/docs/avatar-looks
- Get Avatar Look: https://developers.heygen.com/reference/get-avatar-look
- Video to Avatar (voice cloned from the footage, group voice precedence, PATCH group): https://developers.heygen.com/docs/avatar-from-video
- Audio to Video: https://developers.heygen.com/audio-to-video
- Photo Avatar: https://developers.heygen.com/photo-avatar
- Usage Limits (25 fps, 5,000 characters, 10-minute audio): https://developers.heygen.com/docs/usage-limits
- Text to Speech (`<break>`): https://developers.heygen.com/docs/voices/speech
- Cinematic Avatar: https://developers.heygen.com/cinematic-avatar
- Help: Avatar V best results: https://help.heygen.com/en/articles/14602997-how-to-get-the-best-results-with-avatar-v-in-heygen
- Help: Motion prompts (IV and V, 10 s cap): https://help.heygen.com/en/articles/12805098-how-to-fine-tune-avatar-movements-with-motion-prompts
- Help: Avatar & Voice FAQ (no identical regenerations; V for consistency): https://help.heygen.com/en/articles/15544929-avatar-voice-faq-troubleshooting-best-practices-and-credits
- Help: Credits per engine: https://help.heygen.com/en/articles/15126059-how-to-use-credits-on-heygen
- Help: Avatar Looks explained: https://help.heygen.com/en/articles/9964694-avatar-looks-explained
