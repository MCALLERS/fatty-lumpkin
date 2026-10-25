#!/usr/bin/env node
'use strict';
// An FLPT episode in Claude Code, through the Mac app's own code (flow.js, episode.js, agents.js, modules.js):
//   new       the method's scaffold plus flpt-project.json, so the same folder opens in the app
//   status    where the episode is, step by step
//   modules   the deck's modules, for the user's calls
//   call      record a call for the deck (with files, links or Library items), or remove one
//   prompt    a step's instructions: the app's prompt for it, filled the way the app fills it (an animator's: one per
//             marked slide; the Storyboard's crew sends its edits through flpt-storyboard)
//   approve   the user approved a step (--jazz: approved on the way in a Jazz plan, by Jazz)
// Every step has its next move (NEXT): the Storyboard (flpt-storyboard), Live Motion (the flpt-scene-crew subagent
// through flpt-scene, and animators through flpt-animate), Scenes, Spend and Film (flpt-film), Refine and Deliver.
const fs = require('fs');
const path = require('path');
const { ROOT, app, places, tools, episodeDir, pipeline, flowFor, episodeFlow, library, cli, usageError, main, say, exists } = require('./common');

const USAGE = `
Usage: flpt-episode <command> …
  new --title "<title>" [--minutes 3|5|8|12|15] [--point "…"] [--audience "…"] [--tone "…"]
      [--bring idea|notes|script] [--material-file <file>] [--series "…"] [--habits "…"]
  status [<episode>]
  modules
  call [<episode>] --module <id> --ask "<what the user wants>" [--slide <n>] [--attach <file>]… [--link <url>]… [--item <id>]…
  call [<episode>] --remove <call id>
  prompt [<episode>] bullets|factcheck|storyboard|deck|script [--notes "<the user's notes on the last version>"]
  prompt [<episode>] animate --slide <n> [--notes "…"]
  approve [<episode>] <step> [--jazz]
<episode> is the episode's folder (default: the one you're in, else the newest).`;

const OPTIONS = {
  title: { type: 'string' }, minutes: { type: 'string' }, point: { type: 'string' }, audience: { type: 'string' }, tone: { type: 'string' },
  bring: { type: 'string' }, 'material-file': { type: 'string' }, series: { type: 'string' }, habits: { type: 'string' },
  module: { type: 'string' }, ask: { type: 'string' }, slide: { type: 'string' }, attach: { type: 'string', multiple: true },
  link: { type: 'string', multiple: true }, item: { type: 'string', multiple: true }, remove: { type: 'string' },
  notes: { type: 'string' }, 'notes-file': { type: 'string' }, jazz: { type: 'boolean' },
};

const episode = app('episode');
const modules = app('modules');
const STEPS = episode.STAGE_IDS;
const AGENT = episode.STAGES.filter((s) => s.kind === 'agent').map((s) => s.id);
const label = (id) => episode.STAGES.find((s) => s.id === id).label;
const tool = (name) => `node "${path.join(__dirname, `${name}.js`)}"`;

/** An FLPT episode: its folder and its record (flpt-project.json). One made by a newer FLPT is refused, untouched. */
function open(arg) {
  const dir = episodeDir(arg);
  const st = episode.read(dir);
  if (!st) throw new Error(`${dir} has no flpt-project.json, so it isn't an FLPT episode. Start one with /flpt:new.`);
  const tooNew = episode.tooNew(st);
  if (tooNew) throw new Error(tooNew);
  return { dir, st, flow: episodeFlow(dir) };
}

/** Is the episode's plan Jazz (Let FLPT play jazz), approved? Then the steps after it go on without stopping. */
function jazzOf(st) {
  const s = st.stages.storyboard;
  return Boolean(s && s.status === 'approved' && !s.skipped && s.mode === 'jazz');
}

/** Each step's next move, in one line (every stage has one: a test holds it to episode.STAGE_IDS and the skill). */
const NEXT = {
  intake: (dir) => `Intake: ${tool('flpt-episode')} new --title "…" (the episode at ${dir} has no intake yet).`,
  bullets: (dir, st) => agentNext(dir, st, 'bullets'),
  factcheck: (dir, st) => agentNext(dir, st, 'factcheck'),
  storyboard(dir, st) {
    const q = JSON.stringify(dir);
    const s = st.stages.storyboard;
    if (s.status === 'review' || s.status === 'stale') return `Storyboard: ${tool('flpt-storyboard')} show ${q}, then the user's way: Let FLPT play jazz (approve --mode jazz) or User directed (their edits, then approve --mode directed).`;
    return `Storyboard: ${tool('flpt-storyboard')} show ${q} (the plan, free, with ≈ time and ≈ US dollars), then ask: Let FLPT play jazz or User directed. Jazz: ${tool('flpt-episode')} prompt ${q} storyboard, then ${tool('flpt-storyboard')} approve ${q} --mode jazz.`;
  },
  deck: (dir, st) => agentNext(dir, st, 'deck'),
  script: (dir, st) => agentNext(dir, st, 'script'),
  animate(dir, st) {
    const q = JSON.stringify(dir);
    const s = st.stages.animate;
    const marked = app('animators').marked(dir).map((x) => x.n);
    const pieces = app('livemotion').pieces(dir);
    const todo = new Set(app('scenecrew').toMake(dir).map((p) => p.key));
    const parts = [];
    if (pieces.length) {
      parts.push(todo.size ? `${todo.size} Live Motion piece${todo.size === 1 ? '' : 's'} to make, each by the flpt-scene-crew subagent: ${tool('flpt-scene')} pieces ${q} (the amount to ask about once, then go, open, the crew, finish)`
        : `the ${pieces.length} Live Motion piece${pieces.length === 1 ? ' is' : 's are'} made: show the user the previews`);
    }
    if (marked.length) parts.push(`slide${marked.length === 1 ? '' : 's'} ${marked.join(', ')} marked for an animation of ${marked.length === 1 ? 'its' : 'their'} own: ${tool('flpt-episode')} prompt ${q} animate --slide <n> for each`);
    const approve = `${tool('flpt-episode')} approve ${q} animate${jazzOf(st) ? ' --jazz' : ''}`;
    if (s.status === 'review' && !todo.size) return `Live Motion is ready: ${parts.join('; ')}. Approved: ${approve}`;
    return `Live Motion: ${parts.join('; ') || 'nothing to make'}. To go on without ${todo.size || marked.length ? 'them' : 'it'}: ${approve}`;
  },
  scenes(dir, st) {
    // Generated Cosmos cartoons and cut scenes are made in the Mac app's Scenes step (Kie.ai or Higgsfield, each step
    // approved there); in Claude Code they're drawn in code (Live Motion) or keep their placeholders.
    const p = app('scenes').plan(dir);
    const n = p.cartoons.length + p.cutscenes.length;
    return `Scenes: ${n} cartoon${n === 1 ? ' or cut scene' : 's and cut scenes'} planned, made in the Mac app. To go on with their placeholders: ${tool('flpt-episode')} approve ${JSON.stringify(dir)} scenes${jazzOf(st) ? ' --jazz' : ''}`;
  },
  spend: (dir) => `Spend: the free draft (${tool('flpt-film')} ${JSON.stringify(dir)} --draft), then the estimate (--check), then ask the user.`,
  film(dir, st) {
    const q = JSON.stringify(dir);
    return st.stages.film.status === 'review' ? `Film is ready: show the video. Approved: ${tool('flpt-episode')} approve ${q} film`
      : `Film: only after the user said yes to the estimate: ${tool('flpt-film')} ${q} --final --approved <amount> (a dialog on the Mac asks the user too)`;
  },
  refine(dir, st) {
    // Add-ons on the finished film are the Mac app's Refine step; with none, delivering approves it on the way.
    const q = JSON.stringify(dir);
    const s = st.stages.refine;
    const n = (st.addons || []).length;
    const tight = Boolean(st.tighten && st.tighten.on);
    if (!n && tight && s.status !== 'review') return `Refine: tightening is on: ${tool('flpt-film')} ${q} --tighten on applies it (free), then show the video.`;
    if (!n && !tight) return `Deliver: ${tool('flpt-film')} ${q} --deliver (Refine, the Mac app's optional add-ons step, has nothing to add).`;
    if (!n) return `Refine: tightened: show the video. Approved: ${tool('flpt-episode')} approve ${q} refine`;
    return s.status === 'review' ? `Refine: ${n} add-on${n === 1 ? '' : 's'} applied in the Mac app: show the refined video. Approved: ${tool('flpt-episode')} approve ${q} refine`
      : `Refine: ${n} add-on${n === 1 ? '' : 's'} to apply in the Mac app (or remove there), then deliver.`;
  },
  deliver(dir, st) {
    const q = JSON.stringify(dir);
    return st.stages.deliver.status === 'approved' ? `Delivered. After the user's own edit, the Slack pack: ${tool('flpt-film')} ${q} --slack <their export>`
      : `Deliver: ${tool('flpt-film')} ${q} --deliver`;
  },
};

/** A crew step's next move: its prompt, or (ready) the user's review, or in a Jazz plan its approval on the way. */
function agentNext(dir, st, id) {
  const q = JSON.stringify(dir);
  if (st.stages[id].status !== 'review') return `${label(id)}: ${tool('flpt-episode')} prompt ${q} ${id}`;
  if (jazzOf(st) && (id === 'deck' || id === 'script')) return `${label(id)} is ready. Jazz goes on: ${tool('flpt-episode')} approve ${q} ${id} --jazz`;
  return `${label(id)} is ready: show it to the user. Approved: ${tool('flpt-episode')} approve ${q} ${id}`;
}

/** What to do next, in one line. */
function next(dir, st) {
  return NEXT[episode.current(st)](dir, st);
}

function showCalls(st) {
  for (const c of st.calls || []) {
    const m = modules.byId(c.module);
    const files = (c.attachments || []).map((a) => (a.kind === 'link' ? a.url : a.path));
    say(`  ${c.id} · ${m ? m.name : c.module} · ${c.slide ? `slide ${c.slide}` : 'wherever it fits'} · "${c.ask}"${files.length ? `\n       ${files.join('\n       ')}` : ''}`);
  }
}

async function cmdNew(values) {
  if (!values.title || !values.title.trim()) throw Object.assign(new Error('new needs --title.'), { usage: true });
  if (values.minutes && ![3, 5, 8, 12, 15].includes(Number(values.minutes))) throw Object.assign(new Error('--minutes is 3, 5, 8, 12 or 15.'), { usage: true });
  if (values.bring && !['idea', 'notes', 'script'].includes(values.bring)) throw Object.assign(new Error('--bring is idea, notes or script.'), { usage: true });
  const material = values['material-file'] ? fs.readFileSync(path.resolve(values['material-file']), 'utf8') : '';
  if (!tools().python) throw new Error('Python 3 isn\'t installed (brew install python). /flpt:setup checks everything FLPT needs.');
  const root = places().projects;
  const pl = pipeline(null);
  const lines = [];
  const scaffold = pl.scaffold;
  pl.scaffold = (dir, base, opts = {}) => scaffold(dir, base, { ...opts, onLine: (l) => lines.push(l) });
  let dir;
  try {
    dir = await flowFor(root, { pipeline: pl }).create({ ...values, minutes: Number(values.minutes) || 5, material });
  } catch (e) {
    throw new Error(`${e.message}\n${lines.slice(-12).join('\n')}`);
  }
  say(`Episode: ${dir}`);
  say(`Next: ${next(dir, episode.read(dir))}`);
}

function cmdStatus(arg) {
  const { dir, st } = open(arg);
  say(`${st.title} (${st.intake.minutes} min)`);
  say(`Folder: ${dir}`);
  const MARK = { approved: '✓', review: '▸', running: '▸', stale: '!', error: '✗' };
  const WORD = { review: 'ready for the user', running: 'in progress', stale: 'out of date: an earlier step changed (redo it, or approve it as it is)', error: 'failed' };
  for (const id of STEPS) {
    const s = st.stages[id];
    const extra = id === 'spend' && s.usd ? ` (${s.usd.toFixed(2)} US dollars)` : id === 'deliver' && s.folder ? ` → ${s.folder}` : '';
    say(`  ${MARK[s.status] || '·'} ${label(id).padEnd(12)}${WORD[s.status] || (s.status === 'approved' ? 'approved' : '')}${extra}${s.error ? `: ${s.error}` : ''}`.trimEnd());
  }
  if ((st.calls || []).length) { say('Calls for the deck:'); showCalls(st); }
  say(`Next: ${next(dir, st)}`);
}

function cmdModules() {
  say(`The ${modules.MODULES.length} deck modules. Record a call with: ${tool('flpt-episode')} call <episode> --module <id> --ask "…"`);
  for (const m of modules.MODULES) say(`  ${m.id.padEnd(13)}${m.name}: ${m.short}\n${' '.repeat(15)}e.g. "${m.ask}"\n${' '.repeat(15)}This version makes ${m.now}.`);
}

async function cmdCall(arg, values) {
  const { dir, flow } = open(arg);
  if (values.remove) { flow.removeCall(dir, values.remove); say(`Removed call ${values.remove}.`); return; }
  if (!values.module || !values.ask) throw Object.assign(new Error('call needs --module and --ask (or --remove <id>).'), { usage: true });
  if (!modules.byId(values.module)) throw Object.assign(new Error(`--module is one of: ${modules.IDS.join(', ')}.`), { usage: true });
  // Check files and Library items before recording anything, so a bad one leaves no half-made call.
  const files = (values.attach || []).map((f) => path.resolve(f));
  for (const f of files) if (!exists(f)) throw new Error(`${f} isn't there.`);
  const links = [...(values.link || [])];
  if (values.item && values.item.length) {
    const lib = library();
    for (const id of values.item) {
      const it = lib.get(id);
      if (it.filePath && exists(it.filePath)) files.push(it.filePath);
      else if (it.source && it.source.url) links.push(it.source.url);
      else throw new Error(`Library item ${id} has no file or link to attach.`);
    }
  }
  const view = flow.addCall(dir, { module: values.module, slide: values.slide, ask: values.ask });
  const id = view.calls[view.calls.length - 1].id;
  try {
    if (files.length) await flow.attachFiles(dir, id, files);
    for (const u of links) flow.addCallLink(dir, id, u);
  } catch (e) {
    flow.removeCall(dir, id);
    throw e;
  }
  say(`Recorded call ${id}:`);
  showCalls({ calls: episode.read(dir).calls.filter((c) => c.id === id) });
}

/** An animator's instructions for one marked slide: the app's prompt, with its tools as flpt-animate commands. */
function animatePrompt(dir, st, values, notes) {
  const animators = app('animators');
  const slide = animators.marked(dir).find((s) => s.n === Number(values.slide));
  if (!slide && !animators.marked(dir).length) throw new Error(`No slide is marked for an animation of its own. The deck's Live Motion pieces are made by the flpt-scene-crew subagent: ${tool('flpt-scene')} pieces "${dir}"`);
  if (!slide) throw Object.assign(new Error(`--slide is one of the slides marked for an animation: ${animators.marked(dir).map((s) => s.n).join(', ')}.`), { usage: true });
  episode.setStage(dir, 'animate', { status: 'running', feedback: notes || null });
  episode.setStage(dir, 'animate', { status: 'review' });
  const { prompt, house } = app('agents').stagePrompt({ stageId: 'animate', engineRoot: ROOT, vars: animators.promptVars(dir, slide, st.title), feedback: notes });
  const a = (c) => `\`node "${path.join(__dirname, 'flpt-animate.js')}" ${c} "${dir}" --slide ${slide.n}\``;
  const adapter = [
    '## In Claude Code',
    `You're the animator, in chat with the user. You work in \`${path.join(dir, 'presentation')}\`, and the paths in your stage are relative to it. Read only this episode and the method, and write only inside \`hyperframes/slide_${String(slide.n).padStart(2, '0')}/\`.`,
    '- **Your `flpt` tools are commands here:**',
    `  - \`start_slide\`: ${a('start')} (add \`--from whiteboard-sketch\` and the like, \`--fresh\` to start again)`,
    `  - \`use_picture\`: ${a('picture')} followed by the picture's path`,
    `  - \`narration_timing\`: ${a('timing')}`,
    `  - \`align_beats\`: ${a('align')}`,
    `  - \`snapshot\`: ${a('snapshot')} --at 2.5,9`,
    `  - \`render_preview\`: ${a('render')} (add \`--at 2.5,9\` for frames of your own)`,
    `  - \`compare_with_slide\`: ${a('compare')}`,
    `- **When the slide is done:** ${a('done')}, then give your report and stop: the user approves Live Motion or asks for changes.`,
    '- **The shell** is for these commands, nothing else. No web: everything the slide needs is local.',
  ].join('\n');
  say(`${house.trim()}\n\n${adapter}\n\n${prompt.trim()}`);
}

function cmdPrompt(rest, values) {
  if (rest.includes('animate')) {
    const { dir, st } = open(rest.find((r) => r !== 'animate'));
    if (!episode.canRun(st, 'animate')) throw new Error(`Approve ${label(STEPS.slice(1).find((id) => st.stages[id].status !== 'approved'))} first.`);
    return animatePrompt(dir, st, values, values['notes-file'] ? fs.readFileSync(path.resolve(values['notes-file']), 'utf8') : values.notes || '');
  }
  const step = rest.find((r) => AGENT.includes(r));
  if (!step) throw Object.assign(new Error(`prompt needs a step: ${[...AGENT, 'animate'].join(', ')}.`), { usage: true });
  const { dir, st, flow } = open(rest.find((r) => r !== step));
  if (!episode.canRun(st, step)) throw new Error(`Approve ${label(STEPS.slice(1).find((id) => st.stages[id].status !== 'approved'))} first.`);
  // the plan is read-only once the script is approved (as the app hides Polish then)
  if (step === 'storyboard') app('ext/storyboard').editable(episode, dir);
  const notes = values['notes-file'] ? fs.readFileSync(path.resolve(values['notes-file']), 'utf8') : values.notes || '';
  // The placeholders the app's crew gets, its flow extensions' included (stageVars hooks), before anything changes. As
  // in the app, an extension's hook that fails ends the step as an error, with why.
  let vars;
  try {
    vars = flow.stageVars(dir, step);
  } catch (e) {
    if (e && e.name === 'HookError') episode.setStage(dir, step, { status: 'error', error: String(e.message).slice(0, 400) });
    throw e;
  }
  // As in the app: redoing a step re-opens what was built on it. Then it waits for the user's review.
  episode.setStage(dir, step, { status: 'running', feedback: notes || null });
  episode.setStage(dir, step, { status: 'review' });
  const { prompt, house } = app('agents').stagePrompt({ stageId: step, engineRoot: ROOT, vars, feedback: notes });
  say(`${house.trim()}\n\n${adapterFor(dir, step).trim()}\n\n${prompt.trim()}`);
}

/**
 * The Claude Code notes (prompts/_claude-code.md) for a crew step: its flpt tools as commands, what it writes, its web.
 * The Storyboard's crew writes no file: its one tool, save_storyboard, sends its edits to flpt-storyboard.
 */
function adapterFor(dir, step) {
  const web = episode.STAGES.find((s) => s.id === step).web;
  const q = JSON.stringify(dir);
  const library = [
    `  - \`search_library\`: \`node "${__dirname}/flpt-library.js" search <words> [--kind <kind>]\``,
    `  - \`use_library_item\`: \`node "${__dirname}/flpt-library.js" use <id> "${dir}"\``,
  ];
  const list = step === 'storyboard' ? [
    `  - \`save_storyboard\`: every edit in one call, its JSON on standard input:\n    \`\`\`\n    node "${__dirname}/flpt-storyboard.js" save ${q} <<'EDITS'\n    { "edits": [ … ] }\n    EDITS\n    \`\`\``,
    ...library,
  ] : [
    `  - \`check_deck\`: \`node "${__dirname}/flpt-check-deck.js" "${dir}"\``,
    `  - \`script_stats\`: \`node "${__dirname}/flpt-script-stats.js" "${dir}"\``,
    ...library,
    ...(web ? [`  - \`save_to_library\`: \`node "${__dirname}/flpt-library.js" add <link> --crew --title "<title>" [--kind image|article|website|wiki|video-link] [--notes "<why>"]\``] : []),
  ];
  return app('agents').fill(fs.readFileSync(path.join(ROOT, 'prompts', '_claude-code.md'), 'utf8'), {
    pres: path.join(dir, 'presentation'), tools: list.join('\n'),
    writes: step === 'storyboard' ? 'write no file: your edits go through `save_storyboard`' : 'write only inside the episode',
    web: web ? '**Web search and fetch** are for this step\'s research.' : '**No web** in this step: work from the bullets and their sources.',
  });
}

// What Jazz approves on its own, once the user chose it at the Storyboard (Spend, Film and Deliver stay the user's).
const JAZZ_STEPS = ['deck', 'script', 'animate', 'scenes'];

function cmdApprove(rest, values = {}) {
  const step = rest.find((r) => STEPS.includes(r));
  if (!step) throw Object.assign(new Error(`approve needs a step: ${STEPS.slice(1).join(', ')}.`), { usage: true });
  if (step === 'spend') throw new Error('Spend is approved by filming: flpt-film --final --approved <the amount the user said yes to>.');
  if (step === 'deliver') throw new Error('Deliver with: flpt-film --deliver.');
  if (step === 'storyboard') throw new Error(`The plan is approved with its way: ${tool('flpt-storyboard')} approve <episode> --mode jazz|directed.`);
  const { dir, st: before } = open(rest.find((r) => r !== step));
  if (values.jazz && !jazzOf(before)) throw new Error('This plan isn\'t Jazz: the user approves each step.');
  if (values.jazz && !JAZZ_STEPS.includes(step)) throw new Error('Jazz approves the deck, the script, Live Motion and Scenes on the way; the rest is the user\'s.');
  const lib = library();
  // As in the app, what an approved step made goes to the Library too (the deck's module slides).
  const flow = episodeFlow(dir, { keep: (d, id, extra) => app('crew-library').keep(lib, d, id, extra) });
  const st = flow.approve(dir, step, { by: values.jazz ? 'jazz' : 'you' });
  say(`Approved: ${label(step)}${values.jazz ? ' (Jazz)' : ''}.`);
  say(`Next: ${next(dir, st)}`);
}

if (require.main === module) main(async () => {
  const { values, positionals } = cli(USAGE, OPTIONS);
  const [cmd, ...rest] = positionals;
  try {
    if (cmd === 'new') return await cmdNew(values);
    if (cmd === 'status') return cmdStatus(rest[0]);
    if (cmd === 'modules') return cmdModules();
    if (cmd === 'call') return await cmdCall(rest[0], values);
    if (cmd === 'prompt') return cmdPrompt(rest, values);
    if (cmd === 'approve') return cmdApprove(rest, values);
  } catch (e) {
    if (e.usage) usageError(USAGE, e.message);
    throw e;
  }
  return usageError(USAGE, cmd ? `Unknown command: ${cmd}` : '');
});

module.exports = { NEXT, next, jazzOf, adapterFor, JAZZ_STEPS };
