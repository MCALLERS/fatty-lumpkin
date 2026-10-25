// compile.js · the cartoon presenter's performance compiler (PLAN §2.12, spike K7). compileTrack(rig, cues, envelope,
// opts) → flpt.track/1: one state per frame (mouth, eyes, head, pupils, brows, events). Pure and seeded: the same inputs
// give byte-identical JSON (no clock, no Math.random), so a track only changes when its inputs do. A classic script that
// also loads as a CommonJS module: the clip renderer, the app, the plugin and a Stage preview share it
// (globalThis.FLPTCompile in a page).
(function (root) {
  'use strict';

  const COMPILER_VERSION = 'flpt-compile 1.0.0';

  // ── seeded randomness: FNV-1a 32 → mulberry32 ──────────────────────────────────────────────────────────────────
  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  function mulberry32(a) {
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rngFor = (seed, key) => mulberry32((seed ^ fnv1a(key)) >>> 0);

  /** Smooth seeded noise in [-1, 1]: cosine-interpolated knots every `every` frames. f → value. */
  function noise1(seed, key, frames, every) {
    const r = rngFor(seed, key);
    const knots = Array.from({ length: Math.ceil(frames / every) + 2 }, () => r() * 2 - 1);
    return (f) => {
      const x = f / every, i = Math.floor(x), u = x - i;
      const w = (1 - Math.cos(Math.PI * u)) / 2;
      return knots[i] * (1 - w) + knots[i + 1] * w;
    };
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const r2 = (v) => Math.round(v * 100) / 100;

  // ── loudness envelope (per video frame) ────────────────────────────────────────────────────────────────────────
  /** RMS per frame of 16-bit mono PCM → 0..1 (−50 dB floor, the 98th-percentile speech frame = 1). */
  function envelopeFromPcm(pcm, sampleRate, fps, frames) {
    const spf = sampleRate / fps;
    const db = new Float64Array(frames);
    for (let f = 0; f < frames; f++) {
      const a = Math.round(f * spf), b = Math.min(pcm.length, Math.round((f + 1) * spf));
      let sum = 0;
      for (let i = a; i < b; i++) sum += pcm[i] * pcm[i];
      const rms = b > a ? Math.sqrt(sum / (b - a)) / 32768 : 0;
      db[f] = rms > 0 ? 20 * Math.log10(rms) : -120;
    }
    const speech = Array.from(db).filter((v) => v > -45).sort((x, y) => x - y);
    const top = speech.length ? speech[Math.min(speech.length - 1, Math.floor(speech.length * 0.98))] : -20;
    const floor = -50;
    return Array.from(db, (v) => r3(clamp((v - floor) / (top - floor), 0, 1)));
  }

  /** A PCM16 WAV (the pipeline's padded narration) from its bytes: { rate, pcm (mono, the first channel), seconds }. */
  function readWav(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const tag = (p) => String.fromCharCode(buf[p], buf[p + 1], buf[p + 2], buf[p + 3]);
    if (buf.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV');
    let p = 12, rate = 0, ch = 1, bits = 16, data = null;
    while (p + 8 <= buf.length) {
      const id = tag(p);
      const size = dv.getUint32(p + 4, true);
      if (id === 'fmt ') { ch = dv.getUint16(p + 10, true); rate = dv.getUint32(p + 12, true); bits = dv.getUint16(p + 22, true); }
      if (id === 'data') { data = [p + 8, Math.min(size, buf.length - p - 8)]; break; }
      p += 8 + size + (size & 1);
    }
    if (!data || bits !== 16 || !rate) throw new Error('need a 16-bit PCM WAV');
    const n = Math.floor(data[1] / 2 / ch);
    const pcm = new Int16Array(n);
    for (let i = 0; i < n; i++) pcm[i] = dv.getInt16(data[0] + i * 2 * ch, true);
    return { rate, pcm, seconds: n / rate };
  }

  // ── the compiler ───────────────────────────────────────────────────────────────────────────────────────────────
  const VALID = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'X']);

  function mouthTrack(cues, env, frames, fps, M) {
    const lead = M.leadFrames || 0;
    const out = new Array(frames);
    let j = 0;
    for (let f = 0; f < frames; f++) {
      const t = (f + lead) / fps;
      while (j < cues.length - 1 && t >= cues[j].end) j++;
      const c = cues[j];
      out[f] = c && t >= c.start && t < c.end && VALID.has(c.value) ? c.value : 'X';
    }
    // loudness as a jaw modifier: a loud C opens to D, a quiet D closes to C
    for (let f = 0; f < frames; f++) {
      if (out[f] === 'C' && env[f] > 0.8) out[f] = 'D';
      else if (out[f] === 'D' && env[f] < 0.22) out[f] = 'C';
    }
    // minimum hold (cartoon "twos"), but a closure (A) is never dropped: a 1-frame A takes the next frame too
    const hold = M.mouthMinHoldFrames || 2;
    for (let f = 0; f < frames;) {
      let e = f; while (e + 1 < frames && out[e + 1] === out[f]) e++;
      const len = e - f + 1;
      if (len < hold) {
        if (out[f] === 'A') { for (let k = e + 1; k < Math.min(frames, f + hold); k++) out[k] = 'A'; f += hold; continue; }
        if (f > 0) for (let k = f; k <= e; k++) out[k] = out[f - 1];
      }
      f = e + 1;
    }
    // a warm closed smile in the opening and closing silences (≥ 0.5 s), never mid-talk
    const firstSpeech = out.findIndex((m) => m !== 'X');
    let lastSpeech = frames - 1; while (lastSpeech >= 0 && out[lastSpeech] === 'X') lastSpeech--;
    if (firstSpeech > 15) for (let f = 0; f < firstSpeech - 3; f++) out[f] = 's';
    if (lastSpeech >= 0 && frames - 1 - lastSpeech > 15) for (let f = lastSpeech + 4; f < frames; f++) out[f] = 's';
    if (firstSpeech < 0) out.fill('s');
    return out;
  }

  /** Pauses (≥ minFrames of near-silence) as [start, end) frame ranges, and the speech onsets after them. */
  function pausesAndOnsets(env, minFrames) {
    const pauses = [], onsets = [];
    let s = -1;
    for (let f = 0; f <= env.length; f++) {
      const quiet = f < env.length && env[f] < 0.12;
      if (quiet && s < 0) s = f;
      if (!quiet && s >= 0) { if (f - s >= minFrames) { pauses.push([s, f]); if (f < env.length) onsets.push(f); } s = -1; }
    }
    return { pauses, onsets };
  }

  function eyesTrack(frames, fps, seed, B, pauses) {
    const e = new Array(frames).fill('o');
    const r = rngFor(seed, 'blink');
    const blinkAt = (f) => { // half, closed, closed, half (≈ 0.13 s)
      const pat = Math.max(3, Math.round(B.dur * fps)) >= 4 ? ['h', 'c', 'c', 'h'] : ['h', 'c', 'h'];
      for (let k = 0; k < pat.length && f + k < frames; k++) e[f + k] = pat[k];
      return f + pat.length;
    };
    const want = new Set();
    let f = Math.round(fps * (0.6 + r() * 1.2));
    while (f < frames) {
      want.add(f);
      if (r() < B.doubleChance) want.add(f + 7);
      const gap = clamp(-Math.log(1 - r()) * B.meanGap, 1.4, 7.5);
      f += Math.round(gap * fps);
    }
    for (const [ps, pe] of pauses) if (pe - ps >= fps * 0.5) want.add(ps + 3); // a blink as a thought ends
    let busyUntil = -1;
    for (const b of [...want].sort((x, y) => x - y)) {
      if (b < busyUntil + 5) continue; // keep blinks apart (a double blink is 7 frames apart)
      busyUntil = blinkAt(b);
    }
    return e.join('');
  }

  function pupilsTrack(frames, fps, seed, range) {
    const r = rngFor(seed, 'saccade');
    const out = new Array(frames);
    let cur = [0, 0], from = [0, 0], t0 = 0, next = Math.round(fps * (1 + r() * 2));
    for (let f = 0; f < frames; f++) {
      if (f === next) {
        from = cur;
        const home = r() < 0.55; // mostly back to the viewer
        cur = home ? [0, 0] : [r2(range.x[0] + r() * (range.x[1] - range.x[0])) * 0.8, r2(range.y[0] + r() * (range.y[1] - range.y[0])) * 0.8];
        t0 = f; next = f + Math.round(fps * (1 + r() * 2));
      }
      const u = clamp((f - t0) / 2, 0, 1); // a saccade takes 2 frames
      out[f] = [r2(from[0] + (cur[0] - from[0]) * u), r2(from[1] + (cur[1] - from[1]) * u)];
    }
    return out;
  }

  const NO_RANGE = { x: [0, 0], y: [0, 0], rot: [0, 0] };

  /**
   * The performance for one clip. rig: flpt.rig/1; cues: Rhubarb's mouthCues ([{ start, end, value }]); env: one
   * loudness value per frame (envelopeFromPcm); opts: { frames, fps = 30, seed }.
   */
  function compileTrack(rig, cues, env, opts) {
    const fps = opts.fps || 30, frames = opts.frames;
    const seed = opts.seed >>> 0;
    const M = rig.motion;
    const L = Object.fromEntries(rig.layers.map((l) => [l.id, l]));
    if (!Number.isInteger(frames) || frames < 1) throw new Error('a track needs a whole number of frames');
    if (env.length !== frames) throw new Error(`envelope has ${env.length} frames, track needs ${frames}`);
    const mouth = mouthTrack(cues, env, frames, fps, M);
    const { pauses, onsets } = pausesAndOnsets(env, Math.round(fps * 0.25));
    const eyes = eyesTrack(frames, fps, seed, M.blink, pauses);
    const pupils = pupilsTrack(frames, fps, seed, (L.pupils && L.pupils.range) || NO_RANGE);

    // emphasis: the loudest onsets after a pause, at most one per 1.5 s → a brow raise and a small nod
    const emph = [];
    for (const o of onsets) {
      let pk = 0; for (let f = o; f < Math.min(frames, o + 12); f++) pk = Math.max(pk, env[f]);
      if (pk > 0.7 && (!emph.length || o - emph[emph.length - 1] > fps * 1.5)) emph.push(o);
    }
    const raise = (f) => { // 0..1 bump: up over 3 frames, hold 6, down over 8
      let v = 0;
      for (const o of emph) {
        const d = f - o;
        if (d >= 0 && d < 3) v = Math.max(v, d / 3); else if (d >= 3 && d < 9) v = 1; else if (d >= 9 && d < 17) v = Math.max(v, 1 - (d - 9) / 8);
      }
      return v;
    };

    // head: low-passed loudness → bob; slow seeded sway; nod on emphasis; breathing as a body scale
    const sway = noise1(seed, 'sway', frames, Math.round(fps * 2.6));
    const drift = noise1(seed, 'drift', frames, Math.round(fps * 3.4));
    const jitter = noise1(seed, 'bob', frames, Math.round(fps * 0.9));
    const hr = (L.head && L.head.range) || NO_RANGE;
    const br = (L.brows && L.brows.range) || NO_RANGE;
    const head = new Array(frames), brows = new Array(frames);
    let lp = 0;
    for (let f = 0; f < frames; f++) {
      lp += (env[f] - lp) * (env[f] > lp ? 0.35 : 0.12);
      const nod = raise(f);
      const rot = clamp(sway(f) * 2.2 + (lp - 0.3) * 1.2, hr.rot[0], hr.rot[1]);
      const dy = clamp(-M.bob.fromEnvelope * lp + M.bob.noise * jitter(f) + 3 * nod, hr.y[0], hr.y[1]);
      const dx = drift(f) * 3;
      const s = 1 + M.breath.scale * Math.sin((2 * Math.PI * f) / (fps * M.breath.period));
      head[f] = [r3(rot), r3(dx), r3(dy), Math.round(s * 1e5) / 1e5];
      brows[f] = [r2(clamp(-10 * M.browOnEmphasis * nod - 2 * lp, br.y[0], br.y[1])), r2(clamp(sway(f + 40) * 1.2, br.rot[0], br.rot[1]))];
    }
    return {
      schema: 'flpt.track/1', fps, frames, rig: `${rig.id}@${rig.version}`, seed, compiler: COMPILER_VERSION,
      mouth: mouth.join(''), eyes, head, pupils, brows,
      events: emph.map((f) => ({ f, kind: 'emphasis' })),
    };
  }

  /** The seed of a clip's performance: from the rig and the clip's padded narration (pad_key), never a clock. */
  const seedFor = (rig, padKey) => fnv1a(`${rig.id}@${rig.version}|${padKey}`);

  /** A still performance (the rig at rest, a closed smile): the still bubble, a rig's poster. */
  function restTrack(rig, frames = 1) {
    return { schema: 'flpt.track/1', fps: 30, frames, rig: `${rig.id}@${rig.version}`, seed: 0, compiler: COMPILER_VERSION,
      mouth: 's'.repeat(frames), eyes: 'o'.repeat(frames), head: Array.from({ length: frames }, () => [0, 0, 0, 1]),
      pupils: Array.from({ length: frames }, () => [0, 0]), brows: Array.from({ length: frames }, () => [0, 0]), events: [] };
  }

  const api = { COMPILER_VERSION, fnv1a, envelopeFromPcm, readWav, compileTrack, seedFor, restTrack };
  root.FLPTCompile = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
