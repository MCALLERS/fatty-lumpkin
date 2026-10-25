/* compare.js · the Stage's reference layer, 1.0.0 (FLPT V2, PLAN §2.5, draft-ux §5.2): the user's reference (a clip,
 * a style's loop, captured stills or one picture) beside the piece or under a wipe, on the piece's clock (linked
 * relative time plus an offset). A <video> is re-seated past 80 ms of drift and nudged by at most ±3 % in between
 * (protocol.js syncStep); the filmed presenter bubble uses the same sync. The reference's own sound is never played.
 */
(() => {
  'use strict';
  const P = window.FLPTStageProtocol;
  const now = () => performance.now();

  /** Keep one <video> on the clock: sync(t, playing, rate) each frame; start(t, rate) before the clock starts. */
  function syncedVideo(video, { offset = 0, loop = false } = {}) {
    const v = { el: video, offset, loop, lastSeek: -1e9, lat: 0.12, seekAt: 0, seeks: 0 };
    video.addEventListener('seeking', () => { v.seekAt = now(); });
    video.addEventListener('seeked', () => {
      if (!v.seekAt) return;
      const d = (now() - v.seekAt) / 1000;
      v.lat = Math.min(0.5, v.lat * 0.6 + d * 0.4);   // the seek latency, so a re-seat while playing lands on time
      v.seekAt = 0;
    });
    const target = (t) => t + v.offset;
    v.ready = () => video.readyState >= 1 && Number.isFinite(video.duration);
    v.sync = (t, playing, rate) => {
      if (!v.ready()) return;
      const r = P.syncStep({ current: video.currentTime, target: target(t), rate, playing, paused: video.paused, seeking: video.seeking,
        length: video.duration, loop: v.loop, lead: v.lat, sinceSeek: (now() - v.lastSeek) / 1000 });
      if (Math.abs(video.playbackRate - r.rate) > 1e-4) video.playbackRate = r.rate;
      if (r.seek != null) { video.currentTime = r.seek; v.lastSeek = now(); v.seeks++; }
      if (r.play) video.play().catch(() => {});
      if (r.pause) video.pause();
    };
    /** Put the video where the clock will start and get it playing (at most 400 ms), so play begins in step. */
    v.start = (t, rate) => new Promise((done) => {
      if (!v.ready()) { done(false); return; }
      let over = false;
      const end = (ok) => { if (!over) { over = true; video.removeEventListener('playing', on); done(ok); } };
      const on = () => end(true);
      video.playbackRate = rate;
      const want = P.videoTime(target(t), video.duration, v.loop);
      if (Math.abs(video.currentTime - want) > 1 / 120) { video.currentTime = want; v.lastSeek = now(); }
      if (!video.paused) { end(true); return; }
      video.addEventListener('playing', on);
      video.play().catch(() => end(false));
      setTimeout(() => end(false), 400);
    });
    /** The video's drift from the clock at t, in seconds (QA). */
    v.drift = (t) => (v.ready() ? P.drift(video.currentTime, P.videoTime(target(t), video.duration, v.loop), video.duration, v.loop) : null);
    return v;
  }

  function quietVideo(src, loop) {
    const v = document.createElement('video');
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.loop = !!loop;
    v.disableRemotePlayback = true;
    v.setAttribute('disablepictureinpicture', '');
    v.src = src;
    return v;
  }

  /** The reference layer in el; at(path) makes a URL under the token's base. */
  function create(el, at) {
    const content = document.createElement('div');
    const snap = document.createElement('img');
    content.className = 'content';
    snap.className = 'one';
    snap.hidden = true;
    snap.alt = '';
    el.replaceChildren(content, snap);
    const R = { kind: 'none', video: null, sv: null, error: null };

    R.clear = () => {
      if (R.video) { try { R.video.pause(); R.video.removeAttribute('src'); R.video.load(); } catch (e) { /* gone */ } }
      content.replaceChildren();
      R.kind = 'none'; R.video = null; R.sv = null; R.error = null;
    };
    /** spec: the load command (ref, refExt, refImageExt, refFrames, refOffset, refLoop). */
    R.load = (spec) => {
      R.clear();
      R.kind = spec.ref;
      if (spec.ref === 'video') {
        const v = quietVideo(at(P.LAYOUT.refVideo(spec.refExt)), spec.refLoop);
        v.addEventListener('error', () => { R.error = 'ref'; });
        content.replaceChildren(v);
        R.video = v;
        R.sv = syncedVideo(v, { offset: spec.refOffset, loop: spec.refLoop });
      } else if (spec.ref === 'frames') {
        const n = spec.refFrames, cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
        const grid = document.createElement('div');
        grid.className = 'frames';
        grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        grid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
        for (let i = 1; i <= n; i++) {
          const img = document.createElement('img');
          img.alt = '';
          img.decoding = 'async';
          img.src = at(P.LAYOUT.refFrame(i, spec.refImageExt));
          grid.appendChild(img);
        }
        content.replaceChildren(grid);
      } else if (spec.ref === 'image') {
        const img = document.createElement('img');
        img.className = 'one';
        img.alt = '';
        img.src = at(P.LAYOUT.refImage(spec.refImageExt));
        content.replaceChildren(img);
      }
    };
    R.has = () => R.kind !== 'none';
    R.duration = () => (R.video && Number.isFinite(R.video.duration) ? R.video.duration : 0);
    R.sync = (t, playing, rate) => { if (R.sv && !snap.src) R.sv.sync(t, playing, rate); };
    R.start = (t, rate) => (R.sv ? R.sv.start(t, rate) : Promise.resolve(true));
    R.pause = () => { if (R.video && !R.video.paused) R.video.pause(); };
    R.drift = (t) => (R.sv ? R.sv.drift(t) : null);
    /** Show the final renderer's frame in place of the reference (null: back to the reference). */
    R.showSnapshot = (url) => {
      if (!url) { snap.hidden = true; snap.removeAttribute('src'); content.hidden = false; return; }
      R.pause();
      snap.src = url;
      snap.hidden = false;
      content.hidden = true;
    };
    R.snapshotShown = () => !snap.hidden;
    return R;
  }

  window.FLPTStageCompare = Object.freeze({ create, syncedVideo, quietVideo });
})();
