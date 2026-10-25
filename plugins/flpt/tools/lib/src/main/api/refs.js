'use strict';
// flpt.refs: references and the style study (PLAN §2.11, §2.10.2, §3.3 S14; draft-ux §8; W3-02). The page names a
// reference by its Library id, an episode by its reference and a study by its id; every path, price and cap is worked
// out here, in main. A reference is the user's own (the Library's private kind): its pixels stay on this Mac, and only
// its measured card ever moves on (references.crewView).
//   list() · get(id)                 the references, newest first, each with its card (and, for one, its frames)
//   capture(url, motion)             one web page, captured by the user's action (references.captureLink: the pinned
//                                    headless shell, public addresses only, a 40 s hard stop); progress as refs:progress
//   pickFiles(kind?) · stageFiles(paths)  pictures (up to 12) or one video of the user's, from the native dialog
//                                    (kind 'video' or 'pictures') or a drop, held behind a token → { token, names }
//   addFiles(token)                  those files as a reference (references.addFiles)
//   chips(id, chips)                 the user's chips on its card (type, layout, camera, ease, note)
//   remove(id)                       to the Trash (the Library's own remove)
//   attach(episode, id)              the reference into the episode (presentation/refs/<ref>/: its card without the link,
//                                    its frames and motion for the Studio's compare; refs/ is closed to every crew) →
//                                    { ref, title }: the page then adds it to the shot (storyboard op 'ref')
//   attached(episode)                the episode's references, for the REFERENCE well: [{ ref, title, kind, thumb }]
//   study(id, opts)                  Make a style: the price asked once in the native dialog ("Up to 2.50 US dollars"),
//                                    reserved on its own budget, then one capped session (stylestudy.js); opts.look:
//                                    the Claude look is on (frames go to Claude, as the ⚑ line says) → the study's view
//   again(studyId, kind, notes?)     Closer or Further: another capped session on the same study, asked again
//   studyView(studyId) · stop(studyId) · keep(studyId, name) · discard(studyId)
//   stage(studyId)                   the study's demo on the Stage beside the reference (the Studio's own source)
// Events: refs:changed (the references changed), refs:progress (a capture's phases), refs:study ({ id, kind:
// 'line'|'state', event, latest (the crew's newest picture, when it has drawn one), view }; a 'state' with status
// 'running' comes once the price is approved). Nothing costs anything but study and again, and each asks first.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const episode = require('../episode');
const references = require('../references');
const stylestudy = require('../stylestudy');
const livemotion = require('../livemotion');
const animators = require('../animators');
const brokerLib = require('../broker');
const { createReferenceStaging } = require('../staging');

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'tif', 'tiff', 'bmp'];
const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'webm'];
const FILES = new RegExp(`\\.(${[...IMAGE_EXT, ...VIDEO_EXT].join('|')})$`, 'i');
const REF_ID = /^ref-[0-9a-f]{8}$/;
const LIB_ID = /^[a-z0-9][a-z0-9-]{2,90}$/;
const exists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const readJson = (p, fallback = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } };
const said = (c, e) => (typeof c.redact === 'function' ? c.redact(String(e && e.message ? e.message : e)) : String(e && e.message ? e.message : e)).slice(0, 400);
const tell = (c, channel, payload) => { try { c.send(channel, payload); } catch { /* no window */ } };

// ── the references, one instance per Library ──────────────────────────────────────────────────────────────────────
const INSTANCES = new WeakMap();
const HELD = new WeakMap();
let heldHere = null;
function held(c) {
  const k = c.dirs;
  const make = () => createReferenceStaging();
  if (!k || typeof k !== 'object') return (heldHere = heldHere || make());
  if (!HELD.has(k)) HELD.set(k, make());
  return HELD.get(k);
}

/** The toolchain's ffmpeg, ffprobe, the pinned headless shell (captures) and node: as library-ipc.js finds them. */
function toolPaths(c) {
  const of = (id) => (typeof c.toolOf === 'function' ? c.toolOf(id) : null) || {};
  const sys = (name) => ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'].map((d) => path.join(d, name)).find(exists) || null;
  const ff = of('ffmpeg');
  return { ffmpeg: ff.path || sys('ffmpeg'), ffprobe: ff.ffprobe || sys('ffprobe'), chrome: of('chrome').path || null, headless: of('hyperframes').browser || null, node: of('node').path || sys('node') };
}

/** The Library and its references (references.createReferences), or a plain error before the Library is set up. */
function refsOf(c) {
  const lib = typeof c.getLibrary === 'function' ? c.getLibrary() : null;
  if (!lib) throw new Error('The Library isn\'t ready yet.');
  if (!INSTANCES.has(lib)) {
    const { createMedia } = require('../media');
    const sandbox = require('../sandbox');
    // QA only (FLPT_QA set): exact host:port addresses of this Mac's own test pages a capture may reach
    const allowLocal = process.env.FLPT_QA && process.env.FLPT_REFS_ALLOW_LOCAL ? String(process.env.FLPT_REFS_ALLOW_LOCAL).split(',').map((s) => s.trim()).filter((s) => /^(127\.0\.0\.1|localhost|\[::1\]):\d{2,5}$/.test(s)) : [];
    INSTANCES.set(lib, references.createReferences({
      library: lib, media: createMedia(() => toolPaths(c)), tools: () => toolPaths(c), sandbox, allowLocal, uaVersion: String(c.version || '2.0'),
      log: (s) => console.warn(said(c, s)), // eslint-disable-line no-console
    }));
  }
  return { lib, refs: INSTANCES.get(lib) };
}

/** A reference as the page shows it: its title, kind, thumb, how many frames, whether it moves, and its card. */
function cardView(item, { frames = false } = {}) {
  const card = item.card ? references.validateCard(item.card) : null;
  const fdir = path.join(item.dir, 'frames');
  let names = [];
  try { names = fs.readdirSync(fdir).filter((f) => /^(still|kf)_\d+\.(png|jpe?g|webp)$/i.test(f)).sort(); } catch { names = []; }
  const motion = item.file === 'motion.mp4' && exists(path.join(item.dir, 'motion.mp4')) ? path.join(item.dir, 'motion.mp4') : null;
  return {
    id: item.id, title: item.title, kind: card && card.source.kind, addedAt: item.addedAt, thumb: item.thumbPath && exists(item.thumbPath) ? item.thumbPath : null,
    frameCount: names.length, motion: Boolean(motion), site: item.source && item.source.site ? item.source.site : null,
    ...(frames ? { frames: names.slice(0, 12).map((f) => path.join(fdir, f)), motionFile: motion } : {}),
    card,
  };
}
const libId = (id) => { if (typeof id !== 'string' || !LIB_ID.test(id)) throw new Error('That reference isn\'t in the Library any more.'); return id; };

// ── an episode's own copies ───────────────────────────────────────────────────────────────────────────────────────

/** The episode folder, checked: inside the projects folder, with a record this FLPT can read. */
function dirOf(c, dir) {
  if (!c.flow || !c.flow.inProjects(dir)) throw new Error('That isn\'t an FLPT episode folder.');
  const d = path.resolve(dir);
  const why = episode.tooNew(episode.readRaw(d));
  if (why) throw new Error(why);
  return d;
}
/** The id a Library reference goes by in an episode (refs/<ref>/): the same every time for the same reference. */
const refIdFor = (id) => `ref-${crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 8)}`;

/**
 * A Library reference into an episode's presentation/refs/<ref>/: its card (validated, the link left out), its frames
 * and its motion clip (for the Studio's compare; plain files only), and ref.json { title, kind, library, at }. A copy
 * already there is refreshed. → { ref, title }
 */
function attachTo(dir, item) {
  const ref = refIdFor(item.id);
  const root = path.join(dir, 'presentation', 'refs');
  const dest = path.join(root, ref);
  const work = path.join(root, `.${ref}.part-${crypto.randomBytes(3).toString('hex')}`);
  fs.mkdirSync(work, { recursive: true });
  try {
    const card = references.validateCard(item.card || readJson(path.join(item.dir, 'card.json'), {}));
    fs.writeFileSync(path.join(work, 'card.json'), `${JSON.stringify({ ...card, source: { kind: card.source.kind, url: null, capturedAt: card.source.capturedAt } }, null, 2)}\n`);
    stylestudy.copyPixels(item.dir, work);
    fs.writeFileSync(path.join(work, 'ref.json'), `${JSON.stringify({ title: String(item.title || '').slice(0, 120), kind: card.source.kind, library: item.id, at: new Date().toISOString() }, null, 2)}\n`);
    if (isDir(dest)) fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(work, dest);
  } catch (e) {
    fs.rmSync(work, { recursive: true, force: true });
    throw e;
  }
  return { ref, title: String(item.title || '').slice(0, 120) };
}

/** The episode's references, as the REFERENCE well shows them. */
function attached(dir) {
  const root = path.join(dir, 'presentation', 'refs');
  let names = [];
  try { names = fs.readdirSync(root).filter((n) => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(n) && isDir(path.join(root, n))).sort(); } catch { return []; }
  return names.map((ref) => {
    const r = readJson(path.join(root, ref, 'ref.json'), {}) || {};
    const card = readJson(path.join(root, ref, 'card.json'), null);
    let frames = [];
    try { frames = fs.readdirSync(path.join(root, ref, 'frames')).filter((f) => /^still_\d+\.(png|jpe?g|webp)$/i.test(f)).sort(); } catch { frames = []; }
    return { ref, title: String(r.title || ref).slice(0, 120), kind: card ? references.validateCard(card).source.kind : null,
      thumb: frames.length ? path.join(root, ref, 'frames', frames[0]) : null, palette: card ? references.validateCard(card).palette.slice(0, 5).map((p) => p.hex) : [] };
  });
}

// ── the style study ───────────────────────────────────────────────────────────────────────────────────────────────

const RUNNING = new Map(); // study id → AbortController

/** The styles as the flow sees them (the projects folder's Mine and Shared, the engine's shipped), or a host's own (tests). */
function stylesOf(c) { return c.styles && typeof c.styles.get === 'function' ? c.styles : require('../ext/livemotion').stylesOf({ engineRoot: c.engineRoot, settings: c.settings }); }
const projectsOf = (c) => c.settings.read().projectsDir;

/** The toolchain's environment for renders and the crew's tools (no keys: toolEnv carries none), its node named. */
function envOf(c) {
  const env = { ...(typeof c.toolEnv === 'function' ? c.toolEnv() : {}), HOME: process.env.HOME, USER: process.env.USER, LANG: 'en_US.UTF-8', TMPDIR: process.env.TMPDIR };
  const node = (typeof c.toolOf === 'function' && c.toolOf('node') && c.toolOf('node').path) || process.env.FLPT_NODE;
  if (node) env.FLPT_NODE = node;
  return env;
}

/**
 * Keep's measuring ffmpeg in FLPT's sandbox, as every free step's is (no network, writes only in its scratch folder,
 * the app's private files hidden): exec for the keyframes, wrap for references.measureCard's decoding.
 */
function measureBox(c) {
  const sandbox = require('../sandbox');
  const hidden = typeof c.appPrivate === 'function' ? c.appPrivate() : [];
  if (!sandbox.available()) return {};
  return { exec: animators.createExec({ env: envOf(c), hidden }), wrap: (cmd, args) => sandbox.wrap(cmd, args, { hidden: [...sandbox.hiddenDirs(), ...hidden] }), tmpdir: sandbox.tmpdir() };
}

/** What a study session needs from this host: the SDK and its key (from the vault, never the page), the tools. */
async function studyDeps(c, styles) {
  const apiKey = c.vault.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('Add your Anthropic key in Setup → Keys first.');
  const hf = typeof c.toolOf === 'function' && c.toolOf('hyperframes');
  if (!hf || !hf.ok) throw new Error('Live Motion needs HyperFrames (Setup → Tools).');
  const env = envOf(c);
  const hidden = typeof c.appPrivate === 'function' ? c.appPrivate() : [];
  const exec = animators.createExec({ env, hidden });
  const sdk = typeof c.loadSdk === 'function' ? await c.loadSdk() : await import('@anthropic-ai/claude-agent-sdk');
  const tp = toolPaths(c);
  return {
    sdk, z: require('zod').z, apiKey, toolEnvPath: env.PATH, configDir: path.join(c.dirs.userData, 'claude'),
    executable: typeof c.agentExecutable === 'function' ? c.agentExecutable() : undefined, engineRoot: c.engineRoot, styles, exec, ffmpeg: tp.ffmpeg || 'ffmpeg', ffprobe: tp.ffprobe || 'ffprobe',
    toolsFor: (dir, key, signal) => require('../scenecrew').makeTools(dir, key, c.engineRoot, { env, styles, signal, exec, library: livemotion.shippedLibrary(c.engineRoot), files: {} }),
  };
}

/**
 * One capped study session, asked first: the native dialog (Cancel by default) with the price, then a budget of its
 * own on the broker (the whole cap reserved), the session at its sessionCap, the real cost settled after and the budget
 * closed. → { cancelled } or the study's view with the run's outcome
 */
async function runStudy(c, dir, { kind, feedback = '', look = false }) {
  const st = stylestudy.view(dir);
  if (RUNNING.has(st.id)) throw new Error('The study is already running.');
  const styles = stylesOf(c);
  const deps = await studyDeps(c, styles);
  const usd = stylestudy.STUDY_USD;
  const price = usd.toFixed(2);
  const yes = await c.confirm({
    title: kind === 'study' ? 'Make a style' : kind === 'closer' ? 'Closer' : 'Further',
    message: `${kind === 'study' ? 'Make a style from this?' : kind === 'closer' ? 'Study it again, closer to the reference?' : 'Study it again, further from the reference?'} Up to ${price} US dollars.`,
    detail: [`One Claude session (${stylestudy.MODEL}) draws the look in code, capped at ${price} US dollars and ${stylestudy.MAX_TURNS} turns.`,
      look ? 'Up to six frames of the reference go to Claude to describe it. Nothing is shared.' : 'Only the reference\'s measured numbers and words reach it.'].join('\n'),
    button: `Approve ${price} US dollars`,
  });
  if (!yes) return { cancelled: true, view: stylestudy.view(dir, { styles }) };
  const what = `Style study ${st.id} (${kind})`;
  const est = brokerLib.estimate([{ rate: 'anthropic_usd', qty: usd, label: 'Style study' }]);
  const token = c.broker.approve(est, { project: dir, stage: 'style-study', approvedBy: 'user', marginPct: 0 }).anthropic;
  const ctrl = new AbortController();
  RUNNING.set(st.id, ctrl);
  tell(c, 'refs:study', { id: st.id, kind: 'state', view: { ...stylestudy.view(dir, { styles }), status: 'running' } });
  let res = null;
  let latest = stylestudy.latestPicture(dir);
  try {
    c.broker.authorize(token, 'anthropic', { usd, what });
    // each line of the crew's, with its newest picture when it has drawn a new one (the sheet fades it in)
    const onEvent = (ev) => {
      const now = stylestudy.latestPicture(dir);
      const fresh = now && now !== latest ? now : null;
      if (fresh) latest = fresh;
      tell(c, 'refs:study', { id: st.id, kind: 'line', event: { kind: ev.kind, name: ev.name || null, text: ev.text ? said(c, ev.text).slice(0, 200) : null }, ...(fresh ? { latest: fresh } : {}) });
    };
    res = await stylestudy.run(dir, { kind, feedback, look, reservedUsd: usd, signal: ctrl.signal, onEvent }, deps);
    try { c.broker.record(token, { what, costUsd: res.costUsd, turns: res.turns, ok: res.ok }); } catch { /* the ledger says why */ }
    if (res.costKnown) c.broker.settle(token, { authorizedUsd: usd, actualUsd: res.costUsd, what });
  } catch (e) {
    if (!res) c.broker.settle(token, { authorizedUsd: usd, actualUsd: 0, what });
    throw new Error(said(c, e));
  } finally {
    try { c.broker.close(token); } catch { /* closed */ }
    RUNNING.delete(st.id);
  }
  const view = stylestudy.view(dir, { styles });
  tell(c, 'refs:study', { id: st.id, kind: 'state', view });
  return { ok: res.ok, error: res.ok ? null : said(c, res.error || ''), costUsd: Math.round((Number(res.costUsd) || 0) * 100) / 100, view };
}

const studyDir = (c, id) => stylestudy.dirOf(projectsOf(c), id);

module.exports = {
  ns: 'refs',
  methods: {
    list: { args: [], handler: (c) => refsOf(c).refs.list().map((it) => cardView(it)) },
    get: { args: ['id:100'], handler: (c, id) => cardView(refsOf(c).refs.get(libId(id)), { frames: true }) },
    capture: { args: ['text:2000', 'bool?'], handler: async (c, url, motion) => {
      const { refs } = refsOf(c);
      const r = await refs.captureLink(url, { motion: motion === true, onProgress: (p) => tell(c, 'refs:progress', { phase: p && p.phase ? String(p.phase).slice(0, 40) : null }) });
      if (r.status === 'ok') tell(c, 'refs:changed', { id: r.item.id });
      return r.status === 'ok' ? { status: 'ok', ref: cardView({ ...r.item, card: r.card }, { frames: true }), seconds: r.seconds } : { status: r.status, label: r.label || null, offer: r.offer || null };
    } },
    pickFiles: { args: ['id:16?'], handler: async (c, kind) => {
      const video = kind === 'video';
      const pics = kind === 'pictures';
      const r = await c.dialogs.open({ title: 'Reference', properties: video ? ['openFile'] : ['openFile', 'multiSelections'],
        filters: [{ name: video ? 'Video' : pics ? 'Pictures' : 'Pictures or a video', extensions: video ? VIDEO_EXT : pics ? IMAGE_EXT : [...IMAGE_EXT, ...VIDEO_EXT] }] });
      if (r.canceled || !r.filePaths.length) return null;
      const s = held(c).stage(r.filePaths.filter((p) => FILES.test(p)).slice(0, 12));
      return s && s.files.length ? { token: s.token, names: s.files.map((f) => f.name) } : null;
    } },
    stageFiles: { args: ['dropped'], handler: (c, paths) => {
      const list = (paths || []).filter((p) => FILES.test(p) && !references.isReference(p)).slice(0, 12);
      if (!list.length) throw new Error('Pictures or a video only.');
      const s = held(c).stage(list);
      return { token: s.token, names: s.files.map((f) => f.name) };
    } },
    addFiles: { args: ['token'], handler: async (c, token) => {
      const files = held(c).take(token);
      const r = await refsOf(c).refs.addFiles(files);
      if (r.status === 'ok') tell(c, 'refs:changed', { id: r.item.id });
      return r.status === 'ok' ? { status: 'ok', ref: cardView({ ...r.item, card: r.card }, { frames: true }) } : { status: r.status, label: r.label || null };
    } },
    chips: { args: ['id:100', 'json:4096'], handler: (c, id, chips) => {
      const card = refsOf(c).refs.setChips(libId(id), chips);
      tell(c, 'refs:changed', { id });
      return card;
    } },
    remove: { args: ['id:100'], handler: async (c, id) => {
      const r = await refsOf(c).refs.remove(libId(id));
      tell(c, 'refs:changed', { id });
      return r;
    } },
    attach: { args: ['episode', 'id:100'], handler: (c, dir, id) => {
      const d = dirOf(c, dir);
      const item = refsOf(c).refs.get(libId(id));
      if (!item.card) throw new Error('That reference has no card yet.');
      return attachTo(d, item);
    } },
    attached: { args: ['episode'], handler: (c, dir) => attached(dirOf(c, dir)) },
    study: { args: ['id:100', 'json:1024?'], handler: async (c, id, opts) => {
      const o = opts && typeof opts === 'object' ? opts : {};
      const item = refsOf(c).refs.get(libId(id));
      if (!item.card) throw new Error('That reference has no card yet.');
      const styles = stylesOf(c);
      await studyDeps(c, styles); // the key and HyperFrames first: nothing is made or asked without them
      const v = stylestudy.create({ projectsDir: projectsOf(c), engineRoot: c.engineRoot, styles, reference: { id: item.id, title: item.title, dir: item.dir, card: item.card }, look: o.look === true });
      const r = await runStudy(c, v.dir, { kind: 'study', look: o.look === true });
      if (r.cancelled) { try { stylestudy.discard(v.dir); } catch { /* kept */ } return { cancelled: true, view: null }; }
      return r;
    } },
    again: { args: ['id:40', 'id:16', 'text:600?'], handler: async (c, id, kind, notes) => {
      const dir = studyDir(c, id);
      if (!['closer', 'further'].includes(kind)) throw new Error('Closer or Further.');
      const v = stylestudy.view(dir);
      const own = typeof notes === 'string' && notes.trim() ? `\n${notes.trim().slice(0, 600)}` : '';
      return runStudy(c, dir, { kind, feedback: `${stylestudy.NOTES[kind]}${own}`, look: v.look });
    } },
    studyView: { args: ['id:40'], handler: (c, id) => ({ ...stylestudy.view(studyDir(c, id), { styles: stylesOf(c) }), running: RUNNING.has(id) }) },
    stop: { args: ['id:40'], handler: (c, id) => { const ctrl = RUNNING.get(id); if (ctrl) ctrl.abort(); return Boolean(ctrl); } },
    keep: { args: ['id:40', 'text:40?'], handler: async (c, id, name) => {
      const dir = studyDir(c, id);
      if (RUNNING.has(id)) throw new Error('The study is still running.');
      const styles = stylesOf(c);
      const tp = toolPaths(c);
      const k = await stylestudy.keep(dir, { name: typeof name === 'string' ? name : '' }, { styles, ffmpeg: tp.ffmpeg || 'ffmpeg', ffprobe: tp.ffprobe || 'ffprobe', ...measureBox(c) });
      let media = null;
      try { media = await styles.renderMedia(k.style.id); } catch (e) { media = { ok: false, problem: said(c, e) }; }
      const style = styles.get(k.style.id);
      tell(c, 'share:changed', { id: k.style.id });
      return { style: { id: style.id, name: style.name, version: style.version, poster: style.media.poster, loop: style.media.loop }, media: media && media.ok ? { ok: true } : media, view: stylestudy.view(dir, { styles }) };
    } },
    discard: { args: ['id:40'], handler: (c, id) => {
      if (RUNNING.has(id)) throw new Error('The study is still running.');
      return stylestudy.discard(studyDir(c, id));
    } },
    stage: { args: ['id:40'], handler: async (c, id) => {
      if (!c.stageHost) throw new Error('No Stage here.');
      const dir = studyDir(c, id);
      const studio = require('../studio');
      const deps = { engineRoot: c.engineRoot, styles: stylesOf(c) };
      const parts = studio.piece(dir, stylestudy.KEY, deps);
      const sid = studio.idFor(dir, stylestudy.KEY);
      const stage = await c.stageHost.open({ source: studio.SOURCE, id: sid, t: 0 });
      return { stage, piece: { reference: parts.info.reference, duration: parts.info.duration, style: parts.info.style } };
    } },
  },
  events: ['refs:changed', 'refs:progress', 'refs:study'],
  // for the tests, the plugin's flpt-refs and ext/refs.js (not methods)
  attachTo, attached, refIdFor, cardView, REF_ID,
};
