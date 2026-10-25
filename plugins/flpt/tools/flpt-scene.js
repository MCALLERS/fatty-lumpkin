#!/usr/bin/env node
'use strict';
// Live Motion in Claude Code (PLAN §2.3, §2.16 items 2 and 6, §3.5): each piece is written by the restricted
// flpt-scene-crew subagent (engine/agents/flpt-scene-crew.md) under the scene guard (scene-guard.js, a PreToolUse hook),
// so the user's own session never authors scene code. The crew's tools are the Mac app's own (scenecrew.makeTools), as
// commands; the piece's folder, its record, its takes and its renders are livemotion.js's, exactly as in the app.
//
// For the user's session:
//   pieces    the deck's Live Motion pieces, what each one's state is, and what making them comes to (≈ US dollars of
//             the user's own Claude, ≈ time): the one question to ask before Live Motion starts
//   go        the user said yes to that amount (recorded, so a piece outside it is asked for again)
//   open      one piece's folder locked for its crew (.flpt/scene.lock), HyperFrames fetched once if this Mac has none,
//             and the crew's assignment
//   finish    the crew is back: its piece kept as a take (done, or not), recorded, and the lock lifted (--crew-gone:
//             a crew that was stopped, Esc or a closed window, and never came back)
// For the crew (the open piece only; the guard refuses it everything else):
//   brief, then start · picture · reference · previous · timing · align · music · lint · snapshot · render · sheet ·
//   compare · compare-ref · bubble · sound · done
// Nothing here spends: the crew runs on the user's own Claude, and every render is free and sandboxed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { ROOT, app, places, tools, toolEnv, episodeDir, pipeline, pluginHome, cli, usageError, main, say, exists } = require('./common');

const USAGE = `
Usage: flpt-scene <command> [<episode>] …
 The user's session:
  pieces [<episode>]
  go [<episode>] --usd <the amount the user said yes to>
  open [<episode>] --piece <key>            slide:<id> or between:<id>
  finish [<episode>] [--crew-gone]          --crew-gone: its crew was stopped and won't come back
 The scene crew (the open piece):
  brief · start [--fresh] · picture <path inside presentation/> · reference [<ref>] · previous · timing · align · music
  lint · snapshot --at <seconds,…> · render [--at <seconds,…>] · sheet · compare · compare-ref [<ref>] · bubble · sound
  done --fixed "<what one pass fixed>" --fixed "<what the next fixed>" … [--report "…"]
<episode> is the episode's folder (default: the one you're in, else the newest).`;

const OPTIONS = { usd: { type: 'string' }, piece: { type: 'string' }, fresh: { type: 'boolean' }, at: { type: 'string' },
  fixed: { type: 'string', multiple: true }, report: { type: 'string' }, 'crew-gone': { type: 'boolean' } };
const MAIN = ['pieces', 'go', 'open', 'finish'];
// The crew's commands, each one of its app tools. The scene guard lets the crew run these and nothing else.
const CREW = {
  brief: null, start: 'start_scene', picture: 'use_picture', reference: 'use_reference', previous: 'use_previous_frame', timing: 'narration_timing',
  align: 'align_beats', music: 'align_music', lint: 'lint_scene', snapshot: 'snapshot', render: 'render_preview', sheet: 'contact_sheet',
  compare: 'compare_with_slide', 'compare-ref': 'compare_with_reference', bubble: 'check_bubble', sound: 'listen', done: 'done',
};
const CREW_COMMANDS = Object.keys(CREW);
const AGENT = 'flpt:flpt-scene-crew';
const PIECE_MINUTES = 15; // one crew, start to done (G0 measured 13.4 min); in Claude Code the crews run one at a time
const LOCK_HOURS = 6;
// A crew's marker lasts while it works: every step it takes renews it (scene-guard.js), and after this long without
// one it's gone (Claude Code's own limit on one command is 10 minutes; a render takes under 2).
const CREW_IDLE_MINUTES = 15;

const usage = (why) => Object.assign(new Error(why), { usage: true });
const pad2 = (n) => String(n).padStart(2, '0');
const usd = (x) => (Math.abs(x - Math.round(x)) < 0.005 ? `$${Math.round(x)}` : `$${x.toFixed(2)}`);
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const realOf = (p) => { try { return fs.realpathSync(path.resolve(p)); } catch { return path.resolve(p); } };

// ── the lock and the crew's marker (read by scene-guard.js) ─────────────────────────────────────────────────────────

const stateDir = () => path.join(pluginHome(), '.flpt');
const lockFile = () => path.join(stateDir(), 'scene.lock');
const crewFile = () => path.join(stateDir(), 'crew.json');
const fresh = (at, hours) => { const t = Date.parse(at); return Number.isFinite(t) && Date.now() - t < hours * 3600e3; };

/** The open piece's lock: { episode, presDir, key, folder, readDeny, session, at }, or null (none, unreadable, expired). */
function readLock() {
  const l = readJson(lockFile());
  if (!l || l.schema !== 'flpt.scenelock/1' || typeof l.folder !== 'string' || typeof l.presDir !== 'string' || !fresh(l.at, LOCK_HOURS)) return null;
  return l;
}
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}
/**
 * The crew's marker (SubagentStart wrote it; scene-guard.js renews it on each of the crew's steps): { session, agent,
 * at, named, prompted, released }, or null (none, unreadable, or no step for CREW_IDLE_MINUTES). It still tells the
 * guard which calls are the crew's after the user's session let it go (released).
 */
function readCrewMarker() {
  const c = readJson(crewFile());
  return c && typeof c.session === 'string' && fresh(c.at, CREW_IDLE_MINUTES / 60) ? c : null;
}
/** The crew at work: its marker, unless the user's session let it go (finish --crew-gone). */
function readCrew() {
  const c = readCrewMarker();
  return c && !c.released ? c : null;
}
/** The crew's marker, changed (scene-guard.js and finish): only the marker of that session's crew. */
function touchCrew(session, patch) {
  const c = readJson(crewFile());
  if (!c || c.session !== session) return null;
  const next = { ...c, ...patch };
  writeJsonAtomic(crewFile(), next);
  return next;
}

// ── the episode and its pieces ───────────────────────────────────────────────────────────────────────────────────

const episode = () => app('episode');
const livemotion = () => app('livemotion');
const scenecrew = () => app('scenecrew');

function open(arg) {
  const dir = episodeDir(arg);
  const st = episode().read(dir);
  if (!st) throw new Error(`${dir} has no flpt-project.json, so it isn't an FLPT episode. Start one with /flpt:new.`);
  const tooNew = episode().tooNew(st);
  if (tooNew) throw new Error(tooNew);
  return { dir, st };
}

const HF_VERSION = '0.8.80'; // the HyperFrames FLPT pins (K1)

/** The newest chrome-headless-shell HyperFrames itself would find (puppeteer's cache, then its own), or null. */
function headlessShell() {
  const leaf = { 'darwin/arm64': 'chrome-headless-shell-mac-arm64', 'darwin/x64': 'chrome-headless-shell-mac-x64', 'linux/x64': 'chrome-headless-shell-linux64' }[`${process.platform}/${process.arch}`];
  if (!leaf) return null;
  for (const cache of [path.join(os.homedir(), '.cache', 'puppeteer', 'chrome-headless-shell'), path.join(os.homedir(), '.cache', 'hyperframes', 'chrome', 'chrome-headless-shell')]) {
    let builds = [];
    try { builds = fs.readdirSync(cache); } catch { continue; }
    const v = (d) => (String(d).split('-').pop() || '').split('.').map((n) => parseInt(n, 10) || 0);
    builds.sort((a, b) => { const x = v(a); const y = v(b); for (let i = 0; i < 4; i += 1) if (x[i] !== y[i]) return (y[i] || 0) - (x[i] || 0); return 0; });
    for (const b of builds) {
      const exe = path.join(cache, b, leaf, 'chrome-headless-shell');
      if (exists(exe)) return exe;
    }
  }
  return null;
}

/**
 * Where the pinned HyperFrames is: the caller's (FLPT_HYPERFRAMES), the Mac app's toolchain, FLPT's QA cache, else the
 * copy npx keeps once it has fetched HyperFrames ${HF_VERSION} (fetchHyperframes). Its browser: the toolchain's own, else
 * HYPERFRAMES_BROWSER_PATH, else the chrome-headless-shell HyperFrames fetched (null when there's none).
 * → { cli, browser, fontCache } or null
 */
function hyperframes() {
  if (process.env.FLPT_HYPERFRAMES && exists(process.env.FLPT_HYPERFRAMES)) {
    const b = process.env.HYPERFRAMES_BROWSER_PATH;
    return { cli: process.env.FLPT_HYPERFRAMES, browser: b && exists(b) ? b : headlessShell() };
  }
  for (const root of [path.join(places().userData, 'toolchain', 'hyperframes'), path.join(os.homedir(), 'Library', 'Caches', 'flpt-qa', 'toolchain', 'hyperframes')]) {
    const cliPath = path.join(root, 'app', 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs');
    if (!exists(cliPath)) continue;
    let browser = null;
    try {
      for (const d of fs.readdirSync(path.join(root, 'browser'))) {
        const b = path.join(root, 'browser', d, 'chrome-headless-shell');
        if (exists(b)) { browser = b; break; }
      }
    } catch { /* none of its own */ }
    return { cli: cliPath, browser: browser || headlessShell(), fontCache: path.join(root, 'font-cache') };
  }
  const npx = path.join(os.homedir(), '.npm', '_npx');
  let dirs = [];
  try { dirs = fs.readdirSync(npx); } catch { dirs = []; }
  for (const d of dirs.sort()) {
    const pkg = readJson(path.join(npx, d, 'node_modules', 'hyperframes', 'package.json'));
    const cliPath = path.join(npx, d, 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs');
    if (pkg && pkg.version === HF_VERSION && exists(cliPath)) return { cli: cliPath, browser: headlessShell() };
  }
  return null;
}

/**
 * HyperFrames ${HF_VERSION} and its headless Chrome fetched once, outside the sandbox (npm's package and HyperFrames' own
 * `browser ensure`: nothing of the episode runs), so the renders inside it never need the network.
 * → hyperframes() with a browser, or null when they couldn't be fetched (offline, or the user's sandbox).
 */
function fetchHyperframes() {
  const found = hyperframes();
  if (found && found.browser) return found;
  const { spawnSync } = require('child_process');
  const env = { ...process.env, ...toolEnv(), DO_NOT_TRACK: '1', HYPERFRAMES_NO_TELEMETRY: '1', HYPERFRAMES_SKIP_SKILLS: '1', HYPERFRAMES_NO_UPDATE_CHECK: '1' };
  if (!found) {
    const r = spawnSync('npx', ['-y', `hyperframes@${HF_VERSION}`, '--version'], { env, encoding: 'utf8', timeout: 300000 });
    if (r.status !== 0) return null;
  }
  const hf = hyperframes();
  if (!hf) return null;
  if (hf.browser) return hf;
  const r = spawnSync(process.execPath, [hf.cli, 'browser', 'ensure'], { env, encoding: 'utf8', timeout: 300000 });
  if (r.status !== 0) return null;
  const again = hyperframes();
  return again && again.browser ? again : null;
}

/**
 * The environment Live Motion's renders and the animators' get here: the toolchain's PATH, this Node, the pinned
 * HyperFrames and its browser when there is one, no telemetry, and no key of any kind.
 */
function liveEnv() {
  const t = tools();
  const env = { ...toolEnv(), HOME: process.env.HOME || os.homedir(), USER: process.env.USER || '', LANG: 'en_US.UTF-8', TMPDIR: process.env.TMPDIR || os.tmpdir(),
    FLPT_NODE: process.execPath, DO_NOT_TRACK: '1', HYPERFRAMES_NO_TELEMETRY: '1', HYPERFRAMES_SKIP_SKILLS: '1', HYPERFRAMES_NO_UPDATE_CHECK: '1' };
  const hf = hyperframes();
  if (hf) {
    env.FLPT_HYPERFRAMES = hf.cli;
    env.HYPERFRAMES_BROWSER_PATH = hf.browser || t.chrome || '';
    env.HYPERFRAMES_NO_AUTO_INSTALL = '1';
    if (hf.fontCache) env.HYPERFRAMES_FONT_CACHE_DIR = hf.fontCache;
  }
  if (t.ffmpeg) { env.HYPERFRAMES_FFMPEG_PATH = t.ffmpeg; env.HYPERFRAMES_FFPROBE_PATH = t.ffprobe || ''; }
  return env;
}

/** The style library this episode's pieces draw from (FLPT's shipped styles, and the user's in their projects folder). */
const stylesOf = () => livemotion().stylesFor({ engineRoot: ROOT, projectsDir: places().projects });

/** The app's crew tools for the open piece, as the app makes them (scenecrew.makeTools): sandboxed where macOS allows. */
function toolsFor(lock) {
  const env = liveEnv();
  const sandbox = app('sandbox');
  const exec = app('animators').createExec({ env, hidden: [places().config], sandboxed: sandbox.available() });
  const pl = pipeline(lock.episode);
  return scenecrew().makeTools(lock.episode, lock.key, ROOT, {
    env, styles: stylesOf(), exec, retime: (args, o = {}) => pl.retime(lock.episode, args, o),
    library: livemotion().shippedLibrary(ROOT), files: app('ext/livemotion').soundFiles(lock.episode),
  });
}

/**
 * The scene guard's look: the crew opened a picture with Read. One a round made (a still, a sheet, a frame) means that
 * round was looked at, as the app's policy tells scenecrew (its `saw`). Quiet when it's anything else.
 */
function sawPicture(lock, file) {
  try { toolsFor(lock).saw(file); } catch { /* only a note */ }
}

/** The pieces still to make, with their caps: what the one question asks for. */
function toMake(dir) {
  const keys = new Set(scenecrew().toMake(dir).map((p) => p.key));
  return livemotion().pieces(dir).filter((p) => keys.has(p.key));
}
const sumUsd = (list) => +list.reduce((a, p) => a + p.caps.usd, 0).toFixed(2);

function where(p) {
  if (p.placement === 'slide') return `slide ${p.n}`;
  return p.afterN ? `after slide ${p.afterN}` : 'before slide 1';
}

const tool = (name) => `node "${path.join(__dirname, `${name}.js`)}"`;

function cmdPieces(dir, st) {
  const lm = livemotion();
  const view = new Map(lm.view(dir).map((v) => [v.key, v]));
  const list = lm.pieces(dir);
  if (!list.length) { say('This deck plans no Live Motion piece.'); return; }
  const todo = toMake(dir);
  const total = sumUsd(todo);
  say(`Live Motion · "${st.title}" · ${list.length} piece${list.length === 1 ? '' : 's'} · ${todo.length} to make · ≈ ${usd(total)} of Claude · ≈ ${todo.length * PIECE_MINUTES} min`);
  for (const p of list) {
    const v = view.get(p.key) || {};
    const style = v.style ? v.style.id : lm.styleRefOf(dir, p);
    say(`  ${p.key.padEnd(22)}${`${lm.TILE[p.kind]} · ${where(p)}`.padEnd(36)}${String(style).padEnd(14)}${String(v.status || 'todo').padEnd(8)}≈ ${usd(p.caps.usd)}${v.preview ? `  ${path.join(dir, 'presentation', v.preview)}` : ''}`);
    if (v.note) say(`  ${''.padEnd(22)}${v.note}`);
  }
  const asked = (st.stages.animate || {}).asked;
  if (!todo.length) { say('Every piece is made.'); return; }
  if (asked && todo.every((p) => (asked.keys || []).includes(p.key)) && asked.usd + 0.005 >= total) {
    say(`The user said yes to ≈ ${usd(asked.usd)}. Next: ${tool('flpt-scene')} open "${dir}" --piece ${todo[0].key}`);
    return;
  }
  say(`Ask once (AskUserQuestion), with the amount: Make ${todo.length === 1 ? 'the Live Motion piece' : `the ${todo.length} Live Motion pieces`} for about ${usd(total)} of your Claude usage (≈ ${todo.length * PIECE_MINUTES} min)?`);
  say(`With a yes: ${tool('flpt-scene')} go "${dir}" --usd ${Math.ceil(total)}`);
  const hf = hyperframes();
  if (!hf || !hf.browser) say(`HyperFrames ${HF_VERSION} isn't on this Mac yet: the first open fetches it (online, a few minutes).`);
}

function cmdGo(dir, st, values) {
  const amount = Number(values.usd);
  if (!Number.isFinite(amount) || amount < 0) throw usage('go needs --usd <the amount the user said yes to>.');
  if (!episode().canRun(st, 'animate')) throw new Error('Approve the script first.');
  const todo = toMake(dir);
  if (!todo.length) throw new Error('Every Live Motion piece is made.');
  const total = sumUsd(todo);
  if (amount + 0.005 < total) throw new Error(`Making them comes to about ${usd(total)}, more than the ${usd(amount)} the user said yes to. Ask again with the amount.`);
  episode().setStage(dir, 'animate', { asked: { usd: +amount.toFixed(2), keys: todo.map((p) => p.key), at: new Date().toISOString() } });
  say(`Recorded: the user said yes to about ${usd(amount)} for ${todo.length} piece${todo.length === 1 ? '' : 's'}.`);
  say(`Next: ${tool('flpt-scene')} open "${dir}" --piece ${todo[0].key}`);
}

function cmdOpen(dir, st, values) {
  const key = values.piece;
  if (typeof key !== 'string' || !livemotion().KEY.test(key)) throw usage('open needs --piece slide:<id> or between:<id>.');
  if (!episode().canRun(st, 'animate')) throw new Error('Approve the script first.');
  const piece = livemotion().pieceOf(dir, key);
  const asked = (st.stages.animate || {}).asked;
  if (!asked || !(asked.keys || []).includes(key)) throw new Error('The user hasn\'t said yes to making this piece: show them the amount first (flpt-scene pieces).');
  const lock = readLock();
  if (lock && !(realOf(lock.episode) === realOf(dir) && lock.key === key)) throw new Error(`Another piece is open (${lock.key}): finish it first (flpt-scene finish).`);
  const me = process.env.CLAUDE_CODE_SESSION_ID || null;
  const busy = readCrew();
  // another session's crew, its piece no longer open, can't touch this one (its calls are its session's)
  if (busy && !(me && busy.session !== me && !lock)) {
    throw new Error(lock ? `Its crew is still at work: wait for it. If it was stopped (Esc, a closed window) and won't come back: ${tool('flpt-scene')} finish "${dir}" --crew-gone`
      : `A scene crew is still at work: wait for it (its marker goes ${CREW_IDLE_MINUTES} minutes after its last step).`);
  }
  // its renders run in the sandbox, offline: HyperFrames and its headless Chrome are fetched now if need be
  const hf = fetchHyperframes();
  if (!hf) throw new Error(`HyperFrames ${HF_VERSION} and its headless Chrome aren't on this Mac and couldn't be fetched: try again online, or open the Mac app's Setup once.`);
  const t = tools();
  if (!t.ffmpeg || !t.ffprobe) throw new Error('ffmpeg isn\'t on this Mac: run /flpt:setup, or open the Mac app\'s Setup once.');
  const folder = livemotion().folderOf(dir, piece);
  const readDeny = scenecrew().readDenyFor(dir, piece, stylesOf());
  writeJsonAtomic(lockFile(), { schema: 'flpt.scenelock/1', episode: dir, presDir: path.join(dir, 'presentation'), key, folder, readDeny,
    session: me, at: new Date().toISOString() });
  say(`Open: ${key} (${livemotion().TILE[piece.kind]}, ${where(piece)}). While it is, only its crew's four files in ${piece.folder}/ can be written.`);
  say('Start its crew with the Agent tool, and wait for it to finish (not in the background):');
  say(`  subagent_type: ${AGENT}`);
  say(`  description: Live Motion ${key}`);
  say(`  prompt: Make the Live Motion piece ${key} of "${st.title}". Your first command: ${tool('flpt-scene')} brief "${dir}"`);
  say('  run_in_background: false');
  say(`When it's back: ${tool('flpt-scene')} finish "${dir}". If it was stopped (Esc) and won't come back: the same with --crew-gone.`);
}

/** The house rules, the crew's commands, and the app's own scene prompt for the open piece, filled as the app fills it. */
function brief(lock) {
  const st = episode().read(lock.episode);
  const vars = scenecrew().promptVars(lock.episode, lock.key, { title: st.title, engineRoot: ROOT, styles: stylesOf() });
  const { prompt, house } = app('agents').stagePrompt({ stageId: 'scene', engineRoot: ROOT, vars });
  const q = JSON.stringify(lock.episode);
  const c = (cmd, more = '') => `\`${tool('flpt-scene')} ${cmd} ${q}${more}\``;
  const rel = path.relative(lock.presDir, lock.folder);
  const adapter = [
    '## In Claude Code',
    `You're FLPT's scene crew (${AGENT}), working for the user's session on one piece: ${lock.key}. You work in \`${lock.presDir}\`, and the paths in your brief are relative to it. You write only \`scene.js\`, \`beats.json\`, \`notes.md\` and \`kit-ext.js\` in \`${rel}/\`, with Write and Edit. You read only this episode and the method: the guard refuses anything else.`,
    '- **Your `flpt` tools are commands here** (the shell runs these and nothing else):',
    `  - \`start_scene\`: ${c('start')} (add \`--fresh\` to start again)`,
    `  - \`use_picture\`: ${c('picture', ' <path inside presentation/>')}`,
    `  - \`use_reference\`: ${c('reference', ' [<ref>]')}`,
    `  - \`use_previous_frame\`: ${c('previous')}`,
    `  - \`narration_timing\`: ${c('timing')}`,
    `  - \`align_beats\`: ${c('align')}`,
    `  - \`align_music\`: ${c('music')}`,
    `  - \`lint_scene\`: ${c('lint')}`,
    `  - \`snapshot\`: ${c('snapshot', ' --at 2.5,9')}`,
    `  - \`render_preview\`: ${c('render')} (add \`--at 2.5,9\` for frames of your own)`,
    `  - \`contact_sheet\`: ${c('sheet')}`,
    `  - \`compare_with_reference\`: ${c('compare-ref', ' [<ref>]')}`,
    `  - \`compare_with_slide\`: ${c('compare')}`,
    `  - \`check_bubble\`: ${c('bubble')}`,
    `  - \`listen\`: ${c('sound')}`,
    `  - \`done\`: ${c('done', ' --fixed "<what one pass fixed>" --fixed "<what the next fixed>"')} (one \`--fixed\` per pass; \`--report "…"\` optional)`,
    '- **Looking** is opening the stills and sheets these commands print with Read.',
    `- **Turns:** finish within ${livemotion().pieceOf(lock.episode, lock.key).caps.turns} turns, the app's cap for this piece.`,
    '- **No web, no other command, no skills:** everything the piece needs is local.',
    '- **When the piece is done,** give your report and stop: the user\'s session takes it from there.',
  ].join('\n');
  return `${house.trim()}\n\n${adapter}\n\n${prompt.trim()}`;
}

/** The crew's command on the open piece: the app tool's own answer. */
async function crewCommand(cmd, lock, rest, values) {
  if (cmd === 'brief') return brief(lock);
  const t = toolsFor(lock);
  const at = String(values.at || '').split(',').filter(Boolean).map(Number);
  switch (cmd) {
    case 'start': return t.start({ fresh: Boolean(values.fresh) });
    case 'picture': if (!rest[0]) throw usage('picture needs a path inside presentation/.'); return t.usePicture({ path: rest[0] });
    case 'reference': return t.useReference({ ref: rest[0] });
    case 'previous': return t.usePreviousFrame();
    case 'timing': return t.narrationTiming();
    case 'align': return t.alignBeats();
    case 'music': return t.alignMusic();
    case 'lint': return t.lintScene();
    case 'snapshot': return t.snapshot({ at });
    case 'render': return t.renderPreview({ at: at.length ? at : undefined });
    case 'sheet': return t.contactSheet();
    case 'compare': return t.compareWithSlide();
    case 'compare-ref': return t.compareWithReference({ ref: rest[0] });
    case 'bubble': return t.checkBubble();
    case 'sound': return t.listen();
    case 'done': return t.done({ fixed: values.fixed || [], report: values.report || '' });
    default: throw usage(`Unknown command: ${cmd}`);
  }
}

/**
 * The crew is back (or gave up): the piece kept as a take as the app keeps it (scenecrew.finish: a piece marked done
 * and not changed since is ok; otherwise the last finished take stays current), its entry in the episode's record, Live
 * Motion ready for the user's review once a piece is made, and the lock lifted whatever happens.
 */
function cmdFinish(dir, values = {}) {
  const lock = readLock();
  if (!lock) throw new Error('No piece is open.');
  if (realOf(lock.episode) !== realOf(dir)) throw new Error(`The open piece is in another episode: ${lock.episode}.`);
  const c = readCrew();
  // the crew of this piece's session (another session's crew isn't this piece's)
  if (c && !(lock.session && c.session !== lock.session)) {
    // --crew-gone: only where the guard still knows the crew's calls once it's let go (Claude Code names the agent, or
    // the user has written since it started: a crew still at work is never left without its rules)
    if (!values['crew-gone']) throw new Error(`Its crew is still at work: wait for it. If it was stopped (Esc, a closed window) and won't come back: ${tool('flpt-scene')} finish "${dir}" --crew-gone`);
    if (!c.named && !c.prompted) throw new Error(`Its crew may still be at work in another session: wait for it (its marker goes ${CREW_IDLE_MINUTES} minutes after its last step).`);
    touchCrew(c.session, { released: new Date().toISOString() });
  }
  const lm = livemotion();
  try {
    const piece = lm.pieceOf(dir, lock.key);
    let done;
    try { done = scenecrew().finish(dir, piece.key, { ok: true, costUsd: null }); } catch (e) { done = { ok: false, error: String(e && e.message ? e.message : e), take: null }; }
    const rec = lm.recordOf(dir, piece);
    const cs = lm.crewState(dir, piece);
    lm.noteLive(dir, piece, { status: done.ok ? 'ok' : 'failed', error: done.error ? String(done.error).slice(0, 400) : null, note: done.note || null,
      takes: lm.takesOf(dir, piece).map(({ n, at, costUsd, ok, preview }) => ({ n, at, costUsd, ok, preview })), current: rec && rec.take ? rec.take : null,
      report: cs && cs.done && cs.done.report ? String(cs.done.report).slice(0, 8000) : null, approved: false });
    const made = lm.view(dir).some((v) => v.status === 'ok');
    const a = episode().read(dir).stages.animate || {};
    if (made && a.status !== 'approved') episode().setStage(dir, 'animate', { status: 'review', error: null, crew: null });
    const v = lm.view(dir).find((x) => x.key === piece.key) || {};
    say(done.ok ? `Made: ${piece.key} (take ${done.take ? done.take.n : '?'}, ${v.rounds} look-fix-render passes, ${v.renders ? v.renders.draft : 0} draft renders).` : `Not made: ${done.error}`);
    if (v.preview) say(`Preview: ${path.join(dir, 'presentation', v.preview)}`);
    if (v.unlisted && v.unlisted.length) say(`On screen and not in the script or the deck (show the user): ${v.unlisted.join(', ')}`);
    const next = toMake(dir).find((p) => p.key !== piece.key);
    if (next) say(`Next: ${tool('flpt-scene')} open "${dir}" --piece ${next.key}`);
    else say(`Every piece is done: show the user the previews. Approved: ${tool('flpt-episode')} approve "${dir}" animate`);
  } finally {
    fs.rmSync(lockFile(), { force: true });
  }
}

async function run() {
  const { values, positionals } = cli(USAGE, OPTIONS);
  const [cmd, ...rest] = positionals;
  if (!MAIN.includes(cmd) && !CREW_COMMANDS.includes(cmd)) usageError(USAGE, cmd ? `Unknown command: ${cmd}` : '');
  try {
    if (MAIN.includes(cmd)) {
      const { dir, st } = open(rest[0]);
      if (cmd === 'pieces') return cmdPieces(dir, st);
      if (cmd === 'go') return cmdGo(dir, st, values);
      if (cmd === 'open') return cmdOpen(dir, st, values);
      return cmdFinish(dir, values);
    }
    // the crew's: always the open piece, whatever else it names
    const lock = readLock();
    if (!lock) throw new Error('No piece is open. The user\'s session opens one (flpt-scene open).');
    const args = [...rest];
    if (args[0] && exists(path.join(path.resolve(args[0]), 'flpt-project.json'))) {
      if (realOf(args[0]) !== realOf(lock.episode)) throw new Error(`The open piece is in ${lock.episode}.`);
      args.shift();
    }
    say(await crewCommand(cmd, lock, args, values));
    return 0;
  } catch (e) {
    if (e.usage) usageError(USAGE, e.message);
    throw e;
  }
}

if (require.main === module) main(run);

module.exports = { CREW, readLock, readCrew, readCrewMarker, touchCrew, lockFile, crewFile, stateDir, writeJsonAtomic, sawPicture, liveEnv, hyperframes,
  fetchHyperframes, headlessShell, brief, HF_VERSION, toolsFor, CREW_COMMANDS, MAIN, AGENT, LOCK_HOURS, CREW_IDLE_MINUTES };
