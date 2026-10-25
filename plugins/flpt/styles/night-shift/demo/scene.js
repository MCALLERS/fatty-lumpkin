// Night Shift demo: 7 s of midnight, placed as a Motion Duet (the presenter's bubble in the bottom-left corner stays
// clear: every word sits right of it or above it, K.zone() says where). The clock ticks over to midnight, the word
// sets in, a line falls in under it, the light flares and the far numerals roll; then it holds and breathes.
FLPT.scene({
  style: 'night-shift',
  placement: 'duet',
  layers: ['canvas'],
  keyframes: ['roll', 'title', 'flare'],

  frame(ctx, T) {
    const K = ctx.kit, g = ctx.g, c = ctx.cue, EZ = ctx.EZ, seg = ctx.seg, Z = K.zone();
    const X = Math.max(176, Z.left(700)) + 64;   // the camera pushes in: keep a margin off the presenter's corner
    const fl = T - c('flare');
    const wv = K.weave(1);
    const z = ctx.springTrack([[0, 1.0], [c('title') - 0.3, 1.025], [c('flare') - 0.2, 1.05]], 'heavy');
    const cam = { z, p: [ctx.lerp(980, 1040, EZ.io(seg(T, 0, ctx.duration))), 520], to: [960 + wv[0], 540 + wv[1]] };

    K.ground(g);
    ctx.apply(K.para(cam, 0.5));
    K.roll(g, '23', '00', EZ.io(seg(T, c('flare') - 0.1, c('flare') + 0.6)), 1520, 880, { face: 'black', size: 760, stroke: 3, fill: K.rgba('steel', 0.06), color: K.rgba('steel', 0.4), align: 'center', id: false });

    ctx.apply(cam);
    K.clock(g, '23:59', '00:00', EZ.io(seg(T, c('roll') - 0.1, c('roll') + 0.45)), X, 300, { pop: T - (c('clock') - 0.04), size: 32, id: 'clock' });
    K.strips(g, 'Midnight', X, 520, { u: T - (c('title') - 0.12), size: 210, id: 'title' });
    K.rule(g, X, 584, X + 560, 584, { frac: EZ.o3(seg(T, c('title') + 0.3, c('title') + 0.85)), color: K.rgba('sodium', 0.9), w: 3 });
    K.cascade(g, 'the shift turns over', X, 650, { u: T - (c('turn') - 0.1), size: 60, stagger: 0.035, drop: 36, rot: 0.14, id: 'line' });

    ctx.screen();
    K.finish(g, { boost: fl >= 0 ? 1.2 * Math.exp(-fl * 2.6) : 0 });
  },

  hits(ctx) {
    return [{ t: ctx.cue('flare'), kind: 'sub', gain: -6 }];
  },
});
