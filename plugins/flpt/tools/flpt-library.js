#!/usr/bin/env node
'use strict';
// The Library from Claude Code, through the app's library.js: the same folder the Mac app uses, so both share it.
// Links are recorded with their title and picture, and a video link is only ever recorded: video comes in only
// through /flpt:clip, which the user runs. --crew marks the crew's own finds and holds them to the app's crew rules
// (public links and pictures only).
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { app, places, episodeDir, library, cli, usageError, main, say } = require('./common');
const { writeLibraryHtml } = require('./library-html');

const USAGE = `
Usage: flpt-library <command> …
  search <words…> [--kind <kind>] [--tag <tag>] [--limit <n>]
  list [--kind <kind>] [--limit <n>]
  add <file-or-link>… [--title "…"] [--notes "…"] [--tags "a, b"] [--kind <kind>] [--crew]
  use <id> [<episode>]         copy an item into the episode (presentation/assets/library/)
  import [<folder>]            a Cutaway Library, read-only (default: ~/Projects/Cutaway Library)
  html [--open]                write library.html, the Library as a wall of pictures, and maybe open it
  open                         the same as html --open
Kinds: ${app('library').KINDS.join(', ')}. The Library: FLPT_LIBRARY, else the Mac app's, else ~/Documents/FLPT/Library.`;

const OPTIONS = { kind: { type: 'string' }, tag: { type: 'string' }, limit: { type: 'string' }, title: { type: 'string' }, notes: { type: 'string' },
  tags: { type: 'string' }, crew: { type: 'boolean' }, open: { type: 'boolean' } };
const CUTAWAY = path.join(os.homedir(), 'Projects', 'Cutaway Library');
const { shortTime, parseTime } = app('timecode');

/** One line per item: id, kind, title, where it's from, and a clip's moment. */
function row(it) {
  const where = it.source.site || it.source.url || '';
  const moment = it.clip && it.clip.start ? ` · ${shortTime(parseTime(it.clip.start))}–${shortTime(parseTime(it.clip.end))}` : '';
  const tags = it.tags.length ? ` · #${it.tags.slice(0, 5).join(' #')}` : '';
  return `  ${it.id}  ${it.kind.padEnd(10)} ${it.title}${where ? ` · ${where}` : ''}${moment}${tags}`;
}

function listing(items, limit) {
  const n = Number(limit) > 0 ? Number(limit) : 25;
  for (const it of items.slice(0, n)) say(row(it));
  if (items.length > n) say(`  … and ${items.length - n} more (--limit)`);
}

main(async () => {
  const { values, positionals } = cli(USAGE, OPTIONS);
  const [cmd, ...rest] = positionals;
  const { KINDS } = app('library');
  if (values.kind && !KINDS.includes(values.kind)) usageError(USAGE, `--kind is one of: ${KINDS.join(', ')}.`);
  if (!['search', 'list', 'add', 'use', 'import', 'html', 'open'].includes(cmd)) usageError(USAGE, cmd ? `Unknown command: ${cmd}` : '');
  const lib = library();
  say(`Library: ${lib.dir}`);

  if (cmd === 'search') {
    if (!rest.length && !values.kind && !values.tag) usageError(USAGE, 'search needs words (or --kind / --tag).');
    const hits = lib.search(rest.join(' '), { kind: values.kind || null, tag: values.tag || null });
    say(hits.length ? `${hits.length} found:` : 'Nothing found.');
    return listing(hits, values.limit);
  }

  if (cmd === 'list') {
    const all = lib.list().filter((it) => !values.kind || it.kind === values.kind);
    say(`${all.length} item${all.length === 1 ? '' : 's'}${values.kind ? ` (${values.kind})` : ''}:`);
    return listing(all, values.limit);
  }

  if (cmd === 'add') {
    if (!rest.length) usageError(USAGE, 'add needs a file or a link.');
    const addedBy = values.crew ? 'crew' : 'you';
    const meta = { title: rest.length === 1 ? values.title : undefined, notes: values.notes, tags: values.tags, kind: values.kind, addedBy };
    let failed = 0;
    for (const what of rest) {
      try {
        const it = /^https?:\/\//i.test(what)
          ? await lib.saveLink({ url: what, ...meta })
          : await lib.addFile(path.resolve(what.replace(/^~(?=\/)/, os.homedir())), meta);
        say(`${it.duplicate ? 'Already there' : 'Saved'}:${row(it).slice(1)}`);
        if (it.kind === 'video-link' && !it.duplicate) say('  (a video link is recorded, never downloaded: /flpt:clip keeps one moment of it)');
      } catch (e) {
        failed += 1;
        say(`Couldn't add ${what}: ${e.message}`);
      }
    }
    await lib.idle(); // a page's snapshot, taken in the background
    return failed ? 1 : 0;
  }

  if (cmd === 'use') {
    if (!rest[0]) usageError(USAGE, 'use needs an item id.');
    const out = await app('crew-library').crewLibrary(lib, episodeDir(rest[1])).use(rest[0]);
    say(JSON.stringify(out, null, 2));
    return 0;
  }

  if (cmd === 'import') {
    const from = path.resolve(rest[0] || CUTAWAY);
    say(`Importing ${from} (read-only: files are copied out, nothing there changes)…`);
    const r = await lib.importCutaway(from, { onProgress: ({ done, total }) => { if (done && done % 25 === 0) say(`  ${done} of ${total}`); } });
    say(`Added ${r.added}, already there ${r.skipped}, failed ${r.failed.length} (of ${r.total}).`);
    for (const f of r.failed.slice(0, 10)) say(`  ✗ ${f.title}: ${f.error}`);
    return r.failed.length ? 1 : 0;
  }

  const file = writeLibraryHtml(lib);
  say(`Wrote ${file} (${lib.list().length} items).`);
  if (cmd === 'open' || values.open) {
    const p = spawn('open', [file], { stdio: 'ignore', detached: true });
    p.on('error', () => say('Open it in your browser.'));
    p.unref();
  }
  return 0;
});
