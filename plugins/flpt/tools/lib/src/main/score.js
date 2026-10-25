'use strict';
// What plays under a Live Motion piece, and when (PLAN §2.6, §2.14). FLPT writes it into the piece's score/ folder;
// the crew never writes any of it.
//   music   none · score:<preset> (flpt-score: made here, free) · library:<addonsId> (one of the five shipped CC BY
//           tracks, on the beat grid measured once and shipped beside the score) · file:<token> (the user's own file,
//           played unsnapped) · gen: (2.1)
//   sfx     off · soft · on: one synthesised one-shot per hit, from the beats' sfx and the scene's hits(ctx)
//   sceneGrid()  pure: the music's beat grid in the piece's own time (what `at: "bar 2"` resolves against)
//   plan()       pure: the score.json record and the work to do
//   write()      renders the music and the one-shots, mixes the stem (mixer.js), checks it, writes score.json
// Defaults (PLAN §2.6): Solo none + soft, Duet none + off, code Cosmos none + soft, interstitial (Solo ♪) score + on,
// code cut scene score + soft. A style's sound.score names the preset; its sound.sfx sets narrated pieces' effects.
const fs = require('fs');
const path = require('path');
const mixer = require('./mixer');

const { SR, SPF, BED, INTER, DUCK, SFX_LEVEL } = mixer;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const KINDS = ['solo', 'duet', 'cosmos', 'interstitial', 'cutscene'];
const ALIASES = { 'motion-solo': 'solo', 'motion-duet': 'duet', jsscene: 'interstitial' };
const NARRATED = new Set(['solo', 'duet', 'cosmos']);
const DEFAULTS = {
  solo: { music: 'none', sfx: 'soft' },
  duet: { music: 'none', sfx: 'off' },
  cosmos: { music: 'none', sfx: 'soft' },
  interstitial: { music: 'score', sfx: 'on' },
  cutscene: { music: 'score', sfx: 'soft' },
};
const DEFAULT_PRESET = 'pulse-112';
const XFADE = 0.05; // s: the crossfade where a looped track joins itself

// ── the runtime (engine/runtime/flpt-live/score), found from the app, the packaged app or the plugin's copy ──
function candidates(engineRoot) {
  if (engineRoot) return [engineRoot];
  return [
    path.resolve(__dirname, '..', '..', '..', 'engine'), // app/src/main → <repo>/engine
    process.resourcesPath ? path.join(process.resourcesPath, 'engine') : null, // the packaged app
    path.resolve(__dirname, '..', '..', '..', '..'), // engine/tools/lib/src/main → engine (the plugin's copy)
  ].filter(Boolean);
}
function runtimeDir(engineRoot) {
  for (const root of candidates(engineRoot)) {
    const d = path.join(root, 'runtime', 'flpt-live', 'score');
    if (fs.existsSync(path.join(d, 'flpt-score.js'))) return d;
  }
  throw new Error('FLPT\'s score engine is missing (engine/runtime/flpt-live/score).');
}
const loaded = new Map();
/** flpt-score itself (the same file the Stage's Worker loads). */
function lib(engineRoot) {
  const d = runtimeDir(engineRoot);
  if (!loaded.has(d)) loaded.set(d, require(path.join(d, 'flpt-score.js')));
  return loaded.get(d);
}
const presetIds = (engineRoot) => lib(engineRoot).PRESETS;

/** A shipped preset's data (score/presets/<id>.json). */
function preset(id, { engineRoot } = {}) {
  if (!ID.test(String(id)) || !presetIds(engineRoot).includes(id)) throw new Error(`There's no score called "${String(id).slice(0, 40)}".`);
  return JSON.parse(fs.readFileSync(path.join(runtimeDir(engineRoot), 'presets', `${id}.json`), 'utf8'));
}

/** A shipped CC BY track's beat grid (score/grids/<addonsId>.json, in the track's own time), or null. */
function libraryGrid(id, { engineRoot } = {}) {
  if (!ID.test(String(id))) return null;
  const f = path.join(runtimeDir(engineRoot), 'grids', `${id}.json`);
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}

/**
 * The shipped preset nearest a library track (DV13: it plays where the track isn't on this computer): the closest tempo
 * to the track's measured grid, as a ratio; the default preset for a track with no grid. Calmant (57 BPM) → hush.
 */
function nearestPreset(id, { engineRoot } = {}) {
  const g = libraryGrid(id, { engineRoot });
  const bpm = Number(g && g.bpm);
  if (!(bpm > 0)) return DEFAULT_PRESET;
  let best = DEFAULT_PRESET;
  let far = Infinity;
  for (const p of presetIds(engineRoot)) {
    const d = Math.abs(Math.log2(Number(preset(p, { engineRoot }).bpm) / bpm));
    if (d < far - 1e-9) { far = d; best = p; }
  }
  return best;
}

// ── the sound of a shot ─────────────────────────────────────────────────────────────────────────
const kindOf = (k) => { const v = ALIASES[k] || k; if (!KINDS.includes(v)) throw new Error(`"${String(k).slice(0, 40)}" has no score.`); return v; };

/** music grammar: none | score:<preset> | library:<addonsId> | file:<token> | gen:<take> (2.1). */
function parseMusic(v, { engineRoot } = {}) {
  const s = v == null ? 'none' : String(v).trim();
  if (s === 'none' || s === '') return { source: 'none', ref: 'none', id: null };
  const m = /^(score|library|file|gen):([A-Za-z0-9._-]{1,128})$/.exec(s);
  if (!m) throw new Error(`"${s.slice(0, 40)}" isn't a sound FLPT knows.`);
  if (m[1] === 'gen') throw new Error('Generated music comes after 2.0.');
  if (m[1] === 'score' && !presetIds(engineRoot).includes(m[2])) throw new Error(`There's no score called "${m[2]}".`);
  if (m[1] === 'library' && !ID.test(m[2])) throw new Error(`There's no track called "${m[2]}".`);
  return { source: m[1], ref: s, id: m[2] };
}
function parseSfx(v) {
  const s = v == null ? 'off' : String(v);
  if (!Object.prototype.hasOwnProperty.call(SFX_LEVEL, s)) throw new Error(`Sound effects are off, soft or on, not "${s.slice(0, 20)}".`);
  return s;
}

/**
 * The sound a piece plays with: the shot's own choice, else the style's, else the module's default.
 * { kind, shot: { sound: { music, sfx } }, style: { sound: { score, sfx } } } → { music, sfx }
 */
function soundFor({ kind, shot = null, style = null, engineRoot } = {}) {
  const k = kindOf(kind);
  const d = DEFAULTS[k];
  const ss = (style && style.sound) || {};
  const stylePreset = presetIds(engineRoot).includes(ss.score) ? ss.score : DEFAULT_PRESET;
  const own = (shot && shot.sound) || {};
  let music = own.music != null ? String(own.music) : (d.music === 'score' ? `score:${stylePreset}` : 'none');
  if (music === 'score') music = `score:${stylePreset}`;
  const styleSfx = NARRATED.has(k) && Object.prototype.hasOwnProperty.call(SFX_LEVEL, ss.sfx) ? ss.sfx : null;
  const sfx = own.sfx != null ? String(own.sfx) : (styleSfx || d.sfx);
  parseMusic(music, { engineRoot });
  parseSfx(sfx);
  return { music, sfx };
}

/**
 * The hits a piece's sound effects land on, in its own time: each beat's `sfx` (a kind, or { kind, offset, gain }, or a
 * list) at the beat's aligned t + offset, and the scene's hits(ctx) ([{ t, kind, gain }]). Unknown kinds and times
 * outside the piece are dropped; gain is capped at +2 dB; one hit per kind within 10 ms (a beat's sfx and a hit on the
 * same moment would double). → [{ at, kind, gain, from: 'beat'|'hit', beat? }] in time order
 */
function hitsFrom({ beats = [], hits = [], seconds = Infinity, engineRoot } = {}) {
  const kinds = lib(engineRoot).SFX_KINDS;
  const out = [];
  const add = (t, kind, gain, from, beat) => {
    if (!kinds.includes(kind) || !Number.isFinite(t) || t < 0 || t >= seconds) return;
    const g = Number.isFinite(gain) ? Math.max(-24, Math.min(2, gain)) : 0;
    out.push({ at: +t.toFixed(6), kind, gain: g, from, ...(beat != null ? { beat: String(beat).slice(0, 64) } : {}) });
  };
  for (const b of Array.isArray(beats) ? beats : []) {
    if (!b || b.sfx == null || !Number.isFinite(Number(b.t))) continue;
    for (const x of [].concat(b.sfx)) {
      const o = typeof x === 'string' ? { kind: x } : (x || {});
      add(Number(b.t) + (Number(o.offset) || 0), o.kind, Number(o.gain) || 0, 'beat', b.id ?? b.cue ?? b.at ?? null);
    }
  }
  for (const h of Array.isArray(hits) ? hits : []) if (h) add(Number(h.t), h.kind, Number(h.gain) || 0, 'hit');
  out.sort((a, b) => a.at - b.at || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
  return out.filter((h, i) => !out.slice(0, i).some((p) => p.kind === h.kind && Math.abs(p.at - h.at) < 0.01));
}

// ── the music's place in the piece ──────────────────────────────────────────────────────────────
/**
 * Where a library track's excerpt starts: on a bar line (a beat, for a track measured without bars) at or before the
 * start asked for, early enough that the piece fits before the track ends. A piece longer than the whole track loops
 * (bar line to bar line, a 50 ms crossfade at each join).
 */
function fitLibrary(grid, { start = 0, seconds, samples }) {
  const total = samples ? samples / SR : (grid && grid.duration) || Infinity;
  let s = Math.max(0, Number(start) || 0);
  if (s + seconds > total) s = seconds <= total ? total - seconds : (s < total ? s : 0); // fits, or loops from where asked
  const pick = (k) => (grid && Array.isArray(grid[k]) ? grid[k] : []);
  const marks = pick('bars').length ? pick('bars') : pick('beats');
  if (marks.length) { const m = [...marks].reverse().find((b) => b <= s + 1e-6); s = m != null ? m : 0; }
  const loop = s + seconds > total;
  let loopFrom = 0;
  let loopTo = total - XFADE;
  if (loop && marks.length > 1) {
    loopFrom = marks.find((b) => b >= s - 1e-6) ?? marks[0];
    const end = [...marks].reverse().find((b) => b <= total - XFADE && b > loopFrom);
    if (end != null) loopTo = end;
  }
  return { start: +s.toFixed(6), loop, loopFrom: +loopFrom.toFixed(6), loopTo: +loopTo.toFixed(6) };
}

/** Times in a source mapped into the piece through its segments [{ from, to, at }] (from/to in the source, at in the piece). */
function mapTimes(times, segs, seconds) {
  const out = [];
  for (const s of segs) for (const t of times) if (t >= s.from - 1e-9 && t < s.to - 1e-9) { const v = +(s.at + t - s.from).toFixed(6); if (v < seconds) out.push(v); }
  return [...new Set(out)].sort((a, b) => a - b);
}
/** The segments of the source a piece plays: from start, then (looping) loopFrom..loopTo again and again. */
function segmentsOf({ start, loop, loopFrom, loopTo }, seconds) {
  if (!loop) return [{ from: start, to: start + seconds, at: 0 }];
  const segs = [{ from: start, to: loopTo, at: 0 }];
  let at = loopTo - start;
  while (at < seconds && loopTo > loopFrom) { segs.push({ from: loopFrom, to: loopTo, at }); at += loopTo - loopFrom; }
  return segs;
}

/**
 * The music's beat grid in the piece's own time ({ bpm, offset, beatsPerBar, bars, beats, seconds, ... }), or null
 * when the music has no grid (none, or the user's own file, which plays unsnapped in 2.0).
 * o: { sound: { music }, frames, seed, bpm?, offset?, sections?, start? (library), library: [shipped items], engineRoot }
 */
function sceneGrid(o) {
  const N = o.frames * SPF;
  const seconds = N / SR;
  const m = parseMusic(o.sound && o.sound.music, o);
  const L = lib(o.engineRoot);
  if (m.source === 'score') {
    const p = preset(m.id, o);
    const bpm = Number(o.bpm || p.bpm);
    const offset = Number(o.offset == null ? (p.offset || 0) : o.offset);
    const bars = Math.max(1, Math.ceil((seconds - offset) / (60 / bpm * (p.beatsPerBar || 4))));
    const g = L.grid(p, { bpm, offset, seconds, sr: SR, seed: String(o.seed == null ? 'flpt' : o.seed), plan: L._arrange(o.sections || p.sections, bars) });
    return { ...g, source: m.ref };
  }
  if (m.source === 'library') {
    const g = libraryGrid(m.id, o);
    if (!g) return null;
    const fit = fitLibrary(g, { start: o.start, seconds, samples: g.samples });
    const segs = segmentsOf(fit, seconds);
    const beats = mapTimes(g.beats || [], segs, seconds);
    return { bpm: g.bpm, offset: beats.length ? beats[0] : 0, beatsPerBar: g.beatsPerBar || 4, bars: mapTimes(g.bars || [], segs, seconds), beats,
      seconds, sampleRate: SR, source: m.ref, start: fit.start, loop: fit.loop, steady: Boolean(g.steady) };
  }
  return null;
}

// ── the plan: score.json without the stem, and the work to do ───────────────────────────────────
const round = (x, d = 6) => +(+x).toFixed(d);

/**
 * o: { kind, frames, sound: { music, sfx }, seed, lead (s, where the narration starts in the piece), voice (its path
 *      relative to presentation/, recorded only), beats (timed), hits (scene hits(ctx)), start (library, s), bpm?,
 *      offset?, sections?, library: [shipped music items, addons.readShipped], files: { <token>: absolute path },
 *      engineRoot }
 * → { record, work: { music: { source, ...}, sfx: [{ kind, at, gain, seed, file }] }, grid }
 */
function plan(o) {
  const kind = kindOf(o.kind);
  const frames = Math.round(Number(o.frames));
  if (!(frames > 0)) throw new Error('A score needs the piece\'s length in frames.');
  const N = frames * SPF;
  const seconds = N / SR;
  const sound = { music: (o.sound && o.sound.music) || 'none', sfx: parseSfx(o.sound && o.sound.sfx) };
  const m = parseMusic(sound.music, o);
  const narrated = NARRATED.has(kind);
  const seed = String(o.seed == null ? 'flpt' : o.seed);
  const L = lib(o.engineRoot);
  const { fadeIn, fadeOut } = mixer.graphs.fades(N);
  const grid = sceneGrid({ ...o, frames, sound });

  let music = null;
  let work = null;
  let credit = null;
  const base = { file: 'score/music.wav', fadeIn: round(fadeIn, 3), fadeOut: round(fadeOut, 3), targetLufs: narrated ? BED.lufs : INTER.I,
    duck: narrated ? { depth: 8, threshold: DUCK.threshold, ratio: DUCK.ratio, attack: DUCK.attack / 1000, release: DUCK.release / 1000 } : null };
  if (m.source === 'score') {
    const p = preset(m.id, o);
    music = { source: 'score', ref: m.ref, preset: m.id, seed, start: 0, loop: false, ...base };
    work = { source: 'score', preset: p, seed, bpm: o.bpm, offset: o.offset, sections: o.sections };
  } else if (m.source === 'library') {
    const item = (o.library || []).find((x) => x && x.id === m.id && (x.kind == null || x.kind === 'music'));
    if (!item || !item.filePath) throw new Error(`The track "${m.id}" isn't here.`);
    const g = libraryGrid(m.id, o);
    const fit = fitLibrary(g, { start: o.start, seconds, samples: g && g.samples });
    music = { source: 'library', ref: m.ref, id: m.id, start: fit.start, loop: fit.loop, ...base };
    work = { source: 'library', file: item.filePath, ...fit, samples: g && g.samples };
    credit = { id: item.id, name: item.name || item.id, author: item.author || null, license: item.license || null, licenseUrl: item.licenseUrl || item.license_url || null,
      source: item.source || null, text: item.credit || null, edit: `edited (trimmed, ${fit.loop ? 'looped, ' : ''}mixed)` };
  } else if (m.source === 'file') {
    const file = o.files && o.files[m.id];
    if (!file) throw new Error('That sound file isn\'t here any more.');
    music = { source: 'file', ref: m.ref, start: Math.max(0, Number(o.start) || 0), loop: false, ...base };
    work = { source: 'file', file, start: music.start };
  }

  const level = SFX_LEVEL[sound.sfx];
  const placed = level == null ? [] : hitsFrom({ beats: o.beats, hits: o.hits, seconds, engineRoot: o.engineRoot });
  const seen = {};
  const sfx = placed.map((h) => {
    const n = (seen[h.kind] = (seen[h.kind] || 0) + 1);
    return { ...h, file: `score/sfx/${h.kind}-${n}.wav`, seed: `${seed}:sfx:${h.kind}:${n}` };
  });

  const record = {
    v: 1, kind, frames, sampleRate: SR, lead: round(Number(o.lead) || 0), voice: narrated ? (o.voice || null) : null,
    runtime: `flpt-score@${L.VERSION}`, sound,
    music,
    sfx: sfx.map(({ at, kind: k, file, gain, from, beat }) => ({ at, kind: k, file, gain, from, ...(beat != null ? { beat } : {}) })),
    grid: grid ? { bpm: grid.bpm, offset: grid.offset, beatsPerBar: grid.beatsPerBar } : null,
    stem: null,
    credit,
  };
  return { record, work: { music: work, sfx, level, narrated, N, seconds }, grid };
}

// ── writing it ──────────────────────────────────────────────────────────────────────────────────
/**
 * N samples of a source for the piece, from `start` (s): straight, or (loop) running loopFrom..loopTo again and again,
 * each join an equal-power crossfade of XFADE, so every loop's start lands exactly on its join (the grid stays true).
 * ch: the decoded source channels, beginning at the source's sample `chStart`.
 */
function excerpt(ch, chStart, N, { start = 0, loop = false, loopFrom = 0, loopTo = 0 }) {
  const out = ch.map(() => new Float32Array(N));
  const xf = Math.round(XFADE * SR);
  let src = Math.max(0, Math.round(start * SR) - chStart); // an index into ch
  let i = 0;
  const end = loop ? Math.round(loopTo * SR) - chStart : ch[0].length;
  const back = Math.round(loopFrom * SR) - chStart;
  while (i < N) {
    const stop = Math.min(end, src + (N - i), ch[0].length);
    if (stop <= src) break;
    for (let c = 0; c < ch.length; c++) out[c].set(ch[c].subarray(src, stop), i);
    i += stop - src;
    if (!loop || i >= N) break;
    // the join: what follows loopTo fades out while loopFrom fades in, so the loop's start lands right on the join
    const k = Math.min(xf, N - i);
    for (let j = 0; j < k; j++) {
      const u = j / xf;
      const a = Math.cos(u * Math.PI / 2);
      const b = Math.sin(u * Math.PI / 2);
      for (let c = 0; c < ch.length; c++) out[c][i + j] = (ch[c][end + j] || 0) * a + (ch[c][back + j] || 0) * b;
    }
    i += k;
    src = back + k;
  }
  return out;
}

async function writeMusic(scoreDir, work, { run, N, seconds, engineRoot, signal }) {
  const file = path.join(scoreDir, 'music.wav');
  if (work.source === 'score') {
    const r = lib(engineRoot).render({ preset: work.preset, seconds, seed: work.seed, bpm: work.bpm, offset: work.offset, sections: work.sections });
    mixer.wav.writeFloat(file, [r.left, r.right]);
    return { file, grid: r.grid };
  }
  const startSample = Math.round(work.start * SR);
  if (work.loop) {
    const from = Math.min(startSample, Math.round(work.loopFrom * SR));
    const d = await mixer.decode(run, work.file, { startSample: from, samples: Math.round(work.loopTo * SR) - from + Math.round(XFADE * SR), signal });
    mixer.wav.writeFloat(file, excerpt(d.channels, from, N, work));
    return { file, looped: true };
  }
  const d = await mixer.decode(run, work.file, { startSample, samples: N, signal });
  if (d.frames >= N) { mixer.wav.writeFloat(file, d.channels); return { file, looped: false }; }
  // The source ran out (the user's own short file, or a start past its end): loop the whole of it, crossfaded.
  const all = await mixer.decode(run, work.file, { startSample: 0, signal });
  const total = all.frames / SR;
  if (!(total > 4 * XFADE)) throw new Error('That sound file is too short to play.');
  const start = startSample < all.frames ? work.start : 0;
  mixer.wav.writeFloat(file, excerpt(all.channels, 0, N, { start, loop: true, loopFrom: 0, loopTo: total - XFADE }));
  return { file, looped: true };
}

/**
 * Render a planned score into <dir>/score/ (dir: the piece's folder) and mix its stem. Writes only inside score/.
 * opts: { run (mixer.runner), ffmpeg, env, voicePath (the narration, absolute), engineRoot, keep, twin, signal }
 * → { record (as written to score/score.json), problems: [string], mix (the mixer's numbers) }
 */
async function write(dir, planned, opts = {}) {
  const { record, work, grid } = planned;
  const scoreDir = path.join(dir, 'score');
  fs.mkdirSync(scoreDir, { recursive: true });
  const run = opts.run || mixer.runner({ ffmpeg: opts.ffmpeg || 'ffmpeg', env: opts.env, writable: [scoreDir] });
  for (const p of ['sfx', 'work', 'music.wav', 'stem.wav', 'grid.json']) fs.rmSync(path.join(scoreDir, p), { recursive: true, force: true });
  fs.mkdirSync(path.join(scoreDir, 'sfx'));

  let musicFile = null;
  if (work.music) {
    const m = await writeMusic(scoreDir, work.music, { run, N: work.N, seconds: work.seconds, engineRoot: opts.engineRoot, signal: opts.signal });
    musicFile = m.file;
  }
  if (grid) fs.writeFileSync(path.join(scoreDir, 'grid.json'), `${JSON.stringify(grid, null, 1)}\n`);

  const L = lib(opts.engineRoot);
  const sfx = work.sfx.map((h) => {
    const s = L.sfx(h.kind, { seed: h.seed, gain: h.gain });
    const file = path.join(dir, h.file);
    mixer.wav.writeFloat(file, [s.left, s.right]);
    return { file, t: h.at, anchor: s.anchor, gainDb: work.level, kind: h.kind };
  });

  const out = { ...record };
  const problems = [];
  let mix = null;
  if (musicFile || sfx.length) {
    const stem = path.join(scoreDir, 'stem.wav');
    const common = { run, music: musicFile, frames: record.frames, sfx, out: stem, work: path.join(scoreDir, 'work'), twin: opts.twin, signal: opts.signal };
    mix = work.narrated
      ? await mixer.bedStem({ ...common, voice: opts.voicePath || null, lead: record.lead, keep: opts.keep })
      : await mixer.interstitialStem(common);
    const ok = await mixer.stemOk(run, stem, { frames: record.frames, level: work.narrated ? 'bed' : 'interstitial', music: Boolean(musicFile), signal: opts.signal });
    problems.push(...ok.problems);
    out.stem = { file: 'score/stem.wav', samples: ok.samples, lufs: ok.lufs, tpDb: ok.tpDb, sha: mixer.sha256(stem), guard: mix.guard || null };
  }
  if (!opts.keep && !opts.twin) fs.rmSync(path.join(scoreDir, 'work'), { recursive: true, force: true });
  fs.writeFileSync(path.join(scoreDir, 'score.json'), `${JSON.stringify(out, null, 1)}\n`);
  return { record: out, problems, mix };
}

module.exports = {
  KINDS, DEFAULTS, DEFAULT_PRESET, NARRATED, SFX_LEVEL, XFADE,
  lib, runtimeDir, preset, presetIds, libraryGrid, nearestPreset,
  kindOf, parseMusic, parseSfx, soundFor, hitsFrom, fitLibrary, sceneGrid, plan, write, excerpt,
};
