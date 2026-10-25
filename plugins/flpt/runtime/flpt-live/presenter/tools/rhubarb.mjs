// rhubarb.mjs · mouth cues from a WAV with FLPT's own Rhubarb Lip Sync 1.14.0 build (WebAssembly, in its own Node
// process: the 2 MB module and its 82 MB of PocketSphinx models are read only while a clip's cues are made, never by
// the app itself). Pinned the way K7 measured it deterministic:
//   --threads 1   more recognition threads give different cues from run to run (and from machine to machine)
//   the WAV by its bare name, run in its own folder, and metadata.soundFile reduced to that name, so the cue file
//   doesn't depend on where the episode lives
//   -d <dialog>   the spoken text, which lifts accuracy (93.5–97.5 % of frames agree without it)
// No network (the module has none), no key, nothing written but the cue file.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const RHUBARB_DIR = resolve(HERE, '..', 'rhubarb');
export const RHUBARB_JS = join(RHUBARB_DIR, 'rhubarb.js');

/** Whether FLPT's build and its models are where they ship. */
export function available(dir = RHUBARB_DIR) {
  return ['rhubarb.js', 'rhubarb.wasm', 'res/sphinx/en-us.lm.bin', 'res/sphinx/cmudict-en-us.dict', 'res/sphinx/acoustic-model/means']
    .every((f) => existsSync(join(dir, f)));
}

/**
 * Cues for one WAV. o: { wav, out, dialog (text or null), node (default this one), timeoutMs, signal, dir }.
 * Resolves Rhubarb's JSON ({ metadata, mouthCues }), also written to `out`; rejects with Rhubarb's last words.
 */
export function cues({ wav, out, dialog = null, node = process.execPath, timeoutMs = 10 * 60000, signal, dir = RHUBARB_DIR }) {
  const js = join(dir, 'rhubarb.js');
  const dlg = dialog ? `${out}.dialog.txt` : null;
  if (dlg) writeFileSync(dlg, String(dialog));
  const args = [js, '-q', '-f', 'json', '--extendedShapes', 'GHX', '--threads', '1', ...(dlg ? ['-d', dlg] : []), '-o', out, basename(wav)];
  return new Promise((ok, no) => {
    const child = spawn(node, args, { cwd: dirname(wav), env: { PATH: process.env.PATH || '', HOME: process.env.HOME || '', TMPDIR: process.env.TMPDIR || '', RHUBARB_EXE: js }, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (b) => { err = (err + b).slice(-2000); });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    const stop = () => child.kill('SIGKILL');
    if (signal) signal.addEventListener('abort', stop, { once: true });
    child.on('error', (e) => { clearTimeout(timer); no(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', stop);
      if (dlg) rmSync(dlg, { force: true });
      if (code !== 0) { no(new Error(`Rhubarb stopped (${code == null ? 'killed' : code}): ${err.trim().split('\n').slice(-2).join(' ').slice(0, 300)}`)); return; }
      try {
        const j = JSON.parse(readFileSync(out, 'utf8'));
        if (!j || !Array.isArray(j.mouthCues)) throw new Error('no mouthCues');
        j.metadata = { ...(j.metadata || {}), soundFile: basename(wav), dialog: Boolean(dlg) };
        writeFileSync(out, `${JSON.stringify(j, null, 1)}\n`);
        ok(j);
      } catch (e) { no(new Error(`Rhubarb's cues didn't read: ${e.message}`)); }
    });
  });
}
