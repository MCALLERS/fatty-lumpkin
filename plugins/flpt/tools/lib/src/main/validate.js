'use strict';
// Argument types for the bridge contract (bridge-contract.js): every API method lists one type per argument, and main
// checks what the page sent against it before the handler runs. Nothing here trusts the page: numbers are clamped and
// paths resolved by the handlers themselves, and an episode is an opaque reference the main process handed out.
//
//   episode      an episode reference from the episodes list (opaque to the page; flow checks it on every use)
//   stage        a stage id (episode.STAGE_IDS)
//   text[:N]     a string of at most N characters (20000)
//   id[:N]       a non-empty string of at most N characters (64), no control characters
//   json[:N]     plain data (objects, arrays, strings, numbers, booleans, null) of at most N bytes as JSON (64 KB)
//   num          a finite number
//   bool         true or false
//   token        a token the main process handed out (staged files, approvals): [A-Za-z0-9_-], 6–128 characters
//   fileref      a file the main process named to the page earlier (it checks the path again; 0.7.1's open/reveal)
//   dropped      files dropped on the page: the preload turns the File objects into paths (webUtils), never page code
//   dropped1     the first dropped file's path ('' when none)
// A trailing ? makes the argument optional (undefined or null pass through as they are).
const path = require('path');

const TYPES = ['episode', 'stage', 'text', 'id', 'json', 'num', 'bool', 'token', 'fileref', 'dropped', 'dropped1'];
const DEFAULT_MAX = { text: 20000, id: 64, json: 64 * 1024 };
const CONTROL = /[\u0000-\u001f\u007f]/; // eslint-disable-line no-control-regex
const MAX_PATH = 4096;
const MAX_DROPPED = 500;

class ArgError extends Error {}

/** 'text:400000?' → { type: 'text', max: 400000, optional: true }. Throws on an unknown type. */
function parse(spec) {
  const m = /^([a-z0-9]+)(?::(\d+))?(\?)?$/.exec(String(spec));
  if (!m || !TYPES.includes(m[1])) throw new Error(`Unknown argument type "${spec}"`);
  if (m[2] && !(m[1] in DEFAULT_MAX)) throw new Error(`Argument type "${m[1]}" takes no size`);
  return { type: m[1], max: m[2] ? Number(m[2]) : DEFAULT_MAX[m[1]], optional: Boolean(m[3]), spec: String(spec) };
}

/** Plain data only, and its size as JSON (in bytes). Null when it isn't plain data. */
function jsonBytes(v) {
  const open = new Set(); // the objects on the way down: a cycle isn't data
  const plain = (x, depth) => {
    if (x === null || typeof x === 'string' || typeof x === 'boolean') return true;
    if (typeof x === 'number') return Number.isFinite(x);
    if (typeof x !== 'object' || depth > 64 || open.has(x)) return x === undefined && depth > 0;
    const proto = Object.getPrototypeOf(x);
    if (!Array.isArray(x) && proto !== Object.prototype && proto !== null) return false;
    open.add(x);
    const ok = (Array.isArray(x) ? x : Object.values(x)).every((y) => plain(y, depth + 1));
    open.delete(x);
    return ok;
  };
  if (!plain(v, 0)) return null;
  return Buffer.byteLength(JSON.stringify(v));
}

let stageIds = null;
const stages = () => stageIds || require('./episode').STAGE_IDS; // read each time: later waves add stages

/** One argument against its parsed type: returns it (unchanged) or throws an ArgError saying what was expected. */
function check(t, v) {
  if (v === undefined || v === null) {
    if (t.optional) return v;
    throw new ArgError(`expected ${t.type}`);
  }
  const str = (max) => typeof v === 'string' && v.length <= max;
  switch (t.type) {
    case 'episode': if (str(MAX_PATH) && v.length > 0 && !v.includes('\0')) return v; break;
    case 'stage': if (typeof v === 'string' && stages().includes(v)) return v; break;
    case 'text': if (str(t.max)) return v; break;
    case 'id': if (str(t.max) && v.length > 0 && !CONTROL.test(v)) return v; break;
    case 'json': { const n = jsonBytes(v); if (n != null && n <= t.max) return v; break; }
    case 'num': if (typeof v === 'number' && Number.isFinite(v)) return v; break;
    case 'bool': if (typeof v === 'boolean') return v; break;
    case 'token': if (typeof v === 'string' && /^[A-Za-z0-9_-]{6,128}$/.test(v)) return v; break;
    case 'fileref': if (str(MAX_PATH) && !v.includes('\0')) return v; break;
    case 'dropped': if (Array.isArray(v) && v.length <= MAX_DROPPED && v.every((p) => typeof p === 'string' && p.length <= MAX_PATH && path.isAbsolute(p) && !p.includes('\0'))) return v; break;
    case 'dropped1': if (str(MAX_PATH) && !v.includes('\0') && (v === '' || path.isAbsolute(v))) return v; break;
    default: break;
  }
  throw new ArgError(`expected ${t.spec.replace(/\?$/, '')}`);
}

/**
 * A call's arguments against the method's parsed types: the same values back, or an ArgError naming the first one
 * that doesn't fit. More arguments than the method takes are refused.
 */
function args(types, given, label = 'this call') {
  const list = Array.isArray(given) ? given : [];
  if (list.length > types.length) throw new ArgError(`${label} takes ${types.length} argument${types.length === 1 ? '' : 's'}`);
  return types.map((t, i) => {
    try { return check(t, list[i]); } catch (e) { throw new ArgError(`${label}: argument ${i + 1} ${e.message}`); }
  });
}

/** Tests only: pin the stage list. */
function _setStages(ids) { stageIds = ids; }

module.exports = { TYPES, DEFAULT_MAX, parse, check, args, jsonBytes, ArgError, _setStages };
