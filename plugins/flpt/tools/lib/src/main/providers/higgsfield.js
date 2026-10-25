'use strict';
// Higgsfield's public API (docs.higgsfield.ai; findings and links in docs/research/generation-apis.md). It is billed
// from its own prepaid US-dollar balance, separate from the higgsfield.ai plan credits the method's connector uses.
//   POST /<endpoint>                    → {status: 'queued', request_id, status_url, cancel_url}
//        with Idempotency-Key: the same request with the same key returns the original request and never starts
//        (or bills) a second one, so a lost reply can be asked again safely
//   GET  /requests/{id}/status          → queued | in_progress | completed (video.url / images[].url) | failed | nsfw | canceled
//   POST /requests/{id}/cancel          → 202 while still queued (refunded), else 400
//   POST /estimate/<endpoint> (same body) → {credits, usd}: the authoritative price for this account, free
//   POST /files/generate-upload-url {content_type} → {upload_url, upload_headers, public_url}, then PUT the bytes
// Auth: Authorization: Key <key-id>:<key-secret>. Errors: 400 (bad input, or the concurrency limit), 401 key,
// 403 not enough balance, 404 model or request not on this account, 422 validation, 423/503 model unavailable, 5xx.
// Failed and nsfw requests are not charged. The status reply carries no cost: the estimate is the price.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ProviderError, sleep: realSleep, isLoopback, scrubber, requestJson, withRetries, pollUntilDone, downloadTo, IMAGE_TYPES } = require('./http');

const ID = 'higgsfield';
const NAME = 'Higgsfield';
const BASE = 'https://api.higgsfield.ai';
const ENDPOINTS = {
  textToVideo: 'bytedance/seedance-2.5/text-to-video',
  imageToVideo: 'bytedance/seedance-2.5/image-to-video',
  // Nano Banana Pro isn't on Higgsfield's public API (2026-10-13). Grok Imagine Image 2.0 takes up to ten reference
  // pictures (a locked style frame, a character), at 2K: the nearest match for the method's stills.
  still: 'xai/grok-imagine-image-2.0',
};
const MODEL_NAMES = { video: 'Seedance 2.5', still: 'Grok Imagine Image 2.0' };
const RESOLUTIONS = ['480p', '720p', '1080p'];
const ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];
const STATES = { queued: 'queued', in_progress: 'running', completed: 'done', failed: 'failed', nsfw: 'failed', canceled: 'failed', cancelled: 'failed' };

/**
 * @param {object} o
 * @param {string} o.credentials   "key-id:key-secret" from the vault (sent only in the Authorization header)
 * @param {Function} [o.fetch]     fetch (tests pass a stand-in)
 * @param {string} [o.base]        API origin (the QA stand-in overrides it; see providers/index.js)
 * @param {Function} [o.redact]    the app's redactor, for anything Higgsfield sends back
 * @param {Function} [o.sleep]     waits between polls and retries (tests make it instant)
 * @param {Function} [o.newKey]    makes an Idempotency-Key (a UUID)
 */
function createHiggsfield({ credentials, fetch: fetchImpl = globalThis.fetch, base = BASE, redact = (s) => s, sleep = realSleep, now = Date.now,
  newKey = () => crypto.randomUUID(), timeouts = {} } = {}) {
  if (!credentials) throw new ProviderError(`Add a ${NAME} key in Setup → Keys`, { kind: 'nokey', provider: ID });
  if (!/^[^:\s]+:[^:\s]+$/.test(credentials)) throw new ProviderError(`${NAME} keys look like "key-id:key-secret". Check it in Setup → Keys.`, { kind: 'auth', provider: ID });
  const t = { request: 30000, create: 60000, upload: 120000, ...timeouts };
  const secret = credentials.slice(credentials.indexOf(':') + 1);
  const scrub = scrubber([credentials, secret], redact);
  const auth = { Authorization: `Key ${credentials}`, Accept: 'application/json' };
  const loopback = isLoopback(new URL(base).hostname);
  const fail = (message, o = {}) => new ProviderError(message, { provider: ID, ...o });
  const detailOf = (j) => {
    const d = j && j.detail;
    if (Array.isArray(d)) return d.map((x) => (x && typeof x === 'object' ? x.msg || '' : String(x))).filter(Boolean).join('; ');
    return typeof d === 'string' ? d : '';
  };

  function failure(status, detail, phase = 'read') {
    const m = scrub(detail);
    if (status === 400 && /concurren/i.test(detail || '')) {
      return fail(`${NAME} is already running as many jobs as your account allows. Try again when one finishes.`, { kind: 'busy', status, retryable: phase !== 'create' });
    }
    if (status === 401) return fail(`${NAME} didn't accept the key. Check it in Setup → Keys.`, { kind: 'auth', status });
    if (status === 402 || status === 403) return fail(`Not enough ${NAME} API balance for this. Top it up at console.higgsfield.ai, then try again.`, { kind: 'credits', status });
    if (status === 404) {
      return phase === 'create' ? fail(`Seedance 2.5 isn't available on this ${NAME} account.`, { kind: 'notfound', status })
        : fail(`${NAME} doesn't know that job.`, { kind: 'notfound', status });
    }
    if (status === 423 || status === 503) return fail(`That model is unavailable on ${NAME} right now. Try again later.`, { kind: 'unavailable', status, retryable: phase !== 'create' });
    if (status === 429) return fail(`${NAME} is busy right now. Try again in a minute.`, { kind: 'rate', status, retryable: true });
    if (status === 400 || status === 422) return fail(`${NAME} didn't accept the request${m ? `: ${m}` : '.'}`, { kind: 'invalid', status });
    if (status >= 500) return fail(`${NAME} had a problem (HTTP ${status}). Try again later.`, { kind: 'server', status, retryable: true });
    return fail(`${NAME} sent an unexpected reply (HTTP ${status}).`, { kind: 'unexpected', status });
  }

  /** A free call that changes nothing (status, estimate, upload slot): repeated after network errors, 429s and 5xx. */
  function read(url, { signal, method = 'GET', body } = {}) {
    return withRetries(async () => {
      const r = await requestJson(fetchImpl, url, { method, headers: body ? { ...auth, 'Content-Type': 'application/json' } : auth, body, signal, timeoutMs: t.request });
      if (r.status < 200 || r.status >= 300) throw failure(r.status, detailOf(r.json));
      return r.json || {};
    }, { signal, sleep });
  }

  /**
   * Start a generation. Paid. Every attempt carries the same Idempotency-Key, which Higgsfield documents as safe to
   * resend: a repeat returns the original request and never starts (or bills) another. So a lost reply, a 429 or a
   * 5xx is retried twice; if it's still unconfirmed, the error carries `replay` so FLPT can ask again later.
   */
  async function create(endpoint, body, { signal, idempotencyKey = newKey() } = {}) {
    const payload = JSON.stringify(body);
    const replay = { endpoint, body, idempotencyKey };
    for (let attempt = 1; ; attempt++) {
      let r = null;
      try {
        r = await requestJson(fetchImpl, `${base}/${endpoint}`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
          body: payload, signal, timeoutMs: t.create });
      } catch (e) {
        if (e.kind === 'stopped') throw fail(`${NAME} may have started the job. FLPT will check with the same request, which can't start a second one.`, { kind: 'ambiguous', ambiguous: true, replay });
      }
      // A FastAPI answer from a 5xx other than 500 (503: the model is disabled or not ready) is a refusal. No answer,
      // a 500 or a gateway's 5xx may hide an accepted job: ask again, with the same key.
      const refused = r && r.status > 500 && r.json && r.json.detail;
      const unsure = !r || r.status === 429 || (r.status >= 500 && !refused);
      if (unsure && attempt < 3) { await sleep(3000 * attempt, signal); continue; }
      if (!r || (r.status >= 500 && !refused)) {
        throw fail(`Couldn't confirm that ${NAME} started the job. FLPT will check again with the same request, which can't start a second one.`, { kind: 'ambiguous', ambiguous: true, replay, status: r ? r.status : null });
      }
      if (r.status >= 200 && r.status < 300 && r.json && r.json.request_id) return { jobId: String(r.json.request_id), idempotencyKey, endpoint };
      if (r.status >= 200 && r.status < 300) throw fail(`${NAME} didn't confirm the job. FLPT will check again with the same request.`, { kind: 'ambiguous', ambiguous: true, replay });
      const f = failure(r.status, detailOf(r.json), 'create');
      f.retryable = false; // refused before it started: reported, not repeated
      throw f;
    }
  }

  /** The job as FLPT sees it: { state: queued|running|done|failed, urls, error }. No cost: the estimate is the price. */
  async function status(jobId, { signal } = {}) {
    const j = await read(`${base}/requests/${encodeURIComponent(jobId)}/status`, { signal });
    const raw = String(j.status || '');
    const state = STATES[raw] || 'queued';
    const out = { state, providerState: raw, progress: null, credits: null, costUsd: state === 'failed' ? 0 : null, urls: [], lastFrame: null, error: null };
    if (state === 'done') {
      const urls = [];
      if (j.video && typeof j.video.url === 'string') urls.push(j.video.url);
      for (const im of Array.isArray(j.images) ? j.images : []) if (im && typeof im.url === 'string') urls.push(im.url);
      out.urls = urls;
      if (!urls.length) { out.state = 'failed'; out.costUsd = null; out.error = `${NAME} finished the job but sent no file.`; }
    }
    if (raw === 'nsfw') out.error = `${NAME}'s content filter turned this down (nothing was charged). Try other words.`;
    else if (raw === 'canceled' || raw === 'cancelled') out.error = 'The job was cancelled before it started (refunded).';
    else if (raw === 'failed') out.error = `${NAME} couldn't make it (nothing was charged)${j.error ? `: ${scrub(j.error)}` : '.'}`;
    return out;
  }

  function wait(jobId, o = {}) { return pollUntilDone(status, jobId, { sleep, now, name: NAME, ...o }); }

  /** Higgsfield's own quote for a request (free): { usd, credits }. */
  async function estimate(endpoint, body, { signal } = {}) {
    const j = await read(`${base}/estimate/${endpoint}`, { signal, method: 'POST', body: JSON.stringify(body) });
    const usd = Number.parseFloat(j.usd);
    const credits = Number.parseFloat(j.credits);
    if (!Number.isFinite(usd) || usd < 0) throw fail(`${NAME} sent a quote FLPT couldn't read.`, { kind: 'unexpected' });
    return { usd, credits: Number.isFinite(credits) ? credits : null };
  }

  /** Cancel a job that hasn't started (refunded). Returns false once it has. */
  async function cancel(jobId, { signal } = {}) {
    const r = await requestJson(fetchImpl, `${base}/requests/${encodeURIComponent(jobId)}/cancel`, { method: 'POST', headers: auth, signal, timeoutMs: t.request });
    return r.status >= 200 && r.status < 300;
  }

  /** A result to a file (result links are public; no credentials go with the download). */
  function download(url, dest, { signal, maxBytes } = {}) {
    return withRetries(() => downloadTo(fetchImpl, url, dest, { signal, maxBytes, allowLoopbackHttp: loopback, provider: ID }), { signal, sleep });
  }

  /** A local picture to a public link Higgsfield models can read: a presigned PUT (the credentials never go there). */
  async function upload(file, { signal } = {}) {
    const type = IMAGE_TYPES[path.extname(String(file)).toLowerCase()];
    if (!type) throw fail(`${NAME} takes PNG, JPEG or WebP pictures.`, { kind: 'invalid' });
    const buf = fs.readFileSync(file);
    const slot = await read(`${base}/files/generate-upload-url`, { signal, method: 'POST', body: JSON.stringify({ content_type: type }) });
    let put;
    try { put = new URL(String(slot.upload_url)); } catch { throw fail(`${NAME} sent an upload link FLPT couldn't use.`, { kind: 'unexpected' }); }
    if (put.protocol !== 'https:' && !(loopback && isLoopback(put.hostname))) throw fail(`${NAME} sent an upload link that isn't secure.`, { kind: 'unexpected' });
    const headers = {};
    for (const [k, v] of Object.entries(slot.upload_headers && typeof slot.upload_headers === 'object' ? slot.upload_headers : {})) {
      if (typeof v === 'string' && !/^authorization$/i.test(k)) headers[k] = v;
    }
    if (!Object.keys(headers).some((k) => /^content-type$/i.test(k))) headers['Content-Type'] = type;
    await withRetries(async () => {
      const r = await requestJson(fetchImpl, put.href, { method: 'PUT', headers, body: buf, signal, timeoutMs: t.upload });
      if (r.status < 200 || r.status >= 300) throw fail(`The upload to ${NAME} failed (HTTP ${r.status}).`, { kind: 'server', status: r.status, retryable: r.status >= 500 || r.status === 429 });
    }, { signal, sleep });
    if (typeof slot.public_url !== 'string' || !slot.public_url) throw fail(`${NAME} sent no link for the upload.`, { kind: 'unexpected' });
    return slot.public_url;
  }

  // ── jobs ──
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  const seconds = (v) => Math.max(4, Math.min(30, Math.round(Number(v) || 5)));

  /** { endpoint, body } for a Seedance 2.5 shot: text to video, or image to video from a start (and end) frame. */
  function videoRequest({ prompt, startImageUrl = null, endImageUrl = null, duration = 5, resolution = '720p', aspect = '16:9', audio = true } = {}) {
    if (endImageUrl && !startImageUrl) throw fail('An end frame needs a start frame too.', { kind: 'invalid' });
    const common = { duration: seconds(duration), resolution: pick(resolution, RESOLUTIONS, '720p'), generate_audio: audio !== false };
    if (startImageUrl) {
      // Image to video has no aspect ratio: the framing follows the start frame.
      const body = { image_url: String(startImageUrl), ...common };
      if (prompt) body.prompt = String(prompt);
      if (endImageUrl) body.end_image_url = String(endImageUrl);
      return { endpoint: ENDPOINTS.imageToVideo, body };
    }
    return { endpoint: ENDPOINTS.textToVideo, body: { prompt: String(prompt || ''), aspect_ratio: pick(aspect, ASPECTS, '16:9'), ...common } };
  }

  function stillRequest({ prompt, references = [], aspect = '16:9' } = {}) {
    const body = { prompt: String(prompt || ''), resolution: '2k', aspect_ratio: pick(aspect, ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3'], '16:9'), quality: 'medium' };
    if (references.length) body.image_urls = references.slice(0, 10);
    return { endpoint: ENDPOINTS.still, body };
  }

  return {
    id: ID, name: NAME, models: MODEL_NAMES, endpoints: ENDPOINTS,
    /** A Seedance 2.5 shot. Returns { jobId, idempotencyKey, endpoint }. */
    video: async (params, o) => { const q = videoRequest(params); return create(q.endpoint, q.body, o); },
    videoRequest,
    /** A Grok Imagine Image 2.0 still (references: up to 10 public picture links, e.g. a locked style frame). */
    still: async (params, o) => { const q = stillRequest(params); return create(q.endpoint, q.body, o); },
    stillRequest,
    cutout: async () => { throw fail(`${NAME}'s API has no background removal. FLPT uses Kie.ai for cut-outs.`, { kind: 'unsupported' }); },
    /** Ask again about a start that wasn't confirmed: the same request and key, so it can't start a second job. */
    replay: (r, o = {}) => create(r.endpoint, r.body, { ...o, idempotencyKey: r.idempotencyKey }),
    quoteVideo: async (params, o) => { const q = videoRequest(params); return estimate(q.endpoint, q.body, o); },
    quoteStill: async (params, o) => { const q = stillRequest(params); return estimate(q.endpoint, q.body, o); },
    status, wait, download, upload, cancel, estimate,
  };
}

module.exports = { createHiggsfield, ID, NAME, BASE, ENDPOINTS, MODEL_NAMES };
