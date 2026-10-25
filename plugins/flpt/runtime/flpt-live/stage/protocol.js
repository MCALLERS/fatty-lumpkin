/* protocol.js · the Stage's protocol, layout, headers and timings, 1.0.0 (FLPT V2, PLAN §2.5, with spike K2's rulings).
 *
 * One file for every side of the Stage, so the harness, the Mac host (W1-14), flpt-server (the Desk and the web) and
 * the mock all speak, serve and check the same thing. A classic script in the harness (window.FLPTStageProtocol) and
 * CommonJS in Node (require). Pure: no DOM, no timers, no I/O.
 *
 * The Stage is FLPT's trusted harness (stage/harness.html) holding a piece of untrusted code in
 * <iframe sandbox="allow-scripts"> (an opaque origin). Every surface serves one token's files at one layout, so the
 * harness finds everything by fixed relative paths and the protocol carries numbers and enums only:
 *
 *   <base>/stage/…           the harness (HARNESS_FILES; the same bytes on the Mac, the Desk and the web)
 *   <base>/score/…           flpt-score.js and its presets (the runtime's own; the score Worker loads them)
 *   <base>/scene/index.html  the piece's generated host page (host-preview.js) and its folder: a scene, a style's
 *                            demo or a presenter rig
 *   <base>/media/…           voice-draft.wav, voice-filmed.wav, stem.wav, music.<wav|mp3|m4a>, bubble.png,
 *                            bubble.mp4, snapshot.png: explicit files only
 *   <base>/ref/…             ref.<mp4|webm> (a clip or a loop), frame-01.<jpg|png|webp> … frame-24, image.<…>
 *
 * host → harness (commands; validated by command() on both sides):
 *   load     { kind, keep, t, voices, voiceAt, music, file, preset, seed, sfx, ref, refExt, refFrames, refOffset,
 *              refLoop, bubble, placement }      (re)mount the piece; keep = a live reload that keeps t and play
 *   unload · play · pause · seek { t } · rate { x } · quality { quality } · mode { mode } · wipe { x }
 *   overlay { bubble, grid } · voice { voice } · sound { on } · snapshot { t }
 * harness → host (events; validated by event()):
 *   ready    { kind, duration, fps, beats: [{ name, t }], keyframes: [t] }
 *   tick     { t, fps, frameMs, playing }   every TICK_MS while the piece answers (a draw while playing, a heartbeat
 *                                           while paused), so a host's no-tick watchdog also covers a paused Stage
 *   error    { code, msg }                  msg ≤ 200 characters, control characters stripped; KILL_CODES mean the
 *                                           piece was removed (a host drops the Stage and counts a kill)
 *   snapshot { t, psnr }                    the paused preview against the final renderer's frame (99 = identical)
 * Over postMessage (the Desk, the web, the mock) each message travels as { flptStage: <message> }; on the Mac the
 * 2-function preload relay carries the message itself.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else if (root) root.FLPTStageProtocol = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  const VERSION = '1.0.0';
  const W = 1920, H = 1080, FPS = 30;
  /** The piece's own units (flpt-live's ctx.safe and ctx.bubble, PLAN §2.3): what the overlays draw. */
  const GEOM = Object.freeze({
    safe: Object.freeze({ x: 64, y: 64, w: 1792, h: 952 }),
    bubble: Object.freeze({ x: 48, y: 732, d: 300 }),
    keepOut: Object.freeze({ x: 0, y: 700, w: 380, h: 380 }),
    grid: 0.1,
  });

  // K2: the 4 s kill is a 3 s no-tick threshold checked every 100 ms with ticks every 250 ms (kills at 3.01–3.1 s).
  // These numbers are load-bearing; a host that lengthens any of them eats the margin.
  const TIMING = Object.freeze({
    TICK_MS: 250,             // harness → host tick period
    WATCHDOG_CHECK_MS: 100,   // a host's watchdog poll
    NO_TICK_MS: 3000,         // no tick this long (playing or paused) → kill; a Mac host also needs its probe unanswered (decisions.md)
    HEARTBEAT_MS: 500,        // the harness pings a paused piece this often
    STALL_MS: 3000,           // the harness removes a piece that answers no draw or ping for this long
    READY_MS: 20000,          // … or that isn't ready this long after mounting
    RSS_LIMIT_MB: 1536,       // the Mac watchdog's memory line (every frame process of the Stage)
    KILLS_TO_OFF: 3,          // three kills …
    KILL_WINDOW_MS: 60000,    // … in a minute, and the Stage stays off until the piece's files change
    RELOAD_DEBOUNCE_MS: 1500, // a host's file watcher, before it sends load { keep: true }
    REF_HARD_S: 0.08,         // the reference video is re-seated when it drifts more than this …
    REF_NUDGE: 0.03,          // … and its playbackRate nudged by at most ±3 % in between
  });

  const ENUMS = Object.freeze({
    kind: ['scene', 'style', 'rig', 'ref'],
    mode: ['scene', 'side', 'wipe'],
    quality: ['final', 'preview', 'half'],
    voice: ['draft', 'filmed'],
    voices: ['none', 'draft', 'filmed', 'both'],
    music: ['none', 'stem', 'score', 'file'],
    file: ['wav', 'mp3', 'm4a'],
    preset: ['pulse-112', 'drift-90', 'march-128', 'hush'],
    sfx: ['off', 'soft', 'on'],
    ref: ['none', 'video', 'frames', 'image'],
    refExt: ['mp4', 'webm'],
    imageExt: ['jpg', 'png', 'webp'],
    bubble: ['none', 'still', 'clip', 'both'],
    placement: ['solo', 'duet', 'between'],
  });

  const LAYOUT = Object.freeze({
    stage: 'stage/', score: 'score/', scene: 'scene/', media: 'media/', ref: 'ref/',
    harness: 'stage/harness.html',
    flptScore: 'score/flpt-score.js',
    preset: (id) => `score/presets/${id}.json`,
    page: 'scene/index.html',
    voice: (v) => `media/voice-${v}.wav`,
    stem: 'media/stem.wav',
    music: (ext) => `media/music.${ext}`,
    bubbleStill: 'media/bubble.png',
    bubbleClip: 'media/bubble.mp4',
    snapshot: 'media/snapshot.png',
    refVideo: (ext) => `ref/ref.${ext}`,
    refFrame: (n, ext) => `ref/frame-${String(n).padStart(2, '0')}.${ext}`,
    refImage: (ext) => `ref/image.${ext}`,
  });
  /** The harness's own files: the only ones a host serves from stage/ (protocol.js is one; serve.mjs isn't). */
  const HARNESS_FILES = Object.freeze(['harness.html', 'harness.css', 'harness.js', 'protocol.js', 'overlays.js', 'compare.js', 'score-worker.js']);
  const MEDIA_FILES = Object.freeze(['voice-draft.wav', 'voice-filmed.wav', 'stem.wav', 'music.wav', 'music.mp3', 'music.m4a', 'bubble.png', 'bubble.mp4', 'snapshot.png']);
  const REF_FILE = /^(ref\.(mp4|webm)|frame-(0[1-9]|1\d|2[0-4])\.(jpg|png|webp)|image\.(jpg|png|webp))$/;

  /** What a host may send for each extension (anything else is refused). */
  const TYPES = Object.freeze({
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.gif': 'image/gif', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
    '.otf': 'font/otf', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm',
  });

  // ── headers: the same policy on every surface (K2: frame-src 'self' is the navigation gate; the sandbox header goes
  //    on every scene response as well as the iframe attribute) ───────────────────────────────────────────────────────
  const PERMISSIONS_POLICY = [
    'camera=()', 'microphone=()', 'geolocation=()', 'display-capture=()', 'clipboard-read=()', 'clipboard-write=()',
    'usb=()', 'hid=()', 'serial=()', 'bluetooth=()', 'midi=()', 'payment=()', 'fullscreen=()', 'screen-wake-lock=()',
    'idle-detection=()', 'local-fonts=()', 'window-management=()', 'publickey-credentials-get=()', 'keyboard-map=()',
    'storage-access=()', 'browsing-topics=()', 'picture-in-picture=()', 'xr-spatial-tracking=()',
  ].join(', ');
  /** The iframe's allow attribute: every powerful feature off for the piece. */
  const FRAME_ALLOW = ['camera', 'microphone', 'geolocation', 'display-capture', 'clipboard-read', 'clipboard-write', 'usb', 'hid',
    'serial', 'bluetooth', 'midi', 'payment', 'fullscreen', 'autoplay', 'picture-in-picture', 'local-fonts',
    'window-management', 'screen-wake-lock', 'idle-detection', 'publickey-credentials-get'].map((f) => `${f} 'none'`).join('; ');

  const ORIGIN = /^(https?:\/\/(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(:\d{1,5})?|flpt-stage:\/\/[0-9a-f]{16,64})$/i;
  /** frame-ancestors for a part: the harness is framed only by its host (or nothing, top-level on the Mac); the piece by
   *  the harness ('self') — and, because frame-ancestors checks every ancestor, by the host too. */
  function ancestors(part, host) {
    const h = host && ORIGIN.test(String(host)) ? String(host) : null;
    if (part === 'scene') return h ? `'self' ${h}` : "'self'";
    return h || "'none'";
  }
  function csp(part, host) {
    if (part === 'harness') {
      return ["default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self' data: blob:", "media-src 'self' blob:",
        "connect-src 'self'", "frame-src 'self'", "child-src 'self'", "worker-src 'self'", "font-src 'self'", "base-uri 'none'",
        "form-action 'none'", "object-src 'none'", "manifest-src 'none'", `frame-ancestors ${ancestors('harness', host)}`].join('; ');
    }
    if (part === 'scene') {
      return ['sandbox allow-scripts', "default-src 'self' data: blob:", "script-src 'self'", "style-src 'self' 'unsafe-inline' data:",
        "img-src 'self' data: blob:", "font-src 'self' data:", "media-src 'self' data: blob:", "connect-src 'none'",
        "form-action 'none'", "frame-src 'none'", "child-src 'none'", "worker-src 'none'", "object-src 'none'",
        "base-uri 'none'", "manifest-src 'none'", `frame-ancestors ${ancestors('scene', host)}`].join('; ');
    }
    return "sandbox; default-src 'none'; frame-ancestors " + ancestors('harness', host); // media and refs: inert as documents
  }
  /** Response headers for one file of one part ('harness' for stage/ and score/, 'scene', 'media' for media/ and ref/). */
  function headers(part, ext, { host } = {}) {
    return {
      'content-type': TYPES[ext] || 'application/octet-stream',
      'content-security-policy': csp(part, host),
      'x-content-type-options': 'nosniff',
      'x-dns-prefetch-control': 'off',
      'referrer-policy': 'no-referrer',
      'permissions-policy': PERMISSIONS_POLICY,
      'cache-control': 'no-store',
    };
  }

  /**
   * Classify a path below a token's base: { part, root, rel } or { refuse: reason }. Pure (no file system): the host
   * then resolves rel under its root by realpath and checks containment.
   *   root 'stage' → HARNESS_FILES only · 'score' → flpt-score.js and presets/<id>.json · 'scene' → any allowed file,
   *   but the one page is exactly 'index.html' (no other .html, no case variant: on a case-insensitive disk those name
   *   the same file, and the page is served once per mount) · 'media' → MEDIA_FILES only · 'ref' → REF_FILE only
   * Every path has one spelling: no empty segment ('scene//index.html'), no '.' or '..', no escapes.
   */
  function route(p) {
    let s = String(p || '');
    if (s.charAt(0) === '/') s = s.slice(1);
    if (!s || s.length > 300 || /[\0\\]|%/.test(s) || /(^|\/)\.\.?(\/|$)/.test(s) || /\/\/|\/$/.test(s)) return { refuse: 'bad-path' };
    const at = s.indexOf('/');
    if (at < 0) return { refuse: 'bad-root' };
    const root = s.slice(0, at), rel = s.slice(at + 1);
    const dot = rel.lastIndexOf('.'), ext = dot >= 0 ? rel.slice(dot).toLowerCase() : '';
    if (!TYPES[ext]) return { refuse: 'bad-ext' };
    if (root === 'stage') return HARNESS_FILES.includes(rel) ? { part: 'harness', root, rel, ext } : { refuse: 'not-harness' };
    if (root === 'score') {
      if (rel === 'flpt-score.js' || /^presets\/[a-z0-9-]{1,40}\.json$/.test(rel)) return { part: 'harness', root, rel, ext };
      return { refuse: 'not-score' };
    }
    if (root === 'scene') {
      if (/(^|\/)\./.test(rel)) return { refuse: 'hidden' };
      if (ext === '.html' && rel !== 'index.html') return { refuse: 'not-page' };
      return { part: 'scene', root, rel, ext };
    }
    if (root === 'media') return MEDIA_FILES.includes(rel) ? { part: 'media', root, rel, ext } : { refuse: 'not-media' };
    if (root === 'ref') return REF_FILE.test(rel) ? { part: 'media', root, rel, ext } : { refuse: 'not-ref' };
    return { refuse: 'bad-root' };
  }

  // ── validation: numbers and enums only; anything else is dropped ───────────────────────────────────────────────────
  const isObj = (m) => !!m && typeof m === 'object' && !Array.isArray(m);
  const num = (v, lo, hi, d) => { const x = typeof v === 'number' ? v : NaN; return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : d; };
  const int = (v, lo, hi, d) => { const x = num(v, lo, hi, NaN); return Number.isFinite(x) ? Math.round(x) : d; };
  const bool = (v, d) => (typeof v === 'boolean' ? v : d);
  const oneOf = (name, v, d) => (typeof v === 'string' && ENUMS[name].includes(v) ? v : d);
  const T_MAX = 86400;

  /** A command, cleaned: a fresh object with known keys only, or null. */
  function command(m) {
    if (!isObj(m) || typeof m.cmd !== 'string') return null;
    switch (m.cmd) {
      case 'load': return {
        cmd: 'load', kind: oneOf('kind', m.kind, 'scene'), keep: bool(m.keep, false), t: num(m.t, 0, T_MAX, 0),
        voices: oneOf('voices', m.voices, 'none'), voiceAt: num(m.voiceAt, -600, 600, 0),
        music: oneOf('music', m.music, 'none'), file: oneOf('file', m.file, 'wav'), preset: oneOf('preset', m.preset, 'pulse-112'),
        seed: int(m.seed, 0, 2147483647, 1), sfx: oneOf('sfx', m.sfx, 'off'),
        ref: oneOf('ref', m.ref, 'none'), refExt: oneOf('refExt', m.refExt, 'mp4'), refImageExt: oneOf('imageExt', m.refImageExt, 'jpg'),
        refFrames: int(m.refFrames, 1, 24, 1), refOffset: num(m.refOffset, -3600, 3600, 0), refLoop: bool(m.refLoop, false),
        bubble: oneOf('bubble', m.bubble, 'none'), placement: oneOf('placement', m.placement, 'solo'),
      };
      case 'unload': case 'play': case 'pause': return { cmd: m.cmd };
      case 'seek': { const t = num(m.t, 0, T_MAX, NaN); return Number.isFinite(t) ? { cmd: 'seek', t } : null; }
      case 'rate': { const x = num(m.x, 0.25, 2, NaN); return Number.isFinite(x) ? { cmd: 'rate', x } : null; }
      case 'quality': { const q = oneOf('quality', m.quality, null); return q ? { cmd: 'quality', quality: q } : null; }
      case 'mode': { const v = oneOf('mode', m.mode, null); return v ? { cmd: 'mode', mode: v } : null; }
      case 'wipe': { const x = num(m.x, 0, 1, NaN); return Number.isFinite(x) ? { cmd: 'wipe', x } : null; }
      case 'overlay': return { cmd: 'overlay', bubble: bool(m.bubble, false), grid: bool(m.grid, false) };
      case 'voice': { const v = oneOf('voice', m.voice, null); return v ? { cmd: 'voice', voice: v } : null; }
      case 'sound': return typeof m.on === 'boolean' ? { cmd: 'sound', on: m.on } : null;
      case 'snapshot': { const t = num(m.t, 0, T_MAX, NaN); return Number.isFinite(t) ? { cmd: 'snapshot', t } : null; }
      default: return null;
    }
  }

  const CODE = /^[a-z][a-z-]{0,23}$/;
  /** The error codes with which the harness has removed the piece under a kill rule: a host then drops the whole Stage
   *  (on the Mac, every frame process) and counts a kill toward KILLS_TO_OFF. */
  const KILL_CODES = Object.freeze(['second-load', 'no-ready', 'no-draw', 'no-answer', 'bad-ready']);
  /** Control characters, line and paragraph separators, zero-widths and bidi controls: shown as a space. */
  const invisible = (c) => c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029 || (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff;
  /** Short, printable, single-line text (a cue name, an error line). */
  function text(s, max) {
    let out = '';
    for (const ch of String(s == null ? '' : s)) out += invisible(ch.codePointAt(0)) ? ' ' : ch;
    return out
      .replace(/\s+/g, ' ').trim().slice(0, max);
  }
  /** An event, cleaned: a fresh object with known keys only, or null. */
  function event(m) {
    if (!isObj(m) || typeof m.ev !== 'string') return null;
    switch (m.ev) {
      case 'ready': {
        const duration = num(m.duration, 0, T_MAX, NaN);
        if (!(duration > 0)) return null;
        const beats = (Array.isArray(m.beats) ? m.beats : []).slice(0, 200).filter((b) => isObj(b) && Number.isFinite(b.t))
          .map((b) => ({ name: text(b.name, 48), t: num(b.t, 0, duration, 0) }));
        const keyframes = (Array.isArray(m.keyframes) ? m.keyframes : []).slice(0, 32).filter((t) => Number.isFinite(t)).map((t) => num(t, 0, duration, 0));
        return { ev: 'ready', kind: oneOf('kind', m.kind, 'scene'), duration, fps: int(m.fps, 1, 120, FPS), beats, keyframes };
      }
      case 'tick': {
        const t = num(m.t, 0, T_MAX, NaN);
        if (!Number.isFinite(t)) return null;
        return { ev: 'tick', t, fps: num(m.fps, 0, 240, 0), frameMs: num(m.frameMs, 0, 60000, 0), playing: bool(m.playing, false) };
      }
      case 'error': return typeof m.code === 'string' && CODE.test(m.code) ? { ev: 'error', code: m.code, msg: text(m.msg, 200) } : null;
      case 'snapshot': {
        const t = num(m.t, 0, T_MAX, NaN);
        return Number.isFinite(t) ? { ev: 'snapshot', t, psnr: m.psnr === Infinity ? 99 : num(m.psnr, 0, 99, 0) } : null;
      }
      default: return null;
    }
  }
  /** The envelope over postMessage. */
  const wrap = (m) => ({ flptStage: m });
  const unwrap = (d) => (isObj(d) && isObj(d.flptStage) ? d.flptStage : null);

  // ── pure pieces of the harness, here so Node can test them ─────────────────────────────────────────────────────────
  /**
   * The Stage's clock: piece time from a monotonic source in seconds (the AudioContext's currentTime while audio
   * runs, else performance.now() / 1000). Re-anchored on every play, seek, rate and source change, so a switch never
   * jumps.
   */
  function clock(now) {
    const c = { playing: false, from: 0, t0: 0, rate: 1, duration: Infinity, now };
    c.time = () => (c.playing ? Math.max(0, Math.min(c.duration, c.from + (c.now() - c.t0) * c.rate)) : c.from);
    c.anchor = (now2) => { const t = c.time(); if (now2) c.now = now2; c.from = t; c.t0 = c.now(); return t; };
    c.play = () => { if (c.from >= c.duration - 1e-6) c.from = 0; c.t0 = c.now(); c.playing = true; };
    c.pause = () => { c.from = c.time(); c.playing = false; };
    c.seek = (t) => { c.from = Math.max(0, Math.min(c.duration, Number(t) || 0)); c.t0 = c.now(); };
    c.setRate = (x) => { c.anchor(); c.rate = x; };
    c.ended = () => c.playing && c.time() >= c.duration - 1e-6;
    return c;
  }

  /** Where a video should be for a clock target: clamped to its length, or wrapped when it loops. */
  function videoTime(target, length, loop) {
    const L = Number(length) > 0 ? Number(length) : Infinity;
    if (loop && Number.isFinite(L)) return ((target % L) + L) % L;
    return Math.max(0, Math.min(L - 0.001, target));
  }
  /** current − want, the short way round a loop. */
  function drift(current, want, length, loop) {
    const d = current - want, L = Number(length);
    return loop && L > 0 ? ((((d + L / 2) % L) + L) % L) - L / 2 : d;
  }
  /**
   * One step of keeping a <video> (the reference, the filmed bubble) on the piece's clock (draft-ux §5.2): re-seat it
   * when it drifts past REF_HARD_S (aiming ahead by the measured seek latency, at most once per 0.3 s so a slow seek is
   * never chased), otherwise nudge its playbackRate by at most ±REF_NUDGE toward the clock. Paused, it is placed
   * exactly. → { seek?, rate, play?, pause? }
   */
  function syncStep({ current, target, rate = 1, playing, paused, seeking, length, loop = false, lead = 0, sinceSeek = Infinity }) {
    const want = videoTime(target, length, loop);
    if (!playing) {
      const out = { rate };
      if (!paused) out.pause = true;
      if (!seeking && Math.abs(drift(current, want, length, loop)) > 1 / 120) out.seek = want;
      return out;
    }
    if (seeking) return { rate };
    const d = drift(current, want, length, loop);
    if (paused) return { seek: videoTime(target + lead * rate, length, loop), rate, play: true };
    if (Math.abs(d) > TIMING.REF_HARD_S) return sinceSeek > 0.3 ? { seek: videoTime(target + lead * rate, length, loop), rate } : { rate };
    const k = Math.max(-TIMING.REF_NUDGE, Math.min(TIMING.REF_NUDGE, -d * 0.5));
    return { rate: rate * (1 + k) };
  }

  /** The largest 16:9 box inside w × h, centred. */
  function fit(w, h, x0 = 0, y0 = 0) {
    const s = Math.min(w / W, h / H);
    const bw = W * s, bh = H * s;
    return { x: x0 + (w - bw) / 2, y: y0 + (h - bh) / 2, w: bw, h: bh, scale: s };
  }
  /** Where the piece and the reference sit in a w × h harness, per mode. Side: reference left, piece right. */
  function layout(mode, w, h, { gap = 8, hasRef = true } = {}) {
    if (mode === 'side' && hasRef) {
      const half = Math.max(0, (w - gap) / 2);
      return { scene: fit(half, h, half + gap, 0), ref: fit(half, h, 0, 0) };
    }
    const box = fit(w, h);
    return { scene: box, ref: mode === 'wipe' && hasRef ? box : null };
  }

  /** PSNR in dB over RGB between two RGBA buffers of the same size; 99 when identical. */
  function psnr(a, b) {
    if (!a || !b || a.length !== b.length || !a.length) return 0;
    let se = 0, n = 0;
    for (let i = 0; i < a.length; i += 4) {
      const d0 = a[i] - b[i], d1 = a[i + 1] - b[i + 1], d2 = a[i + 2] - b[i + 2];
      se += d0 * d0 + d1 * d1 + d2 * d2;
      n += 3;
    }
    if (se === 0) return 99;
    return Math.min(99, 10 * Math.log10((255 * 255) / (se / n)));
  }

  /** The beats and keyframes a piece reports (host-preview's ready meta), as the ready event carries them. */
  function readyFrom(kind, meta) {
    const m = isObj(meta) ? meta : {};
    return event({ ev: 'ready', kind, duration: m.duration, fps: m.fps, beats: m.beats, keyframes: m.keyframes });
  }

  return {
    VERSION, W, H, FPS, GEOM, TIMING, KILL_CODES, ENUMS, LAYOUT, HARNESS_FILES, MEDIA_FILES, REF_FILE, TYPES,
    PERMISSIONS_POLICY, FRAME_ALLOW, csp, headers, route, ancestors,
    command, event, wrap, unwrap, text, clock, videoTime, drift, syncStep, fit, layout, psnr, readyFrom,
  };
});
