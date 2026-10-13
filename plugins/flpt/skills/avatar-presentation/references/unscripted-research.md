# Research: making narration sound unscripted (the "B+ / 85" delivery)

Researched 2026-09-27 as input for the skill that writes the talk script; the skill itself belongs to the main agent. The goal is the feel of a person riffing live on their own bullets: public-speaking's *extemporaneous* delivery, not a manuscript read aloud and not a stand-up bit.

## The best three sources

1. **Google, Gemini 3.8 TTS prompting guide (Sept 2026).** This is the engine the user wants to use, and it has the most directly actionable advice.
   - Its recommended workflow says to write the text as "a real spoken transcript" including disfluencies (example: "Oh uh yeah I think... hm, so that's interesting").
   - Point-in-time `<tags>` for breaths and pauses.
   - Keep the `style` field empty or one short constant string.
   - CAPS for emphasis.
   - https://ai.google.dev/gemini-api/docs/speech-generation (sections "Prompting guide" and "Recommended workflow")
2. **The psycholinguistics of disfluency.** Fillers and markers have jobs, and placement follows those jobs:
   - Clark & Fox Tree (2002), *Using uh and um in spontaneous speaking*, Cognition 84: *uh* signals a short delay and *um* a longer one. http://www.columbia.edu/~rmk7/HC/HC_Readings/Clark_Fox.pdf
   - Fox Tree & Schrock (2002), *Basic meanings of you know and I mean*, J. Pragmatics 34: *I mean* forewarns an adjustment; *you know* invites the listener to fill in the connection. https://www.maryvillecollege.edu/wp-content/uploads/Faculty/BehavioralSciences/cschrock/Fox-Tree-and-Schrock-2002.pdf
   - Corley, MacGregor & Donaldson (2007), *It's the way that you, er, say it*, Cognition: a word right after "er" is remembered better, probably through re-oriented attention. https://www.researchgate.net/publication/6625989_It's_the_way_that_you_er_say_it_Hesitations_in_speech_affect_language_comprehension
   - Bortfeld et al. (2001), *Disfluency rates in conversation*, Language and Speech: about 6 disfluencies per 100 words in conversation (men 6.8, women 5.1), fillers about 2–3 per 100 words, repetitions about 1.5 per 100 words. Rates rise with planning difficulty. https://doi.org/10.1177/00238309010440020101
3. **Studies of LLM disfluency insertion (2025).** These give the calibration warning:
   - Hassan, Lison & Halvorsen, *Enhancing Naturalness in LLM-Generated Utterances through Disfluency Insertion*: perceived spontaneity rose significantly and intelligibility dipped slightly. The fine-tuned LLM **over-generated**, producing 12.9 typical disfluencies per sample against 5.0 in human speech. Taxonomy: repetition, substitution, filled pause, insertion, speech error. https://arxiv.org/abs/2412.12710
   - Yoshioka et al. (2025), lecture speech: real lectures run about 1.3 fillers per sentence, and **explicitly placed** disfluency tags beat letting the TTS improvise them. https://www.emerald.com/atsip/article/14/1/1/1358568/Text-and-Speech-style-Control-for-Lecture-Speech

**Supporting sources:**
- Biber's spoken-vs-written register work. The features that mark "involved" speech are contractions, present tense, discourse particles, general hedges, *that*-deletion and indefinite pronouns. https://jan.ucc.nau.edu/biber/Biber/Biber%20et%20al%202002.PDF
- **blader/humanizer**, the Claude Code skill built on Wikipedia's "Signs of AI writing". It is the ancestor of the user's local `humanizer`. https://github.com/blader/humanizer
- **TenexTony/scriptwriter**, for the principle "your phrasing stays yours": it interviews for the user's own words and marks AI-added lines. https://github.com/TenexTony/scriptwriter
- **A counter-example:** the reverse-engineered NotebookLM prompt leans on stock affirmations ("Exactly!", "You've hit the nail on the head"). Formulaic disfluency becomes a new AI tell. https://nicolehennig.com/notebooklm-reverse-engineering-the-system-prompt-for-audio-overviews/

## Techniques worth adopting

1. **Two passes, in this order.**
   - (a) Strip written-register AI tells with the local `humanizer`: rule of three, "It's not X, it's Y", aphoristic closers, inflated vocabulary, em-dash stacks.
   - (b) Then "speechify".
   - Adding "um"s to slop just gives you slop with "um"s in it.
2. **Riff from the bullets, not from polished prose.** Generate each slide's narration from its bullets plus the user's notes, with the frame "you're talking this through to a colleague for the first time". Don't rewrite a finished paragraph. Keep the user's own recurring words and phrases. If a recording of the user exists (an old Loom), transcribe it and harvest their personal filler inventory and rate ("so", "right", "basically", "kind of").
3. **Shift the register, following Biber.**
   - Contractions everywhere, present tense, "I" and "you".
   - *That*-deletion ("I think it works").
   - Short clauses chained with *and, so, but*.
   - Left-dislocation ("This number, it's the one that…").
   - Vague approximators ("about a third", "a bunch of", "or so") wherever precision isn't the point.
   - Questions to the audience ("right?", "does that make sense?"), used rarely.
4. **Set a budget, then spend it at the planning points.**
   - Conversation runs about 6 disfluencies per 100 words. For a B+ talk, **aim for roughly 2–3 per 100 words**, about 1 or 2 per slide paragraph. This number is a recommendation derived from the studies, not a measured norm.
   - **Cluster them where a real speaker plans:** the start of a new slide or idea, just before a technical term, a name or a number, and the switch from explaining to opinion. Never spread them evenly, because uniform spacing is itself a tell.
   - Cap them. LLMs over-insert, so do a count pass after drafting.
5. **Use each device for its job, per Clark & Fox Tree and Fox Tree & Schrock.**
   | Device | Job |
   |---|---|
   | *uh* | a brief word search, just before a word |
   | *um* | a bigger pause, before a new idea |
   | *oh* | a real-time realization or recall |
   | *I mean* | an adjustment is coming (a repair) |
   | *you know* | let the listener supply the link |
   | *so / okay so* | launch a topic |
   | *anyway* | return from an aside |
   | hedges (*I think, probably, kind of*) | stance, not uncertainty about facts |
6. **Mix the disfluency types (Hassan et al.'s taxonomy):**
   - filled pauses
   - a word repetition ("the the")
   - a **self-repair** ("it's three — sorry, four — steps")
   - a **restart or abandoned clause** ("So the reason we… let me back up.")
   - a **trailing thought** ("…which, yeah.")
   - an aside ("side note — ")

   About one repair and one restart per 150–250 words is plenty.
7. **Put one hesitation before each slide's key word, and only one.** A filler just before the takeaway word makes it *more* memorable (Corley et al. 2007). Use it once per slide at most.
8. **Kill the polish.**
   - No punchlines.
   - No "Here's the thing:".
   - No mic-drop closers.
   - No perfectly parallel triplets. Let a list trail off ("cost, time, and, uh… you get the idea").
   - End slides on a plain hand-off ("Okay. Next one." or "Let me show you.").
9. **Facts stay exact.** This is the accuracy ground rule. A repair can land on the correct figure, but no disfluency may make a load-bearing number, name or quote ambiguous. The final stated version is always the verified one.
10. **Render it with the engine's own controls.**
    - **Gemini 3.8:**
      - Disfluencies go in the verbatim text.
      - `<short pause>`, `<breath>`, occasionally `<chuckle>`, and at most one `<laugh>` or `<sigh>` in a whole talk.
      - `speech_metadata.style` stays empty or one constant string, such as `"casual, thinking out loud"`.
      - CAPS on one word per slide at most.
      - Tags are angle-bracket style. The user's `[laughs] [sighs] [pause]` map to `<laugh> <sigh> <short pause>`. See `voice-options.md`.
    - **HeyGen TTS:** only `<break time="0.4s"/>` plus punctuation (ellipses, dashes).
11. **Listen before rendering video.** Synthesize the audio first (it's cheap), have the user listen to one or two slides, and tune the density: more rough or less rough. Avatar renders happen only on approved audio.
12. **An "85/100" check** to run on each slide:
    - Would a person say it without notes?
    - Is there at least one moment of visible thinking?
    - Is there any line that sounds written?
    - Is any fact blurred?
    - Does it end on a hand-off, not a zinger?

## Gaps and caveats

- **The user's local `humanizer` was not read.** The read was blocked by this session's permission classifier. What's known comes from its skill description: 36 patterns, Edit and Detect modes, a script mode, a self-check pass, and "the minimum effective edit that keeps the writer's voice". The main agent should read it directly when wiring pass 1.
- The 2–3 per 100 words target is an informed recommendation. Validate it by ear with the user on the first talk and record the preferred density in the presenter profile.
- The disfluency research is mostly on conversation, plus one lecture study on Japanese. No English study of TTS presentations with a "B+" disfluency target was found.
