'use strict';
// flpt.likeness (W3-10): "Cartoon you", S16 (PLAN §2.12, §3.3), in the Mac app only (DV12; caps.likeness from
// ext/likeness.js). The page names nothing but plates and parts by key; main does the work (likeness.js), prices every
// paid step and asks in its own native dialog (generate.js: makeLikeness), and the free work runs sandboxed.
//   state()            the one being made (or null) as the page sees it: photos, plates, the pick, parts, the clip, prices
//   start()            a new one, if none is being made
//   pickPhotos()       the native picker (pictures) · dropPhotos(files): dropped on the sheet · removePhoto(i)
//   attest(bool)       ⚑ "These are photos of me."
//   style(id)          the style the plates are drawn in
//   draw(step)         'plates' (Draw four) or 'again' (one more): the price asked in the dialog → { cancelled } | view
//   pick(key, eyes?)   a plate, reframed and checked (free); eyes: the person's box round its eyes, when it needs one
//   meet(mouths)       Meet your cartoon: 'painted' | 'drawn' (the parts still missing, priced in the dialog; free when
//                      every part is made already)
//   mouths(which)      Drawn (free) · Painted (the mouths step, priced, when they aren't all made yet)
//   adjust(json)       { eyes?: [x, y, w, h], mouth?: [x, y, w, h] } in the plate's pixels: patches cut again, rig rebuilt
//   keep()             the rig into Presenters/<id>/ and picked as the presenter (its paired voice when it's on offer)
//   startOver()        this one set aside (never mid-step); the sheet starts empty
// Events: likeness:changed (flpt.likeness.onChanged) whenever the record moves (a picture lands, the clip is made).
const path = require('path');
const L = require('../likeness');
const presenter = require('../presenter');
const extLikeness = require('../ext/likeness');

// the app's own version, for the consent record (as agents.js reads it: app/package.json, or the plugin copy's own)
const APP_VERSION = (() => { try { return String(require('../../../package.json').version || ''); } catch { return ''; } })();
const presDir = (c) => L.presentersDir(c.settings.read());
const toolOpts = (c) => ({ engineRoot: c.engineRoot, toolEnv: c.toolEnv, hidden: c.appPrivate ? c.appPrivate() : [] });
/** The tools found (Node.js for the sandboxed free work), before anything runs it. */
async function tools(c) { if (!c.lastDetect && c.detectTools) await c.detectTools(); return toolOpts(c); }
const tell = (c, dir) => { try { c.send('likeness:changed', { id: path.basename(dir) }); } catch { /* no window */ } };
const said = (c, e) => { const m = String((e && e.message) || e); return c.redact ? c.redact(m) : m; };

/** Whether this surface makes cartoons: exactly ext/likeness.js's caps (the Mac, its native dialog and its sandbox). */
function available(c) {
  const base = c.caps ? c.caps() : null;
  return extLikeness.hooks.caps(null, base && typeof base === 'object' ? { ...base } : {}).likeness === true;
}
/** Everything here refuses elsewhere (the web never sees a face; DV12). */
function guard(c) { if (!available(c)) throw new Error('Cartoon you is made in the Mac app.'); }
function currentDir(c) {
  const dir = L.current(presDir(c));
  if (!dir) throw new Error('Start a cartoon first.');
  return dir;
}
/** The one being made, or a new one (its folder is made with the first photo, the ⚑ or a style). */
const dirOrNew = (c) => L.current(presDir(c)) || L.create(presDir(c));
const viewOf = (c, dir) => {
  const g = c.getGenerator ? c.getGenerator() : null;
  return L.view(dir, { fileUrl: c.fileUrl, engineRoot: c.engineRoot, waiting: g ? g.likenessPending(dir) : 0 });
};
/** A budget no longer needed: closed once nothing of it is on its way (the generator's own rule when it's there). */
function release(c, gen, token) {
  if (!token) return;
  if (gen) gen.releaseLikeness(token);
  else if (c.broker && c.broker.isLive(token, 'kie')) c.broker.close(token);
}

// ── the free work after each landing, one at a time per presenter ───────────────────────────────────────────────
const queues = new Map(); // dir → the promise of the work under way
const problems = new Map(); // dir → what last went wrong in it (shown once)
const fails = new Map(); // dir → { n, until }: free passes that failed in a row, and when the next may run
const TRIES = 3;

/** Whether the record has free work waiting: plates to measure, parts to check, a step to see through. */
function due(rec) {
  if (!rec || rec.status === 'kept' || rec.status === 'discarded') return false;
  if (rec.stalled && Date.now() - Date.parse(rec.stalled.at) < 120000) return false; // given up: tried again on a later look
  return rec.plates.some((k) => !rec.measured[k]) || Boolean(rec.dirty) || L.pending(rec).length > 0 || Boolean(L.activeStep(rec));
}

function advance(c, dir) {
  const f = fails.get(dir);
  if (f && Date.now() < f.until) return queues.get(dir) || Promise.resolve(); // backing off after a failed pass
  const run = (queues.get(dir) || Promise.resolve()).then(() => step(c, dir)).then(() => { fails.delete(dir); }, (e) => {
    const msg = said(c, e);
    const n = (fails.get(dir) ? fails.get(dir).n : 0) + 1;
    if (n >= TRIES) { giveUp(c, dir, msg); fails.delete(dir); problems.set(dir, msg); return; }
    fails.set(dir, { n, until: Date.now() + (c.likenessRetryMs != null ? c.likenessRetryMs : 4000) * n }); // 4 s, then 8 s: not a sandboxed run on every poll
    if (n === 1) problems.set(dir, msg);
  }).finally(() => tell(c, dir));
  queues.set(dir, run);
  return run;
}

/**
 * A free pass that kept failing: the step's reserve let go (its token closed), the cartoon back where it can be asked
 * for again (ready with its last rig, else picked: Meet your cartoon then puts it together again, free when every part
 * is made), and no more tries until the person does something.
 */
function giveUp(c, dir, msg) {
  const gen = c.getGenerator ? c.getGenerator() : null;
  try {
    const rec = L.read(dir);
    if (!rec) return;
    const active = L.activeStep(rec);
    if (active) { L.closeStep(dir, active.s.token); release(c, gen, active.s.token); }
    L.update(dir, (x) => {
      x.dirty = false;
      if (x.status === 'parts') x.status = x.rig ? 'ready' : 'picked';
      x.stalled = { at: new Date().toISOString(), why: msg };
    });
  } catch { /* the folder is gone */ }
}

async function step(c, dir) {
  await tools(c);
  const gen = c.getGenerator ? c.getGenerator() : null;
  let rec = L.read(dir);
  if (!rec || rec.status === 'kept' || rec.status === 'discarded') return;
  if (gen && gen.likenessPending(dir)) return; // still landing: this runs again when they're all in
  // a job the record has as starting or working that no one holds (a quit before Kie.ai answered): it may be billed;
  // its budget closes (unless a job of it is still on its way)
  const orphans = L.pending(rec);
  for (const j of orphans) L.jobLanded(dir, j.key, { status: 'unknown', error: 'It may or may not have started.' });
  for (const t of new Set(orphans.map((j) => j.token))) release(c, gen, t);
  rec = L.read(dir);
  if (rec.plates.some((k) => !rec.measured[k])) rec = await L.measurePlates(dir, toolOpts(c));
  const active = L.activeStep(rec);
  if (!active && !rec.dirty) return;
  let checked = false;
  if (active) {
    // the step's own jobs are all in: if some never started (no credits, no connection) or none made anything, it's
    // taken back, keeping what was made, so Meet your cartoon (or Painted) asks again for what's missing
    const { made, notStarted } = L.stepOutcome(rec, active.s);
    if (notStarted.length || made === 0) {
      const why = (Object.values(rec.jobs).find((j) => j.token === active.s.token && (j.status === 'failed' || j.status === 'unknown') && j.error) || {}).error;
      L.closeStep(dir, active.s.token);
      release(c, gen, active.s.token);
      L.stepUndone(dir, active.name, active.s.token);
      problems.set(dir, why ? said(c, why) : 'Not every part of your cartoon was made.');
      return;
    }
    if (rec.dirty) { await L.checkParts(dir, toolOpts(c)); checked = true; }
    const want = gen && c.broker && c.broker.isLive(active.s.token, 'kie') ? L.rerollsWanted(dir, c.engineRoot) : [];
    if (want.length) {
      try {
        const r = await gen.likenessReroll({ dir, token: active.s.token, items: want, engineRoot: c.engineRoot });
        tell(c, dir);
        await r.wait();
      } catch (e) { // the reserve couldn't be used: let go of it and put the cartoon together from what passed
        problems.set(dir, said(c, e));
        L.closeStep(dir, active.s.token);
        release(c, gen, active.s.token);
      }
      return step(c, dir);
    }
    L.closeStep(dir, active.s.token);
    release(c, gen, active.s.token);
  }
  rec = L.read(dir);
  if (!checked && (rec.dirty || !rec.checks)) await L.checkParts(dir, toolOpts(c));
  const s = c.settings.read().presenter || {};
  await L.build(dir, { ...toolOpts(c), sayVoice: s.voice && s.voice.provider === 'say' ? s.voice.id : '' });
  L.update(dir, (x) => { x.dirty = false; });
}

/** Mark the parts as needing their checks and rig again, then do it in the background. */
function rework(c, dir) { fails.delete(dir); L.update(dir, (x) => { x.dirty = true; delete x.stalled; }); advance(c, dir); }

/** A paid step: the dialog (main's price), then the jobs land in the background and the free work follows. */
async function paid(c, dir, step, mouths = null) {
  const gen = c.getGenerator ? c.getGenerator() : null;
  if (!gen) throw new Error('Not ready yet.');
  fails.delete(dir);
  const r = await gen.makeLikeness({ dir, step, mouths, engineRoot: c.engineRoot });
  if (r.cancelled) return { cancelled: true, view: viewOf(c, dir) };
  if (r.free) { L.meetAgain(dir, mouths); fails.delete(dir); advance(c, dir); return { started: 0, failed: [], view: viewOf(c, dir) }; }
  tell(c, dir);
  r.wait().then(() => { if (step === 'parts' || step === 'mouths') L.update(dir, (x) => { x.dirty = true; }); return advance(c, dir); });
  return { started: r.started, failed: r.failed, view: viewOf(c, dir) };
}

module.exports = {
  ns: 'likeness',
  methods: {
    state: { args: [], handler: (c) => {
      if (!available(c)) return { available: false, view: null };
      const dir = L.current(presDir(c));
      if (dir && due(L.read(dir))) advance(c, dir);
      const problem = dir ? problems.get(dir) || null : null;
      if (dir) problems.delete(dir);
      return { available: true, view: dir ? viewOf(c, dir) : null, problem };
    } },
    start: { args: [], handler: (c) => { guard(c); return viewOf(c, L.current(presDir(c)) || L.create(presDir(c))); } },
    pickPhotos: { args: [], handler: async (c) => {
      guard(c);
      const r = await c.dialogs.open({ title: 'Photos', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Photos', extensions: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'] }] });
      const had = L.current(presDir(c));
      if (r.canceled || !r.filePaths.length) return had ? viewOf(c, had) : null;
      const dir = dirOrNew(c);
      await L.addPhotos(dir, r.filePaths, await tools(c));
      return viewOf(c, dir);
    } },
    dropPhotos: { args: ['dropped'], handler: async (c, files) => { guard(c); const dir = dirOrNew(c); await L.addPhotos(dir, files, await tools(c)); return viewOf(c, dir); } },
    removePhoto: { args: ['num'], handler: (c, i) => { guard(c); const dir = currentDir(c); L.removePhoto(dir, Math.trunc(i)); return viewOf(c, dir); } },
    attest: { args: ['bool'], handler: (c, yes) => { guard(c); const dir = dirOrNew(c); L.attest(dir, yes, APP_VERSION); return viewOf(c, dir); } },
    style: { args: ['id'], handler: (c, id) => { guard(c); const dir = dirOrNew(c); L.setStyle(dir, id, c.engineRoot); return viewOf(c, dir); } },
    draw: { args: ['id:16'], handler: (c, step) => { guard(c); if (!['plates', 'again'].includes(step)) throw new Error('That isn\'t a step FLPT knows.'); return paid(c, currentDir(c), step); } },
    pick: { args: ['id:16', 'json:256?'], handler: async (c, key, eyes) => {
      guard(c);
      const dir = currentDir(c);
      fails.delete(dir);
      await L.pick(dir, key, await tools(c), { eyes: eyes == null ? null : eyes });
      return viewOf(c, dir);
    } },
    meet: { args: ['id:16'], handler: (c, mouths) => { guard(c); return paid(c, currentDir(c), 'parts', mouths === 'drawn' ? 'drawn' : 'painted'); } },
    mouths: { args: ['id:16'], handler: async (c, which) => {
      guard(c);
      const dir = currentDir(c);
      const v = viewOf(c, dir);
      if (which === 'painted' && !v.paintedMade) return paid(c, dir, 'mouths');
      L.setMouths(dir, which === 'painted' ? 'painted' : 'drawn');
      rework(c, dir);
      return { view: viewOf(c, dir) };
    } },
    adjust: { args: ['json:1024'], handler: (c, rects) => { guard(c); const dir = currentDir(c); L.setRects(dir, rects); rework(c, dir); return viewOf(c, dir); } },
    keep: { args: [], handler: (c) => {
      guard(c);
      const dir = currentDir(c);
      const rec = L.keep(dir, { engineRoot: c.engineRoot });
      // picked as the presenter: its paired voice when Spend can approve that provider, else the cartoon's voice as it was
      const now = c.settings.read().presenter || {};
      const pair = rec.pairing && presenter.offered().includes(rec.pairing.provider) ? { provider: rec.pairing.provider, id: '', name: rec.pairing.name || '' } : null;
      const was = presenter.cleanVoice(now.voice);
      const voice = pair || (was && presenter.offered().includes(was.provider) ? was : { provider: 'say', id: '', name: '' });
      c.settings.write({ presenter: { ...now, kind: 'cartoon', rig: rec.id, voice } });
      tell(c, dir);
      return { id: rec.id, name: rec.name, state: c.state() };
    } },
    startOver: { args: [], handler: (c) => {
      guard(c);
      const dir = L.current(presDir(c));
      if (!dir) return null;
      const g = c.getGenerator ? c.getGenerator() : null;
      if (g && g.likenessPending(dir)) throw new Error('Your cartoon is on its way.');
      L.discard(dir);
      fails.delete(dir);
      problems.delete(dir);
      tell(c, dir);
      return null;
    } },
  },
  events: ['likeness:changed'],
};
