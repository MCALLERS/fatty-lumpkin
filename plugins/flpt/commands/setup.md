---
description: Check what FLPT needs on this Mac (the tools, and which keys are set, by name only)
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/tools/flpt-setup.js"), Bash(node "${CLAUDE_PLUGIN_ROOT}/tools/flpt-signin.js":*)
disable-model-invocation: true
---
Run `node "${CLAUDE_PLUGIN_ROOT}/tools/flpt-setup.js"` and tell the user in a few lines what's ready and what's missing, with the fixes it prints. Never open or print the keys file, and never ask for a key in chat: keys go in through the `set_keys.py` command it shows, in the user's own Terminal.

The FLPT voices (free, for a signed-in user) and Share's review queue need FLPT's sign-in: `node "${CLAUDE_PLUGIN_ROOT}/tools/flpt-signin.js" status`; to sign in, `start` (outside Claude Code's sandbox: it opens the browser and reaches flpt.bombadillo-ai.com), then `wait`; `signout` to sign out. The token stays in the plugin's own folder: never print it.
