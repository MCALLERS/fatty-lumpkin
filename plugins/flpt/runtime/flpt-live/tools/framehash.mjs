#!/usr/bin/env node
// framehash.mjs · is a render (or a scene) a pure function of t? (PLAN §2.3's determinism test; spikes K1 and K6)
//
//   node framehash.mjs <file.mp4 | png-dir>  [--stamps] [--json]          one MD5 per decoded frame + a digest
//   node framehash.mjs <a> --against <b>                                  identical, or which frames differ (+ PSNR)
//   node framehash.mjs --scene <scene-dir> [--n 24] [--seed 1234567]      the in-page check: the same frames drawn in
//        two fresh pages, in order and shuffled, hashed from every byte of the canvas (sandboxed, the pinned shell)
//
// mp4: MD5 of each decoded frame in its own pixel format (ffmpeg framemd5); PNG folder: each frame as RGBA.
// --stamps decodes the frame stamp (a conformance render with data-flpt-stamp) and checks frame n shows F = n.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { toolchain, psnr, parseArgs, isMain } from './lib.mjs';
import { renderDirect } from './render-direct.mjs';

function inputArgs(p) {
  if (statSync(p).isDirectory()) {
    const pngs = readdirSync(p).filter((f) => /^frame_\d+\.png$/.test(f)).sort();
    if (!pngs.length) throw new Error(`no frame_NNNNNN.png in ${p}`);
    return { args: ['-framerate', '30', '-start_number', String(Number(pngs[0].match(/\d+/)[0])), '-i', join(p, 'frame_%06d.png')], pix: 'rgba' };
  }
  if (/\.png$/i.test(p)) return { args: ['-i', p], pix: 'rgba' };
  return { args: ['-i', p], pix: null };
}

export function framehash(p, tc = toolchain()) {
  p = resolve(p);
  const { args, pix } = inputArgs(p);
  const out = execFileSync(tc.ffmpeg, ['-v', 'error', ...args, '-map', '0:v', ...(pix ? ['-pix_fmt', pix] : []), '-f', 'framemd5', '-'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  const hashes = out.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(',').pop().trim());
  return { frames: hashes.length, hashes, digest: createHash('md5').update(hashes.join('\n')).digest('hex'), distinct: new Set(hashes).size };
}

export function compare(a, b) {
  const n = Math.max(a.hashes.length, b.hashes.length), diff = [];
  for (let i = 0; i < n; i++) if (a.hashes[i] !== b.hashes[i]) diff.push(i);
  return { identical: diff.length === 0 && a.frames === b.frames, framesA: a.frames, framesB: b.frames, differing: diff.length, firstDiffs: diff.slice(0, 10) };
}

/** Frame numbers from the stamp (top-left: white, black, then F's 12 bits, 24 px blocks, black = 1). */
export function stamps(p, tc = toolchain()) {
  p = resolve(p);
  const { args } = inputArgs(p);
  const S = 24, w = S * 14;
  const r = spawnSync(tc.ffmpeg, ['-v', 'error', ...args, '-map', '0:v', '-vf', `crop=${w}:${S}:0:0`, '-pix_fmt', 'gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(String(r.stderr));
  const buf = r.stdout, fsz = w * S, F = [];
  let markersOk = true;
  for (let off = 0; off + fsz <= buf.length; off += fsz) {
    const at = (i) => buf[off + (S >> 1) * w + i * S + (S >> 1)];
    if (!(at(0) > 200 && at(1) < 55)) markersOk = false;
    let v = 0;
    for (let b = 0; b < 12; b++) v = (v << 1) | (at(b + 2) < 128 ? 1 : 0);
    F.push(v);
  }
  const firstBad = F.findIndex((v, i) => v !== i);
  return { frames: F.length, markersOk, exact: markersOk && firstBad === -1, firstBad };
}

/** The in-page check: frames spread over the scene, drawn in order and shuffled in two fresh pages. */
export async function sceneHash({ scene, n = 24, seed = 1234567, duration, styles, frames } = {}) {
  const meta = await renderDirect({ scene, mode: 'meta', duration, styles });
  if (!meta.ok) return { ok: false, problem: meta.problem };
  const N = meta.frames;
  const list = frames || Array.from({ length: Math.min(n, N) }, (_, i) => Math.min(N - 1, Math.round(((i + 0.37) / Math.min(n, N)) * N)));
  const r = await renderDirect({ scene, mode: 'hash', frames: list, seed, duration, styles });
  return { ok: !!r.ok && r.differ && r.differ.length === 0, frames: list.length, identical: r.identical, distinct: r.distinct, differ: r.differ, sandboxed: r.sandboxed, problem: r.problem, seconds: r.seconds };
}

if (isMain(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2), ['stamps', 'json']);
  if (a.scene) {
    const r = await sceneHash({ scene: a.scene, n: Number(a.n || 24), seed: Number(a.seed || 1234567) });
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  }
  const p = a._[0];
  if (!p || !existsSync(p)) { console.error('usage: framehash.mjs <file.mp4|png-dir> [--stamps] [--against <b>] | --scene <dir>'); process.exit(64); }
  const tc = toolchain();
  const h = framehash(p, tc);
  const out = { input: resolve(p), frames: h.frames, distinct: h.distinct, digest: h.digest };
  if (a.stamps) out.stamps = stamps(p, tc);
  if (a.against) { const c = compare(h, framehash(a.against, tc)); out.against = { ...c, psnr_db: c.identical ? Infinity : psnr(tc, p, a.against) }; }
  if (a.json) out.hashes = h.hashes;
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.against && !out.against.identical ? 1 : 0);
}
