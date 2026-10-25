/* host-preview.js · the Stage's host inside the scene frame, 1.0.0 (FLPT V2, PLAN §2.5).
 *
 * The Stage harness holds the scene page in <iframe sandbox="allow-scripts"> (an opaque origin) and drives it with
 * postMessage; this script answers. guard.js is on the page, so the scene runs armed as in a render. Only messages
 * from the parent window are read; numbers are clamped, ids kept short, anything else ignored. The page loads this
 * before any scene script (guard.js has locked the intrinsics by then): its listeners, the stage canvas and the
 * functions it calls are fixed before scene code runs; it boots the scene once every script has run.
 *
 * parent -> scene   { flpt: 'live', op: 'seek',   id, t, quality }   draw (coalesced to the next animation frame)
 *                   { flpt: 'live', op: 'meta',   id }               the scene's meta
 *                   { flpt: 'live', op: 'boxes',  id, t }            text boxes at t (ctx.text, registered, DOM layer, raw)
 *                   { flpt: 'live', op: 'text',   id, t }            every string on screen at t, for the text report
 *                   { flpt: 'live', op: 'pixels', id, t }            the canvas at t (RGBA, transferred), for "Snapshot this frame"
 * scene -> parent   { flpt: 'live', op: 'ready', meta }  once, after setup
 *                   { flpt: 'live', op: 'drawn', id, t, F, ms }      F = the frame drawn (hold and twos included);
 *                                                                    ms = the draw on this machine, raster included
 *                   { flpt: 'live', op: 'meta' | 'boxes' | 'text' | 'pixels', id, ... }
 *                   { flpt: 'live', op: 'error', code: 'setup' | 'frame' | 'script', msg }   msg ≤ 200 characters
 * boxes, text and pixels draw their own time, then put the last seek's picture back (no 'drawn' for those).
 * quality 'preview' and 'half' reach the scene as ctx.quality; in 1.0.0 every quality draws at full size (ctx.scale 1).
 */
(() => {
  'use strict';
  const F = window.FLPT;
  const parent = window.parent;
  const stageEl = document.getElementById('stage');
  const post = (m, transfer) => { try { parent.postMessage({ flpt: 'live', ...m }, '*', transfer || []); } catch (e) { /* the harness is gone */ } };
  const short = (s) => String((s && s.message) || s || '').replace(/\s+/g, ' ').slice(0, 200);
  const cleanId = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' ? v.slice(0, 64) : null);
  if (!F || F.runtime !== 'flpt-live') { post({ op: 'error', code: 'script', msg: 'flpt-live.js is not on the page' }); return; }
  window.addEventListener('error', (e) => post({ op: 'error', code: 'script', msg: short(e.message || e.error) }));
  window.addEventListener('unhandledrejection', (e) => post({ op: 'error', code: 'script', msg: short(e.reason) }));

  let ready = false, dur = 0, stage = null, last = null;
  const clampT = (t) => { const x = Number(t); return Number.isFinite(x) ? Math.max(0, Math.min(dur, x)) : 0; };
  const QUALITY = new Set(['final', 'preview', 'half']);
  let pending = null, scheduled = false;

  function drawPending() {
    scheduled = false;
    const m = pending;
    pending = null;
    if (!m || !ready) return;
    const t = clampT(m.t), quality = QUALITY.has(m.quality) ? m.quality : 'preview', a = performance.now();
    try {
      const r = F.__drawAt(t, quality);
      stage.getImageData(0, 0, 1, 1);   // Chrome defers canvas raster: one pixel back makes ms include it (K6)
      last = { t, quality };
      post({ op: 'drawn', id: m.id, t, F: r.F, ms: +(performance.now() - a).toFixed(2) });
    } catch (e) { post({ op: 'error', code: 'frame', msg: short(e) }); }
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    let done = false;
    const go = () => { if (!done) { done = true; drawPending(); } };
    requestAnimationFrame(go);
    setTimeout(go, 50);   // a hidden frame gets no animation frames
  }
  /** Put the Stage's picture back after a read at another time. */
  const restore = () => { if (last) F.__drawAt(last.t, last.quality); };

  window.addEventListener('message', (e) => {
    if (e.source !== parent) return;
    const m = e.data;
    if (!m || m.flpt !== 'live' || typeof m.op !== 'string') return;
    const id = cleanId(m.id);
    if (!ready && m.op !== 'meta') return;
    try {
      if (m.op === 'seek') { pending = { id, t: m.t, quality: m.quality }; schedule(); }
      else if (m.op === 'meta') { if (ready) post({ op: 'meta', id, meta: F.meta() }); }
      else if (m.op === 'boxes') { const t = clampT(m.t), boxes = F.textBoxes(t); restore(); post({ op: 'boxes', id, t, boxes }); }
      else if (m.op === 'text') { const t = clampT(m.t), text = F.drawnText(t); restore(); post({ op: 'text', id, t, text }); }
      else if (m.op === 'pixels') {
        const t = clampT(m.t);
        F.__drawAt(t, 'final');
        const d = stage.getImageData(0, 0, stageEl.width, stageEl.height);
        restore();
        post({ op: 'pixels', id, t, w: d.width, h: d.height, data: d.data.buffer }, [d.data.buffer]);
      }
    } catch (err) { post({ op: 'error', code: 'frame', msg: short(err) }); }
  });

  document.addEventListener('DOMContentLoaded', () => {
    F.__boot().then(() => {
      ready = true;
      dur = F.duration;
      stage = stageEl.getContext('2d');
      F.__drawAt(0, 'preview');
      last = { t: 0, quality: 'preview' };
      const meta = F.meta();
      post({ op: 'ready', meta: { duration: meta.duration, fps: meta.fps, beats: meta.beats, keyframes: meta.keyframes, hits: meta.hits, hold: meta.hold, ones: meta.ones, placement: meta.placement, style: meta.style, runtime: meta.runtime } });
    }, (e) => post({ op: 'error', code: 'setup', msg: short(e) }));
  });
})();
