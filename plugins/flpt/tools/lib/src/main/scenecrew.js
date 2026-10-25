'use strict';
// The Live Motion scene crew (PLAN §2.3, §2.9, §2.16 items 2 and 4; decisions.md: G0's caps, Michael's notes 12:10):
// one Agent SDK session per piece writes its scene in code (scene.js, beats.json, notes.md, kit-ext.js in its folder,
// livemotion.js) with its own in-process tools, and nothing else: no shell, no web, no Skill, no plugin.
//
//   start_scene         the folder from the style's starter, the plan's beats, the style as the crew may see it
//   use_picture         a picture of this episode into assets/pictures/ (never a reference)
//   use_reference       a reference's card, as numbers and words (crewView), never its pixels or its link
//   use_previous_frame  the picture the piece starts from (the slide before it), into assets/pictures/previous.png
//   narration_timing    every word of the narration, timed (the voice when there is one, else the voices' pace)
//   align_beats         the cues timed to the words; the duration and the hold
//   align_music         a between piece's `at` beats on its music grid
//   lint_scene          the static tripwire, and the words on screen: URLs, handles, emails and phone numbers flagged,
//                       words that aren't in the script or the deck listed (they're shown again at approval)
//   snapshot            stills at chosen times                                      ┐
//   render_preview      the whole piece rendered and checked, with frames to look at ├ 12 draft renders in all
//   contact_sheet       the piece's frames on one sheet                              ┘
//                       both with the pacing check on the preview (pacing.mjs, Q-01: dead gaps, short shots,
//                       flashes, a framing held too long, the motion by second): a report, never a gate
//   compare_with_reference · compare_with_slide · check_bubble · listen   numbers only
//   done                the piece is finished: only after at least two look-fix-render passes (a sheet or stills
//                       looked at, the files changed, rendered again), with what each pass fixed; lint and the text
//                       check clean, a Duet's corner clear; a between piece's delivery render (2 at most)
//
// The crew's policy is writepolicy's scene stage through agents.policy: it writes only its folder's four files, reads
// nothing under refs/ and no style that isn't FLPT's own as shipped (readDeny: a Mine or Shared style reaches it as
// structured fields and its API summary, never its kit's code). Its session runs at the broker's sessionCap of what
// was reserved for it, in the pool it shares with the animators (animators.runCrew).
const fs = require('fs');
const path = require('path');
const agents = require('./agents');
const animators = require('./animators');
const livemotion = require('./livemotion');
const motion = require('./motion');
const references = require('./references');
const broker = require('./broker');

const TOOLS = ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'MultiEdit', 'TodoWrite']; // the file tools: no Skill, no web, no shell
const DISALLOWED = ['WebSearch', 'WebFetch', 'Skill'];
const TOOL_NAMES = ['start_scene', 'use_picture', 'use_reference', 'use_previous_frame', 'narration_timing', 'align_beats', 'align_music', 'lint_scene', 'snapshot',
  'render_preview', 'contact_sheet', 'compare_with_reference', 'compare_with_slide', 'check_bubble', 'listen', 'done'];
const MIN_PASSES = 2;
const W = 1920;
const H = 1080;
const SAFE = { x: 64, y: 64, x1: 1856, y1: 1016 };
const KEEP_OUT = { x: 0, y: 700, w: 380, h: 380 };
const PICTURE = /\.(png|jpe?g|gif|webp|svg)$/i;
const KIND_NAME = { solo: 'Motion Solo', duet: 'Motion Duet', cosmos: 'Cosmos drawn in code', interstitial: 'Solo ♪ (an interstitial)', cutscene: 'cut scene drawn in code' };

const exists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const mtime = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
const readJson = (p, fallback = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } };
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const pad2 = (n) => String(n).padStart(2, '0');
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** Times the crew names: numbers from 0 to 600 s, at most 12, each on a frame's middle (stills are mid-frame, K1). */
const timesOf = (list, max = 12) => (Array.isArray(list) ? list : []).map(Number).filter((t) => Number.isFinite(t) && t >= 0 && t <= 600).slice(0, max)
  .map((t) => (Math.floor(t * 30 + 1e-6) + 0.5) / 30);

// ── what's on screen ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The text check on one moment's registered boxes: a box partly off the frame (one wholly off it is the camera's
 * business, not a mistake), outside the 64 px safe area, two overlapping (a stamp overprints on purpose), and on a
 * Duet, any text in the presenter's corner. → [issue]
 */
function boxIssues(boxes, { duet = false } = {}) {
  const out = [];
  const on = (Array.isArray(boxes) ? boxes : []).filter((b) => b && [b.x, b.y, b.w, b.h].every(Number.isFinite) && b.w > 0 && b.h > 0)
    .filter((b) => !(b.x + b.w <= 0 || b.y + b.h <= 0 || b.x >= W || b.y >= H));
  const say = (b) => `"${String(b.str || b.id || '').slice(0, 40)}"`;
  for (const b of on) {
    if (b.x < 0 || b.y < 0 || b.x + b.w > W || b.y + b.h > H) out.push(`cut off: ${say(b)}`);
    else if (b.x < SAFE.x || b.y < SAFE.y || b.x + b.w > SAFE.x1 || b.y + b.h > SAFE.y1) out.push(`outside the safe area: ${say(b)}`);
    if (duet && b.x < KEEP_OUT.x + KEEP_OUT.w && b.y + b.h > KEEP_OUT.y) out.push(`in the presenter's corner: ${say(b)}`);
  }
  for (let i = 0; i < on.length; i++) {
    for (let j = i + 1; j < on.length; j++) {
      const a = on[i];
      const b = on[j];
      if (/^stamp:/.test(String(a.id)) || /^stamp:/.test(String(b.id))) continue;
      const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      if (ix * iy > 0.1 * Math.min(a.w * a.h, b.w * b.h)) out.push(`overlap: ${say(a)} / ${say(b)}`);
    }
  }
  return [...new Set(out)];
}

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’.,-]*/gu;
const wordsIn = (text) => (String(text).match(WORD) || []).map((w) => w.toLowerCase().replace(/[’]/g, '\'').replace(/[.,'-]+$/, '').replace(/^'+/, '')).filter((w) => w.length > 1 || /\d/.test(w));

/** Every word the script and the deck say: what the screen may say without being listed at approval. */
function knownWords(dir) {
  const out = new Set();
  const add = (t) => { for (const w of wordsIn(t)) { out.add(w); out.add(w.replace(/,/g, '')); } };
  try { add(fs.readFileSync(path.join(dir, 'presentation', 'script.md'), 'utf8').replace(/\[[^\]]*\]/g, ' ')); } catch { /* none yet */ }
  const slides = path.join(dir, 'presentation', 'deck', 'project', 'slides');
  try { for (const f of fs.readdirSync(slides)) if (f.endsWith('.html')) add(fs.readFileSync(path.join(slides, f), 'utf8').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ')); } catch { /* none */ }
  return out;
}

/** The on-screen words that aren't in the script or the deck (D5 of the review): [word], first seen order. */
function unlistedWords(dir, strings) {
  const known = knownWords(dir);
  const out = [];
  for (const s of strings) for (const w of wordsIn(s)) if (!known.has(w) && !known.has(w.replace(/,/g, '')) && !out.includes(w)) out.push(w);
  return out.slice(0, 60);
}

/**
 * A shipped style's own showcase stills: its Gallery posters (Resources/styles/<id>/ in the app, app/assets/styles/<id>/
 * in development; deps.showcaseRoot for a host or a test). The plugin ships none: then []. → [absolute path]
 */
function showcaseStills(id, deps = {}) {
  if (!/^[a-z0-9-]{1,40}$/.test(String(id || ''))) return [];
  const roots = [deps.showcaseRoot, process.resourcesPath && path.join(process.resourcesPath, 'styles'), require('./styles').shippedMediaRoot()].filter((r) => typeof r === 'string' && path.isAbsolute(r));
  for (const r of roots) {
    const files = ['poster.jpg', 'poster-tall.jpg'].map((n) => path.join(r, id, n)).filter(exists);
    if (files.length) return files;
  }
  return [];
}

/** Times worth checking: just after each keyframe (else each beat, else six spread evenly), at most 12. */
function momentsOf(meta, beats, duration) {
  const kf = (meta && Array.isArray(meta.keyframes) && meta.keyframes.length ? meta.keyframes : (Array.isArray(beats) ? beats : []).map((x) => x && x.t))
    .map(Number).filter((t) => Number.isFinite(t) && t >= 0 && t < duration).map((t) => Math.min(duration - 1 / 30, t + 0.4));
  const out = kf.length ? kf : Array.from({ length: 6 }, (_, i) => ((i + 0.5) / 6) * duration);
  return timesOf([...new Set(out.map((t) => Math.round(t * 30) / 30))].sort((x, y) => x - y));
}

/**
 * A finished piece's checks at the timing it has now (G1: run after every re-time, draft → filmed voice; the crew's own
 * ran on the draft's): the static lint's errors, the words on screen (no URLs, handles, emails or phone numbers) and the
 * text check (cut off, outside the safe area, overlapping, a Duet's presenter corner) at its keyframes; and the pacing
 * check on its rendered clip (deps.clip, else the piece's own in media/, when there is one: Q-01). A check that can't
 * run is a problem too, never a pass. → { ok, problems: [line], pacing (the report, or null) }
 */
async function checkPiece(dir, key, deps = {}) {
  const piece = typeof key === 'string' ? livemotion.pieceOf(dir, key) : key;
  const problems = [];
  try {
    const lint = (await livemotion.lintPiece(dir, piece, deps)).filter((p) => p.level === 'error');
    problems.push(...lint.slice(0, 4).map((p) => `lint: ${p.rule}: ${p.message}`));
    const b = readJson(path.join(livemotion.folderOf(dir, piece), 'beats.json'), {}) || {};
    const duration = Number(b.duration) || piece.seconds || 8;
    const page = async (at) => {
      const r = await livemotion.metaOf(dir, piece, { ...deps, at });
      if (!r || r.ok === false) throw new Error(String((r && r.problem) || 'the page didn\'t load').slice(0, 200));
      return r;
    };
    const m = await page(momentsOf((await page(null)).meta, b.beats, duration));
    const strings = [...new Set((m.text || []).flatMap((x) => (x.text || []).map((d) => d.str)).filter(Boolean))];
    const { textReport } = await livemotion.tool(deps.engineRoot, 'lint.mjs');
    const flagged = textReport(strings);
    if (flagged.length) problems.push(`on screen: ${flagged.slice(0, 3).map((f) => `"${f.text}" (${f.flags.join(', ')})`).join('; ')}`);
    problems.push(...(m.boxes || []).flatMap((x) => boxIssues(x.boxes, { duet: piece.kind === 'duet' }).map((i) => `${x.t.toFixed(2)} s: ${i}`)).slice(0, 8));
  } catch (e) {
    problems.push(`the check didn't run: ${String(e && e.message ? e.message : e).slice(0, 200)}`);
  }
  // the pacing check on the clip this run rendered (Q-01): a report, never a gate on done or the film, but a flag is
  // "needs a look" like any other
  let pacing = null;
  const clip = deps.clip || (piece.clip ? path.join(dir, 'presentation', piece.clip) : null);
  if (clip && exists(clip)) {
    const folder = livemotion.folderOf(dir, piece);
    try {
      pacing = await pacingOf(clip, { kind: piece.kind, beats: readJson(path.join(folder, 'beats.json'), {}) || {}, work: path.join(folder, 'check'), deps });
      problems.push(...pacing.flags.slice(0, 3).map((f) => `pacing: ${f}`));
    } catch (e) {
      problems.push(`the pacing check didn't run: ${String(e && e.message ? e.message : e).slice(0, 200)}`);
    }
  }
  return { ok: !problems.length, problems, pacing };
}

/**
 * The pacing check (engine/runtime/flpt-live/tools/pacing.mjs) on a rendered clip: its grey frames through FLPT's
 * sandboxed ffmpeg into `work` (deleted after), measured against the piece's kind and its beats' holds. deps.pacing
 * (clip, { kind, beats }) stands in for it (the tests, a host's own). → pacing.mjs's report
 */
async function pacingOf(clip, { kind, beats, work, deps = {}, exec = null }) {
  if (typeof deps.pacing === 'function') return deps.pacing(clip, { kind, beats });
  const P = await livemotion.tool(deps.engineRoot, 'pacing.mjs');
  const run = exec || animators.createExec({ env: deps.env || process.env, hidden: [] });
  const ffmpeg = deps.ffmpeg || livemotion.ffmpegOf(deps.env) || 'ffmpeg';
  fs.mkdirSync(work, { recursive: true });
  const gray = path.join(work, `pacing-${process.pid}-${Math.random().toString(36).slice(2, 8)}.gray`);
  try {
    const r = await run(ffmpeg, ['-hide_banner', '-nostdin', ...P.greyArgs(clip, { out: gray })], { cwd: work, writable: [work], timeoutMs: 180000, signal: deps.signal });
    let buf = null;
    try { buf = fs.readFileSync(gray); } catch { buf = null; }
    if (!buf || !buf.length) throw new Error(`the clip couldn't be read${r && r.out ? ` (${String(r.out).trim().split('\n').pop().slice(0, 160)})` : ''}`);
    return P.analyse(buf, { kind, beats });
  } finally {
    fs.rmSync(gray, { force: true });
  }
}

/**
 * Edge density (the mean luma gradient) in the presenter's corner against the median 120 px tile of the frame, from a
 * grey picture of 1920×1080 (or any size: scaled). → { keepOut, frameMedian, ratio, ok (≤ 1.5×) }
 */
function edgeDensity(gray, w, h) {
  const L = (x, y) => gray[y * w + x];
  const dens = (x0, y0, ww, hh) => {
    let s = 0;
    let n = 0;
    for (let y = y0 + 1; y < y0 + hh - 1; y += 2) for (let x = x0 + 1; x < x0 + ww - 1; x += 2) { s += Math.abs(L(x + 1, y) - L(x - 1, y)) + Math.abs(L(x, y + 1) - L(x, y - 1)); n++; }
    return n ? s / n : 0;
  };
  const k = w / W;
  const tile = Math.max(4, Math.round(120 * k));
  const tiles = [];
  for (let y = 0; y + tile <= h; y += tile) for (let x = 0; x + tile <= w; x += tile) tiles.push(dens(x, y, tile, tile));
  tiles.sort((a, b) => a - b);
  const med = tiles[tiles.length >> 1] || 0;
  const ko = dens(Math.round(KEEP_OUT.x * k), Math.round(KEEP_OUT.y * k), Math.round(KEEP_OUT.w * k), Math.min(h - Math.round(KEEP_OUT.y * k), Math.round(KEEP_OUT.h * k)));
  const ratio = med > 0 ? ko / med : (ko > 0 ? Infinity : 0);
  return { keepOut: r2(ko), frameMedian: r2(med), ratio: Number.isFinite(ratio) ? r2(ratio) : 99, ok: ratio <= 1.5 };
}

// ── the tools ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * One crew's tools for piece `key` of the episode in `dir`. Each returns plain text for the model.
 * ctx: { env (the toolchain's), styles (styles.createStyles), retime(args, o) (a method script on the episode's Python,
 *        sandboxed), exec (animators.createExec: ffmpeg, sandboxed), ffmpeg, renderScene, meta, stills (render-direct's
 *        modes; tests give their own), measureCard (references.measureCard), library, files, signal }
 */
function makeTools(dir, key, engineRoot, ctx = {}) {
  const pres = path.join(dir, 'presentation');
  const piece = livemotion.pieceOf(dir, key);
  const folder = livemotion.folderOf(dir, piece);
  const at = (...p) => path.join(folder, ...p);
  const narrated = livemotion.NARRATED.has(piece.kind);
  const deps = { engineRoot, env: ctx.env || process.env, styles: ctx.styles || livemotion.stylesFor({ engineRoot }), retime: ctx.retime, renderScene: ctx.renderScene,
    meta: ctx.meta, library: ctx.library, files: ctx.files || {}, signal: ctx.signal, ffmpeg: ctx.ffmpeg, showcaseRoot: ctx.showcaseRoot, pacing: ctx.pacing };
  const exec = ctx.exec || animators.createExec({ env: deps.env, hidden: [] });
  const ffmpeg = ctx.ffmpeg || livemotion.ffmpegOf(deps.env) || 'ffmpeg';
  const ff = (args, o = {}) => exec(ffmpeg, ['-hide_banner', '-nostdin', ...args], { cwd: folder, writable: [folder], timeoutMs: 120000, signal: ctx.signal, ...o });
  const ready = () => livemotion.recordOf(dir, piece) && livemotion.recordOf(dir, piece).key === piece.key && exists(at('scene.js')) && exists(at('beats.json'));
  const notReady = 'Set up your folder first with start_scene.';
  const state = () => livemotion.crewState(dir, piece);
  const save = (st) => livemotion.writeCrewState(dir, piece, st);
  const record = () => livemotion.recordOf(dir, piece);
  const remember = (patch) => { const r = record(); if (r) livemotion.writeJson(at(livemotion.SCENE), { ...r, ...patch, checks: { ...(r.checks || {}), ...(patch.checks || {}) } }); };
  const beatsNow = () => readJson(at('beats.json'), {}) || {};
  const styleInfo = () => livemotion.styleFor(dir, piece, deps);

  /** A draft render: counted against the 12, its round remembered (what the files were). Refused past the cap. */
  function draftRound(kind) {
    const st = state();
    if (st.renders.draft >= livemotion.RENDERS.draft) return null;
    st.renders.draft += 1;
    const round = { n: st.rounds.length + 1, kind, sha: livemotion.filesSha(folder), at: new Date().toISOString(), looked: false, files: [] };
    const prev = st.rounds[st.rounds.length - 1];
    round.fix = Boolean(prev && prev.looked && prev.sha !== round.sha);
    st.rounds.push(round);
    save(st);
    return round;
  }
  /** The pictures a round made, so a Read of one of them counts as looking at that round. */
  function roundFiles(n, files) {
    const st = state();
    const r = st.rounds.find((x) => x.n === n);
    if (r) { r.files = files.map((f) => path.relative(folder, f)); save(st); }
  }
  /** The crew opened a file (the policy tells us): a picture a round made means that round was looked at. */
  function saw(p) {
    if (typeof p !== 'string' || !PICTURE.test(p)) return;
    const rel = path.relative(folder, path.resolve(pres, p));
    if (rel.startsWith('..')) return;
    const st = state();
    let changed = false;
    for (const r of st.rounds) if (!r.looked && (r.files || []).includes(rel)) { r.looked = true; changed = true; }
    if (changed) save(st);
  }
  const passes = () => state().rounds.filter((r) => r.fix).length;
  const rendersLeft = () => `${livemotion.RENDERS.draft - state().renders.draft} of ${livemotion.RENDERS.draft} draft renders left`;
  const capped = `That's the last draft render (${livemotion.RENDERS.draft}). Finish with done.`;

  /** The pacing check's lines on a preview (pacing.mjs), measured once per preview; its flags counted in the record. */
  let paced = null;
  async function pacingLines(video) {
    let key;
    try { const s = fs.statSync(video); key = `${s.size}:${s.mtimeMs}`; } catch { return []; }
    if (!paced || paced.key !== key) {
      let r;
      try { r = await pacingOf(video, { kind: piece.kind, beats: beatsNow(), work: at('check'), deps, exec }); } catch (e) { return [`Pacing: not measured (${String(e && e.message ? e.message : e).slice(0, 160)}).`]; }
      paced = { key, r };
      remember({ checks: { pacing: r.flags.length } });
    }
    const { lines } = await livemotion.tool(engineRoot, 'pacing.mjs');
    return lines(paced.r);
  }

  /** Time the piece (cues to the words, or `at` beats to the music) and make the page again. */
  async function timed() {
    const a = await livemotion.align(dir, piece, deps);
    await livemotion.page(dir, piece, { ...deps, duration: a.duration });
    return a;
  }

  async function start({ fresh = false } = {}) {
    const r = await livemotion.scaffold(dir, piece, { ...deps, fresh });
    const s = styleInfo();
    const rel = (p) => path.relative(pres, p);
    const view = s.view || {};
    const styleLines = s.trust === 'shipped'
      ? [`Style: ${view.name || s.id} (${s.id}@${s.version}), FLPT's own: read ${rel(path.join(s.dir, 'STYLE.md'))} and its kit, ${rel(path.join(s.dir, 'kit.js'))}, before you draw.`]
      : [`Style: ${view.name || s.id} (${s.id}@${s.version}), the user's own: its code stays closed. What you may use:`,
        `tokens ${JSON.stringify(view.tokens || {})}`, `motion ${JSON.stringify(view.motion || null)}`,
        `its kit's functions (ctx.kit): ${(view.api || []).map((f) => `${f.fn}(${(f.params || []).join(', ')})${f.doc ? `: ${f.doc}` : ''}`).join('; ') || 'none listed'}`, view.notes || ''];
    const b = beatsNow();
    // the style's own showcase stills (FLPT's own styles: the Gallery's posters), a bar to Read before the first render (G1)
    const shown = [];
    if (s.trust === 'shipped') {
      for (const f of showcaseStills(s.id, deps)) {
        fs.mkdirSync(at('assets', 'showcase'), { recursive: true });
        fs.copyFileSync(f, at('assets', 'showcase', path.basename(f)));
        shown.push(`${piece.folder}/assets/showcase/${path.basename(f)}`);
      }
    }
    return [
      r.created ? `Set up ${piece.folder}/ from the ${s.id} starter: scene.js (the starter: change the world, keep the grammar), beats.json (${(b.beats || []).length} beats), notes.md.`
        : r.restored ? `Your folder came back as it was (${piece.folder}/).` : `Your folder is set up (${piece.folder}/): edit scene.js and beats.json, or start again with fresh: true.`,
      ...styleLines.filter(Boolean),
      shown.length ? `The style's own showcase, to Read before your first render (its finish is the bar; its subject isn't yours): ${shown.join(', ')}.` : null,
      `You write only scene.js, beats.json, notes.md and kit-ext.js there. The host page, assets/, scene.json and score/ are FLPT's.`,
    ].filter(Boolean).join('\n');
  }

  async function usePicture({ path: p } = {}) {
    if (!ready()) return notReady;
    let file;
    try { file = fs.realpathSync(path.resolve(pres, String(p || ''))); } catch { return `${p} isn't there.`; }
    const root = fs.realpathSync(pres);
    if (!file.startsWith(root + path.sep) || !fs.statSync(file).isFile()) return `${p} isn't a file inside this episode.`;
    if (references.isReference(file)) return 'References stay private: they reach you as numbers and words (use_reference), never as pictures.';
    if (!PICTURE.test(file)) return 'Pictures only: PNG, JPEG, GIF, WebP or SVG.';
    if (fs.statSync(file).size > 50 * 1024 * 1024) return 'That picture is over 50 MB.';
    if (file.startsWith(fs.realpathSync(folder) + path.sep)) return 'That picture is already in your folder.';
    const name = path.basename(file).normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/^-+/, '').slice(-80) || 'picture.png';
    fs.mkdirSync(at('assets', 'pictures'), { recursive: true });
    fs.copyFileSync(file, at('assets', 'pictures', name));
    return `Copied to assets/pictures/${name}: ctx.asset('${name}').`;
  }

  /** The references this piece may use: its plan's, and its storyboard shot's. */
  function refsOf() {
    const out = new Set(piece.plan.refs);
    try {
      const board = require('./storyboard').read(dir);
      const s = board && piece.shot ? board.shots.find((x) => x.id === piece.shot) : null;
      for (const r of (s && s.refs) || []) out.add(String(r).replace(/^refs\//, ''));
    } catch { /* no board */ }
    return [...out].filter((r) => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(r));
  }
  function cardOf(ref) {
    const list = refsOf();
    if (!list.length) return { error: 'This piece has no reference.' };
    const id = ref == null || ref === '' ? list[0] : String(ref).replace(/^refs\//, '');
    if (!list.includes(id)) return { error: `Its references are ${list.join(', ')}.` };
    const card = readJson(path.join(pres, 'refs', id, 'card.json'), null);
    if (!card) return { error: 'That reference has no card yet.' };
    try { return { id, card: references.validateCard(card) }; } catch { return { error: 'That reference\'s card can\'t be read.' }; }
  }
  async function useReference({ ref } = {}) {
    const c = cardOf(ref);
    if (c.error) return c.error;
    return `Reference ${c.id} as measured (match its feel, never copy it):\n${JSON.stringify(references.crewView(c.card), null, 1)}`;
  }

  async function usePreviousFrame() {
    if (!ready()) return notReady;
    const n = piece.placement === 'slide' ? piece.n - 1 : piece.afterN;
    if (!n) return 'Nothing comes before this piece: it opens the film.';
    const clip = path.join(pres, 'media', `slide_${pad2(n)}.mp4`);
    const pic = path.join(pres, 'slides', `slide_${pad2(n)}.png`);
    const out = at('assets', 'pictures', 'previous.png');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.rmSync(out, { force: true });
    if (exists(clip)) await ff(['-v', 'error', '-y', '-sseof', '-0.2', '-i', clip, '-update', '1', '-vf', `scale=${W}:${H}`, out]);
    if (!exists(out) && exists(pic)) await ff(['-v', 'error', '-y', '-i', pic, '-vf', `scale=${W}:${H}`, out]);
    if (!exists(out)) return `Slide ${n} has no picture yet.`;
    return `The frame slide ${n} ends on is assets/pictures/previous.png: ctx.asset('previous.png'). Open it with Read.`;
  }

  async function narrationTiming() {
    if (!ready()) return notReady;
    if (!narrated) return `This piece has no narration: it runs ${piece.seconds} s on its music. Use align_music.`;
    const t = await livemotion.timing(dir, piece, deps);
    const rows = [];
    for (let i = 0; i < t.words.length; i += 10) rows.push(`  ${t.words.slice(i, i + 10).map((w) => `${w.start.toFixed(2)} ${w.text}`).join('  ')}`);
    const from = t.source === 'estimate' ? 'estimated at the voices\' pace (no voice yet: the times move when there is one)' : t.source === 'final' ? 'the real voice' : 'the free draft\'s voice (the Mac\'s: the times move after filming)';
    return [`Timed from ${from}. On screen ${t.duration} s; the voice starts ${t.lead} s in. Each word's start, in the piece's own seconds:`, ...rows,
      'FLPT times every beat to the real voice again after filming: cue each beat on these words.'].join('\n');
  }

  async function alignBeats() {
    if (!ready()) return notReady;
    if (!narrated) return 'This piece rides its music: use align_music.';
    let a;
    try { a = await timed(); } catch (e) { return `beats.json: ${e.message}`; }
    const b = beatsNow();
    const late = (b.beats || []).filter((x) => Number.isFinite(x.t) && x.t > a.duration - livemotion.HOLD).map((x) => x.name);
    return [`${a.placed.length} beat${a.placed.length === 1 ? '' : 's'} on their words; ${a.duration} s on screen (${a.frames} frames), the last ${livemotion.HOLD} s still.`,
      ...(b.beats || []).filter((x) => x.cue).map((x) => `  ${x.name}: ${Number.isFinite(x.t) ? `${x.t.toFixed(2)}–${Number(x.end).toFixed(2)} s, "${x.cue}"` : 'not timed'}`),
      a.missed.length ? `Not said: ${a.missed.map((m) => `"${m.cue}" (${m.name})`).join(', ')}. Use the words exactly as the narration says them, in order.` : null,
      late.length ? `In the hold: ${late.join(', ')}. Land them earlier.` : null].filter(Boolean).join('\n');
  }

  async function alignMusic() {
    if (!ready()) return notReady;
    if (narrated) return 'This piece rides the voice: use align_beats.';
    let a;
    try { a = await timed(); } catch (e) { return `beats.json: ${e.message}`; }
    const b = beatsNow();
    return [a.grid ? `The music: ${a.grid.bpm} BPM, ${a.grid.bars} bars in ${a.duration} s.` : `No music grid (no music, or your own file): only seconds place a beat. ${a.duration} s.`,
      ...(b.beats || []).filter((x) => x.at != null).map((x) => `  ${x.name}: "${x.at}" → ${Number.isFinite(x.t) ? `${Number(x.t).toFixed(3)} s` : 'not placed'}`),
      a.missed.length ? `Not placed: ${a.missed.map((m) => `"${m.at}"`).join(', ')}.` : null].filter(Boolean).join('\n');
  }

  /** The page's meta and text at these times (render-direct's meta mode). */
  async function metaAt(times) {
    const r = await livemotion.metaOf(dir, piece, { ...deps, at: times });
    if (!r || r.ok === false) throw new Error(String((r && r.problem) || 'the page didn\'t load').slice(0, 300));
    return r;
  }
  /** Times worth checking: the keyframes (else the beats, else evenly spread), at most 12. */
  const checkTimes = (meta, duration) => momentsOf(meta, beatsNow().beats, duration);

  async function lintScene() {
    if (!ready()) return notReady;
    const { textReport } = await livemotion.tool(engineRoot, 'lint.mjs');
    const problems = await livemotion.lintPiece(dir, piece, deps);
    const errors = problems.filter((p) => p.level === 'error');
    let a = null;
    try { a = await timed(); } catch (e) { return `beats.json: ${e.message}`; }
    let m;
    try { m = await metaAt(null); } catch (e) { return [`Lint: ${errors.length} error${errors.length === 1 ? '' : 's'}.`, ...problems.map((p) => `${p.level === 'error' ? '✗' : '!'} ${p.rule}${p.line ? ` (line ${p.line})` : ''}: ${p.message}`), `The page: ${e.message}`].join('\n'); }
    const times = checkTimes(m.meta, a.duration);
    try { m = await metaAt(times); } catch (e) { return `The page: ${e.message}`; }
    const strings = [...new Set((m.text || []).flatMap((x) => (x.text || []).map((d) => d.str)).filter(Boolean))];
    const flagged = textReport(strings);
    const unlisted = unlistedWords(dir, strings);
    const issues = (m.boxes || []).flatMap((x) => boxIssues(x.boxes, { duet: piece.kind === 'duet' }).map((i) => `${x.t.toFixed(2)} s: ${i}`));
    remember({ words: { flagged, unlisted, at: new Date().toISOString() }, checks: { lint: errors.length, text: issues.length } });
    return [
      errors.length ? `Lint: ${errors.length} error${errors.length === 1 ? '' : 's'}.` : 'Lint: pass.',
      ...problems.map((p) => `${p.level === 'error' ? '✗' : '!'} ${p.rule}${p.line ? ` (line ${p.line})` : ''}: ${p.message}`),
      (m.meta && m.meta.errors && m.meta.errors.length) ? `Page errors: ${m.meta.errors.slice(0, 5).join('; ')}` : null,
      flagged.length ? `On screen and not allowed (URLs, handles, emails, phone numbers): ${flagged.map((f) => `"${f.text}" (${f.flags.join(', ')})`).join('; ')}.` : 'No URLs, handles, emails or phone numbers on screen.',
      unlisted.length ? `Words on screen that aren't in the script or the deck (the user sees this list when approving): ${unlisted.join(', ')}.` : 'Every word on screen is in the script or the deck.',
      issues.length ? `Text: ${issues.slice(0, 12).join('; ')}` : `Text: no problems at ${times.length} moments.`,
    ].filter(Boolean).join('\n');
  }

  /** Stills of the piece at these times (render-direct's stills mode), into dest. → [png] */
  async function stillsAt(times, dest) {
    const rec = record();
    const styleDir = deps.styles.snapshotDir(dir, rec.style.id);
    const b = beatsNow();
    const { stage, done: clean } = livemotion.stageOf(dir, piece, { styleDir });
    let r;
    try {
      const opts = { scene: stage, mode: 'stills', out: dest, at: times, duration: Number(b.duration) || piece.seconds || 8, hold: livemotion.HOLD, styles: { [rec.style.id]: styleDir }, env: livemotion.toolEnv(deps.env) };
      if (ctx.stills) r = await ctx.stills(opts);
      else { const { renderDirect } = await livemotion.tool(engineRoot, 'render-direct.mjs'); r = await renderDirect(opts); }
    } finally { clean(); }
    if (!r || r.ok === false) throw new Error(String((r && r.problem) || 'no stills').slice(0, 300));
    return (r.files || []).filter(exists);
  }

  async function snapshot({ at: when } = {}) {
    if (!ready()) return notReady;
    const ts = timesOf(when, 8);
    if (!ts.length) return 'Give one or more times in seconds, e.g. [2.5, 9, 14.2].';
    try { await timed(); } catch (e) { return `beats.json: ${e.message}`; }
    const round = draftRound('stills');
    if (!round) return capped;
    const dest = at('snapshots', `round-${round.n}`);
    fs.rmSync(dest, { recursive: true, force: true });
    let pngs;
    try { pngs = await stillsAt(ts, dest); } catch (e) { return `No stills: ${e.message}`; }
    roundFiles(round.n, pngs);
    return [`Stills at ${ts.map((t) => t.toFixed(2)).join(', ')} s (open them with Read):`, ...pngs, rendersLeft()].join('\n');
  }

  async function renderPreview({ at: when } = {}) {
    if (!ready()) return notReady;
    let a;
    try { a = await timed(); } catch (e) { return `beats.json: ${e.message}`; }
    const round = draftRound('preview');
    if (!round) return capped;
    const ts = timesOf(when, 8);
    const check = at('check', `round-${round.n}`);
    fs.rmSync(check, { recursive: true, force: true });
    const t0 = Date.now();
    // a preview is for looking: draft quality, never the delivery's (the film's own renders are FLPT's, at delivery)
    const r = await animators.queued(() => livemotion.renderFolder(dir, piece, { out: at('renders', 'preview.mp4'), duration: a.duration, checkFrames: check, quality: 'draft', ...(ts.length ? { framesAt: ts } : {}) }, deps));
    if (!r || !r.ok) return `The render failed: ${livemotion.renderProblem(r)}\n${rendersLeft()}`;
    const frames = (r.check_frames || []).filter(exists);
    roundFiles(round.n, frames);
    if (r.hold_psnr_db != null) remember({ checks: { holdDb: r.hold_psnr_db === 'inf' ? 99 : r.hold_psnr_db } });
    return [`Rendered renders/preview.mp4 in ${Math.round((Date.now() - t0) / 1000)} s: ${r.duration} s, ${r.frames} frames${r.size_mb ? `, ${r.size_mb} MB` : ''}.`,
      r.hold_psnr_db != null ? `Hold: ${r.hold_psnr_db === 'inf' ? 'perfectly still' : `${r.hold_psnr_db} dB`} (45 dB or more passes).` : null,
      ...await pacingLines(at('renders', 'preview.mp4')),
      `Look at every frame (open them with Read):\n${frames.join('\n')}`, rendersLeft()].filter(Boolean).join('\n');
  }

  async function contactSheet() {
    if (!ready()) return notReady;
    let a;
    try { a = await timed(); } catch (e) { return `beats.json: ${e.message}`; }
    let m = null;
    try { m = await metaAt(null); } catch { m = null; }
    const times = checkTimes(m && m.meta, a.duration).slice(0, 12);
    const preview = at('renders', 'preview.mp4');
    const st = state();
    const last = st.rounds[st.rounds.length - 1];
    const fresh = exists(preview) && last && last.kind === 'preview' && last.sha === livemotion.filesSha(folder) && mtime(preview) >= mtime(at('beats.json'));
    let round;
    const dest = at('check', 'sheet');
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    const stills = [];
    if (fresh) {
      round = last;
      for (const [i, t] of times.entries()) {
        const png = path.join(dest, `still-${pad2(i + 1)}.png`);
        await ff(['-v', 'error', '-y', '-ss', t.toFixed(4), '-i', preview, '-frames:v', '1', png]);
        if (exists(png)) stills.push(png);
      }
    } else {
      round = draftRound('sheet');
      if (!round) return capped;
      try { stills.push(...await stillsAt(times, dest)); } catch (e) { return `No stills: ${e.message}`; }
    }
    if (!stills.length) return 'No frames to put on a sheet.';
    const sheet = at('check', `contact-${round.n}.png`);
    const cols = stills.length > 9 ? 4 : 3;
    const rows = Math.ceil(stills.length / cols);
    await ff(['-v', 'error', '-y', ...stills.flatMap((s) => ['-i', s]), '-filter_complex',
      `${stills.map((_, i) => `[${i}:v]scale=480:270[s${i}]`).join(';')};${stills.map((_, i) => `[s${i}]`).join('')}xstack=inputs=${stills.length}:layout=${stills.map((_, i) => `${(i % cols) * 480}_${Math.floor(i / cols) * 270}`).join('|')}:fill=black`, '-frames:v', '1', sheet]);
    if (!exists(sheet)) return 'The contact sheet didn\'t come out.';
    roundFiles(round.n, [sheet, ...stills]);
    let issues = [];
    try { const mm = await metaAt(times); issues = (mm.boxes || []).flatMap((x) => boxIssues(x.boxes, { duet: piece.kind === 'duet' }).map((i) => `${x.t.toFixed(2)} s: ${i}`)); } catch { /* the text check is lint_scene's too */ }
    return [`Contact sheet (open it with Read): ${sheet}`, `${stills.length} frames, left to right and down, at ${times.map((t) => t.toFixed(2)).join(', ')} s.`,
      issues.length ? `Text: ${issues.slice(0, 10).join('; ')}` : 'Text: no problems on these frames.',
      ...(fresh ? await pacingLines(preview) : ['Pacing: measured on a whole render (render_preview).']),
      'Say what is weak against the brief, the style and the banned defaults, fix it, render again.', rendersLeft()].join('\n');
  }

  async function compareWithReference({ ref } = {}) {
    const c = cardOf(ref);
    if (c.error) return c.error;
    const preview = at('renders', 'preview.mp4');
    if (!exists(preview)) return 'Render a preview first (render_preview).';
    const st = state();
    const r = st.rounds.slice().reverse().find((x) => x.kind === 'preview');
    const frames = r ? (r.files || []).map((f) => at(f)).filter(exists) : [];
    if (!frames.length) return 'Render a preview first (render_preview).';
    const measure = ctx.measureCard || references.measureCard;
    const ffprobe = livemotion.ffprobeOf(deps.env) || 'ffprobe';
    let mine;
    try { mine = await measure({ keyframes: frames, motion: preview, source: { kind: 'video' } }, { ffmpeg, ffprobe }); } catch (e) { return `Couldn't measure the preview: ${e.message}`; }
    const cmp = references.compareCards(c.card, mine);
    return [`Your preview against reference ${c.id}, as numbers (within tolerance: ${cmp.ok ? 'all' : `${cmp.rows.filter((x) => x.ok).length} of ${cmp.rows.length}`}):`,
      ...cmp.rows.map((x) => `  ${x.key}: ${x.delta} (tolerance ${x.tol})${x.ok ? '' : ' ✗'}`)].join('\n');
  }

  async function compareWithSlide() {
    if (piece.placement !== 'slide') return 'This piece has no slide picture of its own.';
    const preview = at('renders', 'preview.mp4');
    const picture = path.join(pres, 'slides', `slide_${pad2(piece.n)}.png`);
    if (!exists(preview)) return 'Render a preview first (render_preview).';
    if (!exists(picture)) return `The slide's picture (slides/slide_${pad2(piece.n)}.png) isn't rendered yet.`;
    const last = at('check', 'preview_last.png');
    fs.mkdirSync(at('check'), { recursive: true });
    await ff(['-v', 'error', '-y', '-sseof', '-0.2', '-i', preview, '-update', '1', last]);
    if (!exists(last)) return 'Couldn\'t read the preview\'s last frame. Render it again.';
    const p = await ff(['-v', 'info', '-i', last, '-i', picture, '-lavfi', animators.VS_PICTURE, '-f', 'null', '-']); // both lightly blurred first, as parity measures it
    const m = String(p.out).match(/average:(inf|[\d.]+)/);
    const db = m ? (m[1] === 'inf' ? 99 : r1(parseFloat(m[1]))) : null;
    const side = at('check', 'compare.png');
    await ff(['-v', 'error', '-y', '-i', picture, '-i', last, '-filter_complex', '[0:v]scale=960:540[a];[1:v]scale=960:540[b];[a][b]hstack=inputs=2', '-frames:v', '1', side]);
    if (db != null) remember({ checks: { lastDb: db } });
    const rec = record();
    const want = rec && rec.last === 'poster' ? 'Its plan ends on the poster: about 30 dB or more is the same picture.' : 'Its plan doesn\'t end on the poster, so this is for reference.';
    return [db == null ? 'Couldn\'t measure the difference.' : `Last frame against the slide's picture, both lightly blurred first so grain doesn't count: ${db === 99 ? 'identical' : `${db} dB PSNR`}. ${want}`,
      exists(side) ? `Side by side (left: the slide, right: your last frame): ${side}` : null].filter(Boolean).join('\n');
  }

  async function checkBubble() {
    if (!ready()) return notReady;
    if (piece.kind !== 'duet') return 'No presenter on this piece: its corner is free.';
    let a;
    try { a = await timed(); } catch (e) { return `beats.json: ${e.message}`; }
    let m;
    try { m = await metaAt(null); } catch (e) { return `The page: ${e.message}`; }
    const times = checkTimes(m.meta, a.duration).slice(0, 6);
    try { m = await metaAt(times); } catch (e) { return `The page: ${e.message}`; }
    const text = (m.boxes || []).flatMap((x) => boxIssues(x.boxes, { duet: true }).filter((i) => i.startsWith('in the presenter')).map((i) => `${x.t.toFixed(2)} s: ${i}`));
    const dest = at('check', 'bubble');
    fs.rmSync(dest, { recursive: true, force: true });
    let pngs = [];
    const preview = at('renders', 'preview.mp4');
    const st = state();
    const last = st.rounds[st.rounds.length - 1];
    if (exists(preview) && last && last.sha === livemotion.filesSha(folder)) {
      fs.mkdirSync(dest, { recursive: true });
      for (const [i, t] of times.entries()) { const png = path.join(dest, `t${i}.png`); await ff(['-v', 'error', '-y', '-ss', t.toFixed(4), '-i', preview, '-frames:v', '1', png]); if (exists(png)) pngs.push(png); }
    } else {
      const round = draftRound('stills');
      if (!round) return capped;
      try { pngs = await stillsAt(times, dest); } catch (e) { return `No stills: ${e.message}`; }
      roundFiles(round.n, pngs);
    }
    const dens = [];
    for (const png of pngs) {
      const gray = png.replace(/\.png$/i, '.gray');
      await ff(['-v', 'error', '-y', '-i', png, '-vf', 'scale=480:270:flags=area,format=gray', '-f', 'rawvideo', '-pix_fmt', 'gray', gray]);
      let buf = null;
      try { buf = fs.readFileSync(gray); } catch { buf = null; }
      if (buf && buf.length === 480 * 270) dens.push(edgeDensity(buf, 480, 270));
    }
    const worst = dens.reduce((w, d) => (!w || d.ratio > w.ratio ? d : w), null);
    const ok = !text.length && (!worst || worst.ok);
    remember({ checks: { bubble: ok, bubbleRatio: worst ? worst.ratio : null } });
    return [ok ? 'The presenter\'s corner is clear.' : 'The presenter\'s corner isn\'t clear.',
      text.length ? `Text there: ${text.join('; ')}` : 'No text there.',
      worst ? `Busiest moment there: ${worst.ratio}× the frame's median detail (1.5× at most).` : 'Couldn\'t measure the detail there.'].join('\n');
  }

  async function listen() {
    if (!ready()) return notReady;
    let a;
    try { a = await timed(); } catch (e) { return `beats.json: ${e.message}`; }
    const t = narrated ? await livemotion.timing(dir, piece, deps) : null;
    const sc = await livemotion.scorePass(dir, piece, { ...deps, voicePath: t && t.wav ? t.wav : null });
    const rec = sc.record;
    const b = beatsNow();
    const nearest = (at0) => (b.beats || []).filter((x) => Number.isFinite(x.t)).reduce((best, x) => (!best || Math.abs(x.t - at0) < Math.abs(best.t - at0) ? x : best), null);
    return [`Sound: music ${sc.sound.music}, effects ${sc.sound.sfx}.`,
      rec.grid ? `The music's grid: ${rec.grid.bpm} BPM, ${rec.grid.beatsPerBar} beats to a bar.` : null,
      rec.sfx.length ? `${rec.sfx.length} hit${rec.sfx.length === 1 ? '' : 's'}: ${rec.sfx.slice(0, 24).map((h) => { const n = nearest(h.at); return `${h.kind} ${h.at.toFixed(3)} s${n ? ` (${n.name} ${n.t >= h.at ? '−' : '+'}${Math.abs(h.at - n.t).toFixed(3)})` : ''}`; }).join(', ')}.` : 'No hits.',
      rec.stem ? `The stem: ${rec.stem.samples} samples (${a.frames} frames × 1600 = ${a.frames * 1600}), ${rec.stem.lufs} LUFS, true peak ${rec.stem.tpDb} dBTP.` : 'Nothing to play: no stem.',
      sc.problems.length ? `Problems: ${sc.problems.join('; ')}` : null,
      narrated ? 'The narration plays over it in the film; music sits under the voice.' : null].filter(Boolean).join('\n');
  }

  async function done({ fixed = [], report = '' } = {}) {
    if (!ready()) return notReady;
    const st = state();
    if (st.done && st.done.sha === livemotion.filesSha(folder)) return 'Already done. Finish with your report.';
    const n = passes();
    const said = (Array.isArray(fixed) ? fixed : []).map((x) => String(x).replace(/\s+/g, ' ').trim().slice(0, 300)).filter(Boolean);
    if (n < MIN_PASSES) return `Not yet: ${n} look-fix-render pass${n === 1 ? '' : 'es'} so far, and a piece needs ${MIN_PASSES}. Look at a contact sheet or stills (open them with Read), fix what's weak, render again.`;
    if (said.length < MIN_PASSES) return `Say what each pass fixed (fixed: one line per pass, ${n} pass${n === 1 ? '' : 'es'} so far).`;
    const last = st.rounds[st.rounds.length - 1];
    if (!last || last.sha !== livemotion.filesSha(folder)) return 'Your files changed after your last render: render again (render_preview or contact_sheet) and look first.';
    const { textReport } = await livemotion.tool(engineRoot, 'lint.mjs');
    const errors = (await livemotion.lintPiece(dir, piece, deps)).filter((p) => p.level === 'error');
    if (errors.length) return `Not yet: lint says ${errors.map((p) => `${p.rule}: ${p.message}`).slice(0, 4).join('; ')}.`;
    let a;
    try { a = await timed(); } catch (e) { return `beats.json: ${e.message}`; }
    if (narrated && a.missed.length) return `Not yet: the narration doesn't say ${a.missed.map((x) => `"${x.cue}"`).join(', ')}.`;
    let m;
    try { m = await metaAt(null); m = await metaAt(checkTimes(m.meta, a.duration)); } catch (e) { return `Not yet: the page: ${e.message}`; }
    const strings = [...new Set((m.text || []).flatMap((x) => (x.text || []).map((d) => d.str)).filter(Boolean))];
    const flagged = textReport(strings);
    if (flagged.length) return `Not yet: ${flagged.map((f) => `"${f.text}" (${f.flags.join(', ')})`).join('; ')} on screen. Labels only: no URLs, handles, emails or phone numbers.`;
    if (piece.kind === 'duet') {
      const corner = (m.boxes || []).flatMap((x) => boxIssues(x.boxes, { duet: true }).filter((i) => i.startsWith('in the presenter')));
      if (corner.length) return `Not yet: text in the presenter's corner (${corner.slice(0, 3).join('; ')}).`;
    }
    // a clean text check at the timing it renders (G1: text cut off at the filmed voice's timing)
    const text = (m.boxes || []).flatMap((x) => boxIssues(x.boxes).map((i) => `${x.t.toFixed(2)} s: ${i}`));
    if (text.length) return `Not yet: the text check says ${text.slice(0, 4).join('; ')}.`;
    const unlisted = unlistedWords(dir, strings);
    let delivery = null;
    if (!narrated) {
      if (st.renders.delivery >= livemotion.RENDERS.delivery) return `That was the last delivery render (${livemotion.RENDERS.delivery}). Finish with your report.`;
      st.renders.delivery += 1;
      save(st);
      const r = await animators.queued(() => livemotion.renderInterstitial(dir, piece, { ...deps, force: true, unfinished: true }));
      if (!r.ok) return `The delivery render failed: ${r.problems.slice(0, 2).join('; ')}. Fix it and call done again (${livemotion.RENDERS.delivery - st.renders.delivery} left).`;
      delivery = r;
    }
    const sha = livemotion.filesSha(folder);
    const doneAt = new Date().toISOString();
    remember({ ok: true, shaDone: sha, shaContent: livemotion.contentSha(folder), passes: said.slice(0, 12), words: { flagged, unlisted, at: doneAt }, keyframes: (m.meta && m.meta.keyframes) || [], doneAt });
    const now = state();
    now.done = { at: doneAt, sha, fixed: said.slice(0, 12), passes: n, report: String(report || '').slice(0, 2000) };
    save(now);
    try { fs.appendFileSync(at('notes.md'), ''); } catch { /* notes are the crew's */ }
    return [`Done: ${n} passes, ${state().renders.draft} draft renders${delivery ? `, and its clip (${delivery.seconds} s, ${delivery.audio === 'stem' ? 'with its stem' : 'silent'})` : ''}.`,
      unlisted.length ? `Shown at approval: ${unlisted.join(', ')}.` : null, 'Finish with your report: what the piece does, what each pass fixed, and the weakest shot.'].filter(Boolean).join('\n');
  }

  return { piece, folder, start, usePicture, useReference, usePreviousFrame, narrationTiming, alignBeats, alignMusic, lintScene, snapshot, renderPreview, contactSheet,
    compareWithReference, compareWithSlide, checkBubble, listen, done, saw, passes, state };
}

// ── the policy ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * What the crew may not read beyond refs/: every style snapshot in the episode that isn't FLPT's own as shipped (its
 * kit, its notes), that style's copy in the piece's own assets/, and every other copy of it a host page carries
 * (assets/styles/<id>/ in any piece's folder, a parked one's too). Absolute paths and patterns relative to
 * presentation/, for agents.policy and the CLI's own Read rules (which Glob and Grep keep to as well).
 */
function readDenyFor(dir, piece, styles) {
  const out = [];
  let snaps = [];
  try { snaps = styles.snapshots(dir); } catch { snaps = []; }
  for (const s of snaps) {
    let trust = 'untrusted';
    try { trust = styles.crewView(s.dir).trust; } catch { trust = 'untrusted'; }
    if (trust === 'shipped') continue;
    out.push(s.dir);
    if (piece) out.push(path.join(livemotion.folderOf(dir, piece), 'assets', 'styles', s.id));
    if (STYLE_ID.test(s.id)) out.push(`**/assets/styles/${s.id}`, `**/assets/styles/${s.id}/**`);
  }
  return [...new Set(out)];
}
const STYLE_ID = /^[a-z0-9][a-z0-9-]{0,47}$/; // styles' own ids (no glob characters)

/**
 * The scene crew's permission policy: writepolicy's scene stage (agents.policy: its folder's scene.js, beats.json,
 * notes.md and kit-ext.js only; reads in the episode and the method, never refs/ or `readDeny`), no Skill, no web;
 * `saw(path)` hears about every file it opens (the look in a look-fix-render pass).
 */
function policy({ presDir, engineRoot, folder, readDeny = [], saw = () => {} }) {
  const base = agents.policy({ presDir, engineRoot, web: false, stage: 'scene', folder, readDeny });
  return async (toolName, input, ...rest) => {
    if (toolName === 'Skill') return { behavior: 'deny', message: 'The scene crew has no skills: its brief and its style are its method.' };
    const r = await base(toolName, input, ...rest);
    if (r.behavior === 'allow' && toolName === 'Read' && input && typeof input.file_path === 'string') { try { saw(input.file_path); } catch { /* only a note */ } }
    return r;
  };
}

/**
 * The session's hooks: every Read that ran, heard as it happens (the look in a look-fix-render pass). The CLI lets a
 * Read inside its working folder through without asking canUseTool (qa/trust-boundary.mjs), so the policy's `saw`
 * never hears a crew open its own contact sheet; this PostToolUse hook does (G1's dry run found it, 2026-10-23).
 * A Read that was refused or failed never runs, so it isn't heard.
 */
function lookHooks(saw) {
  return {
    PostToolUse: [{ matcher: 'Read', hooks: [async (input) => {
      const p = input && input.tool_input && input.tool_input.file_path;
      if (typeof p === 'string') { try { saw(p); } catch { /* only a note */ } }
      return {};
    }] }],
  };
}

// ── the prompt ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The {{placeholders}} of engine/prompts/scene.md for one piece. */
function promptVars(dir, key, { title, engineRoot, styles = null, caps = null } = {}) {
  const piece = livemotion.pieceOf(dir, key);
  const narrated = livemotion.NARRATED.has(piece.kind);
  const st = styles || livemotion.stylesFor({ engineRoot });
  let s = null;
  try { s = livemotion.styleFor(dir, piece, { engineRoot, styles: st }); } catch { s = null; }
  const narration = narrated ? motion.narrations(dir)[piece.n] || '' : '';
  const beats = piece.plan.beats.length
    ? piece.plan.beats.map((b, i) => `  ${i + 1}. ${b.cue ? `on "${b.cue}"` : `at ${b.at}`}${b.fx ? ` · ${b.fx}` : ''}${b.picture ? ` · ${b.picture}` : ''}${b.sfx ? ` · sound ${typeof b.sfx === 'string' ? b.sfx : JSON.stringify(b.sfx)}` : ''}${b.hero ? ' · the hero beat' : ''}`).join('\n')
    : '  (none planned: find them in the narration)';
  let sound = { music: 'none', sfx: 'soft' };
  try { sound = livemotion.soundOf(piece, s && s.style, { engineRoot }); } catch { /* the defaults */ }
  const c = caps || piece.caps;
  const refs = piece.plan.refs;
  return {
    title, kind: KIND_NAME[piece.kind], key: piece.key, folder: piece.folder,
    where: piece.placement === 'slide' ? `slide ${piece.n} of the deck` : piece.afterN ? `between slides ${piece.afterN} and ${piece.afterN + 1}` : 'before the first slide (a cold open)',
    style: s ? `${(s.view && s.view.name) || s.id} (\`${s.id}\`)` : '`the episode\'s style`',
    style_trust: s && s.trust === 'shipped' ? `FLPT's own: its \`STYLE.md\` and \`kit.js\` are in \`${path.relative(path.join(dir, 'presentation'), s.dir)}/\`. Read both before you draw.`
      : 'the user\'s own: its code stays closed. `start_scene` gives you its tokens, its motion and its kit\'s functions; draw with those.',
    idea: piece.plan.idea || '(no idea line: take it from the narration)',
    beats,
    clock: narrated
      ? `The voice is the clock. The narration (lines in brackets are delivery tags, never on screen):\n\n${narration ? narration.split('\n').map((l) => `> ${l}`).join('\n') : '> (the script has no narration for this slide yet)'}`
      : `The music is the clock: ${piece.seconds} s, no narration. Beats ride the music with \`at\` ("bar 2", "beat 9", "bar 3 beat 2" or seconds); \`align_music\` places them.`,
    placement: piece.kind === 'duet' ? 'The presenter sits in the bottom-left corner (x 0–380, y 700–1080): no text there, and no busier there than the frame\'s median (`check_bubble`). Calmer than a Solo: the presenter carries the talk.'
      : piece.kind === 'solo' || piece.kind === 'cosmos' ? 'Full frame: the presenter\'s bubble is hidden, so the picture carries the talk.'
        : 'Full frame, between two slides: it has to land without a voice.',
    first: piece.plan.first, last: piece.plan.last,
    sound: `music ${sound.music}, effects ${sound.sfx}`,
    refs: refs.length ? `References: ${refs.join(', ')} (\`use_reference\` for its numbers, \`compare_with_reference\` against your preview).` : 'No reference.',
    // what the session may really spend: the broker's sessionCap of the reservation (the SDK stops it there)
    budget: broker.sessionCap(c.usd).toFixed(2), turns: String(c.turns), renders: String(livemotion.RENDERS.draft), deliveries: String(livemotion.RENDERS.delivery), passes: String(MIN_PASSES),
  };
}

// ── one crew's session ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Run one scene crew. Returns what agents.runSession returns ({ ok, costUsd, costKnown, turns, sessionId, report,
 * error }). `budgetUsd` is what was reserved for it (its piece's cap); the session runs at the broker's sessionCap of
 * that and the piece's turn cap. deps: { sdk, z, apiKey, toolEnvPath, configDir, executable, tools (makeTools for
 * this piece), styles, readDeny (optional: readDenyFor's) }.
 */
async function runScene({ key, projectDir, engineRoot, title, feedback = '', onEvent = () => {}, signal, model = 'opus', budgetUsd = null }, deps) {
  const { sdk, z, tools: t } = deps;
  const piece = livemotion.pieceOf(projectDir, key);
  const presDir = path.join(projectDir, 'presentation');
  const folder = livemotion.folderOf(projectDir, piece);
  const styles = deps.styles || livemotion.stylesFor({ engineRoot });
  const reservedUsd = budgetUsd == null ? piece.caps.usd : budgetUsd;
  const { prompt, house } = agents.stagePrompt({ stageId: 'scene', engineRoot, vars: promptVars(projectDir, key, { title, engineRoot, styles, caps: { usd: reservedUsd, turns: piece.caps.turns } }), feedback });
  const text = animators.toolText;
  const seconds = z.array(z.number());
  const defs = [
    sdk.tool('start_scene', `Set up your folder (${piece.folder}/) from the style's starter, with the plan's beats; fresh: true starts again (your last attempt is kept aside). Says how to read the style.`,
      { fresh: z.boolean().optional() }, (a) => text(() => t.start(a))),
    sdk.tool('use_picture', 'Copy a picture from this episode (a path inside presentation/, e.g. assets/calls/c1-photo.jpg or assets/library/…) into assets/pictures/: ctx.asset(name). Never a reference.',
      { path: z.string() }, (a) => text(() => t.usePicture(a))),
    sdk.tool('use_reference', 'A reference this piece may use, as numbers and words (palette, ground, light, motion, type, layout): match its feel, never copy it.',
      { ref: z.string().optional() }, (a) => text(() => t.useReference(a))),
    sdk.tool('use_previous_frame', 'The frame the piece before this one ends on, as assets/pictures/previous.png: for a first of "from-previous" or "crossfade".',
      {}, () => text(() => t.usePreviousFrame())),
    sdk.tool('narration_timing', 'The narration with every word\'s time in the piece\'s own seconds, and how long the piece is on screen: from the voice when there is one, else at the voices\' pace.',
      {}, () => text(() => t.narrationTiming())),
    sdk.tool('align_beats', 'Time every beat with a cue to its words (t on the first word\'s start, end on the last word\'s end), set the duration and the 0.5 s hold. Reports cues the narration doesn\'t say and beats in the hold.',
      {}, () => text(() => t.alignBeats())),
    sdk.tool('align_music', 'Place every beat with "at" ("bar 2", "beat 9", seconds) on the music\'s grid, and set the duration. For pieces without narration.',
      {}, () => text(() => t.alignMusic())),
    sdk.tool('lint_scene', 'The static check of scene.js and kit-ext.js, the page\'s errors, and the words on screen: URLs, handles, emails and phone numbers flagged; words not in the script or the deck listed; text cut off, overlapping or outside the safe area.',
      {}, () => text(() => t.lintScene())),
    sdk.tool('snapshot', 'Stills at these times (seconds), without a full render. Returns PNG paths to open with Read. Counts as a draft render.',
      { at: seconds }, (a) => text(() => t.snapshot(a))),
    sdk.tool('render_preview', 'Render the whole piece and check it (lint, frames, the hold): frames to open with Read (or at the times you give). Counts as a draft render.',
      { at: seconds.optional() }, (a) => text(() => t.renderPreview(a))),
    sdk.tool('contact_sheet', 'Your piece\'s keyframes on one sheet (from the latest preview, else freshly drawn), with the text check. Open it with Read: one sheet a round.',
      {}, () => text(() => t.contactSheet())),
    sdk.tool('compare_with_reference', 'Your latest preview measured against a reference: numbers only.',
      { ref: z.string().optional() }, (a) => text(() => t.compareWithReference(a))),
    sdk.tool('compare_with_slide', 'Your preview\'s last frame against the slide\'s picture (its poster): the PSNR (both lightly blurred first) and a side-by-side PNG.',
      {}, () => text(() => t.compareWithSlide())),
    sdk.tool('check_bubble', 'A Duet\'s presenter corner (x 0–380, y 700–1080): no text there, and its detail against the frame\'s median.',
      {}, () => text(() => t.checkBubble())),
    sdk.tool('listen', 'The piece\'s sound as FLPT mixes it: the music, every hit and its nearest beat, the stem\'s length and level. Numbers: you can\'t hear it.',
      {}, () => text(() => t.listen())),
    sdk.tool('done', `Mark the piece finished. Only after ${MIN_PASSES} or more look-fix-render passes (look at a sheet or stills, change the files, render again); fixed: one line per pass saying what it fixed.`,
      { fixed: z.array(z.string()), report: z.string().optional() }, (a) => text(() => t.done(a))),
  ];
  const readDeny = deps.readDeny || readDenyFor(projectDir, piece, styles);
  const cap = piece.caps;
  return animators.runCrew({
    presDir, engineRoot, prompt, house, defs, tools: TOOLS, disallowed: DISALLOWED,
    canUseTool: policy({ presDir, engineRoot, folder, readDeny, saw: (p) => t.saw && t.saw(p) }), readDeny,
    model, maxTurns: cap.turns, reservedUsd, signal, onEvent,
    // no plugin and no skills: the scene crew's method is its brief and its style; its Reads heard (lookHooks)
    patch: { plugins: [], skills: [], hooks: lookHooks((p) => t.saw && t.saw(p)) },
  }, deps);
}

/**
 * After a crew's session: did it finish its piece? A piece it marked done (and didn't change since) is kept as a take
 * and is ok. One it didn't finish is kept as a take too, but the piece goes back to its last finished take when it
 * has one. → { ok, error, note, take }
 */
function finish(dir, key, res = {}) {
  const piece = livemotion.pieceOf(dir, key);
  const folder = livemotion.folderOf(dir, piece);
  const said = res.error ? `${res.error} ` : '';
  const rec = livemotion.recordOf(dir, piece);
  if (!rec || rec.key !== piece.key) return { ok: false, error: `${said}The crew didn't set up the piece.`.trim(), take: null };
  const sha = livemotion.filesSha(folder);
  const ok = Boolean(rec.ok && rec.shaDone === sha);
  const before = livemotion.takesOf(dir, piece).filter((t) => t.ok);
  const take = livemotion.saveTake(dir, piece, { costUsd: res.costUsd == null ? null : r2(res.costUsd), ok, current: ok || !before.length });
  if (ok) {
    // its notes after done (the report's turn) are part of what it finished: the take as kept is what stays current
    livemotion.writeJson(path.join(folder, livemotion.SCENE), { ...livemotion.recordOf(dir, piece), shaContent: livemotion.contentSha(folder) });
    return { ok: true, error: null, note: res.ok ? null : `The crew stopped early (${res.error}), after marking it done.`, take };
  }
  livemotion.writeJson(path.join(folder, livemotion.SCENE), { ...livemotion.recordOf(dir, piece), ok: false });
  if (before.length) {
    livemotion.useTake(dir, piece, before[before.length - 1].n);
    return { ok: false, error: `${said}The new attempt wasn't finished, so the piece keeps its last take.`.trim(), take };
  }
  return { ok: false, error: `${said}The piece wasn't finished.`.trim(), take };
}

// ── a Live Motion run: the crews for the pieces that need one ─────────────────────────────────────────────────────

const busy = new Set(); // episode folders with crews at work (the flow asks before starting anything else)
/** Are scene crews at work on this episode? */
const isBusy = (dir) => busy.has(path.resolve(dir));

/** The pieces a run makes: those named, else every piece not finished (or changed since) that isn't the user's own. */
function toMake(dir, keys = null) {
  const v = new Map(livemotion.view(dir).map((x) => [x.key, x]));
  return livemotion.pieces(dir).filter((p) => {
    if (livemotion.isTheirs(dir, p)) return false;
    if (keys) return keys.includes(p.key);
    const s = (v.get(p.key) || {}).status;
    return s !== 'ok';
  });
}

/**
 * Run the scene crews for an episode's Live Motion pieces (all that need one, or `keys`): every piece's cap reserved
 * on the episode's Claude planning budget before any crew starts (deps.reserve: the one dialog, if any, comes first;
 * T9), then the crews in the shared pool, each settled against what it really cost, each piece finished (finish) and
 * recorded in the episode's `live`. A piece that couldn't be reserved stays to do. The stage (Live Motion, id
 * "animate") runs while they do (`crew: 'scene'` on its record) and ends in review when a piece was made. Whatever
 * goes wrong after the reservation, no cap stays booked for a crew that never started: each settles at 0, and the
 * stage ends as an error, never stuck "running". A run FLPT quit in the middle of may start again.
 * deps: { sdk, z, apiKey, toolEnvPath, configDir, executable, engineRoot, broker, styles, reserve(dir, [{ usd, what }])
 *         → { token, pieces } | null, toolsFor(dir, key, signal) → makeTools, send(channel, payload), redact(text) }
 * → { ok, cancelled?, error?, costUsd, pieces: [{ key, ok, costUsd, error }] }
 */
async function runPieces(dir, { keys = null, feedback = '', title = '', model = 'opus', signal } = {}, deps) {
  const d = path.resolve(dir);
  if (busy.has(d)) throw new Error('The scene crews are already at work on this episode.');
  const st = episode().read(d);
  if (!episode().canRun(st, 'animate')) throw new Error('Approve the script first.');
  // the animators at work here (their sessions in this process), or the stage running for them; a run of scene crews
  // that isn't at work in this process was cut short (FLPT quit) and may start again
  const a = st.stages.animate || {};
  if (animators.crewsAt(d) > 0 || (a.status === 'running' && a.crew !== 'scene')) throw new Error('Something is already running for this episode.');
  const list = toMake(d, keys);
  if (!list.length) throw new Error(keys ? 'That piece is the user\'s own, or isn\'t in the deck.' : 'Every Live Motion piece is made.');
  const what = (p) => `${title || st.title}: Live Motion ${p.shot || p.id}`;
  const redact = deps.redact || ((x) => x);
  const send = deps.send || (() => {});
  const said = (e) => redact(String(e && e.message ? e.message : e)).slice(0, 400);
  busy.add(d);
  let held = null;
  const jobs = []; // { p, usd, settled }: a cap settles once, when its crew's cost is known (or at 0 if it never ran)
  const settle = (j, actualUsd) => {
    if (j.settled) return;
    j.settled = true;
    try { deps.broker.settle(held.token, { authorizedUsd: j.usd, actualUsd, what: what(j.p) }); } catch { /* the ledger says why */ }
  };
  try {
    // every crew's cap at once, before any starts: a question about money comes first, in one dialog
    held = await deps.reserve(d, list.map((p) => ({ usd: p.caps.usd, what: what(p) })));
    if (!held || !held.pieces || !held.pieces.length) return { ok: false, cancelled: true, costUsd: 0, pieces: [] };
    jobs.push(...list.slice(0, held.pieces.length).map((p, i) => ({ p, usd: held.pieces[i].usd, settled: false })));
    for (const p of list.slice(held.pieces.length)) livemotion.noteLive(d, p, { status: 'todo', error: 'The Claude budget didn\'t cover this piece.' });
    const ctrl = new AbortController();
    if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true });
    running.set(d, ctrl);
    episode().setStage(d, 'animate', { status: 'running', error: null, crew: 'scene' });
    for (const j of jobs) livemotion.noteLive(d, j.p, { status: 'running', error: null });
    send('livemotion:changed', { dir: d });
    const results = await Promise.all(jobs.map(async (j) => {
      const { p, usd } = j;
      const emit = (ev) => send('agent:event', { dir: d, stage: 'animate', piece: p.key, ...ev, text: ev.text ? redact(ev.text) : ev.text, detail: ev.detail ? redact(ev.detail) : ev.detail });
      let res;
      try {
        const tools = deps.toolsFor(d, p.key, ctrl.signal);
        res = await runScene({ key: p.key, projectDir: d, engineRoot: deps.engineRoot, title: title || st.title, feedback, onEvent: emit, signal: ctrl.signal, model, budgetUsd: usd },
          { ...deps, tools, styles: deps.styles });
      } catch (e) {
        // runScene throws only while it sets up (its tools, its prompt): agents.runSession answers every failure of a
        // session that started, so nothing was spent
        res = { ok: false, costUsd: 0, costKnown: true, turns: 0, error: said(e) };
      }
      try {
        try { deps.broker.record(held.token, { what: what(p), costUsd: res.costUsd, turns: res.turns, ok: res.ok }); } catch { /* the ledger says why */ }
        // the whole cap was reserved; once the real cost is known, the rest goes back to the planning budget (an
        // unknown one keeps the whole cap booked)
        if (res.costKnown) settle(j, res.costUsd);
        else j.settled = true;
        try { episode().addCost(d, { provider: 'anthropic', stage: 'animate', piece: p.key, usd: res.costUsd, estimate: true }); } catch { /* a record made by a newer FLPT */ }
        let done;
        try { done = finish(d, p.key, res); } catch (e) { done = { ok: false, error: String(e && e.message ? e.message : e), take: null }; }
        const prev = (episode().read(d).live || {})[livemotion.liveId(p)] || {};
        const rec = livemotion.recordOf(d, p);
        livemotion.noteLive(d, p, { status: done.ok ? 'ok' : 'failed', error: done.error ? redact(String(done.error)).slice(0, 400) : null, note: done.note || null,
          costUsd: r2((Number(prev.costUsd) || 0) + (Number(res.costUsd) || 0)), takes: livemotion.takesOf(d, p).map(({ n, at, costUsd, ok, preview }) => ({ n, at, costUsd, ok, preview })),
          current: rec && rec.take ? rec.take : null, sessionId: res.sessionId || null, report: res.report ? redact(res.report).slice(0, 8000) : null, approved: false });
        send('livemotion:changed', { dir: d, key: p.key });
        return { key: p.key, ok: done.ok, costUsd: res.costUsd || 0, error: done.error || null };
      } catch (e) {
        try { livemotion.noteLive(d, p, { status: 'failed', error: said(e) }); } catch { /* as it was */ }
        return { key: p.key, ok: false, costUsd: res.costUsd || 0, error: said(e) };
      }
    }));
    const costUsd = r2(results.reduce((x, r) => x + (r.costUsd || 0), 0));
    const made = results.some((r) => r.ok);
    const error = made ? null : ctrl.signal.aborted ? 'Stopped.' : 'No Live Motion piece was made.';
    episode().setStage(d, 'animate', { status: made ? 'review' : 'error', error, costUsd, crew: null });
    return { ok: made, error, costUsd, pieces: results };
  } catch (e) {
    if (!held || !held.pieces) throw e; // nothing was reserved: as it was
    const error = said(e);
    for (const j of jobs.filter((x) => !x.settled)) {
      settle(j, 0);
      try { livemotion.noteLive(d, j.p, { status: 'failed', error }); } catch { /* as it was */ }
    }
    try { episode().setStage(d, 'animate', { status: 'error', error, crew: null }); } catch { /* a record made by a newer FLPT */ }
    return { ok: false, error, costUsd: 0, pieces: [] };
  } finally {
    running.delete(d);
    busy.delete(d);
  }
}
const running = new Map(); // dir → AbortController
/** Stop an episode's scene crews (each settles at what it really cost). → true when some were running */
function cancel(dir) { const c = running.get(path.resolve(dir)); if (c) c.abort(); return Boolean(c); }
const episode = () => require('./episode');

module.exports = { makeTools, policy, lookHooks, readDenyFor, promptVars, runScene, finish, runPieces, cancel, isBusy, toMake, boxIssues, unlistedWords, knownWords, edgeDensity, wordsIn, checkPiece, pacingOf, momentsOf, showcaseStills,
  TOOLS, DISALLOWED, TOOL_NAMES, MIN_PASSES, KEEP_OUT };
