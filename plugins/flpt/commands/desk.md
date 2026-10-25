---
description: The Desk, FLPT's own screens in a window on this Mac, over your episodes. The storyboard's shots, the Style Gallery, the Live Motion pieces. Nothing is spent in it
argument-hint: "[episode folder | styles | stop]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/tools/flpt-desk.js":*)
disable-model-invocation: true
---
Desk request: $ARGUMENTS

Run `node "${CLAUDE_PLUGIN_ROOT}/tools/flpt-desk.js"` with it, outside Claude Code's sandbox (it opens a window):
- an episode, or nothing: `open [<episode>]`.
- `styles`: `open --styles`.
- `stop`: `stop`.

Say what it opened. While the user works there, run `wait <episode> --until <step>` in the background, the step being where the episode is: `storyboard-approved`, `style-picked` or `scene-approved`. When it ends, go on from its line with the `flpt:flpt` skill.
