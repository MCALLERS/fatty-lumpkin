// =====================================================================
//  engine/styles/cut-paper/kit.js: Cut Paper, a 16:9 collage of torn paper. Every shape is cut from paper: a torn
//  edge, a soft drop shadow, grain and crayon in the fill, patterns clipped inside; characters with faces act on it.
//  A 16:9 port of cth9191/animate's cut-paper style (styles/cut-paper/kit.js and the parts of kit/core.js it uses),
//  MIT, Copyright (c) 2026 cth9191; the full notice is LICENSE beside this file and travels with every copy.
//  Port changes (Bombadillo AI, 2026): an FLPT.style plug-in with closure state instead of globals, bound per frame;
//  the frame is 1920x1080; shadows follow the camera's zoom; paper grain and crayon come from seeded tiles made once
//  (the same look, a fraction of the cost); alpha multiplies instead of resetting; hand lettering and cut letters are
//  drawn from glyph outlines of bundled OFL faces (Caveat, Fraunces) and register their boxes with the runtime; new:
//  cutLetters (kinetic cut-out type), tear (a torn-paper wipe), window as a clip callback, layerCam (parallax),
//  and props for wider worlds (house, tree, cloud, sun, moon, bird, bunting, gear, bubble, page, lamp, star).
//
//  A frame: a wall (K.wall), a floor or table (K.floor), props in front (K.cut and the props), the hero acting
//  (K.spark), then captions on screen (ctx.screen(); K.tag, K.caption). Orange (PAL.orange) is the hero's alone.
// =====================================================================
FLPT.style('cut-paper', {
  tokens: { paper: '#efe5cf', ink: '#2a1d18', font: '"Caveat", "Comic Sans MS", cursive', display: '"Fraunces Soft", Georgia, serif', hero: '#ec7a4f' },
  fonts: [
    { family: 'Caveat', file: 'caveat-regular.ttf', weight: 400 },
    { family: 'Caveat', file: 'caveat-bold.ttf', weight: 700 },
    { family: 'Fraunces Soft', file: 'fraunces-soft-black.ttf', weight: 900 },
  ],
  ones: false,
  make(env) {
    const { W, H, rng: RNG, clamp, lerp, EZ } = env;
    const TAU = Math.PI * 2;
    const HAND = env.tokens.font, DISPLAY = env.tokens.display;
    let g = null, B = 0, TT = 0, SC = 1;   // bound per frame

    // ---- the palette (animate's PAL): warm and saturated on cream. Orange is reserved for the hero.
    const PAL = {
      ink: '#2a1d18', paper: '#fbf6ea', cream: '#f3ead6', blank: '#efe5cf', navy: '#26315f', night: '#141c40',
      wood: '#c08048', woodD: '#97582b', woodL: '#dba26a', tweed: '#7a6650', lamp: '#2f7a5c', mustard: '#d9a441',
      orange: '#ec7a4f', orangeD: '#c4542e', yellow: '#f6cf55', teal: '#3f9f9a', mint: '#a9d9c6', pink: '#f3a3bf', pinkL: '#f8c3d4',
      sky: '#cfe2ee', snow: '#f6fafc', ice: '#a9c8dc', purple: '#8c7ad8', blue: '#4c6fb5', green: '#5aa05a', greenD: '#3d7c46',
      skin1: '#efc19e', skin2: '#c68a62', skin3: '#8a5638', grey: '#8a8590', charcoal: '#4a4550', brick: '#b98576',
    };

    // ---- geometry (animate kit/core.js)
    const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
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
    function arcPts(cx, cy, r, a0, a1, n = 18, sy = 1) { const P = []; for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; P.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * sy]); } return P; }
    function xform(P, tx, ty, rot = 0, sx = 1, sy = sx) { const c = Math.cos(rot), s = Math.sin(rot); return P.map(([x, y]) => [tx + x * sx * c - y * sy * s, ty + x * sx * s + y * sy * c]); }
    function bbox(P, pad = 0) { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of P) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; } return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad }; }
    function resample(P, closed, step) {
      const out = [], n = P.length, m = closed ? n : n - 1;
      for (let i = 0; i < m; i++) { const a = P[i], b = P[(i + 1) % n], k = Math.max(1, Math.ceil(dist(a, b) / step)); for (let j = 0; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]); }
      if (!closed) out.push(P[n - 1]);
      return out;
    }
    function pathLen(P) { let L = 0; for (let i = 1; i < P.length; i++) L += dist(P[i - 1], P[i]); return L; }
    function subPath(P, frac) {
      let want = pathLen(P) * clamp(frac); const out = [P[0]];
      for (let i = 1; i < P.length; i++) { const d = dist(P[i - 1], P[i]); if (want >= d) { out.push(P[i]); want -= d; } else { const k = want / (d || 1); out.push([lerp(P[i - 1][0], P[i][0], k), lerp(P[i - 1][1], P[i][1], k)]); break; } }
      return out;
    }
    // a smooth hand wobble along the normal, reseeded every boil step (B): the paper's life on the twos
    function wobble(P, closed, amt, key, step = 7) {
      const Q = resample(P, closed, step), n = Q.length, R = RNG('wob', key, B);
      const f1 = R.r(0.012, 0.03), f2 = R.r(0.05, 0.1), p1 = R.r(0, TAU), p2 = R.r(0, TAU), sx = R.n(amt * 0.5), sy = R.n(amt * 0.5);
      const out = new Array(n); let s = 0;
      for (let i = 0; i < n; i++) {
        const a = Q[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = Q[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
        const nx = a[1] - b[1], ny = b[0] - a[0], l = Math.hypot(nx, ny) || 1;
        if (i) s += dist(Q[i - 1], Q[i]);
        const o = amt * (0.75 * Math.sin(s * f1 + p1) + 0.35 * Math.sin(s * f2 + p2));
        out[i] = [Q[i][0] + (nx / l) * o + sx, Q[i][1] + (ny / l) * o + sy];
      }
      return out;
    }
    // corners rounded through midpoints (closed), or a smooth open stroke
    function trace(P, closed) {
      g.beginPath();
      const n = P.length; if (n < 2) return;
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
    function capsulePts(x1, y1, x2, y2, w, n = 8) {
      const a = Math.atan2(y2 - y1, x2 - x1), r = w / 2, P = [];
      for (let i = 0; i <= n; i++) { const t = a - Math.PI / 2 + (Math.PI * i) / n; P.push([x2 + Math.cos(t) * r, y2 + Math.sin(t) * r]); }
      for (let i = 0; i <= n; i++) { const t = a + Math.PI / 2 + (Math.PI * i) / n; P.push([x1 + Math.cos(t) * r, y1 + Math.sin(t) * r]); }
      return P;
    }
    function rot(P, cx, cy, a) { const c = Math.cos(a), s = Math.sin(a); return P.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]); }
    // a torn edge: every point pushed along its normal by a fixed, keyed amount (the tear doesn't boil)
    function torn(Q, key, amt) {
      if (!amt) return Q;
      const R = RNG('torn', key), n = Q.length;
      return Q.map((p, i) => { const a = Q[(i + 1) % n], b = Q[(i - 1 + n) % n], nx = a[1] - b[1], ny = b[0] - a[0], l = Math.hypot(nx, ny) || 1, j = R.n(amt); return [p[0] + (nx / l) * j, p[1] + (ny / l) * j]; });
    }
    const rect = (x, y, w, h, r = 4) => rrectPts(x, y, w, h, r);
    const zoomOf = () => { const m = g.getTransform(); return Math.hypot(m.a, m.b) || 1; };

    // ---- textures: paper grain and crayon from seeded tiles, made once (a tile's marks wrap, so it has no seams)
    const TILE = 384, TEX = new Map();
    function tile(key, draw) {
      let p = TEX.get(key);
      if (p) return p;
      const c = env.canvas(TILE, TILE), q = c.getContext('2d');
      const wrap = (fn) => { for (const dx of [-TILE, 0, TILE]) for (const dy of [-TILE, 0, TILE]) { q.save(); q.translate(dx, dy); fn(q); q.restore(); } };
      draw(q, wrap, RNG('tile', key));
      p = q.createPattern(c, 'repeat');
      TEX.set(key, p);
      return p;
    }
    // the paper's own grain: light and dark specks and a few fibres (animate's grainIn, as a tile)
    const grainTile = () => tile('grain', (q, wrap, R) => {
      const n = Math.floor((TILE * TILE) / 170);
      for (const [c, s] of [['rgba(255,255,255,0.30)', 1.5], ['rgba(50,30,15,0.10)', 1.5]]) { q.fillStyle = c; for (let i = 0; i < n; i++) { const x = R.r(0, TILE), y = R.r(0, TILE), z = s * R.r(0.6, 1.4); wrap((qq) => qq.fillRect(x, y, z, z)); } }
      q.strokeStyle = 'rgba(255,255,255,0.10)'; q.lineWidth = 1; q.lineCap = 'round';
      for (let i = 0; i < (TILE * TILE) / 700; i++) { const x = R.r(0, TILE), y = R.r(0, TILE), a = -0.35 + R.n(0.22), l = 28 * (0.5 + R.f() * 0.7); wrap((qq) => { qq.beginPath(); qq.moveTo(x - (Math.cos(a) * l) / 2, y - (Math.sin(a) * l) / 2); qq.lineTo(x + (Math.cos(a) * l) / 2, y + (Math.sin(a) * l) / 2); qq.stroke(); }); }
    });
    // a crayon scribble in one colour at one angle (animate's pencil inside a cut)
    const crayonTile = (c, a, L) => tile(`crayon|${c}|${a}|${L}`, (q, wrap, R) => {
      q.strokeStyle = c; q.lineWidth = 1.7; q.lineCap = 'round';
      for (let i = 0; i < (TILE * TILE) / 45; i++) { const x = R.r(0, TILE), y = R.r(0, TILE), aa = a + R.n(0.22), l = L * (0.5 + R.f() * 0.7), dx = (Math.cos(aa) * l) / 2, dy = (Math.sin(aa) * l) / 2; wrap((qq) => { qq.beginPath(); qq.moveTo(x - dx, y - dy); qq.lineTo(x + dx, y + dy); qq.stroke(); }); }
    });
    // the frame's grain over everything, reseeded with the boil (animate's post pass)
    const postTile = () => tile('post', (q, wrap, R) => {
      const n = Math.floor((TILE * TILE) / 797);
      for (const [c, s] of [['rgba(70,45,25,0.13)', 1.7], ['rgba(255,250,236,0.20)', 1.9]]) { q.fillStyle = c; for (let i = 0; i < n; i++) { const x = R.r(0, TILE), y = R.r(0, TILE); wrap((qq) => qq.fillRect(x, y, s, s)); } }
      q.strokeStyle = 'rgba(80,55,35,0.07)'; q.lineWidth = 1;
      for (let i = 0; i < 7; i++) { const x = R.r(0, TILE), y = R.r(0, TILE), a = R.r(0, TAU), l = R.r(6, 22); wrap((qq) => { qq.beginPath(); qq.moveTo(x, y); qq.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); qq.stroke(); }); }
    });
    // a tile laid into the current clip, anchored to the shape (anchor [x, y]) so it travels with it
    function lay(pat, anchor, key, bb, alpha) {
      if (alpha <= 0.004) return;
      const R = RNG('lay', key), ox = anchor[0] + R.r(0, TILE), oy = anchor[1] + R.r(0, TILE);
      g.save(); g.translate(ox, oy); g.globalAlpha = alpha; g.fillStyle = pat; g.fillRect(bb.x0 - ox, bb.y0 - oy, bb.x1 - bb.x0, bb.y1 - bb.y0); g.restore();
    }
    function grainIn(bb, key, k = 1, anchor = [bb.x0, bb.y0]) { lay(grainTile(), anchor, key + 'g', bb, g.globalAlpha * Math.min(1.6, k)); }
    function crayonIn(bb, c, key, o = {}, anchor = [bb.x0, bb.y0]) { lay(crayonTile(c, o.crA ?? -0.9, o.crLen ?? 20), anchor, key + 'cr', bb, g.globalAlpha * clamp((o.crAl ?? 0.4) * Math.sqrt(45 / (o.crPer ?? 45)), 0, 1)); }

    // ---- THE MEDIUM: a paper cutout. o: key, tear, amt, shadow, sb/sx/sy/shc, pat(bb), crayon (a colour), crAl,
    //      crPer, crA, crLen, grain (density or false), shade, line, lw, alpha. Returns the torn outline.
    function cut(P, fill, o = {}) {
      const key = o.key ?? 'cut';
      const Q = torn(wobble(P, true, o.amt ?? 0.9, key, 5), key, o.tear ?? 1.3);
      const A = g.globalAlpha * (o.alpha ?? 1), k = zoomOf(), anchor = P[0];
      if (A <= 0.004) return Q;
      g.save(); g.globalAlpha = A;
      if (o.shadow !== false) { g.shadowColor = o.shc ?? 'rgba(35,20,10,0.30)'; g.shadowBlur = (o.sb ?? 12) * k; g.shadowOffsetX = (o.sx ?? 3) * k; g.shadowOffsetY = (o.sy ?? 7) * k; }
      trace(Q, true); g.fillStyle = fill; g.fill();
      g.restore();
      g.save(); g.globalAlpha = A; trace(Q, true); g.clip(); const bb = bbox(Q, 2);
      if (o.pat) o.pat(bb);
      if (o.crayon) crayonIn(bb, o.crayon, key, o, anchor);
      if (o.grain !== false) grainIn(bb, key, o.grain ?? 1, anchor);
      if (o.shade !== false) { const sg = g.createLinearGradient(bb.x0, bb.y0, bb.x0, bb.y1); sg.addColorStop(0, 'rgba(255,255,255,0.10)'); sg.addColorStop(1, 'rgba(30,15,5,0.13)'); g.fillStyle = sg; g.fillRect(bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0); }
      g.restore();
      if (o.line) { g.save(); g.globalAlpha = A; g.strokeStyle = o.line; g.lineWidth = o.lw ?? 3; g.lineJoin = 'round'; trace(Q, true); g.stroke(); g.restore(); }
      return Q;
    }
    // the whole frame in one colour of paper, in world units (a wall), and a floor or table from y down
    const wall = (c, p, o = {}) => cut(rect(-60 - (o.pad ?? 0), -60 - (o.pad ?? 0), W + 120 + 2 * (o.pad ?? 0), H + 120 + 2 * (o.pad ?? 0), 0), c, { key: o.key ?? 'wall' + c, shadow: false, tear: 0, pat: p, grain: o.grain ?? 0.8, shade: false });
    const floor = (y, c, p, o = {}) => cut(rect(-60 - (o.pad ?? 0), y, W + 120 + 2 * (o.pad ?? 0), H - y + 120 + (o.pad ?? 0), 0), c, { key: o.key ?? 'floor' + y, tear: o.tear ?? 0, pat: p, sy: -6, sb: 14, ...o });
    // patterns, clipped inside a cut (each is a function of the cut's box)
    const pat = {
      stripes: (c, w, gap, a = 0) => (bb) => {
        g.save(); const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2, R = Math.hypot(bb.x1 - bb.x0, bb.y1 - bb.y0) / 2 + 10;
        g.translate(cx, cy); g.rotate(a); g.fillStyle = c; for (let x = -R; x < R; x += gap) g.fillRect(x, -R, w, 2 * R); g.restore();
      },
      dots: (c, r, gap) => (bb) => { g.fillStyle = c; g.beginPath(); let row = 0; for (let y = bb.y0; y < bb.y1 + gap; y += gap, row++) for (let x = bb.x0 + ((row % 2) * gap) / 2; x < bb.x1 + gap; x += gap) { g.moveTo(x + r, y); g.arc(x, y, r, 0, TAU); } g.fill(); },
      gingham: (c, w) => (bb) => { pat.stripes(c, w, w * 2, 0)(bb); pat.stripes(c, w, w * 2, Math.PI / 2)(bb); },
      lines: (c, gap, y0 = 0) => (bb) => { g.strokeStyle = c; g.lineWidth = 2; g.beginPath(); for (let y = bb.y0 + y0; y < bb.y1; y += gap) { g.moveTo(bb.x0, y); g.lineTo(bb.x1, y); } g.stroke(); },
      grainWood: (c) => (bb) => { const R = RNG('wg', Math.round(bb.x0), Math.round(bb.y0)); g.strokeStyle = c; g.lineWidth = 2.2; g.beginPath(); for (let y = bb.y0; y < bb.y1; y += R.r(14, 30)) { g.moveTo(bb.x0, y); for (let x = bb.x0; x <= bb.x1; x += 40) g.lineTo(x, y + Math.sin(x * 0.01 + y) * 4); } g.stroke(); },
      checks: (c, s) => (bb) => { g.fillStyle = c; for (let y = Math.floor(bb.y0 / s) * s, r = 0; y < bb.y1; y += s, r++) for (let x = Math.floor(bb.x0 / s) * s + ((r % 2) * s); x < bb.x1; x += 2 * s) g.fillRect(x, y, s, s); },
      both: (...ps) => (bb) => { for (const p of ps) p(bb); },
    };

    // ---- marks on top of the paper
    // a sketchy stroke. o: closed, color, w, amt, key, alpha, frac (write-on), double, raw
    function ink(P, o = {}) {
      const closed = !!o.closed, key = o.key ?? 'ink';
      let Q = o.raw ? P : wobble(P, closed, o.amt ?? 1.8, key);
      let cl = closed;
      if (o.frac != null && o.frac < 1) { if (o.frac <= 0) return Q; Q = subPath(closed ? [...Q, Q[0]] : Q, o.frac); cl = false; }
      g.save();
      g.strokeStyle = o.color || PAL.ink; g.lineWidth = o.w ?? 3; g.lineCap = 'round'; g.lineJoin = 'round';
      g.globalAlpha *= o.alpha ?? 1;
      trace(Q, cl); g.stroke();
      if (o.double) { g.lineWidth = (o.w ?? 3) * 0.4; g.globalAlpha *= 0.55; trace(wobble(P, closed, (o.amt ?? 1.8) * 1.6 + 0.8, key + '~'), cl); g.stroke(); }
      g.restore();
      return Q;
    }
    const dot = (x, y, r, c = PAL.ink) => { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); };
    // coloured-pencil strokes inside the current clip, boiling (animate's pencil)
    function pencil(bb, t) {
      const S = RNG('ps', t.key), R = RNG('pj', t.key, B), area = (bb.x1 - bb.x0) * (bb.y1 - bb.y0);
      const n = Math.min(t.max ?? 3000, t.n ?? Math.floor(area / (t.per ?? 700))), a = t.a ?? -0.95, L = t.len ?? 14;
      g.save(); g.beginPath();
      for (let i = 0; i < n; i++) { const x = S.r(bb.x0, bb.x1), y = S.r(bb.y0, bb.y1), aa = a + S.n(0.22), l = L * (0.5 + S.f() * 0.7), jx = R.n(1.1), jy = R.n(1.1), dx = (Math.cos(aa) * l) / 2, dy = (Math.sin(aa) * l) / 2; g.moveTo(x - dx + jx, y - dy + jy); g.lineTo(x + dx + jx, y + dy + jy); }
      g.strokeStyle = t.c; g.lineWidth = t.w ?? 1.4; g.globalAlpha *= t.al ?? 0.45; g.lineCap = 'round'; g.stroke(); g.restore();
    }
    function sparkle(x, y, s, c = '#fff8dc') { g.fillStyle = c; g.beginPath(); g.moveTo(x, y - s); g.quadraticCurveTo(x, y, x + s, y); g.quadraticCurveTo(x, y, x, y + s); g.quadraticCurveTo(x, y, x - s, y); g.quadraticCurveTo(x, y, x, y - s); g.fill(); }
    // a soft pool of light (a lamp, a window, the sun): additive, so it reads on any wall
    function glow(x, y, r, c = 'rgba(255,224,140,0.55)', o = {}) {
      g.save(); g.globalCompositeOperation = o.op ?? 'source-over';
      const gr = g.createRadialGradient(x, y, r * (o.inner ?? 0.05), x, y, r); gr.addColorStop(0, c); gr.addColorStop(1, 'rgba(255,224,140,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); g.restore();
    }

    // ---- type: hand lettering in Caveat and cut-out letters in Fraunces Soft, from glyph outlines
    const handFont = (size, weight = 400) => `${weight} ${size}px ${HAND}`;
    const handW = (str, size, weight = 400) => env.measure(str, handFont(size, weight)).w;
    // a box in g's current coordinates, registered on screen (scene units) for the text checks
    function register(id, str, x, y, w, h) {
      if (id === false) return;
      const T = g.getTransform();
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const [px, py] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) { const sx = T.a * px + T.c * py + T.e, sy = T.b * px + T.d * py + T.f; x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy); }
      env.registerBox(id, str, { x: x0 / SC, y: y0 / SC, w: (x1 - x0) / SC, h: (y1 - y0) / SC });
    }
    function glyphs(str, font, x, y) { const tp = env.textPath(str, font); if (tp) { g.save(); g.translate(x, y); g.fill(tp.path); g.restore(); } else env.fillText(g, str, x, y, font); return tp; }
    // hand lettering: baseline-left at (x, y) (align: center | right); frac writes it on; returns its width
    function handText(str, x, y, size, color, o = {}) {
      const weight = o.weight ?? 400, font = handFont(size, weight), m = env.measure(str, font), frac = clamp(o.frac ?? 1);
      const x0 = o.align === 'center' ? x - m.w / 2 : o.align === 'right' ? x - m.w : x;
      if (frac <= 0) return m.w;
      const R = RNG('ht', o.key ?? str, B);
      g.save(); g.translate(x0 + R.n(0.7), y + R.n(0.7)); g.rotate((o.rot ?? 0) + R.n(0.006));
      if (frac < 1) { g.beginPath(); g.rect(-4, -size * 1.2, m.w * frac + 4, size * 1.7); g.clip(); }
      g.globalAlpha *= o.al ?? 1; g.fillStyle = color;
      glyphs(str, font, 0, 0);
      register(o.id ?? str, str, 0, -m.asc, m.w * frac, m.asc + m.desc);
      g.restore();
      return m.w;
    }
    // a torn paper tag with tape and handwriting, centred at (x, y). o: s (scale), rot, fill, color, tape, frac, id
    function tag(str, x, y, size, o = {}) {
      const ts = o.s ?? 1; if (ts <= 0.01) return null;
      const w = handW(str, size, o.weight ?? 400) + size * 0.9, h = size * 1.45;
      g.save(); g.translate(x, y); g.rotate(o.rot ?? -0.03); g.scale(ts, ts);
      cut(rect(-w / 2, -h / 2, w, h, 3), o.fill ?? PAL.paper, { key: 'tag' + (o.key ?? str), tear: 1.6 });
      if (o.tape !== false) cut(rect(-34, -h / 2 - 16, 68, 30, 2), 'rgba(240,230,190,0.75)', { key: 'tape' + (o.key ?? str), shadow: false, grain: 0.3, shade: false });
      handText(str, -w / 2 + size * 0.45, size * 0.36, size, o.color ?? PAL.ink, { key: 'tagt' + (o.key ?? str), frac: o.frac, weight: o.weight, id: o.id ?? 'tag:' + str });
      g.restore();
      return { w: w * ts, h: h * ts };
    }
    // the caption: a strip of paper, written on (call in screen space). frac writes it; s pops it
    const caption = (str, x, y, size = 54, o = {}) => tag(str, x, y, size, { rot: 0.012, tape: false, id: 'caption:' + str, ...o });

    // cut-out letters: each glyph cut from its own colour of paper with a cream margin and a shadow, dropping in.
    // o: at (s) and stagger (s per letter), times ([t per letter]), colors, paper, align, weight, track, key, id, drop,
    // ripple (s: a settled line hops once more, letter by letter, left to right)
    function cutLetters(str, x, y, size, o = {}) {
      const font = `${o.weight ?? 900} ${size}px ${DISPLAY}`, chars = [...String(str)], track = o.track ?? size * 0.03;
      const widths = chars.map((_, i) => env.measure(chars.slice(0, i).join(''), font).w + i * track);
      const total = env.measure(String(str), font).w + (chars.length - 1) * track;
      const x0 = o.align === 'center' ? x - total / 2 : o.align === 'right' ? x - total : x;
      const cols = o.colors ?? [PAL.teal, PAL.pink, PAL.yellow, PAL.blue, PAL.mint, PAL.purple, PAL.green, PAL.mustard];
      const R = RNG('cl', o.key ?? str), k = zoomOf(), base = g.globalAlpha;
      let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9, shown = 0;
      chars.forEach((ch, i) => {
        const col = cols[Math.floor(R.f() * cols.length)], r0 = R.n(0.07), jy = R.n(size * 0.03);
        if (ch === ' ') return;
        const t0 = o.times ? o.times[i] : (o.at ?? -9) + i * (o.stagger ?? 0.05);
        const dt = TT - t0; if (t0 == null || dt < 0) return;
        const adv = env.measure(ch, font).w, s = EZ.back(clamp(dt / 0.26)), fall = (1 - EZ.o3(clamp(dt / 0.3))) * (o.drop ?? size * 0.6);
        const rp = o.ripple == null ? 0 : clamp((TT - o.ripple - i * 0.035) / 0.32), hop = Math.sin(rp * Math.PI) * size * 0.07;
        const wob = Math.sin(dt * 16) * Math.exp(-dt * 7) * 0.12 + Math.sin(rp * Math.PI * 2) * 0.05, cx = x0 + widths[i] + adv / 2, cy = y - size * 0.34 + jy - fall - hop;
        const tp = env.textPath(ch, font);
        g.save(); g.translate(cx, cy); g.rotate(r0 + wob); g.scale(s, s); g.translate(-adv / 2, size * 0.34);
        if (tp) {
          g.save(); g.shadowColor = 'rgba(35,20,10,0.32)'; g.shadowBlur = 12 * k; g.shadowOffsetX = 3 * k; g.shadowOffsetY = 8 * k;
          g.lineJoin = 'round'; g.lineWidth = size * 0.11; g.strokeStyle = o.paper ?? PAL.paper; g.stroke(tp.path); g.restore();
          g.fillStyle = o.paper ?? PAL.paper; g.fill(tp.path);
          g.fillStyle = col; g.fill(tp.path);
          g.save(); g.clip(tp.path); const bb = { x0: tp.x0 - 4, y0: -tp.asc - 4, x1: tp.x1 + 4, y1: tp.desc + 4 };
          crayonIn(bb, 'rgba(255,255,255,0.55)', 'cl' + i + ch, { crAl: 0.35, crA: -0.9 }, [0, 0]); grainIn(bb, 'cl' + i + ch, 1.2, [0, 0]); g.restore();
        } else { g.fillStyle = col; env.fillText(g, ch, 0, 0, font); }
        const T = g.getTransform();
        for (const [px, py] of [[0, -size * 0.8], [adv, -size * 0.8], [0, size * 0.2], [adv, size * 0.2]]) { const sx = T.a * px + T.c * py + T.e, sy = T.b * px + T.d * py + T.f; bx0 = Math.min(bx0, sx); by0 = Math.min(by0, sy); bx1 = Math.max(bx1, sx); by1 = Math.max(by1, sy); }
        g.restore(); shown++;
      });
      g.globalAlpha = base;
      if (shown && o.id !== false) env.registerBox(o.id ?? str, String(str), { x: bx0 / SC, y: by0 / SC, w: (bx1 - bx0) / SC, h: (by1 - by0) / SC });
      return total;
    }
    const lettersW = (str, size, o = {}) => env.measure(String(str), `${o.weight ?? 900} ${size}px ${DISPLAY}`).w + ([...String(str)].length - 1) * (o.track ?? size * 0.03);

    // ---- faces: smile, happy (eyes closed, open mouth), wow, sad, focus; blink with o.blink (a key)
    function face(x, y, s, mood = 'smile', o = {}) {
      const I = PAL.ink, look = o.look ?? [0, 0];
      if (o.blink != null && mood !== 'happy' && mood !== 'focus' && (B + (env.fnv('blink', o.blink) % 37)) % 37 < 2) mood = mood === 'wow' ? 'wow-blink' : 'focus';
      const eye = (ex) => {
        if (mood === 'happy') { ink(arcPts(ex, y + 5 * s, 8 * s, Math.PI * 1.15, Math.PI * 1.85, 8), { w: 3.6 * s, color: I, amt: 0.2, key: 'fe' + ex + mood }); return; }
        if (mood === 'focus' || mood === 'wow-blink') { ink([[ex - 7 * s, y], [ex + 7 * s, y]], { w: 3.6 * s, color: I, amt: 0.2, key: 'ff' + ex }); return; }
        dot(ex + look[0] * s, y + look[1] * s, (mood === 'wow' ? 7.5 : 6) * s, I); dot(ex + look[0] * s + 2 * s, y + look[1] * s - 2.4 * s, 2 * s, '#fff');
      };
      eye(x - 16 * s); eye(x + 16 * s);
      g.fillStyle = 'rgba(240,110,120,0.45)'; g.beginPath(); g.ellipse(x - 27 * s, y + 11 * s, 7 * s, 4.5 * s, 0, 0, TAU); g.ellipse(x + 27 * s, y + 11 * s, 7 * s, 4.5 * s, 0, 0, TAU); g.fill();
      if (mood === 'sad') {
        ink([[x - 24 * s, y - 13 * s], [x - 10 * s, y - 9 * s]], { w: 3 * s, color: I, amt: 0.2, key: 'fbl' }); ink([[x + 24 * s, y - 13 * s], [x + 10 * s, y - 9 * s]], { w: 3 * s, color: I, amt: 0.2, key: 'fbr' });
        ink(arcPts(x, y + 22 * s, 8 * s, Math.PI * 1.2, Math.PI * 1.8, 8), { w: 3.2 * s, color: I, amt: 0.2, key: 'fms' });
      } else if (mood === 'wow' || mood === 'wow-blink') { g.fillStyle = I; g.beginPath(); g.ellipse(x, y + 16 * s, 5 * s, 7 * s, 0, 0, TAU); g.fill(); }
      else if (mood === 'happy') {
        g.fillStyle = I; g.beginPath(); g.arc(x, y + 10 * s, 10 * s, 0, Math.PI); g.closePath(); g.fill();
        g.fillStyle = '#e8707a'; g.beginPath(); g.ellipse(x, y + 16 * s, 5.5 * s, 3 * s, 0, 0, TAU); g.fill();
      } else ink(arcPts(x, y + 8 * s, 8 * s, Math.PI * 0.2, Math.PI * 0.8, 8), { w: 3.2 * s, color: I, amt: 0.2, key: 'fm' + mood });
    }

    // ---- THE SPARK: the hero, an orange starburst with a face. It idles on its own (bob, blink, ray sway); its
    //      ray count can tell time (one more ray per step of the story). o: rays, mood, key, s (scale), rot, look
    function spark(x, y, r, o = {}) {
      const sc = o.s ?? 1; if (sc <= 0.01) return;
      r *= sc;
      const key = o.key ?? 'spk', ph = key.length * 1.7;
      y += Math.sin(TT * TAU * 0.9 + ph) * r * 0.035;
      let mood = o.mood ?? 'smile';
      if (mood !== 'happy' && mood !== 'focus' && (B + Math.round(ph * 5)) % 37 < 2) mood = 'focus';
      const n = o.rays ?? 9, r0 = (o.rot ?? -Math.PI / 2) + Math.sin(TT * 2.1 + ph) * 0.05, RR = RNG('rays', key);
      for (let i = 0; i < n; i++) {
        const a = r0 + (i / n) * TAU + RR.n(0.05), L = r * (0.92 + RR.f() * 0.16);
        cut(capsulePts(x + Math.cos(a) * r * 0.25, y + Math.sin(a) * r * 0.25, x + Math.cos(a) * L, y + Math.sin(a) * L, r * 0.36), PAL.orange, { key: key + 'r' + i, crayon: PAL.orangeD, crAl: 0.4, crPer: 30, sb: 6, sy: 4, tear: 0.7, grain: 0.6 });
      }
      cut(ellipsePts(x, y, r * 0.52, r * 0.5, 0, 30), PAL.orange, { key: key + 'b', crayon: PAL.orangeD, crAl: 0.3, crPer: 30, shadow: false, tear: 0.5, grain: 0.6 });
      face(x, y + r * 0.04, r / 64, mood, { look: o.look });
    }
    // the hero's outline, for a window or a morph (rays as a star)
    function sparkPts(x, y, r, n = 9, m = 96) { const P = []; for (let i = 0; i < m; i++) { const a = -Math.PI / 2 + (i / m) * TAU, k = 0.62 + 0.38 * Math.pow(Math.abs(Math.cos((a + Math.PI / 2) * n / 2)), 6); P.push([x + Math.cos(a) * r * k, y + Math.sin(a) * r * k]); } return P; }

    // ---- people: a bust, shoulders at (x, y). o: key, skin, hair, shirt, shirtPat, beard, glasses, mood, long, look,
    //      raise (0..1: one arm swings up from behind the shoulder, clear of the head), side (1 right, -1 left).
    //      Returns the raised mitten's centre (to pin a held thing to), or null.
    function person(x, y, s, o = {}) {
      const key = o.key ?? 'ps', skin = o.skin ?? PAL.skin2, hair = o.hair ?? '#2b211d', shirt = o.shirt ?? PAL.blue;
      const pose = (o.raise ?? 0) > 0.004 ? armPose(x, y, s, o.raise, o.side ?? 1) : null;
      if (o.long) cut(rect(x - 92 * s, y - 190 * s, 184 * s, 230 * s, 70 * s), hair, { key: key + 'hl', sb: 6 });
      if (pose) arm(pose.sh[0], pose.sh[1], pose.wr[0], pose.wr[1], pose.hs, skin, shirt, { key: key + 'arm', a: pose.a, sleevePat: o.shirtPat });
      cut(rect(x - 125 * s, y, 250 * s, 330 * s, 80 * s), shirt, { key: key + 't', pat: o.shirtPat });
      cut(rect(x - 24 * s, y - 46 * s, 48 * s, 66 * s, 12 * s), skin, { key: key + 'n', shadow: false });
      cut(ellipsePts(x - 74 * s, y - 112 * s, 14 * s, 20 * s, 0, 14), skin, { key: key + 'el' });
      cut(ellipsePts(x + 74 * s, y - 112 * s, 14 * s, 20 * s, 0, 14), skin, { key: key + 'er' });
      cut(ellipsePts(x, y - 116 * s, 76 * s, 86 * s, 0, 30), skin, { key: key + 'h' });
      if (o.beard) cut([[x - 74 * s, y - 120 * s], [x - 70 * s, y - 60 * s], [x - 30 * s, y - 32 * s], [x + 30 * s, y - 32 * s], [x + 70 * s, y - 60 * s], [x + 74 * s, y - 120 * s], [x + 50 * s, y - 80 * s], [x - 50 * s, y - 80 * s]], hair, { key: key + 'bd', shadow: false });
      cut([[x - 80 * s, y - 120 * s], [x - 82 * s, y - 170 * s], [x - 40 * s, y - 214 * s], [x + 40 * s, y - 214 * s], [x + 84 * s, y - 168 * s], [x + 80 * s, y - 122 * s], [x + 60 * s, y - 160 * s], [x - 50 * s, y - 166 * s]], hair, { key: key + 'hr', sb: 4 });
      face(x, y - 118 * s, s * 1.25, o.mood ?? 'smile', { blink: o.blink ?? key, look: o.look });
      if (o.glasses) { g.save(); g.strokeStyle = PAL.ink; g.lineWidth = 4 * s; g.beginPath(); g.arc(x - 21 * s, y - 118 * s, 17 * s, 0, TAU); g.moveTo(x + 38 * s, y - 118 * s); g.arc(x + 21 * s, y - 118 * s, 17 * s, 0, TAU); g.moveTo(x - 4 * s, y - 120 * s); g.lineTo(x + 4 * s, y - 120 * s); g.stroke(); g.restore(); }
      return pose ? pose.hand : null;
    }
    // where a person's raised arm is (no drawing). It slides out of the shoulder, up and out, never sweeping across a
    // neighbour: at 0 the mitten sits hidden behind the torso, at 1 the arm stands at full length with its sleeve clear
    // of the ear, and past 1 (a spring's overshoot) it waves outward. { sh, wr, hand (the mitten's centre), a, hs }
    function armPose(x, y, s, k, side = 1) {
      const hs = s * 0.78, a1 = -Math.PI / 2 + 0.42 + Math.max(0, k - 1) * 0.8, a = side < 0 ? Math.PI - a1 : a1, c = Math.cos(a), si = Math.sin(a);
      const sh = [x + side * 80 * s, y + 60 * s], m = (232 * s + 40 * hs) * clamp(k), wr = [sh[0] + c * (m - 40 * hs), sh[1] + si * (m - 40 * hs)];
      return { sh, wr, a, hs, hand: [sh[0] + c * m, sh[1] + si * m] };
    }
    function mitten(x, y, s, a, skin, key) {
      const c = Math.cos(a), si = Math.sin(a);
      cut(ellipsePts(x + c * 40 * s, y + si * 40 * s, 46 * s, 36 * s, a, 22), skin, { key: key + 'h' });
      cut(ellipsePts(x + c * 36 * s - si * 34 * s, y + si * 36 * s + c * 34 * s, 22 * s, 13 * s, a + 0.5, 14), skin, { key: key + 't', sb: 4 });
    }
    // a mitten hand with a sleeve, pointing along angle a from the sleeve end (x, y). o.len: the sleeve (200);
    // o.part: 'sleeve' or 'mitten' draws one half, so a held thing can go between them
    function hand(x, y, s, a, skin, sleeve, o = {}) {
      const c = Math.cos(a), si = Math.sin(a), key = o.key ?? 'hd', L = (o.len ?? 200) * s;
      if (o.part !== 'mitten') cut(capsulePts(x - c * L, y - si * L, x, y, 92 * s, 4), sleeve, { key: key + 's', pat: o.sleevePat });
      if (o.part !== 'sleeve') mitten(x, y, s, a, skin, key);
    }
    // an arm from the shoulder (sx, sy) to the wrist (wx, wy), bent at o.elbow ([x, y]) when given; the mitten turns
    // along the forearm (o.a turns it). o.part as hand's. Returns the mitten's centre.
    function arm(sx, sy, wx, wy, s, skin, sleeve, o = {}) {
      const key = o.key ?? 'arm', e = o.elbow, fx = e ? e[0] : sx, fy = e ? e[1] : sy, a = o.a ?? Math.atan2(wy - fy, wx - fx);
      if (o.part !== 'mitten') {
        if (e) cut(capsulePts(sx, sy, e[0], e[1], 92 * s, 4), sleeve, { key: key + 'u', pat: o.sleevePat });
        cut(capsulePts(fx, fy, wx, wy, 92 * s, 4), sleeve, { key: key + 's', pat: o.sleevePat });
      }
      if (o.part !== 'sleeve') mitten(wx, wy, s, a, skin, key);
      return [wx + Math.cos(a) * 40 * s, wy + Math.sin(a) * 40 * s];
    }

    // ---- props (animate's, plus a few for wider worlds)
    function clock(x, y, r, h, m, key = 'ck') {
      cut(ellipsePts(x, y, r, r, 0, 36), PAL.woodD, { key: key + 'o' });
      cut(ellipsePts(x, y, r * 0.84, r * 0.84, 0, 36), PAL.paper, { key: key + 'i', shadow: false });
      for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; ink([[x + Math.cos(a) * r * 0.66, y + Math.sin(a) * r * 0.66], [x + Math.cos(a) * r * 0.76, y + Math.sin(a) * r * 0.76]], { w: 4, color: PAL.ink, amt: 0.2, key: key + 't' + i }); }
      const ah = (((h % 12) + m / 60) / 12) * TAU - Math.PI / 2, am = (m / 60) * TAU - Math.PI / 2;
      ink([[x, y], [x + Math.cos(ah) * r * 0.42, y + Math.sin(ah) * r * 0.42]], { w: 7, color: PAL.ink, amt: 0.3, key: key + 'h' });
      ink([[x, y], [x + Math.cos(am) * r * 0.64, y + Math.sin(am) * r * 0.64]], { w: 5, color: PAL.ink, amt: 0.3, key: key + 'm' });
      dot(x, y, 6);
    }
    function cat(x, y, s, c = PAL.charcoal, key = 'cat', o = {}) {   // a sleeping loaf (o.awake: eyes open)
      cut(ellipsePts(x, y, 80 * s, 40 * s, 0, 30), c, { key: key + 'b' });
      cut(capsulePts(x + 70 * s, y + 20 * s, x - 70 * s, y + 30 * s, 20 * s), c, { key: key + 't', sb: 4 });
      cut([[x - 96 * s, y - 34 * s], [x - 88 * s, y - 72 * s], [x - 70 * s, y - 44 * s], [x - 46 * s, y - 72 * s], [x - 40 * s, y - 30 * s], [x - 50 * s, y + 6 * s], [x - 90 * s, y + 6 * s]], c, { key: key + 'h' });
      if (o.awake) { dot(x - 78 * s, y - 26 * s, 5 * s, '#e8d36a'); dot(x - 58 * s, y - 26 * s, 5 * s, '#e8d36a'); dot(x - 78 * s, y - 26 * s, 2 * s, PAL.ink); dot(x - 58 * s, y - 26 * s, 2 * s, PAL.ink); return; }
      ink(arcPts(x - 78 * s, y - 24 * s, 6 * s, 0.2, Math.PI - 0.2, 6), { w: 2.6, color: '#d8d0c4', amt: 0.2, key: key + 'e1' });
      ink(arcPts(x - 58 * s, y - 24 * s, 6 * s, 0.2, Math.PI - 0.2, 6), { w: 2.6, color: '#d8d0c4', amt: 0.2, key: key + 'e2' });
      const zf = (((TT * 18) % 36) + 36) % 36;
      handText('z', x - 30 * s, y - (70 + zf) * s, 34 * s, 'rgba(255,255,255,0.8)', { key: key + 'z1', id: false });
      handText('z', x - 10 * s, y - (100 + zf) * s, 26 * s, 'rgba(255,255,255,0.6)', { key: key + 'z2', id: false });
    }
    function mug(x, y, s, c, key = 'mug', steam = true) {
      cut(ellipsePts(x + 46 * s, y + 30 * s, 22 * s, 26 * s, 0, 18), c, { key: key + 'hd', sb: 4 });
      cut(rect(x - 44 * s, y, 88 * s, 96 * s, 14 * s), c, { key: key + 'b' });
      if (steam) for (let i = 0; i < 3; i++) { const P = []; for (let k = 0; k <= 10; k++) P.push([x - 22 * s + i * 22 * s + Math.sin(k * 0.9 + i + TT * 4) * 9 * s, y - 14 * s - k * 9 * s]); ink(P, { w: 4 * s, color: 'rgba(255,255,255,0.75)', amt: 0.8, key: key + 'st' + i }); }
    }
    function plant(x, y, s, pot = PAL.blue, key = 'pl') {
      const R = RNG('pl', key);
      for (let i = 0; i < 7; i++) { const a = -Math.PI / 2 + R.n(0.9), L = R.r(90, 150) * s, cx = x + Math.cos(a) * L * 0.5, cy = y - 40 * s + Math.sin(a) * L * 0.5; cut(rot(ellipsePts(cx, cy, L * 0.5, 20 * s, 0, 16), cx, cy, a), i % 2 ? PAL.green : PAL.greenD, { key: key + 'l' + i, sb: 5 }); }
      cut([[x - 56 * s, y - 40 * s], [x + 56 * s, y - 40 * s], [x + 42 * s, y + 60 * s], [x - 42 * s, y + 60 * s]], pot, { key: key + 'p', pat: pat.stripes('rgba(255,255,255,0.18)', 8, 26) });
    }
    function books(x, y, s, key = 'bk') {
      const cols = [PAL.teal, PAL.pink, PAL.purple, PAL.yellow, PAL.blue, PAL.green], R = RNG('bk', key);
      let yy = y;
      for (let i = 0; i < 4; i++) { const w = R.r(150, 200) * s, h = R.r(30, 42) * s; cut(rect(x - w / 2 + R.n(10), yy - h, w, h, 4), cols[(i + key.length) % cols.length], { key: key + i, sb: 5, pat: pat.stripes('rgba(255,255,255,0.35)', 6, 1000) }); yy -= h; }
    }
    // a house: walls, a roof, a door, windows (o.lit: lamplight), a chimney
    function house(x, y, s, o = {}) {
      const key = o.key ?? 'hs', w = 220 * s, h = 180 * s, c = o.fill ?? PAL.brick, roof = o.roof ?? '#7d5b52';
      cut(rect(x + w * 0.18, y - h - 96 * s, 34 * s, 70 * s, 3), roof, { key: key + 'ch', sb: 5 });
      cut(rect(x - w / 2, y - h, w, h, 4), c, { key: key + 'w', pat: o.pat ?? pat.lines('rgba(255,255,255,0.22)', 26 * s) });
      cut([[x - w / 2 - 22 * s, y - h + 6 * s], [x, y - h - 120 * s], [x + w / 2 + 22 * s, y - h + 6 * s]], roof, { key: key + 'r', crayon: 'rgba(0,0,0,0.25)', crAl: 0.25 });
      cut(rect(x - 26 * s, y - 92 * s, 52 * s, 92 * s, 5 * s), o.door ?? '#6b4a3a', { key: key + 'd', sb: 4 });
      for (const sx of [-1, 1]) {
        const wx = x + sx * 68 * s - 22 * s, wy = y - h + 44 * s;
        cut(rect(wx, wy, 44 * s, 44 * s, 3), o.lit ? PAL.yellow : '#3d4a63', { key: key + 'wn' + sx, sb: 4 });
        ink([[wx + 22 * s, wy + 2 * s], [wx + 22 * s, wy + 42 * s]], { w: 3 * s, color: PAL.woodD, amt: 0.3, key: key + 'wb' + sx });
      }
      if (o.lit) glow(x, y - h + 66 * s, 160 * s, 'rgba(255,214,120,0.28)');
    }
    // a tree: a trunk and a round crown of torn leaves (o.bare: branches only)
    function tree(x, y, s, o = {}) {
      const key = o.key ?? 'tr', R = RNG('tree', key), c = o.trunk ?? '#6e5038';
      cut(capsulePts(x, y + 20 * s, x + 6 * s, y - 230 * s, 34 * s), c, { key: key + 't' });
      if (o.bare) { [[-1, 0.5], [1, 0.35], [-1, 0.2], [1, 0.65]].forEach(([d, f], k) => cut(capsulePts(x + 2, y - 230 * s * f, x + d * 110 * s, y - 230 * s * f - 90 * s, 12 * s), c, { key: key + 'b' + k, sb: 4 })); return; }
      const sway = Math.sin(TT * 1.3 + key.length) * 4 * s;
      for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i - 2) * 0.55, d = i === 2 ? 0 : 70 * s; cut(ellipsePts(x + Math.cos(a) * d + sway, y - 260 * s + Math.sin(a) * d * 0.6 + R.n(10 * s), R.r(80, 100) * s, R.r(70, 86) * s, 0, 26), i % 2 ? (o.leaf ?? PAL.green) : (o.leaf2 ?? PAL.greenD), { key: key + 'c' + i, sb: 8, crayon: 'rgba(255,255,255,0.35)', crAl: 0.25 }); }
    }
    function cloud(x, y, s, key = 'cl', c = '#ffffff') { [[-60, 10, 70, 44], [0, -14, 86, 60], [64, 8, 70, 46]].forEach(([dx, dy, rx, ry], i) => cut(ellipsePts(x + dx * s, y + dy * s, rx * s, ry * s, 0, 24), c, { key: key + i, sb: 6, sy: 4 })); }
    function sun(x, y, r, o = {}) {   // a yellow sun with paper rays (never orange: orange is the hero's)
      const key = o.key ?? 'sun', n = o.rays ?? 12, a0 = (o.turn ?? 0) + TT * 0.15;
      for (let i = 0; i < n; i++) { const a = a0 + (i / n) * TAU, L = r * 1.45; cut([[x + Math.cos(a - 0.12) * r * 0.9, y + Math.sin(a - 0.12) * r * 0.9], [x + Math.cos(a) * L, y + Math.sin(a) * L], [x + Math.cos(a + 0.12) * r * 0.9, y + Math.sin(a + 0.12) * r * 0.9]], PAL.yellow, { key: key + 'r' + i, sb: 5, sy: 3 }); }
      cut(ellipsePts(x, y, r, r, 0, 36), PAL.yellow, { key: key + 'b', crayon: '#e6b23a', crAl: 0.45 });
      if (o.face) face(x, y + r * 0.08, r / 70, o.mood ?? 'happy');
    }
    // a paper moon; a crescent unless o.crescent is false (cut out of the disc, so the sky behind shows through)
    function moon(x, y, r, o = {}) {
      const key = o.key ?? 'moon', cx = x + r * 0.5, cy = y - r * 0.32, rr = r * 0.9;
      g.save();
      if (o.crescent !== false) { g.beginPath(); g.rect(x - 3 * r, y - 3 * r, 6 * r, 6 * r); g.moveTo(cx + rr, cy); g.arc(cx, cy, rr, 0, TAU); g.clip('evenodd'); }
      cut(ellipsePts(x, y, r, r, 0, 30), '#f6ecc8', { key });
      g.restore();
    }
    function bird(x, y, s, o = {}) {   // a round bird; o.flap: wings up/down on the boil; o.face: -1 faces left
      const key = o.key ?? 'bd', c = o.fill ?? '#5a6a86', fx = o.facing ?? 1, up = o.flap ? (B % 4 < 2 ? -1 : 1) : 0;
      cut(ellipsePts(x, y - 22 * s, 26 * s, 22 * s, 0, 20), c, { key: key + 'b', sb: 4 });
      cut([[x - 8 * fx * s, y - 26 * s], [x - 30 * fx * s, y - (40 + 14 * up) * s], [x - 26 * fx * s, y - 18 * s]], c, { key: key + 'w', sb: 3 });
      dot(x + 10 * fx * s, y - 30 * s, 3.5 * s); cut([[x + 22 * fx * s, y - 28 * s], [x + 36 * fx * s, y - 24 * s], [x + 22 * fx * s, y - 20 * s]], PAL.yellow, { key: key + 'k', shadow: false });
    }
    // bunting along a string from a to b: triangles in cycling colours, swaying
    function bunting(a, b, o = {}) {
      const key = o.key ?? 'bn', n = o.n ?? 9, sag = o.sag ?? 60, cols = o.colors ?? [PAL.teal, PAL.yellow, PAL.pink, PAL.blue, PAL.mint], P = [];
      for (let i = 0; i <= 20; i++) { const u = i / 20; P.push([lerp(a[0], b[0], u), lerp(a[1], b[1], u) + Math.sin(u * Math.PI) * sag]); }
      ink(P, { w: 3, color: '#5a4a3a', amt: 0.5, key: key + 's' });
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / n, px = lerp(a[0], b[0], u), py = lerp(a[1], b[1], u) + Math.sin(u * Math.PI) * sag, sw = Math.sin(TT * 2.4 + i) * 0.08, sz = o.size ?? 46;
        cut(rot([[px - sz * 0.5, py], [px + sz * 0.5, py], [px, py + sz * 1.1]], px, py, sw), cols[i % cols.length], { key: key + i, sb: 5, sy: 4, pat: i % 2 ? pat.dots('rgba(255,255,255,0.35)', 3, 14) : null });
      }
    }
    // a gear (teeth on a disc) turned to angle a, with a plain paper hub (no ink in it: a dot there reads as an eye)
    function gear(x, y, r, a, c, key = 'gr', o = {}) {
      const n = o.teeth ?? Math.max(6, Math.round(r / 9)), P = [];
      for (let i = 0; i < n; i++) for (const [f, rr] of [[0.0, 0.84], [0.12, 1], [0.38, 1], [0.5, 0.84]]) { const ang = a + ((i + f) / n) * TAU; P.push([x + Math.cos(ang) * r * rr, y + Math.sin(ang) * r * rr]); }
      cut(P, c, { key, tear: 0.6, amt: 0.5, crayon: 'rgba(0,0,0,0.25)', crAl: 0.3, sb: 8 });
      cut(ellipsePts(x, y, r * 0.26, r * 0.26, 0, 20), o.hub ?? PAL.cream, { key: key + 'h', sb: 4, sy: 3 });
    }
    // a speech bubble: a paper cloud with a tail toward (tx, ty); o.draw(x, y) fills it
    function bubble(x, y, w, h, tx, ty, o = {}) {
      const key = o.key ?? 'bb', s = o.s ?? 1; if (s <= 0.01) return;
      g.save(); g.translate(tx, ty); g.scale(s, s); g.translate(-tx, -ty);
      const P = rect(x - w / 2, y - h / 2, w, h, Math.min(w, h) * 0.45), a = Math.atan2(ty - y, tx - x), bx = x + Math.cos(a) * w * 0.25, by = y + Math.sin(a) * h * 0.3;
      cut([[bx - 22, by - 10], [tx, ty], [bx + 22, by + 10]], o.fill ?? PAL.paper, { key: key + 't', sb: 6 });
      cut(P, o.fill ?? PAL.paper, { key: key + 'b', sb: 10 });
      if (o.draw) o.draw(x, y);
      g.restore();
    }
    // a sheet of ruled paper at (x, y) (its centre), turned rot; o.draw(w, h) writes on it in its own frame
    function page(x, y, w, h, angle = 0, o = {}) {
      g.save(); g.translate(x, y); g.rotate(angle);
      cut(rect(-w / 2, -h / 2, w, h, 4), o.fill ?? PAL.paper, { key: o.key ?? 'page', pat: o.ruled === false ? null : pat.lines('rgba(90,130,190,0.30)', o.gap ?? 52, 40), sb: o.sb ?? 12 });
      if (o.draw) o.draw(w, h);
      g.restore();
    }
    // a desk lamp at (x, y) (its base): arm, shade and a cone of light (o.on)
    function lamp(x, y, s, o = {}) {
      const key = o.key ?? 'lp';
      if (o.on !== false) {
        const beam = [[x + 70 * s, y - 248 * s], [x + 260 * s, y - 248 * s], [x + 760 * s, y + 230 * s], [x - 150 * s, y + 230 * s]];
        g.save(); g.globalAlpha *= 0.5; cut(beam, 'rgba(255,206,100,1)', { key: key + 'beam', shadow: false, shade: false, grain: 0.5, tear: 2, amt: 1.2 }); g.restore();
        g.save(); g.beginPath(); beam.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py))); g.closePath(); g.clip();
        const gr = g.createLinearGradient(x, y - 250 * s, x, y + 230 * s); gr.addColorStop(0, 'rgba(255,236,170,0.45)'); gr.addColorStop(1, 'rgba(255,236,170,0)'); g.fillStyle = gr; g.fillRect(x - 160 * s, y - 250 * s, 930 * s, 480 * s); g.restore();
        glow(x + 300 * s, y + 120 * s, 420 * s, 'rgba(255,210,110,0.30)');
      }
      cut(ellipsePts(x, y, 90 * s, 26 * s, 0, 24), o.fill ?? PAL.lamp, { key: key + 'b' });
      cut(capsulePts(x, y - 10 * s, x + 80 * s, y - 270 * s, 22 * s), '#c9a24a', { key: key + 'a' });
      cut([[x + 30 * s, y - 250 * s], [x + 70 * s, y - 330 * s], [x + 260 * s, y - 330 * s], [x + 300 * s, y - 250 * s]], o.fill ?? PAL.lamp, { key: key + 's', pat: pat.stripes('rgba(255,255,255,0.12)', 10, 30) });
    }
    function star(x, y, r, c = PAL.yellow, key = 'st') { const P = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i / 10) * TAU, k = i % 2 ? 0.45 : 1; P.push([x + Math.cos(a) * r * k, y + Math.sin(a) * r * k]); } cut(P, c, { key, sb: 5, sy: 3, tear: 0.6 }); }
    // confetti falling from t0 (screen-wide), n pieces
    function confetti(t0, n = 90, key = 'cf', cols = [PAL.teal, PAL.yellow, PAL.purple, PAL.mint, '#ffffff', PAL.blue, PAL.pink]) {
      if (TT < t0) return;
      const R = RNG('conf', key), d = TT - t0;
      for (let i = 0; i < n; i++) { const x = R.r(0, W), y = -40 + ((R.r(0, H) + d * R.r(140, 260)) % (H + 80)), a = R.r(0, 3) + d * R.r(1, 3); g.save(); g.translate(x + Math.sin(d * 2 + i) * 14, y); g.rotate(a); g.fillStyle = cols[i % cols.length]; g.fillRect(-9, -4, 18, 8); g.restore(); }
    }

    // ---- transitions
    // a hand-cut window: inside() draws a world seen through the torn hole P (screen coords); a paper rim, a shadow
    function windowCut(P, key, inside, o = {}) {
      const Q = torn(wobble(P, true, o.amt ?? 3, key, 9), key, o.tear ?? 2.4), k = zoomOf();
      g.save(); g.shadowColor = 'rgba(35,20,10,0.35)'; g.shadowBlur = 16 * k; g.shadowOffsetY = 6 * k; trace(Q, true); g.fillStyle = o.paper ?? PAL.blank; g.fill(); g.restore();
      g.save(); trace(Q, true); g.clip(); inside(); g.restore();
      g.save(); trace(Q, true); g.strokeStyle = o.rim ?? PAL.paper; g.lineWidth = o.rimW ?? 7; g.lineJoin = 'round'; g.stroke(); g.restore();
      return Q;
    }
    // a torn-paper wipe in screen space: a new sheet slides over from the right (dir 1) or the left (-1), its leading
    // edge torn, with the white core of the paper showing along the tear and a shadow on what it covers.
    // u: 0..1 progress (eased inside). inside() draws what's on the new sheet (the next world), clipped to it.
    function tear(u, key, inside, o = {}) {
      if (u <= 0) return;
      const dir = o.dir ?? 1, e = EZ.io(clamp(u)), lean = o.lean ?? 140, R = RNG('tear', key), x = dir > 0 ? lerp(W + lean + 80, -lean - 80, e) : lerp(-lean - 80, W + lean + 80, e);
      const edge = [];
      for (let y = -60, i = 0; y <= H + 60; y += 16, i++) edge.push([x + lean * (y / H - 0.5) + R.n(9) + Math.sin(y * 0.021 + key.length) * 16, y]);
      const far = dir > 0 ? W + lean + 400 : -lean - 400;
      const region = [...edge, [far, H + 60], [far, -60]];
      const fibre = edge.map(([ex, ey], i) => [ex - dir * (7 + RNG('fib', key, i).r(2, 14)), ey]);
      g.save(); g.setTransform(SC, 0, 0, SC, 0, 0);
      g.save(); g.shadowColor = 'rgba(35,20,10,0.38)'; g.shadowBlur = 22 * SC; g.shadowOffsetX = -dir * 10 * SC; g.beginPath(); fibre.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py))); g.lineTo(far, H + 60); g.lineTo(far, -60); g.closePath(); g.fillStyle = o.core ?? '#fbf8f0'; g.fill(); g.restore();
      g.save(); g.beginPath(); region.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py))); g.closePath(); g.clip(); inside(); g.restore();
      g.restore();
    }

    // ---- camera: parallax. A layer at depth f (1 = with the camera, 0 = fixed, < 1 farther, > 1 nearer) gets the
    //      camera's pan and zoom scaled by f about home (where every layer lines up). c = { z, p, to }
    function layerCam(c, f, home = [W / 2, H / 2]) {
      const z = 1 + ((c.z ?? 1) - 1) * f, p = c.p ?? home;
      return { z, p: [home[0] + (p[0] - home[0]) * f, home[1] + (p[1] - home[1]) * f], to: c.to ?? [W / 2, H / 2] };
    }
    // a back-eased pop-in scale from t (animate's popS); springIn for a settle with a hair of overshoot
    const popS = (t) => (TT < t ? 0 : EZ.back(clamp((TT - t) / 0.25)));
    const springIn = (t, p = 'playful') => (TT < t ? 0 : env.spring(TT - t, p));
    // the frame's grain over everything (screen space), reseeded with the boil; call last
    function grain(o = {}) {
      const R = RNG('pg', B);
      g.save(); g.setTransform(SC, 0, 0, SC, 0, 0); g.globalAlpha = o.alpha ?? 1;
      g.translate(-R.r(0, TILE), -R.r(0, TILE)); g.fillStyle = postTile(); g.fillRect(0, 0, W + TILE, H + TILE);
      g.restore();
    }

    return {
      bind(c) { g = c.g; B = c.B; TT = c.TT; SC = c.scale || 1; },
      PAL, HAND, DISPLAY,
      // the medium
      cut, wall, floor, pat, torn, ink, dot, pencil, sparkle, glow, grainIn, crayonIn, grain,
      // shapes
      rect, ellipsePts, rrectPts, arcPts, capsulePts, rot, xform, bbox, resample, pathLen, subPath, wobble, trace, dist,
      // characters and props
      face, spark, sparkPts, person, armPose, hand, arm, clock, cat, mug, plant, books, house, tree, cloud, sun, moon, bird, bunting, gear, bubble, page, lamp, star, confetti,
      // type
      handText, handW, handFont, tag, caption, cutLetters, lettersW, register,
      // transitions, camera, timing
      windowCut, tear, layerCam, popS, springIn,
    };
  },
});
