#!/usr/bin/env node
'use strict';
// The script measure the app's crew calls script_stats (stagetools.js + slop.js): words and estimated seconds per
// slide, the total against the target, the slop score and the um count.
const { app, episodeDir, cli, usageError, main, say } = require('./common');

const USAGE = `
Usage: flpt-script-stats [<episode>] [--minutes <target>]
Measures presentation/script.md. The target length comes from the episode, or --minutes for a folder without
flpt-project.json. <episode> defaults to the one you're in, else the newest.`;

main(async () => {
  const { positionals, values } = cli(USAGE, { minutes: { type: 'string' } });
  const dir = episodeDir(positionals[0]);
  const st = app('episode').read(dir);
  const minutes = values.minutes != null ? Number(values.minutes) : st && st.intake && st.intake.minutes;
  if (!(minutes > 0)) usageError(USAGE, values.minutes != null ? '--minutes is a number of minutes.' : 'This folder has no flpt-project.json: give the target with --minutes.');
  say(`Episode: ${dir}`);
  say(app('stagetools').scriptStats(dir, { minutes }));
});
