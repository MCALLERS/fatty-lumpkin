/* kit/chart.js · flpt-live shared kit: the parts of a chart, drawn from t (FLPT.kit.chart).
 *   chart.scale([d0, d1], [r0, r1])        a linear scale (s(v), s.invert(px))
 *   chart.ticks(min, max, count)           round tick values (1, 2, 5 × 10^n)
 *   chart.axis(g, { x, y, length, vertical, scale, ticks, format, color, size, font, id })  a line and labelled ticks
 *   chart.bars(g, values, { x, y, w, h, gap, max, grow, color, colors })  bars from a baseline; grow is 0..1 or a function of i
 *   chart.line(g, points, { frac, w, color })   a polyline written on to frac
 * Labels go through ctx.text, so their boxes reach the text checks. */
FLPT.kit.chart = (() => {
  'use strict';
  let C = null;
  function scale([d0, d1], [r0, r1]) {
    const s = (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);
    s.invert = (p) => d0 + ((p - r0) / (r1 - r0 || 1)) * (d1 - d0);
    return s;
  }
  function ticks(min, max, count = 5) {
    const span = max - min;
    if (!(span > 0)) return [min];
    const raw = span / Math.max(1, count), mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
    const step = (f >= 5 ? 10 : f >= 2 ? 5 : f >= 1 ? 2 : 1) * mag;
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }
  function axis(g, o) {
    const len = o.length || 800, col = o.color || C.tokens.ink || '#222', size = o.size || 28, fmt = o.format || ((v) => String(v));
    g.save(); g.strokeStyle = col; g.lineWidth = o.w || 3; g.beginPath(); g.moveTo(o.x, o.y);
    if (o.vertical) g.lineTo(o.x, o.y - len); else g.lineTo(o.x + len, o.y);
    g.stroke(); g.restore();
    for (const v of o.ticks || []) {
      const p = o.scale(v);
      if (o.vertical) C.text(`${o.id || 'axis'}:${v}`, fmt(v), { x: o.x - 16, y: p + size * 0.35, size, font: o.font, color: col, align: 'right', world: true });
      else C.text(`${o.id || 'axis'}:${v}`, fmt(v), { x: p, y: o.y + size * 1.4, size, font: o.font, color: col, align: 'center', world: true });
    }
  }
  function bars(g, values, o) {
    const n = values.length, gap = o.gap ?? 0.25, bw = (o.w / n) * (1 - gap), max = o.max || Math.max(...values, 1e-9);
    values.forEach((v, i) => {
      const k = typeof o.grow === 'function' ? o.grow(i) : o.grow ?? 1, hh = (o.h * v * Math.max(0, k)) / max;
      if (hh <= 0) return;
      g.fillStyle = (o.colors && o.colors[i]) || o.color || C.tokens.ink || '#222';
      g.fillRect(o.x + (o.w / n) * i + ((o.w / n) * gap) / 2, o.y - hh, bw, hh);
    });
  }
  function line(g, pts, o = {}) {
    if (!pts || pts.length < 2) return;
    const frac = Math.max(0, Math.min(1, o.frac ?? 1));
    if (frac <= 0) return;
    const seg = []; let L = 0;
    for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); L += d; }
    let want = L * frac;
    g.save(); g.strokeStyle = o.color || C.tokens.ink || '#222'; g.lineWidth = o.w || 5; g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length && want > 0; i++) {
      const d = seg[i - 1], k = Math.min(1, want / (d || 1));
      g.lineTo(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k);
      want -= d;
    }
    g.stroke(); g.restore();
  }
  return { bind(ctx) { C = ctx; }, scale, ticks, axis, bars, line };
})();
