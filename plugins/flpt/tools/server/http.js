'use strict';
// http.js · flpt-server's HTTP side (PLAN §2.2, §2.13; W4-01). Zero dependencies (node:http). One origin serves:
//   GET  /, /<renderer file>        the app's own screens (app/src/renderer), each page with the web bridge's tags
//                                   added in front of its first script (index.html itself is never edited), its CSP
//                                   allowing fetch to its own origin, and `frame-ancestors 'none'`
//   GET  /bridge/contract.js        the bridge contract (window.FLPT_CONTRACT), for web-bridge.js
//   POST /api/session               a session: { session, media } (below); GET checks one, DELETE ends it
//   POST /api/rpc/<ns>.<name>       one contract call (rpc.js)
//   GET  /api/events                the session's event stream (sse.js), read with fetch
//   POST /api/upload?name=          one file from the page → an upload token (uploads.js)
//   POST /api/approve · /api/dialog the answers to approvals and dialogs (approvals.js)
//   GET  /files/<media>?p=&v=       a picture, video or sound inline, anything else as a download (files.js)
// No cookies anywhere: a session token travels in the X-FLPT-Session header on every call, upload, answer and on the
// event stream; /files URLs carry the session's media token in their path instead (an <img> can't send a header).
// A session comes from the launch token the server printed (`#k=` in the URL the user opens; the fragment never
// reaches a server or a log) or, in web mode, from the host (the Worker in front has checked the user; there every
// request, not only a session's start, must pass the host's authorize(req), which answers a plain true). Every request
// must name an allowed Host (DNS rebinding), and every request that carries an Origin must name this one; a POST
// without an Origin, or a fetch the browser marks cross-site, is refused. Nothing answers CORS.

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const { createBus } = require('./sse');
const { serveFile } = require('./files');
const { createUploads } = require('./uploads');
const { createApprovals } = require('./approvals');
const { createRpc, createRefs } = require('./rpc');

const STATIC = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg',
};
const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-DNS-Prefetch-Control': 'off',
};
const API_CSP = "default-src 'none'; frame-ancestors 'none'";
const RPC_LIMIT = 8 * 1024 * 1024; // the contract's largest argument is 4 MB of JSON (an intake)
const SMALL_LIMIT = 64 * 1024;
const SESSION = /^[A-Za-z0-9_-]{43}$/;

const token = (n = 32) => crypto.randomBytes(n).toString('base64url');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The page's CSP (its own <meta>) with fetch allowed to its own origin: the bridge's calls and event stream. */
function webCsp(csp) {
  const parts = csp.split(';').map((d) => d.trim()).filter(Boolean);
  // 'self' added to a directive; 'none' goes with it (Chrome refuses 'none' beside a source). add: a missing one is added.
  const withSelf = (name, add) => {
    const i = parts.findIndex((d) => d === name || d.startsWith(`${name} `));
    if (i < 0) { if (add) parts.push(`${name} 'self'`); return; }
    const srcs = parts[i].split(/\s+/).slice(1);
    if (srcs.includes("'self'") && !srcs.includes("'none'")) return;
    parts[i] = [name, "'self'", ...srcs.filter((s) => s !== "'self'" && s !== "'none'")].join(' ');
  };
  withSelf('connect-src', true);
  withSelf('media-src', false); // a page's media from its own /files (the Gallery's loops), as flpt: and flpt-gallery: in the app
  return parts.join('; ');
}

/**
 * A renderer page as the web serves it: the bridge's two tags in front of its first script, and its CSP allowing
 * fetch to its own origin. Returns { html, csp } (csp: the page's policy, for the response header too).
 */
function webPage(html) {
  let csp = null;
  let out = html.replace(/(<meta[^>]+Content-Security-Policy[^>]+content=")([^"]*)(")/i, (m, a, c, b) => { csp = webCsp(c); return `${a}${csp};${b}`; });
  const tags = '<script src="/bridge/contract.js"></script>\n<script src="/bridge/web-bridge.js"></script>\n';
  const at = out.search(/<script\b/);
  out = at < 0 ? out.replace(/<\/head>/i, `${tags}</head>`) : `${out.slice(0, at)}${tags}${out.slice(at)}`;
  return { html: out, csp };
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) { reject(Object.assign(new Error('too big'), { status: 413 })); req.resume(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req, limit) {
  const text = await readBody(req, limit);
  try { return JSON.parse(text || 'null'); } catch { throw Object.assign(new Error('That isn\'t JSON.'), { status: 400 }); }
}

/**
 * @param {object} o
 * @param {'local'|'desk'|'web'} o.mode
 * @param {object} o.contract        the bridge contract (bridge-contract.js build/discover)
 * @param {object} o.validate        validate.js
 * @param {string} o.renderer        the renderer folder (app/src/renderer)
 * @param {string} o.uploadsDir      where uploads wait (inside the server's own data folder)
 * @param {Function} o.makeHost      ({ send, confirm, approvals, bus }) → host: { api, caps(), fileRoots(), projectsDir(),
 *                                   overrides?, authorize?(req) (web: the Worker's own request), decorate?(approval), close?() }
 * @param {string} [o.bind]          127.0.0.1 (local, desk) or 0.0.0.0 (web, inside its container)
 * @param {number} [o.port]          0: the system picks
 * @param {string[]} [o.hosts]       extra Host values to accept (web: the name the Worker forwards)
 * @param {string} [o.launch]        the launch token (made here when not given; web mode has none)
 * @param {boolean} [o.trustLoopback] local only: a same-origin page gets a session without the launch token (the
 *                                   preview pane's flpt-server-local, which can't carry one)
 * @param {Function} [o.onRequest]   called on every request (the Desk's idle timer)
 */
async function createHttp(o) {
  const mode = o.mode;
  const bus = createBus();
  const uploads = createUploads({ dir: o.uploadsDir });
  // the host may add to what an approval shows (web: the month's spend and the user's ceiling, from the Worker)
  const approvals = createApprovals({ bus, uploads, mode: mode === 'desk' ? 'none' : 'modal', decorate: (ev) => (host && typeof host.decorate === 'function' ? host.decorate(ev) : null) });
  const sessions = new Map(); // token → { id, token, media, at }
  const byMedia = new Map(); // media token → session
  const launch = mode === 'web' ? null : (o.launch || token());

  let host = null;
  const refs = createRefs({ projectsDir: () => host.projectsDir() }); // before the host: it may send while it starts
  host = await o.makeHost({
    send: (channel, payload) => bus.broadcast(channel, refs.toPage(payload)),
    confirm: (opts) => approvals.confirm(opts),
    approvals, bus,
  });
  const mediaUrl = (session, p) => `/files/${session.media}?p=${encodeURIComponent(refs.toPage(String(p)))}`;
  const rpc = createRpc({ contract: o.contract, validate: o.validate, host, refs, uploads, approvals, bus, mediaUrl });
  const contractJs = `window.FLPT_CONTRACT = ${JSON.stringify(o.contract.describe())};\n`;
  const renderer = fs.realpathSync(o.renderer);

  let allowed = new Set();
  let origins = new Set();

  function mint() {
    const s = { id: `s_${token(12)}`, token: token(32), media: token(24), at: Date.now() };
    sessions.set(s.token, s);
    byMedia.set(s.media, s);
    bus.open(s.id);
    return s;
  }
  function end(s) { sessions.delete(s.token); byMedia.delete(s.media); bus.close(s.id); }
  const sessionOf = (req) => {
    const t = req.headers['x-flpt-session'];
    return typeof t === 'string' && SESSION.test(t) ? sessions.get(t) || null : null;
  };
  /** web: the host's own check of the Worker's request. Only a plain true lets it through (a promise is a no, as is a throw). */
  function authorized(req) {
    if (!host || typeof host.authorize !== 'function') return false;
    let r;
    try { r = host.authorize(req); } catch { return false; }
    if (r && typeof r.then === 'function') Promise.resolve(r).catch(() => {}); // refused, and never an unhandled rejection
    return r === true;
  }

  // ── responses ──
  function send(res, status, body, headers = {}) {
    if (res.headersSent) { try { res.end(); } catch { /* gone */ } return; }
    res.writeHead(status, { ...BASE_HEADERS, ...headers });
    res.end(body);
  }
  const json = (res, status, value) => send(res, status, JSON.stringify(value), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': API_CSP });
  const text = (res, status, t) => send(res, status, t, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': API_CSP });

  // ── the guards: Host, Origin, and where a fetch says it came from ──
  function guard(req, res, url) {
    const h = String(req.headers.host || '').toLowerCase();
    if (!allowed.has(h)) { text(res, 421, 'wrong host'); return false; }
    const origin = req.headers.origin;
    const unsafe = !['GET', 'HEAD'].includes(req.method);
    if (origin !== undefined && !origins.has(String(origin).toLowerCase())) { text(res, 403, 'wrong origin'); return false; }
    if (unsafe && origin === undefined) { text(res, 403, 'no origin'); return false; }
    const site = req.headers['sec-fetch-site'];
    const data = url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/');
    if (data && site !== undefined && site !== 'same-origin' && !(site === 'none' && !unsafe && url.pathname.startsWith('/files/'))) { text(res, 403, 'cross-site'); return false; }
    if (req.method === 'OPTIONS') { text(res, 405, 'no'); return false; }
    return true;
  }

  // ── the screens ──
  function serveStatic(req, res, url) {
    if (!['GET', 'HEAD'].includes(req.method)) return text(res, 405, 'not allowed');
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch { return text(res, 400, 'bad path'); }
    if (rel === '/' || rel === '') rel = '/index.html';
    if (rel.includes('\0')) return text(res, 400, 'bad path');
    const file = path.join(renderer, path.normalize(rel));
    let real;
    try { real = fs.realpathSync(file); } catch { return text(res, 404, 'not found'); }
    if (!real.startsWith(renderer + path.sep)) return text(res, 404, 'not found');
    const type = STATIC[path.extname(real).toLowerCase()];
    let st;
    try { st = fs.statSync(real); } catch { st = null; }
    if (!type || !st || !st.isFile()) return text(res, 404, 'not found');
    if (path.extname(real).toLowerCase() === '.html') {
      const page = webPage(fs.readFileSync(real, 'utf8'));
      const csp = `${page.csp || "default-src 'self'"}; frame-ancestors 'none'`;
      return send(res, 200, req.method === 'HEAD' ? '' : page.html, {
        'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Security-Policy': csp, 'Cross-Origin-Opener-Policy': 'same-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
      });
    }
    res.writeHead(200, { ...BASE_HEADERS, 'Content-Type': type, 'Content-Length': String(st.size), 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(real).pipe(res);
  }

  // ── the API ──
  async function api(req, res, url) {
    const p = url.pathname;
    if (p === '/api/session') {
      if (req.method === 'POST') {
        const ok = mode === 'web' ? authorized(req)
          : same(String(req.headers['x-flpt-launch'] || ''), launch) || (o.trustLoopback && mode === 'local' && req.headers['sec-fetch-site'] === 'same-origin');
        if (!ok) return json(res, 401, { ok: false, error: 'No session.' });
        const s = mint();
        return json(res, 200, { ok: true, session: s.token, media: s.media, mode });
      }
      const s = sessionOf(req);
      if (!s) return json(res, 401, { ok: false, error: 'No session.' });
      if (req.method === 'DELETE') { end(s); return json(res, 200, { ok: true }); }
      if (req.method === 'GET') return json(res, 200, { ok: true, media: s.media, mode });
      return json(res, 405, { ok: false, error: 'not allowed' });
    }
    if (p === '/api/contract' && req.method === 'GET') return json(res, 200, o.contract.describe());
    const s = sessionOf(req);
    if (!s) return json(res, 401, { ok: false, error: 'No session.' });
    s.at = Date.now();
    if (p === '/api/events' && req.method === 'GET') return bus.attach(s.id, req, res);
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'not allowed' });
    if (p.startsWith('/api/rpc/')) {
      const key = decodeURIComponent(p.slice('/api/rpc/'.length));
      if (!/^[a-z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*$/.test(key)) return json(res, 404, { ok: false, error: 'That isn\'t something FLPT does.' });
      const args = await readJson(req, RPC_LIMIT);
      const r = await rpc.call(s, key, args == null ? [] : args);
      let body;
      try { body = JSON.stringify(r.body); } catch { body = JSON.stringify({ ok: false, error: 'That answer couldn\'t be sent.' }); }
      return send(res, r.status, body, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': API_CSP });
    }
    if (p === '/api/upload') {
      const up = await uploads.receive(req, { session: s.id });
      return json(res, 200, { ok: true, ...up });
    }
    if (p === '/api/approve') {
      const body = await readJson(req, SMALL_LIMIT);
      if (mode === 'web' && !authorized(req)) return json(res, 403, { ok: false, error: 'not allowed' });
      return json(res, 200, approvals.answer(body || {}, { session: s.id }));
    }
    if (p === '/api/dialog') {
      const body = await readJson(req, SMALL_LIMIT);
      return json(res, 200, approvals.reply(body || {}, { session: s.id }));
    }
    return json(res, 404, { ok: false, error: 'not found' });
  }

  function files(req, res, url) {
    const m = /^\/files\/([A-Za-z0-9_-]{32})\/?$/.exec(url.pathname);
    const s = m ? byMedia.get(m[1]) : null;
    if (!s) return text(res, 403, 'not allowed');
    const named = url.searchParams.get('p') || '';
    const abs = refs.fromPage(named, { rest: true }) || (path.isAbsolute(named) ? path.resolve(named) : null);
    return serveFile(req, res, abs, host.fileRoots());
  }

  async function handle(req, res) {
    let url;
    try { url = new URL(req.url, 'http://flpt.invalid'); } catch { return text(res, 400, 'bad request'); }
    if (o.onRequest) o.onRequest(req, url);
    if (!guard(req, res, url)) return undefined;
    // web: every request is the Worker's (rpc, events, uploads, answers, /files, the screens), not only a session's
    // start and an approval: a session token or a media link on its own reaches nothing
    if (mode === 'web' && !authorized(req)) return url.pathname.startsWith('/api/') ? json(res, 401, { ok: false, error: 'No session.' }) : text(res, 403, 'not allowed');
    try {
      if (url.pathname === '/bridge/contract.js') return send(res, 200, req.method === 'HEAD' ? '' : contractJs, { 'Content-Type': STATIC['.js'], 'Cache-Control': 'no-store' });
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (url.pathname.startsWith('/files/')) return await files(req, res, url);
      return serveStatic(req, res, url);
    } catch (e) {
      const status = Number.isInteger(e && e.status) ? e.status : 500;
      const msg = status === 500 ? 'Something went wrong.' : String(e.message || 'bad request');
      if (status === 500 && o.log) o.log(`flpt-server: ${host.api && typeof host.api.redact === 'function' ? host.api.redact(String(e && e.stack || e)) : 'error'}`);
      if (url.pathname.startsWith('/api/')) return json(res, status, { ok: false, error: msg });
      return text(res, status, msg);
    }
  }

  const server = http.createServer((req, res) => { handle(req, res); });
  server.headersTimeout = 60000;
  server.requestTimeout = 0; // uploads and the event stream run long
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(o.port || 0, o.bind || '127.0.0.1', resolve); });
  const port = server.address().port;
  const names = mode === 'web' ? [...(o.hosts || [])] : [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, ...(o.hosts || [])];
  allowed = new Set(names.map((n) => n.toLowerCase()));
  origins = new Set(names.flatMap((n) => (mode === 'web' ? [`https://${n}`, `http://${n}`] : [`http://${n}`])).map((n) => n.toLowerCase()));
  const base = mode === 'web' ? null : `http://127.0.0.1:${port}`;

  async function close() {
    approvals.close();
    bus.closeAll();
    uploads.clear();
    if (host.close) { try { await host.close(); } catch { /* best effort */ } }
    await new Promise((r) => { server.close(() => r()); server.closeAllConnections(); });
  }

  return {
    server, port, mode, base,
    url: base ? `${base}/#k=${launch}` : null, // what the user opens: the launch token rides in the fragment
    launch, host, refs, bus, approvals, uploads, rpc, close,
    refFor: (dir) => refs.refOf(dir),
    sessions: () => sessions.size,
  };
}

module.exports = { createHttp, webPage, webCsp, BASE_HEADERS };
