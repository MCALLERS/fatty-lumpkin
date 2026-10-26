'use strict';
// Live Motion pieces (PLAN §2.3, §2.4, §2.6, §2.7, §2.14; W2-02): the scenes drawn in code, from the deck's plan in
// modules.json to a checked clip with its own sound. Electron-free (the plugin's tools get a copy); nothing here
// spends: the scene crew that writes a piece's code is scenecrew.js, and its money goes through the flow's broker.
//
// The pieces, keyed as the storyboard and the splice name them:
//   slide:<slide id>    a Motion Solo, a Motion Duet or a Cosmos drawn in code: narrated, in the slide's own folder
//                       presentation/hyperframes/slide_NN/, timed to the voice and rendered to media/slide_NN.mp4,
//                       written to media.json as a `flpt-scene` entry (motion.writeMedia)
//   between:<id>        a Solo ♪ (an interstitial, jsscenes[], id J<n>) or a cut scene drawn in code (cutscenes[] with
//                       "make": "code", id C<n>): unnarrated, in presentation/hyperframes/jsscene_<id>/, timed to its
//                       music, rendered to media/jsscene_<id>.mp4 with its stem at -21 LUFS and spliced into the film
//                       afterwards (interstitials.js): never in media.json, so a neighbour's lead or tail never moves
//
// A piece's folder holds the crew's four files (scene.js, beats.json, notes.md, kit-ext.js), pictures that came in
// through use_picture, and FLPT's own: scene.json (its record: kind, shot, style snapshot, seed, hold, first and
// last), crew.json (the crew's tool state), the generated host page (page.mjs: index.html, beats.js, assets/),
// renders/, check/, score/ (the stem, score.json) and takes/<n>/ (at most five). retime.py never sees these folders:
// motion.bespokeSlides skips a folder with scene.json, and jsscene_ folders aren't slides. Every render, still and meta
// read reads a fresh stage of the crew's files only (stageOf), so the lint's limits are on what the crew made.
//
//   pieces(dir) · pieceOf(dir, key) · checkPlan(dir) · planningLines(dir) · view(dir)
//   scaffold(dir, key, deps) · page(dir, key, deps) · timing(dir, key, deps) · alignBeats(beats, words) (pure)
//   renderNarrated(dir, which, deps)    every finished narrated piece timed to that run's voice, scored and rendered:
//                                       { scenes: { n: { video, audio, volume } }, problems } for motion.writeMedia
//   renderInterstitial(dir, key, deps)  a between piece scored on its music grid and rendered (fallback: true renders
//                                       a placeholder, its style's paper with no words, the only place one exists)
//   scorePass(dir, key, deps)           the stem: score.soundFor → sceneGrid → align-music → plan → write (rerun after
//                                       every retime)
//   drawInCode(dir, key, { broker })    a Cosmos or cut scene drawn in code from now on, in modules.json and its
//                                       storyboard shot, without staling the deck; after Spend it re-opens Spend (T20)
//   sync(dir)                           folders follow their slides; a piece that left the deck is parked, and comes
//                                       back when it returns (hyperframes/parked/); the clip it left in its old place
//                                       goes (its hash is in its record, rendered.sha: never taken for the user's)
//   saveTake · useTake · takesOf        takes/<n>/, at most five
// deps: { engineRoot, env (the toolchain's environment: PATH with node, FLPT_HYPERFRAMES, HYPERFRAMES_*), styles (a
//         styles.createStyles instance), retime(args, o) (a method script on the episode's Python, sandboxed),
//         renderScene(opts) and meta(opts) (tests and hosts may give their own), library (shipped CC BY tracks: a
//         `library:` track that isn't there plays the nearest score instead, DV13), files (the episode's own sound
//         files), signal, onLine }
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const modules = require('./modules');
const motion = require('./motion');
const score = require('./score');
const episode = require('./episode');
const stylesLib = require('./styles');

const SCENE = 'scene.json';
const CREW = 'crew.json';
const SCHEMA = 'flpt.scene/1';
const FPS = 30;
const HOLD = 0.5;
const TAKES_MAX = 5;
const BETWEEN = { min: 4, max: 30, seconds: 8 };
const KINDS = ['solo', 'duet', 'cosmos', 'interstitial', 'cutscene'];
const NARRATED = new Set(['solo', 'duet', 'cosmos']);
// What a crew session may spend (decisions.md, G0: 5 USD / 70 turns narrated, 3.5 USD / 50 turns between), before the
// broker's sessionCap; and how many renders its tools make (12 draft + 2 delivery).
const CAPS = { narrated: { usd: 5, turns: 70 }, between: { usd: 3.5, turns: 50 } };
const RENDERS = { draft: 12, delivery: 2 };
const FIRST = ['crossfade', 'from-previous', 'black'];
const LAST = ['poster', 'free', 'next-slide'];
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const JS_ID = /^J[0-9]{1,3}$/;
const SHOT = /^s[1-9][0-9]{0,3}$/;
const KEY = /^(slide|between):([A-Za-z0-9_-]{1,64})$/;
const MUSIC = /^(?:none|score:[a-z0-9][a-z0-9-]{0,63}|library:[a-z0-9][a-z0-9-]{0,63}|file:[A-Za-z0-9._-]{1,128})$/;
const TILE = { solo: 'Solo', duet: 'Duet', cosmos: 'Cosmos in code', interstitial: 'Solo ♪', cutscene: 'Cut scene in code' };
// The crew's files: the only ones it writes (writepolicy's scene stage), and what a take keeps.
const CREW_FILES = ['scene.js', 'beats.json', 'notes.md', 'kit-ext.js'];

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const exists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const readJson = (p, fallback = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } };
const pad2 = (n) => String(n).padStart(2, '0');
const r3 = (x) => Math.round(x * 1000) / 1000;
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const pres = (dir, ...p) => path.join(dir, 'presentation', ...p);
const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

/** beats.json as FLPT writes it: the top level two-space, one beat per line (align-music.mjs's shape). */
function beatsText(j) {
  const { beats, words, ...rest } = j;
  const fmt = (v) => JSON.stringify(v);
  const top = JSON.stringify(rest, null, 2).replace(/\n}$/, '');
  const lines = (beats || []).map((b) => `    ${fmt(b)}`);
  const w = Array.isArray(words) ? `,\n  "words": [\n${words.map((x) => `    ${fmt(x)}`).join(',\n')}\n  ]` : '';
  return `${top === '{}' ? '{' : `${top},`}\n  "beats": [\n${lines.join(',\n')}\n  ]${w}\n}\n`;
}

// ── the runtime's tools (ES modules) ───────────────────────────────────────────────────────────────────────────────

const runtimeDir = (engineRoot) => path.join(engineRoot, 'runtime', 'flpt-live');
const toolPath = (engineRoot, name) => path.join(runtimeDir(engineRoot), 'tools', name);
const loaded = new Map();
/** One of flpt-live's tools (page.mjs, lint.mjs, render-direct.mjs, align-music.mjs), loaded once. */
async function tool(engineRoot, name) {
  const f = toolPath(engineRoot, name);
  if (!loaded.has(f)) loaded.set(f, import(pathToFileURL(f).href));
  return loaded.get(f);
}
const runtimeVersion = (engineRoot) => { try { return fs.readFileSync(path.join(runtimeDir(engineRoot), 'VERSION'), 'utf8').trim(); } catch { return '1.0.0'; } };

/** A program on the toolchain's PATH (node, ffmpeg), or null. */
function which(name, env = {}) {
  for (const d of String(env.PATH || '').split(':').filter(Boolean)) {
    const p = path.join(d, name);
    try { fs.accessSync(p, fs.constants.X_OK); if (fs.statSync(p).isFile()) return p; } catch { /* not here */ }
  }
  return null;
}
/** The toolchain's node (never Electron's own binary, which would start another app). */
const nodeOf = (env = {}) => env.FLPT_NODE || which('node', env);
const ffmpegOf = (env = {}) => env.HYPERFRAMES_FFMPEG_PATH || env.FLPT_FFMPEG || which('ffmpeg', env);
const ffprobeOf = (env = {}) => env.HYPERFRAMES_FFPROBE_PATH || env.FLPT_FFPROBE || which('ffprobe', env);
/** The environment the runtime's tools get: the toolchain's, with its node named (FLPT_NODE). */
function toolEnv(env = {}) {
  const node = nodeOf(env);
  return { ...env, ...(node ? { FLPT_NODE: node } : {}) };
}

// Where else the shipped tracks may be, when they aren't beside the engine: the plugin's are the Mac app's own (DV13)
let tracksElsewhere = null;
/** A host's own finder for the shipped tracks (the plugin: the Mac app's, common.appTracks): () → [shipped items]. */
function useTracks(fn) { tracksElsewhere = typeof fn === 'function' ? fn : null; }
/** The engine this module belongs to (the one score.js finds), for callers that don't name one. */
const ownEngine = () => { try { return path.resolve(score.runtimeDir(), '..', '..', '..'); } catch { return null; } };

/**
 * The shipped CC BY tracks: beside the engine (Resources/addons, or app/assets/addons in development), else where the
 * host found them (useTracks: the plugin plays the Mac app's own, never a copy of its own).
 */
function shippedLibrary(engineRoot) {
  const addons = require('./addons');
  const root = engineRoot || ownEngine();
  for (const d of root ? [path.join(root, '..', 'addons'), path.join(root, '..', 'app', 'assets', 'addons')] : []) {
    if (exists(path.join(d, 'manifest.json'))) return addons.readShipped(d);
  }
  if (!tracksElsewhere) return [];
  try { const found = tracksElsewhere(); return Array.isArray(found) ? found : []; } catch { return []; }
}

/** What a shot says when its library track isn't on this computer (DV13). */
const NO_TRACK = 'Library tracks come with the Mac app · Score instead';
/**
 * DV13: a `library:` track this computer doesn't have (the plugin without the Mac app's tracks) plays the nearest
 * flpt-score preset instead, and its shot says so in one line. → { music: 'score:<preset>', instead, line } or null
 */
function trackFallback(music, deps = {}) {
  const m = /^library:([a-z0-9][a-z0-9-]{0,63})$/.exec(String(music || ''));
  if (!m) return null;
  const lib = deps.library || shippedLibrary(deps.engineRoot);
  if (lib.some((x) => x && x.id === m[1] && (x.kind == null || x.kind === 'music') && x.filePath)) return null;
  let preset = score.DEFAULT_PRESET;
  try { preset = score.nearestPreset(m[1], { engineRoot: deps.engineRoot }); } catch { /* no score engine to measure against: the default */ }
  return { music: `score:${preset}`, instead: m[0], line: NO_TRACK };
}

// ── the pieces ────────────────────────────────────────────────────────────────────────────────────────────────────

/** A cut scene's id: scenes.js's own numbering (generated and drawn-in-code ones each on their own, each unique). */
const cutIds = (list) => require('./scenes').cutIds(list);

function planOf(e) {
  const s = isObj(e && e.scene) ? e.scene : {};
  const beats = (Array.isArray(s.beats) ? s.beats : []).filter(isObj).slice(0, 40).map((b) => {
    const out = {};
    if (typeof b.cue === 'string' && b.cue.trim()) out.cue = str(b.cue, 200);
    else if (typeof b.at === 'string' || typeof b.at === 'number') out.at = typeof b.at === 'number' ? b.at : str(b.at, 40);
    for (const k of ['fx', 'picture']) if (typeof b[k] === 'string' && b[k].trim()) out[k] = str(b[k], k === 'picture' ? 400 : 40);
    if (b.sfx != null) out.sfx = typeof b.sfx === 'string' ? str(b.sfx, 20) : b.sfx;
    if (b.hero === true) out.hero = true;
    return out;
  });
  const sound = isObj(s.sound) ? s.sound : isObj(e && e.sound) ? e.sound : {};
  return {
    style: typeof s.style === 'string' ? s.style : null,
    idea: str(s.idea || (e && e.idea), 400),
    beats,
    refs: (Array.isArray(s.refs) ? s.refs : []).filter((r) => typeof r === 'string').map((r) => r.replace(/^refs\//, '')).filter((r) => SAFE_ID.test(r)).slice(0, 4),
    sound: { ...(typeof sound.music === 'string' && MUSIC.test(sound.music) ? { music: sound.music } : {}), ...(['off', 'soft', 'on'].includes(sound.sfx) ? { sfx: sound.sfx } : {}) },
    first: FIRST.includes(s.first) ? s.first : 'crossfade',
    last: LAST.includes(s.last) ? s.last : 'poster',
  };
}

function capsOf(kind) { return NARRATED.has(kind) ? CAPS.narrated : CAPS.between; }

/**
 * Every Live Motion piece the deck plans, in film order (a between piece after the slide it follows):
 * [{ key, kind, placement, module, shot, id, n, after, afterN, title, seconds, plan, seam, folder, clip, caps }].
 * `folder` and `clip` are relative to presentation/.
 */
function pieces(dir) {
  const { order, modules: map } = motion.readDeck(dir);
  const entries = isObj(map && map.slides) ? map.slides : {};
  const slides = [];
  order.forEach((id, i) => {
    const e = isObj(entries[id]) ? entries[id] : null;
    if (!e || !modules.isScene(e) || !SAFE_ID.test(id)) return;
    const kind = e.module === 'motion-solo' ? 'solo' : e.module === 'motion-duet' ? 'duet' : 'cosmos';
    const n = i + 1;
    slides.push({
      key: `slide:${id}`, kind, placement: 'slide', module: e.module, shot: SHOT.test(String(e.shot)) ? e.shot : null, id, n, after: null, afterN: null,
      title: str(e.title || (e.scene && e.scene.title), 80) || id, seconds: null, plan: planOf(e), seam: null,
      folder: path.join('hyperframes', `slide_${pad2(n)}`), clip: path.join('media', `slide_${pad2(n)}.mp4`), caps: capsOf(kind),
    });
  });
  const between = [];
  const placeAfter = (after) => (typeof after === 'string' && after ? order.indexOf(after) + 1 : 0);
  const seamOf = (e) => ({ in: ['cut', 'fade', 'black'].includes(e.seam && e.seam.in) ? e.seam.in : 'cut', out: ['cut', 'fade', 'black'].includes(e.seam && e.seam.out) ? e.seam.out : 'cut' });
  for (const e of (Array.isArray(map && map.jsscenes) ? map.jsscenes : []).filter(isObj)) {
    if (!JS_ID.test(String(e.id))) continue;
    const afterN = placeAfter(e.after);
    if (e.after && !afterN) continue; // it follows a slide that isn't in the deck: check_deck says so
    between.push({
      key: `between:${e.id}`, kind: 'interstitial', placement: 'between', module: 'motion-solo', shot: SHOT.test(String(e.shot)) ? e.shot : null, id: e.id,
      n: null, after: e.after || '', afterN, title: str(e.title, 80) || e.id, seconds: clamp(Math.round(Number(e.seconds) || BETWEEN.seconds), BETWEEN.min, BETWEEN.max),
      plan: planOf(e), seam: seamOf(e), folder: path.join('hyperframes', `jsscene_${e.id}`), clip: path.join('media', `jsscene_${e.id}.mp4`), caps: capsOf('interstitial'),
    });
  }
  const cuts = Array.isArray(map && map.cutscenes) ? map.cutscenes : [];
  const ids = cutIds(cuts);
  cuts.forEach((e, i) => {
    if (!isObj(e) || modules.makeOf(e) !== 'code') return;
    const id = `C${ids[i]}`;
    if (!SAFE_ID.test(id)) return;
    const afterN = placeAfter(e.after);
    if (e.after && !afterN) return;
    const shots = Array.isArray(e.shots) ? e.shots.filter(isObj) : [];
    const secs = Number(e.seconds) || shots.reduce((a, s) => a + (Number(s.seconds) || 0), 0) || BETWEEN.seconds;
    between.push({
      key: `between:${id}`, kind: 'cutscene', placement: 'between', module: 'cutscene', shot: SHOT.test(String(e.shot)) ? e.shot : null, id, cut: ids[i],
      n: null, after: e.after || '', afterN, title: str(e.title, 80) || `Cut scene ${i + 1}`, seconds: clamp(Math.round(secs), BETWEEN.min, BETWEEN.max),
      plan: planOf(e), seam: seamOf(e), folder: path.join('hyperframes', `jsscene_${id}`), clip: path.join('media', `jsscene_${id}.mp4`), caps: capsOf('cutscene'),
    });
  });
  // film order: each between piece right after the slide it follows (a cold open first), in the order the deck lists
  // them (the sort is stable)
  return [...slides, ...between].sort((a, b) => film(a) - film(b));
}
/** A piece's place in the film: its slide's number, a between piece just after the slide it follows. */
const film = (p) => (p.placement === 'slide' ? p.n : p.afterN + 0.5);

/** The piece for a key, or a plain error. */
function pieceOf(dir, key) {
  const p = pieces(dir).find((x) => x.key === key);
  if (!p) throw new Error('That Live Motion piece isn\'t in the deck any more.');
  return p;
}

/** The style a piece renders in: its plan's, its storyboard shot's, the board's default, else its kind's (styles.DEFAULTS). */
function styleRefOf(dir, piece, styles = null) {
  if (piece.plan.style) return piece.plan.style;
  let board = null;
  try { board = require('./storyboard').read(dir); } catch { board = null; }
  const shot = board && piece.shot ? board.shots.find((s) => s.id === piece.shot) : null;
  if (shot && shot.style) return shot.style;
  if (board && board.defaults && board.defaults.style && (piece.kind !== 'duet')) return board.defaults.style;
  // the catalog's guard knows a default it withdrew (W3-11): then the first shipped style still listed
  return (styles && typeof styles.defaultFor === 'function' ? styles.defaultFor(piece.kind) : stylesLib.DEFAULTS[piece.kind]) || 'riso';
}

// ── the folder and its record ─────────────────────────────────────────────────────────────────────────────────────

const folderOf = (dir, piece) => pres(dir, piece.folder);
const recordOf = (dir, piece) => readJson(path.join(folderOf(dir, piece), SCENE), null);
const crewState = (dir, piece) => readJson(path.join(folderOf(dir, piece), CREW), null) || { renders: { draft: 0, delivery: 0 }, rounds: [], looks: [], done: null };
const writeCrewState = (dir, piece, st) => writeJson(path.join(folderOf(dir, piece), CREW), st);
/** Is this folder a Live Motion piece's (FLPT's record, for this piece)? */
const ours = (dir, piece) => { const r = recordOf(dir, piece); return Boolean(r && r.schema === SCHEMA && r.key === piece.key); };
/**
 * What renders of the crew's files (scene.js, beats.json, kit-ext.js) as one hash: a change means a new round, a
 * between piece to render again. notes.md is the crew's own: changing it renders nothing, so it fixes nothing (a
 * look-fix-render pass). Whether a finished piece is out of date is contentSha's (below): a re-time changes this hash.
 */
const RENDER_FILES = CREW_FILES.filter((f) => f !== 'notes.md');
function filesSha(folder) {
  const h = crypto.createHash('sha256');
  for (const f of RENDER_FILES) { h.update(`${f}\0`); try { h.update(fs.readFileSync(path.join(folder, f))); } catch { h.update('-'); } }
  return h.digest('hex').slice(0, 16);
}
/**
 * Pure: beats.json without what timing writes (align: its duration, hold and words; a cued beat's t, end and word; an
 * `at` beat's t and end), so what's left is the crew's (beat names, cues, effects, a beat's own t). Not JSON: as it is.
 */
function crewBeats(text) {
  let b;
  try { b = JSON.parse(text); } catch { return text; }
  if (!isObj(b)) return text;
  const rest = { ...b };
  for (const k of ['duration', 'hold', 'words', 'beats']) delete rest[k];
  const own = (Array.isArray(b.beats) ? b.beats : []).map((x) => {
    if (!isObj(x)) return x;
    const timed = typeof x.cue === 'string' && x.cue.trim() ? ['t', 'end', 'word'] : x.at != null ? ['t', 'end'] : [];
    const keep = { ...x };
    for (const k of timed) delete keep[k];
    return keep;
  });
  return JSON.stringify({ ...rest, beats: own });
}
/**
 * What the crew made, as one hash: scene.js, kit-ext.js, notes.md and beats.json's own fields (crewBeats), never the
 * seconds a re-time writes. A finished piece is out of date ("stale") only when this changed since done, so a film's
 * re-time to the filmed voice (beats.json's times rewritten) leaves it current (decisions.md, "Stale after Film").
 */
function contentSha(folder) {
  const h = crypto.createHash('sha256');
  for (const f of CREW_FILES) {
    h.update(`${f}\0`);
    let buf = null;
    try { buf = fs.readFileSync(path.join(folder, f)); } catch { buf = null; }
    h.update(buf == null ? '-' : f === 'beats.json' ? crewBeats(buf.toString('utf8')) : buf);
  }
  return h.digest('hex').slice(0, 16);
}
/** Is a finished piece out of date: what the crew made changed since done (a record from before contentSha: its files). */
const isStale = (folder, rec) => Boolean(rec && rec.ok && (rec.shaContent ? rec.shaContent !== contentSha(folder) : rec.shaDone && rec.shaDone !== filesSha(folder)));
/** The one integer seed a piece's stem and its Stage preview share: api/sound.js's own seedFor (FNV-1a of its key). */
const seedOf = (key) => require('./api/sound').seedFor(key);

function stylesFor(deps = {}) {
  if (deps.styles) return deps.styles;
  return stylesLib.createStyles({ engineRoot: deps.engineRoot, projectsDir: deps.projectsDir || null, mediaRoot: null });
}

/**
 * The style a piece's folder renders from: the episode's snapshot (taken on first use, then never changed), its
 * style.json, and what the crew may be shown (crewView: 'shipped' or 'untrusted'). → { id, version, dir, style, trust, view }
 */
function styleFor(dir, piece, deps = {}) {
  const styles = stylesFor(deps);
  const rec = recordOf(dir, piece);
  let snap = null;
  if (rec && rec.style && rec.style.id) {
    const d = styles.snapshotDir(dir, rec.style.id);
    if (d) snap = { id: rec.style.id, version: rec.style.version, dir: d };
  }
  if (!snap) {
    const s = styles.snapshot(dir, styleRefOf(dir, piece, styles));
    snap = { id: s.id, version: s.version, dir: s.dir, hash: s.hash };
  }
  const style = readJson(path.join(snap.dir, 'style.json'), {}) || {};
  let view = null;
  try { view = styles.crewView(snap.dir); } catch { view = null; }
  return { ...snap, style, trust: view ? view.trust : 'untrusted', view };
}

/**
 * The beats a folder starts with: the plan's, the first of them under the starter's own beat names (so the starter
 * already lands on the plan's cues), the rest named from their cue; with no plan, the starter's.
 */
function startBeats(piece, starter) {
  const own = (Array.isArray(starter && starter.beats) ? starter.beats : []).filter((b) => isObj(b) && typeof b.name === 'string');
  if (!piece.plan.beats.length) return own.map((b) => ({ ...b }));
  const used = new Set(own.map((b) => b.name));
  const nameFor = (b, i) => {
    const base = String(b.cue || b.at || `beat ${i + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').split('-').slice(0, 3).join('-') || `b${i + 1}`;
    let n = base;
    for (let k = 2; used.has(n); k++) n = `${base}-${k}`;
    used.add(n);
    return n;
  };
  return piece.plan.beats.map((b, i) => ({ name: i < own.length ? own[i].name : nameFor(b, i), ...b }));
}

/**
 * The piece's folder, from its style's starter: scene.json (FLPT's record), beats.json (the plan's beats, named), the
 * starter's scene.js, notes.md, crew.json, and the generated page. An existing folder of this piece is kept (fresh:
 * true parks it and starts again); a folder that isn't FLPT's is the user's and stays. → { created, folder, style }
 */
async function scaffold(dir, key, deps = {}) {
  const piece = typeof key === 'string' ? pieceOf(dir, key) : key;
  const folder = folderOf(dir, piece);
  if (isDir(folder) && fs.readdirSync(folder).length) {
    if (ours(dir, piece) && !deps.fresh) return { created: false, folder, style: recordOf(dir, piece).style };
    if (ours(dir, piece)) park(dir, folder, piece.key);
    else if (exists(path.join(folder, motion.MARKER))) fs.rmSync(folder, { recursive: true, force: true }); // the engine's: it remakes it
    else if (exists(path.join(folder, 'scene.json')) || exists(path.join(folder, 'flpt-animator.json'))) park(dir, folder, piece.key);
    else throw new Error(`${piece.folder} is an animation of your own: it stays as it is.`);
  }
  const restored = !deps.fresh && restore(dir, piece);
  if (restored) return { created: false, restored: true, folder, style: recordOf(dir, piece).style };
  const s = styleFor(dir, piece, deps);
  const starterDir = path.join(s.dir, path.dirname(String((s.style.files && s.style.files.starter) || 'starter/scene.js')));
  const starterJs = path.join(starterDir, 'scene.js');
  const starter = readJson(path.join(starterDir, 'beats.json'), null);
  fs.mkdirSync(path.join(folder, 'assets', 'pictures'), { recursive: true });
  const placement = piece.kind === 'duet' ? 'duet' : piece.placement === 'between' ? 'interstitial' : 'solo';
  // the record first: a folder without it would pass for the user's own
  writeJson(path.join(folder, SCENE), {
    schema: SCHEMA, made: 'Fatty Lumpkin Presentation Tool: the Live Motion crew', key: piece.key, kind: piece.kind, shot: piece.shot, slide: piece.n, id: piece.id,
    style: { id: s.id, version: s.version, sha: s.hash || stylesLib.contentHash(s.dir), scope: s.trust === 'shipped' ? 'shipped' : 'episode' },
    runtime: `flpt-live@${runtimeVersion(deps.engineRoot)}`, layers: ['canvas'], seed: seedOf(piece.key), bubble: piece.kind === 'duet', hold: HOLD,
    first: piece.plan.first, last: piece.plan.last, keyframes: [], costMsPerFrame: Number(s.style.cost && s.style.cost.msPerFrame) || null,
    ok: false, at: new Date().toISOString(),
  });
  const beats = { style: s.id, placement, hold: HOLD, ...(piece.seconds ? { duration: piece.seconds } : {}), beats: startBeats(piece, starter) };
  fs.writeFileSync(path.join(folder, 'beats.json'), beatsText(beats));
  if (exists(starterJs)) fs.copyFileSync(starterJs, path.join(folder, 'scene.js'));
  else fs.writeFileSync(path.join(folder, 'scene.js'), `FLPT.scene({\n  style: '${s.id}',\n  layers: ['canvas'],\n  frame(ctx, t) {\n  },\n});\n`);
  fs.writeFileSync(path.join(folder, 'notes.md'), `# ${piece.title}\n`);
  crewWritable(folder);
  writeCrewState(dir, piece, { renders: { draft: 0, delivery: 0 }, rounds: [], looks: [], done: null });
  if (deps.engineRoot && deps.page !== false) {
    try { await page(dir, piece, { ...deps, styleDir: s.dir, styleId: s.id }); } catch { /* the page is made again before each render */ }
  }
  return { created: true, folder, style: { id: s.id, version: s.version, trust: s.trust } };
}

/**
 * The generated host page, in the piece's folder (the crew can't write any of it): index.html, beats.js and assets/
 * (the runtime, the guard, the shared kits, the style's kit and fonts, files.js). host: 'hf' (the default), 'preview'
 * (the Stage) or 'direct'. → page.mjs's answer ({ index, duration, frames, hold, style, scenes, kitExt, … })
 */
async function page(dir, key, deps = {}) {
  const piece = typeof key === 'string' ? pieceOf(dir, key) : key;
  const folder = folderOf(dir, piece);
  if (!ours(dir, piece)) throw new Error('Set up the piece\'s folder first.');
  const rec = recordOf(dir, piece);
  const styleDir = deps.styleDir || stylesFor(deps).snapshotDir(dir, rec.style.id);
  if (!styleDir) throw new Error(`The episode has no copy of the ${rec.style.id} style.`);
  const { buildPage } = await tool(deps.engineRoot, 'page.mjs');
  const b = readJson(path.join(folder, 'beats.json'), {}) || {};
  const duration = Number(deps.duration) || Number(b.duration) || piece.seconds || 8;
  // the style's copy here is made fresh each time: the snapshot's files are read-only, and their copies must not be
  // (a render copies this folder into its own work folder and writes the kit there again)
  fs.rmSync(path.join(folder, 'assets', 'styles'), { recursive: true, force: true });
  const out = buildPage({ scene: folder, work: folder, host: deps.host || 'hf', duration, hold: HOLD, styles: { [rec.style.id]: styleDir } });
  writable(path.join(folder, 'assets'));
  return out;
}

/** The crew's own files writable (a starter copied from a frozen snapshot keeps its read-only mode). */
function crewWritable(folder) {
  for (const f of CREW_FILES) { const p = path.join(folder, f); try { if (fs.statSync(p).isFile()) fs.chmodSync(p, 0o644); } catch { /* not there */ } }
}

/** Every file below a folder made writable by its owner (copies of a frozen snapshot keep its read-only modes). */
function writable(root) {
  let names = [];
  try { names = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of names) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) writable(p);
    else if (e.isFile()) { try { fs.chmodSync(p, fs.statSync(p).mode | 0o200); } catch { /* not ours */ } }
  }
}

// ── timing: the voice is the clock (narrated), the music grid is (between) ───────────────────────────────────────────

/** The words of a cue, normalised as motion.norm does. */
const tokens = (s) => motion.norm(s).split(' ').filter(Boolean);

/** Where a cue is said: its first word's start, its last word's end and the word, after `after` (cues in order). */
function matchCue(words, cue, after = -Infinity) {
  const toks = [];
  const owner = [];
  words.forEach((w, i) => tokens(w.text || w.word || '').forEach((t) => { toks.push(t); owner.push(i); }));
  const want = tokens(cue);
  for (let i = 0; want.length && i <= toks.length - want.length; i++) {
    if (!want.every((t, k) => toks[i + k] === t)) continue;
    const a = words[owner[i]];
    const z = words[owner[i + want.length - 1]];
    if (Number(a.start) > after) return { start: Number(a.start), end: Number(z.end != null ? z.end : z.start), word: String(a.text || a.word || '') };
  }
  return null;
}

/**
 * Pure: every beat with a cue timed to its words (piece time), in spoken order: t = the first word's start, end = the
 * last word's end. A cue the voice doesn't say keeps its old t (if any) and is reported. Beats with `at` ride the
 * music (alignMusic); beats with neither keep their t. → { beats, placed: [name], missed: [{ name, cue }] }
 */
function alignBeats(beats, words) {
  let last = -Infinity;
  const placed = [];
  const missed = [];
  const out = (Array.isArray(beats) ? beats : []).filter(isObj).map((b) => {
    if (typeof b.cue !== 'string' || !b.cue.trim()) return { ...b };
    const m = matchCue(Array.isArray(words) ? words : [], b.cue, last);
    const rest = { ...b };
    delete rest.t; delete rest.end; delete rest.word;
    if (!m) { missed.push({ name: b.name, cue: b.cue }); return Number.isFinite(Number(b.t)) ? { t: Number(b.t), ...rest } : rest; }
    last = m.start;
    placed.push(b.name);
    return { t: r3(m.start), end: r3(m.end), word: m.word, ...rest };
  });
  return { beats: out, placed, missed };
}

/** Pure: every `at` beat on the music grid (score.sceneGrid, piece time). → { beats, placed, missed } */
function alignMusic(beats, grid, { engineRoot } = {}) {
  const { resolveAt } = score.lib(engineRoot);
  const placed = [];
  const missed = [];
  const out = (Array.isArray(beats) ? beats : []).filter(isObj).map((b) => {
    if (b.at == null || (typeof b.cue === 'string' && b.cue.trim())) return { ...b };
    const t = resolveAt(grid, b.at);
    if (t == null || (grid && Number.isFinite(grid.seconds) && t >= grid.seconds)) { missed.push({ name: b.name, at: b.at }); return { ...b }; }
    const rest = { ...b };
    delete rest.t; delete rest.end;
    placed.push(b.name);
    return { t: r6(t), ...rest };
  });
  return { beats: out, placed, missed };
}

/** Slide n's lead-in before its voice (0.5 s on the first slide and after a cut scene, as retime.py). */
const leadOf = (dir, n) => require('./animators').leadOf(dir, n);

/**
 * The words a narrated piece is timed to, in its own time (the voice's start + the lead), and its length on screen:
 * from that run's voice when there is one (`which`: 'final' or 'draft'; else the newest), through real-words.py,
 * else estimated at the voices' pace. A between piece has no words: its length is its seconds.
 * → { words, duration, lead, source, which, wav }
 */
async function timing(dir, key, deps = {}) {
  const piece = typeof key === 'string' ? pieceOf(dir, key) : key;
  if (!NARRATED.has(piece.kind)) return { words: [], duration: piece.seconds, lead: 0, source: 'seconds', which: null, wav: null };
  const folder = folderOf(dir, piece);
  const narration = motion.narrations(dir)[piece.n] || '';
  const lead = leadOf(dir, piece.n);
  const T = motion.templateDir(deps.engineRoot);
  for (const which of deps.which ? [deps.which] : ['final', 'draft']) {
    const tl = motion.timelineOf(dir, which);
    const slot = tl && (tl.slides || []).find((x) => x.n === piece.n);
    const wav = slot && motion.narrationWav(dir, piece.n, which);
    if (!wav || !deps.retime || !narration.trim()) continue;
    const out = path.join(folder, `words-${which}.json`);
    fs.rmSync(out, { force: true });
    fs.writeFileSync(path.join(folder, 'narration.txt'), narration);
    await deps.retime([path.join(T, 'real-words.py'), wav, path.join(folder, 'narration.txt'), out], { signal: deps.signal });
    const words = readJson(out, null);
    if (!Array.isArray(words) || !words.length) continue;
    const duration = r3(Math.round((slot.duration - 1 / FPS) * FPS) / FPS);
    return { words: words.map((w) => ({ text: String(w.text || w.word || ''), start: r3(Number(w.start) + lead), end: r3(Number(w.end) + lead) })), duration, lead, source: which, which, wav };
  }
  const est = require('./animators').estimatedWords(narration);
  const duration = r3(Math.max(3, Math.ceil((lead + est.seconds + 0.6) * FPS) / FPS));
  return { words: est.words.map((w) => ({ text: w.text, start: r3(w.start + lead), end: r3(w.end + lead) })), duration, lead, source: 'estimate', which: null, wav: null };
}

/**
 * Time the piece: beats.json's cues to the words (narrated) or its `at` beats to the music grid (between), with the
 * duration, the hold and the words, written into beats.json (the crew's fields kept). → { duration, frames, lead,
 * source, placed, missed, grid, wav }
 */
async function align(dir, key, deps = {}) {
  const piece = typeof key === 'string' ? pieceOf(dir, key) : key;
  const folder = folderOf(dir, piece);
  const file = path.join(folder, 'beats.json');
  const b = readJson(file, null);
  if (!isObj(b)) throw new Error('beats.json isn\'t JSON.');
  const t = deps.timing || await timing(dir, piece, deps);
  const frames = Math.round(t.duration * FPS);
  let res;
  let grid = null;
  if (NARRATED.has(piece.kind)) {
    res = alignBeats(b.beats, t.words);
  } else {
    const s = styleFor(dir, piece, deps);
    const sound = soundOf(piece, s.style, deps);
    try { grid = score.sceneGrid({ sound, frames, seed: seedOf(piece.key), engineRoot: deps.engineRoot }); } catch { grid = null; }
    if (grid) {
      fs.mkdirSync(path.join(folder, 'score'), { recursive: true });
      fs.writeFileSync(path.join(folder, 'score', 'grid.json'), `${JSON.stringify(grid, null, 1)}\n`);
    }
    res = alignMusic(b.beats, grid || { seconds: t.duration }, deps);
  }
  const next = { ...b, duration: r6(frames / FPS), hold: HOLD, beats: res.beats };
  if (NARRATED.has(piece.kind)) next.words = t.words; else delete next.words;
  // written only when it changes, so a render made since stays current (and the Stage doesn't reload for nothing)
  const text = beatsText(next);
  let was = null;
  try { was = fs.readFileSync(file, 'utf8'); } catch { was = null; }
  if (text !== was) fs.writeFileSync(file, text);
  return { duration: next.duration, frames, lead: t.lead, source: t.source, placed: res.placed, missed: res.missed, grid: grid ? { bpm: grid.bpm, bars: (grid.bars || []).length } : null, wav: t.wav || null };
}

// ── sound ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The sound a piece plays with: its plan's, else its style's, else its kind's default (score.soundFor); a library track
 * this computer doesn't have plays the nearest score instead (`instead` names it: DV13).
 */
function soundOf(piece, style, deps = {}) {
  let sound;
  try { sound = score.soundFor({ kind: piece.kind, shot: { sound: piece.plan.sound }, style, engineRoot: deps.engineRoot }); } catch {
    sound = score.soundFor({ kind: piece.kind, engineRoot: deps.engineRoot });
  }
  const fb = trackFallback(sound.music, deps);
  return fb ? { ...sound, music: fb.music, instead: fb.instead } : sound;
}

/** The scene's own hits(ctx) and its keyframes, from the page (render-direct's meta mode). */
async function metaOf(dir, piece, deps = {}) {
  const folder = folderOf(dir, piece);
  const rec = recordOf(dir, piece);
  const styleDir = stylesFor(deps).snapshotDir(dir, rec.style.id);
  const b = readJson(path.join(folder, 'beats.json'), {}) || {};
  const { stage, done } = stageOf(dir, piece, { styleDir });
  try {
    const opts = { scene: stage, mode: 'meta', duration: Number(b.duration) || piece.seconds || 8, hold: HOLD, styles: { [rec.style.id]: styleDir }, at: deps.at || [], env: toolEnv(deps.env) };
    if (deps.meta) return await deps.meta(opts);
    const { renderDirect } = await tool(deps.engineRoot, 'render-direct.mjs');
    return await renderDirect(opts);
  } finally {
    done();
  }
}

/**
 * The piece's stem (PLAN §2.6): its sound, its music grid, its hits (the beats' sfx and the scene's hits(ctx)) on the
 * aligned beats, rendered and mixed into score/ (score.write: under the voice for a narrated piece, -21 LUFS for a
 * between piece). Run again after every retime. → { record, stem (absolute, or null with nothing to play), problems }
 */
async function scorePass(dir, key, deps = {}) {
  const piece = typeof key === 'string' ? pieceOf(dir, key) : key;
  const folder = folderOf(dir, piece);
  const s = styleFor(dir, piece, deps);
  const sound = soundOf(piece, s.style, deps);
  const b = readJson(path.join(folder, 'beats.json'), {}) || {};
  const frames = Math.round((Number(b.duration) || piece.seconds || 8) * FPS);
  let hits = deps.hits;
  if (hits == null) {
    const m = await metaOf(dir, piece, deps).catch(() => null);
    hits = (m && m.meta && Array.isArray(m.meta.hits)) ? m.meta.hits : [];
  }
  const voicePath = NARRATED.has(piece.kind) ? deps.voicePath || null : null;
  const planned = score.plan({
    kind: piece.kind, frames, sound, seed: seedOf(piece.key), lead: NARRATED.has(piece.kind) ? leadOf(dir, piece.n) : 0,
    voice: voicePath ? path.relative(pres(dir), voicePath) : null, beats: b.beats, hits,
    library: deps.library || shippedLibrary(deps.engineRoot), files: deps.files || {}, engineRoot: deps.engineRoot,
  });
  if (sound.instead) planned.record.instead = sound.instead; // the track it plays in place of (DV13)
  const ffmpeg = deps.ffmpeg || ffmpegOf(deps.env) || 'ffmpeg';
  const res = await score.write(folder, planned, { ffmpeg, env: deps.env || process.env, voicePath, engineRoot: deps.engineRoot, signal: deps.signal });
  const stem = res.record.stem ? path.join(folder, 'score', 'stem.wav') : null;
  return { record: res.record, stem, problems: res.problems, sound };
}

// ── renders ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** render-scene.mjs on a piece's folder, as a child process: its JSON answer. opts: render-scene's own. */
function spawnRenderScene(engineRoot, env, o) {
  const node = nodeOf(env);
  if (!node) return Promise.resolve({ ok: false, steps: [{ step: 'error', problem: 'no node in the toolchain' }] });
  const args = [toolPath(engineRoot, 'render-scene.mjs'), o.scene, '--out', o.out, '--duration', String(o.duration), '--hold', String(o.hold == null ? HOLD : o.hold), '--json'];
  for (const [id, d] of Object.entries(o.styles || {})) args.push('--style-dir', `${id}=${d}`);
  if (o.checkFrames) args.push('--check-frames', o.checkFrames);
  if (o.framesAt && o.framesAt.length) args.push('--frames-at', o.framesAt.join(','));
  if (o.audio) args.push('--audio', o.audio);
  if (o.renderer) args.push('--renderer', o.renderer);
  if (o.quality) args.push('--quality', o.quality); // HyperFrames' draft | standard | high (render-scene's default: delivery)
  if (o.workers) args.push('--workers', String(o.workers));
  return new Promise((resolve) => {
    let child;
    try { child = spawn(node, args, { env: toolEnv(env), stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { resolve({ ok: false, steps: [{ step: 'error', problem: e.message }] }); return; }
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; if (out.length > 4 << 20) out = out.slice(-(2 << 20)); });
    child.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    const stop = () => { try { child.kill('SIGTERM'); } catch { /* gone */ } };
    if (o.signal) o.signal.addEventListener('abort', stop, { once: true });
    child.on('error', (e) => resolve({ ok: false, steps: [{ step: 'error', problem: e.message }] }));
    child.on('close', (code) => {
      let r = null;
      try { r = JSON.parse(out.slice(out.indexOf('{'))); } catch { r = null; }
      resolve(r || { ok: false, code, steps: [{ step: 'error', problem: (err || out).trim().split('\n').slice(-4).join(' ').slice(0, 400) }] });
    });
  });
}

/**
 * What a render reads of a piece: the crew's code (scene.js, kit-ext.js), its timed beats.json and its pictures, in a
 * fresh folder in the temporary folder. The lint's limits (scene.js 200 KB, the folder 60 MB, a picture 50 MB) are on
 * what the crew made, never on FLPT's own renders, takes and stems beside it. Only plain files are copied.
 * → { stage, done() }
 */
function stageOf(dir, piece, { styleDir = null, placeholder = false } = {}) {
  const folder = folderOf(dir, piece);
  let tmp = require('os').tmpdir();
  try { tmp = fs.realpathSync(tmp); } catch { /* as it is */ }
  const stage = fs.mkdtempSync(path.join(tmp, `flpt-scene-${String(piece.id).replace(/[^\w-]+/g, '-').slice(0, 40)}-`));
  const plain = (p) => { try { const s = fs.lstatSync(p); return s.isFile() && !s.isSymbolicLink(); } catch { return false; } };
  if (placeholder) {
    // the fallback's placeholder: the style's paper and nothing on it (a starter's words aren't the script's)
    const rec = recordOf(dir, piece);
    fs.writeFileSync(path.join(stage, 'scene.js'), placeholderScene(rec && rec.style && rec.style.id));
    if (plain(path.join(folder, 'beats.json'))) fs.copyFileSync(path.join(folder, 'beats.json'), path.join(stage, 'beats.json'));
    return { stage, done: () => fs.rmSync(stage, { recursive: true, force: true }) };
  }
  for (const f of ['scene.js', 'kit-ext.js', 'beats.json']) if (plain(path.join(folder, f))) fs.copyFileSync(path.join(folder, f), path.join(stage, f));
  const pics = path.join(folder, 'assets', 'pictures');
  if (isDir(pics)) {
    fs.mkdirSync(path.join(stage, 'assets', 'pictures'), { recursive: true });
    for (const f of fs.readdirSync(pics)) if (plain(path.join(pics, f))) fs.copyFileSync(path.join(pics, f), path.join(stage, 'assets', 'pictures', f));
  }
  // a style saved from a piece carries its kit extension (style.json files.kitExt): it loads before the crew's own
  const style = styleDir ? readJson(path.join(styleDir, 'style.json'), null) : null;
  const ext = style && style.files && typeof style.files.kitExt === 'string' ? path.join(styleDir, ...style.files.kitExt.split('/')) : null;
  if (ext && plain(ext) && path.resolve(ext).startsWith(path.resolve(styleDir) + path.sep)) {
    const own = plain(path.join(folder, 'kit-ext.js')) ? fs.readFileSync(path.join(folder, 'kit-ext.js'), 'utf8') : '';
    fs.writeFileSync(path.join(stage, 'kit-ext.js'), `${fs.readFileSync(ext, 'utf8').trimEnd()}\n${own}`);
  }
  return { stage, done: () => fs.rmSync(stage, { recursive: true, force: true }) };
}
/** A placeholder's scene.js: the style's paper, still, with no words and no sound of its own. */
function placeholderScene(styleId) {
  return `FLPT.scene({\n  style: ${JSON.stringify(String(styleId || ''))},\n  layers: ['canvas'],\n  frame(ctx) {\n    const g = ctx.g;\n    g.fillStyle = (ctx.tokens && ctx.tokens.paper) || '#000000';\n    g.fillRect(0, 0, ctx.W, ctx.H);\n  },\n});\n`;
}
/** The style snapshot a piece renders from (its record's), or null. */
const styleDirOf = (dir, piece, deps = {}) => { const rec = recordOf(dir, piece); return rec && rec.style ? stylesFor(deps).snapshotDir(dir, rec.style.id) : null; };

/** The static check on what the crew made (its stage: the code, the beats, the pictures). → lint.mjs's problems */
async function lintPiece(dir, key, deps = {}) {
  const piece = typeof key === 'string' ? pieceOf(dir, key) : key;
  const { lintFolder } = await tool(deps.engineRoot, 'lint.mjs');
  const { stage, done } = stageOf(dir, piece, { styleDir: styleDirOf(dir, piece, deps) });
  try { return lintFolder(stage); } finally { done(); }
}

/** One render of a piece (render-scene: lint, page, render, checks, the stem muxed), from its stage. → render-scene's answer */
async function renderFolder(dir, piece, { placeholder = false, ...o }, deps = {}) {
  const rec = recordOf(dir, piece);
  const styleDir = stylesFor(deps).snapshotDir(dir, rec.style.id);
  // a preview a take shares (linkOrCopy) is never written through, whatever the renderer does with --out
  try { if (o.out && fs.statSync(o.out).nlink > 1) fs.rmSync(o.out, { force: true }); } catch { /* not there yet */ }
  const { stage, done } = stageOf(dir, piece, { styleDir, placeholder });
  try {
    const opts = { scene: stage, hold: HOLD, styles: { [rec.style.id]: styleDir }, signal: deps.signal, ...o };
    if (deps.renderScene) return await deps.renderScene({ ...opts, folder: folderOf(dir, piece) });
    return await spawnRenderScene(deps.engineRoot, deps.env || process.env, opts);
  } finally {
    done();
  }
}
/** A render's problem in one line. */
function renderProblem(r) {
  const bad = (r && Array.isArray(r.steps) ? r.steps : []).filter((s) => s.ok === false || s.step === 'error');
  const first = bad[0] || {};
  return String(first.problem || (first.problems && first.problems[0]) || (first.log && [].concat(first.log)[0]) || (r && r.issues && r.issues[0]) || first.step || 'it didn\'t render').slice(0, 300);
}

/**
 * Every finished narrated piece (a folder of FLPT's whose crew said done), timed to the voice of the run that just
 * made its narration ('draft' or 'final'), scored and rendered to media/slide_NN.mp4: the score pass reruns after
 * every retime, so its beats and effects follow the new voice. A piece that fails keeps its poster (the slide's
 * picture). The user's own video on a slide wins. → { scenes: { n: { video, audio, volume } }, problems }
 */
async function renderNarrated(dir, which, deps = {}) {
  const scenes = {};
  const problems = [];
  const userVideo = motion.userVideoSlides(dir);
  for (const piece of pieces(dir).filter((p) => NARRATED.has(p.kind))) {
    if (deps.signal && deps.signal.aborted) break;
    const rec = recordOf(dir, piece);
    if (!rec || rec.key !== piece.key || !rec.ok) continue;
    if (userVideo.has(piece.n)) { problems.push(`Slide ${piece.n} plays a video of yours, so its Live Motion scene stays aside.`); continue; }
    const say = (why) => problems.push(`Slide ${piece.n} shows its poster: ${why}.`);
    try {
      const t = await timing(dir, piece, { ...deps, which });
      if (t.source !== which) { say(`its voice in this ${which === 'draft' ? 'draft' : 'film'} couldn't be timed`); continue; }
      const a = await align(dir, piece, { ...deps, timing: t });
      if (a.missed.length) problems.push(`Slide ${piece.n}: the voice doesn't say ${a.missed.map((m) => `"${m.cue}"`).join(', ')}; ${a.missed.length > 1 ? 'those beats keep' : 'that beat keeps'} its last time.`);
      const sc = await scorePass(dir, piece, { ...deps, voicePath: t.wav });
      problems.push(...sc.problems.map((p) => `Slide ${piece.n}'s sound: ${p}.`));
      const out = pres(dir, piece.clip);
      const r = await renderFolder(dir, piece, { out, duration: a.duration, audio: sc.stem && !sc.problems.length ? sc.stem : null }, deps);
      if (!r || !r.ok) { say(renderProblem(r)); continue; }
      scenes[piece.n] = { video: piece.clip, audio: sc.stem && !sc.problems.length ? 'mix' : 'mute', volume: 1 };
      // the clip's hash: FLPT's own scene clip, never mistaken for the user's video once the piece moves or leaves
      writeJson(path.join(folderOf(dir, piece), SCENE), { ...recordOf(dir, piece), rendered: { which, at: new Date().toISOString(), frames: a.frames, seconds: a.duration, audio: scenes[piece.n].audio, clip: piece.clip, sha: motion.sha(out) } });
    } catch (e) {
      say(String(e && e.message ? e.message : e).slice(0, 200));
    }
  }
  return { scenes, problems };
}

/** What a between piece's clip was rendered from: its files, its sound and its seconds (a change means a new render). */
function betweenKey(dir, piece, deps = {}, placeholder = false) {
  const folder = folderOf(dir, piece);
  let sound = null;
  try { sound = soundOf(piece, styleFor(dir, piece, deps).style, deps); } catch { sound = null; }
  return sha(JSON.stringify({ files: filesSha(folder), sound, seconds: piece.seconds, placeholder: Boolean(placeholder) })).slice(0, 16);
}

/**
 * A between piece (a Solo ♪ or a cut scene drawn in code) rendered for the splice: its `at` beats on its music grid,
 * its stem at -21 LUFS, the render checked, to media/jsscene_<id>.mp4. Only a finished piece renders; `fallback: true`
 * (the splice's fallback path, nothing else) renders a placeholder when the piece isn't made: the style's paper, still,
 * with its music and no words (the starter's words aren't in the script).
 * `force` renders even when the clip is up to date. → { ok, clip, frames, seconds, audio, placeholder, problems }
 */
async function renderInterstitial(dir, key, deps = {}) {
  const piece = typeof key === 'string' ? pieceOf(dir, key) : key;
  if (piece.placement !== 'between') throw new Error('Only a piece between slides renders on its own.');
  let rec = recordOf(dir, piece);
  let placeholder = false;
  // a piece the crew is finishing renders as it is (its `done`); anything else not finished only on the fallback path
  if (!rec || rec.key !== piece.key || (!rec.ok && !deps.unfinished)) {
    if (!deps.fallback) return { ok: false, problems: ['It isn\'t drawn yet.'] };
    if (!rec || rec.key !== piece.key) await scaffold(dir, piece, deps);
    placeholder = true;
    rec = recordOf(dir, piece);
  }
  const out = pres(dir, piece.clip);
  // timed first (it writes beats.json only when the times change), so the key is of what renders
  const a = await align(dir, piece, deps);
  const want = betweenKey(dir, piece, deps, placeholder);
  if (!deps.force && rec.rendered && rec.rendered.key === want && exists(out)) return { ok: true, clip: piece.clip, frames: rec.rendered.frames, seconds: rec.rendered.seconds, audio: rec.rendered.audio, placeholder: Boolean(rec.placeholder), problems: [], fresh: false };
  // a placeholder plays its music (and the plan's own effects), never the starter's
  const sc = await scorePass(dir, piece, placeholder ? { ...deps, hits: [] } : deps);
  const r = await renderFolder(dir, piece, { out, duration: a.duration, audio: sc.stem && !sc.problems.length ? sc.stem : null, placeholder }, deps);
  if (!r || !r.ok) return { ok: false, problems: [renderProblem(r), ...sc.problems] };
  const audio = sc.stem && !sc.problems.length ? 'stem' : 'none';
  writeJson(path.join(folderOf(dir, piece), SCENE), { ...recordOf(dir, piece), placeholder, rendered: { key: want, at: new Date().toISOString(), frames: a.frames, seconds: a.duration, audio, clip: piece.clip, sha: motion.sha(out), lufs: sc.record.stem ? sc.record.stem.lufs : null } });
  return { ok: true, clip: piece.clip, frames: a.frames, seconds: a.duration, audio, placeholder, problems: [...a.missed.map((m) => `"${m.at}" isn't on the music`), ...sc.problems], fresh: true };
}

/** The between pieces, as the splice reads them: [{ key, id, kind, after, afterN, seconds, seam, clip (absolute, or null), placeholder }]. */
function betweenPieces(dir) {
  return pieces(dir).filter((p) => p.placement === 'between').map((p) => {
    const rec = recordOf(dir, p);
    const clip = rec && rec.key === p.key && rec.rendered && exists(pres(dir, p.clip)) ? pres(dir, p.clip) : null;
    return { key: p.key, id: p.id, kind: p.kind, shot: p.shot, title: p.title, after: p.after, afterN: p.afterN, seconds: p.seconds, seam: p.seam, clip, placeholder: Boolean(rec && rec.placeholder) };
  });
}

// ── the deck crew's check, the planning lines ──────────────────────────────────────────────────────────────────────

/**
 * What's wrong with the deck's Live Motion plans, as short lines for check_deck: each piece's style is one FLPT has
 * (a Duet's must be safe beside the presenter), its beats are cued (narrated) or placed on the music (between), its
 * first and last are known, its sound is one FLPT plays, a between piece runs 4–30 s and follows a slide.
 */
function checkPlan(dir, deps = {}) {
  const out = [];
  const { order, modules: map } = motion.readDeck(dir);
  let styles = null;
  try { styles = deps.styles || (deps.engineRoot ? stylesFor(deps) : null); } catch { styles = null; }
  for (const p of pieces(dir)) {
    const name = p.placement === 'slide' ? `${p.id}` : `${p.kind === 'cutscene' ? 'cut scene' : 'jsscenes'} ${p.id}`;
    const raw = p.placement === 'slide' ? (map.slides || {})[p.id] : null;
    const scene = raw ? raw.scene : null;
    if (p.placement === 'slide' && !isObj(scene)) { out.push(`${name}: a ${TILE[p.kind]} needs its plan in modules.json ("scene": { "style", "idea", "beats" }).`); continue; }
    if (!p.plan.beats.length) out.push(`${name}: its scene has no beats.`);
    if (NARRATED.has(p.kind)) {
      p.plan.beats.forEach((b, i) => { if (!b.cue) out.push(`${name}, beat ${i + 1}: no cue (the narration's words it lands on).`); });
      if (p.plan.beats.filter((b) => b.hero).length > 1) out.push(`${name}: one hero beat at most.`);
    } else {
      p.plan.beats.forEach((b, i) => { if (b.at == null && !b.cue) out.push(`${name}, beat ${i + 1}: no "at" ("bar 2", "beat 9" or seconds on the music).`); });
    }
    if (styles) {
      const ref = styleRefOf(dir, p, styles);
      const rec = styles.get(ref);
      if (!rec) out.push(`${name}: there's no style called "${String(ref).slice(0, 40)}".`);
      else if (p.kind === 'duet' && !rec.duetSafe) out.push(`${name}: ${rec.name || rec.id} isn't safe beside the presenter; a Duet needs a duet-safe style (Ledger is).`);
    }
    if (isObj(scene) && scene.first != null && !FIRST.includes(scene.first)) out.push(`${name}: "first" is ${FIRST.join(', ')}.`);
    if (isObj(scene) && scene.last != null && !LAST.includes(scene.last)) out.push(`${name}: "last" is ${LAST.join(', ')}.`);
    const snd = isObj(scene && scene.sound) ? scene.sound : null;
    if (snd && snd.music != null && !(typeof snd.music === 'string' && MUSIC.test(snd.music))) out.push(`${name}: "music" is none, score:<preset> or library:<track>.`);
    if (snd && snd.sfx != null && !['off', 'soft', 'on'].includes(snd.sfx)) out.push(`${name}: "sfx" is off, soft or on.`);
  }
  for (const e of (Array.isArray(map.jsscenes) ? map.jsscenes : [])) {
    if (!isObj(e)) { out.push('A "jsscenes" entry isn\'t an object.'); continue; }
    const secs = Number(e.seconds);
    if (e.seconds != null && !(secs >= BETWEEN.min && secs <= BETWEEN.max)) out.push(`jsscenes ${e.id}: "seconds" is ${BETWEEN.min}–${BETWEEN.max}.`);
    if (e.after && !order.includes(e.after)) out.push(`jsscenes ${e.id}: "after": "${e.after}" isn't a slide in deck.json.`);
  }
  return out;
}

/**
 * The Claude planning cap's Live Motion lines the storyboard doesn't already count (its pieces are counted by shot,
 * ext/storyboard.js): a piece with no shot, or whose shot isn't on the board. [{ label, usd, shot }]
 */
function planningLines(dir) {
  let counted = new Set();
  try {
    const sb = require('./storyboard');
    const st = episode.read(dir);
    const s = st && st.stages && st.stages.storyboard;
    const skipped = Boolean(s && s.status === 'approved' && s.skipped);
    const board = skipped ? null : sb.read(dir);
    // a storyboard that's planning but has no board yet: its default plan's lines count every piece already
    if (!skipped && !(board && board.shots.length) && s) return [];
    if (board) counted = new Set((sb.price(null, board).claude.pieces || []).map((x) => x.shot));
  } catch { counted = new Set(); }
  return pieces(dir).filter((p) => !(p.shot && counted.has(p.shot)))
    .map((p) => ({ label: `${TILE[p.kind]} · ${p.shot || p.id}`, usd: p.caps.usd, shot: p.shot }));
}

// ── Draw it in code (S9) ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * A Cosmos slide or a cut scene drawn in code from now on (the Scenes step's "Draw it in code"): "make": "code" on its
 * modules.json entry (a Cosmos's keyframes become its scene's beats) and on its storyboard shot, without staling the
 * deck or un-approving the plan; media.json follows (a code Cosmos is a scene: its bubble stays hidden). Live Motion
 * opens again for the new piece. After Spend, Spend opens again as the flow's own reopenSpend does (T20): the generated
 * set it priced changed, so its HeyGen budget closes (`broker`, when given), its approval goes and what was approved
 * after it (film, refine, deliver) is out of date.
 * key: 'cartoon:<slide id>' / 'cutscene:<id>' (the Scenes step's) or 'slide:<id>' / 'between:C<id>'.
 * → { key (the Live Motion piece's), spend: 'reopened' | null, changed }
 */
function drawInCode(dir, key, { broker = null } = {}) {
  const k = String(key || '');
  const project = pres(dir, 'deck', 'project');
  const file = path.join(project, 'modules.json');
  const map = readJson(file, null);
  if (!isObj(map)) throw new Error('The deck has no modules.json.');
  const { order } = motion.readDeck(dir);
  let shot = null;
  let live = null;
  let m = /^(?:cartoon|slide):([A-Za-z0-9_-]{1,64})$/.exec(k);
  const scenes = require('./scenes');
  if (m && scenes.pieceWorking(dir, `cartoon:${m[1]}`)) throw new Error('That one is still on its way.');
  if (m) {
    const e = isObj(map.slides) && isObj(map.slides[m[1]]) ? map.slides[m[1]] : null;
    if (!e || e.module !== 'cosmos' || !order.includes(m[1])) throw new Error('Only a Cosmos slide or a cut scene can be drawn in code.');
    if (e.make === 'code') return { key: `slide:${m[1]}`, spend: null, changed: false };
    e.make = 'code';
    if (!isObj(e.scene)) {
      const beats = (isObj(e.cartoon) && Array.isArray(e.cartoon.beats) ? e.cartoon.beats : []).filter(isObj)
        .map((b) => ({ ...(typeof b.cue === 'string' ? { cue: b.cue } : {}), ...(typeof b.picture === 'string' ? { picture: b.picture } : {}), ...(b.hero === true ? { hero: true } : {}) }));
      e.scene = { style: stylesLib.DEFAULTS.cosmos, beats, last: 'poster' };
    }
    shot = SHOT.test(String(e.shot)) ? e.shot : null;
    live = `slide:${m[1]}`;
  } else if ((m = /^(?:cutscene:|between:C)([A-Za-z0-9_-]{1,40})$/.exec(k))) {
    const list = Array.isArray(map.cutscenes) ? map.cutscenes : [];
    const ids = cutIds(list);
    // the Scenes step names a generated one (cutscene:<id>), Live Motion one drawn in code (between:C<id>): each kind
    // is numbered on its own, so look among that kind first
    const code = (x) => modules.makeOf(x) === 'code';
    const find = (inCode) => list.findIndex((x, j) => isObj(x) && code(x) === inCode && ids[j] === m[1]);
    const wantCode = k.startsWith('between:');
    let i = find(wantCode);
    if (i < 0) i = find(!wantCode);
    const e = i >= 0 ? list[i] : null;
    if (!e) throw new Error('That cut scene isn\'t in the deck any more.');
    if (code(e)) return { key: `between:C${ids[i]}`, spend: null, changed: false };
    if (scenes.pieceWorking(dir, `cutscene:${ids[i]}`)) throw new Error('That one is still on its way.');
    e.make = 'code';
    if (!isObj(e.scene)) {
      const secs = (Array.isArray(e.shots) ? e.shots : []).filter(isObj).reduce((a, s) => a + (Number(s.seconds) || 0), 0);
      e.scene = { style: stylesLib.DEFAULTS.cutscene, idea: str(e.title, 200), beats: [{ at: 'bar 1', fx: 'open' }, { at: 'bar 3', fx: 'turn' }] };
      if (!e.seconds && secs) e.seconds = clamp(Math.round(secs), BETWEEN.min, BETWEEN.max);
    }
    shot = SHOT.test(String(e.shot)) ? e.shot : null;
    live = `between:C${cutIds(list)[i]}`; // its id as a piece drawn in code
  } else throw new Error('Only a Cosmos slide or a cut scene can be drawn in code.');
  writeJson(file, map);
  // its storyboard shot says so too; the plan stays approved (approvedAt kept): the deck was built from it as it is
  try {
    const sb = require('./storyboard');
    const board = sb.read(dir);
    if (board && shot) {
      const s = board.shots.find((x) => x.id === shot);
      if (s && s.make !== 'code') { s.make = 'code'; sb.write(dir, board); }
    }
  } catch { /* no storyboard (an older episode): modules.json is the plan */ }
  motion.refreshMedia(dir);
  const st = episode.read(dir);
  let spend = null;
  if (st && st.stages) {
    const at = new Date().toISOString();
    if (st.stages.spend && st.stages.spend.status === 'approved') {
      // flow.reopenSpend's steps: every live film budget closes (HeyGen's, or a cartoon's ElevenLabs or Fish voice's),
      // Spend is to do again, and what was built on it is stale
      for (const p of require('./flow').FILM_PAID) {
        const token = st.budgets && st.budgets[p];
        if (broker && token && broker.isLive(token, p)) broker.close(token);
      }
      st.stages.spend = { status: 'todo', at, reopened: 'drawn-in-code' };
      for (const later of episode.STAGE_IDS.slice(episode.STAGE_IDS.indexOf('spend') + 1)) {
        if (st.stages[later] && st.stages[later].status === 'approved') st.stages[later] = { ...st.stages[later], status: 'stale' };
      }
      spend = 'reopened';
    }
    if (st.stages.animate && st.stages.animate.status === 'approved') {
      const { approvedBy, ...rest } = st.stages.animate;
      st.stages.animate = { ...rest, status: 'todo', skipped: false, at };
    }
    episode.write(dir, st);
  }
  return { key: live, spend, changed: true };
}

// ── park, restore and sync ───────────────────────────────────────────────────────────────────────────────────────

const parkedRoot = (dir) => pres(dir, 'hyperframes', 'parked');
const CLIP = /^media\/(?:slide_\d{2}|jsscene_[A-Za-z0-9_-]{1,64})\.mp4$/;
/**
 * The clip a piece's record says FLPT rendered, removed while it is still that clip (its hash): a piece that moves or is
 * set aside leaves nothing in its old place that would pass for the user's own video. → true when it went
 */
function dropClip(dir, rec) {
  const r = rec && isObj(rec.rendered) ? rec.rendered : null;
  const rel = r && typeof r.clip === 'string' ? r.clip.split(path.sep).join('/') : '';
  if (!r || typeof r.sha !== 'string' || !CLIP.test(rel)) return false;
  const clip = pres(dir, ...rel.split('/'));
  if (!exists(clip) || motion.sha(clip) !== r.sha) return false;
  fs.rmSync(clip, { force: true });
  return true;
}

/** Set a folder aside in hyperframes/parked/, where nothing renders it (and its clip goes, dropClip). → where it went */
function park(dir, folder, key) {
  dropClip(dir, readJson(path.join(folder, SCENE), null));
  const root = parkedRoot(dir);
  fs.mkdirSync(root, { recursive: true });
  const base = path.join(root, `live-${String(key).replace(/[^\w-]+/g, '-').slice(0, 60)}-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '')}`);
  let dest = base;
  for (let i = 2; fs.existsSync(dest); i++) dest = `${base}-${i}`;
  fs.renameSync(folder, dest);
  return dest;
}

/** The newest parked folder of a piece (its record names its key), or null. */
function parkedOf(dir, key) {
  const root = parkedRoot(dir);
  let names = [];
  try { names = fs.readdirSync(root); } catch { return null; }
  const hits = names.map((n) => path.join(root, n)).filter((f) => { const r = readJson(path.join(f, SCENE), null); return r && r.schema === SCHEMA && r.key === key; })
    .map((f) => ({ f, at: String((readJson(path.join(f, SCENE), {}) || {}).at || ''), ok: Boolean((readJson(path.join(f, SCENE), {}) || {}).ok) }))
    .sort((a, b) => Number(b.ok) - Number(a.ok) || b.at.localeCompare(a.at));
  return hits.length ? hits[0].f : null;
}

/** A parked folder of this piece comes back into its place, when the place is free. → true when it did */
function restore(dir, piece) {
  const folder = folderOf(dir, piece);
  const from = parkedOf(dir, piece.key);
  if (!from) return false;
  // the engine's folder in its place goes (with its clip), as when a piece moves there
  if (piece.placement === 'slide' && exists(path.join(folder, motion.MARKER))) {
    if (motion.clipIsOurs(dir, piece.n)) fs.rmSync(motion.clipPath(dir, piece.n), { force: true });
    fs.rmSync(folder, { recursive: true, force: true });
  }
  if (fs.existsSync(folder) && fs.readdirSync(folder).length) return false;
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(folder), { recursive: true });
  fs.renameSync(from, folder);
  // its number may have changed: the record follows the deck
  const rec = recordOf(dir, piece);
  writeJson(path.join(folder, SCENE), { ...rec, slide: piece.n, shot: piece.shot, rendered: null });
  return true;
}

/**
 * Keep Live Motion folders with their pieces when the deck changes: a slide piece whose slide moved goes with it (over
 * the engine's folder there, which the engine remakes); one whose piece left the deck is parked; a parked one whose
 * piece is back returns to its place. The user's own folders are never touched. → lines for the log
 */
function sync(dir) {
  const root = pres(dir, 'hyperframes');
  const want = new Map(pieces(dir).map((p) => [p.key, p]));
  const notes = [];
  let names = [];
  try { names = fs.readdirSync(root); } catch { return notes; }
  const found = names.filter((n) => /^(slide_\d{2}|jsscene_[A-Za-z0-9_-]+)$/.test(n))
    .map((n) => ({ name: n, folder: path.join(root, n), rec: readJson(path.join(root, n, SCENE), null) }))
    .filter((f) => f.rec && f.rec.schema === SCHEMA && typeof f.rec.key === 'string');
  const moving = [];
  for (const f of found) {
    const p = want.get(f.rec.key);
    if (p && path.join(root, path.basename(p.folder)) === f.folder) continue;
    // its clip stays behind no more: in its old place it would pass for the user's own video (it renders again where
    // it goes, timed to that slide's voice)
    dropClip(dir, f.rec);
    const tmp = path.join(root, `.live-moving-${f.name}-${process.pid}`);
    fs.renameSync(f.folder, tmp);
    moving.push({ ...f, tmp, to: p || null });
  }
  for (const m of moving) {
    const dest = m.to ? folderOf(dir, m.to) : null;
    if (dest && fs.existsSync(dest) && exists(path.join(dest, motion.MARKER))) {
      // the engine's folder there goes, and its clip with it (the engine remakes both if the slide moves again)
      if (m.to.placement === 'slide' && motion.clipIsOurs(dir, m.to.n)) fs.rmSync(motion.clipPath(dir, m.to.n), { force: true });
      fs.rmSync(dest, { recursive: true, force: true });
    }
    if (dest && !fs.existsSync(dest)) {
      fs.renameSync(m.tmp, dest);
      writeJson(path.join(dest, SCENE), { ...m.rec, slide: m.to.n, shot: m.to.shot, rendered: null });
      notes.push(`${m.to.title}'s Live Motion scene moved with it.`);
      continue;
    }
    park(dir, m.tmp, m.rec.key);
    notes.push(m.to ? `${m.to.folder} holds something of yours, so the Live Motion scene for "${m.to.title}" was set aside.` : `A Live Motion scene was set aside: its piece isn't in the deck any more.`);
  }
  for (const p of want.values()) if (restore(dir, p)) notes.push(`${p.title}'s Live Motion scene came back.`);
  return notes;
}

// ── takes ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const takesRoot = (dir, piece) => path.join(folderOf(dir, piece), 'takes');
/**
 * A preview into a take (or back): a second name for the same file, not a copy (five takes of a piece would otherwise
 * hold five copies of its preview). What was at `to` goes first, so a file two names share is never written through;
 * renders replace renders/preview.mp4 by renaming over it, which leaves a take's name on the old file.
 */
function linkOrCopy(from, to) {
  fs.rmSync(to, { force: true });
  try { fs.linkSync(from, to); } catch { fs.copyFileSync(from, to); }
}
/** The piece's takes: [{ n, at, ok, costUsd, preview }] (oldest first). */
function takesOf(dir, key) {
  const piece = typeof key === 'string' ? pieceOf(dir, key) : key;
  let names = [];
  try { names = fs.readdirSync(takesRoot(dir, piece)); } catch { return []; }
  return names.filter((n) => /^\d{1,4}$/.test(n)).map(Number).sort((a, b) => a - b).map((n) => {
    const t = readJson(path.join(takesRoot(dir, piece), String(n), 'take.json'), {}) || {};
    const prev = path.join(takesRoot(dir, piece), String(n), 'preview.mp4');
    return { n, at: t.at || null, ok: Boolean(t.ok), costUsd: t.costUsd == null ? null : t.costUsd, preview: exists(prev) ? path.relative(pres(dir), prev) : null, sha: t.sha || null };
  });
}

/**
 * Keep the folder as it is now as a take (the crew's files, its notes and its preview): takes/<n>/. At most five: the
 * oldest that isn't the current one goes. → the take
 */
function saveTake(dir, key, { costUsd = null, ok = false, current = true } = {}) {
  const piece = typeof key === 'string' ? pieceOf(dir, key) : key;
  const folder = folderOf(dir, piece);
  const all = takesOf(dir, piece);
  const n = (all.length ? all[all.length - 1].n : 0) + 1;
  const to = path.join(takesRoot(dir, piece), String(n));
  fs.mkdirSync(to, { recursive: true });
  for (const f of CREW_FILES) if (exists(path.join(folder, f))) fs.copyFileSync(path.join(folder, f), path.join(to, f));
  const pics = path.join(folder, 'assets', 'pictures');
  if (isDir(pics)) { fs.mkdirSync(path.join(to, 'pictures'), { recursive: true }); for (const f of fs.readdirSync(pics)) if (exists(path.join(pics, f))) fs.copyFileSync(path.join(pics, f), path.join(to, 'pictures', f)); }
  const prev = path.join(folder, 'renders', 'preview.mp4');
  if (exists(prev)) linkOrCopy(prev, path.join(to, 'preview.mp4'));
  const take = { n, at: new Date().toISOString(), ok: Boolean(ok), costUsd, sha: filesSha(folder) };
  writeJson(path.join(to, 'take.json'), take);
  const rec = recordOf(dir, piece);
  const cur = current ? n : (rec && rec.take) || null;
  if (rec) writeJson(path.join(folder, SCENE), { ...rec, take: cur });
  const kept = takesOf(dir, piece);
  let extra = kept.length - TAKES_MAX;
  for (const t of kept) {
    if (extra <= 0) break;
    if (t.n === cur) continue;
    fs.rmSync(path.join(takesRoot(dir, piece), String(t.n)), { recursive: true, force: true });
    extra -= 1;
  }
  return { ...take, preview: exists(path.join(to, 'preview.mp4')) ? path.relative(pres(dir), path.join(to, 'preview.mp4')) : null };
}

/** Put take n back in the folder (the crew's files and pictures; renders are made again). → the record */
function useTake(dir, key, n) {
  const piece = typeof key === 'string' ? pieceOf(dir, key) : key;
  const folder = folderOf(dir, piece);
  const from = path.join(takesRoot(dir, piece), String(Math.round(Number(n))));
  if (!/^\d{1,4}$/.test(String(Math.round(Number(n)))) || !isDir(from)) throw new Error('That take isn\'t there any more.');
  for (const f of CREW_FILES) {
    fs.rmSync(path.join(folder, f), { force: true });
    if (exists(path.join(from, f))) fs.copyFileSync(path.join(from, f), path.join(folder, f));
  }
  crewWritable(folder);
  if (isDir(path.join(from, 'pictures'))) {
    fs.mkdirSync(path.join(folder, 'assets', 'pictures'), { recursive: true });
    for (const f of fs.readdirSync(path.join(from, 'pictures'))) fs.copyFileSync(path.join(from, 'pictures', f), path.join(folder, 'assets', 'pictures', f));
  }
  const t = readJson(path.join(from, 'take.json'), {}) || {};
  if (exists(path.join(from, 'preview.mp4'))) { fs.mkdirSync(path.join(folder, 'renders'), { recursive: true }); linkOrCopy(path.join(from, 'preview.mp4'), path.join(folder, 'renders', 'preview.mp4')); }
  const rec = { ...recordOf(dir, piece), take: Number(n), ok: Boolean(t.ok), shaDone: t.ok ? filesSha(folder) : null, shaContent: t.ok ? contentSha(folder) : null, rendered: null };
  writeJson(path.join(folder, SCENE), rec);
  return rec;
}

// ── the episode's record of each piece (flpt-project.json "live", by shot) ─────────────────────────────────────────

const liveId = (piece) => piece.shot || piece.key;
/** A piece (or the stage) whose crew was at work when FLPT quit. */
const INTERRUPTED = 'Stopped before it finished.';
/** Merge `patch` into the piece's entry in the record's `live`. → the entry */
function noteLive(dir, piece, patch) {
  const st = episode.read(dir);
  if (!st) return null;
  const all = isObj(st.live) ? st.live : {};
  const id = liveId(piece);
  const next = { ...(isObj(all[id]) ? all[id] : {}), key: piece.key, ...patch, at: new Date().toISOString() };
  st.live = { ...all, [id]: next };
  episode.write(dir, st);
  return next;
}

/**
 * What the Live Motion wall shows (W2-05), piece by piece: its kind, place, style, status (todo, running, ok, failed,
 * stale), takes and the current one, the preview, the crew's checks, the on-screen words that aren't in the script
 * or the deck (shown at approval), its cost and whether it's approved.
 */
/**
 * Is a piece's folder the user's own work: files in it, but no record of FLPT's, no moving-slide marker and no
 * animator's? Scene crews never touch it (scenecrew.toMake), and the wall counts it as made ('yours').
 */
function isTheirs(dir, p) {
  const folder = folderOf(dir, p);
  return isDir(folder) && fs.readdirSync(folder).length > 0 && !recordOf(dir, p) && !exists(path.join(folder, motion.MARKER)) && !exists(path.join(folder, 'flpt-animator.json'));
}

function view(dir) {
  const st = episode.read(dir) || {};
  const live = isObj(st.live) ? st.live : {};
  // "running" only while its crew is at work in this process: one FLPT quit in the middle of stopped there
  const busy = require('./scenecrew').isBusy(dir);
  return pieces(dir).map((p) => {
    const rec = recordOf(dir, p);
    const mine = Boolean(rec && rec.key === p.key);
    const raw = isObj(live[liveId(p)]) ? live[liveId(p)] : {};
    const entry = raw.status === 'running' && !busy ? { ...raw, status: 'failed', error: raw.error || INTERRUPTED } : raw;
    const folder = folderOf(dir, p);
    const preview = path.join(folder, 'renders', 'preview.mp4');
    const cs = mine ? crewState(dir, p) : null;
    const stale = mine && isStale(folder, rec);
    const status = entry.status === 'running' ? 'running' : !mine ? (isTheirs(dir, p) ? 'yours' : entry.status === 'failed' ? 'failed' : 'todo')
      : rec.ok ? (stale ? 'stale' : 'ok') : entry.status === 'failed' ? 'failed' : 'todo';
    return {
      key: p.key, kind: p.kind, tile: TILE[p.kind], placement: p.placement, shot: p.shot, id: p.id, n: p.n, afterN: p.afterN, title: p.title, seconds: p.seconds,
      style: mine ? rec.style : null, status, takes: mine ? takesOf(dir, p) : [], current: mine ? rec.take || null : null,
      preview: exists(preview) ? path.relative(pres(dir), preview) : null, poster: p.n && exists(pres(dir, 'slides', `slide_${pad2(p.n)}.png`)) ? path.join('slides', `slide_${pad2(p.n)}.png`) : null,
      checks: mine ? rec.checks || null : null, unlisted: mine && rec.words ? rec.words.unlisted || [] : [], flagged: mine && rec.words ? rec.words.flagged || [] : [],
      renders: cs ? cs.renders : null, rounds: cs ? cs.rounds.filter((r) => r.fix).length : 0,
      progress: status === 'running' ? require('./scenecrew').stepOf(dir, p.key) : null,
      costUsd: entry.costUsd == null ? null : entry.costUsd, error: entry.error || null, approved: Boolean(entry.approved), approvedBy: entry.approvedBy || null,
      capUsd: p.caps.usd, folder: p.folder,
      // what the last draft's or film's checks found at its timing, while the files are what was checked (G1)
      look: mine && rec.ok && isObj(entry.look) && entry.look.sha === filesSha(folder) && Array.isArray(entry.look.problems) ? entry.look.problems : null,
      // its one line when the shot's library track isn't on this computer and the nearest score plays instead (DV13)
      note: trackFallback(p.plan.sound.music) ? NO_TRACK : null,
    };
  });
}

module.exports = {
  pieces, pieceOf, scaffold, page, timing, align, alignBeats, alignMusic, matchCue, scorePass, soundOf, metaOf, renderNarrated, renderInterstitial,
  renderFolder, renderProblem, lintPiece, stageOf, styleDirOf, betweenPieces, betweenKey, checkPlan, planningLines, drawInCode, sync, park, parkedOf, restore, dropClip, takesOf, saveTake, useTake,
  noteLive, view, isTheirs, styleFor, styleRefOf, recordOf, crewState, writeCrewState, folderOf, filesSha, contentSha, crewBeats, isStale, seedOf, beatsText, cutIds, toolEnv, nodeOf, ffmpegOf,
  ffprobeOf, which, tool, toolPath, runtimeDir, shippedLibrary, useTracks, trackFallback, NO_TRACK, stylesFor, liveId, writeJson,
  SCENE, CREW, SCHEMA, KINDS, NARRATED, INTERRUPTED, CAPS, RENDERS, TAKES_MAX, HOLD, FPS, TILE, CREW_FILES, BETWEEN, KEY, FIRST, LAST,
};
