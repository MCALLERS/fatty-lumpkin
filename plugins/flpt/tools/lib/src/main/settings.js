'use strict';
// Non-secret settings, schema-validated on the way in (a corrupt file must never break the app) and written
// atomically at mode 0600, the Fatty Lumpkin family way. Secrets never live here: see vault.js.
const fs = require('fs');
const path = require('path');
const os = require('os');

const VIDEO_ROUTES = ['kie', 'higgsfield'];

function defaults() {
  return {
    seenWelcome: false,
    setupComplete: false,
    toolchainMode: 'pinned', // 'pinned' (the app's own tools) | 'system' (tools already on this Mac)
    projectsDir: path.join(os.homedir(), 'Documents', 'FLPT'),
    deliverablesDir: path.join(os.homedir(), 'Desktop'),
    presenter: null, // { lookId, lookName, voiceId, voiceName, engine, bubble: {...} }
    // OpenArt only when filmQuality. Stills moved to Kie.ai on 2026-10-14 (Michael): Higgsfield's API has no Nano Banana
    // Pro and no cut-outs. `v` marks settings saved since then.
    providers: { video: 'kie', stills: 'kie', filmQuality: false, v: 2 },
    libraryDir: '', // the Asset Library; '' = <projectsDir>/Library (see libraryDirOf), else an absolute folder
    ytDlpPath: '', // Clippy's yt-dlp; '' = FLPT's pinned copy, then PATH and the usual places (toolchain.findYtDlp)
  };
}

/** Where the Library lives: the chosen folder, or "Library" inside the projects folder (so it follows that folder). */
function libraryDirOf(s) {
  return s.libraryDir || path.join(s.projectsDir, 'Library');
}

/** The Transitions & Music repository: its own folder beside the Library, in the projects folder. */
function addonsDirOf(s) {
  return path.join(s.projectsDir, 'Transitions & Music');
}

const str = (v, max = 512) => (typeof v === 'string' ? v.slice(0, max) : '');
const id = (v) => (typeof v === 'string' && /^[A-Za-z0-9_\-.:]{1,128}$/.test(v) ? v : '');

const SCHEMA = {
  seenWelcome: (v) => v === true,
  setupComplete: (v) => v === true,
  toolchainMode: (v) => (v === 'system' ? 'system' : 'pinned'),
  projectsDir: (v, d) => (typeof v === 'string' && path.isAbsolute(v) ? v : d.projectsDir),
  deliverablesDir: (v, d) => (typeof v === 'string' && path.isAbsolute(v) ? v : d.deliverablesDir),
  presenter: (v) => {
    if (!v || typeof v !== 'object') return null;
    const lookId = id(v.lookId);
    if (!lookId) return null;
    const engine = ['elevenlabs_v3', 'starfish', 'orca', 'elevenlabs'].includes(v.engine) ? v.engine : 'elevenlabs_v3';
    return { lookId, lookName: str(v.lookName, 120), voiceId: id(v.voiceId), voiceName: str(v.voiceName, 120), engine,
      characterType: v.characterType === 'avatar' ? 'avatar' : 'talking_photo' };
  },
  providers: (v, d) => {
    const p = v && typeof v === 'object' ? v : {};
    return {
      video: VIDEO_ROUTES.includes(p.video) ? p.video : d.providers.video,
      // Before v2 nobody could choose the stills route (no screen for it), so a saved one is the old default.
      stills: p.v === 2 && VIDEO_ROUTES.includes(p.stills) ? p.stills : d.providers.stills,
      filmQuality: p.filmQuality === true,
      v: 2,
    };
  },
  libraryDir: (v) => (typeof v === 'string' && path.isAbsolute(v) ? path.resolve(v) : ''),
  ytDlpPath: (v) => (typeof v === 'string' && path.isAbsolute(v) ? path.resolve(v) : ''),
};

function createSettings({ dir }) {
  const file = path.join(dir, 'settings.json');
  let cache = null;
  let lastPersisted = true;

  function clean(raw) {
    const d = defaults();
    const out = { ...d };
    if (raw && typeof raw === 'object') {
      for (const key of Object.keys(SCHEMA)) {
        if (Object.prototype.hasOwnProperty.call(raw, key)) out[key] = SCHEMA[key](raw[key], d);
      }
    }
    return out;
  }

  function read() {
    if (cache) return cache;
    try { cache = clean(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { cache = clean(null); }
    return cache;
  }

  function write(patch) {
    const next = clean({ ...read(), ...(patch && typeof patch === 'object' ? patch : {}) });
    cache = next;
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, file);
      lastPersisted = true;
    } catch {
      lastPersisted = false;
    }
    return next;
  }

  return { read, write, persisted: () => lastPersisted, file };
}

module.exports = { createSettings, defaults, libraryDirOf, addonsDirOf };
