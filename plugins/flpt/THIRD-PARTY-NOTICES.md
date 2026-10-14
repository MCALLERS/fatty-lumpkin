# Third-party notices

The Fatty Lumpkin Presentation Tool (the Mac app) and FLPT for Claude Code (the plugin) are © 2026 Bombadillo AI. They include the third-party work below, or download it on your Mac when you set them up. Each part keeps its own license.

## In the app and the plugin

### SlopMonster
The script check's slop linter (`app/src/main/slop.js`, and its copy in the plugin, `tools/lib/src/main/slop.js`) is a JavaScript port of SlopMonster's `tools/deslop.py`, by way of Present Studio: https://github.com/ItsssssJack/SlopMonster

MIT License. Copyright (c) Jack Roberts.

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

### GSAP 3.14.2
The moving slides animate with GSAP (`gsap.min.js` in `engine/skills/avatar-presentation/templates/hyperframes/live-slide/assets/` and in the `possible-worlds` and `whiteboard-sketch` examples): https://gsap.com

Copyright 2025, GreenSock. All rights reserved. Subject to the terms at https://gsap.com/standard-license (GSAP's Standard License). The license header ships at the top of each copy.

### Fonts
The moving slides use these fonts, from `engine/skills/avatar-presentation/templates/hyperframes/` (`live-slide/assets/fonts/`, `examples/possible-worlds/assets/fonts/` and `examples/whiteboard-sketch/assets/fonts/`). All are under the SIL Open Font License, Version 1.1, whose full text ships next to them:

| Font | By | License text |
|---|---|---|
| Source Serif 4 | Adobe | `OFL-SourceSerif4.txt` |
| IBM Plex Sans, IBM Plex Mono | IBM Corp. (Copyright 2017, 2019) | `OFL-IBMPlexSans.txt`, `OFL-IBMPlexMono.txt` |
| Caveat | The Caveat Project Authors (Copyright 2014) | `OFL-Caveat.txt` |

## In the app only

### Electron 44.7.0
The app is built on Electron: https://www.electronjs.org. MIT License. Copyright (c) Electron contributors, Copyright (c) 2013-2020 GitHub Inc.

Electron includes Chromium and the software Chromium uses. Their licenses ship in the app's `Contents/Resources`, next to this file: `LICENSE.electron.txt` (Electron's) and `LICENSES.chromium.html` (Chromium's, and every part it includes).

### Claude Agent SDK 0.3.296
The crew runs on Anthropic's Claude Agent SDK: `@anthropic-ai/claude-agent-sdk` and its command-line program, `@anthropic-ai/claude-agent-sdk-darwin-arm64` (in `app.asar.unpacked`, still signed by Anthropic). © Anthropic PBC. All rights reserved. Use is subject to Anthropic's legal agreements: https://code.claude.com/docs/en/legal-and-compliance (the SDK's README points to the Commercial Terms of Service, https://www.anthropic.com/legal/commercial-terms).

### The app's other npm packages
Everything else the app ships from npm, with the license each package declares (MIT, ISC, BSD and the Unlicense texts are in each package's own files, inside the app archive):

<!-- npm:begin (app/scripts/notices.mjs writes this table) -->
| Package | Version | License |
|---|---|---|
| `@anthropic-ai/claude-agent-sdk` | 0.3.296 | SEE LICENSE IN README.md |
| `@anthropic-ai/claude-agent-sdk-darwin-arm64` | 0.3.296 | SEE LICENSE IN LICENSE.md |
| `@anthropic-ai/sdk` | 0.133.0 | MIT |
| `@babel/runtime` | 7.29.10 | MIT |
| `@hono/node-server` | 2.1.4 | MIT |
| `@modelcontextprotocol/sdk` | 1.32.1 | MIT |
| `@stablelib/base64` | 1.0.1 | MIT |
| `accepts` | 2.0.0 | MIT |
| `ajv` | 8.20.0 | MIT |
| `ajv-formats` | 3.0.1 | MIT |
| `body-parser` | 2.3.0 | MIT |
| `bytes` | 3.1.2 | MIT |
| `call-bind-apply-helpers` | 1.0.2 | MIT |
| `call-bound` | 1.0.4 | MIT |
| `content-disposition` | 2.0.1 | MIT |
| `content-type` | 1.0.5 | MIT |
| `content-type` | 2.1.0 | MIT |
| `cookie` | 0.7.2 | MIT |
| `cookie-signature` | 1.2.2 | MIT |
| `cors` | 2.8.6 | MIT |
| `cross-spawn` | 7.0.6 | MIT |
| `debug` | 4.4.3 | MIT |
| `depd` | 2.0.0 | MIT |
| `dunder-proto` | 1.0.1 | MIT |
| `ee-first` | 1.1.1 | MIT |
| `encodeurl` | 2.0.0 | MIT |
| `es-define-property` | 1.0.1 | MIT |
| `es-errors` | 1.3.0 | MIT |
| `es-object-atoms` | 1.1.2 | MIT |
| `escape-html` | 1.0.3 | MIT |
| `etag` | 1.8.1 | MIT |
| `eventsource` | 3.0.7 | MIT |
| `eventsource-parser` | 3.1.1 | MIT |
| `express` | 5.3.0 | MIT |
| `express-rate-limit` | 8.7.1 | MIT |
| `fast-deep-equal` | 3.1.3 | MIT |
| `fast-sha256` | 1.3.0 | Unlicense |
| `fast-uri` | 3.1.8 | BSD-3-Clause |
| `finalhandler` | 2.1.1 | MIT |
| `forwarded` | 0.2.0 | MIT |
| `fresh` | 2.0.0 | MIT |
| `function-bind` | 1.1.2 | MIT |
| `get-intrinsic` | 1.3.0 | MIT |
| `get-proto` | 1.0.1 | MIT |
| `gopd` | 1.2.0 | MIT |
| `has-symbols` | 1.1.0 | MIT |
| `hasown` | 2.0.4 | MIT |
| `hono` | 4.13.13 | MIT |
| `http-errors` | 2.0.1 | MIT |
| `iconv-lite` | 0.7.3 | MIT |
| `inherits` | 2.0.4 | ISC |
| `ip-address` | 10.7.4 | MIT |
| `ipaddr.js` | 1.9.1 | MIT |
| `is-promise` | 4.0.0 | MIT |
| `isexe` | 2.0.0 | ISC |
| `jose` | 6.2.12 | MIT |
| `json-schema-to-ts` | 3.1.1 | MIT |
| `json-schema-traverse` | 1.0.0 | MIT |
| `json-schema-typed` | 8.0.2 | BSD-2-Clause |
| `math-intrinsics` | 1.1.0 | MIT |
| `media-typer` | 1.1.1 | MIT |
| `merge-descriptors` | 2.0.0 | MIT |
| `mime-db` | 1.54.0 | MIT |
| `mime-types` | 3.0.2 | MIT |
| `ms` | 2.1.3 | MIT |
| `negotiator` | 1.1.0 | MIT |
| `object-assign` | 4.1.1 | MIT |
| `object-inspect` | 1.13.4 | MIT |
| `on-finished` | 2.4.1 | MIT |
| `once` | 1.4.0 | ISC |
| `parseurl` | 1.3.3 | MIT |
| `path-key` | 3.1.1 | MIT |
| `path-to-regexp` | 8.4.2 | MIT |
| `pkce-challenge` | 5.0.1 | MIT |
| `proxy-addr` | 2.0.8 | MIT |
| `qs` | 6.16.0 | BSD-3-Clause |
| `range-parser` | 1.3.0 | MIT |
| `raw-body` | 3.0.2 | MIT |
| `require-from-string` | 2.0.2 | MIT |
| `router` | 2.2.0 | MIT |
| `safer-buffer` | 2.1.2 | MIT |
| `send` | 1.2.1 | MIT |
| `serve-static` | 2.2.1 | MIT |
| `setprototypeof` | 1.2.0 | ISC |
| `shebang-command` | 2.0.0 | MIT |
| `shebang-regex` | 3.0.0 | MIT |
| `side-channel` | 1.1.1 | MIT |
| `side-channel-list` | 1.0.1 | MIT |
| `side-channel-map` | 1.0.1 | MIT |
| `side-channel-weakmap` | 1.0.2 | MIT |
| `standardwebhooks` | 1.1.1 | MIT |
| `statuses` | 2.0.2 | MIT |
| `toidentifier` | 1.0.1 | MIT |
| `ts-algebra` | 2.0.0 | MIT |
| `type-is` | 2.1.0 | MIT |
| `unpipe` | 1.0.0 | MIT |
| `vary` | 1.1.2 | MIT |
| `which` | 2.0.2 | ISC |
| `wrappy` | 1.0.2 | ISC |
| `zod` | 4.6.6 | MIT |
| `zod-to-json-schema` | 3.25.2 | ISC |
<!-- npm:end -->

## Downloaded on your Mac, not shipped
FLPT doesn't ship these tools or change them. The app downloads each from its publisher when you set it up (exact versions, checked against a SHA-256 before use: `app/src/main/toolchain-manifest.json`), and each comes with its own license. The plugin uses the tools already on your Mac instead, and HyperFrames through `npx`.

| Tool | Version | From | License |
|---|---|---|---|
| ffmpeg and ffprobe | 9.0.2 (static builds for macOS) | Martin Riedl, https://ffmpeg.martin-riedl.de | FFmpeg: LGPL 2.1 or later, or GPL 2 or later in builds with GPL parts such as x264, which the video pipeline uses |
| Python | 3.12.15 (python-build-standalone) | https://github.com/astral-sh/python-build-standalone | Python Software Foundation License, and the licenses of what the build includes. numpy (BSD-3-Clause) and requests (Apache-2.0) are added to FLPT's own Python environment with pip |
| Chrome for Testing | 155.0.8059.39 | Google, https://googlechromelabs.github.io/chrome-for-testing/ | Chromium's licenses (BSD-3-Clause and the parts it includes), and Google's terms |
| Node.js | v24.21.0 | https://nodejs.org | MIT, and the licenses of what Node.js includes |
| HyperFrames (for moving slides) | 0.8.80 | the npm registry, from a pinned lockfile (`app/src/main/hyperframes/npm-lock.json`) | Apache-2.0. Its npm packages are MIT, Apache-2.0, ISC, BSD, 0BSD and CC0, and sharp includes libvips under LGPL-3.0-or-later |
| chrome-headless-shell (for HyperFrames) | 152.0.7977.30 | Google, Chrome for Testing | as Chrome for Testing |
| yt-dlp (only if you install it, for Clippy) | 2026.08.19 | https://github.com/yt-dlp/yt-dlp | The Unlicense. The macOS program bundles Python and other parts under their own licenses |

## Music and transitions
The music and transitions FLPT offers are credited in `app/assets/addons/CREDITS.md`.
