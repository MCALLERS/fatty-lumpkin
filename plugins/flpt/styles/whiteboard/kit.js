// =====================================================================
//  engine/styles/whiteboard/kit.js: Whiteboard, FLPT's "avocado toast" sketch grammar as a Live Motion style (an FLPT
//  original). A warm whiteboard; hand-drawn doodles of concrete things draw themselves stroke by stroke as they're
//  named, a marker riding the tip in the stroke's colour; short labels written on in Caveat; big words drawn in
//  stroke capitals; everything accumulates, and the punchline gets a loop drawn round it. On ones (a live pen).
//
//  The pen is a pure function of t. Every drawing registers a pen job (its start, end and strokes) on every frame,
//  drawn or not yet; K.pen() reads the frame's whole schedule and puts the marker where t says: on the tip of the
//  stroke being drawn, hopping between strokes, gliding between drawings less than 0.6 s apart, lifting away after.
//  (The HyperFrames starter moved its pen from GSAP callbacks, so its pose depended on seek history: spike K3.)
//
//  World units: the neutral camera shows world (0,0)-(1920,1080); the board goes on forever. A frame:
//    K.view(K.track(stops))    the camera (a push, a pan, a pull-back reveal)
//    K.board()                 the board's surface in the world (tooth, mottle, faint ghosts of old drawings)
//    K.doodle / K.write / K.letters / K.arrow / K.loop …   each with { at } (seconds) and an ink
//    K.pen(); K.light()        the marker on top, then the room's light (screen space); always last
// =====================================================================
FLPT.style('whiteboard', {
  tokens: { paper: '#fbfaf6', ink: '#17202b', font: '"Caveat", "Comic Sans MS", cursive' },
  fonts: [
    { family: 'Caveat', file: 'caveat-regular.ttf', weight: 400 },
    { family: 'Caveat', file: 'caveat-bold.ttf', weight: 700 },
  ],
  ones: true,
  make(env) {
    const { W, H, rng: RNG, clamp, lerp, EZ } = env;
    const TAU = Math.PI * 2;
    const HAND = env.tokens.font, BOARD = env.tokens.paper;
    let g = null, TT = 0, SC = 1, JOBS = [], SEQ = 0;   // bound per frame

    // ---- inks: marker colours on the board, and the flat tints that colour a shape in
    const INK = { ink: '#17202b', ox: '#9b2f4c', blue: '#1f5a85', amber: '#a2600f', green: '#2e6e4a', muted: '#5b6573' };
    const TINT = { ink: '#e7e4dc', ox: '#f3d9e0', blue: '#d8e6f2', amber: '#f6e2c0', green: '#d9eadc', white: '#ffffff' };
    const WEIGHT = { m: 9, f: 6.5, b: 12, dot: 14 };    // marker, fine, bold, a dot (a round cap): screen px at z 1
    const SPEED = 1150, HOP = 0.07, GLIDE = 0.6;        // ink px a second; a pen lift; drawings closer than this glide
    const inkOf = (c, d = INK.ink) => (c == null ? d : INK[c] || c);
    const tintOf = (c) => TINT[c] || c;

    // ---- geometry: polylines [[x, y], …]
    const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
    function lenOf(P) { let L = 0; for (let i = 1; i < P.length; i++) L += dist(P[i - 1], P[i]); return L; }
    function cumOf(P) { const c = new Float64Array(P.length); for (let i = 1; i < P.length; i++) c[i] = c[i - 1] + dist(P[i - 1], P[i]); return c; }
    /** The point at arc length s along P (cum = cumOf(P)). */
    function along(P, cum, s) {
      const n = P.length;
      if (n === 1 || s <= 0) return P[0];
      if (s >= cum[n - 1]) return P[n - 1];
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
      const d = cum[hi] - cum[lo], k = d > 0 ? (s - cum[lo]) / d : 0;
      return [lerp(P[lo][0], P[hi][0], k), lerp(P[lo][1], P[hi][1], k)];
    }
    /** P resampled every `step` units along its length (the ends kept). */
    function resample(P, step) {
      const cum = cumOf(P), L = cum[P.length - 1];
      if (!(L > 0)) return P.slice();
      const n = Math.max(2, Math.ceil(L / step)), out = [];
      for (let i = 0; i <= n; i++) out.push(along(P, cum, (L * i) / n));
      return out;
    }
    const xform = (P, tx, ty, rot = 0, sx = 1, sy = sx) => { const c = Math.cos(rot), s = Math.sin(rot); return P.map(([x, y]) => [tx + x * sx * c - y * sy * s, ty + x * sx * s + y * sy * c]); };
    function bbox(P) { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of P) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; } return { x0, y0, x1, y1 }; }
    /** An ellipse (or an arc of one) as a polyline; turns > 1 overlaps like a real pen loop. */
    function ellipse(cx, cy, rx, ry, o = {}) {
      const a0 = o.a0 ?? -Math.PI / 2, turns = o.turns ?? 1, n = Math.max(12, Math.ceil(48 * turns * Math.max(1, (rx + ry) / 120))), grow = o.grow ?? 0, P = [];
      for (let i = 0; i <= n; i++) { const u = i / n, a = a0 + TAU * turns * u, k = 1 + grow * u; P.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]); }
      return P;
    }

    // ---- SVG path data → polylines, one per subpath (M L H V C S Q T Z, absolute and relative)
    const TOK = /[MmLlHhVvCcSsQqTtZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;
    function parsePath(d) {
      const tk = String(d).match(TOK) || [], subs = [];
      let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, px = 0, py = 0, last = '', cur = null;
      const isCmd = (s) => /^[A-Za-z]$/.test(s);
      const num = () => Number(tk[i++]);
      const more = () => i < tk.length && !isCmd(tk[i]);
      const put = (a, b) => { cur.push([a, b]); x = a; y = b; };
      const curve = (x1, y1, x2, y2, x3, y3) => {
        const x0 = x, y0 = y, n = Math.max(4, Math.min(64, Math.ceil((dist([x0, y0], [x1, y1]) + dist([x1, y1], [x2, y2]) + dist([x2, y2], [x3, y3])) / 3)));
        for (let k = 1; k <= n; k++) { const u = k / n, v = 1 - u; put(v * v * v * x0 + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * x3, v * v * v * y0 + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u * y3); }
      };
      const quad = (x1, y1, x2, y2) => {
        const x0 = x, y0 = y, n = Math.max(4, Math.min(48, Math.ceil((dist([x0, y0], [x1, y1]) + dist([x1, y1], [x2, y2])) / 3)));
        for (let k = 1; k <= n; k++) { const u = k / n, v = 1 - u; put(v * v * x0 + 2 * v * u * x1 + u * u * x2, v * v * y0 + 2 * v * u * y1 + u * u * y2); }
      };
      while (i < tk.length) {
        if (isCmd(tk[i])) cmd = tk[i++];
        else if (!cmd) { i++; continue; }
        const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase(), ox = rel ? x : 0, oy = rel ? y : 0;
        if (C === 'Z') { if (cur && cur.length) put(sx, sy); cmd = ''; last = 'Z'; continue; }
        if (!more()) { cmd = ''; continue; }
        if (C === 'M') { const a = num() + ox, b = num() + oy; cur = [[a, b]]; subs.push(cur); x = sx = a; y = sy = b; cmd = rel ? 'l' : 'L'; last = 'M'; continue; }
        if (!cur) { cur = [[x, y]]; subs.push(cur); }
        if (C === 'L') put(num() + ox, num() + oy);
        else if (C === 'H') put(num() + ox, y);
        else if (C === 'V') put(x, num() + oy);
        else if (C === 'C') { const x1 = num() + ox, y1 = num() + oy, x2 = num() + ox, y2 = num() + oy, x3 = num() + ox, y3 = num() + oy; curve(x1, y1, x2, y2, x3, y3); px = x2; py = y2; }
        else if (C === 'S') { const r1 = last === 'C' || last === 'S' ? [2 * x - px, 2 * y - py] : [x, y], x2 = num() + ox, y2 = num() + oy, x3 = num() + ox, y3 = num() + oy; curve(r1[0], r1[1], x2, y2, x3, y3); px = x2; py = y2; }
        else if (C === 'Q') { const x1 = num() + ox, y1 = num() + oy, x2 = num() + ox, y2 = num() + oy; quad(x1, y1, x2, y2); px = x1; py = y1; }
        else if (C === 'T') { const r1 = last === 'Q' || last === 'T' ? [2 * x - px, 2 * y - py] : [x, y], x2 = num() + ox, y2 = num() + oy; quad(r1[0], r1[1], x2, y2); px = r1[0]; py = r1[1]; }
        else { i++; continue; }
        last = C;
      }
      return subs.filter((s) => s.length);
    }

    // ---- the hand (hand.js's grammar): a smooth seeded noise field bends every line a little, so long lines bow,
    //      circles go slightly egg-shaped and closed shapes don't quite close. The field is shared by every stroke of a
    //      doodle (joints stay joined); a gentler tremor along each stroke is its own. Same seed, same wobble, always.
    function field(seed, wave) {
      const R = RNG('wb-field', seed);
      const waves = () => [1, 0.55, 0.3].map((a, i) => { const th = R.r(0, TAU), k = (TAU / wave) * (1 + i * 0.9 + R.r(0, 0.4)); return { kx: Math.cos(th) * k, ky: Math.sin(th) * k, ph: R.r(0, TAU), a }; });
      const wx = waves(), wy = waves(), norm = 1 / 1.85;
      const sum = (ws, x, y) => { let s = 0; for (const q of ws) s += q.a * Math.sin(q.kx * x + q.ky * y + q.ph); return s * norm; };
      return (x, y) => [sum(wx, x, y), sum(wy, x, y)];
    }
    function wobble(P, amp, wave, fieldSeed, pathSeed) {
      if (!(amp > 0) || P.length < 2) return P;
      const cum = cumOf(P), L = cum[P.length - 1];
      if (!(L > 1)) return P;
      const f = field(fieldSeed, wave), R = RNG('wb-path', pathSeed), tPh = R.r(0, TAU), tWave = wave * (0.45 + R.r(0, 0.2));
      const n = Math.max(2, Math.ceil(L / 4)), out = [];
      for (let i = 0; i <= n; i++) {
        const s = (L * i) / n, p = along(P, cum, s), v = f(p[0], p[1]), tr = Math.sin((s / tWave) * TAU + tPh) * 0.35;
        out.push([p[0] + amp * (v[0] + tr), p[1] + amp * (v[1] - tr)]);
      }
      return out;
    }
    /** An arrowhead from the end tangent, on the same stroke (tip, barb, tip, barb). */
    function withHead(P, size, spread = 30) {
      const cum = cumOf(P), L = cum[P.length - 1];
      if (!(L > 2)) return P;
      const end = P[P.length - 1], back = along(P, cum, Math.max(0, L - Math.min(18, L / 3))), a = Math.atan2(end[1] - back[1], end[0] - back[0]), sp = (spread * Math.PI) / 180;
      const barb = (s) => [end[0] + Math.cos(a + Math.PI + s * sp) * size, end[1] + Math.sin(a + Math.PI + s * sp) * size];
      return [...P, barb(1), end, barb(-1)];
    }

    // ---- the stroke capitals: one stroke per pen movement, cap height 100, y down, the baseline at 100
    const CAPS = {
      A: [64, 'M 0 100 L 32 0 L 64 100', 'M 13 62 L 51 62'],
      B: [58, 'M 4 0 L 4 100', 'M 4 2 C 60 -4 62 46 6 48 C 72 46 70 106 4 100'],
      C: [60, 'M 60 18 C 50 0 30 -2 18 4 C -6 18 -4 82 18 96 C 32 104 52 100 60 82'],
      D: [62, 'M 4 0 L 4 100', 'M 4 2 C 80 -2 82 102 4 100'],
      E: [54, 'M 52 0 L 4 0 L 4 100 L 54 100', 'M 4 50 L 42 50'],
      F: [50, 'M 52 0 L 4 0 L 4 100', 'M 4 48 L 40 48'],
      G: [64, 'M 60 16 C 50 0 26 -4 12 10 C -6 30 -2 84 22 97 C 40 106 62 94 62 64 L 36 64'],
      H: [62, 'M 4 0 L 4 100', 'M 58 0 L 58 100', 'M 4 50 L 58 50'],
      I: [20, 'M 10 0 L 10 100'],
      J: [50, 'M 46 0 L 46 70 C 46 104 4 106 0 78'],
      K: [58, 'M 4 0 L 4 100', 'M 54 0 L 6 60', 'M 22 40 L 58 100'],
      L: [50, 'M 4 0 L 4 100 L 50 100'],
      M: [78, 'M 4 100 L 8 0 L 39 66 L 70 0 L 74 100'],
      N: [62, 'M 4 100 L 4 0 L 56 100 L 56 0'],
      O: [70, 'M 36 0 C 4 0 -2 46 2 64 C 8 92 28 100 38 100 C 60 100 70 72 68 46 C 66 18 52 0 30 2'],
      P: [56, 'M 4 100 L 4 0', 'M 4 2 C 64 -4 66 54 6 52'],
      Q: [72, 'M 36 0 C 4 0 -2 46 2 64 C 8 92 28 100 38 100 C 60 100 70 72 68 46 C 66 18 52 0 30 2', 'M 42 72 L 70 106'],
      R: [58, 'M 4 100 L 4 0', 'M 4 2 C 64 -4 64 52 6 50 L 58 100'],
      S: [56, 'M 52 14 C 42 -4 6 -4 4 22 C 2 50 54 44 54 74 C 54 104 12 106 2 84'],
      T: [60, 'M 0 0 L 60 0', 'M 30 0 L 30 100'],
      U: [62, 'M 4 0 L 4 66 C 4 106 58 106 58 66 L 58 0'],
      V: [62, 'M 0 0 L 31 100 L 62 0'],
      W: [86, 'M 0 0 L 20 100 L 43 30 L 66 100 L 86 0'],
      X: [60, 'M 2 0 L 58 100', 'M 58 0 L 2 100'],
      Y: [60, 'M 0 0 L 30 52 L 60 0', 'M 30 52 L 30 100'],
      Z: [58, 'M 2 0 L 56 0 L 2 100 L 58 100'],
      0: [56, 'M 28 0 C 2 0 0 38 0 50 C 0 70 6 100 28 100 C 52 100 56 66 56 50 C 56 30 50 0 24 2'],
      1: [36, 'M 6 20 L 26 0 L 26 100'],
      2: [56, 'M 4 22 C 8 -6 54 -8 54 26 C 54 52 4 74 2 100 L 56 100'],
      3: [54, 'M 4 14 C 16 -6 54 -4 52 24 C 50 44 32 48 22 48 C 46 48 56 62 54 78 C 52 104 12 106 2 86'],
      4: [58, 'M 42 100 L 42 0 L 2 70 L 58 70'],
      5: [54, 'M 50 0 L 10 0 L 6 44 C 28 30 56 40 54 70 C 52 104 12 106 2 86'],
      6: [54, 'M 46 6 C 14 -8 0 28 2 62 C 4 100 52 104 52 68 C 52 36 12 34 4 62'],
      7: [54, 'M 2 0 L 54 0 L 18 100'],
      8: [54, 'M 27 48 C 2 42 4 2 27 0 C 50 2 52 42 27 48 C -2 54 0 98 27 100 C 54 98 56 54 27 48'],
      9: [54, 'M 50 34 C 46 2 4 0 4 32 C 4 62 48 64 50 34 L 48 100'],
      '!': [20, 'M 10 0 L 10 68', 'M 10 96 L 10 96.5'],
      '?': [52, 'M 4 22 C 4 -6 50 -8 50 22 C 50 44 26 46 26 70', 'M 26 96 L 26 96.5'],
      '.': [18, 'M 8 96 L 8 96.5'],
      ',': [18, 'M 10 92 L 4 112'],
      "'": [16, 'M 8 0 L 6 24'],
      '’': [16, 'M 8 0 L 6 24'],
      '-': [44, 'M 4 52 L 40 52'],
      '+': [56, 'M 4 52 L 52 52', 'M 28 28 L 28 76'],
      '=': [52, 'M 4 40 L 48 40', 'M 4 66 L 48 66'],
      '/': [50, 'M 48 0 L 2 100'],
      ':': [18, 'M 8 40 L 8 40.5', 'M 8 92 L 8 92.5'],
      $: [52, 'M 48 18 C 40 2 6 4 6 26 C 6 50 48 44 48 72 C 48 96 10 98 2 80', 'M 26 -10 L 26 110'],
      '%': [70, 'M 66 0 L 4 100', 'M 14 4 C 2 4 2 30 14 30 C 26 30 26 4 12 6', 'M 56 70 C 44 70 44 96 56 96 C 68 96 68 70 54 72'],
      ' ': [34],
    };
    const capsOf = (str) => [...String(str).toUpperCase()].filter((ch) => CAPS[ch]);
    const CAPS_SET = Object.keys(CAPS).join('');   // what letters() can draw (it upper-cases, and skips the rest)

    // ---- the doodles: concrete things, each in its own box around (0, 0). A stroke is 'path data' or
    //      [weight, 'path data', ink?] (weight m marker, f fine, b bold, dot). `fill` is the closed shape a tint
    //      or a hatch colours in; `parts` are extra strokes drawn on their own (o.part) or with the doodle (o.parts).
    const circle = (cx, cy, r, o) => { const P = ellipse(cx, cy, r, r, { turns: 1.06, a0: -1.45, ...o }); return 'M ' + P.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L '); };
    const ring = (cx, cy, r) => { const P = ellipse(cx, cy, r, r, { turns: 1 }); return 'M ' + P.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L ') + ' Z'; };
    function gearPath(r0, r1, teeth) {
      const P = [];
      for (let i = 0; i < teeth; i++) {
        const a = (i / teeth) * TAU, w = TAU / teeth;
        for (const [da, r] of [[0.0, r0], [0.18, r0], [0.28, r1], [0.62, r1], [0.72, r0]]) P.push([Math.cos(a + da * w) * r, Math.sin(a + da * w) * r]);
      }
      P.push(P[0]);
      return 'M ' + P.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L ');
    }
    const DOODLES = {
      bulb: {
        d: ['M -24 46 C -28 22 -60 4 -60 -34 C -60 -76 -28 -100 0 -100 C 30 -100 60 -76 60 -34 C 60 4 28 22 24 46', 'M -27 48 L 27 48', ['f', 'M -24 63 L 24 63'], ['f', 'M -15 77 C -8 85 8 85 15 77'],
          ['f', 'M -12 46 L -10 4 C -22 -14 -4 -26 0 -8 C 4 -26 22 -14 10 4 L 12 46']],
        fill: 'M -24 46 C -28 22 -60 4 -60 -34 C -60 -76 -28 -100 0 -100 C 30 -100 60 -76 60 -34 C 60 4 28 22 24 46 Z',
        parts: { rays: [['f', 'M 0 -122 L 0 -148'], ['f', 'M 68 -92 L 86 -110'], ['f', 'M -68 -92 L -86 -110'], ['f', 'M 84 -32 L 110 -32'], ['f', 'M -84 -32 L -110 -32']] },
      },
      clock: {
        d: [circle(0, 0, 66), 'M -72 -42 C -90 -64 -68 -92 -42 -78 L -72 -42', 'M 72 -42 C 90 -64 68 -92 42 -78 L 72 -42', ['f', 'M -40 56 L -52 82'], ['f', 'M 40 56 L 52 82'],
          ['f', 'M 0 -52 L 0 -44'], ['f', 'M 52 0 L 44 0'], ['f', 'M 0 52 L 0 44'], ['f', 'M -52 0 L -44 0'], 'M 0 2 L 0 -38', 'M 0 2 L 26 16', ['dot', 'M 0 2 L 0 2.5']],
        fill: ring(0, 0, 64),
        parts: { ring: [['f', 'M -100 -92 C -112 -78 -114 -62 -106 -48'], ['f', 'M -120 -106 C -136 -86 -138 -58 -126 -40'], ['f', 'M 100 -92 C 112 -78 114 -62 106 -48'], ['f', 'M 120 -106 C 136 -86 138 -58 126 -40']] },
      },
      cup: {
        d: ['M -52 -40 C -52 -54 52 -54 52 -40 C 52 -27 -52 -27 -50 -42', 'M -52 -40 L -46 50 C -44 64 44 64 46 50 L 52 -40', 'M 50 -22 C 88 -26 90 30 46 28'],
        fill: 'M -52 -40 L -46 50 C -44 64 44 64 46 50 L 52 -40 C 52 -27 -52 -27 -52 -40 Z',
        parts: { steam: [['f', 'M -18 -64 C -32 -82 -6 -94 -20 -116'], ['f', 'M 14 -64 C 0 -82 26 -94 12 -116']] },
      },
      shoe: {
        d: ['M -104 18 C -108 40 -98 48 -82 48 L 94 48 C 112 48 118 34 110 20', 'M -104 20 L 112 20',
          'M -102 18 C -106 -10 -98 -38 -86 -54 C -74 -48 -58 -46 -46 -50 C -36 -22 -8 -12 28 -4 C 66 4 100 8 112 20',
          ['f', 'M -86 -54 C -78 -64 -56 -64 -46 -50'], ['f', 'M -34 -34 L -20 -40'], ['f', 'M -22 -24 L -8 -30'], ['f', 'M -10 -16 L 4 -22'], ['f', 'M -66 18 C -62 -6 -48 -16 -30 -18'], ['f', 'M 64 34 L 84 34']],
        fill: 'M -102 18 C -106 -10 -98 -38 -86 -54 C -74 -48 -58 -46 -46 -50 C -36 -22 -8 -12 28 -4 C 66 4 100 8 112 20 L 112 46 L -104 46 Z',
        parts: { speed: [['f', 'M -168 -24 L -128 -24'], ['f', 'M -182 4 L -132 4'], ['f', 'M -164 32 L -128 32']] },
      },
      // a stick figure, feet at (0, 0): a body (head and spine), then legs, arms and a face from its parts
      person: {
        d: [circle(0, -170, 30), 'M 0 -140 C 1 -112 -1 -84 0 -64'],
        with: ['legs', 'arms', 'smile'],
        parts: {
          legs: ['M -26 0 C -18 -22 -8 -44 0 -64 C 8 -44 16 -22 27 -2'],
          run: ['M -52 -20 C -42 -24 -30 -28 -22 -32 C -14 -44 -6 -54 0 -64 C 8 -54 16 -44 24 -34 C 22 -22 18 -10 14 0', ['f', 'M 14 0 L 32 0']],
          arms: ['M -38 -82 C -26 -100 -12 -112 0 -116 C 12 -112 26 -100 38 -82'],
          swing: ['M -42 -78 C -34 -86 -28 -92 -22 -96 C -14 -104 -6 -112 0 -116 C 8 -110 16 -104 24 -100 C 32 -104 40 -110 46 -120'],
          cheer: ['M -48 -176 C -32 -150 -14 -128 0 -118 C 14 -128 32 -150 48 -176'],
          point: ['M -36 -80 C -24 -98 -12 -112 0 -116 C 24 -118 48 -124 74 -132'],
          hold: ['M -36 -72 C -26 -90 -12 -108 0 -116 C 12 -110 22 -102 30 -96 C 38 -100 44 -106 50 -114'],
          smile: [['m', 'M -10 -176 L -10 -175.5'], ['m', 'M 10 -176 L 10 -175.5'], ['f', 'M -11 -161 Q 0 -152 11 -161']],
          grin: [['f', 'M -17 -174 Q -11 -183 -5 -174'], ['f', 'M 5 -174 Q 11 -183 17 -174'], ['f', 'M -14 -162 Q 0 -143 14 -162 L -14 -162']],
          sleep: [['f', 'M -17 -177 Q -11 -170 -5 -177'], ['f', 'M 5 -177 Q 11 -170 17 -177'], ['f', circle(0, -157, 4.5)]],
          focus: [['m', 'M -10 -176 L -10 -175.5'], ['m', 'M 10 -176 L 10 -175.5'], ['f', 'M -9 -158 L 9 -159']],
        },
      },
      // a bed, side on, someone asleep in it (the head on the pillow), and the z's rising
      bed: {
        d: ['M -136 62 L -136 -44 C -136 -64 -104 -64 -104 -44 L -104 24', 'M -136 24 L 136 24 L 136 62', 'M 136 24 L 136 -12',
          ['f', 'M -100 -2 C -102 -24 -44 -26 -42 -6 C -40 6 -96 10 -100 -2'], circle(-72, -32, 25),
          'M -44 -12 C -14 -46 80 -44 132 -16', ['f', 'M -44 -12 C -42 0 -40 12 -38 22'],
          ['f', 'M -86 -36 Q -80 -30 -74 -36'], ['f', 'M -68 -36 Q -62 -30 -56 -36'], ['f', 'M -76 -20 Q -70 -16 -64 -20']],
        fill: 'M -44 -12 C -14 -46 80 -44 132 -16 L 132 22 L -40 22 Z',
        with: ['zzz'],
        parts: { zzz: [['f', 'M -42 -78 L -26 -78 L -42 -62 L -26 -62'], ['f', 'M -14 -106 L 6 -106 L -14 -86 L 6 -86'], ['f', 'M 18 -140 L 44 -140 L 18 -114 L 44 -114']] },
      },
      house: {
        d: ['M -78 -14 L -78 62 L 78 62 L 78 -14', 'M -98 -6 L 0 -92 L 98 -6', 'M -16 62 L -16 14 L 16 14 L 16 62', ['f', 'M 34 4 L 60 4 L 60 30 L 34 30 L 34 2'], ['f', 'M 47 4 L 47 30'], 'M 46 -52 L 46 -80 L 66 -80 L 66 -36'],
        fill: 'M -78 -14 L 0 -84 L 78 -14 L 78 62 L -78 62 Z',
      },
      tree: {
        d: ['M -12 90 C -8 60 -10 30 -12 10', 'M 12 90 C 8 60 10 30 14 10', 'M -14 12 C -60 20 -84 -18 -60 -44 C -76 -84 -30 -110 -4 -88 C 20 -116 74 -96 66 -54 C 96 -30 70 16 30 8 C 20 18 0 18 -14 12',
          ['f', 'M 0 2 L 0 -32'], ['f', 'M 0 -16 L 18 -34'], ['f', 'M -64 92 C -20 87 30 89 66 94']],
        fill: 'M -14 12 C -60 20 -84 -18 -60 -44 C -76 -84 -30 -110 -4 -88 C 20 -116 74 -96 66 -54 C 96 -30 70 16 30 8 C 20 18 0 18 -14 12 Z',
      },
      sprout: {
        d: ['M -62 42 C -20 36 20 38 62 44', 'M 0 40 C 2 20 -2 0 0 -24', 'M 0 -10 C -10 -36 -42 -42 -54 -30 C -40 -8 -14 -6 0 -10', 'M 0 -22 C 14 -50 46 -54 58 -40 C 42 -18 16 -16 0 -22'],
        fill: 'M 0 -10 C -10 -36 -42 -42 -54 -30 C -40 -8 -14 -6 0 -10 Z M 0 -22 C 14 -50 46 -54 58 -40 C 42 -18 16 -16 0 -22 Z',
      },
      sun: {
        d: [circle(0, 0, 48)], fill: ring(0, 0, 46), with: ['rays'],
        parts: { rays: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => { const a = (i / 8) * TAU - Math.PI / 2; return ['f', `M ${(Math.cos(a) * 66).toFixed(1)} ${(Math.sin(a) * 66).toFixed(1)} L ${(Math.cos(a) * 92).toFixed(1)} ${(Math.sin(a) * 92).toFixed(1)}`]; }) },
      },
      cloud: {
        d: ['M -70 30 C -100 30 -104 -8 -76 -14 C -78 -48 -36 -60 -18 -36 C -8 -66 44 -66 50 -30 C 84 -36 100 4 74 22 C 74 36 58 38 48 32 C 20 38 -40 36 -74 30'],
        fill: 'M -70 30 C -100 30 -104 -8 -76 -14 C -78 -48 -36 -60 -18 -36 C -8 -66 44 -66 50 -30 C 84 -36 100 4 74 22 C 74 36 58 38 48 32 C 20 38 -40 36 -70 30 Z',
        parts: { rain: [['f', 'M -50 54 L -58 74'], ['f', 'M -14 54 L -22 74'], ['f', 'M 22 54 L 14 74'], ['f', 'M 56 54 L 48 74'], ['f', 'M -32 88 L -40 108'], ['f', 'M 4 88 L -4 108'], ['f', 'M 40 88 L 32 108']] },
      },
      gear: { d: [gearPath(52, 68, 9), circle(0, 0, 20)], fill: gearPath(52, 68, 9) + ' Z' },
      plane: {
        d: ['M -96 -4 L 98 -56 L -22 52 L -38 14 L -96 -4', 'M -38 14 L 98 -56', ['f', 'M -22 52 L -8 26']],
        fill: 'M -96 -4 L 98 -56 L -22 52 L -38 14 Z',
      },
      rocket: {
        d: ['M 0 -112 C 36 -82 42 -22 34 40 L -34 40 C -42 -22 -36 -82 2 -110', circle(0, -42, 16), 'M -34 6 L -62 54 L -32 40', 'M 34 6 L 62 54 L 32 40'],
        fill: 'M 0 -112 C 36 -82 42 -22 34 40 L -34 40 C -42 -22 -36 -82 0 -112 Z',
        parts: { flame: [['m', 'M -18 46 C -16 70 -6 84 0 106 C 6 84 16 70 18 46', 'amber']] },
      },
      heart: { d: ['M 0 50 C -40 20 -80 -10 -70 -42 C -60 -74 -14 -74 0 -40 C 14 -74 60 -74 70 -42 C 80 -10 40 20 2 52'], fill: 'M 0 50 C -40 20 -80 -10 -70 -42 C -60 -74 -14 -74 0 -40 C 14 -74 60 -74 70 -42 C 80 -10 40 20 0 50 Z' },
      star: { d: ['M 0 -70 L 18 -22 L 68 -20 L 28 10 L 42 60 L 0 30 L -42 60 L -28 10 L -68 -20 L -18 -22 L 2 -68'], fill: 'M 0 -70 L 18 -22 L 68 -20 L 28 10 L 42 60 L 0 30 L -42 60 L -28 10 L -68 -20 L -18 -22 Z' },
      coin: { d: [circle(0, 0, 54), ['f', circle(0, 0, 42)], 'M 18 -20 C 12 -32 -16 -32 -16 -16 C -16 2 18 -4 18 14 C 18 32 -14 32 -20 20', ['m', 'M 0 -40 L 0 40']], fill: ring(0, 0, 52) },
      chart: {
        d: ['M -100 -96 L -100 80 L 112 80', 'M -76 80 L -76 32 L -46 32 L -46 80', 'M -26 80 L -26 -8 L 4 -8 L 4 80', 'M 24 80 L 24 -60 L 54 -60 L 54 80'],
        parts: { trend: [['m', 'M -80 10 C -40 -10 0 -40 70 -104', 'ox']] },
      },
      calendar: {
        d: ['M -100 -78 L 100 -78 L 100 92 L -100 92 L -100 -74', 'M -100 -46 L 100 -46', ['f', 'M -60 -96 L -60 -64'], ['f', 'M 60 -96 L 60 -64'],
          ['f', 'M -100 0 L 100 0'], ['f', 'M -100 46 L 100 46'], ['f', 'M -50 -46 L -50 92'], ['f', 'M 0 -46 L 0 92'], ['f', 'M 50 -46 L 50 92']],
      },
      envelope: { d: ['M -84 -52 L 84 -52 L 84 54 L -84 54 L -84 -48', 'M -84 -52 L 0 10 L 84 -52'], fill: 'M -84 -52 L 84 -52 L 84 54 L -84 54 Z' },
      magnifier: { d: [circle(-14, -14, 52), ['b', 'M 24 24 L 84 84'], ['f', 'M -44 -26 C -40 -42 -28 -52 -12 -54']], fill: ring(-14, -14, 50) },
      flag: { d: ['M -40 92 L -40 -92', 'M -40 -88 C -10 -100 20 -70 60 -84 L 60 -26 C 20 -12 -10 -42 -40 -30'], fill: 'M -40 -88 C -10 -100 20 -70 60 -84 L 60 -26 C 20 -12 -10 -42 -40 -30 Z' },
      target: { d: [circle(0, 0, 70), circle(0, 0, 44), circle(0, 0, 18), ['dot', 'M 0 0 L 0 0.5']], fill: ring(0, 0, 68) },
      box: {
        d: ['M -72 -18 L 40 -18 L 40 72 L -72 72 L -72 -14', 'M -72 -18 L -32 -60 L 80 -60 L 40 -18', 'M 80 -60 L 80 30 L 40 72', ['f', 'M -14 -18 L 26 -60']],
        fill: 'M -72 -18 L -32 -60 L 80 -60 L 80 30 L 40 72 L -72 72 Z',
      },
      book: {
        d: ['M 0 -48 C -30 -66 -70 -66 -96 -54 L -96 56 C -70 44 -30 44 0 60 C 30 44 70 44 96 56 L 96 -54 C 70 -66 30 -66 0 -48', 'M 0 -48 L 0 58',
          ['f', 'M -78 -32 C -56 -40 -30 -38 -16 -30'], ['f', 'M -78 -10 C -56 -18 -30 -16 -16 -8'], ['f', 'M 16 -30 C 30 -38 56 -40 78 -32'], ['f', 'M 16 -8 C 30 -16 56 -18 78 -10']],
        fill: 'M 0 -48 C -30 -66 -70 -66 -96 -54 L -96 56 C -70 44 -30 44 0 60 C 30 44 70 44 96 56 L 96 -54 C 70 -66 30 -66 0 -48 Z',
      },
      laptop: { d: ['M -80 -72 L 80 -72 L 80 30 L -80 30 L -80 -68', 'M -102 30 L 102 30 L 118 58 L -118 58 L -102 30', ['f', 'M -16 44 L 16 44']], fill: 'M -80 -72 L 80 -72 L 80 30 L -80 30 Z' },
      phone: { d: ['M -30 -84 L 30 -84 C 40 -84 44 -80 44 -70 L 44 70 C 44 80 40 84 30 84 L -30 84 C -40 84 -44 80 -44 70 L -44 -70 C -44 -80 -40 -84 -26 -84', ['f', 'M -12 -70 L 12 -70'], ['dot', 'M 0 66 L 0 66.5']], fill: 'M -44 -84 L 44 -84 L 44 84 L -44 84 Z' },
      speech: { d: ['M -90 -40 C -90 -70 -60 -80 0 -80 C 60 -80 90 -70 90 -40 C 90 -10 60 0 10 0 L -20 30 L -12 0 C -60 0 -90 -10 -88 -42'], fill: 'M -90 -40 C -90 -70 -60 -80 0 -80 C 60 -80 90 -70 90 -40 C 90 -10 60 0 10 0 L -20 30 L -12 0 C -60 0 -90 -10 -90 -40 Z' },
      thought: {
        d: ['M -60 10 C -96 10 -100 -30 -70 -38 C -76 -70 -30 -82 -10 -60 C 4 -86 54 -82 60 -50 C 92 -50 100 -8 70 4 C 70 24 40 28 24 16 C 4 30 -40 28 -60 10', circle(-58, 42, 11), circle(-78, 66, 6)],
        fill: 'M -60 10 C -96 10 -100 -30 -70 -38 C -76 -70 -30 -82 -10 -60 C 4 -86 54 -82 60 -50 C 92 -50 100 -8 70 4 C 70 24 40 28 24 16 C 4 30 -40 28 -60 10 Z',
      },
      mountain: { d: ['M -124 70 L -42 -62 L 0 0 L 40 -44 L 124 70', ['f', 'M -60 -34 L -42 -24 L -28 -40'], ['f', 'M -150 72 L 150 72']], fill: 'M -124 70 L -42 -62 L 0 0 L 40 -44 L 124 70 Z' },
      money: { d: ['M -84 -40 L 84 -40 L 84 40 L -84 40 L -84 -36', circle(0, 0, 22), ['f', 'M -66 -24 L -66 24'], ['f', 'M 66 -24 L 66 24']], fill: 'M -84 -40 L 84 -40 L 84 40 L -84 40 Z' },
    };

    // ---- geometry made once per key (the same on every frame and every host). The key holds everything the strokes
    //      are made from, so a cache clear only ever recomputes the same thing: nothing depends on draw history.
    const GEO = new Map();
    const remember = (k, r) => { if (GEO.size > 3000) GEO.clear(); GEO.set(k, r); return r; };
    function geometry(key, items, fill, o) {
      const amp = o.wobble ?? 1.2, wave = o.wave ?? 140, seed = String(o.seed ?? key), k = `${key}|${amp}|${wave}|${seed}`;
      const r = GEO.get(k);
      if (r) return r;
      const strokes = [];
      items.forEach((it, idx) => {
        const [wt, d, ink, arrow, wk] = typeof it === 'string' ? ['m', it] : it;
        for (const [j, sub] of parsePath(d).entries()) {
          let P = sub;
          if (arrow && j === 0) P = withHead(P, arrow);
          const isDot = wt === 'dot' || lenOf(P) < 1.5;
          if (!isDot && amp > 0) P = wobble(P, amp, wave, seed, `${seed}:${idx}:${j}`);
          strokes.push({ P, cum: cumOf(P), len: isDot ? 0 : lenOf(P), w: (WEIGHT[wt] ?? WEIGHT.m) * (wk || 1), ink: ink || null, dot: isDot, speed: it.speed || 1 });
        }
      });
      let shape = null;
      if (fill) shape = parsePath(fill).map((P, j) => (amp > 0 ? wobble(P, amp, wave, seed, `${seed}:fill:${j}`) : P));
      // the local extent (stroke centres and the tint's shape) and the heaviest stroke, for checks
      const bb = bbox(strokes.flatMap((q) => q.P).concat(shape ? shape.flat() : []));
      return remember(k, { k, strokes, shape, bb, wmax: strokes.length ? Math.max(...strokes.map((q) => q.w)) : 0 });
    }

    // ---- the transform: local → screen (scene units)
    const matrix = () => { const T = g.getTransform(); return [T.a / SC, T.b / SC, T.c / SC, T.d / SC, T.e / SC, T.f / SC]; };
    const apply = (M, p) => [M[0] * p[0] + M[2] * p[1] + M[4], M[1] * p[0] + M[3] * p[1] + M[5]];
    const zoomOf = (M) => Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2]));
    function register(id, str, x, y, w, h) {
      if (id === false) return;
      const M = matrix();
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const p of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) { const q = apply(M, p); x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
      env.registerBox(id, str, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }

    // ---- a pen schedule: each stroke gets its share of the time by length, a hop between strokes
    const ease = (u) => { u = clamp(u); return lerp(u, u * u * (3 - 2 * u), 0.55); };
    function schedule(strokes, s, at, o) {
      const lens = strokes.map((q) => Math.max(0.6, q.len * s) / (q.speed || 1)), L = lens.reduce((a, b) => a + b, 0);
      // a lift between strokes: longer the further the pen travels (o.hop caps it)
      const hops = strokes.slice(1).map((q, i) => { const e = strokes[i].P[strokes[i].P.length - 1], d = dist(e, q.P[0]) * s; return Math.min(o.hop ?? HOP + 0.03, 0.03 + d / 2400); });
      const H2 = hops.reduce((a, b) => a + b, 0);
      const dur = o.dur ?? clamp(L / (o.speed ?? SPEED) + H2, 0.2, 4);
      const k = H2 > dur * 0.6 ? (dur * 0.6) / H2 : 1;   // a short fixed dur squeezes the lifts first
      let t = at;
      const segs = lens.map((l, i) => { const a = t, b = t + ((dur - H2 * k) * l) / L; t = b + (hops[i] || 0) * k; return { a, b }; });
      return { at, end: at + dur, segs };
    }
    function addJob(job) { job.order = SEQ++; JOBS.push(job); return job; }

    // ---- ink on the board: a flat, opaque marker line (joins and crossings never darken: one ink, one layer)
    function trace(st, upto) {
      const P = st.P, cum = st.cum;
      g.beginPath(); g.moveTo(P[0][0], P[0][1]);
      for (let i = 1; i < P.length; i++) {
        if (cum[i] <= upto) { g.lineTo(P[i][0], P[i][1]); continue; }
        const d = cum[i] - cum[i - 1], k = d > 0 ? (upto - cum[i - 1]) / d : 0;
        g.lineTo(lerp(P[i - 1][0], P[i][0], k), lerp(P[i - 1][1], P[i][1], k));
        break;
      }
    }
    function inkLine(st, u, color, s, alpha, weight) {
      if (u <= 0 || alpha <= 0.004) return;
      const w = (weight ? weight * (st.w / WEIGHT.m) : st.w) / s;
      g.save();
      g.fillStyle = color; g.strokeStyle = color; g.lineCap = 'round'; g.lineJoin = 'round';
      g.globalAlpha = alpha;
      if (st.dot) { g.beginPath(); g.arc(st.P[0][0], st.P[0][1], w / 2, 0, TAU); g.fill(); g.restore(); return; }
      g.lineWidth = w; trace(st, st.len * u); g.stroke();
      g.restore();
    }
    function shapePath(shape, dx = 0, dy = 0) {
      const p = new Path2D();
      for (const P of shape) { p.moveTo(P[0][0] + dx, P[0][1] + dy); for (let i = 1; i < P.length; i++) p.lineTo(P[i][0] + dx, P[i][1] + dy); p.closePath(); }
      return p;
    }
    /** A scanline zig-zag inside the shape (local units), rows `gap` apart at angle `ang`: one stroke. */
    function hatchOf(shape, gap, ang) {
      const c = Math.cos(-ang), s = Math.sin(-ang), rot = (p) => [p[0] * c - p[1] * s, p[0] * s + p[1] * c], back = (p) => [p[0] * c + p[1] * s, -p[0] * s + p[1] * c];
      const polys = shape.map((P) => P.map(rot)), all = polys.flat(), bb = bbox(all), out = [];
      let dir = 1;
      for (let y = bb.y0 + gap * 0.6; y < bb.y1 - gap * 0.3; y += gap) {
        const xs = [];
        for (const P of polys) for (let i = 1; i < P.length; i++) { const a = P[i - 1], b = P[i]; if ((a[1] <= y) !== (b[1] <= y)) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0])); }
        if (xs.length < 2) continue;
        xs.sort((p, q) => p - q);
        let x0 = xs[0] + gap * 0.35, x1 = xs[xs.length - 1] - gap * 0.35;
        if (x1 - x0 < gap * 0.4) continue;
        if (dir < 0) [x0, x1] = [x1, x0];
        out.push(back([x0, y]), back([x1, y + gap * 0.55]));
        dir = -dir;
      }
      return out;
    }

    /**
     * Draw a set of strokes as one drawing: placed at (x, y), scale s, rot, flip; o.at (s), o.dur (or by length),
     * o.ink, o.fill (a tint name or colour: coloured in after the outline), o.hatch (an ink: hatched by the pen),
     * o.alpha, o.pen (false: no marker), o.wobble, o.seed, o.stroke (marker px), o.cue (the beat it lands on, for
     * checks). Returns { at, end }.
     */
    function drawSet(key, items, fill, o = {}) {
      const s = o.s ?? 1, at = o.at ?? 0, alpha = o.alpha ?? 1;
      const geo = geometry(key, items, fill, o);
      let strokes = geo.strokes;
      if (o.hatch && geo.shape) {
        // keyed on the geometry and the scale it's drawn at (the rows are hatchGap screen px apart at any s)
        const gap = o.hatchGap ?? 15, ang = o.hatchAngle ?? -0.6, sk = Math.round(Math.max(0.2, s) * 1e4) / 1e4, hk = `${geo.k}|hatch|${gap}|${ang}|${sk}`;
        const H2 = GEO.get(hk) || remember(hk, ((Z) => (Z.length > 1 ? [{ P: Z, cum: cumOf(Z), len: lenOf(Z), w: WEIGHT.f, ink: null, dot: false, speed: 2.2, hatch: true }] : []))(hatchOf(geo.shape, gap / sk, ang)));
        strokes = strokes.concat(H2);
      }
      const sch = schedule(strokes, s, at, o);
      g.save();
      g.translate(o.x ?? 0, o.y ?? 0);
      if (o.rot) g.rotate(o.rot);
      g.scale(s * (o.flip ? -1 : 1), s);
      const M = matrix(), main = inkOf(o.ink, INK.ink);
      if (o.pen !== false && strokes.length) addJob({ kind: 'draw', key, cue: o.cue, at: sch.at, end: sch.end, segs: sch.segs, strokes, M, colors: strokes.map((q) => (q.hatch ? inkOf(o.hatch) : inkOf(q.ink && !o.ink ? q.ink : null, main))),
        lb: geo.bb, pad: ((o.stroke ? (o.stroke * geo.wmax) / WEIGHT.m : geo.wmax) / 2 + (o.fill ? 4 : 0)) / s });
      // colouring in: a flat tint under the outline, a hair off register, once the outline is done
      if (fill && geo.shape && o.fill) {
        const fa = alpha * EZ.o2(clamp((TT - (o.fillAt ?? sch.end + 0.05)) / 0.4));
        if (fa > 0.004) { g.save(); g.globalAlpha = fa * (o.fillAlpha ?? 1); g.fillStyle = tintOf(o.fill); g.fill(shapePath(geo.shape, 4 / s, 4 / s)); g.restore(); }
      }
      let hatchClip = null;
      strokes.forEach((st, i) => {
        const sg = sch.segs[i], u = TT >= sg.b ? 1 : TT <= sg.a ? 0 : ease((TT - sg.a) / (sg.b - sg.a));
        if (u <= 0) return;
        const color = st.hatch ? inkOf(o.hatch) : inkOf(st.ink && !o.ink ? st.ink : null, main);
        if (st.hatch) { if (!hatchClip) hatchClip = shapePath(geo.shape); g.save(); g.clip(hatchClip); inkLine(st, u, color, s, alpha * (o.hatchAlpha ?? 0.8)); g.restore(); } else inkLine(st, u, color, s, alpha, o.stroke);
      });
      g.restore();
      return { at: sch.at, end: sch.end };
    }

    // ---- the doodle library and the primitives
    const doodles = () => Object.keys(DOODLES);
    function doodle(name, x, y, o = {}) {
      const def = DOODLES[name];
      if (!def) throw new Error(`whiteboard: no doodle called "${name}"`);
      const groups = o.part ? [o.part] : ['d', ...(o.parts ?? def.with ?? [])];
      const items = [];
      for (const gname of groups) {
        const list = gname === 'd' ? def.d : def.parts && def.parts[gname];
        if (!list) throw new Error(`whiteboard: "${name}" has no part "${gname}"`);
        items.push(...list);
      }
      // the wobble is seeded by the name and the place, so two clocks on one board are two hands' worth of clock; a part
      // drawn at the same place shares the doodle's field (its joints meet). o.key (or o.seed) keeps one wobble anywhere.
      const seed = o.key != null ? `${name}:${o.key}` : `${name}@${Math.round(x)},${Math.round(y)}`;
      return drawSet(`doodle:${name}:${groups.join('+')}`, items, o.part ? null : def.fill || null, { seed, ...o, x, y });
    }
    /** Your own doodle: strokes as path data (or [weight, d, ink]) in a local box around (x, y). */
    const sketch = (strokes, x, y, o = {}) => drawSet(`sketch:${o.key ?? ''}:${env.fnv(JSON.stringify(strokes), o.shape || '')}`, strokes, o.shape || null, { seed: `sketch:${o.key ?? env.fnv(JSON.stringify(strokes))}`, ...o, x, y });
    const pts = (P) => 'M ' + P.map((p) => `${(+p[0]).toFixed(1)} ${(+p[1]).toFixed(1)}`).join(' L ');
    /** One stroke through points (world units). */
    const line = (P, o = {}) => drawSet(`line:${o.weight ?? 'm'}:${o.head || 0}:${pts(P)}`, [[o.weight ?? 'm', pts(P), null, o.head || 0]], null, { wobble: 1.4, ...o });
    /** An arrow from a to b, bent by o.bend (a fraction of its length, + to the left), head o.head px. */
    function arrow(a, b, o = {}) {
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1], bend = o.bend ?? 0.18;
      const c = [mx - dy * bend, my + dx * bend];
      const d = `M ${a[0].toFixed(1)} ${a[1].toFixed(1)} Q ${c[0].toFixed(1)} ${c[1].toFixed(1)} ${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
      return drawSet(`arrow:${o.weight ?? 'm'}:${o.head ?? 22}:${d}`, [[o.weight ?? 'm', d, null, o.head ?? 22]], null, { wobble: 1.6, ...o });
    }
    /** The loop round a punchline: more than a full turn, growing a little, bold, like a real pen loop. */
    const loop = (x, y, rx, ry, o = {}) => drawSet(`loop:${x}:${y}:${rx}:${ry}:${o.turns ?? 1.14}:${o.a0 ?? -2.6}:${o.grow ?? 0.07}`, [['b', pts(ellipse(x, y, rx, ry, { turns: o.turns ?? 1.14, a0: o.a0 ?? -2.6, grow: o.grow ?? 0.07 }))]], null, { wobble: 2.2, ink: 'ox', ...o });
    const underline = (x0, x1, y, o = {}) => drawSet(`under:${x0}:${x1}:${y}`, [['b', `M ${x0} ${y + 2} C ${lerp(x0, x1, 0.3)} ${y - 6} ${lerp(x0, x1, 0.7)} ${y - 4} ${x1} ${y + 3}`]], null, { wobble: 1.5, ink: 'ox', ...o });
    const box = (x, y, w, h, o = {}) => drawSet(`box:${x}:${y}:${w}:${h}:${o.weight ?? 'm'}`, [[o.weight ?? 'm', `M ${x + 6} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} L ${x} ${y - 4}`]], `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`, { wobble: 1.4, ...o });
    const check = (x, y, o = {}) => { const k = o.size ?? 1; return drawSet(`check:${x}:${y}:${k}`, [['b', `M ${x - 30 * k} ${y - 4 * k} C ${x - 20 * k} ${y + 6 * k} ${x - 12 * k} ${y + 16 * k} ${x - 4 * k} ${y + 28 * k} C ${x + 10 * k} ${y - 4 * k} ${x + 30 * k} ${y - 36 * k} ${x + 54 * k} ${y - 62 * k}`]], null, { wobble: 1, ink: 'blue', ...o }); };
    const cross = (x0, y0, x1, y1, o = {}) => drawSet(`cross:${x0}:${y0}:${x1}:${y1}`, [['b', `M ${x0} ${y0} L ${x1} ${y1}`], ['b', `M ${x1 - 4} ${y0 + 2} L ${x0 + 2} ${y1 - 4}`]], null, { wobble: 1, ink: 'ox', ...o });
    function rays(x, y, r0, r1, n, o = {}) {
      const a0 = o.a0 ?? -Math.PI / 2, span = o.span ?? TAU, items = [];
      for (let i = 0; i < n; i++) { const a = a0 + (span * (span >= TAU - 1e-6 ? i / n : i / Math.max(1, n - 1))); items.push(['f', `M ${(x + Math.cos(a) * r0).toFixed(1)} ${(y + Math.sin(a) * r0).toFixed(1)} L ${(x + Math.cos(a) * r1).toFixed(1)} ${(y + Math.sin(a) * r1).toFixed(1)}`]); }
      return drawSet(`rays:${x}:${y}:${r0}:${r1}:${n}:${a0}:${span}`, items, null, { wobble: 0.6, ink: 'amber', hop: 0.05, ...o });
    }
    /** A dotted line along points or path data: the dots appear as the pen passes. o.gap (px), o.head. */
    function dots(path, o = {}) {
      const d = typeof path === 'string' ? path : pts(path), at = o.at ?? 0, alpha = o.alpha ?? 1, color = inkOf(o.ink, INK.blue), k = `dots:${d}`, ck = `${k}|${o.wobble ?? 1.2}`;
      let geo = GEO.get(ck);
      if (!geo) { const P = wobble(parsePath(d)[0], o.wobble ?? 1.2, 140, k, k + ':0'); geo = remember(ck, { P, cum: cumOf(P), len: lenOf(P), bb: bbox(P) }); }
      const st = { P: geo.P, cum: geo.cum, len: geo.len, w: WEIGHT.m, dot: false, ink: null, speed: 1 };
      const sch = schedule([st], 1, at, { speed: SPEED * 0.75, ...o });
      const gap = o.gap ?? 22, r = (o.size ?? 11) / 2;
      g.save();
      if (o.pen !== false) addJob({ kind: 'draw', key: k, cue: o.cue, at: sch.at, end: sch.end, segs: sch.segs, strokes: [st], M: matrix(), colors: [color], lb: geo.bb, pad: r });
      const u = TT >= sch.end ? 1 : TT <= at ? 0 : ease((TT - at) / (sch.end - at));
      g.fillStyle = color; g.globalAlpha = alpha;
      if (u > 0) for (let s2 = 0; s2 <= geo.len * u + 1e-6; s2 += gap) { const p = along(geo.P, geo.cum, s2); g.beginPath(); g.arc(p[0], p[1], r, 0, TAU); g.fill(); }
      g.restore();
      if (o.head) {   // registered on every frame like any drawing (it draws nothing before its at)
        const end = geo.P[geo.P.length - 1], back = along(geo.P, geo.cum, Math.max(0, geo.len - 20)), a = Math.atan2(end[1] - back[1], end[0] - back[0]), h = o.head;
        const b1 = [end[0] + Math.cos(a + Math.PI + 0.55) * h, end[1] + Math.sin(a + Math.PI + 0.55) * h], b2 = [end[0] + Math.cos(a + Math.PI - 0.55) * h, end[1] + Math.sin(a + Math.PI - 0.55) * h];
        const hd = line([b1, end, b2], { at: sch.end + 0.05, dur: 0.18, ink: o.ink ?? 'blue', weight: 'f', alpha, pen: o.pen, wobble: 0.5 });
        return { at: sch.at, end: hd.end };
      }
      return { at: sch.at, end: sch.end };
    }

    // ---- words: Caveat written on with the marker (o.halo: a board-coloured halo clears lines under it), and stroke caps
    const handFont = (size, weight = 700) => ({ family: HAND, size, weight, style: 'normal' });
    const writeW = (str, size = 56, weight = 700) => env.measure(str, handFont(size, weight)).w;
    function write(str, x, y, o = {}) {
      str = String(str);
      const size = o.size ?? 56, font = handFont(size, o.weight ?? 700), m = env.measure(str, font);
      const x0 = o.align === 'center' ? x - m.w / 2 : o.align === 'right' ? x - m.w : x;
      const at = o.at ?? 0, dur = o.dur ?? clamp(m.w / 620 + 0.14, 0.3, 2.6), color = inkOf(o.ink, INK.ink), alpha = o.alpha ?? 1;
      g.save(); g.translate(x0, y); if (o.rot) g.rotate(o.rot);
      if (o.pen !== false) addJob({ kind: 'write', key: 'write:' + str, cue: o.cue, at, end: at + dur, w: m.w, size, M: matrix(), colors: [color], lb: { x0: 0, y0: -m.asc, x1: m.w, y1: m.desc }, pad: o.halo ? size * 0.1 : 0 });
      const u = o.frac != null ? clamp(o.frac) : clamp((TT - at) / dur);
      if (u > 0 && alpha > 0.004) {
        const front = m.w * u, band = size * 0.18, tp = env.textPath(str, font);
        const slice = (a, b, al) => {
          if (b <= a) return;
          g.save(); g.beginPath(); g.rect(a, -size * 1.4, b - a, size * 2.1); g.clip();
          if (tp) {
            if (o.halo) { g.globalAlpha = alpha * al * 0.9; g.strokeStyle = BOARD; g.lineWidth = size * 0.2; g.lineJoin = 'round'; g.stroke(tp.path); }
            g.globalAlpha = alpha * al; g.fillStyle = color; g.fill(tp.path);
          } else { g.globalAlpha = alpha * al; g.fillStyle = color; env.fillText(g, str, 0, 0, font); }
          g.restore();
        };
        if (u >= 1) slice(-size, m.w + size, 1);
        else { slice(-size, front - band, 1); slice(front - band, front, 0.55); }
        register(o.id ?? str, str, 0, -m.asc, m.w, m.asc + m.desc);
      }
      g.restore();
      return { w: m.w, at, end: at + dur };
    }
    // ---- stroke capitals with a hand: each letter turned, sized, lifted and narrowed a little on its own (seeded by the
    //      word, so a word is lettered the same everywhere), tracked tight, a touch uneven in weight
    const TRACK = 10;
    function capsLayout(str, o) {
      const R = RNG('wb-caps', o.seed), jit = o.jitter, items = [];
      let cx = 0;
      for (const ch of capsOf(str)) {
        const [w, ...strokes] = CAPS[ch];
        // ±2° turned, ±3 % sized, ±2 px off the baseline, ±5 % in width, ±8 % in weight
        const rot = R.n(0.035) * jit, ks = 1 + R.n(0.03) * jit, dy = R.n(200 / o.size) * jit, sx = o.condense * (1 + R.n(0.05) * jit), wk = 1 + R.n(0.08) * jit, ww = w * sx * ks;
        for (const d of strokes) for (const P of parsePath(d)) items.push([o.weight, pts(xform(P.map(([px, py]) => [px - w / 2, py - 100]), cx + ww / 2, 100 + dy, rot, sx * ks, ks)), null, 0, wk]);
        cx += ww + o.track;
      }
      return { items, units: Math.max(0, cx - o.track) };
    }
    function capsOpts(str, o = {}) {
      const c = { size: o.size ?? 90, track: o.track ?? TRACK, jitter: o.jitter ?? 1, condense: o.condense ?? 0.97, weight: o.weight ?? 'm', seed: String(o.seed ?? str) };
      const key = `letters:${str}:${c.size}:${c.track}:${c.jitter}:${c.condense}:${c.weight}:${c.seed}`;
      return { c, key, L: GEO.get(key) || remember(key, capsLayout(str, c)) };
    }
    /** The width of stroke capitals at a cap height (o: track, jitter, condense, seed as letters() takes them). */
    const lettersW = (str, size = 90, o = {}) => capsOpts(str, { ...o, size }).L.units * (size / 100);
    /** Stroke capitals: each letter drawn by the pen, stroke by stroke. Baseline-left at (x, y); o.size = cap height. */
    function letters(str, x, y, o = {}) {
      const { c, key, L } = capsOpts(str, o), size = c.size, k = size / 100;
      const total = L.units * k, x0 = o.align === 'center' ? x - total / 2 : o.align === 'right' ? x - total : x;
      const wpx = o.w ?? clamp(size * 0.12, 6, 20);
      const r = drawSet(key, L.items, null, { wobble: (o.wobble ?? 1.1) / k, wave: 140 / k, speed: SPEED * 1.35, hop: 0.045, ...o, x: x0, y: y - size, s: k, stroke: wpx, seed: c.seed });
      if (TT >= r.at) { g.save(); g.translate(x0, y - size); if (o.rot) g.rotate(o.rot); register(o.id ?? str, String(str), -wpx / 2, -wpx / 2 - 3, total + wpx, size + wpx + 6); g.restore(); }
      return { ...r, w: total };
    }

    // ---- the camera: stops [{ at, dur, z, p: [x, y], to?, drift?, ease? }]; the first holds, each next moves in over
    //      its dur (smoothstep by default, an even glide with no whip; zoom in log space). drift: once a stop has
    //      arrived, a slow push in (a fraction of zoom a second), so a held board still breathes.
    function track(stops) {
      const first = stops[0] || {};
      let c = { z: first.z ?? 1, p: first.p || [W / 2, H / 2], to: first.to || [W / 2, H / 2] };
      const breathe = (st, arrive) => { if (st.drift) c = { ...c, z: c.z * (1 + st.drift * Math.max(0, TT - arrive)) }; };
      breathe(first, 0);
      for (let i = 1; i < stops.length; i++) {
        const st = stops[i], u = (EZ[st.ease] || EZ.smooth)(clamp((TT - st.at) / (st.dur ?? 1.2)));
        if (u <= 0) break;
        const z1 = st.z ?? c.z, p1 = st.p || c.p, t1 = st.to || c.to;
        c = { z: Math.exp(lerp(Math.log(c.z), Math.log(z1), u)), p: [lerp(c.p[0], p1[0], u), lerp(c.p[1], p1[1], u)], to: [lerp(c.to[0], t1[0], u), lerp(c.to[1], t1[1], u)] };
        breathe(st, st.at + (st.dur ?? 1.2));
      }
      return c;
    }
    let VIEW = { z: 1, p: [W / 2, H / 2], to: [W / 2, H / 2] };
    function view(c) {
      if (c) VIEW = { z: c.z ?? 1, p: c.p || [W / 2, H / 2], to: c.to || [W / 2, H / 2] };
      const z = VIEW.z;
      g.setTransform(z * SC, 0, 0, z * SC, (VIEW.to[0] - z * VIEW.p[0]) * SC, (VIEW.to[1] - z * VIEW.p[1]) * SC);
      return VIEW;
    }

    // ---- the board: a warm white surface with a fine tooth, a soft mottle and the faint ghosts of old drawings
    let TOOTH = null, MOTTLE = null, PATS = null;
    const TILE = 2048, MQ = 4;   // the mottle tile: 2048 world units, drawn at a quarter
    const TOOTH_K = 0.07, MOTTLE_A = 7, VIGNETTE = 'rgba(100,66,56,', VIGNETTE_A = 0.045;   // a clean, light board
    function toothTile() {
      if (TOOTH) return TOOTH;
      const s = 256, c = env.canvas(s, s), p = c.getContext('2d'), d = p.createImageData(s, s), R = RNG('wb-tooth');
      // a faint grey speck per pixel (TOOTH_K: just enough to be a surface, not enough to grey the board)
      for (let i = 0; i < d.data.length; i += 4) { const v = 238 + R.n(1) * 17; d.data[i] = 22; d.data[i + 1] = 20; d.data[i + 2] = 16; d.data[i + 3] = Math.round(clamp(1 - v / 255) * TOOTH_K * 255); }
      p.putImageData(d, 0, 0);
      return (TOOTH = c);
    }
    function mottleTile() {
      if (MOTTLE) return MOTTLE;
      const s = TILE / MQ, c = env.canvas(s, s), p = c.getContext('2d'), R = RNG('wb-mottle');
      // periodic value noise, two octaves: the board's slow unevenness
      const lattice = (n, key) => { const r = RNG('wb-lat', key), v = []; for (let i = 0; i < n * n; i++) v.push(r.f()); return (x, y) => { const gx = ((x % n) + n) % n, gy = ((y % n) + n) % n, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), at = (a, b) => v[((b % n) + n) % n * n + ((a % n) + n) % n]; return lerp(lerp(at(x0, y0), at(x0 + 1, y0), sx), lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), sx), sy); }; };
      const n1 = lattice(6, 1), n2 = lattice(14, 2), d = p.createImageData(s, s);
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
        const v = 0.65 * n1((x / s) * 6, (y / s) * 6) + 0.35 * n2((x / s) * 14, (y / s) * 14), i = (y * s + x) * 4;
        d.data[i] = 124; d.data[i + 1] = 114; d.data[i + 2] = 102; d.data[i + 3] = Math.round(clamp((v - 0.42) * 1.7) ** 1.6 * MOTTLE_A);
      }
      p.putImageData(d, 0, 0);
      // ghosts: words wiped off long ago (faint loops of old handwriting) and the eraser's broad swirls; soft, grey,
      // drawn on every side so the tile stays seamless
      p.lineCap = 'round'; p.lineJoin = 'round'; p.filter = 'blur(1.2px)';
      const wrapStroke = (P) => { for (const [dx, dy] of [[0, 0], [s, 0], [-s, 0], [0, s], [0, -s], [s, s], [-s, -s], [s, -s], [-s, s]]) { p.beginPath(); p.moveTo(P[0][0] + dx, P[0][1] + dy); for (const q of P) p.lineTo(q[0] + dx, q[1] + dy); p.stroke(); } };
      for (let k = 0; k < 16; k++) {   // a ghost line of handwriting: a run of small loops
        const x = R.r(0, s), y = R.r(0, s), n = R.i(8, 20), h = R.r(2.2, 3.6), P = [];
        for (let j = 0; j <= n * 6; j++) { const u = j / 6; P.push([x + u * h * 0.9 + Math.cos(u * TAU) * h * 0.35, y + Math.sin(u * TAU) * h * 0.5 + Math.sin(u * 0.7) * h * 0.4]); }
        p.strokeStyle = `rgba(108,104,100,${R.r(0.012, 0.024).toFixed(3)})`; p.lineWidth = R.r(0.7, 1.1); wrapStroke(P);
      }
      for (let k = 0; k < 7; k++) {    // eraser swirls
        const x = R.r(0, s), y = R.r(0, s), r = R.r(14, 40), P = [];
        for (let j = 0; j <= 40; j++) { const a = (j / 40) * TAU * R.r(0.5, 0.9); P.push([x + Math.cos(a) * r * (1 + j / 90), y + Math.sin(a) * r * 0.7]); }
        p.strokeStyle = 'rgba(150,144,138,0.018)'; p.lineWidth = R.r(6, 11); wrapStroke(P);
      }
      p.filter = 'none';
      return (MOTTLE = c);
    }
    /** The visible world rectangle under the current transform (with a margin). */
    function visible(pad = 64) {
      const M = matrix(), det = M[0] * M[3] - M[1] * M[2] || 1, inv = (sx, sy) => { const x = sx - M[4], y = sy - M[5]; return [(M[3] * x - M[2] * y) / det, (-M[1] * x + M[0] * y) / det]; };
      const C = [inv(-pad, -pad), inv(W + pad, -pad), inv(-pad, H + pad), inv(W + pad, H + pad)];
      return bbox(C);
    }
    /** The paper under the room's light (screen space, opaque, made once at half size): pooled on the middle, a warm
     *  wash, warmer at the top left. Opaque, so the faint warmth survives 8-bit canvases; under the ink, so the marks
     *  stay flat. */
    let LIT = null;
    function litCanvas() {
      if (LIT) return LIT;
      const c = env.canvas(W / 2, H / 2), p = c.getContext('2d');
      p.scale(0.5, 0.5);
      p.fillStyle = BOARD; p.fillRect(0, 0, W, H);
      const pool = p.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, H * 0.95);
      pool.addColorStop(0, 'rgba(255,252,249,0.55)'); pool.addColorStop(1, 'rgba(255,252,249,0)');
      p.fillStyle = pool; p.fillRect(0, 0, W, H);
      p.fillStyle = 'rgba(255,234,228,0.05)'; p.fillRect(0, 0, W, H);
      const warm = p.createRadialGradient(W * 0.22, -H * 0.1, 0, W * 0.22, -H * 0.1, H * 1.2);
      warm.addColorStop(0, 'rgba(255,246,226,0.07)'); warm.addColorStop(1, 'rgba(255,246,226,0)');
      p.fillStyle = warm; p.fillRect(0, 0, W, H);
      return (LIT = c);
    }
    function board(o = {}) {
      if (!PATS || PATS.g !== g) PATS = { g, tooth: g.createPattern(toothTile(), 'repeat'), mottle: g.createPattern(mottleTile(), 'repeat') };
      const r = visible();
      g.save(); g.setTransform(SC, 0, 0, SC, 0, 0); g.drawImage(litCanvas(), 0, 0, W, H); g.restore();
      g.save();
      g.save(); g.scale(MQ, MQ); g.globalAlpha = o.mottle ?? 1; g.fillStyle = PATS.mottle; g.fillRect(r.x0 / MQ, r.y0 / MQ, (r.x1 - r.x0) / MQ, (r.y1 - r.y0) / MQ); g.restore();
      g.globalAlpha = o.tooth ?? 1; g.fillStyle = PATS.tooth; g.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
      g.restore();
      if (o.sheen !== false) sheen(o.sheen ?? 1);
    }
    /** The gloss: a window's soft reflection in the board. It lives behind the surface, so it slides at under half
     *  the board's speed when the camera moves (the board's parallax). Screen space, drawn by K.board(). */
    const SM = 420, SQ = 2;   // the gloss canvas: the screen plus a 420 px margin each side, drawn at half size
    let SHEEN = null;
    function sheenCanvas() {
      if (SHEEN) return SHEEN;
      const c = env.canvas((W + 2 * SM) / SQ, (H + 2 * SM) / SQ), p = c.getContext('2d');
      p.scale(1 / SQ, 1 / SQ); p.translate(SM + W * 0.62, SM + H * 0.3); p.rotate(-0.42);
      for (const [x, w, a] of [[-120, 300, 0.42], [260, 110, 0.3], [-560, 70, 0.18]]) {
        const gr = p.createLinearGradient(x - w, 0, x + w, 0);
        gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
        p.fillStyle = gr; p.fillRect(x - w, -1800, 2 * w, 3600);
      }
      return (SHEEN = c);
    }
    function sheen(k = 1) {
      const M = matrix(), q = apply(M, [W / 2, H / 2]), dx = clamp((q[0] - W / 2) * 0.42, -SM, SM), dy = clamp((q[1] - H / 2) * 0.42, -SM, SM);
      g.save(); g.setTransform(SC, 0, 0, SC, 0, 0); g.globalAlpha = clamp(k);
      g.drawImage(sheenCanvas(), -SM + dx, -SM + dy, W + 2 * SM, H + 2 * SM);
      g.restore();
    }

    // ---- the marker: a white barrel, its cap posted on the back, a felt tip in the ink; made once per ink
    const SPRITES = new Map(), SK = 2, SW = 44, SH = 196, TIPX = 22, TIPY = 188;   // sprite: marker units ×2, tip at (TIPX, TIPY)
    function rr(p, x, y, w, h, r) { p.beginPath(); p.moveTo(x + r, y); p.lineTo(x + w - r, y); p.quadraticCurveTo(x + w, y, x + w, y + r); p.lineTo(x + w, y + h - r); p.quadraticCurveTo(x + w, y + h, x + w - r, y + h); p.lineTo(x + r, y + h); p.quadraticCurveTo(x, y + h, x, y + h - r); p.lineTo(x, y + r); p.quadraticCurveTo(x, y, x + r, y); p.closePath(); }
    function markerSprite(color) {
      if (SPRITES.has(color)) return SPRITES.get(color);
      const c = env.canvas(SW * SK, SH * SK), p = c.getContext('2d');
      p.scale(SK, SK); p.translate(TIPX, TIPY);
      const edge = '#2b3442';
      // felt tip
      p.fillStyle = color; p.beginPath(); p.moveTo(-6, -15); p.lineTo(-5.4, -4); p.quadraticCurveTo(0, 4, 5.4, -4); p.lineTo(6, -15); p.closePath(); p.fill();
      // collar
      const cg = p.createLinearGradient(-14, 0, 14, 0); cg.addColorStop(0, '#b9b3a8'); cg.addColorStop(0.35, '#ece8e0'); cg.addColorStop(1, '#a8a296');
      p.fillStyle = cg; p.strokeStyle = edge; p.lineWidth = 2.2; p.lineJoin = 'round';
      p.beginPath(); p.moveTo(-8, -13); p.lineTo(8, -13); p.lineTo(14, -38); p.lineTo(-14, -38); p.closePath(); p.fill(); p.stroke();
      // barrel: a white cylinder
      const bg = p.createLinearGradient(-17, 0, 17, 0); bg.addColorStop(0, '#cfcbc3'); bg.addColorStop(0.28, '#ffffff'); bg.addColorStop(0.62, '#f4f2ed'); bg.addColorStop(1, '#bdb8ae');
      p.fillStyle = bg; rr(p, -17, -150, 34, 114, 7); p.fill(); p.lineWidth = 2.6; p.stroke();
      // the label: a band in the ink and two grey rules
      p.fillStyle = color; p.globalAlpha = 0.9; p.fillRect(-15.6, -72, 31.2, 12); p.globalAlpha = 1;
      p.strokeStyle = 'rgba(43,52,66,0.35)'; p.lineWidth = 2; p.lineCap = 'round';
      p.beginPath(); p.moveTo(-8, -124); p.lineTo(8, -124); p.moveTo(-8, -116); p.lineTo(4, -116); p.stroke();
      // the cap, posted on the back
      const kg = p.createLinearGradient(-17, 0, 17, 0); kg.addColorStop(0, 'rgba(0,0,0,0.28)'); kg.addColorStop(0.3, 'rgba(255,255,255,0.22)'); kg.addColorStop(1, 'rgba(0,0,0,0.32)');
      p.fillStyle = color; rr(p, -17.5, -184, 35, 52, 8); p.fill(); p.fillStyle = kg; p.fill(); p.strokeStyle = edge; p.lineWidth = 2.6; p.stroke();
      p.fillStyle = color; p.fillRect(-5, -186, 10, 4);
      // a highlight down the barrel
      p.strokeStyle = 'rgba(255,255,255,0.75)'; p.lineWidth = 3.4; p.beginPath(); p.moveTo(-8.5, -142); p.lineTo(-8.5, -82); p.stroke();
      p.strokeStyle = 'rgba(255,255,255,0.4)'; p.beginPath(); p.moveTo(-9, -176); p.lineTo(-9, -150); p.stroke();
      SPRITES.set(color, c);
      return c;
    }
    let SHADOW = null;
    function shadowSprite() {
      if (SHADOW) return SHADOW;
      const pad = 16, c = env.canvas((SW + pad * 2) * SK, (SH + pad * 2) * SK), p = c.getContext('2d');
      p.scale(SK, SK); p.translate(TIPX + pad, TIPY + pad);
      p.filter = 'blur(5px)'; p.fillStyle = 'rgba(30,26,20,1)';
      p.beginPath(); p.moveTo(-6, -4); p.lineTo(-14, -38); p.lineTo(-17, -40); p.lineTo(-17, -176); p.quadraticCurveTo(-17, -184, -9, -184); p.lineTo(9, -184); p.quadraticCurveTo(17, -184, 17, -176); p.lineTo(17, -40); p.lineTo(14, -38); p.lineTo(6, -4); p.quadraticCurveTo(0, 4, -6, -4); p.closePath(); p.fill();
      return (SHADOW = c);
    }

    // ---- where the pen is at t: read the frame's whole schedule (pure in t: every drawing registers every frame)
    function poseOf(job, T) {
      const M = job.M;
      if (job.kind === 'write') {
        const u = clamp((T - job.at) / (job.end - job.at)), x = job.w * u, y = -job.size * 0.3 + Math.sin(x * 0.115) * job.size * 0.11 - Math.abs(Math.sin(x * 0.045)) * job.size * 0.06;
        return { p: apply(M, [x, y]), lift: 0, color: job.colors[0], z: zoomOf(M) };
      }
      const { segs, strokes } = job;
      for (let i = 0; i < segs.length; i++) {
        const sg = segs[i];
        if (T < sg.a && i > 0) {
          const pe = segs[i - 1], u = clamp((T - pe.b) / Math.max(1e-6, sg.a - pe.b)), a = strokes[i - 1], b = strokes[i];
          const e = a.P[a.P.length - 1], s0 = b.P[0];
          return { p: apply(M, [lerp(e[0], s0[0], EZ.io(u)), lerp(e[1], s0[1], EZ.io(u))]), lift: Math.sin(Math.PI * u) * clamp(dist(e, s0) * zoomOf(M) / 60, 0.25, 0.8), color: job.colors[i], z: zoomOf(M) };
        }
        if (T < sg.b) { const st = strokes[i], u = ease((T - sg.a) / Math.max(1e-6, sg.b - sg.a)); return { p: apply(M, along(st.P, st.cum, st.len * u)), lift: 0, color: job.colors[i], z: zoomOf(M) }; }
      }
      const st = strokes[strokes.length - 1];
      return { p: apply(M, st.P[st.P.length - 1]), lift: 0, color: job.colors[job.colors.length - 1], z: zoomOf(M) };
    }
    const startOf = (job) => (job.kind === 'write' ? poseOf(job, job.at) : { p: apply(job.M, job.strokes[0].P[0]), color: job.colors[0], z: zoomOf(job.M) });
    const endOf = (job) => poseOf(job, job.end);
    function penAt(T) {
      const list = JOBS.slice().sort((a, b) => a.at - b.at || a.order - b.order);
      let act = null;
      for (const j of list) if (j.at <= T && T < j.end) act = j;
      if (act) return { ...poseOf(act, T), alpha: 1 };
      let prev = null, next = null;
      for (const j of list) { if (j.end <= T && (!prev || j.end >= prev.end)) prev = j; if (j.at > T && !next) next = j; }
      if (prev && next && next.at - prev.end < GLIDE) {
        const a = endOf(prev), b = startOf(next), u = clamp((T - prev.end) / Math.max(1e-6, next.at - prev.end)), e = EZ.io(u);
        return { p: [lerp(a.p[0], b.p[0], e), lerp(a.p[1], b.p[1], e)], lift: Math.sin(Math.PI * u) * clamp(dist(a.p, b.p) / 90, 0.35, 1), color: u < 0.5 ? a.color : b.color, z: lerp(a.z, b.z, e), alpha: 1 };
      }
      const OUT = 0.32, IN = 0.26;
      if (prev && T - prev.end < OUT) { const a = endOf(prev), u = EZ.o2((T - prev.end) / OUT); return { p: [a.p[0] + u * 34, a.p[1] - u * 46], lift: u, color: a.color, z: a.z, alpha: 1 - u }; }
      if (next && next.at - T < IN) { const b = startOf(next), u = EZ.o2(1 - (next.at - T) / IN); return { p: [b.p[0] + (1 - u) * 40, b.p[1] - (1 - u) * 52], lift: 1 - u, color: b.color, z: b.z, alpha: u }; }
      return null;
    }
    /** The marker, drawn last (screen space): where the frame's schedule puts it. o.scale, o.alpha. */
    function pen(o = {}) {
      const q = penAt(TT);
      if (!q || q.alpha <= 0.01) return null;
      const before = penAt(TT - 1 / 30) || q, vx = q.p[0] - before.p[0], vy = q.p[1] - before.p[1];
      const k = (o.scale ?? 0.92) * Math.pow(q.z || 1, 0.85) * (1 + q.lift * 0.05), lift = q.lift;
      const rot = 0.5 + clamp(vx * 0.004, -0.1, 0.1) - clamp(vy * 0.002, -0.05, 0.05) + Math.sin(TT * 7.3) * 0.012;
      g.save(); g.setTransform(SC, 0, 0, SC, 0, 0); g.globalAlpha = (o.alpha ?? 1) * q.alpha;
      const sh = shadowSprite(), pad = 16;
      g.save(); g.translate(q.p[0] + (5 + lift * 26) * k, q.p[1] + (7 + lift * 34) * k); g.rotate(rot); g.scale(k / SK, k / SK);
      g.globalAlpha *= 0.2 - lift * 0.07; g.drawImage(sh, -(TIPX + pad) * SK, -(TIPY + pad) * SK); g.restore();
      g.translate(q.p[0] + lift * 10 * k, q.p[1] - lift * 16 * k); g.rotate(rot); g.scale(k / SK, k / SK);
      g.drawImage(markerSprite(q.color), -TIPX * SK, -TIPY * SK);
      g.restore();
      return { x: q.p[0], y: q.p[1], lift };
    }
    /** A job's whole extent on screen at this frame (scene px): its local box, padded by its ink, through its transform. */
    function screenBox(j) {
      const b = j.lb, p = j.pad || 0, C = [[b.x0 - p, b.y0 - p], [b.x1 + p, b.y0 - p], [b.x0 - p, b.y1 + p], [b.x1 + p, b.y1 + p]].map((q) => apply(j.M, q)), r = bbox(C);
      return { x: +r.x0.toFixed(1), y: +r.y0.toFixed(1), w: +(r.x1 - r.x0).toFixed(1), h: +(r.y1 - r.y0).toFixed(1) };
    }
    /** The frame's pen schedule (for checks): [{ kind, key, at, end, cue? }] in time order; o.boxes adds each drawing's
     *  whole extent on screen at this frame (box: { x, y, w, h }), drawn yet or not. */
    const jobs = (o = {}) => JOBS.slice().sort((a, b) => a.at - b.at || a.order - b.order).map((j) => ({ kind: j.kind, key: j.key, ...(j.cue != null ? { cue: j.cue } : {}), at: +j.at.toFixed(4), end: +j.end.toFixed(4), ...(o.boxes ? { box: screenBox(j) } : {}) }));

    let LIGHT = null;
    function lightCanvas() {   // made once, at half size (smooth gradients): a warm-neutral vignette
      if (LIGHT) return LIGHT;
      const c = env.canvas(W / 2, H / 2), p = c.getContext('2d');
      p.scale(0.5, 0.5);
      const v = p.createRadialGradient(W * 0.52, H * 0.46, H * 0.38, W * 0.52, H * 0.46, H * 1.08);
      v.addColorStop(0, VIGNETTE + '0)'); v.addColorStop(1, VIGNETTE + VIGNETTE_A + ')');
      p.fillStyle = v; p.fillRect(0, 0, W, H);
      return (LIGHT = c);
    }
    /** The room's light, in screen space and last: a soft warm vignette (it only darkens, so the ink stays flat). o.alpha. */
    function light(o = {}) {
      g.save(); g.setTransform(SC, 0, 0, SC, 0, 0); g.globalAlpha = o.alpha ?? 1;
      g.drawImage(lightCanvas(), 0, 0, W, H);
      g.restore();
    }

    return {
      bind(c) { g = c.g; TT = c.TT; SC = c.scale || 1; JOBS = []; SEQ = 0; VIEW = { z: 1, p: [W / 2, H / 2], to: [W / 2, H / 2] }; },
      INK, TINT, HAND,
      // the camera and the surface
      track, view, board, light,
      // drawings
      doodle, doodles, sketch, line, arrow, loop, underline, box, check, cross, rays, dots, ellipse,
      // words
      write, writeW, letters, lettersW, CAPS_SET,
      // the pen
      pen, jobs,
    };
  },
});
