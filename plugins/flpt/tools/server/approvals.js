'use strict';
// approvals.js · the web's stand-in for the Mac's native dialogs (PLAN §2.13 "Approvals"; W4-01). On the Mac, money is
// asked in a native dialog page code can't click. On the web the core's confirm(opts) becomes:
//   approval:request { id, title, message, detail, button, amountUsd, hash, expires }   (to every session's stream)
//   → the page's modal (ui-approval.js: Cancel focused, the amount stated)
//   → POST /api/approve { id, hash, yes }
// The id is a single-use nonce; the hash binds the answer to exactly what was shown (title, message, detail, button,
// amount, expiry); an answer after `expires` (5 minutes) is refused and the request counts as a no. In web mode the
// Worker's Durable Object checks the user's monthly ceiling and rate limit before the answer reaches the container
// (W4-05); here the server only resolves what it asked. The Desk (approve: 'none') never spends: every confirm is no.
// The same nonce-and-hash path carries the core's other two native dialogs, to the session that called:
//   ask(opts)  a message box (delete this item?): dialog:ask { id, message, detail, buttons, defaultId, cancelId, hash }
//              → POST /api/dialog { id, hash, response }            → { response }
//   open(opts) a file picker: dialog:open { id, title, multi, accept, hash }
//              → the page uploads the picked files (uploads.js) → POST /api/dialog { id, hash, uploads: [tokens] }
//              → { canceled, filePaths }                            (canceled: { id, hash, canceled: true })

const crypto = require('crypto');

const CONFIRM_TTL_MS = 5 * 60 * 1000;
const DIALOG_TTL_MS = 10 * 60 * 1000;
const MAX_TEXT = 2000;

const fail = (status, message) => Object.assign(new Error(message), { status });
const clip = (s, n = MAX_TEXT) => (typeof s === 'string' ? s.slice(0, n) : '');

/** The amount a spend dialog's button states ("Approve 12.34 US dollars", "Approve up to 48 US dollars"), or null. */
function amountOf(...texts) {
  for (const t of texts) {
    const m = /(\d+(?:\.\d+)?)\s+(?:more\s+)?US dollars/.exec(String(t || ''));
    if (m) return Number(m[1]);
  }
  return null;
}

/** sha256 over exactly what the page shows and answers (hex). */
function hashOf(fields) {
  return crypto.createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

/** File picker filters (Electron's [{ name, extensions }]) as an `accept` list for <input type=file>. */
function acceptOf(filters) {
  const ext = new Set();
  for (const f of Array.isArray(filters) ? filters : []) {
    for (const e of Array.isArray(f && f.extensions) ? f.extensions : []) if (/^[a-z0-9]{1,8}$/i.test(e) && e !== '*') ext.add(`.${e.toLowerCase()}`);
  }
  return [...ext];
}

/**
 * @param {object} o
 * @param {object} o.bus        sse.js's bus (broadcast for money, send for the caller's own dialogs)
 * @param {object} [o.uploads]  uploads.js (a file picker's answer names upload tokens)
 * @param {'modal'|'none'} [o.mode]  'none' (the Desk): every confirm is a no, nothing is asked
 * @param {Function} [o.decorate]    (request) → extra fields for the page (web: the month's spend and ceiling)
 */
function createApprovals({ bus, uploads = null, mode = 'modal', decorate = null, confirmTtlMs = CONFIRM_TTL_MS, dialogTtlMs = DIALOG_TTL_MS, now = () => Date.now() } = {}) {
  const pending = new Map(); // id → { kind, hash, expires, session, resolve, timer }
  const used = new Set(); // ids answered or expired: a replay is refused (410)
  const log = []; // what was asked and how it ended (QA reads it; never a key, only the dialog's own words)

  function settle(id, value, how) {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    used.add(id);
    clearTimeout(p.timer);
    log.push({ id, kind: p.kind, how, at: new Date(now()).toISOString(), title: p.title });
    if (log.length > 200) log.shift();
    if (p.kind === 'confirm') bus.broadcast('approval:done', { id, yes: value === true });
    else if (p.session) bus.send(p.session, 'dialog:done', { id });
    p.resolve(value);
  }

  function hold(kind, fields, { session = null, ttl, onExpire }) {
    const id = `${kind === 'confirm' ? 'ap' : 'dl'}_${crypto.randomBytes(16).toString('base64url')}`;
    const expires = now() + ttl;
    const shown = { id, ...fields, expires };
    const hash = hashOf(shown);
    return new Promise((resolve) => {
      const timer = setTimeout(() => settle(id, onExpire(), 'expired'), Math.max(0, expires - now()));
      timer.unref();
      pending.set(id, { kind, hash, expires, session, resolve, timer, onExpire, title: fields.title || fields.message || '' });
      const ev = { ...shown, hash };
      if (kind === 'confirm') bus.broadcast('approval:request', { ...(decorate ? decorate({ ...ev }) || {} : {}), ...ev }); // what was asked always wins
      else bus.send(session, kind === 'ask' ? 'dialog:ask' : 'dialog:open', ev);
    });
  }

  /** The core's confirm(opts): money. Resolves true only on the page's own yes to exactly this request. */
  function confirm(opts = {}) {
    if (mode === 'none') { log.push({ kind: 'confirm', how: 'refused (no approvals here)', at: new Date(now()).toISOString(), title: clip(opts.title, 200) }); return Promise.resolve(false); }
    const fields = { title: clip(opts.title, 200), message: clip(opts.message), detail: clip(opts.detail), button: clip(opts.button, 120) };
    fields.amountUsd = amountOf(fields.button, fields.detail);
    return hold('confirm', fields, { ttl: confirmTtlMs, onExpire: () => false });
  }

  /** A message box for the session that called: { response } (the cancel button on expiry). */
  function ask(opts = {}, { session } = {}) {
    const buttons = (Array.isArray(opts.buttons) ? opts.buttons : ['OK']).slice(0, 4).map((b) => clip(String(b), 80));
    const cancelId = Number.isInteger(opts.cancelId) && opts.cancelId >= 0 && opts.cancelId < buttons.length ? opts.cancelId : 0;
    const defaultId = Number.isInteger(opts.defaultId) && opts.defaultId >= 0 && opts.defaultId < buttons.length ? opts.defaultId : cancelId;
    if (!session || !bus.has(session)) return Promise.resolve({ response: cancelId });
    const fields = { title: clip(opts.title, 200), message: clip(opts.message), detail: clip(opts.detail), buttons, defaultId, cancelId };
    return hold('ask', fields, { session, ttl: dialogTtlMs, onExpire: () => ({ response: cancelId }) });
  }

  /** A file picker for the session that called: { canceled, filePaths } (canceled on expiry, or without a session). */
  function open(opts = {}, { session } = {}) {
    if (!session || !bus.has(session) || !uploads) return Promise.resolve({ canceled: true, filePaths: [] });
    const props = Array.isArray(opts.properties) ? opts.properties : [];
    const fields = { title: clip(opts.title, 200), multi: props.includes('multiSelections'), accept: acceptOf(opts.filters) };
    return hold('open', fields, { session, ttl: dialogTtlMs, onExpire: () => ({ canceled: true, filePaths: [] }) });
  }

  /** The request behind an answer, checked: known, unused, unexpired, this hash, and (for dialogs) this session. */
  function check(id, hash, session, kind) {
    if (typeof id !== 'string' || typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) throw fail(400, 'bad answer');
    const p = pending.get(id);
    if (!p) throw fail(used.has(id) ? 410 : 404, used.has(id) ? 'already answered' : 'unknown');
    if (p.kind === 'confirm' ? kind !== 'confirm' : kind === 'confirm') throw fail(400, 'wrong kind');
    if (p.session && p.session !== session) throw fail(403, 'not yours');
    if (now() > p.expires) { settle(id, p.onExpire(), 'expired'); throw fail(410, 'expired'); }
    if (!crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(p.hash))) throw fail(409, 'that isn\'t what was asked');
    return p;
  }

  /** POST /api/approve: { id, hash, yes }. */
  function answer({ id, hash, yes } = {}, { session } = {}) {
    check(id, hash, session, 'confirm');
    settle(id, yes === true, yes === true ? 'approved' : 'declined');
    return { ok: true };
  }

  /** POST /api/dialog: { id, hash, response } for a message box; { id, hash, uploads | canceled } for a picker. */
  function reply(body = {}, { session } = {}) {
    const p = check(body.id, body.hash, session, 'dialog');
    if (p.kind === 'ask') {
      const r = Number.isInteger(body.response) && body.response >= 0 && body.response < 4 ? body.response : 0;
      settle(body.id, { response: r }, `button ${r}`);
      return { ok: true };
    }
    if (body.canceled === true || !Array.isArray(body.uploads) || !body.uploads.length) { settle(body.id, { canceled: true, filePaths: [] }, 'canceled'); return { ok: true }; }
    const filePaths = [];
    for (const t of body.uploads.slice(0, 500)) filePaths.push(uploads.take(t, { session })); // throws on a token that isn't this session's
    settle(body.id, { canceled: false, filePaths }, `${filePaths.length} file(s)`);
    return { ok: true };
  }

  /** Everything still waiting is a no (the server is stopping). */
  function close() {
    for (const [id, p] of [...pending]) settle(id, p.onExpire(), 'closed');
  }

  return { confirm, ask, open, answer, reply, close, mode, pending: () => [...pending.keys()], log: () => log.slice() };
}

module.exports = { createApprovals, amountOf, hashOf, acceptOf, CONFIRM_TTL_MS, DIALOG_TTL_MS };
