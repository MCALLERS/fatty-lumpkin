'use strict';
// hosts/host-local.js · flpt-server's host for --mode local (PLAN §2.2 host adapters, §2.16.7, review E4; W4-01): the
// app's own core (services.js: settings, broker, pipeline, the episode flow and every extension) on a scratch profile,
// with the shell's parts swapped for a browser's, so the real screens run in a Chrome tab with no Electron. It spends
// nothing and touches no real key:
//   - the vault is in memory and holds stand-in keys only (a value must say so: "dummy", "not-a-real-key" or
//     "test_…"); it never reads the Keychain (no safeStorage) or keys.env (Import is refused, and not offered)
//   - every paid kind is refused: the broker authorizes no spend for any provider, the pipeline's keyed and paid runs
//     (looks, check, final, the paid sample) answer "refused", generation (B-roll, Scenes' stills and shots) and Clippy
//     are refused, and fetch from this process reaches loopback only, so no provider is ever called
//   - approvals still go through the web's modal (approvals.js), so its flow can be seen and tested here; an approval
//     mints a budget, but nothing can be drawn on it
//   - the projects and deliverables folders are the scratch ones given (default: inside the profile)
// hosts/host-desk.js is this host with the Desk's rules (no approvals at all, no keys, the plugin's own folders).
// createLocalHost(o) → { api, caps(), fileRoots(), projectsDir(), overrides, services, close() }

const fs = require('fs');
const os = require('os');
const path = require('path');

const REFUSED = 'Local mode spends nothing.';
const STAND_IN = /dummy|not-a-real-key|^test[_-]/i;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** fetch for this process that reaches loopback only (what local mode's stand-ins listen on). Returns restore(). */
function loopbackOnlyFetch() {
  const real = globalThis.fetch;
  if (!real || real.flptLoopbackOnly) return () => {};
  const only = async (input, init) => {
    let host = '';
    try { host = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url).hostname.toLowerCase(); } catch { host = ''; }
    if (!LOOPBACK.has(host)) throw new TypeError(`fetch failed: ${REFUSED}`);
    return real(input, init);
  };
  only.flptLoopbackOnly = true;
  globalThis.fetch = only;
  return () => { if (globalThis.fetch === only) globalThis.fetch = real; };
}

/**
 * A vault in memory with the real one's methods and shape (vault.js), holding stand-in values only. `seed` puts
 * stand-ins in at start ({ NAME: value }); `allowSet: false` (the Desk) refuses every set.
 */
function memoryVault({ KEYS, ALIASES, requiredFor }, { seed = {}, allowSet = true, settings } = {}) {
  const held = new Map();
  const alias = (name) => Object.keys(ALIASES).find((k) => ALIASES[k] === name);
  const hint = (v) => (v && v.length > 8 ? `…${v.slice(-4)}` : '…');
  function set(name, value) {
    if (!Object.prototype.hasOwnProperty.call(KEYS, name)) throw new Error(`Unknown key name: ${name}`);
    const v = typeof value === 'string' ? value.trim() : '';
    if (!allowSet) throw new Error('Keys stay in the FLPT app.');
    if (v.length < 8 || v.length > 4096 || /\s/.test(v)) throw new Error('That doesn\'t look like a key. Paste the whole key, with no spaces.');
    if (!STAND_IN.test(v)) throw new Error('Local mode takes stand-in keys only.');
    held.set(name, v);
    return status()[name];
  }
  const get = (name) => held.get(name) || held.get(alias(name)) || null;
  const remove = (name) => { held.delete(name); const a = alias(name); if (a) held.delete(a); };
  function status(s) {
    let st = s;
    if (st === undefined) { try { st = settings ? settings.read() : null; } catch { st = null; } }
    const need = st ? new Set(requiredFor(st)) : null;
    const out = {};
    for (const [name, meta] of Object.entries(KEYS)) {
      const v = get(name);
      out[name] = { name, ...meta, ...(need ? { required: need.has(name) } : {}), set: Boolean(v), hint: v ? hint(v) : null };
    }
    return out;
  }
  const env = (names) => Object.fromEntries(names.map((n) => [n, get(n)]).filter(([, v]) => v));
  const allValues = () => [...held.values()];
  const importKeysEnv = () => { throw new Error('Nothing is imported in local mode.'); };
  for (const [k, v] of Object.entries(seed || {})) { try { set(k, v); } catch { /* not a stand-in: left out */ } }
  return { set, get, remove, status, env, allValues, importKeysEnv, available: () => true, file: null };
}

/** The Library and Transitions & Music as the Mac keeps them (library-ipc.js, addons-ipc.js), on a browser's parts. */
function shellHosts(core, { services, settings, userData, send }) {
  const have = (f) => fs.existsSync(path.join(core, f));
  const refuse = (what) => () => { throw new Error(what); };
  const noLibrary = { library: refuse('The Library is in the FLPT app.'), card: (x) => x, addPaths: refuse('The Library is in the FLPT app.'),
    clippyStatus: () => ({ ok: false, available: false }), runClip: refuse('Clippy is in the FLPT app.'), generator: refuse(REFUSED), running: {}, CUTAWAY_DIR: '' };
  const noAddons = { shelves: refuse('Transitions & Music are in the FLPT app.'), addPaths: refuse('Transitions & Music are in the FLPT app.'), addons: refuse('Transitions & Music are in the FLPT app.') };
  if (!have('library-ipc.js') || !have('addons-ipc.js')) return { libraryHost: noLibrary, addonsHost: noAddons, getLibrary: () => null, getAddons: () => null };
  const trash = path.join(userData, 'trash');
  const win = { isDestroyed: () => false, webContents: { send: (channel, payload) => send(channel, payload) } };
  const parts = {
    app: { on() {}, getPath: () => userData, isPackaged: false },
    BrowserWindow: { getAllWindows: () => [win], fromWebContents: () => null },
    shell: {
      // no Trash on a server: a removed item moves into the profile's own trash folder
      trashItem: async (p) => { fs.mkdirSync(trash, { recursive: true }); fs.renameSync(p, path.join(trash, `${Date.now()}-${path.basename(p)}`)); },
      openPath: async () => '', showItemInFolder: () => {}, openExternal: async () => {},
    },
    net: { fetch: (u, opts) => globalThis.fetch(u, opts) },
    nativeTheme: { shouldUseDarkColors: false },
    dialog: {},
  };
  const lib = require(path.join(core, 'library-ipc.js'));
  const add = require(path.join(core, 'addons-ipc.js'));
  const { addonsRoot } = require(path.join(core, 'paths.js'));
  const ensureTools = async () => services().lastDetect || services().detectTools();
  const libraryHost = lib.initLibrary({ ...parts, settings, toolEnv: () => services().toolEnv(), redact: (x) => services().redact(x), lastTools: () => services().lastDetect, ensureTools,
    getWin: () => null, toolchainDir: path.join(userData, 'toolchain'), manifestFile: path.join(core, 'toolchain-manifest.json'),
    vault: null, broker: null, userData, confirm: async () => false, providerBases: null, approvedBy: 'user' });
  const addonsHost = add.initAddons({ ...parts, settings, redact: (x) => services().redact(x), lastTools: () => services().lastDetect, ensureTools, getWin: () => null,
    shippedRoot: addonsRoot({ isPackaged: false }) });
  return { libraryHost, addonsHost, getLibrary: lib.getLibrary, getAddons: add.getAddons };
}

/**
 * @param {object} o
 * @param {string} o.core          the app's core folder (app/src/main, or the plugin's engine/tools/lib/src/main)
 * @param {string} o.userData      the server's profile (scratch): settings, budgets, the toolchain, uploads
 * @param {string} [o.projects]    the projects folder (default <userData>/projects)
 * @param {string} [o.deliverables] where Deliver puts things (default <userData>/Desktop)
 * @param {Function} o.send        (channel, payload): an event to every session
 * @param {Function} o.confirm     (opts) → Promise<boolean>: approvals.js
 * @param {object} [o.keys]        stand-in keys to start with ({ HEYGEN_API_KEY: 'hg-dummy-…' })
 * @param {'local'|'desk'} [o.kind]
 * @param {boolean} [o.library]    the Library and Transitions & Music (default true where the app's shell files are)
 */
function createLocalHost(o) {
  const kind = o.kind || 'local';
  const core = o.core;
  const req = (m) => require(path.join(core, m));
  const userData = path.resolve(o.userData);
  fs.mkdirSync(userData, { recursive: true, mode: 0o700 });
  const projects = path.resolve(o.projects || path.join(userData, 'projects'));
  const deliverables = path.resolve(o.deliverables || path.join(userData, 'Desktop'));
  for (const d of [projects, deliverables]) fs.mkdirSync(d, { recursive: true });

  const { createSettings, libraryDirOf, addonsDirOf } = req('settings.js');
  const settings = createSettings({ dir: userData });
  settings.write({ projectsDir: projects, deliverablesDir: deliverables }); // the folders given, always: never the user's real ones by accident
  const vaultMod = req('vault.js');
  const restoreFetch = loopbackOnlyFetch();

  let services = null;
  const hosts = o.library === false ? null : shellHosts(core, { services: () => services, settings, userData, send: o.send });
  // generation is paid (Kie.ai, Higgsfield): never here
  const generator = { makeScene: () => { throw new Error(REFUSED); }, pendingFor: () => 0, likenessPending: () => 0, resume: () => [], status: () => ({ jobs: [] }),
    quoteBroll: () => { throw new Error(REFUSED); }, makeBroll: () => { throw new Error(REFUSED); } };
  const noSafeStorage = { isEncryptionAvailable: () => false, encryptString: () => { throw new Error(REFUSED); }, decryptString: () => { throw new Error(REFUSED); } };
  let version = '0.0.0';
  for (const p of [path.join(core, '..', '..', 'package.json'), path.join(core, '..', '..', '..', 'package.json')]) {
    try { const j = JSON.parse(fs.readFileSync(p, 'utf8')); if (j && j.version) { version = j.version; break; } } catch { /* next */ }
  }
  const inApp = fs.existsSync(path.join(core, 'main.js')); // app/src/main: the engine is <repo>/engine; the plugin's lib: its parent
  const engineDir = path.resolve(o.engine || (inApp ? path.join(core, '..', '..', '..', 'engine') : path.join(core, '..', '..', '..', '..')));

  services = req('services.js').createServices({
    userData, isPackaged: !inApp, resourcesPath: path.dirname(engineDir), version, safeStorage: noSafeStorage,
    send: o.send, confirm: o.confirm,
    library: hosts ? hosts.getLibrary : () => null, addons: hosts ? hosts.getAddons : () => null, generator: () => generator,
    scribeBases: null,
  });

  // ── the vault: in memory, stand-ins only (the same object every module already holds, so its methods are swapped) ──
  Object.assign(services.vault, memoryVault(vaultMod, { seed: kind === 'desk' ? {} : o.keys, allowSet: kind !== 'desk', settings }));
  services.importLegacy = () => { throw new Error('Nothing is imported in local mode.'); };
  const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
  services.state = () => ({
    version, settings: settings.read(), vaultAvailable: true, keys: services.vault.status(), tools: services.lastDetect,
    presenter: services.pipeline.readPresenter(),
    sample: { dir: services.sampleDir(), scaffolded: exists(path.join(services.sampleDir(), 'presentation', 'video', '.venv', 'bin', 'python')) },
    importable: { keysEnv: false, presenterEnv: false }, // never looked for: local mode doesn't read the user's keys.env
  });

  // ── every paid kind refused ──
  // The web host (host-web.js, W6-02a) puts them back behind the Worker's grants: it alone asks for the core's own
  // (takePaid), which never reach the host this returns, so local mode refuses them exactly as before.
  if (typeof o.takePaid === 'function') {
    o.takePaid({ authorize: services.broker.authorize, ...Object.fromEntries(['final', 'sampleFinal', 'looks', 'check'].map((k) => [k, services.pipeline[k]])) });
  }
  services.broker.authorize = () => { throw new Error(REFUSED); };
  const refusedRun = async () => ({ code: 2, refused: true, lines: [REFUSED] });
  for (const k of ['final', 'sampleFinal', 'looks', 'check']) if (typeof services.pipeline[k] === 'function') services.pipeline[k] = refusedRun;

  const sandbox = req('sandbox.js');
  // every episode made here says so (madeWith): outside Electron provenance would answer 'plugin' (W4-06's L2)
  req('provenance.js').configure({ surface: kind === 'desk' ? 'desk' : 'web', sandbox: sandbox.kind() || 'none' });
  const caps = () => (kind === 'desk'
    ? { surface: 'desk', approve: 'none', sandbox: sandbox.kind() || 'none', toolchain: settings.read().toolchainMode === 'pinned' ? 'pinned' : 'system',
      clippy: false, reveal: false, download: true, nativeWindows: false, presenters: [], referenceCapture: [], paidSteps: [], crew: 'chat' }
    : { surface: 'web', approve: 'modal', sandbox: sandbox.kind() || 'none', toolchain: settings.read().toolchainMode === 'pinned' ? 'pinned' : 'system',
      clippy: false, reveal: false, download: true, nativeWindows: false, presenters: ['heygen'], referenceCapture: [], paidSteps: [], crew: 'sdk' });

  const api = Object.assign(Object.create(services), {
    os: { openPath: async () => '', showItemInFolder: () => false, openExternal: async () => { throw new Error('No browser here.'); } }, // each call gets its page's own (rpc.js)
    windows: { open: () => false, focusMain: () => true },
    fileUrl: () => null, // each call gets its page's own /files URL (rpc.js)
    caps,
    libraryHost: hosts ? hosts.libraryHost : null,
    addonsHost: hosts ? hosts.addonsHost : null,
  });

  const refuse = (msg = REFUSED) => async () => { throw new Error(msg); };
  // methods whose Mac behaviour needs a real key, the network or the user's files; each still validated by the contract
  const overrides = {
    'keys.set': async (c, name, value) => {
      try { services.vault.set(name, value); return { ok: true, keys: services.vault.status(), test: { name, ok: true, detail: 'Stand-in key.' } }; } catch (e) { return { ok: false, error: e.message, keys: services.vault.status() }; }
    },
    'keys.test': async (c, name) => ({ name, ok: null, detail: services.vault.get(name) ? 'Stand-in key.' : 'Not set.' }),
    'keys.import': async () => ({ keys: [], presenter: false, state: services.state() }),
    'presenter.looks': async () => ({ ok: false, error: 'Looks come from HeyGen, in the FLPT app.' }),
    'presenter.voices': async () => ({ ok: false, error: 'Voices come from HeyGen, in the FLPT app.' }),
    'presenter.preview': async () => ({ ok: false, error: 'Samples play in the FLPT app.' }),
    'sample.approveAndRun': async () => ({ ok: false, error: REFUSED }),
    'generate.quote': refuse(), 'generate.broll': refuse(),
    'clippy.run': refuse('Clippy is in the FLPT app.'), 'clippy.installYtDlp': refuse('Clippy is in the FLPT app.'), 'clippy.chooseYtDlp': refuse('Clippy is in the FLPT app.'),
  };

  const fileRoots = () => {
    const s = settings.read();
    const roots = [s.projectsDir, s.deliverablesDir, libraryDirOf(s), addonsDirOf(s)];
    try { const shipped = req('styles.js').shippedMediaRoot({ isPackaged: false }); if (shipped) roots.push(shipped); } catch { /* none */ }
    return roots.filter((d) => typeof d === 'string' && path.isAbsolute(d));
  };

  return {
    kind, api, caps, fileRoots, overrides, services, settings, engineDir,
    projectsDir: () => settings.read().projectsDir,
    close: async () => { restoreFetch(); for (const ctrl of services.jobs.values()) { try { ctrl.abort(); } catch { /* done */ } } },
    REFUSED,
  };
}

/** The default scratch profile for local mode: a fresh folder under the system's temp folder. */
const scratchProfile = () => fs.mkdtempSync(path.join(os.tmpdir(), 'flpt-server-local-'));

module.exports = { createLocalHost, memoryVault, loopbackOnlyFetch, scratchProfile, REFUSED, STAND_IN };
