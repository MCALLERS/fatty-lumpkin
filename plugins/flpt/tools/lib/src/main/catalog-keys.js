'use strict';
// catalog-keys.js · the public keys a signed style catalog must verify against (PLAN §2.10.3; W3-11). Two are pinned,
// the current key and the next one, so a release signed with the next key still verifies on every install once
// Michael rotates to it. A client takes a key from nowhere else: not the network, not the catalog, not a setting, not
// the environment.
//
// A key is { id, role, x }: x is the raw 32-byte Ed25519 public key in base64url (a JWK's "x"), as
// `node engine/tools/dev/sign-catalog.mjs pubkey` prints it. Until G7 (Michael makes the dedicated signing keychain
// and the key: PLAN §5.5, W6-04) no key is pinned (x: null) and every catalog is refused before anything is fetched:
// there is nothing to check one against. Pinning a key is a reviewed code change, never a download.
//
// Only public keys, ever: app/test/catalog.test.mjs fails if this file holds anything that looks like a private one.
const crypto = require('crypto');

const PINNED = Object.freeze([
  Object.freeze({ id: 'flpt-cat-2026a', role: 'current', x: 'ZtVwlXJX6Ulgv_S27ixf65rDTLzOWWoX3khWIgPuXDY' }),
  Object.freeze({ id: 'flpt-cat-2026b', role: 'next', x: 'gd7RFpBBU5Ki2-Yw2JeXUnv0GU7fEBEIIAUv9IfWRQE' }),
]);

const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const X_RE = /^[A-Za-z0-9_-]{43}$/;

/** A pinned key's public half as a KeyObject, or null when it isn't one (not pinned yet, or malformed). */
function keyObject(k) {
  if (!k || typeof k !== 'object' || !ID_RE.test(String(k.id || '')) || !X_RE.test(String(k.x || ''))) return null;
  if (Buffer.from(k.x, 'base64url').length !== 32) return null;
  try { return crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: k.x }, format: 'jwk' }); } catch { return null; }
}

/**
 * The keys a catalog may be signed with: [{ id, role, key }], at most two, each id once (a list that breaks either
 * rule gives none: a client never guesses which of two keys an id means).
 */
function usable(keys = PINNED) {
  const list = Array.isArray(keys) ? keys : [];
  if (list.length > 2) return [];
  const ids = list.map((k) => k && k.id);
  if (new Set(ids).size !== ids.length) return [];
  return list.map((k) => ({ id: k.id, role: k.role || null, key: keyObject(k) })).filter((k) => k.key);
}

/** The base64url "x" of an Ed25519 key's public half (what goes into PINNED), from its public or private KeyObject. */
function xOf(key) {
  const pub = key instanceof crypto.KeyObject && key.type === 'public' ? key : crypto.createPublicKey(key);
  const jwk = pub.export({ format: 'jwk' });
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519') throw new Error('not an Ed25519 key');
  return jwk.x;
}

/** The detached signature in a .sig file: base64 (or base64url) text of 64 bytes, or the 64 raw bytes. null if neither. */
function parseSig(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf == null ? '' : buf), 'latin1');
  const text = b.toString('latin1').trim();
  if (/^[A-Za-z0-9+/_-]{86}(==)?$/.test(text)) {
    const raw = Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    return raw.length === 64 ? raw : null;
  }
  return b.length === 64 ? Buffer.from(b) : null;
}

/**
 * Does sig sign bytes under one of the keys? → { ok, keyId } (the first key that verifies), or { ok: false }.
 * The exact bytes: nothing is parsed, normalised or re-serialised before the check.
 */
function verify(bytes, sig, keys = PINNED) {
  const s = parseSig(sig);
  if (!s || !Buffer.isBuffer(bytes)) return { ok: false };
  for (const k of usable(keys)) {
    let good = false;
    try { good = crypto.verify(null, bytes, k.key, s); } catch { good = false; }
    if (good) return { ok: true, keyId: k.id };
  }
  return { ok: false };
}

module.exports = { PINNED, ID_RE, keyObject, usable, xOf, parseSig, verify };
