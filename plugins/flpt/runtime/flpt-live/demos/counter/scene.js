// Counter: the canvas + DOM demo (from spike K1's "basic" scene). On ones, no style kit: the plain paper.
// Canvas: a dot field breathing on keyed phases, an ink blob that boils on twos and travels with an ease, a square
// that springs in, a progress rule, and type drawn from the font's outlines (ctx.text). DOM layer: a headline that
// rises in, a frame counter and a card turning with rotate + scale (the hardest case for raster history).
// Every property the frame uses is set every frame.
FLPT.scene({
  layers: ['canvas', 'dom'],
  ones: true,
  fonts: [{ family: 'Fraunces Display', file: 'fraunces-display-semibold.ttf', weight: 620 }],
  keyframes: ['rise', 'square', 'count', 'settle'],

  setup(ctx) {
    const dots = [];
    for (let i = 0; i < 72; i++) {
      const r = ctx.rng('dot', i);
      dots.push({ x: 160 + (i % 12) * 145, y: 300 + Math.floor(i / 12) * 95, ph: r.r(), sp: 0.35 + r.r() * 0.6, hue: r.pick(['#e8467c', '#1f5a85', '#f2b134']) });
    }
    return {
      dots,
      headline: ctx.el('div', 'left:160px;top:110px;font:620 72px "Fraunces Display", serif;color:#17202b;white-space:nowrap;', 'Every customer brings two more'),
      counter: ctx.el('div', 'left:1540px;top:930px;font:620 40px "Fraunces Display", serif;color:#17202b;white-space:nowrap;'),
      card: ctx.el('div', 'left:1500px;top:640px;width:220px;height:140px;border-radius:18px;background:#1f5a85;'),
    };
  },

  frame(ctx, t, s) {
    const g = ctx.g;
    for (const d of s.dots) {
      const r = 14 + 26 * (0.5 + 0.5 * Math.sin(ctx.TAU * (d.ph + d.sp * t)));
      g.fillStyle = d.hue; g.beginPath(); g.arc(d.x, d.y, r, 0, ctx.TAU); g.fill();
    }
    // the blob boils on twos (ctx.B) while it travels on ones
    const bx = ctx.LX(0.15 + 0.55 * ctx.EZ.io(ctx.ev(0.5, 5.5))), by = ctx.LY(0.86), jr = ctx.rng('blob', ctx.B);
    g.fillStyle = '#17202b'; g.beginPath();
    for (let k = 0; k < 48; k++) {
      const a = (k / 48) * ctx.TAU, rr = 70 + 10 * jr.n(), x = bx + Math.cos(a) * rr * 1.3, y = by + Math.sin(a) * rr * 0.7;
      if (k) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.closePath(); g.fill();
    const k = ctx.spring(t - ctx.cue('square'), 'playful');
    g.save(); g.translate(ctx.LX(0.82), ctx.LY(0.36)); g.rotate(0.6 * (1 - k)); g.fillStyle = '#e8467c'; g.fillRect(-90 * k, -90 * k, 180 * k, 180 * k); g.restore();
    g.fillStyle = '#17202b'; g.fillRect(0, 1072, 1920 * (t / ctx.duration), 8);
    const n = Math.round(2 ** (1 + 6 * ctx.EZ.o3(ctx.seg(t, ctx.cue('count'), ctx.beat('count').end))));
    ctx.text('count', `${n} customers`, { x: 160, y: 1010, size: 56, font: '"Fraunces Display"', weight: 620, color: '#17202b', at: ctx.cue('count') - 0.2, anim: 'rise' });
    ctx.text('settle', 'until it doesn’t', { x: 1760, y: 250, size: 44, font: '"Fraunces Display"', weight: 620, color: '#1f5a85', align: 'right', at: ctx.cue('settle'), anim: 'type', dur: 0.6 });
    // the DOM layer
    const u = ctx.EZ.o3(ctx.ev(ctx.cue('rise'), 0.9));
    s.headline.style.opacity = String(u);
    s.headline.style.transform = `translateY(${((1 - u) * 40).toFixed(3)}px)`;
    s.counter.textContent = `F ${String(ctx.F).padStart(4, '0')}`;
    s.card.style.transform = `rotate(${(t * 45).toFixed(3)}deg) scale(${(0.8 + 0.2 * Math.sin(t * 2)).toFixed(4)})`;
  },

  hits(ctx) {
    return [{ t: ctx.cue('square'), kind: 'pop', gain: -6 }, { t: ctx.cue('count'), kind: 'tick', gain: -8 }, { t: ctx.cue('settle'), kind: 'chime', gain: -6 }];
  },
});
