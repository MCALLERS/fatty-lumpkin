#!/usr/bin/env node
// pacing.mjs · does the picture keep moving? A measured pacing check on a rendered piece (Q-01; research 11 §3 item 1:
// the idea of ItsssssJack/claude-video-2's pacing check, MIT, rebuilt here in FLPT's own code).
//
//   node pacing.mjs <clip.mp4> [--kind solo|duet|cosmos|interstitial|cutscene] [--beats beats.json] [--json]
//   import { analyse, greyArgs, measure, lines, heldSpans, maxGapFor, PACING } from './pacing.mjs'
//
// The clip, decoded to grey frames (20 a second, 240 px wide), is read for four things:
//   dead gaps    nothing visibly changes for longer than 1.5 s on a Solo (2.5 s on a Duet, where the presenter carries
//                the pause), not counting the end hold (beats.json "hold", the last 0.5 s) or a beat's declared hold
//                ("hold": seconds, or true up to the next beat: the picture held on purpose once that beat lands).
//                Measured on 64 px squares, so a style's own boil and grain (Riso's dots, Crosshatch's lines) and a
//                ticking digit don't count as motion; a slow move adds up until it does
//   short shots  a hard cut (most of the frame changes in one step, steady either side: not a wipe or a whip) less
//                than 0.3 s after the one before
//   flashes      a burst of light, or a third of the picture, that pops in and out again inside 0.3 s: the frame
//                differs from the ones 0.15 s before and after while those two match (a camera bump doesn't count)
//   framing      the same framing for more than 10 s: the picture's structure where it was (high-passed, so a
//                vignette or a paper texture never holds it together), no camera move, no cut, no new scene
// Plus the motion in each second (the share of the 64 px squares that change in 0.1 s), for the crew to read as a line.
// The numbers were calibrated on the eleven styles' narrated showcases, their demos and G0's and G1's crew pieces
// (Q-01). A report, never a gate: the scene crew reads it in contact_sheet and render_preview, and a finished piece
// that flags shows "Needs a look" (scenecrew.checkPiece). analyse() is pure: the app decodes through its own sandboxed
// ffmpeg (greyArgs), the CLI and measure() through the toolchain's.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { toolchain, probe, parseArgs, isMain } from './lib.mjs';

export const PACING = Object.freeze({
  rate: 20, // grey frames a second
  width: 240, height: 135, // a 1920×1080 piece, an eighth of its size
  level: 14, // a pixel moved: more than this many grey levels
  // dead gaps: 8 px squares (64 px in the piece); the picture changed once 2 of them moved more than 8 levels
  stillBlock: 8, stillLevel: 8, stillBlocks: 2,
  gap: Object.freeze({ duet: 2.5, other: 1.5 }),
  // cuts: over this share of the squares moved in one step (0.05 s), with less than half that the step before and after
  cut: 0.35, cutSteady: 0.5,
  shortShot: 0.3,
  // flashes: the frame differs from both 0.15 s away by over 2 % (a shift of 2 px allowed) while they agree within a
  // quarter of that; and it's light (the mean brighter or darker than both by 2 levels) or a third of the picture
  flashSpan: 0.15, flash: 0.02, flashMatch: 0.25, flashLight: 2, flashArea: 0.33, shift: 2,
  // framing: 4 px squares, high-passed (5×5), compared in a 4×3 grid of cells; a new framing once the structure in
  // 60 % of the cells that have any no longer correlates (under 0.5) with the framing's first frame
  framing: 10, frameBlock: 4, highPass: 2, cols: 4, rows: 3, correlate: 0.5, reframed: 0.6, detail: 0.75,
  maxSeconds: 300,
});

const r2 = (x) => Math.round(x * 100) / 100;
const KIND_NAME = { solo: 'a Solo', duet: 'a Duet', cosmos: 'a Cosmos piece', interstitial: 'a Solo ♪', cutscene: 'a cut scene' };

/** The longest still a piece of this kind may hold (seconds). */
export const maxGapFor = (kind) => (kind === 'duet' ? PACING.gap.duet : PACING.gap.other);

/**
 * The spans meant to be still, from beats.json: the end hold (its "hold", the last 0.5 s by default) and each beat's
 * declared hold ("hold": seconds from the beat's end, at most 10, or true: from its end to the next beat). → [[from, to]]
 */
export function heldSpans(beats, duration) {
  const b = beats && typeof beats === 'object' ? beats : {};
  const out = [];
  const hold = Number.isFinite(Number(b.hold)) && b.hold !== null ? Math.max(0, Number(b.hold)) : 0.5;
  if (duration > 0 && hold > 0) out.push([Math.max(0, duration - hold), duration]);
  const list = (Array.isArray(b.beats) ? b.beats : []).filter((x) => x && x.t != null && Number.isFinite(Number(x.t))).map((x) => ({ ...x, t: Number(x.t) })).sort((x, y) => x.t - y.t);
  list.forEach((x, i) => {
    if (x.hold == null || x.hold === false) return;
    const from = Number.isFinite(Number(x.end)) ? Math.max(x.t, Number(x.end)) : x.t;
    const next = list.slice(i + 1).find((y) => y.t > from);
    const to = x.hold === true ? (next ? next.t : duration) : from + Math.max(0, Math.min(10, Number(x.hold) || 0));
    const end = duration > 0 ? Math.min(duration, to) : to;
    if (end > from) out.push([from, end]);
  });
  const r6 = (x) => Math.round(x * 1e6) / 1e6;
  return out.map(([a, z]) => [r6(a), r6(z)]).sort((x, y) => x[0] - y[0]);
}

/** [from, to] less the held spans: the parts left over. */
function minus(span, held) {
  let parts = [span];
  for (const [a, b] of held) {
    parts = parts.flatMap(([x, y]) => (b <= x || a >= y ? [[x, y]] : [[x, Math.min(y, a)], [Math.max(x, b), y]].filter(([p, q]) => q - p > 1e-6)));
  }
  return parts;
}

/** ffmpeg's arguments for the grey frames: to `out` (a file), or to its standard output. */
export function greyArgs(input, { out = '-', rate = PACING.rate, width = PACING.width, height = PACING.height, seconds = PACING.maxSeconds } = {}) {
  return ['-v', 'error', '-y', '-t', String(seconds), '-i', input, '-map', '0:v:0', '-an',
    '-vf', `fps=${rate},scale=${width}:${height}:flags=area,format=gray`, '-f', 'rawvideo', '-pix_fmt', 'gray', out];
}

/** The share of pixels that moved more than `level` between frames a and b (w×h), b shifted by (dx, dy), a border of m left out. */
function moved(a, b, w, h, { dx = 0, dy = 0, m = 0, level = PACING.level } = {}) {
  let k = 0;
  for (let y = m; y < h - m; y++) {
    const ra = y * w;
    const rb = (y + dy) * w + dx;
    for (let x = m; x < w - m; x++) { const d = a[ra + x] - b[rb + x]; if (d > level || d < -level) k++; }
  }
  const n = (w - 2 * m) * (h - 2 * m);
  return n > 0 ? k / n : 0;
}

/** The least share moved over every shift of b within ±r pixels: a bump isn't a change. */
function movedShifted(a, b, w, h, r, level) {
  let best = Infinity;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) best = Math.min(best, moved(a, b, w, h, { dx, dy, m: r, level }));
  return best;
}

const meanOf = (f) => { let s = 0; for (let i = 0; i < f.length; i++) s += f[i]; return f.length ? s / f.length : 0; };

/** A frame as the means of B×B squares: { c, cw, ch }. */
function squares(f, w, h, B) {
  const cw = Math.max(1, Math.floor(w / B));
  const ch = Math.max(1, Math.floor(h / B));
  const c = new Float32Array(cw * ch);
  for (let y = 0; y < ch * B; y++) { const row = Math.floor(y / B) * cw; for (let x = 0; x < cw * B; x++) c[row + Math.floor(x / B)] += f[y * w + x]; }
  for (let i = 0; i < c.length; i++) c[i] /= B * B;
  return { c, cw, ch };
}

/** The squares less their (2r+1)² neighbourhood's mean: the structure, without a vignette, a gradient or a wash. */
function highPass({ c, cw, ch }, r) {
  const o = new Float32Array(c.length);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      let s = 0;
      let k = 0;
      for (let yy = Math.max(0, y - r); yy <= Math.min(ch - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(cw - 1, x + r); xx++) { s += c[yy * cw + xx]; k++; }
      o[y * cw + x] = c[y * cw + x] - s / k;
    }
  }
  return { c: o, cw, ch };
}

/** One cell's values, of a cols×rows grid over the squares. */
function cellOf({ c, cw, ch }, cx, cy, cols, rows) {
  const x0 = Math.floor((cx * cw) / cols); const x1 = Math.floor(((cx + 1) * cw) / cols);
  const y0 = Math.floor((cy * ch) / rows); const y1 = Math.floor(((cy + 1) * ch) / rows);
  const out = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out.push(c[y * cw + x]);
  return out;
}
const spread = (v) => { const m = v.reduce((s, x) => s + x, 0) / (v.length || 1); return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length || 1)); };
function correlation(p, q) {
  const mp = p.reduce((s, x) => s + x, 0) / (p.length || 1);
  const mq = q.reduce((s, x) => s + x, 0) / (q.length || 1);
  let s = 0; let sp = 0; let sq = 0;
  for (let i = 0; i < p.length; i++) { const x = p[i] - mp; const y = q[i] - mq; s += x * y; sp += x * x; sq += y * y; }
  return sp && sq ? s / Math.sqrt(sp * sq) : 0;
}

/**
 * The pacing of a clip from its grey frames (a Buffer of w×h frames, `rate` a second). o: { w, h, rate, kind, beats
 * (beats.json: its holds), limits (PACING overrides) }. Pure. → the report: { ok, seconds, frames, kind, limits, held,
 * longestStill, gaps, cuts, shortShots, flashes, framings, longestFraming, staticFraming, energy, flags }
 */
export function analyse(buf, o = {}) {
  const P = { ...PACING, ...(o.limits || {}) };
  const w = o.w || P.width;
  const h = o.h || P.height;
  const rate = o.rate || P.rate;
  const size = w * h;
  if (!buf || buf.length < size) throw new Error('no frames to measure');
  const n = Math.floor(buf.length / size);
  const F = (i) => buf.subarray(i * size, (i + 1) * size);
  const T = (i) => i / rate;
  const seconds = r2(n / rate);
  const kind = o.kind || 'solo';
  const maxGap = o.maxGap || maxGapFor(kind);
  const held = heldSpans(o.beats, n / rate);
  const endHold = heldSpans({ hold: o.beats && typeof o.beats === 'object' ? o.beats.hold : undefined }, n / rate);

  // dead gaps: from each still's first frame, while fewer than `stillBlocks` squares moved more than `stillLevel`
  const sq = Array.from({ length: n }, (_, i) => squares(F(i), w, h, P.stillBlock).c);
  const changed = (a, b) => { let k = 0; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > P.stillLevel && ++k >= P.stillBlocks) return true; return false; };
  const stills = [];
  let anchor = 0;
  for (let i = 1; i <= n; i++) {
    if (i === n || changed(sq[anchor], sq[i])) {
      if (i - anchor > 1) stills.push([T(anchor), T(i)]);
      anchor = i;
    }
  }
  const open = stills.flatMap((s) => minus(s, held));
  const longestStill = r2(open.reduce((m, [a, b]) => Math.max(m, b - a), 0));
  const gaps = open.filter(([a, b]) => b - a > maxGap + 1e-6).map(([a, b]) => ({ from: r2(a), to: r2(b), seconds: r2(b - a) }));

  // the hard cuts: one step (0.05 s) where over `cut` of the squares moved, the steps either side steady (on the
  // squares, so a style's boil never reads as a cut)
  const d1 = new Float64Array(n);
  const share = (a, b) => { let k = 0; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > P.stillLevel) k++; return k / a.length; };
  for (let i = 1; i < n; i++) d1[i] = share(sq[i - 1], sq[i]);
  const cuts = [];
  for (let i = 1; i < n; i++) {
    if (d1[i] <= P.cut) continue;
    const before = i >= 2 ? d1[i - 1] : 0;
    const after = i + 1 < n ? d1[i + 1] : 0;
    if (Math.max(before, after) < P.cutSteady * d1[i]) cuts.push(r2(T(i) - 0.5 / rate));
  }
  const step = Math.max(1, Math.round(rate / 10));
  const energy = [];
  for (let s = 0; s * rate < n; s++) {
    let sum = 0;
    let k = 0;
    for (let i = Math.max(step, s * rate); i < Math.min(n, (s + 1) * rate); i += 1) { sum += share(sq[i - step], sq[i]); k++; }
    energy.push(k ? Math.round((sum / k) * 1000) / 1000 : 0);
  }

  // flashes: differs from both neighbours 0.15 s away, which agree; light, or a third of the picture; never a bump
  const K = Math.max(1, Math.round(P.flashSpan * rate));
  const means = Array.from({ length: n }, (_, i) => meanOf(F(i)));
  const hits = [];
  for (let i = K; i + K < n; i++) {
    const a = moved(F(i - K), F(i), w, h, { level: P.level });
    const b = moved(F(i), F(i + K), w, h, { level: P.level });
    const least = Math.min(a, b);
    if (least <= P.flash) continue;
    if (moved(F(i - K), F(i + K), w, h, { level: P.level }) > P.flashMatch * least) continue;
    const da = means[i] - means[i - K];
    const db = means[i] - means[i + K];
    const light = Math.sign(da) === Math.sign(db) && Math.min(Math.abs(da), Math.abs(db)) >= P.flashLight;
    if (!light && least < P.flashArea) continue;
    const shifted = Math.min(movedShifted(F(i - K), F(i), w, h, P.shift, P.level), movedShifted(F(i), F(i + K), w, h, P.shift, P.level));
    if (shifted <= P.flash) continue;
    hits.push({ i, share: shifted });
  }
  const runs = [];
  for (const x of hits) {
    const last = runs[runs.length - 1];
    if (last && x.i - last.to <= K) { last.to = x.i; if (x.share > last.share) { last.share = x.share; last.i = x.i; } } else runs.push({ i: x.i, to: x.i, share: x.share });
  }
  const flashes = runs.map((f) => ({ at: r2(T(f.i)), share: r2(f.share) }));

  // short shots: between two cuts (or the start and the first, the last and the end); a flash already is said once
  const bounds = [0, ...cuts, seconds];
  const shortShots = [];
  for (let i = 1; i < bounds.length; i++) {
    const [a, b] = [bounds[i - 1], bounds[i]];
    if (!cuts.length || b - a >= P.shortShot - 1e-6) continue;
    if (flashes.some((f) => f.at >= a - P.flashSpan && f.at <= b + P.flashSpan)) continue;
    shortShots.push({ from: r2(a), to: r2(b), seconds: r2(b - a) });
  }

  // framing: from each framing's first frame (5 a second), until most of its structure has gone elsewhere
  const every = Math.max(1, Math.round(rate / 5));
  const hpSeen = new Map();
  const hp = (i) => { if (!hpSeen.has(i)) hpSeen.set(i, highPass(squares(F(i), w, h, P.frameBlock), P.highPass)); return hpSeen.get(i); };
  // the clip's own noise (boil, grain): the quietest tenth of its 0.1 s steps, on the same squares
  const quiet = [];
  for (let i = step; i < n; i += step) {
    const a = hp(i - step).c; const b = hp(i).c;
    let s = 0;
    for (let j = 0; j < a.length; j++) s += Math.abs(a[j] - b[j]);
    quiet.push(s / a.length);
  }
  quiet.sort((x, y) => x - y);
  const noise = quiet.length ? quiet[Math.floor(quiet.length * 0.1)] : 0;
  const minSpread = Math.max(P.detail, 3 * noise);
  const reframed = (A, B) => {
    let use = 0;
    let moves = 0;
    for (let cy = 0; cy < P.rows; cy++) {
      for (let cx = 0; cx < P.cols; cx++) {
        const p = cellOf(A, cx, cy, P.cols, P.rows);
        const q = cellOf(B, cx, cy, P.cols, P.rows);
        const sp = spread(p) >= minSpread;
        const sq2 = spread(q) >= minSpread;
        if (!sp && !sq2) continue;
        use++;
        if (!sp || !sq2 || correlation(p, q) < P.correlate) moves++;
      }
    }
    return use > 0 && moves >= P.reframed * use;
  };
  const framings = [];
  let fa = 0;
  let first = hp(0);
  for (let i = every; ; i += every) {
    const last = i >= n - 1;
    const at = Math.min(i, n - 1);
    if (last || reframed(first, hp(at))) {
      framings.push([T(fa), last ? n / rate : T(at)]);
      if (last) break;
      fa = at;
      first = hp(at);
    }
  }
  const framed = framings.flatMap((s) => minus(s, endHold)).map(([a, b]) => ({ from: r2(a), to: r2(b), seconds: r2(b - a) }));
  const longestFraming = framed.reduce((m, f) => Math.max(m, f.seconds), 0);
  const staticFraming = framed.filter((f) => f.seconds > P.framing + 1e-6);

  const kindName = KIND_NAME[kind] || 'this piece';
  const flags = [
    ...gaps.map((g) => `dead gap ${g.from.toFixed(1)}–${g.to.toFixed(1)} s: nothing moves for ${g.seconds.toFixed(1)} s (${kindName} allows ${maxGap} s)`),
    ...shortShots.map((s) => `short shot ${s.from.toFixed(2)}–${s.to.toFixed(2)} s: ${s.seconds.toFixed(2)} s between cuts (${P.shortShot} s at least)`),
    ...flashes.map((f) => `flash at ${f.at.toFixed(2)} s: ${Math.round(f.share * 100)} % of the picture pops in and out inside ${r2(2 * P.flashSpan)} s`),
    ...staticFraming.map((f) => `static framing ${f.from.toFixed(1)}–${f.to.toFixed(1)} s: the same framing for ${f.seconds.toFixed(1)} s (${P.framing} s at most)`),
  ];
  return {
    ok: !flags.length, seconds, frames: n, rate, kind, limits: { gap: maxGap, shortShot: P.shortShot, flash: r2(2 * P.flashSpan), framing: P.framing },
    held: held.map(([a, b]) => [r2(a), r2(b)]), longestStill, gaps, cuts, shortShots, flashes,
    framings: framed, longestFraming: r2(longestFraming), staticFraming, energy, flags,
  };
}

const BARS = '▁▂▃▄▅▆▇█';
/** The motion in each second as one line of bars (the share changing, on a square-root scale: 25 % or more is full). */
export function energyLine(energy) {
  return (energy || []).map((e) => BARS[Math.max(0, Math.min(BARS.length - 1, Math.round(Math.sqrt(Math.min(1, Math.max(0, e) / 0.25)) * (BARS.length - 1))))]).join('');
}

/** The report as the crew reads it: a few lines. */
export function lines(r) {
  if (!r) return [];
  const head = r.ok
    ? `Pacing: no dead gaps (the longest still ${r.longestStill.toFixed(1)} s), no flashes or short shots, a new framing within ${r.longestFraming.toFixed(1)} s.`
    : `Pacing (a report, not a gate): ${r.flags.slice(0, 6).join('; ')}.`;
  return [head, `Motion by second: ${energyLine(r.energy)}`,
    r.gaps.length ? 'A pause meant to be still? Declare it on the beat it follows in beats.json: "hold": seconds (or true, to the next beat).' : null].filter(Boolean);
}

/** A clip measured with the toolchain's ffmpeg (the CLI's path; the app decodes through its sandbox). → the report */
export function measure(video, { kind = 'solo', beats = null, env = process.env, limits } = {}) {
  const tc = toolchain(env);
  if (!tc.ffmpeg || !tc.ffprobe) throw new Error('no ffmpeg');
  const p = probe(tc, video);
  const w = PACING.width;
  const h = Math.max(2, Math.round((w * p.height) / p.width));
  const r = spawnSync(tc.ffmpeg, greyArgs(video, { width: w, height: h }), { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(String(r.stderr || 'ffmpeg failed').slice(0, 400));
  return analyse(r.stdout, { w, h, rate: PACING.rate, kind, beats, limits });
}

if (isMain(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2), ['json']);
  if (!a._[0]) { console.error('usage: pacing.mjs <clip.mp4> [--kind solo|duet|cosmos|interstitial|cutscene] [--beats beats.json] [--json]'); process.exit(64); }
  const beats = a.beats ? JSON.parse(readFileSync(resolve(a.beats), 'utf8')) : null;
  const r = measure(resolve(a._[0]), { kind: a.kind || (beats && beats.placement === 'duet' ? 'duet' : 'solo'), beats });
  const text = a.json ? JSON.stringify(r, null, 1) : lines(r).join('\n');
  process.stdout.write(`${text}\n`, () => process.exit(0));
}
