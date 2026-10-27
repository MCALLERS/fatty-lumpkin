'use strict';
// The in-process tools agents call to check their own work. Both return plain text for the model.
//
// check_deck holds the deck to the approved storyboard when the episode has one (storyboard.checkDeck: every shot on
// its own slide, in order, its module as planned or a reason given, each scene between slides in its list), and
// reports the modules it plans that the deck doesn't use yet against the storyboard's policy. An episode whose
// storyboard was skipped (made before 2.0, or with nothing to plan) is held to the default instead: each of the seven
// originals once and at least one Live Motion scene.
const fs = require('fs');
const path = require('path');
const layoutqa = require('./layoutqa');
const episode = require('./episode');
const slop = require('./slop');
const modules = require('./modules');
const motion = require('./motion');
const animators = require('./animators');
const scenes = require('./scenes');
const storyboard = require('./storyboard');
const livemotion = require('./livemotion');

/** check_deck, again when a read was cut short (an iCloud file still downloading): three tries, a second apart. */
async function checkDeck(projectDir, deps, tries = 3) {
  for (let i = 1; ; i++) {
    try { return await checkDeckOnce(projectDir, deps); } catch (e) {
      if (!/\bEINTR\b|interrupted system call/.test(String(e && e.message)) || i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function checkDeckOnce(projectDir, { pipeline, chrome, engineRoot = null, projectsDir = null }) {
  const deckDir = path.join(projectDir, 'presentation', 'deck', 'project');
  if (!fs.existsSync(path.join(deckDir, 'deck.json'))) return 'There is no deck/project/deck.json yet. Write the deck first.';
  // without Chrome the layout can't be checked, but the plan can
  if (!chrome) return ['Chrome isn\'t available, so the layout can\'t be checked. Tell the user to finish the Tools step.', ...planChecks(projectDir, { engineRoot, projectsDir })].join('\n\n');
  const results = await layoutqa.checkDeck({ deckDir, chrome });
  const problems = layoutqa.summarize(results);
  const r = await pipeline.render(projectDir, {});
  const slidesDir = path.join(projectDir, 'presentation', 'slides');
  const pngs = fs.existsSync(slidesDir) ? fs.readdirSync(slidesDir).filter((f) => /^slide_\d+\.png$/.test(f)).sort().map((f) => path.join(slidesDir, f)) : [];
  return [
    problems.length ? `${problems.length} layout problem(s):\n- ${problems.join('\n- ')}` : 'Layout check: no problems found.',
    ...planChecks(projectDir, { engineRoot, projectsDir }),
    r.code === 0 ? `Rendered ${pngs.length} slide(s) (open a few with Read to judge them by eye):\n${pngs.join('\n')}` : `The render failed:\n${r.lines.slice(-6).join('\n')}`,
  ].filter(Boolean).join('\n\n');
}

/**
 * Everything check_deck says about the deck's plan, without Chrome: the storyboard, the user's calls, the modules,
 * the scene plans, the builds, the insets, the animators' marks, the cartoon and cut-scene plans and the Live Motion
 * pieces' plans (livemotion.checkPlan; their styles too when the engine is known, Mine and Shared ones with the
 * projects folder). [] when all is well; each entry is one paragraph for the crew.
 */
function planChecks(projectDir, { engineRoot = null, projectsDir = null } = {}) {
  const board = planInForce(projectDir);
  const shots = board ? storyboard.checkDeck(projectDir) : [];
  const calls = pendingCalls(projectDir);
  const unused = unusedModules(projectDir, board);
  const sceneLines = scenePlanProblems(projectDir);
  const builds = motion.checkBuilds(projectDir);
  const insets = motion.checkInsets(projectDir);
  const marks = animators.checkMarks(projectDir);
  const plans = scenes.checkPlan(projectDir);
  let live = [];
  try { live = livemotion.checkPlan(projectDir, engineRoot ? { engineRoot, projectsDir } : {}); } catch { live = []; } // a deck it can't read: the checks above say so
  return [
    shots.length ? `${shots.length} storyboard problem(s) (build exactly the approved storyboard: one slide per shot, in its order, each scene between slides in its list):\n- ${shots.join('\n- ')}` : null,
    calls.length ? `Calls not yet recorded in deck/project/modules.json: ${calls.join(', ')}. Handle each one.` : null,
    unused.length ? (board
      ? `Modules the storyboard plans that the deck doesn't use yet: ${unused.join(', ')}. Checked against the storyboard's policy: build each shot as planned, or give the reason on its entry.`
      : `Modules not used yet: ${unused.join(', ')}. The default is each of the seven originals once and at least one Live Motion scene (motion-solo or motion-duet), unless the brief or the user's notes say otherwise or the talk is too short to fit them.`) : null,
    sceneLines.length ? `${sceneLines.length} scene plan problem(s):\n- ${sceneLines.join('\n- ')}` : null,
    builds.length ? `${builds.length} build problem(s) (the app animates the builds as written):\n- ${builds.join('\n- ')}` : null,
    insets.length ? `${insets.length} video inset problem(s) (the app plays the clip as recorded):\n- ${insets.join('\n- ')}` : null,
    marks.length ? `Animations of their own ("animate"):\n- ${marks.join('\n- ')}` : null,
    plans.length ? `${plans.length} cartoon or cut-scene plan problem(s) (the app makes them from these plans):\n- ${plans.join('\n- ')}` : null,
    live.length ? `${live.length} Live Motion plan problem(s) (the scene crews draw from these plans):\n- ${live.join('\n- ')}` : null,
  ].filter(Boolean);
}

/**
 * The approved storyboard the deck is built from, or null: none (an older episode), an empty one, or one whose stage
 * was skipped and still stands approved (the deck isn't held to a plan it never had; a skipped stage that went stale
 * or ran again is planned like any other).
 */
function planInForce(projectDir) {
  const st = episode.read(projectDir);
  const s = st && st.stages && st.stages.storyboard;
  if (s && s.status === 'approved' && s.skipped) return null;
  const board = storyboard.read(projectDir);
  return board && board.shots.length ? board : null;
}

function readModules(projectDir) {
  return JSON.parse(fs.readFileSync(path.join(projectDir, 'presentation', 'deck', 'project', 'modules.json'), 'utf8'));
}

/**
 * The modules the deck doesn't use yet (none to report until the crew has written modules.json): of the nine, or,
 * with a storyboard, of those it plans (a Solo ♪ between slides counts as a Motion Solo), leaving out a shot's module
 * the deck built differently with a reason on its entry.
 */
function unusedModules(projectDir, board = null) {
  let map;
  let missing;
  try { map = readModules(projectDir); missing = modules.missing(map); } catch { return []; }
  if (!board) return missing;
  const reasoned = new Set(Object.values((map && map.slides) || {})
    .filter((e) => e && typeof e === 'object' && typeof e.shot === 'string' && typeof e.reason === 'string' && e.reason.trim()).map((e) => e.shot));
  const planned = new Set(board.shots.filter((s) => !reasoned.has(s.id)).map((s) => s.module));
  return missing.filter((m) => planned.has(m));
}

/** What's wrong with each slide's and cut scene's scene plan in modules.json (modules.sceneProblems), as lines. */
function scenePlanProblems(projectDir) {
  let map;
  try { map = readModules(projectDir); } catch { return []; }
  if (!map || typeof map !== 'object') return [];
  const out = [];
  const slides = map.slides && typeof map.slides === 'object' && !Array.isArray(map.slides) ? map.slides : {};
  for (const [id, entry] of Object.entries(slides)) for (const p of modules.sceneProblems(entry)) out.push(`slide "${id}": ${p}`);
  (Array.isArray(map.cutscenes) ? map.cutscenes : []).forEach((entry, i) => {
    for (const p of modules.sceneProblems(entry)) out.push(`cut scene ${i + 1}${entry && entry.shot ? ` (${String(entry.shot).slice(0, 8)})` : ''}: ${p}`);
  });
  return out;
}

/** The ids of the user's calls that modules.json doesn't mention yet. */
function pendingCalls(projectDir) {
  const st = episode.read(projectDir);
  const ids = ((st && st.calls) || []).map((c) => c.id);
  if (!ids.length) return [];
  let map = {};
  try { map = readModules(projectDir); } catch { return ids; }
  const seen = new Set([...Object.values(map.slides || {}), ...(map.cutscenes || []), ...(map.jsscenes || [])].map((x) => x && x.call).filter(Boolean));
  return ids.filter((id) => !seen.has(id));
}

function scriptStats(projectDir, { minutes }) {
  const file = path.join(projectDir, 'presentation', 'script.md');
  if (!fs.existsSync(file)) return 'There is no script.md yet. Write it first.';
  const text = fs.readFileSync(file, 'utf8');
  const slides = episode.parseScript(text);
  if (!slides.length) return 'No "## SLIDE n — Title" headings found in script.md.';
  let deckCount = null;
  try { deckCount = JSON.parse(fs.readFileSync(path.join(projectDir, 'presentation', 'deck', 'project', 'deck.json'), 'utf8')).order.length; } catch { /* no deck */ }
  const words = (s) => s.replace(/\[[^\]]*\]/g, ' ').split(/\s+/).filter(Boolean).length;
  const lines = slides.map((s) => {
    const sec = episode.estimateSeconds([s]);
    const flag = sec < 25 ? '  ← short' : sec > 75 ? '  ← long' : '';
    return `  slide ${s.n}: ${words(s.narration)} words, ~${sec} s${flag}`;
  });
  const all = slides.map((s) => s.narration).join('\n\n');
  const total = episode.estimateSeconds(slides);
  const target = minutes * 60;
  const sc = slop.score(all.replace(/\[[^\]]*\]/g, ' '));
  const ums = (all.match(/\b(um|uh)\b/gi) || []).length;
  const laughs = (all.match(/\[(laughs?|chuckles?)\]/gi) || []).length;
  const totalWords = words(all);
  const out = [
    `${slides.length} slide(s)${deckCount != null && deckCount !== slides.length ? ` (the deck has ${deckCount}: they must match)` : ''}; ${totalWords} words; ~${Math.round(total / 6) / 10} min against a target of ${minutes} min (${Math.round((100 * (total - target)) / target)} %).`,
    ...lines,
    `Slop score ${sc.score}/5${sc.clean ? ' (clean)' : `: ${slop.describe(sc.hits).join('; ')}`}.`,
    `Fillers: ${ums} um/uh (about 1 per 140 words is right: ~${Math.round(totalWords / 140)} here). Laugh tags: ${laughs}${laughs ? ' (remove them: laughs are off)' : ''}.`,
  ];
  const cues = motion.checkCues(projectDir);
  if (cues.length) out.push(`Moving slides, insets and cartoons: ${cues.length} cue(s) the narration doesn't say yet (say each one, word for word, in order):\n- ${cues.join('\n- ')}`);
  return out.join('\n');
}

module.exports = { checkDeck, planChecks, planInForce, scriptStats, pendingCalls, unusedModules, scenePlanProblems };
