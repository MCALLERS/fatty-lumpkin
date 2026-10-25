'use strict';
// What made an episode (flpt-project.json v2, "madeWith"; PLAN §2.14): the surface it ran on, FLPT's version, the
// flpt-live runtime, the toolchain and the sandbox. episode.write() appends an entry only when one of those differs from
// the last one, never per stage, so the list reads as the episode's history of homes.
//
// Each value is found here (the app under Electron is 'mac', with the pinned toolchain; anything else is the plugin's
// command-line tools, on the system's), and a host that knows better says so once with configure(): the web server
// ('web'), the Desk ('desk'), or a crew's SDK version.
const fs = require('fs');
const path = require('path');

const SURFACES = new Set(['mac', 'web', 'desk', 'plugin']);
const SANDBOXES = new Set(['seatbelt', 'bwrap', 'none']);
const MODES = new Set(['pinned', 'system']);
const KEPT = 64; // a record rewritten all day never grows past this many homes
let over = {};
let found = null; // what was worked out, kept until configure() changes something

const str = (v, n = 64) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
const isElectron = () => Boolean(process.versions && process.versions.electron);

/**
 * A host's own answers: { surface, version, runtime, toolchain: { manifest, platform, mode }, sandbox, crew, engineRoot,
 * modeOf }. `modeOf()` answers the toolchain's mode at each write ('pinned' or 'system'), for a host where the user can
 * switch it (the app's Setup → Tools).
 */
function configure(o = {}) {
  const next = { ...over };
  if (typeof o.modeOf === 'function') next.modeOf = o.modeOf;
  if (SURFACES.has(o.surface)) next.surface = o.surface;
  if (str(o.version)) next.version = str(o.version);
  if (o.runtime === null || str(o.runtime)) next.runtime = o.runtime === null ? null : str(o.runtime);
  if (SANDBOXES.has(o.sandbox)) next.sandbox = o.sandbox;
  if (str(o.crew)) next.crew = str(o.crew);
  if (str(o.engineRoot, 4096) && path.isAbsolute(o.engineRoot)) next.engineRoot = path.resolve(o.engineRoot);
  if (o.toolchain && typeof o.toolchain === 'object') {
    const t = {};
    if (o.toolchain.manifest === null || str(o.toolchain.manifest)) t.manifest = o.toolchain.manifest === null ? null : str(o.toolchain.manifest);
    if (str(o.toolchain.platform)) t.platform = str(o.toolchain.platform);
    if (MODES.has(o.toolchain.mode)) t.mode = o.toolchain.mode;
    next.toolchain = { ...(over.toolchain || {}), ...t };
  }
  over = next;
  found = null;
  return current();
}

/** Back to what's found (for tests). */
function reset() { over = {}; found = null; }

/** FLPT's version: the app's package.json (the plugin's tools/lib carries the same name and version). */
function appVersion() {
  try { return require('../../package.json').version || null; } catch { return null; }
}

/** The engine folder: the one configured, the packaged app's, the repo's (app/src/main), or the plugin's (tools/lib/src/main). */
function engineRoots() {
  return [over.engineRoot, process.resourcesPath ? path.join(process.resourcesPath, 'engine') : null,
    path.join(__dirname, '..', '..', '..', 'engine'), path.join(__dirname, '..', '..', '..', '..')].filter(Boolean);
}

/** "flpt-live@1.0.0" from the runtime's VERSION file, or null where there's no runtime. */
function runtimeVersion() {
  for (const root of engineRoots()) {
    try {
      const v = fs.readFileSync(path.join(root, 'runtime', 'flpt-live', 'VERSION'), 'utf8').trim();
      if (/^\d+\.\d+\.\d+$/.test(v)) return `flpt-live@${v}`;
    } catch { /* not this one */ }
  }
  return null;
}

/** The toolchain manifest's date (the app's pinned tools), or null where it isn't shipped (the plugin). */
function manifestVersion() {
  try { return str(JSON.parse(fs.readFileSync(path.join(__dirname, 'toolchain-manifest.json'), 'utf8')).version); } catch { return null; }
}

function sandboxKind() {
  try { return require('./sandbox').kind() || 'none'; } catch { return 'none'; } // the one that runs (available() is also true where one is required but missing)
}

/** The toolchain's mode now: the host's answer (modeOf, else configured), else the app's pinned tools, the plugin's system ones. */
function modeNow() {
  if (over.modeOf) { try { const m = over.modeOf(); if (MODES.has(m)) return m; } catch { /* the default */ } }
  return (over.toolchain && over.toolchain.mode) || (isElectron() ? 'pinned' : 'system');
}

/** What's making this episode now: { surface, version, runtime, toolchain, sandbox } (+ crew when a host said). */
function current() {
  if (!found) {
    const tc = over.toolchain || {};
    found = {
      surface: over.surface || (isElectron() ? 'mac' : 'plugin'),
      version: over.version || appVersion(),
      runtime: over.runtime !== undefined ? over.runtime : runtimeVersion(),
      manifest: tc.manifest !== undefined ? tc.manifest : manifestVersion(),
      platform: tc.platform || `${process.platform}-${process.arch}`,
      sandbox: over.sandbox || sandboxKind(),
    };
  }
  const mode = modeNow();
  const { manifest, platform, ...rest } = found;
  // the manifest's date names the pinned tools; on the system's own tools there's none to name
  return { ...rest, toolchain: { manifest: mode === 'pinned' ? manifest : null, platform, mode }, ...(over.crew ? { crew: over.crew } : {}) };
}

const KEY = (e) => JSON.stringify([e.surface || null, e.version || null, e.runtime || null,
  e.toolchain && typeof e.toolchain === 'object' ? [e.toolchain.manifest || null, e.toolchain.platform || null, e.toolchain.mode || null] : null,
  e.sandbox || null]);

/** Do two entries name the same home (surface, version, runtime, toolchain, sandbox)? */
function same(a, b) { return Boolean(a && b && KEY(a) === KEY(b)); }

/**
 * The madeWith list with `entry` (by default what's making it now) appended, unless the last entry names the same
 * home: then the list as it was. Entries that aren't objects are dropped; only the newest KEPT stay.
 */
function stamp(list, entry = current(), at = new Date().toISOString()) {
  const prev = Array.isArray(list) ? list.filter((e) => e && typeof e === 'object' && !Array.isArray(e)) : [];
  if (prev.length && same(prev[prev.length - 1], entry)) return prev;
  return [...prev, { at, ...entry }].slice(-KEPT);
}

module.exports = { configure, reset, current, stamp, same, SURFACES };
