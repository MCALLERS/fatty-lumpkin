#!/usr/bin/env node
// render-scene.mjs · render one flpt-live scene folder to a checked 1920×1080 30 fps MP4 (PLAN §2.4 items 2–3).
//
//   node render-scene.mjs <scene-dir> --out <file.mp4> [--duration s] [--hold s] [--renderer hf|direct] [--workers 4]
//        [--check-frames <dir>] [--frames-at t,t] [--audio <stem.wav>] [--format mp4|png-sequence] [--stamp]
//        [--style-dir id=<dir>] [--gpu off|auto|on] [--keep] [--no-sandbox] [--json]
//
// 1. lint: the scene folder through tools/lint.mjs (scene.js, kit-ext.js, the size limits; a problem stops here, exit 3);
// 2. the page: tools/page.mjs builds the host page into a work folder next to the output;
// 3. the render, sandboxed (writes only the work folder; the output appears only when every check has passed, so a
//    failed render never leaves a file at --out or replaces a good one):
//      hf (default, spike K1): the pinned HyperFrames 0.8.80 CLI with --strict, --experimental-fast-capture=false
//        (one capture path for every worker count), an explicit --workers 4, a private HOME and a clean env, and
//        --no-browser-gpu (--gpu off, the default): the canvas rasters on the CPU, as on Linux and in the direct
//        renderer, which then agree bit for bit; GPU raster (--gpu auto) is no faster and once gave a frame that a
//        repeat render didn't;
//      direct: render-direct.mjs (the pinned shell through puppeteer-core, each on-twos pair drawn once);
// 4. the checks render.mjs makes for a slide: ffprobe 1920×1080, 30/1, the exact frame count; the last `hold` seconds
//    still (PSNR ≥ 45 dB between the hold's start and the last frame); --check-frames writes 4 stills and the hold pair;
// 5. --audio muxes a stem built elsewhere (AAC 192k, padded or trimmed to the picture): audio never comes from the page.
// Prints one JSON summary; exit 0 only when every check passes.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { FPS, toolchain, renderEnv, wrapped, probe, psnr, parseArgs, isMain } from './lib.mjs';
import { buildPage } from './page.mjs';
import { lintFolder } from './lint.mjs';
import { renderDirect } from './render-direct.mjs';

/** What a render uses unless told otherwise. */
export const RENDER_DEFAULTS = Object.freeze({ renderer: 'hf', workers: 4, quality: 'delivery', format: 'mp4', gpu: 'off', sandboxed: true, lint: true });

/** The HyperFrames command line for a page folder (exported for the tests: the K1 settings must stay). */
export function hfArgs(tc, work, out, { quality = 'delivery', workers = 4, format = 'mp4', gpu = RENDER_DEFAULTS.gpu } = {}) {
  const a = [tc.hfCli, 'render', work, '--fps', String(FPS), '--quality', quality, '--output', out, '--workers', String(workers), '--format', format, '--strict', '--experimental-fast-capture=false'];
  if (gpu === 'off') a.push('--no-browser-gpu');
  if (gpu === 'on') a.push('--browser-gpu');
  return a;
}

function frameAt(tc, video, t, png) {
  const r = spawnSync(tc.ffmpeg, ['-v', 'error', '-y', '-ss', t.toFixed(4), '-i', video, '-frames:v', '1', png], { encoding: 'utf8' });
  if (r.status !== 0 || !existsSync(png)) throw new Error(`no frame at ${t}s: ${r.stderr}`);
  return png;
}
function lastFrame(tc, video, png) {
  const r = spawnSync(tc.ffmpeg, ['-v', 'error', '-y', '-sseof', '-0.2', '-i', video, '-update', '1', '-q:v', '1', png], { encoding: 'utf8' });
  if (r.status !== 0 || !existsSync(png)) throw new Error(`no last frame: ${r.stderr}`);
  return png;
}

export async function renderScene(opts) {
  const o = { ...RENDER_DEFAULTS, ...opts };
  if (opts.gpu == null) o.gpu = RENDER_DEFAULTS.gpu;
  const tc = toolchain(o.env || process.env);
  const scene = resolve(o.scene);
  const out = resolve(o.out);
  const steps = [];
  const step = (name, data) => { steps.push({ step: name, ...data }); };
  const res = { ok: false, scene, out, renderer: o.renderer, steps };
  // 1 · lint: scene.js, kit-ext.js and the folder's size limits
  if (o.lint) {
    const problems = lintFolder(scene);
    const errors = problems.filter((p) => p.level === 'error');
    step('lint', { ok: !errors.length, errors: errors.length, warnings: problems.length - errors.length, problems: problems.slice(0, 20).map((p) => `${p.rule}: ${p.message}`) });
    if (errors.length) { res.exit = 3; return res; }
  }
  const need = o.renderer === 'hf' ? ['hyperframes', 'chrome-headless-shell', 'ffmpeg', 'ffprobe'] : ['puppeteer-core', 'chrome-headless-shell', 'ffmpeg', 'ffprobe'];
  const missing = tc.missing.filter((m) => need.includes(m));
  if (missing.length) { step('error', { problem: `toolchain incomplete: ${missing.join(', ')}` }); return res; }

  // 2 · the page, in a work folder beside the output (the same disk, so the finished file moves into place); the
  // render writes only there, and --out is touched only when every check has passed
  const seq = o.format === 'png-sequence';
  const outDir = dirname(out);
  mkdirSync(outDir, { recursive: true });
  const work = resolve(o.work || join(outDir, `.flpt-render-${basename(out).replace(/\W+/g, '-')}-${randomBytes(3).toString('hex')}`));
  const tmpOut = join(work, seq ? 'frames' : `out${extname(out) || '.mp4'}`);
  const finish = (ok) => {
    res.ok = ok;
    if (ok) {
      if (seq) { rmSync(out, { recursive: true, force: true }); renameSync(tmpOut, out); } else renameSync(tmpOut, out);
      if (existsSync(out) && statSync(out).isFile()) res.size_mb = +(statSync(out).size / 1e6).toFixed(2);
    }
    if (o.keep) res.work = work; else rmSync(work, { recursive: true, force: true });
    return res;
  };
  let pg;
  try {
    pg = buildPage({ scene, work: join(work, 'page'), duration: o.duration, hold: o.hold, host: o.renderer === 'hf' ? 'hf' : 'direct', styles: o.styles || {}, stamp: !!o.stamp });
  } catch (e) { step('error', { problem: `page: ${e.message}` }); return finish(false); }
  step('page', { ok: true, duration: pg.duration, frames: pg.frames, hold: pg.hold, style: pg.style, kitExt: pg.kitExt, fonts: pg.fonts.length, pictures: pg.pictures.length });
  res.duration = pg.duration; res.frames = pg.frames; res.hold = pg.hold;
  if (seq) mkdirSync(tmpOut, { recursive: true });

  // 3 · the render
  const t0 = Date.now();
  if (o.renderer === 'hf') {
    const home = join(work, 'home');
    mkdirSync(home, { recursive: true });
    const args = hfArgs(tc, pg.work, tmpOut, { quality: o.quality, workers: o.workers, format: o.format, gpu: o.gpu });
    const [cmd, argv, sandboxed] = o.sandboxed ? wrapped(tc.node, args, [work]) : [tc.node, args, false];
    const child = spawn(cmd, argv, { cwd: pg.work, env: renderEnv(tc, { home, fontCache: join(work, 'font-cache') }), stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (b) => { log += b; if (o.verbose) process.stderr.write(b); });
    child.stderr.on('data', (b) => { log += b; if (o.verbose) process.stderr.write(b); });
    const timer = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs || 30 * 60000);
    const code = await new Promise((ok) => child.on('close', ok));
    clearTimeout(timer);
    writeFileSync(join(work, 'render.log'), log);
    const cap = log.match(/(\w+) capture · ([^·\n]+?) ·/);
    // a scene error HyperFrames survives (a listener that tripped the guard, an uncaught page error) still fails
    const tripped = log.split('\n').filter((l) => /flpt-guard|\[flpt-live\]|\[Browser:PAGEERROR\]/.test(l)).slice(0, 5);
    const ok = code === 0 && !tripped.length;
    step('render', { ok, code, seconds: +((Date.now() - t0) / 1000).toFixed(2), sandboxed, workers: o.workers, capture: cap ? cap[1] : null, ...(ok ? {} : { log: tripped.length ? tripped : log.split('\n').filter(Boolean).slice(-8) }) });
    res.sandboxed = sandboxed;
    if (!ok) return finish(false);
  } else {
    const r = await renderDirect({ scene, out: tmpOut, duration: pg.duration, hold: o.hold, workers: o.workers, format: o.format, styles: o.styles, stamp: o.stamp, sandboxed: o.sandboxed, gpu: o.gpu === 'on' ? 'on' : 'off', work: join(work, 'direct') });
    step('render', { ok: !!r.ok, seconds: r.seconds, sandboxed: r.sandboxed, workers: o.workers, draws: r.draws, drawMs: r.drawMs, captureMs: r.captureMs, ...(r.ok ? {} : { problem: r.problem }) });
    res.sandboxed = r.sandboxed;
    if (!r.ok) return finish(false);
  }
  res.render_seconds = +((Date.now() - t0) / 1000).toFixed(2);

  // 4 · the checks (on the work copy)
  const issues = [];
  const stem = basename(out).replace(/\.mp4$/i, '');
  if (seq) {
    const pngs = existsSync(tmpOut) ? readdirSync(tmpOut).filter((f) => f.endsWith('.png')) : [];
    if (pngs.length !== pg.frames) issues.push(`${pngs.length} PNGs, want ${pg.frames}`);
    step('probe', { ok: !issues.length, frames: pngs.length });
  } else {
    const p = probe(tc, tmpOut);
    if (p.width !== 1920 || p.height !== 1080) issues.push(`size ${p.width}x${p.height}`);
    if (p.fps !== '30/1') issues.push(`fps ${p.fps}`);
    if (p.frames !== pg.frames) issues.push(`${p.frames} frames, want ${pg.frames}`);
    step('probe', { ok: !issues.length, ...p });
    res.probe = p;
    const holdCheck = pg.hold > 0 && !o.stamp;   // a stamped (conformance) render changes every frame by design
    if (holdCheck || o.checkFrames) {
      const fdir = resolve(o.checkFrames || join(work, 'check-frames'));
      mkdirSync(fdir, { recursive: true });
      const last = lastFrame(tc, tmpOut, join(fdir, `${stem}_last.png`));
      if (holdCheck) {
        const hs = frameAt(tc, tmpOut, Math.max(0, pg.duration - pg.hold + 0.1), join(fdir, `${stem}_holdstart.png`));
        const db = psnr(tc, hs, last);
        res.hold_psnr_db = Number.isFinite(db) ? +db.toFixed(1) : 'inf';
        if (Number.isFinite(db) && db < 45) issues.push(`the last ${pg.hold}s isn't still (${db.toFixed(1)} dB)`);
        step('hold', { ok: !(Number.isFinite(db) && db < 45), psnr_db: res.hold_psnr_db, seconds: pg.hold });
      }
      if (o.checkFrames) {
        const times = o.framesAt ? o.framesAt.map(Number) : [0.2, 0.45, 0.7].map((f) => +(pg.duration * f).toFixed(2));
        res.check_frames = [...times.map((t) => frameAt(tc, tmpOut, Math.min(t, pg.duration - 1 / FPS), join(fdir, `${stem}_t${t.toFixed(2)}.png`))), last];
      }
    }
  }

  // 5 · the stem
  if (o.audio && !seq && !issues.length) {
    const muxed = join(work, `muxed${extname(out) || '.mp4'}`);
    const r = spawnSync(tc.ffmpeg, ['-v', 'error', '-y', '-i', tmpOut, '-i', resolve(o.audio), '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-af', `apad,atrim=0:${(pg.frames / FPS).toFixed(4)}`, '-movflags', '+faststart', muxed], { encoding: 'utf8' });
    if (r.status !== 0) issues.push(`audio mux: ${String(r.stderr).slice(0, 200)}`);
    else { renameSync(muxed, tmpOut); const p = probe(tc, tmpOut); step('audio', { ok: !!p.audio && p.frames === pg.frames, audio: p.audio }); if (!p.audio || p.frames !== pg.frames) issues.push('audio mux changed the picture'); }
  }

  res.issues = issues;
  return finish(!issues.length);
}

if (isMain(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2), ['stamp', 'no-sandbox', 'json', 'keep', 'no-lint', 'verbose']);
  if (!a._[0] || !a.out) { console.error('usage: render-scene.mjs <scene-dir> --out <file.mp4> [--duration s] [--renderer hf|direct] [--workers 4] [--check-frames dir] [--audio wav]'); process.exit(64); }
  const styles = {};
  for (const s of [].concat(a['style-dir'] || [])) { const [id, dir] = String(s).split('='); if (id && dir) styles[id] = resolve(dir); }
  const r = await renderScene({
    scene: a._[0], out: a.out, duration: a.duration ? Number(a.duration) : undefined, hold: a.hold != null ? Number(a.hold) : undefined,
    renderer: a.renderer || 'hf', workers: Number(a.workers || 4), checkFrames: a['check-frames'], framesAt: a['frames-at'] ? String(a['frames-at']).split(',') : null,
    audio: a.audio, format: a.format || 'mp4', stamp: !!a.stamp, styles, keep: !!a.keep, sandboxed: !a['no-sandbox'], lint: !a['no-lint'], gpu: a.gpu || RENDER_DEFAULTS.gpu, verbose: !!a.verbose,
  });
  // exit once the result is written: a piped stdout is asynchronous on macOS
  process.stdout.write(`${JSON.stringify(r, null, 2)}\n`, () => process.exit(r.ok ? 0 : r.exit || 1));
}
