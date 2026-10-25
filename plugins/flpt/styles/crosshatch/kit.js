// =====================================================================
//  engine/styles/crosshatch/kit.js: Crosshatch, a sketchy ink line that boils on twos, hatch, cross-hatch,
//  coloured-pencil and stipple shading clipped inside shapes, paper grain; warm cream paper and wood outside,
//  a navy "inside the machine" world with periwinkle lines and glowing accents inside. 16:9, 1920x1080, 30 fps.
//
//  A 16:9 port of cth9191/animate's crosshatch style (styles/crosshatch/kit.js + the parts of kit/core.js it
//  draws with), MIT, Copyright (c) 2026 cth9191; the full notice is LICENSE beside this file and travels with
//  every copy. Port changes (Bombadillo AI, 2026): an FLPT.style plug-in with closure state instead of globals;
//  the frame is 1920x1080 at 30 fps (the boil is ctx.B, every two frames); type is set in bundled OFL faces
//  (Caveat for the hand, IBM Plex Mono for the machine), drawn from glyph outlines and registered with the
//  runtime's text checks; globalAlpha multiplies instead of resetting, so props can dissolve; the hero keeps its
//  terracotta and its eyes but not the original's asterisk mark; tags and captions take 16:9 positions and stay
//  out of the Duet presenter's corner, and the corner tag became a label in the world (a label pinned to a frame
//  corner is one of animate's own banned defaults); parallax helpers (depth, darkWorld drift); kinetic type (letters).
//
//  Shade with density functions (dens(x, y) -> 0..1), never flat fills: light from the top-left, darker toward the
//  bottom-right. Textures are keyed by name, not by screen position, so they stay put when the camera moves.
// =====================================================================
FLPT.style('crosshatch', {
  tokens: {
    paper: '#f4ecd9', ink: '#3a2417', font: 'Caveat', weight: 700, mono: 'IBM Plex Mono',
    navy: '#0c0d1c', peri: '#c8d0f0', terra: '#d97757', wood: '#d6a466', cyan: '#52d6c4', red: '#d4382c',
  },
  fonts: [
    { family: 'Caveat', file: 'caveat-regular.ttf', weight: 400 },
    { family: 'Caveat', file: 'caveat-bold.ttf', weight: 700 },
    { family: 'IBM Plex Mono', file: 'IBMPlexMono-SemiBold.ttf', weight: 600 },
  ],
  ones: false,
  make(env) {
    const { W, H, rng: RNG, clamp, lerp } = env;
    const TAU = Math.PI * 2, DEG = Math.PI / 180;
    const HAND = 'Caveat, "Bradley Hand", cursive', MONO = '"IBM Plex Mono", Menlo, monospace';
    let X = null, g = null, B = 0, TT = 0, SC = 1;   // bound per frame

    // ---- the palette (animate's C): day = paper and wood, night = inside the machine
    const C = Object.freeze({
      ink: '#3a2417', cream: '#efe5cf', paper: '#f4ecd9', paperLine: 'rgba(90,130,190,0.32)',
      orange: '#e58a4e', orangeD: '#c3622e', orangeL: '#f4b27c', terra: '#d97757',
      rose: '#d98b8b', roseD: '#b0616a', roseL: '#efb9b0',
      wood: '#d6a466', woodD: '#a8773f', woodL: '#e9c48f',
      sky: '#9cc4d6', skyD: '#6f9fb8', skyL: '#c9e1ea',
      teal: '#3d9f96', tealL: '#86c9be',
      yellow: '#f0c55a', yellowL: '#f7dd92',
      green: '#5f9c5c', greenL: '#a3cf92',
      red: '#d4382c', redL: '#ea7a6c', plan: 'rgba(212,56,44,0.92)',
      lav: 'rgba(104,112,214,0.7)', lavS: 'rgba(104,112,214,0.42)',
      navy: '#0c0d1c', navy2: '#15173a', navy3: '#1d2150', peri: '#c8d0f0', periD: '#7c86c4', periS: 'rgba(150,164,230,0.20)',
      cyan: '#52d6c4', mag: '#e0368f', glow: '#5de37a', white: '#f4f6ff',
    });
    /** The five rainbow contour colours. HAND and MONO are the font stacks (hand, machine). */
    const RAINBOW = ['#f0d042', '#e050b8', '#46cde0', '#7ad866', '#a47ef0'];

    // ---- geometry
    /** The distance between two points. */
    const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
    function ellipsePts(cx, cy, rx, ry, rot = 0, n = 64, a0 = 0, a1 = TAU) {
      const P = [], c = Math.cos(rot), s = Math.sin(rot), full = Math.abs(a1 - a0 - TAU) < 1e-6;
      for (let i = 0; i < n; i++) {
        const a = a0 + ((a1 - a0) * i) / (full ? n : n - 1), x = Math.cos(a) * rx, y = Math.sin(a) * ry;
        P.push([cx + x * c - y * s, cy + x * s + y * c]);
      }
      return P;
    }
    function rrectPts(x, y, w, h, r, n = 6) {
      r = Math.min(r, w / 2, h / 2);
      const P = [], cs = [[x + w - r, y + r, -Math.PI / 2], [x + w - r, y + h - r, 0], [x + r, y + h - r, Math.PI / 2], [x + r, y + r, Math.PI]];
      for (const [cx, cy, a0] of cs) for (let i = 0; i <= n; i++) { const a = a0 + ((Math.PI / 2) * i) / n; P.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
      return P;
    }
    /** Points on an arc from a0 to a1 (sy squashes it). */
    function arcPts(cx, cy, r, a0, a1, n = 18, sy = 1) { const P = []; for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; P.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * sy]); } return P; }
    /** Move, turn and scale a list of points. */
    function xform(P, tx, ty, rot = 0, sx = 1, sy = sx) { const c = Math.cos(rot), s = Math.sin(rot); return P.map(([x, y]) => [tx + x * sx * c - y * sy * s, ty + x * sx * s + y * sy * c]); }
    /** The bounding box of points, padded. */
    function bbox(P, pad = 0) { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of P) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; } return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad }; }
    /** A polyline resampled every step px. */
    function resample(P, closed, step) {
      const out = [], n = P.length, m = closed ? n : n - 1;
      for (let i = 0; i < m; i++) { const a = P[i], b = P[(i + 1) % n], k = Math.max(1, Math.ceil(dist(a, b) / step)); for (let j = 0; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]); }
      if (!closed) out.push(P[n - 1]);
      return out;
    }
    /** The length of a polyline. */
    function pathLen(P) { let L = 0; for (let i = 1; i < P.length; i++) L += dist(P[i - 1], P[i]); return L; }
    /** The first frac of a polyline (for a write-on). */
    function subPath(P, frac) {
      let want = pathLen(P) * clamp(frac);
      const out = [P[0]];
      for (let i = 1; i < P.length; i++) { const d = dist(P[i - 1], P[i]); if (want >= d) { out.push(P[i]); want -= d; } else { const k = want / (d || 1); out.push([lerp(P[i - 1][0], P[i][0], k), lerp(P[i - 1][1], P[i][1], k)]); break; } }
      return out;
    }
    /** The point at frac along a polyline. */
    function pointAt(P, frac) { const S = subPath(P, frac); return S[S.length - 1]; }
    const box = (x, y, w, h) => resample([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true, 30);   // dense, so the wobble keeps the corners

    // ---- the line: a smooth hand wobble along the normal, reseeded every boil step (two frames)
    function wobble(P, closed, amt, key, step = 7) {
      const Q = resample(P, closed, step), n = Q.length, R = RNG('wob', key, B);
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
    /** Trace points as a smooth path, for your own fill or stroke. */
    function trace(P, closed) {
      g.beginPath();
      const n = P.length;
      if (n < 2) return;
      if (closed) {
        g.moveTo((P[n - 1][0] + P[0][0]) / 2, (P[n - 1][1] + P[0][1]) / 2);
        for (let i = 0; i < n; i++) { const p = P[i], q = P[(i + 1) % n]; g.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2); }
        g.closePath();
      } else {
        g.moveTo(P[0][0], P[0][1]);
        for (let i = 1; i < n - 1; i++) { const p = P[i], q = P[i + 1]; g.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2); }
        g.lineTo(P[n - 1][0], P[n - 1][1]);
      }
    }
    /** A sketchy stroke. o: closed, color, w, amt, key, alpha, frac (write-on), double, raw, dash */
    function ink(P, o = {}) {
      const closed = !!o.closed, key = o.key ?? 'ink', A = g.globalAlpha;
      let Q = o.raw ? P : wobble(P, closed, o.amt ?? 1.8, key);
      let cl = closed;
      if (o.frac != null && o.frac < 1) { if (o.frac <= 0) return Q; Q = subPath(closed ? [...Q, Q[0]] : Q, o.frac); cl = false; }
      g.save();
      if (o.dash) g.setLineDash(o.dash);
      g.strokeStyle = o.color || C.ink; g.lineWidth = o.w ?? 3; g.lineCap = 'round'; g.lineJoin = 'round';
      g.globalAlpha = A * (o.alpha ?? 1);
      trace(Q, cl); g.stroke();
      if (o.double) {
        let Q2 = wobble(P, closed, (o.amt ?? 1.8) * 1.6 + 0.8, key + '~');
        if (o.frac != null && o.frac < 1) Q2 = subPath(closed ? [...Q2, Q2[0]] : Q2, o.frac);
        g.lineWidth = (o.w ?? 3) * 0.4; g.globalAlpha = A * (o.alpha ?? 1) * 0.55; trace(Q2, cl); g.stroke();
      }
      g.restore();
      return Q;
    }
    /** A filled shape, its textures clipped inside, then the ink outline. o: fill, fillAl, tex [...], line, w, lineAl, key, amt, raw */
    function paint(P, o = {}) {
      const key = o.key || 'paint', A = g.globalAlpha;
      const Q = o.raw ? P : wobble(P, true, o.amt ?? 1.6, key);
      g.save();
      trace(Q, true);
      if (o.fill) { g.globalAlpha = A * (o.fillAl ?? 1); g.fillStyle = o.fill; g.fill(); g.globalAlpha = A; }
      if (o.tex) { g.clip(); const bb = bbox(Q, 6); o.tex.forEach((t, i) => texture(bb, { key: key + ':' + i, ...t })); }
      g.restore();
      if (o.line !== false) {
        g.save();
        g.strokeStyle = o.line || C.ink; g.lineWidth = o.w ?? 3; g.lineJoin = 'round'; g.lineCap = 'round';
        g.globalAlpha = A * (o.lineAl ?? 1); trace(Q, true); g.stroke();
        g.restore();
      }
      return Q;
    }
    /** One texture (hatch, cross, pencil, stipple) inside the clip. */
    function texture(bb, t) {
      if (t.k === 'hatch') hatch(bb, t);
      else if (t.k === 'cross') { hatch(bb, t); hatch(bb, { ...t, a: (t.a ?? 0.7) + (t.a2 ?? 1.25), key: t.key + 'x' }); }
      else if (t.k === 'pencil') pencil(bb, t);
      else if (t.k === 'stipple') stipple(bb, t);
      else if (t.k === 'fn' && typeof t.fn === 'function') t.fn(bb);
    }
    /** Parallel hatching inside the current clip. t: a (angle), gap, c, w, al, dash [min, max], skip, jit, dens(x, y) */
    function hatch(bb, t) {
      const a = t.a ?? 0.7, gap = Math.max(1.5, t.gap ?? 7), S = RNG('hs', t.key), R = RNG('hj', t.key, B), A = g.globalAlpha;
      const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2, rad = Math.hypot(bb.x1 - bb.x0, bb.y1 - bb.y0) / 2 + 4;
      const ca = Math.cos(a), sa = Math.sin(a), dens = t.dens, jit = t.jit ?? 0.9, dash = t.dash;
      g.beginPath();
      for (let d = -rad; d <= rad; d += gap) {
        const dd = d + S.n(gap * 0.3);
        let u = -rad + (dash ? S.r(0, dash[1]) : 0);
        while (u < rad) {
          const len = dash ? S.r(dash[0], dash[1]) : rad * 2, u2 = Math.min(rad, u + len);
          const mu = (u + u2) / 2, mx = cx + ca * mu - sa * dd, my = cy + sa * mu + ca * dd, p = S.f();
          if (!dens || p < dens(mx, my)) {
            const e1 = R.n(jit), e2 = R.n(jit);
            g.moveTo(cx + ca * u - sa * (dd + e1), cy + sa * u + ca * (dd + e1));
            g.lineTo(cx + ca * u2 - sa * (dd + e2), cy + sa * u2 + ca * (dd + e2));
          }
          u = u2 + (dash ? S.r(t.skip ? t.skip[0] : 3, t.skip ? t.skip[1] : 12) : 0);
        }
      }
      g.strokeStyle = t.c || C.ink; g.lineWidth = t.w ?? 1.2; g.globalAlpha = A * (t.al ?? 0.5); g.lineCap = 'round';
      g.stroke(); g.globalAlpha = A;
    }
    /** Coloured-pencil strokes. t: c, al, a (angle), len, per (px of area per stroke), n, max, w, dens(x, y) */
    function pencil(bb, t) {
      const S = RNG('ps', t.key), R = RNG('pj', t.key, B), A = g.globalAlpha;
      const area = (bb.x1 - bb.x0) * (bb.y1 - bb.y0);
      const n = Math.min(t.max ?? 6000, t.n ?? Math.floor(area / (t.per ?? 700)));
      const a = t.a ?? -0.95, L = t.len ?? 14, dens = t.dens;
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const x = S.r(bb.x0, bb.x1), y = S.r(bb.y0, bb.y1), p = S.f(), aa = a + S.n(0.22), l = L * (0.5 + S.f() * 0.7);
        if (dens && p > dens(x, y)) continue;
        const jx = R.n(1.1), jy = R.n(1.1), dx = (Math.cos(aa) * l) / 2, dy = (Math.sin(aa) * l) / 2;
        g.moveTo(x - dx + jx, y - dy + jy); g.lineTo(x + dx + jx, y + dy + jy);
      }
      g.strokeStyle = t.c || C.ink; g.lineWidth = t.w ?? 1.4; g.globalAlpha = A * (t.al ?? 0.45); g.lineCap = 'round';
      g.stroke(); g.globalAlpha = A;
    }
    /** Square stipple dots. t: c, al, n, s (size), jit, dens(x, y) */
    function stipple(bb, t) {
      const S = RNG('ss', t.key), R = RNG('sj', t.key, B), A = g.globalAlpha;
      const n = t.n ?? 400, sz = t.s ?? 2.2, dens = t.dens, jit = t.jit ?? 0.8;
      g.fillStyle = t.c || C.ink; g.globalAlpha = A * (t.al ?? 1); g.beginPath();
      for (let i = 0; i < n; i++) {
        const x = S.r(bb.x0, bb.x1), y = S.r(bb.y0, bb.y1), p = S.f(), s = sz * (0.6 + S.f() * 0.8);
        if (dens && p > dens(x, y)) continue;
        g.rect(x + R.n(jit), y + R.n(jit), s, s);
      }
      g.fill(); g.globalAlpha = A;
    }
    /** Screen-space paper grain, reseeded with the boil (over every frame, last). o: n, dark, light, fibres */
    function grain(o = {}) {
      g.save(); X.screen(); g.globalAlpha = 1;
      const R = RNG('grain', B), n = o.n ?? 4200;
      g.fillStyle = o.dark || 'rgba(70,45,25,0.13)'; g.beginPath();
      for (let i = 0; i < n; i++) g.rect(R.r(0, W), R.r(0, H), 1.7, 1.7);
      g.fill();
      g.fillStyle = o.light || 'rgba(255,250,236,0.20)'; g.beginPath();
      for (let i = 0; i < n; i++) g.rect(R.r(0, W), R.r(0, H), 1.9, 1.9);
      g.fill();
      g.strokeStyle = o.fibre || 'rgba(80,55,35,0.07)'; g.lineWidth = 1; g.beginPath();
      for (let i = 0; i < (o.fibres ?? 150); i++) { const x = R.r(0, W), y = R.r(0, H), a = R.r(0, TAU), l = R.r(6, 22); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); }
      g.stroke();
      g.restore();
    }

    // ---- construction lines, rulers, sparks, bursts, stars, rainbow contours, hex cells
    /** A construction circle: sweep, ticks, cross (the drafting layer). */
    function construct(cx, cy, r, o = {}) {
      const R = RNG('con', o.key ?? 'c', B);
      g.save();
      g.strokeStyle = o.c || C.lav; g.lineWidth = o.w ?? 1.4; g.globalAlpha *= o.al ?? 1; g.lineCap = 'round';
      const a0 = o.a0 ?? R.r(0, TAU), sw = o.sweep ?? 1.05;
      g.beginPath(); g.ellipse(cx + R.n(1.2), cy + R.n(1.2), r, r * (o.sq ?? 1), o.rot ?? 0, a0, a0 + TAU * sw); g.stroke();
      if (o.cross) { const k = o.cross; g.beginPath(); g.moveTo(cx - k, cy); g.lineTo(cx + k, cy); g.moveTo(cx, cy - k); g.lineTo(cx, cy + k); g.stroke(); }
      if (o.ticks) { g.beginPath(); for (let i = 0; i < o.ticks; i++) { const a = (i / o.ticks) * TAU + (o.rot ?? 0); g.moveTo(cx + Math.cos(a) * (r - 6), cy + Math.sin(a) * (r - 6)); g.lineTo(cx + Math.cos(a) * (r + 6), cy + Math.sin(a) * (r + 6)); } g.stroke(); }
      g.restore();
    }
    /** A faint construction line (the drafting layer). */
    function cline(x1, y1, x2, y2, o = {}) {
      const R = RNG('cl', o.key ?? 'l', B);
      g.save(); g.strokeStyle = o.c || C.lavS; g.lineWidth = o.w ?? 1.2; g.globalAlpha *= o.al ?? 1;
      g.beginPath(); g.moveTo(x1 + R.n(1), y1 + R.n(1)); g.lineTo(x2 + R.n(1), y2 + R.n(1)); g.stroke(); g.restore();
    }
    /** A ruler with ticks every step px, drawn on by frac. */
    function ruler(x1, y1, x2, y2, o = {}) {
      const R = RNG('rul', o.key ?? 'r', B);
      const L = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / L, uy = (y2 - y1) / L, nx = -uy, ny = ux;
      const frac = clamp(o.frac ?? 1), step = o.step ?? 16, tk = o.tick ?? 7, side = o.side ?? 1;
      g.save(); g.strokeStyle = o.c || C.periD; g.lineWidth = o.w ?? 1.5; g.globalAlpha *= o.al ?? 1; g.lineCap = 'round';
      const jx = R.n(0.8), jy = R.n(0.8);
      g.beginPath(); g.moveTo(x1 + jx, y1 + jy); g.lineTo(x1 + ux * L * frac + jx, y1 + uy * L * frac + jy);
      const n = Math.floor((L * frac) / step);
      for (let i = 0; i <= n; i++) { const k = i % 5 === 0 ? tk * 1.9 : tk, px = x1 + ux * i * step + jx, py = y1 + uy * i * step + jy; g.moveTo(px, py); g.lineTo(px + nx * k * side, py + ny * k * side); }
      g.moveTo(x1 - nx * tk * 1.6, y1 - ny * tk * 1.6); g.lineTo(x1 + nx * tk * 2.2, y1 + ny * tk * 2.2);
      if (frac >= 1) { g.moveTo(x2 - nx * tk * 1.6, y2 - ny * tk * 1.6); g.lineTo(x2 + nx * tk * 2.2, y2 + ny * tk * 2.2); }
      g.stroke(); g.restore();
    }
    /** A glowing radial spark (the dark world). o: n, w, c, glow, core, coreR, specks, key */
    function sparkBurst(cx, cy, r, o = {}) {
      if (r <= 0.5) return;
      const R = RNG('spk', o.key ?? 's', B), n = o.n ?? 18, rays = [];
      for (let i = 0; i < n; i++) { const a = (i / n) * TAU + R.n(0.14); rays.push([a, r * R.r(0.28, 0.5), r * R.r(0.72, 1.15)]); }
      const path = () => { g.beginPath(); for (const [a, r0, r1] of rays) { g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); } };
      g.save(); g.lineCap = 'round';
      path(); g.strokeStyle = o.glow || 'rgba(82,214,196,0.22)'; g.lineWidth = (o.w ?? 2.4) * 3.4; g.stroke();
      path(); g.strokeStyle = o.c || '#8ff5e6'; g.lineWidth = o.w ?? 2.4; g.stroke();
      if (o.core !== false) {
        const cr = Math.max(2.5, r * (o.coreR ?? 0.15));
        g.beginPath(); g.arc(cx, cy, cr * 2.2, 0, TAU); g.fillStyle = 'rgba(190,215,255,0.16)'; g.fill();
        g.beginPath(); g.arc(cx, cy, cr, 0, TAU); g.fillStyle = C.white; g.fill(); g.lineWidth = 2; g.strokeStyle = C.periD; g.stroke();
      }
      if (o.specks) { g.fillStyle = o.c || '#8ff5e6'; for (let i = 0; i < o.specks; i++) { const a = R.r(0, TAU), d = r * R.r(0.2, 1.4); g.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 2, 2); } }
      g.restore();
    }
    /** A radial tick burst (an impact in the paper world). o: n, c, w, al, rot, key */
    function burst(cx, cy, r0, r1, o = {}) {
      const R = RNG('bur', o.key ?? 'b', B), n = o.n ?? 12;
      g.save(); g.strokeStyle = o.c || C.ink; g.lineWidth = o.w ?? 3; g.lineCap = 'round'; g.globalAlpha *= o.al ?? 1; g.beginPath();
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + R.n(0.15) + (o.rot ?? 0), a1 = r0 * R.r(0.85, 1.1), b1 = r1 * R.r(0.75, 1.15);
        g.moveTo(cx + Math.cos(a) * a1, cy + Math.sin(a) * a1); g.lineTo(cx + Math.cos(a) * b1, cy + Math.sin(a) * b1);
      }
      g.stroke(); g.restore();
    }
    /** A four-point star (stars on navy). */
    function star4(x, y, s, c) {
      g.save(); g.fillStyle = c || C.white; g.beginPath();
      g.moveTo(x, y - s); g.quadraticCurveTo(x, y, x + s, y); g.quadraticCurveTo(x, y, x, y + s);
      g.quadraticCurveTo(x, y, x - s, y); g.quadraticCurveTo(x, y, x, y - s); g.fill(); g.restore();
    }
    /** Rainbow contour strokes around a moving part. o: cx, cy, n, spread, drift, w, amt, al, off, closed, key */
    function rainbow(P, o = {}) {
      const bb = bbox(P), cx = o.cx ?? (bb.x0 + bb.x1) / 2, cy = o.cy ?? (bb.y0 + bb.y1) / 2, n = o.n ?? 3;
      for (let i = 0; i < n; i++) {
        const S = RNG('rb', o.key, i, B), sc = 1 + (o.spread ?? 0.07) * (i + 1) + S.n(0.02);
        const Q = P.map(([x, y]) => [cx + (x - cx) * sc + S.n(o.drift ?? 3), cy + (y - cy) * sc + S.n(o.drift ?? 3)]);
        ink(Q, { closed: o.closed ?? true, color: RAINBOW[(i + (o.off ?? 0)) % RAINBOW.length], w: o.w ?? 1.6, amt: o.amt ?? 3.5, key: o.key + 'rb' + i, alpha: o.al ?? 0.85 });
      }
    }
    /** Hex cells over a box (inside the current clip). o: c, w, al, key */
    function hexGrid(bb, size, o = {}) {
      const h = size * Math.sqrt(3), R = RNG('hex', o.key ?? 'h', B);
      g.save(); g.strokeStyle = o.c || C.periS; g.lineWidth = o.w ?? 1.2; g.globalAlpha *= o.al ?? 1; g.beginPath();
      let row = 0;
      for (let y = bb.y0 - h; y < bb.y1 + h; y += h * 0.5, row++) {
        for (let x = bb.x0 - size * 3 + (row % 2) * size * 1.5; x < bb.x1 + size * 3; x += size * 3) {
          const jx = R.n(0.6), jy = R.n(0.6);
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * TAU, b = ((k + 1) / 6) * TAU;
            if (k === 0) g.moveTo(x + Math.cos(a) * size + jx, y + Math.sin(a) * size + jy);
            g.lineTo(x + Math.cos(b) * size + jx, y + Math.sin(b) * size + jy);
          }
        }
      }
      g.stroke(); g.restore();
    }

    // ---- the iris: a ragged hatched hole into the dark world (screen space)
    /** The ragged hatched rim of an iris (irisHole draws it). */
    function irisRim(cx, cy, r, dir, o = {}) {
      const R = RNG('irisR', o.key ?? 'i', B), n = Math.min(1600, Math.floor((r * TAU) / 2.0));
      g.strokeStyle = o.c || '#0b0c17'; g.lineWidth = o.w ?? 1.6; g.lineCap = 'round'; g.beginPath();
      for (let i = 0; i < n; i++) {
        const a = R.r(0, TAU), L = R.r(3, 11) + (R.f() < 0.28 ? R.r(10, 34) : 0), sl = R.n(0.4);
        const r0 = r - dir * R.r(2, 6), r1 = r + dir * L, ax = Math.cos(a), ay = Math.sin(a);
        g.moveTo(cx + ax * r0, cy + ay * r0); g.lineTo(cx + ax * r1 - ay * L * sl, cy + ay * r1 + ax * L * sl);
      }
      g.stroke();
    }
    /** The iris hole at (cx, cy), radius r, screen space; o.inner(r) draws what's inside (clipped), o.c its colour. */
    function irisHole(cx, cy, r, o = {}) {
      if (r <= 0.5) return;
      g.save(); X.screen();
      const col = o.c || '#0b0c17';
      const P = wobble(ellipsePts(cx, cy, r, r, 0, 140), true, Math.min(4, 0.6 + r * 0.02), 'ih' + (o.key ?? ''), 9);
      trace(P, true); g.fillStyle = col; g.fill();
      irisRim(cx, cy, r, +1, { c: col, key: o.key });
      if (o.inner) { g.save(); trace(P, true); g.clip(); o.inner(r); g.restore(); }
      g.restore();
    }

    // ---- camera helpers (cameras come from ctx.cam / ctx.push; put one on with ctx.apply)
    /** A camera for a layer at depth d (0 = pinned to the screen, 1 = the world): parallax. */
    function depth(cam, d) { const q = cam && 'tx' in cam ? cam : X.cam(cam || {}); return { z: 1 + (q.z - 1) * d, tx: q.tx * d, ty: q.ty * d }; }
    /** A world point on screen (scene units), through g's current transform. */
    function toScreen(x, y) { const m = g.getTransform(); return [(m.a * x + m.c * y + m.e) / SC, (m.b * x + m.d * y + m.f) / SC]; }
    /** Fill the whole frame with a colour (screen space). */
    function fillAll(color) { g.save(); X.screen(); g.fillStyle = color; g.fillRect(0, 0, W, H); g.restore(); }
    /** The screen box (scene units) of a world-space rectangle under g's current transform. */
    function screenBox(x0, y0, x1, y1) {
      const m = g.getTransform();
      let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
      for (const [px, py] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) { const sx = (m.a * px + m.c * py + m.e) / SC, sy = (m.b * px + m.d * py + m.f) / SC; a = Math.min(a, sx); b = Math.min(b, sy); c = Math.max(c, sx); d = Math.max(d, sy); }
      return { x: a, y: b, w: c - a, h: d - b };
    }

    // ---- type: the hand (Caveat), the machine (IBM Plex Mono); glyph outlines, registered with the text checks
    const handFont = (size, weight) => `${weight} ${size}px ${HAND}`;
    const monoFont = (size) => `600 ${size}px ${MONO}`;
    function glyphs(str, font) { const tp = env.textPath(str, font); return tp; }
    function fillStr(str, font, tp) { if (tp) g.fill(tp.path); else env.fillText(g, str, 0, 0, font); }
    /** The width of hand lettering at a size and weight. */
    function handW(str, size, weight = 400) { return env.measure(String(str), handFont(size, weight)).w; }
    /**
     * Hand lettering. o: color, weight (400 | 700), align, rot, frac (write-on, left to right), alpha, key, id (false: not
     * registered), outline (an ink edge: true or a colour), jit (the boil's hand jitter, px). Returns the width.
     */
    function hand(str, x, y, size, o = {}) {
      str = String(str);
      const weight = o.weight ?? 400, font = handFont(size, weight), frac = clamp(o.frac ?? 1), A = g.globalAlpha;
      const m = env.measure(str, font), w = m.w, x0 = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x;
      if (frac <= 0 || (o.alpha ?? 1) <= 0.004) return w;
      const R = RNG('ht', o.key ?? str, B), jit = o.jit ?? 0.7;
      g.save();
      g.translate(x0 + R.n(jit), y + R.n(jit)); g.rotate((o.rot ?? 0) + R.n(0.006));
      if (frac < 1) { g.beginPath(); g.rect(-6, -size * 1.3, w * frac + 6, size * 1.9); g.clip(); }
      g.globalAlpha = A * (o.alpha ?? 1);
      const tp = glyphs(str, font);
      g.fillStyle = o.color || C.ink;
      fillStr(str, font, tp);
      if (o.outline && tp) { g.lineWidth = Math.max(1, size * 0.018); g.strokeStyle = o.outline === true ? C.ink : o.outline; g.lineJoin = 'round'; g.stroke(tp.path); }
      if (o.id !== false) env.registerBox(o.id ?? str, str, screenBox(0, -m.asc, w * frac, m.desc));
      g.restore();
      return w;
    }
    /**
     * Kinetic type: a line of hand lettering, one glyph at a time. each(i, n, ch) -> { dx, dy, s, rot, al } moves,
     * scales, turns or hides each letter (al 0: not there yet). Registered as one line. o: as hand(), plus each.
     */
    function letters(str, x, y, size, o = {}) {
      str = String(str);
      const weight = o.weight ?? 700, font = handFont(size, weight), chars = [...str], A = g.globalAlpha;
      const m = env.measure(str, font), w = m.w, x0 = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x;
      env.textPath(str, font);   // the whole line, for the text report
      let shown = 0;
      g.save(); g.translate(x0, y); g.rotate(o.rot ?? 0);
      chars.forEach((ch, i) => {
        if (ch === ' ') return;
        const k = o.each ? o.each(i, chars.length, ch) || {} : {};
        const al = clamp(k.al ?? 1);
        if (al <= 0.004) return;
        shown++;
        const px = env.measure(chars.slice(0, i + 1).join(''), font).w - env.measure(ch, font).w;
        const R = RNG('lt', o.key ?? str, i, B), cw = env.measure(ch, font).w;
        g.save();
        g.translate(px + cw / 2 + (k.dx ?? 0) + R.n(0.8), (k.dy ?? 0) + R.n(0.8));
        g.rotate((k.rot ?? 0) + R.n(0.012)); g.scale(k.s ?? 1, k.s ?? 1); g.translate(-cw / 2, 0);
        g.globalAlpha = A * al * (o.alpha ?? 1);
        const tp = FLPT.lib.textPath(ch, font);
        g.fillStyle = o.color || C.ink;
        if (tp) { g.fill(tp.path); if (o.outline) { g.lineWidth = Math.max(1, size * 0.018); g.strokeStyle = o.outline === true ? C.ink : o.outline; g.lineJoin = 'round'; g.stroke(tp.path); } } else env.fillText(g, ch, 0, 0, font);
        g.restore();
      });
      if (shown && o.id !== false) env.registerBox(o.id ?? str, str, screenBox(0, -m.asc, w, m.desc));
      g.restore();
      return w;
    }
    /** The cell width of machine text at a size. */
    function monoW(size) { return env.measure('M', monoFont(size)).w; }
    /** Machine text, each glyph jittered by hand. o: count (typed so far), al, jit, caret, key, id. Returns the cell width. */
    function mono(str, x, y, size, color, o = {}) {
      str = String(str);
      const font = monoFont(size), cw = monoW(size), R = RNG('txt', o.key ?? str, B), jit = o.jit ?? 0.9, A = g.globalAlpha;
      const n = Math.max(0, Math.min(o.count ?? str.length, str.length)), shown = str.slice(0, n);
      g.save();
      g.fillStyle = color || C.ink; g.globalAlpha = A * (o.al ?? 1);
      if (shown.trim()) env.textPath(shown, font);   // the line, for the text report
      for (let i = 0; i < n; i++) {
        const ch = str[i];
        if (ch === ' ') continue;
        const tp = FLPT.lib.textPath(ch, font);
        g.save(); g.translate(x + i * cw + R.n(jit), y + R.n(jit)); g.rotate(R.n(0.045));
        if (tp) g.fill(tp.path); else env.fillText(g, ch, 0, 0, font);
        g.restore();
      }
      if (o.caret && Math.floor(TT * 2.4) % 2 === 0) { g.fillRect(x + n * cw + 2, y - size * 0.78, cw * 0.62, size * 0.92); }
      if (shown.trim() && o.id !== false) env.registerBox(o.id ?? str, shown, screenBox(x, y - size * 0.78, x + n * cw, y + size * 0.22));
      g.restore();
      return cw;
    }

    // ---- surfaces: full-bleed worlds in ink
    /** Warm paper with faint ruled lines. o: fill, ruled, x0, y0, x1, y1 (world bounds; the frame by default), key */
    function paperSheet(key = 'sheet', o = {}) {
      const x0 = o.x0 ?? -60, y0 = o.y0 ?? -60, x1 = o.x1 ?? W + 60, y1 = o.y1 ?? H + 60;
      paint(box(x0, y0, x1 - x0, y1 - y0), { raw: true, line: false, fill: o.fill || C.paper, key: key + 'b', tex: [{ k: 'pencil', c: '#fffaf0', al: 0.45, per: 700, a: -0.6 }] });
      if (o.ruled !== false) {
        g.save(); g.strokeStyle = C.paperLine; g.lineWidth = 1.4; g.beginPath();
        for (let y = y0 + 260; y < y1; y += 64) { g.moveTo(x0, y); g.lineTo(x1, y + RNG('rl', key, y).n(2)); }
        g.stroke(); g.restore();
      }
    }
    /** A wooden desk: pencil-grain base and inked grain lines that wander. o: fill, gw, gal */
    function woodSurface(x0, y0, x1, y1, key = 'wood', o = {}) {
      const S = RNG('woodS', key), R = RNG('woodR', key, B), A = g.globalAlpha;
      paint(box(x0, y0, x1 - x0, y1 - y0), {
        raw: true, line: false, fill: o.fill || C.wood, key,
        tex: [{ k: 'pencil', c: C.woodL, al: 0.32, a: 0.02, len: 46, per: 900 }, { k: 'pencil', c: C.woodD, al: 0.16, a: -0.03, len: 30, per: 1400 }],
      });
      g.save(); g.beginPath();
      for (let y = y0; y < y1; y += S.r(11, 24)) {
        const f = S.r(0.002, 0.006), ph = S.r(0, TAU), Am = S.r(1, 5);
        let down = S.f() < 0.8, left = S.r(40, 420);
        g.moveTo(x0, y);
        for (let x = x0; x <= x1; x += 22) {
          const yy = y + Math.sin(x * f + ph) * Am + R.n(0.5);
          if (down) g.lineTo(x, yy); else g.moveTo(x, yy);
          left -= 22;
          if (left <= 0) { down = !down; left = down ? S.r(60, 480) : S.r(10, 70); if (down) g.moveTo(x, yy); }
        }
      }
      g.strokeStyle = C.ink; g.lineWidth = o.gw ?? 1.3; g.globalAlpha = A * (o.gal ?? 0.42); g.stroke();
      g.restore();
    }
    /**
     * Inside the machine: navy, dust specks and tiny crosses that boil (screen space). o: fill, dust, crosses,
     * drift [dx, dy] (parallax offsets, px; the specks wrap), al, key
     */
    function darkWorld(key = 'inside', o = {}) {
      if (o.fill !== false) fillAll(o.fill || C.navy);
      const R = RNG('dust', key), J = RNG('dustj', key, B), [dx, dy] = o.drift || [0, 0];
      const wrap = (v, m) => ((v % m) + m) % m;
      g.save(); X.screen(); g.globalAlpha *= o.al ?? 1;
      g.fillStyle = o.speck || 'rgba(150,160,220,0.28)'; g.beginPath();
      for (let i = 0; i < (o.dust ?? 420); i++) { const s = R.r(1, 2.4); g.rect(wrap(R.r(0, W) + dx, W) + J.n(0.6), wrap(R.r(0, H) + dy, H) + J.n(0.6), s, R.r(1, 2.4)); }
      g.fill();
      g.strokeStyle = o.cross || 'rgba(60,66,130,0.55)'; g.lineWidth = 1.2; g.beginPath();
      for (let i = 0; i < (o.crosses ?? 110); i++) { const x = wrap(R.r(0, W) + dx * 1.4, W), y = wrap(R.r(0, H) + dy * 1.4, H); g.moveTo(x - 5, y); g.lineTo(x + 5, y); g.moveTo(x, y - 5); g.lineTo(x, y + 5); }
      g.stroke(); g.restore();
    }
    /** A cream cloth with hatched diagonal stripes (a second desk, a tablecloth). o: base, stripe, hatchC, x0, y0, x1, y1 */
    function stripedCloth(key = 'cloth', o = {}) {
      const x0 = o.x0 ?? -600, y0 = o.y0 ?? -600, x1 = o.x1 ?? W + 600, y1 = o.y1 ?? H + 600;
      paint(box(x0, y0, x1 - x0, y1 - y0), { raw: true, line: false, fill: o.base || C.cream, key: key + 'b', tex: [{ k: 'pencil', c: '#fffaf0', al: 0.5, per: 500, a: -0.8 }] });
      const span = (y1 - y0) + (x1 - x0);
      for (let k = Math.floor((x0 - (y1 - y0)) / 190); k < Math.ceil(x1 / 190); k++) {
        const x = k * 190, P = [[x, y0], [x + 95, y0], [x + 95 + (y1 - y0), y1], [x + (y1 - y0), y1]];
        if (x + span < x0) continue;
        paint(P, { raw: true, line: false, fill: o.stripe || 'rgba(240,205,120,0.45)', key: key + 's' + k, tex: [{ k: 'hatch', a: Math.PI / 4, gap: 4, c: o.hatchC || '#d9a441', al: 0.35, w: 1, dash: [30, 140] }] });
      }
    }

    // ---- props
    /** A mug seen from above; the coffee is a good bridge to a round thing (a moon, a port, a planet). o: coffee, steam */
    function inkMug(x, y, r, key = 'mug', o = {}) {
      paint(ellipsePts(x + 16, y + 20, r, r, 0, 40), { fill: 'rgba(92,55,28,0.25)', line: false, key: key + 'sh', tex: [{ k: 'hatch', a: 0.8, gap: 5, al: 0.4 }] });
      paint(rrectPts(x + r * 0.7, y - 20, r * 0.75, 40, 18), { fill: o.body || '#f2ede2', key: key + 'h', w: 3 });
      paint(ellipsePts(x, y, r, r, 0, 44), { fill: o.body || '#f2ede2', key: key + 'b', w: 3.2, tex: [{ k: 'pencil', c: '#d9cdb8', al: 0.6, per: 60 }, { k: 'hatch', gap: 4, a: 0.7, al: 0.3, dash: [8, 24], dens: (px, py) => clamp((px - x + py - y) / r) }] });
      ink(ellipsePts(x, y, r * 0.84, r * 0.84, 0, 40), { closed: true, w: 2, key: key + 'rim' });
      paint(ellipsePts(x, y, r * 0.78, r * 0.78, 0, 40), { fill: o.coffee || '#6e4128', key: key + 'c', w: 1.6, tex: [{ k: 'cross', c: '#2e170b', al: 0.35, gap: 5 }] });
      if (o.steam !== false) for (let i = 0; i < 3; i++) { const P = []; for (let k = 0; k <= 10; k++) P.push([x - 30 + i * 30 + Math.sin(k * 0.8 + TT * 3 + i) * 10, y - r - 20 - k * 14]); ink(P, { w: 2.4, color: 'rgba(58,36,23,0.45)', key: key + 'st' + i }); }
    }
    /** A yellow pencil lying at (tx, ty), pointing along ang, len long, scale k. */
    function drawPencil(tx, ty, ang, len, k = 1, key = 'pencil') {
      g.save(); g.translate(tx, ty); g.rotate(ang); g.scale(k, k);
      paint([[46, -16], [len, -16], [len, 16], [46, 16]], {
        fill: C.yellow, key: key + 'b', w: 3,
        tex: [{ k: 'hatch', a: 0.05, gap: 5, c: '#a8741d', al: 0.55, w: 1.1, dash: [20, 90], dens: (x, y) => (y > 5 ? 1 : 0.08) }, { k: 'pencil', c: '#fff1b8', al: 0.5, a: 0.05, len: 30, per: 120, dens: (x, y) => (y < -4 ? 1 : 0.1) }],
      });
      ink([[50, -5], [len, -5]], { w: 1.6, key: key + 'f1', alpha: 0.7 });
      ink([[50, 6], [len, 6]], { w: 1.6, key: key + 'f2', alpha: 0.7 });
      paint([[1, 0], [46, -15], [46, 15]], { fill: '#efcf9f', key: key + 'c', w: 2.6, tex: [{ k: 'hatch', a: 1.2, gap: 4, al: 0.35, dens: (x, y) => (y > 2 ? 1 : 0.1) }] });
      paint([[0, 0], [15, -5], [15, 5]], { fill: '#3b3438', key: key + 't', w: 2 });
      paint([[len, -17], [len + 26, -17], [len + 26, 17], [len, 17]], { fill: '#bcb7ab', key: key + 'fe', w: 2.6, tex: [{ k: 'hatch', a: Math.PI / 2, gap: 5, al: 0.5 }] });
      paint(rrectPts(len + 24, -16, 34, 32, 10), { fill: '#e58f8c', key: key + 'e', w: 2.6, tex: [{ k: 'pencil', c: C.roseD, al: 0.5, per: 60 }] });
      g.restore();
    }
    /** An n-pointed asterisk of strokes (a spark, a flower centre): r0..r1, rotation rot. */
    function asterisk(x, y, r0, r1, n, rot, color, w) {
      g.save(); g.strokeStyle = color || C.ink; g.lineWidth = w ?? 2; g.lineCap = 'round'; g.beginPath();
      for (let i = 0; i < n; i++) { const a = (i / n) * TAU + rot; g.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0); g.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1); }
      g.stroke(); g.restore();
    }
    const popS = (t) => (TT < t ? 0 : EZback(clamp((TT - t) / 0.25)));
    function EZback(t) { t = clamp(t) - 1; return 1 + 2.70158 * t * t * t + 1.70158 * t * t; }
    /** A hand-painted tag for a step: a dot, a label and its argument in mono, popping in at t. o: size, rot, dot, al */
    function pill(label, arg, x, y, t, o = {}) {
      const size = o.size ?? 30, cw = monoW(size), text = arg ? label + '(' + arg + ')' : label;
      const w = 70 + cw * text.length, h = size * 1.75, pop = EZback(clamp((TT - t) / 0.12));
      if (TT < t || pop <= 0) return null;
      g.save(); g.translate(x, y); g.scale(pop, pop); g.rotate(o.rot ?? -0.02);
      paint(rrectPts(4, 6, w, h, 14), { fill: 'rgba(58,36,23,0.35)', line: false, key: 'pillsh' + label });
      paint(rrectPts(0, 0, w, h, 14), { fill: o.fill || C.paper, key: 'pill' + label, w: 3, tex: [{ k: 'pencil', c: '#e8d6b0', al: 0.6, per: 90 }] });
      g.beginPath(); g.arc(30, h / 2, 9, 0, TAU); g.fillStyle = o.dot || C.green; g.fill(); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke();
      mono(text, 50, h / 2 + size * 0.36, size, C.ink, { key: 'pl' + label, id: o.id ?? 'pill:' + text });
      g.restore();
      return { w, h };
    }
    /** The plan: red pencil dashes, written on. Keep the plan apart from the doing (ink). o: closed, frac, c, w, amt, dash, al, key */
    function planInk(P, o = {}) {
      if ((o.frac ?? 1) <= 0) return null;
      return ink(P, { closed: o.closed, color: o.c ?? C.plan, w: o.w ?? 3.4, amt: o.amt ?? 2.2, key: o.key ?? 'plan', frac: o.frac, alpha: o.al ?? 1, dash: o.dash ?? [16, 11] });
    }
    /** A sheet of notes: paper, ruled, a pencil shade from the bottom-right, scribbled lines written on by frac. o: lines, frac, key, fill */
    function noteSheet(x, y, w, h, o = {}) {
      const key = o.key ?? 'note';
      const P = paint(box(x, y, w, h), { fill: o.fill || C.paper, key, w: 3, tex: [{ k: 'pencil', c: '#e8d6b0', al: 0.5, per: 90 }, { k: 'hatch', a: 0.8, gap: 5, al: 0.16, dens: (px, py) => clamp((px - x + py - y - (w + h) * 0.55) / ((w + h) * 0.4)) }] });
      const lines = o.lines ?? Math.max(1, Math.floor((h - 80) / 64));
      for (let i = 0; i < lines; i++) {
        const L = 0.55 + 0.4 * (((i * 7) % 5) / 4), yy = y + 70 + i * 64;
        ink([[x + 36, yy], [x + 36 + (w - 72) * L, yy]], { w: 2.4, color: 'rgba(58,36,23,0.55)', key: key + 'l' + i, frac: o.frac == null ? 1 : clamp(o.frac * lines - i) });
      }
      return P;
    }

    // ---- the hero: a terracotta ink drop with a pair of eyes; works on paper and (with a glow) on navy
    /**
     * hero(x, y, r, { key, dark, mood: 'smile'|'happy'|'wow'|'worried', look: [dx, dy], squash (-1..1), shadow,
     * bob }) -> its outline points. Idle bob and blink come from t; squash is the scene's (a hop, a landing).
     */
    function hero(x, y, r, o = {}) {
      const key = o.key ?? 'hero', dark = !!o.dark, sq = clamp(o.squash ?? 0, -0.6, 0.6);
      if (o.bob !== false) y += Math.sin(TT * TAU * 0.9 + key.length) * r * 0.04;
      const rx = r * (1 + sq * 0.5), ry = r * (1 - sq * 0.5), cy = y + (r - ry);
      if (!dark && o.shadow !== false) paint(ellipsePts(x + r * 0.5, y + r * 0.82, r * 1.05, r * 0.42, 0, 28), { fill: 'rgba(58,36,23,0.3)', line: false, key: key + 'sh', tex: [{ k: 'hatch', a: 0.8, gap: 4, al: 0.6 }] });
      const P = ellipsePts(x, cy, rx, ry, 0, 30);
      if (dark) { ink(P, { closed: true, color: 'rgba(240,150,110,0.18)', w: r * 0.7, key: key + 'g' }); ink(P, { closed: true, color: 'rgba(200,208,240,0.2)', w: 16, key: key + 'g2' }); }
      paint(P, {
        fill: C.terra, key, line: dark ? C.peri : C.ink, w: dark ? 5 : Math.max(3, r * 0.08),
        tex: [{ k: 'cross', c: C.orangeD, al: 0.5, gap: 5, dens: (px, py) => clamp(0.25 + (px - x + py - cy) / (r * 1.6)) }, { k: 'pencil', c: C.orangeL, al: 0.4, per: 60, dens: (px, py) => clamp((x - px + cy - py) / r) }],
      });
      ink(arcPts(x, cy, r * 0.7, Math.PI * 1.08, Math.PI * 1.42, 8, ry / rx), { w: Math.max(2, r * 0.08), color: 'rgba(255,238,214,0.85)', key: key + 'hl', amt: 0.4 });
      const [lx, ly] = o.look || [0, 0], blink = (B + key.length * 7) % 41 < 2, ey = cy + r * 0.04 + ly * r * 0.08;
      for (const s of [-1, 1]) {
        const ex = x + s * r * 0.28 + lx * r * 0.08;
        if (blink) ink([[ex - r * 0.08, ey], [ex + r * 0.08, ey]], { w: r * 0.06, color: C.ink, key: key + 'bl' + s, amt: 0.3 });
        else { g.fillStyle = C.ink; g.beginPath(); g.ellipse(ex, ey, r * 0.075, r * (o.mood === 'wow' ? 0.13 : 0.1), 0, 0, TAU); g.fill(); }
        if (o.mood === 'worried') ink([[ex - r * 0.1, ey - r * 0.2 + s * r * 0.03], [ex + r * 0.1, ey - r * 0.2 - s * r * 0.03]], { w: r * 0.045, color: C.ink, key: key + 'br' + s, amt: 0.3 });
      }
      if (o.mood === 'happy') ink(arcPts(x + lx * r * 0.06, cy + r * 0.3, r * 0.2, Math.PI * 0.15, Math.PI * 0.85, 10), { w: r * 0.06, color: C.ink, key: key + 'm', amt: 0.4 });
      else if (o.mood === 'smile') ink(arcPts(x + lx * r * 0.06, cy + r * 0.26, r * 0.12, Math.PI * 0.2, Math.PI * 0.8, 8), { w: r * 0.05, color: C.ink, key: key + 'm', amt: 0.3 });
      else if (o.mood === 'wow') { g.fillStyle = C.ink; g.beginPath(); g.ellipse(x + lx * r * 0.06, cy + r * 0.34, r * 0.07, r * 0.09, 0, 0, TAU); g.fill(); }
      return P;
    }

    // ---- captions: a paper card with an ink outline (draw after the camera, in screen space)
    /** A paper card with a hatched shadow and a hand-lettered label. o: s (scale), rot, frac, color, weight, id */
    function card(str, x, y, size, o = {}) {
      const w = handW(str, size, o.weight ?? 400) + size * 0.9, h = size * 1.45, s = o.s ?? 1;
      if (s <= 0.01) return null;
      g.save(); g.translate(x, y); g.rotate(o.rot ?? -0.02); g.scale(s, s);
      paint(rrectPts(-w / 2 + 6, -h / 2 + 8, w, h, 10), { fill: 'rgba(58,36,23,0.3)', line: false, key: 'cardsh' + str, tex: [{ k: 'hatch', a: 0.8, gap: 4, al: 0.5 }] });
      paint(rrectPts(-w / 2, -h / 2, w, h, 10), { fill: o.fill || C.paper, key: 'card' + str, w: 3, tex: [{ k: 'pencil', c: '#e8d6b0', al: 0.5, per: 90 }] });
      hand(str, -w / 2 + size * 0.45, size * 0.33, size, { color: o.color ?? C.ink, weight: o.weight, key: 'cardt' + str, frac: o.frac, id: o.id ?? 'card:' + str });
      g.restore();
      return { w, h };
    }
    /**
     * A label in the world (not pinned to the frame: the camera carries it): hand lettering written on from t, with an
     * optional inked arrow (points, the head at the last). o: color, weight, rot, size, arrow, alpha, id
     */
    function label(str, x, y, t, o = {}) {
      const f = clamp((TT - t) / 0.55);
      if (f <= 0) return null;
      const size = o.size ?? 64, color = o.color || C.ink;
      const w = hand(str, x, y, size, { weight: o.weight ?? 700, color, key: 'lb' + str, id: o.id ?? 'label:' + str, frac: f, rot: o.rot ?? -0.03, alpha: o.alpha });
      const P = o.arrow;
      if (P && P.length > 1) {
        const n = P.length, a = Math.atan2(P[n - 1][1] - P[n - 2][1], P[n - 1][0] - P[n - 2][0]), u = clamp((TT - t - 0.35) / 0.35), hl = size * 0.4;
        if (u > 0) ink(P, { w: Math.max(2.4, size * 0.05), color, key: 'la' + str, frac: u, amt: 1, alpha: o.alpha });
        if (u >= 1) ink([[P[n - 1][0] - hl * Math.cos(a - 0.5), P[n - 1][1] - hl * Math.sin(a - 0.5)], P[n - 1], [P[n - 1][0] - hl * Math.cos(a + 0.5), P[n - 1][1] - hl * Math.sin(a + 0.5)]], { w: Math.max(2.4, size * 0.05), color, key: 'lh' + str, amt: 0.6, alpha: o.alpha });
      }
      return w;
    }
    /** A caption, bottom centre (screen space), written on from t over 0.6 s. */
    function caption(str, t, o = {}) {
      g.save(); X.screen();
      const r = card(str, o.x ?? W / 2, o.y ?? H - 118, o.size ?? 52, { rot: o.rot ?? 0.012, frac: o.frac ?? clamp((TT - t) / 0.6), s: TT < t ? 0 : 1, id: o.id ?? 'caption:' + str, fill: o.fill });
      g.restore();
      return r;
    }

    return {
      /** Runtime-internal: the runtime binds the frame; never call it. */
      bind(c) { X = c; g = c.g; B = c.B; TT = c.TT; SC = c.scale || 1; },
      C, HAND, MONO, RAINBOW,
      // geometry
      ellipsePts, rrectPts, arcPts, xform, bbox, resample, pathLen, subPath, pointAt, box, dist,
      // the medium
      wobble, trace, ink, paint, texture, hatch, pencil, stipple, grain,
      construct, cline, ruler, sparkBurst, burst, star4, rainbow, hexGrid, irisRim, irisHole, asterisk,
      // camera
      depth, toScreen, fillAll, screenBox,
      // type
      hand, handW, letters, mono, monoW,
      // worlds and props
      paperSheet, woodSurface, darkWorld, stripedCloth, inkMug, drawPencil, pill, planInk, noteSheet, hero,
      // captions
      card, label, caption, popS,
    };
  },
});
