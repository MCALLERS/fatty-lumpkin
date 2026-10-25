'use strict';
// The FLPT voices (decisions.md, "FLPT voices"; W4-10): Michael's Fish.audio house voices, free to every signed-in FLPT
// user and made by FLPT's own Worker (web/worker/routes/voices.js), so his Fish key never leaves it. This is the
// `fish-house` provider's client, for the Mac app's main process and the plugin's flpt-signin (Electron-free; the plugin
// has a copy in engine/tools/lib):
//   the sign-in   FLPT's device flow (web/worker/routes/device.js): start → a code and its page on FLPT's site, which
//                 the person opens and answers there (Access signs them in with their email) → poll → the token. The
//                 token is the person's for this device; FLPT keeps it in the Keychain vault (FLPT_VOICES_TOKEN) on the
//                 Mac and in the plugin's own folder, never in keys.env; it is sent to FLPT's Worker and nowhere else
//   usage         this month's free videos and each video's characters (GET /api/voices/usage)
//   sign out      the Worker forgets the token (POST /api/device/signout), then FLPT does
// The narration itself is the pipeline's (engine/tools/patches/42_guest_voice.py, FlptHouseTTS: POST /api/voices/fish
// with the token, a 44.1 kHz WAV back). The Worker is FLPT's own address only: https://flpt.bombadillo-ai.com, another
// host on FLPT's domain or a loopback `wrangler dev` named by FLPT_VOICES_URL, or in QA (FLPT_QA with a loopback
// FLPT_QA_API_BASE) the stand-in under /flpt, exactly as the pipeline picks it, so a sign-in and the voices it pays
// for always meet the same Worker. A token is kept with the Worker that issued it (its `base`) and sent only there.
// Nothing here logs or returns the token but to the caller that keeps it.
const guest = require('../guestvoice');
const { ProviderError, requestJson, isLoopback } = require('./http');

const ID = 'fish-house';
const NAME = 'FLPT voices';
const BASE = 'https://flpt.bombadillo-ai.com';
const TOKEN = guest.HOUSE_TOKEN; // the vault's name for the sign-in (FLPT_VOICES_TOKEN)
const TOKEN_RE = /^flv1\.u[0-9a-f]{31}\.[A-Za-z0-9_-]{43}$/;
const DEVICES = ['mac', 'plugin'];
// FLPT's own domain, or a loopback `wrangler dev` (the pipeline patch's FLPT_VOICES_HOSTS, the same rule)
const HOSTS = /^(?:https:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){1,4}bombadillo-ai\.com(?::\d{2,5})?|https:\/\/bombadillo-ai\.com(?::\d{2,5})?|http:\/\/(?:127\.0\.0\.1|localhost):\d{2,5})$/;
// QA's stand-in (FLPT_QA with a loopback FLPT_QA_API_BASE): FLPT's routes under /flpt on loopback, nothing else
const QA_BASE = /^http:\/\/127\.0\.0\.1:\d{2,5}\/flpt$/;
/** Is this a base FLPT talks to (its own Worker, or QA's stand-in)? A token goes nowhere else. */
const isFlpt = (base) => HOSTS.test(String(base || '')) || QA_BASE.test(String(base || ''));

/** FLPT's Worker for the FLPT voices: the default, FLPT_VOICES_URL when it is FLPT's own, the QA stand-in in QA. */
function baseUrl(env = process.env) {
  let base = BASE;
  const named = String(env.FLPT_VOICES_URL || '').trim().replace(/\/+$/, '');
  if (HOSTS.test(named)) base = named;
  const qa = String(env.FLPT_QA_API_BASE || '').trim().replace(/\/+$/, '');
  if (env.FLPT_QA && /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(qa)) base = `${qa}/flpt`;
  return base;
}

/**
 * The Worker the pipeline picks from a run's own environment (42_guest_voice.py's FLPT_VOICES_API): the default,
 * FLPT_VOICES_URL when it is FLPT's own, QA's stand-in whenever FLPT_QA_API_BASE is a loopback address (the Python
 * doesn't ask for FLPT_QA: pipeline.js passes that base to a paid run only in QA). pipeline.js's film checks that this
 * is the Worker whose sign-in it carries.
 */
const pipelineBase = (env = {}) => baseUrl({ ...env, FLPT_QA: '1' });

/** The host a person sees for where they sign in (the base without its scheme). */
const hostOf = (base) => { try { return new URL(base).host; } catch { return ''; } };

/** A page link that is the Worker's own /device page, with this code (never a link the server could choose). */
function pageUrl(base, code) {
  return `${base}/device?code=${encodeURIComponent(code)}`;
}

/** The six voices, as people see them (guestvoice.HOUSE: the same ids the Worker and the pipeline know). */
const voices = () => guest.HOUSE.map((v) => ({ id: v.id, name: v.name }));

function client({ fetch: fetchImpl = globalThis.fetch, base = baseUrl(), timeoutMs = 20000 } = {}) {
  if (!isFlpt(base)) throw new ProviderError('That isn\'t FLPT\'s address.', { kind: 'invalid', provider: ID });
  const fail = (message, o = {}) => new ProviderError(message, { provider: ID, ...o });
  const post = (p, body, headers = {}) => requestJson(fetchImpl, `${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), timeoutMs });

  return {
    base,
    host: hostOf(base),
    /** A new code: { deviceCode, userCode, url (FLPT's own page for it), interval (s), expiresIn (s) }. */
    async start(device = 'mac') {
      const r = await post('/api/device/start', { device: DEVICES.includes(device) ? device : 'mac' });
      const j = r.json || {};
      if (r.status === 429) throw fail('Too many sign-ins from here just now.', { kind: 'rate', status: 429 });
      if (r.status !== 200 || !/^[A-Za-z0-9_-]{43}$/.test(String(j.device_code || '')) || !/^[A-Z]{4}-[A-Z]{4}$/.test(String(j.user_code || ''))) {
        throw fail('FLPT\'s sign-in isn\'t answering.', { kind: r.status >= 500 ? 'server' : 'unexpected', status: r.status });
      }
      const interval = Math.min(60, Math.max(1, Number(j.interval) || 5));
      const expiresIn = Math.min(1800, Math.max(30, Number(j.expires_in) || 600));
      return { deviceCode: j.device_code, userCode: j.user_code, url: pageUrl(base, j.user_code), interval, expiresIn };
    },
    /**
     * One poll: { state: 'pending' | 'slow' | 'done' | 'denied' | 'expired', token?, email? }. A token is checked for
     * its shape before it is handed back.
     */
    async poll(deviceCode) {
      const r = await post('/api/device/poll', { device_code: deviceCode });
      const j = r.json || {};
      if (r.status === 200) {
        if (!TOKEN_RE.test(String(j.token || ''))) throw fail('FLPT\'s sign-in answered with something else.', { kind: 'unexpected', status: 200 });
        return { state: 'done', token: j.token, email: typeof j.email === 'string' ? j.email.slice(0, 254) : null };
      }
      if (r.status === 400) {
        if (j.error === 'authorization_pending') return { state: 'pending' };
        if (j.error === 'slow_down') return { state: 'slow' };
        if (j.error === 'access_denied') return { state: 'denied' };
        if (j.error === 'expired_token') return { state: 'expired' };
      }
      throw fail('FLPT\'s sign-in isn\'t answering.', { kind: r.status >= 500 ? 'server' : 'unexpected', status: r.status, retryable: r.status >= 500 });
    },
    /** This month's FLPT voices for the person: { month, videosUsed, videosPerMonth, charsPerVideo, videos, email }, or null signed out. */
    async usage(token) {
      const r = await requestJson(fetchImpl, `${base}/api/voices/usage`, { headers: { authorization: `Bearer ${token}` }, timeoutMs });
      if (r.status === 401) return null;
      if (r.status !== 200 || !r.json || !r.json.ok) throw fail('FLPT\'s voices aren\'t answering.', { kind: r.status >= 500 ? 'server' : 'unexpected', status: r.status });
      const j = r.json;
      const int = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
      return { month: String(j.month || ''), videosUsed: int(j.videosUsed), videosPerMonth: int(j.videosPerMonth), charsPerVideo: int(j.charsPerVideo),
        videos: (Array.isArray(j.videos) ? j.videos : []).slice(0, 50).map((v) => ({ chars: int(v && v.chars) })), email: typeof j.email === 'string' ? j.email.slice(0, 254) : null };
    },
    /** Sign this device out at the Worker (it forgets the token). True when it did, or the token was already gone. */
    async signOut(token) {
      const r = await post('/api/device/signout', {}, { authorization: `Bearer ${token}` });
      return r.status === 200 || r.status === 401;
    },
  };
}

/**
 * The whole sign-in: start, show the code (onCode({ userCode, url, host })), then poll at the server's pace until it
 * ends. → { token, email } or throws (denied, expired, stopped). `sleep(ms, signal)` and `now()` for the tests.
 */
async function signIn({ device = 'mac', onCode = () => {}, signal, fetch: fetchImpl, base, sleep, now = Date.now } = {}) {
  const c = client({ fetch: fetchImpl, base });
  const s = await c.start(device);
  onCode({ userCode: s.userCode, url: s.url, host: c.host, expiresIn: s.expiresIn });
  const wait = sleep || require('./http').sleep;
  const until = now() + s.expiresIn * 1000;
  let interval = s.interval;
  for (;;) {
    await wait(interval * 1000, signal);
    if (signal && signal.aborted) throw new ProviderError('Stopped.', { kind: 'stopped', provider: ID });
    if (now() > until) throw new ProviderError('The code ran out.', { kind: 'expired', provider: ID });
    let r;
    try { r = await c.poll(s.deviceCode); } catch (e) { if (e.retryable) { interval = Math.min(60, interval + 5); continue; } throw e; }
    if (r.state === 'done') return { token: r.token, email: r.email };
    if (r.state === 'slow') interval = Math.min(60, interval + 5);
    if (r.state === 'denied') throw new ProviderError('Not connected.', { kind: 'denied', provider: ID });
    if (r.state === 'expired') throw new ProviderError('The code ran out.', { kind: 'expired', provider: ID });
  }
}

// The vault's entry for the sign-in (vault.js KEYS): added once, so the Keychain vault can keep it. It isn't a key a
// person pastes: `signin: true` (Setup's Keys step leaves it out; ui-signin.js shows it as FLPT voices · Sign in).
const VAULT_ENTRY = Object.freeze({ label: 'FLPT voices', required: false, signin: true, help: 'Setup → FLPT voices' });
function registerVault(KEYS = require('../vault').KEYS) {
  if (!Object.prototype.hasOwnProperty.call(KEYS, TOKEN)) KEYS[TOKEN] = { ...VAULT_ENTRY };
  return KEYS;
}

module.exports = { ID, NAME, BASE, TOKEN, TOKEN_RE, HOSTS, DEVICES, baseUrl, pipelineBase, hostOf, isFlpt, pageUrl, voices, client, signIn, registerVault, isLoopback };
