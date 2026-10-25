'use strict';
// Kie.ai: one key (Authorization: Bearer), one credit balance for every model, and one task API for all of them
// (docs.kie.ai; the findings and links are in docs/research/generation-apis.md):
//   POST /api/v1/jobs/createTask {model, input}   → {code: 200, data: {taskId}}
//   GET  /api/v1/jobs/recordInfo?taskId=…         → data.state waiting|queuing|generating|success|fail, data.progress,
//                                                    data.resultJson '{"resultUrls":[…]}', data.creditsConsumed
//   POST /api/v1/common/download-url {url}        → a fresh download link for a result (free)
//   GET  /api/v1/chat/credit                      → the balance in credits (free)
//   POST https://kieai.redpandaai.co/api/file-stream-upload (multipart) → data.downloadUrl, kept 24 h (free)
// Errors usually arrive as HTTP 200 with another `code` in the body: 401 key, 402 credits, 429 rate (refused, not
// queued), 422 parameters, 455 maintenance, 500 server, 501 generation failed, 505 model switched off.
// Kie.ai has no idempotency key, so a create that may have reached it is never sent again: only a 429, which Kie.ai
// documents as refused without queueing, is repeated. Prices: 1 credit = 0.005 US dollars (see RATES in broker.js).
const fs = require('fs');
const path = require('path');
const { ProviderError, sleep: realSleep, isLoopback, scrubber, requestJson, withRetries, pollUntilDone, downloadTo, IMAGE_TYPES } = require('./http');

const ID = 'kie';
const NAME = 'Kie.ai';
const BASE = 'https://api.kie.ai';
const UPLOAD_BASE = 'https://kieai.redpandaai.co';
const USD_PER_CREDIT = 0.005;
const MODELS = { video: 'bytedance/seedance-2-5', upgrade: 'bytedance/seedance-2-5-draft', still: 'nano-banana-pro', cutout: 'recraft/remove-background' };
const MODEL_NAMES = { video: 'Seedance 2.5', still: 'Nano Banana Pro', cutout: 'Recraft background removal' };
const RESOLUTIONS = ['480p', '720p', '1080p'];
const ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];
const STATES = { waiting: 'queued', queuing: 'queued', generating: 'running', success: 'done', fail: 'failed' };

const round = (n, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * @param {object} o
 * @param {string} o.key           the user's Kie.ai key (from the vault; never logged, sent only in the header)
 * @param {Function} [o.fetch]     fetch (tests pass a stand-in)
 * @param {string} [o.base]        API origin (the QA stand-in overrides it; see providers/index.js)
 * @param {string} [o.uploadBase]  upload origin
 * @param {Function} [o.redact]    the app's redactor, for anything Kie.ai sends back
 * @param {Function} [o.sleep]     waits between polls and retries (tests make it instant)
 * @param {object} [o.timeouts]    { request, create, upload } in ms
 */
function createKie({ key, fetch: fetchImpl = globalThis.fetch, base = BASE, uploadBase = UPLOAD_BASE, redact = (s) => s, sleep = realSleep,
  now = Date.now, timeouts = {} } = {}) {
  if (!key) throw new ProviderError(`Add a ${NAME} key in Setup → Keys`, { kind: 'nokey', provider: ID });
  const t = { request: 30000, create: 60000, upload: 120000, ...timeouts };
  const scrub = scrubber([key], redact);
  const auth = { Authorization: `Bearer ${key}`, Accept: 'application/json' };
  const loopback = isLoopback(new URL(base).hostname);
  const fail = (message, o = {}) => new ProviderError(message, { provider: ID, ...o });
  const codeOf = (r) => { const c = r.json && Number(r.json.code); return Number.isFinite(c) && c ? c : r.status; };

  function failure(code, msg) {
    const m = scrub(msg);
    if (code === 401 || code === 403) return fail(`${NAME} didn't accept the key. Check it in Setup → Keys.`, { kind: 'auth', status: code });
    if (code === 402) return fail(`Not enough ${NAME} credits for this. Top up at kie.ai, then try again.`, { kind: 'credits', status: code });
    if (code === 429) return fail(`${NAME} is busy right now. Try again in a minute.`, { kind: 'rate', status: code, retryable: true });
    if (code === 455) return fail(`${NAME} is down for maintenance. Try again later.`, { kind: 'unavailable', status: code, retryable: true });
    if (code === 505) return fail(`${NAME} has switched this model off for now.`, { kind: 'unavailable', status: code });
    if (code === 433) return fail(`${NAME} refused: ${m || 'this key reached one of its usage limits'}.`, { kind: 'limit', status: code });
    if (code === 404) return fail(`${NAME} doesn't know that job.`, { kind: 'notfound', status: code });
    if (code === 400 || code === 422) return fail(`${NAME} didn't accept the request${m ? `: ${m}` : '.'}`, { kind: 'invalid', status: code });
    if (code >= 500) return fail(`${NAME} had a problem (${code}). Try again later.`, { kind: 'server', status: code, retryable: true });
    return fail(`${NAME} sent an unexpected reply (${code}).`, { kind: 'unexpected', status: code });
  }

  /** A read (free, changes nothing): repeated after a network error, a 429 or a server error. Returns data. */
  function read(url, { signal, method = 'GET', body } = {}) {
    return withRetries(async () => {
      const r = await requestJson(fetchImpl, url, { method, headers: body ? { ...auth, 'Content-Type': 'application/json' } : auth, body, signal, timeoutMs: t.request });
      const code = codeOf(r);
      if (r.status !== 200 || code !== 200) throw failure(code === 200 ? r.status : code, r.json && r.json.msg);
      return r.json.data;
    }, { signal, sleep });
  }

  /**
   * Start a task. Paid, so it's sent once: the only repeat is after a 429, which Kie.ai documents as refused and
   * never queued. A lost reply, a gateway error, or a success with no task id may mean Kie.ai started (and will
   * bill) the job: that is reported as ambiguous, and never sent again.
   */
  async function create(model, input, { signal } = {}) {
    const body = JSON.stringify({ model, input });
    for (let attempt = 1; ; attempt++) {
      let r;
      try {
        r = await requestJson(fetchImpl, `${base}/api/v1/jobs/createTask`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body, signal, timeoutMs: t.create });
      } catch {
        throw fail(`Lost touch with ${NAME} while starting the job, so it may or may not be running. Check kie.ai/logs before trying again.`, { kind: 'ambiguous', ambiguous: true });
      }
      const code = codeOf(r);
      const taskId = r.json && r.json.data && typeof r.json.data.taskId === 'string' ? r.json.data.taskId.trim() : '';
      if (r.status === 200 && code === 200 && taskId) return { jobId: taskId, model };
      const kieBody = Boolean(r.json && Number(r.json.code));
      if (code === 200 || (!kieBody && (r.status >= 500 || (r.status >= 300 && r.status < 400)))) {
        throw fail(`${NAME} didn't confirm the job, so it may or may not be running. Check kie.ai/logs before trying again.`, { kind: 'ambiguous', ambiguous: true, status: r.status });
      }
      const f = failure(code, r.json && r.json.msg);
      if (f.kind === 'rate' && attempt < 3) { await sleep(5000 * attempt, signal); continue; }
      f.retryable = false; // a refused start is reported, not repeated
      throw f;
    }
  }

  /** The job as FLPT sees it: { state: queued|running|done|failed, progress 0–1, urls, credits, costUsd, error }. */
  async function status(jobId, { signal } = {}) {
    const d = await read(`${base}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(jobId)}`, { signal });
    if (!d || typeof d !== 'object') throw fail(`${NAME} sent an unexpected reply.`, { kind: 'unexpected', retryable: true });
    const state = STATES[d.state] || 'queued';
    const c = d.creditsConsumed;
    const credits = c === null || c === undefined || c === '' || !Number.isFinite(Number(c)) ? null : Number(c);
    const p = Number(d.progress);
    const out = { state, providerState: String(d.state || ''), progress: d.progress != null && Number.isFinite(p) ? Math.max(0, Math.min(1, p / 100)) : null,
      credits, costUsd: credits == null ? null : round(credits * USD_PER_CREDIT), urls: [], lastFrame: null, error: null };
    if (state === 'done') {
      let res = d.response && typeof d.response === 'object' ? d.response : null;
      if (!res) { try { res = JSON.parse(d.resultJson || '{}'); } catch { res = {}; } }
      out.urls = (Array.isArray(res.resultUrls) ? res.resultUrls : []).filter((u) => typeof u === 'string' && u);
      const lf = Array.isArray(res.lastFrameUrl) ? res.lastFrameUrl[0] : res.lastFrameUrl;
      out.lastFrame = typeof lf === 'string' && lf ? lf : null;
      if (!out.urls.length) { out.state = 'failed'; out.error = `${NAME} finished the job but sent no file.`; }
    }
    if (state === 'failed') out.error = `${NAME} couldn't make it${d.failMsg ? `: ${scrub(d.failMsg)}` : '.'}`;
    return out;
  }

  function wait(jobId, o = {}) { return pollUntilDone(status, jobId, { sleep, now, name: NAME, ...o }); }

  /** A result to a file. A link that has gone stale gets one fresh link from Kie.ai (free), then one more try. */
  async function download(url, dest, { signal, maxBytes } = {}) {
    const get = (u) => withRetries(() => downloadTo(fetchImpl, u, dest, { signal, maxBytes, allowLoopbackHttp: loopback, provider: ID }), { signal, sleep });
    try {
      return await get(url);
    } catch (e) {
      if (e.kind !== 'download') throw e;
      const fresh = await read(`${base}/api/v1/common/download-url`, { signal, method: 'POST', body: JSON.stringify({ url }) });
      if (typeof fresh !== 'string' || !fresh) throw e;
      return get(fresh);
    }
  }

  /** A local picture (png, jpg, webp; at most 30 MB) to a public link Kie.ai models can read for 24 hours. Free. */
  async function upload(file, { signal } = {}) {
    const type = IMAGE_TYPES[path.extname(String(file)).toLowerCase()];
    if (!type) throw fail(`${NAME} takes PNG, JPEG or WebP pictures.`, { kind: 'invalid' });
    const buf = fs.readFileSync(file);
    if (buf.length > 30 << 20) throw fail('That picture is over 30 MB.', { kind: 'invalid' });
    const name = path.basename(String(file)).replace(/[^\w.-]+/g, '-').slice(-80);
    const form = new FormData();
    form.append('file', new Blob([buf], { type }), name);
    form.append('uploadPath', 'flpt');
    form.append('fileName', name);
    // An upload starts nothing billable, so a failed one can simply be tried again.
    const data = await withRetries(async () => {
      const r = await requestJson(fetchImpl, `${uploadBase}/api/file-stream-upload`, { method: 'POST', headers: auth, body: form, signal, timeoutMs: t.upload });
      const code = codeOf(r);
      const link = r.json && r.json.data && r.json.data.downloadUrl;
      if (r.status !== 200 || code !== 200 || typeof link !== 'string') throw failure(code === 200 ? 500 : code, r.json && r.json.msg);
      return r.json.data;
    }, { signal, sleep });
    return data.downloadUrl;
  }

  // ── jobs ──
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  const seconds = (v) => Math.max(4, Math.min(30, Math.round(Number(v) || 5)));

  /**
   * The createTask body for a Seedance 2.5 shot: text to video, or from a start frame (and maybe an end frame).
   * draft: a 480p draft that upgrade() can later finish at 1080p as the same take (Kie.ai keeps a draft 7 days).
   * lastFrame: also return the shot's last frame (a JPEG), to start the next shot of a cut scene from it.
   */
  function videoInput({ prompt, startImageUrl = null, endImageUrl = null, duration = 5, resolution = '720p', aspect = '16:9', audio = true, draft = false, lastFrame = false } = {}) {
    if (endImageUrl && !startImageUrl) throw fail('An end frame needs a start frame too.', { kind: 'invalid' });
    const input = { prompt: String(prompt || '').slice(0, 20000), resolution: draft ? '480p' : pick(resolution, RESOLUTIONS, '720p'), aspect_ratio: pick(aspect, ASPECTS, '16:9'),
      duration: seconds(duration), generate_audio: audio !== false, output_format: 'mp4' };
    if (startImageUrl) input.first_frame_url = String(startImageUrl);
    if (endImageUrl) input.last_frame_url = String(endImageUrl);
    if (draft) input.draft = true;
    if (lastFrame) input.return_last_frame = true;
    return input;
  }

  return {
    id: ID, name: NAME, models: MODEL_NAMES, modelIds: MODELS,
    /** A Seedance 2.5 shot. Returns { jobId }. */
    video: async (params, o) => create(MODELS.video, videoInput(params), o),
    videoInput,
    /** Finish a 480p draft (video({ draft: true })) at 1080p: the same take, billed at the 1080p rate. */
    upgrade: async ({ draftJobId, lastFrame = false } = {}, o) => create(MODELS.upgrade, { draft_task_id: String(draftJobId || ''), resolution: '1080p', output_format: 'mp4',
      ...(lastFrame ? { return_last_frame: true } : {}) }, o),
    /** A Nano Banana Pro still (references: up to 8 public picture links, e.g. a locked style frame). */
    still: async ({ prompt, references = [], aspect = '16:9', resolution = '2K', format = 'png' } = {}, o) => create(MODELS.still, {
      prompt: String(prompt || '').slice(0, 20000), image_input: references.slice(0, 8), aspect_ratio: aspect,
      resolution: pick(resolution, ['1K', '2K', '4K'], '2K'), output_format: format === 'jpg' ? 'jpg' : 'png' }, o),
    /** A cut-out: the picture with its background removed (Recraft; at most 5 MB, 4096 px). */
    cutout: async ({ imageUrl } = {}, o) => create(MODELS.cutout, { image: String(imageUrl || '') }, o),
    status, wait, download, upload,
    /** The balance, in credits (free). */
    credits: async ({ signal } = {}) => Number(await read(`${base}/api/v1/chat/credit`, { signal })),
  };
}

module.exports = { createKie, ID, NAME, BASE, UPLOAD_BASE, USD_PER_CREDIT, MODELS, MODEL_NAMES };
