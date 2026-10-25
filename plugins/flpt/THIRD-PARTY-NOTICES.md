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

<!-- notices:begin (app/scripts/notices.mjs merges docs/notices/*.md here) -->
## Also included

### cth9191/animate (parts of the Live Motion runtime, and the Riso demo kit)
The Live Motion runtime (`engine/runtime/flpt-live/flpt-live.js`, and its copies in `app/src/renderer/vendor/flpt-live/` and `site/vendor/flpt-live/`) derives its seeded random numbers (mulberry32 + FNV-1a), easings, closed-form springs, cameras and shape morph in part from cth9191/animate; the shared ink kit (`kit/ink.js`, bundled into `kits.js`) derives its hand wobble, resampling and pressure ribbon from the same project; the Riso demo kit (`engine/runtime/flpt-live/demos/kits/riso/`) is a 16:9 port of its riso style. The Live Motion scene crew's prompt (`engine/prompts/scene.md`) and the style study's (`engine/prompts/style-study.md`) quote its "Banned defaults" craft rule, credited there. Port: Bombadillo AI, 2026. The full notice travels with every copy as `LICENSE-animate.md` (and as the Riso kit's own `LICENSE`).

MIT License. Copyright (c) 2026 cth9191.

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

### ItsssssJack/claude-video-2 (Claude Video 2.0)
Parts derived from ItsssssJack/claude-video-2 (Claude Video 2.0), MIT, Copyright (c) 2026 Claude Video Studio contributors. The Live Motion scene crew's prompt (`engine/prompts/scene.md`, in the app's engine and in the plugin) takes some of its motion numbers and bans from that project's motion rules, in FLPT's own words: on a Solo, something new every 0.5–1 s in the first 3 s; a group that moves as one starts within 6 frames; a thing leaves faster than it came in; overshoot of 4 % at most; a flash is one onset, then 0.3 s or more; cut on motion; a shadow that tightens as its thing lands; and three banned defaults (linear easing on anything the eye follows, scaling up from zero, a gradient that shifts hue). Live Motion's pacing check (`engine/runtime/flpt-live/tools/pacing.mjs`, in the app and the plugin; its report in the scene crew's `render_preview` and `contact_sheet` and in the Studio's "Needs a look") rebuilds that project's idea of measuring a render's pacing from grey frames (dead gaps, too-short shots, pop-in-pop-out flashes) and some of its numbers (240 px grey frames, 14 grey levels for a pixel that moved, a 35 % cut, a 0.3 s shot), in FLPT's own code with FLPT's own measures. None of its code, pictures, videos, marks or fonts ship with FLPT.

MIT License. Copyright (c) 2026 Claude Video Studio contributors.

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

### IBM Plex Mono 2.5.0 and Fraunces 1.000 (the Live Motion demo and style fonts)
The Live Motion runtime's demo scenes (`engine/runtime/flpt-live/demos/`, shipped with the engine) set type from TrueType files, so the runtime can draw each glyph's outline the same way on every machine. The shipped styles Ledger, Painted Documentary and Night Shift (`engine/styles/ledger/fonts/`, `engine/styles/painted-doc/fonts/`, `engine/styles/night-shift/fonts/`) carry byte-identical copies of the same files, with the same license files beside them. Both fonts are under the SIL Open Font License, Version 1.1; each folder holds its license file as its authors distribute it (`LICENSE-IBMPlexMono.txt`, `OFL-Fraunces.txt`), and so does the app's small inline demo (`vendor/flpt-live/demo/`). The OFL text is in full in those files and in the interface fonts' notice.

- **IBM Plex Mono.** Copyright © 2017 IBM Corp. with Reserved Font Name "Plex". `IBMPlexMono-SemiBold.ttf` is IBM's own file from its release `@ibm/plex-mono@2.5.0` (https://github.com/IBM/plex/releases, `ibm-plex-mono.zip`, `fonts/complete/ttf/`), copied unchanged, so it keeps the name.
- **Fraunces.** Copyright 2018 The Fraunces Project Authors (https://github.com/undercasetype/Fraunces), no Reserved Font Name. `fraunces-soft-black.ttf`, `fraunces-display-semibold.ttf` and `fraunces-italic.ttf` are Modified Versions of the variable fonts in github.com/google/fonts (`ofl/fraunces`, Version 1.000;[b76b70a41]): static instances (fontTools' instancer: wght 900 / opsz 144 / SOFT 100 / WONK 1; wght 620 / opsz 144 / SOFT 30; the italic at wght 480 / opsz 72 / SOFT 60 / WONK 1), subset to Latin with kerning kept, unhinted.

### Robert Penner's easing equations
The moving slides' tween engine, flpt-tween (`engine/runtime/flpt-tween/flpt-tween.js`, and its copies in the slide starters under `engine/skills/avatar-presentation/templates/hyperframes/` and in every moving slide FLPT makes), draws its easing curves (power, sine, expo, circ, back, elastic and bounce) from Robert Penner's easing equations, each family's easeIn, easeOut and easeInOut as he wrote them: http://robertpenner.com/easing/

BSD License. Copyright © 2001 Robert Penner. All rights reserved.

> Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
>
> - Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
> - Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
> - Neither the name of the author nor the names of contributors may be used to endorse or promote products derived from this software without specific prior written permission.
>
> THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

flpt-tween's `steps(n)` follows the step easing algorithm of the W3C's CSS Easing Functions Level 1: https://www.w3.org/TR/css-easing-1/

### IBM Plex Sans 1.1.0, IBM Plex Mono 2.5.0 and Fraunces 1.003 (the interface fonts)
The app's screens set type in IBM Plex Sans and IBM Plex Mono, by IBM, and Fraunces, by the Fraunces Project; the page will use the same files through `site/tokens.css`. All three are under the SIL Open Font License, Version 1.1. They ship in `app/src/renderer/assets/fonts/`, each family's license file next to it, as its authors distribute it: `OFL-IBMPlexSans.txt`, `OFL-IBMPlexMono.txt` and `OFL-Fraunces.txt`.

- **IBM Plex Sans, IBM Plex Mono.** Copyright © 2017 IBM Corp. with Reserved Font Name "Plex". IBM's own split WOFF2 files from its releases `@ibm/plex-sans@1.1.0` and `@ibm/plex-mono@2.5.0` (https://github.com/IBM/plex/releases), copied unchanged, so they keep the name.
- **Fraunces.** Copyright 2018 The Fraunces Project Authors (https://github.com/undercasetype/Fraunces), no Reserved Font Name. A Modified Version of the variable fonts at commit 7ccdec3, made by `app/scripts/build-fonts.py`: pinned to SOFT 100 and WONK 1, the roman limited to opsz 9–72 and wght 400–600, the italic to opsz 9–72 at wght 600, subset to Latin and unhinted. `static/` holds four static instances of it for canvas (opsz 72 at 400 and 600, opsz 24 at 400, and the opsz 72 italic at 400). Each file's version string records what changed.

> -----------------------------------------------------------
> SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
> -----------------------------------------------------------
>
> PREAMBLE
> The goals of the Open Font License (OFL) are to stimulate worldwide
> development of collaborative font projects, to support the font creation
> efforts of academic and linguistic communities, and to provide a free and
> open framework in which fonts may be shared and improved in partnership
> with others.
>
> The OFL allows the licensed fonts to be used, studied, modified and
> redistributed freely as long as they are not sold by themselves. The
> fonts, including any derivative works, can be bundled, embedded,
> redistributed and/or sold with any software provided that any reserved
> names are not used by derivative works. The fonts and derivatives,
> however, cannot be released under any other type of license. The
> requirement for fonts to remain under this license does not apply
> to any document created using the fonts or their derivatives.
>
> DEFINITIONS
> "Font Software" refers to the set of files released by the Copyright
> Holder(s) under this license and clearly marked as such. This may
> include source files, build scripts and documentation.
>
> "Reserved Font Name" refers to any names specified as such after the
> copyright statement(s).
>
> "Original Version" refers to the collection of Font Software components as
> distributed by the Copyright Holder(s).
>
> "Modified Version" refers to any derivative made by adding to, deleting,
> or substituting -- in part or in whole -- any of the components of the
> Original Version, by changing formats or by porting the Font Software to a
> new environment.
>
> "Author" refers to any designer, engineer, programmer, technical
> writer or other person who contributed to the Font Software.
>
> PERMISSION & CONDITIONS
> Permission is hereby granted, free of charge, to any person obtaining
> a copy of the Font Software, to use, study, copy, merge, embed, modify,
> redistribute, and sell modified and unmodified copies of the Font
> Software, subject to the following conditions:
>
> 1) Neither the Font Software nor any of its individual components,
> in Original or Modified Versions, may be sold by itself.
>
> 2) Original or Modified Versions of the Font Software may be bundled,
> redistributed and/or sold with any software, provided that each copy
> contains the above copyright notice and this license. These can be
> included either as stand-alone text files, human-readable headers or
> in the appropriate machine-readable metadata fields within text or
> binary files as long as those fields can be easily viewed by the user.
>
> 3) No Modified Version of the Font Software may use the Reserved Font
> Name(s) unless explicit written permission is granted by the corresponding
> Copyright Holder. This restriction only applies to the primary font name as
> presented to the users.
>
> 4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
> Software shall not be used to promote, endorse or advertise any
> Modified Version, except to acknowledge the contribution(s) of the
> Copyright Holder(s) and the Author(s) or with their explicit written
> permission.
>
> 5) The Font Software, modified or unmodified, in part or in whole,
> must be distributed entirely under this license, and must not be
> distributed under any other license. The requirement for fonts to
> remain under this license does not apply to any document created
> using the Font Software.
>
> TERMINATION
> This license becomes null and void if any of the above conditions are
> not met.
>
> DISCLAIMER
> THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
> EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
> MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
> OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
> COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
> INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
> DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
> FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
> OTHER DEALINGS IN THE FONT SOFTWARE.

### The landing page (`site/`)
The page carries the Live Motion runtime (`site/vendor/flpt-live/`, with `LICENSE-animate.md` beside it; see cth9191/animate above) and the interface fonts (`site/assets/fonts/`, the app's own files with their OFL license files; see the interface fonts above). Its pictures, loops and films are renders of FLPT's shipped styles and modules: the style posters and loops (`site/assets/styles/`), the module tiles (`site/assets/modules/`), the Nine mosaic (`site/hero/film/nine.mp4`) and the premiere (`site/hero/film/premiere.mp4`, `premiere-360.mp4`), a Motion Solo in the Riso style, the cth9191/animate port (MIT); each style's own notice covers its renders. The sound is FLPT's own: the score loop (`site/assets/sound/bed.m4a`) and the premiere's score (`site/hero/film/premiere-score.m4a`) are made in code by `flpt-score`, and the voice samples (`site/assets/voices/`) are cut from the showcases' narration in the FLPT voices, made with Fish.audio's speech API on Bombadillo AI's own account.

### Rhubarb Lip Sync 1.14.0, PocketSphinx and its models, CMUdict (the cartoon presenter's lip sync)
The cartoon presenter's mouths follow the narration through Rhubarb Lip Sync 1.14.0 by Daniel Wolf (https://github.com/DanielSWolf/rhubarb-lip-sync), which recognises speech with CMU's PocketSphinx and sphinxbase, its US English acoustic model and language models, and the CMU Pronouncing Dictionary (`cmudict-en-us.dict`). FLPT ships its own WebAssembly build of Rhubarb's release source, made by `engine/tools/dev/rhubarb/build.sh` (the build's CMake file patched to drop its test target and its network fetch, a small file-location shim in place of `whereami`, no source of Rhubarb's changed): `engine/runtime/flpt-live/presenter/rhubarb/` holds `rhubarb.js`, `rhubarb.wasm` and the models in `res/sphinx/`, in the Mac app (Resources/engine) and the plugin alike. The text visemes of `engine/runtime/flpt-live/presenter/visemes.js` read the same dictionary.

Rhubarb Lip Sync is released under the MIT License. Copyright (c) 2015-2016 Daniel Wolf. Its third-party parts are released under the MIT license, a BSD license or a similar permissive license: Boost (Boost Software License 1.0; header-only), the CMU Sphinx US English acoustic model (a variation of the 2-clause BSD License, Copyright (c) 2015 Alpha Cephei Inc.), C++ Format (2-clause BSD, Copyright (c) 2012 - 2015, Victor Zverovich), CMU Flite (BSD-like, Copyright (c) 1999-2008 Language Technologies Institute, Carnegie Mellon University), the Guidelines Support Library (MIT, Copyright (c) 2015 Microsoft Corporation), libogg and libvorbis (3-clause BSD, Copyright (c) 2002-2018 Xiph.org Foundation), PocketSphinx and sphinxbase (a variation of the 2-clause BSD License, Copyright (c) 1999-2015 Carnegie Mellon University), the Sound Change Applier (Copyright (c) 2000 Mark Rosenfelder), TCLAP (MIT, Copyright (c) 2003 Michael E. Smoot), UTF8-CPP (Boost Software License), utf8proc (MIT, with Unicode data under the Unicode License; Copyright (c) 2009, 2013 Public Software Group e. V., Berlin, Germany; Copyright (c) 1991-2007 Unicode, Inc.), WebRTC's voice activity detection (3-clause BSD, Copyright (c) 2011, The WebRTC project authors) and Where Am I? (WTFPL; FLPT's build replaces it with its own shim). Every one of these license texts, in full, ships beside the build as `engine/runtime/flpt-live/presenter/rhubarb/LICENSE.md`, Rhubarb's own license file, copied unchanged.

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

The two stock presenters, Ada and Bram (`engine/runtime/flpt-live/presenter/rigs/`), are FLPT's own drawings (Bombadillo AI, 2026).

### Crosshatch (a 16:9 port of cth9191/animate's crosshatch style), with Caveat 2.000 and IBM Plex Mono 2.5.0
The shipped Live Motion style Crosshatch (`engine/styles/crosshatch/`, in the app's engine and in the plugin; its poster and loops in `app/assets/styles/crosshatch/`, the app's `Resources/styles/crosshatch/`) is a 16:9 port of the crosshatch style of cth9191/animate: its `kit.js` derives from that style's `kit.js` and the parts of animate's `kit/core.js` it draws with (the boiling ink line, the hatch, cross-hatch, coloured-pencil and stipple textures, the grain, the iris, the surfaces, the props and the hero). Port: Bombadillo AI, 2026. The full notice travels with every copy as the style's `LICENSE`.

MIT License. Copyright (c) 2026 cth9191.

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

The style sets type from TrueType files in `engine/styles/crosshatch/fonts/`, each beside its license file as its authors distribute it (`OFL-Caveat.txt`, `LICENSE-IBMPlexMono.txt`). Both are under the SIL Open Font License, Version 1.1; the full text is in those files and in the interface fonts' notice.

- **Caveat.** Copyright 2014 The Caveat Project Authors (https://github.com/googlefonts/caveat), no Reserved Font Name. `caveat-regular.ttf` and `caveat-bold.ttf` are Modified Versions of Version 2.000 (the Latin WOFF2 files FLPT already carries in its HyperFrames whiteboard example): decompressed to TrueType with fontTools, subset to Latin-1 and a few punctuation marks with their kerning kept, unhinted. Each file's version string records the change.
- **IBM Plex Mono.** Copyright © 2017 IBM Corp. with Reserved Font Name "Plex". `IBMPlexMono-SemiBold.ttf` is IBM's own file from its release `@ibm/plex-mono@2.5.0`, copied unchanged (the same file as the Live Motion demo kits'), so it keeps the name.

### cth9191/animate's cut paper (the Cut Paper style), with Caveat 2.000 and Fraunces 1.000
The shipped Cut Paper style (`engine/styles/cut-paper/`, in the app's engine and the plugin; its posters and loops in `app/assets/styles/cut-paper/`, the DMG's `Resources/styles/cut-paper/`) is a 16:9 port of the cut-paper style of cth9191/animate: its kit (torn-paper cutouts with shadows, grain, crayon and patterns; faces; the spark; people, hands and props; paper tags), its demo (the moon becomes the sun) and its rules. Port: Bombadillo AI, 2026. The full notice travels with every copy of the style as its `LICENSE`.

MIT License. Copyright (c) 2026 cth9191.

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

The style sets its type from TrueType files in `engine/styles/cut-paper/fonts/`, so the runtime can draw each glyph's outline the same way on every machine. Both faces are under the SIL Open Font License, Version 1.1, with their license files beside them (`OFL-Caveat.txt`, `OFL-Fraunces.txt`); the OFL text is in full there and in the interface fonts' notice.

- **Caveat.** Copyright 2014 The Caveat Project Authors (https://github.com/googlefonts/caveat), no Reserved Font Name. `caveat-regular.ttf` and `caveat-bold.ttf` are Modified Versions: the Latin subsets (`caveat-latin-400-normal.woff2`, `caveat-latin-700-normal.woff2`, Version 2.000) that FLPT already ships with its whiteboard example, unpacked from WOFF2 to TrueType with fontTools, outlines unchanged.
- **Fraunces.** Copyright 2018 The Fraunces Project Authors (https://github.com/undercasetype/Fraunces), no Reserved Font Name. `fraunces-soft-black.ttf` is the same static instance the Live Motion demos use (wght 900 / opsz 144 / SOFT 100 / WONK 1, subset to Latin, kerning kept).

### cth9191/animate's isometric (the Isometric style), with IBM Plex Sans 1.1.0 and IBM Plex Mono 2.5.0
The shipped Isometric style (`engine/styles/isometric/`, in the app's engine and the plugin; its posters and loops in `app/assets/styles/isometric/`, the DMG's `Resources/styles/isometric/`) is a 16:9 port of the isometric style of cth9191/animate: its kit (2:1 dimetric projection, constant hairlines, white faces that hide what is behind, rounded slabs and plates, faces with type set into them, closed-form springs, the props and the cube-bot hero), its demo (a laptop's cursor becoming a server blade) and its rules, with animate's morph renderer as `bridgeAt`. Port: Bombadillo AI, 2026. The full notice travels with every copy of the style as its `LICENSE`.

MIT License. Copyright (c) 2026 cth9191.

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

The style sets its type from TrueType files in `engine/styles/isometric/fonts/`, so the runtime can draw each glyph's outline the same way on every machine. Both families are under the SIL Open Font License, Version 1.1. Beside the fonts are `LICENSE-IBMPlexSans.txt` and `LICENSE-IBMPlexMono.txt`: the `license.txt` that IBM ships next to the TrueType files in each release (`fonts/complete/ttf/license.txt`, the same 4,360 bytes in both), copied unchanged under those names. The OFL text is in full there and in the interface fonts' notice.

- **IBM Plex Sans, IBM Plex Mono.** Copyright © 2017 IBM Corp. with Reserved Font Name "Plex". `IBMPlexSans-Light.ttf` and `IBMPlexSans-Regular.ttf` are IBM's own files from its release `@ibm/plex-sans@1.1.0` (font version 3.005), and `IBMPlexMono-Regular.ttf` from `@ibm/plex-mono@2.5.0` (https://github.com/IBM/plex/releases, `fonts/complete/ttf/`), copied unchanged, so they keep the name.

### Math (a 16:9 port of cth9191/animate's math style), with STIX Two Text 2.13
The shipped Live Motion style Math (`engine/styles/math/`, in the app's engine and in the plugin; its poster and loops in `app/assets/styles/math/`, the app's `Resources/styles/math/`) is a 16:9 port of the math style of cth9191/animate: its `kit.js` derives from that style's `kit.js` and the parts of animate's `kit/core.js` it draws with (manim's palette and rate functions, Write, the tiny TeX and TransformMatchingTex, ShowCreation, the axes, number plane and graphs, the tracking dot and readout, Flash, braces, arrows and the pi hero), and its `demo/` is a 16:9 port of that style's demo. Port: Bombadillo AI, 2026. The full notice travels with every copy as the style's `LICENSE`.

MIT License. Copyright (c) 2026 cth9191.

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

The style sets its type from TrueType files in `engine/styles/math/fonts/`, so the runtime can draw each glyph's outline the same way on every machine. The face is under the SIL Open Font License, Version 1.1, with its license file beside it (`OFL-STIXTwo.txt`); the OFL text is in full there and in the interface fonts' notice.

- **STIX Two Text.** Copyright 2001-2021 The STIX Fonts Project Authors (https://github.com/stipub/stixfonts). `STIXTwoText.ttf` and `STIXTwoText-Italic.ttf` are Version 2.13 b171, copied unchanged (the variable TrueType files; the runtime draws their default, Regular, instance). The license file carries the copyright line from the fonts' own name table and the OFL 1.1 text.

### cth9191/animate's pixel (the Pixel style)
The shipped Live Motion style Pixel (`engine/styles/pixel/`, in the app's engine and in the plugin; its poster and loops in `app/assets/styles/pixel/`, the app's `Resources/styles/pixel/`) is a 16:9 port of the pixel style of cth9191/animate: its `kit.js` derives from that style's `kit.js` (the low-res pass, the whole-pixel primitives, the palettes, Bayer dithering, the era effects, the 5x7 bitmap font, sprites, the hero, panels, captions, the stepped windows, the morphing blob and the screen effects), its demo (the moon becomes a coin) and its rules. Port: Bombadillo AI, 2026. The bitmap font is drawn from code; the style ships no font files. The full notice travels with every copy as the style's `LICENSE`.

MIT License. Copyright (c) 2026 cth9191.

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

### Riso, a shipped Live Motion style (a port of cth9191/animate's riso)
The Riso style (`engine/styles/riso/`, in the app's engine and the plugin; its posters and loops in `app/assets/styles/riso/`, the app's `Resources/styles/riso/`) is a 16:9 port of the riso style of cth9191/animate (its `styles/riso/kit.js` and the parts of `kit/core.js` it uses): the three-ink overprint model, the halftone screens, the plates and their misregistration, the dropouts, the boiled line and dry-brush rim, printed type, the bean hero and the slips. Port and additions (three faces, letter-by-letter and plate-offset type, parallax depth, the iris, drum banding): Bombadillo AI, 2026. The Motion Solo tile of the app's module picker (`app/src/renderer/assets/modules/motion-solo.mp4` and `motion-solo.jpg`) is a render of this style's `demo/`. The full notice travels with every copy of the style as its `LICENSE`, and with every fork and `.flptstyle` of it.

MIT License. Copyright (c) 2026 cth9191.

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Its fonts, in `engine/styles/riso/fonts/`, are under the SIL Open Font License, Version 1.1, each with its license file beside it as its authors distribute it (`OFL-Fraunces.txt`, `LICENSE-IBMPlexMono.txt`): `fraunces-soft-black.ttf` and `fraunces-italic.ttf` (Fraunces, Copyright 2018 The Fraunces Project Authors, no Reserved Font Name; static instances of the variable fonts, as described under the Live Motion demo fonts) and `IBMPlexMono-SemiBold.ttf` (IBM Plex Mono 2.5.0, Copyright © 2017 IBM Corp. with Reserved Font Name "Plex", IBM's own file, unchanged). The showcase and QA for the style (`app/qa/style-riso.mjs`) make a draft voice with macOS's own `say`, which isn't shipped.

### cth9191/animate's sketchbook (the Sketchbook style), with Caveat 2.000
The shipped Sketchbook style (`engine/styles/sketchbook/`, in the app's engine and the plugin; its posters and loops in `app/assets/styles/sketchbook/`, the DMG's `Resources/styles/sketchbook/`) is a 16:9 port of the sketchbook style of cth9191/animate: its kit (graphite and ink lines that boil, colour laid off the line, hatching and scribble fills, the sketchbook page with its dot grid and spiral binding, hand lettering with a highlighter, the pencil, eraser and other props, the doodle hero, the window and blob bridges), its demo (a lightbulb becomes the sun) and its rules. Port: Bombadillo AI, 2026. The full notice travels with every copy of the style as its `LICENSE`.

MIT License. Copyright (c) 2026 cth9191.

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

The style sets its lettering from TrueType files in `engine/styles/sketchbook/fonts/`, so the runtime can draw each glyph's outline the same way on every machine (animate's original used the system's hand fonts). The face is under the SIL Open Font License, Version 1.1, with its license file beside it (`OFL-Caveat.txt`); the OFL text is in full there and in the interface fonts' notice.

- **Caveat.** Copyright 2014 The Caveat Project Authors (https://github.com/googlefonts/caveat), no Reserved Font Name. `caveat-regular.ttf` and `caveat-bold.ttf` are byte-identical copies of the Cut Paper style's files (`engine/styles/cut-paper/fonts/`): Modified Versions, the Latin subsets (Version 2.000) that FLPT already ships with its whiteboard example, unpacked from WOFF2 to TrueType with fontTools, outlines unchanged.

### Whiteboard (an FLPT original style), with Caveat 2.000
The shipped Whiteboard style (`engine/styles/whiteboard/`, in the app's engine and the plugin; its posters and loops in `app/assets/styles/whiteboard/`, the DMG's `Resources/styles/whiteboard/`) is FLPT's own: its kit, doodles, stroke capitals and scenes are Bombadillo AI's, under the MIT License (the style's `LICENSE`, Copyright (c) 2026 Bombadillo AI). Its hand lettering is set in Caveat, from TrueType files in `engine/styles/whiteboard/fonts/`, so the runtime can draw each glyph's outline the same way on every machine.

- **Caveat.** Copyright 2014 The Caveat Project Authors (https://github.com/googlefonts/caveat), no Reserved Font Name, under the SIL Open Font License, Version 1.1; the license file is beside the fonts (`OFL-Caveat.txt`), and the full OFL text is also in the interface fonts' notice. `caveat-regular.ttf` and `caveat-bold.ttf` are the same Modified Versions the Crosshatch style carries (byte-identical copies): Version 2.000's Latin WOFF2 files from FLPT's HyperFrames whiteboard example, decompressed to TrueType with fontTools, subset to Latin-1 and a few punctuation marks with their kerning kept, unhinted. Each file's version string records the change.

### FLPT's web image (private; web/container)
The container FLPT's web app runs in (`web/container/Dockerfile`, linux/amd64) is built from the same pins as the Mac app and is never published: it stays in FLPT's own private registry and runs only as FLPT's service, because GPL and LGPL code is inside it (ffmpeg's GPL build, espeak-ng and phonemizer, sharp's libvips). Besides FLPT's own code, its npm packages (the table above, Electron aside) and its fonts (as listed above), it holds:

- **The base:** `node:24.21.0-bookworm-slim` (Node.js, MIT, with the licenses of what it bundles) and these Debian 12 packages with the licenses in their `/usr/share/doc/*/copyright`: bubblewrap 0.8.0 (LGPL-2.0-or-later; the render sandbox), tini (MIT), fontconfig with its DejaVu fallback fonts (DejaVu: the Bitstream Vera and Arev fonts licenses), and the shared libraries Chrome links against.
- **The toolchain,** installed by FLPT's own installer from `app/src/main/toolchain-manifest.json`'s linux-x64 pins, each checked against its SHA-256: ffmpeg and ffprobe 9.0.2 (Martin Riedl's static builds; GPL, as their builds include GPL parts such as x264), Python 3.12.15 (python-build-standalone; the Python Software Foundation License and the licenses of what the build includes) with `app/src/main/python/requirements.lock`'s packages (as above), Chrome for Testing 155.0.8059.39 and chrome-headless-shell 152.0.7977.30 (Chromium's licenses and Google's terms), Node.js 24.21.0 (MIT), and HyperFrames 0.8.80 with its npm packages from its lockfile (Apache-2.0; MIT, Apache-2.0, ISC, BSD, 0BSD and CC0; sharp includes libvips, LGPL-3.0-or-later).
- **Kokoro-82M v1.0,** the free voice on Linux: the model by hexgrad (https://huggingface.co/hexgrad/Kokoro-82M), Apache-2.0, as the ONNX export and voices file of kokoro-onnx's release `model-files-v1.0` (https://github.com/thewh1teagle/kokoro-onnx), each checked against its SHA-256 (`web/container/kokoro/model.json`). It runs in its own Python environment, installed by hash from `web/container/kokoro/requirements.lock`: kokoro-onnx 0.6.1 (MIT), onnxruntime 1.31.0 (MIT), numpy 2.5.4 (BSD-3-Clause and the licenses of what it bundles), phonemizer 3.4.0 (GPL-3.0), espeakng-loader 0.2.4 (MIT), which bundles the espeak-ng library and its data (GPL-3.0-or-later), protobuf 7.36.2 (BSD-3-Clause), flatbuffers 25.12.19 (Apache-2.0), packaging 26.3 (Apache-2.0 or BSD-2-Clause), joblib 1.6.0 (BSD-3-Clause), cloudpickle 3.1.2 (BSD-3-Clause), attrs 26.1.0 (MIT), dlinfo 2.0.0 (MIT) and typing-extensions 4.16.0 (PSF-2.0).
- **The Claude Agent SDK's** linux-x64 build of Claude Code (from `app/package-lock.json`, as on the Mac: Anthropic's terms), which the crews run on through FLPT's egress broker.

<!-- notices:end -->

## Downloaded on your Mac, not shipped
FLPT doesn't ship these tools or change them. The app downloads each from its publisher when you set it up (exact versions, checked against a SHA-256 before use: `app/src/main/toolchain-manifest.json`), and each comes with its own license. The plugin uses the same pinned tools: the Mac app's when they match its pins, else its own, downloaded the same way by `flpt-setup --install-tools`; without them it uses the tools already on your Mac, and HyperFrames through `npx`.

| Tool | Version | From | License |
|---|---|---|---|
| ffmpeg and ffprobe | 9.0.2 (static builds for macOS and Linux) | Martin Riedl, https://ffmpeg.martin-riedl.de | FFmpeg: LGPL 2.1 or later, or GPL 2 or later in builds with GPL parts such as x264, which the video pipeline uses |
| Python | 3.12.15 (python-build-standalone) | https://github.com/astral-sh/python-build-standalone | Python Software Foundation License, and the licenses of what the build includes. FLPT's own Python environment adds numpy 2.5.4 (BSD-3-Clause), requests 2.34.2 (Apache-2.0), certifi 2026.7.22 (MPL-2.0), charset-normalizer 3.5.2 (MIT), idna 3.20 (BSD-3-Clause) and urllib3 2.8.0 (MIT), installed by hash from `app/src/main/python/requirements.lock` |
| Chrome for Testing | 155.0.8059.39 | Google, https://googlechromelabs.github.io/chrome-for-testing/ | Chromium's licenses (BSD-3-Clause and the parts it includes), and Google's terms |
| Node.js | v24.21.0 | https://nodejs.org | MIT, and the licenses of what Node.js includes |
| HyperFrames (for moving slides) | 0.8.80 | the npm registry, from a pinned lockfile (`app/src/main/hyperframes/npm-lock.json`) | Apache-2.0. Its npm packages are MIT, Apache-2.0, ISC, BSD, 0BSD and CC0, and sharp includes libvips under LGPL-3.0-or-later |
| chrome-headless-shell (for HyperFrames) | 152.0.7977.30 | Google, Chrome for Testing | as Chrome for Testing |
| yt-dlp (only if you install it, for Clippy) | 2026.08.19 | https://github.com/yt-dlp/yt-dlp | The Unlicense. The macOS program bundles Python and other parts under their own licenses |

## Music and transitions
The music and transitions FLPT offers are credited in `app/assets/addons/CREDITS.md`.
