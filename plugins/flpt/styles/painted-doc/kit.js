// =====================================================================
//  engine/styles/painted-doc/kit.js · Painted Documentary (an FLPT original, Bombadillo AI, 2026; MIT, see LICENSE).
//  The animated-history documentary look, drawn in code: painted plates that hold still while the camera pushes,
//  parallax layers, painted cut-out puppets (three values toward one light, a soft rim), one dramatic light, ink-wipes
//  between beats, motes in the light, film grain and a heavy vignette. Teal and amber, aged cream, one oxblood.
//  On twos by default (limited animation); a scene may ask for ones.
//
//  Everything heavy (the plates, the grain, the vignette, the brush textures) is painted once, in setup or on first
//  use, from seeded randomness, and composited per frame; a frame is a few drawImage calls, the puppets' paths,
//  the light and the type.
//
//    K.world(key, spec)            a stack of painted plates (sky, ridges, hill, valley, ground) at parallax depths
//    K.view(cam) · K.path(T, keys)  the camera for this frame: { z, p: [x, y] } puts world point p at the centre
//    K.draw(world, o)              the plates, each at its depth; o.between: { depth: fn } draws your things in between
//    K.layer(k, fn)                draw fn in the world at parallax depth k (1 = the subject's plane)
//    K.figure(x, y, o)             a puppet: curved parts, three values toward one light, a soft rim, an ink line
//    K.fire, K.firelight, K.star, K.shaft, K.glow, K.flood, K.motes, K.embers, K.twinkle   light, water, particles
//    K.wipe(T, t0, dur, a, b, o)   an ink-wipe from a to b (each a function that draws a shot)
//    K.label, K.title, K.line      type: a tracked mono label, a painted serif title, words that land on their cues
//    K.finish(o)                   grade, grain, gate and vignette, last; in a Duet the presenter's corner stays calm
// =====================================================================
FLPT.style('painted-doc', {
  tokens: {
    paper: '#1b2122', ink: '#191411', cream: '#eee0bf', amber: '#de9c48', ember: '#f2c26e', rust: '#a35f2a',
    teal: '#2e5d61', deep: '#163035', night: '#0d1619', haze: '#7fa19b', oxblood: '#7b292b', moss: '#5b6741', umber: '#4b3a2a',
    skin: '#c99a70', font: '"Painted Doc Serif", serif',
  },
  fonts: [
    { family: 'Painted Doc Serif', file: 'fraunces-display-semibold.ttf', weight: 620 },
    { family: 'Painted Doc Italic', file: 'fraunces-italic.ttf', weight: 480, style: 'italic' },
    { family: 'Painted Doc Mono', file: 'IBMPlexMono-SemiBold.ttf', weight: 600 },
  ],
  ones: false,
  make(env) {
    const { W, H, rng: RNG, clamp, lerp } = env;
    const TAU = Math.PI * 2, CX = W / 2, CY = H / 2;
    const tk = env.tokens;
    const EZ = env.EZ;
    let C = null, g = null, S = 1;          // bound per frame
    let CAM = { z: 1, p: [CX, CY] };

    // ───────────────────────── colour ─────────────────────────
    const hex = (h) => { const s = String(h).replace('#', ''); return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]; };
    const rgba = (c, a = 1) => `rgba(${Math.round(clamp(c[0], 0, 255))},${Math.round(clamp(c[1], 0, 255))},${Math.round(clamp(c[2], 0, 255))},${+clamp(a).toFixed(4)})`;
    const mix = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
    const dim = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
    const PAL = {};
    for (const k of ['ink', 'cream', 'amber', 'ember', 'rust', 'teal', 'deep', 'night', 'haze', 'oxblood', 'moss', 'umber', 'skin']) PAL[k] = hex(tk[k] || '#808080');
    const col = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v[0] === '#' ? hex(v) : PAL[v] || PAL.ink);
    /** A colour on a ramp: stops [[u, colour], …] in u order. */
    function ramp(stops, u) {
      if (u <= stops[0][0]) return col(stops[0][1]);
      for (let i = 1; i < stops.length; i++) if (u <= stops[i][0]) { const a = stops[i - 1], b = stops[i]; return mix(col(a[1]), col(b[1]), (u - a[0]) / (b[0] - a[0] || 1)); }
      return col(stops[stops.length - 1][1]);
    }

    // ───────────────────────── noise (pure, seeded) ─────────────────────────
    const hashI = (i, s) => { let x = Math.imul((i | 0) ^ Math.imul(s | 0, 0x27d4eb2d), 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };
    const sstep = (u) => u * u * (3 - 2 * u);
    function noise1(x, s) { const i = Math.floor(x), f = x - i; return lerp(hashI(i, s), hashI(i + 1, s), sstep(f)); }
    function fbm(x, s, oct = 4) { let v = 0, a = 0.5, f = 1, n = 0; for (let o = 0; o < oct; o++) { v += a * noise1(x * f, s + o * 101); n += a; a *= 0.5; f *= 2.03; } return v / n; }
    const seedOf = (...k) => env.fnv(...k) | 0;
    function noise2(x, y, s) {
      const ix = Math.floor(x), iy = Math.floor(y), fx = sstep(x - ix), fy = sstep(y - iy), h2 = (a, b) => hashI(a + Math.imul(b, 7919), s);
      return lerp(lerp(h2(ix, iy), h2(ix + 1, iy), fx), lerp(h2(ix, iy + 1), h2(ix + 1, iy + 1), fx), fy);
    }
    function fbm2(x, y, s, oct = 4) { let v = 0, a = 0.5, f = 1, n = 0; for (let o = 0; o < oct; o++) { v += a * noise2(x * f, y * f, s + o * 131); n += a; a *= 0.5; f *= 2.07; } return v / n; }

    // ───────────────────────── painting (offscreen, once) ─────────────────────────
    const canvas = (w, h) => env.canvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
    /** A gouache stroke: bristles along the stroke, each its own width, tone and dry-out. */
    function brush(p, R, x, y, ang, len, w, c, a, o = {}) {
      const n = o.n || Math.max(3, Math.min(12, Math.round(w / 2.4)));
      const ca = Math.cos(ang), sa = Math.sin(ang), nx = -sa, ny = ca, bend = R.n(o.bend ?? 0.1) * len;
      p.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const off = ((i + 0.5) / n - 0.5) * w + R.n(w * 0.05), l = len * R.r(o.dry ? 0.4 : 0.7, 1), s0 = R.r(-0.04, 0.14) * len - len / 2;
        const v = R.n(o.vary ?? 8);
        p.strokeStyle = rgba([c[0] + v, c[1] + v, c[2] + v * 0.85], a * R.r(0.45, 1));
        p.lineWidth = Math.max(0.6, (w / n) * R.r(0.9, 2.1));
        const x0 = x + ca * s0 + nx * off, y0 = y + sa * s0 + ny * off, x1 = x0 + ca * l, y1 = y0 + sa * l, k = Math.sin(((i + 0.5) / n) * Math.PI);
        p.beginPath(); p.moveTo(x0, y0); p.quadraticCurveTo((x0 + x1) / 2 + nx * bend * k, (y0 + y1) / 2 + ny * bend * k, x1, y1); p.stroke();
      }
    }
    /** The board's tooth: a little luminance noise on every painted pixel. */
    function tooth(p, w, h, key, amt = 7) {
      const d = p.getImageData(0, 0, w, h), a = d.data, R = RNG('tooth', key);
      for (let i = 0; i < a.length; i += 4) { if (!a[i + 3]) continue; const n = (R.f() - 0.5) * amt * 2; a[i] += n; a[i + 1] += n; a[i + 2] += n * 0.9; }
      p.putImageData(d, 0, 0);
    }
    /** Colour of an already painted canvas at a point (the strokes take their colour from what's under them). */
    function sampler(p, w, h) {
      const d = p.getImageData(0, 0, w, h).data;
      return (x, y) => { const i = (clamp(Math.round(y), 0, h - 1) * w + clamp(Math.round(x), 0, w - 1)) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; };
    }
    /** A smooth closed path through control points (curves between their midpoints); a point [x, y, 1] stays a corner. */
    function shapeTo(G, P, dx = 0, dy = 0) {
      const n = P.length, X = (i) => P[i % n][0] + dx, Y = (i) => P[i % n][1] + dy;
      G.moveTo((X(n - 1) + X(0)) / 2, (Y(n - 1) + Y(0)) / 2);
      for (let i = 0; i < n; i++) {
        const mx = (X(i) + X(i + 1)) / 2, my = (Y(i) + Y(i + 1)) / 2;
        if (P[i][2]) { G.lineTo(X(i), Y(i)); G.lineTo(mx, my); } else G.quadraticCurveTo(X(i), Y(i), mx, my);
      }
      G.closePath();
    }
    /** A smooth open line through points. */
    function curveTo(G, P) {
      G.moveTo(P[0][0], P[0][1]);
      for (let i = 1; i < P.length - 1; i++) G.quadraticCurveTo(P[i][0], P[i][1], (P[i][0] + P[i + 1][0]) / 2, (P[i][1] + P[i + 1][1]) / 2);
      G.lineTo(P[P.length - 1][0], P[P.length - 1][1]);
    }
    /** A tapered limb along joints [[x, y, width], …]: its outline as control points, rounded at both ends. */
    function limb(J) {
      const n = J.length, A = [], Bk = [], dir = (i) => { const a = J[Math.max(0, i - 1)], b = J[Math.min(n - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
      for (let i = 0; i < n; i++) { const [dx, dy] = dir(i), w = J[i][2] / 2; A.push([J[i][0] - dy * w, J[i][1] + dx * w]); Bk.push([J[i][0] + dy * w, J[i][1] - dx * w]); }
      const d0 = dir(0), d1 = dir(n - 1);
      return [[J[0][0] - d0[0] * J[0][2] * 0.42, J[0][1] - d0[1] * J[0][2] * 0.42], ...A, [J[n - 1][0] + d1[0] * J[n - 1][2] * 0.42, J[n - 1][1] + d1[1] * J[n - 1][2] * 0.42], ...Bk.reverse()];
    }
    /** A rounded boulder's outline (control points) on a flat base: w wide, h tall, centred on x, sitting on y. */
    function boulder(R, x, y, w, h) {
      const P = [[x - w * 0.5, y, 1]], tilt = R.n(0.25);
      for (let i = 0; i <= 8; i++) { const a = Math.PI + (i / 8) * Math.PI, k = R.r(0.78, 1.1), sk = 1 + tilt * Math.cos(a); P.push([x + Math.cos(a) * w * 0.52 * k, y + Math.sin(a) * h * k * sk * (i === 0 || i === 8 ? 0.4 : 1)]); }
      P.push([x + w * 0.5, y, 1]);
      return P;
    }
    const PLATES = new Map();
    const once = (key, make) => { if (!PLATES.has(key)) PLATES.set(key, make()); return PLATES.get(key); };

    // ── the sky: a gradient, its glow, brushed over with its own colours, clouds lit from the light, stars
    function skyPlate(key, o) {
      return once('sky|' + key, () => {
        const x0 = o.x0 ?? -200, y0 = o.y0 ?? -800, w = o.w ?? 2320, h = o.h ?? 2050, hz = o.horizon ?? 700;
        const c = canvas(w, h), p = c.getContext('2d', { willReadFrequently: true }), R = RNG('sky', key);
        const stops = o.stops || [[0, 'night'], [0.55, 'deep'], [0.85, 'teal'], [1, 'haze']];
        const gr = p.createLinearGradient(0, 0, 0, hz - y0);
        for (const [u, s] of stops) gr.addColorStop(clamp(u), rgba(col(s)));
        p.fillStyle = gr; p.fillRect(0, 0, w, h);
        const L = o.light ? [o.light[0] - x0, o.light[1] - y0] : null;
        if (o.glow) {
          const gl = o.glow, gx = gl.x - x0, gy = gl.y - y0, r = gl.r || 900;
          for (const [rr, aa] of [[r, gl.a ?? 0.7], [r * 0.45, (gl.a ?? 0.7) * 0.8]]) {
            const q = p.createRadialGradient(gx, gy, 0, gx, gy, rr);
            q.addColorStop(0, rgba(col(gl.color || 'amber'), aa)); q.addColorStop(0.5, rgba(col(gl.color || 'amber'), aa * 0.35)); q.addColorStop(1, rgba(col(gl.color || 'amber'), 0));
            p.fillStyle = q; p.fillRect(0, 0, w, h);
          }
        }
        // brush the sky with its own colours: long, nearly level strokes, then shorter dabs that break the bands
        const at = sampler(p, w, h), n = Math.round((w * h) / 2200);
        for (let i = 0; i < n; i++) {
          const x = R.r(-60, w + 60), y = R.r(0, h), c0 = at(x, y), toward = R.f();
          const tint = toward < 0.38 ? PAL.cream : toward < 0.7 ? PAL.deep : PAL.haze;
          brush(p, R, x, y, R.n(0.06) + (o.tilt || 0), R.r(110, 380), R.r(10, 30), mix(c0, tint, R.r(0.04, 0.16)), R.r(0.22, 0.5), { vary: 7 });
        }
        for (let i = 0; i < n * 0.6; i++) {
          const x = R.r(0, w), y = R.r(0, h), c0 = at(x, y);
          brush(p, R, x, y, R.n(0.35), R.r(20, 70), R.r(6, 16), mix(c0, R.f() < 0.5 ? PAL.cream : PAL.night, R.r(0.05, 0.14)), R.r(0.18, 0.4), { vary: 6, dry: true });
        }
        // the milky band and the stars, fading into the haze near the horizon
        if (o.stars) {
          const band = o.band;
          if (band) {
            const ang = Math.atan2(band[1][1] - band[0][1], band[1][0] - band[0][0]);
            for (let i = 0; i < 2600; i++) {
              const u = R.f(), bx = lerp(band[0][0], band[1][0], u) - x0, by = lerp(band[0][1], band[1][1], u) - y0, spread = R.n(1) * R.n(1) * (band[2] || 160);
              const sx = bx - Math.sin(ang) * spread, sy = by + Math.cos(ang) * spread;
              if (i < 340) brush(p, R, sx, sy, ang + R.n(0.25), R.r(50, 160), R.r(10, 34), mix(PAL.haze, PAL.cream, R.r(0.2, 0.6)), R.r(0.03, 0.09), { vary: 4 });
              else { p.fillStyle = rgba(PAL.cream, R.r(0.12, 0.55)); p.fillRect(sx, sy, R.r(0.7, 1.5), R.r(0.7, 1.5)); }
            }
          }
          for (let i = 0; i < o.stars; i++) {
            const x = R.r(0, w), y = R.r(0, Math.max(10, hz - y0 - 40)), fall = clamp(1 - (y + y0 - (hz - 560)) / 560), m = R.f() ** 4;
            if (fall <= 0.02) continue;
            const r = 0.55 + m * 2.0, a = (0.3 + 0.7 * R.f()) * fall;
            if (m > 0.42) { const q = p.createRadialGradient(x, y, 0, x, y, r * 4.5); q.addColorStop(0, rgba(PAL.cream, a * 0.35)); q.addColorStop(1, rgba(PAL.cream, 0)); p.fillStyle = q; p.fillRect(x - r * 5, y - r * 5, r * 10, r * 10); }
            p.fillStyle = rgba(R.f() < 0.12 ? PAL.ember : R.f() < 0.2 ? PAL.haze : PAL.cream, a); p.beginPath(); p.arc(x, y, r, 0, TAU); p.fill();
          }
        }
        // clouds: a mass from a noise field inside an envelope with a flatter base; a soft body first, then strokes
        // that follow its contours; where the outward edge faces the light it catches it, hottest nearest the light
        for (const [ci, cl] of (o.clouds || []).entries()) {
          const cx = cl.x - x0, cy = cl.y - y0, cw = cl.w || 600, ch = cl.h || 120, lit = col(cl.lit || 'amber'), hot = mix(lit, PAL.cream, 0.55), sd = seedOf('cloud', key, ci);
          const bx = Math.floor(cx - cw * 0.6), by = Math.floor(cy - ch * 0.9), bw = Math.ceil(cw * 1.2), bh = Math.ceil(ch * 1.6), sc = cl.scale || 170;
          const Ld = L ? (() => { const dx = L[0] - cx, dy = L[1] - cy, dl = Math.hypot(dx, dy) || 1; return [dx / dl, dy / dl]; })() : [0, 1];
          const dens = (x, y) => {
            const ex = (x - cx) / (cw * 0.5), ey = (y - cy) / (ch * 0.5), env0 = 1 - ex * ex - (ey > 0 ? ey * ey * 2.6 : ey * ey * 0.8);
            return env0 * 0.75 + (fbm2(x / sc, y / (sc * 0.55), sd, 4) - 0.5) * 1.6 + (cl.fill ?? 0);
          };
          const thr = 0.25, step = 3, gw = Math.ceil(bw / step), gh = Math.ceil(bh / step), D = new Float32Array(gw * gh);
          for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) D[j * gw + i] = dens(bx + i * step, by + j * step);
          const Dat = (x, y) => { const i = clamp(Math.round((x - bx) / step), 0, gw - 1), j = clamp(Math.round((y - by) / step), 0, gh - 1); return D[j * gw + i]; };
          const under = at(clamp(cx, 0, w - 1), clamp(cy + ch, 0, h - 1)), body = col(cl.color || mix(mix(PAL.deep, under, 0.28), PAL.night, cl.dark ?? 0.25));
          // the body, soft-edged
          const tc = canvas(gw, gh), tp = tc.getContext('2d'), id = tp.createImageData(gw, gh);
          for (let k = 0; k < D.length; k++) { const a = clamp((D[k] - thr) / 0.18) * 0.92 * (cl.a ?? 1); id.data[k * 4] = body[0]; id.data[k * 4 + 1] = body[1]; id.data[k * 4 + 2] = body[2]; id.data[k * 4 + 3] = Math.round(a * 255); }
          tp.putImageData(id, 0, 0);
          p.save(); p.imageSmoothingEnabled = true; p.drawImage(tc, bx, by, gw * step, gh * step); p.restore();
          // strokes on the contours
          const N = Math.round((bw * bh) / (cl.density || 150));
          for (let i = 0; i < N; i++) {
            const x = bx + R.r(0, bw), y = by + R.r(0, bh), dv = Dat(x, y);
            if (dv < thr - 0.02) continue;
            const gx = Dat(x + 6, y) - Dat(x - 6, y), gy = Dat(x, y + 6) - Dat(x, y - 6), gl = Math.hypot(gx, gy) || 1e-6;
            const nx = -gx / gl, ny = -gy / gl, edge = 1 - clamp((dv - thr) / 0.5), face = clamp(nx * Ld[0] + ny * Ld[1]);
            const k = clamp(face * (0.35 + 0.65 * edge) * 1.25);
            let ang = Math.atan2(ny, nx) + Math.PI / 2;   // the contour's direction, folded into -90..90 degrees
            if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
            const tone = k > 0.82 ? mix(lit, hot, (k - 0.82) * 4) : mix(mix(body, PAL.deep, R.r(0, 0.25)), lit, k * k * (cl.rim ?? 1));
            brush(p, R, x, y, ang * 0.45 + R.n(0.08) + (cl.tilt || 0), R.r(14, 42) * (1 + edge * 0.5), R.r(7, 16), tone, R.r(0.35, 0.8) * (cl.a ?? 1), { vary: 6, bend: 0.15 });
          }
          // long wisps along the base
          for (let i = 0; i < Math.round(cw / 34); i++) {
            const x = cx + R.n(cw * 0.5), y = cy + ch * R.r(0.25, 0.45), k = clamp(Ld[1] * 0.9 + 0.15);
            if (Dat(x, y - 12) < thr - 0.1) continue;
            brush(p, R, x, y, R.n(0.03) + (cl.tilt || 0), R.r(80, 240), R.r(3, 7), mix(body, lit, k * 0.8), R.r(0.2, 0.5) * (cl.a ?? 1), { vary: 5, n: 3 });
          }
        }
        tooth(p, w, h, key, 6);
        return { c, x: x0, y: y0, w, h, k: o.k ?? DEPTH.sky, kind: 'sky', top: col(stops[0][1]) };
      });
    }

    // ── ridges and hills: a profile from noise, painted along its slopes, rim-lit where it faces the light
    function profile(o, x) {
      const s = o.seed ?? 1, sc = o.scale || 600;
      let y = o.base - (fbm(x / sc, s, 4) - 0.5) * 2 * (o.amp ?? 120);
      for (const [px, py, pw] of o.peak ? [o.peak, ...(o.peaks || [])] : o.peaks || []) { const d = (x - px) / (pw || 400); y = Math.min(y, lerp(y, py, Math.exp(-d * d * 2.2))); }
      return y;
    }
    function ridgePlate(key, o) {
      return once('ridge|' + key, () => {
        const x0 = o.x0 ?? -480, w = o.w ?? 2880, step = 4;
        let hi = Infinity;
        for (let x = 0; x <= w + step; x += step) hi = Math.min(hi, profile(o, x + x0));
        const tall = Math.max(0, ...(o.trees || []).map((t) => t.h || 220));
        const y0 = o.y0 ?? Math.floor(hi - 40 - tall * 1.05), h = o.h ?? Math.max(60, (o.bottom ?? 1300) - y0);
        const c = canvas(w, h), p = c.getContext('2d', { willReadFrequently: true }), R = RNG('ridge', key);
        const pts = [];
        for (let x = 0; x <= w + step; x += step) pts.push([x, profile(o, x + x0) - y0]);
        const shape = () => { p.beginPath(); p.moveTo(0, h + 10); for (const [x, y] of pts) p.lineTo(x, y); p.lineTo(w, h + 10); p.closePath(); };
        const topC = col(o.color || 'teal'), low = col(o.low || dim(topC, 0.55));
        const minY = Math.min(...pts.map((q) => q[1]));
        const gr = p.createLinearGradient(0, minY, 0, h);
        gr.addColorStop(0, rgba(topC)); gr.addColorStop(1, rgba(low));
        p.save(); shape(); p.clip();
        p.fillStyle = gr; p.fillRect(0, 0, w, h);
        // strokes follow the slope; a few darker for form
        const n = Math.round((w * (h - minY)) / 900);
        for (let i = 0; i < n; i++) {
          const x = R.r(0, w), xi = Math.min(pts.length - 2, Math.floor(x / step)), yt = pts[xi][1], y = R.r(yt - 8, h);
          const slope = Math.atan2(pts[xi + 1][1] - pts[xi][1], step), depth = clamp((y - yt) / Math.max(60, h - yt));
          const base = mix(topC, low, depth), shade = R.f() < 0.25 ? dim(base, 0.78) : mix(base, PAL.cream, R.r(0, 0.06));
          brush(p, R, x, y, slope * (1 - depth * 0.8) + R.n(0.12), R.r(40, 160), R.r(6, 22), shade, R.r(0.25, 0.6), { vary: 7 });
        }
        if (o.fields) {   // the valley floor: strips of fields in perspective, laid on the slope's lower part
          for (let i = 0; i < o.fields; i++) {
            const fx = R.r(0, w), fy = R.r(minY + (h - minY) * 0.15, h), fw = R.r(180, 520) * (0.4 + 1.2 * (fy - minY) / (h - minY)), fh = fw * R.r(0.08, 0.15);
            const fc = mix(R.pick([PAL.moss, PAL.rust, PAL.amber, PAL.moss, PAL.moss, mix(PAL.cream, PAL.amber, 0.5)]), topC, R.r(0.2, 0.45));
            p.save(); p.translate(fx, fy); p.rotate(R.n(0.05));
            for (let k = 0; k < 9; k++) brush(p, R, R.n(fw * 0.28), R.n(fh * 0.35), R.n(0.03), fw * R.r(0.5, 0.9), fh * R.r(0.3, 0.6), fc, R.r(0.45, 0.8), { vary: 5, dry: true });
            p.strokeStyle = rgba(dim(topC, 0.55), 0.5); p.lineWidth = Math.max(1, fh * 0.12); p.lineCap = 'round';
            p.beginPath(); p.moveTo(-fw * 0.5, fh * 0.5); p.lineTo(fw * 0.5, fh * 0.45); p.stroke();
            p.restore();
          }
        }
        p.restore();
        // the light falling across the land: warmer and lighter toward it
        if (o.lightAt) {
          const [lx, ly] = [o.lightAt[0] - x0, o.lightAt[1] - y0], q = p.createRadialGradient(lx, ly, 0, lx, ly, o.lightR || 1400);
          q.addColorStop(0, rgba(col(o.lightColor || 'amber'), o.lightA ?? 0.3)); q.addColorStop(1, rgba(col(o.lightColor || 'amber'), 0));
          p.save(); shape(); p.clip(); p.globalCompositeOperation = 'screen'; p.fillStyle = q; p.fillRect(0, 0, w, h); p.restore();
        }
        // the rim: light caught along the edge where it faces the light, soft inside the shape, brightest at the edge
        if (o.rim) {
          const rc = col(o.rim.color || 'amber'), L = o.rim.dir || [0.8, -0.6], ll = Math.hypot(L[0], L[1]) || 1;
          p.save(); shape(); p.clip(); p.lineCap = 'round'; p.lineJoin = 'round';
          for (const [wd, aa] of [[26, 0.1], [12, 0.18], [4, 0.45]]) {
            for (let i = 1; i < pts.length; i += 6) {
              const j = Math.min(pts.length - 1, i + 6), dx = pts[j][0] - pts[i - 1][0], dy = pts[j][1] - pts[i - 1][1], dl = Math.hypot(dx, dy) || 1;
              const f = clamp(((dy / dl) * L[0] + (-dx / dl) * L[1]) / ll * 1.3 - 0.15) * (0.7 + 0.3 * noise1(i / 20, 5));
              if (f <= 0.03) continue;
              p.strokeStyle = rgba(rc, (o.rim.a ?? 0.8) * aa * f * 2); p.lineWidth = wd;
              p.beginPath(); for (let k = i - 1; k <= j; k++) (k === i - 1 ? p.moveTo(pts[k][0], pts[k][1]) : p.lineTo(pts[k][0], pts[k][1])); p.stroke();
            }
          }
          p.restore();
        }
        if (o.outline) { p.strokeStyle = rgba(PAL.ink, o.outline); p.lineWidth = 2.2; p.lineJoin = 'round'; p.beginPath(); pts.forEach(([x, y], k) => (k ? p.lineTo(x, y) : p.moveTo(x, y))); p.stroke(); }
        if (o.grass) {   // clumps along the edge and a few below it: blades fanning from a root, leaning with the wind
          const wind = o.wind ?? 0.18, clumps = Math.round(o.grass / 6);
          for (let i = 0; i < clumps; i++) {
            const x = R.r(0, w), xi = Math.min(pts.length - 1, Math.floor(x / step)), y = pts[xi][1] + R.r(0, 1) ** 3 * (o.grassDepth ?? 70) + 3;
            if (o.calm && x + x0 > o.calm[0] && x + x0 < o.calm[2] && y + y0 > o.calm[1] && y + y0 < o.calm[3]) continue;
            const blades = R.i(5, 11), gs = o.grassScale ?? 1, hgt = R.r(12, 36) * gs * (0.6 + fbm((x + x0) / 300, 77) * 0.8);
            const tone = mix(low, topC, R.r(0.15, 0.6));
            for (let b = 0; b < blades; b++) {
              // a blade: a thin tapered stroke of the land's own colours, its tip catching the light now and then
              const a = -Math.PI / 2 + wind + R.n(0.45), l = hgt * R.r(0.45, 1), bx = x + R.n(5 * gs), wd = R.r(1.2, 2.6) * gs ** 0.5;
              const tx = bx + Math.cos(a + wind * 0.6) * l, ty = y + Math.sin(a) * l, mx = bx + Math.cos(a) * l * 0.45, my = y + Math.sin(a) * l * 0.5;
              const litTip = o.rim && R.f() < 0.3;
              p.fillStyle = rgba(litTip ? mix(col(o.rim.color || 'amber'), tone, 0.45) : mix(dim(tone, R.r(0.6, 1)), low, R.r(0, 0.4)), R.r(0.55, 0.85));
              p.beginPath(); p.moveTo(bx - wd, y); p.quadraticCurveTo(mx - wd * 0.6, my, tx, ty); p.quadraticCurveTo(mx + wd * 0.6, my, bx + wd, y); p.closePath(); p.fill();
            }
          }
        }
        for (const t of o.trees || []) tree(p, t.x - x0, profile(o, t.x) - y0 + 4, t.h || 220, { seed: t.seed ?? key, light: o.rim ? o.rim.dir : null, color: t.color || dim(low, 0.7), lit: o.rim ? o.rim.color : null });
        for (const r of o.rocks || []) rock(p, r.x - x0, (r.y ?? profile(o, r.x)) - y0, r.r || 40, { seed: r.seed ?? key, light: o.rim ? o.rim.dir : [0.6, -0.8], color: r.color || mix(low, PAL.umber, 0.4), lit: o.rim ? o.rim.color : null });
        for (const pr of o.props || []) prop(p, pr, pr.x - x0, (pr.y ?? profile(o, pr.x)) - y0, { seed: key, color: pr.color || dim(low, 0.8), lit: col(pr.lit || (o.rim && o.rim.color) || 'amber'), light: pr.light || (o.rim && o.rim.dir) || [0, -1] });
        tooth(p, w, h, key, 6);
        return { c, x: x0, y: y0, w, h, k: o.k ?? 1, kind: 'ridge', name: o.name || null, profile: (x) => profile(o, x) };
      });
    }
    /** A painted tree on a plate: a curved trunk, a few limbs, clustered foliage lit on the light side. */
    function tree(p, x, y, h, o = {}) {
      const R = RNG('tree', o.seed ?? 't', x | 0), base = col(o.color || 'deep'), lit = o.lit ? col(o.lit) : null, L = o.light || [0.7, -0.7];
      const lean = R.n(0.12), trunk = [];
      for (let i = 0; i <= 10; i++) { const u = i / 10; trunk.push([x + Math.sin(u * 2.2 + R.r(0, 1)) * h * 0.03 + lean * u * h * 0.4, y - u * h * 0.62]); }
      p.lineCap = 'round';
      for (let i = 1; i < trunk.length; i++) { p.strokeStyle = rgba(dim(base, 0.6)); p.lineWidth = lerp(h * 0.07, h * 0.02, i / trunk.length); p.beginPath(); p.moveTo(trunk[i - 1][0], trunk[i - 1][1]); p.lineTo(trunk[i][0], trunk[i][1]); p.stroke(); }
      const tip = trunk[trunk.length - 1];
      for (let b = 0; b < 5; b++) { const st = trunk[R.i(4, 9)], a = -Math.PI / 2 + R.n(1.1), l = h * R.r(0.15, 0.3); p.strokeStyle = rgba(dim(base, 0.6)); p.lineWidth = h * 0.015; p.beginPath(); p.moveTo(st[0], st[1]); p.quadraticCurveTo(st[0] + Math.cos(a) * l * 0.6, st[1] + Math.sin(a) * l * 0.4, st[0] + Math.cos(a) * l, st[1] + Math.sin(a) * l); p.stroke(); }
      const blobs = [];
      for (let i = 0; i < 9; i++) blobs.push([tip[0] + R.n(h * 0.28), tip[1] + R.n(h * 0.16) + h * 0.05, h * R.r(0.1, 0.19)]);
      for (const [bx, by, br] of blobs) {
        for (let k = 0; k < 26; k++) {
          const a = R.r(0, TAU), rr = br * Math.sqrt(R.f()), sx = bx + Math.cos(a) * rr, sy = by + Math.sin(a) * rr * 0.8;
          const f = lit ? clamp(((sx - bx) * L[0] + (sy - by) * L[1]) / br) : 0;
          brush(p, R, sx, sy, R.n(0.8), R.r(10, 26), R.r(5, 12), lit ? mix(base, lit, f * f * 0.7) : base, R.r(0.5, 0.9), { vary: 5 });
        }
      }
    }
    /** A rock on a plate: a rounded boulder, brushed, its top lit, its underside dark, a fine ink edge. */
    function rock(p, x, y, r, o = {}) {
      const R = RNG('rock', o.seed ?? 'r', x | 0), base = col(o.color || 'umber'), P = boulder(R, x, y + r * 0.08, r * 2.5, r * 1.15);
      const L = o.light || [0.6, -0.8], lit = o.lit ? col(o.lit) : mix(base, PAL.haze, 0.5);
      p.save(); p.beginPath(); shapeTo(p, P); p.clip();
      p.fillStyle = rgba(dim(base, 0.62)); p.fillRect(x - r * 2, y - r * 2, r * 4, r * 3);
      p.beginPath(); p.rect(x - r * 3, y - r * 3, r * 6, r * 6); shapeTo(p, P, -L[0] * r * 0.32, -L[1] * r * 0.42); p.fillStyle = rgba(mix(base, lit, 0.32), 0.9); p.fill('evenodd');
      for (let k = 0; k < 22; k++) { const sx = x + R.n(r * 1.1), sy = y - R.r(0, r * 1.05); brush(p, R, sx, sy, R.n(0.5) + (sx - x) / (r * 4), R.r(8, 26), R.r(3, 9), mix(base, R.f() < 0.4 ? lit : PAL.deep, R.r(0.05, 0.3)), R.r(0.25, 0.55), { vary: 5 }); }
      p.fillStyle = rgba(PAL.night, 0.35); p.fillRect(x - r * 2, y - r * 0.18, r * 4, r);
      p.restore();
      p.beginPath(); shapeTo(p, P); p.strokeStyle = rgba(PAL.ink, 0.6); p.lineWidth = 1.6; p.lineJoin = 'round'; p.stroke();
    }
    /** A dark prop on a plate (a foreground silhouette): a log, a bag or a stone; its edge lit from o.light. */
    function prop(p, pr, x, y, o = {}) {
      const R = RNG('prop', o.seed ?? 'p', x | 0), base = col(o.color || 'night'), L = o.light, s = pr.h || 60;
      let P;
      if (pr.kind === 'log') {
        const len = pr.w || s * 5, a = pr.a ?? -0.05, ca = Math.cos(a), sa = Math.sin(a), cx = x, cy = y - s * 0.45;
        P = limb([[cx - ca * len / 2, cy - sa * len / 2, s * 0.92], [cx, cy, s], [cx + ca * len / 2, cy + sa * len / 2, s * 0.9]]).map(([px, py]) => [px, py]);
      } else if (pr.kind === 'bag') {
        P = [[x - s * 0.74, y, 1], [x - s * 0.78, y - s * 0.3], [x - s * 0.62, y - s * 0.6], [x - s * 0.24, y - s * 0.74], [x + s * 0.22, y - s * 0.72], [x + s * 0.6, y - s * 0.6], [x + s * 0.8, y - s * 0.32], [x + s * 0.76, y, 1]];
      } else P = boulder(R, x, y, s * 2.4, s);
      p.save(); p.beginPath(); shapeTo(p, P); p.clip();
      p.fillStyle = rgba(base); p.fillRect(x - s * 8, y - s * 3, s * 16, s * 4);
      for (let k = 0; k < 30; k++) brush(p, R, x + R.n(pr.kind === 'log' ? (pr.w || s * 5) / 2 : s * 0.8), y - R.r(0, s * 1.1), R.n(0.15), R.r(10, 40), R.r(3, 9), mix(base, R.f() < 0.5 ? PAL.umber : PAL.deep, R.r(0.1, 0.35)), R.r(0.3, 0.6), { vary: 4 });
      for (const [wd, aa] of [[s * 0.3, 0.16], [s * 0.1, 0.4]]) { p.beginPath(); shapeTo(p, P, -L[0] * wd, -L[1] * wd); p.rect(x - s * 9, y - s * 4, s * 18, s * 6); p.fillStyle = rgba(o.lit || PAL.amber, aa); p.fill('evenodd'); }
      if (pr.kind === 'bag') { p.strokeStyle = rgba(PAL.ink, 0.55); p.lineWidth = 1.6; p.beginPath(); curveTo(p, [[x - s * 0.66, y - s * 0.42], [x - s * 0.1, y - s * 0.3], [x + s * 0.5, y - s * 0.5]]); p.stroke(); p.beginPath(); curveTo(p, [[x - s * 0.3, y - s * 0.72], [x - s * 0.1, y - s * 1.05], [x + s * 0.24, y - s * 0.7]]); p.lineWidth = 2.4; p.stroke(); }
      if (pr.kind === 'log') { const len = pr.w || s * 5, ex = x + Math.cos(pr.a ?? -0.05) * len / 2, ey = y - s * 0.45 + Math.sin(pr.a ?? -0.05) * len / 2; p.strokeStyle = rgba(PAL.ink, 0.5); p.lineWidth = 1.5; p.beginPath(); p.ellipse(ex - s * 0.08, ey, s * 0.22, s * 0.38, 0, 0, TAU); p.stroke(); }
      p.restore();
      p.beginPath(); shapeTo(p, P); p.strokeStyle = rgba(PAL.ink, 0.8); p.lineWidth = 2; p.lineJoin = 'round'; p.stroke();
    }

    // ───────────────────────── worlds: plates at depths ─────────────────────────
    const DEPTH = Object.freeze({ sky: 0.22, far: 0.45, mid: 0.7, hill: 1, near: 1.3 });
    const TIMES = {
      night: { sky: [[0, '#0a1316'], [0.5, '#122a30'], [0.82, '#1f4045'], [1, '#33524f']], far: '#1d3a3e', mid: '#152d31', hill: '#10211f', near: '#0b1513', rim: '#86a8a2' },
      dawn: { sky: [[0, '#132a30'], [0.45, '#2b5357'], [0.75, '#6f8577'], [0.9, '#d39a55'], [1, '#efcf92']], far: '#5b7670', mid: '#3e5a55', hill: '#2c3d33', near: '#1b2620', rim: '#f2c26e' },
      dusk: { sky: [[0, '#151d2a'], [0.5, '#3a4250'], [0.8, '#a2603a'], [1, '#e19a4e']], far: '#4f4a52', mid: '#363640', hill: '#242729', near: '#151719', rim: '#de9c48' },
      day: { sky: [[0, '#2c5a62'], [0.6, '#6f9a96'], [1, '#d9cfae']], far: '#7d9a90', mid: '#5f7a62', hill: '#4c5c3c', near: '#2f3a28', rim: '#eee0bf' },
    };
    /**
     * A world: { time: night|dawn|dusk|day, horizon (world y), light: [x, y] (the one light), glow, stars, band, clouds,
     *   far, mid, hill, near (each a ridge spec or false: { base, amp, scale, seed, peak, peaks, trees, rocks, props
     *   (dark log, bag or stone silhouettes), grass, fields, color, low, rim }), calm: [x0, y0, x1, y1] (a quiet region: no
     *   grass or detail; a Duet's corner) }
     * → { key, layers: [plates, far to near], light, horizon }
     */
    function world(key, spec = {}) {
      return once('world|' + key, () => {
        const T = TIMES[spec.time] || TIMES.night, hz = spec.horizon ?? 700, light = spec.light || [1500, hz - 40];
        const glow = spec.glow === false ? null : { x: light[0], y: light[1], r: 1100, color: spec.time === 'night' ? 'haze' : 'amber', a: spec.time === 'night' ? 0.28 : 0.85, ...(spec.glow || {}) };
        const layers = [skyPlate(key, { stops: spec.sky || T.sky, horizon: hz, glow, light, stars: spec.stars ?? (spec.time === 'night' ? 1600 : 0), band: spec.band, clouds: spec.clouds || [], k: DEPTH.sky })];
        const rimDir = (k) => { const lx = light[0] - CX, ly = light[1] - CY - 600; const l = Math.hypot(lx, ly) || 1; return [lx / l, ly / l * (k < 1 ? 1 : 0.6)]; };
        const add = (name, d, def) => {
          const s = spec[name];
          if (s === false || (s == null && !def)) return;
          const o = { ...def, ...(s || {}) };
          const nightK = spec.time === 'night' ? 0.45 : 1, rim = o.rim === false || (spec.time === 'night' && name !== 'hill' && !o.rim) ? null : { color: o.rimColor || T.rim, a: o.rimA ?? (name === 'far' ? 0.35 : 0.75) * nightK, w: name === 'near' ? 4 : 3, dir: rimDir(d) };
          if (rim && (o.amp ?? 60) < 30 && o.rimA == null) rim.a *= 0.3;
          const lightAt = spec.time === 'night' ? null : [CX + (light[0] - CX) * d, light[1]];
          layers.push(ridgePlate(`${key}|${name}`, { k: d, name, color: o.color || T[name], low: o.low, rim, calm: spec.calm, lightAt, lightA: name === 'far' ? 0.4 : 0.28, lightR: 1300, ...o }));
        };
        add('far', DEPTH.far, { base: hz - 60, amp: 70, scale: 520, seed: 11, outline: 0 });
        add('mid', DEPTH.mid, { base: hz + 40, amp: 90, scale: 640, seed: 23, outline: 0.15 });
        add('hill', DEPTH.hill, spec.hill ? { base: hz + 180, amp: 60, scale: 700, seed: 37, outline: 0.45, grass: 260 } : null);
        add('near', DEPTH.near, spec.near ? { base: 1010, amp: 50, scale: 420, seed: 51, outline: 0.5, grass: 420, grassScale: 1.6 } : null);
        return { key, layers, light, horizon: hz, time: spec.time || 'night', top: layers[0].top };
      });
    }

    // ───────────────────────── the camera and the layers ─────────────────────────
    /** This frame's camera: { z, p: [x, y] } (world point p at the screen's centre), optional to: [x, y]. */
    function view(c = {}) { CAM = { z: c.z ?? 1, p: c.p ? [c.p[0], c.p[1]] : [CX, CY], to: c.to || [CX, CY] }; return CAM; }
    /** A camera along keys [[t, { z, p }, ease?], …]: each move eases into its key (io by default) and holds there. */
    function path(T, keys) {
      if (!keys.length) return { z: 1, p: [CX, CY] };
      if (T <= keys[0][0]) return keys[0][1];
      for (let i = 1; i < keys.length; i++) {
        if (T < keys[i][0]) {
          const a = keys[i - 1], b = keys[i], e = b[2] ? (typeof b[2] === 'function' ? b[2] : EZ[b[2]] || EZ.io) : EZ.io, u = e(clamp((T - a[0]) / (b[0] - a[0] || 1)));
          return { z: lerp(a[1].z ?? 1, b[1].z ?? 1, u), p: [lerp(a[1].p[0], b[1].p[0], u), lerp(a[1].p[1], b[1].p[1], u)] };
        }
      }
      return keys[keys.length - 1][1];
    }
    /** The camera breathes: a slow creep in z (per second since t0, the shot's start: one continuous push, never reset mid-shot) and a little sway. */
    function breathe(cam, T, t0, o = {}) {
      const dt = Math.max(0, T - t0), s = o.seed ?? 3;
      return { z: cam.z * (1 + (o.creep ?? 0.004) * dt), p: [cam.p[0] + (noise1(T * 0.21, s) - 0.5) * (o.sway ?? 6), cam.p[1] + (noise1(T * 0.17, s + 9) - 0.5) * (o.sway ?? 6) * 0.6] };
    }
    function camAt(k) {
      const z = 1 + (CAM.z - 1) * k, px = CX + (CAM.p[0] - CX) * k, py = CY + (CAM.p[1] - CY) * k;
      return { z, tx: CAM.to[0] - z * px, ty: CAM.to[1] - z * py };
    }
    /** Draw fn in the world at parallax depth k (1 = the subject's plane, under 1 farther, over 1 nearer). */
    function layer(k, fn) { const q = camAt(k); g.save(); g.setTransform(q.z * S, 0, 0, q.z * S, q.tx * S, q.ty * S); fn(q); g.restore(); }
    /** A world point at depth k → screen. */
    function toScreen(x, y, k = 1) { const q = camAt(k); return [q.z * x + q.tx, q.z * y + q.ty]; }
    /** The world's plates, far to near; o.between: { [depth]: fn } runs fn at that depth after the plates behind it. */
    function draw(wd, o = {}) {
      g.save(); g.setTransform(S, 0, 0, S, 0, 0); g.fillStyle = rgba(wd.top || PAL.night); g.fillRect(0, 0, W, H); g.restore();
      const extra = Object.entries(o.between || {}).map(([k, fn]) => [Number(k), fn]).sort((a, b) => a[0] - b[0]);
      let e = 0;
      for (const pl of wd.layers) {
        while (e < extra.length && extra[e][0] < pl.k) { const [k, fn] = extra[e++]; layer(k, () => fn(k)); }
        layer(pl.k, () => g.drawImage(pl.c, pl.x, pl.y));
      }
      while (e < extra.length) { const [k, fn] = extra[e++]; layer(k, () => fn(k)); }
    }
    /** Ground height of a world's ridge layer (a depth or a name: far, mid, hill, near) at world x: where a figure stands. */
    function ground(wd, which, x) { const k = typeof which === 'number' ? which : DEPTH[which]; const pl = wd.layers.find((l) => l.kind === 'ridge' && Math.abs(l.k - k) < 1e-6); return pl ? pl.profile(x) : H * 0.85; }

    // ───────────────────────── light ─────────────────────────
    function glow(x, y, r, c = 'amber', a = 0.5, op = 'screen') {
      const q = g.createRadialGradient(x, y, 0, x, y, r), cc = col(c);
      q.addColorStop(0, rgba(cc, a)); q.addColorStop(0.35, rgba(cc, a * 0.45)); q.addColorStop(1, rgba(cc, 0));
      g.save(); g.globalCompositeOperation = op; g.fillStyle = q; g.fillRect(x - r, y - r, r * 2, r * 2); g.restore();
    }
    /** A shaft of light from `from` to `to`, w0 wide at its source and w1 at its end; a few streaks drift slowly. */
    function shaft(o = {}) {
      const [x0, y0] = o.from, [x1, y1] = o.to, dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
      const c = col(o.color || 'ember'), a = o.a ?? 0.35, T = C ? C.TT : 0, R = RNG('shaft', o.key || 's');
      g.save(); g.globalCompositeOperation = 'screen';
      for (const [k, aa] of [[1.15, 0.25], [0.95, 0.35], [0.75, 0.5], [0.55, 0.65], [0.35, 0.8]]) {
        const q = g.createLinearGradient(x0, y0, x1, y1);
        q.addColorStop(0, rgba(c, a * aa * 0.6)); q.addColorStop(0.35, rgba(c, a * aa * 0.35)); q.addColorStop(1, rgba(c, 0));
        g.fillStyle = q; g.beginPath();
        const w0 = (o.w0 ?? 60) * k, w1 = (o.w1 ?? 600) * k;
        g.moveTo(x0 + nx * w0 / 2, y0 + ny * w0 / 2); g.lineTo(x1 + nx * w1 / 2, y1 + ny * w1 / 2); g.lineTo(x1 - nx * w1 / 2, y1 - ny * w1 / 2); g.lineTo(x0 - nx * w0 / 2, y0 - ny * w0 / 2); g.closePath(); g.fill();
      }
      for (let i = 0; i < (o.streaks ?? 5); i++) {
        const u = R.r(-0.4, 0.4) + Math.sin(T * 0.15 + i) * 0.03, ww = R.r(0.03, 0.09), q = g.createLinearGradient(x0, y0, x1, y1);
        q.addColorStop(0, rgba(c, a * 0.5)); q.addColorStop(1, rgba(c, 0)); g.fillStyle = q; g.beginPath();
        const w0 = o.w0 ?? 60, w1 = o.w1 ?? 600;
        g.moveTo(x0 + nx * w0 * u, y0 + ny * w0 * u); g.lineTo(x1 + nx * w1 * (u + ww), y1 + ny * w1 * (u + ww)); g.lineTo(x1 + nx * w1 * u, y1 + ny * w1 * u); g.closePath(); g.fill();
      }
      g.restore();
    }
    /** A bright star: a core, a halo and four long soft rays; o.a its brightness 0..1. */
    function star(x, y, r = 14, o = {}) {
      const a = o.a ?? 1;
      if (a <= 0.002) return;
      const c = col(o.color || 'cream'), h = col(o.halo || 'ember');
      g.save(); g.globalCompositeOperation = 'screen';
      glow(x, y, r * 9, h, 0.32 * a); glow(x, y, r * 3.2, c, 0.6 * a);
      const rot = o.rot ?? 0.12;
      for (let i = 0; i < 4; i++) {
        const ang = rot + (i * Math.PI) / 2, len = r * (i % 2 ? 4.5 : 7) * (o.rays ?? 1), ca = Math.cos(ang), sa = Math.sin(ang);
        const q = g.createLinearGradient(x, y, x + ca * len, y + sa * len);
        q.addColorStop(0, rgba(c, 0.85 * a)); q.addColorStop(1, rgba(c, 0));
        g.fillStyle = q; g.beginPath(); g.moveTo(x - sa * r * 0.22, y + ca * r * 0.22); g.lineTo(x + ca * len, y + sa * len); g.lineTo(x + sa * r * 0.22, y - ca * r * 0.22); g.closePath(); g.fill();
      }
      g.fillStyle = rgba(c, a); g.beginPath(); g.arc(x, y, r * 0.42, 0, TAU); g.fill();
      g.restore();
    }
    /** How bright a flame is at T: slow breathing plus a quick flutter, 0..1. */
    const flicker = (T, key = 'f') => { const s = seedOf('flick', key); return clamp(0.62 + 0.22 * (noise1(T * 1.7, s) - 0.5) * 2 + 0.16 * (noise1(T * 7.3, s + 5) - 0.5) * 2); };
    /** The ground lit by a fire at (x, y): a wide warm pool (draw it before the people round the fire). */
    function firelight(x, y, s = 120, o = {}) {
      const T = C ? C.TT : 0, f = 0.72 + 0.28 * flicker(T, o.key || 'fire'), r = s * (o.reach ?? 5) * (0.96 + 0.05 * f);
      g.save(); g.globalCompositeOperation = 'screen'; g.translate(x, y); g.scale(1, o.squash ?? 0.24);
      const q = g.createRadialGradient(0, 0, 0, 0, 0, r);
      q.addColorStop(0, rgba(PAL.ember, 0.85 * f)); q.addColorStop(0.16, rgba(PAL.amber, 0.66 * f)); q.addColorStop(0.45, rgba(PAL.rust, 0.3 * f)); q.addColorStop(1, rgba(PAL.rust, 0));
      g.fillStyle = q; g.fillRect(-r, -r, r * 2, r * 2);
      g.globalCompositeOperation = 'soft-light'; g.fillRect(-r, -r, r * 2, r * 2);
      g.restore();
    }
    const RINGS = new Map();
    /** A campfire at (x, y) (its base), s tall: the pool of light, a ring of stones, charred logs with glowing ends,
     *  flames painted as layered brush strokes that change on the twos, its glow and embers. o.pool: false when the
     *  scene drew K.firelight first. */
    function fire(x, y, s = 120, o = {}) {
      const T = C ? C.TT : 0, B = C ? C.B : 0, key = o.key || 'fire', f = flicker(T, key), sd = seedK('fire', key);
      if (o.pool !== false) firelight(x, y, s, o);
      glow(x, y - s * 0.5, s * (3.4 + f), 'amber', 0.2 + 0.12 * f);
      const ring = RINGS.get(key) || (() => { const R = RNG('ring', key), out = []; for (let i = 0; i < 11; i++) { const a = (i / 11) * TAU + R.n(0.12), r = s * R.r(0.16, 0.24); out.push({ a, x: Math.cos(a) * s * 0.66, y: Math.sin(a) * s * 0.17, r, P: boulder(R, 0, 0, r * 2.2, r * 1.1) }); } RINGS.set(key, out); return out; })();
      const stone = (k) => {
        const sx = x + k.x, sy = y + k.y, front = k.y > 0, P = k.P.map(([px, py, c]) => [sx + px, sy + py, c]), L = [-k.x / (s * 0.66) * 0.6, -0.8];
        g.save(); g.beginPath(); shapeTo(g, P); g.clip();
        g.fillStyle = rgba(mix(PAL.umber, PAL.night, front ? 0.55 : 0.35)); g.fillRect(sx - k.r * 2, sy - k.r * 2, k.r * 4, k.r * 3);
        g.beginPath(); g.rect(sx - k.r * 3, sy - k.r * 3, k.r * 6, k.r * 6); shapeTo(g, P, -L[0] * k.r * 0.4, -L[1] * k.r * 0.45); g.fillStyle = rgba(mix(PAL.amber, PAL.ember, 0.4), (front ? 0.4 : 0.75) * (0.7 + 0.3 * f)); g.fill('evenodd');
        g.restore();
        g.beginPath(); shapeTo(g, P); g.strokeStyle = rgba(PAL.ink, 0.75); g.lineWidth = 1.4; g.lineJoin = 'round'; g.stroke();
      };
      ring.filter((k) => k.y <= 0).forEach(stone);
      // the bed of coals
      g.save(); g.translate(x, y); g.scale(1, 0.3); const cq = g.createRadialGradient(0, 0, 0, 0, 0, s * 0.62); cq.addColorStop(0, rgba(PAL.cream, 0.95)); cq.addColorStop(0.3, rgba(PAL.ember, 0.9)); cq.addColorStop(0.7, rgba(PAL.rust, 0.7)); cq.addColorStop(1, rgba(PAL.oxblood, 0)); g.fillStyle = cq; g.fillRect(-s, -s, s * 2, s * 2); g.restore();
      // charred logs leaning in, their inner ends glowing, cracks that breathe with the flame
      for (const [ax, ay, bx, by, wd] of [[-0.62, 0.06, 0.12, -0.2, 0.15], [0.64, 0.04, -0.1, -0.22, 0.14], [-0.18, 0.1, 0.28, -0.12, 0.13], [0.3, 0.12, -0.32, -0.08, 0.12]]) {
        const A = [x + ax * s, y + ay * s], Bp = [x + bx * s, y + by * s], P = limb([[A[0], A[1], wd * s], [lerp(A[0], Bp[0], 0.5), lerp(A[1], Bp[1], 0.5), wd * s * 0.92], [Bp[0], Bp[1], wd * s * 0.8]]);
        g.save(); g.beginPath(); shapeTo(g, P); g.clip();
        g.fillStyle = rgba([40, 30, 25]); g.fillRect(Math.min(A[0], Bp[0]) - s, Math.min(A[1], Bp[1]) - s, Math.abs(Bp[0] - A[0]) + s * 2, Math.abs(Bp[1] - A[1]) + s * 2);
        const eq = g.createRadialGradient(Bp[0], Bp[1], 0, Bp[0], Bp[1], s * 0.42); eq.addColorStop(0, rgba(PAL.ember, 0.95 * f + 0.05)); eq.addColorStop(0.45, rgba(PAL.rust, 0.6 * f)); eq.addColorStop(1, rgba(PAL.rust, 0));
        g.fillStyle = eq; g.fillRect(Bp[0] - s, Bp[1] - s, s * 2, s * 2);
        g.strokeStyle = rgba(PAL.ember, 0.35 + 0.45 * f); g.lineWidth = Math.max(1, s * 0.012); g.lineCap = 'round';
        for (const u of [0.35, 0.55]) { const cx = lerp(A[0], Bp[0], u), cy = lerp(A[1], Bp[1], u); g.beginPath(); g.moveTo(cx - wd * s * 0.2, cy - wd * s * 0.3); g.lineTo(cx + wd * s * 0.1, cy + wd * s * 0.1); g.stroke(); }
        g.restore();
        g.beginPath(); shapeTo(g, P); g.strokeStyle = rgba(PAL.ink, 0.85); g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
      }
      // the flame: tongues, each painted in layers (rust, amber, ember, cream) of tapered strokes; on the twos each
      // tongue takes a new height, lean and sway, so the shape boils like a hand-painted cel
      const hgt = s * (0.95 + 0.25 * f), layers = [[PAL.oxblood, 0.7, 1.12], [PAL.rust, 0.9, 1.0], [PAL.amber, 0.95, 0.78], [PAL.ember, 0.95, 0.56], [PAL.cream, 0.9, 0.32]];
      const tongues = [[-0.24, 0.66, 0.4], [0.24, 0.6, 0.38], [-0.05, 1.0, 0.6], [0.12, 0.8, 0.44], [-0.14, 0.5, 0.3], [0.32, 0.42, 0.26]];
      const flameAt = (i, dx, hh, wd, ph) => {
        const N = 12, out = [], bend = (noise1(B * 0.9 + i * 7.3, sd) - 0.5) * 0.5, lean = (noise1(B * 0.6 + i * 3.1, sd + 3) - 0.5) * 0.3;
        for (let k = 0; k <= N; k++) { const u = k / N, sway = (Math.sin(T * 5.3 + u * 3.4 + ph) * 0.12 + bend * Math.sin(u * Math.PI)) * u * hh + lean * u * u * hh; out.push([x + dx + sway, y - u * hh, (wd / 2) * Math.pow(1 - u, 0.85) * (0.75 + 0.25 * Math.sin(u * Math.PI * 0.9 + 0.3))]); }
        return out;
      };
      const tongue = (C0, hw, a, i, k) => {
        // the body, then two looser passes a hair to each side (the brush's ragged edge), then bristle lines
        for (const [dx, aa] of [[0, a], [-s * 0.022, a * 0.35], [s * 0.022, a * 0.35]]) {
          g.fillStyle = rgba(C0, aa); g.beginPath();
          hw.forEach(([px, py, w], j) => { const jx = dx * (0.4 + noise1(j * 0.9 + i * 3 + B * 0.7, sd + 31)); if (j) g.lineTo(px - w * k + jx, py); else g.moveTo(px - w * k + jx, py); });
          for (let j = hw.length - 1; j >= 0; j--) g.lineTo(hw[j][0] + hw[j][2] * k + dx * (0.4 + noise1(j * 1.1 + i * 5 + B * 0.7, sd + 37)), hw[j][1]);
          g.closePath(); g.fill();
        }
        g.strokeStyle = rgba(mix(C0, PAL.cream, 0.4), a * 0.6); g.lineCap = 'round';
        for (const b of [-0.5, 0, 0.5]) { g.lineWidth = Math.max(1, s * (0.01 + 0.006 * (1 - Math.abs(b)))); g.beginPath(); hw.slice(1, -3).forEach(([px, py, w], j) => (j ? g.lineTo(px + w * k * b, py) : g.moveTo(px + w * k * b, py))); g.stroke(); }
      };
      g.save();
      tongues.forEach(([dx, hk, wk], i) => {
        const hh = hgt * hk * (0.85 + 0.3 * noise1(B * 1.3 + i * 5.7, sd + 9)), P0 = flameAt(i, dx * s, hh, s * wk, i * 1.7);
        layers.forEach(([c0, a, k], li) => { if (li === 4 && hk < 0.7) return; const P = P0.map(([px, py, w], j) => [px, lerp(y, py, k * 0.92 + 0.08 * (j / P0.length)), w]); tongue(c0, P, a, i, k); });
      });
      // licks: small loose flames above the body, a new set on every twos step
      const RL = RNG('licks', key, B);
      for (let i = 0; i < 2; i++) {
        const lx = x + RL.n(s * 0.22), ly = y - hgt * RL.r(0.72, 0.98), lh = s * RL.r(0.08, 0.17), lw2 = s * RL.r(0.03, 0.06);
        g.fillStyle = rgba(RL.f() < 0.5 ? PAL.amber : PAL.ember, RL.r(0.55, 0.9)); g.beginPath();
        g.moveTo(lx - lw2, ly); g.quadraticCurveTo(lx - lw2 * 0.6, ly - lh * 0.6, lx + RL.n(lw2), ly - lh); g.quadraticCurveTo(lx + lw2 * 0.6, ly - lh * 0.5, lx + lw2, ly); g.quadraticCurveTo(lx, ly + lh * 0.25, lx - lw2, ly); g.fill();
      }
      g.restore();
      ring.filter((k) => k.y > 0).forEach(stone);
      glow(x, y - s * 0.3, s * 0.9, 'ember', 0.32 * f);
      glow(x, y - s * 0.15, s * 0.45, 'cream', 0.3 * f);
      if (o.sparks !== false) embers(x, y - s * 0.6, { n: 24, h: s * 4.5, spread: s * 0.45, key: key + 'e', size: s / 55 });
    }
    /** Sparks rising from (x, y): each its own birth, drift and fade, from T alone. */
    function embers(x, y, o = {}) {
      const T = C ? C.TT : 0, n = o.n ?? 20, per = o.period ?? 2.6, R = RNG('embers', o.key || 'e');
      g.save(); g.globalCompositeOperation = 'screen';
      for (let i = 0; i < n; i++) {
        const b = R.r(0, per), sp = R.r(0.7, 1.3), ph = R.r(0, TAU), age = (((T - b) % per) + per) % per, u = age / per;
        const px = x + R.n(o.spread ?? 40) + Math.sin(age * 2.3 + ph) * 14 * u + (o.wind ?? 12) * u * u * 3, py = y - u * (o.h ?? 400) * sp;
        const a = Math.sin(Math.PI * clamp(u * 1.15)) * R.r(0.5, 1);
        g.fillStyle = rgba(u < 0.5 ? PAL.ember : PAL.amber, a); g.beginPath(); g.arc(px, py, (o.size ?? 2) * R.r(0.8, 1.6) * (1 - u * 0.5), 0, TAU); g.fill();
      }
      g.restore();
    }
    /** Dust in the air: motes in a box drifting slowly; o.in(x, y) → 0..1 how lit a point is (a shaft), else all lit. */
    function motes(box, o = {}) {
      const T = C ? C.TT : 0, n = o.n ?? 60, R = RNG('motes', o.key || 'm'), [x0, y0, x1, y1] = box;
      g.save(); g.globalCompositeOperation = 'screen';
      for (let i = 0; i < n; i++) {
        const bx = R.r(x0, x1), by = R.r(y0, y1), sp = R.r(4, 14), ph = R.r(0, TAU);
        const x = x0 + ((((bx - x0 + T * sp * (o.dx ?? 1)) % (x1 - x0)) + (x1 - x0)) % (x1 - x0)) + Math.sin(T * 0.4 + ph) * 10;
        const y = y0 + ((((by - y0 - T * sp * 0.4 * (o.dy ?? 1)) % (y1 - y0)) + (y1 - y0)) % (y1 - y0)) + Math.cos(T * 0.31 + ph) * 8;
        const lit = o.in ? o.in(x, y) : 1, a = lit * (0.25 + 0.55 * (0.5 + 0.5 * Math.sin(T * 1.3 + ph * 3))) * (o.a ?? 1);
        if (a < 0.02) continue;
        g.fillStyle = rgba(col(o.color || 'cream'), a); g.beginPath(); g.arc(x, y, R.r(1, 2.6) * (o.size ?? 1), 0, TAU); g.fill();
      }
      g.restore();
    }
    /** A few bright stars that breathe (the plate holds the rest still). */
    function twinkle(box, o = {}) {
      const T = C ? C.TT : 0, R = RNG('twinkle', o.key || 'tw'), [x0, y0, x1, y1] = box;
      for (let i = 0; i < (o.n ?? 14); i++) {
        const x = R.r(x0, x1), y = R.r(y0, y1), ph = R.r(0, TAU), sp = R.r(0.6, 1.6), a = (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(T * sp * 2 + ph))) * (o.a ?? 1);
        star(x, y, R.r(2.5, 5) * (o.size ?? 1), { a: a * 0.8, rays: 0.6, rot: R.r(0, 1) });
      }
    }

    // ───────────────────────── water ─────────────────────────
    const WATER = new Map();
    function waterTexture(key, c1, c2) {
      const id = `${key}|${c1}|${c2}`;
      if (WATER.has(id)) return WATER.get(id);
      const w = 512, h = 256, c = canvas(w, h), p = c.getContext('2d'), R = RNG('water', key);
      p.fillStyle = 'rgb(128,128,128)'; p.fillRect(0, 0, w, h);
      for (let i = 0; i < 520; i++) { const x = R.r(0, w), y = R.r(0, h), v = R.f() < 0.5 ? R.r(150, 215) : R.r(50, 105); brush(p, R, x, y, R.n(0.02), R.r(24, 110), R.r(2, 5), [v, v, v], R.r(0.3, 0.7), { vary: 3, n: 2 }); }
      WATER.set(id, c);
      return c;
    }
    let POOL = null;
    /** One screen-sized layer for water that fades (made on first use, reused every frame). */
    function poolLayer() {
      const w = Math.round(W * S), h = Math.round(H * S);
      if (!POOL || POOL.width !== w || POOL.height !== h) POOL = canvas(w, h);
      return POOL;
    }
    /**
     * A river or a flood: a ribbon along pts ([[x, y, halfWidth], …], far to near), widened by `spread` (px at the near
     * end; perspective follows the half-widths). It comes out of the distance (o.fade: the share of its length over
     * which it fades in, .2), dark water (c2) lit where it reflects the sky near the horizon (c1) and the light under
     * o.glow ([x, y, r]): a soft streak, broken level strokes and glints. Reeds break its banks (o.reeds: false for
     * none); o.night keeps only the light's streak.
     */
    function flood(pts0, o = {}) {
      const T = C ? C.TT : 0, spread = o.spread ?? 0, sd = seedOf('banks', o.key || 'w');
      // a smooth path (each span cut in eight, eased between its neighbours) whose banks wander a little
      const pts = [];
      for (let i = 0; i < pts0.length - 1; i++) {
        const a = pts0[Math.max(0, i - 1)], b = pts0[i], c = pts0[i + 1], d = pts0[Math.min(pts0.length - 1, i + 2)];
        for (let j = 0; j < 8; j++) {
          const t = j / 8, t2 = t * t, t3 = t2 * t, cr = (p0, p1, p2, p3) => 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
          const n = pts.length, wob = 1 + 0.32 * (noise1(n / 5, sd) - 0.5) + 0.12 * (noise1(n / 1.5, sd + 3) - 0.5);
          pts.push([cr(a[0], b[0], c[0], d[0]), cr(a[1], b[1], c[1], d[1]), lerp(b[2], c[2], t) * wob]);
        }
      }
      pts.push(pts0[pts0.length - 1]);
      const maxHw = Math.max(...pts.map((q) => q[2]));
      const side = (sgn) => pts.map(([x, y, hw], i) => {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
        const k = hw + spread * (hw / maxHw) * (1 + 0.18 * Math.sin(i * 0.21 + (o.seed || 0))), nx = -dy / l, ny = dx / l;
        return [x + nx * k * sgn, y + ny * k * sgn * (o.squash ?? 1)];
      });
      const Ls = side(1), Rs = side(-1), poly = [...Ls, ...Rs.slice().reverse()];
      const ys = poly.map((q) => q[1]), xs = poly.map((q) => q[0]);
      const bx = Math.min(...xs), by = Math.min(...ys), bw = Math.max(...xs) - bx, bh = Math.max(...ys) - by;
      // drawn on its own layer (the current transform kept), so the far end can fade in before it lands on the frame
      const m = g.getTransform(), lay = poolLayer(), q = lay.getContext('2d');
      const corners = [[bx - 60, by - 60], [bx + bw + 60, by - 60], [bx - 60, by + bh + 60], [bx + bw + 60, by + bh + 60]].map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
      const sx0 = Math.max(0, Math.floor(Math.min(...corners.map((v) => v[0])))), sy0 = Math.max(0, Math.floor(Math.min(...corners.map((v) => v[1]))));
      const sx1 = Math.min(lay.width, Math.ceil(Math.max(...corners.map((v) => v[0])))), sy1 = Math.min(lay.height, Math.ceil(Math.max(...corners.map((v) => v[1]))));
      if (sx1 <= sx0 || sy1 <= sy0) return;
      q.save(); q.setTransform(1, 0, 0, 1, 0, 0); q.globalAlpha = 1; q.globalCompositeOperation = 'source-over'; q.clearRect(sx0, sy0, sx1 - sx0, sy1 - sy0); q.restore();
      q.save(); q.setTransform(m); q.lineJoin = 'round'; q.lineCap = 'round';
      const ribbon = () => { q.beginPath(); poly.forEach(([x, y], i) => (i ? q.lineTo(x, y) : q.moveTo(x, y))); q.closePath(); };
      ribbon(); q.strokeStyle = rgba(PAL.night, 0.22); q.lineWidth = o.bank ?? 3; q.stroke();
      ribbon(); q.clip();
      const c1 = col(o.c1 || 'haze'), c2 = col(o.c2 || 'deep'), night = !!o.night;
      // the water's body: the sky it mirrors, bright from the horizon far off, the higher sky's colour near the viewer
      const gr = q.createLinearGradient(0, by, 0, by + bh);
      if (night) { gr.addColorStop(0, rgba(mix(c1, c2, 0.5))); gr.addColorStop(0.35, rgba(mix(c1, c2, 0.82))); gr.addColorStop(1, rgba(dim(c2, 0.85))); }
      else { gr.addColorStop(0, rgba(c1)); gr.addColorStop(0.2, rgba(mix(c1, c2, 0.55))); gr.addColorStop(0.55, rgba(c2)); gr.addColorStop(1, rgba(dim(c2, 0.8))); }
      q.fillStyle = gr; q.fillRect(bx - 10, by - 10, bw + 20, bh + 20);
      // ripples: the texture tiled at its own scale (never stretched), drifting a little
      const tex = waterTexture(o.key || 'w', o.c1 || 'haze', o.c2 || 'deep'), pat = q.createPattern(tex, 'repeat');
      q.save(); q.translate(Math.sin(T * 0.3) * 14, 0); q.globalAlpha = (o.ripple ?? 0.3) * (night ? 0.6 : 1); q.globalCompositeOperation = 'overlay'; q.fillStyle = pat; q.fillRect(bx - 40, by - 10, bw + 80, bh + 20); q.restore();
      // the light's streak: a soft column of the light straight below it
      const near = (x) => (o.glow ? clamp(1 - Math.abs(x - o.glow[0]) / (o.glow[2] * 0.62)) : 0);
      if (o.glow) {
        const [gx, , gr2] = o.glow, s = q.createLinearGradient(gx - gr2 * 0.4, 0, gx + gr2 * 0.4, 0), ga = o.glowA ?? 0.5;
        s.addColorStop(0, rgba(PAL.ember, 0)); s.addColorStop(0.5, rgba(mix(PAL.ember, c1, 0.3), ga)); s.addColorStop(1, rgba(PAL.ember, 0));
        q.globalCompositeOperation = 'screen'; q.fillStyle = s; q.fillRect(gx - gr2 * 0.4, by - 20, gr2 * 0.8, bh + 40); q.globalCompositeOperation = 'source-over';
      }
      // ripples: rows of broken level lines across the water, close together far off and spaced out near the viewer;
      // light ones carry the horizon (warm under the light), dark ones the deeper sky; the night keeps the light's only
      const RS = RNG('reflect', o.key || 'w'), N = o.strokes ?? Math.round(pts.length * 1.3), hot = mix(c1, PAL.cream, 0.45), warmS = mix(c1, PAL.ember, 0.5), deepS = dim(c2, 0.62);
      for (let i = 0; i < N; i++) {
        const j = Math.floor(RS.f() * pts.length), [x, y, hw] = pts[j], fu = 1 - j / pts.length, ry = y + RS.n(hw * 0.35), drift = Math.sin(T * 0.5 + i) * hw * 0.06;
        const dark = !night && RS.f() < 0.45 - fu * 0.3, lw0 = Math.max(0.8, hw / 22) * RS.r(0.7, 1.4);
        let xx = x - hw * 1.3 + drift;
        while (xx < x + hw * 1.3) {
          const len = hw * RS.r(0.12, 0.5), gap = hw * RS.r(0.06, 0.4), mid = xx + len / 2, nr = near(mid);
          const a = (dark ? 0.35 : night ? 0.04 + nr * nr * 1.1 : 0.12 + 0.45 * fu + nr * 0.5) * RS.r(0.3, 1);
          if (a > 0.04 && RS.f() < 0.75) { q.strokeStyle = rgba(dark ? deepS : nr > 0.35 ? warmS : hot, clamp(a)); q.lineWidth = lw0; q.beginPath(); q.moveTo(xx, ry); q.lineTo(xx + len, ry + RS.n(0.6)); q.stroke(); }
          xx += len + gap;
        }
      }
      q.globalCompositeOperation = 'screen';
      // glints that shimmer near the light
      const RG = RNG('glints', o.key || 'w', C ? C.B : 0);
      for (let i = 0; i < (o.glints ?? 30); i++) {
        const j = Math.floor(RG.f() * pts.length), [x, y, hw] = pts[j], gx = x + RG.n(hw * 0.8), gy = y + RG.n(hw * 0.1), nr = near(gx);
        if (nr <= 0.02) continue;
        q.strokeStyle = rgba(PAL.cream, RG.r(0.1, 0.5) * nr); q.lineWidth = Math.max(1, hw / 50); q.beginPath(); q.moveTo(gx, gy); q.lineTo(gx + hw * RG.r(0.06, 0.22), gy); q.stroke();
      }
      q.globalCompositeOperation = 'source-over';
      // the banks' reflections: dark along both edges, inside the water
      for (const [wd, aa] of [[o.bankW ?? 28, 0.14], [10, 0.22]]) { q.lineWidth = wd; q.strokeStyle = rgba(PAL.night, aa); ribbon(); q.stroke(); }
      q.restore();
      // the banks' growth: dark dabs of reed and scrub along both edges, smaller with distance, so no edge runs clean
      if (o.reeds !== false) {
        const RR = RNG('reeds', o.key || 'w'), rc = col(o.reedColor || mix(dim(c2, 0.45), PAL.night, 0.4));
        q.save(); q.setTransform(m);
        for (const S0 of [Ls, Rs]) for (let i = 1; i < pts.length; i++) {
          if (noise1(i / 4 + (S0 === Ls ? 0 : 50), seedOf('reedrun', o.key || 'w')) < 0.55 || RR.f() < 0.55) continue;
          const [cx, cy, hw] = pts[i], dx = S0[i][0] - cx, dy = S0[i][1] - cy, l = Math.hypot(dx, dy) || 1, bx2 = S0[i][0] + (dx / l) * hw * RR.r(-0.1, 0.15), by2 = S0[i][1] + (dy / l) * hw * 0.08;
          const hh = Math.max(3, hw * RR.r(0.35, 0.8)), n = RR.i(3, 6), wd = Math.max(0.8, hw * 0.05);
          q.fillStyle = rgba(mix(rc, c2, RR.r(0, 0.25)), RR.r(0.55, 0.9));
          for (let k = 0; k < n; k++) {
            const a = -Math.PI / 2 + RR.n(0.45), ln = hh * RR.r(0.5, 1), x0 = bx2 + RR.n(hh * 0.4), tx = x0 + Math.cos(a) * ln, ty = by2 + Math.sin(a) * ln;
            q.beginPath(); q.moveTo(x0 - wd, by2); q.quadraticCurveTo((x0 + tx) / 2 - wd * 0.5, (by2 + ty) / 2, tx, ty); q.quadraticCurveTo((x0 + tx) / 2 + wd * 0.5, (by2 + ty) / 2, x0 + wd, by2); q.closePath(); q.fill();
          }
        }
        q.restore();
      }
      if (o.edgeA) { q.save(); q.setTransform(m); q.lineJoin = 'round'; ribbon(); q.strokeStyle = rgba(col(o.edge || 'cream'), o.edgeA); q.lineWidth = 2; q.stroke(); q.restore(); }
      // out of the distance: the first part of the path fades in from nothing, banks and all (erased along the path,
      // a strip per step, each shaded from its start to its end)
      const fade = o.fade ?? 0.2;
      if (fade > 0) {
        let tot = 0; const acc = [0];
        for (let i = 1; i < pts.length; i++) acc.push((tot += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])));
        const fl = Math.max(1, tot * fade), mg = (o.bank ?? 5) + 8;
        const out = (S0, i, back) => { const c = pts[i], dx = S0[i][0] - c[0], dy = S0[i][1] - c[1], l = Math.hypot(dx, dy) || 1, t = pts[Math.min(pts.length - 1, i + 1)], tx = t[0] - c[0], ty = t[1] - c[1], tl = Math.hypot(tx, ty) || 1; return [S0[i][0] + (dx / l) * mg - (back ? (tx / tl) * mg : 0), S0[i][1] + (dy / l) * mg - (back ? (ty / tl) * mg : 0)]; };
        q.save(); q.setTransform(m); q.globalCompositeOperation = 'destination-out';
        for (let i = 0; i < pts.length - 1 && acc[i] < fl; i++) {
          const u0 = acc[i] / fl, u1 = Math.min(1, acc[i + 1] / fl), e0 = 1 - EZ.smooth(u0), e1 = 1 - EZ.smooth(u1);
          const a0 = out(Ls, i, i === 0), a1 = out(Ls, i + 1, false), b1 = out(Rs, i + 1, false), b0 = out(Rs, i, i === 0);
          const mk = q.createLinearGradient(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]); mk.addColorStop(0, `rgba(0,0,0,${e0.toFixed(4)})`); mk.addColorStop(1, `rgba(0,0,0,${e1.toFixed(4)})`);
          q.fillStyle = mk; q.beginPath(); q.moveTo(a0[0], a0[1]); q.lineTo(a1[0], a1[1]); q.lineTo(b1[0], b1[1]); q.lineTo(b0[0], b0[1]); q.closePath(); q.fill();
        }
        q.restore();
      }
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(lay, sx0, sy0, sx1 - sx0, sy1 - sy0, sx0, sy0, sx1 - sx0, sy1 - sy0); g.restore();
    }

    // ───────────────────────── puppets ─────────────────────────
    // A figure is a painted cut-out: parts on pivots (hips, shoulders, elbows, neck), each a smooth shape drawn through
    // control points ([x, y, 1] keeps a corner), in figure units (1 = the figure's height, feet at 0, facing right).
    // Each part gets three values: its colour, a warm plane toward the light, a half-shade and a core shadow away from
    // it; the brush's marks; one soft rim stroke only along the edges that face the light; and an ink line with a still
    // hand wobble. Facing flips the whole puppet; the light stays where it is.
    const SH = {
      collar: [[-0.004, -0.356], [0.03, -0.352], [0.046, -0.322, 1], [0.022, -0.31], [0.004, -0.33]],
      shawl: [[-0.05, -0.366], [-0.112, -0.336], [-0.136, -0.262], [-0.124, -0.18], [-0.08, -0.128], [-0.02, -0.142], [0.055, -0.1, 1], [0.098, -0.18], [0.112, -0.26], [0.09, -0.33], [0.032, -0.364]],
      satchel: [[-0.158, -0.03], [-0.06, -0.034], [-0.048, 0.02], [-0.056, 0.096], [-0.1, 0.112], [-0.146, 0.104], [-0.162, 0.05]],
      boot: [[-0.026, -0.032], [0.024, -0.032], [0.028, -0.004], [0.052, 0.01], [0.078, 0.022], [0.084, 0.04, 1], [-0.03, 0.04, 1], [-0.033, 0.008]],
      hand: [[-0.017, -0.004], [0.017, -0.004], [0.025, 0.01], [0.032, 0.026], [0.027, 0.036], [0.018, 0.03], [0.021, 0.049], [0.011, 0.062], [-0.006, 0.06], [-0.016, 0.046], [-0.021, 0.022]],
      fist: [[-0.018, -0.004], [0.018, -0.004], [0.027, 0.012], [0.029, 0.034], [0.018, 0.05], [-0.006, 0.05], [-0.021, 0.038], [-0.023, 0.014]],
      head: [[-0.03, -0.002], [-0.051, -0.03], [-0.061, -0.068], [-0.057, -0.106], [-0.039, -0.135], [-0.008, -0.15], [0.024, -0.146], [0.043, -0.128], [0.05, -0.106], [0.05, -0.095],
        [0.046, -0.088, 1], [0.053, -0.079], [0.072, -0.057, 1], [0.061, -0.051], [0.054, -0.05, 1], [0.057, -0.041], [0.052, -0.036, 1], [0.056, -0.029], [0.05, -0.022, 1], [0.055, -0.012], [0.047, 0.001], [0.03, 0.005], [0.004, 0.002]],
      ear: [[-0.025, -0.089], [-0.009, -0.092], [-0.002, -0.076], [-0.008, -0.058], [-0.021, -0.061], [-0.016, -0.076]],
      hair: [[-0.05, -0.03], [-0.064, -0.07], [-0.062, -0.112], [-0.044, -0.144], [-0.008, -0.16], [0.028, -0.154], [0.05, -0.132], [0.044, -0.122], [0.024, -0.128], [0.004, -0.122], [-0.008, -0.106], [-0.006, -0.088], [-0.018, -0.07], [-0.032, -0.05]],
      hairLong: [[-0.033, -0.004], [-0.058, -0.04], [-0.066, -0.084], [-0.06, -0.12], [-0.04, -0.148], [-0.006, -0.162], [0.028, -0.154], [0.05, -0.132], [0.044, -0.122], [0.024, -0.13], [0.004, -0.124], [-0.008, -0.104], [-0.004, -0.08], [-0.012, -0.05], [-0.02, -0.02]],
      hood: [[0.006, 0.04], [-0.07, 0.038], [-0.084, -0.03], [-0.078, -0.1], [-0.054, -0.152], [-0.012, -0.172], [0.032, -0.162], [0.058, -0.132], [0.062, -0.104, 1], [0.038, -0.118], [0.014, -0.124], [-0.006, -0.104], [-0.012, -0.064], [-0.002, -0.024], [0.016, 0.006]],
      beard: [[0.049, -0.034], [0.056, -0.014], [0.048, 0.016], [0.028, 0.04], [0.006, 0.034], [-0.012, 0.012], [-0.02, -0.03], [-0.012, -0.062], [-0.002, -0.05], [0.012, -0.03], [0.032, -0.03]],
      tache: [[0.059, -0.047], [0.053, -0.037], [0.036, -0.035], [0.03, -0.042], [0.046, -0.049]],
      wideCrown: [[-0.046, -0.114], [-0.045, -0.158], [-0.026, -0.184], [0.008, -0.19], [0.037, -0.178], [0.048, -0.152], [0.05, -0.116]],
      wideBrim: [[-0.112, -0.102], [-0.07, -0.122], [0.0, -0.13], [0.07, -0.128], [0.124, -0.114, 1], [0.12, -0.104], [0.06, -0.11], [0.0, -0.112], [-0.06, -0.104], [-0.112, -0.092, 1]],
      dome: [[-0.054, -0.11], [-0.052, -0.148], [-0.032, -0.172], [0.0, -0.18], [0.032, -0.173], [0.051, -0.15], [0.055, -0.112]],
      brim: [[-0.076, -0.114, 1], [-0.02, -0.122], [0.05, -0.122], [0.084, -0.118, 1], [0.08, -0.104], [-0.074, -0.1]],
      tophat: [[-0.046, -0.11, 1], [-0.05, -0.215, 1], [0.0, -0.222], [0.046, -0.219, 1], [0.048, -0.113, 1]],
      cap: [[-0.058, -0.1], [-0.054, -0.138], [-0.022, -0.157], [0.03, -0.152], [0.06, -0.124], [0.096, -0.112, 1], [0.05, -0.1]],
      seat: [[-0.2, 0.004, 1], [-0.214, -0.06], [-0.196, -0.16], [-0.14, -0.236], [-0.06, -0.27], [0.03, -0.282], [0.1, -0.262], [0.15, -0.21], [0.172, -0.12], [0.166, -0.05], [0.18, 0.004, 1]],
    };
    /** The body for a kind and pose, in the hips' frame; sw swings the hem (on the twos boil). */
    function bodyShape(kind, sit, sw) {
      const upper = [[0.088, -0.31], [0.06, -0.342], [0.026, -0.354], [-0.028, -0.354], [-0.07, -0.34], [-0.1, -0.314], [-0.113, -0.262], [-0.109, -0.17], [-0.099, -0.072]];
      const chest = [[0.087, -0.072], [0.1, -0.17], [0.105, -0.25]];
      if (!sit && kind === 'coat') return [...upper, [-0.106, 0.02], [-0.126 + sw * 0.5, 0.15], [-0.15 + sw, 0.286, 1], [-0.1 + sw, 0.298], [-0.05 + sw, 0.282], [0.002 + sw, 0.3], [0.062 + sw, 0.284], [0.12 + sw, 0.292, 1], [0.106 + sw * 0.5, 0.15], [0.09, 0.02], ...chest];
      if (!sit && kind === 'dress') return [...upper, [-0.11, 0.04], [-0.15 + sw * 0.5, 0.24], [-0.182 + sw, 0.452, 1], [-0.1 + sw, 0.466], [-0.02 + sw, 0.452], [0.06 + sw, 0.47], [0.178 + sw, 0.456, 1], [0.14 + sw * 0.5, 0.24], [0.092, 0.04], ...chest];
      if (!sit) return [...upper, [-0.112, 0.02], [-0.128 + sw, 0.186, 1], [-0.06 + sw, 0.196], [0.02 + sw, 0.184], [0.124 + sw, 0.192, 1], [0.1, 0.02], ...chest];
      if (kind === 'dress') return [...upper, [-0.118, 0.02], [-0.138, 0.09], [-0.152, 0.152, 1], [-0.09, 0.142], [0.0, 0.152], [0.09, 0.176], [0.158, 0.214], [0.176, 0.232, 1], [0.222 + sw, 0.238], [0.264 + sw, 0.226], [0.302 + sw, 0.238, 1], [0.284, 0.14], [0.272, 0.06], [0.262, 0.0], [0.24, -0.032], [0.2, -0.046], [0.13, -0.046], [0.092, -0.074], ...chest.slice(1)];
      if (kind === 'tunic') return [...upper, [-0.112, 0.02], [-0.124, 0.07], [-0.13 + sw * 0.5, 0.104, 1], [-0.06, 0.094], [0.04, 0.066], [0.124, 0.058, 1], [0.134, 0.0], [0.11, -0.036], [0.09, -0.07], ...chest.slice(1)];
      return [...upper, [-0.112, 0.02], [-0.13, 0.085], [-0.14 + sw * 0.5, 0.13, 1], [-0.08, 0.12], [0.0, 0.072], [0.09, 0.064], [0.16, 0.06], [0.206, 0.052, 1], [0.216, 0.0], [0.19, -0.036], [0.12, -0.042], [0.09, -0.07], ...chest.slice(1)];
    }
    /** A cloak behind the shoulders, its hem swinging. */
    const cloakShape = (sit, sw) => (sit
      ? [[0.03, -0.362], [-0.05, -0.364], [-0.118, -0.33], [-0.148, -0.26], [-0.158, -0.14], [-0.17, 0.0], [-0.19 + sw, 0.14, 1], [-0.12 + sw, 0.15], [-0.06, 0.06], [-0.02, -0.25]]
      : [[0.03, -0.362], [-0.05, -0.364], [-0.118, -0.33], [-0.148, -0.26], [-0.158, -0.14], [-0.172, 0.02], [-0.196 + sw, 0.16], [-0.226 + sw * 1.4, 0.31, 1], [-0.156 + sw, 0.328], [-0.086 + sw, 0.31, 1], [-0.046, 0.0], [-0.016, -0.25]]);
    const SEEDS = new Map();
    const seedK = (...k) => { const id = k.join('|'); let s = SEEDS.get(id); if (s == null) { s = seedOf(...k); if (SEEDS.size > 4000) SEEDS.clear(); SEEDS.set(id, s); } return s; };
    /** A part's control points with a still hand wobble (keyed: it holds from frame to frame). */
    function wob(P, name, key, amt = 0.0016) { const s = seedK('wob', name, key); return P.map((p, i) => [p[0] + (hashI(i, s) - 0.5) * 2 * amt, p[1] + (hashI(i, s + 1) - 0.5) * 2 * amt, p[2]]); }
    const NAP = new Map();
    /** A part's own brush marks, in its frame (made once per part and key): the cloth's weave, the skin's planes. */
    function nap(P, key) {
      if (NAP.has(key)) return NAP.get(key);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of P) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      const R = RNG('nap', key), n = Math.max(4, Math.min(22, Math.round(((x1 - x0) * (y1 - y0)) / 0.001))), out = [];
      for (let i = 0; i < n; i++) { const x = R.r(x0, x1), y = R.r(y0, y1), a = Math.PI / 2 + R.n(0.3), l = R.r(0.03, 0.1); out.push([x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, R.r(0.006, 0.018), R.n(1)]); }
      if (NAP.size > 2000) NAP.clear();
      NAP.set(key, out);
      return out;
    }
    /** One soft painted stroke along the edges of P that face L (inside P; the gradient fades it round the sides). */
    function rimOn(P, L, st, k = 1) {
      let p0 = Infinity, p1 = -Infinity, sx = 0, sy = 0;
      for (const [x, y] of P) { const d = x * L[0] + y * L[1]; p0 = Math.min(p0, d); p1 = Math.max(p1, d); sx += x; sy += y; }
      const cx = sx / P.length, cy = sy / P.length, c0 = cx * L[0] + cy * L[1], a = st.rim * k;
      const q = g.createLinearGradient(cx + L[0] * (p0 - c0), cy + L[1] * (p0 - c0), cx + L[0] * (p1 - c0), cy + L[1] * (p1 - c0));
      q.addColorStop(0, rgba(st.rimC, 0)); q.addColorStop(0.45, rgba(st.rimC, 0)); q.addColorStop(0.78, rgba(st.rimC, a * 0.55)); q.addColorStop(1, rgba(st.rimC, a));
      g.strokeStyle = q; g.lineJoin = 'round';
      g.globalAlpha = 0.4; g.lineWidth = st.px * 20; g.beginPath(); shapeTo(g, P); g.stroke();
      g.globalAlpha = 0.9; g.lineWidth = st.px * 7; g.beginPath(); shapeTo(g, P); g.stroke();
      g.globalAlpha = 1;
    }
    /** One painted part in the current transform: L the light in this part's frame (unit), st the figure's look; a part
     *  that moves (a swinging hem, a bending arm) passes o.rest, its shape at rest, so its brush marks never depend on
     *  which frame drew first. */
    function cel(P, base, st, L, o = {}) {
      const sz = o.size ?? 0.08, b = col(base), sh = o.shade ?? 1;
      g.save(); g.beginPath(); shapeTo(g, P); g.clip();
      g.fillStyle = rgba(b); g.fillRect(-4, -4, 8, 8);
      if (st.lit > 0 && o.lit !== false) { g.beginPath(); g.rect(-4, -4, 8, 8); shapeTo(g, P, -L[0] * sz * 0.5, -L[1] * sz * 0.5); g.fillStyle = rgba(st.litOf(b), st.lit * (o.litK ?? 1)); g.fill('evenodd'); }
      if (st.nap && o.nap !== false) { g.lineCap = 'round'; for (const [ax, ay, bx2, by2, wd, v] of nap(o.rest || P, st.key + '|' + (o.id || P.length))) { g.strokeStyle = rgba(v > 0 ? mix(b, PAL.cream, 0.1 * v) : dim(b, 1 + 0.2 * v), 0.5); g.lineWidth = wd; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx2, by2); g.stroke(); } }
      g.beginPath(); g.rect(-4, -4, 8, 8); shapeTo(g, P, L[0] * sz * 0.3, L[1] * sz * 0.3); g.fillStyle = rgba(st.shadeOf(b), 0.72 * sh); g.fill('evenodd');
      g.beginPath(); g.rect(-4, -4, 8, 8); shapeTo(g, P, L[0] * sz * 0.66, L[1] * sz * 0.66); g.fillStyle = rgba(st.coreOf(b), 0.78 * sh); g.fill('evenodd');
      if (o.inner) o.inner();
      if (st.rim > 0 && o.rim !== false) rimOn(P, L, st, o.rimK ?? 1);
      g.restore();
      g.beginPath(); shapeTo(g, P); g.lineJoin = 'round'; g.lineWidth = st.lw * (o.lw ?? 1); g.strokeStyle = rgba(st.inkC, st.inkA); g.stroke();
    }
    /** A thin ink line inside a part (a fold, a seam, the coat's opening), smooth through its points. */
    function crease(pts, st, a = 0.55, wk = 0.6) { g.beginPath(); curveTo(g, pts); g.lineWidth = st.lw * wk; g.strokeStyle = rgba(st.inkC, a); g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke(); }
    const deg = Math.PI / 180;
    /**
     * A puppet standing (or sitting) with its feet at world (x, y), in the current transform (call it inside K.layer).
     * o: { h: height px (300), face: 1 right | -1 left, kind: 'coat'|'dress'|'tunic', hat: 'wide'|'bowler'|'top'|'cap'|
     *   'hood'|'scarf'|null, beard: true|'grey', longHair, shawl, cloak, bag, sash, sit, lean (deg), look (deg, head up +), tilt
     *   (deg, head roll), arms: [[shoulder, elbow], [shoulder, elbow]] back and front in degrees (0 = hanging, 90 =
     *   forward), staff, blink, brow, colours { coat, skin, hatColor, hair, legs, accent, cloakColor }, light: [x, y] (a
     *   world point; planes and rim face it), rim 0..1, rimColor, warm (the lit plane, 0..1), dark 0..1 (toward a
     *   silhouette), cast (a long shadow away from the light, its alpha), swing (the hem, 1), key, head (size, 1), shadow }
     */
    function figure(x, y, o = {}) {
      const h = o.h || 300, f = o.face === -1 ? -1 : 1, key = o.key || 'fig', dark = clamp(o.dark ?? 0), sit = !!o.sit;
      const SIL = [12, 16, 17], warmC = col(o.rimColor || 'ember');
      const tone = (c) => mix(col(c), SIL, dark * (dark > 0.8 ? 0.97 : 0.9));
      const cs = { coat: tone(o.coat || 'umber'), skin: tone(o.skin || 'skin'), hat: tone(o.hatColor || '#2a221c'), hair: tone(o.hair || '#2a2019'), legs: tone(o.legs || '#3b342c'), accent: tone(o.accent || 'oxblood'), staff: tone('#6a5038'), shirt: tone('#d8c7a1'), boot: tone('#251d17'), bag: tone(o.bagColor || '#6a5236'), cloak: tone(o.cloakColor || mix(col(o.coat || 'umber'), PAL.deep, 0.45)) };
      const lv = o.light ? [o.light[0] - x, o.light[1] - (y - h * 0.7)] : [0.6, -0.8], lw = Math.hypot(lv[0], lv[1]) || 1, Lw = [lv[0] / lw, lv[1] / lw];
      const st = {
        rim: o.rim ?? 0.85, rimC: mix(warmC, PAL.cream, 0.12), px: 1 / h, lw: (o.lineW ?? 2.9) / h, inkC: PAL.ink, inkA: 0.92, nap: o.nap !== false, key,
        lit: clamp(o.warm ?? 0.55 - dark * 0.62), litOf: (c) => mix(c, mix(warmC, PAL.cream, 0.25), 0.34),
        shadeOf: (c) => mix(dim(c, 0.6), PAL.deep, 0.26), coreOf: (c) => mix(dim(c, 0.36), PAL.night, 0.42),
      };
      const Lin = (a) => { const vx = Lw[0] * f, vy = Lw[1], c = Math.cos(-a), sn = Math.sin(-a); const lx = vx * c - vy * sn, ly = vx * sn + vy * c, l = Math.hypot(lx, ly) || 1; return [lx / l, ly / l]; };
      const lean = (o.lean || 0) * deg, look = -(o.look || 0) * deg, tilt = (o.tilt || 0) * deg;
      const arms = o.arms || [[6, 12], [-4, 16]], hs = o.head ?? 1, kind = o.kind || 'coat';
      const B = C ? C.B : 0, sw = (o.swing ?? 1) * (noise1(B * 0.45, seedK('swing', key)) - 0.5) * 0.024;
      // a long soft shadow on the ground, away from a low light
      if (o.cast && o.light) {
        const dir = x >= o.light[0] ? 1 : -1, ly = Math.max(24, y - o.light[1]), len = h * clamp((0.66 * h) / ly, 0.5, 2.3), x0 = x - dir * h * 0.1, x1 = x + dir * len;
        const q = g.createLinearGradient(x0, 0, x1, 0), sc = [6, 10, 12]; q.addColorStop(0, rgba(sc, o.cast)); q.addColorStop(0.5, rgba(sc, o.cast * 0.55)); q.addColorStop(1, rgba(sc, 0));
        g.save(); g.fillStyle = q; g.beginPath(); g.moveTo(x0, y - h * 0.012); g.quadraticCurveTo((x0 + x1) / 2, y - h * 0.05, x1, y - h * 0.035); g.quadraticCurveTo(x1 + dir * h * 0.04, y + h * 0.005, x1, y + h * 0.04); g.quadraticCurveTo((x0 + x1) / 2, y + h * 0.05, x0, y + h * 0.014); g.closePath(); g.fill(); g.restore();
      }
      if (o.shadow !== 0) { g.save(); g.fillStyle = rgba(PAL.night, o.shadow ?? 0.45); g.beginPath(); g.ellipse(x + (sit ? f * h * 0.04 : 0), y + h * 0.006, h * (sit ? 0.24 : 0.13), h * 0.024, 0, 0, TAU); g.fill(); g.restore(); }
      g.save(); g.translate(x, y); g.scale(f * h, h);
      const hipY = sit ? -0.27 : -0.47;
      // a seated puppet sits on something: a rounded stone under the hips (o.seat: false when the scene draws its own)
      if (sit && o.seat !== false) {
        const sc = mix(col(o.seatColor || '#433c35'), SIL, dark * 0.6), sR = RNG('seat', key);
        cel(wob(SH.seat, 'seat', key, 0.016), sc, { ...st, lit: Math.max(st.lit, 0.45), litOf: (c) => mix(c, warmC, 0.38), nap: false }, Lin(0), { size: 0.22, id: 'seat',
          inner: () => {
            // the stone's brushwork: short level strokes, lighter on top, and a crack or two
            g.lineCap = 'round';
            for (let i = 0; i < 26; i++) { const yy = sR.r(-0.27, -0.01), xx = sR.r(-0.2, 0.17), l = sR.r(0.03, 0.09), v = sR.n(1) - (yy + 0.14) * 3; g.strokeStyle = rgba(v > 0 ? mix(sc, PAL.cream, 0.14 * Math.min(1, v)) : dim(sc, 0.8), sR.r(0.3, 0.6)); g.lineWidth = sR.r(0.008, 0.02); g.beginPath(); g.moveTo(xx, yy); g.quadraticCurveTo(xx + l * 0.5, yy + sR.n(0.01), xx + l, yy + sR.n(0.012)); g.stroke(); }
            crease([[-0.12, -0.21], [-0.08, -0.15], [-0.09, -0.07]], st, 0.35); crease([[0.07, -0.25], [0.11, -0.19]], st, 0.3);
          } });
      }
      if (o.cloak) { g.save(); g.translate(0, hipY); g.rotate(lean); cel(wob(cloakShape(sit, sw), 'cloak', key), cs.cloak, st, Lin(lean), { size: 0.14, id: 'cloak', rest: cloakShape(sit, 0), inner: () => crease([[-0.1, -0.3], [-0.14, -0.05], [-0.17 + sw, sit ? 0.12 : 0.28]], st, 0.35) }); g.restore(); }
      const legs = (back) => {
        if (kind === 'dress' && !sit) return;
        g.save();
        const lc = back ? dim(cs.legs, 0.78) : cs.legs, n = back ? 'b' : 'f';
        let ank;
        if (sit) {
          g.translate(back ? -0.014 : 0.012, hipY);
          const kx = back ? 0.196 : 0.206, ky = back ? -0.006 : -0.014, ax = back ? 0.212 : 0.228;
          cel(wob(limb([[0, 0, 0.088], [kx * 0.55, ky * 0.6, 0.08], [kx, ky, 0.066], [lerp(kx, ax, 0.5), 0.11, 0.054], [ax, 0.228, 0.046]]), 'leg' + n, key), lc, st, Lin(0), { size: 0.06, id: 'leg' + n });
          ank = [ax, 0.228];
        } else {
          const sp = o.stride ?? 0.035, r = back ? sp : -sp * 0.6;
          g.translate(back ? -0.022 : 0.018, hipY); g.rotate(r);
          cel(wob(limb([[0, 0, 0.082], [0.008, 0.12, 0.07], [0.014, 0.225, 0.058], [0.006, 0.33, 0.05], [0, 0.432, 0.043]]), 'leg' + n, key), lc, st, Lin(r), { size: 0.06, id: 'leg' + n,
            inner: () => crease([[0.002, 0.21], [0.016, 0.232], [0.03, 0.226]], st, 0.35) });
          ank = [0, 0.432];
          g.translate(ank[0], ank[1]); g.rotate(-r); ank = [0, 0];
        }
        g.translate(ank[0], ank[1]);
        cel(wob(SH.boot, 'boot' + n, key), cs.boot, st, Lin(0), { size: 0.03, rimK: 0.6, id: 'boot' + n, inner: () => crease([[-0.03, 0.03], [0.08, 0.03]], st, 0.5) });
        g.restore();
      };
      const arm = (i) => {
        const [sh, el] = arms[i], back = i === 0, ac = back ? dim(cs.coat, 0.8) : cs.coat;
        g.save();
        g.translate(back ? -0.036 : 0.026, -0.3); g.rotate(-sh * deg);
        const a1 = lean - sh * deg, e = el * deg, dx = Math.sin(e), dy = Math.cos(e), E = [0, 0.168], Wr = [E[0] + dx * 0.142, E[1] + dy * 0.142];
        const J = [[0, -0.026, 0.084], [0.002, 0.07, 0.07], [E[0], E[1], 0.056], [E[0] + dx * 0.07, E[1] + dy * 0.07, 0.05], [Wr[0] - dx * 0.012, Wr[1] - dy * 0.012, 0.052], [Wr[0], Wr[1], 0.05]];
        cel(wob(limb(J), 'arm' + i, key), ac, st, Lin(a1), { size: 0.06, id: 'arm' + i, rest: limb([[0, -0.026, 0.084], [0, 0.17, 0.056], [0, 0.31, 0.05]]),
          inner: () => { crease([[Wr[0] - dy * 0.023 - dx * 0.016, Wr[1] + dx * 0.023 - dy * 0.016], [Wr[0] + dy * 0.023 - dx * 0.016, Wr[1] - dx * 0.023 - dy * 0.016]], st, 0.5); if (el > 25) crease([[E[0] + 0.02, E[1] - 0.03], [E[0] + 0.03 * dx + 0.012, E[1] + 0.004]], st, 0.35); } });
        g.translate(Wr[0], Wr[1]); g.rotate(-e);
        const grip = o.staff && !back;
        if (grip) {
          // the staff, held: drawn first, so the fist closes over it
          g.save(); g.translate(0.003, 0.024); g.rotate((sh + el) * deg - lean);
          const st0 = -0.2, len = o.staffLen ?? 0.66;
          cel(wob(limb([[0, st0, 0.024], [0.004, st0 + (len - st0) * 0.35, 0.021], [-0.003, st0 + (len - st0) * 0.7, 0.02], [0, len, 0.018]]), 'staff', key, 0.001), cs.staff, st, Lin(0), { size: 0.02, id: 'staff', nap: false });
          g.restore();
        }
        cel(wob(grip ? SH.fist : SH.hand, grip ? 'fist' : 'hand' + i, key, 0.001), cs.skin, st, Lin(a1 - e), { size: 0.03, id: 'hand' + i, nap: false,
          inner: grip ? () => crease([[0.024, 0.016], [0.012, 0.024], [0.006, 0.04]], st, 0.45) : null });
        g.restore();
      };
      legs(true); legs(false);
      g.save(); g.translate(0, hipY); g.rotate(lean);
      arm(0);
      cel(wob(bodyShape(kind, sit, sw), 'body', key, 0.0018), cs.coat, st, Lin(lean), { size: 0.16, id: 'body' + kind + sit, rest: bodyShape(kind, sit, 0),
        inner: () => {
          const hem = sit ? (kind === 'dress' ? 0.23 : kind === 'tunic' ? 0.06 : 0.058) : kind === 'dress' ? 0.45 : kind === 'tunic' ? 0.185 : 0.288;
          if (kind === 'coat') {
            g.fillStyle = rgba(cs.shirt, 0.92); g.beginPath(); shapeTo(g, SH.collar); g.fill();
            crease([[0.034, -0.35], [0.06, -0.26], [0.086, -0.12], sit ? [0.16, -0.035] : [0.098 + sw * 0.5, 0.1], sit ? [0.2, 0.02] : [0.112 + sw, hem]], st, 0.6);
            g.fillStyle = rgba(PAL.ink, 0.6); for (const by of [-0.2, -0.14, -0.08]) { g.beginPath(); g.arc(0.072, by, 0.0055, 0, TAU); g.fill(); }
          }
          if (kind === 'dress' && sit) { crease([[0.226, -0.03], [0.244, 0.1], [0.236 + sw, 0.226]], st, 0.4); crease([[0.13, -0.044], [0.17, -0.02], [0.2, 0.0]], st, 0.3); crease([[0.0, 0.02], [0.07, 0.1], [0.14, 0.2]], st, 0.3); }
          else if (!sit) { crease([[-0.05, -0.06], [-0.07, hem * 0.5], [-0.09 + sw, hem]], st, 0.35); crease([[0.03, -0.04], [0.04 + sw * 0.5, hem * 0.6], [0.03 + sw, hem]], st, 0.3); }
          if (o.sash ?? kind === 'tunic') { g.fillStyle = rgba(kind === 'tunic' ? mix(cs.legs, cs.accent, 0.3) : cs.accent); g.beginPath(); shapeTo(g, [[-0.12, -0.092, 1], [0.1, -0.098, 1], [0.1, -0.07, 1], [-0.12, -0.064, 1]]); g.fill(); }
        } });
      if (o.bag) {
        g.lineCap = 'round'; g.strokeStyle = rgba(st.inkC, 0.9); g.lineWidth = 0.02; g.beginPath(); curveTo(g, [[0.05, -0.33], [-0.02, -0.16], [-0.1, -0.02]]); g.stroke();
        g.strokeStyle = rgba(cs.bag); g.lineWidth = 0.011; g.beginPath(); curveTo(g, [[0.05, -0.33], [-0.02, -0.16], [-0.1, -0.02]]); g.stroke();
        cel(wob(SH.satchel, 'satchel', key), cs.bag, st, Lin(lean), { size: 0.05, id: 'satchel', inner: () => crease([[-0.158, 0.01], [-0.1, 0.03], [-0.05, 0.016]], st, 0.5) });
      }
      if (o.shawl) cel(wob(SH.shawl, 'shawl', key), cs.accent, st, Lin(lean), { size: 0.08, id: 'shawl', inner: () => crease([[-0.1, -0.3], [-0.08, -0.2], [-0.04, -0.15]], st, 0.35) });
      // neck and head
      g.save(); g.translate(0.008, -0.345); g.rotate(look + tilt);
      const ha = lean + look + tilt, L = Lin(ha);
      cel(wob(limb([[0.002, 0.03, 0.05], [0.004, -0.004, 0.046], [0.006, -0.03, 0.042]]), 'neck', key, 0.001), cs.skin, st, L, { size: 0.03, id: 'neck', nap: false });
      g.scale(hs, hs);
      const hooded = o.hat === 'scarf' || o.hat === 'hood';
      if (hooded) cel(wob(SH.hood, 'hood', key), o.hatColor ? cs.hat : cs.accent, st, L, { size: 0.07, id: 'hood', inner: () => crease([[-0.05, -0.13], [-0.066, -0.06], [-0.05, 0.02]], st, 0.35) });
      cel(wob(SH.head, 'head', key, 0.0009), cs.skin, st, L, { size: 0.06, id: 'head', nap: false,
        inner: () => { const q = g.createRadialGradient(0.032, -0.05, 0, 0.032, -0.05, 0.03); q.addColorStop(0, rgba(PAL.oxblood, 0.22 * (1 - dark))); q.addColorStop(1, rgba(PAL.oxblood, 0)); g.fillStyle = q; g.fillRect(0, -0.09, 0.07, 0.08); } });
      if (!hooded) { cel(wob(o.longHair ? SH.hairLong : SH.hair, 'hair', key, 0.0012), cs.hair, { ...st, rim: st.rim * 0.8 }, L, { size: 0.05, id: 'hair' }); cel(wob(SH.ear, 'ear', key, 0.0006), cs.skin, st, L, { size: 0.02, shade: 0.6, id: 'ear', nap: false, inner: () => crease([[-0.008, -0.083], [-0.014, -0.074], [-0.01, -0.066]], st, 0.4, 0.4) }); }
      if (o.beard) { const bc = mix(cs.hair, PAL.cream, o.beard === 'grey' ? 0.55 : 0); cel(wob(SH.beard, 'beard', key, 0.0012), bc, st, L, { size: 0.04, id: 'beard' }); cel(wob(SH.tache, 'tache', key, 0.0006), bc, st, L, { size: 0.02, id: 'tache', nap: false }); }
      // the face: an eye under its lid (a line when it blinks), a brow, a nostril, the mouth
      g.fillStyle = rgba(PAL.ink); g.strokeStyle = rgba(PAL.ink); g.lineCap = 'round';
      if (o.blink) { g.lineWidth = 0.0055; g.beginPath(); g.moveTo(0.018, -0.081); g.quadraticCurveTo(0.029, -0.077, 0.04, -0.081); g.stroke(); }
      else {
        g.fillStyle = rgba(mix(PAL.cream, cs.skin, 0.5)); g.beginPath(); g.moveTo(0.02, -0.082); g.quadraticCurveTo(0.03, -0.09, 0.041, -0.083); g.quadraticCurveTo(0.031, -0.075, 0.02, -0.082); g.fill();
        g.fillStyle = rgba(PAL.ink); g.beginPath(); g.ellipse(0.033, -0.0825, 0.0048, 0.0058, 0, 0, TAU); g.fill();
        g.lineWidth = 0.0042; g.beginPath(); g.moveTo(0.018, -0.083); g.quadraticCurveTo(0.03, -0.092, 0.042, -0.084); g.stroke();
      }
      g.lineWidth = 0.0062; g.beginPath(); g.moveTo(0.014, -0.096 - (o.brow || 0) * 0.006); g.quadraticCurveTo(0.03, -0.103 - (o.brow || 0) * 0.008, 0.047, -0.097 - (o.brow || 0) * 0.003); g.stroke();
      g.lineWidth = 0.0035; g.beginPath(); g.moveTo(0.06, -0.055); g.quadraticCurveTo(0.052, -0.06, 0.05, -0.054); g.stroke();
      if (!o.beard) { g.lineWidth = 0.0035; g.beginPath(); g.moveTo(0.052, -0.036); g.lineTo(0.04, -0.034); g.stroke(); }
      if (o.hat === 'wide') { cel(wob(SH.wideCrown, 'crown', key, 0.001), cs.hat, st, L, { size: 0.05, id: 'crown', inner: () => { g.fillStyle = rgba(cs.accent, 0.85); g.fillRect(-0.06, -0.132, 0.12, 0.014); } }); cel(wob(SH.wideBrim, 'wbrim', key, 0.001), cs.hat, st, L, { size: 0.03, id: 'wbrim' }); }
      else if (o.hat === 'bowler') { cel(wob(SH.dome, 'dome', key, 0.001), cs.hat, st, L, { size: 0.05, id: 'dome', inner: () => { g.fillStyle = rgba(cs.accent, 0.8); g.fillRect(-0.06, -0.128, 0.12, 0.012); } }); cel(wob(SH.brim, 'brim', key, 0.001), cs.hat, st, L, { size: 0.02, id: 'brim' }); }
      else if (o.hat === 'top') { cel(wob(SH.tophat, 'tophat', key, 0.001), cs.hat, st, L, { size: 0.05, id: 'tophat' }); cel(wob(SH.brim, 'brim', key, 0.001), cs.hat, st, L, { size: 0.02, id: 'brim' }); }
      else if (o.hat === 'cap') cel(wob(SH.cap, 'cap', key, 0.001), cs.hat, st, L, { size: 0.04, id: 'cap' });
      g.restore();
      arm(1);
      g.restore();
      g.restore();
    }
    /** Blinks from T alone: true for ~0.13 s about every 3.6 s (jittered per key). */
    function blinking(T, key = 'b', every = 3.6) { const k = Math.floor(T / every), R = RNG('blink', key, k), t0 = k * every + R.r(0.4, every - 0.4); return T >= t0 && T < t0 + 0.13; }

    // ───────────────────────── the ink-wipe ─────────────────────────
    const DIRS = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };
    /** The wipe's front at u (0..1) in screen units: { poly (the side already wiped), edge (the front line), dir }. */
    function wipeShape(u, o = {}) {
      const d = DIRS[o.dir || 'right'] || DIRS.right, horiz = d[0] !== 0, sd = seedOf('wipe', o.key || 'w');
      const along = horiz ? W : H, across = horiz ? H : W, amp = o.amp ?? 70, slant = (o.slant ?? 0.14) * across, margin = amp * 2.6 + 70 + Math.abs(slant) / 2;
      const start = horiz ? (d[0] > 0 ? 0 : W) : (d[1] > 0 ? 0 : H), sign = horiz ? d[0] : d[1];
      const front = lerp(-margin, along + margin, u);
      const off = (v) => {
        const q = v / across;
        let k = amp * (fbm(q * 3.2, sd, 3) - 0.5) * 2 + (noise1(v / 9, sd + 7) - 0.5) * 16 + (q - 0.5) * slant;
        for (let i = 0; i < 4; i++) { const c = hashI(i, sd + 3), w = 0.03 + hashI(i, sd + 4) * 0.05, dq = (q - c) / w; k += Math.exp(-dq * dq) * amp * 1.4 * hashI(i, sd + 5); }
        return k;
      };
      const edge = [];
      for (let v = -40; v <= across + 40; v += 8) { const a = start + sign * (front + off(v)); edge.push(horiz ? [a, v] : [v, a]); }
      const behind = start - sign * 200;
      const back = horiz ? [[behind, across + 40], [behind, -40]] : [[across + 40, behind], [-40, behind]];
      return { poly: [...edge, ...back], edge, dir: d };
    }
    /** An ink-wipe between two shots: a draws the old shot, b the new; the new is revealed behind a painted ink front. */
    function wipe(T, t0, dur, a, b, o = {}) {
      if (T < t0) return a();
      if (T >= t0 + dur) return b();
      const ease = typeof o.ease === 'function' ? o.ease : EZ[o.ease] || EZ.io, u = ease(clamp((T - t0) / dur));
      a();
      const sh = wipeShape(u, o);
      g.save(); g.setTransform(S, 0, 0, S, 0, 0); g.beginPath(); sh.poly.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.clip();
      b();
      g.restore();
      // the painted front: a loaded brush. Bristles run along the front, each its own pressure; the leading side is
      // wet and solid, the trailing side breaks into dry-brush; spatter flies ahead and hairs drag behind. Every mark
      // is keyed to the front (its edge index), never to the frame, so the marks travel with it.
      g.save(); g.setTransform(S, 0, 0, S, 0, 0); g.lineJoin = 'round'; g.lineCap = 'butt';
      const R = RNG('wipe-edge', o.key || 'w'), ink = col(o.color || 'ink'), d = sh.dir, sd = seedOf('wipe-band', o.key || 'w'), E = sh.edge;
      const bw = o.width ?? 64, wv = E.map((_, i) => bw * (0.55 + 0.9 * noise1(i / 7, sd)) * (0.85 + 0.15 * noise1(i / 2, sd + 1)));
      const at = (i, k) => [E[i][0] + d[0] * wv[i] * k, E[i][1] + d[1] * wv[i] * k];
      // the wet core: solid, from just ahead of the front to the middle of the band
      g.fillStyle = rgba(ink, 0.97); g.beginPath();
      E.forEach((_, i) => { const [x, y] = at(i, 0.35); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      for (let i = E.length - 1; i >= 0; i--) { const [x, y] = at(i, -0.3 - 0.1 * noise1(i / 3, sd + 2)); g.lineTo(x, y); }
      g.closePath(); g.fill();
      // the dry-brush trailing edge: the bristles' streaks dragged out behind the core, along the stroke, each its own
      // length and load, fading as the brush runs dry
      const px2 = -d[1], py2 = d[0];
      for (let i = 0; i < E.length; i++) for (let k = 0; k < 3; k++) {
        const id = i * 3 + k, hh = hashI(id, sd + 21), len = wv[i] * (0.2 + 1.5 * hh * hh), th = 1.6 + 4.2 * hashI(id, sd + 22), o2 = (k - 1) * 2.7 + (hashI(id, sd + 23) - 0.5) * 2;
        const [sx, sy] = at(i, -0.26 - 0.1 * hashI(id, sd + 24));
        g.lineWidth = th; g.lineCap = 'round';
        for (let q2 = 0; q2 < 3; q2++) {
          if (hashI(id * 3 + q2, sd + 25) < 0.18 * q2) continue;
          const a0 = (q2 / 3) * len, a1 = ((q2 + 1) / 3) * len - 2;
          g.strokeStyle = rgba(ink, [0.9, 0.6, 0.3][q2] * (0.6 + 0.4 * hashI(id, sd + 26)));
          g.beginPath(); g.moveTo(sx - d[0] * a0 + px2 * o2, sy - d[1] * a0 + py2 * o2); g.lineTo(sx - d[0] * a1 + px2 * o2, sy - d[1] * a1 + py2 * o2); g.stroke();
        }
      }
      // hairs dragging behind the band
      g.lineCap = 'round';
      for (let i = 0; i < 26; i++) {
        const ei = Math.floor(R.f() * E.length), l = R.r(12, 80), side = R.n(3), lw2 = R.r(1, 3), [sx, sy] = at(ei, -1.0);
        g.lineWidth = lw2;
        let s0 = 0;
        while (s0 < l) {
          const seg = R.r(6, 24), a2 = 0.55 * (1 - s0 / l);
          g.strokeStyle = rgba(ink, a2 * R.r(0.4, 1)); g.beginPath();
          g.moveTo(sx - d[0] * s0 + d[1] * side, sy - d[1] * s0 + d[0] * side); g.lineTo(sx - d[0] * (s0 + seg) + d[1] * side, sy - d[1] * (s0 + seg) + d[0] * side); g.stroke();
          s0 += seg + R.r(3, 14);
        }
      }
      // spatter flung ahead of the front
      g.fillStyle = rgba(ink, 0.9);
      for (let i = 0; i < 20; i++) {
        const ei = Math.floor(R.f() * E.length), a2 = R.r(14, 80), jx = R.n(6), jy = R.n(6), r0 = R.r(1.2, 5.5), [ex, ey] = at(ei, 0.35);
        const r = r0 * (1 - a2 / 100) * clamp(u * 6);
        if (r <= 0.3) continue;
        g.beginPath(); g.arc(ex + d[0] * a2 + jx, ey + d[1] * a2 + jy, r, 0, TAU); g.fill();
      }
      g.restore();
      return undefined;
    }

    // ───────────────────────── type ─────────────────────────
    const FONT = Object.freeze({ serif: '"Painted Doc Serif"', italic: '"Painted Doc Italic"', mono: '"Painted Doc Mono"' });
    let TEX = null;
    /** A brush texture for painted lettering (made once). */
    function letterTexture() {
      if (TEX) return TEX;
      const c = canvas(1024, 256), p = c.getContext('2d'), R = RNG('letters');
      p.fillStyle = '#ffffff'; p.fillRect(0, 0, 1024, 256);
      for (let i = 0; i < 700; i++) brush(p, R, R.r(0, 1024), R.r(0, 256), R.n(0.08), R.r(30, 160), R.r(3, 10), [R.r(150, 235), R.r(140, 225), R.r(120, 205)], R.r(0.1, 0.35), { vary: 10, n: 3 });
      TEX = c;
      return c;
    }
    /** A brushy reveal mask from x0 to x0 + w·u (in G's current frame), its leading edge ragged. */
    function revealClip(G, x0, y0, w, h, u, key) {
      if (u >= 1) return;
      const s = seedOf('reveal', key), xe = x0 - 30 + (w + 60) * u;
      G.beginPath(); G.moveTo(x0 - 40, y0 - 10);
      for (let y = y0 - 10; y <= y0 + h + 10; y += 6) G.lineTo(xe + (noise1(y / 11, s) - 0.5) * 34 + (noise1(y / 3, s + 1) - 0.5) * 8, y);
      G.lineTo(x0 - 40, y0 + h + 10); G.closePath(); G.clip();
    }
    const unit = (T, at, dur) => (at == null ? 1 : clamp((T - at) / (dur || 0.5)));
    /**
     * A tracked mono label (an eyebrow, a date, a place): a painted rule, then the words brushed on from the left; at
     * o.until it is wiped away the same way. o: { size 24, tracking 6, color cream, alpha .9, at, until, dur, rule }
     */
    function label(id, str, x, y, o = {}) {
      const T = C.TT, inU = EZ.o3(unit(T, o.at, o.dur ?? 0.7)), outU = o.until != null ? EZ.i2(unit(T, o.until, o.dur ?? 0.5)) : 0;
      if (inU <= 0 || outU >= 1) return null;
      const size = o.size || 24, col0 = col(o.color || 'cream'), ruleW = o.rule === false ? 0 : (o.ruleW ?? 44);
      if (ruleW) {
        g.save(); g.setTransform(S, 0, 0, S, 0, 0); g.strokeStyle = rgba(col(o.ruleColor || 'amber'), (o.alpha ?? 0.9) * (1 - outU)); g.lineWidth = 3; g.lineCap = 'round';
        g.beginPath(); g.moveTo(x, y - size * 0.36); g.lineTo(x + ruleW * EZ.o3(clamp(inU * 1.6)), y - size * 0.36); g.stroke(); g.restore();
      }
      const tx = x + (ruleW ? ruleW + 18 : 0);
      return C.text(id, str, {
        x: tx, y, size, font: FONT.mono, weight: 600, tracking: o.tracking ?? 6, color: rgba(col0, o.alpha ?? 0.9),
        draw: (G, x0, yy, css, tp, shown) => {
          G.save();
          const m = env.measure(str, { family: FONT.mono, size, weight: 600, tracking: o.tracking ?? 6 });
          if (outU > 0) { G.beginPath(); G.rect(x0 + (m.w + 60) * outU - 30, yy - size * 1.2, m.w + 80, size * 2); G.clip(); }
          revealClip(G, x0, yy - size, m.w, size * 1.4, inU, id);
          if (tp) { G.translate(x0, yy); G.fill(tp.path); } else env.fillText(G, shown, x0, yy, { family: FONT.mono, size, weight: 600, tracking: o.tracking ?? 6 });
          G.restore();
        },
      });
    }
    /** Painted lettering: cream with a brush texture, an ink shadow; revealed by a brush from the left over o.dur. */
    function painted(G, x0, yy, tp, shown, f, o, u, id) {
      const m = env.measure(shown, f);
      G.save();
      revealClip(G, x0, yy - m.asc - 8, m.w, m.asc + m.desc + 16, u, id);
      if (tp) {
        G.save(); G.translate(x0 + (o.shadow ?? 3), yy + (o.shadow ?? 3) * 1.3); G.fillStyle = rgba(PAL.ink, 0.6 * (o.alpha ?? 1)); G.fill(tp.path); G.restore();
        G.translate(x0, yy); G.fillStyle = rgba(col(o.color || 'cream'), o.alpha ?? 1); G.fill(tp.path);
        G.save(); G.clip(tp.path); G.globalCompositeOperation = 'multiply'; G.globalAlpha *= 0.55; G.drawImage(letterTexture(), -20, -m.asc - 10, m.w + 40, m.asc + m.desc + 20); G.restore();
      } else env.fillText(G, shown, x0, yy, f);
      G.restore();
    }
    /** A painted serif title, brushed on from the left: o { size 96, font serif|italic, color, at, dur, tracking, alpha } */
    function title(id, str, x, y, o = {}) {
      const T = C.TT, u = EZ.o2(unit(T, o.at, o.dur ?? 0.8));
      if (u <= 0) return null;
      const italic = o.font === 'italic', size = o.size || 96, f = { family: italic ? FONT.italic : FONT.serif, size, weight: italic ? 480 : 620, style: italic ? 'italic' : 'normal', tracking: o.tracking ?? 0 };
      return C.text(id, str, { x, y, size, font: f.family, weight: f.weight, style: f.style, tracking: f.tracking, align: o.align, color: rgba(col(o.color || 'cream')), draw: (G, x0, yy, css, tp, shown) => painted(G, x0, yy, tp, shown, f, o, u, id) });
    }
    /**
     * Words that land on their cues and then breathe: words [{ str, at, color?, font?: 'italic' }], set left to right
     * from (x, y). Each rises a little, its tracking closes in, a heavy spring settles it. o { size, gap, rise, under: { word
     * index, at, color } (a painted underline) }. Returns the line's width.
     */
    function line(id, words, x, y, o = {}) {
      const T = C.TT, size = o.size || 110, gap = o.gap ?? size * 0.26;
      let cx = x;
      words.forEach((wd, i) => {
        const italic = wd.font === 'italic', f = { family: italic ? FONT.italic : FONT.serif, size: wd.size || size, weight: italic ? 480 : 620, style: italic ? 'italic' : 'normal' };
        const m = env.measure(wd.str, f), at = wd.at ?? 0, dt = T - at;
        if (dt >= 0) {
          const sp = C.spring(dt, 'heavy'), u = EZ.o3(clamp(dt / 0.45)), rise = (o.rise ?? size * 0.32) * (1 - sp), track = (o.track ?? 10) * (1 - u);
          C.text(`${id}:${i}`, wd.str, {
            x: cx, y: y + rise, size: f.size, font: f.family, weight: f.weight, style: f.style, tracking: track,
            draw: (G, x0, yy, css, tp, shown) => painted(G, x0, yy, tp, shown, { ...f, tracking: track }, { color: wd.color, alpha: clamp(dt / 0.25) }, EZ.o2(clamp(dt / 0.4)), `${id}${i}`),
          });
          if (o.under && o.under.word === i) {
            const ut = T - (o.under.at ?? at + 0.35), uu = EZ.io(clamp(ut / 0.45));
            if (uu > 0) {
              g.save(); g.setTransform(S, 0, 0, S, 0, 0); g.lineCap = 'round';
              const R = RNG('under', id), y0 = y + size * 0.18, x1 = cx + m.w * uu;
              for (let k = 0; k < 7; k++) { g.strokeStyle = rgba(col(o.under.color || 'oxblood'), R.r(0.55, 0.95)); g.lineWidth = R.r(3.5, 8); g.beginPath(); g.moveTo(cx - 4, y0 + R.n(3) + k * 1.4); g.quadraticCurveTo((cx + x1) / 2, y0 + 6 + R.n(3), x1, y0 - 2 + R.n(3) + k); g.stroke(); }
              g.restore();
            }
          }
        }
        cx += m.w + gap;
      });
      return cx - gap - x;
    }

    // ───────────────────────── the finish ─────────────────────────
    let VIG = null;
    const GRAIN = [];
    function vignette(strength) {
      const id = Math.round(strength * 100);
      if (VIG && VIG.id === id) return VIG.c;
      const c = canvas(W, H), p = c.getContext('2d');
      const q = p.createRadialGradient(CX, CY * 0.92, H * 0.28, CX, CY, H * 1.02);
      q.addColorStop(0, 'rgba(8,10,10,0)'); q.addColorStop(0.55, `rgba(8,10,10,${0.18 * strength})`); q.addColorStop(1, `rgba(6,8,8,${0.82 * strength})`);
      p.fillStyle = q; p.fillRect(0, 0, W, H);
      // the gate: a soft dark rounded frame, like old film
      p.save();
      for (let i = 0; i < 18; i++) {
        const inset = 4 + i * 3.2, a = 0.07 * strength * (1 - i / 18);
        p.strokeStyle = `rgba(4,6,6,${a})`; p.lineWidth = 7; p.beginPath();
        const r = 70 - i * 1.5; p.moveTo(inset + r, inset); p.arcTo(W - inset, inset, W - inset, H - inset, r); p.arcTo(W - inset, H - inset, inset, H - inset, r); p.arcTo(inset, H - inset, inset, inset, r); p.arcTo(inset, inset, W - inset, inset, r); p.closePath(); p.stroke();
      }
      p.restore();
      VIG = { id, c };
      return c;
    }
    function grainTile(v) {
      if (GRAIN[v]) return GRAIN[v];
      const w = 1024, h = 576, c = canvas(w, h), p = c.getContext('2d'), d = p.createImageData(w, h), R = RNG('grain', v);
      for (let i = 0; i < d.data.length; i += 4) { const n = 128 + (R.f() + R.f() + R.f() - 1.5) * 70; d.data[i] = d.data[i + 1] = d.data[i + 2] = n; d.data[i + 3] = 255; }
      p.putImageData(d, 0, 0);
      GRAIN[v] = c;
      return c;
    }
    /**
     * Last in every frame, screen space: o { grain .13, vignette 1, warm 0..1 (a warm wash from the light), light: [x, y]
     * (screen), flicker .012, calm (Duet: true by default when the presenter's bubble is on) }
     */
    function finish(o = {}) {
      g.save(); g.setTransform(S, 0, 0, S, 0, 0); g.globalAlpha = 1;
      if (o.warm) {
        const [lx, ly] = o.light || [W * 0.75, H * 0.35], q = g.createRadialGradient(lx, ly, 0, lx, ly, W * 0.9);
        q.addColorStop(0, rgba(PAL.amber, 0.22 * o.warm)); q.addColorStop(0.6, rgba(PAL.amber, 0.04 * o.warm)); q.addColorStop(1, rgba(PAL.deep, 0.18 * o.warm));
        g.globalCompositeOperation = 'soft-light'; g.fillStyle = q; g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'source-over';
      }
      const calm = o.calm ?? !!(C && C.bubble);
      if (calm) {
        const k = C && C.bubble ? C.bubble.keepOut : { x: 0, y: 700, w: 380, h: 380 }, cx = k.x + k.w * 0.45, cy = k.y + k.h * 0.6;
        const q = g.createRadialGradient(cx, cy, 0, cx, cy, k.w * 1.25);
        q.addColorStop(0, rgba(PAL.night, 0.5)); q.addColorStop(0.6, rgba(PAL.night, 0.32)); q.addColorStop(1, rgba(PAL.night, 0));
        g.fillStyle = q; g.fillRect(0, H - k.h * 1.6, k.w * 2.2, k.h * 1.6);
      }
      g.drawImage(vignette(o.vignette ?? 1), 0, 0);
      const B = C ? C.B : 0, R = RNG('gate', B);
      if ((o.grain ?? 0.13) > 0) {
        const tile = grainTile(B % 3), ox = R.r(0, 120), oy = R.r(0, 60);
        g.globalCompositeOperation = 'overlay'; g.globalAlpha = o.grain ?? 0.13; g.imageSmoothingEnabled = true;
        g.drawImage(tile, -ox, -oy, 2048, 1152);
        g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
      }
      const fl = (o.flicker ?? 0.012) * R.n(1);
      if (fl > 0) { g.fillStyle = `rgba(255,240,215,${fl.toFixed(4)})`; g.fillRect(0, 0, W, H); } else if (fl < 0) { g.fillStyle = `rgba(0,0,0,${(-fl).toFixed(4)})`; g.fillRect(0, 0, W, H); }
      g.restore();
    }
    /** Where type may go: the safe area, starting right of the presenter's corner in a Duet. */
    function safe() { const b = C && C.bubble; return { x: b ? b.keepOut.x + b.keepOut.w + 40 : 96, y: 96, w: b ? W - (b.keepOut.x + b.keepOut.w + 40) - 96 : W - 192, h: H - 192, bottom: b ? H - 120 : H - 110 }; }

    return {
      bind(ctx) { C = ctx; g = ctx.g; S = ctx.scale || 1; CAM = { z: 1, p: [CX, CY], to: [CX, CY] }; },
      DEPTH, FONT, PAL, TIMES,
      world, draw, ground, view, path, breathe, layer, toScreen,
      skyPlate, ridgePlate,
      figure, blinking,
      glow, shaft, star, fire, firelight, flicker, embers, motes, twinkle, flood,
      wipe, wipeShape,
      label, title, line,
      finish, safe, mix, rgba, col, noise1,
    };
  },
});
