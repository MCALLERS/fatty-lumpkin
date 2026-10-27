'use strict';
/* global flpt, $, el, views, showView, S, FLPT_UI */
// The episode screens. Home lists your episodes and starts new ones. An episode's workspace walks its stages: the
// crew's runs (with a live feed), the files to review and edit, the spend, the film and the delivery.
// The main process does all the work; this file shows state and asks. It builds on app.js ($, el, views, S, FLPT_UI).
// Labels, not instructions (PLAN §3.1): no stage lede or helper paragraph; hints live in tooltips and placeholders.
// What the screens show but don't write (the user's and the crew's words, the main process's messages) is marked
// data-content, so the copy lint (app/test/copy-lint.test.mjs) reads only the app's own words.
const STATUS_TEXT = {
  todo: 'Not started', running: 'Working…', review: 'Ready for your review', approved: 'Approved',
  stale: 'Out of date', error: 'Didn\'t finish', interrupted: 'Interrupted',
};
const NOTES_HINT = {
  bullets: 'What should change? For example: "Fewer slides, punchier titles".',
  factcheck: 'What should it look at again?',
  deck: 'What should change? For example: "Slide 3 is too busy".',
  script: 'What should change? For example: "Less formal".',
};
const MATERIAL_HINT = {
  idea: 'Links, a paragraph, anything that helps. Or nothing: the crew researches.',
  notes: 'Your notes or bullets. The crew keeps your words, stories and jokes.',
  script: 'Your script. The crew keeps your words and checks the facts.',
};
const TOOL_LABEL = {
  Read: 'Reading', Write: 'Writing', Edit: 'Editing', MultiEdit: 'Editing', Glob: 'Looking for files', Grep: 'Searching the files',
  WebSearch: 'Searching the web', WebFetch: 'Reading a web page', Skill: 'Opening the method', TodoWrite: 'Planning',
  'flpt.check_deck': 'Checking the deck\'s layout', 'flpt.script_stats': 'Measuring the script',
  'flpt.start_slide': 'Setting up the slide', 'flpt.use_picture': 'Bringing in a picture', 'flpt.narration_timing': 'Timing the narration',
  'flpt.align_beats': 'Timing the beats', 'flpt.snapshot': 'Taking stills', 'flpt.render_preview': 'Rendering a preview',
  'flpt.compare_with_slide': 'Comparing with the slide',
};
const RESULT_TEXT = { error_max_budget_usd: 'it reached its spending cap', error_max_turns: 'it ran out of turns', error_during_execution: 'an error' };
const FILE_NAME = { bullets: 'bullets.md', script: 'script.md' };
// PLAN §3.2: the stages of moving pictures play in the Theater (always dark); words and planning stay in the Meadow.
const THEATER = new Set(['deck', 'animate', 'scenes', 'film', 'refine']);

const ep = {
  dir: null, // the open episode's folder
  view: null, // flow.open() for it
  stage: null, // the stage on screen
  feeds: new Map(), // `${dir}\n${stage}` → the agent events of the latest run
  inflight: new Map(), // dir → agent stage started from this window
  busy: new Map(), // dir → pipeline step under way ('draft', 'film', 'refine', 'deliver', 'slack')
  addonForm: null, // { dir, kind, staged }: the Refine form that's open
  drafts: new Map(), // `${dir}\n${file}` → unsaved editor text
  flash: null, // { dir, stage, text, bad }: one message at the top of a stage
  poll: null,
  seen: '',
  restored: new Set(), // episodes whose pipeline was restored since its last refusal
  bulletsEdit: new Set(), // episodes whose bullets show as the file to edit, not as the document
  started: new Map(), // `${dir}\n${stage}` → when this window started its crew (the clock's, before the record says)
};
const key2 = (a, b) => `${a}\n${b}`;

// A running step's clock ("Working… · 3:12"): every [data-since] ticks each second, without drawing the panel again,
// so a long think between the crew's lines never looks stalled.
const clockText = (t0) => { const n = Math.max(0, Math.floor((Date.now() - t0) / 1000)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; };
const since = (rec) => { const t = Date.parse((rec && (rec.startedAt || rec.at)) || ''); return Number.isFinite(t) ? t : Date.now(); };
function workingClock(label, t0) {
  return el('span', { class: 'hud working', role: 'timer', 'data-since': String(t0), 'data-label': label }, `${label} · ${clockText(t0)}`);
}
setInterval(() => { for (const n of document.querySelectorAll('[data-since]')) n.textContent = `${n.dataset.label} · ${clockText(Number(n.dataset.since))}`; }, 1000);
/** A crew run's cap, said inside the episode's Claude budget when there is one (the planning approval). */
const capLine = (v, s, each = false) => {
  const plan = v.state.planning && Number(v.state.planning.capUsd);
  return `${each ? 'Each run' : 'This run'}: up to ${dollars(s.budgetUsd)} of Claude${plan ? `, from the episode's ${dollars(plan)}` : ''}.`;
};

/** Episode calls answer { ok, value } or { ok: false, error }. */
async function call(fn, ...args) {
  const r = await fn(...args);
  if (!r || !r.ok) throw new Error((r && r.error) || 'Something went wrong.');
  return r.value;
}

const dollars = (n) => `${(Number(n) || 0).toFixed(2)} US dollars`;
const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const clock = (secs) => `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}`;
const when = (iso) => { try { return new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
const host = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; } };
/** One message at the top of a stage. extra.restore: the refusal of a changed pipeline, with its Restore beside it. */
function flash(dir, stage, text, bad = true, extra = null) {
  if (bad && BUSY.test(String(text))) { text = workingLine(dir); bad = false; } // a second click while it works: not an error
  ep.flash = { dir, stage, text, bad, ...(extra || {}) };
}
// what main says when an episode's work is under way (flow.js, scenecrew.js)
const BUSY = /^(Something is already running for this episode|The scene crews are already at work on this episode|The Live Motion crews are still drawing)\.$/;
/** "Working: 3 of 4 ready." while Live Motion's crews draw, else "Working." */
function workingLine(dir) {
  const v = ep.view && ep.view.dir === dir ? ep.view : null;
  const lm = v && v.livemotion && Array.isArray(v.livemotion.pieces) ? v.livemotion.pieces : [];
  if (!lm.some((p) => p.status === 'running')) return 'Working.';
  return `Working: ${lm.filter((p) => p.status === 'ok' || p.status === 'yours').length} of ${lm.length} ready.`;
}
FLPT_UI.components.busyLine = (dir, text) => (BUSY.test(String(text)) ? workingLine(dir) : null);
// T18: a render or a film of an episode whose pipeline scripts changed is refused with this line (pipeline.js,
// slidebox.js); Restore (flpt.pipeline.restore) puts FLPT's own copy back, free.
const CHANGED = 'This episode\'s pipeline changed.';
const refusedOf = (r) => Boolean(r && (r.refused || (Array.isArray(r.lines) && r.lines.includes(CHANGED)) || r.error === CHANGED));

// ── a small, safe markdown view (text only; links are shown, never followed) ─────────────────────────────────────

function inline(s) {
  const out = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:[^)\s]+)\)|(https?:\/\/[^\s)|]+)/g;
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1] != null) out.push(el('strong', {}, m[1]));
    else if (m[2] != null) out.push(el('code', {}, m[2]));
    else if (m[3] != null) out.push(el('span', { title: m[4] }, m[3], el('span', { class: 'url' }, ` (${host(m[4])})`)));
    else out.push(el('span', { class: 'url', title: m[5] }, m[5]));
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

function md(text) {
  const frag = document.createDocumentFragment();
  let list = null;
  let para = null;
  let table = null;
  let fence = null;
  const close = () => { list = null; para = null; table = null; };
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (fence) { if (/^```/.test(line)) fence = null; else fence.textContent += `${raw}\n`; continue; }
    if (/^```/.test(line)) { close(); fence = el('pre', { class: 'code' }); frag.append(fence); continue; }
    let m;
    if (/^\s*\|.*\|$/.test(line)) {
      const cells = line.trim().slice(1, -1).split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // the header separator
      if (!table) {
        close();
        table = el('table', { class: 'md-table' }, el('tr', {}, ...cells.map((c) => el('th', {}, ...inline(c)))));
        frag.append(el('div', { class: 'table-wrap' }, table));
      } else table.append(el('tr', {}, ...cells.map((c) => el('td', {}, ...inline(c)))));
      continue;
    }
    table = null;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) { close(); frag.append(el(`h${Math.min(6, m[1].length + 2)}`, {}, ...inline(m[2]))); continue; }
    if ((m = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/))) {
      para = null;
      if (!list) { list = el('ul'); frag.append(list); }
      list.append(el('li', {}, ...inline(m[1])));
      continue;
    }
    if ((m = line.match(/^>\s?(.*)$/))) { close(); frag.append(el('blockquote', {}, ...inline(m[1]))); continue; }
    if (!line.trim()) { close(); continue; }
    if (para) { para.append(' ', ...inline(line.trim())); continue; }
    list = null;
    para = el('p', {}, ...inline(line.trim()));
    frag.append(para);
  }
  return frag;
}

// ── home (S2): the episodes as covers ─────────────────────────────────────────────────────────────────────────────
// Each cover is the episode's first slide; focus or hover plays its 5 s loop, cut free from its first approved Live
// Motion piece (covers.js, through flpt.covers), muted, one at a time (app.js plays ambient videos: Pause motion and
// reduced motion keep the still). Without a slide yet, a cover set like a book's: the title in Fraunces on paper, under a
// strip in its lead module's family colour (covers.list's family). The first tile is a new episode.

const NEXT_LABEL = (x) => (x.delivered ? 'Delivered' : `Next: ${x.stageLabel}`);
const FAMILIES = new Set(['data', 'hand', 'build', 'story', 'live']);

/** The covers main has for the episodes listed ({ dir → { png, loop } }); none where there's no flpt.covers. */
async function coversFor(items) {
  if (!flpt.covers || typeof flpt.covers.list !== 'function' || !items.length) return new Map();
  try { return new Map((await call(flpt.covers.list)).map((c) => [c.dir, c])); } catch { return new Map(); }
}

function coverCard(x, cover) {
  const c = cover || {};
  const pic = c.png ? el('img', { src: flpt.fileUrl(c.png, c.pngAt || null), alt: '', loading: 'lazy', draggable: 'false' })
    : el('span', { class: 'poster', 'aria-hidden': 'true', 'data-family': FAMILIES.has(c.family) ? c.family : 'build' }, el('span', { class: 'poster-title', 'data-content': '' }, x.title || ''));
  const box = el('span', { class: 'ep-cover' }, pic, c.loop ? el('span', { class: 'loop-mark hud', 'aria-hidden': 'true' }, '▶') : null);
  const card = el('button', { class: `ep-card${x.tooNew ? ' too-new' : ''}${x.delivered ? ' done' : ''}`, title: x.updatedAt ? when(x.updatedAt) : false, onclick: () => openEpisode(x.dir) },
    box, el('span', { class: 'ep-title', 'data-content': '' }, x.title),
    x.tooNew
      ? el('span', { class: 'ep-meta' }, `${x.minutes ? `${x.minutes} min · ` : ''}`, el('span', { 'data-content': '' }, x.tooNew))
      : el('span', { class: 'ep-meta hud' }, `${x.minutes} min · ${NEXT_LABEL(x)}`));
  if (c.loop) {
    // the loop, on hover or focus: an ambient video while it's there (app.js plays it, one at a time)
    let v = null;
    const start = () => {
      if (v || FLPT_UI.motionHeld()) return;
      v = el('video', { src: flpt.fileUrl(c.loop, c.loopAt || null), muted: true, loop: true, playsinline: true, preload: 'auto', 'aria-hidden': 'true', 'data-ambient': '' });
      v.muted = true; // the attribute alone doesn't mute a video made by script
      v.addEventListener('playing', () => v && v.classList.add('on'));
      box.append(v);
    };
    const stop = () => { if (!v) return; const gone = v; v = null; gone.classList.remove('on'); gone.pause(); setTimeout(() => gone.remove(), 220); };
    card.addEventListener('pointerenter', start);
    card.addEventListener('pointerleave', stop);
    card.addEventListener('focus', start);
    card.addEventListener('blur', stop);
  }
  return card;
}

/** The first required tool that's missing, in one line. */
function missingTool(tools) {
  const t = (tools.tools || []).find((x) => x.required && !x.ok);
  return !t ? 'Setup → Tools needs a look.' : t.id === 'hyperframes' || t.id === 'node' ? 'Live Motion needs HyperFrames.' : `FLPT needs ${t.label}.`;
}

async function renderHome() {
  const box = $('#episode-list');
  const banner = S && !S.settings.setupComplete
    ? el('div', { class: 'banner' }, el('p', { title: 'Episodes need the tools and your keys: Anthropic for the crew, HeyGen for filming.' }, 'Setup isn\'t finished.'),
      el('button', { 'data-view': 'setup' }, 'Finish setup'))
    : session.keyRefused
      ? el('div', { class: 'banner', role: 'status' }, el('p', {}, 'Your Anthropic key was refused.'), el('button', { 'data-view': 'setup', onclick: () => { session.step = 'keys'; } }, 'Setup → Keys'))
      : S && S.keychainAsked && !session.keychainSeen // the first start after an update: why macOS asked, once (then the rest)
        ? el('div', { class: 'banner', role: 'status' }, el('p', {}, 'FLPT was updated, so macOS asked once for your Keychain password.'),
          el('button', { class: 'ghost', onclick: () => { session.keychainSeen = true; renderHome(); } }, 'OK'))
        : S && S.tools && !S.tools.ready // a Setup finished before HyperFrames was required (2.0.0)
          ? el('div', { class: 'banner', role: 'status' }, el('p', {}, missingTool(S.tools)), el('button', { 'data-view': 'setup', onclick: () => { session.step = 'tools'; } }, 'Setup → Tools'))
          : S && S.folders && S.folders.icloud && S.folders.icloud.projects // its offloaded files stop runs (2.0.1)
            ? el('div', { class: 'banner', role: 'status' }, el('p', {}, 'Your episodes are in iCloud Drive, which can stop a run.'), el('button', { 'data-view': 'setup', onclick: () => { session.step = 'folders'; } }, 'Setup → Folders'))
            : null;
  // the first tile: a new episode (the same sheet the empty page opens)
  const fresh = el('button', { type: 'button', class: 'ep-card ep-new', id: 'new-episode-btn', onclick: showIntake },
    el('span', { class: 'ep-cover' }, el('span', { class: 'plus', 'aria-hidden': 'true' }, '+')), el('span', { class: 'ep-title' }, 'New episode'));
  let items;
  try { items = await call(flpt.episodes); } catch (e) {
    box.replaceChildren(...[banner, el('p', { class: 'bad', 'data-content': '' }, e.message), el('div', { class: 'covers' }, fresh)].filter(Boolean));
    return;
  }
  const covers = await coversFor(items);
  // An episode a newer FLPT made says so, in one line, where the next stage would be (W1-03's tooNew).
  const grid = el('div', { class: 'covers fx-stagger' }, fresh, ...items.map((x) => coverCard(x, covers.get(x.dir))));
  const empty = el('button', { type: 'button', class: 'empty', onclick: showIntake },
    el('img', { class: 'vignette', src: 'assets/vignettes/scroll.svg', alt: '' }), el('h3', {}, 'No episodes yet'));
  box.replaceChildren(...[banner, items.length ? grid : empty].filter(Boolean));
}
views.onShow.home = () => { ep.dir = null; clearTimeout(ep.poll); if (FLPT_UI.components.ribbon) FLPT_UI.components.ribbon.clear(FLPT_UI.slots.ribbon); renderHome(); };
// a cover loop that landed after the list was drawn
if (flpt.covers && typeof flpt.covers.onChanged === 'function') flpt.covers.onChanged(() => { if (!$('#home-view').hidden && !$('#intake-sheet').open) renderHome(); });

// ── the New episode sheet (S3): a modal <dialog> over Home ──
// Modal, so nothing behind it takes a click or the focus: a click on its backdrop (outside the sheet) or Esc puts it
// away, as Cancel does; the half-filled form is cleared, never left open out of sight.
function showIntake() {
  const d = $('#intake-sheet');
  $('#intake-note').textContent = '';
  if (!d.open) d.showModal();
  presenterChips();
  $('#intake [name="title"]').focus();
}
function hideIntake() {
  const d = $('#intake-sheet');
  $('#intake').reset();
  if (d.open) d.close();
  intakeFiles = null;
  showIntakeFiles();
  presenterPick = null;
  $('#intake [name="material"]').placeholder = MATERIAL_HINT.idea;
}
$('#intake-cancel').addEventListener('click', hideIntake);
$('#intake-sheet').addEventListener('cancel', (e) => { e.preventDefault(); hideIntake(); }); // Esc
// the backdrop: a press that starts and ends outside the sheet (a drag out of a field doesn't count)
let pressedOut = false;
$('#intake-sheet').addEventListener('pointerdown', (e) => { pressedOut = e.target === e.currentTarget; });
$('#intake-sheet').addEventListener('click', (e) => { if (pressedOut && e.target === e.currentTarget) hideIntake(); pressedOut = false; });
$('#done-new').addEventListener('click', () => setTimeout(showIntake, 0)); // Setup's Done: New episode, straight to the sheet
for (const r of document.querySelectorAll('#intake [name="bring"]')) {
  r.addEventListener('change', () => { $('#intake [name="material"]').placeholder = MATERIAL_HINT[r.value]; });
}
$('#intake [name="material"]').placeholder = MATERIAL_HINT.idea;

// Presenter chips: Setup's choice first and chosen; another one is this episode's own (intake.presenter). The HeyGen
// twin is offered only when it's set up (a look chosen in Setup), so a pick here never makes an episode that can't film.
let presenterPick = null;
async function presenterChips() {
  const box = $('#intake-presenter');
  if (!flpt.presenter || typeof flpt.presenter.options !== 'function') { box.hidden = true; return; }
  let o = null;
  try { o = await call(flpt.presenter.options); } catch { o = null; }
  if (!o) { box.hidden = true; return; }
  const rigs = Array.isArray(o.rigs) ? o.rigs.filter((r) => r && r.id) : [];
  const rig = o.rig || (rigs[0] && rigs[0].id) || null;
  const setupPick = o.kind === 'cartoon' && rig ? `cartoon:${rig}` : 'heygen';
  const opts = [...(o.twin || setupPick === 'heygen' ? [{ id: 'heygen', label: 'HeyGen twin' }] : []), ...rigs.map((r) => ({ id: `cartoon:${r.id}`, label: r.name }))];
  if (opts.length < 2) { box.hidden = true; return; } // nothing to choose between
  const pills = el('span', { class: 'pills' }, ...opts.map((x) => el('label', {},
    el('input', { type: 'radio', name: 'presenter-pick', value: x.id, checked: x.id === setupPick, onchange: () => { presenterPick = x.id === setupPick ? null : x.id; } }),
    el('span', { 'data-content': x.id === 'heygen' ? false : '' }, x.label))));
  box.replaceChildren(el('legend', {}, 'Presenter'), pills);
  box.hidden = false;
}
// Files for a new episode (notes, photos, a story): picked or dropped, held in the main process until it's created.
let intakeFiles = null;
const showIntakeFiles = () => $('#intake-files').replaceChildren(...(intakeFiles ? intakeFiles.files.map((f) => el('span', {}, f.name)) : []));
const takeIntakeFiles = async (stage) => {
  // each pick or drop adds to the ones before (a token each; the episode takes them all)
  try { const s = await stage(); if (s) { intakeFiles = { tokens: [...(intakeFiles ? intakeFiles.tokens : []), s.token], files: [...(intakeFiles ? intakeFiles.files : []), ...s.files] }; showIntakeFiles(); } } catch (err) { $('#intake-note').textContent = err.message; }
};
$('#intake-note').dataset.content = ''; // the main process's messages
$('#intake-attach').addEventListener('click', () => takeIntakeFiles(() => call(flpt.pickFiles)));
dropTarget($('#intake'), (files) => takeIntakeFiles(() => call(flpt.stageDropped, files)));

$('#intake').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const btn = $('#intake-create');
  btn.disabled = true;
  $('#intake-note').textContent = 'Setting up the episode folder…';
  const fields = Object.fromEntries([...new FormData(form).entries()].filter(([k]) => k !== 'presenter-pick'));
  const presenter = presenterPick ? (presenterPick === 'heygen' ? { kind: 'heygen' } : { kind: 'cartoon', rig: presenterPick.slice('cartoon:'.length) }) : null;
  try {
    const dir = await call(flpt.createEpisode, { ...fields, ...(presenter ? { presenter } : {}), staged: intakeFiles ? intakeFiles.tokens : null });
    hideIntake();
    await openEpisode(dir);
  } catch (err) {
    $('#intake-note').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

// ── one episode ────────────────────────────────────────────────────────────────────────────────────────────────

async function openEpisode(dir, stage = null) {
  // keep a message about this episode that arrived while you were elsewhere (a run that finished, say)
  Object.assign(ep, { dir, stage, view: null, flash: ep.flash && ep.flash.dir === dir ? ep.flash : null, seen: '' });
  showView('episode');
  $('#stage-list').replaceChildren();
  $('#episode-cost').textContent = '';
  $('#episode-main').replaceChildren(el('p', { class: 'muted' }, 'Opening…'));
  await refresh();
  $('#episode-main').focus();
}
$('#episode-back').addEventListener('click', () => showView('home'));

async function refresh({ quiet = false } = {}) {
  const dir = ep.dir;
  if (!dir) return;
  let v;
  try { v = await call(flpt.openEpisode, dir); } catch (e) {
    if (ep.dir === dir) $('#episode-main').replaceChildren(el('p', { class: 'bad', 'data-content': '' }, e.message));
    return;
  }
  if (ep.dir !== dir) return; // the user moved on meanwhile
  ep.view = v;
  if (!ep.stage || !v.stages.some((s) => s.id === ep.stage)) ep.stage = v.current;
  // a running film's panel says its phase and its minutes: a new minute draws it again
  const tick = ep.stage === 'film' && statusOf(v, 'film') === 'running' ? Math.floor(Date.now() / 60000) : 0;
  const seen = JSON.stringify([v.state.stages, v.state.animations, v.running, v.slidesAt, v.videoAt, v.draftAt, v.scenes, tick]);
  renderRail();
  if (!quiet || seen !== ep.seen) renderStage();
  ep.seen = seen;
  // A run this window didn't start (or one from before a reload), or a pipeline step it did (Film's phases): keep
  // checking until it ends.
  clearTimeout(ep.poll);
  if ((v.running || ep.busy.has(dir)) && !ep.inflight.has(dir)) ep.poll = setTimeout(() => refresh({ quiet: true }), 4000);
}

function statusOf(v, id) {
  if (ep.inflight.get(v.dir) === id || ep.busy.get(v.dir) === id) return 'running';
  const st = v.state.stages[id].status;
  return st === 'running' && !v.running ? 'interrupted' : st;
}

/** A stage may run only when everything before it is approved (the main process checks this too). */
function canRun(v, id) {
  const ids = v.stages.map((s) => s.id);
  const i = ids.indexOf(id);
  return i > 0 && ids.slice(0, i).every((p) => v.state.stages[p].status === 'approved');
}

function select(id) {
  ep.stage = id;
  ep.flash = null;
  renderRail();
  renderStage();
  $('#episode-main').focus();
}

/** Animate and Scenes are listed only when the deck gives them something to do, or once they've been used. */
function inRail(v, s) {
  const has = s.id === 'animate' ? Boolean((v.animate && v.animate.slides && v.animate.slides.length) || (v.livemotion && v.livemotion.pieces && v.livemotion.pieces.length))
    : s.id === 'scenes' ? Boolean(v.scenes && v.scenes.pieces && v.scenes.pieces.length) : true;
  return has || s.id === ep.stage || ['running', 'review', 'error', 'interrupted'].includes(statusOf(v, s.id));
}

function renderRail() {
  const v = ep.view;
  const marks = (v.jazz && v.jazz.marks) || {};
  // mono step numbers (01…), counted over the stages the rail shows
  $('#stage-list').replaceChildren(...v.stages.filter((s) => inRail(v, s)).map((s, i) => el('li', { class: `st-${statusOf(v, s.id)}` },
    el('button', { 'aria-current': s.id === ep.stage ? 'step' : false, 'data-n': String(i + 1).padStart(2, '0'), onclick: () => select(s.id) },
      el('span', { class: 'dot' }), el('span', { class: 'lbl' }, s.label),
      // the rail's ♪: Jazz approved this stage (view.jazz.marks, W3-03)
      marks[s.id] ? el('span', { class: 'jz', title: 'Jazz', 'aria-label': 'approved by Jazz' }, '♪') : null))));
  const spent = (provider) => (v.state.costs || []).filter((c) => c.provider === provider).reduce((a, c) => a + (Number(c.usd) || 0), 0);
  const spend = v.state.stages.spend;
  const scribe = spent('elevenlabs'); // Scribe, for cutting laughs
  const scenes = v.scenes && v.scenes.spentUsd; // the Scenes step's stills and shots
  // the running tally: what's spent so far, and what's approved for filming (not spent until it films)
  $('#episode-cost').textContent = `Spent on Claude ${money(spent('anthropic'))}${scenes ? `\nScenes ${money(scenes)}` : ''}${spend.status === 'approved' && spend.usd ? `\nHeyGen approved ${money(spend.usd)}` : ''}`
    + `${scribe ? `\nElevenLabs ${money(scribe)}` : ''}`;
  renderJazz(v);
}

/**
 * Jazz in the rail (W3-03's play-through, S5a): while it plays, where it is and Stop; stopped, where and why, with Play
 * on when it can go on. Nothing here starts a crew on its own: a press does, under the plan's approved Claude cap.
 */
function renderJazz(v) {
  const j = v.jazz;
  let box = $('#jazz-box');
  // only its line is a live region (role=status): a refresh re-announces where Jazz is, never the buttons
  if (!box) { box = el('div', { id: 'jazz-box', class: 'jazz-box' }); $('#episode-cost').before(box); }
  if (!j || j.mode !== 'jazz' || !flpt.jazz) { box.hidden = true; return; }
  const label = (id) => { const s = v.stages.find((x) => x.id === id); return s ? s.label : id; };
  const kids = [];
  if (j.running) {
    // where the work is now (Film, pressed while Jazz was on Live Motion), else where Jazz last was
    const now = v.stages.find((s) => statusOf(v, s.id) === 'running');
    kids.push(el('span', { class: 'hud', role: 'status' }, el('span', { class: 'eq', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')), `Jazz · ${label(now ? now.id : j.stage || 'deck')}`),
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'small', onclick: () => jazzDo(v.dir, 'stop') }, 'Stop'),
        el('button', { type: 'button', class: 'ghost small', title: 'Jazz stops after this step, for your review of each one', onclick: () => jazzDo(v.dir, 'everyStep') }, 'Pause after each step')),
      el('p', { class: 'why' }, 'Plays on within your approved budget. Stops before new spending.'));
  } else if (j.canPlay || j.stoppedAt) {
    kids.push(el('div', { role: 'status' }, el('span', { class: 'hud' }, `♪ Jazz${j.stoppedAt ? ` · ${label(j.stoppedAt)}` : ''}`),
      j.why ? el('p', { class: 'why', 'data-content': '', title: j.why }, j.why) : null));
    if (j.canPlay) kids.push(el('div', { class: 'actions' }, el('button', { type: 'button', class: 'primary small', onclick: () => jazzDo(v.dir, 'play') }, 'Play on')));
  }
  box.replaceChildren(...kids);
  box.hidden = !kids.length;
}

async function jazzDo(dir, what) {
  try { await call(flpt.jazz[what], dir); } catch (e) { flash(dir, ep.stage, e.message); }
  if (ep.dir === dir) await refresh();
}
if (flpt.jazz && typeof flpt.jazz.onChanged === 'function') flpt.jazz.onChanged((e) => { if (e && e.dir === ep.dir) refresh({ quiet: true }); });

/** Today's panel for a stage (what a registered panel replaces, and what ctx.fallback() returns). */
function defaultPanel(v, s, rec, status) {
  if (s.kind === 'form') return intakePanel(v);
  if (s.kind === 'agent') return agentPanel(v, s, rec, status);
  if (s.id === 'animate') return animatePanel(v, s, rec, status);
  if (s.id === 'scenes') return scenesPanel(v, rec, status);
  if (s.id === 'spend') return spendPanel(v, rec);
  if (s.id === 'film') return filmPanel(v, rec, status);
  if (s.id === 'refine') return refinePanel(v, rec, status);
  return deliverPanel(v, rec, status);
}

/** What a registered panel (FLPT_UI.panels[stageId]) is handed: the stage's state, and the helpers it acts through. */
function panelContext(v, s, rec, status) {
  return {
    view: v, dir: v.dir, stage: s, record: rec, status, el, md, call, dollars, money, clock,
    canRun: (id = s.id) => canRun(v, id), approve: (id = s.id) => approve(v.dir, id), run: (feedback = '') => run(v.dir, s.id, feedback),
    flash: (text, bad = true) => { flash(v.dir, s.id, text, bad); renderStage(); }, refresh, render: renderStage, select,
    anchor: FLPT_UI.anchor, slot: FLPT_UI.slot, fallback: () => defaultPanel(v, s, rec, status),
    // on to the stage that comes next (after an approval made elsewhere than approve(), e.g. the storyboard's)
    next: () => { ep.stage = null; ep.flash = null; return refresh(); },
  };
}

/** A ribbon segment pressed: the shot's own thing on this stage (its slide on the Deck, its section of the script). */
function selectShot(v, stageId, shot) {
  const main = $('#episode-main');
  if (stageId === 'deck' || stageId === 'animate') {
    const t = main.querySelector(`[data-shot="${CSS.escape(shot.id)}"]`);
    if (t) { t.scrollIntoView({ block: 'center', behavior: FLPT_UI.motionHeld() ? 'auto' : 'smooth' }); t.focus({ preventScroll: true }); }
    return;
  }
  if (stageId === 'script' && shot.n) {
    const ta = main.querySelector('textarea.editor');
    if (!ta) return;
    const m = new RegExp(`^##\\s+SLIDE\\s+${shot.n}\\b.*$`, 'im').exec(ta.value);
    if (!m) return;
    ta.focus();
    ta.setSelectionRange(m.index, m.index + m[0].length);
    const lines = ta.value.slice(0, m.index).split('\n').length - 1;
    ta.scrollTop = Math.max(0, lines * parseFloat(getComputedStyle(ta).lineHeight || '20') - 40);
  }
}

function renderStage() {
  const v = ep.view;
  const s = v.stages.find((x) => x.id === ep.stage);
  const rec = v.state.stages[s.id];
  const status = statusOf(v, s.id);
  const head = [
    el('p', { class: 'kicker', 'data-content': '' }, v.state.title),
    el('div', { class: 'stage-head' }, el('h2', {}, s.label), el('span', { class: `chip st-${status}` }, status === 'approved' && rec.approvedBy === 'jazz' ? 'Approved by Jazz' : s.id === 'storyboard' && status === 'todo' && canRun(v, s.id) ? 'Your choice' : STATUS_TEXT[status] || status)),
  ];
  // Jazz moved on by itself: where it is now, one press away, so this step never looks stuck
  const j = v.jazz;
  const on = j && j.running ? v.stages.find((x) => statusOf(v, x.id) === 'running') || v.stages.find((x) => x.id === j.stage) : null;
  if (status === 'approved' && on && on.id !== s.id) head.push(el('p', { class: 'note' }, '♪ Jazz is on ', el('button', { class: 'linkish', onclick: () => select(on.id) }, on.label), ' now.'));
  const f = ep.flash;
  if (f && f.dir === v.dir && f.stage === s.id) {
    head.push(el('p', { class: `flash${f.bad ? ' bad' : ''}`, role: 'status', 'data-content': f.bad ? '' : false }, f.text,
      f.restore ? restoreButton(v.dir, s.id) : null));
  }
  const panel = Object.prototype.hasOwnProperty.call(FLPT_UI.panels, s.id) ? FLPT_UI.panels[s.id] : null;
  let body;
  let realm = null;
  if (panel) {
    try {
      const out = typeof panel === 'function' ? panel(panelContext(v, s, rec, status)) : panel.render(panelContext(v, s, rec, status));
      body = [].concat(out == null ? [] : out).filter((n) => n != null && n !== false); // `cond && node`
      realm = typeof panel === 'object' && panel.realm ? panel.realm : null;
    } catch (e) {
      console.error(e); // eslint-disable-line no-console
      body = [el('p', { class: 'bad', 'data-content': '' }, `This step's screen failed: ${e.message}`), ...defaultPanel(v, s, rec, status)];
    }
  } else body = defaultPanel(v, s, rec, status);
  const main = $('#episode-main');
  if (!realm && THEATER.has(s.id)) realm = 'theater';
  if (realm) main.dataset.realm = realm; else delete main.dataset.realm;
  // the lights: the whole episode view, its rail and the top bar follow the panel's realm (560 ms, styles.css)
  const view = $('#episode-view');
  if (realm) view.dataset.realm = realm; else delete view.dataset.realm;
  if (realm === 'theater') document.documentElement.dataset.realmView = 'theater'; else delete document.documentElement.dataset.realmView;
  // a new stage (or episode) fades in; a refresh of the same one doesn't move (opacity only: anchored slots stay put)
  const at = `${v.dir}\n${s.id}`;
  if (ep.shownAt !== at) { main.classList.remove('fx-in'); void main.offsetWidth; main.classList.add('fx-in'); }
  ep.shownAt = at;
  // the ribbon, above the panel from the Deck on, in the panel's realm (ui-ribbon.js; the slot outlives every rebuild)
  if (FLPT_UI.components.ribbon && FLPT_UI.slots.ribbon) FLPT_UI.components.ribbon.render(FLPT_UI.slots.ribbon, v, s.id, { realm, select: (shot) => selectShot(v, s.id, shot) });
  main.replaceChildren(...head, ...body);
}

function intakePanel(v) {
  return [el('div', { class: 'md doc', 'data-content': '', title: 'The brief stays as it is once the episode starts.' }, md(v.files.brief || ''))];
}

// ── agent stages ───────────────────────────────────────────────────────────────────────────────────────────────

function hasOutput(v, id) {
  return Boolean({ bullets: v.files.bullets, factcheck: v.files.claims, deck: v.slides.length, script: v.files.script }[id]);
}

function agentPanel(v, s, rec, status) {
  const out = [];
  if (status === 'running') {
    out.push(el('div', { class: 'actions' }, el('button', { title: 'What it spent so far stays spent. Nothing more is.', onclick: () => flpt.cancelStage(v.dir) }, 'Stop the crew'),
      // the record's start once it says running; until then (this window started it) the press's own time
      workingClock('Working…', rec.status === 'running' && rec.startedAt ? since(rec) : ep.started.get(key2(v.dir, s.id)) || since(rec)), el('span', { class: 'muted' }, capLine(v, s))));
    out.push(feedList(ep.feeds.get(key2(v.dir, s.id)) || [{ kind: 'note', text: 'The crew is working.' }], true));
    return out;
  }
  if (status === 'todo') {
    if (!canRun(v, s.id)) { out.push(el('p', { class: 'note' }, 'Waiting on the earlier steps.')); return out; }
    if (s.id === 'deck') out.push(modulesBlock(v));
    out.push(runBox(v, s, false));
    // Fact-check is optional: skipped, the claims go into the deck unchecked
    if (s.id === 'factcheck' && flpt.episode && flpt.episode.skipFactcheck) {
      out.push(el('div', { class: 'actions' }, el('button', { class: 'ghost small', onclick: async () => {
        try { await call(flpt.episode.skipFactcheck, v.dir); ep.stage = null; } catch (e) { flash(v.dir, s.id, e.message); }
        await refresh();
      } }, 'Skip'), el('span', { class: 'muted' }, 'The claims go into the deck unchecked.')));
    }
    return out;
  }
  if (status === 'error' || status === 'interrupted') out.push(el('p', { class: 'bad', 'data-content': rec.error ? '' : false }, rec.error || 'The run stopped before it finished (the app may have closed).'));
  if (status === 'stale') out.push(el('p', { class: 'note' }, 'An earlier step changed after this was approved.'));
  if (hasOutput(v, s.id)) out.push(...outputOf(v, s, rec));
  if (rec.report) {
    out.push(el('details', { class: 'report', open: status === 'review' }, el('summary', {}, 'The crew\'s report'), el('div', { class: 'md', 'data-content': '' }, md(rec.report))));
  }
  // the crew asked something: answer it here, and Approve carries it to every later crew (answers.md)
  const answers = status === 'review' && rec.report && /\?/.test(rec.report) && flpt.episode && flpt.episode.answer
    ? el('textarea', { class: 'notes answers', rows: '3', 'aria-label': 'Your answers', placeholder: 'Your answers to its questions (optional). The next crews read them.' }) : null;
  if (answers) out.push(answers);
  const acts = [];
  if (status === 'review') acts.push(el('button', { class: 'primary', onclick: () => approve(v.dir, s.id, answers ? answers.value : '') }, 'Approve and continue'));
  if (status === 'stale' && canRun(v, s.id)) acts.push(el('button', { class: 'primary', onclick: () => approve(v.dir, s.id) }, 'Keep this version'));
  // A finished deck: bring a photo or a clip straight into a new call (it opens under "Ask for changes").
  if (s.id === 'deck' && canRun(v, s.id)) acts.push(el('button', { onclick: () => stageForCall(v.dir) }, 'Add a photo or clip'));
  if (rec.costUsd != null) acts.push(el('span', { class: 'muted' }, `Last run: ${dollars(rec.costUsd)} of Claude usage.`));
  if (acts.length) out.push(el('div', { class: 'actions' }, ...acts));
  if (canRun(v, s.id)) {
    const again = status === 'error' || status === 'interrupted';
    // a failed run that left its work (a deck whose check stopped): the work leads, Run it again waits closed under it
    out.push(el('details', { class: 'revise', open: (again && !hasOutput(v, s.id)) || (s.id === 'deck' && ep.openCalls === v.dir) },
      el('summary', {}, again ? 'Run it again' : 'Ask for changes'), s.id === 'deck' ? modulesBlock(v) : null, runBox(v, s, true)));
  }
  const feed = ep.feeds.get(key2(v.dir, s.id));
  if (feed && feed.length) out.push(el('details', { class: 'past' }, el('summary', {}, 'What the crew did on the last run'), feedList(feed, false)));
  return out;
}

/**
 * Bullets as a document (S4): each slide's Module: line becomes a chip in its module's family colour (main reads the
 * line as the storyboard does: view.planview.chips), and Edit shows the file itself. Unsaved edits keep the file open.
 */
function bulletsView(v) {
  const k = key2(v.dir, 'bullets');
  const editing = ep.bulletsEdit.has(v.dir) || ep.drafts.has(k);
  const chips = (v.planview && v.planview.chips) || [];
  const toggle = el('button', { type: 'button', class: 'ghost small doc-edit', 'aria-pressed': String(editing), disabled: editing && ep.drafts.has(k),
    onclick: () => { if (editing) ep.bulletsEdit.delete(v.dir); else ep.bulletsEdit.add(v.dir); renderStage(); } }, 'Edit');
  if (editing) return [el('div', { class: 'doc-head' }, toggle), editor(v, 'bullets')];
  // the chips are the crew's first suggestions (a strawman): the Storyboard settles them
  const lead = chips.length ? el('span', { class: 'muted doc-lead' }, 'Modules and visuals: the crew\'s first suggestions. The Storyboard settles them.') : null;
  return [el('div', { class: 'doc-head' }, lead, toggle), bulletsDoc(v.files.bullets || '', chips)];
}

/** bullets.md as a doc, its Module: lines as chips (the sections the storyboard reads; others render as they are). */
function bulletsDoc(text, chips) {
  const box = el('div', { class: 'md doc bullets-doc', 'data-content': '' });
  if (!chips.length) { box.append(md(text)); return box; }
  let buf = [];
  let n = 0;
  let inSlide = false;
  let used = false;
  const flush = () => { if (buf.length) box.append(md(buf.join('\n'))); buf = []; };
  const plain = (s) => s.replace(/(\*\*|__|`)/g, '').replace(/\s+/g, ' ').trim();
  for (const line of String(text).split(/\r?\n/)) {
    const hd = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (hd) {
      if (hd[1].length === 2 && /^slide\b/i.test(hd[2].trim())) { n += 1; inSlide = true; used = false; } else if (hd[1].length <= 2) inSlide = false;
      buf.push(line);
      continue;
    }
    const mod = inSlide && /^\s*(?:[-*•+]\s+)?(?:\*\*|__)?\s*(module|visual)\s*(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(.*)$/i.exec(line);
    const c = chips[n - 1];
    if (mod && c && !used && plain(mod[2]) === c.line) {
      used = true;
      flush();
      box.append(el('p', { class: 'mod-line' },
        c.module ? el('span', { class: 'mod-chip hud', 'data-family': c.family }, c.tile) : null,
        c.between ? el('span', { class: 'mod-chip hud', 'data-family': c.between === 'cutscene' ? 'story' : 'live' }, c.between === 'cutscene' ? 'Cut scene' : 'Solo ♪') : null,
        el('span', { class: 'mod-text' }, plain(mod[2]))));
      continue;
    }
    buf.push(line);
  }
  flush();
  return box;
}

function outputOf(v, s, rec) {
  if (s.id === 'bullets') return bulletsView(v);
  if (s.id === 'factcheck') {
    return [el('div', { class: 'md doc', 'data-content': '' }, md(v.files.claims)),
      el('p', { class: 'muted' }, el('button', { class: 'linkish', title: 'The fact-check corrects bullets.md in place.', onclick: () => select('bullets') }, 'See the bullets'))];
  }
  if (s.id === 'deck') return deckOutput(v, rec);
  if (s.id === 'script') return scriptOutput(v);
  return [];
}

function runBox(v, s, revise) {
  const notes = revise ? el('textarea', { class: 'notes', rows: '4', 'aria-label': 'Notes for the crew', placeholder: NOTES_HINT[s.id] }) : null;
  const start = el('button', { class: revise ? '' : 'primary', onclick: () => run(v.dir, s.id, notes ? notes.value.trim() : '') },
    revise ? 'Run again with these notes' : `Start the ${s.label.toLowerCase()} crew`);
  return el('div', { class: 'runbox' }, notes, el('div', { class: 'actions' }, start, el('span', { class: 'muted' }, capLine(v, s, true))));
}

async function run(dir, stage, feedback) {
  if (ep.inflight.has(dir) || ep.busy.has(dir)) return;
  const unsaved = [...ep.drafts.keys()].filter((k) => k.startsWith(`${dir}\n`));
  if (unsaved.length && !window.confirm('You have unsaved edits in this episode. Discard them and start the crew?')) return;
  for (const k of unsaved) ep.drafts.delete(k); // the crew is about to rewrite the files
  ep.inflight.set(dir, stage);
  ep.started.set(key2(dir, stage), Date.now());
  ep.feeds.set(key2(dir, stage), [{ kind: 'note', text: 'Starting the crew…' }]);
  ep.flash = null;
  if (ep.dir === dir) { renderRail(); renderStage(); }
  try {
    const r = await call(flpt.runStage, dir, stage, feedback);
    if (r && r.cancelled) flash(dir, stage, 'Not approved, so nothing ran and nothing was spent.', false);
    else if (r && !r.ok) {
      if (r.keyRefused) keyRefused(true);
      if (!r.error) flash(dir, stage, 'The crew stopped before finishing.'); // else the stage says it, once
    }
    else if (r) flash(dir, stage, `Done, for ${dollars(r.costUsd)}.`, false);
  } catch (e) {
    flash(dir, stage, e.message);
  } finally {
    ep.inflight.delete(dir);
    if (ep.dir === dir) await refresh();
  }
}

async function approve(dir, stage, answers = '') {
  try {
    if (answers.trim()) await call(flpt.episode.answer, dir, stage, answers.trim());
    await call(flpt.approveStage, dir, stage);
    ep.stage = null; // on to the next stage
    ep.flash = null;
  } catch (e) {
    flash(dir, stage, e.message);
  }
  await refresh();
}

function editor(v, which) {
  const k = key2(v.dir, which);
  const saved = v.files[which] || '';
  const dirty = ep.drafts.has(k);
  const ta = el('textarea', { class: 'editor', 'aria-label': FILE_NAME[which], spellcheck: 'false', title: 'The next steps read this file.' });
  ta.value = dirty ? ep.drafts.get(k) : saved;
  const msg = el('span', { class: 'muted' }, dirty ? 'Unsaved edits.' : '');
  const save = el('button', { class: 'primary', disabled: !dirty }, 'Save edits');
  const discard = el('button', { class: 'ghost', disabled: !dirty }, 'Discard edits');
  ta.addEventListener('input', () => {
    const d = ta.value !== saved;
    if (d) ep.drafts.set(k, ta.value); else ep.drafts.delete(k);
    save.disabled = !d;
    discard.disabled = !d;
    msg.textContent = d ? 'Unsaved edits.' : '';
  });
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      ep.view = await call(flpt.saveEpisodeFile, v.dir, which, ta.value);
      ep.drafts.delete(k);
      const stale = ep.view.stages.filter((s) => ep.view.state.stages[s.id].status === 'stale').map((s) => s.label);
      flash(v.dir, ep.stage, `Saved. The next steps use your edits.${stale.length ? ` Out of date now: ${stale.join(', ')}.` : ''}`, false);
      renderRail();
      renderStage();
    } catch (e) {
      msg.textContent = e.message;
      save.disabled = false;
    }
  });
  discard.addEventListener('click', () => { ep.drafts.delete(k); renderStage(); });
  return el('div', { class: 'editor-box' },
    el('div', { class: 'editor-head' }, el('span', {}, 'Make your edits below.'), el('code', { title: 'The file in the episode folder' }, FILE_NAME[which])),
    ta, el('div', { class: 'actions' }, save, discard, msg));
}

// ── the nine modules and the user's calls (the Deck step) ──────────────────────────────────────────────────────

const BADGE = { chart: 'Chart', sketch: 'Hand-drawn', motion: 'Motion', cosmos: 'Cosmos', inset: 'Inset', infographic: 'Infographic', cutscene: 'Cut scene', 'motion-solo': 'Solo', 'motion-duet': 'Duet' };
const NO_BUBBLE = new Set(['cosmos', 'motion-solo']); // modules.META: the slides narrated with the bubble hidden

/** done, brief written, or waiting (the crew hasn't handled it yet); null before the first deck run. */
function callStatus(v, c) {
  const m = v.modules;
  if (!m) return null;
  const hit = [...Object.values(m.slides || {}), ...(m.cutscenes || [])].find((x) => x && x.call === c.id);
  if (!hit) return 'waiting';
  return hit.brief ? 'brief written' : 'done';
}

function modulesBlock(v) {
  const editable = ep.inflight.get(v.dir) !== 'deck' && v.state.stages.deck.status !== 'running';
  const form = el('div', { class: 'call-form', hidden: true });
  // the shared nine-module picker (ui-modules.js): a tile makes the call yourself (no Title card: it's never a call)
  const grid = el('div', { class: 'module-picker-host', title: 'The crew picks the modules. A tile makes the call yourself.' });
  if (FLPT_UI.components.modulePicker) {
    FLPT_UI.components.modulePicker(grid, { catalog: v.catalog, titleCard: false, compact: true, disabled: !editable, episode: v.dir, label: 'Modules', onPick: (id) => openForm(id) });
  } else {
    grid.className = 'module-grid';
    grid.append(...v.catalog.map((m) => el('button', { class: 'module', disabled: !editable, onclick: () => openForm(m.id) }, el('b', {}, m.name), el('span', {}, m.short))));
  }
  /** The call form, for a module; with files (staged in the main process) it starts from the likely module and asks. */
  function openForm(moduleId, staged = null, lib = null) {
    const pick = el('select', { 'aria-label': 'Module' }, ...v.catalog.map((m) => el('option', { value: m.id, selected: m.id === moduleId }, m.name)));
    const slide = el('select', { 'aria-label': 'Which slide' }, el('option', { value: '' }, 'Wherever it fits'),
      ...v.slideTitles.map((t) => el('option', { value: String(t.n), 'data-content': '' }, `Slide ${t.n}: ${t.title}`)));
    const ask = el('textarea', { rows: '2', 'aria-label': 'What should it do?' });
    const mod = () => v.catalog.find((m) => m.id === pick.value);
    let edited = false;
    const fill = () => { ask.placeholder = mod().ask; if ((staged || lib) && !edited) ask.value = mod().withFile || ''; };
    ask.addEventListener('input', () => { edited = true; });
    pick.addEventListener('change', fill);
    fill();
    const add = el('button', { class: 'primary' }, 'Add');
    add.addEventListener('click', () => updateCalls(v.dir, async () => {
      const made = await call(flpt.addCall, v.dir, { module: pick.value, slide: slide.value || null, ask: ask.value, staged: staged && staged.token });
      const c = lib && made.calls[made.calls.length - 1]; // a Library item goes on the call just made
      if (!c) return made;
      try { return await call(flpt.attachLibraryItem, v.dir, c.id, lib.id); } catch (e) { await call(flpt.removeCall, v.dir, c.id).catch(() => {}); throw e; }
    }));
    form.replaceChildren(el('div', { class: 'call-form-head' }, pick, slide), ask,
      staged ? el('div', { class: 'staged' }, ...staged.files.map((f) => el('span', {}, f.name))) : null,
      lib ? el('div', { class: 'staged' }, el('span', { 'data-content': '' }, lib.title)) : null,
      el('div', { class: 'actions' }, add, el('button', { class: 'ghost', onclick: () => { form.hidden = true; } }, 'Cancel')));
    form.hidden = false;
    ask.focus();
  }
  const fromFiles = async (stage) => {
    try { const s = await stage(); if (s) openForm(s.guess, s); } catch (e) { flash(v.dir, 'deck', e.message); renderStage(); }
  };
  const box = el('section', { class: 'modules', 'aria-label': 'Modules' },
    el('div', { class: 'modules-head' },
      el('p', {}, el('b', {}, 'Modules')),
      el('span', { class: 'modules-add' },
        el('button', { class: 'ghost small', disabled: !editable, onclick: () => libraryPicker({}, (it) => openForm(null, null, it)) }, 'From the Library'),
        el('button', { class: 'ghost small', disabled: !editable, onclick: () => fromFiles(() => call(flpt.pickFiles)) }, 'Add a photo or clip'))),
    grid, form,
    v.calls.length ? el('ul', { class: 'calls' }, ...v.calls.map((c) => callRow(v, c, editable))) : null);
  if (editable) dropTarget(box, (files) => fromFiles(() => call(flpt.stageDropped, files)));
  if (editable && ep.staged && ep.staged.dir === v.dir) {
    const s = ep.staged;
    ep.staged = null;
    setTimeout(() => { openForm(s.guess, s); form.scrollIntoView({ block: 'center' }); });
  }
  return box;
}

/** Pick files for a new call from outside the module block: open "Ask for changes" with the call form ready. */
async function stageForCall(dir) {
  try {
    const s = await call(flpt.pickFiles);
    if (!s) return;
    ep.staged = { ...s, dir };
    ep.openCalls = dir;
    renderStage();
  } catch (e) { flash(dir, 'deck', e.message); renderStage(); }
}

/** Let a node take dropped files (it's outlined while they hover). */
function dropTarget(node, onFiles) {
  const has = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  node.addEventListener('dragover', (e) => { if (!has(e)) return; e.preventDefault(); e.stopPropagation(); node.classList.add('drop'); });
  node.addEventListener('dragleave', (e) => { if (!node.contains(e.relatedTarget)) node.classList.remove('drop'); });
  node.addEventListener('drop', (e) => {
    if (!has(e)) return;
    e.preventDefault();
    e.stopPropagation();
    node.classList.remove('drop');
    if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
  });
}

function callRow(v, c, editable) {
  const m = v.catalog.find((x) => x.id === c.module);
  const status = callStatus(v, c);
  const atts = (c.attachments || []).map((a) => (a.kind === 'image'
    ? el('img', { class: 'att', src: flpt.fileUrl(`${v.dir}/presentation/${a.path}`), alt: a.name, title: a.name })
    : el('span', { class: 'att-name', title: a.url || a.name }, a.name)));
  const link = el('input', { type: 'url', placeholder: 'https://', 'aria-label': 'A link for this call' });
  const linkRow = el('div', { class: 'link-row', hidden: true }, link,
    el('button', { onclick: () => updateCalls(v.dir, () => call(flpt.addCallLink, v.dir, c.id, link.value)) }, 'Add'));
  const row = el('li', {},
    el('div', { class: 'call-main' },
      el('div', {}, el('b', {}, m ? m.name : c.module), c.slide ? el('span', { class: 'muted' }, ` · slide ${c.slide}`) : null,
        status ? el('span', { class: `call-status s-${status.replace(/ /g, '-')}` }, status) : null),
      el('p', { 'data-content': '' }, c.ask), atts.length ? el('div', { class: 'atts', 'data-content': '' }, ...atts) : null, linkRow),
    editable ? el('div', { class: 'call-actions' },
      el('button', { class: 'linkish', onclick: () => updateCalls(v.dir, () => call(flpt.attachToCall, v.dir, c.id)) }, 'Attach'),
      el('button', { class: 'linkish', onclick: () => pickFromLibrary(v.dir, c.id) }, 'Library'),
      el('button', { class: 'linkish', onclick: () => { linkRow.hidden = false; link.focus(); } }, 'Link'),
      el('button', { class: 'linkish', onclick: () => { if (window.confirm('Remove this call and its files?')) updateCalls(v.dir, () => call(flpt.removeCall, v.dir, c.id)); } }, 'Remove')) : null);
  if (editable) dropTarget(row, (files) => updateCalls(v.dir, () => call(flpt.dropOnCall, v.dir, c.id, files)));
  return row;
}

/** Pick something from the Library for a call: a small searchable grid; clicking an item attaches it. */
function pickFromLibrary(dir, callId) {
  libraryPicker({}, (it) => updateCalls(dir, () => call(flpt.attachLibraryItem, dir, callId, it.id)));
}

/** A small searchable grid of the Library (filtered, e.g. { kind: 'clip' }); clicking an item hands it to onPick. */
function libraryPicker(filters, onPick) {
  const dlg = el('dialog', { class: 'lib-pick', 'aria-label': 'Pick from your Library' });
  const search = el('input', { type: 'search', placeholder: 'Search your Library', 'aria-label': 'Search your Library' });
  const grid = el('div', { class: 'lib-pick-grid' });
  const close = () => { dlg.close(); dlg.remove(); };
  let seq = 0;
  const load = async () => {
    const mine = ++seq;
    let items = [];
    try { items = (await call(flpt.library.list, search.value.trim(), filters || {})).items || []; } catch (e) { grid.replaceChildren(el('p', { class: 'bad', 'data-content': '' }, e.message)); return; }
    if (mine !== seq) return;
    grid.replaceChildren(...(items.length ? items.slice(0, 60).map((it) => el('button', { class: 'lib-pick-item', title: it.title, onclick: () => { close(); onPick(it); } },
      it.thumbPath ? el('img', { src: flpt.fileUrl(it.thumbPath, it.updatedAt), alt: '' }) : el('span', { class: 'ph' }, it.kind),
      el('span', { 'data-content': '' }, it.title))) : [el('p', { class: 'muted' }, search.value.trim() ? 'Nothing matches.' : (filters && filters.kind === 'clip' ? 'No clips in your Library yet.' : 'Your Library is empty.'))]));
  };
  let t = null;
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 180); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  dlg.addEventListener('cancel', () => dlg.remove());
  dlg.append(el('div', { class: 'lib-pick-head' }, search, el('button', { class: 'ghost small', onclick: close }, 'Close')), grid);
  document.body.append(dlg);
  dlg.showModal();
  search.focus();
  load();
}

/** Run one change to the calls, then show the result (keeping "Ask for changes" open). */
async function updateCalls(dir, fn) {
  try { ep.view = await fn(); } catch (e) { flash(dir, 'deck', e.message); }
  ep.openCalls = dir;
  if (ep.dir === dir) { renderRail(); renderStage(); }
}

/** The deck crew built another module than the plan's: one line on the thumbnail, the whole of it (and why) in its tooltip. */
function crewChange(n, shot) {
  const text = `${String(n).padStart(2, '0')} · ${shot.changed.from} → ${shot.changed.to}`;
  return el('span', { class: 'crew-change hud', title: shot.reason ? `${text}: ${shot.reason}` : text }, text);
}

function deckOutput(v, rec) {
  const out = [];
  if (Array.isArray(rec.qa)) {
    out.push(rec.qa.length
      ? el('div', { class: 'qa' }, el('strong', {}, `Layout check: ${rec.qa.length} problem${rec.qa.length === 1 ? '' : 's'} left`),
        el('ul', { 'data-content': '' }, ...rec.qa.slice(0, 40).map((q) => el('li', {}, q))))
      : el('p', { class: 'ok' }, 'Layout check: clean.'));
  }
  const zone = el('input', { type: 'checkbox', checked: true });
  // The made cartoons and cut scenes show here as their clips; a cut scene not made yet is a placeholder between its slides.
  const pieces = (v.scenes && v.scenes.pieces) || [];
  const cuts = (n) => pieces.filter((c) => c.kind === 'cutscene' && c.afterN === n).map((c) => cutThumb(c));
  const pv = v.planview || null;
  // the slides narrated without the bubble: main's list (motion.hiddenBubbleSlides), else the modules that hide it
  const hidden = pv && Array.isArray(pv.hiddenBubble) ? new Set(pv.hiddenBubble) : null;
  const shotAt = new Map(((pv && pv.ribbon && pv.ribbon.shots) || []).filter((x) => x.n).map((x) => [x.n, x]));
  const familyOf = (m) => (m === 'statement' ? 'build' : ((v.catalog || []).find((c) => c.id === m) || {}).family || null);
  // Scenes between slides drawn in code (a Solo ♪, a code cut scene): slim dashed placeholders in the gap after their slide.
  const map = v.modules || {};
  const betweens = [...(Array.isArray(map.jsscenes) ? map.jsscenes : []).map((x) => ({ ...x, kind: 'solo' })),
    ...(Array.isArray(map.cutscenes) ? map.cutscenes : []).filter((x) => x && x.make === 'code').map((x) => ({ ...x, kind: 'cut' }))].filter((x) => x && typeof x === 'object');
  const between = (after, n) => betweens.filter((x) => (x.after || '') === after && !(x.kind === 'cut' && pieces.some((c) => c.kind === 'cutscene' && c.afterN === n)))
    .map((x) => el('span', { class: `thumb ph-between${x.kind === 'cut' ? ' ph-cut' : ''}`, 'data-shot': x.shot || '', tabindex: '-1', title: x.title || '' },
      el('span', { class: 'ph-label hud' }, x.kind === 'cut' ? 'Cut' : `♪ ${x.id || ''}`.trim())));
  const grid = el('div', { class: `thumbs show-zone${pv ? ' deck-flow' : ''}` }, ...between('', 0), ...cuts(0), ...v.slides.flatMap((p, i) => {
    const n = i + 1;
    const mod = v.modules && v.modules.slides && v.modules.slides[v.deckOrder[i]];
    const badge = mod && BADGE[mod.module];
    const live = Boolean(mod && (mod.module === 'motion-solo' || mod.module === 'motion-duet'));
    const noZone = hidden ? hidden.has(n) : Boolean(mod && (NO_BUBBLE.has(mod.module) || mod.bubble === false));
    const shot = shotAt.get(n);
    const toon = pieces.find((c) => c.kind === 'cartoon' && c.n === n && c.clip);
    const poster = toon && (toon.tiles.find((t) => t.slot === 'hero' && t.poster) || toon.tiles.find((t) => /^beat/.test(t.slot) && t.file) || {});
    const thumb = el('button', { class: `thumb${noZone ? ' no-zone' : ''}${toon ? ' has-clip' : ''}${live ? ' live' : ''}`, 'aria-label': `Slide ${n}${badge ? `, ${badge}` : ''}, larger`,
      'data-shot': shot ? shot.id : false, 'data-family': mod ? familyOf(mod.module) : false,
      onclick: () => (toon ? playClip(toon.clip, toon.clipAt, `Slide ${n} · ${toon.title}`) : zoom(v.slides, i, v.slidesAt)) },
      el('img', { src: toon && (poster.poster || poster.file) ? flpt.fileUrl(poster.poster || poster.file) : flpt.fileUrl(p, v.slidesAt), alt: '', loading: 'lazy' }),
      el('span', { class: 'n' }, String(n)), badge ? el('span', { class: `mod-badge${live ? ' live hud' : ''}`, title: !toon && pieces.some((c) => c.kind === 'cartoon' && c.n === n) ? 'Its cartoon is made in Scenes. Till then, its title card.' : false }, toon ? `${badge} ▶` : pieces.some((c) => c.kind === 'cartoon' && c.n === n) ? `${badge} · in Scenes` : badge) : null,
      // the deck crew built another module than the plan's: shown, not hidden (its reason in the tooltip and the report)
      shot && shot.changed ? crewChange(n, shot) : null);
    return [thumb, ...between(v.deckOrder[i], n), ...cuts(n)];
  }));
  if (pv) fitThumbs(grid, betweens.length > 0);
  zone.addEventListener('change', () => grid.classList.toggle('show-zone', zone.checked));
  out.push(el('label', { class: 'toggle' }, zone, ' Show where the presenter\'s bubble goes'), grid);
  return out;
}

/**
 * The Deck's thumbnails in flowing rows (deck-flow, so a scene between slides sits in its gap) all one width: as many
 * as fit at 230 px or more, with room kept in each row for one slim placeholder when the deck has any. Without it a
 * lone thumbnail on the last row would stretch wider than the rows above.
 */
function fitThumbs(grid, roomForOne) {
  const MIN = 230;
  const fit = () => {
    const w = grid.clientWidth;
    if (!w) return;
    const gap = parseFloat(getComputedStyle(grid).columnGap) || 12;
    const room = roomForOne ? 36 + gap : 0;
    const n = Math.max(1, Math.floor((w - room + gap) / (MIN + gap)));
    grid.style.setProperty('--thumb-w', `${Math.floor((w - room - gap * (n - 1)) / n)}px`);
  };
  if (typeof ResizeObserver === 'function') new ResizeObserver(fit).observe(grid);
  requestAnimationFrame(fit);
}

function zoom(list, i, ver) {
  const d = $('#zoom');
  let n = i;
  const show = () => {
    $('#zoom-img').src = flpt.fileUrl(list[n], ver);
    $('#zoom-cap').textContent = `Slide ${n + 1} of ${list.length}`;
    $('#zoom-cap').title = '← →, Esc';
  };
  d.onkeydown = (e) => {
    if (e.key === 'ArrowRight' && n < list.length - 1) { n += 1; show(); }
    if (e.key === 'ArrowLeft' && n > 0) { n -= 1; show(); }
  };
  show();
  d.showModal();
}
$('#zoom').addEventListener('click', (e) => { if (e.target.id === 'zoom' || e.target.id === 'zoom-close') $('#zoom').close(); });

function scriptOutput(v) {
  const out = [];
  const secs = v.estimateSeconds;
  const target = v.state.intake.minutes * 60;
  const rb = v.planview && v.planview.ribbon;
  if (rb && rb.script) {
    // S7: the plan against the script, in one mono line; each Live Motion slide's beat cues, red where the script misses one
    out.push(el('p', { class: 'plan-line hud' }, FLPT_UI.words(rb.script)));
    if (rb.cues && rb.cues.length) {
      out.push(el('div', { class: 'cues', 'aria-label': 'Cues' }, el('p', { class: 'muted cues-lead' }, 'Cues: the words each moving scene\'s beats land on.'), ...rb.cues.map((c) => el('div', { class: 'cue-row' },
        el('span', { class: 'cue-where hud' }, `${String(c.n).padStart(2, '0')} · ${c.tile}`),
        ...c.cues.map((x) => el('span', { class: `cue${x.found ? '' : ' missing'}`, title: x.found ? 'In the script' : 'Not in the script', 'data-content': '' }, x.cue))))));
    }
  } else if (secs) {
    const pct = Math.round((100 * (secs - target)) / target);
    out.push(el('p', { class: Math.abs(pct) > 15 ? 'bad' : 'muted' },
      `About ${clock(secs)} of narration, against a target of ${clock(target)} (${pct >= 0 ? '+' : ''}${pct} %).`));
  }
  out.push(editor(v, 'script'));
  return out;
}

function feedItem(ev) {
  // the animators work on several slides at once: each line says whose it is
  const who = ev.slide ? el('b', { class: 'f-slide' }, `${ev.slide} `) : null;
  if (ev.kind === 'note') return el('li', { class: 'f-note' }, who, ev.text);
  if (ev.kind === 'init') return el('li', { class: 'f-note' }, who, `The ${ev.slide ? 'animator' : 'crew'} is ready (${ev.model || 'Claude'}${ev.skills && ev.skills.length ? `, with the method's ${ev.skills.length} skills` : ''}).`);
  // the crew's own words: its tables, lists and bold drawn as the report is, never as raw markdown
  if (ev.kind === 'text') return /^\s*\||\*\*|^#{1,6}\s|^\s*[-*]\s/m.test(ev.text || '') ? el('li', { class: 'f-text md', 'data-content': '' }, who, md(ev.text)) : el('li', { class: 'f-text', 'data-content': '' }, who, ev.text);
  if (ev.kind === 'tool') {
    const d = ev.detail && ev.detail.includes('/skills/') ? `the method: ${ev.detail.split('/').pop()}` : ev.detail;
    return el('li', { class: 'f-tool' }, who, TOOL_LABEL[ev.name] || ev.name, d ? el('code', { 'data-content': '' }, d) : null);
  }
  if (ev.kind === 'result') {
    return el('li', { class: ev.ok ? 'f-ok' : 'f-bad' }, who, ev.ok ? `Done in ${ev.turns} turns, for ${dollars(ev.costUsd)}.` : `Stopped: ${RESULT_TEXT[ev.subtype] || ev.subtype}.`);
  }
  if (ev.kind === 'done') return el('li', { class: ev.ok ? 'f-ok' : 'f-bad' }, who, ev.ok ? 'Animated.' : 'Didn\'t finish.');
  return null;
}

function feedList(events, live) {
  const ol = el('ol', live ? { class: 'feed', id: 'live-feed', 'aria-live': 'polite' } : { class: 'feed' }, ...events.map(feedItem).filter(Boolean));
  if (live) requestAnimationFrame(() => { ol.scrollTop = ol.scrollHeight; });
  return ol;
}

flpt.onAgent((ev) => {
  const k = key2(ev.dir, ev.stage);
  const list = ep.feeds.get(k) || [];
  list.push(ev);
  if (list.length > 600) list.splice(0, list.length - 600);
  ep.feeds.set(k, list);
  if (ep.dir !== ev.dir || ep.stage !== ev.stage) return;
  if (ev.kind === 'done') { refresh({ quiet: true }); return; } // one animator finished: its card shows it
  const ol = document.getElementById('live-feed');
  const item = feedItem(ev);
  if (!ol || !item) return;
  const atEnd = ol.scrollHeight - ol.scrollTop - ol.clientHeight < 48;
  ol.append(item);
  if (atEnd) ol.scrollTop = ol.scrollHeight;
});

// ── animate: the animator crew ─────────────────────────────────────────────────────────────────────────────────

/** One marked slide's state on the Animate step, as its chip says it. */
function animationState(v, a) {
  if (a.theirs) return ['Yours', 'st-approved'];
  if (a.status === 'running') return ep.inflight.get(v.dir) === 'animate' || v.running ? ['Working…', 'st-running'] : ['Interrupted', 'st-interrupted'];
  if (a.made) return a.outdated ? ['Out of date', 'st-stale'] : ['Animated', 'st-review'];
  if (a.status === 'error') return ['Didn\'t finish', 'st-error'];
  return [null, ''];
}

/** A larger look at one animation, with its controls. */
function playAnimation(a, ver) {
  const dlg = el('dialog', { class: 'zoom', 'aria-label': `Slide ${a.n}` });
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.append(el('video', { class: 'zoom-video', src: flpt.fileUrl(a.preview, ver), controls: true, autoplay: true, playsinline: true }),
    el('p', { class: 'zoom-cap' }, el('span', {}, `Slide ${a.n}`), el('button', { type: 'button', class: 'ghost small', onclick: close }, 'Close')));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  dlg.addEventListener('cancel', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

// ── scenes: the cartoons and cut scenes ───────────────────────────────────────────────────────────────────────
// The main process decides every step and its price (scenes.js), asks in its own dialog and runs it through the broker
// (generate.js); this shows the pieces, their stills and shots, and asks.

const PIECE_KIND = { cartoon: 'Cartoon', cutscene: 'Cut scene' };
const priced = (usd, guess) => `${guess ? '~' : ''}${money(usd)}`;

/** One button's work: a step, an approval, a re-roll. A paid step waits for the dialog; the stills and shots land later. */
async function sceneDo(dir, act) {
  if (ep.sceneBusy) return;
  ep.sceneBusy = `${act.key}\n${act.action}\n${act.slot || ''}`;
  if (ep.dir === dir) renderStage();
  try {
    const r = await call(flpt.sceneAction, dir, act);
    if (r && r.cancelled) flash(dir, 'scenes', 'Not approved. Nothing was spent.', false);
    else if (r && r.failed && r.failed.length) flash(dir, 'scenes', r.failed[0]);
    else ep.flash = null;
  } catch (e) {
    flash(dir, 'scenes', e.message);
  } finally {
    ep.sceneBusy = null;
    if (ep.dir === dir) await refresh();
  }
}

function scenesPanel(v, rec, status) {
  if (!canRun(v, 'scenes') && status !== 'approved') return [el('p', { class: 'note' }, 'Waiting on the script.')];
  const sc = v.scenes || { pieces: [] };
  const out = [];
  if (!sc.pieces.length) out.push(el('p', { class: 'muted' }, 'No cartoons or cut scenes in this deck.'));
  else out.push(el('p', { class: 'muted' }, 'Small paid steps, each approved first. Or drawn in code, free.'));
  for (const p of sc.pieces) out.push(sceneCard(v, p, sc));
  if (status !== 'approved') {
    // one left unmade shows its title card in the film: said before Approve, never found in the film
    const unmade = sc.pieces.filter((p) => !p.clip);
    if (unmade.length) out.push(el('p', { class: 'note', 'data-content': '' }, `Not made yet: ${unmade.map((p) => (p.kind === 'cartoon' ? `slide ${p.n}` : p.title)).join(', ')}. The film shows a title card there.`));
    out.push(el('div', { class: 'actions' }, el('button', { class: 'primary', disabled: sc.working > 0 || Boolean(sc.assembling) || Boolean(ep.sceneBusy), onclick: () => approve(v.dir, 'scenes') }, 'Approve and continue')));
  }
  return out;
}

function sceneCard(v, p, sc) {
  const busy = Boolean(ep.sceneBusy) || ep.busy.has(v.dir) || ep.inflight.has(v.dir);
  const where = p.kind === 'cartoon' ? `Slide ${p.n}` : p.afterN ? `After slide ${p.afterN}` : 'Before slide 1';
  // Until it's made: what the whole piece comes to, as planned.
  const total = p.total != null && !p.clip && !p.tiles.some((t) => t.takes) ? ` · about ${priced(p.total, p.totalGuess)} in all` : '';
  const parts = [el('div', { class: 'scene-head' }, el('span', { class: 'addon-kind' }, PIECE_KIND[p.kind]), el('span', { class: 'scene-title', title: p.title, 'data-content': '' }, p.title),
    el('span', { class: 'muted' }, `${where}${total}`))];
  if (p.clip) parts.push(el('video', { class: 'scene-clip', controls: true, preload: 'metadata', src: flpt.fileUrl(p.clip, p.clipAt) }));
  parts.push(el('div', { class: 'scene-tiles' }, ...p.tiles.map((t) => sceneTile(v, p, t))));
  if (p.problems.length) parts.push(el('p', { class: 'muted', 'data-content': '' }, p.problems[0]));
  if (p.error) parts.push(el('p', { class: 'bad', 'data-content': '' }, p.error));
  const acts = [];
  const mine = (action) => ep.sceneBusy === `${p.key}\n${action}\n`;
  if (p.next && p.next.keyMissing) {
    acts.push(el('span', { class: 'muted' }, `No ${p.next.name} key · `, el('button', { class: 'linkish', onclick: () => { showView('setup'); go('keys'); } }, 'Setup → Keys'))); // eslint-disable-line no-undef
  } else if (p.next && sc.canMake) {
    acts.push(el('button', { class: 'primary', disabled: busy, onclick: () => sceneDo(v.dir, { key: p.key, action: 'make' }) },
      mine('make') ? 'Starting…' : `${p.next.label} · ${priced(p.next.usd, p.next.guess)}`));
  }
  if (sc.assembling === p.key) acts.push(el('span', { class: 'muted' }, 'Putting it together…'));
  else if (p.ready && p.outdated) acts.push(el('button', { disabled: busy, onclick: () => sceneDo(v.dir, { key: p.key, action: 'assemble' }) }, 'Put it together'));
  // S9: a Generated piece can be drawn in code instead (Live Motion, free apart from Claude); the deck stays as it is
  if (!p.clip && p.drawable !== false && flpt.livemotion && typeof flpt.livemotion.drawInCode === 'function') {
    acts.push(el('button', { class: 'ghost', disabled: busy, title: 'Moves it to Live Motion. The deck stays as it is.', onclick: () => drawInCode(v.dir, p) }, 'Draw it in code'));
  }
  if (acts.length) parts.push(el('div', { class: 'actions' }, ...acts));
  return el('section', { class: 'scene', 'data-key': p.key }, ...parts);
}

/**
 * Draw a Generated piece in code (W2-02's livemotion.drawInCode), by its Scenes key: cartoon:<slide id> for a Cosmos
 * (slide:<id> in Live Motion), cutscene:<id> for a cut scene (between:C<id> there, numbered as code cut scenes are).
 */
async function drawInCode(dir, p) {
  const key = p.key;
  try {
    await call(flpt.livemotion.drawInCode, dir, key);
    flash(dir, 'scenes', `${PIECE_KIND[p.kind] || 'It'}: drawn in code now, in Live Motion.`, false);
  } catch (e) { flash(dir, 'scenes', e.message); }
  if (ep.dir === dir) await refresh();
}

const MARK = { review: '●', approved: '✓', failed: '!', skipped: '—' };

function sceneTile(v, p, t) {
  const pic = t.kind === 'video' ? t.poster : t.file;
  return el('button', {
    class: `scene-tile s-${t.status}${t.kind === 'video' ? ' is-video' : ''}`, 'data-slot': t.slot, title: t.error || t.about || '', disabled: !pic && !t.file,
    'aria-label': `${t.label}: ${t.status}`, onclick: () => scenePreview(v, p, t),
  },
  pic ? el('img', { src: flpt.fileUrl(pic), alt: '' }) : el('span', { class: 'ph' }, t.status === 'working' ? '' : 'Not made yet'),
  el('span', { class: 'tile-label' }, t.kind === 'video' && t.file ? `▶ ${t.label}` : t.label),
  MARK[t.status] ? el('span', { class: 'tile-mark' }, MARK[t.status]) : null,
  t.status === 'working' ? el('span', { class: 'tile-progress' }, '…') : null);
}

/** A still or a shot, large, with what can be done with it: approve it, make it again, or leave the hero still. */
function scenePreview(v, p, t) {
  const dlg = el('dialog', { class: 'zoom scene-zoom', 'aria-label': `${PIECE_KIND[p.kind]}: ${t.label}` });
  const close = () => { dlg.close(); dlg.remove(); };
  const act = (action, label, primary = false) => el('button', { class: primary ? 'primary small' : 'ghost small', onclick: () => { close(); sceneDo(v.dir, { key: p.key, action, slot: t.slot }); } }, label);
  const media = t.kind === 'video' && t.file ? el('video', { src: flpt.fileUrl(t.file), controls: true, autoplay: true, loop: true, playsinline: true })
    : el('img', { src: flpt.fileUrl(t.file || t.poster), alt: '' });
  const acts = [];
  if (t.status === 'review') acts.push(act('approve', 'Approve', true));
  if (t.again != null) acts.push(act('reroll', `Again · ${money(t.again)}`));
  if (t.slot === 'hero' && p.canSkip && !p.skipHero && t.status !== 'working') acts.push(act('skip', 'Leave it still'));
  if (t.animate != null) acts.push(act('animate', `Animate it · ${money(t.animate)}`, t.status === 'skipped'));
  const what = t.kind === 'video' ? (t.final ? '1080p' : t.draft ? '480p draft' : '') : '';
  dlg.append(media, el('p', { class: 'zoom-cap' }, el('span', { 'data-content': '' }, `${p.title} · ${t.label}${what ? ` · ${what}` : ''}${t.error ? ` · ${t.error}` : ''}`),
    el('span', { class: 'zoom-acts' }, ...acts, el('button', { class: 'ghost small', onclick: close }, 'Close'))));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  dlg.addEventListener('cancel', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

function animateCard(v, a) {
  const [label, cls] = animationState(v, a);
  const media = a.preview
    ? el('video', { src: flpt.fileUrl(a.preview, a.previewAt), poster: a.picture ? flpt.fileUrl(a.picture, v.slidesAt) : null, muted: true, loop: true, playsinline: true, preload: 'auto', 'data-ambient': '' }) // app.js plays it on screen (Pause motion)
    : a.picture ? el('img', { src: flpt.fileUrl(a.picture, v.slidesAt), alt: '' }) : el('span', { class: 'ph' });
  const thumb = el('button', { class: 'thumb', 'aria-label': `Slide ${a.n}${a.preview ? ', play it larger' : ''}`, disabled: !a.preview, onclick: () => playAnimation(a, a.previewAt) },
    media, el('span', { class: 'n' }, String(a.n)), label ? el('span', { class: `chip ${cls}` }, label) : null);
  if (media.tagName === 'VIDEO') media.muted = true; // the attribute alone doesn't mute a video made by script
  return el('div', { class: 'anim-card', title: a.error || a.note || '' }, thumb, el('p', { class: 'muted', title: a.brief, 'data-content': '' }, a.brief));
}

/** Run the animators: all the marked slides, or one, with notes. */
async function animate(dir, opts = {}) {
  if (ep.inflight.has(dir) || ep.busy.has(dir)) return;
  ep.inflight.set(dir, 'animate');
  ep.feeds.set(key2(dir, 'animate'), [{ kind: 'note', text: 'Starting the animators…' }]);
  ep.flash = null;
  if (ep.dir === dir) { renderRail(); renderStage(); }
  try {
    const r = await call(flpt.animate, dir, opts);
    if (r && r.cancelled) flash(dir, 'animate', 'Not approved, so nothing ran and nothing was spent.', false);
    else if (r && !r.ok) flash(dir, 'animate', r.error || 'The animators stopped before finishing.');
    else if (r) flash(dir, 'animate', `Done, for ${dollars(r.costUsd)}.`, false);
  } catch (e) {
    flash(dir, 'animate', e.message);
  } finally {
    ep.inflight.delete(dir);
    if (ep.dir === dir) await refresh();
  }
}

function animatePanel(v, s, rec, status) {
  const a = v.animate || { slides: [] };
  const cap = dollars(a.perSlideUsd || s.budgetUsd);
  if (!canRun(v, 'animate') && status !== 'approved') return [el('p', { class: 'note' }, 'Waiting on the script.')];
  if (!a.slides.length) {
    return [el('p', { class: 'note' }, 'No slide is marked for an animation of its own.'),
      status !== 'approved' ? el('div', { class: 'actions' }, el('button', { class: 'primary', onclick: () => approve(v.dir, 'animate') }, 'Continue')) : null].filter(Boolean);
  }
  const out = [el('div', { class: 'thumbs anims' }, ...a.slides.map((x) => animateCard(v, x)))];
  const todo = a.slides.filter((x) => !x.theirs);
  if (status === 'running') {
    out.push(el('div', { class: 'actions' }, el('button', { onclick: () => flpt.cancelStage(v.dir) }, 'Stop the animators'),
      el('span', { class: 'muted' }, `Capped at ${cap} each.`)));
    out.push(feedList(ep.feeds.get(key2(v.dir, 'animate')) || [{ kind: 'note', text: 'The animators are working.' }], true));
    return out;
  }
  if (status === 'error' || status === 'interrupted') out.push(el('p', { class: 'bad', 'data-content': rec.error ? '' : false }, rec.error || 'The run stopped before it finished (the app may have closed).'));
  if (status === 'stale') out.push(el('p', { class: 'note' }, 'An earlier step changed after this was approved.'));
  if (!a.available) out.push(el('p', { class: 'note' }, 'Animations need HyperFrames (Setup → Tools).'));
  const made = a.slides.some((x) => x.made);
  const reports = a.slides.filter((x) => x.report);
  if (reports.length) {
    out.push(el('details', { class: 'report', open: status === 'review' && reports.length === 1 }, el('summary', {}, 'The animators\' reports'),
      el('div', { class: 'md', 'data-content': '' }, ...reports.flatMap((x) => [el('h4', {}, `Slide ${x.n}`), md(x.report)]))));
  }
  const acts = [];
  if (status === 'todo' && todo.length && a.available) {
    acts.push(el('button', { class: 'primary', onclick: () => animate(v.dir) }, `Animate ${todo.length === 1 ? 'the slide' : `${todo.length} slides`}`),
      el('span', { class: 'muted' }, `Up to ${cap} of Claude usage each.`));
  }
  if (status !== 'approved' && status !== 'todo') acts.push(el('button', { class: 'primary', onclick: () => approve(v.dir, 'animate') }, made ? 'Approve and continue' : 'Continue without them'));
  if (status === 'todo') acts.push(el('button', { class: 'ghost', onclick: () => approve(v.dir, 'animate') }, 'Skip'));
  if (rec.costUsd != null && status !== 'todo') acts.push(el('span', { class: 'muted' }, `Last run: ${dollars(rec.costUsd)} of Claude usage.`));
  if (acts.length) out.push(el('div', { class: 'actions' }, ...acts));
  if (status !== 'todo' && todo.length && a.available) {
    const pick = el('select', { 'aria-label': 'Which slides' }, el('option', { value: '' }, todo.length === 1 ? `Slide ${todo[0].n}` : 'Every marked slide'),
      ...(todo.length > 1 ? todo.map((x) => el('option', { value: String(x.n) }, `Slide ${x.n}`)) : []));
    const notes = el('textarea', { class: 'notes', rows: '3', 'aria-label': 'Notes for the animators', placeholder: 'What should change? For example: "Draw the chest bigger".' });
    out.push(el('details', { class: 'revise', open: status === 'error' },
      el('summary', {}, status === 'error' ? 'Run it again' : 'Ask for changes'),
      el('div', { class: 'runbox' }, el('div', { class: 'call-form-head' }, pick), notes,
        el('div', { class: 'actions' }, el('button', { onclick: () => animate(v.dir, { slide: pick.value ? Number(pick.value) : null, feedback: notes.value.trim() }) }, 'Run again with these notes'),
          el('span', { class: 'muted' }, `Each slide is capped at ${cap} of Claude usage.`)))));
  }
  const feed = ep.feeds.get(key2(v.dir, 'animate'));
  if (feed && feed.length) out.push(el('details', { class: 'past' }, el('summary', {}, 'What the animators did on the last run'), feedList(feed, false)));
  return out;
}

/** A cartoon's or cut scene's clip, playing large. */
function playClip(file, ver, caption) {
  const dlg = el('dialog', { class: 'zoom scene-zoom' });
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.append(el('video', { src: flpt.fileUrl(file, ver), controls: true, autoplay: true }),
    el('p', { class: 'zoom-cap' }, el('span', {}, caption), el('button', { class: 'ghost small', onclick: close }, 'Close')));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  dlg.addEventListener('cancel', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

/** A cut scene among the Deck's thumbnails: its clip once made (it plays), else a placeholder between its slides. */
function cutThumb(c) {
  const poster = (c.tiles.find((t) => t.slot === 'start1' && t.file) || {}).file;
  return el('button', { class: `thumb cut no-zone${c.clip ? ' has-clip' : ''}`, 'aria-label': `Cut scene: ${c.title}`, disabled: !c.clip,
    onclick: () => playClip(c.clip, c.clipAt, `Cut scene · ${c.title}`) },
  c.clip && poster ? el('img', { src: flpt.fileUrl(poster), alt: '', loading: 'lazy' }) : el('span', { class: 'cut-ph', 'data-content': '' }, c.title),
  el('span', { class: 'mod-badge' }, c.clip ? 'Cut scene ▶' : 'Cut scene'));
}

// Progress on a still or shot on its way, and a refresh when one lands (or a piece is put together).
flpt.onGenerate((ev) => {
  if (!ev || ev.kind !== 'scene' || ev.dir !== ep.dir) return;
  if (ev.phase === 'done' || ev.phase === 'failed') { if (ep.stage === 'scenes' || ev.phase === 'failed') refresh(); return; }
  const tile = document.querySelector(`.scene[data-key="${CSS.escape(ev.key || '')}"] .scene-tile[data-slot="${CSS.escape(ev.slot || '')}"] .tile-progress`);
  if (tile) tile.textContent = ev.phase === 'running' && ev.progress != null ? `${Math.round(ev.progress * 100)} %` : ev.phase === 'running' && ev.elapsed ? clock(ev.elapsed) : '…';
});
flpt.onScenes((ev) => { if (ev && ev.dir === ep.dir) refresh(); });

// ── spend, film, deliver ───────────────────────────────────────────────────────────────────────────────────────

async function pipelineStep(dir, what, fn, done) {
  if (ep.inflight.has(dir) || ep.busy.has(dir)) return;
  const stage = { draft: 'spend', slack: 'deliver' }[what] || what;
  ep.busy.set(dir, what);
  ep.flash = null;
  if (ep.dir === dir) { renderRail(); renderStage(); }
  // its record moves while it runs (Film's phase, the Jazz box): read it again until it ends (refresh's poll)
  setTimeout(() => { if (ep.busy.get(dir) === what && ep.dir === dir) refresh({ quiet: true }); }, 1500);
  try {
    const r = await call(fn, dir);
    if (r && r.ok) flash(dir, stage, done(r), false);
    else if (r && r.cancelled) { if (what !== 'slack') flash(dir, stage, 'Not approved. Nothing was spent.', false); }
    else if (refusedOf(r)) { ep.restored.delete(dir); flash(dir, stage, CHANGED, true, { restore: true }); }
    else flash(dir, stage, (r && r.error) || 'That didn\'t finish. The log has the details.');
  } catch (e) {
    flash(dir, stage, e.message);
  } finally {
    ep.busy.delete(dir);
    if (ep.dir === dir) await refresh();
  }
}

async function approveSpend(dir, then) {
  try {
    const r = await call(flpt.approveSpend, dir);
    if (r.cancelled) flash(dir, 'spend', 'Not approved. Nothing was spent.', false);
    else ep.stage = then;
  } catch (e) {
    flash(dir, 'spend', e.message);
  }
  await refresh();
}

/** Restore (free, T18): FLPT's own pipeline put back into the episode; a retry then needs no second yes. */
function restoreButton(dir, stage) {
  const b = el('button', { type: 'button', class: 'small restore', title: 'Puts FLPT\'s own pipeline back. Free. Anything else is set aside, not deleted.', onclick: async () => {
    b.disabled = true;
    try {
      const r = await call(flpt.pipeline.restore, dir);
      const n = r.restored.length;
      const aside = r.setAside.length ? `; ${r.setAside.length} set aside` : '';
      if (r.ok) ep.restored.add(dir);
      flash(dir, stage, r.ok ? `Restored ${n} file${n === 1 ? '' : 's'}${aside}.` : (r.error || 'Restore didn\'t finish.'), !r.ok);
    } catch (e) { flash(dir, stage, e.message); }
    if (ep.dir === dir) { ep.seen = ''; await refresh(); }
  } }, 'Restore');
  return b;
}

function videoBlock(file, ver, small = false, poster = null) {
  return [
    el('div', { class: `film-frame${small ? ' small' : ''}` }, el('video', { class: 'player', controls: true, preload: 'metadata', poster, src: flpt.fileUrl(file, ver) })),
    el('div', { class: 'actions' }, el('button', { class: 'ghost small', onclick: () => flpt.openFile(file) }, 'Open in your video player'),
      el('button', { class: 'ghost small', onclick: () => flpt.revealFile(file) }, 'Show in Finder')),
  ];
}

/** What the last splice of the run's pieces between slides said (view.splice[which], W2-03): pieces, notes, an error. */
function spliceLines(v, which) {
  const sp = v.splice && v.splice[which];
  if (!sp || (!sp.pieces && !sp.error && !(sp.notes || []).length)) return [];
  const out = [];
  if (sp.error) out.push(el('p', { class: 'splice-line bad', 'data-content': '' }, sp.error));
  else if (sp.pieces) {
    // where they are ("after slide 6"), and one press to Live Motion, where they're made
    const at = ((v.livemotion && v.livemotion.pieces) || []).filter((p) => p.placement === 'between' && p.afterN).map((p) => p.afterN);
    const where = at.length === sp.pieces ? ` (after slide${at.length > 1 ? 's' : ''} ${at.join(', ')})` : '';
    out.push(el('p', { class: 'splice-line' }, el('button', { class: 'linkish', title: 'Live Motion', onclick: () => select('animate') },
      `${sp.pieces} piece${sp.pieces === 1 ? '' : 's'} between slides${where}`)));
  }
  if ((sp.notes || []).length) out.push(el('ul', { class: 'splice-notes', 'data-content': '' }, ...sp.notes.slice(0, 6).map((n) => el('li', {}, n))));
  return out;
}

/** S10's Generate $ chips: each Cosmos or cut scene the Jazz plan drew in code, generated instead at its price (W3-03). */
function upgradeChips(v) {
  const ups = (v.jazz && Array.isArray(v.jazz.upgrades) ? v.jazz.upgrades : []).filter((u) => u && u.shot);
  if (!ups.length || !flpt.jazz || typeof flpt.jazz.upgrade !== 'function') return null;
  const kind = (m) => (m === 'cutscene' ? 'Cut scene' : 'Cosmos');
  return el('div', { class: 'upgrades', 'aria-label': 'Drawn in code' }, el('span', { class: 'hud' }, 'In code'),
    ...ups.map((u) => el('button', { type: 'button', class: 'money', title: `${kind(u.module)}${u.title ? ` · ${u.title}` : ''}: generated at Scenes`,
      onclick: async () => {
        try {
          const r = await call(flpt.jazz.upgrade, v.dir, u.shot);
          flash(v.dir, 'scenes', `${kind(u.module)}: generated at Scenes${r && r.usd != null ? `, about ${money(r.usd)}` : ''}.`, false);
          ep.stage = 'scenes';
        } catch (e) { flash(v.dir, 'spend', e.message); }
        if (ep.dir === v.dir) await refresh();
      } }, el('span', { 'data-content': '' }, u.title || kind(u.module)), el('b', {}, u.usd != null ? `Generate ${money(u.usd)}` : 'Generate $'))));
}

function spendPanel(v, rec) {
  if (!canRun(v, 'spend') && rec.status !== 'approved') {
    return [el('p', { class: 'note' }, v.state.stages.script.status === 'approved' && v.state.stages.scenes ? 'Waiting on Scenes.' : 'Waiting on the script.')];
  }
  const box = el('div', { class: 'estimate' }, el('p', { class: 'muted' }, 'Working out the estimate…'));
  call(flpt.spendEstimate, v.dir).then((est) => {
    const rows = est.lines.map((l) => el('tr', {}, el('td', { 'data-content': '' }, l.label), el('td', { class: 'num secs' }, `${Math.round(l.qty)} s`), el('td', { class: 'num' }, money(l.usd))));
    const live = v.budgets.film || v.budgets.heygen; // any film budget (HeyGen, or a cartoon's ElevenLabs or Fish voice)
    const heygen = Boolean(est.byProvider && est.byProvider.heygen && est.byProvider.heygen.usd > 0);
    // Every clip already filmed (the pipeline counted what isn't): nothing to pay, so nothing to approve.
    const nothing = !est.totalUsd && est.film && est.film.nothing;
    const status = rec.status === 'approved'
      ? el('p', { class: live || v.freeFilm ? 'ok' : 'muted' }, live ? `Approved: about ${dollars(rec.usd)}, plus up to 15 % for re-takes.`
        : v.freeFilm ? 'Nothing to pay: every clip is already filmed.' : 'Approved earlier and used by a filming run.')
      : null;
    box.replaceChildren(
      el('table', { class: 'est' }, el('tbody', {}, ...rows, el('tr', { class: 'total' }, el('td', {}, 'Total'), el('td'), el('td', { class: 'num' }, money(est.totalUsd))))),
      heygen ? el('p', { class: 'muted', title: 'Nothing else is charged. Claude planning was approved separately.' }, 'HeyGen: about 4.1 cents a second, plus up to 15 % for re-takes.') : null,
      ...[status].filter(Boolean),
      el('div', { class: 'actions' }, rec.status === 'approved'
        ? el('button', { class: live || v.freeFilm ? 'primary' : '', onclick: () => select('film') }, 'Go to Film')
        : el('button', { class: 'primary', onclick: () => approveSpend(v.dir, 'film') }, nothing ? 'Nothing to pay: continue' : `Approve ${dollars(est.totalUsd)}…`)));
  }).catch((e) => box.replaceChildren(el('p', { class: 'bad', 'data-content': '' }, e.message)));
  return [el('div', { class: 'spend' }, box, draftSection(v))];
}

function draftSection(v) {
  const busy = ep.busy.get(v.dir) === 'draft';
  const kids = [el('div', { class: 'draft-head' }, el('h3', {}, 'Free draft'),
    el('span', { class: 'hud muted', title: 'The slides and the script in the Mac\'s own voice, to check them before filming.' }, 'Optional · Mac voice · free'))];
  if (v.draft && !busy) kids.push(el('video', { class: 'player', controls: true, preload: 'metadata', src: flpt.fileUrl(v.draft, v.draftAt), 'aria-label': 'The free draft' }));
  else kids.push(el('div', { class: 'screen-ph' }, busy ? el('span', { class: 'hud' }, 'Making the draft…') : el('img', { class: 'vignette', src: 'assets/vignettes/reel.svg', alt: '' })));
  kids.push(...spliceLines(v, 'draft'));
  kids.push(el('div', { class: 'actions' },
    el('button', { class: v.draft ? 'ghost small' : 'primary', disabled: busy || ep.busy.has(v.dir), onclick: () => pipelineStep(v.dir, 'draft', flpt.draft, () => 'The free draft is ready.') },
      busy ? 'Making…' : (v.draft ? 'Make again' : 'Make the free draft')),
    v.draft && !busy ? el('button', { class: 'ghost small', onclick: () => flpt.revealFile(v.draft) }, 'Show in Finder') : null));
  const up = upgradeChips(v);
  if (up) kids.push(up);
  return el('section', { class: 'draft', 'data-realm': 'theater' }, ...kids);
}

function filmPanel(v, rec, status) {
  const out = [];
  const spend = v.state.stages.spend;
  if (status === 'running') {
    // the phase it's in, and for how long (flow.film writes them as they happen): never a frozen "Filming…"
    return [el('p', { class: 'note', role: 'status' }, workingClock(rec.phase || 'Filming…', rec.phaseAt ? since({ at: rec.phaseAt }) : since(rec))),
      el('p', { class: 'muted' }, 'Stop keeps the clips already filmed. Filming again reuses them.')];
  }
  if (status === 'error' && rec.error === CHANGED) {
    // refused before anything was spent (the approval is kept): Restore, then Film it again
    out.push(ep.restored.has(v.dir) ? el('p', { class: 'ok' }, 'Restored.') : el('p', { class: 'bad' }, CHANGED, ' ', restoreButton(v.dir, 'film')));
  } else if (status === 'error' || status === 'interrupted') out.push(el('p', { class: 'bad', 'data-content': rec.error ? '' : false }, rec.error || 'Filming was interrupted.'));
  if (v.video) {
    out.push(el('div', { class: 'film-frame' }, el('video', { class: 'player', controls: true, preload: 'metadata', poster: posterOf(v), src: flpt.fileUrl(v.video, v.videoAt), 'aria-label': 'The film' })));
    out.push(...spliceLines(v, 'film'));
    out.push(el('div', { class: 'actions' }, status === 'review' ? el('button', { class: 'primary', onclick: () => approve(v.dir, 'film') }, 'Approve the film') : null,
      el('button', { class: 'ghost small', onclick: () => flpt.openFile(v.video) }, 'Open in your video player'), el('button', { class: 'ghost small', onclick: () => flpt.revealFile(v.video) }, 'Show in Finder')));
  } else if (status === 'review') out.push(el('div', { class: 'actions' }, el('button', { class: 'primary', onclick: () => approve(v.dir, 'film') }, 'Approve the film')));
  if (!canRun(v, 'film')) {
    if (status !== 'approved') out.push(el('p', { class: 'note' }, spend.status === 'approved' ? 'Waiting on the earlier steps.' : 'Waiting on the spend.'));
    return out;
  }
  if (v.budgets.film || v.budgets.heygen || v.freeFilm) {
    out.push(el('div', { class: 'actions' },
      el('button', { class: v.video ? '' : 'primary', onclick: () => pipelineStep(v.dir, 'film', flpt.film, () => 'Filmed.') }, v.video ? 'Film again' : 'Film it'),
      el('span', { class: 'muted' }, v.freeFilm ? 'Nothing to pay: every clip is already filmed.' : `Budget: ${dollars(spend.usd)}, plus up to 15 % for re-takes.`)));
  } else {
    out.push(el('div', { class: 'actions' },
      el('button', { class: v.video ? '' : 'primary', onclick: () => approveSpend(v.dir, 'film') }, v.video ? 'Film again: approve a new budget…' : 'Approve a new budget…'),
      el('span', { class: 'muted' }, 'Each filming run needs its own approval.')));
  }
  return out;
}

/** The film's poster: its first slide (a frame of the film before it plays). */
const posterOf = (v) => (v.slides && v.slides.length ? flpt.fileUrl(v.slides[0], v.slidesAt) : null);

/**
 * Deliver (S11): a moment. The finished film in its Theater frame, the pony trotting off beside it with where it went
 * and Show in Finder, what went out as chips, Captions; the Slack pack after it, quieter.
 */
function deliverPanel(v, rec, status) {
  if (status === 'running') return [el('p', { class: 'note' }, 'Delivering…')];
  const out = [];
  if (status === 'error' || status === 'interrupted') out.push(el('p', { class: 'bad', 'data-content': rec.error ? '' : false }, rec.error || 'Delivery was interrupted.'));
  if (rec.playerOk === false) out.push(el('p', { class: 'bad' }, 'The player page didn\'t build. The rest is there.'));
  const can = canRun(v, 'deliver');
  if (!can && !rec.folder) {
    out.push(el('p', { class: 'note' }, v.state.stages.film.status === 'approved' ? 'Waiting on Refine.' : 'Waiting on the film.'));
    return out;
  }
  const film = (v.refine && v.refine.video) ? [v.refine.video, v.refine.videoAt] : v.video ? [v.video, v.videoAt] : null;
  const frame = film ? el('div', { class: 'film-frame', 'data-realm': 'theater' },
    el('video', { class: 'player', controls: true, preload: 'metadata', poster: posterOf(v), src: flpt.fileUrl(film[0], film[1]), 'aria-label': 'The film' })) : null;
  const again = can ? el('button', { class: rec.folder ? 'ghost small' : 'primary', onclick: () => pipelineStep(v.dir, 'deliver', flpt.deliver, () => 'Delivered.') },
    rec.folder ? 'Deliver again' : 'Deliver') : null;
  const side = rec.folder
    ? el('div', { class: 'deliver-side delivered' },
      el('img', { class: 'vignette', src: 'assets/vignettes/trotting-pony.svg', alt: '' }),
      el('h3', {}, status === 'stale' ? 'Delivered, before the latest change' : 'Delivered'),
      el('p', { class: 'where', 'data-content': '', title: rec.folder }, rec.folder),
      // inside the delivery, the video selected (a folder alone would be shown from the folder above it)
      el('div', { class: 'actions' }, el('button', { class: 'primary', onclick: () => flpt.revealFile(rec.video || rec.folder) }, 'Show in Finder')),
      el('div', { class: 'deliver-opts' }, deliverOptions(v), again))
    : el('div', { class: 'deliver-side' },
      el('div', { class: 'actions' }, again),
      el('div', { class: 'deliver-opts' }, deliverOptions(v)));
  out.push(el('section', { class: 'deliver-moment' }, frame, side));
  // what goes out (or went out): the files, as chips
  const caps = v.deliverOptions && v.deliverOptions.captions;
  const files = [`video${v.refine && v.refine.video ? (v.refine.addons.length ? ' with your add-ons' : ', tightened') : ''}`, 'CapCut master', 'script', caps ? 'captions' : null, 'player page'].filter(Boolean);
  out.push(el('ul', { class: 'deliver-files hud', 'aria-label': 'Files' }, ...files.map((f) => el('li', { class: rec.folder ? 'made' : '' }, f))));
  if (rec.folder) out.push(slackSection(v, rec));
  return out;
}

/** Deliver's choices: Captions (an SRT beside the video, free; W2-03's flpt.delivery). */
function deliverOptions(v) {
  if (!flpt.delivery || typeof flpt.delivery.captions !== 'function') return null;
  const on = Boolean(v.deliverOptions && v.deliverOptions.captions);
  const input = el('input', { type: 'checkbox', checked: on, disabled: ep.busy.has(v.dir) });
  input.addEventListener('change', async () => {
    input.disabled = true;
    try { await call(flpt.delivery.captions, v.dir, input.checked); } catch (e) { flash(v.dir, 'deliver', e.message); }
    if (ep.dir === v.dir) await refresh();
  });
  return el('label', { class: 'toggle', title: 'An SRT beside the video, from the script and its word times. Free.' }, input, ' Captions');
}
if (flpt.delivery && typeof flpt.delivery.onChanged === 'function') flpt.delivery.onChanged((e) => { if (e && e.dir === ep.dir) refresh({ quiet: true }); });

/** The Slack pack, made from the user's own export after their edit: pick it, or drop it here. */
function slackSection(v, rec) {
  const busy = ep.busy.get(v.dir) === 'slack';
  const done = () => 'Slack pack ready.';
  const pack = rec.slack && (rec.slack.files || []).length ? rec.slack : null;
  const box = el('section', { class: 'slack' }, el('h3', { class: 'hud' }, 'Slack pack'),
    pack ? el('ul', { class: 'slack-files', 'data-content': '' }, ...pack.files.map((f) => el('li', {}, f))) : null,
    el('div', { class: 'actions' }, el('button', { class: 'ghost small', disabled: busy || ep.busy.has(v.dir), title: 'The video you exported from CapCut after your edit', onclick: () => pipelineStep(v.dir, 'slack', flpt.slackPick, done) },
      busy ? 'Making the Slack pack…' : pack ? 'From a new CapCut export…' : 'From your CapCut export…'),
    // no edit of your own: the delivered video as it is
    !busy && flpt.episode && flpt.episode.slackDelivered ? el('button', { class: 'ghost small', disabled: ep.busy.has(v.dir), onclick: () => pipelineStep(v.dir, 'slack', flpt.episode.slackDelivered, done) }, 'From the delivered video') : null));
  if (!ep.busy.has(v.dir)) dropTarget(box, (files) => pipelineStep(v.dir, 'slack', (dir) => flpt.slackDrop(dir, files), done));
  return box;
}

// ── refine: add-ons on the finished film ───────────────────────────────────────────────────────────────────────

const ADDON_KIND = { clip: 'Clip', transition: 'Transition', music: 'Music', broll: 'B-roll' };
const ADDON_TIP = { clip: 'A video of yours, placed between slides', transition: 'A short move from one slide to the next', music: 'A music bed under the voice', broll: 'Generated footage over a slide' };

/** Run one change to the add-ons, then show the result. */
async function updateAddons(dir, fn) {
  try { ep.view = await fn(); ep.addonForm = null; } catch (e) { flash(dir, 'refine', e.message); }
  if (ep.dir === dir) { renderRail(); renderStage(); }
}

function refinePanel(v, rec, status) {
  if (status === 'running') return [el('p', { class: 'note' }, workingClock('Refining…', since(rec)))];
  if (!canRun(v, 'refine') && status !== 'approved') return [el('p', { class: 'note' }, 'Waiting on the film.')];
  const r = v.refine || { addons: [], slides: [], notes: [] };
  const t = r.tighten || { on: false, laughs: false, offered: false };
  const busy = ep.busy.has(v.dir);
  const out = [];
  if (status === 'error' || status === 'interrupted') out.push(el('p', { class: 'bad', 'data-content': rec.error ? '' : false }, rec.error || 'Refine was interrupted.'));
  // the first read: what Refine is for, and that the film itself is never changed
  if (status !== 'approved') out.push(el('p', { class: 'muted' }, 'Optional, free finishing touches. Apply makes a refined copy; the film stays.'));
  if (r.addons.length) {
    out.push(el('ul', { class: 'addons' }, ...r.addons.map((a) => el('li', {},
      el('span', { class: 'addon-kind', title: ADDON_TIP[a.kind] || '' }, ADDON_KIND[a.kind] || a.kind),
      el('span', { class: 'addon-title', title: a.title }, el('span', { 'data-content': '' }, a.title), a.music ? el('span', { class: 'note-mark', title: 'Its own music', 'aria-label': 'its own music' }, '♪') : null),
      el('span', { class: 'addon-where' }, el('span', { 'data-content': '' }, a.where),
        a.underMusic ? el('span', { class: 'chip music', title: 'The bed sits under it, quieter.' }, 'Has its own music') : null),
      busy ? el('span') : a.locked ? el('span', { class: 'addon-where', title: 'Change it in the Storyboard' }, 'Planned in the storyboard')
        : el('button', { class: 'linkish', onclick: () => updateAddons(v.dir, () => call(flpt.removeAddon, v.dir, a.id)) }, 'Remove')))));
  }
  const form = el('div', { class: 'addon-form', hidden: true });
  const acts = [];
  if (!busy) acts.push(refineAddMenu((kind) => addonForm(v, form, kind)));
  acts.push(tightenToggles(v, t, busy));
  const work = r.addons.length || t.on;
  const applied = Boolean(r.video);
  const approveBtn = () => el('button', { class: 'primary', onclick: () => approve(v.dir, 'refine') }, 'Approve and continue');
  if (work && !applied && !busy) acts.push(el('button', { class: 'primary', onclick: () => pipelineStep(v.dir, 'refine', flpt.refine, () => 'Refined.') }, 'Apply'));
  if (status !== 'approved' && !busy && !work) acts.push(approveBtn());
  out.push(el('div', { class: 'actions refine-bar' }, ...acts), form);
  if (r.outdated && !applied) out.push(el('p', { class: 'note' }, 'Changed since the last Apply.'));
  if (applied) {
    // The refined film, to watch before approving it.
    out.push(...videoBlock(r.video, r.videoAt, false, posterOf(v)));
    if (r.notes.length) out.push(el('ul', { class: 'addon-notes', 'data-content': '' }, ...r.notes.map((n) => el('li', {}, n))));
    if (status !== 'approved' && !busy) out.push(el('div', { class: 'actions' }, approveBtn()));
  }
  const box = el('section', { class: 'refine' }, ...out);
  if (!busy && canRun(v, 'refine')) {
    dropTarget(box, async (files) => {
      try {
        const s = await call(flpt.stageAddonDropped, files);
        addonForm(v, form, s.files[0].kind === 'audio' ? 'music' : 'clip', s);
      } catch (e) { flash(v.dir, 'refine', e.message); renderStage(); }
    });
  }
  // A form that was open before a re-render (a pick from the Library, say) opens again.
  if (ep.addonForm && ep.addonForm.dir === v.dir && !busy) setTimeout(() => addonForm(v, form, ep.addonForm.kind, ep.addonForm.staged));
  return [box];
}

/** Tighten pauses (free); with an ElevenLabs key, cut laughs too (Scribe: its price is asked for at Apply). */
function tightenToggles(v, t, busy) {
  const set = (next) => updateAddons(v.dir, () => call(flpt.setTighten, v.dir, next));
  const box = (label, checked, change) => {
    const input = el('input', { type: 'checkbox', checked, disabled: busy });
    input.addEventListener('change', () => change(input.checked));
    return el('label', { class: 'toggle' }, input, ` ${label}`);
  };
  return el('span', { class: 'tighten', title: 'Scenes with music stay whole' }, box('Tighten pauses', t.on, (on) => set({ on, laughs: on && t.laughs })),
    t.on && t.offered ? box('Cut laughs', t.laughs, (laughs) => set({ on: true, laughs })) : null);
}

/** The one Add menu: Clip, Transition, Music, B-roll. */
function refineAddMenu(open) {
  const item = (kind) => el('button', { type: 'button', role: 'menuitem', title: ADDON_TIP[kind], onclick: (e) => { e.stopPropagation(); closeMenus(); open(kind); } }, ADDON_KIND[kind]); // eslint-disable-line no-undef
  const menu = el('div', { class: 'lib-menu', role: 'menu', hidden: true }, ...['clip', 'transition', 'music', 'broll'].map(item));
  const btn = el('button', { type: 'button', class: 'lib-add-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: (e) => {
    e.stopPropagation();
    const show = menu.hidden;
    closeMenus(); // eslint-disable-line no-undef
    menu.hidden = !show;
    btn.setAttribute('aria-expanded', String(show));
    if (show) menu.querySelector('button').focus();
  } }, 'Add clip, music or B-roll');
  return el('div', { class: 'lib-add refine-add' }, btn, menu);
}

/** The form for one kind of add-on: what (from the Library, Transitions & Music, or a file) and where. */
function addonForm(v, form, kind, staged = null) {
  const r = v.refine;
  ep.addonForm = { dir: v.dir, kind, staged };
  let source = staged ? { staged: staged.token, name: staged.files[0].name } : null;
  const chosen = el('span', { class: 'addon-src', 'data-content': '' }, source ? source.name : '');
  const choose = (s) => { source = s; chosen.textContent = s.name; };
  const slides = (exceptLast) => r.slides.filter((s) => !exceptLast || s.n < r.slides.length).map((s) => el('option', { value: String(s.n), 'data-content': '' }, `${s.n} · ${s.title}${s.music ? ' ♪' : ''}`));
  const slide = el('select', { 'aria-label': 'Slide' }, ...slides(false));
  const phrase = el('input', { type: 'text', maxlength: '200', spellcheck: 'false', placeholder: kind === 'broll' ? 'From a phrase' : 'After a phrase', 'aria-label': 'A phrase from the narration (optional)' });
  const rows = [];
  const fromFile = (what) => el('button', { type: 'button', class: 'ghost small', onclick: async () => {
    try { const s = await call(flpt.pickAddonFile, what); if (s) choose({ staged: s.token, name: s.files[0].name }); } catch (e) { flash(v.dir, 'refine', e.message); renderStage(); }
  } }, 'File');
  let sound = null;
  let seconds = null;
  let under = null;
  if (kind === 'clip' || kind === 'broll') {
    rows.push(el('div', { class: 'addon-row' },
      el('button', { type: 'button', class: 'ghost small', onclick: () => libraryPicker({ kind: 'clip' }, (it) => choose({ library: it.id, name: it.title })) }, 'Library'),
      fromFile('video'), chosen));
    rows.push(el('div', { class: 'addon-row' }, el('span', {}, kind === 'clip' ? 'After slide' : 'Over slide'), slide, phrase));
    if (kind === 'clip') {
      sound = el('input', { type: 'checkbox', checked: true });
      rows.push(el('label', { class: 'addon-row toggle' }, sound, ' Its sound'));
    } else {
      seconds = el('input', { type: 'number', min: '0.5', max: '120', step: '0.5', placeholder: 'Its length', 'aria-label': 'Seconds (optional)', class: 'addon-secs' });
      rows.push(el('div', { class: 'addon-row' }, seconds, el('span', { class: 'muted' }, 's')));
    }
  } else {
    const pick = el('div', { class: kind === 'music' ? 'addon-tracks' : 'addon-pick' });
    rows.push(pick);
    let style = null;
    const where = el('span', {}, kind === 'music' ? 'Under' : 'After slide');
    call(flpt.addons.list).then((shelves) => {
      const list = kind === 'music' ? shelves.music : shelves.transitions;
      pick.replaceChildren(...(list.length ? list.map((c) => {
        const b = el('button', { type: 'button', 'aria-pressed': 'false', title: c.description || c.title, onclick: () => {
          for (const x of pick.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
          choose({ addons: c.id, name: c.title });
          style = c.style;
          if (kind === 'transition') {
            where.textContent = style === 'overlay' ? 'Over the cut after slide' : 'After slide';
            const keep = slide.value;
            slide.replaceChildren(...slides(style === 'overlay'));
            if ([...slide.options].some((o) => o.value === keep)) slide.value = keep;
          }
        } }, kind === 'music' ? [el('b', { 'data-content': '' }, c.title), c.author ? el('span', { class: 'muted', 'data-content': '' }, ` · ${c.author}`) : null]
          : [c.thumbPath ? el('img', { src: flpt.fileUrl(c.thumbPath, c.updatedAt || c.addedAt), alt: '' }) : el('span', { class: 'ph' }), el('span', { 'data-content': '' }, c.title)]);
        return b;
      }) : [el('p', { class: 'muted' }, kind === 'music' ? 'No music yet.' : 'No transitions yet.')]));
    }).catch((e) => pick.replaceChildren(el('p', { class: 'bad', 'data-content': '' }, e.message)));
    if (kind === 'music') {
      // Under a slide, or under a clip already added.
      const clips = r.addons.filter((a) => a.kind === 'clip' || (a.kind === 'transition' && a.style !== 'overlay'));
      under = el('select', { 'aria-label': 'Under', 'data-content': '' }, ...r.slides.map((s) => el('option', { value: `s${s.n}` }, `Slide ${s.n} · ${s.title}${s.music ? ' ♪' : ''}`)),
        ...clips.map((a) => el('option', { value: `a${a.id}`, 'data-content': '' }, `${ADDON_KIND[a.kind]} · ${a.title}`)));
      rows.push(el('div', { class: 'addon-row' }, where, under, fromFile('audio'), chosen));
    } else {
      rows.push(el('div', { class: 'addon-row' }, where, slide));
    }
  }
  const add = el('button', { class: 'primary' }, 'Add');
  add.addEventListener('click', () => {
    if (!source) { flash(v.dir, 'refine', kind === 'music' ? 'No music picked.' : kind === 'transition' ? 'No transition picked.' : 'No clip picked.'); renderStage(); return; }
    const src = source.library ? { library: source.library } : source.addons ? { addons: source.addons } : { staged: source.staged };
    const spec = { kind, source: src, phrase: phrase.value.trim(), sound: sound && !sound.checked ? 'mute' : 'keep', seconds: seconds && seconds.value ? Number(seconds.value) : null };
    if (under && under.value.startsWith('a')) spec.under = under.value.slice(1);
    else spec.slide = Number(under ? under.value.slice(1) : slide.value);
    updateAddons(v.dir, () => call(flpt.addAddon, v.dir, spec));
  });
  // Transitions and music come from Transitions & Music; the link opens it (to add your own).
  const head = el('p', { class: 'addon-form-head' }, ADDON_KIND[kind],
    kind === 'transition' || kind === 'music' ? el('button', { type: 'button', class: 'linkish addon-more', onclick: () => flpt.addons.open() }, 'Transitions & Music') : null);
  form.replaceChildren(head, ...rows,
    el('div', { class: 'actions' }, add, el('button', { class: 'ghost', onclick: () => { form.hidden = true; ep.addonForm = null; } }, 'Cancel')));
  form.hidden = false;
  form.scrollIntoView({ block: 'nearest' });
}

