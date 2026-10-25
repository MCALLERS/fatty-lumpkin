#!/usr/bin/env node
'use strict';
// The Style Gallery in Claude Code (PLAN §2.10): the looks Live Motion pieces are drawn in, through the Mac app's own
// styles.js. FLPT's shipped styles, the user's own (Mine, in the projects folder's Styles) and Shared ones, each as its
// structured fields only: a style that isn't FLPT's own as shipped is never more than its fields and its kit's API
// (crewView), never its code or its notes as instructions.
//   list   every style, with what it's the default for and whether it's safe beside the presenter (a Duet)
//   show   one style's fields: its line, tags, motion, inks and type, licence and credit
//   fetch  check FLPT's signed catalog for new shared styles and withdrawn ones (W3-11; the only command that goes online)
// A style is picked on the storyboard: flpt-storyboard set style <id> (the episode's), or set <shot> style <id>.
const path = require('path');
const { ROOT, app, places, cli, usageError, main, say, toolchainId } = require('./common');

const USAGE = `
Usage: flpt-styles <command>
  list [--for solo|duet|cosmos|interstitial|cutscene]
  show <style id>
  fetch`;

const OPTIONS = { for: { type: 'string' } };
const USES = { solo: 'Motion Solo', duet: 'Motion Duet', cosmos: 'Cosmos in code', interstitial: 'Solo ♪', cutscene: 'cut scene in code',
  history: 'histories', tech: 'technology', maths: 'maths', 'hand-drawn': 'hand-drawn looks' };

const stylesLib = () => app('styles');
const library = () => stylesLib().createStyles({ engineRoot: ROOT, projectsDir: places().projects, mediaRoot: null, toolchain: toolchainId() });
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n); // eslint-disable-line no-control-regex
const words = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]).map((w) => clean(w, 24)).filter(Boolean);

function defaultsOf(id) {
  return Object.entries(stylesLib().DEFAULTS).filter(([, s]) => s === id).map(([use]) => USES[use] || use);
}

function cmdList(values) {
  const want = values.for;
  if (want && !['solo', 'duet', 'cosmos', 'interstitial', 'cutscene'].includes(want)) throw Object.assign(new Error('--for is solo, duet, cosmos, interstitial or cutscene.'), { usage: true });
  const all = library().listAll();
  const rows = [['FLPT\'s', all.shipped], ['Mine', all.mine], ['Shared', all.shared]];
  let n = 0;
  for (const [title, list] of rows) {
    const ok = list.filter((r) => r.ok && (!want || want !== 'duet' || r.duetSafe));
    if (!ok.length) continue;
    say(`${title} (${ok.length})`);
    for (const r of ok) {
      n += 1;
      const tags = Object.entries(r.tags || {}).map(([k, v]) => `${clean(k, 12)} ${words(v).join(', ')}`).join(' · ');
      const uses = r.scope === 'shipped' ? defaultsOf(r.id) : [];
      const line = r.scope === 'shipped' && r.line ? ` · ${clean(r.line, 80)}` : '';
      say(`  ${String(r.scope === 'shared' && r.ref ? r.ref : r.id).padEnd(16)}${clean(r.name, 40) || r.id}${line}${uses.length ? ` · default for ${uses.join(', ')}` : ''}${r.duetSafe ? ' · duet-safe' : ''}${tags ? ` · ${tags}` : ''}`);
    }
  }
  if (!n) say(want === 'duet' ? 'No style is safe beside the presenter yet.' : 'No style is installed.');
  say(`Pick one on the storyboard: node "${path.join(__dirname, 'flpt-storyboard.js')}" set style <id> (the episode's), or set <shot> style <id>.`);
}

function cmdShow(id) {
  if (!id) throw Object.assign(new Error('show needs a style id (flpt-styles list).'), { usage: true });
  const lib = library();
  const r = lib.get(id);
  if (!r || !r.ok) throw new Error(`There's no style called "${clean(id, 40)}".`);
  const v = lib.crewView(r.dir);
  say(`${v.name || v.id} (${v.id}@${v.version}) · ${v.trust === 'shipped' ? 'FLPT\'s own' : r.scope === 'shared' ? 'shared' : 'yours'}`);
  if (v.trust === 'shipped' && v.line) say(`  ${v.line}`);
  const tags = Object.entries(v.tags || {}).map(([k, w]) => `${k} ${words(w).join(', ')}`).join(' · ');
  if (tags) say(`  Tags: ${tags}`);
  if (v.motion) say(`  Motion: ${[v.motion.pace, v.motion.easing].filter(Boolean).join(' · ')}${v.motion.vocab.length ? ` · ${v.motion.vocab.join(', ')}` : ''}`);
  const t = v.tokens || {};
  say(`  Inks: ${[t.paper && `paper ${t.paper}`, ...(t.inks || [])].filter(Boolean).join(', ') || 'none listed'}${t.accent ? ` · accent ${t.accent}` : ''}`);
  if (Object.keys(t.type || {}).length) say(`  Type: ${Object.entries(t.type).map(([k, f]) => `${k} ${f}`).join(' · ')}`);
  say(`  ${v.duetSafe ? 'Safe beside the presenter (a Duet).' : 'Not for a Duet: it fills the presenter\'s corner.'}${v.ones ? ' Drawn on ones.' : ' Drawn on twos.'}`);
  if (r.scope === 'shipped') {
    const uses = defaultsOf(r.id);
    if (uses.length) say(`  Default for ${uses.join(', ')}.`);
  }
  if (v.trust !== 'shipped') say(`  Its kit's functions: ${(v.api || []).map((f) => `${f.fn}(${(f.params || []).join(', ')})`).join(', ') || 'none listed'}`);
  if (r.licence || r.credit) say(`  ${[r.licence && `Licence ${clean(r.licence, 20)}`, r.credit && clean(r.credit, 80)].filter(Boolean).join(' · ')}`);
}

async function cmdFetch() {
  const catalog = app('catalog');
  const version = require('../.claude-plugin/plugin.json').version;
  const r = await catalog.createCatalog({ projectsDir: places().projects, engineRoot: ROOT, surface: 'plugin', version }).check();
  for (const line of catalog.describe(r)) say(line);
  if (!r.ok) process.exitCode = 1;
}

main(async () => {
  const { values, positionals } = cli(USAGE, OPTIONS);
  const [cmd, ...rest] = positionals;
  try {
    if (cmd === 'list') return cmdList(values);
    if (cmd === 'show') return cmdShow(rest[0]);
    if (cmd === 'fetch') return await cmdFetch();
  } catch (e) {
    if (e.usage) usageError(USAGE, e.message);
    throw e;
  }
  return usageError(USAGE, cmd ? `Unknown command: ${cmd}` : '');
});
