#!/usr/bin/env node
'use strict';
// The deck check the app's crew calls check_deck (stagetools.js): the layout check (layoutqa.js) on every slide in
// headless Chrome, then the method's render_slides.py, then any user call not yet recorded in modules.json.
const fs = require('fs');
const path = require('path');
const { ROOT, app, tools, episodeDir, pipeline, cli, main, say } = require('./common');

const USAGE = `
Usage: flpt-check-deck [<episode>]
Renders the deck to presentation/slides/ and reports overflow, overlapping text, text in the presenter's corner,
text under 24 px and wordy slides, plus the rendered PNGs. <episode> defaults to the one you're in, else the newest.`;

main(async () => {
  const { positionals } = cli(USAGE);
  const dir = episodeDir(positionals[0]);
  const pl = pipeline(dir);
  say(`Episode: ${dir}`);
  if (!fs.existsSync(pl.projectPython(dir))) {
    throw new Error(`This episode has no Python environment yet. Make it (it keeps every existing file) with:\n  python3 "${path.join(ROOT, 'skills', 'avatar-presentation', 'scripts', 'scaffold.py')}" "${dir}"`);
  }
  say(await app('stagetools').checkDeck(dir, { pipeline: pl, chrome: tools().chrome }));
});
