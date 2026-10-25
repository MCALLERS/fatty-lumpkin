'use strict';
// flpt.guest.voice: who narrates a slide with no presenter on screen (W4-11, guest narrators; guestvoice.js).
//   voice(episode, shot, voice)   voice: null (the presenter), { provider, id } (a guest: one of the FLPT voices, or a
//                                 voice of the user's own), or { reset: true } (the plan's own: in Jazz, a Cosmos is
//                                 told by Hobbiton Narrator where the FLPT voices can speak). One undo step on the board
//                                 (storyboard.edit, op 'voice': it keeps the plan approved), then script.md's tag for
//                                 that slide (guestvoice.stamp). Open after the script is approved (who speaks isn't
//                                 the plan), closed while any crew is at work (the script crew writes script.md too),
//                                 and once the film's spend is approved (that approval priced the voices). → the board's view,
//                                 as flpt.storyboard.view gives it
// Its own namespace (guest), beside the storyboard's: the board's view comes back as flpt.storyboard.view gives it, and
// storyboard:changed is said as the storyboard's own edits say it. setVoice is the same edit for the plugin's CLI
// (engine/tools/flpt-storyboard.js: `set <shot> voice …`).
const path = require('path');
const episode = require('../episode');
const storyboard = require('../storyboard');
const guest = require('../guestvoice');
const plan = require('../ext/storyboard');

/** The episode folder, checked: inside the projects folder, with a record this FLPT can read. */
function dirOf(c, dir) {
  if (!c.flow || !c.flow.inProjects(dir)) throw new Error('That isn\'t an FLPT episode folder.');
  const d = path.resolve(dir);
  const why = episode.tooNew(episode.readRaw(d));
  if (why) throw new Error(why);
  return d;
}

const capsOf = (c) => plan.capsFor({ caps: typeof c.caps === 'function' ? c.caps() : null, vault: c.vault, settings: c.settings });

/**
 * May a voice change now? Throws why not: never while any crew is at work on the episode (the tag is a rewrite of
 * script.md, which the script crew writes too; guestvoice.frozen's rule), nor once the film's spend is approved.
 */
function voiceable(dir) {
  const st = episode.read(dir);
  if (!st || plan.skipped(st) || !storyboard.read(dir)) throw new Error('This episode has no storyboard.');
  const s = (n) => (st.stages && st.stages[n] ? st.stages[n].status : null);
  if (s('storyboard') === 'running') throw new Error('The storyboard is being planned.');
  if (s('deck') === 'running') throw new Error('The deck crew is working.');
  if (s('spend') === 'approved') throw new Error('The film is approved: its voices are set.');
  if (guest.frozen(st)) throw new Error('A crew is working on this episode.');
}

/**
 * Set a slide's voice (voiceable first), one undo step, then script.md's tags. d: { vault, settings } (whether the FLPT
 * voices can speak in this film: guestvoice.houseFor). → the stamp's answer.
 */
function setVoice(dir, shot, voice, { caps = null, d = {} } = {}) {
  voiceable(dir);
  const o = voice && typeof voice === 'object' && voice.reset === true ? { op: 'voice', id: shot, reset: true }
    : { op: 'voice', id: shot, voice: voice == null ? null : voice };
  storyboard.edit(dir, o, { caps });
  return guest.stamp(dir, { house: guest.houseFor(d, dir) });
}

module.exports = {
  ns: 'guest',
  methods: {
    voice: { args: ['episode', 'id:8', 'json:512?'], handler: (c, dir, shot, voice) => {
      const d = dirOf(c, dir);
      const caps = capsOf(c);
      setVoice(d, shot, voice, { caps, d: { vault: c.vault, settings: c.settings } });
      try { c.send('storyboard:changed', { dir: d }); } catch { /* no window */ }
      return plan.viewFor(episode, d, caps);
    } },
  },
  setVoice,
  voiceable,
};
