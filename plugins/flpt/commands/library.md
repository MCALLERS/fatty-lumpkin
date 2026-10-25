---
description: Your FLPT Library, shared with the Mac app. Search it, add a file or a link, or open it as a wall of pictures
argument-hint: "[search <words> | add <file-or-link> | open]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/tools/flpt-library.js":*)
disable-model-invocation: true
---
Library request: $ARGUMENTS

Run `node "${CLAUDE_PLUGIN_ROOT}/tools/flpt-library.js"` with it:
- `search <words>`: list the best matches (title, kind, source).
- `add <file-or-link>`: say what was saved. A video link is only recorded; /flpt:clip keeps one moment of a video.
- `open`, or nothing: `html --open`, which opens the Library in the browser.
