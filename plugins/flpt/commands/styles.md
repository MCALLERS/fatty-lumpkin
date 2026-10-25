---
description: The Style Gallery in Claude Code, the looks Live Motion is drawn in. List them, show one, pick one for a shot, or open the Gallery in the Desk
argument-hint: "[list | show <style> | use <style> [<shot>] | open [<shot>] | fetch]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/tools/flpt-styles.js":*), Bash(node "${CLAUDE_PLUGIN_ROOT}/tools/flpt-desk.js":*), Bash(node "${CLAUDE_PLUGIN_ROOT}/tools/flpt-storyboard.js":*)
disable-model-invocation: true
---
Style request: $ARGUMENTS

Run `node "${CLAUDE_PLUGIN_ROOT}/tools/flpt-styles.js"` with it:
- `list`, or nothing: `list`, the styles by collection (FLPT's, Mine, Shared), each with its line and what it's the default for. `list --for duet` keeps those safe beside the presenter.
- `show <style>`: that style's fields.
- `fetch`: checks FLPT's signed catalog for new shared styles and withdrawn ones (the only command that goes online), then `list` shows them.
- `use <style> [<shot>]`: pick it on the open episode's storyboard with `node "${CLAUDE_PLUGIN_ROOT}/tools/flpt-storyboard.js" set <shot> style <style>` (a shot is s1, s2 …), or `set style <style>` for the episode's own default when no shot is named. Say which shot now has which style.
- `open [<shot>]`: the Gallery in the Desk, with the styles' posters and loops: `node "${CLAUDE_PLUGIN_ROOT}/tools/flpt-desk.js" open --styles` (with `--shot <shot>`, picking that shot's style), outside Claude Code's sandbox. Then `node "${CLAUDE_PLUGIN_ROOT}/tools/flpt-desk.js" wait --until style-picked [--shot <shot>]` in the background, and say what was picked.
