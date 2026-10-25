// =====================================================================
//  demos/kits/ledger/kit.js: Ledger, FLPT's house look (an FLPT original; flpt-live 1.0.0 demo kit from spike K6). A ledger book on a desk under a
//  lamp: parchment with fibres and foxing, iron-gall ink that bleeds a hair, thermal receipts that unroll and
//  print line by line, a vermilion rubber stamp that thumps, numbers that roll like an odometer. On ones.
//  Everything heavy (the page, the grain, the lamp, the stamp's inked face, the receipt shadows) is made once in
//  setup and composited per frame, so a frame costs a few drawImage calls and some type.
//    K.desk(g)                      the page (world coords; the scene's camera is g's transform)
//    K.receipt(g, o)                a receipt: { x, y, w, len, feed 0..1, rot, key, draw(g, w) }
//    K.ink(g, str, x, y, o)         type in ink (multiply, a hair of bleed); registers its box
//    K.pen(g, P, o)                 a pen stroke with pressure; o.frac writes it on
//    K.odometer(g, v, x, y, o)      a number whose digits roll; tabular, so nothing jitters
//    K.stamp(g, str, x, y, o)       the inked impression of a rubber stamp, o.s (scale) o.a (ink 0..1) o.rot
//    K.lamp(g), K.grain(g, F)       screen-space light and film grain, last
// =====================================================================
FLPT.style('ledger', {
  tokens: { paper: '#f0e3c6', ink: '#2a1e16', red: '#b3311c', blue: '#6f879c', receipt: '#f5f1e7', rink: '#38363a', font: '"Fraunces Display", serif' },
  fonts: [
    { family: 'Fraunces Display', file: 'fraunces-display-semibold.ttf', weight: 620 },
    { family: 'Fraunces Italic', file: 'fraunces-italic.ttf', weight: 480, style: 'italic' },
    { family: 'IBM Plex Mono', file: 'IBMPlexMono-SemiBold.ttf', weight: 600 },
  ],
  ones: true,
  make(env) {
    const { W, H, rng: RNG, clamp, lerp } = env, TAU = Math.PI * 2, tk = env.tokens;
    let F = 0;
    const canvas = (w, h) => env.canvas(w, h);
    const FONT = { display: '"Fraunces Display"', italic: '"Fraunces Italic"', mono: '"IBM Plex Mono"' };
    const fmt = (n) => String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');   // 14,460 (no locale tables)

    // ---- the page: a world 2304 x 1296 (the frame plus room for the camera), drawn once
    const PW = 2304, PH = 1296, PX = -192, PY = -108;
    let PAGE = null;
    function page() {
      if (PAGE) return PAGE;
      const c = canvas(PW, PH), p = c.getContext('2d'), R = RNG('ledger-page');
      p.fillStyle = tk.paper; p.fillRect(0, 0, PW, PH);
      for (let i = 0; i < 420; i++) {   // mottling: soft light and dark clouds, about 3 % either way
        const x = R.r(0, PW), y = R.r(0, PH), r = R.r(40, 260), gr = p.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, R.f() < 0.5 ? 'rgba(255,250,235,0.06)' : 'rgba(150,110,60,0.028)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        p.fillStyle = gr; p.fillRect(x - r, y - r, 2 * r, 2 * r);
      }
      p.lineCap = 'round';
      for (let i = 0; i < 5200; i++) {   // fibres
        let x = R.r(0, PW), y = R.r(0, PH), a = R.r(0, TAU); const L = R.r(6, 22), bend = R.n(0.4);
        p.strokeStyle = `rgba(${R.f() < 0.7 ? '110,80,45' : '255,250,235'},${R.r(0.05, 0.14)})`; p.lineWidth = R.r(0.5, 1.1);
        p.beginPath(); p.moveTo(x, y); for (let j = 0; j < 5; j++) { a += bend; x += (Math.cos(a) * L) / 5; y += (Math.sin(a) * L) / 5; p.lineTo(x, y); } p.stroke();
      }
      for (let i = 0; i < 46; i++) {     // foxing: small rust clusters
        const cx = R.r(0, PW), cy = R.r(0, PH), n = R.i(4, 26), s = R.r(4, 26);
        for (let k = 0; k < n; k++) { p.fillStyle = `rgba(${R.i(130, 160)},${R.i(80, 100)},40,${R.r(0.08, 0.3)})`; p.beginPath(); p.arc(cx + R.n(s), cy + R.n(s), R.r(0.6, 2.6), 0, TAU); p.fill(); }
      }
      for (let i = 0; i < 3; i++) {      // two tea rings and a ghost of one
        const cx = R.r(PW * 0.55, PW * 0.95), cy = R.r(PH * 0.15, PH * 0.85), r = R.r(70, 120);
        p.strokeStyle = `rgba(140,95,45,${i === 2 ? 0.05 : 0.12})`; p.lineWidth = R.r(3, 6);
        p.beginPath(); for (let a = 0; a < TAU * 0.86; a += 0.05) { const rr = r * (1 + 0.03 * Math.sin(a * 5 + i)); p.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } p.stroke();
      }
      // the ruling: faded blue lines, a red double margin (the bubble lives in the margin), two amount columns
      const ox = -PX, oy = -PY;   // world (0,0) is the frame's corner at the neutral camera
      p.lineWidth = 1.4;
      for (let y = 232; y < 1080 + 100; y += 58) { p.strokeStyle = 'rgba(95,128,160,0.30)'; p.beginPath(); p.moveTo(0, oy + y + R.n(0.6)); p.lineTo(PW, oy + y + R.n(0.6)); p.stroke(); }
      for (const [x, a] of [[420, 0.5], [428, 0.42]]) { p.strokeStyle = `rgba(179,49,28,${a})`; p.lineWidth = 1.6; p.beginPath(); p.moveTo(ox + x, 0); p.lineTo(ox + x + 1.5, PH); p.stroke(); }
      for (const x of [1690, 1790]) { p.strokeStyle = 'rgba(95,128,160,0.24)'; p.lineWidth = 1.2; p.beginPath(); p.moveTo(ox + x, 0); p.lineTo(ox + x, PH); p.stroke(); }
      // the spine: the book's gutter shadow along the left
      const gs = p.createLinearGradient(0, 0, ox + 120, 0); gs.addColorStop(0, 'rgba(60,35,15,0.38)'); gs.addColorStop(1, 'rgba(60,35,15,0)');
      p.fillStyle = gs; p.fillRect(0, 0, ox + 120, PH);
      return (PAGE = c);
    }
    function desk(g) { g.drawImage(page(), PX, PY); }

    // ---- light and grain (screen space): a warm lamp from upper right, corners falling off; grain on threes
    let LAMP = null; const GRAIN = [];
    function lamp(g) {
      if (!LAMP) {
        LAMP = canvas(W, H); const p = LAMP.getContext('2d'), gr = p.createRadialGradient(W * 0.6, H * 0.4, 60, W * 0.56, H * 0.48, W * 0.8);
        gr.addColorStop(0, 'rgba(255,214,150,0.10)'); gr.addColorStop(0.5, 'rgba(200,140,70,0.08)'); gr.addColorStop(1, 'rgba(70,40,15,0.34)');
        p.fillStyle = gr; p.fillRect(0, 0, W, H);
      }
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'multiply'; g.drawImage(LAMP, 0, 0); g.restore();
    }
    function grain(g) {
      const v = Math.floor(F / 3) % 3;
      if (!GRAIN[v]) {
        const c = canvas(W / 2, H / 2), p = c.getContext('2d'), d = p.createImageData(W / 2, H / 2), R = RNG('grain', v);
        for (let i = 0; i < d.data.length; i += 4) { const n = 128 + R.n(1) * 60; d.data[i] = d.data[i + 1] = d.data[i + 2] = n; d.data[i + 3] = 255; }
        p.putImageData(d, 0, 0); GRAIN[v] = c;
      }
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'overlay'; g.globalAlpha = 0.16; g.imageSmoothingEnabled = false; g.drawImage(GRAIN[v], 0, 0, W, H); g.restore();
    }

    // ---- type in ink: multiply onto the paper, a hair of bleed, registered for the checks (glyph outlines)
    function ink(g, str, x, y, o = {}) {
      const f = { family: o.font || FONT.display, style: o.style || 'normal', weight: o.weight || 600, size: o.size || 40, tracking: o.tracking || 0 };
      const m = env.measure(str, f), w = m.w, x0 = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x;
      const n = o.chars != null ? Math.max(0, Math.min(str.length, Math.floor(o.chars))) : str.length;
      const s = str.slice(0, n);
      g.save();
      g.globalCompositeOperation = o.op || 'multiply';
      g.fillStyle = o.color || tk.ink; g.globalAlpha = o.alpha ?? 1;
      if (o.bleed !== false) { g.shadowColor = o.color || tk.ink; g.shadowBlur = o.bleed || 1.6; }
      if (s) env.fillText(g, s, x0, y, f);
      g.restore();
      if (o.id !== false && n > 0) {
        const T = g.getTransform(), pt = (px, py) => [T.a * px + T.c * py + T.e, T.b * px + T.d * py + T.f];
        const C = [pt(x0, y - m.asc), pt(x0 + w, y - m.asc), pt(x0 + w, y + m.desc), pt(x0, y + m.desc)];
        const xs = C.map((c) => c[0]), ys = C.map((c) => c[1]);
        env.registerBox(o.id || str, str, { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
      }
      return w;
    }
    const measure = (str, o = {}) => env.measure(str, `${o.style || ''} ${o.weight || 600} ${o.size || 40}px ${o.font || FONT.display}`.trim()).w;

    // ---- the pen: a ribbon with pressure, static once drawn (keyed, not boiled); o.frac writes it on
    function pen(g, P, o = {}) {
      const R = RNG('pen', o.key || 'p'), Q = [];
      for (let i = 0; i < P.length - 1; i++) { const a = P[i], b = P[i + 1], k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 6)); for (let j = 0; j < k; j++) Q.push([lerp(a[0], b[0], j / k), lerp(a[1], b[1], j / k)]); }
      Q.push(P[P.length - 1]);
      const n = Math.max(2, Math.round(Q.length * clamp(o.frac ?? 1))); if (clamp(o.frac ?? 1) <= 0) return;
      const w = o.w || 4, f1 = R.r(0.02, 0.05), p1 = R.r(0, TAU), L = [], Rt = [];
      for (let i = 0; i < n; i++) {
        const a = Q[Math.max(0, i - 1)], b = Q[Math.min(Q.length - 1, i + 1)]; let nx = a[1] - b[1], ny = b[0] - a[0]; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
        const t = i / (Q.length - 1), taper = Math.min(1, t / 0.06, (1 - t) / 0.12 + 0.35), hw = (w / 2) * taper * (1 + 0.28 * Math.sin(i * 6 * f1 + p1)) + R.n(0.25);
        const jx = R.n(0.4), jy = R.n(0.4);
        L.push([Q[i][0] + nx * hw + jx, Q[i][1] + ny * hw + jy]); Rt.push([Q[i][0] - nx * hw + jx, Q[i][1] - ny * hw + jy]);
      }
      g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = o.color || tk.ink; g.shadowColor = o.color || tk.ink; g.shadowBlur = 1.4;
      g.beginPath(); g.moveTo(L[0][0], L[0][1]); for (const p of L) g.lineTo(p[0], p[1]); for (const p of Rt.reverse()) g.lineTo(p[0], p[1]); g.closePath(); g.fill(); g.restore();
    }

    // ---- receipts: thermal paper that unrolls downward, torn teeth at the bottom, a soft shadow on the page
    const SHADOW = new Map();
    function shadowFor(w, h) {
      const k = `${Math.round(w)}x${Math.round(h)}`; if (SHADOW.has(k)) return SHADOW.get(k);
      const pad = 40, c = canvas(w + pad * 2, h + pad * 2), p = c.getContext('2d');
      p.shadowColor = 'rgba(60,35,10,0.55)'; p.shadowBlur = 18; p.shadowOffsetX = 0; p.shadowOffsetY = 0; p.fillStyle = '#000'; p.fillRect(pad, pad, w, h);
      p.globalCompositeOperation = 'destination-out'; p.shadowColor = 'transparent'; p.fillRect(pad, pad, w, h);
      SHADOW.set(k, c); return c;
    }
    function receipt(g, o) {
      const w = o.w, len = o.len, feed = clamp(o.feed ?? 1), vis = Math.max(0, len * feed), R = RNG('rcpt', o.key);
      if (vis < 2) return;
      g.save(); g.translate(o.x, o.y); g.rotate(o.rot || 0);
      // shadow: lifted a little when the paper is still moving
      const lift = o.lift ?? 0, sh = shadowFor(w, vis);
      g.globalCompositeOperation = 'multiply'; g.globalAlpha = 0.8; g.drawImage(sh, -40 + 6 + lift * 10, -40 + 10 + lift * 16); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      // the paper (torn teeth once it has finished printing)
      const torn = feed >= 1, teeth = 14, tw = w / teeth;
      const path = () => { g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w, vis); if (torn) for (let i = teeth; i >= 0; i--) g.lineTo(i * tw, vis + (i % 2 ? 7 + R.n(2) : -3 + R.n(1.5))); else g.lineTo(0, vis); g.closePath(); };
      path(); const pg = g.createLinearGradient(0, 0, w, 0); pg.addColorStop(0, '#efeadf'); pg.addColorStop(0.12, tk.receipt); pg.addColorStop(0.85, tk.receipt); pg.addColorStop(1, '#e6e0d2');
      g.fillStyle = pg; g.fill();
      g.save(); path(); g.clip();
      if (o.draw) o.draw(g, w, vis);
      // thermal fade: two faint vertical streaks
      g.globalCompositeOperation = 'screen'; g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(w * R.r(0.2, 0.4), 0, R.r(6, 16), vis); g.fillRect(w * R.r(0.6, 0.8), 0, R.r(4, 10), vis);
      g.restore();
      if (!torn) {   // the paper still rolling out: a darker curl at the bottom edge
        const cg = g.createLinearGradient(0, vis - 26, 0, vis); cg.addColorStop(0, 'rgba(90,70,40,0)'); cg.addColorStop(1, 'rgba(90,70,40,0.32)');
        g.fillStyle = cg; g.fillRect(0, vis - 26, w, 26);
      }
      g.restore();
    }

    // ---- the stamp: an inked face made once (border, letters, uneven ink), then pressed with multiply
    const STAMPS = new Map();
    function stampFace(str, o = {}) {
      const k = str + (o.size || 150); if (STAMPS.has(k)) return STAMPS.get(k);
      const size = o.size || 150, ff = { family: FONT.display, weight: 620, size, tracking: size * 0.12 }, mm = env.measure(str, ff), tw = mm.w + size * 0.12;
      const w = Math.ceil(tw + size * 0.9), h = Math.ceil(size * 1.45), c = canvas(w, h), p = c.getContext('2d'), R = RNG('stamp', str);
      p.fillStyle = tk.red; p.strokeStyle = tk.red;
      const rr = (x, y, ww, hh, r) => { p.beginPath(); p.moveTo(x + r, y); p.arcTo(x + ww, y, x + ww, y + hh, r); p.arcTo(x + ww, y + hh, x, y + hh, r); p.arcTo(x, y + hh, x, y, r); p.arcTo(x, y, x + ww, y, r); p.closePath(); };
      p.lineWidth = size * 0.075; rr(size * 0.08, size * 0.08, w - size * 0.16, h - size * 0.16, size * 0.16); p.stroke();
      p.lineWidth = size * 0.028; rr(size * 0.2, size * 0.2, w - size * 0.4, h - size * 0.4, size * 0.08); p.stroke();
      env.fillText(p, str, w / 2 + size * 0.06 - mm.w / 2, h / 2 + size * 0.04 + (mm.asc - mm.desc) / 2, ff);
      // uneven ink: speckled gaps, a few dry streaks, heavier towards one edge
      p.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < w * h * 0.0045; i++) { p.fillStyle = `rgba(0,0,0,${R.r(0.3, 1)})`; p.beginPath(); p.arc(R.r(0, w), R.r(0, h), R.r(0.6, 3.2), 0, TAU); p.fill(); }
      for (let i = 0; i < 7; i++) { p.fillStyle = `rgba(0,0,0,${R.r(0.15, 0.4)})`; const y = R.r(0, h); p.fillRect(R.r(-20, w * 0.3), y, R.r(w * 0.3, w), R.r(1.5, 5)); }
      const fade = p.createLinearGradient(0, 0, w, h); fade.addColorStop(0, 'rgba(0,0,0,0.0)'); fade.addColorStop(1, 'rgba(0,0,0,0.28)'); p.fillStyle = fade; p.fillRect(0, 0, w, h);
      STAMPS.set(k, c); return c;
    }
    function stamp(g, str, x, y, o = {}) {
      const face = stampFace(str, o), s = o.s ?? 1, a = clamp(o.a ?? 1);
      if (a <= 0 || s <= 0) return;
      g.save(); g.translate(x, y); g.rotate(o.rot || 0); g.scale(s, s);
      g.globalCompositeOperation = 'multiply'; g.globalAlpha = a; g.drawImage(face, -face.width / 2, -face.height / 2);
      g.restore();
      if (o.id !== false) {
        const T = g.getTransform(), hw = (face.width / 2) * s, hh = (face.height / 2) * s, cr = Math.cos(o.rot || 0), sr = Math.sin(o.rot || 0);
        const C = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([u, v]) => { const px = x + u * cr - v * sr, py = y + u * sr + v * cr; return [T.a * px + T.c * py + T.e, T.b * px + T.d * py + T.f]; });
        const xs = C.map((c) => c[0]), ys = C.map((c) => c[1]);
        env.registerBox(o.id || 'stamp:' + str, str, { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
      }
    }
    // a shadow on the paper where the stamp is about to land (s > 1: still in the air)
    function stampShadow(g, str, x, y, o = {}) {
      // the face's own silhouette, blurred by its height above the paper, sliding in under the light
      const face = stampFace(str, o), s = o.s ?? 1.3, k = clamp((s - 1) / 0.6);
      g.save(); g.translate(x + 40 * k, y + 60 * k); g.rotate(o.rot || 0); g.scale(1 + k * 0.18, 1 + k * 0.18);
      g.globalCompositeOperation = 'multiply'; g.globalAlpha = 0.5 * (1 - k * 0.55); g.filter = `brightness(0.25) blur(${2 + k * 14}px)`;
      g.drawImage(face, -face.width / 2, -face.height / 2); g.restore();
    }

    // ---- an odometer: digits in fixed cells; the units roll with the fraction, a column turns as the one below passes 9
    function odometer(g, v, x, y, o = {}) {
      const size = o.size || 80, ff = { family: o.font || FONT.display, weight: o.weight || 620, size }, str = fmt(v);
      const cell = env.measure('0', ff).w * 1.02, comma = env.measure(',', ff).w, lh = size * 0.9;
      let total = 0; for (const ch of str) total += ch === ',' ? comma : cell;
      let cx = o.align === 'right' ? x - total : o.align === 'center' ? x - total / 2 : x;
      const digits = str.replace(/,/g, '').length;
      g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = o.color || tk.ink; g.shadowColor = o.color || tk.ink; g.shadowBlur = o.bleed ?? 1.4;
      let k = digits - 1;
      for (const ch of str) {
        if (ch === ',') { env.fillText(g, ',', cx, y, ff); cx += comma; continue; }
        const p = 10 ** k, lower = v - Math.floor(v / p) * p, f = k === 0 ? v - Math.floor(v) : clamp(lower - (p - 1)), d = Math.floor(v / p) % 10;
        g.save(); g.beginPath(); g.rect(cx - 2, y - size * 0.8, cell + 4, size * 0.9); g.clip();
        const dx = (dd) => cx + (cell - env.measure(String(dd), ff).w) / 2;
        env.fillText(g, String(d), dx(d), y - f * lh, ff); if (f > 0.001) env.fillText(g, String((d + 1) % 10), dx((d + 1) % 10), y - f * lh + lh, ff);
        g.restore(); cx += cell; k--;
      }
      g.restore();
      if (o.id !== false) { const T = g.getTransform(), x0 = o.align === 'right' ? x - total : o.align === 'center' ? x - total / 2 : x; env.registerBox(o.id || 'num', str, { x: T.a * x0 + T.e, y: T.d * (y - size * 0.72) + T.f, w: T.a * total, h: T.d * size * 0.75 }); }
      return total;
    }

    // a strip of paper tape holding something down: translucent, torn ends, a hint of crease
    function tape(g, x, y, w, h, rot, key) {
      const R = RNG('tape', key);
      g.save(); g.translate(x, y); g.rotate(rot);
      g.beginPath(); g.moveTo(-w / 2, -h / 2);
      for (let i = 0; i <= 6; i++) g.lineTo(-w / 2 + (w * i) / 6, -h / 2 + R.n(1.5));
      for (let i = 0; i <= 5; i++) g.lineTo(w / 2 + R.n(4), -h / 2 + (h * i) / 5);
      for (let i = 6; i >= 0; i--) g.lineTo(-w / 2 + (w * i) / 6, h / 2 + R.n(1.5));
      for (let i = 5; i >= 0; i--) g.lineTo(-w / 2 + R.n(4), -h / 2 + (h * i) / 5);
      g.closePath(); g.fillStyle = 'rgba(226,206,160,0.74)'; g.fill();
      g.globalCompositeOperation = 'multiply'; g.strokeStyle = 'rgba(150,120,70,0.25)'; g.lineWidth = 1; g.stroke();
      g.restore();
    }
    // a fountain pen lying on the page: lacquer body, a gold band, a steel nib, its shadow
    function fountain(g, x, y, rot, len = 620) {
      g.save(); g.translate(x, y); g.rotate(rot);
      g.save(); g.translate(14, 22); g.globalCompositeOperation = 'multiply'; g.fillStyle = 'rgba(70,40,15,0.28)'; g.filter = 'blur(10px)'; g.beginPath(); g.roundRect(0, -20, len, 40, 20); g.fill(); g.restore();
      const body = (x0, x1, r) => { const gr = g.createLinearGradient(0, -r, 0, r); gr.addColorStop(0, '#3d4a3a'); gr.addColorStop(0.35, '#1d2a20'); gr.addColorStop(0.55, '#5f7262'); gr.addColorStop(0.7, '#17221a'); gr.addColorStop(1, '#0d140f'); g.fillStyle = gr; g.beginPath(); g.roundRect(x0, -r, x1 - x0, 2 * r, r); g.fill(); };
      body(len * 0.18, len, 19);
      const gold = g.createLinearGradient(0, -19, 0, 19); gold.addColorStop(0, '#8a6a2a'); gold.addColorStop(0.4, '#e2c27a'); gold.addColorStop(0.6, '#a07c34'); gold.addColorStop(1, '#5a4214');
      g.fillStyle = gold; g.fillRect(len * 0.56, -19.5, 16, 39); g.fillRect(len * 0.6, -19.5, 5, 39);
      g.fillRect(len * 0.6 + 40, -24, len * 0.3, 7);   // the clip
      const sec = g.createLinearGradient(0, -14, 0, 14); sec.addColorStop(0, '#2a2a2a'); sec.addColorStop(0.5, '#5a5a58'); sec.addColorStop(1, '#151515');
      g.fillStyle = sec; g.beginPath(); g.moveTo(len * 0.18, -15); g.lineTo(len * 0.1, -11); g.lineTo(len * 0.1, 11); g.lineTo(len * 0.18, 15); g.closePath(); g.fill();
      const nib = g.createLinearGradient(0, -10, 0, 10); nib.addColorStop(0, '#9a8f72'); nib.addColorStop(0.5, '#efe3bd'); nib.addColorStop(1, '#7d7258');
      g.fillStyle = nib; g.beginPath(); g.moveTo(len * 0.1, -10); g.quadraticCurveTo(len * 0.04, -6, 0, 0); g.quadraticCurveTo(len * 0.04, 6, len * 0.1, 10); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(40,30,15,0.7)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(len * 0.075, 0); g.lineTo(4, 0); g.stroke();
      g.restore();
    }
    return {
      tape, fountain,
      bind(c) { F = c.F; },
      FONT, page, desk, lamp, grain, ink, measure, pen, receipt, stamp, stampShadow, stampFace, odometer,
      PAGE_BOX: { x: PX, y: PY, w: PW, h: PH },
    };
  },
});
