'use strict';
// The in-process tools agents call to check their own work. Both return plain text for the model.
const fs = require('fs');
const path = require('path');
const layoutqa = require('./layoutqa');
const episode = require('./episode');
const slop = require('./slop');
const modules = require('./modules');

async function checkDeck(projectDir, { pipeline, chrome }) {
  const deckDir = path.join(projectDir, 'presentation', 'deck', 'project');
  if (!fs.existsSync(path.join(deckDir, 'deck.json'))) return 'There is no deck/project/deck.json yet. Write the deck first.';
  if (!chrome) return 'Chrome isn\'t available, so the deck can\'t be checked. Tell the user to finish the Tools step.';
  const results = await layoutqa.checkDeck({ deckDir, chrome });
  const problems = layoutqa.summarize(results);
  const r = await pipeline.render(projectDir, {});
  const slidesDir = path.join(projectDir, 'presentation', 'slides');
  const pngs = fs.existsSync(slidesDir) ? fs.readdirSync(slidesDir).filter((f) => /^slide_\d+\.png$/.test(f)).sort().map((f) => path.join(slidesDir, f)) : [];
  const calls = pendingCalls(projectDir);
  const unused = unusedModules(projectDir);
  return [
    problems.length ? `${problems.length} layout problem(s):\n- ${problems.join('\n- ')}` : 'Layout check: no problems found.',
    calls.length ? `Calls not yet recorded in deck/project/modules.json: ${calls.join(', ')}. Handle each one.` : null,
    unused.length ? `Modules not used yet: ${unused.join(', ')}. The default is all seven at least once, unless the brief or the user's notes say otherwise.` : null,
    r.code === 0 ? `Rendered ${pngs.length} slide(s) (open a few with Read to judge them by eye):\n${pngs.join('\n')}` : `The render failed:\n${r.lines.slice(-6).join('\n')}`,
  ].filter(Boolean).join('\n\n');
}

/** The seven modules the deck doesn't use yet (none to report until the crew has written modules.json). */
function unusedModules(projectDir) {
  try { return modules.missing(JSON.parse(fs.readFileSync(path.join(projectDir, 'presentation', 'deck', 'project', 'modules.json'), 'utf8'))); } catch { return []; }
}

/** The ids of the user's calls that modules.json doesn't mention yet. */
function pendingCalls(projectDir) {
  const st = episode.read(projectDir);
  const ids = ((st && st.calls) || []).map((c) => c.id);
  if (!ids.length) return [];
  let map = {};
  try { map = JSON.parse(fs.readFileSync(path.join(projectDir, 'presentation', 'deck', 'project', 'modules.json'), 'utf8')); } catch { return ids; }
  const seen = new Set([...Object.values(map.slides || {}), ...(map.cutscenes || [])].map((x) => x && x.call).filter(Boolean));
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
  return out.join('\n');
}

module.exports = { checkDeck, scriptStats, pendingCalls, unusedModules };
