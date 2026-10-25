#!/usr/bin/env node
// align-music.mjs · set the times of the beats that ride the music (PLAN §2.14), the way align-beats.mjs sets the
// ones that ride the narration.
//
//   node align-music.mjs <scene-dir> [--grid <grid.json>] [--dry-run]
//
// A beat with `at` gets t from the music's grid (default <scene-dir>/score/grid.json, written by FLPT's score pass,
// in the piece's own time):
//   "bar 2"          the start of bar 2            "beat 9"     the ninth beat
//   "bar 3 beat 2"   the second beat of bar 3      12.5, "12.5s" seconds (no grid needed)
// Beats with `cue` are align-beats.mjs's and are left alone. An `at` the grid can't place keeps its old t and is
// reported. With no grid (no music, or the user's own file, which plays unsnapped) only seconds work.
// A .bak copy of beats.json is kept when writing. Exit 1 when any `at` couldn't be placed.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const { resolveAt } = createRequire(import.meta.url)(join(HERE, '..', 'score', 'flpt-score.js'));

/**
 * Place every `at` beat of a beats.json object on a grid. Changes `slide` in place; returns
 * { placed: [{ at, t }], missed: [{ at, why }] }.
 */
export function alignMusic(slide, grid) {
  const placed = [];
  const missed = [];
  for (const b of (slide && slide.beats) || []) {
    if (!b || b.at == null || b.cue != null) continue;
    const t = resolveAt(grid, b.at);
    if (t == null || (grid && Number.isFinite(grid.seconds) && t >= grid.seconds)) {
      missed.push({ at: b.at, why: grid ? 'past the end of the music' : 'no music grid' });
      continue;
    }
    const v = Math.round(t * 1e6) / 1e6; // to the microsecond: a hit on a beat lands on the beat's own sample
    const rest = { ...b };
    delete rest.t;
    Object.keys(b).forEach((k) => delete b[k]);
    Object.assign(b, { t: v }, rest); // "t" first, as align-beats.mjs keeps it
    placed.push({ at: b.at, t: v });
  }
  return { placed, missed };
}

// beats one per line, as align-beats.mjs writes them
function fmtVal(v) {
  if (Array.isArray(v)) return `[${v.map(fmtVal).join(', ')}]`;
  if (v && typeof v === 'object') return `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${fmtVal(x)}`).join(', ')}}`;
  return JSON.stringify(v);
}
export function formatBeats(j) {
  const { beats, ...rest } = j;
  const top = JSON.stringify(rest, null, 2).replace(/\n}$/, '');
  const lines = (beats || []).map((b) => `    { ${Object.entries(b).map(([k, v]) => `${JSON.stringify(k)}: ${fmtVal(v)}`).join(', ')} }`);
  return `${top === '{}' ? '{' : `${top},`}\n  "beats": [\n${lines.join(',\n')}\n  ]\n}\n`;
}

function main(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i];
    if (!s.startsWith('--')) args._.push(s);
    else if (['dry-run', 'help'].includes(s.slice(2))) args[s.slice(2)] = true;
    else args[s.slice(2)] = argv[++i];
  }
  if (args.help || !args._[0]) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 16).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return args.help ? 0 : 1;
  }
  const dir = resolve(args._[0]);
  const beatsPath = join(dir, 'beats.json');
  if (!existsSync(beatsPath)) { console.error(`align-music.mjs: no beats.json in ${dir}`); return 1; }
  const gridPath = resolve(args.grid || join(dir, 'score', 'grid.json'));
  const grid = existsSync(gridPath) ? JSON.parse(readFileSync(gridPath, 'utf8')) : null;
  const slide = JSON.parse(readFileSync(beatsPath, 'utf8'));
  const { placed, missed } = alignMusic(slide, grid);
  console.log(`align-music: ${grid ? `${grid.bpm} BPM, ${(grid.beats || []).length} beats` : 'no grid (seconds only)'}`);
  for (const p of placed) console.log(`  ✓ ${JSON.stringify(p.at)} → t ${p.t}`);
  for (const m of missed) console.log(`  ✗ ${JSON.stringify(m.at)}: ${m.why}`);
  if (!args['dry-run'] && placed.length) {
    copyFileSync(beatsPath, `${beatsPath}.bak`);
    const text = formatBeats(slide);
    JSON.parse(text);
    writeFileSync(beatsPath, text);
  }
  return missed.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
