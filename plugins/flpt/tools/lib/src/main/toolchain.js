'use strict';
// The toolchain: ffmpeg + ffprobe, Python (with numpy and requests), Chrome for rendering slides, Node and HyperFrames
// for moving slides, plus yt-dlp for Clippy (optional, installed only on request) and Rhubarb Lip Sync for the cartoon
// presenter (optional; it ships inside engine/ and is verified on first use, never downloaded). Two modes:
//   pinned  the app downloads exact versions listed in toolchain-manifest.json into its own folder, verifying each
//           file's SHA-256 before use. No Homebrew, no admin rights, the same versions on every Mac.
//   system  use tools already on this Mac (Homebrew, /Applications/Google Chrome.app). The fallback, and what a
//           developer machine usually has.
// Either way, Python packages go into the app's own virtual environment, never the system Python (from
// python/requirements.lock: every wheel by its SHA-256), and HyperFrames goes into the app's own folder (npm ci from a
// pinned lockfile), never a global install.
//
// The manifest pins each tool per platform ("platforms": darwin-arm64 for the Mac app and the plugin, linux-x64 for the
// web image). Each pinned install leaves a stamp in its folder (<tool>/.flpt-pin.json, the fingerprint of the pins it was
// verified against), so another surface can tell whether a toolchain folder holds exactly its own pins: the plugin
// reuses the Mac app's when it does, else installs the same pins into its own folder (resolvePinned, W4-03).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const cuesnap = require('./cuesnap'); // W4-11: FLPT's own whisper for the cue-word snap, when Setup installed it

const SYSTEM_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
const PLATFORMS = ['darwin-arm64', 'linux-x64'];
const PLATFORM_OF = { 'darwin/arm64': 'darwin-arm64', 'linux/x64': 'linux-x64' };
const LOCK_FILE = path.join(__dirname, 'python', 'requirements.lock'); // FLPT's Python packages, hashed
const LOCK_DIR = path.join(__dirname, 'hyperframes'); // HyperFrames' npm lockfile (npm-package.json, npm-lock.json)
const PIN_FILE = '.flpt-pin.json';
const VENV_LOCK = 'flpt-lock.json'; // in the venv: the requirements.lock it was installed from
const CHROME_APPS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

const TOOLS = [
  { id: 'ffmpeg', label: 'ffmpeg and ffprobe', why: 'renders and mixes every video', required: true },
  { id: 'python', label: 'Python 3 with numpy and requests', why: 'runs the video pipeline', required: true },
  { id: 'chrome', label: 'Chrome', why: 'turns slides into pictures', required: true },
  { id: 'node', label: 'Node.js', why: 'moving slides', required: false },
  { id: 'hyperframes', label: 'HyperFrames', why: 'moving slides', required: false },
  { id: 'rhubarb', label: 'Rhubarb Lip Sync', why: 'the cartoon presenter\'s lip sync', required: false },
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

/** This machine's platform as the manifest names it: darwin-arm64, linux-x64 (anything else: "<platform>-<arch>"). */
function platformKey(platform = process.platform, arch = process.arch) {
  return PLATFORM_OF[`${platform}/${arch}`] || `${platform}-${arch}`;
}

/**
 * One tool's manifest entry for one platform: that platform's pins (downloads, bin, a version of its own) over the
 * tool's shared fields (label, version, optional, source). A tool pinned per platform but not for this one is null; an
 * entry from before schema 2 (no "platforms") and one that ships inside engine/ are the same everywhere.
 */
function entryFor(manifest, id, platform = platformKey()) {
  const e = ((manifest && manifest.tools) || {})[id];
  if (!e || typeof e !== 'object') return null;
  if (!e.platforms || typeof e.platforms !== 'object') return e;
  const p = e.platforms[platform];
  if (!p || typeof p !== 'object') return null;
  const { platforms, ...shared } = e;
  return { ...shared, ...p };
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const fileHash = (file) => { try { return sha256(fs.readFileSync(file)); } catch { return null; } };
/** HyperFrames' npm lockfile's hash (part of its pin: npm ci installs exactly what it names), or null. */
const hfLockHash = (lockDir = LOCK_DIR) => fileHash(path.join(lockDir, 'npm-lock.json'));

/**
 * The fingerprint of one tool's pins on one platform: its version, every download's URL and SHA-256, and the bin map
 * (labels and notes don't count). `extra` joins it (HyperFrames' npm lockfile). Null when the tool isn't pinned there.
 */
function pinOf(manifest, id, platform = platformKey(), extra = null) {
  const e = entryFor(manifest, id, platform);
  const dls = e && Array.isArray(e.downloads) ? e.downloads : [];
  if (!dls.length || dls.some((d) => !d || !d.url || !/^[0-9a-f]{64}$/i.test(String(d.sha256)))) return null;
  return sha256(JSON.stringify({ id, platform, version: e.version || null,
    downloads: dls.map((d) => [d.url, String(d.sha256).toLowerCase(), d.saveAs || null]),
    bin: Object.entries(e.bin || {}).sort(([a], [b]) => (a < b ? -1 : 1)), extra: extra || null }));
}

/** The stamp a pinned install left in <dir>/<id>/ ({ id, platform, version, pin, … }), or null. */
function readPin(dir, id) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(dir, id, PIN_FILE), 'utf8'));
    return s && s.schema === 'flpt.pin/1' && s.id === id && typeof s.pin === 'string' ? s : null;
  } catch { return null; }
}
function writePin(dir, id, stamp) {
  const file = path.join(dir, id, PIN_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify({ schema: 'flpt.pin/1', id, ...stamp, at: new Date().toISOString() }, null, 2)}\n`);
  fs.renameSync(`${file}.tmp`, file);
}

/** HyperFrames' expected pin: its headless Chrome's (the manifest) and its npm lockfile's, together. */
const hfPinOf = (manifest, platform, lockDir) => {
  const browser = pinOf(manifest, 'hyperframes', platform);
  const lock = hfLockHash(lockDir);
  return browser && lock ? { pin: sha256(`${browser}:${lock}`), browser, lock } : null;
};

/**
 * Does <dir>/<id>/ hold exactly this manifest's pins for this platform? 'match', 'stale' (pinned from other pins, or on
 * another platform) or 'none' (no stamp: not installed, or installed before stamps, so nothing vouches for it).
 */
function pinState(dir, id, manifest, platform = platformKey(), lockDir = LOCK_DIR) {
  const s = readPin(dir, id);
  if (!s) return 'none';
  const want = id === 'hyperframes' ? (hfPinOf(manifest, platform, lockDir) || {}).pin : pinOf(manifest, id, platform);
  return want && s.pin === want && s.platform === platform ? 'match' : 'stale';
}

/** Where each binary would be in the pinned layout (see the manifest's "bin" entries for this platform). */
function pinnedPaths(dir, manifest, platform = platformKey()) {
  const at = (id, key) => { const e = entryFor(manifest, id, platform); return e && e.bin && e.bin[key] ? path.join(dir, id, e.bin[key]) : null; };
  return {
    ffmpeg: at('ffmpeg', 'ffmpeg'), ffprobe: at('ffmpeg', 'ffprobe'),
    pythonBase: at('python', 'python'), chrome: at('chrome', 'chrome'), node: at('node', 'node'),
    ytdlp: at('yt-dlp', 'yt-dlp'),
  };
}

// ── HyperFrames (moving slides) ───────────────────────────────────────────────────────────────────────────────────
// Its CLI is installed with npm from the lockfile in src/main/hyperframes (npm-lock.json) into <toolchain>/hyperframes/app, and the
// headless Chrome it expects (pinned in the manifest) into <toolchain>/hyperframes/browser. In both modes: like the
// Python packages, it's always the app's own copy. Without it, slides simply stay still.

function hyperframesPaths(dir, manifest, platform = platformKey()) {
  const e = entryFor(manifest, 'hyperframes', platform) || {};
  const root = path.join(dir, 'hyperframes');
  return {
    root,
    app: path.join(root, 'app'),
    cli: path.join(root, 'app', 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs'),
    pkg: path.join(root, 'app', 'node_modules', 'hyperframes', 'package.json'),
    browser: e.bin && e.bin.headless ? path.join(root, 'browser', e.bin.headless) : null,
    version: e.version || null,
  };
}

/** npm's own CLI next to this Node: the official tarball's layout, then Homebrew's (npm under the prefix). */
function npmCliFor(node) {
  const cli = (bin) => path.join(path.dirname(bin), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const cands = [cli(node)];
  try { cands.push(cli(fs.realpathSync(node))); } catch { /* fine */ }
  // Homebrew keeps npm under its prefix, not next to the Node it links to
  if (/\/(opt\/homebrew|usr\/local)\//.test(node)) cands.push(...['/opt/homebrew', '/usr/local'].map((p) => path.join(p, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')));
  return firstExisting(cands);
}

/**
 * Install HyperFrames for moving slides: the pinned headless Chrome (checksum-verified) and the CLI from the pinned
 * lockfile (npm ci verifies every package's integrity). Skips whatever is already in place: a part this folder's stamp
 * says came from other pins is installed again; one from before stamps (no stamp) stays as it is, unstamped.
 */
async function setupHyperFrames({ dir, manifestFile, node, lockDir = LOCK_DIR, platform = platformKey(), onProgress = () => {}, fetchImpl }) {
  const manifest = readManifest(manifestFile);
  const e = entryFor(manifest, 'hyperframes', platform);
  if (!e) throw new Error(`HyperFrames isn't in the toolchain manifest${(manifest.tools || {}).hyperframes ? ` for ${platform}` : ''}`);
  const hp = hyperframesPaths(dir, manifest, platform);
  const want = hfPinOf(manifest, platform, lockDir);
  const had = readPin(dir, 'hyperframes');
  const fresh = { browser: false, cli: false };
  const stale = (part) => Boolean(had && want && (had.platform !== platform || had[part] !== want[part]));
  if (hp.browser && (!exists(hp.browser) || stale('browser'))) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flpt-hf-'));
    try {
      const into = path.join(hp.root, 'browser');
      fs.rmSync(into, { recursive: true, force: true });
      for (const d of e.downloads || []) {
        if (!d.url || !d.sha256) throw new Error('HyperFrames\' browser isn\'t pinned (no URL or checksum)');
        const file = path.join(tmp, path.basename(new URL(d.url).pathname));
        onProgress({ id: 'hyperframes', phase: 'download', label: 'HyperFrames browser', bytes: 0, total: d.size || null });
        await download(d.url, file, d.sha256, (bytes) => onProgress({ id: 'hyperframes', phase: 'download', bytes, total: d.size || null }), fetchImpl);
        onProgress({ id: 'hyperframes', phase: 'unpack' });
        await extract(file, into);
      }
      if (!exists(hp.browser)) throw new Error('HyperFrames\' browser wasn\'t where the manifest says after unpacking');
      fs.chmodSync(hp.browser, 0o755);
      if (process.platform === 'darwin') await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', into]);
      fresh.browser = true;
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  const have = (() => { try { return JSON.parse(fs.readFileSync(hp.pkg, 'utf8')).version; } catch { return null; } })();
  if (!exists(hp.cli) || have !== hp.version || stale('lock')) {
    if (!node) throw new Error('Node.js is needed to install HyperFrames');
    const npm = npmCliFor(node);
    if (!npm) throw new Error('npm wasn\'t found next to Node.js');
    fs.rmSync(hp.app, { recursive: true, force: true });
    fs.mkdirSync(hp.app, { recursive: true });
    // shipped as npm-package.json and npm-lock.json: the app builder leaves files named package-lock.json out
    for (const [from, to] of [['npm-package.json', 'package.json'], ['npm-lock.json', 'package-lock.json']]) fs.writeFileSync(path.join(hp.app, to), fs.readFileSync(path.join(lockDir, from)));
    onProgress({ id: 'hyperframes', phase: 'npm', label: `HyperFrames ${hp.version}` });
    const env = { PATH: [path.dirname(node), ...SYSTEM_DIRS].join(':'), HOME: process.env.HOME, npm_config_cache: path.join(hp.root, 'npm-cache'),
      npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false' };
    const r = await new Promise((resolve) => execFile(node, [npm, 'ci', '--omit=dev', '--ignore-scripts', '--loglevel=error'],
      { cwd: hp.app, env, timeout: 900000, maxBuffer: 8 << 20 }, (err, stdout, stderr) => resolve({ code: err ? 1 : 0, err: String(stderr || stdout || '') })));
    if (r.code !== 0 || !exists(hp.cli)) throw new Error(`couldn't install HyperFrames: ${r.err.slice(-300)}`);
    fs.rmSync(env.npm_config_cache, { recursive: true, force: true }); // only needed during the install
    fresh.cli = true;
  }
  // The stamp vouches only for what was verified here: both parts now, or one now and the other by an earlier stamp
  // of the same pins. A folder from before stamps keeps none until both parts are installed again.
  const earlier = (part) => Boolean(had && want && had.platform === platform && had[part] === want[part]);
  if (want && (fresh.browser || earlier('browser')) && (fresh.cli || earlier('lock'))) {
    writePin(dir, 'hyperframes', { platform, version: hp.version, pin: want.pin, browser: want.browser, lock: want.lock });
  }
  onProgress({ id: 'hyperframes', phase: 'done' });
  return hp.cli;
}

// ── Rhubarb Lip Sync (the cartoon presenter) ─────────────────────────────────────────────────────────────────────
// FLPT's own WebAssembly build of Rhubarb 1.14.0 and its PocketSphinx models ship inside engine/ (the app's Resources
// and the plugin alike): nothing is downloaded or hosted. The manifest lists every file's SHA-256; the first use checks
// them (and again whenever a file's size or time changes), and the cartoon's own pass is the only thing that loads them.

/** The engine beside this manifest: <repo>/engine in development, Resources/engine in the app (manifest in app.asar). */
const engineBeside = (manifestFile) => path.resolve(path.dirname(manifestFile), '..', '..', '..', 'engine');

function rhubarbPaths(manifestFile, engineRoot = null) {
  const e = (readManifest(manifestFile).tools || {}).rhubarb || null;
  if (!e || e.source !== 'engine' || typeof e.where !== 'string') return null;
  const root = path.join(engineRoot || engineBeside(manifestFile), e.where);
  return { root, js: path.join(root, (e.bin && e.bin.rhubarb) || 'rhubarb.js'), files: e.files || {}, version: e.version || null };
}

/** Every file the manifest lists is there at its size (quick; verifyRhubarb checks the bytes). → a problem, or null. */
function rhubarbProblem(rp) {
  if (!rp) return 'not in this build';
  for (const [rel, f] of Object.entries(rp.files)) {
    let st = null;
    try { st = fs.statSync(path.join(rp.root, rel)); } catch { return `${rel} is missing`; }
    if (!st.isFile() || st.size !== f.size) return `${rel} isn't the one FLPT shipped`;
  }
  return Object.keys(rp.files).length ? null : 'not in this build';
}

// Checked in this process: root → a hash of the files' sizes and times when their bytes were checked (so once).
const rhubarbChecked = new Map();

/**
 * Check FLPT's Rhubarb against the manifest, byte for byte, once: remembered for this process, and by a stamp in
 * `stampDir` (the engine's folder, sizes and times; the app passes its own folder, so one check serves every episode)
 * that skips the hashing until a file changes. → { ok, root, problem }. Never throws.
 */
function verifyRhubarb({ manifestFile, engineRoot = null, stampDir = null } = {}) {
  const rp = rhubarbPaths(manifestFile, engineRoot);
  const quick = rhubarbProblem(rp);
  if (quick) return { ok: false, root: rp && rp.root, problem: quick };
  const stats = Object.keys(rp.files).sort().map((rel) => { const st = fs.statSync(path.join(rp.root, rel)); return `${rel}:${st.size}:${st.mtimeMs}`; }).join('|');
  const sum = crypto.createHash('sha256').update(stats).digest('hex');
  const stampFile = stampDir ? path.join(stampDir, 'rhubarb', 'verified.json') : null;
  const stamped = () => { try { const s = JSON.parse(fs.readFileSync(stampFile, 'utf8')); return s.root === rp.root && s.stats === sum; } catch { return false; } };
  const known = rhubarbChecked.get(rp.root) === sum || Boolean(stampFile && stamped());
  if (!known) {
    for (const [rel, f] of Object.entries(rp.files)) {
      const got = crypto.createHash('sha256').update(fs.readFileSync(path.join(rp.root, rel))).digest('hex');
      if (got !== String(f.sha256).toLowerCase()) return { ok: false, root: rp.root, problem: `${rel} isn't the one FLPT shipped` };
    }
  }
  rhubarbChecked.set(rp.root, sum);
  if (stampFile && !stamped()) {
    try { fs.mkdirSync(path.dirname(stampFile), { recursive: true }); fs.writeFileSync(stampFile, JSON.stringify({ version: rp.version, root: rp.root, stats: sum, at: new Date().toISOString() })); } catch { /* checked anyway */ }
  }
  return { ok: true, root: rp.root, problem: null };
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

/** The requirements.lock's hash, or null where there's none. */
const lockHash = (lockFile = LOCK_FILE) => fileHash(lockFile);

/** Was <dir>'s venv installed from this requirements.lock (its stamp, the lock's hash)? */
function pythonLocked(dir, lockFile = LOCK_FILE) {
  const want = lockHash(lockFile);
  try { return Boolean(want) && JSON.parse(fs.readFileSync(path.join(dir, 'venv', VENV_LOCK), 'utf8')).lock === want; } catch { return false; }
}

const pep503 = (name) => String(name).toLowerCase().replace(/[-_.]+/g, '-');

/** The lock's pins, [{ name, version }] (names as PEP 503 normalizes them), or null where there's no lock. */
function lockPins(lockFile = LOCK_FILE) {
  let text;
  try { text = fs.readFileSync(lockFile, 'utf8'); } catch { return null; }
  return text.replace(/\\\r?\n\s*/g, ' ').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split(/\s+/)[0].match(/^([A-Za-z0-9._-]+)==(\S+)$/)).filter(Boolean)
    .map((m) => ({ name: pep503(m[1]), version: m[2] }));
}

/**
 * What <dir>'s venv holds that the lock doesn't say, per `pip freeze --all`: [] when it's exactly the lock's packages
 * (besides pip, and the setuptools and wheel an older Python's venv starts with).
 */
async function venvDrift(dir, lockFile = LOCK_FILE) {
  const r = await run(venvPython(dir), ['-m', 'pip', 'freeze', '--all', '--isolated', '--disable-pip-version-check'], { timeout: 120000 });
  if (r.code !== 0) return [`pip freeze failed: ${(r.err || r.out).trim().slice(-200)}`];
  const want = new Map((lockPins(lockFile) || []).map((p) => [p.name, p.version]));
  const have = new Map();
  const drift = [];
  for (const line of r.out.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const m = line.match(/^([A-Za-z0-9._-]+)==(\S+)$/);
    if (m) have.set(pep503(m[1]), m[2]); else drift.push(line);
  }
  for (const [name, v] of want) if (have.get(name) !== v) drift.push(`${name} ${have.get(name) || 'missing'}, not ${v}`);
  for (const [name, v] of have) if (!want.has(name) && !['pip', 'setuptools', 'wheel'].includes(name)) drift.push(`${name}==${v}`);
  return drift;
}

async function version(file, args, re) {
  const r = await run(file, args);
  const m = (r.out + r.err).match(re);
  return m ? m[1] : null;
}


async function detect({ dir, manifestFile, mode, platform = platformKey() }) {
  const manifest = readManifest(manifestFile);
  const pin = pinnedPaths(dir, manifest, platform);
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
      packages: pkgs.code === 0 ? pkgs.out.trim() : null, locked: pkgs.code === 0 && pythonLocked(dir),
      problem: pkgs.code === 0 ? null : 'the app\'s Python environment isn\'t set up yet' };
  } else {
    result.python = { path: null, problem: 'not found' };
  }
  result.chrome = chrome ? { path: chrome, version: await version(chrome, ['--version'], /(\d+\.\d+\.\d+\.\d+)/) } : { path: null, problem: 'not found' };
  result.node = node ? { path: node, version: await version(node, ['--version'], /v(\S+)/) } : { path: null, problem: 'not found' };
  const hp = hyperframesPaths(dir, manifest, platform);
  const hfVersion = (() => { try { return JSON.parse(fs.readFileSync(hp.pkg, 'utf8')).version; } catch { return null; } })();
  result.hyperframes = exists(hp.cli) && hfVersion
    ? { path: hp.cli, version: hfVersion, root: hp.root, browser: hp.browser && exists(hp.browser) ? hp.browser : null,
      problem: !node ? 'Node.js is missing' : (hp.version && hfVersion !== hp.version ? `version ${hfVersion}, not ${hp.version}` : null) }
    : { path: null, problem: 'not installed' };
  const rp = rhubarbPaths(manifestFile);
  const rProblem = rhubarbProblem(rp);
  result.rhubarb = rp && !rProblem ? { path: rp.js, version: rp.version, root: rp.root, problem: null, shipped: true } : { path: null, problem: rProblem };

  const tools = TOOLS.map((t) => {
    const r = result[t.id];
    const ok = Boolean(r.path) && !r.problem;
    const source = r.path ? (r.shipped ? 'shipped' : r.path.startsWith(dir) ? 'pinned' : 'system') : 'missing';
    // a pinned tool says whether its folder's stamp matches this manifest (informational: what's there still runs)
    return { ...t, ...r, ok, source, ...(source === 'pinned' ? { pin: pinState(dir, t.id, manifest, platform) } : {}) };
  });
  // every tool this platform needs is pinned (an optional tool pinned for other platforms only isn't needed here)
  const pinnable = Object.keys(manifest.tools || {}).filter((id) => !((manifest.tools[id] || {}).source === 'engine')).every((id) => {
    const e = entryFor(manifest, id, platform);
    if (!e) return Boolean((manifest.tools[id] || {}).optional);
    return Array.isArray(e.downloads) && e.downloads.length && e.downloads.every((d) => d.url && d.sha256);
  });
  return { mode, dir, platform, tools, ready: tools.every((t) => !t.required || t.ok), pinnable, manifestVersion: manifest.version || null };
}

/** PATH and variables for any pipeline process: our tools first, then the usual system places. */
function processEnv(det, base = {}) {
  const t = Object.fromEntries(det.tools.map((x) => [x.id, x]));
  const dirs = [];
  if (t.ffmpeg && t.ffmpeg.path) dirs.push(path.dirname(t.ffmpeg.path));
  if (t.python && t.python.venv) dirs.push(path.dirname(t.python.venv));
  if (t.node && t.node.path) dirs.push(path.dirname(t.node.path));
  const PATH = [...new Set([...dirs, ...SYSTEM_DIRS])].join(':');
  const env = { ...base, PATH, FLPT_CHROME: (t.chrome && t.chrome.path) || '', PYTHONDONTWRITEBYTECODE: '1' };
  const hf = t.hyperframes;
  if (hf && hf.ok) {
    // Moving slides: the app's own HyperFrames, its headless Chrome (else the slide Chrome, slower), our ffmpeg, no
    // telemetry, and its caches inside the toolchain folder.
    Object.assign(env, {
      FLPT_HYPERFRAMES: hf.path,
      HYPERFRAMES_BROWSER_PATH: hf.browser || (t.chrome && t.chrome.path) || '',
      HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1', HYPERFRAMES_SKIP_SKILLS: '1',
      HYPERFRAMES_FONT_CACHE_DIR: path.join(hf.root, 'font-cache'),
    });
    if (t.ffmpeg && t.ffmpeg.path) Object.assign(env, { HYPERFRAMES_FFMPEG_PATH: t.ffmpeg.path, HYPERFRAMES_FFPROBE_PATH: t.ffmpeg.ffprobe || '' });
  }
  return Object.assign(env, cuesnap.env(det.dir)); // { FLPT_WHISPER_PYTHON, FLPT_WHISPER_MODEL } only when it's all there
}

/**
 * Another surface's view of the pinned toolchain (the plugin's, W4-03): for each tool, the first of `dirs` whose stamp
 * says it holds exactly this manifest's pins for this platform, with its binaries there. The Mac app's folder first
 * (reused when it matches), then the surface's own. → { manifest, platform, mode, tools: { ffmpeg, python, chrome,
 * node, hyperframes } }, each tool { dir, … } or null; mode 'pinned' only when every one of them is.
 */
function resolvePinned({ manifestFile, dirs = [], platform = platformKey(), lockDir = LOCK_DIR, lockFile = LOCK_FILE }) {
  const manifest = readManifest(manifestFile);
  const roots = [...new Set(dirs.filter((d) => typeof d === 'string' && path.isAbsolute(d)))];
  const find = (id, ok) => roots.find((d) => pinState(d, id, manifest, platform, lockDir) === 'match' && ok(d)) || null;
  const pp = (d) => pinnedPaths(d, manifest, platform);
  const tools = {};
  let d = find('ffmpeg', (x) => exists(pp(x).ffmpeg || '') && exists(pp(x).ffprobe || ''));
  tools.ffmpeg = d ? { dir: d, path: pp(d).ffmpeg, ffprobe: pp(d).ffprobe } : null;
  d = find('python', (x) => exists(pp(x).pythonBase || ''));
  tools.python = d ? { dir: d, path: pp(d).pythonBase, venv: exists(venvPython(d)) ? venvPython(d) : null, locked: pythonLocked(d, lockFile) } : null;
  d = find('chrome', (x) => exists(pp(x).chrome || ''));
  tools.chrome = d ? { dir: d, path: pp(d).chrome } : null;
  d = find('node', (x) => exists(pp(x).node || ''));
  tools.node = d ? { dir: d, path: pp(d).node } : null;
  d = find('hyperframes', (x) => { const h = hyperframesPaths(x, manifest, platform); return exists(h.cli) && Boolean(h.browser) && exists(h.browser); });
  tools.hyperframes = d ? { dir: d, ...(({ cli, browser, root, version: v }) => ({ cli, browser, root, version: v }))(hyperframesPaths(d, manifest, platform)) } : null;
  const mode = Object.values(tools).every(Boolean) ? 'pinned' : 'system';
  return { manifest: manifest.version || null, platform, mode, tools };
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

/** Unpack a .zip (ditto on macOS, unzip on Linux: both keep the programs' modes) or a tarball (tar) into `into`. */
async function extract(archive, into) {
  fs.mkdirSync(into, { recursive: true });
  const zip = archive.endsWith('.zip');
  const tar = firstExisting(['/usr/bin/tar', '/bin/tar']) || 'tar';
  const r = zip && process.platform === 'darwin' ? await run('/usr/bin/ditto', ['-x', '-k', archive, into], { timeout: 600000 })
    : zip ? await run(firstExisting(['/usr/bin/unzip', '/bin/unzip']) || 'unzip', ['-q', '-o', archive, '-d', into], { timeout: 600000 })
      : await run(tar, ['-xf', archive, '-C', into], { timeout: 600000 });
  if (r.code !== 0) throw new Error(`couldn't unpack ${path.basename(archive)}: ${r.err.slice(0, 200)}`);
}

/**
 * Install every pinned tool from the manifest for this platform, then create the app's Python environment.
 * Refuses any entry without a SHA-256: nothing unverified ever runs. Optional tools (yt-dlp) install only when
 * named in `only`. A download with "saveAs" is a single program, saved under that name instead of unpacked. Each tool's
 * folder gets its stamp (the fingerprint of the pins it was verified against), and installed.json lists them.
 */
async function install({ dir, manifestFile, onProgress = () => {}, fetchImpl, only, platform = platformKey() }) {
  const manifest = readManifest(manifestFile);
  // what ships inside engine/ (Rhubarb) is never downloaded: verifyRhubarb checks it on first use
  const ids = Object.keys(manifest.tools || {}).filter((id) => {
    const e = manifest.tools[id];
    return !(e && e.source === 'engine') && (only ? only.includes(id) : !(e && e.optional));
  });
  const entries = ids.map((id) => [id, entryFor(manifest, id, platform)]);
  const dls = (e) => (e && Array.isArray(e.downloads) ? e.downloads : []);
  for (const [id, e] of entries) {
    if (!e) throw new Error(`${id} isn't pinned for ${platform} yet (no URL or checksum in the manifest)`);
    if (!dls(e).length || dls(e).some((d) => !d.url || !d.sha256)) throw new Error(`${id} isn't pinned yet (no URL or checksum in the manifest)`);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flpt-tools-'));
  const pins = {};
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
        if (process.platform === 'darwin') await run('/usr/bin/xattr', ['-d', 'com.apple.quarantine', p]);
      }
      const pin = pinOf(manifest, id, platform);
      if (pin) { writePin(dir, id, { platform, version: e.version || null, pin }); pins[id] = pin; }
      onProgress({ id, phase: 'done' });
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  let before = {};
  try { before = JSON.parse(fs.readFileSync(path.join(dir, 'installed.json'), 'utf8')) || {}; } catch { /* the first install */ }
  const keepPins = before.platform === platform && before.pins && typeof before.pins === 'object' ? before.pins : {};
  fs.writeFileSync(path.join(dir, 'installed.json'), JSON.stringify({ version: manifest.version, platform, pins: { ...keepPins, ...pins }, at: new Date().toISOString() }, null, 2));
}

/**
 * The app's own Python environment: a venv, and FLPT's packages from requirements.lock (every wheel by its SHA-256, no
 * other package; the venv remembers the lock it came from). Works in both modes. Where the lock can't install (a Python
 * with no wheel in it), the same two packages unpinned, unless `strict` (FLPT's pinned Python: the lock or nothing).
 * `packages`: a list of names instead (unpinned; [] makes the bare venv).
 *
 * The lock always goes into a new, empty venv: pip never re-checks the hash of a package that's already installed, and
 * leaves other packages be, so a venv that isn't stamped from this lock is set aside (and put back if the lock can't
 * install), and the stamp is written only when `pip freeze` then holds exactly the lock's packages.
 */
async function setupPython({ dir, pythonBase, packages, lockFile = LOCK_FILE, strict = false, onProgress = () => {} }) {
  const venvDir = path.join(dir, 'venv');
  const makeVenv = async () => {
    onProgress({ id: 'python', phase: 'venv' });
    fs.rmSync(venvDir, { recursive: true, force: true });
    const r = await run(pythonBase, ['-m', 'venv', venvDir], { timeout: 120000 });
    if (r.code !== 0) throw new Error(`couldn't create the Python environment: ${r.err.slice(0, 200)}`);
  };
  // A venv is tied to the Python it was made from. If that Python moved or changed (a toolchain update, a moved
  // folder), the venv is stale: rebuild it rather than fail.
  let healthy = exists(venvPython(dir)) && (await run(venvPython(dir), ['-c', 'import sys'])).code === 0;
  if (healthy) {
    try {
      const home = (fs.readFileSync(path.join(venvDir, 'pyvenv.cfg'), 'utf8').match(/^home\s*=\s*(.+)$/m) || [])[1];
      if (home && fs.realpathSync(home.trim()) !== fs.realpathSync(path.dirname(pythonBase))) healthy = false;
    } catch { healthy = false; }
  }
  if (!healthy) await makeVenv();
  const stamp = path.join(venvDir, VENV_LOCK);
  const pip = (args) => run(venvPython(dir), ['-m', 'pip', 'install', '--isolated', '--disable-pip-version-check', '-q', '--only-binary=:all:', ...args], { timeout: 900000 });
  const names = Array.isArray(packages) ? packages : ['numpy', 'requests'];
  const want = Array.isArray(packages) ? null : lockHash(lockFile);
  if (want) {
    if (pythonLocked(dir, lockFile) && (await run(venvPython(dir), ['-c', 'import numpy, requests'])).code === 0) return venvPython(dir);
    fs.rmSync(stamp, { force: true });
    const aside = healthy ? path.join(dir, 'venv.old') : null; // the venv that was there (a just-made one is empty)
    const putBack = () => {
      if (!aside) return;
      fs.rmSync(venvDir, { recursive: true, force: true });
      fs.renameSync(aside, venvDir);
    };
    if (aside) {
      fs.rmSync(aside, { recursive: true, force: true });
      fs.renameSync(venvDir, aside);
      try { await makeVenv(); } catch (e) { putBack(); throw e; }
    }
    onProgress({ id: 'python', phase: 'packages', packages: names, locked: true });
    // pip gets a copy beside the venv: in the built app the lock is inside app.asar, which only Electron's fs can read
    const copy = path.join(venvDir, 'requirements.lock');
    fs.writeFileSync(copy, fs.readFileSync(lockFile));
    const r = await pip(['--require-hashes', '--no-deps', '-r', copy]);
    const drift = r.code === 0 ? await venvDrift(dir, lockFile) : null;
    if (r.code === 0 && !drift.length) {
      fs.writeFileSync(stamp, `${JSON.stringify({ lock: want, python: (await version(venvPython(dir), ['--version'], /Python (\S+)/)), at: new Date().toISOString() }, null, 2)}\n`);
      if (aside) fs.rmSync(aside, { recursive: true, force: true });
      onProgress({ id: 'python', phase: 'done', locked: true });
      return venvPython(dir);
    }
    putBack();
    if (strict) {
      throw new Error(r.code !== 0 ? `couldn't install FLPT's Python packages from requirements.lock: ${(r.err || r.out).slice(-300)}`
        : `FLPT's Python environment doesn't hold exactly requirements.lock: ${drift.slice(0, 8).join('; ')}`);
    }
  } else if (strict) {
    throw new Error('requirements.lock isn\'t there, and FLPT\'s pinned Python takes its packages only from it');
  }
  if (!names.length) return venvPython(dir);
  onProgress({ id: 'python', phase: 'packages', packages: names, locked: false });
  const r = await pip(names);
  if (r.code !== 0) throw new Error(`couldn't install ${names.join(', ')}: ${(r.err || r.out).slice(-300)}`);
  onProgress({ id: 'python', phase: 'done', locked: false });
  return venvPython(dir);
}

module.exports = { detect, install, setupPython, setupHyperFrames, hyperframesPaths, npmCliFor, processEnv, download, extract, TOOLS, readManifest, venvPython, findYtDlp, ytDlpVersion, YTDLP_DIRS,
  rhubarbPaths, verifyRhubarb, engineBeside,
  // per platform, pins and stamps, the lock (W4-03)
  PLATFORMS, LOCK_FILE, LOCK_DIR, platformKey, entryFor, pinOf, pinState, readPin, pinnedPaths, resolvePinned, pythonLocked, lockHash, lockPins, venvDrift, hfLockHash };
