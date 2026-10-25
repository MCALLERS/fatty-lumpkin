'use strict';
// flpt.delivery (W2-03, PLAN §3.3 S13): what Deliver hands over besides the video.
//   captions(episode, on) → { captions }   presentation.srt beside the delivered video, from the script's words and
//                                          their times in it (free). A change after a delivery makes it out of date.
// The record keeps the choice in its Deliver stage (`captions`); the flow's open view carries it as
// view.deliverOptions.captions (ext/interstitials.js). Refused while a step runs for the episode. Event:
// delivery:changed { dir, captions }. Nothing here costs anything.
const path = require('path');
const episode = require('../episode');

/** The episode folder, checked: inside the projects folder, with a record this FLPT can read. */
function dirOf(c, dir) {
  if (!c.flow || !c.flow.inProjects(dir)) throw new Error('That isn\'t an FLPT episode folder.');
  const d = path.resolve(dir);
  const why = episode.tooNew(episode.readRaw(d));
  if (why) throw new Error(why);
  return d;
}

/** Set the captions choice; a delivered episode is out of date when it changes. → { captions } */
function setCaptions(d, on) {
  const st = episode.read(d);
  const deliver = { ...(st.stages.deliver || {}) };
  if (deliver.status === 'running') throw new Error('Deliver is running.');
  if (Boolean(deliver.captions) === on) return { captions: on };
  deliver.captions = on;
  if (deliver.status === 'approved') deliver.status = 'stale';
  episode.write(d, { ...st, stages: { ...st.stages, deliver } });
  return { captions: on };
}

module.exports = {
  ns: 'delivery',
  methods: {
    captions: { args: ['episode', 'bool'], handler: (c, dir, on) => {
      const d = dirOf(c, dir);
      if (typeof c.flow.isBusy === 'function' && c.flow.isBusy(d)) throw new Error('Something is running for this episode.');
      const r = setCaptions(d, on === true);
      try { c.send('delivery:changed', { dir: d, captions: r.captions }); } catch { /* no window */ }
      return r;
    } },
  },
  events: ['delivery:changed'],
  setCaptions,
};
