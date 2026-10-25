'use strict';
// studio.js · the Studio's side in main (PLAN §2.5, §3.3 S8a–S8b, draft-ux S8; W2-05): a Live Motion piece on the
// Stage, live, as the crew writes it. Electron-free (the plugin's tools get a copy); nothing here spends or reaches the
// network. The Mac registers the Stage source in shell/studio-stage.js; the page drives it through api/studio.js.
//
//   idFor(dir, key, { sound })   the name a piece goes by on the Stage (`livemotion:<id>`): an opaque id, the same
//                                every time for the same piece (so the Stage's kills and off state stay the piece's),
//                                remembered here with an optional sound to preview in place of its own
//   entryOf(id)                  → { dir, key, sound } or null
//   piece(dir, key, deps)        the piece's Stage parts: { load, media, ref, info, poster, render, styleDir }
//   stagePiece(dir, key, o, deps)  what shell/stage.js's addSource wants: the host page (host-preview.js) built from
//                                a fresh stage of the crew's files (livemotion.stageOf: the scene, kit-ext.js and, for
//                                a style saved from a piece, its files.kitExt; the pictures), its folder watched for the
//                                crew's own files only, rebuilt on each change
//   snapshot(dir, key, t, deps)  "Snapshot this frame": the exact frame at t from the final renderer, in FLPT's sandbox
//                                (stage/snapshot.mjs), as a PNG the Stage shows beside its paused preview
//   setSound(dir, key, value)    the piece's sound, chosen in the Studio: its plan in modules.json (what renders read)
//                                and its storyboard shot; its approval goes. Refused once Live Motion is approved.
//
// What the Stage plays with a piece (protocol.js load):
//   voices    the narration WAVs the pipeline cached for the slide (macOS say's for the draft, the film's), placed at
//             the slide's lead (voiceAt); a between piece has none
//   music     score:<preset> plays live from the Stage's score Worker (the same DSP as the stem, the piece's own
//             seed and hits); a library track, the user's file or effects alone play the stem when the last one was
//             made for that sound, else the track itself (effects alone, with no stem yet: silent until the first)
//   bubble    a Duet's filmed avatar clip for its slide, once filmed (the pipeline's cache); before that the
//             keep-out alone
//   ref       the first reference of the piece's plan or shot: its motion.mp4, else its frames (up to 24)
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const livemotion = require('./livemotion');
const motion = require('./motion');
const score = require('./score');
const episode = require('./episode');

const SOURCE = 'livemotion';
const ID = /^lm-[0-9a-f]{24}$/;
const KEEP = 400; // ids remembered (each is a few bytes; the oldest go)
const MUSIC_EXT = ['wav', 'mp3', 'm4a'];
const REF_FRAMES = 24;
const PLACEMENT = { duet: 'duet', interstitial: 'between', cutscene: 'between' };

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const exists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
/** A plain file, not a link to somewhere else: all the Stage is ever handed of an episode's media. */
const plainFile = (p) => { try { const s = fs.lstatSync(p); return s.isFile() && !s.isSymbolicLink(); } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const readJson = (p, fallback = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } };
const pres = (dir, ...p) => path.join(dir, 'presentation', ...p);
const pad2 = (n) => String(n).padStart(2, '0');
const r3 = (x) => Math.round(x * 1000) / 1000;
/** The presets the Stage's score Worker plays: flpt-score's own (protocol.js's ENUMS.preset; a test holds them equal). */
const presetsOf = (deps = {}) => { try { return score.presetIds(deps.engineRoot); } catch { return []; } };

// ── the pieces the Stage may name ────────────────────────────────────────────────────────────────────────────────────

const PIECES = new Map(); // id → { dir, key, sound }
/** The Stage's name for a piece: an opaque id, the same for the same piece. o.sound: a sound to preview in its place. */
function idFor(dir, key, { sound = null } = {}) {
  const d = path.resolve(String(dir));
  if (typeof key !== 'string' || !livemotion.KEY.test(key)) throw new Error('That isn\'t a Live Motion piece.');
  const id = `lm-${crypto.createHash('sha256').update(`${d}\0${key}`).digest('hex').slice(0, 24)}`;
  PIECES.delete(id);
  PIECES.set(id, { dir: d, key, sound: sound ? cleanSound(sound) : null });
  while (PIECES.size > KEEP) PIECES.delete(PIECES.keys().next().value);
  return id;
}
const entryOf = (id) => (typeof id === 'string' && ID.test(id) ? PIECES.get(id) || null : null);

/** A sound as the picker gives it, checked: { music, sfx } (score.parseMusic / parseSfx), or a plain error. */
function cleanSound(v, { engineRoot } = {}) {
  if (!isObj(v)) throw new Error('That isn\'t a sound FLPT knows.');
  const music = v.music == null || v.music === '' ? 'none' : String(v.music);
  const sfx = v.sfx == null || v.sfx === '' ? 'off' : String(v.sfx);
  if (music.length > 160) throw new Error('That isn\'t a sound FLPT knows.');
  score.parseMusic(music, engineRoot ? { engineRoot } : {});
  score.parseSfx(sfx);
  return { music, sfx };
}

// ── what the Stage plays with a piece ──────────────────────────────────────────────────────────────────────────────

/** The piece, FLPT's and started (its record and its scene.js), or a plain error. */
function startedPiece(dir, key) {
  const p = livemotion.pieceOf(dir, key);
  const rec = livemotion.recordOf(dir, p);
  if (!rec || rec.key !== p.key || !exists(path.join(livemotion.folderOf(dir, p), 'scene.js'))) throw new Error('That piece isn\'t drawn yet.');
  return { p, rec };
}

/** The references this piece may show beside it: its plan's, then its storyboard shot's (as the scene crew sees them). */
function refsOf(dir, p) {
  const out = new Set(p.plan.refs);
  try {
    const board = require('./storyboard').read(dir);
    const s = board && p.shot ? board.shots.find((x) => x.id === p.shot) : null;
    for (const r of (s && s.refs) || []) out.add(String(r).replace(/^refs\//, ''));
  } catch { /* no board */ }
  return [...out].filter((r) => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(r));
}

/**
 * The first reference that has pixels: its motion clip (refs/<id>/motion.mp4, or an uploaded source video), else its
 * frames (frames/still_NN.<ext>, one extension, up to 24), else its first picture. → { spec, files, id } or null
 */
function refFor(dir, p) {
  for (const id of refsOf(dir, p)) {
    const root = pres(dir, 'refs', id);
    if (!isDir(root)) continue;
    const plain = plainFile;
    for (const name of ['motion.mp4', 'source.mp4', 'source.webm', 'motion.webm']) {
      const f = path.join(root, name);
      if (plain(f)) {
        const ext = name.endsWith('.webm') ? 'webm' : 'mp4';
        return { id, spec: { ref: 'video', refExt: ext, refLoop: true }, files: { [`ref.${ext}`]: f } };
      }
    }
    let frames = [];
    try { frames = fs.readdirSync(path.join(root, 'frames')).filter((f) => /^still_\d{1,3}\.(png|jpg|webp)$/.test(f)).sort(); } catch { frames = []; }
    const ext = frames.length ? frames[0].split('.').pop() : null;
    frames = frames.filter((f) => f.endsWith(`.${ext}`) && plain(path.join(root, 'frames', f))).slice(0, REF_FRAMES);
    if (frames.length > 1) {
      const files = {};
      frames.forEach((f, i) => { files[`frame-${pad2(i + 1)}.${ext}`] = path.join(root, 'frames', f); });
      return { id, spec: { ref: 'frames', refFrames: frames.length, refImageExt: ext }, files };
    }
    if (frames.length === 1) return { id, spec: { ref: 'image', refImageExt: ext }, files: { [`image.${ext}`]: path.join(root, 'frames', frames[0]) } };
  }
  return null;
}

/** A Duet's filmed avatar clip for slide n, from the pipeline's cache (its jobs list), the newest; or null. */
function filmedClip(dir, n) {
  const root = pres(dir, 'video', 'cache', 'avatar');
  const jobs = readJson(path.join(root, 'jobs.json'), null);
  if (!isObj(jobs)) return null;
  const found = Object.entries(jobs)
    .filter(([k, j]) => isObj(j) && Number(j.slide) === n && /^[A-Za-z0-9_.-]{1,128}$/.test(k))
    .map(([k]) => path.join(root, 'clips', `${k}.mp4`))
    .filter(plainFile)
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return found[0] || null;
}

/** The track a sound names as a file the Stage can play (a shipped CC BY track, the user's own), or null. */
function musicFile(music, dir, deps = {}) {
  const m = /^(library|file):([A-Za-z0-9._-]{1,128})$/.exec(String(music));
  if (!m) return null;
  let file = null;
  if (m[1] === 'library') {
    const item = (deps.library || (deps.engineRoot ? livemotion.shippedLibrary(deps.engineRoot) : [])).find((x) => x && x.id === m[2] && x.kind === 'music');
    file = item ? item.filePath || item.file || null : null;
  } else {
    try { file = (deps.files || require('./api/sound').filesOf(dir))[m[2]] || null; } catch { file = null; }
  }
  const ext = file ? path.extname(file).slice(1).toLowerCase() : '';
  return file && plainFile(file) && MUSIC_EXT.includes(ext) ? { file, ext } : null;
}

/** The piece's beats.json duration (the timed one), its seconds, else 8. */
function durationOf(dir, p) {
  const b = readJson(path.join(livemotion.folderOf(dir, p), 'beats.json'), {}) || {};
  return Number(b.duration) > 0 ? Number(b.duration) : p.seconds || 8;
}

/**
 * The piece's parts for the Stage: the protocol's load fields, its media and reference files (protocol names only),
 * and what the Studio shows about it. o.sound: a sound to play in place of its own (the picker's preview).
 */
function piece(dir, key, deps = {}, o = {}) {
  const { p, rec } = startedPiece(dir, key);
  const folder = livemotion.folderOf(dir, p);
  const narrated = livemotion.NARRATED.has(p.kind);
  const media = {};
  const load = { kind: 'scene', placement: PLACEMENT[p.kind] || 'solo', voices: 'none', voiceAt: 0, music: 'none', sfx: 'off', seed: livemotion.seedOf(p.key), ref: 'none', bubble: 'none' };
  // the voices: the slide's narration as the pipeline cached it (the draft's, the film's), at the slide's lead
  const voices = { draft: false, filmed: false };
  if (narrated && p.n) {
    const draft = motion.narrationWav(dir, p.n, 'draft');
    const filmed = motion.narrationWav(dir, p.n, 'final');
    if (draft && plainFile(draft)) { media['voice-draft.wav'] = draft; voices.draft = true; }
    if (filmed && plainFile(filmed)) { media['voice-filmed.wav'] = filmed; voices.filmed = true; }
    load.voices = voices.draft && voices.filmed ? 'both' : voices.draft ? 'draft' : voices.filmed ? 'filmed' : 'none';
    try { load.voiceAt = r3(require('./animators').leadOf(dir, p.n)); } catch { load.voiceAt = 0; }
  }
  // the sound: its own (its plan's, else its style's, else its kind's), or the one being previewed
  let style = null;
  try { style = livemotion.styleFor(dir, p, deps).style; } catch { style = null; }
  const own = livemotion.soundOf(p, style, deps);
  const sound = o.sound ? cleanSound(o.sound, deps) : own;
  // a score plays live (it follows the code as the crew writes it); anything else plays its stem when the last one was
  // made for this sound (effects alone included), else the track itself
  const m = /^score:(.+)$/.exec(sound.music);
  if (m && presetsOf(deps).includes(m[1])) Object.assign(load, { music: 'score', preset: m[1], sfx: sound.sfx });
  else if (sound.music !== 'none' || sound.sfx !== 'off') {
    const sc = readJson(path.join(folder, 'score', 'score.json'), null);
    const stem = path.join(folder, 'score', 'stem.wav');
    const same = Boolean(sc && isObj(sc.sound) && sc.sound.music === sound.music && sc.sound.sfx === sound.sfx && sc.stem && plainFile(stem));
    const file = same ? null : musicFile(sound.music, dir, deps);
    if (same) { load.music = 'stem'; media['stem.wav'] = stem; } else if (file) { Object.assign(load, { music: 'file', file: file.ext }); media[`music.${file.ext}`] = file.file; }
  }
  // a Duet's filmed avatar, once there is one; else the cartoon presenter's clip for that slide (W3-05)
  const clip = p.kind === 'duet' && p.n ? (filmedClip(dir, p.n) || require('./presenter').clipFor(dir, p.n)) : null;
  if (clip) { load.bubble = 'clip'; media['bubble.mp4'] = clip; }
  const r = refFor(dir, p);
  if (r) Object.assign(load, r.spec);
  const poster = p.n && exists(pres(dir, 'slides', `slide_${pad2(p.n)}.png`)) ? pres(dir, 'slides', `slide_${pad2(p.n)}.png`) : null;
  const render = exists(path.join(folder, 'renders', 'preview.mp4')) ? path.join(folder, 'renders', 'preview.mp4') : null;
  const info = {
    key: p.key, kind: p.kind, tile: livemotion.TILE[p.kind], placement: p.placement, n: p.n, id: p.id, shot: p.shot, title: p.title,
    style: rec.style ? rec.style.id : null, duration: r3(durationOf(dir, p)), voices, reference: r ? r.spec.ref : null, bubble: load.bubble,
    duet: p.kind === 'duet', sound: own, preview: o.sound ? sound : null, editable: soundEditable(dir), stageApproved: stageApproved(dir),
  };
  return { load, media, ref: r ? r.files : {}, info, poster, render, piece: p, record: rec };
}

/** Is Live Motion approved? Then the Studio only shows: no takes, Ask for changes, Again or Approve (the wall's rule). */
function stageApproved(dir) {
  const st = episode.read(dir);
  return Boolean(st && st.stages && st.stages.animate && st.stages.animate.status === 'approved');
}

/** Can the Studio change a piece's sound now? Not once Live Motion is approved (its approval would mean another sound). */
function soundEditable(dir) {
  const st = episode.read(dir);
  return Boolean(st && st.stages && (!st.stages.animate || st.stages.animate.status !== 'approved'));
}

/** Is this file one of the crew's own (what a live reload follows): its four files and the pictures it took in. */
function crewFile(rel) {
  const r = String(rel || '').split(path.sep).join('/');
  return livemotion.CREW_FILES.includes(r) || /^assets\/pictures\/[^/]+$/.test(r) || r === 'assets/pictures';
}

/**
 * The piece as shell/stage.js's addSource resolves it: the host page built with the Stage's host (host-preview.js)
 * into the Stage's own work folder, from a fresh stage of the crew's files; rebuilt after every change to them.
 * o: { work, sound } · deps: { engineRoot, styles, env, library, files }
 */
async function stagePiece(dir, key, o = {}, deps = {}) {
  if (!o.work) throw new Error('stagePiece: a work folder');
  const parts = piece(dir, key, deps, { sound: o.sound || null });
  const p = parts.piece;
  const rec = parts.record;
  const styleDir = livemotion.styleDirOf(dir, p, deps);
  if (!styleDir) throw new Error(`The episode has no copy of the ${rec.style && rec.style.id} style.`);
  const { buildPage } = await livemotion.tool(deps.engineRoot, 'page.mjs');
  const build = () => {
    const { stage, done } = livemotion.stageOf(dir, p, { styleDir });
    try {
      return buildPage({ scene: stage, work: o.work, host: 'preview', duration: durationOf(dir, p), hold: livemotion.HOLD, styles: { [rec.style.id]: styleDir } });
    } finally { done(); }
  };
  const pg = build();
  return {
    dir: pg.work, load: parts.load, media: parts.media, ref: parts.ref,
    watch: livemotion.folderOf(dir, p), ignore: (rel) => !crewFile(rel), rebuild: build,
    poster: parts.poster, render: parts.render, scene: livemotion.folderOf(dir, p), duration: pg.duration, trusted: false,
  };
}

/** The Stage source for shell/stage.js: deps() gives the host's engine, styles and toolchain at the moment it resolves. */
function source(deps = () => ({})) {
  return async (spec, { work }) => {
    const e = entryOf(spec && spec.id);
    if (!e) throw new Error('No such piece.');
    return stagePiece(e.dir, e.key, { work, sound: e.sound }, typeof deps === 'function' ? deps() : deps);
  };
}

// ── Snapshot this frame ────────────────────────────────────────────────────────────────────────────────────────────

let snapRoot = null;
let snapSeq = 0;
/** Where snapshots go: one folder per process in the temporary folder, each new one replacing the last. */
function snapFile() {
  if (!snapRoot || !isDir(snapRoot)) {
    let tmp = os.tmpdir();
    try { tmp = fs.realpathSync(tmp); } catch { /* as it is */ }
    snapRoot = fs.mkdtempSync(path.join(tmp, 'flpt-studio-snap-'));
  }
  for (const f of fs.readdirSync(snapRoot)) fs.rmSync(path.join(snapRoot, f), { force: true });
  snapSeq += 1;
  return path.join(snapRoot, `snapshot-${snapSeq}.png`);
}

/**
 * The exact frame at t, rendered by the final renderer from a fresh stage of the crew's files (in FLPT's sandbox:
 * stage/snapshot.mjs refuses without one), into a PNG. deps: { engineRoot, env (the toolchain's, FLPT_NODE named),
 * styles, snapshot (tests: the renderer) } → { ok, file, t, F } · { ok: false, problem }
 */
async function snapshot(dir, key, t, deps = {}) {
  const { p, rec } = startedPiece(dir, key);
  const styleDir = livemotion.styleDirOf(dir, p, deps);
  if (!styleDir) return { ok: false, problem: 'The episode has no copy of its style.' };
  const duration = durationOf(dir, p);
  const at = Math.max(0, Math.min(duration, Number(t) || 0));
  const out = snapFile();
  const { stage, done } = livemotion.stageOf(dir, p, { styleDir });
  try {
    let render = deps.snapshot;
    if (!render) {
      const mod = await import(pathToFileURL(path.join(livemotion.runtimeDir(deps.engineRoot), 'stage', 'snapshot.mjs')).href);
      render = mod.snapshot;
    }
    const r = await render({ scene: stage, t: at, out, duration, styles: { [rec.style.id]: styleDir }, env: deps.env ? livemotion.toolEnv(deps.env) : undefined });
    if (!r || !r.ok || !exists(out)) return { ok: false, problem: String((r && r.problem) || 'No frame came back.').slice(0, 300) };
    return { ok: true, file: out, t: r.t == null ? at : r.t, F: r.F == null ? Math.floor(at * livemotion.FPS + 1e-6) : r.F };
  } finally { done(); }
}

// ── the piece's sound, chosen in the Studio ────────────────────────────────────────────────────────────────────────

/**
 * Keep a sound for a piece: its entry in modules.json (scene.sound, what its renders read) and its storyboard shot's
 * sound. A piece approved alone loses its approval (it would sound different). Refused once Live Motion is approved.
 * → the sound kept
 */
function setSound(dir, key, value, deps = {}) {
  const sound = cleanSound(value, deps);
  if (!soundEditable(dir)) throw new Error('Live Motion is approved.');
  const p = livemotion.pieceOf(dir, key);
  const file = pres(dir, 'deck', 'project', 'modules.json');
  const map = readJson(file, null);
  if (!isObj(map)) throw new Error('The deck has no modules.json.');
  let e = null;
  if (p.placement === 'slide') e = isObj(map.slides) && isObj(map.slides[p.id]) ? map.slides[p.id] : null;
  else if (p.kind === 'interstitial') e = (Array.isArray(map.jsscenes) ? map.jsscenes : []).find((x) => isObj(x) && x.id === p.id) || null;
  else {
    const list = Array.isArray(map.cutscenes) ? map.cutscenes : [];
    const ids = livemotion.cutIds(list);
    const i = list.findIndex((x, j) => isObj(x) && `C${ids[j]}` === p.id && require('./modules').makeOf(x) === 'code');
    e = i >= 0 ? list[i] : null;
  }
  if (!e) throw new Error('That Live Motion piece isn\'t in the deck any more.');
  e.scene = { ...(isObj(e.scene) ? e.scene : {}), sound };
  if (isObj(e.sound)) delete e.sound; // the plan's own place for it is scene.sound
  livemotion.writeJson(file, map);
  try {
    const sb = require('./storyboard');
    const board = sb.read(dir);
    const s = board && p.shot ? board.shots.find((x) => x.id === p.shot) : null;
    if (s && JSON.stringify(s.sound || null) !== JSON.stringify(sound)) { s.sound = { ...sound }; sb.write(dir, board); }
  } catch { /* no storyboard (an older episode): modules.json is the plan */ }
  const live = (episode.read(dir) || {}).live || {};
  const entry = live[livemotion.liveId(p)];
  if (entry && entry.approved) livemotion.noteLive(dir, p, { approved: false, approvedBy: null });
  return sound;
}

module.exports = {
  SOURCE, idFor, entryOf, cleanSound, piece, stagePiece, source, snapshot, setSound, refFor, refsOf, filmedClip, musicFile, crewFile, soundEditable,
  stageApproved, durationOf, presetsOf,
};
