'use strict';
// flpt.jazz (W3-03; PLAN §2.8, §3.3 S5a/S10, draft-ux §10.2; decisions.md D13): Let FLPT play jazz. The page names an
// episode (and a shot, for Generate $); every amount, rule and step is worked out in main (flow.js, ext/jazz.js).
//   view(episode)              view.jazz as the open view carries it: the mode, the flag, playing or where it stopped
//                              and why, the stages Jazz approved (the rail's ♪), the Generate $ chips with their prices
//   approve(episode)           Let FLPT play jazz: the storyboard approved as Jazz (its Claude top-up first: one native
//                              dialog, the difference only; a no approves nothing, the storyboard stays in review), then
//                              the play-through starts, unless the flag says the storyboard only. → { ok, usd, view
//                              (the storyboard's), jazz } or { ok: false, cancelled: true }
//   play(episode)              play on from where the episode is (the deck … the free draft), in the background: its lines
//                              in the log panel as a job, whose Stop stops it. → jazz
//   stop(episode)              Stop: now. → jazz
//   everyStep(episode)         Stop at every step: the plan Directed from here; a play under way ends after its step
//   through(episode, which)    the flag: 'draft' (play on to the free draft) or 'storyboard' (accept the board only)
//   upgrade(episode, shot)     Generate $ on the draft (app and web, with a generation key): that Cosmos or cut scene
//                              generated, priced at Scenes; Scenes and Spend open again. Nothing is spent here.
// Event: jazz:changed { dir, running, stage, stoppedAt, why }. The scene crews run as flpt.livemotion.run runs them.
const path = require('path');
const { execFile } = require('child_process');
const episode = require('../episode');
const storyboard = require('../ext/storyboard');
const jazzExt = require('../ext/jazz');

/** The episode folder, checked: inside the projects folder, with a record this FLPT can read. */
function dirOf(c, dir) {
  if (!c.flow || !c.flow.inProjects(dir)) throw new Error('That isn\'t an FLPT episode folder.');
  const d = path.resolve(dir);
  const why = episode.tooNew(episode.readRaw(d));
  if (why) throw new Error(why);
  return d;
}

const changed = (c, dir) => { try { c.send('jazz:changed', { dir }); } catch { /* no window */ } };

/**
 * A desktop notification: the host's own (a shell module may give `notify`), else macOS's own through osascript, its
 * words passed as arguments (never as script text). Elsewhere, none.
 */
function notifierOf(c) {
  if (typeof c.notify === 'function') return (title, body) => c.notify(title, body);
  return (title, body) => {
    if (process.platform !== 'darwin') return false;
    execFile('/usr/bin/osascript', ['-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title (item 1 of argv)', '-e', 'end run',
      String(title || '').slice(0, 200), String(body || '').slice(0, 300)], { timeout: 10000 }, () => {});
    return true;
  };
}

/**
 * The scene crews, as flpt.livemotion.run runs them (the same reservation, tools and sandbox): every piece to make, or
 * one (`key`); a host may give its own.
 */
const liveMotionOf = (c) => (c.liveMotion && typeof c.liveMotion.run === 'function' ? c.liveMotion
  : { run: (dir, o = {}) => require('./livemotion').methods.run.handler(c, dir, o && o.key ? o.key : null, '') });

/**
 * Start the play-through in the background, as a job (the log panel's lines and Stop). Refusals (not approved as Jazz,
 * something running) come back to the caller before any job opens; once it plays, its end is the job's and the event's.
 * → jazz
 */
/** Live Motion's crews draw with HyperFrames: a plan with pieces is refused before Jazz starts, not part way. */
const NEEDS_HF = 'Live Motion needs HyperFrames (Setup → Tools).';
function needsTools(c, dir) {
  if (typeof c.toolOf !== 'function') return null;
  const hf = c.toolOf('hyperframes');
  if (!hf || hf.ok) return null; // not looked for yet: the run's own check says
  let st = null;
  try { st = episode.read(dir); } catch { st = null; }
  const stages = (st && st.stages) || {};
  if ((stages.animate || {}).status === 'approved') return null; // Live Motion made, or skipped: nothing more to draw
  if ((stages.storyboard || {}).skipped) return null; // no board plans it
  let pieces = 0;
  try { const board = require('../storyboard'); pieces = board.price(null, board.read(dir), {}).crew.pieces; } catch { pieces = 0; }
  return pieces > 0 ? NEEDS_HF : null;
}

async function start(c, dir) {
  const why = needsTools(c, dir) || (typeof c.flow.jazzRefusal === 'function' ? c.flow.jazzRefusal(dir) : null);
  if (why) throw new Error(why);
  const job = typeof c.startJob === 'function' ? c.startJob('Let FLPT play jazz') : null;
  const p = c.flow.playThrough(dir, { liveMotion: liveMotionOf(c), notify: notifierOf(c), onLine: job ? job.onLine : () => {}, signal: job ? job.signal : undefined });
  const done = (r) => { if (job) job.finish({ code: r && r.ok ? 0 : 1 }); changed(c, dir); };
  if (!jazzExt.playingOf(dir)) {
    try { await p; } catch (e) { done(null); throw e; }
  }
  p.then(done, (e) => { done(null); try { c.send('jazz:changed', { dir, error: String(e && e.message ? e.message : e).slice(0, 300) }); } catch { /* no window */ } });
  changed(c, dir);
  return c.flow.jazzView(dir);
}

const capsOf = (c) => storyboard.capsFor({ caps: typeof c.caps === 'function' ? c.caps() : null, vault: c.vault, settings: c.settings });

module.exports = {
  ns: 'jazz',
  methods: {
    view: { args: ['episode'], handler: (c, dir) => c.flow.jazzView(dirOf(c, dir)) },
    approve: { args: ['episode'], handler: async (c, dir) => {
      const d = dirOf(c, dir);
      const tools = needsTools(c, d);
      if (tools) throw new Error(tools); // nothing approved, nothing spent
      const r = await c.flow.approveStoryboard(d, 'jazz');
      if (!r.ok) return { ok: false, cancelled: true };
      try { c.send('storyboard:changed', { dir: d }); } catch { /* no window */ }
      let jazz = c.flow.jazzView(d);
      if (jazz.canPlay) jazz = await start(c, d);
      return { ok: true, usd: r.usd, view: storyboard.viewFor(episode, d, capsOf(c)), jazz };
    } },
    play: { args: ['episode'], handler: (c, dir) => start(c, dirOf(c, dir)) },
    stop: { args: ['episode'], handler: (c, dir) => {
      const d = dirOf(c, dir);
      c.flow.stopJazz(d);
      changed(c, d);
      return c.flow.jazzView(d);
    } },
    everyStep: { args: ['episode'], handler: (c, dir) => {
      const d = dirOf(c, dir);
      const v = c.flow.jazzEveryStep(d);
      changed(c, d);
      try { c.send('storyboard:changed', { dir: d }); } catch { /* no window */ }
      return v;
    } },
    through: { args: ['episode', 'text:16'], handler: (c, dir, which) => {
      const d = dirOf(c, dir);
      const v = c.flow.setJazzThrough(d, which);
      changed(c, d);
      return v;
    } },
    upgrade: { args: ['episode', 'id:8'], handler: (c, dir, shot) => {
      const d = dirOf(c, dir);
      const r = c.flow.upgrade(d, shot);
      changed(c, d);
      try { c.send('storyboard:changed', { dir: d }); c.send('scenes:changed', { dir: d, key: r.key || null, error: null }); } catch { /* no window */ }
      return r;
    } },
  },
  events: ['jazz:changed'],
  notifierOf, liveMotionOf,
};
