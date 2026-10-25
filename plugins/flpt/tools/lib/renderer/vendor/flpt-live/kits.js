/* kits.js · flpt-live's shared kits (paper, ink, print, pixel, type, chart), bundled from engine/runtime/flpt-live/kit/. Generated; edit the kit files. */
/* kit/paper.js · flpt-live shared kit: paper and grain (FLPT.kit.paper; ctx.kit.paper in a scene).
 *   paper.sheet(key, { w, h, color, mottle, fibres, specks })  a sheet of paper, made once per key, a canvas
 *   paper.draw(g, sheet, x, y)                                     put it down (world or screen space, as g is)
 *   paper.grain(g, { amount, every, op })                          film grain over the frame, screen space; changes every `every` frames
 * Everything is seeded (ctx.rng), so every host draws the same paper. */
FLPT.kit.paper = (() => {
  'use strict';
  let C = null;
  const SHEETS = new Map(), GRAIN = new Map();
  function sheet(key = 'paper', o = {}) {
    // keyed by the colour it resolves to, so two styles on one page (host-inline) never share a sheet
    const color = o.color || C.tokens.paper || '#f2ece3';
    const w = o.w || 1920, h = o.h || 1080, id = `${key}|${w}|${h}|${color}|${o.mottle ?? ''}|${o.fibres ?? ''}|${o.specks ?? ''}`;
    if (SHEETS.has(id)) return SHEETS.get(id);
    const c = C.canvas(w, h), p = c.getContext('2d'), R = C.rng('paper', key), k = (w * h) / (1080 * 1080);
    p.fillStyle = color;
    p.fillRect(0, 0, w, h);
    for (let i = 0; i < (o.mottle ?? 70) * k; i++) {
      const x = R.r(0, w), y = R.r(0, h), r = R.r(60, 180), gr = p.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, R.f() < 0.5 ? 'rgba(255,250,240,0.03)' : 'rgba(120,100,70,0.025)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      p.fillStyle = gr; p.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    p.lineCap = 'round';
    for (let i = 0; i < (o.fibres ?? 240) * k; i++) {
      let x = R.r(0, w), y = R.r(0, h), a = R.r(0, Math.PI * 2);
      const L = R.r(9, 24), bend = R.n(0.35);
      p.strokeStyle = `rgba(150,138,120,${R.r(0.08, 0.2).toFixed(3)})`; p.lineWidth = R.r(0.6, 1.2);
      p.beginPath(); p.moveTo(x, y);
      for (let j = 0; j < 6; j++) { a += bend; x += (Math.cos(a) * L) / 6; y += (Math.sin(a) * L) / 6; p.lineTo(x, y); }
      p.stroke();
    }
    for (let i = 0; i < (o.specks ?? 300) * k; i++) { p.fillStyle = `rgba(110,100,90,${R.r(0.1, 0.25).toFixed(3)})`; p.fillRect(R.r(0, w), R.r(0, h), R.r(0.8, 1.6), R.r(0.8, 1.6)); }
    SHEETS.set(id, c);
    return c;
  }
  function draw(g, s, x = 0, y = 0) { g.drawImage(s, x, y); }
  function grain(g, o = {}) {
    const every = Math.max(1, o.every || 3), v = Math.floor(C.F / every) % 3;
    if (!GRAIN.has(v)) {
      const c = C.canvas(960, 540), p = c.getContext('2d'), d = p.createImageData(960, 540), R = C.rng('grain', v);
      for (let i = 0; i < d.data.length; i += 4) { const n = 128 + R.n(1) * 60; d.data[i] = d.data[i + 1] = d.data[i + 2] = n; d.data[i + 3] = 255; }
      p.putImageData(d, 0, 0);
      GRAIN.set(v, c);
    }
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = o.op || 'overlay'; g.globalAlpha = o.amount ?? 0.12; g.imageSmoothingEnabled = false;
    g.drawImage(GRAIN.get(v), 0, 0, 1920, 1080);
    g.restore();
  }
  return { bind(ctx) { C = ctx; }, sheet, draw, grain };
})();
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
/* kit/pixel.js · flpt-live shared kit: pixel art on a grid (FLPT.kit.pixel).
 *   pixel.snap(v, cell)                         a coordinate on the grid
 *   pixel.rect(g, x, y, w, h, color, cell)      a block snapped to the grid
 *   pixel.line(g, x0, y0, x1, y1, color, cell)  a stepped line, one cell at a time
 *   pixel.dither(g, x, y, w, h, { tone, cell, color })  a 4×4 Bayer ordered dither
 *   pixel.sprite(g, rows, x, y, { cell, palette })      rows of characters, each a palette colour ('.' or ' ' is empty)
 * No smoothing anywhere: every block lands on whole pixels. */
FLPT.kit.pixel = (() => {
  'use strict';
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const snap = (v, cell = 8) => Math.round(v / cell) * cell;
  function rect(g, x, y, w, h, color, cell = 8) {
    g.fillStyle = color;
    const x0 = snap(x, cell), y0 = snap(y, cell);
    g.fillRect(x0, y0, Math.max(cell, snap(x + w, cell) - x0), Math.max(cell, snap(y + h, cell) - y0));
  }
  function line(g, x0, y0, x1, y1, color, cell = 8) {
    let a = Math.round(x0 / cell), b = Math.round(y0 / cell);
    const c = Math.round(x1 / cell), d = Math.round(y1 / cell), dx = Math.abs(c - a), dy = -Math.abs(d - b), sx = a < c ? 1 : -1, sy = b < d ? 1 : -1;
    let err = dx + dy, guard = 0;
    g.fillStyle = color;
    for (;;) {
      g.fillRect(a * cell, b * cell, cell, cell);
      if ((a === c && b === d) || ++guard > 4096) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; a += sx; }
      if (e2 <= dx) { err += dx; b += sy; }
    }
  }
  function dither(g, x, y, w, h, o = {}) {
    const cell = o.cell || 4, tone = Math.max(0, Math.min(1, o.tone ?? 0.5));
    g.fillStyle = o.color || '#000';
    const x0 = snap(x, cell), y0 = snap(y, cell);
    for (let j = 0, yy = y0; yy < y + h; j++, yy += cell) {
      for (let i = 0, xx = x0; xx < x + w; i++, xx += cell) if ((BAYER[(j % 4) * 4 + (i % 4)] + 0.5) / 16 < tone) g.fillRect(xx, yy, cell, cell);
    }
  }
  function sprite(g, rows, x, y, o = {}) {
    const cell = o.cell || 8, pal = o.palette || {};
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '.' || ch === ' ' || !pal[ch]) continue;
        g.fillStyle = pal[ch];
        g.fillRect(snap(x, cell) + i * cell, snap(y, cell) + j * cell, cell, cell);
      }
    });
  }
  return { snap, rect, line, dither, sprite, BAYER };
})();
/* kit/type.js · flpt-live shared kit: type helpers over ctx.text and the outline fonts (FLPT.kit.type).
 *   type.num(v, { decimals, sep, prefix, suffix })        14,460 / $2,400.50, the same on every machine (no locale tables)
 *   type.fit(str, { font, weight, style, maxWidth, maxSize, minSize })   the largest size that fits a width
 *   type.typeOn(str, u)                                    the first u (0..1) of a string, by characters
 *   type.odometer(g, v, x, y, { font, weight, size, align, color, id })  digits that roll in fixed cells; registers its box */
FLPT.kit.type = (() => {
  'use strict';
  let ctx = null;
  function num(v, o = {}) {
    const d = o.decimals || 0, neg = v < 0, a = Math.abs(Number(v) || 0);
    const [i, f] = a.toFixed(d).split('.');
    const body = i.replace(/\B(?=(\d{3})+(?!\d))/g, o.sep ?? ',') + (f ? '.' + f : '');
    return `${neg ? '-' : ''}${o.prefix || ''}${body}${o.suffix || ''}`;
  }
  function fit(str, o = {}) {
    const max = o.maxSize || 160, min = o.minSize || 12, w = o.maxWidth || 1792;
    let lo = min, hi = max;
    for (let k = 0; k < 14 && hi - lo > 0.5; k++) {
      const mid = (lo + hi) / 2;
      if (ctx.measure(str, { font: o.font, weight: o.weight, style: o.style, size: mid, tracking: o.tracking }).w <= w) lo = mid; else hi = mid;
    }
    return Math.floor(lo);
  }
  const typeOn = (str, u) => { const ch = [...String(str)]; return ch.slice(0, Math.round(ch.length * Math.max(0, Math.min(1, u)))).join(''); };
  function odometer(g, v, x, y, o = {}) {
    const f = { font: o.font, weight: o.weight || 600, size: o.size || 80 }, str = num(Math.floor(v), { sep: o.sep });
    const cell = ctx.measure('0', f).w * 1.02, comma = ctx.measure(o.sep ?? ',', f).w, lh = f.size * 0.9;
    let total = 0;
    for (const ch of str) total += /\d/.test(ch) ? cell : comma;
    const x0 = o.align === 'right' ? x - total : o.align === 'center' ? x - total / 2 : x;
    let cx = x0, k = str.replace(/\D/g, '').length - 1;
    g.save(); g.fillStyle = o.color || ctx.tokens.ink || '#222';
    for (const ch of str) {
      if (!/\d/.test(ch)) { ctx.fillText(g, ch, cx, y, f); cx += comma; continue; }
      const p = 10 ** k, lower = v - Math.floor(v / p) * p, fr = k === 0 ? v - Math.floor(v) : Math.max(0, Math.min(1, lower - (p - 1))), d = Math.floor(v / p) % 10;
      g.save(); g.beginPath(); g.rect(cx - 2, y - f.size * 0.8, cell + 4, f.size * 0.9); g.clip();
      const dx = (dd) => cx + (cell - ctx.measure(String(dd), f).w) / 2;
      ctx.fillText(g, String(d), dx(d), y - fr * lh, f);
      if (fr > 0.001) ctx.fillText(g, String((d + 1) % 10), dx((d + 1) % 10), y - fr * lh + lh, f);
      g.restore(); cx += cell; k--;
    }
    g.restore();
    if (o.id !== false) {
      const T = g.getTransform();
      ctx.registerBox(o.id || 'num', str, { x: T.a * x0 + T.e, y: T.d * (y - f.size * 0.72) + T.f, w: T.a * total, h: T.d * f.size * 0.75 });
    }
    return total;
  }
  return { bind(c) { ctx = c; }, num, fit, typeOn, odometer };
})();
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
