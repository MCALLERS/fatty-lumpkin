'use strict';
/* global flpt, el */
// ui-refs.js · references in the page (PLAN §2.11, §3.3 S14, draft-ux §8.2; W3-02). Main does the work (flpt.refs);
// the page names a reference by its id, never a path.
//   FLPT_UI.components.referenceSheet.open({ from, episode, shot, link }) · close() · state()  (link: the Gallery's place, in the Link field)
//     The Reference sheet (Theater, over the window): Video · Pictures · Link (Capture motion) · the Library's
//     references · then the reference: its frames (▶ plays its motion, on ▶ only), the card as measured (swatches, the
//     ground and its texture, the pace) and the user's chips (type, case, ease) · Claude look (off by default; on, the
//     ⚑ line says frames go to Claude) · Use as reference (opened for a shot) · Make a style · up to $<price> (the price
//     is main's, from caps.styleStudy.usd or the study's view; main asks it in its own dialog, and until that's answered
//     the sheet only waits). Once approved: the reference's frames dimmed, the crew's newest picture fading in over
//     them, ● STUDYING with the time and the crew's latest line, Stop. After it: the study on the Stage beside the
//     reference (Side · Wipe), or without a Stage the two side by side under REFERENCE and STUDY with one ▶; the Name
//     (main's "<base style> study" until the user types one), Keep · Closer · Further (each priced) · Discard. Kept:
//     its poster (▶ plays its loop and score), its name, Use (for the shot it was opened for) · Share.
//   The REFERENCE well, in the slot inspector.reference (W2-04's inspector): the focused shot's references, a picture
//     and a name each (✕ takes one off), and + (the sheet, for that shot). Edits go through the storyboard's own op.
// Esc closes. Nothing here plays on its own: the motion, the study and the kept loop play on ▶.
(() => {
  const UI = window.FLPT_UI;
  if (!UI || !UI.components || !window.flpt || !flpt.refs || typeof flpt.refs.list !== 'function') return;

  const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`;
  const unwrap = async (p) => { const r = await p; if (!r || !r.ok) throw new Error((r && r.error) || 'Something went wrong.'); return r.value; };
  const url = (p) => (p && typeof flpt.fileUrl === 'function' ? flpt.fileUrl(p) : '');
  const TYPE = [['grotesk', 'Grotesk'], ['serif', 'Serif'], ['mono', 'Mono'], ['hand', 'Hand']];
  const CASE = [['upper', 'Upper'], ['sentence', 'Sentence']];
  const EASE = [['snappy', 'Snappy'], ['smooth', 'Smooth'], ['heavy', 'Heavy'], ['bouncy', 'Bouncy']];
  const KIND = { link: 'Link', video: 'Video', images: 'Pictures' };
  const STUDY_TOOLS = { start_scene: 'Setting up', use_reference: 'Reading the reference', look_at_reference: 'Looking at the reference', describe_reference: 'Describing it',
    align_music: 'Timing the music', lint_scene: 'Checking', snapshot: 'Drawing stills', render_preview: 'Rendering', contact_sheet: 'Making a contact sheet',
    compare_with_reference: 'Comparing', listen: 'Listening', done: 'Finishing' };

  let caps = null;
  if (flpt.app && typeof flpt.app.caps === 'function') Promise.resolve(flpt.app.caps()).then((r) => { caps = r && r.ok ? r.value : null; if (root) paint(); }, () => {});
  const can = (what) => {
    if (!caps) return true;
    if (what === 'link') return Array.isArray(caps.referenceCapture) ? caps.referenceCapture.includes('stills') : true;
    if (what === 'motion') return Array.isArray(caps.referenceCapture) && caps.referenceCapture.includes('motion');
    if (what === 'study') return Boolean(caps.styleStudy);
    return true;
  };
  /** The study's price as main states it (the study's own view, else the surface's caps); null until it's known. */
  const price = () => {
    const v = study && study.view && Number(study.view.priceUsd);
    if (v > 0) return v;
    const c = caps && caps.styleStudy && Number(caps.styleStudy.usd);
    return c > 0 ? c : null;
  };

  // ── state ──
  const blank = () => ({ open: false, from: null, episode: null, shot: null, list: [], cur: null, busy: '', err: '', look: false, motion: false, playing: false,
    running: false, mode: 'scene', stageOn: false, stagePlaying: false, name: null, judgePlaying: false, keptPlaying: false });
  let S = blank();
  // the study in progress (kept across a close, so reopening shows it): { view, ref: { title, frames, motionUrl }, line,
  // latest, shown, running, startedAt, error, kept, reference }
  let study = null;
  let asking = false; // main's price dialog is up: the sheet waits, nothing says it's studying yet
  let root = null;
  let ticker = null;
  const R = {};
  const btn = (label, attrs = {}) => el('button', { type: 'button', ...attrs }, label);
  /** A colour chip (its colour set through the CSSOM: the page's CSP allows no style attribute). */
  const swatch = (hex, { flex = null, title = null } = {}) => {
    const i = el('i', title ? { title } : {});
    if (/^#[0-9a-f]{6}$/i.test(String(hex))) i.style.background = hex;
    if (flex != null) i.style.flex = String(flex);
    return i;
  };
  const clock = (t0) => { const s = Math.max(0, Math.round((Date.now() - (t0 || Date.now())) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  /** A video the page drives (no controls of its own); muted set as the property, which the attribute doesn't do. */
  const vid = (src, attrs = {}, muted = false) => { const v = el('video', { src, playsinline: true, loop: true, preload: 'metadata', ...attrs }); v.muted = muted; return v; };

  function build() {
    R.close = btn('✕', { class: 'ghost small rs-close', 'aria-label': 'Close', title: 'Esc', onclick: () => close() });
    const head = el('header', { class: 'rs-head' }, el('h2', { class: 'rs-title' }, 'Reference'), el('span', { class: 'rs-gap' }), R.close);
    R.video = btn('Video', { class: 'ghost rs-src', onclick: () => pick('video') });
    R.pics = btn('Pictures', { class: 'ghost rs-src', onclick: () => pick('pictures') });
    R.url = el('input', { type: 'url', class: 'rs-url', placeholder: 'https://…', 'aria-label': 'Link', spellcheck: 'false', autocomplete: 'off' });
    R.motion = el('input', { type: 'checkbox', class: 'rs-motion-box' });
    R.motionLabel = el('label', { class: 'rs-motion' }, R.motion, el('span', {}, 'Capture motion'));
    R.go = btn('⏎', { class: 'ghost small', 'aria-label': 'Capture', title: 'Capture', type: 'submit' });
    R.link = el('form', { class: 'rs-link' }, R.url, R.motionLabel, R.go);
    R.link.addEventListener('submit', (e) => { e.preventDefault(); capture(); });
    R.in = el('div', { class: 'rs-in' }, R.video, R.pics, R.link);
    R.lib = el('div', { class: 'rs-lib', role: 'listbox', 'aria-label': 'Library' });
    R.status = el('p', { class: 'rs-status', role: 'status', 'data-content': '' });
    R.ref = el('section', { class: 'rs-ref', hidden: true });
    R.study = el('section', { class: 'rs-study', hidden: true });
    root = el('div', { class: 'rs-scrim', onclick: (e) => { if (e.target === root) close(); } },
      el('div', { class: 'rs', 'data-realm': 'theater', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Reference' }, head, R.in, R.lib, R.status, R.ref, R.study));
    root.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); root.classList.add('rs-drop'); } });
    root.addEventListener('dragleave', (e) => { if (e.target === root) root.classList.remove('rs-drop'); });
    root.addEventListener('drop', (e) => { e.preventDefault(); root.classList.remove('rs-drop'); if (e.dataTransfer && e.dataTransfer.files.length) dropped(e.dataTransfer.files); });
    return root;
  }

  // ── painting ──
  function paint() {
    if (!root) return;
    R.link.hidden = !can('link');
    R.motionLabel.hidden = !can('motion');
    const busy = Boolean(S.busy) || S.running || asking;
    for (const b of [R.video, R.pics, R.go]) b.disabled = busy;
    R.url.disabled = busy;
    R.status.textContent = S.err || S.busy || '';
    R.status.classList.toggle('bad', Boolean(S.err));
    // a study (running, or waiting on its judgement) is the view: the ways in and the Library step aside
    const studying = Boolean(study);
    R.in.hidden = studying;
    paintLib();
    if (studying) R.lib.hidden = true;
    paintRef();
    paintStudy();
    tick();
  }

  function paintLib() {
    const items = S.list.slice(0, 12).map((r) => {
      const on = S.cur && S.cur.id === r.id;
      const pic = r.thumb ? el('img', { src: url(r.thumb), alt: '', loading: 'lazy' }) : el('span', { class: 'rs-swatches', 'aria-hidden': 'true' }, ...((r.card && r.card.palette) || []).slice(0, 4).map((p) => swatch(p.hex)));
      return btn([pic], { class: `rs-thumb${on ? ' on' : ''}`, role: 'option', 'aria-selected': String(Boolean(on)), title: `${r.title} · ${KIND[r.kind] || ''}`, 'aria-label': r.title, disabled: S.running || asking, onclick: () => select(r.id) });
    });
    R.lib.replaceChildren(...(items.length ? [el('span', { class: 'hud rs-eyebrow' }, 'Library'), ...items] : []));
    R.lib.hidden = !items.length;
  }

  /** The card as measured: swatches by share, the ground and its texture, the pace (▮ per step), on twos. */
  function cardRow(c) {
    const pal = el('span', { class: 'rs-pal', title: 'Palette' }, ...c.palette.slice(0, 6).map((p) => swatch(p.hex, { flex: Math.max(0.05, p.share), title: p.hex })));
    const parts = [pal];
    if (c.ground && c.ground.hex) parts.push(el('span', { class: 'rs-ground hud', title: 'Ground' }, swatch(c.ground.hex), c.ground.texture || ''));
    if (c.motion) {
      const e = Number(c.motion.energy) || 0;
      const bars = e < 0.06 ? 1 : e < 0.12 ? 2 : e < 0.2 ? 3 : 4;
      parts.push(el('span', { class: 'rs-pace hud', title: `Motion energy ${e}` }, `Pace ${'▮'.repeat(bars)}${'▯'.repeat(4 - bars)}`));
      if (c.motion.onTwos) parts.push(el('span', { class: 'hud rs-twos' }, 'On twos'));
    }
    if (c.luma && c.luma.mean != null) parts.push(el('span', { class: 'hud rs-light', title: `Light ${c.luma.mean} · contrast ${c.luma.contrast}` }, c.luma.mean > 0.6 ? 'Light' : c.luma.mean < 0.35 ? 'Dark' : 'Mid'));
    return el('div', { class: 'rs-card' }, ...parts);
  }

  /** One row of chips: pressed shows the card's value; a press sets it (main checks it as the user's). */
  function chips(label, list, value, set) {
    return el('div', { class: 'rs-chips', role: 'group', 'aria-label': label }, el('span', { class: 'hud rs-chip-label' }, label),
      ...list.map(([v, name]) => btn(name, { class: 'ghost small rs-chip', 'aria-pressed': String(value === v), disabled: S.running || asking || Boolean(S.busy), onclick: () => set(value === v ? null : v) })));
  }

  function paintRef() {
    const r = S.cur;
    if (study) {
      // the study is the view: one line naming the reference it was drawn from and the style it started in
      const v = study.view || {};
      const ref = study.ref || r || {};
      R.ref.hidden = false;
      R.ref.replaceChildren(el('p', { class: 'rs-studying-ref' }, (ref.frames || [])[0] ? el('img', { src: url(ref.frames[0]), alt: '' }) : null,
        el('span', { 'data-content': '' }, ref.title || ''), v.baseName ? el('span', { class: 'hud rs-base', title: 'Drawn from' }, `· ${v.baseName}`) : null));
      return;
    }
    R.ref.hidden = !r;
    if (!r) { R.ref.replaceChildren(); return; }
    const c = r.card || { palette: [], ground: {}, motion: null };
    // the frames; ▶ swaps them for its motion (muted, on ▶ only)
    let strip;
    if (S.playing && r.motionUrl) {
      strip = vid(r.motionUrl, { class: 'rs-motion-video', autoplay: true, 'aria-label': 'Motion' }, true);
    } else {
      strip = el('div', { class: 'rs-strip' }, ...(r.frames || []).slice(0, 8).map((f) => el('img', { src: url(f), alt: '', loading: 'lazy' })));
    }
    const play = r.motionUrl ? btn(S.playing ? '❚❚' : '▶', { class: 'ghost small rs-play', 'aria-label': S.playing ? 'Stop' : 'Play', onclick: () => { S.playing = !S.playing; paintRef(); } }) : null;
    const t = c.type || {};
    const rows = [
      chips('Type', TYPE, t.class || null, (v) => setChips({ type: { class: v } })),
      chips('Case', CASE, t.case || null, (v) => setChips({ type: { case: v } })),
      c.motion ? chips('Ease', EASE, c.motion.ease || null, (v) => setChips({ ease: v })) : null,
    ];
    const shot = Boolean(S.episode && S.shot);
    const wait = S.running || asking || Boolean(S.busy);
    const p = price();
    R.lookBtn = btn('Claude look', { class: 'ghost small rs-look', 'aria-pressed': String(S.look), title: 'Up to six frames go to Claude to describe the style', disabled: wait, onclick: () => { S.look = !S.look; paintRef(); } });
    R.use = shot ? btn('Use as reference', { class: 'primary rs-use', disabled: wait, onclick: () => use() }) : null;
    R.make = can('study') ? btn(['Make a style', p ? el('span', { class: 'rs-money' }, ` · up to ${usd(p)}`) : null], { class: `${shot ? 'ghost' : 'primary'} rs-make`, disabled: wait, onclick: () => make() }) : null;
    R.ref.replaceChildren(
      el('div', { class: 'rs-media' }, strip, play),
      el('p', { class: 'rs-name', 'data-content': '' }, r.title),
      cardRow(c), ...rows.filter(Boolean),
      el('p', { class: 'rs-trust hud', 'data-trust': '', hidden: !S.look }, '⚑ Frames go to Claude to describe the style. Nothing is shared.'),
      el('div', { class: 'rs-actions' }, can('study') ? R.lookBtn : null, el('span', { class: 'rs-gap' }), R.use, R.make));
  }

  /** The crew's newest picture, fading in over the reference the first time it's shown. */
  function latestImg(st) {
    if (!st.latest) return null;
    const img = el('img', { src: url(st.latest), alt: '', class: st.shown === st.latest ? 'in' : '' });
    if (st.shown !== st.latest) img.addEventListener('load', () => { img.classList.add('in'); st.shown = st.latest; }, { once: true });
    return img;
  }

  function paintStudy() {
    const st = study;
    R.study.hidden = !st;
    if (!st) { R.study.replaceChildren(); R.elapsed = null; return; }
    const v = st.view || {};
    const ref = st.ref || S.cur || {};
    R.elapsed = null;
    if (st.running) {
      // the reference's frames, dimmed, and the crew's newest picture fading in over them as it draws
      const frames = (ref.frames || []).slice(0, 4);
      R.latest = el('div', { class: 'rs-latest' }, latestImg(st));
      R.elapsed = el('span', { class: 'hud rs-elapsed', title: 'Time' }, clock(st.startedAt));
      R.study.replaceChildren(
        el('div', { class: `rs-work${frames.length > 1 ? '' : ' one'}`, 'aria-hidden': 'true' }, el('div', { class: 'rs-dim' }, ...frames.map((f) => el('img', { src: url(f), alt: '' }))), R.latest),
        el('p', { class: 'rs-running', role: 'status' }, el('span', { class: 'hud rs-writing' }, '● Studying'), R.elapsed, el('span', { 'data-content': '' }, st.line || '')),
        el('div', { class: 'rs-actions' }, el('span', { class: 'rs-gap' }), btn('Stop', { class: 'ghost', onclick: () => stop() })));
      return;
    }
    if (st.kept) {
      // the new style: its poster (▶ its loop with its score), its name, Use for the shot · Share
      const k = st.kept;
      const pic = S.keptPlaying && k.loop ? vid(url(k.loop), { class: 'rs-kept-media', autoplay: true, 'aria-label': k.name })
        : k.poster ? el('img', { class: 'rs-kept-media', src: url(k.poster), alt: '' }) : el('div', { class: 'rs-kept-media' });
      const play = k.loop ? btn(S.keptPlaying ? '❚❚' : '▶', { class: 'ghost small rs-play', 'aria-label': S.keptPlaying ? 'Stop' : 'Play', onclick: () => { S.keptPlaying = !S.keptPlaying; paintStudy(); } }) : null;
      const canUse = Boolean(S.episode && S.shot && UI.components.storyboard);
      R.study.replaceChildren(
        el('div', { class: 'rs-media' }, pic, play),
        el('p', { class: 'rs-kept' }, el('span', { class: 'hud' }, 'Kept'), el('span', { class: 'rs-kept-name', 'data-content': '' }, k.name)),
        el('div', { class: 'rs-actions' }, el('span', { class: 'rs-gap' }),
          canUse ? btn('Use', { class: 'primary', onclick: () => useStyle(k.id) }) : null,
          UI.components.shareSheet ? btn('Share', { class: canUse ? 'ghost' : 'primary', onclick: () => { const id = k.id; close(); UI.components.shareSheet.open({ style: id }); } }) : null));
      return;
    }
    const done = v.status === 'done';
    const kids = [];
    if (done) {
      R.anchor = S.stageOn ? UI.anchor('stage', { class: 'rs-anchor' }) : null;
      if (R.anchor) kids.push(el('div', { class: 'rs-judge on-stage' }, R.anchor));
      else {
        // no Stage: the two side by side, named, one ▶ for both (the study with its score, the reference muted)
        const first = (ref.frames || [])[0] ? url(ref.frames[0]) : null;
        R.judgeRef = ref.motionUrl ? vid(ref.motionUrl, { class: 'rs-pane-media', ...(first ? { poster: first } : {}), 'aria-label': 'Reference' }, true)
          : first ? el('img', { class: 'rs-pane-media', src: first, alt: '' }) : el('div', { class: 'rs-pane-media' });
        R.judgeVid = v.clip ? vid(url(v.clip), { class: 'rs-pane-media', 'aria-label': 'Study' }) : el('div', { class: 'rs-pane-media' });
        R.judgePlay = v.clip ? btn(S.judgePlaying ? '❚❚' : '▶', { class: 'ghost small rs-play', 'aria-label': S.judgePlaying ? 'Pause' : 'Play', onclick: () => judgePlay() }) : null;
        kids.push(el('div', { class: 'rs-judge' }, el('div', { class: 'rs-side' },
          el('figure', { class: 'rs-pane' }, el('figcaption', { class: 'hud rs-eyebrow' }, 'Reference'), R.judgeRef),
          el('figure', { class: 'rs-pane' }, el('figcaption', { class: 'hud rs-eyebrow' }, 'Study'), el('div', { class: 'rs-media' }, R.judgeVid, R.judgePlay)))));
      }
      if (S.stageOn && st.reference) {
        kids.push(el('div', { class: 'rs-compare', role: 'group', 'aria-label': 'Compare' },
          btn(S.stagePlaying ? '❚❚' : '▶', { class: 'ghost small', 'aria-label': S.stagePlaying ? 'Pause' : 'Play', title: 'Space', onclick: () => { S.stagePlaying = !S.stagePlaying; stageSend({ cmd: S.stagePlaying ? 'play' : 'pause' }); paintStudy(); } }),
          btn('Side', { class: 'ghost small', 'aria-pressed': String(S.mode === 'side'), onclick: () => setMode(S.mode === 'side' ? 'scene' : 'side') }),
          btn('Wipe', { class: 'ghost small', 'aria-pressed': String(S.mode === 'wipe'), onclick: () => setMode(S.mode === 'wipe' ? 'scene' : 'wipe') })));
      }
    } else if (st.error) kids.push(el('p', { class: 'rs-status bad', 'data-content': '' }, st.error));
    R.name = el('input', { type: 'text', class: 'rs-name-input', maxlength: '40', placeholder: 'Name', 'aria-label': 'Name', value: S.name != null ? S.name : (v.defaultName || '') });
    R.name.addEventListener('input', () => { S.name = R.name.value; });
    const p = price();
    const money = p ? el('span', { class: 'rs-money' }, ` · ${usd(p)}`) : null;
    const wait = asking || Boolean(S.busy);
    kids.push(el('div', { class: 'rs-actions' },
      done ? R.name : null, done ? btn('Keep', { class: 'primary', disabled: wait, onclick: () => keep() }) : null,
      btn(['Closer', money ? money.cloneNode(true) : null], { class: 'ghost', disabled: wait, onclick: () => again('closer') }),
      btn(['Further', money], { class: 'ghost', disabled: wait, onclick: () => again('further') }),
      el('span', { class: 'rs-gap' }), btn('Discard', { class: 'ghost', disabled: wait, onclick: () => discard() })));
    R.study.replaceChildren(...kids);
  }

  /** ▶ on the side-by-side: both play together from the top (the study with its sound), or both pause. */
  function judgePlay() {
    const both = [R.judgeRef, R.judgeVid].filter((x) => x && x.tagName === 'VIDEO');
    S.judgePlaying = !S.judgePlaying;
    for (const x of both) {
      if (S.judgePlaying) { try { x.currentTime = 0; } catch { /* not loaded yet */ } x.play().catch(() => {}); } else x.pause();
    }
    if (R.judgePlay) { R.judgePlay.textContent = S.judgePlaying ? '❚❚' : '▶'; R.judgePlay.setAttribute('aria-label', S.judgePlaying ? 'Pause' : 'Play'); }
  }

  /** The study's clock, once a second while it runs and the sheet is open (text only: nothing moves). */
  function tick() {
    const on = Boolean(root && study && study.running);
    if (on && !ticker) ticker = setInterval(() => { if (R.elapsed && study) R.elapsed.textContent = clock(study.startedAt); }, 1000);
    if (!on && ticker) { clearInterval(ticker); ticker = null; }
  }

  // ── actions ──
  async function load() {
    try { S.list = await unwrap(flpt.refs.list()); } catch (e) { S.err = e.message; }
    paint();
  }
  async function select(id) {
    S.err = '';
    S.playing = false;
    try {
      const r = await unwrap(flpt.refs.get(id));
      S.cur = { ...r, motionUrl: r.motionFile ? url(r.motionFile) : null };
    } catch (e) { S.err = e.message; }
    paint();
  }
  async function took(r) {
    if (r && r.status === 'ok' && r.ref) {
      S.cur = { ...r.ref, motionUrl: r.ref.motionFile ? url(r.ref.motionFile) : null };
      S.list = [r.ref, ...S.list.filter((x) => x.id !== r.ref.id)];
      S.err = '';
    } else if (r) S.err = r.label || 'That didn\'t make a reference.';
  }
  async function pick(kind) {
    S.err = '';
    let staged = null;
    try { staged = await unwrap(flpt.refs.pickFiles(kind)); } catch (e) { S.err = e.message; paint(); return; }
    if (!staged) return;
    await add(staged);
  }
  async function dropped(files) {
    S.err = '';
    try { await add(await unwrap(flpt.refs.stageFiles(files))); } catch (e) { S.err = e.message; paint(); }
  }
  async function add(staged) {
    S.busy = 'Measuring…';
    paint();
    try { await took(await unwrap(flpt.refs.addFiles(staged.token))); } catch (e) { S.err = e.message; }
    S.busy = '';
    paint();
  }
  async function capture() {
    const u = R.url.value.trim();
    if (!u) return;
    S.err = '';
    S.busy = 'Capturing…';
    paint();
    try { await took(await unwrap(flpt.refs.capture(u, R.motion.checked))); if (S.cur) R.url.value = ''; } catch (e) { S.err = e.message; }
    S.busy = '';
    paint();
  }
  async function setChips(chip) {
    if (!S.cur) return;
    try { const card = await unwrap(flpt.refs.chips(S.cur.id, chip)); S.cur = { ...S.cur, card }; } catch (e) { S.err = e.message; }
    paint();
  }
  /** Use as reference: the reference into the episode, then onto the shot through the storyboard's own op. */
  async function use() {
    if (!S.cur || !S.episode || !S.shot) return;
    S.busy = '…';
    paint();
    try {
      const at = await unwrap(flpt.refs.attach(S.episode, S.cur.id));
      const sb = UI.components.storyboard;
      if (sb && typeof sb.op === 'function') await sb.op({ op: 'ref', id: S.shot, add: at.ref });
      S.busy = '';
      close();
      refreshWell();
      return;
    } catch (e) { S.err = e.message; }
    S.busy = '';
    paint();
  }

  // a study runs only once main says the price was approved (its 'state' event, status 'running'): until then the
  // sheet waits on main's dialog with a plain "…"
  function ask() { asking = true; S.busy = '…'; S.err = ''; paint(); }
  function asked() { asking = false; if (S.busy === '…') S.busy = ''; }
  function startStudy(view) {
    asked();
    const ref = study && study.ref ? study.ref : S.cur ? { title: S.cur.title, frames: S.cur.frames || [], motionUrl: S.cur.motionUrl || null } : null;
    study = { ...(study || {}), view: view || (study && study.view) || null, ref, line: '', running: true, startedAt: Date.now(), error: '', kept: null, reference: study ? study.reference : null };
    S.running = true;
    S.judgePlaying = false;
    paint();
  }
  function endStudy(r) {
    asked();
    S.running = false;
    if (!study) { paint(); return; }
    study.running = false;
    if (r && r.cancelled) {
      // the price wasn't approved: back to where it was (a judged study gets its Stage back)
      study = r.view ? { ...study, view: r.view } : null;
      paint();
      if (study && study.view && study.view.status === 'done') toStage();
      return;
    }
    if (r && r.view) study.view = r.view;
    study.error = r && !r.ok ? (r.error || 'The study wasn\'t finished.') : '';
    paint();
    if (study.view && study.view.status === 'done') toStage();
  }
  async function make() {
    if (!S.cur) return;
    S.name = null;
    study = null;
    ask();
    try {
      const r = await unwrap(flpt.refs.study(S.cur.id, { look: S.look }));
      if (r && r.cancelled && !study) { asked(); paint(); return; }
      if (!study) startStudy(r.view);
      endStudy(r);
    } catch (e) { asked(); S.running = false; study = null; S.err = e.message; paint(); }
  }
  async function again(kind) {
    if (!study || !study.view) return;
    const id = study.view.id;
    await stageClose();
    ask();
    let r;
    try { r = await unwrap(flpt.refs.again(id, kind)); } catch (e) { r = { ok: false, error: e.message }; }
    endStudy(r);
  }
  async function stop() { if (study && study.view) { try { await unwrap(flpt.refs.stop(study.view.id)); } catch { /* finished meanwhile */ } } }
  async function keep() {
    if (!study || !study.view) return;
    S.busy = 'Keeping…';
    paint();
    try {
      const name = (S.name != null ? S.name : (study.view.defaultName || '')).trim();
      const k = await unwrap(flpt.refs.keep(study.view.id, name));
      await stageClose();
      study.kept = k.style;
      study.view = k.view;
    } catch (e) { S.err = e.message; }
    S.busy = '';
    paint();
  }
  async function discard() {
    if (!study || !study.view) { study = null; paint(); return; }
    try { await unwrap(flpt.refs.discard(study.view.id)); await stageClose(); study = null; S.name = null; } catch (e) { S.err = e.message; }
    paint();
  }
  async function useStyle(id) {
    const sb = UI.components.storyboard;
    try { if (sb && S.shot) await sb.op({ op: 'style', id: S.shot, style: id }); close(); } catch (e) { S.err = e.message; paint(); }
  }

  // ── the Stage: the study's demo beside the reference ──
  const stage = () => UI.components.stage || null;
  const stageSend = (cmd) => { const s = stage(); return s ? s.send(cmd).catch(() => false) : Promise.resolve(false); };
  async function toStage() {
    if (!study || !study.view || !stage() || typeof flpt.refs.stage !== 'function') return;
    S.stageOn = true;
    paint();
    try {
      const r = await unwrap(flpt.refs.stage(study.view.id));
      study.reference = r.piece && r.piece.reference ? r.piece.reference : null;
    } catch { S.stageOn = false; }
    paint();
  }
  async function stageClose() {
    if (!S.stageOn) return;
    S.stageOn = false;
    S.mode = 'scene';
    S.stagePlaying = false;
    try { const s = stage(); if (s) await s.close(); } catch { /* closed */ }
  }
  function setMode(m) { S.mode = m; stageSend({ cmd: 'mode', mode: m }); paintStudy(); }

  // ── open, close, events ──
  function onKey(e) { if (e.key === 'Escape' && S.open) { e.preventDefault(); close(); } }
  function open({ from = null, episode = null, shot = null, link = null } = {}) {
    if (S.open) close();
    S = { ...blank(), open: true, from, episode, shot, running: Boolean(study && study.running) };
    document.body.append(build());
    document.addEventListener('keydown', onKey);
    paint();
    load();
    if (typeof link === 'string' && /^https?:\/\//i.test(link) && R.url) R.url.value = link.slice(0, 2000); // filled in, not captured
    setTimeout(() => { if (R.url && !R.url.hidden) R.url.focus({ preventScroll: true }); });
    if (study && study.view && study.view.status === 'done' && !study.running && !study.kept) toStage();
  }
  function close() {
    if (!S.open) return;
    stageClose();
    document.removeEventListener('keydown', onKey);
    if (root) root.remove();
    root = null;
    tick();
    S = blank();
    if (study && (study.kept || (!study.running && !study.view))) study = null;
  }
  if (typeof flpt.refs.onStudy === 'function') {
    flpt.refs.onStudy((ev) => {
      if (!ev) return;
      // main approved the price: now it studies
      if (ev.kind === 'state' && ev.view && ev.view.status === 'running' && asking && (!study || !study.view || study.view.id === ev.id)) { startStudy(ev.view); return; }
      if (!study || (study.view && study.view.id && ev.id !== study.view.id)) return;
      if (ev.kind === 'line' && ev.event) {
        const e = ev.event;
        const line = e.kind === 'text' && e.text ? e.text : e.kind === 'tool' && e.name ? `${STUDY_TOOLS[String(e.name).split(/__|\./).pop()] || 'Working'}…` : null;
        if (line) study.line = String(line).replace(/\s+/g, ' ').slice(0, 140);
        if (ev.latest) study.latest = ev.latest;
        if (root && (line || ev.latest)) paintStudy();
      } else if (ev.kind === 'state' && ev.view) { study.view = ev.view; if (ev.view.latest) study.latest = ev.view.latest; if (root) paintStudy(); }
    });
  }
  if (typeof flpt.refs.onChanged === 'function') flpt.refs.onChanged(() => { if (S.open) load(); });

  UI.components.referenceSheet = {
    open, close,
    /** What the sheet shows (QA and tests). */
    state: () => ({ open: S.open, from: S.from, episode: S.episode, shot: S.shot, refs: S.list.length, cur: S.cur ? S.cur.id : null, look: S.look, busy: S.busy, err: S.err, asking,
      study: study ? { id: study.view && study.view.id, status: study.view && study.view.status, running: study.running, kept: study.kept ? study.kept.id : null, latest: Boolean(study.latest) } : null, stage: S.stageOn }),
  };

  // ── the REFERENCE well (slot inspector.reference) ──
  const slot = UI.slots && UI.slots['inspector.reference'];
  let well = { episode: null, shot: null, editable: false };
  let wellSeq = 0;
  // the well is one node of the slot's, replaced in place: whatever else is in the slot stays (the shell's slot rule)
  let wellNode = null;
  const putWell = (node) => {
    if (wellNode && wellNode.parentNode === slot) { if (node) wellNode.replaceWith(node); else wellNode.remove(); } else if (node) slot.append(node);
    wellNode = node;
  };
  async function paintWell() {
    if (!slot) return;
    const seq = ++wellSeq;
    const { episode, shot, editable } = well;
    if (!episode || !shot) { putWell(null); return; }
    let mine = [];
    try { mine = await unwrap(flpt.refs.attached(episode)); } catch { mine = []; }
    if (seq !== wellSeq) return;
    const byId = new Map(mine.map((m) => [m.ref, m]));
    const chipsOf = (shot.refs || []).map((ref) => {
      const m = byId.get(ref) || { ref, title: ref };
      const pic = m.thumb ? el('img', { src: url(m.thumb), alt: '' }) : el('span', { class: 'rs-swatches', 'aria-hidden': 'true' }, ...(m.palette || []).slice(0, 3).map((h) => swatch(h)));
      return el('span', { class: 'rs-well-ref', title: m.title }, pic, el('span', { class: 'rs-well-name', 'data-content': '' }, m.title),
        editable ? btn('✕', { class: 'linkish', 'aria-label': 'Remove', onclick: () => { const sb = UI.components.storyboard; if (sb) sb.op({ op: 'ref', id: shot.id, remove: ref }); } }) : null);
    });
    const add = editable && (shot.refs || []).length < 4 ? btn('+', { class: 'ghost small rs-well-add', 'aria-label': 'Reference', title: 'Reference', onclick: () => open({ from: 'well', episode, shot: shot.id }) }) : null;
    putWell(chipsOf.length || add ? el('div', { class: 'rs-well' }, ...chipsOf, add) : null);
  }
  function refreshWell() { paintWell(); }
  if (slot) {
    slot.addEventListener('inspector:shot', (e) => {
      const d = (e && e.detail) || {};
      well = { episode: d.episode || null, shot: d.shot || null, editable: Boolean(d.editable) };
      paintWell();
    });
  }
})();
