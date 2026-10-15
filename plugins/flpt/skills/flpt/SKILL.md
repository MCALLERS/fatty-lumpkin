---
name: flpt
description: The Fatty Lumpkin Presentation Tool (FLPT) episode flow in Claude Code. It runs the Mac app's steps (intake, bullets, fact-check, deck, script, animate, spend, film, deliver) in chat, one approval at a time, with the seven deck modules, the user's calls, the Library and Clippy. Use for /flpt:new, "make an FLPT episode", "a Fatty Lumpkin episode", or any work on a folder that has flpt-project.json.
---

# FLPT in Claude Code

The Mac app's episode flow, run in chat. The method is in the `avatar-presentation` and `unscripted` skills. Each step's instructions are the app's own prompts, filled the way the app fills them.

**Tools.** Run each with `node`, quoting paths (`--help` shows the options):
- `${CLAUDE_PLUGIN_ROOT}/tools/flpt-episode.js`: `new`, `status`, `modules`, `call`, `prompt`, `approve`
- `${CLAUDE_PLUGIN_ROOT}/tools/flpt-film.js`: `--draft`, `--check`, `--final`, `--tighten`, `--deliver`, `--slack`
- `${CLAUDE_PLUGIN_ROOT}/tools/flpt-library.js`: `search`, `add`, `use`, `list`, `import`, `html`
- `${CLAUDE_PLUGIN_ROOT}/tools/flpt-animate.js`: an animator's tools, for a slide marked for an animation of its own
- `flpt-check-deck.js` and `flpt-script-stats.js`, in the same folder: the app's deck and script checks

## The steps
One at a time. After each one, show the user what it made and **stop for their approval**. When they approve: `flpt-episode approve <episode> <step>`. When they want changes: run the step again with their notes.

1. **Intake.** Ask only for what's missing: the title, the point, the audience, the length (3, 5, 8, 12 or 15 minutes), the tone, and what they bring (an idea, notes or a script). Then `flpt-episode new --title "…" --minutes …` and the rest (`--material-file` for pasted notes or a script). Episodes go in `~/Documents/FLPT`, like the app's.
2. **Bullets**, then 3. **Fact-check**: `flpt-episode prompt <episode> <step>` prints the step's instructions. Follow them exactly.
4. **Deck.** First show the seven modules (`flpt-episode modules`) and ask whether the user has calls, like "animate the chart in this notebook photo". Record each with `flpt-episode call`, with files by path, links or Library items. Then `prompt <episode> deck`.
5. **Script.** `prompt <episode> script`.
6. **Animate.** Only when the deck marks slides for an animation of their own (`status` says which; with none, it's approved with the script). For each: `prompt <episode> animate --slide <n>` prints the animator's instructions, with its tools as `flpt-animate` commands. Then show the user each preview. To skip them: `approve <episode> animate`. (The Mac app's Scenes step makes the deck's Cosmos cartoons and cut scenes; here they keep their placeholders. When the deck plans any, `flpt-episode approve <episode> scenes` goes on without them.)
7. **Spend.** Make the free draft (`flpt-film <episode> --draft`, in the Mac's own voice) and give the user its path. Then `flpt-film <episode> --check` for the estimate, and ask: "Film it for about N US dollars?" Stop there.
8. **Film.** Only after a clear yes in the user's own next message: `flpt-film <episode> --final --approved N`, in the background (it takes a while). Then show the video.
9. **Deliver.** New episodes tighten the film first (free: over-long pauses shortened, picture and sound kept in sync): `flpt-film <episode> --tighten on` applies it; show the video, and once the user approves it, `flpt-episode approve <episode> refine`. If they'd rather keep every pause, `flpt-film <episode> --tighten off`. Then `flpt-film <episode> --deliver`: the video, the CapCut master, the script, the player page, and the extras, levelled, with a clip guide. (The Mac app's Refine step also takes clips, transitions, music and b-roll; with nothing to add, delivering approves it on the way.) After the user's own edit, `flpt-film <episode> --slack <their export>` makes the Slack pack beside the delivery.

To pick an episode up later: `flpt-episode status <episode>`.

## Rules
- **Money.** Nothing paid runs without the user's yes to a stated amount, after the free draft and the estimate. Cartoons and cut scenes are made in the Mac app's Scenes step (Kie.ai or Higgsfield, each step priced and approved there); in Claude Code they stay briefs and placeholders.
- **Keys.** Never open, print or echo `~/.config/avatar-presentation/keys.env`: the scripts read it themselves. If a key is pasted into chat, don't repeat it; point the user to /flpt:setup.
- **Video.** Only /flpt:clip downloads video, and only when the user runs it: never run `flpt-clip.js` otherwise. You may save links and pictures (`flpt-library add <link> --crew`).
- **The Library** (`~/Documents/FLPT/Library`) is shared with the Mac app.
