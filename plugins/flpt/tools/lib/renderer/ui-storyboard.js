'use strict';
/* global flpt, el, md */
// ui-storyboard.js · the Storyboard (PLAN §2.8, §3.3 S5a–S5b, draft-ux S5; W2-04): FLPT_UI.panels.storyboard.
//   the totals line      `5:02 · $52 · LIVE MOTION 38 %` (the rest in its tooltip), the status lines in grey, the plan
//                        against the script once there is one
//   the strip            one segment per shot, its width its seconds, its colour its module's family; Live Motion
//                        segments carry a gold hairline and a 16 px loop that plays while that segment is hovered
//                        (one live thing at a time: the focused shot's loop waits). Click, Enter or Space selects;
//                        drag reorders; drag a slide's right edge onto its neighbour to merge (or ⌘-click two, then
//                        M); a gap's + adds a Solo ♪ or a cut scene. While the crew polishes, a gold shimmer.
//   arriving             Let FLPT play jazz (a playhead sweeps the strip, then the plan's approval) · User directed;
//                        the same two ways whenever a plan that isn't Directed waits on its approval (a Jazz plan an
//                        edit or a change before it re-opened), so an unapproved plan always has a way on
//   the cards            number, module, title, seconds, a price on a Generated shot; the focused one's loop plays
//   the inspector        (Directed) BULLETS (✂ between two lines splits) · MODULE (the shared picker) · STYLE (slot
//                        inspector.style) · SOUND (the sound picker) · VOICE (a slide with no presenter on screen:
//                        the presenter or a guest, one of the FLPT voices; W4-11) · REFERENCE (slot
//                        inspector.reference) · Narrated · ♪ (a Solo) · MAKE Code · Generated $ (Cosmos, cut scene) ·
//                        CLIP (an Inset: the Deck's call attachment) · ASK · Seconds · Remove
//   Undo · Redo (50 steps, kept by main) · Approve the plan
// Keys: 1–9, 0 the focused shot's module (0 the Title card) · ← → the previous or next shot · ⌘Z ⇧⌘Z · M merges the two
// ⌘-clicked · Esc. Every edit is one flpt.storyboard.op (main validates it and answers the whole view); the strip and
// the cards re-deal with FLIP (320 ms). Nothing moves under Pause motion or reduced motion: posters, no re-deal.
// The plan is approved only through flpt.storyboard.approve (its Claude top-up first, in main's own dialog), never the
// generic approval. Read-only while the crew polishes or the deck crew builds, and after the script is approved; the
// VOICE chip (flpt.guest.voice) stays open until the film's spend is approved (who speaks isn't the plan), but never
// while a crew is at work.
// Slot fillers (W3-01's style pick, W3-02's reference well) hear 'inspector:shot' on their slot ({ episode, shot,
// editable }) and edit through FLPT_UI.components.storyboard.op(op).
(() => {
  const UI = window.FLPT_UI;
  if (!UI || !UI.panels) return;

  const EASE = 'cubic-bezier(.16, 1, .3, 1)';
  const DEAL_MS = 320;
  const CEREMONY_MS = 1400;
  const STEP = 5; // seconds a nudge
  const pad2 = (n) => String(n).padStart(2, '0');
  const clockOf = (secs) => `${Math.floor(Math.round(secs) / 60)}:${pad2(Math.round(secs) % 60)}`;
  const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`;
  const held = () => (typeof UI.motionHeld === 'function' ? UI.motionHeld() : false);
  const tileAsset = (m, ext) => `assets/modules/${m}.${ext}`;
  const KIND = (s) => (s.placement === 'between' ? (s.module === 'motion-solo' ? 'interstitial' : 'cutscene') : s.module);

  const ST = new Map(); // episode → what the screen remembers: focus, the inspector, the ⌘-clicked pair
  const stateOf = (dir) => {
    if (!ST.has(dir)) ST.set(dir, { focus: null, pair: [], busy: false, err: '', errTimer: null, menu: null, editTitle: false });
    return ST.get(dir);
  };
  let cur = null; // the panel on screen: { ctx, state, root, pickers }
  let caps = null;
  if (window.flpt && flpt.app && typeof flpt.app.caps === 'function') {
    Promise.resolve(flpt.app.caps()).then((r) => { caps = r && r.ok ? r.value : null; }, () => {});
  }
  const canGenerate = () => !caps || !Array.isArray(caps.paidSteps) || caps.paidSteps.includes('scenes');

  // ── FLIP: where each segment and card was, then where it is, and the move between (320 ms, the house curve) ──
  function rects(root) {
    const m = new Map();
    if (root) for (const n of root.querySelectorAll('[data-flip]')) m.set(n.dataset.flip, n.getBoundingClientRect());
    return m;
  }
  function flip(root, first) {
    if (!first || !first.size || held() || !root.isConnected) return 0;
    let n = 0;
    for (const node of root.querySelectorAll('[data-flip]')) {
      const a = first.get(node.dataset.flip);
      if (!a) {
        node.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: DEAL_MS, easing: EASE });
        n += 1;
        continue;
      }
      const b = node.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      const sx = a.width / b.width;
      const sy = a.height / b.height;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) continue;
      node.animate([{ transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transformOrigin: '0 0', transform: 'none' }], { duration: DEAL_MS, easing: EASE });
      n += 1;
    }
    return n;
  }

  // ── talking to main ──
  function say(text) {
    if (!cur) return;
    const s = cur.state;
    clearTimeout(s.errTimer);
    s.err = text || '';
    const line = cur.root.querySelector('.sb-err');
    if (line) line.textContent = s.err;
    if (text) s.errTimer = setTimeout(() => { s.err = ''; const l = cur && cur.root.querySelector('.sb-err'); if (l) l.textContent = ''; }, 6000);
  }
  /** One edit (or an undo or redo): main's whole view back, painted, re-dealt; the stage refreshed when its status moved. */
  async function apply(o, how = 'op') {
    if (!cur || cur.state.busy) return null;
    const { ctx, state, root } = cur;
    const t0 = performance.now();
    const before = new Set(state.view.shots.map((s) => s.id));
    const was = state.view.stage;
    state.busy = true;
    let r;
    try {
      r = how === 'op' ? await flpt.storyboard.op(ctx.dir, o) : await flpt.storyboard[how](ctx.dir);
    } catch (e) { r = { ok: false, error: e.message }; }
    state.busy = false;
    if (!cur || cur.ctx.dir !== ctx.dir) return null;
    if (!r || !r.ok || !r.value) { say((r && r.error) || 'That didn\'t work.'); return null; }
    const first = rects(cur.root);
    state.view = r.value;
    ctx.view.storyboard = r.value;
    const added = r.value.shots.find((s) => !before.has(s.id));
    if (added) state.focus = added.id;
    if (!r.value.shots.some((s) => s.id === state.focus)) state.focus = null;
    paint();
    cur.root.dataset.opMs = String(Math.round(performance.now() - t0));
    requestAnimationFrame(() => flip(cur.root, first));
    if (r.value.stage !== was) ctx.refresh({ quiet: true });
    return r.value;
  }
  /**
   * An edit to an approved plan that a deck was built from re-opens the plan and stales the deck (main does that): asked
   * first, in the panel (draft-ux S5d: Re-plan from here? · Keep plan · Re-plan). A lock or a mode never re-opens it.
   */
  function replans(o, how) {
    if (!cur) return false;
    const deck = cur.ctx.view.state.stages.deck || {};
    return cur.state.view.stage === 'approved' && ['review', 'approved', 'stale'].includes(deck.status) && !(how === 'op' && o && ['lock', 'mode'].includes(o.op));
  }
  function edit(o, how = 'op') {
    if (!cur) return Promise.resolve(null);
    if (replans(o, how) && !cur.state.replanOk) {
      cur.state.pending = { o, how };
      paint();
      return Promise.resolve(null);
    }
    return apply(o, how);
  }
  const op = (o) => edit(o, 'op');

  // ── the panel ──
  function render(ctx) {
    const sb = ctx.view.storyboard;
    if (!sb || !Array.isArray(sb.shots)) return ctx.fallback();
    const first = cur && cur.ctx.dir === ctx.dir && cur.root.isConnected ? rects(cur.root) : null;
    if (cur) teardown(cur);
    const state = stateOf(ctx.dir);
    if (!cur || cur.ctx.dir !== ctx.dir || sb.stage !== 'approved') state.replanOk = false; // asked again on each visit
    state.view = sb;
    if (state.focus && !sb.shots.some((s) => s.id === state.focus)) state.focus = null;
    const root = el('div', { class: 'sb' });
    cur = { ctx, state, root, pickers: [] };
    paint();
    if (first) requestAnimationFrame(() => { if (cur && cur.root === root) flip(root, first); });
    const out = [root];
    if (['running', 'error', 'interrupted'].includes(ctx.status)) out.push(...ctx.fallback());
    return out;
  }
  function teardown(c) {
    for (const p of c.pickers) { try { p.destroy(); } catch { /* gone */ } }
    c.pickers = [];
  }

  function flags() {
    const { ctx, state } = cur;
    const stages = ctx.view.state.stages;
    const running = ctx.status === 'running';
    const scriptDone = Boolean(stages.script && stages.script.status === 'approved');
    const deckBusy = Boolean(stages.deck && stages.deck.status === 'running');
    const v = state.view;
    // who speaks a slide may change until the film's spend is approved, never while a crew is at work (main says so
    // too: api/guestvoice.js)
    const spent = Boolean(stages.spend && stages.spend.status === 'approved');
    const crew = Object.values(stages).some((x) => x && x.status === 'running');
    const voice = !running && !crew && !spent && Boolean(window.flpt && flpt.guest && typeof flpt.guest.voice === 'function');
    return { running, scriptDone, deckBusy, edit: !running && !deckBusy && !scriptDone, voice, approved: v.stage === 'approved', mode: v.mode || null };
  }

  function paint() {
    if (!cur) return;
    teardown(cur);
    const { ctx, state, root } = cur;
    const v = state.view;
    const f = flags();
    const focus = v.shots.find((s) => s.id === state.focus) || null;
    const directed = f.mode === 'directed';
    root.className = `sb${directed ? ' sb-directed' : ''}${f.running ? ' sb-polishing' : ''}${f.edit ? '' : ' sb-readonly'}`;
    const kids = [head(v, f), strip(v, f)];
    // a plan waiting on its approval always offers one: the two ways (arriving, or a Jazz plan an edit or a re-plan
    // re-opened), or Directed's own Approve the plan below
    if (!f.approved && f.edit && !directed) kids.push(choices());
    const body = el('div', { class: `sb-body${directed && focus ? ' with-insp' : ''}` }, cards(v, f));
    if (directed && focus) body.append(inspector(v, focus, f));
    if (state.pending) kids.push(replanBar());
    kids.push(body, actions(v, f));
    const rec = ctx.record;
    if (rec && rec.report && ctx.status === 'review') kids.push(el('details', { class: 'report' }, el('summary', {}, 'The crew\'s report'), el('div', { class: 'md', 'data-content': '' }, md(rec.report))));
    // the keyboard's place survives the repaint: on the strip or the cards, on the shot now focused (or the same one)
    const a = document.activeElement;
    const on = a && root.contains(a) ? a.closest('.sb-seg, .sb-card') : null;
    const kind = on ? (on.classList.contains('sb-seg') ? '.sb-seg' : '.sb-card') : null;
    const want = kind ? (state.focus && state.focus !== state.painted ? state.focus : on.dataset.shot) : null;
    state.painted = state.focus;
    root.replaceChildren(...kids);
    if (want) { const n = root.querySelector(`${kind}[data-shot="${CSS.escape(want)}"]`); if (n) n.focus({ preventScroll: true }); }
    for (const name of ['inspector.style', 'inspector.reference']) {
      const slot = UI.slots[name];
      if (slot) slot.dispatchEvent(new CustomEvent('inspector:shot', { detail: { episode: ctx.dir, shot: focus ? { ...focus } : null, editable: f.edit } }));
    }
  }

  /** Re-plan from here? Keep plan · Re-plan (once per visit: after a yes, the edits that follow just happen). */
  function replanBar() {
    const { state } = cur;
    const go = async (yes) => {
      const p = state.pending;
      state.pending = null;
      paint(); // the bar goes either way, before main answers
      if (!yes || !p) return;
      state.replanOk = true;
      if (!(await apply(p.o, p.how))) state.replanOk = false; // refused: the next edit asks again
    };
    return el('div', { class: 'sb-replan', role: 'alertdialog', 'aria-label': 'Re-plan from here?' },
      el('span', {}, 'Re-plan from here?'), el('span', { class: 'muted', title: 'The deck and what follows go out of date.' }, 'The deck goes out of date.'),
      el('button', { type: 'button', class: 'ghost small', onclick: () => go(false) }, 'Keep plan'),
      el('button', { type: 'button', class: 'primary small', onclick: () => go(true) }, 'Re-plan'));
  }

  // ── the head: the totals line, the status lines, Undo · Redo ──
  function head(v, f) {
    const lines = [el('p', { class: 'sb-line hud', title: (v.tooltip || []).join(' · ') }, v.line)];
    if (f.approved && v.mode) lines.push(el('span', { class: 'sb-mode hud' }, v.mode === 'jazz' ? 'Jazz' : 'Directed'));
    const undo = el('button', { type: 'button', class: 'ghost small', disabled: !f.edit || !v.undo, title: '⌘Z', onclick: () => edit(null, 'undo') }, 'Undo');
    const redo = el('button', { type: 'button', class: 'ghost small', disabled: !f.edit || !v.redo, title: '⇧⌘Z', onclick: () => edit(null, 'redo') }, 'Redo');
    const out = el('div', { class: 'sb-head' }, el('div', { class: 'sb-totals' }, ...lines), el('div', { class: 'sb-undo' }, undo, redo));
    const said = planLine(v);
    const notes = [...(v.status || []), ...(said ? [said] : [])];
    const removed = v.diff && Array.isArray(v.diff.removed) ? v.diff.removed : [];
    return el('div', { class: 'sb-top' }, out,
      notes.length ? el('p', { class: 'sb-status hud' }, notes.join(' · ')) : null,
      removed.length ? el('p', { class: 'sb-removed', 'data-content': '' }, ...removed.map((x) => el('s', {}, x.title || x.id))) : null,
      el('p', { class: 'sb-err', role: 'status', 'data-content': '' }, cur.state.err));
  }

  /**
   * The plan against the script, as the Script and the ribbon say it (planview's line: PLAN and SCRIPT both count the
   * scenes between slides, as the totals line does), kept to the board as edited since the episode was opened: PLAN is
   * the shots' seconds; SCRIPT is what the script says for each slide plus each scene's own seconds. Null before a script.
   */
  function planLine(v) {
    const rb = cur.ctx.view.planview && cur.ctx.view.planview.ribbon;
    if (!rb || !rb.script || !Array.isArray(rb.shots)) return null;
    const now = new Map(v.shots.map((s) => [s.id, s]));
    let plan = 0;
    let said = 0;
    let live = 0;
    for (const s of v.shots) {
      plan += s.seconds || 0;
      if (s.placement === 'between') { said += s.seconds || 0; if (s.family === 'live') live += s.seconds || 0; }
    }
    for (const r of rb.shots) {
      if (r.placement !== 'slide' || !r.actual) continue;
      said += r.actual;
      if (now.has(r.id) ? now.get(r.id).family === 'live' : r.live) live += r.actual;
    }
    return `PLAN ${clockOf(plan)} · SCRIPT ${clockOf(said)} · LIVE MOTION ${said > 0 ? Math.round((live / said) * 100) : 0} %`;
  }

  // ── the strip ──
  function segment(s, f) {
    const { state } = cur;
    const between = s.placement === 'between';
    const changed = cur.state.view.diff && (cur.state.view.diff.changed || []).some((c) => c.id === s.id);
    const b = el('button', {
      type: 'button', class: `sb-seg${between ? ' sb-between' : ''}${s.family === 'live' ? ' sb-live' : ''}${s.id === state.focus ? ' on' : ''}${state.pair.includes(s.id) ? ' paired' : ''}${changed ? ' changed' : ''}`,
      'data-shot': s.id, 'data-flip': `seg:${s.id}`, 'data-family': s.family, role: 'option', 'aria-selected': String(s.id === state.focus), title: s.hover,
      'aria-label': s.hover,
      // Enter or Space selects (⌘ pairs); a pointer's click is the strip's own (dragging, below)
      onclick: (e) => { if (e.detail === 0) click(s.id, e.metaKey || e.ctrlKey); },
    },
    el('span', { class: 'sb-seg-n hud' }, s.n ? pad2(s.n) : s.module === 'cutscene' ? 'Cut' : '♪'),
    between ? null : el('span', { class: 'sb-seg-name' }, s.tile),
    s.live ? miniLoop(s) : null,
    !between && f.edit ? el('span', { class: 'sb-edge', 'data-edge': s.id, 'aria-hidden': 'true' }) : null);
    b.style.flexGrow = String(Math.max(1, s.seconds || 1));
    return b;
  }
  function miniLoop(s) {
    const src = loopOf(s);
    if (!src.loop) return null;
    const vid = el('video', { class: 'sb-mini', muted: true, loop: true, playsinline: true, preload: 'none', src: src.loop, 'aria-hidden': 'true' });
    vid.muted = true;
    return vid;
  }
  function gap(after, f) {
    const g = el('span', { class: 'sb-gap', 'data-after': after });
    if (f.edit) {
      const plus = el('button', { type: 'button', class: 'sb-plus', 'aria-label': 'Add a scene', title: 'Solo ♪ · Cut scene', onclick: (e) => { e.stopPropagation(); openMenu(g, after); } }, '+');
      g.append(plus);
    }
    return g;
  }
  function strip(v, f) {
    const box = el('div', { class: 'sb-strip', role: 'listbox', 'aria-label': 'Shots' });
    const shots = v.shots;
    box.append(gap('', f));
    let lastSlide = null;
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      if (s.placement === 'slide') lastSlide = s.id;
      box.append(segment(s, f));
      const next = shots[i + 1];
      if (lastSlide && (!next || next.placement === 'slide')) box.append(gap(lastSlide, f));
    }
    if (f.running) box.append(el('span', { class: 'sb-shimmer fx-loop', 'aria-hidden': 'true' }));
    box.classList.toggle('fx-on', f.running);
    // one live thing at a time: the segment under the pointer plays its loop, and what was playing waits for it
    let mini = null;
    let waiting = [];
    const stopMini = () => {
      if (mini) { mini.pause(); mini.closest('.sb-seg').classList.remove('mini-on'); mini = null; }
      for (const v of waiting) if (v.isConnected && !held()) v.play().catch(() => {});
      waiting = [];
    };
    box.addEventListener('pointerover', (e) => {
      const seg = e.target.closest('.sb-seg');
      const vid = seg && box.contains(seg) ? seg.querySelector('video.sb-mini') : null;
      if (vid === mini) return;
      stopMini();
      if (!vid || held()) return;
      waiting = [...cur.root.querySelectorAll('video')].filter((v) => v !== vid && !v.paused);
      for (const v of waiting) v.pause();
      mini = vid;
      seg.classList.add('mini-on');
      vid.play().catch(() => {});
    });
    box.addEventListener('pointerleave', stopMini);
    dragging(box, f);
    return box;
  }

  /** Click selects (⌘-click pairs two for M); drag reorders; a slide's right edge dragged onto its neighbour merges. */
  function dragging(box, f) {
    let d = null;
    box.addEventListener('pointerdown', (e) => {
      const seg = e.target.closest('.sb-seg');
      if (!seg || e.button !== 0 || e.target.closest('.sb-plus')) return;
      d = { id: seg.dataset.shot, seg, x0: e.clientX, edge: Boolean(e.target.closest('.sb-edge')), moved: false, pointer: e.pointerId };
    });
    box.addEventListener('pointermove', (e) => {
      if (!d || !f.edit) return;
      const dx = e.clientX - d.x0;
      if (!d.moved && Math.abs(dx) < 6) return;
      if (!d.moved) { d.moved = true; try { box.setPointerCapture(d.pointer); } catch { /* fine */ } box.classList.add(d.edge ? 'merging' : 'dragging'); d.seg.classList.add('lifted'); }
      if (!d.edge) d.seg.style.transform = `translateX(${dx}px)`;
      const over = segAt(box, e.clientX, d.seg);
      for (const s of box.querySelectorAll('.sb-seg.target')) s.classList.remove('target');
      if (over) over.classList.add('target');
    });
    const end = (e) => {
      if (!d) return;
      const x = d;
      d = null;
      x.seg.style.transform = '';
      box.classList.remove('dragging', 'merging');
      x.seg.classList.remove('lifted');
      for (const s of box.querySelectorAll('.sb-seg.target')) s.classList.remove('target');
      if (e.type === 'pointercancel') return;
      if (!x.moved) { click(x.id, e.metaKey || e.ctrlKey); return; }
      if (!f.edit) return;
      const over = segAt(box, e.clientX, x.seg);
      const shot = cur.state.view.shots.find((s) => s.id === x.id);
      if (!shot) return;
      if (x.edge) {
        if (over && over.dataset.shot !== x.id) op({ op: 'merge', id: x.id, with: over.dataset.shot });
        return;
      }
      const slides = cur.state.view.shots.filter((s) => s.placement === 'slide');
      if (shot.placement === 'between') {
        // it follows the slide whose group the pointer is over ('' before the first)
        const before = slides.filter((s) => { const n = box.querySelector(`.sb-seg[data-shot="${s.id}"]`); return n && n.getBoundingClientRect().left <= e.clientX; });
        const after = before.length ? before[before.length - 1].id : '';
        if (after !== shot.after) op({ op: 'move', id: x.id, after });
        return;
      }
      const others = slides.filter((s) => s.id !== x.id);
      let to = 0;
      for (const s of others) { const n = box.querySelector(`.sb-seg[data-shot="${s.id}"]`); if (n) { const r = n.getBoundingClientRect(); if (e.clientX > r.left + r.width / 2) to += 1; } }
      if (to !== slides.indexOf(shot)) op({ op: 'move', id: x.id, to });
    };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
  }
  function segAt(box, x, not) {
    for (const s of box.querySelectorAll('.sb-seg')) {
      if (s === not) continue;
      const r = s.getBoundingClientRect();
      if (x >= r.left && x <= r.right) return s;
    }
    return null;
  }
  function click(id, pair) {
    const { state } = cur;
    if (pair) {
      state.pair = state.pair.includes(id) ? state.pair.filter((x) => x !== id) : [...state.pair, id].slice(-2);
      paint();
      return;
    }
    state.pair = [];
    focusShot(id, true);
  }
  function focusShot(id, scroll) {
    if (!cur) return;
    cur.state.focus = id;
    paint();
    const card = cur.root.querySelector(`.sb-card[data-shot="${CSS.escape(id)}"]`);
    if (card && scroll) card.scrollIntoView({ block: 'nearest', behavior: held() ? 'auto' : 'smooth' });
  }

  /** The gap's +: a Solo ♪ or a cut scene after this slide ('' before the first). */
  function openMenu(g, after) {
    closeMenu();
    const pick = (kind) => { closeMenu(); op({ op: 'add', after, kind }); };
    const menu = el('div', { class: 'sb-menu', role: 'menu' },
      el('button', { type: 'button', role: 'menuitem', onclick: () => pick('solo') }, 'Solo ♪'),
      el('button', { type: 'button', role: 'menuitem', onclick: () => pick('cutscene') }, 'Cut scene'));
    g.append(menu);
    cur.state.menu = menu;
    menu.querySelector('button').focus();
    setTimeout(() => document.addEventListener('pointerdown', outside, true));
  }
  function outside(e) { if (cur && cur.state.menu && !cur.state.menu.contains(e.target)) closeMenu(); }
  function closeMenu() {
    document.removeEventListener('pointerdown', outside, true);
    if (cur && cur.state.menu) { cur.state.menu.remove(); cur.state.menu = null; }
  }

  // ── arriving: the two ways ──
  function choices() {
    // each card a tiny strip of the plan that plays its way while hovered: Jazz's playhead lights each shot in turn;
    // Directed's hand lifts one shot and sets it down further along
    const mini = (cls) => {
      const shots = cur.state.view.shots.slice(0, 12);
      const pic = el('span', { class: `sb-choice-pic ${cls}`, 'aria-hidden': 'true' }, ...shots.map((s, i) => {
        const b = el('i', { 'data-family': s.family });
        b.style.flexGrow = String(Math.max(1, s.seconds || 1));
        b.style.setProperty('--i', String(i));
        return b;
      }));
      pic.style.setProperty('--n', String(Math.max(1, shots.length)));
      return pic;
    };
    return el('div', { class: 'sb-choices' },
      el('button', { type: 'button', class: 'sb-choice sb-jazz', disabled: cur.state.busy, onclick: jazz }, mini('jazz'), el('b', {}, 'Let FLPT play jazz')),
      el('button', { type: 'button', class: 'sb-choice', disabled: cur.state.busy, onclick: () => op({ op: 'mode', mode: 'directed' }).then((x) => { if (x && !cur.state.focus) focusShot(x.shots[0].id, false); }) },
        mini('directed'), el('b', {}, 'User directed')));
  }
  /** Let FLPT play jazz: the playhead sweeps the strip, each shot lighting in turn (1400 ms); then the plan's approval. */
  async function jazz() {
    if (!cur || cur.state.busy) return;
    const box = cur.root.querySelector('.sb-strip');
    if (box && !held()) {
      const w = box.getBoundingClientRect();
      const head = el('span', { class: 'sb-playhead', 'aria-hidden': 'true' });
      box.append(head);
      head.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${w.width}px)` }], { duration: CEREMONY_MS, easing: 'linear', fill: 'forwards' });
      for (const s of box.querySelectorAll('.sb-seg')) {
        const r = s.getBoundingClientRect();
        s.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(1.5)' }, { filter: 'brightness(1)' }], { duration: 420, delay: Math.max(0, ((r.left - w.left) / w.width) * CEREMONY_MS), easing: EASE });
      }
      await new Promise((ok) => setTimeout(ok, CEREMONY_MS));
      head.remove();
    }
    approve('jazz');
  }
  async function approve(mode) {
    if (!cur || cur.state.busy) return;
    const { ctx, state } = cur;
    state.busy = true;
    paint();
    let r;
    // Jazz: approve, then the play-through starts (api/jazz.js); directed: the plan approved.
    const viaJazz = mode === 'jazz' && flpt.jazz && typeof flpt.jazz.approve === 'function';
    try { r = await (viaJazz ? flpt.jazz.approve(ctx.dir) : flpt.storyboard.approve(ctx.dir, mode)); } catch (e) { r = { ok: false, error: e.message }; }
    state.busy = false;
    if (!r || !r.ok) { paint(); say((r && r.error) || 'That didn\'t work.'); return; }
    if (r.value && r.value.cancelled) { ctx.flash('Not approved. Nothing was spent.', false); return; }
    if (r.value && r.value.view) state.view = r.value.view;
    if (typeof ctx.next === 'function') ctx.next(); else ctx.refresh();
  }

  // ── the cards ──
  function loopOf(s) {
    const pv = cur.ctx.view.planview || {};
    const st = pv.styles && pv.styles.shots && pv.styles.shots[s.id];
    const m = st && pv.styles.media && pv.styles.media[st];
    if (s.live && m && m.poster && m.loop && flpt.fileUrl) return { poster: flpt.fileUrl(m.poster), loop: flpt.fileUrl(m.loop), style: m.name };
    if (s.module === 'statement') return { poster: null, loop: null, style: null };
    const id = s.placement === 'between' && s.module === 'motion-solo' ? 'motion-solo' : s.module;
    return { poster: tileAsset(id, 'jpg'), loop: tileAsset(id, 'mp4'), style: m ? m.name : null };
  }
  function media(s, playing) {
    const src = loopOf(s);
    if (!src.poster) return el('span', { class: 'sb-media sb-card-text', 'aria-hidden': 'true' }, 'Aa');
    if (playing && !held()) {
      const vid = el('video', { class: 'sb-media', muted: true, loop: true, autoplay: true, playsinline: true, poster: src.poster, src: src.loop, 'aria-hidden': 'true' });
      vid.muted = true;
      return vid;
    }
    return el('img', { class: 'sb-media', src: src.poster, alt: '', loading: 'lazy' });
  }
  function cards(v, f) {
    const { state } = cur;
    const directed = f.mode === 'directed';
    const changedIds = new Set(((v.diff && v.diff.changed) || []).map((c) => c.id));
    const list = el('div', { class: 'sb-cards' }, ...v.shots.map((s) => {
      const on = s.id === state.focus;
      return el('button', {
        type: 'button', class: `sb-card${on ? ' on' : ''}${s.placement === 'between' ? ' sb-between' : ''}${s.family === 'live' ? ' sb-live' : ''}`, 'data-shot': s.id, 'data-flip': `card:${s.id}`,
        'data-family': s.family, 'aria-pressed': String(on), title: s.hover, onclick: () => focusShot(s.id, false),
      },
      el('span', { class: 'sb-card-pic' }, media(s, on && !directed)),
      el('span', { class: 'sb-card-top' }, s.n ? el('span', { class: 'sb-card-n hud' }, pad2(s.n)) : null,
        el('span', { class: 'sb-card-tile hud' }, s.tile), changedIds.has(s.id) ? el('span', { class: 'sb-dot', title: 'Changed' }) : null,
        s.locked ? el('span', { class: 'sb-lock', title: 'Locked' }) : null),
      el('span', { class: 'sb-card-title', 'data-content': '' }, s.title || s.idea || ''),
      el('span', { class: 'sb-card-meta hud' }, clockOf(s.seconds), s.usd != null ? el('span', { class: 'sb-money' }, usd(s.usd)) : null));
    }));
    return list;
  }

  // ── the inspector ──
  function section(label, ...kids) {
    return el('section', { class: 'sb-sec' }, el('p', { class: 'sb-sec-label hud' }, label), ...kids);
  }
  /** The shot's own lines of bullets.md, or null when main has none it vouches for (planview.lines: a stale board). */
  function linesOf(s) {
    const all = (cur.ctx.view.planview && cur.ctx.view.planview.lines) || [];
    const out = [];
    for (const h of s.bullets || []) {
      const lines = all[h - 1];
      if (!Array.isArray(lines)) return null;
      const [from, to] = s.part || [0, lines.length];
      for (let i = from; i < to; i++) out.push(lines[i] != null ? lines[i] : '');
    }
    return out;
  }
  function inspector(v, s, f) {
    const { state, ctx } = cur;
    const i = v.shots.indexOf(s);
    const prev = v.shots[i - 1];
    const next = v.shots[i + 1];
    const ro = !f.edit;
    const src = loopOf(s);
    const box = el('aside', { class: 'sb-insp', 'aria-label': 'Shot', 'data-shot': s.id });
    box.append(el('header', { class: 'sb-insp-head' },
      el('span', { class: 'hud' }, `${s.n ? pad2(s.n) : s.module === 'cutscene' ? 'Cut' : '♪'} · ${clockOf(s.seconds)}`),
      el('span', { class: 'sb-insp-nav' },
        el('button', { type: 'button', class: 'ghost small', disabled: !prev, 'aria-label': 'Previous', title: '←', onclick: () => prev && focusShot(prev.id, true) }, '◁'),
        el('button', { type: 'button', class: 'ghost small', disabled: !next, 'aria-label': 'Next', title: '→', onclick: () => next && focusShot(next.id, true) }, '▷'))));
    box.append(el('div', { class: 'sb-insp-pic' }, media(s, true), src.style ? el('span', { class: 'sb-insp-style hud' }, src.style) : null));
    // the title, renamed in place
    if (state.editTitle && !ro) {
      const input = el('input', { type: 'text', class: 'sb-title-input', maxlength: '80', 'aria-label': 'Title', value: s.title || '' });
      const done = (keep) => { state.editTitle = false; if (keep && input.value.trim() !== (s.title || '')) op({ op: 'title', id: s.id, title: input.value }); else paint(); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(true); } if (e.key === 'Escape') { e.preventDefault(); done(false); } });
      input.addEventListener('blur', () => { if (state.editTitle) done(true); });
      box.append(el('div', { class: 'sb-title-row' }, input));
      setTimeout(() => { input.focus(); input.select(); });
    } else {
      box.append(el('div', { class: 'sb-title-row' }, el('h3', { class: 'sb-title', 'data-content': '' }, s.title || s.tile),
        el('button', { type: 'button', class: 'ghost small sb-rename', disabled: ro, 'aria-label': 'Rename', title: 'Rename', onclick: () => { state.editTitle = true; paint(); } }, '✎')));
    }
    const lines = s.placement === 'slide' ? linesOf(s) : null;
    if (lines) {
      const cuts = new Set(s.cuts || []);
      const list = el('ul', { class: 'sb-bullets', 'data-content': '' });
      lines.forEach((line, k) => {
        if (k > 0 && cuts.has(k)) list.append(el('li', { class: 'sb-cut' }, el('button', { type: 'button', class: 'sb-scissors', disabled: ro, 'aria-label': 'Split', title: 'Split', onclick: () => op({ op: 'split', id: s.id, atBullet: k }) }, '✂')));
        list.append(el('li', {}, line));
      });
      box.append(section('Bullets', list));
    }
    // MODULE: the shared picker
    const holder = el('div', { class: 'sb-picker' });
    box.append(section('Module', holder));
    if (UI.components.modulePicker) {
      cur.pickers.push(UI.components.modulePicker(holder, { catalog: ctx.view.catalog, value: s.module, placement: s.placement, compact: true, disabled: ro, episode: ctx.dir, shot: s.id,
        onPick: (m) => { if (m !== s.module) op({ op: 'module', id: s.id, module: m }); } }));
    }
    if (s.live) {
      const styleSlot = UI.slots['inspector.style'];
      box.append(section('Style', ...(styleSlot ? [styleSlot] : []), el('span', { class: 'sb-fallback' }, src.style || '')));
      const host = el('div', { class: 'sb-sound' });
      box.append(section('Sound', host));
      if (UI.components.soundPicker) {
        const p = UI.components.soundPicker(host, { value: s.sound || null, kind: KIND(s), episode: ctx.dir,
          onChange: (val) => op({ op: 'sound', id: s.id, music: val.music, sfx: val.sfx }) });
        if (ro) for (const b of p.el.querySelectorAll('button')) b.disabled = true;
        cur.pickers.push(p);
      }
    }
    if (Object.prototype.hasOwnProperty.call(s, 'voice')) box.append(section('Voice', voiceChip(v, s, f)));
    const refSlot = UI.slots['inspector.reference'];
    const refs = (s.refs || []).map((r) => el('span', { class: 'sb-ref' }, el('span', { 'data-content': '' }, r),
      el('button', { type: 'button', class: 'linkish', disabled: ro, 'aria-label': 'Remove', onclick: () => op({ op: 'ref', id: s.id, remove: r }) }, '✕')));
    box.append(section('Reference', ...(refSlot ? [refSlot] : []), el('span', { class: 'sb-fallback' }, ...refs)));
    if (s.module === 'motion-solo') {
      const seg = (on, label, narrated) => el('button', { type: 'button', class: `sb-seg-btn${on ? ' on' : ''}`, 'aria-pressed': String(on), disabled: ro, onclick: () => { if (!on) op({ op: 'narrated', id: s.id, narrated }); } }, label);
      box.append(el('div', { class: 'sb-row' }, el('span', { class: 'sb-toggle', role: 'group', 'aria-label': 'Narration' }, seg(s.narrated !== false, 'Narrated', true), seg(s.narrated === false, '♪', false))));
    }
    if (s.module === 'cosmos' || s.module === 'cutscene') {
      const gen = s.make === 'generate';
      const price = gen ? s.usd : (ctx.view.planview && ctx.view.planview.generateUsd || {})[s.id];
      const seg = (on, label, make, off) => el('button', { type: 'button', class: `sb-seg-btn${on ? ' on' : ''}`, 'aria-pressed': String(on), disabled: ro || off, onclick: () => { if (!on) op({ op: 'make', id: s.id, make }); } }, ...label);
      box.append(section('Make', el('span', { class: 'sb-toggle', role: 'group', 'aria-label': 'Make' },
        seg(!gen, ['Code'], 'code', false),
        seg(gen, ['Generated', price != null ? el('span', { class: 'sb-money' }, ` ${usd(price)}`) : ' $'], 'generate', !canGenerate() && !gen))));
    }
    if (s.needsClip) box.append(clipWell(s, ro));
    const ask = el('textarea', { class: 'sb-ask', rows: '2', maxlength: '600', 'aria-label': 'Ask', placeholder: 'What this shot should do', disabled: ro });
    ask.value = s.ask || '';
    ask.addEventListener('change', () => { if (ask.value.trim() !== (s.ask || '')) op({ op: 'ask', id: s.id, ask: ask.value }); });
    box.append(section('Ask', ask));
    const lo = s.placement === 'between' ? 4 : 1;
    const hi = s.placement === 'between' ? 30 : 1800;
    box.append(el('div', { class: 'sb-row sb-secs' }, el('span', { class: 'sb-sec-label hud' }, 'Seconds'),
      el('button', { type: 'button', class: 'ghost small', disabled: ro || s.seconds <= lo, 'aria-label': 'Fewer seconds', onclick: () => op({ op: 'seconds', id: s.id, seconds: Math.max(lo, s.seconds - STEP) }) }, '−'),
      el('span', { class: 'sb-secs-n hud' }, String(s.seconds)),
      el('button', { type: 'button', class: 'ghost small', disabled: ro || s.seconds >= hi, 'aria-label': 'More seconds', onclick: () => op({ op: 'seconds', id: s.id, seconds: Math.min(hi, s.seconds + STEP) }) }, '+')));
    const slides = v.shots.filter((x) => x.placement === 'slide').length;
    box.append(el('div', { class: 'sb-row sb-end' },
      el('button', { type: 'button', class: `ghost small${s.locked ? ' on' : ''}`, 'aria-pressed': String(Boolean(s.locked)), disabled: f.running || f.deckBusy, title: 'A polish leaves it as it is', onclick: () => op({ op: 'lock', id: s.id, locked: !s.locked }) }, s.locked ? 'Locked' : 'Lock'),
      el('button', { type: 'button', class: 'ghost small', disabled: ro || (s.placement === 'slide' && slides < 2), onclick: () => op({ op: 'remove', id: s.id }) }, 'Remove')));
    return box;
  }

  /**
   * VOICE (W4-11): who narrates a slide with no presenter on screen. The chip names it (Presenter, or the guest); its
   * menu holds Presenter and the FLPT voices (main's list, view.voices). One flpt.guest.voice call; main answers
   * with the whole view (and writes the script's tag for that slide).
   */
  function voiceChip(v, s, f) {
    const wrap = el('span', { class: 'sb-voice' });
    wrap.style.position = 'relative';
    const label = s.voice ? s.voice.name : 'Presenter';
    wrap.append(el('button', { type: 'button', class: `ghost small sb-voice-chip${s.voice ? ' on' : ''}`, disabled: !f.voice || cur.state.busy, 'aria-haspopup': 'menu',
      'aria-label': `Voice: ${label}`, 'data-voice': s.voice ? `${s.voice.provider}/${s.voice.id}` : '', onclick: (e) => { e.stopPropagation(); openVoices(wrap, s, v); } }, label));
    return wrap;
  }
  function openVoices(wrap, s, v) {
    closeMenu();
    const was = s.voice || null;
    const same = (x) => (x ? Boolean(was) && was.provider === x.provider && was.id === x.id : !was);
    const item = (x, name) => el('button', { type: 'button', role: 'menuitemradio', 'aria-checked': String(same(x)), class: same(x) ? 'sb-seg-btn on' : '',
      onclick: () => { closeMenu(); if (!same(x)) setVoice(s, x); } }, name);
    // an FLPT voice while signed out: the way to sign in (Setup's FLPT voices step; W4-10)
    const signin = UI.components && UI.components.signin;
    const signIn = was && was.provider === 'fish-house' && signin && typeof signin.signedIn === 'function' && !signin.signedIn()
      ? el('button', { type: 'button', role: 'menuitem', class: 'sb-voice-signin', onclick: () => { closeMenu(); signin.open(); } }, 'Sign in') : null;
    const menu = el('div', { class: 'sb-menu', role: 'menu', 'aria-label': 'Voice' },
      item(null, 'Presenter'), ...(Array.isArray(v.voices) ? v.voices : []).map((x) => item({ provider: x.provider, id: x.id }, x.name)), ...(signIn ? [signIn] : []));
    wrap.append(menu);
    cur.state.menu = menu;
    (menu.querySelector('[aria-checked="true"]') || menu.querySelector('button')).focus();
    setTimeout(() => document.addEventListener('pointerdown', outside, true));
  }
  async function setVoice(s, x) {
    if (!cur || cur.state.busy) return;
    const { ctx, state } = cur;
    state.busy = true;
    let r;
    try { r = await flpt.guest.voice(ctx.dir, s.id, x); } catch (e) { r = { ok: false, error: e.message }; }
    state.busy = false;
    if (!cur || cur.ctx.dir !== ctx.dir) return;
    if (!r || !r.ok || !r.value) { say((r && r.error) || 'That didn\'t work.'); return; }
    state.view = r.value;
    ctx.view.storyboard = r.value;
    paint();
  }

  /**
   * An Inset's CLIP well (draft-ux S5b): the Deck's call attachment, from here. A clip dropped on it or picked becomes
   * this slide's Inset call (flpt.addCall with the staged files, as the Deck's own call form does), which the deck crew
   * builds the inset from; the well shows what the slide's Inset calls hold. Empty, the plan keeps it as an ask.
   */
  function clipWell(s, ro) {
    const { ctx } = cur;
    const v = ctx.view;
    const atts = (v.calls || []).filter((c) => c.module === 'inset' && c.slide === s.n).flatMap((c) => c.attachments || []);
    const off = ro || !s.n || !flpt.addCall || Boolean(v.state.stages.deck && v.state.stages.deck.status === 'running');
    const take = async (stage) => {
      try {
        const staged = await ctx.call(stage);
        if (!staged) return; // the picker closed
        if (!(staged.files || []).some((x) => x.kind === 'video')) { say('That isn\'t a clip.'); return; }
        const m = (v.catalog || []).find((x) => x.id === 'inset') || {};
        await ctx.call(flpt.addCall, ctx.dir, { module: 'inset', slide: s.n, ask: s.ask || m.withFile || m.ask || 'Play this clip inside the slide.', staged: staged.token });
      } catch (e) { say(e.message); return; }
      ctx.refresh(); // not quiet: the calls aren't among what a quiet refresh compares
    };
    const pic = (a) => (a.poster ? el('img', { src: flpt.fileUrl(`${v.dir}/presentation/${a.poster}`), alt: '' }) : null);
    const well = el('button', { type: 'button', class: `sb-well${atts.length ? ' full' : ''}`, disabled: off, 'aria-label': 'Clip', title: atts.map((a) => a.name).join(' · '),
      onclick: () => take(flpt.pickFiles) },
    ...(atts.length ? atts.slice(0, 3).map((a) => el('span', { class: 'sb-well-clip' }, pic(a), el('span', { 'data-content': '' }, a.name))) : [el('span', { class: 'sb-well-plus', 'aria-hidden': 'true' }, '+')]));
    if (!off) {
      const has = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
      well.addEventListener('dragover', (e) => { if (has(e)) { e.preventDefault(); well.classList.add('drop'); } });
      well.addEventListener('dragleave', () => well.classList.remove('drop'));
      well.addEventListener('drop', (e) => {
        if (!has(e)) return;
        e.preventDefault();
        e.stopPropagation();
        well.classList.remove('drop');
        if (e.dataTransfer.files.length) take(() => flpt.stageDropped(e.dataTransfer.files));
      });
    }
    return section('Clip', well);
  }

  // ── the actions under it all ──
  function actions(v, f) {
    const { ctx, state } = cur;
    const out = [];
    // a failed or stopped polish: the fallback's Run it again is the one way to run again
    const polish = f.edit && !f.approved && ['todo', 'review', 'stale'].includes(ctx.status) && ctx.canRun();
    if (f.mode === 'directed' && !f.approved && f.edit) {
      out.push(el('button', { type: 'button', class: 'primary', disabled: state.busy, onclick: () => approve('directed') }, 'Approve the plan'));
      out.push(el('button', { type: 'button', class: 'ghost', disabled: state.busy, onclick: jazz }, 'Let FLPT play jazz'));
    }
    if (polish) {
      const cap = ctx.stage && ctx.stage.budgetUsd != null ? ctx.stage.budgetUsd : 2;
      out.push(el('button', { type: 'button', class: 'ghost', disabled: state.busy, title: 'Claude reads the talk and rebalances the plan. Your edited shots stay.', onclick: () => ctx.run('') }, 'Polish'),
        el('span', { class: 'muted' }, `Up to ${usd(cap)} of Claude usage.`));
    }
    return out.length ? el('div', { class: 'actions sb-actions' }, ...out) : el('span');
  }

  // ── keys ──
  document.addEventListener('keydown', (e) => {
    if (!cur || !cur.root.isConnected || cur.root.closest('[hidden]')) return;
    if (document.querySelector('dialog[open]')) return;
    const typing = e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable]');
    const f = flags();
    const v = cur.state.view;
    const meta = e.metaKey || e.ctrlKey;
    if (meta && !e.altKey && e.key.toLowerCase() === 'z') {
      if (typing) return;
      e.preventDefault();
      if (f.edit) edit(null, e.shiftKey ? 'redo' : 'undo');
      return;
    }
    if (typing || meta || e.altKey) return;
    const i = v.shots.findIndex((s) => s.id === cur.state.focus);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const j = i < 0 ? 0 : Math.max(0, Math.min(v.shots.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)));
      if (v.shots[j]) { e.preventDefault(); focusShot(v.shots[j].id, true); }
      return;
    }
    if (/^[0-9]$/.test(e.key) && i >= 0) {
      e.preventDefault();
      if (!f.edit) return;
      const cat = cur.ctx.view.catalog || [];
      const m = e.key === '0' ? 'statement' : cat[Number(e.key) - 1] && cat[Number(e.key) - 1].id;
      if (m && m !== v.shots[i].module) op({ op: 'module', id: v.shots[i].id, module: m });
      return;
    }
    if ((e.key === 'm' || e.key === 'M') && cur.state.pair.length === 2 && f.edit) {
      e.preventDefault();
      const [a, b] = cur.state.pair;
      cur.state.pair = [];
      op({ op: 'merge', id: a, with: b });
      return;
    }
    if (e.key === 'Escape') {
      if (cur.state.pending) { cur.state.pending = null; paint(); return; }
      if (cur.state.menu) { closeMenu(); return; }
      if (cur.state.pair.length) { cur.state.pair = []; paint(); return; }
      if (cur.state.focus) { cur.state.focus = null; paint(); }
    }
  });

  // Edits made elsewhere (the crew's polish saving its board, another window): the view again, re-dealt.
  if (window.flpt && flpt.storyboard && typeof flpt.storyboard.onChanged === 'function') {
    flpt.storyboard.onChanged(async (ev) => {
      // the panel left on screen only: once its stage is gone, the next visit reads the board afresh
      if (!cur || !cur.root.isConnected || cur.state.busy || (ev && ev.dir && ev.dir !== cur.ctx.dir)) return;
      const dir = cur.ctx.dir;
      let r;
      try { r = await flpt.storyboard.view(dir); } catch { return; }
      if (!cur || !cur.root.isConnected || cur.ctx.dir !== dir || cur.state.busy || !r || !r.ok || !r.value) return;
      const sig = (x) => JSON.stringify([x.shots, x.line, x.undo, x.redo, x.stage, x.mode]);
      if (sig(r.value) === sig(cur.state.view)) return;
      const first = rects(cur.root);
      cur.state.view = r.value;
      cur.ctx.view.storyboard = r.value;
      paint();
      requestAnimationFrame(() => cur && flip(cur.root, first));
    });
  }
  document.addEventListener('flpt:motion', () => { if (cur && held()) for (const m of cur.root.querySelectorAll('video')) m.pause(); });

  UI.panels.storyboard = render;
  // for the slots' fillers (W3-01, W3-02) and QA: the shot in the inspector, an edit through the same path, the view
  UI.components.storyboard = {
    shot: () => (cur && cur.state.view.shots.find((s) => s.id === cur.state.focus)) || null,
    view: () => (cur ? cur.state.view : null),
    op: (o) => op(o),
    focus: (id) => focusShot(id, true),
    flip: (first) => (cur ? flip(cur.root, first) : 0),
    rects: () => rects(cur && cur.root),
  };
})();
