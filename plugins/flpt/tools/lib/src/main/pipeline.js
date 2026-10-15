'use strict';
// Runs the vendored pipeline scripts (engine/skills/avatar-presentation/scripts) as child processes.
// This is the only place keys leave the vault:
//   - each command names the keys it needs, and only those are put into that one process's environment
//   - FLPT_ENV_KEYS=1 tells the (patched) pipeline to read them from the environment, so nothing is written to disk
//   - every output line is redacted before it reaches the renderer or a log
// The presenter profile (look, voice, bubble: no secrets) is written to the app's own presenter.env, which the
// pipeline finds through AVATAR_PRESENTATION_CONFIG_DIR.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { scriptsDir } = require('./paths');
const sandbox = require('./sandbox');

// What each command may see. Anything not listed gets no keys at all.
const KEYS_FOR = {
  scaffold: [],
  render: [],
  draft: [],
  check: ['HEYGEN_API_KEY', 'ELEVENLABS_API_KEY', 'GEMINI_API_KEY'],
  looks: ['HEYGEN_API_KEY'],
  voices: ['HEYGEN_API_KEY'],
  final: ['HEYGEN_API_KEY', 'ELEVENLABS_API_KEY', 'GEMINI_API_KEY'],
  web: [],
  player: [],
  motion: [], // moving slides: word timings and HyperFrames renders, all local
  recompose: [], // the filmed episode put back together from the cache, with no network (FLPT_CACHED_ONLY)
  estimate: [], // what filming would make that isn't cached yet, with no network (FLPT_ESTIMATE_ONLY)
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

// Commands that spend money, and the provider whose approved budget they need (see broker.js).
const PAID = { final: 'heygen' };

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
  'BUBBLE_MARGIN', 'GEMINI_VOICE', 'GEMINI_TTS_MODEL', 'ELEVENLABS_VOICE_ID', 'ELEVENLABS_MODEL']);

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

function createPipeline({ engineRoot, presenterDir, vault, redact, toolEnv, broker }) {
  const scripts = scriptsDir(engineRoot);

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
   */
  function run({ kind, python, script, args = [], cwd, onLine = () => {}, signal, budgetToken, env: extraEnv = {}, sandbox: box = null }) {
    if (!Object.prototype.hasOwnProperty.call(KEYS_FOR, kind)) throw new Error(`unknown pipeline command: ${kind}`);
    if (PAID[kind] && !(broker && budgetToken && broker.isLive(budgetToken, PAID[kind]))) {
      return Promise.resolve({ code: 2, lines: ['Refused: this step costs money and has no approved budget.'], refused: true });
    }
    const env = {
      ...toolEnv(),
      HOME: process.env.HOME,
      USER: process.env.USER,
      LANG: 'en_US.UTF-8',
      AVATAR_PRESENTATION_CONFIG_DIR: presenterDir,
      FLPT_ENV_KEYS: '1',
      PYTHONUNBUFFERED: '1',
      ...extraEnv,
      ...vault.env(KEYS_FOR[kind]),
    };
    let cmd = python;
    let argv = [script, ...args];
    if (box) {
      // only the local runs: anything that needs a key needs the network too
      if (KEYS_FOR[kind].length) return Promise.resolve({ code: 2, lines: [`Refused: a ${kind} run can't be sandboxed.`], refused: true });
      try { [cmd, argv] = sandbox.wrap(python, argv, box); } catch (e) { return Promise.resolve({ code: 126, lines: [`Refused: ${e.message}.`], refused: true }); }
      env.TMPDIR = sandbox.tmpdir(); // the temp folder the sandbox leaves open (/tmp isn't)
    }
    return new Promise((resolve) => {
      const child = spawn(cmd, argv, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      const tail = [];
      const take = (buf) => {
        for (const raw of String(buf).split(/\r?\n/)) {
          if (!raw) continue;
          const line = redact(raw);
          tail.push(line);
          if (tail.length > 400) tail.shift();
          onLine(line);
        }
      };
      child.stdout.on('data', take);
      child.stderr.on('data', take);
      if (signal) signal.addEventListener('abort', () => child.kill('SIGTERM'), { once: true });
      child.on('error', (e) => resolve({ code: 127, lines: [...tail, redact(`could not start ${path.basename(python)}: ${e.message}`)] }));
      child.on('close', (code) => resolve({ code: code == null ? 1 : code, lines: tail }));
    });
  }

  const video = (projectDir) => path.join(projectDir, 'presentation', 'video');
  const projectPython = (projectDir) => path.join(video(projectDir), '.venv', 'bin', 'python');
  const mainScript = (projectDir) => path.join(video(projectDir), 'generate_presentation_video.py');
  // The runs that promise nothing can be spent need the episode's own copy of the pipeline to know the promise (an
  // episode made before a patch gets it with patchScripts). Without it, they refuse rather than run a plain --final.
  const knows = (projectDir, flag) => { try { return fs.readFileSync(mainScript(projectDir), 'utf8').includes(`os.environ.get("${flag}") == "1"`); } catch { return false; } };
  const unpatched = (flag) => ({ code: 2, lines: [`Refused: this episode's copy of the pipeline doesn't know ${flag} yet.`], refused: true });

  return {
    scripts,
    writePresenter,
    readPresenter,
    presenterEnvFile,
    run,
    projectPython,
    scaffold: (projectDir, basePython, opts = {}) => run({ kind: 'scaffold', python: basePython, script: path.join(scripts, 'scaffold.py'), args: [projectDir], cwd: path.dirname(projectDir), ...opts }),
    render: (projectDir, opts = {}) => run({ kind: 'render', python: projectPython(projectDir), script: path.join(video(projectDir), 'render_slides.py'), cwd: video(projectDir), ...opts }),
    draft: (projectDir, opts = {}) => run({ kind: 'draft', python: projectPython(projectDir), script: path.join(video(projectDir), 'generate_presentation_video.py'), args: ['--draft'], cwd: video(projectDir), ...opts }),
    check: (projectDir, opts = {}) => run({ kind: 'check', python: projectPython(projectDir), script: path.join(video(projectDir), 'generate_presentation_video.py'), args: ['--check'], cwd: video(projectDir), ...opts }),
    looks: (projectDir, opts = {}) => run({ kind: 'looks', python: projectPython(projectDir), script: path.join(video(projectDir), 'heygen_picker.py'), args: ['looks'], cwd: video(projectDir), ...opts }),
    // Paid: one slide through HeyGen, only with a live budget token (the broker also logs the authorisation).
    sampleFinal: (projectDir, budgetToken, opts = {}) => run({ kind: 'final', budgetToken, python: projectPython(projectDir), script: path.join(video(projectDir), 'generate_presentation_video.py'), args: ['--final', '--slides', '1', '--yes'], cwd: video(projectDir), ...opts }),
    // Paid: the whole episode through HeyGen, only with a live budget token.
    final: (projectDir, budgetToken, opts = {}) => run({ kind: 'final', budgetToken, python: projectPython(projectDir), script: path.join(video(projectDir), 'generate_presentation_video.py'), args: ['--final', '--yes'], cwd: video(projectDir), ...opts }),
    // Free: bring an episode's own copies of the pipeline scripts up to date with FLPT's patches (they were copied when
    // the episode was made). Anchored and idempotent: a script someone edited by hand is left alone.
    patchScripts: (projectDir, opts = {}) => run({ kind: 'motion', python: projectPython(projectDir), script: path.join(engineRoot, 'tools', 'apply_patches.py'), args: ['--video', video(projectDir)], cwd: video(projectDir), ...opts }),
    // Free: the method's retime.py for the moving slides (word timings, beats, HyperFrames renders). No keys.
    retime: (projectDir, args, opts = {}) => run({ kind: 'motion', python: projectPython(projectDir), script: args[0], args: args.slice(1), cwd: path.join(projectDir, 'presentation'), ...opts }),
    // Free: the filmed episode re-assembled from the cache, now with its moving slides. No keys and no network
    // (FLPT_CACHED_ONLY), so it can't generate or pay for anything: if something isn't cached, it stops.
    recompose: async (projectDir, opts = {}) => (knows(projectDir, 'FLPT_CACHED_ONLY')
      ? run({ kind: 'recompose', python: projectPython(projectDir), script: mainScript(projectDir), args: ['--final', '--yes'], cwd: video(projectDir), ...opts, env: { FLPT_CACHED_ONLY: '1' } })
      : unpatched('FLPT_CACHED_ONLY')),
    // Free: what filming would cost now, counting only what isn't cached yet (FLPT_ESTIMATE_ONLY: no keys, no network,
    // nothing generated). Needs the slides rendered. Returns { code, lines, estimate } (estimate: see parseEstimate).
    estimate: async (projectDir, opts = {}) => {
      if (!knows(projectDir, 'FLPT_ESTIMATE_ONLY')) return { ...unpatched('FLPT_ESTIMATE_ONLY'), estimate: null };
      const r = await run({ kind: 'estimate', python: projectPython(projectDir), script: mainScript(projectDir), args: ['--final'], cwd: video(projectDir), ...opts, env: { FLPT_ESTIMATE_ONLY: '1' } });
      return { ...r, estimate: r.code === 0 ? parseEstimate(r.lines) : null };
    },
    // Free: the web parts. `source` is another video to make them from (Refine's), with its own .timeline.json beside it.
    web: (projectDir, opts = {}) => run({ kind: 'web', python: projectPython(projectDir), script: path.join(video(projectDir), 'generate_presentation_video.py'), args: ['--web', ...(opts.source ? ['--web-source', opts.source] : [])], cwd: video(projectDir), ...opts }),
    player: (projectDir, opts = {}) => run({ kind: 'player', python: projectPython(projectDir), script: path.join(projectDir, 'presentation', 'player', 'build_player.py'), args: [], cwd: path.join(projectDir, 'presentation', 'player'), ...opts }),
    finalOutput: (projectDir) => path.join(video(projectDir), 'output', 'presentation.mp4'),
    editMasterOutput: (projectDir) => path.join(video(projectDir), 'output', 'presentation_for_editing.mov'),
    draftOutput: (projectDir) => path.join(video(projectDir), 'output', 'draft_presentation.mp4'),
    pickerDir: (projectDir) => path.join(video(projectDir), 'output', 'picker'),
  };
}

module.exports = { createPipeline, parsePresenterEnv, parseEstimate, PRESENTER_DEFAULTS, KEYS_FOR, PAID };
