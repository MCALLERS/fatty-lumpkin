'use strict';
// The storyboard (PLAN §2.8, §2.14): the talk as shots, each one of the nine modules, planned after the fact-check and
// before the deck. Pure logic: nothing here spends, renders or calls a model, and presentation/storyboard.json is
// written by this module only.
//
//   parse(bullets.md)     the strawman, instant and free: one slide shot per "## Slide n — Title", its module from the
//                         slide's Module: line (a synonym table), its seconds from its words
//   balance(board)        the solver: deterministic (ties sorted), the source of truth for the policy (the default plan
//                         by length): the Live Motion minimum, the originals by priority, the cut scene and the Solo ♪
//                         interstitials, the share target (never above maxLive), how Cosmos and cut scenes are made.
//                         Locked shots are never touched.
//   apply(board, edits)   the storyboard crew's edits (save_storyboard): the valid ones, then the solver
//   op(board, op)         one directed edit, validated; the shots it touches are locked. edit(dir, op) also keeps the
//                         50-step undo in storyboard.undo.jsonl (undo, redo)
//   price(dir, board)     running time, modules used, the Live Motion share, the Claude cap, HeyGen and paid scenes,
//                         crew time: recomputed on every read from the broker's rates, the module meta and the crew
//                         caps, never trusted from the file
//   view(dir)             what the board shows: the shots, the one totals line, its tooltip lines, the status lines
//   toDeckBrief(board)    the plan the deck crew builds exactly; checkDeck(dir) holds the deck to it
//   replan(board, md)     after the bullets change: merged by shot and bullets, locked shots kept, with a diff
//   saveTool({ z, dir })  the save_storyboard tool definition (W2-01 registers it for the storyboard stage)
//
// Guest narrators (W4-11, guestvoice.js): a slide with no presenter on screen (a Cosmos, a narrated Motion Solo) may
// carry `voice`: null (the presenter, the user's choice) or { provider, id, name } (another voice). With no `voice`, a
// Cosmos in a Jazz plan is told by Hobbiton Narrator where the FLPT voices can speak (caps.house; guestvoice.voiceOf). A shot that gets the presenter back (a new
// module, a Solo turned ♪) loses its voice. The op `voice` keeps the plan approved: it changes who speaks, not the plan.
//
// How Cosmos and cut scenes are made (decisions.md, D13): policy.paid is 'generate' where the surface can pay and has a
// generation key (Kie.ai or Higgsfield), else 'code'; the plugin, the Desk and a caller that names no surface always
// plan 'code' (and a board planned elsewhere is drawn in code when it gets there). The caps input says which:
// { surface: 'mac'|'web'|'desk'|'plugin', generation: bool, paidSteps?: bool, crew?: 'sdk'|'chat' }. Only `make`
// depends on it: the shots and their modules are the same either way.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const modules = require('./modules');
const broker = require('./broker');
const episode = require('./episode');
const scenes = require('./scenes');
const score = require('./score');
const guest = require('./guestvoice');

const SCHEMA = 'flpt.storyboard/1';
const SOLVER = '1.0.0';
const FILE = 'storyboard.json';
const UNDO_FILE = 'storyboard.undo.jsonl';
const UNDO_MAX = 50;
const ID = /^s[1-9][0-9]{0,3}$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const STYLE_ID = /^[a-z0-9][a-z0-9-]{0,47}(?:@[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})?$/;
const MUSIC = /^(?:none|score:[a-z0-9][a-z0-9-]{0,63}|library:[a-z0-9][a-z0-9-]{0,63}|file:[A-Za-z0-9._-]{1,128})$/;
const SFX = ['off', 'soft', 'on'];
const LIMITS = { title: 80, idea: 200, ask: 600, refs: 4, edits: 60, shots: 80, headings: 60, lines: 40, bullets: 40, minutes: [1, 60], slideSeconds: [1, 1800] };
const BETWEEN = { min: 4, max: 30, seconds: 8 };
const WORD_SECONDS = 0.4; // 150 words a minute
const SLIDE_SECONDS = 2; // a slide's own beat on top of its words

// What each Claude session may spend (PLAN §2.9, with the caps G0 set: decisions.md, 2026-10-22): a narrated Live
// Motion piece (Solo, Duet, a Cosmos drawn in code) 5 USD, an interstitial or a code cut scene 3.5 USD, the storyboard
// 2 USD. Agent stages and the animator mark come from episode.STAGES when they're there.
const CREW_USD = { storyboard: 2, live: 5, between: 3.5, mark: 4 };
const BASE_STAGES = [['bullets', 'Bullets', 4], ['factcheck', 'Fact-check', 4], ['storyboard', 'Storyboard', CREW_USD.storyboard], ['deck', 'Deck', 8], ['script', 'Script', 4]];
// Crew wall time: G0 measured 13.4 min for one piece; PARALLEL 3 pieces at a time; plus the stages before them and
// the free draft (an estimate).
const CREW_MINUTES = { piece: 15, pieceFast: 9, parallel: 3, pipeline: 40 }; // pieceFast: a Sonnet crew's, estimated (not yet measured)

const LIVE = new Set(['motion-solo', 'motion-duet']);
const PAID = new Set(['cosmos', 'cutscene']);
const ORIGINALS = modules.IDS.filter((m) => !modules.META[m].live);
// Which module goes first when not everything fits (PLAN §2.8).
const PRIORITY = ['sketch', 'motion-solo', 'chart', 'motion-duet', 'motion', 'infographic', 'cosmos', 'inset', 'cutscene'];
const SLIDE_PRIORITY = PRIORITY.filter((m) => m !== 'cutscene');
const SLIDE_MODULES = Object.keys(modules.META).filter((m) => modules.META[m].placement.includes('slide'));
const BETWEEN_MODULES = ['motion-solo', 'cutscene'];

// The default plan by length (PLAN §2.8's table). `solo`/`duet` are the narrated Live Motion slides it plans (a Duet
// at 3 minutes only from `duetAt` slides), `interstitials` the most Solo ♪ (`minInterstitials` of them even when the
// shot count is full), `cutscenes` the cut scenes (an original), `shots` the range it aims for.
const PLANS = [
  { minutes: 3, shots: [4, 5], originals: 'fit', solo: 1, duet: 1, duetAt: 5, liveShare: 0.30, maxLive: 2, interstitials: 0, minInterstitials: 0, cutscenes: 0 },
  { minutes: 5, shots: [7, 9], originals: 'all', solo: 1, duet: 1, duetAt: 0, liveShare: 0.35, maxLive: 4, interstitials: 1, minInterstitials: 0, cutscenes: 1 },
  { minutes: 8, shots: [9, 12], originals: 'all', solo: 2, duet: 1, duetAt: 0, liveShare: 0.40, maxLive: 5, interstitials: 1, minInterstitials: 1, cutscenes: 1 },
  { minutes: 12, shots: [12, 18], originals: 'all', solo: 2, duet: 2, duetAt: 0, liveShare: 0.40, maxLive: 6, interstitials: 2, minInterstitials: 1, cutscenes: 1 },
  { minutes: 15, shots: [12, 18], originals: 'all', solo: 3, duet: 2, duetAt: 0, liveShare: 0.40, maxLive: 7, interstitials: 2, minInterstitials: 1, cutscenes: 1 },
];

// ── small helpers ─────────────────────────────────────────────────────────────────────────────────────────────

const isObj = (x) => Boolean(x) && typeof x === 'object' && !Array.isArray(x);
const clone = (x) => JSON.parse(JSON.stringify(x));
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const num = (v, d) => (v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : d);
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const sum = (a) => a.reduce((x, y) => x + y, 0);
const isSlide = (s) => s.placement === 'slide';
const isBetween = (s) => s.placement === 'between';
const isInterstitial = (s) => isBetween(s) && s.module === 'motion-solo';
const isLiveShot = (s) => LIVE.has(s.module); // the Live Motion family: Solo, Duet, Solo ♪
const styled = (m) => LIVE.has(m) || PAID.has(m); // can carry a style and a sound (drawn in code)
const drawnInCode = (s) => LIVE.has(s.module) || (PAID.has(s.module) && s.make === 'code'); // a Live Motion crew piece
const countWords = (s) => (String(s || '').match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu) || []).length;
const pad2 = (n) => String(n).padStart(2, '0');

/** One line of plain text: no control characters, single spaces, at most max characters (cut at a word). */
function text(v, max) {
  if (typeof v !== 'string') return '';
  const s = v.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trim();
}
const mdText = (v, max) => (typeof v === 'string' ? text(v.replace(/(\*\*|__|`)/g, '').replace(/^["'“”‘’]+|["'“”‘’]+$/g, ''), max) : '');

function tileOf(m) {
  if (m === 'statement') return modules.TITLE_CARD.tile;
  const x = modules.byId(m);
  return x ? x.tile : String(m || '');
}
function nameOf(m) {
  if (m === 'statement') return modules.TITLE_CARD.name;
  const x = modules.byId(m);
  return x ? x.name : String(m || '');
}

// ── the policy ────────────────────────────────────────────────────────────────────────────────────────────────

const clampMinutes = (m) => Math.round(clamp(num(m, 5), LIMITS.minutes[0], LIMITS.minutes[1]));

/** The default plan's row for a talk of this length (the nearest length at or below it). */
function planFor(minutes) {
  const m = clampMinutes(minutes);
  let row = PLANS[0];
  for (const p of PLANS) if (m >= p.minutes) row = p;
  return row;
}

/**
 * Is a Generated Cosmos or cut scene possible on this surface at all? Only the Mac and the web can pay for one; the
 * plugin and the Desk never spend, and no caps (a caller that didn't say which surface) means no.
 */
function canGenerate(caps) {
  if (!isObj(caps) || (caps.surface !== 'mac' && caps.surface !== 'web') || caps.crew === 'chat') return false;
  return caps.paidSteps !== false;
}

/** How the default plan makes Cosmos and cut scenes (D13): generated where the surface can pay and has a key. */
function paidDefault(caps) {
  return canGenerate(caps) && caps.generation === true ? 'generate' : 'code';
}

/** A policy on this surface: where a Generated scene can't be made, every Cosmos and cut scene is planned in code. */
function surfacePolicy(policy, caps) {
  return canGenerate(caps) || policy.paid === 'code' ? policy : { ...policy, paid: 'code' };
}

/** The default policy for a talk of this length on this surface. */
function defaultPolicy(minutes, caps) {
  const row = planFor(minutes);
  return { minutes: clampMinutes(minutes), originals: row.originals, minLive: 1, liveShare: row.liveShare, maxLive: row.maxLive,
    interstitials: row.interstitials, paid: paidDefault(caps) };
}

/** A policy as read: clamped, unknown fields dropped, the length's defaults for what's missing. */
function cleanPolicy(p, minutesFallback) {
  const src = isObj(p) ? p : {};
  const minutes = clampMinutes(src.minutes != null ? src.minutes : minutesFallback);
  const d = defaultPolicy(minutes, null);
  const minLive = Math.round(clamp(num(src.minLive, d.minLive), 0, 12));
  return {
    minutes,
    originals: src.originals === 'all' || src.originals === 'fit' ? src.originals : d.originals,
    minLive,
    liveShare: +clamp(num(src.liveShare, d.liveShare), 0, 1).toFixed(3),
    maxLive: Math.max(minLive, Math.round(clamp(num(src.maxLive, d.maxLive), 0, 24))),
    interstitials: Math.round(clamp(num(src.interstitials, d.interstitials), 0, 8)),
    paid: src.paid === 'generate' || src.paid === 'allow' ? 'generate' : 'code',
  };
}

const interstitialCap = (pol) => Math.min(pol.interstitials, Math.floor(pol.minutes / 3));

// ── parse: bullets.md → the strawman ───────────────────────────────────────────────────────────────────────────

// What a slide's words say about it, counted once at parse (the solver reads these, never the text).
const TAGS = {
  data: /\d+(?:[.,]\d+)*\s*%?|\bper ?cent\b|\bsurveys?\b|\bdata\b|\brates?\b|\bmillions?\b|\bbillions?\b|\baverages?\b|\bmedian\b|\bshare of\b|\bgrowth\b|\bcharts?\b|\bgraphs?\b/g,
  verbs: /\b(?:spin|grow|flow|break|crack|compar|split|turn|fall|rise|rising|spread|collaps|connect|loop|move|stack|compound|feed|drift|pull|push|bend|tip|cascad|rippl|orbit|shrink|swell|fill|drain|flywheel|wave|engine|machine|chain|network|race|collid|bounc|unfold|multipl)\w*/g,
  story: /\b(?:once|story|stories|histor\w*|origin\w*|founder\w*|years ago|backstory|began|invent\w*|legend\w*|century|centuries|1[5-9]\d\d|20[0-2]\d)\b/g,
  steps: /\b(?:steps?|stages?|process\w*|framework\w*|timeline\w*|ladder\w*|versus|vs|phases?|cycles?|maps?|anatomy|layers?|first|second|third|three|four|five|six)\b/g,
  clip: /\b(?:clips?|film\w*|movies?|tv|video\w*|footage|watch\w*|trailers?|interview\w*)\b/g,
  picture: /\b(?:like an?|imagine|picture|metaphor|think of|as if|kitchen|bucket|road|bridge|house|garden|recipe|toast|everyday|napkin)\b/g,
  drama: /\b(?:night|room|door|storm|silence|silent|moment|suddenly|alarm|rain|crowd|waiting|deadline|phone|midnight|vault|empty|2 a\.?m)\b/g,
};
const TAG_KEYS = Object.keys(TAGS);
function tagsOf(s) {
  const t = String(s || '').toLowerCase();
  const out = {};
  for (const k of TAG_KEYS) out[k] = Math.min(9, (t.match(TAGS[k]) || []).length);
  return out;
}

// The Module: line's words → a module id. The leftmost mention wins (ties: the more specific entry first).
const SYNONYMS = [
  ['motion-duet', /\bmotion[\s-]*duet\b|\bduet\b/],
  ['motion-solo', /\bmotion[\s-]*solo\b|\bsolo\b|\bjs[\s-]*scenes?\b|\blive[\s-]*motion\b|\bdrawn (?:live )?in code\b/],
  ['cutscene', /\bcut[\s-]*scenes?\b|\bcinematic\b/],
  ['cosmos', /\bcosmos\b|\bcartoons?\b|\bvignettes?\b|\bpainted documentary\b/],
  ['sketch', /\bhand[\s-]*drawn\b|\bwhiteboard\b|\bsketch\w*|\bdoodle\w*|\bnotebook\b|\bavocado toast\b/],
  ['infographic', /\binfographics?\b|\bdiagrams?\b|\btimelines?\b|\bflow[\s-]*charts?\b|\bprocess\b|\bframework\b|\b2\s*[x×]\s*2\b|\bladder\b|\bbefore\s*\/\s*after\b/],
  ['chart', /\blive[\s-]*charts?\b|\bcharts?\b|\bgraphs?\b|\bbar\b|\bbars\b/],
  ['inset', /\bvideo[\s-]*insets?\b|\binsets?\b|\bclips?\b|\bfootage\b/],
  ['motion', /\bmotion[\s-]*(?:graphics?|gfx)\b|\bbuilds?\b|\banimated\b/],
  ['statement', /\btitle[\s-]*card\b|\bstatement\b|\btitle\b|\bquote\b|\baccent slide\b/],
];
const SYNONYM = Object.fromEntries(SYNONYMS);
const UNNARRATED = /♪|\bunnarrated\b|\bno narration\b|\binterstitial\b|\bbetween (?:the )?slides\b|\bsting\b|\bno voice\b/;

function leftmost(t, skip) {
  let best = null;
  for (const [id, re] of SYNONYMS) {
    if (skip.has(id)) continue;
    const m = re.exec(t);
    if (m && (!best || m.index < best.index)) best = { id, index: m.index };
  }
  return best;
}

/** A Module: line → { module (the slide's), between: 'cutscene'|'solo'|null (a scene after the slide) }. */
function moduleFrom(line) {
  const t = String(line || '').toLowerCase();
  const cut = SYNONYM.cutscene.test(t);
  const sting = !cut && SYNONYM['motion-solo'].test(t) && UNNARRATED.test(t);
  const skip = new Set(cut ? ['cutscene'] : sting ? ['motion-solo'] : []);
  const hit = leftmost(t, skip);
  return { module: hit ? hit.id : cut ? 'statement' : sting ? 'motion' : null, between: cut ? 'cutscene' : sting ? 'solo' : null };
}

/** The "## Slide n — Title" sections of bullets.md: title, lines (the bullets), their words, tags, Module: line. */
function readHeadings(md) {
  const heads = [];
  let cur = null;
  let comment = false;
  for (const raw of String(md == null ? '' : md).replace(/\r\n?/g, '\n').split('\n')) {
    let line = raw;
    if (comment) { const end = line.indexOf('-->'); if (end < 0) continue; line = line.slice(end + 3); comment = false; }
    line = line.replace(/<!--[\s\S]*?-->/g, '');
    const open = line.indexOf('<!--');
    if (open >= 0) { line = line.slice(0, open); comment = true; }
    const h = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const slide = h[1].length === 2 && /^slide\b\s*(\d+)?\s*(?:[—–:.)-]+\s*)?(.*)$/i.exec(h[2].trim());
      if (slide) {
        if (heads.length >= LIMITS.headings) { cur = null; continue; }
        cur = { title: mdText(slide[2], LIMITS.title), lines: [], module: null, visual: null };
        heads.push(cur);
      } else if (h[1].length <= 2) cur = null; // "# Title", "## Sources": the slides end
      continue; // "### …" inside a slide is a sub-heading, not a bullet
    }
    if (!cur) continue;
    const mod = /^\s*(?:[-*•+]\s+)?(?:\*\*|__)?\s*(module|visual)\s*(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(.*)$/i.exec(line);
    if (mod) {
      const k = mod[1].toLowerCase();
      if (cur[k] == null) cur[k] = mdText(mod[2], 400);
      continue;
    }
    if (/^\s*>/.test(line)) continue;
    const b = /^\s*(?:[-*•+]|\d+[.)])\s+(.*)$/.exec(line);
    const body = (b ? b[1] : line).trim();
    if (!body) continue;
    if (cur.lines.length < LIMITS.lines) cur.lines.push(body);
    else cur.lines[cur.lines.length - 1] += ` ${body}`;
  }
  return heads.map((x, i) => {
    const moduleLine = x.module != null ? x.module : x.visual || '';
    return {
      title: x.title || `Slide ${i + 1}`,
      // every slide has at least one line (a slide of a title alone is that title)
      words: x.lines.length ? x.lines.map(countWords) : [countWords(x.title)],
      tags: tagsOf(`${x.title} ${x.lines.join(' ')} ${moduleLine}`),
      moduleLine,
    };
  });
}

/**
 * The strawman, free and instant: one slide shot per "## Slide n — Title" in bullets.md, its module from its Module:
 * line (a cut scene or an unnarrated Solo named there follows the slide as a scene of its own), its seconds = its
 * words × 0.4 + 2, scaled so the slides fill the talk's minutes (the script is written to that length).
 * opts: { minutes, caps, policy, now }. Not balanced: balance() or strawman() for the default plan.
 */
function parse(bulletsMd, opts = {}) {
  const heads = readHeadings(bulletsMd);
  const minutes = clampMinutes(opts.minutes != null ? opts.minutes : opts.policy && opts.policy.minutes);
  const policy = surfacePolicy(opts.policy ? cleanPolicy({ ...opts.policy, minutes }) : defaultPolicy(minutes, opts.caps), opts.caps);
  const raw = heads.map((h) => sum(h.words) * WORD_SECONDS + SLIDE_SECONDS);
  const total = sum(raw);
  const scale = total > 0 ? +((minutes * 60) / total).toFixed(4) : 1;
  const shots = [];
  let nextId = heads.length + 1;
  const after = [];
  heads.forEach((h, i) => {
    const id = `s${i + 1}`;
    const { module, between } = moduleFrom(h.moduleLine);
    const m = module || 'motion';
    shots.push({ id, bullets: [i + 1], placement: 'slide', module: m, ...(PAID.has(m) ? { make: policy.paid } : {}), title: h.title, estSeconds: Math.max(1, Math.round(raw[i] * scale)) });
    if (between) after.push({ after: id, kind: between });
  });
  for (const x of after) {
    const t = { id: `s${nextId++}`, placement: 'between', after: x.after, module: x.kind === 'solo' ? 'motion-solo' : 'cutscene', seconds: BETWEEN.seconds };
    if (x.kind === 'solo') t.narrated = false; else t.make = policy.paid;
    shots.push(t);
  }
  const now = (opts.now ? opts.now() : new Date()).toISOString();
  return normalise({
    schema: SCHEMA, mode: null, policy, defaults: { style: null, sound: { music: 'none', sfx: 'soft' } }, nextId, shots,
    source: { bulletsSha: sha256(String(bulletsMd == null ? '' : bulletsMd)), parsedAt: now, polishedAt: null, plannerUsd: null, solver: SOLVER, scale,
      headings: heads.map((h) => ({ title: h.title, words: h.words, tags: h.tags })) },
    approvedAt: null,
  });
}

/** The default plan from bullets.md: parse, then balance. */
function strawman(bulletsMd, opts = {}) {
  return balance(parse(bulletsMd, opts), null, opts);
}

// ── normalise: a board as read (clamped, ordered, unknown fields dropped) ──────────────────────────────────────

function cleanHeadings(list) {
  return (Array.isArray(list) ? list : []).slice(0, LIMITS.headings).filter(isObj).map((h) => {
    const words = (Array.isArray(h.words) ? h.words : []).slice(0, LIMITS.lines).map((w) => Math.round(clamp(num(w, 0), 0, 9999)));
    const tags = {};
    for (const k of TAG_KEYS) tags[k] = Math.round(clamp(num(h.tags && h.tags[k], 0), 0, 9));
    return { title: text(h.title, LIMITS.title), words: words.length ? words : [0], tags };
  });
}

function cleanDiff(d) {
  if (!isObj(d)) return null;
  const ids = (a) => (Array.isArray(a) ? a : []).filter((x) => typeof x === 'string' && ID.test(x)).slice(0, LIMITS.shots);
  return {
    added: ids(d.added),
    removed: (Array.isArray(d.removed) ? d.removed : []).filter((x) => isObj(x) && typeof x.id === 'string' && ID.test(x.id)).slice(0, LIMITS.shots)
      .map((x) => ({ id: x.id, title: text(x.title, LIMITS.title), module: typeof x.module === 'string' ? x.module.slice(0, 20) : '' })),
    changed: (Array.isArray(d.changed) ? d.changed : []).filter((x) => isObj(x) && typeof x.id === 'string' && ID.test(x.id)).slice(0, LIMITS.shots)
      .map((x) => ({ id: x.id, fields: (Array.isArray(x.fields) ? x.fields : []).filter((f) => typeof f === 'string').map((f) => f.slice(0, 20)).slice(0, 20) })),
  };
}

function cleanSource(src, headings) {
  const s = isObj(src) ? src : {};
  const stamp = (v) => (typeof v === 'string' ? v.slice(0, 40) : null);
  const out = {
    bulletsSha: typeof s.bulletsSha === 'string' && /^[0-9a-f]{64}$/.test(s.bulletsSha) ? s.bulletsSha : null,
    parsedAt: stamp(s.parsedAt), polishedAt: stamp(s.polishedAt),
    plannerUsd: s.plannerUsd == null ? null : +clamp(num(s.plannerUsd, 0), 0, 1000).toFixed(4),
    solver: typeof s.solver === 'string' ? s.solver.slice(0, 16) : SOLVER,
    scale: +clamp(num(s.scale, 1), 0.01, 100).toFixed(4),
    headings,
  };
  const diff = cleanDiff(s.diff);
  if (diff) out.diff = diff;
  return out;
}

function musicOk(v) {
  if (typeof v !== 'string' || !MUSIC.test(v)) return false;
  try { score.parseMusic(v); return true; } catch (e) { return /engine is missing/.test(String(e && e.message)); }
}
function cleanSound(v) {
  if (!isObj(v)) return null;
  const out = {};
  if (musicOk(v.music)) out.music = v.music;
  if (SFX.includes(v.sfx)) out.sfx = v.sfx;
  return out.music || out.sfx ? out : null;
}

const lineCount = (b, h) => { const hd = b.source.headings[h - 1]; return hd ? hd.words.length : 1; };

/** One shot as read, its keys in one order (null: not a shot that can be kept). */
function cleanShot(s, headings) {
  if (!isObj(s)) return null;
  const placement = s.placement === 'between' ? 'between' : 'slide';
  let module = typeof s.module === 'string' ? s.module : '';
  if (placement === 'slide' && !SLIDE_MODULES.includes(module)) module = 'motion';
  if (placement === 'between' && !BETWEEN_MODULES.includes(module)) return null;
  const c = { id: typeof s.id === 'string' && ID.test(s.id) ? s.id : null };
  const H = headings.length;
  if (placement === 'slide') {
    const bullets = [...new Set((Array.isArray(s.bullets) ? s.bullets : []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= (H || 999)))].slice(0, LIMITS.bullets);
    if (!bullets.length) return null;
    c.bullets = bullets;
    if (bullets.length === 1 && Array.isArray(s.part) && s.part.length === 2) {
      const n = headings[bullets[0] - 1] ? headings[bullets[0] - 1].words.length : LIMITS.lines;
      const [a, z] = s.part.map(Number);
      if (Number.isInteger(a) && Number.isInteger(z) && a >= 0 && z <= n && a < z && !(a === 0 && z === n)) c.part = [a, z];
    }
  }
  c.placement = placement;
  if (placement === 'between') c.after = typeof s.after === 'string' && (s.after === '' || ID.test(s.after)) ? s.after : null;
  c.module = module;
  if (PAID.has(module) && (s.make === 'code' || s.make === 'generate')) c.make = s.make;
  if (placement === 'between' && module === 'motion-solo') c.narrated = false;
  const title = text(s.title, LIMITS.title);
  if (title) c.title = title;
  const idea = text(s.idea, LIMITS.idea);
  if (idea) c.idea = idea;
  if (placement === 'slide') {
    c.estSeconds = Math.round(clamp(num(s.estSeconds, 30), LIMITS.slideSeconds[0], LIMITS.slideSeconds[1]));
    if (s.secondsSet === true) c.secondsSet = true; // the user's length: a re-plan keeps it
  } else c.seconds = Math.round(clamp(num(s.seconds, BETWEEN.seconds), BETWEEN.min, BETWEEN.max));
  if (styled(module)) {
    // no style (or null) is the episode's style
    if (typeof s.style === 'string' && STYLE_ID.test(s.style)) c.style = s.style;
    const sound = cleanSound(s.sound);
    if (sound) c.sound = sound;
  }
  // a guest voice (W4-11): only on a slide with no presenter on screen; null is the presenter, chosen
  if (Object.prototype.hasOwnProperty.call(s, 'voice') && guest.canTake(c)) {
    const v = s.voice === null ? null : guest.cleanVoice(s.voice);
    if (v || s.voice === null) c.voice = v;
  }
  const refs = [...new Set((Array.isArray(s.refs) ? s.refs : []).filter((r) => typeof r === 'string' && REF.test(r)))].slice(0, LIMITS.refs);
  if (refs.length) c.refs = refs;
  const ask = text(s.ask, LIMITS.ask);
  if (ask) c.ask = ask;
  if (s.locked === true) c.locked = true;
  if (placement === 'between' && module === 'motion-solo' && isObj(s.was)) {
    const w = cleanShot({ id: 's1', bullets: s.was.bullets, part: s.was.part, placement: 'slide', module: 'motion-solo', estSeconds: s.was.estSeconds, secondsSet: s.was.secondsSet }, headings);
    if (w && typeof s.was.from === 'string' && ID.test(s.was.from)) {
      c.was = { bullets: w.bullets, ...(w.part ? { part: w.part } : {}), estSeconds: w.estSeconds, ...(w.secondsSet ? { secondsSet: true } : {}), from: s.was.from,
        betweens: (Array.isArray(s.was.betweens) ? s.was.betweens : []).filter((x) => typeof x === 'string' && ID.test(x)).slice(0, 8) };
    }
  }
  return c;
}

/**
 * Film order: the slides in their order, each followed by the scenes after it; scenes before the first slide (a cold
 * open, `after: ""`) first. A scene whose slide is gone follows the slide before it in the list.
 */
function filmOrder(shots) {
  const slides = shots.filter(isSlide);
  const ids = new Set(slides.map((s) => s.id));
  const groups = new Map([['', []], ...slides.map((s) => [s.id, []])]);
  let last = '';
  for (const s of shots) {
    if (isSlide(s)) { last = s.id; continue; }
    if (s.after == null || (s.after !== '' && !ids.has(s.after))) s.after = last;
    groups.get(s.after).push(s);
  }
  const out = [...groups.get('')];
  for (const s of slides) out.push(s, ...groups.get(s.id));
  return out;
}

/** A board as read: everything clamped, unknown fields dropped, ids unique, shots in film order. Never throws. */
function normalise(raw, opts = {}) {
  const b = isObj(raw) ? raw : {};
  const headings = cleanHeadings(b.source && b.source.headings);
  const d = isObj(b.defaults) ? b.defaults : {};
  const out = {
    schema: SCHEMA,
    mode: b.mode === 'jazz' || b.mode === 'directed' ? b.mode : null,
    policy: cleanPolicy(b.policy, opts.minutes),
    defaults: { style: typeof d.style === 'string' && STYLE_ID.test(d.style) ? d.style : null, sound: cleanSound(d.sound) || { music: 'none', sfx: 'soft' } },
    nextId: 1,
    shots: [],
    source: cleanSource(b.source, headings),
    approvedAt: typeof b.approvedAt === 'string' ? b.approvedAt.slice(0, 40) : null,
  };
  const seen = new Set();
  let top = 0;
  const shots = [];
  for (const s of (Array.isArray(b.shots) ? b.shots : []).slice(0, LIMITS.shots)) {
    const c = cleanShot(s, headings);
    if (!c) continue;
    if (c.id && !seen.has(c.id)) { seen.add(c.id); top = Math.max(top, Number(c.id.slice(1))); } else c.id = null;
    shots.push(c);
  }
  let next = Math.max(Number.isInteger(b.nextId) ? b.nextId : 1, top + 1);
  for (const c of shots) if (!c.id) c.id = `s${next++}`;
  out.nextId = Math.min(next, 9999);
  out.shots = filmOrder(shots);
  return out;
}

// ── validate: what's wrong with a board, as lines ([] when it holds every rule of §2.14) ───────────────────────

function rangeOf(b, s) {
  if (!isSlide(s) || s.bullets.length !== 1) return null;
  return s.part ? { h: s.bullets[0], from: s.part[0], to: s.part[1] } : { h: s.bullets[0], from: 0, to: lineCount(b, s.bullets[0]) };
}

function validate(board) {
  const out = [];
  if (!isObj(board)) return ['Not a storyboard.'];
  if (board.schema !== SCHEMA) out.push(`schema is "${String(board.schema).slice(0, 40)}", not "${SCHEMA}".`);
  const b = normalise(board);
  const shots = Array.isArray(board.shots) ? board.shots : [];
  if (shots.length !== b.shots.length) out.push(`${shots.length - b.shots.length} shot(s) can't be read.`);
  const ids = shots.map((s) => (isObj(s) ? s.id : null));
  if (ids.some((id) => typeof id !== 'string' || !ID.test(id))) out.push('Every shot needs an id s<n>.');
  if (new Set(ids).size !== ids.length) out.push('Shot ids repeat.');
  if (ids.some((id) => typeof id === 'string' && ID.test(id) && Number(id.slice(1)) >= board.nextId)) out.push('A shot id is at or past nextId.');
  if (shots.map((s) => isObj(s) && s.id).join() !== b.shots.map((s) => s.id).join()) out.push('The shots aren\'t in film order (each scene between slides right after its slide).');
  const H = b.source.headings.length;
  if (!b.shots.some(isSlide)) out.push('No slide shots.');
  if (H) {
    for (let h = 1; h <= H; h++) {
      const whole = b.shots.filter((s) => isSlide(s) && s.bullets.includes(h) && !s.part);
      const parts = b.shots.filter((s) => isSlide(s) && s.part && s.bullets[0] === h).map((s) => s.part).sort((x, y) => x[0] - y[0]);
      if (whole.length + parts.length === 0) { out.push(`Slide ${h} of the bullets is in no shot.`); continue; }
      if (whole.length > 1 || (whole.length && parts.length)) { out.push(`Slide ${h} of the bullets is in more than one shot.`); continue; }
      if (parts.length) {
        let at = 0;
        for (const [a, z] of parts) { if (a !== at) break; at = z; }
        if (at !== lineCount(b, h)) out.push(`The parts of slide ${h} of the bullets don't cover it once.`);
      }
    }
  }
  for (const raw of shots.filter(isObj)) {
    const s = b.shots.find((x) => x.id === raw.id);
    if (!s) continue;
    if (raw.placement !== 'slide' && raw.placement !== 'between') out.push(`${s.id}: placement is "slide" or "between".`);
    if (raw.module !== s.module) out.push(`${s.id}: "${String(raw.module).slice(0, 20)}" can't be a ${s.placement === 'slide' ? 'slide' : 'scene between slides'}.`);
    if (typeof raw.idea === 'string' && raw.idea.length > LIMITS.idea) out.push(`${s.id}: the idea is over ${LIMITS.idea} characters.`);
    if (isBetween(s)) {
      if (raw.seconds != null && (raw.seconds < BETWEEN.min || raw.seconds > BETWEEN.max)) out.push(`${s.id}: ${BETWEEN.min}–${BETWEEN.max} seconds.`);
      if (raw.after !== s.after) out.push(`${s.id}: it follows a slide shot that isn't there.`);
      if (s.module === 'motion-solo' && raw.narrated !== false) out.push(`${s.id}: a Solo between slides is unnarrated.`);
    } else if (raw.narrated === false) out.push(`${s.id}: a slide is narrated.`);
    if (raw.make != null && !(PAID.has(s.module) && (raw.make === 'code' || raw.make === 'generate'))) out.push(`${s.id}: "make" is code or generate, on a Cosmos or cut scene only.`);
    if (PAID.has(s.module) && raw.make == null) out.push(`${s.id}: no "make".`);
    if (raw.style != null && s.style !== raw.style) out.push(`${s.id}: the style "${String(raw.style).slice(0, 40)}" isn't one this shot can take.`);
    if (raw.sound != null && JSON.stringify(cleanSound(raw.sound)) !== JSON.stringify(raw.sound)) out.push(`${s.id}: the sound isn't one FLPT knows.`);
    if (raw.voice != null && !guest.canTake(s)) out.push(`${s.id}: only a slide with no presenter on screen takes a guest voice.`);
    else if (raw.voice != null && !s.voice) out.push(`${s.id}: the voice isn't one FLPT knows.`);
  }
  return out;
}

// ── the solver ──────────────────────────────────────────────────────────────────────────────────────────────────

function featuresOf(b, s) {
  const f = Object.fromEntries(TAG_KEYS.map((k) => [k, 0]));
  const hs = isSlide(s) ? s.bullets.map((h) => b.source.headings[h - 1]).filter(Boolean) : [];
  for (const h of hs) for (const k of TAG_KEYS) f[k] += h.tags[k];
  const own = tagsOf(hs.length ? s.idea : `${s.title || ''} ${s.idea || ''}`);
  for (const k of TAG_KEYS) f[k] += own[k];
  return f;
}

/** How well a slide shot suits a module (higher is better; its own module +100, so the bullets' choice holds). */
function fit(b, s, m) {
  const f = featuresOf(b, s);
  const sec = s.estSeconds || 0;
  const c3 = (n) => Math.min(3, n);
  let x = s.module === m ? 100 : 0;
  switch (m) {
    case 'motion-solo':
    case 'motion-duet':
      // narration 20–60 s, an idea that moves, not a data chart
      x += sec >= 20 && sec <= 60 ? 10 : -Math.min(10, Math.abs(sec - (sec < 20 ? 20 : 60)) / 5);
      x += 3 * c3(f.verbs) - 4 * c3(f.data) - (s.module === 'chart' ? 10 : 0);
      if (m === 'motion-solo' && sec >= 30) x += 2;
      break;
    case 'chart': x += 5 * c3(f.data); break;
    case 'sketch': x += 4 * c3(f.picture) + (f.data ? 0 : 2); break;
    case 'infographic': x += 4 * c3(f.steps); break;
    case 'cosmos': x += 5 * c3(f.story) + (sec >= 40 && sec <= 70 ? 4 : 0); break;
    case 'inset': x += 6 * c3(f.clip); break;
    case 'motion': x += 1 + c3(f.steps); break;
    case 'statement': x += sec < 25 ? 3 : 0; break;
    default: break;
  }
  return x;
}

/** Set a shot's module, and what goes with it (how a Cosmos or cut scene is made; no style on a data slide). */
function setModule(b, s, m, make) {
  s.module = m;
  if (PAID.has(m)) s.make = make === 'code' || make === 'generate' ? make : s.make || b.policy.paid;
  else delete s.make;
  if (isBetween(s) && m === 'motion-solo') s.narrated = false;
  else delete s.narrated;
  if (!styled(m)) { delete s.style; delete s.sound; }
  if (!guest.canTake(s)) delete s.voice; // the presenter is on screen again: the presenter speaks
}

const totalSeconds = (b) => sum(b.shots.map((s) => (isSlide(s) ? s.estSeconds : s.seconds) || 0));
const liveSeconds = (b) => sum(b.shots.filter(isLiveShot).map((s) => (isSlide(s) ? s.estSeconds : s.seconds) || 0));
const shareOf = (b) => { const t = totalSeconds(b); return t > 0 ? liveSeconds(b) / t : 0; };

/**
 * The slide modules the default plan asks for, in priority order (the Live Motion minimum first), less what locked
 * shots already hold, with no more Live Motion than maxLive leaves room for.
 */
function needed(b, pol) {
  const row = planFor(pol.minutes);
  const slides = b.shots.filter(isSlide);
  const locked = slides.filter((s) => s.locked);
  const lockedLiveSlides = locked.filter(isLiveShot).length;
  const lockedLive = lockedLiveSlides + b.shots.filter((s) => isInterstitial(s) && s.locked).length;
  const duet = row.duetAt && slides.length < row.duetAt ? 0 : row.duet;
  let W = [];
  for (const m of SLIDE_PRIORITY) {
    const n = m === 'motion-solo' ? row.solo : m === 'motion-duet' ? duet : 1;
    for (let i = 0; i < n; i++) W.push(m);
  }
  for (const s of locked) { const i = W.indexOf(s.module); if (i >= 0) W.splice(i, 1); }
  const room = Math.max(0, pol.maxLive - lockedLive);
  let live = 0;
  W = W.filter((m) => !LIVE.has(m) || live++ < room);
  const must = Math.min(room, Math.max(0, pol.minLive - lockedLiveSlides));
  const front = [];
  for (let k = 0; k < must; k++) {
    const i = W.findIndex((m) => LIVE.has(m));
    front.push(i >= 0 ? W.splice(i, 1)[0] : 'motion-solo');
  }
  return [...front, ...W];
}

function newId(b) {
  if (b.nextId >= 9999) throw new Error('This storyboard has no more shot ids.');
  const id = `s${b.nextId}`;
  b.nextId += 1;
  return id;
}

/** A new scene between slides (kind 'solo': an unnarrated Motion Solo, ♪; 'cutscene'), after slide `after` ('' first). */
function addBetween(b, after, kind, extra = {}) {
  if (after !== '' && !b.shots.some((s) => isSlide(s) && s.id === after)) throw new Error('No such slide.');
  const t = { id: newId(b), placement: 'between', after, module: kind === 'solo' ? 'motion-solo' : 'cutscene' };
  if (kind === 'solo') t.narrated = false;
  else t.make = extra.make === 'code' || extra.make === 'generate' ? extra.make : b.policy.paid;
  const title = text(extra.title, LIMITS.title);
  if (title) t.title = title;
  const idea = text(extra.idea, LIMITS.idea);
  if (idea) t.idea = idea;
  t.seconds = Math.round(clamp(num(extra.seconds, BETWEEN.seconds), BETWEEN.min, BETWEEN.max));
  b.shots.push(t);
  b.shots = filmOrder(b.shots);
  return t;
}

const drop = (b, s) => { b.shots = b.shots.filter((x) => x !== s); };

/**
 * The gap for a new scene between slides: never after the last slide, never where a scene already is. A cut scene
 * goes where the words want it most (the most dramatic slide, then nearest 60 % of the way in); a Solo ♪ where it is
 * furthest from the start, the end and every other scene.
 */
function pickGap(b, kind) {
  const slides = b.shots.filter(isSlide);
  if (slides.length < 2) return null;
  const taken = new Set(b.shots.filter(isBetween).map((s) => s.after));
  const ends = [];
  let t = 0;
  for (const s of slides) { t += s.estSeconds || 0; ends.push(t); }
  const T = t || 1;
  const cands = slides.slice(0, -1).map((s, j) => ({ s, j, t: ends[j] })).filter((g) => !taken.has(g.s.id));
  if (!cands.length) return null;
  if (kind === 'cutscene') {
    const drama = (g) => Math.min(3, featuresOf(b, g.s).drama);
    return cands.sort((x, y) => drama(y) - drama(x) || Math.abs(x.t - 0.6 * T) - Math.abs(y.t - 0.6 * T) || x.j - y.j)[0].s;
  }
  const marks = [0, T, ...b.shots.filter(isBetween).map((s) => (s.after === '' ? 0 : ends[slides.findIndex((x) => x.id === s.after)]))];
  const scored = cands.map((g) => ({ ...g, d: Math.min(...marks.map((m) => Math.abs(g.t - m))) }));
  return scored.sort((x, y) => y.d - x.d || x.j - y.j)[0].s;
}

/**
 * The solver (deterministic: the same board gives the same plan, ties sorted by film order). In order:
 *   1. scenes between slides: one per gap, none before the first slide under 5 minutes, Solo ♪ within the cap
 *      (at most policy.interstitials, and one per 3 minutes)
 *   2. the slides' modules: the plan's list (the Live Motion minimum first, then by priority: sketch, Solo, chart,
 *      Duet, motion, infographic, Cosmos, inset) as far as the free slides go; a slide that already has a module on
 *      the list keeps it, the rest go to the best-fitting free slides
 *   3. never more Live Motion than maxLive
 *   4. the cut scene (an original) and the Solo ♪ interstitials the plan asks for
 *   5. the Live Motion share: slides the plan left free are promoted toward the target, never past maxLive
 *   6. how Cosmos and cut scenes are made: policy.paid
 * Locked shots are never changed. policy (optional) replaces the board's. opts.notes collects what it did.
 */
function balance(board, policy = null, opts = {}) {
  const notes = Array.isArray(opts.notes) ? opts.notes : [];
  const b = normalise(board);
  if (policy) b.policy = cleanPolicy(policy, b.policy.minutes);
  const pol = b.policy;
  const row = planFor(pol.minutes);
  const name = (s) => `${s.id} (${tileOf(s.module)})`;

  // 1. scenes between slides
  if (pol.minutes < 5) {
    for (const s of b.shots.filter((x) => isBetween(x) && x.after === '' && !x.locked)) { drop(b, s); notes.push(`${name(s)} removed: nothing before the first slide in a talk under 5 minutes.`); }
  }
  const groups = new Map();
  for (const s of b.shots.filter(isBetween)) (groups.get(s.after) || groups.set(s.after, []).get(s.after)).push(s);
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const keep = list.find((x) => x.locked) || list[0];
    for (const x of list) if (x !== keep && !x.locked) { drop(b, x); notes.push(`${name(x)} removed: one scene between two slides.`); }
  }
  const cap = interstitialCap(pol);
  for (;;) {
    const list = b.shots.filter(isInterstitial);
    if (list.length <= cap) break;
    const x = [...list].reverse().find((y) => !y.locked);
    if (!x) break;
    drop(b, x);
    notes.push(`${name(x)} removed: at most ${cap} Solo ♪ in ${pol.minutes} minutes.`);
  }

  // 2. the slides' modules
  const slides = b.shots.filter(isSlide);
  const pos = new Map(slides.map((s, i) => [s.id, i]));
  const free = slides.filter((s) => !s.locked);
  const R = needed(b, pol).slice(0, free.length);
  const want = {};
  for (const m of R) want[m] = (want[m] || 0) + 1;
  const assigned = new Set();
  const best = (m) => (x, y) => fit(b, y, m) - fit(b, x, m) || pos.get(x.id) - pos.get(y.id);
  for (const m of PRIORITY) {
    if (!want[m]) continue;
    for (const s of free.filter((x) => x.module === m).sort(best(m)).slice(0, want[m])) { assigned.add(s.id); want[m] -= 1; }
  }
  // what's still wanted goes where it fits best: the best (module, slide) pair first, ties by priority, then film order
  for (;;) {
    const open = free.filter((x) => !assigned.has(x.id));
    const mods = PRIORITY.filter((m) => want[m] > 0);
    if (!open.length || !mods.length) break;
    let pick = null;
    for (const m of mods) {
      for (const s of open) {
        const f = fit(b, s, m);
        if (!pick || f > pick.f) pick = { m, s, f };
      }
    }
    notes.push(`${name(pick.s)} → ${tileOf(pick.m)}.`);
    setModule(b, pick.s, pick.m);
    assigned.add(pick.s.id);
    want[pick.m] -= 1;
  }

  // 3. never more Live Motion than maxLive
  const liveCount = () => b.shots.filter(isLiveShot).length;
  const liveFit = (s) => fit(b, s, 'motion-solo');
  const weakest = (list) => list.sort((x, y) => liveFit(x) - liveFit(y) || pos.get(y.id) - pos.get(x.id))[0];
  while (liveCount() > pol.maxLive) {
    const extra = weakest(free.filter((s) => !assigned.has(s.id) && isLiveShot(s)))
      || [...b.shots].reverse().find((s) => isInterstitial(s) && !s.locked)
      || weakest(free.filter(isLiveShot));
    if (!extra) { notes.push(`More Live Motion is locked than the policy's ${pol.maxLive}.`); break; }
    if (isBetween(extra)) { drop(b, extra); notes.push(`${name(extra)} removed: at most ${pol.maxLive} Live Motion pieces.`); continue; }
    notes.push(`${name(extra)} → ${tileOf('motion')}: at most ${pol.maxLive} Live Motion pieces.`);
    setModule(b, extra, 'motion');
    assigned.delete(extra.id);
  }

  // 4. the cut scene and the Solo ♪ interstitials
  if (b.shots.filter((s) => isBetween(s) && s.module === 'cutscene').length < row.cutscenes) {
    const gap = pickGap(b, 'cutscene');
    if (gap) { const t = addBetween(b, gap.id, 'cutscene'); notes.push(`${t.id} (${tileOf('cutscene')}) added after ${gap.id}.`); }
  }
  for (;;) {
    const n = b.shots.filter(isInterstitial).length;
    if (n >= cap || liveCount() >= pol.maxLive) break;
    if (n >= Math.min(cap, row.minInterstitials) && b.shots.length >= row.shots[1]) break;
    const gap = pickGap(b, 'solo');
    if (!gap) break;
    const t = addBetween(b, gap.id, 'solo');
    notes.push(`${t.id} (Solo ♪) added after ${gap.id}.`);
  }

  // 5. the Live Motion share
  while (shareOf(b) < pol.liveShare - 1e-9 && liveCount() < pol.maxLive) {
    const s = free.filter((x) => !assigned.has(x.id) && !isLiveShot(x)).sort((x, y) => liveFit(y) - liveFit(x) || pos.get(x.id) - pos.get(y.id))[0];
    if (!s) break;
    const solos = b.shots.filter((x) => isSlide(x) && x.module === 'motion-solo').length;
    const duets = b.shots.filter((x) => x.module === 'motion-duet').length;
    const m = duets < solos ? 'motion-duet' : 'motion-solo';
    notes.push(`${name(s)} → ${tileOf(m)}: toward ${Math.round(pol.liveShare * 100)} % Live Motion.`);
    setModule(b, s, m);
    assigned.add(s.id);
  }

  // 6. how Cosmos and cut scenes are made
  for (const s of b.shots) {
    if (PAID.has(s.module)) { if (!s.locked || !s.make) s.make = pol.paid; } else delete s.make;
  }
  b.source.solver = SOLVER;
  return normalise(b);
}

// ── edits: the shared moves behind op() (the user) and apply() (the storyboard crew) ───────────────────────────

const headingTitle = (b, h) => (b.source.headings[h - 1] ? b.source.headings[h - 1].title : '');
function headSeconds(b, h) {
  const hd = b.source.headings[h - 1];
  return hd ? (sum(hd.words) * WORD_SECONDS + SLIDE_SECONDS) * b.source.scale : 0;
}
/** A shot's narration seconds from its bullets (null when the board has no bullets to count). */
function estFor(b, bullets, part) {
  if (!b.source.headings.length) return null;
  if (part) {
    const hd = b.source.headings[bullets[0] - 1];
    if (!hd) return null;
    const all = sum(hd.words);
    const share = all > 0 ? sum(hd.words.slice(part[0], part[1])) / all : (part[1] - part[0]) / hd.words.length;
    return Math.max(1, Math.round(headSeconds(b, bullets[0]) * share));
  }
  return Math.max(1, Math.round(sum(bullets.map((h) => headSeconds(b, h)))));
}
/** New bullets for a slide shot: its seconds counted again from them (a length the user set no longer holds). */
function setBullets(b, s, j, fallbackSeconds) {
  s.bullets = j.bullets;
  if (j.part) s.part = j.part; else delete s.part;
  const e = estFor(b, s.bullets, s.part);
  s.estSeconds = e != null ? e : Math.max(1, Math.round(fallbackSeconds || s.estSeconds || 1));
  delete s.secondsSet;
}

/** The bullet lines a slide shot covers, in order: [{ h, i }]. */
function linesOf(b, s) {
  const out = [];
  for (const h of s.bullets) {
    const [from, to] = s.part || [0, lineCount(b, h)];
    for (let i = from; i < to; i++) out.push({ h, i });
  }
  return out;
}
/** Lines as one shot's bullets: whole slides of the bullets, or a run of lines inside one (null: neither). */
function asBullets(b, ls) {
  const hs = [...new Set(ls.map((x) => x.h))];
  if (hs.length === 1) {
    const n = lineCount(b, hs[0]);
    const from = ls[0].i;
    const to = ls[ls.length - 1].i + 1;
    return { bullets: hs, part: from === 0 && to === n ? null : [from, to] };
  }
  return hs.every((h) => ls.filter((x) => x.h === h).length === lineCount(b, h)) ? { bullets: hs, part: null } : null;
}
/** Where a slide shot can be cut in two (1…lines−1). */
function cutsOf(b, s) {
  if (!isSlide(s) || !b.source.headings.length) return [];
  const L = linesOf(b, s);
  const out = [];
  for (let k = 1; k < L.length; k++) if (asBullets(b, L.slice(0, k)) && asBullets(b, L.slice(k))) out.push(k);
  return out;
}
/** Two slide shots' bullets as one (x first in film order), or null: part of a slide joins only the rest of it. */
function joined(b, x, y) {
  if (x.part || y.part) {
    const rx = rangeOf(b, x);
    const ry = rangeOf(b, y);
    if (!rx || !ry || rx.h !== ry.h) return null;
    const lo = rx.to === ry.from ? rx : ry.to === rx.from ? ry : null;
    if (!lo) return null;
    const hi = lo === rx ? ry : rx;
    const n = lineCount(b, rx.h);
    return { bullets: [rx.h], part: lo.from === 0 && hi.to === n ? null : [lo.from, hi.to] };
  }
  return { bullets: [...x.bullets, ...y.bullets.filter((h) => !x.bullets.includes(h))], part: null };
}

function split(b, s, at) {
  if (!b.source.headings.length) throw new Error('This storyboard has no bullets to cut.');
  const L = linesOf(b, s);
  const A = at >= 1 && at < L.length ? asBullets(b, L.slice(0, at)) : null;
  const B = A ? asBullets(b, L.slice(at)) : null;
  if (!A || !B) throw new Error('That shot doesn\'t cut there.');
  const t = { id: newId(b), placement: 'slide', module: s.module };
  if (PAID.has(s.module)) t.make = s.make;
  if (styled(s.module)) { if (s.style) t.style = s.style; if (s.sound) t.sound = clone(s.sound); }
  if (Object.prototype.hasOwnProperty.call(s, 'voice')) t.voice = s.voice ? clone(s.voice) : null; // both halves keep its voice
  if (!A.bullets.includes(B.bullets[0])) t.title = headingTitle(b, B.bullets[0]);
  else if (s.title) t.title = s.title;
  const before = s.estSeconds;
  setBullets(b, s, A, before / 2);
  setBullets(b, t, B, before / 2);
  for (const x of b.shots) if (isBetween(x) && x.after === s.id) x.after = t.id;
  b.shots.splice(b.shots.indexOf(s) + 1, 0, t);
  return t;
}

function merge(b, a, c) {
  if (a === c) throw new Error('A shot doesn\'t merge with itself.');
  const sl = b.shots.filter(isSlide);
  const ia = sl.indexOf(a);
  const ic = sl.indexOf(c);
  if (Math.abs(ia - ic) !== 1) throw new Error('Those shots aren\'t side by side.');
  const [x, y] = ia < ic ? [a, c] : [c, a];
  const j = joined(b, x, y);
  if (!j) throw new Error('Part of a slide joins only the rest of that slide.');
  const secs = (a.estSeconds || 0) + (c.estSeconds || 0);
  setBullets(b, a, j, secs);
  // the scenes after either now follow the merged shot; it sits where the first of the two was
  for (const s of b.shots) if (isBetween(s) && (s.after === c.id || s.after === a.id)) s.after = a.id;
  if (ic < ia) { b.shots.splice(b.shots.indexOf(a), 1); b.shots.splice(b.shots.indexOf(c), 0, a); }
  drop(b, c);
  b.shots = filmOrder(b.shots);
}

/** A slide shot leaves the slides: its bullets go to the slide before it (else after it). → { into, moved, prev } */
function fold(b, s) {
  const sl = b.shots.filter(isSlide);
  if (sl.length < 2) throw new Error('A storyboard keeps at least one slide.');
  const i = sl.indexOf(s);
  const prev = sl[i - 1] || null;
  const next = sl[i + 1] || null;
  let into = null;
  let j = null;
  if (prev && (j = joined(b, prev, s))) into = prev;
  else if (next && (j = joined(b, s, next))) into = next;
  if (!into) throw new Error('No slide next to it can take its bullets.');
  const moved = b.shots.filter((x) => isBetween(x) && x.after === s.id).map((x) => x.id);
  for (const x of b.shots) if (isBetween(x) && x.after === s.id) x.after = prev ? prev.id : '';
  setBullets(b, into, j, (into.estSeconds || 0) + (s.estSeconds || 0));
  return { into, moved, prev };
}

function remove(b, s) {
  if (isBetween(s)) { drop(b, s); return null; }
  const { into } = fold(b, s);
  drop(b, s);
  b.shots = filmOrder(b.shots);
  return into;
}

/** The bullets of slide shot r without w's (a Solo's that left it), or null when they aren't all there. */
function without(b, r, w) {
  if (w.part || r.part) {
    const rr = rangeOf(b, r);
    if (!rr || !w.part || rr.h !== w.bullets[0] || w.bullets.length !== 1) return null;
    let from = null;
    let to = null;
    if (w.part[0] === rr.from && w.part[1] < rr.to) { from = w.part[1]; to = rr.to; } else if (w.part[1] === rr.to && w.part[0] > rr.from) { from = rr.from; to = w.part[0]; } else return null;
    const n = lineCount(b, rr.h);
    return { bullets: [rr.h], part: from === 0 && to === n ? null : [from, to] };
  }
  if (!w.bullets.every((h) => r.bullets.includes(h)) || r.bullets.length <= w.bullets.length) return null;
  return { bullets: r.bullets.filter((h) => !w.bullets.includes(h)), part: null };
}

/** A Motion Solo between narrated (a slide) and unnarrated (♪, a scene between slides). */
function setNarrated(b, s, narrated) {
  if (s.module !== 'motion-solo') throw new Error('Only a Motion Solo has a voice to turn off.');
  if (!narrated) {
    if (isBetween(s)) return [s.id];
    const { into, moved, prev } = fold(b, s);
    s.was = { bullets: s.bullets, ...(s.part ? { part: s.part } : {}), estSeconds: s.estSeconds, ...(s.secondsSet ? { secondsSet: true } : {}), from: into.id, betweens: moved };
    s.placement = 'between';
    s.after = prev ? prev.id : '';
    s.narrated = false;
    s.seconds = BETWEEN.seconds;
    delete s.bullets; delete s.part; delete s.estSeconds; delete s.secondsSet;
    b.shots = filmOrder(b.shots);
    return [s.id, into.id];
  }
  if (isSlide(s)) return [s.id];
  const w = s.was;
  const r = w ? b.shots.find((x) => isSlide(x) && x.id === w.from) : null;
  const rest = r ? without(b, r, w) : null;
  if (!rest) throw new Error('This scene has no bullets of its own to narrate.');
  setBullets(b, r, rest, r.estSeconds - w.estSeconds);
  s.placement = 'slide';
  s.bullets = w.bullets;
  if (w.part) s.part = w.part;
  s.estSeconds = w.estSeconds;
  if (w.secondsSet) s.secondsSet = true;
  for (const x of b.shots) if (isBetween(x) && w.betweens.includes(x.id)) x.after = s.id;
  delete s.after; delete s.seconds; delete s.narrated; delete s.was;
  b.shots = filmOrder(b.shots);
  return [s.id, r.id];
}

function move(b, s, o) {
  if (isBetween(s)) {
    const after = o.after === '' || o.after == null ? '' : o.after;
    if (after !== '' && !b.shots.some((x) => isSlide(x) && x.id === after)) throw new Error('No such slide.');
    s.after = after;
    b.shots = [...b.shots.filter((x) => x !== s), s];
    b.shots = filmOrder(b.shots);
    return;
  }
  const sl = b.shots.filter(isSlide);
  const to = Math.round(num(o.to, NaN));
  if (!Number.isFinite(to)) throw new Error('Move it where?');
  const at = clamp(to, 0, sl.length - 1);
  if (at === sl.indexOf(s)) return;
  const group = [s, ...b.shots.filter((x) => isBetween(x) && x.after === s.id)];
  b.shots = b.shots.filter((x) => !group.includes(x));
  const rest = b.shots.filter(isSlide);
  if (at >= rest.length) b.shots.push(...group);
  else b.shots.splice(b.shots.indexOf(rest[at]), 0, ...group);
  b.shots = filmOrder(b.shots);
}

const OPS = ['module', 'split', 'merge', 'move', 'add', 'remove', 'seconds', 'style', 'sound', 'ref', 'narrated', 'make', 'ask', 'lock', 'title', 'idea', 'mode', 'voice'];

/**
 * Run one edit on board b (mutated). Throws a short line when it can't be done. → the ids of the shots it touched.
 * ctx.caps: where a Generated scene can't be made (the plugin, the Desk, no caps), "generate" is refused and a Cosmos or
 * cut scene the edit makes (a new module, a new scene, a split's half) is drawn in code.
 */
function run(b, o, ctx = {}) {
  const shot = (id, want) => {
    const s = typeof id === 'string' ? b.shots.find((x) => x.id === id) : null;
    if (!s) throw new Error('No such shot.');
    if (want === 'slide' && !isSlide(s)) throw new Error(`${s.id} isn't a slide.`);
    return s;
  };
  const mayGenerate = canGenerate(ctx.caps);
  const inCode = (s) => { if (s.make === 'generate' && !mayGenerate) s.make = 'code'; return s; };
  switch (o.op) {
    case 'module': {
      const s = shot(o.id);
      const m = typeof o.module === 'string' ? o.module : '';
      if (!(isSlide(s) ? SLIDE_MODULES : BETWEEN_MODULES).includes(m)) throw new Error(`${modules.meta(m) ? nameOf(m) : 'That'} can't be ${isSlide(s) ? 'a slide' : 'a scene between slides'}.`);
      if (o.make != null && !PAID.has(m)) throw new Error('"make" is for a Cosmos or cut scene.');
      if (o.make === 'generate' && !mayGenerate) throw new Error('Generated scenes aren\'t made here.');
      setModule(b, s, m, o.make);
      inCode(s);
      return [s.id];
    }
    case 'split': { const s = shot(o.id, 'slide'); const t = inCode(split(b, s, Math.round(num(o.atBullet, 0)))); return [s.id, t.id]; }
    case 'merge': { const a = shot(o.id, 'slide'); const c = shot(o.with, 'slide'); merge(b, a, c); return [a.id]; }
    case 'move': { const s = shot(o.id); move(b, s, o); return [s.id]; }
    case 'add': {
      const after = o.after === '' || o.after == null ? '' : shot(o.after, 'slide').id;
      const kind = o.kind === 'solo' || o.kind === 'cutscene' ? o.kind : null;
      if (!kind) throw new Error('A scene between slides is a Solo ♪ or a cut scene.');
      if (o.make === 'generate' && !mayGenerate) throw new Error('Generated scenes aren\'t made here.');
      const t = inCode(addBetween(b, after, kind, o));
      return [t.id];
    }
    case 'remove': { const s = shot(o.id); const into = remove(b, s); return into ? [into.id] : []; }
    case 'seconds': {
      const s = shot(o.id);
      const v = num(o.seconds, NaN);
      if (!Number.isFinite(v)) throw new Error('Seconds are a number.');
      if (isBetween(s)) s.seconds = Math.round(clamp(v, BETWEEN.min, BETWEEN.max));
      else { s.estSeconds = Math.round(clamp(v, LIMITS.slideSeconds[0], LIMITS.slideSeconds[1])); s.secondsSet = true; }
      return [s.id];
    }
    case 'style': {
      const v = o.style == null || o.style === '' ? null : o.style;
      if (v != null && (typeof v !== 'string' || !STYLE_ID.test(v))) throw new Error('That isn\'t a style id.');
      if (o.id == null || o.id === '') { b.defaults.style = v; return []; }
      const s = shot(o.id);
      if (!styled(s.module)) throw new Error(`${nameOf(s.module)} has no style of its own.`);
      if (v) s.style = v; else delete s.style;
      return [s.id];
    }
    case 'sound': {
      const s = shot(o.id);
      if (!styled(s.module)) throw new Error(`${nameOf(s.module)} has no sound of its own.`);
      if (o.music != null && !musicOk(o.music)) throw new Error('That isn\'t a sound FLPT knows.');
      if (o.sfx != null && !SFX.includes(o.sfx)) throw new Error('Sound effects are off, soft or on.');
      const next = { ...(s.sound || {}) };
      if (o.music != null) next.music = o.music;
      if (o.sfx != null) next.sfx = o.sfx;
      if (o.music === null && o.sfx === null) delete s.sound; else s.sound = next;
      return [s.id];
    }
    case 'ref': {
      const s = shot(o.id);
      let refs = s.refs ? [...s.refs] : [];
      if (Array.isArray(o.refs)) refs = o.refs;
      if (o.add != null) refs = [...refs, o.add];
      if (o.remove != null) refs = refs.filter((r) => r !== o.remove);
      if (refs.some((r) => typeof r !== 'string' || !REF.test(r))) throw new Error('That isn\'t a reference id.');
      refs = [...new Set(refs)];
      if (refs.length > LIMITS.refs) throw new Error(`At most ${LIMITS.refs} references a shot.`);
      if (refs.length) s.refs = refs; else delete s.refs;
      return [s.id];
    }
    case 'narrated': return setNarrated(b, shot(o.id), o.narrated !== false);
    case 'make': {
      const s = shot(o.id);
      if (!PAID.has(s.module)) throw new Error('"make" is for a Cosmos or cut scene.');
      if (o.make !== 'code' && o.make !== 'generate') throw new Error('Drawn in code or generated.');
      if (o.make === 'generate' && !mayGenerate) throw new Error('Generated scenes aren\'t made here.');
      s.make = o.make;
      if (o.make === 'generate') { delete s.style; delete s.sound; }
      return [s.id];
    }
    case 'ask':
    case 'title':
    case 'idea': {
      const s = shot(o.id);
      const raw = o[o.op];
      if (raw != null && typeof raw !== 'string') throw new Error('That isn\'t text.');
      const v = o.op === 'title' ? mdText(raw, LIMITS.title) : text(raw, LIMITS[o.op]);
      if (v) s[o.op] = v; else delete s[o.op];
      return [s.id];
    }
    case 'lock': { const s = shot(o.id); if (o.locked === false || (o.locked == null && s.locked)) delete s.locked; else s.locked = true; return []; }
    case 'mode': {
      if (o.mode !== 'jazz' && o.mode !== 'directed' && o.mode !== null) throw new Error('Jazz or directed.');
      b.mode = o.mode;
      return [];
    }
    case 'voice': {
      // who narrates a slide with no presenter on screen: { voice: null } the presenter, { voice: { provider, id } } a
      // guest, { reset: true } the plan's own (in Jazz, a Cosmos's storyteller). It locks nothing: it isn't the plan.
      const s = shot(o.id);
      if (!guest.canTake(s)) throw new Error('Only a slide with no presenter on screen takes a guest voice.');
      if (o.reset === true) { delete s.voice; return []; }
      if (o.voice === null) { s.voice = null; return []; }
      const v = guest.cleanVoice(o.voice);
      if (!v) throw new Error('That isn\'t a voice FLPT knows.');
      s.voice = v;
      return [];
    }
    default: throw new Error('Unknown storyboard edit.');
  }
}

/**
 * One directed edit (the user's), validated: module, split {atBullet}, merge {with}, move {to | after}, add {after,
 * kind: 'solo'|'cutscene'}, remove, seconds, style, sound {music, sfx}, ref {refs | add | remove}, narrated, make, ask,
 * lock, title, idea, mode, voice {voice | reset}. The shots it touches are locked (a later polish or re-plan never
 * changes them; a voice, a lock or a mode touches none). opts.caps
 * says the surface: where Generated scenes can't be made (the plugin, the Desk, or no caps given) they're refused.
 * Returns the new board; throws a short line when it can't be done.
 */
function op(board, o, opts = {}) {
  if (!isObj(o) || !OPS.includes(o.op)) throw new Error('Unknown storyboard edit.');
  const b = normalise(board);
  const touched = run(b, o, { caps: opts.caps });
  for (const id of touched) { const s = b.shots.find((x) => x.id === id); if (s) s.locked = true; }
  return normalise(b);
}

// The storyboard crew's edits (save_storyboard) and the directed op each one is.
const EDITS = {
  setModule: (e) => ({ op: 'module', id: e.shot, module: e.module }),
  split: (e) => ({ op: 'split', id: e.shot, atBullet: e.atBullet }),
  merge: (e) => ({ op: 'merge', id: e.shot, with: e.with }),
  insertBetween: (e) => ({ op: 'add', after: e.after == null ? '' : e.after, kind: e.kind, seconds: e.seconds, title: e.title, idea: e.idea }),
  setStyle: (e) => ({ op: 'style', id: e.shot == null ? '' : e.shot, style: e.style }),
  setSound: (e) => ({ op: 'sound', id: e.shot, music: e.music, sfx: e.sfx }),
  setIdea: (e) => ({ op: 'idea', id: e.shot, idea: e.idea }),
  setTitle: (e) => ({ op: 'title', id: e.shot, title: e.title }),
};

/**
 * The storyboard crew's edits: each valid one applied in order (never to a locked shot, nor moving a locked scene off
 * the slide it follows), each invalid one dropped with a reason; then the solver. opts.caps says the surface: one that
 * can't make a Generated scene (the plugin, the Desk, no caps) plans every Cosmos and cut scene in code.
 * → { board, applied, dropped: [{ n, op, why }], notes }
 */
function apply(board, edits, opts = {}) {
  const b = normalise(board);
  b.policy = surfacePolicy(b.policy, opts.caps);
  const dropped = [];
  const notes = [];
  let applied = 0;
  const list = Array.isArray(edits) ? edits : [];
  if (list.length > LIMITS.edits) dropped.push({ n: LIMITS.edits + 1, op: '', why: `only the first ${LIMITS.edits} edits are read` });
  list.slice(0, LIMITS.edits).forEach((e, k) => {
    const why = (w) => dropped.push({ n: k + 1, op: isObj(e) ? String(e.op || '').slice(0, 20) : '', why: w });
    if (!isObj(e) || typeof e.op !== 'string' || !Object.prototype.hasOwnProperty.call(EDITS, e.op)) return why('not an edit this tool knows');
    const touches = [e.shot, e.with].filter((x) => typeof x === 'string' && x);
    const locked = touches.map((id) => b.shots.find((s) => s.id === id)).find((s) => s && s.locked);
    if (locked) return why(`${locked.id} is locked (the user's)`);
    // a merge folds e.with into e.shot, a split hands e.shot's scene to its second half: either re-points that scene
    const from = e.op === 'merge' ? e.with : e.op === 'split' ? e.shot : null;
    const scene = from ? b.shots.find((s) => isBetween(s) && s.locked && s.after === from) : null;
    if (scene) return why(`${scene.id} is locked (the user's) and follows ${from}`);
    const snap = JSON.stringify(b);
    try {
      run(b, EDITS[e.op](e), { caps: opts.caps });
      b.shots = filmOrder(b.shots);
      applied += 1;
    } catch (err) {
      Object.assign(b, JSON.parse(snap));
      why(String(err && err.message ? err.message : err).slice(0, 160));
    }
    return undefined;
  });
  const out = balance(b, opts.policy ? surfacePolicy(cleanPolicy(opts.policy, b.policy.minutes), opts.caps) : null, { notes });
  out.source.polishedAt = (opts.now ? opts.now() : new Date()).toISOString();
  if (opts.plannerUsd != null) out.source.plannerUsd = +clamp(num(opts.plannerUsd, 0), 0, 1000).toFixed(4);
  return { board: out, applied, dropped, notes };
}

// ── merge on re-plan: the bullets changed ───────────────────────────────────────────────────────────────────────

const titleKey = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const tokens = (t) => new Set(titleKey(t).split(' ').filter((w) => w.length > 2));
function jaccard(a, c) {
  if (!a.size || !c.size) return 0;
  let n = 0;
  for (const w of a) if (c.has(w)) n += 1;
  return n / (a.size + c.size - n);
}

/** Old bullets slide (1-based) → new one (0: gone): the same title, most of its title's words, or the same place. */
function mapHeadings(oldH, newH) {
  const map = new Array(oldH.length + 1).fill(0);
  const used = new Set();
  const near = (i, cands) => cands.sort((x, y) => Math.abs(x - 1 - i) - Math.abs(y - 1 - i) || x - y)[0] || 0;
  oldH.forEach((o, i) => {
    const k = titleKey(o.title);
    if (!k) return;
    const j = near(i, newH.map((n, x) => x + 1).filter((x) => !used.has(x) && titleKey(newH[x - 1].title) === k));
    if (j) { map[i + 1] = j; used.add(j); }
  });
  oldH.forEach((o, i) => {
    if (map[i + 1]) return;
    const a = tokens(o.title);
    let bestJ = 0;
    let bestS = 0.5;
    newH.forEach((n, x) => {
      if (used.has(x + 1)) return;
      const s = jaccard(a, tokens(n.title));
      if (s > bestS + 1e-9 || (Math.abs(s - bestS) < 1e-9 && bestJ && Math.abs(x - i) < Math.abs(bestJ - 1 - i))) { bestS = s; bestJ = x + 1; }
      else if (!bestJ && s >= 0.5) { bestS = s; bestJ = x + 1; }
    });
    if (bestJ) { map[i + 1] = bestJ; used.add(bestJ); }
  });
  // a slide renamed in place: between the same two neighbours, with as many lines
  oldH.forEach((o, i) => {
    if (map[i + 1]) return;
    let p = i - 1;
    while (p >= 0 && !map[p + 1]) p -= 1;
    const j = (p >= 0 ? map[p + 1] : 0) + (i - p);
    if (j >= 1 && j <= newH.length && !used.has(j) && newH[j - 1].words.length === o.words.length) {
      let q = i + 1;
      while (q < oldH.length && !map[q + 1]) q += 1;
      if (q >= oldH.length || map[q + 1] > j) { map[i + 1] = j; used.add(j); }
    }
  });
  return map;
}

/**
 * After bullets.md changes: the new bullets, merged into the old board by shot and bullets (locked shots claim theirs
 * first, every shot keeps its id and choices, a split survives while its slide keeps its lines, a length the user set
 * stays), new slides become new shots where they fall, then the solver (locked shots untouched). opts.caps as in
 * apply(). → { board, diff, notes }; board.source.diff holds the diff for the review.
 */
function replan(board, bulletsMd, opts = {}) {
  const old = normalise(board);
  const fresh = parse(bulletsMd, { minutes: old.policy.minutes, policy: old.policy, caps: opts.caps, now: opts.now });
  const oldH = old.source.headings;
  const newH = fresh.source.headings;
  const map = mapHeadings(oldH, newH);
  const b = clone(old);
  b.policy = surfacePolicy(b.policy, opts.caps);
  b.source = { ...fresh.source, polishedAt: old.source.polishedAt, plannerUsd: old.source.plannerUsd };
  const notes = [];
  const whole = new Set();
  const parted = new Set();
  const gone = new Set();
  const claimOrder = [...b.shots.filter((s) => isSlide(s) && s.locked), ...b.shots.filter((s) => isSlide(s) && !s.locked)];
  for (const s of claimOrder) {
    const was = s.bullets;
    const oldTitle = headingTitle(old, was[0]);
    const hs = was.map((h) => map[h]).filter(Boolean);
    let next = null;
    if (s.part) {
      const h = hs[0];
      const sameLines = h && oldH[was[0] - 1] && oldH[was[0] - 1].words.length === newH[h - 1].words.length;
      if (h && sameLines && !whole.has(h)) { next = { bullets: [h], part: s.part }; parted.add(h); }
      else if (h && !whole.has(h) && !parted.has(h)) { next = { bullets: [h], part: null }; whole.add(h); }
    } else {
      const own = hs.filter((h) => !whole.has(h) && !parted.has(h));
      if (own.length) { next = { bullets: own, part: null }; own.forEach((h) => whole.add(h)); }
    }
    if (!next) { gone.add(s.id); if (s.locked) notes.push(`${s.id} (locked): its bullets are gone.`); continue; }
    s.bullets = next.bullets;
    if (next.part) s.part = next.part; else delete s.part;
    if (!s.secondsSet) s.estSeconds = estFor(b, s.bullets, s.part) || s.estSeconds;
    if (!s.locked && (!s.title || titleKey(s.title) === titleKey(oldTitle)) && newH[s.bullets[0] - 1]) s.title = newH[s.bullets[0] - 1].title;
  }
  b.shots = b.shots.filter((s) => !gone.has(s.id));
  // new slides of the bullets become new shots, after the shot that holds the slide before them
  for (let h = 1; h <= newH.length; h++) {
    if (whole.has(h) || parted.has(h)) continue;
    const f = fresh.shots.find((s) => isSlide(s) && s.bullets[0] === h);
    const t = { id: newId(b), bullets: [h], placement: 'slide', module: f ? f.module : 'motion', title: newH[h - 1].title, estSeconds: estFor(b, [h], null) || 1 };
    const holder = [...b.shots].reverse().find((s) => isSlide(s) && s.bullets.some((x) => x < h));
    if (!holder) {
      const first = b.shots.findIndex(isSlide);
      b.shots.splice(first < 0 ? b.shots.length : first, 0, t);
    } else {
      let at = b.shots.indexOf(holder) + 1;
      while (at < b.shots.length && isBetween(b.shots[at])) at += 1;
      b.shots.splice(at, 0, t);
    }
    whole.add(h);
    const fb = fresh.shots.find((s) => isBetween(s) && f && s.after === f.id);
    if (fb) b.shots.splice(b.shots.indexOf(t) + 1, 0, { ...fb, id: newId(b), after: t.id });
  }
  b.shots = filmOrder(b.shots);
  const out = balance(b, opts.policy ? surfacePolicy(cleanPolicy(opts.policy, b.policy.minutes), opts.caps) : null, { notes });
  const d = diff(old, out);
  out.source.diff = d;
  return { board: normalise(out), diff: d, notes };
}

/** Is the board older than these bullets? */
function isStale(board, bulletsMd) {
  const b = normalise(board);
  return !b.source.bulletsSha || b.source.bulletsSha !== sha256(String(bulletsMd == null ? '' : bulletsMd));
}

const DIFF_FIELDS = ['placement', 'after', 'module', 'make', 'narrated', 'bullets', 'part', 'title', 'idea', 'seconds', 'style', 'sound', 'refs', 'ask', 'voice'];
/** What changed between two boards, by shot id: { added, removed: [{ id, title, module }], changed: [{ id, fields }] }. */
function diff(a, z) {
  const A = normalise(a).shots;
  const Z = normalise(z).shots;
  const byA = new Map(A.map((s) => [s.id, s]));
  const byZ = new Map(Z.map((s) => [s.id, s]));
  const common = A.filter((s) => byZ.has(s.id)).map((s) => s.id);
  const commonZ = Z.filter((s) => byA.has(s.id)).map((s) => s.id);
  const prevIn = (list, id) => list[list.indexOf(id) - 1] || null;
  const changed = [];
  for (const s of Z) {
    const o = byA.get(s.id);
    if (!o) continue;
    const fields = DIFF_FIELDS.filter((f) => JSON.stringify(o[f]) !== JSON.stringify(s[f]));
    if (isSlide(s) && isSlide(o) && Math.abs((s.estSeconds || 0) - (o.estSeconds || 0)) >= 5) fields.push('estSeconds');
    if (prevIn(common, s.id) !== prevIn(commonZ, s.id)) fields.push('order');
    if (fields.length) changed.push({ id: s.id, fields });
  }
  return {
    added: Z.filter((s) => !byA.has(s.id)).map((s) => s.id),
    removed: A.filter((s) => !byZ.has(s.id)).map((s) => ({ id: s.id, title: s.title || '', module: s.module })),
    changed,
  };
}

/** The board approved (Jazz or Directed): the mode, the time, and the re-plan's diff reviewed. */
function approve(board, { mode = null, now = null } = {}) {
  const b = normalise(board);
  if (mode === 'jazz' || mode === 'directed') b.mode = mode;
  b.approvedAt = (now ? now() : new Date()).toISOString();
  delete b.source.diff;
  return b;
}

// ── price: what the plan costs and takes, from the rates (never from the file) ─────────────────────────────────

function stageUsd(id, d) {
  const s = episode.STAGES.find((x) => x.id === id);
  return s && Number.isFinite(s.budgetUsd) ? s.budgetUsd : d;
}

/** The seconds of a generated cut scene as Scenes makes it: 1–4 shots of 4–8 s or so. */
function cutShots(seconds) {
  const n = clamp(Math.min(Math.ceil(seconds / 5), Math.floor(seconds / 4)), 1, 4);
  return Array.from({ length: n }, () => seconds / n);
}

const pieceLabel = (s) => (isInterstitial(s) ? 'Solo ♪' : PAID.has(s.module) ? `${tileOf(s.module)} in code` : tileOf(s.module));

/**
 * What the plan costs and takes, recomputed from the broker's rates, the module meta and the crew caps:
 *   seconds (running time), slideSeconds, betweenSeconds, modules (the nine used), live { seconds, share, target,
 *   count, max }, claude { capUsd, base: [{ label, usd }], pieces: [{ shot, label, usd }] }, heygen { usd,
 *   avatarSeconds, voiceSeconds }, scenes { usd, lines: [{ shot, label, usd }] } (Generated only), crew { minutes,
 *   pieces }. opts.routes: { stills, video } for generated scenes ('kie' by default).
 */
function price(dir, board, opts = {}) {
  const b = board ? normalise(board) : read(dir);
  if (!b) return null;
  const slides = b.shots.filter(isSlide);
  const betweens = b.shots.filter(isBetween);
  const slideSeconds = sum(slides.map((s) => s.estSeconds));
  const betweenSeconds = sum(betweens.map((s) => s.seconds));
  const seconds = slideSeconds + betweenSeconds;
  const used = new Set(b.shots.map((s) => s.module).filter((m) => m !== 'statement'));
  const live = liveSeconds(b);
  const base = BASE_STAGES.map(([id, label, d]) => ({ label, usd: stageUsd(id, d) }));
  const mark = stageUsd('animate', CREW_USD.mark);
  const pieces = [];
  for (const s of b.shots) {
    if (drawnInCode(s)) pieces.push({ shot: s.id, label: `${pieceLabel(s)} · ${s.id}`, usd: isSlide(s) ? CREW_USD.live : CREW_USD.between });
    else if (isSlide(s) && s.module === 'sketch') pieces.push({ shot: s.id, label: `${tileOf('sketch')} · ${s.id}`, usd: mark });
  }
  const capUsd = +sum([...base, ...pieces].map((x) => x.usd)).toFixed(2);
  const avatarSeconds = sum(slides.filter((s) => modules.META[s.module].bubble === true).map((s) => s.estSeconds));
  const voiceSeconds = sum(slides.filter((s) => modules.META[s.module].bubble === false).map((s) => s.estSeconds));
  const hey = broker.estimate([{ rate: 'heygen_avatar_s', qty: avatarSeconds, label: 'Avatar' }, { rate: 'heygen_tts_s', qty: voiceSeconds, label: 'Voice only, no avatar' }]);
  const routes = { stills: 'kie', video: 'kie', ...(isObj(opts.routes) ? opts.routes : {}) };
  const lines = [];
  for (const s of b.shots) {
    if (!PAID.has(s.module) || s.make !== 'generate') continue;
    const est = s.module === 'cosmos' ? scenes.recipe('cartoon', routes) : scenes.recipe('cutscene', { ...routes, shots: cutShots(s.seconds || BETWEEN.seconds) });
    lines.push({ shot: s.id, label: `${tileOf(s.module)} · ${s.id}`, usd: est.totalUsd });
  }
  const crewPieces = pieces.length;
  return {
    seconds, slideSeconds, betweenSeconds,
    modules: modules.IDS.filter((m) => used.has(m)),
    live: { seconds: live, share: seconds > 0 ? live / seconds : 0, target: b.policy.liveShare, count: b.shots.filter(isLiveShot).length, max: b.policy.maxLive },
    claude: { capUsd, base, pieces },
    heygen: { usd: hey.totalUsd, avatarSeconds, voiceSeconds },
    scenes: { usd: +sum(lines.map((l) => l.usd)).toFixed(2), lines },
    crew: { minutes: CREW_MINUTES.pipeline + Math.ceil(crewPieces / CREW_MINUTES.parallel) * CREW_MINUTES.piece, pieces: crewPieces },
  };
}

// ── view: what the board shows ──────────────────────────────────────────────────────────────────────────────────

const fmtTime = (sec) => { const s = Math.max(0, Math.round(sec)); return `${Math.floor(s / 60)}:${pad2(s % 60)}`; };
const fmtUsd = (x) => (Math.abs(x - Math.round(x)) < 0.005 ? `$${Math.round(x)}` : `$${x.toFixed(2)}`);
const fmtWall = (min) => { const h = Math.floor(min / 60); const m = Math.round(min % 60); return h ? `≈ ${h} H ${m} M` : `≈ ${m} M`; };
const pct = (x) => Math.round(x * 100);

/**
 * The sound a Live Motion piece plays with (PLAN §2.6, score.soundFor): its shot's own, else its style's (when the
 * caller has the style: { sound: { score, sfx } }), else the module's default. own: the shot chose it.
 */
function soundOf(s, style = null) {
  if (!drawnInCode(s)) return null;
  const kind = isInterstitial(s) ? 'interstitial' : s.module;
  let snd;
  try { snd = score.soundFor({ kind, shot: s, style }); } catch {
    // no score engine to check against (a bare checkout): the module's defaults, as soundFor would give them
    const d = score.DEFAULTS[score.kindOf(kind)];
    const own = s.sound || {};
    snd = { music: own.music || (d.music === 'score' ? `score:${score.DEFAULT_PRESET}` : d.music), sfx: own.sfx || d.sfx };
  }
  return { music: snd.music, sfx: snd.sfx, own: Boolean(s.sound) };
}

/** The compact totals line and its tooltip lines, from price(). */
function totals(p, pol, caps) {
  const chat = isObj(caps) && (caps.surface === 'plugin' || caps.crew === 'chat');
  const line = `${fmtTime(p.seconds)} · $${Math.ceil(p.claude.capUsd - 1e-9)} · LIVE MOTION ${pct(p.live.share)} %`;
  const tooltip = [
    `${p.modules.length} MODULES`,
    `${chat ? 'CLAUDE ≈' : 'CLAUDE UP TO'} ${fmtUsd(p.claude.capUsd)}`,
    `HEYGEN ≈ ${fmtUsd(p.heygen.usd)}`,
    ...(p.scenes.usd > 0 ? [`SCENES ${fmtUsd(p.scenes.usd)}`] : []),
    `CREW ${fmtWall(p.crew.minutes)}`,
  ];
  const status = [];
  if (pol.originals === 'all') {
    const miss = ORIGINALS.filter((m) => !p.modules.includes(m));
    if (miss.length) status.push(`MISSING · ${miss.map((m) => tileOf(m).toUpperCase()).join(' · ')}`);
  }
  if (p.live.share < pol.liveShare - 0.005) status.push(`LIVE MOTION ${pct(p.live.share)} % · TARGET ${pct(pol.liveShare)} %`);
  return { line, tooltip, status };
}

/**
 * What the board shows: { board, shots, line, tooltip, status, script, price, diff, undo, redo, stale, voices (the FLPT
 * voices a guest may be) }. Each shot: { id, n (slides only), placement, after, module, tile, name, family, live, title,
 * idea, seconds, make, usd (a Generated piece's price), style, sound (resolved, Live Motion pieces), voice (only on a
 * slide with no presenter on screen: null, the presenter's, or { provider, id, name, default? }), refs, ask, locked,
 * needsClip, narrated, bullets, part, cuts (where it can be cut in two), hover }. opts: { board, caps, routes, styleOf }
 * (styleOf(id) → the style, so a shot's sound is its style's when it names none; caps.house: the FLPT voices can speak
 * in this film, so a Jazz Cosmos shows its storyteller, else the presenter).
 */
function view(dir, opts = {}) {
  const b = opts.board ? normalise(opts.board) : read(dir);
  if (!b) return null;
  const p = price(dir, b, opts);
  const scenePrice = new Map(p.scenes.lines.map((l) => [l.shot, l.usd]));
  const house = Boolean(opts.caps && opts.caps.house); // the FLPT voices can speak here (a Jazz Cosmos's storyteller)
  const styleOf = (s) => {
    const id = s.style || b.defaults.style;
    if (!id || typeof opts.styleOf !== 'function') return null;
    try { const st = opts.styleOf(id); return isObj(st) ? st : null; } catch { return null; }
  };
  let n = 0;
  const shots = b.shots.map((s) => {
    const slide = isSlide(s);
    if (slide) n += 1;
    const tile = isInterstitial(s) ? `${tileOf('motion-solo')} ♪` : tileOf(s.module);
    const secs = slide ? s.estSeconds : s.seconds;
    const title = s.title || (slide ? headingTitle(b, s.bullets[0]) : '');
    return {
      id: s.id, n: slide ? n : null, placement: s.placement, after: slide ? null : s.after, module: s.module, tile, name: nameOf(s.module),
      family: modules.META[s.module].family, live: drawnInCode(s), title, idea: s.idea || '', seconds: secs, make: s.make || null,
      usd: scenePrice.has(s.id) ? scenePrice.get(s.id) : null, style: (styled(s.module) && s.style) || null,
      sound: soundOf(s, styleOf(s)), ...(guest.canTake(s) ? { voice: guest.voiceOf(b, s, { house }) } : {}), refs: s.refs || [], ask: s.ask || '', locked: Boolean(s.locked),
      needsClip: Boolean(modules.META[s.module].needsClip), narrated: s.module === 'motion-solo' ? slide : null,
      bullets: slide ? s.bullets : [], part: s.part || null, cuts: cutsOf(b, s),
      hover: [slide ? pad2(n) : null, tile, s.style || null, fmtTime(secs)].filter(Boolean).join(' · '),
    };
  });
  const t = totals(p, b.policy, opts.caps);
  let script = null;
  if (dir) {
    try {
      const slides = episode.parseScript(fs.readFileSync(path.join(dir, 'presentation', 'script.md'), 'utf8'));
      if (slides.length) script = `PLAN ${fmtTime(p.slideSeconds)} · SCRIPT ${fmtTime(episode.estimateSeconds(slides))}`;
    } catch { /* no script yet */ }
  }
  let stale = false;
  if (dir) { try { stale = isStale(b, fs.readFileSync(path.join(dir, 'presentation', 'bullets.md'), 'utf8')); } catch { /* no bullets */ } }
  const u = dir ? undoState(dir) : { undo: 0, redo: 0 };
  return { board: b, mode: b.mode, approvedAt: b.approvedAt, shots, line: t.line, tooltip: t.tooltip, status: t.status, script,
    price: p, diff: b.source.diff || null, undo: u.undo, redo: u.redo, stale, voices: guest.HOUSE.map((v) => ({ provider: v.provider, id: v.id, name: v.name })) };
}

// ── the deck: the brief the deck crew builds from, and the check that it did ───────────────────────────────────

function bulletsText(s) {
  const hs = s.bullets;
  let t;
  if (hs.length > 1 && hs.every((h, i) => i === 0 || h === hs[i - 1] + 1)) t = `${hs[0]}–${hs[hs.length - 1]}`;
  else t = hs.join(', ');
  return s.part ? `${t} (lines ${s.part[0] + 1}–${s.part[1]})` : t;
}
function moduleLabel(s) {
  if (isInterstitial(s)) return `Motion Solo ♪, unnarrated (one \`jsscenes[]\` entry, \`"shot": "${s.id}"\`)`;
  if (isBetween(s)) return `Cut scene (one \`cutscenes[]\` entry, \`"shot": "${s.id}"\`, \`"make": "${s.make}"\`)`;
  const make = PAID.has(s.module) ? `, \`"make": "${s.make}"\`${s.make === 'code' ? ': drawn in code' : ': generated'}` : '';
  return `${nameOf(s.module)} (\`${s.module}\`${make})`;
}
function extrasOf(b, s, house = false) {
  const out = [];
  if (styled(s.module) && drawnInCode(s)) {
    out.push(`style ${s.style || b.defaults.style || 'the episode\'s'}`);
    // only a sound the shot chose: otherwise its style's or the module's (score.soundFor at render)
    if (s.sound && s.sound.music) out.push(`sound ${s.sound.music}`);
    if (s.sound && s.sound.sfx) out.push(`effects ${s.sound.sfx}`);
  }
  const voice = guest.voiceOf(b, s, { house });
  if (voice) out.push(`narrated by ${voice.name}, a guest voice`);
  if (s.refs && s.refs.length) out.push(`references ${s.refs.join(', ')}`);
  if (modules.META[s.module].needsClip) out.push('the user\'s clip');
  if (s.ask) out.push(`the user asks: "${s.ask.replace(/"/g, '\'')}"`);
  return out.length ? ` · ${out.join(' · ')}` : '';
}

/**
 * The approved plan for the deck crew ({{storyboard}} in deck.md): every shot in film order, its id, its bullets, its
 * module, its seconds, title and idea, and for Live Motion pieces their style and any sound the shot chose (else the
 * style's or the module's, at render).
 */
function toDeckBrief(board, { house = false } = {}) {
  const b = normalise(board);
  const lines = [];
  let n = 0;
  for (const s of b.shots) {
    const head = s.title ? ` · "${s.title}"${s.idea ? `: ${s.idea}` : ''}` : s.idea ? ` · ${s.idea}` : '';
    if (isSlide(s)) {
      n += 1;
      lines.push(`${n}. \`${s.id}\` · slide ${n} · bullets ${bulletsText(s)} · ${moduleLabel(s)} · ≈ ${s.estSeconds} s${head}${extrasOf(b, s, house)}`);
    } else {
      const where = s.after ? `after \`${s.after}\`` : 'before the first slide (a cold open)';
      lines.push(`   - \`${s.id}\` · between slides, ${where} · ${moduleLabel(s)} · ${s.seconds} s${head}${extrasOf(b, s, house)}`);
    }
  }
  return lines.join('\n');
}

/** What's wrong with a deck against the storyboard (pure; checkDeck reads the files). Lines for the deck crew. */
function deckProblems(board, order, map) {
  const b = normalise(board);
  const out = [];
  const slides = isObj(map && map.slides) ? map.slides : {};
  const shots = new Map(b.shots.map((s) => [s.id, s]));
  const slideShots = b.shots.filter(isSlide);
  const label = (s) => `${s.id}${s.title ? ` ("${s.title}")` : ''}`;
  const carriers = new Map();
  for (const id of order) {
    const e = isObj(slides[id]) ? slides[id] : null;
    const sh = e && typeof e.shot === 'string' ? e.shot : null;
    if (!sh) { out.push(`Slide "${id}" has no "shot" in modules.json.`); continue; }
    const s = shots.get(sh);
    if (!s) { out.push(`Slide "${id}" names shot ${sh}, which isn't in the storyboard.`); continue; }
    if (isBetween(s)) { out.push(`Slide "${id}" names ${sh}, a scene between slides: it goes in ${s.module === 'cutscene' ? '"cutscenes"' : '"jsscenes"'}, not on a slide.`); continue; }
    (carriers.get(sh) || carriers.set(sh, []).get(sh)).push(id);
  }
  for (const s of slideShots) {
    const c = carriers.get(s.id) || [];
    if (!c.length) out.push(`Shot ${label(s)} has no slide.`);
    else if (c.length > 1) out.push(`Shot ${s.id} is on ${c.length} slides (${c.join(', ')}): one slide per shot.`);
  }
  const seq = [];
  for (const id of order) { const sh = isObj(slides[id]) ? slides[id].shot : null; if (carriers.has(sh) && !seq.includes(sh)) seq.push(sh); }
  const planned = slideShots.map((s) => s.id).filter((id) => seq.includes(id));
  const k = seq.findIndex((id, i) => id !== planned[i]);
  if (k >= 0) out.push(`The slides are out of the storyboard's order: slide ${k + 1} carries ${seq[k]}, where the storyboard has ${planned[k]}.`);
  for (const id of order) {
    const e = isObj(slides[id]) ? slides[id] : null;
    const s = e && shots.get(e.shot);
    if (!s || !isSlide(s)) continue;
    const reason = typeof e.reason === 'string' && e.reason.trim();
    if (e.module !== s.module && !reason) out.push(`Slide "${id}" (${s.id}) is "${e.module}"; the storyboard says "${s.module}". Build it as planned, or say why in "reason" on its entry.`);
    if ((s.module === 'motion-solo' || e.module === 'motion-solo') && (e.animate || e.inset)) out.push(`Slide "${id}" (${s.id}) is a Motion Solo: no "animate" or "inset" on it.`);
    // how a Cosmos is made is the plan's: one the storyboard doesn't have is drawn in code (a paid piece is approved)
    if (PAID.has(e.module) && e.module === s.module && modules.makeOf(e) !== s.make) out.push(`Slide "${id}" (${s.id}): "make" is "${s.make}" in the storyboard.`);
    else if (PAID.has(e.module) && e.module !== s.module && modules.makeOf(e) !== 'code') out.push(`Slide "${id}" (${s.id}) is a ${tileOf(e.module)} the storyboard doesn't have: "make" is "code".`);
  }
  const js = Array.isArray(map && map.jsscenes) ? map.jsscenes.filter(isObj) : [];
  const cs = Array.isArray(map && map.cutscenes) ? map.cutscenes.filter(isObj) : [];
  const byShot = (arr) => { const m = new Map(); for (const e of arr) if (typeof e.shot === 'string') (m.get(e.shot) || m.set(e.shot, []).get(e.shot)).push(e); return m; };
  const J = byShot(js);
  const C = byShot(cs);
  for (const s of b.shots.filter(isBetween)) {
    const cut = s.module === 'cutscene';
    const own = (cut ? C : J).get(s.id) || [];
    const wrong = (cut ? J : C).get(s.id) || [];
    const key = cut ? '"cutscenes"' : '"jsscenes"';
    if (wrong.length) out.push(`Shot ${s.id} is a ${cut ? 'cut scene' : 'Solo ♪'}: its entry goes in ${key}.`);
    if (!own.length) { if (!wrong.length) out.push(`Shot ${label(s)} has no ${key} entry.`); continue; }
    if (own.length > 1) out.push(`Shot ${s.id} has ${own.length} ${key} entries: one per shot.`);
    const e = own[0];
    const want = s.after === '' ? '' : (carriers.get(s.after) || [])[0];
    const got = typeof e.after === 'string' ? e.after : '';
    if (want !== undefined && got !== want) out.push(`The ${key} entry for ${s.id} follows "${got || 'nothing (a cold open)'}"; the storyboard puts it after ${want ? `"${want}"` : 'nothing (a cold open)'}.`);
    if (cut && own.some((x) => modules.makeOf(x) !== s.make)) out.push(`The cut scene for ${s.id}: "make" is "${s.make}" in the storyboard.`);
  }
  for (const [key, list] of [['jsscenes', js], ['cutscenes', cs]]) {
    for (const e of list) {
      if (typeof e.shot !== 'string' || !shots.has(e.shot)) out.push(`A "${key}" entry names ${typeof e.shot === 'string' ? `shot ${e.shot}, which isn't in the storyboard` : 'no shot'}.`);
      else if (isSlide(shots.get(e.shot))) out.push(`A "${key}" entry names ${e.shot}, a slide: a scene between slides is a shot of its own.`);
    }
  }
  const cutIds = cs.map((e, i) => { const m = /cutscene[-_]?([A-Za-z0-9_-]{1,20})\.md$/i.exec(String(e.brief || '')); return (m ? m[1] : String(i + 1)).toLowerCase(); });
  const seen = new Set();
  for (const e of js) {
    const id = typeof e.id === 'string' ? e.id : '';
    if (!/^J[0-9]{1,3}$/.test(id)) { out.push(`A "jsscenes" id is "${id.slice(0, 20)}": J and a number, like J1.`); continue; }
    const key = id.toLowerCase();
    if (seen.has(key)) out.push(`Two "jsscenes" entries are ${id}.`);
    else if (cutIds.includes(key)) out.push(`"jsscenes" ${id} has a cut scene's id.`);
    seen.add(key);
  }
  return out;
}

/** The deck crew's check (stagetools' check_deck calls it): [] with no storyboard (an older episode) or no problems. */
function checkDeck(dir) {
  const board = read(dir);
  if (!board || !board.shots.length) return [];
  const project = path.join(dir, 'presentation', 'deck', 'project');
  let deck;
  try { deck = JSON.parse(fs.readFileSync(path.join(project, 'deck.json'), 'utf8')); } catch { return ['There is no deck/project/deck.json yet.']; }
  let map = {};
  try { map = JSON.parse(fs.readFileSync(path.join(project, 'modules.json'), 'utf8')); } catch { /* none yet */ }
  const order = (Array.isArray(deck && deck.order) ? deck.order : []).map((x) => (typeof x === 'string' ? x : x && x.id)).filter((x) => typeof x === 'string');
  return deckProblems(board, order, isObj(map) ? map : {});
}

// ── files: storyboard.json and the undo log ────────────────────────────────────────────────────────────────────

const fileOf = (dir) => path.join(dir, 'presentation', FILE);
const undoFileOf = (dir) => path.join(dir, 'presentation', UNDO_FILE);
const boardSha = (b) => sha256(JSON.stringify(normalise(b)));

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/** The episode's storyboard, as read (normalised), or null (none, unreadable, or a newer schema). */
function read(dir) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(fileOf(dir), 'utf8')); } catch { return null; }
  if (!isObj(raw) || (raw.schema != null && raw.schema !== SCHEMA)) return null;
  return normalise(raw);
}

/** Write the episode's storyboard (normalised, atomically). → the board as written */
function write(dir, board) {
  const b = normalise(board);
  writeAtomic(fileOf(dir), `${JSON.stringify(b, null, 2)}\n`);
  return b;
}

function readUndo(dir) {
  try {
    return fs.readFileSync(undoFileOf(dir), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => isObj(e) && isObj(e.before) && typeof e.afterSha === 'string');
  } catch { return []; }
}
function writeUndo(dir, entries) {
  if (!entries.length) { fs.rmSync(undoFileOf(dir), { force: true }); return; }
  writeAtomic(undoFileOf(dir), `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`);
}
function undoState(dir) {
  const e = readUndo(dir);
  return { undo: e.filter((x) => !x.undone).length, redo: e.filter((x) => x.undone).length };
}

// The edits that leave an approved plan approved; every other one (and its undo or redo) un-approves it. A voice
// changes who speaks a slide, not the plan the deck and the script were built from.
const KEEPS_APPROVAL = new Set(['mode', 'lock', 'voice']);
/** What an undo step remembers of its edit: the op and the shot, never the edit's text. */
const opEntry = (o) => (isObj(o) && typeof o.op === 'string'
  ? { op: o.op.slice(0, 20), ...(typeof o.id === 'string' && ID.test(o.id) ? { id: o.id } : {}) } : null);

/** Save a change as one undo step (the redo steps after it are gone; at most 50 steps kept). */
function commit(dir, before, after, o) {
  const b = write(dir, after);
  const entries = readUndo(dir).filter((x) => !x.undone);
  entries.push({ at: new Date().toISOString(), op: opEntry(o), before: normalise(before), afterSha: boardSha(b) });
  writeUndo(dir, entries.slice(-UNDO_MAX));
  return b;
}

/**
 * A board an undo or redo brings back, approved only as the board is now and only across a step that keeps approval
 * (a mode or a lock): the file never comes back approved without an approval.
 */
function restored(board, entry, cur) {
  const b = normalise(board);
  b.approvedAt = isObj(entry.op) && KEEPS_APPROVAL.has(entry.op.op) ? cur.approvedAt : null;
  return b;
}

/**
 * One directed edit on the episode's storyboard (the `storyboard:op` the board sends), kept as one undo step.
 * Editing an approved plan un-approves it (a mode or a lock aside). → view(dir)
 */
function edit(dir, o, opts = {}) {
  const cur = read(dir);
  if (!cur) throw new Error('There is no storyboard yet.');
  const next = op(cur, o, opts);
  if (!KEEPS_APPROVAL.has(o.op)) next.approvedAt = null;
  commit(dir, cur, next, o);
  return view(dir, opts);
}

/** Back one step (only when the board is what that step left). → view(dir), or null with nothing to undo */
function undo(dir, opts = {}) {
  const entries = readUndo(dir);
  const i = entries.map((e) => !e.undone).lastIndexOf(true);
  const cur = read(dir);
  if (i < 0 || !cur || boardSha(cur) !== entries[i].afterSha) return null;
  entries[i].before = write(dir, restored(entries[i].before, entries[i], cur));
  entries[i].undone = true;
  entries[i].after = cur;
  writeUndo(dir, entries);
  return view(dir, opts);
}

/** Forward one step again. → view(dir), or null with nothing to redo */
function redo(dir, opts = {}) {
  const entries = readUndo(dir);
  const i = entries.findIndex((e) => e.undone);
  const cur = read(dir);
  if (i < 0 || !cur || !isObj(entries[i].after) || boardSha(cur) !== boardSha(entries[i].before)) return null;
  entries[i].afterSha = boardSha(write(dir, restored(entries[i].after, entries[i], cur)));
  entries[i].undone = false;
  delete entries[i].after;
  writeUndo(dir, entries);
  return view(dir, opts);
}

/**
 * The storyboard at stage open (W2-01): the strawman when there is none; a re-plan when bullets.md changed since, or
 * when this surface can't make a Generated scene the plan has (opts.caps: the plugin, the Desk, no caps; its unlocked
 * Cosmos and cut scenes are then drawn in code); else the board as it is. A re-plan un-approves the plan, keeps its
 * diff for the review and starts a new undo history. → { board, created, replanned, diff }
 */
function ensure(dir, opts = {}) {
  let md;
  try { md = fs.readFileSync(path.join(dir, 'presentation', 'bullets.md'), 'utf8'); } catch { md = ''; }
  const cur = read(dir);
  if (!cur) {
    const board = write(dir, strawman(md, opts));
    writeUndo(dir, []);
    return { board, created: true, replanned: false, diff: null };
  }
  let next = null;
  if (isStale(cur, md)) next = replan(cur, md, opts).board;
  else if (!canGenerate(opts.caps) && cur.shots.some((s) => PAID.has(s.module) && !s.locked && s.make === 'generate')) {
    next = clone(cur);
    next.policy = surfacePolicy(next.policy, opts.caps);
    for (const s of next.shots) if (PAID.has(s.module) && !s.locked) s.make = 'code';
    next.source.diff = diff(cur, next);
  }
  if (!next) return { board: cur, created: false, replanned: false, diff: null };
  next.approvedAt = null;
  const board = write(dir, next);
  writeUndo(dir, []);
  return { board, created: false, replanned: true, diff: board.source.diff || null };
}

// ── the storyboard crew: its prompt's parts and its tool ───────────────────────────────────────────────────────

/** The board as the storyboard crew reads it: one row per shot. */
function plannerTable(board) {
  const b = normalise(board);
  const rows = ['| Shot | Where | Bullets | Module | Seconds | Title | Idea | Style | Locked |', '|---|---|---|---|---|---|---|---|---|'];
  let n = 0;
  const cell = (v) => String(v == null ? '' : v).replace(/\|/g, '/');
  for (const s of b.shots) {
    const where = isSlide(s) ? `slide ${(n += 1)}` : s.after ? `after ${s.after}` : 'cold open';
    const mod = isInterstitial(s) ? 'motion-solo ♪' : PAID.has(s.module) ? `${s.module} (${s.make})` : s.module;
    rows.push(`| ${s.id} | ${where} | ${isSlide(s) ? bulletsText(s) : '—'} | ${mod} | ${isSlide(s) ? s.estSeconds : s.seconds} | ${cell(s.title)} | ${cell(s.idea)} | ${cell(styled(s.module) ? s.style || '' : '—')} | ${s.locked ? 'locked' : ''} |`);
  }
  return rows.join('\n');
}

/** The policy in plain lines, for the storyboard crew. */
function policyText(policy) {
  const pol = cleanPolicy(policy);
  const row = planFor(pol.minutes);
  const cap = interstitialCap(pol);
  return [
    `- **Length:** ${pol.minutes} minutes; about ${row.shots[0]}–${row.shots[1]} shots (slides plus scenes between them).`,
    `- **The originals:** ${pol.originals === 'all' ? 'all seven, if the slides allow' : 'as many as fit'}; when not everything fits, in this order: ${PRIORITY.map(nameOf).join(', ')}.`,
    `- **Live Motion:** at least ${pol.minLive} narrated scene${pol.minLive === 1 ? '' : 's'}; ${row.solo} Motion Solo and ${row.duet} Motion Duet by default${row.duetAt ? ` (the Duet from ${row.duetAt} slides)` : ''}; at most ${pol.maxLive} Live Motion pieces in all; about ${pct(pol.liveShare)} % of the running time.`,
    `- **Scenes between slides:** ${cap ? `at most ${cap} Solo ♪` : 'no Solo ♪'}${row.cutscenes ? ' and one cut scene' : ''}; never two in one gap${pol.minutes < 5 ? '; none before the first slide' : ''}.`,
    `- **Cosmos and cut scenes:** ${pol.paid === 'generate' ? 'generated (priced and approved at the Scenes step)' : 'drawn in code (free)'}. The plan decides this, not you.`,
    '- **The solver** holds this policy after your edits: it may move a module you set to keep the plan whole.',
  ].join('\n');
}

/** The nine modules for the storyboard crew: placement, presenter, and what a Generated one costs. */
function catalogText(opts = {}) {
  const routes = { stills: 'kie', video: 'kie', ...(isObj(opts.routes) ? opts.routes : {}) };
  const cosmos = scenes.recipe('cartoon', routes).totalUsd;
  const cut = scenes.recipe('cutscene', { ...routes, shots: cutShots(BETWEEN.seconds) }).totalUsd;
  const lines = modules.MODULES.map((m, i) => {
    const meta = modules.META[m.id];
    const where = m.id === 'motion-solo' ? 'a slide (narrated, the bubble hidden: voice only) or a scene between slides (unnarrated, ♪)'
      : meta.placement.includes('between') ? 'a scene between two slides, no presenter' : `a slide, ${meta.bubble === false ? 'the bubble hidden (voice only)' : 'the presenter in the corner'}`;
    const cost = m.id === 'cosmos' ? `; generated ≈ ${fmtUsd(cosmos)} at Scenes, or drawn in code (free)` : m.id === 'cutscene' ? `; generated ≈ ${fmtUsd(cut)} for ${BETWEEN.seconds} s at Scenes, or drawn in code (free)` : '';
    return `${i + 1}. **${m.name}** (\`${m.id}\`): ${m.short} ${where}${cost}.${meta.needsClip ? ' Needs the user\'s own clip.' : ''}`;
  });
  lines.push(`- **${modules.TITLE_CARD.name}** (\`statement\`): a plain statement slide; never counted.`);
  return lines.join('\n');
}

/** The score presets a shot's music may name, for the prompt (`pulse-112`, …). */
function scoresText() {
  let ids;
  try { ids = score.presetIds(); } catch { ids = [score.DEFAULT_PRESET]; }
  return ids.map((id) => `\`${id}\``).join(', ');
}

/** The storyboard stage's prompt vars (W2-01 adds {{styles}}): the strawman, the policy, the module catalog, the scores. */
function promptVars(board, opts = {}) {
  const b = normalise(board);
  return { storyboard: plannerTable(b), policy: policyText(b.policy), modules: catalogText(opts), scores: scoresText() };
}

const EDIT_OPS = Object.keys(EDITS);

/**
 * The save_storyboard tool for the storyboard crew (W2-01 registers it: sdk.tool(t.name, t.description, t.schema,
 * t.handler)). The crew writes no file: it sends edits; FLPT applies the valid ones, runs the solver, saves the board
 * and answers with what it did and the board as it now is. An approved board isn't the crew's to change. caps: the
 * surface, as in apply() (none: every Cosmos and cut scene drawn in code).
 *   saveTool({ z, dir, caps, now, onSaved })
 */
function saveTool({ z, dir, caps = null, now = null, onSaved = null }) {
  const edit = z.object({
    op: z.enum(EDIT_OPS),
    shot: z.string().max(8).optional(),
    with: z.string().max(8).optional(),
    after: z.string().max(8).optional(),
    atBullet: z.number().int().optional(),
    kind: z.enum(['solo', 'cutscene']).optional(),
    module: z.string().max(20).optional(),
    style: z.string().max(60).nullable().optional(),
    music: z.string().max(140).optional(),
    sfx: z.enum(SFX).optional(),
    seconds: z.number().optional(),
    title: z.string().max(200).optional(),
    idea: z.string().max(400).optional(),
  });
  const reply = (t) => ({ content: [{ type: 'text', text: t }] });
  return {
    name: 'save_storyboard',
    description: 'Save your storyboard edits. Send every edit in one call: setModule {shot, module}, split {shot, atBullet}, merge {shot, with}, insertBetween {after, kind: solo|cutscene, seconds?, title?, idea?}, setStyle {shot?, style} (no shot: the episode\'s style), setSound {shot, music?, sfx?}, setIdea {shot, idea}, setTitle {shot, title}. Locked shots are the user\'s and are never changed. FLPT applies the valid edits, drops the rest with a reason, runs the solver that keeps the policy, saves, and returns the board.',
    schema: { edits: z.array(edit).max(LIMITS.edits), note: z.string().max(400).optional() },
    handler: async ({ edits }) => {
      const cur = read(dir);
      if (!cur) return reply('There is no storyboard to edit yet.');
      if (cur.approvedAt) return reply('The storyboard is approved: it isn\'t yours to change now.');
      const r = apply(cur, edits, { caps, now });
      const saved = commit(dir, cur, r.board, { op: 'polish' });
      if (onSaved) onSaved(saved);
      const p = price(dir, saved);
      const t = totals(p, saved.policy, caps);
      return reply([
        `Saved: ${r.applied} edit(s) applied${r.dropped.length ? `, ${r.dropped.length} dropped` : ''}.`,
        ...r.dropped.map((d) => `- dropped #${d.n}${d.op ? ` (${d.op})` : ''}: ${d.why}`),
        ...(r.notes.length ? ['The solver:', ...r.notes.map((x) => `- ${x}`)] : []),
        '',
        `${t.line} · ${t.tooltip.join(' · ')}${t.status.length ? ` · ${t.status.join(' · ')}` : ''}`,
        '',
        plannerTable(saved),
      ].join('\n'));
    },
  };
}

module.exports = {
  SCHEMA, SOLVER, FILE, UNDO_FILE, UNDO_MAX, PLANS, PRIORITY, ORIGINALS, CREW_USD, CREW_MINUTES, BETWEEN, LIMITS, OPS, EDIT_OPS,
  planFor, canGenerate, paidDefault, surfacePolicy, defaultPolicy, cleanPolicy, moduleFrom, readHeadings, parse, strawman, normalise, validate,
  balance, needed, fit, apply, op, run, replan, isStale, diff, approve, price, view, totals, toDeckBrief, deckProblems, checkDeck,
  read, write, edit, undo, redo, ensure, plannerTable, policyText, catalogText, promptVars, saveTool, cutsOf, mapHeadings,
};
