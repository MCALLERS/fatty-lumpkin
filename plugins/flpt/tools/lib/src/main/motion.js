'use strict';
// The motion engine: moving slides.
//
// When the deck crew writes a slide's builds in the structured form ({ cue, target, do, anim, … }, see the deck
// prompt), FLPT turns the approved slide into a HyperFrames composition in presentation/hyperframes/slide_NN/: the
// slide's own HTML, untouched, plus one beat per build. Then the method's own scripts (retime.py, align-beats.mjs,
// render.mjs) time each beat to the word it's cued on and render a silent 1920x1080, 30 fps clip to
// presentation/media/slide_NN.mp4, and media.json tells the video pipeline to play it in place of the slide's
// picture. The free draft times the clips to the Mac's voice; after filming, they're re-timed to the real voice.
//
// No crew run and no spend: HyperFrames, Chrome and ffmpeg, all on this Mac. A slide without structured builds stays
// a still, exactly as before.
//
// The Cosmos cartoons and cut scenes made in the Scenes step (scenes.js) come through here too: a cartoon is put
// together again for each run, timed to that run's voice (assemble.js, ffmpeg only), and media.json gets its entry;
// a cut scene with a finished clip gets its entry between its slides. One without a clip has none, so a run never
// stops for a missing file: the cartoon's title card and the film without the cut scene stand in until it's made.
//
// Live Motion scenes (Motion Solo and Duet, and a Cosmos drawn in code) get media.json entries marked `flpt-scene`.
// An older FLPT (0.7.x) doesn't know that note, so it keeps those entries as the user's own: a Motion Solo's
// "bubble": false survives it, and it never films (or bills) an avatar for one. Interstitials and cut scenes drawn
// in code are spliced into the film afterwards, so they never appear in media.json at all. A scene's folder
// (hyperframes/slide_NN or jsscene_<id> with scene.json) is the Live Motion crew's: it's never composed, swept or
// retimed here; render() moves the scene folders with their slides first (livemotion.sync), and the flow's afterRender
// (ext/livemotion.js) times, scores and renders them to the same voice and hands their clips back for media.json.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const scenes = require('./scenes');
const assemble = require('./assemble');
const modules = require('./modules');
const references = require('./references'); // nothing a run puts in the film is a reference

const FPS = 30;
const RATE = 15; // characters a second, the measured pace of both voices (the HeyGen voice and the draft's `say`)
const LEAD = 0.2; // a build starts this far ahead of its word
const HOLD = 0.5; // the clip ends on this much stillness, so freeze-padding is invisible
const MOTION_NOTE = 'flpt-motion'; // marks the media.json entries FLPT manages
const CARTOON_NOTE = 'flpt-cartoon'; // a cartoon FLPT put together (a slide entry, managed like the moving slides)
const CUT_NOTE = 'flpt-cutscene'; // a cut scene FLPT put together (an entry in "cutscenes")
const SCENE_NOTE = 'flpt-scene'; // a Live Motion scene's slide (Motion Solo, Duet, a Cosmos drawn in code)
const STEREO_MARKER = 'FLPT_STEREO_V1'; // the pipeline copy's patch that reads a slide entry's "stereo"

const DOS = new Set(['in', 'out', 'focus', 'unfocus', 'dim', 'pulse', 'count', 'to']);
const ANIMS = new Set(['rise', 'fade', 'pop', 'draw', 'wipe', 'grow', 'words']);
// Everything a build may pass on to its beat (see live-slide.js); anything else is dropped.
const BEAT_KEYS = ['cue', 'target', 'do', 'anim', 'dur', 'ease', 'stagger', 'drawStagger', 'level', 'pen', 'to', 'value', 'after', 'say'];

const FONT_CSS_RE = /^https:\/\/fonts\.googleapis\.com\/css2?\?/;
const FONT_FILE_RE = /^https:\/\/fonts\.gstatic\.com\//;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
const GENERIC_FONTS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'math', 'emoji', 'inherit', 'initial', 'unset']);
// The method's own fonts (OFL), used when the deck's faces can't be fetched: same families, local files.
const VENDORED_FAMILIES = { 'source-serif-4': 'Source Serif 4', 'ibm-plex-sans': 'IBM Plex Sans', 'ibm-plex-mono': 'IBM Plex Mono', caveat: 'Caveat' };

// The page around a slide: the same wrapper render_slides.py puts around it for the slide pictures, so a clip's last
// frame matches the approved picture.
const BASE_CSS = `
html,body{margin:0;padding:0;background:#000}
section{width:1920px;height:1080px;box-sizing:border-box;position:relative;overflow:hidden;display:flex;flex-direction:column}
h1,h2,h3,p,ul,ol,li,table{margin:0}
h1{font-size:96px;font-weight:600;line-height:1.1}
h2{font-size:64px;font-weight:600;line-height:1.15}
h3{font-size:44px;font-weight:600;line-height:1.2}
p{font-size:32px;font-weight:400;line-height:1.4}
ul,ol{padding-left:1.2em}
img{display:block}
table{border-collapse:collapse}
th,td{padding:0.35em 0.6em}
aside{display:none !important}
`;
// What the beat engine needs from the page (copied from the method's live-slide template, block 2).
const ENGINE_CSS = `
@property --in { syntax: "<number>"; inherits: false; initial-value: 1; }
@property --lit { syntax: "<number>"; inherits: false; initial-value: 1; }
#slide { position: relative; width: 1920px; height: 1080px; overflow: hidden; --dim: 0.4; --ink: #17202b; }
.lv { opacity: calc(var(--in) * var(--lit)); }
.lv-w { display: inline-block; }
.lv-pen-nib { fill: var(--pen, var(--ink)); }
.lv-pen-halo { fill: var(--pen, var(--ink)); fill-opacity: 0.14; }
`;

const exists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const readJson = (p, fallback = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } };
const pad2 = (n) => String(n).padStart(2, '0');
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function templateDir(engineRoot) {
  return path.join(engineRoot, 'skills', 'avatar-presentation', 'templates', 'hyperframes');
}

/**
 * FLPT's own tween engine (engine/runtime/flpt-tween): the seekable subset of GSAP's timeline the beat engine runs on.
 * Every moving slide FLPT makes carries this copy, never GSAP (W3-12).
 */
function tweenFile(engineRoot) {
  return path.join(engineRoot, 'runtime', 'flpt-tween', 'flpt-tween.js');
}

// ── reading the deck and the script ─────────────────────────────────────────────────────────────────────────────

function readDeck(dir) {
  const pres = path.join(dir, 'presentation');
  const project = path.join(pres, 'deck', 'project');
  const deck = readJson(path.join(project, 'deck.json'), {}) || {};
  const order = (Array.isArray(deck.order) ? deck.order : []).map((x) => (typeof x === 'string' ? x : x && x.id)).filter(Boolean);
  const faces = Array.isArray(deck.faces) ? deck.faces : Object.values(deck.faces || {});
  const modules = readJson(path.join(project, 'modules.json'), {}) || {};
  const assetMap = readJson(path.join(pres, 'deck', 'asset_map.json'), null) || readJson(path.join(project, 'asset_map.json'), {}) || {};
  return { pres, project, order, faces, modules, assetMap };
}

/** The narration of each slide in script.md ("## SLIDE n — title" sections, stage notes left out), by number. */
function narrations(dir) {
  let script = '';
  try { script = fs.readFileSync(path.join(dir, 'presentation', 'script.md'), 'utf8'); } catch { return {}; }
  const out = {};
  const re = /^## SLIDE (\d+)\b[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/gm;
  let m;
  while ((m = re.exec(script))) out[Number(m[1])] = m[2].split('\n').filter((l) => !l.startsWith('>')).join('\n').trim();
  return out;
}

const norm = (s) => String(s).toLowerCase().replace(/\[[^\]]*\]/g, ' ').replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** A build the deck crew wrote in the structured form, as a beat; null for the older free-text builds. */
function beatFrom(build) {
  if (!build || typeof build !== 'object' || Array.isArray(build)) return null;
  const doIt = build.do || 'in';
  if (!DOS.has(doIt)) return null;
  if (doIt !== 'unfocus' && !(typeof build.target === 'string' || (Array.isArray(build.target) && build.target.length))) return null;
  if (build.anim && !ANIMS.has(build.anim)) return null;
  const beat = {};
  for (const k of BEAT_KEYS) if (build[k] !== undefined && build[k] !== null && build[k] !== '') beat[k] = build[k];
  if (beat.do === 'in') delete beat.do;
  return beat;
}

/**
 * Which slides move: every slide in the deck whose modules.json entry has at least one structured build, with its
 * number (deck order), id and beats. Free-text builds (older decks) are counted, so the app can say why a slide
 * stays still.
 */
function plan(dir) {
  const { order, modules } = readDeck(dir);
  const entries = (modules && modules.slides) || {};
  const slides = [];
  let freeText = 0;
  order.forEach((id, i) => {
    const e = entries[id];
    if (!e || !Array.isArray(e.builds)) return;
    const beats = e.builds.map(beatFrom).filter(Boolean);
    freeText += e.builds.filter((b) => typeof b === 'string').length ? 1 : 0;
    if (beats.length) slides.push({ n: i + 1, id, module: e.module || null, beats });
  });
  return { slides, freeText, insets: insetSlides(dir).map(({ n, id }) => ({ n, id })), cartoons: scenes.readyCartoons(dir).map(({ piece }) => ({ n: piece.n, id: piece.id })) };
}

/**
 * First guesses for the beat times, from where each cue falls in the narration at the voices' pace. The real times
 * come from the voice (align-beats.mjs); a cue it can't find keeps this guess.
 */
function provisional(beats, narration, { lead = LEAD, offset = 0 } = {}) {
  const text = norm(narration);
  let from = 0;
  let prevT = offset;
  const out = beats.map((b) => {
    const beat = { ...b };
    if (beat.cue) {
      const at = text.indexOf(norm(beat.cue), from);
      if (at >= 0) {
        from = at + 1;
        beat.t = Math.max(0, Math.round((offset + at / RATE - lead) * 100) / 100);
        delete beat.after;
        prevT = beat.t;
        return beat;
      }
    }
    if (typeof beat.after !== 'number') beat.after = 0.4;
    prevT += beat.after;
    return beat;
  });
  const duration = Math.max(3, Math.ceil(((text.length / RATE) + offset + 1) * FPS) / FPS);
  // keep "t" first, as align-beats.mjs does, so beats.json reads in time order
  return { beats: out.map((b) => ('t' in b ? { t: b.t, ...b } : b)), duration: Math.max(duration, prevT + 1.5) };
}

// ── checks the crew runs (check_deck, script stats) ──────────────────────────────────────────────────────────────

const SVG_TAGS = new Set(['svg', 'g', 'path', 'line', 'circle', 'ellipse', 'polyline', 'polygon', 'rect']);

/** The start tag of the element with this id in a slide's HTML: { tag, style, attrs } or null. */
function elementById(html, id) {
  const m = html.match(new RegExp(`<([a-zA-Z][\\w-]*)\\b[^>]*\\bid=["']${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`));
  if (!m) return null;
  const style = (m[0].match(/\sstyle\s*=\s*"([^"]*)"/i) || m[0].match(/\sstyle\s*=\s*'([^']*)'/i) || [])[1] || '';
  return { tag: m[1].toLowerCase(), style, attrs: m[0] };
}

/**
 * What's wrong with the deck's builds, as short lines for the crew: free-text builds (the slide won't move), targets
 * that don't exist, elements a build touches that set their own opacity, transform or clip-path, unknown moves, a
 * count without a number to count to, a draw on something that isn't a drawing.
 */
function checkBuilds(dir) {
  const { project, modules } = readDeck(dir);
  const out = [];
  for (const [id, e] of Object.entries((modules && modules.slides) || {})) {
    if (!e || !Array.isArray(e.builds) || !e.builds.length) continue;
    let html = '';
    try { html = fs.readFileSync(path.join(project, 'slides', `${id}.html`), 'utf8'); } catch { /* reported by the layout check */ }
    if (e.builds.some((b) => typeof b === 'string')) { out.push(`${id}: its builds are plain text, so it won't move. Write them in the form under "Builds".`); continue; }
    e.builds.forEach((b, i) => {
      const n = `${id}, build ${i + 1}`;
      const doIt = (b && b.do) || 'in';
      if (!b || typeof b !== 'object') { out.push(`${n}: not a build.`); return; }
      if (!DOS.has(doIt)) { out.push(`${n}: "do": "${doIt}" isn't a move (use ${[...DOS].join(', ')}).`); return; }
      if (b.anim && !ANIMS.has(b.anim)) out.push(`${n}: "anim": "${b.anim}" isn't an entrance (use ${[...ANIMS].join(', ')}).`);
      if (i === 0 && !b.cue) out.push(`${n}: no cue. The first build needs the words that trigger it.`);
      const targets = [].concat(b.target || []);
      if (!targets.length && doIt !== 'unfocus') out.push(`${n}: no target.`);
      for (const t of targets) {
        if (!/^[\w-]+$/.test(String(t))) continue; // a selector: the engine resolves it
        const el = elementById(html, String(t));
        if (!el) { out.push(`${n}: no element with id "${t}" in slides/${id}.html.`); continue; }
        const own = (el.style.match(/(?:^|;)\s*(opacity|transform|clip-path)\s*:/gi) || []).map((x) => x.replace(/[;:\s]/g, '').toLowerCase());
        if (own.length) out.push(`${n}: "${t}" sets its own ${[...new Set(own)].join(' and ')}. Wrap it in a plain <div id="…"> and build the wrapper.`);
        if (doIt === 'in' && b.anim === 'draw' && !SVG_TAGS.has(el.tag)) out.push(`${n}: "draw" needs an SVG shape or group, and "${t}" is a <${el.tag}>.`);
        if (doIt === 'count' && b.value == null && !/\sdata-to\s*=/.test(el.attrs)) out.push(`${n}: a count needs data-to on "${t}" (or "value" in the build).`);
      }
    });
  }
  return out;
}

/** The moving slides' cues the narration doesn't say (in order), and the insets' cues, as short lines for the script crew. */
function checkCues(dir) {
  const said = narrations(dir);
  const out = [];
  for (const s of plan(dir).slides) {
    const text = norm(said[s.n] || '');
    let from = 0;
    for (const b of s.beats) {
      if (!b.cue) continue;
      const at = text.indexOf(norm(b.cue), from);
      if (at < 0) out.push(`slide ${s.n} (${s.id}): the narration doesn't say "${b.cue}"${text.includes(norm(b.cue)) ? ' after the cue before it' : ''}. A build is cued on those words.`);
      else from = at + 1;
    }
  }
  for (const s of insetSlides(dir)) {
    const cue = typeof s.inset.cue === 'string' ? s.inset.cue.trim() : '';
    if (cue && !norm(said[s.n] || '').includes(norm(cue))) out.push(`slide ${s.n} (${s.id}): the narration doesn't say "${cue}". The video inset starts on those words.`);
  }
  for (const c of scenes.plan(dir).cartoons) {
    const text = norm(said[c.n] || '');
    let from = 0;
    for (const b of c.beats) {
      if (!b.cue) continue;
      const at = text.indexOf(norm(b.cue), from);
      if (at < 0) out.push(`slide ${c.n} (${c.id}): the narration doesn't say "${b.cue}"${text.includes(norm(b.cue)) ? ' after the cue before it' : ''}. A cartoon keyframe is cued on those words.`);
      else from = at + 1;
    }
  }
  return out;
}

/** What's wrong with the deck's video insets, as short lines for the crew (the clip, its frame, its points, its sound). */
function checkInsets(dir) {
  const out = [];
  for (const s of insetSlides(dir)) {
    const i = readInset(dir, s.inset);
    if (i.problem) { out.push(`${s.id}: the inset ${i.problem}.`); continue; }
    const r = s.inset.rect;
    if (r.x < 0 || r.y < 0 || r.x + r.w > FRAME.w || r.y + r.h > FRAME.h) out.push(`${s.id}: the inset's rect goes off the 1920×1080 slide.`);
    if (r.x < 380 && r.y + r.h > 700) out.push(`${s.id}: the inset's rect reaches into the bubble corner (x < 380, below y 700).`);
    if (s.inset.out != null && !(Number(s.inset.out) > i.from)) out.push(`${s.id}: the inset's "out" (${s.inset.out}) isn't after its "in" (${i.from}).`);
    const sound = s.inset.sound == null ? '' : String(s.inset.sound).trim().toLowerCase();
    if (sound && !MUTED.has(sound) && !['on', 'full', 'yes', 'true'].includes(sound)) out.push(`${s.id}: the inset's "sound" is "${s.inset.sound}": use "muted" or "on".`);
  }
  return out;
}

// ── fonts ───────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The deck's faces (Google Fonts) as local files, so the clip renders with exactly the fonts the slide pictures used,
 * and nothing is fetched at render time. Fetched once, then cached. Only fonts.googleapis.com and fonts.gstatic.com.
 * Returns { css, files: [{ name, path }], families } or null when they can't be had (offline, odd hrefs).
 */
async function localFonts(faces, cacheDir, fetchImpl = globalThis.fetch) {
  const hrefs = faces.map((f) => (f && typeof f === 'object' ? f.href : f)).filter((h) => typeof h === 'string' && FONT_CSS_RE.test(h));
  if (!hrefs.length || !fetchImpl) return null;
  fs.mkdirSync(cacheDir, { recursive: true });
  const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 20);
  const get = async (url, binary) => {
    const res = await fetchImpl(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return binary ? Buffer.from(await res.arrayBuffer()) : res.text();
  };
  try {
    const files = new Map();
    const blocks = [];
    for (const href of hrefs) {
      const cssFile = path.join(cacheDir, `${hash(href)}.css`);
      let css = exists(cssFile) ? fs.readFileSync(cssFile, 'utf8') : null;
      if (css == null) { css = await get(href, false); writeAtomic(cssFile, css); }
      const urls = [...css.matchAll(/url\((['"]?)([^'")]+)\1\)/g)].map((m) => m[2]);
      if (!urls.length || urls.some((u) => !FONT_FILE_RE.test(u))) return null;
      for (const u of urls) {
        const name = `${hash(u)}${path.extname(new URL(u).pathname) || '.woff2'}`;
        const file = path.join(cacheDir, name);
        if (!exists(file)) writeAtomic(file, await get(u, true));
        files.set(name, file);
        css = css.split(u).join(`assets/fonts/${name}`);
      }
      blocks.push(css);
    }
    const families = [...new Set(blocks.join('\n').match(/font-family:\s*['"]?([^;'"]+)/g) || [])].map((s) => s.replace(/font-family:\s*['"]?/, '').trim());
    return { css: blocks.join('\n'), files: [...files].map(([name, p]) => ({ name, path: p })), families };
  } catch {
    return null;
  }
}

/** The method's own font files for the deck's families: the fallback when the deck's faces can't be fetched. */
function vendoredFonts(engineRoot) {
  const T = templateDir(engineRoot);
  const dirs = [path.join(T, 'live-slide', 'assets', 'fonts'), path.join(T, 'examples', 'whiteboard-sketch', 'assets', 'fonts')];
  const files = [];
  const rules = [];
  const seen = new Set();
  for (const d of dirs) {
    let names = [];
    try { names = fs.readdirSync(d); } catch { continue; }
    for (const name of names.sort()) {
      const m = name.match(/^(.+)-latin-(\d{3})-(normal|italic)\.woff2$/);
      if (!m || seen.has(name) || !VENDORED_FAMILIES[m[1]]) continue;
      seen.add(name);
      files.push({ name, path: path.join(d, name) });
      rules.push(`@font-face { font-family: "${VENDORED_FAMILIES[m[1]]}"; font-weight: ${m[2]}; font-style: ${m[3]}; src: url("assets/fonts/${name}") format("woff2"); }`);
    }
  }
  return { css: rules.join('\n'), files, families: Object.values(VENDORED_FAMILIES) };
}

// The episode's own copy of its deck's fonts (W4-03): presentation/assets/fonts/ with fonts.json beside the files.
const FONTS_SCHEMA = 'flpt.fonts/1';
const fontsDir = (dir) => path.join(dir, 'presentation', 'assets', 'fonts');
const FONT_NAME = /^[A-Za-z0-9_-]{1,64}\.(woff2|woff|ttf|otf)$/;
const faceHrefs = (faces) => (Array.isArray(faces) ? faces : []).map((f) => (f && typeof f === 'object' ? f.href : f)).filter((h) => typeof h === 'string' && FONT_CSS_RE.test(h));
const fileSha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

// The descriptors a snapshot's @font-face may hold, each with the only shape of value it may take (src: FACE_SRC).
const FACE_DESCRIPTORS = {
  'font-family': /^(['"])[A-Za-z0-9 _-]{1,64}\1$|^[A-Za-z0-9 _-]{1,64}$/,
  'font-style': /^(normal|italic|oblique( -?\d{1,2}deg){0,2})$/,
  'font-weight': /^(normal|bold|\d{1,4}( \d{1,4})?)$/,
  'font-stretch': /^(normal|(ultra-|extra-|semi-)?(condensed|expanded)|\d{1,3}(\.\d+)?%( \d{1,3}(\.\d+)?%)?)$/,
  'font-display': /^(auto|block|swap|fallback|optional)$/,
  'unicode-range': /^U\+[0-9A-Fa-f?]{1,6}(-[0-9A-Fa-f]{1,6})?( ?, ?U\+[0-9A-Fa-f?]{1,6}(-[0-9A-Fa-f]{1,6})?)*$/,
};
const FACE_SRC = /^url\( ?(['"]?)assets\/fonts\/([A-Za-z0-9_-]{1,64}\.(?:woff2|woff|ttf|otf))\1 ?\)(?: format\( ?(['"]?)(woff2|woff|truetype|opentype)\3 ?\))?$/;

/**
 * A snapshot's stylesheet, rebuilt from its @font-face rules alone: each descriptor one of FACE_DESCRIPTORS with a value
 * of its shape, and one src, a file of the snapshot's own (`names`). Anything else (another rule, descriptor or value)
 * → null. → { css, families }
 */
function fontFaceCss(css, names) {
  const body = String(css).replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const families = [];
  let at = 0;
  for (const m of body.matchAll(/@font-face\s*\{([^{}]*)\}/g)) {
    if (body.slice(at, m.index).trim()) return null;
    at = m.index + m[0].length;
    const decls = new Map();
    for (const d of m[1].split(';').map((s) => s.trim()).filter(Boolean)) {
      const i = d.indexOf(':');
      const prop = i > 0 ? d.slice(0, i).trim().toLowerCase() : '';
      const value = d.slice(i + 1).trim().replace(/\s+/g, ' ');
      if (decls.has(prop)) return null;
      if (prop === 'src') {
        const s = value.match(FACE_SRC);
        if (!s || !names.has(s[2])) return null;
        decls.set(prop, `url(assets/fonts/${s[2]})${s[4] ? ` format('${s[4]}')` : ''}`);
      } else if (FACE_DESCRIPTORS[prop] && FACE_DESCRIPTORS[prop].test(value)) {
        decls.set(prop, prop === 'font-family' ? `'${value.replace(/^['"]|['"]$/g, '')}'` : value);
      } else {
        return null;
      }
    }
    if (!decls.has('font-family') || !decls.has('src')) return null;
    const family = decls.get('font-family').slice(1, -1);
    if (!families.includes(family)) families.push(family);
    rules.push(`@font-face { ${[...decls].map(([k, v]) => `${k}: ${v}`).join('; ')}; }`);
  }
  if (body.slice(at).trim() || !rules.length) return null;
  return { css: rules.join('\n'), families };
}

/**
 * The snapshot in fonts.json, when it's for exactly these faces and every file is there with its SHA-256; its
 * stylesheet is rebuilt from its @font-face rules (fontFaceCss: only font descriptors, only its own files), never
 * taken as written. Else null.
 */
function readFontSnapshot(dir, hrefs) {
  const rec = readJson(path.join(fontsDir(dir), 'fonts.json'), null);
  if (!rec || rec.schema !== FONTS_SCHEMA || !Array.isArray(rec.faces) || JSON.stringify(rec.faces) !== JSON.stringify(hrefs)) return null;
  if (typeof rec.css !== 'string' || !Array.isArray(rec.files) || !rec.files.length || !Array.isArray(rec.families)) return null;
  const names = new Set();
  const files = [];
  for (const f of rec.files) {
    if (!f || !FONT_NAME.test(String(f.name)) || !/^[0-9a-f]{64}$/.test(String(f.sha256))) return null;
    const p = path.join(fontsDir(dir), f.name);
    if (!exists(p) || fileSha(p) !== f.sha256) return null;
    names.add(f.name);
    files.push({ name: f.name, path: p });
  }
  const face = fontFaceCss(rec.css, names);
  return face ? { css: face.css, files, families: face.families, snapshot: true } : null;
}

/**
 * Copy the fetched faces into the episode and write fonts.json (atomically, last), its stylesheet as fontFaceCss
 * rebuilds it, so every render reads the same; older font files there go.
 */
function writeFontSnapshot(dir, hrefs, fetched) {
  // a name or a stylesheet the snapshot can't hold: use the cache as before
  if (fetched.files.some((f) => !FONT_NAME.test(f.name))) return { ...fetched, snapshot: false };
  const face = fontFaceCss(fetched.css, new Set(fetched.files.map((f) => f.name)));
  if (!face) return { ...fetched, snapshot: false };
  const fonts = { ...fetched, ...face };
  const out = fontsDir(dir);
  fs.mkdirSync(out, { recursive: true });
  const files = [];
  for (const f of fonts.files) {
    const to = path.join(out, f.name);
    if (!exists(to) || fileSha(to) !== fileSha(f.path)) { fs.copyFileSync(f.path, `${to}.tmp`); fs.renameSync(`${to}.tmp`, to); }
    files.push({ name: f.name, path: to, sha256: fileSha(to), bytes: fs.statSync(to).size });
  }
  const keep = new Set(files.map((f) => f.name));
  for (const n of fs.readdirSync(out)) if (FONT_NAME.test(n) && !keep.has(n)) fs.rmSync(path.join(out, n), { force: true });
  writeAtomic(path.join(out, 'fonts.json'), `${JSON.stringify({ schema: FONTS_SCHEMA, faces: hrefs, families: fonts.families, css: fonts.css,
    files: files.map(({ name, sha256, bytes }) => ({ name, sha256, bytes })), at: new Date().toISOString() }, null, 2)}\n`);
  return { css: fonts.css, files: files.map(({ name, path: p }) => ({ name, path: p })), families: fonts.families, snapshot: true };
}

/**
 * The deck's fonts for this episode, from its own snapshot (presentation/assets/fonts/, fonts.json): the faces are
 * fetched once (localFonts, through the font cache), then kept with the episode, so the Mac app, the plugin and the web
 * draw the same files on every render, whatever a cache or Google Fonts holds later. Faces that changed make a new
 * snapshot. Without faces that can be fetched, the method's own fonts (they ship with the engine; not snapshotted).
 * → { css, files: [{ name, path }], families, snapshot }
 */
async function episodeFonts(dir, { engineRoot, fontCacheDir, fetchImpl } = {}) {
  const deck = readDeck(dir);
  const hrefs = faceHrefs(deck.faces);
  if (hrefs.length) {
    const snap = readFontSnapshot(dir, hrefs);
    if (snap) return snap;
    const got = fontCacheDir ? await localFonts(deck.faces, fontCacheDir, fetchImpl) : null;
    if (got) return writeFontSnapshot(dir, hrefs, got);
  }
  return { ...vendoredFonts(engineRoot), snapshot: false };
}

/**
 * Drop named fallback fonts (Georgia, Arial…) from every font-family list: the deck's own faces always load here, and
 * HyperFrames would otherwise go looking for the fallbacks on the web. The picture doesn't change.
 */
function sanitizeFonts(html, families) {
  const keep = new Set(families.map((f) => f.toLowerCase()));
  const clean = (list, q) => {
    const parts = list.replace(/&quot;/g, q).split(',').map((s) => s.trim()).filter(Boolean);
    const kept = parts.filter((p) => { const f = p.replace(/^['"]|['"]$/g, '').toLowerCase(); return keep.has(f) || GENERIC_FONTS.has(f) || f.startsWith('var('); });
    return (kept.length ? kept : parts.slice(-1)).join(', ');
  };
  return html
    // <style> blocks: names may be in either kind of quotes
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (all, a, css, b) => a + css.replace(/font-family\s*:\s*([^;}]+)/gi, (m, l) => `font-family: ${clean(l, '"')}`) + b)
    // style="…" attributes: no double quotes inside
    .replace(/(\sstyle\s*=\s*")([^"]*)(")/gi, (all, a, css, b) => a + css.replace(/&quot;|&#39;|&#x27;|&apos;/gi, "'").replace(/font-family\s*:\s*([^;]+)/gi, (m, l) => `font-family: ${clean(l, "'")}`) + b)
    // SVG font-family="…" attributes
    .replace(/(\sfont-family\s*=\s*")([^"]*)(")/gi, (all, a, l, b) => a + clean(l, "'") + b);
}

// ── composing a slide ───────────────────────────────────────────────────────────────────────────────────────────

function extractSection(raw) {
  const start = raw.search(/<section\b/i);
  if (start < 0) return null;
  const ends = [...raw.matchAll(/<\/section\s*>/gi)];
  return ends.length ? raw.slice(start, ends[ends.length - 1].index + ends[ends.length - 1][0].length) : `${raw.slice(start)}</section>`;
}

/** Copy the slide's /_blob/ pictures next to the composition and point the HTML at the copies. */
function localBlobs(section, { assetMap, pres, project }, outDir, problems, sid) {
  return section.replace(/\/_blob\/[^"'()\s&<>]+/g, (key) => {
    const val = assetMap[key] || assetMap[key.slice('/_blob/'.length)];
    const src = val && [path.resolve(pres, 'deck', String(val)), path.resolve(project, String(val)), path.resolve(pres, String(val))].find(exists);
    if (!src) { problems.push(`${sid}: no picture for ${key}`); return key; }
    const name = `${crypto.createHash('sha256').update(src).digest('hex').slice(0, 12)}${path.extname(src)}`;
    fs.mkdirSync(path.join(outDir, 'assets', 'blobs'), { recursive: true });
    fs.copyFileSync(src, path.join(outDir, 'assets', 'blobs', name));
    return `assets/blobs/${name}`;
  });
}

const MADE = `Made by the Fatty Lumpkin Presentation Tool from the approved deck slide: the slide as it is, plus its builds
     (beats.json). Re-made from the deck whenever the episode is filmed; edit the deck, not this file.`;

/** The composition's page. `hand`: load hand.js (the whiteboard's wobble and arrowheads) before the engine builds. */
function page(section, fontsCss, duration, { comment = MADE, hand = false } = {}) {
  return `<!doctype html>
<!-- ${comment} -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1920, height=1080">
<style>
${fontsCss}
${BASE_CSS}
${ENGINE_CSS}
</style>
</head>
<body>
<div id="slide" data-composition-id="slide" data-start="0" data-width="1920" data-height="1080" data-fps="${FPS}" data-duration="${duration}">
${section.trim()}
</div>
<script src="assets/flpt-tween.js"></script>
<script src="beats.js"></script>
${hand ? '<script src="assets/hand.js"></script>\n' : ''}<script src="assets/live-slide.js"></script>
<script>${hand ? 'Hand.apply(document.getElementById("slide")); ' : ''}window.__timelines["slide"] = LiveSlide.build(window.__SLIDE__);</script>
</body>
</html>
`;
}

/**
 * Write presentation/hyperframes/slide_NN/ for every moving slide: index.html (the slide + the engine), beats.json
 * (one beat per build, first-guess times), the engine, the fonts and the pictures. Returns { slides, problems }.
 */
const MARKER = 'flpt-motion.json'; // in every folder FLPT makes; a folder without it is the user's own animation
const SCENE_FILE = 'scene.json'; // a Live Motion scene's record (livemotion.js): its folder is the scene crew's
const hfDir = (dir, n) => path.join(dir, 'presentation', 'hyperframes', `slide_${pad2(n)}`);
const sha = (file) => { try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return null; } };

/** Slides with a video of the user's own in media.json: FLPT never animates those. */
function userVideoSlides(dir) {
  const media = readJson(mediaFile(dir), {}) || {};
  return new Set(Object.entries(media.slides || {}).filter(([, v]) => !isOurs(v)).map(([k]) => Number(k)));
}

/**
 * The user's own HyperFrames slides (presentation/hyperframes/slide_NN without FLPT's marker), by number. A Live Motion
 * scene's folder (it has scene.json, livemotion.js) isn't one: retime.py never renders it; livemotion does, through the
 * flow's afterRender.
 */
function bespokeSlides(dir) {
  const root = path.join(dir, 'presentation', 'hyperframes');
  let names = [];
  try { names = fs.readdirSync(root); } catch { return []; }
  return names.map((d) => d.match(/^slide_(\d{2})$/)).filter(Boolean).map((m) => Number(m[1]))
    .filter((n) => exists(path.join(hfDir(dir, n), 'beats.json')) && !exists(path.join(hfDir(dir, n), MARKER)) && !isSceneFolder(hfDir(dir, n)));
}

/** A Live Motion scene's folder (slide_NN or jsscene_<id> with FLPT's scene.json): never the engine's, never retimed. */
const isSceneFolder = (folder) => exists(path.join(folder, SCENE_FILE));

/**
 * May FLPT write media/slide_NN.mp4? Yes when there's nothing there, or what's there is a clip FLPT rendered itself:
 * its hash is in the folder's marker, or in a Live Motion scene's record (scene.json `rendered.sha`, in a slide's
 * folder or set aside in parked/). Anything else is the user's, and stays.
 */
function clipIsOurs(dir, n) {
  const clip = clipPath(dir, n);
  if (!exists(clip)) return true;
  const mark = readJson(path.join(hfDir(dir, n), MARKER), {}) || {};
  const h = sha(clip);
  return (Boolean(mark.clip) && mark.clip === h) || sceneClipShas(dir).has(h);
}

/** The hashes of the clips Live Motion scenes rendered, from their records (slide folders and parked ones). */
function sceneClipShas(dir) {
  const root = path.join(dir, 'presentation', 'hyperframes');
  const list = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
  const folders = [...list(root).filter((n) => /^slide_\d{2}$/.test(n)).map((n) => path.join(root, n)), ...list(path.join(root, 'parked')).map((n) => path.join(root, 'parked', n))];
  const out = new Set();
  for (const f of folders) {
    const r = readJson(path.join(f, SCENE_FILE), null);
    if (r && r.schema === 'flpt.scene/1' && r.rendered && typeof r.rendered.sha === 'string' && /^[0-9a-f]{64}$/.test(r.rendered.sha)) out.add(r.rendered.sha);
  }
  return out;
}

/**
 * FLPT's folders (and their clips) for slides that no longer move or play an inset go; so do those of slides that
 * moved in the deck. `keep`: the slide numbers whose folders stay. The user's own folders and videos always stay.
 */
function sweep(dir, keep) {
  const root = path.join(dir, 'presentation', 'hyperframes');
  for (const name of (() => { try { return fs.readdirSync(root); } catch { return []; } })()) {
    const m = name.match(/^slide_(\d{2})$/);
    if (m && exists(path.join(root, name, MARKER)) && !keep.has(Number(m[1]))) {
      if (clipIsOurs(dir, Number(m[1]))) fs.rmSync(clipPath(dir, Number(m[1])), { force: true });
      fs.rmSync(path.join(root, name), { recursive: true, force: true });
    }
  }
}

async function compose(dir, { engineRoot, fontCacheDir, fetchImpl, keep = [], skip = [] } = {}) {
  const deck = readDeck(dir);
  const problems = [];
  const userVideo = userVideoSlides(dir);
  const bespoke = new Set(bespokeSlides(dir));
  // a Live Motion scene's slide is the scene crew's: never composed from builds, its folder never replaced
  const live = new Set([...sceneSlides(dir), ...plan(dir).slides.map((s) => s.n).filter((n) => isSceneFolder(hfDir(dir, n)))]);
  const slides = plan(dir).slides.filter((s) => !userVideo.has(s.n) && !bespoke.has(s.n) && !skip.includes(s.n) && !live.has(s.n));
  sweep(dir, new Set([...slides.map((s) => s.n), ...keep]));
  if (!slides.length) return { slides, bespoke: [...bespoke].filter((n) => !userVideo.has(n)), problems };
  const T = templateDir(engineRoot);
  const engineAssets = path.join(T, 'examples', 'whiteboard-sketch', 'assets'); // engine 1.1: live slides + the pen
  const fonts = await episodeFonts(dir, { engineRoot, fontCacheDir, fetchImpl }); // the episode's own copy (W4-03)
  const said = narrations(dir);
  const done = [];
  for (const s of slides) {
    const raw = (() => { try { return fs.readFileSync(path.join(deck.project, 'slides', `${s.id}.html`), 'utf8'); } catch { return null; } })();
    const section = raw && extractSection(raw);
    if (!section) { problems.push(`${s.id}: no slide file with a <section>`); continue; }
    if (!clipIsOurs(dir, s.n)) { problems.push(`${s.id}: media/slide_${pad2(s.n)}.mp4 is a video of yours, so this slide stays as it is`); continue; }
    const out = hfDir(dir, s.n);
    const old = readJson(path.join(out, MARKER), {}) || {};
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(path.join(out, 'assets', 'fonts'), { recursive: true });
    fs.copyFileSync(path.join(engineAssets, 'live-slide.js'), path.join(out, 'assets', 'live-slide.js'));
    fs.copyFileSync(tweenFile(engineRoot), path.join(out, 'assets', 'flpt-tween.js'));
    for (const f of fonts.files) fs.copyFileSync(f.path, path.join(out, 'assets', 'fonts', f.name));
    const html = sanitizeFonts(localBlobs(section, deck, out, problems, s.id), fonts.families);
    const missing = [...new Set(s.beats.flatMap((b) => [].concat(b.target || [])))]
      .filter((t) => /^[\w-]+$/.test(t) && !new RegExp(`id=["']${t}["']`).test(html));
    if (missing.length) problems.push(`${s.id}: builds point at ${missing.map((t) => `"${t}"`).join(', ')}, but the slide has no element with that id`);
    const narration = said[s.n] || '';
    const first = s.n === 1;
    const { beats, duration } = provisional(s.beats, narration, { offset: first ? 0.5 : 0 });
    const beatsJson = { slide: s.id, duration, fps: FPS, hold: HOLD, lead: LEAD, narration, beats };
    writeAtomic(path.join(out, 'beats.json'), `${JSON.stringify(beatsJson, null, 1)}\n`);
    writeAtomic(path.join(out, 'beats.js'), `window.__SLIDE__ = ${JSON.stringify({ ...beatsJson, fps: FPS })};\n`);
    writeAtomic(path.join(out, 'index.html'), page(html, fonts.css, duration));
    writeAtomic(path.join(out, MARKER), `${JSON.stringify({ made: 'Fatty Lumpkin Presentation Tool', slide: s.id, clip: old.clip || null }, null, 2)}\n`);
    done.push({ ...s, dir: out });
  }
  return { slides: done, bespoke: [...bespoke].filter((n) => !userVideo.has(n)), problems };
}

// ── media.json ──────────────────────────────────────────────────────────────────────────────────────────────────

const clipPath = (dir, n) => path.join(dir, 'presentation', 'media', `slide_${pad2(n)}.mp4`);
const mediaFile = (dir) => path.join(dir, 'presentation', 'media.json');
const isOurs = (v) => Boolean(v && typeof v === 'object' && (v.note === MOTION_NOTE || v.note === CARTOON_NOTE || v.note === SCENE_NOTE));
// What the pipeline reads as "bubble": false (load_media in generate_presentation_video.py).
const bubbleOff = (v) => Boolean(v && typeof v === 'object' && 'bubble' in v
  && (typeof v.bubble === 'string' ? ['false', 'no', '0', 'off', 'hide', 'hidden'].includes(v.bubble.trim().toLowerCase()) : !v.bubble));

/** Each slide of the deck with its modules.json entry (or null): [{ n, id, entry }], numbered in deck order. */
function deckSlides(dir) {
  const { order, modules: map } = readDeck(dir);
  const entries = (map && map.slides) || {};
  return order.map((id, i) => {
    const e = Object.prototype.hasOwnProperty.call(entries, id) ? entries[id] : null;
    return { n: i + 1, id, entry: e && typeof e === 'object' && !Array.isArray(e) ? e : null };
  });
}

/**
 * The slides narrated without the presenter's bubble, by number (deck order): every slide whose module hides it
 * (modules.META: Cosmos, Motion Solo) or whose modules.json entry says "bubble": false. Filming makes no avatar clip
 * for them, and bills their narration as voice only.
 */
function hiddenBubbleSlides(dir) {
  return deckSlides(dir).filter((s) => modules.hidesBubble(s.entry)).map((s) => s.n);
}

/** The Live Motion scene slides, by number: Motion Solo, Motion Duet and a Cosmos drawn in code (flpt-scene entries). */
function sceneSlides(dir) {
  return deckSlides(dir).filter((s) => modules.isScene(s.entry)).map((s) => s.n);
}

/** The Cosmos cartoon slides the Scenes step generates, by number (a Cosmos drawn in code is a scene instead). */
function cartoonSlides(dir) {
  return deckSlides(dir).filter((s) => s.entry && s.entry.module === 'cosmos' && modules.makeOf(s.entry) === 'generate').map((s) => s.n);
}

/** Deprecated: the generated Cosmos cartoon slides (cartoonSlides). The slides without the bubble: hiddenBubbleSlides. */
const cosmosSlides = cartoonSlides;

/**
 * The slides the pipeline will narrate without the bubble, so with no avatar clip to make or pay for: every slide
 * that hides it (hiddenBubbleSlides: Cosmos, Motion Solo…) unless the user has an entry of their own for one, and any
 * slide the user marked "bubble": false.
 */
function noBubbleSlides(dir) {
  const user = Object.entries((readJson(mediaFile(dir), {}) || {}).slides || {}).filter(([, v]) => !isOurs(v));
  const out = new Set(user.filter(([, v]) => bubbleOff(v)).map(([k]) => Number(k)).filter((n) => Number.isInteger(n) && n > 0));
  for (const n of hiddenBubbleSlides(dir)) if (!user.some(([k]) => Number(k) === n)) out.add(n);
  return [...out].sort((a, b) => a - b);
}

/** Does the episode's copy of the pipeline read a slide entry's "stereo" (its FLPT_STEREO_V1 patch)? */
function pipelineStereo(dir) {
  try { return fs.readFileSync(path.join(dir, 'presentation', 'video', 'generate_presentation_video.py'), 'utf8').includes(STEREO_MARKER); } catch { return false; }
}

/** A scene's clip as a run reports it ({ video, audio, volume }), or null: a path inside presentation/ that's there. */
function sceneClipOf(dir, spec) {
  if (!spec || typeof spec !== 'object' || typeof spec.video !== 'string' || !spec.video) return null;
  const rel = spec.video;
  if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..') || !exists(path.join(dir, 'presentation', rel))) return null;
  const volume = Number(spec.volume);
  return { video: rel, audio: spec.audio === 'mix' ? 'mix' : 'mute', volume: Number.isFinite(volume) && volume >= 0 ? volume : null };
}

/**
 * A Live Motion scene's media.json entry (PLAN §2.14): its clip once it's made (`clip`: { video, audio, volume }), the
 * hidden bubble on a Motion Solo or a Cosmos drawn in code (with or without a clip, so no avatar is ever filmed for
 * it), and the `flpt-scene` note. A clip with sound mixes at its volume (1 unless the run says otherwise) and is
 * "stereo" only when the pipeline copy reads that key; a muted one has neither. Null for a Duet with no clip yet. No
 * `lead` is ever written: it would move the narration (and, on a bubble slide, re-bill the avatar).
 */
function sceneEntry(clip, { hidden = false, stereo = false } = {}) {
  const e = {};
  if (clip) {
    Object.assign(e, { video: clip.video, fit: 'cover', pad: 'freeze' });
    if (clip.audio === 'mix') Object.assign(e, { audio: 'mix', volume: clip.volume != null ? clip.volume : 1 }, stereo ? { stereo: true } : {});
    else e.audio = 'mute';
  }
  if (hidden) e.bubble = false;
  return Object.keys(e).length ? { ...e, note: SCENE_NOTE } : null;
}

/**
 * Write FLPT's own entries in media.json, keeping every entry FLPT didn't make (the user's own cut scenes and video
 * slides) exactly as it is: the moving slides' clips (slide numbers → media/slide_NN.mp4; `mix` maps a slide to the
 * volume of a clip that carries sound), the cartoons put together for this run (`cartoons`: slide number →
 * media/cartoon_<id>.mp4), the Live Motion scenes (`scenes`: slide number → { video, audio, volume }, written as
 * `flpt-scene` entries), "bubble": false for every slide that hides the bubble (with or without a clip), and every
 * generated cut scene whose clip is made, between its slides. FLPT's entries are marked with a note; with nothing of
 * FLPT's, there are none.
 */
function writeMedia(dir, numbers, { mix = {}, cartoons = {}, scenes: sceneClips = {} } = {}) {
  const file = mediaFile(dir);
  // A media.json someone broke by hand stays as it is (the pipeline names the problem): FLPT never rewrites the user's file.
  if (exists(file) && readJson(file, null) === null) return;
  const media = readJson(file, {}) || {};
  const slides = {};
  for (const [k, v] of Object.entries(media.slides || {})) if (!isOurs(v)) slides[k] = v;
  const clips = new Set(numbers);
  const hidden = new Set(hiddenBubbleSlides(dir));
  const live = new Set(sceneSlides(dir));
  const cosmos = new Set(cartoonSlides(dir));
  // A cartoon's clip goes only on its own slide (the deck may have moved it), and only while the file is there.
  const { order } = readDeck(dir);
  const cartoon = Object.fromEntries(Object.entries(cartoons).filter(([n, rel]) => cosmos.has(Number(n)) && order[Number(n) - 1]
    && rel === path.join('media', `cartoon_${order[Number(n) - 1]}.mp4`) && exists(path.join(dir, 'presentation', rel))));
  const stereo = pipelineStereo(dir);
  for (const n of [...new Set([...clips, ...hidden, ...live])].sort((a, b) => a - b)) {
    if (slides[String(n)]) continue; // the user's own entry for that slide wins
    if (live.has(n)) {
      // A scene's clip, from the run that made it, else the slide's own moving clip; never a flpt-motion entry.
      const clip = sceneClipOf(dir, sceneClips[n])
        || (clips.has(n) ? { video: `media/slide_${pad2(n)}.mp4`, audio: mix[n] != null ? 'mix' : 'mute', volume: mix[n] != null ? mix[n] : null } : null);
      const e = sceneEntry(clip, { hidden: hidden.has(n), stereo });
      if (e) slides[String(n)] = e;
      continue;
    }
    const e = {};
    if (cartoon[n]) Object.assign(e, { video: cartoon[n], fit: 'cover', pad: 'freeze', audio: 'mute' });
    else if (clips.has(n)) {
      Object.assign(e, { video: `media/slide_${pad2(n)}.mp4`, fit: 'cover', pad: 'freeze' },
        mix[n] != null ? { audio: 'mix', volume: mix[n] } : { audio: 'mute' });
    }
    if (hidden.has(n)) e.bubble = false;
    slides[String(n)] = { ...e, note: cartoon[n] ? CARTOON_NOTE : MOTION_NOTE };
  }
  const next = { ...media, slides };
  if (!Object.keys(slides).length) delete next.slides;
  // Cut scenes: the user's own as they are, then FLPT's, each with its clip (never one whose file isn't made yet, and
  // never one drawn in code: that one is spliced into the film, so its neighbours keep their timing).
  if (media.cutscenes == null || Array.isArray(media.cutscenes)) {
    const theirs = (media.cutscenes || []).filter((c) => !(c && typeof c === 'object' && c.note === CUT_NOTE));
    const taken = new Set(theirs.map((c) => String((c && c.id) || '').toLowerCase()));
    const ours = scenes.cutsceneClips(dir).filter((c) => !taken.has(c.id.toLowerCase()))
      .map((c) => ({ id: c.id, after_slide: c.afterN, video: c.rel, title: c.title, audio: 'keep', fade: 0.6, note: CUT_NOTE }));
    if (theirs.length + ours.length) next.cutscenes = [...theirs, ...ours];
    else delete next.cutscenes;
  }
  if (!Object.keys(next).length) { fs.rmSync(file, { force: true }); return; }
  writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
}

/** FLPT's entries brought up to date with the deck (which slides are cartoons or scenes, which cut scenes are made), keeping its clips as they are. */
function refreshMedia(dir) {
  const ours = Object.entries((readJson(mediaFile(dir), {}) || {}).slides || {}).filter(([, v]) => isOurs(v) && v.video);
  const moving = ours.filter(([, v]) => v.note === MOTION_NOTE);
  const mix = Object.fromEntries(moving.filter(([, v]) => v.audio === 'mix').map(([k, v]) => [Number(k), v.volume]));
  const cartoons = Object.fromEntries(ours.filter(([, v]) => v.note === CARTOON_NOTE).map(([k, v]) => [Number(k), v.video]));
  const sceneClips = Object.fromEntries(ours.filter(([, v]) => v.note === SCENE_NOTE).map(([k, v]) => [Number(k), { video: v.video, audio: v.audio, volume: v.volume }]));
  writeMedia(dir, moving.map(([k]) => Number(k)), { mix, cartoons, scenes: sceneClips });
}

/** Is this a clip the pipeline can use as-is? (What render.mjs promises: 1920x1080, 30 fps, no sound.) */
async function clipOk(file, probe) {
  if (!exists(file)) return false;
  try {
    const info = await probe(file);
    const v = (info.streams || []).find((x) => x.codec_type === 'video');
    return Boolean(v && v.width === 1920 && v.height === 1080 && v.r_frame_rate === '30/1');
  } catch {
    return false;
  }
}

// ── video insets ────────────────────────────────────────────────────────────────────────────────────────────────
//
// A slide the deck crew gave an inset ({ clip, rect, in, out, sound, cue } in modules.json) plays the user's clip in
// its frame: scaled into the rectangle, trimmed to [in, out], starting on the cue's words (else half a second into
// the slide), muted unless the inset asks for its sound, with the slide's own picture before and after. ffmpeg does
// it in the same pass as the moving slides, onto the slide's moving clip when it has builds, else onto its picture.

const FRAME = { w: 1920, h: 1080 };
const INSET_START = 0.5; // with no cue, the clip starts this far into the slide
const INSET_VOLUME = 0.8; // a clip played with its sound: plainly heard, under the narration's level
const MUTED = new Set(['', 'muted', 'mute', 'off', 'none', 'no', 'silent', 'false']);

/** The slides with a video inset, in deck order: [{ n, id, inset, builds }]. */
function insetSlides(dir) {
  const { order, modules } = readDeck(dir);
  const entries = (modules && modules.slides) || {};
  return order.map((id, i) => ({ n: i + 1, id, inset: entries[id] && entries[id].inset }))
    .filter((s) => s.inset && typeof s.inset === 'object' && !Array.isArray(s.inset));
}

/**
 * An inset as the engine plays it: { rel, file, rect, from, to, sound, cue }, or { rel, problem } in plain words. The
 * clip must be a file inside the episode's presentation folder (assets/calls/…, or a Library copy in assets/library/).
 */
function readInset(dir, inset) {
  const pres = path.join(dir, 'presentation');
  const rel = typeof inset.clip === 'string' ? inset.clip.trim() : '';
  if (!rel) return { rel, problem: 'has no clip' };
  let file;
  try { file = fs.realpathSync(path.resolve(pres, rel)); } catch { return { rel, problem: `clip ${rel} isn't there` }; }
  if (!file.startsWith(fs.realpathSync(pres) + path.sep) || !fs.statSync(file).isFile()) return { rel, problem: `clip ${rel} isn't a file inside this episode` };
  if (references.isReference(file)) return { rel, problem: `clip ${rel} is a reference, and references stay private` };
  const r = inset.rect && typeof inset.rect === 'object' ? inset.rect : {};
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  const [x0, y0, w0, h0] = [r.x, r.y, r.w, r.h].map(num);
  if ([x0, y0, w0, h0].some(Number.isNaN) || w0 < 16 || h0 < 16) return { rel, problem: 'has no frame to play in (rect: x, y, w, h)' };
  const even = (v) => 2 * Math.round(v / 2);
  const x = Math.min(Math.max(0, even(x0)), FRAME.w - 16);
  const y = Math.min(Math.max(0, even(y0)), FRAME.h - 16);
  const rect = { x, y, w: Math.min(even(w0), FRAME.w - x), h: Math.min(even(h0), FRAME.h - y) };
  const from = Math.max(0, num(inset.in) || 0);
  const to = num(inset.out) > from ? num(inset.out) : null; // none (or not after "in"): to the clip's end
  const sound = inset.sound === true || (inset.sound != null && inset.sound !== false && !MUTED.has(String(inset.sound).trim().toLowerCase()));
  const cue = typeof inset.cue === 'string' && inset.cue.trim() ? inset.cue.trim() : null;
  return { rel, file, rect, from, to, sound, cue };
}

/**
 * This kind of run's own timeline, as retime.py picks it (FLPT_RETIME_TL_V1): presentation.timeline.json or
 * draft_presentation.timeline.json by name (Refine writes presentation_refined/_tight beside them), else the newest of
 * its kind. Slide n's place on screen, and the cut scenes.
 */
function timelineOf(dir, which) {
  const out = path.join(dir, 'presentation', 'video', 'output');
  const pinned = path.join(out, which === 'draft' ? 'draft_presentation.timeline.json' : 'presentation.timeline.json');
  if (exists(pinned)) return readJson(pinned, null);
  const names = (() => { try { return fs.readdirSync(out); } catch { return []; } })()
    .filter((f) => f.endsWith('.timeline.json') && f.includes('draft') === (which === 'draft'));
  const newest = names.map((f) => path.join(out, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  return newest ? readJson(newest, null) : null;
}

/** Slide n's narration WAV in the pipeline's cache, as retime.py finds it (the draft's is macOS say's), or null. */
function narrationWav(dir, n, which) {
  const root = path.join(dir, 'presentation', 'video', 'cache', 'audio');
  const found = [];
  for (const engine of (() => { try { return fs.readdirSync(root); } catch { return []; } })()) {
    if ((engine === 'say') !== (which === 'draft')) continue;
    for (const f of (() => { try { return fs.readdirSync(path.join(root, engine)); } catch { return []; } })()) {
      if (!f.endsWith('.json')) continue;
      const meta = readJson(path.join(root, engine, f), {}) || {};
      if (new RegExp(`^slide\\s+${n}$`).test(String(meta.item || ''))) found.push({ created: String(meta.created || ''), wav: path.join(root, engine, f.replace(/\.json$/, '.wav')) });
    }
  }
  const best = found.sort((a, b) => b.created.localeCompare(a.created))[0];
  return best && exists(best.wav) ? best.wav : null;
}

/**
 * When the cue's first word starts, in seconds into the narration ([{ text, start }], from real-words.py), or null.
 * `after`: only a match that starts later than this (cues said in order).
 */
function cueStart(words, cue, after = -Infinity) {
  const toks = [];
  const owner = [];
  (Array.isArray(words) ? words : []).forEach((w, i) => norm(w.text || w.word || '').split(' ').filter(Boolean).forEach((t) => { toks.push(t); owner.push(i); }));
  const want = norm(cue).split(' ').filter(Boolean);
  for (let i = 0; want.length && i <= toks.length - want.length; i++) {
    if (want.every((t, k) => toks[i + k] === t) && Number(words[owner[i]].start) > after) return Number(words[owner[i]].start);
  }
  return null;
}

/**
 * Play one slide's inset: write media/slide_NN.mp4 (its moving clip with the inset on top, or its picture with the
 * inset on top). Returns { ok, volume?, problems }. `moving`: the slide's HyperFrames clip just rendered.
 */
async function renderInset(dir, which, s, { moving, engineRoot, retime, probe, ffmpeg, onLine, signal }) {
  const problems = [];
  const fail = (why) => ({ ok: false, problems: [...problems, `Slide ${s.n} ${moving ? 'plays without its inset' : 'stays still'}: ${why}.`] });
  const i = readInset(dir, s.inset);
  if (i.problem) return fail(`the inset ${i.problem}`);
  let info;
  try { info = await probe(i.file); } catch { info = null; }
  const v = info && (info.streams || []).find((x) => x.codec_type === 'video');
  const length = info && parseFloat((info.format && info.format.duration) || (v && v.duration));
  if (!v || !(length > 0)) return fail(`its inset clip ${i.rel} can't be read`);
  const tl = timelineOf(dir, which);
  const slot = tl && (tl.slides || []).find((x) => x.n === s.n);
  if (!slot) return fail('the slide isn\'t in the timeline');
  const D = Math.round((slot.duration - 1 / FPS) * 1000) / 1000; // as retime.py: the slide's time on screen, less a frame
  // When the clip starts: on its cue's words (timed to the voice), else half a second in.
  let t0 = INSET_START;
  if (i.cue) {
    const first = Math.min(...tl.slides.map((x) => x.n));
    const offset = s.n === first || (tl.cutscenes || []).some((c) => c.after_slide === s.n - 1) ? 0.5 : 0;
    const folder = hfDir(dir, s.n);
    const wordsFile = path.join(folder, 'words.json');
    if (!exists(wordsFile)) { // a moving slide has them from retime.py; otherwise, from the voice the same way
      const wav = narrationWav(dir, s.n, which);
      if (wav) {
        fs.writeFileSync(path.join(folder, 'narration.txt'), narrations(dir)[s.n] || '');
        await retime([path.join(templateDir(engineRoot), 'real-words.py'), wav, path.join(folder, 'narration.txt'), wordsFile], { signal });
      }
    }
    const at = cueStart(readJson(wordsFile, []), i.cue);
    const guess = norm(narrations(dir)[s.n] || '').indexOf(norm(i.cue));
    if (at != null) t0 = Math.max(0, at + offset - LEAD);
    else if (guess >= 0) t0 = Math.max(0, offset + guess / RATE - LEAD); // no word timings: where the words fall at the voice's pace
    else problems.push(`Slide ${s.n}: the inset's cue "${i.cue}" isn't in the narration, so the clip starts half a second in.`);
  }
  if (i.from >= length) return fail(`its inset starts at ${i.from} s, after the clip ends (${Math.round(length * 10) / 10} s)`);
  const play = Math.min((i.to == null ? length : Math.min(i.to, length)) - i.from, D - t0 - 0.1);
  if (!(play >= 0.2)) return fail('its inset would start after the slide ends');
  const sound = i.sound && (info.streams || []).some((x) => x.codec_type === 'audio');
  const { x, y, w, h } = i.rect;
  const base = moving ? ['-i', clipPath(dir, s.n)] : ['-loop', '1', '-framerate', String(FPS), '-t', D.toFixed(3), '-i', path.join(dir, 'presentation', 'slides', `slide_${pad2(s.n)}.png`)];
  if (!moving && !exists(base[base.length - 1])) return fail('its slide picture isn\'t rendered');
  const graph = [
    moving ? `[0:v]setpts=PTS-STARTPTS,fps=${FPS},format=yuv420p,setsar=1[base]`
      : `[0:v]scale=${FRAME.w}:${FRAME.h}:out_color_matrix=bt709:out_range=tv,format=yuv420p,setsar=1[base]`,
    `[1:v]setpts=PTS-STARTPTS,fps=${FPS},scale=${w}:${h}:force_original_aspect_ratio=increase:force_divisible_by=2:out_color_matrix=bt709:out_range=tv,`
      + `crop=${w}:${h},setsar=1,format=yuv420p,setpts=PTS+${t0.toFixed(3)}/TB[clip]`,
    `[base][clip]overlay=${x}:${y}:eof_action=pass:format=yuv420,format=yuv420p[v]`,
  ];
  if (sound) graph.push(`[1:a]asetpts=PTS-STARTPTS,aresample=48000,adelay=delays=${Math.round(t0 * 1000)}:all=1,apad,atrim=end=${D.toFixed(3)}[a]`);
  const tmp = path.join(path.dirname(clipPath(dir, s.n)), `.slide_${pad2(s.n)}.inset-${process.pid}.mp4`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  const args = ['-y', '-v', 'error', ...base, '-ss', i.from.toFixed(3), '-t', play.toFixed(3), '-i', i.file,
    '-filter_complex', graph.join(';'), '-map', '[v]', ...(sound ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000'] : ['-an']),
    '-t', D.toFixed(3), '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-g', String(FPS),
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-movflags', '+faststart', tmp];
  onLine(`Slide ${s.n}: playing ${path.basename(i.rel)} in its frame from ${t0.toFixed(1)} s${sound ? ', with its sound' : ''}…`);
  const r = await ffmpeg(args, { signal });
  if (r.code !== 0 || !(await clipOk(tmp, probe))) {
    fs.rmSync(tmp, { force: true });
    if (r.err) onLine(r.err.trim().split('\n').slice(-3).join(' | '));
    return fail('the inset didn\'t render (see the log)');
  }
  fs.renameSync(tmp, clipPath(dir, s.n));
  return { ok: true, volume: sound ? INSET_VOLUME : null, at: Math.round(t0 * 1000) / 1000, seconds: Math.round(play * 1000) / 1000, problems };
}

/** When slide n's inset played in the last render ({ which: 'draft' | 'final', at, seconds }, seconds into the slide), or null. */
function insetPlayed(dir, n) {
  const p = (readJson(path.join(hfDir(dir, n), MARKER), {}) || {}).played;
  return p && Number.isFinite(Number(p.at)) && Number(p.seconds) > 0 ? { which: p.which, at: Number(p.at), seconds: Number(p.seconds) } : null;
}

/** A folder of FLPT's for a slide whose only motion is its inset: the ownership marker, and the inset's word timings. */
function insetFolder(dir, s) {
  const out = hfDir(dir, s.n);
  const old = readJson(path.join(out, MARKER), {}) || {};
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  writeAtomic(path.join(out, MARKER), `${JSON.stringify({ made: 'Fatty Lumpkin Presentation Tool', slide: s.id, inset: true, clip: old.clip || null }, null, 2)}\n`);
}

// ── cartoons: the Scenes step's keyframes and hero shot, timed to the voice ──────────────────────────────────

/**
 * Where a cartoon's beats fall in a run's voice: the slide's time on screen (as retime.py takes it) and each beat's
 * time, from its cue's words in that voice (real-words.py), else where the words fall at the voice's pace. Null when
 * the slide isn't in that run's timeline.
 */
async function cartoonTiming(dir, which, piece, { retime, engineRoot, signal } = {}) {
  const said = narrations(dir)[piece.n] || '';
  const text = norm(said);
  let duration;
  let offset;
  let words = null;
  if (which === 'preview') { // no voice yet: the pace alone
    const cut = scenes.plan(dir).cutscenes.some((c) => c.afterN === piece.n - 1 && c.afterN != null);
    offset = piece.n === 1 || cut ? 0.5 : 0;
    duration = Math.max(6, Math.round((text.length / RATE + offset + 1) * FPS) / FPS);
  } else {
    const tl = timelineOf(dir, which);
    const slot = tl && (tl.slides || []).find((x) => x.n === piece.n);
    if (!slot) return null;
    duration = Math.round((slot.duration - 1 / FPS) * 1000) / 1000; // as retime.py: the slide's time on screen, less a frame
    const first = Math.min(...tl.slides.map((x) => x.n));
    offset = piece.n === first || (tl.cutscenes || []).some((c) => c.after_slide === piece.n - 1) ? 0.5 : 0;
    const wav = narrationWav(dir, piece.n, which);
    if (wav && retime) {
      const folder = path.join(dir, 'presentation', 'cartoons', piece.id);
      fs.mkdirSync(folder, { recursive: true });
      const out = path.join(folder, `words-${which}.json`);
      fs.rmSync(out, { force: true });
      fs.writeFileSync(path.join(folder, 'narration.txt'), said);
      await retime([path.join(templateDir(engineRoot), 'real-words.py'), wav, path.join(folder, 'narration.txt'), out], { signal });
      words = readJson(out, null);
    }
  }
  const problems = [];
  let last = -Infinity;
  const times = piece.beats.map((b) => {
    const at = words && b.cue ? cueStart(words, b.cue, last) : null;
    if (at != null) { last = at; return Math.max(0, at + offset - LEAD); }
    const guess = b.cue ? text.indexOf(norm(b.cue)) : -1;
    if (guess >= 0) return Math.max(0, offset + guess / RATE - LEAD);
    if (b.cue) problems.push(`Slide ${piece.n}: the narration doesn't say "${b.cue}", so that keyframe goes between its neighbours.`);
    return null;
  });
  return { duration, times, problems };
}

/** Put one cartoon together for a run ('preview', 'draft' or 'final'). Returns { ok, problems }. */
async function renderCartoon(dir, which, { piece, inputs }, { retime, probe, ffmpeg, engineRoot, onLine = () => {}, signal }) {
  const fail = (why) => ({ ok: false, problems: [`Slide ${piece.n} shows its title card: ${why}.`] });
  const timing = await cartoonTiming(dir, which, piece, { retime, engineRoot, signal });
  if (!timing) return fail('it isn\'t in this run\'s timeline');
  const pres = path.join(dir, 'presentation');
  // nothing that goes into the film is ever a reference (they stay private, W1-12)
  try { for (const f of [inputs.card, inputs.hero && inputs.hero.file, ...inputs.beats.map((b) => b.file)].filter(Boolean)) references.assertNotReference(path.join(pres, f)); } catch (e) { return fail(e.message.replace(/\.$/, '')); }
  const card = exists(path.join(pres, inputs.card)) ? path.join(pres, inputs.card) : null;
  onLine(`Slide ${piece.n}: putting the cartoon together${which === 'preview' ? '' : ` to the ${which === 'draft' ? 'draft voice' : 'real voice'}`}…`);
  let hero = null;
  if (inputs.hero) {
    // Its length, and a picture of its last frame: a beat longer than the shot holds that frame with a slow push.
    const file = path.join(pres, inputs.hero.file);
    let seconds = 0;
    try { const i = await probe(file); seconds = Number((i.format && i.format.duration) || 0) || 0; } catch { /* it plays as it is */ }
    const last = path.join(path.dirname(file), 'hero-last.png');
    fs.rmSync(last, { force: true });
    if (seconds > 0) await ffmpeg(['-y', '-v', 'error', '-sseof', '-0.5', '-i', file, '-update', '1', last], { signal }); // every frame over the last: it ends on the last
    hero = { beat: inputs.hero.beat, file, seconds, last: exists(last) ? last : null };
  }
  try {
    await assemble.cartoon({
      out: path.join(pres, inputs.out), card, duration: timing.duration, run: ffmpeg, signal, hero,
      beats: inputs.beats.map((b, k) => ({ file: path.join(pres, b.file), t: timing.times[k] })),
    });
  } catch (e) {
    return fail(String(e.message || e).replace(/\.$/, ''));
  }
  if (!(await clipOk(path.join(pres, inputs.out), probe))) return fail('its clip didn\'t come out right (see the log)');
  scenes.markClip(dir, piece.key, { inputs: inputs.key, for: which, seconds: timing.duration });
  return { ok: true, problems: timing.problems };
}

/**
 * The Scenes step's "put it together", free: a cartoon timed to the narration's pace (each run times it to its own
 * voice later), or a cut scene joined, levelled and conformed. Updates media.json. Throws a plain message.
 */
async function assembleScene(dir, key, { probe, ffmpeg, onLine = () => {}, signal } = {}) {
  if (!ffmpeg || !probe) throw new Error('Putting it together needs ffmpeg (Setup → Tools).');
  const piece = scenes.pieceOf(dir, key);
  const inputs = scenes.inputsOf(dir, piece);
  if (!inputs) throw new Error('Approve its stills and shots first.');
  const pres = path.join(dir, 'presentation');
  let out;
  if (piece.kind === 'cartoon') {
    const r = await renderCartoon(dir, 'preview', { piece, inputs }, { probe, ffmpeg, onLine, signal });
    if (!r.ok) throw new Error(r.problems[0]);
    out = { file: path.join(pres, inputs.out), problems: r.problems };
  } else {
    for (const sh of inputs.shots) references.assertNotReference(path.join(pres, sh.file));
    onLine(`${piece.title}: joining ${inputs.shots.length} shots…`);
    const r = await assemble.cutscene({ out: path.join(pres, inputs.out), shots: inputs.shots.map((s) => ({ file: path.join(pres, s.file), seconds: s.seconds })), run: ffmpeg, probe, signal });
    scenes.markClip(dir, key, { inputs: inputs.key, seconds: r.seconds, lufs: r.lufs });
    out = { file: path.join(pres, inputs.out), seconds: r.seconds, problems: r.problems || [] }; // the stem check's, from assemble.cutscene (W2-03 handoff 6)
  }
  refreshMedia(dir);
  return out;
}

/**
 * Compose, time and render the moving slides for a run that has just made narration: 'draft' (the Mac's voice) or
 * 'final' (the real voice), then play the video insets, then put the Scenes step's cartoons together to the same voice.
 * `retime` runs a method script (retime.py, real-words.py) with the project's Python; `probe` is ffprobe; `ffmpeg`
 * runs the toolchain's ffmpeg. Without HyperFrames (`hyperframes: false`) the slides stay still, and only the insets
 * and cartoons play. `afterRender(dir, which, rendered)`, when given, runs last (the Live Motion scenes, timed to the
 * same voice) and returns { mix, scenes } to merge into media.json (see writeMedia); if it throws, media.json still
 * gets what did render, and the error goes on up. Returns { rendered: [n], failed: [n], problems: [text] } and
 * updates media.json to the clips that are good.
 */
async function render(dir, which, { engineRoot, fontCacheDir, fetchImpl, retime, probe, ffmpeg, hyperframes = true, afterRender, onLine = () => {}, signal }) {
  // Live Motion folders follow their slides first (a moved slide takes its scene along; one that left is parked)
  try { for (const note of require('./livemotion').sync(dir)) onLine(note); } catch (e) { onLine(`! Live Motion: ${String(e && e.message ? e.message : e).slice(0, 200)}`); }
  const userVideo = userVideoSlides(dir);
  const bespokeAll = new Set(bespokeSlides(dir));
  // A cartoon replaces its title card's animation and any inset; the user's own slides stay theirs.
  const cartoons = scenes.readyCartoons(dir).filter(({ piece }) => !userVideo.has(piece.n) && !bespokeAll.has(piece.n));
  const toons = cartoons.map(({ piece }) => piece.n);
  // a scene's slide plays its scene (an inset there would replace its folder)
  const scenesHere = new Set(sceneSlides(dir));
  const insets = insetSlides(dir).filter((s) => !userVideo.has(s.n) && !bespokeAll.has(s.n) && !toons.includes(s.n) && !scenesHere.has(s.n) && !isSceneFolder(hfDir(dir, s.n)));
  const keep = insets.map((s) => s.n);
  let composed = { slides: [], bespoke: [], problems: [] };
  if (hyperframes) composed = await compose(dir, { engineRoot, fontCacheDir, fetchImpl, keep, skip: toons });
  else sweep(dir, new Set(keep));
  const { slides, bespoke } = composed;
  const problems = [...composed.problems];
  // The user's own animations render too, but only into a clip path that's free or already theirs to replace.
  const numbers = [...new Set([...slides.map((s) => s.n), ...bespoke])].sort((a, b) => a - b);
  const rendered = [];
  const failed = [];
  let r = null;
  // what render.mjs names on a slide that flpt-tween can't move (its "✗ … FlptTweenUnsupported: …" lines), by slide (W3-12)
  const unmoved = new Map();
  if (numbers.length) {
    onLine(`Moving slides: timing ${numbers.length} to the ${which === 'draft' ? 'draft voice' : 'real voice'} and rendering them…`);
    for (const n of slides.map((s) => s.n)) fs.rmSync(clipPath(dir, n), { force: true }); // FLPT's own (checked in compose)
    const args = [path.join(templateDir(engineRoot), 'retime.py'), path.join(dir, 'presentation'), '--slides', numbers.join(',')];
    if (which === 'draft') args.push('--draft');
    let current = null;
    const watch = (line) => {
      const head = /^\s*── slide (\d+)\b/.exec(String(line));
      if (head) current = Number(head[1]);
      const named = /^\s*✗ (.*FlptTweenUnsupported: .*)$/.exec(String(line));
      if (named && current !== null) { if (!unmoved.has(current)) unmoved.set(current, new Set()); unmoved.get(current).add(named[1].trim()); }
      onLine(line);
    };
    r = await retime(args, { onLine: watch, signal });
    for (const n of numbers) (await clipOk(clipPath(dir, n), probe) ? rendered : failed).push(n);
  }
  const unnamed = failed.filter((n) => !unmoved.has(n));
  if (unnamed.length) problems.push(`Slide${unnamed.length > 1 ? 's' : ''} ${unnamed.join(', ')} stay${unnamed.length > 1 ? '' : 's'} still: the animation didn't render${r && r.code === 0 ? '' : ' (see the log)'}.`);
  for (const n of failed.filter((x) => unmoved.has(x))) problems.push(`Slide ${n} stays still: ${[...unmoved.get(n)].join('; ')}.`);
  const mix = {};
  const played = {}; // when each inset plays in its slide, for the clip guide
  for (const s of insets) {
    if (signal && signal.aborted) break;
    const moving = rendered.includes(s.n);
    if (!moving) {
      if (!clipIsOurs(dir, s.n)) { problems.push(`${s.id}: media/slide_${pad2(s.n)}.mp4 is a video of yours, so this slide stays as it is`); continue; }
      insetFolder(dir, s);
    }
    if (!ffmpeg) { problems.push(`Slide ${s.n} ${moving ? 'plays without its inset' : 'stays still'}: video insets need ffmpeg.`); continue; }
    const res = await renderInset(dir, which, s, { moving, engineRoot, retime, probe, ffmpeg, onLine, signal });
    problems.push(...res.problems);
    if (!res.ok) continue;
    if (!moving) rendered.push(s.n);
    if (res.volume) mix[s.n] = res.volume;
    played[s.n] = { which, at: res.at, seconds: res.seconds };
  }
  rendered.sort((a, b) => a - b);
  for (const n of rendered) {
    const markFile = path.join(hfDir(dir, n), MARKER);
    if (exists(markFile)) writeAtomic(markFile, `${JSON.stringify({ ...readJson(markFile, {}), clip: sha(clipPath(dir, n)), ...(played[n] ? { played: played[n] } : {}) }, null, 2)}\n`);
  }
  const made = {};
  for (const c of cartoons) {
    if (signal && signal.aborted) break;
    if (!ffmpeg) { problems.push(`Slide ${c.piece.n} shows its title card: cartoons need ffmpeg.`); continue; }
    const res = await renderCartoon(dir, which, c, { retime, probe, ffmpeg, engineRoot, onLine, signal });
    problems.push(...res.problems);
    if (res.ok) made[c.piece.n] = c.inputs.out;
  }
  let extra = {};
  let hookError = null;
  if (typeof afterRender === 'function' && !(signal && signal.aborted)) {
    try { extra = (await afterRender(dir, which, [...rendered])) || {}; } catch (e) { hookError = e; }
  }
  const sceneClips = extra.scenes && typeof extra.scenes === 'object' ? extra.scenes : {};
  writeMedia(dir, rendered, { mix: { ...mix, ...(extra.mix && typeof extra.mix === 'object' ? extra.mix : {}) }, cartoons: made, scenes: sceneClips });
  if (hookError) throw hookError;
  if (Array.isArray(extra.problems)) problems.push(...extra.problems.map(String));
  const slidesNow = (readJson(mediaFile(dir), {}) || {}).slides || {};
  const live = Object.keys(sceneClips).map(Number).filter((n) => { const e = slidesNow[String(n)]; return e && e.note === SCENE_NOTE && e.video; });
  return { rendered: [...new Set([...rendered, ...Object.keys(made).map(Number), ...live])].sort((a, b) => a - b), failed, problems: [...new Set(problems)] };
}

/**
 * Forget the clips in media.json (before a run whose timing they'd get wrong), keeping everything else, the hidden
 * bubbles of the cartoons and Motion Solo scenes (the paid run must never make an avatar clip for them) and the
 * finished cut scenes.
 */
function clearMedia(dir) { writeMedia(dir, []); }

module.exports = { plan, compose, render, writeMedia, clearMedia, refreshMedia, hiddenBubbleSlides, sceneSlides, cartoonSlides, cosmosSlides,
  noBubbleSlides, sceneEntry, isOurs, pipelineStereo, narrations, provisional,
  beatFrom, localFonts, vendoredFonts, episodeFonts, readFontSnapshot, faceHrefs, fontFaceCss, sanitizeFonts, extractSection, clipPath, checkBuilds, checkCues, checkInsets, insetSlides, readInset,
  insetPlayed, cueStart, cartoonTiming, assembleScene, MOTION_NOTE, CARTOON_NOTE, CUT_NOTE, SCENE_NOTE, STEREO_MARKER, BASE_CSS, INSET_VOLUME,
  // for the animator crew (animators.js)
  readDeck, hfDir, MARKER, bespokeSlides, userVideoSlides, timelineOf, narrationWav, localBlobs, page, templateDir, tweenFile, clipOk, sha, norm,
  // for Live Motion (livemotion.js)
  isSceneFolder, clipIsOurs, SCENE_FILE,
  FPS, RATE, LEAD };
