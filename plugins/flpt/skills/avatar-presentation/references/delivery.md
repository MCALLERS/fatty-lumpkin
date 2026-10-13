# Delivery: what the user gets, at what level, and where

Added 2026-10-12. The pipeline commands are in `4-video.md`; this is the checklist of what leaves the building.

## 1 · From the pipeline (every video)
| File | For | Notes |
|---|---|---|
| `presentation/video/output/presentation.mp4` | the web player | 1080p30 H.264 + AAC 48 kHz |
| `presentation/video/output/presentation_for_editing.mov` | **the editor (CapCut)** | No B-frames, PCM, no edit lists, voice +20 ms. Always point the user to this file, not the `.mp4`. |
| The player page artifact | sharing | Chapters, a transcript, the deck link, and the AI disclosure. The `media_note` covers cartoons, generated scenes and archival footage. |
| `CAPCUT_CLIP_GUIDE.md` | clip slots | Timecodes, sound policy, and **inset rectangles** for every slot (PIP is how they actually get used). |
| `tighten/` + re-made masters | over-long pauses | Run `tighten.py` by default before delivery; it's free. |

## 2 · From the wrapper workstream (series and hero videos)
The wrapper kit in `presentation/wrapper/` (`wrapper-and-extras.md` §6):
- a run-sheet
- cards, as PNG plus their words
- the cold open and bookends, as full runs
- stingers, B-roll, beds and transitions
- `CREDITS.md`

## 3 · Levels (applies to everything handed to an editor)
- **Dialogue and mixed pieces:** −14 LUFS integrated (our master measures −13.8), with a **−1 dBTP** true-peak ceiling.
- **Music beds:** `.bed` at −26 LUFS (sits under narration) and `.full` at −16 LUFS (cards, montages, sign-offs).
- **Cut scenes inside the master** keep their existing mix (two-pass loudnorm, −21 LUFS before compositing). That's unchanged.
- **Tool:** `python3 <skill>/scripts/video/loudmatch.py <files/folders> --out <folder> [--bed]`. It measures, applies gain plus an oversampled true-peak limiter, copies the picture, and never touches originals.
- **Why:** the Shadow extras arrived 2–17 dB quieter than the talk, and the CapCut exports peaked at +0.4 to +1.2 dBTP.

## 4 · The Slack pack (after the user's final export)
Michael posts four files per episode. They're made from the editor's export, so ask for its path.

```
python3 <skill>/scripts/video/slack_pack.py "<Episode folder>/<Title>.mp4" [--title "<Title>"] [--verify]
```

| Output | Recipe |
|---|---|
| `<Title> (vF).mp4` | same length, x264 medium CRF 22, maxrate 5 Mbps / bufsize 10 Mbps, AAC 192 kbps 48 kHz |
| `<Title> - 1.25x for Slack.mp4` | the same recipe, `setpts=PTS/1.25,fps=30` and `atempo=1.25` (pitch kept) |
| `<Title>.mp3` | 128 kbps |
| `<Title>-Cover.jpg` | a frame from the title card (`--cover-at`, default 1 s) |

**Every audio output passes a −1 dBTP true-peak limiter.**
- **The encoder:** the script prefers Apple's AudioToolbox AAC encoder. ffmpeg's built-in AAC encoder overshot to +1.8 dBTP on the 1.25× cut; Apple's stays at about −1.
- **Sizes:** an 18–27 min episode comes to about 275–380 MB for the (vF) and 230–320 MB for the 1.25× cut.
- **Safety:** it never overwrites without `--overwrite`.

## 5 · Folders and names
- **One named folder per episode** on the Desktop (or wherever the user keeps finals), holding the export, the Slack pack and the flyer. Michael's pattern is `~/Desktop/Ep. 4 - Fog of War/`.
- **Always print full paths** of what was delivered. Offer to reveal the folder in Finder.
- **Keep superseded versions** in an `old/` subfolder rather than deleting them.
- **Name generated clips** `PIECE-n-slug-vN.mp4` (with `-full-vN`, `-ALT`, `-patched`, `-phone`, `oneoff-`). Bookends follow `NN before/after Part N - TITLE.mp4`.

## 6 · Honesty and credits
- **The player page discloses:** the AI presenter, generated scenes and cartoons, archival sources (credited), and the music credits that CC BY requires.
- **Real people** in generated scenes appear only with their consent; record it in `CREDITS.md`.
- **Copyrighted clips** are never shipped by us. They're the user's own drop-ins, listed in the clip guide as slots.
