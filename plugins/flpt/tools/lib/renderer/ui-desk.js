'use strict';
/* global flpt, el, ep */
// ui-desk.js · the Desk's crews in chat (PLAN §3.3 S17, draft-ux §12.2; R-05, decisions.md "Desk (W4-02's S17)": option
// (a)). Where the crews, the drafts and the film run in Claude Code (flpt.app.caps().crew 'chat': the plugin's Desk,
// whose methods for them answer "Runs in Claude Code.", engine/tools/flpt-desk.js), every control that would start,
// stop or pay for one becomes the mono RUNS IN CLAUDE CODE chip, with no price or cap line beside it, and Spend leaves
// the rail with the episode's costs (money is asked in chat). Elsewhere (crew 'sdk': the Mac, the web) it does nothing.
// The screens stay their own: an observer reads what each one renders, before it paints, and swaps
//   the stages (episodes.js)        a crew's run box, its Stop and its last run's cost; the animators'; the free draft's
//                                   Make and its Generate $; Spend's estimate; Film it and a new approval; Refine's Apply;
//                                   Deliver; the Slack pack; Scenes' makes; and the approvals chat gives (Scenes on, as
//                                   flpt-desk's CHAT_STAGES); Refine's Tighten pauses and Cut laughs (chat's to set)
//   a Scenes still or shot, large   its Approve, Again, Leave it still and Animate it (Close stays)
//   the Live Motion wall            Make all and Stop; each card's Again; the last run's cost
//   the Studio                      Ask for changes, Again and Stop: one chip in their place
//   the Storyboard                  Polish and its cap
//   the rail                        Spend (the steps renumbered), the costs, Jazz's Play on, Stop and Every step (chat
//                                   plays Jazz: a Stop here stops nothing there)
//   Spend's own screen              titled Free draft (what's left of it here: the draft), without its approval's status;
//                                   a cover's Next: Spend and Jazz's · Spend read Free draft too
//   Setup (app.js)                  the tools' install, the free check, the free and the paid sample
// and any action in an episode that names a price (a storyboard card's own estimate stays). The Stage isn't in the Desk
// yet (2.1): no live preview there.
(() => {
  if (!window.flpt || !flpt.app || typeof flpt.app.caps !== 'function' || typeof el !== 'function') return;

  const CHAT_STAGES = ['scenes', 'spend', 'film', 'refine', 'deliver']; // approved in chat (flpt-desk.js)
  // the buttons that start or stop a crew, a draft, a film or one of chat's steps, by their label (as the screens write them)
  const RUNS = /^(Start the .+ crew|Run again with these notes|Stop the (crew|animators)|Animate (the slide|\d+ slides)|Polish|Make the free draft|Make again|Making…|Film it|Film again|Film again: approve a new budget…|Approve a new budget…|Approve the film|Nothing to pay: continue|Apply|Deliver|Deliver again|From your export…|From a new export…|From your CapCut export…|From a new CapCut export…|From the delivered video|Making the Slack pack…|Put it together|Starting…|Play on)$/;
  const WALL = /^(Make all\b.*|Stop)$/; // the Live Motion wall's bar
  const JAZZ = /^(Stop|Every step|Pause after each step)$/; // the rail's Jazz box while it plays (chat's play-through)
  const PRICED = /\$\s?\d|\$$|US dollars/; // a label with a price in it
  const MONEY = /of Claude usage|US dollars|\$\s?\d|^Budget: |its own approval\.$|^Nothing to pay/; // a price or cap line
  const SETUP = ['tools-install', 'run-check', 'run-draft'];

  const css = new CSSStyleSheet();
  css.replaceSync(`.desk-chip { display: inline-flex; align-items: center; padding: 5px 11px; border: 1px solid var(--rule); border-radius: var(--r-pill);
  background: var(--card); color: var(--ink-2); font: 500 var(--fs-hud)/1.4 var(--font-mono); letter-spacing: var(--track-hud); text-transform: uppercase; white-space: nowrap; }
.runbox > .desk-chip { margin: 4px 0 2px; }
.jazz-box .desk-chip { max-width: 100%; padding: 5px 8px; letter-spacing: .1em; overflow: hidden; text-overflow: ellipsis; }
:root[data-crew="chat"] [data-desk-off], :root[data-crew="chat"] #episode-cost, :root[data-crew="chat"] #paid { display: none !important; }`);

  const chip = () => el('span', { class: 'desk-chip', title: 'Claude runs it in your chat' }, 'Runs in Claude Code');
  const label = (b) => (b.textContent || '').replace(/\s+/g, ' ').trim();
  const each = (root, sel, fn) => { if (root.matches(sel)) fn(root); for (const n of root.querySelectorAll(sel)) fn(n); };
  const shownStage = () => { try { return typeof ep !== 'undefined' && ep && ep.view ? ep.stage : null; } catch { return null; } };
  const off = (n) => { n.dataset.deskOff = ''; };
  const ROWS = '.actions, .lm-bar, .zoom-acts'; // where a control sits with its price and cap lines
  const DRAFT = 'Free draft'; // what Spend's screen is here: its free draft

  /** A button the Desk leaves to chat: the chip in its place (one per row), and the row's price and cap lines gone. */
  function swap(b) {
    const row = b.closest(ROWS) || b.parentElement;
    if (row && row.querySelector(':scope > .desk-chip')) b.remove(); else b.replaceWith(chip());
    if (row) for (const m of row.querySelectorAll(':scope > .muted')) if (MONEY.test(label(m))) m.remove();
  }

  function button(b) {
    if (!b.isConnected || b.closest('.studio, .desk-chip')) return;
    const t = label(b);
    const wall = b.closest('.lm-bar');
    const row = wall || b.closest('.actions'); // a price on an action (a storyboard card's own estimate stays)
    const zoom = b.closest('.scene-zoom .zoom-acts'); // a Scenes still or shot, large: all of it is episode.scene's, but Close
    if ((wall && WALL.test(t)) || (zoom && t !== 'Close') || (b.closest('#jazz-box') && JAZZ.test(t)) || RUNS.test(t) || (row && PRICED.test(t))
      || (t === 'Approve and continue' && CHAT_STAGES.includes(shownStage()))) swap(b);
  }

  /** The Studio's own controls live as long as it does: hidden (it keeps them), with one chip while any would show. */
  function studio(foot) {
    if (foot.querySelector(':scope > .desk-chip')) return;
    const theirs = [...foot.querySelectorAll(':scope > button')].filter((b) => /^(Again|Stop)$/.test(label(b)));
    const ask = foot.querySelector('.studio-askbox');
    const hide = [...theirs, ...(ask ? [ask] : [])];
    hide.forEach(off);
    const c = chip();
    const sync = () => { c.hidden = hide.every((n) => n.hidden); };
    foot.insertBefore(c, theirs[0] || foot.firstChild);
    sync();
    const mo = new MutationObserver(sync);
    for (const n of hide) mo.observe(n, { attributes: true, attributeFilter: ['hidden'] });
  }

  /** Spend's name in the rail (the open episode's stages say it). */
  const spendLabel = () => {
    try { const s = typeof ep !== 'undefined' && ep && ep.view && ep.view.stages.find((x) => x.id === 'spend'); if (s) return s.label; } catch { /* the default */ }
    return 'Spend';
  };

  /** Where a line names Spend as a step (a cover's Next:, where Jazz stopped), it names the free draft: its text, in place. */
  function rename(n) {
    const spend = spendLabel();
    for (const t of n.childNodes) {
      if (t.nodeType === 3 && ['Next: ', '· '].some((lead) => t.nodeValue.endsWith(lead + spend))) t.nodeValue = t.nodeValue.slice(0, -spend.length) + DRAFT;
    }
  }

  /** Spend leaves the rail; the steps after it are numbered on. */
  function rail(list) {
    const spend = spendLabel();
    let n = 0;
    for (const li of list.children) {
      const b = li.querySelector('button');
      const l = li.querySelector('.lbl');
      if (l && label(l) === spend) { off(li); continue; }
      if (b && b.dataset.n) { n += 1; b.dataset.n = String(n).padStart(2, '0'); }
    }
  }

  function sweep(root) {
    if (root.nodeType !== 1 || root.classList.contains('desk-chip')) return;
    if (root.closest('#episode-main')) {
      each(root, '.runbox', (r) => { if (!r.querySelector(':scope > .desk-chip')) r.replaceChildren(chip()); });
      each(root, '.spend .estimate, .upgrades, .lm-acts, .lm-cost', (n) => n.remove());
      each(root, '.actions > .muted', (m) => { if (m.isConnected && MONEY.test(label(m))) m.remove(); });
      each(root, '.refine-bar .tighten', off); // flpt.setTighten is chat's (the Apply chip stands for the step)
      if (shownStage() === 'spend') { // Spend's screen, reached as the current step or by name: its free draft, titled so
        each(root, '.stage-head > h2', (h) => { if (h.textContent !== DRAFT) h.textContent = DRAFT; });
        each(root, '.stage-head > .chip, section.draft .draft-head > h3', off);
      }
    }
    if (root.closest('#episode-main, #jazz-box, dialog.scene-zoom')) each(root, 'button', button);
    each(root, '.ep-card .ep-meta, #jazz-box .hud', rename);
    each(root, '.studio-foot', studio);
    if (root.closest('#stage-list') || root.id === 'stage-list' || root.querySelector('#stage-list')) { const list = document.getElementById('stage-list'); if (list) rail(list); }
  }

  function start() {
    document.documentElement.dataset.crew = 'chat';
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, css];
    for (const id of SETUP) {
      const b = document.getElementById(id);
      if (b && !b.dataset.deskOff) { off(b); b.after(chip()); }
    }
    sweep(document.body);
    new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1 && n.isConnected) sweep(n); })
      .observe(document.body, { childList: true, subtree: true });
  }

  Promise.resolve(flpt.app.caps()).then((r) => { if (r && r.ok && r.value && r.value.crew === 'chat') start(); }, () => {});
})();
