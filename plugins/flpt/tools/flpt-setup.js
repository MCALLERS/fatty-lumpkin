#!/usr/bin/env node
'use strict';
// /flpt:setup: what FLPT needs on this Mac. The tools (ffmpeg, Python, Chrome, Node, HyperFrames, yt-dlp) and where they
// come from (FLPT's pinned ones: the Mac app's when they match the plugin's pins, else the plugin's own; else this
// Mac's), FLPT's own Python for the runs that get keys, which keys are set in keys.env (names only: values never leave
// this process), the presenter profile, and the folders.
//   --python         makes the plugin's own Python (a venv with requests and numpy, from requirements.lock where it can)
//                    when the Mac app's isn't there: free, it downloads the packages once.
//   --install-tools  installs FLPT's pinned tools (the Mac app's exact versions, checksum-verified) into the plugin's own
//                    folder, for any the Mac app doesn't have at the same pins, and its Python from requirements.lock:
//                    free downloads, once. Nothing is written into the Mac app's folder.
const fs = require('fs');
const path = require('path');
const { ROOT, app, appFile, places, tools, toolEnv, readEnvFile, isSecret, cli, main, say, exists, pluginHome, keyedPython, pinned } = require('./common');

const USAGE = `
Usage: flpt-setup [--python] [--install-tools]
Checks ffmpeg, Python, Chrome, Node, HyperFrames and yt-dlp, and which keys are set in keys.env (by name, never the values).
  --python          makes FLPT's own Python for the steps that use your keys (checks and filming), unless the Mac app's is there
  --install-tools   installs FLPT's pinned tools (the Mac app's versions) into the plugin's own folder, where the Mac app has none at those pins`;

// What each key does here. Claude Code runs on your own Claude subscription, so no Anthropic key is needed.
const USE = {
  HEYGEN_API_KEY: 'filming: your avatar',
  ELEVENLABS_API_KEY: 'optional: an ElevenLabs voice',
  GEMINI_API_KEY: 'optional: a Gemini voice',
  KIE_API_KEY: 'optional: cut scenes and cartoons on Kie.ai',
  HIGGSFIELD_CREDENTIALS: 'optional: cut scenes and cartoons on Higgsfield',
  OPENART_API_KEY: 'optional: "film quality" on OpenArt',
  OPENAI_API_KEY: 'optional',
  FISH_API_KEY: 'optional: stinger voices',
};
const PINNED = ['ffmpeg', 'python', 'chrome', 'node', 'hyperframes'];
const MB = (n) => `${Math.round(n / 1e6)} MB`;

async function version(file, args, re) {
  const r = await app('media').run(file, args, { timeout: 20000 });
  const m = `${r.out}\n${r.err}`.match(re);
  return m ? m[1] : null;
}

/** Where a pinned tool came from, in a word: the Mac app's folder or the plugin's own. */
const fromOf = (p, id) => (p.tools[id] ? (p.tools[id].dir === p.dirs.app ? 'pinned, the Mac app\'s' : 'pinned') : null);

/** FLPT's pinned tools into the plugin's own folder, for each the Mac app doesn't hold at these pins; then its Python. */
async function installTools() {
  const tc = app('toolchain');
  let p = pinned();
  if (!p.manifestFile) throw new Error('This copy of FLPT has no toolchain manifest, so it has no pins to install.');
  const manifest = tc.readManifest(p.manifestFile);
  if (!(manifest.platforms || []).includes(tc.platformKey())) throw new Error(`FLPT's tools aren't pinned for ${tc.platformKey()}.`);
  const own = p.dirs.own;
  fs.mkdirSync(own, { recursive: true });
  let last = '';
  const onProgress = (e) => {
    const line = e.phase === 'download' && e.label ? `  ${e.label}: downloading${e.total ? ` (${MB(e.total)})` : ''}` : e.phase === 'done' ? `  ${e.id}: ✓` : e.phase === 'npm' ? `  ${e.label}: npm ci` : '';
    if (line && line !== last) { say(line); last = line; }
  };
  const need = ['ffmpeg', 'python', 'chrome', 'node'].filter((id) => !p.tools[id]);
  if (need.length) {
    const size = need.flatMap((id) => (tc.entryFor(manifest, id) || {}).downloads || []).reduce((n, d) => n + (d.size || 0), 0);
    say(`Installing FLPT's pinned ${need.join(', ')} into ${own} (${MB(size)}, checksums verified) …`);
    await tc.install({ dir: own, manifestFile: p.manifestFile, only: need, onProgress });
    p = pinned({ fresh: true });
  }
  if (!p.tools.hyperframes) {
    if (!p.lockDir) throw new Error('This copy of FLPT has no HyperFrames lockfile, so moving slides can\'t be pinned here.');
    say(`Installing HyperFrames ${(tc.entryFor(manifest, 'hyperframes') || {}).version} and its headless Chrome into ${own} …`);
    await tc.setupHyperFrames({ dir: own, manifestFile: p.manifestFile, node: p.tools.node.path, lockDir: p.lockDir, onProgress });
    p = pinned({ fresh: true });
  }
  // FLPT's Python for keyed runs: the Mac app's venv when it came from this lock, else the plugin's own, from the lock
  const py = p.tools.python;
  if (py && !(py.dir === p.dirs.app && py.locked) && !tc.pythonLocked(own, p.lockFile || undefined)) {
    say(`Making FLPT's own Python in ${path.join(own, 'venv')} from requirements.lock …`);
    await tc.setupPython({ dir: own, pythonBase: py.path, lockFile: p.lockFile || undefined, strict: true, onProgress });
    p = pinned({ fresh: true });
  }
  return p;
}

main(async () => {
  const { values } = cli(USAGE, { python: { type: 'boolean' }, 'install-tools': { type: 'boolean' } });
  const p = places();
  if (values['install-tools']) await installTools();
  const t = tools();
  if (values.python && !keyedPython()) {
    if (!t.python) throw new Error('Python 3 isn\'t installed (brew install python).');
    say(`Making FLPT's own Python in ${path.join(pluginHome(), 'venv')} …`);
    await app('toolchain').setupPython({ dir: pluginHome(), pythonBase: t.python, lockFile: appFile('python', 'requirements.lock') || undefined });
  }
  const pin = pinned();
  const keyed = keyedPython();
  const toolchain = app('toolchain');
  const yt = p.ytDlp && fs.existsSync(p.ytDlp) ? p.ytDlp
    : toolchain.findYtDlp({ dir: path.join(ROOT, 'no-pinned-tools'), manifestFile: path.join(ROOT, 'no-pinned-tools.json') }).path;
  // the HyperFrames moving slides render with here: FLPT's pinned copy, else the one flpt-scene finds (toolEnv)
  const hfCli = toolEnv().FLPT_HYPERFRAMES || null;
  const hfVersion = (() => { try { return JSON.parse(fs.readFileSync(path.join(path.dirname(hfCli), '..', 'package.json'), 'utf8')).version; } catch { return null; } })();
  const rows = [
    ['ffmpeg', t.ffmpeg && t.ffprobe ? await version(t.ffmpeg, ['-version'], /ffmpeg version (\S+)/) : null, t.ffmpeg && t.ffprobe ? t.ffmpeg : null, 'brew install ffmpeg', true, fromOf(pin, 'ffmpeg')],
    ['Python', t.python ? await version(t.python, ['--version'], /Python (\S+)/) : null, t.python, 'brew install python', true, fromOf(pin, 'python')],
    ['Chrome', t.chrome ? await version(t.chrome, ['--version'], /(\d+\.\d+\.\d+\.\d+)/) : null, t.chrome, 'install Google Chrome from google.com/chrome', true, fromOf(pin, 'chrome')],
    ['Node', pin.tools.node ? await version(t.node, ['--version'], /v(\S+)/) : process.versions.node, t.node, 'brew install node', true, fromOf(pin, 'node')],
    ['HyperFrames', hfVersion, hfCli, '', false, pin.tools.hyperframes && pin.tools.hyperframes.cli === hfCli ? fromOf(pin, 'hyperframes') : null],
    ['FLPT Python', keyed ? await version(keyed, ['--version'], /Python (\S+)/) : null, keyed, '', false, null],
    ['yt-dlp', yt ? await toolchain.ytDlpVersion(yt) : null, yt, 'brew install yt-dlp (only /flpt:clip needs it)', false, null],
  ];
  const todo = [];
  const WHY = { 'FLPT Python': 'for the steps that use your keys', HyperFrames: 'moving slides stay still without it', 'yt-dlp': 'optional: only /flpt:clip needs it' };
  say('FLPT setup');
  say(`Tools: ${pin.mode === 'pinned' ? `FLPT's pinned toolchain (${pin.manifest}, ${pin.platform})` : 'this Mac\'s own (episodes made here say "toolchain: system")'}`);
  for (const [name, ver, where, fix, needed, from] of rows) {
    say(`  ${where ? '✓' : needed ? '✗' : '·'} ${`${name} ${where ? ver || '' : 'not found'}`.padEnd(26)} ${where ? `${where}${from ? ` (${from})` : ''}` : (needed ? '' : WHY[name])}`);
    if (!where && needed) todo.push(`Install ${name}: ${fix}`);
  }
  if (!keyed && t.python) todo.push(`Before checks and filming, make FLPT's own Python (free, once): node "${__filename}" --python`);
  if (pin.mode !== 'pinned' && pin.manifestFile) {
    const missing = PINNED.filter((id) => !pin.tools[id]);
    todo.push(`FLPT's pinned tools, for the Mac app's exact output (free, once; ${missing.join(', ')}): node "${__filename}" --install-tools`);
  }
  if (process.platform !== 'darwin') todo.push('FLPT\'s method is made for macOS (the free draft uses its voice; thumbnails use sips).');

  const keysFile = path.join(p.config, 'keys.env');
  const keys = readEnvFile(keysFile);
  say(`Keys in ${keysFile}${exists(keysFile) ? '' : ' (not there yet)'}: ✓ set, · not set (names only)`);
  for (const [name, use] of Object.entries(USE)) say(`  ${keys[name] ? '✓' : '·'} ${name.padEnd(24)} ${use}`);
  const others = Object.keys(keys).filter((k) => isSecret(k) && keys[k] && !USE[k] && k !== 'ANTHROPIC_API_KEY');
  if (others.length) say(`  + ${others.length} other key(s)`);
  try {
    if (exists(keysFile) && (fs.statSync(keysFile).mode & 0o077)) todo.push(`Make keys.env private: chmod 600 "${keysFile}"`);
  } catch { /* unreadable: the scripts will say so */ }
  const setKeys = `python3 "${path.join(ROOT, 'skills', 'avatar-presentation', 'scripts', 'video', 'set_keys.py')}" --global heygen`;
  if (!keys.HEYGEN_API_KEY) todo.push(`Before filming, add your HeyGen key in your own Terminal, not in chat (it asks in a hidden dialog):\n      ${setKeys}`);

  const profile = { ...readEnvFile(path.join(p.config, 'presenter.env')), ...Object.fromEntries(Object.entries(keys).filter(([k]) => !isSecret(k))) };
  const presenter = Boolean(profile.HEYGEN_AVATAR_ID);
  say(`Presenter (presenter.env): ${presenter ? '✓ your look is set' : '· not set yet'}`);
  if (!presenter) todo.push('Before filming, pick your presenter\'s look and voice: ask Claude to "set up my HeyGen presenter".');

  let items = 0;
  try { items = fs.readdirSync(path.join(p.library, 'items')).length; } catch { /* no Library yet */ }
  say('Folders');
  say(`  episodes    ${p.projects}`);
  say(`  Library     ${p.library} (${items} item${items === 1 ? '' : 's'})`);
  say(`  deliveries  ${p.deliverables}`);
  say();
  const blocking = todo.filter((x) => x.startsWith('Install'));
  say(blocking.length ? 'To do first:' : todo.length ? 'Ready to plan an episode (/flpt:new). Still to do:' : 'Ready: /flpt:new starts an episode.');
  for (const x of todo) say(`  - ${x}`);
  return blocking.length ? 1 : 0;
});
