/* guard.js · flpt-live's runtime tripwire, 1.0.0 (FLPT V2, PLAN §2.3, with spike K1's "armed" design).
 *
 * Loaded first in every scene page that runs scene code we didn't write ourselves: renders (bridge-hf.js,
 * render-direct.mjs) and the Stage (host-preview.js). Never with host-inline.js (FLPT's own scenes), which needs timers.
 *
 * HyperFrames' own injected runtime calls the page's timers, rAF, Date and performance, so those can't be poisoned
 * globally (K1: the render fails in about a second). They throw only while the guard is ARMED, which is:
 *   - while flpt-live runs scene code or works on what scene code made (setup, frame, hits, a kit's make/bind, the
 *     text and meta reads), through __flptGuard.run(t, fn);
 *   - while a script tagged data-flpt-scene (scene.js, a style's kit.js, kit-ext.js) runs its top level;
 *   - inside listeners, on* handlers and promise callbacks that scene code registered while armed;
 *   - whenever one of those scripts' own frames is on the stack, however it got there (an await's continuation, a
 *     thenable a promise adopts, a getter, a replaced method): the page lists them on this tag (data-flpt-scenes).
 * Armed, a scene sees Date.now() / new Date() = a fixed epoch, performance.now(), document.timeline.currentTime and
 * Event.timeStamp = the frame's time × 1000; eval, Function, Proxy, defineProperty, dispatchEvent, style sheets and
 * CSS or font url()s from elsewhere are refused.
 * Always, for everyone: the network (fetch, XHR, WebSocket, EventSource, WebRTC, workers, sendBeacon), window.open,
 * clicking links, submitting forms, document.write, and <img>/<source> pictures (src, srcset, by property, attribute or
 * attribute node) from anywhere but a relative same-folder path or data:/blob:.
 * Outside the armed window Math.random is a seeded generator, so even HyperFrames' own ids are the same every render.
 * CSS animations and transitions are switched off.
 *
 * Then the page's intrinsics are locked (the last step here, before any other script of ours or the scene's runs):
 * the global bindings trusted code calls can't be reassigned, and the namespaces (Object, Math, JSON, Promise, …) and
 * the prototypes scene objects inherit from (Object, Array, Function, Promise, the DOM and canvas ones) are frozen. So
 * nothing a scene does can put its code where HyperFrames, a host or the runtime will later call it unarmed.
 * The guard records the text every canvas draws while armed (fillText / strokeText with its box), for the runtime's
 * text checks (claimText, once).
 *
 * The lint (tools/lint.mjs) is the static tripwire and the OS sandbox / CSP is the boundary; this makes a mistake fail
 * loudly and the same way every time.
 */
(function () {
  'use strict';
  const W = window, D = document;
  if (W.__flptGuard) return;

  // ---- intrinsics the guard itself calls, captured before any other script runs
  const R = Reflect, rApply = R.apply, rConstruct = R.construct, rGet = R.get, ownKeys = R.ownKeys;
  const getDesc = Object.getOwnPropertyDescriptor, defProp = Object.defineProperty, getProto = Object.getPrototypeOf;
  const freeze = Object.freeze, isFrozen = Object.isFrozen;
  const Err = Error, Str = String, numFinite = Number.isFinite, WMap = WeakMap, RealProxy = Proxy, RealFunction = Function;
  const has = (o, k) => o != null && k in o;
  const fnOf = (o, k) => (o && typeof o[k] === 'function' ? o[k] : null);
  const getterOf = (o, k) => { const d = o && getDesc(o, k); return d && d.get ? d.get : null; };

  const EPOCH = Date.UTC(2026, 0, 1);
  const stack = [];
  let curT = 0;
  const hits = [];

  const csGet = W.Document ? getterOf(Document.prototype, 'currentScript') : null;
  const hasAttr = W.Element ? fnOf(Element.prototype, 'hasAttribute') : null;
  const getAttr = W.Element ? fnOf(Element.prototype, 'getAttribute') : null;
  function sceneScript() {
    const s = csGet ? rApply(csGet, D, []) : D.currentScript;
    return !!(s && hasAttr && rApply(hasAttr, s, ['data-flpt-scene']));
  }
  // The scene's own script URLs, from this tag (data-flpt-scenes="scene.js assets/styles/riso/kit.js …", written by the
  // generated page). Scene code that runs later by any route (an await's continuation, a thenable a promise adopts, a
  // getter, a handler) still has its own frame on the stack, so the guard treats it as armed: fail closed.
  const SCENE_URLS = (() => {
    try {
      const me = csGet ? rApply(csGet, D, []) : D.currentScript;
      const list = me && getAttr ? rApply(getAttr, me, ['data-flpt-scenes']) : null;
      if (!list || typeof W.URL !== 'function') return [];
      return Str(list).split(/\s+/).filter(Boolean).map((u) => new W.URL(u, D.baseURI).href + ':');
    } catch (e) { return []; }
  })();
  function sceneOnStack() {
    if (!SCENE_URLS.length) return false;
    const lim = Err.stackTraceLimit, prep = Err.prepareStackTrace;
    let s;
    try { Err.stackTraceLimit = 200; Err.prepareStackTrace = undefined; s = Str(new Err().stack || ''); } catch (e) { return true; } finally {
      try { Err.stackTraceLimit = lim; Err.prepareStackTrace = prep; } catch (e) { /* a scene froze Error: s decides */ }
    }
    for (let i = 0; i < SCENE_URLS.length; i++) if (s.indexOf(SCENE_URLS[i]) >= 0) return true;
    return false;
  }
  const armed = () => stack.length > 0 || sceneScript() || sceneOnStack();
  function deny(what) {
    if (hits.length < 50) hits[hits.length] = what;
    const e = new Err(`flpt-guard: ${what} is off in scenes (draw from t, ctx.rng and ctx.cue)`);
    e.flptGuard = what;
    throw e;
  }
  /** Run fn armed at time t (the only way in: no enter/exit for a scene to unbalance). */
  function run(t, fn, self, args) {
    const tok = {}, prevT = curT;
    stack[stack.length] = tok;
    if (typeof t === 'number' && numFinite(t)) curT = t;
    try { return rApply(fn, self, args || []); } finally {
      let i = stack.length - 1;
      while (i >= 0 && stack[i] !== tok) i--;
      if (i >= 0) stack.length = i;
      curT = prevT;
    }
  }

  // text drawn on any canvas while armed: { str, canvas, box (that canvas's pixels) | null }, for the runtime's checks
  const TEXT = [];
  let textClaimed = false;
  function takeText() { const out = TEXT.slice(); TEXT.length = 0; return out; }
  /** The runtime claims the text log once, at load, before any scene script; anyone later gets null. */
  function claimText() { if (textClaimed) return null; textClaimed = true; return takeText; }

  defProp(W, '__flptGuard', {
    value: freeze({ version: '1.0.0', run, armed, hits: () => hits.slice(), claimText }),
    writable: false, enumerable: false, configurable: false,
  });

  const define = (obj, key, value) => {
    try { defProp(obj, key, { value, writable: true, configurable: true, enumerable: false }); } catch (e) { try { obj[key] = value; } catch (e2) { /* frozen */ } }
  };
  /** obj[key] throws (or answers `instead`) while armed; passes through otherwise. */
  function armedOnly(obj, key, name, instead) {
    const orig = fnOf(obj, key);
    if (!orig) return;
    define(obj, key, function (...a) {
      if (armed()) return instead ? rApply(instead, this, a) : deny(name);
      return rApply(orig, this, a);
    });
  }
  /** obj[key] always throws (constructors too). */
  function always(obj, key, name) {
    if (!has(obj, key)) return;
    define(obj, key, function () { return deny(name); });
  }
  /** A constructor that throws while armed. */
  function armedCtor(obj, key, name) {
    const C = obj && obj[key];
    if (typeof C !== 'function') return;
    define(obj, key, new RealProxy(C, { construct(T, args, nt) { if (armed()) deny(name); return rConstruct(T, args, nt); }, apply(T, self, args) { if (armed()) deny(name); return rApply(T, self, args); } }));
  }
  function wrapSetter(proto, key, name, allow) {
    const d = proto && getDesc(proto, key);
    if (!d || !d.set) return;
    defProp(proto, key, { get: d.get, set(v) { if (!allow(v, this)) deny(name); return rApply(d.set, this, [v]); }, enumerable: d.enumerable, configurable: true });
  }
  /** A getter that answers value() while armed (a clock reads the frame's time). */
  function armedGetter(proto, key, value) {
    const d = proto && getDesc(proto, key);
    if (!d || !d.get) return;
    defProp(proto, key, { get() { return armed() ? value() : rApply(d.get, this, []); }, set: d.set, enumerable: d.enumerable, configurable: true });
  }

  // ---- time (armed only: HyperFrames needs the real ones)
  for (const k of ['setTimeout', 'setInterval', 'requestAnimationFrame', 'requestIdleCallback', 'queueMicrotask']) armedOnly(W, k, k);
  armedOnly(Date, 'now', 'Date.now', () => EPOCH);
  if (W.performance) {
    armedOnly(W.performance, 'now', 'performance.now', () => curT * 1000);
    for (const k of ['mark', 'measure', 'getEntries', 'getEntriesByName', 'getEntriesByType']) armedOnly(W.Performance ? Performance.prototype : W.performance, k, 'performance.' + k);
    if (W.Performance) armedGetter(Performance.prototype, 'timeOrigin', () => EPOCH);
  }
  if (W.AnimationTimeline) armedGetter(AnimationTimeline.prototype, 'currentTime', () => curT * 1000);
  if (W.Event) armedGetter(Event.prototype, 'timeStamp', () => curT * 1000);
  if (W.Document) armedGetter(Document.prototype, 'lastModified', () => '01/01/2026 00:00:00');
  if (W.Temporal && W.Temporal.Now) for (const k of ownKeys(W.Temporal.Now)) if (typeof k === 'string') armedOnly(W.Temporal.Now, k, 'Temporal.Now');
  if (W.Intl && Intl.DateTimeFormat) {   // format() with no date reads the clock
    const DTF = Intl.DateTimeFormat.prototype, ftp = fnOf(DTF, 'formatToParts'), fmtGet = getterOf(DTF, 'format');
    if (ftp) define(DTF, 'formatToParts', function (d) { if (d === undefined && armed()) deny('Intl.DateTimeFormat (now)'); return rApply(ftp, this, [d]); });
    if (fmtGet) defProp(DTF, 'format', { get() { const f = rApply(fmtGet, this, []); return (d) => (d === undefined && armed() ? deny('Intl.DateTimeFormat (now)') : f(d)); }, enumerable: false, configurable: true });
  }
  const RealDate = W.Date;
  define(W, 'Date', new RealProxy(RealDate, {
    construct(T, args, nt) { return rConstruct(T, !args.length && armed() ? [EPOCH] : args, nt); },
    apply(T, self, args) { return armed() ? new T(EPOCH).toString() : rApply(T, self, args); },
  }));

  // ---- randomness: a scene uses ctx.rng; outside scene code Math.random is seeded (deterministic for everyone)
  let seed = 0x2545f491;
  const prng = () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  define(Math, 'random', function random() { return armed() ? deny('Math.random') : prng(); });
  if (W.crypto) {
    armedOnly(W.crypto, 'getRandomValues', 'crypto.getRandomValues'); armedOnly(W.crypto, 'randomUUID', 'crypto.randomUUID');
    if (W.SubtleCrypto) for (const k of ownKeys(SubtleCrypto.prototype)) if (typeof k === 'string' && k !== 'constructor') armedOnly(SubtleCrypto.prototype, k, 'crypto.subtle');
  }

  // ---- the network and workers: always
  for (const k of ['fetch', 'fetchLater', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'EventSource', 'RTCPeerConnection', 'webkitRTCPeerConnection',
    'RTCDataChannel', 'Worker', 'SharedWorker', 'WebTransport', 'importScripts']) always(W, k, k);
  if (W.navigator) {
    always(W.navigator, 'sendBeacon', 'sendBeacon');
    let sw = null;
    try { sw = W.navigator.serviceWorker; } catch (e) { /* a sandboxed frame without allow-same-origin throws: no service workers there */ }
    if (sw) always(sw, 'register', 'serviceWorker');
  }

  // ---- code from strings, proxies and property tricks: while armed
  const realEval = W.eval;
  if (typeof realEval === 'function') define(W, 'eval', function (src) { if (armed()) deny('eval'); return realEval(src); });
  const codeCtor = (C, name) => new RealProxy(C, {
    apply(T, self, args) { if (armed()) deny(name); return rApply(T, self, args); },
    construct(T, args, nt) { if (armed()) deny(name); return rConstruct(T, args, nt); },
  });
  const FnGuard = codeCtor(RealFunction, 'Function');
  define(W, 'Function', FnGuard);
  define(RealFunction.prototype, 'constructor', FnGuard);
  for (const f of [function* () {}, async function () {}, async function* () {}]) {   // eslint-disable-line no-empty-function
    const P = getProto(f);
    if (P && typeof P.constructor === 'function') define(P, 'constructor', codeCtor(P.constructor, 'Function'));
  }
  const realRevocable = RealProxy.revocable;
  const ProxyGuard = new RealProxy(RealProxy, {
    construct(T, args) { if (armed()) deny('Proxy'); return rConstruct(T, args, T); },
    get(T, k) { return k === 'revocable' ? function revocable(t, h) { if (armed()) deny('Proxy'); return realRevocable(t, h); } : rGet(T, k); },
  });
  define(W, 'Proxy', ProxyGuard);
  armedOnly(Object, 'defineProperty', 'Object.defineProperty');
  armedOnly(Object, 'defineProperties', 'Object.defineProperties');
  armedOnly(Reflect, 'defineProperty', 'Reflect.defineProperty');
  armedOnly(Object.prototype, '__defineGetter__', '__defineGetter__');
  armedOnly(Object.prototype, '__defineSetter__', '__defineSetter__');

  // ---- navigation: always for links, forms, window.open and document.write; HTML strings, risky elements and synthetic
  // events while armed
  always(W, 'open', 'window.open');
  for (const k of ['write', 'writeln']) always(Document.prototype, k, 'document.' + k);
  if (W.HTMLFormElement) { always(HTMLFormElement.prototype, 'submit', 'form submit'); always(HTMLFormElement.prototype, 'requestSubmit', 'form submit'); }
  const click = HTMLElement.prototype.click;
  define(HTMLElement.prototype, 'click', function () {
    if (armed() || this instanceof HTMLAnchorElement || (W.HTMLAreaElement && this instanceof HTMLAreaElement)) return deny('click()');
    return rApply(click, this, []);
  });
  if (W.EventTarget) armedOnly(EventTarget.prototype, 'dispatchEvent', 'dispatchEvent');
  const noHtml = () => !armed();
  wrapSetter(Element.prototype, 'innerHTML', 'innerHTML', noHtml);
  wrapSetter(Element.prototype, 'outerHTML', 'outerHTML', noHtml);
  if (W.ShadowRoot) { wrapSetter(ShadowRoot.prototype, 'innerHTML', 'innerHTML', noHtml); for (const k of ['setHTMLUnsafe', 'setHTML']) armedOnly(ShadowRoot.prototype, k, k); }
  if (W.HTMLIFrameElement) wrapSetter(HTMLIFrameElement.prototype, 'srcdoc', 'srcdoc', () => false);
  for (const k of ['insertAdjacentHTML', 'setHTMLUnsafe', 'setHTML']) armedOnly(Element.prototype, k, k);
  if (W.Document) for (const k of ['parseHTMLUnsafe', 'parseHTML']) armedOnly(Document, k, 'Document.' + k);
  if (W.Range) armedOnly(Range.prototype, 'createContextualFragment', 'createContextualFragment');
  if (W.DOMParser) armedOnly(DOMParser.prototype, 'parseFromString', 'DOMParser');
  // links, forms, frames, scripts, style and anything that plays on its own clock (media, SMIL, marquee)
  const BANNED_TAGS = /^(a|area|form|meta|link|iframe|frame|frameset|base|object|embed|script|portal|fencedframe|style|video|audio|track|marquee|animate|animatemotion|animatetransform|set)$/i;
  for (const k of ['createElement', 'createElementNS']) {
    const orig = Document.prototype[k];
    define(Document.prototype, k, function (...a) {
      const tag = Str(k === 'createElementNS' ? a[1] : a[0]).split(':').pop();
      if (armed() && BANNED_TAGS.test(tag)) return deny(`<${tag}>`);
      return rApply(orig, this, a);
    });
  }

  // ---- pictures and URL-bearing attributes: only a relative path inside the page's folder (or data:/blob:)
  const safeUrl = (v) => {
    const s = Str(v == null ? '' : v).trim();
    if (/^(data|blob):/i.test(s)) return true;
    if (!s || /^[a-z][a-z0-9+.-]*:/i.test(s) || /^[\\/]/.test(s) || /(^|[\\/])\.\.([\\/]|$)/.test(s) || /\s/.test(s)) return false;
    return true;
  };
  /** srcset candidates (a URL is a run of non-space; data: URLs keep their commas). */
  function safeSrcset(v) {
    const s = Str(v == null ? '' : v);
    let i = 0;
    while (i < s.length) {
      while (i < s.length && /[\s,]/.test(s[i])) i++;
      let j = i;
      while (j < s.length && !/\s/.test(s[j])) j++;
      let url = s.slice(i, j);
      i = j;
      if (/,$/.test(url)) url = url.replace(/,+$/, '');
      else { let depth = 0; while (i < s.length && !(s[i] === ',' && depth <= 0)) { if (s[i] === '(') depth++; else if (s[i] === ')') depth--; i++; } }
      if (url && !safeUrl(url)) return false;
    }
    return true;
  }
  /** CSS text: no animation, transition, imports or url()s from elsewhere. */
  function cssOk(v) {
    const s = Str(v == null ? '' : v);
    if (/@import|@keyframes|(^|[\s;{"'])(animation|transition)(-[a-z-]+)?\s*:|expression\s*\(|-moz-binding|behavior\s*:/i.test(s)) return false;
    const re = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;
    let m;
    while ((m = re.exec(s))) if (!safeUrl(m[2])) return false;
    if (/(image-set|image|cross-fade|src)\(\s*["'](?:[a-z][a-z0-9+.-]*:|\/)/i.test(s) && !/(image-set|image|cross-fade|src)\(\s*["'](data|blob):/i.test(s)) return false;
    return true;
  }
  const isPicture = (el) => (W.HTMLImageElement && el instanceof HTMLImageElement) || (W.HTMLSourceElement && el instanceof HTMLSourceElement);
  wrapSetter(HTMLImageElement.prototype, 'src', 'a picture from outside the scene folder', safeUrl);
  wrapSetter(HTMLImageElement.prototype, 'srcset', 'a picture from outside the scene folder', safeSrcset);
  if (W.HTMLSourceElement) { wrapSetter(HTMLSourceElement.prototype, 'src', 'a picture from outside the scene folder', safeUrl); wrapSetter(HTMLSourceElement.prototype, 'srcset', 'a picture from outside the scene folder', safeSrcset); }
  if (W.HTMLMediaElement) wrapSetter(HTMLMediaElement.prototype, 'src', 'media', (v) => !armed() || safeUrl(v));
  if (W.HTMLInputElement) wrapSetter(HTMLInputElement.prototype, 'src', 'a picture from outside the scene folder', (v) => !armed() || safeUrl(v));
  if (W.HTMLVideoElement) wrapSetter(HTMLVideoElement.prototype, 'poster', 'a picture from outside the scene folder', (v) => !armed() || safeUrl(v));
  if (W.HTMLTrackElement) wrapSetter(HTMLTrackElement.prototype, 'src', 'media', (v) => !armed() || safeUrl(v));
  const URL_ATTRS = /^(src|srcset|imagesrcset|href|action|formaction|ping|background|poster|data|codebase|archive|longdesc|lowsrc|dynsrc)$/i;
  /** May attribute `name` of element `el` (null when unknown) hold `value`? Pictures always; the rest while armed. */
  function attrOk(el, name, value) {
    const local = Str(name).toLowerCase().split(':').pop();
    if (local === 'srcdoc') return false;
    if ((local === 'src' || local === 'srcset') && (el == null || isPicture(el))) return local === 'src' ? safeUrl(value) : safeSrcset(value);
    if (!armed()) return true;
    if (local === 'style') return cssOk(value);
    if (URL_ATTRS.test(local)) return /srcset$/.test(local) ? safeSrcset(value) : safeUrl(value);
    if (/^on/.test(local)) return false;
    return true;
  }
  for (const k of ['setAttribute', 'setAttributeNS']) {
    const orig = Element.prototype[k];
    define(Element.prototype, k, function (...a) {
      const name = Str(k === 'setAttributeNS' ? a[1] : a[0]), value = k === 'setAttributeNS' ? a[2] : a[1];
      if (!attrOk(this, name, value)) return deny(`${name}="…"`);
      return rApply(orig, this, a);
    });
  }
  if (W.Attr) {
    const owner = getterOf(Attr.prototype, 'ownerElement'), nameOf = getterOf(Attr.prototype, 'name'), valueOf = getterOf(Attr.prototype, 'value');
    const attrCheck = (attr, v) => attrOk(owner ? rApply(owner, attr, []) : null, nameOf ? rApply(nameOf, attr, []) : '', v);
    wrapSetter(Attr.prototype, 'value', 'an attribute', (v, self) => attrCheck(self, v));
    if (W.Node) for (const k of ['nodeValue', 'textContent']) wrapSetter(Node.prototype, k, 'an attribute', (v, self) => !(self instanceof Attr) || attrCheck(self, v));
    const nodeArg = function (orig, name) {
      return function (attr) {
        if (attr instanceof Attr && !attrOk(this instanceof Element ? this : null, nameOf ? rApply(nameOf, attr, []) : '', valueOf ? rApply(valueOf, attr, []) : '')) deny(name);
        return rApply(orig, this, [attr]);
      };
    };
    for (const k of ['setAttributeNode', 'setAttributeNodeNS']) { const o = fnOf(Element.prototype, k); if (o) define(Element.prototype, k, nodeArg(o, 'setAttributeNode')); }
    if (W.NamedNodeMap) for (const k of ['setNamedItem', 'setNamedItemNS']) { const o = fnOf(NamedNodeMap.prototype, k); if (o) define(NamedNodeMap.prototype, k, nodeArg(o, 'setNamedItem')); }
  }
  // CSS and fonts: url()s from elsewhere, animation and imports refused while armed (named style properties such as
  // el.style.backgroundImage are per-instance in Chrome and can't be wrapped: the lint and the sandbox cover those)
  if (W.CSSStyleDeclaration) {
    wrapSetter(CSSStyleDeclaration.prototype, 'cssText', 'CSS', (v) => !armed() || cssOk(v));
    const sp = fnOf(CSSStyleDeclaration.prototype, 'setProperty');
    if (sp) define(CSSStyleDeclaration.prototype, 'setProperty', function (n, v, p) { if (armed() && !cssOk(`${Str(n)}:${Str(v)}`)) deny('CSS'); return rApply(sp, this, arguments.length > 2 ? [n, v, p] : [n, v]); });
  }
  if (W.CSSStyleSheet) for (const k of ['replace', 'replaceSync', 'insertRule']) armedOnly(CSSStyleSheet.prototype, k, 'a style sheet');
  if (W.Document) wrapSetter(Document.prototype, 'adoptedStyleSheets', 'adoptedStyleSheets', () => !armed());
  if (W.FontFace) {
    const FF = W.FontFace;
    define(W, 'FontFace', new RealProxy(FF, { construct(T, args, nt) { if (armed() && typeof args[1] === 'string' && !cssOk(args[1])) deny('a font from outside the scene folder'); return rConstruct(T, args, nt); } }));
  }

  // ---- other clocks, callbacks on their own schedule, and sound: a scene draws from t and never plays audio
  for (const k of ['MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'PerformanceObserver', 'ReportingObserver', 'PressureObserver', 'MessageChannel',
    'BroadcastChannel', 'AudioContext', 'webkitAudioContext', 'OfflineAudioContext', 'Notification', 'FinalizationRegistry']) armedCtor(W, k, k);
  if (W.HTMLMediaElement) armedOnly(HTMLMediaElement.prototype, 'play', 'play()');
  if (W.Element && Element.prototype.animate) armedOnly(Element.prototype, 'animate', 'Element.animate');
  if (W.HTMLCanvasElement) armedOnly(HTMLCanvasElement.prototype, 'toBlob', 'canvas.toBlob');
  if (W.HTMLVideoElement) armedOnly(HTMLVideoElement.prototype, 'requestVideoFrameCallback', 'requestVideoFrameCallback');
  if (W.Document) armedOnly(Document.prototype, 'startViewTransition', 'startViewTransition');
  if (W.CustomElementRegistry) armedOnly(CustomElementRegistry.prototype, 'define', 'customElements.define');
  if (W.scheduler) armedOnly(getProto(W.scheduler), 'postTask', 'scheduler.postTask');

  // ---- callbacks registered while armed run armed (listeners, on* handlers, promise reactions)
  const wrappedFns = new WMap();
  function armedFn(fn) {
    let w = wrappedFns.get(fn);
    if (!w) {
      w = function (...a) { return typeof fn === 'function' ? run(curT, fn, this, a) : run(curT, fn.handleEvent, fn, a); };
      wrappedFns.set(fn, w);
    }
    return w;
  }
  const ael = EventTarget.prototype.addEventListener, rel = EventTarget.prototype.removeEventListener;
  define(EventTarget.prototype, 'addEventListener', function (type, fn, opts) {
    return rApply(ael, this, [type, fn && (typeof fn === 'function' || typeof fn === 'object') && armed() ? armedFn(fn) : fn, opts]);
  });
  define(EventTarget.prototype, 'removeEventListener', function (type, fn, opts) { return rApply(rel, this, [type, (fn && wrappedFns.get(fn)) || fn, opts]); });
  function wrapHandlers(target) {
    for (const k of ownKeys(target)) {
      if (typeof k !== 'string' || k[0] !== 'o' || k[1] !== 'n') continue;
      const d = getDesc(target, k);
      if (!d || !d.set || !d.configurable) continue;
      defProp(target, k, { get: d.get, set(v) { return rApply(d.set, this, [typeof v === 'function' && armed() ? armedFn(v) : v]); }, enumerable: d.enumerable, configurable: true });
    }
  }
  if (W.EventTarget) {
    wrapHandlers(W);
    for (const k of ownKeys(W)) {
      if (typeof k !== 'string') continue;
      const d = getDesc(W, k), C = d && d.value;
      if (typeof C === 'function' && C.prototype && C.prototype instanceof EventTarget) wrapHandlers(C.prototype);
    }
  }
  const pthen = Promise.prototype.then;
  define(Promise.prototype, 'then', function (a, b) {
    if (!armed()) return rApply(pthen, this, [a, b]);
    return rApply(pthen, this, [typeof a === 'function' ? armedFn(a) : a, typeof b === 'function' ? armedFn(b) : b]);
  });

  // ---- the text a scene draws on any canvas (raw fillText / strokeText included), recorded while armed
  for (const C of [W.CanvasRenderingContext2D, W.OffscreenCanvasRenderingContext2D]) {
    const P = C && C.prototype;
    if (!P) continue;
    const measure = fnOf(P, 'measureText'), getT = fnOf(P, 'getTransform'), alignOf = getterOf(P, 'textAlign'), canvasOf = getterOf(P, 'canvas');
    for (const k of ['fillText', 'strokeText']) {
      const orig = fnOf(P, k);
      if (!orig) continue;
      define(P, k, function (text, x, y, maxW) {
        if (TEXT.length < 5000 && armed()) {
          const str = Str(text);
          let box = null;
          try {
            const m = rApply(measure, this, [str]), w0 = m.width, w = maxW != null && maxW < w0 ? Number(maxW) : w0;
            const align = alignOf ? rApply(alignOf, this, []) : 'start';
            const left = numFinite(m.actualBoundingBoxLeft) ? -m.actualBoundingBoxLeft * (w / (w0 || 1)) : align === 'center' ? -w / 2 : align === 'right' || align === 'end' ? -w : 0;
            const right = numFinite(m.actualBoundingBoxRight) ? m.actualBoundingBoxRight * (w / (w0 || 1)) : left + w;
            const T = getT ? rApply(getT, this, []) : { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
            const px = Number(x), py = Number(y), top = py - (m.actualBoundingBoxAscent || 0), bot = py + (m.actualBoundingBoxDescent || 0);
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            for (const [cx, cy] of [[px + left, top], [px + right, top], [px + left, bot], [px + right, bot]]) {
              const sx = T.a * cx + T.c * cy + T.e, sy = T.b * cx + T.d * cy + T.f;
              if (sx < x0) x0 = sx; if (sx > x1) x1 = sx; if (sy < y0) y0 = sy; if (sy > y1) y1 = sy;
            }
            if (numFinite(x0) && numFinite(y0)) box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
          } catch (e) { box = null; }
          TEXT[TEXT.length] = { str, canvas: canvasOf ? rApply(canvasOf, this, []) : this.canvas, box };
        }
        return rApply(orig, this, maxW === undefined ? [text, x, y] : [text, x, y, maxW]);
      });
    }
  }

  // ---- no CSS animation or transition (a constructed sheet: CSP-proof, no inline <style> needed)
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('*,*::before,*::after{animation:none!important;transition:none!important}');
    D.adoptedStyleSheets = [...D.adoptedStyleSheets, sheet];
  } catch (e) { /* very old engine: the lint still bans CSS animation */ }

  // ---- lock the page's intrinsics (the last step, before any other script runs)
  // Data properties people assign on their own objects (obj.toString = …, X.prototype.constructor = X) become accessors
  // that define an own property instead (the "override mistake"), so freezing these prototypes breaks nobody.
  function tame(proto, keys) {
    for (const k of keys) {
      const d = proto && getDesc(proto, k);
      if (!d || !('value' in d) || !d.configurable) continue;
      const value = d.value;
      defProp(proto, k, {
        get() { return value; },
        set(v) { if (this === proto) deny(`${k} on a shared prototype`); defProp(this, k, { value: v, writable: true, enumerable: true, configurable: true }); },
        enumerable: d.enumerable, configurable: false,
      });
    }
  }
  tame(Object.prototype, ['constructor', 'toString', 'valueOf', 'toLocaleString']);
  tame(RealFunction.prototype, ['toString', 'constructor']);
  tame(Array.prototype, ['constructor', 'toString']);
  tame(Promise.prototype, ['constructor']);
  const lockObj = (o) => { if (o && (typeof o === 'object' || typeof o === 'function') && !isFrozen(o)) { try { freeze(o); } catch (e) { /* exotic */ } } };
  if (W.Intl && Intl.DateTimeFormat) lockObj(Intl.DateTimeFormat.prototype);
  const typed = typeof Uint8Array === 'function' ? [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array,
    typeof BigInt64Array === 'function' ? BigInt64Array : null, typeof BigUint64Array === 'function' ? BigUint64Array : null, typeof Float16Array === 'function' ? Float16Array : null].filter(Boolean) : [];
  const gens = [function* () {}, async function () {}, async function* () {}].map(getProto);   // eslint-disable-line no-empty-function
  const iterProto = getProto(getProto([][Symbol.iterator]()));
  const jsNs = [Object, Array, Promise, Math, JSON, Reflect, Number, String, Boolean, Symbol, Map, Set, WeakMap, WeakSet, ArrayBuffer, DataView, RealDate,
    typeof BigInt === 'function' ? BigInt : null, typeof Atomics === 'object' ? Atomics : null, typeof Intl === 'object' ? Intl : null, typeof WeakRef === 'function' ? WeakRef : null,
    typeof Iterator === 'function' ? Iterator : null, ...typed, typed.length ? getProto(Uint8Array) : null];
  const jsProtos = [Object.prototype, Array.prototype, RealFunction.prototype, Promise.prototype, String.prototype, Number.prototype, Boolean.prototype, Symbol.prototype,
    RegExp.prototype, Map.prototype, Set.prototype, WeakMap.prototype, WeakSet.prototype, ArrayBuffer.prototype, DataView.prototype, RealDate.prototype, iterProto,
    getProto([][Symbol.iterator]()), ...gens, ...gens.map((g) => g && g.prototype), ...typed.map((T) => T.prototype), typed.length ? getProto(Uint8Array.prototype) : null];
  for (const o of [...jsNs, ...jsProtos]) lockObj(o);
  // the DOM and canvas interfaces scene objects inherit from (instances stay extensible; their methods can't be shadowed
  // by assignment, and defineProperty is refused while armed)
  const DOM = ['EventTarget', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'CharacterData', 'Text', 'Comment', 'Document', 'HTMLDocument', 'DocumentFragment', 'ShadowRoot',
    'HTMLCanvasElement', 'CanvasRenderingContext2D', 'OffscreenCanvas', 'OffscreenCanvasRenderingContext2D', 'Path2D', 'CanvasGradient', 'CanvasPattern', 'ImageData', 'ImageBitmap', 'TextMetrics',
    'HTMLImageElement', 'HTMLSourceElement', 'HTMLMediaElement', 'HTMLVideoElement', 'HTMLDivElement', 'HTMLSpanElement', 'HTMLParagraphElement', 'HTMLBRElement', 'HTMLBodyElement',
    'HTMLScriptElement', 'HTMLInputElement', 'Event', 'CustomEvent', 'MessageEvent', 'UIEvent', 'MouseEvent', 'ErrorEvent', 'PromiseRejectionEvent', 'FontFace', 'FontFaceSet',
    'Range', 'AbstractRange', 'StaticRange', 'Selection', 'DOMRectReadOnly', 'DOMRect', 'DOMRectList', 'DOMMatrixReadOnly', 'DOMMatrix', 'DOMPointReadOnly', 'DOMPoint',
    'CSSStyleDeclaration', 'CSSStyleSheet', 'StyleSheet', 'MediaList', 'Attr', 'NamedNodeMap', 'DOMTokenList', 'DOMStringMap', 'NodeList', 'HTMLCollection',
    'AnimationTimeline', 'DocumentTimeline', 'Animation', 'Performance', 'Crypto', 'SubtleCrypto', 'Navigator', 'History', 'Screen', 'VisualViewport', 'MediaQueryList',
    'Scheduler', 'CustomElementRegistry', 'Window', 'Location', 'Blob', 'File', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'AbortController', 'AbortSignal'];
  for (const k of DOM) { const d = getDesc(W, k), C = d && d.value; if (typeof C === 'function') { lockObj(C.prototype); lockObj(C); } }
  // the global bindings trusted code calls can't be reassigned (window['Math'] = …, setTimeout = …)
  const GLOBALS = ['Object', 'Array', 'Function', 'Promise', 'Math', 'JSON', 'Reflect', 'Proxy', 'Number', 'String', 'Boolean', 'Symbol', 'BigInt', 'Atomics', 'Intl',
    'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'FinalizationRegistry', 'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Iterator', 'Date', 'RegExp', 'Error', 'TypeError', 'RangeError',
    'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float16Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array',
    'eval', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI', 'escape', 'unescape', 'globalThis', 'structuredClone',
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'queueMicrotask',
    'fetch', 'fetchLater', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'EventSource', 'RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'Worker', 'SharedWorker',
    'WebTransport', 'importScripts', 'open', 'getComputedStyle', 'postMessage', 'performance', 'crypto', 'navigator', 'console', 'Image', 'Audio', 'Option',
    'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'PerformanceObserver', 'ReportingObserver', 'PressureObserver', 'MessageChannel', 'BroadcastChannel',
    'AudioContext', 'webkitAudioContext', 'OfflineAudioContext', 'Notification', 'customElements', 'scheduler', 'Temporal', ...DOM];
  for (const k of GLOBALS) {
    const d = getDesc(W, k);
    if (!d || !d.configurable) continue;
    try {
      if ('value' in d) defProp(W, k, { value: d.value, writable: false, enumerable: d.enumerable, configurable: false });
      else defProp(W, k, { get: d.get, set: undefined, enumerable: d.enumerable, configurable: false });
    } catch (e) { /* an exotic binding: left as it is */ }
  }
})();
