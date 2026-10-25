'use strict';
// flpt.covers (W3-04, PLAN §3.3 S2): Episodes home's covers. The page names nothing but an episode; the files are
// worked out here (covers.js), and only the paths flpt:// serves (inside the projects folder) go back.
//   list()          [{ dir, png, pngAt, loop, loopAt, family }] for every episode the list shows; any loop that's missing or
//                   out of date is then cut in the background, one at a time (free: ffmpeg), each announced
//   make(episode)   cut that episode's loop now (when it's missing or out of date) → { dir, png, loop, made, problem }
// Event: covers:changed { dir } when a loop lands. Nothing here spends.
const path = require('path');
const episode = require('../episode');
const covers = require('../covers');

/** The episode folder, checked: inside the projects folder, with a record this FLPT can read. */
function dirOf(c, dir) {
  if (!c.flow || !c.flow.inProjects(dir)) throw new Error('That isn\'t an FLPT episode folder.');
  const d = path.resolve(dir);
  const why = episode.tooNew(episode.readRaw(d));
  if (why) throw new Error(why);
  return d;
}

const deps = (c) => ({ ffmpeg: typeof c.ffmpegRun === 'function' ? (args) => c.ffmpegRun(args) : null, probe: typeof c.probe === 'function' ? (f) => c.probe(f) : null });
const shape = (dir, cv, extra = {}) => ({ dir, png: cv.png, pngAt: cv.pngAt, loop: cv.loop, loopAt: cv.loopAt, family: cv.family || null, ...extra });
/** A run or a scene crew writing in the episode (flow.upgrade asks both): its cover waits. */
function busy(c, dir) {
  if (typeof c.flow.isBusy === 'function' && c.flow.isBusy(dir)) return true;
  try { return Boolean(require('../scenecrew').isBusy(dir)); } catch { return false; }
}

// One cut per episode at a time, whoever asks (make, or the background queue): a second ask waits for the first.
const cutting = new Map(); // episode → the cut under way
function cut(c, dir) {
  if (!cutting.has(dir)) {
    const p = Promise.resolve().then(() => covers.make(dir, deps(c))).catch(() => null).finally(() => cutting.delete(dir));
    cutting.set(dir, p);
  }
  return cutting.get(dir);
}

// the background queue: one cut at a time; a source that failed isn't tried again until it changes (a missing ffmpeg
// isn't a failure of the source: it's tried again once the tools are there)
const queue = [];
const tried = new Map(); // episode → the source key last tried
let working = false;
const keyOf = (src) => (src ? `${src.file}\n${src.size}\n${src.mtimeMs}` : '');
async function drain(c) {
  if (working) return;
  working = true;
  try {
    while (queue.length) {
      const dir = queue.shift();
      if (busy(c, dir)) { tried.delete(dir); continue; } // a run is writing there: next time
      const r = await cut(c, dir);
      if (r && r.problem === covers.NO_FFMPEG) tried.delete(dir);
      if (r && r.made) { try { c.send('covers:changed', { dir }); } catch { /* no window */ } }
    }
  } finally { working = false; }
}

module.exports = {
  ns: 'covers',
  methods: {
    list: { args: [], handler: (c) => {
      const out = [];
      const canCut = Boolean(deps(c).ffmpeg);
      for (const x of c.flow.list()) {
        if (x.tooNew) { out.push({ dir: x.dir, png: null, pngAt: null, loop: null, loopAt: null }); continue; }
        const cv = covers.coverOf(x.dir);
        out.push(shape(x.dir, cv));
        const k = keyOf(cv.source);
        if (canCut && cv.stale && tried.get(x.dir) !== k && !queue.includes(x.dir)) { tried.set(x.dir, k); queue.push(x.dir); }
      }
      if (queue.length) setTimeout(() => drain(c), 0);
      return out;
    } },
    make: { args: ['episode'], handler: async (c, dir) => {
      const d = dirOf(c, dir);
      if (busy(c, d)) throw new Error('Something is running for this episode.');
      const r = (await cut(c, d)) || { made: false, problem: 'ffmpeg couldn\'t cut the cover.' };
      if (r.made) { try { c.send('covers:changed', { dir: d }); } catch { /* no window */ } }
      return shape(d, covers.coverOf(d), { made: r.made, problem: r.problem });
    } },
  },
  events: ['covers:changed'],
};
