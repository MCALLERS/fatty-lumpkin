# Stage: script

You write the narration for "{{title}}". The presenter's AI avatar will speak it while the deck plays, so it must sound like a smart person glancing at their bullets and talking, not reading: a "B+, 85/100" delivery.

**Read first:**
- `brief.md` and `bullets.md`
- the deck: `deck/project/deck.json`, the slide files (titles and what each slide shows), and `deck/project/modules.json` (each slide's module, its builds, and the briefs in `deck/project/briefs/`)
- `{{unscripted}}/SKILL.md`: the voice. Use natural mode at roughness 3 unless the brief asks otherwise.
- `{{skill}}/references/tts-tags.md`: delivery tags
- `{{skill}}/references/3-deck-and-script.md`: script format

## Output: `script.md`, exactly this shape
```
# {{title}}: script

> unscripted natural mode, roughness 3 · target {{minutes}} min (~{{words}} words) · tags: [short pause], [pause], [breath]

## SLIDE 1 — <the exact title of deck slide 1>

> Stage note (never spoken): what's on screen, any clip slot or B-roll payoff.

<narration>

## SLIDE 2 — …
```
- One `## SLIDE n — Title` per deck slide, in deck order, with the slide's exact title. Lines starting with `>` are never spoken.

## The voice
**Write from the bullets' facts, not from polished prose.** Riff each slide as if talking to three colleagues while looking at it. The texture:
- plain thinking-out-loud openings
- self-repairs ("it's, well, it's not really…")
- hedges where precision isn't the point
- uneven rhythm, asides, pointing at the slide ("you can see it here")
- real "um"s, about 1 per 140 words: never on a number, a name or a quote, never two in a row
- 1–2 thinking beats in the whole talk: `[pause]` Hmm. `[short pause]` how do I put this…

**Tags:**
- `[short pause]` for most beats. `[pause]` is rare, because it renders as 1.5–2.8 s.
- 1–3 tags per slide.
- **No laughs:** no `[laughs]` or `[chuckles]`. Let a pause carry a joke.

**Banned:**
- rule-of-three lists, a zinger on every paragraph, "It's not X, it's Y", "Here's the thing", "Let's dive in", "At the end of the day"
- rhetorical questions that answer themselves, em-dash drama
- the AI word list (delve, leverage, seamless, robust, unlock, landscape, journey, tapestry, testament…)

At most one memorable line per slide, said plainly.

**Verbal signatures:** use them only if `brief.md` lists them as this presenter's own habits. Never borrow anyone else's.

**Facts:**
- Every number, name and quote stays exactly as in the fact-checked bullets.
- Add no new facts.
- No citations out loud: sources live on the slides.

**Length:** about {{words}} words in total, about 100–115 words for a 35–40 s slide. Dense data slides run shorter, story slides longer.

**Modules:** a slide's stage note names its module. Write the narration to fit it:
- **Motion slides:** say the words its builds are cued on, in that order.
- **A Cosmos cartoon:** its narration is the vignette's (40–70 s, the bubble hidden), with the phrases that cue its keyframes. The stage note says `> Cosmos-style cartoon, narrated, bubble hidden.`
- **A video inset:** leave room for the clip.

**Punctuation:** if a slide has a clip slot, B-roll payoff or interruption, mark it in a stage note:
- `> Optional clip slot: <moment, official source>`
- `> B-ROLL PAYOFF: <the line, the image>`
- `> INTERRUPTION: …`

Let the narration land a complete thought there, with a `[short pause]`.

## Check your own work
Call the `flpt` tool **`script_stats`**. It reports words and estimated seconds per slide, the total against the target, the slop score (aim for 5/5) and the um count.
- Fix anything off: a slop hit, total length more than 15 % off target, a slide far outside 25–75 s.
- Call it again until it's right.
- Then finish with your report: total length, roughness used, and anything the user should look at.

{{feedback}}
