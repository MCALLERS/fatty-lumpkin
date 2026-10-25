'use strict';
/* global flpt, el, renderSteps */
/* global S:writable */
// ui-likeness.js · Cartoon you (PLAN §3.3 S16, draft-ux §9.3; W3-10), the FLPT_UI.components entry Setup's Presenter step
// opens (its "Cartoon you $" chip, ui-presenter.js). Mac app only: it registers itself only where flpt.app.caps() says
// likeness. A Theater sheet over the window; main does the work and prices every paid step in its own native dialog
// (flpt.likeness); the page only names plates by key.
//   PHOTOS (pick or drop up to five) · ⚑ These are photos of me. · STYLE · Draw four · $0.36
//   the plates (one picked: reframed and checked by main) · Again · $0.09
//   Mouths: Drawn · Painted · Meet your cartoon · $0.91 (Painted) or $0.19 (Drawn)
//   the test clip on the stage (▶ only) · Keep · Adjust (the eye and mouth boxes on the plate, dragged; Done)
//   a plate the free check can't read: its Eyes box, set on the plate, before it's taken · Start over (free)
// Esc closes; Tab stays inside the sheet. Nothing plays on its own: the clip plays on ▶, under Pause motion too.
(() => {
  const UI = window.FLPT_UI;
  if (!UI || !UI.components || !window.flpt || !flpt.likeness || typeof flpt.likeness.state !== 'function') return;

  const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`;
  const unwrap = async (p) => { const r = await p; if (!r || !r.ok) throw new Error((r && r.error) || 'That didn\'t work.'); return r.value; };
  const btn = (label, attrs = {}) => el('button', { type: 'button', ...attrs }, label);
  const R = {};
  let root = null;
  let V = null; // flpt.likeness's view of the one being made (null before the first photo)
  let mouths = 'painted'; // before the parts: what Meet your cartoon will make
  let busy = '';
  let err = '';
  let adjusting = null; // { mode: 'adjust' | 'eyes', eyes, mouth, moved: Set } in plate pixels while the boxes are open
  let poll = null;
  let returnFocus = null;
  let offs = [];

  // ── building ──
  function build() {
    R.close = btn('✕', { class: 'ghost small lk-close', 'aria-label': 'Close', title: 'Esc', onclick: () => close() });
    R.over = btn('Start over', { class: 'ghost small lk-over', onclick: startOver });
    R.photos = el('div', { class: 'lk-photos', role: 'list', 'aria-label': 'Photos' });
    R.add = btn('+', { class: 'ghost lk-add', 'aria-label': 'Add photos', title: 'JPEG, PNG, WebP or HEIC · up to five', onclick: () => act(() => flpt.likeness.pickPhotos()) });
    R.attest = el('input', { type: 'checkbox', class: 'lk-attest-box', onchange: () => { const yes = R.attest.checked; act(() => flpt.likeness.attest(yes)); } }); // read before act repaints it
    R.attestLabel = el('label', { class: 'lk-attest', 'data-trust': '' }, R.attest, el('span', {}, '⚑ These are photos of me.'));
    R.styles = el('div', { class: 'lk-styles', role: 'group', 'aria-label': 'Style' });
    R.draw = btn('', { class: 'primary lk-draw', onclick: () => paid(() => flpt.likeness.draw('plates')) });
    R.plates = el('div', { class: 'lk-plates', role: 'listbox', 'aria-label': 'Plates' });
    R.again = btn('', { class: 'ghost lk-again', onclick: () => paid(() => flpt.likeness.draw('again')) });
    R.mouthChips = el('div', { class: 'lk-mouths', role: 'group', 'aria-label': 'Mouths' });
    R.meet = btn('', { class: 'primary lk-meet', onclick: () => paid(() => flpt.likeness.meet(mouths)) });
    R.video = el('video', { class: 'lk-video', playsinline: true, preload: 'metadata' });
    R.video.addEventListener('ended', () => { R.play.textContent = '▶'; });
    R.play = btn('▶', { class: 'ghost lk-play', 'aria-label': 'Play', onclick: togglePlay });
    R.stage = el('div', { class: 'lk-stage' }, R.video, R.play);
    R.keep = btn('Keep', { class: 'primary lk-keep', onclick: keep });
    R.adjust = btn('Adjust', { class: 'ghost lk-adjust-open', onclick: () => openAdjust('adjust') });
    R.edit = el('div', { class: 'lk-edit', hidden: true });
    R.chip = el('span', { class: 'hud lk-chip', role: 'status' });
    R.status = el('p', { class: 'lk-status', role: 'status', 'data-content': '' });
    R.photoSec = el('section', { class: 'lk-sec' }, el('h3', { class: 'hud' }, 'Photos'), el('div', { class: 'lk-row' }, R.photos, R.add), R.attestLabel);
    R.styleSec = el('section', { class: 'lk-sec' }, el('h3', { class: 'hud' }, 'Style'), R.styles);
    R.plateSec = el('section', { class: 'lk-sec', hidden: true }, el('div', { class: 'lk-row' }, R.plates, R.again));
    R.meetSec = el('section', { class: 'lk-sec lk-meet-sec', hidden: true }, el('h3', { class: 'hud' }, 'Meet your cartoon'),
      el('div', { class: 'lk-meet-body' }, R.stage, R.edit, el('div', { class: 'lk-meet-side' },
        el('div', { class: 'lk-row' }, el('span', { class: 'hud lk-label' }, 'Mouths'), R.mouthChips), el('div', { class: 'lk-row' }, R.meet, R.keep, R.adjust))));
    root = el('div', { class: 'lk-scrim', onclick: (e) => { if (e.target === root) close(); } },
      el('div', { class: 'lk', 'data-realm': 'theater', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Cartoon you' },
        el('header', { class: 'lk-head' }, el('h2', { class: 'lk-title' }, 'Cartoon you'), R.chip, el('span', { class: 'lk-gap' }), R.over, R.close),
        R.photoSec, R.styleSec, el('div', { class: 'lk-row' }, R.draw), R.plateSec, R.meetSec, R.status));
    root.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); root.classList.add('lk-drop'); } });
    root.addEventListener('dragleave', (e) => { if (e.target === root) root.classList.remove('lk-drop'); });
    root.addEventListener('drop', (e) => { e.preventDefault(); root.classList.remove('lk-drop'); if (e.dataTransfer && e.dataTransfer.files.length) act(() => flpt.likeness.dropPhotos(e.dataTransfer.files)); });
    return root;
  }

  // ── painting ──
  function paint() {
    if (!root) return;
    const v = V || { photos: [], plates: [], parts: [], consent: false, styles: [], style: 'flat', prices: {}, status: 'photos', waiting: 0, failed: [] };
    const drawn = v.plates.length > 0;
    const parts = v.status === 'parts' || v.status === 'ready';
    const working = v.waiting > 0 || v.status === 'parts';
    R.photos.replaceChildren(...v.photos.map((p) => el('div', { class: 'lk-photo', role: 'listitem' },
      p.url ? el('img', { src: p.url, alt: '' }) : el('span', { class: 'lk-ph' }),
      drawn ? null : btn('✕', { class: 'ghost small lk-remove', 'aria-label': `Remove ${p.name}`, onclick: () => act(() => flpt.likeness.removePhoto(p.i)) }))));
    R.add.hidden = drawn || v.photos.length >= 5;
    // once the plates are drawn the style is settled; once the cartoon is made, only it and its controls stay
    R.photoSec.hidden = parts;
    R.styleSec.hidden = drawn;
    R.attest.checked = Boolean(v.consent);
    R.attest.disabled = drawn || Boolean(busy);
    R.styles.replaceChildren(...v.styles.map((s) => btn([s.poster ? el('img', { src: s.poster, alt: '' }) : el('span', { class: 'lk-ph' }), el('span', {}, s.name)],
      { class: 'lk-style', 'aria-pressed': String(v.style === s.id), disabled: drawn || Boolean(busy), onclick: () => act(() => flpt.likeness.style(s.id)) })));
    R.draw.hidden = drawn;
    R.draw.replaceChildren('Draw four · ', el('span', { class: 'lk-money' }, usd(v.prices.plates || 0.36)));
    R.draw.disabled = Boolean(busy) || !v.photos.length || !v.consent;
    R.plateSec.hidden = !drawn || parts;
    R.plates.replaceChildren(...v.plates.map((p, i) => {
      const pic = p.thumb ? el('img', { src: p.thumb, alt: '' }) : el('span', { class: 'lk-ph' }, p.status === 'failed' || p.status === 'unknown' ? '✕' : '');
      return btn([pic, p.framing === 'off' && !p.picked ? el('span', { class: 'hud lk-off', title: 'Framed off' }, 'Off') : null],
        { class: 'lk-plate', role: 'option', 'aria-selected': String(p.picked), 'aria-label': `Plate ${i + 1}`, disabled: Boolean(busy) || p.status !== 'made' || parts || working,
          onclick: () => pick(p.key) });
    }));
    R.again.replaceChildren('Again · ', el('span', { class: 'lk-money' }, usd(v.prices.again || 0.09)));
    R.again.disabled = Boolean(busy) || working || parts;
    R.again.hidden = parts;
    const picked = v.picked && v.picked.ok;
    R.meetSec.hidden = !picked && !parts && !adjusting;
    paintMouths(v, parts);
    const price = mouths === 'drawn' ? v.prices.drawn : v.prices.painted;
    // the parts still missing, priced by main; nothing missing (a pass that stopped): put together again, free
    R.meet.replaceChildren(...(price > 0 ? ['Meet your cartoon · ', el('span', { class: 'lk-money' }, usd(price))] : ['Meet your cartoon']));
    R.meet.hidden = parts;
    R.meet.disabled = Boolean(busy) || !picked || working;
    R.stage.hidden = !v.meet && !(parts && v.picked);
    if (v.picked && v.picked.url) R.video.setAttribute('poster', v.picked.url);
    if (v.meet && R.video.getAttribute('src') !== v.meet) { R.video.setAttribute('src', v.meet); R.play.textContent = '▶'; }
    R.play.hidden = !v.meet;
    R.keep.hidden = v.status !== 'ready';
    R.adjust.hidden = v.status !== 'ready';
    R.keep.disabled = R.adjust.disabled = Boolean(busy) || working || Boolean(adjusting);
    const d = v.status === 'ready' && v.decision;
    R.chip.textContent = v.waiting > 0 ? `● DRAWING · ${v.waiting}` : v.status === 'parts' ? '● MAKING'
      : d ? `${d.mouths === 'patches' ? 'PAINTED' : 'DRAWN'}${d.blink ? ' · BLINKS' : ''}` : '';
    R.chip.hidden = !R.chip.textContent;
    R.over.hidden = !V || working || Boolean(adjusting) || !(v.photos.length || drawn);
    R.over.disabled = Boolean(busy);
    // only the latest step's failures (main drops them once something later happened)
    const failed = (v.failed || []).map((f) => f.error).filter(Boolean);
    const offPlate = v.picked && !v.picked.ok && !v.picked.needsEyes;
    R.status.textContent = err || (offPlate ? 'This plate\'s framing can\'t be fixed.' : '') || failed.at(-1) || '';
    R.status.classList.toggle('bad', Boolean(err || failed.length || offPlate));
    R.edit.hidden = !adjusting;
    if (adjusting) R.stage.hidden = true;
  }

  function paintMouths(v, parts) {
    // once made, the mouths the cartoon really has (decide.js may have fallen back to Drawn)
    const made = v.status === 'ready' && v.decision ? (v.decision.mouths === 'patches' ? 'painted' : 'drawn') : null;
    const now = parts ? (made || v.mouths || 'drawn') : mouths;
    const painted = parts && !v.paintedMade ? [' · ', el('span', { class: 'lk-money' }, usd(v.prices.mouths || 0.72))] : [];
    R.mouthChips.replaceChildren(
      btn('Drawn', { class: 'chip', 'aria-pressed': String(now === 'drawn'), disabled: Boolean(busy) || (parts && (v.waiting > 0 || v.status === 'parts')), onclick: () => setMouths('drawn', parts) }),
      btn(['Painted', ...painted], { class: 'chip', 'aria-pressed': String(now === 'painted'), disabled: Boolean(busy) || (parts && (v.waiting > 0 || v.status === 'parts')), onclick: () => setMouths('painted', parts) }));
  }

  function setMouths(which, parts) {
    if (!parts) { mouths = which; paint(); return; }
    paid(() => flpt.likeness.mouths(which));
  }

  // ── doing ──
  async function refresh() {
    try { const s = await unwrap(flpt.likeness.state()); V = s.view; if (s.problem) err = s.problem; } catch (e) { err = e.message; }
    paint();
    const waiting = V && (V.waiting > 0 || V.status === 'parts');
    if (waiting && !poll && root) poll = setInterval(refresh, 2000);
    if (!waiting && poll) { clearInterval(poll); poll = null; }
  }

  /** A free call: the view it returns, or what went wrong. */
  async function act(fn) {
    err = '';
    busy = '…';
    paint();
    try { const r = await unwrap(fn()); V = r && r.view !== undefined ? r.view : r; } catch (e) { err = e.message; }
    busy = '';
    await refresh();
  }

  /** A paid step: main asks in its own dialog; until it's answered the sheet only waits. */
  async function paid(fn) {
    err = '';
    busy = '…';
    paint();
    try {
      const r = await unwrap(fn());
      if (r && r.view) V = r.view;
      if (r && r.failed && r.failed.length) err = r.failed[0];
    } catch (e) { err = e.message; }
    busy = '';
    await refresh();
  }

  function togglePlay() {
    if (!R.video.getAttribute('src')) return;
    if (R.video.paused) { R.video.play().then(() => { R.play.textContent = '❚❚'; }, () => {}); } else { R.video.pause(); R.play.textContent = '▶'; }
  }

  async function keep() {
    err = '';
    busy = '…';
    paint();
    try {
      const r = await unwrap(flpt.likeness.keep());
      if (r && r.state) S = r.state; // app.js's state (one global scope for the page's classic scripts)
      close();
      const step = (UI.setupSteps || []).find((x) => x && x.id === 'presenter');
      if (step && typeof step.show === 'function') step.show();
      if (typeof renderSteps === 'function') renderSteps('presenter');
      return;
    } catch (e) { err = e.message; }
    busy = '';
    paint();
  }

  /** A plate picked: main reframes and checks it; one it can't read waits for its Eyes box. */
  async function pick(key) {
    await act(() => flpt.likeness.pick(key));
    if (V && V.picked && V.picked.key === key && V.picked.needsEyes) openAdjust('eyes');
  }

  /** Start over: this one set aside (free); the sheet starts empty. */
  async function startOver() {
    if (!window.confirm('Start over?')) return;
    adjusting = null;
    R.edit.replaceChildren();
    await act(() => flpt.likeness.startOver());
  }

  // ── the boxes on the plate: Adjust (eyes and mouth, after Meet) or, for a plate the check can't read, its Eyes ──
  function openAdjust(mode = 'adjust') {
    if (!V || !V.picked) return;
    const start = mode === 'eyes' ? { eyes: V.picked.eyesBox } : { eyes: V.rects && V.rects.eyes, mouth: V.rects && V.rects.mouth };
    // only the boxes there is a rectangle for (the checks found it, or the person set it)
    const ids = ['eyes', 'mouth'].filter((id) => Array.isArray(start[id]) && start[id].length === 4);
    if (!ids.length) return;
    adjusting = { mode, moved: new Set(), ...Object.fromEntries(ids.map((id) => [id, start[id].slice()])) };
    const W = V.picked.w || 2048;
    const pic = el('img', { src: V.picked.full || V.picked.url, alt: '', class: 'lk-edit-pic', draggable: 'false' });
    const frame = el('div', { class: 'lk-edit-frame' }, pic);
    const boxes = {};
    const place = () => {
      if (!adjusting) return; // closed before the plate's picture loaded
      const k = frame.clientWidth / W;
      for (const [id, b] of Object.entries(boxes)) {
        const r = adjusting[id];
        Object.assign(b.style, { left: `${r[0] * k}px`, top: `${r[1] * k}px`, width: `${r[2] * k}px`, height: `${r[3] * k}px` });
      }
    };
    for (const [id, label] of [['eyes', 'Eyes'], ['mouth', 'Mouth']].filter(([id]) => ids.includes(id))) {
      const grip = el('span', { class: 'lk-grip', 'aria-hidden': 'true' });
      const b = el('div', { class: `lk-box lk-box-${id}`, tabindex: '0', role: 'group', 'aria-label': label, title: label }, el('span', { class: 'lk-box-label' }, label), grip);
      drag(b, frame, W, id, false, place);
      drag(grip, frame, W, id, true, place);
      b.addEventListener('keydown', (e) => {
        const step = e.shiftKey ? 16 : 4;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (!d) return;
        e.preventDefault();
        adjusting[id][0] += d[0]; adjusting[id][1] += d[1];
        adjusting.moved.add(id);
        place();
      });
      boxes[id] = b;
      frame.append(b);
    }
    const done = btn('Done', { class: 'primary lk-done', onclick: async () => {
      const a = adjusting;
      adjusting = null;
      R.edit.replaceChildren();
      if (a.mode === 'eyes') { await act(() => flpt.likeness.pick(V.picked.key, a.eyes)); return; }
      // only the boxes the person moved: a box left alone stays as the checks found it
      const rects = Object.fromEntries([...a.moved].map((id) => [id, a[id]]));
      if (!Object.keys(rects).length) { paint(); return; }
      await act(() => flpt.likeness.adjust(rects));
    } });
    const cancel = btn('✕', { class: 'ghost small', 'aria-label': 'Cancel', onclick: () => { adjusting = null; R.edit.replaceChildren(); paint(); } });
    R.edit.replaceChildren(frame, el('div', { class: 'lk-row lk-end' }, cancel, done));
    pic.addEventListener('load', place);
    paint();
    requestAnimationFrame(() => { place(); const first = boxes[ids[0]]; if (first) first.focus(); });
  }

  /** Pointer drag of a box (or of its grip: the size) in plate pixels. */
  function drag(node, frame, W, id, resize, place) {
    node.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const k = frame.clientWidth / W;
      const start = { x: e.clientX, y: e.clientY, r: adjusting[id].slice() };
      node.setPointerCapture(e.pointerId);
      const move = (ev) => {
        if (!adjusting) return;
        const dx = (ev.clientX - start.x) / k, dy = (ev.clientY - start.y) / k;
        const r = start.r.slice();
        if (resize) { r[2] = Math.max(16, start.r[2] + dx); r[3] = Math.max(16, start.r[3] + dy); } else { r[0] = start.r[0] + dx; r[1] = start.r[1] + dy; }
        adjusting[id] = r.map((v) => Math.round(v));
        adjusting.moved.add(id);
        place();
      };
      const up = () => { node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', up); };
      node.addEventListener('pointermove', move);
      node.addEventListener('pointerup', up);
    });
  }

  // ── open and close ──
  /** Tab and Shift-Tab go round the sheet's own controls (it's modal). */
  function trap(e) {
    const items = [...root.querySelectorAll('button, input, [tabindex="0"]')].filter((n) => !n.disabled && n.getClientRects().length && !n.closest('[hidden]'));
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1], at = document.activeElement;
    if (e.shiftKey && (at === first || !root.contains(at))) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && (at === last || !root.contains(at))) { e.preventDefault(); first.focus(); }
  }
  const onKey = (e) => {
    if (!root) return;
    if (e.key === 'Tab') { trap(e); return; }
    if (e.key === 'Escape') { e.preventDefault(); if (adjusting) { adjusting = null; R.edit.replaceChildren(); paint(); } else close(); }
  };
  /** The step's own action first: the primary button that can be pressed, else adding photos, else the ⚑. */
  function focusFirst() {
    if (!root) return;
    const ok = (n) => n && !n.disabled && n.getClientRects().length && !n.closest('[hidden]');
    const first = [...root.querySelectorAll('button.primary')].find(ok) || [R.add, R.attest, R.play].find(ok) || [...root.querySelectorAll('button:not(.lk-close)')].find(ok);
    if (first) first.focus();
  }
  function open() {
    if (root) return;
    returnFocus = document.activeElement;
    document.body.append(build());
    document.addEventListener('keydown', onKey);
    if (typeof flpt.likeness.onChanged === 'function') offs.push(flpt.likeness.onChanged(() => refresh()));
    if (typeof flpt.onGenerate === 'function') offs.push(flpt.onGenerate((ev) => { if (ev && ev.kind === 'likeness') refresh(); }));
    refresh().then(() => {
      if (V && V.picked && V.picked.needsEyes && !adjusting) openAdjust('eyes'); else focusFirst();
    });
  }
  function close() {
    if (!root) return;
    try { R.video.pause(); } catch { /* gone */ }
    root.remove();
    root = null;
    adjusting = null;
    document.removeEventListener('keydown', onKey);
    for (const off of offs) { try { off(); } catch { /* gone */ } }
    offs = [];
    if (poll) { clearInterval(poll); poll = null; }
    if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus();
  }

  // the sheet's own look, through the CSSOM (the page's CSP allows stylesheets from 'self' only; every ui-* sheet is tagged)
  try {
    const css = new CSSStyleSheet();
    css.replaceSync(`.lk-scrim { position: fixed; inset: 0; z-index: 4; display: grid; place-items: center; padding: 24px; background: var(--scrim); }
      .lk-scrim.lk-drop .lk { box-shadow: 0 0 0 2px var(--gold); }
      .lk { width: min(860px, 100%); max-height: calc(100vh - 48px); overflow: auto; display: grid; gap: 14px; align-content: start; padding: 18px 22px 20px;
        border: 1px solid var(--line); border-radius: var(--r-3); background: var(--bg); color: var(--text); font: var(--fs-body) var(--font-ui); animation: fx-rise var(--d-4) var(--ease) both; }
      html.fx-paused .lk { animation: none; }
      @media (prefers-reduced-motion: reduce) { .lk { animation: none; } }
      .lk button { color: var(--text); border-color: var(--line); background: transparent; }
      .lk button.primary { background: var(--navy); border-color: var(--navy); color: var(--on-navy); }
      .lk button[aria-pressed="true"], .lk button[aria-selected="true"] { border-color: var(--gold); box-shadow: 0 0 0 2px var(--gold) inset; }
      .lk button:disabled { opacity: .45; cursor: default; }
      .lk [hidden] { display: none !important; }
      .lk-head { display: flex; align-items: center; gap: 12px; }
      .lk-title { margin: 0; font: 600 var(--fs-lead)/1.2 var(--font-display); }
      .lk-gap { flex: 1; }
      .lk-chip { color: var(--gold); }
      .lk-close { width: 32px; padding-left: 0; padding-right: 0; }
      .lk-over { color: var(--text-2) !important; border-color: transparent !important; }
      .lk-sec { display: grid; gap: 8px; }
      .lk-sec h3.hud { margin: 0; color: var(--text-2); }
      .lk-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .lk-end { justify-content: flex-end; }
      .lk-label { color: var(--text-2); }
      .lk-photos, .lk-plates, .lk-styles { display: flex; gap: 10px; flex-wrap: wrap; }
      .lk-photo { position: relative; width: 72px; height: 72px; border-radius: var(--r-2); overflow: hidden; border: 1px solid var(--line); }
      .lk-photo img, .lk-plate img, .lk-style img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .lk-remove { position: absolute; top: 2px; right: 2px; width: 22px; height: 22px; padding: 0; background: var(--bg) !important; }
      .lk-add { width: 72px; height: 72px; font-size: var(--fs-lead); }
      .lk-attest { display: inline-flex; align-items: center; gap: 8px; font-size: var(--fs-small); color: var(--text); }
      .lk-style { display: grid; gap: 4px; justify-items: center; width: 104px; padding: 6px; border-radius: var(--r-2); }
      .lk-style img { width: 88px; height: 88px; border-radius: 50%; }
      .lk-plate { position: relative; width: 128px; height: 128px; padding: 0; overflow: hidden; border-radius: var(--r-2); }
      .lk-ph { display: grid; place-items: center; width: 100%; height: 100%; background: var(--surface); color: var(--text-2); }
      .lk-off { position: absolute; left: 6px; bottom: 6px; padding: 2px 6px; border-radius: var(--r-pill); background: var(--bg); color: var(--text-2); }
      .lk-money { color: var(--money); font-weight: 600; }
      .lk button.primary .lk-money { color: var(--on-navy); }
      .lk-meet-body { display: grid; grid-template-columns: auto 1fr; gap: 18px; align-items: start; }
      .lk-meet-side { display: grid; gap: 12px; align-content: start; }
      .lk-stage { position: relative; width: 300px; height: 300px; border-radius: var(--r-3); overflow: hidden; background: var(--surface); justify-self: start; }
      .lk-video { width: 100%; height: 100%; object-fit: cover; display: block; }
      .lk-play { position: absolute; left: 10px; bottom: 10px; width: 40px; height: 40px; padding: 0; border-radius: 50%; background: var(--bg) !important; }
      .lk-edit { display: grid; gap: 10px; }
      .lk-edit-frame { position: relative; width: min(480px, 100%); aspect-ratio: 1; user-select: none; touch-action: none; }
      .lk-edit-pic { width: 100%; height: 100%; display: block; border-radius: var(--r-2); }
      .lk-box { position: absolute; border: 2px solid var(--gold); border-radius: var(--r-1); cursor: move; }
      .lk-box:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
      .lk-box-label { position: absolute; left: -2px; bottom: calc(100% + 4px); padding: 1px 8px; border-radius: var(--r-pill); background: var(--bg); color: var(--text);
        font: 600 var(--fs-small)/1.4 var(--font-ui); white-space: nowrap; }
      .lk-grip { position: absolute; right: -6px; bottom: -6px; width: 12px; height: 12px; border-radius: 50%; background: var(--gold); cursor: nwse-resize; }
      .lk-status { margin: 0; min-height: 1.2em; font-size: var(--fs-small); color: var(--text-2); }
      .lk-status.bad { color: var(--text); }`);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, css];
  } catch { /* an older engine: the base styles do */ }

  // registered only where this surface can make one (the Mac app: caps.likeness, ext/likeness.js)
  const register = () => { UI.components.likeness = { open, close, state: () => ({ open: Boolean(root), view: V, mouths, adjusting: adjusting && { mode: adjusting.mode, eyes: adjusting.eyes || null, mouth: adjusting.mouth || null } }) }; };
  if (flpt.app && typeof flpt.app.caps === 'function') {
    Promise.resolve(flpt.app.caps()).then((r) => { if (r && r.ok && r.value && r.value.likeness === true) register(); }, () => {});
  }
})();
