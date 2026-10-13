# Voice options: Gemini 3.8 TTS clone vs HeyGen voice

Researched 2026-09-27. "Gemini 3.8 TTS" is real: Google shipped **Gemini 3.8 Flash TTS** and **Gemini 3.8 Flash-Lite TTS** on 23 Sept 2026. Voice cloning, which Google calls **Voice replication**, works both in AI Studio and through the Gemini API. It is not AI Studio-only.

## Recommendation

**Drive HeyGen with Gemini audio.** For each slide, synthesize the narration with the user's replicated Gemini voice, upload the WAV to HeyGen, and render the twin with `audio_asset_id`. Keep HeyGen's own voice as the fallback.

- **Quality.** The user rates the Gemini clone as their best voice. Gemini 3.8 also takes the disfluent, off-the-cuff transcripts the user wants: Google's prompting guide recommends writing "natural conversational disfluencies" into the text, and it supports inline `<breath>`, `<short pause>` and `<chuckle>`. HeyGen's Starfish TTS offers only `<break>`.
- **Lip-sync.** HeyGen's render is audio-driven either way: a `script` is first synthesized to audio, and HeyGen's docs present feeding TTS audio back in as `audio_url` as an equivalent route. HeyGen doesn't document any difference in lip-sync quality between its own TTS and uploaded audio. On Avatar V, the audio is the first driver of expression, so livelier audio should give a livelier face. This is not measured yet. Do a one-slide A/B test (see below).
- **Cost.** Gemini costs about **$0.0135 per audio minute** (about $0.23 for a 17-minute talk) until 31 Dec 2026, then double that. HeyGen TTS is about $0.002/s (about $2 a talk). Avatar minutes cost the same with either audio source, so the voice cost is negligible both ways.
- **Friction.** It adds one upload step per slide, which is the path the ElevenLabs route already takes. Freezing the audio first is also the best consistency lever (see `heygen-consistency.md`). Retakes of the audio are cheap and fast, and the expensive avatar render only runs on audio the user has approved.

**When to stay on HeyGen's voice:** the A/B shows worse mouth sync on Gemini audio, the Gemini API key's project can't see the user's voice ID, or the user wants the fewest moving parts for a quick one-off.

**A/B test before switching (about $1–2):** render one 20–30 s slide twice with the same look, engine and framing, once with `script` + the HeyGen voice and once with Gemini audio. Put the two in a side-by-side and let the user pick. Check bilabials (B, M, P closures), laughs and breaths, and whether the head motion looks alive.

## What the Gemini side offers

| | Gemini 3.8 Flash TTS | Gemini 3.8 Flash-Lite TTS |
|---|---|---|
| Model ID | `gemini-3.8-flash-tts` | `gemini-3.8-flash-lite-tts` |
| Positioning | Flagship. Maximum fidelity, acting nuance and long-form stability | Fast and cheap. Google lists "voice replication" and everyday single-speaker narration among its best uses |
| Languages | 130 | 101 |
| Output price (standard) | $9 / M audio tokens = $0.00225 per 10 s (→ $18 / M on 1 Jan 2027) | $6 / M = $0.0015 per 10 s (→ $12 / M) |
| Input price | $0.50 / M text tokens (→ $1.00) | same |
| Batch or Flex | Half price | Half price |
| Free tier | Free, but "used to improve our products: Yes" | same |

Older models, all superseded: `gemini-3.1-flash-tts-preview`, `gemini-2.5-pro-preview-tts`, `gemini-2.5-flash-preview-tts`. Audio is billed at 25 tokens per second.

**Voice cloning (Voice replication).**
- **Inputs:** a 10–30 s reference clip (`source_audio`) plus a consent clip (`consent_audio`) of the same speaker reading a fixed sentence verbatim ("I am the owner of this voice and I consent to Google using this voice to create a synthetic voice model."). Recommended format: 24 kHz mono 16-bit WAV, recorded on the same mic in the same room.
- **Stored voice (`store=true`, the default):** a persistent ID `voice_…` in the Google project. The limit is 200 custom voices per project, and each expires after **1 year**. Put a renewal reminder in the profile.
- **Stateless key (`store=false`):** `voicekey_…`, with a 7-day TTL. Not useful here.
- **AI Studio clones work in the API.** A voice made in AI Studio returns the same `voice_…` ID, and Google says to paste it straight into code. The API key must belong to the **same Google project**.
- **Region limits:** AI Studio replication is unavailable in Illinois, Texas, the EEA, the UK, Switzerland and India.
- **Where it runs:** the Gemini API and AI Studio. Google says Gemini Enterprise support is "coming soon". Vertex AI availability is not confirmed.

**Expressive control.**
- **The text is spoken verbatim.** Stage directions typed into the text get read aloud.
- **Turn-level delivery** goes in the `speech_metadata.style` annotation, for example `"casual, thinking out loud"`. Google advises leaving it empty or using one short constant string. Long "director's notes" cause voice drift, as do instructions like "keep the same timbre".
- **Point-in-time tags** go inline in angle brackets: `<short pause>`, `<long pause>`, `<breath>`, `<heavy breath>`, `<exhales>`, `<sigh>`, `<laugh>`, `<chuckle>`, `<giggle>`, `<gasp>`, `<throat-clearing>`, `<tsk>`, `<whispers>`, `<cough>`, `<phew>`, `<groan>`, `<yawn>` and more. The user's `[laughs]`, `[sighs]` and `[pause]` map to `<laugh>`, `<sigh>` and `<short pause>`. Square brackets are the ElevenLabs v3 style, and Gemini 3.8 wants angle brackets.
- **Emphasis** uses CAPITALISED words. Pace uses punctuation (`...`, `--`) or a style of "speaking slowly" or "speaking rapidly".
- **Consistency.** The model anchors on the voice reference. There is no seed, and each call varies slightly around that voice. Cache every approved slide WAV and never regenerate an approved one.
- Every output carries a **SynthID watermark** and C2PA credentials. That is fine here, because the player page already discloses the cloned voice.

**Limits.**
- Per request: 8,192 input tokens and 16,384 output tokens. At 25 tok/s that is about 655 s, roughly 10.9 minutes of audio. Synthesize one request per slide.
- Multi-speaker requests work only with 2 prebuilt voices, so custom voices must be synthesized turn by turn. Not relevant for a solo talk.

**Unknowns to check in the one-slide test.** Whether `<laugh>` and `<chuckle>` lip-sync naturally on the twin (non-speech sounds can make odd mouth shapes), and whether the Gemini 24 kHz WAV needs resampling before HeyGen. HeyGen accepts WAV; converting to 48 kHz is harmless.

## Facts for the implementer

Don't treat this section as code. The GeminiTTS engine is being written by another agent.

**Model IDs:** `gemini-3.8-flash-tts` (default) and `gemini-3.8-flash-lite-tts` (cheap option). The SDK needs `google-genai` ≥ 2.25.0 for `voices.*`.

**Auth:** header `x-goog-api-key: $GEMINI_API_KEY`. Read the key from `api_keys.txt` like the other keys, and never put it in chat.

**Endpoint A, the Interactions API (Google's recommended path):**
`POST https://generativelanguage.googleapis.com/v1beta/interactions`
```json
{
  "model": "gemini-3.8-flash-tts",
  "input": [{
    "type": "user_input",
    "content": [{
      "type": "text",
      "text": "<verbatim slide narration, with <short pause> etc. inline>",
      "annotations": [{ "type": "speech_metadata", "style": "" }]
    }]
  }],
  "response_format": { "type": "audio", "mime_type": "audio/wav", "sample_rate": 24000 },
  "generation_config": { "speech_config": [ { "voice": "voice_XXXXXXXX" } ] }
}
```
- **Response:** `steps[]` → the item with `type == "model_output"` → `content[]` item with `type == "audio"` → `data` (base64). Take the last one.
- **SDK:** `client.interactions.create(...)`, then `interaction.output_audio.data`.
- `response_format` can be omitted. `mime_type` and `sample_rate` are optional.

**Endpoint B, generateContent (also documented):**
`POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-tts:generateContent`
```json
{
  "contents": [{ "role": "user", "parts": [{ "text": "<narration>", "speech_metadata": { "style": "" } }] }],
  "generationConfig": { "responseModalities": ["AUDIO"], "speechConfig": { "voiceConfig": { "voice": "voice_XXXXXXXX" } } }
}
```
- **Response:** `candidates[0].content.parts[0].inlineData.data` (base64).
- **SDK:** `client.models.generate_content(...)`, then `...parts[0].inline_data.data`, which comes back as bytes already.

**Voice field.**
- Prebuilt voices use their name, such as `"Kore"` or `"Charon"` (30 in total).
- A cloned or designed voice uses its `voice_…` ID in the **same field**: `speech_config[].voice` (Interactions) or `speechConfig.voiceConfig.voice` (generateContent).
- A stateless clone passes its `voicekey_…` in the same field.
- Note the 3.8 schema: the value is a plain `voice` string. The older `prebuiltVoiceConfig.voiceName` shape still appears in the docs' multi-speaker examples.

**Cloned-voice management.**
- List: `GET /v1beta/voices?type=replicated`, or SDK `client.voices.list(type_=["replicated"])`.
- Get: `GET /v1beta/voices/{voice_id}`.
- Create, for reference only (the user already has one): `POST /v1beta/voices` with `{"store": true, "voice": {"model": "gemini-3.8-flash-tts", "type": "replicated", "display_name": "…", "replicated": {"source_audio": {"mime_type": "audio/wav", "data": "<b64>"}, "consent_audio": {"mime_type": "audio/wav", "data": "<b64>"}}}}`, which returns `id`.

**Output format.**
- **Unary default:** WAV with a RIFF header, 24 kHz, mono, 16-bit signed little-endian PCM. Write the decoded bytes straight to `.wav` with no manual header. This changed from 3.1-preview, which returned headerless PCM.
- **Streaming default:** headerless `audio/l16`, 24 kHz mono.
- **Other options:** `audio/l16`, `audio/mulaw` and `audio/alaw`, plus `sample_rate` (for example 24000, 16000 or 8000).

**Text rules.**
- The text is a verbatim transcript, so strip any stage directions.
- Inline tags use `<angle brackets>`.
- Sustained delivery goes in `style`, kept empty or short and constant across slides.
- CAPS mark emphasis.
- Keep each request under about 10 minutes of audio and 8,192 input tokens. Per slide is fine.

**HeyGen handoff (matches the existing ElevenLabs route).**
- Upload the WAV to `POST /v3/assets` (MP3 or WAV, 32 MB or less) to get an `audio_asset_id`.
- `POST /v3/videos` with `{"type": "avatar", "avatar_id": <look>, "audio_asset_id": <id>, "engine": {...}, "resolution": ..., "aspect_ratio": ..., "fit": ..., "background": ...}`. `audio_asset_id` and `script` are mutually exclusive, and `voice_settings` is ignored with uploaded audio.

**Caching.** Key each slide's audio on (model, voice ID, style string, normalized text), so an unchanged slide never re-synthesizes and never re-bills the avatar.

## Sources

- Gemini TTS guide (Interactions API, tags, style, output formats, consistency guidance, limits): https://ai.google.dev/gemini-api/docs/speech-generation
- Gemini TTS guide (generateContent variant): https://ai.google.dev/gemini-api/docs/generate-content/speech-generation
- Voice replication (store modes, consent, REST and SDK): https://ai.google.dev/gemini-api/docs/voice-replication
- Voice design: https://ai.google.dev/gemini-api/docs/voice-design
- Model page, Gemini 3.8 Flash TTS (token limits, migration notes): https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-tts
- Model page, Gemini 3.8 Flash-Lite TTS: https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-lite-tts
- Pricing: https://ai.google.dev/gemini-api/docs/pricing
- Google announcement (availability, 30 s sample, region limits, SynthID and C2PA): https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-8-text-to-speech/
- Practical notes (AI Studio voice IDs reused in the API): https://www.philschmid.de/gemini-3-8-tts
- HeyGen Audio to Video: https://developers.heygen.com/audio-to-video
- HeyGen Create Video reference (`audio_asset_id`, `voice_settings` bypass): https://developers.heygen.com/reference/create-video
- HeyGen Avatar & Voice FAQ (Avatar V prioritizes audio input): https://help.heygen.com/en/articles/15544929-avatar-voice-faq-troubleshooting-best-practices-and-credits
