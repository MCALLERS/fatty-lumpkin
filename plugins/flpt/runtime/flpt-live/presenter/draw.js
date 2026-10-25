// draw.js · the cartoon presenter's drawer (PLAN §2.12, spike K7). A classic script (no imports, no clocks, no randomness): the same file
// runs in the render page, a Stage preview or a Live Motion scene. Everything on screen is a pure function of
// (rig, layer pictures, state). Exposes globalThis.FLPTPresenter = { stateAt, drawPresenter, layerFiles }.
(function (root) {
  'use strict';

  /** The layer files a rig needs, as { key: file } (key = layer id, or "<layer id>:<state>" for swap layers). */
  function layerFiles(rig) {
    const out = {};
    for (const L of rig.layers) {
      if (L.type === 'swap') for (const [k, f] of Object.entries(L.states)) out[`${L.id}:${k}`] = f;
      else out[L.id] = L.src;
    }
    return out;
  }

  const EYE = { o: 'open', h: 'half', c: 'closed' };
  const MOUTH_CODE = { s: 'smile', l: 'laugh' }; // one char per frame in track.mouth; A–H and X are themselves

  /** Frame f of a compiled track (flpt.track/1) → the drawer's state. */
  function stateAt(track, f) {
    const i = Math.max(0, Math.min(track.frames - 1, f | 0));
    const m = track.mouth[i];
    const h = track.head[i];
    return {
      mouth: MOUTH_CODE[m] || m,
      eyes: EYE[track.eyes[i]] || 'open',
      head: { rot: h[0], dx: h[1], dy: h[2], s: h[3] },
      pupils: track.pupils[i],
      brows: track.brows[i],
    };
  }

  const rad = (d) => (d * Math.PI) / 180;

  /**
   * Draw one frame. `pics` maps the keys of layerFiles(rig) to decoded pictures (ImageBitmap, HTMLImageElement or
   * canvas) drawn over the rig's whole canvas, or to { img, x, y, w, h } crops placed in canvas units. The body (bust + head) breathes by scaling about the
   * bottom centre; the head turns about its pivot; pupils, brows and mouth ride on the head. rig.camera frames the
   * whole figure (scale about a focus point), so one rig can be framed for the bubble or for a scene.
   */
  function drawPresenter(ctx, state, rig, pics) {
    const W = rig.canvas.w, H = rig.canvas.h;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = rig.smoothing || 'low'; // layers are rasterised at the drawn scale, so bilinear is enough
    ctx.fillStyle = rig.background.value;
    ctx.fillRect(0, 0, W, H);
    const layers = rig.layers.slice().sort((a, b) => a.z - b.z);
    const byId = Object.fromEntries(layers.map((L) => [L.id, L]));
    const head = byId.head;
    const eyesL = layers.find((L) => L.id === 'eyes');
    const s = state.head.s || 1;
    const cam = rig.camera || { scale: 1, focus: [W / 2, H / 2] };
    const camT = () => { ctx.translate(W / 2, H / 2); ctx.scale(cam.scale, cam.scale); ctx.translate(-cam.focus[0], -cam.focus[1]); };
    const body = () => { ctx.translate(W / 2, H); ctx.scale(s, s); ctx.translate(-W / 2, -H); };
    const headT = () => {
      const [px, py] = head.pivot;
      ctx.translate(state.head.dx, state.head.dy);
      ctx.translate(px, py); ctx.rotate(rad(state.head.rot)); ctx.translate(-px, -py);
    };
    // a picture is either full-canvas, or { img, x, y, w, h }: a layer cropped to what it covers (faster)
    const put = (key) => {
      const p = pics[key];
      if (!p) return;
      if (p.img) ctx.drawImage(p.img, p.x, p.y, p.w, p.h); else ctx.drawImage(p, 0, 0, W, H);
    };

    for (const L of layers) {
      ctx.save();
      camT();
      if (!L.static) body();
      if (L.parent === 'head' || L.id === 'head') headT();
      if (L.id === 'eyes') {
        put(`eyes:${state.eyes === 'closed' ? 'closed' : 'open'}`);
      } else if (L.id === 'pupils') {
        if (!(eyesL.hidesPupils || []).includes(state.eyes)) {
          ctx.beginPath();
          for (const c of L.clip || []) { ctx.moveTo(c.cx + c.rx, c.cy); ctx.ellipse(c.cx, c.cy, c.rx, c.ry, 0, 0, Math.PI * 2); }
          if (L.clip) ctx.clip();
          ctx.translate(state.pupils[0], state.pupils[1]);
          put('pupils');
        }
        ctx.restore(); ctx.save();
        camT();
        if (!L.static) body();
        headT();
        if ((eyesL.overPupils || []).includes(state.eyes)) put(`eyes:${state.eyes}`);
      } else if (L.id === 'brows') {
        const [px, py] = L.pivot || [W / 2, H / 2];
        ctx.translate(0, state.brows[0]);
        ctx.translate(px, py); ctx.rotate(rad(state.brows[1] || 0)); ctx.translate(-px, -py);
        put('brows');
      } else if (L.type === 'swap') {
        put(`${L.id}:${state[L.id]}`);
      } else {
        put(L.id);
      }
      ctx.restore();
    }
  }

  const api = { stateAt, drawPresenter, layerFiles };
  root.FLPTPresenter = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
