'use strict';
// Free, read-only live tests for each key: list models, read a wallet or balance, or (for Higgsfield, which has no
// balance endpoint) ask for the status of a request that doesn't exist, where 401 means a bad key and anything
// else means the key was accepted. Nothing here can spend money. Results never contain the key.

const TIMEOUT_MS = 15000;

async function call(fetchImpl, url, headers) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { headers, signal: ctrl.signal });
    let body = null;
    try { body = await res.json(); } catch { /* not JSON */ }
    return { status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

const bad = (status) => ({ ok: false, detail: status === 401 || status === 403 ? 'The key was rejected.' : `Unexpected reply (HTTP ${status}).` });

const TESTS = {
  async ANTHROPIC_API_KEY(key, f) {
    const r = await call(f, 'https://api.anthropic.com/v1/models?limit=5', { 'x-api-key': key, 'anthropic-version': '2023-06-01' });
    if (r.status !== 200) return bad(r.status);
    return { ok: true, detail: 'Key accepted (model list read).' };
  },
  async HEYGEN_API_KEY(key, f) {
    const r = await call(f, 'https://api.heygen.com/v3/users/me', { 'x-api-key': key, accept: 'application/json' });
    if (r.status !== 200) return bad(r.status);
    const d = (r.body && (r.body.data || r.body)) || {};
    const w = d.wallet || {};
    const bal = w.remaining_balance != null ? `Wallet: ${w.remaining_balance} ${w.currency || ''}`.trim() : 'Account read.';
    return { ok: true, detail: bal };
  },
  async ELEVENLABS_API_KEY(key, f) {
    const r = await call(f, 'https://api.elevenlabs.io/v1/user/subscription', { 'xi-api-key': key });
    if (r.status !== 200) return bad(r.status);
    const b = r.body || {};
    const left = b.character_limit != null && b.character_count != null ? `${(b.character_limit - b.character_count).toLocaleString('en-US')} characters left` : 'Subscription read';
    return { ok: true, detail: `${left}${b.tier ? ` (${b.tier})` : ''}.` };
  },
  async KIE_API_KEY(key, f) {
    // GET /api/v1/chat/credit returns {code, msg, data: credits}. Documented by Kie's "Common API".
    const r = await call(f, 'https://api.kie.ai/api/v1/chat/credit', { Authorization: `Bearer ${key}`, Accept: 'application/json' });
    if (r.status !== 200 || (r.body && r.body.code && r.body.code !== 200)) return bad(r.body && r.body.code ? r.body.code : r.status);
    return { ok: true, detail: `Credits: ${r.body && r.body.data != null ? r.body.data : 'read'}.` };
  },
  async HIGGSFIELD_CREDENTIALS(key, f) {
    if (!/^[^:\s]+:[^:\s]+$/.test(key)) return { ok: false, detail: 'Higgsfield keys look like "key-id:key-secret".' };
    const r = await call(f, 'https://api.higgsfield.ai/requests/00000000-0000-0000-0000-000000000000/status', { Authorization: `Key ${key}` });
    if (r.status === 401 || r.status === 403) return bad(r.status);
    return { ok: true, detail: 'Key accepted. (Higgsfield has no balance call; check it in the console.)' };
  },
  async GEMINI_API_KEY(key, f) {
    const r = await call(f, 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { 'x-goog-api-key': key });
    return r.status === 200 ? { ok: true, detail: 'Key accepted (model list read).' } : bad(r.status);
  },
  async FISH_AUDIO_API_KEY(key, f) {
    // GET /wallet/self/api-credit → { credit: "12.34", … } (docs.fish.audio, "Get API Credit")
    const r = await call(f, 'https://api.fish.audio/wallet/self/api-credit', { Authorization: `Bearer ${key}`, accept: 'application/json' });
    if (r.status !== 200) return bad(r.status);
    const c = r.body && r.body.credit != null && Number.isFinite(Number(r.body.credit)) ? Number(r.body.credit) : null;
    return { ok: true, detail: c != null ? `API credit: ${c.toFixed(2)} US dollars.` : 'Key accepted.' };
  },
  async OPENAI_API_KEY(key, f) {
    const r = await call(f, 'https://api.openai.com/v1/models', { Authorization: `Bearer ${key}` });
    return r.status === 200 ? { ok: true, detail: 'Key accepted (model list read).' } : bad(r.status);
  },
};

async function testKey(name, key, fetchImpl = globalThis.fetch) {
  if (!key) return { ok: false, detail: 'No key saved.' };
  const t = TESTS[name];
  if (!t) return { ok: null, detail: 'Saved. There\'s no free test for this provider; it\'s checked on first use.' };
  try {
    return await t(key, fetchImpl);
  } catch (e) {
    return { ok: false, detail: e && e.name === 'AbortError' ? 'No reply in 15 s. Check your connection.' : 'Couldn\'t reach the service.' };
  }
}

module.exports = { testKey, hasFreeTest: (n) => Boolean(TESTS[n]) };
