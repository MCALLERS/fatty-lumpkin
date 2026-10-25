// Cut Paper starter: a sunny room, 8 s on twos. The spark arrives, notices the plant, the plant blooms, it cheers.
// The idioms in order: a camera for the whole frame, one wall colour with a pattern, the room's furniture, small
// background life (steam, a clock, a bird, a cloud, a sleeping cat), the hero acting with a face, writing in the
// world on paper (the pot's tag), then the frame's grain. Bottom-left (x 0-380, y 700-1080) stays plain paper at
// every frame, the push included (the cloth starts at x 540, so its edge stays right of x 405), so the same scene
// can host a Duet's presenter.
FLPT.scene({
  style: 'cut-paper',
  layers: ['canvas'],
  keyframes: ['look', 'bloom', 'cheer'],

  frame(ctx, T) {
    const K = ctx.kit, P = K.PAL, cue = ctx.cue;
    // the camera: a slow push toward the plant, landing as it blooms; layers move with it at their own depth
    const k = ctx.EZ.io(ctx.seg(T, 0.2, cue('bloom') + 0.8));
    const cam = { z: ctx.lerp(1.0, 1.1, k), p: [ctx.lerp(960, 1040, k), ctx.lerp(540, 560, k)] };
    const at = (f) => ctx.apply(ctx.cam(K.layerCam(cam, f)));

    at(0.8);   // the wall plane
    K.wall(P.mint, K.pat.stripes('rgba(255,255,255,0.28)', 22, 70), { pad: 300 });
    K.cut(K.rect(-300, 640, 2520, 600, 0), P.cream, { key: 'panel', tear: 0, shadow: false, sy: -3 });
    K.cut(K.rect(-300, 626, 2520, 26, 3), P.woodL, { key: 'rail', tear: 0, sb: 6, sy: 3 });
    // the window: sky, sun, a drifting cloud, a bird on the sill outside
    K.cut(K.rect(1150, 110, 480, 420, 6), P.woodD, { key: 'win' });
    K.cut(K.rect(1174, 134, 432, 372, 2), P.sky, { key: 'glass', shadow: false });
    ctx.g.save(); ctx.g.beginPath(); ctx.g.rect(1174, 134, 432, 372); ctx.g.clip();
    K.sun(1500, 250, 56, { key: 'sun', face: true, mood: 'happy' });
    K.cloud(1280 + T * 14, 330, 0.65, 'cloud');
    K.tree(1260, 560, 0.7, { key: 'tree' });
    ctx.g.restore();
    K.ink([[1390, 134], [1390, 506]], { w: 9, color: P.woodD, key: 'mull' });
    K.cut(K.rect(1130, 504, 520, 30, 4), P.wood, { key: 'sill' });
    K.bird(1530 + (T > cue('look') ? 12 : 0), 504, 1, { key: 'bird', facing: -1, flap: (ctx.B % 19) < 3 });
    // a shelf with a clock and books
    K.cut(K.rect(380, 360, 420, 24, 3), P.wood, { key: 'shelf' });
    K.clock(470, 260, 70, 10, 10 + Math.floor(T * 2) % 60, 'clock');
    K.books(680, 360, 0.8, 'books');

    at(1.0);   // the table, the pot, the hero
    K.cut(K.rect(540, 760, 1590, 500, 6), P.pink, { key: 'cloth', tear: 1.6, pat: K.pat.gingham('rgba(255,255,255,0.35)', 18), sy: -5, sb: 14 });
    K.mug(1560, 780, 0.9, P.yellow, 'mug');
    K.cat(760, 770, 0.7, P.charcoal, 'cat');
    // the plant: leaves now, flowers popping on "bloom", one after another
    K.plant(1180, 770, 1.15, P.blue, 'plant');
    for (let i = 0; i < 5; i++) {
      const s = K.popS(cue('bloom') + i * 0.16);
      if (s <= 0.01) continue;
      const fx = 1180 + (i - 2) * 46 + (i % 2) * 8, fy = 600 - (i % 2 ? 50 : 0) - (i === 2 ? 40 : 0);
      ctx.g.save(); ctx.g.translate(fx, fy); ctx.g.scale(s, s);
      for (let p = 0; p < 5; p++) { const a = (p / 5) * ctx.TAU; K.cut(K.ellipsePts(Math.cos(a) * 18, Math.sin(a) * 18, 15, 10, a, 14), [P.pink, P.purple, '#ffffff', P.yellow, P.pinkL][i], { key: `pet${i}${p}`, sb: 4, sy: 3 }); }
      K.cut(K.ellipsePts(0, 0, 10, 10, 0, 14), P.yellow, { key: 'mid' + i, shadow: false });
      ctx.g.restore();
    }
    K.tag('grow', 1230, 830, 40, { rot: 0.08, tape: false, key: 'pot' });
    // the spark: drops in on "arrive", turns to the plant on "look", cheers on "cheer"
    const drop = ctx.spring(T - cue('arrive'), 'playful'), hop = ctx.spring(T - cue('cheer'), 'playful') - ctx.spring(T - cue('cheer') - 0.3, 'playful');
    const mood = T < cue('arrive') + 0.5 ? 'wow' : T < cue('bloom') ? 'smile' : T < cue('bloom') + 0.5 ? 'wow' : 'happy';
    K.spark(940, ctx.lerp(-260, 680, drop) - 60 * hop, 92, { key: 'hero', rays: 9, mood, look: T > cue('look') ? [5, 0] : [0, 2] });

    at(1.25);   // nearer than the table: a teacup at the right edge
    K.cut(K.ellipsePts(1820, 1060, 150, 40, 0, 26), P.paper, { key: 'saucer', sb: 14 });
    K.cut(K.rect(1730, 940, 180, 120, 40), P.teal, { key: 'cup', pat: K.pat.dots('rgba(255,255,255,0.35)', 5, 24) });

    ctx.screen();
    K.grain();
  },

  hits(ctx) {
    const c = ctx.cue;
    return [{ t: c('arrive') + 0.12, kind: 'pop', gain: -2 }, { t: c('bloom'), kind: 'pop', gain: -4 }, { t: c('bloom') + 0.32, kind: 'pop', gain: -6 }, { t: c('cheer'), kind: 'chime', gain: -6 }];
  },
});
