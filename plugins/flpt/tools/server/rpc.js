'use strict';
// rpc.js · the bridge contract over HTTP (PLAN §2.2 seam 1; W4-01): `POST /api/rpc/<ns>.<name>` with the arguments as a
// JSON array, answered with the contract's own envelope ({ ok: true, value } or { ok: false, error }). The contract
// checks every argument against its types (validate.js) exactly as shell/ipc.js does on the Mac; this layer adds what
// the web needs so that no path ever comes from the page:
//   episode   the page holds an opaque ref (ep_…), never the folder: refs go out in place of every episode folder in
//             what the server sends (answers and events, keys included), and come back here, mapped to the folder
//             before the call. A path where a ref belongs is refused.
//   fileref   `<ref>/<path inside it>` (what the page was given), mapped the same way; nothing outside the episode
//   dropped   upload tokens (uploads.js), swapped for the uploaded files' paths, once each; anything else is dropped
// Refs are an HMAC of the folder under a secret made at start: stable for the server's life, meaningless outside it.
// Each call's context is the host's API context plus the caller's own parts (its event stream, its dialogs, its
// /files URLs, and the OS calls a browser stands in for), as shell/ipc.js's callContext is on the Mac.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REF = /^(ep_[A-Za-z0-9_-]{22})(\/.*)?$/s;

/**
 * Episode refs for one server: { refOf(dir), toPage(value), fromPage(text, { rest }) → absolute path | null, scan() }.
 * `projectsDir()` is the projects folder now (settings can change it).
 */
function createRefs({ projectsDir, secret = crypto.randomBytes(32) }) {
  const byRef = new Map();
  const byDir = new Map();
  const episodes = new Set(); // folders seen holding flpt-project.json (an episode stays one)

  function refOf(dir) {
    const d = path.resolve(dir);
    let r = byDir.get(d);
    if (!r) {
      r = `ep_${crypto.createHmac('sha256', secret).update(d).digest('base64url').slice(0, 22)}`;
      byDir.set(d, r);
      byRef.set(r, d);
    }
    return r;
  }

  const isEpisode = (d) => {
    if (episodes.has(d)) return true;
    let yes = false;
    try { yes = fs.statSync(path.join(d, 'flpt-project.json')).isFile(); } catch { yes = false; }
    if (yes) episodes.add(d);
    return yes;
  };

  /** The episode folder a path lies in (an episode is one or two levels below the projects folder), or null. */
  function episodeOf(abs) {
    let root;
    try { root = path.resolve(projectsDir()); } catch { return null; }
    if (!abs.startsWith(root + path.sep)) return null;
    const parts = abs.slice(root.length + 1).split(path.sep);
    for (let k = 1; k <= Math.min(2, parts.length); k++) {
      const cand = path.join(root, ...parts.slice(0, k));
      if (isEpisode(cand)) return cand;
    }
    return null;
  }

  /** One string as the page may see it: an episode folder (or a path inside one) as its ref. */
  function str(s) {
    if (s.length < 2 || s[0] !== '/' || s.length > 8192) return s;
    const dir = episodeOf(path.normalize(s));
    if (!dir) return s;
    const n = path.normalize(s);
    return refOf(dir) + n.slice(dir.length).split(path.sep).join('/');
  }

  /** A value as the page may see it (copied where it changes; the server's own objects are never touched). */
  function toPage(v, depth = 0) {
    if (typeof v === 'string') return str(v);
    if (!v || typeof v !== 'object' || depth > 64) return v;
    if (Array.isArray(v)) {
      let out = null;
      for (let i = 0; i < v.length; i++) {
        const x = toPage(v[i], depth + 1);
        if (x !== v[i]) { if (!out) out = v.slice(); out[i] = x; }
      }
      return out || v;
    }
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return v; // Dates, Buffers…: as JSON writes them
    let out = null;
    const keys = Object.keys(v);
    for (const k of keys) {
      const k2 = str(k);
      const x = toPage(v[k], depth + 1);
      if (out || k2 !== k || x !== v[k]) {
        if (!out) { out = {}; for (const k0 of keys) { if (k0 === k) break; out[k0] = v[k0]; } }
        out[k2] = x;
      }
    }
    return out || v;
  }

  /** Every episode in the projects folder (and its Samples), so a ref the page holds from earlier is known. */
  function scan() {
    let root;
    try { root = path.resolve(projectsDir()); } catch { return; }
    const visit = (d, depth) => {
      let names = [];
      try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of names) {
        if (!e.isDirectory()) continue;
        const p = path.join(d, e.name);
        if (isEpisode(p)) refOf(p); else if (depth < 2) visit(p, depth + 1);
      }
    };
    visit(root, 1);
  }

  /**
   * What the page named, as a path: `<ref>` alone (rest: false) is the episode folder; `<ref>/<path>` (rest: true) a
   * path inside it, never climbing out. Null for anything else (an absolute path included).
   */
  function fromPage(text, { rest = false } = {}) {
    if (typeof text !== 'string') return null;
    const m = REF.exec(text);
    if (!m || (m[2] && !rest)) return null;
    let dir = byRef.get(m[1]);
    if (!dir) { scan(); dir = byRef.get(m[1]); }
    if (!dir) return null;
    if (!m[2]) return dir;
    if (m[2].includes('\0')) return null;
    const p = path.resolve(dir, `.${path.posix.normalize(m[2])}`);
    return p === dir || p.startsWith(dir + path.sep) ? p : null;
  }

  return { refOf, toPage, fromPage, scan, episodeOf };
}

/**
 * The RPC layer for one server.
 * @param {object} o
 * @param {object} o.contract   bridge-contract.js's built contract (methods, call)
 * @param {object} o.validate   validate.js (for the host's overrides)
 * @param {object} o.host       { api, overrides? } (hosts/host-*.js)
 * @param {object} o.refs       createRefs(…)
 * @param {object} o.uploads    uploads.js
 * @param {object} o.approvals  approvals.js
 * @param {object} o.bus        sse.js
 * @param {Function} o.mediaUrl (session, absolutePath) → the page's /files URL for it
 */
function createRpc({ contract, validate, host, refs, uploads, approvals, bus, mediaUrl }) {
  const err = (error) => ({ ok: false, error });

  /** The OS calls a browser stands in for: a file to open or download, a link to open, on the caller's own page. */
  function osFor(session) {
    const say = (channel, payload) => bus.send(session.id, channel, payload);
    return {
      openPath: async (p) => { say('file:open', { url: mediaUrl(session, p) }); return ''; },
      showItemInFolder: (p) => { let file = false; try { file = fs.statSync(p).isFile(); } catch { /* gone */ } if (file) say('file:open', { url: mediaUrl(session, p), download: true }); return file; },
      openExternal: async (u) => {
        let url = null;
        try { const x = new URL(String(u)); if (x.protocol === 'https:' || x.protocol === 'http:') url = x.href; } catch { url = null; }
        if (!url) throw new Error('That isn\'t a web link.');
        say('file:external', { url });
      },
    };
  }

  /** One call's context: the host's API context, plus the caller's own parts. */
  function ctxFor(session) {
    return Object.assign(Object.create(host.api), {
      session: { id: session.id },
      sender: { send: (channel, payload) => bus.send(session.id, channel, refs.toPage(payload)), isDestroyed: () => !bus.has(session.id) },
      dialogs: { open: (opts) => approvals.open(opts, { session: session.id }), ask: (opts) => approvals.ask(opts, { session: session.id }) },
      fileUrl: (p) => mediaUrl(session, p),
      os: osFor(session),
    });
  }

  /** The page's arguments with refs and upload tokens swapped for paths; throws with what the page should hear. */
  function mapArgs(m, given, session) {
    const out = given.slice();
    m.args.forEach((t, i) => {
      const v = out[i];
      if (v === undefined || v === null) return;
      if (t.type === 'episode') {
        const dir = refs.fromPage(v);
        if (!dir) throw new Error('That isn\'t an FLPT episode.');
        out[i] = dir;
      } else if (t.type === 'fileref') {
        const p = refs.fromPage(v, { rest: true });
        if (!p) throw new Error('That file isn\'t one FLPT can open here.');
        out[i] = p;
      } else if (t.type === 'dropped') {
        out[i] = (Array.isArray(v) ? v : []).filter((x) => uploads.isToken(x)).slice(0, 500).map((x) => uploads.take(x, { session: session.id }));
      } else if (t.type === 'dropped1') {
        out[i] = uploads.isToken(v) ? uploads.take(v, { session: session.id }) : '';
      }
    });
    return out;
  }

  /** One call: { status, body } (body: the envelope, ready to send as JSON). */
  async function call(session, key, given) {
    const m = contract.methods.get(key);
    if (!m) return { status: 404, body: err('That isn\'t something FLPT does.') };
    if (!Array.isArray(given)) return { status: 400, body: err('The arguments go as a list.') };
    if (given.length > m.args.length) return { status: 200, body: err(`${key} takes ${m.args.length} argument${m.args.length === 1 ? '' : 's'}`) };
    const ctx = ctxFor(session);
    let args;
    try { args = mapArgs(m, given, session); } catch (e) { return { status: 200, body: err(e.message) }; }
    let r;
    const own = host.overrides && Object.prototype.hasOwnProperty.call(host.overrides, key) ? host.overrides[key] : null;
    if (own) {
      try {
        const clean = validate.args(m.args, args, key);
        r = { ok: true, value: await own(ctx, ...clean) };
      } catch (e) { r = err(typeof ctx.redact === 'function' ? ctx.redact(String(e.message)) : String(e.message)); }
    } else {
      r = await contract.call(ctx, key, args);
    }
    return { status: 200, body: refs.toPage(r) };
  }

  return { call, ctxFor, mapArgs };
}

module.exports = { createRpc, createRefs, REF };
