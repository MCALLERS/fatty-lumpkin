'use strict';
/* global flpt */
// Transitions & Music: two shelves. Transitions play where they sit; music plays from its row, with its credit line.
// Add (or drop) a video to make a transition, a sound file to make music. The main process does the work
// (addons-ipc.js); this page only shows and asks.

const $ = (sel) => document.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(String(k)));
  return n;
};

const tm = { data: null, playing: null, statusTimer: null, dragDepth: 0 };

async function call(fn, ...args) {
  const r = await fn(...args);
  if (!r || !r.ok) throw new Error((r && r.error) || 'Something went wrong.');
  return r.value;
}

const secs = (s) => (s == null ? '' : s < 10 ? `${(Math.round(s * 10) / 10).toFixed(1)} s` : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
const firstLine = (s) => String(s || '').split('\n')[0];

function status(text, bad = false) {
  clearTimeout(tm.statusTimer);
  const p = $('#tm-status');
  p.textContent = text || '';
  p.classList.toggle('bad', bad);
  if (text) tm.statusTimer = setTimeout(() => { p.textContent = ''; }, bad ? 9000 : 3500);
}

// ── the shelves ────────────────────────────────────────────────────────────────────────────────────────────────

function stopAll() {
  const a = $('#tm-audio');
  if (!a.paused) a.pause();
  for (const v of document.querySelectorAll('.tm-card video')) restoreCard(v.closest('.tm-card'));
  for (const b of document.querySelectorAll('.tm-play[aria-pressed="true"]')) b.setAttribute('aria-pressed', 'false');
  tm.playing = null;
}

function restoreCard(cardNode) {
  const v = cardNode && cardNode.querySelector('video');
  if (!v) return;
  v.pause();
  v.replaceWith(cardNode._img);
  cardNode.classList.remove('playing');
}

/** A transition: its picture; click to play it right there (with its sound), click again to stop. */
function transitionCard(c) {
  const img = c.thumbPath ? el('img', { src: flpt.fileUrl(c.thumbPath, c.updatedAt || c.addedAt), alt: '', loading: 'lazy' }) : el('span', { class: 'tm-ph' });
  const node = el('div', { class: 'tm-card', 'data-id': c.id });
  node._img = img;
  const face = el('button', { type: 'button', class: 'tm-face', 'aria-label': `Play ${c.title}`, onclick: () => {
    const wasPlaying = Boolean(node.querySelector('video'));
    stopAll();
    if (wasPlaying || !c.filePath) return;
    const v = el('video', { src: flpt.fileUrl(c.filePath), autoplay: true, playsinline: true });
    v.addEventListener('ended', () => restoreCard(node));
    img.replaceWith(v);
    node.classList.add('playing');
    tm.playing = c.id;
  } }, img, el('span', { class: 'tm-len' }, secs(c.duration)));
  // A second line only when it says something the name doesn't ("Glitch"; "Yours").
  const meta = c.addedBy !== 'flpt' ? 'Yours' : (c.group && !c.title.toLowerCase().includes(c.group.toLowerCase()) ? c.group : '');
  node.append(...[face, el('p', { class: 'tm-title' }, c.title), meta ? el('p', { class: 'tm-meta' }, meta) : null, removeButton(c)].filter(Boolean));
  return node;
}

/** A piece of music: play, its name and composer, its credit line, its length. */
function trackRow(c) {
  const play = el('button', { type: 'button', class: 'tm-play', 'aria-pressed': 'false', 'aria-label': `Play ${c.title}` });
  play.addEventListener('click', () => {
    const a = $('#tm-audio');
    const was = tm.playing === c.id;
    stopAll();
    if (was || !c.filePath) return;
    a.src = flpt.fileUrl(c.filePath);
    a.play().catch(() => status('That file won\'t play here.', true));
    play.setAttribute('aria-pressed', 'true');
    tm.playing = c.id;
  });
  const line = firstLine(c.credit);
  const credit = c.credit
    ? el('p', { class: 'tm-credit', title: c.credit }, `${line}${c.license && !/\bCC\b|CC-BY/.test(line) ? ` · ${c.license}` : ''}`)
    : creditEditor(c);
  return el('li', { class: 'tm-track', 'data-id': c.id },
    play,
    el('div', { class: 'tm-track-main' }, el('p', { class: 'tm-track-title' }, c.title, c.author ? el('span', { class: 'tm-author' }, ` · ${c.author}`) : null), credit),
    el('span', { class: 'tm-len' }, secs(c.duration)),
    removeButton(c));
}

/** Your own music has no credit until you give it one. */
function creditEditor(c) {
  const input = el('input', { type: 'text', class: 'tm-credit-input', placeholder: 'Credit', 'aria-label': `Credit for ${c.title}`, maxlength: '2000', spellcheck: 'false' });
  const save = async () => {
    if (!input.value.trim()) return;
    try { await call(flpt.addons.setCredit, c.id, input.value.trim()); status('Saved.'); refresh(); } catch (e) { status(e.message, true); }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  input.addEventListener('blur', save);
  return input;
}

function removeButton(c) {
  return el('button', { type: 'button', class: 'tm-remove', 'aria-label': `Remove ${c.title}`, title: 'Remove', onclick: async (e) => {
    e.stopPropagation();
    stopAll();
    try {
      const r = await call(flpt.addons.remove, c.id);
      if (r.removed) { status('Moved to the Trash.'); refresh(); }
    } catch (err) { status(err.message, true); }
  } }, '×');
}

function render() {
  const d = tm.data;
  const grid = $('#tm-transitions');
  const list = $('#tm-music');
  grid.replaceChildren(...(d.transitions.length ? d.transitions.map(transitionCard) : [el('p', { class: 'tm-empty' }, 'No transitions')]));
  list.replaceChildren(...(d.music.length ? d.music.map(trackRow) : [el('li', { class: 'tm-empty' }, 'No music')]));
}

async function refresh() {
  try {
    tm.data = await call(flpt.addons.list);
    stopAll();
    render();
  } catch (e) { status(e.message, true); }
}

// ── adding ─────────────────────────────────────────────────────────────────────────────────────────────────────

function report(r) {
  if (!r || r.cancelled) return;
  const parts = [];
  if (r.added) parts.push(r.added === 1 ? 'Added.' : `Added ${r.added}.`);
  if (r.duplicates) parts.push(r.duplicates === 1 && !r.added ? 'Already here.' : `${r.duplicates} already here.`);
  if (r.failed && r.failed.length) parts.push(`${r.failed[0].name}: ${r.failed[0].error}`);
  status(parts.join(' '), Boolean(r.failed && r.failed.length && !r.added && !r.duplicates));
  refresh();
}

$('#tm-add').addEventListener('click', async () => {
  try { report(await call(flpt.addons.add)); } catch (e) { status(e.message, true); }
});
$('#tm-folder').addEventListener('click', () => flpt.addons.reveal(null));

const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
document.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); tm.dragDepth += 1; $('#tm-drop').hidden = false; });
document.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
document.addEventListener('dragleave', () => { tm.dragDepth = Math.max(0, tm.dragDepth - 1); if (!tm.dragDepth) $('#tm-drop').hidden = true; });
document.addEventListener('drop', async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  tm.dragDepth = 0;
  $('#tm-drop').hidden = true;
  status('Adding…');
  try { report(await call(flpt.addons.addDropped, e.dataTransfer.files)); } catch (err) { status(err.message, true); }
});

$('#tm-audio').addEventListener('ended', () => stopAll());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') stopAll(); });
flpt.addons.onChanged(() => refresh());

refresh();
