'use strict';
/* global flpt, $, el, views, showView, go */
// The Library: everything kept, laid out like a pinboard. A quiet header (search, an Add menu, filters only when
// asked for), a masonry of pictures, and a detail panel to watch, edit, credit, find or remove an item.
// The main process does the work (library-ipc.js); this file only shows and asks. Builds on app.js ($, el, views).

const LIB_KIND = {
  clip: ['Clip', 'Clips'], image: ['Picture', 'Pictures'], 'video-link': ['Video link', 'Video links'], article: ['Article', 'Articles'],
  website: ['Website', 'Websites'], wiki: ['Wiki page', 'Wiki pages'], audio: ['Sound', 'Sounds'], document: ['Document', 'Documents'],
  note: ['Note', 'Notes'], flpt: ['From an episode', 'From episodes'],
};
const LIB_BY = { clippy: 'Clippy', crew: 'the crew', import: 'import', episode: 'an episode' };
const LIB_GAP = 18;
const LIB_MIN_COL = 220;

const lib = {
  query: '', kind: null, tag: null, filtersOpen: false,
  data: null, // the last library:list answer
  order: [], // item ids in grid order, for ← → in the detail panel
  cols: 0,
  open: null, // the item in the detail panel
  highlight: null, // a just-added item, briefly marked
  built: false,
  stale: true,
  statusTimer: null,
  dragDepth: 0,
  brollBusy: false, // a B-roll shot is on its way (the main process runs it; this only shows it)
};

async function libCall(fn, ...args) {
  const r = await fn(...args);
  if (!r || !r.ok) throw new Error((r && r.error) || 'Something went wrong.');
  return r.value;
}

const libLen = (s) => { const t = Math.max(0, Math.round(Number(s) || 0)); const h = Math.floor(t / 3600); const m = Math.floor(t / 60) % 60; const ss = String(t % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`; };
const libClock = (hms) => {
  const m = /^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(String(hms || ''));
  if (!m) return String(hms || '');
  const frac = m[4] && Number(m[4]) ? `.${m[4].replace(/0+$/, '')}` : '';
  return Number(m[1]) ? `${Number(m[1])}:${m[2]}:${m[3]}${frac}` : `${Number(m[2])}:${m[3]}${frac}`;
};
const libHost = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return ''; } };
const libDate = (iso) => { try { return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } };
const libVisible = () => !$('#library-view').hidden;
const PLAYABLE = /\.(mp4|m4v|mov)$/i;
const SHOWABLE = /\.(png|jpe?g|gif|webp)$/i;

// ── the page ───────────────────────────────────────────────────────────────────────────────────────────────────

function addMenu(id) {
  const item = (label, fn, extra = {}) => el('button', { type: 'button', role: 'menuitem', ...extra, onclick: (e) => { e.stopPropagation(); closeMenus(); fn(); } }, label);
  const menu = el('div', { class: 'lib-menu', role: 'menu', hidden: true },
    item('Files…', addFiles),
    item('Link…', showLinkForm),
    item('Clip a video…', () => flpt.clippy.open()),
    item('Make B-roll…', showBrollForm),
    el('div', { class: 'lib-menu-sep lib-cutaway', role: 'separator', hidden: true }),
    item('Cutaway Library', importCutaway, { class: 'lib-cutaway', hidden: true }));
  const btn = el('button', { type: 'button', class: 'primary lib-add-btn', id, 'aria-haspopup': 'menu', 'aria-expanded': 'false',
    onclick: (e) => {
      e.stopPropagation();
      const open = menu.hidden;
      closeMenus();
      menu.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      if (open) menu.querySelector('button').focus();
    } }, 'Add');
  return el('div', { class: 'lib-add' }, btn, menu);
}

function closeMenus() {
  for (const m of document.querySelectorAll('.lib-menu')) m.hidden = true;
  for (const b of document.querySelectorAll('.lib-add-btn')) b.setAttribute('aria-expanded', 'false');
}

function buildLibrary() {
  if (lib.built) return;
  lib.built = true;
  const search = el('input', { type: 'search', class: 'lib-search', id: 'lib-search', placeholder: 'Search', 'aria-label': 'Search the Library', spellcheck: 'false', autocomplete: 'off' });
  let timer = null;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { lib.query = search.value.trim(); refreshLibrary(); }, 140); });
  const filterBtn = el('button', { type: 'button', class: 'ghost lib-filter-btn', id: 'lib-filter-btn', 'aria-expanded': 'false', 'aria-controls': 'lib-filters',
    onclick: () => { lib.filtersOpen = !lib.filtersOpen; renderFilters(); } }, 'Filter');
  const linkInput = el('input', { type: 'url', placeholder: 'Paste a link', 'aria-label': 'Link to save', spellcheck: 'false', autocomplete: 'off' });
  linkInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); hideLinkForm(); } });
  const linkForm = el('form', { class: 'lib-link', id: 'lib-link', hidden: true, onsubmit: (e) => { e.preventDefault(); saveLinkFromForm(); } },
    linkInput, el('button', { type: 'submit', class: 'primary' }, 'Save'), el('button', { type: 'button', class: 'ghost', onclick: hideLinkForm }, 'Cancel'));
  const page = el('main', { class: 'page lib-page', id: 'library-main', tabindex: '-1' },
    el('div', { class: 'lib-head' },
      el('h1', { class: 'h-page' }, 'Library'),
      el('div', { class: 'lib-tools' }, search, filterBtn, addMenu('lib-add-head'))),
    linkForm,
    brollForm(),
    el('div', { class: 'lib-filters', id: 'lib-filters', hidden: true }),
    el('div', { class: 'lib-active', id: 'lib-active', hidden: true }),
    el('div', { class: 'lib-status', id: 'lib-status', 'aria-live': 'polite' }, el('span', { id: 'lib-status-text' }), el('progress', { id: 'lib-status-bar', max: '100', hidden: true })),
    el('div', { class: 'lib-grid', id: 'lib-grid' }),
    el('div', { class: 'lib-empty', id: 'lib-empty', hidden: true },
      el('p', {}, 'Clips, pictures and links you keep, all in one place.'), addMenu('lib-add-empty')),
    el('p', { class: 'lib-none', id: 'lib-none', hidden: true }, 'Nothing matches. ', el('button', { type: 'button', class: 'linkish', onclick: clearFilters }, 'Show everything')));
  const drop = el('div', { class: 'lib-drop', id: 'lib-drop', hidden: true }, el('p', {}, 'Drop to add'));
  const detail = el('dialog', { class: 'lib-detail', id: 'lib-detail', 'aria-label': 'Library item' });
  detail.addEventListener('click', (e) => { if (e.target === detail) detail.close(); });
  detail.addEventListener('close', () => { for (const v of detail.querySelectorAll('video')) v.pause(); lib.open = null; });
  detail.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key) || /^(INPUT|TEXTAREA|VIDEO)$/.test(e.target.tagName) || !lib.open) return;
    const i = lib.order.indexOf(lib.open.id);
    const next = lib.order[i + (e.key === 'ArrowRight' ? 1 : -1)];
    if (i >= 0 && next) { e.preventDefault(); openLibraryItem(next); }
  });
  $('#library-view').replaceChildren(page, drop, detail);
  new ResizeObserver(() => { if (lib.data && libVisible() && columnsFor($('#lib-grid').clientWidth) !== lib.cols) layoutGrid(lib.data.items); }).observe($('#lib-grid'));
}

function columnsFor(width) { return Math.max(1, Math.min(6, Math.floor((width + LIB_GAP) / (LIB_MIN_COL + LIB_GAP)))); }

async function refreshLibrary() {
  if (!lib.built) return;
  let data;
  try { data = await libCall(flpt.library.list, lib.query, { kind: lib.kind, tag: lib.tag }); } catch (e) { libStatus(e.message, { bad: true }); return; }
  lib.data = data;
  lib.stale = false;
  lib.order = data.items.map((i) => i.id);
  const empty = data.total === 0;
  $('#lib-empty').hidden = !empty;
  $('#lib-none').hidden = empty || data.items.length > 0;
  $('#lib-search').hidden = empty;
  for (const x of document.querySelectorAll('.lib-cutaway')) x.hidden = !data.cutaway;
  renderFilters();
  layoutGrid(data.items);
}

// ── filters: hidden until asked for ──

function renderFilters() {
  const data = lib.data;
  if (!data) return;
  const kinds = data.facets.kinds;
  const tags = data.facets.tags.slice(0, 16);
  const useful = data.total > 0 && (kinds.length > 1 || tags.length > 0);
  const btn = $('#lib-filter-btn');
  btn.hidden = !useful && !lib.kind && !lib.tag;
  btn.setAttribute('aria-expanded', String(lib.filtersOpen));
  btn.classList.toggle('on', Boolean(lib.kind || lib.tag));
  const box = $('#lib-filters');
  box.hidden = !lib.filtersOpen || btn.hidden;
  const chip = (label, pressed, fn) => el('button', { type: 'button', class: 'lib-chip', 'aria-pressed': String(pressed), onclick: fn }, label);
  box.replaceChildren(
    el('div', { class: 'lib-chips', role: 'group', 'aria-label': 'Kind' },
      chip('Everything', !lib.kind, () => { lib.kind = null; refreshLibrary(); }),
      ...kinds.map((k) => chip((LIB_KIND[k.name] || [k.name, k.name])[1], lib.kind === k.name, () => { lib.kind = lib.kind === k.name ? null : k.name; refreshLibrary(); }))),
    tags.length ? el('div', { class: 'lib-chips', role: 'group', 'aria-label': 'Tags' },
      ...tags.map((t) => chip(`#${t.name}`, lib.tag === t.name, () => { lib.tag = lib.tag === t.name ? null : t.name; refreshLibrary(); }))) : null);
  // With the panel closed, what's filtered still shows (and can be cleared).
  const active = $('#lib-active');
  const on = [lib.kind && { label: (LIB_KIND[lib.kind] || [lib.kind, lib.kind])[1], clear: () => { lib.kind = null; } }, lib.tag && { label: `#${lib.tag}`, clear: () => { lib.tag = null; } }].filter(Boolean);
  active.hidden = lib.filtersOpen || !on.length;
  active.replaceChildren(...on.map((f) => el('button', { type: 'button', class: 'lib-chip', 'aria-pressed': 'true', 'aria-label': `Stop filtering by ${f.label}`, onclick: () => { f.clear(); refreshLibrary(); } }, f.label, el('span', { 'aria-hidden': 'true' }, ' ×'))));
}

function clearFilters() {
  lib.kind = null;
  lib.tag = null;
  lib.query = '';
  $('#lib-search').value = '';
  refreshLibrary();
}

// ── the grid: a masonry, filled across (each card goes to the shortest column) ──

function layoutGrid(items) {
  const grid = $('#lib-grid');
  const width = grid.clientWidth || 900;
  const cols = columnsFor(width);
  lib.cols = cols;
  const colW = (width - LIB_GAP * (cols - 1)) / cols;
  const columns = Array.from({ length: cols }, () => el('div', { class: 'lib-col' }));
  const heights = new Array(cols).fill(0);
  for (const it of items) {
    let c = 0;
    for (let i = 1; i < cols; i++) if (heights[i] < heights[c] - 1) c = i;
    columns[c].append(libCard(it));
    const ratio = it.thumbPath && it.thumbW && it.thumbH ? it.thumbH / it.thumbW : null;
    heights[c] += (ratio ? colW * ratio + 34 : 132) + LIB_GAP;
  }
  grid.replaceChildren(...columns);
  if (lib.highlight) {
    const id = lib.highlight;
    lib.highlight = null;
    const card = grid.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (card) { card.classList.add('lib-new'); card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); setTimeout(() => card.classList.remove('lib-new'), 2400); }
  }
}

function libCard(it) {
  const k = LIB_KIND[it.kind] || ['Item', 'Items'];
  const hover = [it.site, ...(it.tags || []).slice(0, 3).map((t) => `#${t}`)].filter(Boolean).join('   ');
  const len = ['clip', 'audio', 'flpt'].includes(it.kind) && it.duration ? libLen(it.duration) : null;
  const attrs = { type: 'button', class: `lib-card k-${it.kind}${it.thumbPath ? '' : ' lib-text'}`, 'data-id': it.id, 'aria-label': `${it.title} (${k[0].toLowerCase()})`, onclick: () => openLibraryItem(it.id) };
  if (!it.thumbPath) {
    return el('button', attrs, el('span', { class: 'lib-plate' }, el('span', { class: 'lib-kind' }, k[0]), el('span', { class: 'lib-plate-title' }, it.title), it.site ? el('span', { class: 'lib-site' }, it.site) : null));
  }
  const img = el('img', { src: flpt.fileUrl(it.thumbPath, it.updatedAt || it.addedAt), alt: '', loading: 'lazy', decoding: 'async', width: String(it.thumbW || 600), height: String(it.thumbH || 338) });
  img.addEventListener('error', () => img.classList.add('lib-broken'), { once: true });
  return el('button', attrs,
    el('span', { class: 'lib-thumb' }, img,
      it.kind === 'video-link' ? el('span', { class: 'lib-play', 'aria-hidden': 'true' }) : null,
      len ? el('span', { class: 'lib-len' }, len) : null,
      hover ? el('span', { class: 'lib-hover', 'aria-hidden': 'true' }, hover) : null),
    el('span', { class: 'lib-title' }, it.title));
}

// ── one item ───────────────────────────────────────────────────────────────────────────────────────────────────

async function openLibraryItem(id) {
  buildLibrary();
  let it;
  try { it = await libCall(flpt.library.get, id); } catch (e) { libStatus(e.message, { bad: true }); return; }
  lib.open = it;
  renderDetail(it);
  const d = $('#lib-detail');
  if (!d.open) d.showModal();
  const media = d.querySelector('.lib-d-media');
  if (media) media.focus({ preventScroll: true });
}

function detailMedia(it) {
  const v = it.updatedAt || it.addedAt;
  const poster = it.thumbPath ? flpt.fileUrl(it.thumbPath, v) : null;
  if (it.filePath && PLAYABLE.test(it.filePath)) {
    return el('video', { controls: true, preload: 'metadata', playsinline: true, src: flpt.fileUrl(it.filePath, v), ...(poster ? { poster } : {}) });
  }
  if (it.filePath && SHOWABLE.test(it.filePath)) return el('img', { src: flpt.fileUrl(it.filePath, v), alt: it.title });
  const pic = it.snapshotPath || it.thumbPath;
  if (pic) {
    const img = el('img', { src: flpt.fileUrl(pic, v), alt: it.title });
    if (it.kind === 'video-link') {
      return el('button', { type: 'button', class: 'lib-d-watch', 'aria-label': `Watch on ${it.source.site || 'the web'}`, onclick: () => flpt.library.openSource(it.id) }, img, el('span', { class: 'lib-play big', 'aria-hidden': 'true' }));
    }
    return img;
  }
  return el('div', { class: 'lib-d-plate' }, el('span', { class: 'lib-kind' }, (LIB_KIND[it.kind] || ['Item'])[0]));
}

function renderDetail(it) {
  const d = $('#lib-detail');
  const title = el('input', { type: 'text', class: 'lib-d-title', value: it.title, 'aria-label': 'Title', maxlength: '300', spellcheck: 'false' });
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
  title.addEventListener('change', () => { if (title.value.trim()) saveDetail({ title: title.value.trim() }); else title.value = lib.open.title; });

  const url = it.source.url || (it.clip && it.clip.url) || '';
  const source = url ? el('p', { class: 'lib-d-source' },
    el('button', { type: 'button', class: 'linkish', title: url, onclick: () => flpt.library.openSource(it.id) }, `${it.source.site || libHost(url)} ↗`),
    it.source.author ? el('span', {}, ` · ${it.source.author}`) : null) : null;
  const moment = it.clip && (it.clip.start || it.clip.end)
    ? el('p', { class: 'lib-d-moment' }, `${libClock(it.clip.start)} – ${libClock(it.clip.end)}`, it.duration ? el('span', { class: 'muted' }, ` · ${libLen(it.duration)}`) : null)
    : null;
  const rights = it.source.rights ? el('p', { class: 'lib-d-rights' }, it.source.rights) : null;
  const desc = it.source.description ? el('p', { class: 'lib-d-desc' }, it.source.description) : null;

  const notes = el('textarea', { class: 'lib-d-notes', rows: '3', placeholder: 'Notes', 'aria-label': 'Notes' });
  notes.value = it.notes || '';
  let nt = null;
  notes.addEventListener('input', () => { clearTimeout(nt); nt = setTimeout(() => saveDetail({ notes: notes.value }), 700); });
  notes.addEventListener('blur', () => { clearTimeout(nt); if (lib.open && notes.value !== lib.open.notes) saveDetail({ notes: notes.value }); });

  const by = LIB_BY[it.addedBy] ? ` by ${LIB_BY[it.addedBy]}` : '';
  const made = it.source.generated; // B-roll and other generated media: what it cost
  const cost = made && made.costUsd != null ? ` · ${made.costUsd.toFixed(2)} US dollars` : '';
  const meta = el('p', { class: 'lib-d-meta' }, `Added ${libDate(it.addedAt)}${by}${cost}`, it.usedIn && it.usedIn.length ? ` · Used in ${it.usedIn.join(', ')}` : '', el('span', { class: 'lib-saved', id: 'lib-saved' }));
  const canOpen = it.filePath && (it.kind === 'document' || it.kind === 'audio' || !PLAYABLE.test(it.filePath) && !SHOWABLE.test(it.filePath));
  const actions = el('div', { class: 'lib-d-actions' },
    el('button', { type: 'button', class: 'ghost small', onclick: () => flpt.library.reveal(it.id) }, 'Show in Finder'),
    canOpen ? el('button', { type: 'button', class: 'ghost small', onclick: () => flpt.library.open(it.id) }, 'Open') : null,
    el('span', { class: 'lib-d-spacer' }),
    el('button', { type: 'button', class: 'ghost small lib-d-remove', onclick: () => removeItem(it) }, 'Remove'));

  d.setAttribute('aria-label', it.title);
  d.replaceChildren(
    el('div', { class: `lib-d-media k-${it.kind}`, tabindex: '-1' }, detailMedia(it)),
    el('div', { class: 'lib-d-body' }, title, source, moment, rights, desc, tagEditor(it), notes, el('div', { class: 'lib-d-foot' }, meta, actions)),
    el('button', { type: 'button', class: 'lib-d-close', 'aria-label': 'Close', onclick: () => d.close() }, '×'));
}

function tagEditor(it) {
  let tags = [...(it.tags || [])];
  const box = el('div', { class: 'lib-d-tags' });
  const input = el('input', { type: 'text', class: 'lib-tag-input', 'aria-label': 'Add a tag', spellcheck: 'false', autocomplete: 'off' });
  const take = () => {
    const parts = input.value.split(',').map((t) => t.trim().replace(/^#/, '').toLowerCase()).filter(Boolean);
    input.value = '';
    const before = tags.length;
    for (const t of parts) if (!tags.includes(t)) tags.push(t);
    return tags.length !== before;
  };
  const draw = () => {
    input.placeholder = tags.length ? 'Add a tag' : 'Tags';
    box.replaceChildren(...tags.map((t) => el('span', { class: 'lib-tag' }, t,
      el('button', { type: 'button', 'aria-label': `Remove the tag ${t}`, onclick: () => { tags = tags.filter((x) => x !== t); draw(); saveDetail({ tags }); input.focus(); } }, '×'))), input);
  };
  input.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ',') && input.value.trim()) { e.preventDefault(); if (take()) { draw(); saveDetail({ tags }); } input.focus(); }
    else if (e.key === 'Enter') e.preventDefault();
    else if (e.key === 'Backspace' && !input.value && tags.length) { tags.pop(); draw(); saveDetail({ tags }); input.focus(); }
  });
  input.addEventListener('blur', () => { if (input.value.trim() && take()) { draw(); saveDetail({ tags }); } });
  draw();
  return box;
}

async function saveDetail(patch) {
  const it = lib.open;
  if (!it) return;
  try {
    lib.open = await libCall(flpt.library.update, it.id, patch);
    const s = document.getElementById('lib-saved');
    if (s) { s.textContent = ' · Saved'; clearTimeout(saveDetail.t); saveDetail.t = setTimeout(() => { s.textContent = ''; }, 1600); }
  } catch (e) {
    const s = document.getElementById('lib-saved');
    if (s) s.textContent = ` · ${e.message}`;
  }
}

async function removeItem(it) {
  try {
    const r = await libCall(flpt.library.remove, it.id);
    if (!r.removed) return;
    $('#lib-detail').close();
    libStatus('Moved to the Trash.');
    refreshLibrary();
  } catch (e) { libStatus(e.message, { bad: true }); }
}

// ── adding ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** One quiet line under the header. sticky: stays until replaced; progress: 0–1 shows a thin bar. */
function libStatus(text, { bad = false, sticky = false, progress = null } = {}) {
  if (!lib.built) return;
  clearTimeout(lib.statusTimer);
  const t = $('#lib-status-text');
  t.textContent = text || '';
  t.className = bad ? 'bad' : '';
  const bar = $('#lib-status-bar');
  bar.hidden = progress == null;
  if (progress != null) bar.value = Math.round(progress * 100);
  if (text && !sticky) lib.statusTimer = setTimeout(() => { t.textContent = ''; bar.hidden = true; }, bad ? 9000 : 3500);
}

function reportAdd(r) {
  if (!r || r.cancelled) return;
  const parts = [];
  if (r.added) parts.push(r.added === 1 ? 'Added.' : `Added ${r.added}.`);
  if (r.duplicates) parts.push(r.duplicates === 1 && !r.added ? 'Already in your Library.' : `${r.duplicates} already here.`);
  if (r.failed && r.failed.length) parts.push(r.failed.length === 1 ? `${r.failed[0].name}: ${r.failed[0].error}` : `${r.failed.length} couldn't be added (${r.failed[0].name}: ${r.failed[0].error})`);
  libStatus(parts.join(' '), { bad: Boolean(r.failed && r.failed.length && !r.added && !r.duplicates) });
  if (r.items && r.items.length === 1) lib.highlight = r.items[0].id;
  refreshLibrary();
}

async function addFiles() {
  try { reportAdd(await libCall(flpt.library.addFiles)); } catch (e) { libStatus(e.message, { bad: true }); }
}

function showLinkForm() {
  hideBrollForm();
  const f = $('#lib-link');
  f.hidden = false;
  f.querySelector('input').focus();
}
function hideLinkForm() {
  const f = $('#lib-link');
  f.hidden = true;
  f.querySelector('input').value = '';
}

async function saveLinkFromForm(fromDrop) {
  const input = $('#lib-link input');
  const url = (fromDrop || input.value).trim();
  if (!url) { input.focus(); return; }
  const btn = $('#lib-link button[type="submit"]');
  btn.disabled = true;
  libStatus('Saving the link…', { sticky: true });
  try {
    const r = await libCall(flpt.library.addLink, url);
    hideLinkForm();
    libStatus(r.duplicate ? 'Already in your Library.' : 'Saved.');
    lib.highlight = r.item.id;
    await refreshLibrary();
  } catch (e) {
    libStatus(e.message, { bad: true });
  } finally {
    btn.disabled = false;
  }
}

// ── B-roll: one generated shot that pays off a line of the script. The main process prices it, asks for the OK in
// its own dialog and runs it through the spend broker (generate.js); this only shows and asks. ──

function brollForm() {
  const text = el('textarea', { rows: '2', maxlength: '1000', placeholder: 'A line from your script, or the shot you see', 'aria-label': 'A line or a shot' });
  const choose = (name, label, options, dflt) => el('select', { name, 'aria-label': label }, ...options.map(([v, t]) => el('option', { value: v, selected: v === dflt }, t)));
  // 10 s at 1080p unless changed (the main process picks the provider's default the first time)
  const fields = [choose('provider', 'Made on', [['kie', 'Kie.ai'], ['higgsfield', 'Higgsfield']]), choose('duration', 'Length', [['5', '5 s'], ['10', '10 s']], '10'),
    choose('resolution', 'Quality', [['720p', '720p'], ['1080p', '1080p']], '1080p')];
  for (const f of fields) f.addEventListener('change', () => quoteBroll());
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); hideBrollForm(); }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); makeBroll(); }
  });
  return el('form', { class: 'lib-broll', id: 'lib-broll', hidden: true, onsubmit: (e) => { e.preventDefault(); makeBroll(); } },
    text,
    el('div', { class: 'lib-broll-row' }, ...fields, el('span', { class: 'lib-broll-price', id: 'lib-broll-price', 'aria-live': 'polite' }), el('span', { class: 'lib-d-spacer' }),
      el('button', { type: 'button', class: 'ghost', onclick: hideBrollForm }, 'Cancel'),
      el('button', { type: 'submit', class: 'primary', id: 'lib-broll-make' }, 'Make it')));
}

function brollChoices() {
  const f = $('#lib-broll');
  return { text: f.querySelector('textarea').value, provider: f.elements.provider.value, duration: Number(f.elements.duration.value), resolution: f.elements.resolution.value };
}

function showBrollForm() {
  hideLinkForm();
  const f = $('#lib-broll');
  const first = f.hidden && !f.dataset.shown;
  f.hidden = false;
  f.dataset.shown = '1';
  f.querySelector('textarea').focus();
  quoteBroll(first);
}

function hideBrollForm() { $('#lib-broll').hidden = true; }

/** The price for the current choices, from the main process (or why it can't be made yet). first: use the settings' provider. */
async function quoteBroll(first = false) {
  const seq = (quoteBroll.seq = (quoteBroll.seq || 0) + 1);
  const f = $('#lib-broll');
  const price = $('#lib-broll-price');
  const make = $('#lib-broll-make');
  const choices = brollChoices();
  let q;
  try { q = await libCall(flpt.library.brollQuote, first ? { ...choices, provider: null } : choices); } catch (e) {
    if (seq === quoteBroll.seq) { price.replaceChildren(el('span', { class: 'bad' }, e.message)); make.disabled = true; }
    return;
  }
  if (seq !== quoteBroll.seq) return;
  if (first) f.elements.provider.value = q.provider;
  if (q.keyMissing) {
    price.replaceChildren(`Add a ${q.name} key in `, el('button', { type: 'button', class: 'linkish', onclick: () => { showView('setup'); go('keys'); } }, 'Setup → Keys'));
    make.disabled = true;
  } else if (q.problem) {
    price.replaceChildren(el('span', { class: 'bad' }, q.problem));
    make.disabled = true;
  } else {
    price.textContent = `About ${q.usd.toFixed(2)} US dollars`;
    make.disabled = lib.brollBusy;
  }
}

async function makeBroll() {
  const f = $('#lib-broll');
  const choices = brollChoices();
  if (!choices.text.trim()) { f.querySelector('textarea').focus(); return; }
  if (lib.brollBusy || $('#lib-broll-make').disabled) return;
  lib.brollBusy = true;
  $('#lib-broll-make').disabled = true;
  try {
    const r = await libCall(flpt.library.makeBroll, choices);
    if (r.cancelled) return;
    f.querySelector('textarea').value = '';
    hideBrollForm();
    lib.highlight = r.item.id;
    libStatus('Added.');
    refreshLibrary();
  } catch (e) {
    const later = /keep (trying|checking)|check again/.test(e.message); // still on its way: it lands when it's done
    libStatus(e.message, { bad: !later, sticky: later });
    if (!later) f.hidden = false; // the words are still there, to try again
  } finally {
    lib.brollBusy = false;
    if (!f.hidden) quoteBroll();
  }
}

/** Progress from the main process, for a shot made now or one picked up after a restart. */
function brollProgress(ev) {
  if (!lib.built || !ev || ev.kind === 'scene') return; // the Scenes step's stills and shots show on the episode
  const where = ev.name || 'the provider';
  switch (ev.phase) {
    case 'starting': hideBrollForm(); libStatus(`B-roll · starting at ${where}`, { sticky: true, progress: 0 }); break;
    case 'queued': libStatus(`B-roll · queued at ${where}`, { sticky: true, progress: 0 }); break;
    case 'running': libStatus(ev.progress != null ? `B-roll · ${Math.round(ev.progress * 100)} %` : `B-roll · ${libLen(ev.elapsed)}`, { sticky: true, progress: ev.progress }); break;
    case 'saving': libStatus('B-roll · saving', { sticky: true, progress: 1 }); break;
    case 'done': lib.highlight = ev.itemId; libStatus('Added.'); refreshLibrary(); break;
    case 'failed': libStatus(ev.message, { bad: true }); break;
    case 'waiting': libStatus(ev.message, { sticky: true }); break;
    default: break;
  }
}

async function importCutaway() {
  libStatus('Importing your Cutaway Library…', { sticky: true, progress: 0 });
  try {
    const r = await libCall(flpt.library.importCutaway);
    const extra = [r.skipped ? `${r.skipped} already here` : '', r.failed.length ? `${r.failed.length} couldn't be copied` : ''].filter(Boolean).join(', ');
    libStatus(`Imported ${r.added} from your Cutaway Library${extra ? ` (${extra})` : ''}.`, { bad: Boolean(r.failed.length && !r.added) });
  } catch (e) {
    libStatus(e.message, { bad: true });
  }
  refreshLibrary();
}

// Drag files (or a link) from the Finder or a browser onto the Library.
const libDragKind = (e) => {
  const types = e.dataTransfer ? [...e.dataTransfer.types] : [];
  return types.includes('Files') ? 'files' : types.includes('text/uri-list') ? 'link' : null;
};
document.addEventListener('dragenter', (e) => {
  if (!lib.built || !libVisible() || !libDragKind(e)) return;
  e.preventDefault();
  lib.dragDepth += 1;
  $('#lib-drop').hidden = false;
});
document.addEventListener('dragover', (e) => {
  if (!lib.built || !libVisible() || !libDragKind(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
document.addEventListener('dragleave', () => {
  if (!lib.built || !libVisible()) return;
  lib.dragDepth = Math.max(0, lib.dragDepth - 1);
  if (!lib.dragDepth) $('#lib-drop').hidden = true;
});
document.addEventListener('drop', async (e) => {
  if (!lib.built || !libVisible()) return;
  const kind = libDragKind(e);
  if (!kind) return;
  e.preventDefault();
  lib.dragDepth = 0;
  $('#lib-drop').hidden = true;
  const files = [...e.dataTransfer.files];
  if (files.length) {
    libStatus(files.length > 2 ? `Adding ${files.length}…` : 'Adding…', { sticky: true });
    try { reportAdd(await libCall(flpt.library.addDropped, files)); } catch (err) { libStatus(err.message, { bad: true }); }
    return;
  }
  const url = (e.dataTransfer.getData('text/uri-list') || '').split(/\r?\n/).find((l) => /^https?:\/\//i.test(l.trim()));
  if (url) saveLinkFromForm(url);
});

document.addEventListener('click', (e) => { if (!e.target.closest('.lib-add')) closeMenus(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMenus();
  if (e.key === 'f' && (e.metaKey || e.ctrlKey) && lib.built && libVisible() && !$('#lib-detail').open) {
    e.preventDefault();
    $('#lib-search').focus();
  }
});

// ── live updates ─────────────────────────────────────────────────────────────────────────────────────────────

flpt.library.onChanged(() => { if (lib.built && libVisible()) refreshLibrary(); else lib.stale = true; });
flpt.library.onProgress((p) => {
  if (!lib.built) return;
  if (p.finished) return;
  if (p.total) libStatus(`${p.what === 'import' ? 'Importing' : 'Adding'} ${Math.min(p.done + 1, p.total)} of ${p.total}…`, { sticky: true, progress: p.done / p.total });
});
flpt.library.onShow((p) => { showView('library'); if (p && p.id) openLibraryItem(p.id); });
flpt.library.onGenerate(brollProgress);

views.onShow.library = () => {
  buildLibrary();
  refreshLibrary();
  $('#library-main').focus({ preventScroll: true });
};
