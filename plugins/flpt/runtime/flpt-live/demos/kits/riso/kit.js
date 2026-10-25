// =====================================================================
//  demos/kits/riso/kit.js: a three-ink risograph print, 16:9. Nothing is painted; everything is printed.
//  (flpt-live 1.0.0 demo kit from spike K6; the shipped Riso style comes with the Wave 2 styles.)
//  A 16:9 port of cth9191/animate's riso style (styles/riso/kit.js + the parts of kit/core.js it uses), MIT,
//  Copyright (c) 2026 cth9191; the full notice is LICENSE beside this file and travels with every copy.
//  Port changes (Bombadillo AI, 2026): an FLPT.style plug-in with closure state instead of globals; the frame is
//  1920x1080; the camera is read from the scene's canvas transform; type prints in a bundled OFL face and
//  registers its box with the runtime's text registry, printed from glyph outlines (env.textPath) when the font is embedded; the morph-renderer hooks are left out; tag/card take
//  explicit 16:9 positions; a speed-line helper for spinning things.
//
//  A frame is a sheet of cream paper run through three spot-ink plates (teal, fluorescent pink, yellow).
//  A plate only says how much ink goes where (a grey tone 0..1); its screen turns the tone into dots at the
//  plate's own angle; the inks multiply. No black ink: darks are all three inks overprinted.
//    K.sheet()                              paper into the sheet buffer (or K.sheet(box): print over what g shows)
//    K.layer(pitch, { T, box, full, auto, shapes })   three grey plates + a mask; T = { s, x, y, rot }
//      K.fill / K.line / K.type / K.rim / K.hero ...
//    K.print()                              screen each plate, multiply the inks, blend into the sheet by the mask
//    K.endSheet()                           put the sheet into g (a box sheet puts only its box)
//  The scene's camera (g's transform, set with ctx.apply) is composed into every layer, so the screen belongs to
//  the illustration: it pans and scales with it and never swims under it.
// =====================================================================
FLPT.style('riso', {
  tokens: { paper: '#f2ece3', ink: '#3b3a2c', font: '"Fraunces Soft", "Arial Black", sans-serif' },
  fonts: [{ family: 'Fraunces Soft', file: 'fraunces-soft-black.ttf', weight: 900 }],
  ones: false,
  make(env) {
    const { W, H, rng: RNG, clamp, lerp } = env;
    const TAU = Math.PI * 2, DEG = Math.PI / 180;
    const PRINT = env.tokens.font;
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
      RL = { T, rot: T0.rot || 0, pitch, box: b, auto: !!o.auto, shapes: !!o.shapes, clips: 0 };
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
    function clipTo(path) { for (const n of [...INK_NAMES, 'mask']) { const q = PLATE[n].g; q.save(); q.beginPath(); path(q); q.clip(); } RL.clips++; }
    function unclip() { if (!RL.clips) return; for (const n of [...INK_NAMES, 'mask']) PLATE[n].g.restore(); RL.clips--; }
    const lin = (x0, y0, x1, y1, stops) => (q) => { const gr = q.createLinearGradient(x0, y0, x1, y1); for (const [p, v] of stops) gr.addColorStop(p, gray(v)); return gr; };
    const rad = (x, y, r0, r1, stops) => (q) => { const gr = q.createRadialGradient(x, y, r0, x, y, r1); for (const [p, v] of stops) gr.addColorStop(p, gray(v)); return gr; };
    const circ = (x, y, r) => (q) => q.arc(x, y, Math.max(0, r), 0, TAU);
    const ell = (x, y, rx, ry, rot = 0) => (q) => q.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), rot, 0, TAU);
    const poly = (P) => (q) => { q.moveTo(P[0][0], P[0][1]); for (let i = 1; i < P.length; i++) q.lineTo(P[i][0], P[i][1]); q.closePath(); };
    const curvy = (P) => (q) => { const n = P.length; q.moveTo((P[n - 1][0] + P[0][0]) / 2, (P[n - 1][1] + P[0][1]) / 2); for (let i = 0; i < n; i++) { const p = P[i], r = P[(i + 1) % n]; q.quadraticCurveTo(p[0], p[1], (p[0] + r[0]) / 2, (p[1] + r[1]) / 2); } q.closePath(); };
    const rect = (x, y, w, h) => (q) => q.rect(x, y, w, h);
    const hand = (P, key, amt = 1.4, step = 6) => curvy(wobble(P, true, amt, key, step));
    const boxPts = (x, y, w, h) => resample([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true, 24);

    // ---- WEAR AND THE PRINT PASS
    const DROP = [];
    function dropouts(V) {
      if (DROP[V]) return DROP[V];
      const a = new Uint8Array(W * H), R = RNG('drop', V), n = Math.round(W * H * 0.006);
      for (let i = 0; i < n; i++) { const x = R.i(0, W - 3), y = R.i(0, H - 3), bit = 1 << R.i(0, 2), s = R.f() < 0.25 ? 2 : 1; for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) a[(y + dy) * W + x + dx] |= bit; }
      return (DROP[V] = a);
    }
    function print() {
      while (RL.clips) unclip();
      const { T, pitch, box: [x0, y0, x1, y1], auto } = RL, w = x1 - x0, h = y1 - y0;
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
      for (let y = 0; y < h; y++) {
        const Y = y0 + y, dy = Y - T.y, dx0 = x0 - T.x, row = Y * W;
        let u0 = dx0 * c0 + dy * s0, v0 = dy * c0 - dx0 * s0, u1 = dx0 * c1 + dy * s1, v1 = dy * c1 - dx0 * s1, u2 = dx0 * c2 + dy * s2, v2 = dy * c2 - dx0 * s2;
        for (let x = 0, i4 = y * w * 4; x < w; x++, i4 += 4, u0 += c0, v0 -= s0, u1 += c1, v1 -= s1, u2 += c2, v2 -= s2) {
          const t0 = pl0[i4], t1 = pl1[i4], t2 = pl2[i4], mk = m ? m[i4] : (t0 | t1 | t2) > 6 ? 255 : 0;
          if (mk === 0) continue;
          const X = x0 + x, o = (row + X) * 4, dr = drop[row + X];
          let r = pp[o], gg = pp[o + 1], b = pp[o + 2];
          if (t0 >= 7 && !(dr & 1)) { const k = cov(LV[t0], u0, v0); r *= 1 - k * a00; gg *= 1 - k * a01; b *= 1 - k * a02; }
          if (t1 >= 7 && !(dr & 2)) { const k = cov(LV[t1], u1, v1); r *= 1 - k * a10; gg *= 1 - k * a11; b *= 1 - k * a12; }
          if (t2 >= 7 && !(dr & 4)) { const k = cov(LV[t2], u2, v2); r *= 1 - k * a20; gg *= 1 - k * a21; b *= 1 - k * a22; }
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

    // ---- TYPE: solid ink (no screen at tone 1), misregistered with the rest; registers its on-screen box
    function typeW(str, size, weight = 900) { const m = env.measure(str, `${weight} ${size}px ${PRINT}`); return m.w; }
    function type(str, x, y, size, tones, o = {}) {
      const frac = clamp(o.frac ?? 1); if (frac <= 0) return;
      const R = RNG('type', o.key ?? str, B % 3), weight = o.weight ?? 900, font = `${weight} ${size}px ${PRINT}`;
      const mt = env.measure(str, font), w = mt.w, x0 = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x;
      const knock = o.knock !== false, jx = R.n(0.7), jy = R.n(0.7), rot = R.n(0.004);
      const tp = env.textPath(str, font);   // glyph outlines when the face is embedded, else canvas text
      const glyphs = (qq) => { if (tp) qq.fill(tp.path); else qq.fillText(str, 0, 0); };
      const each = (q, paint) => { q.save(); q.translate(x0 + jx, y + jy); q.rotate(rot); if (frac < 1) { q.beginPath(); q.rect(-4, -size * 1.2, w * frac + 4, size * 1.7); q.clip(); } q.font = font; q.textBaseline = 'alphabetic'; q.textAlign = 'left'; paint(q); q.restore(); };
      for (const n of INK_NAMES) {
        if (!knock && tones[n] == null) continue;
        const q = PLATE[n].g; q.globalCompositeOperation = knock ? 'source-over' : 'lighten';
        each(q, (qq) => { qq.fillStyle = gray(tones[n] ?? 0); glyphs(qq); });
        q.globalCompositeOperation = 'source-over';
      }
      if (RL.shapes || o.mask) each(PLATE.mask.g, (qq) => { qq.fillStyle = '#fff'; glyphs(qq); });
      if (o.id !== false) {   // the box on screen: the layer transform (camera + T) applied to the type's corners
        const T = RL.T, cr = Math.cos(RL.rot), sr = Math.sin(RL.rot), dv = (px, py) => [T.x + T.s * (px * cr - py * sr), T.y + T.s * (px * sr + py * cr)];
        const C = [dv(x0, y - mt.asc), dv(x0 + w * frac, y - mt.asc), dv(x0 + w * frac, y + mt.desc), dv(x0, y + mt.desc)], bb = bbox(C);
        env.registerBox(o.id ?? str, str, { x: bb.x0, y: bb.y0, w: bb.x1 - bb.x0, h: bb.y1 - bb.y0 });
      }
    }

    // ---- THE HERO: a printed ink-blue bean, paper eyes, pink cheeks, a green sprout. Inside the current layer.
    const HERO_TONES = MIX.blue;
    function hero(x, y, r, o = {}) {
      const key = o.key ?? 'hero', hop = o.hop ?? 0, tones = o.tones || HERO_TONES;
      if (o.shadow !== false) fill(ell(x, y + r * 1.32, r * 0.8 * (1 - hop / (r * 6)), r * 0.16), { teal: 0.35, pink: 0.3 });
      y += -hop + Math.sin(TT * TAU * 0.9 + key.length) * r * 0.035;
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
      const lk = o.look ?? [0, 0], ey = y - r * 0.25, blink = (B + key.length * 7) % 41 < 2;
      for (const s of [-1, 1]) {
        const ex = x + s * r * 0.3;
        if (blink) { line([[ex - r * 0.14, ey], [ex + r * 0.14, ey]], MIX.dark, { w: r * 0.05, amt: 0.3, key: key + 'bl' + s, knock: true }); continue; }
        fill(ell(ex, ey, r * 0.17, r * (o.mood === 'wow' ? 0.25 : 0.22)), {});
        fill(circ(ex + lk[0] * r * 0.06, ey + lk[1] * r * 0.08, r * 0.085), MIX.dark);
        fill(circ(ex + lk[0] * r * 0.06 - r * 0.03, ey + lk[1] * r * 0.08 - r * 0.035, r * 0.025), {});
        fill(circ(x + s * r * 0.5, y + r * 0.02, r * 0.09), { pink: 1 });
      }
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
      const w = typeW(str, size) + size * 0.9, h = size * 1.5, rot = o.rot ?? -0.04, reach = (w / 2 + 40) * s;
      g.setTransform(1, 0, 0, 1, 0, 0); sheet([x - reach, y - reach, x + reach, y + reach]);
      printed(PITCH.fine, { T: { s, x, y, rot }, shapes: true }, () => {
        fill(hand(boxPts(-w / 2 + 12, -h / 2 + 14, w, h), 'tagsh' + str, 1.2), o.shadow ?? { pink: 0.75 });
        fill(hand(boxPts(-w / 2, -h / 2, w, h), 'tag' + str, 1.2), o.tones ?? { yellow: 1 });
        type(str, -w / 2 + size * 0.45, size * 0.36, size, o.ink ?? MIX.blue, { key: 'tagt' + str, frac: o.frac, id: o.id ?? 'tag:' + str });
      });
      endSheet();
    }
    function card(str, x, y, size, o = {}) {
      const s = o.s ?? 1; if (s <= 0.01) return;
      const w = typeW(str, size) + size * 1.0, h = size * 1.6, rot = o.rot ?? 0.012, reach = (w / 2 + 40) * s;
      g.setTransform(1, 0, 0, 1, 0, 0); sheet([x - reach, y - reach, x + reach, y + reach]);
      printed(PITCH.fine, { T: { s, x, y, rot }, shapes: true }, () => {
        const P = boxPts(-w / 2, -h / 2, w, h);
        fill(hand(P, 'card' + str, 1.2), {});
        rimLine(P, 'cardr' + str, { w: 6, amt: 1.2, rough: 0.45 });
        type(str, -w / 2 + size * 0.5, size * 0.36, size, o.tones ?? MIX.blue, { key: 'cardt' + str, frac: o.frac, id: o.id ?? 'card:' + str });
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

    const popS = (t) => (TT < t ? 0 : 1 + 2.70158 * ((clamp((TT - t) / 0.25) - 1) ** 3) + 1.70158 * ((clamp((TT - t) / 0.25) - 1) ** 2));
    return {
      bind(c) { g = c.g; B = c.B; TT = c.TT; },
      sheet, endSheet, layer, print, printed, fill, line, type, typeW, rim, rimLine, specks, clipTo, unclip,
      circ, ell, poly, curvy, rect, hand, boxPts, ringPts, lin, rad, MIX, PITCH, INKS, inkRGB, rgbHex,
      hero, heroOutline, tag, card, speedLines, popS,
      wobble, resample, arcPts, ellipsePts, subPath, pathLen, bbox, dist,
    };
  },
});
