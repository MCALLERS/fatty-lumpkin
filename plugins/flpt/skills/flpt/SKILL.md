---
name: flpt
description: The Fatty Lumpkin Presentation Tool (FLPT) episode flow in Claude Code. It runs the Mac app's steps (intake, bullets, fact-check, storyboard, deck, script, Live Motion, spend, film, deliver) in chat, one approval at a time or as Jazz, with the nine deck modules, the user's calls, the Library and Clippy. Use for /flpt:new, "make an FLPT episode", "a Fatty Lumpkin episode", or any work on a folder that has flpt-project.json.
---

# FLPT in Claude Code

The Mac app's episode flow, run in chat. The method is in the `avatar-presentation` and `unscripted` skills. Each step's instructions are the app's own prompts, filled the way the app fills them.

**Tools.** Run each with `node`, quoting paths (`--help` shows the options):
- `${CLAUDE_PLUGIN_ROOT}/tools/flpt-episode.js`: `new`, `status`, `modules`, `call`, `prompt`, `approve`
- `${CLAUDE_PLUGIN_ROOT}/tools/flpt-storyboard.js`: the plan (`show`, `set`, `split`, `merge`, `move`, `add`, `remove`, `make`, `undo`, `redo`, `approve`)
- `${CLAUDE_PLUGIN_ROOT}/tools/flpt-scene.js`: Live Motion (`pieces`, `go`, `open`, `finish`; the rest are the scene crew's)
- `${CLAUDE_PLUGIN_ROOT}/tools/flpt-styles.js`: the styles Live Motion is drawn in (`list`, `show`)
- `${CLAUDE_PLUGIN_ROOT}/tools/flpt-desk.js`: the Desk, the app's own screens in a window on this Mac (`open`, `wait`, `stop`). Nothing is spent or run in it
- `${CLAUDE_PLUGIN_ROOT}/tools/flpt-film.js`: `--draft`, `--check`, `--final`, `--restore`, `--tighten`, `--deliver`, `--captions`, `--slack`
- `${CLAUDE_PLUGIN_ROOT}/tools/flpt-library.js`: `search`, `add`, `use`, `list`, `import`, `html`
- `${CLAUDE_PLUGIN_ROOT}/tools/flpt-animate.js`: an animator's tools, for a slide marked for an animation of its own
- `flpt-check-deck.js` and `flpt-script-stats.js`, in the same folder: the app's deck and script checks

`flpt-episode status <episode>` always ends with the next move.

## The steps
One at a time. After each one, show the user what it made and **stop for their approval**, unless they chose Jazz at the Storyboard (then the steps up to Live Motion go on by themselves, as below). When they approve: `flpt-episode approve <episode> <step>`. When they want changes: run the step again with their notes.

1. **Intake.** Ask only for what's missing: the title, the point, the audience, the length (3, 5, 8, 12 or 15 minutes), the tone, and what they bring (an idea, notes or a script). Then `flpt-episode new --title "…" --minutes …` and the rest (`--material-file` for pasted notes or a script). Episodes go in `~/Documents/FLPT`, like the app's.
2. **Bullets**, then 3. **Fact-check**: `flpt-episode prompt <episode> <step>` prints the step's instructions. Follow them exactly.
4. **Storyboard.** `flpt-storyboard show <episode>` plans the talk as shots, each one of the nine modules (`flpt-episode modules` lists them), and prints it with about (≈) how long it runs and ≈ how many US dollars of the user's own Claude it takes, plus `presentation/storyboard.html` to open. Ask the user (AskUserQuestion) which way: **Let FLPT play jazz**, **User directed** or **Open the Desk**.
   - Jazz: `flpt-episode prompt <episode> storyboard` and follow it (its edits go through `flpt-storyboard save`), then `flpt-storyboard approve <episode> --mode jazz`.
   - Directed: make the user's changes with `flpt-storyboard set|split|merge|move|add|remove|make`, showing the plan after each, until they approve it: `flpt-storyboard approve <episode> --mode directed`.
   - The Desk: `flpt-desk open <episode>`, outside Claude Code's sandbox (it opens a window), then `flpt-desk wait <episode> --until storyboard-approved` in the background. The user edits and approves the plan there. When `wait` ends the plan is approved (don't run the storyboard prompt again): go on to step 5, in Jazz if its line says Let FLPT play jazz.
   - A slide with no presenter on screen (a Cosmos, a narrated Motion Solo) can have a guest narrator: `flpt-storyboard set <episode> <shot> voice <FLPT voice>|presenter|default`. It keeps an approved plan approved.
   Cosmos cartoons and cut scenes are drawn in code here (Live Motion), never generated.
5. **Deck.** First ask whether the user has calls, like "animate the chart in this notebook photo". Record each with `flpt-episode call`, with files by path, links or Library items. Then `prompt <episode> deck`.
6. **Script.** `prompt <episode> script`. In Jazz, the deck and the script go on by themselves: `approve <episode> deck --jazz`, then the same for the script.
7. **Live Motion.** The deck's Live Motion pieces (Motion Solo and Duet, Solo ♪ between slides, a Cosmos or cut scene drawn in code) are each written by the **flpt-scene-crew** subagent, never by you.
   - `flpt-scene pieces <episode>` lists them with ≈ US dollars and ≈ time. Ask once (AskUserQuestion), with the amount in the question. With a yes, `flpt-scene go <episode> --usd <that amount>`. In Jazz this is the one question before the draft.
   - For each piece: `flpt-scene open <episode> --piece <key>`, then start the crew with the Agent tool exactly as it prints (subagent_type `flpt:flpt-scene-crew`, in the foreground), and wait for it. Then `flpt-scene finish <episode>`. One piece at a time: while one is open, only its crew's files can be written. On a Mac without the FLPT app, the first `open` fetches HyperFrames (a few minutes: give the command a 10-minute timeout).
   - If the crew was stopped (Esc, a closed window) and won't come back: `flpt-scene finish <episode> --crew-gone`.
   - A slide marked for an animation of its own: `prompt <episode> animate --slide <n>` prints the animator's instructions, with its tools as `flpt-animate` commands.
   - In the Desk the user can look at the pieces and approve them: `flpt-desk wait <episode> --until scene-approved [--piece <key>]`. If it says a piece was asked for again (with notes or not), open that piece and start its crew with them.
   - Show the user the previews, then `approve <episode> animate` (Jazz: `--jazz`).
8. **Scenes.** Generated cartoons and cut scenes are made in the Mac app's Scenes step (Kie.ai or Higgsfield, each step priced and approved there). Here they keep their placeholders: `flpt-episode approve <episode> scenes` goes on without them.
9. **Spend.** Make the free draft (`flpt-film <episode> --draft`, in the Mac's own voice, Live Motion included) and give the user its path (with pieces between slides, `draft_presentation_full.mp4`: the one it prints). Then `flpt-film <episode> --check` for the estimate, and ask: "Film it for about N US dollars?" Stop there. If a check or a draft says the episode's pipeline changed, `flpt-film <episode> --restore` puts FLPT's own back (free; anything else is set aside, not deleted).
10. **Film.** Only after a clear yes in the user's own next message: `flpt-film <episode> --final --approved N`, in the background (it takes a while). A dialog on the Mac then asks the user to approve N US dollars, and waits up to 2 minutes for them; the command has to run outside Claude Code's sandbox so the dialog can open. Then show the video (with pieces between slides, `presentation_full.mp4`: the one it prints).
11. **Refine.** New episodes tighten the film first (free: over-long pauses shortened, picture and sound kept in sync): `flpt-film <episode> --tighten on` applies it; show the video, and once the user approves it, `flpt-episode approve <episode> refine`. If they'd rather keep every pause, `flpt-film <episode> --tighten off`. (The Mac app's Refine step also takes clips, transitions, music and b-roll.)
12. **Deliver.** `flpt-film <episode> --deliver`: the video, the CapCut master, the script, the player page, and the extras, levelled, with a clip guide, plus `DESCRIPTION.txt` (paste-ready, with chapters and music credits). With nothing to refine, delivering approves Refine on the way. For captions (an SRT beside the video), `flpt-film <episode> --captions on` before delivering. After the user's own edit, `flpt-film <episode> --slack <their export>` makes the Slack pack beside the delivery.

To pick an episode up later: `flpt-episode status <episode>`.

## Rules
- **Money.** Nothing paid runs without the user's yes to a stated amount, after the free draft and the estimate. Claude Code runs on the user's own Claude, so the storyboard and Live Motion say about what that comes to and ask once before Live Motion; FLPT itself pays only for filming, confirmed in the Mac's own dialog. Cartoons and cut scenes are generated only in the Mac app.
- **Scene code** is the flpt-scene-crew's alone: never write or edit a piece's `scene.js`, `beats.json` or `kit-ext.js` yourself. The scene guard (a hook) refuses writes outside the open piece's files while one is open.
- **Keys.** Never open, print or echo `~/.config/avatar-presentation/keys.env`: the scripts read it themselves. If a key is pasted into chat, don't repeat it; point the user to /flpt:setup.
- **Video.** Only /flpt:clip downloads video, and only when the user runs it: never run `flpt-clip.js` otherwise. You may save links and pictures (`flpt-library add <link> --crew`).
- **The Library** (`~/Documents/FLPT/Library`) is shared with the Mac app.
- **Sharing a style** (one of the user's own): `flpt-refs share <style id> --send` sends it to FLPT's review queue as the signed-in user (`flpt-signin`, in /flpt:setup); signed out, or when the queue can't take it now, it's exported as a `.flptstyle` file, as without `--send`.
- **The Desk** spends nothing and runs no crew: its crew, draft and film buttons say "Runs in Claude Code.", and that work stays here. `/flpt:styles` opens its Style Gallery.
