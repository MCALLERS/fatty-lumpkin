'use strict';
// flpt.signin (W4-10): the FLPT voices' sign-in on the Mac (decisions.md, "FLPT voices": "signed-in users only: a free
// email sign-in at flpt.bombadillo-ai.com, used by the Mac app (device-code sign-in)"). providers/fish-house.js does the
// talking; this keeps the token in the Keychain vault (FLPT_VOICES_TOKEN; the page never sees it) and says how it went.
// The token is the Worker's that issued it (flpt-voices.json keeps that `base`): while FLPT talks to another (a changed
// FLPT_VOICES_URL), it is signed out here and the token is sent nowhere.
//   status()    { available, signedIn, email, host, pending: { userCode, url, expiresAt } | null, voices: [{ id, name,
//               sample }] } (sample: the shipped clip's path in the renderer, or null)
//   start()     a new code; FLPT's page for it opens in the browser; main waits for the answer there → status()
//   open()      the page for the waiting code again (the same link) → { ok }
//   cancel()    stop waiting → status()
//   signOut()   the Worker forgets this device's token, then the vault does → status()
//   usage()     this month's free FLPT voice videos → { ok, videosUsed, videosPerMonth, charsPerVideo } or { ok: false }
// Event: signin:changed { signedIn, email?, error? } when a sign-in ends (either way) or the device signs out.
// Signed in, Share's review queue sends as this sign-in (sharequeue.useSignIn: the Worker that issued the token, the
// token as a Bearer; W4-09); signed out, it doesn't, and Share exports.
// The Mac app only (caps.surface 'mac': its Keychain); elsewhere `available` is false and the rest refuses. The plugin
// signs in with engine/tools/flpt-signin.js. Nothing here costs anything.
const fs = require('fs');
const path = require('path');
const house = require('../providers/fish-house');
const sharequeue = require('../sharequeue');

house.registerVault(); // the vault can keep the sign-in (FLPT_VOICES_TOKEN)

// The free samples, ~10 s each, shipped beside the screens (made by the lead with Michael's OK, 2026-10-24):
// app/src/renderer/assets/voices/<voice id>.(m4a|mp3|wav). The page plays them itself.
const SAMPLES = path.join(__dirname, '..', '..', 'renderer', 'assets', 'voices');
function sampleOf(id) {
  for (const ext of ['m4a', 'mp3', 'wav']) {
    try { if (fs.statSync(path.join(SAMPLES, `${id}.${ext}`)).isFile()) return `assets/voices/${id}.${ext}`; } catch { /* not shipped */ }
  }
  return null;
}

let pending = null; // { userCode, url, expiresAt, ctrl }

const available = (c) => { const caps = typeof c.caps === 'function' ? c.caps() : null; return Boolean(caps && caps.surface === 'mac' && c.vault); };
const guard = (c) => { if (!available(c)) throw new Error('The FLPT voices sign in from FLPT for Mac.'); };
const tell = (c, payload) => { try { c.send('signin:changed', payload); } catch { /* no window */ } };
const said = (c, e) => { const m = String((e && e.message) || e); return (c.redact ? c.redact(m) : m).slice(0, 200); };

// The account beside the vault (not a secret: who is signed in, and the Worker the token is for), in the app's own folder.
const accountFile = (c) => (c.dirs && c.dirs.userData ? path.join(c.dirs.userData, 'flpt-voices.json') : null);
function readAccount(c) {
  const f = accountFile(c);
  try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return j && typeof j === 'object' ? j : {}; } catch { return {}; }
}
function writeAccount(c, value) {
  const f = accountFile(c);
  if (!f) return;
  if (value == null) { fs.rmSync(f, { force: true }); return; }
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(`${f}.tmp`, f);
}

/** The sign-in's token, only while FLPT talks to the Worker that issued it; else null. */
function tokenFor(c) {
  if (readAccount(c).base !== house.baseUrl()) return null;
  try { return c.vault.get(house.TOKEN) || null; } catch { return null; }
}

function signedIn(c) {
  if (readAccount(c).base !== house.baseUrl()) return false;
  try { const s = c.vault.status(); return Boolean(s[house.TOKEN] && s[house.TOKEN].set); } catch { return false; }
}

/** Share's review queue as this sign-in, or none (W4-09): registered while signed in, dropped otherwise. */
function shareAs(c, on) {
  let origin = null;
  try { origin = new URL(house.baseUrl()).origin; } catch { origin = null; }
  if (!on || !origin) { sharequeue.useSignIn(null); return false; }
  return sharequeue.useSignIn({ origin, headers: async () => { const t = tokenFor(c); return t ? { authorization: `Bearer ${t}` } : null; } });
}

function status(c) {
  const ok = available(c);
  const base = house.baseUrl();
  const on = ok && signedIn(c);
  if (ok) shareAs(c, on);
  return {
    available: ok,
    signedIn: on,
    email: on ? (readAccount(c).email || null) : null,
    host: house.hostOf(base),
    pending: ok && pending ? { userCode: pending.userCode, url: pending.url, expiresAt: pending.expiresAt } : null,
    voices: house.voices().map((v) => ({ ...v, sample: sampleOf(v.id) })),
  };
}

async function start(c) {
  guard(c);
  if (pending) pending.ctrl.abort();
  const ctrl = new AbortController();
  const mine = { ctrl, userCode: null, url: null, expiresAt: null };
  pending = mine;
  let shown;
  const codeShown = new Promise((resolve) => { shown = resolve; });
  const base = house.baseUrl(); // the Worker this sign-in is with, kept beside the token
  // (c.signinWait: the tests' quicker wait between polls; the Worker's own pace otherwise)
  const run = house.signIn({ device: 'mac', base, signal: ctrl.signal, sleep: typeof c.signinWait === 'function' ? c.signinWait : undefined, onCode: (x) => {
    Object.assign(mine, { userCode: x.userCode, url: x.url, expiresAt: Date.now() + x.expiresIn * 1000 });
    shown();
  } });
  run.then((r) => {
    if (pending !== mine) return;
    pending = null;
    try {
      c.vault.set(house.TOKEN, r.token);
      writeAccount(c, { email: r.email || null, base, at: new Date().toISOString() });
    } catch (e) {
      // not kept (the Keychain unavailable): the Worker forgets it too, so no sign-in is left that this Mac can't use
      try { c.vault.remove(house.TOKEN); } catch { /* never kept */ }
      house.client({ base }).signOut(r.token).catch(() => null);
      tell(c, { signedIn: false, error: said(c, e) });
      return;
    }
    shareAs(c, true);
    tell(c, { signedIn: true, email: r.email || null });
  }, (e) => {
    if (pending === mine) pending = null;
    if (e && e.kind === 'stopped') return;
    tell(c, { signedIn: signedIn(c), error: said(c, e) });
  });
  // the code first (or why there's none), then its page in the browser: FLPT's own address, never one the server named
  await Promise.race([codeShown, run.catch(() => null)]);
  if (pending !== mine || !mine.url) { const e = await run.then(() => null, (x) => x); throw new Error(e ? said(c, e) : 'FLPT\'s sign-in isn\'t answering.'); }
  try { if (c.os && typeof c.os.openExternal === 'function') await c.os.openExternal(mine.url); } catch { /* the code is on screen either way */ }
  return status(c);
}

async function open(c) {
  guard(c);
  if (!pending || !pending.url) return { ok: false, error: 'No code is waiting.' };
  if (c.os && typeof c.os.openExternal === 'function') await c.os.openExternal(pending.url);
  return { ok: true };
}

function cancel(c) {
  guard(c);
  if (pending) { pending.ctrl.abort(); pending = null; }
  return status(c);
}

async function signOut(c) {
  guard(c);
  if (pending) { pending.ctrl.abort(); pending = null; }
  // the Worker that issued it forgets it (another one is never sent it); this Mac forgets it either way
  const token = tokenFor(c);
  if (token) { try { await house.client().signOut(token); } catch { /* offline: this Mac forgets it anyway */ } }
  c.vault.remove(house.TOKEN);
  writeAccount(c, null);
  shareAs(c, false);
  tell(c, { signedIn: false });
  return status(c);
}

async function usage(c) {
  guard(c);
  const token = tokenFor(c);
  if (!token) return { ok: false, error: 'Not signed in.' };
  try {
    const u = await house.client().usage(token);
    if (!u) return { ok: false, error: 'Not signed in.' };
    return { ok: true, videosUsed: u.videosUsed, videosPerMonth: u.videosPerMonth, charsPerVideo: u.charsPerVideo };
  } catch (e) {
    return { ok: false, error: said(c, e) };
  }
}

module.exports = {
  ns: 'signin',
  methods: {
    status: { args: [], handler: (c) => status(c) },
    start: { args: [], handler: (c) => start(c) },
    open: { args: [], handler: (c) => open(c) },
    cancel: { args: [], handler: (c) => cancel(c) },
    signOut: { args: [], handler: (c) => signOut(c) },
    usage: { args: [], handler: (c) => usage(c) },
  },
  events: ['signin:changed'],
  // for the tests and the QA
  _reset: () => { if (pending) pending.ctrl.abort(); pending = null; },
};
