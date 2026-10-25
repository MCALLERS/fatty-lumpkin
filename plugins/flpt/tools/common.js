'use strict';
// What the flpt-* tools share: the Mac app's own modules (copied into lib/ by sync-lib.sh), where things live, and a
// few command-line helpers. Each place can be moved with an environment variable (the tests use them to stay clear
// of real data):
//   FLPT_PROJECTS       episodes (default: the Mac app's folder, else ~/Documents/FLPT)
//   FLPT_LIBRARY        the Library (default: the Mac app's, else <episodes>/Library)
//   FLPT_DELIVERABLES   delivered episodes (default: the Mac app's, else ~/Desktop)
//   FLPT_USER_DATA      the Mac app's data folder, read for its settings only
//   AVATAR_PRESENTATION_CONFIG_DIR   presenter.env and keys.env (default: ~/.config/avatar-presentation)
//   FLPT_PLUGIN_HOME    the plugin's own things: its Python for keyed runs, its pinned tools (toolchain/) and the pins
//                       they come from (pins/), the deck's fonts (default: ~/Library/Application Support/FLPT Plugin)
//   FLPT_CHROME, FLPT_PYTHON, FLPT_YTDLP   tools to use instead of the usual ones
//   FLPT_MAC_APP        the Mac app itself (default: /Applications, else ~/Applications), for its Transitions & Music
//
// The tools (W4-03): FLPT's pinned toolchain, the same pins as the Mac app's (toolchain-manifest.json): the Mac app's
// own folder when its stamps match those pins, else the plugin's (flpt-setup --install-tools fills it), else the
// system's tools, and then whatever this makes is stamped `toolchain: system` (provenance).
// The Transitions & Music tracks (the lead's ruling, 2026-10-24): the plugin ships no sound, so a Live Motion piece's
// library bed plays from the Mac app's own tracks, found the same way (appTracks); without them, the nearest score (DV13).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { parseArgs } = require('util');
const { execFile } = require('child_process');

const ROOT = path.resolve(__dirname, '..'); // the plugin (engine/ in the repo)
const app = (name) => require(path.join(__dirname, 'lib', 'src', 'main', name));

const abs = (p) => (p && path.isAbsolute(p) ? path.resolve(p) : null);
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const runnable = (p) => { try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; } };

/**
 * One of FLPT's pin files (toolchain-manifest.json, python/requirements.lock, hyperframes/npm-*.json): a checkout's
 * app/src/main, else the copy an installed plugin carries (lib's toolchain-pins.js: only modules reach lib/), written
 * out into the plugin's own folder (pins/) when it isn't there as it is. Null when there's neither.
 */
function appFile(...rel) {
  const checkout = path.join(ROOT, '..', 'app', 'src', 'main', ...rel);
  try { if (fs.statSync(checkout).isFile()) return checkout; } catch { /* an installed plugin */ }
  let text;
  try { text = app('toolchain-pins')[rel.join('/')]; } catch { return null; }
  if (typeof text !== 'string') return null;
  const file = path.join(pluginHome(), 'pins', ...rel);
  try { if (fs.readFileSync(file, 'utf8') === text) return file; } catch { /* not written yet */ }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.${process.pid}.tmp`, text);
    fs.renameSync(`${file}.${process.pid}.tmp`, file);
    return file;
  } catch { return null; }
}

/** Where episodes, the Library, deliveries and the presenter settings live: the Mac app's choices when it has any. */
function places() {
  const settings = app('settings');
  const userData = abs(process.env.FLPT_USER_DATA) || path.join(os.homedir(), 'Library', 'Application Support', 'Fatty Lumpkin Presentation Tool');
  const s = exists(path.join(userData, 'settings.json')) ? settings.createSettings({ dir: userData }).read() : settings.defaults();
  const projects = abs(process.env.FLPT_PROJECTS) || s.projectsDir;
  return {
    projects,
    userData,
    library: abs(process.env.FLPT_LIBRARY) || (process.env.FLPT_PROJECTS ? path.join(projects, 'Library') : settings.libraryDirOf(s)),
    // the Mac app's Transitions & Music (only read here: its tracks, appTracks), beside the Library
    addons: process.env.FLPT_PROJECTS ? path.join(projects, app('addons').DIR_NAME) : settings.addonsDirOf(s),
    deliverables: abs(process.env.FLPT_DELIVERABLES) || s.deliverablesDir,
    config: abs(process.env.AVATAR_PRESENTATION_CONFIG_DIR) || path.join(os.homedir(), '.config', 'avatar-presentation'),
    ytDlp: abs(process.env.FLPT_YTDLP) || s.ytDlpPath || '',
  };
}

const SYSTEM_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
const CHROMES = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'), '/Applications/Chromium.app/Contents/MacOS/Chromium'];

/** A program on PATH or in the usual places, or null. */
function which(name) {
  for (const d of [...String(process.env.PATH || '').split(path.delimiter).filter((x) => path.isAbsolute(x)), ...SYSTEM_DIRS]) {
    if (runnable(path.join(d, name))) return path.join(d, name);
  }
  return null;
}

/** The plugin's own folder: its Python for keyed runs (venv/), its pinned tools (toolchain/) and their pins (pins/), the deck's fonts (deck-fonts/). */
const pluginHome = () => abs(process.env.FLPT_PLUGIN_HOME) || path.join(os.homedir(), 'Library', 'Application Support', 'FLPT Plugin');

/** The two folders that can hold FLPT's pinned tools: the Mac app's, then the plugin's own. */
const toolchainDirs = () => ({ app: path.join(places().userData, 'toolchain'), own: path.join(pluginHome(), 'toolchain') });

let pinnedNow = null;
/**
 * FLPT's pinned toolchain as this plugin finds it (toolchain.resolvePinned): each tool from the Mac app's folder when
 * its stamp matches the plugin's manifest, else from the plugin's own, else none. → { mode: 'pinned'|'system',
 * manifest, platform, tools: { ffmpeg, python, chrome, node, hyperframes }, manifestFile, lockDir, lockFile, dirs }.
 * Worked out once per process (`fresh` again, after an install). Episodes made here are stamped with its mode, and the
 * modules that look for FLPT_HYPERFRAMES (flpt-scene, the runtime's tools) find its HyperFrames unless the caller set one.
 */
function pinned({ fresh = false } = {}) {
  if (pinnedNow && !fresh) return pinnedNow;
  const dirs = toolchainDirs();
  const manifestFile = appFile('toolchain-manifest.json');
  const hf = [appFile('hyperframes', 'npm-package.json'), appFile('hyperframes', 'npm-lock.json')];
  const lockDir = hf.every(Boolean) && path.dirname(hf[0]) === path.dirname(hf[1]) ? path.dirname(hf[1]) : null;
  const lockFile = appFile('python', 'requirements.lock');
  let r = { mode: 'system', manifest: null, platform: `${process.platform}-${process.arch}`, tools: {} };
  try {
    if (manifestFile) {
      r = app('toolchain').resolvePinned({ manifestFile, dirs: [dirs.app, dirs.own], lockDir: lockDir || path.join(ROOT, 'no-hyperframes-lock'),
        lockFile: lockFile || path.join(ROOT, 'no-lock') });
    }
  } catch { /* no pinned tools: the system's */ }
  pinnedNow = { ...r, manifestFile, lockDir, lockFile, dirs };
  try { app('provenance').configure({ toolchain: { manifest: r.manifest, platform: r.platform, mode: r.mode } }); } catch { /* stamps keep their default */ }
  const own = r.tools.hyperframes;
  if (own && !process.env.FLPT_HYPERFRAMES) Object.assign(process.env, { FLPT_HYPERFRAMES: own.cli, HYPERFRAMES_BROWSER_PATH: own.browser });
  return pinnedNow;
}

/** 'pinned' or 'system': what this plugin's runs are on now. */
const toolchainMode = () => pinned().mode;
/** The toolchain as styles.js stamps rendered media: the manifest's date on the pinned tools, else "system". */
const toolchainId = () => (pinned().mode === 'pinned' && pinned().manifest) || 'system';

const MAC_APP = 'Fatty Lumpkin Presentation Tool.app';
/** The Mac app: FLPT_MAC_APP (even when it isn't there: QA's "no app"), else /Applications, else ~/Applications; or null. */
const macApp = () => abs(process.env.FLPT_MAC_APP) || [path.join('/Applications', MAC_APP), path.join(os.homedir(), 'Applications', MAC_APP)].find(exists) || null;

let tracksNow = null;
/**
 * The Mac app's Transitions & Music tracks, which Live Motion's library beds play here (the lead's ruling, 2026-10-24):
 * found where the Mac app keeps them, as its pinned toolchain is, and played where they are (never copied into the
 * plugin): the ones it ships (<the app>/Contents/Resources/addons), else the ones it installed in its Transitions & Music
 * folder (places().addons). A track counts only when its SHA-256 is the one the plugin's beat grid was measured on
 * (score/grids/<id>.json), as a pinned tool counts only when its stamp matches. With none, a piece that names one plays
 * the nearest flpt-score preset and its shot says so (DV13). Worked out once per process. → [shipped music items]
 */
function appTracks() {
  if (tracksNow) return tracksNow;
  const score = app('score');
  const addons = app('addons');
  const shaOf = (f) => { try { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); } catch { return null; } };
  const stamped = (it) => { const g = score.libraryGrid(it.id, { engineRoot: ROOT }); return Boolean(g && g.sha256) && shaOf(it.filePath) === g.sha256; };
  const found = new Map();
  const bundle = macApp();
  const shipped = bundle ? addons.readShipped(path.join(bundle, 'Contents', 'Resources', 'addons')) : [];
  for (const it of [...shipped, ...addons.installed(places().addons)]) {
    if (it.kind === 'music' && !found.has(it.id) && stamped(it)) found.set(it.id, it);
  }
  tracksNow = [...found.values()];
  return tracksNow;
}

/** The tools on this Mac (any may be null): FLPT's pinned ones where there are, else the system's. */
function tools() {
  const pick = (env, found) => (abs(process.env[env]) && runnable(process.env[env]) ? path.resolve(process.env[env]) : found);
  const p = pinned().tools;
  return {
    chrome: pick('FLPT_CHROME', (p.chrome && p.chrome.path) || CHROMES.find(runnable) || null),
    python: pick('FLPT_PYTHON', (p.python && p.python.path) || which('python3')),
    ffmpeg: (p.ffmpeg && p.ffmpeg.path) || which('ffmpeg'),
    ffprobe: (p.ffmpeg && p.ffmpeg.ffprobe) || which('ffprobe'),
    node: (p.node && p.node.path) || process.execPath,
  };
}

/**
 * The Python the runs that get keys use (check, looks and filming; T18): FLPT's own, never an episode's .venv, never
 * PATH's python3. A venv made from requirements.lock first (the Mac app's, then the plugin's pinned one), then any the
 * Mac app has, then the plugin's own (flpt-setup --python or --install-tools makes it). Null when there's none: those
 * runs are then refused.
 */
function keyedPython() {
  const tc = (() => { try { return app('toolchain'); } catch { return null; } })();
  const lock = appFile('python', 'requirements.lock');
  const appDir = path.join(places().userData, 'toolchain');
  const ownDir = path.join(pluginHome(), 'toolchain');
  const locked = (d) => Boolean(tc && lock && tc.pythonLocked(d, lock));
  const venv = (d) => path.join(d, 'venv', 'bin', 'python');
  return [...[appDir, ownDir].filter(locked).map(venv), venv(appDir), venv(ownDir), venv(pluginHome())].find(runnable) || null;
}

const isEpisode = (d) => ['flpt-project.json', 'presentation/deck', 'presentation/script.md'].some((p) => exists(path.join(d, p)));

/** The episode folder: the one named, else the one we're in, else the newest in the episodes folder. */
function episodeDir(arg) {
  if (arg) {
    let d = path.resolve(String(arg).replace(/^~(?=$|\/)/, os.homedir()));
    if (path.basename(d) === 'presentation' && !isEpisode(d)) d = path.dirname(d);
    if (!isEpisode(d)) throw new Error(`${arg} isn't an episode folder (it has no flpt-project.json or presentation/).`);
    return d;
  }
  for (let d = process.cwd(); d !== path.dirname(d); d = path.dirname(d)) if (isEpisode(d)) return d;
  const root = places().projects;
  let best = null;
  for (const n of exists(root) ? fs.readdirSync(root) : []) {
    const st = app('episode').read(path.join(root, n));
    if (st && (!best || String(st.updatedAt) > String(best.st.updatedAt))) best = { dir: path.join(root, n), st };
  }
  if (!best) throw new Error('No episode yet. Start one with /flpt:new.');
  return best.dir;
}

/** KEY=VALUE lines, parsed the way the pipeline's load_config does. Values never leave this process. */
function readEnvFile(file) {
  const out = {};
  let text = '';
  try { text = fs.readFileSync(file, 'utf8').replace(/^﻿/, ''); } catch { return out; }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    let k = line.slice(0, line.indexOf('=')).trim();
    if (/^export\s/i.test(k)) k = k.slice(7).trim();
    const v = line.slice(line.indexOf('=') + 1).trim().replace(/\s+#.*$/, '').trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
    out[k.toUpperCase()] = v;
  }
  return out;
}

const isSecret = (k) => /_(KEY|TOKEN|SECRET|CREDENTIALS)$/.test(k);

/**
 * A redactor for pipeline output: every secret value in presenter.env, keys.env and the episode's api_keys.txt,
 * and the masked form the pipeline prints (first four…last four), become ••••. The app's redact.js does the work.
 */
function redactor(episode) {
  const files = [path.join(places().config, 'presenter.env'), path.join(places().config, 'keys.env')];
  if (episode) files.push(path.join(episode, 'presentation', 'video', 'api_keys.txt'));
  const values = [];
  for (const f of files) {
    for (const [k, v] of Object.entries(readEnvFile(f))) {
      if (!isSecret(k) || !v) continue;
      values.push(v);
      if (v.length > 10) values.push(`${v.slice(0, 4)}…${v.slice(-4)}`);
    }
  }
  const kept = readSignIn(); // the FLPT voices' sign-in a film may carry (houseVault)
  if (kept && typeof kept.token === 'string' && kept.token.length >= 8) values.push(kept.token);
  return app('redact').createRedactor(() => values);
}

/**
 * PATH for the pipeline's processes: ffmpeg's and Node's folders first. FLPT_CHROME for render_slides.py. On FLPT's
 * pinned tools, exactly the Mac app's (toolchain.processEnv): ffmpeg, the venv, Node, then the system's folders.
 */
function toolEnv() {
  const t = tools();
  const pin = pinned();
  const venv = pin.mode === 'pinned' && pin.tools.python && pin.tools.python.venv;
  const dirs = pin.mode === 'pinned' ? [path.dirname(t.ffmpeg), venv && path.dirname(venv), path.dirname(t.node), ...SYSTEM_DIRS]
    : [t.ffmpeg && path.dirname(t.ffmpeg), path.dirname(t.node), ...String(process.env.PATH || '').split(path.delimiter), ...SYSTEM_DIRS];
  const env = { PATH: [...new Set(dirs.filter((d) => d && path.isAbsolute(d)))].join(path.delimiter), FLPT_CHROME: t.chrome || '', PYTHONDONTWRITEBYTECODE: '1' };
  // The moving slides and the animators' clips (the method's render.mjs, FLPT_HYPERFRAMES) render in the sandbox, where
  // npx can't fetch HyperFrames: the caller's, else FLPT's pinned one (pinned()), else the copy flpt-scene finds (the
  // Mac app's, else one fetched once), as the Mac app's toolchain.processEnv gives it (INT-2: without it every moving
  // slide stayed still in the plugin's draft). Required here because flpt-scene requires this file.
  let hf = null;
  const own = pin.tools.hyperframes;
  if (own && process.env.FLPT_HYPERFRAMES === own.cli) hf = { cli: own.cli, browser: own.browser, fontCache: path.join(own.root, 'font-cache') };
  else { try { hf = require('./flpt-scene').hyperframes(); } catch { hf = null; } }
  if (hf && hf.browser) {
    Object.assign(env, { FLPT_HYPERFRAMES: hf.cli, HYPERFRAMES_BROWSER_PATH: hf.browser, HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1', HYPERFRAMES_SKIP_SKILLS: '1',
      ...(hf.fontCache ? { HYPERFRAMES_FONT_CACHE_DIR: hf.fontCache } : {}) });
    if (t.ffmpeg) Object.assign(env, { HYPERFRAMES_FFMPEG_PATH: t.ffmpeg, HYPERFRAMES_FFPROBE_PATH: t.ffprobe || '' });
  }
  // the cue-word snap's whisper (W4-11), when it's in the pinned toolchain, as toolchain.processEnv gives it to the Mac app
  if (pin.mode === 'pinned' && pin.tools.python && pin.tools.python.dir) Object.assign(env, app('cuesnap').env(pin.tools.python.dir));
  return env;
}

/**
 * The plugin's vault, as the app's pipeline runner and flow see it: it holds no key (the scripts read keys.env
 * themselves), only the FLPT voices' sign-in, which flpt-signin keeps in pluginHome()/flpt-voices.json (never in
 * keys.env). env() hands it over only while it's the sign-in of the Worker this plugin talks to now (keptSignIn), and
 * pipeline.js asks for it only for a film whose script names an FLPT voice (T19 for FLPT voices). status() says whether
 * it's there (never its value), and `account` is that file (guestvoice.houseReady reads its base from it).
 */
function houseVault() {
  const TOKEN = app('guestvoice').HOUSE_TOKEN;
  return {
    account: path.join(pluginHome(), 'flpt-voices.json'),
    status: () => ({ [TOKEN]: { name: TOKEN, set: Boolean(keptSignIn()) } }),
    env: (names) => { const s = Array.isArray(names) && names.includes(TOKEN) ? keptSignIn() : null; return s ? { [TOKEN]: s.token } : {}; },
  };
}

/**
 * The app's pipeline runner (pipeline.js), for this plugin: the scripts read keys.env themselves (no key is passed
 * in), they find presenter.env and keys.env through AVATAR_PRESENTATION_CONFIG_DIR, and every output line is redacted.
 * Runs that get keys use keyedPython() on the episode's scripts only when they're the plugin's own copy (else refused,
 * and restore() puts them back); a paid run reads only the keys of the provider it was approved for (FLPT_ALLOW_KEYS).
 * A film whose script names an FLPT voice also gets the plugin's sign-in to them (houseVault).
 */
function pipeline(episode, { broker = null } = {}) {
  const pl = app('pipeline').createPipeline({ engineRoot: ROOT, presenterDir: places().config, vault: houseVault(), redact: redactor(episode), toolEnv, broker,
    trustedPython: keyedPython, fontCacheDir: path.join(pluginHome(), 'deck-fonts') });
  // T18: the slide pictures and the draft in macOS's sandbox (slidebox.js), the Mac app's vault and crew folder unreadable there too
  const slidebox = app('slidebox');
  return slidebox.sandboxSlides(pl, { box: (d) => slidebox.boxFor(d, { hidden: [path.join(places().userData, 'vault.json'), path.join(places().userData, 'claude')] }) });
}

/** The app's episode flow (flow.js) for episodes in one folder. */
function flowFor(projectsDir, deps = {}) {
  // Live Motion's renders in a draft or film (ext/livemotion's afterRender) get the pinned HyperFrames and its browser,
  // as the scene crew's do (W2-12 handoff 1); required here because flpt-scene requires this file
  const livemotion = { env: require('./flpt-scene').liveEnv() };
  // the toolchain's mode, for each episode's madeWith (provenance): pinned only on FLPT's pinned tools (W4-03)
  const toolchainMode = pinned().mode;
  // an episode's own Python is made from FLPT's, as the Mac app makes it: on the pinned Python, its venv (FLPT_PYTHON still wins)
  const pinPy = pinned().tools.python;
  const basePython = async () => { const py = tools().python; return pinPy && py === pinPy.path ? pinPy.venv || py : py; };
  return app('flow').createFlow({
    settings: { read: () => ({ projectsDir, deliverablesDir: places().deliverables, toolchainMode }) }, engineRoot: ROOT,
    toolEnv, basePython, redact: (s) => s, send: () => {}, chrome: () => tools().chrome, livemotion,
    // Spend and Jazz ask it whether the FLPT voices' sign-in is here (guestvoice.houseReady), as the Mac app's vault
    vault: houseVault(), ...deps,
  });
}

/**
 * The app's spend broker (broker.js) for one episode: approvals, caps and an append-only ledger in <episode>/spend/,
 * which only appears once money is first approved.
 */
function brokerFor(dir) {
  const spend = path.join(dir, 'spend');
  let b = null;
  const real = () => (b = b || app('broker').createBroker({ dir: spend }));
  const any = () => b || exists(path.join(spend, 'budgets.json'));
  return {
    approve: (...a) => real().approve(...a), authorize: (...a) => real().authorize(...a), settle: (...a) => real().settle(...a),
    record: (...a) => real().record(...a), close: (...a) => real().close(...a),
    isLive: (...a) => (any() ? real().isLive(...a) : false), list: () => (any() ? real().list() : []),
  };
}

/**
 * Moving slides (the app's motion.js) for this plugin: HyperFrames from toolEnv (FLPT's pinned copy, else what
 * flpt-scene finds), else npx, as the method does on its own. The deck's fonts come from the episode's own copy
 * (presentation/assets/fonts/), made once through the plugin's font cache.
 */
function motionFor(pl) {
  const motion = app('motion');
  const t = tools();
  const probe = (file) => new Promise((resolve, reject) => execFile(t.ffprobe || 'ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file],
    { timeout: 30000, maxBuffer: 8 << 20 }, (err, out) => (err ? reject(err) : resolve(JSON.parse(String(out))))));
  // the video insets play with ffmpeg
  const ffmpeg = (args, { signal } = {}) => new Promise((resolve) => execFile(t.ffmpeg || 'ffmpeg', args, { maxBuffer: 16 << 20, signal },
    (err, out, e) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, err: String(e || '') })));
  return {
    available: () => Boolean(t.node && t.ffmpeg && t.ffprobe),
    plan: (d) => motion.plan(d),
    clear: (d) => motion.clearMedia(d),
    render: (d, which, o = {}) => motion.render(d, which, { engineRoot: ROOT, fontCacheDir: path.join(pluginHome(), 'deck-fonts'),
      retime: (args, ro) => pl.retime(d, args, ro), probe, ffmpeg, ...o }),
    // a cartoon or cut scene the Mac app's Scenes step made, put together again (ffmpeg only, nothing paid)
    assemble: (d, key, o = {}) => motion.assembleScene(d, key, { probe, ffmpeg, ...o }),
  };
}

/** The flow for one episode, with its own pipeline (output redacted), spend broker and moving slides. */
function episodeFlow(dir, deps = {}) {
  const broker = brokerFor(dir);
  const pl = pipeline(dir, { broker });
  return flowFor(path.dirname(dir), { broker, pipeline: pl, redact: redactor(dir), motion: motionFor(pl), ...deps });
}

/** The user's Library (library.js): the same folder the Mac app uses, unless FLPT_LIBRARY says otherwise. */
function library() {
  const t = tools();
  return app('library').createLibrary({
    dir: places().library,
    media: app('media').createMedia({ ffmpeg: t.ffmpeg, ffprobe: t.ffprobe, chrome: t.chrome }),
    fetch: (url, opts) => globalThis.fetch(url, opts),
    trash: async () => { throw new Error('Remove Library items in the Mac app or in Finder.'); },
  });
}

/** parseArgs with the tools' conventions: --help prints the usage; a bad option is a usage error (exit 2). */
function cli(usage, options = {}) {
  let parsed;
  try {
    parsed = parseArgs({ args: process.argv.slice(2), options: { help: { type: 'boolean', short: 'h' }, ...options }, allowPositionals: true, strict: true });
  } catch (e) {
    usageError(usage, e.message);
  }
  if (parsed.values.help) { process.stdout.write(`${usage.trim()}\n`); process.exit(0); }
  return parsed;
}

function usageError(usage, why) {
  if (why) process.stderr.write(`${why}\n\n`);
  process.stderr.write(`${usage.trim()}\n`);
  process.exit(2);
}

/** Run a tool's main(): an error is one plain line and exit code 1. */
function main(fn) {
  Promise.resolve().then(fn).then((code) => { if (typeof code === 'number') process.exitCode = code; },
    (e) => { process.stderr.write(`${e && e.message ? e.message : e}\n`); process.exitCode = 1; });
}

const say = (s = '') => process.stdout.write(`${s}\n`);

// Each flpt-* command works out its toolchain when it starts, so every episode it writes is stamped with the one it runs on.
if (require.main && /[\\/]flpt-[\w-]+\.js$/.test(require.main.filename || '')) { try { pinned(); } catch { /* the system's tools */ } }
// Live Motion's library beds play from the Mac app's own tracks wherever the app's modules look for them (shippedLibrary)
try { app('livemotion').useTracks(appTracks); } catch { /* an installed plugin without its lib: nothing plays */ }

/**
 * The plugin's sign-in to FLPT's site (flpt-signin keeps it in pluginHome()/flpt-voices.json, W4-10), as Share's review
 * queue sends with it (flpt-refs share --send, W4-09): { origin, headers() } while it's the sign-in of the Worker this
 * plugin talks to now, else null (then Share exports). The token goes only to that Worker.
 */
function signIn() {
  const s = keptSignIn();
  if (!s) return null;
  let origin = null;
  try { origin = new URL(s.base).origin; } catch { return null; }
  const token = s.token;
  return { origin, headers: async () => ({ authorization: `Bearer ${token}` }) };
}

/** What flpt-signin keeps in pluginHome()/flpt-voices.json ({ token, base, email, … }), or null. */
function readSignIn() {
  try { const s = JSON.parse(fs.readFileSync(path.join(pluginHome(), 'flpt-voices.json'), 'utf8')); return s && typeof s === 'object' ? s : null; } catch { return null; }
}

/** The kept sign-in ({ token, base }) while it's the one of the Worker this plugin talks to now; else null. */
function keptSignIn() {
  const house = app('providers/fish-house');
  const s = readSignIn();
  if (!s || typeof s.token !== 'string' || !house.TOKEN_RE.test(s.token) || s.base !== house.baseUrl()) return null;
  return { token: s.token, base: s.base };
}

module.exports = { ROOT, app, appFile, places, tools, which, episodeDir, readEnvFile, isSecret, redactor, toolEnv, pipeline, flowFor, brokerFor,
  episodeFlow, motionFor, library, cli, usageError, main, say, exists, abs, pluginHome, keyedPython, pinned, toolchainDirs, toolchainMode, toolchainId, signIn,
  houseVault, macApp, appTracks };
