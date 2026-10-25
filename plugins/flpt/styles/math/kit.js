// =====================================================================
//  engine/styles/math/kit.js: Math, a manim-like math explainer look. Coloured math on a near-black stage: serif type
//  that is Written on (the outline draws, then the fill comes up, lagged glyph by glyph), manim's smooth sigmoid,
//  ShowCreation sweeps, equations that Transform into each other by matching terms, axes, number planes and graphs
//  (zoomable, with strokes that keep their width), a tracking dot with a live decimal readout, Flash, braces, arrows,
//  and a small pi-shaped hero with eyes that watches the math happen. 16:9, 1920x1080, 30 fps, on ones.
//
//  A 16:9 port of cth9191/animate's math style (styles/math/kit.js + the parts of kit/core.js it draws with), MIT,
//  Copyright (c) 2026 cth9191; the full notice is LICENSE beside this file and travels with every copy.
//  Port changes (Bombadillo AI, 2026): an FLPT.style plug-in with closure state instead of globals; 1920x1080 at
//  30 fps; type is set in the bundled STIX Two Text (OFL), drawn from glyph outlines with kerning and registered with
//  the runtime's text checks; globalAlpha multiplies instead of resetting; the tiny TeX gains radicals and drawn
//  relations; plots take a camera in math units (cam: { z, p, to }) and choose their ticks and grid by zoom; the
//  corner section tag became a heading placed by the scene (a label in a frame corner is a banned default);
//  captions keep out of the Duet presenter's corner; the morph-chain renderer's hooks (window, heroPts) are gone.
//
//  Give each quantity one colour and keep it everywhere: formula, figure, labels, readouts, captions.
// =====================================================================
FLPT.style('math', {
  tokens: {
    paper: '#0E0E10', ink: '#FFFFFF', font: 'STIX Two Text', weight: 400,
    red: '#FC6255', green: '#83C167', yellow: '#F7D96F', blue: '#58C4DD', grey: '#BBBBBB', pi: '#2E86AB',
  },
  fonts: [
    { family: 'STIX Two Text', file: 'STIXTwoText.ttf', weight: 400 },
    { family: 'STIX Two Text', file: 'STIXTwoText-Italic.ttf', weight: 400, style: 'italic' },
  ],
  ones: true,
  make(env) {
    const { W, H, clamp, lerp, fnv } = env;
    const TAU = Math.PI * 2;
    let X = null, g = null, TT = 0, F = 0, SC = 1;   // bound per frame

    // ---- palette: manim's colour constants (a value is what the colour usually means in a piece)
    const MC = Object.freeze({
      bg: '#0E0E10',
      white: '#FFFFFF', greyA: '#DDDDDD', grey: '#BBBBBB', greyC: '#888888', greyD: '#444444', greyE: '#222222',
      blue: '#58C4DD', blueD: '#29ABCA', blueE: '#1C758A',
      teal: '#5CD0B3', green: '#83C167', yellow: '#F7D96F', yellowP: '#FFFF00', gold: '#F0AC5F',
      red: '#FC6255', maroon: '#C55F73', purple: '#9A72AC', pink: '#D147BD', orange: '#FF862F',
      pi: '#2E86AB', piD: '#1C5A75',
    });
    /** The serif stack (STIX Two Text, bundled), for your own ctx.text. */
    const SERIF = '"STIX Two Text", "Times New Roman", serif';
    const fontAt = (size, it) => `${it ? 'italic ' : ''}400 ${size}px ${SERIF}`;
    const F100 = fontAt(100, false), I100 = fontAt(100, true);

    // ---- easing: manim's rate functions
    const sigM = (x) => 1 / (1 + Math.exp(-x));
    /** manim's smooth: a sigmoid with inflection 10, 0..1. */
    const smoothM = (u) => { u = clamp(u); return (sigM(10 * (u - 0.5)) - sigM(-5)) / (sigM(5) - sigM(-5)); };
    /** manim's there_and_back: up and down again over 0..1. */
    const thereBack = (u) => smoothM(u < 0.5 ? 2 * u : 2 - 2 * u);
    /** The smooth progress of a play(..., run_time=d) that starts at t0. */
    const runS = (t0, d = 1) => smoothM((TT - t0) / d);
    /** LaggedStart: the progress of item i of n when the group's progress is p. */
    const lagged = (p, i, n, lag = 0.5) => { if (n <= 1) return clamp(p); const span = 1 / (1 + lag * (n - 1)); return clamp((p - i * lag * span) / span); };
    /** A keyframed value [[t, v], ...], smooth between keys (absolute times). */
    function keysM(ks, t = TT) {
      if (t <= ks[0][0]) return ks[0][1];
      for (let i = 1; i < ks.length; i++) if (t < ks[i][0]) return lerp(ks[i - 1][1], ks[i][1], smoothM((t - ks[i - 1][0]) / (ks[i][0] - ks[i - 1][0])));
      return ks[ks.length - 1][1];
    }
    /** A colour with alpha: rgbaM('#FC6255', 0.3). */
    const rgbaM = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
    /** Blend two hex colours. */
    function mixHex(a, b, u) {
      if (a === b || u <= 0) return a; if (u >= 1) return b;
      const p = parseInt(a.slice(1), 16), q = parseInt(b.slice(1), 16), c = (s) => Math.round(lerp((p >> s) & 255, (q >> s) & 255, u));
      return '#' + ((1 << 24) + (c(16) << 16) + (c(8) << 8) + c(0)).toString(16).slice(1);
    }
    /** A number at d decimals with a true minus sign. */
    const fmtNum = (v, d = 2) => (v < -0.5 * 10 ** -d ? '−' : '') + Math.abs(v).toFixed(d);

    // ---- geometry
    const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
    function pathLen(P) { let L = 0; for (let i = 1; i < P.length; i++) L += dist(P[i - 1], P[i]); return L; }
    /** The first frac of a polyline (a ShowCreation sweep). */
    function subPath(P, frac) {
      let want = pathLen(P) * clamp(frac);
      const out = [P[0]];
      for (let i = 1; i < P.length; i++) { const d = dist(P[i - 1], P[i]); if (want >= d) { out.push(P[i]); want -= d; } else { const k = want / (d || 1); out.push([lerp(P[i - 1][0], P[i][0], k), lerp(P[i - 1][1], P[i][1], k)]); break; } }
      return out;
    }
    /** Points on an ellipse (a full turn by default). */
    function ellipsePts(cx, cy, rx, ry, rot = 0, n = 96, a0 = 0, a1 = TAU) {
      const P = [], c = Math.cos(rot), s = Math.sin(rot), full = Math.abs(a1 - a0 - TAU) < 1e-6;
      for (let i = 0; i < n; i++) { const a = a0 + ((a1 - a0) * i) / (full ? n : n - 1), x = Math.cos(a) * rx, y = Math.sin(a) * ry; P.push([cx + x * c - y * s, cy + x * s + y * c]); }
      return P;
    }
    /** Points on an arc from screen angle a0 to a1. */
    function arcPts(cx, cy, r, a0, a1, n = 28) { const P = []; for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; P.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return P; }
    /** The centre of a list of points. */
    const centroid = (P) => [P.reduce((s, p) => s + p[0], 0) / P.length, P.reduce((s, p) => s + p[1], 0) / P.length];
    function bboxOf(P) { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of P) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; } return { x0, y0, x1, y1 }; }
    /** A world point on screen (scene units), through the canvas's current transform. */
    function toScreen(x, y) { const m = g.getTransform(); return [(m.a * x + m.c * y + m.e) / SC, (m.b * x + m.d * y + m.f) / SC]; }
    /** The screen box (scene units) of a rectangle under the current transform. */
    function screenBox(x0, y0, x1, y1) {
      const m = g.getTransform();
      let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
      for (const [px, py] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) { const sx = (m.a * px + m.c * py + m.e) / SC, sy = (m.b * px + m.d * py + m.f) / SC; a = Math.min(a, sx); b = Math.min(b, sy); c = Math.max(c, sx); d = Math.max(d, sy); }
      return { x: a, y: b, w: c - a, h: d - b };
    }
    /** Fill the whole frame with a colour (screen space). */
    function fillAll(color) { g.save(); X.screen(); g.fillStyle = color; g.fillRect(0, 0, W, H); g.restore(); }
    /** A straight-edged closed path (squares and triangles keep their corners). */
    function polyPath(P) { g.beginPath(); P.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); }
    function strokePts(P) { g.beginPath(); P.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); }

    // ---- type: STIX Two Text from its outlines, laid out at 100 px and scaled (kerning kept), so any size is exact
    const RUNS = new Map();
    function runOf(str, it) {
      const key = (it ? 'i|' : 'r|') + str;
      let r = RUNS.get(key);
      if (r) return r;
      const f = it ? I100 : F100, chars = [...str], xs = [];
      for (let i = 0; i < chars.length; i++) xs.push(env.measure(chars.slice(0, i + 1).join(''), f).w - env.measure(chars[i], f).w);
      const m = env.measure(str, f);
      r = { chars, xs, w: m.w, asc: m.asc, desc: m.desc };
      if (RUNS.size > 4000) RUNS.clear();
      RUNS.set(key, r);
      return r;
    }
    /** The width of a string at a size (o.it: italic). */
    function textW(str, size, o = {}) { return runOf(String(str), !!o.it).w * size / 100; }
    // one glyph mid-Write at (x, y): pi 0..1, the outline draws on over the first half, the fill comes up over the second
    function writeGlyph(ch, x, y, size, c, it, pi, alpha) {
      if (pi <= 0 || alpha <= 0 || ch === ' ') return;
      const s = size / 100, A = g.globalAlpha, dashP = smoothM(pi * 2), fillA = smoothM(pi * 2 - 1);
      const tp = FLPT.lib.textPath(ch, it ? I100 : F100);
      g.save(); g.translate(x, y); g.scale(s, s);
      if (!tp) { g.globalAlpha = A * alpha * clamp(pi * 2); env.fillText(g, ch, 0, 0, it ? I100 : F100); g.restore(); return; }
      if (fillA < 1 && dashP > 0.002) {
        g.globalAlpha = A * alpha * (1 - fillA * 0.85);
        g.setLineDash([dashP * 400, 1e5]); g.lineWidth = Math.max(1.2 / s, 2.2); g.strokeStyle = c; g.lineJoin = 'round'; g.lineCap = 'round';
        g.stroke(tp.path); g.setLineDash([]);
      }
      if (fillA > 0) { g.globalAlpha = A * alpha * fillA; g.fillStyle = c; g.fill(tp.path); }
      g.restore();
    }
    function drawRun(run, x, y, size, c, it, pi, alpha) { const s = size / 100; run.chars.forEach((ch, k) => writeGlyph(ch, x + run.xs[k] * s, y, size, c, it, pi, alpha)); }
    /**
     * manim Write. segs: a string or [{ s, c, it }]. p: 0..1 (use runS). o: color, align, alpha, lag (about 1.4), it,
     * id (false: not registered). Registers the line's box with the text checks. Returns the width.
     */
    function writeText(segs, x, y, size, p, o = {}) {
      if (typeof segs === 'string') segs = [{ s: segs, c: o.color || MC.white }];
      const s = size / 100, parts = [];
      let tw = 0, asc = 0, desc = 0, str = '';
      for (const sg of segs) {
        const it = sg.it ?? !!o.it, r = runOf(String(sg.s), it);
        parts.push({ r, it, c: sg.c || o.color || MC.white, x: tw });
        tw += r.w * s; asc = Math.max(asc, r.asc * s); desc = Math.max(desc, r.desc * s); str += sg.s;
      }
      const x0 = o.align === 'left' ? x : o.align === 'right' ? x - tw : x - tw / 2, alpha = o.alpha ?? 1, L = o.lag ?? 1.4;
      if (p <= 0 || alpha <= 0) return tw;
      const vis = [];
      for (const pt of parts) pt.r.chars.forEach((ch, k) => { if (ch !== ' ') vis.push({ ch, x: x0 + pt.x + pt.r.xs[k] * s, c: pt.c, it: pt.it }); });
      const n = vis.length;
      vis.forEach((v, i) => writeGlyph(v.ch, v.x, y, size, v.c, v.it, clamp(p * (1 + L) - (L * i) / Math.max(1, n - 1)), alpha));
      if (o.id !== false && str.trim()) env.registerBox(o.id ?? str, str, screenBox(x0, y - asc, x0 + tw, y + desc));
      return tw;
    }
    /** Text already written (no Write). */
    function mText(segs, x, y, size, o = {}) { return writeText(segs, x, y, size, (o.alpha ?? 1) > 0 ? 1 : 0, o); }

    // ---- typesetting: a tiny TeX. A formula is a list of tokens:
    //   '+', '=', '−', '<', '×', '·', '→', '≤', '≥', '≠', '≈'   operators and relations (TeX's spacing; the last five are drawn)
    //   mv('a', MC.red, { sup: '2', id: 'a', supId: 'n' })          an italic variable (mn: upright, for digits and cos, sin);
    //                                                                supId gives the exponent its own id (the power rule)
    //   { frac: [numTokens, denTokens], c, id }                      a fraction with a bar
    //   { sqrt: tokens, c, id }                                      a radical over its tokens
    //   { sp: 0.3 }                                                  extra space, in ems
    // Every token has an id (default: its text and the occurrence); transformTex matches tokens by id.
    /** An italic variable token. o: sup, sub, supC, subC, supIt, subIt, id, supId. */
    const mv = (s, c = MC.white, o = {}) => ({ s, c, it: true, ...o });
    /** An upright token (digits, function names, units). */
    const mn = (s, c = MC.white, o = {}) => ({ s, c, it: false, ...o });
    const OPS = '+=−-<>×·→≤≥≠≈∝';
    const DRAWN = '→≤≥≠≈';
    const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', n: 'ⁿ', '+': '⁺', '−': '⁻' };
    const supStr = (s) => ([...s].every((ch) => SUP[ch]) ? [...s].map((ch) => SUP[ch]).join('') : '^' + s);
    // the strokes of a drawn relation, in ems from its pen start on the baseline (axis at -0.26 em)
    function symStrokes(ch, w) {
      const a = -0.26, m = w / 2;
      if (ch === '→') return [[[0.06, a], [w - 0.06, a]], [[w - 0.24, a - 0.15], [w - 0.06, a], [w - 0.24, a + 0.15]]];
      if (ch === '≤') return [[[m + 0.22, a - 0.25], [m - 0.22, a - 0.06], [m + 0.22, a + 0.13]], [[m - 0.22, a + 0.26], [m + 0.22, a + 0.26]]];
      if (ch === '≥') return [[[m - 0.22, a - 0.25], [m + 0.22, a - 0.06], [m - 0.22, a + 0.13]], [[m - 0.22, a + 0.26], [m + 0.22, a + 0.26]]];
      if (ch === '≠') return [[[m - 0.26, a - 0.1], [m + 0.26, a - 0.1]], [[m - 0.26, a + 0.1], [m + 0.26, a + 0.1]], [[m + 0.13, a - 0.3], [m - 0.13, a + 0.3]]];
      const wave = (dy) => { const P = []; for (let i = 0; i <= 16; i++) { const u = i / 16; P.push([m - 0.27 + 0.54 * u, a + dy - 0.05 * Math.sin(u * TAU)]); } return P; };
      return [wave(-0.09), wave(0.11)];
    }
    const LAYOUTS = new Map();
    // a laid-out item moved by (dx, dy): its pen position and any stroke points
    const shiftItem = (gi, dx, dy) => ({
      ...gi, x: gi.x + dx, y: gi.y + dy,
      ...(gi.pts ? { pts: gi.pts.map(([px, py]) => [px + dx, py + dy]) } : {}),
      ...(gi.strokes ? { strokes: gi.strokes.map((P) => P.map(([px, py]) => [px + dx, py + dy])) } : {}),
    });
    function texLayout(toks, size) {
      const key = size + '|' + JSON.stringify(toks);
      const hit = LAYOUTS.get(key);
      if (hit) return hit;
      const items = [], seen = {}, words = [];
      let x = 0, yTop = -size * 0.75, yBot = size * 0.25;
      const add = (s, gx, gy, gs, c, it, id) => {
        const r = runOf(s, it), k = gs / 100;
        items.push({ ch: s, run: r, x: gx, y: gy, size: gs, c, it, id, w: r.w * k, asc: r.asc * k, desc: r.desc * k });
        return r.w * k;
      };
      for (let t of toks) {
        if (typeof t === 'string') t = { s: t === '-' ? '−' : t, it: false, op: OPS.includes(t) };
        if (t.sp != null) { x += t.sp * size; if (t.sp >= 0.05) words.push(' '); continue; }
        const base = t.frac ? 'frac' : t.sqrt ? 'sqrt' : t.s, id = t.id ?? (base + '#' + (seen[base] = (seen[base] ?? -1) + 1));
        const c = t.c || MC.white;
        if (t.frac) {
          const fs = size * 0.8, num = texLayout(t.frac[0], fs), den = texLayout(t.frac[1], fs), bw = Math.max(num.w, den.w) + size * 0.24, axis = -size * 0.26;
          x += size * 0.08;
          for (const gi of num.items) items.push({ ...shiftItem(gi, x + (bw - num.w) / 2, axis - size * 0.2), id });
          items.push({ bar: true, pts: [[x, axis], [x + bw, axis]], c, id, w: bw, size, x, y: axis });
          for (const gi of den.items) items.push({ ...shiftItem(gi, x + (bw - den.w) / 2, axis + size * 0.2 + fs * 0.72), id });
          yTop = Math.min(yTop, axis - size * 0.2 + num.yTop); yBot = Math.max(yBot, axis + size * 0.2 + fs * 0.72 + den.yBot);
          words.push(`${num.str}/${den.str}`);
          x += bw + size * 0.08; continue;
        }
        if (t.sqrt) {
          const inn = texLayout(t.sqrt, size), radTop = inn.yTop - size * 0.1, radBot = Math.max(inn.yBot, size * 0.08) + size * 0.04, x0 = x + size * 0.04, xi = x0 + size * 0.52;
          items.push({ rad: true, pts: [[x0, -size * 0.3], [x0 + size * 0.1, -size * 0.36], [x0 + size * 0.26, radBot], [x0 + size * 0.48, radTop], [xi + inn.w + size * 0.06, radTop]], c, id, size, x: x0, y: 0, w: xi + inn.w + size * 0.06 - x0 });
          for (const gi of inn.items) items.push({ ...shiftItem(gi, xi, 0), id });
          yTop = Math.min(yTop, radTop - size * 0.05); yBot = Math.max(yBot, radBot);
          words.push(`√(${inn.str})`);
          x = xi + inn.w + size * 0.14; continue;
        }
        const pad = t.op ? size * 0.22 : 0;
        x += pad;
        if (DRAWN.includes(t.s)) {
          const w = (t.s === '→' ? 0.95 : 0.62) * size, strokes = symStrokes(t.s, w / size).map((P) => P.map(([px, py]) => [x + px * size, py * size]));
          items.push({ sym: true, strokes, c, id, size, x, y: 0, w });
          x += w;
        } else x += add(t.s, x, 0, size, c, t.it, id) + (t.it ? size * 0.04 : 0);
        let adv = 0;   // a superscript and a subscript stack on the same spot
        if (t.sup) { adv = Math.max(adv, add(t.sup, x, -size * 0.42, size * 0.6, t.supC || c, !!t.supIt, t.supId ?? id)); yTop = Math.min(yTop, -size * 1.05); }
        if (t.sub) { adv = Math.max(adv, add(t.sub, x, size * 0.2, size * 0.6, t.subC || c, !!t.subIt, id)); yBot = Math.max(yBot, size * 0.4); }
        x += (adv ? adv + size * 0.03 : 0) + pad;
        words.push(t.op ? ` ${t.s} ` : t.s + (t.sup ? supStr(t.sup) : '') + (t.sub ? '_' + t.sub : ''));
      }
      const L = { items, w: x, yTop, yBot, str: words.join('').replace(/ {2,}/g, ' ').trim() };
      if (LAYOUTS.size > 600) LAYOUTS.clear();
      LAYOUTS.set(key, L);
      return L;
    }
    // draw one laid-out item at an offset: a glyph run (Write progress pi), or a stroke (a bar, a radical, a drawn relation)
    function drawItem(gi, dx, dy, c, pi, alpha) {
      if (gi.bar || gi.rad || gi.sym) {
        const u = smoothM(pi * 1.6);
        if (u <= 0 || alpha <= 0) return;
        g.save(); g.globalAlpha *= alpha; g.strokeStyle = c; g.lineWidth = Math.max(2, gi.size * 0.045); g.lineCap = 'round'; g.lineJoin = 'round';
        const list = gi.sym ? gi.strokes : [gi.pts];
        for (const P of list) strokePts(subPath(P.map(([px, py]) => [px + dx, py + dy]), u));
        g.restore();
        return;
      }
      drawRun(gi.run, gi.x + dx, gi.y + dy, gi.size, c, gi.it, pi, alpha);
    }
    /**
     * Write a formula at (x, y) (its baseline; centred unless o.align). p: Write progress. o: align, alpha, lag (about 1.2),
     * dim { id: alpha }, id (false: not registered). Returns the layout in screen space (items carry absolute x, y).
     */
    function writeTex(toks, x, y, size, p, o = {}) {
      const L = texLayout(toks, size), x0 = o.align === 'left' ? x : o.align === 'right' ? x - L.w : x - L.w / 2;
      const alpha = o.alpha ?? 1, lag = o.lag ?? 1.2, n = L.items.length;
      if (p > 0 && alpha > 0) {
        L.items.forEach((gi, i) => drawItem(gi, x0, y, gi.c, clamp(p * (1 + lag) - (lag * i) / Math.max(1, n - 1)), alpha * (o.dim?.[gi.id] ?? 1)));
        if (o.id !== false && L.str) env.registerBox(o.id ?? L.str, L.str, screenBox(x0, y + L.yTop, x0 + L.w, y + L.yBot));
      }
      return { ...L, x0, y, items: L.items.map((gi) => ({ ...gi, x: x0 + gi.x, y: y + gi.y })) };
    }
    /** The width of a formula at a size. */
    const texW = (toks, size) => texLayout(toks, size).w;
    /** The box of the terms with id `id` in a layout from writeTex: { x0, x1, y0, y1, cx, cy } (for a Flash, brace or arrow). */
    function texBox(lay, id) {
      const its = lay.items.filter((gi) => gi.id === id);
      if (!its.length) return null;
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const gi of its) {
        if (gi.pts || gi.strokes) { for (const P of gi.strokes || [gi.pts]) for (const [px, py] of P) { const ax = px + lay.x0, ay = py + lay.y; x0 = Math.min(x0, ax); x1 = Math.max(x1, ax); y0 = Math.min(y0, ay); y1 = Math.max(y1, ay); } continue; }
        x0 = Math.min(x0, gi.x); x1 = Math.max(x1, gi.x + gi.w); y0 = Math.min(y0, gi.y - gi.size * 0.72); y1 = Math.max(y1, gi.y + gi.size * 0.22);
      }
      return { x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
    }
    /**
     * Transform one formula into another (manim TransformMatchingTex): terms with the same id and text glide from their
     * place in A to their place in B (colour and size blend); a group whose text differs cross-fades while it moves; the
     * rest fade. u: 0..1 (raw progress; smoothed here). o: align, alpha, id, lift { id: px } (that term travels over an
     * arc, up by px at the middle: an exponent coming down in front clears its base).
     */
    function transformTex(A, B, x, y, size, u, o = {}) {
      const LA = texLayout(A, size), LB = texLayout(B, size), alpha = o.alpha ?? 1;
      const xa = o.align === 'left' ? x : o.align === 'right' ? x - LA.w : x - LA.w / 2, xb = o.align === 'left' ? x : o.align === 'right' ? x - LB.w : x - LB.w / 2, s = smoothM(u);
      const groups = (L) => { const m = {}; for (const gi of L.items) (m[gi.id] = m[gi.id] || []).push(gi); return m; };
      const GA = groups(LA), GB = groups(LB);
      const ctr = (gs, x0) => { const b = bboxOf(gs.map((gi) => [x0 + gi.x + (gi.w || 0) / 2, y + gi.y])); return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]; };
      const text = (gs) => gs.map((gi) => (gi.bar ? '/' : gi.rad ? '√' : gi.sym ? 'sym' : gi.ch)).join('');
      if (alpha > 0) for (const id of new Set([...Object.keys(GA), ...Object.keys(GB)])) {
        const a = GA[id], b = GB[id];
        if (a && b) {
          const ca = ctr(a, xa), cb = ctr(b, xb);
          const lift = (o.lift && o.lift[id]) || 0;
          if (text(a) === text(b) && a.length === b.length) a.forEach((gi, i) => { const bi = b[i], k = lerp(1, bi.size / gi.size, s); g.save(); const px = lerp(xa + gi.x, xb + bi.x, s), py = lerp(y + gi.y, y + bi.y, s) - lift * Math.sin(Math.PI * s); g.translate(px, py); g.scale(k, k); drawItem({ ...gi, x: 0, y: 0, pts: gi.pts && gi.pts.map(([qx, qy]) => [qx - gi.x, qy - gi.y]), strokes: gi.strokes && gi.strokes.map((P) => P.map(([qx, qy]) => [qx - gi.x, qy - gi.y])) }, 0, 0, mixHex(gi.c, bi.c, s), 1, alpha); g.restore(); });
          else {
            a.forEach((gi) => drawItem(gi, xa + (cb[0] - ca[0]) * s, y + (cb[1] - ca[1]) * s, gi.c, 1, alpha * (1 - clamp(s * 1.6))));
            b.forEach((gi) => drawItem(gi, xb + (ca[0] - cb[0]) * (1 - s), y + (ca[1] - cb[1]) * (1 - s), gi.c, 1, alpha * clamp(s * 1.6 - 0.6)));
          }
        } else if (a) a.forEach((gi) => drawItem(gi, xa, y, gi.c, 1, alpha * (1 - clamp(s * 2))));
        else b.forEach((gi) => drawItem(gi, xb, y, gi.c, 1, alpha * clamp(s * 2 - 1)));
      }
      const L = s < 0.5 ? LA : LB, x0 = s < 0.5 ? xa : xb;
      if (o.id !== false && alpha > 0 && L.str) env.registerBox(o.id ?? L.str, L.str, screenBox(Math.min(xa, xb), y + Math.min(LA.yTop, LB.yTop), Math.max(xa + LA.w, xb + LB.w), y + Math.max(LA.yBot, LB.yBot)));
      return { ...L, x0, y, items: L.items.map((gi) => ({ ...gi, x: x0 + gi.x, y: y + gi.y })) };
    }

    // ---- strokes and marks (in whatever coordinates the canvas's transform says)
    /** A line drawn on from (x1, y1): p 0..1, al its alpha. */
    function segLine(x1, y1, x2, y2, c, w = 4, p = 1, al = 1) {
      if (p <= 0 || al <= 0) return;
      g.save(); g.globalAlpha *= al; g.strokeStyle = c; g.lineWidth = w; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(lerp(x1, x2, p), lerp(y1, y2, p)); g.stroke(); g.restore();
    }
    /** ShowCreation of an outline: the stroke sweeps along P; with o.fill the fill then fades up. o: c, w, closed, fill, fillC, al, dash */
    function showCreation(P, p, o = {}) {
      if (p <= 0 || P.length < 2) return;
      const c = o.c || MC.white, al = o.al ?? 1, closed = !!o.closed;
      g.save(); g.lineJoin = 'round'; g.lineCap = 'round';
      const A = g.globalAlpha;
      if (o.fill && p > 0.5) { g.globalAlpha = A * al * o.fill * smoothM((p - 0.5) * 2); g.fillStyle = o.fillC || c; polyPath(P); g.fill(); }
      const Q = subPath(closed ? [...P, P[0]] : P, clamp(o.fill ? p * 2 : p));
      if (o.dash) g.setLineDash(o.dash);
      g.globalAlpha = A * al; g.strokeStyle = c; g.lineWidth = o.w ?? 4;
      strokePts(Q);
      g.restore();
    }
    /** A square standing on the segment (x1, y1) -> (x2, y2), on its left (side -1: its right). */
    function squareOn(x1, y1, x2, y2, side = 1) { const dx = x2 - x1, dy = y2 - y1, nx = dy * side, ny = -dx * side; return [[x1, y1], [x2, y2], [x2 + nx, y2 + ny], [x1 + nx, y1 + ny]]; }
    /** The n x n unit cells inside a quad from squareOn, as thin lines. */
    function cellGrid(Q, n, c, al = 0.5, w = 1.5) {
      if (al <= 0) return;
      g.save(); g.globalAlpha *= al; g.strokeStyle = c; g.lineWidth = w; g.beginPath();
      for (let i = 1; i < n; i++) {
        const k = i / n;
        g.moveTo(lerp(Q[0][0], Q[1][0], k), lerp(Q[0][1], Q[1][1], k)); g.lineTo(lerp(Q[3][0], Q[2][0], k), lerp(Q[3][1], Q[2][1], k));
        g.moveTo(lerp(Q[0][0], Q[3][0], k), lerp(Q[0][1], Q[3][1], k)); g.lineTo(lerp(Q[1][0], Q[2][0], k), lerp(Q[1][1], Q[2][1], k));
      }
      g.stroke(); g.restore();
    }
    /** A filled dot. */
    function mDot(x, y, r, c, al = 1) { if (al <= 0 || r <= 0) return; g.save(); g.globalAlpha *= al; g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); g.restore(); }
    /** A soft halo (for the tracking dot only). */
    function glowAt(x, y, r, c, a) {
      if (a <= 0 || r <= 0) return;
      g.save(); const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, rgbaM(c, a)); gr.addColorStop(1, rgbaM(c, 0));
      g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); g.restore();
    }
    /** An arrow drawn on: the shaft grows and the tip rides its end. */
    function mArrow(x1, y1, x2, y2, c, w = 4, p = 1, al = 1) {
      if (p <= 0 || al <= 0) return;
      const a = Math.atan2(y2 - y1, x2 - x1), hs = 10 + w * 2.4, xe = lerp(x1, x2, p), ye = lerp(y1, y2, p);
      segLine(x1, y1, xe - Math.cos(a) * hs * 0.6, ye - Math.sin(a) * hs * 0.6, c, w, 1, al);
      g.save(); g.globalAlpha *= al; g.fillStyle = c; g.beginPath(); g.moveTo(xe, ye);
      g.lineTo(xe - hs * Math.cos(a - 0.42), ye - hs * Math.sin(a - 0.42)); g.lineTo(xe - hs * Math.cos(a + 0.42), ye - hs * Math.sin(a + 0.42));
      g.closePath(); g.fill(); g.restore();
    }
    /**
     * A curly brace beside the segment (x1, y1) -> (x2, y2), bulging to its left (o.side -1: its right), growing from the
     * middle. o: c, w, h (depth), p, al, label (tokens), size, lp (the label's Write). Returns the tip point.
     */
    function mBrace(x1, y1, x2, y2, o = {}) {
      const L = Math.hypot(x2 - x1, y2 - y1), a = Math.atan2(y2 - y1, x2 - x1), side = o.side ?? 1, h = o.h ?? 22, p = smoothM(o.p ?? 1), al = o.al ?? 1;
      const nx = Math.sin(a) * side, ny = -Math.cos(a) * side, tip = [(x1 + x2) / 2 + nx * h * 1.15, (y1 + y2) / 2 + ny * h * 1.15];
      if (p <= 0 || al <= 0) return tip;
      g.save(); g.translate((x1 + x2) / 2, (y1 + y2) / 2); g.rotate(a); g.scale(p, side);
      g.globalAlpha *= al; g.strokeStyle = o.c || MC.white; g.lineWidth = o.w ?? 3.5; g.lineCap = 'round'; g.lineJoin = 'round';
      const m = L / 2;
      g.beginPath(); g.moveTo(-m, 0); g.quadraticCurveTo(-m, -h / 2, -m + 14, -h / 2); g.lineTo(-12, -h / 2); g.quadraticCurveTo(-2, -h / 2, 0, -h);
      g.quadraticCurveTo(2, -h / 2, 12, -h / 2); g.lineTo(m - 14, -h / 2); g.quadraticCurveTo(m, -h / 2, m, 0); g.stroke();
      g.restore();
      if (o.label) { const sz = o.size ?? 44; writeTex(o.label, tip[0] + nx * sz * 0.75, tip[1] + ny * sz * 0.75 + sz * 0.3, sz, o.lp ?? 1, { alpha: al }); }
      return tip;
    }
    /** The little square that marks a right angle at (x, y) between unit directions d1 and d2. */
    function rightAngle(x, y, d1, d2, s, c = MC.white, al = 1) {
      if (al <= 0) return;
      g.save(); g.globalAlpha *= al; g.strokeStyle = c; g.lineWidth = 3; g.beginPath();
      g.moveTo(x + d1[0] * s, y + d1[1] * s); g.lineTo(x + (d1[0] + d2[0]) * s, y + (d1[1] + d2[1]) * s); g.lineTo(x + d2[0] * s, y + d2[1] * s); g.stroke(); g.restore();
    }
    /** An angle arc at (x, y) from screen angle a0 to a1, drawn on with p. */
    function angleArc(x, y, r, a0, a1, c, p = 1, w = 4) { if (p > 0) showCreation(arcPts(x, y, r, a0, lerp(a0, a1, p), 28), 1, { c, w }); }
    /** manim Flash: 12 short lines burst outward and go, for a point or a lone glyph. u: 0..1 over its run time (about 0.45 s). */
    function flashAt(x, y, u, c = MC.yellowP, r = 34, w = 4) {
      if (u <= 0 || u >= 1) return;
      const r0 = r + r * 1.3 * smoothM(u), r1 = r + r * 2.5 * smoothM(u * 1.4);
      for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU; segLine(x + r0 * Math.cos(a), y + r0 * Math.sin(a), x + r1 * Math.cos(a), y + r1 * Math.sin(a), c, w, 1, 1 - u); }
    }
    /** manim Indicate: a there-and-back scale for a term (apply around its centre). */
    const indicateS = (u, k = 0.2) => 1 + k * thereBack(clamp(u));
    /** manim SurroundingRectangle, drawn on around a box from texBox: p 0..1. o: c, w, pad, al */
    function surround(b, p, o = {}) {
      if (!b || p <= 0) return;
      const pad = o.pad ?? 14, x0 = b.x0 - pad, y0 = b.y0 - pad, x1 = b.x1 + pad, y1 = b.y1 + pad;
      showCreation([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]], p, { c: o.c || MC.yellow, w: o.w ?? 4, al: o.al ?? 1 });
    }
    /**
     * manim Circumscribe: a box runs round a term (a box from texBox) and is gone again, its head leading its tail.
     * u: 0..1 over about 0.9 s. The way to flash a term inside a line: a Flash's rays would strike through its
     * neighbours. o: c (yellowP), w, pad, al
     */
    function circumscribe(b, u, o = {}) {
      if (!b || u <= 0 || u >= 1) return;
      const pad = o.pad ?? 12, x0 = b.x0 - pad, y0 = b.y0 - pad, x1 = b.x1 + pad, y1 = b.y1 + pad;
      const P = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]], head = subPath(P, smoothM(u * 2));
      let cut = pathLen(P) * smoothM(u * 2 - 1);
      const Q = [];
      for (let i = 1; i < head.length; i++) {
        const d = dist(head[i - 1], head[i]);
        if (!Q.length) { if (cut >= d) { cut -= d; continue; } const k = cut / (d || 1); Q.push([lerp(head[i - 1][0], head[i][0], k), lerp(head[i - 1][1], head[i][1], k)]); }
        Q.push(head[i]);
      }
      if (Q.length < 2) return;
      g.save(); g.globalAlpha *= o.al ?? 1; g.strokeStyle = o.c || MC.yellowP; g.lineWidth = o.w ?? 4; g.lineJoin = 'round'; g.lineCap = 'round';
      strokePts(Q); g.restore();
    }
    /** A shape the way manim draws a Transform: a coloured stroke over a translucent fill (morph with ctx.morph). */
    function blob(P, c, o = {}) {
      g.save(); polyPath(P); g.globalAlpha *= (o.al ?? 1) * (o.fill ?? 0.32); g.fillStyle = c; g.fill(); g.restore();
      g.save(); polyPath(P); g.globalAlpha *= o.al ?? 1; g.strokeStyle = c; g.lineWidth = o.w ?? 6; g.lineJoin = 'round'; g.stroke(); g.restore();
    }

    // ---- planes, axes, graphs. A plane maps math units to the screen. o: at [sx, sy] (the origin on screen at zoom 1),
    //      u (px per unit) or ux, uy, cam { z, p: [mx, my], to: [sx, sy] } (math point p on screen at to, zoom z; to
    //      defaults to where p sits at zoom 1). Strokes stay their width at any zoom: that's why plots map, not scale.
    /** A plane mapper: { to(x, y), from(sx, sy), ux, uy, ox, oy, z, view: { x0, x1, y0, y1 } (the visible math box) }. */
    function plane(o = {}) {
      const at = o.at ?? [W / 2, H / 2], ux0 = o.ux ?? o.u ?? 100, uy0 = o.uy ?? o.u ?? 100, c = o.cam;
      let ox = at[0], oy = at[1], z = 1;
      if (c) {
        z = c.z ?? 1;
        const p = c.p ?? [0, 0], to = c.to ?? [at[0] + p[0] * ux0, at[1] - p[1] * uy0];
        ox = to[0] - p[0] * ux0 * z; oy = to[1] + p[1] * uy0 * z;
      }
      const ux = ux0 * z, uy = uy0 * z;
      const to = (x, y) => [ox + x * ux, oy - y * uy], from = (sx, sy) => [(sx - ox) / ux, (oy - sy) / uy];
      const clip = o.clip ?? { x: 0, y: 0, w: W, h: H };
      const [vx0, vy1] = from(clip.x, clip.y), [vx1, vy0] = from(clip.x + clip.w, clip.y + clip.h);
      return { ox, oy, ux, uy, z, to, from, x: o.x ?? [-1, 1], y: o.y ?? [-1, 1], view: { x0: vx0, x1: vx1, y0: vy0, y1: vy1 } };
    }
    const NICE = [1, 2, 5];
    /** The smallest 1-2-5 step whose spacing on screen is at least minPx. */
    function niceStep(pxPerUnit, minPx) { let e = Math.floor(Math.log10(minPx / pxPerUnit)) - 1; for (;;) { for (const m of NICE) { const s = m * 10 ** e; if (s * pxPerUnit >= minPx) return s; } e++; } }
    /** The next finer 1-2-5 step (1 -> 0.5, 2 -> 1, 5 -> 2). */
    function finerStep(s) { const e = Math.floor(Math.log10(s) + 1e-9), m = Math.round(s / 10 ** e); return m === 1 ? 0.5 * 10 ** e : m === 2 ? 10 ** e : 2 * 10 ** e; }
    const decimalsOf = (s) => { let d = 0; while (d < 8 && Math.abs(Math.round(s * 10 ** d) - s * 10 ** d) > 1e-6) d++; return d; };
    /**
     * Axes, swept on, ticks after the lines and labels after the ticks. o: as plane(), plus x [min, max], y [min, max]
     * (the drawn range), ext (past the range, in units), p, c, w, step (a number or 'auto' by zoom), tick (half-length
     * px), ystep (the y axis's own fixed step), labels (font size or 0), dp, tips, al. Returns the plane mapper.
     */
    function axes2(o = {}) {
      const A = plane(o), [x0, x1] = A.x, [y0, y1] = A.y;
      const p = o.p ?? 1, al = o.al ?? 1, c = o.c || MC.grey, w = o.w ?? 3, ext = o.ext ?? 0.25, V = A.view, mx = (V.x1 - V.x0) * 0.05, my = (V.y1 - V.y0) * 0.05;
      if (p <= 0 || al <= 0) return A;
      const ex = lagged(p, 0, 2, 0.4), ey = lagged(p, 1, 2, 0.4);
      const cx = (v) => Math.max(V.x0 - mx, Math.min(V.x1 + mx, v)), cy = (v) => Math.max(V.y0 - my, Math.min(V.y1 + my, v));
      const [ax0, ay] = A.to(cx(x0 - ext), 0), [ax1] = A.to(cx(x1 + ext), 0), [axx, ay0] = A.to(0, cy(y0 - ext)), [, ay1] = A.to(0, cy(y1 + ext));
      if (y0 <= 0 && y1 >= 0) segLine(ax0, ay, ax1, ay, c, w, smoothM(ex), al);
      if (x0 <= 0 && x1 >= 0) segLine(axx, ay0, axx, ay1, c, w, smoothM(ey), al);
      if (o.tips !== false) {
        if (ex > 0.98 && x1 + ext <= V.x1) mArrow(ax1 - 1, ay, ax1 + 14, ay, c, w, 1, al);
        if (ey > 0.98 && y1 + ext <= V.y1) mArrow(axx, ay1 + 1, axx, ay1 - 14, c, w, 1, al);
      }
      const ta = al * smoothM((p - 0.5) * 2);
      if (ta <= 0) return A;
      const tk = o.tick ?? 10, lab = o.labels ?? 0, auto = o.step === 'auto';
      // a fixed step, or by zoom: the 1-2-5 step that is at least minPx apart, and the next finer one fading in below it
      const levels = (minPx, fadePx) => {
        if (!auto) return [{ s: o.step ?? 1, a: 1 }];
        const s = niceStep(A.ux, minPx), f = finerStep(s);
        return [{ s, a: 1 }, { s: f, a: clamp((f * A.ux - (minPx - fadePx)) / fadePx) }];
      };
      const marks = (list, draw) => {
        const done = new Set();
        for (const { s: s0, a } of list) {
          if (a <= 0.003) continue;
          const axis = (v0, v1, horiz) => {
            const s = !horiz && !auto && o.ystep ? o.ystep : s0, dp = o.dp ?? decimalsOf(s);
            for (let k = Math.ceil(v0 / s - 1e-9); k * s <= v1 + 1e-9; k++) {
              const v = +(k * s).toFixed(10), key = (horiz ? 'x' : 'y') + v.toFixed(8);
              if (Math.abs(v) < s * 1e-6 || done.has(key)) continue;
              done.add(key);
              draw(v, horiz, a, dp);
            }
          };
          if (y0 <= 0 && y1 >= 0) axis(Math.max(x0, V.x0 - mx), Math.min(x1, V.x1 + mx), true);
          if (x0 <= 0 && x1 >= 0) axis(Math.max(y0, V.y0 - my), Math.min(y1, V.y1 + my), false);
        }
      };
      const tickAt = (v, horiz, a) => { if (horiz) { const [x, y] = A.to(v, 0); segLine(x, y - tk, x, y + tk, c, 2.5, 1, ta * a); } else { const [x, y] = A.to(0, v); segLine(x - tk, y, x + tk, y, c, 2.5, 1, ta * a); } };
      marks(levels(60, 30), tickAt);
      if (lab) marks(levels(lab * 4.5, lab * 2), (v, horiz, a, dp) => {
        const id = o.ids === false ? false : undefined;
        if (auto) tickAt(v, horiz, a);
        if (horiz) { const [x, y] = A.to(v, 0); mText(fmtNum(v, dp), x, y + tk + lab * 1.05, lab, { color: c, alpha: ta * a, id }); }
        else { const [x, y] = A.to(0, v); mText(fmtNum(v, dp), x - tk - lab * 0.35, y + lab * 0.35, lab, { color: c, alpha: ta * a, align: 'right', id }); }
      });
      return A;
    }
    /**
     * manim's NumberPlane: faint BLUE_D lines, brighter on whole steps, swept in from the centre out by p. With
     * o.zoom (the default) finer lines come up as the plane is zoomed, so the grid always reads. o: step, sub, p, al, x, y
     */
    function numberPlane(A, o = {}) {
      const p = o.p ?? 1, al = o.al ?? 1, step = o.step ?? 1, sub = o.sub ?? 2;
      if (p <= 0 || al <= 0) return;
      const V = A.view, [rx0, rx1] = o.x ?? A.x, [ry0, ry1] = o.y ?? A.y;
      const X0 = Math.max(rx0, V.x0), X1 = Math.min(rx1, V.x1), Y0 = Math.max(ry0, V.y0), Y1 = Math.min(ry1, V.y1);
      if (X1 <= X0 || Y1 <= Y0) return;
      const [sxa, sya] = A.to(X0, Y1), [sxb, syb] = A.to(X1, Y0);
      const levels = [];
      if (o.zoom === false) levels.push({ s: step, major: true, a: 1 }, { s: step / sub, major: false, a: 1 });
      else {
        // each tenth of the step comes up as the plane is zoomed, by its spacing on screen
        for (let k = 0, s = step; k < 5 && s * A.ux >= 18; k++, s /= 10) {
          const a = k === 0 ? 1 : clamp((s * A.ux - 80) / 160);
          if (a > 0.003) levels.push({ s, major: true, a });
          levels.push({ s: s / sub, major: false, a: a * clamp((s / sub * A.ux - 20) / 40) });
        }
      }
      const seen = new Set(), reach = Math.max(rx1 - rx0, ry1 - ry0) / 2 || 1;
      g.save(); g.lineCap = 'butt';
      for (const { s, major, a } of levels) {
        if (a <= 0.003) continue;
        const base = major ? 0.42 : 0.14;
        g.strokeStyle = MC.blueD; g.lineWidth = major ? 2 : 1.2;
        const line = (v, vert) => {
          const key = (vert ? 'v' : 'h') + v.toFixed(9);
          if (seen.has(key)) return;
          seen.add(key);
          const dk = Math.abs(v) / reach, la = al * base * a * smoothM(p * 2 - dk * 0.5);
          if (la <= 0.003) return;
          g.globalAlpha = la; g.beginPath();
          if (vert) { const [x] = A.to(v, 0); g.moveTo(x, sya); g.lineTo(x, syb); } else { const [, y] = A.to(0, v); g.moveTo(sxa, y); g.lineTo(sxb, y); }
          g.stroke();
        };
        for (let k = Math.ceil(X0 / s); k * s <= X1 + 1e-12; k++) line(k * s, true);
        for (let k = Math.ceil(Y0 / s); k * s <= Y1 + 1e-12; k++) line(k * s, false);
      }
      g.restore();
    }
    /** The graph of f over [x0, x1] on a plane, drawn on with p (sampled over the visible part, so zooms stay smooth). o: c, w, n, area, al */
    function graphM(A, f, x0, x1, p = 1, o = {}) {
      if (p <= 0) return [];
      const V = A.view, m = (V.x1 - V.x0) * 0.02, xe = lerp(x0, x1, clamp(p)), a = Math.max(x0, V.x0 - m), b = Math.min(xe, V.x1 + m);
      if (b <= a) return [];
      const n = o.n ?? 200, P = [];
      for (let i = 0; i <= n; i++) { const x = lerp(a, b, i / n), y = f(x); if (Number.isFinite(y)) P.push(A.to(x, y)); }
      if (P.length < 2) return P;
      if (o.area) {
        g.save(); g.globalAlpha *= (o.al ?? 1) * o.area; g.fillStyle = o.areaC || o.c || MC.blue; g.beginPath(); g.moveTo(P[0][0], A.oy);
        P.forEach(([x, y]) => g.lineTo(x, y)); g.lineTo(P[P.length - 1][0], A.oy); g.closePath(); g.fill(); g.restore();
      }
      g.save(); g.globalAlpha *= o.al ?? 1; g.strokeStyle = o.c || MC.blue; g.lineWidth = o.w ?? 5; g.lineJoin = 'round'; g.lineCap = 'round'; strokePts(P); g.restore();
      return P;
    }
    /** The slope of f at x (a central difference). */
    const slopeOf = (f, x, h = 1e-5) => (f(x + h) - f(x - h)) / (2 * h);
    /** The tangent to f at x on a plane: a segment len px long on screen, centred on the point, drawn out from it by p. o: c, w, al, dash */
    function tangent(A, f, x, len, p = 1, o = {}) {
      if (p <= 0) return null;
      const m = slopeOf(f, x), [px, py] = A.to(x, f(x)), dx = A.ux, dy = -m * A.uy, d = Math.hypot(dx, dy) || 1, k = (len / 2) * smoothM(p);
      const a = [px - (dx / d) * k, py - (dy / d) * k], b = [px + (dx / d) * k, py + (dy / d) * k];
      g.save(); g.globalAlpha *= o.al ?? 1; g.strokeStyle = o.c || MC.yellow; g.lineWidth = o.w ?? 4; g.lineCap = 'round'; if (o.dash) g.setLineDash(o.dash); strokePts([a, b]); g.restore();
      return { slope: m, a, b, at: [px, py] };
    }
    /** A dashed drop line from a point to the x-axis (o.y: to the y-axis too). */
    function dropLines(A, x, y, o = {}) {
      const [px, py] = A.to(x, y), [, oy] = A.to(x, 0), [ox] = A.to(0, y), al = o.al ?? 0.8;
      g.save(); g.setLineDash([8, 8]);
      if (o.x !== false) segLine(px, py, px, oy, o.c || MC.grey, 2.5, 1, al);
      if (o.y) segLine(px, py, ox, py, o.c || MC.grey, 2.5, 1, al);
      g.restore();
    }

    // ---- the tracking dot and its live readout (manim Dot + DecimalNumber with an updater)
    /** The tracking dot, with a small halo. o: r, al */
    function trackDot(x, y, c = MC.yellow, o = {}) { const al = o.al ?? 1, r = o.r ?? 12; glowAt(x, y, r * 3, c, 0.45 * al); mDot(x, y, r, c, al); }
    /** Writes  label = value  with the value in colour, re-typeset every frame. label: a string (italic) or tokens. o: c, lc, align, p, al, id */
    function readout(label, v, d, x, y, size, o = {}) {
      const toks = [...(typeof label === 'string' ? [mv(label, o.lc || MC.white)] : label), '=', mn(fmtNum(v, d), o.c || MC.yellow, { id: 'value' })];
      return writeTex(toks, x, y, size, o.p ?? 1, { align: o.align ?? 'left', alpha: o.al ?? 1, id: o.id });
    }

    // ---- the hero: a pi-shaped creature with two eyes. (x, y) is between its feet; s 1 is about 150 px tall.
    /** The pi hero. o: look [x, y] (a point in the same coordinates), mood 'calm' | 'wow' | 'happy', hop (0..1), blink (false: eyes open), key, al */
    function piHero(x, y, s = 1, o = {}) {
      const al = o.al ?? 1;
      if (al <= 0 || s <= 0) return;
      const key = o.key ?? 'pi', mood = o.mood ?? 'calm', body = o.color || MC.pi, edge = o.edge || MC.piD;
      y -= 34 * s * thereBack(clamp(o.hop ?? 0));
      const ph = (F + (fnv('blink', key) % 47)) % 76, blink = o.blink !== false && ph < 6 ? thereBack(ph / 6) : 0;
      const breathe = 1 + 0.012 * Math.sin(TT * 2.1 + (fnv('br', key) % 7));
      g.save(); g.globalAlpha *= al; g.translate(x, y); g.scale(s, s * breathe);
      g.fillStyle = body; g.strokeStyle = edge; g.lineWidth = 3; g.lineJoin = 'round';
      // legs: the left one curls outward, the right one kicks
      g.beginPath(); g.moveTo(-46, -96); g.lineTo(-14, -96); g.quadraticCurveTo(-12, -40, -24, -8); g.quadraticCurveTo(-36, 6, -58, -2); g.quadraticCurveTo(-42, -40, -46, -96); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(12, -96); g.lineTo(42, -96); g.quadraticCurveTo(36, -40, 52, -12); g.quadraticCurveTo(58, 4, 32, 0); g.quadraticCurveTo(10, -30, 12, -96); g.fill(); g.stroke();
      // the bar
      g.beginPath(); g.moveTo(-66, -98); g.quadraticCurveTo(-68, -124, -44, -124); g.lineTo(52, -126); g.quadraticCurveTo(72, -126, 68, -108);
      g.quadraticCurveTo(64, -94, 48, -95); g.lineTo(-50, -92); g.quadraticCurveTo(-64, -90, -66, -98); g.fill(); g.stroke();
      // eyes sit on the bar; the pupils look at o.look
      const er = mood === 'wow' ? 18 : 15, ey = -136 - (er - 15);
      let lx = 0, ly = 0;
      if (o.look) { const tx = (o.look[0] - x) / s, ty = (o.look[1] - y) / s - ey, d = Math.hypot(tx, ty) || 1; lx = tx / d; ly = ty / d; }
      for (const ex of [-14, 18]) {
        g.fillStyle = MC.white; g.strokeStyle = '#000'; g.lineWidth = 2;
        g.beginPath(); g.ellipse(ex, ey, er, er * (1 - blink * 0.92), 0, 0, TAU); g.fill(); g.stroke();
        if (blink < 0.5) {
          const pr = mood === 'wow' ? 6.5 : 7.5, px = ex + lx * (er - pr - 2), py = ey + ly * (er - pr - 2);
          g.fillStyle = '#000'; g.beginPath(); g.arc(px, py, pr, 0, TAU); g.fill();
          g.fillStyle = MC.white; g.beginPath(); g.arc(px + 2.4, py - 2.4, 2.2, 0, TAU); g.fill();
        }
      }
      // the mouth, on the bar
      g.strokeStyle = '#0b2430'; g.fillStyle = '#0b2430'; g.lineWidth = 3.2; g.lineCap = 'round';
      if (mood === 'wow') { g.beginPath(); g.ellipse(4, -107, 6.5, 8, 0, 0, TAU); g.fill(); } else { const k = mood === 'happy' ? 7 : 3.5; g.beginPath(); g.moveTo(-8, -110); g.quadraticCurveTo(4, -110 + k * 1.6, 16, -110); g.stroke(); }
      g.restore();
    }

    // ---- captions and headings (draw them after the camera, in screen space)
    /** A manim BackgroundRectangle (black, 75 %) behind serif text Written on. p: Write progress. o: color, id */
    function mathCard(segs, x, y, size, p, o = {}) {
      const al = o.alpha ?? 1;
      if (p <= 0 || al <= 0) return null;
      const str = typeof segs === 'string' ? segs : segs.map((sg) => sg.s).join(''), w = textW(str, size) + size * 0.9, h = size * 1.5;
      g.save(); g.globalAlpha *= al * 0.75 * smoothM(p * 3); g.fillStyle = '#000'; g.fillRect(x - w / 2, y - h * 0.62, w, h); g.restore();
      writeText(segs, x, y + size * 0.05, size, p, { color: o.color || MC.white, lag: 1.0, alpha: al, id: o.id ?? 'caption:' + str });
      return { w, h };
    }
    /** A caption, bottom centre (screen space), Written on from t. On a Duet it moves right, clear of the presenter. o: size, y, x, alpha */
    function caption(segs, t, o = {}) {
      const size = o.size ?? 50, str = typeof segs === 'string' ? segs : segs.map((sg) => sg.s).join(''), w = textW(str, size) + size * 0.9;
      let x = o.x ?? W / 2;
      if (X.bubble) x = Math.max(x, 420 + w / 2);
      g.save(); X.screen();
      const r = mathCard(segs, x, o.y ?? H - 112, size, runS(t, o.dur ?? 0.9), { id: o.id, alpha: o.alpha });
      g.restore();
      return r;
    }
    /** A heading: grey italic, Written on from t, its underline drawing on under it. Place it by the thing it names. o: size, color, align, alpha */
    function heading(str, x, y, t, o = {}) {
      const p = runS(t, 0.7), size = o.size ?? 40, w = textW(str, size, { it: true }), x0 = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x, al = o.alpha ?? 1;
      if (p <= 0 || al <= 0) return w;
      writeText(str, x0, y, size, p, { align: 'left', it: true, color: o.color || MC.grey, alpha: al, id: o.id ?? 'heading:' + str });
      segLine(x0, y + size * 0.45, x0 + w, y + size * 0.45, MC.greyD, 2.5, smoothM(p * 1.3 - 0.3), al);
      return w;
    }

    return {
      /** Runtime-internal: the runtime binds the frame; never call it. */
      bind(c) { X = c; g = c.g; TT = c.TT; F = c.F; SC = c.scale || 1; },
      MC, SERIF,
      // easing and time
      smoothM, thereBack, runS, lagged, keysM, rgbaM, mixHex, fmtNum,
      // geometry
      pathLen, subPath, ellipsePts, arcPts, centroid, toScreen, screenBox, fillAll, polyPath,
      // type and formulas
      writeText, mText, textW, mv, mn, writeTex, texW, texBox, transformTex,
      // strokes and marks
      segLine, showCreation, squareOn, cellGrid, mDot, glowAt, mArrow, mBrace, rightAngle, angleArc, flashAt, indicateS, surround, circumscribe, blob,
      // planes and plots
      plane, axes2, numberPlane, graphM, slopeOf, tangent, dropLines, niceStep,
      // trackers
      trackDot, readout,
      // the hero
      piHero,
      // captions and headings
      mathCard, caption, heading,
    };
  },
});
