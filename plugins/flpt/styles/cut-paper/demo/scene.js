// Cut Paper demo, 8 s: a 16:9 port of cth9191/animate's cut-paper demo (MIT). Two worlds joined by one shape
// bridge: the night closes in on the moon through a torn window, the moon becomes the sun on blank paper, and the
// morning opens out of the sun. The spark wakes up; the garden grows.
const MOON = [1300, 300];

function night(ctx, K, T) {
  const P = K.PAL;
  K.wall(P.navy, K.pat.dots('rgba(255,230,180,0.10)', 4, 70), { key: 'wallN' });
  K.cut(K.rect(1080, 110, 440, 440, 6), P.woodD, { key: 'win' });
  K.cut(K.rect(1104, 134, 392, 392, 2), P.night, { key: 'glass', shadow: false, pat: (bb) => { const R = ctx.rng('stars'); for (let i = 0; i < 30; i++) K.sparkle(R.r(bb.x0 + 8, bb.x1 - 8), R.r(bb.y0 + 8, bb.y1 - 8), R.r(3, 7) * (0.6 + 0.4 * ((ctx.B + i) % 2))); } });
  K.moon(MOON[0], MOON[1], 44, { key: 'moon', crescent: false });
  K.cut(K.rect(1060, 540, 480, 32, 4), P.wood, { key: 'sill' });
  K.cat(1250, 515, 0.8, P.charcoal, 'catN');
  K.clock(420, 290, 92, 11, 52, 'clock');
  K.floor(760, P.wood, K.pat.grainWood('rgba(120,60,20,0.18)'), { key: 'desk' });
  K.lamp(170, 800, 0.95, { key: 'lamp' });
  K.mug(1560, 800, 0.9, P.yellow, 'mugN');
  const w = ctx.cue('wake');
  K.spark(860, 690, 92, { rays: 7, mood: T < w ? 'focus' : 'wow', key: 'hero', s: 0.65 + 0.35 * K.popS(w) });
}

function morning(ctx, K, T) {
  const P = K.PAL;
  K.wall(P.mint, K.pat.stripes('rgba(255,255,255,0.18)', 30, 80), { key: 'wallM' });
  K.sun(MOON[0], MOON[1], 80, { key: 'sun', rays: 12 });
  [[300, 240], [700, 180]].forEach(([x, y], i) => K.cloud(x + Math.sin(T + i) * 14, y, 0.9, 'cloud' + i));
  K.cut([[-60, 720], [400, 680], [900, 730], [1400, 690], [1980, 720], [1980, 1140], [-60, 1140]], P.green, { key: 'grass', sy: -4, pat: K.pat.stripes('rgba(255,255,255,0.12)', 4, 22, 0.3) });
  for (let i = 0; i < 6; i++) {
    const k = K.popS(ctx.cue('flowers') + i * 0.25);
    if (k <= 0) continue;
    const x = 380 + i * 230, y = 860 + (i % 2) * 70;
    ctx.g.save(); ctx.g.translate(x, y); ctx.g.scale(k, k);
    K.ink([[0, 0], [0, 110]], { w: 7, color: P.greenD, key: 'stem' + i });
    for (let p = 0; p < 5; p++) { const a = (p / 5) * ctx.TAU; K.cut(K.ellipsePts(Math.cos(a) * 24, Math.sin(a) * 24, 20, 13, a, 14), [P.pink, P.purple, '#ffffff'][i % 3], { key: `pet${i}${p}`, sb: 4 }); }
    K.cut(K.ellipsePts(0, 0, 13, 13, 0, 14), P.yellow, { key: 'mid' + i, shadow: false });
    ctx.g.restore();
  }
  K.spark(860, 600, 108, { rays: 8, mood: 'happy', key: 'hero' });
}

FLPT.scene({
  style: 'cut-paper',
  layers: ['canvas'],
  keyframes: ['wake', 'flowers'],

  frame(ctx, T) {
    const K = ctx.kit, P = K.PAL, tc = ctx.cue('bridge'), seg = ctx.seg, lerp = ctx.lerp, EZ = ctx.EZ;
    const a = tc - 0.6, b = tc - 0.2, c = tc + 0.2, d = tc + 0.6, mid = [960, 520];
    const circle = (x, y, r) => K.ellipsePts(x, y, r, r, 0, 72);
    // the night closes in on the moon (the camera puts it at the centre, 3.4x), the moon becomes the sun on blank
    // paper, and the morning opens out of the sun (2.5x back to 1x): the bridge object is never under 150 px
    const camOn = (z, u) => ctx.cam({ z, p: MOON, to: [lerp(MOON[0], mid[0], u), lerp(MOON[1], mid[1], u)] });
    if (T < a) night(ctx, K, T);
    else if (T < b) {
      const u = EZ.io(seg(T, a, b));
      K.wall(P.blank, null, { key: 'blank', grain: 0.6 });
      ctx.screen(); K.windowCut(circle(lerp(MOON[0], mid[0], u), lerp(MOON[1], mid[1], u), lerp(1700, 44 * 3.4 * 1.15, EZ.i2(u))), 'winA', () => { ctx.apply(camOn(lerp(1, 3.4, u), u)); night(ctx, K, T); });
    } else if (T < c) {
      const u = EZ.io(seg(T, b, c));
      ctx.screen(); K.wall(P.blank, null, { key: 'blank', grain: 0.6 });
      K.cut(ctx.morph(circle(mid[0], mid[1], 44 * 3.4), circle(mid[0], mid[1], 80 * 2.5), u), u < 0.5 ? '#f6ecc8' : P.yellow, { key: 'bridgeBlob', tear: 1.0, amt: 1.2, crayon: u < 0.5 ? null : '#e6b23a' });
    } else if (T < d) {
      const u = EZ.io(seg(T, c, d));
      ctx.screen(); K.wall(P.blank, null, { key: 'blank', grain: 0.6 });
      K.windowCut(circle(lerp(mid[0], MOON[0], u), lerp(mid[1], MOON[1], u), lerp(80 * 2.5 * 1.15, 1700, EZ.i2(u))), 'winB', () => { ctx.apply(camOn(lerp(2.5, 1, u), 1 - u)); morning(ctx, K, T); });
    } else morning(ctx, K, T);
    ctx.screen();
    // the caption strips, written on just after each world opens
    if (T < a) K.caption('the spark wakes up', 960, 1000, 56, { frac: ctx.ev(0.45, 0.6) });
    else if (T >= d) K.caption('and the garden grows', 960, 1000, 56, { frac: ctx.ev(d + 0.1, 0.6) });
    K.grain();
  },

  hits(ctx) {
    const c = ctx.cue;
    return [{ t: c('wake'), kind: 'pop', gain: -2 }, { t: c('bridge') - 0.35, kind: 'swish', gain: -2 }, { t: c('flowers'), kind: 'chime', gain: -6 }];
  },
});
