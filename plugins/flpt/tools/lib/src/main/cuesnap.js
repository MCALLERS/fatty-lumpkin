'use strict';
// The cue-word snap's speech recogniser (W4-11; engine/tools/patches/43_cue_snap.py, FLPT_CUE_SNAP_V1): after FLPT's
// silence aligner (real-words.py), each beat's cue word takes faster-whisper's start for it when the two agree within
// 0.3 s. Whisper is optional and FLPT's own: it is used only when it is in FLPT's toolchain (its venv has faster-whisper
// and Setup fetched a model into <toolchain>/whisper/model on a click); it is never downloaded here, and runs offline.
//   env(toolchainDir)   what a pipeline run's environment adds for it: { FLPT_WHISPER_PYTHON, FLPT_WHISPER_MODEL }, or
//                       {} without it (the aligner's words stand). toolchain.processEnv merges it in (W4-03's file).
//   paths(toolchainDir) where it would be: { python, model, ready }
// Electron-free; the plugin has a copy in engine/tools/lib.
const fs = require('fs');
const path = require('path');

const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };

/** Where FLPT's whisper would be in a toolchain folder, and whether it's all there (a model with its weights). */
function paths(dir) {
  const python = path.join(String(dir || ''), 'venv', 'bin', 'python');
  const model = path.join(String(dir || ''), 'whisper', 'model');
  let pkg = false;
  try {
    const lib = path.join(String(dir || ''), 'venv', 'lib');
    pkg = fs.readdirSync(lib).some((v) => /^python3\.\d+$/.test(v) && exists(path.join(lib, v, 'site-packages', 'faster_whisper', '__init__.py')));
  } catch { pkg = false; }
  return { python, model, ready: Boolean(dir) && path.isAbsolute(String(dir)) && pkg && exists(python) && exists(path.join(model, 'model.bin')) };
}

/** The pipeline environment's two variables when FLPT's whisper is there, else nothing. */
function env(dir) {
  const p = paths(dir);
  return p.ready ? { FLPT_WHISPER_PYTHON: p.python, FLPT_WHISPER_MODEL: p.model } : {};
}

module.exports = { env, paths, SNAP_S: 0.3, MARKER: 'FLPT_CUE_SNAP_V1' };
