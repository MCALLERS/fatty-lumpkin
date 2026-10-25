#!/usr/bin/env node
// loop.mjs · a poster and a short loop from a scene, for Gallery tiles, pickers and covers (PLAN §2.10, W1-07).
//
//   node loop.mjs <render.mp4 | scene-dir> --out <dir> [--start s] [--seconds 7] [--poster s] [--audio <wav>]
//        [--budget 1.2] [--renderer hf|direct]
//
// Writes <dir>/poster.jpg (960×540), poster-tall.jpg (544×680, 4:5), loop.mp4 (960×540) and loop-tall.mp4
// (544×680, a centre 4:5 crop; both sides even for 4:2:0), each loop 6–8 s, H.264, +faststart, at most --budget MB (1.2 by default: CRF 26 first,
// then a two-pass at the bitrate that fits). --audio muxes a track (AAC 128k), cut to the loop. A scene folder is
// rendered first (render-scene.mjs, sandboxed); the start then defaults to the scene's first keyframe.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TMP, toolchain, probe, parseArgs, isMain } from './lib.mjs';
import { renderScene } from './render-scene.mjs';
import { renderDirect } from './render-direct.mjs';

const SIZES = { wide: { w: 960, h: 540, vf: 'scale=960:540:flags=lanczos' }, tall: { w: 544, h: 680, vf: 'crop=864:1080:528:0,scale=544:680:flags=lanczos' } };

function ff(tc, args) {
  const r = spawnSync(tc.ffmpeg, ['-v', 'error', '-y', ...args], { encoding: 'utf8', maxBuffer: 16 << 20 });
  if (r.status !== 0) throw new Error(String(r.stderr).slice(0, 400));
}

function encodeLoop(tc, src, out, { start, seconds, vf, audio, budget, work }) {
  const base = ['-ss', start.toFixed(3), '-t', seconds.toFixed(3), '-i', src];
  const aIn = audio ? ['-ss', start.toFixed(3), '-t', seconds.toFixed(3), '-i', audio] : [];
  const aOut = audio ? ['-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '128k', '-shortest'] : ['-an'];
  const v = ['-vf', `${vf},format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-r', '30', '-movflags', '+faststart'];
  ff(tc, [...base, ...aIn, ...v, '-crf', '26', ...aOut, out]);
  let passes = 1;
  if (statSync(out).size > budget) {
    const kbps = Math.max(150, Math.floor((budget * 8 * 0.92) / seconds / 1000 - (audio ? 128 : 0)));
    const log = join(work, `pass-${Math.random().toString(36).slice(2, 8)}`);
    ff(tc, [...base, ...v, '-b:v', `${kbps}k`, '-pass', '1', '-passlogfile', log, '-an', '-f', 'mp4', '/dev/null']);
    ff(tc, [...base, ...aIn, ...v, '-b:v', `${kbps}k`, '-pass', '2', '-passlogfile', log, ...aOut, out]);
    passes = 2;
  }
  return { file: out, bytes: statSync(out).size, passes };
}

export async function makeLoop(opts) {
  const o = { seconds: 7, budget: 1.2, renderer: 'hf', ...opts };
  const tc = toolchain(o.env || process.env);
  const out = resolve(o.out);
  mkdirSync(out, { recursive: true });
  const work = join(TMP, `flpt-loop-${process.pid}-${Date.now()}`);
  mkdirSync(work, { recursive: true });
  const res = { ok: false, out, files: {} };
  try {
    let src = resolve(o.input), start = o.start != null ? Number(o.start) : null;
    if (statSync(src).isDirectory()) {
      const meta = await renderDirect({ scene: src, mode: 'meta' });
      const r = await renderScene({ scene: src, out: join(work, 'scene.mp4'), renderer: o.renderer });
      if (!r.ok) { res.problem = `render: ${JSON.stringify(r.issues || r.steps.slice(-1))}`; return res; }
      src = join(work, 'scene.mp4');
      if (start == null && meta.ok && meta.meta && meta.meta.keyframes.length) start = Math.max(0, meta.meta.keyframes[0] - 0.5);
    }
    const p = probe(tc, src);
    const seconds = Math.max(1, Math.min(o.seconds, 8, p.seconds));
    if (start == null) start = Math.max(0, (p.seconds - seconds) / 2);
    start = Math.max(0, Math.min(start, p.seconds - seconds));
    const posterT = o.poster != null ? Number(o.poster) : start + seconds / 2;
    const budget = o.budget * 1e6;
    for (const [k, s] of Object.entries(SIZES)) {
      const name = k === 'wide' ? '' : '-tall';
      ff(tc, ['-ss', posterT.toFixed(3), '-i', src, '-frames:v', '1', '-vf', s.vf, '-q:v', '3', join(out, `poster${name}.jpg`)]);
      const l = encodeLoop(tc, src, join(out, `loop${name}.mp4`), { start, seconds, vf: s.vf, audio: o.audio ? resolve(o.audio) : null, budget, work });
      const q = probe(tc, l.file);
      res.files[`loop${name}.mp4`] = { bytes: l.bytes, passes: l.passes, width: q.width, height: q.height, seconds: +q.seconds.toFixed(3), frames: q.frames, audio: !!q.audio };
      res.files[`poster${name}.jpg`] = { bytes: statSync(join(out, `poster${name}.jpg`)).size };
    }
    res.start = +start.toFixed(3); res.seconds = seconds; res.poster = +posterT.toFixed(3);
    const loops = Object.entries(res.files).filter(([k]) => k.endsWith('.mp4')).map(([, v]) => v);
    res.ok = loops.every((v) => v.bytes <= budget && v.seconds >= Math.min(6, seconds) - 0.05) && existsSync(join(out, 'poster.jpg'));
    if (!res.ok) res.problem = 'a loop is over budget or too short';
    return res;
  } catch (e) {
    res.problem = String(e.message || e).slice(0, 400);
    return res;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2));
  if (!a._[0] || !a.out) { console.error('usage: loop.mjs <render.mp4 | scene-dir> --out <dir> [--start s] [--seconds 7] [--poster s] [--audio wav] [--budget 1.2]'); process.exit(64); }
  const r = await makeLoop({ input: a._[0], out: a.out, start: a.start, seconds: a.seconds ? Number(a.seconds) : 7, poster: a.poster, audio: a.audio, budget: a.budget ? Number(a.budget) : 1.2, renderer: a.renderer || 'hf' });
  // exit once the result is written: a piped stdout is asynchronous on macOS
  process.stdout.write(`${JSON.stringify(r, null, 2)}\n`, () => process.exit(r.ok ? 0 : 1));
}
