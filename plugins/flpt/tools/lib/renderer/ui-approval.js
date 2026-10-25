'use strict';
/* global el */
// ui-approval.js · the web's spend modal and dialogs (PLAN §2.13 "Approvals"; W4-01). The Mac asks in its own native
// dialog, so there this does nothing. In a browser (window.flptWeb, from bridge/web-bridge.js) the server's
// approval:request becomes a modal: the title, the message and what it costs as the core wrote them, "This month"
// when the web knows the user's ceiling, and two buttons, Cancel first and focused, so Return or Esc says no. The answer
// goes back with the request's own nonce and hash (one use; the server refuses anything else), and a request answered
// in another tab, or past its time, closes here too. The core's other dialogs come the same way: dialog:ask (a message
// box: its buttons, its cancel on Esc) and dialog:open (a file picker; the picked files are uploaded, never their
// paths). One at a time, in order. No motion: it appears and goes, so Pause motion and reduced motion hold.
(() => {
  const W = window.flptWeb;
  if (!W || typeof W.on !== 'function' || typeof el !== 'function') return;

  const css = new CSSStyleSheet();
  css.replaceSync(`dialog.approval { width: min(480px, calc(100vw - 48px)); padding: 26px 28px 22px; border: 1px solid var(--rule); border-radius: var(--r-3);
  background: var(--paper); color: var(--ink); box-shadow: 0 30px 80px -30px rgba(0, 0, 0, .55); }
dialog.approval::backdrop { background: var(--scrim); }
dialog.approval h2 { margin: 0 0 10px; font-size: var(--fs-lead); }
dialog.approval p { margin: 0 0 10px; white-space: pre-line; }
dialog.approval .detail { color: var(--ink-2); font-size: var(--fs-small); }
dialog.approval .month { color: var(--ink-2); font-size: var(--fs-small); }
dialog.approval .actions { display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; margin-top: 18px; }`);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, css];

  const box = el('dialog', { class: 'approval', 'aria-modal': 'true' });
  document.body.append(box);
  const queue = []; // requests waiting their turn: [kind, x]
  let cur = null; // [kind, x] on screen
  let timer = null;

  const usd = (n) => `$${Number(n).toFixed(Number(n) % 1 ? 2 : 0)}`;

  function close() {
    clearTimeout(timer);
    cur = null;
    if (box.open) box.close();
    box.replaceChildren();
    next();
  }

  function next() {
    if (cur || !queue.length) return;
    cur = queue.shift();
    const [kind, x] = cur;
    const kids = [];
    if (x.title) kids.push(el('h2', { 'data-content': '' }, x.title));
    if (x.message) kids.push(el('p', { 'data-content': '' }, x.message));
    if (x.detail) kids.push(el('p', { class: 'detail', 'data-content': '' }, x.detail));
    let buttons;
    if (kind === 'approval:request') {
      if (x.month && Number.isFinite(Number(x.month.usd)) && Number.isFinite(Number(x.month.ceilingUsd))) kids.push(el('p', { class: 'month' }, `This month: ${usd(x.month.usd)} of ${usd(x.month.ceilingUsd)}`));
      const no = el('button', { type: 'button', onclick: () => send(false) }, 'Cancel');
      const yes = el('button', { type: 'button', class: 'primary', onclick: () => send(true) }, x.button || 'Approve');
      buttons = [no, yes];
    } else {
      buttons = (x.buttons || []).map((label, i) => el('button', { type: 'button', class: i === x.defaultId && i !== x.cancelId ? 'primary' : '', onclick: () => send(i) }, label));
    }
    kids.push(el('div', { class: 'actions' }, ...buttons));
    box.replaceChildren(...kids);
    box.showModal();
    const first = kind === 'approval:request' ? buttons[0] : buttons[Number.isInteger(x.defaultId) ? x.defaultId : 0];
    if (first) first.focus();
    const left = Number(x.expires) - Date.now();
    if (Number.isFinite(left)) timer = setTimeout(close, Math.max(0, left));
  }

  async function send(answer) {
    if (!cur) return;
    const [kind, x] = cur;
    for (const b of box.querySelectorAll('button')) b.disabled = true;
    try {
      if (kind === 'approval:request') await W.approve(x.id, x.hash, answer === true);
      else await W.answer(x.id, x.hash, answer);
    } catch (e) { console.error(e); }
    close();
  }

  // Esc: no (an approval), or the dialog's own cancel button
  box.addEventListener('cancel', (e) => {
    e.preventDefault();
    if (!cur) return;
    send(cur[0] === 'approval:request' ? false : (Number.isInteger(cur[1].cancelId) ? cur[1].cancelId : 0));
  });

  /** A file picker the core asked for: the browser's own, then the files uploaded (or nothing, on cancel). */
  function pick(x) {
    const input = el('input', { type: 'file', hidden: true, ...(x.multi ? { multiple: true } : {}), ...(x.accept && x.accept.length ? { accept: x.accept.join(',') } : {}) });
    let done = false;
    const finish = (files) => {
      if (done) return;
      done = true;
      input.remove();
      W.pick(x.id, x.hash, files).catch((e) => console.error(e));
    };
    input.addEventListener('change', () => finish(input.files && input.files.length ? input.files : null));
    input.addEventListener('cancel', () => finish(null));
    document.body.append(input);
    input.click();
  }

  W.on((kind, x) => {
    if (kind === 'approval:request' || kind === 'dialog:ask') {
      if ((cur && cur[1].id === x.id) || queue.some(([, q]) => q.id === x.id)) return;
      queue.push([kind, x]);
      next();
    } else if (kind === 'dialog:open') {
      pick(x);
    } else if (kind === 'approval:done' || kind === 'dialog:done') {
      const i = queue.findIndex(([, q]) => q.id === x.id);
      if (i >= 0) queue.splice(i, 1);
      if (cur && cur[1].id === x.id) close();
    }
  });
})();
