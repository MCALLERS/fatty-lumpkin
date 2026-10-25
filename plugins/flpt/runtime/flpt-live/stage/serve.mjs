// serve.mjs · the Stage's files over HTTP, for the hosts that frame the harness in a browser: the mock
// (app/qa/mock/stage.server.mjs), the QA runner (app/qa/stage-hostile/chrome.mjs), and later flpt-server's Desk and
// the web's local QA (PLAN §2.5). The Mac host (W1-14) serves the same layout on flpt-stage:// with protocol.js's
// route() and headers(). Never served itself: stage/ answers only protocol.js's HARNESS_FILES.
//
//   const stage = createStage({ host: 'http://127.0.0.1:4317' });     // host = the origin allowed to frame the harness
//   const token = stage.add({ scene: '<generated page folder>', media: { 'voice-draft.wav': file }, ref: { 'ref.mp4': file }, host? });
//   http.createServer((req, res) => { const u = new URL(req.url, 'http://x'); stage.handle(req, res, u.pathname, { search: u.search }); })
//   stage.update(token, { media: { 'snapshot.png': file } })           // add, replace or (null) drop a token's media
//
// One token = one piece: 32 hex characters, unguessable, its own roots. GET and HEAD only, byte ranges (the reference
// <video> seeks), realpath containment, no symlinks out, the protocol's headers on every answer. The piece's page is
// served once per mount (index.html?r=<n>, each n once), so a piece that navigates itself back to its own page (a
// reload, ?exfil=…) gets nothing: the harness then sees the second load and removes it. Every refusal is logged.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const P = require('./protocol.js');
export const STAGE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const RUNTIME = path.resolve(STAGE_DIR, '..');

const TOKEN = /^[0-9a-f]{32}$/;
const realOrNull = (p) => { try { return fs.realpathSync(p); } catch { return null; } };
const inside = (root, p) => p === root || p.startsWith(root + path.sep);

export function createStage({ host = null, stageDir = STAGE_DIR, scoreDir = path.join(RUNTIME, 'score'), log = null } = {}) {
  const tokens = new Map();
  const events = [];
  const note = (e) => { const x = { at: Date.now(), ...e }; events.push(x); if (events.length > 5000) events.shift(); if (log) log(x); };

  const put = (entry, media, ref) => {
    for (const [name, file] of Object.entries(media || {})) if (P.MEDIA_FILES.includes(name)) { if (file) entry.media[name] = file; else delete entry.media[name]; }
    for (const [name, file] of Object.entries(ref || {})) if (P.REF_FILE.test(name)) { if (file) entry.ref[name] = file; else delete entry.ref[name]; }
  };
  /** A new token for one piece. host: the origin allowed to frame its harness (default: the stage's). */
  function add({ scene, media = {}, ref = {}, host: h } = {}) {
    const t = crypto.randomBytes(16).toString('hex');
    const entry = { scene: scene ? realOrNull(scene) : null, media: {}, ref: {}, served: new Set(), host: h === undefined ? undefined : h };
    put(entry, media, ref);
    tokens.set(t, entry);
    if (tokens.size > 500) tokens.delete(tokens.keys().next().value);
    return t;
  }
  const remove = (t) => tokens.delete(t);
  /** Add, replace (or, with null, drop) a token's media and reference files, e.g. a new snapshot.png. */
  function update(t, { media, ref } = {}) { const e = tokens.get(t); if (!e) return false; put(e, media, ref); return true; }

  /** The file a path names, or { status, why }. path = '/<token>/<root>/<rel>' (the part below the host's mount + 's'). */
  function resolveFile(token, sub) {
    const entry = tokens.get(token);
    if (!entry) return { status: 403, why: 'wrong-token' };
    const r = P.route(sub);
    if (r.refuse) return { status: 403, why: r.refuse };
    let root, file;
    if (r.root === 'stage') { root = realOrNull(stageDir); file = root && path.join(root, r.rel); }
    else if (r.root === 'score') { root = realOrNull(scoreDir); file = root && path.join(root, r.rel); }
    else if (r.root === 'scene') { root = entry.scene; file = root && path.join(root, r.rel); }
    else {
      const given = (r.root === 'media' ? entry.media : entry.ref)[r.rel];
      if (!given) return { status: 404, why: 'missing' };
      const real = realOrNull(given);
      return real && fs.statSync(real).isFile() ? { file: real, route: r } : { status: 404, why: 'missing' };
    }
    if (!root) return { status: 404, why: 'no-root' };
    if (!inside(root, path.resolve(file))) return { status: 403, why: 'escape' };
    const real = realOrNull(file);
    if (!real) return { status: 404, why: 'missing' };
    if (!inside(root, real)) return { status: 403, why: 'escape' };
    if (!fs.statSync(real).isFile()) return { status: 404, why: 'missing' };
    return { file: real, route: r };
  }

  /**
   * Answer one request whose path (below the host's mount) is '/s/<token>/<root>/<rel>'. Returns true when it answered
   * (it always does for paths under /s/), false for anything else.
   */
  async function handle(req, res, sub, { search = '' } = {}) {
    const m = /^\/?s\/([^/]+)(\/.*)?$/.exec(sub || '');
    if (!m) return false;
    const deny = (status, why) => { note({ status, why, path: String(sub).slice(0, 200), search: String(search).slice(0, 200) }); res.writeHead(status, { 'content-type': 'text/plain', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }).end(status === 404 ? 'not found' : 'not allowed'); return true; };
    if (req.method !== 'GET' && req.method !== 'HEAD') return deny(405, 'method');
    const token = m[1];
    if (!TOKEN.test(token)) return deny(403, 'wrong-token');
    let rel;
    try { rel = decodeURIComponent(m[2] || ''); } catch { return deny(403, 'bad-path'); }
    const f = resolveFile(token, rel);
    if (f.status) return deny(f.status, f.why);
    const r = f.route;
    const entry = tokens.get(token);
    // the piece's page: once per mount, and only as the harness asks for it (index.html?r=<n>)
    if (r.root === 'scene' && r.rel === 'index.html') {
      const q = new URLSearchParams(search);
      const n = q.get('r');
      if (!n || !/^\d{1,12}$/.test(n) || [...q.keys()].length !== 1) return deny(403, 'page-query');
      if (entry.served.has(n)) return deny(410, 'page-again');
      entry.served.add(n);
    }
    const head = P.headers(r.part, r.ext, { host: entry.host === undefined ? host : entry.host });
    const size = fs.statSync(f.file).size;
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    note({ status: range ? 206 : 200, path: String(sub).slice(0, 200), search: String(search).slice(0, 200) });
    if (range && size > 0) {
      let a = range[1] === '' ? null : Number(range[1]);
      let b = range[2] === '' ? null : Number(range[2]);
      if (a == null) { a = Math.max(0, size - (b || 0)); b = size - 1; } else if (b == null || b >= size) b = size - 1;
      if (!(a <= b) || a >= size) { res.writeHead(416, { 'content-range': `bytes */${size}`, ...head }).end(); return true; }
      res.writeHead(206, { ...head, 'accept-ranges': 'bytes', 'content-range': `bytes ${a}-${b}/${size}`, 'content-length': String(b - a + 1) });
      if (req.method === 'HEAD') { res.end(); return true; }
      fs.createReadStream(f.file, { start: a, end: b }).pipe(res);
      return true;
    }
    res.writeHead(200, { ...head, 'accept-ranges': 'bytes', 'content-length': String(size) });
    if (req.method === 'HEAD') { res.end(); return true; }
    fs.createReadStream(f.file).pipe(res);
    return true;
  }

  return { add, remove, update, handle, resolveFile, events, tokens, get host() { return host; }, set host(h) { host = h; } };
}
