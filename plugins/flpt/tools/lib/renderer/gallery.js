'use strict';
/* global flpt */
// gallery.js · the Style Gallery (PLAN §3.3 S12–S13, §3.4; W3-01). One file, two places:
//
// gallery.html (its own window, ⌥⌘G): the wall.
//   tiles     one per usable style (flpt.styles.list: shipped in Gallery order, then Mine, then Shared once a verified
//             catalog holds one), a Pinterest masonry of 16:9 and 4:5 posters (K9: shortest column first, absolute tiles
//             at known aspect ratios, so nothing shifts as posters load; 2D transforms; content-visibility). The wall
//             always ends with the dashed "? Your look" band, full width under the last column, which opens the reference
//             sheet (W3-02's, in the main window). Name and sound chip on hover, focus and while playing.
//   ▶         plays the tile's loop in the tile, with the style's score; ▶ again stops; another ▶ stops the first
//             (the Transitions & Music pattern). One AudioContext for the window, a MediaElementSource per press, a
//             40 ms fade on stop; a press makes its <video> and stop destroys it, except the first tile's: while the
//             window is visible that one waits in its tile, muted and parked at its first frame (the warm-up), and ▶
//             there takes it as it is; the context runs while the window is visible. Esc, a hidden window, a tile
//             scrolled out of view, a filter that hides it: each stops it. Pause motion keeps posters and holds the
//             hover lift and the re-deal; ▶ still plays (it's the user's own press).
//   detail    a sheet over the wall, under the top bar (S13): the loop large with its sound (▶ over the picture, its
//             length in the corner), the specimen (the type in the style's own face, its swatches), three tags and the
//             sound default, Use (in pick mode "Use for 04"; otherwise the default of an episode still planning),
//             Compare (side by side or a wipe, against another style), Duplicate, Share and Remove (Mine; Remove waits
//             while an import renders), ▸ Recipe, the credit.
//   pick mode the Storyboard inspector's STYLE slot opens the Gallery for one shot: the bar along the bottom says which,
//             a click picks a tile, Use gives the shot that style and brings the main window back to it.
//   also      All · Shipped · Mine (· Shared), search, + (Your look · Style file), the six inspiration places (FLPT's
//             own art; each opens in the browser, Capture where the place allows it), Check for new styles and the
//             catalog's "2.0.3 is out" line (only with the catalog client); a catalog check made anywhere
//             (catalog:changed) re-reads the wall.
//
// index.html (the main window, from FLPT_UI's slots): the top bar's ◱ (the Gallery from any stage), the inspector's
// STYLE slot (the shot's style, its poster and name; a press opens pick mode), and the main window's side of the
// Gallery's events: gallery:picked (show that shot), gallery:your-look (the reference sheet), gallery:share (the Share
// sheet), each W3-02's component where there is one.
//
// Labels only; hints are tooltips. The page names styles by key and episodes by reference, never a path.
(() => {
  const SVGNS = 'http://www.w3.org/2000/svg';
  const has = (ns, fn) => Boolean(window.flpt && flpt[ns] && typeof flpt[ns][fn] === 'function');
  /** A bridge call's value, or a thrown Error with main's words. */
  async function call(ns, fn, ...args) {
    if (!has(ns, fn)) throw new Error('Not here.');
    const r = await flpt[ns][fn](...args);
    if (r && r.ok) return r.value;
    throw new Error((r && r.error) || 'That didn\'t work.');
  }
  const listen = (ns, ev, fn) => (has(ns, ev) ? flpt[ns][ev](fn) : () => {});
  function h(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (v === true) n.setAttribute(k, '');
      else if (v !== false && v != null) n.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  }
  function icon(cls, d) {
    const s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', '0 0 16 16');
    s.setAttribute('class', cls);
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('d', d);
    s.append(p);
    return s;
  }
  const PLAY = 'M4 2.5v11l9.5-5.5z';
  const STOP = 'M3.5 3.5h9v9h-9z';

  if (document.documentElement.dataset.page === 'gallery') wall(); else hooks();

  // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // The wall (gallery.html)
  // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
  function wall() {
    const $ = (sel) => document.querySelector(sel);
    const cfg = { warmFrames: 3, warmEveryMs: 10000, fadeS: 0.04, volume: 1 };
    const S = {
      tiles: [], byKey: new Map(), nodes: new Map(), filter: 'all', q: '', playing: null, seq: 0, ctx: null, master: null, warm: null, warmTimer: 0,
      pick: null, picked: null, shared: false, catalog: false, cols: 0, colW: 0, queued: false, offIO: null, yours: null,
      detail: null, compare: null, opener: null, toastTimer: 0, motion: 'on', loaded: false, durations: new Map(),
    };
    const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const held = () => S.motion === 'paused' || reduced.matches;

    // ── Pause motion (settings.ui.motion, mirrored to localStorage by the main window; fx-boot.js set it before paint) ──
    function applyMotion(m) {
      S.motion = m === 'paused' ? 'paused' : 'on';
      document.documentElement.classList.toggle('fx-paused', S.motion === 'paused');
    }
    try { applyMotion(localStorage.getItem('flpt.motion')); } catch { applyMotion('on'); }
    window.addEventListener('storage', (e) => { if (e.key === 'flpt.motion') applyMotion(e.newValue); });

    // ── toast ──
    function toast(text, { bad = false, action = null, ms = 6000 } = {}) {
      const t = $('#g-toast');
      clearTimeout(S.toastTimer);
      t.replaceChildren(h('span', { 'data-content': '' }, text));
      if (action) t.append(h('button', { type: 'button', class: 'g-btn quiet', onclick: () => { t.hidden = true; action.run(); } }, action.label));
      t.classList.toggle('is-bad', bad);
      t.hidden = false;
      S.toastTimer = setTimeout(() => { t.hidden = true; }, ms);
    }
    const fail = (e) => toast(e && e.message ? e.message : String(e), { bad: true });

    // ── tiles ──
    const chipOf = (t) => (t.sound && t.sound.label ? `♪ ${t.sound.label}` : (t.tags && t.tags[0]) || '');
    /** 16:9, or 4:5 for two in five (the wall's rhythm), where the style has both a tall poster and a tall loop. */
    const shapeOf = (t, i) => (t.media.posterTall && t.media.loopTall && (i % 5 === 1 || i % 5 === 3) ? 'tall' : 'wide');
    const ASPECT = { wide: 9 / 16, tall: 5 / 4 };
    const badgeOf = (t) => (t.rendering ? 'Rendering' : t.share === 'submitted' ? 'In review' : t.share === 'approved' ? 'Shared' : null);

    function tileNode(t, shape) {
      const src = shape === 'tall' ? t.media.posterTall : t.media.poster;
      const img = h('img', { class: 'g-poster', src: src || null, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' });
      const face = h('button', { type: 'button', class: 'g-face', 'aria-label': t.name, 'aria-pressed': S.pick ? 'false' : null, title: t.line || null },
        img, h('div', { class: 'g-meta', 'aria-hidden': 'true' }, h('p', { class: 'g-name' }, t.name), h('p', { class: 'g-chip' }, chipOf(t))));
      const play = h('button', { type: 'button', class: 'g-play', 'aria-pressed': 'false', 'aria-label': `Play ${t.name}`, title: 'Play', disabled: !(t.media.loop) || null },
        icon('i-play', PLAY), icon('i-stop', STOP));
      const info = h('button', { type: 'button', class: 'g-info', 'aria-label': `${t.name}: details`, title: 'Details', hidden: !S.pick || null }, 'i');
      const badge = badgeOf(t);
      const node = h('article', { class: `g-tile${t.rendering ? ' is-rendering' : ''}`, role: 'listitem', 'data-key': t.key, 'data-shape': shape },
        face, play, info, badge ? h('span', { class: 'g-badge' }, badge) : null);
      Object.assign(node, { _img: img, _face: face, _play: play, _info: info, _t: t, _shape: shape });
      face.addEventListener('click', () => (S.pick ? choose(t.key) : openDetail(t.key, face)));
      face.addEventListener('dblclick', () => { if (S.pick) { choose(t.key); useNow(); } });
      play.addEventListener('click', (e) => toggleTile(t.key, e));
      info.addEventListener('click', () => openDetail(t.key, info));
      return node;
    }

    function yoursNode() {
      const face = h('button', { type: 'button', class: 'g-yours-face', 'aria-label': 'Your look', title: 'Video, pictures or a link' },
        h('span', { class: 'g-yours-mark', 'aria-hidden': 'true' }, '?'), h('span', { class: 'g-yours-name', 'aria-hidden': 'true' }, 'Your look'));
      face.addEventListener('click', () => yourLook());
      return h('article', { class: 'g-tile g-yours', role: 'listitem', 'data-key': 'yours' }, face);
    }

    /** The tiles from main, applied to the wall: new ones made, gone ones removed (a playing one stops), others kept. */
    function sync(tiles) {
      const wallEl = $('#g-wall');
      const keep = new Set(tiles.map((t) => t.key));
      for (const [k, n] of S.nodes) {
        if (keep.has(k)) continue;
        if (S.playing && S.playing.key === k) stop();
        n.remove();
        S.nodes.delete(k);
      }
      S.tiles = tiles;
      S.byKey = new Map(tiles.map((t) => [t.key, t]));
      const frag = document.createDocumentFragment();
      tiles.forEach((t, i) => {
        const shape = shapeOf(t, i);
        let n = S.nodes.get(t.key);
        const old = n && n._t;
        const same = old && n._shape === shape && JSON.stringify(old) === JSON.stringify(t);
        if (!same) {
          if (n && S.playing && S.playing.key === t.key) stop();
          const fresh = tileNode(t, shape);
          if (n) n.replaceWith(fresh);
          n = fresh;
          S.nodes.set(t.key, n);
        }
        frag.append(n);
      });
      if (!S.yours) S.yours = yoursNode();
      frag.append(S.yours);
      wallEl.append(frag); // re-appending keeps each node (and its playing video) in order
      applyFilter(false);
      markPick();
    }

    const visible = () => S.tiles.filter((t) => !S.nodes.get(t.key).hidden);

    // ── masonry ──
    function layout() {
      S.queued = false;
      const wallEl = $('#g-wall');
      const W = wallEl.clientWidth;
      if (!W) return;
      const narrow = W < 600;
      const gap = narrow ? 12 : 16;
      const min = narrow ? 150 : 250;
      const cols = Math.max(1, Math.min(6, Math.floor((W + gap) / (min + gap))));
      const colW = Math.floor((W - gap * (cols - 1)) / cols);
      const heights = new Array(cols).fill(0);
      const place = (n, ratio) => {
        let c = 0;
        for (let k = 1; k < cols; k++) if (heights[k] < heights[c] - 0.5) c = k;
        const hgt = Math.round(colW * ratio);
        n.style.width = `${colW}px`;
        n.style.height = `${hgt}px`;
        n.style.transform = `translate(${c * (colW + gap)}px, ${heights[c]}px)`;
        heights[c] += hgt + gap;
      };
      for (const t of visible()) { const n = S.nodes.get(t.key); place(n, ASPECT[n._shape]); }
      // Your look: a full-width band under the lowest column, so it's always last whatever the columns did
      const end = Math.max(...heights);
      if (S.yours) {
        const bandH = narrow ? 72 : 88;
        S.yours.style.width = `${W}px`;
        S.yours.style.height = `${bandH}px`;
        S.yours.style.transform = `translate(0px, ${end}px)`;
        wallEl.style.height = `${end + bandH}px`;
      } else wallEl.style.height = `${Math.max(0, end - gap)}px`;
      S.cols = cols;
      S.colW = colW;
    }
    function queueLayout() {
      if (S.queued) return;
      S.queued = true;
      requestAnimationFrame(layout);
    }

    function matches(t, q) {
      if (!q) return true;
      return [t.name, t.line, ...(t.tags || []), ...(t.uses || [])].join(' ').toLowerCase().includes(q);
    }
    function applyFilter(deal = true) {
      const q = S.q.trim().toLowerCase();
      let shown = 0;
      for (const t of S.tiles) {
        const ok = (S.filter === 'all' || t.scope === S.filter) && matches(t, q);
        const n = S.nodes.get(t.key);
        if (!ok && S.playing && S.playing.key === t.key) stop();
        n.hidden = !ok;
        if (ok) shown++;
      }
      $('#g-empty').hidden = shown > 0 || !S.loaded;
      $('#g-count').textContent = S.loaded ? `${shown} ${shown === 1 ? 'style' : 'styles'}` : '';
      const wallEl = $('#g-wall');
      if (deal && !held()) {
        wallEl.classList.add('is-dealing');
        clearTimeout(S.dealTimer);
        S.dealTimer = setTimeout(() => wallEl.classList.remove('is-dealing'), 360);
      }
      layout();
      if (S.loaded) queueWarm(); // the first tile may be another now
    }

    // ── sound: one AudioContext for the window ──
    function ensureCtx() {
      if (!S.ctx) {
        S.ctx = new AudioContext({ latencyHint: 'interactive' });
        S.master = S.ctx.createGain();
        S.master.gain.value = cfg.volume;
        S.master.connect(S.ctx.destination);
      }
      if (S.ctx.state !== 'running' && !document.hidden) S.ctx.resume().catch(() => {});
      return S.ctx;
    }
    function makeVideo(url, cls = 'g-video') {
      const v = document.createElement('video');
      v.className = cls;
      v.preload = 'auto';
      v.playsInline = true;
      v.loop = true;
      v.crossOrigin = 'anonymous'; // flpt-gallery:// answers with CORS, so Web Audio may hear it
      v.disableRemotePlayback = true;
      v.setAttribute('disablepictureinpicture', '');
      v.setAttribute('aria-hidden', 'true');
      v.src = url;
      return v;
    }
    function dropVideo(v) {
      try { v.pause(); } catch { /* gone */ }
      try { if (v._src) v._src.disconnect(); } catch { /* not connected */ }
      v._src = null;
      v.removeAttribute('src');
      try { v.load(); } catch { /* released */ }
      v.remove();
    }

    // The warm-up (K9; F-02): a press otherwise waits for its loop's first frame, and that frame needs the GPU's main
    // thread, which in an app whose GPU hasn't drawn the Gallery before (just installed, a DMG just mounted) is busy for
    // 130–220 ms making the pipelines for the press's own first paint; the sound waits with it. So when the window opens
    // (and shows again) the first tile's loop loads in its own tile, muted, its sound path joined at gain 0, plays a few
    // frames and parks at its first frame. While the window is visible it's sought again every 10 s, a frame decoded
    // each time (Chromium releases a paused player's decoders once it has sat idle 15 s); a hidden window drops it. ▶
    // on that tile takes it as it is: nothing left to decode, so the sound starts at once. Never heard: muted and at
    // gain 0 until a press.
    function firstTile() {
      for (const t of visible()) {
        const n = S.nodes.get(t.key);
        const url = n._shape === 'tall' ? t.media.loopTall : t.media.loop;
        if (url) return { node: n, url };
      }
      return null;
    }
    function unwarm() {
      clearTimeout(S.warmTimer);
      const w = S.warm;
      if (!w) return;
      S.warm = null;
      try { w.gain.disconnect(); } catch { /* gone */ }
      dropVideo(w.v);
    }
    /**
     * Parks the warm loop at its first frame, its decoders ready: the first time after playing a few frames, muted;
     * after that by a seek (to 0, or to 1 ms when it's at 0: a seek to where it is wouldn't decode anything).
     */
    function park(w) {
      if (w.parking) return;
      w.parking = true;
      const { v } = w;
      const parked = () => {
        if (S.warm !== w || !w.parking) return;
        w.parking = false;
        w.at = performance.now();
        S.primedAt = w.at;
        emit('gallery:primed', { at: w.at });
        clearTimeout(S.warmTimer);
        S.warmTimer = setTimeout(warm, cfg.warmEveryMs + 50);
      };
      const seek = () => {
        if (S.warm !== w || !w.parking) return;
        w.live = false;
        v.pause();
        v.addEventListener('seeked', parked, { once: true });
        v.currentTime = v.currentTime > 0 ? 0 : 0.001;
        setTimeout(parked, 3000); // a seek that never ends doesn't hold the warm-up
      };
      if (w.at) { seek(); return; }
      v.addEventListener('playing', () => { w.live = true; setTimeout(seek, (cfg.warmFrames * 1000) / 30); }, { once: true });
      setTimeout(seek, 3000); // a loop that never starts is sought where it is
      const p = v.play();
      if (p) p.catch(() => {});
    }
    /** The first tile's loop, warm (made, moved to a new first tile, or parked again when it's been a while). */
    function warm() {
      if (S.playing || document.hidden) return;
      try { ensureCtx(); } catch { return; }
      const f = firstTile();
      if (S.warm && (!f || S.warm.node !== f.node || S.warm.url !== f.url || !S.warm.v.isConnected)) unwarm();
      if (S.warm) {
        if (!S.warm.parking && performance.now() - S.warm.at >= cfg.warmEveryMs) park(S.warm);
        return;
      }
      if (!f || f.url === S.warmBroken) return;
      const v = makeVideo(f.url, 'g-video g-prime');
      v.muted = true;
      const gain = S.ctx.createGain();
      gain.gain.value = 0;
      v._src = S.ctx.createMediaElementSource(v);
      v._src.connect(gain);
      gain.connect(S.master);
      const poster = f.node._face.querySelector(':scope > .g-poster');
      if (poster) poster.after(v); else f.node._face.append(v);
      S.warm = { node: f.node, url: f.url, v, gain, at: 0 };
      v.addEventListener('error', () => { if (S.warm && S.warm.v === v) { unwarm(); S.warmBroken = f.url; } }, { once: true });
      park(S.warm);
    }
    const queueWarm = () => (window.requestIdleCallback || setTimeout)(warm, { timeout: 500 });

    /**
     * Play one thing, with sound: rec = { key, url, node (gets is-playing, is-loading), btn (its ▶), host (where the
     * video goes, after its poster), name, others: [{ url, host }] (muted pictures alongside: Compare) }.
     */
    function start(rec, ev) {
      const pressAt = ev && ev.isTrusted && ev.timeStamp ? ev.timeStamp : performance.now();
      const ctx = ensureCtx();
      // the first tile's warm loop, taken as it is (parked, or still parking); any other press makes its own
      const w = rec.tile && S.warm && S.warm.node === rec.node && S.warm.url === rec.url ? S.warm : null;
      let v;
      if (w) {
        clearTimeout(S.warmTimer);
        S.warm = null;
        v = w.v;
        v.classList.remove('g-prime');
        rec.gain = w.gain;
        rec.gain.gain.cancelScheduledValues(ctx.currentTime);
        rec.gain.gain.value = 1;
      } else {
        v = makeVideo(rec.url);
        const poster = rec.host.querySelector(':scope > .g-poster');
        if (poster) poster.after(v); else rec.host.append(v);
        v._src = ctx.createMediaElementSource(v);
        rec.gain = ctx.createGain();
        v._src.connect(rec.gain);
        rec.gain.connect(S.master);
      }
      v.muted = false;
      rec.video = v;
      rec.seq = ++S.seq;
      rec.pressAt = pressAt;
      rec.others = (rec.others || []).map((o) => {
        const ov = makeVideo(o.url);
        ov.muted = true;
        const op = o.host.querySelector(':scope > .g-poster');
        if (op) op.after(ov); else o.host.append(ov);
        return ov;
      });
      S.playing = rec;
      rec.node.classList.add('is-playing', 'is-loading');
      rec.btn.setAttribute('aria-pressed', 'true');
      rec.btn.setAttribute('aria-label', `Stop ${rec.name}`);
      rec.btn.title = 'Stop';
      if (typeof rec.onMeta === 'function') v.addEventListener('loadedmetadata', () => rec.onMeta(v.duration), { once: true });
      const playing = () => {
        if (S.playing !== rec) return;
        rec.node.classList.remove('is-loading');
        v.classList.add('is-live');
        for (const ov of rec.others) { ov.currentTime = v.currentTime; ov.classList.add('is-live'); ov.play().catch(() => {}); }
        emit('gallery:playing', { key: rec.key, seq: rec.seq, pressAt, playingAt: performance.now() });
      };
      if (w && w.live && !v.paused) queueMicrotask(playing); // taken mid-warm-up: it's playing already
      else v.addEventListener('playing', playing, { once: true });
      const p = v.play();
      if (p) p.catch(() => { if (S.playing === rec) { stop(); toast('That loop won\'t play here.', { bad: true }); } });
      if (rec.tile && S.offIO) S.offIO.observe(rec.node);
      emit('gallery:press', { key: rec.key, seq: rec.seq, pressAt, handlerAt: performance.now() });
      return rec;
    }

    function stop() {
      const rec = S.playing;
      if (!rec) return;
      S.playing = null;
      rec.node.classList.remove('is-playing', 'is-loading');
      rec.btn.setAttribute('aria-pressed', 'false');
      rec.btn.setAttribute('aria-label', `Play ${rec.name}`);
      rec.btn.title = 'Play';
      if (rec.tile && S.offIO) S.offIO.unobserve(rec.node);
      const vids = [rec.video, ...rec.others];
      for (const v of vids) v.classList.remove('is-live');
      const finish = () => {
        try { if (rec.gain) rec.gain.disconnect(); } catch { /* gone */ }
        for (const v of vids) dropVideo(v);
      };
      if (rec.gain && S.ctx && S.ctx.state === 'running') {
        const now = S.ctx.currentTime;
        rec.gain.gain.cancelScheduledValues(now);
        rec.gain.gain.setValueAtTime(rec.gain.gain.value, now);
        rec.gain.gain.linearRampToValueAtTime(0, now + cfg.fadeS);
        setTimeout(finish, cfg.fadeS * 1000 + 20);
      } else finish();
      emit('gallery:stop', { key: rec.key, seq: rec.seq });
      queueWarm(); // the first tile's warm loop again (it was this one, or it's been a while)
    }

    function toggleTile(key, ev) {
      const was = S.playing && S.playing.key === key;
      stop();
      if (was) return;
      const t = S.byKey.get(key);
      const node = S.nodes.get(key);
      if (!t || !node || node.hidden) return;
      const url = node._shape === 'tall' ? t.media.loopTall : t.media.loop;
      if (!url) return;
      start({ key, url, node, btn: node._play, host: node._face, name: t.name, tile: true, others: [] }, ev);
    }

    // ── pick mode ──
    function markPick() {
      const on = Boolean(S.pick);
      document.body.classList.toggle('g-picking', on);
      $('#g-pickbar').hidden = !on;
      for (const [k, n] of S.nodes) {
        n.classList.toggle('is-picked', on && k === S.picked);
        if (on) n._face.setAttribute('aria-pressed', String(k === S.picked)); else n._face.removeAttribute('aria-pressed');
        n._info.hidden = !on;
      }
      if (!on) return;
      $('#g-pick-label').textContent = S.pick.label || '';
      const t = S.picked ? S.byKey.get(S.picked) : null;
      $('#g-pick-name').textContent = t ? t.name : '';
      $('#g-pick-use').disabled = !t;
    }
    function choose(key) {
      S.picked = key;
      markPick();
    }
    async function useNow(key = S.picked) {
      if (!key) return;
      try {
        await call('gallery', 'use', key);
        closeDetail();
      } catch (e) { fail(e); }
    }
    async function refreshState() {
      let st = null;
      try { st = await call('gallery', 'state'); } catch { st = null; }
      const before = S.pick && `${S.pick.episode}|${S.pick.shot}`;
      S.pick = st && st.pick ? st.pick : null;
      if (S.pick && `${S.pick.episode}|${S.pick.shot}` !== before) S.picked = S.pick.current || null;
      if (!S.pick) S.picked = null;
      S.catalog = Boolean(st && st.catalog);
      $('#g-check').hidden = !S.catalog;
      const latest = st && st.latest; // the catalog's own line ("2.0.3 is out")
      $('#g-latest').hidden = !latest;
      $('#g-latest').textContent = latest || '';
      markPick();
      if (S.detail) renderDetail();
    }

    // ── load ──
    async function load() {
      let r;
      try { r = await call('styles', 'list'); } catch (e) { r = { tiles: [], shared: false }; fail(e); }
      S.shared = Boolean(r.shared);
      const sharedTab = document.querySelector('.g-tab[data-filter="shared"]');
      sharedTab.hidden = !S.shared;
      if (!S.shared && S.filter === 'shared') setFilter('all');
      S.loaded = true;
      sync(Array.isArray(r.tiles) ? r.tiles : []);
      if (S.detail && !S.byKey.has(S.detail.key)) closeDetail();
    }
    let reloadTimer = 0;
    const reload = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(load, 150); };

    // ── inspiration: six places, FLPT's own art (no fetched pictures), each opens in the user's browser ──
    // six static motifs, drawn here (shapes only: no picture or text from outside); the sixth, a masonry board of
    // offset cards with a few filled like swatches, is Savee's (link only: nothing of the site is ever fetched)
    const MOTIFS = [
      () => [0, 1, 2, 3, 4].map((i) => ['circle', { cx: 30 + i * 10, cy: 78, r: 18 + i * 12, fill: 'none' }]),
      () => Array.from({ length: 40 }, (_, i) => ['circle', { cx: 12 + (i % 10) * 22, cy: 10 + Math.floor(i / 10) * 14, r: 1.2 + ((i * 7) % 5) * 0.5, fill: 'ink' }]),
      () => Array.from({ length: 16 }, (_, i) => ['line', { x1: i * 16 - 40, y1: 70, x2: i * 16 + 20, y2: 0 }]),
      () => [0, 1, 2, 3].map((i) => ['path', { d: ['M0', 18 + i * 12, 'C40', 4 + i * 12, '80', 32 + i * 12, '120', 18 + i * 12, 'S200', 4 + i * 12, '240', 18 + i * 12].join(' '), fill: 'none' }]),
      () => Array.from({ length: 9 }, (_, i) => ['rect', { x: 8 + i * 26, y: 14, width: 18, height: 34, rx: 2, fill: 'none' }]),
      () => Array.from({ length: 8 }, (_, c) => {
        const col = [];
        for (let y = 6 + ((c * 7) % 13), k = 0; y < 64; k += 1) {
          const tall = 14 + ((c * 5 + k * 3) % 3) * 8;
          col.push(['rect', { x: 8 + c * 30, y, width: 22, height: tall, rx: 2, fill: (c * 3 + k) % 7 === 3 ? 'ink' : 'none' }]);
          y += tall + 6;
        }
        return col;
      }).flat(),
    ];
    // the house's night inks, one per place: gold, navy, chestnut, moss, ink-2, ox
    const INKS = ['#E3B860', '#8FB0E6', '#E39A68', '#8DBB87', '#B9B2A2', '#E08DAA'];
    function artOf(i) {
      const s = document.createElementNS(SVGNS, 'svg');
      s.setAttribute('viewBox', '0 0 240 64');
      s.setAttribute('preserveAspectRatio', 'xMidYMid slice');
      s.setAttribute('class', 'g-site-art');
      s.setAttribute('aria-hidden', 'true');
      const g = document.createElementNS(SVGNS, 'g');
      g.setAttribute('opacity', '.55');
      const ink = INKS[i % INKS.length];
      for (const [tag, attrs] of MOTIFS[i % MOTIFS.length]()) {
        const n = document.createElementNS(SVGNS, tag);
        for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, k === 'fill' && v === 'ink' ? ink : String(v));
        if (attrs.fill !== 'ink') { n.setAttribute('stroke', ink); n.setAttribute('stroke-width', '1.2'); }
        g.append(n);
      }
      s.append(g);
      return s;
    }
    async function inspiration() {
      let r;
      try { r = await call('styles', 'inspiration'); } catch { r = { links: [] }; }
      const row = $('#g-insp');
      row.replaceChildren(...(r.links || []).map((l, i) => {
        const open = h('button', { type: 'button', class: 'g-site-open', 'aria-label': `${l.name} (opens in the browser)`, title: [l.blurb, l.detail].filter(Boolean).join(' · ') },
          h('span', { class: 'g-site-name' }, `${l.name} ↗`), h('span', { class: 'g-site-meta' }, [l.access, ...(l.tags || []).slice(0, 1)].filter(Boolean).join(' · ')));
        open.addEventListener('click', () => call('styles', 'openLink', l.id).catch(fail));
        const kids = [artOf(i), open];
        if (l.capture) {
          const cap = h('button', { type: 'button', class: 'g-site-capture', 'aria-label': `Capture ${l.name}`, title: 'Capture a reference from it' }, 'Capture');
          cap.addEventListener('click', () => yourLook({ inspiration: l.id }));
          kids.push(cap);
        }
        return h('div', { class: 'g-site', 'data-id': l.id }, ...kids);
      }));
      $('.g-insp').hidden = !(r.links || []).length;
    }

    async function yourLook(spec = {}) {
      try { await call('gallery', 'yourLook', spec); } catch (e) { fail(e); }
    }

    // ── the detail sheet (S13) ──
    const pad2 = (n) => String(n).padStart(2, '0');
    const secs = (s) => `${Math.floor(s / 60)}:${pad2(Math.round(s % 60))}`;
    const fontFaces = new Map(); // url → family name loaded
    function loadFont(f) {
      if (!f || !f.url || typeof FontFace !== 'function') return Promise.resolve(null);
      if (fontFaces.has(f.url)) return fontFaces.get(f.url);
      const family = `gs-face-${fontFaces.size}`;
      const p = new FontFace(family, `url("${f.url}")`).load().then((ff) => { document.fonts.add(ff); return family; }, () => null);
      fontFaces.set(f.url, p);
      return p;
    }

    async function openDetail(key, opener) {
      let d;
      try { d = await call('styles', 'get', key); } catch (e) { fail(e); return; }
      if (S.playing) stop();
      S.opener = opener || document.activeElement;
      S.detail = d;
      S.compare = null;
      renderDetail();
      measureTop();
      $('#g-scrim').hidden = false;
      const sheet = $('#g-detail');
      sheet.hidden = false;
      const first = sheet.querySelector('.g-play') || sheet.querySelector('.g-close');
      if (first) first.focus({ preventScroll: true });
    }
    /** The sheet opens under the top bar (its height varies with the width): --g-top-h. */
    function measureTop() {
      const top = $('.g-top');
      if (top) document.documentElement.style.setProperty('--g-top-h', `${Math.round(top.getBoundingClientRect().height)}px`);
    }
    function closeDetail() {
      if (!S.detail) return;
      if (S.playing && S.playing.detail) stop();
      S.detail = null;
      S.compare = null;
      $('#g-detail').hidden = true;
      $('#g-detail').replaceChildren();
      $('#g-scrim').hidden = true;
      const back = S.opener;
      S.opener = null;
      if (back && back.isConnected) back.focus({ preventScroll: true });
    }

    function stageBox(t, { label = false } = {}) {
      const box = h('div', { class: 'g-stage', 'data-key': t.key }, h('img', { class: 'g-poster', src: t.media.poster || null, alt: '', draggable: 'false' }));
      if (label) box.append(h('span', { class: 'g-stage-name hud' }, t.name));
      return box;
    }
    /** The families a style's type uses, display first, without a face's italic twin: at most two. */
    function familiesOf(d) {
      const seen = new Set();
      const out = [];
      const order = [...d.type.filter((x) => /display|hand|slam|title/i.test(x.role)), ...d.type];
      for (const x of order) {
        const f = String(x.family || '').replace(/\s+italic$/i, '').trim();
        if (f && !seen.has(f.toLowerCase())) { seen.add(f.toLowerCase()); out.push(f); }
      }
      return out.slice(0, 2);
    }

    function renderDetail() {
      const d = S.detail;
      if (!d) return;
      if (S.playing && S.playing.detail) stop();
      const sheet = $('#g-detail');
      const cmp = S.compare;
      const other = cmp ? S.byKey.get(cmp.other) : null;
      // the picture: the loop large; with Compare, beside another style's (or under it, as a wipe)
      const stages = h('div', { class: `g-stages${other && cmp.mode === 'side' ? ' is-side' : ''}` });
      let main;
      let others = [];
      if (other && cmp.mode === 'wipe') {
        main = stageBox(d, { label: true });
        const top = h('div', { class: 'g-wipe-top' }, h('img', { class: 'g-poster', src: other.media.poster || null, alt: '', draggable: 'false' }), h('span', { class: 'g-stage-name hud', style: null }, other.name));
        top.style.clipPath = `inset(0 0 0 ${cmp.at}%)`;
        main.append(top);
        others = [{ url: other.media.loop, host: top }];
        stages.append(main);
      } else {
        main = stageBox(d, { label: Boolean(other) });
        stages.append(main);
        if (other) {
          const box = stageBox(other, { label: true });
          stages.append(box);
          others = [{ url: other.media.loop, host: box }];
        }
      }
      // ▶ over the picture, its length in the corner (known once it has played)
      const play = h('button', { type: 'button', class: 'g-play g-play-big', 'aria-pressed': 'false', 'aria-label': `Play ${d.name}`, title: 'Play', disabled: !d.media.loop || null }, icon('i-play', PLAY), icon('i-stop', STOP));
      const time = h('span', { class: 'hud g-time' }, S.durations.get(d.key) || '');
      main.append(play, time);
      play.addEventListener('click', (e) => {
        const was = S.playing && S.playing.detail;
        stop();
        if (was) return;
        start({ key: `detail:${d.key}`, url: d.media.loop, node: main, btn: play, host: main, name: d.name, detail: true, others,
          onMeta: (sec) => { if (!Number.isFinite(sec)) return; S.durations.set(d.key, secs(sec)); if (time.isConnected) time.textContent = secs(sec); } }, e);
      });
      const kids = [stages];
      if (cmp) {
        const transport = h('div', { class: 'g-transport' });
        const pick = document.createElement('select');
        pick.className = 'g-other';
        pick.setAttribute('aria-label', 'Compare with');
        pick.append(...S.tiles.filter((t) => t.key !== d.key).map((t) => h('option', { value: t.key, selected: t.key === cmp.other || null }, t.name)));
        pick.addEventListener('change', () => { S.compare = { ...cmp, other: pick.value }; renderDetail(); });
        const seg = (mode, label) => h('button', { type: 'button', 'aria-pressed': String(cmp.mode === mode), onclick: () => { if (cmp.mode !== mode) { S.compare = { ...cmp, mode }; renderDetail(); } } }, label);
        transport.append(pick, h('span', { class: 'g-seg', role: 'group', 'aria-label': 'Compare' }, seg('side', 'Side'), seg('wipe', 'Wipe')));
        if (cmp.mode === 'wipe') {
          const range = h('input', { type: 'range', class: 'g-wipe', min: '0', max: '100', value: String(cmp.at), 'aria-label': 'Wipe' });
          range.addEventListener('input', () => { cmp.at = Number(range.value); const top = stages.querySelector('.g-wipe-top'); if (top) top.style.clipPath = `inset(0 0 0 ${cmp.at}%)`; });
          transport.append(range);
        }
        kids.push(transport);
      }
      const stageCol = h('div', { class: 'g-stagecol' }, ...kids);

      // what it is: the name and its line; the specimen (the type in its own face, the inks); the tags and the sound
      const info = h('div', { class: 'g-info-col' });
      info.append(h('div', { class: 'g-d-head' },
        h('h2', { class: 'g-d-name', id: 'g-d-name', 'data-content': d.scope === 'shipped' ? null : '' }, d.name),
        d.line ? h('p', { class: 'g-d-line', 'data-content': '' }, d.line) : null));
      const fams = familiesOf(d);
      if (fams.length || d.swatches.length) {
        const spec = h('div', { class: 'g-spec' });
        if (fams.length) {
          const aa = h('span', { class: 'g-type-aa', 'aria-hidden': 'true' }, 'Aa');
          spec.append(aa, h('span', { class: 'g-type-names', 'data-content': '' }, ...fams.map((f) => h('span', {}, f))));
          const display = (d.type.find((x) => /display|hand|slam|title/i.test(x.role)) || d.type[0] || {}).family;
          const face = d.fonts.find((f) => f.family === display) || d.fonts[0];
          loadFont(face).then((fam) => { if (fam && aa.isConnected) aa.style.fontFamily = `"${fam}", var(--font-display)`; });
        }
        if (d.swatches.length) {
          const inks = h('div', { class: 'g-swatches', role: 'list', 'aria-label': 'Palette' }, ...d.swatches.map((c) => { const sw = h('span', { class: 'g-swatch', role: 'listitem', title: c, 'aria-label': c }); sw.style.background = c; return sw; }));
          inks.style.setProperty('--g-sw-cols', String(d.swatches.length <= 3 ? d.swatches.length : Math.ceil(d.swatches.length / 2))); // one row, or two even ones
          spec.append(inks);
        }
        info.append(spec);
      }
      const tagLine = h('p', { class: 'g-tags hud' }, ...d.tags.map((x) => h('span', {}, x)));
      if (d.sound && d.sound.label) tagLine.append(h('span', { class: 'g-sound' }, `♪ ${d.sound.label}`));
      if (tagLine.childNodes.length) info.append(tagLine);

      // what may be done with it
      const acts = h('div', { class: 'g-actions' });
      if (S.pick) {
        const n = (S.pick.label || '').split(' · ')[0];
        acts.append(h('button', { type: 'button', class: 'g-btn primary', disabled: !d.can.use || null, onclick: () => useNow(d.key) }, `Use for ${n}`));
      } else acts.append(useMenu(d));
      const btn = (label, fn, on = true, title = null) => (on ? h('button', { type: 'button', class: 'g-btn', title, onclick: fn }, label) : null);
      acts.append(...[
        btn(cmp ? 'Compare ✓' : 'Compare', () => { S.compare = cmp ? null : { other: (S.tiles.find((t) => t.key !== d.key) || {}).key, mode: 'side', at: 50 }; if (!S.compare || S.compare.other) renderDetail(); }, d.can.compare && S.tiles.length > 1, 'C'),
        btn('Duplicate', () => duplicate(d), d.can.duplicate, 'A copy in Mine'),
        btn('Share', () => call('gallery', 'share', d.key).catch(fail), d.can.share),
        btn('Remove', () => remove(d), d.can.remove),
      ].filter(Boolean));
      info.append(acts);
      const foot = h('div', { class: 'g-d-foot' });
      if (d.recipe) foot.append(h('details', { class: 'g-recipe' }, h('summary', { class: 'hud' }, 'Recipe'), h('pre', { 'data-content': '' }, d.recipe)));
      if (d.credit) foot.append(h('p', { class: 'g-credit', 'data-content': '' }, d.credit));
      if (foot.childNodes.length) info.append(foot);
      const close = h('button', { type: 'button', class: 'g-close', 'aria-label': 'Close', title: 'Esc' }, '✕');
      close.addEventListener('click', closeDetail);
      sheet.replaceChildren(close, stageCol, info);
    }

    /** Use, outside pick mode: the episodes whose plan may take a style now; one becomes that episode's default. */
    function useMenu(d) {
      const wrap = h('div', { class: 'g-add-wrap' });
      const b = h('button', { type: 'button', class: 'g-btn primary', 'aria-haspopup': 'menu', 'aria-expanded': 'false', disabled: !d.can.use || null, title: 'The default style for an episode' }, 'Use ▾');
      const menu = h('div', { class: 'g-menu', role: 'menu', 'aria-label': 'Episodes', hidden: true });
      const shut = () => { menu.hidden = true; b.setAttribute('aria-expanded', 'false'); };
      b.addEventListener('click', async () => {
        if (!menu.hidden) { shut(); return; }
        let eps = [];
        try { eps = await call('gallery', 'episodes'); } catch (e) { fail(e); return; }
        menu.replaceChildren(...(eps.length ? eps.map((ep) => h('button', { type: 'button', role: 'menuitem', 'data-content': '', title: 'Its default style', onclick: async () => {
          shut();
          try { const r = await call('gallery', 'use', d.key, ep.episode); toast(`${r.name} · ${r.title || ep.title}`); } catch (e) { fail(e); }
        } }, ep.title)) : [h('p', { class: 'g-menu-empty' }, 'No episode is planning')]));
        menu.hidden = false;
        b.setAttribute('aria-expanded', 'true');
        const first = menu.querySelector('button');
        if (first) first.focus();
      });
      menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); shut(); b.focus(); } });
      wrap.append(b, menu);
      return wrap;
    }

    async function duplicate(d) {
      try {
        const t = await call('styles', 'fork', d.key);
        await load();
        toast(`${t.name} · Mine`);
        openDetail(t.key);
      } catch (e) { fail(e); }
    }
    async function remove(d) {
      let r;
      try { r = await call('styles', 'remove', d.key); } catch (e) { fail(e); return; }
      closeDetail();
      await load();
      toast(`${r.name} · Removed`, { ms: 9000, action: { label: 'Undo', run: async () => { try { await call('styles', 'restore', r.token); await load(); } catch (e) { fail(e); } } } });
    }

    // ── the top bar ──
    function setFilter(f) {
      S.filter = f;
      for (const x of document.querySelectorAll('.g-tab')) {
        const on = x.dataset.filter === f;
        x.setAttribute('aria-selected', String(on));
        x.tabIndex = on ? 0 : -1;
      }
      applyFilter();
    }
    function menuOf(button, menu) {
      const shut = () => { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); };
      button.addEventListener('click', () => {
        const open = menu.hidden;
        menu.hidden = !open;
        button.setAttribute('aria-expanded', String(open));
        if (open) { const f = menu.querySelector('button'); if (f) f.focus(); }
      });
      menu.addEventListener('keydown', (e) => {
        const items = [...menu.querySelectorAll('button')];
        const i = items.indexOf(document.activeElement);
        if (e.key === 'Escape') { e.stopPropagation(); shut(); button.focus(); }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus(); }
      });
      document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target) && e.target !== button) shut(); });
      return shut;
    }

    function observe() {
      S.offIO = new IntersectionObserver((entries) => {
        for (const e of entries) if (!e.isIntersecting && S.playing && S.playing.node === e.target) stop();
      }, { threshold: 0 });
      new ResizeObserver(queueLayout).observe($('#g-wall'));
      new ResizeObserver(measureTop).observe($('.g-top'));
      // a pointer over the wall wakes a context that slept (the window was hidden) and the warm-up before the press lands
      const wake = () => { if (S.ctx && S.ctx.state !== 'running' && !S.playing) warm(); };
      $('#g-wall').addEventListener('pointerover', wake, { passive: true });
      $('#g-wall').addEventListener('focusin', wake);
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          stop();
          unwarm();
          if (S.ctx && S.ctx.state === 'running') S.ctx.suspend().catch(() => {});
        } else warm();
      });
      document.addEventListener('keydown', (e) => {
        const el = e.target && e.target.nodeType === 1 ? e.target : null;
        const typing = Boolean(el && (el.matches('input, select, textarea') || el.isContentEditable));
        if (e.key === 'Escape') {
          if (S.playing) { stop(); return; }
          if (S.detail) { closeDetail(); return; }
          if (typing && el.id === 'g-q' && S.q) { el.value = ''; S.q = ''; applyFilter(); }
          return;
        }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#g-q').focus(); return; }
        if (typing) return;
        if (S.detail && (e.key === 'c' || e.key === 'C') && !e.metaKey && !e.ctrlKey && !e.altKey) {
          if (!S.compare) S.compare = { other: (S.tiles.find((t) => t.key !== S.detail.key) || {}).key, mode: 'side', at: 50 };
          else S.compare = { ...S.compare, mode: S.compare.mode === 'side' ? 'wipe' : 'side' };
          if (S.compare.other) renderDetail(); else S.compare = null;
          return;
        }
        if (S.detail && e.key === ' ' && !(el && el.closest('button, summary'))) {
          e.preventDefault();
          const p = $('#g-detail .g-stage .g-play');
          if (p) p.click();
        }
        if (S.detail && e.key === 'Tab') trap(e);
      });
      $('#g-scrim').addEventListener('click', closeDetail);
      // the tabs: a tablist (arrows move between them)
      const tabs = [...document.querySelectorAll('.g-tab')];
      for (const tab of tabs) {
        tab.addEventListener('click', () => setFilter(tab.dataset.filter));
        tab.addEventListener('keydown', (e) => {
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
          const shown = tabs.filter((x) => !x.hidden);
          const i = shown.indexOf(tab);
          const next = shown[(i + (e.key === 'ArrowRight' ? 1 : -1) + shown.length) % shown.length];
          next.focus();
          setFilter(next.dataset.filter);
        });
      }
      let qTimer = 0;
      $('#g-q').addEventListener('input', (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { S.q = e.target.value; applyFilter(); }, 120); });
      const shut = menuOf($('#g-add'), $('#g-add-menu'));
      $('#g-add-menu').addEventListener('click', async (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        shut();
        if (b.dataset.act === 'look') yourLook();
        if (b.dataset.act === 'file') {
          try {
            const r = await call('styles', 'importFile');
            if (r && !r.cancelled) { await load(); toast(r.unchanged ? `${r.tile.name} · already in Mine` : `${r.tile.name} · Mine`); }
          } catch (err) { fail(err); }
        }
      });
      $('#g-pick-use').addEventListener('click', () => useNow());
      $('#g-pick-leave').addEventListener('click', () => call('gallery', 'leave').then(refreshState, fail));
      $('#g-check').addEventListener('click', async () => {
        const b = $('#g-check');
        b.disabled = true;
        try {
          const r = await call('gallery', 'check');
          toast([r.added ? `${r.added} new` : null, r.revoked ? `${r.revoked} withdrawn` : null].filter(Boolean).join(' · ') || 'Up to date');
          await Promise.all([load(), refreshState()]);
        } catch (e) { fail(e); } finally { b.disabled = false; }
      });
      listen('styles', 'onChanged', reload);
      listen('gallery', 'onState', refreshState);
      // a catalog check made anywhere (W3-11's flpt.catalog, relayed by main): new Shared styles, withdrawn ones, the line
      listen('catalog', 'onChanged', () => { reload(); refreshState(); });
    }

    /** Keep Tab inside the open sheet (it's modal). */
    function trap(e) {
      const sheet = $('#g-detail');
      const items = [...sheet.querySelectorAll('button, select, input, summary, [tabindex]:not([tabindex="-1"])')].filter((n) => !n.disabled && n.getClientRects().length);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } else if (!sheet.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    }

    async function init() {
      document.documentElement.dataset.cv = 'on';
      if (has('ui', 'motion')) call('ui', 'motion').then(applyMotion, () => {});
      for (const x of document.querySelectorAll('.g-tab')) x.tabIndex = x.dataset.filter === 'all' ? 0 : -1;
      observe();
      await Promise.all([refreshState(), load(), inspiration()]);
      queueWarm();
      emit('gallery:ready', {});
    }

    // for QA (app/qa/gallery-app.cjs) and the mock: the state and the same paths a press takes
    window.FLPT_GALLERY = { S, toggleTile, stop, layout, openDetail, closeDetail, choose, useNow, reload: load, warm, playingCount: () => [...document.querySelectorAll('video')].filter((v) => !v.paused && !v.classList.contains('g-prime')).length };
    init();
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // The main window (index.html): the top bar's ◱, the inspector's STYLE slot, and the Gallery's events
  // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
  function hooks() {
    const UI = window.FLPT_UI;
    if (!UI || !UI.slots || !window.flpt || !flpt.gallery) return;
    if (!document.querySelector('link[href="gallery.css"]')) document.head.append(h('link', { rel: 'stylesheet', href: 'gallery.css' }));

    // the top bar: the Gallery from any stage (⌥⌘G from anywhere). Only where the Gallery is a window of its own (the
    // Mac); the web's overlay and the Desk are W4's.
    let canOpen = true;
    const top = UI.slots.topbar;
    const button = h('button', { type: 'button', class: 'ghost small gs-open', 'aria-label': 'Style Gallery', title: 'Style Gallery · ⌥⌘G', onclick: () => call('gallery', 'open').catch(() => {}) }, '◱');
    if (top && !top.querySelector('.gs-open')) top.append(button);
    if (has('app', 'caps')) {
      call('app', 'caps').then((caps) => {
        canOpen = !caps || caps.nativeWindows !== false;
        if (!canOpen) button.remove();
      }, () => {});
    }

    // the Storyboard inspector's STYLE slot: the shot's style; a press opens pick mode for it. It draws in its own box
    // inside the slot (whatever else is in the slot stays), and only while it has something to show, so the inspector's
    // own fallback line shows when it doesn't.
    const slot = typeof UI.slot === 'function' ? UI.slot('inspector.style') : UI.slots['inspector.style'];
    const box = h('div', { class: 'gs-style' });
    let last = null;
    let seq = 0;
    const clear = () => { box.replaceChildren(); box.remove(); };
    if (slot) {
      slot.addEventListener('inspector:shot', async (e) => {
        const d = (e && e.detail) || {};
        last = d.shot ? { episode: d.episode, shot: d.shot.id } : null;
        const my = ++seq;
        if (!d.shot || !d.episode) { clear(); return; }
        let info = null;
        try { info = await call('gallery', 'forShot', d.episode, d.shot.id); } catch { info = null; }
        if (my !== seq) return;
        if (!info || !info.style) { clear(); return; }
        const can = canOpen && d.editable !== false && info.editable !== false;
        const pic = info.poster && typeof flpt.fileUrl === 'function' ? h('img', { src: flpt.fileUrl(info.poster), alt: '', draggable: 'false' }) : h('span', { class: 'gs-none', 'aria-hidden': 'true' });
        // a style the catalog withdrew keeps rendering here with its one-line flag (W3-11); the slot says so
        const b = h('button', { type: 'button', class: `gs-pick${info.flag ? ' is-flagged' : ''}`, disabled: !can || null, 'aria-label': `Style: ${info.name}${info.flag ? `, ${info.flag}` : ''}`, title: info.flag || (can ? 'Style Gallery' : null) },
          pic, h('span', { class: 'gs-name', 'data-content': '' }, info.name), info.flag ? h('span', { class: 'gs-flag', 'aria-hidden': 'true' }, '⚑') : null, h('span', { class: 'gs-mark', 'aria-hidden': 'true' }, '◱'));
        b.addEventListener('click', () => call('gallery', 'open', { episode: d.episode, shot: d.shot.id }).catch(() => {}));
        box.replaceChildren(b);
        if (!box.isConnected) slot.append(box);
      });
    }

    // gallery:picked: the shot that just got its style, shown (the edit itself was made in main)
    listen('gallery', 'onPicked', async (p) => {
      if (!p || !p.shot) return; // an episode's default: storyboard:changed repaints what shows it
      const sb = () => UI.components && UI.components.storyboard;
      const here = () => last && last.episode === p.episode && slot && slot.isConnected && sb() && sb().view();
      if (here()) { sb().focus(p.shot); return; }
      if (typeof window.openEpisode !== 'function') return;
      try { await window.openEpisode(p.episode, 'storyboard'); } catch { return; }
      for (let i = 0; i < 40; i++) { // the panel paints, then the shot is focused
        const v = sb() && sb().view();
        if (v && Array.isArray(v.shots) && v.shots.some((s) => s.id === p.shot)) { sb().focus(p.shot); return; }
        await new Promise((r) => setTimeout(r, 50));
      }
    });
    // gallery:your-look and gallery:share: W3-02's sheets, where they are. The reference sheet takes { from, episode,
    // shot } (the pick's shot, when the Gallery was picking for one) and the place's link to capture; the Share sheet
    // takes the Mine style's id.
    listen('gallery', 'onYourLook', (x) => {
      const sheet = UI.components && UI.components.referenceSheet;
      if (sheet && typeof sheet.open === 'function') sheet.open({ from: 'gallery', link: (x && x.link) || null, episode: (x && x.episode) || null, shot: (x && x.shot) || null });
    });
    listen('gallery', 'onShare', (x) => {
      const sheet = UI.components && UI.components.shareSheet;
      if (sheet && typeof sheet.open === 'function' && x && x.id) sheet.open({ style: x.id });
    });
  }
})();
