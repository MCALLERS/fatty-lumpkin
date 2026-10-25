/* score-worker.js · the Stage's score Worker, 1.1.0 (FLPT V2, PLAN §2.5, §2.6; W2-06). Before a piece's real stem exists the
 * Stage plays flpt-score's PCM, rendered here, off the harness's thread: the same file and the same samples as the
 * final (flpt-score is bit-identical in Node, Chrome and Electron, spike K4), placed and levelled the way the mixer
 * (app/src/main/mixer.js) and score.js build the stem, so what the preview plays is what the film gets:
 *   - the hits are score.hitsFrom()'s: the beats' sfx and the scene's hits(ctx), gain held to -24..+2 dB, one per kind
 *     within 10 ms, in time order; each one-shot is flpt-score's own sfx(kind) with the stem's seed
 *     (`<seed>:sfx:<kind>:<n>`), its anchor on round(t × rate), at the stem's level (soft -6 dB, on 0 dB);
 *   - the music has the stem's fades (1.0 s in, 1.8 s out, shorter for a short piece);
 *   - under a voice (a narrated piece: a bed) the music sits at -26 LUFS and an 8 dB duck stands in for the mixer's
 *     sidechain (the voice itself plays beside it in the harness); alone (an interstitial, a cut scene) the whole is
 *     levelled to -21 LUFS, or, effects only, kept at the effects' own level; a limiter holds the peaks as the stem's.
 * Loudness is BS.1770 (K-weighting at any rate, 400 ms blocks, -70 / -10 LU gates), as mixer.js's own measure.
 * What the preview can't know: where the voice speaks (the duck is constant) and how loud it is (the mixer's "voice
 * wins" guard). The real stem replaces this as soon as it exists.
 *
 * As a Worker (the harness: new Worker('score-worker.js'); flpt-score from ../score/):
 *   in   { op: 'render', id, preset (the preset's JSON) | music: { left, right } (a track or a file the harness decoded,
 *          at sampleRate, from the piece's start), seconds, seed, sfx: 'off'|'soft'|'on', hits: [{ t, kind, gain }],
 *          beats?: [{ t, sfx }], sampleRate, voiced }
 *   out  { op: 'pcm', id, sampleRate, left, right (Float32Array, transferred), gain: 1, lufs, level, hits: [t] }
 *        | { op: 'error', id, msg }
 * As CommonJS (Node: the sound picker's preview in main, the tests): { mix, hitsFrom, loudness, fades, … } below.
 */
(function (root, factory) {
  if (typeof module === 'object' && module && module.exports) { module.exports = factory(require('../score/flpt-score.js')); return; }
  importScripts('../score/flpt-score.js');
  const api = factory(root.flptScore);
  root.onmessage = (e) => api.onMessage(e.data, (msg, transfer) => root.postMessage(msg, transfer));
})(typeof self !== 'undefined' ? self : this, function (S) {
  'use strict';

  const VERSION = '1.1.0';
  // The stem's numbers (mixer.js BED, INTER, SFX_LEVEL; PLAN §2.6). A test holds them equal.
  const LEVELS = Object.freeze({
    bedLufs: -26, fullLufs: -21, fadeIn: 1.0, fadeOut: 1.8, bedLimitDbfs: -3, fullLimitDbfs: -2, duckDb: 8,
    sfx: Object.freeze({ off: null, soft: -6, on: 0 }),
  });
  const RATES = [22050, 44100, 48000, 88200, 96000];
  const dbToGain = (db) => Math.pow(10, db / 20);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  // ── the hits (score.hitsFrom, line for line) ─────────────────────────────────────────────────────────────────────
  /**
   * The hits a piece's effects land on, in its own time: each beat's `sfx` (a kind, { kind, offset, gain }, or a list)
   * at the beat's t + offset, and the scene's hits(ctx). Unknown kinds and times outside the piece are dropped; gain is
   * held to -24..+2 dB; one hit per kind within 10 ms. → [{ at, kind, gain, from, beat? }] in time order
   */
  function hitsFrom({ beats = [], hits = [], seconds = Infinity } = {}) {
    const out = [];
    const add = (t, kind, gain, from, beat) => {
      if (!S.SFX_KINDS.includes(kind) || !Number.isFinite(t) || t < 0 || t >= seconds) return;
      const g = Number.isFinite(gain) ? Math.max(-24, Math.min(2, gain)) : 0;
      const h = { at: +t.toFixed(6), kind, gain: g, from };
      if (beat != null) h.beat = String(beat).slice(0, 64);
      out.push(h);
    };
    for (const b of Array.isArray(beats) ? beats : []) {
      if (!b || b.sfx == null || !Number.isFinite(Number(b.t))) continue;
      for (const x of [].concat(b.sfx)) {
        const o = typeof x === 'string' ? { kind: x } : (x || {});
        const id = b.id != null ? b.id : b.cue != null ? b.cue : b.at != null ? b.at : null;
        add(Number(b.t) + (Number(o.offset) || 0), o.kind, Number(o.gain) || 0, 'beat', id);
      }
    }
    for (const h of Array.isArray(hits) ? hits : []) if (h) add(Number(h.t), h.kind, Number(h.gain) || 0, 'hit');
    out.sort((a, b) => a.at - b.at || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
    return out.filter((h, i) => !out.slice(0, i).some((p) => p.kind === h.kind && Math.abs(p.at - h.at) < 0.01));
  }
  /** Each hit's one-shot seed, as score.plan() numbers them: the n-th of its kind, in time order. */
  function seeded(placed, seed) {
    const seen = {};
    return placed.map((h) => { const n = (seen[h.kind] = (seen[h.kind] || 0) + 1); return { ...h, seed: `${seed}:sfx:${h.kind}:${n}` }; });
  }

  // ── loudness (BS.1770-4: K-weighting from its analogue prototypes, so any rate; mixer.js's at 48 kHz) ────────────
  function kcoef(sr) {
    let f0 = 1681.974450955533, Q = 0.7071752369554196;
    const G = 3.999843853973347;
    let K = Math.tan(Math.PI * f0 / sr);
    const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    const a0 = 1 + K / Q + K * K;
    const pre = { b: [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0], a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] };
    f0 = 38.13547087602444; Q = 0.5003270373238773; K = Math.tan(Math.PI * f0 / sr);
    const r0 = 1 + K / Q + K * K;
    const rlb = { b: [1, -2, 1], a: [2 * (K * K - 1) / r0, (1 - K / Q + K * K) / r0] };
    return { pre, rlb };
  }
  /** Per-block mean squares (summed over the channels) of 400 ms blocks every 100 ms. */
  function blocks(channels, sr) {
    const n = channels[0].length;
    const B = Math.round(0.4 * sr), H = Math.round(0.1 * sr);
    const { pre, rlb } = kcoef(sr);
    const sums = channels.map((x) => {
      const p = new Float64Array(n + 1);
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0, z1 = 0, z2 = 0;
      for (let i = 0; i < n; i++) {
        const v = x[i];
        const y = pre.b[0] * v + pre.b[1] * x1 + pre.b[2] * x2 - pre.a[0] * y1 - pre.a[1] * y2; x2 = x1; x1 = v;
        const w = y - 2 * y1 + y2 - rlb.a[0] * z1 - rlb.a[1] * z2; y2 = y1; y1 = y;
        z2 = z1; z1 = w;
        p[i + 1] = p[i] + w * w;
      }
      return p;
    });
    const z = [];
    for (let s = 0; s + B <= n; s += H) { let acc = 0; for (const p of sums) acc += (p[s + B] - p[s]) / B; z.push(acc); }
    return z;
  }
  const LK = (z) => -0.691 + 10 * Math.log10(z);
  /** Integrated loudness in LUFS (-Infinity for silence). channels: Float32Array or Float64Array, at sr. */
  function loudness(channels, sr) {
    const z = blocks(channels, sr);
    const sel = z.filter((v) => LK(v) > -70);
    if (!sel.length) return -Infinity;
    const rel = LK(sel.reduce((a, b) => a + b, 0) / sel.length) - 10;
    const g = sel.filter((v) => LK(v) > rel);
    return LK(g.reduce((a, b) => a + b, 0) / g.length);
  }

  // ── the pieces of the mix ────────────────────────────────────────────────────────────────────────────────────────
  /** The stem's fades for a piece of this length (mixer.graphs.fades): 1.0 s in, 1.8 s out, shorter under ~3 s. */
  function fades(seconds) { return { fadeIn: Math.min(LEVELS.fadeIn, seconds / 3), fadeOut: Math.min(LEVELS.fadeOut, seconds / 2) }; }
  function applyFades(ch, sr) {
    const n = ch[0].length, sec = n / sr;
    const { fadeIn, fadeOut } = fades(sec);
    const a = Math.round(fadeIn * sr), b0 = n - Math.round(fadeOut * sr), nb = n - b0;
    for (let i = 0; i < a && i < n; i++) { const g = i / a; for (const c of ch) c[i] *= g; }
    for (let i = Math.max(0, b0); i < n; i++) { const g = (n - i) / nb; for (const c of ch) c[i] *= g; }
  }
  /** A zero-latency peak limiter: instant attack, 60 ms release, so no hit moves. */
  function limit(L, R, ceilDb, sr) {
    const c = dbToGain(ceilDb), rel = Math.exp(-1 / (0.06 * sr));
    let g = 1;
    for (let i = 0; i < L.length; i++) {
      const p = Math.max(Math.abs(L[i]), Math.abs(R[i]));
      const want = p > c ? c / p : 1;
      g = want < g ? want : want + (g - want) * rel;
      if (g < 1) { L[i] *= g; R[i] *= g; }
    }
  }
  /** Music of exactly n samples from decoded channels (cut, or padded with silence). */
  function fit(ch, n) {
    const out = [new Float32Array(n), new Float32Array(n)];
    const l = ch && ch.left, r = ch && (ch.right || ch.left);
    if (l) { out[0].set(l.subarray(0, Math.min(n, l.length))); out[1].set(r.subarray(0, Math.min(n, r.length))); }
    return out;
  }

  /**
   * The preview's sound, built as the stem is.
   * o: { preset (a preset object: the score) | music: { left, right } (a track or file, already the piece's excerpt, at
   *      sampleRate) | neither (no music), seconds, seed, sfx: 'off'|'soft'|'on', hits: [{ t, kind, gain }], beats:
   *      [{ t, sfx }], sampleRate (48000), level: 'bed' (under a voice) | 'full' (alone), duck (dB, bed only: 0 when no
   *      voice plays beside it), twin (the same mix with the effects silent, as the mixer's twin: what's left of the
   *      difference is the effects alone) }
   * → { sampleRate, n, left, right, level, lufs (the whole), musicLufs (before levelling), gainDb, placed: [{ at, kind,
   *     gain, seed, sample, anchor }] }
   */
  function mix(o) {
    const sr = RATES.includes(o.sampleRate) ? o.sampleRate : 48000;
    const seconds = Number(o.seconds);
    if (!(seconds > 0)) throw new Error('A preview needs a length.');
    const n = Math.round(seconds * sr);
    const seed = String(o.seed == null ? 'flpt' : o.seed);
    const level = o.level === 'bed' ? 'bed' : 'full';
    const sfxDb = own(LEVELS.sfx, o.sfx) ? LEVELS.sfx[o.sfx] : null;

    let music = null;
    if (o.preset) {
      const r = S.render({ preset: o.preset, seconds: n / sr, seed, sampleRate: sr });
      music = [r.left, r.right];
    } else if (o.music && o.music.left) music = fit(o.music, n);
    if (music) applyFades(music, sr);
    const musicLufs = music ? loudness(music, sr) : null;

    const placed = sfxDb == null ? [] : seeded(hitsFrom({ beats: o.beats, hits: o.hits, seconds: n / sr }), seed);
    const fx = placed.length ? [new Float32Array(n), new Float32Array(n)] : null;
    const fxGain = sfxDb == null ? 0 : dbToGain(sfxDb);
    const fxOut = o.twin ? 0 : 1; // the twin: every level as with the effects, the effects themselves silent
    for (const h of placed) {
      const s = S.sfx(h.kind, { seed: h.seed, gain: h.gain, sampleRate: sr });
      h.anchor = s.anchor;
      h.sample = Math.round(h.at * sr);
      const at = h.sample - s.anchor;
      for (let i = Math.max(0, -at); i < s.left.length && at + i < n; i++) { fx[0][at + i] += s.left[i] * fxGain; fx[1][at + i] += s.right[i] * fxGain; }
    }

    const left = new Float32Array(n), right = new Float32Array(n);
    let gainDb = 0;
    if (level === 'bed') {
      // the bed: the music at -26 LUFS, ducked under the voice; the effects on top at their own level
      if (music && Number.isFinite(musicLufs)) gainDb = LEVELS.bedLufs - musicLufs;
      const g = music ? dbToGain(gainDb - (Number(o.duck) || 0)) : 0;
      for (let i = 0; i < n; i++) {
        left[i] = (music ? music[0][i] * g : 0) + (fx ? fx[0][i] * fxOut : 0);
        right[i] = (music ? music[1][i] * g : 0) + (fx ? fx[1][i] * fxOut : 0);
      }
      limit(left, right, LEVELS.bedLimitDbfs, sr);
    } else {
      // alone: music and effects together at -21 LUFS, as interstitialStem levels it: measured, the gain applied, the
      // peaks held, and the gain trimmed again (at most 3 passes) when holding them cost loudness; effects only keep
      // their own level. The twin takes the same gain with the effects silent.
      const render = (db, fxScale, held) => {
        const g = dbToGain(db);
        for (let i = 0; i < n; i++) {
          left[i] = ((music ? music[0][i] : 0) + (fx ? fx[0][i] * fxScale : 0)) * g;
          right[i] = ((music ? music[1][i] : 0) + (fx ? fx[1][i] * fxScale : 0)) * g;
        }
        if (held) limit(left, right, music ? LEVELS.fullLimitDbfs : LEVELS.bedLimitDbfs, sr);
      };
      if (music) {
        render(0, 1, false);
        const pre = loudness([left, right], sr);
        if (Number.isFinite(pre)) gainDb = LEVELS.fullLufs - pre;
      }
      for (let pass = 0; pass < 3; pass++) {
        render(gainDb, 1, true);
        if (!music) break;
        const I = loudness([left, right], sr);
        if (!Number.isFinite(I) || Math.abs(I - LEVELS.fullLufs) <= 0.1) break;
        gainDb += LEVELS.fullLufs - I;
      }
      if (fx && !fxOut) render(gainDb, 0, true);
    }
    const lufs = loudness([left, right], sr);
    return { sampleRate: sr, n, left, right, level, lufs, musicLufs, gainDb: +gainDb.toFixed(3), placed };
  }

  // ── the Worker's message ─────────────────────────────────────────────────────────────────────────────────────────
  /** One message from the harness (validated here: the harness passes the piece's own hits along). */
  function onMessage(m, post) {
    if (!m || m.op !== 'render') return;
    try {
      const seconds = Math.max(0.1, Math.min(3600, Number(m.seconds) || 0));
      const hits = (Array.isArray(m.hits) ? m.hits : []).slice(0, 500);
      const beats = (Array.isArray(m.beats) ? m.beats : []).slice(0, 500);
      const sfx = own(LEVELS.sfx, m.sfx) ? m.sfx : 'off';
      const music = !m.preset && m.music && m.music.left instanceof Float32Array ? { left: m.music.left, right: m.music.right instanceof Float32Array ? m.music.right : m.music.left } : null;
      const r = mix({ preset: m.preset, music, seconds, seed: Number.isFinite(m.seed) ? m.seed : 1, sfx, hits, beats,
        sampleRate: m.sampleRate, level: m.voiced ? 'bed' : 'full', duck: m.voiced ? LEVELS.duckDb : 0 });
      post({ op: 'pcm', id: m.id, sampleRate: r.sampleRate, left: r.left, right: r.right, gain: 1, lufs: Number.isFinite(r.lufs) ? r.lufs : null,
        level: r.level, hits: r.placed.map((h) => h.at) }, [r.left.buffer, r.right.buffer]);
    } catch (err) {
      post({ op: 'error', id: m.id, msg: String((err && err.message) || err).slice(0, 200) });
    }
  }

  return { VERSION, LEVELS, RATES, hitsFrom, loudness, fades, mix, onMessage, kcoef };
});
