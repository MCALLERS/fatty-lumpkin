'use strict';
// The episode flow: create → bullets → fact-check → deck → script → animate → scenes → spend → film → refine → deliver.
// Agent stages run through agents.runStage; pipeline stages run the engine's scripts directly. Every paid step goes
// through the broker: Claude planning (the crew and the animators) against an approved planning budget, filming
// against an approved HeyGen budget, and the Scenes step's stills and shots (scenes.js; generate.js makes them) each
// against their own small approval. Animate (animators.js) runs one session per slide the deck marks for an animation
// of its own. Refine tightens the finished film's pauses (tighten.js) and puts add-ons on it (refine.js), with ffmpeg
// alone. The one thing there that costs anything is Scribe, for cutting laughs: cents, through the broker, once per
// film. Deliver hands over the extras too (extras.js): levelled, with a clip guide, and later the Slack pack.
//
// The seam later waves plug into (PLAN §2.2): every app/src/main/ext/*.js extension's hooks are called at fixed points
// here (ext/index.js lists them and their signatures), so new behaviour comes as new files. The Claude planning budget
// is one approval sized from the plan (each crew stage's cap, each slide marked for an animator, and what extensions
// add), worked out here in main and never taken from the page (T12); when it runs low, one dialog asks for the
// shortfall only and the old budget closes (topUpPlanning). Each crew session runs at the broker's sessionCap of what it
// reserved, and any overshoot is booked (T21). Spend records the generated cut scenes it priced; Film refuses, and
// re-opens Spend, when that set changed (T20). A record made by a newer FLPT is refused with one line.
//
// Jazz (W3-03; PLAN §2.8, draft-ux §10.2, decisions.md D13): "Let FLPT play jazz" approves the storyboard (its Claude
// top-up first, approveStoryboard), then playThrough plays on through the deck, the script, Live Motion, the Scenes step
// and the free draft, approving each by ext/jazz.js's rules (`approvedBy: 'jazz'`), and stops at Spend with the draft
// ("<title> · draft ready"). It stops at any failure, at a rule that doesn't hold, at Stop, and once for money: the
// generated Cosmos and cut scenes' combined price at Scenes (with a generation key; Jazz accepts their stills and shots
// as they land). It never films and never pays for anything without the native dialog.
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
const ext = require('./ext'); // flow extensions: ext/*.js and their hooks
const jazzExt = require('./ext/jazz'); // Jazz's rules, who is playing, Generate $ (the extension's own hooks load with the rest)
const provenance = require('./provenance'); // where an episode was made (episode.write stamps it)
const { estimate, sessionCap } = require('./broker');
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
const MAX_LINE_USD = 100; // a planning line an extension adds can't ask for more than this (a sanity bound, in main)
const AMOUNTS = 'FLPT works out every amount itself: none is taken from the page.';
const isPlain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const usd2 = (n) => Math.round(n * 100) / 100;
// The providers Spend can approve a film for (decisions.md, Wave 4 rulings; W4-10); presenter.spendProviders() and
// guestvoice.blockedBy read it. HeyGen (the twin, a cartoon in your HeyGen voice) and a cartoon's or a guest's own
// ElevenLabs or Fish.audio voice, each on its own budget in the one approval (FILM_PAID: what the pipeline's paid film
// run takes, pipeline.js PAID.final); and the FLPT voices (`fish-house`): free to the person, so no budget at all.
const SPEND_PROVIDERS = Object.freeze(['heygen', 'elevenlabs', 'fish', 'fish-house']);
const FILM_PAID = Object.freeze(['heygen', 'elevenlabs', 'fish']);
const PROVIDER_NAMES = Object.freeze({ heygen: 'HeyGen', elevenlabs: 'ElevenLabs', fish: 'Fish.audio' });
// What each voice provider charges, as the approval says it: presenter.js's own rates (the broker's table), in words
const PER_1000 = Object.freeze({ elevenlabs: ['elevenlabs_tts_char', 'characters'], fish: ['fish_tts_byte', 'bytes'] });
function rateWords(p) {
  const [rate, unit] = PER_1000[p];
  const cents = require('./presenter').RATES[rate].usd * 1000 * 100; // (required here: presenter.js reads this file)
  return `${Number(cents.toFixed(3))} cents per 1,000 ${unit} of narration`;
}
/** Money is worked out in main (T12): a caller that hands an entry point anything more than it takes is refused. */
const refuseAmounts = (extra) => { if (extra.some((x) => x !== undefined)) throw new Error(AMOUNTS); };

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
// Why Spend can't open yet: the step before it that's waiting (Scenes, then Live Motion), else the script.
const spendBlocked = (st) => (episode.canRun(st, 'scenes') ? 'Approve Scenes first: make the cartoons and cut scenes there, or go on without them.'
  : episode.canRun(st, 'animate') ? 'Approve Live Motion first (or skip it).' : 'Approve the script first.');

/** What's in the filmed video: its cut scenes (the final timeline), and the Cosmos slides that play a cartoon. */
function filmedMedia(dir, finalOutput) {
  let cutscenes = 0;
  try { cutscenes = (JSON.parse(fs.readFileSync(finalOutput.replace(/\.mp4$/, '.timeline.json'), 'utf8')).cutscenes || []).filter((c) => !c.placeholder).length; } catch { /* not filmed */ }
  let slides = {};
  try { slides = JSON.parse(fs.readFileSync(path.join(dir, 'presentation', 'media.json'), 'utf8')).slides || {}; } catch { /* none */ }
  // A cartoon is a video of its own on a Cosmos slide (FLPT's moving title card isn't one).
  const cartoons = motionLib.cartoonSlides(dir).filter((n) => { const e = slides[String(n)]; return e && e.video && e.note !== motionLib.MOTION_NOTE; }).length;
  return { cutscenes, cartoons };
}

/**
 * Write player/player_config.json from the episode, unless the user has made it their own: FLPT replaces only a
 * missing file, build_player.py's placeholders, or the exact file FLPT wrote last time (its hash is in the record).
 * Returns true when it wrote the file.
 */
function writePlayerConfig(dir, finalOutput, { engineRoot } = {}) {
  const file = path.join(dir, 'presentation', 'player', 'player_config.json');
  const st = episode.read(dir);
  let current = null;
  try { current = fs.readFileSync(file, 'utf8'); } catch { /* none yet */ }
  const placeholder = (() => { try { const j = JSON.parse(current); return Object.keys(PLAYER_PLACEHOLDERS).every((k) => j[k] === PLAYER_PLACEHOLDERS[k]) && Object.keys(j).length === 6; } catch { return false; } })();
  const ours = current == null || placeholder || (st.player && st.player.configSha === sha256(current));
  if (!ours) return false;
  // CC BY music is credited on the player page too, in the same words as music-credits.txt (W2-03 handoff 3)
  let credit = '';
  try { credit = require('./extras').creditNote(require('./interstitials').credits(dir, st.addons || [], { engineRoot }).tracks); } catch { credit = ''; }
  const base = playerConfig(st, filmedMedia(dir, finalOutput));
  const text = `${JSON.stringify({ ...base, media_note: [base.media_note, credit].filter(Boolean).join(' ') }, null, 1)}\n`;
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
  //      side of the Scenes step, in the app; without it the stills and shots can't be made), extensions: [{ id, order,
  //      hooks }] (optional: in place of the ones in ext/, for tests and hosts), extDir (optional: another folder of
  //      them), log(text) (optional: where an extension's notes and load problems go), slideSandbox(dir) (optional: a
  //      sandbox for the deck's slide pictures after the deck crew, flow.js:634; pipeline.render's { writable, hidden }),
  //      caps (optional: what this surface can make, as ext/storyboard.capsFor reads it), layoutCheck(deckDir)
  //      (optional: the deck's layout check in place of layoutqa's with the host's Chrome, for tests and hosts),
  //      liveMotion: { run(dir, { signal }) } (optional: the scene crews for Jazz, when the host can run them;
  //      api/jazz.js gives it otherwise), notify(title, body) (optional: a desktop notification)
  const loaded = Array.isArray(d.extensions) ? ext.from(d.extensions) : ext.load(d.extDir || undefined);
  const log = (text) => { try { if (typeof d.log === 'function') d.log(d.redact ? d.redact(String(text)) : String(text)); } catch { /* nowhere to say it */ } };
  for (const p of loaded.problems) log(`An extension was left out: ${p}`);
  const hooks = ext.createHooks(loaded.extensions, Object.freeze({ d, episode, modules, motion: motionLib, broker: d.broker, send: d.send, confirm: d.confirm, log }));
  // Where the episodes it writes were made (madeWith): this engine, and the toolchain mode Setup has chosen, when it has.
  provenance.configure({ ...(d.engineRoot && path.isAbsolute(d.engineRoot) ? { engineRoot: d.engineRoot } : {}),
    ...(d.settings && 'toolchainMode' in (d.settings.read() || {}) ? { modeOf: () => d.settings.read().toolchainMode } : {}) });
  const hookError = (e) => e instanceof ext.HookError;
  const said = (e) => d.redact(String(e && e.message ? e.message : e)).slice(0, 400);
  /** What the storyboard plans for here (D13): ext/storyboard.capsFor over the host's caps and the vault's status. */
  const planCaps = () => { try { return require('./ext/storyboard').capsFor(d); } catch { return null; } };

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
  /** An episode folder FLPT may work on: inside the projects folder, with a record this FLPT can read (not a newer one). */
  const guard = (dir) => {
    if (!inProjects(dir)) throw new Error('That isn\'t an FLPT episode folder.');
    const why = episode.tooNew(episode.readRaw(path.resolve(dir)));
    if (why) throw new Error(why);
    return path.resolve(dir);
  };
  /** The record as the flow works from it: read, then each extension's settle hook (the next write keeps what it did). */
  const readState = (dir) => {
    const st = episode.read(dir);
    return st && !episode.tooNew(st) ? hooks.transformSync('settle', st, { dir }) : st;
  };

  function list() {
    const root = projectsDir();
    if (!exists(root)) return [];
    return fs.readdirSync(root).filter((n) => n !== 'Samples').map((n) => path.join(root, n))
      .map((dir) => ({ dir, st: episode.read(dir) })).filter((x) => x.st)
      .map(({ dir, st: raw }) => {
        const why = episode.tooNew(raw);
        if (why) {
          return { dir, title: String(raw.title || path.basename(dir)), stage: null, stageLabel: '', updatedAt: raw.updatedAt || null,
            minutes: Number(raw.intake && raw.intake.minutes) || null, delivered: false, tooNew: why };
        }
        let st = raw;
        try { st = hooks.transformSync('settle', raw, { dir }); } catch (e) { log(said(e)); }
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
    const st = readState(dir);
    const read = (rel) => { try { return fs.readFileSync(path.join(dir, 'presentation', rel), 'utf8').slice(0, 200000); } catch { return null; } };
    const files = Object.fromEntries(Object.entries(FILES).map(([k, rel]) => [k, read(rel)]));
    const video = d.pipeline.finalOutput(dir);
    const draft = d.pipeline.draftOutput(dir);
    const slides = slidesView(dir);
    const live = (provider) => Boolean(st.budgets && st.budgets[provider] && d.broker.isLive(st.budgets[provider], provider));
    const view = {
      dir, state: st, current: episode.current(st), stages: episode.STAGES, files, slides,
      // the *At times are file modification times: the renderer uses them to reload images and videos that changed
      slidesAt: slides.reduce((a, p) => Math.max(a, mtime(p) || 0), 0) || null,
      video: exists(video) ? video : null, videoAt: mtime(video), draft: exists(draft) ? draft : null, draftAt: mtime(draft),
      running: running.has(dir) || busy.has(dir),
      // film: the film's budget is live, whichever provider its Spend approval was for (FILM_PAID)
      budgets: { anthropic: live('anthropic'), heygen: live('heygen'), elevenlabs: live('elevenlabs'), fish: live('fish'), film: FILM_PAID.some(live) },
      // Filming again costs nothing: every clip is already filmed (see approveSpend).
      freeFilm: st.stages.spend.status === 'approved' && st.stages.spend.free === true,
      estimateSeconds: files.script ? episode.estimateSeconds(episode.parseScript(files.script)) : null,
      calls: st.calls || [],
      scenes: scenesView(dir),
      modules: readModulesMap(dir),
      deckOrder: readDeckOrder(dir),
      slideTitles: bulletSlides(files.bullets),
      catalog: modules.MODULES.map(({ id, name, tile, short, ask, now, withFile }) => ({ id, name, tile, short, ask, now, withFile, family: modules.META[id].family, isNew: modules.META[id].isNew })),
      animate: animateView(dir, st),
      refine: refineView(dir, st),
    };
    return hooks.transformSync('open', view, { dir });
  }

  // ── Refine: add-ons on the finished film ──

  /** The film's slides, for placing add-ons: from its timeline, else the deck's order. */
  function filmSlides(dir) {
    let tl = null;
    try { tl = JSON.parse(fs.readFileSync(refineMod.outputs(dir).filmTimeline, 'utf8')); } catch { /* not filmed yet */ }
    if (tl && Array.isArray(tl.slides) && tl.slides.length) return tl.slides.map((x) => ({ n: Number(x.n), title: String(x.title || '') }));
    return readDeckOrder(dir).map((id, i) => ({ n: i + 1, title: String(id) }));
  }

  /**
   * The film with the storyboard's pieces between slides spliced in (presentation_full.*), while it's current and they
   * are all the add-ons there are (the planned rows alone): then Refine adds nothing to it, and with tightening off
   * Deliver takes it as it is (the Wave 3 ruling, PLAN §2.7). Else null.
   * Only while Deliver's hook times what it writes beside the video (DESCRIPTION.txt's chapters, the captions) to that
   * same video: interstitials.deliveredTimeline, given Deliver's choice (stages.deliver.spliced), answers with this
   * timeline. Until it does, the storyboard's pieces go through Refine first, as before.
   */
  function splicedFilm(dir, st) {
    const adds = st.addons || [];
    if (!adds.length || !adds.every((a) => a && a.planned)) return null;
    try {
      const inter = require('./interstitials');
      const o = inter.current(dir, 'film');
      if (!o || !exists(o.video) || !exists(o.master) || !exists(o.timeline)) return null;
      const stages = isPlain(st.stages) ? st.stages : {};
      const asked = { ...st, stages: { ...stages, deliver: { ...(isPlain(stages.deliver) ? stages.deliver : {}), spliced: true } } };
      const t = inter.deliveredTimeline(dir, asked);
      if (!t || !t.delivered || JSON.stringify(t.delivered) !== JSON.stringify(readJson(o.timeline))) return null;
      return { video: o.video, master: o.master, timeline: o.timeline };
    } catch { return null; }
  }

  /**
   * Anything for Refine to apply: the user's add-ons, the tightening, or the storyboard's pieces when the film doesn't
   * have them spliced in already (splicedFilm).
   */
  const refineWork = (st, dir) => Boolean(tightenKey(st) !== 'off' || ((st.addons || []).length && !(dir && splicedFilm(dir, st))));
  /** Anything Refine could apply (add-ons, planned ones included, or tightening), whether or not it must. */
  const refinable = (st) => Boolean((st.addons || []).length || tightenKey(st) !== 'off');

  /**
   * What Refine made, while it's current (these add-ons and this tightening, on this film): { video, master,
   * timeline }, the refined ones with add-ons, else the tightened ones. Else null.
   */
  function refinedOutputs(dir, st) {
    const rec = st.stages.refine || {};
    const addons = st.addons || [];
    if (!refinable(st) || !rec.applied) return null;
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
      outdated: Boolean(!current && refineWork(st, dir) && rec.applied),
      notes: current && rec.applied && Array.isArray(rec.applied.notes) ? rec.applied.notes : [],
    };
  }

  const refineBusy = (st) => st.stages.refine.status === 'running';
  /** Add-ons changed: what was applied (and delivered) no longer matches. */
  function refineChanged(st) {
    if (st.stages.refine.status !== 'todo') {
      st.stages.refine = { ...st.stages.refine, status: 'todo', at: new Date().toISOString() };
      delete st.stages.refine.approvedBy;
    }
    if (st.stages.deliver.status === 'approved') st.stages.deliver = { ...st.stages.deliver, status: 'stale' };
  }

  /**
   * Add one add-on (see refine.cleanAddon). `spec.file` is an absolute path the main process resolved (from the
   * Library, Transitions & Music, or a file the user picked); it's copied into presentation/assets/refine/.
   */
  function addAddon(dir, spec = {}) {
    dir = guard(dir);
    const st = readState(dir);
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
    const st = readState(dir);
    if (refineBusy(st)) throw new Error('Refine is applying. Change the add-ons when it\'s done.');
    const addons = st.addons || [];
    // a planned row (the storyboard's piece between slides) is removed only from the storyboard; its render is never deleted here
    const hit = addons.find((x) => x.id === id);
    if (hit && hit.planned) throw new Error('It\'s from the storyboard.');
    if (!hit) throw new Error('That add-on is already gone.');
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
    const st = readState(dir);
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
    const st = readState(dir);
    if (!episode.canRun(st, 'refine')) throw new Error('Approve the film first.');
    const addons = st.addons || [];
    const tk = tightenKey(st);
    if (!refinable(st)) throw new Error('Add something first.');
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
    // T18 (W2-00 #3, W2-03 #5): the method's standard-library scripts (real-words.py) run on FLPT's own Python, the
    // app's toolchain, and only fall back to the episode's .venv when there's none
    const projectPython = d.pipeline.projectPython ? d.pipeline.projectPython(dir) : null;
    const ownPython = python || (d.basePython ? await d.basePython().catch(() => null) : null);
    const wordsPython = ownPython && exists(ownPython) ? ownPython : projectPython && exists(projectPython) ? projectPython : ownPython;
    const realWords = path.join(d.engineRoot || '', 'skills', 'avatar-presentation', 'templates', 'hyperframes', 'real-words.py');
    const applyRefine = async () => {
      episode.setStage(dir, 'refine', { status: 'running', error: null });
      try {
        // The add-ons applied (with their files), through each extension's refinePlan. The tightening is shown to them
        // and kept as the user chose it: its Scribe price was asked above.
        const plan = await hooks.transform('refinePlan', { addons: addons.map((a) => ({ ...a, path: a.file ? path.join(pres, a.file) : null })), tighten: tk }, { dir });
        const applying = Array.isArray(plan.addons) ? plan.addons : [];
        if (paid) scribe = await transcribeFilm(dir, st, o.film, paid, onLine, signal);
        let tight = null;
        if (tk !== 'off') {
          tight = await tightenMod.apply({ pres, film: o.film, filmTimeline: o.filmTimeline, out: o, engineRoot: d.engineRoot, scribe, python, wordsPython,
            env: toolEnvFor(), onLine, signal, ...toolsFor() });
        }
        let r = null;
        if (applying.length) {
          // On the tightened film, the add-ons' phrases move along with the words.
          const filmTl = tight ? readJson(o.filmTimeline) : null;
          r = await refineMod.apply({
            pres, film: tight ? o.tight : o.film, filmTimeline: tight ? o.tightTimeline : o.filmTimeline, out: o, title: st.title,
            addons: applying, python: wordsPython, realWords,
            mapWords: tight ? (n, words) => tightenMod.shiftWords(words, n, filmTl, tight.cuts) : null,
            env: toolEnvFor(), onLine, signal, ...toolsFor(),
          });
        }
        const made = r || tight;
        if (!made) throw new Error('There\'s nothing to apply.');
        const notes = [...(tight ? tight.notes : []), ...(r ? r.notes : [])];
        episode.setStage(dir, 'refine', { status: 'review', error: null, applied: { addons: refineMod.addonsKey(addons), film: refineMod.filmKey(o.film), tighten: tk,
          seconds: made.seconds, frames: made.frames, lufs: r ? r.lufs : null, tp: r ? r.tp : null, notes: notes.slice(0, 20), at: new Date().toISOString() } });
        return { ok: true, video: made.video, notes };
      } catch (e) {
        const error = signal && signal.aborted ? 'Stopped.' : said(e);
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
  async function sceneActionNow(dir, { key, action, slot } = {}) {
    dir = guard(dir);
    const st = readState(dir);
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

  // ── Claude planning budget (PLAN §2.9): one approval sized from the plan; when it runs low, the shortfall only ──

  const BASE_FOR = 'bullets, fact-check, storyboard, deck, script and the slides\' own animations';
  const REASONS = { bullets: 'the bullets', factcheck: 'the fact-check', deck: 'the deck', script: 'the script', animate: 'the slides\' own animations',
    storyboard: 'the storyboard', plan: 'the plan' };
  /** A top-up's reason in words: one of REASONS by its key, else "the plan". A caller's own words never reach the dialog. */
  const reasonText = (r) => (typeof r === 'string' && Object.prototype.hasOwnProperty.call(REASONS, r) ? REASONS[r] : REASONS.plan);
  const total = (lines) => usd2(lines.reduce((a, l) => a + l.usd, 0));

  /** The slides marked for an animation of their own that the animator crew would make (not the user's own). */
  function crewMarks(dir) {
    try { return animators.marked(dir).filter((s) => animators.owner(dir, s.n) !== 'user'); } catch { return []; }
  }

  /**
   * The planning cap's lines, all worked out here in main (T12): each crew stage's cap, each slide marked for an
   * animator (its session's cap), and what the extensions add (their `planning` hooks, `phase` 'first' or 'topup').
   * [{ label, usd, from }], `from` being 'stage', 'mark' or the extension's id.
   */
  async function planningLines(dir, phase) {
    const animate = episode.STAGES.find((s) => s.id === 'animate');
    // a stage approved as skipped (the storyboard of an episode made before 2.0) never runs, so it isn't asked for
    let stages = {};
    try { stages = (episode.read(dir) || {}).stages || {}; } catch { stages = {}; }
    const skippedStage = (id) => isPlain(stages[id]) && stages[id].status === 'approved' && Boolean(stages[id].skipped);
    const lines = [
      ...episode.STAGES.filter((s) => s.kind === 'agent' && !skippedStage(s.id)).map((s) => ({ label: s.label, usd: s.budgetUsd, from: 'stage' })),
      ...crewMarks(dir).map((s) => ({ label: `Animate · slide ${s.n}`, usd: animate.budgetUsd, from: 'mark' })),
    ];
    for (const { ext: id, value } of await hooks.collect('planning', { dir, phase })) {
      if (!isPlain(value) || !Array.isArray(value.lines)) throw new ext.HookError(id, 'planning', new Error('it must answer with { lines: [{ label, usd }] }'));
      for (const l of value.lines) {
        const usd = Number(l && l.usd);
        if (!isPlain(l) || typeof l.label !== 'string' || !l.label.trim() || typeof l.usd !== 'number' || !Number.isFinite(usd) || usd < 0 || usd > MAX_LINE_USD) {
          throw new ext.HookError(id, 'planning', new Error(`each line needs a label and an amount from 0 to ${MAX_LINE_USD} US dollars`));
        }
        lines.push({ label: l.label.trim().replace(/\s+/g, ' ').slice(0, 80), usd: usd2(usd), from: id });
      }
    }
    return lines;
  }

  /** What the cap pays for, in the dialog: the crew's stages (the storyboard only when it's counted), then anything an extension added, by name. */
  function capFor(lines) {
    const board = episode.STAGES.find((s) => s.id === 'storyboard');
    const base = board && lines.some((l) => l.from === 'stage' && l.label === board.label) ? BASE_FOR : BASE_FOR.replace('storyboard, ', '');
    const more = lines.filter((l) => l.from !== 'stage' && l.from !== 'mark' && l.usd > 0).map((l) => l.label);
    if (!more.length) return base;
    return `${base}, plus ${more.length > 4 ? `${more.slice(0, 3).join(', ')} and ${more.length - 3} more` : more.join(', ')}`;
  }

  const plainLines = (lines) => lines.map(({ label, usd }) => ({ label, usd }));

  /**
   * The first approval: the whole plan's cap (at least `atLeast`), in the native dialog. Records the budget and the
   * plan's lines on the episode. Returns the new token, or null on a no.
   */
  async function approvePlanning(dir, st, atLeast = 0, given = null) {
    const lines = given || await planningLines(dir, 'first');
    const cap = Math.max(Math.ceil(total(lines) - 1e-9), Math.ceil(atLeast - 1e-9));
    const ok = await d.confirm({
      title: 'Spend on Claude?',
      message: `Planning "${st.title}" uses your Anthropic key.`,
      detail: `Up to ${cap} US dollars for ${capFor(lines)}. Each run is capped, and only its real cost counts against this budget, so revisions draw on it too. You'll see the cost after each run, and you'll be asked again if it runs low.`,
      button: `Approve up to ${cap} US dollars`,
    });
    if (!ok) return null;
    const token = d.broker.approve(estimate([{ rate: 'anthropic_usd', qty: cap, label: 'Claude planning cap' }]), { project: st.title, stage: 'planning', marginPct: 0 }).anthropic;
    const now = episode.read(dir);
    now.budgets = { ...(now.budgets || {}), anthropic: token };
    now.planning = { capUsd: cap, lines: plainLines(lines), at: new Date().toISOString() };
    episode.write(dir, now);
    return token;
  }

  /**
   * One top-up of `short` US dollars (worked out by the caller, here in main): the native dialog says what's left of
   * all that was approved so far and that it carries over; a yes mints a budget of what's left (to the cent, rounded
   * down) plus the shortfall and closes the old one. Returns the new token, or null on a no (the old budget stays).
   */
  async function topUp(dir, st, { token, short, reason, lines = null }) {
    const left = d.broker.remaining(token) || { usd: 0, capUsd: 0 };
    const approvedSoFar = (isPlain(st.planning) && Number(st.planning.capUsd)) || left.capUsd;
    const ok = await d.confirm({
      title: 'More for Claude?',
      message: `Planning "${st.title}" needs more.`,
      detail: `Up to ${short} more US dollars, for ${reasonText(reason)}. Of the ${approvedSoFar} US dollars approved, ${left.usd.toFixed(2)} are left, and they carry over. Only real cost counts.`,
      button: `Approve ${short} more US dollars`,
    });
    if (!ok) return null;
    const cap = usd2(left.usd + short);
    const next = d.broker.approve(estimate([{ rate: 'anthropic_usd', qty: cap, label: 'Claude planning cap' }]),
      { project: st.title, stage: 'planning', marginPct: 0, topUpOf: token }).anthropic;
    d.broker.close(token);
    const now = episode.read(dir);
    const was = isPlain(now.planning) ? now.planning : { capUsd: left.capUsd, lines: [] };
    now.budgets = { ...(now.budgets || {}), anthropic: next };
    now.planning = { ...was, capUsd: usd2((Number(was.capUsd) || 0) + short), ...(lines ? { lines: plainLines(lines) } : {}),
      topUps: [...(Array.isArray(was.topUps) ? was.topUps : []), { at: new Date().toISOString(), usd: short, reason: reasonText(reason) }].slice(-20) };
    episode.write(dir, now);
    return next;
  }

  /** What's really left on a budget: capUsd − spentUsd, unrounded (the sum broker.authorize checks a reservation against). */
  const freeOn = (token) => { const r = d.broker.remaining(token); return r ? Math.max(0, r.capUsd - r.spentUsd) : 0; };
  /** The top-up `pieces` need on `token`: the shortfall in whole dollars, and at least the largest piece's cap. */
  const shortfallFor = (token, pieces) => Math.max(Math.ceil(Math.max(...pieces.map((p) => p.usd)) - 1e-9),
    Math.ceil(pieces.reduce((a, p) => a + p.usd, 0) - freeOn(token) - 1e-9));
  /** Reserve each piece on `token`, in order, until one doesn't fit: the pieces reserved. */
  const reserveOn = (token, pieces) => {
    const got = [];
    for (const p of pieces) {
      try { d.broker.authorize(token, 'anthropic', { usd: p.usd, what: p.what }); got.push(p); } catch { break; }
    }
    return got;
  };

  /**
   * Reserve Claude sessions on the episode's planning budget, each piece { usd, what } at its whole cap, asking only
   * when needed: the first approval (the plan's cap), or, when what's left won't cover them, one top-up for the
   * shortfall only (at least one piece's cap; what's left carries over and the old budget closes). Whether they fit is
   * worked out on what's really left, not on the cents shown, and should they still not all fit, what was reserved goes
   * back and the top-up is asked for: never a silent no. Returns { token, pieces }: the pieces reserved, in order (after
   * a no to a top-up, those that still fit), or null when none could be.
   */
  async function reservePlanning(dir, pieces, reason) {
    const st = readState(dir);
    const need = pieces.reduce((a, p) => a + p.usd, 0);
    let token = st.budgets && st.budgets.anthropic;
    let asked = false;
    if (!token || !d.broker.isLive(token, 'anthropic')) {
      token = await approvePlanning(dir, st, need);
      if (!token) return null;
    } else if (freeOn(token) + 1e-9 < need) {
      token = (await topUp(dir, st, { token, short: shortfallFor(token, pieces), reason })) || token;
      asked = true;
    }
    let got = reserveOn(token, pieces);
    if (got.length < pieces.length && !asked) {
      for (const p of got) d.broker.settle(token, { authorizedUsd: p.usd, actualUsd: 0, what: p.what });
      token = (await topUp(dir, readState(dir), { token, short: shortfallFor(token, pieces), reason })) || token;
      got = reserveOn(token, pieces);
    }
    return got.length ? { token, pieces: got } : null;
  }

  /**
   * The plan grew (from Wave 2: a storyboard approved with more Live Motion than the first approval covered): ask for
   * the difference only. Worked out here from the plan as it is now (the `planning` hooks, phase 'topup') against what
   * was approved so far, never from the caller (T12): nothing is asked when it's covered, and at least one piece's cap
   * when it isn't. What's left of the old budget carries over and the old one closes. With no live budget, it's the
   * first approval. Returns { ok: true, usd (asked; 0 when covered), capUsd } or { ok: false, cancelled: true }.
   */
  async function topUpPlanning(dir, reason, ...extra) {
    refuseAmounts(extra);
    if (reason != null && typeof reason !== 'string') throw new Error(AMOUNTS);
    dir = guard(dir);
    if (running.has(dir) || busy.has(dir)) throw new Error('Something is already running for this episode.');
    const st = readState(dir);
    const lines = await planningLines(dir, 'topup');
    const plan = Math.ceil(total(lines) - 1e-9);
    const token = st.budgets && st.budgets.anthropic;
    // the storyboard as it was checked against the budget: approve('storyboard') holds the plan to it
    const board = boardKey(dir);
    const covered = (r) => { if (r.ok && board) noteCovered(dir, board); return r; };
    if (!token || !d.broker.isLive(token, 'anthropic')) {
      return covered((await approvePlanning(dir, st, 0, lines)) ? { ok: true, usd: plan, capUsd: plan } : { ok: false, cancelled: true });
    }
    const approved = Number(isPlain(st.planning) && st.planning.capUsd) || (d.broker.remaining(token) || {}).capUsd || 0;
    if (plan <= approved + 1e-9) return covered({ ok: true, usd: 0, capUsd: approved });
    // at least one piece's cap: the smallest mark or extension line (a stage's own cap isn't a piece), else any line
    const pieces = lines.filter((l) => l.usd > 0 && l.from !== 'stage');
    const piece = Math.min(...(pieces.length ? pieces : lines.filter((l) => l.usd > 0)).map((l) => l.usd));
    const short = Math.max(Math.ceil(piece - 1e-9), Math.ceil(plan - approved - 1e-9));
    const next = await topUp(dir, st, { token, short, reason: reason || 'plan', lines });
    return covered(next ? { ok: true, usd: short, capUsd: usd2(approved + short) } : { ok: false, cancelled: true });
  }

  /** The storyboard as it is now, as one hash, or null when there's none. */
  function boardKey(dir) {
    try { const b = require('./storyboard').read(dir); return b ? sha256(JSON.stringify(b)) : null; } catch { return null; }
  }
  /** Record that the plan with this hash was checked against the Claude budget (and is covered by it). */
  function noteCovered(dir, key) {
    const now = episode.read(dir);
    if (!now || episode.tooNew(now)) return;
    now.planning = { ...(isPlain(now.planning) ? now.planning : {}), board: key };
    episode.write(dir, now);
  }
  /**
   * May the storyboard be approved as it is, money-wise? With a live Claude planning budget (the app), only when the plan
   * as it is now was checked against it (topUpPlanning); with none (the plugin: Claude Code's own account), yes.
   */
  function boardCovered(dir, st) {
    const token = st.budgets && st.budgets.anthropic;
    if (!token || !d.broker || typeof d.broker.isLive !== 'function' || !d.broker.isLive(token, 'anthropic')) return true;
    const key = boardKey(dir);
    return !key || (isPlain(st.planning) && st.planning.board === key);
  }

  async function runStageNow(dir, stageId, feedback = '') {
    dir = guard(dir);
    const stage = episode.STAGES.find((s) => s.id === stageId && s.kind === 'agent');
    if (!stage) throw new Error('That stage isn\'t an agent stage.');
    const st = readState(dir);
    if (!episode.canRun(st, stageId)) throw new Error('Approve the earlier stages first.');
    if (running.has(dir) || busy.has(dir)) throw new Error('Something is already running for this episode.');
    const apiKey = d.vault.get('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('Add your Anthropic key in Setup → Keys first.');
    let vars;
    let held;
    try {
      vars = hooks.transformSync('stageVars', stageVars(st), { dir, stageId });
      held = await reservePlanning(dir, [{ usd: stage.budgetUsd, what: `${st.title}: ${stageId}` }], stageId);
    } catch (e) {
      if (!hookError(e)) throw e;
      const error = said(e); // an extension's hook failed: the stage says so, and nothing ran or was reserved
      episode.setStage(dir, stageId, { status: 'error', error });
      return { ok: false, error, costUsd: 0 };
    }
    if (!held) return { ok: false, cancelled: true };
    const { token } = held;

    const ctrl = new AbortController();
    running.set(dir, ctrl);
    episode.setStage(dir, stageId, { status: 'running', feedback: feedback || null });
    const emit = (ev) => d.send('agent:event', { dir, stage: stageId, ...ev, text: ev.text ? d.redact(ev.text) : ev.text, detail: ev.detail ? d.redact(ev.detail) : ev.detail });
    try {
      const sdk = await d.loadSdk();
      // The session runs at the broker's share of what it reserved (T21); the settle below books whatever it really cost.
      const res = await agents.runStage({
        stage: { ...stage, budgetUsd: sessionCap(stage.budgetUsd) }, projectDir: dir, engineRoot: d.engineRoot, feedback, onEvent: emit,
        signal: ctrl.signal, vars,
      }, {
        sdk, z: d.loadZod ? await d.loadZod() : null, library: d.libraryFor ? d.libraryFor(dir) : undefined,
        apiKey, toolEnvPath: d.toolEnv().PATH, configDir: d.configDir, executable: d.executable,
        // what the storyboard plans for on this surface (D13): the host's caps, else the surface and the vault's key
        caps: planCaps(),
        tools: {
          checkDeck: (p) => stagetools.checkDeck(p, { pipeline: d.pipeline, chrome: d.chrome(), engineRoot: d.engineRoot, projectsDir: projectsDir() }),
          scriptStats: async (p) => stagetools.scriptStats(p, { minutes: st.intake.minutes }),
        },
      });
      d.broker.record(token, { what: `${st.title}: ${stageId}`, costUsd: res.costUsd, turns: res.turns, ok: res.ok });
      // The stage reserved its whole cap; once the real cost is known, the rest goes back to the planning budget.
      if (res.costKnown) d.broker.settle(token, { authorizedUsd: stage.budgetUsd, actualUsd: res.costUsd, what: `${st.title}: ${stageId}` });
      episode.addCost(dir, { provider: 'anthropic', stage: stageId, usd: res.costUsd, estimate: true });
      let qa = null;
      if (res.ok && stageId === 'deck' && (d.layoutCheck || d.chrome())) {
        const deckDir = path.join(dir, 'presentation', 'deck', 'project');
        qa = layoutqa.summarize(await (d.layoutCheck ? d.layoutCheck(deckDir) : layoutqa.checkDeck({ deckDir, chrome: d.chrome() })));
        // The slide pictures of what the crew wrote: in the sandbox the host gives for them (none yet: a ruling is pending).
        const box = d.slideSandbox ? d.slideSandbox(dir) : null;
        await d.pipeline.render(dir, box ? { sandbox: box } : {});
      }
      const error = res.error ? d.redact(String(res.error)).slice(0, 400) : null;
      episode.setStage(dir, stageId, { status: res.ok ? 'review' : 'error', sessionId: res.sessionId, report: res.report ? d.redact(res.report).slice(0, 8000) : null, error, costUsd: res.costUsd, qa });
      return { ok: res.ok, error, costUsd: res.costUsd, ...(res.keyRefused ? { keyRefused: true } : {}) };
    } catch (e) {
      const error = said(e);
      episode.setStage(dir, stageId, { status: 'error', error });
      return { ok: false, error, costUsd: 0 };
    } finally {
      running.delete(dir);
    }
  }

  /** A crew stage's prompt placeholders for this episode: stageVars(), then each extension's stageVars hook. */
  function stageVarsFor(dir, stageId) {
    dir = guard(dir);
    return hooks.transformSync('stageVars', stageVars(readState(dir)), { dir, stageId });
  }

  function cancel(dir) { const c = running.get(path.resolve(dir)); if (c) c.abort(); return Boolean(c); }

  // ── Animate: the animator crew (animators.js) ──

  /** The Animate step: the marked slides, their animations, and the last run's records. */
  function animateView(dir, st) {
    return { slides: animators.view(dir, st.animations || {}), perSlideUsd: animators.PER_SLIDE_USD, available: Boolean(d.animators && d.animators.available()) };
  }

  /** One slide's record of its last animator run (by slide id), written as the run moves on. */
  function noteAnimation(dir, id, patch) {
    const st = readState(dir);
    const all = st.animations || {};
    st.animations = { ...all, [id]: { ...(all[id] || {}), ...patch, at: new Date().toISOString() } };
    episode.write(dir, st);
  }

  /**
   * Run the animator crew: one session per marked slide (or only slide `slide`), a few at a time. Each session's cap is
   * reserved from the episode's Claude planning budget before any of them starts, so any question about money comes
   * first; then only its real cost counts. Ends in review when an animation was made, else error.
   */
  async function animateNow(dir, { slide = null, feedback = '' } = {}) {
    dir = guard(dir);
    const st = readState(dir);
    if (!episode.canRun(st, 'animate')) throw new Error('Approve the script first.');
    if (running.has(dir) || busy.has(dir)) throw new Error('Something is already running for this episode.');
    if (require('./scenecrew').isBusy(dir)) throw new Error('The Live Motion crews are still drawing.'); // the same stage
    if (!d.animators || !d.animators.available()) throw new Error('Animations need HyperFrames (Setup → Tools).');
    const apiKey = d.vault.get('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('Add your Anthropic key in Setup → Keys first.');
    const marked = animators.marked(dir).filter((s) => slide == null || s.n === Number(slide));
    if (!marked.length) throw new Error(slide == null ? 'No slide is marked for an animation of its own.' : 'That slide isn\'t marked for an animation.');
    const slides = marked.filter((s) => animators.owner(dir, s.n) !== 'user');
    if (!slides.length) throw new Error('Those slides have animations of your own, so they stay as they are.');
    const stage = episode.STAGES.find((s) => s.id === 'animate');
    let held;
    try {
      // Every session's cap at once, so any question about money comes first, in one dialog.
      held = await reservePlanning(dir, slides.map((s) => ({ usd: stage.budgetUsd, what: `${st.title}: animate slide ${s.n}` })), 'animate');
    } catch (e) {
      if (!hookError(e)) throw e;
      const error = said(e);
      episode.setStage(dir, 'animate', { status: 'error', error });
      return { ok: false, error, costUsd: 0 };
    }
    if (!held) return { ok: false, cancelled: true };
    const jobs = held.pieces.map((p, i) => ({ s: slides[i], token: held.token }));

    const ctrl = new AbortController();
    running.set(dir, ctrl);
    const what = (s) => `${st.title}: animate slide ${s.n}`;
    const results = [];
    try {
      const moved = animators.sync(dir);
      // crew: null: the animators' run, not the scene crews' (setStage merges, so one they left would carry over)
      episode.setStage(dir, 'animate', { status: 'running', feedback: feedback || null, error: null, crew: null });
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

  /**
   * After a stage was approved: tell the extensions (`approved`). A hook that fails undoes the approval, so it never
   * stands half-done: the stage's record goes back to what it was (`before`; one that was running ends as an error),
   * with the error on it, and the error goes on up.
   */
  function afterApproval(dir, stageId, before) {
    const now = episode.read(dir);
    if (!hooks.has('approved')) return now;
    try {
      hooks.notifySync('approved', { dir, stageId, by: episode.approver(now.stages[stageId].approvedBy) });
      return now;
    } catch (e) {
      const error = said(e);
      const st = episode.read(dir);
      st.stages[stageId] = { ...before, status: !before.status || before.status === 'running' ? 'error' : before.status, error, at: new Date().toISOString() };
      episode.write(dir, st);
      throw new Error(error);
    }
  }

  /** Approve one stage, saying who approved it ('you' or 'jazz'), then afterApproval. Returns the record. */
  function markApproved(dir, stageId, patch = {}, by = 'you') {
    const before = { ...(episode.read(dir).stages[stageId] || {}) };
    episode.setStage(dir, stageId, { ...patch, status: 'approved', approvedBy: by });
    return afterApproval(dir, stageId, before);
  }

  /**
   * Approve a stage's result. A stale agent stage (an earlier stage changed) can be kept as it is. `by` says who
   * approved it: 'you' (the default) or 'jazz' (Jazz, in main; the page never says).
   */
  function approve(dir, stageId, opts) {
    dir = guard(dir);
    const by = episode.approver(opts && opts.by);
    const st = readState(dir);
    const s = episode.STAGES.find((x) => x.id === stageId);
    if (!s || !st.stages[stageId]) throw new Error('Unknown stage.');
    const status = st.stages[stageId].status;
    if (stageId === 'refine') {
      // Optional: with nothing to apply it's simply approved; else once the add-ons or the tightening are applied.
      if (!episode.canRun(st, 'refine')) throw new Error('Approve the film first.');
      if (status === 'running') throw new Error('Refine is still applying.');
      if (status === 'approved') throw new Error('There\'s nothing to approve yet.');
      if (refineWork(st, dir) && !refinedOutputs(dir, st)) throw new Error((st.addons || []).length ? 'Apply the add-ons first.' : 'Apply the tightening first.');
      return markApproved(dir, 'refine', { skipped: !refinedOutputs(dir, st) }, by);
    }
    if (stageId === 'animate') {
      // Whatever the animators and the scene crews made is kept (a slide without an animation keeps its builds); with
      // nothing made, skipped.
      if (!episode.canRun(st, 'animate')) throw new Error('Approve the script first.');
      if (status === 'running' && running.has(dir)) throw new Error('The animators are still working.'); // else interrupted: keep what's there
      if (status === 'approved') throw new Error('There\'s nothing to approve yet.');
      let pieces = false;
      try { pieces = jazzExt.liveWork(dir).ok.length > 0; } catch { pieces = false; }
      const made = animators.view(dir).some((a) => a.made) || pieces;
      const next = markApproved(dir, 'animate', { skipped: !made }, by);
      if (made && d.keep) Promise.resolve().then(() => d.keep(dir, 'animate')).catch(() => {});
      return next;
    }
    if (stageId === 'scenes') {
      // Optional: approve any time after the script, with what's made; the rest keep their placeholders.
      if (!episode.canRun(st, 'scenes')) throw new Error(episode.canRun(st, 'animate') ? 'Approve Live Motion first (or skip it).' : 'Approve the script first.');
      if (status === 'approved') throw new Error('There\'s nothing to approve yet.');
      if (scenesBusy(dir)) throw new Error('Wait for the stills and shots on their way.');
      const made = scenesMod.view(dir).pieces.filter((p) => p.clip).length;
      const done = markApproved(dir, 'scenes', { made, skipped: !made }, by);
      if (made && d.keep) Promise.resolve().then(() => d.keep(dir, 'scenes')).catch(() => {}); // the cut scenes, to the Library
      return done;
    }
    const ok = status === 'review' || (status === 'stale' && s.kind === 'agent');
    if (!ok) throw new Error('There\'s nothing to approve yet.');
    if (!episode.canRun(st, stageId)) throw new Error('Approve the earlier stages first.');
    // The storyboard's Claude cap first (W2-01's top-up): with a live planning budget, a plan is approved only as it was
    // checked against it (topUpPlanning, which approveStoryboard and flpt.storyboard.approve ask first).
    if (stageId === 'storyboard' && !boardCovered(dir, st)) throw new Error('The storyboard\'s Claude budget isn\'t approved yet.');
    let next = markApproved(dir, stageId, {}, by);
    // With no cartoon or cut scene in the deck, there's nothing for Scenes: it's approved on the way.
    if (stageId === 'script' && next.stages.scenes.status !== 'approved' && !scenesMod.hasAny(dir)) next = markApproved(dir, 'scenes', { skipped: true }, by);
    // What the stage made goes to the Library too, for later episodes (in the background; never blocks approval).
    if (d.keep) Promise.resolve().then(() => d.keep(dir, stageId)).catch(() => {});
    return next;
  }

  function saveFile(dir, which, text) {
    dir = guard(dir);
    if (!EDITABLE.has(which) || typeof text !== 'string' || text.length > 400000) throw new Error('That file can\'t be edited here.');
    fs.writeFileSync(path.join(dir, 'presentation', FILES[which]), text);
    // Editing an approved file re-opens what was built on it.
    const st = readState(dir);
    const later = episode.STAGE_IDS.slice(episode.STAGE_IDS.indexOf(which === 'bullets' ? 'bullets' : 'script') + 1);
    for (const id of later) if (st.stages[id].status === 'approved') st.stages[id].status = 'stale';
    episode.write(dir, st);
    return open(dir);
  }

  // ── the user's calls for the deck ──
  const callEditable = (st) => st.stages.deck.status !== 'running';
  function addCall(dir, { module, slide = null, ask = '' } = {}) {
    dir = guard(dir);
    if (!modules.byId(module)) throw new Error('Pick one of the modules.');
    const text = String(ask || '').trim();
    if (!text) throw new Error('Say what you want, for example "animate the chart in this photo".');
    if (text.length > 2000) throw new Error('Keep the call under 2,000 characters.');
    const st = readState(dir);
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
    const st = readState(dir);
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
    const st = readState(dir);
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
    const st = readState(dir);
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
   * presents. Either way, the slides narrated without the bubble (Cosmos, Motion Solo) count as voice alone.
   */
  function filmEstimate(dir, piped) {
    let script = '';
    try { script = fs.readFileSync(path.join(dir, 'presentation', 'script.md'), 'utf8'); } catch { /* none yet */ }
    // The slides narrated without the bubble (T1): every one whose module hides it (motion.hiddenBubbleSlides: Cosmos,
    // Motion Solo), unless the user has an entry of their own for it, and any the user marked "bubble": false.
    const hidden = new Set(motionLib.noBubbleSlides(dir));
    const parsed = episode.parseScript(script);
    const per = episode.slideSeconds(parsed);
    const voiceSlides = per.filter((s) => hidden.has(s.n));
    const voiceLabel = 'Voice only, no avatar';
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
      film = { source: 'pipeline', clips: piped.clips, filmed, total: piped.clipsTotal, nothing, ...(piped.guests ? { guestChars: piped.guests } : {}) };
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
    if (running.has(dir) || busy.has(dir)) return hooks.transform('estimate', filmEstimate(dir, null), { dir });
    if (!estimating.has(dir)) {
      estimating.set(dir, pipelineEstimate(dir).finally(() => estimating.delete(dir)));
    }
    return hooks.transform('estimate', filmEstimate(dir, await estimating.get(dir)), { dir });
  }

  /**
   * The generated cut scenes as Spend prices them (T20): each one's id, the slide it follows, and whether its clip is
   * made (a made clip goes between its slides and moves their neighbours' timing). Sorted, so two sets compare as text.
   */
  function generatedCutscenes(dir) {
    try {
      const clips = new Set(scenesMod.cutsceneClips(dir).map((c) => c.id));
      return scenesMod.plan(dir).cutscenes.map((c) => `${c.id}@${c.afterN == null ? '?' : c.afterN}${clips.has(c.id) ? '+clip' : ''}`).sort();
    } catch {
      return []; // a deck that can't be read plans none
    }
  }

  /** The film's budgets still live, by provider: what its Spend approval minted (FILM_PAID). */
  const filmTokens = (st) => Object.fromEntries(FILM_PAID.map((p) => [p, st && st.budgets && st.budgets[p]]).filter(([p, t]) => t && d.broker.isLive(t, p)));

  /** Spend is open again (the priced cut scenes changed): its approval goes, and what was built on it is out of date. */
  function reopenSpend(dir, why) {
    const st = episode.read(dir);
    for (const t of Object.values(filmTokens(st))) d.broker.close(t);
    st.stages.spend = { status: 'todo', at: new Date().toISOString(), reopened: why };
    for (const later of episode.STAGE_IDS.slice(episode.STAGE_IDS.indexOf('spend') + 1)) {
      if (st.stages[later].status === 'approved') st.stages[later] = { ...st.stages[later], status: 'stale' };
    }
    episode.write(dir, st);
  }

  /**
   * The approval dialog's line: the amount, and what it pays for. `paidBy`: [[provider, { usd }]], each provider the
   * film pays (HeyGen's alone reads as it always has).
   */
  function spendDetail(est, paidBy = [['heygen', est.byProvider.heygen || { usd: 0 }]]) {
    const voice = est.lines.some((l) => l.rate === 'heygen_tts_s' && l.qty > 0);
    const heygenWords = `4.1 cents a second of avatar video${voice ? ' and 0.2 cents a second of voice alone' : ''}`;
    const f = est.film || {};
    const clips = f.source === 'pipeline' && f.filmed && f.total ? ` ${f.clips} of ${f.total} avatar clips to film: the other ${f.filmed} are already filmed.` : '';
    const total = usd2(paidBy.reduce((a, [, x]) => a + (Number(x && x.usd) || 0), 0));
    const words = (p) => (p === 'heygen' ? heygenWords : rateWords(p));
    if (paidBy.length === 1) {
      const [p] = paidBy[0];
      return `About ${total.toFixed(2)} US dollars (${p === 'heygen' ? '' : `${PROVIDER_NAMES[p]}: `}${words(p)}, plus up to 15 % margin).${clips} Nothing else will be charged.`;
    }
    const each = paidBy.map(([p, x]) => `${PROVIDER_NAMES[p]} ${(Number(x && x.usd) || 0).toFixed(2)} (${words(p)})`).join(', ');
    return `About ${total.toFixed(2)} US dollars: ${each}, plus up to 15 % margin.${clips} Nothing else will be charged.`;
  }

  async function approveSpend(dir, ...extra) {
    refuseAmounts(extra); // the amount is this estimate's, worked out here (T12)
    dir = guard(dir);
    const st = scenesOnTheWay(dir, readState(dir));
    if (!episode.canRun(st, 'spend')) throw new Error(spendBlocked(st));
    const blocked = hooks.firstSync('spendBlocked', { dir });
    if (blocked) throw new Error(blocked);
    const before = { ...st.stages.spend };
    const old = filmTokens(st);
    if (Object.keys(old).length) {
      if (st.stages.spend.status === 'approved') return { ok: true, usd: st.stages.spend.usd, already: true };
      for (const t of Object.values(old)) d.broker.close(t); // the script changed since: that approval was for a different length
    }
    const est = await spendEstimate(dir);
    const cutscenes = generatedCutscenes(dir); // what this estimate priced (T20): Film checks it's still the same
    // Nothing any provider charges (W3-03's free Spend path): no dialog, no budget. Either every clip is already filmed
    // (filming puts it together from the cache), or the presenter costs nothing to film at all (a cartoon in the Mac's
    // voice: the estimate prices every line at zero; Film runs the keyless cartoonFinal kind, PLAN §2.12).
    const paid = usd2(Object.values(est.byProvider || {}).reduce((a, p) => a + (Number(p && p.usd) || 0), 0));
    if (!paid) {
      const cached = Boolean(est.film && est.film.nothing);
      const keyless = !cached && Boolean((est.film && est.film.keyless === true) || (est.lines || []).some((l) => Number(l.qty) > 0));
      if (!cached && !keyless) throw new Error('The script has no narration to film.');
      const now = episode.read(dir);
      now.stages.spend = { status: 'approved', at: new Date().toISOString(), usd: 0, free: true, ...(keyless ? { keyless: true } : {}), cutscenes, approvedBy: 'you' };
      episode.write(dir, now);
      afterApproval(dir, 'spend', before);
      return keyless ? { ok: true, usd: 0, free: true, keyless: true } : { ok: true, usd: 0, free: true };
    }
    // One dialog for everything the film pays, each provider on its own budget (W4-10: HeyGen, and a cartoon's or a
    // guest's own ElevenLabs or Fish.audio voice; a paid film run gets only the keys of the budgets it holds, T19). A
    // line from any other provider (one no film run pays) is refused before anything is asked.
    const paidBy = Object.entries(est.byProvider || {}).filter(([, a]) => usd2(Number(a && a.usd) || 0) > 0);
    if (paidBy.some(([p]) => !FILM_PAID.includes(p) || !SPEND_PROVIDERS.includes(p))) throw new Error('This FLPT can\'t pay for that voice yet.');
    const providers = paidBy.map(([p]) => p);
    const cartoon = Boolean(est.film && est.film.presenter === 'cartoon');
    const ok = await d.confirm({ title: `Spend money on ${providers.map((p) => PROVIDER_NAMES[p]).join(' and ')}?`,
      message: `Film "${st.title}" with ${cartoon ? 'your cartoon presenter' : 'your avatar'}?`, detail: spendDetail(est, paidBy), button: `Approve ${paid.toFixed(2)} US dollars` });
    if (!ok) return { ok: false, cancelled: true };
    const tokens = d.broker.approve({ ...est, byProvider: Object.fromEntries(paidBy) }, { project: st.title, stage: 'film' });
    const now = episode.read(dir);
    now.budgets = { ...(now.budgets || {}), ...tokens };
    now.stages.spend = { status: 'approved', at: new Date().toISOString(), usd: paid, ...(providers.join() === 'heygen' ? {} : { providers }), cutscenes, approvedBy: 'you' };
    episode.write(dir, now);
    try { afterApproval(dir, 'spend', before); } catch (e) { for (const t of Object.values(tokens)) d.broker.close(t); throw e; }
    return { ok: true, usd: paid };
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
      const extra = hooks.has('afterRender');
      if (!hyperframes) {
        const p = d.motion.plan(dir);
        if (p.slides.length || motionLib.bespokeSlides(dir).length) onLine('Moving slides need HyperFrames (Setup → Tools), so the slides stay still for now.');
        // video insets and cartoons need only ffmpeg: they still play (and an extension's afterRender still runs)
        if (!(p.insets || []).length && !(p.cartoons || []).length && !extra) return [];
      }
      const r = await d.motion.render(dir, which, { onLine, signal, hyperframes, ...(extra ? { afterRender: (a, w, rr) => afterRender(a, w, rr, onLine) } : {}) });
      animators.noteClips(dir, r.rendered);
      for (const p of r.problems) onLine(`! ${p}`);
      return r.rendered;
    } catch (e) {
      if (hookError(e)) { d.motion.clear(dir); throw e; } // an extension's afterRender failed: the step it ran in fails
      onLine(`! Moving slides: ${d.redact(String(e && e.message ? e.message : e)).slice(0, 300)}`);
      d.motion.clear(dir);
      return [];
    }
  }

  /**
   * Each extension's afterRender, merged for motion.render: { mix, scenes } (slide number → …; a later extension's
   * entry for a slide wins) and their problems, said in the log.
   */
  async function afterRender(dir, which, rendered, onLine = () => {}) {
    const out = { mix: {}, scenes: {}, problems: [] };
    for (const { ext: id, value } of await hooks.collect('afterRender', { dir, which, rendered: [...rendered], onLine })) {
      if (!isPlain(value)) throw new ext.HookError(id, 'afterRender', new Error('it must answer with { mix, scenes }'));
      if (isPlain(value.mix)) Object.assign(out.mix, value.mix);
      if (isPlain(value.scenes)) Object.assign(out.scenes, value.scenes);
      if (Array.isArray(value.problems)) out.problems.push(...value.problems.map((x) => String(x).slice(0, 300)));
    }
    return out;
  }

  /**
   * Scenes is optional: with nothing planned for it, a step that needs it approved approves it on the way (FLPT for
   * Claude Code relies on this). With cartoons or cut scenes planned, the user decides there. Returns the record.
   */
  function scenesOnTheWay(dir, st) {
    if (episode.canRun(st, 'spend') || !episode.canRun(st, 'scenes') || st.stages.scenes.status === 'approved') return st;
    if (scenesMod.hasAny(dir)) throw new Error('Approve Scenes first: make the cartoons and cut scenes there, or go on without them.');
    return markApproved(dir, 'scenes', { skipped: true }, episode.approvedBefore(st, 'scenes'));
  }

  /** Free: render the slides and narrate them with the Mac's own voice, to check timing before paying for filming. */
  async function draftNow(dir, onLine, signal) {
    dir = guard(dir);
    const st = scenesOnTheWay(dir, readState(dir));
    if (!episode.canRun(st, 'spend')) throw new Error(spendBlocked(st));
    return exclusive(dir, async () => {
      const r1 = await d.pipeline.render(dir, { onLine, signal });
      if (r1.code !== 0) return { ok: false, error: 'The slides didn\'t render.', lines: r1.lines.slice(-10) };
      // First the voice (its timing is what the moving slides follow), then the draft again with them in place.
      resetMedia(dir);
      let r = await d.pipeline.draft(dir, { onLine, signal });
      const out = d.pipeline.draftOutput(dir);
      let ok = r.code === 0 && exists(out);
      let moved;
      try {
        moved = ok && !(signal && signal.aborted) ? await moveSlides(dir, 'draft', onLine, signal) : [];
      } catch (e) {
        if (!hookError(e)) throw e;
        return { ok: false, video: null, error: said(e), lines: r.lines.slice(-10) };
      }
      if (moved.length) {
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
      if (ok) {
        try { await hooks.notify('afterDraft', { dir }); } catch (e) {
          if (!hookError(e)) throw e;
          return { ok: false, video: null, error: said(e), lines: r.lines.slice(-10) };
        }
      }
      // the draft with the storyboard's pieces between slides spliced in, when there are any (W2-03 handoff 4)
      const video = ok ? ((require('./interstitials').current(dir, 'draft') || {}).video || out) : null;
      return { ok, video, error: ok ? null : 'The draft didn\'t finish. See the log.', lines: r.lines.slice(-10) };
    });
  }

  /**
   * After filming: time the moving slides to the real voice, then put the film back together from the cache. That
   * run has no keys and no network, so it can't spend anything. If it doesn't work out, the film keeps its stills.
   */
  async function addMotionToFilm(dir, onLine, signal) {
    onLine('Timing the moving slides to the voice…');
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

  /** The film's phases, from the lines of its run (the pipeline's step titles, and FLPT's own). */
  const FILM_PHASES = [ // in the order a run says them
    [/^To film: /, 'Getting ready to film'], [/^\s*(DRAFT|FINAL) .*load slides/, 'Getting the slides and script ready'], [/^\s*Narration —/, 'Making the voice'],
    [/^\s*Presenter bubble —/, 'Filming the presenter'], [/^\s*Composite \(/, 'Compositing the slides'],
    [/^\s*Editing master/, 'Making the editing master'], [/^\s*Web copies/, 'Making the web copies'], [/^\s*Verify —/, 'Checking the film'],
    [/^Timing the moving slides/, 'Timing the moving slides to the voice'], [/^Rendering .*Live Motion/, 'Rendering Live Motion at the film\'s timing'],
    [/^Putting the film together/, 'Putting the film together'],
  ];

  async function film(dir, onLine = () => {}, signal) {
    dir = guard(dir);
    const st = readState(dir);
    if (!episode.canRun(st, 'film')) throw new Error('Approve the spend first.');
    // T20: Spend priced these generated cut scenes. A different set moves a neighbour's lead or tail (and its bill), so
    // Spend opens again for a fresh estimate; nothing is filmed.
    const priced = st.stages.spend.cutscenes;
    if (running.has(dir) || busy.has(dir)) throw new Error('Something is already running for this episode.');
    if (Array.isArray(priced) && priced.join('\n') !== generatedCutscenes(dir).join('\n')) {
      reopenSpend(dir, 'cutscenes');
      throw new Error('The cut scenes changed since the spend was approved. Approve the spend again.');
    }
    // the providers Spend approved this film for, each with its own budget (HeyGen's alone before W4-10)
    const named = Array.isArray(st.stages.spend.providers) ? st.stages.spend.providers.filter((p) => FILM_PAID.includes(p)) : [];
    const providers = named.length ? named : ['heygen'];
    const tokens = Object.fromEntries(providers.map((p) => [p, st.budgets && st.budgets[p]]));
    const free = st.stages.spend.free === true; // nothing to pay: every clip was already filmed, or a keyless presenter
    const keyless = free && st.stages.spend.keyless === true;
    const unpaid = providers.filter((p) => !tokens[p] || !d.broker.isLive(tokens[p], p));
    if (!free && unpaid.length) throw new Error(`The ${unpaid.map((p) => PROVIDER_NAMES[p]).join(' and ')} budget isn't approved (or was already used). Approve the spend again.`);
    if (keyless && typeof d.pipeline.cartoonFinal !== 'function') throw new Error('This FLPT can\'t film that presenter yet.');
    // where the film is, for its panel ("Compositing the slides · 3 min"): FLPT's own steps, and the pipeline's
    // never backwards: putting the film together runs the pipeline's steps again, under its own name
    let at = -1;
    const phase = (name, i = Infinity) => {
      const cur = (readState(dir).stages.film || {}).phase;
      if (cur === name) return;
      at = Math.max(at, i === Infinity ? FILM_PHASES.length : i);
      try { episode.setStage(dir, 'film', { phase: name, phaseAt: new Date().toISOString() }); } catch { /* the record as it was */ }
    };
    const log = onLine;
    onLine = (line) => { const i = FILM_PHASES.findIndex(([re]) => re.test(String(line))); if (i > at) phase(FILM_PHASES[i][1], i); log(line); };
    return exclusive(dir, async () => {
      episode.setStage(dir, 'film', { status: 'running', error: null, phase: 'Rendering the slides', phaseAt: new Date().toISOString() });
      try {
        const r1 = await d.pipeline.render(dir, { onLine, signal });
        if (r1.code !== 0) { episode.setStage(dir, 'film', { status: 'error', error: 'The slides didn\'t render.' }); return { ok: false, lines: r1.lines.slice(-10) }; }
        // Filmed with still slides (the moving ones are timed to this voice next), and the cartoons without the bubble.
        resetMedia(dir);
        let r;
        if (keyless) {
          // A presenter that costs nothing to film (a cartoon in the Mac's voice): the keyless, sandboxed cartoonFinal
          // kind (W3-05's, PLAN §2.12). Like a budget, the free approval is good for one run.
          episode.setStage(dir, 'spend', { free: false, keyless: false });
          onLine('Nothing to pay: the presenter is made here, with no keys…');
          r = await d.pipeline.cartoonFinal(dir, { onLine, signal });
        } else if (free) {
          // Put together from what was already filmed, with no keys and the network blocked (FLPT_CACHED_ONLY): it
          // stops if anything isn't filmed after all. Like a budget, it's good for one run.
          episode.setStage(dir, 'spend', { free: false });
          onLine('Nothing to pay: putting the film together from what was already filmed…');
          await d.pipeline.patchScripts(dir, { signal });
          r = await d.pipeline.recompose(dir, { onLine, signal });
        } else {
          // T18: filming runs only on FLPT's own pipeline. Asked before the approval is used, so a refused film keeps
          // it; Restore (pipeline.restore) is free.
          const trusted = typeof d.pipeline.trust === 'function' ? d.pipeline.trust(dir) : { ok: true };
          if (!trusted.ok) {
            const error = 'This episode\'s pipeline changed.';
            onLine(error);
            episode.setStage(dir, 'film', { status: 'error', error });
            return { ok: false, refused: true, changed: trusted.changed || [], lines: [error] };
          }
          // Authorised against what filming costs now that the slides are rendered: only what isn't filmed yet.
          const est = await hooks.transform('estimate', filmEstimate(dir, await pipelineEstimate(dir, { signal })), { dir });
          if (est.film.source === 'pipeline') onLine(`To film: ${est.film.clips} of ${est.film.total} avatar clips (the rest are already filmed).`);
          // a provider the film pays now that the approval didn't name (the presenter or a voice changed since): Spend
          // opens again, before anything is reserved or filmed
          const unnamed = Object.entries(est.byProvider || {}).filter(([p, a]) => usd2(Number(a && a.usd) || 0) > 0 && !providers.includes(p)).map(([p]) => p);
          if (unnamed.length) {
            reopenSpend(dir, 'providers');
            throw new Error(`The film now pays ${unnamed.map((p) => PROVIDER_NAMES[p] || p).join(' and ')}, which the spend didn't approve. Approve the spend again.`);
          }
          // each budget reserves its own provider's part; one that won't cover it lets the others go again
          const what = `${st.title}: film`;
          const held = [];
          try {
            for (const p of providers) {
              const usd = est.byProvider[p] ? est.byProvider[p].usd : 0;
              d.broker.authorize(tokens[p], p, { usd, what });
              held.push([p, usd]);
            }
          } catch (e) {
            for (const [p, usd] of held) d.broker.settle(tokens[p], { authorizedUsd: usd, actualUsd: 0, what });
            throw e;
          }
          try {
            r = await d.pipeline.final(dir, tokens[providers[0]], { onLine, signal, ...(providers.length > 1 ? { tokens } : {}) });
          } finally {
            // One approval, one filming run: whatever happened, the next attempt needs a fresh approval.
            for (const p of providers) {
              d.broker.record(tokens[p], { what, code: r ? r.code : null });
              d.broker.close(tokens[p]);
            }
          }
        }
        const ok = r.code === 0 && exists(d.pipeline.finalOutput(dir));
        const moving = ok ? await addMotionToFilm(dir, onLine, signal) : 0;
        if (ok) { phase('Splicing in the pieces between slides'); await hooks.notify('afterFilm', { dir, onLine }); }
        const error = ok ? null : signal && signal.aborted ? 'Stopped.'
          : keyless ? 'Filming didn\'t finish. Nothing was spent.'
            : free ? 'It couldn\'t be put together from what was already filmed, so filming needs an approval. Nothing was spent.' : 'Filming didn\'t finish. See the log.';
        episode.setStage(dir, 'film', { status: ok ? 'review' : 'error', movingSlides: moving, error });
        return { ok, video: ok ? ((require('./interstitials').current(dir, 'film') || {}).video || d.pipeline.finalOutput(dir)) : null, lines: r.lines.slice(-12) };
      } catch (e) {
        episode.setStage(dir, 'film', { status: 'error', error: said(e) });
        throw e;
      }
    });
  }

  // ── what Deliver hands an editor besides the video ──
  const methodScript = (name) => path.join(d.engineRoot || '', 'skills', 'avatar-presentation', 'scripts', 'video', name);
  /**
   * A Python for the method's standard-library scripts (loudmatch.py, slack_pack.py): FLPT's own (the app's
   * toolchain), else the episode's .venv (T18: a crew can't have planted anything in FLPT's own).
   */
  async function stdPython(dir) {
    const own = d.basePython ? await Promise.resolve(d.basePython()).catch(() => null) : null;
    if (own && exists(own)) return own;
    const p = d.pipeline.projectPython ? d.pipeline.projectPython(dir) : null;
    if (p && exists(p)) return p;
    return own || null;
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
    let st = readState(dir);
    if (!episode.canRun(st, 'deliver')) {
      // Refine is optional: with nothing to apply, delivering approves it on the way (FLPT for Claude Code relies on this).
      // The storyboard's pieces alone, already spliced into the film with tightening off, are nothing to apply: Deliver
      // takes the spliced film as it is (the Wave 3 ruling; PLAN §2.7).
      if (!episode.canRun(st, 'refine')) throw new Error('Approve the film first.');
      const adds = st.addons || [];
      if (refineWork(st, dir) || refineBusy(st)) throw new Error(adds.length && adds.every((a) => a && a.planned) ? 'Apply Refine first: it puts the storyboard\'s pieces between slides into the film.'
        : adds.length ? 'Apply and approve the add-ons first (Refine).' : 'Apply and approve the tightening first (Refine).');
      st = markApproved(dir, 'refine', { skipped: true }, episode.approvedBefore(st, 'refine'));
    }
    // What Refine made when there's anything to apply (it must be current); else the film with the storyboard's pieces
    // spliced in, when there are any; else the film's own.
    const refined = refinedOutputs(dir, st);
    if (refineWork(st, dir) && !refined) throw new Error(`The ${(st.addons || []).length ? 'refined' : 'tightened'} video is out of date: apply ${(st.addons || []).length ? 'the add-ons' : 'it'} again (Refine).`);
    const spliced = refined ? null : splicedFilm(dir, st);
    const made = refined || spliced;
    const video = made ? made.video : d.pipeline.finalOutput(dir);
    const master = made ? made.master : d.pipeline.editMasterOutput(dir);
    const slug = episode.slugify(st.title);
    return exclusive(dir, async () => {
      // which video this delivery takes, recorded before the hooks run: Deliver's hook times DESCRIPTION.txt's chapters
      // and the captions to it (interstitials.deliveredTimeline reads stages.deliver.spliced)
      episode.setStage(dir, 'deliver', { status: 'running', error: null, refined: Boolean(refined), spliced: Boolean(spliced) });
      try {
        const w = await d.pipeline.web(dir, { onLine, signal, source: made ? made.video : null });
        if (w.code === 0 && !writePlayerConfig(dir, d.pipeline.finalOutput(dir), { engineRoot: d.engineRoot })) onLine('The player page keeps your own titles (player_config.json).');
        const p = w.code === 0 ? await d.pipeline.player(dir, { onLine, signal }) : w;
        const out = path.join(d.settings.read().deliverablesDir, slug);
        fs.mkdirSync(out, { recursive: true });
        const copies = [[video, 'presentation.mp4'], [master, `${slug} (for CapCut).mov`],
          [path.join(dir, 'presentation', 'script.md'), 'script.md']];
        for (const [src, name] of copies) if (exists(src)) fs.copyFileSync(src, path.join(out, name));
        // CC BY music is credited, with what was done to it.
        const credits = made ? refineMod.musicCredits(st.addons, st.title) : null;
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
        const items = await hooks.transform('deliver', extras.collect({ pres, addons: st.addons || [], insets, cutscenes }), { dir });
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
        // the spliced film's timeline maps film times into it as Refine's would (the planned rows are its only add-ons)
        const slots = film ? extras.clipSlots({ film, tight: refined && tk !== 'off' ? readJson(o.tightTimeline) : null,
          refined: refined && (st.addons || []).length ? readJson(o.timeline) : spliced ? readJson(spliced.timeline) : null,
          insets, cutscenes, addons: st.addons || [], files: lev.bySrc, pres }) : [];
        const length = (readJson(made ? made.timeline : o.filmTimeline) || {}).total_duration || 0;
        const guide = extras.clipGuide({ title: st.title, master: `${slug} (for CapCut).mov`, seconds: length, slots, levelled: lev.files.length > 0 });
        if (guide) fs.writeFileSync(path.join(out, 'CAPCUT_CLIP_GUIDE.md'), guide);
        else fs.rmSync(path.join(out, 'CAPCUT_CLIP_GUIDE.md'), { force: true });

        const slack = st.stages.deliver.slack && (st.stages.deliver.slack.files || []).every((f) => exists(path.join(out, f))) ? st.stages.deliver.slack : null;
        markApproved(dir, 'deliver', { folder: out, playerOk: p.code === 0, refined: Boolean(refined), spliced: Boolean(spliced), tightened: Boolean(refined) && tk !== 'off',
          extras: lev.files.length, guide: Boolean(guide), slack });
        if (d.keep) Promise.resolve().then(() => d.keep(dir, 'deliver', { finalVideo: video })).catch(() => {});
        return { ok: true, folder: out, playerOk: p.code === 0, refined: Boolean(refined), spliced: Boolean(spliced), extras: lev.files, guide: Boolean(guide), lines: p.lines ? p.lines.slice(-8) : [] };
      } catch (e) {
        episode.setStage(dir, 'deliver', { status: 'error', error: said(e) });
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
    const st = readState(dir);
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
    return scenesOnTheWay(dir, readState(dir));
  }

  // ── Jazz: "Let FLPT play jazz" (W3-03; PLAN §2.8, draft-ux §10.2; decisions.md D13, the Wave 3 rulings) ──────────

  const JAZZ_STEPS = new Set(['deck', 'script', 'animate', 'scenes', 'spend']);
  const STOPPED = 'Stopped.';
  const NOT_APPROVED = 'Not approved. Nothing was spent.';
  const EVERY_STEP = 'Stop at every step';
  const POLL_MS = 2000;
  const PROVIDERS = { kie: 'Kie.ai', higgsfield: 'Higgsfield' };
  const labelOf = (id) => (episode.STAGES.find((s) => s.id === id) || {}).label || id;
  const routesNow = () => { try { return d.scenes && typeof d.scenes.routes === 'function' ? d.scenes.routes() || {} : {}; } catch { return {}; } };
  /** A step the page asks for while Jazz plays this episode is refused (Jazz's own steps go through the *Now ones). */
  const notWhileJazz = (dir) => { if (jazzExt.playingOf(dir)) throw new Error('Jazz is playing.'); };
  /** Is this stage still the episode's open one? (Anything else that approved or re-opened a stage ends the play there.) */
  const stillOpen = (dir, id) => episode.current(readState(dir)) === id;
  const CHANGED = (id) => `${labelOf(id)} changed while Jazz played.`;

  /** The page's view of Jazz for an episode (ext/jazz.viewOf). */
  function jazzView(dir) {
    dir = guard(dir);
    return jazzExt.viewOf(dir, readState(dir), { caps: planCaps(), routes: routesNow() });
  }

  /** The Jazz record changed: written, and the page hears (jazz:changed). */
  function noteJazz(dir, patch) {
    const st = episode.read(dir);
    if (!st || episode.tooNew(st)) return;
    st.jazz = { ...episode.jazzOf(st), ...patch, at: new Date().toISOString() };
    episode.write(dir, st);
    const j = episode.jazzOf(st);
    try { d.send('jazz:changed', { dir, running: j.running, stage: j.stage, stoppedAt: j.stoppedAt, why: j.why }); } catch { /* no window */ }
  }

  /** Wait `ms`, or until the play stops. */
  const pause = (ms, signal) => new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const done = () => { clearTimeout(t); signal.removeEventListener('abort', done); resolve(); };
    const t = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });

  /** Why Jazz can't play this episode now, or null. */
  function cantPlay(dir, st) {
    const s = st.stages.storyboard || {};
    if (s.status !== 'approved' || s.skipped) return 'Approve the storyboard first.';
    let board = null;
    try { board = require('./storyboard').read(dir); } catch { board = null; }
    if (!board || board.mode !== 'jazz' || (s.mode && s.mode !== 'jazz')) return 'The storyboard isn\'t approved as Jazz.';
    if (episode.jazzOf(st).through !== 'draft') return 'Jazz is set to accept the storyboard only.';
    if (!JAZZ_STEPS.has(episode.current(st))) return `Jazz plays from the deck to the free draft; this episode is at ${labelOf(episode.current(st))}.`;
    return null;
  }

  /** Why a play can't start for this episode now (playThrough's own refusals, nothing changed), or null. */
  function jazzRefusal(dir) {
    dir = guard(dir);
    if (jazzExt.playingOf(dir)) return 'Jazz is already playing.';
    const why = cantPlay(dir, readState(dir));
    if (why) return why;
    if (running.has(dir) || busy.has(dir) || require('./scenecrew').isBusy(dir)) return 'Something is already running for this episode.';
    return null;
  }

  /**
   * "Let FLPT play jazz" or "User directed": the plan's Claude cap first (topUpPlanning: the difference only, in one
   * native dialog; a no approves nothing and changes nothing, so the storyboard stays in review), then the storyboard
   * approved with its mode, by you. → { ok, usd } or { ok: false, cancelled: true }
   */
  async function approveStoryboard(dir, mode, ...extra) {
    refuseAmounts(extra);
    dir = guard(dir);
    if (mode !== 'jazz' && mode !== 'directed') throw new Error('Jazz or directed.');
    const plan = require('./ext/storyboard');
    plan.readyForApproval(episode, dir); // changes nothing
    const top = await topUpPlanning(dir, 'storyboard');
    if (!top.ok) return { ok: false, cancelled: true };
    plan.reviewable(episode, dir);
    approve(dir, 'storyboard', { by: 'you' });
    plan.recordMode(episode, dir, mode);
    return { ok: true, usd: top.usd };
  }

  /** A crew stage (the deck, the script): run when it isn't in review, then approved by Jazz when its rules hold. */
  async function jazzCrew(dir, id, run, io) {
    if (readState(dir).stages[id].status !== 'review') {
      io.onLine(`Jazz · ${labelOf(id)}`);
      const r = await runStageNow(dir, id);
      if (r.cancelled) return { ok: false, why: NOT_APPROVED, cancelled: true };
      if (run.ctrl.signal.aborted) return { ok: false, why: STOPPED };
      if (!r.ok) return { ok: false, why: r.error || `${labelOf(id)} didn't finish.` };
    }
    const st = readState(dir);
    const problems = id === 'deck' ? jazzExt.deckProblems(dir, st, { engineRoot: d.engineRoot, projectsDir: projectsDir() }) : jazzExt.scriptProblems(dir, st);
    if (problems.length) return { ok: false, why: problems[0], problems };
    approve(dir, id, { by: 'jazz' });
    return { ok: true };
  }

  /**
   * Live Motion: the scene crews for every piece not made (io.live.run: the app's, through api/livemotion.js), then the
   * animators for every slide marked and not made; each piece whose take is ok approved by Jazz, and the stage when
   * every one of them is.
   */
  async function jazzLive(dir, run, io) {
    const sig = run.ctrl.signal;
    let work = jazzExt.liveWork(dir);
    if (work.crews.length) {
      if (!io.live || typeof io.live.run !== 'function') return { ok: false, why: 'Live Motion\'s crews run in the FLPT app.' };
      io.onLine(`Jazz · Live Motion: ${work.crews.length} piece${work.crews.length === 1 ? '' : 's'}`);
      // every piece to make at once (the crews share the pool); with a made piece among them that reads stale, one by
      // one, so a crew never runs again for a piece whose take is made (it would be paid for twice)
      for (const key of work.stale.length ? work.crews : [null]) {
        const r = await io.live.run(dir, key ? { signal: sig, key } : { signal: sig });
        if (r && r.cancelled) return { ok: false, why: NOT_APPROVED, cancelled: true };
        if (sig.aborted) return { ok: false, why: STOPPED };
        if (!stillOpen(dir, 'animate')) return { ok: false, why: CHANGED('animate') };
      }
    }
    work = jazzExt.liveWork(dir);
    if (work.marks.length) {
      io.onLine(`Jazz · Live Motion: ${work.marks.length} animation${work.marks.length === 1 ? '' : 's'}`);
      const every = work.marks.length === work.allMarks.length;
      for (const n of every ? [null] : work.marks.map((m) => m.n)) {
        const r = await animateNow(dir, n == null ? {} : { slide: n });
        if (r && r.cancelled) return { ok: false, why: NOT_APPROVED, cancelled: true };
        if (sig.aborted) return { ok: false, why: STOPPED };
        if (!stillOpen(dir, 'animate')) return { ok: false, why: CHANGED('animate') };
      }
    }
    work = jazzExt.liveWork(dir);
    const livemotion = require('./livemotion');
    // A piece with words on screen that aren't in the script or the deck (PLAN §2.16, 4) is left for the user: Approve
    // shows them that list, and Jazz can't, so it stops here once the others are approved.
    const words = [];
    for (const p of work.pieces.filter((x) => (x.status === 'ok' || x.status === 'stale') && !x.approved)) {
      const unlisted = Array.isArray(p.unlisted) ? p.unlisted.filter((w) => typeof w === 'string' && w) : [];
      if (unlisted.length) { words.push({ title: p.title || p.key, unlisted }); continue; }
      try { livemotion.noteLive(dir, livemotion.pieceOf(dir, p.key), { approved: true, approvedBy: 'jazz' }); } catch { /* gone from the deck */ }
    }
    const left = [...new Set([...work.crews, ...work.failed])];
    const missing = left.length + work.marks.length;
    if (missing) {
      const titles = work.pieces.filter((p) => left.includes(p.key)).map((p) => `${p.title}: ${p.error || 'not made'}`);
      return { ok: false, why: `${missing} Live Motion piece${missing === 1 ? '' : 's'} didn't finish.`, problems: [...titles, ...work.marks.map((m) => `slide ${m.n}: no animation`)] };
    }
    if (words.length) {
      const all = [...new Set(words.flatMap((w) => w.unlisted))];
      const shown = `${all.slice(0, 8).join(', ')}${all.length > 8 ? ', …' : ''}`;
      return { ok: false, why: `${all.length} word${all.length === 1 ? '' : 's'} on screen ${all.length === 1 ? 'isn\'t' : 'aren\'t'} in the script or the deck: ${shown}.`,
        problems: words.map((w) => `${w.title}: ${w.unlisted.join(', ')}`.slice(0, 300)) };
    }
    if (!stillOpen(dir, 'animate')) return { ok: false, why: CHANGED('animate') };
    approve(dir, 'animate', { by: 'jazz' });
    return { ok: true };
  }

  /**
   * Scenes (D13): with generated Cosmos cartoons and cut scenes planned, one native dialog for their combined price,
   * then every step made against that one approval (ext/jazz.allowance, which generate.js asks before its own dialog),
   * each still and shot accepted as it lands, each piece put together (free); then the stage, by Jazz. A no, a take that
   * didn't work out, a plan the step can't make or Stop: it stops at Scenes. Nothing generated: approved on the way.
   */
  async function jazzScenes(dir, run, io) {
    const sig = run.ctrl.signal;
    const routes = routesNow();
    const st = readState(dir);
    let w = jazzExt.scenesWork(dir, { routes });
    if (w.blocked.length) return { ok: false, why: w.blocked[0], problems: w.blocked };
    if (w.todo.length) {
      if (!d.scenes) return { ok: false, why: 'Cartoons and cut scenes are made in the FLPT app.' };
      if (scenesBusy(dir)) io.onLine('Jazz · Scenes: waiting for the stills and shots on their way');
      const names = [...new Set([routes.stills || 'kie', routes.video || 'kie'])].map((id) => PROVIDERS[id] || id);
      const what = w.todo.length === 1 ? `the ${w.todo[0].kind === 'cartoon' ? 'Cosmos cartoon' : 'cut scene'}` : `${w.todo.length} generated scenes`;
      const ok = await d.confirm({
        title: `Spend money on ${names.join(' and ')}?`,
        message: `Make ${what} for "${st.title}"?`,
        detail: `${w.todo.map((p) => `"${p.title}" ${p.usd.toFixed(2)}`).join(', ')}: the stills and shots on ${names.join(' and ')}, about ${w.usd.toFixed(2)} US dollars in all, plus up to 15 % margin. Jazz accepts each one as it lands. Nothing else will be charged.`,
        button: `Approve ${w.usd.toFixed(2)} US dollars`,
      });
      if (!ok) return { ok: false, why: NOT_APPROVED, cancelled: true };
      episode.setStage(dir, 'scenes', { jazz: { approvedUsd: w.usd, pieces: w.todo.map((p) => p.key), at: new Date().toISOString() } });
      const allowance = jazzExt.allowance(w.usd);
      for (let round = 0; round < 2000; round += 1) {
        if (sig.aborted) return { ok: false, why: STOPPED };
        // approved, or re-opened, by anything else meanwhile: no further step is made against the approval
        if (!stillOpen(dir, 'scenes')) return { ok: false, why: CHANGED('scenes') };
        let moved = false;
        let waiting = scenesBusy(dir);
        const plan = scenesMod.plan(dir);
        for (const piece of [...plan.cartoons, ...plan.cutscenes]) {
          if (sig.aborted) break;
          if (piece.blocked) return { ok: false, why: `${piece.title}: ${piece.problems[0]}` };
          // what landed is accepted: the newest take of each still and shot (Jazz reviews none of them)
          const state = scenesMod.readState(dir);
          for (const x of scenesMod.slotsOf(piece)) {
            const s = ((state.pieces[x.key] || {}).slots || {})[x.name] || {};
            const status = scenesMod.slotStatus({ takes: Array.isArray(s.takes) ? s.takes : [], approved: s.approved == null ? null : s.approved, final: s.final || null });
            if (status === 'review') { scenesMod.approve(dir, x.key, x.name); moved = true; } else if (status === 'failed') return { ok: false, why: `${piece.title}: ${x.label === 'Style' ? 'the style frame' : x.label} didn't work out.` };
            else if (status === 'working') waiting = true;
          }
          const step = scenesMod.nextStep(piece, scenesMod.readState(dir));
          if (step) {
            if (!stillOpen(dir, 'scenes')) return { ok: false, why: CHANGED('scenes') };
            io.onLine(`Jazz · Scenes: ${piece.title}, ${step.step}`);
            const r = await d.scenes.make({ dir, key: piece.key, step, title: piece.title, project: st.title, allowance });
            if (r && r.cancelled) return { ok: false, why: NOT_APPROVED, cancelled: true };
            if (r && Array.isArray(r.failed) && r.failed.length && !r.started) return { ok: false, why: String(r.failed[0]).slice(0, 300) };
            moved = true;
            continue;
          }
          const v = scenesMod.view(dir, { routes }).pieces.find((p) => p.key === piece.key);
          if (v && v.ready && v.outdated) {
            if (assembling.has(dir) || running.has(dir) || busy.has(dir)) waiting = true;
            else { await assembleScene(dir, piece.key); moved = true; }
          }
        }
        w = jazzExt.scenesWork(dir, { routes });
        if (!w.todo.length) break;
        if (!moved) {
          if (!waiting && !scenesBusy(dir)) return { ok: false, why: `${w.todo[0].title} isn't made yet.` };
          await pause(io.pollMs, sig);
        }
      }
      if (sig.aborted) return { ok: false, why: STOPPED };
      if (jazzExt.scenesWork(dir, { routes }).todo.length) return { ok: false, why: 'The generated scenes aren\'t made yet.' };
    }
    if (!stillOpen(dir, 'scenes')) return { ok: false, why: CHANGED('scenes') };
    approve(dir, 'scenes', { by: 'jazz' });
    return { ok: true };
  }

  /** Spend: the free draft (the Mac's voice), then Jazz stops here, the draft ready. It never approves Spend or films. */
  async function jazzDraft(dir, run, io) {
    io.onLine('Jazz · the free draft');
    const r = await draftNow(dir, io.onLine, run.ctrl.signal);
    if (run.ctrl.signal.aborted) return { ok: false, why: STOPPED };
    if (!r.ok) return { ok: false, why: r.error || 'The draft didn\'t finish.' };
    return { ok: true, why: 'Draft ready.', draft: r.video || null };
  }

  /** The play, step by step from where the episode is: → { stoppedAt, why, problems, ok, cancelled, draft } */
  async function conduct(dir, run, io) {
    for (let n = 0; n < 12; n += 1) {
      const stage = episode.current(readState(dir));
      if (run.ctrl.signal.aborted) return { stoppedAt: stage, why: STOPPED };
      if (run.everyStep) return { stoppedAt: stage, why: EVERY_STEP };
      if (!JAZZ_STEPS.has(stage)) return { stoppedAt: stage, why: null, ok: true };
      run.stage = stage;
      noteJazz(dir, { stage });
      let r;
      try {
        r = stage === 'deck' || stage === 'script' ? await jazzCrew(dir, stage, run, io)
          : stage === 'animate' ? await jazzLive(dir, run, io)
            : stage === 'scenes' ? await jazzScenes(dir, run, io)
              : await jazzDraft(dir, run, io);
      } catch (e) {
        r = { ok: false, why: run.ctrl.signal.aborted ? STOPPED : said(e) };
      }
      if (!r.ok) return { stoppedAt: stage, why: r.why, problems: r.problems || [], cancelled: Boolean(r.cancelled) };
      if (stage === 'spend') return { stoppedAt: 'spend', why: r.why, ok: true, draft: r.draft };
    }
    return { stoppedAt: episode.current(readState(dir)), why: 'Jazz went round too many times.' };
  }

  /**
   * Let FLPT play jazz (PLAN §2.8): from wherever the episode is (the deck, the script, Live Motion, Scenes or Spend),
   * each step run and approved by Jazz's rules (approvedBy 'jazz'), on to the free draft; then it stops at Spend with
   * "<title> · draft ready" (a desktop notification when the host has one). It stops at the stage where anything fails,
   * a rule doesn't hold, a dialog gets a no, Stop is pressed (stopJazz, or deps.signal), or Stop at every step is chosen
   * (after the step under way). Every Claude run is on the episode's planning budget (the plan's one approval); the one
   * other approval is the generated scenes' combined price (D13). Nothing is ever filmed.
   * deps: { liveMotion: { run(dir, { signal }) } (the scene crews; d.liveMotion otherwise), notify(title, body),
   *         onLine(text), signal, pollMs }
   * → { ok, stoppedAt, why, problems, draft }
   */
  async function playThrough(dir, deps = {}) {
    dir = guard(dir);
    const why = jazzRefusal(dir);
    if (why) throw new Error(why);
    const io = {
      live: deps.liveMotion || d.liveMotion || null,
      notify: typeof deps.notify === 'function' ? deps.notify : typeof d.notify === 'function' ? d.notify : null,
      onLine: typeof deps.onLine === 'function' ? deps.onLine : () => {},
      pollMs: Number.isFinite(deps.pollMs) && deps.pollMs > 0 ? deps.pollMs : POLL_MS,
    };
    const run = { ctrl: new AbortController(), stage: null, everyStep: false };
    if (deps.signal) {
      if (deps.signal.aborted) run.ctrl.abort();
      else deps.signal.addEventListener('abort', () => stopJazz(dir), { once: true });
    }
    jazzExt.startPlaying(dir, run);
    let end = { stoppedAt: episode.current(readState(dir)), why: STOPPED };
    try {
      noteJazz(dir, { running: true, stage: null, stoppedAt: null, why: null, problems: [], pid: process.pid, startedAt: new Date().toISOString() });
      end = await conduct(dir, run, io);
    } catch (e) {
      end = { stoppedAt: episode.current(readState(dir)), why: said(e) };
    } finally {
      jazzExt.stopPlaying(dir);
      try {
        noteJazz(dir, { running: false, stage: null, pid: null, stoppedAt: end.stoppedAt || null, why: end.why || null, problems: (end.problems || []).map((x) => d.redact(String(x))) });
      } catch (e) { log(`Jazz: ${said(e)}`); }
    }
    const title = (readState(dir) || {}).title || '';
    // the user is away while it plays: a notification when it ends (not for their own Stop, nor a dialog they answered)
    if (io.notify && end.why !== STOPPED && end.why !== EVERY_STEP && !end.cancelled) {
      try {
        if (end.ok && end.stoppedAt === 'spend') io.notify(`${title} · draft ready`, '');
        else if (!end.ok) io.notify(`${title} · ${labelOf(end.stoppedAt)}`, end.why || '');
      } catch { /* nowhere to show it */ }
    }
    return { ok: Boolean(end.ok), stoppedAt: end.stoppedAt || null, why: end.why || null, problems: end.problems || [], draft: end.draft || null };
  }

  /** Stop: the play ends now; the step under way stops as its own Stop would (no stage is left running). */
  function stopJazz(dir) {
    const k = path.resolve(String(dir));
    const run = jazzExt.playingOf(k);
    if (!run) return false;
    run.ctrl.abort();
    cancel(k); // a crew stage, or the animators
    try { require('./scenecrew').cancel(k); } catch { /* none */ }
    return true;
  }

  /** Stop at every step: the plan is Directed from here, and a play under way ends once its step is done. → jazzView */
  function jazzEveryStep(dir) {
    dir = guard(dir);
    const run = jazzExt.playingOf(dir);
    if (run) run.everyStep = true;
    require('./ext/storyboard').recordMode(episode, dir, 'directed');
    return jazzView(dir);
  }

  /** The Jazz flag (PLAN D3's fallback): 'draft' plays on to the free draft; 'storyboard' accepts the board only. */
  function setJazzThrough(dir, through) {
    dir = guard(dir);
    if (!episode.JAZZ_THROUGH.includes(through)) throw new Error('The draft or the storyboard.');
    noteJazz(dir, { through });
    return jazzView(dir);
  }

  /**
   * Generate $ (the draft's chip, app and web; D13): a Cosmos or cut scene drawn in code is generated instead, priced at
   * Scenes. Its shot and its deck entry say so (ext/jazz.upgradePlan; the plan stays approved, the deck isn't staled),
   * Scenes opens again for it and so does Spend (T20: the generated set it priced changed). Nothing is spent here.
   * → { ok, shot, key, usd, changed, view }
   */
  function upgrade(dir, shotId, ...extra) {
    refuseAmounts(extra);
    dir = guard(dir);
    if (typeof shotId !== 'string' || !/^s[1-9][0-9]{0,3}$/.test(shotId)) throw new Error('That isn\'t a shot.');
    if (isBusy(dir) || require('./scenecrew').isBusy(dir)) throw new Error('Something is already running for this episode.');
    const caps = planCaps();
    if (!require('./storyboard').canGenerate(caps)) throw new Error('Generated scenes aren\'t made here.');
    if (!caps || caps.generation !== true) throw new Error('Generated scenes need a Kie.ai or Higgsfield key (Setup → Keys).');
    const st = readState(dir);
    const sb = st.stages.storyboard || {};
    if (sb.status !== 'approved' || sb.skipped) throw new Error('Approve the storyboard first.');
    const board = require('./storyboard').read(dir);
    const usd = board ? jazzExt.generatedPrice(board, shotId, routesNow()) : null;
    const r = jazzExt.upgradePlan(dir, shotId);
    if (r.changed) {
      const now = episode.read(dir);
      const sc = now.stages.scenes || {};
      if (sc.status === 'approved') {
        const { approvedBy, skipped, ...rest } = sc;
        now.stages.scenes = { ...rest, status: 'todo', at: new Date().toISOString(), reopened: 'generate' };
        episode.write(dir, now);
      }
      reopenSpend(dir, 'generate');
    }
    return { ok: true, shot: r.shot, key: r.key, usd, changed: r.changed, view: jazzView(dir) };
  }

  // The page's own step entry points: refused while Jazz plays the episode (its steps run through the *Now ones).
  const runStage = async (dir, stageId, feedback) => { notWhileJazz(dir); return runStageNow(dir, stageId, feedback); };
  const animate = async (dir, o) => { notWhileJazz(dir); return animateNow(dir, o); };
  const draft = async (dir, onLine, signal) => { notWhileJazz(dir); return draftNow(dir, onLine, signal); };
  const sceneAction = async (dir, o) => { notWhileJazz(dir); return sceneActionNow(dir, o); };
  // a stage approved by hand while Jazz plays would let it make paid steps past it: refused (Jazz approves through its own)
  const approvePage = (dir, stageId, opts) => { notWhileJazz(dir); return approve(dir, stageId, opts); };
  // the page's Cancel while Jazz plays is its Stop: the step under way stops, and so does the play
  const cancelPage = (dir) => (jazzExt.playingOf(dir) ? stopJazz(dir) : cancel(dir));

  /**
   * reservePlanning for the crews an API module runs (api/livemotion.js: the scene crews), never while a step runs for
   * the episode, as topUpPlanning. Each piece { usd, what } is main's own (its caps), never the page's (T12).
   */
  async function reserveCrews(dir, pieces, reason) {
    dir = guard(dir);
    if (running.has(dir) || busy.has(dir)) throw new Error('Something is already running for this episode.');
    if (!Array.isArray(pieces) || !pieces.length || !pieces.every((p) => isPlain(p) && Number.isFinite(p.usd) && p.usd > 0)) throw new Error(AMOUNTS);
    return reservePlanning(dir, pieces.map((p) => ({ usd: p.usd, what: String(p.what || '').slice(0, 200) })), reason);
  }

  /** Is a step running for the episode (an agent stage, a pipeline step)? Cheap: no hooks, no reads. */
  function isBusy(dir) { const k = path.resolve(String(dir)); return running.has(k) || busy.has(k) || Boolean(jazzExt.playingOf(k)); }

  /** What this surface can do (flpt.app.caps): the host's answer, then each extension's caps hook. */
  function caps(base = {}) { return hooks.transformSync('caps', { ...(isPlain(base) ? base : {}) }, {}); }

  /** The extensions this flow runs (id, order, hooks) and any left out (why), for Setup → About and the INT checks. */
  function extensions() { return { loaded: hooks.list(), problems: [...loaded.problems] }; }

  return { list, create, open, runStage, cancel: cancelPage, approve: approvePage, saveFile, spendEstimate, approveSpend, draft, film, deliver, slackPack, inProjects,
    addCall, removeCall, attachFiles, addCallLink, addAddon, removeAddon, setTighten, refine, animate, sceneAction, sceneLanded, assembleScene,
    passScenes, topUpPlanning, reservePlanning: reserveCrews, isBusy, stageVars: stageVarsFor, caps, extensions,
    // Spend opened again (T20), for livemotion.drawInCode and the API (W2-02's handoff 1c)
    reopenSpend: (dir, why) => reopenSpend(guard(dir), typeof why === 'string' ? why.slice(0, 40) : 'changed'),
    // Jazz (W3-03)
    approveStoryboard, playThrough, jazzRefusal, stopJazz, jazzEveryStep, setJazzThrough, jazzView, upgrade,
    // Deliver takes the film with the storyboard's pieces spliced in, as it is (flpt-film says so)
    deliversSpliced: (dir) => { dir = guard(dir); const st = readState(dir); return tightenKey(st) === 'off' && !refinedOutputs(dir, st) && Boolean(splicedFilm(dir, st)); } };
}

module.exports = { createFlow, stageVars, playerConfig, writePlayerConfig, tightenKey, spendBlocked, SPEND_PROVIDERS, FILM_PAID };
