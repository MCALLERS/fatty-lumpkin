'use strict';
// What the flpt-* tools share: the Mac app's own modules (copied into lib/ by sync-lib.sh), where things live, and a
// few command-line helpers. Each place can be moved with an environment variable (the tests use them to stay clear
// of real data):
//   FLPT_PROJECTS       episodes (default: the Mac app's folder, else ~/Documents/FLPT)
//   FLPT_LIBRARY        the Library (default: the Mac app's, else <episodes>/Library)
//   FLPT_DELIVERABLES   delivered episodes (default: the Mac app's, else ~/Desktop)
//   FLPT_USER_DATA      the Mac app's data folder, read for its settings only
//   AVATAR_PRESENTATION_CONFIG_DIR   presenter.env and keys.env (default: ~/.config/avatar-presentation)
//   FLPT_CHROME, FLPT_PYTHON, FLPT_YTDLP   tools to use instead of the usual ones
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseArgs } = require('util');
const { execFile } = require('child_process');

const ROOT = path.resolve(__dirname, '..'); // the plugin (engine/ in the repo)
const app = (name) => require(path.join(__dirname, 'lib', 'src', 'main', name));

const abs = (p) => (p && path.isAbsolute(p) ? path.resolve(p) : null);
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const runnable = (p) => { try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; } };

/** Where episodes, the Library, deliveries and the presenter settings live: the Mac app's choices when it has any. */
function places() {
  const settings = app('settings');
  const userData = abs(process.env.FLPT_USER_DATA) || path.join(os.homedir(), 'Library', 'Application Support', 'Fatty Lumpkin Presentation Tool');
  const s = exists(path.join(userData, 'settings.json')) ? settings.createSettings({ dir: userData }).read() : settings.defaults();
  const projects = abs(process.env.FLPT_PROJECTS) || s.projectsDir;
  return {
    projects,
    library: abs(process.env.FLPT_LIBRARY) || (process.env.FLPT_PROJECTS ? path.join(projects, 'Library') : settings.libraryDirOf(s)),
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

/** The tools on this Mac (any may be null). */
function tools() {
  const pick = (env, found) => (abs(process.env[env]) && runnable(process.env[env]) ? path.resolve(process.env[env]) : found);
  return {
    chrome: pick('FLPT_CHROME', CHROMES.find(runnable) || null),
    python: pick('FLPT_PYTHON', which('python3')),
    ffmpeg: which('ffmpeg'),
    ffprobe: which('ffprobe'),
    node: process.execPath,
  };
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
  return app('redact').createRedactor(() => values);
}

/** PATH for the pipeline's processes: ffmpeg's and Node's folders first. FLPT_CHROME for render_slides.py. */
function toolEnv() {
  const t = tools();
  const dirs = [t.ffmpeg && path.dirname(t.ffmpeg), path.dirname(t.node), ...String(process.env.PATH || '').split(path.delimiter), ...SYSTEM_DIRS];
  return { PATH: [...new Set(dirs.filter((d) => d && path.isAbsolute(d)))].join(path.delimiter), FLPT_CHROME: t.chrome || '' };
}

/**
 * The app's pipeline runner (pipeline.js), for this plugin: the scripts read keys.env themselves (no key is passed
 * in), they find presenter.env and keys.env through AVATAR_PRESENTATION_CONFIG_DIR, and every output line is redacted.
 */
function pipeline(episode, { broker = null } = {}) {
  return app('pipeline').createPipeline({ engineRoot: ROOT, presenterDir: places().config, vault: { env: () => ({}) }, redact: redactor(episode), toolEnv, broker });
}

/** The app's episode flow (flow.js) for episodes in one folder. */
function flowFor(projectsDir, deps = {}) {
  return app('flow').createFlow({
    settings: { read: () => ({ projectsDir, deliverablesDir: places().deliverables }) },
    toolEnv, basePython: async () => tools().python, redact: (s) => s, send: () => {}, chrome: () => tools().chrome, ...deps,
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
 * Moving slides (the app's motion.js) for this plugin: HyperFrames runs through npx, as the method does on its own
 * (render.mjs; the first render downloads HyperFrames and its headless Chrome, with telemetry off).
 */
function motionFor(pl) {
  const motion = app('motion');
  const t = tools();
  const probe = (file) => new Promise((resolve, reject) => execFile(t.ffprobe || 'ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file],
    { timeout: 30000, maxBuffer: 8 << 20 }, (err, out) => (err ? reject(err) : resolve(JSON.parse(String(out))))));
  return {
    available: () => Boolean(t.node && t.ffmpeg && t.ffprobe),
    plan: (d) => motion.plan(d),
    clear: (d) => motion.clearMedia(d),
    render: (d, which, o = {}) => motion.render(d, which, { engineRoot: ROOT, fontCacheDir: path.join(places().config, 'deck-fonts'),
      retime: (args, ro) => pl.retime(d, args, ro), probe, ...o }),
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

module.exports = { ROOT, app, places, tools, which, episodeDir, readEnvFile, isSecret, redactor, toolEnv, pipeline, flowFor, brokerFor,
  episodeFlow, motionFor, library, cli, usageError, main, say, exists, abs };
