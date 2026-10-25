'use strict';
// uploads.js · files the page sends (PLAN §2.13; W4-01). On the Mac a dropped file's path comes from the preload; on the
// web the page has no paths to give, so it sends the file itself: `POST /api/upload?name=<file name>` with the bytes as
// the body. The server keeps it in its own uploads folder and answers with a token; the page then names the token
// where the Mac would name the path (a dropped-files argument, or the answer to a file picker), and the server swaps
// the token for the file's path before the call runs. A token is single-use and lives 30 minutes; its file is removed
// with it. Names are reduced to a safe base name, sizes are capped, and nothing the page sends is ever a path.
//   createUploads({ dir, maxBytes, ttlMs, now })
//     receive(req, { session }) → Promise<{ token, name, size }>   (throws an Error with .status 400/413 on a bad one)
//     take(token, { session }) → absolute path                      (once; throws when unknown, used or expired)
//     peek(token) → { name, size } | null · sweep() · clear()

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB: a screen recording or a long export
const TTL_MS = 30 * 60 * 1000;
const TOKEN = /^up_[A-Za-z0-9_-]{22}$/;

const fail = (status, message) => Object.assign(new Error(message), { status });

/** A file name the page sent, as a safe base name: no folders, no control or path characters, at most 120 characters. */
function safeName(raw) {
  let n = String(raw || '').normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, '').split(/[\\/]/).pop().trim(); // eslint-disable-line no-control-regex
  n = n.replace(/[<>:"|?*]/g, '_').replace(/^\.+/, '');
  if (n.length > 120) { const ext = path.extname(n).slice(0, 12); n = n.slice(0, 120 - ext.length) + ext; }
  return n || 'file';
}

function createUploads({ dir, maxBytes = MAX_BYTES, ttlMs = TTL_MS, now = () => Date.now() } = {}) {
  if (!dir || !path.isAbsolute(dir)) throw new Error('uploads: needs an absolute folder');
  const held = new Map(); // token → { file, name, size, session, at }

  function drop(token) {
    const h = held.get(token);
    held.delete(token);
    if (h) fs.rm(path.dirname(h.file), { recursive: true, force: true }, () => {});
  }

  function sweep() {
    for (const [t, h] of held) if (now() - h.at > ttlMs) drop(t);
  }

  /** Read one upload from the request body into its own folder. */
  function receive(req, { session } = {}) {
    sweep();
    const url = new URL(req.url, 'http://x');
    const name = safeName(url.searchParams.get('name') || req.headers['x-flpt-name']);
    const declared = req.headers['content-length'] != null ? Number(req.headers['content-length']) : null;
    if (declared != null && (!Number.isFinite(declared) || declared < 0)) return Promise.reject(fail(400, 'bad length'));
    if (declared != null && declared > maxBytes) { req.resume(); return Promise.reject(fail(413, 'too big')); }
    const token = `up_${crypto.randomBytes(16).toString('base64url')}`;
    const folder = path.join(dir, token);
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
    const file = path.join(folder, name);
    return new Promise((resolve, reject) => {
      let size = 0;
      let over = false;
      const out = fs.createWriteStream(file, { flags: 'wx', mode: 0o600 });
      const abort = (err) => { req.unpipe(out); out.destroy(); fs.rm(folder, { recursive: true, force: true }, () => {}); reject(err); };
      req.on('data', (c) => {
        size += c.length;
        if (size > maxBytes && !over) { over = true; abort(fail(413, 'too big')); req.resume(); }
      });
      req.on('aborted', () => { if (!over) abort(fail(400, 'upload cut short')); });
      out.on('error', (e) => { if (!over) abort(fail(500, e.message)); });
      out.on('finish', () => {
        if (over) return;
        if (declared != null && size !== declared) { abort(fail(400, 'upload cut short')); return; }
        held.set(token, { file, name, size, session: session || null, at: now() });
        resolve({ token, name, size });
      });
      req.pipe(out);
    });
  }

  /** The file behind a token, once (the session that sent it, when given, must be the one using it). */
  function take(token, { session } = {}) {
    sweep();
    if (typeof token !== 'string' || !TOKEN.test(token)) throw new Error('That file isn\'t here any more. Add it again.');
    const h = held.get(token);
    if (!h || (session && h.session && h.session !== session)) throw new Error('That file isn\'t here any more. Add it again.');
    held.delete(token); // single-use; the file stays a while, for the call (or the staging it lands in) to read
    setTimeout(() => fs.rm(path.dirname(h.file), { recursive: true, force: true }, () => {}), 2 * ttlMs).unref();
    return h.file;
  }

  const peek = (token) => { const h = held.get(token); return h ? { name: h.name, size: h.size } : null; };
  const clear = () => { for (const t of [...held.keys()]) drop(t); };

  return { receive, take, peek, sweep, clear, dir, isToken: (t) => typeof t === 'string' && TOKEN.test(t) };
}

module.exports = { createUploads, safeName, MAX_BYTES, TTL_MS };
