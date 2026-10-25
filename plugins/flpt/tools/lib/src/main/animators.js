'use strict';
// The animator crew: bespoke animations, on top of the motion engine.
//
// The engine (motion.js) animates a slide's own elements from the deck's structured builds. The method's richer
// animations (a whiteboard sketch with doodles from the kit, possible-worlds diagrams, cartoon-like scenes made from
// shapes) need an animator writing a HyperFrames composition of its own. The deck crew marks those slides in
// modules.json ("animate": a short brief). Once the script is approved, one Agent SDK session per marked slide (a few
// at a time) writes presentation/hyperframes/slide_NN/ to the method's brief: the last frame is the approved slide,
// its identity is there from frame 0, every beat has a cue, one motion language, the bubble corner stays empty, and
// every asset is local.
//
// An animator has no shell and no web. It sets up, times, renders and checks its slide with the in-process tools
// below, which run the method's own scripts (render.mjs, align-beats.mjs, real-words.py), HyperFrames and ffmpeg
// inside macOS's sandbox (sandbox.js): no network, and writes only in its slide folder. Its folder carries
// flpt-animator.json, never the engine's marker, so the engine renders it as a bespoke slide and times it to the voice
// like its own: the Mac's in the free draft, the real one after filming. Claude is paid: every session draws on the
// episode's approved planning budget, capped at PER_SLIDE_USD, and runs at the broker's sessionCap of it (T21).
//
// The crew runner (runCrew) is shared with the Live Motion scene crew (scenecrew.js): one session with its own
// in-process `flpt` tools, the crew's session options (agents.sessionOptions: no shell, the CLI's own deny rules, the
// key-free environment), at sessionCap of its reservation, through one pool of PARALLEL sessions that animators and
// scene crews share: however many each caller starts, no more than PARALLEL run at once.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const agents = require('./agents');
const motion = require('./motion');
const sandbox = require('./sandbox');
const broker = require('./broker');
const { version } = require('../../package.json');

const MARK = 'flpt-animator.json'; // in every folder the crew makes (the engine's own is motion.MARKER)
const PER_SLIDE_USD = 4;
const MAX_TURNS = 60;
const PARALLEL = 3; // sessions at a time (each is a 1 GB process); their renders take turns
const HOLD = 1.5;
// a last frame against its slide's picture: both through the same light blur first (σ 1.5 px), as parity measures the
// hold on every platform (parity/thresholds.json → hold.blur; the lead's ruling 3: the paper's grain through the encode)
const HOLD_BLUR = 1.5;
const VS_PICTURE = `[0:v]format=rgb24,gblur=sigma=${HOLD_BLUR}[a];[1:v]format=rgb24,scale=1920:1080,gblur=sigma=${HOLD_BLUR}[b];[a][b]psnr`;
const STARTERS = ['deck', 'whiteboard-sketch', 'possible-worlds', 'live-slide'];
const TOOLS = ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'MultiEdit', 'Skill', 'TodoWrite']; // the crew's, without the web
const PICTURE = /\.(png|jpe?g|gif|webp|svg)$/i;

const exists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const mtime = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
const readJson = (p, fallback = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } };
const pad2 = (n) => String(n).padStart(2, '0');
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const tail = (text, n = 30) => String(text || '').trim().split('\n').filter(Boolean).slice(-n).join('\n');

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

// ── which slides, and whose folders ─────────────────────────────────────────────────────────────────────────────

/** The slides the deck marks for an animation of their own, in deck order: [{ n, id, module, brief }]. */
function marked(dir) {
  const { order, modules } = motion.readDeck(dir);
  const entries = (modules && modules.slides) || {};
  return order.map((id, i) => ({ n: i + 1, id, e: entries[id] }))
    .filter(({ e }) => e && typeof e.animate === 'string' && e.animate.trim())
    .map(({ n, id, e }) => ({ n, id, module: e.module || null, brief: e.animate.trim().slice(0, 1500) }));
}

/** The approved design of a slide, hashed: an animation made from another version of it is out of date. */
const slideSha = (dir, id) => motion.sha(path.join(dir, 'presentation', 'deck', 'project', 'slides', `${id}.html`));

/** Who owns slide n's folder: 'crew' (an animator's), 'engine' (the motion engine's), 'user' (theirs), or null. */
function owner(dir, n) {
  const f = motion.hfDir(dir, n);
  if (!isDir(f)) return null;
  if (exists(path.join(f, MARK))) return 'crew';
  if (exists(path.join(f, motion.MARKER))) return 'engine';
  return fs.readdirSync(f).length ? 'user' : null;
}

/** The crew's folders: [{ n, folder, mark }]. */
function crewFolders(dir) {
  const root = path.join(dir, 'presentation', 'hyperframes');
  let names = [];
  try { names = fs.readdirSync(root); } catch { return []; }
  return names.map((d) => d.match(/^slide_(\d{2})$/)).filter(Boolean)
    .map((m) => ({ n: Number(m[1]), folder: path.join(root, m[0]), mark: readJson(path.join(root, m[0], MARK), null) }))
    .filter((f) => f.mark && typeof f.mark.slide === 'string');
}

/** A clip FLPT rendered from a folder (its hash is in the folder's marker) goes when the folder does. */
function dropClip(dir, n, mark) {
  const clip = motion.clipPath(dir, n);
  if (mark && mark.clip && exists(clip) && motion.sha(clip) === mark.clip) fs.rmSync(clip, { force: true });
}

/** Set a folder aside in hyperframes/parked/, where nothing renders it. */
function park(dir, folder, id) {
  const root = path.join(dir, 'presentation', 'hyperframes', 'parked');
  fs.mkdirSync(root, { recursive: true });
  const base = path.join(root, `${String(id).replace(/[^\w-]+/g, '-').slice(0, 60)}-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '')}`);
  let dest = base;
  for (let i = 2; fs.existsSync(dest); i++) dest = `${base}-${i}`;
  fs.renameSync(folder, dest);
  return dest;
}

/**
 * Keep the crew's animations on their slides when the deck changes: a finished animation whose slide moved goes with
 * it (into a free place, or over one of the engine's folders, which the engine remakes anyway); one whose slide is
 * gone or no longer marked, or one an animator never finished, is set aside in hyperframes/parked/. The user's own
 * folders are never touched. Returns lines for the log.
 */
function sync(dir) {
  const root = path.join(dir, 'presentation', 'hyperframes');
  const want = new Map(marked(dir).map((s) => [s.id, s.n]));
  const seen = new Set();
  const moving = [];
  // a slide's newest finished animation wins
  const order = (f) => `${f.mark.ok ? 1 : 0}${String(f.mark.at || '')}`;
  for (const f of crewFolders(dir).sort((a, b) => order(b).localeCompare(order(a)))) {
    const to = f.mark.ok && !seen.has(f.mark.slide) ? want.get(f.mark.slide) || null : null;
    seen.add(f.mark.slide);
    if (to === f.n) continue;
    moving.push({ ...f, to });
  }
  const notes = [];
  for (const m of moving) {
    dropClip(dir, m.n, m.mark);
    m.tmp = path.join(root, `.moving-${m.n}-${process.pid}`);
    fs.renameSync(m.folder, m.tmp);
  }
  for (const m of moving) {
    if (m.to && owner(dir, m.to) === 'engine') {
      dropClip(dir, m.to, readJson(path.join(motion.hfDir(dir, m.to), motion.MARKER), {}));
      fs.rmSync(motion.hfDir(dir, m.to), { recursive: true, force: true });
    }
    if (m.to && !fs.existsSync(motion.hfDir(dir, m.to))) {
      fs.renameSync(m.tmp, motion.hfDir(dir, m.to));
      notes.push(`Slide ${m.to}'s animation moved with it (it was slide ${m.n}).`);
      continue;
    }
    park(dir, m.tmp, m.mark.slide);
    notes.push(m.to ? `Slide ${m.to} has an animation of yours, so the crew's for "${m.mark.slide}" was set aside.`
      : m.mark.ok ? `The animation for "${m.mark.slide}" was set aside: that slide isn't marked for one any more.`
        : `An unfinished animation for "${m.mark.slide}" was set aside.`);
  }
  return notes;
}

/**
 * The deck's asset map, keeping only pictures that are files inside this episode (an attachment, a Library copy): a
 * starter never brings a file in from elsewhere on the Mac, whatever the map says.
 */
function episodePictures(deck) {
  const real = (p) => { try { return fs.realpathSync(p); } catch { return null; } };
  const root = real(deck.pres);
  const out = {};
  for (const [k, v] of Object.entries(deck.assetMap || {})) {
    const src = [path.resolve(deck.pres, 'deck', String(v)), path.resolve(deck.project, String(v)), path.resolve(deck.pres, String(v))].find(exists);
    const r = src && real(src);
    if (root && r && r.startsWith(root + path.sep) && PICTURE.test(r)) out[k] = v;
  }
  return out;
}

/** After the engine renders: the hashes of the crew's clips, so they're known as FLPT's own (see dropClip). */
function noteClips(dir, numbers) {
  for (const n of numbers || []) {
    const file = path.join(motion.hfDir(dir, n), MARK);
    const mark = readJson(file, null);
    if (mark) writeJson(file, { ...mark, clip: motion.sha(motion.clipPath(dir, n)) });
  }
}

/**
 * What the Animate step shows, slide by slide: the brief, the animation (if any, wherever it sits), whether it's out of
 * date (the slide's design changed since), its preview and checks, and the last run's record (`records`, by slide id).
 */
function view(dir, records = {}) {
  const crew = crewFolders(dir);
  return marked(dir).map((s) => {
    const f = crew.filter((c) => c.mark.slide === s.id && c.mark.ok).sort((a, b) => (a.n === s.n ? -1 : b.n === s.n ? 1 : 0))[0];
    const preview = f ? path.join(f.folder, 'renders', 'preview.mp4') : null;
    const picture = path.join(dir, 'presentation', 'slides', `slide_${pad2(s.n)}.png`);
    const rec = records[s.id] || {};
    return {
      n: s.n, id: s.id, module: s.module, brief: s.brief,
      made: Boolean(f), theirs: owner(dir, s.n) === 'user',
      outdated: Boolean(f && f.mark.slideSha && f.mark.slideSha !== slideSha(dir, s.id)),
      preview: preview && exists(preview) ? preview : null, previewAt: preview ? Math.round(mtime(preview)) || null : null,
      picture: exists(picture) ? picture : null,
      check: f ? f.mark.check || null : null,
      status: rec.status || null, error: rec.error || null, note: rec.note || null, costUsd: rec.costUsd == null ? null : rec.costUsd, report: rec.report || null,
    };
  });
}

/** What check_deck says about the marks: too many, or not a short brief. */
function checkMarks(dir) {
  const { order, modules } = motion.readDeck(dir);
  const out = [];
  for (const [id, e] of Object.entries((modules && modules.slides) || {})) {
    if (!e || e.animate == null || !order.includes(id)) continue;
    if (typeof e.animate !== 'string') out.push(`${id}: "animate" is a short brief for the animator crew, in words.`);
    else if (e.animate.length > 1200) out.push(`${id}: the "animate" brief is long. Keep it to a few lines: what draws or moves, in order, on which words.`);
  }
  const n = marked(dir).length;
  if (n > 4) out.push(`${n} slides are marked for the animator crew. Each one is its own Claude run (up to ${PER_SLIDE_USD} US dollars): keep it to the ones builds can't do.`);
  for (const s of marked(dir)) {
    const e = ((modules && modules.slides) || {})[s.id] || {};
    if (e.inset) out.push(`${s.id}: a slide with a video inset can't also be animated (its clip wouldn't play). Drop one of the two.`);
  }
  return out;
}

// ── timing ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Slide n's lead-in before its voice: 0.5 s on the first slide and after a cut scene (as retime.py), else 0. */
function leadOf(dir, n) {
  const tl = motion.timelineOf(dir, 'final') || motion.timelineOf(dir, 'draft');
  if (tl && Array.isArray(tl.slides) && tl.slides.length) {
    const first = Math.min(...tl.slides.map((x) => x.n));
    return n === first || (tl.cutscenes || []).some((c) => c.after_slide === n - 1) ? 0.5 : 0;
  }
  let script = '';
  try { script = fs.readFileSync(path.join(dir, 'presentation', 'script.md'), 'utf8'); } catch { /* none */ }
  const heads = [...script.matchAll(/^##\s+(?:SLIDE\s+(\d+)|(CUTSCENE))\b/gim)];
  const i = heads.findIndex((h) => Number(h[1]) === n);
  return n === 1 || (i > 0 && heads[i - 1][2]) ? 0.5 : 0;
}

/** The voice slide n has so far: the real one after filming, else the free draft's; null before either. */
function voiceOf(dir, n) {
  for (const which of ['final', 'draft']) {
    const tl = motion.timelineOf(dir, which);
    const slot = tl && (tl.slides || []).find((x) => x.n === n);
    const wav = slot && motion.narrationWav(dir, n, which);
    if (wav) return { which, wav, slot };
  }
  return null;
}

/** Word times at the voices' measured pace, from the voice's start: { words: [{ text, start, end }], seconds }. */
function estimatedWords(narration) {
  const words = [];
  let t = 0;
  for (const tok of String(narration).match(/\[[^\]]*\]|\S+/g) || []) {
    if (tok.startsWith('[')) { t += /short pause/i.test(tok) ? 0.3 : /pause/i.test(tok) ? 0.6 : /breath/i.test(tok) ? 0.25 : 0; continue; }
    const d = (tok.length + 1) / motion.RATE;
    words.push({ text: tok, start: round(t), end: round(t + d) });
    t += d;
  }
  return { words, seconds: t };
}

/** The slide's time on screen before there's a voice: the lead-in, the words at the voices' pace, the pipeline's tail. */
const estimatedDuration = (narration, lead) => round(Math.max(3, Math.ceil((lead + estimatedWords(narration).seconds + 0.6) * motion.FPS) / motion.FPS), 3);

// ── the tools ───────────────────────────────────────────────────────────────────────────────────────────────────

// Renders and snapshots take turns, across every animator: each already uses all the cores.
let renders = Promise.resolve();
function queued(fn) {
  const p = renders.then(fn, fn);
  renders = p.then(() => {}, () => {});
  return p;
}

/**
 * How the tools run a program: in the slide folder, with `env` (no keys), its output collected, stopped after
 * `timeoutMs`. `sandboxed` (the app): inside sandbox.js's profile, writing only in the folders the call names and
 * `writable`, reading nothing in `hidden` (beyond sandbox.js's own list). Resolves { code, out }.
 */
function createExec({ env, writable = [], hidden = [], sandboxed = true }) {
  return (cmd, args, { cwd, writable: w = [], timeoutMs = 10 * 60000, signal } = {}) => new Promise((resolve) => {
    if (signal && signal.aborted) { resolve({ code: 130, out: 'Stopped.' }); return; }
    let prog = cmd;
    let argv = args;
    let vars = env;
    if (sandboxed) {
      try { [prog, argv] = sandbox.wrap(cmd, args, { writable: [...w, ...writable], hidden: [...sandbox.hiddenDirs(), ...hidden] }); } catch (e) { resolve({ code: 126, out: `Not run: ${e.message}.` }); return; }
      vars = { ...env, TMPDIR: sandbox.tmpdir() }; // the temp folder the sandbox leaves open (/tmp isn't)
    }
    const lines = [];
    const take = (buf) => { for (const l of String(buf).split(/\r?\n/)) if (l.trim()) { lines.push(l); if (lines.length > 400) lines.shift(); } };
    let child;
    try { child = spawn(prog, argv, { cwd, env: vars, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { resolve({ code: 127, out: e.message }); return; }
    const kill = () => { try { child.kill('SIGTERM'); } catch { /* gone */ } };
    const timer = setTimeout(() => { lines.push(`(stopped after ${Math.round(timeoutMs / 1000)} s)`); kill(); }, timeoutMs);
    if (signal) signal.addEventListener('abort', kill, { once: true });
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: 127, out: e.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code == null ? 1 : code, out: lines.join('\n') }); });
  });
}

/**
 * One animator's tools, for slide `slide` ({ n, id, … }) of the episode in `dir`. Each returns plain text for the model.
 * ctx: { exec (createExec), node, python (the episode's), hyperframes (its CLI's path, run with node; or a command
 *        line such as ['npx', '-y', 'hyperframes@0.8.80']: for snapshots), ffmpeg, probe (ffprobe's JSON),
 *        fontCacheDir, fetchImpl (the deck's Google fonts, as the engine fetches them), signal }
 */
function makeTools(dir, slide, engineRoot, ctx) {
  const pres = path.join(dir, 'presentation');
  const folder = motion.hfDir(dir, slide.n);
  const nn = pad2(slide.n);
  const T = motion.templateDir(engineRoot);
  const picture = path.join(pres, 'slides', `slide_${nn}.png`);
  const preview = path.join(folder, 'renders', 'preview.mp4');
  const at = (...p) => path.join(folder, ...p);
  const run = (cmd, args, o = {}) => ctx.exec(cmd, args, { cwd: folder, writable: [folder], signal: ctx.signal, ...o });
  const ready = () => exists(at('index.html')) && exists(at('beats.json'));
  const notReady = 'Set up your folder first with start_slide.';
  const markFile = at(MARK);
  const remember = (patch) => { const m = readJson(markFile, null); if (m) writeJson(markFile, { ...m, ...patch, check: { ...(m.check || {}), ...(patch.check || {}) } }); };
  const times = (list) => (Array.isArray(list) ? list : []).map(Number).filter((t) => Number.isFinite(t) && t >= 0 && t <= 600).slice(0, 8);

  /** The slide folder, from a starter. */
  async function start({ from = 'deck', fresh = false } = {}) {
    if (!STARTERS.includes(from)) return `"from" is one of: ${STARTERS.join(', ')}.`;
    const who = owner(dir, slide.n);
    if (who === 'user') return `hyperframes/slide_${nn} is an animation of the user's own: it stays as it is. Stop here and say so in your report.`;
    if (who === 'crew' && ready() && !fresh) return 'Your folder already has a slide: edit its index.html and beats.json, or start again with fresh: true.';
    let section = null;
    if (from === 'deck') {
      let raw = '';
      try { raw = fs.readFileSync(path.join(pres, 'deck', 'project', 'slides', `${slide.id}.html`), 'utf8'); } catch { /* below */ }
      section = raw && motion.extractSection(raw);
      if (!section) return `deck/project/slides/${slide.id}.html has no <section>: start from another starter.`;
    }
    // What was there gives way: the engine's folder (and its clip), or the crew's last attempt. A finished animation is
    // set aside instead, so the slide gets it back if the new one never renders (see finish).
    const old = readJson(at(who === 'engine' ? motion.MARKER : MARK), {}) || {};
    let previous = null;
    if (who === 'crew' && old.ok) previous = path.relative(path.join(pres, 'hyperframes'), park(dir, folder, slide.id));
    else {
      dropClip(dir, slide.n, old);
      fs.rmSync(folder, { recursive: true, force: true });
    }
    fs.mkdirSync(at('assets', 'fonts'), { recursive: true });
    // the marker first: a folder without it would be the user's own
    writeJson(markFile, { made: 'Fatty Lumpkin Presentation Tool: the animator crew', slide: slide.id, from, slideSha: slideSha(dir, slide.id), at: new Date().toISOString(), ok: false, previous });
    // engine 1.1 (the pen, four-way wipes, upward grow) for every starter, FLPT's tween engine (in place of GSAP),
    // hand.js, and the method's local fonts
    const wb = path.join(T, 'examples', 'whiteboard-sketch');
    for (const f of ['live-slide.js', 'hand.js']) fs.copyFileSync(path.join(wb, 'assets', f), at('assets', f));
    fs.copyFileSync(motion.tweenFile(engineRoot), at('assets', 'flpt-tween.js'));
    for (const d of [path.join(T, 'live-slide', 'assets', 'fonts'), path.join(wb, 'assets', 'fonts')]) {
      for (const f of fs.readdirSync(d)) fs.copyFileSync(path.join(d, f), at('assets', 'fonts', f));
    }
    const narration = motion.narrations(dir)[slide.n] || '';
    const lead = leadOf(dir, slide.n);
    const duration = estimatedDuration(narration, lead);
    const notes = [];
    let html;
    let beats = [];
    if (from === 'deck') {
      const deck = motion.readDeck(dir);
      const fonts = (await motion.localFonts(deck.faces, ctx.fontCacheDir, ctx.fetchImpl)) || motion.vendoredFonts(engineRoot);
      for (const f of fonts.files) fs.copyFileSync(f.path, at('assets', 'fonts', f.name));
      const problems = [];
      const body = motion.sanitizeFonts(motion.localBlobs(section, { ...deck, assetMap: episodePictures(deck) }, folder, problems, slide.id), fonts.families);
      notes.push(...problems);
      html = motion.page(body, fonts.css, duration, { hand: true, comment: `The animator crew's composition of slide ${slide.n} ("${slide.id}"), started from the approved deck slide.` });
      const builds = (((deck.modules || {}).slides || {})[slide.id] || {}).builds || [];
      beats = motion.provisional(builds.map(motion.beatFrom).filter(Boolean), narration, { offset: lead }).beats;
    } else {
      html = fs.readFileSync(path.join(from === 'live-slide' ? path.join(T, 'live-slide') : path.join(T, 'examples', from), 'index.html'), 'utf8');
    }
    fs.writeFileSync(at('index.html'), html);
    const bj = { slide: slide.id, duration, fps: motion.FPS, hold: HOLD, lead: motion.LEAD, tokens: {}, guides: false, narration, beats };
    writeJson(at('beats.json'), bj);
    fs.writeFileSync(at('beats.js'), `window.__SLIDE__ = ${JSON.stringify(bj)};\n`);
    const kit = from === 'whiteboard-sketch' ? `\nIts SCENE is the doodle kit sheet: keep the doodles you need, delete the rest. How: ${path.join(wb, 'README.md')}.` : '';
    return [`Set up hyperframes/slide_${nn} from the ${from === 'deck' ? 'approved deck slide' : `${from} starter`}: index.html, beats.json (${beats.length ? `${beats.length} beats from the deck's builds` : 'no beats yet'}, duration ${duration} s for now), assets/ (engine 1.1, flpt-tween, hand.js, the method's fonts${from === 'deck' ? ', the deck\'s own fonts and pictures' : ''}).${kit}`,
      ...notes.map((p) => `! ${p}`)].join('\n');
  }

  /** A picture from this episode, copied into the folder. */
  async function usePicture({ path: p } = {}) {
    if (!ready()) return notReady;
    let file;
    try { file = fs.realpathSync(path.resolve(pres, String(p || ''))); } catch { return `${p} isn't there.`; }
    const root = fs.realpathSync(pres);
    if (!file.startsWith(root + path.sep) || !fs.statSync(file).isFile()) return `${p} isn't a file inside this episode.`;
    if (require('./references').isReference(file)) return 'References stay private: they never go into a slide.';
    if (!PICTURE.test(file)) return 'Pictures only: PNG, JPEG, GIF, WebP or SVG.';
    if (fs.statSync(file).size > 50 * 1024 * 1024) return 'That picture is over 50 MB.';
    if (file.startsWith(fs.realpathSync(folder) + path.sep)) return 'That picture is already in your folder.';
    const name = path.basename(file).normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/^-+/, '').slice(-80) || 'picture.png';
    fs.mkdirSync(at('assets', 'pictures'), { recursive: true });
    fs.copyFileSync(file, at('assets', 'pictures', name));
    return `Copied to assets/pictures/${name}: <img src="assets/pictures/${name}">.`;
  }

  /** The narration's word times and the slide's time on screen (words.json and timing.json, for align). */
  async function timing() {
    if (!ready()) return notReady;
    const narration = motion.narrations(dir)[slide.n] || '';
    if (!narration.trim()) return `script.md has no narration for slide ${slide.n}.`;
    const lead = leadOf(dir, slide.n);
    fs.writeFileSync(at('narration.txt'), narration);
    let words = null;
    let duration;
    let source;
    let spans = '';
    const voice = voiceOf(dir, slide.n);
    if (voice && ctx.python) {
      fs.rmSync(at('words.json'), { force: true });
      const r = await run(ctx.python, [path.join(T, 'real-words.py'), voice.wav, 'narration.txt', 'words.json'], { timeoutMs: 120000 });
      words = r.code === 0 ? readJson(at('words.json'), null) : null;
      if (Array.isArray(words) && words.length) {
        duration = round(voice.slot.duration - 1 / motion.FPS, 3);
        source = voice.which === 'final' ? 'the real voice' : 'the free draft\'s voice (the Mac\'s, so the times move after filming)';
        spans = tail(r.out, 40);
      } else {
        words = null;
      }
    }
    if (!words) {
      words = estimatedWords(narration).words;
      duration = estimatedDuration(narration, lead);
      source = 'estimated at the voice\'s pace, 15 characters a second';
      writeJson(at('words.json'), words);
    }
    writeJson(at('timing.json'), { source, duration, lead });
    const rows = [];
    for (let i = 0; i < words.length; i += 10) rows.push(`  ${words.slice(i, i + 10).map((w) => `${Number(w.start).toFixed(2)} ${w.text}`).join('  ')}`);
    return [`Slide ${slide.n}'s narration, timed from ${source}. On screen for ${duration} s; the voice starts ${lead} s in (align_beats adds that).`,
      'Each word with its start in seconds from the voice\'s start:', ...rows, spans ? `\nreal-words.py's span map:\n${spans}` : '',
      '\nThe app times the beats to the real voice again after filming: cue every beat on these words.'].filter(Boolean).join('\n');
  }

  /** Every cued beat timed to its words, and the duration set. */
  async function align() {
    if (!ready()) return notReady;
    if (!exists(at('words.json')) || !exists(at('timing.json'))) {
      const t = await timing();
      if (!exists(at('timing.json'))) return t;
    }
    const t = readJson(at('timing.json'), {}); // the animator could edit it: only numbers in range go on
    const lead = Math.min(2, Math.max(0, Number(t.lead) || 0));
    const duration = Math.min(600, Math.max(3, Number(t.duration) || 3));
    const a = await run(ctx.node, [path.join(T, 'align-beats.mjs'), folder, '--words', 'words.json', '--offset', String(lead)], { timeoutMs: 60000 });
    const s = await run(ctx.node, [path.join(T, 'render.mjs'), folder, '--duration', String(duration), '--sync'], { timeoutMs: 60000 });
    return [tail(a.out, 60), tail(s.out, 20)].filter(Boolean).join('\n').replace(/Next: node render\.mjs[^\n]*/g, '').trim()
      || (a.code || s.code ? 'align-beats didn\'t run.' : 'Done.');
  }

  /** Stills at chosen times, without a full render. */
  async function snapshot({ at: when } = {}) {
    if (!ready()) return notReady;
    const ts = times(when);
    if (!ts.length) return 'Give one or more times in seconds, e.g. [2.5, 9, 14.2].';
    const hf = Array.isArray(ctx.hyperframes) ? ctx.hyperframes : ctx.hyperframes ? [ctx.node, ctx.hyperframes] : null;
    if (!hf) return 'Stills need HyperFrames: use render_preview with "at" instead.';
    const out = at('snapshots');
    fs.rmSync(out, { recursive: true, force: true });
    let flagged = []; // what the sync names that the slide can't do (a move outside flpt-tween's subset, W3-12)
    const r = await queued(async () => {
      const s = await run(ctx.node, [path.join(T, 'render.mjs'), folder, '--sync'], { timeoutMs: 60000 });
      if (s.code !== 0) return s;
      flagged = s.out.split('\n').filter((l) => /^✗ /.test(l)).map((l) => l.slice(2));
      return run(hf[0], [...hf.slice(1), 'snapshot', folder, '-o', out, '--at', ts.join(','), '--no-end', '--describe', 'false'], { timeoutMs: 5 * 60000 });
    });
    const problems = flagged.length ? ['', `Problems:\n- ${flagged.join('\n- ')}`] : [];
    const pngs = (() => { try { return fs.readdirSync(out).filter((f) => f.endsWith('.png')).sort().map((f) => path.join(out, f)); } catch { return []; } })();
    if (!pngs.length) return [`No stills (exit ${r.code}):\n${tail(r.out, 20)}`, ...problems].join('\n');
    const warn = r.out.split('\n').filter((l) => /^\s*[!✗]|warn|error/i.test(l)).slice(0, 10);
    return [`Stills at ${ts.join(', ')} s (open them with Read):`, ...pngs, ...(warn.length ? ['', ...warn] : []), ...problems].join('\n');
  }

  /** The folder rendered to renders/preview.mp4 and checked, with frames to look at. */
  async function render({ at: when } = {}) {
    if (!ready()) return notReady;
    const ts = times(when);
    const check = at('check');
    fs.rmSync(check, { recursive: true, force: true });
    const args = [path.join(T, 'render.mjs'), folder, '--out', preview, '--check-frames', check, ...(ts.length ? ['--frames-at', ts.join(',')] : [])];
    const t0 = Date.now();
    const r = await queued(() => run(ctx.node, args, { timeoutMs: 15 * 60000 }));
    const json = (() => { const m = r.out.match(/\{\s*"out"[\s\S]*?\n\}/); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } })();
    const warnings = r.out.split('\n').filter((l) => /^! /.test(l)).map((l) => l.slice(2));
    const issues = r.out.split('\n').filter((l) => /^✗ /.test(l)).map((l) => l.slice(2));
    if (!json || !exists(preview)) {
      return `The render failed (exit ${r.code}). The end of its log:\n${tail(r.out.split('\n').filter((l) => !l.includes('[Render:trace]')).join('\n'), 25)}`;
    }
    const hold = json.hold_psnr_db;
    if (hold != null) remember({ check: { holdDb: hold === 'inf' ? 99 : hold } });
    return [`Rendered renders/preview.mp4 in ${Math.round((Date.now() - t0) / 1000)} s: ${json.seconds} s, ${json.frames} frames, ${json.size_mb} MB.`,
      hold != null ? `Hold test: ${hold === 'inf' ? 'perfectly still' : `${hold} dB`} (45 dB or more passes).` : null,
      warnings.length ? `Warnings:\n- ${warnings.join('\n- ')}` : 'No warnings.',
      issues.length ? `Problems:\n- ${issues.join('\n- ')}` : null,
      `Look at every frame (open them with Read):\n${(json.check_frames || []).join('\n')}`].filter(Boolean).join('\n');
  }

  /** The preview's last frame beside the approved picture. */
  async function compare() {
    if (!exists(preview)) return 'Render a preview first (render_preview).';
    if (!exists(picture)) return `The slide's picture (slides/slide_${nn}.png) isn't rendered, so there's nothing to compare with.`;
    const last = at('check', 'preview_last.png');
    fs.mkdirSync(at('check'), { recursive: true });
    await run(ctx.ffmpeg, ['-v', 'error', '-y', '-sseof', '-0.2', '-i', preview, '-update', '1', '-q:v', '1', last], { timeoutMs: 60000 });
    if (!exists(last)) return 'Couldn\'t read the preview\'s last frame. Render it again.';
    const p = await run(ctx.ffmpeg, ['-v', 'info', '-i', last, '-i', picture, '-lavfi', VS_PICTURE, '-f', 'null', '-'], { timeoutMs: 60000 });
    const m = p.out.match(/average:(inf|[\d.]+)/);
    const db = m ? (m[1] === 'inf' ? 99 : round(parseFloat(m[1]), 1)) : null;
    const side = at('check', 'compare.png');
    const diff = at('check', 'difference.png');
    await run(ctx.ffmpeg, ['-v', 'error', '-y', '-i', picture, '-i', last, '-filter_complex', '[0:v]scale=960:540[a];[1:v]scale=960:540[b];[a][b]hstack=inputs=2', '-frames:v', '1', side], { timeoutMs: 60000 });
    await run(ctx.ffmpeg, ['-v', 'error', '-y', '-i', picture, '-i', last, '-filter_complex', '[0:v]format=rgb24,scale=1920:1080[a];[1:v]format=rgb24[b];[a][b]blend=all_mode=difference,format=gray,eq=contrast=4,scale=960:540', '-frames:v', '1', diff], { timeoutMs: 60000 });
    if (db != null) remember({ check: { lastDb: db } });
    const stale = mtime(preview) < Math.max(mtime(at('index.html')), mtime(at('beats.json')));
    return [db == null ? 'Couldn\'t measure the difference.' : `Last frame against the approved picture, both lightly blurred first so paper grain doesn't count: ${db === 99 ? 'identical' : `${db} dB PSNR`}. About 30 dB or more is the same picture (video compression accounts for the rest); much lower means something differs.`,
      stale ? '(Your files changed after this preview: render again to compare what you have now.)' : null,
      `Side by side (left: the deck's picture, right: your last frame): ${side}`,
      exists(diff) ? `The difference (bright where they differ): ${diff}` : null].filter(Boolean).join('\n');
  }

  return { start, usePicture, timing, align, snapshot, render, compare, folder, preview, picture };
}

// ── one animator's session ──────────────────────────────────────────────────────────────────────────────────────

/** Is a write inside the folder, by the path and by where it really leads (no link out)? */
function writesInside(p, cwd, folder) {
  if (typeof p !== 'string' || !p) return false;
  const r = path.resolve(cwd, p);
  if (!(r.startsWith(folder + path.sep))) return false;
  let probe = r;
  while (!fs.existsSync(probe) && probe !== folder) probe = path.dirname(probe);
  try {
    const real = fs.realpathSync(probe);
    const top = fs.realpathSync(folder);
    return real === top || real.startsWith(top + path.sep);
  } catch {
    return probe === folder; // the folder itself isn't there yet
  }
}

/** The animator's permission policy: read the episode and the method; write only inside its slide folder; no web. */
function policy({ presDir, engineRoot, folder }) {
  const allow = (input) => ({ behavior: 'allow', updatedInput: input });
  const deny = (message) => ({ behavior: 'deny', message });
  const records = new Set([MARK, motion.MARKER, motion.SCENE_FILE]); // a Live Motion scene's record too (its rendered.sha)
  return async (toolName, input) => {
    if (agents.READS.has(toolName)) {
      const p = input.file_path || input.path || presDir;
      return agents.within(p, presDir) || agents.within(p, engineRoot) ? allow(input) : deny('Read only inside the episode folder or the bundled method.');
    }
    if (agents.WRITES.has(toolName)) {
      if (!writesInside(input.file_path, presDir, folder)) return deny(`Write only inside your slide folder, ${path.relative(presDir, folder)}/.`);
      if (records.has(path.basename(input.file_path))) return deny('That file is the app\'s record of who made the folder.');
      // a folder without the crew's record would pass for the user's own: start_slide makes it first
      if (!exists(path.join(folder, MARK))) return deny('Set up your folder first with start_slide.');
      return allow(input);
    }
    if (toolName.startsWith('mcp__flpt__') || toolName === 'Skill' || toolName === 'TodoWrite') return allow(input);
    return deny(`${toolName} isn't available to an animator.`);
  };
}

/** The {{placeholders}} of engine/prompts/animate.md for one slide. */
function promptVars(dir, slide, title) {
  const nn = pad2(slide.n);
  const { modules } = motion.readDeck(dir);
  const e = ((modules && modules.slides) || {})[slide.id] || {};
  const narration = motion.narrations(dir)[slide.n] || '';
  const builds = Array.isArray(e.builds) && e.builds.length ? e.builds.map((b) => `\n  - ${typeof b === 'string' ? b : JSON.stringify(b)}`).join('') : ' none.';
  const cartoon = e.module === 'cosmos';
  const sketch = e.module === 'sketch' || /whiteboard|doodle|sketch/i.test(slide.brief);
  // the deck crew's longer brief for the slide (a cartoon's storyboard), when it wrote one
  const briefFile = typeof e.brief === 'string' && /^briefs\/[\w.-]+\.md$/.test(e.brief) && exists(path.join(dir, 'presentation', 'deck', 'project', e.brief))
    ? `\n- the deck crew's brief for it: \`deck/project/${e.brief}\` (read it: the story, the keyframes and their cues)` : '';
  return {
    title, n: slide.n, nn, id: slide.id, module: e.module || 'statement', brief: slide.brief, builds, brief_file: briefFile,
    narration: narration ? narration.split('\n').map((l) => `> ${l}`).join('\n') : '> (no narration for this slide in script.md)',
    lead: leadOf(dir, slide.n),
    starter: cartoon ? 'live-slide' : sketch ? 'whiteboard-sketch' : 'deck',
    last_frame: cartoon
      ? 'A Cosmos cartoon is the exception: the deck\'s slide is its title card, the cartoon starts from it, and its last frame is its last scene. Everything is drawn from shapes (SVG and CSS): no generated art.'
      : sketch
        ? 'For a whiteboard sketch: the same doodles in the same places with the same labels. A doodle may be redrawn with the kit (its wobble, fills, a better-drawn dragon), never moved, added or dropped.'
        : '',
    frame_zero: slide.n === 1 ? 'Slide 1 fades in from black, so its title may rise in at about 0.6 s.' : 'Mark the eyebrow and title `data-nodim`.',
    corner: cartoon
      ? 'The bubble is hidden on this slide, so art may reach the bottom-left corner, but keep faces and anything essential out of x 0–380, y 700–1080: the bubble comes back on the next slide.'
      : 'Nothing in x 0–380, y 700–1080 (the presenter\'s bubble), and labels at least 64 px from every edge.',
  };
}

// ── the crew runner, and the pool every crew session shares ─────────────────────────────────────────────────────

const pool = { running: 0, waiting: [] };
/** How many crew sessions run now, and how many wait (for tests and the log). */
const poolState = () => ({ running: pool.running, waiting: pool.waiting.length, size: PARALLEL });
/**
 * Run fn in the shared pool: at most PARALLEL at once across every animator and scene crew. A caller whose signal
 * aborts while it waits leaves the queue without running (→ `stopped()`).
 */
function inPool(fn, { signal, stopped } = {}) {
  return new Promise((resolve, reject) => {
    const start = () => {
      pool.running += 1;
      Promise.resolve().then(fn).then(resolve, reject).finally(() => {
        pool.running -= 1;
        const next = pool.waiting.shift();
        if (next) next();
      });
    };
    if (signal && signal.aborted) { resolve(stopped ? stopped() : undefined); return; }
    if (pool.running < PARALLEL) { start(); return; }
    const entry = () => { if (signal) signal.removeEventListener('abort', leave); start(); };
    const leave = () => {
      const i = pool.waiting.indexOf(entry);
      if (i >= 0) { pool.waiting.splice(i, 1); resolve(stopped ? stopped() : undefined); }
    };
    pool.waiting.push(entry);
    if (signal) signal.addEventListener('abort', leave, { once: true });
  });
}

/** An in-process tool's answer as the SDK wants it: its text, or what went wrong (never a throw). */
async function toolText(fn) {
  let out;
  try { out = await fn(); } catch (e) { out = `That didn't work: ${String(e && e.message ? e.message : e).slice(0, 400)}`; }
  return { content: [{ type: 'text', text: String(out) }] };
}

/**
 * One crew session (an animator's, a scene crew's): its in-process `flpt` tools (`defs`, made with deps.sdk.tool),
 * the crew's session options narrowed to `tools` and `disallowed`, its policy (canUseTool, wrapped by agents in the
 * global rules) and read denials, `maxTurns`, and a spending cap of broker.sessionCap(`reservedUsd`) (T21: the SDK
 * checks between turns, so the reservation covers one turn's overshoot). `patch` replaces session options for a crew
 * that needs less (the scene crew: no plugin, no skills). It runs in the shared pool. → agents.runSession's answer
 * ({ ok, costUsd, costKnown, turns, sessionId, report, error })
 */
async function runCrew({ presDir, engineRoot, prompt, house, defs, tools, disallowed = [], canUseTool, readDeny = [], model = 'opus', maxTurns, reservedUsd,
  signal, onEvent = () => {}, patch = {} }, deps) {
  const { sdk } = deps;
  const flpt = sdk.createSdkMcpServer({ name: 'flpt', version, tools: defs });
  const abort = new AbortController();
  if (signal && signal.aborted) abort.abort();
  else if (signal) signal.addEventListener('abort', () => abort.abort(), { once: true });
  const options = {
    ...agents.sessionOptions({ presDir, engineRoot, model, tools, disallowed, canUseTool, readDeny, mcpServers: { flpt }, house, maxTurns,
      budgetUsd: broker.sessionCap(reservedUsd), abort }, deps),
    ...patch,
  };
  const ep = path.dirname(path.resolve(presDir));
  active.set(ep, (active.get(ep) || 0) + 1);
  try {
    return await inPool(() => agents.runSession({ sdk, prompt, options, abort, onEvent }),
      { signal: abort.signal, stopped: () => ({ ok: false, costUsd: 0, costKnown: true, turns: 0, sessionId: null, report: '', error: 'Stopped.' }) });
  } finally {
    const n = (active.get(ep) || 1) - 1;
    if (n > 0) active.set(ep, n); else active.delete(ep);
  }
}
const active = new Map(); // episode folder → crew sessions (animators' and scene crews') waiting or running in this process
/** How many crew sessions (an animator's, a scene crew's) this process has waiting or running for an episode. */
const crewsAt = (dir) => active.get(path.resolve(dir)) || 0;

/**
 * Run one animator. Returns what agents.runSession returns ({ ok, costUsd, costKnown, turns, sessionId, report,
 * error }). `budgetUsd` is what the flow reserved for it; the session runs at the broker's sessionCap of that.
 * deps: { sdk, z, apiKey, toolEnvPath, configDir, executable, tools (makeTools for this slide) }.
 */
async function runAnimator({ slide, projectDir, engineRoot, title, feedback = '', onEvent = () => {}, signal, model = 'opus', budgetUsd = PER_SLIDE_USD }, deps) {
  const { sdk, z, tools: t } = deps;
  const presDir = path.join(projectDir, 'presentation');
  const folder = motion.hfDir(projectDir, slide.n);
  const { prompt, house } = agents.stagePrompt({ stageId: 'animate', engineRoot, vars: promptVars(projectDir, slide, title), feedback });
  const text = toolText;
  const seconds = z.array(z.number());
  const defs = [
    sdk.tool('start_slide', `Set up your slide folder (${path.relative(presDir, folder)}/) from a starter: "deck" (the approved slide exactly as designed, with the deck's fonts and pictures and its builds as first beats: its last frame matches the picture), "whiteboard-sketch" (the board, the marker pen, Caveat, hand.js and the doodle kit), "possible-worlds" (a worked diagram) or "live-slide" (blank). Every starter gets engine 1.1, flpt-tween (FLPT's tween engine, a subset of GSAP's), hand.js and the method's local fonts. fresh: true starts again.`,
      { from: z.enum(STARTERS).optional(), fresh: z.boolean().optional() }, (a) => text(() => t.start(a))),
    sdk.tool('use_picture', 'Copy a picture from this episode (a path inside presentation/, such as assets/calls/c1-photo.jpg or a Library item in assets/library/) into your folder\'s assets/pictures/. Pictures only.',
      { path: z.string() }, (a) => text(() => t.usePicture(a))),
    sdk.tool('narration_timing', 'The slide\'s narration with the time of every word, and how long the slide is on screen: from the voice when there is one, else estimated at the voice\'s pace. Writes words.json and timing.json for align_beats.',
      {}, () => text(() => t.timing())),
    sdk.tool('align_beats', 'Time every beat that has a cue to its words (0.2 s ahead; beats with "after" follow the one before) and set the slide\'s duration. Reports any cue the narration doesn\'t say, missing ids, and motion running into the hold.',
      {}, () => text(() => t.align())),
    sdk.tool('snapshot', 'Quick stills of your slide at these times (seconds), without a full render: for checking layout. Returns PNG paths to open with Read.',
      { at: seconds }, (a) => text(() => t.snapshot(a))),
    sdk.tool('render_preview', 'Render your folder to a silent 1920x1080, 30 fps preview and check it: lint, size, frame count, the hold test. Returns frames to open with Read (20, 45 and 70 % and the last, or the times you give).',
      { at: seconds.optional() }, (a) => text(() => t.render(a))),
    sdk.tool('compare_with_slide', 'Your preview\'s last frame beside the approved slide picture: the PSNR (both lightly blurred first), a side-by-side PNG and a difference PNG to open with Read.',
      {}, () => text(() => t.compare())),
  ];
  return runCrew({ presDir, engineRoot, prompt, house, defs, tools: TOOLS, disallowed: ['WebSearch', 'WebFetch'], canUseTool: policy({ presDir, engineRoot, folder }),
    model, maxTurns: MAX_TURNS, reservedUsd: budgetUsd, signal, onEvent }, deps);
}

/**
 * After an animator's session: is there an animation the engine can use? Its preview is brought up to date (one more
 * render when the last edits weren't rendered) and compared with the slide picture. A folder that doesn't render is
 * set aside, so the slide keeps the engine's builds. Returns { ok, error, note, check }.
 */
async function finish(dir, slide, res, t, probe) {
  const folder = motion.hfDir(dir, slide.n);
  const mark = readJson(path.join(folder, MARK), null);
  const said = res.error ? `${res.error} ` : '';
  if (!mark || mark.slide !== slide.id) return { ok: false, error: `${said}The animator didn't make the slide.`.trim() };
  const has = exists(path.join(folder, 'index.html')) && exists(path.join(folder, 'beats.json'));
  if (has && mtime(t.preview) < Math.max(mtime(path.join(folder, 'index.html')), mtime(path.join(folder, 'beats.json')))) await t.render({});
  if (!has || !(await motion.clipOk(t.preview, probe))) {
    dropClip(dir, slide.n, mark);
    park(dir, folder, slide.id);
    // the slide's earlier animation, set aside when this attempt started (start_slide), comes back
    const parked = path.join(dir, 'presentation', 'hyperframes', 'parked');
    const prev = typeof mark.previous === 'string' ? path.resolve(dir, 'presentation', 'hyperframes', mark.previous) : null;
    if (prev && prev.startsWith(parked + path.sep) && isDir(prev) && !fs.existsSync(folder)) {
      fs.renameSync(prev, folder);
      return { ok: false, error: `${said}The new animation didn't render, so the slide keeps the one it had.`.trim() };
    }
    return { ok: false, error: `${said}Its animation didn't render, so the slide keeps its builds.`.trim() };
  }
  await t.compare();
  const now = readJson(path.join(folder, MARK), mark);
  writeJson(path.join(folder, MARK), { ...now, ok: true, at: new Date().toISOString() });
  return { ok: true, error: null, note: res.ok ? null : `The animator stopped early (${res.error}). This is its last render.`, check: now.check || null };
}

module.exports = { marked, view, sync, noteClips, owner, crewFolders, checkMarks, makeTools, createExec, runAnimator, finish, policy, promptVars,
  leadOf, estimatedWords, estimatedDuration, slideSha, runCrew, crewsAt, inPool, poolState, toolText, queued, MARK, PER_SLIDE_USD, MAX_TURNS, PARALLEL, STARTERS, TOOLS, HOLD_BLUR, VS_PICTURE };
