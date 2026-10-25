/* kit/ink.js · flpt-live shared kit: hand-drawn lines and the geometry under them (FLPT.kit.ink).
 *   ink.stroke(g, P, { w, color, taper, rough, amt, frac, key, closed, step })  a tapered ribbon with pressure; frac writes it on
 *   ink.wobble(P, closed, amt, key, step)   a smooth hand wobble, reseeded every boil step (ctx.B)
 *   ink.resample, subPath, pathLen, dist, bbox, ellipsePts, arcPts, ringPts
 * The wobble, resample and ribbon follow cth9191/animate's kit/core.js (MIT, Copyright (c) 2026 cth9191; the full
 * notice is LICENSE-animate.md next to flpt-live.js). */
FLPT.kit.ink = (() => {
  'use strict';
  let C = null;
  const TAU = Math.PI * 2;
  const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
  const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  function bbox(P, pad = 0) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [x, y] of P) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  }
  const pathLen = (P) => { let L = 0; for (let i = 1; i < P.length; i++) L += dist(P[i - 1], P[i]); return L; };
  function resample(P, closed, step) {
    const out = [], n = P.length, m = closed ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const a = P[i], b = P[(i + 1) % n], k = Math.max(1, Math.ceil(dist(a, b) / step));
      for (let j = 0; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
    }
    if (!closed) out.push(P[n - 1]);
    return out;
  }
  function subPath(P, frac) {
    let want = pathLen(P) * clamp(frac);
    const out = [P[0]];
    for (let i = 1; i < P.length; i++) {
      const d = dist(P[i - 1], P[i]);
      if (want >= d) { out.push(P[i]); want -= d; } else { const k = want / (d || 1); out.push([P[i - 1][0] + (P[i][0] - P[i - 1][0]) * k, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * k]); break; }
    }
    return out;
  }
  function ellipsePts(cx, cy, rx, ry, rot = 0, n = 64) {
    const P = [], c = Math.cos(rot), s = Math.sin(rot);
    for (let i = 0; i < n; i++) { const a = (TAU * i) / n, x = Math.cos(a) * rx, y = Math.sin(a) * ry; P.push([cx + x * c - y * s, cy + x * s + y * c]); }
    return P;
  }
  function arcPts(cx, cy, r, a0, a1, n = 18, sy = 1) { const P = []; for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; P.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * sy]); } return P; }
  const ringPts = (cx, cy, r, n = 0) => { const k = n || Math.max(24, Math.round(r / 5)); return Array.from({ length: k }, (_, i) => [cx + Math.cos((i / k) * TAU) * r, cy + Math.sin((i / k) * TAU) * r]); };
  function wobble(P, closed, amt, key, step = 7) {
    const Q = resample(P, closed, step), n = Q.length, R = C.rng('wob', key, C.B);
    const f1 = R.r(0.012, 0.03), f2 = R.r(0.05, 0.1), p1 = R.r(0, TAU), p2 = R.r(0, TAU), sx = R.n(amt * 0.5), sy = R.n(amt * 0.5);
    const out = new Array(n);
    let s = 0;
    for (let i = 0; i < n; i++) {
      const a = Q[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = Q[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      const nx = a[1] - b[1], ny = b[0] - a[0], l = Math.hypot(nx, ny) || 1;
      if (i) s += dist(Q[i - 1], Q[i]);
      const o = amt * (0.75 * Math.sin(s * f1 + p1) + 0.35 * Math.sin(s * f2 + p2));
      out[i] = [Q[i][0] + (nx / l) * o + sx, Q[i][1] + (ny / l) * o + sy];
    }
    return out;
  }
  function ribbon(Q, closed, o) {
    const n = Q.length, total = pathLen(closed ? [...Q, Q[0]] : Q) || 1, R = C.rng('press', o.key ?? 'ink', C.B % 3);
    const f1 = R.r(0.02, 0.05), f2 = R.r(0.12, 0.3), p1 = R.r(0, TAU), p2 = R.r(0, TAU), rough = o.rough ?? 0.15, w = o.w ?? 4;
    const L = [], Rt = [];
    let s = 0;
    for (let i = 0; i < n; i++) {
      const a = Q[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], c = Q[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      let nx = a[1] - c[1], ny = c[0] - a[0];
      const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
      if (i) s += dist(Q[i - 1], Q[i]);
      const t = s / total, tp = o.taper ? Math.max(0, Math.min(1, t / o.taper, (1 - t) / o.taper)) ** 0.7 : 1;
      const hw = Math.max(0, (w / 2) * tp * (1 + rough * (0.6 * Math.sin(s * f1 + p1) + 0.4 * Math.sin(s * f2 + p2))));
      L.push([Q[i][0] + nx * hw, Q[i][1] + ny * hw]); Rt.push([Q[i][0] - nx * hw, Q[i][1] - ny * hw]);
    }
    return closed ? { outer: L, inner: Rt } : [...L, ...Rt.reverse()];
  }
  function polyPath(g, P) { g.moveTo(P[0][0], P[0][1]); for (let i = 1; i < P.length; i++) g.lineTo(P[i][0], P[i][1]); g.closePath(); }
  function stroke(g, P, o = {}) {
    let closed = !!o.closed;
    if (o.frac != null && o.frac < 1) { if (o.frac <= 0) return; P = subPath(closed ? [...P, P[0]] : P, o.frac); closed = false; }
    if (!P || P.length < 2) return;
    const Q = o.amt === 0 ? resample(P, closed, o.step ?? 5) : wobble(P, closed, o.amt ?? 1.2, o.key ?? 'ink', o.step ?? 5);
    const rb = ribbon(Q, closed, o);
    g.save();
    g.fillStyle = o.color || C.tokens.ink || '#222';
    g.beginPath();
    if (closed) { polyPath(g, rb.outer); polyPath(g, rb.inner); g.fill('evenodd'); } else { polyPath(g, rb); g.fill(); }
    g.restore();
  }
  return { bind(ctx) { C = ctx; }, stroke, wobble, resample, subPath, pathLen, dist, bbox, ellipsePts, arcPts, ringPts };
})();
