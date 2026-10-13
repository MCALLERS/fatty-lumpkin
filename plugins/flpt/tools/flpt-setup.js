#!/usr/bin/env node
'use strict';
// /flpt:setup: what FLPT needs on this Mac. The tools (ffmpeg, Python, Chrome, Node, yt-dlp), which keys are set in
// keys.env (names only: values never leave this process), the presenter profile, and the folders.
const fs = require('fs');
const path = require('path');
const { ROOT, app, places, tools, readEnvFile, isSecret, cli, main, say, exists } = require('./common');

const USAGE = `
Usage: flpt-setup
Checks ffmpeg, Python, Chrome, Node and yt-dlp, and which keys are set in keys.env (by name, never the values).`;

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

async function version(file, args, re) {
  const r = await app('media').run(file, args, { timeout: 20000 });
  const m = `${r.out}\n${r.err}`.match(re);
  return m ? m[1] : null;
}

main(async () => {
  cli(USAGE);
  const p = places();
  const t = tools();
  const toolchain = app('toolchain');
  const yt = p.ytDlp && fs.existsSync(p.ytDlp) ? p.ytDlp
    : toolchain.findYtDlp({ dir: path.join(ROOT, 'no-pinned-tools'), manifestFile: path.join(ROOT, 'no-pinned-tools.json') }).path;
  const rows = [
    ['ffmpeg', t.ffmpeg && t.ffprobe ? await version(t.ffmpeg, ['-version'], /ffmpeg version (\S+)/) : null, t.ffmpeg && t.ffprobe ? t.ffmpeg : null, 'brew install ffmpeg', true],
    ['Python', t.python ? await version(t.python, ['--version'], /Python (\S+)/) : null, t.python, 'brew install python', true],
    ['Chrome', t.chrome ? await version(t.chrome, ['--version'], /(\d+\.\d+\.\d+\.\d+)/) : null, t.chrome, 'install Google Chrome from google.com/chrome', true],
    ['Node', process.versions.node, t.node, 'brew install node', true],
    ['yt-dlp', yt ? await toolchain.ytDlpVersion(yt) : null, yt, 'brew install yt-dlp (only /flpt:clip needs it)', false],
  ];
  const todo = [];
  say('FLPT setup');
  say('Tools');
  for (const [name, ver, where, fix, needed] of rows) {
    say(`  ${where ? '✓' : needed ? '✗' : '·'} ${`${name} ${where ? ver || '' : 'not found'}`.padEnd(26)} ${where || (needed ? '' : 'optional: only /flpt:clip needs it')}`);
    if (!where && needed) todo.push(`Install ${name}: ${fix}`);
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
