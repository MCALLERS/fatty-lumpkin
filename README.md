# Fatty Lumpkin for Claude Code

The Fatty Lumpkin Presentation Tool's method as a Claude Code plugin: Loom-style talks your own AI presenter gives over a deck where every slide moves. It runs in Claude Code, on your own Claude subscription.

## Install
```
/plugin marketplace add MCALLERS/fatty-lumpkin
/plugin install flpt@fatty-lumpkin
```
Then run `/flpt:setup`, and `/flpt:new` to start an episode.

## What you need
- A Mac with Claude Code.
- ffmpeg, Python 3, Google Chrome and Node.js (`brew install ffmpeg python node`). yt-dlp too, for `/flpt:clip`.
- Your own keys in `~/.config/avatar-presentation/keys.env`: HeyGen for filming, plus any others you use. `/flpt:setup` shows how to add them. Never paste a key into chat.
- The Mac app, for Live Motion's library music: the plugin plays the app's own tracks. Without it, a score plays instead.

## Commands
| | |
|---|---|
| `/flpt:setup` | checks the tools, and which keys are set (names only) |
| `/flpt:new` | starts an episode: intake, bullets, fact-check, deck, script, spend, film, deliver |
| `/flpt:check-deck` | renders the deck and runs the layout check |
| `/flpt:film` | a free draft and an estimate first; filming only after your yes |
| `/flpt:clip <link> <start> <end> [title]` | clips one moment of a video into your Library |
| `/flpt:library [search … \| add … \| open]` | your Library, shared with the Mac app |
| `/flpt:styles [list \| show … \| use … \| open]` | the styles Live Motion is drawn in |
| `/flpt:desk [episode \| styles \| stop]` | the Desk: FLPT's own screens in a window, over your episodes; nothing is spent in it |

Anything that costs money (HeyGen filming, any generation) runs only after you say yes to a stated amount.

Third-party notices: `plugins/flpt/THIRD-PARTY-NOTICES.md`.
