// lib.mjs · shared bits for flpt-live's tools: where the pinned toolchain is, the clean environment every render
// gets, FLPT's sandbox, a loopback file server, ffprobe and PSNR. No dependency beyond Node and the pinned toolchain.
//
// The toolchain comes from the app's environment when it runs us (FLPT_HYPERFRAMES, HYPERFRAMES_BROWSER_PATH,
// HYPERFRAMES_FFMPEG_PATH, HYPERFRAMES_FFPROBE_PATH, as toolchain.processEnv sets them), else from FLPT's QA cache
// (~/Library/Caches/flpt-qa/toolchain/hyperframes), else ffmpeg from the usual system places.
import { createServer } from 'node:http';
import { execFileSync, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const RUNTIME = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ENGINE = resolve(RUNTIME, '..', '..');
export const W = 1920, H = 1080, FPS = 30;
export const require = createRequire(import.meta.url);

const SYSTEM_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
const which = (name) => SYSTEM_DIRS.map((d) => join(d, name)).find((p) => existsSync(p)) || null;
const QA_HF = join(homedir(), 'Library/Caches/flpt-qa/toolchain/hyperframes');

/** The pinned toolchain: { hfCli, puppeteer, browser, ffmpeg, ffprobe, node, missing[] }. */
export function toolchain(env = process.env) {
  const qaCli = join(QA_HF, 'app/node_modules/hyperframes/bin/hyperframes.mjs');
  const hfCli = env.FLPT_HYPERFRAMES || (existsSync(qaCli) ? qaCli : null);
  const nodeModules = hfCli ? resolve(dirname(hfCli), '..', '..') : null;
  const qaBrowser = join(QA_HF, 'browser/chrome-headless-shell-mac-arm64/chrome-headless-shell');
  const puppeteer = env.FLPT_PUPPETEER || (nodeModules && existsSync(join(nodeModules, 'puppeteer-core')) ? join(nodeModules, 'puppeteer-core') : null);
  const browser = env.FLPT_HF_BROWSER || env.HYPERFRAMES_BROWSER_PATH || (existsSync(qaBrowser) ? qaBrowser : null);
  const ffmpeg = env.FLPT_FFMPEG || env.HYPERFRAMES_FFMPEG_PATH || which('ffmpeg');
  const ffprobe = env.FLPT_FFPROBE || env.HYPERFRAMES_FFPROBE_PATH || which('ffprobe');
  const tc = { hfCli, puppeteer, browser, ffmpeg, ffprobe, node: env.FLPT_NODE || process.execPath };
  tc.missing = Object.entries({ hyperframes: hfCli, 'puppeteer-core': puppeteer, 'chrome-headless-shell': browser, ffmpeg, ffprobe })
    .filter(([, p]) => !p || !existsSync(p)).map(([k]) => k);
  return tc;
}

/** The real per-user temp folder (the sandbox allows writes there; /tmp is closed). */
export const TMP = (() => { try { return realpathSync(tmpdir()); } catch { return tmpdir(); } })();

/**
 * The environment for a render, built from nothing (never inherited, so no key of any kind reaches HyperFrames or
 * Chrome: `hyperframes snapshot` calls Gemini whenever GEMINI_API_KEY is set). HyperFrames gets a private HOME:
 * its ~/.hyperframes/config.json state changes capture behaviour (K1).
 */
export function renderEnv(tc, { home, fontCache, extra = {} } = {}) {
  const dirs = [tc.ffmpeg && dirname(tc.ffmpeg), dirname(tc.node), ...SYSTEM_DIRS].filter(Boolean);
  return {
    PATH: [...new Set(dirs)].join(':'),
    HOME: home || join(TMP, 'flpt-live-home'), USER: process.env.USER || 'flpt', LANG: 'en_US.UTF-8', TMPDIR: TMP,
    HYPERFRAMES_BROWSER_PATH: tc.browser || '',
    HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1', HYPERFRAMES_SKIP_SKILLS: '1',
    HYPERFRAMES_NO_UPDATE_CHECK: '1', HYPERFRAMES_NO_AUTO_INSTALL: '1',
    ...(fontCache ? { HYPERFRAMES_FONT_CACHE_DIR: fontCache } : {}),
    ...(tc.ffmpeg ? { HYPERFRAMES_FFMPEG_PATH: tc.ffmpeg } : {}),
    ...(tc.ffprobe ? { HYPERFRAMES_FFPROBE_PATH: tc.ffprobe } : {}),
    ...extra,
  };
}

/** FLPT's sandbox (Seatbelt): the plugin's copy in engine/tools/lib, else the app's. null where there's none. */
export function sandbox() {
  for (const p of [join(ENGINE, 'tools/lib/src/main/sandbox.js'), join(ENGINE, '..', 'app/src/main/sandbox.js')]) {
    if (existsSync(p)) { const s = require(p); return s.available() ? s : null; }
  }
  return null;
}

/**
 * [cmd, args, sandboxed] for a command that may write only `writable` (sandboxed when the sandbox exists). `ports`: the
 * only loopback ports it may reach (Seatbelt: localhost:<port>, never localhost:*), when the caller knows them.
 */
export function wrapped(cmd, args, writable, { allowUnsandboxed = true, ports = null } = {}) {
  const sb = sandbox();
  if (sb) { const [c, a] = sb.wrap(cmd, args, { writable, ...(ports ? { ports } : {}) }); return [c, a, true]; }
  if (!allowUnsandboxed) throw new Error('no sandbox on this machine');
  return [cmd, args, false];
}

export function probe(tc, file) {
  const j = JSON.parse(execFileSync(tc.ffprobe, ['-v', 'error', '-count_frames', '-print_format', 'json', '-show_streams', '-show_format', file], { encoding: 'utf8', maxBuffer: 16 << 20 }));
  const v = (j.streams || []).find((s) => s.codec_type === 'video') || {};
  const a = (j.streams || []).find((s) => s.codec_type === 'audio') || null;
  return {
    width: v.width, height: v.height, fps: v.r_frame_rate, frames: Number(v.nb_read_frames || v.nb_frames || 0), codec: v.codec_name, pix_fmt: v.pix_fmt,
    seconds: Number(j.format && j.format.duration), bytes: Number(j.format && j.format.size), audio: a ? { codec: a.codec_name, rate: Number(a.sample_rate), channels: a.channels } : null,
  };
}

/** The keyframes of a video, as frame numbers from its first shown frame (from the packets: nothing is decoded). */
export function keyframes(tc, file) {
  const j = JSON.parse(execFileSync(tc.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=start_time:packet=pts_time,flags', '-of', 'json', file], { encoding: 'utf8', maxBuffer: 64 << 20 }));
  const start = Number(((j.streams || [])[0] || {}).start_time) || 0; // a file without an edit list starts late (B-frames)
  return (j.packets || []).filter((p) => p.flags && p.flags.includes('K') && p.pts_time != null && p.pts_time !== 'N/A')
    .map((p) => Math.round((Number(p.pts_time) - start) * FPS)).sort((x, y) => x - y);
}

/** Mean PSNR (dB) between two pictures or videos of the same size; Infinity when identical. blur: a Gaussian σ on both first. */
export function psnr(tc, a, b, { aArgs = [], bArgs = [], blur = 0 } = {}) {
  const f = blur ? `format=rgb24,gblur=sigma=${blur}` : 'format=rgb24';
  const r = spawnSync(tc.ffmpeg, ['-v', 'info', ...aArgs, '-i', a, ...bArgs, '-i', b, '-lavfi', `[0:v]${f}[a];[1:v]${f}[b];[a][b]psnr`, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const m = (r.stderr || '').match(/average:(inf|[\d.]+)/);
  return m ? (m[1] === 'inf' ? Infinity : parseFloat(m[1])) : NaN;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.txt': 'text/plain' };
/** Serve one folder on 127.0.0.1 (an ephemeral port): GET only, files only, nothing outside it. */
export function serve(root, { headers = {}, port = 0 } = {}) {
  const base = realpathSync(resolve(root));
  const srv = createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    let p;
    try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(base, p));
    if (!file.startsWith(base + sep) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store', ...headers });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => srv.listen(port, '127.0.0.1', () => ok({ srv, port: srv.address().port, url: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => srv.close(r)) })));
}

/** A free loopback port, picked before a sandboxed run so its profile can name it (the run then listens on it). */
export function freePort() {
  return new Promise((ok, fail) => { const s = createServer(); s.on('error', fail); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });
}

/** Chrome flags for the direct renderer and the in-page checks (K1: SwiftShader, no partial raster, a dead proxy). */
export function chromeArgs({ gpu = 'off' } = {}) {
  return [
    '--no-sandbox', '--disable-setuid-sandbox', '--no-zygote', '--no-first-run', '--hide-scrollbars', '--mute-audio',
    '--force-device-scale-factor=1', '--window-size=1920,1080', '--font-render-hinting=none', '--force-color-profile=srgb',
    '--disable-lcd-text', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-extensions', '--disable-component-update', '--disable-sync', '--disable-default-apps', '--no-pings', '--disable-breakpad',
    '--disable-background-networking', '--disable-features=Translate,BackForwardCache,MediaRouter,OptimizationHints', '--disable-domain-reliability',
    '--blink-settings=dnsPrefetchingEnabled=false',
    '--proxy-server=127.0.0.1:9', '--disable-partial-raster',
    ...(gpu === 'on' ? ['--use-angle=metal', '--enable-gpu-rasterization'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-compositing']),
  ];
}

/** Launch the pinned chrome-headless-shell through the pinned puppeteer-core. */
export async function launch(tc, { userDataDir, gpu = 'off', extra = [] } = {}) {
  if (!tc.puppeteer || !tc.browser) throw new Error(`toolchain incomplete: ${tc.missing.join(', ')}`);
  const puppeteer = require(tc.puppeteer);
  if (userDataDir) mkdirSync(userDataDir, { recursive: true });
  return puppeteer.launch({
    executablePath: tc.browser, headless: 'shell', args: [...chromeArgs({ gpu }), ...extra], userDataDir,
    defaultViewport: { width: W, height: H, deviceScaleFactor: 1 }, protocolTimeout: 600000,
    pipe: true, // DevTools over a pipe: no loopback port of Chrome's own for the sandbox to allow
  });
}

export function parseArgs(argv, flags = []) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i];
    if (!s.startsWith('--')) { a._.push(s); continue; }
    const k = s.slice(2);
    if (k.includes('=')) { const [kk, v] = k.split(/=(.*)/s); a[kk] = v; } else if (flags.includes(k)) a[k] = true; else a[k] = argv[++i];
  }
  return a;
}

export const isMain = (url) => process.argv[1] && resolve(process.argv[1]) === fileURLToPath(url);
