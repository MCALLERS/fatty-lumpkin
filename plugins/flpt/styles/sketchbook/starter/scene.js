// Sketchbook starter: one page, 8 s on twos. The hero is drawn on (pencil, ink, colour), looks at an index card,
// the pencil writes the card's lines, a green check lands, and the hero cheers. The idioms in order: a camera for the
// whole frame, the page (it is the world), small graphite background life (an ant on the ground line, margin stars,
// a paper plane), one thing drawn at a time with the pencil on it, the lettering in screen space, then the grain.
// The hero and the card sit inside the centre 4:5 crop (x 528-1392), the Gallery's tall tile. Bottom-left
// (x 0-380, y 700-1080) stays bare page at every frame, the push included, so the same scene can host a
// Duet's presenter.
FLPT.scene({
  style: 'sketchbook',
  layers: ['canvas'],
  keyframes: ['look', 'write', 'cheer'],

  frame(ctx, T) {
    const K = ctx.kit, S = K.SK, cue = ctx.cue;
    // the camera: a slow lean toward the card, landing as the check goes on
    const k = ctx.EZ.io(ctx.seg(T, 0.2, cue('check') + 0.4));
    ctx.apply(ctx.cam({ z: ctx.lerp(1, 1.08, k), p: [ctx.lerp(960, 1060, k), ctx.lerp(540, 500, k)] }));
    K.sketchPage({ grid: 'dots' });

    // background life: margin stars (top left), the ground line with an ant, a plane looping the top-right margin
    [[210, 320, 0], [290, 470, 1]].forEach(([x, y, i]) => K.doodleStar(x, y, 22 + 6 * ((ctx.B + i) % 3 === 0), 'mstar' + i, { w: 3.2 }));
    K.gpencil([[600, 772], [900, 766], [1250, 774], [1500, 768]], { key: 'ground', w: 3, a: 0.75 });
    K.ant(1000 + 40 * T, 770, 1.3, 'ant');
    const at = (p) => [1660 + 120 * Math.sin(ctx.TAU * p), 220 + 46 * Math.sin(2 * ctx.TAU * p)];
    const p = T / 4, trail = [];
    for (let i = 0; i <= 20; i++) trail.push(at(p - 0.3 + 0.3 * i / 20));
    K.dashed(trail, { key: 'trail', w: 2.2, a: 0.55, dash: [10, 12] });
    const [px, py] = at(p), [qx, qy] = at(p + 0.01);
    K.paperPlane(px, py, Math.atan2(qy - py, qx - px), 1, 'plane');

    // the index card, taped to the page: its three lines written on by the pencil on "write", then a check
    const cx = 1190, cy = 420, wr = ctx.ev(cue('write'), cue('check') - cue('write') - 0.2);
    K.noteCard(cx, cy, -0.04, 2.1, wr, 'card');
    K.tapeStrip(cx, cy - 92, 120, 0.05, 'cardtape', 40);
    K.checkMark(cx + 92, cy + 30, 1.4, ctx.ev(cue('check'), 0.3));
    if (T >= cue('write') - 0.2 && T < cue('check') + 0.4) {
      const line = Math.min(2, Math.floor(wr * 3)), u = wr * 3 - line, len = [80, 68, 44][line] * 2.1;
      const tip = T < cue('check') - 0.05 ? [cx - 76 + len * Math.min(1, u), cy - 42 + line * 42] : [ctx.lerp(cx + 40, 1980, ctx.EZ.i2(ctx.ev(cue('check') - 0.05, 0.4))), ctx.lerp(cy + 40, 60, ctx.EZ.i2(ctx.ev(cue('check') - 0.05, 0.4)))];
      K.pencilTool(tip[0], tip[1], -0.75 + 0.06 * Math.sin(ctx.B * 1.7), 0.9);
    }

    // the hero: drawn on as it arrives (pencil ring, ink, colour), looks at the card, cheers on "cheer"
    const part = ctx.ev(cue('arrive'), cue('look') - cue('arrive') - 0.1);
    const hop = K.hop(cue('cheer'), 0.3), wow = T >= cue('check') && T < cue('cheer');
    const mood = part < 1 ? 'calm' : T < cue('look') ? 'calm' : wow ? 'wow' : T >= cue('cheer') ? 'happy' : 'calm';
    K.doodleHero(840, 616 - 70 * hop, 100, { key: 'hero', part, legs: true, mood, look: T >= cue('look') ? [1, -0.6] : [0, 0], sx: 1 - 0.05 * hop, sy: 1 + 0.08 * hop, arms: T >= cue('cheer') ? [1.25, 1.3] : [-0.9, -0.9] });
    K.sparkle(940, 470, 40, ctx.ev(cue('cheer') + 0.1, 0.5), 'cheer');

    // the lettering narrates, in screen space
    ctx.screen();
    K.pageTag('idea', { at: 0.2 });
    K.pageCaption(['one line at a time'], [[0, 'line']], { at: cue('write'), y: 950, x: 1060 });
    K.grain();
  },

  hits(ctx) {
    const c = ctx.cue;
    return [{ t: c('arrive') + 0.1, kind: 'tick', gain: -6 }, { t: c('write'), kind: 'tick', gain: -6 }, { t: c('check'), kind: 'pop', gain: -3 }, { t: c('cheer'), kind: 'chime', gain: -6 }];
  },
});
