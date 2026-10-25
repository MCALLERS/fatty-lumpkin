'use strict';
/* global FLPT_UI */
// ui-hero.js · the Welcome hero (PLAN §3.3 S0; W3-04): Fatty Lumpkin's valley, live. It runs FLPT's own flpt-live scene
// (assets/hero/hero-scene.js) through the trusted inline host (vendor/flpt-live/host-inline.js) under the app's CSP:
// everything from 'self', no fetch, no guard. Mounted while the Welcome screen shows and gone when it doesn't, so it
// costs nothing elsewhere. Pause motion, the system's reduced motion and a hidden or blurred window hold its poster
// (the painting at rest); on a fine pointer the cursor adds to the parallax and parts the seeds.
(() => {
  const UI = window.FLPT_UI;
  if (!UI) return;
  const HOST = 'vendor/flpt-live/host-inline.js';
  const DEF = 'assets/hero/hero.js';
  const loaded = new Map();
  const load = (src) => {
    if (!loaded.has(src)) {
      loaded.set(src, new Promise((ok, fail) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => ok();
        s.onerror = () => fail(new Error(`${src} didn't load`));
        document.head.append(s);
      }));
    }
    return loaded.get(src);
  };

  let ctl = null; // the mounted hero (FLPTInline's controller)
  let mounting = null;
  let stage = null;
  const fine = matchMedia('(pointer: fine)');
  // the pointer, smoothed (a critically damped spring): the scene reads window.FLPTHeroInput
  const input = window.FLPTHeroInput = { x: 0, y: 0, on: 0 };
  const want = { x: 0, y: 0, on: 0 };
  const vel = { x: 0, y: 0, on: 0 };
  let raf = 0;
  let last = 0;
  function follow(now) {
    raf = 0;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
    last = now;
    let moving = false;
    for (const k of ['x', 'y', 'on']) {
      const w = k === 'on' ? 5 : 6; // the spring's speed (rad/s)
      const a = w * w * (want[k] - input[k]) - 2 * w * vel[k];
      vel[k] += a * dt;
      input[k] += vel[k] * dt;
      if (Math.abs(want[k] - input[k]) > 0.001 || Math.abs(vel[k]) > 0.001) moving = true;
    }
    if (moving && ctl && !UI.motionHeld()) raf = requestAnimationFrame(follow); else last = 0;
  }
  const nudge = () => { if (!raf && ctl && !UI.motionHeld()) raf = requestAnimationFrame(follow); };
  function onMove(e) {
    if (!fine.matches || !stage) return;
    const box = (ctl && ctl.element) || stage;
    const r = box.getBoundingClientRect();
    if (!r.width || !r.height) return;
    want.x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
    want.y = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
    want.on = 1;
    nudge();
  }
  function onLeave() { want.on = 0; want.x = 0; want.y = 0; nudge(); }

  const shown = () => Boolean(stage && stage.isConnected && stage.getClientRects().length);
  async function mount() {
    if (ctl || mounting || !shown()) return;
    mounting = (async () => {
      try {
        await load(HOST);
        await load(DEF);
        if (!shown()) return;
        ctl = await window.FLPTInline.mount(stage, 'hero', { clock: 'raf', loop: true, poster: 0 });
        window.__flptHero = ctl; // QA reads its state()
        stage.classList.add('is-live');
        // Welcome may have gone while the scene loaded: nothing else would take it down
        if (!shown()) { unmount(); return; }
        hold();
      } catch (e) {
        console.error(e); // eslint-disable-line no-console
        stage.classList.add('is-still'); // the painting as a picture: the screen still reads
      } finally { mounting = null; }
      sync(); // and back, if it came back meanwhile
    })();
  }
  function unmount() {
    if (!ctl) return;
    ctl.destroy();
    ctl = null;
    window.__flptHero = null;
    stage.classList.remove('is-live');
  }
  // Pause motion and reduced motion are the host's own (it watches .fx-paused); a hidden or blurred window is ours.
  function hold() {
    if (!ctl) return;
    if (UI.motionHeld()) ctl.pause(); else { ctl.play(); nudge(); }
  }
  function sync() { if (shown()) mount(); else unmount(); }

  document.addEventListener('DOMContentLoaded', () => {
    stage = document.querySelector('.welcome-stage');
    if (!stage) return;
    const section = stage.closest('.screen');
    section.addEventListener('pointermove', onMove);
    section.addEventListener('pointerleave', onLeave);
    // shown when the Welcome step is active in a visible Setup view
    const mo = new MutationObserver(sync);
    mo.observe(section, { attributes: true, attributeFilter: ['class'] });
    for (let n = section.parentElement; n && n !== document.body; n = n.parentElement) mo.observe(n, { attributes: true, attributeFilter: ['class', 'hidden'] });
    document.addEventListener('flpt:motion', hold);
    sync();
  });
  UI.components.hero = { state: () => (ctl ? ctl.state() : null), input };
})();
