// =====================================================================
//  engine/styles/sketchbook/kit.js: Sketchbook, graphite and one accent colour on a warm sketchbook page, with
//  hand lettering. Every line is drawn by hand and boils on twos; things are pencilled in, inked over, then
//  coloured with a quick scribble, and the lettering on the page does the narrating.
//  A 16:9 port of cth9191/animate's sketchbook style (styles/sketchbook/kit.js and the parts of kit/core.js it
//  uses), MIT, Copyright (c) 2026 cth9191; the full notice is LICENSE beside this file and travels with every copy.
//  Port changes (Bombadillo AI, 2026): an FLPT.style plug-in with closure state instead of globals, bound per frame;
//  the frame is 1920x1080 and the spiral binding runs along the top; the page can be bigger than the frame (a spread
//  the camera travels across) with its edges, the pages below and a desk beyond it for a pull-back reveal; the
//  lettering is drawn from glyph outlines of bundled Caveat (OFL) and registers its boxes with the runtime; animate's
//  morph hooks (window, blob, backdrop) become windowFrame, blob and bare; new: crossOut, circleIt, dashed, crumbs,
//  ant, bulbPts and a few world props (cloud, sun, house, tree, flag) for wider pages; sketchBox closes its top edge
//  (animate's stopped just past the top-left corner, so its boxes, cards and stamps were open at the top); pageTex
//  can place or drop the ghosts of erased lines and the coffee ring.
//
//  THE INKS  graphite = rough, provisional, the mess. Ink = what is settled. ONE accent (terracotta) = the hero.
//            Highlighter yellow marks the one word to read; red marker is a title underline or a stamp, once.
// =====================================================================
FLPT.style('sketchbook', {
  tokens: { paper: '#f2ead8', ink: '#2a2420', font: '"Caveat", "Comic Sans MS", cursive', hero: '#d97757' },
  fonts: [
    { family: 'Caveat', file: 'caveat-regular.ttf', weight: 400 },
    { family: 'Caveat', file: 'caveat-bold.ttf', weight: 700 },
  ],
  ones: false,
  make(env) {
    const { W, H, rng: RNG, clamp, lerp, EZ } = env;
    const TAU = Math.PI * 2;
    const HAND = env.tokens.font, MARKER = env.tokens.font;
    let g = null, B = 0, TT = 0, SC = 1;   // bound per frame

    // ---- the palette (animate's SK). Terracotta is the hero's alone.
    const SK = {
      paper: '#f2ead8', ink: '#2a2420', graph: '#6f6a63', graphL: '#9a948b',
      terra: '#d97757', terraD: '#b85c3f', cream: '#f7ecd9', sheet: '#fffdf6',
      hilite: '#f7d64a', red: '#e0483a', green: '#4f9d5d', blue: '#3b5c8c',
      pink: '#ef9aa6', glass: '#9cc6d8', tape: '#efe2b4', wood: '#ecc995', lead: '#3b3632', yellow: '#f1bf2c',
      desk: '#3a2f27', deskL: '#4a3c31',
    };
    const ev = (t0, d = 0.25) => clamp((TT - t0) / d);

    // ---- geometry (animate kit/core.js)
    const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
    function ellipsePts(cx, cy, rx, ry, rot = 0, n = 64) {
      const P = [], c = Math.cos(rot), s = Math.sin(rot);
      for (let i = 0; i < n; i++) { const a = (TAU * i) / n, x = Math.cos(a) * rx, y = Math.sin(a) * ry; P.push([cx + x * c - y * s, cy + x * s + y * c]); }
      return P;
    }
    function arcPts(cx, cy, r, a0, a1, n = 18, sy = 1) { const P = []; for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; P.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * sy]); } return P; }
    function xform(P, tx, ty, rot = 0, sx = 1, sy = sx) { const c = Math.cos(rot), s = Math.sin(rot); return P.map(([x, y]) => [tx + x * sx * c - y * sy * s, ty + x * sx * s + y * sy * c]); }
    function bbox(P, pad = 0) { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of P) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; } return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad }; }
    function resample(P, closed, step) {
      const out = [], n = P.length, m = closed ? n : n - 1;
      if (n < 2) return P.slice();
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
    function trace(P, closed) {
      g.beginPath();
      const n = P.length; if (n < 2) return;
      g.moveTo(P[0][0], P[0][1]);
      for (let i = 1; i < n; i++) g.lineTo(P[i][0], P[i][1]);
      if (closed) g.closePath();
    }

    // ---- THE HAND: polylines that boil. The wobble's phases reseed on every boil step (B); it is index-based, so
    //      the tremor travels along the stroke. Structure is seeded by key and never moves; only the tremor changes.
    function gwob(P, key, amp) {
      const R = RNG('gw', key, B), p1 = R.r(0, TAU), p2 = R.r(0, TAU), f1 = 0.28 + R.f() * 0.25, f2 = 0.9 + R.f() * 0.5;
      const n = P.length, out = new Array(n);
      for (let i = 0; i < n; i++) {
        const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
        let nx = a[1] - b[1], ny = b[0] - a[0]; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
        const o = amp * (0.62 * Math.sin(i * f1 + p1) + 0.38 * Math.sin(i * f2 + p2));
        out[i] = [P[i][0] + nx * o, P[i][1] + ny * o];
      }
      return out;
    }
    // write-on: the first `part` of a polyline by length (null when nothing shows yet)
    function writeOn(P, part) {
      if (part >= 1) return P;
      if (part <= 0) return null;
      const Q = subPath(P, part);
      return Q.length > 1 ? Q : null;
    }
    const closeP = (P) => [...P, P[0]];
    // where the pen is on a stroke written `part` of the way
    const writeEnd = (P, part) => { const Q = writeOn(resample(P, false, 12), clamp(part)); return Q ? Q[Q.length - 1] : P[0]; };
    // the ink line: one confident stroke and a thin second pass that doesn't quite agree.
    // o: w, col, a, key, amp, part (write-on 0..1), step, second, closed
    function gline(P, o = {}) {
      const { w = 5, col = SK.ink, a = 1, key = 'gl', amp = 1.7, part = 1, step = 12, second = true } = o;
      const Q = writeOn(resample(o.closed ? closeP(P) : P, false, step), part); if (!Q) return null;
      g.save(); g.globalAlpha *= a; g.strokeStyle = col; g.lineCap = 'round'; g.lineJoin = 'round';
      g.lineWidth = w; trace(gwob(Q, key, amp), false); g.stroke();
      if (second) { g.globalAlpha *= 0.55; g.lineWidth = w * 0.42; trace(gwob(Q, key + '~', amp * 1.6), false); g.stroke(); }
      g.restore();
      return Q;
    }
    // the graphite line: two light passes, the second looser (construction, mess, things not settled yet)
    function gpencil(P, o = {}) {
      const { w = 2.4, col = SK.graph, a = 0.8, key = 'gp', amp = 2.4, part = 1, step = 12, passes = 2 } = o;
      const Q = writeOn(resample(o.closed ? closeP(P) : P, false, step), part); if (!Q) return null;
      g.save(); g.strokeStyle = col; g.lineCap = 'round'; g.lineJoin = 'round';
      const base = g.globalAlpha;
      for (let k = 0; k < passes; k++) {
        g.globalAlpha = base * a * (k ? 0.5 : 0.85); g.lineWidth = w * (k ? 0.8 : 1);
        trace(gwob(Q, key + ':' + k, amp * (1 + k * 0.6)), false); g.stroke();
      }
      g.restore();
      return Q;
    }
    // a hand-drawn loop: runs past its start and drifts outward a little (over = how far past 360 degrees)
    function loopPts(cx, cy, rx, ry, over = 0.07, a0 = -2.2, n = 0) {
      const N = n || Math.max(24, Math.ceil((rx + ry) * 0.35)), P = [];
      for (let i = 0; i <= N; i++) {
        const u = i / N, a = a0 + u * TAU * (1 + over), s = 1 + 0.035 * u * Math.sign(over);
        P.push([cx + Math.cos(a) * rx * s, cy + Math.sin(a) * ry * s]);
      }
      return P;
    }
    // a box drawn in one go, clockwise from the top-right corner: rounded corners (r); the last stroke crosses the whole
    // top edge and the pen runs a little past where it started (over; 0 = a closed outline, for fills)
    // (port: animate's last point stopped just past the top-left corner, so its boxes had no top edge)
    function sketchBox(x, y, w, h, r = 0, over = 0.04) {
      const P = [], arc = (cx, cy, a0) => { for (let i = 0; i <= 6; i++) { const a = a0 + (i / 6) * Math.PI / 2; P.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
      arc(x + w - r, y + r, -Math.PI / 2); arc(x + w - r, y + h - r, 0); arc(x + r, y + h - r, Math.PI / 2); arc(x + r, y + r, Math.PI);
      if (over > 0) P.push([x + w - r + Math.min(w * over, r + 12), y - 1.5]);
      return P;
    }
    // a flat colour laid down slightly off the line (the colour pass never quite registers with the ink)
    function gfill(P, col, o = {}) {
      const { a = 1, off = [4, 3], key = 'gf', amp = 2 } = o;
      if (a <= 0.004) return;
      const Q = gwob(resample(P, false, 14), key, amp);
      g.save(); g.globalAlpha *= a; g.fillStyle = col; g.translate(off[0], off[1]); trace(Q, true); g.fill(); g.restore();
    }
    function gclip(P) { trace(resample(P, false, 16), true); g.clip(); }
    // parallel hatching inside a clip that is already set; structure seeded by key, tremor on the boil
    function ghatch(x0, y0, x1, y1, o = {}) {
      const { ang = -0.85, gap = 7, col = SK.graph, w = 2, a = 0.5, key = 'gh' } = o;
      if (a <= 0.004) return;
      const S = RNG('ghs', key), R = RNG('ghj', key, B);
      g.save(); g.strokeStyle = col; g.lineWidth = w; g.globalAlpha *= a; g.lineCap = 'round';
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rad = Math.hypot(x1 - x0, y1 - y0) / 2 + 4, ca = Math.cos(ang), sa = Math.sin(ang);
      g.beginPath();
      for (let d = -rad; d <= rad; d += gap) {
        const j = R.n(1.1), len = rad * (0.8 + S.f() * 0.25), px = cx - sa * (d + j), py = cy + ca * (d + j);
        g.moveTo(px - ca * len, py - sa * len); g.lineTo(px + ca * len, py + sa * len);
      }
      g.stroke(); g.restore();
    }
    // shade a shape with hatching, leaving a lit circle top-left (the way the page's round things are shaded)
    function litHatch(P, o = {}) {
      const bb = bbox(P), cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2, r = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) / 2;
      g.save(); gclip(P);
      g.beginPath(); g.rect(bb.x0 - r, bb.y0 - r, 4 * r, 4 * r); g.arc(cx - r * (o.lx ?? 0.3), cy - r * (o.ly ?? 0.34), r * (o.lr ?? 1.02), 0, TAU); g.clip('evenodd');
      ghatch(bb.x0, bb.y0, bb.x1, bb.y1, o); g.restore();
    }
    // a back-and-forth scribble that shades a shape in one colour (clipped; write it on with part)
    function scribbleFill(P, col, o = {}) {
      const { ang = -0.6, gap = 11, w = 3.2, a = 0.85, key = 'sf', part = 1, amp = 1.3, base = 0.3 } = o;
      if (part <= 0) return;
      const bb = bbox(P, 6), cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2, rad = Math.hypot(bb.x1 - bb.x0, bb.y1 - bb.y0) / 2;
      const ca = Math.cos(ang), sa = Math.sin(ang), S = RNG('sfs', key), Z = [];
      for (let d = -rad, i = 0; d <= rad; d += gap, i++) {
        const e = i % 2 ? 1 : -1, L = rad * (0.9 + S.f() * 0.15);
        Z.push([cx - sa * d + ca * L * e, cy + ca * d + sa * L * e]);
      }
      g.save(); gclip(P);
      if (base > 0) { g.save(); g.globalAlpha *= base * clamp(part * 3); g.fillStyle = col; g.fillRect(bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0); g.restore(); }
      gline(Z, { w, col, a, key: key + 'z', amp, part, step: 14, second: false });
      g.restore();
    }
    // a tangle of graphite: raw stuff, the mess (seeded shape, boiling tremor)
    // (port: the pen circles in small loops while its centre wanders the box, a real scribble ball, where animate's
    //  path jumped point to point). o: loops, n, w, a, col, part
    function graphiteScribble(cx, cy, w, h, key, o = {}) {
      const S = RNG('gsc', key), loops = o.loops ?? 9, n = o.n ?? loops * 28, P = [], ph = S.f() * TAU, q = S.f() * TAU, q2 = S.f() * TAU, fx = 0.11 + S.f() * 0.05, fy = 0.09 + S.f() * 0.05;
      for (let i = 0; i <= n; i++) {
        const u = (i / n) * loops * TAU, rl = Math.min(w, h) * (0.2 + 0.07 * Math.sin(u * 0.5 + q2));
        const ox = (w / 2 - rl) * Math.sin(u * fx + ph), oy = (h / 2 - rl) * Math.sin(u * fy + q);
        P.push([cx + ox + Math.cos(u) * rl, cy + oy + Math.sin(u) * rl * 0.82]);
      }
      return gpencil(P, { key: 'gsc' + key, amp: 1.1, w: o.w ?? 2.8, a: o.a ?? 0.85, step: 8, col: o.col ?? SK.graph, part: o.part ?? 1 });
    }
    // a soft graphite smudge (a thumb dragged through pencil): radial falloff, no hard edge
    function smudgeOn(q, x, y, rx, ry, a = 0.12, rot = 0) {
      q.save(); q.translate(x, y); q.rotate(rot); q.scale(1, ry / rx);
      const gr = q.createRadialGradient(0, 0, 0, 0, 0, rx);
      gr.addColorStop(0, `rgba(80,76,70,${a})`); gr.addColorStop(0.55, `rgba(80,76,70,${a * 0.5})`); gr.addColorStop(1, 'rgba(80,76,70,0)');
      q.fillStyle = gr; q.beginPath(); q.arc(0, 0, rx, 0, TAU); q.fill(); q.restore();
    }
    const smudge = (x, y, rx, ry, a, rot) => smudgeOn(g, x, y, rx, ry, a, rot);
    // a cross through something: two strokes, written on (graphite by default; o.ink for an ink cross)
    function crossOut(x0, y0, x1, y1, part = 1, o = {}) {
      const k = o.key ?? 'x' + Math.round(x0), w = o.w ?? (o.ink ? 6 : 4), col = o.col ?? (o.ink ? SK.ink : SK.graph), a = o.a ?? 0.95;
      // ink: one confident stroke each (no second pass); graphite: gpencil's own two passes
      const pen = (P, key, p) => (o.ink ? gline(P, { w, col, a, key, amp: 1.6, part: p, second: false }) : gpencil(P, { w, col, a, key, amp: 1.6, part: p }));
      pen([[x0, y0], [x1, y1]], k + 'a', clamp(part * 2));
      pen([[x1, y0], [x0, y1]], k + 'b', clamp(part * 2 - 1));
    }
    // a quick loop drawn round something, written on
    const circleIt = (cx, cy, rx, ry, part = 1, o = {}) => gline(loopPts(cx, cy, rx, ry, o.over ?? 0.12, o.a0 ?? -2.4), { w: o.w ?? 5, col: o.col ?? SK.ink, key: o.key ?? 'ring' + Math.round(cx), part, amp: 1.8, step: 10, second: o.second ?? true });
    // a dashed graphite path (a route, a trail), written on
    function dashed(P, o = {}) {
      g.save(); g.setLineDash(o.dash ?? [14, 14]);
      const Q = gpencil(P, { key: o.key ?? 'dash', w: o.w ?? 3, a: o.a ?? 0.7, part: o.part ?? 1, passes: 1, amp: o.amp ?? 1.2, col: o.col ?? SK.graph });
      g.restore();
      return Q;
    }

    // ---- THE HAND: lettering from Caveat's outlines; per-glyph jitter on the boil; letters write on one by one
    const fontOf = (size, face = 'hand', weight) => `${weight ?? (face === 'marker' ? 700 : 400)} ${size}px ${face === 'marker' ? MARKER : HAND}`;
    const ADV = new Map(), GLYPH = new Map();   // static measurements and outlines (pure caches of the font)
    function advances(str, font) {
      const k = font + '|' + str; let v = ADV.get(k); if (v) return v;
      const chars = [...str]; v = [0];
      for (let i = 1; i <= chars.length; i++) v.push(env.measure(chars.slice(0, i).join(''), font).w);
      ADV.set(k, v); return v;
    }
    function glyph(ch, font) {
      const k = font + '|' + ch; if (GLYPH.has(k)) return GLYPH.get(k);
      const tp = env.textPath(ch, font); GLYPH.set(k, tp); return tp;
    }
    const letterW = (str, size, face = 'hand', weight) => { const xs = advances(String(str), fontOf(size, face, weight)); return xs[xs.length - 1]; };
    // a box in g's current coordinates, registered on screen (scene units) for the text checks
    function register(id, str, x, y, w, h) {
      if (id === false) return;
      const T = g.getTransform();
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const [px, py] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) { const sx = T.a * px + T.c * py + T.e, sy = T.b * px + T.d * py + T.f; x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy); }
      env.registerBox(id, str, { x: x0 / SC, y: y0 / SC, w: (x1 - x0) / SC, h: (y1 - y0) / SC });
    }
    // hand lettering at baseline y. o: face ('hand' | 'marker'), weight, col, align (center | left | right), reveal
    // 0..1 (letters write on one at a time: each fades in, rises a little and grows to full size), key, jit, a, rot,
    // stroke (pen weight), ghost (a graphite pass under the ink, as if pencilled first), ripple (a time: the settled
    // line hops once more, letter by letter, left to right), id. Returns [left, right].
    function handLetter(str, x, y, size, o = {}) {
      str = String(str);
      const { face = 'hand', weight, col = SK.ink, align = 'center', reveal = 1, key = str, jit = 1, a = 1, rot = 0 } = o;
      const stroke = o.stroke ?? size * (face === 'marker' ? 0.03 : 0.018);
      const font = fontOf(size, face, weight), xs = advances(str, font), wTot = xs[xs.length - 1], chars = [...str];
      const x0 = align === 'center' ? x - wTot / 2 : align === 'right' ? x - wTot : x;
      const n = chars.length, shown = clamp(reveal) * n;
      if (shown <= 0 || a <= 0.004) return [x0, x0 + wTot];
      g.save(); g.translate(x, y); g.rotate(rot); g.translate(-x, -y);
      const draw = (ox, oy, al, fill, sw) => {
        for (let i = 0; i < n && i < shown; i++) {
          if (chars[i] === ' ') continue;
          const k = clamp(shown - i), R = RNG('hl', key, i, B), tp = glyph(chars[i], font);
          const jx = R.n(1.2) * jit * size / 80, jy = R.n(1.4) * jit * size / 80, jr = R.n(0.025) * jit, gx = x0 + xs[i], gw = xs[i + 1] - xs[i];
          const rp = o.ripple == null ? 0 : clamp((TT - o.ripple - i * 0.06) / 0.3), lift = Math.sin(rp * Math.PI) * size * 0.14;
          g.save(); g.globalAlpha *= al * (0.25 + 0.75 * k);
          g.translate(gx + gw / 2 + jx + ox, y + jy + oy + (1 - k) * size * 0.12 - lift); g.rotate(jr + Math.sin(rp * Math.PI * 2) * 0.06); g.scale(0.8 + 0.2 * k, 0.8 + 0.2 * k); g.translate(-gw / 2, 0);
          if (tp) { g.fillStyle = fill; g.fill(tp.path); if (sw > 0) { g.strokeStyle = fill; g.lineWidth = sw; g.lineJoin = 'round'; g.stroke(tp.path); } }
          else env.fillText(g, chars[i], 0, 0, font);
          g.restore();
        }
      };
      if (o.ghost) draw(size * 0.035, size * 0.03, a * (o.ghost === true ? 0.3 : o.ghost), SK.graph, stroke * 0.4);
      draw(0, 0, a, col, stroke);
      const m = env.measure(str, font);
      register(o.id ?? str, str, x0, y - m.asc, wTot * clamp(Math.ceil(shown) / n), m.asc + m.desc);
      g.restore();
      return [x0, x0 + wTot];
    }
    // a highlighter swipe behind a word: rough ends, multiplied so the lettering sits on top
    function highlight(x0, x1, y, h, part, o = {}) {
      if (part <= 0) return;
      const xe = lerp(x0, x1, EZ.o3(part));
      g.save(); g.globalCompositeOperation = 'multiply'; g.globalAlpha *= o.a ?? 0.8; g.strokeStyle = o.col ?? SK.hilite; g.lineCap = 'butt'; g.lineWidth = h;
      trace(gwob(resample([[x0 - 8, y + 3], [xe + 8, y - 3]], false, 18), 'hi' + (o.key ?? x0), 2.5), false); g.stroke(); g.restore();
    }
    // a quick underline (slightly bowed), written on
    function underline(x0, x1, y, o = {}) {
      return gline([[x0 - 6, y], [lerp(x0, x1, 0.5), y + (o.bow ?? 6)], [x1 + 10, y - 5]], { w: o.w ?? 5, col: o.col ?? SK.ink, key: o.key ?? 'ul' + Math.round(x0), part: o.part ?? 1, amp: 2.2, second: false });
    }

    // ---- THE PAGE: one warm sheet, built once per kind from a seeded RNG and cached. It is the world: it moves with
    //      the camera. o: w, h (the page, world units; default the frame), grid ('dots' | 'ruled' | 'plain'), edge
    //      (true: a finite sheet with its edges, the pages below and a shadow, for a desk beyond; false: paper runs
    //      past the frame on every side), binding (true: a spiral along the top), res (texture scale), coffee (false: no
    //      coffee ring), ghosts (the faint ghosts of erased lines: true, top right; false, none; or [fx0, fy0, fx1, fy1],
    //      the region they start in, as fractions of the page).
    const SK_M = 220;   // how far the paper runs past a frame-sized page (camera moves stay on paper)
    const PAGES = new Map();
    function pageTex(o = {}) {
      const pw = o.w ?? W, ph = o.h ?? H, grid = o.grid ?? 'dots', edge = !!o.edge, bind = o.binding !== false, res = o.res ?? 1;
      const key = [pw, ph, grid, edge, bind, res].join('|'), ghosts = o.ghosts ?? true, coffee = o.coffee !== false;
      const ckey = `${key}|${JSON.stringify(ghosts)}|${coffee}`;   // the RNG is seeded by key alone: options only add or drop marks
      if (PAGES.has(ckey)) return PAGES.get(ckey);
      const bx0 = edge ? -60 : -SK_M, by0 = edge ? -150 : -SK_M, bx1 = edge ? pw + 70 : pw + SK_M, by1 = edge ? ph + 80 : ph + SK_M;
      const c = env.canvas((bx1 - bx0) * res, (by1 - by0) * res), q = c.getContext('2d'), R = RNG('page', key);
      q.scale(res, res); q.translate(-bx0, -by0);
      if (edge) {   // the pages below (offset sheets) and a soft shadow on the desk
        q.save(); q.shadowColor = 'rgba(0,0,0,0.45)'; q.shadowBlur = 40; q.shadowOffsetX = 10; q.shadowOffsetY = 18;
        q.fillStyle = '#e4dac4'; q.fillRect(6, 10, pw + 8, ph + 8); q.restore();
        for (let i = 3; i >= 1; i--) { q.fillStyle = ['#ece2cc', '#e6dbc3', '#dfd3ba'][i - 1]; q.fillRect(i * 3, i * 3.5, pw, ph); }
        q.fillStyle = SK.paper; q.fillRect(0, 0, pw, ph);
        q.save(); q.beginPath(); q.rect(0, 0, pw, ph); q.clip();
      } else { q.fillStyle = SK.paper; q.fillRect(bx0, by0, bx1 - bx0, by1 - by0); }
      const ax0 = edge ? 0 : bx0, ay0 = edge ? 0 : by0, ax1 = edge ? pw : bx1, ay1 = edge ? ph : by1, AW = ax1 - ax0, AH = ay1 - ay0;
      // vignette: the page warms toward its edges, so the frame reads as a page
      const vg = q.createRadialGradient(pw / 2, ph * 0.46, Math.min(pw, ph) * 0.35, pw / 2, ph / 2, Math.hypot(pw, ph) * 0.62);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(125,92,48,0.22)'); q.fillStyle = vg; q.fillRect(ax0, ay0, AW, AH);
      if (grid === 'dots') {
        q.fillStyle = 'rgba(110,100,86,0.22)';
        for (let y = 27; y < ay1; y += 54) for (let x = 27; x < ax1; x += 54) if (x > ax0 && y > ay0 + (bind ? 96 : 0)) q.fillRect(x - 1.3, y - 1.3, 2.6, 2.6);
        for (let y = 27 - 54; y > ay0; y -= 54) for (let x = 27; x < ax1; x += 54) if (!bind) q.fillRect(x - 1.3, y - 1.3, 2.6, 2.6);
        for (let x = 27 - 54; x > ax0; x -= 54) for (let y = 27; y < ay1; y += 54) if (y > ay0 + (bind ? 96 : 0)) q.fillRect(x - 1.3, y - 1.3, 2.6, 2.6);
      } else if (grid === 'ruled') {
        q.strokeStyle = 'rgba(90,130,190,0.26)'; q.lineWidth = 1.6; q.beginPath();
        for (let y = 170; y < ay1; y += 64) { q.moveTo(ax0, y); q.lineTo(ax1, y + R.n(1.5)); }
        q.stroke(); q.strokeStyle = 'rgba(214,96,96,0.30)'; q.beginPath(); q.moveTo(110, ay0); q.lineTo(110, ay1); q.stroke();
      }
      // tooth: dark and light specks, batched by alpha
      const area = (AW * AH) / 3.1e6;
      for (const [rgb, al, n] of [['95,72,40', 0.025, 18000], ['95,72,40', 0.06, 12000], ['255,253,245', 0.05, 14000], ['255,253,245', 0.11, 9000]]) {
        q.fillStyle = `rgba(${rgb},${al})`; q.beginPath();
        for (let i = 0; i < n * area; i++) q.rect(R.r(ax0, ax1), R.r(ay0, ay1), 1 + R.f() * 1.6, 1 + R.f() * 1.6);
        q.fill();
      }
      q.lineCap = 'round'; q.lineWidth = 0.8;   // fibres
      for (let i = 0; i < 520 * area; i++) {
        const x = R.r(ax0, ax1), y = R.r(ay0, ay1), a = R.r(0, TAU), l = 6 + R.f() * 18;
        q.strokeStyle = `rgba(120,95,60,${(0.04 + R.f() * 0.06).toFixed(3)})`;
        q.beginPath(); q.moveTo(x, y); q.quadraticCurveTo(x + Math.cos(a + 0.5) * l * 0.5, y + Math.sin(a + 0.5) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); q.stroke();
      }
      // a hand resting on the page: graphite smudges toward the corners, and the ghosts of erased lines
      for (const [fx, fy, rx, ry, a, rot] of [[0.06, 0.86, 170, 60, 0.09, -0.3], [0.95, 0.3, 120, 46, 0.07, 1.2], [0.12, 0.2, 140, 40, 0.06, 0.15], [0.9, 0.88, 150, 50, 0.07, -0.5]]) smudgeOn(q, fx * pw, fy * ph, rx, ry, a, rot);
      q.strokeStyle = 'rgba(110,104,96,0.10)'; q.lineWidth = 3;
      if (ghosts) {
        const [gx0, gy0, gx1, gy1] = ghosts === true ? [0.5, 0.06, 0.9, 0.18] : ghosts, dy = ghosts === true ? 90 : 0;
        for (let i = 0; i < 4 * Math.max(1, area); i++) { const x = R.r(gx0, gx1) * pw, y = R.r(gy0, gy1) * ph + dy, l = R.r(80, 220); q.beginPath(); q.moveTo(x, y); q.quadraticCurveTo(x + l / 2, y + R.n(30), x + l, y + R.n(12)); q.stroke(); }
      }
      if (coffee) for (let k = 0; k < 3; k++) {   // an old coffee ring, bottom right
        q.strokeStyle = `rgba(150,100,50,${0.08 - k * 0.02})`; q.lineWidth = 6 - k * 2;
        q.beginPath(); q.ellipse(pw - 150 + k * 2, ph - 120 - k, 112 - k * 3, 104, 0.3, 0.2, 5.9); q.stroke();
      }
      if (!edge) for (let i = 0; i < 4; i++) {   // the edges of the pages below, at the right
        q.strokeStyle = `rgba(120,100,80,${0.16 - i * 0.03})`; q.lineWidth = 1.4; q.beginPath();
        q.moveTo(pw - 12 + i * 5, ay0); q.lineTo(pw - 14 + i * 5, ay1); q.stroke();
      }
      if (edge) q.restore();
      if (bind) for (let x = 44; x < pw - 20; x += 62) {   // the spiral binding along the top
        const hx = x, hy = 40;
        q.fillStyle = 'rgba(40,32,26,0.85)'; q.beginPath(); q.ellipse(hx, hy, 9, 11, 0, 0, TAU); q.fill();
        q.strokeStyle = 'rgba(80,78,76,0.9)'; q.lineWidth = 5; q.beginPath(); q.moveTo(hx + 2, hy + 2); q.bezierCurveTo(hx + 10, hy - 60, hx - 22, hy - 80, hx - 18, hy - 120); q.stroke();
        q.strokeStyle = 'rgba(230,228,222,0.6)'; q.lineWidth = 1.6; q.beginPath(); q.moveTo(hx + 4, hy - 4); q.bezierCurveTo(hx + 10, hy - 58, hx - 18, hy - 78, hx - 15, hy - 118); q.stroke();
      }
      const rec = { c, x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 };
      PAGES.set(ckey, rec);
      return rec;
    }
    // the page, in world coordinates (it moves with the camera). o as pageTex, plus tint / tintA (a colour wash)
    function sketchPage(o = {}) {
      const P = pageTex(o);
      g.save();
      if (!o.edge) { g.fillStyle = SK.paper; g.fillRect(P.x, P.y, P.w, P.h); }
      g.drawImage(P.c, P.x, P.y, P.w, P.h);
      if (o.tint) { g.globalAlpha *= o.tintA ?? 0.18; g.fillStyle = o.tint; g.fillRect(o.edge ? 0 : P.x, o.edge ? 0 : P.y, o.edge ? (o.w ?? W) : P.w, o.edge ? (o.h ?? H) : P.h); }
      g.restore();
    }
    // the desk the sketchbook lies on (world units, behind an edge page): dark walnut with a soft grain
    function desk(x0, y0, x1, y1, key = 'desk') {
      g.save(); g.fillStyle = SK.desk; g.fillRect(x0, y0, x1 - x0, y1 - y0);
      const R = RNG('desk', key);
      g.strokeStyle = 'rgba(255,230,200,0.05)'; g.lineWidth = 3; g.beginPath();
      for (let y = y0; y < y1; y += R.r(10, 26)) { g.moveTo(x0, y); for (let x = x0; x <= x1; x += 80) g.lineTo(x, y + Math.sin(x * 0.004 + y) * 5); }
      g.stroke(); g.restore();
    }
    // the bare page in screen space (where a bridge happens), washed toward colour c when given
    function bare(c) {
      g.save(); g.setTransform(SC, 0, 0, SC, 0, 0);
      const P = pageTex({});
      g.fillStyle = SK.paper; g.fillRect(0, 0, W, H); g.drawImage(P.c, P.x, P.y, P.w, P.h);
      if (c) { g.globalAlpha = 0.2; g.fillStyle = c; g.fillRect(0, 0, W, H); }
      g.restore();
    }

    // ---- PROPS (local coordinates around (x, y); keys seed structure, B drives the tremor)
    function tapeStrip(x, y, w, rot = 0, key = 'tape', h = 46) {   // a strip of masking tape, slightly see-through
      g.save(); g.translate(x, y); g.rotate(rot);
      const S = RNG('tp', key), P = [[-w / 2, -h / 2 + S.n(2)], [w / 2, -h / 2 + S.n(2)], [w / 2 + S.n(3), h / 2], [-w / 2 + S.n(3), h / 2]];
      gfill(P, SK.tape, { a: 0.8, off: [0, 0], key, amp: 1.5 });
      g.restore();
    }
    function scrap(x, y, rot, s, key = 'scrap') {   // a torn scrap of page in flight
      g.save(); g.translate(x, y); g.rotate(rot); g.scale(s, s);
      const P = [[-34, -26], [30, -28], [36, 22], [4, 26], [-6, 21], [-32, 27]], S = RNG('scr', key);
      gfill(P, SK.sheet, { off: [0, 0], key, amp: 1.2 });
      gline(closeP(P), { w: 3, key: key + 'o', amp: 1, second: false });
      for (let i = 0; i < 3; i++) gpencil([[-24, -12 + i * 12], [2 + S.f() * 26, -12 + i * 12]], { key: key + 'l' + i, w: 2, amp: 0.8, passes: 1 });
      g.restore();
    }
    function pencilTool(tx, ty, ang, s = 1) {   // the tip at (tx, ty), the body up and to the right
      g.save(); g.translate(tx, ty); g.rotate(ang); g.scale(s, s);
      g.save(); g.globalAlpha *= 0.18; g.fillStyle = '#3a2a1a'; g.translate(14, 16); g.beginPath(); g.moveTo(0, 0); g.lineTo(300, -12); g.lineTo(300, 14); g.closePath(); g.fill(); g.restore();
      gfill([[0, 0], [38, -13], [38, 13]], SK.wood, { off: [0, 0], key: 'pt1', amp: 0.6 });
      gfill([[0, 0], [12, -4], [12, 4]], SK.lead, { off: [0, 0], key: 'pt2', amp: 0.3 });
      const body = [[38, -13], [250, -13], [250, 13], [38, 13]];
      gfill(body, SK.yellow, { off: [3, 2], key: 'pt3', amp: 0.8 });
      g.save(); gclip(body); ghatch(38, -13, 250, 13, { ang: 0.02, gap: 8.5, col: '#c9931a', w: 2, a: 0.5, key: 'pt4' }); g.restore();
      gfill([[250, -14], [278, -14], [278, 14], [250, 14]], '#b9b3a8', { off: [0, 0], key: 'pt5', amp: 0.6 });
      gfill([[278, -13], [300, -12], [302, 12], [278, 13]], SK.pink, { off: [0, 0], key: 'pt6', amp: 0.6 });
      gline([[0, 0], [38, -13], [300, -13], [302, 12], [38, 13], [0, 0]], { w: 3.2, key: 'pt7', amp: 0.8, second: false });
      gline([[38, -13], [38, 13]], { w: 2, key: 'pt8', amp: 0.6, second: false }); gline([[250, -14], [250, 14]], { w: 2, key: 'pt9', amp: 0.6, second: false });
      g.restore();
    }
    function eraserTool(x, y, ang, s = 1) {
      g.save(); g.translate(x, y); g.rotate(ang); g.scale(s, s);
      gfill(sketchBox(-80, -42, 160, 84, 18, 0), SK.pink, { off: [4, 3], key: 'er1' });
      gfill([[-5, -46], [86, -46], [86, 46], [-5, 46]], '#f4efe4', { off: [2, 2], key: 'er2', amp: 1 });
      gfill([[20, -46], [42, -46], [42, 46], [20, 46]], '#5a7fb8', { a: 0.9, off: [0, 0], key: 'er3', amp: 1 });
      gline(sketchBox(-80, -42, 160, 84, 18), { w: 4, key: 'er4' });
      gline([[-5, -46], [86, -46], [86, 46], [-5, 46], [-5, -46]], { w: 3.5, key: 'er5', second: false });
      g.restore();
    }
    // rubber crumbs left by the eraser, around (x, y); k 0..1 how many have fallen
    function crumbs(x, y, k, key = 'crumb') {
      const R = RNG('crumbs', key);
      for (let i = 0; i < 14; i++) { const cx = x + R.n(70), cy = y + R.n(26), r = R.r(3, 7); if (i / 14 > k) break; g.fillStyle = i % 3 ? '#e6b3b8' : '#d99aa2'; g.beginPath(); g.ellipse(cx, cy, r, r * 0.7, R.r(0, 3), 0, TAU); g.fill(); }
    }
    function paperPlane(x, y, ang, s = 1, key = 'plane') {
      g.save(); g.translate(x, y); g.rotate(ang); g.scale(s, s);
      const up = [[48, 0], [-40, -30], [-26, 0]], bot = [[48, 0], [-26, 0], [-40, 24]];
      gfill(up, SK.sheet, { off: [0, 0], key: key + 't', amp: 0.8 }); gfill(bot, '#e9dcc3', { off: [0, 0], key: key + 'b', amp: 0.8 });
      gline(closeP(up), { w: 3.5, key: key + 'o1', amp: 0.8 }); gline(closeP(bot), { w: 3.5, key: key + 'o2', amp: 0.8 });
      g.restore();
    }
    function noteCard(x, y, rot, s, lines = 1, key = 'note', col = SK.blue) {   // an index card; lines 0..1 writes its three lines on
      g.save(); g.translate(x, y); g.rotate(rot); g.scale(s, s);
      gfill(sketchBox(-62, -44, 124, 88, 8, 0), '#fffaf0', { off: [4, 4], key });
      gfill([[-62, -44], [-50, -44], [-50, 44], [-62, 44]], col, { a: 0.95, off: [0, 0], key: key + 'm', amp: 0.8 });
      gline(sketchBox(-62, -44, 124, 88, 8), { w: 4, key: key + 'o' });
      for (let i = 0; i < 3; i++) gline([[-36, -20 + i * 20], [-36 + [80, 68, 44][i], -20 + i * 20]], { w: 3, key: key + 'l' + i, amp: 0.6, second: false, part: clamp(lines * 3 - i) });
      g.restore();
    }
    function inkStamp(str, x, y, s, rot, a = 1, key = 'stamp') {   // a red rubber stamp, worn: specks knocked out
      if (a <= 0.004 || s <= 0.01) return;
      g.save(); g.translate(x, y); g.rotate(rot); g.scale(s, s); g.globalAlpha *= a;
      const w = Math.max(300, letterW(str, 96, 'marker') + 90);
      gline(sketchBox(-w / 2, -62, w, 124, 16), { w: 8, col: SK.red, key: key + '1', second: false });
      gline(sketchBox(-w / 2 + 14, -50, w - 28, 100, 12), { w: 3, col: SK.red, key: key + '2', second: false });
      handLetter(str, 0, 34, 96, { face: 'marker', col: SK.red, key: key + 't', jit: 0.6, id: 'stamp:' + str });
      g.fillStyle = SK.paper; const S = RNG('stk', key);
      for (let i = 0; i < 260; i++) { g.globalAlpha = 0.55 * a; g.fillRect(-w / 2 + S.f() * w, -62 + S.f() * 124, 2 + S.f() * 4, 2 + S.f() * 3); }
      g.restore();
    }
    function checkMark(x, y, s, part, col = SK.green, key = 'chk') {
      g.save(); g.translate(x, y); g.scale(s, s);
      gline([[-30, 2], [-8, 26], [38, -30]], { w: 12, col, key, amp: 1.2, part, step: 8 });
      g.restore();
    }
    function sparkle(x, y, r, k, key = 'spk', col = SK.ink) {   // four ink ticks that open and close over k 0..1
      if (k <= 0 || k >= 1) return; const rr = r * Math.sin(Math.PI * clamp(k));
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.3; gline([[x + Math.cos(a) * rr * 0.25, y + Math.sin(a) * rr * 0.25], [x + Math.cos(a) * rr, y + Math.sin(a) * rr]], { w: 3.5, col, key: key + i, second: false, amp: 0.5, step: 6 }); }
    }
    function arrowPencil(P, part, o = {}) {   // a graphite arrow, written on; the head flicks in last
      const { col = SK.graph, w = 3, key = 'arw' } = o;
      gpencil(P, { part, col, w, key, a: 0.95, passes: 2 });
      if (part > 0.85) {
        const Q = resample(P, false, 6), e = Q[Q.length - 1], q = Q[Math.max(0, Q.length - 4)], an = Math.atan2(e[1] - q[1], e[0] - q[0]), hk = clamp((part - 0.85) / 0.15);
        for (const s of [-1, 1]) gpencil([e, [e[0] - Math.cos(an + s * 0.5) * 26 * hk, e[1] - Math.sin(an + s * 0.5) * 26 * hk]], { col, w, key: key + s, amp: 0.6, passes: 1 });
      }
    }
    function sweat(x, y, k, key = 'sw') {   // a pencil drop that slides off and fades
      if (k <= 0 || k >= 1) return;
      const yy = y + k * 40; g.save(); g.globalAlpha *= 1 - k;
      gpencil([[x, yy - 16], [x + 8, yy], [x, yy + 7], [x - 8, yy], [x, yy - 16]], { key, w: 2.5, amp: 0.6, step: 5 });
      g.restore();
    }
    function doodleStar(x, y, r, key = 'star', o = {}) {   // a five-point margin star in one stroke
      const P = []; for (let i = 0; i <= 5; i++) { const a = -Math.PI / 2 + i * TAU * 2 / 5; P.push([x + Math.cos(a) * r, y + Math.sin(a) * r]); }
      return gpencil(P, { key, w: o.w ?? 2.6, a: o.a ?? 0.8, amp: 1.2, step: 8, part: o.part ?? 1, col: o.col ?? SK.graph });
    }
    function doodleBird(x, y, s, flap, key = 'bird') {   // a two-arc "v" bird; flap 0..1
      const k = 0.35 + 0.65 * flap;
      gline([[x - 26 * s, y - 14 * s * k], [x - 12 * s, y - 16 * s * k], [x, y]], { w: 3 * s, key: key + 'l', amp: 0.5, second: false, step: 6 });
      gline([[x, y], [x + 12 * s, y - 16 * s * k], [x + 26 * s, y - 14 * s * k]], { w: 3 * s, key: key + 'r', amp: 0.5, second: false, step: 6 });
    }
    function ant(x, y, s, key = 'ant') {   // a tiny ant walking a line (legs on twos)
      g.fillStyle = SK.ink;
      for (let i = 0; i < 3; i++) { g.beginPath(); g.ellipse(x + (i - 1) * 11 * s, y - 6 * s, (i === 1 ? 5 : 6.5) * s, 5 * s, 0, 0, TAU); g.fill(); }
      const k = B % 2 ? 1 : -1;
      for (let i = 0; i < 3; i++) gline([[x + (i - 1) * 8 * s, y - 4 * s], [x + (i - 1) * 8 * s + k * (i % 2 ? 5 : -5) * s, y + 3 * s]], { w: 1.8 * s, key: key + i, amp: 0.3, second: false, step: 4 });
      gline([[x + 16 * s, y - 8 * s], [x + 24 * s, y - 16 * s]], { w: 1.6 * s, key: key + 'f', amp: 0.3, second: false, step: 4 });
    }
    // a lightbulb outline: the glass (a circle cut open at the bottom) and a neck, as one closed loop
    function bulbPts(x, y, r) {
      const P = [], a0 = Math.PI / 2 - 0.6, a1 = Math.PI / 2 + 0.6 - TAU;
      for (let i = 0; i <= 36; i++) { const a = lerp(a0, a1, i / 36); P.push([x + Math.cos(a) * r, y + Math.sin(a) * r]); }
      P.push([x - 0.36 * r, y + 1.12 * r], [x - 0.34 * r, y + 1.42 * r], [x + 0.34 * r, y + 1.42 * r], [x + 0.36 * r, y + 1.12 * r]);
      return P;
    }
    function cloudPts(x, y, s) {
      return xform([[-70, 10], ...arcPts(-40, 0, 32, Math.PI, TAU * 0.86, 8), ...arcPts(10, -18, 40, Math.PI * 1.1, TAU * 0.98, 9), ...arcPts(60, 2, 28, Math.PI * 1.3, TAU * 1.1, 7), [90, 14], [-70, 14]], x, y, 0, s);
    }
    // a graphite cloud (part writes it on)
    const doodleCloud = (x, y, s, key = 'cloud', part = 1) => gpencil(cloudPts(x, y, s), { key, w: 3, a: 0.75, part });
    // a sun: a highlighter scribble, inked, rays written on and turning. o: part (rays), turn, fill (0..1), key
    function doodleSun(x, y, r, o = {}) {
      const key = o.key ?? 'sun', n = o.rays ?? 14, rp = o.part ?? 1;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + (o.turn ?? TT * 0.25), r0 = r * 1.18, r1 = r * (1.42 + 0.1 * ((B + i) % 2));
        gline([[x + Math.cos(a) * r0, y + Math.sin(a) * r0], [x + Math.cos(a) * r1, y + Math.sin(a) * r1]], { w: 5, key: key + 'r' + i, part: clamp(rp * 1.6 - (i / n) * 0.6), second: false, amp: 0.8, step: 8 });
      }
      const P = ellipsePts(x, y, r, r, 0, 64);
      scribbleFill(P, SK.hilite, { key: key + 'f', gap: 12, w: 4.5, a: 0.95, base: 0.35, part: o.fill ?? 1 });
      gpencil(P, { closed: true, key: key + 'c', w: 2.6, a: 0.6 });
      gline(loopPts(x, y, r, r, 0.06), { key, w: 6, part: o.ink ?? 1 });
    }
    // a house written on over part 0..1: walls, roof, door; smoke from the chimney once it's done
    function doodleHouse(x, y, s, part = 1, key = 'house') {
      const hp = clamp(part), w = 60 * s, hh = 90 * s;
      if (hp > 0) gfill([[x - w, y], [x - w, y - hh + 4 * s], [x, y - 150 * s], [x + w, y - hh + 4 * s], [x + w, y]], SK.paper, { off: [0, 0], key: key + 'f', a: clamp(hp * 2) });
      gline([[x - w, y], [x - w, y - hh], [x + w, y - hh], [x + w, y]], { key: key + 'w', w: 4.5, part: clamp(hp * 2) });
      gline([[x - 78 * s, y - 84 * s], [x, y - 150 * s], [x + 78 * s, y - 84 * s]], { key: key + 'r', w: 4.5, part: clamp((hp - 0.4) / 0.4) });
      gline([[x - 12 * s, y], [x - 12 * s, y - 46 * s], [x + 14 * s, y - 46 * s], [x + 14 * s, y]], { key: key + 'd', w: 3.5, part: clamp((hp - 0.7) / 0.3), second: false });
      if (hp >= 1) {
        gline([[x + 40 * s, y - 118 * s], [x + 40 * s, y - 150 * s], [x + 54 * s, y - 150 * s], [x + 54 * s, y - 107 * s]], { key: key + 'ch', w: 3.5, second: false });
        const sm = []; for (let k = 0; k <= 10; k++) sm.push([x + 47 * s + Math.sin(k * 0.9 - TT * 5) * 10 * s, y - 160 * s - k * 12 * s]);
        gpencil(sm, { key: key + 'sm', w: 2.6, a: 0.6 });
      }
    }
    // a tree written on over part 0..1: two trunk lines, then a hatched crown that sways
    function doodleTree(x, y, s, part = 1, key = 'tree') {
      const tp = clamp(part), sway = 0.04 * Math.sin(TT * 3 + x * 0.01);
      gline([[x - 6 * s, y], [x - 4 * s, y - 90 * s]], { key: key + 't1', w: 4.5, part: clamp(tp / 0.3), second: false });
      gline([[x + 10 * s, y], [x + 8 * s, y - 90 * s]], { key: key + 't2', w: 4.5, part: clamp(tp / 0.3), second: false });
      g.save(); g.translate(x, y - 90 * s); g.rotate(sway); g.scale(s, s);
      const crown = [...arcPts(-40, -40, 44, Math.PI * 0.6, Math.PI * 1.5, 8), ...arcPts(10, -78, 46, Math.PI * 1.1, Math.PI * 2.0, 8), ...arcPts(50, -30, 44, Math.PI * 1.5, Math.PI * 2.5, 8), [0, 8], [-40, 4]];
      if (tp > 0.3) gfill(crown, SK.paper, { off: [0, 0], key: key + 'cf', a: 0.9 });
      if (tp >= 1) litHatch(crown, { ang: -0.6, gap: 8, col: SK.graph, w: 2, a: 0.5, key: key + 'ch', lx: 0.2, ly: 0.3 });
      gline(crown, { key: key + 'c', w: 4.5, part: clamp((tp - 0.3) / 0.7), closed: true });
      g.restore();
    }
    // a pennant on a pole (planted at (x, y)), written on; it flutters on twos
    function flag(x, y, s, part = 1, key = 'flag', col = SK.red) {
      const fp = clamp(part), fl = (B % 4 < 2 ? 1 : -1) * 4 * s;
      gline([[x, y], [x, y - 150 * s]], { key: key + 'p', w: 4.5, part: clamp(fp * 2), second: false });
      if (fp > 0.5) {
        const P = [[x, y - 150 * s], [x + 80 * s, y - 128 * s + fl], [x, y - 104 * s]];
        gfill(P, col, { off: [3, 2], key: key + 'f', a: clamp((fp - 0.5) * 3) });
        gline(P, { key: key + 'o', w: 3.5, part: clamp((fp - 0.5) * 2), second: false });
      }
    }

    // ---- THE HERO: a terracotta dot with a cream asterisk, eyes and a mouth; arms and legs when it needs to act.
    //      o: key, mood ('calm' | 'wow' | 'happy' | 'puzzled'), look [dx, dy] (-1..1), sx, sy (squash), rot, legs,
    //      step (-1..1 stride), arms [leftAngle, rightAngle] (radians up from horizontal; null = none), part (0..1:
    //      the hero drawn on: pencil ring, ink, then the colour). Returns its outline.
    function doodleHero(x, y, r, o = {}) {
      const key = o.key ?? 'hero', mood = o.mood ?? 'calm', lw = Math.max(3, r * 0.065), part = clamp(o.part ?? 1);
      g.save(); g.translate(x, y); g.rotate(o.rot ?? 0);
      const limbs = part >= 1;
      if (o.legs && limbs) {
        const st = o.step ?? 0;
        for (const s of [-1, 1]) {
          const hip = [s * r * 0.32, r * 0.85], kick = s * st * r * 0.22, foot = [s * r * 0.36 + kick, r * 1.42 - Math.max(0, s * st) * r * 0.1];
          gline([hip, foot], { w: lw, key: key + 'leg' + s, amp: 0.8, second: false, step: 8 });
          gline([foot, [foot[0] + s * r * 0.22, foot[1] + 2]], { w: lw * 1.25, key: key + 'ft' + s, amp: 0.5, second: false, step: 6 });
        }
      }
      if (o.arms && limbs) [-1, 1].forEach((s, i) => {
        const ang = o.arms[i]; if (ang == null) return;
        const sh = [s * r * 0.9, r * 0.15], L = r * 0.85;
        const el = [sh[0] + s * L * 0.5 * Math.cos(ang * 0.6), sh[1] - L * 0.5 * Math.sin(ang * 0.6)], hd = [sh[0] + s * L * Math.cos(ang), sh[1] - L * Math.sin(ang)];
        gline([sh, el, hd], { w: lw, key: key + 'arm' + s, amp: 0.8, second: false, step: 8 });
        gline(loopPts(hd[0], hd[1], r * 0.09, r * 0.09, 0.1), { w: lw * 0.8, key: key + 'hd' + s, amp: 0.4, second: false, step: 5 });
      });
      g.scale(o.sx ?? 1, o.sy ?? 1);
      const body = loopPts(0, 0, r, r, 0, 0, 40);
      if (part < 1) gpencil(loopPts(0, 0, r, r, 0.08), { w: 2.6, a: 0.7, key: key + 'pc', part: clamp(part * 3) });
      const colour = clamp((part - 0.55) / 0.45);   // the colour arrives as a quick scribble, then settles flat
      if (colour > 0 && colour < 1) scribbleFill(body, SK.terra, { key: key + 'sc', part: colour, gap: Math.max(8, r * 0.12), w: Math.max(3, r * 0.07), base: 0.2 });
      if (colour > 0.5) {
        g.save(); g.globalAlpha *= clamp((colour - 0.5) * 2);
        gfill(body, SK.terra, { off: [r * 0.06, r * 0.05], key: key + 'f' });
        litHatch(body, { ang: -0.85, gap: Math.max(5, r * 0.08), col: SK.terraD, w: Math.max(1.6, r * 0.03), a: 0.85, key: key + 'h' });
        g.restore();
      }
      gline(loopPts(0, 0, r, r, 0.08), { w: lw, key: key + 'o', part: clamp((part - 0.25) / 0.35) });
      if (part >= 1) {
        for (let i = 0; i < 8; i++) {   // the cream asterisk on its crown
          const an = i / 8 * TAU + 0.2, r0 = r * 0.04, r1 = r * 0.19, cy = -r * 0.5;
          gline([[Math.cos(an) * r0, cy + Math.sin(an) * r0], [Math.cos(an) * r1, cy + Math.sin(an) * r1]], { w: r * 0.065, col: SK.cream, key: key + 'a' + i, amp: 0.4, second: false, step: 6 });
        }
        const [lx, ly] = o.look ?? [0, 0], blink = mood !== 'wow' && (B + env.fnv(key)) % 37 === 0;
        for (const s of [-1, 1]) {
          const ex = s * r * 0.3 + lx * r * 0.07, ey = r * 0.06 + ly * r * 0.07;
          if (blink) gline([[ex - r * 0.09, ey], [ex + r * 0.09, ey]], { w: lw * 0.9, key: key + 'bl' + s, amp: 0.3, second: false, step: 6 });
          else if (mood === 'happy') gline([[ex - r * 0.09, ey + r * 0.03], [ex, ey - r * 0.06], [ex + r * 0.09, ey + r * 0.03]], { w: lw * 0.9, key: key + 'hp' + s, amp: 0.3, second: false, step: 6 });
          else {
            g.fillStyle = SK.ink; g.beginPath(); g.ellipse(ex, ey, r * 0.085, r * (mood === 'wow' ? 0.15 : 0.12), 0, 0, TAU); g.fill();
            g.fillStyle = SK.cream; g.beginPath(); g.arc(ex - r * 0.025, ey - r * 0.045, r * 0.028, 0, TAU); g.fill();
          }
        }
        if (mood === 'puzzled') gline([[r * 0.18, -r * 0.16], [r * 0.42, -r * 0.24]], { w: lw * 0.8, key: key + 'brow', amp: 0.4, second: false, step: 6 });
        const my = r * 0.4;
        if (mood === 'wow') { g.fillStyle = SK.ink; g.beginPath(); g.ellipse(0, my + r * 0.02, r * 0.08, r * 0.1, 0, 0, TAU); g.fill(); }
        else if (mood === 'happy') { g.fillStyle = SK.ink; g.beginPath(); g.moveTo(-r * 0.2, my - r * 0.05); g.quadraticCurveTo(0, my + r * 0.3, r * 0.2, my - r * 0.05); g.closePath(); g.fill(); }
        else if (mood === 'puzzled') gline([[-r * 0.16, my], [-r * 0.05, my - r * 0.04], [r * 0.06, my + r * 0.03], [r * 0.16, my - r * 0.02]], { w: lw * 0.8, key: key + 'm', amp: 0.4, second: false, step: 5 });
        else gline(arcPts(0, my - r * 0.12, r * 0.16, Math.PI * 0.2, Math.PI * 0.8, 8), { w: lw * 0.8, key: key + 'm', amp: 0.4, second: false, step: 5 });
      }
      g.restore();
      return body;
    }
    const heroPts = (x, y, r) => ellipsePts(x, y, r, r, 0, 96);

    // ---- CAPTIONS: the lettering is the narrator (call in screen space, after ctx.screen()).
    //      pageTag(str, o)             a marker label on masking tape, top left, written on from o.at
    //      pageCaption(lines, hi, o)   1-2 hand-lettered lines centred on o.x (960) from o.y (a baseline), written on
    //                                  letter by letter from o.at; hi = [[lineIndex, 'word'], ...] gets a highlighter
    //                                  swipe once its line is down. o: size, dur, weight, a, col (graphite for a word
    //                                  still in pencil). In the world too, after ctx.apply: it moves with the page.
    function pageTag(str, o = {}) {
      const size = o.size ?? 64, w = letterW(str, size, 'marker'), x = o.x ?? 110, y = o.y ?? 200, at = o.at ?? 0;
      if (TT < at) return;
      tapeStrip(x + w / 2, y - size * 0.3, w + 70, -0.03, 'tagtape' + str, size * 1.15);
      const [x0, x1] = handLetter(str, x, y, size, { face: 'marker', align: 'left', reveal: ev(at + 0.1, 0.3), key: 'tag' + str, jit: 0.7, id: 'tag:' + str });
      underline(x0, x1, y + 18, { col: SK.red, w: 5, key: 'tagu' + str, part: ev(at + 0.4, 0.2) });
    }
    function pageCaption(lines, hi = [], o = {}) {
      const size = o.size ?? 76, y0 = o.y ?? 930, lh = size * 1.12, t0 = o.at ?? 0, cx = o.x ?? W / 2;
      if (TT < t0) return;
      lines.forEach((line, li) => {
        const y = y0 + li * lh, font = fontOf(size, 'hand', o.weight), xs = advances(line, font), x0 = cx - xs[xs.length - 1] / 2;
        for (const [hl, word] of hi) if (hl === li) { const k = line.indexOf(word); if (k >= 0) highlight(x0 + xs[[...line.slice(0, k)].length], x0 + xs[[...line.slice(0, k + word.length)].length], y - size * 0.28, size * 0.55, ev(t0 + 0.5 + li * 0.25, 0.25), { key: 'caph' + li + line }); }
        handLetter(line, cx, y, size, { reveal: ev(t0 + li * 0.25, o.dur ?? 0.4), key: 'cap' + li + line, weight: o.weight, id: 'caption:' + line, a: o.a ?? 1, col: o.col });
      });
    }

    // ---- BRIDGES (animate's morph hooks). A morph happens on the bare page.
    // the world seen through a graphite outline (screen coords), lifted off the page by a soft smudge shadow
    function windowFrame(P, key, inside, o = {}) {
      g.save(); g.shadowColor = 'rgba(70,64,58,0.42)'; g.shadowBlur = 26 * SC; g.shadowOffsetX = 10 * SC; g.shadowOffsetY = 14 * SC;
      trace(P, true); g.fillStyle = SK.paper; g.fill(); g.restore();
      g.save(); trace(P, true); g.clip(); inside(); g.restore();
      gpencil(P, { closed: true, w: 3, a: 0.6, amp: 3.2, key: key + 'c', step: 14 });
      gline(P, { closed: true, w: o.w ?? 5.5, key: key + 'rim', step: 14 });
    }
    // the shape mid-morph: a colour scribble inside a graphite outline
    function blob(P, c, key) {
      gfill(P, c, { a: 0.3, off: [6, 5], key: key + 'f' });
      scribbleFill(P, c, { key: key + 's', gap: 12, w: 4, base: 0.25 });
      gpencil(P, { closed: true, w: 2.6, a: 0.7, amp: 3, key: key + 'c' });
      gline(P, { closed: true, w: 5.5, key: key + 'o' });
    }

    // ---- timing, and the boiling grain over everything (screen space; call last)
    const popS = (t) => (TT < t ? 0 : EZ.back(clamp((TT - t) / 0.25)));
    const hop = (t, d = 0.25) => Math.sin(Math.PI * ev(t, d));
    const TILE = 384;
    let GRAIN = null;
    function grain(o = {}) {
      if (!GRAIN) {
        const c = env.canvas(TILE, TILE), q = c.getContext('2d'), R = RNG('grain');
        for (const [col, n] of [['rgba(60,56,52,0.12)', 900], ['rgba(255,253,245,0.16)', 900]]) { q.fillStyle = col; for (let i = 0; i < n; i++) q.fillRect(R.r(0, TILE), R.r(0, TILE), 1.6, 1.6); }
        GRAIN = q.createPattern(c, 'repeat');
      }
      const R = RNG('pg', B);
      g.save(); g.setTransform(SC, 0, 0, SC, 0, 0); g.globalAlpha = o.alpha ?? 1;
      g.translate(-R.r(0, TILE), -R.r(0, TILE)); g.fillStyle = GRAIN; g.fillRect(0, 0, W + TILE, H + TILE);
      g.restore();
    }

    return {
      bind(c) { g = c.g; B = c.B; TT = c.TT; SC = c.scale || 1; },
      SK, HAND, MARKER,
      // the hand: lines, shapes, colour and shade
      gline, gpencil, gwob, writeOn, writeEnd, closeP, loopPts, sketchBox, gfill, gclip, ghatch, litHatch, scribbleFill, graphiteScribble, smudge, crossOut, circleIt, dashed,
      // geometry
      resample, subPath, pathLen, trace, bbox, ellipsePts, arcPts, xform, dist,
      // lettering
      handLetter, letterW, highlight, underline, pageTag, pageCaption, register,
      // the page
      sketchPage, pageTex, desk, bare,
      // props and the hero
      pencilTool, eraserTool, crumbs, paperPlane, noteCard, inkStamp, checkMark, sparkle, arrowPencil, sweat, doodleStar, doodleBird, scrap, tapeStrip, ant, bulbPts, cloudPts, doodleCloud, doodleSun, doodleHouse, doodleTree, flag,
      doodleHero, heroPts,
      // bridges, timing, the grain
      windowFrame, blob, popS, hop, grain,
    };
  },
});
