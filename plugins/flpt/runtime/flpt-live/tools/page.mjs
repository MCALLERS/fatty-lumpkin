// page.mjs · build the host page for one scene folder (PLAN §2.3 "the generated host page"; the crew can't write it).
//
//   buildPage({ scene, work, duration?, hold?, host: 'hf'|'preview'|'direct'|'none', styles?: { id: dir }, stamp? })
//     -> { work, index, duration, frames, hold, style, styleDir, fonts, pictures }
//
// scene/ holds the crew's files: scene.js, beats.json (or a generated beats.js), and optionally assets/pictures/ and
// assets/fonts/. Everything else is generated into work/: index.html from page/index.template.html, beats.js in
// render.mjs's shape (window.__SLIDE__), and assets/ with the runtime, guard, shared kits, the style's kit.js, the
// fonts (TrueType bytes embedded in files.js, so ctx.text can draw outlines without fetch) and the pictures.
// With work === scene it writes only the generated files, in place (what livemotion.page() does in a slide folder).
// Script order: guard.js (locks the page, told which scripts are scene code), beats, the runtime, files, the shared
// kits, the host (so its listeners are set before any scene code runs), then the scene code, each tagged
// data-flpt-scene: the style's kit.js, the scene's kit-ext.js when it has one, scene.js.
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { RUNTIME, ENGINE, FPS } from './lib.mjs';

export const KIT_ORDER = ['paper', 'ink', 'print', 'pixel', 'type', 'chart'];
const HOSTS = { hf: 'bridge-hf.js', preview: 'host-preview.js', direct: null, none: null };
const FONT_EXT = new Set(['.ttf', '.otf', '.woff', '.woff2']);
const PIC_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);

/** The shared kits as one script (kit/*.js in a fixed order), the same bytes for the page, the app and the site. */
export function kitsBundle() {
  const files = KIT_ORDER.map((k) => join(RUNTIME, 'kit', `${k}.js`)).filter((f) => existsSync(f));
  return `/* kits.js · flpt-live's shared kits (${files.map((f) => basename(f, '.js')).join(', ')}), bundled from engine/runtime/flpt-live/kit/. Generated; edit the kit files. */\n`
    + files.map((f) => readFileSync(f, 'utf8').trimEnd() + '\n').join('');
}

/** The style id a scene asks for: beats.json "style", else FLPT.scene({ style: '...' }) in scene.js. */
export function styleOf(sceneDir) {
  try { const b = JSON.parse(readFileSync(join(sceneDir, 'beats.json'), 'utf8')); if (b && typeof b.style === 'string') return b.style; } catch { /* none */ }
  try {
    const src = readFileSync(join(sceneDir, 'scene.js'), 'utf8'), at = src.search(/FLPT\s*\.\s*scene\s*\(/);
    const m = at >= 0 && src.slice(at, at + 4000).match(/\bstyle\s*:\s*['"]([a-z0-9][a-z0-9-]{0,47})['"]/);
    if (m) return m[1];
  } catch { /* none */ }
  return null;
}

/** Where a style's folder (kit.js, fonts/, LICENSE) is: explicit, then the scene's sibling styles/, the demos, engine/styles. */
export function findStyle(id, sceneDir, explicit = {}) {
  const c = [explicit[id], join(sceneDir, '..', 'styles', id), join(RUNTIME, 'demos', 'kits', id), join(ENGINE, 'styles', id)];
  return c.find((d) => d && existsSync(join(d, 'kit.js'))) || null;
}

const listFiles = (dir, exts) => (existsSync(dir) ? readdirSync(dir).filter((f) => exts.has(extname(f).toLowerCase()) && statSync(join(dir, f)).isFile()).sort() : []);

export function buildPage({ scene, work, duration, hold, host = 'hf', styles = {}, stamp = false, fps = FPS }) {
  const src = resolve(scene);
  const out = resolve(work || scene);
  const inPlace = out === src;
  if (!existsSync(join(src, 'scene.js'))) throw new Error(`${src} has no scene.js`);
  if (!(host in HOSTS)) throw new Error(`unknown host ${host}`);
  let beats = null;
  if (existsSync(join(src, 'beats.json'))) beats = JSON.parse(readFileSync(join(src, 'beats.json'), 'utf8'));
  const want = Number(duration) || (beats && Number(beats.duration)) || 0;
  if (!(want > 0)) throw new Error('the scene needs a duration (--duration, or "duration" in beats.json)');
  const frames = Math.round(want * fps);
  const d = +(frames / fps).toFixed(6);
  const h = hold != null ? Number(hold) : beats && beats.hold != null ? Number(beats.hold) : 0.5;

  if (!inPlace) {
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    copyFileSync(join(src, 'scene.js'), join(out, 'scene.js'));
    if (existsSync(join(src, 'kit-ext.js'))) copyFileSync(join(src, 'kit-ext.js'), join(out, 'kit-ext.js'));
    if (existsSync(join(src, 'assets'))) cpSync(join(src, 'assets'), join(out, 'assets'), { recursive: true });
  }
  const A = join(out, 'assets');
  mkdirSync(A, { recursive: true });
  for (const f of ['guard.js', 'flpt-live.js', 'LICENSE-animate.md', ...(HOSTS[host] ? [HOSTS[host]] : [])]) copyFileSync(join(RUNTIME, f), join(A, f));
  copyFileSync(join(RUNTIME, 'page', 'scene.css'), join(A, 'scene.css'));
  writeFileSync(join(A, 'kits.js'), kitsBundle());

  // beats.js in render.mjs's shape, so a page rendered by render.mjs or by us reads the same thing
  if (beats) writeFileSync(join(out, 'beats.js'), `// GENERATED from beats.json; edit beats.json.\nwindow.__SLIDE__ = ${JSON.stringify({ ...beats, duration: d, fps, hold: h })};\n`);
  else if (!inPlace && existsSync(join(src, 'beats.js'))) copyFileSync(join(src, 'beats.js'), join(out, 'beats.js'));
  else if (!existsSync(join(out, 'beats.js'))) writeFileSync(join(out, 'beats.js'), `window.__SLIDE__ = ${JSON.stringify({ duration: d, fps, hold: h, beats: [] })};\n`);

  // the style: its kit.js and fonts; the scene's own fonts and pictures
  const style = styleOf(src);
  const styleDir = style ? findStyle(style, src, styles) : null;
  if (style && !styleDir) throw new Error(`style "${style}" not found (no kit.js)`);
  const fonts = new Map();
  if (styleDir) {
    const sd = join(A, 'styles', style);
    mkdirSync(sd, { recursive: true });
    copyFileSync(join(styleDir, 'kit.js'), join(sd, 'kit.js'));
    for (const lic of ['LICENSE', 'LICENSE.md']) if (existsSync(join(styleDir, lic))) copyFileSync(join(styleDir, lic), join(sd, lic));
    for (const f of listFiles(join(styleDir, 'fonts'), FONT_EXT)) fonts.set(f, join(styleDir, 'fonts', f));
  }
  for (const f of listFiles(join(src, 'assets', 'fonts'), FONT_EXT)) fonts.set(f, join(src, 'assets', 'fonts', f));
  mkdirSync(join(A, 'fonts'), { recursive: true });
  const embedded = {};
  for (const [name, file] of [...fonts].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (!existsSync(join(A, 'fonts', name))) copyFileSync(file, join(A, 'fonts', name));
    if (/\.(ttf|otf)$/i.test(name)) embedded[name] = readFileSync(file).toString('base64');
  }
  const pictures = listFiles(join(src, 'assets', 'pictures'), PIC_EXT);
  writeFileSync(join(A, 'files.js'), `/* files.js · generated: the scene's fonts (TrueType bytes for outline type) and pictures. */\nFLPT.__files(${JSON.stringify({ fonts: embedded, pictures })});\n`);

  const kitExt = existsSync(join(src, 'kit-ext.js'));
  const scenes = [...(style ? [`assets/styles/${style}/kit.js`] : []), ...(kitExt ? ['kit-ext.js'] : []), 'scene.js'];
  const html = readFileSync(join(RUNTIME, 'page', 'index.template.html'), 'utf8')
    .replace('{{duration}}', String(d))
    .replace('{{stamp}}', stamp ? ' data-flpt-stamp' : '')
    .replace('{{scenes}}', scenes.join(' '))
    .replace('{{host}}', HOSTS[host] ? `<script src="assets/${HOSTS[host]}"></script>` : '')
    .replace('{{styles}}', style ? `<script src="assets/styles/${style}/kit.js" data-flpt-scene></script>` : '')
    .replace('{{kitext}}', kitExt ? '<script src="kit-ext.js" data-flpt-scene></script>' : '');
  writeFileSync(join(out, 'index.html'), html);
  return { work: out, index: join(out, 'index.html'), duration: d, frames, hold: h, style, styleDir, kitExt, scenes, fonts: [...fonts.keys()].sort(), pictures };
}
