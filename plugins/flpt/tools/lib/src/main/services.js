'use strict';
// The app's core services, made once per process by its shell (main.js on the Mac) and handed to every API module as
// part of its context (bridge-contract.js): the settings, the Keychain vault, the redactor, the spend broker, the
// pipeline, the episode flow, the toolchain's detection, jobs with live log lines, and what files the page may name.
// Electron-free: what only a shell has (safeStorage, the native dialog, the windows) comes in through `o`.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const { createSettings } = require('./settings');
const { createVault } = require('./vault');
const { createRedactor } = require('./redact');
const { engineRoot, appDirs } = require('./paths');
const toolchain = require('./toolchain');
const { createPipeline, parsePresenterEnv } = require('./pipeline');
const { createBroker } = require('./broker');
const sample = require('./sample');
const { createFlow } = require('./flow');
const providers = require('./providers'); // Kie.ai and Higgsfield (generated media)
const { createElevenLabs } = require('./providers/elevenlabs'); // Scribe, for cutting laughs (Refine)
const crewLib = require('./crew-library');
const { createStaging } = require('./staging');
const motion = require('./motion'); // moving slides (HyperFrames)
const animators = require('./animators'); // the animator crew: slides with animations of their own
const sandbox = require('./sandbox'); // macOS's sandbox around renders of what a crew wrote
const slidebox = require('./slidebox'); // the slide pictures and the free draft inside it (T18)

// Refine's add-ons: a video (a clip or b-roll) or a sound file (music).
const ADDON_KINDS = { video: /\.(mp4|mov|m4v|webm|mkv|avi)$/i, audio: /\.(mp3|m4a|wav|aiff?|aac|flac|ogg)$/i };
const LEGACY_DIR = path.join(os.homedir(), '.config', 'avatar-presentation'); // avatar-presentation's own profile
const MANIFEST = path.join(__dirname, 'toolchain-manifest.json');

const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };

/**
 * @param {object} o
 * @param {string} o.userData          the app's profile folder
 * @param {boolean} o.isPackaged       running from the built app (the engine is in its resources)
 * @param {string} o.resourcesPath
 * @param {string} o.version           the app's version
 * @param {object} o.safeStorage       Electron's safeStorage (the vault's encryption)
 * @param {Function} o.send            (channel, payload): an event to the main window
 * @param {Function} o.confirm         (opts) → Promise<boolean>: the one way FLPT asks before spending
 * @param {Function} [o.library]       () → the Library, or null before it's set up
 * @param {Function} [o.addons]        () → Transitions & Music, or null before it's set up
 * @param {Function} [o.generator]     () → the generator (B-roll, the Scenes step's stills and shots), or null
 * @param {object} [o.scribeBases]     QA only: Scribe at a local stand-in (providers.qaBases)
 */
function createServices(o) {
  const dirs = appDirs(o.userData);
  const settings = createSettings({ dir: dirs.userData });
  const vault = createVault({ dir: dirs.userData, safeStorage: o.safeStorage });
  const redact = createRedactor(() => vault.allValues());
  const broker = createBroker({ dir: path.join(dirs.userData, 'spend') });
  const root = engineRoot({ isPackaged: o.isPackaged, resourcesPath: o.resourcesPath });
  const library = () => (o.library ? o.library() : null);
  const addons = () => (o.addons ? o.addons() : null);
  const generator = () => (o.generator ? o.generator() : null);

  const s = {
    dirs, settings, vault, redact, broker, engineRoot: root, MANIFEST, LEGACY_DIR,
    send: o.send, confirm: o.confirm,
    staging: createStaging(), // files picked or dropped, held here until a call or an episode takes them
    addonStaging: createStaging({ kinds: ADDON_KINDS, refuse: 'Add a video, or a sound file for music.' }),
    produced: new Set(), // files this session made: the only ones the page may open or reveal
    jobs: new Map(), // id → AbortController
    knownVoices: new Map(), // the voices the Presenter step last listed (id → voice, with its engines)
    scribeBases: o.scribeBases || null, // QA only: Scribe at a local stand-in (see providers/index.js)
    lastDetect: null,
    getLibrary: library, getAddons: addons, getGenerator: generator,
  };

  // ── the toolchain ──
  s.detectTools = async () => {
    s.lastDetect = await toolchain.detect({ dir: dirs.toolchain, manifestFile: MANIFEST, mode: settings.read().toolchainMode });
    return s.lastDetect;
  };
  s.toolEnv = () => toolchain.processEnv(s.lastDetect || { tools: [] });
  s.toolOf = (id) => (s.lastDetect && s.lastDetect.tools.find((t) => t.id === id)) || null;
  s.readyTools = async () => {
    let det = await s.detectTools();
    const py = det.tools.find((t) => t.id === 'python');
    if (py && py.path && (!py.venv || !py.packages)) {
      await toolchain.setupPython({ dir: dirs.toolchain, pythonBase: py.path });
      det = await s.detectTools();
    }
    return det;
  };
  s.basePython = async () => {
    const det = s.lastDetect || (await s.detectTools());
    const py = det.tools.find((t) => t.id === 'python');
    return (py && (py.venv || py.path)) || null;
  };

  /** In a packaged app the SDK's native CLI is unpacked from the archive (asarUnpack); in development the SDK finds it. */
  s.agentExecutable = () => {
    if (!o.isPackaged) return undefined;
    const p = path.join(o.resourcesPath, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-darwin-arm64', 'claude');
    return exists(p) ? p : undefined;
  };

  s.sampleDir = () => sample.createSampleProject(settings.read().projectsDir).dir;

  s.state = () => {
    const st = settings.read();
    return {
      version: o.version,
      settings: st,
      vaultAvailable: vault.available(),
      keys: vault.status(),
      tools: s.lastDetect,
      presenter: s.pipeline.readPresenter(),
      sample: { dir: s.sampleDir(), scaffolded: exists(path.join(s.sampleDir(), 'presentation', 'video', '.venv', 'bin', 'python')) },
      importable: {
        keysEnv: exists(path.join(LEGACY_DIR, 'keys.env')),
        presenterEnv: exists(path.join(LEGACY_DIR, 'presenter.env')),
      },
    };
  };

  // ── jobs (long-running pipeline commands with live log lines) ──
  let jobSeq = 0;
  s.startJob = (label) => {
    const id = `job${++jobSeq}`;
    const ctrl = new AbortController();
    s.jobs.set(id, ctrl);
    s.send('job:event', { id, label, phase: 'start' });
    const onLine = (line) => s.send('job:event', { id, phase: 'line', line });
    const finish = (result) => { s.jobs.delete(id); s.send('job:event', { id, phase: 'end', code: result.code }); return { id, ...result }; };
    return { id, signal: ctrl.signal, onLine, finish };
  };

  s.ensureSampleProject = async (job) => {
    const dir = s.sampleDir();
    const py = path.join(dir, 'presentation', 'video', '.venv', 'bin', 'python');
    if (!exists(py)) {
      fs.mkdirSync(dir, { recursive: true });
      const base = await s.basePython();
      if (!base) throw new Error('Python isn\'t set up yet. Finish the Tools step first.');
      const r = await s.pipeline.scaffold(dir, base, { onLine: job.onLine, signal: job.signal });
      if (r.code !== 0 || !exists(py)) throw new Error('Setting up the sample project failed. See the log for details.');
    }
    // The sample is FLPT's own: a pipeline scaffolded by an earlier version is put back to FLPT's copy (free, T18), or
    // Setup's keyed runs on it (looks, check, the paid sample) would be refused.
    if (!s.pipeline.trust(dir).ok) s.pipeline.restore(dir);
    sample.writeSampleContent(dir);
    return dir;
  };

  /** --check expects rendered slides; render the sample's (free, local Chrome) if they're missing. */
  s.ensureRendered = async (dir, job) => {
    const slides = path.join(dir, 'presentation', 'slides');
    const have = exists(slides) && fs.readdirSync(slides).some((f) => /^slide_\d+\.png$/.test(f));
    if (have) return { code: 0, lines: [] };
    return s.pipeline.render(dir, { onLine: job.onLine, signal: job.signal });
  };

  s.importLegacy = () => {
    const out = { keys: [], presenter: false };
    try { out.keys = vault.importKeysEnv(fs.readFileSync(path.join(LEGACY_DIR, 'keys.env'), 'utf8')); } catch { /* none */ }
    try {
      const p = parsePresenterEnv(fs.readFileSync(path.join(LEGACY_DIR, 'presenter.env'), 'utf8'));
      if (p.HEYGEN_AVATAR_ID) {
        s.pipeline.writePresenter(p);
        // merged into the presenter as it is, so a cartoon's rig and voice survive the import (W3-05)
        settings.write({ presenter: { ...(settings.read().presenter || {}), lookId: p.HEYGEN_AVATAR_ID, voiceId: p.HEYGEN_VOICE_ID || '', engine: p.HEYGEN_VOICE_ENGINE, characterType: p.HEYGEN_CHARACTER_TYPE, lookName: 'Imported from avatar-presentation' } });
        out.presenter = true;
      }
    } catch { /* none */ }
    return out;
  };

  /** ffprobe's JSON for one file (streams and format), with the toolchain's ffprobe. */
  s.probe = (file) => {
    const ff = s.toolOf('ffmpeg');
    const bin = (ff && ff.ffprobe) || 'ffprobe';
    return new Promise((resolve, reject) => execFile(bin, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file],
      { timeout: 30000, maxBuffer: 8 << 20, env: s.toolEnv() }, (err, out) => (err ? reject(err) : resolve(JSON.parse(String(out))))));
  };

  /** The toolchain's ffmpeg (the video insets): resolves { code, err }, the error text redacted. */
  s.ffmpegRun = (args, { signal } = {}) => {
    const ff = s.toolOf('ffmpeg');
    return new Promise((resolve) => execFile((ff && ff.path) || 'ffmpeg', args, { env: s.toolEnv(), maxBuffer: 16 << 20, timeout: 30 * 60000, signal },
      (err, out, e) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, err: redact(String(e || '')) })));
  };

  /** The app's own files no render has any business reading: the vault (encrypted, still) and the crew's Claude folder. */
  s.appPrivate = () => [path.join(dirs.userData, 'vault.json'), path.join(dirs.userData, 'claude')];

  /**
   * Where a render of what a crew wrote may run: inside macOS's sandbox (sandbox.js), with no network and writes only in
   * the episode's presentation folder and HyperFrames' font cache. Null without the app's own HyperFrames (then there's
   * nothing local to render with) or without the sandbox.
   */
  s.renderSandbox = (dir) => {
    const hf = s.toolOf('hyperframes');
    if (!hf || !hf.ok || !sandbox.available()) return null;
    return { writable: [path.join(dir, 'presentation'), s.toolEnv().HYPERFRAMES_FONT_CACHE_DIR], hidden: [...sandbox.hiddenDirs(), ...s.appPrivate()] };
  };

  /**
   * Where the slide pictures run (T18, slidebox.js): render_slides.py on the episode's own Python and its Chrome on a
   * crew's HTML, inside macOS's sandbox, as the free draft does: no network, writes only under the episode's
   * presentation/ folder, the key files and the app's private folders unreadable. Null without the sandbox.
   */
  s.slideSandbox = (dir) => slidebox.boxFor(dir, { hidden: s.appPrivate() });

  /** The motion engine, as the flow uses it (see motion.js). Its renders run in the sandbox: the crews wrote the pages. */
  s.motionDeps = (engine) => ({
    available: () => { const t = s.toolOf('hyperframes'); return Boolean(t && t.ok); },
    plan: (dir) => motion.plan(dir),
    clear: (dir) => motion.clearMedia(dir),
    render: (dir, which, ro = {}) => motion.render(dir, which, { engineRoot: engine, fontCacheDir: path.join(dirs.userData, 'deck-fonts'),
      retime: (args, rt) => s.pipeline.retime(dir, args, { ...rt, sandbox: s.renderSandbox(dir) }), probe: s.probe, ffmpeg: s.ffmpegRun, ...ro }),
    // The Scenes step's "put it together": a cartoon or a cut scene from its approved stills and shots (ffmpeg only).
    assemble: (dir, key, ao = {}) => motion.assembleScene(dir, key, { probe: s.probe, ffmpeg: s.ffmpegRun, ...ao }),
  });

  /** The paid side of the Scenes step, for the flow: generate.js makes each step, through the broker. */
  s.sceneDeps = () => ({
    make: (x) => generator().makeScene(x),
    pending: (dir) => { const g = generator(); return g ? g.pendingFor(dir) : 0; },
    routes: () => ({ stills: providers.route(settings.read(), 'stills'), video: providers.route(settings.read(), 'video') }),
    keys: () => Object.fromEntries(providers.IDS.map((id) => [id, providers.hasKey(vault, id)])),
  });

  /**
   * The animator crew's in-process tools (animators.js), as the flow uses them: the method's scripts, HyperFrames and
   * ffmpeg, each run inside the sandbox in the slide's folder, with the toolchain's environment (no keys).
   */
  s.animatorDeps = (engine) => ({
    available: () => Boolean(s.toolOf('hyperframes') && s.toolOf('hyperframes').ok && sandbox.available()),
    probe: s.probe,
    tools: (dir, slide, signal) => {
      const env = { ...s.toolEnv(), HOME: process.env.HOME, USER: process.env.USER, LANG: 'en_US.UTF-8', TMPDIR: process.env.TMPDIR };
      return animators.makeTools(dir, slide, engine, {
        exec: animators.createExec({ env, writable: [env.HYPERFRAMES_FONT_CACHE_DIR], hidden: s.appPrivate() }), signal, probe: s.probe,
        node: (s.toolOf('node') || {}).path || 'node', python: s.pipeline.projectPython(dir), hyperframes: (s.toolOf('hyperframes') || {}).path,
        ffmpeg: (s.toolOf('ffmpeg') || {}).path || 'ffmpeg', fontCacheDir: path.join(dirs.userData, 'deck-fonts'),
      });
    },
  });

  /**
   * One add-on for Refine, from what the page names: { kind, source: { library: id } | { addons: id } | { staged: token },
   * slide, phrase, under, sound, seconds }. The file's path is worked out here (never sent in by the page).
   */
  s.addAddonFrom = async (dir, spec) => {
    const a0 = spec && typeof spec === 'object' ? spec : {};
    const src = a0.source && typeof a0.source === 'object' ? a0.source : {};
    const place = { kind: a0.kind, slide: a0.slide, phrase: a0.phrase, under: a0.under, sound: a0.sound, seconds: a0.seconds };
    if (typeof src.library === 'string') {
      const lib = library();
      if (!lib) throw new Error('The Library isn\'t ready yet.');
      const it = lib.get(src.library);
      if (!it.filePath) throw new Error('That item has no file to use.');
      const v = s.flow.addAddon(dir, { ...place, file: it.filePath, title: it.title, duration: it.duration, from: { kind: 'library', id: it.id, name: it.title } });
      lib.markUsed(it.id, v.state.title);
      return v;
    }
    if (typeof src.addons === 'string') {
      const repo = addons();
      if (!repo) throw new Error('Transitions & Music isn\'t ready yet.');
      const it = repo.get(src.addons);
      if (it.kind !== a0.kind) throw new Error(it.kind === 'music' ? 'That one is music.' : 'That one is a transition.');
      const a = it.addon || {};
      return s.flow.addAddon(dir, { ...place, file: it.filePath, title: it.title, duration: it.duration, from: { kind: 'addons', id: it.id, name: it.title },
        style: a.style || 'card', cut: a.cut, group: a.group, credit: a.credit, changes: a.changes });
    }
    if (typeof src.staged === 'string') {
      const [file] = s.addonStaging.take(src.staged);
      const info = await s.probe(file).catch(() => null);
      return s.flow.addAddon(dir, { ...place, file, title: path.basename(file).replace(/\.[^.]+$/, ''), duration: info && Number(info.format && info.format.duration),
        from: { kind: 'file', name: path.basename(file) } });
    }
    throw new Error('Pick something to add.');
  };

  // Every slide render and free draft (Setup's sample, the deck crew's check_deck and its pictures, Draft, Film) runs
  // in the slide sandbox above.
  s.pipeline = slidebox.sandboxSlides(createPipeline({ engineRoot: root, presenterDir: dirs.presenter, vault, redact, toolEnv: s.toolEnv, broker,
    trustedPython: () => toolchain.venvPython(dirs.toolchain), privateDirs: s.appPrivate, fontCacheDir: path.join(dirs.userData, 'deck-fonts'),
    // who presents an episode: its own choice, else the app's (W3-05's presenter.of)
    presenterOf: (dir) => require('./presenter').of(dir, settings.read().presenter) }), { box: s.slideSandbox });
  s.flow = createFlow({
    settings, vault, pipeline: s.pipeline, broker, redact, toolEnv: s.toolEnv, send: (channel, payload) => s.send(channel, payload),
    engineRoot: root,
    configDir: path.join(dirs.userData, 'claude'),
    appPrivate: s.appPrivate, // what the cartoon pass hides from its sandbox (ext/presenter, W3-05)
    executable: s.agentExecutable(),
    chrome: () => { const c = s.toolOf('chrome'); return c && c.path; },
    basePython: s.basePython,
    motion: s.motionDeps(root),
    animators: s.animatorDeps(root),
    loadSdk: () => import('@anthropic-ai/claude-agent-sdk'),
    loadZod: async () => require('zod').z,
    // The Library: the crew's tools, and what approved stages made (kept for later episodes).
    libraryFor: (dir) => { const lib = library(); return lib ? crewLib.crewLibrary(lib, dir) : undefined; },
    keep: async (dir, stageId, extra) => { const lib = library(); return lib ? crewLib.keep(lib, dir, stageId, extra) : 0; },
    confirm: (opts) => s.confirm(opts),
    // Cutting laughs (Refine): ElevenLabs Scribe, with the key from the vault (QA runs may point it at a local stand-in).
    scribe: () => createElevenLabs({ key: vault.get('ELEVENLABS_API_KEY'), redact, ...((s.scribeBases && s.scribeBases.elevenlabs) || {}) }),
    scenes: s.sceneDeps(),
    slideSandbox: s.slideSandbox,
    // Flow extensions' notes and load problems (also in flow.extensions().problems).
    log: (text) => console.warn(`[flpt ext] ${text}`),
  });

  return s;
}

module.exports = { createServices, ADDON_KINDS, LEGACY_DIR, MANIFEST };
