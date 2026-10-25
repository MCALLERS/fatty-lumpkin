#!/usr/bin/env node
'use strict';
// FLPT's scene guard (PLAN §2.16 items 2 and 6): the Claude Code hook (engine/hooks/hooks.json) that keeps Live Motion
// scene code out of the user's own session and keeps the crew that writes it (flpt-scene-crew) inside its piece.
//
//   PreToolUse        while .flpt/scene.lock names a piece's folder (flpt-scene open … finish): Write and Edit only its
//                     crew's four files there (writepolicy's scene stage: scene.js, beats.json, notes.md, kit-ext.js),
//                     and nothing reads a key file (keys.env, presenter.env or any *.env, api_keys.txt, vault.json,
//                     wherever it is), the presenter settings' folder, a references folder (refs/**) or the lock. The
//                     crew itself, lock or not: its file tools and flpt-scene's crew commands and nothing else, reads
//                     only in its episode and the method, never a style that isn't FLPT's own as shipped (Mine and
//                     Shared reach it as structured fields and style.json's api, through flpt-scene); with no piece
//                     open it reads and writes nothing. A picture the crew opens with Read counts as looking at its
//                     round (the app's policy does the same). The crew starts in the foreground only.
//   SubagentStart     the crew started: .flpt/crew.json, its marker, names its session and its agent
//   SubagentStop      the crew is back: the marker goes
//   UserPromptSubmit  the user wrote in the crew's session (a prompt typed while a crew works waits for it: measured on
//                     Claude Code 2.1.42), so the session isn't waiting for its crew any more: noted on the marker
//   SessionStart      the session started again (resume, clear): its crew's marker goes
//
// Which calls are the crew's: the ones Claude Code names as its (agent_type flpt-scene-crew, 2.1.296 and later). Where
// Claude Code names no agent (2.1.42), an unnamed call in the crew's session is the crew's while the session waits for
// it; once the user has written there (an Esc, a closed crew), only the calls the crew's own transcript holds are. The
// marker lives while the crew works: each of its steps renews it, and after flpt-scene's CREW_IDLE_MINUTES without
// one it's gone. A crew that was stopped and never came back is let go with `flpt-scene finish --crew-gone`.
//
// A no-op for the Mac app's own crews (FLPT_SURFACE=app: their sessions load this plugin, and their own policy guards
// them), and whenever no piece is open and no crew is at work. Never allows anything by itself: it only refuses.
const fs = require('fs');
const path = require('path');

const WRITES = { Write: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' };
const READS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead']);
// What the crew may use: its file tools and the shell (for flpt-scene alone). TodoWrite only keeps its own list.
const CREW_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'Bash', 'TodoWrite']);
const PICTURE = /\.(png|jpe?g|gif|webp)$/i;
// Key files by name, wherever they are: keys.env and presenter.env (any *.env), an episode's api_keys.txt, the app's vault
const KEY_FILE = /(^|\/)(api_keys\.txt|[^/]*\.env(\.[^/]*)?|vault\.json)$/i;
// The user's own shell, while a piece is open: no command that names a key file, the presenter settings, the lock or refs
const KEY_WORDS = /keys\.env|api_keys|vault\.json|\.env(\.[\w-]+)?($|[\s'";|&<>])|\.config\/avatar-presentation|\.flpt\b|(^|[\s'"/=])refs(\/|\s|$)/i;
const RENEW_MS = 20000;
const isCrew = (t) => typeof t === 'string' && /(^|:)flpt-scene-crew$/.test(t);

const real = (p) => {
  // the realpath of the deepest existing part, with the rest appended (what the policy compares)
  const tail = [];
  let probe = path.resolve(p);
  for (;;) {
    try { return path.join(fs.realpathSync.native(probe), ...tail.reverse()); } catch { /* go up */ }
    const up = path.dirname(probe);
    if (up === probe) return path.resolve(p);
    tail.push(path.basename(probe));
    probe = up;
  }
};
/** Is p inside root, or root itself? */
const inside = (p, root) => { const r = path.relative(real(root), real(p)); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

/** Shell words, or null for anything a shell would do more with than run one command (operators, expansions, globs). */
function words(cmd) {
  if (typeof cmd !== 'string' || !cmd.trim() || cmd.length > 8000) return null;
  const out = [];
  let cur = '';
  let quote = null;
  let started = false;
  for (let i = 0; i < cmd.length; i += 1) {
    const c = cmd[i];
    if (quote === '\'') { if (c === '\'') quote = null; else cur += c; continue; }
    if (quote === '"') {
      if (c === '"') { quote = null; continue; }
      if (c === '\\' && (cmd[i + 1] === '"' || cmd[i + 1] === '\\')) { cur += cmd[i + 1]; i += 1; continue; }
      if (c === '$' || c === '`' || c === '\\' || c === '\n' || c === '\r') return null;
      cur += c;
      continue;
    }
    if (c === '\'' || c === '"') { quote = c; started = true; continue; }
    if (c === ' ' || c === '\t') { if (started) { out.push(cur); cur = ''; started = false; } continue; }
    if (/[;&|<>()`$\\\n\r*?[\]{}~#!]/.test(c)) return null;
    cur += c;
    started = true;
  }
  if (quote) return null;
  if (started) out.push(cur);
  return out;
}

/** Is this Bash command one of flpt-scene's crew commands, run with Node, and nothing more? */
function crewCommand(cmd, cwd, scene) {
  const w = words(cmd);
  if (!w || w.length < 3) return false;
  if (!(w[0] === 'node' || (path.isAbsolute(w[0]) && path.basename(w[0]) === 'node'))) return false;
  if (real(path.resolve(cwd, w[1])) !== real(path.join(__dirname, 'flpt-scene.js'))) return false;
  return scene.CREW_COMMANDS.includes(w[2]);
}

/** What no search may cover while a piece is open (and, for the crew, a style that isn't FLPT's own). */
function closedFor(lock, crew, { config, state, userData }) {
  const out = [config, state, path.join(userData, 'vault.json')];
  if (lock) out.push(path.join(lock.presDir, 'refs'), path.join(lock.presDir, 'video', 'api_keys.txt'));
  if (lock && crew) {
    for (const d of lock.readDeny || []) {
      if (typeof d !== 'string') continue;
      // a pattern (**/assets/styles/<id>): every piece's folder may hold that style's copy
      out.push(path.isAbsolute(d) ? d : path.join(lock.presDir, 'hyperframes'));
    }
  }
  return out;
}

const refsIn = (p) => /(^|\/)refs(\/|$)/i.test(String(p).split(path.sep).join('/'));

/**
 * Is this tool call one the crew's own transcript holds? true, false (not there, or the crew wrote none), or null (it
 * can't be told). Claude Code 2.1.42 writes a subagent's step to <session>/subagents/agent-<id>.jsonl before its hooks.
 */
function inCrewTranscript(input, agent) {
  const tp = input.transcript_path;
  const id = input.tool_use_id;
  if (typeof tp !== 'string' || !path.isAbsolute(tp) || !tp.endsWith('.jsonl') || typeof id !== 'string' || !/^[\w-]{1,128}$/.test(id)) return null;
  if (typeof agent !== 'string' || !/^[\w-]{1,128}$/.test(agent)) return null;
  const file = path.join(path.dirname(tp), path.basename(tp, '.jsonl'), 'subagents', `agent-${agent}.jsonl`);
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch (e) { return e && e.code === 'ENOENT' ? false : null; }
  try {
    const size = fs.fstatSync(fd).size;
    const n = Math.min(size, 8 << 20);
    const buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, size - n);
    return buf.toString('utf8').includes(`"${id}"`);
  } catch { return null; } finally { fs.closeSync(fd); }
}

/**
 * Whose call this is: { crew, sure } (sure: certainly the crew's, so it renews the marker). Claude Code names a
 * subagent's calls (agent_id, agent_type) where it can; a call it doesn't name, in the crew's session, is the crew's
 * while the session waits for it, and after the user has written there only when the crew's transcript holds it.
 */
function whose(input, marker, session) {
  if (isCrew(input.agent_type)) return { crew: true, sure: true };
  if (input.agent_id || input.agent_type) return { crew: false };
  if (!marker || marker.session !== session) return { crew: false };
  if (marker.named) return { crew: false }; // this Claude Code names its agents: an unnamed call is the session's own
  if (!marker.prompted) return { crew: true, sure: true }; // the session waits for its crew
  const held = inCrewTranscript(input, marker.agent);
  return held === false ? { crew: false } : { crew: true, sure: held === true };
}

/** The crew took a step: its marker renewed (and, once Claude Code has named it, marked so). */
function renew(scene, marker, input) {
  if (!marker || marker.session !== input.session_id) return;
  const named = Boolean(marker.named) || isCrew(input.agent_type);
  const last = Date.parse(marker.at);
  if (named === Boolean(marker.named) && Number.isFinite(last) && Date.now() - last < RENEW_MS) return;
  try { scene.touchCrew(marker.session, { at: new Date().toISOString(), named }); } catch { /* only a note */ }
}

/** The answer for one tool call: a reason to refuse it, or null. */
function decide(input) {
  const scene = require('./flpt-scene');
  const session = typeof input.session_id === 'string' ? input.session_id : null;
  const now = { lock: scene.readLock(), marker: scene.readCrewMarker() };
  // a lock applies to the session that opened it (when Claude Code said which), a crew marker to its own session
  const lock = now.lock && (!now.lock.session || !session || now.lock.session === session) ? now.lock : null;
  const who = whose(input, now.marker, session);
  const crew = who.crew;
  if (crew && who.sure) renew(scene, now.marker, input);
  const tool = String(input.tool_name || '');
  const ti = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};

  // the crew works in the foreground: the session waits for it (and its marker knows its calls)
  if (!crew && (tool === 'Agent' || tool === 'Task') && isCrew(ti.subagent_type) && ti.run_in_background === true) {
    return 'The scene crew works in the foreground: start it again without run_in_background, and wait for it.';
  }
  if (!lock && !crew) return null;

  const { places, ROOT } = require('./common');
  const { config, userData } = places();
  const state = scene.stateDir();
  const cwd = typeof input.cwd === 'string' && path.isAbsolute(input.cwd) ? input.cwd : process.cwd();
  const by = crew ? 'The scene crew' : `While ${lock.key} is open, this session`;

  if (crew && !CREW_TOOLS.has(tool)) return 'The scene crew has its file tools and flpt-scene\'s crew commands, nothing else.';

  if (tool === 'Bash') {
    const cmd = String(ti.command || '');
    if (crew) return crewCommand(cmd, cwd, scene) ? null : 'The scene crew runs flpt-scene\'s crew commands only, one at a time, exactly as its brief gives them.';
    if (KEY_WORDS.test(cmd)) return `${by} doesn't touch key files, references or the scene lock.`;
    return null;
  }

  const writepolicy = require('./common').app('writepolicy');
  const policy = lock ? writepolicy.policyFor('scene', { presDir: lock.presDir, engineRoot: ROOT, folder: lock.folder, readDeny: lock.readDeny || [] }) : null;

  if (WRITES[tool]) {
    const p = ti[WRITES[tool]];
    if (typeof p !== 'string' || !p) return `${by} names the file it writes.`;
    if (!policy) return 'No Live Motion piece is open, so the scene crew writes nothing.';
    const r = policy.write(path.resolve(cwd, p));
    if (r.ok) return null;
    return crew ? r.why : `While ${lock.key} is open, only its crew's scene.js, beats.json, notes.md and kit-ext.js in ${policy.folder}/ can be written.`;
  }

  if (READS.has(tool)) {
    if (crew && !policy) return 'No Live Motion piece is open, so the scene crew reads nothing.';
    const paths = writepolicy.readPaths(tool === 'LS' ? 'Read' : tool, ti, cwd).filter(Boolean);
    const closed = closedFor(lock, crew, { config, state, userData });
    for (const p of paths) {
      if (KEY_FILE.test(p.split(path.sep).join('/')) || inside(p, config) || inside(p, state)) return `${by} doesn't read key files, the presenter settings or the scene lock.`;
      if (refsIn(lock ? path.relative(lock.presDir, p) : p)) return `${by} doesn't read references: they reach a crew as numbers and words only.`;
      // a search (Glob, Grep, a folder) covers everything below it: none may cover a closed folder or a key file
      const search = tool !== 'Read' && tool !== 'NotebookRead';
      if (search && closed.some((c) => c && inside(c, p) && fs.existsSync(c))) return `${by} doesn't search a folder that holds keys, references or a style's closed code. Name the file instead.`;
      if (crew) {
        const r = policy.read(p);
        if (!r.ok) return `The scene crew reads only its episode and the method. ${r.why}`;
      }
    }
    // the crew looked at a picture one of its rounds made (a still, a sheet, a frame)
    if (crew && tool === 'Read' && paths[0] && PICTURE.test(paths[0]) && inside(paths[0], lock.folder)) scene.sawPicture(lock, paths[0]);
    return null;
  }
  return null;
}

/** SubagentStart, SubagentStop, UserPromptSubmit, SessionStart: the crew's marker, for its own session. */
function marker(input) {
  const session = typeof input.session_id === 'string' && input.session_id ? input.session_id : null;
  if (!session) return;
  const scene = require('./flpt-scene');
  const ev = input.hook_event_name;
  if (ev === 'SubagentStart') {
    if (!isCrew(input.agent_type)) return;
    scene.writeJsonAtomic(scene.crewFile(), { session, agent: typeof input.agent_id === 'string' ? input.agent_id : null, at: new Date().toISOString(), named: false, prompted: null, released: null });
    return;
  }
  const c = scene.readCrewMarker();
  if (!c || c.session !== session) return;
  if (ev === 'SubagentStop') {
    if (!isCrew(input.agent_type) || (c.agent && typeof input.agent_id === 'string' && input.agent_id !== c.agent)) return;
    fs.rmSync(scene.crewFile(), { force: true });
  } else if (ev === 'SessionStart') {
    if (['startup', 'resume', 'clear'].includes(input.source)) fs.rmSync(scene.crewFile(), { force: true });
  } else if (ev === 'UserPromptSubmit') {
    if (!c.named && !c.prompted) scene.touchCrew(session, { prompted: new Date().toISOString() });
  }
}

function deny(reason) {
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } })}\n`);
}

const LIFECYCLE = new Set(['SubagentStart', 'SubagentStop', 'UserPromptSubmit', 'SessionStart']);

function run(raw, env = process.env) {
  if (env.FLPT_SURFACE === 'app') return; // the Mac app's own crews: their own policy, not this guard
  let input;
  try { input = JSON.parse(raw); } catch { return; }
  if (!input || typeof input !== 'object') return;
  if (LIFECYCLE.has(input.hook_event_name)) { try { marker(input); } catch { /* the marker is a note: never in the way */ } return; }
  if (input.hook_event_name && input.hook_event_name !== 'PreToolUse') return;
  let why;
  try {
    why = decide(input);
  } catch (e) {
    // fail closed for anything the guard was meant to check
    let guarded = isCrew(input.agent_type);
    try { const s = require('./flpt-scene'); guarded = guarded || Boolean(s.readLock() || s.readCrewMarker()); } catch { guarded = true; }
    why = guarded ? `The scene guard couldn't check this (${String(e && e.message ? e.message : e).slice(0, 120)}), so it's refused.` : null;
  }
  if (why) deny(why);
}

if (require.main === module) {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = ''; }
  run(raw);
}

module.exports = { run, decide, words, crewCommand, isCrew, whose, inCrewTranscript, KEY_FILE };
