# The cartoon presenter

FLPT's stock cartoon presenters (PLAN §2.12; spike K7; W3-05): a layered rig that lip-syncs to the narration, drawn on this Mac, keyless, offline, sandboxed, free. The app's `app/src/main/presenter.js` decides who presents and runs the pass below; the pipeline's patches put the clips in the bubble.

| File | Role |
|---|---|
| `rig.js` | `flpt.rig/1`: `checkRig(rig)` (what's wrong with one), `layerFiles(rig)`, the eleven mouths (A–H, X, smile, laugh) |
| `compile.js` | `compileTrack(rig, cues, envelope, { frames, seed })` → `flpt.track/1`, one state per frame; `envelopeFromPcm`, `readWav`, `seedFor`, `restTrack`. Pure and seeded |
| `draw.js` | `drawPresenter(ctx, state, rig, pics)`, `stateAt(track, f)`: a classic script, no clock, no randomness (the render page, a Stage preview or a scene) |
| `keys.js` | `cartoonKey`, `rigSha`, `rhubarbVersion`, `RENDERER_VERSION` |
| `visemes.js` | the last fallback: text (+ a provider's word timings) → mouth cues |
| `tools/make-clips.mjs` | the pass: for each bubble slide, Rhubarb → track → frames → a 720² clip; `cache/cartoon/index.json` |
| `tools/render-clip.mjs`, `tools/rhubarb.mjs` | the drawer in the pinned headless shell → ffmpeg; FLPT's Rhubarb, pinned |
| `tools/rig-poster.mjs` | a look check: a rig at rest, and its mouths and eyes as a sheet |
| `rigs/stock-ada/`, `rigs/stock-bram/` | the two 2.0 stock rigs (SVG layers in one 720² space, written by each folder's `make-layers.mjs`) |
| `rhubarb/` | FLPT's WebAssembly build of Rhubarb Lip Sync 1.14.0 and its PocketSphinx models, with its `LICENSE.md` |
| `likeness/` | Cartoon you: the free checks and the rig builder (W3-10; see `likeness/README.md`) |

## The pass, and its cache

In `<episode>/presentation/video/cache/cartoon/`:

```
cues/<pad_key>.<producer>.json   Rhubarb's own JSON (the narration's, whatever the rig: a new rig redraws, never re-listens)
env/<pad_key>.json               loudness per frame
track/<key>.json                 the compiled performance
clips/<key>.mp4 (+ <key>.json)   720², 30/1, exactly the slide's frames, the padded narration muxed in (clip_sync_offset 0)
still.png (+ still.json)         the rig at rest: the bubble before its clip exists
index.json                       { pad_key: "clips/<key>.mp4" }: what the pipeline's composite puts in the bubble
```

`cartoonKey = sha("cartoon", pad_key, rigSha, producer, compiler, renderer)`: a clip is made again only when one of those changes. The pad_key is the one HeyGen's clips are cached by, so the cartoon follows the narration exactly as the avatar did, and a Mac-voice film (FLPT_DRAFT_FINAL) reuses the draft's clips.

## Determinism (K7, measured again here)

- Rhubarb runs with `--threads 1` (more recognition threads give different cues run to run, and machine to machine), the WAV by its bare name in its own folder, and `metadata.soundFile` reduced to that name.
- The track is pure: FNV-1a(`rig@version|pad_key`) seeds mulberry32; no clock, no `Math.random`.
- Layers are rasterised once at the camera's scale and cropped to their box; frames go out as PNG; ffmpeg with the bitexact flags.
- `app/test/presenter.test.mjs` pins a golden (cues, track, frames) and checks a second run, from nothing and inside the sandbox, gives the same track, frames and MP4.

## How Rhubarb ships, and why

**Decision (W3-05):** FLPT's own WebAssembly build (`rhubarb.js`, `rhubarb.wasm`: 2.1 MB) and Rhubarb's PocketSphinx models (`res/sphinx/`: 82 MB) ship inside `engine/`, so the Mac app (Resources/engine) and the plugin carry the same bytes. Nothing is hosted, published or downloaded. The toolchain manifest (`app/src/main/toolchain-manifest.json`, `rhubarb`: `source: "engine"`) lists every file's SHA-256; the app checks them once before the first pass (`toolchain.verifyRhubarb`: remembered for the process, and a stamp in the app's own folder until a file changes), and Setup's check of a cartoon says so. The plugin has no manifest beside its code and trusts its own bundle: the files and any list of their hashes arrive in the same install, so checking one against the other would add nothing. The module and its models are loaded lazily: only the cartoon's own pass reads them, in a Node process of its own, when a clip's cues are made; the app never loads them, and an episode with the twin never touches them.

Why:

- **Nothing to host.** Upstream publishes no WebAssembly build, so a download would mean FLPT hosting one (a server, a release asset): the house rule is no hosting or publishing without Michael's OK, and a downloaded binary would need its own pin and trust story.
- **One build everywhere.** WebAssembly runs under any Node (the app's pinned one, the plugin's, the web container's Linux later) and gives byte-identical cues on each (K7: WASM equals a native arm64 build only with `-ffp-contract=off`), which the parity table's "rhubarb cues: identical" needs. A native binary would be per-platform and need signing in the DMG.
- **The models are needed whole.** With the spoken text as dialog, Rhubarb still mixes its general US English language model (`en-us.lm.bin`, 26 MB) with one built from the dialog, and recognises with the acoustic model (55 MB): nothing can be left out without patching Rhubarb.
- **Compression buys little.** Measured: the models are 82 MB, 69 MB gzipped, 64 MB with brotli at its best (ten minutes to make); git and the DMG already compress, so a packed archive would only add an unpacking step.
- **Reproducible.** `engine/tools/dev/rhubarb/build.sh` rebuilds it from the release tarball (its SHA-256 checked), with `-ffile-prefix-map` so no folder of the build machine is in the binary; rebuilt that way, the cues are byte-identical to K7's build. `engine/tools/dev/` never ships.

The cost: about 84 MB more in the repository, the DMG and the marketplace plugin.

## Fallbacks

Rhubarb with the dialog → Rhubarb without it → text visemes only with a provider's word timings (`FLPT_WORDS_V1`; without timings they scored 33–44 % against Rhubarb in K7). A slide whose clip can't be made shows the cartoon's still; the film never waits on it.
