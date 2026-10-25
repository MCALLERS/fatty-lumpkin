'use strict';
/* global flpt, el */
// ui-share.js · Save as style and Share (PLAN §2.10.2–§2.10.3, §3.3 S8b's ⋯ and S15, draft-ux §7.5; W3-02). Main does
// the work (flpt.share); the page names a piece, a Mine style or a package, never a path.
//   Save as style, in the Studio's ⋯ (slot studio.more): on an approved piece, free. It becomes a Mine style, the piece
//     its private demo (it stays on this Mac); then Share is one press away.
//   FLPT_UI.components.shareSheet.open({ style }) · close() · state()
//     The Share sheet (Theater): the neutral package main built (its files, its poster, its loop on ▶: rendered from the
//     package's own demo, never the talk), the ⚑ ticks (I MADE THIS…; THE REFERENCE IS MINE. when the style used one),
//     then Export (a .flptstyle in the deliverables folder; Show in Finder). Send for review shows only once the review
//     queue is open (caps.share holds 'queue', D15/W4-09); until then Export is the one action. Nothing is sent or
//     written before both ticks the style needs. A style saved from a talk that has since gone, with no print of it
//     left, says so (its words couldn't be checked).
// Esc closes (and drops the package).
(() => {
  const UI = window.FLPT_UI;
  if (!UI || !UI.components || !window.flpt || !flpt.share || typeof flpt.share.build !== 'function') return;

  const unwrap = async (p) => { const r = await p; if (!r || !r.ok) throw new Error((r && r.error) || 'Something went wrong.'); return r.value; };
  const url = (p) => (p && typeof flpt.fileUrl === 'function' ? flpt.fileUrl(p) : '');
  const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const btn = (label, attrs = {}) => el('button', { type: 'button', ...attrs }, label);
  // how Share leaves this surface (ext/refs.js's caps): Send for review only where the review queue is open
  let caps = null;
  if (flpt.app && typeof flpt.app.caps === 'function') Promise.resolve(flpt.app.caps()).then((r) => { caps = r && r.ok ? r.value : null; if (root) paint(); }, () => {});
  const queueOpen = () => Boolean(caps && Array.isArray(caps.share) && caps.share.includes('queue'));
  /** A ⚑ line in two parts that break between them, never inside one (each part is a sentence or two). */
  const tickText = (...parts) => el('span', {}, ...parts.flatMap((t, i) => [i ? ' ' : null, el('span', { class: 'ss-seg' }, t)]).filter(Boolean));

  // ── the Share sheet ──
  const blank = () => ({ open: false, style: null, pkg: null, busy: '', err: '', mine: false, refs: false, playing: false, sent: null, file: null });
  let S = blank();
  let root = null;
  const R = {};

  function build() {
    R.title = el('h2', { class: 'rs-title' }, 'Share');
    const head = el('header', { class: 'rs-head' }, R.title, el('span', { class: 'rs-gap' }), btn('✕', { class: 'ghost small rs-close', 'aria-label': 'Close', title: 'Esc', onclick: () => close() }));
    R.media = el('div', { class: 'ss-media' });
    R.files = el('ul', { class: 'ss-files', 'aria-label': 'Files' });
    R.size = el('p', { class: 'hud ss-size' });
    R.mine = el('input', { type: 'checkbox', class: 'ss-tick-box' });
    R.mine.addEventListener('change', () => { S.mine = R.mine.checked; paint(); });
    R.refs = el('input', { type: 'checkbox', class: 'ss-tick-box' });
    R.refs.addEventListener('change', () => { S.refs = R.refs.checked; paint(); });
    R.tickMine = el('label', { class: 'ss-tick', 'data-trust': '' }, R.mine, tickText('⚑ I made this. Anyone may use it (MIT).', 'No one else\'s logos, characters or footage.'));
    R.tickRefs = el('label', { class: 'ss-tick', 'data-trust': '', hidden: true }, R.refs, tickText('⚑ The reference is mine.'));
    R.gone = el('p', { class: 'hud ss-gone', hidden: true }, 'The talk it came from is gone');
    R.send = btn('Send for review', { class: 'ghost', hidden: true, onclick: () => send() });
    R.export = btn('Export', { class: 'primary', onclick: () => exportIt() });
    R.status = el('p', { class: 'rs-status', role: 'status' });
    R.reveal = btn('Show in Finder', { class: 'ghost small', hidden: true, onclick: () => { if (S.file && typeof flpt.revealFile === 'function') flpt.revealFile(S.file); } });
    root = el('div', { class: 'rs-scrim', onclick: (e) => { if (e.target === root) close(); } },
      el('div', { class: 'rs ss', 'data-realm': 'theater', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Share' }, head,
        el('div', { class: 'ss-body' }, R.media, el('div', { class: 'ss-list' }, R.files, R.size, R.gone)),
        R.tickMine, R.tickRefs, el('div', { class: 'rs-actions' }, R.status, R.reveal, el('span', { class: 'rs-gap' }), R.send, R.export)));
    return root;
  }

  function paint() {
    if (!root) return;
    const p = S.pkg;
    R.title.textContent = p ? `Share · ${p.name || p.id}` : 'Share';
    // the package's poster, its loop on ▶ (rendered from the package's own demo)
    const m = p && p.media;
    let pic = null;
    if (m && m.loop && S.playing) pic = el('video', { class: 'ss-loop', src: url(m.loop), muted: false, playsinline: true, loop: true, autoplay: true, 'aria-label': 'Loop' });
    else if (m && m.poster) pic = el('img', { class: 'ss-poster', src: url(m.poster), alt: '' });
    else pic = el('div', { class: 'ss-poster ss-empty' });
    const play = m && m.loop ? btn(S.playing ? '❚❚' : '▶', { class: 'ghost small ss-play', 'aria-label': S.playing ? 'Stop' : 'Play', onclick: () => { S.playing = !S.playing; paint(); } }) : null;
    R.media.replaceChildren(pic, play);
    R.files.replaceChildren(...(p ? p.files : []).map((f) => el('li', {}, el('span', { 'data-content': '' }, f.name), el('span', { class: 'hud' }, kb(f.bytes)))));
    R.size.textContent = p ? `${p.files.length} files · ${kb(p.bytes)}` : '';
    R.tickRefs.hidden = !(p && p.refsUsed);
    R.gone.hidden = !(p && p.talkGone);
    R.send.hidden = !queueOpen();
    R.mine.checked = S.mine;
    R.refs.checked = S.refs;
    const ready = Boolean(p) && S.mine && (!p.refsUsed || S.refs) && !S.busy;
    R.send.disabled = !ready;
    R.export.disabled = !ready;
    R.mine.disabled = R.refs.disabled = !p || Boolean(S.busy);
    R.status.textContent = S.err || S.busy || S.sent || (S.file ? `Exported · ${S.file.split('/').pop()}` : '');
    R.status.classList.toggle('bad', Boolean(S.err));
    R.status.toggleAttribute('data-content', Boolean(S.err)); // an error is main's (or the review queue's) own words
    R.reveal.hidden = !S.file;
  }

  const ticks = () => ({ attest: S.mine === true, refsAttested: S.refs === true });
  async function send() {
    S.err = '';
    S.busy = '…';
    paint();
    try {
      const r = await unwrap(flpt.share.send(S.pkg.token, ticks()));
      S.sent = r.label || (r.status === 'sent' ? 'Sent for review' : r.status);
      if (r.file) S.file = r.file; // the queue was out of reach: exported instead (Show in Finder)
    } catch (e) { S.err = e.message; }
    S.busy = '';
    paint();
  }
  async function exportIt() {
    S.err = '';
    S.busy = 'Exporting…';
    paint();
    try { const r = await unwrap(flpt.share.export(S.pkg.token, ticks())); S.file = r.file; } catch (e) { S.err = e.message; }
    S.busy = '';
    paint();
  }

  function onKey(e) { if (e.key === 'Escape' && S.open) { e.preventDefault(); close(); } }
  let opened = 0; // which opening a package that comes back belongs to (the sheet may have closed meanwhile)
  async function open({ style } = {}) {
    if (S.open) close();
    const n = ++opened;
    S = { ...blank(), open: true, style, busy: 'Building the package…' };
    document.body.append(build());
    document.addEventListener('keydown', onKey);
    paint();
    let pkg = null;
    let err = '';
    try { pkg = await unwrap(flpt.share.build(style)); } catch (e) { err = e.message; }
    if (n !== opened || !S.open) { if (pkg) flpt.share.discard(pkg.token).catch(() => {}); return; }
    S.pkg = pkg;
    S.err = err;
    S.busy = '';
    paint();
  }
  function close() {
    if (!S.open) return;
    opened += 1;
    const token = S.pkg && S.pkg.token;
    if (token && !S.file) flpt.share.discard(token).catch(() => {});
    document.removeEventListener('keydown', onKey);
    if (root) root.remove();
    root = null;
    S = blank();
  }
  UI.components.shareSheet = {
    open, close,
    /** What the sheet shows (QA and tests). */
    state: () => ({ open: S.open, style: S.style, token: S.pkg ? S.pkg.token : null, files: S.pkg ? S.pkg.files.length : 0, refsUsed: Boolean(S.pkg && S.pkg.refsUsed),
      talkGone: Boolean(S.pkg && S.pkg.talkGone), queue: queueOpen(), media: Boolean(S.pkg && S.pkg.media), mine: S.mine, refs: S.refs, busy: S.busy, err: S.err, sent: S.sent, file: S.file }),
  };

  // ── Save as style, in the Studio's ⋯ (slot studio.more) ──
  const slot = UI.slots && UI.slots['studio.more'];
  if (!slot || typeof flpt.share.saveAsStyle !== 'function') return;
  let cur = null; // { episode, key, approved }
  let saved = null; // { key, style } once this piece is saved, this session
  let busy = false;
  let err = '';
  // one node of the slot's, replaced in place: whatever else is in the slot stays (the shell's slot rule)
  let rowNode = null;
  const putRow = (node) => {
    if (rowNode && rowNode.parentNode === slot) { if (node) rowNode.replaceWith(node); else rowNode.remove(); } else if (node) slot.append(node);
    rowNode = node;
  };
  function paintSlot() {
    if (!cur || !cur.approved) { putRow(null); return; }
    const mine = saved && saved.key === `${cur.episode}\0${cur.key}` ? saved.style : null;
    const row = el('div', { class: 'studio-row ss-save' });
    if (mine) {
      row.append(el('span', { class: 'hud ss-saved', title: mine.name }, 'Saved'), btn('Share', { class: 'ghost small', onclick: () => UI.components.shareSheet.open({ style: mine.id }) }));
    } else {
      row.append(btn(busy ? 'Saving…' : 'Save as style', { class: 'ghost small', disabled: busy, title: 'Free: the piece as a style of your own', onclick: () => save() }));
    }
    if (err) row.append(el('span', { class: 'rs-status bad', 'data-content': '' }, err));
    putRow(row);
  }
  async function save() {
    if (!cur) return;
    busy = true;
    err = '';
    paintSlot();
    const at = cur;
    try {
      const r = await unwrap(flpt.share.saveAsStyle(at.episode, at.key));
      saved = { key: `${at.episode}\0${at.key}`, style: r.style };
    } catch (e) { err = e.message; }
    busy = false;
    paintSlot();
  }
  slot.addEventListener('studio:piece', (e) => {
    const d = e && e.detail;
    if (!d) { cur = null; paintSlot(); return; }
    const v = d.view || {};
    const p = d.piece || {};
    const made = ['ok', 'stale'].includes(v.status);
    cur = { episode: d.episode, key: d.key, approved: made && Boolean(v.approved || p.stageApproved) };
    err = '';
    paintSlot();
  });
})();
