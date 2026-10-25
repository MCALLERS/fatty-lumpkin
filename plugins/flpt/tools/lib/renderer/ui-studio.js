'use strict';
/* global flpt, el, TOOL_LABEL */
// ui-studio.js · the Studio (PLAN §2.5, §3.3 S8b, draft-ux S8b simplified; W2-05): one Live Motion piece, full-bleed
// over the window, on the Stage, live. FLPT_UI.components.studio:
//   open({ dir, key, pieces, from, approved }) · close() · isOpen() · current() → { dir, key, piece, view } · on(fn) → unsubscribe
//             approved: Live Motion is approved (the wall's stage), as main's piece also says (stageApproved): then the
//             Studio only shows, as the wall does: its takes still, no Ask for changes, Again or Approve
//   state()   what the Studio shows and has told the Stage (QA and tests)
// The view, top to bottom: ← Live Motion · the piece (number · kind · style · length) · Compare (Side · Wipe, only when
// the piece has a reference) · the Stage (FLPT_UI.anchor('stage'): ui-stage.js keeps the native view over it) · the
// transport (▶, the scrubber with the beats' ticks, the time) · while its crew writes, ● WRITING and the crew's latest
// line · v1 v2 … (its takes) · Ask for changes · Again · Approve · ⋯. The ⋯ panel (beside the Stage, never over it):
// Bubble (a Duet) · Grid · Sound (on or off, and the sound picker, whose ▶ plays the piece itself with that sound) ·
// Draft · Filmed (once the film's voice exists) · the studio.more slot (W3-02's Save as style) · Snapshot this frame.
// Keys (labels only in tooltips): Space play · , . one frame · ⇧← ⇧→ the previous or next beat · ← → the previous or
// next piece · C compare (side ↔ wipe) · B bubble · G grid · M sound · Esc back.
// A piece of the animators' (0.7.1's marked slides) opens as its preview clip: no Stage, no takes; Ask for changes and
// Again run its animator.
// Slot fillers hear 'studio:piece' on the studio.more slot ({ episode, key, piece, view, editable }) each time a piece
// opens or changes. The Stage plays on ▶ whatever Pause motion says (it is never gated on FLPT_UI.motionHeld); the
// Proxy (half resolution) switches itself on when a scene can't keep up, and nothing shows it.
(() => {
  const UI = window.FLPT_UI;
  if (!UI || !UI.components) return;

  const FPS = 30;
  const SLOW_FPS = 22; // below this while playing, three ticks running: the Proxy goes on
  const KIND = { solo: 'Solo', duet: 'Duet', cosmos: 'Cosmos in code', interstitial: 'Solo ♪', cutscene: 'Cut scene in code' };
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmt = (t) => { const s = Math.max(0, Number(t) || 0); const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`; };
  const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`;
  const unwrap = async (p) => { const r = await p; if (!r || !r.ok) throw new Error((r && r.error) || 'Something went wrong.'); return r.value; };
  const styleName = (id) => String(id || '').replace(/-/g, ' ');
  const numberOf = (v) => (v.n ? pad2(v.n) : String(v.id || ''));
  // the scene crews' own tools; the rest say what the job log says (episodes.js's TOOL_LABEL)
  const SCENE_TOOLS = { start_scene: 'Setting up the scene', use_reference: 'Bringing in the reference', use_previous_frame: 'Taking the frame before', align_music: 'Timing the music',
    lint_scene: 'Checking the scene', contact_sheet: 'Making a contact sheet', compare_with_reference: 'Comparing with the reference', check_bubble: 'Checking the corner',
    listen: 'Listening', done: 'Finishing', render_slide: 'Rendering' };
  const toolLine = (ev) => {
    const raw = String(ev.name || '');
    const name = raw.split(/__|\./).pop(); // mcp__flpt__align_beats, flpt.align_beats → align_beats
    const shared = typeof TOOL_LABEL === 'object' && TOOL_LABEL ? TOOL_LABEL[raw] || TOOL_LABEL[name] || TOOL_LABEL[`flpt.${name}`] : null;
    const label = shared || SCENE_TOOLS[name];
    return label ? `${label}…` : null;
  };
  /** The crew's latest line from one of its events: its words, else what its tool is doing. */
  const lineOf = (ev) => {
    if (!ev) return null;
    if (ev.kind === 'text' && ev.text) return String(ev.text).replace(/\s+/g, ' ').trim().slice(0, 140);
    if (ev.kind === 'tool') return toolLine(ev);
    if (ev.kind === 'note' && ev.text) return String(ev.text).slice(0, 140);
    return null;
  };
  UI.components.crewLine = lineOf; // the wall's cards say the same

  // ── state ──
  const blank = () => ({
    open: false, dir: null, key: null, pieces: [], view: null, info: null, kind: 'scene', from: null, approved: false,
    st: { ready: false, duration: 0, beats: [], keyframes: [], t: 0, playing: false, fps: 0, at: 0, killed: null },
    mode: 'scene', overlay: { bubble: false, grid: false }, sound: true, voice: 'draft', quality: 'preview', slow: 0,
    more: false, busy: '', line: '', note: '', bad: false, snap: '', preview: null, wantPlay: false, scrubbing: false, asked: '',
  });
  let S = blank();
  const subs = new Set();
  const tell = (what) => { for (const fn of subs) { try { fn(what, current()); } catch (e) { console.error(e); } } }; // eslint-disable-line no-console
  const current = () => (S.open ? { dir: S.dir, key: S.key, piece: S.info, view: S.view } : null);
  const stage = () => UI.components.stage || null;
  const send = (cmd) => { const s = stage(); return s ? s.send(cmd).catch(() => false) : Promise.resolve(false); };
  /** Live Motion approved (the wall said so, or main): the Studio only shows. */
  const locked = () => Boolean(S.approved || (S.info && S.info.stageApproved));
  // Ask for changes on a scene needs flpt.livemotion.run to take notes (main says so with each piece: asks); until it
  // does, notes would be dropped on a run that costs, so only Again shows. Remembered across pieces: it's the host's.
  let asks = null;
  const canAsk = () => S.kind === 'clip' || asks === true;

  // ── the DOM: built once per open; parts updated in place (the Stage's anchor never moves between rebuilds) ──
  let root = null;
  const R = {}; // its parts
  const btn = (label, attrs = {}) => el('button', { type: 'button', ...attrs }, label);
  const pressed = (b, on) => { if (b) b.setAttribute('aria-pressed', String(Boolean(on))); };

  function build() {
    R.back = btn('← Live Motion', { class: 'ghost small studio-back', title: 'Esc', onclick: () => close() });
    R.title = el('span', { class: 'hud studio-title' });
    R.chip = el('span', { class: 'chip studio-chip', hidden: true });
    R.compare = btn('Compare', { class: 'ghost small', 'aria-pressed': 'false', title: 'C', onclick: () => setMode(S.mode === 'scene' ? 'side' : 'scene') });
    R.side = btn('Side', { class: 'ghost small', 'aria-pressed': 'false', onclick: () => setMode('side') });
    R.wipe = btn('Wipe', { class: 'ghost small', 'aria-pressed': 'false', onclick: () => setMode('wipe') });
    R.modes = el('span', { class: 'studio-seg', hidden: true }, R.side, R.wipe);
    R.compareBox = el('div', { class: 'studio-compare', hidden: true }, R.compare, R.modes);
    const head = el('header', { class: 'studio-head' }, R.back, R.title, R.chip, el('span', { class: 'studio-gap' }), R.compareBox);

    R.anchor = UI.anchor('stage', { class: 'studio-anchor' });
    R.clip = el('video', { class: 'studio-clip', playsinline: true, preload: 'auto', hidden: true });
    R.clip.addEventListener('timeupdate', () => { if (S.kind === 'clip') { S.st.t = R.clip.currentTime; paintTime(); } });
    R.clip.addEventListener('loadedmetadata', () => { if (S.kind === 'clip') { S.st.duration = R.clip.duration || 0; S.st.ready = true; paintTransport(); } });
    for (const ev of ['play', 'pause', 'ended']) R.clip.addEventListener(ev, () => { if (S.kind === 'clip') { S.st.playing = !R.clip.paused; paintTransport(); } });
    R.empty = el('p', { class: 'studio-empty muted', hidden: true, 'data-content': '' });
    R.stageBox = el('div', { class: 'studio-stage' }, R.anchor, R.clip, R.empty);

    R.more = el('aside', { class: 'studio-more', hidden: true, 'aria-label': 'More' });
    const body = el('div', { class: 'studio-body' }, R.stageBox, R.more);

    R.play = btn('▶', { class: 'studio-play', 'aria-label': 'Play', title: 'Space', onclick: () => togglePlay() });
    R.scrub = el('input', { type: 'range', class: 'studio-scrub', min: '0', max: '1', step: String(1 / FPS), value: '0', 'aria-label': 'Time' });
    R.scrub.addEventListener('input', () => { S.scrubbing = true; seek(Number(R.scrub.value)); });
    R.scrub.addEventListener('change', () => { S.scrubbing = false; });
    R.ticks = el('div', { class: 'studio-ticks', 'aria-hidden': 'true' });
    R.time = el('span', { class: 'hud studio-time' });
    const track = el('div', { class: 'studio-track' }, R.scrub, R.ticks);
    const transport = el('div', { class: 'studio-transport' }, R.play, track, R.time);

    R.lineChip = el('span', { class: 'hud studio-writing' }, '● WRITING');
    R.lineText = el('span', { 'data-content': '' });
    R.line = el('p', { class: 'studio-line', hidden: true, role: 'status' }, R.lineChip, R.lineText);
    R.takes = el('div', { class: 'studio-takes', role: 'group', 'aria-label': 'Takes' });
    R.ask = el('input', { type: 'text', class: 'studio-ask', maxlength: '2000', placeholder: 'Ask for changes…', 'aria-label': 'Ask for changes' });
    R.askGo = btn('Ask', { class: 'ghost small', hidden: true, onclick: () => ask() });
    R.askBox = el('div', { class: 'studio-askbox' }, R.ask, R.askGo);
    R.ask.addEventListener('input', () => { R.askGo.hidden = !R.ask.value.trim(); });
    R.ask.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ask(); } });
    R.again = btn('Again', { class: 'ghost', onclick: () => again() });
    R.stop = btn('Stop', { class: 'ghost', hidden: true, title: 'Every crew at work', onclick: () => stop() }); // flpt.livemotion.cancel is the episode's
    R.approve = btn('Approve', { class: 'primary', onclick: () => approve() });
    R.dots = btn('⋯', { class: 'ghost studio-dots', 'aria-label': 'More', 'aria-expanded': 'false', onclick: () => toggleMore() });
    const foot = el('div', { class: 'studio-foot' }, R.takes, R.askBox, R.again, R.stop, R.approve, R.dots);

    root = el('div', { class: 'studio', 'data-realm': 'theater', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Studio' }, head, body, transport, R.line, foot);
    buildMore();
    return root;
  }

  function buildMore() {
    R.bubble = btn('Bubble', { class: 'ghost small', 'aria-pressed': 'false', title: 'B', onclick: () => setOverlay({ bubble: !S.overlay.bubble }) });
    R.grid = btn('Grid', { class: 'ghost small', 'aria-pressed': 'false', title: 'G', onclick: () => setOverlay({ grid: !S.overlay.grid }) });
    R.soundBtn = btn('Sound', { class: 'ghost small', 'aria-pressed': 'true', title: 'M', onclick: () => setSound(!S.sound) });
    R.picker = el('div', { class: 'studio-picker' });
    R.draft = btn('Draft', { class: 'ghost small', 'aria-pressed': 'true', onclick: () => setVoice('draft') });
    R.filmed = btn('Filmed', { class: 'ghost small', 'aria-pressed': 'false', onclick: () => setVoice('filmed') });
    R.voices = el('span', { class: 'studio-seg', hidden: true }, R.draft, R.filmed);
    R.snapBtn = btn('Snapshot this frame', { class: 'ghost small', title: 'The final renderer\'s frame, beside the paused preview', onclick: () => snapshot() });
    R.slot = UI.slot('studio.more');
    R.slot.classList.add('studio-slot');
    R.overlays = el('div', { class: 'studio-row' }, R.bubble, R.grid);
    R.more.append(R.overlays, el('div', { class: 'studio-row' }, R.soundBtn), R.picker, R.voices, R.slot, el('div', { class: 'studio-row' }, R.snapBtn));
  }

  // ── painting ──
  function paint() {
    if (!root) return;
    if (S.info && typeof S.info.asks === 'boolean') asks = S.info.asks;
    const v = S.view || {};
    const info = S.info || {};
    const dur = S.st.duration || info.duration || 0;
    const kindLabel = KIND[v.kind] || v.tile || '';
    R.title.textContent = [numberOf(v), kindLabel, (info.style || (v.style && v.style.id)) ? styleName(info.style || v.style.id) : null, dur ? fmt(dur).replace(/\.\d+$/, '') : null].filter(Boolean).join(' · ');
    const chip = chipOf(v);
    R.chip.hidden = !chip;
    if (chip) { R.chip.textContent = chip[0]; R.chip.className = `chip studio-chip ${chip[1]}`; }
    R.chip.title = chip && chip[2] ? chip[2] : ''; // what the checks found (text, pacing), on hover
    const hasRef = S.kind === 'scene' && Boolean(info.reference);
    R.compareBox.hidden = !hasRef;
    pressed(R.compare, S.mode !== 'scene');
    R.modes.hidden = S.mode === 'scene';
    pressed(R.side, S.mode === 'side');
    pressed(R.wipe, S.mode === 'wipe');
    R.anchor.hidden = S.kind !== 'scene';
    R.clip.hidden = S.kind !== 'clip';
    R.empty.hidden = !S.note || S.kind === 'clip' || S.st.ready;
    R.empty.textContent = S.bad ? S.note : '';
    // the crew at work on this piece, or a message
    const writing = running();
    R.line.hidden = !(writing || S.note);
    R.line.className = `studio-line${S.bad && !writing ? ' bad' : ''}`;
    R.lineChip.hidden = !writing;
    R.lineText.textContent = writing ? S.line : S.note; // the crew's words, or main's message
    // takes: v1 v2 … (the current one pressed; one that didn't finish marked)
    // once Live Motion is approved: its takes still shown (which one it is), none picked; no Ask, Again or Approve
    const shut = locked();
    const takes = S.kind === 'scene' && Array.isArray(v.takes) ? v.takes : [];
    R.takes.replaceChildren(...takes.map((t) => btn(`v${t.n}`, { class: `ghost small studio-take${t.ok ? '' : ' unfinished'}`, 'aria-pressed': String(t.n === v.current), disabled: shut || writing || Boolean(S.busy),
      title: `${t.ok ? 'Finished' : 'Not finished'}${t.costUsd != null ? ` · ${usd(t.costUsd)}` : ''}`, onclick: () => useTake(t.n) })));
    R.takes.hidden = !takes.length;
    const cap = v.capUsd || v.perSlideUsd || null;
    R.again.title = cap ? `Up to ${usd(cap)} of Claude usage` : '';
    R.again.disabled = shut || writing || Boolean(S.busy);
    R.again.hidden = shut || writing;
    R.askBox.hidden = shut || !canAsk();
    R.ask.disabled = shut || writing || Boolean(S.busy);
    R.stop.hidden = !writing;
    const approvable = S.kind === 'scene' && v.status === 'ok';
    R.approve.hidden = shut || S.kind !== 'scene' || Boolean(v.approved) || writing; // while its crew writes, Stop is the one action
    R.approve.disabled = shut || !approvable || writing || Boolean(S.busy);
    R.dots.hidden = S.kind !== 'scene';
    R.more.hidden = !S.more || S.kind !== 'scene';
    R.dots.setAttribute('aria-expanded', String(S.more && S.kind === 'scene'));
    // the ⋯ panel
    R.bubble.hidden = !(info.duet);
    pressed(R.bubble, S.overlay.bubble);
    pressed(R.grid, S.overlay.grid);
    pressed(R.soundBtn, S.sound);
    const both = Boolean(info.voices && info.voices.draft && info.voices.filmed);
    R.voices.hidden = !both;
    pressed(R.draft, S.voice === 'draft');
    pressed(R.filmed, S.voice === 'filmed');
    R.snapBtn.disabled = !S.st.ready || S.snap === 'working';
    R.snapBtn.textContent = S.snap === 'working' ? 'Snapshot this frame…' : 'Snapshot this frame';
    paintPicker();
    paintTransport();
  }
  function chipOf(v) {
    if (running()) return null; // the line says it
    if (v.approved || locked()) return ['✓ Approved', 'st-approved']; // Live Motion approved: why nothing else is offered
    if (v.look) return ['Needs a look', 'st-stale', v.look.join('\n')]; // its checks at the draft's or film's timing (G1; pacing, Q-01)
    if (v.status === 'stale') return ['Out of date', 'st-stale'];
    if (v.status === 'failed') return ['Didn\'t finish', 'st-error'];
    return null;
  }
  function paintTransport() {
    if (!root) return;
    const dur = S.st.duration || 0;
    R.play.textContent = S.st.playing ? '❚❚' : '▶';
    R.play.setAttribute('aria-label', S.st.playing ? 'Pause' : 'Play');
    R.play.disabled = !S.st.ready;
    R.scrub.max = String(dur || 1);
    R.scrub.disabled = !S.st.ready;
    const key = JSON.stringify([dur, S.st.beats.map((b) => b.t)]);
    if (R.ticks.dataset.key !== key) {
      R.ticks.dataset.key = key;
      // placed through the CSSOM: a style attribute is inline style, which the page's CSP refuses
      R.ticks.replaceChildren(...(dur ? S.st.beats.map((b) => { const n = el('span', { class: 'studio-tick', title: String(b.name || '').replace(/-/g, ' ') }); n.style.left = `${(100 * b.t) / dur}%`; return n; }) : []));
    }
    paintTime();
  }
  function paintTime() {
    if (!root) return;
    const t = nowT();
    if (!S.scrubbing) R.scrub.value = String(t);
    R.time.textContent = `${fmt(t)} / ${fmt(S.st.duration || 0)}`;
  }
  /** Where the piece is now: the last tick's t, run on at the clock's rate while it plays. */
  function nowT() {
    if (S.kind === 'clip') return R.clip ? R.clip.currentTime || 0 : 0;
    const s = S.st;
    if (!s.playing || !s.at) return s.t;
    return Math.min(s.duration || Infinity, s.t + (performance.now() - s.at) / 1000);
  }
  let raf = 0;
  function runClock() {
    cancelAnimationFrame(raf);
    if (!S.open || !S.st.playing || S.kind !== 'scene') return;
    const step = () => { paintTime(); if (S.open && S.st.playing) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
  }

  // ── the sound picker (W2-06): its ▶ plays the piece itself, with that sound, on the Stage ──
  let picker = null;
  function paintPicker() {
    const info = S.info;
    const want = Boolean(S.kind === 'scene' && info && info.editable && UI.components.soundPicker);
    if (!want) { if (picker) { picker.destroy(); picker = null; } R.picker.replaceChildren(); R.picker.hidden = true; return; }
    R.picker.hidden = false;
    const value = info.sound || { music: 'none', sfx: 'off' };
    const said = JSON.stringify(value);
    if (picker && picker.key === S.key) { if (picker.said !== said) { picker.said = said; picker.p.set(value); } return; } // only when main's answer changes it
    if (picker) picker.destroy();
    const host = el('div', { class: 'studio-sound' });
    R.picker.replaceChildren(host);
    const p = UI.components.soundPicker(host, {
      value, kind: info.kind, episode: S.dir,
      preview: async (v) => {
        await reopen({ sound: v, play: true });
        return () => { if (S.open && S.preview) reopen({ sound: null, play: false }); };
      },
      onChange: (v) => keepSound(v),
    });
    picker = { key: S.key, p, said, destroy: () => { try { p.destroy(); } catch { /* gone */ } } };
  }
  async function keepSound(v) {
    const key = S.key;
    try {
      const r = await unwrap(flpt.studio.sound(S.dir, key, v));
      if (S.key !== key) return;
      if (r.piece) S.info = r.piece;
      if (!S.preview) await reopen({ sound: null, play: S.st.playing });
      note('');
    } catch (e) { note(e.message, true); if (picker && S.info) { picker.said = JSON.stringify(S.info.sound); picker.p.set(S.info.sound); } }
    paint();
  }

  // ── the Stage ──
  let unsub = null;
  function listen() {
    if (unsub || !stage()) return;
    unsub = stage().on((kind, x) => {
      if (!S.open || S.kind !== 'scene') return;
      if (kind === 'state') {
        const s = x || {};
        if (s.killed) { S.st.ready = false; S.st.playing = false; S.st.killed = s.killed; } else S.st.killed = null;
        if (!s.open) { S.st.ready = false; S.st.playing = false; }
        paintTransport();
        return;
      }
      const ev = x || {};
      if (ev.ev === 'ready') {
        Object.assign(S.st, { ready: true, duration: ev.duration, beats: Array.isArray(ev.beats) ? ev.beats.slice().sort((a, b) => a.t - b.t) : [], keyframes: ev.keyframes || [] });
        S.reloads = (S.reloads || 0) + 1;
        if (S.note === 'The scene didn\'t start.') note('');
        apply();
        if (S.wantPlay) { S.wantPlay = false; send({ cmd: 'play' }); }
        paint();
      } else if (ev.ev === 'tick') {
        // a tick sent before the Stage took a seek of ours still carries the old time: ours stands until it's taken
        const early = !ev.playing && S.st.seekTo != null && performance.now() - S.st.seekAt < 400 && Math.abs(ev.t - S.st.seekTo) > 1e-3;
        if (!early) S.st.seekTo = null;
        if (!ev.playing) S.st.settling = false; // paused: where the Stage really stopped
        Object.assign(S.st, { t: early ? S.st.t : ev.t, playing: Boolean(ev.playing), fps: ev.fps, at: performance.now() });
        proxy(ev);
        if (S.st.playing) runClock();
        paintTransport();
      } else if (ev.ev === 'snapshot') {
        S.snap = 'shown';
        paint();
      } else if (ev.ev === 'error') {
        // the harness's own word on what didn't work: a snapshot that never came back, a scene that didn't start
        if (ev.code === 'snapshot' && (S.snap === 'working' || S.snap === 'asked')) { S.snap = ''; note('The snapshot didn\'t come back.', true); }
        else if (ev.code === 'piece-setup' && !running()) note('The scene didn\'t start.', true);
      }
    });
  }
  /** What this Studio told the Stage, told again after each (re)load: a fresh harness starts from its defaults. */
  function apply() {
    if (S.mode !== 'scene') send({ cmd: 'mode', mode: S.mode });
    if (S.overlay.bubble || S.overlay.grid) send({ cmd: 'overlay', ...S.overlay });
    if (!S.sound) send({ cmd: 'sound', on: false });
    if (S.voice !== 'draft') send({ cmd: 'voice', voice: S.voice });
    if (S.quality !== 'preview') send({ cmd: 'quality', quality: S.quality });
  }
  /** The Proxy: a scene that can't keep up while playing (three slow ticks running) plays at half resolution. */
  function proxy(ev) {
    if (S.quality === 'half' || !ev.playing || !(ev.fps > 0)) { S.slow = 0; return; }
    S.slow = ev.fps < SLOW_FPS ? S.slow + 1 : 0;
    if (S.slow >= 3) { S.quality = 'half'; S.slow = 0; send({ cmd: 'quality', quality: 'half' }); }
  }

  async function reopen({ sound = null, play = false, t = null } = {}) {
    if (!S.open || S.kind !== 'scene') return;
    const at = t == null ? nowT() : t;
    S.preview = sound;
    S.wantPlay = play;
    S.st.ready = false;
    try {
      const r = await unwrap(flpt.studio.open(S.dir, S.key, at, sound || undefined));
      if (r.piece) S.info = r.piece;
      if (sound) S.info = { ...S.info, sound: r.piece ? r.piece.sound : S.info.sound };
      note('');
    } catch (e) { note(e.message, true); }
    paint();
  }

  function togglePlay() {
    if (S.kind === 'clip') { if (R.clip.paused) R.clip.play().catch(() => {}); else R.clip.pause(); return; }
    if (!S.st.ready) return;
    const play = !S.st.playing;
    S.st.t = nowT();
    S.st.playing = play;
    S.st.settling = !play; // until the Stage's next tick says where it stopped
    S.st.at = performance.now();
    send({ cmd: play ? 'play' : 'pause' });
    if (play) runClock();
    paintTransport();
  }
  function seek(t) {
    const d = S.st.duration || (S.kind === 'clip' ? R.clip.duration || 0 : 0);
    const to = Math.max(0, Math.min(d || t, t));
    if (S.kind === 'clip') { R.clip.currentTime = to; return; }
    S.st.t = to;
    S.st.at = performance.now();
    S.st.seekTo = to;
    S.st.seekAt = performance.now();
    send({ cmd: 'seek', t: to });
    paintTime();
  }
  /** Just paused: the frame the Stage stopped on, from its next tick (at most 400 ms), so a step counts from it. */
  const settled = () => new Promise((ok) => { const t0 = performance.now(); const poll = () => (!S.st.settling || performance.now() - t0 > 400 ? ok() : setTimeout(poll, 15)); poll(); });
  async function step(dir) {
    if (S.kind === 'clip') { R.clip.pause(); seek((Math.round(R.clip.currentTime * FPS) + dir) / FPS); return; }
    if (!S.st.ready) return;
    if (S.st.playing) togglePlay();
    await settled();
    seek((Math.round(nowT() * FPS) + dir) / FPS);
  }
  async function beat(dir) {
    if (S.kind !== 'scene' || !S.st.beats.length) return;
    if (S.st.playing) togglePlay();
    await settled();
    const t = nowT();
    const list = S.st.beats.map((b) => b.t);
    const to = dir > 0 ? list.find((x) => x > t + 1e-3) : [...list].reverse().find((x) => x < t - 1e-3);
    if (to == null) return;
    seek(to);
  }
  function setMode(m) {
    if (!S.info || !S.info.reference) return;
    S.mode = m;
    send({ cmd: 'mode', mode: m });
    paint();
  }
  function setOverlay(o) {
    if (o.bubble != null && !(S.info && S.info.duet)) return;
    S.overlay = { ...S.overlay, ...o };
    send({ cmd: 'overlay', ...S.overlay });
    paint();
  }
  function setSound(on) {
    S.sound = on;
    send({ cmd: 'sound', on });
    paint();
  }
  function setVoice(v) {
    if (!(S.info && S.info.voices && S.info.voices[v === 'filmed' ? 'filmed' : 'draft'])) return;
    S.voice = v;
    send({ cmd: 'voice', voice: v });
    paint();
  }
  function toggleMore(on = !S.more) {
    S.more = on;
    paint();
  }

  /** Snapshot this frame: paused, the final renderer's own frame at t, shown beside the preview by the Stage. */
  async function snapshot() {
    if (!S.st.ready || S.snap === 'working') return;
    if (S.st.playing) togglePlay();
    S.snap = 'working';
    await settled();
    const t = (Math.floor(nowT() * FPS + 1e-6) + 0.5) / FPS; // a frame's middle (K1)
    paint();
    try { await unwrap(flpt.studio.snapshot(Math.min(t, Math.max(0, (S.st.duration || t) - 0.5 / FPS)))); S.snap = S.snap === 'working' ? 'asked' : S.snap; } catch (e) { S.snap = ''; note(e.message, true); }
    paint();
  }

  // ── the crew: takes, Ask for changes, Again, Approve ──
  const running = () => Boolean(S.view && S.view.status === 'running');
  function note(text, bad = false) { S.note = text || ''; S.bad = Boolean(text) && bad; if (root) paint(); }

  async function useTake(n) {
    if (S.busy || locked()) return;
    S.busy = 'take';
    paint();
    try { const list = await unwrap(flpt.livemotion.useTake(S.dir, S.key, n)); takePieces(list); note(''); } catch (e) { note(e.message, true); }
    S.busy = '';
    paint();
  }
  /** Run this piece's crew (or its animator) again: with notes, Ask for changes; without, Again. */
  async function runCrew(notes = '') {
    if (S.busy || running() || locked() || (notes && !canAsk())) return;
    const dir = S.dir;
    const key = S.key;
    S.busy = 'run';
    S.asked = notes;
    S.line = '';
    note('');
    try {
      if (S.kind === 'clip') {
        const r = await unwrap(flpt.animate(dir, { slide: S.view.n, feedback: notes }));
        if (r && r.cancelled) note('Not approved. Nothing ran.');
      } else {
        // the run is under way once main says so (livemotion:changed); its result arrives when the crew is done
        const run = notes ? flpt.livemotion.run(dir, key, notes) : flpt.livemotion.run(dir, key);
        setTimeout(() => refreshPieces(), 400);
        const r = await unwrap(run);
        if (r && r.cancelled) note('Not approved. Nothing ran.');
        else if (r && r.ok === false && r.error) note(r.error, true);
      }
      if (notes && R.ask && S.key === key) { R.ask.value = ''; R.askGo.hidden = true; }
    } catch (e) { if (S.key === key) note(e.message, true); }
    S.busy = '';
    S.asked = '';
    if (S.open && S.dir === dir) await refreshPieces();
    paint();
  }
  const again = () => runCrew('');
  const ask = () => { const t = R.ask.value.trim(); if (t) runCrew(t); };
  async function stop() {
    try { await unwrap(flpt.livemotion.cancel(S.dir)); } catch (e) { note(e.message, true); }
  }

  /** Approve this piece: first the words on screen that aren't in the script or the deck, if any. */
  async function approve() {
    const v = S.view;
    if (!v || v.status !== 'ok' || S.busy || locked()) return;
    const words = Array.isArray(v.unlisted) ? v.unlisted : [];
    if (words.length && !(await confirmWords(words))) return;
    S.busy = 'approve';
    paint();
    try { takePieces(await unwrap(flpt.livemotion.approve(S.dir, S.key))); note(''); } catch (e) { note(e.message, true); }
    S.busy = '';
    paint();
  }
  /** The on-screen words that aren't in the script or the deck, before an approval: true to approve. */
  function confirmWords(words) {
    return new Promise((done) => {
      const dlg = el('dialog', { class: 'studio-words', 'data-realm': 'theater', 'aria-label': 'Approve' });
      const finish = (yes) => { dlg.close(); dlg.remove(); done(yes); };
      dlg.append(el('p', { class: 'hud' }, 'On screen, not in the script'),
        el('p', { class: 'studio-word-list', 'data-content': '' }, ...words.slice(0, 40).map((w) => el('span', { class: 'chip' }, w))),
        el('div', { class: 'actions' }, btn('Cancel', { class: 'ghost', onclick: () => finish(false) }), btn('Approve', { class: 'primary', onclick: () => finish(true) })));
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(false); });
      document.body.append(dlg);
      dlg.showModal();
      dlg.querySelector('button.ghost').focus();
    });
  }

  // ── the pieces: the wall's list, kept current while the Studio is open ──
  const placeOf = (p) => (p.source === 'animator' || p.placement === 'slide' ? Number(p.n) || 0 : (Number(p.afterN) || 0) + 0.5);
  function takePieces(list) {
    if (!Array.isArray(list)) return;
    const lm = list.map((p) => ({ ...p, source: 'livemotion' }));
    const animators = S.pieces.filter((p) => p.source === 'animator');
    S.pieces = [...lm, ...animators].sort((a, b) => placeOf(a) - placeOf(b) || (a.source === b.source ? 0 : a.source === 'livemotion' ? -1 : 1)); // film order
    S.view = S.pieces.find((p) => p.key === S.key) || S.view;
  }
  async function refreshPieces() {
    if (!S.open || !flpt.livemotion || !flpt.livemotion.view) return;
    try {
      const v = await unwrap(flpt.livemotion.view(S.dir));
      takePieces(v.pieces);
      if (S.kind === 'scene' && !S.info && S.view && S.view.status !== 'todo') retryOpen();
      paint();
      tellSlot();
    } catch { /* the episode moved on */ }
  }
  let changeTimer = null;
  if (window.flpt && flpt.livemotion && typeof flpt.livemotion.onChanged === 'function') {
    flpt.livemotion.onChanged((ev) => {
      if (!S.open || (ev && ev.dir && S.dir && ev.dir !== S.dir)) return;
      clearTimeout(changeTimer);
      changeTimer = setTimeout(() => refreshPieces(), 150);
    });
  }
  if (window.flpt && typeof flpt.onAgent === 'function') {
    flpt.onAgent((ev) => {
      if (!S.open || !ev || ev.stage !== 'animate' || (ev.dir && ev.dir !== S.dir)) return;
      const mine = S.kind === 'clip' ? ev.slide === (S.view && S.view.n) : ev.piece === S.key;
      if (!mine) return;
      const line = lineOf(ev);
      if (line) { S.line = line; paint(); }
      if (S.kind === 'scene' && !S.info && ev.kind === 'tool') retryOpen(); // its scene.js may be there now
      if (ev.kind === 'done' || ev.kind === 'result') setTimeout(() => refreshPieces(), 200);
    });
  }

  /** A piece that wasn't drawn when the Studio opened (its crew just started): on the Stage once it is. */
  let lastTry = 0;
  async function retryOpen() {
    if (!S.open || S.kind !== 'scene' || S.info || Date.now() - lastTry < 2000) return;
    lastTry = Date.now();
    const key = S.key;
    try {
      const r = await unwrap(flpt.studio.open(S.dir, key, 0));
      if (S.key !== key || !S.open) return;
      S.info = r.piece;
      note('');
      tellSlot();
    } catch { /* not yet */ }
  }

  // ── open, close, move between pieces ──
  const animatorView = (p) => p && p.source === 'animator';
  async function show(key) {
    const v = S.pieces.find((p) => p.key === key);
    if (!v) return;
    if (picker) { picker.destroy(); picker = null; }
    Object.assign(S, { key, view: v, info: null, kind: animatorView(v) ? 'clip' : 'scene', mode: 'scene', overlay: { bubble: false, grid: false }, voice: 'draft', quality: 'preview',
      slow: 0, snap: '', preview: null, wantPlay: false, line: '', note: '', bad: false, reloads: 0 });
    S.st = { ready: false, duration: 0, beats: [], keyframes: [], t: 0, playing: false, fps: 0, at: 0, killed: null };
    R.ask.value = '';
    R.askGo.hidden = true;
    if (S.kind === 'clip') {
      if (stage() && stage().state().open) stage().close().catch(() => {});
      R.clip.src = v.preview ? flpt.fileUrl(v.preview, v.previewAt) : '';
      if (!v.preview) note('No animation yet.');
    } else {
      R.clip.removeAttribute('src');
      R.clip.load();
    }
    paint();
    tell('piece');
    if (S.kind !== 'scene') { tellSlot(); return; }
    try {
      const r = await unwrap(flpt.studio.open(S.dir, key, 0));
      if (S.key !== key) return;
      S.info = r.piece;
      if (r.piece && r.piece.voices && !r.piece.voices.draft && r.piece.voices.filmed) S.voice = 'filmed';
      if (r.stage && r.stage.ready) S.st.ready = true;
    } catch (e) {
      if (S.key !== key) return;
      note(e.message, true);
    }
    paint();
    tellSlot();
  }
  function tellSlot() {
    if (!R.slot) return;
    R.slot.dispatchEvent(new CustomEvent('studio:piece', { detail: S.open ? { episode: S.dir, key: S.key, piece: S.info, view: S.view, editable: Boolean(S.info && S.info.editable) } : null }));
  }
  function move(dir) {
    const list = S.pieces.filter((p) => p.source === 'animator' || p.status !== 'todo' || p.key === S.key);
    const i = list.findIndex((p) => p.key === S.key);
    const next = list[i + dir];
    if (next) show(next.key);
  }

  function onKey(e) {
    if (!S.open) return;
    if (document.querySelector('dialog[open]')) return; // a confirm is up: its own keys
    const t = e.target;
    const typing = t && t.closest && t.closest('input:not([type=range]):not([type=button]), textarea, select, [contenteditable="true"]');
    if (e.key === 'Escape') {
      e.preventDefault();
      if (typing) { t.blur(); return; }
      if (S.more) { toggleMore(false); R.dots.focus(); return; }
      close();
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    const range = t && t.matches && t.matches('input[type=range]');
    const k = e.key;
    if (k === ' ' || k === 'Spacebar') { e.preventDefault(); togglePlay(); return; }
    if (k === ',' || k === '<') { e.preventDefault(); step(-1); return; }
    if (k === '.' || k === '>') { e.preventDefault(); step(1); return; }
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      if (range && !e.shiftKey) return; // the scrubber's own arrows
      e.preventDefault();
      if (e.shiftKey) beat(k === 'ArrowLeft' ? -1 : 1); else move(k === 'ArrowLeft' ? -1 : 1);
      return;
    }
    const low = k.toLowerCase();
    if (S.kind !== 'scene') return;
    if (low === 'c' && S.info && S.info.reference) { e.preventDefault(); setMode(S.mode === 'scene' ? 'side' : S.mode === 'side' ? 'wipe' : 'scene'); return; }
    if (low === 'b' && S.info && S.info.duet) { e.preventDefault(); setOverlay({ bubble: !S.overlay.bubble }); return; }
    if (low === 'g') { e.preventDefault(); setOverlay({ grid: !S.overlay.grid }); return; }
    if (low === 'm') { e.preventDefault(); setSound(!S.sound); }
  }
  document.addEventListener('keydown', onKey);
  // Space's own click on a focused button comes on keyup: the Studio's Space is play, and nothing else
  document.addEventListener('keyup', (e) => {
    if (!S.open || (e.key !== ' ' && e.key !== 'Spacebar') || document.querySelector('dialog[open]')) return;
    const t = e.target;
    if (t && t.closest && t.closest('input:not([type=range]):not([type=button]), textarea, select, [contenteditable="true"]')) return;
    e.preventDefault();
  });

  /** Everything under the Studio, out of reach while it's open (focus, clicks and the reader); the job log stays over it. */
  const behind = () => [...document.body.children].filter((n) => n !== root && !n.matches('#slot-layer, #log, script, dialog'));

  async function open({ dir, key, pieces = [], from = null, approved = false } = {}) {
    if (!dir || !key) return;
    if (S.open) close({ keepStage: true });
    S = { ...blank(), open: true, dir, key, pieces: pieces.slice(), from, approved: Boolean(approved) };
    if (!root) build();
    S.more = false;
    document.body.append(root);
    for (const n of behind()) n.inert = true;
    listen();
    tell('open');
    await show(key);
    if (S.open && S.key === key) R.play.focus();
  }
  function close({ keepStage = false } = {}) {
    if (!S.open) return;
    // back to the card of the piece shown last (the wall may have been drawn again meanwhile)
    const card = S.key ? document.querySelector(`.lm-card[data-key="${CSS.escape(S.key)}"] .lm-open`) : null;
    const from = card || S.from;
    cancelAnimationFrame(raf);
    if (picker) { picker.destroy(); picker = null; }
    if (!keepStage && stage() && S.kind === 'scene') stage().close().catch(() => {});
    if (R.clip) { R.clip.pause(); R.clip.removeAttribute('src'); R.clip.load(); }
    for (const n of behind()) n.inert = false;
    if (root) root.remove();
    S = blank();
    tellSlot();
    tell('close');
    if (from && from.isConnected) from.focus({ preventScroll: true });
  }

  UI.components.studio = {
    open, close: () => close(), isOpen: () => S.open, current, confirmWords,
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
    /** What the Studio shows and has told the Stage (QA and tests). */
    state: () => ({
      open: S.open, key: S.key, kind: S.kind, mode: S.mode, overlay: { ...S.overlay }, sound: S.sound, voice: S.voice, quality: S.quality, more: S.more, snap: S.snap,
      t: nowT(), playing: S.st.playing, ready: S.st.ready, duration: S.st.duration, beats: S.st.beats.length, reloads: S.reloads || 0, busy: S.busy, note: S.note,
      compare: Boolean(root && root.isConnected && !R.compareBox.hidden), filmed: Boolean(root && root.isConnected && !R.voices.hidden), takes: S.view && S.view.takes ? S.view.takes.length : 0,
      current: S.view ? S.view.current : null, preview: S.preview, locked: locked(),
    }),
  };
})();
