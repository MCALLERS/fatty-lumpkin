'use strict';
// flpt.pipeline: Restore (T18; W1-01's handoff, built by W2-04). An episode whose pipeline scripts changed is refused
// for its slide pictures, its draft and its film ("This episode's pipeline changed."); Restore puts FLPT's own copy
// back, free, and moves anything else Python could import from there aside (kept, never deleted). flow.film() keeps a
// HeyGen approval through a refusal, so a Restore and a retry need no second yes.
//   restore(episode)  → { ok, restored: [file names], setAside: [file names], folder (where they went, or null) }
//   trusted(episode)  → { ok, changed: [file names] }: is the episode's pipeline FLPT's own now?
// Refused while a step runs for that episode (its scripts would change under it). The page names an episode, never a
// path inside it. Event: pipeline:restored { dir, restored, setAside } after a Restore. Nothing here costs anything.
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

const names = (list) => (Array.isArray(list) ? list.map(String) : []);

/**
 * Is a step running for the episode? flow.isBusy(dir) where the flow has it. Until then, flow.open's `running`: the
 * flow keeps what runs privately (the record can't say: a stage left 'running' by a crash isn't running), and open
 * runs the open hooks (the storyboard's ensure, planview's reads) as a side effect. That's free and changes nothing a
 * Restore depends on, just more than it needs (handoff: flow.isBusy, flow.js has no Wave 2 owner).
 */
function busy(c, d) {
  if (typeof c.flow.isBusy === 'function') return Boolean(c.flow.isBusy(d));
  return typeof c.flow.open === 'function' ? Boolean(c.flow.open(d).running) : false;
}

module.exports = {
  ns: 'pipeline',
  methods: {
    restore: { args: ['episode'], handler: (c, dir) => {
      const d = dirOf(c, dir);
      if (busy(c, d)) throw new Error('Something is running for this episode.');
      const r = c.pipeline.restore(d);
      const out = { ok: Boolean(r && r.ok), restored: names(r && r.restored), setAside: names(r && r.setAside), folder: (r && r.folder) || null };
      if (r && r.error) out.error = String(r.error);
      try { c.send('pipeline:restored', { dir: d, restored: out.restored, setAside: out.setAside }); } catch { /* no window */ }
      return out;
    } },
    trusted: { args: ['episode'], handler: (c, dir) => {
      const t = c.pipeline.trust(dirOf(c, dir));
      return { ok: Boolean(t && t.ok), changed: names(t && t.changed) };
    } },
  },
  events: ['pipeline:restored'],
};
