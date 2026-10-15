#!/usr/bin/env node
'use strict';
// An FLPT episode in Claude Code, through the Mac app's own code (flow.js, episode.js, agents.js, modules.js):
//   new       the method's scaffold plus flpt-project.json, so the same folder opens in the app
//   status    where the episode is, step by step
//   modules   the seven deck modules, for the user's calls
//   call      record a call for the deck (with files, links or Library items), or remove one
//   prompt    a step's instructions: the app's prompt for it, filled the way the app fills it (Animate: one per slide)
//   approve   the user approved a step
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
  prompt [<episode>] bullets|factcheck|deck|script [--notes "<the user's notes on the last version>"]
  prompt [<episode>] animate --slide <n> [--notes "…"]
  approve [<episode>] <step>
<episode> is the episode's folder (default: the one you're in, else the newest).`;

const OPTIONS = {
  title: { type: 'string' }, minutes: { type: 'string' }, point: { type: 'string' }, audience: { type: 'string' }, tone: { type: 'string' },
  bring: { type: 'string' }, 'material-file': { type: 'string' }, series: { type: 'string' }, habits: { type: 'string' },
  module: { type: 'string' }, ask: { type: 'string' }, slide: { type: 'string' }, attach: { type: 'string', multiple: true },
  link: { type: 'string', multiple: true }, item: { type: 'string', multiple: true }, remove: { type: 'string' },
  notes: { type: 'string' }, 'notes-file': { type: 'string' },
};

const episode = app('episode');
const modules = app('modules');
const STEPS = episode.STAGE_IDS;
const AGENT = episode.STAGES.filter((s) => s.kind === 'agent').map((s) => s.id);
const label = (id) => episode.STAGES.find((s) => s.id === id).label;
const tool = (name) => `node "${path.join(__dirname, `${name}.js`)}"`;

/** An FLPT episode: its folder and its record (flpt-project.json). */
function open(arg) {
  const dir = episodeDir(arg);
  const st = episode.read(dir);
  if (!st) throw new Error(`${dir} has no flpt-project.json, so it isn't an FLPT episode. Start one with /flpt:new.`);
  return { dir, st, flow: episodeFlow(dir) };
}

/** What to do next, in one line. */
function next(dir, st) {
  const id = episode.current(st);
  const s = st.stages[id];
  const q = JSON.stringify(dir);
  if (AGENT.includes(id)) {
    return s.status === 'review' ? `${label(id)} is ready: show it to the user. Approved: ${tool('flpt-episode')} approve ${q} ${id}`
      : `${label(id)}: ${tool('flpt-episode')} prompt ${q} ${id}`;
  }
  if (id === 'animate') {
    const marked = app('animators').marked(dir).map((x) => x.n);
    return s.status === 'review' ? `Animate is ready: show the user each slide's preview (hyperframes/slide_NN/renders/preview.mp4). Approved: ${tool('flpt-episode')} approve ${q} animate`
      : `Animate: slide${marked.length === 1 ? '' : 's'} ${marked.join(', ')} ${marked.length === 1 ? 'is' : 'are'} marked for an animation of its own. For each: ${tool('flpt-episode')} prompt ${q} animate --slide <n>. To skip them: approve ${q} animate.`;
  }
  if (id === 'scenes') {
    // Cosmos cartoons and cut scenes are made in the Mac app's Scenes step (Kie.ai or Higgsfield, each step approved there).
    const p = app('scenes').plan(dir);
    const n = p.cartoons.length + p.cutscenes.length;
    return `Scenes: ${n} cartoon${n === 1 ? ' or cut scene' : 's and cut scenes'} planned, made in the Mac app. To go on with their placeholders: ${tool('flpt-episode')} approve ${q} scenes`;
  }
  if (id === 'spend') return `Spend: the free draft (${tool('flpt-film')} ${q} --draft), then the estimate (--check), then ask the user.`;
  if (id === 'film') return s.status === 'review' ? `Film is ready: show the video. Approved: ${tool('flpt-episode')} approve ${q} film`
    : `Film: only after the user said yes to the estimate: ${tool('flpt-film')} ${q} --final --approved <amount>`;
  if (id === 'refine') {
    // Add-ons on the finished film are the Mac app's Refine step; with none, delivering approves it on the way.
    const n = (st.addons || []).length;
    const tight = Boolean(st.tighten && st.tighten.on);
    if (!n && tight && s.status !== 'review') return `Refine: tightening is on: ${tool('flpt-film')} ${q} --tighten on applies it (free), then show the video.`;
    if (!n && !tight) return `Deliver: ${tool('flpt-film')} ${q} --deliver (Refine, the Mac app's optional add-ons step, has nothing to add).`;
    if (!n) return `Refine: tightened: show the video. Approved: ${tool('flpt-episode')} approve ${q} refine`;
    return s.status === 'review' ? `Refine: ${n} add-on${n === 1 ? '' : 's'} applied in the Mac app: show the refined video. Approved: ${tool('flpt-episode')} approve ${q} refine`
      : `Refine: ${n} add-on${n === 1 ? '' : 's'} to apply in the Mac app (or remove there), then deliver.`;
  }
  return s.status === 'approved' ? `Delivered. After the user's own edit, the Slack pack: ${tool('flpt-film')} ${q} --slack <their export>`
    : `Deliver: ${tool('flpt-film')} ${q} --deliver`;
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
    say(`  ${MARK[s.status] || '·'} ${label(id).padEnd(11)}${WORD[s.status] || (s.status === 'approved' ? 'approved' : '')}${extra}${s.error ? `: ${s.error}` : ''}`.trimEnd());
  }
  if ((st.calls || []).length) { say('Calls for the deck:'); showCalls(st); }
  say(`Next: ${next(dir, st)}`);
}

function cmdModules() {
  say(`The seven deck modules. Record a call with: ${tool('flpt-episode')} call <episode> --module <id> --ask "…"`);
  for (const m of modules.MODULES) say(`  ${m.id.padEnd(12)}${m.name}: ${m.short}\n${' '.repeat(14)}e.g. "${m.ask}"\n${' '.repeat(14)}This version makes ${m.now}.`);
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
  if (!slide) throw Object.assign(new Error(`--slide is one of the slides marked for an animation: ${animators.marked(dir).map((s) => s.n).join(', ') || 'none'}.`), { usage: true });
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
    `- **When the slide is done:** ${a('done')}, then give your report and stop: the user approves Animate or asks for changes.`,
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
  const { dir, st } = open(rest.find((r) => r !== step));
  if (!episode.canRun(st, step)) throw new Error(`Approve ${label(STEPS.slice(1).find((id) => st.stages[id].status !== 'approved'))} first.`);
  const notes = values['notes-file'] ? fs.readFileSync(path.resolve(values['notes-file']), 'utf8') : values.notes || '';
  // As in the app: redoing a step re-opens what was built on it. Then it waits for the user's review.
  episode.setStage(dir, step, { status: 'running', feedback: notes || null });
  episode.setStage(dir, step, { status: 'review' });
  const { prompt, house } = app('agents').stagePrompt({ stageId: step, engineRoot: ROOT, vars: app('flow').stageVars(episode.read(dir)), feedback: notes });
  const web = episode.STAGES.find((s) => s.id === step).web;
  const save = web ? `  - \`save_to_library\`: \`node "${__dirname}/flpt-library.js" add <link> --crew --title "<title>" [--kind image|article|website|wiki|video-link] [--notes "<why>"]\`\n` : '';
  const adapter = app('agents').fill(fs.readFileSync(path.join(ROOT, 'prompts', '_claude-code.md'), 'utf8'), {
    pres: path.join(dir, 'presentation'), dir, tools: __dirname, save,
    web: web ? '**Web search and fetch** are for this step\'s research.' : '**No web** in this step: work from the bullets and their sources.',
  });
  say(`${house.trim()}\n\n${adapter.trim()}\n\n${prompt.trim()}`);
}

function cmdApprove(rest) {
  const step = rest.find((r) => STEPS.includes(r));
  if (!step) throw Object.assign(new Error(`approve needs a step: ${STEPS.slice(1).join(', ')}.`), { usage: true });
  if (step === 'spend') throw new Error('Spend is approved by filming: flpt-film --final --approved <the amount the user said yes to>.');
  if (step === 'deliver') throw new Error('Deliver with: flpt-film --deliver.');
  const { dir } = open(rest.find((r) => r !== step));
  const lib = library();
  // As in the app, what an approved step made goes to the Library too (the deck's module slides).
  const flow = episodeFlow(dir, { keep: (d, id, extra) => app('crew-library').keep(lib, d, id, extra) });
  const st = flow.approve(dir, step);
  say(`Approved: ${label(step)}.`);
  say(`Next: ${next(dir, st)}`);
}

main(async () => {
  const { values, positionals } = cli(USAGE, OPTIONS);
  const [cmd, ...rest] = positionals;
  try {
    if (cmd === 'new') return await cmdNew(values);
    if (cmd === 'status') return cmdStatus(rest[0]);
    if (cmd === 'modules') return cmdModules();
    if (cmd === 'call') return await cmdCall(rest[0], values);
    if (cmd === 'prompt') return cmdPrompt(rest, values);
    if (cmd === 'approve') return cmdApprove(rest);
  } catch (e) {
    if (e.usage) usageError(USAGE, e.message);
    throw e;
  }
  return usageError(USAGE, cmd ? `Unknown command: ${cmd}` : '');
});
