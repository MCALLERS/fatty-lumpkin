// =====================================================================
//  engine/styles/pixel/kit.js: Pixel, pixel art at a true low resolution. Every picture is drawn into a small
//  buffer of whole pixels (80x45, 160x90, 320x180 ... for a 1920x1080 frame) in a limited palette, then scaled up
//  nearest-neighbour. Hard square pixels, ordered (Bayer) dithering instead of gradients, a 5x7 bitmap font, sprites
//  from string arrays, and screen effects that belong to a device (an LCD grid, scanlines, a curved tube).
//  Resolution tells time: an early era is chunkier than a later one.
//
//  A 16:9 port of cth9191/animate's pixel style (styles/pixel/kit.js), MIT, Copyright (c) 2026 cth9191; the full
//  notice is LICENSE beside this file and travels with every copy. Port changes (Bombadillo AI, 2026): an
//  FLPT.style plug-in with closure state instead of globals; the frame is 1920x1080 at 30 fps (on twos, ctx.B);
//  the low-res pass writes whole pixels into an ImageData buffer (no canvas rasteriser between a primitive and its
//  pixels, so every machine draws the same picture); a camera that re-rasterises (a push gives a shape more pixels,
//  never bigger ones; pans land on whole pixels; parallax layers); the morph-chain hooks became eraMorph (the
//  bridge object morphs while its grid steps, then the next era opens from a stepped window) and stepWindow;
//  every word drawn in the bitmap font is registered with the runtime's text checks, at 34 px or more on screen;
//  tags take a place in the world (a tag pinned to a frame corner is one of animate's own banned defaults);
//  kinetic type (pixLetters), signs, a palette strip, world props for wide frames; PAL8 and MONO palettes.
// =====================================================================
FLPT.style('pixel', {
  // font: only the runtime's fallback for ctx.text, which this style never uses (it would draw a system font): words here
  // are pixText / pixLetters and the panels built on them (signs, tags, bubbles, captions), in the 5x7 bitmap font
  tokens: { paper: '#14101e', ink: '#f4f0e6', accent: '#f08a32', font: 'monospace', weight: 400 },
  ones: false,
  make(env) {
    const { W, H, rng: RNG, clamp, lerp, seg, EZ } = env;
    const TAU = Math.PI * 2;
    let X = null, g = null, B = 0, TT = 0, SC = 1;   // bound per frame

    // ---- palettes: one per era; an era uses only its own colours (lowres's fx.pal enforces it)
    /** The 16-colour arcade palette by name: ink, night, blue, sky, ice, white, grey, slate, green, lime, yellow, orange, red, pink, purple, brown. */
    const PAL16 = Object.freeze({
      ink: '#14101e', night: '#232a4e', blue: '#2f5fa8', sky: '#5fb4e6', ice: '#a8f0f0', white: '#f4f0e6',
      grey: '#8a8ca0', slate: '#4a4e66', green: '#2e8a4a', lime: '#8ad04a', yellow: '#f6d64a', orange: '#f08a32',
      red: '#d83a3a', pink: '#f07aa8', purple: '#6a3a8a', brown: '#7a4a2a',
    });
    /** Four handheld greens, darkest first. */
    const HANDHELD = Object.freeze(['#0f2a14', '#306a2e', '#8aac2a', '#c4d870']);
    const PAL4 = HANDHELD;
    /** Eight colours of an early home computer: ink, blue, sky, white, green, lime, yellow, brown. */
    const PAL8 = Object.freeze([PAL16.ink, PAL16.blue, PAL16.sky, PAL16.white, PAL16.green, PAL16.lime, PAL16.yellow, PAL16.brown]);
    /** One bit: ink and a warm paper white. */
    const MONO = Object.freeze(['#14101e', '#e8e2cc']);
    const PIX_ALL = Object.freeze([...Object.values(PAL16), ...HANDHELD, MONO[1]]);
    const PIX_UI = { light: PAL16.white, dark: PAL16.ink, shadow: '#07060c' };

    // ---- colour helpers
    function rgbOf(c) {
      c = String(c);
      if (c[0] === '#') { const n = c.length === 4 ? c.slice(1).split('').map((h) => h + h).join('') : c.slice(1, 7); return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) || 0); }
      const m = c.match(/[\d.]+/g); return m ? m.slice(0, 3).map(Number) : [0, 0, 0];
    }
    const hexOf = (v) => '#' + v.map((x) => clamp(Math.round(x), 0, 255).toString(16).padStart(2, '0')).join('');
    /** A colour quantised to n levels per channel. */
    const posterize = (c, levels = 8) => hexOf(rgbOf(c).map((v) => (Math.round((v / 255) * (levels - 1)) * 255) / (levels - 1)));
    /** A colour toward black (k < 0) or white (k > 0), k in -1..1. */
    const shadeC = (c, k) => hexOf(rgbOf(c).map((v) => (k < 0 ? v * (1 + k) : v + (255 - v) * k)));
    /** The palette colour nearest c (luma-weighted). */
    function nearestC(c, pal) {
      const a = rgbOf(c), list = Array.isArray(pal) ? pal : Object.values(pal);
      let best = list[0], bd = 1e9;
      for (const p of list) { const b = rgbOf(p), d = (a[0] - b[0]) ** 2 * 0.3 + (a[1] - b[1]) ** 2 * 0.59 + (a[2] - b[2]) ** 2 * 0.11; if (d < bd) { bd = d; best = p; } }
      return best;
    }
    /** The two palette colours, and the mix 0..1 between them, that best make c when dithered. */
    function ditherPair(c, pal = PIX_ALL) {
      const list = Array.isArray(pal) ? pal : Object.values(pal), v = rgbOf(c), P = list.map(rgbOf);
      let best = [list[0], list[0], 0], be = 1e18;
      for (let i = 0; i < P.length; i++) for (let j = 0; j < P.length; j++) {
        const a = P[i], b = P[j], d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
        const t = L ? clamp(((v[0] - a[0]) * d[0] + (v[1] - a[1]) * d[1] + (v[2] - a[2]) * d[2]) / L) : 0;
        const e = (a[0] + d[0] * t - v[0]) ** 2 + (a[1] + d[1] * t - v[1]) ** 2 + (a[2] + d[2] * t - v[2]) ** 2 + (L ? t * (1 - t) * L * 0.15 : 0);
        if (e < be) { be = e; best = [list[i], list[j], t]; }
      }
      return best;
    }
    /** Two colours mixed, u 0..1 (for a morph's colour; dither or snap it before it reaches the picture). */
    const mixC = (a, b, u) => { const A = rgbOf(a), Bc = rgbOf(b); return hexOf(A.map((v, i) => lerp(v, Bc[i], u))); };

    /** A fast seeded hash of integers to 0..1 (per-pixel detail without an RNG per pixel). */
    function hash01(a, b = 0, c = 0) {
      let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647)) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
      return (h >>> 0) / 4294967296;
    }
    const seedOf = (k) => { const s = String(k); let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h | 0; };

    // ---- whole pixels in a buffer: colours are packed once into the ImageData's 32-bit words
    const LE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
    const PACK = new Map();
    function u32(c) {
      if (c == null || c === false || c === 'none') return 0;
      let v = PACK.get(c);
      if (v === undefined) {
        const [r, gg, b] = rgbOf(c);
        v = (LE ? ((255 << 24) | (b << 16) | (gg << 8) | r) : ((r << 24) | (gg << 16) | (b << 8) | 255)) >>> 0;
        PACK.set(c, v);
      }
      return v;
    }
    const unpack = (v) => (LE ? [v & 255, (v >>> 8) & 255, (v >>> 16) & 255] : [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255]);

    // ---- ordered dithering: a 4x4 Bayer matrix, thresholds in (0, 1)
    const BAYER4 = Object.freeze([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16));
    /** The Bayer threshold (0..1) at a pixel. */
    const bayer = (x, y) => BAYER4[((Math.round(y) & 3) << 2) | (Math.round(x) & 3)];
    const bay = (x, y) => BAYER4[((y & 3) << 2) | (x & 3)];   // whole pixels only (the kit's own loops)

    // ---------------------------------------------------------------------
    //  the low-res pass. S is the buffer being drawn; V maps world pixels to it: X = z * x + tx (whole tx, ty)
    // ---------------------------------------------------------------------
    const SURF = new Map();
    let S = null, V = { z: 1, tx: 0, ty: 0 }, DEPTH = 0;
    function surface(w, h, d) {
      const k = `${w}x${h}@${d}`;
      let s = SURF.get(k);
      if (!s) {
        const c = env.canvas(w, h), cg = c.getContext('2d', { willReadFrequently: true }), im = cg.createImageData(w, h);
        s = { c, cg, im, u: new Uint32Array(im.data.buffer), w, h };
        SURF.set(k, s);
      }
      return s;
    }
    /** [w, h] for a resolution: [w, h] as given, or a pixel size in screen px (W / px x H / px). */
    const resOf = (res) => (Array.isArray(res) ? [Math.round(res[0]), Math.round(res[1])] : [Math.ceil(W / res), Math.ceil(H / res)]);
    /** The screen px per pixel of a resolution. */
    const pxOf = (res) => (Array.isArray(res) ? W / res[0] : res);
    function fillS(x0, y0, x1, y1, v) {
      if (!S) return;
      if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 > S.w) x1 = S.w; if (y1 > S.h) y1 = S.h;
      if (x1 <= x0 || y1 <= y0) return;
      const u = S.u, w = S.w;
      for (let y = y0; y < y1; y++) u.fill(v, y * w + x0, y * w + x1);
    }
    const sx = (x) => V.z * x + V.tx, sy = (y) => V.z * y + V.ty;
    const ox = () => V.tx, oy = () => V.ty;   // the dither keeps to the world's origin, so a pan doesn't make it swim
    /**
     * Draw a picture at a low resolution: draw(w, h) runs with primitives writing whole pixels into a w x h buffer,
     * which is then scaled up with hard pixels onto the frame. res = [w, h] (dividing 1920x1080) or a pixel size.
     * o: { fx: { pal, posterize, noise, noiseAmt, blocks, bs, flicker, vignette }, post: { scan, lcd, vignette }, view, al }.
     * fx works on the buffer's whole pixels (palette-true); post is the device's screen, laid over it (outside the palette).
     */
    function lowres(res, draw, o = {}) {
      const [w, h] = resOf(res), G = pxOf(res);
      const s = surface(w, h, DEPTH);
      s.u.fill(o.fill ? u32(o.fill) : 0);
      const keepS = S, keepV = V;
      S = s; V = o.view ? viewOf(o.view) : { z: 1, tx: 0, ty: 0 }; DEPTH++;
      try { draw(w, h); if (o.fx) fxOn(s, o.fx); } finally { S = keepS; V = keepV; DEPTH--; }
      s.cg.putImageData(s.im, 0, 0);
      g.save(); g.setTransform(SC, 0, 0, SC, 0, 0); g.imageSmoothingEnabled = false;
      if (o.al != null) g.globalAlpha *= clamp(o.al);
      g.drawImage(s.c, 0, 0, w, h, 0, 0, w * G, h * G);
      g.restore();
      if (o.post) pixPost(o.post, G);
    }
    /** Pixel primitives straight onto the frame at G screen px per pixel (a layer on top: an overlay, a HUD). */
    const withGrid = (G, fn) => lowres(G, fn);
    /** A world pixel's centre on screen (1920x1080), through the current view. */
    const pixToScreen = (x, y) => { const s = S ? W / S.w : 1; return [(sx(x) + 0.5 * V.z) * s, (sy(y) + 0.5 * V.z) * s]; };
    /** A screen point (1920x1080) as a pixel of resolution res. */
    const pixFromWorld = (x, y, res) => { const s = pxOf(res); return [Math.floor(x / s), Math.floor(y / s)]; };
    /** A pixel's centre on screen at resolution res (place bridge shapes with it). */
    const pixToWorld = (x, y, res) => { const s = pxOf(res); return [(x + 0.5) * s, (y + 0.5) * s]; };
    /** The current buffer: { w, h, px } (px = screen px per pixel), or null outside lowres. */
    const PIX = () => (S ? { w: S.w, h: S.h, px: W / S.w, z: V.z, tx: V.tx, ty: V.ty } : null);

    // ---- the camera: it moves the world in whole pixels and re-rasterises, so a push gives shapes more pixels
    /** A view: world pixel p lands on buffer pixel `to` at zoom z (both default to the buffer's centre). */
    function view(o = {}) {
      const w = S ? S.w : 320, h = S ? S.h : 180;
      const z = o.z ?? 1, p = o.p || [w / 2, h / 2], to = o.to || [w / 2, h / 2];
      return { z, tx: to[0] - z * p[0], ty: to[1] - z * p[1] };
    }
    const viewOf = (v) => { const q = v && 'tx' in v ? v : view(v || {}); return { z: q.z ?? 1, tx: Math.round(q.tx), ty: Math.round(q.ty) }; };
    /** Draw fn() through a view (ctx.cam/ctx.push results work too, in buffer pixels). */
    function withView(v, fn) { const keep = V; V = viewOf(v); try { fn(); } finally { V = keep; } }
    /** A parallax layer's view: k = 0 stays put, 1 moves with the world (0.3 for far hills). */
    const depth = (v, k) => { const q = viewOf(v); return { z: 1 + (q.z - 1) * k, tx: q.tx * k, ty: q.ty * k }; };
    function screenSpace(fn) { const keep = V; V = { z: 1, tx: 0, ty: 0 }; try { return fn(); } finally { V = keep; } }

    // ---------------------------------------------------------------------
    //  primitives (world pixels; everything lands on whole pixels; colours are '#hex', null leaves a hole)
    // ---------------------------------------------------------------------
    /** Fill whole pixels [x, x+w) x [y, y+h) through the view. */
    function cellR(x, y, w, h, c) {
      let x0 = Math.round(sx(x)), y0 = Math.round(sy(y)), x1 = Math.round(sx(x + w)), y1 = Math.round(sy(y + h));
      if (w > 0 && x1 <= x0) x1 = x0 + 1;
      if (h > 0 && y1 <= y0) y1 = y0 + 1;
      fillS(x0, y0, x1, y1, u32(c));
    }
    const pset = (x, y, c) => cellR(Math.round(x), Math.round(y), 1, 1, c);
    const prect = (x, y, w, h, c) => cellR(Math.round(x), Math.round(y), Math.round(w), Math.round(h), c);
    /** The whole buffer in one colour. */
    const pfill = (c) => { if (S) S.u.fill(u32(c)); };
    /** A one-pixel line (Bresenham), o.w thicker. */
    function pline(x0, y0, x1, y1, c, o = {}) {
      let a = Math.round(sx(x0)), b = Math.round(sy(y0));
      const e0 = Math.round(sx(x1)), e1 = Math.round(sy(y1)), th = Math.max(1, Math.round((o.w || 1) * V.z)), v = u32(c);
      const dx = Math.abs(e0 - a), dy = -Math.abs(e1 - b), stx = a < e0 ? 1 : -1, sty = b < e1 ? 1 : -1;
      let e = dx + dy;
      for (let n = 0; n < 8192; n++) {
        fillS(a, b, a + th, b + th, v);
        if (a === e0 && b === e1) break;
        const e2 = 2 * e;
        if (e2 >= dy) { e += dy; a += stx; }
        if (e2 <= dx) { e += dx; b += sty; }
      }
    }
    /** A filled pixel ellipse round the centre pixel (rx = ry = r: a disc 2r+1 wide); o.ring = the rim only. */
    function pellipse(cx, cy, rx, ry, c, o = {}) {
      const CX = Math.round(sx(cx)), CY = Math.round(sy(cy)), RX = Math.max(0, Math.round(rx * V.z)), RY = Math.max(0, Math.round(ry * V.z)), v = u32(c);
      const A = RX + 0.5, Bq = RY + 0.5, t = o.ring ? Math.max(1, Math.round(o.ring * V.z)) : 0;
      for (let j = -RY; j <= RY; j++) {
        const hw = Math.floor(A * Math.sqrt(Math.max(0, 1 - (j / Bq) ** 2)) + 1e-9);
        if (!t) { fillS(CX - hw, CY + j, CX + hw + 1, CY + j + 1, v); continue; }
        const iA = A - t, iB = Bq - t, inner = iA > 0 && iB > 0 && Math.abs(j) < iB ? Math.floor(iA * Math.sqrt(Math.max(0, 1 - (j / iB) ** 2)) + 1e-9) : -1;
        if (inner < 0) fillS(CX - hw, CY + j, CX + hw + 1, CY + j + 1, v);
        else { fillS(CX - hw, CY + j, CX - inner, CY + j + 1, v); fillS(CX + inner + 1, CY + j, CX + hw + 1, CY + j + 1, v); }
      }
    }
    const pcircle = (cx, cy, r, c, o) => pellipse(cx, cy, r, r, c, o);
    /** Rows y0..y1-1 of polygon P: spans [i0, i1) of pixels whose centres are inside (even-odd). */
    function polySpans(P, y0, y1) {
      const rows = [], n = P.length;
      for (let j = y0; j < y1; j++) {
        const yc = j + 0.5, xs = [];
        for (let k = 0; k < n; k++) { const a = P[k], b = P[(k + 1) % n]; if ((a[1] <= yc) !== (b[1] <= yc)) xs.push(a[0] + ((yc - a[1]) * (b[0] - a[0])) / (b[1] - a[1])); }
        xs.sort((p, q) => p - q);
        const sp = [];
        for (let k = 0; k + 1 < xs.length; k += 2) { const i0 = Math.ceil(xs[k] - 0.5), i1 = Math.ceil(xs[k + 1] - 0.5); if (i1 > i0) sp.push([i0, i1]); }
        rows.push(sp);
      }
      return rows;
    }
    /** A filled polygon, rasterised by pixel centres (hard stepped edges). */
    function ppoly(P, c) {
      if (!S || !P || P.length < 3) return;
      const Q = P.map(([x, y]) => [sx(x), sy(y)]), v = u32(c);
      let y0 = 1e9, y1 = -1e9;
      for (const [, y] of Q) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
      y0 = Math.max(0, Math.floor(y0)); y1 = Math.min(S.h, Math.ceil(y1) + 1);
      polySpans(Q, y0, y1).forEach((sp, k) => sp.forEach(([a, b]) => fillS(a, y0 + k, b, y0 + k + 1, v)));
    }
    /** The buffer rectangle a world rectangle covers. */
    function rectS(x, y, w, h) { return [Math.round(sx(x)), Math.round(sy(y)), Math.round(sx(x + w)), Math.round(sy(y + h))]; }
    /** Ordered dither: cB where f(x, y) (0..1, world pixels) beats the Bayer threshold, else cA (null leaves it). */
    function pdither(x, y, w, h, cA, cB, f) {
      if (!S) return;
      const [X0, Y0, X1, Y1] = rectS(x, y, w, h), vB = u32(cB);
      if (cA) fillS(X0, Y0, X1, Y1, u32(cA));
      const z = V.z, tx = V.tx, ty = V.ty, u = S.u, sw = S.w;
      for (let Y = Math.max(0, Y0); Y < Math.min(S.h, Y1); Y++) {
        const wy = Math.floor((Y + 0.5 - ty) / z);
        for (let Xx = Math.max(0, X0); Xx < Math.min(sw, X1); Xx++) if (f(Math.floor((Xx + 0.5 - tx) / z), wy) > bay(Xx - tx, Y - ty)) u[Y * sw + Xx] = vB;
      }
    }
    /** A dithered gradient through cols, top to bottom (o.horiz: left to right); o.ease(u) reshapes it. */
    function pgrad(x, y, w, h, cols, o = {}) {
      if (!S) return;
      const [X0, Y0, X1, Y1] = rectS(x, y, w, h), n = cols.length - 1, V32 = cols.map(u32), ease = o.ease || ((q) => q), u = S.u, sw = S.w;
      const L = o.horiz ? X1 - X0 : Y1 - Y0;
      for (let k = 0; k < L; k++) {
        const q = ease(L > 1 ? k / (L - 1) : 0) * n, a = Math.min(n, Math.floor(q)), f = q - a, b = Math.min(n, a + 1);
        if (o.horiz) {
          const Xx = X0 + k; if (Xx < 0 || Xx >= sw) continue;
          for (let Y = Math.max(0, Y0); Y < Math.min(S.h, Y1); Y++) u[Y * sw + Xx] = f > 0 && a !== b && f > bay(Xx - V.tx, Y - V.ty) ? V32[b] : V32[a];
        } else {
          const Y = Y0 + k; if (Y < 0 || Y >= S.h) continue;
          fillS(X0, Y, X1, Y + 1, V32[a]);
          if (f > 0 && a !== b) for (let Xx = Math.max(0, X0); Xx < Math.min(sw, X1); Xx++) if (f > bay(Xx - V.tx, Y - V.ty)) u[Y * sw + Xx] = V32[b];
        }
      }
    }
    /** A dithered halo: density amt at radius r0 falling to 0 at r1 (moons, lamps, coins). */
    function pglow(cx, cy, r0, r1, c, amt = 0.5) {
      if (!S) return;
      const CX = Math.round(sx(cx)), CY = Math.round(sy(cy)), R0 = r0 * V.z, R1 = r1 * V.z, R = Math.ceil(R1), v = u32(c), u = S.u, sw = S.w;
      for (let j = -R; j <= R; j++) {
        const Y = CY + j; if (Y < 0 || Y >= S.h) continue;
        for (let i = -R; i <= R; i++) {
          const Xx = CX + i; if (Xx < 0 || Xx >= sw) continue;
          const d = Math.hypot(i, j); if (d < R0 || d > R1) continue;
          if (amt * (1 - (d - R0) / Math.max(1e-6, R1 - R0)) > bay(Xx - V.tx, Y - V.ty)) u[Y * sw + Xx] = v;
        }
      }
    }

    // ---------------------------------------------------------------------
    //  era effects on the buffer (keyed on B, so they boil on twos and repeat exactly)
    //    pal: [..] snap every pixel to the nearest palette colour · posterize: n levels · noise: count, noiseAmt
    //    blocks: frac of bs x bs blocks flattened to their mean · flicker: brightness jitter
    //    vignette: n stepped bands into the corners, each one palette colour darker (palette-true, whole pixels)
    // ---------------------------------------------------------------------
    function fxOn(s, fx) {
      const u = s.u, w = s.w, h = s.h;
      if (!(fx.pal || fx.posterize || fx.blocks || fx.flicker || fx.noise || fx.vignette)) return;
      const get = (i) => unpack(u[i]), put = (i, r, gg, b) => { u[i] = u32(hexOf([r, gg, b])); };
      if (fx.flicker) { const k = 1 + RNG('pxflk', B).n() * fx.flicker; for (let i = 0; i < u.length; i++) if (u[i]) { const p = get(i); put(i, p[0] * k, p[1] * k, p[2] * k); } }
      if (fx.blocks) {
        const bs = fx.bs ?? 4;
        for (let by = 0; by < h; by += bs) for (let bx = 0; bx < w; bx += bs) {
          if (RNG('pxblk', bx, by, B).r() >= fx.blocks) continue;
          const m = [0, 0, 0]; let n = 0;
          for (let y = by; y < Math.min(h, by + bs); y++) for (let x = bx; x < Math.min(w, bx + bs); x++) { const i = y * w + x; if (!u[i]) continue; const p = get(i); m[0] += p[0]; m[1] += p[1]; m[2] += p[2]; n++; }
          if (!n) continue;
          const v = u32(hexOf(m.map((q) => q / n)));
          for (let y = by; y < Math.min(h, by + bs); y++) for (let x = bx; x < Math.min(w, bx + bs); x++) if (u[y * w + x]) u[y * w + x] = v;
        }
      }
      if (fx.noise) {
        const R = RNG('pxnoise', w, B), a = fx.noiseAmt ?? 40;
        for (let k = 0; k < fx.noise; k++) { const i = R.i(0, w * h - 1); if (!u[i]) continue; const p = get(i), d = R.n() * a; put(i, p[0] + d + R.n() * a * 0.5, p[1] + d + R.n() * a * 0.5, p[2] + d + R.n() * a * 0.5); }
      }
      if (fx.posterize) { const L = fx.posterize - 1; for (let i = 0; i < u.length; i++) if (u[i]) { const p = get(i); put(i, ...p.map((q) => (Math.round((q / 255) * L) * 255) / L)); } }
      if (fx.pal) {
        const pal = (Array.isArray(fx.pal) ? fx.pal : Object.values(fx.pal)), memo = new Map();
        for (let i = 0; i < u.length; i++) {
          const v = u[i]; if (!v) continue;
          let q = memo.get(v);
          if (q === undefined) { q = u32(nearestC(hexOf(unpack(v)), pal)); memo.set(v, q); }
          u[i] = q;
        }
      }
      if (fx.vignette) {
        // a curved tube, palette-true: whole pixels in stepped bands toward the corners, each band one step darker
        // (the next darker colour of the era's palette), never an alpha and never a dither over the picture's dither
        const pal = fx.pal ? (Array.isArray(fx.pal) ? fx.pal : Object.values(fx.pal)) : PIX_ALL, n = Math.max(1, Math.round(fx.vignette));
        const luma = (c) => { const p = rgbOf(c); return p[0] * 0.3 + p[1] * 0.59 + p[2] * 0.11; }, memo = new Map();
        const darker = (v) => {
          let q = memo.get(v);
          if (q === undefined) { const c = hexOf(unpack(v)), L0 = luma(c), dk = pal.filter((p) => luma(p) < L0 - 4); q = dk.length ? u32(nearestC(shadeC(c, -0.4), dk)) : v; memo.set(v, q); }
          return q;
        };
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const i = y * w + x; if (!u[i]) continue;
          const dx = ((x + 0.5) / w) * 2 - 1, dy = ((y + 0.5) / h) * 2 - 1, v = clamp(((dx ** 4 + dy ** 4) ** 0.25 - 0.86) / 0.16);
          for (let k = 1; k <= n; k++) if (v > (k - 0.5) / n) u[i] = darker(u[i]);
        }
      }
    }

    /** Era effects on the buffer being drawn now (inside lowres): { pal, posterize, noise, noiseAmt, blocks, bs, flicker, vignette }. */
    function pixFX(fx) { if (S && fx) fxOn(S, fx); }

    // ---------------------------------------------------------------------
    //  the bitmap font: 5x7 glyphs, one number per row (bit 16 = the left column); a glyph advances 6 pixels.
    //  A-Z, 0-9 and . , ! ? : - + / ' " > < * = ( ) # % _ $ & (lower case draws as upper case)
    // ---------------------------------------------------------------------
    const FONT5 = Object.freeze({
      ' ': [0, 0, 0, 0, 0, 0, 0],
      A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [28, 18, 17, 17, 17, 18, 28],
      E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
      I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
      M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
      Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
      U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
      Y: [17, 17, 17, 10, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
      0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31], 3: [31, 2, 4, 2, 1, 17, 14],
      4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14], 6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8],
      8: [14, 17, 17, 14, 17, 17, 14], 9: [14, 17, 17, 15, 1, 2, 12],
      '.': [0, 0, 0, 0, 0, 12, 12], ',': [0, 0, 0, 0, 12, 4, 8], '!': [4, 4, 4, 4, 4, 0, 4], '?': [14, 17, 1, 2, 4, 0, 4],
      ':': [0, 12, 12, 0, 12, 12, 0], '-': [0, 0, 0, 31, 0, 0, 0], '+': [0, 4, 4, 31, 4, 4, 0], '/': [1, 1, 2, 4, 8, 16, 16],
      "'": [4, 4, 8, 0, 0, 0, 0], '"': [10, 10, 0, 0, 0, 0, 0], '>': [8, 4, 2, 1, 2, 4, 8], '<': [2, 4, 8, 16, 8, 4, 2],
      '*': [0, 4, 21, 14, 21, 4, 0], '=': [0, 0, 31, 0, 31, 0, 0], '(': [2, 4, 8, 8, 8, 4, 2], ')': [8, 4, 2, 2, 2, 4, 8],
      '#': [10, 10, 31, 10, 31, 10, 10], '%': [24, 25, 2, 4, 8, 19, 3], _: [0, 0, 0, 0, 0, 0, 31], $: [4, 15, 20, 14, 5, 30, 4],
      '&': [12, 18, 20, 8, 21, 18, 13],
    });
    const MIN_GLYPH = 34;   // screen px: the rule for words on screen
    /**
     * The scale a line of text gets: a whole number, o.scale times the view's zoom rounded down (so a line never
     * outgrows the world box laid out for it, a sign's board, at a zoom like 1.25), and 34 px tall on screen.
     */
    function textScale(o) {
      const px = S ? W / S.w : 6;
      let sc = Math.max(1, Math.floor((o.scale ?? 1) * V.z + 1e-6));
      if (7 * sc * px < MIN_GLYPH) sc = Math.ceil(MIN_GLYPH / (7 * px));
      return sc;
    }
    /** The width of a line in pixels (6 per glyph, less the last gap). */
    const pixTextW = (str, sc = 1) => Math.max(0, [...String(str)].length * 6 * sc - sc);
    function glyphs(s, X0, Y0, sc, v, n, each) {
      for (let k = 0; k < n; k++) {
        const ch = s[k], gl = FONT5[ch] || FONT5[' '], e = each ? each(k, ch) : null;
        if (e && e.show === false) continue;
        const gx = X0 + k * 6 * sc + (e && e.dx ? Math.round(e.dx) : 0), gy = Y0 + (e && e.dy ? Math.round(e.dy) : 0), gv = e && e.c ? u32(e.c) : v;
        for (let r = 0; r < 7; r++) {
          const bits = gl[r]; if (!bits) continue;
          for (let b = 0; b < 5; b++) {
            if (!(bits & (16 >> b))) continue;
            let q = b; while (q + 1 < 5 && bits & (16 >> (q + 1))) q++;
            fillS(gx + b * sc, gy + r * sc, gx + (q + 1) * sc, gy + (r + 1) * sc, gv);
            b = q;
          }
        }
      }
    }
    /** Register a line of bitmap text (buffer pixels) with the runtime's text checks, in screen units. */
    function register(id, str, X0, Y0, w, h, pad) {
      if (!S) return null;
      const px = W / S.w, box = { x: (X0 - pad) * px, y: (Y0 - pad) * px, w: (w + 2 * pad) * px, h: (h + 2 * pad) * px };
      if (id !== false) env.registerBox(id ?? `pix:${str}`, str, box);
      return box;
    }
    /**
     * Pixel text, top-left at world pixel (x, y): o.scale (whole), count (the typing reveal), align, shadow, outline,
     * cursor (a blinking block while typing), id (false: unregistered). Returns { w, h, box } (w, h in world pixels).
     */
    function pixText(str, x, y, c, o = {}) {
      if (!S) return { w: 0, h: 0, box: null };
      const s = String(str).toUpperCase(), chars = [...s], sc = textScale(o), n = clamp(Math.floor(o.count ?? chars.length), 0, chars.length), tw = pixTextW(s, sc);
      const X0 = Math.round(sx(x)) - (o.align === 'center' ? Math.floor(tw / 2) : o.align === 'right' ? tw : 0), Y0 = Math.round(sy(y));
      if (o.outline) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) glyphs(chars, X0 + dx * sc, Y0 + dy * sc, sc, u32(o.outline), n);
      if (o.shadow) glyphs(chars, X0 + sc, Y0 + sc, sc, u32(o.shadow), n);
      glyphs(chars, X0, Y0, sc, u32(c), n);
      if (o.cursor && n < chars.length && B % 4 < 2) fillS(X0 + n * 6 * sc, Y0, X0 + n * 6 * sc + 5 * sc, Y0 + 7 * sc, u32(o.cursor === true ? c : o.cursor));
      const box = n > 0 ? register(o.id, String(str), X0, Y0, tw, 7 * sc, o.outline ? sc : 0) : null;
      return { w: tw / V.z, h: (7 * sc) / V.z, box };
    }
    /**
     * Kinetic pixel type: each(i, n, ch) -> { dx, dy, show, c } per glyph (world pixels, whole). The line's rest box is
     * registered once. o as pixText (scale, align, shadow, outline).
     */
    function pixLetters(str, x, y, c, o = {}) {
      if (!S) return { w: 0, h: 0, box: null };
      const s = String(str).toUpperCase(), chars = [...s], sc = textScale(o), tw = pixTextW(s, sc), N = chars.length;
      const X0 = Math.round(sx(x)) - (o.align === 'center' ? Math.floor(tw / 2) : o.align === 'right' ? tw : 0), Y0 = Math.round(sy(y));
      const per = o.each ? chars.map((ch, i) => o.each(i, N, ch) || {}) : chars.map(() => ({}));
      const each = (k) => ({ ...per[k], dx: (per[k].dx || 0) * V.z, dy: (per[k].dy || 0) * V.z });
      if (o.outline) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) glyphs(chars, X0 + dx * sc, Y0 + dy * sc, sc, u32(o.outline), N, (k) => ({ ...each(k), c: null }));
      if (o.shadow) glyphs(chars, X0 + sc, Y0 + sc, sc, u32(o.shadow), N, (k) => ({ ...each(k), c: null }));
      glyphs(chars, X0, Y0, sc, u32(c), N, each);
      const shown = per.some((e) => e.show !== false);
      const box = shown ? register(o.id, String(str), X0, Y0, tw, 7 * sc, o.outline ? sc : 0) : null;
      return { w: tw / V.z, h: (7 * sc) / V.z, box };
    }

    // ---------------------------------------------------------------------
    //  sprites from string arrays: rows like '..XX..', map { X: '#hex' }; '.' and ' ' are clear
    //  o: flip, flipY, scale (whole), anchor 'tl' (default) | 'c' | 'bc' (bottom centre: stand it on a floor)
    // ---------------------------------------------------------------------
    function sprite(rows, map, x, y, o = {}) {
      if (!S) return [0, 0];
      const sc = Math.max(1, Math.round((o.scale ?? 1) * V.z)), w = rows[0].length, h = rows.length;
      let X0 = Math.round(sx(x)), Y0 = Math.round(sy(y));
      if (o.anchor === 'c') { X0 -= Math.floor((w * sc) / 2); Y0 -= Math.floor((h * sc) / 2); } else if (o.anchor === 'bc') { X0 -= Math.floor((w * sc) / 2); Y0 -= h * sc; }
      for (let j = 0; j < h; j++) {
        const row = rows[o.flipY ? h - 1 - j : j], at = (i) => row[o.flip ? w - 1 - i : i];
        for (let i = 0; i < w;) {
          const ch = at(i); let k = i + 1;
          while (k < w && at(k) === ch) k++;
          const col = map[ch];
          if (col) fillS(X0 + i * sc, Y0 + j * sc, X0 + k * sc, Y0 + (j + 1) * sc, u32(col));
          i = k;
        }
      }
      return [(w * sc) / V.z, (h * sc) / V.z];
    }
    /** Stock sprites (map 'a' = main colour, 'b' = accent, 'k' = ink, 'w' = white): spark, twinkle, heart, note, beetle, slime, bird, coin, lamp, rail, star7. */
    const SPR = Object.freeze({
      spark: ['..a..', '..a..', 'aabaa', '..a..', '..a..'],
      twinkle: ['.a.', 'aba', '.a.'],
      heart: ['.aa.aa.', 'abaaaaa', 'aaaaaaa', '.aaaaa.', '..aaa..', '...a...'],
      note: ['..aaa', '..a.a', '..a..', 'aaa..', 'aaa..'],
      beetle: [['..aa..', '.abba.', 'abbbba', 'a.a.a.'], ['..aa..', '.abba.', 'abbbba', '.a.a.a']],
      slime: [['..aaaa..', '.abbbba.', 'abwkbwka', 'abbbbbba', 'abbbbbba', '.aaaaaa.'], ['........', '..aaaa..', '.abbbba.', 'abwkbwka', 'abbbbbba', 'aaaaaaaa']],
      bird: [['a...a', '.a.a.', '..a..'], ['.....', 'aa.aa', '..a..']],
      coin: [['.aaa.', 'awbba', 'awbba', 'awbba', 'awbba', 'awbba', '.aaa.'], ['.a.', 'awa', 'aba', 'aba', 'aba', 'aba', '.a.'], ['a', 'a', 'a', 'a', 'a', 'a', 'a']],
      lamp: ['aaaaa', '.bbb.', '.bbb.', '..a..', '..a..', '..a..', '.aaa.'],
      rail: ['aaaaaaa', 'a..a..a', 'a..a..a', 'aaaaaaa'],
      star7: ['...a...', '...a...', 'aaaaaaa', '.aaaaa.', '..aaa..', '.aa.aa.', 'a.....a'],
    });
    /** A spinning coin (a 4-step spin keyed on t; k offsets it). */
    function coin(x, y, k = 0, o = {}) {
      const f = [0, 1, 2, 1][(Math.floor(TT * (o.rate ?? 6) + 1e-6) + k) % 4];
      return sprite(SPR.coin[f], { a: o.edge ?? PAL16.orange, b: o.face ?? PAL16.yellow, w: o.shine ?? PAL16.white }, x, y, { anchor: 'c', scale: o.scale });
    }

    // ---------------------------------------------------------------------
    //  the hero: a round critter with ears, feet and big eyes, rasterised at any size (native to every era's
    //  resolution: a later era's hero has more pixels, not bigger ones). (x, y) = body centre, r = body radius (>= 3).
    //  o: pal { ink, body, light, dark, eye, pupil, cheek }, mood 'smile'|'wow'|'happy', look [dx, dy] (-1..1), hop,
    //     frame (0/1; default flips every o.beat s), walk (feet step), blink, key. Returns { head, foot, x, y }.
    // ---------------------------------------------------------------------
    const HERO_PAL = Object.freeze({ ink: PAL16.ink, body: PAL16.orange, light: PAL16.yellow, dark: PAL16.red, eye: PAL16.white, pupil: PAL16.ink, cheek: PAL16.pink });
    const HERO_HH = Object.freeze({ ink: HANDHELD[0], body: HANDHELD[2], light: HANDHELD[3], dark: HANDHELD[1], eye: HANDHELD[3], pupil: HANDHELD[0] });
    const HERO_8 = Object.freeze({ ink: PAL16.ink, body: PAL16.yellow, light: PAL16.white, dark: PAL16.brown, eye: PAL16.white, pupil: PAL16.ink });
    function pixHero(x, y, r, o = {}) {
      if (!S) return null;
      const pal = o.pal || HERO_PAL, key = String(o.key ?? 'hero'), OV = V, z = OV.z;   // OV: the caller's view (screenSpace resets V)
      const R = Math.max(3, Math.round(r * z)), hop = Math.round((o.hop ?? 0) * z);
      const fr = o.frame ?? (Math.floor(TT / (o.beat ?? 0.5) + 1e-6) % 2);
      const bx = Math.round(sx(x)), by = Math.round(sy(y));
      return screenSpace(() => {
        const ink = pal.ink, rx = R + fr, ry = R - fr, cx = bx, cy = by - hop + fr;
        const inside = (i, j) => (i / (rx + 0.5)) ** 2 + (j / (ry + 0.5)) ** 2 <= 1;
        const eh = Math.max(1, Math.round(R * 0.38)), ex = Math.round(rx * 0.5) + fr, head = cy - ry;
        for (const s of [-1, 1]) for (let k = 0; k <= eh; k++) {
          const wk = eh + 1 - k, x0 = cx + s * ex - Math.floor(wk / 2);
          prect(x0, head - k, wk, 1, ink);
          if (wk >= 3 && k < eh) prect(x0 + 1, head - k, wk - 2, 1, k === 0 ? pal.body : pal.light);
        }
        // lit top-left, shaded bottom-right: dithered on a big body; on a small one (R < 10) a solid crescent and a
        // solid highlight, since a dither over a few pixels reads as a smear across the face
        const dith = R >= 10;
        for (let j = -ry; j <= ry; j++) for (let i = -rx; i <= rx; i++) {
          if (!inside(i, j)) continue;
          let col;
          if (!inside(i - 1, j) || !inside(i + 1, j) || !inside(i, j - 1) || !inside(i, j + 1)) col = ink;
          else {
            const q = -i / rx - j / ry, b = dith ? bayer(i + 64, j + 64) : 0.5;
            const shade = dith ? clamp((-q - 0.45) * 1.4) > b : !inside(i + 2, j + 1) || !inside(i + 1, j + 2);
            col = clamp((q - 0.6) * 1.5) > b ? pal.light : shade ? pal.dark : pal.body;
          }
          fillS(cx + i, cy + j, cx + i + 1, cy + j + 1, u32(col));
        }
        const fw = Math.max(2, Math.round(R / 3)), fh = Math.max(1, Math.round(R / 8)), fy = by - hop + R + 1;
        const step = o.walk ? Math.floor(TT * 8 + 1e-6) % 2 : -1;
        [-1, 1].forEach((s, i) => prect(cx + s * Math.round(R * 0.45) - Math.floor(fw / 2), fy - (step === i ? 1 : 0), fw, fh, ink));
        const es = Math.max(1, Math.round(R / 5)), ew = es + 1, wow = o.mood === 'wow', ehh = es + 1 + (wow ? 1 : 0);
        const eo = Math.max(2, Math.round(rx * 0.42)), ey = cy - Math.round(ry * 0.12);
        const [lx, ly] = o.look || [0, 0], blink = o.blink || (B + key.length * 7) % 37 < 2;
        for (const s of [-1, 1]) {
          const ex0 = cx + s * eo - Math.floor(ew / 2), ey0 = ey - Math.floor(ehh / 2);
          if (o.mood === 'happy') { for (let k = -es; k <= es; k++) prect(cx + s * eo + k, ey - (es - Math.abs(k)), 1, 1, ink); continue; }
          if (blink) { prect(ex0, ey0 + ehh - 1, ew, 1, ink); continue; }
          prect(ex0, ey0, ew, ehh, pal.eye);
          const ps = es, px = ex0 + (lx > 0.3 ? ew - ps : lx < -0.3 ? 0 : Math.floor((ew - ps) / 2)), py = ey0 + (ly < -0.3 ? 0 : ehh - ps);
          prect(px, py, ps, ps, pal.pupil);
        }
        const my = cy + Math.max(2, Math.round(ry * 0.38)), mw = Math.max(1, Math.round(R / 6));
        if (wow) prect(cx - Math.floor(mw / 2), my, mw + 1, mw + 1, ink);
        else if (o.mood === 'happy') { prect(cx - mw, my, 2 * mw + 1, 1, ink); prect(cx - mw - 1, my - 1, 1, 1, ink); prect(cx + mw + 1, my - 1, 1, 1, ink); }
        else prect(cx - Math.floor(mw / 2), my, mw + 1, 1, ink);
        if (pal.cheek && R >= 6) for (const s of [-1, 1]) prect(cx + s * (eo + es) - (s < 0 ? 1 : 0), my - 1, 2, 1, pal.cheek);
        const px = W / S.w;
        // head and foot in the caller's world pixels (through its view), x and y in screen px
        return { head: (head - eh - OV.ty) / z, foot: (by - hop + R + 1 + fh - OV.ty) / z, x: (cx + 0.5) * px, y: (cy + 0.5) * px };
      });
    }
    /** A UI panel: a one-pixel border with clipped corners, a fill, an optional shadow down-right. */
    function pixBox(x, y, w, h, o = {}) {
      x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
      if (o.shadow) { prect(x + 2, y + 1, w - 2, h, o.shadow); prect(x + 1, y + 2, w, h - 2, o.shadow); }
      const e = o.edge ?? PAL16.ink;
      prect(x + 1, y, w - 2, h, e); prect(x, y + 1, w, h - 2, e);
      prect(x + 1, y + 1, w - 2, h - 2, o.bg ?? PAL16.white);
    }
    /** A speech bubble with pixel text, or a sprite (o.icon: rows, o.map), its tail pointing down at (x, y). */
    function pixBubble(str, x, y, o = {}) {
      if (!S) return null;
      const sc = o.icon ? 1 : textScale(o) / Math.max(1e-6, V.z);
      const iw = o.icon ? o.icon[0].length : pixTextW(String(str).toUpperCase(), Math.round(sc)), ih = o.icon ? o.icon.length : 7 * Math.round(sc);
      const pad = o.icon ? 2 : 3, w = iw + 2 * pad, h = ih + 2 * pad, x0 = Math.round(x - Math.floor(w / 2)), y0 = Math.round(y) - h - 3;
      const bg = o.bg ?? PAL16.white, e = o.edge ?? PAL16.ink;
      pixBox(x0, y0, w, h, { bg, edge: e });
      prect(Math.round(x) - 1, y0 + h - 1, 3, 2, bg); prect(Math.round(x), y0 + h + 1, 1, 2, e);
      prect(Math.round(x) - 2, y0 + h - 1, 1, 2, e); prect(Math.round(x) + 2, y0 + h - 1, 1, 2, e);
      if (o.icon) sprite(o.icon, o.map || { a: e, b: o.fg ?? e }, x0 + pad, y0 + pad);
      else pixText(str, x0 + pad, y0 + pad, o.fg ?? e, { count: o.count, id: o.id, scale: o.scale });
      return { x0, y0, w, h };
    }
    /** A wooden sign on a post, standing on the ground at (x, base): its board carries the text. */
    function pixSign(str, x, base, o = {}) {
      if (!S) return null;
      const sc = Math.max(1, Math.round(textScale(o) / V.z)), tw = pixTextW(String(str).toUpperCase(), sc), bw = tw + 6, bh = 7 * sc + 6, ph = o.post ?? 6;
      const by = base - ph - bh, x0 = Math.round(x - bw / 2), wood = o.wood ?? PAL16.brown, dark = o.dark ?? PAL16.ink, lt = o.light ?? PAL16.orange;
      prect(Math.round(x) - 1, by + bh - 1, 2, ph + 1, dark);
      pixBox(x0, by, bw, bh, { bg: wood, edge: dark, shadow: o.shadow });
      prect(x0 + 1, by + 1, bw - 2, 1, lt);
      const t = pixText(str, x0 + 3, by + 3, o.fg ?? PAL16.white, { scale: o.scale, count: o.count, id: o.id, shadow: o.textShadow });
      return { x0, y0: by, w: bw, h: bh, box: t.box };
    }
    /** A tag placed in the world (never a frame corner): it pops in at double size for one boil at o.at. */
    function pixTag(str, x, y, o = {}) {
      if (o.at != null && TT < o.at) return null;
      const pop = o.at != null && TT < o.at + 0.067 ? 2 : 1, sc = Math.max(1, Math.round((o.scale ?? 1) * pop));
      const s = String(str).toUpperCase(), tw = pixTextW(s, sc), bw = tw + 6 * sc, bh = 13 * sc;
      const x0 = Math.round(x - (o.align === 'center' ? bw / 2 : o.align === 'right' ? bw : 0)), y0 = Math.round(y);
      pixBox(x0, y0, bw, bh, { bg: o.bg ?? PAL16.ink, edge: o.edge ?? PAL16.yellow, shadow: o.shadow });
      return pixText(s, x0 + 3 * sc, y0 + 3 * sc, o.fg ?? PAL16.yellow, { scale: sc, id: o.id ?? `tag:${s}` });
    }
    /** A strip of palette swatches in a panel (the colours an era has), popping in one by one from o.at every o.every s. */
    function palette(cols, x, y, o = {}) {
      const list = Array.isArray(cols) ? cols : Object.values(cols), sw = o.size ?? 4, gap = o.gap ?? 1, n = list.length;
      const shown = o.at == null ? n : clamp(Math.floor((TT - o.at) / (o.every ?? 0.06) + 1), 0, n);
      if (!shown) return null;
      const w = n * sw + (n - 1) * gap + 4, h = sw + 4;
      pixBox(x, y, w, h, { bg: o.bg ?? PAL16.ink, edge: o.edge ?? PAL16.white });
      for (let i = 0; i < shown; i++) prect(x + 2 + i * (sw + gap), y + 2, sw, sw, list[i]);
      return { w, h };
    }
    /**
     * A caption panel that types itself on (screen layout): o.res (default the current buffer, else [320, 180]), cx or x
     * and y (screen px), at, dur, fg, bg, edge, shadow, scale, cursor. Drawn in the era's own pixels.
     */
    function pixCaption(str, o = {}) {
      if (o.at != null && TT < o.at) return null;
      let out = null;
      const draw = () => screenSpace(() => {
        const px = W / S.w, sc = textScale(o), s = String(str), tw = pixTextW(s.toUpperCase(), sc), bw = tw + 6 * sc, bh = 13 * sc;
        const x0 = o.x != null ? Math.round(o.x / px) : Math.round((o.cx ?? W / 2) / px - bw / 2), y0 = Math.round((o.y ?? 930) / px - bh / 2);
        pixBox(x0, y0, bw, bh, { bg: o.bg ?? PAL16.ink, edge: o.edge ?? PAL16.white, shadow: o.shadow });
        const n = o.at != null ? Math.floor(clamp((TT - o.at) / (o.dur ?? 0.6)) * s.length + 1e-6) : s.length;
        out = pixText(s, x0 + 3 * sc, y0 + 3 * sc, o.fg ?? PAL16.white, { scale: sc / Math.max(1, Math.round(V.z)), count: n, cursor: o.cursor ?? true, id: o.id ?? `caption:${s}` });
      });
      if (S) draw(); else lowres(o.res || [320, 180], draw);
      return out;
    }

    // ---------------------------------------------------------------------
    //  world props for wide frames (world pixels; keyed on B or the beat, so they blink rather than fade)
    // ---------------------------------------------------------------------
    /** Stars that blink on the boil in a box; o.avoid [x, y, r] keeps a moon clear; cols [dim, bright]. */
    function stars(key, n, x0, y0, x1, y1, cols, o = {}) {
      for (let i = 0; i < n; i++) {
        const R = RNG('stars', key, i), x = R.i(x0, x1), y = R.i(y0, y1);
        if (o.avoid && Math.hypot(x - o.avoid[0], y - o.avoid[1]) < o.avoid[2]) continue;
        if ((B + i * 5) % 13 === 0) continue;
        if (i % 6 === 0 && (B + i) % 6 < 3) sprite(SPR.twinkle, { a: cols[0], b: cols[1] }, x - 1, y - 1);
        else pset(x, y, i % 3 ? cols[0] : cols[1]);
      }
    }
    /**
     * A ridge (hills, mountains) from x0 to x1 standing on y, amp px of seeded relief, filled down to o.y1.
     * o: sharp (peaks), span (px between peaks), rim (a lit top edge), rimAmt, dark (the face turned from the light
     * at o.lightX), snow (a colour for the peaks above o.snowAt of amp). Returns hAt(x), the surface height.
     */
    function ridge(key, x0, x1, y, amp, c, o = {}) {
      const R = RNG('ridge', key), span = o.span ?? (o.sharp ? 28 : 40), n = Math.ceil((x1 - x0) / span) + 3, pts = [];
      for (let i = 0; i < n; i++) pts.push(o.sharp ? (i % 2 ? R.r(0.55, 1) : R.r(0, 0.4)) : R.r(0.1, 1));
      const base = (x) => {
        const q = (x - x0) / span, i = Math.max(0, Math.min(n - 2, Math.floor(q))), f = clamp(q - i), a = pts[i], b = pts[i + 1];
        return [o.sharp ? lerp(a, b, f) : lerp(a, b, f * f * (3 - 2 * f)), i];
      };
      const hAt = (x) => {
        const [v, i] = base(x), crag = (Math.sin(x * 0.9 + i * 1.7) * 0.5 + Math.sin(x * 0.37 + i) * 0.5) * (o.sharp ? 0.05 : 0.015);
        return Math.round(y - amp * clamp(v + crag));
      };
      const y1 = o.y1 ?? y + 400, lx = o.lightX ?? -1e9, snowY = y - amp * (o.snowAt ?? 0.72), ks = seedOf(key);
      for (let x = Math.floor(x0); x <= x1; x++) {
        const h = hAt(x), d = base(x)[0] - base(x + 1)[0];   // > 0: the surface falls to the right
        prect(x, h, 1, y1 - h, c);
        if (o.dark && ((d > 0 && lx < x) || (d < 0 && lx > x))) prect(x, h + 1, 1, Math.max(0, y - h + 2), o.dark);
        if (o.snow && h < snowY) prect(x, h, 1, Math.max(1, Math.round(snowY - h - (hash01(x, ks, 1) < 0.5 ? 1 : 0))), o.snow);
        if (o.rim && hash01(x, ks, 2) < (o.rimAmt ?? 0.7)) pset(x, h, o.rim);
      }
      return hAt;
    }
    /** A pine: three stepped tiers, its lit edge on the light's side (rim) so it reads on a dark sky; the tip leans on alternate beats. */
    function pine(x, base, h, w, c, rim, k = 0, o = {}) {
      const sway = (Math.floor(TT / 0.5 + 1e-6) + k) % 2, side = o.left ? -1 : 1;
      prect(x - 1, base - Math.round(h * 0.22), 2, Math.round(h * 0.22) + 1, o.trunk ?? c);
      for (let t = 0; t < 3; t++) {
        const y0 = base - h + Math.round(t * h * 0.25), y1 = y0 + Math.round(h * 0.4), hw = w * (0.5 + 0.3 * t), tip = t === 0 ? sway : 0;
        ppoly([[x + 0.5 + tip, y0], [x + 0.5 + hw, y1], [x + 0.5 - hw, y1]], c);
        if (rim) for (let j = y0 + 1; j < y1; j++) { const e = Math.floor(((j - y0) / (y1 - y0)) * hw + 1e-6); if ((j + t) % 2 === 0 || j === y1 - 1) pset(x + side * e + (side > 0 ? tip : tip), j, rim); }
      }
    }
    /** A puffy cloud of discs with a lit top edge; k varies its shape. */
    function cloud(x, y, c, hi, k = 0, s = 1) {
      const R = RNG('cloud', k), parts = [[0, 0, 5], [6, -3, 6], [13, 0, 5], [6, 2, 5], [19, 1, 4]].slice(0, 3 + (R.i(0, 2)));
      for (const [dx, dy, r] of parts) pcircle(x + dx * s, y + dy * s, r * s, c);
      prect(x - 5 * s, y + 3 * s, (parts.length > 4 ? 28 : 24) * s, 3 * s, c);
      if (hi) for (const [dx, dy, r] of parts) prect(x + dx * s - Math.round(r * s * 0.5), y + dy * s - r * s, Math.round(r * s), 1, hi);
    }
    /** A leafy tree: a canopy of seeded clumps, lit from the top-left (dithered), an outline, its trunk; o: leaf, light, dark, edge, trunk, key. */
    function tree(x, base, r, o = {}) {
      const leaf = o.leaf ?? PAL16.green, lt = o.light ?? PAL16.lime, dk = o.dark ?? null, edge = o.edge ?? PAL16.night, trunk = o.trunk ?? PAL16.brown, R = RNG('tree', o.key ?? x);
      const th = Math.round(r * 1.1), cy = base - th - Math.round(r * 0.6);
      prect(x - Math.max(1, Math.round(r / 5)), base - th - 2, Math.max(2, Math.round(r / 2.5)), th + 2, trunk);
      const sway = (Math.floor(TT / (o.beat ?? 0.5) + 1e-6) + (o.k ?? 0)) % 2;
      const clumps = [[0, 0, 1]];
      for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU + R.r(-0.4, 0.4); clumps.push([Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.45 - r * 0.1, R.r(0.5, 0.75)]); }
      if (!S) return;
      const C = clumps.map(([dx, dy, k]) => [sx(x + dx + (dy < -r * 0.2 ? sway : 0)), sy(cy + dy), r * k * V.z]);
      const CX = sx(x), CY = sy(cy), RR = r * V.z * 1.35, X0 = Math.floor(CX - RR) - 1, X1 = Math.ceil(CX + RR) + 1, Y0 = Math.floor(CY - RR) - 1, Y1 = Math.ceil(CY + RR) + 1;
      const bw = X1 - X0, M = new Uint8Array(Math.max(0, bw * (Y1 - Y0)));
      const inC = (px, py) => C.some(([cx, cy2, rr]) => (px - Math.round(cx)) ** 2 + (py - Math.round(cy2)) ** 2 <= (Math.round(rr) + 0.5) ** 2);
      for (let Y = Y0; Y < Y1; Y++) for (let Xx = X0; Xx < X1; Xx++) if (inC(Xx, Y)) M[(Y - Y0) * bw + Xx - X0] = 1;
      const Lx = CX - RR * 0.45, Ly = CY - RR * 0.55, Dx = CX + RR * 0.5, Dy = CY + RR * 0.45, u = S.u;
      for (let Y = Math.max(0, Y0 + 1); Y < Math.min(S.h, Y1 - 1); Y++) for (let Xx = Math.max(0, X0 + 1); Xx < Math.min(S.w, X1 - 1); Xx++) {
        const m = (Y - Y0) * bw + Xx - X0; if (!M[m]) continue;
        const out = !M[m - 1] || !M[m + 1] || !M[m - bw] || !M[m + bw], b = bay(Xx - V.tx, Y - V.ty);
        const ql = 1 - Math.hypot(Xx - Lx, Y - Ly) / (RR * 0.95), qd = 1 - Math.hypot(Xx - Dx, Y - Dy) / (RR * 0.9);
        u[Y * S.w + Xx] = u32(out && edge ? edge : clamp(ql * 1.6) > b ? lt : dk && clamp(qd * 1.4) > b ? dk : leaf);
      }
    }
    /** Water: rows of colour (cols, near the surface first) with highlight dashes that drift on the boil. */
    function water(key, x, y, w, h, cols, hi, o = {}) {
      pgrad(x, y, w, h, cols, { ease: o.ease });
      const R = RNG('water', key), n = Math.round(((o.density ?? 1) * w * h) / 60);
      for (let i = 0; i < n; i++) {
        const yy = y + R.i(0, h - 1), len = R.i(2, 5), sp = R.r(2, 6), x0 = x + ((R.i(0, w) + Math.floor(TT * sp + 1e-6)) % (w + 8)) - 4;
        if ((B + i) % 7 < 5) prect(x0, yy, len, 1, (yy - y) / h < 0.4 ? hi : cols[Math.min(cols.length - 1, 1)]);
      }
    }
    /** A house: walls, a stepped roof, a door, windows (o.lit true, or a 0..1 share lit on each beat). */
    function house(x, base, w, h, o = {}) {
      const wall = o.wall ?? PAL16.white, roof = o.roof ?? PAL16.red, ink = o.ink ?? PAL16.ink, rh = Math.round(w * 0.45);
      prect(x, base - h, w, h, wall);
      if (o.shade) prect(x + w - Math.max(1, Math.round(w / 5)), base - h, Math.max(1, Math.round(w / 5)), h, o.shade);
      ppoly([[x - 1.5, base - h + 0.5], [x + w / 2, base - h - rh], [x + w + 1.5, base - h + 0.5]], roof);
      if (o.roofHi) pline(x - 1, base - h, Math.round(x + w / 2), base - h - rh + 1, o.roofHi);
      prect(x + Math.floor(w / 2) - 1, base - Math.min(4, h - 2), 3, Math.min(4, h - 2), ink);
      const lit = (i) => (o.lit === true ? true : o.lit ? RNG('house', o.key ?? x, i, Math.floor(TT / (o.beat ?? 0.5) + 1e-6)).r() < o.lit : false);
      if (w >= 9 && h >= 7) [Math.round(w * 0.2), w - Math.round(w * 0.2) - 2].forEach((wx, i) => prect(x + wx, base - h + 2, 2, 2, lit(i) ? (o.light ?? PAL16.yellow) : ink));
    }
    /** A tower block whose windows light and go dark on the beat (o.share lit), its roof edge lit. */
    function building(x, base, w, h, o = {}) {
      const body = o.body ?? PAL16.night, edge = o.edge ?? PAL16.slate, light = o.light ?? PAL16.yellow, dark = o.dark ?? PAL16.ink;
      prect(x, base - h, w, h, body); prect(x, base - h, w, 1, edge);
      const bt = Math.floor(TT / (o.beat ?? 0.5) + 1e-6);
      for (let j = 0; j * 5 + 4 < h - 2; j++) for (let i = 0; i * 4 + 3 < w - 1; i++) prect(x + 2 + i * 4, base - h + 3 + j * 5, 2, 2, RNG('win', o.key ?? x, i, j, bt).r() < (o.share ?? 0.3) ? light : dark);
    }
    /** A lamp post (h px tall) with a dithered glow when lit. */
    function lamp(x, base, h, o = {}) {
      const post = o.post ?? PAL16.ink, light = o.light ?? PAL16.yellow;
      prect(x, base - h, 1, h, post); prect(x - 1, base - 1, 3, 1, post);
      if (o.lit !== false) { pglow(x, base - h - 1, 2, o.glow ?? 7, o.halo ?? light, o.amt ?? 0.45); prect(x - 1, base - h - 2, 3, 2, light); } else prect(x - 1, base - h - 2, 3, 2, o.off ?? PAL16.slate);
      prect(x - 1, base - h - 3, 3, 1, post);
    }
    /** Fireflies: whole-pixel wander, blinking; c the light, hi a twinkle's centre. */
    function fireflies(key, n, x0, y0, x1, y1, c, hi) {
      for (let i = 0; i < n; i++) {
        const R = RNG('ff', key, i), bx = R.i(x0, x1), by = R.i(y0, y1);
        const x = bx + Math.round(3 * Math.sin(TT * 1.3 + i * 2)), y = by + Math.round(2 * Math.sin(TT * 1.9 + i));
        if ((B + i * 3) % 8 >= 5) continue;
        if ((B + i) % 8 < 2) sprite(SPR.twinkle, { a: c, b: hi }, x - 1, y - 1); else pset(x, y, hi);
      }
    }
    /** Birds flapping across: n of them from x0 at speed px/s, at heights round y. */
    function birds(key, n, x0, y, speed, c, o = {}) {
      for (let i = 0; i < n; i++) {
        const R = RNG('bird', key, i), x = x0 + Math.floor(TT * speed + 1e-6) + R.i(-14, 14) - i * 9, yy = y + R.i(-6, 6) + Math.round(Math.sin(TT * 2 + i) * 1.5);
        sprite(SPR.bird[(Math.floor(TT * 6 + 1e-6) + i) % 2], { a: c }, x, yy, { flip: speed < 0, scale: o.scale });
      }
    }
    /** Grass tufts along a ground line that flip on the beat. */
    function grass(x0, x1, y, c, o = {}) {
      const TUFT = [['a..a', '.aa.'], ['.a.a', 'aa..']], bt = Math.floor(TT / (o.beat ?? 0.5) + 1e-6);
      for (let x = x0; x < x1; x += o.every ?? 9) sprite(TUFT[(((bt + x) % 2) + 2) % 2], { a: c }, x, y - 2);
    }

    // ---------------------------------------------------------------------
    //  between eras: grids that step, stepped windows and the morphing bridge object (screen space)
    // ---------------------------------------------------------------------
    const GRIDS = Object.freeze([2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 24, 30, 40, 60]);
    /** The pixel size between Ga and Gb at u (0..1), stepped through sizes that divide 1920x1080. */
    function gridStep(u, Ga, Gb) {
      const want = Ga * (Gb / Ga) ** clamp(u);
      return GRIDS.reduce((best, v) => (Math.abs(Math.log(v / want)) < Math.abs(Math.log(best / want)) ? v : best));
    }
    /** Outline P (screen points) rasterised on a G px grid: { M (1 = inside), cols, rows }. */
    function gridMask(P, G) {
      const cols = Math.ceil(W / G), rows = Math.ceil(H / G), M = new Uint8Array(cols * rows);
      const Q = P.map(([x, y]) => [x / G, y / G]);
      let y0 = 1e9, y1 = -1e9;
      for (const [, y] of Q) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
      y0 = clamp(Math.floor(y0), 0, rows); y1 = clamp(Math.ceil(y1) + 1, 0, rows);
      polySpans(Q, y0, y1).forEach((sp, k) => sp.forEach(([a, b]) => { for (let i = Math.max(0, a); i < Math.min(cols, b); i++) M[(y0 + k) * cols + i] = 1; }));
      return { M, cols, rows };
    }
    /** The cells just outside a mask (8-neighbour): a stepped one-cell rim. */
    function maskRing(m) {
      const { M, cols, rows } = m, O = new Uint8Array(M.length);
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        if (M[j * cols + i]) continue;
        let hit = 0;
        for (let v = -1; v <= 1 && !hit; v++) for (let q = -1; q <= 1; q++) { const a = i + q, b = j + v; if (a >= 0 && b >= 0 && a < cols && b < rows && M[b * cols + a]) { hit = 1; break; } }
        O[j * cols + i] = hit;
      }
      return { M: O, cols, rows };
    }
    const maskOr = (a, b) => ({ M: a.M.map((v, i) => v | b.M[i]), cols: a.cols, rows: a.rows });
    const maskNot = (a) => ({ M: a.M.map((v) => (v ? 0 : 1)), cols: a.cols, rows: a.rows });
    function maskPath(m, G, dx = 0, dy = 0) {
      const { M, cols, rows } = m; g.beginPath();
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols;) {
        if (!M[j * cols + i]) { i++; continue; }
        let k = i + 1; while (k < cols && M[j * cols + k]) k++;
        g.rect((i + dx) * G, (j + dy) * G, (k - i) * G, G); i = k;
      }
    }
    function fillMask(m, G, c, dx = 0, dy = 0) { g.save(); g.setTransform(SC, 0, 0, SC, 0, 0); g.fillStyle = c; maskPath(m, G, dx, dy); g.fill(); g.restore(); }
    /**
     * A stepped window (screen space): P (screen points) rasterised on a G px grid. o.inside() draws what's through it,
     * o.outside a colour (or [a, b, mix] dithered) painted round it; rims: o.rim [light, dark] one cell each, o.shadow.
     */
    function stepWindow(P, o = {}) {
      const G = o.G ?? 6, m = gridMask(P, G), r1 = maskRing(m), u1 = maskOr(m, r1), r2 = maskRing(u1), all = maskOr(u1, r2);
      if (o.outside) {
        const [a, b, t] = Array.isArray(o.outside) ? o.outside : [o.outside, null, 0], out = maskNot(all);
        fillMask(out, G, a);
        if (b && t > 0) { const d = { M: out.M.map((v, i) => (v && t > bayer(i % out.cols, Math.floor(i / out.cols)) ? 1 : 0)), cols: out.cols, rows: out.rows }; fillMask(d, G, b); }
      }
      if (o.shadow !== false) { const sh = { M: all.M.map((v, i) => { const c = i % all.cols, r = Math.floor(i / all.cols); return !v && c > 0 && r > 0 && all.M[i - all.cols - 1] ? 1 : 0; }), cols: all.cols, rows: all.rows }; fillMask(sh, G, o.shadow ?? PIX_UI.shadow); }
      if (o.inside) { g.save(); g.setTransform(SC, 0, 0, SC, 0, 0); maskPath(m, G); g.restore(); g.save(); g.clip(); try { o.inside(); } finally { g.restore(); } }
      const [rl, rd] = o.rim || [PIX_UI.light, PIX_UI.dark];
      if (rd) fillMask(r2, G, rd);
      if (rl) fillMask(r1, G, rl);
      return m;
    }
    /** A shape P (screen points) as chunky dithered pixels at a G px grid, lit top-left, inked rim, in palette pal. */
    function blob(P, c, G, pal = PIX_ALL, o = {}) {
      const m = gridMask(P, G), { M, cols, rows } = m;
      let ax = 0, ay = 0, n = 0;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) if (M[j * cols + i]) { ax += i; ay += j; n++; }
      if (!n) return;
      const cx = ax / n, cy = ay / n, rr = Math.sqrt(n / Math.PI), [ca, cb, ct] = ditherPair(c, pal), lt = nearestC(shadeC(c, 0.45), pal), dk = nearestC(shadeC(c, -0.4), pal);
      const groups = new Map([[ca, []], [cb, []], [lt, []], [dk, []]]);
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        if (!M[j * cols + i]) continue;
        const q = (-(i - cx) - (j - cy)) / rr, b = bayer(i, j);
        groups.get(clamp((q - 0.55) * 1.4) > b ? lt : clamp((-q - 0.5) * 1.4) > b ? dk : ct > bayer(i + 2, j + 1) ? cb : ca).push([i, j]);
      }
      g.save(); g.setTransform(SC, 0, 0, SC, 0, 0);
      if (o.rim !== false) { g.fillStyle = o.rim ?? PIX_UI.dark; maskPath(maskRing(m), G); g.fill(); }
      for (const [col, list] of groups) { if (!list.length) continue; g.fillStyle = col; g.beginPath(); for (const [i, j] of list) g.rect(i * G, j * G, G, G); g.fill(); }
      g.restore();
    }
    /**
     * One era becomes the next, in screen space. Before o.t0: a(). From t0 to t1 the bridge object morphs over a():
     * o.morph(G, u) with G stepping from Ga to Gm (default halfway). From t1 to t2 a stepped window opens round o.at
     * (screen px) from radius o.r0, its grid stepping Gm to Gb: b() inside, a() outside, o.rim and a shadow. After t2: b().
     * Returns the phase: 0 (a), 1 (the morph), 2 (the window), 3 (b).
     */
    function eraMorph(T, o) {
      const { t0, t1, t2, a, b, at, Ga, Gb } = o, Gm = o.Gm ?? gridStep(0.5, Ga, Gb);
      if (T >= t2) { b(); return 3; }
      if (T < t1) { a(); if (T >= t0 && o.morph) o.morph(gridStep(seg(T, t0, t1), Ga, Gm), seg(T, t0, t1)); return T < t0 ? 0 : 1; }
      a();
      const u = seg(T, t1, t2), far = Math.max(...[[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => Math.hypot(x - at[0], y - at[1]))) + 4 * Ga;
      const r = lerp(o.r0 ?? 60, far, (o.ease || EZ.i2)(u)), G = gridStep(Math.min(1, u * 2.2), Gm, Gb);
      const P = [];
      for (let i = 0; i < 64; i++) { const q = (i / 64) * TAU; P.push([at[0] + Math.cos(q) * r, at[1] + Math.sin(q) * r * (o.sy ?? 1)]); }
      stepWindow(P, { G, inside: b, rim: o.rim, shadow: o.shadow });
      return 2;
    }

    // ---------------------------------------------------------------------
    //  screen effects (after the era's picture, on its pixel grid G): scan, lcd, vignette are alphas of black laid over
    //  the scaled-up picture, so the colours they make sit outside the era's palette (the device's screen, not the art)
    //    scan: the bottom third of every pixel row darkened (a tube) · lcd: a thin gap between pixels (a handheld)
    //    vignette: dithered, stepped darkening into the corners (a curved tube); fx.vignette is the palette-true one
    // ---------------------------------------------------------------------
    function pixPost(o, G) {
      g.save(); g.setTransform(SC, 0, 0, SC, 0, 0);
      if (o.lcd) {
        const lw = Math.max(1, Math.round(G / 8)); g.fillStyle = `rgba(0,0,0,${o.lcd})`; g.beginPath();
        for (let x = G - lw; x < W; x += G) g.rect(x, 0, lw, H);
        for (let y = G - lw; y < H; y += G) g.rect(0, y, W, lw);
        g.fill();
      }
      if (o.scan) {
        const sh = Math.max(1, Math.round(G / 3)); g.fillStyle = `rgba(0,0,0,${o.scan})`; g.beginPath();
        for (let y = G - sh; y < H; y += G) g.rect(0, y, W, sh);
        g.fill();
      }
      if (o.vignette) {
        const cols = Math.ceil(W / G), rows = Math.ceil(H / G); g.fillStyle = `rgba(0,0,0,${o.vignette})`; g.beginPath();
        for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
          const dx = ((i + 0.5) / cols) * 2 - 1, dy = ((j + 0.5) / rows) * 2 - 1, v = clamp(((dx ** 4 + dy ** 4) ** 0.25 - 0.86) / 0.16);
          if (v > bay(i, j)) g.rect(i * G, j * G, G, G);
        }
        g.fill();
      }
      g.restore();
    }

    return {
      /** Runtime-internal: the runtime binds the frame; never call it. */
      bind(c) { X = c; g = c.g; B = c.B; TT = c.TT; SC = c.scale || 1; },
      // palettes and colour
      PAL16, HANDHELD, PAL4, PAL8, MONO, PIX_ALL, PIX_UI, BAYER4, bayer, hash01, rgbOf, hexOf, nearestC, ditherPair, shadeC, posterize, mixC,
      // the low-res pass and the camera
      lowres, withGrid, pixFX, pixToScreen, pixFromWorld, pixToWorld, PIX, view, withView, depth, screenSpace,
      // primitives
      cellR, pset, prect, pfill, pline, pellipse, pcircle, ppoly, polySpans, pdither, pgrad, pglow,
      // type and sprites
      FONT5, pixText, pixTextW, pixLetters, sprite, SPR, coin,
      // the hero and panels
      pixHero, HERO_PAL, HERO_HH, HERO_8, pixBox, pixBubble, pixSign, pixTag, palette, pixCaption,
      // world props
      stars, ridge, pine, tree, cloud, water, house, building, lamp, fireflies, birds, grass,
      // between eras and on the screen
      GRIDS, gridStep, gridMask, maskRing, stepWindow, blob, eraMorph, pixPost,
    };
  },
});
