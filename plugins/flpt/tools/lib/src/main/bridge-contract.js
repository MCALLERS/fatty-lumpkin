'use strict';
// The bridge contract: one surface-neutral API under every shell (PLAN §2.2, seam 1). Each file in api/ (sorted) exports
//
//   module.exports = { ns: 'storyboard', methods: {
//       op: { args: ['episode', 'json'], handler: async (ctx, episode, op) => … } },
//     events: ['storyboard:changed'] };
//
// (or an array of these). This module discovers them, checks the arguments of every call against the method's types
// (validate.js) and answers with an envelope, { ok: true, value } or { ok: false, error } (the error redacted). The Mac
// shell (shell/ipc.js) serves each method as ipcMain.handle('<ns>:<name>'); a server serves POST /api/rpc/<ns>.<name>;
// preload.js builds window.flpt from describe(), so a new namespace needs no preload edit.
//
// A method is exposed to the page as flpt.<ns>.<name>(…) unless it names its own place with `expose` (0.7.1's methods
// keep their names that way: episode.open is flpt.openEpisode). `raw: true` is 0.7.1's other shape: the page gets the
// value itself and a failure throws. An event is a channel name (exposed as flpt.<ns>.on<Name>), or { name, expose }
// with one place or a list of them. Several modules may share a namespace; a method or a place defined twice is refused.
const fs = require('fs');
const path = require('path');
const validate = require('./validate');

const NAME = /^[a-z][A-Za-z0-9]*$/;
const PLACE = /^[A-Za-z_$][\w$]*$/;
const BANNED = new Set(['__proto__', 'prototype', 'constructor']);
/** Written by hand in preload.js (they need webUtils, or aren't calls): no module may take these places. */
const HAND_WRITTEN = ['fileUrl', 'pathForFile'];

const upper = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function checkPlace(place, where) {
  const parts = String(place).split('.');
  if (!parts.every((p) => PLACE.test(p) && !BANNED.has(p))) throw new Error(`${where}: "${place}" isn't a place on window.flpt`);
  return parts.join('.');
}

/** The API modules in a folder, sorted by file name: [{ file, spec }] (a file may export one spec or a list). */
function load(dir) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort(); } catch { return []; }
  const out = [];
  for (const f of names) {
    const mod = require(path.join(dir, f));
    for (const spec of Array.isArray(mod) ? mod : [mod]) out.push({ file: f, spec });
  }
  return out;
}

/**
 * The contract from module specs: { methods, events, describe(), call(ctx, key, args), has(key) }. Throws when a spec
 * is malformed, a method is defined twice, or two places on window.flpt collide.
 */
function build(entries) {
  const methods = new Map();
  const events = new Map();
  const places = new Map(); // place → what took it
  const take = (place, what) => {
    const p = checkPlace(place, what);
    for (const [q, by] of places) {
      if (q === p || q.startsWith(`${p}.`) || p.startsWith(`${q}.`)) throw new Error(`${what}: window.flpt.${p} collides with ${by} (window.flpt.${q})`);
    }
    places.set(p, what);
    return p;
  };
  for (const h of HAND_WRITTEN) places.set(h, 'preload.js');

  for (const { file, spec } of entries) {
    const where = `api/${file}`;
    if (!spec || typeof spec !== 'object' || !NAME.test(String(spec.ns))) throw new Error(`${where}: needs ns (a lower-case name)`);
    if (spec.ns === 'flpt') throw new Error(`${where}: the flpt namespace is the bridge's own (flpt:contract)`);
    const ns = spec.ns;
    for (const [name, m] of Object.entries(spec.methods || {})) {
      const key = `${ns}.${name}`;
      if (!NAME.test(name)) throw new Error(`${where}: method "${name}" needs a plain name`);
      if (!m || typeof m.handler !== 'function' || !Array.isArray(m.args)) throw new Error(`${where}: ${key} needs args (a list) and a handler`);
      if (methods.has(key)) throw new Error(`${where}: ${key} is defined twice`);
      const args = m.args.map((a) => validate.parse(a));
      const expose = take(m.expose || key, key);
      methods.set(key, { key, ns, name, channel: `${ns}:${name}`, args, expose, raw: m.raw === true, handler: m.handler, file });
    }
    for (const ev of spec.events || []) {
      const e = typeof ev === 'string' ? { name: ev } : ev;
      if (!e || typeof e.name !== 'string' || !/^[a-z][\w-]*:[\w-]+$/.test(e.name)) throw new Error(`${where}: an event needs a name like "${ns}:changed"`);
      const suffix = e.name.slice(e.name.indexOf(':') + 1).replace(/[-_](\w)/g, (_, c) => c.toUpperCase());
      const wanted = e.expose == null ? [`${ns}.on${upper(suffix)}`] : [].concat(e.expose);
      const rec = events.get(e.name) || { name: e.name, expose: [] };
      for (const place of wanted) rec.expose.push(take(place, `event ${e.name}`));
      events.set(e.name, rec);
    }
  }

  /** What the preload needs, as plain data: each method's channel, place, arity and dropped-file arguments. */
  function describe() {
    return {
      v: 1,
      methods: [...methods.values()].map((m) => ({
        key: m.key, channel: m.channel, expose: m.expose, arity: m.args.length, raw: m.raw, args: m.args.map((a) => a.spec),
        dropped: m.args.map((a, i) => (a.type === 'dropped' ? [i, 'all'] : a.type === 'dropped1' ? [i, 'first'] : null)).filter(Boolean),
      })),
      events: [...events.values()].map((e) => ({ name: e.name, expose: [...e.expose] })),
    };
  }

  /** Run one method for a caller: the arguments checked first, then { ok, value } or { ok: false, error }. */
  async function call(ctx, key, given) {
    const m = methods.get(key);
    const redact = (s) => (ctx && typeof ctx.redact === 'function' ? ctx.redact(s) : s);
    if (!m) return { ok: false, error: 'That isn\'t something FLPT does.' };
    let clean;
    try { clean = validate.args(m.args, given, key); } catch (e) { return { ok: false, error: e.message }; }
    try {
      return { ok: true, value: await m.handler(ctx, ...clean) };
    } catch (err) {
      const out = { ok: false, error: redact(String(err && err.message != null ? err.message : err)) };
      if (err && err.fields !== undefined) out.fields = err.fields;
      return out;
    }
  }

  return { methods, events, describe, call, has: (key) => methods.has(key) };
}

/** The app's own contract: every module in api/. */
function discover(dir = path.join(__dirname, 'api')) { return build(load(dir)); }

module.exports = { discover, build, load, HAND_WRITTEN };
