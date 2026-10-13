'use strict';
// The toolchain: ffmpeg + ffprobe, Python (with numpy and requests), Chrome for rendering slides, and Node for
// live-slide animation (Phase 2), plus yt-dlp for Clippy (optional, installed only on request). Two modes:
//   pinned  the app downloads exact versions listed in toolchain-manifest.json into its own folder, verifying each
//           file's SHA-256 before use. No Homebrew, no admin rights, the same versions on every Mac.
//   system  use tools already on this Mac (Homebrew, /Applications/Google Chrome.app). The fallback, and what a
//           developer machine usually has.
// Either way, Python packages go into the app's own virtual environment, never the system Python.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const SYSTEM_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
const CHROME_APPS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

const TOOLS = [
  { id: 'ffmpeg', label: 'ffmpeg and ffprobe', why: 'renders and mixes every video', required: true },
  { id: 'python', label: 'Python 3 with numpy and requests', why: 'runs the video pipeline', required: true },
  { id: 'chrome', label: 'Chrome', why: 'turns slides into pictures', required: true },
  { id: 'node', label: 'Node.js', why: 'live-slide animation (later phases)', required: false },
];

function run(file, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: opts.timeout || 20000, env: opts.env || process.env, maxBuffer: 4 << 20 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: String(stdout || ''), err: String(stderr || '') });
    });
  });
}

const exists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const firstExisting = (cands) => cands.find((c) => c && exists(c)) || null;

function readManifest(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { tools: {} }; }
}

/** Where each binary would be in the pinned layout (see the manifest's "bin" entries). */
function pinnedPaths(dir, manifest) {
  const t = manifest.tools || {};
  const at = (id, key) => (t[id] && t[id].bin && t[id].bin[key] ? path.join(dir, id, t[id].bin[key]) : null);
  return {
    ffmpeg: at('ffmpeg', 'ffmpeg'), ffprobe: at('ffmpeg', 'ffprobe'),
    pythonBase: at('python', 'python'), chrome: at('chrome', 'chrome'), node: at('node', 'node'),
    ytdlp: at('yt-dlp', 'yt-dlp'),
  };
}

// ── Clippy's yt-dlp (optional: only Clippy uses it, so it's not in TOOLS and Setup never waits for it) ──────────

const YTDLP_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local', 'bin')];
const runnable = (p) => { try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; } };

/**
 * Find yt-dlp for Clippy, in this order: the one chosen in settings (ytDlpPath), FLPT's pinned copy, then PATH and
 * the usual places (/opt/homebrew/bin, /usr/local/bin, ~/.local/bin). Returns { path, source } or { path: null }.
 * chosenMissing says the chosen one has gone (moved or deleted), so Clippy can say so.
 */
function findYtDlp({ dir, manifestFile, setting = '', pathEnv = process.env.PATH || '' }) {
  if (setting && runnable(setting)) return { path: setting, source: 'chosen' };
  const pinned = pinnedPaths(dir, readManifest(manifestFile)).ytdlp;
  const found = (p, source) => ({ path: p, source, chosenMissing: Boolean(setting) });
  if (pinned && runnable(pinned)) return found(pinned, 'pinned');
  const dirs = [...new Set([...String(pathEnv).split(':').filter((d) => path.isAbsolute(d)), ...YTDLP_DIRS])];
  for (const d of dirs) if (runnable(path.join(d, 'yt-dlp'))) return found(path.join(d, 'yt-dlp'), 'system');
  return { path: null, source: null, chosenMissing: Boolean(setting) };
}

/** yt-dlp's version ("2026.08.19"), or null. Generous timeout: a first run from a synced folder can be slow. */
async function ytDlpVersion(file, timeout = 45000) {
  const r = await run(file, ['--version'], { timeout });
  const m = r.out.trim().match(/^(\d{4}\.\d{2}\.\d{2}(?:\.\d+)?)\b/);
  return r.code === 0 && m ? m[1] : null;
}

function venvPython(dir) { return path.join(dir, 'venv', 'bin', 'python'); }

async function version(file, args, re) {
  const r = await run(file, args);
  const m = (r.out + r.err).match(re);
  return m ? m[1] : null;
}

async function detect({ dir, manifestFile, mode }) {
  const manifest = readManifest(manifestFile);
  const pin = pinnedPaths(dir, manifest);
  const sys = (name) => firstExisting(SYSTEM_DIRS.map((d) => path.join(d, name)));
  const pick = (pinned, system) => (mode === 'pinned' ? (exists(pinned || '') ? pinned : null) : system);

  const ffmpeg = pick(pin.ffmpeg, sys('ffmpeg'));
  const ffprobe = pick(pin.ffprobe, sys('ffprobe'));
  const pythonBase = pick(pin.pythonBase, sys('python3'));
  const chrome = pick(pin.chrome, firstExisting(CHROME_APPS));
  const node = pick(pin.node, sys('node'));
  const venv = venvPython(dir);

  const result = {};
  result.ffmpeg = ffmpeg && ffprobe
    ? { path: ffmpeg, ffprobe, version: await version(ffmpeg, ['-version'], /ffmpeg version (\S+)/) }
    : { path: null, problem: ffmpeg ? 'ffprobe is missing' : 'not found' };
  if (pythonBase) {
    const v = await version(pythonBase, ['--version'], /Python (\S+)/);
    const pkgs = exists(venv) ? await run(venv, ['-c', 'import numpy, requests; print(numpy.__version__, requests.__version__)']) : { code: 1, out: '' };
    result.python = { path: pythonBase, venv: exists(venv) ? venv : null, version: v,
      packages: pkgs.code === 0 ? pkgs.out.trim() : null,
      problem: pkgs.code === 0 ? null : 'the app\'s Python environment isn\'t set up yet' };
  } else {
    result.python = { path: null, problem: 'not found' };
  }
  result.chrome = chrome ? { path: chrome, version: await version(chrome, ['--version'], /(\d+\.\d+\.\d+\.\d+)/) } : { path: null, problem: 'not found' };
  result.node = node ? { path: node, version: await version(node, ['--version'], /v(\S+)/) } : { path: null, problem: 'not found' };

  const tools = TOOLS.map((t) => {
    const r = result[t.id];
    const ok = Boolean(r.path) && !r.problem;
    return { ...t, ...r, ok, source: r.path ? (r.path.startsWith(dir) ? 'pinned' : 'system') : 'missing' };
  });
  const pinnable = Object.values(manifest.tools || {}).every((e) => e && Array.isArray(e.downloads) && e.downloads.length && e.downloads.every((d) => d.url && d.sha256));
  return { mode, dir, tools, ready: tools.every((t) => !t.required || t.ok), pinnable, manifestVersion: manifest.version || null };
}

/** PATH and variables for any pipeline process: our tools first, then the usual system places. */
function processEnv(det, base = {}) {
  const t = Object.fromEntries(det.tools.map((x) => [x.id, x]));
  const dirs = [];
  if (t.ffmpeg && t.ffmpeg.path) dirs.push(path.dirname(t.ffmpeg.path));
  if (t.python && t.python.venv) dirs.push(path.dirname(t.python.venv));
  if (t.node && t.node.path) dirs.push(path.dirname(t.node.path));
  const PATH = [...new Set([...dirs, ...SYSTEM_DIRS])].join(':');
  return { ...base, PATH, FLPT_CHROME: (t.chrome && t.chrome.path) || '', PYTHONDONTWRITEBYTECODE: '1' };
}

// ── pinned install ─────────────────────────────────────────────────────────────────────────────────────────────

async function download(url, dest, sha256, onBytes, fetchImpl = globalThis.fetch) {
  if (!/^https:\/\//.test(url) && !/^http:\/\/127\.0\.0\.1[:/]/.test(url)) throw new Error(`refusing a non-HTTPS download: ${url}`);
  const res = await fetchImpl(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`download failed (HTTP ${res.status}) for ${url}`);
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(dest);
  let n = 0;
  for await (const chunk of res.body) {
    hash.update(chunk);
    n += chunk.length;
    if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    if (onBytes) onBytes(n);
  }
  await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
  const got = hash.digest('hex');
  if (got !== String(sha256).toLowerCase()) {
    fs.rmSync(dest, { force: true });
    throw new Error(`checksum mismatch for ${path.basename(url)}: the download was discarded`);
  }
  return { bytes: n, sha256: got };
}

async function extract(archive, into) {
  fs.mkdirSync(into, { recursive: true });
  const r = archive.endsWith('.zip') ? await run('/usr/bin/ditto', ['-x', '-k', archive, into], { timeout: 600000 })
    : await run('/usr/bin/tar', ['-xf', archive, '-C', into], { timeout: 600000 });
  if (r.code !== 0) throw new Error(`couldn't unpack ${path.basename(archive)}: ${r.err.slice(0, 200)}`);
}

/**
 * Install every pinned tool from the manifest, then create the app's Python environment.
 * Refuses any entry without a SHA-256: nothing unverified ever runs. Optional tools (yt-dlp) install only when
 * named in `only`. A download with "saveAs" is a single program, saved under that name instead of unpacked.
 */
async function install({ dir, manifestFile, onProgress = () => {}, fetchImpl, only }) {
  const manifest = readManifest(manifestFile);
  const entries = Object.entries(manifest.tools || {}).filter(([id, e]) => (only ? only.includes(id) : !(e && e.optional)));
  const dls = (e) => (Array.isArray(e.downloads) ? e.downloads : []);
  for (const [id, e] of entries) {
    if (!dls(e).length || dls(e).some((d) => !d.url || !d.sha256)) throw new Error(`${id} isn't pinned yet (no URL or checksum in the manifest)`);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flpt-tools-'));
  try {
    for (const [id, e] of entries) {
      const target = path.join(dir, id);
      fs.rmSync(target, { recursive: true, force: true });
      for (const d of dls(e)) {
        const file = path.join(tmp, `${id}-${path.basename(new URL(d.url).pathname)}`);
        onProgress({ id, phase: 'download', label: e.label || id, bytes: 0, total: d.size || null });
        await download(d.url, file, d.sha256, (bytes) => onProgress({ id, phase: 'download', bytes, total: d.size || null }), fetchImpl);
        if (d.saveAs) {
          if (path.basename(d.saveAs) !== d.saveAs) throw new Error(`${id}: saveAs must be a plain file name`);
          fs.mkdirSync(target, { recursive: true });
          fs.copyFileSync(file, path.join(target, d.saveAs));
        } else {
          onProgress({ id, phase: 'unpack' });
          await extract(file, target);
        }
      }
      for (const b of Object.values(e.bin || {})) {
        const p = path.join(target, b);
        if (!exists(p)) throw new Error(`${id}: expected ${b} after unpacking`);
        fs.chmodSync(p, 0o755);
        await run('/usr/bin/xattr', ['-d', 'com.apple.quarantine', p]);
      }
      onProgress({ id, phase: 'done' });
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  fs.writeFileSync(path.join(dir, 'installed.json'), JSON.stringify({ version: manifest.version, at: new Date().toISOString() }, null, 2));
}

/** The app's own Python environment: venv + pinned packages. Works in both modes. */
async function setupPython({ dir, pythonBase, packages = ['numpy', 'requests'], onProgress = () => {} }) {
  const venvDir = path.join(dir, 'venv');
  // A venv is tied to the Python it was made from. If that Python moved or changed (a toolchain update, a moved
  // folder), the venv is stale: rebuild it rather than fail.
  let healthy = exists(venvPython(dir)) && (await run(venvPython(dir), ['-c', 'import sys'])).code === 0;
  if (healthy) {
    try {
      const home = (fs.readFileSync(path.join(venvDir, 'pyvenv.cfg'), 'utf8').match(/^home\s*=\s*(.+)$/m) || [])[1];
      if (home && fs.realpathSync(home.trim()) !== fs.realpathSync(path.dirname(pythonBase))) healthy = false;
    } catch { healthy = false; }
  }
  if (!healthy) {
    onProgress({ id: 'python', phase: 'venv' });
    fs.rmSync(venvDir, { recursive: true, force: true });
    const r = await run(pythonBase, ['-m', 'venv', venvDir], { timeout: 120000 });
    if (r.code !== 0) throw new Error(`couldn't create the Python environment: ${r.err.slice(0, 200)}`);
  }
  if (!packages.length) return venvPython(dir);
  onProgress({ id: 'python', phase: 'packages', packages });
  const r = await run(venvPython(dir), ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', '--only-binary=:all:', ...packages], { timeout: 900000 });
  if (r.code !== 0) throw new Error(`couldn't install ${packages.join(', ')}: ${(r.err || r.out).slice(-300)}`);
  onProgress({ id: 'python', phase: 'done' });
  return venvPython(dir);
}

module.exports = { detect, install, setupPython, processEnv, download, extract, TOOLS, readManifest, venvPython, findYtDlp, ytDlpVersion, YTDLP_DIRS };
