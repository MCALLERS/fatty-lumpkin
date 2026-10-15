'use strict';
// Putting a cartoon or a cut scene together from its approved pieces, with ffmpeg alone (free, on this Mac).
//   cartoon()   the slide's title card, then each painted keyframe from its cue with a slow push, an ink-wipe between
//               beats, the hero beat playing its shot; film grain and a vignette over it all. Silent, 1920×1080,
//               30 fps, exactly the slide's length: the pipeline plays it in place of the slide, under the narration.
//   cutscene()  the shots joined (each cut to its planned length, a 40 ms de-click at every join), the scene's own
//               sound brought to -21 LUFS in two passes and cut back to the picture, then conformed: 1920×1080, 30 fps,
//               x264, AAC 48 kHz stereo, an exact number of frames. The pipeline plays it between two slides.
// `run(args, { signal })` runs ffmpeg and resolves { code, err }; `probe(file)` is ffprobe's JSON. Both come from the
// app (or the plugin), so the toolchain's own ffmpeg is the one used.
const fs = require('fs');
const path = require('path');

const FPS = 30;
const SR = 48000;
const W = 1920;
const H = 1080;
const T = { wipe: 0.7, card: 1.5, beat: 1.6 }; // an ink-wipe's length; the least time the card and each beat stay up
const LOUD = { I: -21, TP: -2, LRA: 11, quiet: -60 }; // the method's cut-scene level; below `quiet` it's left alone
const ENCODE = ['-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-g', String(FPS), '-keyint_min', String(FPS),
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
// The ink-wipe: the next picture sweeps in from the left behind a wavering, brush-like edge (xfade's P runs 1 → 0).
const INK = "custom:expr='if(lt(X/W+0.05*sin(Y/H*19)+0.025*sin(Y/H*61+1),1.1-P*1.2),B,A)'";
const TO_709 = `out_color_matrix=bt709:out_range=tv`;

const f3 = (x) => (Math.round(x * 1000) / 1000).toFixed(3);

/**
 * When each beat starts, in seconds: on its cue where it's known, spread evenly where it isn't, never before the title
 * card has had its moment, and each beat up for at least a beat's minimum (crowded slides are evened out).
 * times: one per beat (seconds into the slide, or null). Returns [seconds].
 */
function beatStarts(times, duration, { card = true } = {}) {
  const n = times.length;
  if (!n) return [];
  const first = card ? T.card : 0;
  const s = times.map((t) => (Number.isFinite(t) ? t : null));
  // Unknown times: between the known ones around them, or spread over what's left of the slide.
  const known = s.map((t, i) => (t == null ? -1 : i)).filter((i) => i >= 0);
  for (let i = 0; i < n; i++) {
    if (s[i] != null) continue;
    const prev = [...known].reverse().find((k) => k < i);
    const next = known.find((k) => k > i);
    const a = prev == null ? { i: -1, t: first } : { i: prev, t: s[prev] };
    const b = next == null ? { i: n, t: duration } : { i: next, t: s[next] };
    s[i] = a.t + ((b.t - a.t) * (i - a.i)) / (b.i - a.i);
  }
  s[0] = card ? Math.max(s[0], first) : 0;
  for (let i = 1; i < n; i++) s[i] = Math.max(s[i], s[i - 1] + T.beat);
  s[n - 1] = Math.min(s[n - 1], duration - T.beat);
  for (let i = n - 2; i >= 0; i--) s[i] = Math.min(s[i], s[i + 1] - T.beat);
  if (s[0] < first - 1e-6) { // not enough room for every beat: even them out
    const each = (duration - first) / n;
    return s.map((_, i) => first + i * each);
  }
  return s;
}

/** The cartoon's ffmpeg arguments (exported for the tests). */
function cartoonArgs({ out, card, beats, hero, duration }) {
  const frames = Math.round(duration * FPS);
  const starts = beatStarts(beats.map((b) => b.t), duration, { card: Boolean(card) });
  const segs = [...(card ? [{ file: card, start: 0, card: true }] : []), ...beats.map((b, k) => ({ file: hero && hero.beat === k ? hero.file : b.file, video: Boolean(hero && hero.beat === k), start: starts[k] }))];
  const fr = segs.map((g) => Math.round(g.start * FPS));
  const shortest = Math.min(...fr.slice(1).map((f, i) => f - fr[i]), frames - fr[fr.length - 1]);
  const wipe = Math.max(4, Math.min(Math.round(T.wipe * FPS), Math.floor(shortest * 0.45))); // frames
  const inputs = [];
  const graph = [];
  const extra = []; // the hero's last frame, after the segments' own inputs
  const push = (src, len, { zoom = 0.06, drift = '', label }) => `${src}scale=2880:1620:force_original_aspect_ratio=increase:${TO_709},crop=2880:1620,`
    + `zoompan=z='1+${zoom}*on/${len}':x='iw/2-(iw/zoom/2)${drift}':y='ih/2-(ih/zoom/2)':d=${len}:s=${W}x${H}:fps=${FPS},setsar=1,format=yuv420p${label}`;
  segs.forEach((g, j) => {
    const a = j === 0 ? 0 : fr[j] - wipe; // it starts sweeping in a wipe before its time, and is fully in on it
    const len = (j + 1 < segs.length ? fr[j + 1] : frames) - a;
    g.a = a;
    inputs.push('-i', g.file);
    if (g.video) {
      // The hero plays on its beat, eased up to 1.25× slower to fill it; a longer beat then holds its last frame
      // with the same slow push as the stills, so the picture never stops dead.
      const own = hero.seconds > 0 ? Math.floor(hero.seconds * FPS) : 0;
      const play = own ? Math.min(len, Math.round(own * 1.25)) : len;
      const slow = own ? Math.max(1, Math.min(1.25, play / own)) : 1;
      const rest = hero.last && own ? len - play : 0;
      graph.push(`[${j}:v]setpts=PTS-STARTPTS${slow > 1 ? `,setpts=${slow.toFixed(4)}*PTS` : ''},fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=increase:${TO_709},crop=${W}:${H},`
        + `setsar=1,format=yuv420p,tpad=stop_mode=clone:stop_duration=${f3((rest > 0 ? play : len) / FPS + 1)},trim=end_frame=${rest > 0 ? play : len},setpts=PTS-STARTPTS${rest > 0 ? `[h${j}]` : `[s${j}]`}`);
      if (rest > 0) {
        extra.push('-i', hero.last);
        graph.push(push(`[${segs.length + extra.length / 2 - 1}:v]`, rest, { zoom: 0.04, label: `[k${j}]` }));
        graph.push(`[h${j}][k${j}]concat=n=2:v=1:a=0,settb=1/${FPS},setpts=PTS-STARTPTS[s${j}]`); // xfade wants one time base
      }
    } else {
      graph.push(push(`[${j}:v]`, len, { zoom: g.card ? 0.03 : 0.06, drift: g.card ? '' : `${j % 2 ? '+' : '-'}iw*0.012*on/${len}`, label: `[s${j}]` })); // the card barely moves
    }
  });
  inputs.push(...extra);
  let last = 's0';
  for (let j = 1; j < segs.length; j++) {
    graph.push(`[${last}][s${j}]xfade=transition=${INK}:duration=${f3(wipe / FPS)}:offset=${f3(segs[j].a / FPS)}[x${j}]`);
    last = `x${j}`;
  }
  graph.push(`[${last}]noise=c0s=6:c0f=t+u,vignette=a=0.55,format=yuv420p,trim=end_frame=${frames},setpts=PTS-STARTPTS[v]`);
  return {
    args: ['-y', '-v', 'error', ...inputs, '-filter_complex', graph.join(';'), '-map', '[v]', '-an', '-r', String(FPS), '-frames:v', String(frames),
      '-preset', 'medium', ...ENCODE, '-movflags', '+faststart', out],
    starts: segs.map((g) => Math.round((g.a / FPS) * 1000) / 1000), frames, wipe,
  };
}

/**
 * A cartoon clip. beats: [{ file, t }] (t: its cue's time in the slide, or null); hero: { beat, file, seconds, last }
 * or null (seconds: the shot's length; last: a picture of its last frame, held with a push when the beat runs on);
 * card: the slide's title-card picture (or null); duration: the slide's time on screen. Writes `out` through a
 * temporary file, so a half-made clip never stands in for a good one. Returns { frames, starts }.
 */
async function cartoon({ out, card = null, beats, hero = null, duration, run, signal }) {
  if (!beats.length) throw new Error('A cartoon needs its keyframes.');
  if (!(duration >= 1)) throw new Error('The slide is too short for a cartoon.');
  for (const f of [card, ...beats.map((b) => b.file), hero && hero.file, hero && hero.last].filter(Boolean)) if (!fs.existsSync(f)) throw new Error(`${path.basename(f)} isn't there.`);
  const tmp = `${out}.${process.pid}.tmp.mp4`;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const a = cartoonArgs({ out: tmp, card, beats, hero, duration });
  try {
    const r = await run(a.args, { signal });
    if (r.code !== 0 || !fs.existsSync(tmp)) throw new Error(`ffmpeg couldn't put the cartoon together${r.err ? `: ${String(r.err).trim().split('\n').slice(-2).join(' ')}` : '.'}`);
    fs.renameSync(tmp, out);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  return { frames: a.frames, starts: a.starts };
}

const streamsOf = (info) => (info && Array.isArray(info.streams) ? info.streams : []);
const durationOf = (info) => {
  const v = streamsOf(info).find((x) => x.codec_type === 'video');
  return Number((info && info.format && info.format.duration) || (v && v.duration)) || 0;
};

/** The cut scene's graph: its shots cut to length and joined; `sound` adds the level (loudnorm's second pass). */
function cutsceneGraph(shots, { loud = null } = {}) {
  const graph = [];
  const extra = [];
  let n = shots.length;
  shots.forEach((s, i) => {
    const samples = s.frames * (SR / FPS);
    graph.push(`[${i}:v]setpts=PTS-STARTPTS,fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=increase:${TO_709},crop=${W}:${H},setsar=1,format=yuv420p,`
      + `tpad=stop_mode=clone:stop_duration=1,trim=end_frame=${s.frames},setpts=PTS-STARTPTS[v${i}]`);
    const src = s.audio ? `[${i}:a]` : `[${n}:a]`;
    if (!s.audio) { extra.push('-f', 'lavfi', '-i', `anullsrc=r=${SR}:cl=stereo`); n += 1; }
    const end = s.frames / FPS;
    graph.push(`${src}aresample=${SR},aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS,apad,atrim=end_sample=${samples},`
      + `afade=t=in:d=0.04,afade=t=out:st=${f3(Math.max(0, end - 0.04))}:d=0.04[a${i}]`);
  });
  graph.push(`${shots.map((s, i) => `[v${i}][a${i}]`).join('')}concat=n=${shots.length}:v=1:a=1[v][ac]`);
  const total = shots.reduce((t, s) => t + s.frames, 0) * (SR / FPS);
  if (loud) {
    graph.push(`[ac]loudnorm=I=${LOUD.I}:TP=${LOUD.TP}:LRA=${LOUD.LRA}:measured_I=${loud.input_i}:measured_TP=${loud.input_tp}:measured_LRA=${loud.input_lra}`
      + `:measured_thresh=${loud.input_thresh}:offset=${loud.target_offset}:linear=true,aresample=${SR},atrim=end_sample=${total},apad=whole_len=${total}[a]`);
  } else {
    graph.push(`[ac]atrim=end_sample=${total},apad=whole_len=${total}[a]`);
  }
  return { graph: graph.join(';'), extra };
}

/** loudnorm's first-pass numbers from ffmpeg's output, or null. */
function loudnormJson(text) {
  const s = String(text || '');
  const i = s.lastIndexOf('{');
  const j = s.lastIndexOf('}');
  if (i < 0 || j < i) return null;
  try {
    const m = JSON.parse(s.slice(i, j + 1));
    return ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'].every((k) => m[k] != null && m[k] !== '') ? m : null;
  } catch { return null; }
}

/**
 * A cut scene clip from its approved shots: [{ file, seconds }]. Returns { frames, seconds, lufs } (lufs: the
 * scene's sound before levelling, or null when it's silent).
 */
async function cutscene({ out, shots, run, probe, signal }) {
  if (!shots.length) throw new Error('A cut scene needs its shots.');
  const ready = [];
  for (const s of shots) {
    if (!s.file || !fs.existsSync(s.file)) throw new Error(`${s.file ? path.basename(s.file) : 'A shot'} isn't there.`);
    let info = null;
    try { info = await probe(s.file); } catch { info = null; }
    const v = streamsOf(info).find((x) => x.codec_type === 'video');
    if (!v) throw new Error(`${path.basename(s.file)} can't be read as a video.`);
    const have = durationOf(info);
    const want = Number(s.seconds) || have;
    const frames = Math.max(FPS, Math.round(Math.min(want, have || want) * FPS));
    ready.push({ file: s.file, frames, audio: streamsOf(info).some((x) => x.codec_type === 'audio') });
  }
  const inputs = ready.flatMap((s) => ['-i', s.file]);
  const frames = ready.reduce((t, s) => t + s.frames, 0);
  // Pass 1: how loud the joined sound is.
  const g1 = cutsceneGraph(ready);
  const m = await run(['-hide_banner', '-nostdin', '-nostats', ...inputs, ...g1.extra, '-filter_complex', `${g1.graph};[v]nullsink;[a]loudnorm=I=${LOUD.I}:TP=${LOUD.TP}:LRA=${LOUD.LRA}:print_format=json[m]`,
    '-map', '[m]', '-f', 'null', '-'], { signal });
  const meas = m.code === 0 ? loudnormJson(m.err) : null;
  const level = meas && Number(meas.input_i) > LOUD.quiet ? meas : null; // a silent scene stays silent, not hiss at -21
  // Pass 2: the levelled sound, cut back to the picture, and the conform.
  const g2 = cutsceneGraph(ready, { loud: level });
  const tmp = `${out}.${process.pid}.tmp.mp4`;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  try {
    const r = await run(['-y', '-v', 'error', ...inputs, ...g2.extra, '-filter_complex', g2.graph, '-map', '[v]', '-map', '[a]', '-r', String(FPS), '-frames:v', String(frames),
      '-preset', 'slow', ...ENCODE, '-c:a', 'aac', '-b:a', '192k', '-ar', String(SR), '-ac', '2', '-movflags', '+faststart', tmp], { signal });
    if (r.code !== 0 || !fs.existsSync(tmp)) throw new Error(`ffmpeg couldn't put the cut scene together${r.err ? `: ${String(r.err).trim().split('\n').slice(-2).join(' ')}` : '.'}`);
    fs.renameSync(tmp, out);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  return { frames, seconds: frames / FPS, lufs: level ? Number(level.input_i) : null };
}

module.exports = { cartoon, cutscene, cartoonArgs, beatStarts, cutsceneGraph, loudnormJson, FPS, LOUD, T };
