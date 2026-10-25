#!/usr/bin/env node
'use strict';
// flpt-server (PLAN §2.2, §2.13; W4-01): the app's screens and core over HTTP, for a browser instead of Electron. One
// program, three uses:
//   --mode local   the full UI in a Chrome tab on this Mac, on a scratch profile: stand-in keys only, nothing paid
//                  (hosts/host-local.js). The web UI's QA (qa/local-free-draft.sh) and .claude/launch.json's
//                  flpt-server-local run it.
//   --mode desk    the plugin's Desk (hosts/host-desk.js, desk.js): the plugin's own folders, no approvals, no keys,
//                  a second loopback port for preview frames, and it stops after 30 idle minutes. W4-02's flpt-desk runs it.
//   --mode web     inside the web container, behind the Worker: its host is web/container/host-web.js (W4-04).
//
//   node engine/tools/server/server.js --mode local [--port 0] [--user-data <dir>] [--projects <dir>]
//        [--deliverables <dir>] [--key NAME=<stand-in>]… [--trust-loopback] [--state <file>] [--no-library]
//   node engine/tools/server/server.js --version     its version (package.json here: in lockstep with the app, the
//                                                    plugin and the Worker; tools/release/bump.mjs)
//
// When it's up it prints one JSON line: { ready, mode, url, port, userData, projects, previewPort? }. `url` carries
// the launch token in its fragment (#k=…), which the page swaps for a session; nothing is kept in a cookie. Ctrl-C (or
// SIGTERM) stops it. The core comes from the app (app/src/main and app/src/renderer) when this runs from the repo,
// else from the plugin's copies (engine/tools/lib).

const fs = require('fs');
const path = require('path');
const { parseArgs } = require('util');

const { createHttp } = require('./http');

const REPO = path.resolve(__dirname, '..', '..', '..');
const VERSION = require('./package.json').version;

/** Where the core and the screens are: the app's own (the repo, the web image), else the plugin's copies. */
function coreDirs() {
  const app = path.join(REPO, 'app', 'src');
  if (fs.existsSync(path.join(app, 'main', 'bridge-contract.js')) && fs.existsSync(path.join(app, 'renderer', 'index.html'))) {
    return { core: path.join(app, 'main'), renderer: path.join(app, 'renderer') };
  }
  const lib = path.resolve(__dirname, '..', 'lib');
  return { core: path.join(lib, 'src', 'main'), renderer: path.join(lib, 'renderer') };
}

/** The web container's host (W4-04), or null when this tree has none yet. */
function webHost() {
  const p = path.join(REPO, 'web', 'container', 'host-web.js');
  return fs.existsSync(p) ? require(p) : null;
}

/**
 * Start a server: { url, port, base, launch, close(), refFor(dir), host, preview? }.
 * @param {object} o  mode, port, userData, projects, deliverables, keys ({ NAME: stand-in }), trustLoopback,
 *                    library (false: no Library host), hosts (extra Host names), log, core/renderer (tests)
 */
async function start(o = {}) {
  const mode = o.mode || 'local';
  if (!['local', 'desk', 'web'].includes(mode)) throw new Error(`unknown mode: ${mode}`);
  const dirs = { ...coreDirs(), ...(o.core ? { core: o.core } : {}), ...(o.renderer ? { renderer: o.renderer } : {}) };
  const { discover } = require(path.join(dirs.core, 'bridge-contract.js'));
  const validate = require(path.join(dirs.core, 'validate.js'));
  const contract = discover(path.join(dirs.core, 'api'));
  const userData = path.resolve(o.userData || fs.mkdtempSync(path.join(require('os').tmpdir(), `flpt-server-${mode}-`)));
  fs.mkdirSync(userData, { recursive: true, mode: 0o700 });

  let makeHost;
  if (mode === 'web') {
    const w = webHost();
    if (!w || typeof w.createWebHost !== 'function') throw new Error('web mode runs in the web container (web/container/host-web.js, W4-04)');
    makeHost = (x) => w.createWebHost({ ...o, ...x, core: dirs.core, userData });
  } else {
    const { createLocalHost } = require('./hosts/host-local');
    const { createDeskHost } = require('./hosts/host-desk');
    const make = mode === 'desk' ? createDeskHost : createLocalHost;
    makeHost = (x) => make({ core: dirs.core, userData, projects: o.projects, deliverables: o.deliverables, keys: o.keys || {}, library: o.library, engine: o.engine, ...x });
  }

  let idle = null;
  const srv = await createHttp({
    mode, contract, validate, renderer: dirs.renderer, uploadsDir: path.join(userData, 'uploads'), makeHost,
    bind: mode === 'web' ? (o.bind || '0.0.0.0') : '127.0.0.1', port: o.port || 0, hosts: o.hosts || [],
    trustLoopback: mode === 'local' && o.trustLoopback === true, log: o.log || ((s) => process.stderr.write(`${s}\n`)),
    onRequest: () => { if (idle) idle.touch(); },
  });

  let preview = null;
  if (mode === 'desk') {
    const desk = require('./desk');
    preview = desk.createPreview({ appOrigin: srv.base });
    await preview.start(0);
    idle = desk.createIdle({ ms: o.idleMs || desk.IDLE_MS, onIdle: () => { if (o.onIdle) o.onIdle(); else stop(); } });
  }
  async function stop() {
    if (idle) idle.stop();
    if (preview) await preview.close();
    await srv.close();
    if (o.state) { try { fs.rmSync(o.state, { force: true }); } catch { /* gone */ } }
  }
  const out = { ...srv, close: stop, preview, userData, projects: srv.host.projectsDir(), dirs };
  if (o.state) require('./desk').writeState(o.state, { pid: process.pid, mode, url: srv.url, port: srv.port, previewPort: preview ? preview.port : null, started: new Date().toISOString() });
  return out;
}

function parseKeys(list) {
  const keys = {};
  for (const kv of list || []) {
    const i = String(kv).indexOf('=');
    if (i > 0) keys[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return keys;
}

async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv, strict: true, options: {
      mode: { type: 'string', default: 'local' }, port: { type: 'string', default: '0' }, 'user-data': { type: 'string' }, projects: { type: 'string' },
      deliverables: { type: 'string' }, key: { type: 'string', multiple: true }, 'trust-loopback': { type: 'boolean', default: false },
      state: { type: 'string' }, 'no-library': { type: 'boolean', default: false }, host: { type: 'string', multiple: true },
      version: { type: 'boolean', default: false },
    },
  });
  if (values.version) { process.stdout.write(`flpt-server ${VERSION}\n`); return null; }
  const s = await start({
    mode: values.mode, port: Number(values.port) || 0, userData: values['user-data'], projects: values.projects, deliverables: values.deliverables,
    keys: parseKeys(values.key), trustLoopback: values['trust-loopback'], state: values.state, library: values['no-library'] ? false : undefined, hosts: values.host || [],
    onIdle: () => { s.close().then(() => process.exit(0)); },
  });
  process.stdout.write(`${JSON.stringify({ ready: true, mode: s.mode, url: s.url, port: s.port, userData: s.userData, projects: s.projects, previewPort: s.preview ? s.preview.port : null })}\n`);
  const bye = () => { s.close().then(() => process.exit(0), () => process.exit(1)); };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
  return s;
}

if (require.main === module) {
  main().catch((e) => { process.stderr.write(`flpt-server: ${e.message}\n`); process.exit(2); });
}

module.exports = { start, main, coreDirs, parseKeys, VERSION };
