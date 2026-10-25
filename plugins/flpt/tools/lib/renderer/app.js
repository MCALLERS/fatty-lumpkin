'use strict';
/* global flpt */
// The setup wizard, plus the shared helpers and view switching that episodes.js builds on, and the renderer shell every
// V2 screen hangs off (window.FLPT_UI: panels, components, slots, Setup's steps; Pause motion). Everything sensitive
// happens in the main process; this file only shows state and asks.

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k))); // `cond && node`
  return n;
};

// ── the renderer shell (PLAN §2.2, seam 4) ────────────────────────────────────────────────────────────────────────
// Later screens are ui-*.js files that register here instead of editing this file, episodes.js or index.html:
//   panels[stageId]   a stage's panel: (ctx) => nodes, or { realm: 'theater', render(ctx) }. renderStage() (episodes.js)
//                     uses it when present, else today's panel; ctx carries the view, the stage, its record and status,
//                     and helpers (approve, run, refresh, render, select, flash, call, md, el, anchor, fallback).
//   components[name]  shared pieces one screen offers another (the module picker, the sound picker, Cartoon you).
//   slots[name]       an element that lives as long as the page and that no rebuild touches. topbar (the top bar's own
//                     buttons), ribbon (above the episode panel) and stage (over its anchor) are in index.html;
//                     inspector.style, inspector.reference and studio.more are made here, for the panel that hosts
//                     them to place (moving an element keeps what's in it). slot(name) makes any other on first use.
//   anchor(name)      a placeholder for an anchored slot (the Stage): the slot sits over it, follows it through every
//                     rebuild, scroll and resize, and hides when no anchor is on screen. It says 'slot:move' each time.
//   setupSteps        Setup's steps, in order: { id, label, done(S), show(section, S), screen(), extra }. Insert one
//                     where it belongs, or replace one by id; screen() brings its own section (it replaces index.html's).
//   motionHeld()      true while ambient motion must hold: Pause motion, reduced motion, or a hidden or blurred window.
//                     Ambient loops only (covers, tiles that loop on their own): the Stage and anything the user starts
//                     with ▶ play regardless (PLAN §3.1 #5), so never gate those on it.
const FLPT_UI = window.FLPT_UI = Object.assign({ panels: {}, components: {}, slots: {}, setupSteps: [] }, window.FLPT_UI || {});

for (const n of document.querySelectorAll('[data-slot]')) FLPT_UI.slots[n.dataset.slot] = n;
FLPT_UI.slot = (name, { anchored = false } = {}) => {
  if (!FLPT_UI.slots[name]) {
    const n = el('div', { class: 'slot', 'data-slot': name, 'data-anchored': anchored, hidden: anchored });
    if (anchored) $('#slot-layer').append(n);
    FLPT_UI.slots[name] = n;
  }
  return FLPT_UI.slots[name];
};
for (const name of ['inspector.style', 'inspector.reference', 'studio.more']) FLPT_UI.slot(name);
FLPT_UI.anchor = (name, attrs = {}) => el('div', { ...attrs, class: `slot-anchor${attrs.class ? ` ${attrs.class}` : ''}`, 'data-anchor': name });

// Anchored slots follow their anchor: placed over its box, clipped to what its scrolling parent shows, hidden without
// one. Each change is announced on the slot ('slot:move', detail { x, y, width, height, clip, visible, dpr }) for a
// host that draws there itself (the Mac's Stage). No animation frames: it works in a hidden window too.
const placed = new Map(); // slot element → the last geometry it was given, as JSON
let anyPlaced = false; // an anchored slot is on screen (the safety-net poll runs only then, or while an anchor exists)
function clipOf(a, r) {
  let top = 0;
  let left = 0;
  let bottom = innerHeight;
  let right = innerWidth;
  for (let p = a.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (!/(auto|scroll|hidden|clip)/.test(`${s.overflow}${s.overflowX}${s.overflowY}`)) continue;
    const q = p.getBoundingClientRect();
    top = Math.max(top, q.top); left = Math.max(left, q.left); bottom = Math.min(bottom, q.bottom); right = Math.min(right, q.right);
  }
  return { top: Math.max(0, top - r.top), left: Math.max(0, left - r.left), bottom: Math.max(0, r.bottom - bottom), right: Math.max(0, r.right - right) };
}
function placeSlots() {
  anyPlaced = false;
  for (const slot of document.querySelectorAll('#slot-layer > [data-anchored]')) {
    const name = slot.dataset.slot;
    const a = [...document.querySelectorAll('[data-anchor]')].find((x) => x.dataset.anchor === name && x.getClientRects().length && !x.closest('[hidden]'));
    let g = { visible: false };
    if (a) {
      const r = a.getBoundingClientRect();
      const clip = clipOf(a, r);
      const visible = r.width > 0 && r.height > 0 && clip.top + clip.bottom < r.height && clip.left + clip.right < r.width;
      g = { visible, x: r.left, y: r.top, width: r.width, height: r.height, clip, dpr: devicePixelRatio };
    }
    anyPlaced = anyPlaced || g.visible;
    const key = JSON.stringify(g);
    if (placed.get(slot) === key) continue;
    placed.set(slot, key);
    slot.hidden = !g.visible;
    if (g.visible) {
      const c = g.clip;
      Object.assign(slot.style, { left: `${g.x}px`, top: `${g.y}px`, width: `${g.width}px`, height: `${g.height}px`,
        clipPath: c.top || c.right || c.bottom || c.left ? `inset(${c.top}px ${c.right}px ${c.bottom}px ${c.left}px)` : '' });
    }
    slot.dispatchEvent(new CustomEvent('slot:move', { detail: g }));
  }
}
const sizes = new ResizeObserver(() => placeSlots());
const anchorsIn = (n) => (n.nodeType === 1 ? [n, ...n.querySelectorAll('[data-anchor]')].filter((a) => a.dataset.anchor != null) : []);
const ambientIn = (n) => (n.nodeType === 1 ? [n, ...n.querySelectorAll('video[data-ambient]')].filter((v) => v.matches('video[data-ambient]')) : []);
new MutationObserver((list) => {
  for (const m of list) {
    for (const n of m.removedNodes) {
      for (const a of anchorsIn(n)) sizes.unobserve(a);
      for (const v of ambientIn(n)) { if (!v.isConnected) { onScreen.unobserve(v); if (shown.delete(v)) for (const o of shown) syncVideo(o); v.pause(); } }
    }
    for (const n of m.addedNodes) {
      for (const a of anchorsIn(n)) sizes.observe(a);
      for (const v of ambientIn(n)) { arrived.set(v, ++arrivals); onScreen.observe(v); } // Pause motion, below: it plays only on screen
    }
  }
  placeSlots();
}).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'open'] });
sizes.observe(document.documentElement);
addEventListener('resize', () => placeSlots());
document.addEventListener('scroll', () => placeSlots(), { capture: true, passive: true });
setInterval(() => { if (anyPlaced || document.querySelector('[data-anchor]')) placeSlots(); }, 250); // the safety net

// ── Pause motion (PLAN §3.2) ───────────────────────────────────────────────────────────────────────────────────────
// settings.ui.motion ('on' | 'paused') is kept by the main process (flpt.ui); localStorage mirrors it, and fx-boot.js
// (in <head>) sets .fx-paused from the mirror before the first paint. Paused, <html> carries .fx-paused (tokens.css
// stops the ambient loops and shows posters). Ambient videos (video[data-ambient], no autoplay of their own) play only
// while on screen and nothing holds them; Pause motion and reduced motion put them back to their poster, and a hidden
// or blurred window freezes them where they are. At most one ambient loop plays per viewport (PLAN §3.2): the one that
// arrived last (a hovered cover or card), the others hold where they are.
const MOTION_KEY = 'flpt.motion';
const motion = { paused: document.documentElement.classList.contains('fx-paused'), away: false, reduced: matchMedia('(prefers-reduced-motion: reduce)') };
FLPT_UI.motionHeld = () => motion.paused || motion.away || motion.reduced.matches || document.hidden;
const shown = new Set(); // ambient videos on screen now
const arrived = new WeakMap(); // ambient video → when it was added (the latest leads)
let arrivals = 0;
const onScreen = new IntersectionObserver((list) => {
  for (const e of list) { if (e.isIntersecting) shown.add(e.target); else shown.delete(e.target); }
  for (const v of document.querySelectorAll('video[data-ambient]')) syncVideo(v);
});
/** The one ambient video that may play: on screen, the latest to arrive. */
function leadVideo() {
  let lead = null;
  for (const v of shown) if (v.isConnected && (!lead || (arrived.get(v) || 0) > (arrived.get(lead) || 0))) lead = v;
  return lead;
}
function syncVideo(v) {
  if (!FLPT_UI.motionHeld() && shown.has(v) && v === leadVideo()) { if (v.paused) v.play().catch(() => {}); return; }
  if (!v.paused) v.pause();
  // Paused or reduced: the poster again, not a frozen frame (load() resets it; a played video only)
  if ((motion.paused || motion.reduced.matches) && (v.currentTime > 0 || v.played.length)) { v.autoplay = false; v.load(); }
}
function syncMotion() {
  for (const v of document.querySelectorAll('video[data-ambient]')) syncVideo(v);
  document.dispatchEvent(new CustomEvent('flpt:motion', { detail: { paused: motion.paused, held: FLPT_UI.motionHeld() } }));
}
function setMotion(paused) {
  motion.paused = paused;
  document.documentElement.classList.toggle('fx-paused', paused);
  try { localStorage.setItem(MOTION_KEY, paused ? 'paused' : 'on'); } catch { /* the mirror is a convenience */ }
  const b = $('#motion-toggle');
  b.setAttribute('aria-pressed', String(paused));
  b.textContent = paused ? '▶' : '❚❚';
  syncMotion();
}
setMotion(motion.paused);
// A save that fails still holds for this session (the main process keeps it); the note says so, then goes.
let motionNoteTimer = null;
function motionNote(text) {
  clearTimeout(motionNoteTimer);
  $('#motion-note').textContent = text;
  if (text) motionNoteTimer = setTimeout(() => { $('#motion-note').textContent = ''; }, 8000);
}
$('#motion-toggle').addEventListener('click', async () => {
  setMotion(!motion.paused);
  if (!flpt.ui) return;
  let r;
  try { r = await flpt.ui.setMotion(motion.paused ? 'paused' : 'on'); } catch (e) { r = { ok: false, error: e.message }; }
  if (r && r.ok) { if (S) S.settings.ui = { ...S.settings.ui, motion: r.value }; motionNote(''); } else motionNote((r && r.error) || 'Couldn\'t save that.');
});
motion.reduced.addEventListener('change', syncMotion);
document.addEventListener('visibilitychange', syncMotion);
// Blur fires too when focus moves into a frame of this page (the web or Desk Stage): only a window that really lost
// focus holds ambient motion. (The Mac's native Stage view, W1-14, takes focus from the page: it never gates on this.)
addEventListener('blur', () => setTimeout(() => { if (!document.hasFocus()) { motion.away = true; syncMotion(); } }, 0));
addEventListener('focus', () => { motion.away = false; syncMotion(); });

// ── Setup's steps ──────────────────────────────────────────────────────────────────────────────────────────────

let S = null; // app state from the main process
const session = { tests: {}, checkPassed: false, sampleMade: false, sampleOutput: null, currentJob: null, step: null };

FLPT_UI.setupSteps.unshift(
  { id: 'welcome', label: 'Welcome', done: () => S.settings.seenWelcome,
    show: () => { if (!S.settings.seenWelcome) flpt.saveSettings({ seenWelcome: true }).then((r) => { S.settings = r.settings; }); } },
  { id: 'tools', label: 'Tools', done: () => Boolean(S.tools && S.tools.ready), show: () => renderTools() },
  { id: 'keys', label: 'Keys', done: () => Object.values(S.keys).filter((k) => k.required).every((k) => k.set && session.tests[k.name] !== false), show: () => renderKeys() },
  { id: 'presenter', label: 'Presenter', done: () => Boolean(S.presenter && S.presenter.HEYGEN_AVATAR_ID && S.presenter.HEYGEN_VOICE_ID), show: () => renderPresenter() },
  { id: 'check', label: 'Free check', done: () => session.checkPassed },
  { id: 'sample', label: 'Free sample', done: () => session.sampleMade },
  { id: 'done', label: 'Done', done: () => S.settings.setupComplete,
    show: () => flpt.saveSettings({ setupComplete: true }).then((r) => { S.settings = r.settings; renderSteps('done'); }) },
  { id: 'about', label: 'About', extra: true, show: () => { $('#about-version').textContent = S.version ? `Version ${S.version}` : ''; } },
);
const stepOf = (id) => FLPT_UI.setupSteps.find((st) => st && st.id === id);

// ── views: setup, home (episodes), episode ─────────────────────────────────────────────────────────────────────

const views = { onShow: {} }; // name → called when the view is shown (episodes.js registers home)
function showView(name) {
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== `${name}-view`;
  if (name !== 'episode') delete document.documentElement.dataset.realmView; // the top bar's Theater is an episode's
  const tab = name === 'episode' ? 'home' : name;
  for (const b of document.querySelectorAll('.topnav [data-view]')) b.setAttribute('aria-current', String(b.dataset.view === tab));
  const f = views.onShow[name];
  if (f) f();
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (b && !b.disabled) showView(b.dataset.view);
});
views.onShow.setup = () => {
  const first = FLPT_UI.setupSteps.find((st) => st && !st.extra && !done(st.id));
  go(session.step && stepOf(session.step) ? session.step : (S.settings.setupComplete ? 'done' : (first ? first.id : 'welcome')));
};

// ── navigation ──────────────────────────────────────────────────────────────────────────────────────────────

function done(id) {
  const st = stepOf(id);
  if (!S || !st || typeof st.done !== 'function') return false;
  try { return Boolean(st.done(S)); } catch { return false; }
}

/** A step's section: index.html's, or the one its screen() brings (made once; it takes the place of index.html's). */
const mounted = new WeakMap();
function screenOf(st) {
  const own = [...document.querySelectorAll('#main > .screen')].find((x) => x.dataset.name === st.id) || null;
  if (typeof st.screen !== 'function') return own;
  if (!mounted.has(st)) {
    const node = st.screen();
    node.classList.add('screen');
    node.dataset.name = st.id;
    if (own && own !== node) own.replaceWith(node); else if (!node.isConnected) $('#main').append(node);
    mounted.set(st, node);
  }
  return mounted.get(st);
}

function renderSteps(active) {
  let n = 0;
  $('#step-list').replaceChildren(...FLPT_UI.setupSteps.filter(Boolean).map((st) => el('li', { class: `${done(st.id) ? 'done' : ''}${st.extra ? ' extra' : ''}`.trim() },
    el('button', { 'aria-current': st.id === active ? 'step' : false, 'data-n': st.extra || st.id === 'welcome' ? false : String(++n).padStart(2, '0'), onclick: () => go(st.id) },
      el('span', { class: 'dot' }), st.label))));
}

function go(name) {
  const st = stepOf(name) || stepOf('welcome') || FLPT_UI.setupSteps.find(Boolean); // a later WP may rename Welcome
  if (!st) return;
  session.step = st.id;
  $('#setup-view').classList.toggle('at-welcome', st.id === 'welcome');
  const section = screenOf(st);
  for (const s of document.querySelectorAll('#main > .screen')) s.classList.toggle('active', s === section);
  renderSteps(st.id);
  if (typeof st.show === 'function') st.show(section, S);
  $('#main').focus();
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-go]');
  if (b && !b.disabled) go(b.dataset.go);
});

// ── tools ───────────────────────────────────────────────────────────────────────────────────────────────────

function renderTools() {
  const t = S.tools;
  for (const r of document.querySelectorAll('input[name="toolmode"]')) r.checked = r.value === S.settings.toolchainMode;
  $('#tool-list').replaceChildren(...(t ? t.tools : []).map((x) => el('li', {},
    el('span', { class: `status ${x.ok ? 'ok' : x.required ? 'bad' : 'optional'}` }),
    el('div', {}, el('strong', {}, x.label), el('div', { class: 'muted' },
      x.ok ? `${x.version || 'found'}${x.source === 'pinned' ? ' · FLPT\'s own copy' : ' · on this Mac'}` : `${x.problem || 'not found'}: ${x.why}`)),
    el('span', { class: 'muted' }, x.required ? '' : 'optional'))));
  const pinnedNotReady = S.settings.toolchainMode === 'pinned' && t && !t.pinnable;
  $('#tools-note').textContent = pinnedNotReady
    ? 'FLPT\'s own tools aren\'t in this build yet.'
    : (t && t.ready ? 'All set.' : '');
  $('#tools-install').disabled = pinnedNotReady;
  $('#tools-install').textContent = S.settings.toolchainMode === 'pinned' ? 'Install FLPT\'s tools' : 'Set up Python and HyperFrames';
  $('#tools-next').disabled = !(t && t.ready);
  lead($('#tools-install'), $('#tools-next'), Boolean(t && t.ready));
}

/** One navy button per step: the step's own action until it's done, then Next. */
function lead(action, next, done) {
  action.classList.toggle('primary', !done);
  action.classList.toggle('ghost', done);
  next.classList.toggle('primary', done);
  next.classList.toggle('ghost', !done);
}

for (const r of document.querySelectorAll('input[name="toolmode"]')) {
  r.addEventListener('change', async () => {
    S.settings = (await flpt.saveSettings({ toolchainMode: r.value })).settings;
    S.tools = await flpt.detectTools();
    renderTools();
  });
}
$('#tools-recheck').addEventListener('click', async () => { S.tools = await flpt.detectTools(); renderTools(); renderSteps('tools'); });
$('#tools-install').addEventListener('click', async () => {
  const btn = $('#tools-install');
  btn.disabled = true;
  $('#tools-note').textContent = 'Working… this can take a few minutes.';
  const r = await flpt.installTools();
  S.tools = r.tools;
  renderTools();
  renderSteps('tools');
  if (r.ok) $('#tools-note').textContent = r.warning || 'All set.';
  else $('#tools-note').replaceChildren('That didn\'t work: ', el('span', { 'data-content': '' }, r.error));
});
flpt.onToolsProgress((p) => {
  const what = p.phase === 'download' && p.total ? `${p.id}: ${Math.round((100 * p.bytes) / p.total)} %` : `${p.id}: ${p.phase}`;
  $('#tools-note').textContent = `Working… ${what}`;
});

// ── keys ────────────────────────────────────────────────────────────────────────────────────────────────────

function keyRow(k) {
  const input = el('input', { type: 'password', placeholder: k.set ? `Saved (${k.hint}). Paste a new key to replace it.` : 'Paste the key', autocomplete: 'off', spellcheck: 'false', 'aria-label': `${k.label} key` });
  const msg = el('div', { class: 'msg' }, k.help);
  const t = session.tests[k.name];
  if (t === true) { msg.className = 'msg ok'; msg.textContent = 'Saved and tested.'; }
  if (t === false) { msg.className = 'msg bad'; msg.textContent = 'Saved, but the test failed.'; }
  const save = el('button', { onclick: async () => {
    if (!input.value.trim()) { input.focus(); return; }
    save.disabled = true;
    const r = await flpt.setKey(k.name, input.value);
    input.value = '';
    save.disabled = false;
    if (!r.ok) { msg.className = 'msg bad'; msg.textContent = r.error; return; }
    S.keys = r.keys;
    session.tests[k.name] = r.test.ok === null ? null : Boolean(r.test.ok);
    renderKeys();
    const m = document.querySelector(`[data-key="${k.name}"] .msg`);
    if (m) { m.className = `msg ${r.test.ok === false ? 'bad' : 'ok'}`; m.textContent = r.test.detail; }
    renderSteps('keys');
  } }, k.set ? 'Replace' : 'Save & test');
  const test = k.set ? el('button', { class: 'ghost', onclick: async () => {
    const r = await flpt.testKey(k.name);
    session.tests[k.name] = r.ok === null ? null : Boolean(r.ok);
    msg.className = `msg ${r.ok === false ? 'bad' : 'ok'}`;
    msg.textContent = r.detail;
    renderSteps('keys');
  } }, 'Test') : null;
  return el('div', { class: 'key', 'data-key': k.name },
    el('div', { class: 'label' }, el('strong', {}, k.label), el('span', { class: 'muted' }, k.set ? `saved ${k.hint}` : (k.required ? 'required' : 'optional'))),
    input, el('div', { class: 'key-actions' }, save, test), msg);
}

function renderKeys() {
  const ks = Object.values(S.keys).filter((k) => !k.signin); // a sign-in (the FLPT voices') isn't a key to paste
  $('#key-list').replaceChildren(...ks.filter((k) => k.required).map(keyRow));
  $('#key-list-optional').replaceChildren(...ks.filter((k) => !k.required).map(keyRow));
  $('#import-banner').hidden = !(S.importable && (S.importable.keysEnv || S.importable.presenterEnv));
  if (!S.vaultAvailable) {
    $('#key-list').prepend(el('p', { class: 'note' }, 'macOS Keychain encryption isn\'t available right now, so keys can\'t be saved.'));
  }
}

$('#import-legacy').addEventListener('click', async () => {
  const r = await flpt.importLegacy();
  S = r.state;
  for (const n of r.keys) {
    const t = await flpt.testKey(n);
    session.tests[n] = t.ok === null ? null : Boolean(t.ok);
  }
  renderKeys();
  renderSteps('keys');
  $('#import-banner').replaceChildren(el('p', {}, `Imported ${r.keys.length} key${r.keys.length === 1 ? '' : 's'}${r.presenter ? ' and your presenter' : ''}. Keys now live in the Keychain.`));
});

// ── presenter ───────────────────────────────────────────────────────────────────────────────────────────────

function renderPresenter() {
  const p = S.settings.presenter;
  const id = S.presenter && S.presenter.HEYGEN_AVATAR_ID;
  const voice = S.presenter && S.presenter.HEYGEN_VOICE_ID;
  const voiceName = (p && p.voiceName) || (shownVoices.find((v) => v.id === voice) || {}).name;
  const theirs = (text) => el('span', { 'data-content': '' }, text); // HeyGen's names, not the app's words
  $('#presenter-current').replaceChildren(...(id
    ? ['Current look: ', theirs(p && p.lookName ? p.lookName : `${id.slice(0, 8)}…`), ' · ', ...(voice ? ['voice: ', theirs(voiceName || `${voice.slice(0, 8)}…`)] : ['no voice yet'])]
    : ['No presenter yet.']));
}

// The looks shown (for the current look's name and kind when only the voice changes), and the voices offered.
let shownLooks = [];
let shownVoices = [];

async function choosePresenter(look, voiceId) {
  $('#voice-note').textContent = '';
  const res = await flpt.setPresenter({ lookId: look.id, name: look.name, twin: look.twin, voiceId });
  if (!res.ok) { $('#voice-note').textContent = res.error || 'That didn\'t work.'; return; }
  S = res.state;
  for (const b of document.querySelectorAll('.look')) b.setAttribute('aria-pressed', String(b.dataset.id === look.id));
  if (S.presenter.HEYGEN_VOICE_ID) $('#voice-pick').value = S.presenter.HEYGEN_VOICE_ID;
  syncPlay();
  renderPresenter();
  renderSteps('presenter');
}

function syncPlay() {
  const v = shownVoices.find((x) => x.id === $('#voice-pick').value);
  $('#voice-play').disabled = !(v && v.preview);
}

function renderVoices() {
  const current = S.presenter && S.presenter.HEYGEN_VOICE_ID;
  const opts = shownVoices.map((v) => el('option', { value: v.id, disabled: !v.speaks, 'data-content': '' }, `${v.name}${v.language ? ` · ${v.language}` : ''}${v.speaks ? '' : ' (not available)'}`));
  if (current && !shownVoices.some((v) => v.id === current)) opts.unshift(el('option', { value: current }, (S.settings.presenter && S.settings.presenter.voiceName) || 'Your current voice'));
  $('#voice-pick').replaceChildren(...opts);
  if (current) $('#voice-pick').value = current;
  $('#voice-row').hidden = !opts.length;
  if (!opts.length) $('#voice-note').textContent = 'No voices in HeyGen yet.';
  syncPlay();
  renderPresenter();
}

$('#load-looks').addEventListener('click', async () => {
  const btn = $('#load-looks');
  btn.disabled = true;
  const r = await flpt.looks();
  if (!r.ok) { btn.disabled = false; $('#looks').replaceChildren(el('p', { class: 'note' }, r.error)); return; }
  shownLooks = r.looks;
  const current = S.presenter && S.presenter.HEYGEN_AVATAR_ID;
  $('#looks').replaceChildren(...r.looks.map((l) => el('button', { class: 'look', 'aria-pressed': String(l.id === current),
    // A look comes with its own voice (HeyGen links one to every look); the menu below can change it.
    onclick: () => choosePresenter(l, l.voiceId || (S.presenter && S.presenter.HEYGEN_VOICE_ID)),
    'data-id': l.id }, l.thumb ? el('img', { src: l.thumb, alt: '' }) : el('div', { class: 'ph' }), el('span', { 'data-content': '' }, `${l.n} · ${l.name || 'untitled'}${l.twin ? ' · twin' : ''}`))));
  const v = await flpt.voices(r.looks.map((l) => l.voiceId).filter(Boolean));
  btn.disabled = false;
  shownVoices = v.ok ? v.voices : [];
  if (!v.ok) $('#voice-note').textContent = v.error;
  renderVoices();
});

$('#voice-pick').addEventListener('change', () => {
  const id = S.presenter && S.presenter.HEYGEN_AVATAR_ID;
  const look = shownLooks.find((l) => l.id === id) || { id, name: S.settings.presenter && S.settings.presenter.lookName, twin: S.presenter.HEYGEN_CHARACTER_TYPE === 'avatar' };
  if (id) choosePresenter(look, $('#voice-pick').value);
  else syncPlay();
});

$('#voice-play').addEventListener('click', async () => {
  const r = await flpt.voicePreview($('#voice-pick').value);
  if (!r.ok) { $('#voice-note').textContent = r.error; return; }
  const a = $('#voice-audio');
  a.src = r.url;
  a.play().catch(() => {});
});

// ── check, sample, paid sample ──────────────────────────────────────────────────────────────────────────────

function verdict(box, ok, good, badText, lines) {
  const kids = [el('p', { class: ok ? 'ok' : 'bad' }, ok ? good : badText)];
  if (!ok && lines && lines.length) kids.push(el('pre', { class: 'muted' }, lines.slice(-8).join('\n')));
  box.replaceChildren(...kids); // never pass null: replaceChildren would print it as text
}

$('#run-check').addEventListener('click', async () => {
  const r = await flpt.runCheck();
  session.checkPassed = r.code === 0;
  verdict($('#check-result'), session.checkPassed, 'Check passed: keys, presenter and wallet look right.', 'The check found a problem.', r.lines);
  lead($('#run-check'), $('#check-next'), session.checkPassed);
  renderSteps('check');
});

$('#run-draft').addEventListener('click', async () => {
  const r = await flpt.draftSample();
  session.sampleMade = r.code === 0 && Boolean(r.output);
  session.sampleOutput = r.output;
  const box = $('#draft-result');
  verdict(box, session.sampleMade, 'Your free sample is ready.', 'The sample didn\'t render.', r.lines);
  lead($('#run-draft'), $('#sample-next'), session.sampleMade);
  $('#run-draft').textContent = session.sampleMade ? 'Make again' : 'Make the free sample';
  if (session.sampleMade) {
    const src = typeof flpt.fileUrl === 'function' ? flpt.fileUrl(r.output, Date.now()) : '';
    if (src) box.append(el('div', { class: 'player-frame', 'data-realm': 'theater' }, el('video', { src, controls: true, playsinline: true, preload: 'metadata', 'aria-label': 'The free sample' })));
    box.append(el('div', { class: 'actions' },
      src ? null : el('button', { onclick: () => flpt.openFile(r.output) }, 'Play it'),
      el('button', { class: 'ghost', onclick: () => flpt.revealFile(r.output) }, 'Show in Finder')));
    const est = await flpt.estimateSample();
    $('#paid-estimate').textContent = `about ${est.totalUsd.toFixed(2)} US dollars`;
    $('#paid').hidden = false;
  }
  renderSteps('sample');
});

$('#run-paid').addEventListener('click', async () => {
  const r = await flpt.approveSample();
  if (r.cancelled) return;
  verdict($('#paid-result'), r.code === 0, 'Done: slide 1 rendered with your presenter.', 'The paid sample didn\'t finish.', r.lines);
});

// ── live log ────────────────────────────────────────────────────────────────────────────────────────────────

flpt.onJob((ev) => {
  const log = $('#log');
  if (ev.phase === 'start') {
    session.currentJob = ev.id;
    $('#log-title').textContent = `${ev.label}…`;
    $('#log-lines').textContent = '';
    log.hidden = false;
  } else if (ev.phase === 'line' && ev.id === session.currentJob) {
    const pre = $('#log-lines');
    pre.textContent += `${ev.line}\n`;
    pre.scrollTop = pre.scrollHeight;
  } else if (ev.phase === 'end' && ev.id === session.currentJob) {
    $('#log-title').textContent = ev.code === 0 ? 'Finished' : `Stopped (exit ${ev.code})`;
    setTimeout(() => { if (session.currentJob === ev.id) log.hidden = true; }, ev.code === 0 ? 2500 : 15000);
  }
});
$('#log-cancel').addEventListener('click', () => { if (session.currentJob) flpt.cancelJob(session.currentJob); });

// ── start ───────────────────────────────────────────────────────────────────────────────────────────────────

// After every script has run (episodes.js registers the home view), not as soon as this file has.
document.addEventListener('DOMContentLoaded', async () => {
  S = await flpt.state();
  if (S.settings.ui && S.settings.ui.motion) setMotion(S.settings.ui.motion === 'paused'); // settings.json wins over the mirror
  showView(S.settings.setupComplete ? 'home' : 'setup');
});
