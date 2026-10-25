// snapshot.mjs · "Snapshot this frame" (PLAN §2.5): the exact frame at t from the final renderer, as the 1920×1080 PNG
// a host puts at media/snapshot.png. The harness then shows it beside its paused preview and reports the PSNR.
//
// The piece is untrusted code, so it renders here as every other render of scene code does (§2.16 item 1): through
// W1-07's renderDirect() in its 'stills' mode, which runs the pinned chrome-headless-shell in a child re-executed under
// FLPT's sandbox (Seatbelt on the Mac), writing only its own work folder. Nothing of the piece runs in this process.
// Where there is no sandbox it refuses, unless the caller passes trusted: true, which is for FLPT's own demos only (the
// mock and the QA), never for a crew's code. Hosts (the Mac's main, flpt-server) call this and nothing else.
//
//   const r = await snapshot({ scene, t, out[, duration, styles, trusted, env] });
//     env: the toolchain's environment for renderDirect (the Mac app: services.toolEnv() plus FLPT_NODE); else this one's
//     → { ok: true, t, F, bytes, sandboxed, seconds } · { ok: false, problem }
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { FPS, TMP, sandbox } from '../tools/lib.mjs';
import { renderDirect } from '../tools/render-direct.mjs';

export async function snapshot({ scene, t, out, duration, styles, trusted = false, env, timeoutMs = 120000 } = {}) {
  if (!scene || !out) throw new Error('snapshot: scene and out are required');
  if (!trusted && !sandbox()) return { ok: false, problem: 'no sandbox on this machine: a piece renders only inside it' };
  const at = Math.max(0, Number(t) || 0);
  // stills mode empties and refills its out folder, so it gets one of its own; the PNG is copied to `out` after
  const stills = path.join(TMP, `flpt-stage-snap-${crypto.randomBytes(6).toString('hex')}`);
  try {
    const r = await renderDirect({ scene, mode: 'stills', at: [at], out: stills, workers: 1, styles, timeoutMs, ...(duration ? { duration } : {}), ...(env ? { env } : {}) });
    if (!r.ok || !r.files || !r.files[0] || !fs.existsSync(r.files[0])) return { ok: false, problem: String(r.problem || 'no still').slice(0, 300), sandboxed: !!r.sandboxed };
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(r.files[0], out);
    const F = Math.min(r.frames - 1, Math.floor(Math.min(at, r.duration) * FPS + 1e-6));
    return { ok: true, t: at, F, bytes: fs.statSync(out).size, sandboxed: !!r.sandboxed, seconds: r.seconds };
  } finally { fs.rmSync(stills, { recursive: true, force: true }); }
}
