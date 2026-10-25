# engine/styles · Live Motion styles

A style is the look of a Live Motion piece: a kit of drawing code, its spec for the crews, a starter scene, and its fonts. The shipped styles live here, one folder each, and ship in the Mac app's engine and in the plugin. Their posters and loops live apart, in `app/assets/styles/<id>/` (the DMG's `Resources/styles/<id>/`). The plugin renders its own. The repository code is `app/src/main/styles.js`, the checks are `style-lint.js`, and the packages are `zipdet.js` (PLAN §2.10, §2.14).

## The eleven shipped styles

Gallery order. The seven animate looks are 16:9 ports of cth9191/animate (MIT, full notice in each folder's `LICENSE`). The rest are FLPT originals. The Gallery and the picker always end with the dashed **Your look** tile, which opens the reference sheet. That tile isn't a style.

| | id | Name | Source | Default use |
|---|---|---|---|---|
| P0 | `ledger` | Ledger | FLPT original | Duet default, the house look |
| P0 | `painted-doc` | Painted Documentary | FLPT original | Cosmos drawn in code |
| P0 | `night-shift` | Night Shift | FLPT original | interstitials, code cut scenes |
| P0 | `riso` | Riso | animate riso, port | lively Solo; the default otherwise |
| P0 | `crosshatch` | Crosshatch | animate crosshatch, port | tech explainers |
| P0 | `cut-paper` | Cut Paper | animate cut paper, port | stories and histories |
| P1 | `sketchbook` | Sketchbook | animate sketchbook, port | |
| P1 | `math` | Math | animate math, port | equations and graphs |
| P1 | `pixel` | Pixel | animate pixel, port | |
| P1 | `isometric` | Isometric | animate isometric, port | |
| P1 | `whiteboard` | Whiteboard | FLPT original (the avocado-toast grammar) | the hand-drawn Solo |

`styles.SHIPPED` and `styles.DEFAULTS` hold the same list in code. P0 styles arrive in Wave 2 (W2-07…11 and W2-13: Cut Paper), P1 in Wave 3. A style's narrated showcase and its QA live in `app/qa/` (for example `app/qa/showcase/<id>/`), never in the style folder.

## A style folder

```
<id>/
  style.json        flpt.style/1 (schema/style.schema.json)
  STYLE.md          the spec a crew reads (8,000 characters at most)
  LICENSE           the full MIT notice; a port's names cth9191
  kit.js            FLPT.style('<id>', { tokens, fonts, ones, make(env) { …; return { … } } })  (200 KB at most)
  kit-ext.js        optional (a saved piece's own kit additions)
  starter/          scene.js + beats.json (with a duration): the scene posters and loops are rendered from
  demo/             optional, private (Save as style keeps the piece here; it can hold the talk's words)
  fonts/            .ttf/.otf/.woff/.woff2, each declared in style.json with its licence (OFL-1.1 or Apache-2.0) and the licence text beside it
  assets/           pictures only, each named on a line of assets/PROVENANCE.md
```

Nothing else belongs in a style: no `refs/`, no Library reference, no symlink, no other file type. In Mine and Shared, `poster.jpg`, `poster-tall.jpg`, `loop.mp4` and `loop-tall.mp4` sit at the top of the folder. FLPT always renders them itself.

## style.json

`schema/style.schema.json` describes it. Readers ignore fields they don't know. FLPT writes these fields itself.
- `hashes`: SHA-256 of the kit, STYLE.md, the starter and kit-ext.js. A shipped style must have them.
- `api`: the kit's functions and their parameter names, read from the code: 120 entries at most, names of 32 characters at most. Each `doc` is taken from style.json, kept to ASCII with URLs stripped, 80 characters at most. No comment or string from the kit gets in.
- `provenance.rendered`: the runtime and the toolchain the poster and loops were rendered with, as `"<manifest date>/<platform>-<arch>"` (or `"system/…"`).

To compute the hashes and the API for a new shipped style:

    node app/src/main/styles.js refresh engine/styles/<id>
    node app/src/main/styles.js lint engine/styles/<id> --deep
    node app/src/main/styles.js media <id>        # poster and loops into app/assets/styles/<id>/, sandboxed; posters ≤ 120 KB

## Collections

| Collection | Where | What a crew gets |
|---|---|---|
| Shipped | `engine/styles/<id>/` (read in place, never copied or seeded) | STYLE.md as it is; may read the kit |
| Mine | `<projects>/Styles/mine/<id>/` | structured fields, `api`, STYLE.md fenced as untrusted notes |
| Shared | `<projects>/Styles/shared/<id>@<version>/` (the catalog client writes it after verifying a release) | as Mine |
| Episode | `<episode>/presentation/styles/<id>@<version>/` | as Shipped only while every file is the shipped style's; otherwise as Mine |

- **Episode snapshots** are taken on first use. They are read-only and never change. The explicit update keeps the old one aside for the before/after compare.
- **A fork** makes `<id>-mine` at `0.1.0`, retargeted to its own id, with the LICENSE and credits kept. The same happens when you change a shipped or shared style.
- **A .flptstyle** is a deterministic zip of the folder: sorted, stored, one time stamp. It holds no media and no private `demo/`, and its style.json drops `files.demo`, the episode's name and shot, and the render stamp, so the same style makes the same bytes on every surface. A saved piece's words and pictures never leave the Mac this way; Share builds a neutral package (W3-02).
- **An import** refuses `..`, absolute paths, symlinks, more than 8 MB uncompressed and ratios over 50, lints the folder and ignores packaged posters and loops. It returns `needsMedia: true`; the caller then runs `renderMedia`, which renders the poster and loops from the style's own starter, sandboxed.

## The lint (style-lint.js)

It covers shape, folder name, sizes, files, fonts and their licences, picture provenance, no `refs/`, no reference, no symlinks, and flpt-live's static scan (network, eval, navigation, time, randomness, globals). It also checks that the kit registers its own id, that hashes match, and the licence (a port carries the MIT notice; Mine and Shared are MIT). In styles that don't ship, no code file (but the private demo's scene) can hold comments or strings over 200 characters, unless the text came verbatim with FLPT, and each must parse in V8, so text can't hide where the scan sees code. Hidden files and folders are refused. A fork of a port must keep cth9191's MIT notice even if its credits are edited away. With `--deep`, the starter must also draw the same frames twice, in two fresh pages, in order and shuffled.

## inspiration.json

The six places in the Gallery's inspiration row (research 09; R22, D9; Savee from research 11, Q-03). They open in the user's browser and are never framed, embedded or hotlinked. The tile art is FLPT's own. Codrops is behind a bot challenge (K8), so its tile never offers Capture (`"capture": false`). Savee is a link only (`"capture": false`): its terms bar scraping and most of it needs a sign-in, so FLPT never fetches, shows or caches anything from it and never seeds a style from it; the release link check sends it a HEAD and nothing more. A newer list can arrive with the signed catalog.
