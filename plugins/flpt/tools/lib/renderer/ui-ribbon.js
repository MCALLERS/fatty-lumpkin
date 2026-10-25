'use strict';
/* global el */
// ui-ribbon.js · the ribbon (PLAN §3.3 S6–S7, draft-ux S6–S7; W2-04): the storyboard's shots above every stage from the
// Deck on, in FLPT_UI.slots.ribbon, as FLPT_UI.components.ribbon.render(slot, view, stageId, { select }). Each segment
// is a shot (its width its seconds, its colour its module's family) filled to how far it has come: an outline when
// planned, a quarter when designed (its slide or scene is in the deck), a half when animated, full when filmed; ✓ when
// the step that got it there is approved. On the Script the bars are the script's seconds over a ghost of the plan's.
// A click hands the shot to select(shot) (the Deck scrolls to its slide; the Script to its section). The line on the
// right is main's (view.planview.ribbon: worked out in ext/planview.js). Nothing here moves on its own.
(() => {
  const UI = window.FLPT_UI;
  if (!UI || !UI.components) return;
  const FILL = { planned: 0, designed: 25, animated: 50, filmed: 100 };
  const pad2 = (n) => String(n).padStart(2, '0');
  const clockOf = (secs) => `${Math.floor(Math.round(secs) / 60)}:${pad2(Math.round(secs) % 60)}`;

  /** Where the ribbon shows: from the Deck on, for an episode with a storyboard to follow. */
  const shows = (view, stageId) => Boolean(view && view.planview && view.planview.ribbon && view.planview.ribbon.shots.length
    && !['intake', 'bullets', 'factcheck', 'storyboard'].includes(stageId));

  // The ribbon's own place in the slot: made once, kept there; nothing else in the slot is touched (a slot outlives
  // every rebuild, and what others put in it stays).
  const hosts = new WeakMap();
  function hostIn(slot) {
    let h = hosts.get(slot);
    if (!h || !h.isConnected || h.parentNode !== slot) { h = el('div', { class: 'rb-host' }); slot.append(h); hosts.set(slot, h); }
    return h;
  }
  /** No ribbon here (Home, the stages before the Deck, an episode without a storyboard). */
  function clear(slot) { const h = slot && hosts.get(slot); if (h) h.replaceChildren(); }

  function render(slot, view, stageId, opts = {}) {
    if (!slot) return null;
    if (!shows(view, stageId)) { clear(slot); return null; }
    const rb = view.planview.ribbon;
    const script = stageId === 'script' && Boolean(rb.script);
    const segs = rb.shots.map((s) => {
      const planned = s.planned || 1;
      const actual = s.actual == null ? planned : s.actual;
      const span = script ? Math.max(planned, actual) : planned;
      const label = `${s.n ? pad2(s.n) : s.tile} · ${s.tile} · ${clockOf(script ? actual : planned)}${script ? ` / ${clockOf(planned)}` : ''}`;
      const b = el('button', {
        type: 'button', class: `rb-seg${s.placement === 'between' ? ' rb-between' : ''}${s.live ? ' rb-live' : ''}`, 'data-shot': s.id, 'data-family': s.family,
        'data-state': s.state, title: `${label}${s.changed ? ` · ${s.changed.from} → ${s.changed.to}` : ''}`, 'aria-label': label,
        onclick: () => { if (typeof opts.select === 'function') opts.select(s); },
      });
      if (script) {
        const ghost = el('span', { class: 'rb-ghost' });
        ghost.style.width = `${(100 * planned) / span}%`;
        const bar = el('span', { class: 'rb-bar' });
        bar.style.width = `${(100 * actual) / span}%`;
        b.append(ghost, bar);
      } else {
        const fill = el('span', { class: 'rb-fill' });
        fill.style.width = `${FILL[s.state] || 0}%`;
        b.append(fill);
      }
      if (s.n) b.append(el('span', { class: 'rb-n hud' }, pad2(s.n))); // a scene between slides is its dashed sliver, named in its tooltip
      if (s.approved) b.append(el('span', { class: 'rb-ok', 'aria-hidden': 'true' }, '✓'));
      b.style.flexGrow = String(Math.max(1, span));
      return b;
    });
    const box = el('nav', { class: `rb${script ? ' rb-script' : ''}`, 'aria-label': 'Storyboard', 'data-realm': opts.realm || false },
      el('div', { class: 'rb-strip' }, ...segs),
      el('span', { class: 'rb-line hud' }, script ? rb.script : rb.line));
    hostIn(slot).replaceChildren(box);
    return box;
  }

  UI.components.ribbon = { render, shows, clear };
})();
