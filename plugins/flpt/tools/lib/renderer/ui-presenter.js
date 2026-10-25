'use strict';
/* global flpt, el, renderSteps */
/* global S:writable */
// ui-presenter.js · Setup's Presenter step (PLAN §3.3 S1; W3-05), registered in FLPT_UI.setupSteps in place of 0.7.1's:
//   HeyGen twin · Cartoon · Cartoon you $ (when the Mac app has it: FLPT_UI.components.likeness, W3-10)
// The twin keeps 0.7.1's look and voice picker (moved in here as it is). The cartoon: a presenter (Ada, Bram, the user's
// own) with ▶ for a free sample of it talking, and a voice (Mac · HeyGen · ElevenLabs · Fish.audio: the ones Spend can
// approve, as flpt.presenter.options says) with ▶ for a free sample and its price. Labels only; everything is saved
// through flpt.presenter.choose, and nothing here costs money.
(() => {
  const UI = window.FLPT_UI;
  if (!UI || !Array.isArray(UI.setupSteps) || !window.flpt || !flpt.presenter) return;

  const PRICE = { say: 'Free', heygen: '0.2¢ a second', elevenlabs: '8¢ per 1,000 characters', fish: '≈1.5¢ per 1,000 characters' };
  const R = {}; // the step's elements
  let opts = null; // flpt.presenter.options()
  const lists = {}; // provider → [{ id, name, sample }]
  let playing = null; // the one thing playing

  const unwrap = (r) => (r && r.ok ? r.value : null);
  const say = (text) => { R.note.textContent = text || ''; };
  const stop = () => { if (playing) { try { playing.pause(); } catch { /* gone */ } } playing = null; };
  const kindNow = () => (opts && opts.kind) || 'heygen';

  function chip(label, pressed, onclick, extra = {}) {
    return el('button', { type: 'button', class: 'chip', 'aria-pressed': String(Boolean(pressed)), onclick, ...extra }, label);
  }

  function renderKinds() {
    const likeness = UI.components && UI.components.likeness;
    R.kinds.replaceChildren(...[
      chip('HeyGen twin', kindNow() === 'heygen', () => choose({ kind: 'heygen' })),
      chip('Cartoon', kindNow() === 'cartoon', () => choose({ kind: 'cartoon' })),
      likeness && typeof likeness.open === 'function' ? chip('Cartoon you $', false, () => likeness.open({ from: 'setup' }), { title: 'Your own cartoon, drawn from your photos' }) : null,
    ].filter(Boolean)); // never pass null: replaceChildren would print it
    R.twin.hidden = kindNow() !== 'heygen';
    R.cartoon.hidden = kindNow() !== 'cartoon';
  }

  function renderRigs() {
    R.rigs.replaceChildren(...(opts.rigs || []).map((r) => {
      const pic = r.thumb ? el('img', { src: r.thumb, alt: '' }) : el('div', { class: 'ph' });
      const tile = el('div', { class: 'rig', 'aria-pressed': String(opts.rig === r.id), 'data-rig': r.id },
        el('button', { type: 'button', class: 'rig-pick', 'aria-label': r.name, onclick: () => choose({ kind: 'cartoon', rig: r.id }) }, pic, el('span', { 'data-content': '' }, r.name)),
        el('button', { type: 'button', class: 'ghost small rig-play', 'aria-label': `Hear ${r.name}`, title: 'Free sample', onclick: () => playRig(r, tile, pic) }, '▶'));
      return tile;
    }));
  }

  async function playRig(r, tile, pic) {
    stop();
    say('');
    const res = unwrap(await flpt.presenter.rigSample(r.id));
    if (!res || !res.ok) { say((res && res.error) || 'The sample wasn\'t made.'); return; }
    const v = el('video', { src: res.url, playsinline: true, class: 'rig-video' });
    v.addEventListener('ended', () => { v.replaceWith(pic); if (playing === v) playing = null; });
    (tile.querySelector('video') || pic).replaceWith(v);
    playing = v;
    v.play().catch(() => {});
  }

  function renderVoices() {
    const voice = opts.voice || { provider: 'say', id: '' };
    R.providers.replaceChildren(...(opts.voices || []).map((v) => chip(v.name, voice.provider === v.provider,
      () => choose({ kind: 'cartoon', voice: { provider: v.provider, id: '', name: '' } }),
      { disabled: !v.keySet, title: v.keySet ? PRICE[v.provider] : `${v.name} key · Setup → Keys` })));
    R.price.textContent = PRICE[voice.provider] || '';
    const list = lists[voice.provider];
    const options = (list || []).map((x) => el('option', { value: x.id, 'data-content': '' }, x.name));
    if (voice.id && !(list || []).some((x) => x.id === voice.id)) options.unshift(el('option', { value: voice.id, 'data-content': '' }, voice.name || voice.id));
    if (voice.provider === 'say' && !voice.id) options.unshift(el('option', { value: '' }, 'The Mac\'s own'));
    R.pick.replaceChildren(...options);
    R.pick.value = voice.id || '';
    R.pickRow.hidden = !options.length;
    if (!list) loadVoices(voice.provider);
  }

  async function loadVoices(provider) {
    lists[provider] = lists[provider] || [];
    const r = unwrap(await flpt.presenter.voiceList(provider));
    if (!r || !r.ok) { say((r && r.error) || 'The voices didn\'t load.'); return; }
    lists[provider] = r.voices;
    if (opts && (opts.voice || {}).provider === provider) {
      renderVoices();
      // a voice kept by name only (a likeness's paired voice) is that voice; else the first, when none is picked yet
      // (the Mac's own needs none)
      const named = !opts.voice.id && opts.voice.name ? r.voices.find((v) => v.name === opts.voice.name) : null;
      const first = named || r.voices[0];
      if (!opts.voice.id && provider !== 'say' && first) choose({ kind: 'cartoon', voice: { provider, id: first.id, name: first.name } });
    }
  }

  async function playVoice() {
    stop();
    const voice = opts.voice || {};
    const r = unwrap(await flpt.presenter.voiceSample({ provider: voice.provider, id: R.pick.value || voice.id || '' }));
    if (!r || !r.ok) { say((r && r.error) || 'There\'s no sample of this voice.'); return; }
    R.audio.src = r.url;
    playing = R.audio;
    R.audio.play().catch(() => {});
  }

  async function choose(spec) {
    say('');
    const r = unwrap(await flpt.presenter.choose(spec));
    if (!r || !r.ok) { say((r && r.error) || 'That didn\'t work.'); return; }
    S = r.state; // app.js's state (one global scope for the page's classic scripts)
    await refresh();
    renderSteps('presenter');
  }

  async function refresh() {
    opts = unwrap(await flpt.presenter.options());
    if (!opts) return;
    renderKinds();
    if (kindNow() === 'cartoon') { renderRigs(); renderVoices(); }
  }

  function screen() {
    const own = document.querySelector('#main > .screen[data-name="presenter"]');
    R.kinds = el('div', { class: 'chips presenter-kinds', role: 'group', 'aria-label': 'Presenter' });
    R.twin = el('div', { class: 'presenter-twin' });
    if (own) for (const n of [...own.children]) if (n.tagName !== 'H2' && !(n.classList.contains('actions') && n.querySelector('[data-go]'))) R.twin.append(n);
    R.rigs = el('div', { class: 'rigs' });
    R.providers = el('div', { class: 'chips', role: 'group', 'aria-label': 'Voice' });
    R.price = el('span', { class: 'muted presenter-price' });
    R.pick = el('select', { 'aria-label': 'Voice', onchange: () => {
      const voice = opts.voice || {};
      const x = (lists[voice.provider] || []).find((v) => v.id === R.pick.value);
      choose({ kind: 'cartoon', voice: { provider: voice.provider, id: R.pick.value, name: x ? x.name : '' } });
    } });
    R.audio = el('audio', {});
    R.pickRow = el('div', { class: 'voice-row' }, R.pick, el('button', { type: 'button', class: 'ghost small', 'aria-label': 'Hear this voice', title: 'Free sample', onclick: playVoice }, '▶'), R.audio);
    R.cartoon = el('div', { class: 'presenter-cartoon', hidden: true },
      el('h3', { class: 'hud' }, 'Presenter'), R.rigs,
      el('h3', { class: 'hud' }, 'Voice'), el('div', { class: 'presenter-voice' }, R.providers, R.price), R.pickRow);
    R.note = el('p', { class: 'note', role: 'status' });
    const back = own && own.querySelector('.actions [data-go="keys"]');
    const actions = back ? back.parentElement : el('div', { class: 'actions' }, el('button', { class: 'ghost', 'data-go': 'keys' }, 'Back'), el('button', { class: 'primary', 'data-go': 'check' }, 'Next'));
    return el('section', { class: 'presenter-step' }, el('h2', {}, 'Your presenter'), R.kinds, R.twin, R.cartoon, R.note, actions);
  }

  const step = {
    id: 'presenter',
    label: 'Presenter',
    done: (st) => {
      const p = st.settings && st.settings.presenter;
      if (p && p.kind === 'cartoon') return Boolean(p.rig && p.voice && (p.voice.provider === 'say' || p.voice.id));
      return Boolean(st.presenter && st.presenter.HEYGEN_AVATAR_ID && st.presenter.HEYGEN_VOICE_ID);
    },
    show: () => { stop(); refresh(); if (kindNow() === 'heygen' && typeof window.renderPresenter === 'function') window.renderPresenter(); },
    screen,
  };
  const i = UI.setupSteps.findIndex((x) => x && x.id === 'presenter');
  if (i >= 0) UI.setupSteps.splice(i, 1, step); else UI.setupSteps.splice(Math.min(3, UI.setupSteps.length), 0, step);

  // the step's own look, through the CSSOM (the app's CSP allows stylesheets from 'self' only)
  try {
    const css = new CSSStyleSheet();
    css.replaceSync(`.presenter-step .chips { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0; }
      .presenter-step .chip[aria-pressed="true"] { background: var(--navy); color: var(--paper); border-color: var(--navy); }
      .presenter-step .rigs { display: flex; gap: 16px; flex-wrap: wrap; margin: 8px 0 16px; }
      .presenter-step .rig { position: relative; width: 168px; border: 1px solid var(--rule); border-radius: var(--r-2, 10px); padding: 8px; background: var(--card); }
      .presenter-step .rig[aria-pressed="true"] { border-color: var(--navy); box-shadow: 0 0 0 2px var(--navy) inset; }
      .presenter-step .rig-pick { display: flex; flex-direction: column; gap: 6px; align-items: center; width: 100%; background: none; border: 0; padding: 0; cursor: pointer; }
      .presenter-step .rig img, .presenter-step .rig-video, .presenter-step .rig .ph { width: 150px; height: 150px; border-radius: 50%; object-fit: cover; background: var(--paper-2); }
      .presenter-step .rig-play { position: absolute; top: 8px; right: 8px; }
      .presenter-step .presenter-voice { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
      .presenter-step .presenter-price { font-family: var(--mono, ui-monospace); font-size: 12px; letter-spacing: .14em; text-transform: uppercase; }
      .presenter-step h3.hud { margin: 16px 0 4px; }`);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, css];
  } catch { /* an older engine: the base styles do */ }
})();
