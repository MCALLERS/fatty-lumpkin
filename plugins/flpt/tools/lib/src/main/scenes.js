'use strict';
// Scenes: the episode's Cosmos cartoons and cut scenes, made in small paid steps the user approves one at a time:
// first the stills (a style frame and keyframes for a cartoon; a plate and start frames for a cut scene), each one
// reviewed; then the video from the approved stills (a 480p draft on Kie.ai, finished at 1080p as the same take);
// then the clip, put together for free with ffmpeg (motion.js and assemble.js).
//
// The plan comes from the deck crew: each cartoon's beats and each cut scene's shots, in modules.json (see the deck
// prompt). FLPT turns them into prompts with a template (the style block or the cinematic look, plus the house
// rules: no text, no logos, no real or famous people), so writing the prompts costs nothing. An older deck with only
// a free-text brief is read as well as it can be.
//
// The state is presentation/scenes.json: every take of every still and shot (its file, its job, what it cost) and
// the one the user approved. generate.js adds takes as jobs start and land; the flow approves them; motion.js puts the
// finished clips in media.json. Nothing here spends anything or talks to a provider.
//
// Only the generated pieces are here. A Cosmos or cut scene the plan draws in code ("make": "code") is a Live Motion
// scene: free, never priced or made in this step, and a code cut scene is spliced into the film afterwards, so it
// never enters media.json and never moves its neighbours' timing (or re-bills their avatar clips). The unnarrated
// scenes between slides ("jsscenes") are never read here at all. A generated piece can be drawn in code instead
// (livemotion.drawInCode, the step's "Draw it in code"), free, once nothing of it is on its way (`drawable`).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { estimate } = require('./broker');

const LIMITS = { beats: [2, 6], shots: [1, 4], seconds: [4, 10], sceneSeconds: 30, heroSeconds: 5 };
const FINAL = '1080p';
const DRAFT = '480p';

// The method's cartoon style block (templates/hyperframes/examples/cartoon/BRIEF.md), used unless the plan has one.
const STYLE = '2D digital painting, storybook limited-animation style; bold dark ink outlines with a slight hand-inked wobble; angular simplified '
  + 'faces; two-tone cel shading on figures; painterly textured backgrounds with brush strokes and paper grain; one dramatic light source; deep '
  + 'chiaroscuro; heavy vignette; muted teal-and-amber palette with aged-cream highlights and one oxblood accent; no text, no lettering, no logos, '
  + 'no photorealism, no 3D look, no anime.';
// The house rules every generated picture follows.
const NO_WORDS = 'No text, captions, subtitles, signs or lettering of any kind. No logos, brands or trademarks.';
const NO_PEOPLE = {
  cartoon: 'No real or famous people and no look-alikes: every figure is an anonymous, clearly stylised character.',
  cinema: 'No real or famous people and no look-alikes: anyone in the shot is an anonymous stranger.',
};

const readJson = (p, fallback = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } };
const exists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const pad2 = (n) => String(n).padStart(2, '0');
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const SAFE_ID = /^[A-Za-z0-9_-]{1,40}$/;

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/** Words from the crew or a brief, as they go into a prompt: no markdown, no stray quotes, one line, capped. */
function clean(text, max = 600) {
  let s = String(text == null ? '' : text).replace(/<!--[\s\S]*?-->/g, ' ').replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();
  s = s.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  return s.length > max ? `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : s;
}
const sentence = (s) => (s && !/[.!?…]$/.test(s) ? `${s}.` : s);

// ── the plan ─────────────────────────────────────────────────────────────────────────────────────────────────

function deckOf(dir) {
  const pres = path.join(dir, 'presentation');
  const project = path.join(pres, 'deck', 'project');
  const deck = readJson(path.join(project, 'deck.json'), {}) || {};
  const order = (Array.isArray(deck.order) ? deck.order : []).map((x) => (typeof x === 'string' ? x : x && x.id)).filter(Boolean);
  const modules = readJson(path.join(project, 'modules.json'), {}) || {};
  return { pres, project, order, modules };
}

/** Slide titles by number: the script's "## SLIDE n — Title" headings, else the bullets'. */
function slideTitles(pres) {
  const out = {};
  for (const [file, re] of [['bullets.md', /^##\s+Slide\s+(\d+)\s*[—–-]\s*(.*)$/gim], ['script.md', /^##\s+SLIDE\s+(\d+)\s*[—–-]\s*(.*)$/gim]]) {
    let text = '';
    try { text = fs.readFileSync(path.join(pres, file), 'utf8'); } catch { continue; }
    let m;
    while ((m = re.exec(text))) out[Number(m[1])] = clean(m[2], 120);
  }
  return out;
}

function readBrief(project, rel) {
  if (typeof rel !== 'string' || !rel) return '';
  const file = path.resolve(project, rel);
  if (!file.startsWith(path.resolve(project) + path.sep)) return '';
  try { return fs.readFileSync(file, 'utf8').slice(0, 40000); } catch { return ''; }
}

/** "**Label:** text" from a brief (up to the next bold label or the end of the line). */
function labelled(text, re) {
  const m = new RegExp(`\\*\\*(?:${re.source})\\s*:?\\s*\\*\\*\\s*:?\\s*(.*?)(?=\\s*\\*\\*[^*\\n]{1,40}\\*\\*|\\n|$)`, 'i').exec(text)
    || new RegExp(`^\\s*(?:[-*]\\s*)?(?:${re.source})\\s*:\\s*(.+)$`, 'im').exec(text);
  return m ? clean(m[1], 600) : '';
}

/** An older brief's keyframes: lines that quote the narration ("…") and say what the picture shows. */
function beatsFromBrief(text) {
  const beats = [];
  for (const raw of String(text).split(/\r?\n/)) {
    if (!/^\s*(?:[-*]|\d+[.)])\s+/.test(raw) && !/[“"].{3,}[”"]/.test(raw)) continue;
    const q = /["“]([^"”]{3,120})["”]/.exec(raw);
    if (!q) continue;
    const picture = clean(raw.replace(q[0], ' ').replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').replace(/^\W*(?:on|cue|at)\s*:?\s*/i, '').replace(/^[\s:—–-]+|[\s:—–-]+$/g, ''), 800);
    if (picture.length < 8) continue;
    beats.push({ cue: clean(q[1], 200), picture, hero: /★|\bhero\b/i.test(raw), move: '' });
  }
  return { beats: beats.slice(0, LIMITS.beats[1]), style: labelled(text, /style/) };
}

/** An older brief's shots: a "Shots:" line split on semicolons, or the list under a Shots heading. */
function shotsFromBrief(text) {
  let parts = [];
  const line = labelled(text, /shots?/);
  if (line && line.includes(';')) parts = line.split(';');
  else {
    const m = /^#{1,4}\s*shots?\b[^\n]*\n([\s\S]*?)(?=^#{1,4}\s|(?![\s\S]))/im.exec(text);
    if (m) parts = m[1].split(/\r?\n/).filter((l) => /^\s*(?:[-*]|\d+[.)])\s+/.test(l));
    else if (line) parts = [line];
  }
  return parts.map((p) => {
    const secs = /\(?\b(\d+(?:\.\d+)?)\s*(?:s|sec|seconds?)\b\)?/i.exec(p);
    const picture = clean(p.replace(secs ? secs[0] : '', ' ').replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').replace(/[\s,;.]+$/, ''), 800);
    return { seconds: secs ? Number(secs[1]) : 5, picture, action: '', continues: false };
  }).filter((s) => s.picture.length >= 8);
}

const str = (v, max) => (typeof v === 'string' ? clean(v, max) : '');
// A Cosmos or cut scene drawn in code (a Live Motion scene), not generated here.
const drawnInCode = (e) => Boolean(e && typeof e === 'object' && e.make === 'code');

/**
 * The episode's cartoons and cut scenes, from modules.json (and the briefs): what can be made, in deck order.
 *   cartoons:  { key: 'cartoon:<slide-id>', id, n (slide number), title, style, beats: [{ cue, picture, hero, move }], source, problems }
 *   cutscenes: { key: 'cutscene:<id>', id, after (slide id or null), afterN (0 = before slide 1), title, place, look, sound,
 *                shots: [{ seconds, picture, action, continues }], source, problems }
 * `problems` are plain lines for the user (the crew's check is checkPlan).
 */
/**
 * Every cut scene's id, in modules.json's order (null for an entry that isn't one), each kind numbered on its own:
 *   generated  as they always were, so their takes stay filed under them (T13): the brief's name (cutscene_2.md →
 *              "2"), else its place in the list; a code cut scene next to it never takes its id. A place that is
 *              taken too gets a count ("2-2"), never a second "2".
 *   in code    (livemotion.js keys them between:C<id>) briefs first, then places, each unique: a piece drawn in code
 *              later never takes the id of one already drawn, so a folder never passes to another piece.
 * The Scenes step (cutscene:<id>) and Live Motion read the same ids from here.
 */
function cutIds(list) {
  const arr = Array.isArray(list) ? list : [];
  const ids = arr.map(() => null);
  const briefOf = (e) => { const m = /cutscene[-_]?([A-Za-z0-9_-]{1,20})\.md$/i.exec(String(e.brief || '')); return m ? m[1] : null; };
  const used = new Set();
  const free = (x) => !used.has(x.toLowerCase());
  const take = (i, want) => {
    let id = want;
    for (let k = 2; !free(id); k++) id = `${i + 1}-${k}`;
    used.add(id.toLowerCase());
    ids[i] = id;
  };
  arr.forEach((e, i) => {
    if (!e || typeof e !== 'object' || drawnInCode(e)) return;
    const b = briefOf(e);
    take(i, b && free(b) ? b : String(i + 1));
  });
  used.clear();
  const code = arr.map((e, i) => (drawnInCode(e) ? i : -1)).filter((i) => i >= 0);
  for (const i of code) { const b = briefOf(arr[i]); if (b && free(b)) take(i, b); }
  for (const i of code) if (ids[i] == null) take(i, String(i + 1));
  return ids;
}

function plan(dir) {
  const { pres, project, order, modules } = deckOf(dir);
  const titles = slideTitles(pres);
  const entries = (modules && modules.slides) || {};
  const cartoons = [];
  order.forEach((id, i) => {
    const e = entries[id];
    if (!e || e.module !== 'cosmos' || drawnInCode(e) || !SAFE_ID.test(id)) return;
    const c = e.cartoon && typeof e.cartoon === 'object' && !Array.isArray(e.cartoon) ? e.cartoon : null;
    let beats = [];
    let style = '';
    let source = 'plan';
    if (c && Array.isArray(c.beats)) {
      beats = c.beats.filter((b) => b && typeof b === 'object').map((b) => ({ cue: str(b.cue, 200), picture: str(b.picture, 800), hero: b.hero === true, move: str(b.move, 400) }));
      style = str(c.style, 1500);
    } else {
      ({ beats, style } = beatsFromBrief(readBrief(project, e.brief)));
      source = 'brief';
    }
    beats = beats.filter((b) => b.picture).slice(0, LIMITS.beats[1]);
    let hero = beats.findIndex((b) => b.hero);
    beats.forEach((b, k) => { b.hero = k === hero; });
    if (hero < 0) hero = null;
    const problems = beats.length < LIMITS.beats[0] ? [beats.length ? 'Its plan has one beat: a cartoon needs at least two.' : 'No beats in its plan yet.'] : [];
    cartoons.push({ key: `cartoon:${id}`, kind: 'cartoon', id, n: i + 1, title: titles[i + 1] || id, style: style || STYLE, beats, hero, source, problems, blocked: problems.length > 0 });
  });
  const cutscenes = [];
  const list = Array.isArray(modules.cutscenes) ? modules.cutscenes : [];
  const ids = cutIds(list);
  list.forEach((e, i) => {
    if (!e || typeof e !== 'object' || drawnInCode(e)) return; // its place in the list (and its id) still numbers the others
    const id = ids[i];
    const brief = readBrief(project, e.brief);
    let shots;
    let source = 'plan';
    if (Array.isArray(e.shots)) {
      shots = e.shots.filter((s) => s && typeof s === 'object').map((s) => ({ seconds: Number(s.seconds) || 5, picture: str(s.picture, 800), action: str(s.action, 800), continues: s.continues === true }));
    } else {
      shots = shotsFromBrief(brief);
      source = 'brief';
    }
    shots = shots.filter((s) => s.picture).slice(0, LIMITS.shots[1]).map((s, k) => ({ ...s, seconds: clamp(Math.round(s.seconds), ...LIMITS.seconds), continues: k > 0 && s.continues }));
    const after = typeof e.after === 'string' && e.after ? e.after : null;
    const afterN = after ? order.indexOf(after) + 1 : 0;
    const problems = [];
    if (after && !afterN) problems.push(`It follows "${after}", which isn't in the deck.`);
    if (!shots.length) problems.push('No shots in its plan yet.');
    cutscenes.push({
      key: `cutscene:${id}`, kind: 'cutscene', id, n: i + 1, after, afterN: after && !afterN ? null : afterN,
      title: str(e.title, 80) || labelled(brief, /title/) || `Cut scene ${i + 1}`,
      place: str(e.place, 600) || labelled(brief, /place|setting|where/), look: str(e.look, 600) || labelled(brief, /look/),
      sound: str(e.sound, 300) || labelled(brief, /sound/), shots, source, problems, blocked: problems.length > 0,
    });
  });
  return { cartoons, cutscenes };
}

/** What's wrong with the deck's cartoon and cut-scene plans, as short lines for the deck crew (check_deck). */
function checkPlan(dir) {
  const { order, modules } = deckOf(dir);
  const out = [];
  const entries = (modules && modules.slides) || {};
  for (const id of order) {
    const e = entries[id];
    if (!e || e.module !== 'cosmos' || drawnInCode(e)) continue;
    const c = e.cartoon;
    if (!c || typeof c !== 'object' || !Array.isArray(c.beats)) { out.push(`${id}: a Cosmos cartoon needs its beats in modules.json ("cartoon": { "beats": [ … ] }).`); continue; }
    const n = c.beats.length;
    if (n < 4 || n > 6) out.push(`${id}: ${n} beat${n === 1 ? '' : 's'}; a cartoon has 4–6.`);
    c.beats.forEach((b, k) => {
      if (!b || typeof b !== 'object') { out.push(`${id}, beat ${k + 1}: not a beat.`); return; }
      if (!str(b.cue, 200)) out.push(`${id}, beat ${k + 1}: no cue (the narration's words when it appears).`);
      if (!str(b.picture, 800)) out.push(`${id}, beat ${k + 1}: no picture.`);
    });
    const heroes = c.beats.filter((b) => b && b.hero === true).length;
    if (heroes !== 1) out.push(`${id}: mark exactly one beat "hero": true (the one worth animating); it has ${heroes}.`);
  }
  (Array.isArray(modules.cutscenes) ? modules.cutscenes : []).forEach((e, i) => {
    const name = `cut scene ${i + 1}`;
    if (!e || typeof e !== 'object') { out.push(`${name}: not an entry.`); return; }
    if (drawnInCode(e)) return;
    if (e.after && !order.includes(e.after)) out.push(`${name}: "after": "${e.after}" isn't a slide in deck.json.`);
    if (!Array.isArray(e.shots)) { out.push(`${name}: its shots belong in modules.json ("shots": [ … ]).`); return; }
    if (e.shots.length < 2 || e.shots.length > 4) out.push(`${name}: ${e.shots.length} shot${e.shots.length === 1 ? '' : 's'}; a cut scene has 2–4.`);
    let total = 0;
    e.shots.forEach((s, k) => {
      if (!s || typeof s !== 'object') { out.push(`${name}, shot ${k + 1}: not a shot.`); return; }
      const secs = Number(s.seconds);
      if (!(secs >= LIMITS.seconds[0] && secs <= LIMITS.seconds[1])) out.push(`${name}, shot ${k + 1}: "seconds" is ${s.seconds == null ? 'missing' : s.seconds}; use ${LIMITS.seconds[0]}–${LIMITS.seconds[1]}.`);
      total += secs || 0;
      if (!str(s.picture, 800)) out.push(`${name}, shot ${k + 1}: no picture (its first frame).`);
      if (k === 0 && s.continues) out.push(`${name}, shot 1: "continues" needs a shot before it.`);
    });
    if (total > LIMITS.sceneSeconds) out.push(`${name}: ${total} s in all; keep a cut scene under ${LIMITS.sceneSeconds} s.`);
  });
  return out;
}

// ── the state: presentation/scenes.json ─────────────────────────────────────────────────────────────────────

const stateFile = (dir) => path.join(dir, 'presentation', 'scenes.json');
const empty = () => ({ v: 1, pieces: {} });

function readState(dir) {
  const j = readJson(stateFile(dir), null);
  return j && j.v === 1 && j.pieces && typeof j.pieces === 'object' && !Array.isArray(j.pieces) ? j : empty();
}

/** Change the state in one synchronous read-modify-write (jobs land one at a time in this process). */
function update(dir, fn) {
  const st = readState(dir);
  const r = fn(st);
  writeAtomic(stateFile(dir), `${JSON.stringify(st, null, 1)}\n`);
  return r;
}

function slotIn(st, key, name) {
  const piece = (st.pieces[key] ||= { slots: {} });
  piece.slots ||= {};
  const s = (piece.slots[name] ||= { takes: [], approved: null, final: null });
  s.takes ||= [];
  return s;
}
const peek = (st, key, name) => (st.pieces[key] && st.pieces[key].slots && st.pieces[key].slots[name]) || { takes: [], approved: null, final: null };

/**
 * A slot's state: empty | working | review | approved | failed. A take on its way, then the newest take to look at
 * (or the one approved, which stays in use while a re-roll is reviewed).
 */
function slotStatus(s) {
  const last = s.takes[s.takes.length - 1];
  if (!last) return 'empty';
  if (last.status === 'working' || (s.final && s.final.status === 'working')) return 'working';
  if (last.status === 'made' && s.approved !== s.takes.length - 1) return 'review';
  if (s.approved != null && s.takes[s.approved] && s.takes[s.approved].status === 'made') return 'approved';
  return last.status === 'failed' ? 'failed' : 'review';
}
const approvedTake = (s) => (s.approved != null && s.takes[s.approved] && s.takes[s.approved].status === 'made' ? s.takes[s.approved] : null);

/** The approved video at full quality (a 1080p take, or a draft's finished copy), as a path in presentation/, or null. */
function finalVideo(s) {
  const t = approvedTake(s);
  if (!t) return null;
  if (!t.draft) return t.file;
  return s.final && s.final.from === s.approved && s.final.status === 'made' ? s.final.file : null;
}

// ── the slots of each piece, and what to make next ─────────────────────────────────────────────────────────

const STYLE_KEY = 'style';

function slotsOf(piece) {
  if (piece.kind === 'cartoon') {
    return [{ key: STYLE_KEY, name: 'frame', kind: 'still', label: 'Style' },
      ...piece.beats.map((b, k) => ({ key: piece.key, name: `beat${k + 1}`, kind: 'still', label: String(k + 1), beat: k })),
      ...(piece.hero != null ? [{ key: piece.key, name: 'hero', kind: 'video', label: 'Hero', beat: piece.hero }] : [])];
  }
  return [{ key: piece.key, name: 'plate', kind: 'still', label: 'Plate' },
    ...piece.shots.map((s, k) => ({ key: piece.key, name: `start${k + 1}`, kind: 'still', label: `Frame ${k + 1}`, shot: k })),
    ...piece.shots.map((s, k) => ({ key: piece.key, name: `shot${k + 1}`, kind: 'video', label: `Shot ${k + 1}`, shot: k }))];
}

const needsTake = (s) => { const st = slotStatus(s); return st === 'empty' || st === 'failed'; };
const isApproved = (s) => slotStatus(s) === 'approved';

/**
 * The next paid step for a piece, in the method's order (stills approved before any video): { step, key, slots,
 * kind } with step style | plate | stills | video | finish, or null (something to review, a job on its way, or done).
 */
function nextStep(piece, st) {
  if (piece.blocked) return null;
  const all = slotsOf(piece);
  const busy = all.some((x) => slotStatus(peek(st, x.key, x.name)) === 'working');
  const group = (pred) => all.filter(pred);
  const ready = (list) => list.every((x) => isApproved(peek(st, x.key, x.name)));
  const step = (name, list) => ({ step: name, key: list[0].key, slots: list.map((x) => x.name), kind: list[0].kind });
  if (piece.kind === 'cartoon') {
    const style = group((x) => x.key === STYLE_KEY);
    if (!ready(style)) return needsTake(peek(st, STYLE_KEY, 'frame')) ? step('style', style) : null;
    const beats = group((x) => x.name.startsWith('beat'));
    const missing = beats.filter((x) => needsTake(peek(st, x.key, x.name)));
    if (missing.length) return step('stills', missing);
    if (!ready(beats) || busy) return null;
    if (piece.hero == null || (st.pieces[piece.key] || {}).skipHero) return null;
    const hero = peek(st, piece.key, 'hero');
    if (needsTake(hero)) return step('video', group((x) => x.name === 'hero'));
    if (approvedTake(hero) && !finalVideo(hero) && slotStatus(hero) === 'approved') return step('finish', group((x) => x.name === 'hero'));
    return null;
  }
  const plate = group((x) => x.name === 'plate');
  if (!ready(plate)) return needsTake(peek(st, piece.key, 'plate')) ? step('plate', plate) : null;
  const starts = group((x) => x.name.startsWith('start'));
  const noStart = starts.filter((x) => needsTake(peek(st, x.key, x.name)));
  if (noStart.length) return step('stills', noStart);
  if (!ready(starts) || busy) return null;
  const shots = group((x) => x.name.startsWith('shot'));
  const noShot = shots.filter((x) => needsTake(peek(st, x.key, x.name)));
  if (noShot.length) return step('video', noShot);
  if (!ready(shots)) return null;
  const unfinished = shots.filter((x) => !finalVideo(peek(st, x.key, x.name)));
  return unfinished.length ? step('finish', unfinished) : null;
}

/** Is the piece ready to put together (everything approved at full quality)? */
function isReady(piece, st) {
  if (piece.blocked) return false;
  if (piece.kind === 'cartoon') {
    if (!piece.beats.every((b, k) => approvedTake(peek(st, piece.key, `beat${k + 1}`)))) return false;
    return piece.hero == null || Boolean((st.pieces[piece.key] || {}).skipHero) || Boolean(finalVideo(peek(st, piece.key, 'hero')));
  }
  return piece.shots.length > 0 && piece.shots.every((s, k) => finalVideo(peek(st, piece.key, `shot${k + 1}`)));
}

// ── prompts (templates; the house rules are always in them) ──────────────────────────────────────────────────

function stylePrompt(piece) {
  const subject = clean(piece.beats[0] ? piece.beats[0].picture : piece.title, 600);
  return [piece.style, `A style frame that sets the look of a short painted documentary: ${sentence(subject)} A single 16:9 frame; the whole frame is the painting.`,
    `${NO_WORDS} ${NO_PEOPLE.cartoon}`].join('\n\n');
}

function keyframePrompt(piece, k) {
  return [piece.style, `${sentence(piece.beats[k].picture)} One clear moment in a single 16:9 frame; the whole frame is the painting.`,
    'Match the reference image exactly: its line work, palette, light and texture.',
    `${NO_WORDS} ${NO_PEOPLE.cartoon} Keep faces and anything that matters out of the bottom-left corner.`].join('\n\n');
}

function heroPrompt(piece) {
  const b = piece.beats[piece.hero];
  return ['2D painted limited animation. Keep the exact illustration style, line work and palette of the start image.',
    `Subtle, deliberate motion only: ${sentence(b.move || 'light and atmosphere shift gently, and the camera pushes in very slowly')} One continuous ${LIMITS.heroSeconds}-second shot, no cuts. No morphing faces, no new characters.`,
    `${NO_WORDS} ${NO_PEOPLE.cartoon}`].join('\n\n');
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const look = (piece) => (piece.look ? ` ${cap(sentence(piece.look))}` : '');

function platePrompt(piece) {
  const where = piece.place || (piece.shots[0] ? piece.shots[0].picture : piece.title);
  return [`An empty cinematic location plate, with no people in it: ${sentence(clean(where))}${look(piece)} A real, specific place in 16:9, 35 mm film look, natural motivated light, soft grain.`,
    NO_WORDS].join('\n\n');
}

function startPrompt(piece, k) {
  return [`The first frame of a cinematic shot: ${sentence(piece.shots[k].picture)} The same place as the reference image: the same architecture, light and colour.${look(piece)}`
    + ' 16:9, 35 mm film look, natural motivated light, shallow depth of field, soft grain.', `${NO_WORDS} ${NO_PEOPLE.cinema}`].join('\n\n');
}

function shotPrompt(piece, k, { end = false } = {}) {
  const s = piece.shots[k];
  return [`Start from the reference frame. One continuous ${s.seconds}-second shot: ${sentence(s.action || s.picture)}${end ? ' End exactly on the end frame.' : ''}${look(piece)}`
    + ' A slow, deliberate camera move, 35 mm film look, natural motivated light, soft grain.',
  `Sound: ${piece.sound && !/^(none|no sound|silence)\b/i.test(piece.sound) ? `${cap(clean(piece.sound, 200).replace(/[.]$/, ''))}; ` : ''}the ambient sound of the scene only. No music, no voices, no dialogue.`,
  `${NO_WORDS} ${NO_PEOPLE.cinema}`].join('\n\n');
}

// ── the jobs a step makes ────────────────────────────────────────────────────────────────────────────────────

const presAbs = (dir, rel) => path.join(dir, 'presentation', rel);
const workDir = (piece) => (piece.kind === 'cartoon' ? path.join('cartoons', piece.id) : path.join('cutscenes', piece.id));

/** A price line for one job, in the broker's terms (Higgsfield's own quote replaces it before any approval). */
function lineFor(job) {
  if (job.kind === 'still') return { rate: job.provider === 'kie' ? 'kie_still' : 'higgsfield_still', qty: 1, label: job.label };
  const res = job.kind === 'upgrade' ? FINAL : job.resolution;
  return { rate: `${job.provider}_seedance_${res}_s`, qty: job.seconds, label: job.label };
}

/**
 * The jobs for one step (or a re-roll of one slot), with their prompts, inputs (files in presentation/) and where
 * each result goes. routes: { stills, video } provider ids. Throws a plain message when the step can't run now.
 */
function jobsFor(dir, piece, { step, slots }, routes = {}) {
  const st = readState(dir);
  const stills = routes.stills || 'kie';
  const video = routes.video || 'kie';
  const approvedFile = (key, name) => { const t = approvedTake(peek(st, key, name)); return t ? t.file : null; };
  return slots.map((name) => {
    const s = peek(st, name === 'frame' ? STYLE_KEY : piece.key, name);
    const take = s.takes.length + 1;
    const base = { slot: name, key: name === 'frame' ? STYLE_KEY : piece.key, piece: piece.key, take };
    if (name === 'frame') {
      return { ...base, kind: 'still', provider: stills, prompt: stylePrompt(piece), refs: [], dest: path.join('cartoons', 'style', `style-${take}.png`), label: 'The style frame' };
    }
    let m = /^beat(\d+)$/.exec(name);
    if (m) {
      const style = approvedFile(STYLE_KEY, 'frame');
      if (!style) throw new Error('Approve the style frame first.');
      return { ...base, kind: 'still', provider: stills, prompt: keyframePrompt(piece, Number(m[1]) - 1), refs: [style], dest: path.join(workDir(piece), `beat${m[1]}-${take}.png`), label: `Keyframe ${m[1]}` };
    }
    if (name === 'plate') return { ...base, kind: 'still', provider: stills, prompt: platePrompt(piece), refs: [], dest: path.join(workDir(piece), `plate-${take}.png`), label: 'The plate' };
    m = /^start(\d+)$/.exec(name);
    if (m) {
      const plateFile = approvedFile(piece.key, 'plate');
      if (!plateFile) throw new Error('Approve the plate first.');
      return { ...base, kind: 'still', provider: stills, prompt: startPrompt(piece, Number(m[1]) - 1), refs: [plateFile], dest: path.join(workDir(piece), `start${m[1]}-${take}.png`), label: `Start frame ${m[1]}` };
    }
    const finishing = step === 'finish';
    if (name === 'hero') {
      if (finishing) {
        const t = approvedTake(s);
        if (!t || !t.draft) throw new Error('Approve the hero shot first.');
        return { ...base, take: s.approved + 1, kind: 'upgrade', provider: t.provider, draftJobId: t.jobId, seconds: t.seconds, dest: path.join(workDir(piece), `hero-${s.approved + 1}-${FINAL}.mp4`), label: `The hero shot at ${FINAL}` };
      }
      const frame = approvedFile(piece.key, `beat${piece.hero + 1}`);
      if (!frame) throw new Error('Approve the hero\'s keyframe first.');
      const draft = video === 'kie';
      return { ...base, kind: 'video', provider: video, prompt: heroPrompt(piece), start: frame, end: null, seconds: LIMITS.heroSeconds, resolution: draft ? DRAFT : FINAL,
        draft, audio: false, dest: path.join(workDir(piece), `hero-${take}.mp4`), label: `A ${LIMITS.heroSeconds}-second hero shot${draft ? ` (${DRAFT} draft)` : ''}` };
    }
    m = /^shot(\d+)$/.exec(name);
    if (m) {
      const k = Number(m[1]) - 1;
      if (finishing) {
        const t = approvedTake(s);
        if (!t || !t.draft) throw new Error(`Approve shot ${k + 1} first.`);
        return { ...base, take: s.approved + 1, kind: 'upgrade', provider: t.provider, draftJobId: t.jobId, seconds: t.seconds, dest: path.join(workDir(piece), `shot${k + 1}-${s.approved + 1}-${FINAL}.mp4`), label: `Shot ${k + 1} at ${FINAL}` };
      }
      const start = approvedFile(piece.key, `start${k + 1}`);
      if (!start) throw new Error(`Approve start frame ${k + 1} first.`);
      // A shot whose next one "continues" it lands exactly on that shot's start frame, so the two join without a cut.
      const next = piece.shots[k + 1];
      const end = next && next.continues ? approvedFile(piece.key, `start${k + 2}`) : null;
      const draft = video === 'kie';
      return { ...base, kind: 'video', provider: video, prompt: shotPrompt(piece, k, { end: Boolean(end) }), start, end, seconds: piece.shots[k].seconds,
        resolution: draft ? DRAFT : FINAL, draft, audio: true, dest: path.join(workDir(piece), `shot${k + 1}-${take}.mp4`), label: `Shot ${k + 1}, ${piece.shots[k].seconds} s${draft ? ` (${DRAFT} draft)` : ''}` };
    }
    throw new Error(`Unknown part: ${name}.`);
  });
}

/** The table price of some jobs (Higgsfield's own quotes replace it at the dialog). */
function priceOf(jobs) {
  return jobs.length ? estimate(jobs.map(lineFor)) : null;
}

/**
 * What a whole piece costs as the Scenes step makes it, at the table prices (no re-rolls): a cartoon's style frame
 * (`style: false` when the episode has one), its keyframes and, with a hero, its 5 s shot; a cut scene's plate, a
 * start frame per shot and its shots. On Kie.ai each shot is a 480p draft finished at 1080p as the same take; on
 * Higgsfield it's made at 1080p (its own quote is the price at each step).
 */
function recipe(kind, { keyframes = 4, hero = true, style = true, shots = [4, 4], stills = 'kie', video = 'kie' } = {}) {
  const still = (n, label) => ({ rate: stills === 'kie' ? 'kie_still' : 'higgsfield_still', qty: n, label });
  const shot = (secs, label) => (video === 'kie'
    ? [{ rate: `kie_seedance_${DRAFT}_s`, qty: secs, label: `${label}, ${DRAFT} drafts` }, { rate: `kie_seedance_${FINAL}_s`, qty: secs, label: `${label}, finished at ${FINAL}` }]
    : [{ rate: `higgsfield_seedance_${FINAL}_s`, qty: secs, label: `${label} at ${FINAL}` }]);
  if (kind === 'cartoon') {
    return estimate([still(keyframes + (style ? 1 : 0), `${style ? 'A style frame and ' : ''}${keyframes} keyframes`),
      ...(hero ? shot(LIMITS.heroSeconds, `A ${LIMITS.heroSeconds} s hero shot`) : [])]);
  }
  const secs = shots.reduce((t, s) => t + s, 0);
  return estimate([still(shots.length + 1, `A plate and ${shots.length} start frames`), ...shot(secs, `${shots.length} shots, ${secs} s`)]);
}

// ── takes: started, landed, approved ───────────────────────────────────────────────────────────────────────

/** A job the provider accepted: its take is on its way. */
const takeOf = (job, extra = {}) => ({ status: 'working', file: job.dest, provider: job.provider, model: extra.model || job.model || null, jobId: extra.jobId || job.jobId || null,
  prompt: job.prompt || null, draft: Boolean(job.draft), resolution: job.kind === 'still' ? '2K' : job.kind === 'upgrade' ? FINAL : job.resolution, seconds: job.seconds || null,
  usd: extra.usd == null ? (job.usd == null ? null : job.usd) : extra.usd, at: new Date().toISOString() });

function startTake(dir, job, extra = {}) {
  update(dir, (st) => {
    const s = slotIn(st, job.key, job.slot);
    const take = takeOf(job, extra);
    if (job.kind === 'upgrade') s.final = { ...take, from: job.take - 1 };
    else s.takes[job.take - 1] = take;
    if (job.slot === 'hero' && job.kind === 'video' && st.pieces[job.key]) st.pieces[job.key].skipHero = false;
  });
}

/** A job ended: made (its file is in place) or failed (with a plain reason). */
function landTake(dir, job, { status, file, costUsd = null, credits = null, error = null } = {}) {
  return update(dir, (st) => {
    const s = slotIn(st, job.key, job.slot);
    const prev = (job.kind === 'upgrade' ? s.final : s.takes[job.take - 1]) || takeOf(job); // (a quit can come between the start and its record)
    const take = { ...prev, jobId: job.jobId || prev.jobId || null, status, file: file || prev.file || job.dest, costUsd, credits, error, landedAt: new Date().toISOString() };
    if (job.kind === 'upgrade') s.final = { ...take, from: job.take - 1 };
    else s.takes[job.take - 1] = take;
    return take;
  });
}

/** The user approved the newest take of a slot (a still, or a video draft). */
function approve(dir, key, name) {
  return update(dir, (st) => {
    const s = slotIn(st, key, name);
    const i = s.takes.length - 1;
    if (i < 0 || s.takes[i].status !== 'made') throw new Error('There\'s nothing to approve there yet.');
    s.approved = i;
    return i;
  });
}

/** Leave the hero beat still (a slow push on the keyframe) instead of animating it, or animate it after all. */
function skipHero(dir, key, skip = true) {
  update(dir, (st) => { (st.pieces[key] ||= { slots: {} }).skipHero = Boolean(skip); });
}

/** The pieces' clips: put together, with what they were made from (so a change is noticed). */
function markClip(dir, key, clip) {
  update(dir, (st) => { (st.pieces[key] ||= { slots: {} }).clip = clip ? { ...clip, at: new Date().toISOString() } : null; });
}

/**
 * Takes marked on their way whose job the app no longer has (its jobs file was lost, say) can't land: they're marked
 * as stopped, so they can be made again. Only the app, which knows its jobs, calls this.
 */
function reconcile(dir) {
  update(dir, (st) => {
    for (const p of Object.values(st.pieces)) {
      for (const s of Object.values(p.slots || {})) {
        for (const t of [...s.takes, s.final].filter(Boolean)) if (t.status === 'working') Object.assign(t, { status: 'failed', error: 'It stopped before it finished.' });
      }
    }
  });
}

/**
 * Is a still or a shot of this piece on its way at the provider? Then it can't be drawn in code yet (livemotion's
 * drawInCode refuses): the paid job would land on a piece that no longer wants it.
 */
function pieceWorking(dir, key) {
  const p = readState(dir).pieces[key];
  return Boolean(p && Object.values(p.slots || {}).some((s) => s && slotStatus({ takes: s.takes || [], approved: s.approved, final: s.final }) === 'working'));
}

/** Takes still on their way at the provider, for one episode. */
function working(dir) {
  const st = readState(dir);
  let n = 0;
  for (const p of Object.values(st.pieces)) for (const s of Object.values(p.slots || {})) n += s.takes.filter((t) => t && t.status === 'working').length + (s.final && s.final.status === 'working' ? 1 : 0);
  return n;
}

// ── what goes into a clip ──────────────────────────────────────────────────────────────────────────────────

const clipRel = (piece) => path.join('media', piece.kind === 'cartoon' ? `cartoon_${piece.id}.mp4` : `cutscene_${piece.id}.mp4`);

/** What a ready piece is put together from (paths in presentation/), with a key that changes when any of it does. */
function inputsOf(dir, piece, st = readState(dir)) {
  if (!isReady(piece, st)) return null;
  if (piece.kind === 'cartoon') {
    const skip = Boolean((st.pieces[piece.key] || {}).skipHero);
    const beats = piece.beats.map((b, k) => ({ cue: b.cue, file: approvedTake(peek(st, piece.key, `beat${k + 1}`)).file }));
    const hero = piece.hero != null && !skip ? { beat: piece.hero, file: finalVideo(peek(st, piece.key, 'hero')) } : null;
    const card = path.join('slides', `slide_${pad2(piece.n)}.png`);
    return { kind: 'cartoon', beats, hero, card, out: clipRel(piece), key: sha(JSON.stringify({ beats, hero, n: piece.n })) };
  }
  const shots = piece.shots.map((s, k) => ({ seconds: s.seconds, file: finalVideo(peek(st, piece.key, `shot${k + 1}`)) }));
  return { kind: 'cutscene', shots, out: clipRel(piece), key: sha(JSON.stringify({ shots })) };
}

/** The cut scenes with a clip that's there, for media.json: { id, afterN, title, rel }. Never one without its file. */
function cutsceneClips(dir) {
  const st = readState(dir);
  return plan(dir).cutscenes.filter((c) => c.afterN != null && st.pieces[c.key] && st.pieces[c.key].clip && exists(presAbs(dir, clipRel(c))))
    .map((c) => ({ id: c.id, afterN: c.afterN, title: c.title, rel: clipRel(c) }));
}

/** The cartoons ready to be put together, with their inputs (for motion.js, which times them to the voice). */
function readyCartoons(dir) {
  const st = readState(dir);
  return plan(dir).cartoons.map((c) => ({ piece: c, inputs: inputsOf(dir, c, st) })).filter((x) => x.inputs);
}

// ── the view, for the Scenes step ──────────────────────────────────────────────────────────────────────────

const NAMES = { kie: 'Kie.ai', higgsfield: 'Higgsfield' };

function stepLabel(piece, step, n) {
  const many = (one, more) => (n === 1 ? one : `${more}`);
  if (step === 'style') return 'Make the style frame';
  if (step === 'plate') return 'Make the plate';
  if (step === 'stills') return piece.kind === 'cartoon' ? many('Make the keyframe', `Make ${n} keyframes`) : many('Make the start frame', `Make ${n} start frames`);
  if (step === 'video') return piece.kind === 'cartoon' ? 'Animate the hero' : many('Make the shot', `Make ${n} shots`);
  return piece.kind === 'cartoon' ? `Finish the hero at ${FINAL}` : many(`Finish the shot at ${FINAL}`, `Finish ${n} shots at ${FINAL}`);
}

/**
 * The Scenes step as the page shows it: each piece's tiles (stills and shots, newest take, its state), the next paid
 * step with its table price, and its clip once made. routes: { stills, video }; keys: { kie, higgsfield } (has a key).
 */
function view(dir, { routes = {}, keys = null } = {}) {
  const p = plan(dir);
  const st = readState(dir);
  const abs = (rel) => (rel ? presAbs(dir, rel) : null);
  const priceFor = (piece, step) => { try { return priceOf(jobsFor(dir, piece, step, routes)).totalUsd; } catch { return null; } };
  const pieces = [...p.cartoons, ...p.cutscenes].map((piece) => {
    const tiles = slotsOf(piece).map((x) => {
      const s = peek(st, x.key, x.name);
      const status = x.name === 'hero' && (st.pieces[piece.key] || {}).skipHero && slotStatus(s) !== 'working' ? 'skipped' : slotStatus(s);
      const last = s.takes[s.takes.length - 1] || null;
      const shown = status === 'approved' || status === 'skipped' ? approvedTake(s) || last : last;
      const fin = x.kind === 'video' ? finalVideo(s) : null;
      const posterRel = x.kind === 'video' ? (approvedTake(peek(st, piece.key, x.name === 'hero' ? `beat${piece.hero + 1}` : `start${x.shot + 1}`)) || {}).file : null;
      // One more take of it, priced; a hero left still (or never made) can be animated once its keyframe is approved.
      const again = s.takes.length && status !== 'working' ? priceFor(piece, { step: 'reroll', slots: [x.name] }) : null;
      const animate = x.name === 'hero' && (status === 'skipped' || (!s.takes.length && posterRel)) ? priceFor(piece, { step: 'video', slots: ['hero'] }) : null;
      // What it shows, from the plan (the page's tooltip).
      const about = x.beat != null ? piece.beats[x.beat][x.kind === 'video' ? 'move' : 'picture'] || piece.beats[x.beat].picture
        : x.shot != null ? (x.kind === 'video' ? piece.shots[x.shot].action : '') || piece.shots[x.shot].picture : x.name === 'plate' ? piece.place || '' : '';
      return {
        key: x.key, slot: x.name, label: x.label, kind: x.kind, status, about,
        file: shown && shown.status === 'made' ? abs(fin && status === 'approved' ? fin : shown.file) : null,
        poster: x.kind === 'video' ? abs(posterRel) : null, takes: s.takes.length, final: Boolean(fin), draft: Boolean(shown && shown.draft && !fin), again, animate,
        error: last && last.status === 'failed' ? last.error || 'It didn\'t work out.' : s.final && s.final.status === 'failed' ? s.final.error || 'It didn\'t work out.' : null,
      };
    });
    const next = nextStep(piece, st);
    let nextView = null;
    if (next) {
      let jobs = null;
      try { jobs = jobsFor(dir, piece, next, routes); } catch { jobs = null; }
      const est = jobs && priceOf(jobs);
      const provider = jobs && jobs[0] ? jobs[0].provider : null;
      nextView = { ...next, label: stepLabel(piece, next.step, next.slots.length), usd: est ? est.totalUsd : null, provider, name: NAMES[provider] || provider,
        guess: provider === 'higgsfield', keyMissing: keys && provider && !keys[provider] ? `Add a ${NAMES[provider]} key in Setup → Keys` : null };
    }
    const inputs = inputsOf(dir, piece, st);
    const clip = (st.pieces[piece.key] || {}).clip || null;
    const clipFile = clip && exists(abs(clipRel(piece))) ? abs(clipRel(piece)) : null;
    // What the whole piece costs, made as planned (the episode's style frame counted on its first cartoon only).
    const whole = piece.kind === 'cartoon'
      ? recipe('cartoon', { keyframes: piece.beats.length, hero: piece.hero != null, style: piece === p.cartoons[0], stills: routes.stills || 'kie', video: routes.video || 'kie' })
      : recipe('cutscene', { shots: piece.shots.map((s) => s.seconds), stills: routes.stills || 'kie', video: routes.video || 'kie' });
    return {
      key: piece.key, kind: piece.kind, id: piece.id, title: piece.title, n: piece.n, afterN: piece.afterN, source: piece.source, problems: piece.problems,
      total: piece.blocked ? null : whole.totalUsd, totalGuess: [routes.stills, routes.video].includes('higgsfield'),
      tiles, next: nextView, ready: Boolean(inputs), skipHero: Boolean((st.pieces[piece.key] || {}).skipHero), canSkip: piece.kind === 'cartoon' && piece.hero != null,
      // the Scenes step's "Draw it in code" (livemotion.drawInCode, free): any piece with nothing on its way
      drawable: !pieceWorking(dir, piece.key),
      clip: clipFile, clipAt: clipFile ? Math.round(fs.statSync(clipFile).mtimeMs) : null, outdated: Boolean(inputs && clip && clip.inputs !== inputs.key) || Boolean(inputs && !clipFile),
      error: (st.pieces[piece.key] || {}).error || null,
    };
  });
  let spent = 0;
  for (const piece of Object.values(st.pieces)) for (const s of Object.values(piece.slots || {})) for (const t of [...s.takes, s.final].filter(Boolean)) spent += Number(t.costUsd) || 0;
  return { pieces, working: working(dir), spentUsd: Math.round(spent * 100) / 100, routes: { stills: routes.stills || 'kie', video: routes.video || 'kie' } };
}

/** Is there anything for the Scenes step at all? */
function hasAny(dir) {
  const p = plan(dir);
  return p.cartoons.length + p.cutscenes.length > 0;
}

/** A re-roll of one slot: one more take, priced like any step. */
function rerollStep(piece, st, name) {
  const s = peek(st, name === 'frame' ? STYLE_KEY : piece.key, name);
  if (slotStatus(s) === 'working') throw new Error('That one is still on its way.');
  if (!s.takes.length) throw new Error('Make it first.');
  const kind = name === 'hero' || name.startsWith('shot') ? 'video' : 'still';
  return { step: 'reroll', key: name === 'frame' ? STYLE_KEY : piece.key, slots: [name], kind };
}

/** The piece for a key ('cartoon:<id>' or 'cutscene:<id>'), or a plain error. */
function pieceOf(dir, key) {
  const p = plan(dir);
  const piece = [...p.cartoons, ...p.cutscenes].find((x) => x.key === key);
  if (!piece) throw new Error('That cartoon or cut scene isn\'t in the deck any more.');
  return piece;
}

module.exports = {
  plan, cutIds, checkPlan, readState, update, slotStatus, approvedTake, finalVideo, slotsOf, nextStep, isReady, jobsFor, priceOf, lineFor, recipe, startTake, landTake,
  approve, skipHero, markClip, working, pieceWorking, reconcile, inputsOf, cutsceneClips, readyCartoons, view, hasAny, rerollStep, pieceOf, clipRel, stateFile,
  stylePrompt, keyframePrompt, heroPrompt, platePrompt, startPrompt, shotPrompt, clean, STYLE, STYLE_KEY, LIMITS, NO_WORDS, NO_PEOPLE,
};
