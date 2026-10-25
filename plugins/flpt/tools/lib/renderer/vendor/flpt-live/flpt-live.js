/* flpt-live.js · the Live Motion runtime, 1.0.0 (FLPT V2, PLAN §2.3).
 *
 * A scene is a pure function of t. scene.js calls FLPT.scene({ style, layers, ones, setup, frame, hits, keyframes })
 * once; a host (bridge-hf.js for renders, host-preview.js for the Stage, host-inline.js for FLPT's own scenes in the
 * app and on the landing page) asks for a time and the runtime draws exactly that frame: the canvas is reset and
 * repainted from t alone, so any order, any worker count and any host give the same picture.
 *
 * Rules the runtime enforces by construction:
 *   - on twos (the default), frames 2k and 2k+1 are the same picture (the whole ctx is stepped), so renderers may
 *     draw each pair once (FLPT.drawKey);
 *   - the last `hold` seconds (beats.json "hold") show the picture of time duration - hold, so the hold is still;
 *   - ctx.text draws glyph outlines (Path2D from the font file, a TrueType parser below) when the font's bytes are
 *     embedded (assets/files.js), so type rasterises the same on every machine (spike K3: 53 dB vs 36 dB for DOM type);
 *     without the bytes it falls back to canvas text in the same face.
 *   - scene code (setup, frame, hits, a kit's make/bind, the scene's own scripts) and the runtime's work around it
 *     run "armed" under guard.js when guard.js is loaded; hooks are never async (an await would resume in the host's
 *     time), and a definition is read once, when it's handed over, into a plain record;
 *   - the page API (window.FLPT) is fixed when this file runs, before any scene script: a host calls what was here;
 *   - every string a frame puts on screen is recorded for the text checks: ctx.text (id false too), ctx.fillText,
 *     ctx.textPath, registered boxes, raw canvas text (guard.js's log) and the DOM layer's text (drawnText, textBoxes).
 *
 * Derived in part from cth9191/animate (MIT, Copyright (c) 2026 cth9191): the mulberry32 + FNV-1a RNG, the EZ
 * easings, the closed-form springs, the cameras (cam, push, bump) and the by-angle morph. The full notice is
 * LICENSE-animate.md beside this file and travels with every copy.
 */
(function (root) {
  'use strict';
  if (root.FLPT && root.FLPT.runtime === 'flpt-live') return;

  const VERSION = '1.0.0';
  const W = 1920, H = 1080, FPS = 30, TAU = Math.PI * 2;
  const doc = root.document || null;
  const GUARD = root.__flptGuard || null;
  const realNow = (root.performance && typeof root.performance.now === 'function') ? root.performance.now.bind(root.performance) : () => 0;
  // captured now, before any scene script runs (on a scene page guard.js has already locked the intrinsics)
  const rApply = Reflect.apply, objTag = Object.prototype.toString, freezeObj = Object.freeze, defProp = Object.defineProperty;
  const NativePromise = Promise;
  /** The guard's log of raw canvas text (fillText / strokeText while armed); the runtime claims it once, here. */
  const takeText = GUARD && typeof GUARD.claimText === 'function' ? GUARD.claimText() : null;
  const isAsyncFn = (f) => { const tag = rApply(objTag, f, []); return tag === '[object AsyncFunction]' || tag === '[object AsyncGeneratorFunction]'; };
  const thenable = (v) => v != null && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function';

  /** Run scene-side code armed (guard.js throws on time, randomness, timers and the network inside). */
  function armed(t, fn, self, args) { return GUARD ? GUARD.run(t, fn, self, args || []) : rApply(fn, self, args || []); }

  /** The host page's own settings, read once now: this file loads after beats.js and before any scene script. */
  const PAGE_CFG = (() => {
    if (!doc || typeof doc.getElementById !== 'function') return null;
    const slide = doc.getElementById('slide');
    let beats = null;
    try { const b = root.__FLPT_BEATS || root.__SLIDE__; beats = b ? JSON.parse(JSON.stringify(b)) : null; } catch (e) { beats = null; }
    const ds = (slide && slide.dataset) || {};
    return freezeObj({ stage: doc.getElementById('stage'), dom: doc.getElementById('dom'), beats, duration: Number(ds.duration) || 0, stamp: ds.flptStamp != null });
  })();

  // ───────────────────────────── randomness (animate's hashing, so ports draw the same) ─────────────────────────────
  function fnv(...xs) {
    let h = 2166136261 >>> 0;
    for (const x of xs) {
      const s = String(x);
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
      h ^= 124; h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /** rng(...keys): the same stream for the same keys, on every frame and every host. */
  function rng(...keys) {
    const f = mulberry32(fnv(...keys));
    return {
      f, r: (a = 0, b = 1) => a + (b - a) * f(), n: (amt = 1) => (f() * 2 - 1) * amt,
      i: (a, b) => a + Math.floor(f() * (b - a + 1)), pick: (arr) => arr[Math.floor(f() * arr.length)],
    };
  }

  // ───────────────────────────── math, easing, closed-form springs ─────────────────────────────
  const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, u) => a + (b - a) * u;
  const seg = (t, a, b) => (b === a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a)));
  const EZ = Object.freeze({
    lin: (t) => clamp(t),
    o2: (t) => 1 - (1 - clamp(t)) ** 2, o3: (t) => 1 - (1 - clamp(t)) ** 3, o5: (t) => 1 - (1 - clamp(t)) ** 5,
    i2: (t) => clamp(t) ** 2, i3: (t) => clamp(t) ** 3,
    io: (t) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; },
    back: (t) => { t = clamp(t) - 1; return 1 + 2.70158 * t * t * t + 1.70158 * t * t; },
    smooth: (t) => { t = clamp(t); return t * t * (3 - 2 * t); },
  });
  const SPRINGS = Object.freeze({ snappy: { k: 320, d: 30 }, smooth: { k: 170, d: 26 }, heavy: { k: 90, d: 19 }, playful: { k: 260, d: 14 } });
  function springEase(t, k, d) {
    if (!(t > 0)) return 0;
    const w0 = Math.sqrt(k), z = d / (2 * w0);
    if (z < 1) { const wd = w0 * Math.sqrt(1 - z * z); return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t)); }
    return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  }
  const springPreset = (p) => (typeof p === 'string' ? SPRINGS[p] || SPRINGS.smooth : (p && p.k ? p : SPRINGS.smooth));
  /** 0 -> 1, dt seconds after the trigger; any frame on its own (no integration). */
  const spring = (dt, p = 'smooth') => { const q = springPreset(p); return springEase(dt, q.k, q.d); };
  /** One spring per change, summed: retargets stay continuous. keys = [[t, v], ...] in time order. */
  function springTrackAt(T, keys, p = 'smooth') {
    if (!keys || !keys.length) return 0;
    let v = keys[0][1];
    for (let i = 1; i < keys.length; i++) v += (keys[i][1] - keys[i - 1][1]) * spring(T - keys[i][0], p);
    return v;
  }

  // ───────────────────────────── cameras and shape ─────────────────────────────
  /** A camera puts world point p on screen point to, at zoom z (never "zoom about a point"). */
  const cam = ({ z = 1, p = [W / 2, H / 2], to = [W / 2, H / 2] } = {}) => ({ z, tx: to[0] - z * p[0], ty: to[1] - z * p[1] });
  const camMix = (a, b, u) => ({ z: lerp(a.z, b.z, u), tx: lerp(a.tx, b.tx, u), ty: lerp(a.ty, b.ty, u) });
  const toCam = (c) => (c && 'tx' in c ? c : cam(c || {}));
  const pushAt = (T, a, b, camA, camB, ease = EZ.io) => camMix(toCam(camA), toCam(camB), ease(seg(T, a, b)));
  function bumpAt(T, t0, p, amt = 0.3, every = 0.5) {
    const m = (((T - t0) % every) + every) % every;
    return cam({ z: 1 + (T >= t0 ? amt * Math.exp(-m * 7) : 0), p, to: p });
  }
  function byAngle(P, m = 96) {
    const c = P.reduce((a, p) => [a[0] + p[0] / P.length, a[1] + p[1] / P.length], [0, 0]), out = [];
    for (let i = 0; i < m; i++) {
      const a = -Math.PI + (i / m) * TAU;
      let best = P[0], bd = 1e9;
      for (const q of P) {
        let d = Math.atan2(q[1] - c[1], q[0] - c[0]) - a;
        d = Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
        if (d < bd) { bd = d; best = q; }
      }
      out.push(best);
    }
    return out;
  }
  /** Both outlines resampled to 96 points by angle around their centroids, then blended. */
  const morph = (A, B, u) => { const a = byAngle(A), b = byAngle(B); return a.map((p, i) => [lerp(p[0], b[i][0], u), lerp(p[1], b[i][1], u)]); };

  // ───────────────────────────── base64 (the embedded fonts; no atob in scene pages) ─────────────────────────────
  const B64 = (() => { const t = new Int16Array(128).fill(-1); const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; for (let i = 0; i < 64; i++) t[a.charCodeAt(i)] = i; t[45] = 62; t[95] = 63; return t; })();
  function fromB64(s) {
    s = String(s);
    const out = new Uint8Array(Math.floor((s.length * 3) / 4));
    let n = 0, acc = 0, bits = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i), v = c < 128 ? B64[c] : -1;
      if (v < 0) continue;
      acc = (acc << 6) | v; bits += 6;
      if (bits >= 8) { bits -= 8; out[n++] = (acc >> bits) & 255; }
    }
    return out.subarray(0, n);
  }

  // ───────────────────────────── TrueType outlines (glyf), cmap 4/12, kerning (kern 0, GPOS pair 1/2) ─────────────────
  // A small sfnt reader so ctx.text can draw glyph outlines. TrueType (glyf) only: a CFF font ('OTTO'), WOFF or WOFF2
  // returns null and ctx.text falls back to canvas text. Every read is bounds-checked by DataView; a broken font
  // throws inside parseFont, which the caller turns into "no outlines".
  function parseFont(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const u16 = (o) => dv.getUint16(o), i16 = (o) => dv.getInt16(o), u32 = (o) => dv.getUint32(o);
    const tag0 = u32(0);
    if (tag0 !== 0x00010000 && tag0 !== 0x74727565) return null;
    const T = {};
    for (let i = 0, n = u16(4); i < n; i++) {
      const o = 12 + 16 * i;
      T[String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3])] = { off: u32(o + 8), len: u32(o + 12) };
    }
    for (const t of ['head', 'hhea', 'hmtx', 'maxp', 'cmap', 'loca', 'glyf']) if (!T[t]) return null;
    const head = T.head.off, upm = u16(head + 18) || 1000, locLong = i16(head + 50) === 1;
    const numGlyphs = u16(T.maxp.off + 4);
    const hhea = T.hhea.off, nH = Math.max(1, u16(hhea + 34));
    const font = {
      upm, numGlyphs, ascender: i16(hhea + 4), descender: i16(hhea + 6), lineGap: i16(hhea + 8),
      capHeight: 0, xHeight: 0,
    };
    if (T['OS/2'] && T['OS/2'].len >= 90 && u16(T['OS/2'].off) >= 2) { font.xHeight = i16(T['OS/2'].off + 86); font.capHeight = i16(T['OS/2'].off + 88); }
    const hmtx = T.hmtx.off;
    font.adv = (g) => u16(hmtx + 4 * Math.min(g, nH - 1));
    const loca = T.loca.off, glyf = T.glyf.off;
    const locOf = (g) => (locLong ? u32(loca + 4 * g) : 2 * u16(loca + 2 * g));

    // ---- cmap: format 12 (full Unicode) preferred, else format 4 (BMP)
    let lookup = () => 0;
    {
      const c = T.cmap.off, n = u16(c + 2);
      let best = null, rank = -1;
      for (let i = 0; i < n; i++) {
        const pid = u16(c + 4 + 8 * i), eid = u16(c + 6 + 8 * i), sub = c + u32(c + 8 + 8 * i), fmt = u16(sub);
        const r = fmt === 12 && (pid === 3 || pid === 0) ? 3 : fmt === 4 && ((pid === 3 && (eid === 1 || eid === 10)) || pid === 0) ? 2 : 0;
        if (r > rank) { rank = r; best = { sub, fmt }; }
      }
      if (best && best.fmt === 12) {
        const s = best.sub, nG = u32(s + 12);
        lookup = (cp) => {
          let lo = 0, hi = nG - 1;
          while (lo <= hi) {
            const m = (lo + hi) >> 1, o = s + 16 + 12 * m, a = u32(o), b = u32(o + 4);
            if (cp < a) hi = m - 1; else if (cp > b) lo = m + 1; else return u32(o + 8) + (cp - a);
          }
          return 0;
        };
      } else if (best && best.fmt === 4) {
        const s = best.sub, segX2 = u16(s + 6), ends = s + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
        lookup = (cp) => {
          if (cp > 0xffff) return 0;
          let lo = 0, hi = segX2 / 2 - 1;
          while (lo <= hi) {
            const m = (lo + hi) >> 1, e = u16(ends + 2 * m);
            if (e < cp) { lo = m + 1; continue; }
            const st = u16(starts + 2 * m);
            if (st > cp) { hi = m - 1; continue; }
            const ro = u16(ranges + 2 * m), d = i16(deltas + 2 * m);
            if (!ro) return (cp + d) & 0xffff;
            const gi = u16(ranges + 2 * m + ro + 2 * (cp - st));
            return gi ? (gi + d) & 0xffff : 0;
          }
          return 0;
        };
      }
    }
    const cmapCache = new Map();
    font.gid = (cp) => { let g = cmapCache.get(cp); if (g === undefined) { g = lookup(cp); if (g >= numGlyphs) g = 0; cmapCache.set(cp, g); } return g; };

    // ---- glyphs: contours of {x, y, on} in font units (y up); composites flattened (depth <= 8)
    function contoursOf(g, depth) {
      if (g < 0 || g >= numGlyphs || depth > 8) return [];
      const a = locOf(g), b = locOf(g + 1);
      if (b <= a) return [];
      const o = glyf + a, nC = i16(o);
      if (nC >= 0) {
        const endPts = [];
        for (let i = 0; i < nC; i++) endPts.push(u16(o + 10 + 2 * i));
        const nPts = nC ? endPts[nC - 1] + 1 : 0;
        let p = o + 10 + 2 * nC;
        p += 2 + u16(p);
        const flags = new Uint8Array(nPts);
        for (let i = 0; i < nPts;) {
          const f = u8[p++]; flags[i++] = f;
          if (f & 8) { let r = u8[p++]; while (r-- > 0 && i < nPts) flags[i++] = f; }
        }
        const xs = new Int32Array(nPts), ys = new Int32Array(nPts);
        let v = 0;
        for (let i = 0; i < nPts; i++) {
          const f = flags[i];
          if (f & 2) { const d = u8[p++]; v += f & 16 ? d : -d; } else if (!(f & 16)) { v += i16(p); p += 2; }
          xs[i] = v;
        }
        v = 0;
        for (let i = 0; i < nPts; i++) {
          const f = flags[i];
          if (f & 4) { const d = u8[p++]; v += f & 32 ? d : -d; } else if (!(f & 32)) { v += i16(p); p += 2; }
          ys[i] = v;
        }
        const out = [];
        let s = 0;
        for (const e of endPts) {
          const c = [];
          for (let i = s; i <= e && i < nPts; i++) c.push({ x: xs[i], y: ys[i], on: (flags[i] & 1) === 1 });
          if (c.length) out.push(c);
          s = e + 1;
        }
        return out;
      }
      // composite
      const out = [];
      let p = o + 10, flags;
      const f2 = (q) => i16(q) / 16384;
      do {
        flags = u16(p); const gi = u16(p + 2); p += 4;
        let a1, a2;
        if (flags & 1) { a1 = i16(p); a2 = i16(p + 2); p += 4; } else { a1 = dv.getInt8(p); a2 = dv.getInt8(p + 1); p += 2; }
        const dx = flags & 2 ? a1 : 0, dy = flags & 2 ? a2 : 0;
        let ma = 1, mb = 0, mc = 0, md = 1;
        if (flags & 8) { ma = md = f2(p); p += 2; } else if (flags & 0x40) { ma = f2(p); md = f2(p + 2); p += 4; } else if (flags & 0x80) { ma = f2(p); mb = f2(p + 2); mc = f2(p + 4); md = f2(p + 6); p += 8; }
        for (const c of contoursOf(gi, depth + 1)) out.push(c.map((q) => ({ x: ma * q.x + mc * q.y + dx, y: mb * q.x + md * q.y + dy, on: q.on })));
      } while (flags & 0x20);
      return out;
    }
    function bboxOf(g) {
      const a = locOf(g), b = locOf(g + 1);
      if (b <= a) return null;
      const o = glyf + a;
      return { x0: i16(o + 2), y0: i16(o + 4), x1: i16(o + 6), y1: i16(o + 8) };
    }
    /** Path commands in font units, y up: ['M', x, y] ['L', x, y] ['Q', cx, cy, x, y] ['Z'] (TrueType quadratic decoding). */
    function commands(g) {
      const cmds = [];
      for (const c of contoursOf(g, 0)) {
        const n = c.length;
        let curr = c[n - 1], next = c[0];
        if (curr.on) cmds.push(['M', curr.x, curr.y]);
        else if (next.on) cmds.push(['M', next.x, next.y]);
        else cmds.push(['M', (curr.x + next.x) / 2, (curr.y + next.y) / 2]);
        for (let i = 0; i < n; i++) {
          curr = next; next = c[(i + 1) % n];
          if (curr.on) cmds.push(['L', curr.x, curr.y]);
          else {
            const n2 = next.on ? next : { x: (curr.x + next.x) / 2, y: (curr.y + next.y) / 2 };
            cmds.push(['Q', curr.x, curr.y, n2.x, n2.y]);
          }
        }
        cmds.push(['Z']);
      }
      return cmds;
    }
    const glyphCache = new Map();
    font.glyph = (g) => {
      let r = glyphCache.get(g);
      if (!r) { r = { cmds: commands(g), bbox: bboxOf(g), adv: font.adv(g) }; glyphCache.set(g, r); }
      return r;
    };

    // ---- kerning: GPOS 'kern' pair adjustment (formats 1 and 2, through extension lookups), else the old kern table
    const pairs = [];
    const coverageIndex = (c, g) => {
      const fmt = u16(c);
      if (fmt === 1) {
        let lo = 0, hi = u16(c + 2) - 1;
        while (lo <= hi) { const m = (lo + hi) >> 1, v = u16(c + 4 + 2 * m); if (v < g) lo = m + 1; else if (v > g) hi = m - 1; else return m; }
        return -1;
      }
      if (fmt === 2) {
        let lo = 0, hi = u16(c + 2) - 1;
        while (lo <= hi) {
          const m = (lo + hi) >> 1, o = c + 4 + 6 * m, a = u16(o), b = u16(o + 2);
          if (g < a) hi = m - 1; else if (g > b) lo = m + 1; else return u16(o + 4) + g - a;
        }
      }
      return -1;
    };
    const classOf = (c, g) => {
      const fmt = u16(c);
      if (fmt === 1) { const s = u16(c + 2), n = u16(c + 4); return g >= s && g < s + n ? u16(c + 6 + 2 * (g - s)) : 0; }
      if (fmt === 2) {
        let lo = 0, hi = u16(c + 2) - 1;
        while (lo <= hi) {
          const m = (lo + hi) >> 1, o = c + 4 + 6 * m, a = u16(o), b = u16(o + 2);
          if (g < a) hi = m - 1; else if (g > b) lo = m + 1; else return u16(o + 4);
        }
      }
      return 0;
    };
    const vrSize = (vf) => { let n = 0; for (let b = vf & 0xff; b; b &= b - 1) n++; return 2 * n; };
    const xAdvAt = (o, vf) => { if (!(vf & 4)) return 0; let k = 0; if (vf & 1) k += 2; if (vf & 2) k += 2; return i16(o + k); };
    if (T.GPOS) {
      try {
        const gp = T.GPOS.off, fl = gp + u16(gp + 6), ll = gp + u16(gp + 8);
        const lookups = new Set();
        for (let i = 0, n = u16(fl); i < n; i++) {
          const r = fl + 2 + 6 * i;
          if (String.fromCharCode(u8[r], u8[r + 1], u8[r + 2], u8[r + 3]) !== 'kern') continue;
          const ft = fl + u16(r + 4);
          for (let j = 0, m = u16(ft + 2); j < m; j++) lookups.add(u16(ft + 4 + 2 * j));
        }
        for (const li of [...lookups].sort((a, b) => a - b)) {
          const lk = ll + u16(ll + 2 + 2 * li);
          let type = u16(lk);
          const subs = [];
          for (let s = 0, n = u16(lk + 4); s < n; s++) {
            let st = lk + u16(lk + 6 + 2 * s);
            if (type === 9) { const t2 = u16(st + 2); st += u32(st + 4); if (t2 !== 2) continue; } else if (type !== 2) continue;
            subs.push(st);
          }
          if (subs.length) pairs.push(subs);
        }
      } catch (e) { pairs.length = 0; }
    }
    let kern0 = null;
    if (!pairs.length && T.kern) {
      try {
        const k = T.kern.off;
        if (u16(k) === 0) {
          let o = k + 4;
          for (let s = 0, n = u16(k + 2); s < n; s++) {
            const len = u16(o + 2), cov = u16(o + 4);
            if (cov >> 8 === 0 && cov & 1) {
              kern0 = kern0 || new Map();
              for (let i = 0, m = u16(o + 6); i < m; i++) { const r = o + 14 + 6 * i; kern0.set(u16(r) * 65536 + u16(r + 2), i16(r + 4)); }
            }
            o += len;
          }
        }
      } catch (e) { kern0 = null; }
    }
    const kernCache = new Map();
    function pairValue(st, l, r) {
      const fmt = u16(st), ci = coverageIndex(st + u16(st + 2), l);
      if (ci < 0) return null;
      const vf1 = u16(st + 4), vf2 = u16(st + 6), s1 = vrSize(vf1), s2 = vrSize(vf2);
      if (fmt === 1) {
        if (ci >= u16(st + 8)) return null;
        const ps = st + u16(st + 10 + 2 * ci), rec = 2 + s1 + s2;
        let lo = 0, hi = u16(ps) - 1;
        while (lo <= hi) {
          const m = (lo + hi) >> 1, o = ps + 2 + rec * m, g2 = u16(o);
          if (g2 < r) lo = m + 1; else if (g2 > r) hi = m - 1; else return xAdvAt(o + 2, vf1);
        }
        return null;
      }
      if (fmt === 2) {
        const c1 = classOf(st + u16(st + 8), l), c2 = classOf(st + u16(st + 10), r), n1 = u16(st + 12), n2 = u16(st + 14);
        if (c1 >= n1 || c2 >= n2) return 0;
        return xAdvAt(st + 16 + (c1 * n2 + c2) * (s1 + s2), vf1);
      }
      return null;
    }
    font.kern = (l, r) => {
      if (l < 0 || r < 0) return 0;
      const key = l * 65536 + r;
      let v = kernCache.get(key);
      if (v !== undefined) return v;
      v = 0;
      if (pairs.length) {
        for (const subs of pairs) for (const st of subs) { let x = null; try { x = pairValue(st, l, r); } catch (e) { x = null; } if (x !== null) { v += x; break; } }
      } else if (kern0) v = kern0.get(key) || 0;
      kernCache.set(key, v);
      return v;
    };
    return font;
  }

  // ───────────────────────────── fonts: embedded bytes, FontFace, outline records ─────────────────────────────
  // Embedded bytes are keyed by the files script that brought them (its URL) and by name, so two scenes on one page
  // (host-inline) each get their own file even when the names match; a scene page has one files.js.
  const FILES = { fonts: new Map(), byName: new Map(), pictures: [] };
  const fontBytes = (file, scope) => (scope && FILES.fonts.get(scope + '\n' + file)) || FILES.byName.get(file) || null;
  const OUTLINES = new Map();            // "family|style" -> [{ weight, font, key }]
  const unq = (s) => String(s || '').trim().replace(/^["']|["']$/g, '').trim();
  const famKey = (family, style) => unq(family).toLowerCase() + '|' + (style === 'italic' || style === 'oblique' ? 'italic' : 'normal');
  function registerOutline(family, weight, style, font, key) {
    const k = famKey(family, style);
    const list = OUTLINES.get(k) || [];
    if (key && list.some((x) => x.key === key)) return;
    list.push({ weight: Number(weight) || 400, font, key: key || null });
    OUTLINES.set(k, list);
  }
  /** The outline font for a CSS family list, weight and style: the first family that has one, nearest weight. */
  function outlineFor(familyList, weight, style) {
    for (const fam of String(familyList || '').split(',')) {
      const list = OUTLINES.get(famKey(fam, style)) || OUTLINES.get(famKey(fam, 'normal'));
      if (!list || !list.length) continue;
      const w = Number(weight) || 400;
      let best = list[0];
      for (const x of list) if (Math.abs(x.weight - w) < Math.abs(best.weight - w)) best = x;
      return best.font;
    }
    return null;
  }
  /** '600 72px "IBM Plex Mono", monospace' or 'italic 480 84px X' -> { style, weight, size, family } */
  function parseCssFont(css) {
    const s = String(css || '').trim();
    const m = s.match(/^((?:(?:italic|oblique|normal|small-caps|bold|bolder|lighter|\d{3})\s+)*)(\d+(?:\.\d+)?)px(?:\/\S+)?\s+(.+)$/i);
    if (!m) return { style: 'normal', weight: 400, size: 16, family: s || 'sans-serif' };
    let style = 'normal', weight = 400;
    for (const w of m[1].trim().split(/\s+/).filter(Boolean)) {
      if (/^(italic|oblique)$/i.test(w)) style = 'italic';
      else if (/^bold$/i.test(w)) weight = 700;
      else if (/^\d{3}$/.test(w)) weight = Number(w);
    }
    return { style, weight, size: Number(m[2]), family: m[3] };
  }
  const cssFont = (o) => `${o.style === 'italic' ? 'italic ' : ''}${o.weight || 400} ${o.size || 16}px ${o.family || 'sans-serif'}`;
  /** Normalise text options: a CSS shorthand string, or { font|family, size, weight, style, tracking }. */
  function fontSpec(o, tokens) {
    if (typeof o === 'string') return { ...parseCssFont(o), tracking: 0 };
    o = o || {};
    if (o.font && /\dpx/.test(o.font)) return { ...parseCssFont(o.font), tracking: o.tracking || 0 };
    return {
      family: o.font || o.family || (tokens && tokens.font) || 'sans-serif', size: o.size || 48,
      weight: o.weight || (tokens && tokens.weight) || 600, style: o.style || 'normal', tracking: o.tracking || 0,
    };
  }

  const PATHS = new Map();
  const MAX_PATHS = 4000;
  /** Lay a line out with outlines: { path (Path2D at the pen start, baseline y = 0), w, asc, desc, x0, x1 } or null. */
  function textPath(str, o, tokens) {
    const f = fontSpec(o, tokens), font = outlineFor(f.family, f.weight, f.style);
    if (!font || typeof root.Path2D !== 'function') return null;
    str = String(str);
    const key = `${f.family}|${f.weight}|${f.style}|${f.size}|${f.tracking}|${str}`;
    let r = PATHS.get(key);
    if (r) return r;
    const sc = f.size / font.upm, path = new root.Path2D();
    let x = 0, prev = -1, top = 0, bot = 0, left = Infinity, right = -Infinity, n = 0;
    for (const ch of str) {
      const g = font.gid(ch.codePointAt(0));
      if (prev >= 0) x += font.kern(prev, g) * sc;
      const gl = font.glyph(g);
      for (const c of gl.cmds) {
        if (c[0] === 'M') path.moveTo(x + c[1] * sc, -c[2] * sc);
        else if (c[0] === 'L') path.lineTo(x + c[1] * sc, -c[2] * sc);
        else if (c[0] === 'Q') path.quadraticCurveTo(x + c[1] * sc, -c[2] * sc, x + c[3] * sc, -c[4] * sc);
        else path.closePath();
      }
      if (gl.bbox) {
        top = Math.max(top, gl.bbox.y1 * sc); bot = Math.max(bot, -gl.bbox.y0 * sc);
        left = Math.min(left, x + gl.bbox.x0 * sc); right = Math.max(right, x + gl.bbox.x1 * sc);
      }
      x += gl.adv * sc + f.tracking;
      prev = g; n++;
    }
    const w = n ? x - f.tracking : 0;
    r = { path, w, asc: top, desc: bot, x0: Number.isFinite(left) ? left : 0, x1: Number.isFinite(right) ? right : w, size: f.size, outline: true };
    if (PATHS.size >= MAX_PATHS) PATHS.clear();
    PATHS.set(key, r);
    return r;
  }
  let MEASURER = null;
  /** Width and ink ascent/descent of one line, from the outlines when present, else the canvas. */
  function measure(str, o, tokens) {
    const tp = textPath(str, o, tokens);
    if (tp) return { w: tp.w, asc: tp.asc, desc: tp.desc, outline: true };
    const f = fontSpec(o, tokens);
    if (!MEASURER && doc) MEASURER = doc.createElement('canvas').getContext('2d');
    if (!MEASURER) return { w: String(str).length * f.size * 0.5, asc: f.size * 0.72, desc: f.size * 0.2, outline: false };
    MEASURER.font = cssFont(f);
    try { MEASURER.letterSpacing = `${f.tracking}px`; } catch (e) { /* older canvas */ }
    const m = MEASURER.measureText(String(str));
    return { w: m.width, asc: m.actualBoundingBoxAscent, desc: m.actualBoundingBoxDescent, outline: false };
  }

  // ───────────────────────────── the text a frame draws (for the text report, the overlap and bubble checks) ─────
  // While a frame draws, REC points at that scene's lists: `drawn` gets every string the runtime draws or is told
  // about (ctx.text, id:false included; ctx.fillText / env.fillText; ctx.textPath; registered boxes), `own` the
  // runtime's own canvas-text calls (folded out of the guard's raw log, which sees them too).
  let REC = null;
  /** The screen box (scene units) of a line drawn at (x, y) in g's current transform, or null off the stage. */
  function lineBox(g, x, y, m) {
    if (!REC || g !== REC.G || typeof g.getTransform !== 'function') return null;
    const T = g.getTransform(), k = REC.scale || 1;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [px, py] of [[x, y - m.asc], [x + m.w, y - m.asc], [x, y + m.desc], [x + m.w, y + m.desc]]) {
      const sx = T.a * px + T.c * py + T.e, sy = T.b * px + T.d * py + T.f;
      x0 = Math.min(x0, sx); y0 = Math.min(y0, sy); x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
    }
    return Number.isFinite(x0) && Number.isFinite(y0) ? { x: x0 / k, y: y0 / k, w: (x1 - x0) / k, h: (y1 - y0) / k } : null;
  }
  function noteDrawn(str, box, via) { if (REC && REC.drawn.length < 5000) REC.drawn.push({ str: String(str), box, via }); }
  /** Fill one line at (x, y) (baseline, left) in g's current transform: outlines when present, else canvas text. */
  function fillLine(g, str, x, y, o, tokens, stroke, via) {
    str = String(str);
    const tp = textPath(str, o, tokens);
    if (via) noteDrawn(str, lineBox(g, x, y, tp ? { w: tp.w, asc: tp.asc, desc: tp.desc } : measure(str, o, tokens)), via);
    if (tp) {
      g.save(); g.translate(x, y);
      if (stroke) g.stroke(tp.path); else g.fill(tp.path);
      g.restore();
      return tp;
    }
    const f = fontSpec(o, tokens);
    g.save(); g.font = cssFont(f); g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    try { g.letterSpacing = `${f.tracking}px`; } catch (e) { /* older canvas */ }
    if (REC) REC.own.push({ str, canvas: g.canvas });
    if (stroke) g.strokeText(str, x, y); else g.fillText(str, x, y);
    g.restore();
    return null;
  }

  async function loadFonts(list, fontBase = 'assets/fonts/', scope = '') {
    if (!doc) return;
    const jobs = [];
    for (const f of list || []) {
      if (!f || !f.family) continue;
      const file = f.file || (f.url ? String(f.url).split('/').pop() : null);
      const bytes = file ? fontBytes(file, scope) : null;
      const key = `${unq(f.family)}|${f.weight || 400}|${f.style || 'normal'}|${bytes ? `bytes:${scope}\n${file}` : `url:${fontBase}${file || f.url || ''}`}`;
      if (LOADED.has(key)) { jobs.push(LOADED.get(key)); continue; }   // each face is parsed and added once per page
      const job = (async () => {
        if (bytes) {
          try { const font = parseFont(bytes); if (font) registerOutline(f.family, f.weight || 400, f.style, font, key); } catch (e) { note(`font ${file}: ${String(e && e.message || e).slice(0, 80)}`); }
        }
        if (typeof root.FontFace !== 'function') return;
        const src = bytes ? bytes.slice().buffer : (file ? `url(${fontBase}${encodeURIComponent(file)})` : (f.url ? `url(${f.url})` : null));
        if (!src) return;
        try { const face = new root.FontFace(unq(f.family), src, { weight: String(f.weight || 400), style: f.style || 'normal' }); await face.load(); doc.fonts.add(face); } catch (e) { note(`font ${f.family}: not loaded`); }
      })();
      LOADED.set(key, job);
      jobs.push(job);
    }
    await NativePromise.all(jobs);
  }
  const LOADED = new Map();
  const PICTURES = new Map();
  async function loadPictures(names) {
    if (!doc || typeof root.Image !== 'function') return;
    await NativePromise.all((names || []).map(async (name) => {
      if (PICTURES.has(name)) return;
      const img = new root.Image();
      img.src = 'assets/pictures/' + encodeURIComponent(name);
      try { await img.decode(); PICTURES.set(name, img); } catch (e) { note(`picture ${name}: not decoded`); }
    }));
  }

  // ───────────────────────────── beats ─────────────────────────────
  function readBeats(src) {
    const b = src || {};
    const beats = (Array.isArray(b.beats) ? b.beats : [])
      .filter((x) => x && typeof x.name === 'string' && Number.isFinite(Number(x.t)))
      .map((x) => Object.freeze({ name: x.name, t: Number(x.t), end: Number.isFinite(Number(x.end)) ? Number(x.end) : Number(x.t), cue: x.cue || null, word: x.word || null, sfx: x.sfx || null }));
    const words = (Array.isArray(b.words) ? b.words : [])
      .filter((w) => w && Number.isFinite(Number(w.start)))
      .map((w) => Object.freeze({ text: String(w.text != null ? w.text : w.word || ''), start: Number(w.start), end: Number(w.end) }));
    return {
      beats: Object.freeze(beats), words: Object.freeze(words), by: new Map(beats.map((x) => [x.name, x])),
      hold: Number.isFinite(Number(b.hold)) ? Math.max(0, Number(b.hold)) : 0, duration: Number(b.duration) || 0,
      placement: b.placement || null, style: b.style || null,
    };
  }

  // ───────────────────────────── scene and style definitions, read once ─────────────────────────────
  // A definition is read when it's handed over (inside the scene's own, armed, script) into a plain record: its
  // hooks as functions (never async: an await would resume outside the guard) and its settings as plain data. Later
  // reads never touch the scene's object again, so a getter there can't run in the host's time.
  const SNAPS = new WeakSet();
  const strList = (v, n = 64) => (Array.isArray(v) ? v.slice(0, n).map((x) => String(x)) : []);
  const hook = (v, name, need) => {
    if (v == null) { if (need) throw new Error(`FLPT.scene needs ${name}(ctx, t, state)`); return null; }
    if (typeof v !== 'function') throw new Error(`${name} must be a function`);
    if (isAsyncFn(v)) throw new Error(`${name} must not be async (draw from t; an await resumes outside the scene's time)`);
    return v;
  };
  const fontList = (v) => (Array.isArray(v) ? v.slice(0, 32).filter((f) => f && f.family).map((f) => freezeObj({
    family: String(f.family), file: f.file != null ? String(f.file) : null, url: f.url != null ? String(f.url) : null,
    weight: Number(f.weight) || 400, style: f.style === 'italic' || f.style === 'oblique' ? 'italic' : 'normal',
  })) : []);
  function snapDef(def) {
    if (def && SNAPS.has(def)) return def;
    if (!def || (typeof def !== 'object' && typeof def !== 'function')) throw new Error('FLPT.scene needs frame(ctx, t, state)');
    const s = freezeObj({
      self: def, frame: hook(def.frame, 'frame', true), setup: hook(def.setup, 'setup'), hits: hook(def.hits, 'hits'),
      style: def.style != null ? String(def.style) : null, layers: freezeObj(strList(def.layers, 4)), ones: def.ones == null ? null : !!def.ones,
      placement: def.placement != null ? String(def.placement) : null, duration: Number(def.duration) || 0, fonts: freezeObj(fontList(def.fonts)),
      keyframes: freezeObj(Array.isArray(def.keyframes) ? def.keyframes.slice(0, 64).map((k) => (typeof k === 'number' ? k : String(k))) : []),
    });
    SNAPS.add(s);
    return s;
  }
  function snapStyle(def) {
    if (def && SNAPS.has(def)) return def;
    if (!def || typeof def !== 'object') return null;
    const tokens = {};
    for (const [k, v] of Object.entries(def.tokens || {})) if (typeof v === 'string' || typeof v === 'number') tokens[k] = v;
    const s = freezeObj({ self: def, tokens: freezeObj(tokens), fonts: freezeObj(fontList(def.fonts)), ones: !!def.ones, make: hook(def.make, 'make') });
    SNAPS.add(s);
    return s;
  }

  // ───────────────────────────── the scene instance ─────────────────────────────
  const HIT_KINDS = new Set(['click', 'tick', 'pop', 'swish', 'whoosh', 'thump', 'crack', 'chime', 'sub', 'riser']);
  const ALLOWED_TAGS = new Set(['div', 'span', 'p', 'b', 'i', 'em', 'strong', 'small', 'sub', 'sup', 'br']);
  const ERRORS = [];
  /** An offscreen canvas for kits (made once, in setup or on first use; never per frame). */
  function makeCanvas(w, h) { const c = doc.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
  function note(msg) { if (ERRORS.length < 100 && !ERRORS.includes(msg)) ERRORS.push(msg); }
  const PLAIN = Object.freeze({ tokens: Object.freeze({ paper: '#f4efe4', ink: '#17202b', font: 'sans-serif' }) });

  // the DOM layer's text, read through the DOM's own accessors (a scene's node can't answer for itself)
  const getterFn = (proto, key) => { const d = proto && Object.getOwnPropertyDescriptor(proto, key); return d && d.get ? (o) => rApply(d.get, o, []) : (o) => o[key]; };
  const methodFn = (proto, key) => { const f = proto && proto[key]; return typeof f === 'function' ? (o, ...a) => rApply(f, o, a) : null; };
  const NODE_P = root.Node && root.Node.prototype, EL_P = root.Element && root.Element.prototype;
  const childNodesOf = getterFn(NODE_P, 'childNodes'), nodeTypeOf = getterFn(NODE_P, 'nodeType');
  const dataOf = getterFn(root.CharacterData && root.CharacterData.prototype, 'data');
  const rectOf = methodFn(EL_P, 'getBoundingClientRect');
  const newRange = methodFn(root.Document && root.Document.prototype, 'createRange');
  const rangeSelect = methodFn(root.Range && root.Range.prototype, 'selectNodeContents'), rangeRect = methodFn(root.Range && root.Range.prototype, 'getBoundingClientRect');
  const computed = typeof root.getComputedStyle === 'function' ? root.getComputedStyle : null;
  /** Visible text nodes under a DOM-layer root: [{ str, box (scene units) | null }]. */
  function domText(dom) {
    const out = [];
    if (!dom) return out;
    let base = null, k = 1;
    try { base = rectOf ? rectOf(dom) : null; k = base && base.width > 0 ? base.width / W : 1; } catch (e) { base = null; }
    const toScene = (q) => (base && q && (q.width > 0 || q.height > 0) ? { x: (q.left - base.left) / k, y: (q.top - base.top) / k, w: q.width / k, h: q.height / k } : null);
    const walk = (node, alpha, depth) => {
      if (depth > 32 || out.length >= 500) return;
      const kids = childNodesOf(node) || [];
      for (let i = 0; i < kids.length; i++) {
        const ch = kids[i], type = nodeTypeOf(ch);
        if (type === 3) {
          const str = String(dataOf(ch) || '').replace(/\s+/g, ' ').trim();
          if (!str || alpha <= 0.004) continue;
          let box = null;
          try {
            if (newRange && rangeSelect && rangeRect && doc) { const r = newRange(doc); rangeSelect(r, ch); box = toScene(rangeRect(r)); } else if (rectOf) box = toScene(rectOf(node));
          } catch (e) { box = null; }
          out.push({ str, box });
        } else if (type === 1) {
          let a = alpha;
          try {
            if (computed) {
              const cs = computed(ch);
              if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') continue;
              a *= Number(cs.opacity);
            } else if (ch.style && ch.style.opacity !== undefined && ch.style.opacity !== '') a *= Number(ch.style.opacity);
          } catch (e) { /* keep the parent's */ }
          walk(ch, Number.isFinite(a) ? a : alpha, depth + 1);
        }
      }
    };
    walk(dom, 1, 0);
    return out;
  }

  /**
   * One scene on one canvas (+ an optional DOM layer root). opts: { canvas, dom, duration, beats, hold, scale,
   * stamp, transparent, fontBase, files }. Returns { canvas, dom, ready, boot, seek, drawAt, frameFor, drawKey, meta,
   * textBoxes, drawnText, duration, hold, ones }.
   */
  function createScene(rawDef, opts) {
    const D = snapDef(rawDef);
    const B = readBeats(opts.beats);
    const duration = Math.max(1 / FPS, Number(opts.duration) || B.duration || D.duration || 10);
    const hold = Math.min(duration, Number.isFinite(Number(opts.hold)) ? Math.max(0, Number(opts.hold)) : B.hold);
    const scale = Number(opts.scale) || 1;
    const canvas = opts.canvas;
    const dom = opts.dom || null;
    const scope = opts.files ? String(opts.files) : '';
    const placement = D.placement || B.placement || 'solo';
    const lastF = Math.max(0, Math.round(duration * FPS) - 1);
    const holdF = hold > 0 ? Math.max(0, Math.min(lastF, Math.round((duration - hold) * FPS))) : lastF + 1;
    let style = null, tokens = PLAIN.tokens, KIT = {}, STATE = {}, G = null, CUR = null, LAST = -1, ones = !!D.ones;
    let BOXES = [], DRAWN = [], DRAWING = false;
    let ready = null, isReady = false;

    const cue = (name) => {
      if (typeof name === 'number') return name;
      const b = B.by.get(name);
      if (!b) { note('cue:' + name); return 1e9; }
      return b.t;
    };
    const beat = (name) => B.by.get(name) || null;
    /** Kits and scenes register the box of text they draw themselves: (id, str, { x, y, w, h }, { overprint }). */
    function registerBox(id, str, box, extra) {
      if (!box) return;
      const x = Number(box.x), y = Number(box.y), w = Number(box.w), h = Number(box.h);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const rec = { id: id == null ? String(str) : String(id), str: String(str), x, y, w: Number.isFinite(w) ? w : 0, h: Number.isFinite(h) ? h : 0 };
      if (extra && extra.overprint) rec.overprint = true;
      if (BOXES.length < 2000) BOXES.push(rec);
      noteDrawn(rec.str, { x, y, w: rec.w, h: rec.h }, 'box');
    }
    const fontOpts = (o) => fontSpec(o, tokens);

    function wrapLines(str, f, width) {
      const words = String(str).split(/\s+/).filter(Boolean), lines = [];
      let line = '';
      for (const w of words) {
        const tryL = line ? line + ' ' + w : w;
        if (line && measure(tryL, f, tokens).w > width) { lines.push(line); line = w; } else line = tryL;
      }
      if (line) lines.push(line);
      return lines.length ? lines : [''];
    }

    /**
     * ctx.text(id, str, { x, y, size, font, weight, style, color, align, at, until, anim, dur, frac, alpha, width,
     * lineHeight, tracking, world, overprint, draw }): type on the canvas, as glyph outlines when the font is embedded.
     * y is the first baseline. Registers its box (screen space) for the overlap, cut-off and bubble checks; with
     * id false it isn't registered, but the text report still sees the words.
     */
    function text(id, str, o = {}) {
      const T = CUR ? CUR.TT : 0;
      if (o.at != null && T < o.at) return null;
      if (o.until != null && T >= o.until) return null;
      const f = fontOpts(o);
      let alpha = o.alpha == null ? 1 : Number(o.alpha), dy = 0, sc = 1;
      let u = 1;
      if (o.anim && o.at != null) {
        u = clamp((T - o.at) / (o.dur || 0.4));
        if (o.anim === 'fade') alpha *= EZ.o2(u);
        else if (o.anim === 'rise') { alpha *= EZ.o2(u); dy = (1 - EZ.o3(u)) * f.size * 0.45; }
        else if (o.anim === 'pop') sc = Math.max(0.001, EZ.back(u));
      }
      const full = String(str);
      const lines = o.width ? wrapLines(full, f, o.width) : full.split('\n');
      let budget = Infinity;
      const total = lines.reduce((n, l) => n + [...l].length, 0);
      if (o.anim === 'type' && o.at != null) budget = Math.round(total * u);
      if (o.frac != null) budget = Math.min(budget, Math.round(total * clamp(o.frac)));
      if (alpha <= 0.004 || budget <= 0) return null;
      const lh = (o.lineHeight || 1.18) * f.size;
      G.save();
      if (!o.world) G.setTransform(scale, 0, 0, scale, 0, 0);
      const T0 = G.getTransform();
      G.globalAlpha *= clamp(alpha);
      G.fillStyle = o.color || tokens.ink || '#000';
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      lines.forEach((line, i) => {
        if (budget <= 0) return;
        const chars = [...line], shown = chars.length > budget ? chars.slice(0, budget).join('') : line;
        budget -= chars.length;
        const m = measure(line, f, tokens);
        const x0 = o.align === 'center' ? o.x - m.w / 2 : o.align === 'right' ? o.x - m.w : o.x;
        const y = o.y + i * lh + dy;
        if (sc !== 1) { G.translate(o.x, y); G.scale(sc, sc); G.translate(-o.x, -y); }
        if (typeof o.draw === 'function') o.draw(G, x0, y, cssFont(f), textPath(shown, f, tokens), shown);
        else fillLine(G, shown, x0, y, f, tokens);
        if (sc !== 1) G.setTransform(T0);
        const c = [[x0, y - m.asc * sc], [x0 + m.w, y + m.desc * sc]].map(([px, py]) => [T0.a * px + T0.c * py + T0.e, T0.b * px + T0.d * py + T0.f]);
        for (const [px, py] of c) { bx0 = Math.min(bx0, px); by0 = Math.min(by0, py); bx1 = Math.max(bx1, px); by1 = Math.max(by1, py); }
      });
      G.restore();
      const box = { x: bx0 / scale, y: by0 / scale, w: (bx1 - bx0) / scale, h: (by1 - by0) / scale };
      if (id !== false) {
        const rec = { id: id == null ? full : String(id), str: full, ...box };
        if (o.overprint) rec.overprint = true;
        if (BOXES.length < 2000) BOXES.push(rec);
      }
      noteDrawn(full, box, 'text');
      return box;
    }

    /** Elements for the DOM layer, made in setup (div, span, p, b, i, em, strong, small, sub, sup, br). */
    function el(tag, css, content) {
      if (!dom || !doc) return null;
      const t = String(tag || 'div').toLowerCase();
      if (!ALLOWED_TAGS.has(t)) throw new Error(`ctx.el: <${t}> is not allowed`);
      const cssText = css ? String(css) : '';
      if (/url\s*\(|@import|image-set\s*\(|(^|[;\s])(animation|transition)(-[a-z-]+)?\s*:/i.test(cssText)) throw new Error('ctx.el: no url(), imports, animation or transitions in css (pictures come from ctx.asset)');
      const e = doc.createElement(t);
      e.style.cssText = 'position:absolute;' + cssText;   // the same on every host (the page's CSS or not)
      if (content != null) e.textContent = String(content);
      dom.appendChild(e);
      return e;
    }

    function makeCtx(F, quality) {
      const TT = F / FPS, Bk = Math.floor(F / 2);
      const bubble = placement === 'duet' ? Object.freeze({ x: 48, y: 732, d: 300, keepOut: Object.freeze({ x: 0, y: 700, w: 380, h: 380 }) }) : null;
      return Object.freeze({
        W, H, fps: FPS, duration, hold, quality: quality || 'final', scale, placement, ones,
        t: TT, F, B: Bk, TT,
        g: G, dom,
        rng, fnv, cue, beat, beats: B.beats, words: B.words,
        ev: (t0, d = 0.25) => clamp((TT - t0) / d), EZ, clamp, lerp, seg, TAU,
        spring: (dt, p) => spring(dt, p), springTrack: (keys, p) => springTrackAt(TT, keys, p), SPRINGS,
        cam, camMix, push: (a, b, camA, camB, ease) => pushAt(TT, a, b, camA, camB, ease), bump: (t0, p, amt, every) => bumpAt(TT, t0, p, amt, every),
        apply: (c) => { const q = toCam(c); G.setTransform(q.z * scale, 0, 0, q.z * scale, q.tx * scale, q.ty * scale); },
        screen: () => G.setTransform(scale, 0, 0, scale, 0, 0),
        morph, LX: (f) => f * W, LY: (f) => f * H, UNIT: 10.8, safe: Object.freeze({ x: 64, y: 64, w: 1792, h: 952 }), bubble,
        text, el, registerBox, measure: (str, o) => measure(str, o, tokens),
        textPath: (str, o) => { const tp = textPath(str, o, tokens); noteDrawn(str, null, 'path'); return tp; },
        fillText: (g, str, x, y, o) => fillLine(g, str, x, y, o, tokens, false, 'fill'),
        asset: (name) => PICTURES.get(name) || null, canvas: makeCanvas,
        kit: KIT, tokens, state: STATE,
      });
    }

    function env() {
      return Object.freeze({
        W, H, FPS, rng, fnv, EZ, clamp, lerp, seg, TAU, spring, SPRINGS, tokens: (style && style.tokens) || tokens,
        registerBox, measure: (str, o) => measure(str, o, tokens),
        textPath: (str, o) => { const tp = textPath(str, o, tokens); noteDrawn(str, null, 'path'); return tp; },
        fillText: (g, str, x, y, o) => fillLine(g, str, x, y, o, tokens, false, 'fill'), parseFont: parseCssFont,
        canvas: makeCanvas,
        asset: (name) => PICTURES.get(name) || null,
      });
    }

    /** A hook's result must not be a promise (setup's may: it's awaited through an armed then, below). */
    function settle(v, name) { if (thenable(v)) throw new Error(`flpt-live: ${name} must draw synchronously (it returned a promise)`); return v; }

    function boot() {
      if (ready) return ready;
      ready = (async () => {
        armed(0, () => {
          style = D.style ? snapStyle(FLPT.styles[D.style]) : PLAIN;
          if (!style) throw new Error(`unknown style "${D.style}" (its kit.js isn't on the page)`);
          tokens = Object.freeze({ ...PLAIN.tokens, ...(style.tokens || {}) });
          ones = D.ones != null ? D.ones : !!style.ones;
          G = canvas.getContext('2d', { alpha: !!opts.transparent, willReadFrequently: true });
          if (scale !== 1) { canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale); }
        });
        await loadFonts([...(style.fonts || []), ...D.fonts], opts.fontBase, scope);
        await loadPictures(FILES.pictures);
        if (doc && doc.fonts && doc.fonts.ready) await doc.fonts.ready;
        armed(0, () => {
          const shared = {};
          for (const [k, v] of Object.entries(FLPT.kit)) shared[k] = v;
          const own = style.make ? settle(rApply(style.make, style.self, [env()]), 'make') || {} : {};
          KIT = Object.assign(shared, own);
          CUR = makeCtx(0, 'final');
          bindKits(CUR);
        });
        if (D.setup) {
          let s = armed(0, () => rApply(D.setup, D.self, [CUR]));
          if (armed(0, () => thenable(s))) {
            // a promise from setup is followed through its own then, armed; its value comes back boxed, so a thenable
            // value can't be adopted (and called) outside the guard
            const boxed = await new NativePromise((res, rej) => armed(0, () => { const th = s.then; rApply(th, s, [(v) => res({ v }), (e) => rej(e)]); }));
            s = boxed.v;
            armed(0, () => settle(s, 'setup'));
          }
          STATE = s || {};
        }
        isReady = true;
        return true;
      })();
      return ready;
    }
    function bindKits(ctx) {
      for (const k of Object.values(KIT)) if (k && typeof k === 'object' && typeof k.bind === 'function') settle(rApply(hook(k.bind, 'bind'), k, [ctx]), 'bind');
      if (typeof KIT.bind === 'function') settle(rApply(hook(KIT.bind, 'bind'), KIT, [ctx]), 'bind');
    }

    /**
     * The frame a time shows: the frame whose span holds t (floored like HyperFrames, so a mid-frame still time
     * (n + 0.5) / 30 and the exact n / 30 both give frame n), held for the last `hold` seconds, stepped on twos.
     */
    function frameFor(t) {
      let n = Math.floor(clamp(Number(t) || 0, 0, duration) * FPS + 1e-6);
      if (n > lastF) n = lastF;
      if (n >= holdF) n = holdF;
      return ones ? n : 2 * Math.floor(n / 2);
    }
    const drawKey = (n) => { let m = Math.max(0, Math.min(lastF, n | 0)); if (m >= holdF) m = holdF; return ones ? m : Math.floor(m / 2); };

    /** Draw the picture at t. Everything here runs armed: scene hooks, kits, and the runtime's own work around them. */
    function drawAt(t, quality) {
      if (!isReady) throw new Error('flpt-live: draw before the scene is ready (await FLPT.ready)');
      if (DRAWING) throw new Error('flpt-live: a draw inside a draw');
      const F = frameFor(t);
      return armed(F / FPS, () => {
        DRAWING = true;
        const prevRec = REC;
        try {
          const ctx = (CUR = makeCtx(F, quality));
          BOXES = []; DRAWN = [];
          const own = [];
          REC = { drawn: DRAWN, own, G, scale };
          if (takeText) takeText();
          if (typeof G.reset === 'function') G.reset();
          G.setTransform(scale, 0, 0, scale, 0, 0);
          G.globalAlpha = 1; G.globalCompositeOperation = 'source-over';
          if (opts.transparent) G.clearRect(0, 0, W, H);
          else { G.fillStyle = tokens.paper || '#fff'; G.fillRect(0, 0, W, H); }
          bindKits(ctx);
          settle(rApply(D.frame, D.self, [ctx, ctx.TT, STATE]), 'frame');
          G.setTransform(scale, 0, 0, scale, 0, 0);
          if (opts.stamp) stampFrame(G, Math.floor((Number(t) || 0) * FPS + 1e-6));
          // raw canvas text the guard logged: the runtime's own fallback calls fold out; the rest is the scene's
          if (takeText) {
            const raw = takeText();
            let n = 0;
            for (const r of raw) {
              const i = own.findIndex((o) => o.str === r.str && o.canvas === r.canvas);
              if (i >= 0) { own.splice(i, 1); continue; }
              const box = r.box && r.canvas === canvas ? { x: r.box.x / scale, y: r.box.y / scale, w: r.box.w / scale, h: r.box.h / scale } : null;
              if (box && BOXES.length < 2000) BOXES.push({ id: 'raw:' + n++, str: r.str, ...box, raw: true });
              if (DRAWN.length < 5000) DRAWN.push({ str: r.str, box, via: 'raw' });
            }
          }
          LAST = F;
          return Object.freeze({ t: ctx.TT, F: ctx.F });
        } finally { DRAWING = false; REC = prevRec; }
      });
    }
    function meta() {
      return armed(CUR ? CUR.TT : 0, () => {
        const c = CUR || makeCtx(0, 'final');
        let hits = [];
        if (D.hits) {
          const raw = isReady ? settle(rApply(D.hits, D.self, [c]), 'hits') : [];
          hits = (Array.isArray(raw) ? raw : []).filter((h) => h && Number.isFinite(Number(h.t)) && HIT_KINDS.has(h.kind))
            .map((h) => ({ t: Number(h.t), kind: String(h.kind), gain: Number.isFinite(Number(h.gain)) ? Number(h.gain) : 0 }));
          if (Array.isArray(raw) && raw.length !== hits.length) note('hits: some dropped (t must be a number, kind one of ' + [...HIT_KINDS].join(' ') + ')');
        }
        const keyframes = D.keyframes.map((k) => (typeof k === 'number' ? k : cue(k))).filter((t) => t >= 0 && t <= duration);
        return {
          runtime: 'flpt-live@' + VERSION, style: D.style, duration, fps: FPS, hold, ones, placement,
          layers: D.layers.length ? D.layers.slice() : ['canvas'],
          frames: lastF + 1, beats: B.beats.map((b) => ({ name: b.name, t: b.t, end: b.end })), keyframes, hits, errors: ERRORS.slice(),
        };
      });
    }
    const atFrame = (t, fn) => armed(t != null ? frameFor(t) / FPS : 0, () => { if (t != null && frameFor(t) !== LAST) drawAt(t, 'final'); return fn(); });
    /** Text boxes at t (scene units): ctx.text's and registered ones, the DOM layer's text, and raw canvas text. */
    function textBoxes(t) {
      return atFrame(t, () => {
        const out = BOXES.map((b) => ({ ...b }));
        let n = 0;
        for (const d of domText(dom)) if (d.box) out.push({ id: 'dom:' + n++, str: d.str, ...d.box, dom: true });
        return out;
      });
    }
    /** Every string on screen at t, boxed where it has one: [{ str, x, y, w, h | box: null, via }] (the text report's input). */
    function drawnText(t) {
      return atFrame(t, () => {
        const out = DRAWN.map((d) => ({ str: d.str, via: d.via, ...(d.box || { box: null }) }));
        for (const d of domText(dom)) out.push({ str: d.str, via: 'dom', ...(d.box || { box: null }) });
        return out;
      });
    }
    return Object.freeze({
      def: D, canvas, dom, duration, hold, get ones() { return ones; }, get ready() { return boot(); },
      boot, drawAt, frameFor, drawKey, meta, textBoxes, drawnText,
      seek: async (t, o = {}) => { await boot(); const a = realNow(); const r = drawAt(t, o.quality); return { t: r.t, F: r.F, ms: realNow() - a }; },
    });
  }

  /** K1's frame stamp: F as 12 black/white 24 px blocks after a white and a black marker (conformance renders only). */
  function stampFrame(g, F) {
    const S = 24;
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S); g.fillStyle = '#000000'; g.fillRect(S, 0, S, S);
    for (let b = 0; b < 12; b++) { g.fillStyle = (F >> (11 - b)) & 1 ? '#000000' : '#ffffff'; g.fillRect((b + 2) * S, 0, S, S); }
    g.restore();
  }

  // ───────────────────────────── the page API ─────────────────────────────
  // Every member is fixed when this file runs (before any scene script): a scene can't swap what a host calls. Only
  // the two registries stay open: FLPT.styles (through FLPT.style) and FLPT.kit.<name>.
  let PAGE_DEF = null, PAGE = null, CAPTURE = null;
  const STYLES = {}, KITS = {};
  const page = () => {
    if (PAGE) return PAGE;
    if (!PAGE_DEF) throw new Error('scene.js never called FLPT.scene');
    const c = PAGE_CFG || {};
    PAGE = createScene(PAGE_DEF, { canvas: c.stage, dom: c.dom, duration: c.duration || undefined, beats: c.beats, stamp: !!c.stamp, transparent: false });
    return PAGE;
  };
  const API = {
    runtime: 'flpt-live', version: VERSION, fps: FPS, W, H, styles: STYLES, kit: KITS,
    /** The page's stage canvas (null where there's no host page: host-inline mounts its own). */
    canvas: (PAGE_CFG && PAGE_CFG.stage) || null,
    /** scene.js calls this once. A host may capture definitions instead (host-inline, FLPT.__captureScenes). */
    scene(def) {
      const s = snapDef(def);
      if (CAPTURE) return CAPTURE(s);
      if (PAGE_DEF) throw new Error('FLPT.scene may be called once');
      PAGE_DEF = s;
      return undefined;
    },
    /** A style kit registers itself: FLPT.style(id, { tokens, fonts, ones, make(env) }). */
    style(id, def) {
      if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(String(id))) throw new Error(`FLPT.style: bad id "${id}"`);
      STYLES[id] = snapStyle(def);
    },
    /** host-inline only: route FLPT.scene() to fn (null to stop). Refused to scene code. */
    __captureScenes(fn) {
      if (GUARD && GUARD.armed()) throw new Error('FLPT.__captureScenes is for hosts');
      CAPTURE = typeof fn === 'function' ? fn : null;
    },
    /** Generated files.js: { fonts: { "x.ttf": "<base64>" }, pictures: ["a.png"] }; fonts are keyed by that script. */
    __files(spec) {
      const cs = doc && doc.currentScript, from = cs && cs.src ? String(cs.src) : '';
      for (const [name, b64] of Object.entries((spec && spec.fonts) || {})) {
        if (FILES.fonts.has(from + '\n' + name)) continue;
        const bytes = fromB64(b64);
        FILES.fonts.set(from + '\n' + name, bytes);
        if (!FILES.byName.has(name)) FILES.byName.set(name, bytes);
      }
      for (const p of (spec && spec.pictures) || []) if (!FILES.pictures.includes(String(p))) FILES.pictures.push(String(p));
    },
    /** A scene on a given canvas (host-inline, host-export): FLPT.mount(def, { canvas, dom, duration, beats, files, ... }). */
    mount: (def, opts) => createScene(def, opts || {}),
    __boot: () => page().boot(),
    /** Draw t for a host: { t, F } (the frame actually drawn: hold and twos included). */
    __drawAt: (t, q) => page().drawAt(t, q),
    seek: (t, o) => page().seek(t, o),
    renderFrame: (t) => { page().drawAt(t, 'final'); },
    meta: () => page().meta(),
    textBoxes: (t) => page().textBoxes(t),
    drawnText: (t) => page().drawnText(t),
    drawKey: (n) => page().drawKey(n),
    // pure helpers, for tools and tests
    lib: Object.freeze({ fnv, mulberry32, rng, EZ, SPRINGS, spring, springTrackAt, cam, camMix, morph, clamp, lerp, seg, parseFont, parseCssFont, fromB64, measure: (s, o) => measure(s, o, PLAIN.tokens), textPath: (s, o) => textPath(s, o, PLAIN.tokens), registerOutline }),
  };
  const FLPT = {};
  for (const k of Object.keys(API)) defProp(FLPT, k, { value: API[k], writable: false, enumerable: true, configurable: false });
  defProp(FLPT, 'ready', { get() { return page().boot(); }, enumerable: true, configurable: false });
  defProp(FLPT, 'duration', { get() { return PAGE ? PAGE.duration : (PAGE_CFG && PAGE_CFG.duration) || 0; }, enumerable: true, configurable: false });
  defProp(FLPT, 'errors', { get() { return ERRORS.slice(); }, enumerable: true, configurable: false });
  Object.preventExtensions(FLPT);
  defProp(root, 'FLPT', { value: FLPT, writable: false, enumerable: false, configurable: false });
  defProp(root, 'renderFrame', { value: (t) => FLPT.renderFrame(t), writable: false, enumerable: false, configurable: false });
})(typeof window !== 'undefined' ? window : globalThis);
