---
description: Render the deck and run FLPT's layout check
argument-hint: "[episode folder]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/tools/flpt-check-deck.js":*), Read(//**/presentation/slides/*.png)
disable-model-invocation: true
---
Run `node "${CLAUDE_PLUGIN_ROOT}/tools/flpt-check-deck.js"` with the episode folder, if the user gave one (here: $ARGUMENTS); without one it uses the current episode. Report the problems as a short list, and open two or three of the rendered slides with Read so the user sees them. Fix nothing unless they ask.
