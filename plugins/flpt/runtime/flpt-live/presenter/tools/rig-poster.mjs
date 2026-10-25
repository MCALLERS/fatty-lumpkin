#!/usr/bin/env node
// rig-poster.mjs · a rig as the renderer draws it, for a look check: the rig at rest (--out, a PNG) and, with --sheet, a
// contact sheet of its eleven mouths and three eye states. Local and free: the pinned headless shell draws, the
// toolchain's ffmpeg scales. (Setup's tile is presenter.js's rigPoster: SVG composed from the layers, nothing shipped.)
//   node rig-poster.mjs <rig dir> [--out rest.png] [--size 256] [--sheet sheet.png]
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toolchain, launch, TMP, parseArgs, isMain } from '../../tools/lib.mjs';
import { openRig, stillPng } from './render-clip.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const C = require(join(ROOT, 'compile.js'));
const { MOUTHS } = require(join(ROOT, 'rig.js'));
const CODE = { smile: 's', laugh: 'l' };

export async function poster(rigDir, { size = 256, sheet = null, out = null } = {}) {
  const tc = toolchain(process.env);
  const work = mkdtempSync(join(TMP, 'flpt-rig-poster-'));
  const browser = await launch(tc, { userDataDir: join(work, 'profile') });
  try {
    const p = await openRig(browser, rigDir);
    const rest = C.restTrack(p.rig);
    writeFileSync(join(work, 'rest.png'), await stillPng(p, rest));
    const thumb = out ? resolve(out) : null;
    if (thumb) {
      const r = spawnSync(tc.ffmpeg, ['-v', 'error', '-y', '-i', join(work, 'rest.png'), '-vf', `scale=${size}:${size}:flags=lanczos`, thumb]);
      if (r.status !== 0) throw new Error(String(r.stderr));
    }
    if (sheet) {
      const cells = [];
      for (const m of MOUTHS) cells.push({ ...rest, mouth: CODE[m] || m });
      for (const e of ['h', 'c']) cells.push({ ...rest, eyes: e });
      cells.forEach((t, i) => { t.__file = join(work, `cell-${String(i).padStart(2, '0')}.png`); });
      for (const t of cells) writeFileSync(t.__file, await stillPng(p, t));
      const inputs = cells.flatMap((t) => ['-i', t.__file]);
      const n = cells.length;
      const layout = Array.from({ length: n }, (_, i) => `${(i % 5) * 240}_${Math.floor(i / 5) * 240}`).join('|');
      const filter = `${cells.map((_, i) => `[${i}:v]scale=240:240[c${i}]`).join(';')};${cells.map((_, i) => `[c${i}]`).join('')}xstack=inputs=${n}:layout=${layout}:fill=white`;
      const s = spawnSync(tc.ffmpeg, ['-v', 'error', '-y', ...inputs, '-filter_complex', filter, '-frames:v', '1', resolve(sheet)]);
      if (s.status !== 0) throw new Error(String(s.stderr));
    }
    await p.page.close();
    return { thumb, sheet };
  } finally {
    await browser.close().catch(() => {});
    rmSync(work, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2));
  poster(resolve(a._[0]), { size: Number(a.size) || 256, sheet: a.sheet || null, out: a.out || null })
    .then((r) => console.log(JSON.stringify(r))).catch((e) => { console.error(e.message); process.exit(1); });
}
