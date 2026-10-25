// Night Shift starter: an 8 s interstitial on the music (Solo ♪), the part card between two stretches of a talk.
// The beats ride the score's grid ("at" in beats.json; FLPT's align-music sets their t): a chip on beat 2, the title
// sets in on beat 3, a line falls in on bar 2, the part's number rolls over on bar 3, cinema bars close on bar 4.
// One push in, a far layer for depth, a bump and a flare on the hit; the film pass last. The talk's own words go in
// place of these; the bones stay.
FLPT.scene({
  style: 'night-shift',
  layers: ['canvas'],
  keyframes: ['title', 'hit', 'bars'],

  frame(ctx, T) {
    const K = ctx.kit, g = ctx.g, c = ctx.cue, EZ = ctx.EZ, seg = ctx.seg, Z = K.zone();
    // one left edge for the block, inside the Gallery's centre 4:5 crop (x 528-1392) and clear of a Duet's presenter
    const X = Math.max(620, Z.left(840));
    const hit = T - c('hit');
    const wv = K.weave(1);
    // the camera: a slow push across the whole piece, a bump when the hour rolls over
    const z = ctx.lerp(1, 1.06, EZ.io(seg(T, 0, ctx.duration))) * (1 + (hit >= 0 ? 0.018 * Math.exp(-hit * 6) : 0));
    const cam = { z, p: [ctx.lerp(960, 1000, EZ.io(seg(T, 0, ctx.duration))), 540], to: [960 + wv[0], 540 + wv[1]] };

    K.ground(g);
    // far back: the part's number, an outline that rolls 01 → 02 on the hit, right of the block (it balances the
    // type in 16:9; the 4:5 crop keeps the block)
    ctx.apply(K.para(cam, 0.55));
    K.roll(g, '01', '02', EZ.io(seg(T, c('hit') - 0.08, c('hit') + 0.5)), Z.keepOut ? 1500 : 1430, 900, { face: 'black', size: 820, stroke: 3, fill: K.rgba('steel', 0.05), color: K.rgba('steel', 0.32), align: 'center', id: false });

    ctx.apply(cam);
    K.rule(g, X, 380, X + 640, 380, { frac: EZ.o3(seg(T, 0.05, 0.75)), color: K.rgba('steel', 0.5), w: 1.5 });
    K.chip(g, 'Part two', X, 330, { u: T - (c('tick') - 0.04), size: 30, id: 'chip' });
    K.strips(g, 'After', X, 520, { u: T - (c('title') - 0.12), size: 200, id: 'title-1' });
    K.strips(g, 'hours', X, 700, { u: T - (c('title') + 0.02), size: 200, id: 'title-2' });
    K.rule(g, X, 750, X + 640, 750, { frac: EZ.o3(seg(T, c('title') + 0.35, c('title') + 0.9)), color: K.rgba('sodium', 0.9), w: 3 });
    K.cascade(g, 'the work goes on', X, 830, { u: T - (c('turn') - 0.1), size: 64, stagger: 0.035, drop: 40, rot: 0.14, id: 'line' });

    ctx.screen();
    K.letterbox(g, EZ.io(seg(T, c('bars') - 0.1, c('bars') + 0.6)));
    K.finish(g, { boost: hit >= 0 ? 1.3 * Math.exp(-hit * 2.6) : 0 });
  },

  hits(ctx) {
    return [{ t: ctx.cue('hit'), kind: 'sub', gain: -4 }];
  },
});
