'use strict';
// The storyboard stage's flow extension (W2-01; PLAN §2.8, §2.9; decisions.md D13): the plan between the fact-check
// and the deck, through the flow's hooks (ext/index.js), so flow.js stays as it is.
//
//   open        the stage's strawman, written the moment the stage opens (storyboard.ensure: instant, free; a re-plan
//               when bullets.md changed, or when this surface can't make a Generated scene the plan has), and the
//               board as the page draws it (view.storyboard: storyboard.view)
//   stageVars   the storyboard crew's placeholders (the strawman as a table, the policy, the nine modules with prices,
//               the scores, {{styles}}); the deck's and the script's {{storyboard}} (the approved plan, built exactly)
//               and {{styles}}. On a surface that can't make a Generated scene, a plan that has one is re-planned in
//               code before the deck, and goes back to the user for review (D13 across surfaces)
//   planning    the Claude planning cap's Live Motion lines: the board's pieces (a narrated piece 5 USD, a Solo ♪ or
//               a cut scene drawn in code 3.5, the whiteboard sketch's animator 4), or, before there's a board, the
//               default plan's for the talk's length (§2.9: Jazz on the default plan never asks twice)
//   approved    the storyboard: the board approved, with its mode (Jazz or Directed); the deck: media.json's
//               flpt-scene entries written at once (motion.refreshMedia), so a Motion Solo is never filmed as an
//               avatar by an older FLPT (T2)
//
// Caps (what the plan may make, D13): the host's own when it gives them (d.caps), else the surface FLPT runs on
// (provenance: the app under Electron, the plugin's tools elsewhere, or what a host configured), with, on the Mac or
// the web, whether a Kie.ai or Higgsfield key is in the vault. Generated Cosmos and cut scenes are planned only where a
// surface can pay for them and has a key; everywhere else they're drawn in code. Nothing here spends.
const fs = require('fs');
const path = require('path');
const storyboard = require('../storyboard');
const guest = require('../guestvoice');
const provenance = require('../provenance');
const stylesLib = require('../styles');

const STAGE = 'storyboard';
const isPlain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
// What each use of a shipped style means, for the crews (styles.DEFAULTS' keys).
const USES = { solo: 'Motion Solo', duet: 'Motion Duet', cosmos: 'a Cosmos drawn in code', interstitial: 'a Solo ♪', cutscene: 'a cut scene drawn in code',
  history: 'histories', tech: 'technology', maths: 'maths', 'hand-drawn': 'hand-drawn looks' };

// ── caps ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Is a generation key (Kie.ai or Higgsfield) in the vault? Read from its status, never from a key's value. */
function generationKey(vault) {
  try {
    const s = vault && typeof vault.status === 'function' ? vault.status() : null;
    return Boolean(s && ((s.KIE_API_KEY && s.KIE_API_KEY.set) || (s.HIGGSFIELD_CREDENTIALS && s.HIGGSFIELD_CREDENTIALS.set)));
  } catch { return false; }
}

/**
 * The caps the storyboard plans with: { surface, generation?, paidSteps?, crew? }. d: { caps (the host's, an object or a
 * function), vault }. A host that says nothing gets its surface from provenance; on the Mac or the web, `generation`
 * comes from the vault's status. paidSteps without 'scenes' means a Generated scene can't be paid for here.
 */
function capsFor(d = {}) {
  let c = null;
  try { c = d && typeof d.caps === 'function' ? d.caps() : d && d.caps; } catch { c = null; }
  if (!isPlain(c)) c = { surface: provenance.current().surface };
  const out = { surface: typeof c.surface === 'string' ? c.surface : 'plugin' };
  if (typeof c.crew === 'string') out.crew = c.crew;
  if (c.paidSteps === false || (Array.isArray(c.paidSteps) && !c.paidSteps.includes('scenes'))) out.paidSteps = false;
  if (typeof c.generation === 'boolean') out.generation = c.generation;
  else if (out.surface === 'mac' || out.surface === 'web') out.generation = generationKey(d && d.vault);
  // W4-11: the FLPT voices can speak here (signed in, and the film made online): a Jazz Cosmos's storyteller
  if (guest.houseFor({ vault: d && d.vault, settings: d && d.settings })) out.house = true;
  return out;
}

// ── the stage ───────────────────────────────────────────────────────────────────────────────────────────────────

const stageOf = (st) => (st && st.stages && isPlain(st.stages[STAGE]) ? st.stages[STAGE] : null);
/** Skipped (made before 2.0, or nothing to plan) only while the stage stays approved: a stale or re-run one is planned. */
const skipped = (st) => Boolean(stageOf(st) && stageOf(st).status === 'approved' && stageOf(st).skipped);
const minutesOf = (st) => Number(st && st.intake && st.intake.minutes) || 5;

/** Is the stage open for planning: everything before it approved, and the storyboard itself not approved or running? */
function stageOpen(episode, st) {
  const s = stageOf(st);
  return Boolean(s && s.status !== 'approved' && s.status !== 'running' && episode.canRun(st, STAGE));
}

/** The strawman (or a re-plan) when the stage is open: storyboard.ensure. → its answer, or null when it isn't open. */
function ensureOpen(episode, dir, st, caps) {
  if (!stageOpen(episode, st)) return null;
  return storyboard.ensure(dir, { minutes: minutesOf(st), caps });
}

// ── the styles, for the crews (structured fields only, §2.16 item 4) ─────────────────────────────────────────────

const word = (s, n) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9 -]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
function tagsText(tags) {
  if (!isPlain(tags)) return '';
  const out = [];
  for (const k of ['mood', 'look', 'pace']) {
    const v = tags[k];
    const list = (Array.isArray(v) ? v : [v]).map((x) => word(x, 20)).filter(Boolean).slice(0, 4);
    if (list.length) out.push(`${k} ${list.join(', ')}`);
  }
  return out.join(' · ');
}

/**
 * The style catalog for the storyboard, deck and scene crews: each style's id, name and tags, its default use, and
 * whether it's safe beside the presenter. A shipped style adds its one line; a Mine or Shared style is never more than
 * its id, a cleaned name and its tags. With no style installed yet, the six P0 styles FLPT ships, by id.
 */
function stylesText(d = {}) {
  const uses = new Map();
  for (const [use, id] of Object.entries(stylesLib.DEFAULTS)) uses.set(id, [...(uses.get(id) || []), USES[use] || use]);
  const lines = [];
  let all = { shipped: [], mine: [], shared: [] };
  try {
    let projectsDir = null;
    try { projectsDir = d.settings && typeof d.settings.read === 'function' ? d.settings.read().projectsDir : null; } catch { projectsDir = null; }
    if (d.engineRoot) all = stylesLib.createStyles({ engineRoot: d.engineRoot, projectsDir: projectsDir || null, mediaRoot: null }).listAll();
  } catch { /* no styles to read: the shipped list below */ }
  const use = (id) => (uses.has(id) ? `default for ${uses.get(id).join(', ')}` : '');
  for (const r of all.shipped.filter((x) => x.ok)) {
    lines.push(`- \`${r.id}\` · ${r.name || r.id}${r.line ? ` · ${r.line}` : ''}${use(r.id) ? ` · ${use(r.id)}` : ''}${tagsText(r.tags) ? ` · ${tagsText(r.tags)}` : ''}${r.duetSafe ? ' · duet-safe' : ''}`);
  }
  if (!lines.length) {
    for (const s of stylesLib.SHIPPED.filter((x) => x.p === 0)) lines.push(`- \`${s.id}\` · ${s.name}${use(s.id) ? ` · ${use(s.id)}` : ''}`);
  }
  for (const [scope, list] of [['yours', all.mine], ['shared', all.shared]]) {
    for (const r of list.filter((x) => x.ok)) {
      const id = r.ref && scope === 'shared' ? r.ref : r.id;
      lines.push(`- \`${id}\` · ${word(r.name, 40) || r.id} (${scope})${tagsText(r.tags) ? ` · ${tagsText(r.tags)}` : ''}${r.duetSafe ? ' · duet-safe' : ''}`);
    }
  }
  return lines.join('\n');
}

// ── the deck's plan ─────────────────────────────────────────────────────────────────────────────────────────────

const NO_PLAN = 'This episode has no storyboard. Build one slide per `## Slide` heading of `bullets.md`, in that order; choose each slide\'s module yourself (below), and leave `shot` out.';

/** The plan the deck crew (and the script crew) works from: {{storyboard}}. caps.house: the FLPT voices can speak. */
function deckBrief(dir, st, caps = null) {
  const board = skipped(st) ? null : storyboard.read(dir);
  if (!board || !board.shots.length) return NO_PLAN;
  const mode = board.mode === 'jazz' ? 'Let FLPT play jazz' : board.mode === 'directed' ? 'User directed' : null;
  return `${mode ? `Approved (${mode}). ` : ''}Shots in film order: \`slide\` shots are the deck's slides; the others are scenes between slides.\n\n${storyboard.toDeckBrief(board, { house: Boolean(caps && caps.house) })}`;
}

// ── the planning cap's lines (§2.9) ─────────────────────────────────────────────────────────────────────────────

/** A board for the default plan of a talk this long (no bullets yet): equal slides, as many as the plan allows. */
function defaultBoard(minutes, caps) {
  const row = storyboard.planFor(minutes);
  const n = Math.max(1, row.shots[1] - row.interstitials - row.cutscenes);
  const words = Array.from({ length: 12 }, () => 'word').join(' ');
  const md = ['# Talk: bullets', '', ...Array.from({ length: n }, (_, i) => [`## Slide ${i + 1} — Point ${i + 1}`, `- ${words}`, `- ${words}`, '']).flat()].join('\n');
  return storyboard.strawman(md, { minutes, caps, now: () => new Date(0) });
}

/**
 * The plan's Live Motion lines for the Claude cap: [{ label, usd }]. The board's pieces when there is one (its shots
 * named), else the default plan's for the talk's length (by kind). None for an episode whose storyboard was skipped.
 * The whiteboard sketch's animator is counted here only until the deck marks it: then the flow counts the marks.
 */
function planLines(episode, dir, st, caps) {
  if (!st || skipped(st)) return [];
  const board = storyboard.read(dir);
  const own = Boolean(board && board.shots.length);
  const p = storyboard.price(null, own ? board : defaultBoard(minutesOf(st), caps));
  const marked = episode.animationsMarked(dir);
  return p.claude.pieces.filter((x) => !(marked && /^Hand-drawn · /.test(x.label)))
    .map((x) => ({ label: own ? x.label : x.label.replace(/ · s\d+$/, ''), usd: x.usd }));
}

// ── the API's side (api/storyboard.js) ──────────────────────────────────────────────────────────────────────────

/** What the page gets: the board as it draws it (storyboard.view), or null when there's none (or it was skipped). */
function viewFor(episode, dir, caps) {
  const st = episode.read(dir);
  if (!st || skipped(st)) return null;
  ensureOpen(episode, dir, st, caps);
  const v = storyboard.view(dir, { caps });
  return v ? { ...v, stage: stageOf(st) ? stageOf(st).status : null } : null;
}

/**
 * A directed edit's effect on the stage: an approved plan the edit un-approved goes back to review, and what was built
 * on it (the deck onwards) is out of date, as when the bullets change.
 */
function reopenIfChanged(episode, dir) {
  const st = episode.read(dir);
  const s = stageOf(st);
  const board = storyboard.read(dir);
  if (!s || s.status !== 'approved' || s.skipped || !board || board.approvedAt) return false;
  st.stages[STAGE] = { ...s, status: 'review', at: new Date().toISOString() };
  delete st.stages[STAGE].approvedBy;
  for (const id of episode.STAGE_IDS.slice(episode.STAGE_IDS.indexOf(STAGE) + 1)) {
    if (st.stages[id] && st.stages[id].status === 'approved') st.stages[id] = { ...st.stages[id], status: 'stale' };
  }
  episode.write(dir, st);
  return true;
}

/**
 * Before the deck is built from an approved plan on a surface that can't make a Generated scene (the plugin, the
 * Desk): a plan with Generated Cosmos or cut scenes the user didn't lock is re-planned in code (storyboard.ensure), and
 * that new plan is the user's to review: the storyboard goes back to review and the step stops with why. → nothing,
 * or throws.
 */
function holdForSurface(episode, dir, st, caps) {
  if (!st || skipped(st) || storyboard.canGenerate(caps)) return;
  const board = storyboard.read(dir);
  if (!board || !board.shots.some((s) => (s.module === 'cosmos' || s.module === 'cutscene') && s.make === 'generate' && !s.locked)) return;
  storyboard.ensure(dir, { minutes: minutesOf(st), caps });
  reopenIfChanged(episode, dir);
  throw new Error('The storyboard planned generated scenes, which aren\'t made here: they\'re drawn in code now. Review the storyboard and approve it again.');
}

/**
 * May the plan be approved now? Throws why not; changes nothing (a no to the top-up that follows leaves the stage as it
 * was). A strawman never polished (todo) or a failed polish is approvable: reviewable() moves it to review once the
 * money is settled, just before the approval.
 */
function readyForApproval(episode, dir) {
  const st = episode.read(dir);
  const s = stageOf(st);
  if (!s || skipped(st)) throw new Error('This episode has no storyboard to approve.');
  if (s.status === 'approved') throw new Error('The storyboard is already approved.');
  if (s.status === 'running') throw new Error('The storyboard is still being planned.');
  if (!episode.canRun(st, STAGE)) throw new Error('Approve the fact-check first.');
  if (!storyboard.read(dir)) throw new Error('There is no storyboard yet.');
}

/** A strawman never polished (todo) or a failed polish, moved to review for its approval (after readyForApproval). */
function reviewable(episode, dir) {
  const s = stageOf(episode.read(dir));
  if (s && (s.status === 'todo' || s.status === 'error')) episode.setStage(dir, STAGE, { status: 'review', error: null });
}

/**
 * The plan's mode (Jazz or Directed), the same on the board and on the stage's record: after an approval (the user's
 * choice over what the hook guessed) or a mode edit on an approved plan. Nothing is written when they already agree.
 */
function recordMode(episode, dir, mode = null) {
  const board = storyboard.read(dir);
  if (!board) return;
  const want = mode === 'jazz' || mode === 'directed' ? mode : board.mode;
  if (want !== 'jazz' && want !== 'directed') return;
  if (board.mode !== want) storyboard.write(dir, { ...board, mode: want });
  const st = episode.read(dir);
  const s = stageOf(st);
  if (s && s.status === 'approved' && !s.skipped && s.mode !== want) {
    st.stages[STAGE] = { ...s, mode: want };
    episode.write(dir, st);
  }
}

/**
 * May the plan be edited? Not while the crew polishes it or the deck crew builds on it, and not once the script is
 * approved: after Script the plan is read-only, with no re-gate (PLAN §2.8); a lock or a mode keeps an approval and
 * stays allowed. `op` is the edit's name (null for an undo or a redo). Throws why not.
 */
function editable(episode, dir, op = null) {
  const st = episode.read(dir);
  const s = stageOf(st);
  if (!s || skipped(st)) throw new Error('This episode has no storyboard.');
  if (s.status === 'running') throw new Error('The storyboard is being planned.');
  if (st.stages.deck && st.stages.deck.status === 'running') throw new Error('The deck crew is working.');
  if (st.stages.script && st.stages.script.status === 'approved' && op !== 'lock' && op !== 'mode') {
    throw new Error('The script is approved: the storyboard is read-only now.');
  }
}

// ── the hooks ───────────────────────────────────────────────────────────────────────────────────────────────────

module.exports = {
  id: 'storyboard',
  order: 20,
  hooks: {
    stageVars(ctx, { dir, stageId, vars }) {
      if (stageId !== STAGE && stageId !== 'deck' && stageId !== 'script') return vars;
      const st = ctx.episode.read(dir);
      const styles = stylesText(ctx.d);
      const caps = capsFor(ctx.d);
      if (stageId === STAGE) {
        const got = storyboard.ensure(dir, { minutes: minutesOf(st), caps });
        return { ...vars, ...storyboard.promptVars(got.board), styles };
      }
      if (stageId === 'deck') holdForSurface(ctx.episode, dir, st, caps);
      return { ...vars, storyboard: deckBrief(dir, st, caps), styles };
    },
    open(ctx, { dir, view }) {
      const st = view && view.state;
      if (!st || skipped(st)) return { ...view, storyboard: null };
      const caps = capsFor(ctx.d);
      ensureOpen(ctx.episode, dir, st, caps);
      const v = fs.existsSync(path.join(dir, 'presentation', storyboard.FILE)) ? storyboard.view(dir, { caps }) : null;
      return { ...view, storyboard: v };
    },
    async planning(ctx, { dir }) {
      const lines = planLines(ctx.episode, dir, ctx.episode.read(dir), capsFor(ctx.d));
      return lines.length ? { lines } : null;
    },
    approved(ctx, { dir, stageId, by }) {
      if (stageId === 'deck') { ctx.motion.refreshMedia(dir); return; }
      if (stageId !== STAGE) return;
      const st = ctx.episode.read(dir);
      const board = skipped(st) ? null : storyboard.read(dir);
      if (!board) return;
      const mode = board.mode || (by === 'jazz' ? 'jazz' : 'directed');
      storyboard.write(dir, storyboard.approve(board, { mode }));
      st.stages[STAGE] = { ...st.stages[STAGE], mode };
      ctx.episode.write(dir, st);
    },
  },
  // for api/storyboard.js and the tests (the loader reads only id, order and hooks)
  capsFor, stylesText, deckBrief, defaultBoard, planLines, viewFor, reopenIfChanged, readyForApproval, reviewable, recordMode, editable,
  holdForSurface, stageOpen, skipped, NO_PLAN,
};
