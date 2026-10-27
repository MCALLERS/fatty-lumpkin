'use strict';
// An episode is an ordinary project folder (the same layout the skills use, so every script runs unchanged) plus
// flpt-project.json, the app's record of where it is in the flow. Stages run in order; each one is reviewed and
// approved before the next opens.
//
// The record's format is v2 (PLAN §2.14): additive only, so an older FLPT still opens it (FLPT 0.7.x reads no version
// and keeps every field it doesn't know). Each write says which FLPT can read it (`minReader`), appends where it was made
// when that changed (`madeWith`, provenance.js), and every approval says who gave it (`approvedBy`: 'you' or 'jazz').
// A record whose `minReader` is newer than this FLPT is refused, read-only, with one line (tooNew).
const fs = require('fs');
const path = require('path');
const provenance = require('./provenance');

const FORMAT = 2; // the record's format version ("v")
const MIN_READER = '2.0.0'; // the oldest FLPT that reads a v2 record
const APPROVERS = new Set(['you', 'jazz']);

const STAGES = [
  { id: 'intake', label: 'Intake', kind: 'form' },
  { id: 'bullets', label: 'Bullets', kind: 'agent', model: 'opus', web: true, budgetUsd: 4 },
  { id: 'factcheck', label: 'Fact-check', kind: 'agent', model: 'sonnet', web: true, budgetUsd: 4 },
  // The talk as shots, each one of the nine modules (storyboard.js, PLAN §2.8): the strawman is FLPT's own, instant and
  // free (ext/storyboard.js writes it when the stage opens); the crew only polishes it, through its save_storyboard
  // tool, and writes no file. With no slide in the bullets there's nothing to plan, and it counts as approved.
  { id: 'storyboard', label: 'Storyboard', kind: 'agent', model: 'sonnet', web: false, budgetUsd: 2 },
  { id: 'deck', label: 'Deck', kind: 'agent', model: 'opus', web: false, budgetUsd: 8 },
  { id: 'script', label: 'Script', kind: 'agent', model: 'opus', web: false, budgetUsd: 4 },
  // Live Motion (the id stays "animate"): the animator crew (animators.js), one session per slide the deck marks for an
  // animation of its own, each capped at budgetUsd, and the deck's Live Motion pieces (Motion Solo and Duet, Solo ♪
  // between slides, a Cosmos or cut scene drawn in code). With none of them there's nothing to do, and it counts as
  // approved once the script is.
  { id: 'animate', label: 'Live Motion', kind: 'crew', model: 'opus', budgetUsd: 4 },
  // The Cosmos cartoons and cut scenes, made in small paid steps (scenes.js). Optional: with none planned, or none
  // wanted, it's approved and their placeholders stay.
  { id: 'scenes', label: 'Scenes', kind: 'gate' },
  { id: 'spend', label: 'Spend', kind: 'gate' },
  { id: 'film', label: 'Film', kind: 'pipeline' },
  // Add-ons on the finished film (clips, transitions, music, b-roll), with ffmpeg only. Optional: with none, approve it.
  { id: 'refine', label: 'Refine', kind: 'pipeline' },
  { id: 'deliver', label: 'Deliver', kind: 'pipeline' },
];
const STAGE_IDS = STAGES.map((s) => s.id);

function slugify(title) {
  return String(title || 'Untitled').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, ' ').slice(0, 60) || 'Untitled';
}

/** A delivery's short name, for its folder and its files: the title cut at a word, at most 40 characters. */
function deliveryName(title) {
  const s = slugify(title);
  if (s.length <= 40) return s;
  return s.slice(0, 41).replace(/\s+\S*$/, '').replace(/[\s-]+$/, '') || s.slice(0, 40);
}
/** What a delivery's files are called: "<short title> - video.mp4", its script, its CapCut master, its captions. */
function deliveredNames(title) {
  const n = deliveryName(title);
  return { folder: n, video: `${n} - video.mp4`, script: `${n} - script.md`, master: `${n} (for CapCut).mov`, captions: `${n} - video.srt` };
}

function stateFile(dir) { return path.join(dir, 'flpt-project.json'); }

// ── versions ──────────────────────────────────────────────────────────────────────────────────────────────────

const semver = (v) => { const m = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(String(v == null ? '' : v).trim()); return m ? m.slice(1).map(Number) : null; };
/** Compare two x.y.z versions (an unreadable one counts as 0.0.0). */
function compareVersions(a, b) {
  const x = semver(a) || [0, 0, 0];
  const y = semver(b) || [0, 0, 0];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/** The newest record this FLPT reads: its own version, never below the format it writes (2.0.0 before the release). */
function readerVersion() {
  let own = null;
  try { own = require('../../package.json').version; } catch { /* the plugin's lib carries it too */ }
  return semver(own) && compareVersions(own, MIN_READER) > 0 ? own : MIN_READER;
}

/**
 * Why this FLPT can't open a record, in one line ("Made with FLPT 3.0.0. Update FLPT to open it."), or null. A record
 * says which FLPT reads it (minReader); one from a newer format that doesn't say counts as needing that major version.
 */
function tooNew(st) {
  if (!st || typeof st !== 'object') return null;
  let need = semver(st.minReader) ? String(st.minReader).trim() : null;
  if (!need && Number.isInteger(Number(st.v)) && Number(st.v) > FORMAT) need = `${Number(st.v)}.0.0`;
  if (!need || compareVersions(need, readerVersion()) <= 0) return null;
  const made = Array.isArray(st.madeWith) && st.madeWith.length ? st.madeWith[st.madeWith.length - 1] : null;
  const by = made && semver(made.version) && compareVersions(made.version, need) >= 0 ? String(made.version).trim() : need;
  return `Made with FLPT ${by}. Update FLPT to open it.`;
}

/** Who approved: 'you' or 'jazz' (anything else is you). */
const approver = (by) => (APPROVERS.has(by) ? by : 'you');

/** Who approved the nearest approved stage before `id` (a stage approved on the way inherits it), else you. */
function approvedBefore(st, id) {
  for (const p of STAGE_IDS.slice(0, Math.max(0, STAGE_IDS.indexOf(id))).reverse()) {
    const r = st.stages[p];
    if (r && r.status === 'approved') return approver(r.approvedBy);
  }
  return 'you';
}

/** Was the deck made (approved, in review, or stale)? Then a storyboard that never ran was never part of it. */
const deckMade = (st) => Boolean(st.stages.deck && ['approved', 'review', 'stale'].includes(st.stages.deck.status));

/**
 * A record from before a stage existed gets it: Refine (added after 0.5.1) counts as approved for an episode already
 * delivered, and is still to do for any other; Scenes (added after it) counts as approved for an episode whose script
 * was already approved (it was planned without it; its cartoons and cut scenes can still be made there), and is
 * still to do for any other; the Storyboard (2.0) counts as approved, skipped, for an episode whose deck was already
 * made (approved, in review or stale: the deck was planned without one), and is still to do for any other. A v1
 * record (FLPT 0.7.x) also gets what v2 adds, additively: its approvals were the user's (`approvedBy: 'you'`), no Live
 * Motion pieces yet (`live: {}`), and the HeyGen presenter it was made for (`intake.presenter`). The next write keeps
 * it all.
 */
function migrate(st) {
  if (!st || typeof st !== 'object' || !st.stages || typeof st.stages !== 'object') return st;
  const v1 = !(Number(st.v) >= FORMAT);
  for (const id of STAGE_IDS) {
    if (st.stages[id] && typeof st.stages[id] === 'object') {
      if (v1 && st.stages[id].status === 'approved' && !APPROVERS.has(st.stages[id].approvedBy)) st.stages[id].approvedBy = 'you';
      continue;
    }
    const delivered = st.stages.deliver && st.stages.deliver.status === 'approved';
    const scripted = st.stages.script && st.stages.script.status === 'approved';
    const skipped = (id === 'scenes' && scripted) || (id === 'storyboard' && deckMade(st));
    st.stages[id] = { status: id === 'intake' || (id === 'refine' && delivered) || skipped ? 'approved' : 'todo' };
    if (skipped) st.stages[id].skipped = true;
    if (st.stages[id].status === 'approved') st.stages[id].approvedBy = approvedBefore(st, id);
  }
  if (!st.live || typeof st.live !== 'object' || Array.isArray(st.live)) st.live = {};
  // A v1 record was made for the HeyGen presenter; a v2 one without intake.presenter follows the settings (§2.12).
  if (v1 && st.intake && typeof st.intake === 'object' && !(st.intake.presenter && typeof st.intake.presenter === 'object')) st.intake.presenter = { kind: 'heygen' };
  return st;
}

/** Does the deck mark any of its slides for an animation of its own ("animate" in modules.json)? */
function animationsMarked(dir) {
  try {
    const project = path.join(dir, 'presentation', 'deck', 'project');
    const order = JSON.parse(fs.readFileSync(path.join(project, 'deck.json'), 'utf8')).order || [];
    const slides = JSON.parse(fs.readFileSync(path.join(project, 'modules.json'), 'utf8')).slides || {};
    return order.some((x) => { const e = slides[typeof x === 'string' ? x : x && x.id]; return Boolean(e && typeof e.animate === 'string' && e.animate.trim()); });
  } catch {
    return false;
  }
}

/**
 * Does the deck plan any Live Motion piece (modules.json): a Motion Solo or Duet slide, a Solo ♪ between slides
 * (`jsscenes`), or a Cosmos or cut scene drawn in code (`make: 'code'`)? A deck that can't be read plans none.
 */
function liveMotionPlanned(dir) {
  try {
    const project = path.join(dir, 'presentation', 'deck', 'project');
    const map = JSON.parse(fs.readFileSync(path.join(project, 'modules.json'), 'utf8')) || {};
    const slides = map.slides && typeof map.slides === 'object' ? Object.values(map.slides) : [];
    const code = (e) => Boolean(e && typeof e === 'object' && e.make === 'code');
    if (slides.some((e) => e && (e.module === 'motion-solo' || e.module === 'motion-duet' || (e.module === 'cosmos' && code(e))))) return true;
    if (Array.isArray(map.jsscenes) && map.jsscenes.some((e) => e && typeof e === 'object')) return true;
    return Array.isArray(map.cutscenes) && map.cutscenes.some(code);
  } catch {
    return false;
  }
}

/**
 * Live Motion (the "animate" stage) with nothing to make (no slide marked for an animation of its own, no Live Motion
 * piece in the deck) has nothing to do: approved as soon as the script is (the next write keeps it).
 */
function settleAnimate(st, dir) {
  const a = st && st.stages && st.stages.animate;
  if (a && a.status !== 'approved' && a.status !== 'running' && st.stages.script && st.stages.script.status === 'approved'
    && !animationsMarked(dir) && !liveMotionPlanned(dir)) {
    st.stages.animate = { ...a, status: 'approved', skipped: true, error: null, approvedBy: approvedBefore(st, 'animate') };
  }
  return st;
}

/**
 * How many slide headings bullets.md has, as the storyboard parses them (none when there's no bullets.md at all); null
 * when that can't be told (a file that's there but can't be read, or a parse that failed), so a fault never passes for
 * "nothing to plan".
 */
function bulletSlides(dir) {
  let md;
  try { md = fs.readFileSync(path.join(dir, 'presentation', 'bullets.md'), 'utf8'); } catch (e) { return e && e.code === 'ENOENT' ? 0 : null; }
  try { const heads = require('./storyboard').readHeadings(md); return Array.isArray(heads) ? heads.length : null; } catch { return null; }
}

/**
 * The Storyboard with nothing to plan is approved, skipped (the next write keeps it):
 *   - a deck made without one (approved, in review or stale while the storyboard never ran: an older FLPT, or a tool
 *     that set the stages itself), so the deck isn't held to a plan it never had;
 *   - bullets read and parsed with no slide in them, once the fact-check is approved: there's no shot to plan.
 * `skipped` holds only while the stage stays approved: once it's stale (the bullets changed, an earlier stage ran
 * again), running or anything else, the flag is gone, and the storyboard opens on a strawman like any other.
 * A storyboard that ran, or is stale after the bullets changed, stays for the user to review.
 */
function settleStoryboard(st, dir) {
  let s = st && st.stages && st.stages.storyboard;
  if (!s) return st;
  if (s.skipped && s.status !== 'approved') {
    s = { ...s };
    delete s.skipped;
    st.stages.storyboard = s;
  }
  if (s.status === 'approved' || s.status === 'running') return st;
  const skip = (s.status === 'todo' && deckMade(st)) || (canRun(st, 'storyboard') && bulletSlides(dir) === 0);
  if (skip) st.stages.storyboard = { ...s, status: 'approved', skipped: true, error: null, approvedBy: approvedBefore(st, 'storyboard') };
  return st;
}

/** Does the deck plan any Cosmos cartoon or cut scene (scenes.js)? A deck that can't be read plans none. */
function scenesPlanned(dir) {
  try { return require('./scenes').hasAny(dir); } catch { return false; }
}

/**
 * Scenes with no cartoons or cut scenes planned has nothing to do either: approved once the steps before it are (the
 * next write keeps it). So an episode with neither goes from Script (and Animate) straight to Spend.
 */
function settleScenes(st, dir) {
  const s = st && st.stages && st.stages.scenes;
  if (s && s.status !== 'approved' && s.status !== 'running' && canRun(st, 'scenes') && !scenesPlanned(dir)) {
    st.stages.scenes = { ...s, status: 'approved', skipped: true, error: null, approvedBy: approvedBefore(st, 'scenes') };
  }
  return st;
}

/** The record as it is on disk (no migration), or null. */
function readRaw(dir) {
  try { const st = JSON.parse(fs.readFileSync(stateFile(dir), 'utf8')); return st && typeof st === 'object' && !Array.isArray(st) ? st : null; } catch { return null; }
}

/**
 * The record, brought up to date (migrate, then the steps with nothing to do settled), or null. A record too new for
 * this FLPT comes back exactly as it is on disk: callers refuse it (tooNew), and nothing here rewrites it.
 */
function read(dir) {
  const raw = readRaw(dir);
  if (!raw || tooNew(raw)) return raw;
  try { return settleScenes(settleAnimate(settleStoryboard(migrate(raw), dir), dir), dir); } catch { return null; }
}

/**
 * Write the record (atomically) as v2: the format and the oldest FLPT that reads it (a newer one that still reads
 * here keeps its own), and where it was made when that changed. Refused for a record too new for this FLPT, on disk or
 * given, so a newer format is never written over.
 */
function write(dir, state) {
  const why = tooNew(readRaw(dir)) || tooNew(state);
  if (why) throw new Error(why);
  const v = Number.isInteger(Number(state.v)) && Number(state.v) > FORMAT ? Number(state.v) : FORMAT;
  const minReader = semver(state.minReader) && compareVersions(state.minReader, MIN_READER) > 0 ? String(state.minReader).trim() : MIN_READER;
  const tmp = stateFile(dir) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ ...state, v, minReader, madeWith: provenance.stamp(state.madeWith), updatedAt: new Date().toISOString() }, null, 2));
  fs.renameSync(tmp, stateFile(dir));
  return read(dir);
}

const LENGTHS = [3, 5, 8, 12, 15];
const PRESENTER_KINDS = ['heygen', 'cartoon'];
const VOICE_PROVIDERS = ['heygen', 'say', 'elevenlabs', 'fish'];
const PRESENTER_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

/**
 * The presenter an episode is made for, as the New episode sheet picks it (PLAN §2.12; W1-03's handoff): { kind:
 * 'heygen' | 'cartoon', rig?, voice?: { provider: 'heygen' | 'say' | 'elevenlabs' | 'fish', id?, engine? } }, cleaned
 * (unknown fields dropped), or null when none was picked (the episode then follows settings.presenter).
 */
function cleanPresenter(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p) || !PRESENTER_KINDS.includes(p.kind)) return null;
  const out = { kind: p.kind };
  if (p.kind === 'cartoon' && typeof p.rig === 'string' && PRESENTER_ID.test(p.rig)) out.rig = p.rig;
  const v = p.voice;
  if (v && typeof v === 'object' && !Array.isArray(v) && VOICE_PROVIDERS.includes(v.provider)) {
    out.voice = { provider: v.provider };
    if (typeof v.id === 'string' && PRESENTER_ID.test(v.id)) out.voice.id = v.id;
    if (typeof v.engine === 'string' && /^[a-z0-9_.-]{1,40}$/i.test(v.engine)) out.voice.engine = v.engine;
  }
  return out;
}

function clean(intake) {
  const t = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const minutes = LENGTHS.includes(Number(intake && intake.minutes)) ? Number(intake.minutes) : 5;
  const bring = ['idea', 'notes', 'script'].includes(intake && intake.bring) ? intake.bring : 'idea';
  const presenter = cleanPresenter(intake && intake.presenter);
  return {
    title: t(intake && intake.title, 120) || 'Untitled episode',
    point: t(intake && intake.point, 600),
    audience: t(intake && intake.audience, 300),
    tone: t(intake && intake.tone, 200) || 'smart, warm, a little wry',
    minutes,
    bring,
    material: t(intake && intake.material, 60000),
    series: t(intake && intake.series, 120),
    habits: t(intake && intake.habits, 400),
    // a presenter picked on the sheet for this episode only; unset, the episode follows settings.presenter
    ...(presenter ? { presenter } : {}),
  };
}

// ── Jazz (PLAN §2.14 `jazz`; flow.playThrough) ──────────────────────────────────────────────────────────────────

const JAZZ_THROUGH = ['draft', 'storyboard'];
const JAZZ_DEFAULT = Object.freeze({ through: 'draft', running: false, stoppedAt: null });

/**
 * The episode's Jazz record, read with its defaults: { through: 'draft' (play on to the free draft) | 'storyboard'
 * (accept the board only), running, stoppedAt (the stage it stopped at, or null), why (one line, or null), problems
 * (what held a stage back, a few lines), stage (the step it's on while running), pid (the process playing), startedAt,
 * at }. Unknown or malformed fields fall back.
 */
function jazzOf(st) {
  const j = st && st.jazz && typeof st.jazz === 'object' && !Array.isArray(st.jazz) ? st.jazz : {};
  const stageId = (v) => (typeof v === 'string' && STAGE_IDS.includes(v) ? v : null);
  const time = (v) => (typeof v === 'string' && v.length <= 40 ? v : null);
  return {
    through: JAZZ_THROUGH.includes(j.through) ? j.through : JAZZ_DEFAULT.through,
    running: j.running === true,
    stoppedAt: stageId(j.stoppedAt),
    why: typeof j.why === 'string' && j.why.trim() ? j.why.trim().slice(0, 300) : null,
    problems: (Array.isArray(j.problems) ? j.problems : []).filter((x) => typeof x === 'string' && x.trim()).slice(0, 6).map((x) => x.trim().slice(0, 300)),
    stage: j.running === true ? stageId(j.stage) : null,
    pid: Number.isInteger(j.pid) && j.pid > 0 ? j.pid : null,
    startedAt: time(j.startedAt),
    at: time(j.at),
  };
}

/** About 45–60 s a slide at about 150 words a minute (SKILL.md → Intake). */
function slideTarget(minutes) { return { min: Math.max(3, Math.round((minutes * 60) / 60)), max: Math.max(4, Math.round((minutes * 60) / 45)) }; }

function briefMarkdown(i) {
  return `# Brief: ${i.title}

- **The point** (what should change in the audience's head): ${i.point || '(to be found with the user)'}
- **Audience:** ${i.audience || '(not given)'}
- **Length:** ${i.minutes} minutes (about ${i.minutes * 150} spoken words; ${slideTarget(i.minutes).min}–${slideTarget(i.minutes).max} slides)
- **Tone:** ${i.tone}
- **What they brought:** ${i.bring}${i.series ? `\n- **Series:** ${i.series}` : ''}${i.habits ? `\n- **This presenter's own verbal habits** (use sparingly): ${i.habits}` : ''}

## Their material
${i.material ? i.material : '_(none: start from the idea and research it)_'}
`;
}

/** Create the record for a new, already-scaffolded project folder. */
function create(dir, intake) {
  const i = clean(intake);
  fs.writeFileSync(path.join(dir, 'presentation', 'brief.md'), briefMarkdown(i));
  const stages = Object.fromEntries(STAGES.map((s) => [s.id, { status: s.id === 'intake' ? 'approved' : 'todo' }]));
  // New episodes tighten the film's pauses at Refine (Michael, 2026-10-14: the method's default); episodes made before
  // keep what they had, which is off unless chosen.
  stages.intake.approvedBy = 'you';
  // intake.presenter only when the sheet picked one: unset, the episode follows settings.presenter (§2.12); only a v1
  // record gets HeyGen (migrate). Jazz plays on to the free draft unless the episode says otherwise (D3).
  return write(dir, { v: FORMAT, minReader: MIN_READER, title: i.title, intake: i, createdAt: new Date().toISOString(),
    stages, costs: [], tighten: { on: true, laughs: false }, live: {}, jazz: { ...JAZZ_DEFAULT } });
}

/** The first stage that isn't approved: where the user should be. */
function current(state) { return STAGE_IDS.find((id) => state.stages[id].status !== 'approved') || 'deliver'; }

/** A stage may run only when everything before it is approved. */
function canRun(state, id) {
  const i = STAGE_IDS.indexOf(id);
  return i > 0 && STAGE_IDS.slice(0, i).every((p) => state.stages[p].status === 'approved');
}

/**
 * Change one stage's record. An approval says who gave it (`approvedBy`: 'you' unless the patch says 'jazz'); any other
 * status drops it.
 */
function setStage(dir, id, patch) {
  const st = read(dir);
  const why = tooNew(st);
  if (why) throw new Error(why);
  const was = st.stages[id] || {};
  st.stages[id] = { ...was, ...patch, at: new Date().toISOString() };
  // when a run began (its panel's clock, "Working… · 3:12"): kept while it runs, dropped once it ends
  if (patch.status === 'running') st.stages[id].startedAt = was.status === 'running' && was.startedAt ? was.startedAt : st.stages[id].at;
  else if (patch.status) delete st.stages[id].startedAt;
  if (patch.status === 'approved') st.stages[id].approvedBy = approver(patch.approvedBy);
  else if (patch.status && patch.status !== 'stale') delete st.stages[id].approvedBy;
  // Re-running a stage re-opens everything after it: later work was built on the old version.
  if (patch.status === 'running') for (const later of STAGE_IDS.slice(STAGE_IDS.indexOf(id) + 1)) {
    if (st.stages[later].status === 'approved') st.stages[later] = { ...st.stages[later], status: 'stale' };
  }
  return write(dir, st);
}

function addCost(dir, entry) {
  const st = read(dir);
  const why = tooNew(st);
  if (why) throw new Error(why);
  st.costs = [...(st.costs || []), { at: new Date().toISOString(), ...entry }];
  return write(dir, st);
}

// ── estimates ────────────────────────────────────────────────────────────────────────────────────────────────

/** Split script.md into slides: [{ n, title, narration }] (stage notes and comments are never spoken). */
function parseScript(text) {
  const slides = [];
  let cur = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^##\s+SLIDE\s+(\d+)\s*[—–-]\s*(.*)$/i);
    if (m) { cur = { n: Number(m[1]), title: m[2].trim(), narration: '' }; slides.push(cur); continue; }
    if (/^##\s+CUTSCENE\b/i.test(line)) { cur = null; continue; }
    if (cur && !/^\s*>/.test(line) && !/^<!--/.test(line)) cur.narration += `${line}\n`;
  }
  for (const s of slides) s.narration = s.narration.replace(/<!--[\s\S]*?-->/g, '').trim();
  return slides;
}

/**
 * Seconds of narration, the way est_durations.py estimates it: 16.5 characters a second with tags stripped, plus
 * 0.5 s per [pause] and 0.3 s per [short pause], plus the pipeline's 0.6 s tail per slide and the lead on slide 1.
 */
function estimateSeconds(slides) {
  return Math.round(slideSeconds(slides).reduce((a, s) => a + s.seconds, 0));
}

/** The same estimate, slide by slide: [{ n, seconds }] (the lead before the first slide counts on that slide). */
function slideSeconds(slides) {
  return slides.map((s, i) => {
    const pauses = (s.narration.match(/\[pause\]/gi) || []).length;
    const short = (s.narration.match(/\[short pause\]/gi) || []).length;
    const chars = s.narration.replace(/\[[^\]]*\]/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().length;
    return { n: s.n, seconds: chars / 16.5 + pauses * 0.5 + short * 0.3 + 0.6 + (i === 0 ? 0.5 : 0) };
  });
}

module.exports = { STAGES, STAGE_IDS, slugify, deliveryName, deliveredNames, read, readRaw, write, create, current, canRun, setStage, addCost, parseScript, estimateSeconds,
  slideSeconds, slideTarget, clean, cleanPresenter, migrate, animationsMarked, liveMotionPlanned, tooNew, readerVersion, compareVersions, approver,
  approvedBefore, jazzOf, FORMAT, MIN_READER, JAZZ_THROUGH, JAZZ_DEFAULT };
