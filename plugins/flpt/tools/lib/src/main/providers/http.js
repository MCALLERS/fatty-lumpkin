'use strict';
// Shared plumbing for the generation providers (kie.js, higgsfield.js). Main process only.
//   requestJson()   one HTTP call with a timeout. It never follows a redirect, so a key can't travel to another host.
//   withRetries()   repeats a READ (a status, a quote, an upload slot, a download) after a network error, a 429 or a
//                   5xx, with backoff. A paid request is never repeated here: each provider decides that itself.
//   pollUntilDone() polls a job's status with a growing interval until it ends (or a deadline passes).
//   downloadTo()    streams a result to a file with a size cap and no credentials attached.
// Errors are ProviderErrors: a plain message for the person, a kind for the code. Nothing here logs or returns a key.
const fs = require('fs');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

class ProviderError extends Error {
  /**
   * @param {string} message  plain words for the person
   * @param {object} o
   *   kind       auth | credits | rate | busy | invalid | notfound | limit | unavailable | server | network | timeout |
   *              ambiguous | failed | nokey | slow | download | unsupported | unexpected | stopped
   *   retryable  safe to repeat (a read, or a request the provider says it refused without starting)
   *   ambiguous  a paid request may or may not have been accepted
   */
  constructor(message, o = {}) {
    super(message);
    this.name = 'ProviderError';
    this.kind = o.kind || 'error';
    this.status = o.status == null ? null : o.status;
    this.retryable = Boolean(o.retryable);
    this.ambiguous = Boolean(o.ambiguous);
    this.provider = o.provider || '';
    if (o.replay) this.replay = o.replay; // Higgsfield: { endpoint, body, idempotencyKey }, safe to send again
  }
}

const stopped = () => new ProviderError('Stopped.', { kind: 'stopped' });

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) { reject(stopped()); return; }
    const onAbort = () => { clearTimeout(t); reject(stopped()); };
    const t = setTimeout(() => { if (signal) signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

const isLoopback = (host) => /^(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|\[::1\]|::1)$/i.test(String(host || ''));

/** A scrubber for text a provider sent back: the given secrets out, then the app's redactor, then a length cap. */
function scrubber(secrets, redact = (s) => s) {
  const list = secrets.filter((s) => typeof s === 'string' && s.length >= 6);
  return (text, max = 240) => {
    let s = String(text == null ? '' : text);
    for (const v of list) s = s.split(v).join('••••');
    s = redact(s).replace(/\s+/g, ' ').trim();
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  };
}

/**
 * One HTTP call. Resolves { status, json, text } for any HTTP reply (the caller reads codes); throws a ProviderError
 * of kind network, timeout or stopped when no reply came.
 */
async function requestJson(fetchImpl, url, { method = 'GET', headers = {}, body, timeoutMs = 30000, signal } = {}) {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  const onAbort = () => ctrl.abort();
  if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  const lost = () => {
    if (signal && signal.aborted && !timedOut) return stopped();
    return new ProviderError(timedOut ? 'No reply in time.' : 'No connection.', { kind: timedOut ? 'timeout' : 'network', retryable: true });
  };
  try {
    let res;
    try {
      res = await fetchImpl(url, { method, headers, body, signal: ctrl.signal, redirect: 'manual' });
    } catch {
      throw lost();
    }
    let text = '';
    try { text = await res.text(); } catch { throw lost(); }
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { status: res.status, json, text: text.slice(0, 4000) };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/** Repeat fn after a retryable ProviderError (2 s, 4 s, 8 s… capped), up to `attempts` tries in all. */
async function withRetries(fn, { attempts = 4, baseMs = 2000, maxMs = 15000, signal, sleep: wait = sleep } = {}) {
  for (let i = 1; ; i++) {
    try {
      return await fn(i);
    } catch (e) {
      if (!(e instanceof ProviderError) || !e.retryable || i >= attempts || (signal && signal.aborted)) throw e;
      await wait(Math.min(maxMs, baseMs * 2 ** (i - 1)), signal);
    }
  }
}

/**
 * Poll status(jobId) until the job is done or failed. onProgress gets each status plus `elapsed` (seconds). The
 * interval starts at intervalMs and grows to maxIntervalMs. Past timeoutMs it throws a retryable 'slow' error: the
 * job is still running at the provider, and the caller keeps it to check again later.
 */
async function pollUntilDone(status, jobId, { onProgress = () => {}, signal, timeoutMs = 60 * 60000, intervalMs = 3000, maxIntervalMs = 15000,
  sleep: wait = sleep, now = Date.now, name = 'The provider' } = {}) {
  const t0 = now();
  let delay = intervalMs;
  for (;;) {
    const st = await status(jobId, { signal });
    const elapsed = Math.max(0, (now() - t0) / 1000);
    try { onProgress({ ...st, elapsed }); } catch { /* a window went away */ }
    if (st.state === 'done' || st.state === 'failed') return { ...st, elapsed };
    if (now() - t0 >= timeoutMs) {
      throw new ProviderError(`Still rendering at ${name} after ${Math.round(timeoutMs / 60000)} minutes. FLPT will keep checking.`, { kind: 'slow', retryable: true });
    }
    await wait(delay, signal);
    delay = Math.min(maxIntervalMs, Math.round(delay * 1.5));
  }
}

/**
 * Stream a result file to `dest` (through dest.part, renamed when whole). No credentials are sent: result links are
 * public, signed URLs. Only https, except a loopback http address when allowLoopbackHttp (the QA stand-in).
 */
async function downloadTo(fetchImpl, url, dest, { maxBytes = 1 << 30, timeoutMs = 15 * 60000, signal, allowLoopbackHttp = false, provider = '' } = {}) {
  let u;
  try { u = new URL(String(url)); } catch { throw new ProviderError('The result link is broken.', { kind: 'unexpected', provider }); }
  const secure = u.protocol === 'https:' || (allowLoopbackHttp && u.protocol === 'http:' && isLoopback(u.hostname));
  if (!secure) throw new ProviderError('The result link isn\'t a secure (https) link, so FLPT didn\'t download it.', { kind: 'unexpected', provider });
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  const onAbort = () => ctrl.abort();
  if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  const part = `${dest}.part`;
  const lost = () => (signal && signal.aborted && !timedOut ? stopped()
    : new ProviderError(timedOut ? 'The download took too long.' : 'The download was interrupted.', { kind: timedOut ? 'timeout' : 'network', retryable: true, provider }));
  try {
    let res;
    try { res = await fetchImpl(u.href, { method: 'GET', signal: ctrl.signal, redirect: 'follow' }); } catch { throw lost(); }
    if (!res.ok) {
      const transient = res.status === 429 || res.status >= 500;
      throw new ProviderError(`The download failed (HTTP ${res.status}).`, { kind: transient ? 'server' : 'download', status: res.status, retryable: transient, provider });
    }
    const len = Number(res.headers.get('content-length'));
    if (len && len > maxBytes) throw new ProviderError('The result is bigger than FLPT expected, so it wasn\'t downloaded.', { kind: 'unexpected', provider });
    if (!res.body) throw new ProviderError('The download was empty.', { kind: 'network', retryable: true, provider });
    let bytes = 0;
    const cap = new Transform({
      transform(chunk, _enc, cb) {
        bytes += chunk.length;
        if (bytes > maxBytes) cb(new ProviderError('The result is bigger than FLPT expected, so it wasn\'t downloaded.', { kind: 'unexpected', provider }));
        else cb(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(res.body), cap, fs.createWriteStream(part, { mode: 0o600 }));
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw lost();
    }
    if (!bytes) throw new ProviderError('The download was empty.', { kind: 'network', retryable: true, provider });
    fs.renameSync(part, dest);
    return { path: dest, bytes, type: String(res.headers.get('content-type') || '') };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
    fs.rmSync(part, { force: true });
  }
}

/** The picture types both providers take as input, by extension. */
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

module.exports = { ProviderError, sleep, isLoopback, scrubber, requestJson, withRetries, pollUntilDone, downloadTo, IMAGE_TYPES };
