'use strict';
// Flow extensions (PLAN §2.2, seam 3). Every other .js file in this folder is one extension:
//
//   module.exports = { id: 'storyboard', order: 20, hooks: { planning(ctx, { dir, phase }) { … }, … } };
//
// and createFlow (flow.js) calls its hooks at fixed points, the extensions in `order` (then by id), so later waves add
// behaviour here instead of editing flow.js. Every hook gets ctx = { d, episode, modules, motion, broker, send, confirm,
// log } and one object of arguments:
//
//   stageVars(ctx, { dir, stageId, vars }) → vars            a crew stage's prompt placeholders              sync
//   open(ctx, { dir, view }) → view                          what the page gets for an episode               sync
//   planning(ctx, { dir, phase }) → { lines: [{ label, usd }] }   more for the Claude planning cap; phase 'first'
//                                                            (the first approval) or 'topup' (the plan as it is now)
//   settle(ctx, { dir, st }) → st                            the record, each time the flow reads it         sync
//   approved(ctx, { dir, stageId, by })                      a stage was approved (by 'you' or 'jazz')       sync
//                                                            through flow.approve or Spend. Animate and Scenes
//                                                            approve themselves when there's nothing to do there
//                                                            (episode.read); that isn't announced: read approvedBy
//                                                            on the record (settle) to see it
//   spendBlocked(ctx, { dir }) → string | null               why Spend can't be approved yet                 sync
//   estimate(ctx, { dir, est }) → est                        the filming estimate, before it's shown or authorized
//   afterRender(ctx, { dir, which, rendered, onLine }) → { mix, scenes, problems }   after a run's moving slides
//   afterDraft(ctx, { dir })                                 the free draft is made
//   afterFilm(ctx, { dir, onLine })                          the film is made (onLine: the job's log)
//   refinePlan(ctx, { dir, plan }) → plan                    what Refine applies: plan.addons. plan.tighten (the
//                                                            episode's tightening) is for reading only: its Scribe
//                                                            price is asked before, so a changed one is ignored
//   deliver(ctx, { dir, extras }) → extras                   the extras Deliver levels and hands over
//   caps(ctx, caps) → caps                                   what this surface can do (flpt.app.caps)        sync
//
// A transforming hook that returns nothing keeps the value. A hook that throws (or answers a sync hook with a Promise,
// or with the wrong kind of value) raises a HookError naming the extension and the hook: the stage it ran in ends as an
// error, never stuck "running", and an approval it fails is undone. Amounts in `planning` lines are worked out here, in
// main, never taken from the page (T12).
const fs = require('fs');
const path = require('path');

const HOOKS = Object.freeze({
  stageVars: { sync: true, value: 'vars' },
  open: { sync: true, value: 'view' },
  planning: { sync: false },
  settle: { sync: true, value: 'st' },
  approved: { sync: true },
  spendBlocked: { sync: true },
  estimate: { sync: false, value: 'est' },
  afterRender: { sync: false },
  afterDraft: { sync: false },
  afterFilm: { sync: false },
  refinePlan: { sync: false, value: 'plan' },
  deliver: { sync: false, value: 'extras', array: true },
  caps: { sync: true, value: 'caps', direct: true },
});
const ID = /^[a-z][a-z0-9-]{0,39}$/;
const DEFAULT_ORDER = 100;

/** A hook that failed: which extension, which hook, and why (in its message). */
class HookError extends Error {
  constructor(ext, hook, cause) {
    const why = cause && cause.message ? cause.message : String(cause);
    super(`${why} (${ext}.${hook})`);
    this.name = 'HookError';
    this.ext = ext;
    this.hook = hook;
    this.cause = cause;
  }
}

const isPlain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** An extension as given: { id, order, hooks }, checked (an unknown hook name is a typo, refused). Throws why not. */
function check(x) {
  if (!isPlain(x)) throw new Error('exports no { id, order, hooks }');
  if (typeof x.id !== 'string' || !ID.test(x.id)) throw new Error('its id isn\'t a short lower-case name');
  const order = x.order == null ? DEFAULT_ORDER : Number(x.order);
  if (!Number.isFinite(order)) throw new Error(`${x.id}: its order isn't a number`);
  if (!isPlain(x.hooks)) throw new Error(`${x.id}: it has no hooks`);
  for (const [name, fn] of Object.entries(x.hooks)) {
    if (!Object.prototype.hasOwnProperty.call(HOOKS, name)) throw new Error(`${x.id}: there's no hook called "${name}"`);
    if (typeof fn !== 'function') throw new Error(`${x.id}: its ${name} hook isn't a function`);
  }
  return { id: x.id, order, hooks: { ...x.hooks } };
}

/** Extensions in calling order: by `order`, then by id. Duplicated ids keep the first. */
function arrange(list) {
  const seen = new Set();
  return list.filter((e) => (seen.has(e.id) ? false : seen.add(e.id))).sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The extensions in a folder (this one by default): every .js file but this one, in name order, each checked. One
 * that won't load is left out, and said in `problems`, so the app still starts.
 */
function load(dir = __dirname) {
  const problems = [];
  const found = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'index.js').sort(); } catch { return { extensions: [], problems }; }
  for (const f of files) {
    try {
      const e = check(require(path.join(dir, f)));
      if (found.some((x) => x.id === e.id)) throw new Error(`${e.id}: another extension has that id`);
      found.push({ ...e, file: f });
    } catch (err) {
      problems.push(`${f}: ${err && err.message ? err.message : err}`);
    }
  }
  return { extensions: arrange(found), problems };
}

/** Check a list given in code (tests, a host): the same rules as load(). */
function from(list) {
  const problems = [];
  const ok = [];
  for (const x of Array.isArray(list) ? list : []) {
    try {
      const e = check(x);
      if (ok.some((y) => y.id === e.id)) throw new Error(`${e.id}: another extension has that id`);
      ok.push(e);
    } catch (err) { problems.push(err && err.message ? err.message : String(err)); }
  }
  return { extensions: arrange(ok), problems };
}

/**
 * The hook runner the flow uses: each method calls one hook on every extension that has it, in order, with `ctx`.
 *   transformSync / transform (name, value, args)   each may replace the value (returning nothing keeps it)
 *   collect (name, args)                            every answer that isn't empty, in order
 *   firstSync (name, args)                          the first non-empty string (spendBlocked)
 *   notifySync / notify (name, args)                tell each one
 */
function createHooks(extensions, ctx) {
  const exts = arrange(extensions || []);
  const having = (name) => exts.filter((e) => typeof e.hooks[name] === 'function');
  const spec = (name) => {
    if (!Object.prototype.hasOwnProperty.call(HOOKS, name)) throw new Error(`No hook called "${name}".`);
    return HOOKS[name];
  };
  const call = (e, name, arg) => { try { return e.hooks[name](ctx, arg); } catch (err) { throw new HookError(e.id, name, err); } };
  const now = (e, name, r) => {
    if (r && typeof r.then === 'function') {
      Promise.resolve(r).catch(() => {}); // it answered late: nothing waits for it
      throw new HookError(e.id, name, new Error('it must answer at once, not with a Promise'));
    }
    return r;
  };
  const later = async (e, name, r) => { try { return await r; } catch (err) { throw new HookError(e.id, name, err); } };
  const argFor = (name, value, args) => (spec(name).direct ? value : { ...args, [spec(name).value]: value });
  const keep = (e, name, r, value) => {
    if (r === undefined) return value;
    const s = spec(name);
    if (s.array ? !Array.isArray(r) : !isPlain(r)) throw new HookError(e.id, name, new Error(`it must answer with ${s.array ? 'a list' : 'an object'}`));
    return r;
  };
  return {
    has: (name) => having(name).length > 0,
    list: () => exts.map((e) => ({ id: e.id, order: e.order, hooks: Object.keys(e.hooks) })),
    transformSync(name, value, args = {}) {
      let v = value;
      for (const e of having(name)) v = keep(e, name, now(e, name, call(e, name, argFor(name, v, args))), v);
      return v;
    },
    async transform(name, value, args = {}) {
      let v = value;
      for (const e of having(name)) v = keep(e, name, await later(e, name, call(e, name, argFor(name, v, args))), v);
      return v;
    },
    async collect(name, args = {}) {
      spec(name);
      const out = [];
      for (const e of having(name)) {
        const r = await later(e, name, call(e, name, { ...args }));
        if (r != null) out.push({ ext: e.id, value: r });
      }
      return out;
    },
    firstSync(name, args = {}) {
      spec(name);
      for (const e of having(name)) {
        const r = now(e, name, call(e, name, { ...args }));
        if (r == null) continue;
        if (typeof r !== 'string') throw new HookError(e.id, name, new Error('it must answer with words or nothing'));
        const s = r.trim();
        if (!s) continue; // a blank answer is no answer: the next extension is asked
        return s.slice(0, 400);
      }
      return null;
    },
    notifySync(name, args = {}) {
      spec(name);
      for (const e of having(name)) now(e, name, call(e, name, { ...args }));
    },
    async notify(name, args = {}) {
      spec(name);
      for (const e of having(name)) await later(e, name, call(e, name, { ...args }));
    },
  };
}

module.exports = { load, from, check, createHooks, HookError, HOOKS: Object.keys(HOOKS) };
