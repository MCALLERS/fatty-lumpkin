#!/usr/bin/env node
'use strict';
// Fatty Lumpkin Clippy as a command (/flpt:clip), through the app's clippy.js: Michael's yt-dlp recipe clips one
// moment of a video link into the Library, keeping its source URL and timestamps. Only the user runs it: the crew and
// the episode flow never download video.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ROOT, app, places, tools, toolEnv, library, redactor, cli, usageError, main, say } = require('./common');

const USAGE = `
Usage: flpt-clip <link> <start> <end> [<title>] [--wav] [--tags "a, b"] [--notes "…"]
Clips one moment of a video (start and end as h:mm:ss, mm:ss or seconds) into the Library, with its source and
timestamps. --wav also keeps its sound as a 48 kHz WAV. Needs yt-dlp and ffmpeg (FLPT_YTDLP picks a yt-dlp).`;

main(async () => {
  const { values, positionals } = cli(USAGE, { wav: { type: 'boolean' }, tags: { type: 'string' }, notes: { type: 'string' } });
  const [url, start, end, ...title] = positionals;
  const clippy = app('clippy');
  const form = { url, start, end, title: title.join(' '), wav: Boolean(values.wav), tags: values.tags || '', notes: values.notes || '' };
  const v = clippy.validateClip(form);
  if (!v.ok) usageError(USAGE, Object.values(v.errors).join(' '));

  const t = tools();
  const chosen = places().ytDlp;
  const ytDlp = chosen && fs.existsSync(chosen) ? chosen
    : app('toolchain').findYtDlp({ dir: path.join(ROOT, 'no-pinned-tools'), manifestFile: path.join(ROOT, 'no-pinned-tools.json') }).path;
  if (!ytDlp) throw new Error('Clippy needs yt-dlp: brew install yt-dlp');
  if (!t.ffmpeg || !t.ffprobe) throw new Error('Clippy needs ffmpeg: brew install ffmpeg');
  const lib = library();
  // yt-dlp needs HOME for its cache and Node on PATH for YouTube; nothing else from this environment, and no keys.
  const env = { PATH: toolEnv().PATH, HOME: os.homedir(), USER: process.env.USER || '', LANG: 'en_US.UTF-8', TMPDIR: os.tmpdir(), PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' };
  const stop = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => stop.abort());
  if (v.warning) say(v.warning);
  say(`Library: ${lib.dir}`);
  let shown = -25;
  const item = await clippy.clip({ ...form, tags: app('library').cleanTags(form.tags) }, {
    library: lib, media: app('media').createMedia({ ffmpeg: t.ffmpeg, ffprobe: t.ffprobe }), ytDlp, ffmpegDir: path.dirname(t.ffmpeg), env,
    signal: stop.signal, redact: redactor(null),
    onEvent: (ev) => {
      if (ev.phase === 'step') say(ev.text);
      else if (ev.phase === 'progress' && ev.percent >= shown + 25) { shown = ev.percent - (ev.percent % 25); say(`  ${Math.round(ev.percent)} %`); }
      else if (ev.phase === 'line' && /^\$ yt-dlp|ERROR:/.test(ev.line)) say(`  ${ev.line}`);
    },
  });
  say(`Clipped: ${item.id}`);
  say(`  ${item.title}`);
  say(`  ${item.filePath}`);
  say(`  from ${item.clip.url}, ${item.clip.start} to ${item.clip.end}`);
  return 0;
});
