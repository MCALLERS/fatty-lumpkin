/* kit/paper.js · flpt-live shared kit: paper and grain (FLPT.kit.paper; ctx.kit.paper in a scene).
 *   paper.sheet(key, { w, h, color, mottle, fibres, specks })  a sheet of paper, made once per key, a canvas
 *   paper.draw(g, sheet, x, y)                                     put it down (world or screen space, as g is)
 *   paper.grain(g, { amount, every, op })                          film grain over the frame, screen space; changes every `every` frames
 * Everything is seeded (ctx.rng), so every host draws the same paper. */
FLPT.kit.paper = (() => {
  'use strict';
  let C = null;
  const SHEETS = new Map(), GRAIN = new Map();
  function sheet(key = 'paper', o = {}) {
    // keyed by the colour it resolves to, so two styles on one page (host-inline) never share a sheet
    const color = o.color || C.tokens.paper || '#f2ece3';
    const w = o.w || 1920, h = o.h || 1080, id = `${key}|${w}|${h}|${color}|${o.mottle ?? ''}|${o.fibres ?? ''}|${o.specks ?? ''}`;
    if (SHEETS.has(id)) return SHEETS.get(id);
    const c = C.canvas(w, h), p = c.getContext('2d'), R = C.rng('paper', key), k = (w * h) / (1080 * 1080);
    p.fillStyle = color;
    p.fillRect(0, 0, w, h);
    for (let i = 0; i < (o.mottle ?? 70) * k; i++) {
      const x = R.r(0, w), y = R.r(0, h), r = R.r(60, 180), gr = p.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, R.f() < 0.5 ? 'rgba(255,250,240,0.03)' : 'rgba(120,100,70,0.025)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      p.fillStyle = gr; p.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    p.lineCap = 'round';
    for (let i = 0; i < (o.fibres ?? 240) * k; i++) {
      let x = R.r(0, w), y = R.r(0, h), a = R.r(0, Math.PI * 2);
      const L = R.r(9, 24), bend = R.n(0.35);
      p.strokeStyle = `rgba(150,138,120,${R.r(0.08, 0.2).toFixed(3)})`; p.lineWidth = R.r(0.6, 1.2);
      p.beginPath(); p.moveTo(x, y);
      for (let j = 0; j < 6; j++) { a += bend; x += (Math.cos(a) * L) / 6; y += (Math.sin(a) * L) / 6; p.lineTo(x, y); }
      p.stroke();
    }
    for (let i = 0; i < (o.specks ?? 300) * k; i++) { p.fillStyle = `rgba(110,100,90,${R.r(0.1, 0.25).toFixed(3)})`; p.fillRect(R.r(0, w), R.r(0, h), R.r(0.8, 1.6), R.r(0.8, 1.6)); }
    SHEETS.set(id, c);
    return c;
  }
  function draw(g, s, x = 0, y = 0) { g.drawImage(s, x, y); }
  function grain(g, o = {}) {
    const every = Math.max(1, o.every || 3), v = Math.floor(C.F / every) % 3;
    if (!GRAIN.has(v)) {
      const c = C.canvas(960, 540), p = c.getContext('2d'), d = p.createImageData(960, 540), R = C.rng('grain', v);
      for (let i = 0; i < d.data.length; i += 4) { const n = 128 + R.n(1) * 60; d.data[i] = d.data[i + 1] = d.data[i + 2] = n; d.data[i + 3] = 255; }
      p.putImageData(d, 0, 0);
      GRAIN.set(v, c);
    }
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = o.op || 'overlay'; g.globalAlpha = o.amount ?? 0.12; g.imageSmoothingEnabled = false;
    g.drawImage(GRAIN.get(v), 0, 0, 1920, 1080);
    g.restore();
  }
  return { bind(ctx) { C = ctx; }, sheet, draw, grain };
})();
