#!/usr/bin/env node
'use strict';
// The Storyboard in Claude Code (PLAN §2.8, §3.5), through the Mac app's own code (storyboard.js and its flow extension
// ext/storyboard.js): the same board, the same edits, the same solver and the same prices, planned for this surface
// (the plugin: every Cosmos and cut scene drawn in code, D13). Nothing here spends: Claude Code runs on the user's own
// account, so the plan's money is shown as about (≈) what it comes to, never asked for.
//   show      the plan, opened the moment the stage is (the strawman: instant, free), with ≈ time and ≈ US dollars,
//             and presentation/storyboard.html to look at
//   brief     the approved plan as the deck crew builds it
//   save      the storyboard crew's edits (the app's save_storyboard tool): FLPT applies the valid ones, runs the solver,
//             saves the board and says what it did
//   set · split · merge · move · add · remove · make   the user's directed edits, one undo step each (set … voice: who
//             narrates a slide with no presenter on screen, W4-11; it keeps an approved plan approved)
//   undo · redo · mode
//   approve   the plan, Jazz (Let FLPT play jazz) or Directed (User directed)
const fs = require('fs');
const path = require('path');
const { ROOT, app, episodeDir, episodeFlow, cli, usageError, main, say, exists } = require('./common');

const USAGE = `
Usage: flpt-storyboard <command> [<episode>] …
  show [<episode>]
  brief [<episode>]
  save [<episode>] [--edits '<json>']          the storyboard crew's edits (JSON on stdin without --edits)
  set [<episode>] <shot> module <module> [--make code]
  set [<episode>] <shot> seconds|title|idea|ask|style <value>
  set [<episode>] <shot> sound [--music none|score:<preset>|library:<track>] [--sfx off|soft|on]
  set [<episode>] <shot> narrated on|off
  set [<episode>] <shot> ref --add <ref> | --remove <ref>
  set [<episode>] <shot> lock on|off
  set [<episode>] <shot> voice presenter|default|<FLPT voice>   who narrates a slide with no presenter on screen
  set [<episode>] style <style>                 the episode's style
  split [<episode>] <shot> --at <line>
  merge [<episode>] <shot> --with <shot>
  move [<episode>] <shot> --to <slide number> | --after <shot>|start
  add [<episode>] --kind solo|cutscene --after <shot>|start [--seconds <n>] [--title "…"] [--idea "…"]
  remove [<episode>] <shot>
  make [<episode>] <shot> code
  undo [<episode>] · redo [<episode>]
  mode [<episode>] jazz|directed
  approve [<episode>] --mode jazz|directed
<episode> is the episode's folder (default: the one you're in, else the newest).`;

const OPTIONS = {
  edits: { type: 'string' }, make: { type: 'string' }, music: { type: 'string' }, sfx: { type: 'string' }, add: { type: 'string' }, remove: { type: 'string' },
  at: { type: 'string' }, with: { type: 'string' }, to: { type: 'string' }, after: { type: 'string' }, kind: { type: 'string' }, seconds: { type: 'string' },
  title: { type: 'string' }, idea: { type: 'string' }, mode: { type: 'string' },
};
const COMMANDS = ['show', 'brief', 'save', 'set', 'split', 'merge', 'move', 'add', 'remove', 'make', 'undo', 'redo', 'mode', 'approve'];

const episode = app('episode');
const storyboard = app('storyboard');
const plan = app('ext/storyboard');
const guest = app('guestvoice');
const guestApi = app('api/guestvoice');

/** What may be planned here: the plugin's caps (no Generated scenes: D13). */
const CAPS = plan.capsFor({ caps: { surface: 'plugin' } });

const usage = (why) => Object.assign(new Error(why), { usage: true });
const SHOT = /^s[1-9][0-9]{0,3}$/;
/** Is this positional an episode folder (rather than a shot or a value)? A path, or a folder here that's an episode. */
const isFolderArg = (a) => typeof a === 'string' && !SHOT.test(a) && (/[/~]/.test(a) || a === '.' || a === '..' || exists(path.join(path.resolve(a), 'flpt-project.json')));

/** An FLPT episode this FLPT can read. */
function open(arg) {
  const dir = episodeDir(arg);
  const st = episode.read(dir);
  if (!st) throw new Error(`${dir} has no flpt-project.json, so it isn't an FLPT episode. Start one with /flpt:new.`);
  const tooNew = episode.tooNew(st);
  if (tooNew) throw new Error(tooNew);
  return { dir, st };
}

// ── what the plan looks like here ────────────────────────────────────────────────────────────────────────────────

const pad2 = (n) => String(n).padStart(2, '0');
const time = (sec) => { const s = Math.max(0, Math.round(sec)); return `${Math.floor(s / 60)}:${pad2(s % 60)}`; };
const usd = (x) => (Math.abs(x - Math.round(x)) < 0.005 ? `$${Math.round(x)}` : `$${x.toFixed(2)}`);
const wall = (min) => { const h = Math.floor(min / 60); const m = Math.round(min % 60); return h ? `${h} h ${m} min` : `${m} min`; };

/** The board's numbers as about-figures: the plugin can't cap the user's own Claude, so it never says "up to". */
function totalsLine(v) {
  const p = v.price;
  return [`≈ ${time(p.seconds)} running`, `≈ ${usd(p.claude.capUsd)} of Claude`, `≈ ${usd(p.heygen.usd)} HeyGen at Film`, `LIVE MOTION ${Math.round(p.live.share * 100)} %`,
    `≈ ${wall(p.crew.minutes)} of crew time`].join(' · ');
}

function stateWord(v) {
  if (v.stage === 'approved') return `approved (${v.mode === 'jazz' ? 'Let FLPT play jazz' : 'User directed'})`;
  if (v.stale) return 'out of date: the bullets changed';
  return v.stage === 'review' ? 'ready for the user' : 'not approved yet';
}

/** A shot's one line when its library track isn't on this computer: the nearest score plays instead (DV13), or null. */
const trackLine = (s) => { const f = s.sound ? app('livemotion').trackFallback(s.sound.music, { engineRoot: ROOT }) : null; return f ? f.line : null; };

/** The shots as one compact table. */
function table(v) {
  const rows = [];
  for (const s of v.shots) {
    const where = s.n ? pad2(s.n) : s.after ? `↳${s.after}` : '↳open';
    const what = `${s.tile}${s.make === 'code' && !s.live ? ' (code)' : ''}${s.style ? ` · ${s.style}` : ''}${s.locked ? ' · locked' : ''}`;
    const words = [s.title ? `"${s.title}"` : '', s.idea].filter(Boolean).join(' · ');
    rows.push(`  ${where.padEnd(7)}${s.id.padEnd(6)}${what.slice(0, 34).padEnd(36)}${String(s.seconds).padStart(4)} s  ${words.slice(0, 110)}`.trimEnd());
    const line = trackLine(s);
    if (line) rows.push(`  ${''.padEnd(13)}${line}`);
  }
  return rows.join('\n');
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
// the module families' colours (PLAN §3.2), light and dark
const FAMILY = { data: ['#22406F', '#8FB0E6'], hand: ['#1C1A15', '#EEE8DA'], build: ['#41603F', '#9CC59A'], story: ['#9A4E1E', '#E0A070'], live: ['#A97A1E', '#E3B860'] };

/** presentation/storyboard.html: the plan as a page (labels only, no script, nothing loaded from the web). */
function writePage(dir, st, v) {
  const fam = (s) => FAMILY[String(s.family || '').toLowerCase()] ? String(s.family).toLowerCase() : 'build';
  const rows = v.shots.map((s) => `<tr class="${s.placement}"><td class="n">${s.n ? pad2(s.n) : '♪'}</td><td class="id">${esc(s.id)}</td>`
    + `<td><span class="chip f-${fam(s)}">${esc(s.tile)}</span>${s.style ? ` <span class="sub">${esc(s.style)}</span>` : ''}${s.locked ? ' <span class="sub">LOCKED</span>' : ''}</td>`
    + `<td class="t">${esc(time(s.seconds))}</td><td><b>${esc(s.title)}</b>${s.idea ? `<div class="sub">${esc(s.idea)}</div>` : ''}${trackLine(s) ? `<div class="sub">${esc(trackLine(s))}</div>` : ''}</td></tr>`).join('\n');
  const css = Object.entries(FAMILY).map(([k, [day]]) => `.f-${k}{color:${day};border-color:${day}}`).join('')
    + `@media (prefers-color-scheme: dark){${Object.entries(FAMILY).map(([k, [, night]]) => `.f-${k}{color:${night};border-color:${night}}`).join('')}}`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${esc(st.title)} · Storyboard</title>
<style>
:root{--paper:#FBF7EE;--card:#FFFFFF;--ink:#1C1A15;--ink2:#4A453B;--rule:#E2D9C6;--gold:#A97A1E}
@media (prefers-color-scheme: dark){:root{--paper:#11110E;--card:#1A1915;--ink:#EEE8DA;--ink2:#B9B2A2;--rule:rgba(238,232,218,.10);--gold:#E3B860}}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.45 -apple-system,"IBM Plex Sans","Helvetica Neue",sans-serif}
main{max-width:1040px;margin:0 auto;padding:40px 16px}
h1{font:600 30px/1.2 Georgia,serif;margin:0 0 6px}
.eyebrow,.line,.chip,.t,.n,.id{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;font-size:12px}
.eyebrow{color:var(--gold)}.line{color:var(--ink2);margin:10px 0 24px;letter-spacing:.06em}
table{width:100%;border-collapse:collapse;background:var(--card)}
td{border-top:1px solid var(--rule);padding:10px 12px;vertical-align:top}
tr.between td{background:transparent}.n{color:var(--gold);width:32px}.id{color:var(--ink2);width:48px}.t{width:56px;text-align:right}
.chip{border:1px solid;border-radius:6px;padding:2px 6px;letter-spacing:.08em;white-space:nowrap}
.sub{color:var(--ink2);font-size:13px}
${css}
</style></head>
<body><main>
<div class="eyebrow">Storyboard · ${esc(stateWord(v))}</div>
<h1>${esc(st.title)}</h1>
<div class="line">${esc(totalsLine(v))}</div>
${v.status.length ? `<div class="line">${esc(v.status.join(' · '))}</div>` : ''}
<table>
${rows}
</table>
</main></body></html>
`;
  const file = path.join(dir, 'presentation', 'storyboard.html');
  fs.writeFileSync(file, html);
  return file;
}

/** The board as the user sees it in chat: one line of ≈ numbers, the shots, what's missing, the page. */
function show(dir, st, v, { page = true } = {}) {
  say(`Storyboard · "${st.title}" · ${st.intake.minutes} min · ${stateWord(v)}`);
  say(totalsLine(v));
  say(table(v));
  for (const line of v.status) say(`  ${line}`);
  if (v.diff && (v.diff.changed || v.diff.removed)) say(`  Re-planned after the bullets changed: ${[v.diff.changed && `${v.diff.changed.length} changed`, v.diff.removed && `${v.diff.removed.length} removed`].filter(Boolean).join(', ')}.`);
  if (v.script) say(`  ${v.script}`);
  if (page) say(`Page: ${writePage(dir, st, v)}`);
}

// ── the commands ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The board as it is now (its strawman written if the stage just opened), or why there's none. */
function viewOf(dir) {
  const v = plan.viewFor(episode, dir, CAPS);
  if (v) return v;
  const st = episode.read(dir);
  const s = st.stages.storyboard;
  if (s && s.status === 'approved' && s.skipped) throw new Error('This episode has no storyboard (it was planned before 2.0, or its bullets have no slides): the deck plans its own modules.');
  throw new Error('The storyboard opens once the fact-check is approved.');
}

/** After an edit: back to review if it un-approved the plan, the stage's mode as the board's; then the plan. */
function after(dir, note) {
  const reopened = plan.reopenIfChanged(episode, dir);
  if (!reopened) plan.recordMode(episode, dir);
  const st = episode.read(dir);
  if (note) say(note);
  if (reopened) say('The plan was approved: it is back for review, and the deck onwards is out of date.');
  show(dir, st, viewOf(dir));
}

/** One directed edit (the user's), validated by storyboard.op; the shots it touches are locked. */
function directed(dir, o, note) {
  plan.editable(episode, dir, o.op);
  viewOf(dir); // the stage open, its strawman written
  storyboard.edit(dir, o, { caps: CAPS });
  after(dir, note);
}

/** The edits, from --edits or stdin: a list of the crew's edits, or { edits: [...] }. */
function readEdits(values) {
  const raw = values.edits != null && values.edits !== '-' ? values.edits : fs.readFileSync(0, 'utf8');
  let j;
  try { j = JSON.parse(raw); } catch { throw new Error('The edits aren\'t JSON: send { "edits": [ … ] }.'); }
  const edits = Array.isArray(j) ? j : j && Array.isArray(j.edits) ? j.edits : null;
  if (!edits) throw new Error('Send { "edits": [ … ] }.');
  if (raw.length > 64 * 1024) throw new Error('Those edits are too long.');
  // the app's tool takes these fields (its schema); anything else is dropped before the solver sees it
  const STR = { shot: 8, with: 8, after: 8, module: 20, style: 60, music: 140, title: 200, idea: 400 };
  return edits.slice(0, storyboard.LIMITS.edits + 1).map((e) => {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return e;
    const out = { op: typeof e.op === 'string' ? e.op.slice(0, 20) : e.op };
    for (const [k, n] of Object.entries(STR)) if (typeof e[k] === 'string') out[k] = e[k].slice(0, n);
    if (e.style === null) out.style = null;
    if (Number.isInteger(e.atBullet)) out.atBullet = e.atBullet;
    if (typeof e.seconds === 'number' && Number.isFinite(e.seconds)) out.seconds = e.seconds;
    if (e.kind === 'solo' || e.kind === 'cutscene') out.kind = e.kind;
    if (['off', 'soft', 'on'].includes(e.sfx)) out.sfx = e.sfx;
    return out;
  });
}

// The app's save_storyboard tool, run here: its definition needs a schema library the plugin doesn't carry, and the
// edits' shape is checked above (readEdits) and again, edit by edit, by storyboard.apply.
const NO_SCHEMA = new Proxy(function schema() { return NO_SCHEMA; }, { get: () => NO_SCHEMA, apply: () => NO_SCHEMA });

async function cmdSave(dir, values) {
  const edits = readEdits(values);
  const st = episode.read(dir);
  const s = st.stages.storyboard;
  if (!s || (s.status === 'approved' && s.skipped)) throw new Error('This episode has no storyboard to edit.');
  if (!episode.canRun(st, 'storyboard')) throw new Error('Approve the fact-check first.');
  plan.editable(episode, dir);
  viewOf(dir);
  // as the app's crew: a polish asked for again works on the plan as it is (an approved one goes back to review)
  const b = storyboard.read(dir);
  if (b && b.approvedAt) { storyboard.write(dir, { ...b, approvedAt: null }); plan.reopenIfChanged(episode, dir); }
  if (s.status !== 'review' && s.status !== 'approved') episode.setStage(dir, 'storyboard', { status: 'review', error: null });
  const tool = storyboard.saveTool({ z: NO_SCHEMA, dir, caps: CAPS });
  const r = await tool.handler({ edits });
  say(r.content.map((c) => c.text).join('\n'));
  writePage(dir, episode.read(dir), viewOf(dir));
}

function cmdSet(dir, rest, values) {
  const [a, b, ...more] = rest;
  if (a === 'style' && !SHOT.test(String(b))) return directed(dir, { op: 'style', id: '', style: b === 'none' ? null : b }, b === 'none' ? 'The episode\'s style is the default again.' : `The episode's style: ${b}.`);
  if (!SHOT.test(String(a))) throw usage('set needs a shot (s1, s2 …) and what to set.');
  const id = a;
  const value = more.join(' ');
  switch (b) {
    case 'module': return directed(dir, { op: 'module', id, module: more[0], ...(values.make ? { make: values.make } : {}) });
    case 'seconds': return directed(dir, { op: 'seconds', id, seconds: Number(more[0]) });
    case 'title': case 'idea': case 'ask': return directed(dir, { op: b, id, [b]: value });
    case 'style': return directed(dir, { op: 'style', id, style: more[0] === 'none' || !more[0] ? null : more[0] });
    case 'sound': {
      if (values.music == null && values.sfx == null) throw usage('set … sound needs --music or --sfx.');
      return directed(dir, { op: 'sound', id, ...(values.music != null ? { music: values.music } : {}), ...(values.sfx != null ? { sfx: values.sfx } : {}) });
    }
    case 'narrated': return directed(dir, { op: 'narrated', id, narrated: more[0] !== 'off' });
    case 'ref': {
      if (values.add == null && values.remove == null) throw usage('set … ref needs --add or --remove.');
      return directed(dir, { op: 'ref', id, ...(values.add != null ? { add: values.add } : {}), ...(values.remove != null ? { remove: values.remove } : {}) });
    }
    case 'lock': return directed(dir, { op: 'lock', id, locked: more[0] !== 'off' });
    case 'voice': return cmdVoice(dir, id, value);
    default: throw usage('set … module, seconds, title, idea, ask, style, sound, narrated, ref, lock or voice.');
  }
}

/** Who narrates a slide with no presenter on screen (W4-11): the presenter, the plan's own, or one of the FLPT voices. */
function cmdVoice(dir, id, value) {
  const name = String(value || '').trim();
  const voice = name === 'presenter' ? null : name === 'default' ? { reset: true } : guest.byName(name);
  if (voice === undefined || (voice === null && name !== 'presenter')) {
    throw usage(`set … voice presenter, default or one of the FLPT voices: ${guest.HOUSE.map((v) => v.name).join(', ')}.`);
  }
  viewOf(dir); // the stage open, its strawman written
  // the plugin has no FLPT voices sign-in of its own yet (W4-10): the Jazz default stays the presenter here
  guestApi.setVoice(dir, id, voice, { caps: CAPS, d: {} });
  after(dir, voice === null ? `${id}: the presenter narrates it.` : voice.reset ? `${id}: the plan's own voice.` : `${id}: narrated by ${voice.name}.`);
}

async function cmdApprove(dir, values) {
  const mode = values.mode;
  if (mode !== 'jazz' && mode !== 'directed') throw usage('approve needs --mode jazz or --mode directed.');
  viewOf(dir);
  plan.readyForApproval(episode, dir);
  // No Claude top-up here: Claude Code runs on the user's own account, and the plan's ≈ amount is in `show`.
  plan.reviewable(episode, dir);
  const st = episodeFlow(dir).approve(dir, 'storyboard', { by: 'you' });
  plan.recordMode(episode, dir, mode);
  say(`Approved: the storyboard (${mode === 'jazz' ? 'Let FLPT play jazz' : 'User directed'}).`);
  show(dir, episode.read(dir), viewOf(dir));
  return st;
}

main(async () => {
  const { values, positionals } = cli(USAGE, OPTIONS);
  const [cmd, ...rest] = positionals;
  if (!COMMANDS.includes(cmd)) usageError(USAGE, cmd ? `Unknown command: ${cmd}` : '');
  try {
    const { dir, st } = open(isFolderArg(rest[0]) ? rest.shift() : undefined);
    if (cmd === 'show') return show(dir, st, viewOf(dir));
    if (cmd === 'brief') {
      const v = viewOf(dir);
      return say(`${plan.deckBrief(dir, episode.read(dir))}${v.approvedAt ? '' : '\n(Not approved yet.)'}`);
    }
    if (cmd === 'save') return await cmdSave(dir, values);
    if (cmd === 'set') return cmdSet(dir, rest, values);
    if (cmd === 'split') {
      if (!SHOT.test(String(rest[0])) || !/^\d+$/.test(String(values.at || ''))) throw usage('split needs a shot and --at <line> (1 = after its first line).');
      return directed(dir, { op: 'split', id: rest[0], atBullet: Number(values.at) });
    }
    if (cmd === 'merge') {
      if (!SHOT.test(String(rest[0])) || !SHOT.test(String(values.with || ''))) throw usage('merge needs a shot and --with <shot>.');
      return directed(dir, { op: 'merge', id: rest[0], with: values.with });
    }
    if (cmd === 'move') {
      if (!SHOT.test(String(rest[0])) || (values.to == null && values.after == null)) throw usage('move needs a shot and --to <slide number> or --after <shot>|start.');
      const o = { op: 'move', id: rest[0] };
      if (values.to != null) o.to = Number(values.to) - 1;
      if (values.after != null) o.after = values.after === 'start' ? '' : values.after;
      return directed(dir, o);
    }
    if (cmd === 'add') {
      if (!['solo', 'cutscene'].includes(values.kind) || values.after == null) throw usage('add needs --kind solo|cutscene and --after <shot>|start.');
      return directed(dir, { op: 'add', kind: values.kind, after: values.after === 'start' ? '' : values.after,
        ...(values.seconds ? { seconds: Number(values.seconds) } : {}), ...(values.title ? { title: values.title } : {}), ...(values.idea ? { idea: values.idea } : {}) });
    }
    if (cmd === 'remove') {
      if (!SHOT.test(String(rest[0]))) throw usage('remove needs a shot.');
      return directed(dir, { op: 'remove', id: rest[0] });
    }
    if (cmd === 'make') {
      if (!SHOT.test(String(rest[0])) || !['code', 'generate'].includes(rest[1])) throw usage('make needs a shot and code.');
      return directed(dir, { op: 'make', id: rest[0], make: rest[1] });
    }
    if (cmd === 'undo' || cmd === 'redo') {
      plan.editable(episode, dir);
      viewOf(dir);
      if (!(cmd === 'undo' ? storyboard.undo(dir, { caps: CAPS }) : storyboard.redo(dir, { caps: CAPS }))) throw new Error(`Nothing to ${cmd}.`);
      return after(dir, cmd === 'undo' ? 'Undone.' : 'Redone.');
    }
    if (cmd === 'mode') {
      if (rest[0] !== 'jazz' && rest[0] !== 'directed') throw usage('mode is jazz or directed.');
      return directed(dir, { op: 'mode', mode: rest[0] });
    }
    if (cmd === 'approve') return await cmdApprove(dir, values);
  } catch (e) {
    if (e.usage) usageError(USAGE, e.message);
    throw e;
  }
  return undefined;
});
