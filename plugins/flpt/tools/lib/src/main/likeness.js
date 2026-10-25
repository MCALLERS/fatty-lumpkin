'use strict';
// "Cartoon you" (PLAN §2.12, §3.3 S16; W3-10): the user's own cartoon presenter, made from their photos in the Mac app
// only (DV12), after G3's calibration (decisions.md: plate 3, 8/8 mouth patches). Electron-free; the paid steps are
// generate.js's (the broker and the native dialog), the screen is ui-likeness.js, the API api/likeness.js.
//
// Everything lives in the presenter's own folder, <projects>/Presenters/<id>/, and never leaves this Mac except what
// a paid step sends Kie.ai (its dialog says so): photos/ (the user's, re-made as plain PNGs: upright, no EXIF or GPS,
// at most 1600 px; these are what Draw four uploads), work/ (each picture as it lands, the
// picked plate, patches/, rig/<id>/ while it's being made), meet/ (the test clip), likeness.json (this record), and
// once kept, the rig itself (rig.json and its layers) beside them, which is what presenter.rigs() lists.
//
//   photos + ⚑ "These are photos of me." (consent: { self, at, appVersion }, into rig.json's provenance)
//   → Draw four (4 plates, Nano Banana Pro) · Again (one more) → pick one (reframed and checked, free)
//   → Meet your cartoon (cut-out, eyes ×2, and with Painted mouths A–H; a reserve of two re-rolls, used only where a
//     check failed and a re-roll can change the outcome) → the free checks (likeness/patches.js) → the decision rule
//     (likeness/decide.js) → the rig (likeness/build.js) → the test clip (presenter.sampleClip, the Mac's voice)
//   → Adjust (the eye and mouth boxes, free) · Mouths: Drawn (free) or Painted (paid, if not made) → Keep.
// A step that starts nothing undoes itself (generate.js: stepUndone), and one whose parts didn't all start goes back
// to where it was, keeping what was made: Meet your cartoon then makes only what's missing, behind a new dialog.
// The free work (checks, rig, clip) runs in a Node process of its own inside macOS's sandbox: no network, no key,
// writing only this folder (runTool), as the cartoon presenter's own pass does.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const sandbox = require('./sandbox');
const presenter = require('./presenter');
const { estimate, RATES } = require('./broker');

const SCHEMA = 'flpt.likeness/1';
const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const PHOTO = /\.(png|jpe?g|webp|heic|heif)$/i;
const MAX_PHOTOS = 5;
const SHAPES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const RESERVE = 2; // re-rolls a parts or mouths step may use, only where a check failed
const STILL = 'kie_still';
const CUTOUT = 'kie_cutout';
const PHOTO_SIDE = 1600; // the photos' longest side as kept and uploaded (plenty for a face; Nano Banana Pro draws at 2K)
// the test clip's line (draft-ux §9.3: about 6 s, every mouth shape, and a blink or two on the way; measured in the
// Mac's default voice: 6.9 s with its padding, mouths A–H and X, two blinks)
const TEST_LINE = 'Hello! I\'m you, as a cartoon. Big laugh, bit of fun, oh well: every word on cue.';

const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const readJson = (p, fb = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } };
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** <projects>/Presenters for these settings. */
const presentersDir = (settings) => path.join(settings.projectsDir, 'Presenters');
const likenessRoot = (engineRoot) => path.join(engineRoot, 'runtime', 'flpt-live', 'presenter', 'likeness');
const adaDir = (engineRoot) => path.join(engineRoot, 'runtime', 'flpt-live', 'presenter', 'rigs', 'stock-ada');

// ── the record ──────────────────────────────────────────────────────────────────────────────────────────────────
const recFile = (dir) => path.join(dir, 'likeness.json');
function read(dir) {
  const r = readJson(recFile(dir));
  return r && r.schema === SCHEMA && ID.test(String(r.id)) ? r : null;
}
function write(dir, rec) {
  const tmp = `${recFile(dir)}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(rec, null, 1)}\n`);
  fs.renameSync(tmp, recFile(dir));
  return rec;
}
/** Change the record under a function (read, change, write). */
function update(dir, fn) {
  const rec = read(dir);
  if (!rec) throw new Error('That cartoon isn\'t there any more.');
  const out = fn(rec) || rec;
  out.updatedAt = new Date().toISOString();
  return write(dir, out);
}

/** The likenesses in a presenters folder, newest first: [{ id, dir, status, updatedAt }]. */
function list(presDir) {
  let names = [];
  try { names = fs.readdirSync(presDir).filter((n) => ID.test(n)); } catch { return []; }
  return names.map((n) => ({ dir: path.join(presDir, n), rec: read(path.join(presDir, n)) })).filter((x) => x.rec)
    .map(({ dir, rec }) => ({ id: rec.id, dir, status: rec.status, updatedAt: rec.updatedAt || rec.createdAt || '' }))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

/** The one being made (not kept, not set aside by Start over), newest, or null. */
function current(presDir) { const x = list(presDir).find((r) => r.status !== 'kept' && r.status !== 'discarded'); return x ? x.dir : null; }

/** A new likeness: its folder and record. → its folder. */
function create(presDir, { name = null } = {}) {
  fs.mkdirSync(presDir, { recursive: true });
  let id;
  do id = `you-${crypto.randomBytes(3).toString('hex')}`; while (exists(path.join(presDir, id)));
  const dir = path.join(presDir, id);
  for (const sub of ['photos', 'work', 'meet']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  const kept = list(presDir).filter((r) => r.status === 'kept').length;
  const now = new Date().toISOString();
  write(dir, { schema: SCHEMA, id, name: name || (kept ? `Cartoon you ${kept + 1}` : 'Cartoon you'), status: 'photos', createdAt: now, updatedAt: now,
    consent: null, style: 'flat', photos: [], jobs: {}, plates: [], measured: {}, picked: null, steps: {}, mouths: null, checks: null, rects: { eyes: null, mouth: null },
    decision: null, rig: null, meet: null, pairing: null });
  return dir;
}

/**
 * The styles a plate can be drawn in: likeness-styles/<id>/style.json beside this file (its prompts, and Ada's reference
 * drawings the paid steps send: the plate format and the mouth shapes). In the app only, packaged with it: the plugin
 * and the web have no Cartoon you (DV12), and the plugin ships no pictures.
 */
const STYLES = path.join(__dirname, 'likeness-styles');
function styles() {
  const root = STYLES;
  let names = [];
  try { names = fs.readdirSync(root).sort(); } catch { return []; }
  return names.map((n) => ({ dir: path.join(root, n), s: readJson(path.join(root, n, 'style.json')) })).filter((x) => x.s && x.s.id === path.basename(x.dir))
    .map(({ dir, s }) => ({ ...s, dir }));
}
const styleOf = (engineRoot, id) => styles().find((s) => s.id === id) || styles()[0] || null;
const posters = new Map(); // style picture → its data URL, read once
function posterOf(s) {
  const f = path.join(s.dir, s.format);
  if (!posters.has(f)) { try { posters.set(f, `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`); } catch { posters.set(f, null); } }
  return posters.get(f);
}

// ── photos and consent ──────────────────────────────────────────────────────────────────────────────────────────
/**
 * The user's photos in (up to five in all), each re-made by the sandboxed tool (photo.js) as photos/NN.png: decoded
 * (HEIC and WebP by the Mac's sips, inside the sandbox), turned upright, at most 1600 px a side, pixels only. Nothing
 * of the original's metadata is kept (GPS position, time, camera, owner), so nothing of it reaches Kie.ai's public
 * file host with Draw four. o: runTool's options. → the record.
 */
async function addPhotos(dir, files, o = {}) {
  const rec = read(dir);
  if (!rec) throw new Error('That cartoon isn\'t there any more.');
  if (rec.steps && rec.steps.plates) throw new Error('The plates are drawn from the photos already.');
  const list = (files || []).filter((f) => typeof f === 'string' && path.isAbsolute(f) && PHOTO.test(f));
  if (!list.length) throw new Error('Photos only (JPEG, PNG, WebP or HEIC).');
  const room = MAX_PHOTOS - rec.photos.length;
  if (room <= 0) throw new Error('Five photos is the most.');
  const todo = [];
  for (const f of list) {
    if (todo.length >= room) break;
    let st;
    try { st = fs.statSync(f); } catch { continue; }
    if (!st.isFile() || st.size > 60 << 20) continue;
    const taken = new Set([...rec.photos.map((p) => p.file), ...todo.map((t) => t.file)]);
    let n = rec.photos.length + todo.length + 1;
    while (taken.has(`photos/${String(n).padStart(2, '0')}.png`)) n++;
    const file = `photos/${String(n).padStart(2, '0')}.png`;
    todo.push({ src: f, dst: path.join(dir, file), file, name: path.basename(f).slice(0, 120) });
  }
  if (!todo.length) throw new Error('Those photos couldn\'t be read.');
  fs.mkdirSync(path.join(dir, 'photos'), { recursive: true });
  const r = await runTool({ cmd: 'photos', files: todo.map((t) => ({ src: t.src, dst: t.dst })), max: PHOTO_SIDE }, dir, o);
  if (!r.ok) throw new Error(r.problem || 'Those photos couldn\'t be read.');
  const added = todo.map((t, i) => ({ t, p: (r.photos || [])[i] })).filter(({ t, p }) => p && p.ok && exists(t.dst))
    .map(({ t, p }) => ({ file: t.file, name: t.name, w: p.w, h: p.h, bytes: p.bytes }));
  if (!added.length) throw new Error('Those photos couldn\'t be read.');
  return update(dir, (x) => { x.photos.push(...added); });
}

/** Take a photo out again (before the plates are drawn); its copy is removed from the presenter folder. */
function removePhoto(dir, i) {
  return update(dir, (r) => {
    if (r.steps && r.steps.plates) throw new Error('The plates are drawn from the photos already.');
    const p = r.photos[i];
    if (!p) return;
    fs.rmSync(path.join(dir, p.file), { force: true });
    r.photos.splice(i, 1);
  });
}

/** ⚑ "These are photos of me." The consent recorded (and later written into rig.json), or taken back before plates. */
function attest(dir, yes, appVersion) {
  return update(dir, (r) => {
    if (!yes && r.steps && r.steps.plates) throw new Error('The plates are drawn already.');
    r.consent = yes ? { self: true, at: new Date().toISOString(), appVersion: String(appVersion || '') } : null;
  });
}

function setStyle(dir, id, engineRoot) {
  if (!styles(engineRoot).some((s) => s.id === id)) throw new Error('That style isn\'t there.');
  return update(dir, (r) => { if (r.steps && r.steps.plates) throw new Error('The plates are drawn already.'); r.style = id; });
}

// ── the paid steps' plans (generate.js asks; the main process prices them, never the page) ─────────────────────────
const plateKeys = (rec) => Object.keys(rec.jobs).filter((k) => /^plate-\d+$/.test(k)).sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
const partKeys = (mouths) => ['cutout', 'eyes-closed', 'eyes-half', ...(mouths === 'painted' ? SHAPES.map((s) => `mouth-${s}`) : [])];
/** Whether a part (cutout, eyes-closed, mouth-D…) has a picture made, in any of its takes (mouth-D, mouth-D~1…). */
const hasMade = (rec, base) => Object.values(rec.jobs).some((j) => (j.key === base || j.key.startsWith(`${base}~`)) && j.status === 'made');
/** The parts a cartoon with these mouths still needs made (what Meet your cartoon, or Painted, would pay for now). */
const missingParts = (rec, mouths) => partKeys(mouths).filter((k) => !hasMade(rec, k));
/** Kie.ai's price for some jobs, as the broker estimates it (its own rates and rounding): US dollars. */
function priceOf(jobs) {
  const stills = jobs.filter((j) => (typeof j === 'string' ? j !== 'cutout' : j.kind === 'still')).length;
  const cut = jobs.length - stills;
  const lines = [...(stills ? [{ rate: STILL, qty: stills }] : []), ...(cut ? [{ rate: CUTOUT, qty: cut }] : [])];
  return lines.length ? estimate(lines).byProvider.kie.usd : 0;
}

/** Where a plan's job lands, and its line. */
function jobOf(key, kind, prompt, refs) {
  return { key, kind, prompt, refs, dest: `work/${key}.png`, label: kind === 'cutout' ? 'Cut-out' : key.replace(/^plate-/, 'Plate ').replace(/^eyes-/, 'Eyes ').replace(/^mouth-/, 'Mouth ') };
}

/**
 * What a paid step makes: { step, jobs: [{ key, kind: 'still'|'cutout', prompt, refs: [abs files], dest, label }],
 * lines (broker.estimate items, the reserve's last), plannedUsd, reserve, describe, message }. step: 'plates' (Draw
 * four), 'again' (one more plate), 'parts' (Meet your cartoon), 'mouths' (Painted, after Drawn), 'reroll' (items: the
 * reserve's [{ kind, base }], no dialog: on the step's own approval). Throws when the step can't be made now.
 */
function plan(dir, step, { engineRoot, mouths = null, items = null } = {}) {
  const rec = read(dir);
  if (!rec) throw new Error('That cartoon isn\'t there any more.');
  const style = styleOf(engineRoot, rec.style);
  if (!style) throw new Error('No style to draw in.');
  const S = (f) => path.join(style.dir, f);
  const jobs = [];
  let reserve = 0;
  if (step === 'plates' || step === 'again') {
    if (!rec.consent || rec.consent.self !== true) throw new Error('Only your own photos.');
    if (!rec.photos.length) throw new Error('Add a photo first.');
    if (step === 'plates' && plateKeys(rec).length) throw new Error('The plates are drawn already.');
    if (step === 'again' && !plateKeys(rec).length) throw new Error('Draw the plates first.');
    const photos = rec.photos.map((p) => path.join(dir, p.file));
    const n = photos.length;
    const prompt = style.prompts.plate.replaceAll('{photos}', n === 1 ? 'image 1' : `images 1-${n}`).replaceAll('{format}', `image ${n + 1}`);
    const start = plateKeys(rec).length;
    for (let i = 1; i <= (step === 'plates' ? 4 : 1); i++) jobs.push(jobOf(`plate-${start + i}`, 'still', prompt, [...photos, S(style.format)]));
  } else if (step === 'parts' || step === 'mouths') {
    if (!rec.picked || !rec.picked.ok) throw new Error('Pick a plate first.');
    if (pending(rec).length || activeStep(rec)) throw new Error('Your cartoon is on its way.');
    const plate = path.join(dir, rec.picked.forCutout || rec.picked.file);
    const picked = path.join(dir, rec.picked.file);
    // only what isn't made yet: a step that didn't all start (no credits, no connection) is finished this way, and
    // with nothing missing Meet your cartoon is free (the cartoon put together again from what's there)
    let keys;
    if (step === 'parts') keys = missingParts(rec, mouths === 'drawn' ? 'drawn' : 'painted');
    else {
      if (!rec.rig) throw new Error('Meet your cartoon first.');
      keys = missingParts(rec, 'painted').filter((k) => k.startsWith('mouth-'));
      if (!keys.length) throw new Error('The painted mouths are made already.');
    }
    for (const key of keys) {
      if (key === 'cutout') jobs.push(jobOf(key, 'cutout', null, [plate]));
      else if (key.startsWith('eyes-')) jobs.push(jobOf(key, 'still', style.prompts.eyes[key.slice(5)], [picked]));
      else jobs.push(jobOf(key, 'still', mouthPrompt(style, key.slice(6)), [picked, S(style.mouthRefs[key.slice(6)])]));
    }
    reserve = jobs.some((j) => j.kind === 'still') ? RESERVE : 0;
  } else if (step === 'reroll') {
    if (!rec.picked) throw new Error('Pick a plate first.');
    const picked = path.join(dir, rec.picked.file);
    for (const it of items || []) {
      const base = it.kind === 'eyes' ? `eyes-${it.base}` : `mouth-${it.base}`;
      const n = Object.keys(rec.jobs).filter((k) => k === base || k.startsWith(`${base}~`)).length;
      const key = `${base}~${n}`;
      jobs.push(it.kind === 'eyes' ? jobOf(key, 'still', style.prompts.eyes[it.base], [picked]) : jobOf(key, 'still', mouthPrompt(style, it.base), [picked, S(style.mouthRefs[it.base])]));
    }
  } else throw new Error('That isn\'t a step FLPT knows.');
  const stills = jobs.filter((j) => j.kind === 'still').length;
  const cut = jobs.filter((j) => j.kind === 'cutout').length;
  const lines = [];
  if (stills) lines.push({ rate: STILL, qty: stills, label: `${stills} still${stills === 1 ? '' : 's'} (Nano Banana Pro, 2K)` });
  if (cut) lines.push({ rate: CUTOUT, qty: cut, label: 'Cut-out (background removal)' });
  if (reserve) lines.push({ rate: STILL, qty: reserve, label: `Up to ${reserve} re-tries, only for a part that fails its check` });
  // what it should cost, as the broker estimates it (its rates and rounding), the reserve not counted
  const plannedUsd = priceOf(jobs);
  return { step, jobs, lines, plannedUsd, reserve, describe: describe(step, jobs, rec), message: messageOf(step) };
}

function mouthPrompt(style, s) { return style.prompts.mouth.replace('{S}', s).replace('{what}', style.prompts.shapes[s]); }

function describe(step, jobs, rec) {
  const stills = jobs.filter((j) => j.kind === 'still').length;
  if (step === 'plates') return `Four 2K stills with Nano Banana Pro on Kie.ai, drawn from your ${rec.photos.length === 1 ? 'photo' : `${rec.photos.length} photos`}, which Kie.ai receives`;
  if (step === 'again') return 'One more 2K still with Nano Banana Pro on Kie.ai, drawn from your photos';
  const parts = (step === 'parts' || step === 'mouths') && jobs.length < (step === 'mouths' ? 8 : partKeys(jobs.some((j) => j.key.startsWith('mouth-')) ? 'painted' : 'drawn').length);
  if (parts) return `What's still missing of your cartoon (${jobs.map((j) => j.label.charAt(0).toLowerCase() + j.label.slice(1)).join(', ')}), edits of your plate with Nano Banana Pro on Kie.ai`;
  if (step === 'parts') return stills > 2 ? 'The cut-out, two eye pictures and eight mouths, edits of your plate with Nano Banana Pro on Kie.ai' : 'The cut-out and two eye pictures, edits of your plate with Nano Banana Pro on Kie.ai';
  if (step === 'mouths') return 'Eight painted mouths, edits of your plate with Nano Banana Pro on Kie.ai';
  return `${stills} re-tr${stills === 1 ? 'y' : 'ies'}`;
}
const messageOf = (step) => ({ plates: 'Draw four plates of you?', again: 'Draw one more plate?', parts: 'Make your cartoon?', mouths: 'Paint your cartoon\'s mouths?' }[step] || 'Make it again?');

// ── jobs, as generate.js starts and lands them ────────────────────────────────────────────────────────────────────
/** A job about to go out: recorded first, so a crash between the start and its answer is never mistaken for nothing. */
function jobStarting(dir, job, { step, token, usd }) {
  return update(dir, (r) => {
    const was = r.jobs[job.key];
    if (was && was.status !== 'made') (r.past = r.past || []).push(was); // an earlier try of this part: kept for its cost
    r.jobs[job.key] = { key: job.key, kind: job.kind, step, token, usd, status: 'starting', dest: job.dest, at: new Date().toISOString() };
  });
}
function jobStarted(dir, key, { jobId }) { return update(dir, (r) => { if (r.jobs[key]) Object.assign(r.jobs[key], { status: 'working', jobId }); }); }
/** A job's end: { status: 'made' | 'failed' | 'unknown', file, error, costUsd }. */
function jobLanded(dir, key, result) {
  if (!read(dir)) return null;
  return update(dir, (r) => {
    if (!r.jobs[key]) return;
    Object.assign(r.jobs[key], { status: result.status, file: result.file || null, error: result.error || null, costUsd: result.costUsd != null ? result.costUsd : r.jobs[key].costUsd ?? null, endedAt: new Date().toISOString() });
    if (/^plate-\d+$/.test(key) && result.status === 'made' && !r.plates.includes(key)) r.plates.push(key);
    if (!/^plate-\d+$/.test(key)) r.dirty = true; // a part: its checks and the rig are due again
  });
}
/** A paid step said yes to: { token, usd, mouths, keys (its jobs) }; what it changes is undone by stepUndone. */
function stepApproved(dir, step, { token, usd, mouths = null, keys = [] }) {
  return update(dir, (r) => {
    const at = new Date().toISOString();
    const s = { token, usd, at, keys, prev: { status: r.status, mouths: r.mouths ?? null }, ...(mouths ? { mouths } : {}) };
    if (step === 'again') (r.steps.again = r.steps.again || []).push(s); else r.steps[step] = s;
    if (step === 'plates') r.status = 'plates';
    if (step === 'parts') { r.status = 'parts'; r.mouths = mouths; }
    if (step === 'mouths') { r.status = 'parts'; r.mouths = 'painted'; }
    r.actedAt = at;
    delete r.stalled;
  });
}

/**
 * A step that came to nothing, or whose parts didn't all start, taken back: the step is forgotten (so it can be asked
 * again, behind a new dialog), the status and mouths are what they were before it, and its jobs that made nothing go
 * to the record's past (what they may have cost stays counted). What it did make stays.
 */
function stepUndone(dir, step, token) {
  if (!read(dir)) return null;
  return update(dir, (r) => {
    const s = step === 'again' ? (r.steps.again || []).find((x) => x.token === token) : r.steps[step];
    if (!s || s.token !== token) return;
    for (const [k, j] of Object.entries(r.jobs)) if (j.token === token && j.status !== 'made') { (r.past = r.past || []).push(j); delete r.jobs[k]; }
    if (step === 'again') r.steps.again = r.steps.again.filter((x) => x.token !== token); else delete r.steps[step];
    if (s.prev) { r.status = s.prev.status; r.mouths = s.prev.mouths; }
    r.dirty = false;
  });
}

const pending = (rec, keys = null) => Object.values(rec.jobs).filter((j) => (!keys || keys.includes(j.key)) && (j.status === 'starting' || j.status === 'working'));
/** The parts or mouths step still open (its reserve not let go), as { name, s }, or null. */
function activeStep(rec) {
  if (rec.steps.mouths && !rec.steps.mouths.closed) return { name: 'mouths', s: rec.steps.mouths };
  if (rec.steps.parts && !rec.steps.parts.closed) return { name: 'parts', s: rec.steps.parts };
  return null;
}
/**
 * How a step's own jobs came out, once none is on its way: { made: how many of its parts have a picture, notStarted:
 * its parts that never reached Kie.ai (refused, no connection, or maybe started but never heard of again) }.
 */
function stepOutcome(rec, s) {
  if (!Array.isArray(s.keys)) return { made: null, notStarted: [] }; // a step recorded before its jobs were listed: as it comes
  const keys = s.keys;
  const made = keys.filter((k) => hasMade(rec, k)).length;
  const notStarted = keys.filter((k) => !hasMade(rec, k) && !(rec.jobs[k] && rec.jobs[k].jobId));
  return { made, notStarted };
}

// ── the free work, in its own sandboxed Node process ──────────────────────────────────────────────────────────────
/**
 * Run likeness/tools/likeness.mjs on a plan, in macOS's sandbox: no network, no key in its environment, writing only
 * the presenter's folder and a temp folder. o: { engineRoot, toolEnv, node, hidden, sandbox (false: tests only) }.
 */
function runTool(plan, dir, o = {}) {
  const tool = path.join(likenessRoot(o.engineRoot), 'tools', 'likeness.mjs');
  const env0 = typeof o.toolEnv === 'function' ? o.toolEnv() : (o.toolEnv || {});
  const node = o.node || presenter.nodeFrom(env0);
  if (!node) return Promise.resolve({ ok: false, problem: 'Node.js isn\'t set up yet (Setup → Tools).' });
  const tmp = fs.mkdtempSync(path.join(sandbox.tmpdir(), 'flpt-likeness-'));
  const planFile = path.join(tmp, 'plan.json');
  fs.writeFileSync(planFile, JSON.stringify(plan));
  const env = { HOME: process.env.HOME || '', LANG: 'en_US.UTF-8', TMPDIR: sandbox.tmpdir(), FLPT_SANDBOXED: '1', PATH: env0.PATH || [path.dirname(node), '/usr/bin', '/bin'].join(':') };
  for (const k of ['FLPT_FFMPEG', 'HYPERFRAMES_FFMPEG_PATH']) if (env0[k]) env[k] = env0[k];
  let cmd = node;
  let args = [tool, planFile];
  if (o.sandbox !== false) {
    if (!sandbox.available()) { fs.rmSync(tmp, { recursive: true, force: true }); return Promise.resolve({ ok: false, problem: 'Your cartoon is made inside macOS\'s sandbox, which isn\'t here.' }); }
    [cmd, args] = sandbox.wrap(node, args, { writable: [dir, tmp], hidden: [...sandbox.hiddenDirs(), ...(o.hidden || [])] });
  }
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let errText = '';
    child.stdout.on('data', (b) => { out = (out + b).slice(-(4 << 20)); });
    child.stderr.on('data', (b) => { errText = (errText + b).slice(-4000); });
    const done = (r) => { fs.rmSync(tmp, { recursive: true, force: true }); resolve(r); };
    child.on('error', (e) => done({ ok: false, problem: `The cartoon's checks couldn't start: ${e.message}` }));
    child.on('close', () => {
      const line = out.trim().split('\n').reverse().find((l) => l.startsWith('{'));
      let r = null;
      try { r = JSON.parse(line); } catch { /* below */ }
      done(r && typeof r === 'object' ? r : { ok: false, problem: `The cartoon's checks stopped without a result.${errText ? ` ${errText.trim().split('\n').pop().slice(0, 200)}` : ''}` });
    });
  });
}

/** Plates that landed and aren't measured yet: measured (free), with a thumbnail each. → the record. */
async function measurePlates(dir, o) {
  const rec = read(dir);
  const todo = rec.plates.filter((k) => !rec.measured[k] && rec.jobs[k] && rec.jobs[k].file);
  if (!todo.length) return rec;
  const r = await runTool({ cmd: 'measure', files: todo.map((k) => path.join(dir, rec.jobs[k].file)), thumbs: path.join(dir, 'work') }, dir, o);
  if (!r.ok) throw new Error(r.problem || 'The plates couldn\'t be measured.');
  return update(dir, (x) => {
    todo.forEach((k, i) => {
      const m = r.plates[i] || {};
      x.measured[k] = { ok: Boolean(m.ok), usable: Boolean(m.usable), measured: Boolean(m.measured), why: m.why || null, eyeLinePct: m.eyeLinePct ?? null, faceWidthPct: m.faceWidthPct ?? null,
        thumb: m.thumb ? path.relative(dir, m.thumb) : null };
    });
  });
}

/**
 * Pick a plate: reframed to the plate format and checked (free). A plate whose framing can't be fixed is refused, and
 * one the reading can't measure (no face or eyes found in it) isn't taken as framed: it waits for the person's own box
 * round its eyes (eyes: [x, y, w, h] in the plate's pixels, as Adjust draws it), which the reframe then works from.
 */
async function pick(dir, key, o, { eyes = null } = {}) {
  const rec = read(dir);
  if (!rec) throw new Error('That cartoon isn\'t there any more.');
  if (Object.values(rec.jobs).some((j) => !/^plate-\d+$/.test(j.key) && (j.status === 'made' || j.status === 'starting' || j.status === 'working'))) {
    throw new Error('Your cartoon is made from its plate already.');
  }
  const job = rec.jobs[key];
  if (!job || job.status !== 'made' || !/^plate-\d+$/.test(key)) throw new Error('That plate isn\'t there.');
  const box = Array.isArray(eyes) && eyes.length === 4 && eyes.every(Number.isFinite) ? eyes.map((n) => Math.round(n)) : null;
  const dst = path.join(dir, 'work', 'plate-picked.png');
  const r = await runTool({ cmd: 'pick', src: path.join(dir, job.file), dst, thumb: path.join(dir, 'work', 'plate-picked-thumb.png'), eyeBox: box }, dir, o);
  if (!r.report) throw new Error(r.problem || 'That plate couldn\'t be read.');
  const c = r.check || {};
  const ok = Boolean(c.usable && c.measured && c.ok);
  const needsEyes = Boolean(c.usable && !c.measured);
  return update(dir, (x) => {
    // Recraft takes at most 5 MB: the tool leaves a smaller copy for the cut-out when the plate is bigger
    x.picked = { key, file: 'work/plate-picked.png', thumb: 'work/plate-picked-thumb.png', ok, needsEyes, byHand: Boolean(box), forCutout: r.forCutout ? path.relative(dir, r.forCutout) : null,
      why: ok ? null : needsEyes ? 'not measured' : c.why || 'not a portrait',
      check: { eyeLinePct: c.eyeLinePct ?? null, faceWidthPct: c.faceWidthPct ?? null, measured: Boolean(c.measured), skinHex: c.skinHex || null, eyes: c.eyes || null, faceX: c.faceX || null, w: c.w, h: c.h, skin: c.skin || null },
      reframe: { reframed: Boolean(r.report.reframed), shift: r.report.shift || null, scale: r.report.scale ?? null, before: r.report.before || null } };
    x.status = 'picked';
    x.actedAt = new Date().toISOString();
    delete x.stalled;
    if (!x.rig) x.rects = { eyes: null, mouth: null }; // a new plate: its own boxes
  });
}

/** The free checks of every part that landed (or again after Adjust). → the record with checks. */
async function checkParts(dir, o) {
  const rec = read(dir);
  const made = (prefix) => Object.fromEntries(Object.values(rec.jobs).filter((j) => j.key.startsWith(prefix) && j.status === 'made' && j.file).map((j) => [j.key.slice(prefix.length), path.join(dir, j.file)]));
  const cut = rec.jobs.cutout && rec.jobs.cutout.status === 'made' ? path.join(dir, rec.jobs.cutout.file) : null;
  const plateMeas = { ...rec.picked.check, file: null, ok: true, usable: true };
  const r = await runTool({ cmd: 'parts', plate: path.join(dir, rec.picked.file), meas: plateMeas.eyes ? plateMeas : null, cutout: cut, eyes: made('eyes-'), mouths: rec.mouths === 'painted' ? made('mouth-') : {},
    rect: { eyes: rec.rects.eyes, mouths: rec.rects.mouth }, out: path.join(dir, 'work', 'patches') }, dir, o);
  if (!r.ok) throw new Error(r.problem || 'The checks didn\'t finish.');
  const rel = (res) => (res ? { ...res, edits: Object.fromEntries(Object.entries(res.edits).map(([k, e]) => [k, { ...e, patch: e.patch ? path.relative(dir, e.patch) : null, preview: e.preview ? path.relative(dir, e.preview) : null }])) } : null);
  return update(dir, (x) => { x.checks = { cutout: r.cutout, eyes: rel(r.eyes), mouths: rel(r.mouths), at: new Date().toISOString() }; });
}

/** The re-rolls the reserve should pay for now ([{ kind, base }]); none once it's spent. */
function rerollsWanted(dir, engineRoot) {
  const rec = read(dir);
  const D = require(path.join(likenessRoot(engineRoot), 'decide.js'));
  const step = rec.steps.mouths && !rec.steps.mouths.closed ? rec.steps.mouths : rec.steps.parts;
  if (!step || step.closed) return [];
  const used = Object.values(rec.jobs).filter((j) => /~\d+$/.test(j.key) && j.token === step.token).length;
  const keyed = (res) => (res ? { ...res, edits: res.edits } : null);
  return D.rerolls({ eyesRes: rec.steps.mouths ? null : keyed(rec.checks && rec.checks.eyes), mouthsRes: keyed(rec.checks && rec.checks.mouths), painted: rec.mouths === 'painted',
    plateOk: Boolean(rec.picked && rec.picked.ok), left: RESERVE - used });
}

/** The rig and its test clip, from the checks: built (free) into work/rig/<id>/, then the clip in the Mac's voice. */
async function build(dir, o) {
  const rec = read(dir);
  const D = require(path.join(likenessRoot(o.engineRoot), 'decide.js'));
  const abs = (p) => (p ? path.join(dir, p) : null);
  const files = (res) => (res ? { ...res, edits: Object.fromEntries(Object.entries(res.edits).map(([k, e]) => [k, { ...e, patch: abs(e.patch) }])) } : null);
  const eyes = D.eyes(files(rec.checks && rec.checks.eyes));
  const mouths = D.mouths(files(rec.checks && rec.checks.mouths), rec.mouths || 'drawn');
  const cut = rec.checks && rec.checks.cutout && rec.checks.cutout.ok ? path.join(dir, rec.jobs.cutout.file) : null;
  const pc = rec.picked.check;
  const geom = pc.eyes && pc.faceX ? { eyeY: (pc.eyes[0][1] + pc.eyes[1][1]) / 2, cx: (pc.eyes[0][0] + pc.eyes[1][0]) / 2, fw: pc.faceX[1] - pc.faceX[0] }
    : { eyeY: (332 / 720) * pc.w, cx: pc.w / 2, fw: (300 / 720) * pc.w };
  const rigDir = path.join(dir, 'work', 'rig', rec.id);
  const mouthRect = rec.rects.mouth || (rec.checks && rec.checks.mouths && rec.checks.mouths.rectFrom === 'changes' ? rec.checks.mouths.rect : null);
  const spent = [...Object.values(rec.jobs), ...(rec.past || [])]
    .reduce((t, j) => t + (j.status === 'made' || j.status === 'failed' || j.status === 'unknown' ? Number(j.costUsd != null ? j.costUsd : j.usd) || 0 : 0), 0);
  const provenance = { kind: 'likeness', plate: `${rec.picked.key} (reframed)`, made: new Date().toISOString(), costUsd: Math.round(spent * 1000) / 1000,
    consent: { self: true, at: rec.consent.at, appVersion: rec.consent.appVersion } };
  const r = await runTool({ cmd: 'build', dir: rigDir, adaDir: adaDir(o.engineRoot), id: rec.id, name: rec.name, head: cut || path.join(dir, rec.picked.file), plateW: pc.w,
    eyes: { half: eyes.half, closed: eyes.closed }, mouths: { strategy: mouths.strategy, shapes: mouths.shapes }, geom, mouthRect,
    skinHex: pc.skinHex, provenance }, dir, o);
  if (!r.ok) throw new Error(r.problem || 'Your cartoon couldn\'t be put together.');
  update(dir, (x) => {
    x.decision = { mouths: mouths.strategy, firstPass: mouths.firstPass, usable: mouths.usable, blink: eyes.blink, why: mouths.why || null };
    x.rig = { dir: path.relative(dir, rigDir), builtAt: new Date().toISOString(), mouths: mouths.strategy };
  });
  // the test clip: the rig saying the test line in the Mac's voice, drawn by the cartoon's own pass (sandboxed, keyless)
  const clip = await meetClip(rec.id, path.join(dir, 'meet'), { engineRoot: o.engineRoot, presentersDir: path.dirname(rigDir), toolEnv: o.toolEnv, sayVoice: o.sayVoice || '',
    hidden: o.hidden || [], sandbox: o.sandbox, say: o.say });
  return update(dir, (x) => { x.meet = { clip: path.relative(dir, clip), at: new Date().toISOString() }; x.status = 'ready'; delete x.stalled; });
}

/**
 * The test clip (draft-ux §9.3): the rig saying TEST_LINE (about 6 s, every mouth shape, a blink or two) in the Mac's
 * voice, padded to whole frames, drawn by the cartoon presenter's own pass (presenter.runPass: sandboxed, keyless), as
 * presenter.sampleClip does with Setup's shorter line. o: { engineRoot, presentersDir, toolEnv, sayVoice, say, sandbox,
 * hidden }. → the clip's path.
 */
async function meetClip(rigId, outDir, o = {}) {
  const rig = presenter.rigDir(o.engineRoot, rigId, o.presentersDir);
  if (!rig) throw new Error('That presenter isn\'t there.');
  const C = require(path.join(o.engineRoot, 'runtime', 'flpt-live', 'presenter', 'compile.js'));
  const voice = o.sayVoice && /^[\p{L}\p{N} ()._'-]{1,64}$/u.test(o.sayVoice) ? o.sayVoice : '';
  const padKey = crypto.createHash('sha256').update(`meet|${voice}|${TEST_LINE}`).digest('hex').slice(0, 20);
  const cache = path.join(outDir, 'cache');
  const wav = path.join(cache, 'audio', 'padded', `${padKey}.wav`);
  fs.mkdirSync(path.dirname(wav), { recursive: true });
  if (!exists(wav)) {
    const said = `${wav}.say.wav`;
    await new Promise((resolve, reject) => execFile(o.say || '/usr/bin/say', [...(voice ? ['-v', voice] : []), '-o', said, '--file-format=WAVE', '--data-format=LEI16@48000', TEST_LINE],
      { timeout: 30000 }, (err) => (err ? reject(new Error('The Mac couldn\'t say the test line.')) : resolve())));
    const { pcm } = C.readWav(fs.readFileSync(said));
    const lead = 14400; // 0.3 s in, 0.4 s out, whole frames of 1600 samples (30 fps at 48 kHz)
    const total = Math.ceil((lead + pcm.length + 19200) / 1600) * 1600;
    const data = Buffer.alloc(total * 2);
    for (let i = 0; i < pcm.length; i++) data.writeInt16LE(pcm[i], (lead + i) * 2);
    const head = Buffer.alloc(44);
    head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8); head.write('fmt ', 12);
    head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(48000, 24);
    head.writeUInt32LE(96000, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40);
    fs.writeFileSync(wav, Buffer.concat([head, data]));
    fs.rmSync(said, { force: true });
  }
  const frames = Math.round((fs.statSync(wav).size - 44) / 2 / 1600);
  const r = await presenter.runPass({ cache, rig, workers: 1, still: false, slides: [{ n: 1, pad_key: padKey, wav, frames, spoken: TEST_LINE }] }, path.join(cache, 'cartoon'), o);
  const idx = readJson(path.join(cache, 'cartoon', 'index.json'), {}) || {};
  const clip = idx[padKey] ? path.join(cache, 'cartoon', idx[padKey]) : null;
  if (!r.ok || !clip || !exists(clip)) throw new Error((r.problems || [])[0] || 'Your cartoon\'s test clip wasn\'t made.');
  return clip;
}

/** Adjust: the eye and mouth boxes (plate pixels), then the patches cut again and the rig rebuilt (all free). */
function setRects(dir, rects) {
  const box = (v) => (Array.isArray(v) && v.length === 4 && v.every((n) => Number.isFinite(n)) && v[2] >= 8 && v[3] >= 8 ? v.map((n) => Math.round(n)) : null);
  return update(dir, (r) => {
    if (!r.picked) throw new Error('Pick a plate first.');
    const W = r.picked.check.w || 2048, H = r.picked.check.h || 2048;
    const clip = (b) => (b ? [Math.max(0, Math.min(W - 8, b[0])), Math.max(0, Math.min(H - 8, b[1])), Math.min(b[2], W), Math.min(b[3], H)] : null);
    r.rects = { eyes: clip(box(rects && rects.eyes)) || r.rects.eyes, mouth: clip(box(rects && rects.mouth)) || r.rects.mouth };
    r.actedAt = new Date().toISOString();
  });
}

/** Mouths: Drawn (free, any time) or Painted (needs the paid mouths step while any of the eight isn't made). */
function setMouths(dir, which) {
  return update(dir, (r) => {
    if (which === 'painted' && missingParts(r, 'painted').some((k) => k.startsWith('mouth-'))) throw new Error('The painted mouths aren\'t made yet.');
    r.mouths = which === 'painted' ? 'painted' : 'drawn';
    r.actedAt = new Date().toISOString();
    delete r.stalled;
  });
}

/** Meet your cartoon with every part made already (after a free pass that stopped): put together again, free. */
function meetAgain(dir, which) {
  return update(dir, (r) => {
    if (!r.picked || !r.picked.ok) throw new Error('Pick a plate first.');
    r.mouths = which === 'drawn' ? 'drawn' : 'painted';
    r.status = 'parts';
    r.dirty = true;
    r.actedAt = new Date().toISOString();
    delete r.stalled;
  });
}

/** Start over: this one is set aside (its folder and photos stay; it's no longer listed or made). Never mid-step. */
function discard(dir) {
  return update(dir, (r) => {
    if (r.status === 'kept') throw new Error('That cartoon is kept already.');
    if (pending(r).length || activeStep(r)) throw new Error('Your cartoon is on its way.');
    r.status = 'discarded';
    r.discardedAt = new Date().toISOString();
  });
}

/**
 * Keep: the rig moves from work/ into the presenter's folder (rig.json and its layers), where Setup lists it. → the
 * record. The page then picks it as the presenter (api/likeness.js).
 */
function keep(dir, { engineRoot }) {
  const rec = read(dir);
  if (!rec || !rec.rig || rec.status !== 'ready') throw new Error('Your cartoon isn\'t ready yet.');
  if (!rec.consent || rec.consent.self !== true) throw new Error('Only your own photos.');
  const from = path.join(dir, rec.rig.dir);
  const rig = readJson(path.join(from, 'rig.json'));
  const { checkRig } = require(path.join(engineRoot, 'runtime', 'flpt-live', 'presenter', 'rig.js'));
  const problems = checkRig(rig);
  if (problems.length || rig.id !== rec.id) throw new Error('Your cartoon didn\'t check out.');
  for (const f of fs.readdirSync(dir)) if (/\.(svg|png)$/.test(f) || f === 'rig.json') fs.rmSync(path.join(dir, f), { force: true });
  for (const f of fs.readdirSync(from)) if (/\.(svg|png)$/.test(f)) fs.copyFileSync(path.join(from, f), path.join(dir, f));
  fs.copyFileSync(path.join(from, 'rig.json'), path.join(dir, 'rig.json')); // last: the folder is listed once rig.json is there
  return update(dir, (x) => { x.status = 'kept'; x.keptAt = new Date().toISOString(); });
}

/** A paid step's token is done with (its reserve no longer needed): recorded, so a rebuild doesn't ask for re-rolls. */
function closeStep(dir, token) {
  return update(dir, (r) => { for (const s of [r.steps.parts, r.steps.mouths]) if (s && s.token === token) s.closed = true; });
}

/** The pairing a likeness was made with (a voice, by provider and name), or null. */
const pairingOf = (dir) => { const r = read(dir); return r && isObj(r.pairing) ? r.pairing : null; };

/**
 * What the page sees: no paths, only flpt:// links (fileUrl), the step's state, the prices as main states them.
 * styleList: [{ id, name, poster }] from styles().
 */
function view(dir, { fileUrl = (p) => p, engineRoot, waiting = 0 } = {}) {
  const rec = read(dir);
  if (!rec) return null;
  const url = (rel, v) => (rel && exists(path.join(dir, rel)) ? `${fileUrl(path.join(dir, rel))}${v ? `?v=${encodeURIComponent(v)}` : ''}` : null);
  const plates = plateKeys(rec).map((k) => {
    const j = rec.jobs[k];
    const m = rec.measured[k] || null;
    // a plate the reading couldn't measure is never shown as framed: "Off" like one framed wrong
    return { key: k, status: j.status, thumb: m && m.thumb ? url(m.thumb) : null, picked: Boolean(rec.picked && rec.picked.key === k), framing: m ? (m.ok ? 'ok' : 'off') : null };
  });
  const parts = Object.values(rec.jobs).filter((j) => !/^plate-/.test(j.key)).map((j) => ({ key: j.key, status: j.status }));
  // the style tiles only while the style can still be chosen (before the plates): the poster isn't sent with every poll
  const drawn = plateKeys(rec).length > 0;
  const st = styles(engineRoot).map((s) => ({ id: s.id, name: s.name, poster: drawn ? null : posterOf(s) }));
  const missing = (m) => missingParts(rec, m);
  const mouthsMissing = missing('painted').filter((k) => k.startsWith('mouth-'));
  // what went wrong in the latest step, until something later happened (a pick, a new step, the cartoon put together)
  const since = [rec.actedAt, rec.rig && rec.rig.builtAt].filter(Boolean).sort().at(-1) || '';
  const failed = Object.values(rec.jobs).filter((j) => (j.status === 'failed' || j.status === 'unknown') && String(j.endedAt || j.at || '') >= since)
    .map((j) => ({ key: j.key, error: j.error || null }));
  let eyesBox = null;
  if (rec.picked && rec.picked.needsEyes) { // where Ada's eyes would be on this plate: where the person's box starts
    const M = require(path.join(likenessRoot(engineRoot), 'measure.js'));
    const W = rec.picked.check.w || 2048, H = rec.picked.check.h || 2048;
    eyesBox = M.windowFor('eyes', M.geometry(null, W, H), W, H);
  }
  return {
    id: rec.id, name: rec.name, status: rec.status, consent: Boolean(rec.consent && rec.consent.self), style: rec.style, styles: st,
    photos: rec.photos.map((p, i) => ({ i, name: p.name, url: url(p.file) })),
    plates, picked: rec.picked ? { key: rec.picked.key, ok: rec.picked.ok, why: rec.picked.why, needsEyes: Boolean(rec.picked.needsEyes), eyesBox, url: url(rec.picked.thumb || rec.picked.file),
      w: rec.picked.check.w, h: rec.picked.check.h, full: url(rec.picked.file) } : null,
    parts, waiting: waiting || pending(rec).length,
    mouths: rec.mouths, paintedMade: mouthsMissing.length === 0,
    rects: { eyes: rec.rects.eyes || (rec.checks && rec.checks.eyes ? rec.checks.eyes.rect : null), mouth: rec.rects.mouth || (rec.checks && rec.checks.mouths ? rec.checks.mouths.rect : null) },
    decision: rec.decision, meet: rec.meet ? url(rec.meet.clip, rec.meet.at) : null,
    // main's prices (the broker's rates and rounding) for what each step would make now: only what's still missing
    prices: { plates: priceOf(['p', 'p', 'p', 'p']), again: priceOf(['p']), painted: priceOf(missing('painted')), drawn: priceOf(missing('drawn')), mouths: priceOf(mouthsMissing) },
    failed,
  };
}

module.exports = { SCHEMA, MAX_PHOTOS, RESERVE, SHAPES, TEST_LINE, PHOTO_SIDE, presentersDir, likenessRoot, adaDir, read, write, update, list, current, create, styles, styleOf,
  addPhotos, removePhoto, attest, setStyle, plan, priceOf, missingParts, hasMade, jobStarting, jobStarted, jobLanded, stepApproved, stepUndone, stepOutcome, activeStep, pending,
  runTool, measurePlates, pick, checkParts, rerollsWanted, build, meetClip, setRects, setMouths, meetAgain, discard, keep, closeStep, pairingOf, view, plateKeys, partKeys };
