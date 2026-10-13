---
description: Check what FLPT needs on this Mac (the tools, and which keys are set, by name only)
allowed-tools: Bash(node:*)
disable-model-invocation: true
---
Run `node "${CLAUDE_PLUGIN_ROOT}/tools/flpt-setup.js"` and tell the user in a few lines what's ready and what's missing, with the fixes it prints. Never open or print the keys file, and never ask for a key in chat: keys go in through the `set_keys.py` command it shows, in the user's own Terminal.
