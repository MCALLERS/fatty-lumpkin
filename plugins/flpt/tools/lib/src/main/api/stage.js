'use strict';
// flpt.stage: the Stage (PLAN §2.5), live preview of a piece of Live Motion code. The page names a piece, never a path;
// the surface's Stage host does the rest (the Mac: shell/stage.js, a native view over the page's Stage slot, given as
// ctx.stageHost). A surface without one answers "No Stage here."
//   open({ source, id, t })   mount a piece ('demo' + counter | ledger | flywheel here; scenes, styles and rigs add their
//                             own sources); → the state
//   place(geometry)           where the Stage slot is on the page and whether it can be seen (ui-stage.js sends it):
//                             { visible, x, y, width, height } in CSS px
//   send(command)             a protocol command (play, pause, seek, rate, quality, mode, wipe, overlay, voice, sound,
//                             snapshot): numbers and enums only, checked again in main
//   close() · state()
// Events: stage:event (the harness's ready, tick, error and snapshot, cleaned) and stage:state (open, ready, killed,
// off, the poster and the render to play after a kill, as flpt:// URLs). Nothing here costs anything.
const hostOf = (c) => {
  if (!c || !c.stageHost) throw new Error('No Stage here.');
  return c.stageHost;
};

module.exports = {
  ns: 'stage',
  methods: {
    open: { args: ['json:2048'], handler: (c, spec) => hostOf(c).open(spec) },
    place: { args: ['json:1024'], handler: (c, geometry) => hostOf(c).place(geometry) },
    send: { args: ['json:1024'], handler: (c, command) => hostOf(c).send(command) },
    close: { args: [], handler: (c) => hostOf(c).close() },
    state: { args: [], handler: (c) => hostOf(c).state() },
  },
  events: ['stage:event', 'stage:state'],
};
