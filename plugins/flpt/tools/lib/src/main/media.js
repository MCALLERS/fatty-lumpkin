'use strict';
// Media helpers for the Library and Clippy: probe a video (ffprobe), make thumbnails (sips for pictures, an ffmpeg
// frame for videos, Quick Look for documents), pull a WAV out of a clip, and snapshot a web page (headless Chrome).
// Tool paths come in explicitly (the toolchain's ffmpeg and Chrome), so nothing here guesses what's installed.
// Every command reads its input and writes only the output path it's given.
//
// capturePage() is the reference capture (references.js keeps what it makes and decides which addresses a page may
// reach): the pinned headless shell in Chrome's own sandbox, driven over the DevTools protocol on a pipe (no port, no
// puppeteer in this process), every connection through references.js's filtering proxy, a throwaway profile and an
// isolated context, muted, downloads denied, popups closed, dialogs dismissed, a hard stop. Motion
// first (an 8 s screencast during a slow scripted scroll → motion.mp4 + 12 keyframes, so entrance and scroll-driven
// animations are seen on the fresh page), then 4 stills at scroll 0, ⅓, ⅔ and 1. A challenge or an error status is
// recorded as blocked, once: nothing is clicked, solved, retried or spoofed (spike K8).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

const THUMB_MAX = 600;
const SIPS = '/usr/bin/sips';
const QLMANAGE = '/usr/bin/qlmanage';

function run(file, args, { timeout = 120000, env } = {}) {
  return new Promise((resolve) => {
    if (!file) { resolve({ code: 127, out: '', err: 'tool missing' }); return; }
    execFile(file, args, { timeout, env: env || process.env, maxBuffer: 8 << 20 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: String(stdout || ''), err: String(stderr || '') });
    });
  });
}

const nonEmpty = (p) => { try { return fs.statSync(p).size > 0; } catch { return false; } };
const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the DevTools protocol on a pipe (Chrome's --remote-debugging-pipe: JSON messages ending in NUL on fds 3 and 4) ──

/**
 * A minimal client: send(method, params, sessionId) → result (rejects on a protocol error, a closed pipe or after
 * `timeoutMs`), on(listener) for events ({ method, params, sessionId }). Messages are split on NUL bytes as they
 * arrive, so a chunk boundary inside a message (or inside a multi-byte character) is harmless.
 */
function createCdp(toChrome, fromChrome, { timeoutMs = 20000 } = {}) {
  let id = 0;
  let closed = null;
  const pending = new Map();
  const listeners = new Set();
  let parts = [];
  const handle = (msg) => {
    if (msg.id != null) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message || 'protocol error'}`));
      else p.resolve(msg.result || {});
      return;
    }
    for (const l of listeners) { try { l(msg); } catch { /* a listener's own problem */ } }
  };
  fromChrome.on('data', (chunk) => {
    let start = 0;
    for (let i = chunk.indexOf(0); i >= 0; i = chunk.indexOf(0, start)) {
      parts.push(chunk.subarray(start, i));
      const text = Buffer.concat(parts).toString('utf8');
      parts = [];
      start = i + 1;
      let msg = null;
      try { msg = JSON.parse(text); } catch { /* not a message */ }
      if (msg) handle(msg);
    }
    if (start < chunk.length) parts.push(chunk.subarray(start));
  });
  const close = (why) => {
    if (closed) return;
    closed = why || 'closed';
    for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error(`${p.method}: ${closed}`)); }
    pending.clear();
  };
  fromChrome.on('close', () => close('the browser went away'));
  fromChrome.on('error', () => close('the browser went away'));
  toChrome.on('error', () => close('the browser went away'));
  function send(method, params = {}, sessionId, ms = timeoutMs) {
    if (closed) return Promise.reject(new Error(`${method}: ${closed}`));
    const msg = { id: ++id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(msg.id); reject(new Error(`${method}: no answer in ${ms} ms`)); }, ms);
      pending.set(msg.id, { resolve, reject, timer, method });
      toChrome.write(`${JSON.stringify(msg)}\0`);
    });
  }
  return { send, on: (l) => { listeners.add(l); return () => listeners.delete(l); }, close, get closed() { return closed; } };
}

// ── reference capture ───────────────────────────────────────────────────────────────────────────────────────────

const CAPTURE = { w: 1920, h: 1080, fps: 30, keyframes: 12, stills: [0, 1 / 3, 2 / 3, 1], maxScroll: 30000 };
const CHALLENGE = /just a moment|attention required|access denied|verify you are human|are you a robot|captcha|checking your browser|request blocked|403 forbidden|429 too many/i;

/**
 * The browser's switches for a capture. Chrome keeps its own sandbox (never --no-sandbox), and every connection goes
 * through `proxy` (references.startCaptureProxy, which decides which addresses a page may reach): this Mac's loopback
 * isn't bypassed, the browser resolves no names itself (the proxy does), WebRTC sends no UDP outside the proxy, no QUIC.
 */
const FILTER_RE = /^http:\/\/127\.0\.0\.1:\d+$/;
function captureArgs(profile, { proxy } = {}) {
  if (!FILTER_RE.test(String(proxy || ''))) throw new Error('A capture needs its network filter.');
  return [
    `--proxy-server=${proxy}`, '--proxy-bypass-list=<-loopback>', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--disable-quic',
    '--headless', '--remote-debugging-pipe', `--user-data-dir=${profile}`, `--window-size=${CAPTURE.w},${CAPTURE.h}`,
    '--force-device-scale-factor=1', '--force-color-profile=srgb', '--hide-scrollbars', '--mute-audio', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--disable-notifications', '--disable-background-networking',
    '--disable-component-update', '--disable-default-apps', '--deny-permission-prompts', '--disable-breakpad', '--disable-crash-reporter',
    '--no-pings', '--password-store=basic', '--use-mock-keychain', '--metrics-recording-only', '--disable-client-side-phishing-detection',
    '--disable-field-trial-config', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-hang-monitor', '--disable-ipc-flooding-protection', '--disable-prompt-on-repost',
    '--enable-automation', '--disable-features=Translate,MediaRouter,OptimizationHints,AutofillServerCommunication',
    'about:blank',
  ];
}

// Page-side helpers (run with Runtime.evaluate in the page's main world: a page that tampers with them only spoils its
// own capture). The scroller is the window, or the largest scrollable element (pages with their own scroll box).
const FIND_SCROLLER = `(() => {
  const se = document.scrollingElement || document.documentElement;
  const winMax = Math.max(0, se.scrollHeight - innerHeight);
  if (winMax > 4) return { kind: 'window', max: winMax };
  let best = null, bestMax = 0;
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (!/(auto|scroll|overlay)/.test(cs.overflowY)) continue;
    const m = el.scrollHeight - el.clientHeight;
    if (m > bestMax && el.clientHeight > innerHeight * 0.5) { best = el; bestMax = m; }
  }
  if (best) { best.setAttribute('data-flpt-scroller', '1'); return { kind: 'element', max: bestMax }; }
  return { kind: 'none', max: 0 };
})()`;
const SCROLL_POS = `(() => { const el = document.querySelector('[data-flpt-scroller]'); return el ? el.scrollTop : (document.scrollingElement || document.documentElement).scrollTop; })()`;
const scrollTo = (y) => `(() => { const el = document.querySelector('[data-flpt-scroller]'); if (el) el.scrollTop = ${Number(y) || 0}; else window.scrollTo({ top: ${Number(y) || 0}, left: 0, behavior: 'instant' }); return el ? el.scrollTop : (document.scrollingElement || document.documentElement).scrollTop; })()`;
const PAGE_INFO = `(() => ({
  title: String(document.title || '').slice(0, 300),
  challengeFrames: [...document.querySelectorAll('iframe')].map((f) => f.src || '').filter((s) => /challenges\\.cloudflare\\.com|recaptcha|hcaptcha|turnstile|captcha/i.test(s)).length,
  cfMarkers: !!document.querySelector('#challenge-form, #cf-challenge-running, .cf-browser-verification, #challenge-stage, [name="cf-turnstile-response"]'),
  passwordFields: document.querySelectorAll('input[type=password]').length,
  textLength: (document.body && document.body.innerText || '').length,
}))()`;
const RAF_FPS = `new Promise((res) => { let n = 0; const t0 = performance.now(); const f = (t) => { n++; if (t - t0 < 1000) requestAnimationFrame(f); else res(Math.round((n * 1000) / (t - t0))); }; requestAnimationFrame(f); })`;
const WEBGL = `(() => { const c = document.createElement('canvas'); const gl = c.getContext('webgl2') || c.getContext('webgl'); if (!gl) return null;
  const ext = gl.getExtension('WEBGL_debug_renderer_info'); return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).slice(0, 200); })()`;
const TWO_RAF = 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))';
const FONTS = 'Promise.race([document.fonts && document.fonts.ready, new Promise((r) => setTimeout(r, 2000))]).then(() => 1)';

/** Why a loaded page is a block (a challenge or an error status), or null. */
function blockReasons({ status = null, headers = {}, info = {}, responded = true, finalUrl = null } = {}) {
  const h = Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [String(k).toLowerCase(), v]));
  const reasons = [];
  if (!responded) reasons.push('no response');
  if (status && status >= 400) reasons.push(`http ${status}`);
  if (h['cf-mitigated']) reasons.push(`cf-mitigated: ${String(h['cf-mitigated']).slice(0, 40)}`);
  if (h['x-flpt-refused']) reasons.push('refused: a private address'); // the capture's own network filter said no
  if (info.cfMarkers || info.challengeFrames) reasons.push('challenge markup');
  if (CHALLENGE.test(String(info.title || ''))) reasons.push('challenge title');
  if (finalUrl !== null && !/^https?:\/\//i.test(String(finalUrl))) reasons.push('left the page'); // e.g. the browser's own error page
  return reasons.length ? reasons : null;
}

/**
 * @param {{ffmpeg?: string, ffprobe?: string, chrome?: string}} tools  absolute paths (any may be missing)
 */
function createMedia(tools = {}) {
  const t = () => (typeof tools === 'function' ? tools() : tools) || {};

  /** Duration (s), width, height (as displayed: rotation applied) and codecs of a video or audio file, or null. */
  async function probe(file) {
    const r = await run(t().ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeout: 60000 });
    if (r.code !== 0) return null;
    let j;
    try { j = JSON.parse(r.out); } catch { return null; }
    const streams = j.streams || [];
    const v = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
    const a = streams.find((s) => s.codec_type === 'audio');
    const duration = Number(j.format && j.format.duration) || Number(v && v.duration) || Number(a && a.duration) || 0;
    let width = v ? Number(v.width) || null : null;
    let height = v ? Number(v.height) || null : null;
    const sd = (v && v.side_data_list) || [];
    const rot = Math.abs(Number((sd.find((d) => d.rotation != null) || {}).rotation || (v && v.tags && v.tags.rotate) || 0)) % 360;
    if (rot === 90 || rot === 270) [width, height] = [height, width];
    return { duration: round(duration), width, height, video: v ? v.codec_name : null, audio: a ? a.codec_name : null };
  }

  /** Pixel size of a picture (sips), or null. */
  async function imageSize(file) {
    const r = await run(SIPS, ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { timeout: 30000 });
    const w = /pixelWidth:\s*(\d+)/.exec(r.out);
    const h = /pixelHeight:\s*(\d+)/.exec(r.out);
    return w && h ? { width: Number(w[1]), height: Number(h[1]) } : null;
  }

  const SCALE = `scale='if(gt(iw,ih),min(${THUMB_MAX},iw),-2)':'if(gt(iw,ih),-2,min(${THUMB_MAX},ih))'`;

  /** A JPEG thumbnail (longest side at most 600 px) of a picture: sips first, ffmpeg if sips can't read it. */
  async function imageThumb(file, out) {
    const size = await imageSize(file);
    if (size) {
      const resize = Math.max(size.width, size.height) > THUMB_MAX ? ['-Z', String(THUMB_MAX)] : []; // -Z also enlarges
      const r = await run(SIPS, [...resize, '-s', 'format', 'jpeg', '-s', 'formatOptions', '82', file, '--out', out], { timeout: 60000 });
      if (r.code === 0 && nonEmpty(out)) return true;
    }
    const r = await run(t().ffmpeg, ['-v', 'error', '-y', '-i', file, '-frames:v', '1', '-vf', SCALE, '-q:v', '4', out], { timeout: 60000 });
    return r.code === 0 && nonEmpty(out);
  }

  /** A JPEG frame from a video, about a quarter of the way in (at most 10 s), falling back to the first frame. */
  async function videoThumb(file, out, duration) {
    const at = duration > 0 ? Math.min(duration * 0.25, 10) : 1;
    let r = await run(t().ffmpeg, ['-v', 'error', '-y', '-ss', at.toFixed(3), '-i', file, '-frames:v', '1', '-vf', SCALE, '-q:v', '4', out], { timeout: 60000 });
    if (r.code !== 0 || !nonEmpty(out)) r = await run(t().ffmpeg, ['-v', 'error', '-y', '-i', file, '-frames:v', '1', '-vf', SCALE, '-q:v', '4', out], { timeout: 60000 });
    return r.code === 0 && nonEmpty(out);
  }

  /** A thumbnail of a document (PDF, Keynote, Word…) through Quick Look, converted to JPEG. */
  async function documentThumb(file, out) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flpt-ql-'));
    try {
      await run(QLMANAGE, ['-t', '-s', String(THUMB_MAX), '-o', tmp, file], { timeout: 30000 });
      const png = fs.readdirSync(tmp).find((f) => f.endsWith('.png'));
      return png ? imageThumb(path.join(tmp, png), out) : false;
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  /** The sound of a clip as 48 kHz 16-bit WAV (what CapCut and the Cutaway Library use). */
  async function extractWav(file, out) {
    const r = await run(t().ffmpeg, ['-v', 'error', '-y', '-i', file, '-vn', '-acodec', 'pcm_s16le', '-ar', '48000', out], { timeout: 600000 });
    return r.code === 0 && nonEmpty(out);
  }

  /**
   * A 1280×900 PNG of a web page, so a page that later disappears isn't lost. Headless Chrome with a throwaway
   * profile (no cookies, no extensions), a few seconds to settle, and a hard stop.
   */
  function snapshot(url, out, { timeoutMs = 40000 } = {}) {
    const chrome = t().chrome;
    if (!chrome || !/^https?:\/\//i.test(String(url))) return Promise.resolve(false);
    return new Promise((resolve) => {
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'flpt-snap-'));
      const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
        '--disable-extensions', '--mute-audio', '--disable-background-networking', '--disable-sync', '--disable-notifications',
        `--user-data-dir=${profile}`, '--window-size=1280,900', '--virtual-time-budget=6000', `--screenshot=${out}`, String(url)],
      { stdio: 'ignore' });
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { child.kill('SIGKILL'); } catch { /* gone */ }
        setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 300);
        resolve(nonEmpty(out));
      };
      const timer = setTimeout(finish, timeoutMs);
      // Some Chrome builds write the screenshot and then linger, so watch for the file as well as the exit.
      const poll = setInterval(() => { if (nonEmpty(out)) { clearInterval(poll); setTimeout(finish, 500); } }, 500);
      child.on('error', () => { clearInterval(poll); finish(); });
      child.on('exit', () => { clearInterval(poll); finish(); });
    });
  }

  /**
   * A reference capture of one web page into `outDir`: frames/still_000.png … still_100.png (1920×1080, scroll 0, ⅓, ⅔
   * and 1) and, with `motion`, motion.mp4 (8 s, 30 fps, H.264) + frames/kf_01.jpg … kf_12.jpg. Resolves a report
   * { status: 'ok' | 'blocked' | 'timeout' | 'stopped' | 'error', blocked, finalUrl, httpStatus, title, page, motion,
   * stills, privacy, timingsMs, errors }; it never throws for a page's sake.
   *   proxy                          the network filter's address (references.startCaptureProxy): required
   *   encodeWrap(cmd, args, { writable })  [program, args] that start ffmpeg in its sandbox (no network), or null
   *   audit(profileDir)              QA only: called just before the throwaway profile is deleted
   * The browser (the pinned headless shell, else the toolchain's Chrome) runs in its own sandbox, keeps its profile,
   * temp files and screencast frames in one fresh folder that is always deleted, and is killed (with an encode in
   * progress) on the hard stop.
   */
  async function capturePage(url, outDir, { motion = false, seconds = 8, hardStopMs = 40000, uaToken = 'FLPT-reference (user-initiated capture; one URL)',
    proxy = null, encodeWrap = null, signal = null, workRoot = os.tmpdir(), audit = null, onProgress = () => {} } = {}) {
    const progress = (p) => { try { onProgress(p); } catch { /* the caller's own problem */ } };
    const W = CAPTURE.w;
    const H = CAPTURE.h;
    const t0 = Date.now();
    const report = { url: String(url), finalUrl: null, status: 'running', blocked: null, httpStatus: null, title: null, browser: null, userAgent: null,
      page: {}, scroller: null, motion: null, stills: [], privacy: {}, timingsMs: {}, errors: [] };
    const browser = t().headless || t().chrome;
    const why = !browser ? 'no browser' : !/^https?:\/\//i.test(String(url)) ? 'not a web link' : !FILTER_RE.test(String(proxy || '')) ? 'no network filter' : null;
    if (why) { report.status = 'error'; report.errors.push(why); return report; }
    fs.mkdirSync(path.join(outDir, 'frames'), { recursive: true });
    const work = fs.realpathSync(fs.mkdtempSync(path.join(workRoot, 'flpt-ref-')));
    const profile = path.join(work, 'profile');
    const shots = path.join(work, 'shots');
    const tmp = path.join(work, 'tmp');
    for (const d of [profile, shots, tmp]) fs.mkdirSync(d);

    let child = null;
    let cdp = null;
    let ended = null; // why the capture stopped early: 'timeout' | 'stopped'
    const encoders = new Set();
    const killGroup = (c) => {
      if (!c || c.exitCode !== null || c.signalCode !== null) return;
      try { process.kill(-c.pid, 'SIGKILL'); } catch { try { c.kill('SIGKILL'); } catch { /* gone */ } }
    };
    const killAll = () => { killGroup(child); for (const e of encoders) killGroup(e); };
    const stopNow = (why) => { if (!ended) { ended = why; killAll(); if (cdp) cdp.close(why); } };
    const hardStop = setTimeout(() => stopNow('timeout'), hardStopMs);
    const onAbort = () => stopNow('stopped');
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }

    // ffmpeg in its own process group, so the hard stop ends an encode in progress too.
    const runFf = (ffArgs, writable) => new Promise((resolve) => {
      if (ended) { resolve({ code: 1, out: '', err: ended }); return; }
      let [prog, argv] = [t().ffmpeg, ffArgs];
      if (encodeWrap) [prog, argv] = encodeWrap(prog, argv, { writable });
      let err = '';
      const p = spawn(prog, argv, { detached: true, stdio: ['ignore', 'ignore', 'pipe'], env: { PATH: '/usr/bin:/bin', TMPDIR: tmp, LANG: 'en_US.UTF-8' } });
      encoders.add(p);
      const timer = setTimeout(() => killGroup(p), 120000);
      p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
      const done = (code) => { clearTimeout(timer); encoders.delete(p); resolve({ code, out: '', err }); };
      p.on('error', (e) => { err += e.message; done(127); });
      p.on('close', (code) => done(code == null ? 1 : code));
    });

    async function main() {
      const [prog, argv] = [browser, captureArgs(profile, { proxy })];
      const tLaunch = Date.now();
      // An environment built from nothing: no keys, the capture's own temp folder.
      child = spawn(prog, argv, { detached: true, stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
        env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: os.homedir(), TMPDIR: tmp, LANG: 'en_US.UTF-8' } });
      let stderr = '';
      child.stdio[2].on('data', (d) => { stderr = (stderr + d).slice(-4000); });
      const exited = new Promise((r) => child.on('exit', r));
      child.on('error', (e) => { report.errors.push(`launch: ${e.message}`); if (cdp) cdp.close('the browser didn\'t start'); });
      cdp = createCdp(child.stdio[3], child.stdio[4]);
      if (ended) cdp.close(ended);
      const ver = await cdp.send('Browser.getVersion').catch((e) => { throw new Error(`${e.message}${stderr ? ` (${stderr.trim().split('\n').pop()})` : ''}`); });
      report.browser = String(ver.product || '').slice(0, 80);
      report.timingsMs.launch = Date.now() - tLaunch;

      // An isolated context (cookies, storage and cache in memory, gone with it), downloads denied, one page.
      const { browserContextId } = await cdp.send('Target.createBrowserContext', { disposeOnDetach: true });
      await cdp.send('Browser.setDownloadBehavior', { behavior: 'deny', browserContextId });
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
      // One URL per action: any other page (a popup, window.open, target=_blank) is closed, never followed.
      cdp.on((m) => {
        if (m.method !== 'Target.targetCreated') return;
        const ti = m.params.targetInfo || {};
        if (ti.type === 'page' && ti.targetId !== targetId && ti.browserContextId === browserContextId) {
          report.page.popupsClosed = (report.page.popupsClosed || 0) + 1;
          cdp.send('Target.closeTarget', { targetId: ti.targetId }).catch(() => {});
        }
      });
      await cdp.send('Target.setDiscoverTargets', { discover: true });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      const s = (method, params, ms) => cdp.send(method, params, sessionId, ms);
      const evaluate = async (expression, { awaitPromise = false, ms = 5000 } = {}) => {
        const r = await s('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, userGesture: false }, ms);
        if (r.exceptionDetails) throw new Error('page script failed');
        return r.result ? r.result.value : undefined;
      };
      const settle = async (ms) => { await sleep(ms); await evaluate(TWO_RAF, { awaitPromise: true, ms: 2000 }).catch(() => {}); };

      // What the page does while it loads: its main document's response, requests in flight, its dialogs.
      let mainFrame = null;
      let docResponse = null;
      let domReady = false;
      const inflight = new Set();
      let lastNet = Date.now();
      let requests = 0;
      const frames = [];
      let frameNo = 0;
      let screencastStart = 0;
      cdp.on((m) => {
        if (m.sessionId !== sessionId) return;
        const p = m.params || {};
        switch (m.method) {
          case 'Network.requestWillBeSent': requests += 1; inflight.add(p.requestId); lastNet = Date.now(); break;
          case 'Network.loadingFinished': case 'Network.loadingFailed': inflight.delete(p.requestId); lastNet = Date.now(); break;
          case 'Network.responseReceived':
            // A page target's main frame has the target's id, so an iframe's document never stands in for the page's.
            if (p.type === 'Document' && (p.frameId === targetId || p.frameId === mainFrame)) docResponse = { status: p.response.status, headers: p.response.headers || {} };
            break;
          case 'Page.domContentEventFired': domReady = true; break;
          case 'Page.javascriptDialogOpening': s('Page.handleJavaScriptDialog', { accept: false }).catch(() => {}); break;
          case 'Page.screencastFrame': {
            const f = path.join(shots, `f_${String(++frameNo).padStart(5, '0')}.jpg`);
            try { fs.writeFileSync(f, Buffer.from(p.data, 'base64')); } catch { break; }
            const md = p.metadata || {};
            frames.push({ file: f, ts: Number(md.timestamp) || Date.now() / 1000, scrollY: md.scrollOffsetY == null ? null : Number(md.scrollOffsetY) });
            s('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
            break;
          }
          default:
        }
      });
      await s('Page.enable');
      await s('Network.enable');
      await s('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false, screenWidth: W, screenHeight: H });
      // An honest user agent: the browser's own string (HeadlessChrome), plus who is asking and why.
      report.userAgent = `${String(ver.userAgent || '').trim()} ${uaToken}`.trim().slice(0, 400);
      await s('Network.setUserAgentOverride', { userAgent: report.userAgent });

      progress({ phase: 'load' });
      const tNav = Date.now();
      const nav = await s('Page.navigate', { url: String(url) }, 20000).catch((e) => ({ errorText: e.message }));
      mainFrame = nav.frameId || null;
      if (nav.errorText) report.errors.push(`navigate: ${String(nav.errorText).slice(0, 120)}`);
      else {
        for (const until = tNav + 20000; !domReady && Date.now() < until && !ended;) await sleep(100);
        // The network goes quiet (600 ms, at most 6 s), the fonts load (at most 2 s), a short settle.
        for (const until = Date.now() + 6000; Date.now() < until && !ended && !(inflight.size === 0 && Date.now() - lastNet >= 600);) await sleep(100);
        if (ended) return;
        await evaluate(FONTS, { awaitPromise: true, ms: 3000 }).catch(() => {});
        await settle(800);
      }
      report.timingsMs.navigate = Date.now() - tNav;
      report.finalUrl = await evaluate('location.href').catch(() => null);
      const info = (await evaluate(PAGE_INFO).catch(() => null)) || {};
      report.title = info.title || null;
      report.httpStatus = docResponse ? docResponse.status : null;
      report.page.passwordFields = info.passwordFields || 0;
      report.page.textLength = info.textLength || 0;
      const reasons = nav.errorText ? [`unreachable: ${String(nav.errorText).slice(0, 80)}`]
        : blockReasons({ status: report.httpStatus, headers: docResponse && docResponse.headers, info, responded: Boolean(docResponse), finalUrl: report.finalUrl });
      if (reasons) { report.blocked = reasons; report.status = 'blocked'; return; }
      report.page.webgl = await evaluate(WEBGL).catch(() => null);
      report.page.rafFps = await evaluate(RAF_FPS, { awaitPromise: true, ms: 3000 }).catch(() => null);
      report.scroller = (await evaluate(FIND_SCROLLER).catch(() => null)) || { kind: 'none', max: 0 };

      let motionFailed = false; // the screencast failed: the stills still make a partial capture
      if (motion) {
        progress({ phase: 'motion' });
        const tMot = Date.now();
        await evaluate(scrollTo(0)).catch(() => {});
        await settle(300);
        try { report.motion = await screencast(); } catch (e) { motionFailed = true; report.errors.push(`motion: ${e.message}`); }
        report.timingsMs.motion = Date.now() - tMot;
      }

      progress({ phase: 'stills' });
      const tSt = Date.now();
      for (const fr of CAPTURE.stills) {
        if (ended) return;
        const sc = (await evaluate(FIND_SCROLLER).catch(() => null)) || { max: 0 };
        const target = Math.round(Math.min(Number(sc.max) || 0, CAPTURE.maxScroll) * fr);
        await evaluate(scrollTo(target)).catch(() => {});
        await settle(1100);
        const shot = await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, 15000);
        const name = `still_${String(Math.round(fr * 100)).padStart(3, '0')}.png`;
        fs.writeFileSync(path.join(outDir, 'frames', name), Buffer.from(shot.data, 'base64'));
        report.stills.push({ file: `frames/${name}`, fraction: round(fr), target, scrollY: await evaluate(SCROLL_POS).catch(() => null) });
      }
      report.timingsMs.stills = Date.now() - tSt;
      // Cookies the session held (in the isolated context's memory only).
      const ck = await cdp.send('Storage.getCookies', { browserContextId }).catch(() => ({ cookies: [] }));
      report.privacy.cookiesInSession = (ck.cookies || []).length;
      report.privacy.persistentCookiesInSession = (ck.cookies || []).filter((c) => !c.session).length;
      report.page.requests = requests;
      report.status = motionFailed ? 'partial' : 'ok';
      await cdp.send('Target.disposeBrowserContext', { browserContextId }, undefined, 3000).catch(() => {});
      await cdp.send('Browser.close', {}, undefined, 3000).catch(() => {});
      await Promise.race([exited, sleep(4000)]);

      // The screencast (8 s): a short hold, then a slow wheel gesture down at most 3 viewports, so the page gets real
      // wheel and scroll events (smooth-scroll libraries and scroll-driven animations respond as to a person).
      async function screencast() {
        const distance = Math.min(Number(report.scroller.max) || 0, CAPTURE.maxScroll, Math.round(H * 3));
        const lead = 600;
        screencastStart = Date.now() / 1000;
        await s('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
        await sleep(lead);
        let gesture = 'none';
        if (distance > 0) {
          const speed = Math.max(60, Math.round(distance / ((seconds * 1000 - lead - 900) / 1000)));
          try {
            await Promise.race([
              s('Input.synthesizeScrollGesture', { x: W / 2, y: H / 2, yDistance: -distance, xDistance: 0, speed, gestureSourceType: 'mouse', preventFling: true }, seconds * 1000),
              sleep(seconds * 1000 - lead - 200),
            ]);
            gesture = `wheel ${distance}px @ ${speed}px/s`;
          } catch (e) {
            gesture = `scrollTo ${distance}px`;
            const dur = seconds * 1000 - lead - 900;
            await evaluate(`new Promise((res) => { const el = document.querySelector('[data-flpt-scroller]'); const s0 = performance.now();
              const step = (now) => { const u = Math.min(1, (now - s0) / ${dur}); const e = u * u * (3 - 2 * u);
                if (el) el.scrollTop = ${distance} * e; else window.scrollTo(0, ${distance} * e); if (u < 1) requestAnimationFrame(step); else res(1); };
              requestAnimationFrame(step); })`, { awaitPromise: true, ms: dur + 2000 }).catch(() => {});
          }
        }
        const remain = screencastStart + seconds + 0.1 - Date.now() / 1000;
        if (remain > 0) await sleep(remain * 1000);
        await s('Page.stopScreencast').catch(() => {});
        await sleep(150);
        if (ended) throw new Error(ended);
        const inWin = frames.map((f) => ({ ...f, t: f.ts - screencastStart })).filter((f) => f.t < seconds);
        if (!inWin.length) throw new Error('the screencast delivered no frames');
        const gaps = inWin.slice(1).map((f, i) => f.t - inWin[i].t).sort((a, b) => a - b);
        const pct = (a, q) => (a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : 0);
        const moving = inWin.filter((f, i) => i > 0 && f.scrollY !== null && f.scrollY !== inWin[i - 1].scrollY);
        const span = moving.length > 1 ? moving[moving.length - 1].t - moving[0].t : 0;
        // Each frame held for its true time → 30 fps CFR; the first covers t = 0 (the page as it was).
        const lines = [];
        for (let i = 0; i < inWin.length; i++) {
          const next = i + 1 < inWin.length ? inWin[i + 1].t : seconds;
          lines.push(`file '${inWin[i].file}'`, `duration ${Math.max(0.001, next - (i === 0 ? 0 : inWin[i].t)).toFixed(6)}`);
        }
        lines.push(`file '${inWin[inWin.length - 1].file}'`);
        const list = path.join(shots, 'list.txt');
        fs.writeFileSync(list, `${lines.join('\n')}\n`);
        const mp4 = path.join(outDir, 'motion.mp4');
        progress({ phase: 'encode' });
        let r = await runFf(['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-vf', `scale=${W}:${H}:flags=lanczos,fps=${CAPTURE.fps},format=yuv420p`,
          '-t', String(seconds), '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-g', String(CAPTURE.fps), '-movflags', '+faststart', mp4], [outDir, work]);
        if (r.code !== 0 || !nonEmpty(mp4)) throw new Error(`encode: ${r.err.trim().split('\n').pop() || r.code}`);
        // 12 keyframes at the centre of each twelfth, in one pass.
        const n = Math.round(seconds * CAPTURE.fps);
        const picks = Array.from({ length: CAPTURE.keyframes }, (_, k) => Math.min(n - 1, Math.round(((k + 0.5) * n) / CAPTURE.keyframes)));
        r = await runFf(['-v', 'error', '-y', '-i', mp4, '-vf', `select='${picks.map((k) => `eq(n\\,${k})`).join('+')}'`, '-fps_mode', 'passthrough', '-q:v', '2',
          '-frames:v', String(CAPTURE.keyframes), path.join(outDir, 'frames', 'kf_%02d.jpg')], [outDir, work]);
        if (r.code !== 0) throw new Error(`keyframes: ${r.err.trim().split('\n').pop() || r.code}`);
        return {
          seconds, fps: CAPTURE.fps, gesture, framesDelivered: inWin.length, deliveredFps: round(inWin.length / seconds, 1),
          movingFps: span > 0 ? round((moving.length - 1) / span, 1) : null,
          scrolled: moving.length > 1, gapMs: { p50: Math.round(pct(gaps, 0.5) * 1000), p90: Math.round(pct(gaps, 0.9) * 1000), max: Math.round((gaps[gaps.length - 1] || 0) * 1000) },
          keyframes: picks.length,
        };
      }
    }

    try {
      await main();
    } catch (e) {
      if (!ended) report.errors.push(String((e && e.message) || e).slice(0, 300));
    } finally {
      clearTimeout(hardStop);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (ended) report.status = ended;
      else if (report.status === 'running') report.status = 'error';
      if (cdp) cdp.close('done');
      killAll();
      await sleep(200);
      if (audit) { try { report.privacy.audit = await audit(profile); } catch (e) { report.privacy.audit = { error: e.message }; } }
      fs.rmSync(work, { recursive: true, force: true });
      report.privacy.profileRemoved = !fs.existsSync(profile);
      report.privacy.workRemoved = !fs.existsSync(work);
      report.timingsMs.total = Date.now() - t0;
    }
    return report;
  }

  return { probe, imageSize, imageThumb, videoThumb, documentThumb, extractWav, snapshot, capturePage };
}

module.exports = { createMedia, run, createCdp, captureArgs, blockReasons, THUMB_MAX, CAPTURE };
