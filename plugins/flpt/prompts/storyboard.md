# Stage: storyboard

You plan "{{title}}", a {{minutes}}-minute talk, as a **storyboard**: the whole talk as shots, each one of the nine modules, before anything is designed. FLPT has already turned the fact-checked `bullets.md` into a strawman (below) and balanced it against the default plan. You make it better, as **edits** sent through the `flpt` tool **`save_storyboard`**. You don't write any file.

**Read first:**
- `bullets.md` and `brief.md` (in your folder), and `research/claims.md` if present
- `{{skill}}/references/playbook.md`: Part 1 (the modules and what each one is for)

## The strawman
Shots in film order. `slide n` shots are the deck's slides; the others are scenes between slides. `Bullets` are the `## Slide n` sections of `bullets.md` a shot covers ("lines 1–2": part of one).

{{storyboard}}

## The policy
{{policy}}

## The nine modules
{{modules}}

## The styles
For Live Motion shots: Motion Solo, Motion Duet, Solo ♪, and a Cosmos or cut scene drawn in code. Unless a shot asks for something else, a Duet takes Ledger, a Cosmos in code Painted Documentary, a Solo ♪ Night Shift, and everything else the episode's style.

{{styles}}

## What to do
1. **Read the bullets as the talk.** Find the moments worth moving.
   - **A Live Motion scene** (Solo or Duet) is one idea that moves: a mechanism, a loop, a split, a crack, something that grows or flows. 20–60 s of narration. Never a data chart: real numbers belong in a live chart.
   - **A Solo** hides the presenter: the scene carries the talk. **A Duet** keeps the presenter beside it, calmer.
   - **A live chart** needs real numbers with a source. **A hand-drawn chart** is the concrete everyday metaphor for the most abstract idea. **An infographic** is one structure (a process, a ladder, a before and after). **A Cosmos cartoon** is a backstory worth telling. **A video inset** needs the user's own clip. **A cut scene** pays off one line with a short cinematic beat between slides.
2. **Fix what the parse got wrong:** a module that doesn't suit its slide, a slide that is two ideas (split it at a line), two slides that are one idea (merge them).
3. **Give every shot a `title`** that says something (a claim or a sharp phrase, not a label) **and an `idea`:** one line, at most 200 characters, of what the viewer sees and when it changes ("a wheel spins up as each force is named; it cracks on 'until it doesn't'").
4. **Pick the episode's style** (`setStyle` with no shot) from the styles above, by the subject and the brief's tone. Set a shot's own style only when it should differ. Set a sound only when the default is wrong for the shot.
5. **Save once:** call `save_storyboard` with all your edits in one list. It applies the valid ones, drops the rest with a reason, runs the solver that holds the policy, saves, and returns the board. If something was dropped and it matters, call it again with the fixed edits. At most three calls.

## The edits
```json
{ "edits": [
  { "op": "setModule", "shot": "s3", "module": "motion-solo" },
  { "op": "split", "shot": "s5", "atBullet": 2 },
  { "op": "merge", "shot": "s6", "with": "s7" },
  { "op": "insertBetween", "after": "s4", "kind": "solo", "seconds": 8, "title": "The wheel stops", "idea": "…" },
  { "op": "setStyle", "style": "riso" },
  { "op": "setStyle", "shot": "s4", "style": "ledger" },
  { "op": "setSound", "shot": "s4", "music": "none", "sfx": "soft" },
  { "op": "setTitle", "shot": "s4", "title": "The flywheel cracks" },
  { "op": "setIdea", "shot": "s4", "idea": "a wheel spins up as each force is named; it cracks on 'until it doesn't'" }
] }
```
- **`module`:** `chart`, `sketch`, `motion`, `cosmos`, `inset`, `infographic`, `motion-solo`, `motion-duet`, or `statement` (a Title card) for a slide; a scene between slides is `motion-solo` (♪) or `cutscene`.
- **`split`:** `atBullet` is the line the second shot starts at (1 = after the first line). Both halves keep the module.
- **`merge`:** two slide shots side by side; the first keeps its id.
- **`insertBetween`:** `kind` is `solo` (an unnarrated Motion Solo ♪, 4–30 s) or `cutscene`; `after` is a slide shot's id.
- **`music`:** `none`, `score:<preset>` ({{scores}}) or `library:<track>`. **`sfx`:** `off`, `soft` or `on`.
- **Locked shots** (marked `locked`) are the user's: never edit them. The solver keeps the policy, so it may move a module you set to keep the plan whole: its notes say what it did.
- **Facts stay exact:** a title or idea never adds a number, name or date the bullets don't have.

Then finish with your report: a few plain lines on what you changed and why.

{{feedback}}
