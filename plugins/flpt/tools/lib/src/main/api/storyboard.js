'use strict';
// flpt.storyboard: the Storyboard stage's board (PLAN §2.8; W2-01). The page names an episode and an edit; the board,
// its prices and what may be planned on this surface (D13) are worked out here, in main, never taken from the page.
//   view(episode)            the board as it draws it (storyboard.view: shots, the totals line and its tooltip, status
//                            lines, the price, undo and redo counts), its strawman written the moment the stage opens;
//                            null for an episode without one (made before 2.0, or with nothing to plan)
//   op(episode, op)          one directed edit (storyboard.edit: module, split, merge, move, add, remove, seconds,
//                            style, sound, ref, narrated, make, ask, lock, title, idea, mode), one undo step; an
//                            approved plan the edit changes goes back to review, and the deck onwards is out of date.
//                            Once the script is approved the plan is read-only (PLAN §2.8: no re-gate), a lock or a
//                            mode aside
//   undo(episode) · redo(episode)
//   approve(episode, mode)   'jazz' (Let FLPT play jazz) or 'directed' (User directed): first any Claude top-up the
//                            plan needs beyond what was approved (one native dialog, the difference only; a no
//                            approves nothing and changes nothing), then the plan approved with its mode. Refused
//                            for a plan already approved. → { ok, usd, view } or { ok: false, cancelled: true }
// Event: storyboard:changed { dir } after every change made here. Nothing here spends without the native dialog.
const path = require('path');
const episode = require('../episode');
const storyboard = require('../storyboard');
const plan = require('../ext/storyboard');

/** The episode folder, checked: inside the projects folder, with a record this FLPT can read. */
function dirOf(c, dir) {
  if (!c.flow || !c.flow.inProjects(dir)) throw new Error('That isn\'t an FLPT episode folder.');
  const d = path.resolve(dir);
  const why = episode.tooNew(episode.readRaw(d));
  if (why) throw new Error(why);
  return d;
}

/** What may be planned here: the surface's caps and whether a generation key is in the vault (never its value). */
const capsOf = (c) => plan.capsFor({ caps: typeof c.caps === 'function' ? c.caps() : null, vault: c.vault, settings: c.settings });

const changed = (c, dir) => { try { c.send('storyboard:changed', { dir }); } catch { /* no window */ } };

/**
 * An edit may be made while the plan isn't being polished by the crew, nor built on by the deck crew, and until the
 * script is approved (then it's read-only; a lock or a mode aside): plan.editable.
 */
const editable = (dir, op = null) => plan.editable(episode, dir, op);

/** After an edit: back to review if it un-approved the plan, the stage's mode as the board's; the page hears; → the view. */
function after(c, dir, caps) {
  if (!plan.reopenIfChanged(episode, dir)) plan.recordMode(episode, dir);
  changed(c, dir);
  return plan.viewFor(episode, dir, caps);
}

const MODES = new Set(['jazz', 'directed']);

module.exports = {
  ns: 'storyboard',
  methods: {
    view: { args: ['episode'], handler: (c, dir) => plan.viewFor(episode, dirOf(c, dir), capsOf(c)) },
    op: { args: ['episode', 'json:4096'], handler: (c, dir, o) => {
      const d = dirOf(c, dir);
      editable(d, o && typeof o === 'object' && typeof o.op === 'string' ? o.op : null);
      const caps = capsOf(c);
      storyboard.edit(d, o, { caps });
      return after(c, d, caps);
    } },
    undo: { args: ['episode'], handler: (c, dir) => {
      const d = dirOf(c, dir);
      editable(d);
      const caps = capsOf(c);
      if (!storyboard.undo(d, { caps })) throw new Error('Nothing to undo.');
      return after(c, d, caps);
    } },
    redo: { args: ['episode'], handler: (c, dir) => {
      const d = dirOf(c, dir);
      editable(d);
      const caps = capsOf(c);
      if (!storyboard.redo(d, { caps })) throw new Error('Nothing to redo.');
      return after(c, d, caps);
    } },
    approve: { args: ['episode', 'text:16'], handler: async (c, dir, mode) => {
      const d = dirOf(c, dir);
      if (!MODES.has(mode)) throw new Error('Jazz or directed.');
      plan.readyForApproval(episode, d); // changes nothing: a no below leaves the stage as it was
      // The plan's Claude cap, worked out in main from the board (the planning hooks): asked first, the difference only.
      const top = await c.flow.topUpPlanning(d, 'storyboard');
      if (!top.ok) return { ok: false, cancelled: true };
      plan.reviewable(episode, d);
      c.flow.approve(d, 'storyboard', { by: 'you' });
      plan.recordMode(episode, d, mode); // only once approved: the board and the stage say the same mode
      changed(c, d);
      return { ok: true, usd: top.usd, view: plan.viewFor(episode, d, capsOf(c)) };
    } },
  },
  events: ['storyboard:changed'],
};
