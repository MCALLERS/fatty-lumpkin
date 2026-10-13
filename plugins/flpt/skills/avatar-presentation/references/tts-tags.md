# Delivery tags: cheat sheet

> **Laughs are paused (2026-10-07).** The user found `[laughs]`/`[chuckles]` unconvincing on the `elevenlabs_v3` voice. Don't write them unless the user asks again; let a pause carry the joke.

Write these tags inline in `script.md`. Each voice gets the version it supports, and anything it can't use is dropped quietly, so a tag is never read aloud. The run prints which tags each voice left out, and the video page's transcript never shows tags.

## The tags to use (they work with every voice)

| You write | Draft (`say`) | HeyGen voice | ElevenLabs (v2, flash, turbo) | ElevenLabs `eleven_v3` | Gemini 3.8 |
|---|---|---|---|---|---|
| `[short pause]` (≈0.4 s) | 0.4 s silence | `<break time="0.4s"/>` | `<break time="0.4s" />` | `[short pause]` | `<short pause>` |
| `[pause]` (≈0.8 s) | 0.8 s silence | `<break time="0.8s"/>` | `<break time="0.8s" />` | `[pause]` | `<short pause>` |
| `[long pause]` (≈1.6 s) | 1.6 s silence | `<break time="1.6s"/>` | `<break time="1.6s" />` | `[long pause]` | `<long pause>` |
| `<break time="1s"/>` (exact) | exact silence | kept (seconds only; `ms` is converted) | kept (max 3 s) | nearest pause tag | under 1 s → `<short pause>`, else `<long pause>` |
| `[laughs]` | dropped | dropped | dropped | `[laughs]` | `<laugh>` |
| `[sighs]` | dropped | dropped | dropped | `[sighs]` | `<sigh>` |
| `[breath]` | dropped | dropped | dropped | `[breath]` | `<breath>` |

`[beat]` means the same as `[pause]`.

## Extra tags per voice

- **Gemini 3.8** (`gemini-3.8-flash-tts`, `-lite`). These are the documented tags. Write them as `<sigh>` or `[sigh]`; either works.
  `<argh> <breath> <heavy breath> <exhales> <cackle> <cheer> <chuckle> <chuckles> <cough> <cry> <gasp> <giggle> <groan> <growl> <grunt> <grr> <hiss> <laugh> <laughter> <moan> <pant> <pff> <phew> <scream> <shout> <shriek> <sigh> <sighs> <sneeze> <snicker> <snort> <sob> <throat-clearing> <tsk> <whimper> <whispers> <whispering> <yawn> <short pause> <long pause>`
  - **Accepted spellings:** `[laughing]`, `[clears throat]`, `[whisper]`, `[inhales]` and `[deep breath]` are converted automatically.
  - **Dropped:** style tags such as `[excited]` or `[sarcastic]` aren't Gemini tags. For a sustained tone, set `GEMINI_STYLE_PROMPT` instead (keep it short and the same for every slide).
  - **Emphasis:** CAPITALISE one word.
  - **Hesitation:** use commas, `--` and `...`.
  - **No SSML:** Gemini doesn't document it, so `<break>` becomes a pause tag.
  - **No stage directions in the text.** Gemini 3.8 reads the text verbatim, so "Say warmly:" would be spoken.
  - **Source:** ai.google.dev/gemini-api/docs/generate-content/speech-generation, checked 2026-09-27.
  - **Older models:** on 3.1/2.5 preview models, pauses become `...` and other tags are dropped. This is not confirmed by the docs.
- **ElevenLabs `eleven_v3`.** Any `[tag]` passes through, for example `[whispers] [excited] [sarcastic] [curious] [crying] [snorts]`, so choose them by ear. v3 has no SSML breaks. Source: elevenlabs.io/docs, best-practices page.
- **ElevenLabs, other models.** Only pauses are supported. Keep breaks sparse, because many breaks make the voice unstable.
- **HeyGen voice.** It depends on `HEYGEN_VOICE_ENGINE` (required by the API since 2026-10).
  - `starfish` (the default), `orca` and `elevenlabs` support only pauses, as `<break>`.
  - `elevenlabs_v3` keeps audio tags (`[laughs]`, `[chuckles]`, `[sighs]`, `[breath]`, and other free-form `[tag]`s) and bracketed pauses. Use it for the natural, disfluent delivery the user wants: laughs and breaths in the user's own HeyGen voice.
- **Draft (`say`).** Only pauses are supported.

## Rules

- **What counts as a tag:** `[letters and spaces]`, a known `<tag>`, or `<break time="…"/>`. Anything else, like `[1]` or `<span>`, is treated as text or markup, not as a tag.
- **Never spoken:** lines starting with `>` (stage directions) and `<!-- comments -->`.
- **Changing tags is cheap.** It re-voices only that slide, because the cache is keyed by the text the voice actually hears. Text without tags keeps its existing cache.
