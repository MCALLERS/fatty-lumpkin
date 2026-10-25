/* flpt-score.js · FLPT's deterministic score (PLAN §2.6), the music and sound effects of a Live Motion piece.
 *
 * Pure JavaScript DSP over Float64Array buses, Float32Array out. No WebAudio, no Date, no Math.random,
 * no timers, no I/O: the same call gives the same samples in Node, in a browser Worker (the Stage) and in
 * JavaScriptCore. Spike K4 measured it bit-identical across Node 26, Chrome 152, Electron 44 and JSC; the
 * cross-engine contract stays a residual under -90 dBFS (libm may differ by an ulp between engines).
 *
 * Clean-room: written from textbook DSP only (Karplus-Strong plucked string, the topology-preserving
 * state-variable filter, polyBLEP saws, the published public-domain Freeverb structure, RMS levelling
 * with a peak ceiling). Nothing here is ported from another score or synth codebase.
 *
 *   render({ preset, seconds, seed, bpm?, offset?, sections?, hits?, sampleRate?, stems? })
 *     → { version, sampleRate, left, right, grid: { bpm, offset, bars, beats, ... }, plan, stems? }
 *   sfx(kind, { seed, gain, sampleRate? }) → { kind, sampleRate, left, right, anchor }   (10 kinds, SFX_KINDS)
 *   resolveAt(grid, at) → seconds or null   ("bar 2", "beat 9", "bar 3 beat 2", 12.5, "12.5s")
 * `preset` is the preset object (score/presets/<id>.json; PRESETS lists the shipped ones).
 *
 * Works as a classic script (sets self.flptScore: importScripts in a Worker, <script> in a page)
 * and as CommonJS (require in Node).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else if (root) root.flptScore = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  const VERSION = '1.0.0';
  const PRESETS = ['pulse-112', 'drift-90', 'march-128', 'hush'];
  const TAU = 2 * Math.PI;
  const SFX_KINDS = ['click', 'tick', 'pop', 'swish', 'whoosh', 'thump', 'crack', 'chime', 'sub', 'riser'];
  const SFX_PEAK_DB = -8;           // a hit at gain 0 peaks here; gain is capped at +2 so peaks stay <= -6 dBFS

  // ── keyed randomness (FNV-1a → mulberry32), integer ops only ─────────────────────────────────
  function fnv1a(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function keyed(seed, ...keys) {
    const r = mulberry32(fnv1a(String(seed) + '␟' + keys.join('␟')));
    return {
      r,
      n: () => 2 * r() - 1,
      i: (a, b) => a + Math.floor(r() * (b - a + 1)),
      pick: (arr) => arr[Math.floor(r() * arr.length)],
      chance: (p) => r() < p,
    };
  }

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const dbToGain = (db) => Math.pow(10, db / 20);

  // ── building blocks ─────────────────────────────────────────────────────────────────────────
  // Topology-preserving state-variable filter (trapezoidal integration). lp/bp/hp from one tick.
  function SVF() { this.ic1 = 0; this.ic2 = 0; this.a1 = 1; this.a2 = 0; this.a3 = 0; this.k = 1.4; this.lp = 0; this.bp = 0; this.hp = 0; }
  SVF.prototype.set = function (fc, q, sr) {
    const g = Math.tan(Math.PI * Math.min(Math.max(fc, 10), sr * 0.45) / sr);
    this.k = 1 / q;
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  };
  SVF.prototype.tick = function (v0) {
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.lp = v2; this.bp = v1; this.hp = v0 - this.k * v1 - v2;
    return v2;
  };

  function polyblep(t, dt) {
    if (t < dt) { t /= dt; return t + t - t * t - 1; }
    if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
    return 0;
  }

  function fadeTail(x, m) {
    const n = x.length; m = Math.min(m, n);
    for (let i = 0; i < m; i++) x[n - 1 - i] *= i / m;
  }

  // Stereo accumulation bus with a reverb send.
  function Bus(n) {
    this.n = n;
    this.L = new Float64Array(n); this.R = new Float64Array(n);
    this.sL = new Float64Array(n); this.sR = new Float64Array(n);
  }
  Bus.prototype.addMono = function (start, x, g, pan, send) {
    const a = (pan + 1) * Math.PI / 4;
    const gl = Math.cos(a) * g, gr = Math.sin(a) * g;
    const i0 = Math.max(0, -start), i1 = Math.min(x.length, this.n - start);
    for (let i = i0; i < i1; i++) {
      const j = start + i, v = x[i];
      this.L[j] += v * gl; this.R[j] += v * gr;
      if (send) { this.sL[j] += v * gl * send; this.sR[j] += v * gr * send; }
    }
  };
  Bus.prototype.addStereo = function (start, xl, xr, g, send) {
    const i0 = Math.max(0, -start), i1 = Math.min(xl.length, this.n - start);
    for (let i = i0; i < i1; i++) {
      const j = start + i;
      this.L[j] += xl[i] * g; this.R[j] += xr[i] * g;
      if (send) { this.sL[j] += xl[i] * g * send; this.sR[j] += xr[i] * g * send; }
    }
  };

  // ── instruments (mono Float64Array or {l, r}) ───────────────────────────────────────────────
  // Plucked string: Karplus-Strong loop, two-point average + first-order allpass for exact tuning.
  function pluck(sr, f, dur, o, rng) {
    const n = Math.max(1, Math.round(dur * sr));
    const out = new Float64Array(n);
    const D = sr / f - 0.5;
    let L = Math.floor(D), fr = D - L;
    if (fr < 0.2) { L -= 1; fr += 1; }
    const C = (1 - fr) / (1 + fr);
    const buf = new Float64Array(L);
    const k = 0.15 + 0.8 * (o.bright == null ? 0.5 : o.bright);
    let lp = 0, mean = 0;
    for (let i = 0; i < L; i++) { lp += k * (rng.n() - lp); buf[i] = lp; mean += lp; }
    mean /= L;
    for (let i = 0; i < L; i++) buf[i] -= mean;
    const rho = Math.pow(10, -3 / ((o.t60 || 1.2) * f));
    let p = 0, prev = 0, apx = 0, apy = 0;
    for (let i = 0; i < n; i++) {
      const x = buf[p];
      const avg = 0.5 * (x + prev); prev = x;
      const y = C * (avg - apy) + apx; apx = avg; apy = y;
      buf[p] = rho * y;
      if (++p === L) p = 0;
      out[i] = x;
    }
    fadeTail(out, Math.round(0.02 * sr));
    return out;
  }

  // Pad: three detuned polyBLEP saws per note spread across the field, SVF low-pass with a slow LFO.
  function pad(sr, freqs, hold, o, rng) {
    const att = o.attack || 0.5, rel = o.release || 1.2;
    const n = Math.round((hold + rel) * sr);
    const l = new Float64Array(n), r = new Float64Array(n);
    const det = o.detune == null ? 0.1 : o.detune;
    const W = [[0.85, 0.15], [0.5, 0.5], [0.15, 0.85]];
    for (const f of freqs) {
      for (let v = 0; v < 3; v++) {
        const fv = f * Math.pow(2, ((v - 1) * det + 0.01 * rng.n()) / 12);
        const dt = fv / sr;
        let ph = rng.r();
        const wl = W[v][0], wr = W[v][1];
        for (let i = 0; i < n; i++) {
          const s = 2 * ph - 1 - polyblep(ph, dt);
          ph += dt; if (ph >= 1) ph -= 1;
          l[i] += s * wl; r[i] += s * wr;
        }
      }
    }
    const fl = new SVF(), frr = new SVF();
    const cut = o.cutoff || 1200, q = o.q || 0.7, lfo = o.lfo || 0.12, lph = rng.r(), depth = o.lfoDepth == null ? 0.5 : o.lfoDepth;
    const scale = 1 / (freqs.length * 1.5);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      if ((i & 31) === 0) {
        const fc = cut * Math.pow(2, depth * Math.sin(TAU * (lfo * t + lph)));
        fl.set(fc, q, sr); frr.set(fc, q, sr);
      }
      let e;
      if (t < att) { e = t / att; e = e * e * (3 - 2 * e); } else if (t < hold) e = 1; else { e = 1 - (t - hold) / rel; e = e > 0 ? e * e : 0; }
      l[i] = fl.tick(l[i]) * e * scale;
      r[i] = frr.tick(r[i]) * e * scale;
    }
    return { l, r };
  }

  // Drone: root, fifth and octave sines with a slow beating swell.
  function drone(sr, f, hold, o, rng) {
    const att = o.attack || 2, rel = o.release || 2.5;
    const n = Math.round((hold + rel) * sr);
    const l = new Float64Array(n), r = new Float64Array(n);
    const parts = [[1, 1, -0.3], [1.5, 0.45, 0.35], [2, 0.3, 0], [1.003, 0.6, 0.3]];
    for (const [m, a, pan] of parts) {
      const dt = f * m / sr; let ph = rng.r();
      const gl = Math.cos((pan + 1) * Math.PI / 4) * a, gr = Math.sin((pan + 1) * Math.PI / 4) * a;
      for (let i = 0; i < n; i++) { const s = Math.sin(TAU * ph); ph += dt; if (ph >= 1) ph -= 1; l[i] += s * gl; r[i] += s * gr; }
    }
    const am = o.am || 0.07, aph = rng.r();
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let e;
      if (t < att) { e = t / att; e = e * e * (3 - 2 * e); } else if (t < hold) e = 1; else { e = 1 - (t - hold) / rel; e = e > 0 ? e * e : 0; }
      const w = e * (0.8 + 0.2 * Math.sin(TAU * (am * t + aph))) * 0.4;
      l[i] *= w; r[i] *= w;
    }
    return { l, r };
  }

  // Bass: sine plus second harmonic, soft-saturated, low-passed, plucky envelope.
  function bass(sr, f, dur, o) {
    const n = Math.round((dur + 0.03) * sr);
    const out = new Float64Array(n);
    const drive = o.drive || 2.2, dec = o.decay || 0.2;
    const svf = new SVF(); svf.set(o.cutoff || 520, 0.8, sr);
    const norm = 1 / Math.tanh(drive);
    let ph = 0; const dt = f / sr;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const s = Math.sin(TAU * ph) + 0.35 * Math.sin(2 * TAU * ph);
      ph += dt; if (ph >= 1) ph -= 1;
      let a = Math.min(1, t / 0.004) * Math.exp(-t / dec);
      if (t > dur) a *= Math.max(0, 1 - (t - dur) / 0.03);
      out[i] = svf.tick(Math.tanh(drive * s) * norm) * a;
    }
    return out;
  }

  // Kick / thump: a sine whose pitch falls fast, with a short click.
  function kick(sr, o, rng) {
    const dur = o.dur || 0.45;
    const n = Math.round(dur * sr);
    const out = new Float64Array(n);
    const f0 = o.f0 || 130, f1 = o.f1 || 48, fd = o.fdec || 0.04, ad = o.adec || 0.16, click = o.click == null ? 0.25 : o.click;
    const lp = new SVF(); lp.set(3500, 0.7, sr);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const f = f1 + (f0 - f1) * Math.exp(-t / fd);
      ph += f / sr; if (ph >= 1) ph -= 1;
      const a = Math.exp(-t / ad) * Math.min(1, t / 0.0012);
      let v = Math.sin(TAU * ph) * a;
      if (t < 0.004) v += lp.tick(rng.n()) * click * (1 - t / 0.004); else lp.tick(0);
      out[i] = v;
    }
    fadeTail(out, Math.round(0.01 * sr));
    return out;
  }

  // Filtered noise hit: hats, snares, clicks, cracks.
  function noiseHit(sr, o, rng) {
    const dur = o.dur || 0.15, dec = o.dec || 0.04;
    const n = Math.round(dur * sr);
    const out = new Float64Array(n);
    const svf = new SVF(); svf.set(o.freq || 8000, o.q || 0.7, sr);
    const mode = o.mode || 'hp', body = o.body || 0, bodyHz = o.bodyHz || 190, bodyDec = o.bodyDec || 0.06;
    const att = o.att || 0.0005;
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      svf.tick(rng.n());
      const y = mode === 'bp' ? svf.bp : mode === 'lp' ? svf.lp : svf.hp;
      let v = y * Math.exp(-t / dec);
      if (body) { ph += bodyHz / sr; if (ph >= 1) ph -= 1; v += body * Math.sin(TAU * ph) * Math.exp(-t / bodyDec); }
      out[i] = v * Math.min(1, t / att);
    }
    fadeTail(out, Math.round(0.005 * sr));
    return out;
  }

  // Sub drop: a long sine fall into the floor.
  function subDrop(sr, o, rng) {
    return kick(sr, { dur: o.dur || 1.8, f0: o.f0 || 110, f1: o.f1 || 34, fdec: o.fdec || 0.32, adec: o.adec || 0.7, click: o.click == null ? 0.15 : o.click }, rng);
  }

  // Riser: band-passed noise sweeping up plus a rising saw; ends hard at dur.
  function riser(sr, dur, o, rng, rng2) {
    const n = Math.round(dur * sr);
    const l = new Float64Array(n), r = new Float64Array(n);
    const fa = o.from || 300, fb = o.to || 7000, sa = o.sawFrom || 110, sb = o.sawTo || 440, saw = o.saw == null ? 0.25 : o.saw;
    const bl = new SVF(), br = new SVF(), sl = new SVF();
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      if ((i & 31) === 0) { const fc = fa * Math.pow(fb / fa, u); bl.set(fc, 2.5, sr); br.set(fc * 1.06, 2.5, sr); sl.set(fc * 0.7, 0.8, sr); }
      bl.tick(rng.n()); br.tick(rng2.n());
      const fs = sa * Math.pow(sb / sa, u), dt = fs / sr;
      const s = 2 * ph - 1 - polyblep(ph, dt); ph += dt; if (ph >= 1) ph -= 1;
      const sv = sl.tick(s) * saw;
      const e = Math.pow(u, 2.2);
      l[i] = (bl.bp * 1.4 + sv) * e;
      r[i] = (br.bp * 1.4 + sv) * e;
    }
    const m = Math.round(0.006 * sr);
    for (let i = 0; i < m; i++) { const g = i / m; l[n - 1 - i] *= g; r[n - 1 - i] *= g; }
    return { l, r };
  }

  // Chime: inharmonic bar partials with a slight stereo beat.
  function chime(sr, f, o) {
    const dur = o.dur || 2.4, base = o.decay || 1.4;
    const n = Math.round(dur * sr);
    const l = new Float64Array(n), r = new Float64Array(n);
    const P = [[1, 1, 1], [2.756, 0.45, 0.6], [5.404, 0.22, 0.33], [8.933, 0.1, 0.18]];
    for (const [m, a, d] of P) {
      const fl = f * m, frr = f * m + 1.3;
      let pl = 0, pr = 0.25;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const e = a * Math.exp(-t / (base * d)) * Math.min(1, t / 0.0015);
        l[i] += Math.sin(TAU * pl) * e; r[i] += Math.sin(TAU * pr) * e;
        pl += fl / sr; if (pl >= 1) pl -= 1;
        pr += frr / sr; if (pr >= 1) pr -= 1;
      }
    }
    fadeTail(l, Math.round(0.05 * sr)); fadeTail(r, Math.round(0.05 * sr));
    return { l, r };
  }

  // Swept noise (swish, whoosh): band-pass sweep, bell envelope peaking at `peak` (0..1), pan sweep.
  function sweep(sr, o, rng, rng2) {
    const dur = o.dur, n = Math.round(dur * sr), pk = o.peak;
    const l = new Float64Array(n), r = new Float64Array(n);
    const bl = new SVF(), br = new SVF();
    for (let i = 0; i < n; i++) {
      const u = i / n;
      if ((i & 15) === 0) { const fc = o.from * Math.pow(o.to / o.from, u); bl.set(fc, o.q || 1.2, sr); br.set(fc * 1.04, o.q || 1.2, sr); }
      bl.tick(rng.n()); br.tick(rng2.n());
      const e = u < pk ? Math.pow(u / pk, o.rise || 2) : Math.pow(1 - (u - pk) / (1 - pk), o.fall || 1.6);
      const p = o.panFrom + (o.panTo - o.panFrom) * u, a = (p + 1) * Math.PI / 4;
      l[i] = bl.bp * e * Math.cos(a) * 1.4;
      r[i] = br.bp * e * Math.sin(a) * 1.4;
    }
    return { l, r, anchor: Math.round(pk * n) };
  }

  // ── Freeverb-style reverb (Jezar's public-domain structure: 8 LP-comb + 4 allpass per side) ──
  const COMB = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const ALLP = [556, 441, 341, 225];
  const SPREAD = 23;
  function freeverb(inL, inR, sr, o) {
    const n = inL.length, sc = sr / 44100;
    const room = o.room == null ? 0.8 : o.room, damp = o.damp == null ? 0.5 : o.damp;
    const wet = o.wet == null ? 0.33 : o.wet, width = o.width == null ? 1 : o.width;
    const fb = room * 0.28 + 0.7, d1 = damp * 0.4, d2 = 1 - d1;
    const mk = (len) => ({ buf: new Float64Array(Math.max(1, Math.round(len * sc))), i: 0, st: 0 });
    const cl = COMB.map((x) => mk(x)), cr = COMB.map((x) => mk(x + SPREAD));
    const al = ALLP.map((x) => mk(x)), ar = ALLP.map((x) => mk(x + SPREAD));
    const outL = new Float64Array(n), outR = new Float64Array(n);
    const w1 = wet * (width / 2 + 0.5), w2 = wet * ((1 - width) / 2);
    const pre = Math.round((o.predelay || 0) * sr);
    for (let s = 0; s < n; s++) {
      const k = s - pre;
      const input = k >= 0 ? (inL[k] + inR[k]) * 0.015 : 0;
      let yl = 0, yr = 0;
      for (let c = 0; c < 8; c++) {
        let cb = cl[c], o1 = cb.buf[cb.i];
        cb.st = o1 * d2 + cb.st * d1; cb.buf[cb.i] = input + cb.st * fb; if (++cb.i === cb.buf.length) cb.i = 0; yl += o1;
        cb = cr[c]; o1 = cb.buf[cb.i];
        cb.st = o1 * d2 + cb.st * d1; cb.buf[cb.i] = input + cb.st * fb; if (++cb.i === cb.buf.length) cb.i = 0; yr += o1;
      }
      for (let a = 0; a < 4; a++) {
        let ap = al[a], bo = ap.buf[ap.i];
        ap.buf[ap.i] = yl + bo * 0.5; if (++ap.i === ap.buf.length) ap.i = 0; yl = bo - yl;
        ap = ar[a]; bo = ap.buf[ap.i];
        ap.buf[ap.i] = yr + bo * 0.5; if (++ap.i === ap.buf.length) ap.i = 0; yr = bo - yr;
      }
      outL[s] = yl * w1 + yr * w2;
      outR[s] = yr * w1 + yl * w2;
    }
    return { l: outL, r: outR };
  }

  // ── SFX one-shots ──────────────────────────────────────────────────────────────────────────
  // Returns { left, right, anchor, sampleRate, kind }: anchor = the sample that lands on the hit's t
  // (0 for attacks; the swell's peak for swish and whoosh; the end for riser).
  function sfx(kind, opts) {
    opts = opts || {};
    const sr = opts.sampleRate || 48000;
    const seed = opts.seed == null ? 'flpt' : opts.seed;
    const rng = keyed(seed, 'sfx', kind, 'a'), rng2 = keyed(seed, 'sfx', kind, 'b');
    let l, r, anchor = 0;
    const mono = (x) => { l = x; r = Float64Array.from(x); };
    switch (kind) {
      case 'click': {
        const a = noiseHit(sr, { mode: 'bp', freq: 3200, q: 1.6, dec: 0.0035, dur: 0.03 }, rng);
        const b = noiseHit(sr, { mode: 'bp', freq: 2100, q: 6, dec: 0.006, dur: 0.03, body: 0.6, bodyHz: 2100, bodyDec: 0.005 }, rng2);
        for (let i = 0; i < a.length; i++) a[i] = a[i] + 0.5 * b[i];
        mono(a); break;
      }
      case 'tick': {
        const n = Math.round(0.07 * sr), x = new Float64Array(n);
        let p1 = 0, p2 = 0.3;
        for (let i = 0; i < n; i++) {
          const t = i / sr;
          x[i] = (Math.sin(TAU * p1) + 0.4 * Math.sin(TAU * p2)) * Math.exp(-t / 0.011) * Math.min(1, t / 0.0004);
          p1 += 4300 / sr; if (p1 >= 1) p1 -= 1;
          p2 += 6650 / sr; if (p2 >= 1) p2 -= 1;
        }
        const h = noiseHit(sr, { mode: 'hp', freq: 6000, dec: 0.002, dur: 0.07 }, rng);
        for (let i = 0; i < n; i++) x[i] += 0.35 * h[i];
        fadeTail(x, Math.round(0.005 * sr)); mono(x); break;
      }
      case 'pop': {
        const n = Math.round(0.14 * sr), x = new Float64Array(n);
        let ph = 0;
        for (let i = 0; i < n; i++) {
          const t = i / sr;
          const f = 260 + 720 * (1 - Math.exp(-t / 0.009)) - 200 * (t / 0.14);
          ph += f / sr; if (ph >= 1) ph -= 1;
          x[i] = Math.sin(TAU * ph) * Math.exp(-t / 0.035) * Math.min(1, t / 0.0008);
        }
        fadeTail(x, Math.round(0.006 * sr)); mono(x); break;
      }
      case 'swish': { const s = sweep(sr, { dur: 0.32, peak: 0.42, from: 1400, to: 7500, q: 1.1, panFrom: -0.6, panTo: 0.6, rise: 2, fall: 1.5 }, rng, rng2); l = s.l; r = s.r; anchor = s.anchor; break; }
      case 'whoosh': { const s = sweep(sr, { dur: 0.8, peak: 0.6, from: 220, to: 2600, q: 0.9, panFrom: 0.7, panTo: -0.7, rise: 2.2, fall: 1.4 }, rng, rng2); l = s.l; r = s.r; anchor = s.anchor; break; }
      case 'thump': {
        const k = kick(sr, { dur: 0.5, f0: 98, f1: 42, fdec: 0.05, adec: 0.17, click: 0.35 }, rng);
        mono(k); break;
      }
      case 'crack': {
        const a = noiseHit(sr, { mode: 'hp', freq: 1400, q: 0.8, dec: 0.016, dur: 0.22, att: 0.0002 }, rng);
        const b = noiseHit(sr, { mode: 'bp', freq: 2600, q: 2, dec: 0.01, dur: 0.22 }, rng2);
        const off = Math.round(0.009 * sr);
        for (let i = off; i < a.length; i++) a[i] += 0.5 * b[i - off];
        mono(a); break;
      }
      case 'chime': {
        const notes = [79, 81, 83, 86, 88];   // G5 A5 B5 D6 E6
        const c = chime(sr, mtof(opts.note || keyed(seed, 'sfx', 'chime', 'note').pick(notes)), { dur: 2.2, decay: 1.2 });
        l = c.l; r = c.r; break;
      }
      case 'sub': { mono(subDrop(sr, {}, rng)); break; }
      case 'riser': {
        const dur = opts.dur || 1.5;
        const s = riser(sr, dur, { from: 350, to: 8000, saw: 0.3 }, rng, rng2);
        l = s.l; r = s.r; anchor = l.length; break;
      }
      default: throw new Error('flpt-score: unknown sfx kind ' + kind);
    }
    let peak = 0;
    for (let i = 0; i < l.length; i++) { const a = Math.abs(l[i]), b = Math.abs(r[i]); if (a > peak) peak = a; if (b > peak) peak = b; }
    const g = peak > 0 ? dbToGain(SFX_PEAK_DB + Math.min(2, opts.gain || 0)) / peak : 0;
    const left = new Float32Array(l.length), right = new Float32Array(r.length);
    for (let i = 0; i < l.length; i++) { left[i] = l[i] * g; right[i] = r[i] * g; }
    return { kind, sampleRate: sr, left, right, anchor };
  }

  // ── arrangement ────────────────────────────────────────────────────────────────────────────
  // Intro first, outro last, the middle sections cycle to fill; a section cut short keeps its start.
  function arrange(sections, totalBars) {
    const plan = [];
    const push = (sec, bars, inst) => {
      for (let k = 0; k < bars; k++) plan.push({ name: sec.name, layers: sec.layers, first: k === 0, last: k === bars - 1, k, bars, inst });
    };
    if (sections.length === 1) { push(sections[0], totalBars, 0); return plan; }
    const intro = sections[0], outro = sections[sections.length - 1], mid = sections.slice(1, -1);
    const ib = Math.min(intro.bars, Math.max(1, Math.floor(totalBars / 4)));
    const ob = Math.min(outro.bars, Math.max(0, totalBars - ib));
    push(intro, ib, 0);
    let left = totalBars - ib - ob, m = 0, inst = 1;
    while (left > 0 && mid.length) {
      const sec = mid[m % mid.length], bars = Math.min(sec.bars, left);
      push(sec, bars, inst++); left -= bars; m++;
    }
    if (left > 0) push(outro, left, inst++);
    push(outro, ob, inst);
    return plan;
  }

  // ── layers: what each named layer plays in one bar ─────────────────────────────────────────
  const LAYERS = {
    pad(c, b, bar, chord) {
      const o = c.ins.pad, bpc = c.preset.barsPerChord || 1;
      if (b % bpc !== 0 && !(bar.first)) return;
      const left = bpc - (b % bpc);
      const p = pad(c.sr, chord.pad.map(mtof), c.barDur * left, o, keyed(c.seed, 'pad', b));
      c.bus.addStereo(c.S(c.t0), p.l, p.r, dbToGain(o.gainDb || -12), o.send || 0.3);
    },
    drone(c, b, bar, chord) {
      const o = c.ins.drone, bpc = c.preset.barsPerChord || 1;
      if (b % bpc !== 0 && !(bar.first)) return;
      const left = bpc - (b % bpc);
      const d = drone(c.sr, mtof(chord.root + 12 * (o.octave || 0)), c.barDur * left, o, keyed(c.seed, 'drone', b));
      c.bus.addStereo(c.S(c.t0), d.l, d.r, dbToGain(o.gainDb || -14), o.send || 0.3);
    },
    pluck(c, b, bar, chord) {
      const o = c.ins.pluck;
      const pat = keyed(c.seed, 'pluck-pattern', bar.inst).pick(o.patterns);
      const steps = c.bpb * 2;
      for (let s = 0; s < steps; s++) {
        const idx = pat[s % pat.length];
        if (idx < 0) continue;
        const rr = keyed(c.seed, 'pluck', b, s);
        const m = chord.arp[idx % chord.arp.length] + 12 * (o.octave || 0);
        const vel = (s % 2 === 0 ? 1 : 0.72) * (0.85 + 0.15 * rr.r());
        const x = pluck(c.sr, mtof(m), o.dur || 0.9, o, rr);
        c.bus.addMono(c.S(c.t0 + s * c.spb / 2), x, dbToGain(o.gainDb || -10) * vel, (s % 4 < 2 ? -1 : 1) * (o.spread || 0.35), o.send || 0.35);
      }
    },
    pluckSparse(c, b, bar, chord) {
      const o = c.ins.pluck;
      for (let q = 0; q < c.bpb; q++) {
        const rr = keyed(c.seed, 'sparse', b, q);
        if (!rr.chance(q === 0 ? 0.9 : (o.sparse || 0.35))) continue;
        const m = rr.pick(chord.arp) + 12 * (o.octave || 0);
        const x = pluck(c.sr, mtof(m), (o.dur || 0.9) * 1.6, Object.assign({}, o, { t60: (o.t60 || 1.2) * 1.5 }), rr);
        c.bus.addMono(c.S(c.t0 + q * c.spb), x, dbToGain((o.gainDb || -10) - 2) * (0.8 + 0.2 * rr.r()), rr.n() * 0.5, (o.send || 0.35) * 1.4);
      }
    },
    bass(c, b, bar, chord) {
      const o = c.ins.bass;
      const pat = o.pattern || [1, 1, 1, 1, 1, 1, 1, 2];
      for (let s = 0; s < c.bpb * 2; s++) {
        const v = pat[s % pat.length];
        if (!v) continue;
        const m = chord.root + (v === 2 ? 12 : 0) + 12 * (o.octave || 0);
        const x = bass(c.sr, mtof(m), c.spb / 2 * 0.85, o);
        c.bus.addMono(c.S(c.t0 + s * c.spb / 2), x, dbToGain(o.gainDb || -9) * (s % 2 === 0 ? 1 : 0.8), 0, o.send || 0);
      }
    },
    hats(c, b) {
      const o = c.ins.hats;
      for (let s = 0; s < c.bpb * 4; s++) {
        const rr = keyed(c.seed, 'hats', b, s);
        const off = s % 4 === 2, ghost = s % 2 === 1 && rr.chance(o.ghost || 0.3);
        if (!off && !ghost) continue;
        const x = noiseHit(c.sr, { mode: 'hp', freq: o.freq || 7500, q: 0.8, dec: off ? (o.dec || 0.035) : 0.015, dur: 0.12 }, rr);
        c.bus.addMono(c.S(c.t0 + s * c.spb / 4), x, dbToGain(o.gainDb || -20) * (off ? 1 : 0.4) * (0.85 + 0.15 * rr.r()), o.pan || 0.25, o.send || 0.1);
      }
    },
    kick(c, b) { kickBeats(c, b, [0, 1, 2, 3]); },
    kickHalf(c, b) { kickBeats(c, b, [0, 2]); },
    snare(c, b) {
      const o = c.ins.snare;
      for (const q of [1, 3]) {
        const x = noiseHit(c.sr, { mode: 'bp', freq: o.freq || 1900, q: 0.9, dec: o.dec || 0.09, dur: 0.3, body: 0.5, bodyHz: 185, bodyDec: 0.05 }, keyed(c.seed, 'snare', b, q));
        c.bus.addMono(c.S(c.t0 + q * c.spb), x, dbToGain(o.gainDb || -14), -0.05, o.send || 0.25);
      }
    },
    // A field-drum figure on sixteenths: `pattern` (one velocity 0..1 per step, 0 = rest), `fill` on a section's last bar.
    snareMarch(c, b, bar) {
      const o = c.ins.snareMarch;
      const pat = bar.last && o.fill ? o.fill : o.pattern;
      for (let s = 0; s < c.bpb * 4; s++) {
        const v = pat[s % pat.length];
        if (!v) continue;
        const rr = keyed(c.seed, 'snareMarch', b, s);
        const accent = v >= 0.9, dec = o.dec || 0.07;
        const x = noiseHit(c.sr, { mode: 'bp', freq: o.freq || 2000, q: 0.9, dec: accent ? dec : dec * 0.55, dur: 0.22, body: accent ? 0.45 : 0.2, bodyHz: o.bodyHz || 200, bodyDec: 0.04 }, rr);
        c.bus.addMono(c.S(c.t0 + s * c.spb / 4), x, dbToGain(o.gainDb || -16) * v * (0.9 + 0.1 * rr.r()), o.pan == null ? -0.1 : o.pan, o.send || 0.2);
      }
    },
    riser(c, b, bar) {
      if (!bar.last) return;
      const o = c.ins.riser, dur = Math.min(bar.bars, o.bars || 2) * c.barDur;
      const end = c.t0 + c.barDur;
      const s = riser(c.sr, dur, o, keyed(c.seed, 'riser', b, 'l'), keyed(c.seed, 'riser', b, 'r'));
      c.bus.addStereo(c.S(end - dur), s.l, s.r, dbToGain(o.gainDb || -16), o.send || 0.4);
    },
    subDrop(c, b, bar) {
      if (!bar.first) return;
      const o = c.ins.subDrop;
      c.bus.addMono(c.S(c.t0), subDrop(c.sr, o, keyed(c.seed, 'sub', b)), dbToGain(o.gainDb || -8), 0, 0);
    },
    chimes(c, b) {
      const o = c.ins.chimes;
      for (let q = 0; q < c.bpb; q++) {
        const rr = keyed(c.seed, 'chimes', b, q);
        if (!rr.chance(o.prob || 0.3)) continue;
        const x = chime(c.sr, mtof(rr.pick(o.scale)), { dur: o.dur || 3, decay: o.decay || 1.6 });
        c.bus.addStereo(c.S(c.t0 + q * c.spb), x.l, x.r, dbToGain(o.gainDb || -18) * (0.6 + 0.4 * rr.r()), o.send || 0.6);
      }
    },
  };
  function kickBeats(c, b, beats) {
    const o = c.ins.kick;
    for (const q of beats) {
      const x = kick(c.sr, o, keyed(c.seed, 'kick', b, q));
      c.bus.addMono(c.S(c.t0 + q * c.spb), x, dbToGain(o.gainDb || -8), 0, 0);
    }
  }

  // ── render ─────────────────────────────────────────────────────────────────────────────────
  // render({ preset, seconds, seed, bpm?, offset?, sections?, hits?, sampleRate?, stems? })
  //   → { sampleRate, left, right, grid: {bpm, offset, bars, beats, ...}, plan, stems? }
  // preset is the preset object (score/presets/<id>.json). left/right = music + hits; stems split them.
  function render(args) {
    const preset = args.preset;
    if (!preset || !preset.id) throw new Error('flpt-score: render needs a preset object');
    const sr = args.sampleRate || 48000;
    const seconds = Number(args.seconds);
    if (!(seconds > 0)) throw new Error('flpt-score: seconds must be > 0');
    const n = Math.round(seconds * sr);
    const seed = args.seed == null ? 'flpt' : String(args.seed);
    const bpm = Number(args.bpm || preset.bpm);
    const bpb = preset.beatsPerBar || 4;
    const offset = Number(args.offset == null ? (preset.offset || 0) : args.offset);
    const spb = 60 / bpm, barDur = spb * bpb;
    const totalBars = Math.max(1, Math.ceil((seconds - offset) / barDur));
    const plan = arrange(args.sections || preset.sections, totalBars);
    const bus = new Bus(n);
    const c = { sr, seed, preset, ins: preset.instruments, bus, spb, bpb, barDur, t0: 0, S: (t) => Math.round(t * sr) };
    for (let b = 0; b < plan.length; b++) {
      const bar = plan[b];
      c.t0 = offset + b * barDur;
      const chord = preset.progression[Math.floor(b / (preset.barsPerChord || 1)) % preset.progression.length];
      for (const name of bar.layers) {
        const fn = LAYERS[name];
        if (!fn) throw new Error('flpt-score: unknown layer ' + name);
        fn(c, b, bar, chord);
      }
    }
    // reverb + master: DC-block, RMS level with a peak ceiling
    const wet = freeverb(bus.sL, bus.sR, sr, preset.reverb || {});
    const L = bus.L, R = bus.R;
    let xl = 0, yl = 0, xr = 0, yr = 0;
    const hpk = Math.exp(-TAU * 20 / sr);
    let ss = 0, peak = 0;
    for (let i = 0; i < n; i++) {
      const a = L[i] + wet.l[i], b2 = R[i] + wet.r[i];
      yl = a - xl + hpk * yl; xl = a;
      yr = b2 - xr + hpk * yr; xr = b2;
      L[i] = yl; R[i] = yr;
      ss += yl * yl + yr * yr;
      const m = Math.max(Math.abs(yl), Math.abs(yr)); if (m > peak) peak = m;
    }
    const rms = Math.sqrt(ss / (2 * n));
    const master = preset.master || {};
    const g = rms > 0 ? Math.min(dbToGain(master.rmsDb == null ? -20 : master.rmsDb) / rms, dbToGain(master.peakDb == null ? -3 : master.peakDb) / peak) : 0;
    const mL = new Float32Array(n), mR = new Float32Array(n);
    for (let i = 0; i < n; i++) { mL[i] = L[i] * g; mR[i] = R[i] * g; }

    // hits → their own bus, placed so each one's anchor lands on round(t·sr)
    let sL = null, sR = null;
    const hits = args.hits || [];
    if (hits.length) {
      sL = new Float32Array(n); sR = new Float32Array(n);
      hits.forEach((h, k) => {
        const s = sfx(h.kind, { seed: seed + ':hit' + k, gain: h.gain || 0, sampleRate: sr });
        const at = Math.round(h.t * sr) - s.anchor;
        for (let i = Math.max(0, -at); i < s.left.length && at + i < n; i++) { sL[at + i] += s.left[i]; sR[at + i] += s.right[i]; }
      });
    }
    let left = mL, right = mR;
    if (sL) {
      left = new Float32Array(n); right = new Float32Array(n);
      for (let i = 0; i < n; i++) { left[i] = mL[i] + sL[i]; right[i] = mR[i] + sR[i]; }
    }
    const out = { version: VERSION, sampleRate: sr, left, right, grid: grid(preset, { bpm, offset, seconds, sr, seed, plan }), plan: plan.map((p) => p.name) };
    if (args.stems) out.stems = { music: { left: mL, right: mR }, sfx: sL ? { left: sL, right: sR } : null };
    return out;
  }

  // The beat grid. Times are exact multiples of 60/bpm from offset; samples and frames are rounded.
  function grid(preset, { bpm, offset, seconds, sr, seed, plan }) {
    const bpb = preset.beatsPerBar || 4, spb = 60 / bpm;
    const beats = [], bars = [], beatSamples = [], beatFrames = [];
    for (let i = 0; ; i++) {
      const t = offset + i * spb;
      if (t >= seconds - 1e-9) break;
      beats.push(+t.toFixed(6)); beatSamples.push(Math.round(t * sr)); beatFrames.push(Math.round(t * 30));
      if (i % bpb === 0) bars.push(+t.toFixed(6));
    }
    const sections = [];
    plan.forEach((p, b) => { if (p.first) sections.push({ name: p.name, bar: b, t: +(offset + b * spb * bpb).toFixed(6) }); });
    return { bpm, offset, bars, beats, beatsPerBar: bpb, sampleRate: sr, seconds, preset: preset.id, seed, beatSamples, beatFrames, sections };
  }

  // A time on a grid (score/grid.json, or a library track's grid in scene time), from a beat's `at`:
  //   "bar 2" (the start of bar 2) · "beat 9" · "bar 3 beat 2" (both 1-based) · 12.5 or "12.5s" (seconds, no grid needed).
  // Returns seconds, or null when the grid doesn't reach that far or the words aren't understood.
  function resolveAt(g, at) {
    if (typeof at === 'number') return Number.isFinite(at) && at >= 0 ? at : null;
    const s = String(at == null ? '' : at).trim().toLowerCase().replace(/\s+/g, ' ');
    let m = /^(\d+(?:\.\d+)?) ?s?$/.exec(s);
    if (m) return Number(m[1]);
    if (!g || !Array.isArray(g.beats)) return null;
    const bpb = g.beatsPerBar || 4;
    m = /^beat (\d+)$/.exec(s);
    if (m) { const v = g.beats[Number(m[1]) - 1]; return v == null ? null : v; }
    m = /^bar (\d+)(?: beat (\d+))?$/.exec(s);
    if (!m) return null;
    const bar = Number(m[1]), beat = m[2] ? Number(m[2]) : 1;
    if (bar < 1 || beat < 1 || beat > bpb || !Array.isArray(g.bars)) return null;
    const start = g.bars[bar - 1];
    if (start == null) return null;
    if (beat === 1) return start;
    let i = 0;
    while (i < g.beats.length && g.beats[i] < start - 1e-6) i++;
    const v = g.beats[i + beat - 1];
    return v == null ? null : v;
  }

  return { VERSION, PRESETS, SFX_KINDS, render, sfx, grid, resolveAt, keyed, fnv1a, mulberry32, _arrange: arrange };
});
