'use strict';
// Runs the vendored pipeline scripts (engine/skills/avatar-presentation/scripts) as child processes.
// This is the only place keys leave the vault:
//   - each command names the keys it needs, and only those are put into that one process's environment
//   - FLPT_ENV_KEYS=1 tells the (patched) pipeline to read them from the environment, so nothing is written to disk
//   - every output line is redacted before it reaches the renderer or a log
// The presenter profile (look, voice, bubble: no secrets) is written to the app's own presenter.env, which the
// pipeline finds through AVATAR_PRESENTATION_CONFIG_DIR.
//
// Trusted code (T18, PLAN §2.16 item 3):
//   - a Python run that gets a key (check, looks, final) runs on FLPT's own Python (the app's venv, or the plugin's),
//     never the episode's .venv, with -E -s (no PYTHON* variables, no user site), its bytecode cache pointed nowhere
//     (a planted .pyc is never read), and only when every presentation/video/*.py is byte for byte FLPT's patched copy
//     and nothing else Python could import sits beside them. Otherwise it's refused, and restore() puts FLPT's copy
//     back (free). -I isn't usable: the pipeline imports its sibling render_slides.py. Those runs go only through
//     keyed(): run() refuses a keyed run of an episode's script or on its Python. (HeyGen's voice list isn't a
//     Python run: heygen.js asks for it.)
//   - a paid run gets only the keys of the providers it holds a live budget token for (T19), in its environment and
//     in what the pipeline reads from files (FLPT_ALLOW_KEYS). The FLPT voices' sign-in (FLPT_VOICES_TOKEN, W4-10) is
//     no provider's key and bills no one: only the film (`final`, through keyed()) gets it, and only when script.md
//     names an FLPT voice (a `> flpt-voice: fish-house/` tag) on a slide the run makes and the sign-in is the one of
//     the Worker FLPT talks to now (guestvoice.houseReady: flpt-voices.json's base is fish-house.baseUrl()). The run
//     names that Worker to the pipeline (FLPT_VOICES_URL), so the sign-in goes there and nowhere else. The lead's T19
//     ruling, 2026-10-24.
//   - the free runs that execute what a crew could have touched (the draft, the moving slides, the cached-only
//     re-composite, the estimate, the web parts and the player page) run inside macOS's sandbox whenever it's there:
//     no network, writes only under the episode's presentation/ folder, and presenter.env read from a copy without
//     its secrets when its own folder is one the sandbox hides (the plugin's ~/.config/avatar-presentation). The
//     slide pictures (render) run there only when the caller passes a sandbox: render_slides.py's Chrome can't start
//     its own sandbox inside Seatbelt (a ruling is pending), and in there they take the deck's fonts from a local copy
//     (FLPT_LOCAL_FONTS_V1).
//
// The cartoon presenter (W3-05, presenter.js): every run of an episode a cartoon presents carries FLPT_PRESENTER=cartoon
// and the cartoon's voice for that run only (FLPT_PRESENTER_SET, FLPT_TTS; never written to a profile), so no avatar
// clip is ever made or paid for (T4). A paid film of a cartoon bills only its voice's provider (HeyGen, ElevenLabs or
// Fish.audio), with only that provider's key (T19). On the Mac's voice the film is `cartoonFinal`: the draft's path at
// final quality (FLPT_DRAFT_FINAL), keyless, sandboxed, offline and free; its estimate is nothing. Its check asks nothing
// of an avatar: on the Mac's voice it's keyless and sandboxed too (`cartoonCheck`), else it gets only the voice's key;
// either way it also checks what the cartoon's own pass needs (presenter.checkTools).
//
// The web image (W4-04): there's no `say` on Linux, so the free voice is Kokoro-82M (freeTtsOf, patch 40_free_tts), and
// the sandbox is bubblewrap (sandbox.js), required there: a free run that would run outside it (no sandbox, or none
// given) is refused (MUST_BOX), the slide pictures included. A run that gets HeyGen's key there gets a dummy one, the
// broker's address and the job's capability (edgeOf, patch 41_heygen_base): the Worker adds the real key at the edge,
// and only for that job.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { scriptsDir } = require('./paths');
const sandbox = require('./sandbox');
const presenterLib = require('./presenter');

// What each command may see. Anything not listed gets no keys at all.
const KEYS_FOR = {
  scaffold: [],
  render: [],
  draft: [],
  check: ['HEYGEN_API_KEY', 'ELEVENLABS_API_KEY', 'GEMINI_API_KEY'],
  voiceCheck: ['HEYGEN_API_KEY', 'ELEVENLABS_API_KEY', 'FISH_AUDIO_API_KEY'], // a cartoon's check: its paid voice's key alone (onlyKeys)
  looks: ['HEYGEN_API_KEY'],
  voices: ['HEYGEN_API_KEY'], // no Python run uses it today (heygen.js lists the voices); keyed if one ever does
  final: ['HEYGEN_API_KEY', 'ELEVENLABS_API_KEY', 'GEMINI_API_KEY', 'FISH_AUDIO_API_KEY', 'FLPT_VOICES_TOKEN'], // the sign-in: houseSignIn
  web: [],
  player: [],
  motion: [], // moving slides: word timings and HyperFrames renders, all local
  recompose: [], // the filmed episode put back together from the cache, with no network (FLPT_CACHED_ONLY)
  estimate: [], // what filming would make that isn't cached yet, with no network (FLPT_ESTIMATE_ONLY)
  cartoonFinal: [], // a cartoon on the Mac's voice: the film on the draft's path (FLPT_DRAFT_FINAL), keyless and offline
  cartoonCheck: [], // a cartoon on the Mac's voice: the free check, keyless and offline (no avatar, no paid voice)
};

/** The estimate-only run's one JSON line, checked: { chars, clips, clipSeconds, clipsTotal, voiceChars } or null. */
function parseEstimate(lines) {
  const line = [...(lines || [])].reverse().find((l) => l.trim().startsWith('{"flpt_estimate"'));
  let e;
  try { e = JSON.parse(line).flpt_estimate; } catch { return null; }
  const int = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
  const out = { chars: int(e && e.chars), clips: int(e && e.clips), clipSeconds: e && Number.isFinite(e.clip_seconds) && e.clip_seconds >= 0 ? e.clip_seconds : null,
    clipsTotal: int(e && e.clips_total), voiceChars: int(e && e.voice_chars) };
  if (Object.values(out).some((v) => v === null) || out.clips > out.clipsTotal || (out.clips > 0) !== (out.clipSeconds > 0)) return null;
  return out;
}

// Commands that spend money, and the providers whose approved budget they can run on (see broker.js): the film is
// HeyGen's (the twin, or a cartoon in your HeyGen voice), or a cartoon's ElevenLabs or Fish.audio voice.
const PAID = { final: ['heygen', 'elevenlabs', 'fish'] };

// Which provider each key bills (T19): a paid run gets a key only while that provider holds a live budget token.
const KEY_PROVIDER = { HEYGEN_API_KEY: 'heygen', ELEVENLABS_API_KEY: 'elevenlabs', GEMINI_API_KEY: 'gemini', FISH_AUDIO_API_KEY: 'fish' };
// The FLPT voices' sign-in (guestvoice.HOUSE_TOKEN): no budget brings it (it bills no one); the film carries it under the
// T19 ruling's own rule (houseSignIn). HOUSE_SIGNIN tells guestvoice.houseFilms that it does.
const HOUSE_TOKEN = 'FLPT_VOICES_TOKEN';
const HOUSE_SIGNIN = true;

/**
 * The slides a pipeline run makes, from its --slides (the last one, as argparse keeps it; parse_range's "3-5" or
 * "2,7"): a Set of slide numbers, or null for every slide (no --slides, or one this doesn't read exactly).
 */
function slidesOf(args) {
  let spec = null;
  const a = Array.isArray(args) ? args.map(String) : [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--slides' && i + 1 < a.length) spec = a[++i];
    else if (a[i].startsWith('--slides=')) spec = a[i].slice('--slides='.length);
  }
  if (spec == null) return null;
  const out = new Set();
  for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d{1,6})(?:-(\d{1,6}))?$/.exec(part);
    if (!m) return null;
    for (let n = Number(m[1]); n <= Number(m[2] || m[1]) && n - Number(m[1]) < 10000; n++) out.add(n);
  }
  return out;
}

// The runs that use a key: FLPT's own Python and byte-checked scripts only (T18), so through keyed(), never run().
const TRUSTED = new Set(Object.keys(KEYS_FOR).filter((k) => KEYS_FOR[k].length));
// The free runs that execute pipeline code or a crew's moving slides: in the sandbox when it's there. Not yet the
// slide pictures (render): full Chrome can't start its own sandbox inside Seatbelt. A draft's new placeholder cards
// (Chrome too) come out without their text in there; cards already made are reused.
const SANDBOXED = new Set(['draft', 'motion', 'recompose', 'estimate', 'web', 'player', 'cartoonFinal', 'cartoonCheck']);
// The sandboxed runs that need no network at all, not even this Mac's loopback (sandbox.js `loopback: false`): the
// slide pictures (Chrome's --screenshot of file:// pages, every request to a dead proxy), the estimate, the web parts
// and the player page (Python and ffmpeg). The others render moving slides, whose HyperFrames serves the page to its
// Chrome on a loopback port of its own choosing, so they keep loopback. (On Linux every sandbox's loopback is its own.)
const NO_LOOPBACK = new Set(['render', 'estimate', 'web', 'player']);
// The runs that never run bare where a sandbox is required (sandbox.required(): the web image): the sandboxed ones and
// the slide pictures. Only FLPT's own trusted code runs outside there (scaffold; check, looks and final on its Python).
const MUST_BOX = new Set([...SANDBOXED, 'render']);
// How FLPT's own Python runs a keyed script: no PYTHON* variables (-E), no user site-packages (-s), unbuffered
// output (-u), and no bytecode written or read (-B, and a cache prefix that can never be a folder).
const TRUSTED_FLAGS = ['-E', '-s', '-u', '-B', '-X', 'pycache_prefix=/dev/null/flpt'];
// A file Python could load as a module (source, bytecode, an extension) or a path file: beside the scripts, or
// anywhere inside a folder Python could take for a package.
const IMPORTABLE = /\.(py|pyc|pyo|pyd|pyw|so|pth)$/i;
// A name `import` could find as a package: an identifier (a folder needs no __init__.py to be one).
const IDENTIFIER = /^[\p{L}_][\p{L}\p{N}_]*$/u;
// The pipeline's own folders beside its scripts (its output, its cache, its assets) and the bytecode folder the
// trusted flags never read: no import names them, so what they hold doesn't matter here.
const OWN_DIRS = new Set(['output', 'cache', 'assets', '__pycache__']);
const CHANGED = 'This episode\'s pipeline changed.';

// The free voice (PLAN §2.2 freeTts): the Mac's `say`, or where there is none (the web image on Linux) Kokoro-82M through
// patch 40_free_tts (FLPT_FREE_TTS=kokoro and its pinned files). From createPipeline's `freeTts`, else from this
// process's environment (the image sets it), else `say`. Paths only, nothing secret: every run gets them, since any
// run that speaks in the free voice (the draft, a cartoon's film on the draft's path, a Mac guest) builds it.
const KOKORO_FILES = { python: 'FLPT_KOKORO_PYTHON', model: 'FLPT_KOKORO_MODEL', voices: 'FLPT_KOKORO_VOICES' };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
/** { provider: 'say' | 'kokoro', ok, problem, env } from an option ({ provider, python, model, voices, modelId }) or env. */
function freeTtsOf(opt, env = process.env) {
  const src = opt && typeof opt === 'object' ? opt
    : String(env.FLPT_FREE_TTS || '').trim().toLowerCase() === 'kokoro'
      ? { provider: 'kokoro', python: env.FLPT_KOKORO_PYTHON, model: env.FLPT_KOKORO_MODEL, voices: env.FLPT_KOKORO_VOICES, modelId: env.FLPT_KOKORO_MODEL_ID }
      : null;
  if (!src || src.provider !== 'kokoro') return { provider: 'say', ok: true, problem: null, env: {} };
  const files = Object.fromEntries(Object.entries(KOKORO_FILES).map(([k, name]) => [name, typeof src[k] === 'string' ? src[k] : '']));
  const bad = Object.entries(files).filter(([, p]) => !path.isAbsolute(p) || !isFile(p)).map(([name]) => name);
  const id = /^[\w.:+-]{1,80}$/.test(String(src.modelId || '')) ? { FLPT_KOKORO_MODEL_ID: String(src.modelId) } : {};
  // a Kokoro that isn't all there still goes to the pipeline as Kokoro: it stops and names what's missing (never `say`)
  return { provider: 'kokoro', ok: !bad.length, problem: bad.length ? `Kokoro isn't set up: ${bad.join(', ')}.` : null, env: { FLPT_FREE_TTS: 'kokoro', ...files, ...id } };
}

// The web image's HeyGen goes through FLPT's egress broker (patch 41_heygen_base, FLPT_HEYGEN_BASE): the broker's own
// host, or a loopback one (wrangler dev, QA). A run that gets HeyGen's key (a dummy there: the broker swaps in the
// user's) also gets the base and, from the host's jobFor, the job's capability (FLPT_HEYGEN_JOB, minted by the Worker).
const HEYGEN_BASE = /^http:\/\/heygen\.internal(:\d{2,5})?$|^http:\/\/127\.0\.0\.1:\d{2,5}(\/[A-Za-z0-9_-]+)*$/;
const JOB = /^[A-Za-z0-9._~-]{16,256}$/;
function edgeOf(opt, env = process.env) {
  const base = String((opt && opt.heygenBase) || env.FLPT_HEYGEN_BASE || '').trim().replace(/\/$/, '');
  return { heygenBase: HEYGEN_BASE.test(base) ? base : null, jobFor: opt && typeof opt.jobFor === 'function' ? opt.jobFor : null };
}

/**
 * Whether `p` (followed when it's a link) is a folder holding, at any depth, anything Python could load from a
 * package: an importable file, or more than can be checked (a link loop, a huge tree, an unreadable folder).
 */
function holdsCode(p, budget = { left: 20000 }, depth = 0) {
  let st = null;
  try { st = fs.statSync(p); } catch { return false; } // a dangling link: nothing to load
  if (!st.isDirectory()) return false;
  if (depth > 16) return true;
  let names = null;
  try { names = fs.readdirSync(p); } catch { return true; }
  for (const n of names) {
    if (--budget.left < 0 || IMPORTABLE.test(n) || holdsCode(path.join(p, n), budget, depth + 1)) return true;
  }
  return false;
}

/** Whether a path is an episode's own code: anything in a presentation/video/ folder (its scripts, its .venv) or a .venv. */
const episodeCode = (p) => typeof p === 'string' && /(^|[\\/])(presentation[\\/]video|\.venv)([\\/]|$)/.test(p);

/** The real path of `p` (also for one that doesn't exist yet), as the sandbox matches paths. */
function realish(p) {
  let head = path.resolve(p);
  const rest = [];
  for (;;) {
    try { return path.join(fs.realpathSync(head), ...rest); } catch { /* go up */ }
    if (path.dirname(head) === head) return path.resolve(p);
    rest.unshift(path.basename(head));
    head = path.dirname(head);
  }
}
const isWithin = (p, dirs) => { const r = realish(p); return dirs.filter(Boolean).map(realish).some((d) => r === d || r.startsWith(d + path.sep)); };

/** presenter.env's text without any secret line (KEY=, TOKEN=, SECRET=, CREDENTIALS=), read the way the pipeline reads it. */
function withoutSecrets(text) {
  return String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter((raw) => {
    const line = raw.trim().replace(/^\uFEFF/, '').trim();
    if (!line || line.startsWith('#') || !line.includes('=')) return true;
    let k = line.slice(0, line.indexOf('=')).trim();
    if (/^export\s/i.test(k)) k = k.slice(7).trim();
    return !/_(KEY|TOKEN|SECRET|CREDENTIALS)$/i.test(k);
  }).join('\n');
}

// Non-secret presenter settings the pipeline reads, with the house defaults (signature-style.md).
const PRESENTER_DEFAULTS = {
  TTS_PROVIDER: 'heygen',
  HEYGEN_CHARACTER_TYPE: 'talking_photo',
  HEYGEN_ENGINE: 'avatar_iv',
  HEYGEN_VOICE_ENGINE: 'elevenlabs_v3',
  HEYGEN_RESOLUTION: '1080p',
  HEYGEN_API_VERSION: 'v3',
  HEYGEN_MAX_CONCURRENT: '8',
  BUBBLE_POSITION: 'bottom-left',
  BUBBLE_SHAPE: 'rounded',
  BUBBLE_ZOOM: '1.6',
  BUBBLE_FOCUS_X: '0.50',
  BUBBLE_FOCUS_Y: '0.32',
  EDIT_NUDGE_MS: '20',
};
const PRESENTER_KEYS = new Set([...Object.keys(PRESENTER_DEFAULTS), 'HEYGEN_AVATAR_ID', 'HEYGEN_VOICE_ID',
  'HEYGEN_VOICE_SPEED', 'HEYGEN_VOICE_LANGUAGE', 'HEYGEN_BACKGROUND', 'HEYGEN_EXPRESSIVENESS', 'BUBBLE_SIZE',
  'BUBBLE_MARGIN', 'GEMINI_VOICE', 'GEMINI_TTS_MODEL', 'ELEVENLABS_VOICE_ID', 'ELEVENLABS_MODEL', 'FISH_VOICE_ID', 'FISH_MODEL']);

/** Parse KEY=VALUE text, keeping only known, non-secret presenter settings. */
function parsePresenterEnv(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/);
    if (!m || !PRESENTER_KEYS.has(m[1]) || /_(KEY|TOKEN|SECRET)$/.test(m[1])) continue;
    const v = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (v) out[m[1]] = v;
  }
  return out;
}

/**
 * The app's own Python for keyed runs, from the tools' PATH (toolchain.processEnv puts <toolchain>/venv/bin there):
 * the fallback when createPipeline isn't told (trustedPython).
 */
function venvOnPath(env) {
  for (const d of String((env && env.PATH) || '').split(path.delimiter)) {
    if (path.isAbsolute(d) && path.basename(d) === 'bin' && path.basename(path.dirname(d)) === 'venv') {
      const py = path.join(d, 'python');
      try { fs.accessSync(py, fs.constants.X_OK); return py; } catch { /* next */ }
    }
  }
  return null;
}

/**
 * Optional, beyond the existing ones: trustedPython (path or () => path: FLPT's own Python for keyed runs; default: the
 * venv on the tools' PATH), privateDirs (() => [folders no sandboxed run may read], beside sandbox.hiddenDirs()),
 * fontCacheDir (where the deck's fonts are kept for sandboxed slide renders), fetchImpl (for those fonts),
 * presenterOf ((episode folder) => presenter.of(…): who presents it; default: the episode's own choice, else the app's
 * settings beside presenterDir when it's the app's own <userData>/presenter), freeTts ({ provider: 'kokoro', python,
 * model, voices, modelId }: the free voice where there's no `say`; default from the environment, see freeTtsOf), edge
 * ({ heygenBase, jobFor(provider, { kind, token }) → capability|null }: the web image's broker; also setEdge()).
 */
/** The scaffold's log without its file list (every file it kept or copied, two lines each): what it set up, and problems. */
function quietScaffold(onLine) {
  if (typeof onLine !== 'function') return onLine;
  return (line) => { const l = String(line); if (/\((kept|copied|new)\)\s*$/.test(l) || /^\s*=\s*\//.test(l)) return; onLine(line); };
}

function createPipeline({ engineRoot, presenterDir, vault, redact, toolEnv, broker, trustedPython = null, privateDirs = () => [],
  fontCacheDir = null, fetchImpl = globalThis.fetch, presenterOf = null, freeTts = null, edge = null, basePython = null }) {
  const scripts = scriptsDir(engineRoot);
  const engineVideo = path.join(scripts, 'video');
  const voice = freeTtsOf(freeTts);
  let broke = edgeOf(edge);

  function presenterEnvFile() { return path.join(presenterDir, 'presenter.env'); }

  function writePresenter(values) {
    const merged = { ...PRESENTER_DEFAULTS, ...parsePresenterEnv(Object.entries(values || {}).map(([k, v]) => `${k}=${v}`).join('\n')) };
    const lines = ['# presenter.env, written by the Fatty Lumpkin Presentation Tool. No secrets here: keys live in the Keychain.'];
    for (const [k, v] of Object.entries(merged)) lines.push(`${k}=${v}`);
    fs.mkdirSync(presenterDir, { recursive: true });
    const tmp = presenterEnvFile() + '.tmp';
    fs.writeFileSync(tmp, lines.join('\n') + '\n', { mode: 0o600 });
    fs.renameSync(tmp, presenterEnvFile());
    return merged;
  }

  function readPresenter() {
    try { return parsePresenterEnv(fs.readFileSync(presenterEnvFile(), 'utf8')); } catch { return {}; }
  }

  /**
   * Run one pipeline command. `kind` decides which keys it may see (KEYS_FOR). Lines are redacted before onLine.
   * Returns { code, lines } (the last 400 redacted lines). Pass an AbortSignal to stop it. `sandbox` ({ writable }):
   * run it inside macOS's sandbox (sandbox.js), with no network and writes only there; refused when it isn't available.
   * A run that gets keys (TRUSTED) of an episode's own pipeline script, or on an episode's own Python, is refused
   * here: it goes through check, looks, sampleFinal or final (keyed(): FLPT's Python, a checked pipeline).
   */
  function run(o) {
    // the script as Python finds it (a relative one, or -c/-e code, from the folder it runs in)
    if (o && TRUSTED.has(o.kind) && (episodeCode(path.resolve(o.cwd || '.', String(o.script || ''))) || episodeCode(o.python))) {
      return Promise.resolve({ code: 2, lines: [`Refused: a ${o.kind} run of an episode's pipeline goes through FLPT's own Python (check, looks or final).`], refused: true });
    }
    // an episode's .venv set aside is made again once: runs that start meanwhile wait for the same repair
    const dir = episodeOfPython(o && o.python);
    let fix = dir ? healing.get(dir) : null;
    if (dir && !fix && healVenv(dir)) {
      fix = rebuildVenv(dir, o).finally(() => healing.delete(dir));
      healing.set(dir, fix);
    }
    if (fix) {
      return fix.then((made) => (made ? spawnRun(o)
        : { code: 1, lines: ['This episode\'s Python couldn\'t be set up again. Setup → Tools, then try again.'] }));
    }
    return spawnRun(o);
  }
  const healing = new Map(); // episode folder → its .venv being made again

  /** The episode folder whose .venv this Python is, or null. */
  function episodeOfPython(py) {
    const m = typeof py === 'string' && py.match(/^(.*)\/presentation\/video\/\.venv\/bin\/python$/);
    return m ? m[1] : null;
  }
  /**
   * An episode's .venv whose Python won't start (copied from another Mac, it links to a Python this one hasn't: the
   * move to the Studio, 2026-10-27) is set aside as .venv-broken-<time>, never deleted. → true when it was (or there's
   * none), so the next run makes it again (rebuildVenv). Read, never run: a crew could have put anything in there,
   * and only the sandbox runs it. Broken = its python's link leads nowhere, or pyvenv.cfg's home is gone.
   */
  function healVenv(projectDir) {
    const venv = path.join(video(projectDir), '.venv');
    if (fs.existsSync(path.join(venv, 'bin', 'python')) && !homeGone(venv)) return false;
    let there = false;
    try { fs.lstatSync(venv); there = true; } catch { there = false; }
    if (there) fs.renameSync(venv, `${venv}-broken-${Date.now()}`);
    return true;
  }
  function homeGone(venv) {
    let cfg = '';
    try { cfg = fs.readFileSync(path.join(venv, 'pyvenv.cfg'), 'utf8'); } catch { return false; }
    const m = cfg.match(/^home\s*=\s*(.+?)\s*$/m);
    return Boolean(m) && !fs.existsSync(m[1]);
  }
  /** Make an episode's .venv again with FLPT's scaffold (it keeps every file already there). */
  async function rebuildVenv(projectDir, o = {}) {
    const base = typeof basePython === 'function' ? await basePython() : null;
    if (!base) return false;
    if (o.onLine) o.onLine('Setting up this episode\'s Python again (it came from another Mac)…');
    const r = await spawnRun({ kind: 'scaffold', python: base, script: path.join(scripts, 'scaffold.py'), args: [projectDir], cwd: path.dirname(projectDir), onLine: quietScaffold(o.onLine), signal: o.signal });
    return r.code === 0 && fs.existsSync(path.join(video(projectDir), '.venv', 'bin', 'python'));
  }

  /**
   * A sandboxed run's presenter folder: when the one it would read is inside a folder the sandbox hides (the
   * plugin's ~/.config/avatar-presentation, beside keys.env), a private copy of presenter.env without its secrets,
   * so the run keeps the presenter's settings and never sees a key. { dir, cleanup } or null.
   */
  function presenterCopy(cfgDir, hidden) {
    if (!cfgDir || !isWithin(cfgDir, hidden)) return null;
    const dir = fs.mkdtempSync(path.join(sandbox.tmpdir(), 'flpt-presenter-'));
    let text = null;
    try { text = fs.readFileSync(path.join(cfgDir, 'presenter.env'), 'utf8'); } catch { /* none: the pipeline's defaults */ }
    if (text != null) fs.writeFileSync(path.join(dir, 'presenter.env'), withoutSecrets(text), { mode: 0o600 });
    return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
  }

  /**
   * Does this film carry the FLPT voices' sign-in (T19 for FLPT voices)? Only when a slide it makes names an FLPT voice
   * (a fish-house tag under the slide's heading, as the pipeline reads it; `slides` from the run's --slides, else every
   * slide) and the sign-in is in the vault for the Worker FLPT talks to now (guestvoice.houseReady: flpt-voices.json's
   * base is fish-house.baseUrl()). Its value comes from the vault (vault.env) like a key's; nothing here reads it.
   */
  function houseSignIn(projectDir, slides = null) {
    const guest = require('./guestvoice');
    let script = '';
    try { script = fs.readFileSync(path.join(projectDir, 'presentation', 'script.md'), 'utf8'); } catch { return false; }
    return Object.entries(guest.tagsOf(script)).some(([n, v]) => v.provider === 'fish-house' && (!slides || slides.has(Number(n))))
      && guest.houseReady(vault);
  }

  // `trusted` ({ projectDir }) is keyed()'s alone: a run through run() never carries the FLPT voices' sign-in.
  function spawnRun({ kind, python, script, args = [], cwd, onLine = () => {}, signal, budgetToken, tokens = {}, env: extraEnv = {}, sandbox: box = null, pythonArgs = [], onlyKeys = null }, trusted = {}) {
    if (!Object.prototype.hasOwnProperty.call(KEYS_FOR, kind)) throw new Error(`unknown pipeline command: ${kind}`);
    const paid = PAID[kind] || null;
    // the approval this run holds: budgetToken (its provider as the broker records it) and any others in `tokens`
    const own = paid && budgetToken && broker ? paid.find((p) => broker.isLive(budgetToken, p)) : null;
    const live = { ...tokens, ...(own ? { [own]: budgetToken } : {}) };
    const holds = (p) => Boolean(p && broker && live[p] && broker.isLive(live[p], p));
    if (paid && !paid.some(holds)) {
      return Promise.resolve({ code: 2, lines: ['Refused: this step costs money and has no approved budget.'], refused: true });
    }
    // Keys follow tokens (T19): a paid run gets only the keys of providers whose approval is live, and the pipeline
    // drops any other key it would read from a file (FLPT_ALLOW_KEYS).
    // onlyKeys narrows a run further (a cartoon's check: its voice's key alone). The FLPT voices' sign-in follows no
    // budget: the film gets it under its own rule (houseSignIn), beside the keys its budgets bring and never instead.
    const house = kind === 'final' && KEYS_FOR[kind].includes(HOUSE_TOKEN) && Boolean(trusted.projectDir) && houseSignIn(trusted.projectDir, slidesOf(args));
    const keys = [...KEYS_FOR[kind].filter((k) => k !== HOUSE_TOKEN && (!paid || holds(KEY_PROVIDER[k]))), ...(house ? [HOUSE_TOKEN] : [])]
      .filter((k) => !Array.isArray(onlyKeys) || onlyKeys.includes(k));
    const env = {
      ...toolEnv(),
      HOME: process.env.HOME,
      USER: process.env.USER,
      LANG: 'en_US.UTF-8',
      AVATAR_PRESENTATION_CONFIG_DIR: presenterDir,
      FLPT_ENV_KEYS: '1',
      PYTHONUNBUFFERED: '1',
      ...voice.env, // the free voice (Kokoro where there's no `say`: FLPT_FREE_TTS)
      ...extraEnv,
      ...(paid ? { FLPT_ALLOW_KEYS: keys.join(',') } : {}),
      ...vault.env(keys),
    };
    if (process.env.FLPT_QA && path.isAbsolute(process.env.FLPT_FIXTURE_TTS || '')) env.FLPT_FIXTURE_TTS = process.env.FLPT_FIXTURE_TTS; // QA only: the conformance fixture's fixed voices (W4-06)
    if (keys.length || paid) delete env.FLPT_FIXTURE_TTS; // fixed QA voices never reach a run with a key
    // the web image: HeyGen only through FLPT's broker, with the job's capability when the host holds one (FLPT_HEYGEN_BASE)
    delete env.FLPT_HEYGEN_BASE;
    delete env.FLPT_HEYGEN_JOB;
    if (broke.heygenBase && keys.includes('HEYGEN_API_KEY')) {
      env.FLPT_HEYGEN_BASE = broke.heygenBase;
      let cap = null;
      try { cap = broke.jobFor ? broke.jobFor('heygen', { kind, token: live.heygen || null }) : null; } catch { cap = null; }
      if (typeof cap === 'string' && JOB.test(cap)) env.FLPT_HEYGEN_JOB = cap;
    }
    // QA only: a paid run's providers at FLPT's loopback stand-in (FLPT_VOICES_V1), never anywhere else
    if (paid && process.env.FLPT_QA && /^http:\/\/127\.0\.0\.1:\d{2,5}\/?$/.test(process.env.FLPT_QA_API_BASE || '')) env.FLPT_QA_API_BASE = process.env.FLPT_QA_API_BASE.replace(/\/$/, '');
    else delete env.FLPT_QA_API_BASE;
    // A film with the FLPT voices' sign-in sends it to the Worker that issued it, the one houseSignIn checked here
    // (fish-house.baseUrl()): the pipeline picks its Worker from this run's own environment (42_guest_voice.py), so the
    // run names it (FLPT_VOICES_URL; QA's stand-in comes from FLPT_QA_API_BASE, set just above), and a film whose
    // pipeline would still pick another Worker is refused before anything runs.
    if (house) {
      const fishHouse = require('./providers/fish-house');
      const want = fishHouse.baseUrl();
      if (fishHouse.HOSTS.test(want)) env.FLPT_VOICES_URL = want;
      else delete env.FLPT_VOICES_URL;
      if (fishHouse.pipelineBase(env) !== want) {
        return Promise.resolve({ code: 2, lines: ['Refused: this film would send your FLPT voices sign-in to another Worker than the one that issued it.'], refused: true });
      }
    }
    let cmd = python;
    let argv = [...pythonArgs, script, ...args];
    let copy = null;
    // where a sandbox is required (the web image), a run that executes what a crew could have touched never runs bare:
    // not without a sandbox here, not when the caller gave none, not when it said `sandbox: false`
    if (!box && MUST_BOX.has(kind) && sandbox.required()) {
      return Promise.resolve({ code: 126, lines: [`Refused: a ${kind} run needs the sandbox here${sandbox.kind() ? '' : ', and it isn\'t available'}.`], refused: true });
    }
    if (box) {
      // only the local runs: anything that needs a key needs the network too
      if (KEYS_FOR[kind].length) return Promise.resolve({ code: 2, lines: [`Refused: a ${kind} run can't be sandboxed.`], refused: true });
      // the caller's sandbox, closed to loopback for the runs that need no network; on Linux, without the variables of
      // this run's own environment that are shaped like a secret
      const b = { ...box, ...(NO_LOOPBACK.has(kind) && box.loopback === undefined ? { loopback: false } : {}), envNames: Object.keys(env) };
      try { [cmd, argv] = sandbox.wrap(python, argv, b); } catch (e) { return Promise.resolve({ code: 126, lines: [`Refused: ${e.message}.`], refused: true }); }
      env.TMPDIR = sandbox.tmpdir(); // the temp folder the sandbox leaves open (/tmp isn't)
      try { copy = presenterCopy(env.AVATAR_PRESENTATION_CONFIG_DIR, box.hidden || sandbox.hiddenDirs()); } catch (e) {
        return Promise.resolve({ code: 126, lines: [redact(`Refused: the presenter settings couldn't be copied (${e.message}).`)], refused: true });
      }
      if (copy) env.AVATAR_PRESENTATION_CONFIG_DIR = copy.dir;
    }
    return new Promise((resolve) => {
      const done = (r) => { if (copy) { try { copy.cleanup(); } catch { /* left in the temp folder */ } } resolve(r); };
      const child = spawn(cmd, argv, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      const tail = [];
      const emit = (raw) => {
        if (!raw) return;
        const line = redact(raw);
        tail.push(line);
        if (tail.length > 400) tail.shift();
        onLine(line);
      };
      // whole lines only: a chunk can end mid-line (or mid-key, which redact must see whole), so each stream keeps its
      // unfinished last line for the next chunk, and hands it on at the end (or past 64 KB without a newline)
      const taker = (stream) => {
        let rest = '';
        stream.setEncoding('utf8');
        stream.on('data', (buf) => {
          const parts = (rest + buf).split(/\r?\n/);
          rest = parts.pop();
          if (rest.length > 1 << 16) { parts.push(rest); rest = ''; }
          for (const raw of parts) emit(raw);
        });
        return () => { const r = rest; rest = ''; emit(r); };
      };
      const flush = [taker(child.stdout), taker(child.stderr)];
      const flushAll = () => { for (const f of flush) f(); };
      if (signal) signal.addEventListener('abort', () => child.kill('SIGTERM'), { once: true });
      child.on('error', (e) => { flushAll(); done({ code: 127, lines: [...tail, redact(`could not start ${path.basename(python)}: ${e.message}`)] }); });
      child.on('close', (code) => { flushAll(); done({ code: code == null ? 1 : code, lines: tail }); });
    });
  }

  const video = (projectDir) => path.join(projectDir, 'presentation', 'video');
  const projectPython = (projectDir) => path.join(video(projectDir), '.venv', 'bin', 'python');

  // ── who presents (presenter.js) ──
  /** The app's own folder (<userData>) when presenterDir is its <userData>/presenter, else null (another profile). */
  const appDir = () => (presenterDir && path.basename(presenterDir) === 'presenter' ? path.dirname(presenterDir) : null);
  /** The app's settings.presenter, when presenterDir is the app's own <userData>/presenter (never another profile). */
  function appPresenter() {
    if (!appDir()) return null;
    const file = path.join(appDir(), 'settings.json');
    try { return fs.existsSync(file) ? require('./settings').createSettings({ dir: path.dirname(presenterDir) }).read().presenter : null; } catch { return null; }
  }
  /** Who presents this episode: presenter.of() with the caller's settings, or the app's. */
  const presenterFor = (projectDir) => (presenterOf ? presenterOf(projectDir) : presenterLib.of(projectDir, appPresenter()));
  /** A run's options with the presenter's environment (a cartoon's) merged over the caller's, and its extra args. */
  function withPresenter(projectDir, opts, extraEnv = {}) {
    const p = presenterFor(projectDir);
    const r = presenterLib.runEnv(p);
    return { p, args: r.args, env: { ...(opts.env || {}), ...extraEnv, ...r.env } };
  }
  /** Whether the last film was made on the draft's path (a cartoon on the Mac's voice): its timeline says so. */
  const filmedOnDraftPath = (projectDir) => {
    try { return JSON.parse(fs.readFileSync(path.join(video(projectDir), 'output', 'presentation.timeline.json'), 'utf8')).draft_final === true; } catch { return false; }
  };
  const saysFree = (p) => presenterLib.isCartoon(p) && !presenterLib.billedBy(p);
  const mainScript = (projectDir) => path.join(video(projectDir), 'generate_presentation_video.py');
  // The runs that promise nothing can be spent need the episode's own copy of the pipeline to know the promise (an
  // episode made before a patch gets it with patchScripts). Without it, they refuse rather than run a plain --final.
  const knowsFlag = (projectDir, flag) => { try { return fs.readFileSync(mainScript(projectDir), 'utf8').includes(`os.environ.get("${flag}") == "1"`); } catch { return false; } };
  const unpatched = (flag) => ({ code: 2, lines: [`Refused: this episode's copy of the pipeline doesn't know ${flag} yet.`], refused: true });

  /** Whether the episode's copy of the pipeline carries a patch's marker (FLPT_STEREO_V1, ...) in any of its scripts. */
  function knows(projectDir, marker) {
    if (!/^FLPT_[A-Z0-9_]+$/.test(String(marker))) return false;
    let names = [];
    try { names = fs.readdirSync(video(projectDir)).filter((n) => n.endsWith('.py')); } catch { return false; }
    return names.some((n) => { try { return fs.readFileSync(path.join(video(projectDir), n), 'utf8').includes(marker); } catch { return false; } });
  }

  /** FLPT's patched copies of the pipeline scripts (the engine's scripts/video/*.py), by name. */
  function engineScripts() {
    try { return fs.readdirSync(engineVideo).filter((n) => n.endsWith('.py') && fs.statSync(path.join(engineVideo, n)).isFile()).sort(); } catch { return []; }
  }

  /**
   * T18: is the episode's pipeline FLPT's own? Every presentation/video/*.py is a plain file equal byte for byte to
   * the engine's copy, and nothing else there could be imported: no .pyc, .so or .pth, and no folder (or link to one)
   * with an importable name holding code at any depth, a package with or without __init__.py (the pipeline's own
   * output, cache and assets aside). A link Python can't import by its name (.venv, presenter.jpg) is fine.
   * { ok, changed: [names in presentation/video] }.
   */
  function trust(projectDir) {
    const dir = video(projectDir);
    const changed = [];
    for (const d of [path.join(projectDir, 'presentation'), dir]) {
      let st = null;
      try { st = fs.lstatSync(d); } catch { /* missing */ }
      if (!st || !st.isDirectory()) return { ok: false, changed: [path.relative(projectDir, d)] };
    }
    if (!fs.existsSync(mainScript(projectDir))) changed.push(path.basename(mainScript(projectDir)));
    const ours = new Set(engineScripts());
    for (const name of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      const st = fs.lstatSync(p);
      if (name.endsWith('.py')) {
        if (!st.isFile() || !ours.has(name) || !fs.readFileSync(p).equals(fs.readFileSync(path.join(engineVideo, name)))) changed.push(name);
      } else if (IMPORTABLE.test(name)) changed.push(name);
      else if (IDENTIFIER.test(name) && !OWN_DIRS.has(name) && holdsCode(p)) changed.push(name); // a package, namespace or not
    }
    return { ok: changed.length === 0, changed };
  }

  /**
   * Free: put FLPT's pipeline back into an episode (T18's Restore). Each changed or missing script is copied from the
   * engine; anything else that Python could import from there is set aside in a new
   * presentation/video/.flpt-set-aside-<time>-<random>/ (kept, never deleted). Returns { ok, restored: [names],
   * setAside: [names], folder }.
   */
  function restore(projectDir) {
    const dir = video(projectDir);
    for (const d of [path.join(projectDir, 'presentation'), dir]) {
      let st = null;
      try { st = fs.lstatSync(d); } catch { /* missing */ }
      if (st && !st.isDirectory()) return { ok: false, restored: [], setAside: [], folder: null, error: `${path.relative(projectDir, d)} isn't a folder` };
    }
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
    let aside = null; // its own new folder each time, so two Restores in the same second never share one
    const setAside = [];
    for (const name of trust(projectDir).changed.filter((n) => !n.includes(path.sep))) {
      const p = path.join(dir, name);
      try { fs.lstatSync(p); } catch { continue; } // missing: copied below
      aside = aside || fs.mkdtempSync(path.join(dir, `.flpt-set-aside-${stamp}-`));
      fs.renameSync(p, path.join(aside, name));
      setAside.push(name);
    }
    const restored = [];
    for (const name of engineScripts()) {
      const p = path.join(dir, name);
      const ref = path.join(engineVideo, name);
      let same = false;
      try { same = fs.lstatSync(p).isFile() && fs.readFileSync(p).equals(fs.readFileSync(ref)); } catch { /* missing */ }
      if (same) continue;
      const tmp = path.join(dir, `.${name}.flpt-tmp`);
      fs.copyFileSync(ref, tmp);
      fs.chmodSync(tmp, 0o755);
      fs.renameSync(tmp, p);
      restored.push(name);
    }
    return { ok: trust(projectDir).ok, restored, setAside, folder: setAside.length ? aside : null };
  }

  /** FLPT's own Python for keyed runs, or null when it isn't set up. */
  function keyedPython() {
    const p = typeof trustedPython === 'function' ? trustedPython() : (trustedPython || venvOnPath(toolEnv()));
    if (!p || !path.isAbsolute(p)) return null;
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { return null; }
  }

  /**
   * A keyed run (check, looks, final): FLPT's Python, the trusted flags, the episode's script only when its pipeline is
   * FLPT's own. Otherwise refused, with `changed` (what differs) so the caller can offer restore().
   */
  function keyed(o) {
    const refuse = (r) => { for (const l of r.lines) (o.onLine || (() => {}))(l); return Promise.resolve(r); };
    const py = keyedPython();
    if (!py) return refuse({ code: 2, lines: ['Refused: FLPT\'s own Python isn\'t set up yet.'], refused: true });
    const t = trust(o.projectDir);
    if (!t.ok) return refuse({ code: 2, lines: [CHANGED], refused: true, changed: t.changed });
    const { projectDir, ...rest } = o;
    return spawnRun({ ...rest, python: py, pythonArgs: TRUSTED_FLAGS }, { projectDir });
  }

  /** Where a free run of this episode may write inside the sandbox, or null when there's no sandbox (or no folder). */
  function sandboxFor(projectDir) {
    const pres = path.join(projectDir, 'presentation');
    if (!sandbox.available() || !fs.existsSync(pres)) return null;
    let hidden = [];
    try { hidden = privateDirs() || []; } catch { /* none */ }
    return { writable: [pres, toolEnv().HYPERFRAMES_FONT_CACHE_DIR], hidden: [...sandbox.hiddenDirs(), ...hidden] };
  }
  /** A free run's options: the caller's sandbox if it gave one, none if it said false, else the episode's. */
  const boxed = (kind, projectDir, opts) => (opts.sandbox === false ? { ...opts, sandbox: null }
    : opts.sandbox ? opts : { ...opts, sandbox: SANDBOXED.has(kind) ? sandboxFor(projectDir) : null });

  /**
   * The deck's fonts as one local stylesheet (data: URLs, so file:// pages may use them), for a slide render with no
   * network: the episode's own snapshot (W4-03's, the files the moving slides draw), else its Google faces fetched
   * once into the font cache, else the method's own font files. Path or null.
   */
  async function deckFontsCss(projectDir) {
    const motion = require('./motion');
    const faces = motion.readDeck(projectDir).faces || [];
    if (!faces.length) return null;
    const cacheDir = fontCacheDir || path.join(os.tmpdir(), 'flpt-deck-fonts');
    const fonts = motion.readFontSnapshot(projectDir, motion.faceHrefs(faces))
      || (await motion.localFonts(faces, cacheDir, fetchImpl)) || motion.vendoredFonts(engineRoot);
    if (!fonts || !fonts.files.length) return null;
    let css = fonts.css;
    for (const f of fonts.files) {
      const type = path.extname(f.name).slice(1).toLowerCase() || 'woff2';
      css = css.split(`assets/fonts/${f.name}`).join(`data:font/${type};base64,${fs.readFileSync(f.path).toString('base64')}`);
    }
    const out = path.join(cacheDir, `deck-${crypto.createHash('sha256').update(css).digest('hex').slice(0, 20)}.css`);
    let same = false;
    try { same = fs.readFileSync(out, 'utf8') === css; } catch { /* not there yet */ }
    if (!same) { // written again unless it's exactly ours (the default folder is a shared temporary one)
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(`${out}.tmp`, css);
      fs.renameSync(`${out}.tmp`, out);
    }
    return out;
  }

  /**
   * The free check (Setup's, GETs only). The twin's: keyed, with HeyGen's look and voice. A cartoon's (FLPT_CARTOON_V1):
   * no avatar is asked for; on the Mac's voice (FLPT_TTS=say) it needs no key and runs in the sandbox with no network
   * (`cartoonCheck`), else it gets only its voice's key (`voiceCheck`); then what the cartoon's own pass needs (Rhubarb,
   * Node, HyperFrames' browser, ffmpeg, the sandbox). Returns { code, lines }.
   */
  async function check(projectDir, opts = {}) {
    const w = withPresenter(projectDir, opts);
    const base = { projectDir, script: mainScript(projectDir), cwd: video(projectDir), ...opts };
    if (!presenterLib.isCartoon(w.p)) return keyed({ kind: 'check', ...base, args: ['--check'] });
    const onLine = opts.onLine || (() => {});
    if (!knows(projectDir, 'FLPT_CARTOON_V1')) { const r = unpatched('FLPT_CARTOON_V1'); for (const l of r.lines) onLine(l); return r; }
    const provider = presenterLib.billedBy(w.p);
    const r = provider
      ? await keyed({ kind: 'voiceCheck', ...base, args: ['--check'], env: w.env, onlyKeys: presenterLib.requiredKeys(w.p) })
      : await run({ kind: 'cartoonCheck', python: projectPython(projectDir), script: base.script, args: ['--check'], cwd: base.cwd,
        ...boxed('cartoonCheck', projectDir, opts), env: { ...w.env, FLPT_TTS: 'say' } });
    if (r.refused) return r;
    const tools = presenterLib.checkTools({ engineRoot, toolEnv, stampDir: appDir() });
    for (const l of tools.lines) onLine(l);
    return { ...r, code: r.code || (tools.ok ? 0 : 1), lines: [...r.lines, ...tools.lines] };
  }

  /** Free: the slide pictures. In a sandbox only when the caller gives one: then with the deck's fonts local. */
  async function render(projectDir, opts = {}) {
    const o = boxed('render', projectDir, opts);
    const script = path.join(video(projectDir), 'render_slides.py');
    if (o.sandbox) {
      // an episode made before local fonts gets them first (anchored: a hand-edited copy is left alone)
      if (fs.existsSync(script) && !fs.readFileSync(script, 'utf8').includes('FLPT_LOCAL_FONTS_V1')) await patchScripts(projectDir, { signal: o.signal });
      const css = await deckFontsCss(projectDir).catch(() => null);
      if (css) o.env = { ...(o.env || {}), FLPT_FONT_CSS: css };
    }
    return run({ kind: 'render', python: projectPython(projectDir), script, cwd: video(projectDir), ...o });
  }

  // Free: bring an episode's own copies of the pipeline scripts up to date with FLPT's patches (they were copied when
  // the episode was made). Anchored and idempotent: a script someone edited by hand is left alone.
  function patchScripts(projectDir, opts = {}) {
    const o = boxed('motion', projectDir, opts);
    return run({ kind: 'motion', python: projectPython(projectDir), script: path.join(engineRoot, 'tools', 'apply_patches.py'), args: ['--video', video(projectDir)], cwd: video(projectDir), ...o });
  }

  return {
    scripts,
    // The free voice every run speaks in when it isn't a provider's: { provider: 'say' | 'kokoro', ok, problem }.
    freeTts: () => ({ provider: voice.provider, ok: voice.ok, problem: voice.problem }),
    // The web host's broker seam (host-web.js): HeyGen's base and the job's capability for each paid run.
    setEdge: (e) => { broke = edgeOf(e); return { heygenBase: broke.heygenBase }; },
    writePresenter,
    readPresenter,
    presenterEnvFile,
    run,
    projectPython,
    healVenv,
    scaffold: (projectDir, basePython, opts = {}) => run({ kind: 'scaffold', python: basePython, script: path.join(scripts, 'scaffold.py'), args: [projectDir], cwd: path.dirname(projectDir), ...opts }),
    // Free: the slide pictures (in a sandbox when the caller gives one, see render above).
    render,
    // Free: the draft with the Mac's own voice (sandboxed). A cartoon presenter's in its bubble (its still, or its clips).
    draft: (projectDir, opts = {}) => {
      const w = withPresenter(projectDir, opts);
      return run({ kind: 'draft', python: projectPython(projectDir), script: path.join(video(projectDir), 'generate_presentation_video.py'), args: ['--draft', ...w.args], cwd: video(projectDir), ...boxed('draft', projectDir, opts), env: w.env });
    },
    // Free (W3-05): a cartoon on the Mac's voice films on the draft's path at final quality (FLPT_DRAFT_FINAL): keyless,
    // sandboxed, no network, presentation.mp4 and its timeline. Refused for an episode whose copy doesn't know it yet.
    cartoonFinal: (projectDir, opts = {}) => {
      if (!knows(projectDir, 'FLPT_DRAFT_FINAL') || !knows(projectDir, 'FLPT_CARTOON_V1')) return Promise.resolve(unpatched('FLPT_DRAFT_FINAL'));
      const w = withPresenter(projectDir, opts, { FLPT_DRAFT_FINAL: '1' });
      if (!presenterLib.isCartoon(w.p)) return Promise.resolve({ code: 2, lines: ['Refused: only a cartoon presenter films on the draft\'s path.'], refused: true });
      return run({ kind: 'cartoonFinal', python: projectPython(projectDir), script: mainScript(projectDir), args: ['--draft', ...w.args], cwd: video(projectDir), ...boxed('cartoonFinal', projectDir, opts), env: w.env });
    },
    presenterOf: presenterFor,
    // Keyed (trusted): the pipeline's checks, and the HeyGen looks. A cartoon's check asks nothing of an avatar (see check).
    check,
    looks: (projectDir, opts = {}) => keyed({ kind: 'looks', projectDir, script: path.join(video(projectDir), 'heygen_picker.py'), args: ['looks'], cwd: video(projectDir), ...opts }),
    // Paid (trusted): one slide through HeyGen, only with a live budget token (the broker also logs the authorisation).
    sampleFinal: (projectDir, budgetToken, opts = {}) => keyed({ kind: 'final', budgetToken, projectDir, script: mainScript(projectDir), args: ['--final', '--slides', '1', '--yes'], cwd: video(projectDir), ...opts }),
    // Paid (trusted): the whole episode, only with a live budget token: HeyGen's for the twin; for a cartoon, its
    // voice's provider's (HeyGen, ElevenLabs or Fish.audio), and narration only (FLPT_CARTOON_V1: no avatar clip).
    final: (projectDir, budgetToken, opts = {}) => {
      const w = withPresenter(projectDir, opts);
      const refuse = (line) => { (opts.onLine || (() => {}))(line); return Promise.resolve({ code: 2, lines: [line], refused: true }); };
      const want = presenterLib.isCartoon(w.p) ? presenterLib.billedBy(w.p) : 'heygen';
      if (!want) return refuse('Refused: a cartoon on the Mac\'s voice films free (cartoonFinal), never with a budget.');
      const holds = (p) => Boolean(broker && [budgetToken, ...Object.values(opts.tokens || {})].some((t) => t && broker.isLive(t, p)));
      if (!holds(want)) return refuse('Refused: this step costs money and has no approved budget.');
      if (presenterLib.isCartoon(w.p) && (!knows(projectDir, 'FLPT_CARTOON_V1') || (want === 'fish' && !knows(projectDir, 'FLPT_VOICES_V1')))) {
        return refuse('Refused: this episode\'s copy of the pipeline doesn\'t know the cartoon presenter yet.');
      }
      return keyed({ kind: 'final', budgetToken, projectDir, script: mainScript(projectDir), args: ['--final', '--yes'], cwd: video(projectDir), ...opts, env: w.env });
    },
    // T18: whether the episode's pipeline is FLPT's own ({ ok, changed }), and the free Restore that makes it so.
    trust,
    restore,
    // Whether the episode's copy of the pipeline carries a patch's marker (check before using the feature).
    knows,
    patchScripts,
    // Free: the method's retime.py for the moving slides (word timings, beats, HyperFrames renders). No keys. Sandboxed.
    retime: (projectDir, args, opts = {}) => run({ kind: 'motion', python: projectPython(projectDir), script: args[0], args: args.slice(1), cwd: path.join(projectDir, 'presentation'), ...boxed('motion', projectDir, opts) }),
    // Free: the filmed episode re-assembled from the cache, now with its moving slides. No keys and no network
    // (FLPT_CACHED_ONLY), so it can't generate or pay for anything: if something isn't cached, it stops. Sandboxed.
    // A film made on the draft's path (a cartoon on the Mac's voice) is put together the same way again (cartoonFinal).
    recompose: async (projectDir, opts = {}) => {
      if (!knowsFlag(projectDir, 'FLPT_CACHED_ONLY')) return unpatched('FLPT_CACHED_ONLY');
      const w = withPresenter(projectDir, opts, { FLPT_CACHED_ONLY: '1' });
      if (saysFree(w.p) || (presenterLib.isCartoon(w.p) && filmedOnDraftPath(projectDir))) {
        if (!knows(projectDir, 'FLPT_DRAFT_FINAL')) return unpatched('FLPT_DRAFT_FINAL');
        const d = withPresenter(projectDir, opts, { FLPT_DRAFT_FINAL: '1' });
        return run({ kind: 'cartoonFinal', python: projectPython(projectDir), script: mainScript(projectDir), args: ['--draft', ...d.args], cwd: video(projectDir), ...boxed('cartoonFinal', projectDir, opts), env: d.env });
      }
      return run({ kind: 'recompose', python: projectPython(projectDir), script: mainScript(projectDir), args: ['--final', '--yes'], cwd: video(projectDir), ...boxed('recompose', projectDir, opts), env: w.env });
    },
    // Free: what filming would cost now, counting only what isn't cached yet (FLPT_ESTIMATE_ONLY: no keys, no network,
    // nothing generated). Needs the slides rendered. Returns { code, lines, estimate } (estimate: see parseEstimate).
    // A cartoon on the Mac's voice: nothing to pay, by construction (no avatar, a free voice).
    estimate: async (projectDir, opts = {}) => {
      if (!knowsFlag(projectDir, 'FLPT_ESTIMATE_ONLY')) return { ...unpatched('FLPT_ESTIMATE_ONLY'), estimate: null };
      const w = withPresenter(projectDir, opts, { FLPT_ESTIMATE_ONLY: '1' });
      if (saysFree(w.p)) return { code: 0, lines: [], estimate: { chars: 0, clips: 0, clipSeconds: 0, clipsTotal: 0, voiceChars: 0 } };
      if (presenterLib.isCartoon(w.p) && !knows(projectDir, 'FLPT_CARTOON_V1')) return { ...unpatched('FLPT_CARTOON_V1'), estimate: null };
      const r = await run({ kind: 'estimate', python: projectPython(projectDir), script: mainScript(projectDir), args: ['--final'], cwd: video(projectDir), ...boxed('estimate', projectDir, opts), env: w.env });
      const est = r.code === 0 ? parseEstimate(r.lines) : null;
      // the guests' own line (FLPT_GUEST_VOICE_V1): each guest provider's characters still to make
      const guests = est ? require('./guestvoice').parseGuests(r.lines) : null;
      return { ...r, estimate: est && guests ? { ...est, guests } : est };
    },
    // Free: the web parts. `source` is another video to make them from (Refine's), with its own .timeline.json beside it.
    // (sandboxed: writes only under presentation/)
    web: (projectDir, opts = {}) => run({ kind: 'web', python: projectPython(projectDir), script: path.join(video(projectDir), 'generate_presentation_video.py'), args: ['--web', ...(opts.source ? ['--web-source', opts.source] : [])], cwd: video(projectDir), ...boxed('web', projectDir, opts) }),
    // Free: the player page (sandboxed).
    player: (projectDir, opts = {}) => run({ kind: 'player', python: projectPython(projectDir), script: path.join(projectDir, 'presentation', 'player', 'build_player.py'), args: [], cwd: path.join(projectDir, 'presentation', 'player'), ...boxed('player', projectDir, opts) }),
    finalOutput: (projectDir) => path.join(video(projectDir), 'output', 'presentation.mp4'),
    editMasterOutput: (projectDir) => path.join(video(projectDir), 'output', 'presentation_for_editing.mov'),
    draftOutput: (projectDir) => path.join(video(projectDir), 'output', 'draft_presentation.mp4'),
    pickerDir: (projectDir) => path.join(video(projectDir), 'output', 'picker'),
  };
}

module.exports = { quietScaffold, createPipeline, parsePresenterEnv, parseEstimate, venvOnPath, freeTtsOf, edgeOf, PRESENTER_DEFAULTS, KEYS_FOR, PAID, KEY_PROVIDER, TRUSTED,
  SANDBOXED, NO_LOOPBACK, MUST_BOX, TRUSTED_FLAGS, CHANGED, HOUSE_TOKEN, HOUSE_SIGNIN, slidesOf };
