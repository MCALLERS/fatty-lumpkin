// =====================================================================
//  engine/styles/isometric/kit.js: Isometric, calm product illustration in 2:1 dimetric on a white ground, drawn
//  only with constant hairlines: grey silhouettes and edges, lighter inner and receding lines, faces filled white so
//  nearer objects hide farther lines; rounded slabs with visible thickness, grids of repeated parts, one small dark
//  accent per frame. Motion on ones with spring settles; otherwise still.
//  A 16:9 port of cth9191/animate's isometric style (styles/isometric/kit.js and the parts of kit/core.js it uses),
//  MIT, Copyright (c) 2026 cth9191; the full notice is LICENSE beside this file and travels with every copy.
//  Port changes (Bombadillo AI, 2026): an FLPT.style plug-in with closure state instead of globals, bound per frame
//  (the palette and the projection reset every frame, so any frame draws alone); the frame is 1920x1080 at 30 fps and
//  the hairline 2.4 px; the line width divides out the camera's zoom but keeps the preview scale; type is drawn from
//  glyph outlines of bundled OFL faces (IBM Plex Sans and Mono) and registers its boxes with the runtime; captions and
//  tags draw in screen space (no DEFER queue); the morph renderer's hooks became blob and bridge. New for 16:9 talks:
//  label (a callout), title, laptop, rack, tower, phone, card, bars, block (base-ten blocks), lane, packet, lod/soft
//  (detail that thins out as the camera pulls back) and a dark theme per frame.
//
//  Hidden lines are painter's order: draw back to front (smaller x + y first, lower z first in a stack). Every solid
//  fills its faces white before stroking, so whatever is drawn later hides what is behind.
// =====================================================================
FLPT.style('isometric', {
  tokens: { paper: '#ffffff', ink: '#5c5c64', font: '"IBM Plex Sans", "Helvetica Neue", Arial, sans-serif', mono: '"IBM Plex Mono", Menlo, monospace', accent: '#232327' },
  fonts: [
    { family: 'IBM Plex Sans', file: 'IBMPlexSans-Light.ttf', weight: 300 },
    { family: 'IBM Plex Sans', file: 'IBMPlexSans-Regular.ttf', weight: 400 },
    { family: 'IBM Plex Mono', file: 'IBMPlexMono-Regular.ttf', weight: 400 },
  ],
  ones: true,
  make(env) {
    const { W, H, clamp, lerp, EZ } = env;
    const TAU = Math.PI * 2, DEG = Math.PI / 180;
    const SANS = env.tokens.font, MONO = env.tokens.mono;
    let g = null, TT = 0, F = 0, SC = 1, MORPH = null;   // bound per frame

    // ---- palette (light: measured from the references; dark: the same roles on a near-black ground)
    const LIGHT = Object.freeze({ paper: '#ffffff', face: '#ffffff', edge: '#a4a4ac', inner: '#e0e0e4', accent: '#232327', text: '#5c5c64', textD: '#9a9aa2' });
    const DARK = Object.freeze({ paper: '#101014', face: '#101014', edge: '#8e8e9a', inner: '#34343c', accent: '#f4f4f6', text: '#b4b4be', textD: '#6a6a74' });
    const PAL = { ...LIGHT };
    function theme(name) { Object.assign(PAL, name === 'dark' ? DARK : LIGHT); return PAL; }
    // the whole frame in the ground colour (call first; { dark: true } switches this frame to the dark theme)
    function ground(o = {}) {
      if (o.dark != null) theme(o.dark ? 'dark' : 'light');
      g.save(); g.setTransform(SC, 0, 0, SC, 0, 0); g.fillStyle = PAL.paper; g.fillRect(0, 0, W, H); g.restore();
    }
    const hex = (c) => [1, 3, 5].map((i) => parseInt(String(c).slice(i, i + 2), 16));
    function mixHex(a, b, u) {
      const A = hex(a), B = hex(b), k = clamp(u);
      return '#' + A.map((v, i) => Math.round(lerp(v, B[i], k)).toString(16).padStart(2, '0')).join('');
    }
    const HAIR = 2.4;   // px on the 1920x1080 frame (animate: 2.0 at 1080 wide on a smaller figure); constant at any zoom

    // ---- geometry (animate kit/core.js)
    const mod = (a, n) => ((a % n) + n) % n;
    function ellipsePts(cx, cy, rx, ry, rot = 0, n = 64, a0 = 0, a1 = TAU) {
      const P = [], c = Math.cos(rot), s = Math.sin(rot), full = Math.abs(a1 - a0 - TAU) < 1e-6;
      for (let i = 0; i < n; i++) { const a = a0 + ((a1 - a0) * i) / (full ? n : n - 1), x = Math.cos(a) * rx, y = Math.sin(a) * ry; P.push([cx + x * c - y * s, cy + x * s + y * c]); }
      return P;
    }
    function rrectPts(x, y, w, h, r, n = 6) {
      r = Math.min(r, w / 2, h / 2);
      const P = [], cs = [[x + w - r, y + r, -Math.PI / 2], [x + w - r, y + h - r, 0], [x + r, y + h - r, Math.PI / 2], [x + r, y + r, Math.PI]];
      for (const [cx, cy, a0] of cs) for (let i = 0; i <= n; i++) { const a = a0 + ((Math.PI / 2) * i) / n; P.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
      return P;
    }

    // ---------------------------------------------------------------------
    //  projection: 2:1 dimetric (edges slope 0.5 = 26.57 deg; camera 30 deg above the ground, 45 deg round).
    //  x runs right-down, y runs left-down, z runs up. One world unit along x or y = u px across the screen.
    // ---------------------------------------------------------------------
    const ZK = 1.2247;                         // z foreshortening relative to u (cos 30 / cos 45)
    const ISO_VIEW = [0.6124, 0.6124, 0.5];    // unit vector from the scene toward the viewer
    const ISO0 = { ox: W / 2, oy: H * 0.62, u: 1 };
    let ISO = { ...ISO0 };
    function setIso(o) { ISO = { ox: o.ox ?? ISO0.ox, oy: o.oy ?? ISO0.oy, u: o.u ?? 1 }; return ISO; }
    const getIso = () => ({ ...ISO });
    const iso = (x, y, z = 0) => [ISO.ox + (x - y) * ISO.u, ISO.oy + ((x + y) * 0.5 - z * ZK) * ISO.u];
    const isoP = (p) => iso(p[0], p[1], p[2]);
    // a sub-world: (x, y, z) of this projection becomes the origin, k world units per sub-world unit (a model city)
    const subIso = (x, y, z, k) => { const p = iso(x, y, z); return { ox: p[0], oy: p[1], u: ISO.u * k }; };
    const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    const vsc = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
    const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

    // ---- hairlines: the width is screen pixels whatever the camera zoom (the preview scale is kept)
    function zoomNow() { const m = g.getTransform(); return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) / SC || 1; }
    function hair(color, w = HAIR) { g.strokeStyle = color; g.lineWidth = w / zoomNow(); g.lineJoin = 'round'; g.lineCap = 'round'; }
    function polyPath(P, closed) {
      g.beginPath(); if (!P.length) return;
      g.moveTo(P[0][0], P[0][1]); for (let i = 1; i < P.length; i++) g.lineTo(P[i][0], P[i][1]);
      if (closed) g.closePath();
    }
    function line3(P3, color = PAL.edge, w = HAIR) { polyPath(P3.map(isoP), false); hair(color, w); g.stroke(); }
    function hull2(P) {   // convex hull (monotone chain) of 2D points
      const S = P.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
      const lo = [], up = [];
      for (const p of S) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
      for (let i = S.length - 1; i >= 0; i--) { const p = S[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
      return lo.slice(0, -1).concat(up.slice(0, -1));
    }
    // where a point in g's current coordinates lands on screen (scene units, 1920x1080)
    function toScreen(x, y) { const T = g.getTransform(); return [(T.a * x + T.c * y + T.e) / SC, (T.b * x + T.d * y + T.f) / SC]; }
    // detail that thins out with the camera: px = a length on screen; 0 below a px, 1 from b px up
    const seen = (len) => len * ISO.u * zoomNow();
    const lod = (px, a = 3, b = 9) => clamp((px - a) / (b - a));
    const soft = (c, v) => (v >= 1 ? c : mixHex(PAL.face, c, v));

    // ---------------------------------------------------------------------
    //  the one solid: a rounded rectangle w x d in the plane (a, b) from corner o, extruded h along n.
    //  Draws the white fill of the silhouette, the silhouette and the cap facing the viewer as edges, and the one
    //  visible extrusion line at the nearest corner (lighter when the corner is rounded).
    //  Returns { front, at(u, v, s) }: at() gives the world point of plane coords (u, v) on cap s (0 base, 1 top).
    //  opt: { r corner radius, seg, fill, edge, crease (false: no corner line), creaseC }
    // ---------------------------------------------------------------------
    function isoSlab(o, a, b, n, w, d, h, opt = {}) {
      const r = Math.max(0, Math.min(opt.r ?? 0, w / 2, d / 2));
      const R2 = r > 0.01 ? rrectPts(0, 0, w, d, r, opt.seg ?? 6) : [[0, 0], [w, 0], [w, d], [0, d]];
      const at = (u, v, s = 0) => [o[0] + a[0] * u + b[0] * v + n[0] * h * s, o[1] + a[1] * u + b[1] * v + n[1] * h * s, o[2] + a[2] * u + b[2] * v + n[2] * h * s];
      const front = vdot(n, ISO_VIEW) >= 0 ? 1 : 0;
      const S0 = R2.map(([u, v]) => isoP(at(u, v, 0))), S1 = h > 0 ? R2.map(([u, v]) => isoP(at(u, v, 1))) : S0;
      const edge = opt.edge ?? PAL.edge;
      g.save();
      polyPath(hull2(S0.concat(S1)), true);
      g.fillStyle = opt.fill ?? PAL.face; g.fill();
      hair(edge); g.stroke();
      polyPath(front ? S1 : S0, true); g.stroke();
      if (opt.crease !== false && h > 0) {   // the extrusion line at the corner nearest the viewer
        const k = r * 0.2929, mids = [[w - k, k], [w - k, d - k], [k, d - k], [k, k]];
        let best = mids[0], bd = -1e9;
        for (const m of mids) { const q = vdot(at(m[0], m[1], front), ISO_VIEW); if (q > bd) { bd = q; best = m; } }
        polyPath([isoP(at(best[0], best[1], front)), isoP(at(best[0], best[1], 1 - front))], false);
        hair(opt.creaseC ?? (r > 2 ? PAL.inner : edge)); g.stroke();
      }
      g.restore();
      return { front, at, w, d, h };
    }
    // a box lying on the ground plane: x, y, z the back-bottom corner; w along x, d along y, h up
    function isoBox(x, y, z, w, d, h, o = {}) { return isoSlab([x, y, z], [1, 0, 0], [0, 1, 0], [0, 0, 1], w, d, h, o); }
    // a panel standing in the x-z plane (its front faces +y, toward the lower left); t = thickness toward +y
    function isoPanelY(x, y, z, w, ht, t, o = {}) { return isoSlab([x, y, z], [1, 0, 0], [0, 0, 1], [0, 1, 0], w, ht, t, o); }
    // a panel standing in the y-z plane (its front faces +x, toward the lower right); t = thickness toward +x
    function isoPanelX(x, y, z, d, ht, t, o = {}) { return isoSlab([x, y, z], [0, 1, 0], [0, 0, 1], [1, 0, 0], d, ht, t, o); }
    // an upright cylinder centred on (x, y), from z up h
    function isoCyl(x, y, z, r, h, o = {}) { return isoSlab([x - r, y - r, z], [1, 0, 0], [0, 1, 0], [0, 0, 1], 2 * r, 2 * r, h, { seg: 10, ...o, r, crease: false }); }
    // stacked plates (bottom-up). layers: [{ h, inset, gap, r, dz }]. Returns the top z.
    function isoPlates(x, y, z, w, d, layers, o = {}) {
      let zz = z;
      for (const L of layers) {
        const i = L.inset ?? 0; zz += L.gap ?? 0;
        isoBox(x + i, y + i, zz + (L.dz ?? 0), w - 2 * i, d - 2 * i, L.h, { r: L.r ?? o.r ?? 18, ...o });
        zz += L.h + (L.dz ?? 0);
      }
      return zz;
    }
    // a grid of repeated parts in painter's order (back to front): fn(i, j) draws the part at column i, row j
    function isoGrid(nx, ny, fn) {
      for (let s = 0; s <= nx + ny - 2; s++) for (let i = Math.max(0, s - ny + 1); i <= Math.min(nx - 1, s); i++) fn(i, s - i);
    }

    // ---------------------------------------------------------------------
    //  faces: flat things on a plane. A face is fp(u, v) -> world point, u to the right and v DOWN (so text reads).
    //  faceOf(origin, a, b): origin = the face's top-left, a = right, b = down.
    // ---------------------------------------------------------------------
    const faceOf = (o, a, b) => (u, v) => [o[0] + a[0] * u + b[0] * v, o[1] + a[1] * u + b[1] * v, o[2] + a[2] * u + b[2] * v];
    // the front face of a slab returned by isoSlab, with v measured down from the top
    const slabFace = (S, flipV = true) => (u, v) => S.at(u, flipV ? S.d - v : v, S.front);
    // the three faces of a box you can see: top (u along x, v along y), front (+y side), side (+x side)
    const boxTop = (x, y, z, w, d, h) => faceOf([x, y, z + h], [1, 0, 0], [0, 1, 0]);
    const boxFront = (x, y, z, w, d, h) => faceOf([x, y + d, z + h], [1, 0, 0], [0, 0, -1]);
    const boxSide = (x, y, z, w, d, h) => faceOf([x + w, y, z + h], [0, 1, 0], [0, 0, -1]);
    function facePath(fp, P2, closed = true) { polyPath(P2.map(([u, v]) => isoP(fp(u, v))), closed); }
    function faceRR(fp, x, y, w, h, r, o = {}) {   // a rounded rectangle on a face: { fill, stroke (false = none), w }
      facePath(fp, r > 0.01 ? rrectPts(x, y, w, h, Math.min(r, w / 2, h / 2), o.seg ?? 5) : [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true);
      if (o.fill) { g.fillStyle = o.fill; g.fill(); }
      if (o.stroke !== false) { hair(o.stroke ?? PAL.inner, o.w ?? HAIR); g.stroke(); }
    }
    function faceEll(fp, u, v, rx, ry, o = {}) {
      facePath(fp, ellipsePts(u, v, rx, ry, 0, o.n ?? 24), true);
      if (o.fill) { g.fillStyle = o.fill; g.fill(); }
      if (o.stroke) { hair(o.stroke, o.w ?? HAIR); g.stroke(); }
    }
    // a raised rounded slab on a face (a pill, a key, a button), t thick toward the viewer. o: isoSlab options
    function faceSlab(fp, x, y, w, h, t, o = {}) {
      const p0 = fp(0, 0), a = vsub(fp(1, 0), p0), b = vsub(fp(0, 1), p0);
      let nrm = vcross(a, b); const l = Math.hypot(...nrm) || 1; nrm = vsc(nrm, (vdot(nrm, ISO_VIEW) < 0 ? -1 : 1) / l);
      return isoSlab(fp(x, y), a, b, nrm, w, h, t, { r: Math.min(w, h) / 2, seg: 4, ...o });
    }
    function faceLine(fp, P2, color = PAL.inner, w = HAIR) { facePath(fp, P2, false); hair(color, w); g.stroke(); }
    const facePts = (fp, P2) => P2.map(([u, v]) => isoP(fp(u, v)));   // projected outline (for bridges)
    // the accent: one small dark dot (an LED, a status light) on a face. One per frame; it marks the focus.
    function accentDot(fp, u, v, r) { faceEll(fp, u, v, r, r, { fill: PAL.accent }); }
    // a small round lamp on a face: lit = edge grey, unlit = an outline (keeps the dark for the accent)
    function lamp(fp, u, v, r, lit) { faceEll(fp, u, v, r, r, { fill: lit ? PAL.edge : PAL.face, stroke: PAL.edge }); }

    // ---------------------------------------------------------------------
    //  springs: closed-form damped oscillation of time (no state, so any frame renders alone)
    //  spring(t, t0) goes 0 -> 1 with an overshoot; kick(t, t0) goes 0 -> +1 -> -... -> 0 (squash, sway).
    //  k = stiffness (higher = faster), damp = damping ratio (0.3 bouncy .. 0.9 calm; under 1)
    // ---------------------------------------------------------------------
    function spring(t, t0, o = {}) {
      if (t <= t0) return 0;
      const w0 = Math.sqrt(o.k ?? 170), z = Math.min(0.98, o.damp ?? 0.45), wd = w0 * Math.sqrt(1 - z * z), s = t - t0;
      return 1 - Math.exp(-z * w0 * s) * (Math.cos(wd * s) + ((z * w0) / wd) * Math.sin(wd * s));
    }
    function kick(t, t0, o = {}) {
      if (t <= t0) return 0;
      const w0 = Math.sqrt(o.k ?? 260), z = Math.min(0.98, o.damp ?? 0.3), wd = w0 * Math.sqrt(1 - z * z), s = t - t0;
      return Math.exp(-z * w0 * s) * Math.sin(wd * s);
    }
    const springTo = (t, t0, a, b, o) => lerp(a, b, spring(t, t0, o));
    const blinkOn = (t, period = 1.0, phase = 0) => mod(t + phase, period) < period / 2;   // a lamp that toggles
    // the height still to fall at this frame: (1 - spring) x h from t0 (props drop in and settle)
    const drop = (t0, h = 220, o = {}) => (1 - spring(TT, t0, { k: 170, damp: 0.55, ...o })) * h;
    // a diagonal wave: the start time of part (i, j) in a grid (stagger reveals along the iso diagonal)
    const wave = (t0, i, j = 0, step = 0.028) => t0 + (i + j) * step;

    // ---------------------------------------------------------------------
    //  type: glyph outlines from the bundled faces (IBM Plex Sans 300 and 400, IBM Plex Mono 400); every string
    //  registers its box (screen, scene units) for the text checks.
    // ---------------------------------------------------------------------
    const fontOf = (size, o = {}) => `${o.weight ?? 400} ${size}px ${o.mono ? MONO : o.font ?? SANS}`;
    const textW = (str, size, o = {}) => env.measure(String(str), fontOf(size, o)).w;
    function regPts(id, str, P) {   // P in g's current coordinates
      if (id === false || !P.length) return;
      const T = g.getTransform();
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const [px, py] of P) { const sx = T.a * px + T.c * py + T.e, sy = T.b * px + T.d * py + T.f; x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy); }
      env.registerBox(id, str, { x: x0 / SC, y: y0 / SC, w: (x1 - x0) / SC, h: (y1 - y0) / SC });
    }
    function glyphs(str, font, x, y) { const tp = env.textPath(str, font); if (tp) { g.save(); g.translate(x, y); g.fill(tp.path); g.restore(); } else env.fillText(g, str, x, y, font); return tp; }
    // one line at (x, y) (baseline) in g's current coordinates. o: weight, mono, color, align, count (typed), id
    function line(str, x, y, size, o = {}) {
      str = String(str);
      const font = fontOf(size, o), m = env.measure(str, font);
      const x0 = o.align === 'center' ? x - m.w / 2 : o.align === 'right' ? x - m.w : x;
      const shown = o.count != null ? [...str].slice(0, Math.max(0, Math.floor(o.count))).join('') : str;
      if (!shown) return m.w;
      g.fillStyle = o.color ?? PAL.text;
      glyphs(shown, font, x0, y);
      const mw = shown === str ? m.w : env.measure(shown, font).w;
      regPts(o.id ?? str, str, [[x0, y - m.asc], [x0 + mw, y + m.desc]]);
      return m.w;
    }
    // text set into a face: the glyphs are skewed into the plane; size and (u, v) in face units (v = the baseline)
    function isoText(fp, str, u, v, size, o = {}) {
      const p0 = isoP(fp(0, 0)), pu = isoP(fp(1, 0)), pv = isoP(fp(0, 1));
      g.save(); g.transform(pu[0] - p0[0], pu[1] - p0[1], pv[0] - p0[0], pv[1] - p0[1], p0[0], p0[1]);
      if (o.al != null) g.globalAlpha *= clamp(o.al);
      const w = line(str, u, v, size, { mono: o.font == null, ...o });
      g.restore();
      return w;
    }
    // a display line in screen space (Plex Sans Light by default): rises 0.4 em on a spring at o.at; o.until clears it
    function title(str, x, y, size = 96, o = {}) {
      const at = o.at ?? -1e9;
      if (TT < at) return null;
      if (o.until != null && TT >= o.until + 0.3) return null;
      let a = at < -1e8 ? 1 : spring(TT, at, { k: o.k ?? 150, damp: o.damp ?? 0.7 });
      if (o.until != null && TT > o.until) a *= 1 - EZ.io((TT - o.until) / 0.3);
      if (a <= 0.002) return null;
      g.save(); g.setTransform(SC, 0, 0, SC, 0, 0); g.globalAlpha = clamp(a);
      const w = line(str, x, y + (1 - a) * size * (o.rise ?? 0.4), size, { weight: 300, ...o });
      g.restore();
      return w;
    }
    // the caption: a centred sans line with a short rule above (screen space); at, until, x, y, size
    function caption(str, o = {}) {
      const at = o.at ?? 0, sz = o.size ?? 48, x = o.x ?? W / 2, y = o.y ?? 972;
      if (TT < at || (o.until != null && TT >= o.until + 0.3)) return null;
      let a = spring(TT, at, { k: 120, damp: 0.8 });
      if (o.until != null && TT > o.until) a *= 1 - EZ.io((TT - o.until) / 0.3);
      if (a <= 0.001) return null;
      g.save(); g.setTransform(SC, 0, 0, SC, 0, 0); g.globalAlpha = clamp(a);
      const w = line(str, x, y + (1 - a) * 18, sz, { align: 'center', weight: o.weight ?? 400, id: o.id ?? 'caption:' + str });
      polyPath([[x - 22, y - sz * 1.25], [x + 22, y - sz * 1.25]], false); hair(PAL.edge); g.stroke();
      g.restore();
      return w;
    }
    // a figure tag in mono at the top left: "01 ——— label" (screen space); it types on at o.at and off at o.until
    function tag(num, label, o = {}) {
      const at = o.at ?? 0, x = o.x ?? 112, y = o.y ?? 132, sz = o.size ?? 30;
      if (TT < at) return null;
      let a = clamp(spring(TT, at + 0.05, { k: 140, damp: 0.85 })), n = (TT - at) * 30;
      if (o.until != null && TT > o.until) { const u = clamp((TT - o.until) / 0.3); a *= 1 - EZ.io(u); n = Math.min(n, (1 - u) * (num.length + label.length)); }
      if (a <= 0.002 || n <= 0) return null;
      g.save(); g.setTransform(SC, 0, 0, SC, 0, 0);
      const wn = line(num, x, y, sz, { mono: true, color: PAL.textD, count: n, id: o.id ?? 'tag:' + num });
      polyPath([[x + wn + 16, y - sz * 0.34], [x + wn + 16 + 60 * a, y - sz * 0.34]], false); hair(PAL.edge); g.stroke();
      line(label, x + wn + 92, y, sz, { mono: true, color: PAL.text, count: n - num.length, id: o.id ?? 'tag:' + label });
      g.restore();
      return wn;
    }
    // a callout: a hairline leader from a world point (the current projection and camera) up, then across, to a mono
    // label (screen space), a hollow ring round the anchor. o: at, dx (px, negative = to the left), dy (px up is
    // negative), size, until, color, ring (its radius, 9)
    function label(p3, str, o = {}) {
      const at = o.at ?? 0;
      if (TT < at || (o.until != null && TT >= o.until + 0.3)) return null;
      const a = toScreen(...isoP(p3)), dx = o.dx ?? 140, dy = o.dy ?? -110, sz = o.size ?? 28, R0 = o.ring ?? 9;
      let u = EZ.o3(clamp((TT - at) / 0.35)), n = (TT - at - 0.3) * 32;
      if (o.until != null && TT > o.until) { const k = 1 - EZ.io(clamp((TT - o.until) / 0.3)); u *= k; n = Math.min(n, k * str.length); }
      // the leader starts at the ring's edge, so the anchor (an accent, often) stays clear
      const s0 = [a[0], a[1] + Math.sign(dy) * R0], knee = [a[0], a[1] + dy], end = [a[0] + dx, a[1] + dy];
      const L1 = Math.max(0, Math.abs(dy) - R0), L2 = Math.abs(dx), want = u * (L1 + L2);
      const P = want <= L1 ? [s0, [a[0], s0[1] + Math.sign(dy) * want]] : [s0, knee, [a[0] + Math.sign(dx) * (want - L1), knee[1]]];
      g.save(); g.setTransform(SC, 0, 0, SC, 0, 0);
      if (want > 0.5) { polyPath(P, false); hair(PAL.edge); g.stroke(); }
      const rr = R0 * clamp(spring(TT, at, { k: 260, damp: 0.5 }), 0, 1.3);   // a hollow ring round the anchor
      if (rr > 0.5) { g.beginPath(); g.arc(a[0], a[1], rr, 0, TAU); hair(PAL.edge); g.stroke(); }
      if (n > 0) line(str, end[0] + (dx < 0 ? -14 : 14), end[1] + sz * 0.34, sz, { mono: true, align: dx < 0 ? 'right' : 'left', color: o.color ?? PAL.text, count: n, id: o.id ?? 'label:' + str });
      g.restore();
      return end;
    }

    // a focus mark: a hollow hairline ring round a world point (the current projection and camera), opening on a
    // spring at o.at and closing at o.until. o: r (px, 14), at, until
    function mark(p3, o = {}) {
      const at = o.at ?? 0;
      if (TT < at || (o.until != null && TT >= o.until + 0.3)) return null;
      let s = clamp(spring(TT, at, { k: 260, damp: 0.5 }), 0, 1.3);
      if (o.until != null && TT > o.until) s *= 1 - EZ.io((TT - o.until) / 0.3);
      const a = toScreen(...isoP(p3)), r = (o.r ?? 14) * s;
      if (r <= 0.5) return a;
      g.save(); g.setTransform(SC, 0, 0, SC, 0, 0); g.beginPath(); g.arc(a[0], a[1], r, 0, TAU); hair(o.color ?? PAL.edge); g.stroke(); g.restore();
      return a;
    }

    // ---------------------------------------------------------------------
    //  small props
    // ---------------------------------------------------------------------
    // a mug: cylinder, inner rim, handle (a rounded ring standing face-on to the viewer), steam
    function isoMug(x, y, z, r = 30, h = 52, o = {}) {
      isoCyl(x, y, z, r, h);
      facePath(faceOf([x, y, z + h], [1, 0, 0], [0, 1, 0]), ellipsePts(0, 0, r * 0.8, r * 0.8, 0, 28), true);
      hair(PAL.inner); g.stroke();
      const hw = r * 1.0, hh = h * 0.62, dir = [0.7071, -0.7071, 0], c0 = vadd([x, y, z + h * 0.82], vsc(dir, r * 0.72));
      const fp = faceOf(c0, dir, [0, 0, -1]);
      facePath(fp, rrectPts(0, 0, hw, hh, hw * 0.5, 6), true);
      const inner = rrectPts(hw * 0.02, hh * 0.22, hw * 0.66, hh * 0.56, hw * 0.26, 6).reverse().map(([u, v]) => isoP(fp(u, v)));
      g.moveTo(inner[0][0], inner[0][1]); for (const p of inner) g.lineTo(p[0], p[1]); g.closePath();
      g.fillStyle = PAL.face; g.fill('evenodd'); hair(PAL.edge); g.stroke();
      if (o.steam !== false) for (let i = 0; i < 2; i++) {   // two faint wisps, smooth on ones
        const P = []; for (let k = 0; k <= 12; k++) { const q = k / 12; P.push([x - 8 + i * 16 + Math.sin(q * 5 + TT * 3 + i * 2) * 6 * q, y - 8 + i * 16, z + h + 12 + q * 70]); }
        line3(P, PAL.inner);
      }
    }
    // a potted plant: a pot (cylinder + rim) and leaves standing in vertical planes, swaying a little
    function isoPlant(x, y, z, s = 1, o = {}) {
      isoCyl(x, y, z, 22 * s, 30 * s); isoCyl(x, y, z + 30 * s, 25 * s, 7 * s);
      const zt = z + 37 * s, sway = Math.sin(TT * TAU * 0.35 + (o.ph ?? 0)) * 0.08 + (o.bend ?? 0);
      const leaves = [0.3, 1.5, 2.6, 3.7, 4.9].map((a, i) => ({ a: a + sway, L: (54 + (i % 3) * 14) * s, tilt: 0.35 + (i % 2) * 0.25 }));
      leaves.sort((p, q) => vdot([Math.cos(p.a), Math.sin(p.a), 0], ISO_VIEW) - vdot([Math.cos(q.a), Math.sin(q.a), 0], ISO_VIEW));
      for (const lf of leaves) {   // each leaf: a lens in the plane of its direction and up
        const dir = [Math.cos(lf.a), Math.sin(lf.a), 0], up = [0, 0, 1];
        const P = [], n = 16;
        for (let k = 0; k <= n; k++) { const q = k / n; P.push([q, Math.sin(q * Math.PI) * 0.22]); }
        for (let k = n; k >= 0; k--) { const q = k / n; P.push([q, -Math.sin(q * Math.PI) * 0.12]); }
        const W3 = ([q, side]) => { const along = q * lf.L, rise = along * lf.tilt + along * along * 0.004 * s; return vadd(vadd([x, y, zt], vsc(dir, along * 0.8)), vadd(vsc(up, rise + side * lf.L * 0.5), vsc([-dir[1], dir[0], 0], side * lf.L * 0.25))); };
        polyPath(P.map((p) => isoP(W3(p))), true); g.fillStyle = PAL.face; g.fill(); hair(PAL.edge); g.stroke();
        polyPath([0.08, 0.5, 0.85].map((q) => isoP(W3([q, 0.03]))), false); hair(PAL.inner); g.stroke();
      }
    }
    // a cable: a smooth 3D curve through control points (Catmull-Rom), two hairlines with white between
    function isoCable(P3, o = {}) {
      const S = curve3(P3);
      const Q = S.map(isoP);
      polyPath(Q, false); hair(PAL.edge, (o.w ?? 9) + HAIR * 2); g.stroke();
      polyPath(Q, false); hair(PAL.face, o.w ?? 9); g.stroke();
      return S;
    }
    function curve3(P3, steps = 10) {
      const S = [];
      for (let i = 0; i < P3.length - 1; i++) {
        const p0 = P3[Math.max(0, i - 1)], p1 = P3[i], p2 = P3[i + 1], p3 = P3[Math.min(P3.length - 1, i + 2)];
        for (let k = 0; k < steps; k++) {
          const t = k / steps, t2 = t * t, t3 = t2 * t;
          S.push([0, 1, 2].map((c) => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3)));
        }
      }
      S.push(P3[P3.length - 1]);
      return S;
    }
    // the point at fraction u (0..1, by length) along a 3D polyline
    function along(P3, u) {
      let L = 0; const seg = [];
      for (let i = 1; i < P3.length; i++) { const d = Math.hypot(...vsub(P3[i], P3[i - 1])); seg.push(d); L += d; }
      let want = clamp(u) * L;
      for (let i = 0; i < seg.length; i++) { if (want <= seg[i] || i === seg.length - 1) { const k = seg[i] ? Math.min(1, want / seg[i]) : 0; return vadd(P3[i], vsc(vsub(P3[i + 1], P3[i]), k)); } want -= seg[i]; }
      return P3[0];
    }
    // a lane on the ground: a light hairline route with end ticks (packets travel on it). o: color, ticks
    function lane(P3, o = {}) {
      line3(P3, o.color ?? PAL.inner);
      if (o.ticks !== false) for (const p of [P3[0], P3[P3.length - 1]]) faceEll(faceOf(p, [1, 0, 0], [0, 1, 0]), 0, 0, o.r ?? 5, o.r ?? 5, { fill: PAL.face, stroke: o.color ?? PAL.inner });
    }
    // a packet: a small rounded cube at fraction u along a 3D path (s = its size); returns where it is
    function packet(P3, u, s = 14, o = {}) {
      if (u < 0 || u > 1) return null;
      const p = along(P3, u);
      isoBox(p[0] - s / 2, p[1] - s / 2, p[2], s, s, s * (o.h ?? 1), { r: s * 0.22, seg: 3, creaseC: PAL.inner, ...o });
      return p;
    }

    // ---------------------------------------------------------------------
    //  devices and buildings (new for 16:9 talks; the laptop and the rack are animate's demo, made reusable)
    // ---------------------------------------------------------------------
    // a laptop: base, keys (a grid that rises in a wave from o.keys), trackpad, a lamp, a lid on a hinge (o.lid 0..1
    // of its 105 deg), o.screen(fp) draws on the screen when it faces us. (x, y, z) = the base's back-left corner.
    // the laptop's faces without drawing it (bridges, labels): { lid(u, v), deck(u, v) } for the same x, y, z, o
    function laptopFaces(x, y, z, o = {}) {
      const w = o.w ?? 320, h = o.h ?? 14, LH = o.lidH ?? 210;
      const al = 105 * DEG * clamp(o.lid ?? 1, 0, 1.2), b = [0, Math.cos(al), Math.sin(al)], O = [x, y, z + h];
      return { lid: (u, v) => vadd(vadd(O, [u, 0, 0]), vsc(b, LH - v)), deck: faceOf(O, [1, 0, 0], [0, 1, 0]), w, lidH: LH, al };
    }
    function laptop(x, y, z, o = {}) {
      const w = o.w ?? 320, d = o.d ?? 215, h = o.h ?? 14, LH = o.lidH ?? 210, t = o.t ?? 9;
      isoBox(x, y, z, w, d, h, { r: 20 });
      const LF = laptopFaces(x, y, z, o), deck = LF.deck, kp = (w - 28) / 12;
      isoGrid(12, 4, (i, j) => {
        const s = o.keys == null ? 1 : spring(TT, wave(o.keys, i, j), { k: 220, damp: 0.5 });
        if (s <= 0.01) { faceRR(deck, 14 + i * kp, 30 + j * kp, kp - 4.4, kp - 4.4, 4); return; }
        isoBox(x + 14 + i * kp, y + 30 + j * kp, z + h, kp - 4.4, kp - 4.4, 5 * s, { r: 4, seg: 3, creaseC: PAL.inner });
      });
      faceRR(deck, w / 2 - 55, 136, 110, 66, 8);
      lamp(faceOf([x, y + d, z + h], [1, 0, 0], [0, 0, -1]), w - 26, h / 2, 3, blinkOn(TT, 1.0));
      const al = LF.al, lidFace = LF.lid;
      const S = isoSlab([x, y, z + h], [1, 0, 0], [0, Math.cos(al), Math.sin(al)], [0, -Math.sin(al), Math.cos(al)], w, LH, t, { r: 22 });
      if (S.front === 0 && o.screen) { faceRR(lidFace, 12, 12, w - 24, LH - 24, 12); o.screen(lidFace); }
      return { lid: lidFace, deck, w, d, h, lidH: LH };
    }
    // a server rack: floor plates, two rear posts, a top bar and n blades. o: n, bw, bd, bh, pitch, slide(i) (how far
    // blade i is pulled out toward +y), live (the blade with the accent LED), liveMin (px: the LED never smaller on
    // screen, so the accent survives any pull-back), names(i) (set in nameSize face units, 26; drawn only while they
    // are 22 px or more on screen), detail (0..1, vents and lamps), lit(i) (its lamp on or off; default: toggling),
    // glow(i) (0..1: its front filled from white to edge grey), floor (false: no plates), fine (0..1: the blades' own
    // outlines from inner grey to the rack's edge, for racks seen small), edge (the whole rack's outline colour: inner
    // grey sets it back)
    // the rack's geometry without drawing it: { face(i) (blade i's front, v down), bladeZ(i), top } for the same o
    function rackFaces(x, y, z, o = {}) {
      const n = o.n ?? 5, bd = o.bd ?? 250, bh = o.bh ?? 50, pitch = o.pitch ?? 58, fz = z + (o.floor === false ? 0 : 30);
      const bladeZ = (i) => fz + 8 + i * pitch;
      const face = (i) => faceOf([x, y + bd + (o.slide ? o.slide(i) : 0), bladeZ(i) + bh], [1, 0, 0], [0, 0, -1]);
      return { face, bladeZ, fz, top: fz + 8 + n * pitch + 36 };
    }
    function rack(x, y, z, o = {}) {
      const n = o.n ?? 5, bw = o.bw ?? 344, bd = o.bd ?? 250, bh = o.bh ?? 50, pitch = o.pitch ?? 58;
      const v = o.detail ?? 1, fine = clamp(o.fine ?? 1), RF = rackFaces(x, y, z, o), fz = RF.fz, bladeZ = RF.bladeZ, face = RF.face;
      const E = o.edge ?? PAL.edge, ed = { edge: E }, bladeE = fine < 1 ? mixHex(PAL.inner, E, fine) : E;
      const ns = o.nameSize ?? 26, nv = lod(seen(ns), 22, 23.5), ledR = Math.max(5.5, (o.liveMin ?? 0) / (seen(1) || 1));
      if (o.floor !== false) isoPlates(x - 38, y - 40, z, bw + 66, bd + 140, [{ h: 18, r: 46 }, { h: 12, gap: 6, inset: 14, r: 38 }], ed);
      const zc = fz + 8 + n * pitch + 20;
      isoCyl(x, y - 8, fz, 8, zc - fz, ed); isoCyl(x + bw, y - 8, fz, 8, zc - fz, ed);
      for (let i = 0; i < n; i++) {
        if (i === o.live && o.under) o.under();   // whatever sits behind the live blade (a cable, a socket)
        const sl = o.slide ? o.slide(i) : 0, zb = bladeZ(i), on = i === o.live;
        isoBox(x, y + sl, zb, bw, bd, bh, { r: 10, seg: 4, edge: bladeE });
        const fp = face(i), gv = o.glow ? clamp(o.glow(i)) : 0;
        if (gv > 0.004) faceRR(fp, 12, 7, bw - 24, bh - 14, 6, { seg: 3, fill: mixHex(PAL.face, PAL.edge, gv), stroke: false });
        if (v > 0) {
          const c = soft(PAL.inner, v);
          for (let k = 0; k < 6; k++) for (let r = 0; r < 2; r++) faceRR(fp, bw - 138 + k * 20, 15 + r * 12, 13, 6, 3, { seg: 2, stroke: c });
          if (!on) lamp(fp, 24, bh / 2, 5, o.lit ? !!o.lit(i) : blinkOn(TT, 1.0, i * 0.37 + (o.phase ?? 0)));
          if (o.names && nv > 0) { const nm = o.names(i); if (nm) isoText(fp, nm, 42, bh / 2 + ns * 0.36, ns, { color: on ? PAL.text : PAL.textD, al: nv, id: o.id === false ? false : undefined }); }
        }
        if (on) accentDot(fp, 24, bh / 2, ledR);
        if (on && o.handle !== false) isoBox(x + 150, y + bd + sl, zb + 16, 36, 10, 16, { r: 4, seg: 2, edge: bladeE });
      }
      isoBox(x - 16, y - 20, zc, bw + 32, 24, 16, { r: 12, edge: E });
      return { face, bladeZ, top: zc + 16, w: bw, d: bd };
    }
    // a tower: a rounded box with a grid of windows on its two visible faces. o: r, floor (height of a floor), bay
    // (window pitch along a face), lit(i, j, side) (a window drawn as a lamp), detail (0..1), rise (0..1 of its
    // height), roof ('step' a setback, 'tank' a water tank, 'mast' a hairline mast; anything else flat), edge
    function tower(x, y, z, w, d, h, o = {}) {
      const hh = h * clamp(o.rise ?? 1, 0, 1.3);
      if (hh <= 0.5) return null;
      const E = o.edge ?? PAL.edge;
      const B = isoBox(x, y, z, w, d, hh, { r: o.r ?? 6, seg: 3, edge: E });
      const v = (o.detail ?? 1) * lod(seen(o.floor ?? 26));
      if (v > 0) {
        const c = soft(PAL.inner, v), fl = o.floor ?? 26, bay = o.bay ?? 22, rows = Math.floor((hh - 14) / fl);
        for (const [fp, len, side] of [[boxFront(x, y, z, w, d, hh), w, 0], [boxSide(x, y, z, w, d, hh), d, 1]]) {
          const cols = Math.max(1, Math.floor((len - 10) / bay)), m = (len - cols * bay) / 2;
          for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
            const u = m + i * bay + 4, vv = 12 + j * fl;
            if (o.lit && o.lit(i, j, side)) faceRR(fp, u, vv, bay - 8, fl * 0.5, 2, { seg: 2, fill: soft(PAL.edge, v), stroke: false });
            else faceRR(fp, u, vv, bay - 8, fl * 0.5, 2, { seg: 2, stroke: c });
          }
        }
      }
      const zt = z + hh, m = Math.min(w, d);
      if (o.roof === 'step') isoBox(x + w * 0.2, y + d * 0.2, zt, w * 0.6, d * 0.6, Math.min(hh * 0.18, m * 0.5), { r: o.r ?? 6, seg: 3, edge: E });
      else if (o.roof === 'tank') { isoCyl(x + w * 0.62, y + d * 0.4, zt, m * 0.16, m * 0.08, { edge: E }); isoCyl(x + w * 0.62, y + d * 0.4, zt + m * 0.08, m * 0.2, m * 0.3, { edge: E }); }
      else if (o.roof === 'mast') {
        const base = [x + w * 0.5, y + d * 0.5, zt], tip = [base[0], base[1], zt + m * 1.1];
        isoBox(x + w * 0.35, y + d * 0.35, zt, w * 0.3, d * 0.3, m * 0.12, { r: 2, seg: 2, edge: E });
        line3([vadd(base, [0, 0, m * 0.12]), tip], E);
      }
      return B;
    }
    // a phone standing upright, facing +y (lower left). o: w, h, t, rows(fp) draws on the screen
    function phone(x, y, z, o = {}) {
      const w = o.w ?? 110, h = o.h ?? 220, t = o.t ?? 12;
      const S = isoPanelY(x, y, z, w, h, t, { r: 18 });
      const fp = slabFace(S);
      faceRR(fp, 8, 8, w - 16, h - 16, 12);
      faceRR(fp, w / 2 - 14, 14, 28, 6, 3, { seg: 2 });
      if (o.rows) o.rows(fp, w, h);
      return fp;
    }
    // a card lying flat (a page, a ticket): a thin slab with hairline lines of text. o: lines [lengths 0..1], h
    function card(x, y, z, w, d, o = {}) {
      isoBox(x, y, z, w, d, o.h ?? 6, { r: o.r ?? 10, seg: 4 });
      const fp = boxTop(x, y, z, w, d, o.h ?? 6);
      (o.lines ?? [0.7, 0.9, 0.5]).forEach((L, i) => { if (L > 0) faceRR(fp, 18, 22 + i * 22, Math.max(8, (w - 36) * L), 9, 4.5, { seg: 2 }); });
      return fp;
    }
    // a bar chart of columns along x: vals 0..1 of o.h, each rising on a spring from o.at in a wave. o: w, d, gap, h,
    // at, step, labels [str] (on the floor in front, size, labelColor: text grey), accent (the index whose top gets the
    // accent dot). Returns the tops (world points).
    function bars(x, y, z, vals, o = {}) {
      const w = o.w ?? 56, d = o.d ?? 56, gap = o.gap ?? 26, Hh = o.h ?? 300, tops = [];
      vals.forEach((val, i) => {
        const s = o.at == null ? 1 : spring(TT, (o.at ?? 0) + i * (o.step ?? 0.09), { k: o.k ?? 120, damp: o.damp ?? 0.55 });
        const bx = x + i * (w + gap), hh = Math.max(0, val * Hh * s);
        if (hh > 0.5) {
          isoBox(bx, y, z, w, d, hh, { r: o.r ?? 6, seg: 3 });
          if (o.accent === i && s > 0.5) accentDot(boxTop(bx, y, z, w, d, hh), w / 2, d / 2, 6);
        } else faceRR(boxTop(bx, y, z, w, d, 0), 0, 0, w, d, o.r ?? 6);
        if (o.labels && o.labels[i]) isoText(faceOf([bx, y + d + 14, z], [1, 0, 0], [0, 1, 0]), o.labels[i], w / 2, 22, o.size ?? 22, { align: 'center', color: o.labelColor ?? PAL.text });
        tops.push([bx + w / 2, y + d / 2, z + hh]);
      });
      return tops;
    }
    // a base-ten block: nx x ny x nz unit cubes of side s, drawn as one solid with the unit grid on its three visible
    // faces (a rod, a flat, a cube). o: r, detail (0..1)
    function block(x, y, z, nx, ny, nz, s = 16, o = {}) {
      const w = nx * s, d = ny * s, h = nz * s;
      isoBox(x, y, z, w, d, h, { r: o.r ?? 1.5, seg: 2 });
      const v = (o.detail ?? 1) * lod(seen(s), 3, 8);
      if (v <= 0) return;
      const c = soft(PAL.inner, v), T = boxTop(x, y, z, w, d, h), Fr = boxFront(x, y, z, w, d, h), Sd = boxSide(x, y, z, w, d, h);
      for (let i = 1; i < nx; i++) { faceLine(T, [[i * s, 0], [i * s, d]], c); faceLine(Fr, [[i * s, 0], [i * s, h]], c); }
      for (let j = 1; j < ny; j++) { faceLine(T, [[0, j * s], [w, j * s]], c); faceLine(Sd, [[j * s, 0], [j * s, h]], c); }
      for (let k = 1; k < nz; k++) { faceLine(Fr, [[0, k * s], [w, k * s]], c); faceLine(Sd, [[0, k * s], [d, k * s]], c); }
    }

    // ---------------------------------------------------------------------
    //  the hero: a rounded cube-bot with two dark dot eyes that blink, an antenna, a spring bob and hop.
    //  (x, y, z) = the centre of its footprint on the surface it stands on; s = its size in world units.
    //  o: { key, hop: time(s) of a hop, look: -1..1 gaze along its face, faceX: true = face on the +x side }
    // ---------------------------------------------------------------------
    function cubeBot(x, y, z, s, o = {}) {
      const key = o.key ?? 'bot', t = TT, hops = [].concat(o.hop ?? []);
      let lift = Math.sin(t * TAU * 0.75 + key.length) * s * 0.02 + s * 0.02, sq = 0;
      for (const hp of hops) {
        const u = (t - hp) / 0.34;
        if (u > 0 && u < 1) lift += 4 * u * (1 - u) * s * 0.6;
        sq += kick(t, hp + 0.34, { k: 300, damp: 0.28 }) * 0.16 - kick(t, hp - 0.12, { k: 500, damp: 0.6 }) * (t < hp ? 0.1 : 0);
      }
      const hb = s * 0.84 * (1 - sq), wb = s * (1 + sq * 0.3);
      if (lift > s * 0.08) {   // a contact ring on the surface while airborne (a line, never a shadow)
        const k = clamp(1 - lift / (s * 0.8), 0.3, 1);
        facePath(faceOf([x, y, z], [1, 0, 0], [0, 1, 0]), ellipsePts(0, 0, s * 0.5 * k, s * 0.5 * k, 0, 24), true); hair(PAL.inner); g.stroke();
      }
      const zb = z + lift;
      const body = isoBox(x - wb / 2, y - wb / 2, zb, wb, wb, hb, { r: s * 0.24 });
      const sway = hops.reduce((a, hp) => a + kick(t, hp + 0.3, { k: 120, damp: 0.25 }), 0) * s * 0.18;
      const base = [x, y, zb + hb], tip = [x + sway * 0.7, y + sway * 0.7, zb + hb + s * 0.34];
      line3([base, tip], PAL.edge);
      const tp = isoP(tip); g.beginPath(); g.arc(tp[0], tp[1], s * 0.07 * ISO.u, 0, TAU); g.fillStyle = PAL.face; g.fill(); hair(PAL.edge); g.stroke();
      const fx = o.faceX, fp = fx ? faceOf([x + wb / 2, y - wb / 2, zb + hb], [0, 1, 0], [0, 0, -1]) : faceOf([x - wb / 2, y + wb / 2, zb + hb], [1, 0, 0], [0, 0, -1]);
      const blink = mod(F + key.length * 16, 78) < 4 || hops.some((hp) => t > hp + 0.3 && t < hp + 0.42);
      const look = (o.look ?? 0) * s * 0.06, ey = hb * 0.46;
      for (const ex of [0.34, 0.66]) faceEll(fp, ex * wb + look, ey, s * 0.062, blink ? s * 0.012 : s * 0.085, { fill: PAL.accent, n: 18 });
      faceLine(fp, [[wb * 0.4 + look, hb * 0.72], [wb * 0.6 + look, hb * 0.72]], PAL.inner);   // a mouth line, light
      const sp = fx ? faceOf([x - wb / 2, y + wb / 2, zb + hb], [1, 0, 0], [0, 0, -1]) : faceOf([x + wb / 2, y - wb / 2, zb + hb], [0, 1, 0], [0, 0, -1]);
      for (const vv of [0.42, 0.56]) faceLine(sp, [[wb * 0.3, hb * vv], [wb * 0.7, hb * vv]], PAL.inner);
      return { top: zb + hb, body, at: toScreen(...isoP([x, y, zb + hb * 0.5])) };
    }
    // the cube-bot's silhouette (screen points in g's coordinates) for hero-to-hero bridges
    function heroPts(x, y, z, s) {
      const P = [];
      for (const [px, py] of rrectPts(x - s / 2, y - s / 2, s, s, s * 0.24, 4)) { P.push(iso(px, py, z)); P.push(iso(px, py, z + s * 0.84)); }
      return hull2(P);
    }

    // ---------------------------------------------------------------------
    //  bridges (animate's STYLE.blob and the morph): a shape that becomes another between two worlds
    // ---------------------------------------------------------------------
    const colLum = (c) => { const v = hex(c); return (0.299 * v[0] + 0.587 * v[1] + 0.114 * v[2]) / 255; };
    const thickDrop = (P, t = 10) => P.map(([x, y]) => [x, y + t]);   // a slab's thickness seen from 30 deg above
    // the morphing shape: a hairline slab; its fill follows the stroke from accent-dark to face-white
    function blob(P, c, o = {}) {
      const la = colLum(PAL.accent), le = colLum(PAL.edge), u = clamp((colLum(c) - la) / (le - la || 1));
      polyPath(thickDrop(P, (o.t ?? 10) / zoomNow()), true); g.fillStyle = PAL.face; g.fill(); hair(PAL.inner); g.stroke();
      polyPath(P, true); g.fillStyle = mixHex(PAL.accent, PAL.face, clamp(u * 2.5)); g.fill();
      hair(c); g.stroke();
    }
    // outline A (colour ca) becomes outline B (colour cb) as u goes 0 -> 1 (by-angle morph, eased)
    function bridge(A, B, u, ca = PAL.accent, cb = PAL.edge, o = {}) {
      const e = EZ.io(clamp(u));
      blob(MORPH(A, B, e), mixHex(ca, cb, e), o);
    }
    // points in g's current coordinates, on screen (scene units): outlines for through() and bridgeAt()
    const screenPts = (P) => P.map(([x, y]) => toScreen(x, y));
    const centre = (P) => P.reduce((a, p) => [a[0] + p[0] / P.length, a[1] + p[1] / P.length], [0, 0]);
    // how far an outline (screen points) must grow about its centre to cover the frame
    function kCover(P) {
      const c = centre(P);
      let rmin = 1e9;
      for (let i = 0; i < 48; i++) {   // the nearest edge by angle
        const a = (i / 48) * TAU, dx = Math.cos(a), dy = Math.sin(a);
        let best = 0;
        for (let j = 0; j < P.length; j++) {
          const p = P[j], q = P[(j + 1) % P.length], ex = q[0] - p[0], ey = q[1] - p[1], den = dx * ey - dy * ex;
          if (Math.abs(den) < 1e-9) continue;
          const s = ((p[0] - c[0]) * ey - (p[1] - c[1]) * ex) / den, r = ((p[0] - c[0]) * dy - (p[1] - c[1]) * dx) / den;
          if (s > 0 && r >= 0 && r <= 1) best = Math.max(best, s);
        }
        if (best > 0) rmin = Math.min(rmin, best);
      }
      const far = Math.max(...[[0, 0], [W, 0], [0, H], [W, H]].map((q) => Math.hypot(q[0] - c[0], q[1] - c[1])));
      return (far / Math.max(4, rmin === 1e9 ? 4 : rmin)) * 1.1;
    }
    // a world seen through a window: outline P (screen points) grown k times about its centre, a hairline rim and a
    // light thickness line under it (animate's STYLE.window); draw() paints the world inside (on its own ground)
    function through(P, k, draw) {
      const c = centre(P), Q = P.map(([x, y]) => [c[0] + (x - c[0]) * k, c[1] + (y - c[1]) * k]);
      g.save(); g.setTransform(SC, 0, 0, SC, 0, 0);
      polyPath(thickDrop(Q), true); hair(PAL.inner); g.stroke();
      g.save(); polyPath(Q, true); g.clip();
      g.fillStyle = PAL.paper; g.fillRect(0, 0, W, H);
      g.save(); draw(); g.restore();
      g.restore();
      g.setTransform(SC, 0, 0, SC, 0, 0); polyPath(Q, true); hair(PAL.edge); g.stroke();
      g.restore();
    }
    // animate's morph renderer at one bridge (tc): world A shrinks into its bridge object through a window, the
    // object's outline becomes B's on blank paper, and world B opens out of B's outline. A() and B() return
    // { P: screen outline, c: colour } (set their own projection and camera); drawA() and drawB() draw each world.
    // o: d (half-length, 0.6 s), m (the morph's half, d / 3). Returns 'A', 'bridge' or 'B'.
    function bridgeAt(tc, A, B, drawA, drawB, o = {}) {
      const d = o.d ?? 0.6, m = o.m ?? d / 3, t = TT;
      const run = (f) => { g.save(); f(); g.restore(); };
      if (t < tc - d) { run(drawA); return 'A'; }
      if (t >= tc + d) { run(drawB); return 'B'; }
      if (t < tc - m) {
        let a = null; run(() => { a = A(); });
        through(a.P, lerp(kCover(a.P), 1, EZ.io((t - tc + d) / (d - m))), drawA);
        return 'A';
      }
      if (t < tc + m) {
        let a = null, b = null; run(() => { a = A(); }); run(() => { b = B(); });
        g.save(); g.setTransform(SC, 0, 0, SC, 0, 0); bridge(a.P, b.P, (t - tc + m) / (2 * m), a.c, b.c, o); g.restore();
        return 'bridge';
      }
      let b = null; run(() => { b = B(); });
      through(b.P, lerp(1, kCover(b.P), EZ.io((t - tc - m) / (d - m))), drawB);
      return 'B';
    }

    return {
      bind(c) { g = c.g; TT = c.TT; F = c.F; SC = c.scale || 1; MORPH = c.morph; theme('light'); ISO = { ...ISO0 }; },
      PAL, HAIR, ZK, ISO_VIEW, SANS, MONO,
      theme, ground, mixHex,
      // projection and lines
      setIso, getIso, iso, isoP, subIso, vadd, vsub, vsc, vdot, vcross, hair, polyPath, line3, hull2, zoomNow, toScreen, seen, lod, soft,
      ellipsePts, rrectPts,
      // solids and faces
      isoSlab, isoBox, isoPanelX, isoPanelY, isoCyl, isoPlates, isoGrid,
      faceOf, slabFace, boxTop, boxFront, boxSide, facePath, faceRR, faceEll, faceSlab, faceLine, facePts, accentDot, lamp,
      // motion
      spring, kick, springTo, blinkOn, drop, wave,
      // type
      textW, line, isoText, title, caption, tag, label, mark,
      // props, devices, buildings, data
      isoMug, isoPlant, isoCable, curve3, along, lane, packet, laptop, laptopFaces, rack, rackFaces, tower, phone, card, bars, block,
      // the hero and bridges
      cubeBot, heroPts, blob, bridge, bridgeAt, through, kCover, screenPts,
    };
  },
});
