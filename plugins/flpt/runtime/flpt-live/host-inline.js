/* host-inline.js · the trusted host for FLPT's own scenes, 1.0.0 (FLPT V2, PLAN §2.3).
 *
 * Runs a scene inside an ordinary page: the app's renderer (vendor/flpt-live/, under the app's CSP: script-src 'self',
 * no fetch) and the landing page. No guard.js here (it poisons the timers this clock needs), so it is for FLPT's own
 * scenes only, never crew, Mine or Shared code.
 *
 *   FLPTInline.define(name, { scene, duration, beats, files, kits })   URLs relative to the defining script
 *   const c = await FLPTInline.mount(container, name | spec, { clock: 'raf' | 'scroll' | 'none', loop, rate, poster })
 *   c.play() · c.pause() · c.seek(t) · c.destroy() · c.instance · c.state()
 *
 * The clock: 'raf' plays in real time (looping by default); 'scroll' maps the container's way through the viewport to
 * 0..duration; 'none' draws only on seek(). Reduced motion (prefers-reduced-motion) and the app's Pause motion
 * (.fx-paused on <html>) hold the poster frame; offscreen, nothing draws. flpt-live.js and kits.js load from this
 * script's own folder when the page hasn't loaded them.
 */
(function () {
  'use strict';
  if (window.FLPTInline) return;
  const SELF = document.currentScript && document.currentScript.src ? document.currentScript.src : location.href;
  const DEFS = new Map();
  const abs = (url, base) => new URL(url, base).href;
  const loaded = new Map();
  function loadScript(src) {
    if (loaded.has(src)) return loaded.get(src);
    const p = new Promise((ok, fail) => {
      const s = document.createElement('script');
      s.src = src; s.async = false;
      s.onload = () => ok(); s.onerror = () => fail(new Error(`not loaded: ${src}`));
      document.head.appendChild(s);
    });
    loaded.set(src, p);
    return p;
  }
  let queue = Promise.resolve();
  /** Scene scripts load one at a time, so each FLPT.scene() call is captured by the right mount. */
  function captureScene(src) {
    const run = queue.then(() => new Promise((ok, fail) => {
      const F = window.FLPT;
      let def = null;
      F.__captureScenes((d) => { def = d; });
      const s = document.createElement('script');
      s.src = src; s.async = false;
      const done = (err) => { F.__captureScenes(null); s.remove(); if (err) fail(err); else if (!def) fail(new Error(`${src} never called FLPT.scene`)); else ok(def); };
      s.onload = () => done(); s.onerror = () => done(new Error(`not loaded: ${src}`));
      document.head.appendChild(s);
    }));
    queue = run.catch(() => {});
    return run;
  }
  async function runtime() {
    if (!(window.FLPT && window.FLPT.runtime === 'flpt-live')) await loadScript(abs('flpt-live.js', SELF));
    if (!Object.keys(window.FLPT.kit).length) await loadScript(abs('kits.js', SELF)).catch(() => {});
  }

  const motionHeld = () => document.documentElement.classList.contains('fx-paused') || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  async function mount(container, spec, opts = {}) {
    const s = typeof spec === 'string' ? DEFS.get(spec) : spec;
    if (!s || !s.scene) throw new Error(`FLPTInline: no scene "${spec}"`);
    await runtime();
    for (const k of s.kits || []) await loadScript(k);
    if (s.files) await loadScript(s.files);
    const def = await captureScene(s.scene);

    const box = document.createElement('div');
    box.style.cssText = 'position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;';
    const canvas = document.createElement('canvas');
    canvas.width = 1920; canvas.height = 1080;
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
    const dom = document.createElement('div');
    dom.style.cssText = 'position:absolute;left:0;top:0;width:1920px;height:1080px;transform-origin:0 0;pointer-events:none;';
    box.append(canvas, dom);
    container.appendChild(box);
    const fit = () => { const w = box.clientWidth || 1920; dom.style.transform = `scale(${w / 1920})`; };
    const ro = window.ResizeObserver ? new ResizeObserver(fit) : null;
    if (ro) ro.observe(box);
    fit();

    const inst = window.FLPT.mount(def, { canvas, dom, duration: s.duration, beats: s.beats, files: s.files, fontBase: s.fontBase || abs('fonts/', s.scene) });
    await inst.boot();
    const dur = inst.duration;
    const clock = opts.clock || 'raf', loop = opts.loop !== false, rate = Number(opts.rate) || 1;
    const meta = inst.meta();
    const poster = Math.max(0, Math.min(dur, opts.poster != null ? Number(opts.poster) : meta.keyframes[0] != null ? meta.keyframes[0] : dur / 2));
    let playing = clock === 'raf', visible = true, raf = 0, t = 0, t0 = performance.now(), lastF = -1;

    const draw = (tt) => { const f = inst.frameFor(tt); if (f !== lastF) { inst.drawAt(tt, 'preview'); lastF = f; } t = tt; };
    function tick(now) {
      raf = 0;
      if (!playing || !visible || motionHeld()) return;
      let tt = ((now - t0) / 1000) * rate;
      if (tt >= dur) { if (loop) { t0 = now; tt = 0; } else { tt = dur; playing = false; } }
      draw(tt);
      if (playing) raf = requestAnimationFrame(tick);
    }
    const start = () => { if (!raf && playing && visible && !motionHeld()) { t0 = performance.now() - (t / rate) * 1000; raf = requestAnimationFrame(tick); } };
    function onScroll() {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = box.getBoundingClientRect(), vh = window.innerHeight || 1;
        const u = Math.max(0, Math.min(1, (vh - r.top) / (vh + r.height)));
        draw(motionHeld() ? poster : u * dur);
      });
    }
    const held = () => { if (motionHeld()) { if (raf) { cancelAnimationFrame(raf); raf = 0; } draw(poster); } else if (clock === 'raf') start(); else if (clock === 'scroll') onScroll(); };
    const mo = new MutationObserver(held);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    if (mq && mq.addEventListener) mq.addEventListener('change', held);
    const io = window.IntersectionObserver ? new IntersectionObserver((es) => { visible = es.some((x) => x.isIntersecting); if (visible) held(); }) : null;
    if (io) io.observe(box);
    if (clock === 'scroll') window.addEventListener('scroll', onScroll, { passive: true });

    draw(motionHeld() || clock !== 'raf' ? poster : 0);
    if (clock === 'scroll') onScroll(); else held();
    return {
      instance: inst, element: box,
      play() { playing = true; start(); },
      pause() { playing = false; if (raf) { cancelAnimationFrame(raf); raf = 0; } },
      seek(tt) { draw(Math.max(0, Math.min(dur, Number(tt) || 0))); },
      state: () => ({ t, playing, visible, held: motionHeld(), duration: dur, frame: lastF }),
      destroy() {
        playing = false;
        if (raf) cancelAnimationFrame(raf);
        mo.disconnect(); if (ro) ro.disconnect(); if (io) io.disconnect();
        if (mq && mq.removeEventListener) mq.removeEventListener('change', held);
        window.removeEventListener('scroll', onScroll);
        box.remove();
      },
    };
  }

  window.FLPTInline = Object.freeze({
    version: '1.0.0',
    define(name, spec) {
      const base = document.currentScript && document.currentScript.src ? document.currentScript.src : location.href;
      const r = (u) => (u ? abs(u, base) : u);
      DEFS.set(String(name), { ...spec, scene: r(spec.scene), files: r(spec.files), kits: (spec.kits || []).map(r), fontBase: spec.fontBase ? r(spec.fontBase) : undefined });
    },
    mount,
  });
})();
