'use strict';
// Where things live. The engine ships outside the asar archive (extraResources), because the Python and Node tools
// it contains run as separate processes that can't read inside an archive.
const path = require('path');
const fs = require('fs');

function engineRoot({ isPackaged, resourcesPath }) {
  if (isPackaged) return path.join(resourcesPath, 'engine');
  // Development: <repo>/engine, two levels up from app/src/main.
  return path.resolve(__dirname, '..', '..', '..', 'engine');
}

/**
 * The transitions and music that ship with the app (app/assets/addons; in the app, Resources/addons, outside the
 * asar archive so ffmpeg can read them). The Transitions & Music window copies them into the user's own folder.
 */
function addonsRoot({ isPackaged, resourcesPath }) {
  if (isPackaged) return path.join(resourcesPath, 'addons');
  return path.resolve(__dirname, '..', '..', 'assets', 'addons');
}

function skillDir(root) { return path.join(root, 'skills', 'avatar-presentation'); }
function scriptsDir(root) { return path.join(skillDir(root), 'scripts'); }

function appDirs(userData) {
  const d = {
    userData,
    toolchain: path.join(userData, 'toolchain'), // pinned ffmpeg, Python, Node, Chrome
    presenter: path.join(userData, 'presenter'), // presenter.env (no secrets) for the pipeline
    logs: path.join(userData, 'logs'),
  };
  for (const p of Object.values(d)) fs.mkdirSync(p, { recursive: true });
  return d;
}

module.exports = { engineRoot, addonsRoot, skillDir, scriptsDir, appDirs };
