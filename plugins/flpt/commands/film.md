---
description: Film the episode with your HeyGen avatar, after a free draft and an estimate you approve
argument-hint: "[episode folder]"
disable-model-invocation: true
---
Film the FLPT episode (its folder, if the user gave one: $ARGUMENTS) with the `flpt:flpt` skill's Spend and Film steps. The tool is `node "${CLAUDE_PLUGIN_ROOT}/tools/flpt-film.js" <episode>`:
1. `--draft`: the free draft. Give the user its path.
2. `--check`: show the estimate and ask, "Film it for about N US dollars?" Then stop.
3. Only after a clear yes in the user's next message: `--final --approved N`, in the background and outside Claude Code's sandbox: a dialog on the Mac then asks the user to approve N US dollars (it waits up to 2 minutes). Then show the video.
