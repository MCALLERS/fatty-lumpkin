---
description: Clip one moment of a video link into your Library (Fatty Lumpkin Clippy), with its source and timestamps
argument-hint: "<link> <start> <end> [title]"
disable-model-invocation: true
---
The user asked Clippy for: $ARGUMENTS

Run, once: `node "${CLAUDE_PLUGIN_ROOT}/tools/flpt-clip.js" "<link>" <start> <end> "<title>"`, with the link, the start and end (h:mm:ss, mm:ss or seconds) and any title exactly as given; add `--wav` if they want the sound too. Then say what was clipped and where it is. If something is missing or the clip fails, say so: don't try other links or times.
