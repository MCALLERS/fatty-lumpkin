'use strict';
// sharequeue.js · Share's review queue, the client (W4-09; decisions.md D15/M2, PLAN §2.10.3). The Mac app and the
// plugin send a neutral package (styles.exportShare's .flptstyle, with submission.json and the ⚑ ticks) to FLPT's site,
// POST <origin>/api/share (web/worker/routes/share.js), as the signed-in user. The web app's Share never comes here:
// its Worker takes the call itself (flpt.share.send) and asks the container for the bytes (api/share.js package).
//
// Where and as whom: the host's sign-in, { origin, headers() }: the site's origin (https, or a loopback address for
// local development) and the signed-in request's headers (W4-10's device token; an Access token under wrangler dev).
// W4-10's sign-in registers it once signed in (useSignIn(signIn), and useSignIn(null) on sign-out); a host or a test
// may pass its own as c.signIn. With none, the queue isn't configured here: Share shows Export only (ext/sharequeue
// adds 'queue' to caps.share only when it is) and send() says so without reaching the network.
//
//   createQueue({ origin, headers, fetchImpl, timeoutMs, userAgent }) → { configured, origin, send(bytes) }
//     send → { status: 'sent' | 'duplicate', id, label }, or throws a QueueError whose code says what to do next:
//       not-deployed   no origin configured                       → Export
//       signed-out     no sign-in, or the site says 401/403        → Export
//       unreachable    no answer, a timeout, a 404 or a 5xx         → Export ("falls back to export", D15)
//       refused        the queue's own no (413, 415, 409, 422, 429) → its reason, shown; nothing exported
//   queueFor(c) → the host's queue (c.shareQueue for a host or a test that brings its own, else from c.signIn, else
//                 from the registered sign-in)
//   useSignIn(signIn | null) · signInFor(c) → the sign-in in use, or null
// Nothing here reads a key or a token: headers() is the host's, and its values go only to that origin.

const PACKAGE_TYPE = 'application/vnd.flpt.style+zip';
const TIMEOUT_MS = 60000;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

class QueueError extends Error {
  constructor(code, message) { super(message); this.name = 'QueueError'; this.code = code; }
}

/** The site's origin if it's one FLPT may send a package to (https, or loopback http for local development), else null. */
function cleanOrigin(o) {
  let u;
  try { u = new URL(String(o || '')); } catch { return null; }
  if (u.username || u.password || (u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) return null;
  if (u.protocol === 'https:' || (u.protocol === 'http:' && LOOPBACK.has(u.hostname))) return u.origin;
  return null;
}

function createQueue({ origin, headers, fetchImpl = (...a) => fetch(...a), timeoutMs = TIMEOUT_MS, userAgent = 'FLPT' } = {}) {
  const site = cleanOrigin(origin);
  async function send(bytes) {
    if (!site) throw new QueueError('not-deployed', 'The review queue isn\'t open yet.');
    let h = null;
    try { h = typeof headers === 'function' ? await headers() : null; } catch { h = null; }
    if (!h || typeof h !== 'object' || !Object.keys(h).length) throw new QueueError('signed-out', 'Not signed in.');
    let res;
    try {
      res = await fetchImpl(`${site}/api/share`, {
        method: 'POST', body: bytes, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { ...h, 'content-type': PACKAGE_TYPE, 'user-agent': userAgent, accept: 'application/json' },
      });
    } catch { throw new QueueError('unreachable', 'The review queue didn\'t answer.'); }
    let body = null;
    try { body = JSON.parse((await res.text()).slice(0, 64 * 1024)); } catch { body = null; }
    const said = body && typeof body.error === 'string' ? body.error.slice(0, 240) : null;
    if (res.status === 201 || res.status === 200) {
      if (!body || body.ok !== true || typeof body.id !== 'string') throw new QueueError('unreachable', 'The review queue answered out of shape.');
      return { status: res.status === 201 ? 'sent' : 'duplicate', id: body.id.slice(0, 40), label: res.status === 201 ? 'Sent for review' : 'Already sent' };
    }
    if (res.status === 401 || res.status === 403) throw new QueueError('signed-out', 'Not signed in.');
    if ([409, 413, 415, 422, 429].includes(res.status)) throw new QueueError('refused', said || 'The review queue refused it.');
    throw new QueueError('unreachable', 'The review queue didn\'t answer.');
  }
  return { configured: Boolean(site), origin: site, send };
}

let registered = null;
/** W4-10's sign-in: { origin, headers() } once the user is signed in to FLPT's site; null when they sign out. */
function useSignIn(signIn) {
  registered = signIn && typeof signIn === 'object' && typeof signIn.headers === 'function' && cleanOrigin(signIn.origin) ? { origin: signIn.origin, headers: signIn.headers } : null;
  return Boolean(registered);
}
/** The sign-in this host would send as: c.signIn when it brings one, else the registered one, else null. */
function signInFor(c) {
  const s = c && c.signIn && typeof c.signIn === 'object' ? c.signIn : registered;
  return s && typeof s.headers === 'function' && cleanOrigin(s.origin) ? s : null;
}

/** This host's queue: its own (c.shareQueue), else one from its sign-in (signInFor), else an unconfigured one. */
function queueFor(c) {
  if (c && c.shareQueue && typeof c.shareQueue.send === 'function') return { configured: c.shareQueue.configured !== false, ...c.shareQueue, send: c.shareQueue.send };
  const s = signInFor(c);
  let version = null;
  try { version = require('../../package.json').version; } catch { version = null; }
  return createQueue({ origin: s ? s.origin : null, headers: s ? s.headers : null, userAgent: `FLPT/${version || '2'}` });
}

module.exports = { createQueue, queueFor, useSignIn, signInFor, cleanOrigin, QueueError, PACKAGE_TYPE };
