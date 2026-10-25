'use strict';
/* global flpt, el */
// ui-stage.js · the Stage in the page (PLAN §2.5; W1-14). Where the Stage is a native view over the page (the Mac:
// caps.stage 'view'), this keeps it over the Stage slot (FLPT_UI.anchor('stage'), which app.js keeps over its anchor
// through every rebuild): each move of the slot, and anything that comes to cover it (a dialog, a menu, the job log),
// goes to main as flpt.stage.place(…), and the view follows or hides. After the watchdog stops a piece, the slot shows
// its poster and "Play the render". Screens use it as FLPT_UI.components.stage:
//   open({ source, id, t }) · send(command) · close() · state() · on((kind, x) => …) → unsubscribe
//     kind 'state': the Stage's state (open, ready, killed, off, …) · kind 'event': the harness's ready, tick, error, snapshot
(() => {
  const UI = window.FLPT_UI;
  if (!UI || !UI.slots || !UI.slots.stage || !window.flpt || !flpt.stage || typeof flpt.stage.place !== 'function') return;
  const slot = UI.slots.stage;
  let view = false; // caps.stage === 'view': a native view to place (elsewhere the Stage lives in the slot itself)
  let st = { open: false };
  const subs = new Set();
  const tell = (kind, x) => { for (const fn of subs) { try { fn(kind, x); } catch (e) { console.error(e); } } }; // eslint-disable-line no-console

  // ── the slot's own box: the poster and the render after a kill (under the view while it shows) ──
  const box = el('div', { class: 'stage-host' });
  Object.assign(box.style, { position: 'absolute', inset: '0', display: 'none', placeItems: 'center', background: 'var(--bg, #11110E)', overflow: 'hidden' });
  slot.append(box);
  let shown = ''; // what the box shows now, so a repeated state doesn't restart the render
  function paint() {
    const want = st.open && st.killed ? JSON.stringify([st.poster, st.render, st.off]) : '';
    if (want === shown) return;
    shown = want;
    if (!want) { box.replaceChildren(); box.style.display = 'none'; return; }
    const kids = [];
    if (st.poster) {
      const img = el('img', { src: st.poster, alt: '' });
      Object.assign(img.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain' });
      kids.push(img);
    }
    if (st.render) {
      const b = el('button', { type: 'button', class: 'stage-render' }, 'Play the render');
      Object.assign(b.style, { position: 'relative' });
      b.addEventListener('click', () => playRender(st.render));
      kids.push(b);
    }
    box.replaceChildren(...kids);
    box.style.display = 'grid';
  }
  function playRender(src) {
    const v = el('video', { src, playsinline: true, controls: true });
    Object.assign(v.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain', background: '#000' });
    box.replaceChildren(v);
    v.play().catch(() => {});
  }

  // ── where the slot is, and whether anything covers it ──
  let geom = null; // the slot's last geometry (app.js: 'slot:move')
  let sent = '';
  /** Anything but the slot at any of nine points over its box (K2: a dialog, a menu, the job log, a header). */
  function covered(g) {
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    const x0 = Math.max(g.x, 0) + 3, x1 = Math.min(g.x + g.width, vw) - 3;
    const y0 = Math.max(g.y, 0) + 3, y1 = Math.min(g.y + g.height, vh) - 3;
    if (x1 <= x0 || y1 <= y0) return true;
    for (const x of [x0, (x0 + x1) / 2, x1]) {
      for (const y of [y0, (y0 + y1) / 2, y1]) {
        const e = document.elementFromPoint(x, y);
        if (!e || (e !== slot && !slot.contains(e))) return true;
      }
    }
    return false;
  }
  function report(force = false) {
    if (!view || (!st.open && !force)) return;
    let g = { visible: false };
    if (geom && geom.visible && !slot.hidden) {
      const c = geom.clip || {};
      const clipped = (c.top || 0) + (c.right || 0) + (c.bottom || 0) + (c.left || 0) > 0.5; // a native view can't be clipped
      if (!clipped && !covered(geom)) g = { visible: true, x: geom.x, y: geom.y, width: geom.width, height: geom.height };
    }
    const key = JSON.stringify([g, window.devicePixelRatio]); // a zoom moves the view even when the CSS box doesn't (K2)
    if (key === sent && !force) return;
    sent = key;
    flpt.stage.place(g).catch(() => {});
  }
  /** The slot as app.js last placed it, for a page that loads this after the slot moved. */
  function fromSlot() {
    if (slot.hidden) return { visible: false };
    const r = slot.getBoundingClientRect();
    const m = /inset\(([\d.]+)px ([\d.]+)px ([\d.]+)px ([\d.]+)px\)/.exec(slot.style.clipPath || '');
    const clip = m ? { top: +m[1], right: +m[2], bottom: +m[3], left: +m[4] } : {};
    return { visible: r.width > 0 && r.height > 0, x: r.left, y: r.top, width: r.width, height: r.height, clip };
  }
  geom = fromSlot();
  slot.addEventListener('slot:move', (e) => { geom = e.detail || null; report(); });
  new MutationObserver(() => report()).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['open', 'hidden', 'class'] });
  addEventListener('resize', () => report());
  setInterval(() => { if (st.open) report(); }, 250); // the safety net for what no observer reports (CSS alone)

  flpt.stage.onState((s) => { st = s && typeof s === 'object' ? s : { open: false }; paint(); report(true); tell('state', st); });
  flpt.stage.onEvent((ev) => tell('event', ev));
  Promise.resolve(flpt.app && flpt.app.caps ? flpt.app.caps() : null).then((r) => {
    view = !!(r && r.ok && r.value && r.value.stage === 'view');
    if (view) report(true);
  }).catch(() => {});

  const unwrap = (r) => { if (r && r.ok) return r.value; throw new Error((r && r.error) || 'The Stage didn\'t answer.'); };
  UI.components.stage = {
    async open(spec) { const s = unwrap(await flpt.stage.open(spec)); st = s; paint(); report(true); return s; },
    async send(cmd) { return unwrap(await flpt.stage.send(cmd)); },
    async close() { const s = unwrap(await flpt.stage.close()); st = s; paint(); report(true); return s; },
    state: () => st,
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
})();
