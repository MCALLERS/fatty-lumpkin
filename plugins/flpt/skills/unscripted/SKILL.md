---
name: unscripted
description: Turn bullets or a polished draft into narration that sounds like a real person riffing live, off the cuff, a little imperfect (a "B+ / 85 out of 100" delivery), with speech-engine delivery tags like pauses and breaths. Use this whenever writing or fixing a script that will be spoken, especially an AI-avatar or TTS narration, a talk, a Loom, a podcast segment or a voiceover, and whenever the user says a script sounds scripted, rehearsed, too polished, too punchy, "AI", "slop", "on the nose" or "like a TED talk", or asks to make it rougher, looser, more natural or more like them talking.
---

# Unscripted

The goal is narration that sounds like a smart person glancing at their bullets and talking, not reading. It's off the cuff and a bit imperfect: roughly a **B+, 85/100**. The polish lives in the thinking, not the sentences.

Polished AI prose fails aloud for predictable reasons:
- symmetrical sentences
- rule-of-three lists
- zingers at the end of every paragraph
- "It's not X, it's Y"
- perfect transitions
- no hesitation at all

Real speakers restart, hedge, approximate, circle back, and leave a thought slightly unfinished. Listeners trust that more.

## Work from the bullets, not the polished draft

If there's a polished draft, don't "rough it up" line by line, because that produces polished text with "um"s sprinkled in. Instead:

1. **Pull out the facts.** Extract what each slide must convey: the facts, numbers, the one point, and the anecdote.
2. **Riff each slide from those notes.** Picture the presenter looking at the slide and talking to three colleagues.
3. **Check the facts again.** Roughness is in the delivery, never in the facts. Every name, number and quote stays exactly right, and any quoted words stay verbatim.

## The toolkit (use a few per slide, not all of them)

| Move | Example | Rate |
|---|---|---|
| Plain, thinking-out-loud openings | "So, why law?" / "Okay, this one's kind of the heart of it." | most slides |
| Discourse markers | so, okay, right, now, look, I mean, you know | about 1 per 40 words |
| Self-repair and restarts | "It's, well, it's not really a skill thing." | 1–2 per slide |
| Hedges and approximations | "something like", "I think", "roughly", "kind of", "like three years ago" | a few |
| Asides and callbacks | "remember the Kirkland thing from a minute ago" | occasional |
| Pointing at the slide | "you can see it here", "this chart, the left side…" | where it's natural |
| Uneven rhythm | a long run-on joined with "and", then a fragment | always |
| Losing the thread, then catching it | "…where was I. Right." | at most once a video |
| Casual numbers | "fifteen, fifteen and a half billion" | where precision isn't the point |
| Delivery tags | a pause or a breath (see Tags; laughs are paused) | 1–3 per slide |

Things to cut or defuse:
- stacked rhetorical questions
- rule-of-three lists (keep two, or four, or one)
- "Here's the thing", "Let's dive in", "At the end of the day", "game-changer"
- em-dash drama
- aphorisms at the end of paragraphs
- perfect parallel structure
- every paragraph ending on a punchline

Allow **one** memorable line per slide at most, and say it plainly. Don't wind up to it.

## Natural mode (roughness 3½, the user's default from 2026-10-06)

The user asked to go further than the B+ riff: "natural moments where the narrator isn't so scripted: pauses, a laugh, ums, taking a beat to think." The moves:

| Move | How | Rate |
|---|---|---|
| **um / uh** | Mid-sentence, at the start of a thought or before a word you're choosing. Never on a number, a name or a quote. Never two in a row. | about 1 per 130–150 words of script (≈15 in a 13-minute talk): more on story and opinion slides, fewer on dense number slides |
| **Thinking beat** | `[pause]` then "Hmm." then `[short pause]`, then "how do I put this…" or "let me back up". | 1–2 per talk |
| **Laugh: paused (2026-10-07)** | Don't write `[laughs]` or `[chuckles]`. The user watched the series and felt the engine's laughs didn't land ("everything else works great"). Keep the joke and let a pause carry it. Turn laughs back on only if the user asks. | 0 per talk |
| **Self-repair** | "It's, well, it's not really…" / "he was, uh, he was right." | 1–2 per slide |
| **Trailing off** | "…and the whole dilemma just kind of… goes away." | occasional |
| **Asides to the room** | "every lawyer here knows this", "honestly", "I love this one". | a few per talk |

- **Voice choice.** The HeyGen voice on the `starfish` engine speaks written ums but drops `[laughs]`.
  - HeyGen's `elevenlabs_v3` engine and the Gemini clone perform laughs and breaths. The user chose by ear and picked **B, HeyGen on `elevenlabs_v3`** (2026-10-06; samples in `shadow-series/research/voice_test/`). It's now the default in `presenter.env`.
  - Laughs are paused on every voice from 2026-10-07: keep the joke and let the pause carry it.
- **Calibration (2026-10-06, *The Shadow of the Future*).** Written ums add up fast, because the engine voices every one. At about 1 per 140 words, together with the self-repairs, pause tags and asides, there's some disfluency every 40–60 words, which sounds like a person thinking.
  - The voice test ran ums at about 1 per 20 words to stress the engine. That's roughness 5, a demo, not a delivery.
  - First drafts tend to undershoot: about 1 per 300 words, or six in a whole talk. Count with `shadow-series/research/count.py`.
- **Still 80–88 on the self-check.** Natural mode adds texture, not mess. If a slide reads like a parody of hesitation, cut half the fillers.

## The user's own verbal signatures

When the script is for this user (their talks, their avatar), use their real habits. These come from how they actually present (noted 2026-09-27) and override the generic list rules above.

| Habit | How to use it | Rate |
|---|---|---|
| **"It's like, x, y, z."** Unpacking an idea into concrete examples. | "It's like, the redlines, the issue lists, the emails, the closing sets." It's their natural list form, so the rule-of-three caution doesn't apply. Keep the items short and concrete, 2–4 of them, loosely parallel rather than polished. It works best right after an abstract claim. | a few per talk (about one every 3–4 slides), never twice on one slide |
| **"…my dude."** Tacked onto the end of a line for impact. | Save it for a real payoff: the turn of the talk or a punchline the room will enjoy. Never in the opening, never on a serious or sensitive point, never stacked next to another memorable line. For example: "And that's the whole game, my dude." | **at most once per presentation**; zero is fine |

Don't overdo it. More than about one filler per 25 words, constant "um"s, or fake stumbles on every sentence reads as parody. TTS engines also render heavy "um/uh" badly, so a pause tag usually works better than a written "um".

## Dial

The default roughness is **3 of 5**:
1. Clean conversational.
2. Relaxed.
3. **B+ riff.** The default.
4. Loose, noticeably unplanned.
5. Rambling. Rarely wanted.

The user can ask for any level, either for a whole script or for one slide. Openings and emotional beats can run a notch rougher, and dense factual slides a notch cleaner.

## Tags

Use the speech engine's own markup. The legend per provider is in the avatar-presentation skill at `references/tts-tags.md`. When writing a script, use these neutral tags, which the video pipeline translates per provider and never reads aloud:

- `[pause]`, `[short pause]`, `[long pause]`
- `[breath]`
- `[laughs]`, `[chuckles]`: **paused from 2026-10-07.** Don't use them unless the user asks again.
- `[sighs]`

HeyGen speech only honors pauses, as `<break time="0.5s"/>`. Gemini and ElevenLabs v3 support more expressive tags. Keep to 1–3 tags per slide; a pause before a key point beats a laugh.

## Self-check before handing it over

1. Read each slide aloud in your head at about 150 words a minute. Anywhere that sounds like reading, break it up.
2. Score the slide from 0 to 100 for "sounds unscripted but competent."
   - Above 90, it's too polished: roughen it.
   - Below 75, it's too messy: tidy it.
   - Aim for 80–88.
3. Confirm the facts and numbers against the bullets or the source, and that every quoted fragment is verbatim.
4. For this user's scripts, count the verbal signatures across the **whole** script:
   - "It's like," appears a few times, spread out, never twice on one slide.
   - "my dude" appears once at most.
5. Show the user the script and invite live edits. Say which roughness level you used and where "my dude" landed, if anywhere.

## Example

**Before (polished, reads as AI):**
"Here's why law is such a clean lens. Every business competes in some arena and uses strategy and tactics to deliver a product. A law firm's product is the strategy and tactics. It's a pure play. Its whole job is advising clients how to win."

**After (roughness 3):**
"So, why law? [pause] I mean, part of it's just... it's what I know. But it's also, okay, think about any business. They're out there competing, right, and they use strategy and tactics to, you know, build the thing and sell it. With a law firm it's kind of flipped. The strategy is the product. That's basically the whole job, telling clients how to win."

For AI-tell detection in written copy, the `humanizer` skill's pattern list still applies. This skill adds the spoken, riffing layer on top.

## Lines for the episode wrapper (added 2026-10-12)
In a series, the talk sits inside a wrapper: cards, stingers, bookend scenes. See `avatar-presentation/references/wrapper-and-extras.md`. A few rules for writing around it:
- **Announcer and sign-off lines are deadpan, and one sentence.** The frame does the joke: "Episode two… will begin momentarily." "Thank you for your attention to this matter." No natural-mode ums here: these are the "official" voice.
- **Heckler stingers are 2–6 words,** reacting to something just said: "Did you say, Hobbits?" "I believe it's pronounced…" Write them as their own lines, in their own file. Never put them in the presenter's script.
- **Leave room for punctuation.** Where an interruption, a reaction clip or a B-roll payoff will be cut in, let the narration land a complete thought and add a `[short pause]` after it.
  - Mark the spot with a `>` stage note (`INTERRUPTION:`, `REACTION SLOT:`, `B-ROLL PAYOFF:`).
  - The talk must still make sense with nothing inserted.
- **Bookend dialogue for real people is theirs to write.** Draft only when asked, and mark your additions *(added)*.
