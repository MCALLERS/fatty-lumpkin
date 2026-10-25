// =====================================================================
//  engine/styles/riso/kit.js · Riso: a three-ink risograph print, 16:9. Nothing is painted; everything is printed.
//  A 16:9 port of cth9191/animate's riso style (styles/riso/kit.js + the parts of kit/core.js it uses), MIT,
//  Copyright (c) 2026 cth9191; the full notice is LICENSE beside this file and travels with every copy.
//  Port (Bombadillo AI, 2026): an FLPT.style plug-in with closure state instead of globals; the frame is 1920x1080;
//  the camera is read from the scene's canvas transform; type prints in bundled OFL faces from glyph outlines and
//  registers its box with the runtime; the morph-renderer hooks are left out; tag/card take explicit positions.
//  Added in the port: three faces (display, italic, mono), plate-offset and letter-by-letter type, depth() for
//  parallax, iris() for a world opening in a printed circle, drum banding in the print pass, speedLines, tonesOf.
//
//  A frame is a sheet of cream paper run through three spot-ink plates (teal, fluorescent pink, yellow).
//  A plate only says how much ink goes where (a grey tone 0..1); its screen turns the tone into dots at the
//  plate's own angle; the inks multiply. No black ink: darks are all three inks overprinted.
//    K.sheet()                              paper into the sheet buffer (or K.sheet(box): print over what g shows)
//    K.layer(pitch, { T, box, full, auto, shapes })   three grey plates + a mask; T = { s, x, y, rot }
//      K.fill / K.line / K.type / K.letters / K.rim / K.hero / K.iris ...
//    K.print()                              screen each plate, multiply the inks, blend into the sheet by the mask
//    K.endSheet()                           put the sheet into g (a box sheet puts only its box)
//  The scene's camera (g's transform, set with ctx.apply) is composed into every layer, so the screen belongs to
//  the illustration: it pans and scales with it and never swims under it.
// =====================================================================
FLPT.style('riso', {
  tokens: { paper: '#f2ece3', ink: '#3b3a2c', font: '"Fraunces Soft", "Arial Black", sans-serif', italic: '"Fraunces Soft Italic", Georgia, serif', mono: '"IBM Plex Mono", Menlo, monospace' },
  fonts: [
    { family: 'Fraunces Soft', file: 'fraunces-soft-black.ttf', weight: 900 },
    { family: 'Fraunces Soft Italic', file: 'fraunces-italic.ttf', weight: 480 },
    { family: 'IBM Plex Mono', file: 'IBMPlexMono-SemiBold.ttf', weight: 600 },
  ],
  ones: false,
  make(env) {
    const { W, H, rng: RNG, clamp, lerp } = env;
    const TAU = Math.PI * 2, DEG = Math.PI / 180;
    const FACES = { display: { family: env.tokens.font, weight: 900 }, italic: { family: env.tokens.italic, weight: 480 }, mono: { family: env.tokens.mono, weight: 600 } };
    let g = null, B = 0, TT = 0;   // bound per frame

    // ---- geometry (from animate kit/core.js)
    const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
    function ellipsePts(cx, cy, rx, ry, rot = 0, n = 64) { const P = [], c = Math.cos(rot), s = Math.sin(rot); for (let i = 0; i < n; i++) { const a = (TAU * i) / n, x = Math.cos(a) * rx, y = Math.sin(a) * ry; P.push([cx + x * c - y * s, cy + x * s + y * c]); } return P; }
    function arcPts(cx, cy, r, a0, a1, n = 18, sy = 1) { const P = []; for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; P.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * sy]); } return P; }
    function bbox(P, pad = 0) { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of P) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; } return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad }; }
    function resample(P, closed, step) { const out = [], n = P.length, m = closed ? n : n - 1; for (let i = 0; i < m; i++) { const a = P[i], b = P[(i + 1) % n], k = Math.max(1, Math.ceil(dist(a, b) / step)); for (let j = 0; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]); } if (!closed) out.push(P[n - 1]); return out; }
    function pathLen(P) { let L = 0; for (let i = 1; i < P.length; i++) L += dist(P[i - 1], P[i]); return L; }
    function subPath(P, frac) { let want = pathLen(P) * clamp(frac); const out = [P[0]]; for (let i = 1; i < P.length; i++) { const d = dist(P[i - 1], P[i]); if (want >= d) { out.push(P[i]); want -= d; } else { const k = want / (d || 1); out.push([lerp(P[i - 1][0], P[i][0], k), lerp(P[i - 1][1], P[i][1], k)]); break; } } return out; }
    function wobble(P, closed, amt, key, step = 7) {   // smooth hand wobble along the normal, reseeded every boil step
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

    // ---- THE PAPER: warm cream (241.5, 235.5, 226.5), std ~1.2; faint curly fibres and specks only. Cached.
    const PAPER = [241.5, 235.5, 226.5];
    let PAPER_PIX = null;
    function paperPixels() {
      if (PAPER_PIX) return PAPER_PIX;
      const c = env.canvas(W, H);
      const p = c.getContext('2d', { willReadFrequently: true }), R = RNG('paper'), k = (W * H) / (1080 * 1080);
      p.fillStyle = `rgb(${PAPER.map(Math.round).join(',')})`; p.fillRect(0, 0, W, H);
      for (let i = 0; i < 70 * k; i++) { const x = R.r(0, W), y = R.r(0, H), r = R.r(60, 160), gr = p.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, R.f() < 0.5 ? 'rgba(252,248,240,0.012)' : 'rgba(205,195,180,0.012)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); p.fillStyle = gr; p.fillRect(x - r, y - r, 2 * r, 2 * r); }
      p.lineCap = 'round';
      for (let i = 0; i < 240 * k; i++) { let x = R.r(0, W), y = R.r(0, H), a = R.r(0, TAU); const L = R.r(9, 24), bend = R.n(0.35); p.strokeStyle = `rgba(160,150,135,${R.r(0.1, 0.22)})`; p.lineWidth = R.r(0.7, 1.2); p.beginPath(); p.moveTo(x, y); for (let j = 0; j < 6; j++) { a += bend; x += (Math.cos(a) * L) / 6; y += (Math.sin(a) * L) / 6; p.lineTo(x, y); } p.stroke(); }
      for (let i = 0; i < 300 * k; i++) { p.fillStyle = `rgba(130,120,110,${R.r(0.1, 0.25)})`; p.fillRect(R.r(0, W), R.r(0, H), R.r(0.8, 1.6), R.r(0.8, 1.6)); }
      return (PAPER_PIX = p.getImageData(0, 0, W, H).data);
    }

    // ---- THE INKS: coral = pink+yellow, green = teal+yellow, ink-blue = teal+pink, olive-black = all three.
    const INKS = { teal: [54, 137, 171], pink: [220, 68, 160], yellow: [238, 222, 30] };
    const INK_NAMES = ['teal', 'pink', 'yellow'];
    const ABSORB = INK_NAMES.map((n) => INKS[n].map((v, c) => 1 - v / PAPER[c]));
    const MIX = {
      dark: { teal: 1, pink: 1, yellow: 1 }, coral: { pink: 1, yellow: 1 }, green: { teal: 1, yellow: 1 },
      blue: { teal: 1, pink: 1 }, teal: { teal: 1 }, pink: { pink: 1 }, yellow: { yellow: 1 }, paper: {},
      orange: { pink: 0.55, yellow: 1 }, peach: { pink: 0.3, yellow: 0.45 }, sky: { teal: 0.45, pink: 0.12 },
      lilac: { teal: 0.35, pink: 0.4 }, olive: { teal: 0.55, pink: 0.35, yellow: 1 }, rust: { teal: 0.3, pink: 0.9, yellow: 1 },
    };
    function inkRGB(t) { const out = PAPER.slice(); INK_NAMES.forEach((n, k) => { const v = typeof t[n] === 'number' ? t[n] : 0; for (let c = 0; c < 3; c++) out[c] *= 1 - v * ABSORB[k][c]; }); return out; }
    const rgbHex = (rgb) => '#' + rgb.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
    // tonesOf: the nearest plate tones (on the 20-level grid) for an RGB colour or '#rrggbb', so outside colours still print
    const TONE_CACHE = new Map();
    function tonesOf(c) {
      const rgb = typeof c === 'string' ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : c;
      const key = rgb.map(Math.round).join(',');
      if (TONE_CACHE.has(key)) return TONE_CACHE.get(key);
      let best = null, bd = Infinity;
      for (let a = 0; a <= 10; a++) for (let b = 0; b <= 10; b++) for (let d = 0; d <= 10; d++) {
        const t = { teal: a / 10, pink: b / 10, yellow: d / 10 }, p = inkRGB(t), e = (p[0] - rgb[0]) ** 2 + (p[1] - rgb[1]) ** 2 + (p[2] - rgb[2]) ** 2;
        if (e < bd) { bd = e; best = t; }
      }
      const out = {}; for (const n of INK_NAMES) if (best[n] > 0) out[n] = best[n];
      if (TONE_CACHE.size < 256) TONE_CACHE.set(key, out);
      return out;
    }

    // ---- THE SCREENS: teal 15, pink 75, yellow 45 degrees; 20 tone levels; dots to 50%, paper holes above.
    const ANGLE = { teal: 15, pink: 75, yellow: 45 }, LEVELS = 20;
    const DOT_R = Array.from({ length: LEVELS + 1 }, (_, l) => (l * 2 <= LEVELS ? Math.sqrt(l / LEVELS / Math.PI) : Math.sqrt((1 - l / LEVELS) / Math.PI)));
    const PITCH = { fine: 7, world: 10.8, field: 17.5 };
    const LEVEL_OF = Uint8Array.from({ length: 256 }, (_, v) => Math.round((v * LEVELS) / 255));

    // ---- THE PLATES: a layer = three grey plates + a mask; misregistration pink (+4,-3), yellow (-3,+4).
    const REG = { teal: [0, 0], pink: [4, -3], yellow: [-3, 4] };
    const PLATE = {};
    let RL = null, OUT = null, SHEET_BOX = null;
    const gray = (v) => { const u = Math.round(clamp(v) * 255); return `rgb(${u},${u},${u})`; };
    function plates() {
      if (PLATE.mask) return PLATE;
      for (const n of [...INK_NAMES, 'mask']) { const c = env.canvas(W, H); PLATE[n] = { c, g: c.getContext('2d', { willReadFrequently: true }) }; }
      return PLATE;
    }
    const clipBox = (b) => { if (!Array.isArray(b)) b = [b.x0, b.y0, b.x1, b.y1]; return [Math.max(0, Math.floor(b[0])), Math.max(0, Math.floor(b[1])), Math.min(W, Math.ceil(b[2])), Math.min(H, Math.ceil(b[3]))]; };
    function sheet(box) {
      if (!OUT) OUT = new ImageData(W, H);
      if (!box) { OUT.data.set(paperPixels()); SHEET_BOX = null; return; }
      const b = clipBox(box); SHEET_BOX = b; if (b[2] <= b[0] || b[3] <= b[1]) return;
      const src = g.getImageData(b[0], b[1], b[2] - b[0], b[3] - b[1]).data, w4 = (b[2] - b[0]) * 4;
      for (let y = b[1]; y < b[3]; y++) OUT.data.set(src.subarray((y - b[1]) * w4, (y - b[1] + 1) * w4), (y * W + b[0]) * 4);
    }
    function endSheet() {
      if (!SHEET_BOX) g.putImageData(OUT, 0, 0);
      else { const b = SHEET_BOX; if (b[2] > b[0] && b[3] > b[1]) g.putImageData(OUT, 0, 0, b[0], b[1], b[2] - b[0], b[3] - b[1]); }
      SHEET_BOX = null;
    }
    function layer(pitch = PITCH.world, o = {}) {
      const P = plates(), J = RNG('reg', B % 3), m = g.getTransform(), T0 = o.T || { s: 1, x: 0, y: 0 };
      const T = { s: m.a * T0.s, x: m.e + m.a * T0.x, y: m.f + m.a * T0.y };
      const cr = Math.cos(T0.rot || 0), sr = Math.sin(T0.rot || 0), dv = (x, y) => [T.x + T.s * (x * cr - y * sr), T.y + T.s * (x * sr + y * cr)];
      let b = [0, 0, W, H];
      if (o.box) { const bb = bbox([dv(o.box[0], o.box[1]), dv(o.box[2], o.box[1]), dv(o.box[2], o.box[3]), dv(o.box[0], o.box[3])], 8); b = [bb.x0, bb.y0, bb.x1, bb.y1]; }
      b = clipBox(b);
      if (SHEET_BOX) b = [Math.max(b[0], SHEET_BOX[0]), Math.max(b[1], SHEET_BOX[1]), Math.min(b[2], SHEET_BOX[2]), Math.min(b[3], SHEET_BOX[3])];
      for (const n of [...INK_NAMES, 'mask']) {
        const q = P[n].g; q.setTransform(1, 0, 0, 1, 0, 0); q.globalCompositeOperation = 'source-over'; q.globalAlpha = 1;
        q.fillStyle = '#000'; q.fillRect(b[0], b[1], Math.max(0, b[2] - b[0]), Math.max(0, b[3] - b[1]));
        const off = n === 'mask' ? [0, 0] : [REG[n][0] + J.n(0.3), REG[n][1] + J.n(0.3)];
        const ca = Math.cos(T0.rot || 0) * T.s, sa = Math.sin(T0.rot || 0) * T.s;
        q.setTransform(ca, sa, -sa, ca, T.x + off[0], T.y + off[1]);
      }
      RL = { T, rot: T0.rot || 0, pitch, box: b, auto: !!o.auto, shapes: !!o.shapes, clips: 0, band: o.band ?? 1 };
      if (o.full) maskFill((q) => q.rect(-1e5, -1e5, 2e5, 2e5));
      return RL;
    }
    const tonePaint = (tone, q) => (typeof tone === 'function' ? tone(q) : gray(tone));
    function fill(path, tones = {}, o = {}) {   // a knockout fill; o.over: only raise the listed plates (lighten)
      for (const n of INK_NAMES) {
        if (o.over && tones[n] == null) continue;
        const q = PLATE[n].g;
        q.globalCompositeOperation = o.over ? 'lighten' : 'source-over';
        q.fillStyle = tonePaint(tones[n] ?? 0, q); q.beginPath(); path(q); q.fill(o.rule || 'nonzero');
        q.globalCompositeOperation = 'source-over';
      }
      if (o.mask || RL.shapes) maskFill(path, o.rule);
    }
    function maskFill(path, rule) { const q = PLATE.mask.g; q.fillStyle = '#fff'; q.beginPath(); path(q); q.fill(rule || 'nonzero'); }
    // erase: take the listed inks back off a region (a plate not yet printed there); the mask keeps the paper
    function erase(path, inks = INK_NAMES) { for (const n of inks) { const q = PLATE[n].g; q.globalCompositeOperation = 'source-over'; q.fillStyle = '#000'; q.beginPath(); path(q); q.fill(); } }
    // place: fn's marks in a local frame { x, y, rot, s } on every plate and the mask; off moves single plates further
    // ({ pink: [dx, dy] }: that sheet's own misregistration). Type inside isn't registered (pass id: false).
    function place(T, fn, off) {
      const all = [...INK_NAMES, 'mask'];
      for (const n of all) { const q = PLATE[n].g, d = off && off[n]; q.save(); q.translate(T.x || 0, T.y || 0); if (T.rot) q.rotate(T.rot); if (T.s != null && T.s !== 1) q.scale(T.s, T.s); if (d) q.translate(d[0], d[1]); }
      try { fn(); } finally { for (const n of all) PLATE[n].g.restore(); }
    }
    const misregister = (off, fn) => place({}, fn, off);
    function clipTo(path) { for (const n of [...INK_NAMES, 'mask']) { const q = PLATE[n].g; q.save(); q.beginPath(); path(q); q.clip(); } RL.clips++; }
    function unclip() { if (!RL.clips) return; for (const n of [...INK_NAMES, 'mask']) PLATE[n].g.restore(); RL.clips--; }
    const lin = (x0, y0, x1, y1, stops) => (q) => { const gr = q.createLinearGradient(x0, y0, x1, y1); for (const [p, v] of stops) gr.addColorStop(p, gray(v)); return gr; };
    const rad = (x, y, r0, r1, stops) => (q) => { const gr = q.createRadialGradient(x, y, r0, x, y, r1); for (const [p, v] of stops) gr.addColorStop(p, gray(v)); return gr; };
    const circ = (x, y, r) => (q) => q.arc(x, y, Math.max(0, r), 0, TAU);
    const ell = (x, y, rx, ry, rot = 0) => (q) => q.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), rot, 0, TAU);
    const poly = (P) => (q) => { q.moveTo(P[0][0], P[0][1]); for (let i = 1; i < P.length; i++) q.lineTo(P[i][0], P[i][1]); q.closePath(); };
    const curvy = (P) => (q) => { const n = P.length; q.moveTo((P[n - 1][0] + P[0][0]) / 2, (P[n - 1][1] + P[0][1]) / 2); for (let i = 0; i < n; i++) { const p = P[i], r = P[(i + 1) % n]; q.quadraticCurveTo(p[0], p[1], (p[0] + r[0]) / 2, (p[1] + r[1]) / 2); } q.closePath(); };
    const rect = (x, y, w, h) => (q) => q.rect(x, y, w, h);
    const rrect = (x, y, w, h, r) => (q) => { const k = Math.min(r, w / 2, h / 2); q.moveTo(x + k, y); q.arcTo(x + w, y, x + w, y + h, k); q.arcTo(x + w, y + h, x, y + h, k); q.arcTo(x, y + h, x, y, k); q.arcTo(x, y, x + w, y, k); q.closePath(); };
    const hand = (P, key, amt = 1.4, step = 6) => curvy(wobble(P, true, amt, key, step));
    const boxPts = (x, y, w, h) => resample([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true, 24);

    // ---- WEAR, DRUM BANDING AND THE PRINT PASS
    const DROP = [];
    function dropouts(V) {
      if (DROP[V]) return DROP[V];
      const a = new Uint8Array(W * H), R = RNG('drop', V), n = Math.round(W * H * 0.006);
      for (let i = 0; i < n; i++) { const x = R.i(0, W - 3), y = R.i(0, H - 3), bit = 1 << R.i(0, 2), s = R.f() < 0.25 ? 2 : 1; for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) a[(y + dy) * W + x + dx] |= bit; }
      return (DROP[V] = a);
    }
    // the drum's banding: each plate inks a little unevenly across the sheet's feed, in bands tied to the paper (the
    // world), so they travel with the camera like the screen does. 0.86..1 of the ink; layer({ band: 0 }) turns it off.
    const BANDS = INK_NAMES.map((n) => { const R = RNG('band', n); return [R.r(0.004, 0.009), R.r(0, TAU), R.r(0.017, 0.031), R.r(0, TAU), R.r(0.0013, 0.0024), R.r(0, TAU)]; });
    const bandAt = (k, wy, wx) => { const b = BANDS[k]; return 1 - 0.07 * (1 + Math.sin(wy * b[0] + b[1] + wx * b[4])) * (0.6 + 0.4 * Math.sin(wy * b[2] + b[3])) - 0.02 * (1 + Math.sin(wx * b[4] * 1.7 + b[5])); };
    function print() {
      while (RL.clips) unclip();
      const { T, pitch, box: [x0, y0, x1, y1], auto, band } = RL, w = x1 - x0, h = y1 - y0;
      if (w <= 0 || h <= 0) return;
      const pl0 = PLATE.teal.g.getImageData(x0, y0, w, h).data, pl1 = PLATE.pink.g.getImageData(x0, y0, w, h).data, pl2 = PLATE.yellow.g.getImageData(x0, y0, w, h).data;
      const m = auto ? null : PLATE.mask.g.getImageData(x0, y0, w, h).data;
      const pp = paperPixels(), out = OUT.data, drop = dropouts(B % 3), p = pitch * T.s;
      const c0 = Math.cos(ANGLE.teal * DEG) / p, s0 = Math.sin(ANGLE.teal * DEG) / p, c1 = Math.cos(ANGLE.pink * DEG) / p, s1 = Math.sin(ANGLE.pink * DEG) / p, c2 = Math.cos(ANGLE.yellow * DEG) / p, s2 = Math.sin(ANGLE.yellow * DEG) / p;
      const [a00, a01, a02] = ABSORB[0], [a10, a11, a12] = ABSORB[1], [a20, a21, a22] = ABSORB[2], LV = LEVEL_OF, DR = DOT_R;
      const cov = (l, u, v) => {
        if (l >= LEVELS) return 1;
        const fu = u - Math.floor(u) - 0.5, fv = v - Math.floor(v) - 0.5; let c;
        if (l * 2 <= LEVELS) c = (DR[l] - Math.sqrt(fu * fu + fv * fv)) * p + 0.5;
        else { const gu = 0.5 - Math.abs(fu), gv = 0.5 - Math.abs(fv); c = (Math.sqrt(gu * gu + gv * gv) - DR[l]) * p + 0.5; }
        return c < 0 ? 0 : c > 1 ? 1 : c;
      };
      const wx = (x0 + w / 2 - T.x) / T.s;   // the paper's x at the middle of the box (bands drift slowly across)
      for (let y = 0; y < h; y++) {
        const Y = y0 + y, dy = Y - T.y, dx0 = x0 - T.x, row = Y * W, wy = dy / T.s;
        const k0b = band ? bandAt(0, wy, wx) : 1, k1b = band ? bandAt(1, wy, wx) : 1, k2b = band ? bandAt(2, wy, wx) : 1;
        let u0 = dx0 * c0 + dy * s0, v0 = dy * c0 - dx0 * s0, u1 = dx0 * c1 + dy * s1, v1 = dy * c1 - dx0 * s1, u2 = dx0 * c2 + dy * s2, v2 = dy * c2 - dx0 * s2;
        for (let x = 0, i4 = y * w * 4; x < w; x++, i4 += 4, u0 += c0, v0 -= s0, u1 += c1, v1 -= s1, u2 += c2, v2 -= s2) {
          const t0 = pl0[i4], t1 = pl1[i4], t2 = pl2[i4], mk = m ? m[i4] : (t0 | t1 | t2) > 6 ? 255 : 0;
          if (mk === 0) continue;
          const X = x0 + x, o = (row + X) * 4, dr = drop[row + X];
          let r = pp[o], gg = pp[o + 1], b = pp[o + 2];
          if (t0 >= 7 && !(dr & 1)) { const k = cov(LV[t0], u0, v0) * k0b; r *= 1 - k * a00; gg *= 1 - k * a01; b *= 1 - k * a02; }
          if (t1 >= 7 && !(dr & 2)) { const k = cov(LV[t1], u1, v1) * k1b; r *= 1 - k * a10; gg *= 1 - k * a11; b *= 1 - k * a12; }
          if (t2 >= 7 && !(dr & 4)) { const k = cov(LV[t2], u2, v2) * k2b; r *= 1 - k * a20; gg *= 1 - k * a21; b *= 1 - k * a22; }
          if (mk === 255) { out[o] = r; out[o + 1] = gg; out[o + 2] = b; } else { const a = mk / 255; out[o] += (r - out[o]) * a; out[o + 1] += (gg - out[o + 1]) * a; out[o + 2] += (b - out[o + 2]) * a; }
        }
      }
    }
    function printed(pitch, o, fn) { layer(pitch, o); fn(); print(); }
    function specks(x0, y0, x1, y1, n, key) { const R = RNG('speck', key); for (let i = 0; i < n; i++) fill(circ(R.r(x0, x1), R.r(y0, y1), R.r(1, 2.4)), [{ pink: 1 }, { yellow: 1 }, { teal: 1 }][i % 3]); }

    // ---- THE LINE: resample -> wobble (on the boil) -> a tapered ribbon with pressure -> printed through plates
    function ribbon(P, o = {}) {
      const closed = !!o.closed, key = o.key ?? 'rib';
      const Q = o.amt === 0 ? resample(P, closed, o.step ?? 5) : wobble(P, closed, o.amt ?? 1.4, key, o.step ?? 5);
      const n = Q.length, total = pathLen(closed ? [...Q, Q[0]] : Q) || 1, R = RNG('press', key, B % 3);
      const f1 = R.r(0.02, 0.05), f2 = R.r(0.12, 0.3), p1 = R.r(0, TAU), p2 = R.r(0, TAU), rough = o.rough ?? 0.15, w = o.w ?? 4;
      const L = [], Rt = []; let s = 0;
      for (let i = 0; i < n; i++) {
        const a = Q[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], c = Q[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
        let nx = a[1] - c[1], ny = c[0] - a[0]; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
        if (i) s += dist(Q[i - 1], Q[i]);
        const t = s / total, tp = o.taper ? Math.max(0, Math.min(1, t / o.taper, (1 - t) / o.taper)) ** 0.7 : 1;
        const hw = Math.max(0, (w / 2) * tp * (1 + rough * (0.6 * Math.sin(s * f1 + p1) + 0.4 * Math.sin(s * f2 + p2))));
        L.push([Q[i][0] + nx * hw, Q[i][1] + ny * hw]); Rt.push([Q[i][0] - nx * hw, Q[i][1] - ny * hw]);
      }
      return closed ? { outer: L, inner: Rt } : [...L, ...Rt.reverse()];
    }
    function line(P, tones, o = {}) {
      if (o.frac != null && o.frac < 1) { if (o.frac <= 0) return; P = subPath(o.closed ? [...P, P[0]] : P, o.frac); o = { ...o, closed: false }; }
      if (P.length < 2) return;
      const rb = ribbon(P, o), path = o.closed ? (q) => { poly(rb.outer)(q); poly(rb.inner)(q); } : poly(rb);
      fill(path, tones, { over: !o.knock, mask: o.mask, rule: o.closed ? 'evenodd' : 'nonzero' });
    }
    function ringPts(cx, cy, r, n = 0) { const k = n || Math.max(24, Math.round(r / 5)); return Array.from({ length: k }, (_, i) => [cx + Math.cos((i / k) * TAU) * r, cy + Math.sin((i / k) * TAU) * r]); }
    function rimLine(P, key, o = {}) {   // the dry-brush rim: a rough ribbon plus a thinner pass that doesn't agree
      const tones = o.tones || { teal: 1 }, w = o.w ?? 9;
      line(P, tones, { closed: true, w, rough: o.rough ?? 0.55, amt: o.amt ?? 2.2, key, mask: o.mask, knock: o.knock });
      if (o.double === false) return;
      const Q = resample(P, true, 8), R = RNG('rim2', key, B % 3), n = Q.length, i0 = R.i(0, n - 1), span = Math.floor(n * R.r(0.2, 0.4));
      const S = Array.from({ length: span }, (_, i) => Q[(i0 + i) % n]).map(([x, y]) => [x + R.n(1) + 3, y + 3]);
      if (S.length > 2) line(S, tones, { w: w * 0.35, taper: 0.3, amt: 1.2, key: key + '2', mask: o.mask });
    }
    function rim(cx, cy, r, key, o = {}) { rimLine(ringPts(cx, cy, r), key, o); }
    // a world opening in a printed circle (animate's riso window): fn prints inside the circle, then the rough rim.
    // Call inside a layer; the circle is masked, so what fn leaves unprinted is paper.
    function iris(cx, cy, r, key, fn, o = {}) {
      if (r <= 0.5) return;
      clipTo(circ(cx, cy, r)); maskFill(circ(cx, cy, r));
      if (fn) fn();
      unclip();
      if (o.rim !== false) rim(cx, cy, r, key, { w: o.w ?? Math.max(8, Math.min(22, r * 0.05)), tones: o.tones || { teal: 1 }, mask: true, knock: true });
    }

    // ---- TYPE: solid ink (no screen at tone 1), misregistered with the rest; registers its on-screen box.
    // Faces: display (Fraunces Soft Black), italic (Fraunces Soft italic), mono (IBM Plex Mono SemiBold, for labels).
    const fontOf = (o, size) => { const f = FACES[o.face || 'display'] || FACES.display; return { css: `${o.weight ?? f.weight} ${size}px ${f.family}`, f }; };
    const specOf = (css, tracking) => (tracking ? { font: css, tracking } : css);
    function typeW(str, size, weight, o = {}) { const { css } = fontOf({ ...o, weight: weight ?? o.weight }, size); return env.measure(str, specOf(css, o.tracking)).w; }
    function boxOn(x0, y0, x1, y1, rot = RL.rot) {   // a layer-space rectangle -> its on-screen bounding box
      const T = RL.T, cr = Math.cos(rot), sr = Math.sin(rot), dv = (px, py) => [T.x + T.s * (px * cr - py * sr), T.y + T.s * (px * sr + py * cr)];
      const bb = bbox([dv(x0, y0), dv(x1, y0), dv(x1, y1), dv(x0, y1)]);
      return { x: bb.x0, y: bb.y0, w: bb.x1 - bb.x0, h: bb.y1 - bb.y0 };
    }
    // o: { face, weight, tracking, align, frac (a write-on wipe), knock (default true), key, id, rot,
    //      plates: { teal: [dx, dy], pink: [dx, dy], yellow: [dx, dy] } (each plate's copy moved: the kinetic misregister) }
    function type(str, x, y, size, tones, o = {}) {
      const frac = clamp(o.frac ?? 1); if (frac <= 0) return;
      const { css } = fontOf(o, size), spec = specOf(css, o.tracking);
      const R = RNG('type', o.key ?? str, B % 3);
      const mt = env.measure(str, spec), w = mt.w, x0 = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x;
      const knock = o.knock !== false, jx = R.n(0.7), jy = R.n(0.7), rot = (o.rot ?? 0) + R.n(0.004), off = o.plates || {};
      const tp = env.textPath(str, spec);   // glyph outlines (the faces are embedded), else canvas text
      const glyphs = (qq) => { if (tp) qq.fill(tp.path); else env.fillText(qq, str, 0, 0, spec); };
      const each = (q, d, paint) => { q.save(); q.translate(x0 + jx + d[0], y + jy + d[1]); q.rotate(rot); if (frac < 1) { q.beginPath(); q.rect(-4, -size * 1.2, w * frac + 4, size * 1.7); q.clip(); } paint(q); q.restore(); };
      for (const n of INK_NAMES) {
        if (!knock && tones[n] == null) continue;
        const q = PLATE[n].g; q.globalCompositeOperation = knock ? 'source-over' : 'lighten';
        each(q, off[n] || [0, 0], (qq) => { qq.fillStyle = gray(tones[n] ?? 0); glyphs(qq); });
        q.globalCompositeOperation = 'source-over';
      }
      if (RL.shapes || o.mask) for (const n of INK_NAMES) if (tones[n] != null || knock) { each(PLATE.mask.g, off[n] || [0, 0], (qq) => { qq.fillStyle = '#fff'; glyphs(qq); }); if (!o.plates) break; }
      if (o.id !== false) env.registerBox(o.id ?? str, str, boxOn(x0, y - mt.asc, x0 + w * frac, y + mt.desc, RL.rot + rot), o.plates ? { overprint: true } : undefined);
      return { x0, w, asc: mt.asc, desc: mt.desc };
    }
    // letters: a word printed letter by letter, each glyph pressed in on its own spring and settling into register.
    // o: { at (s), stagger (s, 0.05), from: 'drop' | 'press' | 'rise', amount (1), spring ('playful'), face, weight,
    //      tracking, align, knock, key, id, plates (each plate's start offset, it settles to the register) }
    function letters(str, x, y, size, tones, o = {}) {
      const at = o.at ?? 0; if (TT < at) return null;
      const { css } = fontOf(o, size), spec = specOf(css, o.tracking), tr = o.tracking || 0;
      const chars = [...str], mt = env.measure(str, spec), w = mt.w, x0 = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x;
      const stagger = o.stagger ?? 0.05, amt = o.amount ?? 1, from = o.from || 'drop', knock = o.knock !== false;
      // Each glyph needs its own outline, but env.textPath tells the text report about every string it lays out, and
      // single letters would read there as stray words. FLPT.lib.textPath is the runtime's pure layout of the same
      // embedded faces and records nothing; without it, env.textPath (each glyph is then recorded). The report and the
      // box checks get the words pressed so far, below.
      const glyphPath = (ch) => (FLPT.lib && FLPT.lib.textPath ? FLPT.lib.textPath(ch, spec) : env.textPath(ch, spec));
      let shown = 0;   // characters the press has reached (a space as soon as it's reached)
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i]; if (ch === ' ') { shown++; continue; }
        const ti = at + i * stagger; if (TT < ti) break;
        shown++;
        const u = env.spring(TT - ti, o.spring || 'playful'), v = 1 - u, R = RNG('let', o.key ?? str, i);
        const xi = (i ? env.measure(chars.slice(0, i).join(''), spec).w + tr : 0), cw = env.measure(ch, spec).w;
        const dy = from === 'drop' ? -v * size * 0.9 * amt : from === 'rise' ? v * size * 0.7 * amt : 0;
        const sc = from === 'press' ? 1 + v * 0.9 * amt : 1 + v * 0.25 * amt, rot = v * R.n(0.6) * amt + R.n(0.03);
        const tp = glyphPath(ch), cx = x0 + xi + cw / 2;
        const paintGlyph = (qq) => { if (tp) qq.fill(tp.path); else env.fillText(qq, ch, 0, 0, spec); };
        for (const n of INK_NAMES) {
          if (!knock && tones[n] == null) continue;
          const q = PLATE[n].g, d = (o.plates && o.plates[n]) || [0, 0];
          q.save(); q.globalCompositeOperation = knock ? 'source-over' : 'lighten';
          q.translate(cx + d[0] * v, y + dy + d[1] * v); q.rotate(rot); q.scale(sc, sc); q.translate(-cw / 2, 0);
          q.fillStyle = gray(tones[n] ?? 0); paintGlyph(q); q.restore();
        }
        if (RL.shapes || o.mask) { const q = PLATE.mask.g; q.save(); q.translate(cx, y + dy); q.rotate(rot); q.scale(sc, sc); q.translate(-cw / 2, 0); q.fillStyle = '#fff'; paintGlyph(q); q.restore(); }
      }
      if (!shown) return { x0, w, done: false };
      // on the sheet so far: the box spans the glyphs pressed; the string names whole words (the one being pressed too)
      const done = shown >= chars.length, nx = done ? -1 : chars.indexOf(' ', shown);
      const words = done ? str : (chars[shown - 1] === ' ' ? chars.slice(0, shown) : chars.slice(0, nx < 0 ? chars.length : nx)).join('').trimEnd();
      const ws = done ? w : env.measure(chars.slice(0, shown).join('').trimEnd(), spec).w;
      env.textPath(words, spec);
      if (o.id !== false) env.registerBox(o.id ?? str, words, boxOn(x0, y - mt.asc, x0 + ws, y + mt.desc), o.plates ? { overprint: true } : undefined);
      return { x0, w, done };
    }

    // ---- THE HERO: a printed ink-blue bean, paper eyes, pink cheeks, a green sprout. Inside the current layer.
    const HERO_TONES = MIX.blue;
    function hero(x, y, r, o = {}) {
      const key = o.key ?? 'hero', hop = o.hop ?? 0, tones = o.tones || HERO_TONES;
      if (o.shadow !== false) fill(ell(x, y + r * 1.32, r * 0.8 * (1 - hop / (r * 6)), r * 0.16), { teal: 0.35, pink: 0.3 });
      y += -hop + Math.sin((TT * TAU * 6) / 7 + key.length) * r * 0.035;   // six bobs per 7 s: a Gallery loop wraps clean
      const legY = y + r * 0.85;
      for (const s of [-1, 1]) {
        line([[x + s * r * 0.3, legY - r * 0.1], [x + s * r * 0.34, y + r * 1.28]], tones, { w: r * 0.14, amt: 0.6, key: key + 'leg' + s, knock: true });
        fill(ell(x + s * r * 0.42, y + r * 1.3, r * 0.17, r * 0.08), tones);
      }
      const arms = o.arms ?? [0.35, 0.35], hands = [];
      for (const [i, s] of [[0, -1], [1, 1]]) {
        const a = arms[i], sx = x + s * r * 0.62, sy = y + r * 0.1, L = r * 0.75, hx = sx + s * Math.sin(a) * L, hy = sy + Math.cos(a) * L;
        line([[sx, sy], [lerp(sx, hx, 0.5) + s * r * 0.06, lerp(sy, hy, 0.5)], [hx, hy]], tones, { w: r * 0.13, amt: 0.5, key: key + 'arm' + s, knock: true });
        fill(circ(hx, hy, r * 0.11), tones); hands.push([hx, hy]);
      }
      if (o.sprout !== false) {
        line([[x, y - r * 0.95], [x + r * 0.04, y - r * 1.2], [x + r * 0.12, y - r * 1.34]], MIX.green, { w: r * 0.06, amt: 0.4, key: key + 'stem', knock: true });
        fill(ell(x + r * 0.26, y - r * 1.36, r * 0.17, r * 0.08, -0.4), MIX.green);
      }
      const P = wobble(ellipsePts(x, y, r * 0.78, r, 0, 40), true, Math.max(0.6, r * 0.012), key, 6);
      fill(curvy(P), tones);
      fill(ell(x, y + r * 0.42, r * 0.44, r * 0.36), o.belly || { teal: 0.55, pink: 0.35 });
      const lk = o.look ?? [0, 0], ey = y - r * 0.25, blink = o.blink ?? ((B + key.length * 7) % 41 < 2);
      for (const s of [-1, 1]) {
        const ex = x + s * r * 0.3;
        if (blink) { line([[ex - r * 0.14, ey], [ex + r * 0.14, ey]], MIX.dark, { w: r * 0.05, amt: 0.3, key: key + 'bl' + s, knock: true }); continue; }
        fill(ell(ex, ey, r * 0.17, r * (o.mood === 'wow' ? 0.25 : 0.22)), {});
        fill(circ(ex + lk[0] * r * 0.06, ey + lk[1] * r * 0.08, r * 0.085), MIX.dark);
        fill(circ(ex + lk[0] * r * 0.06 - r * 0.03, ey + lk[1] * r * 0.08 - r * 0.035, r * 0.025), {});
      }
      for (const s of [-1, 1]) fill(circ(x + s * r * 0.5, y + r * 0.02, r * 0.09), { pink: 1 });
      const my = y + r * 0.08;
      if (o.mood === 'wow') { fill(ell(x, my + r * 0.04, r * 0.08, r * 0.1), {}); fill(ell(x, my + r * 0.07, r * 0.05, r * 0.05), { pink: 1 }); }
      else line(arcPts(x, my - r * (o.mood === 'happy' ? 0.1 : 0.04), r * (o.mood === 'happy' ? 0.16 : 0.1), Math.PI * 0.15, Math.PI * 0.85, 10), {}, { w: r * 0.05, amt: 0.3, key: key + 'm', knock: true });
      if (o.hold) o.hold((hands[0][0] + hands[1][0]) / 2, Math.min(hands[0][1], hands[1][1]));
      return P;
    }
    const heroOutline = (x, y, r) => ellipsePts(x, y, r * 0.78, r, 0, 96);

    // ---- CAPTIONS: printed slips over what the frame shows, in screen space (call after the world sheet)
    // tag: a yellow slip on a screened pink block, ink-blue letters. card: a paper card with a teal rim.
    function tag(str, x, y, size, o = {}) {
      const s = o.s ?? 1; if (s <= 0.01) return;
      const tw = typeW(str, size, undefined, o), w = tw + size * 0.9, h = size * 1.5, rot = o.rot ?? -0.04, reach = (w / 2 + 40) * s;
      g.setTransform(1, 0, 0, 1, 0, 0); sheet([x - reach, y - reach, x + reach, y + reach]);
      printed(PITCH.fine, { T: { s, x, y, rot }, shapes: true }, () => {
        fill(hand(boxPts(-w / 2 + 12, -h / 2 + 14, w, h), 'tagsh' + str, 1.2), o.shadow ?? { pink: 0.75 });
        fill(hand(boxPts(-w / 2, -h / 2, w, h), 'tag' + str, 1.2), o.tones ?? { yellow: 1 });
        type(str, -w / 2 + size * 0.45, size * 0.36, size, o.ink ?? MIX.blue, { face: o.face, tracking: o.tracking, key: 'tagt' + str, frac: o.frac, id: o.id ?? 'tag:' + str });
      });
      endSheet();
    }
    function card(str, x, y, size, o = {}) {
      const s = o.s ?? 1; if (s <= 0.01) return;
      const tw = typeW(str, size, undefined, o), w = tw + size * 1.0, h = size * 1.6, rot = o.rot ?? 0.012, reach = (w / 2 + 40) * s;
      g.setTransform(1, 0, 0, 1, 0, 0); sheet([x - reach, y - reach, x + reach, y + reach]);
      printed(PITCH.fine, { T: { s, x, y, rot }, shapes: true }, () => {
        const P = boxPts(-w / 2, -h / 2, w, h);
        fill(hand(P, 'card' + str, 1.2), {});
        rimLine(P, 'cardr' + str, { w: 6, amt: 1.2, rough: 0.45 });
        type(str, -w / 2 + size * 0.5, size * 0.36, size, o.tones ?? MIX.blue, { face: o.face, tracking: o.tracking, key: 'cardt' + str, frac: o.frac, id: o.id ?? 'card:' + str });
      });
      endSheet();
    }
    // speed lines for something turning about (cx, cy): printed arcs trailing the motion, on the boil
    function speedLines(cx, cy, r0, r1, angle, amount, tones, key) {
      if (amount <= 0.02) return;
      const R = RNG('spd', key), n = 9;
      for (let i = 0; i < n; i++) {
        const rr = lerp(r0, r1, (i + 0.5) / n) + RNG('spdj', key, i, B).n(4), a0 = angle + R.r(0, TAU), sweep = amount * R.r(0.35, 0.8);
        line(arcPts(cx, cy, rr, a0 - sweep, a0, 14), tones, { w: R.r(4, 9), taper: 0.5, amt: 0.6, key: key + i, knock: true });
      }
    }
    // depth: the camera for a layer at depth d (1 = the world's own plane, 0 = pinned to the screen, between = farther):
    // zoom scales as z^d and the point under the frame's centre moves d as far. ctx.apply(K.depth(cam, 0.4)) before a
    // far layer is parallax; the screen still belongs to that layer, so its dots move with it.
    function depth(c, d = 0.5, C = [W / 2, H / 2]) {
      const z = c.z ?? 1, tx = c.tx ?? 0, ty = c.ty ?? 0, wc = [(C[0] - tx) / z, (C[1] - ty) / z], zd = Math.pow(z, d);
      const pd = [C[0] + (wc[0] - C[0]) * d, C[1] + (wc[1] - C[1]) * d];
      return { z: zd, tx: C[0] - zd * pd[0], ty: C[1] - zd * pd[1] };
    }

    const popS = (t) => (TT < t ? 0 : 1 + 2.70158 * ((clamp((TT - t) / 0.25) - 1) ** 3) + 1.70158 * ((clamp((TT - t) / 0.25) - 1) ** 2));
    return {
      bind(c) { g = c.g; B = c.B; TT = c.TT; },
      sheet, endSheet, layer, print, printed, fill, line, type, typeW, letters, rim, rimLine, iris, specks, clipTo, unclip, maskFill, erase, place, misregister,
      circ, ell, poly, curvy, rect, rrect, hand, boxPts, ringPts, lin, rad, MIX, PITCH, INKS, inkRGB, rgbHex, tonesOf,
      hero, heroOutline, tag, card, speedLines, depth, popS,
      wobble, resample, arcPts, ellipsePts, subPath, pathLen, bbox, dist,
    };
  },
});
