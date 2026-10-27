#!/usr/bin/env node
'use strict';
// The Desk (PLAN §2.5's Desk row, §3.3 S17, R12 and R21; W4-02): the FLPT app's own screens in a window on this Mac, over
// the plugin's episodes, for what's easier to look at and point to than to type: a storyboard's shots, the Style
// Gallery, the Live Motion wall. flpt-server --mode desk (engine/tools/server, W4-01) serves them on 127.0.0.1.
//   open [<episode>] [--styles [--shot <s3>]] [--no-window]
//        The Desk, started once (it stops after 30 idle minutes, or when the browser it opened in quits), and its
//        window: FLPT's pinned Chrome for Testing (else this Mac's Chrome, when no policy manages it), a throwaway
//        profile, the mock keychain (the macOS Keychain is never asked), and a dead proxy, so the window reaches the
//        Desk's two loopback ports and nothing else, loopback included. --styles opens the Style Gallery; with --shot,
//        picking that shot's style.
//   wait [<episode>] --until storyboard-approved|style-picked|scene-approved [--shot <s3>] [--piece <key>] [--minutes <n>]
//        Ends once the user has done it (in the Desk, or anywhere: it reads the episode), with one line saying what; for
//        scene-approved also when they ask a piece for changes in the Desk, since the crews run here, in chat.
//   stop · status
// The Desk never spends and never runs a crew: no key is in it, nothing is asked in it (caps.approve 'none'), and a
// crew's or a film's button answers "Runs in Claude Code." The storyboard is approved there as flpt-storyboard approves
// it: Claude Code runs on the user's own account, so there's no Claude top-up to ask. Previews are local
// (caps.preview 'local'): a shipped style's poster and loop are rendered on this Mac when the Gallery first needs them
// (free, sandboxed, into the plugin's own folder: the plugin ships no media), and a Shared style brings its own from
// FLPT's signed catalog. Everything it keeps is in <plugin home>/desk/ (state.json, browser.json and journal.jsonl,
// mode 0600; its own app profile; the rendered posters and loops).
// `serve` (run by `open`, detached) is the Desk's own process: flpt-server --mode desk with the Desk's rules on top.
// For QA: `open --local-media` renders the posters here even in a checkout of FLPT (which has the app's own), and
// FLPT_DESK_RENDER=<ids>|none limits which.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { ROOT, app, places, tools, pinned, pluginHome, episodeDir, isSecret, cli, usageError, main, say } = require('./common');

const USAGE = `
Usage: flpt-desk <command>
  open [<episode>] [--styles [--shot <s1…>]] [--no-window]
  wait [<episode>] --until storyboard-approved|style-picked|scene-approved [--shot <s1…>] [--piece <key>] [--minutes <n>]
  stop
  status`;

const OPTIONS = {
  styles: { type: 'boolean' }, shot: { type: 'string' }, 'no-window': { type: 'boolean' }, until: { type: 'string' }, piece: { type: 'string' },
  minutes: { type: 'string' }, 'local-media': { type: 'boolean' },
};
const COMMANDS = ['open', 'wait', 'stop', 'status'];
const UNTIL = ['storyboard-approved', 'style-picked', 'scene-approved'];
const CHAT = 'Runs in Claude Code.';
const DEAD_PROXY = '127.0.0.1:9';
const WAIT_MINUTES = 30;
// an empty 1×1 picture (transparent PNG)
const BLANK_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==', 'base64');
const SHOT = /^s[1-9][0-9]{0,3}$/;
// What the Desk leaves to Claude Code: the crews, the pipeline's runs (draft, film, Refine, Deliver: the Spend screen
// and after are chat's, and money is asked there), the reference study and capture (crews and the network), and
// Setup's runs (the tools' install goes online: flpt-setup --install-tools; the check and the sample are the pipeline's).
const CHAT_METHODS = ['episode.run', 'episode.animate', 'episode.draft', 'episode.film', 'episode.approveSpend', 'episode.tighten', 'episode.refine',
  'episode.deliver', 'episode.slackPack', 'episode.slackDelivered', 'episode.scene', 'jazz.play', 'livemotion.render', 'refs.study', 'refs.again', 'refs.capture',
  'tools.install', 'check.run', 'sample.draft', 'sample.approveAndRun', 'settings.chooseFolder'];
// and the steps from Scenes on are approved there too (Spend's money above all): the Desk approves up to Live Motion
const CHAT_STAGES = ['scenes', 'spend', 'film', 'refine', 'deliver'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (f, fb = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const runnable = (p) => { try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; } };
// eslint-disable-next-line no-control-regex
const clean = (s, n = 200) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}
function writeJsonl(file, lines) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, lines.length ? `${lines.join('\n')}\n` : '', { mode: 0o600 });
  fs.renameSync(tmp, file);
}
/** Is a process alive? (not whether it's ours: see whose) */
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
const PS = fs.existsSync('/bin/ps') ? '/bin/ps' : 'ps';
const SERVE_MARK = 'flpt-desk.js serve';
/**
 * Whose is `pid` now: 'ours' (alive, its command line holds `mark`), 'gone', 'other' (a pid from a stale file, after a
 * crash or a restart, can be another program's) or 'unknown' (ps couldn't say). Only 'ours' is ever signalled.
 */
function whose(pid, mark) {
  if (!alive(pid)) return 'gone';
  const r = spawnSync(PS, ['-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8', timeout: 5000 });
  if (r.error) return 'unknown';
  const line = String(r.stdout || '').trim();
  if (!line) return alive(pid) ? 'unknown' : 'gone';
  return line.includes(mark) ? 'ours' : 'other';
}
/** SIGTERM, then (after `ms`, and only while it's still ours) SIGKILL. → whether it was ours */
async function endProcess(pid, mark, ms = 3000) {
  if (whose(pid, mark) !== 'ours') return false;
  try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  for (let i = 0; i < ms / 100 && alive(pid); i += 1) await sleep(100);
  if (whose(pid, mark) === 'ours') { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  return true;
}

/** Where the Desk keeps its things: <plugin home>/desk/. */
function placesOf() {
  const home = path.join(pluginHome(), 'desk');
  return {
    home, state: path.join(home, 'state.json'), browser: path.join(home, 'browser.json'), journal: path.join(home, 'journal.jsonl'),
    control: path.join(home, 'control.json'), ack: path.join(home, 'control.done.json'), profile: path.join(home, 'profile'),
    media: path.join(home, 'styles-media'), log: path.join(home, 'desk.log'),
  };
}

// ── the window ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The Desk window's Chrome flags (W1-09's host notes, INT-2's WebRTC ruling): its own profile; a dead proxy for
 * everything but the Desk's two ports (<-loopback> takes away Chrome's own loopback exception, so no other service on
 * this Mac is reached either); DNS prefetch off; WebRTC only through the proxy (the switch, and the profile's
 * preference: headless Chrome reads only the latter); sites in their own processes; the mock keychain; nothing of
 * Google's in the background. `url` opens as an app window (no tabs or address bar), or as a plain page (app: false).
 */
function chromeArgs({ port, previewPort, profile, url = null, app: asApp = true }) {
  const bypass = ['<-loopback>', `127.0.0.1:${port}`, ...(previewPort ? [`127.0.0.1:${previewPort}`] : [])].join(';');
  return [
    `--user-data-dir=${profile}`,
    `--proxy-server=${DEAD_PROXY}`, `--proxy-bypass-list=${bypass}`,
    '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-background-networking', '--disable-component-update',
    '--disable-default-apps', '--disable-extensions', '--disable-domain-reliability', '--no-pings', '--disable-breakpad',
    '--disable-client-side-phishing-detection', '--metrics-recording-only',
    '--disable-features=Translate,OptimizationHints,MediaRouter,AutofillServerCommunication,InterestFeedContentSuggestions',
    '--blink-settings=dnsPrefetchingEnabled=false', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--site-per-process',
    '--use-mock-keychain', '--password-store=basic', '--window-size=1440,900',
    ...(url ? (asApp ? [`--app=${url}`] : [url]) : []),
  ];
}

/** The profile's own preferences, written before the first launch: WebRTC, prediction, Safe Browsing and the rest off. */
const PREFERENCES = {
  webrtc: { ip_handling_policy: 'disable_non_proxied_udp', multiple_routes_enabled: false, nonproxied_udp_enabled: false },
  net: { network_prediction_options: 2 },
  safebrowsing: { enabled: false },
  search: { suggest_enabled: false },
  alternate_error_pages: { enabled: false },
  credentials_enable_service: false,
  profile: { password_manager_enabled: false },
  translate: { enabled: false },
  browser: { check_default_browser: false },
};

/** A fresh throwaway browser profile (in the system's temp folder), its preferences written. */
function freshProfile() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'flpt-desk-chrome-')));
  fs.mkdirSync(path.join(dir, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Default', 'Preferences'), JSON.stringify(PREFERENCES));
  fs.writeFileSync(path.join(dir, 'First Run'), '');
  return dir;
}

/** Only a profile this made is ever removed: in the temp folder, named flpt-desk-chrome-…. */
function removeProfile(dir) {
  if (typeof dir !== 'string' || !/^flpt-desk-chrome-[A-Za-z0-9]+$/.test(path.basename(dir))) return;
  let tmp;
  try { tmp = fs.realpathSync(os.tmpdir()); } catch { tmp = os.tmpdir(); }
  if (path.dirname(path.resolve(dir)) !== tmp) return;
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

/** Where an organisation's policies for this Mac's Chrome or Chromium live (any of them can set a proxy of its own). */
function managedPolicies() {
  const user = os.userInfo().username;
  const files = [];
  for (const d of ['/Library/Managed Preferences', path.join('/Library/Managed Preferences', user)]) {
    for (const f of ['com.google.Chrome.plist', 'org.chromium.Chromium.plist']) files.push(path.join(d, f));
  }
  const dirs = ['/etc/opt/chrome/policies/managed', '/etc/chromium/policies/managed'];
  return [...files.filter(exists), ...dirs.filter((d) => { try { return fs.readdirSync(d).some((f) => f.endsWith('.json')); } catch { return false; } })];
}

/**
 * The browser the Desk opens in: FLPT_CHROME, else FLPT's pinned Chrome for Testing, else this Mac's Chrome, unless
 * that one is managed (its policies could set a proxy over the Desk's dead one).
 */
function deskChrome() {
  const c = tools().chrome;
  if (!c || !runnable(c)) return null;
  const pin = pinned().tools.chrome;
  const isPinned = Boolean(pin && pin.path === c);
  const managed = !isPinned && !process.env.FLPT_CHROME && managedPolicies().length > 0;
  return { path: c, pinned: isPinned, managed, label: isPinned ? 'Chrome for Testing' : path.basename(c) };
}

/** The Desk's browser (browser.json) as a process mark: its command line names its own throwaway profile. */
const browserMark = (b) => `--user-data-dir=${b && b.profile}`;

/**
 * The Desk's browser closed, its profile removed (after it quits: Chrome writes on its way out). A browser.json whose
 * pid is now another program's is only forgotten; one ps can't vouch for is left as it is.
 */
async function closeBrowser(p = placesOf()) {
  const b = readJson(p.browser);
  if (!b) return false;
  const who = whose(b.pid, browserMark(b));
  if (who === 'unknown') return false;
  const was = who === 'ours' ? await endProcess(b.pid, browserMark(b)) : false;
  removeProfile(b.profile);
  fs.rmSync(p.browser, { force: true });
  return was;
}

/** Open `url` in the Desk's browser: a new window in the one already open for this Desk, else a fresh one. */
async function openWindow(url, st, p = placesOf()) {
  const chrome = deskChrome();
  if (!chrome) throw new Error('There\'s no Chrome on this Mac: `flpt-setup --install-tools` installs FLPT\'s pinned Chrome for Testing.');
  if (chrome.managed) throw new Error('This Mac\'s Chrome is managed (its policies can set their own proxy): `flpt-setup --install-tools` installs FLPT\'s pinned Chrome for Testing.');
  const b = readJson(p.browser);
  const reuse = Boolean(b && b.port === st.port && b.chrome === chrome.path && exists(b.profile) && whose(b.pid, browserMark(b)) === 'ours');
  if (b && !reuse) await closeBrowser(p);
  const profile = reuse ? b.profile : freshProfile();
  const child = spawn(chrome.path, chromeArgs({ port: st.port, previewPort: st.previewPort, profile, url }), { detached: true, stdio: 'ignore', cwd: os.tmpdir(), env: deskEnv() });
  child.on('error', () => {});
  child.unref();
  if (!reuse) writeJson(p.browser, { pid: child.pid, profile, port: st.port, chrome: chrome.path, opened: new Date().toISOString() });
  return { chrome, reused: reuse, pid: reuse ? b.pid : child.pid };
}

// ── the Desk's process ────────────────────────────────────────────────────────────────────────────────────────────────

/** Does the Desk in `st` answer? (its contract, on its own Host) */
function healthy(st) {
  return new Promise((resolve) => {
    if (!st || !Number.isInteger(st.port)) { resolve(false); return; }
    const req = http.get({ host: '127.0.0.1', port: st.port, path: '/api/contract', headers: { host: `127.0.0.1:${st.port}` }, timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/** The running Desk's state ({ pid, url, port, previewPort, started }), or null. */
async function running(p = placesOf()) {
  const st = readJson(p.state);
  return st && alive(st.pid) && (await healthy(st)) ? st : null;
}

/** The launch token (the Desk's state holds it in its URL's fragment) and the Desk's base address. */
function addressOf(st) {
  const m = /^(http:\/\/127\.0\.0\.1:\d+)\/#k=([A-Za-z0-9_-]{20,128})$/.exec(String(st && st.url));
  if (!m) throw new Error('The Desk\'s state is unreadable: run `flpt-desk stop`, then open it again.');
  return { base: m[1], launch: m[2] };
}

/**
 * The environment the Desk and its browser run in: an allowlist (Claude Code's own environment holds more than the
 * Desk needs), and nothing in it shaped like a key.
 */
const DESK_ENV = /^(PATH|HOME|USER|LOGNAME|SHELL|LANG|LC_[A-Z]+|TZ|TMPDIR|XDG_(CACHE|CONFIG|DATA|RUNTIME)_(HOME|DIR)|FLPT_[A-Z0-9_]+|AVATAR_PRESENTATION_CONFIG_DIR|HYPERFRAMES_BROWSER_PATH|CLAUDE_PLUGIN_ROOT)$/;
function deskEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (DESK_ENV.test(k) && !isSecret(k)) env[k] = v;
  return env;
}

/** A link in this Mac's own browser: FLPT_DESK_BROWSER (a program: QA's stand-in), else open (macOS) or xdg-open. */
function openLink(url) {
  const prog = process.env.FLPT_DESK_BROWSER || (process.platform === 'darwin' ? '/usr/bin/open' : process.platform === 'linux' ? 'xdg-open' : null);
  if (!prog) return Promise.reject(new Error(CHAT));
  return new Promise((resolve, reject) => {
    const child = spawn(prog, [url], { detached: true, stdio: 'ignore', env: deskEnv() });
    child.on('error', () => reject(new Error('This Mac\'s browser didn\'t open.')));
    child.on('spawn', () => { child.unref(); resolve(); });
  });
}

/** Start the Desk (detached: it outlives this command) and wait for it to answer. */
async function startDesk({ localMedia = false } = {}, p = placesOf()) {
  fs.mkdirSync(p.home, { recursive: true, mode: 0o700 });
  const old = readJson(p.state);
  if (old) await endProcess(old.pid, SERVE_MARK); // a Desk that stopped answering; a pid that's no longer one is left be
  fs.rmSync(p.state, { force: true });
  const log = fs.openSync(p.log, 'a', 0o600);
  const child = spawn(process.execPath, [__filename, 'serve', ...(localMedia ? ['--local-media'] : [])], { detached: true, stdio: ['ignore', 'ignore', log], env: deskEnv(), cwd: p.home });
  fs.closeSync(log);
  let exited = null;
  child.on('exit', (code) => { exited = code; });
  child.unref();
  const t0 = Date.now();
  while (Date.now() - t0 < 30000 && exited === null) {
    const st = readJson(p.state);
    if (st && st.pid === child.pid && (await healthy(st))) return st;
    await sleep(150);
  }
  let tail = '';
  try { tail = fs.readFileSync(p.log, 'utf8').trim().split('\n').slice(-3).join(' · '); } catch { /* no log */ }
  throw new Error(`The Desk didn't start${tail ? `: ${clean(tail, 300)}` : ''}.`);
}

/** The Desk's own preferences (its profile, never the Mac app's): the plugin's folders, Setup done. */
function prepareProfile(coreDir, p) {
  fs.mkdirSync(p.profile, { recursive: true, mode: 0o700 });
  const pl = places();
  require(path.join(coreDir, 'settings.js')).createSettings({ dir: p.profile }).write({
    projectsDir: pl.projects, deliverablesDir: pl.deliverables, libraryDir: pl.library, seenWelcome: true, setupComplete: true, toolchainMode: 'system',
  });
  return pl;
}

/** One line in the Desk's journal (what the user did in it, for `wait`): mode 0600, one JSON object a line. */
function journalOf(file) {
  return (x) => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      fs.appendFileSync(file, `${JSON.stringify({ at: Date.now(), ...x })}\n`, { mode: 0o600 });
    } catch { /* the Desk goes on */ }
  };
}

/**
 * The Desk's rules on top of flpt-server's desk host (W4-01's host-desk.js: no keys, no approvals, nothing paid):
 *   caps          + preview: 'local'
 *   overrides     a crew's or the pipeline's run: "Runs in Claude Code." (a Live Motion piece's Ask for changes is
 *                 noted for `wait` first); the storyboard approved as flpt-storyboard approves it (no Claude top-up:
 *                 Claude Code's own account), Let FLPT play jazz approving it as Jazz without playing (chat plays
 *                 it); the Gallery's pick mode and Use noted for `wait`; a piece's approval noted; an inspiration
 *                 place opened in this Mac's own browser
 *   galleryHost   the Style Gallery's pick mode, kept here (the Gallery is a page of the Desk's, not a window of its own)
 *   media         the shipped styles' posters and loops: `mediaRoot` (rendered here), served through /files
 * → { renderMissing(), applyPick({ episode, shot }), pick() }
 */
function layer(s, { journal, mediaRoot = null, render = null, log = () => {} } = {}) {
  const core = s.dirs.core;
  const R = (m) => require(path.join(core, m));
  const episode = R('episode.js');
  const plan = R('ext/storyboard.js');
  const galleryApi = R('api/gallery.js');
  const lmApi = R('api/livemotion.js');
  const host = s.host;
  const api = host.api;
  const note = journalOf(journal);

  // an installed plugin's folder is named flpt, not engine: the calls' engine root is the plugin itself (the core's
  // services work theirs out as <resources>/engine, which only holds in a checkout of FLPT)
  if (host.engineDir && api.engineRoot !== host.engineDir) api.engineRoot = host.engineDir;

  const deskCaps = host.caps;
  const caps = () => ({ ...deskCaps(), preview: 'local' });
  api.caps = caps;
  host.caps = caps;

  if (mediaRoot) {
    fs.mkdirSync(mediaRoot, { recursive: true, mode: 0o700 });
    api.stylesMediaRoot = mediaRoot;
    const roots = host.fileRoots;
    host.fileRoots = () => [...roots(), mediaRoot];
  }

  // ── the pictures an installed plugin doesn't carry (its marketplace build ships no media: the app's module tiles, its
  // pony mark): one missing under the screens' assets/ answers as an empty picture, never a broken one. Everything else
  // is flpt-server's, as it was (its Host guard first: an unknown Host goes on to it, and it says no).
  const rendererDir = s.dirs.renderer;
  if (rendererDir && !exists(path.join(rendererDir, 'assets', 'pony-mark.png')) && s.server && s.port) {
    const own = s.server.listeners('request');
    const hosts = new Set([`127.0.0.1:${s.port}`, `localhost:${s.port}`, `[::1]:${s.port}`]);
    let root = null;
    try { root = fs.realpathSync(rendererDir); } catch { root = null; }
    s.server.removeAllListeners('request');
    s.server.on('request', (req, res) => {
      let p = '';
      try { p = decodeURIComponent(new URL(req.url, 'http://desk.invalid').pathname); } catch { p = ''; }
      const picture = root && ['GET', 'HEAD'].includes(req.method) && hosts.has(String(req.headers.host || '').toLowerCase())
        && /^\/assets\/[\w./-]+\.(png|jpe?g|webp|gif)$/i.test(p) && !p.includes('..') && !exists(path.join(root, p));
      if (!picture) { for (const fn of own) fn.call(s.server, req, res); return; }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(BLANK_PNG.length), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' });
      res.end(req.method === 'HEAD' ? undefined : BLANK_PNG);
    });
  }

  // ── the Style Gallery's pick mode ──
  let pick = null;
  const state = () => ({ pick: pick ? { ...pick } : null });
  api.galleryHost = {
    open(o = {}) { if (o && Object.prototype.hasOwnProperty.call(o, 'pick')) this.setPick(o.pick || null); return true; },
    setPick(p) {
      pick = p ? { episode: p.episode, shot: p.shot, label: p.label, current: p.current || null } : null;
      api.send('gallery:state', state());
    },
    pick: () => (pick ? { ...pick } : null),
    broadcast: (channel, x) => api.send(channel, x),
  };

  const dirOf = (c, dir) => {
    if (!c.flow || !c.flow.inProjects(dir)) throw new Error('That isn\'t an FLPT episode folder.');
    const d = path.resolve(dir);
    const why = episode.tooNew(episode.readRaw(d));
    if (why) throw new Error(why);
    return d;
  };
  const capsOf = (c) => plan.capsFor({ caps: typeof c.caps === 'function' ? c.caps() : null, vault: c.vault, settings: c.settings });

  /** The storyboard approved as flpt-storyboard approves it (the plugin's rule: no Claude top-up). */
  function approvePlan(c, dir, mode) {
    const d = dirOf(c, dir);
    if (mode !== 'jazz' && mode !== 'directed') throw new Error('Jazz or directed.');
    plan.readyForApproval(episode, d);
    plan.reviewable(episode, d);
    c.flow.approve(d, 'storyboard', { by: 'you' });
    plan.recordMode(episode, d, mode);
    try { c.send('storyboard:changed', { dir: d }); } catch { /* no page */ }
    note({ t: 'approved', episode: d, mode });
    return { d, value: { ok: true, usd: 0, view: plan.viewFor(episode, d, capsOf(c)) } };
  }

  const O = host.overrides;
  for (const k of CHAT_METHODS) O[k] = async () => { throw new Error(CHAT); };
  // a piece's Ask for changes (or Make all) is noted for `wait`, after the app's own checks (api/livemotion.js run):
  // the piece, Live Motion not approved yet (its pieces stay as approved), and no crew at work on this episode
  const lm = R('livemotion.js');
  O['livemotion.run'] = async (c, dir, key, notes) => {
    const d = dirOf(c, dir);
    const k = key == null || key === '' ? null : key;
    if (k !== null && (typeof k !== 'string' || !lm.KEY.test(k))) throw new Error('That isn\'t a Live Motion piece.');
    const st = episode.read(d);
    if (st && st.stages && st.stages.animate && st.stages.animate.status === 'approved') throw new Error('Live Motion is approved.');
    if (k !== null) lm.pieceOf(d, k);
    let lock = null;
    try { lock = require('./flpt-scene').readLock(); } catch { lock = null; }
    if (lock && sameDir(lock.episode, d)) throw new Error('The scene crews are at work.');
    note({ t: 'asked', episode: d, key: k, notes: clean(notes, 2000) });
    throw new Error(CHAT);
  };
  // the Gallery's inspiration places: FLPT's own list (by id, never a page's address), in this Mac's own browser (the
  // Desk's window reaches nothing but the Desk)
  O['styles.openLink'] = async (c, id) => {
    const l = R('api/styles.js').repoFor(c).inspiration().links.find((x) => x.id === id);
    let u = null;
    try { u = l ? new URL(l.url) : null; } catch { u = null; }
    if (!u || u.protocol !== 'https:') throw new Error('That place isn\'t on the list.');
    await openLink(u.href);
    return true;
  };
  O['storyboard.approve'] = async (c, dir, mode) => approvePlan(c, dir, mode).value;
  O['episode.approve'] = async (c, dir, stage) => {
    if (CHAT_STAGES.includes(stage)) throw new Error(CHAT);
    return c.flow.approve(dir, stage); // as api/legacy-episodes.js's approve
  };
  O['jazz.approve'] = async (c, dir) => {
    const { d, value } = approvePlan(c, dir, 'jazz');
    let jazz = null;
    try { jazz = c.flow.jazzView(d); } catch { jazz = null; }
    return { ...value, jazz };
  };
  O['livemotion.approve'] = async (c, dir, key) => {
    const v = lmApi.methods.approve.handler(c, dir, key);
    note({ t: 'scene-approved', episode: dirOf(c, dir), key: clean(key, 80) });
    return v;
  };
  // the page holds an episode as its ref, inside the spec: a ref goes back to its folder, anything else is refused
  O['gallery.open'] = async (c, spec) => {
    let o = spec;
    if (o && typeof o === 'object' && o.episode != null) {
      const d = s.refs.fromPage(o.episode);
      if (!d) throw new Error('That isn\'t an FLPT episode folder.');
      o = { ...o, episode: d };
    }
    renderMissing();
    const st = galleryApi.methods.open.handler(c, o);
    try { const { base, launch } = addressOf({ url: s.url }); await c.os.openExternal(`${base}/gallery.html#k=${launch}`); } catch { /* the page stays as it is */ }
    return st;
  };
  O['gallery.use'] = async (c, key, dir) => {
    const r = galleryApi.methods.use.handler(c, key, dir);
    note({ t: 'picked', episode: r.episode, shot: r.shot || null, style: r.style, name: r.name });
    return r;
  };
  O['gallery.forShot'] = async (c, dir, shot) => { renderMissing(); return galleryApi.methods.forShot.handler(c, dir, shot); };
  const stylesApi = R('api/styles.js');
  O['styles.list'] = async (c) => { renderMissing(); return stylesApi.methods.list.handler(c); };

  // ── previews: the shipped styles' posters and loops, rendered here when the Gallery first needs them ──
  let rendering = null;
  const tried = new Set(); // each style once a Desk: one that didn't render isn't tried again on every list
  let noTools = false;
  function renderMissing() {
    if (!mediaRoot || rendering || render === 'none' || noTools) return rendering;
    rendering = (async () => {
      let env;
      try { env = require('./flpt-scene').liveEnv(); } catch { env = null; }
      if (!env || !env.FLPT_HYPERFRAMES) { noTools = true; log('desk: no HyperFrames here, so the posters wait (flpt-setup --install-tools)'); return; }
      const styles = R('styles.js');
      const repo = styles.createStyles({ engineRoot: host.engineDir, projectsDir: places().projects, mediaRoot, env, toolchain: require('./common').toolchainId() });
      const only = render && render !== 'all' ? new Set(String(render).split(',')) : null;
      for (const rec of repo.list('shipped')) {
        if (!rec.ok || (only && !only.has(rec.id)) || tried.has(rec.id)) continue;
        if (['poster.jpg', 'loop.mp4'].every((f) => exists(path.join(mediaRoot, rec.id, f)))) continue;
        tried.add(rec.id);
        const t0 = Date.now();
        try {
          await repo.renderMedia(rec.id, { toShipped: true });
          log(`desk: ${rec.id}'s poster and loop rendered (${Math.round((Date.now() - t0) / 1000)} s)`);
          api.send('styles:changed', { media: rec.id });
        } catch (e) { log(`desk: ${rec.id}'s poster and loop didn't render: ${clean(e && e.message, 300)}`); }
      }
    })().finally(() => { rendering = null; });
    return rendering;
  }

  /** Pick mode for one shot, as the inspector's STYLE slot asks it (flpt-desk open --styles --shot). */
  function applyPick({ episode: dir, shot }) {
    if (!SHOT.test(String(shot))) throw new Error('That isn\'t a shot.');
    const c = Object.create(api);
    const d = dirOf(c, dir);
    renderMissing();
    return galleryApi.methods.open.handler(c, { episode: d, shot });
  }

  return { renderMissing, applyPick, pick: () => pick, note };
}

/**
 * The Desk in this process: flpt-server --mode desk on the plugin's folders, its rules (layer), the control file and the
 * window's browser watched (once it quits, the Desk stops). `serve` runs it as the Desk's own process; QA runs it in
 * its own. → { s (the server), desk (the layer's), stop(why) }
 * @param {object} o  localMedia (render the shipped posters here even in a checkout of FLPT), render ('all', 'none' or
 *                    ids), log, exit (stop the process once stopped: serve)
 */
async function runDesk({ localMedia = false, render = process.env.FLPT_DESK_RENDER || 'all', log = () => {}, exit = false } = {}, p = placesOf()) {
  fs.mkdirSync(p.home, { recursive: true, mode: 0o700 });
  const server = require('./server/server.js');
  const coreDir = server.coreDirs().core;
  const pl = prepareProfile(coreDir, p);
  // the journal keeps what `wait` may still need: its last 200 lines once it passes 256 KB
  try {
    if (fs.statSync(p.journal).size > 256 * 1024) writeJsonl(p.journal, fs.readFileSync(p.journal, 'utf8').split('\n').filter(Boolean).slice(-200));
  } catch { /* none yet */ }
  let s = null;
  let closing = null;
  const timers = [];
  function stop(why) {
    if (!closing) {
      closing = (async () => {
        log(`desk: stopping (${why})`);
        for (const t of timers) clearInterval(t);
        try { await closeBrowser(p); } catch { /* gone */ }
        try { if (s) await s.close(); } catch { /* gone */ }
        if (exit) process.exit(0);
      })();
    }
    return closing;
  }
  s = await server.start({ mode: 'desk', userData: p.profile, projects: pl.projects, deliverables: pl.deliverables, state: p.state, onIdle: () => stop('idle'), log });
  // the shipped media: the app's own in a checkout of FLPT (app/assets/styles), else rendered here
  const shipped = (() => { try { return require(path.join(coreDir, 'styles.js')).shippedMediaRoot({ isPackaged: false }); } catch { return null; } })();
  const local = localMedia || !shipped;
  const desk = layer(s, { journal: p.journal, mediaRoot: local ? p.media : null, render, log });
  log(`desk: on ${s.base} (previews on ${s.preview.port}), ${local ? 'posters rendered here' : 'the app\'s posters'}`);

  // the control file: what `flpt-desk open --styles --shot` asks of a Desk that's already up
  timers.push(setInterval(() => {
    const c = readJson(p.control);
    if (!c) return;
    fs.rmSync(p.control, { force: true });
    let ack;
    try {
      if (c.pick) desk.applyPick(c.pick);
      ack = { id: c.id, ok: true };
    } catch (e) { ack = { id: c.id, ok: false, error: clean(e && e.message, 300) }; }
    writeJson(p.ack, ack);
  }, 250));
  // the window: once the browser the Desk was opened in quits, the Desk stops too
  let gone = 0;
  timers.push(setInterval(() => {
    const b = readJson(p.browser);
    if (!b || b.port !== s.port) { gone = 0; return; }
    gone = alive(b.pid) ? 0 : gone + 1;
    if (gone >= 3) stop('the window closed');
  }, 1000));
  for (const t of timers) t.unref();
  return { s, desk, stop };
}

/** The Desk's own process (`open` starts it detached): runDesk until it's stopped. */
async function serve(values) {
  const log = (line) => { try { process.stderr.write(`${new Date().toISOString()} ${line}\n`); } catch { /* no log */ } };
  const d = await runDesk({ localMedia: values['local-media'] === true, log, exit: true });
  process.on('SIGTERM', () => d.stop('stop'));
  process.on('SIGINT', () => d.stop('stop'));
  await new Promise(() => {}); // until stopped
}

// ── the commands ────────────────────────────────────────────────────────────────────────────────────────────────────

/** An episode the Desk can show: in the projects folder (one or two levels down). */
function deskEpisode(arg) {
  const dir = episodeDir(arg);
  const root = path.resolve(places().projects);
  const rel = path.relative(root, dir);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).length > 2) throw new Error(`The Desk shows the episodes in ${root}.`);
  return dir;
}

/** Ask the running Desk to do something (the control file) and wait for its answer. */
async function control(ask, p = placesOf()) {
  const id = crypto.randomBytes(8).toString('hex');
  fs.rmSync(p.ack, { force: true });
  writeJson(p.control, { id, ...ask });
  for (let i = 0; i < 60; i += 1) {
    const a = readJson(p.ack);
    if (a && a.id === id) { fs.rmSync(p.ack, { force: true }); if (!a.ok) throw new Error(a.error || 'The Desk said no.'); return a; }
    await sleep(100);
  }
  throw new Error('The Desk didn\'t answer.');
}

async function cmdOpen(values, rest) {
  if (values.shot && !values.styles) throw Object.assign(new Error('--shot goes with --styles.'), { usage: true });
  if (values.shot && !SHOT.test(values.shot)) throw Object.assign(new Error('A shot is s1, s2 …'), { usage: true });
  const dir = rest[0] || values.shot ? deskEpisode(rest[0]) : null;
  const p = placesOf();
  let st = await running(p);
  const started = !st;
  if (!st) st = await startDesk({ localMedia: values['local-media'] === true }, p);
  const { base, launch } = addressOf(st);
  if (values.shot) await control({ pick: { episode: dir, shot: values.shot } }, p);
  const view = values.styles ? 'gallery.html' : '';
  const where = values.styles ? (values.shot ? `the Style Gallery, picking ${values.shot}'s style` : 'the Style Gallery') : 'the episodes';
  if (values['no-window']) {
    say(`The Desk: ${base}/${view} (${started ? 'started' : 'already open'}; no window).`);
    return 0;
  }
  const w = await openWindow(`${base}/${view}#k=${launch}`, st, p);
  say(`The Desk is open on ${where}: ${base}/ in ${w.chrome.label}, a throwaway profile; it reaches only the Desk.`);
  if (dir) say(`Episode: ${dir}`);
  if (!w.chrome.pinned && !process.env.FLPT_CHROME) say('(FLPT\'s pinned Chrome for Testing isn\'t installed: `flpt-setup --install-tools` installs it.)');
  return 0;
}

/** What the user has done since `from` (byte offset) in the Desk's journal. */
function journalSince(file, from) {
  let buf;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      if (size <= from) return { lines: [], at: from };
      buf = Buffer.alloc(size - from);
      fs.readSync(fd, buf, 0, buf.length, from);
    } finally { fs.closeSync(fd); }
  } catch { return { lines: [], at: from }; }
  const text = buf.toString('utf8');
  const end = text.lastIndexOf('\n') + 1; // only whole lines
  const lines = text.slice(0, end).split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return { lines, at: from + Buffer.byteLength(text.slice(0, end)) };
}

const sameDir = (a, b) => { try { return fs.realpathSync(a) === fs.realpathSync(b); } catch { return path.resolve(String(a)) === path.resolve(String(b)); } };

/** The condition `wait` waits for, as a check: () → the line to say once it holds, or null. */
function conditionOf(until, dir, { shot = null, piece = null } = {}) {
  const episode = app('episode');
  const storyboard = app('storyboard');
  if (until === 'storyboard-approved') {
    return () => {
      const st = episode.read(dir);
      const s = st && st.stages && st.stages.storyboard;
      if (!s || s.status !== 'approved' || s.skipped) return null;
      const mode = s.mode || ((storyboard.read(dir) || {}).mode);
      return `The plan is approved: ${mode === 'jazz' ? 'Let FLPT play jazz' : 'User directed'}.`;
    };
  }
  if (until === 'style-picked') {
    const styleOf = () => {
      const b = storyboard.read(dir);
      if (!b) return null;
      return shot ? ((b.shots || []).find((x) => x.id === shot) || {}).style || null : JSON.stringify([b.defaults && b.defaults.style, (b.shots || []).map((x) => [x.id, x.style || null])]);
    };
    const before = styleOf();
    return (picked) => {
      const hit = picked.find((x) => x.t === 'picked' && sameDir(x.episode, dir) && (!shot || x.shot === shot));
      if (hit) return `${hit.shot ? `${hit.shot} is` : 'The episode is'} drawn in ${clean(hit.name, 40) || hit.style}.`;
      const now = styleOf();
      if (now !== before) return shot ? `${shot} is drawn in ${now || 'its default style'}.` : 'A style was picked on the storyboard.';
      return null;
    };
  }
  const livemotion = app('livemotion');
  return (asked) => {
    const ask = asked.find((x) => x.t === 'asked' && sameDir(x.episode, dir) && (!piece || !x.key || x.key === piece));
    if (ask) return !ask.key ? 'Every piece asked to be made.' : ask.notes ? `Changes asked for ${ask.key}: ${ask.notes}` : `${ask.key} asked to be made again.`;
    let v;
    try { v = livemotion.view(dir); } catch { return null; }
    const pieces = Array.isArray(v) ? v : (v && v.pieces) || [];
    if (piece) {
      const one = pieces.find((x) => x.key === piece);
      if (!one) throw new Error(`There's no Live Motion piece ${clean(piece, 80)} in this episode.`);
      return one.approved ? `${one.key} is approved.` : null;
    }
    const st = episode.read(dir);
    if (st && st.stages && st.stages.animate && st.stages.animate.status === 'approved') return 'Live Motion is approved.';
    const made = pieces.filter((x) => x.status === 'ok' || x.status === 'stale');
    return made.length && pieces.length && made.length === pieces.length && made.every((x) => x.approved) ? 'Every Live Motion piece is approved.' : null;
  };
}

async function cmdWait(values, rest) {
  const until = values.until;
  if (!UNTIL.includes(until)) throw Object.assign(new Error(`--until is ${UNTIL.join(', ')}.`), { usage: true });
  if (values.shot && (until !== 'style-picked' || !SHOT.test(values.shot))) throw Object.assign(new Error('--shot (s1, s2 …) goes with --until style-picked.'), { usage: true });
  if (values.piece && until !== 'scene-approved') throw Object.assign(new Error('--piece goes with --until scene-approved.'), { usage: true });
  const minutes = values.minutes == null ? WAIT_MINUTES : Number(values.minutes);
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 240) throw Object.assign(new Error('--minutes is between 1 and 240.'), { usage: true });
  const dir = deskEpisode(rest[0]);
  const p = placesOf();
  let at = 0;
  try { at = fs.statSync(p.journal).size; } catch { at = 0; }
  const check = conditionOf(until, dir, { shot: values.shot || null, piece: values.piece || null });
  const end = Date.now() + minutes * 60000;
  const seen = [];
  const desk = (readJson(p.state) || {}).pid;
  for (;;) {
    const j = journalSince(p.journal, at);
    at = j.at;
    seen.push(...j.lines);
    const line = check(seen);
    if (line) { say(line); return 0; }
    const st = readJson(p.state);
    if (!st || st.pid !== desk || !alive(st.pid)) { say('The Desk isn\'t open.'); return 1; }
    const b = readJson(p.browser);
    if (b && b.port === st.port && !alive(b.pid)) { await sleep(1500); if (!alive(b.pid)) { say('The Desk\'s window was closed.'); return 1; } }
    if (Date.now() > end) { say(`Not yet, after ${minutes} minute${minutes === 1 ? '' : 's'}.`); return 1; }
    await sleep(400);
  }
}

async function cmdStop() {
  const p = placesOf();
  const st = readJson(p.state);
  let was = false;
  // its pid is the Desk's while that Desk answers on its port, or while ps finds the Desk in its command line
  if (st && alive(st.pid) && ((await healthy(st)) || whose(st.pid, SERVE_MARK) === 'ours')) {
    was = true;
    try { process.kill(st.pid, 'SIGTERM'); } catch { /* gone */ }
    for (let i = 0; i < 50 && alive(st.pid); i += 1) await sleep(100);
    if (whose(st.pid, SERVE_MARK) === 'ours') { try { process.kill(st.pid, 'SIGKILL'); } catch { /* gone */ } }
  }
  const window = await closeBrowser(p);
  fs.rmSync(p.state, { force: true });
  for (const f of [p.control, p.ack]) fs.rmSync(f, { force: true });
  say(was || window ? 'The Desk is closed.' : 'The Desk wasn\'t open.');
  return 0;
}

async function cmdStatus() {
  const p = placesOf();
  const st = await running(p);
  if (!st) { say('The Desk isn\'t open.'); return 0; }
  const b = readJson(p.browser);
  const win = b && b.port === st.port && alive(b.pid);
  const since = Number.isFinite(Date.parse(st.started)) ? new Date(st.started).toTimeString().slice(0, 5) : '';
  say(`The Desk is open: http://127.0.0.1:${st.port}/${since ? ` since ${since}` : ''}${win ? ', in its window' : ', with no window'}.`);
  return 0;
}

async function run() {
  const { values, positionals } = cli(USAGE, OPTIONS);
  const [cmd, ...rest] = positionals;
  if (cmd === 'serve') return serve(values);
  if (!COMMANDS.includes(cmd)) return usageError(USAGE, cmd ? `Unknown command: ${cmd}` : '');
  try {
    if (cmd === 'open') return await cmdOpen(values, rest);
    if (cmd === 'wait') return await cmdWait(values, rest);
    if (cmd === 'stop') return await cmdStop();
    return await cmdStatus();
  } catch (e) {
    if (e.usage) usageError(USAGE, e.message);
    throw e;
  }
}

if (require.main === module) main(run);

module.exports = { chromeArgs, PREFERENCES, CHAT, CHAT_METHODS, CHAT_STAGES, DEAD_PROXY, UNTIL, layer, runDesk, placesOf, prepareProfile, journalOf, conditionOf, journalSince, deskChrome,
  removeProfile, freshProfile, addressOf, deskEnv, whose, managedPolicies, ROOT };
