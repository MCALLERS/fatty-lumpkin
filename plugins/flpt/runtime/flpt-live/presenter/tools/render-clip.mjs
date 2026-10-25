// render-clip.mjs · a compiled presenter track (flpt.track/1) → a 720² 30 fps H.264 clip with the padded narration
// muxed in (PLAN §2.12; K7's render path). The drawer (draw.js) runs in the pinned chrome-headless-shell, driven by the
// pinned puppeteer-core (tools/lib.mjs), on a 2D canvas; each frame comes out as a PNG and goes straight into the
// toolchain's ffmpeg. No network: the page is built in memory (the rig's layers as data: URLs) and every other request
// is aborted, behind lib.mjs's dead proxy; the whole pass runs inside FLPT's sandbox (make-clips.mjs). Layers are
// rasterised once at the camera's scale and cropped to what they cover (K7: 25 → 1.9 ms a frame, 139–185 fps).
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const require = createRequire(import.meta.url);
const { layerFiles } = require(join(ROOT, 'rig.js'));
const { RENDERER_VERSION } = require(join(ROOT, 'keys.js'));
export { RENDERER_VERSION };

const MIME = { svg: 'image/svg+xml', png: 'image/png' };
// JSON a <script> can hold whatever it says: no "</script>", "<!--" or line separators can end or bend the script
const inScript = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/** The render page for a rig: the drawer, the rig and its layers inline. */
export function pageHtml(rigDir) {
  const rig = JSON.parse(readFileSync(join(rigDir, 'rig.json'), 'utf8'));
  const draw = readFileSync(join(ROOT, 'draw.js'), 'utf8');
  const srcs = {};
  for (const [k, f] of Object.entries(layerFiles(rig))) {
    srcs[k] = `data:${MIME[f.split('.').pop().toLowerCase()]};base64,${readFileSync(join(rigDir, f)).toString('base64')}`;
  }
  return { rig, html: `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;background:#000}canvas{display:block}</style></head>
<body><canvas id="c" width="${rig.canvas.w}" height="${rig.canvas.h}"></canvas>
<script>${draw}</script>
<script>
const RIG = ${inScript(rig)};
const SRCS = ${inScript(srcs)};
let TRACK = null, PICS = null;
const ctx = document.getElementById('c').getContext('2d');
window.__layers = async () => {
  if (PICS) return Object.keys(PICS).length;
  PICS = {};
  const z = (RIG.camera && RIG.camera.scale) || 1;
  const W = Math.round(RIG.canvas.w * z), H = Math.round(RIG.canvas.h * z);
  for (const [k, src] of Object.entries(SRCS)) {
    const im = new Image(); im.src = src; await im.decode();
    const cv = new OffscreenCanvas(W, H), g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(im, 0, 0, W, H);
    const a = g.getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (a[(y * W + x) * 4 + 3]) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) continue;
    x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2); x1 = Math.min(W - 1, x1 + 2); y1 = Math.min(H - 1, y1 + 2);
    const img = await createImageBitmap(cv, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    PICS[k] = { img, x: x0 / z, y: y0 / z, w: (x1 - x0 + 1) / z, h: (y1 - y0 + 1) / z };
  }
  return Object.keys(PICS).length;
};
window.__track = (t) => { TRACK = t; return t.frames; };
window.__batch = (from, n) => {
  const out = [];
  for (let f = from; f < from + n; f++) {
    FLPTPresenter.drawPresenter(ctx, FLPTPresenter.stateAt(TRACK, f), RIG, PICS);
    out.push(ctx.canvas.toDataURL('image/png').slice(22));
  }
  return out;
};
</script></body></html>` };
}

/** A page for one rig in a browser lib.mjs launched: its layers ready, nothing reaching out. */
export async function openRig(browser, rigDir) {
  const { rig, html } = pageHtml(rigDir);
  const page = await browser.newPage();
  await page.setViewport({ width: rig.canvas.w, height: rig.canvas.h, deviceScaleFactor: 1 });
  await page.setRequestInterception(true);
  page.on('request', (r) => (r.url().startsWith('data:') || r.url() === 'about:blank' ? r.continue() : r.abort()));
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.message) || e).slice(0, 200)));
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => window.__layers());
  return { page, rig, errors };
}

/** One frame of a track as PNG bytes (the still bubble, a rig's poster). */
export async function stillPng({ page }, track, f = 0) {
  await page.evaluate((t) => window.__track(t), track);
  const [b64] = await page.evaluate((a) => window.__batch(a, 1), f);
  return Buffer.from(b64, 'base64');
}

/**
 * Render a track to `out` (written atomically). o: { track, wav, out, ffmpeg, batch }. Resolves
 * { frames, ms, fps, framesSha, mp4Sha }.
 */
export async function renderClip({ page, rig }, { track, wav, out, ffmpeg, batch = 30 }) {
  const t0 = performance.now();
  await page.evaluate((t) => window.__track(t), track);
  mkdirSync(dirname(resolve(out)), { recursive: true });
  const tmp = `${out}.part.mp4`;
  rmSync(tmp, { force: true });
  const ff = spawn(ffmpeg, ['-y', '-v', 'error', '-f', 'image2pipe', '-c:v', 'png', '-framerate', '30', '-i', 'pipe:0', '-i', wav,
    '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-threads', '4',
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact', '-map_metadata', '-1',
    '-movflags', '+faststart', resolve(tmp)], { stdio: ['pipe', 'ignore', 'pipe'] });
  let ffErr = '';
  ff.stderr.on('data', (b) => { ffErr = (ffErr + b).slice(-1500); });
  const ffDone = new Promise((ok, no) => ff.on('close', (c) => (c === 0 ? ok() : no(new Error(`ffmpeg ${c}: ${ffErr.trim().slice(-300)}`)))));
  ff.stdin.on('error', () => {}); // ffmpeg gone: ffDone says why
  const all = createHash('sha256');
  for (let f = 0; f < track.frames; f += batch) {
    const n = Math.min(batch, track.frames - f);
    const b64 = await page.evaluate((a, b) => window.__batch(a, b), f, n);
    for (let k = 0; k < n; k++) {
      const buf = Buffer.from(b64[k], 'base64');
      all.update(createHash('sha256').update(buf).digest('hex'));
      if (!ff.stdin.write(buf)) await new Promise((ok) => ff.stdin.once('drain', ok));
    }
  }
  ff.stdin.end();
  await ffDone;
  renameSync(tmp, out);
  const ms = performance.now() - t0;
  return { frames: track.frames, ms: Math.round(ms), fps: +(track.frames / (ms / 1000)).toFixed(1), framesSha: all.digest('hex'),
    mp4Sha: createHash('sha256').update(readFileSync(out)).digest('hex'), renderer: RENDERER_VERSION };
}

/** Write bytes atomically. */
export function writeAtomic(file, bytes) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, bytes);
  renameSync(`${file}.tmp`, file);
}
