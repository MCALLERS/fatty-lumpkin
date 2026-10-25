#!/usr/bin/env node
'use strict';
// The animator's tools, for one slide marked for an animation of its own, through the Mac app's animators.js: the same
// tools the app's animator crew gets, as commands. HyperFrames runs through npx here, as the method does on its own.
//   start     set up hyperframes/slide_NN/ from a starter
//   picture   copy a picture from this episode into it
//   timing    the narration's word times, and the slide's time on screen
//   align     time the cued beats to the words, and set the duration
//   snapshot  stills at chosen times
//   render    the preview, checked
//   compare   the last frame beside the approved slide picture
//   done      the animation is finished: rendered if need be, compared, and recorded as the crew's
// On a Mac every command runs inside macOS's sandbox (Seatbelt, as the app's animators do: no network, writes only in
// the slide's folder and the temporary folders, keys.env unreadable), on the pinned HyperFrames (the Mac app's, else
// HyperFrames 0.8.80 fetched once by npx outside the sandbox). Elsewhere there's no sandbox, and each answer says so.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { ROOT, app, places, tools, episodeDir, cli, usageError, main, say, pluginHome } = require('./common');
const { liveEnv, hyperframes, fetchHyperframes, HF_VERSION } = require('./flpt-scene');

const USAGE = `
Usage: flpt-animate <command> [<episode>] --slide <n> [options]
  start [--from deck|whiteboard-sketch|possible-worlds|live-slide] [--fresh]
  picture <path inside presentation/>
  timing
  align
  snapshot --at <seconds,…>
  render [--at <seconds,…>]
  compare
  done
<episode> is the episode's folder (default: the one you're in, else the newest).`;

const OPTIONS = { slide: { type: 'string' }, from: { type: 'string' }, fresh: { type: 'boolean' }, at: { type: 'string' } };
const COMMANDS = ['start', 'picture', 'timing', 'align', 'snapshot', 'render', 'compare', 'done'];

main(async () => {
  const { values, positionals } = cli(USAGE, OPTIONS);
  const [cmd, ...rest] = positionals;
  if (!COMMANDS.includes(cmd)) usageError(USAGE, cmd ? `Unknown command: ${cmd}` : '');
  if (!/^\d+$/.test(String(values.slide || ''))) usageError(USAGE, 'Name the slide with --slide <n>.');
  const animators = app('animators');
  const picture = cmd === 'picture' ? rest.pop() : null;
  if (cmd === 'picture' && !picture) usageError(USAGE, 'picture needs a path inside presentation/.');
  const dir = episodeDir(rest[0]);
  const slide = animators.marked(dir).find((s) => s.n === Number(values.slide));
  if (!slide) throw new Error(`Slide ${values.slide} isn't marked for an animation of its own (deck/project/modules.json, "animate").`);
  const t = tools();
  const pythonFor = path.join(dir, 'presentation', 'video', '.venv', 'bin', 'python');
  const probe = (file) => new Promise((resolve, reject) => execFile(t.ffprobe || 'ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file],
    { timeout: 30000, maxBuffer: 8 << 20 }, (err, out) => (err ? reject(err) : resolve(JSON.parse(String(out))))));
  const sandboxed = app('sandbox').available();
  // inside the sandbox nothing reaches the network, so the commands that render use the pinned copy (fetched once,
  // outside, if need be)
  const renders = ['snapshot', 'render', 'done'].includes(cmd);
  const hf = renders && sandboxed ? fetchHyperframes() : hyperframes();
  if (sandboxed && renders && !hf) throw new Error(`HyperFrames ${HF_VERSION} isn't on this Mac and couldn't be fetched: try again online, or open the Mac app's Setup once.`);
  const env = liveEnv();
  const kit = animators.makeTools(dir, slide, ROOT, {
    exec: animators.createExec({ env, hidden: [places().config], sandboxed }), probe, node: process.execPath, ffmpeg: t.ffmpeg || 'ffmpeg',
    python: fs.existsSync(pythonFor) ? pythonFor : t.python, hyperframes: hf ? hf.cli : ['npx', '-y', 'hyperframes@0.8.80'],
    fontCacheDir: path.join(pluginHome(), 'deck-fonts'),
  });
  const note = sandboxed ? '' : '\n(Not sandboxed: macOS\'s sandbox isn\'t available here.)';
  const at = String(values.at || '').split(',').filter(Boolean).map(Number);
  if (cmd === 'start') say(await kit.start({ from: values.from || 'deck', fresh: Boolean(values.fresh) }) + note);
  if (cmd === 'picture') say(await kit.usePicture({ path: picture }) + note);
  if (cmd === 'timing') say(await kit.timing() + note);
  if (cmd === 'align') say(await kit.align() + note);
  if (cmd === 'snapshot') say(await kit.snapshot({ at }) + note);
  if (cmd === 'render') say(await kit.render({ at }) + note);
  if (cmd === 'compare') say(await kit.compare() + note);
  if (cmd === 'done') {
    const r = await animators.finish(dir, slide, { ok: true }, kit, probe);
    if (!r.ok) throw new Error(r.error);
    const check = r.check || {};
    say(`Slide ${slide.n}'s animation is recorded (hold test ${check.holdDb == null ? 'not measured' : `${check.holdDb} dB`}, last frame ${check.lastDb == null ? 'not compared' : `${check.lastDb} dB against the picture`}).`);
    say(`Preview: ${kit.preview}`);
  }
  return 0;
});
