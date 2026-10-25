// Whiteboard starter: an idea takes off, 9 s on ones. A bulb draws itself with its rays, "idea" is written under it,
// an arrow leads off, a dotted flight path climbs to a paper plane, "ship it!" is written, and a loop goes round it.
// The idioms in order: the camera (K.track, K.view: close on the bulb, back to the whole thought as the pen climbs,
// then a slow push), the board, each drawing with its own `at` (chained on the one before through its returned `end`,
// keyed to its beat with `cue`), K.pen() and K.light() last. Every drawing is called on every frame (it draws
// nothing before its at), so the pen can read the whole schedule. The thought is finished by 5 s and sits in the
// middle 864 px, so the Gallery's poster (the loop's middle: its first keyframe + 3 s) and its 4:5 crop show it whole.
// Bottom-left (x 0-380, y 700-1080) stays plain board at every frame, the moves included, so the same scene can host
// a Duet's presenter.
FLPT.scene({
  style: 'whiteboard',
  layers: ['canvas'],
  keyframes: [2.4, 'ship', 'loop'],

  frame(ctx, T) {
    const K = ctx.kit, cue = ctx.cue;
    K.view(K.track([
      { z: 1.3, p: [800, 600] },                                                    // close on the bulb
      { at: cue('idea') + 1.45, dur: 1.6, z: 1.0, p: [960, 540], drift: 0.006 },     // back: the whole thought as the pen climbs
    ]));
    K.board();

    // the idea: an outline, its tint, its rays, its label
    const bulb = K.doodle('bulb', 760, 610, { at: cue('idea') - 0.2, ink: 'ink', fill: 'amber', s: 1.6, dur: 0.9, cue: 'idea' });
    const rays = K.doodle('bulb', 760, 610, { part: 'rays', at: bulb.end + 0.06, s: 1.6, ink: 'amber', dur: 0.36 });
    const idea = K.write('idea', 760, 880, { at: rays.end + 0.08, align: 'center', size: 92 });
    // up and away: an arrow, a dotted climb, the plane at its end
    const arrow = K.arrow([880, 520], [990, 420], { at: idea.end + 0.08, ink: 'blue', bend: -0.3, dur: 0.3 });
    const trail = K.dots([[1015, 395], [1055, 345], [1095, 305], [1130, 280]], { at: arrow.end + 0.05, ink: 'blue', gap: 22 });
    const plane = K.doodle('plane', 1235, 230, { at: Math.max(trail.end + 0.05, cue('ship') - 0.25), ink: 'ox', fill: 'ox', s: 1.25, rot: -0.12, dur: 0.66, cue: 'ship' });
    // the punchline, and its loop
    const ship = K.write('ship it!', 1172, 652, { at: plane.end + 0.1, align: 'center', size: 96, ink: 'ox' });
    K.loop(1180, 622, 178, 80, { at: Math.max(ship.end + 0.1, cue('loop') - 0.25), ink: 'blue', dur: 0.62, cue: 'loop' });

    K.pen();
    K.light();
  },

  hits(ctx) {
    const c = ctx.cue;
    return [{ t: c('idea') + 1.0, kind: 'pop', gain: -6 }, { t: c('ship'), kind: 'swish', gain: -8 }, { t: c('loop') + 0.4, kind: 'chime', gain: -8 }];
  },
});
