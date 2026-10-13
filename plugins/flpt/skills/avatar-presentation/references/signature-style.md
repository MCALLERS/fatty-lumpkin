# Signature style (v0: refine with the user)

This file defines what makes an avatar presentation recognizably the user's. It's version 0, drafted from the first video ("Why would a law firm buy GPUs?", Sept 2026). Lock the open items with the user in a short grill-me session during their next presentation, then treat them as defaults.

## Constants (every video)

| Element | v0 setting | Status |
|---|---|---|
| Presenter | your HeyGen look with your HeyGen voice on the **`elevenlabs_v3` engine** ("voice B", chosen 2026-10-06 for natural delivery; its laughs didn't land, so laughs are paused from 2026-10-07). Set in `~/.config/avatar-presentation/presenter.env`. | locked 2026-09-27; engine locked 2026-10-06 |
| Bubble | bottom-left, rounded square (22% radius), 300px, 48px margin, white ring and soft shadow | locked 2026-09-27 |
| Palette | ink `#17202B`, paper `#F5F2EA`, oxblood `#8E2C48` (strategy/accent), blue `#1F5A85` (data/facts), amber `#8A5310` (tactics) | locked 2026-09-27 |
| Type | Source Serif 4 for display, IBM Plex Sans for body, IBM Plex Mono for data | locked 2026-09-27 |
| Music | a subtle bed under cut scenes only; the talk itself stays clean. Source: ElevenLabs Music, instrumental, minimal (a drone or pulse for tech scenes, sparse piano and cello for human scenes), mixed at about −21 LUFS | locked 2026-09-27 |
| Imagery | generated cinematic stills for scene imagery, matching the cut-scene look; real public-domain or licensed images for historical and real subjects | locked 2026-09-27 |
| Slide grammar | eyebrow + serif title, one idea per slide, dark statement slides, one accent slide. Every slide builds as it's narrated (HyperFrames), with the eyebrow and title present from frame 0 | keep (v2: all 14 slides animated) |
| Script voice | `unscripted` **natural mode (roughness 3½)**: the B+ riff plus real ums and uhs, thinking beats and self-repairs. **No laughs** (paused 2026-10-07: the engine's laughs didn't land). Plus the user's verbal signatures: "It's like, x, y, z" a few times per talk, and "my dude" at most once per talk. | locked 2026-10-06 |
| Transitions | 0.3s crossfade between slides; cut scenes fade to black over 0.5–0.6s both ways | open: a signature transition sting? |
| Cut-scene look | cinematic, 24fps, anamorphic feel, film grain (cinema-director defaults). **Faces may be featured** (the user OK'd this on 2026-09-27). The user may appear as a character when they choose to; ask in grill-me round 2, then follow `cutscenes.md` §6 (likeness routes, consent, disclosure). No dialogue unless scripted. | locked 2026-09-27; recurring motif still open |
| Open / close | a cut-scene cold open into the title slide, and a closing line that echoes the opening question | cold open trialled in Latham v2 (2026-09-27); awaiting the user's verdict |
| Series devices | for a multi-part series: a top-right badge ("SERIES TITLE · PART n"), receipt lower-thirds that print in, question cards, and a next-time teaser on the last slide | trialled 2026-10-06 (*The Shadow of the Future*) |
| Episode wrapper | for a series: title card + announcer, cold open, "before/after" bookends with a recurring cast, a hand-off card ("Your training video will begin shortly…"), a reel-runout seam, and the sign-off "Thank you for your attention to this matter." See `wrapper-and-extras.md`. | observed 2026-10-12 in Michael's CapCut finals (his layer grew to 52 % of Ep 4) |
| Levels | everything handed to the editor sits at −14 LUFS integrated with a −1 dBTP ceiling; music beds come as `.bed` (−26) and `.full` (−16) | adopted 2026-10-12 (`scripts/video/loudmatch.py`) |

## Signature elements (at least one of each per video)

1. **Motion graphics.** HyperFrames or registry blocks such as kinetic type, animated counters, lower-third callouts.
2. **Photos in motion.** Real or licensed photos with Ken Burns, parallax or masked reveals (`hyperframes-keyframes`).
3. **Chart.** Real data, scaled correctly, sourced on the slide. An animated build is preferred.
4. **Infographic.** A process, comparison or anatomy graphic that stands on its own.
5. **Live HyperFrames animation.** It builds on screen in sync with the narration beats (`references/hyperframes-slides.md`).
5b. **Whiteboard sketch ("avocado toast").** At least one full-frame, hand-drawn doodle scene, drawn stroke by stroke with a pen nib, timed to the words (`references/hyperframes-slides.md` → The whiteboard sketch). A diagram build doesn't count. Required from 2026-09-27.
6. **Cut scenes.** 1–2 of about 20 seconds each, via Higgsfield + Seedance 2.5 (`references/cutscenes.md`).
7. **Cosmos-style cartoon.** 1–2 per video. A painted 2D documentary segment replaces a narrated slide, with the bubble hidden and the narration running on (`references/hyperframes-slides.md` → Cartoon slides). From 2026-10-06.
8. **Real footage.** Use public-domain or openly licensed archival film and photos wherever the story has them, credited on screen. Grab segments with remote ffmpeg seeks, never from YouTube, and check every range by eye. Copyrighted film or YouTube moments become **clip slots**: a placeholder ships, and a CapCut guide gives the timecodes (`references/4-video.md`). From 2026-10-06.

## Questions to settle the open items

Ask one or two at a time, grill-me style:
- "Is there a colour you want people to associate with you? Or should we keep the ink / paper / oxblood look from the Latham video?"
- "Circle or rounded square for your bubble? I can show both on the same frame."
- "Do you want a 3–5 second signature cold open, like a sting with your name, or straight in?"
- "Is there a visual motif we can repeat in every cut scene: a place, an object, a colour grade?"
- "Music: none, a subtle bed under the whole thing, or only under the cut scenes?"

Log each answer here, changing "open" to "locked" with the date.
