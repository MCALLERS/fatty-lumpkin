// Isometric starter: a week of numbers, 8 s on ones. A plinth drops in, five columns rise in a wave, a card and a
// mug land, the cube-bot watches; the tallest column takes the frame's one dark accent and a callout names it. Then a
// second beat: the camera pushes toward the peak, a focus ring opens round it, and the bot hops.
// The idioms in order: one projection (K.setIso), a slow push of a few percent, painter's order (back to front: the
// plinth, the columns, then nearer things), every arrival a spring that settles, detail from repetition, one dark
// accent, words set into faces (the day labels) or in mono callouts and tags. Bottom-left (x 0-380, y 700-1080)
// stays bare paper at every frame, so the same scene can host a Duet's presenter.
FLPT.scene({
  style: 'isometric',
  layers: ['canvas'],
  keyframes: ['rise', 'peak', 'focus', 'hop'],

  frame(ctx, T) {
    const K = ctx.kit, cue = ctx.cue, EZ = ctx.EZ, seg = ctx.seg;
    K.setIso({ ox: 885, oy: 668, u: 1.36 });
    // the camera: a slow push of a few percent, then on the second beat a deliberate push toward the peak
    const drift = ctx.cam({ z: 1 + 0.02 * EZ.io(seg(T, 0.3, cue('focus'))), p: [960, 560], to: [960, 560] });
    ctx.apply(ctx.camMix(drift, ctx.cam({ z: 1.07, p: [1180, 300], to: [1180, 300] }), EZ.io(seg(T, cue('focus'), cue('focus') + 1.1))));
    const PZ = 16 + 6 + 14 + 6 + 22;
    // the plinth: three plates dropping in, back to front
    const dz = (i) => K.drop(0.15 + i * 0.08, 200, { k: 160, damp: 0.6 });
    if (T > 0.15) K.isoPlates(-250, -170, 0, 520, 300, [{ h: 16, r: 44, dz: dz(0) }, { h: 14, gap: 6, inset: 10, r: 38, dz: dz(1) - dz(0) }, { h: 22, gap: 6, inset: 20, r: 32, dz: dz(2) - dz(1) }]);
    // the columns: a grid of repeated parts rising in a wave; the tallest takes the accent once it has settled
    const tops = T > 0.3 ? K.bars(-150, -150, PZ, [0.34, 0.52, 0.44, 0.7, 0.95], { w: 50, d: 50, gap: 26, h: 236, at: cue('rise'), step: 0.12, labels: ['mon', 'tue', 'wed', 'thu', 'fri'], accent: T > cue('peak') ? 4 : -1 }) : null;
    // nearer things land after: the hero, a card with lines of text, a mug
    if (T > cue('arrive')) K.cubeBot(-192, -44, PZ + K.drop(cue('arrive'), 220, { k: 170, damp: 0.5 }), 62, { key: 'hero', hop: cue('hop'), faceX: true, look: T > cue('focus') ? -0.4 : T > cue('peak') ? -0.8 : -0.2 });
    if (T > cue('card')) K.card(-226, 40, PZ + K.drop(cue('card'), 160, { k: 180 }), 170, 96, { lines: [0.8, 0.55, 0.9] });
    if (T > 1.2) K.isoMug(222, 84, PZ + K.drop(1.2, 160, { k: 180 }), 26, 46);
    // words: a callout on the peak (a focus ring opens round it on the second beat), the figure tag
    if (tops) { K.label(tops[4], '+38%', { at: cue('peak') + 0.15, dx: -150, dy: -64, size: 30, ring: 15 }); K.mark(tops[4], { at: cue('focus') + 0.25, until: cue('focus') + 1.5, r: 34 }); }
    ctx.screen();
    K.tag('01', 'week', { at: 0.3 });
  },

  hits(ctx) {
    const c = ctx.cue, out = [];
    for (let i = 0; i < 3; i++) out.push({ t: 0.25 + i * 0.08, kind: 'tick', gain: -8 });
    out.push({ t: c('arrive') + 0.2, kind: 'pop', gain: -6 });
    for (let i = 0; i < 5; i++) out.push({ t: c('rise') + 0.1 + i * 0.12, kind: 'tick', gain: -10 });
    out.push({ t: c('card') + 0.15, kind: 'thump', gain: -12 }, { t: c('peak') + 0.15, kind: 'click', gain: -6 });
    out.push({ t: c('focus'), kind: 'swish', gain: -10 }, { t: c('focus') + 0.3, kind: 'click', gain: -8 }, { t: c('hop'), kind: 'pop', gain: -6 });
    return out;
  },
});
