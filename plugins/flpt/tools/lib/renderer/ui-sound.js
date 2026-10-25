'use strict';
/* global flpt */
// ui-sound.js · the sound picker (PLAN §2.6, draft-ux §6.2; W2-06), FLPT_UI.components.soundPicker(host, opts): the
// Storyboard inspector's SOUND row and the Studio's. Labels only: None · Score ▾ · Library ▾ · File · SFX ○ ◐ ● · ▶
//   opts.value     { music: none | score:<preset> | library:<track> | file:<id>, sfx: off | soft | on }
//   opts.onChange  (value) → … each time the user picks (never for set())
//   opts.preview   a function (value) → a stop function, or a Promise of one: the host plays its piece with this sound
//                  (the Studio's Stage) · an object { seconds, hits, beats, seed }: the picker plays the sound over the
//                  piece's own hits · omitted: the picker plays a few seconds of the sound · false: no ▶
//   opts.kind      the shot's module or kind (motion-solo, duet, interstitial, …): the level the sound plays at
//   opts.episode   the episode's folder, for File (a file of the user's is copied into it)
// The level is FLPT's, never the user's: ▶'s tooltip shows it as a 3-bar meter (▮▮▯ BED under the voice, ▮▮▮ FULL
// alone). File: the native dialog, then the ⚑ rights tick; ticked, the file goes into the episode and is chosen.
// Main does the work (flpt.sound: options, preview, pickFile, stageFile, useFile, files); one preview plays at a time.
//   → { el, value(), set(value), setKind(kind), stop(), destroy() }
(() => {
  const UI = window.FLPT_UI;
  if (!UI || !UI.components) return;

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
  const SFX = [['off', '○', 'Off'], ['soft', '◐', 'Soft'], ['on', '●', 'On']];
  const NARRATED = ['solo', 'duet', 'cosmos', 'motion-solo', 'motion-duet'];
  const srcOf = (music) => { const m = /^(score|library|file):/.exec(String(music || '')); return m ? m[1] : 'none'; };
  const idOf = (music) => String(music || '').replace(/^[a-z]+:/, '');

  /** The level a sound plays at, as the meter shows it (api/sound.js meter(), the same rule). */
  function level(kind, value) {
    const v = value || {};
    const music = srcOf(v.music) !== 'none';
    const sfx = v.sfx != null && v.sfx !== 'off';
    const narrated = NARRATED.includes(kind == null ? 'solo' : String(kind));
    const bars = music ? (narrated ? 2 : 3) : (sfx ? 1 : 0);
    const label = bars ? (narrated ? 'BED' : 'FULL') : '';
    return { bars, label, text: `${'▮'.repeat(bars)}${'▯'.repeat(3 - bars)}${label ? ` ${label}` : ''}` };
  }
  const clean = (v) => ({ music: v && typeof v.music === 'string' && v.music ? v.music : 'none', sfx: v && ['off', 'soft', 'on'].includes(v.sfx) ? v.sfx : 'off' });

  // ── shared: the choices (asked once), one AudioContext, one preview at a time ──────────────────────────────────────
  let choices = null;
  const options = () => {
    if (!choices) {
      choices = Promise.resolve(flpt.sound && flpt.sound.options ? flpt.sound.options() : null)
        .then((r) => (r && r.ok ? r.value : { presets: [], library: [] }), () => ({ presets: [], library: [] }));
    }
    return choices;
  };
  let ac = null;
  let playing = null; // { picker, stop }
  const stopAll = () => { const p = playing; playing = null; if (p) { try { p.stop(); } catch { /* gone */ } p.picker.paint(); } };
  const bytesOf = (b64) => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; };

  function soundPicker(host, opts = {}) {
    let value = clean(opts.value);
    let kind = opts.kind == null ? 'solo' : String(opts.kind);
    let menu = null; // 'score' | 'library' while its menu is open
    let pending = null; // { token, name }: a file picked, waiting for the ⚑ tick
    let names = {}; // file:<id> → its name
    let busy = false;
    let errTimer = null;
    const me = { paint: () => paint() };

    const chips = {
      none: h('button', { type: 'button', class: 'snd-chip', role: 'radio', 'data-src': 'none' }, 'None'),
      score: h('button', { type: 'button', class: 'snd-chip', role: 'radio', 'data-src': 'score', 'aria-haspopup': 'menu' }, h('span', { class: 'snd-name' }, 'Score'), h('span', { class: 'snd-caret', 'aria-hidden': 'true' }, '▾')),
      library: h('button', { type: 'button', class: 'snd-chip', role: 'radio', 'data-src': 'library', 'aria-haspopup': 'menu' }, h('span', { class: 'snd-name' }, 'Library'), h('span', { class: 'snd-caret', 'aria-hidden': 'true' }, '▾')),
      file: h('button', { type: 'button', class: 'snd-chip', role: 'radio', 'data-src': 'file' }, h('span', { class: 'snd-name' }, 'File')),
    };
    const dots = SFX.map(([id, glyph, label]) => h('button', { type: 'button', class: 'snd-dot', role: 'radio', 'data-sfx': id, title: label, 'aria-label': label }, glyph));
    const play = h('button', { type: 'button', class: 'snd-play', 'aria-label': 'Play' }, '▶');
    const list = h('div', { class: 'snd-menu', role: 'menu', hidden: true });
    const tick = h('input', { type: 'checkbox', class: 'snd-tick' });
    const fileName = h('span', { class: 'snd-file', 'data-content': true });
    const rights = h('div', { class: 'snd-rights', hidden: true }, h('label', { class: 'snd-mine', 'data-trust': true }, tick, h('span', {}, '⚑ I have the right to use this music.')), fileName);
    const err = h('span', { class: 'snd-err', role: 'status', 'data-content': true });
    const root = h('div', { class: 'snd', role: 'group', 'aria-label': 'Sound' },
      h('div', { class: 'snd-music', role: 'radiogroup', 'aria-label': 'Music' }, chips.none, chips.score, chips.library, chips.file),
      h('div', { class: 'snd-sfx', role: 'radiogroup', 'aria-label': 'SFX' }, h('span', { class: 'snd-label', 'aria-hidden': 'true' }, 'SFX'), ...dots),
      opts.preview === false ? null : play, list, rights, err);

    function say(text) {
      clearTimeout(errTimer);
      err.textContent = text || '';
      if (text) errTimer = setTimeout(() => { err.textContent = ''; }, 6000);
    }
    async function nameOf(music) {
      if (srcOf(music) !== 'file' || names[music] || !opts.episode || !flpt.sound || !flpt.sound.files) return;
      try {
        const r = await flpt.sound.files(opts.episode);
        if (r && r.ok) for (const f of r.value) names[f.music] = f.name;
      } catch { /* the chip says File */ }
      paint();
    }

    function paint() {
      const src = srcOf(value.music);
      const id = idOf(value.music);
      for (const [k, b] of Object.entries(chips)) b.setAttribute('aria-checked', String(k === src));
      for (const k of ['score', 'library']) chips[k].setAttribute('aria-expanded', String(menu === k));
      options().then((o) => {
        const p = src === 'score' && o.presets.find((x) => x.id === id);
        const t = src === 'library' && o.library.find((x) => x.id === id);
        chips.score.firstChild.textContent = p ? p.name : 'Score';
        chips.library.firstChild.textContent = t ? t.name : 'Library';
        chips.library.title = t ? [t.author, t.license].filter(Boolean).join(' · ') : '';
      });
      const fname = src === 'file' ? names[value.music] : null;
      chips.file.firstChild.textContent = fname || 'File';
      chips.file.title = fname || '';
      chips.file.hidden = !opts.episode;
      for (const d of dots) d.setAttribute('aria-checked', String(d.dataset.sfx === value.sfx));
      const mine = playing && playing.picker === me;
      play.textContent = mine ? '❚❚' : '▶';
      play.setAttribute('aria-label', mine ? 'Stop' : 'Play');
      play.title = level(kind, value).text;
      play.dataset.bars = String(level(kind, value).bars);
      root.classList.toggle('busy', busy);
      rights.hidden = !pending;
      fileName.textContent = pending ? pending.name : '';
      if (!pending) tick.checked = false;
    }

    // ── choosing ──
    function choose(next, { fromUser = true } = {}) {
      const was = JSON.stringify(value);
      value = clean({ ...value, ...next });
      paint();
      if (fromUser && JSON.stringify(value) !== was) {
        if (typeof opts.onChange === 'function') { try { opts.onChange({ ...value }); } catch (e) { console.error(e); } } // eslint-disable-line no-console
        if (playing && playing.picker === me && typeof opts.preview !== 'function') start(); // a live preview follows the pick
      }
      nameOf(value.music);
    }
    function closeMenu(focus) {
      if (!menu) return;
      const was = menu;
      menu = null;
      list.hidden = true;
      list.replaceChildren();
      paint();
      if (focus) chips[was].focus();
    }
    async function openMenu(which) {
      if (menu === which) { closeMenu(true); return; }
      pending = null;
      const o = await options();
      const items = which === 'score' ? o.presets : o.library;
      menu = which;
      const at = value.music;
      list.replaceChildren(...items.map((it) => h('button', {
        type: 'button', role: 'menuitemradio', class: 'snd-item', 'aria-checked': String(it.music === at), 'data-music': it.music,
        title: which === 'library' ? [it.author, it.license].filter(Boolean).join(' · ') : `${it.bpm} BPM`,
      }, it.name)));
      const chip = chips[which];
      list.style.left = `${chip.offsetLeft}px`;
      list.style.top = `${chip.offsetTop + chip.offsetHeight + 4}px`;
      list.hidden = false;
      paint();
      const first = list.querySelector('[aria-checked="true"]') || list.firstElementChild;
      if (first) first.focus();
    }
    list.addEventListener('click', (e) => {
      const b = e.target.closest('.snd-item');
      if (!b) return;
      const which = menu;
      closeMenu(false);
      choose({ music: b.dataset.music });
      if (which) chips[which].focus();
    });
    list.addEventListener('keydown', (e) => {
      const items = [...list.querySelectorAll('.snd-item')];
      const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = items.length;
        if (n) items[(i + (e.key === 'ArrowDown' ? 1 : n - 1) + n) % n].focus();
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        if (items.length) items[e.key === 'Home' ? 0 : items.length - 1].focus();
      } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(true); } else if (e.key === 'Tab') closeMenu(false);
    });
    // a host that rebuilds its view without destroy(): the picker lets go of the page once it's gone
    const outside = (e) => {
      if (!root.isConnected) { document.removeEventListener('pointerdown', outside, true); return; }
      if (menu && !root.contains(e.target)) closeMenu(false);
    };
    document.addEventListener('pointerdown', outside, true);
    // ← → move along a group (Enter or Space picks, as each button does)
    root.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const group = e.target.closest('.snd-music, .snd-sfx');
      if (!group) return;
      const items = [...group.querySelectorAll('button')].filter((b) => !b.hidden);
      const i = items.indexOf(e.target);
      if (i < 0) return;
      e.preventDefault();
      items[(i + (e.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length].focus();
    });

    chips.none.addEventListener('click', () => { closeMenu(false); pending = null; choose({ music: 'none' }); });
    chips.score.addEventListener('click', () => openMenu('score'));
    chips.library.addEventListener('click', () => openMenu('library'));
    for (const c of [chips.score, chips.library]) {
      c.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); openMenu(c.dataset.src); } });
    }
    for (const d of dots) d.addEventListener('click', () => choose({ sfx: d.dataset.sfx }));

    // ── File: the native dialog (or a drop), then the ⚑ tick ──
    async function held(r) {
      if (!r) return;
      if (!r.ok) { say(r.error); return; }
      if (r.value) { pending = r.value; paint(); tick.focus(); }
    }
    chips.file.addEventListener('click', async () => {
      closeMenu(false);
      if (!opts.episode || !flpt.sound) return;
      try { await held(await flpt.sound.pickFile()); } catch (e) { say(e.message); }
    });
    chips.file.addEventListener('dragover', (e) => { if (opts.episode) { e.preventDefault(); chips.file.classList.add('over'); } });
    chips.file.addEventListener('dragleave', () => chips.file.classList.remove('over'));
    chips.file.addEventListener('drop', async (e) => {
      e.preventDefault();
      chips.file.classList.remove('over');
      if (!opts.episode || !flpt.sound || !e.dataTransfer || !e.dataTransfer.files.length) return;
      try { await held(await flpt.sound.stageFile(e.dataTransfer.files)); } catch (x) { say(x.message); }
    });
    tick.addEventListener('change', async () => {
      if (!tick.checked || !pending) return;
      const p = pending;
      busy = true;
      paint();
      try {
        const r = await flpt.sound.useFile(opts.episode, p.token, true);
        if (!r || !r.ok) { tick.checked = false; say(r ? r.error : ''); return; }
        names[r.value.music] = r.value.name;
        pending = null;
        choose({ music: r.value.music });
      } catch (e) { tick.checked = false; say(e.message); } finally { busy = false; paint(); }
    });

    // ── ▶ ──
    async function start() {
      const turn = {};
      stopAll();
      say('');
      if (typeof opts.preview === 'function') {
        try {
          const stop = await opts.preview({ ...value });
          if (typeof stop === 'function') { playing = { picker: me, stop }; paint(); }
        } catch (e) { say(e.message); }
        return;
      }
      if (!flpt.sound || !flpt.sound.preview) return;
      const piece = opts.preview && typeof opts.preview === 'object' ? opts.preview : {};
      const spec = { music: value.music, sfx: value.sfx, kind };
      for (const k of ['seconds', 'hits', 'beats', 'seed']) if (piece[k] != null) spec[k] = piece[k];
      let node = null;
      playing = { picker: me, stop: () => { turn.off = true; if (node) { try { node.stop(); } catch { /* ended */ } } } };
      busy = true;
      paint();
      try {
        const r = await flpt.sound.preview(spec, opts.episode || null);
        if (turn.off) return;
        if (!r || !r.ok) throw new Error(r ? r.error : '');
        ac = ac || new AudioContext();
        if (ac.state === 'suspended') await ac.resume().catch(() => {});
        const buf = await ac.decodeAudioData(bytesOf(r.value.wav));
        if (turn.off) return;
        node = ac.createBufferSource();
        node.buffer = buf;
        node.connect(ac.destination);
        node.onended = () => { if (playing && playing.picker === me && !turn.off) { playing = null; paint(); } };
        node.start();
      } catch (e) {
        if (playing && playing.picker === me) playing = null;
        say(e.message);
      } finally { busy = false; paint(); }
    }
    play.addEventListener('click', () => { if (playing && playing.picker === me) { stopAll(); paint(); } else start(); });

    host.replaceChildren(root);
    paint();
    nameOf(value.music);
    return {
      el: root,
      value: () => ({ ...value }),
      set(v) { choose(clean(v), { fromUser: false }); },
      setKind(k) { kind = k == null ? 'solo' : String(k); paint(); },
      stop() { if (playing && playing.picker === me) stopAll(); },
      destroy() {
        if (playing && playing.picker === me) stopAll();
        clearTimeout(errTimer);
        document.removeEventListener('pointerdown', outside, true);
        root.remove();
      },
    };
  }
  soundPicker.level = level;
  UI.components.soundPicker = soundPicker;
})();
