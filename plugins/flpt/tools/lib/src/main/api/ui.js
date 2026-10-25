'use strict';
// flpt.ui: the screens' own preferences, kept in settings.json (settings.ui) so they survive a relaunch on every surface.
// Pause motion (PLAN §3.2): 'on' or 'paused'. The page mirrors it to localStorage and sets .fx-paused on <html> before
// its first paint; this is where it's kept. Nothing here costs anything or reaches the network.
const { MOTION } = require('../settings');

module.exports = {
  ns: 'ui',
  methods: {
    motion: { args: [], handler: (c) => c.settings.read().ui.motion },
    setMotion: { args: ['id:16'], handler: (c, motion) => {
      const ui = c.settings.read().ui;
      if (!MOTION.includes(motion)) throw new Error('Pause motion is on or paused.');
      const next = c.settings.write({ ui: { ...ui, motion } });
      if (!c.settings.persisted()) throw new Error('Couldn\'t save that. It holds until FLPT closes.');
      return next.ui.motion;
    } },
  },
};
