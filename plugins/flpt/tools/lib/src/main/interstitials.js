'use strict';
// The splice (PLAN §2.7, engine draft §6.1, spike K5; W2-03): the storyboard's pieces between slides (a Solo ♪, a cut
// scene drawn in code), rendered by Live Motion to media/jsscene_<id>.mp4 with their stem at -21 LUFS (livemotion.js,
// the mixer), go into the film after the pipeline, with Refine's planner and ffmpeg graph. Never through media.json:
// a neighbour's lead, tail, pad_key and avatar clip never move (T3, T20), so adding or removing one after Film is free.
//
//   plannedRows(dir)        the pieces as Refine's planned rows (refine.plannedAddon), in film order: { rows, notes }
//   applyDraft(dir, deps)   after the free draft: draft_presentation_full.{mp4, timeline.json} (no master)
//   materialise(dir, deps)  after Film: the rows into the record's addons[] (by source id, so a re-render replaces in
//                           place), then presentation_full.{mp4, _for_editing.mov, timeline.json}, which Film review plays
//   syncRecord(dir, st)     the record's planned rows kept to the storyboard (the flow's settle): a change to what makes
//                           the video re-opens Refine and stales a delivery; other fields are refreshed quietly; the
//                           user's own add-ons stay as they are
//   current(dir, which)     the spliced outputs while they're current (the same base video, the same rows), else null
//   sceneCredits(dir)       the CC BY tracks the Live Motion slides play (score.json), for the credits
//   credits(dir, addons)    every CC BY track the delivery plays and music-credits.txt's text (each shipped file's own
//                           changes looked up then, never stored on a row)
//   liveFiles(dir)          each Live Motion piece's stem and music, for Deliver's extras
//   deliveredTimeline(...)  what Deliver hands over, and the timelines that map film times into it
//   captionWords(dir, ...)  the narration's words in the delivered video (real-words.py, sandboxed), for captions
// Refine later re-applies from the base film: tighten first (Live Motion slides with sound kept whole), then the
// planned rows and the user's add-ons. Deliver takes Refine's output. Nothing here spends or reaches the network.
//
// deps: { engineRoot, ffmpeg, ffprobe, env (PATH etc.), signal, onLine, title }
const fs = require('fs');
const path = require('path');
const refine = require('./refine');

const exists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const isPlain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const pres = (dir, ...p) => path.join(dir, 'presentation', ...p);
const s = (n) => (n === 1 ? '' : 's');
const lm = () => require('./livemotion'); // late: livemotion pulls in the whole scene pipeline

/** The base video of a run and its spliced outputs, side by side in video/output/. which: 'draft' | 'film' */
function outputsFor(dir, which) {
  const out = pres(dir, 'video', 'output');
  const base = which === 'draft' ? 'draft_presentation' : 'presentation';
  return {
    base: path.join(out, `${base}.mp4`), baseTimeline: path.join(out, `${base}.timeline.json`),
    video: path.join(out, `${base}_full.mp4`), master: which === 'draft' ? null : path.join(out, `${base}_full_for_editing.mov`),
    timeline: path.join(out, `${base}_full.timeline.json`),
  };
}

/** A shipped CC BY item's own `changes` (to the file itself), for a score credit's track. */
function shippedChanges(engineRoot, id) {
  if (!engineRoot || !id) return null;
  try { const it = lm().shippedLibrary(engineRoot).find((x) => x.id === id); return it && it.changes ? it.changes : null; } catch { return null; }
}

/** A piece's score record (its folder's score/score.json), or null. */
const scoreOf = (dir, piece) => readJson(pres(dir, piece.folder, 'score', 'score.json'));

/**
 * The storyboard's pieces between slides as Refine's planned rows, in film order (each after the slide it follows, a
 * cold open first). A piece is spliced once Live Motion has rendered it (its record says so and its clip is there);
 * one that isn't rendered yet is left out, with a line saying so. → { rows (refine.plannedAddon), notes }
 */
function plannedRows(dir) {
  let pieces = [];
  try { pieces = lm().pieces(dir).filter((p) => p.placement === 'between'); } catch { return { rows: [], notes: [] }; }
  const rows = [];
  const notes = [];
  for (const p of pieces) {
    const rec = lm().recordOf(dir, p);
    const rendered = rec && rec.key === p.key && isPlain(rec.rendered) ? rec.rendered : null;
    if (!rendered || !exists(pres(dir, p.clip))) { notes.push(`${p.title} isn't rendered yet, so it isn't spliced in.`); continue; }
    // its stem was levelled to -21 LUFS by the mixer (stemOk); spliced at its own level either way, so a miss is said
    if (Number.isFinite(rendered.lufs) && Math.abs(rendered.lufs + 21) > 0.5) notes.push(`${p.title} plays at ${rendered.lufs.toFixed(1)} LUFS, not -21.`);
    const score = scoreOf(dir, p);
    // the track's credit as the score recorded it; the shipped file's own `changes` is looked up at Deliver (credits()),
    // so rewording it in an app update never makes a row look changed
    const credit = score && isPlain(score.credit) ? { ...score.credit } : null;
    if (credit) delete credit.changes;
    rows.push(refine.plannedAddon({
      source: { kind: 'jsscene', id: p.id, shot: p.shot }, title: p.title, file: p.clip.split(path.sep).join('/'), slide: p.afterN || 0, seam: p.seam,
      sha: rendered.sha, music: Boolean(score && score.music), credit, duration: rendered.seconds,
    }));
  }
  return { rows, notes };
}

/** Rows with their absolute paths, as refine.apply takes them. */
const withPaths = (dir, rows) => rows.map((r) => ({ ...r, path: pres(dir, ...r.file.split('/')) }));

/** The key a spliced output was made from: its base video and its rows. */
const spliceKey = (o, rows) => ({ base: refine.filmKey(o.base), rows: refine.addonsKey(rows) });

/** The spliced outputs of a run while they're current (the same base video, the same rows), else null. */
function current(dir, which, rows = null) {
  const o = outputsFor(dir, which);
  if (!exists(o.video) || !exists(o.timeline) || (o.master && !exists(o.master))) return null;
  const tl = readJson(o.timeline);
  const k = tl && isPlain(tl.splice) ? tl.splice : null;
  const want = rows || plannedRows(dir).rows;
  if (!k || !want.length) return null;
  const now = spliceKey(o, want);
  return k.base === now.base && k.rows === now.rows ? o : null;
}

/** Where the last splice of each run stands (video/output/splice.json): { draft, film } each { ok, at, pieces, notes, error }. */
const statusFile = (dir) => pres(dir, 'video', 'output', 'splice.json');
function status(dir) { return readJson(statusFile(dir)) || {}; }
function noteStatus(dir, which, rec) {
  try {
    fs.mkdirSync(path.dirname(statusFile(dir)), { recursive: true });
    fs.writeFileSync(statusFile(dir), `${JSON.stringify({ ...status(dir), [which]: { ...rec, at: new Date().toISOString() } }, null, 1)}\n`);
  } catch { /* the outputs folder isn't there: nothing to say */ }
}

/**
 * Splice a run's pieces into its base video (refine.apply with the planned rows alone): `which` 'draft' (the MP4 and
 * its timeline) or 'film' (and the editing master). Nothing to splice: any earlier outputs go. Up to date: kept.
 * → { spliced (pieces), video | null, fresh, notes }; throws a plain message when the splice fails.
 */
async function splice(dir, which, deps = {}) {
  const o = outputsFor(dir, which);
  const drop = () => { for (const f of [o.video, o.master, o.timeline]) if (f) fs.rmSync(f, { force: true }); };
  const { rows, notes } = plannedRows(dir);
  if (!rows.length || !exists(o.base) || !exists(o.baseTimeline)) {
    drop();
    noteStatus(dir, which, { ok: true, pieces: 0, notes });
    return { spliced: 0, video: null, fresh: false, notes };
  }
  if (current(dir, which, rows)) return { spliced: rows.length, video: o.video, fresh: false, notes };
  const say = deps.onLine || (() => {});
  for (const n of notes) say(`  ! ${n}`);
  try {
    const r = await refine.apply({
      pres: pres(dir), film: o.base, filmTimeline: o.baseTimeline, out: o, addons: withPaths(dir, rows), title: deps.title || '',
      headline: `Splicing ${rows.length} Live Motion piece${s(rows.length)} into the ${which === 'draft' ? 'draft' : 'film'} (ffmpeg only: nothing is filmed or paid for).`,
      meta: { splice: { ...spliceKey(o, rows), pieces: rows.map((x) => x.source.id) } },
      ffmpeg: deps.ffmpeg, ffprobe: deps.ffprobe, env: deps.env, signal: deps.signal, onLine: say,
    });
    noteStatus(dir, which, { ok: true, pieces: rows.length, notes: [...notes, ...r.notes].slice(0, 20), frames: r.frames, lufs: r.lufs });
    return { spliced: rows.length, video: r.video, fresh: true, notes: [...notes, ...r.notes], frames: r.frames };
  } catch (e) {
    drop();
    const error = String(e && e.message ? e.message : e).slice(0, 300);
    noteStatus(dir, which, { ok: false, pieces: rows.length, notes, error });
    throw new Error(error);
  }
}

/** After the free draft: its pieces spliced in (draft_presentation_full.*). */
const applyDraft = (dir, deps = {}) => splice(dir, 'draft', deps);

/**
 * What a planned row changes in the video: refine.addonsKey (its file, render hash, place, seams, level) plus the
 * fields Refine's plan reads besides (its title, in the timeline's chapters; `music`, which lowers a bed under it).
 */
const videoKey = (rows) => JSON.stringify([refine.addonsKey(rows), rows.map((a) => [a.id, a.title, a.music === true])]);

/**
 * The record's planned rows kept to the storyboard, once there's a film (or `force`, while it's being made): the user's
 * own add-ons after them, untouched. A change to what makes the video re-opens Refine (its outputs no longer match) and
 * stales a delivery (`stale`); any other difference (a credit's wording, a length) is refreshed on the rows alone.
 * → { st, changed (the rows differ), stale (the video does) }
 */
function syncRecord(dir, st, { force = false } = {}) {
  const same = { st, changed: false, stale: false };
  if (!isPlain(st) || !isPlain(st.stages)) return same;
  const film = st.stages.film || {};
  const ref = st.stages.refine || {};
  if (ref.status === 'running' || (!force && !['review', 'approved'].includes(film.status))) return same;
  const o = outputsFor(dir, 'film');
  if (!exists(o.base) || !exists(o.baseTimeline)) return same;
  const addons = Array.isArray(st.addons) ? st.addons : [];
  const want = plannedRows(dir).rows;
  const have = addons.filter((a) => isPlain(a) && a.planned);
  if (JSON.stringify(have) === JSON.stringify(want)) return same;
  const next = { ...st, addons: [...want, ...addons.filter((a) => !(isPlain(a) && a.planned))] };
  if (videoKey(have) === videoKey(want)) return { st: next, changed: true, stale: false };
  next.stages = { ...st.stages };
  if (isPlain(next.stages.refine) && next.stages.refine.status !== 'todo') {
    next.stages.refine = { ...next.stages.refine, status: 'todo', at: new Date().toISOString() };
    delete next.stages.refine.approvedBy;
  }
  if (isPlain(next.stages.deliver) && next.stages.deliver.status === 'approved') next.stages.deliver = { ...next.stages.deliver, status: 'stale' };
  return { st: next, changed: true, stale: true };
}

/**
 * After Film: the planned rows written into the record (`write(dir, st)`, the episode's), then the pieces spliced into
 * the film (presentation_full.*), which Film review plays. → splice()'s answer
 */
async function materialise(dir, deps = {}, { read, write } = {}) {
  if (typeof read === 'function' && typeof write === 'function') {
    const r = syncRecord(dir, read(dir), { force: true });
    if (r.changed) write(dir, r.st);
  }
  return splice(dir, 'film', deps);
}

// ── Deliver ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The CC BY tracks the Live Motion slides play (each scene's score.json `credit`), for the credits: [{ credit, changes }]. */
function sceneCredits(dir, { engineRoot } = {}) {
  let pieces = [];
  try { pieces = lm().pieces(dir).filter((p) => p.placement === 'slide'); } catch { return []; }
  const live = refine.sceneSound(pres(dir)).sound;
  const out = [];
  for (const p of pieces) {
    if (!live.has(p.n)) continue; // not in the film with its own sound
    const score = scoreOf(dir, p);
    if (score && isPlain(score.credit)) out.push({ credit: score.credit, changes: shippedChanges(engineRoot, score.credit.id) });
  }
  return out;
}

/**
 * Every CC BY track the delivered video plays, once (Refine's beds, the spliced pieces' and the Live Motion slides'
 * music), with each shipped file's own `changes` looked up now: { tracks (refine.creditTracks), text (music-credits.txt,
 * or null) }. For Deliver's files and the player page's note (extras.creditNote(tracks)).
 */
function credits(dir, addons, { engineRoot, title = '' } = {}) {
  const rows = (Array.isArray(addons) ? addons : []).map((a) => (isPlain(a) && a.planned && isPlain(a.credit)
    ? { ...a, credit: { ...a.credit, changes: shippedChanges(engineRoot, a.credit.id) || a.credit.changes || null } } : a));
  const scenes = sceneCredits(dir, { engineRoot });
  return { tracks: refine.creditTracks(rows, { scenes }), text: refine.musicCredits(rows, title, { scenes }) };
}

/** Each Live Motion piece's stem and music, for Deliver's extras: [{ title, stem, music }] (absolute paths or null). */
function liveFiles(dir) {
  let pieces = [];
  try { pieces = lm().pieces(dir); } catch { return []; }
  const sound = refine.sceneSound(pres(dir)).sound;
  const spliced = new Set(plannedRows(dir).rows.map((r) => r.source.id));
  const out = [];
  for (const p of pieces) {
    if (p.placement === 'slide' ? !sound.has(p.n) : !spliced.has(p.id)) continue;
    const f = (name) => { const x = pres(dir, p.folder, 'score', name); return exists(x) ? x : null; };
    const stem = f('stem.wav');
    if (stem) out.push({ title: p.title, stem, music: f('music.wav') });
  }
  return out;
}

/**
 * What Deliver hands over, as its timelines: { film (the base film's), tight (or null), refined (or null), delivered
 * (the one the delivered video has) }. As flow.deliver chooses it: Refine's output when there's anything to apply (the
 * add-ons, the planned rows among them, else the tightening); the film with the storyboard's pieces spliced in when
 * Deliver takes it as it is (the Wave 3 ruling: flow.deliver records the choice, stages.deliver.spliced, before its
 * hooks run, and the splice is still current); else the film.
 */
function deliveredTimeline(dir, st) {
  const o = refine.outputs(dir);
  const film = readJson(o.filmTimeline);
  const addons = Array.isArray(st && st.addons) ? st.addons : [];
  const tightOn = Boolean(st && st.tighten && st.tighten.on);
  const tight = tightOn ? readJson(o.tightTimeline) : null;
  const deliver = st && isPlain(st.stages) && isPlain(st.stages.deliver) ? st.stages.deliver : {};
  const spliced = deliver.spliced === true && !tightOn ? current(dir, 'film') : null;
  const refined = spliced ? readJson(spliced.timeline) : addons.length ? readJson(o.timeline) : null;
  return { film, tight, refined, delivered: refined || tight || film };
}

/**
 * The narration's words in the delivered video, for its captions: each slide's word timings (real-words.py on the
 * narration the film was made with, isolated and sandboxed, kept in presentation/refine/words/) carried into it.
 * deps: { python, engineRoot, env, signal }. → [{ text, start, end }] (none without timings)
 */
async function captionWords(dir, st, deps = {}) {
  const t = deliveredTimeline(dir, st);
  if (!t.film || !Array.isArray(t.film.slides)) return [];
  const realWords = path.join(deps.engineRoot || '', 'skills', 'avatar-presentation', 'templates', 'hyperframes', 'real-words.py');
  const words = {};
  for (const sl of t.film.slides) {
    if (deps.signal && deps.signal.aborted) break;
    words[sl.n] = await refine.slideWords({ pres: pres(dir), n: sl.n, draft: Boolean(t.film.draft), seconds: sl.narration_seconds, python: deps.python, realWords,
      env: deps.env, signal: deps.signal });
  }
  return require('./extras').captionWords({ film: t.film, words, tight: t.tight, refined: t.refined });
}

module.exports = { outputsFor, plannedRows, withPaths, current, status, splice, applyDraft, syncRecord, materialise, sceneCredits, credits, liveFiles,
  deliveredTimeline, captionWords, spliceKey };
