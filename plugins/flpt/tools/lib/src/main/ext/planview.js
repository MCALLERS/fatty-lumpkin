'use strict';
// What the screens draw around the storyboard (W2-04; PLAN §3.3 S4–S7, draft-ux S4–S7), added to what the page gets for
// an episode (the open hook) as view.planview, worked out here in main from the files, never kept in them:
//
//   chips         bullets.md's "## Slide n" sections, each with the module its Module: line names (the doc view's chips):
//                 [{ n, title, module, tile, family, between }]
//   lines         each section's bullet lines, as the storyboard counts them (a shot's `bullets` and `part` index these);
//                 null for a section the board was planned from other lines of
//   hiddenBubble  the deck's slides narrated without the presenter's bubble (motion.hiddenBubbleSlides: Cosmos, Motion
//                 Solo, "bubble": false), by number
//   styles        the style each Live Motion shot is drawn in (its own, the board's, else the default for its kind) and
//                 the shipped poster and loop where FLPT has them: { shots: { <id>: <style id> }, media: { <id>: { name,
//                 poster, loop } } }
//   generateUsd   what each Cosmos or cut scene drawn in code would cost Generated instead (the Scenes step's estimate,
//                 storyboard.price): { <shot id>: usd }, so the MAKE choice states its price before it's made
//   ribbon        once there's a board and a deck stage to follow it (Deck onwards), each shot's progress:
//                 { shots: [{ id, n, slide, placement, module, tile, family, live (Solo, Duet, Solo ♪), title, planned, actual, state,
//                 approved, changed, reason }], line, script, cues }
//                   state     planned · designed (its slide or scene entry is in the deck) · animated (its Live Motion
//                             take or animation is in) · filmed (in the film: a slide once there's a film; a scene
//                             between slides once the film carries it, inFilm)
//                   approved  the step that made that state is approved
//                   changed   { from, to } tiles when the deck crew built another module than the plan's (its reason too)
//                   actual    the script's seconds for the shot (a slide's narration; a scene between slides keeps its own)
//                 line: "5:02 · LIVE MOTION 38 %"; script: "PLAN 5:02 · SCRIPT 4:47 · LIVE MOTION 36 %" once there's a
//                 script; cues: each Live Motion slide's beat cues and whether its script section says them
// Nothing here writes, spends or renders. Anything unreadable leaves that part out: an episode always opens.
const fs = require('fs');
const path = require('path');
const modules = require('../modules');
const storyboard = require('../storyboard');
const stylesLib = require('../styles');

const isObj = (x) => Boolean(x) && typeof x === 'object' && !Array.isArray(x);
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const pad2 = (n) => String(n).padStart(2, '0');
const fmtTime = (sec) => { const s = Math.max(0, Math.round(sec)); return `${Math.floor(s / 60)}:${pad2(s % 60)}`; };
const pct = (x) => Math.round(x * 100);
const LIVE = new Set(['motion-solo', 'motion-duet']);
const PAID = new Set(['cosmos', 'cutscene']);
const DECK_ON = ['deck', 'script', 'animate', 'scenes', 'spend', 'film', 'refine', 'deliver'];

function tileOf(m) {
  if (m === 'statement') return modules.TITLE_CARD.tile;
  const x = modules.byId(m);
  return x ? x.tile : String(m || '');
}
const familyOf = (m) => (modules.meta(m) ? modules.meta(m).family : 'build');
const mdText = (s) => String(s || '').replace(/(\*\*|__|`)/g, '').replace(/\s+/g, ' ').trim();

// ── bullets.md, as the storyboard reads it (storyboard.readHeadings: the same sections and the same lines) ─────────

/** Each "## Slide n — Title" section: { title, lines, moduleLine }. A section without bullets has its title as its line. */
function sections(md) {
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
        if (heads.length >= storyboard.LIMITS.headings) { cur = null; continue; }
        cur = { title: mdText(slide[2]).slice(0, storyboard.LIMITS.title), lines: [], module: null, visual: null };
        heads.push(cur);
      } else if (h[1].length <= 2) cur = null;
      continue;
    }
    if (!cur) continue;
    const mod = /^\s*(?:[-*•+]\s+)?(?:\*\*|__)?\s*(module|visual)\s*(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(.*)$/i.exec(line);
    if (mod) { const k = mod[1].toLowerCase(); if (cur[k] == null) cur[k] = mdText(mod[2]); continue; }
    if (/^\s*>/.test(line)) continue;
    const b = /^\s*(?:[-*•+]|\d+[.)])\s+(.*)$/.exec(line);
    const body = (b ? b[1] : line).trim();
    if (!body) continue;
    if (cur.lines.length < storyboard.LIMITS.lines) cur.lines.push(mdText(body));
    else cur.lines[cur.lines.length - 1] += ` ${mdText(body)}`;
  }
  return heads.map((x, i) => {
    const title = x.title || `Slide ${i + 1}`;
    return { title, lines: x.lines.length ? x.lines : [title], moduleLine: x.module != null ? x.module : x.visual || '' };
  });
}

/** The doc view's chips: each section's module, from its Module: line (storyboard.moduleFrom: the strawman's own table). */
function chipsOf(md) {
  return sections(md).map((s, i) => {
    const { module, between } = storyboard.moduleFrom(s.moduleLine);
    return { n: i + 1, title: s.title, line: s.moduleLine, module: module || null, tile: module ? tileOf(module) : null, family: module ? familyOf(module) : null, between: between || null };
  });
}

// ── the deck, matched to the board ──────────────────────────────────────────────────────────────────────────────

/**
 * Where each shot landed in the deck: { slides: Map<shot id, { n, id, entry }>, betweens: Map<shot id, entry> }. By the
 * `shot` the deck crew wrote on each entry; a deck written without any (an older crew) is matched in order.
 */
function placeShots(board, map, order) {
  const slides = new Map();
  const betweens = new Map();
  if (!isObj(map) || !Array.isArray(order)) return { slides, betweens };
  const entries = isObj(map.slides) ? map.slides : {};
  const tagged = order.some((id) => isObj(entries[id]) && typeof entries[id].shot === 'string');
  const slideShots = board.shots.filter((s) => s.placement === 'slide');
  order.forEach((id, i) => {
    const entry = isObj(entries[id]) ? entries[id] : {};
    const shot = tagged ? entry.shot : slideShots[i] && slideShots[i].id;
    if (typeof shot === 'string' && !slides.has(shot)) slides.set(shot, { n: i + 1, id, entry });
  });
  const lists = [...(Array.isArray(map.jsscenes) ? map.jsscenes : []), ...(Array.isArray(map.cutscenes) ? map.cutscenes : [])].filter(isObj);
  for (const e of lists) if (typeof e.shot === 'string' && !betweens.has(e.shot)) betweens.set(e.shot, e);
  return { slides, betweens };
}

/** media.json's slide entries FLPT placed with a clip (a Live Motion take or a moving slide), by slide number. */
function placedClips(dir) {
  const m = readJson(path.join(dir, 'presentation', 'media.json'));
  const out = new Map();
  for (const [k, v] of Object.entries(isObj(m) && isObj(m.slides) ? m.slides : {})) {
    if (isObj(v) && typeof v.note === 'string' && /^flpt-/.test(v.note) && v.video) out.set(Number(k), v.note);
  }
  return out;
}

/**
 * The scenes between slides the film carries (a scene counts as filmed only once it's in the film): a generated cut
 * scene placed in media.json's "cutscenes" with its clip (the pipeline inserts it while filming), by the slide it
 * follows (after_slide, 0 before the first); an interstitial or a code cut scene spliced in after Film (W2-03, §2.7: a
 * planned add-on row of the record, keyed by its source's id). → { cutsAfter: Set<slide n>, spliced: Set<id, lower case> }
 */
function inFilm(dir, st) {
  const m = readJson(path.join(dir, 'presentation', 'media.json'));
  const cutsAfter = new Set((isObj(m) && Array.isArray(m.cutscenes) ? m.cutscenes : []).filter((c) => isObj(c) && c.video && Number.isInteger(c.after_slide)).map((c) => c.after_slide));
  const spliced = new Set();
  for (const a of Array.isArray(st.addons) ? st.addons : []) {
    if (!isObj(a) || a.planned !== true || !isObj(a.source)) continue;
    for (const k of ['id', 'shot']) if (typeof a.source[k] === 'string' && a.source[k]) spliced.add(a.source[k].toLowerCase());
  }
  return { cutsAfter, spliced };
}

const norm = (s) => String(s || '').toLowerCase().replace(/\[[^\]]*\]/g, ' ').replace(/<[^>]+>/g, ' ').replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Each Live Motion (or Cosmos) slide's narrated beat cues, and whether its script section says each one. */
function cuesOf(placed, scriptSlides) {
  const out = [];
  for (const [shot, p] of placed.slides) {
    const plan = isObj(p.entry.scene) ? p.entry.scene : isObj(p.entry.cartoon) ? p.entry.cartoon : null;
    const beats = plan && Array.isArray(plan.beats) ? plan.beats.filter((b) => isObj(b) && typeof b.cue === 'string' && b.cue.trim()) : [];
    if (!beats.length) continue;
    const said = norm((scriptSlides.find((s) => s.n === p.n) || {}).narration);
    out.push({ n: p.n, shot, tile: tileOf(p.entry.module), cues: beats.slice(0, 12).map((b) => ({ cue: b.cue.trim().slice(0, 120), found: Boolean(said) && said.includes(norm(b.cue)) })) });
  }
  return out.sort((a, b) => a.n - b.n);
}

function ribbonOf(ctx, dir, view, board) {
  const st = view.state;
  const deck = st.stages.deck || {};
  if (!DECK_ON.includes(view.current) && !['review', 'approved', 'stale', 'running'].includes(deck.status)) return null;
  const map = isObj(view.modules) ? view.modules : null;
  const placed = placeShots(board, map, view.deckOrder);
  const clips = placedClips(dir);
  const scriptSlides = view.files && view.files.script ? ctx.episode.parseScript(view.files.script) : [];
  const secs = new Map(ctx.episode.slideSeconds(scriptSlides).map((s) => [s.n, s.seconds]));
  const anim = (st.stages.animate || {}).status;
  const filmed = Boolean(view.video) && ['review', 'approved'].includes((st.stages.film || {}).status);
  const film = filmed ? inFilm(dir, st) : null;
  const filmedBetween = (s, between) => {
    if (!film || !between) return false;
    if (s.module === 'cutscene' && s.make === 'generate') return film.cutsAfter.has(s.after ? (placed.slides.get(s.after) || {}).n : 0);
    return [between.id, s.id].some((k) => typeof k === 'string' && film.spliced.has(k.toLowerCase()));
  };
  const made = new Set(((view.animate && view.animate.slides) || []).filter((a) => a.made).map((a) => a.n));
  const live = isObj(view.livemotion) && Array.isArray(view.livemotion.pieces) ? view.livemotion.pieces : []; // W2-02's, when there
  // livemotion.view's pieces: done ('ok', or 'stale': made, then changed, and still rendered) by their key, or by their
  // shot (a cut scene drawn in code is between:C<n> there, its entry here has none)
  const liveOk = (key, shot) => live.some((x) => isObj(x) && ((key && x.key === key) || (shot && x.shot === shot))
    && (x.ok === true || ['ok', 'stale'].includes(x.status) || x.state === 'ok' || x.state === 'approved'));
  const shots = board.shots.map((s) => {
    const slide = s.placement === 'slide' ? placed.slides.get(s.id) || null : null;
    const between = s.placement === 'between' ? placed.betweens.get(s.id) || null : null;
    const entry = slide ? slide.entry : between;
    let state = 'planned';
    let approved = false;
    if (entry && view.slides && view.slides.length) { state = 'designed'; approved = deck.status === 'approved'; }
    const isLive = LIVE.has(s.module); // the Live Motion family (Solo, Duet, Solo ♪): the share counts these, as the board's does
    const key = slide ? `slide:${slide.id}` : between && (between.id || s.id) ? `between:${between.id || s.id}` : null;
    if (state === 'designed' && ((slide && (clips.get(slide.n) === 'flpt-scene' || made.has(slide.n))) || liveOk(key, s.id))) {
      state = 'animated';
      approved = anim === 'approved';
    }
    if (state !== 'planned' && filmed && (s.placement === 'slide' || filmedBetween(s, between))) { state = 'filmed'; approved = (st.stages.film || {}).status === 'approved'; }
    const deckModule = slide && typeof slide.entry.module === 'string' ? slide.entry.module : null;
    const changed = deckModule && deckModule !== s.module ? { from: tileOf(s.module), to: tileOf(deckModule) } : null;
    const planned = s.placement === 'slide' ? s.estSeconds : s.seconds;
    return {
      id: s.id, n: slide ? slide.n : null, slide: slide ? slide.id : null, placement: s.placement, module: s.module, tile: s.placement === 'between' && s.module === 'motion-solo' ? `${tileOf(s.module)} ♪` : tileOf(s.module),
      family: familyOf(s.module), live: isLive, title: s.title || '', planned, actual: slide && secs.has(slide.n) ? Math.round(secs.get(slide.n)) : s.placement === 'between' ? planned : null,
      state, approved, changed, reason: changed && typeof slide.entry.reason === 'string' ? slide.entry.reason.slice(0, 120) : null, entry: between ? (between.id || null) : null,
    };
  });
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const plannedAll = sum(shots.map((s) => s.planned || 0));
  const liveShare = (list, k) => { const t = sum(list.map((s) => s[k] || 0)); return t > 0 ? sum(list.filter((s) => s.live).map((s) => s[k] || 0)) / t : 0; };
  const line = `${fmtTime(plannedAll)} · LIVE MOTION ${pct(liveShare(shots, 'planned'))} %`;
  let script = null;
  if (scriptSlides.length) {
    const actualAll = sum(shots.map((s) => s.actual || 0));
    script = `PLAN ${fmtTime(plannedAll)} · SCRIPT ${fmtTime(actualAll)} · LIVE MOTION ${pct(liveShare(shots, 'actual'))} %`;
  }
  return { shots, line, script, cues: cuesOf(placed, scriptSlides) };
}

// ── styles: what each Live Motion shot is drawn in, and the shipped poster and loop to show for it ──────────────────

/**
 * Where the shipped posters and loops are, found as shell/styles-files.js serves them (flpt://): Resources/styles in the
 * packaged app (its assets aren't in app.asar), app/assets/styles in development, none in the plugin. This file stays
 * Electron-free (the plugin's lib copies it), so "packaged" is read from where it runs: inside app.asar, or beside a
 * Resources/styles folder.
 */
function mediaRoot({ resourcesPath = process.resourcesPath, here = __dirname } = {}) {
  const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
  const isPackaged = Boolean(resourcesPath) && (/[\\/]app\.asar([\\/]|$)/.test(here) || isDir(path.join(resourcesPath, 'styles')));
  return stylesLib.shippedMediaRoot({ isPackaged, resourcesPath });
}

function stylesOf(board, where = {}) {
  const shots = {};
  const media = {};
  let root = null;
  try { root = mediaRoot(where); } catch { root = null; }
  const names = new Map(stylesLib.SHIPPED.map((s) => [s.id, s.name]));
  for (const s of board.shots) {
    const drawn = LIVE.has(s.module) || (PAID.has(s.module) && s.make === 'code');
    if (!drawn) continue;
    const kind = s.placement === 'between' ? (s.module === 'motion-solo' ? 'interstitial' : 'cutscene') : s.module === 'motion-duet' ? 'duet' : s.module === 'cosmos' ? 'cosmos' : 'solo';
    const id = String(s.style || board.defaults.style || stylesLib.DEFAULTS[kind] || '').replace(/@.*$/, '');
    if (!id) continue;
    shots[s.id] = id;
    if (media[id]) continue;
    const dir = root ? path.join(root, id) : null;
    const file = (f) => (dir && exists(path.join(dir, f)) ? path.join(dir, f) : null);
    media[id] = { name: names.get(id) || id, poster: file('poster.jpg'), loop: file('loop.mp4') };
  }
  return { shots, media };
}

/** What each code Cosmos or cut scene would cost Generated: { <shot id>: usd } (storyboard.price, the board as if it were). */
function generateUsdOf(board) {
  const out = {};
  for (const s of board.shots) {
    if (!PAID.has(s.module) || s.make === 'generate') continue;
    const p = storyboard.price(null, { ...board, shots: board.shots.map((x) => (x.id === s.id ? { ...x, make: 'generate' } : x)) });
    const line = p && p.scenes.lines.find((l) => l.shot === s.id);
    if (line) out[s.id] = line.usd;
  }
  return out;
}

/**
 * Each section's lines for the inspector, kept only where they are the lines the plan indexes (a shot's `bullets`,
 * `part` and the ✂ positions): the same count and the same words per line as storyboard.readHeadings reads them, and,
 * with a board, as its source.headings recorded them when it was planned. A section that differs (a board planned from
 * other bullets: stale, not yet re-planned) is null, so the inspector never shows, or splits at, a line the plan doesn't
 * mean.
 */
function linesFor(md, board) {
  const theirs = storyboard.readHeadings(md);
  const planned = board && isObj(board.source) && Array.isArray(board.source.headings) ? board.source.headings : null;
  const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
  return sections(md).map((s, i) => {
    const words = theirs[i] ? theirs[i].words : null;
    if (!words || words.length !== s.lines.length) return null;
    if (planned && !(isObj(planned[i]) && same(planned[i].words, words))) return null;
    return s.lines;
  });
}

/** view.planview for one episode's view (null parts where there's nothing to show). Never throws. */
function planviewOf(ctx, dir, view) {
  const out = { chips: [], lines: [], hiddenBubble: [], styles: { shots: {}, media: {} }, generateUsd: {}, ribbon: null };
  const md = view.files && view.files.bullets;
  const board = view.storyboard && isObj(view.storyboard.board) ? view.storyboard.board : null;
  try { if (md) { out.chips = chipsOf(md); out.lines = linesFor(md, board); } } catch (e) { ctx.log && ctx.log(`planview: bullets: ${e.message}`); }
  try { out.hiddenBubble = ctx.motion.hiddenBubbleSlides(dir); } catch { out.hiddenBubble = []; }
  if (board && Array.isArray(board.shots)) {
    try { out.styles = stylesOf(board); } catch (e) { ctx.log && ctx.log(`planview: styles: ${e.message}`); }
    try { out.generateUsd = generateUsdOf(board); } catch (e) { ctx.log && ctx.log(`planview: prices: ${e.message}`); }
    try { out.ribbon = ribbonOf(ctx, dir, view, board); } catch (e) { ctx.log && ctx.log(`planview: ribbon: ${e.message}`); }
  }
  return out;
}

module.exports = {
  id: 'planview',
  order: 90, // after the storyboard's (20) and Live Motion's: it reads what they add
  hooks: {
    open(ctx, { dir, view }) {
      if (!isObj(view) || !isObj(view.state)) return view;
      return { ...view, planview: planviewOf(ctx, dir, view) };
    },
  },
  // for the tests
  sections, linesFor, chipsOf, placeShots, inFilm, cuesOf, ribbonOf, mediaRoot, stylesOf, generateUsdOf, planviewOf, norm,
};
