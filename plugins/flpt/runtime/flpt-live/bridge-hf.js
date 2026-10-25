/* bridge-hf.js · the HyperFrames host for flpt-live, 1.0.0 (FLPT V2, PLAN §2.3; spike K1).
 * HyperFrames 0.8.80 dispatches window CustomEvent('hf-seek', { detail: { time, waitUntil } }) for every captured
 * frame (time = n / 30) and waits for every promise handed to waitUntil, which must be called synchronously. No
 * timeline library and no __timelines shim: the host page's root carries data-no-timeline, HyperFrames' own opt-out.
 *
 * The page loads this before any scene script (guard.js has locked the page's intrinsics by then): its listeners and
 * the functions it calls are fixed before scene code runs, and it boots the scene once every script has run. */
(() => {
  'use strict';
  const F = window.FLPT;
  if (!F || F.runtime !== 'flpt-live') throw new Error('bridge-hf.js: flpt-live.js is not on the page');
  const log = console.error.bind(console);
  const msg = (err) => (err && err.message ? err.message : String(err));
  let ready = null, isReady = false;
  function boot() {
    if (!ready) {
      ready = F.__boot();
      // frame 0 as soon as the scene is ready, so nothing captured before the first seek is ever blank
      ready.then(() => { isReady = true; F.__drawAt(0); }, (err) => { log('[flpt-live] setup failed:', msg(err)); });
    }
    return ready;
  }
  document.addEventListener('DOMContentLoaded', () => { boot(); });
  window.addEventListener('hf-seek', (e) => {
    const d = e.detail || {};
    const t = Number(d.time) || 0;
    const wait = typeof d.waitUntil === 'function' ? d.waitUntil : null;
    if (!isReady) { const p = boot().then(() => F.__drawAt(t)); if (wait) wait(p); return; }
    try { F.__drawAt(t); } catch (err) {
      // a frame that throws (a guard trip, a scene bug) fails the render instead of leaving a stale picture
      log('[flpt-live] frame failed at', t, msg(err));
      if (wait) wait(Promise.reject(err)); else throw err;
    }
  });
})();
