/* overlays.js · the Stage's overlay layer, 1.0.0 (FLPT V2, PLAN §2.5): the 10 % grid with the title-safe area, the
 * Duet keep-out, and the presenter bubble (the still before filming, the filmed clip after). Drawn in the piece's own
 * 1920×1080 units (protocol.js GEOM, the same numbers as flpt-live's ctx.safe and ctx.bubble), at device pixels.
 */
(() => {
  'use strict';
  const P = window.FLPTStageProtocol;
  const G = P.GEOM;
  const LINE = 'rgba(238, 232, 218, 0.34)', DARK = 'rgba(17, 17, 14, 0.30)', GOLD = '#E3B860', GOLD_FILL = 'rgba(227, 184, 96, 0.14)';

  /** Draw the grid and the keep-out over the piece's box. opts: { grid, keepOut } */
  function draw(canvas, box, opts) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(box.w * dpr)), h = Math.max(1, Math.round(box.h * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const g = canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!opts || (!opts.grid && !opts.keepOut)) return { lines: 0 };
    const s = w / P.W;
    const px = 1 / s;                       // one device pixel, in piece units
    g.setTransform(s, 0, 0, s, 0, 0);
    let lines = 0;
    if (opts.grid) {
      // each line twice, dark then light beside it, so it reads on paper and on night alike
      for (const [color, off] of [[DARK, 0], [LINE, px]]) {
        g.strokeStyle = color;
        g.lineWidth = px;
        g.beginPath();
        for (let i = 1; i < 10; i++) {
          const x = Math.round(P.W * G.grid * i * s) / s + px / 2 + off, y = Math.round(P.H * G.grid * i * s) / s + px / 2 + off;
          g.moveTo(x, 0); g.lineTo(x, P.H); g.moveTo(0, y); g.lineTo(P.W, y);
        }
        g.stroke();
      }
      lines += 18;
      g.strokeStyle = GOLD;
      g.setLineDash([12 * px, 8 * px]);
      g.strokeRect(G.safe.x, G.safe.y, G.safe.w, G.safe.h);
      g.setLineDash([]);
      lines++;
    }
    if (opts.keepOut) {
      const k = G.keepOut, b = G.bubble;
      g.fillStyle = GOLD_FILL;
      g.fillRect(k.x, k.y, k.w, k.h);
      g.strokeStyle = GOLD;
      g.lineWidth = 2 * px;
      g.strokeRect(k.x + px, k.y + px, k.w - 2 * px, k.h - 2 * px);
      g.beginPath();
      g.arc(b.x + b.d / 2, b.y + b.d / 2, b.d / 2, 0, Math.PI * 2);
      g.stroke();
      lines += 2;
    }
    return { lines };
  }

  /** Put the presenter bubble's element over the piece's box. */
  function placeBubble(el, box) {
    const s = box.w / P.W, b = G.bubble;
    el.style.left = `${box.x + b.x * s}px`;
    el.style.top = `${box.y + b.y * s}px`;
    el.style.width = el.style.height = `${b.d * s}px`;
  }

  window.FLPTStageOverlays = Object.freeze({ draw, placeBubble });
})();
