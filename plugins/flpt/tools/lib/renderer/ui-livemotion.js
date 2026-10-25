'use strict';
/* global flpt, el */
// ui-livemotion.js · the Live Motion wall (PLAN §3.3 S8a, draft-ux S8a; W2-05): FLPT_UI.panels.animate, in the Theater.
// Every piece drawn in code, in film order: the Motion Solos and Duets, the Solo ♪ interstitials, the Cosmos and cut
// scenes drawn in code (flpt.livemotion), and 0.7.1's marked slides for the animators (the episode's animate view).
//   the bar     N OF M READY · Make all · up to $X (every piece that needs its crew, within the plan's Claude budget:
//               a dialog only when that runs out) · Stop while the crews write · Approve all (the words on screen that
//               aren't in the script or the deck shown first) · Skip, when nothing was made
//   a card      its poster (the slide's picture; a between piece's name); hovered, its latest preview plays, muted, one
//               at a time (posters only under Pause motion and reduced motion); while its crew writes, ● WRITING, the
//               crew's latest line, and hovered, the Stage itself at thumbnail size, reloading as the files change
//               (not under Pause motion or reduced motion: the poster stays, and the Stage plays only on the Studio's ▶).
//               Its number, kind, style; Ready · Out of date · Didn't finish · Yours · ✓; Again.
// A card opens the Studio (ui-studio.js). Main does everything (api/livemotion.js, the flow's animate and approve).
(() => {
  const UI = window.FLPT_UI;
  if (!UI || !UI.panels) return;

  const pad2 = (n) => String(n).padStart(2, '0');
  const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`;
  const unwrap = async (p) => { const r = await p; if (!r || !r.ok) throw new Error((r && r.error) || 'Something went wrong.'); return r.value; };
  const held = () => (typeof UI.motionHeld === 'function' ? UI.motionHeld() : false);
  const STYLE = (id) => String(id || '').replace(/-/g, ' ');
  const CHIP = { ok: ['Ready', 'st-review'], stale: ['Out of date', 'st-stale'], failed: ['Didn\'t finish', 'st-error'], yours: ['Yours', 'st-approved'] };

  let cur = null; // the wall on screen: { ctx, dir, root, pieces }
  const fetched = new Map(); // episode → pieces, where the episode's view carries none (a surface without the extension)
  const lines = new Map(); // `${dir}\n${key}` → the crew's latest line
  const busy = new Map(); // episode → what this window started ('make', 'approve')

  // ── the pieces, as the wall and the Studio see them ──
  /** Every piece drawn in code, in film order: Live Motion's own, then 0.7.1's animator slides among them. */
  function piecesOf(v) {
    const lm = v.livemotion && Array.isArray(v.livemotion.pieces) ? v.livemotion.pieces : fetched.get(v.dir) || [];
    const at = (rel) => (rel ? `${v.dir}/presentation/${rel}` : null);
    const live = lm.map((p) => ({ ...p, source: 'livemotion', posterAbs: at(p.poster), previewAbs: at(p.preview), place: p.placement === 'slide' ? p.n || 0 : (p.afterN || 0) + 0.5 }));
    const cat = Array.isArray(v.catalog) ? v.catalog : [];
    const per = v.animate && v.animate.perSlideUsd;
    const anim = (v.animate && Array.isArray(v.animate.slides) ? v.animate.slides : []).map((a) => ({
      source: 'animator', key: `animator:${a.n}`, kind: 'animator', tile: (cat.find((m) => m.id === a.module) || {}).tile || a.module || 'Animation', n: a.n, id: a.id,
      title: a.brief || '', status: a.theirs ? 'yours' : a.status === 'running' ? 'running' : a.made ? (a.outdated ? 'stale' : 'ok') : a.status === 'error' ? 'failed' : 'todo',
      preview: a.preview || null, previewAt: a.previewAt || null, previewAbs: a.preview || null, posterAbs: a.picture || null, error: a.error || a.note || null,
      perSlideUsd: per, capUsd: per, theirs: Boolean(a.theirs), approved: false, place: a.n, takes: [],
    }));
    return [...live, ...anim].sort((a, b) => a.place - b.place || (a.source === b.source ? 0 : a.source === 'livemotion' ? -1 : 1));
  }
  const lmRunning = (v) => Boolean(v.livemotion && v.livemotion.running);

  // ── hover: one card at a time plays its preview; a card whose crew writes shows the Stage itself ──
  let hover = null; // { card, video }
  let peek = null; // { card, key, anchor, off }
  function endHover() {
    if (!hover) return;
    if (hover.video) { hover.video.pause(); hover.video.remove(); }
    hover.card.classList.remove('playing');
    hover = null;
  }
  function startHover(card, p) {
    if (hover && hover.card === card) return;
    endHover();
    if (!p.previewAbs || held() || (UI.components.studio && UI.components.studio.isOpen())) return;
    const media = card.querySelector('.lm-media');
    // an ambient loop while hovered: app.js plays it while it's on screen and nothing holds motion (Pause motion,
    // reduced motion, a hidden or blurred window), and puts it back to its poster when something does
    const v = el('video', { class: 'lm-video', src: flpt.fileUrl(p.previewAbs, p.previewAt || p.updatedAt || null), playsinline: true, loop: true, preload: 'auto', 'data-ambient': '' });
    v.muted = true; // the attribute alone doesn't mute a video made by script
    media.append(v);
    card.classList.add('playing');
    hover = { card, video: v };
  }
  const inside = (n, x, y) => { const r = n.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
  function endPeek() {
    if (!peek) return;
    const p = peek;
    peek = null;
    if (p.off) p.off();
    if (p.anchor) p.anchor.remove();
    p.card.classList.remove('peeking');
    const st = UI.components.stage;
    if (st && !(UI.components.studio && UI.components.studio.isOpen())) st.close().catch(() => {});
  }
  const studioOpen = () => Boolean(UI.components.studio && UI.components.studio.isOpen());
  async function startPeek(card, p, dir) {
    if ((peek && peek.card === card) || !UI.components.stage || !flpt.studio || studioOpen()) return;
    endPeek();
    if (held()) return; // Pause motion, reduced motion: the card keeps its poster
    const anchor = UI.anchor('stage', { class: 'lm-anchor' });
    card.querySelector('.lm-media').append(anchor);
    card.classList.add('peeking');
    const me = { card, key: p.key, anchor, off: null };
    peek = me;
    // muted, playing, from the top, as soon as it's ready (and again after each reload while the crew writes)
    me.off = UI.components.stage.on((kind, x) => {
      if (peek !== me || kind !== 'event' || !x || x.ev !== 'ready') return;
      if (held()) { endPeek(); return; }
      UI.components.stage.send({ cmd: 'sound', on: false }).catch(() => {});
      UI.components.stage.send({ cmd: 'play' }).catch(() => {});
    });
    try { await unwrap(flpt.studio.open(dir, p.key, 0)); } catch { if (peek === me) endPeek(); }
    // the pointer left before the Stage took the piece: endPeek's close came first, so close it now (unless another
    // card's peek or the Studio has the Stage by then)
    if (!peek && !studioOpen()) UI.components.stage.close().catch(() => {});
  }
  // the Stage's native view takes the pointer over it, so a card it sits on hears mouseleave: the pointer is still
  // over the card until the page hears it somewhere else
  document.addEventListener('mousemove', (e) => { if (peek && !inside(peek.card, e.clientX, e.clientY)) endPeek(); }, true);
  addEventListener('blur', () => { endPeek(); endHover(); });
  document.addEventListener('flpt:motion', (e) => { if (e.detail && e.detail.held) { endHover(); endPeek(); } });

  // ── the crews' lines and the wall's refresh ──
  let refreshTimer = null;
  let lastRefresh = 0;
  /** The wall again, from main (at most every 600 ms while events stream in). */
  function refreshSoon() {
    if (!cur || !cur.root.isConnected) return;
    clearTimeout(refreshTimer);
    const wait = Math.max(0, 600 - (Date.now() - lastRefresh));
    refreshTimer = setTimeout(() => {
      if (!cur || !cur.root.isConnected) return;
      lastRefresh = Date.now();
      if (!cur.ctx.view.livemotion && flpt.livemotion) fetchPieces(cur.ctx).catch(() => {});
      else cur.ctx.refresh();
    }, wait);
  }
  if (window.flpt && flpt.livemotion && typeof flpt.livemotion.onChanged === 'function') {
    flpt.livemotion.onChanged((ev) => { if (cur && (!ev || !ev.dir || ev.dir === cur.dir)) refreshSoon(); });
  }
  if (window.flpt && typeof flpt.onAgent === 'function') {
    flpt.onAgent((ev) => {
      if (!ev || ev.stage !== 'animate') return;
      const key = ev.piece || (ev.slide != null ? `animator:${ev.slide}` : null);
      if (!key) return;
      const line = UI.components.crewLine ? UI.components.crewLine(ev) : null;
      if (line) lines.set(`${ev.dir}\n${key}`, line);
      if (!cur || ev.dir !== cur.dir || !cur.root.isConnected) return;
      const n = cur.root.querySelector(`.lm-card[data-key="${CSS.escape(key)}"] .lm-line`);
      if (n && line) n.textContent = line;
      if (ev.kind === 'done' || ev.kind === 'result') refreshSoon();
    });
  }
  async function fetchPieces(ctx) {
    const v = await unwrap(flpt.livemotion.view(ctx.dir));
    fetched.set(ctx.dir, v.pieces || []);
    if (cur && cur.dir === ctx.dir) ctx.render();
  }

  // ── the actions ──
  /** Make every piece that needs its crew: Live Motion's pieces first, then the animators' marked slides. */
  async function makeAll(ctx, pieces) {
    const dir = ctx.dir;
    if (busy.has(dir)) return;
    busy.set(dir, 'make');
    ctx.render();
    let msg = null;
    let bad = false;
    let spent = 0;
    try {
      const lm = pieces.filter((p) => p.source === 'livemotion' && ['todo', 'failed', 'stale'].includes(p.status));
      if (lm.length) {
        const run = flpt.livemotion.run(dir);
        setTimeout(() => refreshSoon(), 400); // the crews are under way once main has reserved their caps
        const r = await unwrap(run);
        if (r && r.cancelled) msg = 'Not approved, so nothing ran and nothing was spent.';
        else { spent += Number(r && r.costUsd) || 0; if (r && r.ok === false && r.error) { msg = r.error; bad = true; } }
      }
      const marks = pieces.filter((p) => p.source === 'animator' && ['todo', 'failed', 'stale'].includes(p.status));
      if (!msg && marks.length && ctx.view.animate && ctx.view.animate.available) {
        const r = await unwrap(flpt.animate(dir, {}));
        if (r && r.cancelled) msg = 'Not approved, so nothing ran and nothing was spent.';
        else { spent += Number(r && r.costUsd) || 0; if (r && !r.ok && r.error) { msg = r.error; bad = true; } }
      }
      if (!msg) msg = `Done, for ${usd(spent)}.`;
    } catch (e) { msg = e.message; bad = true; }
    busy.delete(dir);
    if (cur && cur.dir === dir && cur.root.isConnected) ctx.flash(msg, bad);
    if (cur && cur.dir === dir) await ctx.refresh();
  }
  async function stopAll(ctx, pieces) {
    try {
      if (pieces.some((p) => p.source === 'livemotion' && p.status === 'running')) await unwrap(flpt.livemotion.cancel(ctx.dir));
      if (pieces.some((p) => p.source === 'animator' && p.status === 'running')) await flpt.cancelStage(ctx.dir);
    } catch (e) { ctx.flash(e.message); }
  }
  /** One piece's crew again (Live Motion's), or its animator. */
  async function againOne(ctx, p) {
    const dir = ctx.dir;
    if (busy.has(dir)) return;
    busy.set(dir, 'make');
    ctx.render();
    let msg = null;
    let bad = false;
    try {
      const run = p.source === 'animator' ? flpt.animate(dir, { slide: p.n }) : flpt.livemotion.run(dir, p.key);
      setTimeout(() => refreshSoon(), 400);
      const r = await unwrap(run);
      if (r && r.cancelled) msg = 'Not approved, so nothing ran and nothing was spent.';
      else if (r && r.ok === false && r.error) { msg = r.error; bad = true; }
    } catch (e) { msg = e.message; bad = true; }
    busy.delete(dir);
    if (msg && cur && cur.dir === dir && cur.root.isConnected) ctx.flash(msg, bad);
    if (cur && cur.dir === dir) await ctx.refresh();
  }
  /** Approve Live Motion: the on-screen words that aren't in the script or the deck first, then the stage. */
  async function approveAll(ctx, pieces) {
    // every piece the stage's approval approves (made: ok or out of date) and not yet approved alone
    const words = [...new Set(pieces.filter((p) => p.source === 'livemotion' && ['ok', 'stale'].includes(p.status) && !p.approved).flatMap((p) => p.unlisted || []))];
    const confirm = UI.components.studio && UI.components.studio.confirmWords;
    if (words.length && confirm && !(await confirm(words))) return;
    endPeek();
    endHover();
    await ctx.approve('animate');
  }

  // ── a card ──
  function card(ctx, p, running) {
    const v = ctx.view;
    const live = p.status === 'running';
    const media = el('div', { class: 'lm-media' });
    if (p.posterAbs) media.append(el('img', { class: 'lm-poster', src: flpt.fileUrl(p.posterAbs, v.slidesAt), alt: '', loading: 'lazy' }));
    // no picture yet: the piece's own name (an animator slide's brief is a paragraph: its number, the brief on hover)
    else media.append(el('span', { class: 'lm-ph', 'data-content': '', title: p.source === 'animator' ? p.title || '' : false },
      p.placement === 'between' ? `${p.kind === 'interstitial' ? '♪ ' : ''}${p.id}` : p.source === 'animator' ? `Slide ${p.n}` : p.title || ''));
    if (live) media.append(el('span', { class: 'hud lm-writing' }, el('i', { class: 'lm-dot' }), 'WRITING'));
    const chip = live ? null : p.approved ? ['✓', 'st-approved'] : p.look ? ['Needs a look', 'st-stale'] : CHIP[p.status];
    if (chip) media.append(el('span', { class: `chip lm-chip ${chip[1]}`, title: p.approved ? 'Approved' : !live && p.look ? p.look.join('\n') : '' }, chip[0]));
    const canOpen = live || ['ok', 'stale', 'failed'].includes(p.status) || (p.source === 'animator' && Boolean(p.previewAbs));
    const label = [p.n ? pad2(p.n) : p.id, p.tile, p.style && p.style.id ? STYLE(p.style.id) : null, p.seconds ? `0:${pad2(p.seconds)}` : null].filter(Boolean).join(' · ');
    const open = el('button', { type: 'button', class: 'lm-open', 'aria-label': `${label}${canOpen ? '' : ' (not made yet)'}`, disabled: !canOpen, 'data-shot': p.shot || false,
      onclick: () => { endPeek(); endHover(); UI.components.studio.open({ dir: ctx.dir, key: p.key, pieces: cur ? cur.pieces : [p], from: open, approved: ctx.status === 'approved' }); } }, media);
    const line = lines.get(`${ctx.dir}\n${p.key}`);
    const meta = el('div', { class: 'lm-meta' },
      el('span', { class: 'hud lm-label', title: p.title || '' }, label),
      live ? el('span', { class: 'lm-line muted', 'data-content': '' }, line || '') : (p.error && p.status === 'failed' ? el('span', { class: 'lm-line muted bad', 'data-content': '', title: p.error }, p.error)
        : p.note ? el('span', { class: 'lm-line muted', 'data-content': '' }, p.note) : null));
    const acts = [];
    const busyNow = busy.has(ctx.dir) || running;
    if (!live && ['ok', 'stale', 'failed'].includes(p.status) && ctx.status !== 'approved') {
      acts.push(el('button', { type: 'button', class: 'ghost small', disabled: busyNow, title: p.capUsd ? `Up to ${usd(p.capUsd)} of Claude usage` : '', onclick: () => againOne(ctx, p) }, 'Again'));
    }
    const n = el('div', { class: `lm-card${live ? ' live' : ''}`, 'data-key': p.key, 'data-status': live ? 'running' : p.status, title: p.error || '' },
      open, meta, acts.length ? el('div', { class: 'lm-acts' }, ...acts) : null);
    n.addEventListener('mouseenter', () => { if (live) startPeek(n, p, ctx.dir); else startHover(n, p); });
    n.addEventListener('mouseleave', (e) => {
      if (peek && peek.card === n && inside(n, e.clientX, e.clientY)) return; // the Stage's view took the pointer
      if (peek && peek.card === n) endPeek();
      if (hover && hover.card === n) endHover();
    });
    open.addEventListener('focus', () => { if (!live) startHover(n, p); });
    open.addEventListener('blur', () => { if (hover && hover.card === n) endHover(); });
    return n;
  }

  // ── the panel ──
  function render(ctx) {
    const v = ctx.view;
    endPeek();
    endHover();
    if (!v.livemotion && !fetched.has(v.dir) && flpt.livemotion && typeof flpt.livemotion.view === 'function') fetchPieces(ctx).catch(() => {});
    if (!ctx.canRun('animate') && ctx.status !== 'approved') return [el('p', { class: 'note' }, 'Waiting on the script.')];
    const pieces = piecesOf(v);
    const running = lmRunning(v) || ctx.status === 'running' || pieces.some((p) => p.status === 'running');
    const root = el('div', { class: 'lm-wall-view' });
    cur = { ctx, dir: v.dir, root, pieces };
    if (!pieces.length) {
      root.append(el('p', { class: 'note' }, 'Nothing in this deck is drawn in code.'));
      if (ctx.status !== 'approved') root.append(el('div', { class: 'actions' }, el('button', { type: 'button', class: 'primary', onclick: () => ctx.approve('animate') }, 'Continue')));
      return [root];
    }
    const made = pieces.filter((p) => ['ok', 'stale', 'yours'].includes(p.status));
    const ready = pieces.filter((p) => p.status === 'ok' || p.status === 'yours').length;
    const avail = !v.animate || v.animate.available !== false;
    const todo = pieces.filter((p) => ['todo', 'failed', 'stale'].includes(p.status) && (p.source === 'livemotion' || avail));
    const cost = todo.reduce((a, p) => a + (Number(p.capUsd) || 0), 0);
    const acts = [];
    const mine = busy.get(v.dir);
    const jazzing = Boolean(v.jazz && v.jazz.running); // Jazz is playing through: the rail's Stop is the one action
    if (ctx.status !== 'approved') {
      if (running) acts.push(el('button', { type: 'button', class: 'ghost', onclick: () => stopAll(ctx, pieces) }, 'Stop'));
      else if (!jazzing) {
        if (todo.length) acts.push(el('button', { type: 'button', class: 'primary', disabled: Boolean(mine), onclick: () => makeAll(ctx, pieces) }, cost ? `Make all · up to ${usd(cost)}` : 'Make all'));
        if (made.length) acts.push(el('button', { type: 'button', class: todo.length ? 'ghost' : 'primary', disabled: Boolean(mine), onclick: () => approveAll(ctx, pieces) }, 'Approve all'));
        else acts.push(el('button', { type: 'button', class: 'ghost', disabled: Boolean(mine), onclick: () => ctx.approve('animate') }, 'Skip'));
      }
    }
    const count = el('span', { class: `hud lm-count${running ? ' live' : ''}` }, running ? el('i', { class: 'lm-dot' }) : null, `${ready} of ${pieces.length} ready`);
    root.append(el('div', { class: 'lm-bar' }, count, el('span', { class: 'lm-gap' }), ...acts));
    if (!avail && pieces.some((p) => p.source === 'animator' && p.status === 'todo')) root.append(el('p', { class: 'note' }, 'Animations need HyperFrames (Setup → Tools).'));
    root.append(el('div', { class: 'lm-wall' }, ...pieces.map((p) => card(ctx, p, running))));
    if (ctx.record && ctx.record.costUsd != null && ctx.status !== 'todo' && !running) root.append(el('p', { class: 'muted lm-cost' }, `Last run: ${usd(ctx.record.costUsd)} of Claude usage.`));
    return [root];
  }

  UI.panels.animate = { realm: 'theater', render };
  /** For QA and the Studio: the wall's pieces now (film order), as the Studio is handed them. */
  UI.components.liveMotionWall = { pieces: () => (cur ? cur.pieces.slice() : []), dir: () => (cur ? cur.dir : null) };
})();
