'use strict';
// Episode covers (W3-04, PLAN §3.3 S2): what Episodes home shows for an episode. The cover is its first slide's picture;
// the cover loop is 5 s of its first approved Live Motion piece, cut free with ffmpeg (no provider, no key) into
// presentation/cover/cover.mp4: 640 px wide, silent, its last half second crossfaded into its first so it loops without
// a seam. cover.json says which clip it was cut from (its size and time), so a piece rendered again makes it again.
//
//   coverOf(dir)                     { png, pngAt, loop, loopAt, source, family }: what there is now (source: the clip a
//                                    loop would be cut from, null when no piece is approved yet; family: the lead
//                                    module's, for a cover without a slide), nothing written
//   make(dir, { ffmpeg, probe })     cut the loop when it's missing or out of date → { ok, loop, made, problem }
//   cutArgs(src, out, start, secs)   ffmpeg's arguments (exported for the tests)
// Nothing here spends; nothing is sent anywhere.
const fs = require('fs');
const path = require('path');

const SECONDS = 5;
const XFADE = 0.5; // the loop's seam: its last half second fades into its first
const WIDTH = 640;
const exists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const statOf = (p) => { try { const s = fs.statSync(p); return s.isFile() ? s : null; } catch { return null; } };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const pres = (dir, ...p) => path.join(dir, 'presentation', ...p);
const NO_FFMPEG = 'ffmpeg isn\'t set up.';
let cuts = 0; // each cut writes its own temp file
const coverDir = (dir) => pres(dir, 'cover');

/** The first slide's picture, or null. */
function pngOf(dir) {
  const p = pres(dir, 'slides', 'slide_01.png');
  return exists(p) ? p : null;
}

/**
 * The family of the talk's lead module (its storyboard's first shot that isn't a Title card), for the cover an
 * episode has before its first slide: Home sets the title over a strip in that colour. null without a storyboard.
 * `board` is storyboard.read(dir) (passed in by the tests).
 */
function familyOf(dir, board) {
  let b = board;
  if (b === undefined) { try { b = require('./storyboard').read(dir); } catch { b = null; } }
  let meta = {};
  try { meta = require('./modules').META || {}; } catch { meta = {}; }
  const shots = b && Array.isArray(b.shots) ? b.shots.filter((s) => s && meta[s.module]) : [];
  const lead = shots.find((s) => s.module !== 'statement') || shots[0];
  return lead ? meta[lead.module].family || null : null;
}

/**
 * The clip the loop is cut from: the first approved Live Motion piece in film order (its rendered clip, else its
 * preview), or null. `pieces` is livemotion.view(dir) (passed in by the tests). A piece counts as approved when it was
 * approved on its own, or when the Live Motion stage was and the piece is made.
 */
function sourceOf(dir, { pieces = null, stageApproved = null } = {}) {
  let list = pieces;
  if (!list) { try { list = require('./livemotion').view(dir); } catch { list = []; } }
  let approvedStage = stageApproved;
  if (approvedStage == null) {
    try { const st = require('./episode').read(dir); approvedStage = Boolean(st && st.stages && st.stages.animate && st.stages.animate.status === 'approved'); } catch { approvedStage = false; }
  }
  for (const p of Array.isArray(list) ? list : []) {
    if (!p || typeof p !== 'object') continue;
    const made = p.status === 'ok' || p.status === 'yours' || p.status === 'stale';
    if (!p.approved && !(approvedStage && made)) continue;
    // its rendered clip (livemotion.pieces: media/slide_NN.mp4, or media/jsscene_<id>.mp4 between slides)
    const clip = typeof p.clip === 'string' ? pres(dir, p.clip)
      : p.placement === 'between' && /^[A-Za-z0-9_-]{1,40}$/.test(String(p.id || '')) ? pres(dir, 'media', `jsscene_${p.id}.mp4`)
        : Number.isInteger(p.n) && p.n > 0 ? pres(dir, 'media', `slide_${String(p.n).padStart(2, '0')}.mp4`) : null;
    const preview = typeof p.preview === 'string' ? pres(dir, p.preview) : null;
    for (const f of [clip, preview]) {
      const st = f && statOf(f);
      if (st && st.size > 0 && inside(dir, f)) return { file: f, size: st.size, mtimeMs: Math.round(st.mtimeMs), key: p.key || null };
    }
  }
  return null;
}

/** A path that stays inside the episode's presentation folder (no symlink out). */
function inside(dir, f) {
  try {
    const root = fs.realpathSync(pres(dir));
    const real = fs.realpathSync(f);
    return real === root || real.startsWith(root + path.sep);
  } catch { return false; }
}

/** What the cover is now: the picture, the loop when it's current, and the clip a loop would come from. */
function coverOf(dir, opts = {}) {
  const png = pngOf(dir);
  const src = sourceOf(dir, opts);
  const out = path.join(coverDir(dir), 'cover.mp4');
  const rec = readJson(path.join(coverDir(dir), 'cover.json'));
  const current = Boolean(src && rec && exists(out) && rec.source === path.relative(pres(dir), src.file) && rec.size === src.size && rec.mtimeMs === src.mtimeMs);
  const at = (f) => { const s = f && statOf(f); return s ? Math.round(s.mtimeMs) : null; };
  return { png, pngAt: at(png), loop: current ? out : null, loopAt: current ? at(out) : null, source: src, stale: Boolean(src && !current), family: png ? null : familyOf(dir, opts.board) };
}

/** Where to start the 5 s: a quarter in (past the opening build), never so late that it runs out. */
function startOf(duration) {
  const d = Number(duration) || 0;
  const need = SECONDS + XFADE;
  if (d <= need) return 0;
  return Math.round(Math.min(d * 0.25, d - need) * 1000) / 1000;
}

/** ffmpeg's arguments: 5.5 s from `start`, the last half second crossfaded into the first, 640 px, silent, H.264. */
function cutArgs(src, out, start, secs = SECONDS) {
  const len = secs + XFADE;
  const graph = `[0:v]fps=30,scale=${WIDTH}:-2:flags=lanczos,setsar=1,trim=0:${len},setpts=PTS-STARTPTS,split[a][b];`
    + `[a]trim=${XFADE}:${len},setpts=PTS-STARTPTS[body];[b]trim=0:${XFADE},setpts=PTS-STARTPTS[head];`
    + `[body][head]xfade=transition=fade:duration=${XFADE}:offset=${secs - XFADE},format=yuv420p[v]`;
  return ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(start), '-t', String(len + 0.2), '-i', src,
    '-filter_complex', graph, '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-movflags', '+faststart', out];
}

/**
 * Cut the cover loop when it's missing or out of date. deps: { ffmpeg(args) → { code, err }, probe(file) → ffprobe
 * JSON }. → { ok, loop, made, problem }. Written beside its record only when ffmpeg finished (a temp file, renamed).
 */
async function make(dir, deps = {}, opts = {}) {
  const c = coverOf(dir, opts);
  if (!c.source) return { ok: false, loop: null, made: false, problem: 'No Live Motion piece is approved yet.' };
  if (c.loop && !opts.force) return { ok: true, loop: c.loop, made: false, problem: null };
  if (typeof deps.ffmpeg !== 'function') return { ok: false, loop: null, made: false, problem: NO_FFMPEG };
  let duration = 0;
  try { const info = deps.probe ? await deps.probe(c.source.file) : null; duration = Number(info && info.format && info.format.duration) || 0; } catch { duration = 0; }
  if (duration && duration < 1) return { ok: false, loop: null, made: false, problem: 'The piece is under a second long.' };
  const secs = duration && duration < SECONDS + XFADE ? Math.max(1, Math.round((duration - XFADE) * 100) / 100) : SECONDS;
  fs.mkdirSync(coverDir(dir), { recursive: true });
  const out = path.join(coverDir(dir), 'cover.mp4');
  const tmp = path.join(coverDir(dir), `.cover-${process.pid}-${++cuts}.mp4`);
  const r = await deps.ffmpeg(cutArgs(c.source.file, tmp, startOf(duration), secs));
  if (!r || r.code !== 0 || !exists(tmp)) {
    fs.rmSync(tmp, { force: true });
    return { ok: false, loop: null, made: false, problem: `ffmpeg couldn't cut the cover${r && r.err ? `: ${String(r.err).split('\n')[0].slice(0, 160)}` : '.'}` };
  }
  fs.renameSync(tmp, out);
  const rec = { source: path.relative(pres(dir), c.source.file), size: c.source.size, mtimeMs: c.source.mtimeMs, piece: c.source.key, start: startOf(duration), seconds: secs, at: new Date().toISOString() };
  fs.writeFileSync(path.join(coverDir(dir), 'cover.json'), `${JSON.stringify(rec, null, 1)}\n`);
  return { ok: true, loop: out, made: true, problem: null };
}

module.exports = { coverOf, sourceOf, familyOf, make, cutArgs, startOf, SECONDS, XFADE, WIDTH, NO_FFMPEG };
