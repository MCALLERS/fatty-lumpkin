'use strict';
// desk.js · the Desk's server-side parts (PLAN §2.5 "Desk", §2.16.1; W4-01 · W4-02 drives them from flpt-desk.js):
//   createPreview({ appOrigin })  the second loopback port for preview frames. Each frame load gets its own path token,
//       /s/<token>/<file>, scoped to one folder and one mode and expiring in 15 minutes. The token's entry page may be
//       loaded once, under any spelling (paths are normalised; //, %2f and %5c refused): a frame that loads itself again
//       (a self-navigation) gets 410, as the harness kills a scene frame that loads a second time. Every answer carries
//       the Stage's CSP (sandbox allow-scripts; connect-src 'none'; frame-ancestors the app's origin only),
//       X-DNS-Prefetch-Control off and nosniff, and no cookie, on a port of its own (another origin), so a scene never
//       shares the app's.
//   createIdle({ ms, onIdle })    the Desk stops itself after 30 idle minutes.
//   writeState(file, state)       the running Desk's pid, ports and launch URL, mode 0600 (flpt-desk reads it).

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const PREVIEW_TTL_MS = 15 * 60 * 1000;
const IDLE_MS = 30 * 60 * 1000;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8',
};

/** The Stage's CSP for a frame the app at `appOrigin` may embed (PLAN §2.5: the web row's, framed by the Desk). */
const previewCsp = (appOrigin) => `sandbox allow-scripts; default-src 'self' data: blob:; connect-src 'none'; form-action 'none'; frame-ancestors ${appOrigin}`;

function createPreview({ appOrigin, ttlMs = PREVIEW_TTL_MS, now = () => Date.now(), bind = '127.0.0.1' } = {}) {
  if (!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(String(appOrigin))) throw new Error('preview: the app origin is a loopback origin');
  const tokens = new Map(); // token → { root, entry, mode, expires, entered }
  let port = 0;
  let server = null;

  /** A path token for one frame load: `root` (a folder) is all it reaches; `entry` the page it opens. */
  function mint({ root, entry = 'index.html', mode = 'scene' } = {}) {
    const real = fs.realpathSync(root);
    const t = crypto.randomBytes(24).toString('base64url');
    tokens.set(t, { root: real, entry: entry.replace(/^\/+/, ''), mode, expires: now() + ttlMs, entered: false });
    return { token: t, url: `http://127.0.0.1:${port}/s/${t}/${entry.replace(/^\/+/, '')}`, expires: now() + ttlMs };
  }
  const revoke = (t) => tokens.delete(t);

  function answer(res, status, body, extra = {}) {
    res.writeHead(status, {
      'Content-Security-Policy': previewCsp(appOrigin), 'X-DNS-Prefetch-Control': 'off', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store', 'Cross-Origin-Resource-Policy': 'cross-origin', ...extra,
    });
    res.end(body);
  }

  function handle(req, res) {
    const hostOk = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(String(req.headers.host || '').toLowerCase());
    if (!hostOk) return answer(res, 421, 'wrong host');
    if (req.method !== 'GET' && req.method !== 'HEAD') return answer(res, 405, 'not allowed');
    let u;
    try { u = new URL(req.url, 'http://x'); } catch { return answer(res, 400, 'bad request'); }
    const m = /^\/s\/([A-Za-z0-9_-]{32})\/(.*)$/.exec(u.pathname);
    const tok = m ? tokens.get(m[1]) : null;
    if (!tok) return answer(res, 404, 'not found');
    if (now() > tok.expires) { tokens.delete(m[1]); return answer(res, 410, 'expired'); }
    // one spelling per file: an empty segment (//), an encoded slash or backslash (%2f, %5c), a backslash or a NUL is
    // refused, and the rest is normalised before it's compared with the entry (so no other spelling loads it twice)
    if (/\/\/|%2f|%5c|%00|\\/i.test(u.pathname)) return answer(res, 400, 'bad path');
    let rel;
    try { rel = decodeURIComponent(m[2]); } catch { return answer(res, 400, 'bad path'); }
    rel = path.posix.normalize(`/${rel}`).slice(1);
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = path.join(tok.root, rel);
    let real;
    try { real = fs.realpathSync(file); } catch { return answer(res, 404, 'not found'); }
    if (!real.startsWith(tok.root + path.sep)) return answer(res, 404, 'not found');
    const type = TYPES[path.extname(real).toLowerCase()];
    let st;
    try { st = fs.statSync(real); } catch { st = null; }
    if (!type || !st || !st.isFile()) return answer(res, 404, 'not found');
    // the entry by name, or by what it is (on a case-insensitive disk INDEX.HTML is index.html; a link to it is it)
    let entry = null;
    try { entry = fs.statSync(path.join(tok.root, tok.entry)); } catch { entry = null; }
    if (rel === tok.entry || (entry && entry.dev === st.dev && entry.ino === st.ino)) {
      if (tok.entered) return answer(res, 410, 'gone'); // a second load of the page itself: the frame navigated
      tok.entered = true;
    }
    if (req.method === 'HEAD') return answer(res, 200, '', { 'Content-Type': type, 'Content-Length': String(st.size) });
    res.writeHead(200, {
      'Content-Type': type, 'Content-Length': String(st.size), 'Content-Security-Policy': previewCsp(appOrigin), 'X-DNS-Prefetch-Control': 'off',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    return fs.createReadStream(real).pipe(res);
  }

  async function start(p = 0) {
    server = http.createServer(handle);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(p, bind, resolve); });
    port = server.address().port;
    return port;
  }
  const close = () => new Promise((r) => { if (!server) { r(); return; } server.close(() => r()); server.closeAllConnections(); });

  return { start, mint, revoke, close, get port() { return port; }, csp: () => previewCsp(appOrigin) };
}

/** Calls onIdle once nothing has touched it for `ms` (each request touches it). */
function createIdle({ ms = IDLE_MS, onIdle, now = () => Date.now() } = {}) {
  let last = now();
  let fired = false;
  const timer = setInterval(() => { if (!fired && now() - last >= ms) { fired = true; clearInterval(timer); onIdle(); } }, Math.min(ms, 60000));
  timer.unref();
  return { touch: () => { last = now(); }, stop: () => clearInterval(timer), idleFor: () => now() - last };
}

function writeState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

module.exports = { createPreview, createIdle, writeState, previewCsp, PREVIEW_TTL_MS, IDLE_MS };
