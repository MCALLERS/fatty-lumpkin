# flpt-live demos

Three scenes that exercise the runtime end to end (the QA renders them; `app/qa/livemotion-render.sh`).

| Demo | Layers | Style | What it covers |
|---|---|---|---|
| `ledger/` | canvas only | `kits/ledger` (FLPT original) | a narrated Duet, 18.6 s, on ones: heavy setup caches, outline type in three faces, rolling numbers, the presenter's keep-out |
| `counter/` | canvas + DOM | none (plain paper) | 8 s on ones: a DOM layer turning with rotate + scale, outline type beside DOM type in the same face |
| `flywheel/` | canvas only | `kits/riso` (MIT port, see its `LICENSE`) | a narrated Solo, 33.7 s, on twos: three-plate halftone print, the heaviest draw |

Each scene folder holds `scene.js` and an aligned `beats.json` (cue times from spike K6's draft voice). The kits live here until the shipped styles arrive (Wave 2). Fonts are TrueType so `ctx.text` can draw glyph outlines; where they come from: `docs/notices/flpt-live-fonts.md`.

    node ../tools/render-scene.mjs ledger --out out/ledger.mp4 --check-frames out/ledger-frames
    node ../tools/framehash.mjs --scene flywheel
