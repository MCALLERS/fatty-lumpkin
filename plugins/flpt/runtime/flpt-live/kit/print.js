/* kit/print.js · flpt-live shared kit: print marks (FLPT.kit.print).
 *   print.halftone(g, path, { tone, angle, pitch, color })  fill a path (a Path2D or (g) => {...}) with a dot screen
 *   print.blob(g, x, y, r, { seed, color, amt, points, sx, sy })  an ink blob that boils on twos (ctx.B)
 *   print.offset(g, dx, dy, fn)                                   draw fn(g) shifted, as a misregistered plate
 * Screens are cached patterns (tone in 20 levels), rotated with the pattern's own transform. */
FLPT.kit.print = (() => {
  'use strict';
  let C = null;
  const TILES = new Map();
  const LEVELS = 20;
  function tile(pitch, level, color) {
    const k = `${pitch}|${level}|${color}`;
    if (TILES.has(k)) return TILES.get(k);
    const s = Math.max(2, Math.round(pitch)), c = C.canvas(s, s), p = c.getContext('2d');
    const cov = level / LEVELS;
    p.fillStyle = color;
    if (cov >= 1) p.fillRect(0, 0, s, s);
    else if (cov > 0) {
      if (cov <= 0.5) { p.beginPath(); p.arc(s / 2, s / 2, Math.sqrt(cov / Math.PI) * s, 0, Math.PI * 2); p.fill(); } else {
        p.fillRect(0, 0, s, s); p.globalCompositeOperation = 'destination-out';
        for (const [x, y] of [[0, 0], [s, 0], [0, s], [s, s]]) { p.beginPath(); p.arc(x, y, Math.sqrt((1 - cov) / Math.PI) * s, 0, Math.PI * 2); p.fill(); }
      }
    }
    TILES.set(k, c);
    return c;
  }
  function halftone(g, path, o = {}) {
    const level = Math.round(Math.max(0, Math.min(1, o.tone ?? 0.5)) * LEVELS);
    if (!level) return;
    const pat = g.createPattern(tile(o.pitch || 8, level, o.color || C.tokens.ink || '#222'), 'repeat');
    const a = ((o.angle ?? 45) * Math.PI) / 180;
    if (pat.setTransform) pat.setTransform({ a: Math.cos(a), b: Math.sin(a), c: -Math.sin(a), d: Math.cos(a), e: 0, f: 0 });
    g.save(); g.fillStyle = pat;
    if (typeof path === 'function') { g.beginPath(); path(g); g.fill(); } else g.fill(path);
    g.restore();
  }
  function blob(g, x, y, r, o = {}) {
    const n = o.points || 48, R = C.rng('blob', o.seed ?? 'blob', o.boil === false ? 0 : C.B), amt = o.amt ?? 0.14, sx = o.sx ?? 1, sy = o.sy ?? 1;
    if (!(r > 0)) return;
    g.save(); g.fillStyle = o.color || C.tokens.ink || '#222'; g.beginPath();
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, rr = r * (1 + amt * R.n()), px = x + Math.cos(a) * rr * sx, py = y + Math.sin(a) * rr * sy;
      if (k) g.lineTo(px, py); else g.moveTo(px, py);
    }
    g.closePath(); g.fill(); g.restore();
  }
  function offset(g, dx, dy, fn) { g.save(); g.translate(dx, dy); fn(g); g.restore(); }
  return { bind(ctx) { C = ctx; }, halftone, blob, offset, LEVELS };
})();
