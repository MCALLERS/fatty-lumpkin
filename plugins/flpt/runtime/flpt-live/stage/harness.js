/* harness.js · the Stage, 1.0.0 (FLPT V2, PLAN §2.5; spike K2's rulings). FLPT's trusted harness: the same bytes on
 * the Mac (a WebContentsView on flpt-stage://), the Desk and the web (an <iframe> of the preview site).
 *
 * It holds one piece of untrusted code (a Live Motion scene, a style's demo, a presenter rig) in
 * <iframe sandbox="allow-scripts"> (an opaque origin, every powerful feature off), behind a shield that takes every
 * pointer event so the piece never gets user activation. It talks to the piece with host-preview.js's postMessage
 * protocol and to its host with protocol.js's commands and events (numbers and enums only):
 *   - the Mac: the 2-function preload relay, window.flptStage { send, on };
 *   - the Desk, the web, the mock: postMessage with window.parent, as { flptStage: message }.
 *
 * The clock is the AudioContext's while sound plays (so the voice and the picture stay locked), else
 * performance.now(); every play, seek, rate or source change re-anchors it. Playing, one seek is outstanding at a time
 * (a heavy piece drops frames, never queues them); paused, the last seek wins and is drawn exactly.
 * Kill rules (any surface): a second load of the piece's frame (it navigated itself, even to an error page: K2), no
 * ready within READY_MS, no answer to a seek (playing or paused) or to a heartbeat (paused) for STALL_MS → the frame is
 * removed and error { code } sent. A host's watchdog does the rest (ticks stop whenever the piece stops answering):
 * a piece busy in a loop usually shares this harness's renderer process (sandboxed frames are not isolated on the Mac,
 * K2), so the harness stops with it and only the host's no-tick watchdog can act.
 * Only two frames are ever in #scene: the current one and, during a live reload, the newest incoming one (a newer
 * reload supersedes it), so every frame that runs is under these rules.
 * Also: the reference layer (compare.js), the overlays (overlays.js), the narration WAVs and the score (the real stem,
 * a file, or flpt-score PCM from score-worker.js), "Snapshot this frame" (the paused preview against the final
 * renderer's frame, with PSNR), and live reload (load { keep: true } swaps in the new frame and keeps t and play).
 */
(() => {
  'use strict';
  const P = window.FLPTStageProtocol, OV = window.FLPTStageOverlays, CMP = window.FLPTStageCompare;
  const T = P.TIMING, L = P.LAYOUT;
  const $ = (id) => document.getElementById(id);
  const el = { scene: $('scene'), ref: $('ref'), overlays: $('overlays'), bubble: $('bubble'), wipe: $('wipe'), shield: $('shield') };
  const base = new URL('../', location.href);
  const at = (p) => new URL(p, base).href;
  const perfNow = () => performance.now() / 1000;
  const ms = () => performance.now();
  const sleep = (n) => new Promise((r) => setTimeout(r, n));

  // ── the host ───────────────────────────────────────────────────────────────────────────────────────────────────────
  const relay = window.flptStage && typeof window.flptStage.send === 'function' ? window.flptStage : null;
  const host = window.parent !== window ? window.parent : null;
  const hostOrigin = (() => { try { const a = location.ancestorOrigins; return a && a.length && a[0] !== 'null' ? a[0] : '*'; } catch (e) { return '*'; } })();
  function emit(m) {
    const e = P.event(m);
    if (!e) return;
    if (relay) { try { relay.send(e); } catch (err) { /* main is gone */ } return; }
    if (host) { try { host.postMessage(P.wrap(e), hostOrigin); } catch (err) { /* the host is gone */ } }
  }
  // Errors are capped at 5 a second, so a piece can't flood the host with its own. The kill codes have their own budget:
  // a flood of the piece's errors never hides why the harness removed it.
  const budgets = { err: { at: 0, n: 0 }, kill: { at: 0, n: 0 } };
  function fail(code, msg) {
    const t = ms(), b = budgets[P.KILL_CODES.includes(code) ? 'kill' : 'err'];
    if (t - b.at > 1000) { b.at = t; b.n = 0; }
    if (++b.n > 5) return;
    S.errors.push(code);
    if (S.errors.length > 200) S.errors.shift();
    emit({ ev: 'error', code, msg });
  }

  // ── state ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  const S = {
    spec: null, kind: 'scene', frame: null, next: null, mountedAt: 0, ready: false, meta: null, duration: 0,
    quality: 'preview', mode: 'scene', wipeX: 0.5, overlay: { bubble: false, grid: false }, voice: 'draft', soundOn: true,
    seekId: 0, outstanding: null, sentAt: 0, want: null, draws: 0, frameMs: 0, lastAlive: 0, lastTickDraws: 0,
    kept: null, playSeq: 0, playing: false, kills: [], errors: [], snap: null, loads: 0, mounts: 0,
  };
  const clk = P.clock(perfNow);
  const ref = CMP.create(el.ref, at);

  // ── sound: the narration and the music on one AudioContext, which is also the clock while it runs ─────────────────
  const A = {
    ac: null, out: null, voice: { draft: null, filmed: null }, music: null, musicGain: 1, nodes: [], worker: null, job: 0,
    scoreKey: null, scoreSeq: 0, renders: 0, starts: 0,
    want: () => !!(S.spec && (S.spec.voices !== 'none' || S.spec.music !== 'none')),
    running() { return !!(this.ac && this.ac.state === 'running'); },
    ensure() {
      if (this.ac || !window.AudioContext) return this.ac;
      try {
        this.ac = new window.AudioContext({ latencyHint: 'interactive' });
        this.out = this.ac.createGain();
        this.out.gain.value = S.soundOn ? 1 : 0;
        this.out.connect(this.ac.destination);
        this.ac.addEventListener('statechange', () => { if (S.playing) reanchor(); });
      } catch (e) { this.ac = null; }
      return this.ac;
    },
    stop() {
      for (const n of this.nodes) { try { n.stop(); } catch (e) { /* not started */ } try { n.disconnect(); } catch (e) { /* gone */ } }
      this.nodes = [];
    },
    /** Start every source at piece time t, now (the clock was just anchored on this AudioContext). */
    start(t) {
      this.stop();
      if (!this.running() || !S.playing) return;
      const now = this.ac.currentTime, rate = clk.rate;
      this.starts++;
      const v = this.voice[S.voice] || this.voice[S.voice === 'draft' ? 'filmed' : 'draft'];
      if (v) this.play(v, t - S.spec.voiceAt, 1, rate, now);
      if (this.music) this.play(this.music, t, this.musicGain, rate, now);
    },
    play(buf, offset, gain, rate, now) {
      if (offset >= buf.duration) return;
      const src = this.ac.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      const g = this.ac.createGain();
      g.gain.value = gain;
      src.connect(g);
      g.connect(this.out);
      if (offset >= 0) src.start(now, offset); else src.start(now + -offset / rate, 0);
      this.nodes.push(src, g);
    },
    async decode(path) {
      const r = await fetch(at(path), { credentials: 'omit', cache: 'no-store' });
      if (!r.ok) throw new Error(`${path.split('/').pop()} ${r.status}`);
      return this.ac.decodeAudioData(await r.arrayBuffer());
    },
    /** Fetch and decode what the spec names; the score is rendered once the piece's hits are known (on ready). */
    async load(spec) {
      this.stop();
      this.voice = { draft: null, filmed: null };
      this.music = null;
      this.scoreKey = null;
      this.job++;
      if (!this.want() || !this.ensure()) return;
      const job = this.job;
      const voices = spec.voices === 'both' ? ['draft', 'filmed'] : spec.voices === 'none' ? [] : [spec.voices];
      if (voices.length && !voices.includes(S.voice)) S.voice = voices[0];
      const tasks = voices.map((v) => this.decode(L.voice(v)).then((b) => { if (job === this.job) this.voice[v] = b; }, () => fail('media', `voice-${v}.wav`)));
      if (spec.music === 'stem' || spec.music === 'file') {
        const p = spec.music === 'stem' ? L.stem : L.music(spec.file);
        tasks.push(this.decode(p).then((b) => { if (job === this.job) { this.music = b; this.musicGain = 1; } }, () => fail('media', p.split('/').pop())));
      }
      await Promise.all(tasks);
      if (job === this.job && S.playing) reanchor();
    },
    /**
     * The Score before the real stem exists: flpt-score in a Worker (score-worker.js), with the piece's hits. Rendered
     * again only when what it is made of changed (the piece's length or hits; the preset, seed and sfx are media keys,
     * so a change there reloads the sound first): a live reload of the same piece leaves the playing score alone.
     */
    async score(spec, meta) {
      if (spec.music !== 'score') return;
      const key = JSON.stringify([meta.duration, meta.hits]);
      if (key === this.scoreKey || !this.ensure()) return;
      this.scoreKey = key;
      const job = this.job, id = ++this.scoreSeq;
      const current = () => job === this.job && id === this.scoreSeq;
      let preset;
      try {
        const r = await fetch(at(L.preset(spec.preset)), { credentials: 'omit', cache: 'no-store' });
        preset = await r.json();
      } catch (e) { if (current()) { this.scoreKey = null; fail('media', `${spec.preset}.json`); } return; }
      if (!current()) return;
      if (!this.worker) {
        try { this.worker = new Worker('score-worker.js'); } catch (e) { this.scoreKey = null; fail('score', 'no worker'); return; }
      }
      const hits = (meta.hits || []).slice(0, 500);
      const pcm = await new Promise((done) => {
        const on = (e) => { const d = e.data || {}; if (d.id !== id) return; this.worker.removeEventListener('message', on); done(d); };
        this.worker.addEventListener('message', on);
        this.worker.postMessage({ op: 'render', id, preset, seconds: meta.duration, seed: spec.seed, sfx: spec.sfx, hits, sampleRate: this.ac.sampleRate, voiced: spec.voices !== 'none' });
      });
      if (!current()) return;
      if (pcm.op !== 'pcm') { this.scoreKey = null; fail('score', pcm.msg); return; }
      const buf = this.ac.createBuffer(2, pcm.left.length, pcm.sampleRate);
      buf.copyToChannel(pcm.left, 0);
      buf.copyToChannel(pcm.right, 1);
      this.music = buf;
      this.musicGain = Number.isFinite(pcm.gain) ? pcm.gain : 0.5;
      this.renders++;
      if (S.playing) reanchor();
    },
  };
  const clockSource = () => (A.running() && A.want() ? () => A.ac.currentTime : perfNow);
  function reanchor() {
    clk.anchor(clockSource());
    A.start(clk.time());
  }

  // ── the piece's frame ──────────────────────────────────────────────────────────────────────────────────────────────
  const pageNonce = () => { const a = new Uint32Array(2); crypto.getRandomValues(a); return String(a[0] % 1e6 * 1e6 + (a[1] % 1e6)).slice(0, 12); };
  function mount() {
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts');
    f.setAttribute('allow', P.FRAME_ALLOW);
    f.setAttribute('referrerpolicy', 'no-referrer');
    f.setAttribute('loading', 'eager');
    f.setAttribute('tabindex', '-1');
    f.setAttribute('aria-hidden', 'true');
    f.setAttribute('scrolling', 'no');
    f.src = `${at(L.page)}?r=${pageNonce()}`;
    let loads = 0;
    // The frame loads exactly once. A second load means the piece navigated itself (or was navigated), even to an
    // error page: remove it at once and say so (on the Mac, main also kills the Stage).
    f.addEventListener('load', () => { S.loads++; if (++loads > 1) kill('second-load', f); });
    f.__mountedAt = ms();
    f.__seq = ++S.mounts;
    return f;
  }
  const drop = (f) => { try { f.remove(); } catch (e) { /* gone */ } };
  function unmountFrames() {
    for (const f of [S.frame, S.next]) if (f) drop(f);
    S.frame = null; S.next = null; S.ready = false; S.outstanding = null; S.want = null;
  }
  /** Only the current frame and the incoming one of a live reload are ever in #scene: anything else goes at once. */
  function sweep() {
    for (const f of el.scene.querySelectorAll('iframe')) if (f !== S.frame && f !== S.next) drop(f);
  }
  /** Remove the piece (a kill rule fired, or f is a frame that navigated) and tell the host. */
  function kill(code, f) {
    if (f && f !== S.frame && f !== S.next) { drop(f); return; }   // a frame already superseded: gone, nothing to report
    if (f && f === S.next && S.frame) {      // the incoming frame of a live reload: drop it, keep the current one
      drop(S.next); S.next = null; S.kills.push({ code, at: Date.now() }); fail(code, 'reload'); return;
    }
    unmountFrames();
    stopPlaying();
    S.kills.push({ code, at: Date.now() });
    fail(code, '');
    layout();
  }

  const MEDIA_KEYS = ['voices', 'voiceAt', 'music', 'file', 'preset', 'seed', 'sfx', 'ref', 'refExt', 'refImageExt', 'refFrames', 'refOffset', 'refLoop', 'bubble'];
  function load(spec) {
    const keep = spec.keep && S.spec && S.frame && S.ready;
    // a live reload whose sound, reference and bubble are unchanged (the crew edited the piece): they play on untouched
    const media = !(keep && MEDIA_KEYS.every((k) => S.spec[k] === spec[k]));
    S.kept = keep ? { t: clk.time(), playing: S.playing } : null;
    S.spec = spec;
    S.kind = spec.kind;
    leaveSnapshot();
    if (!keep) { stopPlaying(); unmountFrames(); clk.seek(0); }
    if (media) { ref.load(spec); A.load(spec); placeBubble(spec); }
    if (spec.kind === 'ref') { refOnly(spec); layout(); return; }
    const f = mount();
    if (keep) {
      // a reload that arrives before the previous incoming frame is ready supersedes it (not a kill): only the newest
      // edit is mounted, so no frame ever runs outside the harness's rules
      if (S.next) { drop(S.next); S.next = null; }
      f.classList.add('loading'); S.next = f; el.scene.appendChild(f);
    } else { S.frame = f; S.mountedAt = ms(); el.scene.replaceChildren(f); }
    sweep();
    layout();
  }
  /** kind 'ref': the reference alone, its own clock. */
  function refOnly(spec) {
    const go = () => {
      const d = ref.duration() || 10;
      S.duration = d; clk.duration = d; S.ready = true; S.lastAlive = ms();
      emit({ ev: 'ready', kind: 'ref', duration: d, fps: P.FPS, beats: [], keyframes: [] });
      clk.seek(spec.t);
    };
    if (ref.video && !(ref.video.readyState >= 1)) ref.video.addEventListener('loadedmetadata', go, { once: true }); else go();
  }

  function onReady(f, meta) {
    if (f.__ready) return;                                // once per frame: a piece can't make the harness redo its work
    f.__ready = true;
    const m = meta && typeof meta === 'object' ? meta : {};
    const d = Number(m.duration);
    if (!(d > 0 && d <= 86400)) { kill('bad-ready', f); return; }
    if (f === S.next) {                                   // a live reload: the new frame takes over
      if (S.frame) S.frame.remove();
      S.frame = f; S.next = null; f.classList.remove('loading');
    }
    S.mountedAt = f.__mountedAt;
    S.ready = true;
    S.lastAlive = ms();
    S.outstanding = null;
    S.meta = {
      duration: d, hold: Number(m.hold) || 0, placement: typeof m.placement === 'string' ? m.placement : null,
      hits: (Array.isArray(m.hits) ? m.hits.slice(0, 2000) : []).filter((h) => h && Number.isFinite(h.t) && typeof h.kind === 'string').slice(0, 500)
        .map((h) => ({ t: h.t, kind: h.kind.slice(0, 16), gain: Number.isFinite(h.gain) ? h.gain : 0 })),
    };
    S.duration = d;
    clk.duration = d;
    emit(P.readyFrom(S.kind, m));
    A.score(S.spec, S.meta);
    drawOverlays();
    const kept = S.kept;
    S.kept = null;
    if (kept) {
      if (!S.playing) clk.seek(kept.t);                   // playing, the clock never stopped: the new frame joins it
      requestDraw(clk.time());
      if (kept.playing && !S.playing) play();
    } else {
      clk.seek(Math.min(S.spec.t, d));
      requestDraw(clk.time());
      if (S.autoplay) { S.autoplay = false; play(); }
    }
  }

  // ── messages from the piece (only its own frame's window; anything else is ignored) ───────────────────────────────
  let snapWait = null;
  function fromPiece(e) {
    const f = S.frame && e.source === S.frame.contentWindow ? S.frame : S.next && e.source === S.next.contentWindow ? S.next : null;
    if (!f) return;
    const d = e.data;
    if (!d || typeof d !== 'object' || d.flpt !== 'live' || typeof d.op !== 'string') return;
    if (f === S.frame) S.lastAlive = ms();
    switch (d.op) {
      case 'ready': onReady(f, d.meta); break;
      case 'drawn':
        if (f !== S.frame || d.id !== S.outstanding) break;
        S.outstanding = null;
        S.draws++;
        S.frameMs = Number.isFinite(d.ms) ? d.ms : 0;
        if (S.want != null) { const t = S.want; S.want = null; requestDraw(t); }
        break;
      case 'pixels':
        if (f === S.frame && snapWait && d.id === snapWait.id) snapWait.done(d);
        break;
      case 'error':
        fail(`piece-${['setup', 'frame', 'script'].includes(d.code) ? d.code : 'other'}`, d.msg);
        // a draw that threw answers its seek (host-preview sends 'error' instead of 'drawn'): the next one goes out,
        // so one bad frame never stalls the piece; a piece that throws on every frame draws nothing and gets no ticks
        if (d.code === 'frame' && f === S.frame && S.outstanding != null) {
          S.outstanding = null;
          if (S.want != null) { const t = S.want; S.want = null; requestDraw(t); }
        }
        break;
      default: break;
    }
  }

  /** One seek outstanding at a time, never re-sent: until it is answered the newest wish waits in S.want, and S.sentAt
   *  stays the time it went out, so a piece that stops answering is removed at STALL_MS, playing or paused. */
  function requestDraw(t) {
    const f = S.frame;
    if (!S.ready || !f || !f.contentWindow) return;
    if (S.outstanding != null) { S.want = t; return; }
    S.outstanding = ++S.seekId;
    S.sentAt = ms();
    S.want = null;
    f.contentWindow.postMessage({ flpt: 'live', op: 'seek', id: S.outstanding, t, quality: S.quality }, '*');
  }

  // ── transport ──────────────────────────────────────────────────────────────────────────────────────────────────────
  async function play() {
    if (!S.spec) return;
    if (!S.ready) { S.autoplay = true; return; }
    leaveSnapshot();
    const my = ++S.playSeq;
    if (clk.from >= S.duration - 1e-6) clk.seek(0);
    const t = clk.time();
    const prime = [ref.start(t, clk.rate)];
    if (A.want() && A.ensure()) prime.push(Promise.race([A.ac.resume().catch(() => {}), sleep(300)]));
    if (bubbleSync) prime.push(bubbleSync.start(t, clk.rate));
    await Promise.all(prime);
    if (my !== S.playSeq || !S.ready) return;            // paused, seeked or unloaded meanwhile
    S.playing = true;
    clk.anchor(clockSource());
    clk.play();
    A.start(clk.time());
  }
  function stopPlaying() {
    S.playSeq++;
    if (S.playing) clk.pause();
    S.playing = false;
    A.stop();
    ref.pause();
    if (bubbleSync) bubbleSync.el.pause();
  }
  function pause() { stopPlaying(); requestDraw(clk.time()); syncMedia(); }
  function seek(t) {
    leaveSnapshot();
    clk.seek(t);
    if (S.playing) { clk.anchor(clockSource()); A.start(clk.time()); }
    requestDraw(clk.time());
    syncMedia();
  }
  function setRate(x) {
    clk.setRate(x);
    if (S.playing) reanchor();
  }

  // ── the frame loop: draw, keep the videos on the clock, stop at the end ───────────────────────────────────────────
  let bubbleSync = null;
  function syncMedia() {
    const t = clk.time();
    ref.sync(t, S.playing, clk.rate);
    if (bubbleSync) bubbleSync.sync(t, S.playing, clk.rate);
  }
  function frame() {
    if (S.playing) {
      if (clk.ended()) { stopPlaying(); clk.seek(S.duration); requestDraw(S.duration); }
      else requestDraw(clk.time());
      syncMedia();
    }
  }
  let rafQueued = false;
  const onRaf = () => { rafQueued = false; frame(); };
  setInterval(() => { if (!rafQueued) { rafQueued = true; requestAnimationFrame(onRaf); } }, 8);
  setInterval(() => { if (rafQueued && document.hidden) { rafQueued = false; frame(); } }, 33);   // a hidden view gets no animation frames

  // ── liveness: ticks while the piece answers; a heartbeat while paused; the harness's own kill rules ───────────────
  setInterval(() => {
    if (!S.ready) return;
    const now = ms();
    const drew = S.draws > S.lastTickDraws;
    const alive = S.kind === 'ref' || (S.playing ? drew : now - S.lastAlive < T.STALL_MS / 2);
    if (alive) emit({ ev: 'tick', t: clk.time(), fps: ((S.draws - S.lastTickDraws) * 1000) / T.TICK_MS, frameMs: S.frameMs, playing: S.playing });
    S.lastTickDraws = S.draws;
  }, T.TICK_MS);
  setInterval(() => {
    sweep();
    const f = S.frame;
    if (f && !S.ready && f.contentWindow) {
      if (ms() - f.__mountedAt > T.READY_MS) kill('no-ready', f);
      else f.contentWindow.postMessage({ flpt: 'live', op: 'meta', id: 'hb' }, '*');   // host-preview answers once it's ready
      return;
    }
    if (!f || !S.ready || !f.contentWindow) return;
    const now = ms();
    if (S.outstanding != null && now - S.sentAt > T.STALL_MS) { kill('no-draw', f); return; }
    if (!S.playing && S.outstanding == null) {
      if (now - S.lastAlive > T.STALL_MS) { kill('no-answer', f); return; }
      f.contentWindow.postMessage({ flpt: 'live', op: 'meta', id: 'hb' }, '*');
    }
    if (S.next && now - S.next.__mountedAt > T.READY_MS) kill('no-ready', S.next);
  }, T.HEARTBEAT_MS);

  // ── layout, overlays, the presenter bubble, the wipe ───────────────────────────────────────────────────────────────
  let boxes = null;
  const put = (node, b) => { node.style.left = `${b.x}px`; node.style.top = `${b.y}px`; node.style.width = `${b.w}px`; node.style.height = `${b.h}px`; };
  function layout() {
    const w = window.innerWidth, h = window.innerHeight;
    const snap = ref.snapshotShown();
    const hasRef = snap || ref.has();
    const mode = snap ? 'side' : S.kind === 'ref' ? 'scene' : S.mode;
    boxes = P.layout(mode, w, h, { hasRef });
    if (S.kind === 'ref') boxes = { scene: boxes.scene, ref: boxes.scene };
    put(el.scene, boxes.scene);
    el.scene.hidden = S.kind === 'ref';
    for (const f of el.scene.querySelectorAll('iframe')) f.style.transform = `scale(${boxes.scene.scale})`;
    put(el.overlays, boxes.scene);
    el.ref.hidden = !boxes.ref;
    if (boxes.ref) put(el.ref, boxes.ref);
    const wiping = mode === 'wipe' && !!boxes.ref && S.kind !== 'ref';
    el.ref.style.clipPath = wiping ? `inset(0 ${((1 - S.wipeX) * 100).toFixed(3)}% 0 0)` : '';
    el.ref.classList.toggle('over', wiping);
    el.wipe.hidden = !wiping;
    if (wiping) put(el.wipe, { x: boxes.scene.x + S.wipeX * boxes.scene.w, y: boxes.scene.y, w: 2, h: boxes.scene.h });
    el.shield.classList.toggle('wiping', wiping);
    OV.placeBubble(el.bubble, boxes.scene);
    drawOverlays();
  }
  const isDuet = () => (S.spec && S.spec.placement === 'duet') || (S.meta && S.meta.placement === 'duet');
  function drawOverlays() {
    if (!boxes) return;
    OV.draw(el.overlays, boxes.scene, { grid: S.overlay.grid, keepOut: S.overlay.grid && isDuet() });
    el.bubble.hidden = !(S.overlay.bubble && isDuet() && S.spec && S.spec.bubble !== 'none' && S.kind !== 'ref');
  }
  function placeBubble(spec) {
    if (bubbleSync) { bubbleSync.el.pause(); bubbleSync = null; }
    el.bubble.replaceChildren();
    if (spec.bubble === 'clip' || spec.bubble === 'both') {
      const v = CMP.quietVideo(at(L.bubbleClip), false);
      el.bubble.appendChild(v);
      bubbleSync = CMP.syncedVideo(v, { offset: -spec.voiceAt });
    } else if (spec.bubble === 'still') {
      const img = document.createElement('img');
      img.alt = '';
      img.src = at(L.bubbleStill);
      el.bubble.appendChild(img);
    }
  }
  window.addEventListener('resize', layout);
  // The wipe is dragged on the shield (trusted), never on the piece.
  let dragging = false;
  const wipeTo = (x) => { if (!boxes) return; S.wipeX = Math.max(0, Math.min(1, (x - boxes.scene.x) / boxes.scene.w)); layout(); };
  el.shield.addEventListener('pointerdown', (e) => { if (!el.shield.classList.contains('wiping')) return; dragging = true; el.shield.setPointerCapture(e.pointerId); wipeTo(e.clientX); });
  el.shield.addEventListener('pointermove', (e) => { if (dragging) wipeTo(e.clientX); });
  el.shield.addEventListener('pointerup', () => { dragging = false; });
  el.shield.addEventListener('pointercancel', () => { dragging = false; });

  // ── Snapshot this frame: the paused preview beside the final renderer's frame (media/snapshot.png), with PSNR ─────
  function leaveSnapshot() { if (ref.snapshotShown()) { ref.showSnapshot(null); S.snap = null; layout(); } }
  async function snapshot(t) {
    stopPlaying();
    clk.seek(t);
    requestDraw(clk.time());
    const f = S.frame;
    if (!f || !S.ready) { fail('snapshot', 'no piece'); return; }
    const id = `snap${++S.seekId}`;
    const px = await new Promise((done) => {
      snapWait = { id, done };
      f.contentWindow.postMessage({ flpt: 'live', op: 'pixels', id, t: clk.time() }, '*');
      setTimeout(() => done(null), 8000);
    });
    snapWait = null;
    if (!px || px.w !== P.W || px.h !== P.H || !(px.data instanceof ArrayBuffer) || px.data.byteLength !== P.W * P.H * 4) { fail('snapshot', 'no pixels'); return; }
    const url = `${at(L.snapshot)}?f=${Math.round(t * P.FPS)}`;
    const img = new Image();
    // onload, set before src: decode() never settles in a page that isn't drawn (a hidden window, a locked screen)
    const loaded = new Promise((ok) => { img.onload = () => ok(true); img.onerror = () => ok(false); setTimeout(() => ok(false), 8000); });
    img.src = url;
    if (!(await loaded)) { fail('snapshot', 'snapshot.png'); return; }
    if (img.naturalWidth !== P.W || img.naturalHeight !== P.H) { fail('snapshot', 'size'); return; }
    const c = document.createElement('canvas');
    c.width = P.W; c.height = P.H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const psnr = P.psnr(new Uint8ClampedArray(px.data), g.getImageData(0, 0, P.W, P.H).data);
    S.snap = { t: clk.time(), psnr };
    ref.showSnapshot(url);
    layout();
    emit({ ev: 'snapshot', t: clk.time(), psnr });
  }

  // ── commands ───────────────────────────────────────────────────────────────────────────────────────────────────────
  function command(raw) {
    const c = P.command(raw);
    if (!c) return;
    switch (c.cmd) {
      case 'load': load(c); break;
      case 'unload': stopPlaying(); unmountFrames(); ref.clear(); A.stop(); S.spec = null; el.scene.replaceChildren(); layout(); break;
      case 'play': play(); break;
      case 'pause': pause(); break;
      case 'seek': seek(c.t); break;
      case 'rate': setRate(c.x); break;
      case 'quality': S.quality = c.quality; requestDraw(clk.time()); break;
      case 'mode': S.mode = c.mode; leaveSnapshot(); layout(); break;
      case 'wipe': S.wipeX = c.x; layout(); break;
      case 'overlay': S.overlay = { bubble: c.bubble, grid: c.grid }; drawOverlays(); break;
      case 'voice': S.voice = c.voice; if (S.playing) reanchor(); break;
      case 'sound': S.soundOn = c.on; if (A.out) A.out.gain.value = c.on ? 1 : 0; break;
      case 'snapshot': snapshot(c.t); break;
      default: break;
    }
  }
  if (relay && typeof relay.on === 'function') relay.on(command);
  window.addEventListener('message', (e) => {
    if (!relay && host && e.source === host) { const m = P.unwrap(e.data); if (m) command(m); return; }
    fromPiece(e);
  });

  // QA: a read-only view of the harness (the piece can't reach it: an opaque origin; nor can a cross-origin host).
  Object.defineProperty(window, '__stage', {
    value: Object.freeze({
      version: P.VERSION,
      state: () => ({
        kind: S.kind, ready: S.ready, playing: S.playing, t: clk.time(), duration: S.duration, mode: S.mode, quality: S.quality,
        draws: S.draws, frameMs: S.frameMs, loads: S.loads, kills: S.kills.slice(), errors: S.errors.slice(), clock: A.running() && A.want() ? 'audio' : 'perf',
        frames: el.scene.querySelectorAll('iframe').length, mounts: S.mounts, seq: S.frame ? S.frame.__seq : 0, next: !!S.next,
        overlay: { ...S.overlay }, wipeX: S.wipeX, voice: S.voice,
        sound: { on: S.soundOn, voices: Object.keys(A.voice).filter((k) => A.voice[k]), music: !!A.music, musicGain: A.musicGain, nodes: A.nodes.length, renders: A.renders, starts: A.starts },
        ref: { kind: ref.kind, error: ref.error, seeks: ref.sv ? ref.sv.seeks : 0 }, snap: S.snap,
        boxes: boxes && { scene: { ...boxes.scene }, ref: boxes.ref ? { ...boxes.ref } : null },
      }),
      drift: () => ref.drift(clk.time()),
      bubbleDrift: () => (bubbleSync ? bubbleSync.drift(clk.time()) : null),
    }),
  });
  layout();
})();
