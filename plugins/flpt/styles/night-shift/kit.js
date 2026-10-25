// =====================================================================
//  night-shift/kit.js · Night Shift, an FLPT original (Bombadillo AI, 2026, MIT; LICENSE beside this file).
//  The late cut between a talk's parts: a dark stage shot on film. Blue-black ground, bone serif type that sets in
//  kinetically, mono chips that label and time things, sodium and ember light leaks, a red halation round the
//  brightest type, film grain and a hair of gate weave. On ones: grain, weave and dust change every frame, so even
//  a held frame breathes.
//
//  Layers, back to front, in one frame:  K.ground → the world (scene camera, K.para for parallax) → K.finish
//  (leaks, flash, vignette, grain, dust; screen space).
//
//  Ground and film (screen space; call after ctx.screen() or let them reset the transform themselves)
//    K.ground(g, { warm, lamp })              the night (a sodium streetlight's pool and shaft, high right; lamp 0..1);
//                                             warm 0..1 brings dawn up from the bottom
//    K.finish(g, { boost, flash, flashAt, leaks, vignette, grain, dust })   the film pass, last: leaks, flash (from
//                                             flashAt [x, y], the lamp by default), vignette, grain (a 3 % flicker), dust
//    K.leak(g, { x, y, r, a, kind, sx, sy, rot })               one light leak (kind ember | sodium | dawn | cool)
//    K.flash(g, u, { x, y, color, a })        over-exposure, u 0..1: the picture added to itself (highlights clip
//                                             first), a white-hot core spreading from (x, y), warm white at the top
//    K.weave(amount) → [dx, dy]               the gate weave for this frame: add it to the camera's `to`
//    K.letterbox(g, u)                        cinema bars (2.39:1) sliding in, u 0..1
//  Type (world or screen space: whatever g's transform is; every word registers its box for the checks)
//    K.type(g, str, x, y, { face, size, color, align, alpha, chars, halo, tracking, id })   face display|italic|black|mono
//    K.strips(g, str, x, y, { u, out, n, spread, stagger, ... })   the signature set-in: slices slide into register
//                                             (out: seconds since the exit began; they pull apart the way they came)
//    K.cascade(g, str, x, y, { u, stagger, drop, rot, preset, from, ... })   letters fall in one by one (the kinetic word)
//    K.slam(g, str, x, y, { u, from, ... })   lands big, a few frames of trail, then sits; returns its box
//    K.chip(g, label, x, y, { u, color, fill, dot, size, align, id })        a mono label in a pill (x, y: left, middle)
//    K.roll(g, from, to, u, x, y, { face, size, color, stroke, fill, count, align, id })  digits that flip ("22" → "23"),
//                                             any face; count: an odometer; stroke (px) and a faint fill: the ghost numerals
//    K.clock(g, from, to, u, x, y, { pop, size, color, align, id })          "22:00" rolling to "23:00", in a chip
//  Lines and shapes
//    K.rule(g, x0, y0, x1, y1, { frac, w, color, alpha })      K.frame(g, x, y, w, h, { frac, w, color, corner })
//    K.lines(g, x, y, w, h, { frac, key, lh, th, color, alpha })   greeked copy (bars, never words)
//    K.streaks(g, { speed, offset, n, y0, y1, color, alpha, key })  speed lines for anything that runs
//  Camera and layout
//    K.para(cam, depth, ref) → cam            the same camera for a layer at another depth (1 = the focus plane)
//    K.anchor(cam, wx, wy) → [sx, sy]         where a world point lands on screen (pin a full-size chip to it)
//    K.focus(g, px, draw)                     draw(q) out of focus by px (a rack focus); 0 is sharp. Draw into q,
//                                             the context it hands you (a quarter-size layer while blurred); words
//                                             drawn into q register where they land on screen, once
//    K.zone() → { x0, y0, x1, y1, keepOut, left(y) }   where words may sit (Duet: never the presenter's corner)
//    K.FONT, K.FACE, K.C (the palette as rgb triples), K.rgba(name, a)
// =====================================================================
FLPT.style('night-shift', {
  tokens: {
    paper: '#0B0D12', ink: '#ECE3D2', bone: '#ECE3D2', steel: '#8E99AB', dim: '#2A303C',
    sodium: '#F4A340', ember: '#E8562A', dawn: '#F7C98B', cyan: '#3FA9C9', magenta: '#D2457E', yellow: '#E8C547',
    font: '"Night Shift Display", serif',
  },
  fonts: [
    { family: 'Night Shift Display', file: 'fraunces-display-semibold.ttf', weight: 620 },
    { family: 'Night Shift Italic', file: 'fraunces-italic.ttf', weight: 480, style: 'italic' },
    { family: 'Night Shift Black', file: 'fraunces-soft-black.ttf', weight: 900 },
    { family: 'Night Shift Mono', file: 'IBMPlexMono-SemiBold.ttf', weight: 600 },
  ],
  ones: true,
  make(env) {
    'use strict';
    const { W, H, clamp, lerp, spring } = env;
    const RNG = env.rng;
    const tk = env.tokens;
    const TAU = Math.PI * 2;
    let C = null, S = 1, F = 0, T = 0;

    const FONT = { display: '"Night Shift Display"', italic: '"Night Shift Italic"', black: '"Night Shift Black"', mono: '"Night Shift Mono"' };
    const FACE = {
      display: { family: FONT.display, weight: 620, style: 'normal', track: -0.012 },
      italic: { family: FONT.italic, weight: 480, style: 'italic', track: -0.006 },
      black: { family: FONT.black, weight: 900, style: 'normal', track: -0.02 },
      mono: { family: FONT.mono, weight: 600, style: 'normal', track: 0.12 },
    };
    const hex = (h) => [1, 3, 5].map((i) => parseInt(String(h).slice(i, i + 2), 16));
    const PAL = {};
    for (const k of ['paper', 'bone', 'steel', 'dim', 'sodium', 'ember', 'dawn', 'cyan', 'magenta', 'yellow']) PAL[k] = hex(tk[k]);
    const rgba = (name, a) => { const c = PAL[name] || hex(name); return `rgba(${c[0]},${c[1]},${c[2]},${(+a).toFixed(3)})`; };
    const scr = (g) => g.setTransform(S, 0, 0, S, 0, 0);
    const font = (o) => {
      const b = FACE[o.face || 'display'] || FACE.display, size = o.size || 96;
      return { family: b.family, weight: b.weight, style: b.style, size, tracking: o.tracking != null ? o.tracking : b.track * size };
    };
    const alignX = (x, w, align) => (align === 'center' ? x - w / 2 : align === 'right' ? x - w : x);

    // ── the checks see every word: a box in screen space (scene units), through g's transform ──
    // While K.focus draws a layer at quarter size, REG holds that layer's pixels per scene unit (its transform is the
    // main canvas's scaled by k / S), and skip when the sharp pass that follows registers the same words itself.
    let REG = null;
    function reg(g, id, str, x, y, w, h) {
      if (id === false) return null;
      const M = g.getTransform(), div = REG ? REG.div : S;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [px, py] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
        const sx = (M.a * px + M.c * py + M.e) / div, sy = (M.b * px + M.d * py + M.f) / div;
        x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
      }
      const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      if (!(REG && REG.skip)) env.registerBox(id == null ? str : id, str, box);
      return box;
    }

    // ── the night: a lifted centre, cooler above, the faintest warmth low; dawn on demand ──
    const LK = (() => { const R = RNG('ns-leaks'); return { p1: R.r(0, TAU), p2: R.r(0, TAU), p3: R.r(0, TAU) }; })();
    let GROUND = null, DAWN = null, VIG = null, LAMP = null;
    function groundCanvas() {
      if (GROUND) return GROUND;
      const w = 640, h = 360, c = env.canvas(w, h), p = c.getContext('2d');
      p.fillStyle = tk.paper; p.fillRect(0, 0, w, h);
      let gr = p.createRadialGradient(w * 0.52, h * 0.44, 0, w * 0.5, h * 0.5, w * 0.66);
      gr.addColorStop(0, 'rgba(40,49,70,0.62)'); gr.addColorStop(0.5, 'rgba(26,32,46,0.32)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      p.fillStyle = gr; p.fillRect(0, 0, w, h);
      gr = p.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, 'rgba(4,6,10,0.35)'); gr.addColorStop(0.6, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(58,30,20,0.16)');
      p.fillStyle = gr; p.fillRect(0, 0, w, h);
      return (GROUND = c);
    }
    function dawnCanvas() {
      if (DAWN) return DAWN;
      const w = 640, h = 360, c = env.canvas(w, h), p = c.getContext('2d');
      let gr = p.createLinearGradient(0, h, 0, 0);
      gr.addColorStop(0, 'rgba(247,170,90,0.85)'); gr.addColorStop(0.35, 'rgba(214,104,58,0.42)'); gr.addColorStop(0.75, 'rgba(90,60,80,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      p.fillStyle = gr; p.fillRect(0, 0, w, h);
      gr = p.createRadialGradient(w * 0.62, h * 1.05, 0, w * 0.62, h * 1.05, w * 0.55);
      gr.addColorStop(0, 'rgba(255,214,150,0.9)'); gr.addColorStop(0.4, 'rgba(244,163,64,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      p.fillStyle = gr; p.fillRect(0, 0, w, h);
      return (DAWN = c);
    }
    // the lamp: a sodium streetlight outside, high on the right; its pool and a soft shaft falling across the stage
    function lampCanvas() {
      if (LAMP) return LAMP;
      const w = 640, h = 360, c = env.canvas(w, h), p = c.getContext('2d');
      let gr = p.createRadialGradient(w * 0.84, -h * 0.08, 0, w * 0.84, -h * 0.08, w * 0.7);
      gr.addColorStop(0, 'rgba(244,163,64,0.34)'); gr.addColorStop(0.35, 'rgba(200,110,40,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      p.fillStyle = gr; p.fillRect(0, 0, w, h);
      p.save(); p.translate(w * 0.84, -h * 0.08); p.rotate(0.62);
      gr = p.createLinearGradient(-w * 0.16, 0, w * 0.16, 0);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(244,170,80,0.08)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      p.fillStyle = gr; p.beginPath(); p.moveTo(-w * 0.04, 0); p.lineTo(w * 0.04, 0); p.lineTo(w * 0.2, w * 0.95); p.lineTo(-w * 0.2, w * 0.95); p.closePath(); p.fill();
      p.restore();
      return (LAMP = c);
    }
    function ground(g, o = {}) {
      g.save(); scr(g); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.imageSmoothingEnabled = true;
      g.drawImage(groundCanvas(), 0, 0, W, H);
      const lamp = o.lamp == null ? 1 : o.lamp;
      if (lamp > 0) { g.globalCompositeOperation = 'screen'; g.globalAlpha = clamp(lamp * (0.92 + 0.08 * Math.sin(T * 2.3 + LK.p1))); g.drawImage(lampCanvas(), 0, 0, W, H); }
      const warm = clamp(o.warm || 0);
      if (warm > 0) { g.globalCompositeOperation = 'screen'; g.globalAlpha = warm * 0.8; g.drawImage(dawnCanvas(), 0, 0, W, H); }
      g.restore();
    }

    // ── light: leak sprites (soft, hot-cored), drawn with screen ──
    const SPR = {};
    const STOPS = {
      ember: [[0, 'rgba(255,186,110,1)'], [0.18, 'rgba(246,112,52,0.8)'], [0.5, 'rgba(176,46,24,0.3)'], [1, 'rgba(0,0,0,0)']],
      sodium: [[0, 'rgba(255,226,160,1)'], [0.22, 'rgba(244,163,64,0.66)'], [0.6, 'rgba(130,64,14,0.18)'], [1, 'rgba(0,0,0,0)']],
      dawn: [[0, 'rgba(255,236,196,1)'], [0.3, 'rgba(247,180,110,0.55)'], [0.7, 'rgba(160,80,60,0.14)'], [1, 'rgba(0,0,0,0)']],
      cool: [[0, 'rgba(200,222,255,0.95)'], [0.3, 'rgba(96,130,190,0.42)'], [1, 'rgba(0,0,0,0)']],
      burn: [[0, 'rgba(255,255,250,1)'], [0.12, 'rgba(255,240,205,0.95)'], [0.38, 'rgba(255,186,100,0.5)'], [0.7, 'rgba(200,90,40,0.14)'], [1, 'rgba(0,0,0,0)']],
    };
    function sprite(kind) {
      if (SPR[kind]) return SPR[kind];
      const n = 256, c = env.canvas(n, n), p = c.getContext('2d'), gr = p.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
      for (const [at, col] of STOPS[kind] || STOPS.ember) gr.addColorStop(at, col);
      p.fillStyle = gr; p.fillRect(0, 0, n, n);
      return (SPR[kind] = c);
    }
    function leak(g, o = {}) {
      const a = clamp(o.a == null ? 0.5 : o.a);
      if (a <= 0.002) return;
      g.save(); scr(g); g.globalCompositeOperation = 'screen'; g.globalAlpha = a;
      g.translate(o.x || 0, o.y || 0); if (o.rot) g.rotate(o.rot); g.scale(o.sx || 1, o.sy || 1);
      const r = o.r || 420;
      g.drawImage(sprite(o.kind || 'ember'), -r, -r, 2 * r, 2 * r);
      g.restore();
    }
    // the ambient leaks: one breathing down the right edge, one along the top; boost flares both (a cut, a hit)
    function leaks(g, o = {}) {
      const boost = clamp(o.boost || 0, 0, 2), j = RNG('ns-flicker', F), flick = 0.9 + 0.1 * Math.sin(T * 9.1 + LK.p3) + j.n(0.05);
      const base = o.leaks == null ? 1 : o.leaks;
      if (base <= 0 && boost <= 0) return;
      const y1 = H * (0.42 + 0.22 * Math.sin(T * 0.37 + LK.p1));
      leak(g, { x: W + 60 - 40 * boost, y: y1, r: 560 + 160 * boost, sx: 0.55, sy: 1.35, a: (0.27 * base + 0.42 * boost) * flick, kind: 'ember' });
      const x2 = W * (0.62 + 0.18 * Math.sin(T * 0.29 + LK.p2));
      leak(g, { x: x2, y: -150 + 30 * boost, r: 520 + 120 * boost, sx: 1.5, sy: 0.6, a: (0.14 * base + 0.3 * boost) * flick, kind: 'sodium' });
      if (boost > 0) leak(g, { x: W * 0.78, y: H * 0.3, r: 260 + 260 * boost, a: 0.32 * boost, kind: 'sodium' });
    }
    /**
     * Over-exposure, u 0..1, additive like light on film: the picture added to itself (its highlights clip first, the
     * shadows lift last), a white-hot core spreading from the light at (o.x, o.y) (the lamp, high right, by default),
     * and only near the top of u the whole frame going to warm white.
     */
    function flash(g, u, o = {}) {
      u = clamp(u);
      if (u <= 0.002) return;
      const gain = o.a == null ? 1 : o.a, cv = g.canvas;
      g.save(); g.globalCompositeOperation = 'lighter';
      if (cv) {
        g.setTransform(1, 0, 0, 1, 0, 0);
        for (let k = u * 2.2 * gain; k > 0.02; k -= 1) { g.globalAlpha = Math.min(1, k); g.drawImage(cv, 0, 0); }
      }
      scr(g);
      const x = o.x == null ? W * 0.84 : o.x, y = o.y == null ? -H * 0.08 : o.y, r = lerp(H * 0.4, W * 1.5, Math.sqrt(u));
      g.globalAlpha = clamp(u * 1.15 * gain); g.drawImage(sprite('burn'), x - r, y - r, 2 * r, 2 * r);
      const peak = clamp((u - 0.55) / 0.45);
      if (peak > 0) { g.globalAlpha = peak * peak * 0.8 * gain; g.fillStyle = o.color || '#FFE6BE'; g.fillRect(0, 0, W, H); }
      g.restore();
    }
    function vignette(g, amount = 1) {
      if (!VIG) {
        const w = 640, h = 360; VIG = env.canvas(w, h);
        const p = VIG.getContext('2d'), gr = p.createRadialGradient(w / 2, h * 0.48, h * 0.32, w / 2, h / 2, w * 0.62);
        gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.7, 'rgba(2,3,6,0.32)'); gr.addColorStop(1, 'rgba(2,3,6,0.7)');
        p.fillStyle = gr; p.fillRect(0, 0, w, h);
      }
      g.save(); scr(g); g.globalCompositeOperation = 'source-over'; g.globalAlpha = clamp(amount); g.drawImage(VIG, 0, 0, W, H); g.restore();
    }

    // ── grain: five tiles of signed noise (light and dark specks), half resolution, a fresh offset every frame ──
    const GW = 800, GH = 470, GK = 2.5, GRAIN = [];
    function grainTile(i) {
      if (GRAIN[i]) return GRAIN[i];
      const c = env.canvas(GW, GH), p = c.getContext('2d'), d = p.createImageData(GW, GH), a = d.data, R = RNG('ns-grain', i);
      for (let k = 0; k < a.length; k += 4) {
        const n = (R.f() + R.f() + R.f() - 1.5) / 1.5;
        const v = n > 0 ? 255 : 0;
        a[k] = v; a[k + 1] = v; a[k + 2] = v; a[k + 3] = Math.min(255, Math.abs(n) * 340);
      }
      p.putImageData(d, 0, 0);
      return (GRAIN[i] = c);
    }
    function grain(g, amount = 1) {
      if (amount <= 0) return;
      const R = RNG('ns-grain-at', F), tile = grainTile(F % 5), ox = R.i(0, 30), oy = R.i(0, 30);
      g.save(); scr(g); g.globalCompositeOperation = 'source-over'; g.globalAlpha = clamp(0.1 * amount); g.imageSmoothingEnabled = true;
      g.drawImage(tile, -ox * GK, -oy * GK, GW * GK, GH * GK);
      // exposure flicker: each frame a hair brighter or darker, as a projector's shutter would make it
      const e = R.n(1);
      g.globalAlpha = Math.abs(e) * 0.03 * amount; g.globalCompositeOperation = e > 0 ? 'screen' : 'source-over'; g.fillStyle = e > 0 ? tk.bone : '#000000'; g.fillRect(0, 0, W, H);
      g.restore();
    }
    function dust(g, amount = 1) {
      if (amount <= 0) return;
      const R = RNG('ns-dust', F), n = R.i(0, 3), keep = C && C.bubble ? C.bubble.keepOut : null;
      g.save(); scr(g);
      for (let i = 0; i < n; i++) {
        const x = R.r(0, W), y = R.r(0, H), r = R.r(0.9, 2.8), light = R.f() < 0.6;
        if (keep && x < keep.x + keep.w && y > keep.y) continue;
        g.fillStyle = light ? rgba('bone', 0.5 * amount) : 'rgba(0,0,0,0.65)';
        g.beginPath(); g.ellipse(x, y, r, r * R.r(0.5, 1), R.r(0, TAU), 0, TAU); g.fill();
      }
      if (R.f() < 0.06) {   // a hair in the gate, for a frame
        const x = R.r(260, W - 200), y = R.r(140, H - 140), L = R.r(50, 130), a = R.r(0, TAU), q = [];
        for (let k = 1; k <= 3; k++) q.push(x + Math.cos(a) * L * k / 3 + R.n(18), y + Math.sin(a) * L * k / 3 + R.n(18));
        if (!(keep && x < keep.x + keep.w + 140 && y > keep.y - 140)) {
          g.strokeStyle = rgba('bone', 0.28 * amount); g.lineWidth = 1.3; g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(q[0], q[1], q[2], q[3], q[4], q[5]); g.stroke();
        }
      }
      g.restore();
    }
    const WV = (() => { const R = RNG('ns-weave'); return [R.r(0, TAU), R.r(0, TAU), R.r(0, TAU)]; })();
    function weave(amount = 1) {
      const j = RNG('ns-weave-at', F);
      return [(0.7 * Math.sin(T * 1.7 + WV[0]) + 0.3 * Math.sin(T * 4.3 + WV[1])) * amount + j.n(0.22 * amount),
        (0.55 * Math.sin(T * 1.3 + WV[2]) + 0.25 * Math.sin(T * 5.1 + WV[0])) * amount + j.n(0.22 * amount)];
    }
    function letterbox(g, u) {
      u = clamp(u);
      if (u <= 0) return;
      const h = 138 * u;
      g.save(); scr(g); g.globalCompositeOperation = 'source-over'; g.fillStyle = '#040508';
      g.fillRect(0, 0, W, h); g.fillRect(0, H - h, W, h);
      g.restore();
    }
    /** The film pass, last in a frame: leaks, the flash, the vignette, grain, dust (screen space). */
    function finish(g, o = {}) {
      leaks(g, { boost: o.boost || 0, leaks: o.leaks });
      flash(g, o.flash || 0, o.flashAt ? { x: o.flashAt[0], y: o.flashAt[1] } : {});
      vignette(g, o.vignette == null ? 1 : o.vignette);
      grain(g, o.grain == null ? 1 : o.grain);
      dust(g, o.dust == null ? 1 : o.dust);
    }

    // ── type ──
    function halo(g, path, x, y, px, color, a) {
      g.save(); g.globalCompositeOperation = 'screen'; g.filter = `blur(${px.toFixed(1)}px)`; g.globalAlpha *= a;
      g.fillStyle = color; g.translate(x, y); g.fill(path); g.restore();
    }
    const haloOf = (o, f) => (o.halo === false ? 0 : o.halo != null ? o.halo : f.size >= 110 && o.face !== 'mono' ? Math.min(14, f.size * 0.06) : 0);
    /** Type, crisp, from the glyph outlines; a red halation round big bright words (o.halo px, false for none). */
    function type(g, str, x, y, o = {}) {
      str = String(str);
      const f = font(o), m = env.measure(str, f), x0 = alignX(x, m.w, o.align);
      const n = o.chars != null ? Math.max(0, Math.min([...str].length, Math.floor(o.chars))) : [...str].length;
      const shown = [...str].slice(0, n).join('');
      if ((o.alpha == null ? 1 : o.alpha) <= 0.003) return null;
      g.save(); g.globalAlpha *= o.alpha == null ? 1 : o.alpha;
      const hp = haloOf(o, f);
      if (shown && hp > 0) { const tp = env.textPath(shown, f); if (tp) halo(g, tp.path, x0, y, hp, o.haloColor || tk.ember, o.haloA == null ? 0.42 : o.haloA); }
      g.fillStyle = o.color || tk.bone;
      if (shown) env.fillText(g, shown, x0, y, f);
      g.restore();
      return reg(g, o.id, str, x0, y - m.asc, m.w, m.asc + m.desc);
    }
    /** The set-in: the line cut into n slices that slide in from alternate sides and click into register. */
    function strips(g, str, x, y, o = {}) {
      const u = o.u == null ? 1e9 : o.u;
      if (u < 0) return null;
      str = String(str);
      const f = font(o), tp = env.textPath(str, f);
      if (!tp) return type(g, str, x, y, o);
      const x0 = alignX(x, tp.w, o.align), n = o.n || 7, st = o.stagger == null ? 0.03 : o.stagger, spread = o.spread == null ? 260 : o.spread;
      const yTop = y - tp.asc - 6, h = tp.asc + tp.desc + 12, preset = o.preset || 'snappy';
      const off = [], out = o.out == null ? -1 : o.out;
      let settled = true;
      for (let i = 0; i < n; i++) {
        const dt = u - i * st, s = spring(dt, preset), side = i % 2 ? 1 : -1;
        if (out > 0) {   // the exit: the slices pull apart the way they came, faster and faster
          const e = clamp((out - (n - 1 - i) * st * 0.6) / 0.32);
          off.push({ dx: side * spread * 1.6 * e * e * (1 + 0.12 * i), a: 1 - e * e });
          settled = false;
          continue;
        }
        off.push({ dx: side * spread * (1 - s) * (1 + 0.12 * i), a: clamp(dt / 0.07) });
        if (dt < 0.07 || Math.abs(1 - s) > 0.0015) settled = false;
      }
      if (out > 0 && off.every((x) => x.a <= 0)) return null;
      g.save(); g.globalAlpha *= o.alpha == null ? 1 : o.alpha;
      const hp = haloOf(o, f);
      if (hp > 0) halo(g, tp.path, x0, y, hp, o.haloColor || tk.ember, (o.haloA == null ? 0.42 : o.haloA) * clamp(u / 0.4));
      g.fillStyle = o.color || tk.bone;
      if (settled) { g.translate(x0, y); g.fill(tp.path); } else {
        for (let i = 0; i < n; i++) {
          if (off[i].a <= 0) continue;
          g.save(); g.beginPath(); g.rect(x0 - spread * 3, yTop + (i * h) / n, tp.w + spread * 6, h / n + 0.75); g.clip();
          g.globalAlpha *= off[i].a; g.translate(x0 + off[i].dx, y); g.fill(tp.path); g.restore();
        }
      }
      g.restore();
      return reg(g, o.id, str, x0, y - tp.asc, tp.w, tp.asc + tp.desc);
    }
    /** Letters fall into place one after another (the italic is the kinetic face). */
    function cascade(g, str, x, y, o = {}) {
      const u = o.u == null ? 1e9 : o.u;
      if (u < 0) return null;
      str = String(str);
      const f = font({ face: 'italic', ...o }), chars = [...str], full = env.measure(str, f), x0 = alignX(x, full.w, o.align);
      const R = RNG('ns-cascade', o.key || str), st = o.stagger == null ? 0.055 : o.stagger, drop = o.drop == null ? f.size * 0.6 : o.drop;
      const dir = o.from === 'above' ? -1 : 1, preset = o.preset || 'smooth';
      g.save(); g.globalAlpha *= o.alpha == null ? 1 : o.alpha; g.fillStyle = o.color || tk.sodium;
      for (let i = 0; i < chars.length; i++) {
        const sign = R.f() < 0.5 ? -1 : 1, wob = R.r(0.6, 1.2);
        if (chars[i] === ' ') continue;
        const dt = u - i * st;
        if (dt <= 0) continue;
        const s = spring(dt, preset), tp = env.textPath(chars[i], f);
        if (!tp) continue;
        const px = env.measure(chars.slice(0, i + 1).join(''), f).w - tp.w, cx = x0 + px + tp.w / 2;
        g.save(); g.translate(cx, y + (1 - s) * drop * dir * wob); g.rotate((1 - s) * (o.rot == null ? 0.28 : o.rot) * sign);
        g.globalAlpha *= clamp(dt / 0.1); g.translate(-tp.w / 2, 0); g.fill(tp.path); g.restore();
      }
      g.restore();
      return reg(g, o.id, str, x0, y - full.asc, full.w, full.asc + full.desc);
    }
    /** A word that lands: in from o.from× scale on a snappy spring, three frames of trail, then it sits. */
    function slam(g, str, x, y, o = {}) {
      const u = o.u == null ? 1e9 : o.u;
      if (u < 0) return null;
      str = String(str);
      const f = font({ face: 'black', ...o }), tp = env.textPath(str, f);
      if (!tp) return type(g, str, x, y, { face: 'black', ...o });
      const x0 = alignX(x, tp.w, o.align), cx = x0 + tp.w / 2, cy = y - (tp.asc - tp.desc) / 2, from = o.from == null ? 1.5 : o.from;
      const k = lerp(from, 1, spring(u, o.preset || 'snappy'));
      const color = o.color || tk.bone;
      g.save(); g.globalAlpha *= (o.alpha == null ? 1 : o.alpha) * clamp(u / 0.04);
      const at = (kk) => { g.translate(cx, cy); g.scale(kk, kk); g.translate(-cx, -cy); g.translate(x0, y); };
      if (o.trail !== false && u < 0.22) {
        for (let j = 3; j >= 1; j--) {
          const kk = lerp(from, 1, spring(u - j * 0.03, o.preset || 'snappy'));
          g.save(); g.globalAlpha *= 0.14 * (1 - u / 0.22); at(kk); g.fillStyle = color; g.fill(tp.path); g.restore();
        }
      }
      const hp = haloOf({ face: 'black', ...o }, f);
      if (hp > 0) { g.save(); at(k); g.translate(-x0, -y); halo(g, tp.path, x0, y, hp, o.haloColor || tk.ember, o.haloA == null ? 0.42 : o.haloA); g.restore(); }
      g.save(); at(k); g.fillStyle = color; g.fill(tp.path); g.restore();
      g.restore();
      const w = tp.w * k, hh = (tp.asc + tp.desc) * k;
      return reg(g, o.id, str, cx - w / 2, cy - hh / 2, w, hh);
    }
    function pill(g, x, y, w, h) {
      const r = h / 2;
      g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2); g.lineTo(x + r, y + h); g.arc(x + r, y + r, r, Math.PI / 2, Math.PI * 1.5); g.closePath();
    }
    /** A mono label in a pill: it pops (a snappy spring), then its letters type on. x, y: its left edge and middle. */
    function chip(g, label, x, y, o = {}) {
      const u = o.u == null ? 1e9 : o.u;
      if (u < 0) return null;
      const size = o.size || 26, f = font({ face: 'mono', size, tracking: o.tracking }), str = String(label).toUpperCase(), m = env.measure(str, f);
      const padX = size * 0.8, dotR = o.dot === false ? 0 : size * 0.2, gap = dotR ? size * 0.55 : 0;
      const w = padX * 2 + dotR * 2 + gap + m.w, h = size * 1.75, x0 = alignX(x, w, o.align), y0 = y - h / 2;
      const s = spring(u, 'snappy'), sc = lerp(0.72, 1, s), a = clamp(u / 0.06) * (o.alpha == null ? 1 : o.alpha), col = o.color || tk.sodium;
      if (a <= 0.003) return null;
      g.save(); g.globalAlpha *= a;
      g.translate(x0 + w / 2, y); g.scale(sc, sc); g.translate(-(x0 + w / 2), -y);
      pill(g, x0, y0, w, h);
      if (o.fill) { g.fillStyle = col; g.fill(); } else { g.fillStyle = rgba('paper', 0.6); g.fill(); g.strokeStyle = col; g.lineWidth = Math.max(1.5, size * 0.075); g.stroke(); }
      if (dotR) { g.fillStyle = o.fill ? tk.paper : col; g.beginPath(); g.arc(x0 + padX + dotR, y, dotR, 0, TAU); g.fill(); }
      const n = o.chars != null ? o.chars : Math.round([...str].length * clamp((u - 0.03) / 0.24));
      g.fillStyle = o.fill ? tk.paper : (o.text || tk.bone);
      const shown = [...str].slice(0, n).join('');
      if (shown) env.fillText(g, shown, x0 + padX + dotR * 2 + gap, y + m.asc / 2 - m.desc / 2, f);
      g.restore();
      return reg(g, o.id, str, x0, y0, w, h);
    }
    /**
     * Digits that roll: "22" to "23", "23:00" to "00:00" (same length). Each changed digit flips up once, right to left
     * (o.count: through every digit between, an odometer); u 0..1. Any face: o.stroke (px) draws outlines (the ghost numerals behind a scene).
     * x, y: the left (or o.align) baseline. Returns { w, asc } of the line; registers its box unless id is false.
     */
    function roll(g, from, to, u, x, y, o = {}) {
      const f = font({ face: 'mono', ...o, tracking: 0 }), a0 = [...String(from)], a1 = [...String(to)];
      const zero = env.measure('0', f), cell = Math.max(zero.w, env.measure('8', f).w) * (o.cell || 1), lh = f.size * 1.18;
      const wOf = (ch) => (/\d/.test(ch) ? cell : env.measure(ch, f).w);
      let tw = 0;
      for (const ch of a1) tw += wOf(ch);
      const x0 = alignX(x, tw, o.align), digits = a1.filter((ch) => /\d/.test(ch)).length;
      const ink = (str, px, py) => {
        if (!o.stroke) return env.fillText(g, str, px, py, f);
        const tp = env.textPath(str, f);
        if (tp) { g.save(); g.translate(px, py); if (o.fill) { g.fillStyle = o.fill; g.fill(tp.path); } g.stroke(tp.path); g.restore(); }
        return tp;
      };
      g.save(); g.globalAlpha *= o.alpha == null ? 1 : o.alpha;
      g.fillStyle = o.color || tk.bone; g.strokeStyle = o.color || tk.bone; g.lineWidth = o.stroke || 1; g.lineJoin = 'round';
      let cx = x0, k = 0;
      for (let i = 0; i < a1.length; i++) {
        if (!/\d/.test(a1[i])) { ink(a1[i], cx, y); cx += wOf(a1[i]); continue; }
        const d0 = Number(a0[i]) || 0, d1 = Number(a1[i]);
        const lag = (digits - 1 - k) * 0.12, e = clamp(clamp(u) * (1 + lag * 2) - lag * 2);
        // a clock's digit flips once, old up and out, new up and in (o.count: an odometer, through every digit between)
        const span = d0 === d1 ? 0 : o.count ? (d1 - d0 + 10) % 10 : 1;
        const v = span * (1 - (1 - e) * (1 - e) * (1 - e)), lo = Math.floor(v + 1e-6), fr = v - lo;
        const at = (n) => (o.count ? (d0 + n) % 10 : n <= 0 ? d0 : d1);
        const dx = (dd) => cx + (cell - env.measure(String(dd), f).w) / 2;
        g.save(); g.beginPath(); g.rect(cx - 4, y - zero.asc - (lh - zero.asc) / 2, cell + 8, lh); g.clip();
        ink(String(at(lo)), dx(at(lo)), y - fr * lh);
        if (fr > 0.002) ink(String(at(lo + 1)), dx(at(lo + 1)), y - fr * lh + lh);
        g.restore();
        cx += cell; k++;
      }
      g.restore();
      reg(g, o.id, String(clamp(u) >= 1 ? to : from), x0, y - zero.asc, tw, zero.asc + zero.desc);
      return { x: x0, w: tw, asc: zero.asc };
    }
    /** "22:00" rolling to "23:00" in a chip: the chip pops (o.pop, seconds), the digits roll (u 0..1). x, y: left, middle. */
    function clock(g, from, to, u, x, y, o = {}) {
      const size = o.size || 30, f = font({ face: 'mono', size, tracking: 0 });
      const cell = Math.max(env.measure('0', f).w, env.measure('8', f).w), padX = size * 0.8, dotR = size * 0.2, gap = size * 0.5;
      let tw = 0;
      for (const ch of String(to)) tw += /\d/.test(ch) ? cell : env.measure(ch, f).w;
      const w = padX * 2 + dotR * 2 + gap + tw, h = size * 1.75, x0 = alignX(x, w, o.align), y0 = y - h / 2, col = o.color || tk.sodium;
      const pop = o.pop == null ? 1e9 : o.pop;
      if (pop < 0) return null;
      const s = spring(pop, 'snappy'), sc = lerp(0.72, 1, s);
      g.save(); g.globalAlpha *= clamp(pop / 0.06) * (o.alpha == null ? 1 : o.alpha);
      g.translate(x0 + w / 2, y); g.scale(sc, sc); g.translate(-(x0 + w / 2), -y);
      pill(g, x0, y0, w, h); g.fillStyle = rgba('paper', 0.6); g.fill(); g.strokeStyle = col; g.lineWidth = Math.max(1.5, size * 0.075); g.stroke();
      g.fillStyle = col; g.beginPath(); g.arc(x0 + padX + dotR, y, dotR, 0, TAU); g.fill();
      roll(g, from, to, u, x0 + padX + dotR * 2 + gap, y + env.measure('0', f).asc / 2, { face: 'mono', size, color: o.text || tk.bone, id: false });
      g.restore();
      return reg(g, o.id, String(clamp(u) >= 1 ? to : from), x0, y0, w, h);
    }
    /** Where a world point lands on screen under a camera { z, p, to } (pin a screen-size label to a world thing). */
    function anchor(c, wx, wy) {
      const z = c.z == null ? 1 : c.z, p = c.p || [W / 2, H / 2], to = c.to || [W / 2, H / 2];
      return [to[0] + (wx - p[0]) * z, to[1] + (wy - p[1]) * z];
    }

    // ── lines and shapes ──
    function rule(g, x0, y0, x1, y1, o = {}) {
      const fr = clamp(o.frac == null ? 1 : o.frac);
      if (fr <= 0) return;
      g.save(); g.globalAlpha *= o.alpha == null ? 1 : o.alpha; g.strokeStyle = o.color || tk.bone; g.lineWidth = o.w || 2; g.lineCap = 'butt';
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(lerp(x0, x1, fr), lerp(y0, y1, fr)); g.stroke(); g.restore();
    }
    function frame(g, x, y, w, h, o = {}) {
      const fr = clamp(o.frac == null ? 1 : o.frac);
      if (fr <= 0) return;
      g.save(); g.globalAlpha *= o.alpha == null ? 1 : o.alpha; g.strokeStyle = o.color || tk.bone; g.lineWidth = o.w || 2;
      if (o.corner) {
        const c = o.corner * fr;
        g.beginPath();
        for (const [px, py, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x + w, y + h, -1, -1], [x, y + h, 1, -1]]) { g.moveTo(px + sx * c, py); g.lineTo(px, py); g.lineTo(px, py + sy * c); }
        g.stroke();
      } else {
        const P = [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]], L = 2 * (w + h);
        let left = L * fr;
        g.beginPath(); g.moveTo(x, y);
        for (let i = 1; i < P.length && left > 0; i++) {
          const d = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]), k = Math.min(1, left / d);
          g.lineTo(lerp(P[i - 1][0], P[i][0], k), lerp(P[i - 1][1], P[i][1], k)); left -= d;
        }
        g.stroke();
      }
      g.restore();
    }
    /** Greeked copy: rows of rounded bars (paragraph ends short), revealed row by row with o.frac. */
    function lines(g, x, y, w, h, o = {}) {
      const R = RNG('ns-lines', o.key || 'copy'), lh = o.lh || 24, th = o.th || 7, rows = Math.max(1, Math.floor(h / lh)), shown = rows * clamp(o.frac == null ? 1 : o.frac);
      g.save(); g.globalAlpha *= o.alpha == null ? 0.55 : o.alpha; g.fillStyle = o.color || tk.steel;
      for (let i = 0; i < rows; i++) {
        const end = R.f() < 0.14, ww = end ? w * R.r(0.22, 0.6) : w * R.r(0.84, 1), vis = clamp(shown - i);
        if (vis <= 0) continue;
        const bw = ww * vis, yy = y + i * lh;
        g.beginPath(); g.moveTo(x + th / 2, yy); g.lineTo(x + Math.max(th / 2, bw - th / 2), yy); g.lineWidth = th; g.lineCap = 'round'; g.strokeStyle = g.fillStyle; g.stroke();
      }
      g.restore();
    }
    /** Speed lines: seeded rows that run left at `speed` px/s (their length grows with it); offset is how far they've run. */
    function streaks(g, o = {}) {
      const R = RNG('ns-streaks', o.key || 'run'), n = o.n || 40, y0 = o.y0 == null ? 0 : o.y0, y1 = o.y1 == null ? H : o.y1, speed = o.speed || 0, off = o.offset || 0;
      g.save(); g.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const y = R.r(y0, y1), depth = R.r(0.4, 1), base = R.r(30, 160), th = R.r(1, 3.2) * depth, L = base + speed * 0.09 * depth, span = W + L + 400;
        const x = ((((R.r(0, span) - off * depth) % span) + span) % span) - L - 200, a = (o.alpha == null ? 0.5 : o.alpha) * depth;
        g.strokeStyle = o.color ? o.color : rgba(i % 7 === 0 ? 'sodium' : 'steel', a);
        g.lineWidth = th; g.beginPath(); g.moveTo(x, y); g.lineTo(x + L, y); g.stroke();
      }
      g.restore();
    }

    // ── camera and layout ──
    /** A layer's camera at another depth: far layers (depth < 1) move and grow less, near ones (> 1) more. */
    function para(c, depth = 1, ref = [W / 2, H / 2]) {
      const z = c.z == null ? 1 : c.z, p = c.p || [W / 2, H / 2];
      return { z: Math.pow(z, depth), p: [ref[0] + (p[0] - ref[0]) * depth, ref[1] + (p[1] - ref[1]) * depth], to: c.to || [W / 2, H / 2] };
    }
    // out of focus, cheaply: the layer is drawn once at quarter size, blurred there, and laid back at full size (a
    // canvas filter on every draw call of a busy layer costs seconds a frame on the CPU raster renders use)
    let FOC = null;
    function focus(g, px, draw) {
      if (!(px > 0.3)) return draw(g);
      const k = 0.25, cw = Math.ceil(W * k), ch = Math.ceil(H * k);
      if (!FOC) FOC = [env.canvas(cw, ch), env.canvas(cw, ch)];
      const qa = FOC[0].getContext('2d'), qb = FOC[1].getContext('2d'), M = g.getTransform(), f = k / S;
      qa.setTransform(1, 0, 0, 1, 0, 0); qa.clearRect(0, 0, cw, ch);
      qa.setTransform(M.a * f, M.b * f, M.c * f, M.d * f, M.e * f, M.f * f);
      qa.globalAlpha = g.globalAlpha;
      const sharpToo = px < 2.5;
      let r;
      REG = { div: k, skip: sharpToo };
      try { r = draw(qa); } finally { REG = null; }
      qb.setTransform(1, 0, 0, 1, 0, 0); qb.clearRect(0, 0, cw, ch);
      qb.filter = `blur(${Math.max(0.4, px * k).toFixed(2)}px)`; qb.drawImage(FOC[0], 0, 0); qb.filter = 'none';
      g.save(); g.setTransform(S, 0, 0, S, 0, 0); g.globalAlpha = 1; g.imageSmoothingEnabled = true; g.drawImage(FOC[1], 0, 0, W, H); g.restore();
      if (sharpToo) { g.save(); g.globalAlpha *= 1 - px / 2.5; draw(g); g.restore(); }   // the first frames of a rack: sharp fading out
      return r;
    }
    function zone() {
      const keepOut = C && C.bubble ? C.bubble.keepOut : null;
      return {
        x0: 64, y0: 64, x1: W - 64, y1: H - 64, keepOut,
        left: (y) => (keepOut && y > keepOut.y - 40 ? keepOut.x + keepOut.w + 48 : 64),
      };
    }

    return {
      FONT, FACE, C: PAL, rgba,
      bind(ctx) { C = ctx; S = ctx.scale || 1; F = ctx.F; T = ctx.TT; },
      ground, leak, leaks, flash, vignette, grain, dust, weave, letterbox, finish,
      type, strips, cascade, slam, chip, roll, clock,
      rule, frame, lines, streaks,
      para, anchor, focus, zone,
    };
  },
});
