# The episode wrapper: intros, bookends, transitions, stingers, B-roll, flyers and Slack cuts

Added 2026-10-12. Learned from Michael's own CapCut edits of *The Shadow of the Future*, episodes 1–4. The evidence is in `~/Projects/fatty-lumpkin-presentation-tool/docs/research/finals-study.md`, with exact run-sheets beside it.

**The headline.** The presentation we render is only part of what the audience sees. Michael wraps it, and punctuates it, in CapCut.

How his layer grew as a share of each finished episode:

| Episode | His layer | Final length | Our master |
|---|---|---|---|
| Ep 1 | 19 % | 17:49 | 15:01 |
| Ep 2 | 32 % | 18:20 | 12:34 |
| Ep 3 | 48 % | 24:07 | 12:38 |
| Ep 4 | 52 % | 26:34 | 12:27 |

The wrapper is what turns a talk into an *episode* people watch to the end. Treat it as its own workstream: plan it with the deck, make it with the crews, and deliver it ready for the editor.

Use this file when:
- the user is making a series or a "hero" video
- they ask for an intro, cold open, bookend, transition, stinger, B-roll, flyer or Slack version
- the retro shows they built wrapper pieces by hand last time

## 1 · The episode skeleton

Every Shadow episode settled into the same shape:

`TITLE CARD → COLD OPEN → BOOKEND "before" → HAND-OFF → [ PRESENTATION + punctuation ] → REEL RUNOUT → BOOKEND "after" / B-PLOT → SIGN-OFF`

| Beat | Length | What it is | How it's cut in |
|---|---|---|---|
| **Title card** | 2–15 s | The series card: an eyebrow ("INTERVAL VIDEO SERIES"), the series title, the episode title in its own neon colour, archival art, and 5-dot progress ("2 OF 5"). | Hard cut from black. An announcer voice reads it ("Episode two… Prison Rules, will begin momentarily"). Typed-on text with typewriter clicks works well. |
| **Cold open** | 5 s – 2:30 | A gag or a short film before anything else. Ep 1: Luke at the podcast desk. Ep 2: "GOLDEN BALLS LOL", then Luke on a game-show set. Ep 3: a 2:33 LOTR-style company intro. Ep 4: a stand-up bit, then a 92 s country music video about bots. | Hard cuts. Its own music and sound. |
| **Bookend "before Part N"** | 1–3 min | The wrapper story. A recurring cast at a podcast desk carries a B-plot from episode to episode, with one-offs cut in (a phone call, a laptop agent going rogue). | Michael slices full runs himself. He cuts on lines, and drops a 1–2 s reaction or callback between them. |
| **Hand-off** | 3–10 s | Frames the talk. The Shadow frame is mandatory corporate training: "Your training video (no. 1 of 5) will begin shortly…", then the title card again and "And now, please do enjoy…". Ep 2 also ran a 2-minute company video here. | A black card plus the announcer, then a reel-runout seam into the master. |
| **The presentation** | 12–15 min | Our master (`presentation_for_editing.mov`), kept intact and punctuated (§2). | Our master is used 97–100 %. After `tighten.py`, hand trims fell from 31 s to almost zero. |
| **Reel runout** | 3 s | A cream film-leader runout overlay that marks the end of the presentation, and other big seams. | Overlay, with the cut hidden in the white flash. |
| **Bookend "after" / B-plot** | 1–7 min | The story continues and grows: a robot panel, a meltdown, a field trip to "the Shire" explaining Coase with pumpkin farms, and a market stall selling the Fatty Lumpkin Presentation Tool itself. | "Meanwhile…" or "…somewhere in the Shire…" card with a narrator voice, then the short. Cuts on dialogue, with voice effects on the robot's lines ("Drone Speaker", "Roboto"). |
| **Sign-off** | 3–35 s | A black card, typed on: "Thank you for your attention to this matter.", read by the announcer, with a music tail. Variants: "Thank you for being forced to watch Episode 3", "To be continued…", and a post-credits sting ("Where is Luke?"). | Hard cut to black. Music fades out under the type. |

Not every video needs every beat. A one-off talk might take only a title card, a cold open and a sign-off. A series earns the bookends.

## 2 · Punctuation inside the presentation

Michael punctuates our master rather than re-cutting it. These are his moves, in rough order of frequency:

1. **Reaction cutaways, hard-cut in.** 1.6–22 s film and TV moments that pause the narration (3 in Ep 1, 3 in Ep 2, none in Ep 3, 10 in Ep 4).
   - They come from the user's own library. Michael's is a catalogued "Cutaway Library" with a "good moment to use it" note per clip.
   - **FLPT and agents never fetch or bundle these** (copyright). We suggest the *moment*: "a comic hard stop after 'and that's zero'". The user supplies the clip.
2. **Clip slots, as picture-in-picture.** The slots in `CAPCUT_CLIP_GUIDE.md` were filled mostly as small PIPs, about 40 % scale in a corner, muted, rather than full frame.
   - The best placements used our geometry: the WarGames clip sat inside the little monitor drawn on the whiteboard, and the real game-show footage played inside a retro-TV sticker over our cartoon.
   - **Give inset rectangles for every slot,** not just in/out times.
3. **Character interruptions.** A cast member breaks in. Luke raised his hand mid-Part 1 ("Excusing me, I've had my hand raised for a while…"), replacing 11 s of narration.
   - Plan these at script time: mark the line the interruption replaces and give the insert's exact length.
4. **The heckler stinger.** A recurring off-screen voice with a small PIP face interjects ("I believe it's pronounced…", "Did you say, Hobbits?"). Each one is 1–3 s and cut in at a pause.
5. **B-roll that pays off a line.** Ep 4's "wiped out by space ninjas in F-16s" and "defending a castle on ground that moves" each got a 10 s cinematic shot, faded in and out.
   - **Scan the script for literal-image lines** and offer them as B-roll payoffs. They're cheap and very effective.
6. **Hold-the-slide.** To make room for an overlay montage, Michael repeated a 3.1 s stretch of the master five times. A planned freeze or loop does the same job more cleanly.
7. **Overlays and stickers** ("this is fine", a GIF), entering with CapCut animations: Old TV, TV On, Quirky Expansion; out on Black Hole, Pixel Wave.
8. **Transitions only at seams:** TV Glitch, Signal Glitch, Damaged Film, Old Film, Film Erase, Vintage Reel, Glitch Blur. Cuts inside the talk stay hard.
9. **Music in patches only:**
   - **Under the talk:** short stretches (30–70 s, often the first minute of the presentation), 5–25 dB under the voice.
   - **Elsewhere:** under story segments and end cards. Never under the whole talk.

## 3 · Cast, frame and running gags (the series bible)

**Pick a frame.** It gives every card and stinger its voice. Shadow's frame is a deadpan parody of mandatory corporate training. Its lines include:
- "Thank you for volunteering to watch this mandatory video series"
- "WARNING: Scenes contain footage of a shocking nature, will be upsetting for some (who are weak)"
- "Thank you for your attention to this matter"

Other frames that would work: a late-night show, a nature documentary, a heist.

**Cast:**
- **The presenter** (the avatar).
- **A recurring B-plot cast.** In Shadow: Luke, the eager newcomer; Michael, the host; Steve, the caller; Trevor, Luke's guide; a robot; and Karl, the laptop agent.
- **Two or three stinger voices:** an announcer, a heckler and a narrator.

**Running gags** pay off across episodes. Shadow had:
- the product itself as an in-world prop (the Fatty Lumpkin Presentation Tool)
- "Golden Balls"
- "Where is Luke?"
- the host's bot count climbing (58 → 64 → 79 → 132)

**Consent and rights:**
- **Real people** appear only with their consent; Luke and Trevor are real and agreed. A tool like FLPT offers only the user's own likeness or original characters.
- **Voices** are original or the user's own clones. Never a celebrity-named or sound-alike voice: the Cinema project already declined one on right-of-publicity grounds.
- **Keep a cast file per series** (name, look refs, voice ID, personality, catchphrases) so every bookend stays in character.

## 4 · How each piece is made

Costs are real numbers from the series where they exist, and estimates elsewhere. Quote and wait for a yes before any paid step.

### 4.1 Title cards, hand-off cards and flyers (no generation cost)
- **Build:** HTML rendered by headless Chrome. One template, a palette per episode, archival "Then" art, and a "Now" still from the bookends. Michael's series lives in `~/Projects/Cinema/productions/shorts/06-shadow-wrappers/titles/make_titles.py` and `flier/`.
- **Deliver:**
  - a 1920×1080 PNG per card
  - a 1080×1920 or 1080×3152 "tall" flier and a 16×9 series flier for Slack
  - the words as editable text (he often types his own cards in CapCut, e.g. "Meanwhile…", "change the structure… change the game")
- **The flier:**
  - names the episodes, run times and "best watched in order"
  - says "Prefer a brisker pace? Each episode also comes in a 1.25× version"
  - ends on the frame's sign-off line

### 4.2 Bookends and short films (the expensive part: price them per piece)
This is the Cinema method, proven over about 30 shorts: "Lane D" in `storyboard-to-screen` and `~/Projects/Cinema/reference/openart-dialogue-playbook.md`.

1. **Lines first.** The user gives the scene and their lines verbatim, and we write `dialogue.md`.
   - Mark our additions *(added)*.
   - Do a spoken-name pass: write phonetic spellings *inside* the quoted line. Never add a "pronounced like" sentence; that's how Smaug became "Smear".
2. **Start frames.** Nano Banana Pro 2K, two variants each, derived from an approved frame with the cast's reference photos.
   - **Likeness gate:** check faces at full resolution before animating. Back and side views drift.
   - Inserts start on the exact parent frame, so the cut is invisible.
3. **Clips.** Seedance 2.5 with native audio, one beat per 12–20 s clip (about 45 words at most), locked-off camera for dialogue.
   - Include a VOICES block naming each speaker's audio reference, and end prompts with "No music. No on-screen text."
   - Write sounds as nouns ("distant echo, no words"); a sentence gets spoken.
   - Cheap no-dialogue shots go to the cheapest provider.
   - Log every job in `jobs.json`.
4. **QC gates:** ASR with a name prompt, a voice check, a mouth-motion check, and a contact sheet. Faceless speakers need a visible "speaking tell", such as an eye strip that pulses.
5. **Fix cheapest first:** trim → swap the audio → patch the word with a voice clone → a 5–6 s close-up insert → only then re-roll.
6. **Cut:**
   - Build from an EDL with hard cuts and 40 ms audio fades.
   - A white flash marks a "snap" teleport; black marks a time jump.
   - Readable content (slides, laptop screens, equations) is composited, never generated.
7. **Deliver:**
   - **Full runs and per-scene chunks.** Michael sliced the full runs himself and never used the chunks, but chunks help a beginner.
   - **Levelled with `scripts/video/loudmatch.py`** (§5).

**Provider routing for a general tool (Michael, 2026-10-12):**
- **Default:** Kie.ai and Higgsfield.
- **Optional "film quality" upgrade:** OpenArt (Seedance 2.5 via OpenArt). It's better, but too expensive for a general tool.

**Rough costs:**

| Piece | Cost |
|---|---|
| Seedance 2.5 on Kie | about 0.32 US dollars/s at 720p, about 0.63/s at 1080p |
| Seedance 2.5 on Higgsfield | about 7 credits/s at 720p, about 12 at 1080p |
| A 60 s dialogue bookend (Kie, 720p, with about 50 % re-rolls and fixes) | about 30 US dollars |
| The same on OpenArt (the Shadow way) | 7,000–10,000 credits per minute; about 125,000 credits across the Shadow extras |

### 4.3 Transitions
- **Reel runout:** a white-burn film-leader overlay, cut in the white. It's the one transition Michael used every episode.
- **Glitch overlays** (digital fracture, signal drop, tape snap, data wipe): black-backed clips. **Tell the editor to use Screen blend.** They're HyperFrames renders with synthesised SFX, so there's no generation cost.
- **Time cards** ("Meanwhile…", "A few hours later", "…somewhere in the Shire…"): deliver a styled card *and* the words.
  - Michael preferred typing his own over a black spacer and recording the line with his narrator voice.
  - In Cinema Transition Pack 01, only card 08 ("hours later, deadpan") was used.

### 4.4 Voice stingers
- **What:** 1–4 s lines for the announcer, heckler and narrator.
- **Make them with:**
  - ElevenLabs v3 with audio tags (`[emphasis]`, `[clears throat]`, `[soft]`), or Fish Audio S2.1 Pro
  - original or the user's own cloned voices only
- **Name them for the line:** e.g. `announcer - Episode two will begin momentarily.mp3`.
- **Also use stingers to re-voice words** a generated clip got wrong, with the character's own voice clone ("Smear", "Abhors").
- **Level them** to −14 LUFS with `loudmatch.py`. Michael's arrived at −20 LUFS and needed +5 to +9 dB by hand.

### 4.5 B-roll payoffs
- 10 s, 1080p, no dialogue, one image per line: about 120 Higgsfield credits or about 6.30 US dollars on Kie.
- Two clips cost 240 credits in Ep 4.
- Fade in and out over 1–3 s.
- Offer 2–4 candidates per episode from the script's most literal, absurd or cinematic lines.

### 4.6 Music
**Sources:**
- the user's licensed library (Epidemic Sound in Michael's case)
- free tracks that need **attribution** (Scott Buckley and Kevin MacLeod are CC BY 4.0: credit them on the player page and in `CREDITS.md`)
- generated cues (ElevenLabs Music: cents)

**Deliver beds two ways:**
- **`.bed`:** −26 LUFS, under narration
- **`.full`:** −16 LUFS, for cards and montages

`loudmatch.py --bed` writes both.

**Stems at intensity levels** let the editor build up a montage. The "Crazy 8s" bed was cut into four levels.

## 5 · Levels: deliver everything ready to drop in
- **Dialogue-led pieces:** shorts, bookends, stingers and reaction clips go at **−14 LUFS integrated, −1 dBTP**, to match our master.
- **Beds:** −26 LUFS under narration, −16 for full-level moments.
- **Why:** in the Shadow finals, the extras arrived 2–17 dB quieter than the talk, so Michael made 18 manual boosts, and the exports peaked at +0.4 to +1.2 dBTP.
- **The command:** `python3 <skill>/scripts/video/loudmatch.py <files or folders> --out <folder>`. Add `--bed` for music.

## 6 · Delivery: the wrapper kit
Put everything for one episode in one named folder, and say its full path. Michael has said he "can never ever find" delivered files.

```
<Episode folder>/wrapper/
  RUNSHEET.md                beat-by-beat: in, out, file, how to cut it in, blend mode, level
  01_title-card.png (+ .txt with the words)
  02_cold-open.mp4
  03_bookend-before.mp4      full run (plus chunks/ if useful)
  04_hand-off-card.png (+ .txt)
  05_reel-runout.mp4         overlay; cut in the white
  07_bookend-after.mp4
  08_sign-off-card.png (+ .txt)
  stingers/                  announcer, heckler, narrator: levelled
  broll/                     payoff shots, each named for its script line
  beds/                      *.bed.* and *.full.*
  transitions/               glitch overlays (Screen blend) and time cards
  CREDITS.md                 music, archival, voices, consent notes
```

Then the Slack pack from the editor's final export: `scripts/video/slack_pack.py` (see `delivery.md`).

## 7 · The retro: study what the editor did
After the user finishes their edit, read it:

```
python3 <skill>/scripts/edit/capcut_study.py "~/Movies/CapCut/User Data/Projects/com.lveditor.draft/<project>" --out <folder>
```

It reports:
- the editor's layer as a share of the final
- what came before, inside and after the master
- trims and repeats inside the master
- hand gain changes over +3 dB
- captions, transitions and animations

Fold the patterns into `lessons.md`. Each time it shows the user building something by hand, that's the next thing to automate.
