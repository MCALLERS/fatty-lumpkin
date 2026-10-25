'use strict';
// Jazz's flow extension (W3-03; PLAN §2.8, §2.14 `jazz`, draft-ux §10.2; decisions.md D13 and the Wave 3 rulings): the
// rules the play-through (flow.playThrough) approves by, who is playing, the Generate $ upgrade's plan change, and what
// the page sees, through the flow's hooks (ext/index.js).
//
//   open          view.jazz: the mode, the flag (`through`), whether it's playing and on which step, where it stopped and
//                 why, the stages Jazz approved (the rail's ♪), the `Generate $` chips (a Cosmos or cut scene drawn in
//                 code, priced, where this surface can pay and has a key) and why Cosmos and cut scenes are drawn in code
//   settle        a play-through FLPT quit in the middle of (its record says running, but nothing plays it in the process
//                 that started it): stopped there, "Stopped before it finished."
//   spendBlocked  while Jazz plays
//
// The rules (flow.playThrough reads them; nothing here approves anything itself):
//   deckProblems    the deck's check_deck: no layout problem (the deck run's own check) and no plan problem
//                   (stagetools.planChecks: the storyboard's shots, the modules, the scene plans, the calls)
//   scriptProblems  within ±15 % of the talk's length, every cue said, one script slide per deck slide
//   liveWork        the Live Motion pieces and animator marks still to make, and those that failed
//   scenesWork      the generated Cosmos and cut scenes still to make, priced at the providers' table prices (one
//                   approval for all of them, D13), or why they can't be made
//   allowance       that approval, spent step by step (generate.js asks it before its own dialog)
// Nothing here spends.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const storyboard = require('../storyboard');
const scenes = require('../scenes');
const motion = require('../motion');
const modules = require('../modules');
const livemotion = require('../livemotion');
const animators = require('../animators');

const isPlain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const pres = (dir, ...p) => path.join(dir, 'presentation', ...p);
const usd2 = (n) => Math.round(n * 100) / 100;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const PAID = new Set(['cosmos', 'cutscene']);
const INTERRUPTED = 'Stopped before it finished.';
const SCRIPT_SLACK = 0.15; // the script within ±15 % of the talk's length

// ── who is playing (this process) ──────────────────────────────────────────────────────────────────────────────

const playing = new Map(); // episode folder → { ctrl, stage, everyStep }
const keyOf = (dir) => path.resolve(String(dir));
const playingOf = (dir) => playing.get(keyOf(dir)) || null;
function startPlaying(dir, run) {
  if (playing.has(keyOf(dir))) throw new Error('Jazz is already playing.');
  playing.set(keyOf(dir), run);
}
const stopPlaying = (dir) => { playing.delete(keyOf(dir)); };

/** Is the process that wrote `pid` still there? (Signal 0 asks without sending anything.) */
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return Boolean(e && e.code === 'EPERM'); }
}

// ── the rules ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Why Jazz may not approve the deck, as short lines ([] when it may): the deck run's own layout check (its `qa`, from
 * check_deck's layout pass; a deck whose layout wasn't checked isn't approved) and every plan problem check_deck reports.
 */
function deckProblems(dir, st, { engineRoot = null, projectsDir = null } = {}) {
  const out = [];
  const deck = (st && st.stages && st.stages.deck) || {};
  if (!Array.isArray(deck.qa)) out.push('The layout wasn\'t checked.');
  else if (deck.qa.length) out.push(`${deck.qa.length} layout problem${deck.qa.length === 1 ? '' : 's'}: ${String(deck.qa[0]).slice(0, 200)}`);
  let plan = [];
  try { plan = require('../stagetools').planChecks(dir, { engineRoot, projectsDir }); } catch (e) { plan = [`The deck's plan couldn't be read: ${String(e && e.message ? e.message : e).slice(0, 200)}`]; }
  for (const p of plan) out.push(String(p).split('\n')[0].slice(0, 300));
  return out;
}

/**
 * Why Jazz may not approve the script ([] when it may): within ±15 % of the talk's length (the pipeline's own
 * estimate), every cue a build, inset or cartoon waits for said in order (motion.checkCues), and one script slide per
 * deck slide.
 */
function scriptProblems(dir, st) {
  let text = '';
  try { text = fs.readFileSync(pres(dir, 'script.md'), 'utf8'); } catch { return ['There is no script yet.']; }
  const episode = require('../episode');
  const slides = episode.parseScript(text);
  if (!slides.length) return ['The script has no slides.'];
  const out = [];
  const minutes = Number(st && st.intake && st.intake.minutes) || 5;
  const target = minutes * 60;
  const total = episode.estimateSeconds(slides);
  const off = (total - target) / target;
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  if (Math.abs(off) > SCRIPT_SLACK + 1e-9) out.push(`The script runs ${mmss(total)} against ${mmss(target)} (${off > 0 ? '+' : ''}${Math.round(off * 100)} %).`);
  const order = motion.readDeck(dir).order || [];
  if (order.length && order.length !== slides.length) out.push(`The script has ${slides.length} slides; the deck has ${order.length}.`);
  let cues = [];
  try { cues = motion.checkCues(dir); } catch { cues = []; }
  if (cues.length) out.push(`${cues.length} cue${cues.length === 1 ? '' : 's'} the narration doesn't say: ${cues[0].slice(0, 200)}`);
  return out;
}

/**
 * Live Motion as Jazz sees it: { crews (keys of the pieces a scene crew still has to make: never made, or failed),
 * stale (keys made whose files changed since: a draft's re-timing writes beats.json, so after a draft every finished
 * piece reads stale; Jazz never pays a crew to make one again), marks (the animator's slides still to make: [{ n, id }],
 * the user's own left out), allMarks (every mark that's FLPT's), ok (keys whose take is ok, stale ones included),
 * failed (keys whose last run failed), pieces (livemotion.view) }.
 */
function liveWork(dir) {
  let pieces = [];
  try { pieces = livemotion.view(dir); } catch { pieces = []; }
  const stale = pieces.filter((p) => p.status === 'stale').map((p) => p.key);
  let crews = [];
  try { crews = require('../scenecrew').toMake(dir).map((p) => p.key).filter((k) => !stale.includes(k)); } catch { crews = []; }
  let marks = [];
  try { marks = animators.view(dir).filter((a) => !a.theirs); } catch { marks = []; }
  return {
    crews,
    stale,
    marks: marks.filter((a) => !a.made).map((a) => ({ n: a.n, id: a.id })),
    allMarks: marks.map((a) => ({ n: a.n, id: a.id })),
    ok: pieces.filter((p) => p.status === 'ok' || p.status === 'stale' || p.status === 'yours').map((p) => p.key),
    failed: pieces.filter((p) => p.status === 'failed').map((p) => p.key),
    pieces,
  };
}

/**
 * The generated Cosmos cartoons and cut scenes still to make (D13): { todo: [{ key, title, kind, usd }], usd (their
 * table prices, as one approval), blocked: [lines] (a plan the Scenes step can't make yet) }. A piece is done when its
 * clip is put together from what's approved (scenes.view: a clip, not out of date).
 */
function scenesWork(dir, { routes = {} } = {}) {
  let v;
  try { v = scenes.view(dir, { routes }); } catch (e) { return { todo: [], usd: 0, blocked: [String(e && e.message ? e.message : e).slice(0, 300)], pieces: [] }; }
  const blocked = v.pieces.filter((p) => (p.problems || []).length).map((p) => `${p.title}: ${p.problems[0]}`);
  const todo = v.pieces.filter((p) => !(p.clip && !p.outdated)).map((p) => ({ key: p.key, title: p.title, kind: p.kind, usd: Number(p.total) || 0 }));
  return { todo, usd: usd2(todo.reduce((a, p) => a + p.usd, 0)), blocked, pieces: v.pieces };
}

/**
 * Jazz's one approval for the generated scenes, spent step by step: take(usd) answers whether a step of that price
 * fits in what's left (and books it); the rest stays for the next. generate.js's makeScene asks it before its own
 * dialog, so a step inside the approval needs no second yes (decisions.md D13); one past it asks as always. Table
 * prices are rounded to the cent per step and per piece, so the steps may run a few cents over the approval in all
 * (ALLOWANCE_SLACK, once for the whole approval, never per step).
 */
const ALLOWANCE_SLACK = 0.05;
function allowance(usd) {
  const r4 = (n) => Math.round(n * 1e4) / 1e4; // booked to the ten-thousandth, as the broker books
  let left = usd2(Math.max(0, Number(usd) || 0));
  let slack = ALLOWANCE_SLACK;
  return Object.freeze({
    by: 'jazz',
    left: () => usd2(left),
    take(x) {
      const n = Number(x);
      if (!Number.isFinite(n) || n < 0) return false;
      const over = r4(Math.max(0, n - left));
      if (over > slack + 1e-9) return false;
      slack = r4(slack - over);
      left = r4(Math.max(0, left - n));
      return true;
    },
  });
}

// ── Generate $ (the draft's chip): a Cosmos or cut scene drawn in code, generated from now on ─────────────────────

/**
 * A code Cosmos's beats as the Scenes step's keyframes: cue and picture each, exactly one hero, at least two (a cartoon
 * needs two keyframes: a scene of one beat, or only an idea, becomes a wide shot and a close shot of it, the hero
 * second, the cue kept on the first).
 */
function beatsFromScene(scene, fallback) {
  const idea = String((isPlain(scene) && typeof scene.idea === 'string' && scene.idea) || fallback || '').trim();
  const raw = (isPlain(scene) && Array.isArray(scene.beats) ? scene.beats : []).filter(isPlain).slice(0, 6);
  let beats = raw.map((b) => ({ ...(typeof b.cue === 'string' && b.cue.trim() ? { cue: b.cue.trim().slice(0, 200) } : {}),
    picture: String((typeof b.picture === 'string' && b.picture.trim()) || idea).trim().slice(0, 800),
    hero: b.hero === true })).filter((b) => b.picture);
  if (beats.length < 2) {
    const one = beats[0] || (idea ? { picture: idea.slice(0, 800) } : null);
    if (!one) return [];
    beats = [{ ...(one.cue ? { cue: one.cue } : {}), picture: `A wide shot: ${one.picture}`.slice(0, 800), hero: false },
      { picture: `A close shot: ${one.picture}`.slice(0, 800), hero: true }];
  }
  let hero = beats.findIndex((b) => b.hero);
  if (hero < 0) hero = Math.floor(beats.length / 2);
  beats.forEach((b, k) => { b.hero = k === hero; });
  return beats;
}

/** A code cut scene's seconds as the Scenes step's shots: 2–4 shots of 4–10 s, their pictures from its beats or idea. */
function shotsFromScene(scene, seconds, fallback) {
  const total = clamp(Math.round(Number(seconds) || 8), 8, 30);
  const n = clamp(Math.ceil(total / 6), 2, 4);
  const per = clamp(Math.round(total / n), 4, 10);
  const beats = (isPlain(scene) && Array.isArray(scene.beats) ? scene.beats : []).filter(isPlain);
  const idea = String((isPlain(scene) && scene.idea) || fallback || 'the scene').trim().slice(0, 800);
  return Array.from({ length: n }, (_, k) => ({ seconds: per, picture: String((beats[k] && typeof beats[k].picture === 'string' && beats[k].picture.trim()) || idea).slice(0, 800), action: '' }));
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 1)}\n`);
  fs.renameSync(tmp, file);
}

/**
 * The plan side of `Generate $`: the shot made Generated on the storyboard (its approval kept: the deck was built from
 * it as it is) and its modules.json entry made a generated piece the Scenes step can make (a Cosmos's keyframes from
 * its scene's beats, a cut scene's shots from its seconds; the scene stays, so Draw it in code brings it back). The
 * slide's bubble stays hidden (media.json follows). → { key (the Scenes step's), kind, shot, title, changed }
 */
function upgradePlan(dir, shotId) {
  const board = storyboard.read(dir);
  const shot = board && board.shots.find((s) => s.id === shotId);
  if (!shot || !PAID.has(shot.module)) throw new Error('Only a Cosmos or a cut scene can be generated.');
  const file = pres(dir, 'deck', 'project', 'modules.json');
  const map = readJson(file);
  if (!isPlain(map)) throw new Error('The deck isn\'t built yet.');
  const order = motion.readDeck(dir).order || [];
  let key = null;
  let kind = null;
  let changed = false;
  if (shot.module === 'cosmos') {
    const id = Object.keys(isPlain(map.slides) ? map.slides : {}).find((x) => isPlain(map.slides[x]) && map.slides[x].shot === shotId && map.slides[x].module === 'cosmos');
    if (!id || !order.includes(id)) throw new Error('That shot isn\'t in the deck.');
    const e = map.slides[id];
    if (scenes.pieceWorking(dir, `cartoon:${id}`)) throw new Error('That one is still on its way.');
    if (modules.makeOf(e) !== 'generate') {
      e.make = 'generate';
      if (!isPlain(e.cartoon) || !Array.isArray(e.cartoon.beats)) e.cartoon = { beats: beatsFromScene(e.scene, shot.title || shot.idea) };
      changed = true;
    }
    key = `cartoon:${id}`;
    kind = 'cartoon';
  } else {
    const list = Array.isArray(map.cutscenes) ? map.cutscenes : [];
    const i = list.findIndex((x) => isPlain(x) && x.shot === shotId);
    if (i < 0) throw new Error('That shot isn\'t in the deck.');
    const e = list[i];
    if (modules.makeOf(e) !== 'generate') {
      e.make = 'generate';
      if (!Array.isArray(e.shots)) e.shots = shotsFromScene(e.scene, e.seconds || shot.seconds, e.title || shot.title || shot.idea);
      changed = true;
    }
    key = `cutscene:${scenes.cutIds(list)[i]}`;
    kind = 'cutscene';
  }
  if (changed) writeJsonAtomic(file, map);
  if (shot.make !== 'generate') {
    const b = storyboard.read(dir);
    const s = b.shots.find((x) => x.id === shotId);
    s.make = 'generate';
    delete s.style;
    delete s.sound;
    storyboard.write(dir, b);
    changed = true;
  }
  motion.refreshMedia(dir);
  return { key, kind, shot: shotId, title: shot.title || '', changed };
}

/** A shot's Generated price at these routes (storyboard.price, as the board shows it), or null. */
function generatedPrice(board, shotId, routes = {}) {
  try {
    const b = storyboard.normalise(board);
    const s = b.shots.find((x) => x.id === shotId);
    if (!s || !PAID.has(s.module)) return null;
    s.make = 'generate';
    const line = storyboard.price(null, b, { routes }).scenes.lines.find((l) => l.shot === shotId);
    return line ? line.usd : null;
  } catch { return null; }
}

// ── what the page sees ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * view.jazz: { mode, through, running, stage, stoppedAt, why, problems, marks (stage ids approved by Jazz: the rail's ♪),
 * pieces (Live Motion pieces Jazz approved), canPlay, upgrades: [{ shot, title, module, usd }] (the draft's Generate $
 * chips: app and web, with a generation key, once the deck is built), code ('no-key' | 'surface' | null: why the plan
 * draws Cosmos and cut scenes in code) }.
 */
function viewOf(dir, st, { caps = null, routes = {} } = {}) {
  const episode = require('../episode');
  const j = episode.jazzOf(st);
  const s = st && st.stages && isPlain(st.stages.storyboard) ? st.stages.storyboard : {};
  let board = null;
  try { board = s.skipped && s.status === 'approved' ? null : storyboard.read(dir); } catch { board = null; }
  const mode = board ? board.mode : null;
  const marks = Object.fromEntries(episode.STAGE_IDS.filter((id) => st.stages[id] && st.stages[id].status === 'approved' && st.stages[id].approvedBy === 'jazz').map((id) => [id, true]));
  const live = isPlain(st.live) ? Object.values(st.live).filter((e) => isPlain(e) && e.approved && e.approvedBy === 'jazz').length : 0;
  const run = playingOf(dir);
  const current = episode.current(st);
  const canGen = storyboard.canGenerate(caps);
  const keyed = canGen && isPlain(caps) && caps.generation === true;
  const built = Boolean(readJson(pres(dir, 'deck', 'project', 'modules.json')));
  const upgrades = keyed && board && built
    ? board.shots.filter((x) => PAID.has(x.module) && x.make === 'code').map((x) => ({ shot: x.id, title: x.title || '', module: x.module, usd: generatedPrice(board, x.id, routes) }))
    : [];
  return {
    mode, through: j.through, running: Boolean(run) || false, stage: run ? run.stage || null : null,
    stoppedAt: j.stoppedAt, why: j.why, problems: j.problems,
    marks, pieces: live,
    canPlay: !run && j.through === 'draft' && s.status === 'approved' && !s.skipped && mode === 'jazz' && ['deck', 'script', 'animate', 'scenes', 'spend'].includes(current),
    upgrades,
    code: board && board.shots.some((x) => PAID.has(x.module)) ? (!canGen ? 'surface' : !keyed ? 'no-key' : null) : null,
  };
}

/** The caps the storyboard plans with, from the flow's host (ext/storyboard.capsFor). */
const capsOf = (d) => { try { return require('./storyboard').capsFor(d || {}); } catch { return null; } };
const routesOf = (d) => { try { return d && d.scenes && typeof d.scenes.routes === 'function' ? d.scenes.routes() : {}; } catch { return {}; } };

module.exports = {
  id: 'jazz',
  order: 60,
  hooks: {
    open(ctx, { dir, view }) {
      if (!isPlain(view) || !isPlain(view.state)) return view;
      let jazz = null;
      try { jazz = viewOf(dir, view.state, { caps: capsOf(ctx.d), routes: routesOf(ctx.d) }); } catch (e) { ctx.log(`Jazz: ${String(e && e.message ? e.message : e).slice(0, 200)}`); }
      return { ...view, jazz, running: Boolean(view.running) || Boolean(playingOf(dir)) };
    },
    settle(ctx, { dir, st }) {
      if (!isPlain(st) || !isPlain(st.jazz) || st.jazz.running !== true || playingOf(dir)) return st;
      // played by another process that's still there (the Mac app, read here by a CLI): its record stands
      if (st.jazz.pid && st.jazz.pid !== process.pid && alive(st.jazz.pid)) return st;
      const stoppedAt = ctx.episode.current(st);
      return { ...st, jazz: { ...st.jazz, running: false, stage: null, pid: null, stoppedAt, why: INTERRUPTED } };
    },
    spendBlocked(ctx, { dir }) {
      return playingOf(dir) ? 'Jazz is playing.' : null;
    },
  },
  // for flow.js, api/jazz.js and the tests (the loader reads only id, order and hooks)
  deckProblems, scriptProblems, liveWork, scenesWork, allowance, upgradePlan, generatedPrice, beatsFromScene, shotsFromScene, viewOf, capsOf, routesOf,
  playingOf, startPlaying, stopPlaying, alive, INTERRUPTED, SCRIPT_SLACK, ALLOWANCE_SLACK,
};
