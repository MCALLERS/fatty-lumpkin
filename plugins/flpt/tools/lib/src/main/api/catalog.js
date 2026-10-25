'use strict';
// flpt.catalog: the signed style catalog (PLAN §2.10.3; W3-11). The page names nothing but an episode: where the
// catalog is, which keys it must verify against and the projects folder it installs into are main's, never the page's.
//   status()          what the stored catalog says (no network): { checked, release, expires, expired, shared,
//                     revoked, tooOld, latest ("2.0.3 is out" or null), keys, … }
//   check()           Check for new styles: the one call that reaches the network (catalog.js check()); the page
//                     hears catalog:changed after it → { ok, release, changed, added, skipped, revoked, latest,
//                     tooOld, shared } or { ok: false, code, problem }
//   hasShared()       true when a verified catalog holds a shared style installed here (the Gallery's Shared tab)
//   flags(episode)    the episode's style snapshots the catalog withdrew: [{ id, version, reason, line, blocked }]
//                     (blocked: renders and Stage previews refused; the page offers Replace style)
// Event: catalog:changed { release, changed } after a check. Nothing here spends; only check() reaches the network,
// and only because the user asked.
const fs = require('fs');
const path = require('path');
const episode = require('../episode');
const { createCatalog } = require('../catalog');

// One client per projects folder in this process, so two checks never run at once from here.
const clients = new Map();

/** The host's own client (QA and the server give theirs), else one on the user's projects folder. */
function catalogOf(c) {
  if (c.catalog && typeof c.catalog.check === 'function') return c.catalog;
  const projectsDir = c.settings && typeof c.settings.read === 'function' ? c.settings.read().projectsDir : null;
  if (!projectsDir) throw new Error('No projects folder.');
  let surface = 'mac';
  try { surface = (typeof c.caps === 'function' && c.caps() && c.caps().surface) || 'mac'; } catch { surface = 'mac'; }
  const key = `${path.resolve(projectsDir)}\0${surface}`;
  if (!clients.has(key)) clients.set(key, createCatalog({ projectsDir, engineRoot: c.engineRoot, surface }));
  return clients.get(key);
}

/** The episode folder, checked: inside the projects folder, with a record this FLPT can read. */
function dirOf(c, dir) {
  if (!c.flow || typeof c.flow.inProjects !== 'function' || !c.flow.inProjects(dir)) throw new Error('That isn\'t an FLPT episode folder.');
  const d = path.resolve(dir);
  const why = episode.tooNew(episode.readRaw(d));
  if (why) throw new Error(why);
  return d;
}

const changed = (c, payload) => { try { c.send('catalog:changed', payload); } catch { /* no window */ } };

/** The snapshots in an episode that a verified catalog withdrew. */
function flagsOf(cat, dir) {
  const root = path.join(dir, 'presentation', 'styles');
  let names = [];
  try { names = fs.readdirSync(root); } catch { return []; }
  const out = [];
  for (const n of names.sort()) {
    if (!/^[a-z0-9][a-z0-9-]{0,47}@\d+\.\d+\.\d+$/.test(n)) continue;
    const r = cat.revocationOf(path.join(root, n));
    if (r) out.push({ id: r.id, version: r.version, reason: r.reason, line: r.line, blocked: r.blocks });
  }
  return out;
}

module.exports = {
  ns: 'catalog',
  methods: {
    status: { args: [], handler: (c) => catalogOf(c).status() },
    check: { args: [], handler: async (c) => {
      const r = await catalogOf(c).check();
      if (r && r.ok) changed(c, { release: r.release, changed: r.changed });
      return r;
    } },
    hasShared: { args: [], handler: (c) => catalogOf(c).hasShared() },
    flags: { args: ['episode'], handler: (c, dir) => flagsOf(catalogOf(c), dirOf(c, dir)) },
  },
  events: ['catalog:changed'],
  catalogOf, flagsOf,
};
