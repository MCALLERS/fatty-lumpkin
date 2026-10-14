'use strict';
// An episode is an ordinary project folder (the same layout the skills use, so every script runs unchanged) plus
// flpt-project.json, the app's record of where it is in the flow. Stages run in order; each one is reviewed and
// approved before the next opens.
const fs = require('fs');
const path = require('path');

const STAGES = [
  { id: 'intake', label: 'Intake', kind: 'form' },
  { id: 'bullets', label: 'Bullets', kind: 'agent', model: 'opus', web: true, budgetUsd: 4 },
  { id: 'factcheck', label: 'Fact-check', kind: 'agent', model: 'sonnet', web: true, budgetUsd: 4 },
  { id: 'deck', label: 'Deck', kind: 'agent', model: 'opus', web: false, budgetUsd: 8 },
  { id: 'script', label: 'Script', kind: 'agent', model: 'opus', web: false, budgetUsd: 4 },
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

function stateFile(dir) { return path.join(dir, 'flpt-project.json'); }

/**
 * A record from before a stage existed gets it: Refine (added after 0.5.1) counts as approved for an episode already
 * delivered, and is still to do for any other. The next write keeps it.
 */
function migrate(st) {
  if (!st || typeof st !== 'object' || !st.stages || typeof st.stages !== 'object') return st;
  for (const id of STAGE_IDS) {
    if (st.stages[id] && typeof st.stages[id] === 'object') continue;
    const delivered = st.stages.deliver && st.stages.deliver.status === 'approved';
    st.stages[id] = { status: id === 'intake' || (id === 'refine' && delivered) ? 'approved' : 'todo' };
  }
  return st;
}

function read(dir) {
  try { return migrate(JSON.parse(fs.readFileSync(stateFile(dir), 'utf8'))); } catch { return null; }
}

function write(dir, state) {
  const tmp = stateFile(dir) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2));
  fs.renameSync(tmp, stateFile(dir));
  return read(dir);
}

const LENGTHS = [3, 5, 8, 12, 15];
function clean(intake) {
  const t = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const minutes = LENGTHS.includes(Number(intake && intake.minutes)) ? Number(intake.minutes) : 5;
  const bring = ['idea', 'notes', 'script'].includes(intake && intake.bring) ? intake.bring : 'idea';
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
  return write(dir, { v: 1, title: i.title, intake: i, createdAt: new Date().toISOString(), stages, costs: [] });
}

/** The first stage that isn't approved: where the user should be. */
function current(state) { return STAGE_IDS.find((id) => state.stages[id].status !== 'approved') || 'deliver'; }

/** A stage may run only when everything before it is approved. */
function canRun(state, id) {
  const i = STAGE_IDS.indexOf(id);
  return i > 0 && STAGE_IDS.slice(0, i).every((p) => state.stages[p].status === 'approved');
}

function setStage(dir, id, patch) {
  const st = read(dir);
  st.stages[id] = { ...st.stages[id], ...patch, at: new Date().toISOString() };
  // Re-running a stage re-opens everything after it: later work was built on the old version.
  if (patch.status === 'running') for (const later of STAGE_IDS.slice(STAGE_IDS.indexOf(id) + 1)) {
    if (st.stages[later].status === 'approved') st.stages[later] = { ...st.stages[later], status: 'stale' };
  }
  return write(dir, st);
}

function addCost(dir, entry) {
  const st = read(dir);
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

module.exports = { STAGES, STAGE_IDS, slugify, read, write, create, current, canRun, setStage, addCost, parseScript, estimateSeconds,
  slideSeconds, slideTarget, clean, migrate };
