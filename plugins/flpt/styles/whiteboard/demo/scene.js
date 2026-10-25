// Whiteboard demo: slow growth, 8 s. A sprout on day one, a dotted arc of time, a tree in year ten, and the sun
// hatched in. Shows the stroke capitals, a dotted line, a tint and a hatch, and the camera following the pen from a
// close start to the whole board; the last drawing ends well before the hold, so the pen has lifted away by then.
FLPT.scene({
  style: 'whiteboard',
  layers: ['canvas'],
  keyframes: ['day', 'tree', 'sun'],

  frame(ctx, T) {
    const K = ctx.kit, cue = ctx.cue;
    K.view(K.track([
      { z: 1.35, p: [560, 640] },
      { at: cue('arc') - 0.2, dur: 1.8, z: 1.02, p: [1000, 520] },
      { at: cue('sun') - 0.4, dur: 2.4, z: 1.1, p: [1087, 507] },
    ]));
    K.board();

    const sprout = K.doodle('sprout', 520, 655, { at: cue('day') - 0.3, ink: 'green', fill: 'green', s: 1.9, cue: 'day' });
    const day = K.letters('DAY 1', 520, 860, { at: sprout.end + 0.08, size: 72, align: 'center' });
    const arc = K.dots('M 660 560 C 760 330 990 290 1090 410', { at: Math.max(day.end + 0.1, cue('arc') - 0.2), ink: 'amber', gap: 24, head: 20, cue: 'arc' });
    const tree = K.doodle('tree', 1290, 520, { at: Math.max(arc.end + 0.2, cue('tree') - 0.2), ink: 'green', fill: 'green', s: 2.3, dur: 1.05, cue: 'tree' });
    const year = K.letters('YEAR 10', 1290, 860, { at: tree.end + 0.08, size: 72, align: 'center' });
    K.doodle('sun', 1660, 250, { at: Math.max(year.end + 0.1, cue('sun') - 0.25), ink: 'amber', hatch: 'amber', hatchGap: 14, s: 1.25, hop: 0.05, dur: 1.15, cue: 'sun' });

    K.pen();
    K.light();
  },

  hits(ctx) {
    const c = ctx.cue;
    return [{ t: c('day'), kind: 'tick', gain: -10 }, { t: c('tree'), kind: 'swish', gain: -8 }, { t: c('sun') + 0.4, kind: 'chime', gain: -9 }];
  },
});
