#!/usr/bin/env node
// render-direct.mjs · the direct renderer (PLAN §2.4 item 5; spikes K1 and K6): no HyperFrames. The pinned
// puppeteer-core drives the pinned chrome-headless-shell against the generated page served on 127.0.0.1; each draw
// key is drawn once (FLPT.drawKey: on twos a pair of frames is one picture) and captured as a PNG, twins are
// hard-linked, ffmpeg encodes. The whole process tree runs inside FLPT's sandbox: this script re-executes itself under
// sandbox-exec, writing only its work folder and the output's folder. Also the engine of framehash's in-page check and
// of stills.
//
//   node render-direct.mjs <scene-dir> --out <file.mp4 | png-dir> [--duration s] [--workers 4] [--format mp4|png-sequence]
//        [--at t,t,...] (stills: mid-frame times, PNGs into --out)  [--stamp] [--gpu off|on] [--audio file.wav] [--json]
// Programmatic: import { renderDirect } from './render-direct.mjs'   (modes: render, stills, hash, meta)
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, linkSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { FPS, TMP, toolchain, renderEnv, wrapped, probe, serve, launch, parseArgs, isMain, freePort } from './lib.mjs';
import { buildPage } from './page.mjs';
import { textReport } from './lint.mjs';

const SELF = fileURLToPath(import.meta.url);
const pad = (n) => String(n).padStart(6, '0');

async function openPages(browser, url, n) {
  const pages = [];
  for (let i = 0; i < n; i++) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String((e && e.message) || e).slice(0, 300)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.evaluate(() => window.FLPT.__boot());
    pages.push({ page, errors });
  }
  return pages;
}

/** In-process work (call it inside the sandbox; renderDirect() wraps). */
export async function renderDirectInside(o) {
  const tc = toolchain(o.env || process.env);
  const work = resolve(o.work);
  const mode = o.mode || 'render';
  const pg = buildPage({ scene: o.scene, work: join(work, 'page'), duration: o.duration, hold: o.hold, host: 'direct', styles: o.styles || {}, stamp: !!o.stamp });
  const N = pg.frames;
  const { url, close } = await serve(pg.work, { port: o.port || 0 });
  const browser = await launch(tc, { userDataDir: join(work, 'profile'), gpu: o.gpu || 'off' });
  const r = { ok: true, mode, frames: N, duration: pg.duration, hold: pg.hold, style: pg.style, errors: [] };
  const t0 = Date.now();
  try {
    if (mode === 'meta') {
      const [{ page, errors }] = await openPages(browser, `${url}/index.html`, 1);
      r.meta = await page.evaluate(() => window.FLPT.meta());
      const at = (o.at && o.at.length ? o.at : r.meta.keyframes).map(Number);
      r.boxes = [];
      r.text = [];
      for (const t of at) {
        r.boxes.push({ t, boxes: await page.evaluate((tt) => window.FLPT.textBoxes(tt), t) });
        r.text.push({ t, text: await page.evaluate((tt) => window.FLPT.drawnText(tt), t) });
      }
      // the text report over every string on screen at those times (ctx.text, id:false, fillText, raw, DOM)
      r.report = textReport([...new Set(r.text.flatMap((x) => x.text.map((d) => d.str)))]);
      r.errors.push(...errors);
    } else if (mode === 'hash') {
      // the same frames in two fresh pages, in the order given and in a seeded shuffle: any difference is state
      // leaking between frames. Each frame: FNV-1a over every byte of the canvas, and an MD5 of the screen (the DOM
      // layer included).
      const frames = (o.frames || []).map(Number);
      const shuffled = [...frames];
      let s = Number(o.seed || 1234567) >>> 0;
      const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
      for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
      const hashOn = async (order) => {
        const [{ page, errors }] = await openPages(browser, `${url}/index.html`, 1);
        const cdp = await page.createCDPSession();
        const out = {};
        for (const n of order) {
          const canvasHash = await page.evaluate(async (t) => {
            await window.FLPT.seek(t);
            const d = window.FLPT.canvas.getContext('2d').getImageData(0, 0, 1920, 1080).data;
            const u = new Uint32Array(d.buffer, d.byteOffset, d.byteLength >> 2);
            let h = 2166136261 >>> 0;
            for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 16777619); }
            return (h >>> 0).toString(16).padStart(8, '0');
          }, (n + 0.5) / FPS);
          // the whole picture too (the DOM layer over the canvas), as the screen shows it
          const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 } });
          out[n] = `${canvasHash}:${createHash('md5').update(Buffer.from(shot.data, 'base64')).digest('hex').slice(0, 16)}`;
        }
        await page.close();
        r.errors.push(...errors);
        return out;
      };
      const a = await hashOn(frames), b = await hashOn(shuffled);
      r.hashes = frames.map((n) => a[n]);
      r.differ = frames.filter((n) => a[n] !== b[n]);
      r.identical = frames.length - r.differ.length;
      r.distinct = new Set(r.hashes).size;
    } else {
      // render / stills
      const outDir = mode === 'stills' || o.format === 'png-sequence' ? resolve(o.out) : join(work, 'frames');
      // emptied, not removed: under bubblewrap (Linux) a stills folder is the sandbox's own writable root, which can't go
      mkdirSync(outDir, { recursive: true });
      for (const f of readdirSync(outDir)) rmSync(join(outDir, f), { recursive: true, force: true });
      const nW = Math.max(1, Math.min(Number(o.workers) || 4, 16));
      const pages = await openPages(browser, `${url}/index.html`, nW);
      let list;
      if (mode === 'stills') list = (o.at || []).map((t, i) => ({ n: Math.min(N - 1, Math.floor(Number(t) * FPS + 1e-6)), file: join(outDir, `still-${i + 1}.png`) }));
      else {
        const keys = await pages[0].page.evaluate((n) => Array.from({ length: n }, (_, i) => window.FLPT.drawKey(i)), N);
        const dedupe = o.dedupe !== false && !o.stamp;
        list = [];
        for (let n = 0; n < N; n++) if (!dedupe || n === 0 || keys[n] !== keys[n - 1]) list.push({ n, file: join(outDir, `frame_${pad(n + 1)}.png`) });
      }
      let next = 0;
      const drawMs = [], capMs = [];
      await Promise.all(pages.map(async ({ page }) => {
        const cdp = await page.createCDPSession();
        for (;;) {
          const i = next++;
          if (i >= list.length) return;
          const { n, file } = list[i];
          // the draw, raster included: Chrome defers canvas raster, so read one pixel back before the clock stops (K6)
          const d = await page.evaluate((t) => { const a = performance.now(); return window.FLPT.seek(t).then(() => { window.FLPT.canvas.getContext('2d').getImageData(0, 0, 1, 1); return performance.now() - a; }); }, (n + 0.5) / FPS);
          drawMs.push(d);
          const a = Date.now();
          const shot = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, captureBeyondViewport: false, clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 } });
          writeFileSync(file, Buffer.from(shot.data, 'base64'));
          capMs.push(Date.now() - a);
        }
      }));
      for (const p of pages) r.errors.push(...p.errors);
      r.draws = list.length;
      const st = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? { mean: +(b.reduce((x, y) => x + y, 0) / b.length).toFixed(1), p95: +b[Math.floor(b.length * 0.95)].toFixed(1) } : null; };
      r.drawMs = st(drawMs); r.captureMs = st(capMs);
      if (mode === 'stills') r.files = list.map((x) => x.file);
      else {
        for (let n = 0; n < N; n++) {
          const f = join(outDir, `frame_${pad(n + 1)}.png`);
          if (!existsSync(f)) { let m = n; while (m > 0 && !existsSync(join(outDir, `frame_${pad(m + 1)}.png`))) m--; linkSync(join(outDir, `frame_${pad(m + 1)}.png`), f); }
        }
        r.capture_seconds = +((Date.now() - t0) / 1000).toFixed(2);
        if (o.format !== 'png-sequence') {
          const e0 = Date.now();
          const args = ['-v', 'error', '-y', '-framerate', String(FPS), '-i', join(outDir, 'frame_%06d.png')];
          if (o.audio) args.push('-i', resolve(o.audio));
          args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-frames:v', String(N), '-movflags', '+faststart');
          if (o.audio) args.push('-c:a', 'aac', '-b:a', '192k', '-af', `apad,atrim=0:${(N / FPS).toFixed(4)}`);
          args.push(resolve(o.out));
          const enc = spawnSync(tc.ffmpeg, args, { encoding: 'utf8' });
          r.encode_seconds = +((Date.now() - e0) / 1000).toFixed(2);
          if (enc.status !== 0) { r.ok = false; r.problem = String(enc.stderr).slice(0, 400); }
          rmSync(outDir, { recursive: true, force: true });
        }
      }
    }
  } finally {
    await browser.close().catch(() => {});
    await close();
  }
  r.seconds_inside = +((Date.now() - t0) / 1000).toFixed(2);
  if (r.errors.length) { r.ok = false; r.problem = r.problem || r.errors[0]; }
  return r;
}

/** Run a mode in a sandboxed child (this script with --inside). Resolves its JSON result; never throws on a failed render. */
export async function renderDirect(opts) {
  const o = { mode: 'render', workers: 4, gpu: 'off', format: 'mp4', sandboxed: true, ...opts };
  const tc = toolchain(o.env || process.env);
  if (tc.missing.some((m) => m !== 'hyperframes')) return { ok: false, problem: `toolchain incomplete: ${tc.missing.join(', ')}` };
  o.work = resolve(o.work || join(TMP, `flpt-direct-${basename(resolve(o.scene))}-${randomBytes(4).toString('hex')}`));
  mkdirSync(o.work, { recursive: true });
  const outW = o.out ? (o.mode === 'stills' || o.format === 'png-sequence' ? resolve(o.out) : dirname(resolve(o.out))) : null;
  if (outW) mkdirSync(outW, { recursive: true });
  const env = renderEnv(tc, { home: join(o.work, 'home') });
  for (const k of ['FLPT_HYPERFRAMES', 'FLPT_PUPPETEER', 'FLPT_HF_BROWSER', 'FLPT_FFMPEG', 'FLPT_FFPROBE']) if (process.env[k]) env[k] = process.env[k];
  env.FLPT_PUPPETEER = tc.puppeteer; env.FLPT_HF_BROWSER = tc.browser; env.FLPT_FFMPEG = tc.ffmpeg; env.FLPT_FFPROBE = tc.ffprobe;
  mkdirSync(env.HOME, { recursive: true });
  // the page's port, picked here so the sandbox can name it: the render reaches that loopback port and no other
  const port = await freePort();
  const inner = { ...o, env: undefined, port };
  let [cmd, argv, sandboxed] = [tc.node, [SELF, '--inside', JSON.stringify(inner)], false];
  if (o.sandboxed) [cmd, argv, sandboxed] = wrapped(tc.node, argv, [o.work, outW].filter(Boolean), { ports: [port] });
  const t0 = Date.now();
  const child = spawn(cmd, argv, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let so = '', se = '';
  child.stdout.on('data', (b) => { so += b; });
  child.stderr.on('data', (b) => { se += b; });
  const timer = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs || 30 * 60000);
  const code = await new Promise((ok) => child.on('close', ok));
  clearTimeout(timer);
  let r;
  try { r = JSON.parse(so.trim().split('\n').pop()); } catch { r = { ok: false, problem: (se || so).slice(-800) }; }
  r = { ...r, code, seconds: +((Date.now() - t0) / 1000).toFixed(2), sandboxed, renderer: 'direct' };
  if (o.out) r.out = resolve(o.out);
  if (r.ok && o.mode === 'render' && o.format !== 'png-sequence') r.probe = probe(tc, resolve(o.out));
  if (!o.keep) rmSync(o.work, { recursive: true, force: true });
  return r;
}

if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2);
  // a piped stdout is asynchronous on macOS: exit once the result is written, or one over about 64 KB is cut off
  const emit = (text, code) => process.stdout.write(`${text}\n`, () => process.exit(code));
  if (argv[0] === '--inside') {
    renderDirectInside(JSON.parse(argv[1])).then(
      (r) => emit(JSON.stringify(r), r.ok ? 0 : 1),
      (e) => emit(JSON.stringify({ ok: false, problem: String((e && e.stack) || e).slice(0, 800) }), 1));
  } else {
    const a = parseArgs(argv, ['stamp', 'no-sandbox', 'json', 'keep']);
    if (!a._[0] || !a.out) { console.error('usage: render-direct.mjs <scene-dir> --out <file.mp4|png-dir> [--duration s] [--workers n] [--format mp4|png-sequence] [--at t,..] [--stamp] [--audio wav]'); process.exit(64); }
    const r = await renderDirect({
      scene: a._[0], out: a.out, duration: a.duration ? Number(a.duration) : undefined, workers: Number(a.workers || 4), format: a.format || 'mp4',
      mode: a.at ? 'stills' : 'render', at: a.at ? String(a.at).split(',').map(Number) : undefined, stamp: !!a.stamp, gpu: a.gpu || 'off',
      audio: a.audio, sandboxed: !a['no-sandbox'], keep: !!a.keep,
    });
    emit(JSON.stringify(r, null, 2), r.ok ? 0 : 1);
  }
}
