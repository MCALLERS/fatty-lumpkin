'use strict';
/* global flpt, el, renderSteps, session */
// ui-signin.js · the FLPT voices in Setup (decisions.md, "FLPT voices"; W4-10): Michael's six house voices, free to
// every signed-in user, with a ▶ for each one's free sample when the build ships it (app/src/renderer/assets/voices/,
// flpt.signin.status says which), and FLPT's sign-in: Sign in shows a code and opens FLPT's page for it in the browser
// (main does the talking and keeps the token in the Keychain; the page never sees it), then who is signed in, this
// month's free videos, and Sign out. A Setup step of its own beside About (extra: not in the numbered run), done once
// signed in; FLPT_UI.components.signin.open() goes there from anywhere (the Storyboard's Voice chip, Spend's line).
// Labels only. The vault's entry for the sign-in isn't a key a person pastes, so its row in Keys is left out here.
(() => {
  const UI = window.FLPT_UI;
  if (!UI || !Array.isArray(UI.setupSteps) || !window.flpt || !flpt.signin) return;

  const R = {}; // the step's elements
  let st = null; // flpt.signin.status()
  let usage = null; // flpt.signin.usage()
  let playing = null;

  const unwrap = (r) => (r && r.ok ? r.value : null);
  const say = (text) => { if (R.note) R.note.textContent = text || ''; };
  const stop = () => { if (playing) { try { playing.pause(); } catch { /* gone */ } } playing = null; };

  function play(v, btn) {
    stop();
    if (!v.sample) return;
    R.audio.src = v.sample;
    playing = R.audio;
    btn.setAttribute('aria-pressed', 'true');
    R.audio.onended = () => btn.setAttribute('aria-pressed', 'false');
    R.audio.play().catch(() => btn.setAttribute('aria-pressed', 'false'));
  }

  function renderVoices() {
    R.list.replaceChildren(...((st && st.voices) || []).map((v) => {
      const btn = v.sample ? el('button', { type: 'button', class: 'ghost small', 'aria-pressed': 'false', 'aria-label': `Hear ${v.name}`, title: 'Free sample', onclick: () => play(v, btn) }, '▶') : null;
      return el('li', { 'data-voice': v.id }, el('span', { class: 'house-name' }, v.name), ...(btn ? [btn] : []));
    }));
  }

  function renderAccount() {
    if (!st || !st.available) { R.account.replaceChildren(); return; }
    if (st.signedIn) {
      const month = usage && usage.videosPerMonth ? `${usage.videosUsed} of ${usage.videosPerMonth} videos this month` : '';
      R.account.replaceChildren(
        el('p', { class: 'ok' }, 'Signed in', st.email ? ' · ' : '', st.email ? el('span', { 'data-content': '' }, st.email) : ''),
        month ? el('p', { class: 'hud muted' }, month) : '',
        el('div', { class: 'actions' }, el('button', { type: 'button', class: 'ghost', onclick: signOut }, 'Sign out')));
      return;
    }
    if (st.pending) {
      R.account.replaceChildren(
        el('p', { class: 'hud muted' }, 'Code'),
        el('p', { class: 'house-code', 'data-content': '' }, st.pending.userCode),
        el('p', { class: 'muted', 'data-content': '' }, st.host),
        el('div', { class: 'actions' },
          el('button', { type: 'button', class: 'primary', onclick: openPage, title: 'The page for this code, in your browser' }, 'Open page'),
          el('button', { type: 'button', class: 'ghost', onclick: cancel }, 'Cancel')));
      return;
    }
    R.account.replaceChildren(el('div', { class: 'actions' }, el('button', { type: 'button', class: 'primary', onclick: signIn, title: `A free sign-in at ${st.host}` }, 'Sign in')));
  }

  function render() {
    if (!R.free) return; // the step isn't drawn yet (its status was read for the rail's mark)
    renderVoices();
    renderAccount();
  }

  async function refresh() {
    st = unwrap(await flpt.signin.status());
    usage = null;
    if (st && st.signedIn) {
      const u = unwrap(await flpt.signin.usage());
      usage = u && u.ok ? u : null;
    }
    render();
    rail();
  }
  /** The rail again (this step's mark), on whichever step Setup is showing. */
  function rail() { try { if (typeof session !== 'undefined' && session && session.step) renderSteps(session.step); } catch { /* Setup isn't drawn yet */ } }

  async function signIn() {
    say('');
    const r = await flpt.signin.start();
    if (!r || !r.ok) { say((r && r.error) || 'That didn\'t work.'); return; }
    st = r.value;
    render();
  }
  async function openPage() { const r = unwrap(await flpt.signin.open()); if (r && !r.ok) say(r.error); }
  async function cancel() { st = unwrap(await flpt.signin.cancel()) || st; render(); }
  async function signOut() { say(''); st = unwrap(await flpt.signin.signOut()) || st; usage = null; render(); rail(); }

  function screen() {
    R.free = el('p', { class: 'hud muted' }, 'Free');
    R.list = el('ul', { class: 'house-voices', 'aria-label': 'FLPT voices' });
    R.account = el('div', { class: 'house-account' });
    R.audio = el('audio', {});
    R.note = el('p', { class: 'note', role: 'status' });
    return el('section', { class: 'house-step' }, el('h2', {}, 'FLPT voices'), R.free, R.list, R.account, R.audio, R.note);
  }

  const step = {
    id: 'voices',
    label: 'FLPT voices',
    extra: true,
    done: () => Boolean(st && st.signedIn),
    show: () => { stop(); refresh(); },
    screen,
  };
  const at = UI.setupSteps.findIndex((x) => x && x.id === 'about');
  if (at >= 0) UI.setupSteps.splice(at, 0, step); else UI.setupSteps.push(step);

  if (typeof flpt.signin.onChanged === 'function') {
    flpt.signin.onChanged((p) => {
      refresh();
      if (p && p.error) say(p.error);
    });
  }
  UI.components = UI.components || {};
  UI.components.signin = {
    /** Setup's FLPT voices step, from anywhere. */
    open() { if (typeof window.showView === 'function') window.showView('setup'); if (typeof window.go === 'function') window.go('voices'); },
    /** Signed in to the FLPT voices? (the last status read) */
    signedIn: () => Boolean(st && st.signedIn),
  };
  refresh(); // the rail's mark for this step, before it's opened

  try {
    const css = new CSSStyleSheet();
    css.replaceSync(`.house-step .house-voices { list-style: none; margin: 16px 0 24px; padding: 0; max-width: 420px; border-top: 1px solid var(--rule); }
      .house-step .house-voices li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 4px; border-bottom: 1px solid var(--rule); min-height: 44px; }
      .house-step .house-voices button[aria-pressed="true"] { background: var(--navy); color: var(--paper); border-color: var(--navy); }
      .house-step .house-code { font-family: var(--mono, ui-monospace); font-size: var(--fs-title, 30px); letter-spacing: .12em; margin: 0 0 4px; }
      .house-step .house-account p { margin: 4px 0; }
      .house-step .house-account .actions { margin-top: 12px; }
      .key[data-key="FLPT_VOICES_TOKEN"] { display: none; }`);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, css];
  } catch { /* an older engine: the base styles do */ }
})();
