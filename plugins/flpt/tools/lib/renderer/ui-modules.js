'use strict';
/* global flpt */
// ui-modules.js · the nine-module picker (PLAN §3.3 S5c, draft-ux S5c; W2-04), shared: the Storyboard inspector, the
// Deck's calls, and later the Library's "Use in…", the web and the Desk. FLPT_UI.components.modulePicker(host, opts):
// the nine tiles in the catalog's order (module 1 is Chart), Solo and Duet under a gold LIVE MOTION eyebrow, each with
// a gold NEW through 2.0.x (the catalog's isNew); then 0 · Title card; then the dashed "Your look" tile, always last
// (decisions.md: it opens the reference sheet, W3-02's; until that's registered as FLPT_UI.components.referenceSheet the
// tile is there but off); and the footer line in mono micro. Labels only; the full names are the tooltips.
//   opts.catalog    flow.open's catalog (id, name, tile, family, isNew…)
//   opts.value      the module chosen now (or null)
//   opts.onPick     (id) → … when a tile is pressed ('statement' for the Title card)
//   opts.placement  'slide' or 'between': the modules that can't go there are off (a scene between slides is a Solo ♪
//                   or a cut scene); null: every one
//   opts.titleCard  show 0 · Title card (default true) · opts.yourLook: show the Your look tile (default true)
//   opts.compact    the inspector's size · opts.disabled: look, don't touch · opts.episode, opts.shot: for Your look
// Each tile plays its muted loop on hover or focus, one at a time across every picker, and never while ambient motion is
// held (Pause motion, reduced motion, a hidden window): then it's the poster. Loops: assets/modules/<id>.mp4 (and .jpg).
//   → { el, set(value), setPlacement(p), setDisabled(b), stop(), destroy() }
(() => {
  const UI = window.FLPT_UI;
  if (!UI || !UI.components) return;

  const FAMILY_LINE = 'Nine for mortal men, doomed to die.'; // modules.FAMILY_LINE (a test holds them equal)
  const TITLE_CARD = { id: 'statement', name: 'Title card', tile: 'Title card', family: 'build' };
  const BETWEEN = new Set(['motion-solo', 'cutscene']);
  const LIVE = new Set(['motion-solo', 'motion-duet']);
  const h = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v === true) n.setAttribute(k, '');
      else if (v !== false && v != null) n.setAttribute(k, v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  };
  const held = () => (typeof UI.motionHeld === 'function' ? UI.motionHeld() : false);
  const asset = (id, ext) => `assets/modules/${id}.${ext}`;

  // ── one tile playing at a time, across every picker ──
  let playing = null; // the <video> playing now
  function stop(v = playing) {
    if (!v) return;
    try { v.pause(); } catch { /* gone */ }
    if (v.currentTime > 0 || v.played.length) v.load(); // back to its poster
    if (playing === v) playing = null;
  }
  function play(v) {
    if (!v || held()) return;
    if (playing && playing !== v) stop(playing);
    playing = v;
    v.muted = true;
    v.play().catch(() => { if (playing === v) playing = null; });
  }
  document.addEventListener('flpt:motion', () => { if (held()) stop(); });

  function modulePicker(host, opts = {}) {
    const catalog = (Array.isArray(opts.catalog) ? opts.catalog : []).filter((m) => m && m.id);
    let value = opts.value || null;
    let placement = opts.placement || null;
    let disabled = Boolean(opts.disabled);
    const tiles = new Map(); // id → button

    function tile(m, n) {
      const isLive = LIVE.has(m.id);
      const video = m.id === 'statement' ? null
        : h('video', { class: 'mp-loop', muted: true, loop: true, playsinline: true, preload: 'none', poster: asset(m.id, 'jpg'), src: asset(m.id, 'mp4'), 'aria-hidden': 'true' });
      if (video) video.muted = true; // the attribute alone doesn't mute a video made by script
      const b = h('button', {
        type: 'button', class: `mp-tile${isLive ? ' mp-live-tile' : ''}${m.id === 'statement' ? ' mp-title' : ''}`, role: 'radio', 'aria-checked': 'false',
        'data-module': m.id, 'data-family': m.family || 'build', title: m.name, 'aria-label': `${n} · ${m.tile}`,
      },
      m.id === 'statement' ? h('span', { class: 'mp-media mp-card' }, h('span', { class: 'mp-card-text', 'aria-hidden': 'true' }, 'Aa'))
        : h('span', { class: 'mp-media' }, video),
      h('span', { class: 'mp-label' }, h('span', { class: 'mp-n hud' }, String(n)), h('span', { class: 'mp-name' }, m.tile)),
      m.isNew ? h('span', { class: 'mp-new hud' }, 'New') : null);
      if (m.id !== 'statement') {
        const on = () => { if (!b.disabled) play(video); };
        const off = () => stop(video);
        b.addEventListener('pointerenter', on);
        b.addEventListener('pointerleave', () => { if (document.activeElement !== b) off(); });
        b.addEventListener('focus', on);
        b.addEventListener('blur', off);
      }
      b.addEventListener('click', () => {
        if (b.disabled || disabled) return;
        if (typeof opts.onPick === 'function') opts.onPick(m.id);
      });
      tiles.set(m.id, b);
      return b;
    }

    const originals = catalog.filter((m) => !LIVE.has(m.id));
    const live = catalog.filter((m) => LIVE.has(m.id));
    const number = (m) => catalog.indexOf(m) + 1;
    const grid = h('div', { class: 'mp-grid' }, ...originals.map((m) => tile(m, number(m))),
      live.length ? h('div', { class: 'mp-livegroup', role: 'presentation' }, h('span', { class: 'mp-eyebrow hud', 'aria-hidden': 'true' }, 'Live Motion'),
        ...live.map((m) => tile(m, number(m)))) : null);
    const extras = [];
    if (opts.titleCard !== false) extras.push(tile(TITLE_CARD, 0));
    let look = null;
    if (opts.yourLook !== false) {
      look = h('button', { type: 'button', class: 'mp-tile mp-look', 'data-module': 'your-look', title: 'Your look' },
        h('span', { class: 'mp-media mp-dashed' }, h('span', { class: 'mp-q', 'aria-hidden': 'true' }, '?')),
        h('span', { class: 'mp-label' }, h('span', { class: 'mp-name' }, 'Your look')));
      look.addEventListener('click', () => {
        const sheet = UI.components.referenceSheet;
        if (typeof sheet === 'function') sheet({ from: 'picker', episode: opts.episode || null, shot: opts.shot || null });
        else if (sheet && typeof sheet.open === 'function') sheet.open({ from: 'picker', episode: opts.episode || null, shot: opts.shot || null });
        document.dispatchEvent(new CustomEvent('flpt:your-look', { detail: { from: 'picker', episode: opts.episode || null, shot: opts.shot || null } }));
      });
      extras.push(look);
    }
    const root = h('div', { class: `mp${opts.compact ? ' mp-compact' : ''}`, role: 'radiogroup', 'aria-label': opts.label || 'Module' },
      grid, extras.length ? h('div', { class: 'mp-extras' }, ...extras) : null,
      h('p', { class: 'mp-footer hud' }, FAMILY_LINE));

    function paint() {
      for (const [id, b] of tiles) {
        const off = disabled || (placement === 'between' ? !BETWEEN.has(id) : placement === 'slide' ? id === 'cutscene' : false);
        b.disabled = off;
        b.setAttribute('aria-checked', String(id === value));
        if (off && playing && b.contains(playing)) stop();
      }
      if (look) {
        const sheet = UI.components.referenceSheet;
        look.disabled = disabled || !(typeof sheet === 'function' || (sheet && typeof sheet.open === 'function'));
      }
    }

    host.replaceChildren(root);
    paint();
    return {
      el: root,
      set(v) { value = v || null; paint(); },
      setPlacement(p) { placement = p || null; paint(); },
      setDisabled(b) { disabled = Boolean(b); paint(); },
      stop() { if (playing && root.contains(playing)) stop(); },
      destroy() { if (playing && root.contains(playing)) stop(); root.remove(); },
    };
  }
  modulePicker.FAMILY_LINE = FAMILY_LINE;
  modulePicker.TITLE_CARD = TITLE_CARD;
  modulePicker.asset = asset;
  UI.components.modulePicker = modulePicker;
})();
