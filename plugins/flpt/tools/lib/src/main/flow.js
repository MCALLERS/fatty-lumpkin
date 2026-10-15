'use strict';
// The episode flow: create → bullets → fact-check → deck → script → animate → scenes → spend → film → refine → deliver.
// Agent stages run through agents.runStage; pipeline stages run the engine's scripts directly. Every paid step goes
// through the broker: Claude planning (the crew and the animators) against an approved planning budget, filming
// against an approved HeyGen budget, and the Scenes step's stills and shots (scenes.js; generate.js makes them) each
// against their own small approval. Animate (animators.js) runs one session per slide the deck marks for an animation
// of its own. Refine tightens the finished film's pauses (tighten.js) and puts add-ons on it (refine.js), with ffmpeg
// alone. The one thing there that costs anything is Scribe, for cutting laughs: cents, through the broker, once per
// film. Deliver hands over the extras too (extras.js): levelled, with a clip guide, and later the Slack pack.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const episode = require('./episode');
const agents = require('./agents');
const stagetools = require('./stagetools');
const layoutqa = require('./layoutqa');
const modules = require('./modules');
const motionLib = require('./motion'); // media.json: which slides are narrated without the bubble
const animators = require('./animators');
const refineMod = require('./refine');
const tightenMod = require('./tighten');
const extras = require('./extras');
const scenesMod = require('./scenes'); // the Scenes step: cartoons and cut scenes (the paid side is d.scenes)
const { estimate } = require('./broker');
const { spawn } = require('child_process');

const FILES = { bullets: 'bullets.md', claims: 'research/claims.md', script: 'script.md', brief: 'brief.md' };
// What a call may carry: images (a notebook photo, a chart screenshot), clips, and documents or stories to read.
const ATTACH = { image: /\.(png|jpe?g|gif|webp|heic|heif)$/i, video: /\.(mp4|mov|m4v)$/i, doc: /\.(pdf|txt|md|rtf|docx|html?)$/i };
const MAX_ATTACH = 500 * 1024 * 1024;
const EDITABLE = new Set(['bullets', 'script']);
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const mtime = (p) => { try { return Math.round(fs.statSync(p).mtimeMs); } catch { return null; } };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
/** The episode's tightening choice: 'off', 'on' (pauses, free) or 'on+laughs' (and laughs, with Scribe). */
const tightenKey = (st) => (st && st.tighten && st.tighten.on ? (st.tighten.laughs ? 'on+laughs' : 'on') : 'off');
const SCRIBE_MIN_S = 180; // Scribe is priced (and approved) at a cent or more, never at zero

/** The {{placeholders}} an episode's stage prompts get (agents.stagePrompt adds the skill paths and the user's notes). */
function stageVars(st) {
  const target = episode.slideTarget(st.intake.minutes);
  return { title: st.title, minutes: st.intake.minutes, words: st.intake.minutes * 150, slides_min: target.min, slides_max: target.max,
    modules: modules.promptCatalog(), calls: modules.promptCalls(st.calls || []) };
}

// ── the player page's titles (player/player_config.json, read by the method's build_player.py) ──

// What build_player.py writes when the file is missing: placeholders, never the user's own words.
const PLAYER_PLACEHOLDERS = { page_title: 'Talk Recording', title: 'Talk title', eyebrow: 'Team meeting',
  subtitle: 'One-line description of the talk', deck_url: '', media_note: '' };
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

/**
 * The player page's titles from the episode: its title, the series (or FLPT) as the eyebrow, the point as the
 * subtitle, and a media note only when the video has AI-generated cut scenes or cartoons in it.
 */
function playerConfig(st, { cutscenes = 0, cartoons = 0 } = {}) {
  const i = st.intake || {};
  const title = st.title || i.title || 'Untitled episode';
  const note = cutscenes && cartoons ? 'The cut scenes and the cartoons are AI-generated.'
    : cutscenes ? 'The cinematic cut scenes are AI-generated.' : cartoons ? 'The cartoons are AI-generated.' : '';
  return { page_title: title, title, eyebrow: i.series || 'Fatty Lumpkin Presentation Tool', subtitle: i.point || '', deck_url: '', media_note: note };
}

/** Why the Spend step can't open yet, in the user's words. */
// Why Spend can't open yet: the step before it that's waiting (Scenes, then Animate), else the script.
const spendBlocked = (st) => (episode.canRun(st, 'scenes') ? 'Approve Scenes first: make the cartoons and cut scenes there, or go on without them.'
  : episode.canRun(st, 'animate') ? 'Approve the animations first (or skip them).' : 'Approve the script first.');

/** What's in the filmed video: its cut scenes (the final timeline), and the Cosmos slides that play a cartoon. */
function filmedMedia(dir, finalOutput) {
  let cutscenes = 0;
  try { cutscenes = (JSON.parse(fs.readFileSync(finalOutput.replace(/\.mp4$/, '.timeline.json'), 'utf8')).cutscenes || []).filter((c) => !c.placeholder).length; } catch { /* not filmed */ }
  let slides = {};
  try { slides = JSON.parse(fs.readFileSync(path.join(dir, 'presentation', 'media.json'), 'utf8')).slides || {}; } catch { /* none */ }
  // A cartoon is a video of its own on a Cosmos slide (FLPT's moving title card isn't one).
  const cartoons = motionLib.cosmosSlides(dir).filter((n) => { const e = slides[String(n)]; return e && e.video && e.note !== motionLib.MOTION_NOTE; }).length;
  return { cutscenes, cartoons };
}

/**
 * Write player/player_config.json from the episode, unless the user has made it their own: FLPT replaces only a
 * missing file, build_player.py's placeholders, or the exact file FLPT wrote last time (its hash is in the record).
 * Returns true when it wrote the file.
 */
function writePlayerConfig(dir, finalOutput) {
  const file = path.join(dir, 'presentation', 'player', 'player_config.json');
  const st = episode.read(dir);
  let current = null;
  try { current = fs.readFileSync(file, 'utf8'); } catch { /* none yet */ }
  const placeholder = (() => { try { const j = JSON.parse(current); return Object.keys(PLAYER_PLACEHOLDERS).every((k) => j[k] === PLAYER_PLACEHOLDERS[k]) && Object.keys(j).length === 6; } catch { return false; } })();
  const ours = current == null || placeholder || (st.player && st.player.configSha === sha256(current));
  if (!ours) return false;
  const text = `${JSON.stringify(playerConfig(st, filmedMedia(dir, finalOutput)), null, 1)}\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, text);
  fs.renameSync(`${file}.tmp`, file);
  episode.write(dir, { ...st, player: { configSha: sha256(text) } });
  return true;
}

function createFlow(d) {
  // d: { settings, vault, pipeline, broker, toolEnv, chrome(), engineRoot, configDir, executable, confirm(opts), send,
  //      basePython(), loadSdk(), redact, motion: { available(), clear(dir), render(dir, which, opts), assemble(dir, key, opts) }
  //      (optional), scribe(): an ElevenLabs Scribe client (providers/elevenlabs.js; optional: without it, no laughs are
  //      cut), animators: { available(), tools(dir, slide, signal), probe } (optional: the animator crew's in-process
  //      tools), scenes: { make({ dir, key, step, title, project }), pending(dir), routes(), keys() } (optional: the paid
  //      side of the Scenes step, in the app; without it the stills and shots can't be made) }
  const running = new Map(); // dir → AbortController, for agent stages
  const busy = new Set(); // dirs with a pipeline step (draft, film, deliver) under way
  const exclusive = async (dir, fn) => {
    if (running.has(dir) || busy.has(dir)) throw new Error('Something is already running for this episode.');
    busy.add(dir);
    try {
      if (estimating.has(dir)) await estimating.get(dir); // a free filming estimate finishing (a second or two)
      return await fn();
    } finally { busy.delete(dir); }
  };

  const projectsDir = () => d.settings.read().projectsDir;
  const inProjects = (dir) => {
    const root = path.resolve(projectsDir());
    const r = path.resolve(dir);
    return r.startsWith(root + path.sep) && exists(path.join(r, 'flpt-project.json'));
  };
  const guard = (dir) => { if (!inProjects(dir)) throw new Error('That isn\'t an FLPT episode folder.'); return path.resolve(dir); };

  function list() {
    const root = projectsDir();
    if (!exists(root)) return [];
    return fs.readdirSync(root).filter((n) => n !== 'Samples').map((n) => path.join(root, n))
      .map((dir) => ({ dir, st: episode.read(dir) })).filter((x) => x.st)
      .map(({ dir, st }) => {
        const stage = episode.current(st);
        return { dir, title: st.title, stage, stageLabel: episode.STAGES.find((s) => s.id === stage).label, updatedAt: st.updatedAt,
          minutes: st.intake.minutes, delivered: st.stages.deliver.status === 'approved' };
      })
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async function create(intake, files = []) {
    const i = episode.clean(intake);
    const root = projectsDir();
    fs.mkdirSync(root, { recursive: true });
    let dir = path.join(root, episode.slugify(i.title));
    for (let n = 2; exists(dir); n++) dir = path.join(root, `${episode.slugify(i.title)} ${n}`);
    fs.mkdirSync(dir, { recursive: true });
    const base = await d.basePython();
    if (!base) throw new Error('Python isn\'t set up yet. Finish the Tools step of setup first.');
    const r = await d.pipeline.scaffold(dir, base, {});
    if (r.code !== 0) throw new Error('Setting up the episode folder failed.');
    episode.create(dir, i);
    // Files the user brought (notes, photos, a story): copied in, and listed in the brief the crew reads first.
    if (files.length) {
      const got = await copyIn(dir, files, path.join('assets', 'intake'), 'intake');
      fs.appendFileSync(path.join(dir, 'presentation', 'brief.md'), `\n## Their files\n${got.map((a) => `- \`${a.path}\`${a.poster ? ` (poster frame: \`${a.poster}\`)` : ''}`).join('\n')}\n`);
    }
    return dir;
  }

  /** The crew's record of which module each slide uses (deck/project/modules.json), or null. */
  function readModulesMap(dir) {
    try { return JSON.parse(fs.readFileSync(path.join(dir, 'presentation', 'deck', 'project', 'modules.json'), 'utf8')); } catch { return null; }
  }

  function readDeckOrder(dir) {
    try { return JSON.parse(fs.readFileSync(path.join(dir, 'presentation', 'deck', 'project', 'deck.json'), 'utf8')).order || []; } catch { return []; }
  }

  /** "## Slide 3 — Title" headings in bullets.md, for picking where a call goes. */
  function bulletSlides(text) {
    return String(text || '').split(/\r?\n/).map((l) => l.match(/^##\s+Slide\s+(\d+)\s*[—–-]\s*(.*)$/i)).filter(Boolean)
      .map((m) => ({ n: Number(m[1]), title: m[2].trim() }));
  }

  function slidesView(dir) {
    const sd = path.join(dir, 'presentation', 'slides');
    return exists(sd) ? fs.readdirSync(sd).filter((f) => /^slide_\d+\.png$/.test(f)).sort().map((f) => path.join(sd, f)) : [];
  }

  function open(dir) {
    dir = guard(dir);
    const st = episode.read(dir);
    const read = (rel) => { try { return fs.readFileSync(path.join(dir, 'presentation', rel), 'utf8').slice(0, 200000); } catch { return null; } };
    const files = Object.fromEntries(Object.entries(FILES).map(([k, rel]) => [k, read(rel)]));
    const video = d.pipeline.finalOutput(dir);
    const draft = d.pipeline.draftOutput(dir);
    const slides = slidesView(dir);
    const live = (provider) => Boolean(st.budgets && st.budgets[provider] && d.broker.isLive(st.budgets[provider], provider));
    return {
      dir, state: st, current: episode.current(st), stages: episode.STAGES, files, slides,
      // the *At times are file modification times: the renderer uses them to reload images and videos that changed
      slidesAt: slides.reduce((a, p) => Math.max(a, mtime(p) || 0), 0) || null,
      video: exists(video) ? video : null, videoAt: mtime(video), draft: exists(draft) ? draft : null, draftAt: mtime(draft),
      running: running.has(dir) || busy.has(dir),
      budgets: { anthropic: live('anthropic'), heygen: live('heygen') },
      // Filming again costs nothing: every clip is already filmed (see approveSpend).
      freeFilm: st.stages.spend.status === 'approved' && st.stages.spend.free === true,
      estimateSeconds: files.script ? episode.estimateSeconds(episode.parseScript(files.script)) : null,
      calls: st.calls || [],
      scenes: scenesView(dir),
      modules: readModulesMap(dir),
      deckOrder: readDeckOrder(dir),
      slideTitles: bulletSlides(files.bullets),
      catalog: modules.MODULES.map(({ id, name, short, ask, now, withFile }) => ({ id, name, short, ask, now, withFile })),
      animate: animateView(dir, st),
      refine: refineView(dir, st),
    };
  }

  // ── Refine: add-ons on the finished film ──

  /** The film's slides, for placing add-ons: from its timeline, else the deck's order. */
  function filmSlides(dir) {
    let tl = null;
    try { tl = JSON.parse(fs.readFileSync(refineMod.outputs(dir).filmTimeline, 'utf8')); } catch { /* not filmed yet */ }
    if (tl && Array.isArray(tl.slides) && tl.slides.length) return tl.slides.map((x) => ({ n: Number(x.n), title: String(x.title || '') }));
    return readDeckOrder(dir).map((id, i) => ({ n: i + 1, title: String(id) }));
  }

  /** Anything for Refine to apply: add-ons, or tightening. */
  const refineWork = (st) => Boolean((st.addons || []).length || tightenKey(st) !== 'off');

  /**
   * What Refine made, while it's current (these add-ons and this tightening, on this film): { video, master,
   * timeline }, the refined ones with add-ons, else the tightened ones. Else null.
   */
  function refinedOutputs(dir, st) {
    const rec = st.stages.refine || {};
    const addons = st.addons || [];
    if (!refineWork(st) || !rec.applied) return null;
    const o = refineMod.outputs(dir);
    if (rec.applied.addons !== refineMod.addonsKey(addons) || rec.applied.film !== refineMod.filmKey(o.film) || (rec.applied.tighten || 'off') !== tightenKey(st)) return null;
    const made = addons.length ? { video: o.video, master: o.master, timeline: o.timeline } : { video: o.tight, master: o.tightMaster, timeline: o.tightTimeline };
    return exists(made.video) && exists(made.master) ? made : null;
  }

  const hasScribeKey = () => Boolean(d.scribe && d.vault && typeof d.vault.status === 'function' && (d.vault.status().ELEVENLABS_API_KEY || {}).set);

  function refineView(dir, st) {
    const addons = st.addons || [];
    const current = refinedOutputs(dir, st);
    const rec = st.stages.refine || {};
    const tk = tightenKey(st);
    return {
      addons: addons.map((a) => ({ id: a.id, kind: a.kind, title: a.title, where: refineMod.where(a, addons), slide: a.slide || null, under: a.under || null,
        phrase: a.phrase || '', sound: a.sound || null, style: a.style || null, duration: a.duration || null })),
      slides: filmSlides(dir),
      // Laughs are offered with an ElevenLabs key (Scribe finds them); once chosen, they stay on screen to turn off.
      tighten: { on: tk !== 'off', laughs: tk === 'on+laughs', offered: hasScribeKey() || tk === 'on+laughs' },
      video: current ? current.video : null, videoAt: current ? mtime(current.video) : null,
      outdated: Boolean(!current && refineWork(st) && rec.applied),
      notes: current && rec.applied && Array.isArray(rec.applied.notes) ? rec.applied.notes : [],
    };
  }

  const refineBusy = (st) => st.stages.refine.status === 'running';
  /** Add-ons changed: what was applied (and delivered) no longer matches. */
  function refineChanged(st) {
    if (st.stages.refine.status !== 'todo') st.stages.refine = { ...st.stages.refine, status: 'todo', at: new Date().toISOString() };
    if (st.stages.deliver.status === 'approved') st.stages.deliver = { ...st.stages.deliver, status: 'stale' };
  }

  /**
   * Add one add-on (see refine.cleanAddon). `spec.file` is an absolute path the main process resolved (from the
   * Library, Transitions & Music, or a file the user picked); it's copied into presentation/assets/refine/.
   */
  function addAddon(dir, spec = {}) {
    dir = guard(dir);
    const st = episode.read(dir);
    if (!episode.canRun(st, 'refine')) throw new Error('Approve the film first.');
    if (refineBusy(st)) throw new Error('Refine is applying. Change the add-ons when it\'s done.');
    const addons = st.addons || [];
    const a = refineMod.cleanAddon(spec, { slides: filmSlides(dir).length, addons });
    const id = `a${addons.reduce((m, x) => Math.max(m, Number(String(x.id).slice(1)) || 0), 0) + 1}`;
    const safe = path.basename(spec.file).normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/^-+/, '').slice(-80) || 'file';
    const rel = path.join('assets', 'refine', `${id}-${safe}`);
    fs.mkdirSync(path.join(dir, 'presentation', 'assets', 'refine'), { recursive: true });
    fs.copyFileSync(spec.file, path.join(dir, 'presentation', rel), fs.constants.COPYFILE_FICLONE);
    st.addons = [...addons, { id, ...a, file: rel, at: new Date().toISOString() }];
    refineChanged(st);
    episode.write(dir, st);
    return open(dir);
  }

  /** Remove an add-on, its copied file, and any music that sat under it. */
  function removeAddon(dir, id) {
    dir = guard(dir);
    const st = episode.read(dir);
    if (refineBusy(st)) throw new Error('Refine is applying. Change the add-ons when it\'s done.');
    const addons = st.addons || [];
    if (!addons.some((x) => x.id === id)) throw new Error('That add-on is already gone.');
    const gone = new Set([id, ...addons.filter((x) => x.under === id).map((x) => x.id)]);
    for (const x of addons.filter((y) => gone.has(y.id))) if (x.file) fs.rmSync(path.join(dir, 'presentation', x.file), { force: true });
    st.addons = addons.filter((x) => !gone.has(x.id));
    refineChanged(st);
    episode.write(dir, st);
    return open(dir);
  }

  /** Tightening on or off for this episode (laughs too, with an ElevenLabs key). A change re-opens Refine. */
  function setTighten(dir, t = {}) {
    dir = guard(dir);
    const st = episode.read(dir);
    if (!episode.canRun(st, 'refine')) throw new Error('Approve the film first.');
    if (refineBusy(st)) throw new Error('Refine is applying. Change it when it\'s done.');
    const next = { on: Boolean(t && t.on), laughs: Boolean(t && t.on && t.laughs) };
    if (next.laughs && tightenKey(st) !== 'on+laughs' && !hasScribeKey()) throw new Error('Cutting laughs needs an ElevenLabs key (Setup → Keys).');
    if (tightenKey({ tighten: next }) === tightenKey(st)) return open(dir);
    st.tighten = next;
    refineChanged(st);
    episode.write(dir, st);
    return open(dir);
  }

  // ── laughs: Scribe's word timings and audio events, paid (cents), once per film ──
  const scribeFile = (dir) => path.join(tightenMod.workDir(path.join(dir, 'presentation')), 'scribe.elevenlabs.json');
  const toolsFor = () => ({ ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', ...(d.refineTools || {}) });
  const toolEnvFor = () => ({ PATH: d.toolEnv().PATH, HOME: process.env.HOME || '', LANG: 'en_US.UTF-8' });

  /** Scribe's transcription of this film from an earlier (paid) run, or null when the film has changed since. */
  function keptScribe(dir, film) {
    const k = readJson(scribeFile(dir));
    return k && k.film === refineMod.filmKey(film) && k.response && Array.isArray(k.response.words) ? k.response : null;
  }

  /** The price of Scribe for a film this long, and the user's yes in the native dialog: { token, usd }, or null. */
  async function approveScribe(st, seconds) {
    const est = estimate([{ rate: 'elevenlabs_scribe_s', qty: Math.max(SCRIBE_MIN_S, Math.ceil(seconds)), label: 'Scribe: the film\'s sound, for its laughs' }]);
    const usd = est.byProvider.elevenlabs.usd;
    const ok = await d.confirm({
      title: 'Spend money on ElevenLabs?',
      message: 'Find the laughs to cut?',
      detail: `ElevenLabs Scribe listens to the film once (${(seconds / 60).toFixed(1)} min of sound): about ${usd.toFixed(2)} US dollars, plus up to 15 % margin. Nothing else will be charged.`,
      button: `Approve ${usd.toFixed(2)} US dollars`,
    });
    if (!ok) return null;
    return { token: d.broker.approve(est, { project: st.title, stage: 'laughs' }).elevenlabs, usd };
  }

  /**
   * Scribe on the film's sound, against an approved budget: one request, then recorded, settled and closed. A
   * refusal costs nothing; a reply that never came keeps its reservation (it may have been billed). Kept for the film.
   */
  async function transcribeFilm(dir, st, film, q, onLine, signal) {
    const what = `${st.title}: laughs (Scribe)`;
    try { d.broker.authorize(q.token, 'elevenlabs', { usd: q.usd, what }); } catch (e) { d.broker.close(q.token); throw e; }
    const sound = path.join(tightenMod.workDir(path.join(dir, 'presentation')), 'scribe-sound.flac');
    let res;
    try {
      fs.mkdirSync(path.dirname(sound), { recursive: true });
      // The film's sound, lossless (no encoder delay to shift the timings) and small: FLAC, 16 kHz mono.
      const x = await refineMod.runTool(toolsFor().ffmpeg, ['-hide_banner', '-nostdin', '-y', '-v', 'error', '-i', film, '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-c:a', 'flac', sound],
        { env: toolEnvFor(), signal });
      if (x.code !== 0) throw new Error('ffmpeg couldn\'t read the film\'s sound.');
      onLine('Laughs: ElevenLabs Scribe is listening to the film…');
      res = await d.scribe().transcribe(sound, { signal });
    } catch (e) {
      const error = d.redact(String(e && e.message ? e.message : e)).slice(0, 300);
      if (e && e.ambiguous) d.broker.record(q.token, { what, provider: 'elevenlabs', outcome: 'unknown', error });
      else {
        d.broker.settle(q.token, { authorizedUsd: q.usd, actualUsd: 0, what });
        d.broker.record(q.token, { what, provider: 'elevenlabs', outcome: 'not done', error });
      }
      d.broker.close(q.token);
      throw new Error(error);
    } finally {
      fs.rmSync(sound, { force: true });
    }
    d.broker.record(q.token, { what, provider: 'elevenlabs', model: 'scribe_v2', outcome: 'done', costUsd: q.usd, words: res.words.length });
    d.broker.close(q.token);
    episode.addCost(dir, { provider: 'elevenlabs', stage: 'refine', usd: q.usd, estimate: true });
    fs.writeFileSync(scribeFile(dir), JSON.stringify({ film: refineMod.filmKey(film), model: 'scribe_v2', usd: q.usd, at: new Date().toISOString(), response: res }));
    onLine(`  Scribe: ${res.words.filter((w) => w.type === 'word').length} words, ${res.words.filter((w) => w.type === 'audio_event').length} sounds.`);
    return res;
  }

  /**
   * Apply: the tightening (tighten.apply), then the add-ons (refine.apply) on the tightened film or the approved one,
   * with ffmpeg only: the refined (or tightened) video and its CapCut-safe master. Nothing is filmed again. Cutting
   * laughs needs Scribe first: asked for here, in the native dialog, unless this film was already transcribed. Ends
   * in review (the preview) or error; a No in the dialog changes nothing.
   */
  async function refine(dir, onLine = () => {}, signal) {
    dir = guard(dir);
    const st = episode.read(dir);
    if (!episode.canRun(st, 'refine')) throw new Error('Approve the film first.');
    const addons = st.addons || [];
    const tk = tightenKey(st);
    if (!refineWork(st)) throw new Error('Add something first.');
    const o = refineMod.outputs(dir);
    if (!exists(o.film) || !exists(o.filmTimeline)) throw new Error('The film isn\'t there. Film it first.');
    const python = tk !== 'off' && d.basePython ? await d.basePython() : null;
    if (tk !== 'off' && !python) throw new Error('Python isn\'t set up yet (Setup → Tools).');
    let scribe = tk === 'on+laughs' ? keptScribe(dir, o.film) : null;
    let paid = null;
    if (tk === 'on+laughs' && !scribe) {
      if (!hasScribeKey()) throw new Error('Cutting laughs needs an ElevenLabs key (Setup → Keys).');
      if (running.has(dir) || busy.has(dir)) throw new Error('Something is already running for this episode.');
      paid = await approveScribe(st, Number((readJson(o.filmTimeline) || {}).total_duration) || 0);
      if (!paid) return { ok: false, cancelled: true };
    }
    const pres = path.join(dir, 'presentation');
    const projectPython = d.pipeline.projectPython ? d.pipeline.projectPython(dir) : null;
    const wordsPython = projectPython && exists(projectPython) ? projectPython : python;
    const realWords = path.join(d.engineRoot || '', 'skills', 'avatar-presentation', 'templates', 'hyperframes', 'real-words.py');
    const applyRefine = async () => {
      episode.setStage(dir, 'refine', { status: 'running', error: null });
      try {
        if (paid) scribe = await transcribeFilm(dir, st, o.film, paid, onLine, signal);
        let tight = null;
        if (tk !== 'off') {
          tight = await tightenMod.apply({ pres, film: o.film, filmTimeline: o.filmTimeline, out: o, engineRoot: d.engineRoot, scribe, python, wordsPython,
            env: toolEnvFor(), onLine, signal, ...toolsFor() });
        }
        let r = null;
        if (addons.length) {
          // On the tightened film, the add-ons' phrases move along with the words.
          const filmTl = tight ? readJson(o.filmTimeline) : null;
          r = await refineMod.apply({
            pres, film: tight ? o.tight : o.film, filmTimeline: tight ? o.tightTimeline : o.filmTimeline, out: o, title: st.title,
            addons: addons.map((a) => ({ ...a, path: path.join(pres, a.file) })), python: projectPython || wordsPython, realWords,
            mapWords: tight ? (n, words) => tightenMod.shiftWords(words, n, filmTl, tight.cuts) : null,
            env: toolEnvFor(), onLine, signal, ...toolsFor(),
          });
        }
        const made = r || tight;
        const notes = [...(tight ? tight.notes : []), ...(r ? r.notes : [])];
        episode.setStage(dir, 'refine', { status: 'review', error: null, applied: { addons: refineMod.addonsKey(addons), film: refineMod.filmKey(o.film), tighten: tk,
          seconds: made.seconds, frames: made.frames, lufs: r ? r.lufs : null, tp: r ? r.tp : null, notes: notes.slice(0, 20), at: new Date().toISOString() } });
        return { ok: true, video: made.video, notes };
      } catch (e) {
        const error = signal && signal.aborted ? 'Stopped.' : d.redact(String(e && e.message ? e.message : e)).slice(0, 400);
        episode.setStage(dir, 'refine', { status: 'error', error });
        return { ok: false, error };
      }
    };
    try {
      return await exclusive(dir, applyRefine);
    } finally {
      if (paid && d.broker.isLive(paid.token, 'elevenlabs')) d.broker.close(paid.token); // approved, but never sent
    }
  }

  // ── Scenes: the cartoons and cut scenes ──

  const assembling = new Map(); // dir → the piece key being put together

  /** Jobs on their way at a provider, or a piece being put together, for this episode. */
  function scenesBusy(dir) {
    return assembling.has(dir) || (d.scenes ? d.scenes.pending(dir) > 0 : scenesMod.working(dir) > 0);
  }

  /** The Scenes step as the page shows it (prices from the providers the settings pick; whether there's a key). */
  function scenesView(dir) {
    // A take marked on its way whose job the app no longer has can't land: it's shown as stopped, to be made again.
    if (d.scenes && !d.scenes.pending(dir) && scenesMod.working(dir)) scenesMod.reconcile(dir);
    const v = scenesMod.view(dir, { routes: d.scenes && d.scenes.routes ? d.scenes.routes() : {}, keys: d.scenes && d.scenes.keys ? d.scenes.keys() : null });
    return { ...v, assembling: assembling.get(dir) || null, canMake: Boolean(d.scenes) };
  }

  /** Something in Scenes changed: it's up for review again, and what was built on it is out of date. */
  function scenesChanged(dir) {
    const st = episode.read(dir);
    if (st.stages.scenes.status === 'review') return;
    episode.setStage(dir, 'scenes', { status: 'running' });
    episode.setStage(dir, 'scenes', { status: 'review' });
  }

  const say = (ev) => { try { d.send('scenes:changed', { dir: ev.dir, key: ev.key || null, error: ev.error || null }); } catch { /* no window */ } };

  /**
   * Put a ready piece together (free: ffmpeg), now or in the background. A cartoon is timed to the narration's pace
   * here; every run times it to its own voice. Returns the view; with `wait`, once it's done.
   */
  async function assembleScene(dir, key, { wait = true } = {}) {
    dir = guard(dir);
    if (!d.motion || !d.motion.assemble) throw new Error('Putting it together needs ffmpeg (Setup → Tools).');
    scenesMod.pieceOf(dir, key);
    if (assembling.has(dir)) throw new Error('Already putting one together.');
    if (running.has(dir) || busy.has(dir)) throw new Error('Something is already running for this episode.');
    assembling.set(dir, key);
    let ok = false;
    const go = exclusive(dir, async () => {
      try {
        await d.motion.assemble(dir, key, {});
        scenesMod.update(dir, (s) => { if (s.pieces[key]) s.pieces[key].error = null; });
        scenesChanged(dir);
        say({ dir, key });
        ok = true;
      } catch (e) {
        const error = d.redact(String(e && e.message ? e.message : e)).slice(0, 300);
        scenesMod.update(dir, (s) => { (s.pieces[key] ||= { slots: {} }).error = error; });
        say({ dir, key, error });
        throw new Error(error);
      }
    }).finally(() => {
      assembling.delete(dir);
      // Another piece that became ready meanwhile is put together next.
      if (ok) { const other = scenesMod.view(dir).pieces.find((p) => p.key !== key && p.ready && p.outdated && !p.error); if (other) assembleIfReady(dir, other.key); }
    });
    if (wait) await go;
    else go.catch(() => {});
    return scenesView(dir);
  }

  /** A piece that's ready and not put together (or put together from older takes) is put together now, in the background. */
  function assembleIfReady(dir, key) {
    if (assembling.has(dir) || running.has(dir) || busy.has(dir) || !d.motion || !d.motion.assemble) return false;
    const v = scenesMod.view(dir).pieces.find((p) => p.key === key);
    if (!v || !v.ready || !v.outdated) return false;
    assembleScene(dir, key, { wait: false }).catch(() => {});
    return true;
  }

  /** A still or shot landed (generate.js): the page hears about it, and a piece that's now ready is put together. */
  function sceneLanded(dir, key) {
    if (!inProjects(dir)) return;
    say({ dir: path.resolve(dir), key });
    try { assembleIfReady(path.resolve(dir), key); } catch { /* the deck changed under it: the page shows why */ }
  }

  /**
   * What the Scenes step's buttons do: { key, action, slot }.
   *   make      the piece's next paid step (scenes.nextStep decides; the page never names one)
   *   reroll    one more take of one still or shot (priced on its own)
   *   animate   the hero shot of a cartoon whose hero was left still
   *   approve   the newest take of a slot (free)
   *   skip      leave the cartoon's hero beat still (free)
   *   assemble  put a ready piece together again (free)
   * Paid actions go through d.scenes.make (generate.js): the price, the dialog, the broker. Returns the view, or
   * { cancelled: true } when the dialog got a no.
   */
  async function sceneAction(dir, { key, action, slot } = {}) {
    dir = guard(dir);
    const st = episode.read(dir);
    if (!episode.canRun(st, 'scenes')) throw new Error('Approve the script first.');
    if (running.has(dir) || busy.has(dir)) throw new Error('Something is already running for this episode.');
    const piece = scenesMod.pieceOf(dir, String(key || ''));
    const names = scenesMod.slotsOf(piece).map((x) => x.name);
    if ((slot != null || ['reroll', 'approve'].includes(action)) && !names.includes(slot)) throw new Error('That part isn\'t in its plan.');
    const stateKey = slot === 'frame' ? scenesMod.STYLE_KEY : piece.key;
    const state = scenesMod.readState(dir);
    const slotState = (name) => ((state.pieces[piece.key] || {}).slots || {})[name] || { takes: [], approved: null, final: null };
    if (action === 'approve') {
      scenesMod.approve(dir, stateKey, slot);
      scenesChanged(dir);
      if (!assembleIfReady(dir, piece.key)) say({ dir, key: piece.key });
      return scenesView(dir);
    }
    if (action === 'skip') {
      if (piece.kind !== 'cartoon' || piece.hero == null) throw new Error('Only a cartoon\'s hero can be left still.');
      if (scenesMod.slotStatus(slotState('hero')) === 'working') throw new Error('That one is still on its way.');
      scenesMod.skipHero(dir, piece.key, true);
      scenesChanged(dir);
      assembleIfReady(dir, piece.key);
      return scenesView(dir);
    }
    if (action === 'assemble') return assembleScene(dir, piece.key);
    let step;
    if (action === 'make') step = scenesMod.nextStep(piece, state);
    else if (action === 'reroll') step = scenesMod.rerollStep(piece, state, slot);
    else if (action === 'animate') {
      if (piece.kind !== 'cartoon' || piece.hero == null) throw new Error('Only a cartoon has a hero shot.');
      if (!scenesMod.approvedTake(slotState(`beat${piece.hero + 1}`))) throw new Error('Approve its keyframe first.');
      if (scenesMod.slotStatus(slotState('hero')) === 'working') throw new Error('That one is still on its way.');
      step = { step: 'video', key: piece.key, slots: ['hero'], kind: 'video' };
    } else throw new Error('FLPT doesn\'t know that.');
    if (!step) throw new Error('There\'s nothing to make there now.');
    if (!d.scenes) throw new Error('Cartoons and cut scenes are made in the FLPT app.');
    const r = await d.scenes.make({ dir, key: piece.key, step, title: piece.title, project: st.title });
    if (r && r.cancelled) return { cancelled: true };
    scenesChanged(dir);
    return { ...scenesView(dir), failed: (r && r.failed) || [] };
  }

  // ── Claude planning budget ──
  async function planningToken(dir, stage) {
    const st = episode.read(dir);
    const token = st.budgets && st.budgets.anthropic;
    const tryAuth = (t) => { d.broker.authorize(t, 'anthropic', { usd: stage.budgetUsd, what: `${st.title}: ${stage.id}` }); return t; };
    if (token && d.broker.isLive(token, 'anthropic')) {
      try { return tryAuth(token); } catch { /* over the cap: ask again below */ }
    }
    const cap = episode.STAGES.filter((s) => s.kind === 'agent').reduce((a, s) => a + s.budgetUsd, 0);
    const ok = await d.confirm({
      title: 'Spend on Claude?',
      message: `Planning "${st.title}" uses your Anthropic key.`,
      detail: `Up to ${cap} US dollars for bullets, fact-check, deck, script and the slides' own animations. Each run is capped, and only its real cost counts against this budget, so revisions draw on it too. You'll see the cost after each run, and you'll be asked again if it runs low.`,
      button: `Approve up to ${cap} US dollars`,
    });
    if (!ok) return null;
    const tokens = d.broker.approve(estimate([{ rate: 'anthropic_usd', qty: cap, label: 'Claude planning cap' }]), { project: st.title, stage: 'planning', marginPct: 0 });
    st.budgets = { ...(st.budgets || {}), anthropic: tokens.anthropic };
    episode.write(dir, st);
    return tryAuth(tokens.anthropic);
  }

  async function runStage(dir, stageId, feedback = '') {
    dir = guard(dir);
    const stage = episode.STAGES.find((s) => s.id === stageId && s.kind === 'agent');
    if (!stage) throw new Error('That stage isn\'t an agent stage.');
    const st = episode.read(dir);
    if (!episode.canRun(st, stageId)) throw new Error('Approve the earlier stages first.');
    if (running.has(dir) || busy.has(dir)) throw new Error('Something is already running for this episode.');
    const apiKey = d.vault.get('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('Add your Anthropic key in Setup → Keys first.');
    const token = await planningToken(dir, stage);
    if (!token) return { ok: false, cancelled: true };

    const ctrl = new AbortController();
    running.set(dir, ctrl);
    episode.setStage(dir, stageId, { status: 'running', feedback: feedback || null });
    const emit = (ev) => d.send('agent:event', { dir, stage: stageId, ...ev, text: ev.text ? d.redact(ev.text) : ev.text, detail: ev.detail ? d.redact(ev.detail) : ev.detail });
    try {
      const sdk = await d.loadSdk();
      const res = await agents.runStage({
        stage, projectDir: dir, engineRoot: d.engineRoot, feedback, onEvent: emit, signal: ctrl.signal, vars: stageVars(st),
      }, {
        sdk, z: d.loadZod ? await d.loadZod() : null, library: d.libraryFor ? d.libraryFor(dir) : undefined,
        apiKey, toolEnvPath: d.toolEnv().PATH, configDir: d.configDir, executable: d.executable,
        tools: {
          checkDeck: (p) => stagetools.checkDeck(p, { pipeline: d.pipeline, chrome: d.chrome() }),
          scriptStats: async (p) => stagetools.scriptStats(p, { minutes: st.intake.minutes }),
        },
      });
      d.broker.record(token, { what: `${st.title}: ${stageId}`, costUsd: res.costUsd, turns: res.turns, ok: res.ok });
      // The stage reserved its whole cap; once the real cost is known, the rest goes back to the planning budget.
      if (res.costKnown) d.broker.settle(token, { authorizedUsd: stage.budgetUsd, actualUsd: res.costUsd, what: `${st.title}: ${stageId}` });
      episode.addCost(dir, { provider: 'anthropic', stage: stageId, usd: res.costUsd, estimate: true });
      let qa = null;
      if (res.ok && stageId === 'deck' && d.chrome()) {
        qa = layoutqa.summarize(await layoutqa.checkDeck({ deckDir: path.join(dir, 'presentation', 'deck', 'project'), chrome: d.chrome() }));
        await d.pipeline.render(dir, {});
      }
      const error = res.error ? d.redact(String(res.error)).slice(0, 400) : null;
      episode.setStage(dir, stageId, { status: res.ok ? 'review' : 'error', sessionId: res.sessionId, report: res.report ? d.redact(res.report).slice(0, 8000) : null, error, costUsd: res.costUsd, qa });
      return { ok: res.ok, error, costUsd: res.costUsd };
    } catch (e) {
      const error = d.redact(String(e && e.message ? e.message : e)).slice(0, 400);
      episode.setStage(dir, stageId, { status: 'error', error });
      return { ok: false, error, costUsd: 0 };
    } finally {
      running.delete(dir);
    }
  }

  function cancel(dir) { const c = running.get(path.resolve(dir)); if (c) c.abort(); return Boolean(c); }

  // ── Animate: the animator crew (animators.js) ──

  /** The Animate step: the marked slides, their animations, and the last run's records. */
  function animateView(dir, st) {
    return { slides: animators.view(dir, st.animations || {}), perSlideUsd: animators.PER_SLIDE_USD, available: Boolean(d.animators && d.animators.available()) };
  }

  /** One slide's record of its last animator run (by slide id), written as the run moves on. */
  function noteAnimation(dir, id, patch) {
    const st = episode.read(dir);
    const all = st.animations || {};
    st.animations = { ...all, [id]: { ...(all[id] || {}), ...patch, at: new Date().toISOString() } };
    episode.write(dir, st);
  }

  /**
   * Run the animator crew: one session per marked slide (or only slide `slide`), a few at a time. Each session's cap is
   * reserved from the episode's Claude planning budget before any of them starts, so any question about money comes
   * first; then only its real cost counts. Ends in review when an animation was made, else error.
   */
  async function animate(dir, { slide = null, feedback = '' } = {}) {
    dir = guard(dir);
    const st = episode.read(dir);
    if (!episode.canRun(st, 'animate')) throw new Error('Approve the script first.');
    if (running.has(dir) || busy.has(dir)) throw new Error('Something is already running for this episode.');
    if (!d.animators || !d.animators.available()) throw new Error('Animations need HyperFrames (Setup → Tools).');
    const apiKey = d.vault.get('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('Add your Anthropic key in Setup → Keys first.');
    const marked = animators.marked(dir).filter((s) => slide == null || s.n === Number(slide));
    if (!marked.length) throw new Error(slide == null ? 'No slide is marked for an animation of its own.' : 'That slide isn\'t marked for an animation.');
    const slides = marked.filter((s) => animators.owner(dir, s.n) !== 'user');
    if (!slides.length) throw new Error('Those slides have animations of your own, so they stay as they are.');
    const stage = episode.STAGES.find((s) => s.id === 'animate');
    const jobs = [];
    for (const s of slides) {
      const token = await planningToken(dir, stage);
      if (!token) break;
      jobs.push({ s, token });
    }
    if (!jobs.length) return { ok: false, cancelled: true };

    const ctrl = new AbortController();
    running.set(dir, ctrl);
    const what = (s) => `${st.title}: animate slide ${s.n}`;
    const results = [];
    try {
      const moved = animators.sync(dir);
      episode.setStage(dir, 'animate', { status: 'running', feedback: feedback || null, error: null });
      for (const { s } of jobs) noteAnimation(dir, s.id, { n: s.n, status: 'running', error: null, note: null, costUsd: null });
      for (const text of moved) d.send('agent:event', { dir, stage: 'animate', kind: 'note', text });
      const sdk = await d.loadSdk();
      const z = d.loadZod ? await d.loadZod() : null;
      const queue = [...jobs];
      const worker = async () => {
        for (let job = queue.shift(); job; job = queue.shift()) {
          const { s, token } = job;
          if (ctrl.signal.aborted) {
            d.broker.settle(token, { authorizedUsd: stage.budgetUsd, actualUsd: 0, what: what(s) });
            noteAnimation(dir, s.id, { status: 'error', error: 'Stopped.' });
            results.push({ n: s.n, ok: false, costUsd: 0, error: 'Stopped.' });
            continue;
          }
          const emit = (ev) => d.send('agent:event', { dir, stage: 'animate', slide: s.n, ...ev, text: ev.text ? d.redact(ev.text) : ev.text, detail: ev.detail ? d.redact(ev.detail) : ev.detail });
          const tools = d.animators.tools(dir, s, ctrl.signal);
          let res;
          try {
            res = await animators.runAnimator({ slide: s, projectDir: dir, engineRoot: d.engineRoot, title: st.title, feedback, onEvent: emit, signal: ctrl.signal,
              model: stage.model, budgetUsd: stage.budgetUsd }, { sdk, z, apiKey, toolEnvPath: d.toolEnv().PATH, configDir: d.configDir, executable: d.executable, tools });
          } catch (e) {
            res = { ok: false, costUsd: 0, costKnown: false, error: String(e && e.message ? e.message : e) };
          }
          d.broker.record(token, { what: what(s), costUsd: res.costUsd, turns: res.turns, ok: res.ok });
          // Each session reserved its whole cap; once its real cost is known, the rest goes back to the planning budget.
          if (res.costKnown) d.broker.settle(token, { authorizedUsd: stage.budgetUsd, actualUsd: res.costUsd, what: what(s) });
          episode.addCost(dir, { provider: 'anthropic', stage: 'animate', slide: s.n, usd: res.costUsd, estimate: true });
          const done = await animators.finish(dir, s, res, tools, d.animators.probe).catch((e) => ({ ok: false, error: String(e && e.message ? e.message : e) }));
          const error = done.error ? d.redact(String(done.error)).slice(0, 400) : null;
          noteAnimation(dir, s.id, { status: done.ok ? 'review' : 'error', error, note: done.note ? d.redact(done.note).slice(0, 400) : null,
            costUsd: res.costUsd, sessionId: res.sessionId || null, report: res.report ? d.redact(res.report).slice(0, 8000) : null });
          d.send('agent:event', { dir, stage: 'animate', slide: s.n, kind: 'done', ok: done.ok }); // its card can show it now
          results.push({ n: s.n, ok: done.ok, costUsd: res.costUsd, error });
        }
      };
      await Promise.all(Array.from({ length: Math.min(animators.PARALLEL, jobs.length) }, worker));
      const costUsd = Math.round(results.reduce((a, r) => a + (r.costUsd || 0), 0) * 100) / 100;
      const made = results.some((r) => r.ok);
      const error = made ? null : ctrl.signal.aborted ? 'Stopped.' : 'No animation was made.';
      episode.setStage(dir, 'animate', { status: made ? 'review' : 'error', error, costUsd });
      return { ok: made, error, costUsd, slides: results.sort((a, b) => a.n - b.n) };
    } catch (e) {
      const error = d.redact(String(e && e.message ? e.message : e)).slice(0, 400);
      for (const { s, token } of jobs) {
        if (results.some((r) => r.n === s.n)) continue;
        d.broker.settle(token, { authorizedUsd: stage.budgetUsd, actualUsd: 0, what: what(s) });
        noteAnimation(dir, s.id, { status: 'error', error });
      }
      episode.setStage(dir, 'animate', { status: 'error', error });
      return { ok: false, error, costUsd: 0 };
    } finally {
      running.delete(dir);
    }
  }

  /** Approve a stage's result. A stale agent stage (an earlier stage changed) can be kept as it is. */
  function approve(dir, stageId) {
    dir = guard(dir);
    const st = episode.read(dir);
    const s = episode.STAGES.find((x) => x.id === stageId);
    if (!s || !st.stages[stageId]) throw new Error('Unknown stage.');
    const status = st.stages[stageId].status;
    if (stageId === 'refine') {
      // Optional: with nothing to apply it's simply approved; else once the add-ons or the tightening are applied.
      if (!episode.canRun(st, 'refine')) throw new Error('Approve the film first.');
      if (status === 'running') throw new Error('Refine is still applying.');
      if (status === 'approved') throw new Error('There\'s nothing to approve yet.');
      if (refineWork(st) && !refinedOutputs(dir, st)) throw new Error((st.addons || []).length ? 'Apply the add-ons first.' : 'Apply the tightening first.');
      return episode.setStage(dir, 'refine', { status: 'approved', skipped: !refineWork(st) });
    }
    if (stageId === 'animate') {
      // Whatever the animators made is kept (a slide without an animation keeps its builds); with nothing run, skipped.
      if (!episode.canRun(st, 'animate')) throw new Error('Approve the script first.');
      if (status === 'running' && running.has(dir)) throw new Error('The animators are still working.'); // else interrupted: keep what's there
      if (status === 'approved') throw new Error('There\'s nothing to approve yet.');
      const made = animators.view(dir).some((a) => a.made);
      const next = episode.setStage(dir, 'animate', { status: 'approved', skipped: !made });
      if (made && d.keep) Promise.resolve().then(() => d.keep(dir, 'animate')).catch(() => {});
      return next;
    }
    if (stageId === 'scenes') {
      // Optional: approve any time after the script, with what's made; the rest keep their placeholders.
      if (!episode.canRun(st, 'scenes')) throw new Error(episode.canRun(st, 'animate') ? 'Approve the animations first (or skip them).' : 'Approve the script first.');
      if (status === 'approved') throw new Error('There\'s nothing to approve yet.');
      if (scenesBusy(dir)) throw new Error('Wait for the stills and shots on their way.');
      const made = scenesMod.view(dir).pieces.filter((p) => p.clip).length;
      const done = episode.setStage(dir, 'scenes', { status: 'approved', made, skipped: !made });
      if (made && d.keep) Promise.resolve().then(() => d.keep(dir, 'scenes')).catch(() => {}); // the cut scenes, to the Library
      return done;
    }
    const ok = status === 'review' || (status === 'stale' && s.kind === 'agent');
    if (!ok) throw new Error('There\'s nothing to approve yet.');
    if (!episode.canRun(st, stageId)) throw new Error('Approve the earlier stages first.');
    let next = episode.setStage(dir, stageId, { status: 'approved' });
    // With no cartoon or cut scene in the deck, there's nothing for Scenes: it's approved on the way.
    if (stageId === 'script' && next.stages.scenes.status !== 'approved' && !scenesMod.hasAny(dir)) next = episode.setStage(dir, 'scenes', { status: 'approved', skipped: true });
    // What the stage made goes to the Library too, for later episodes (in the background; never blocks approval).
    if (d.keep) Promise.resolve().then(() => d.keep(dir, stageId)).catch(() => {});
    return next;
  }

  function saveFile(dir, which, text) {
    dir = guard(dir);
    if (!EDITABLE.has(which) || typeof text !== 'string' || text.length > 400000) throw new Error('That file can\'t be edited here.');
    fs.writeFileSync(path.join(dir, 'presentation', FILES[which]), text);
    // Editing an approved file re-opens what was built on it.
    const st = episode.read(dir);
    const later = episode.STAGE_IDS.slice(episode.STAGE_IDS.indexOf(which === 'bullets' ? 'bullets' : 'script') + 1);
    for (const id of later) if (st.stages[id].status === 'approved') st.stages[id].status = 'stale';
    episode.write(dir, st);
    return open(dir);
  }

  // ── the user's calls for the deck ──
  const callEditable = (st) => st.stages.deck.status !== 'running';
  function addCall(dir, { module, slide = null, ask = '' } = {}) {
    dir = guard(dir);
    if (!modules.byId(module)) throw new Error('Pick one of the seven modules.');
    const text = String(ask || '').trim();
    if (!text) throw new Error('Say what you want, for example "animate the chart in this photo".');
    if (text.length > 2000) throw new Error('Keep the call under 2,000 characters.');
    const st = episode.read(dir);
    if (!callEditable(st)) throw new Error('The deck crew is working. Add calls when it\'s done.');
    const n = Number(slide);
    const calls = st.calls || [];
    const id = `c${calls.reduce((a, c) => Math.max(a, Number(String(c.id).slice(1)) || 0), 0) + 1}`;
    st.calls = [...calls, { id, module, slide: Number.isInteger(n) && n > 0 ? n : null, ask: text, attachments: [], at: new Date().toISOString() }];
    episode.write(dir, st);
    return open(dir);
  }

  function removeCall(dir, id) {
    dir = guard(dir);
    const st = episode.read(dir);
    if (!callEditable(st)) throw new Error('The deck crew is working. Change calls when it\'s done.');
    const call = (st.calls || []).find((c) => c.id === id);
    if (!call) throw new Error('That call is already gone.');
    for (const a of call.attachments || []) for (const rel of [a.path, a.poster]) if (rel) fs.rmSync(path.join(dir, 'presentation', rel), { force: true });
    st.calls = st.calls.filter((c) => c.id !== id);
    episode.write(dir, st);
    return open(dir);
  }

  const run = (cmd, args) => new Promise((resolve) => {
    const p = spawn(cmd, args, { env: { ...process.env, PATH: d.toolEnv().PATH }, stdio: 'ignore' });
    p.on('error', () => resolve(1));
    p.on('close', resolve);
  });

  /** Copy files the user picked (in a native dialog) into the episode, for one call. */
  async function attachFiles(dir, id, paths) {
    dir = guard(dir);
    const st = episode.read(dir);
    if (!callEditable(st)) throw new Error('The deck crew is working. Attach files when it\'s done.');
    const call = (st.calls || []).find((c) => c.id === id);
    if (!call) throw new Error('That call is gone.');
    call.attachments = [...(call.attachments || []), ...(await copyIn(dir, paths, path.join('assets', 'calls'), id))];
    episode.write(dir, st);
    return open(dir);
  }

  /**
   * Copy files into the episode's presentation/<rel>/ as <prefix>-<name>, after checking every one first (so a bad
   * file can't leave half a set behind). iPhone photos (HEIC) become JPEGs the crew can open; a clip gets a poster
   * frame. Returns [{ kind, name, path, poster? }] with paths relative to presentation/.
   */
  async function copyIn(dir, paths, rel, prefix) {
    const abs = path.join(dir, 'presentation', rel);
    fs.mkdirSync(abs, { recursive: true });
    const picked = (paths || []).map((src) => {
      const stat = fs.statSync(src);
      const kind = ATTACH.image.test(src) ? 'image' : ATTACH.video.test(src) ? 'video' : ATTACH.doc.test(src) ? 'doc' : null;
      if (!kind || !stat.isFile()) throw new Error(`${path.basename(src)}: attach a photo, a video clip, or a document (PDF, text, Word, web page).`);
      if (stat.size > MAX_ATTACH) throw new Error(`${path.basename(src)} is over 500 MB.`);
      return { src, kind };
    });
    const out = [];
    for (const { src, kind } of picked) {
      const safe = path.basename(src).normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/^-+/, '').slice(-80) || 'file';
      let name = `${prefix}-${safe}`;
      if (/\.(heic|heif)$/i.test(src)) {
        name = name.replace(/\.(heic|heif)$/i, '.jpg');
        if (await run('sips', ['-s', 'format', 'jpeg', src, '--out', path.join(abs, name)]) !== 0) throw new Error(`${path.basename(src)}: couldn't convert this photo. Try a JPEG or PNG.`);
      } else {
        fs.copyFileSync(src, path.join(abs, name));
      }
      const a = { kind, name: path.basename(src), path: path.join(rel, name) };
      if (kind === 'video') {
        const poster = `${name.replace(/\.[^.]+$/, '')}-poster.jpg`;
        if (await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '1', '-i', path.join(abs, name), '-frames:v', '1', '-q:v', '3', path.join(abs, poster)]) === 0) a.poster = path.join(rel, poster);
      }
      out.push(a);
    }
    return out;
  }

  function addCallLink(dir, id, url) {
    dir = guard(dir);
    let u;
    try { u = new URL(String(url || '').trim()); } catch { throw new Error('That doesn\'t look like a link.'); }
    if (!/^https?:$/.test(u.protocol)) throw new Error('Only web links (http or https).');
    const st = episode.read(dir);
    if (!callEditable(st)) throw new Error('The deck crew is working. Add links when it\'s done.');
    const call = (st.calls || []).find((c) => c.id === id);
    if (!call) throw new Error('That call is gone.');
    call.attachments = [...(call.attachments || []), { kind: 'link', name: u.host.replace(/^www\./, ''), url: u.toString() }];
    episode.write(dir, st);
    return open(dir);
  }

  // ── what filming costs ──

  // FLPT's own media.json entries reset for a new run: no clips (their timing would be wrong), and the cartoons'
  // hidden bubbles (so no avatar clip is ever made or paid for them).
  const resetMedia = (dir) => (d.motion ? d.motion.clear(dir) : motionLib.clearMedia(dir));
  const PIPELINE_CPS = 14.5; // the pipeline's own pace for narration it hasn't synthesized yet (CHARS_PER_SEC)
  // Voice alone is billed by the second at 0.2 cents: a few seconds at least, so any voice still to make is priced (and
  // approved) at a cent or more, never at zero.
  const voiceSeconds = (s) => (s > 0 ? Math.max(5, Math.round(s)) : 0);
  const estimating = new Map(); // dir → the pipeline's estimate under way (a pipeline step waits for it to finish)

  /**
   * The pipeline's own estimate: what filming would make that isn't cached yet (generate_presentation_video.py --final
   * under FLPT_ESTIMATE_ONLY: no keys, no network, nothing generated). Needs the slides rendered. Null when it can't
   * say (no Python, an episode copy that can't be patched, no slides): then the script's estimate stands in.
   */
  async function pipelineEstimate(dir, { signal } = {}) {
    if (!d.pipeline.estimate) return null;
    try {
      if (d.pipeline.patchScripts) await d.pipeline.patchScripts(dir, { signal }); // an episode made before the patch
      motionLib.refreshMedia(dir); // the cartoons' hidden bubbles: their clips are never counted
      const r = await d.pipeline.estimate(dir, { signal });
      return r && r.code === 0 && r.estimate ? r.estimate : null;
    } catch {
      return null;
    }
  }

  /**
   * The filming estimate. With the pipeline's numbers (`piped`): the avatar seconds still to film, and how many clips
   * are already filmed (those cost nothing). Without them, from script.md: the avatar's seconds for every slide it
   * presents. Either way, the slides narrated without the bubble (the Cosmos cartoons) count as voice alone.
   */
  function filmEstimate(dir, piped) {
    let script = '';
    try { script = fs.readFileSync(path.join(dir, 'presentation', 'script.md'), 'utf8'); } catch { /* none yet */ }
    const hidden = new Set(motionLib.noBubbleSlides(dir));
    const cartoons = new Set(motionLib.cosmosSlides(dir));
    const parsed = episode.parseScript(script);
    const per = episode.slideSeconds(parsed);
    const voiceSlides = per.filter((s) => hidden.has(s.n));
    const voiceLabel = voiceSlides.length && voiceSlides.every((s) => cartoons.has(s.n)) ? 'Cartoon narration (voice only)' : 'Voice only, no avatar';
    const minutes = (s) => Math.round(s / 6) / 10;
    let lines;
    let film;
    if (piped) {
      const avatar = Math.round(piped.clipSeconds);
      const filmed = piped.clipsTotal - piped.clips;
      const label = !piped.clips ? (piped.clipsTotal ? `Your avatar: all ${piped.clipsTotal} clips already filmed` : 'Your avatar: no clips to film')
        : `Your avatar for about ${minutes(avatar)} min${filmed ? ` (${filmed} of ${piped.clipsTotal} clips already filmed)` : ' of narration'}`;
      lines = [{ rate: 'heygen_avatar_s', qty: avatar, label }];
      const voice = voiceSeconds(piped.voiceChars / PIPELINE_CPS);
      if (voice) lines.push({ rate: 'heygen_tts_s', qty: voice, label: voiceLabel });
      // Nothing to pay at all: the script has narration, and every bit of it is already filmed and voiced.
      const nothing = !piped.clips && !piped.chars && parsed.some((s) => s.narration.replace(/\[[^\]]*\]/g, '').trim());
      film = { source: 'pipeline', clips: piped.clips, filmed, total: piped.clipsTotal, nothing };
    } else {
      const avatar = Math.round(per.filter((s) => !hidden.has(s.n)).reduce((a, s) => a + s.seconds, 0));
      const voice = voiceSeconds(voiceSlides.reduce((a, s) => a + s.seconds, 0));
      lines = [{ rate: 'heygen_avatar_s', qty: avatar, label: `Your avatar for about ${minutes(avatar)} min of narration` }];
      if (voice) lines.push({ rate: 'heygen_tts_s', qty: voice, label: voiceLabel });
      film = { source: 'script' };
    }
    return { ...estimate(lines), film };
  }

  /**
   * What filming would cost now: the pipeline's count of what isn't filmed yet when it can give one, else the script's.
   * Never alongside a pipeline step for this episode (then it's the script's estimate).
   */
  async function spendEstimate(dir) {
    dir = guard(dir);
    if (running.has(dir) || busy.has(dir)) return filmEstimate(dir, null);
    if (!estimating.has(dir)) {
      estimating.set(dir, pipelineEstimate(dir).finally(() => estimating.delete(dir)));
    }
    return filmEstimate(dir, await estimating.get(dir));
  }

  /** The approval dialog's line: the amount, and what it pays for. */
  function spendDetail(est) {
    const usd = est.byProvider.heygen ? est.byProvider.heygen.usd : 0;
    const voice = est.lines.some((l) => l.rate === 'heygen_tts_s' && l.qty > 0);
    const f = est.film || {};
    const clips = f.source === 'pipeline' && f.filmed ? ` ${f.clips} of ${f.total} avatar clips to film: the other ${f.filmed} are already filmed.` : '';
    return `About ${usd.toFixed(2)} US dollars (4.1 cents a second of avatar video${voice ? ' and 0.2 cents a second of voice alone' : ''}, plus up to 15 % margin).${clips} Nothing else will be charged.`;
  }

  async function approveSpend(dir) {
    dir = guard(dir);
    const st = scenesOnTheWay(dir, episode.read(dir));
    if (!episode.canRun(st, 'spend')) throw new Error(spendBlocked(st));
    const old = st.budgets && st.budgets.heygen;
    if (old && d.broker.isLive(old, 'heygen')) {
      if (st.stages.spend.status === 'approved') return { ok: true, usd: st.stages.spend.usd, already: true };
      d.broker.close(old); // the script changed since: that approval was for a different length
    }
    const est = await spendEstimate(dir);
    const usd = est.byProvider.heygen ? est.byProvider.heygen.usd : 0;
    if (!usd) {
      if (!est.film.nothing) throw new Error('The script has no narration to film.');
      // Every clip is already filmed: nothing to pay, so nothing to approve. Filming puts it together from the cache.
      const now = episode.read(dir);
      now.stages.spend = { status: 'approved', at: new Date().toISOString(), usd: 0, free: true };
      episode.write(dir, now);
      return { ok: true, usd: 0, free: true };
    }
    const ok = await d.confirm({ title: 'Spend money on HeyGen?', message: `Film "${st.title}" with your avatar?`,
      detail: spendDetail(est), button: `Approve ${usd.toFixed(2)} US dollars` });
    if (!ok) return { ok: false, cancelled: true };
    const tokens = d.broker.approve(est, { project: st.title, stage: 'film' });
    const now = episode.read(dir);
    now.budgets = { ...(now.budgets || {}), heygen: tokens.heygen };
    now.stages.spend = { status: 'approved', at: new Date().toISOString(), usd };
    episode.write(dir, now);
    return { ok: true, usd };
  }

  /**
   * The moving slides for a run that has just made its narration ('draft' or 'final'; see motion.js). Never fails the
   * run: a slide that doesn't render stays still, and the log says why. Returns the numbers of the slides that move.
   */
  async function moveSlides(dir, which, onLine, signal) {
    if (!d.motion) return [];
    try {
      for (const note of animators.sync(dir)) onLine(note); // the animators' slides follow the deck's order
      const hyperframes = d.motion.available();
      if (!hyperframes) {
        const p = d.motion.plan(dir);
        if (p.slides.length || motionLib.bespokeSlides(dir).length) onLine('Moving slides need HyperFrames (Setup → Tools), so the slides stay still for now.');
        if (!(p.insets || []).length && !(p.cartoons || []).length) return []; // video insets and cartoons need only ffmpeg: they still play
      }
      const r = await d.motion.render(dir, which, { onLine, signal, hyperframes });
      animators.noteClips(dir, r.rendered);
      for (const p of r.problems) onLine(`! ${p}`);
      return r.rendered;
    } catch (e) {
      onLine(`! Moving slides: ${d.redact(String(e && e.message ? e.message : e)).slice(0, 300)}`);
      d.motion.clear(dir);
      return [];
    }
  }

  /**
   * Scenes is optional: with nothing planned for it, a step that needs it approved approves it on the way (FLPT for
   * Claude Code relies on this). With cartoons or cut scenes planned, the user decides there. Returns the record.
   */
  function scenesOnTheWay(dir, st) {
    if (episode.canRun(st, 'spend') || !episode.canRun(st, 'scenes') || st.stages.scenes.status === 'approved') return st;
    if (scenesMod.hasAny(dir)) throw new Error('Approve Scenes first: make the cartoons and cut scenes there, or go on without them.');
    return episode.setStage(dir, 'scenes', { status: 'approved', skipped: true });
  }

  /** Free: render the slides and narrate them with the Mac's own voice, to check timing before paying for filming. */
  async function draft(dir, onLine, signal) {
    dir = guard(dir);
    const st = scenesOnTheWay(dir, episode.read(dir));
    if (!episode.canRun(st, 'spend')) throw new Error(spendBlocked(st));
    return exclusive(dir, async () => {
      const r1 = await d.pipeline.render(dir, { onLine, signal });
      if (r1.code !== 0) return { ok: false, error: 'The slides didn\'t render.', lines: r1.lines.slice(-10) };
      // First the voice (its timing is what the moving slides follow), then the draft again with them in place.
      resetMedia(dir);
      let r = await d.pipeline.draft(dir, { onLine, signal });
      const out = d.pipeline.draftOutput(dir);
      let ok = r.code === 0 && exists(out);
      if (ok && !(signal && signal.aborted) && (await moveSlides(dir, 'draft', onLine, signal)).length) {
        onLine('Putting the draft together with its moving slides…');
        r = await d.pipeline.draft(dir, { onLine, signal });
        ok = r.code === 0 && exists(out);
        if (!ok && !(signal && signal.aborted)) { // keep a draft either way: without the moving slides
          onLine('! The moving slides didn\'t fit in, so this draft has still slides.');
          d.motion.clear(dir);
          r = await d.pipeline.draft(dir, { onLine, signal });
          ok = r.code === 0 && exists(out);
        }
      }
      return { ok, video: ok ? out : null, error: ok ? null : 'The draft didn\'t finish. See the log.', lines: r.lines.slice(-10) };
    });
  }

  /**
   * After filming: time the moving slides to the real voice, then put the film back together from the cache. That
   * run has no keys and no network, so it can't spend anything. If it doesn't work out, the film keeps its stills.
   */
  async function addMotionToFilm(dir, onLine, signal) {
    const moving = await moveSlides(dir, 'final', onLine, signal);
    if (!moving.length || (signal && signal.aborted)) { if (d.motion) d.motion.clear(dir); return 0; }
    const outs = [d.pipeline.finalOutput(dir), d.pipeline.editMasterOutput(dir)].filter(exists);
    for (const f of outs) fs.renameSync(f, `${f}.stills`);
    onLine('Putting the film together with its moving slides (from what was already filmed: nothing more is spent)…');
    await d.pipeline.patchScripts(dir, { signal });
    const r = await d.pipeline.recompose(dir, { onLine, signal });
    const ok = r.code === 0 && exists(d.pipeline.finalOutput(dir));
    for (const f of outs) {
      if (ok) { fs.rmSync(`${f}.stills`, { force: true }); continue; }
      fs.rmSync(f, { force: true });
      fs.renameSync(`${f}.stills`, f);
    }
    if (!ok) {
      d.motion.clear(dir);
      onLine('! The moving slides couldn\'t be added, so the film keeps its still slides.');
      return 0;
    }
    return moving.length;
  }

  async function film(dir, onLine = () => {}, signal) {
    dir = guard(dir);
    const st = episode.read(dir);
    if (!episode.canRun(st, 'film')) throw new Error('Approve the spend first.');
    const token = st.budgets && st.budgets.heygen;
    const free = st.stages.spend.free === true; // nothing to pay: every clip was already filmed
    if (!free && (!token || !d.broker.isLive(token, 'heygen'))) throw new Error('The HeyGen budget isn\'t approved (or was already used). Approve the spend again.');
    return exclusive(dir, async () => {
      episode.setStage(dir, 'film', { status: 'running', error: null });
      try {
        const r1 = await d.pipeline.render(dir, { onLine, signal });
        if (r1.code !== 0) { episode.setStage(dir, 'film', { status: 'error', error: 'The slides didn\'t render.' }); return { ok: false, lines: r1.lines.slice(-10) }; }
        // Filmed with still slides (the moving ones are timed to this voice next), and the cartoons without the bubble.
        resetMedia(dir);
        let r;
        if (free) {
          // Put together from what was already filmed, with no keys and the network blocked (FLPT_CACHED_ONLY): it
          // stops if anything isn't filmed after all. Like a budget, it's good for one run.
          episode.setStage(dir, 'spend', { free: false });
          onLine('Nothing to pay: putting the film together from what was already filmed…');
          await d.pipeline.patchScripts(dir, { signal });
          r = await d.pipeline.recompose(dir, { onLine, signal });
        } else {
          // Authorised against what filming costs now that the slides are rendered: only what isn't filmed yet.
          const est = filmEstimate(dir, await pipelineEstimate(dir, { signal }));
          if (est.film.source === 'pipeline') onLine(`To film: ${est.film.clips} of ${est.film.total} avatar clips (the rest are already filmed).`);
          d.broker.authorize(token, 'heygen', { usd: est.byProvider.heygen ? est.byProvider.heygen.usd : 0, what: `${st.title}: film` });
          try {
            r = await d.pipeline.final(dir, token, { onLine, signal });
          } finally {
            // One approval, one filming run: whatever happened, the next attempt needs a fresh approval.
            d.broker.record(token, { what: `${st.title}: film`, code: r ? r.code : null });
            d.broker.close(token);
          }
        }
        const ok = r.code === 0 && exists(d.pipeline.finalOutput(dir));
        const moving = ok ? await addMotionToFilm(dir, onLine, signal) : 0;
        const error = ok ? null : signal && signal.aborted ? 'Stopped.'
          : free ? 'It couldn\'t be put together from what was already filmed, so filming needs an approval. Nothing was spent.' : 'Filming didn\'t finish. See the log.';
        episode.setStage(dir, 'film', { status: ok ? 'review' : 'error', movingSlides: moving, error });
        return { ok, video: ok ? d.pipeline.finalOutput(dir) : null, lines: r.lines.slice(-12) };
      } catch (e) {
        episode.setStage(dir, 'film', { status: 'error', error: d.redact(String(e.message || e)).slice(0, 400) });
        throw e;
      }
    });
  }

  // ── what Deliver hands an editor besides the video ──
  const methodScript = (name) => path.join(d.engineRoot || '', 'skills', 'avatar-presentation', 'scripts', 'video', name);
  /** A Python for the method's standard-library scripts (loudmatch.py, slack_pack.py): the episode's, else the app's. */
  async function stdPython(dir) {
    const p = d.pipeline.projectPython ? d.pipeline.projectPython(dir) : null;
    if (p && exists(p)) return p;
    return d.basePython ? d.basePython() : null;
  }

  /** The deck's video insets, with when each played in the film (the motion engine's record; null if not this film's). */
  function insetsOf(dir, film) {
    const which = film && film.draft ? 'draft' : 'final';
    return motionLib.insetSlides(dir).map((s) => ({ n: s.n, ...motionLib.readInset(dir, s.inset), played: motionLib.insetPlayed(dir, s.n) })).filter((i) => !i.problem)
      .map(({ played, ...i }) => ({ ...i, at: played && played.which === which ? played.at : null, seconds: played && played.which === which ? played.seconds : null }));
  }

  /** The film's cut scenes: { id, title, file, sound, placeholder }, their videos found the pipeline's way (media.json). */
  function cutscenesOf(dir, film) {
    const pres = path.join(dir, 'presentation');
    const entries = (readJson(path.join(pres, 'media.json')) || {}).cutscenes;
    return ((film && film.cutscenes) || []).map((c) => {
      const e = (Array.isArray(entries) ? entries : []).find((x) => x && String(x.id) === String(c.id)) || {};
      const file = path.resolve(pres, typeof e.video === 'string' ? e.video : `media/cutscene_${c.id}.mp4`);
      return { id: c.id, title: c.title || c.label || '', file: !c.placeholder && file.startsWith(pres + path.sep) && exists(file) ? file : null,
        sound: e.audio === 'mute' ? 'muted' : 'its own', placeholder: Boolean(c.placeholder) };
    });
  }

  async function deliver(dir, onLine = () => {}, signal) {
    dir = guard(dir);
    let st = episode.read(dir);
    if (!episode.canRun(st, 'deliver')) {
      // Refine is optional: with nothing to apply, delivering approves it on the way (FLPT for Claude Code relies on this).
      if (!episode.canRun(st, 'refine')) throw new Error('Approve the film first.');
      if (refineWork(st) || refineBusy(st)) throw new Error((st.addons || []).length ? 'Apply and approve the add-ons first (Refine).' : 'Apply and approve the tightening first (Refine).');
      st = episode.setStage(dir, 'refine', { status: 'approved', skipped: true });
    }
    // What Refine made when there's anything to apply (it must be current), else the film's own.
    const refined = refinedOutputs(dir, st);
    if (refineWork(st) && !refined) throw new Error(`The ${(st.addons || []).length ? 'refined' : 'tightened'} video is out of date: apply ${(st.addons || []).length ? 'the add-ons' : 'it'} again (Refine).`);
    const video = refined ? refined.video : d.pipeline.finalOutput(dir);
    const master = refined ? refined.master : d.pipeline.editMasterOutput(dir);
    const slug = episode.slugify(st.title);
    return exclusive(dir, async () => {
      episode.setStage(dir, 'deliver', { status: 'running', error: null });
      try {
        const w = await d.pipeline.web(dir, { onLine, signal, source: refined ? refined.video : null });
        if (w.code === 0 && !writePlayerConfig(dir, d.pipeline.finalOutput(dir))) onLine('The player page keeps your own titles (player_config.json).');
        const p = w.code === 0 ? await d.pipeline.player(dir, { onLine, signal }) : w;
        const out = path.join(d.settings.read().deliverablesDir, slug);
        fs.mkdirSync(out, { recursive: true });
        const copies = [[video, 'presentation.mp4'], [master, `${slug} (for CapCut).mov`],
          [path.join(dir, 'presentation', 'script.md'), 'script.md']];
        for (const [src, name] of copies) if (exists(src)) fs.copyFileSync(src, path.join(out, name));
        // CC BY music is credited, with what was done to it.
        const credits = refined ? refineMod.musicCredits(st.addons, st.title) : null;
        if (credits) fs.writeFileSync(path.join(out, 'music-credits.txt'), credits);
        else fs.rmSync(path.join(out, 'music-credits.txt'), { force: true });
        const playerDir = path.join(dir, 'presentation', 'player');
        if (p.code === 0 && exists(playerDir)) fs.cpSync(playerDir, path.join(out, 'player'), { recursive: true });

        // The extras, levelled (extras/), and the clip guide: every slot's timecodes in what was just delivered.
        const pres = path.join(dir, 'presentation');
        const o = refineMod.outputs(dir);
        const film = readJson(o.filmTimeline);
        const insets = insetsOf(dir, film);
        const cutscenes = cutscenesOf(dir, film);
        const items = extras.collect({ pres, addons: st.addons || [], insets, cutscenes });
        let lev = { files: [], bySrc: {}, notes: [] };
        const python = items.length ? await stdPython(dir) : null;
        if (items.length && !python) onLine('! The extras weren\'t levelled: Python isn\'t set up (Setup → Tools).');
        else {
          try {
            lev = await extras.levelExtras({ items, out: path.join(out, 'extras'), stage: path.join(pres, 'refine', 'extras'), python, script: methodScript('loudmatch.py'),
              env: toolEnvFor(), signal, onLine });
            for (const n of lev.notes) onLine(`! ${n}`);
          } catch (e) {
            if (signal && signal.aborted) throw e;
            onLine(`! The extras weren't levelled: ${d.redact(String(e.message || e)).slice(0, 300)}`);
          }
        }
        const tk = tightenKey(st);
        const slots = film ? extras.clipSlots({ film, tight: refined && tk !== 'off' ? readJson(o.tightTimeline) : null, refined: refined && (st.addons || []).length ? readJson(o.timeline) : null,
          insets, cutscenes, addons: st.addons || [], files: lev.bySrc, pres }) : [];
        const length = (readJson(refined ? refined.timeline : o.filmTimeline) || {}).total_duration || 0;
        const guide = extras.clipGuide({ title: st.title, master: `${slug} (for CapCut).mov`, seconds: length, slots, levelled: lev.files.length > 0 });
        if (guide) fs.writeFileSync(path.join(out, 'CAPCUT_CLIP_GUIDE.md'), guide);
        else fs.rmSync(path.join(out, 'CAPCUT_CLIP_GUIDE.md'), { force: true });

        const slack = st.stages.deliver.slack && (st.stages.deliver.slack.files || []).every((f) => exists(path.join(out, f))) ? st.stages.deliver.slack : null;
        episode.setStage(dir, 'deliver', { status: 'approved', folder: out, playerOk: p.code === 0, refined: Boolean(refined), tightened: Boolean(refined) && tk !== 'off',
          extras: lev.files.length, guide: Boolean(guide), slack });
        if (d.keep) Promise.resolve().then(() => d.keep(dir, 'deliver', { finalVideo: video })).catch(() => {});
        return { ok: true, folder: out, playerOk: p.code === 0, refined: Boolean(refined), extras: lev.files, guide: Boolean(guide), lines: p.lines ? p.lines.slice(-8) : [] };
      } catch (e) {
        episode.setStage(dir, 'deliver', { status: 'error', error: d.redact(String(e.message || e)).slice(0, 400) });
        throw e;
      }
    });
  }

  /**
   * The Slack pack (the method's slack_pack.py), from the user's own final export after their edit: the (vF), the
   * 1.25× cut, the MP3 and the cover, beside the deliverables. Free. The export is only read.
   */
  async function slackPack(dir, file, onLine = () => {}, signal) {
    dir = guard(dir);
    const st = episode.read(dir);
    const folder = st.stages.deliver.folder;
    if (!folder || !fs.existsSync(folder)) throw new Error('Deliver first.');
    const f = typeof file === 'string' && path.isAbsolute(file) ? file : '';
    if (!f || !exists(f) || !/\.(mp4|mov|m4v)$/i.test(f)) throw new Error('That needs your export: an MP4 or a MOV.');
    const python = await stdPython(dir);
    if (!python) throw new Error('Python isn\'t set up yet (Setup → Tools).');
    return exclusive(dir, async () => {
      try {
        const r = await extras.slackPack({ python, script: methodScript('slack_pack.py'), file: f, out: folder, title: episode.slugify(st.title),
          ffprobe: toolsFor().ffprobe, env: toolEnvFor(), signal, onLine });
        if (!r.lengthOk) onLine(`! The 1.25× cut runs ${r.fast} s against ${r.vf} s: not 1/1.25 of it.`);
        for (const l of r.overs) onLine(`! ${l}`);
        episode.setStage(dir, 'deliver', { slack: { files: r.files, from: path.basename(f), lengthOk: r.lengthOk, overs: r.overs.length, at: new Date().toISOString() } });
        return { ok: true, folder, files: r.files, lengthOk: r.lengthOk, overs: r.overs };
      } catch (e) {
        return { ok: false, error: signal && signal.aborted ? 'Stopped.' : d.redact(String(e && e.message ? e.message : e)).slice(0, 400) };
      }
    });
  }

  /** Scenes approved on the way when nothing is planned for it (see scenesOnTheWay); the record. */
  function passScenes(dir) {
    dir = guard(dir);
    return scenesOnTheWay(dir, episode.read(dir));
  }

  return { list, create, open, runStage, cancel, approve, saveFile, spendEstimate, approveSpend, draft, film, deliver, slackPack, inProjects,
    addCall, removeCall, attachFiles, addCallLink, addAddon, removeAddon, setTighten, refine, animate, sceneAction, sceneLanded, assembleScene,
    passScenes };
}

module.exports = { createFlow, stageVars, playerConfig, writePlayerConfig, tightenKey, spendBlocked };
