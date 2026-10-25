#!/usr/bin/env node
// make-clips.mjs · the cartoon presenter's own pass (PLAN §2.12 step 2): for each bubble slide of a run, its padded
// narration and spoken text → mouth cues (FLPT's Rhubarb, --threads 1, the text as dialog) → compileTrack → the drawer in
// the pinned headless shell → a 720² 30 fps clip with that WAV muxed in, cached by
//   cartoonKey = sha("cartoon", pad_key, rigSha, producer, compiler, renderer)
// in <video>/cache/cartoon/:
//   clips/<key>.mp4 (+ <key>.json, what made it)    cues/<pad_key>.<producer>.json    env/<pad_key>.json
//   track/<key>.json    still.png (the rig at rest: the bubble before its clip exists)    index.json {pad_key → clip}
// The pipeline's cached-only re-composite (FLPT_CARTOON_V1) then puts index.json's clips in the bubble.
//
// Keyless and offline: the app (presenter.js) runs this inside FLPT's sandbox, writing only cache/cartoon/ and the temp
// folder. Cues depend on the narration alone, so changing the rig only re-renders. Slides run `workers` at a time
// (Rhubarb is single-threaded on purpose: more threads aren't deterministic).
//
//   node make-clips.mjs --plan plan.json
//     plan: { cache, rig, workers?, still?, rhubarb? (false: never Rhubarb), slides: [{ n, pad_key, wav, frames, spoken, words? }] }
//   → one JSON line on stdout: { ok, clips: [{ n, pad_key, key, cached, producer, ms }], problems, still, rig, rigSha, ms }
//   progress lines on stderr.
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toolchain, launch, TMP, parseArgs, isMain } from '../../tools/lib.mjs';
import * as rhubarb from './rhubarb.mjs';
import { openRig, renderClip, stillPng, writeAtomic } from './render-clip.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const require = createRequire(import.meta.url);
const C = require(join(ROOT, 'compile.js'));
const K = require(join(ROOT, 'keys.js'));
const { checkRig } = require(join(ROOT, 'rig.js'));
const V = require(join(ROOT, 'visemes.js'));

const PAD = /^[0-9a-f]{8,64}$/;
const say = (s) => process.stderr.write(`${s}\n`);
const json = (p, fallback) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; } };
const short = (s) => K.sha(s).slice(0, 10);

/** Cues for one slide, in the order PLAN §2.12 and K7 give: Rhubarb with the dialog, without it, then text + timings. */
async function cuesFor(s, cdir, rhubarbVer, signal, useRhubarb = rhubarb.available()) {
  const pcmOf = () => C.readWav(readFileSync(s.wav));
  const tries = [];
  if (useRhubarb) {
    if (s.spoken && s.spoken.trim()) tries.push({ producer: rhubarbVer, run: (out) => rhubarb.cues({ wav: s.wav, out, dialog: s.spoken, signal }) });
    tries.push({ producer: `${rhubarbVer} no-dialog`, run: (out) => rhubarb.cues({ wav: s.wav, out, signal }) });
  }
  const words = s.words && existsSync(s.words) ? json(s.words, null) : null;
  if (Array.isArray(words) && words.length) {
    tries.push({ producer: `${V.PRODUCER} words`, run: async (out) => { const { pcm, rate } = pcmOf(); const j = V.textVisemes(s.spoken || '', pcm, rate, s.frames, words); writeFileSync(out, JSON.stringify(j)); return j; } });
  }
  const why = [];
  for (const t of tries) {
    // the cues depend on the narration (pad_key), what's said and the producer: never on the rig
    const out = join(cdir, 'cues', `${s.pad_key}.${short(`${t.producer}|${s.spoken || ''}`)}.json`);
    const have = json(out, null);
    if (have && Array.isArray(have.mouthCues)) return { cues: have.mouthCues, producer: t.producer, cached: true };
    try {
      const j = await t.run(`${out}.tmp`);
      renameSync(`${out}.tmp`, out);
      return { cues: j.mouthCues, producer: t.producer, cached: false };
    } catch (e) {
      rmSync(`${out}.tmp`, { force: true });
      why.push(e.message);
    }
  }
  throw new Error(why.length ? why.join('; ') : 'no mouth cues: FLPT\'s Rhubarb isn\'t here and there are no word timings');
}

export async function makeClips(plan, { signal } = {}) {
  const t0 = Date.now();
  const cache = resolve(plan.cache);
  const cdir = join(cache, 'cartoon');
  for (const d of ['cues', 'env', 'track', 'clips']) mkdirSync(join(cdir, d), { recursive: true });
  const rigDir = resolve(plan.rig);
  const rig = JSON.parse(readFileSync(join(rigDir, 'rig.json'), 'utf8'));
  const bad = checkRig(rig);
  if (bad.length) return { ok: false, clips: [], problems: [`The presenter's rig isn't right: ${bad.join('; ')}`], ms: 0 };
  const rigSha = K.rigSha(rigDir);
  const rhubarbVer = rhubarb.available() ? K.rhubarbVersion() : 'none';
  const tc = toolchain(process.env);
  if (!tc.puppeteer || !tc.browser || !tc.ffmpeg) {
    return { ok: false, clips: [], problems: ['The cartoon is drawn with HyperFrames\' browser: install HyperFrames in Setup → Tools.'], ms: 0 };
  }
  const slides = (plan.slides || []).filter((s) => s && PAD.test(String(s.pad_key)) && Number.isInteger(s.frames) && s.frames > 0 && typeof s.wav === 'string');
  const problems = [];
  const done = [];
  const idxFile = join(cdir, 'index.json');
  const index = json(idxFile, {}) || {};
  // one browser for every slide; launched again if it dies under a busy machine (a slide is then tried once more)
  const profile = join(TMP, `flpt-presenter-${process.pid}`);
  let browser = await launch(tc, { userDataDir: profile });
  let relaunching = null;
  const connected = () => (typeof browser.isConnected === 'function' ? browser.isConnected() : browser.connected !== false);
  const browserNow = async () => {
    if (connected()) return browser;
    relaunching = relaunching || (async () => { await browser.close().catch(() => {}); browser = await launch(tc, { userDataDir: profile }); relaunching = null; return browser; })();
    return relaunching;
  };
  try {
    // the still: the rig at rest, for a bubble whose clip isn't made yet
    let still = null;
    if (plan.still !== false) {
      const stillFile = join(cdir, 'still.png');
      const meta = json(join(cdir, 'still.json'), {});
      try {
        if (meta.rigSha !== rigSha || !existsSync(stillFile)) {
          const p = await openRig(await browserNow(), rigDir);
          writeAtomic(stillFile, await stillPng(p, C.restTrack(rig)));
          writeAtomic(join(cdir, 'still.json'), JSON.stringify({ rig: `${rig.id}@${rig.version}`, rigSha }));
          await p.page.close();
        }
        still = stillFile;
      } catch (e) {
        problems.push(`the still: ${String(e.message || e).slice(0, 200)}`);
      }
    }
    let next = 0;
    const worker = async () => {
      let rp = null;
      try {
        for (;;) {
          if (signal && signal.aborted) return;
          const s = slides[next++];
          if (!s) return;
          const ts = Date.now();
          try {
            if (!existsSync(s.wav)) throw new Error('its narration isn\'t in the cache');
            const c = await cuesFor(s, cdir, rhubarbVer, signal, plan.rhubarb !== false && rhubarb.available());
            const key = K.cartoonKey({ padKey: s.pad_key, rigSha, producer: c.producer, compiler: C.COMPILER_VERSION });
            const clip = join(cdir, 'clips', `${key}.mp4`);
            if (existsSync(clip) && existsSync(join(cdir, 'clips', `${key}.json`))) {
              done.push({ n: s.n, pad_key: s.pad_key, key, cached: true, producer: c.producer, ms: Date.now() - ts });
              say(`slide ${s.n}: cartoon clip already made`);
              continue;
            }
            const { pcm, rate } = C.readWav(readFileSync(s.wav));
            const env = C.envelopeFromPcm(pcm, rate, 30, s.frames);
            writeAtomic(join(cdir, 'env', `${s.pad_key}.json`), JSON.stringify(env));
            const seed = C.seedFor(rig, s.pad_key);
            const track = C.compileTrack(rig, c.cues, env, { fps: 30, frames: s.frames, seed });
            const trackFile = join(cdir, 'track', `${key}.json`);
            writeAtomic(trackFile, JSON.stringify(track));
            let r;
            for (let attempt = 0; ; attempt++) {
              try {
                if (!rp || rp.page.isClosed()) rp = await openRig(await browserNow(), rigDir);
                r = await renderClip(rp, { track, wav: s.wav, out: clip, ffmpeg: tc.ffmpeg });
                break;
              } catch (e) {
                // the browser died (a crash, a busy machine): once more on a new one, then give up on this slide
                if (attempt > 0 || (connected() && !/closed|Target|Protocol/i.test(String(e.message)))) throw e;
                say(`slide ${s.n}: the browser went away, trying again`);
                rp = null;
              }
            }
            writeAtomic(join(cdir, 'clips', `${key}.json`), `${JSON.stringify({ key, pad_key: s.pad_key, slide: s.n, rig: `${rig.id}@${rig.version}`, rigSha,
              producer: c.producer, compiler: C.COMPILER_VERSION, renderer: K.RENDERER_VERSION, seed, frames: s.frames,
              trackSha: K.fileSha(trackFile).slice(0, 16), framesSha: r.framesSha.slice(0, 16), mp4Sha: r.mp4Sha.slice(0, 16) }, null, 1)}\n`);
            done.push({ n: s.n, pad_key: s.pad_key, key, cached: false, producer: c.producer, ms: Date.now() - ts, renderFps: r.fps });
            say(`slide ${s.n}: cartoon clip made (${s.frames} frames, ${((Date.now() - ts) / 1000).toFixed(1)} s)`);
          } catch (e) {
            if (signal && signal.aborted) return;
            problems.push(`slide ${s.n}: ${String(e.message || e).slice(0, 300)}`);
            delete index[s.pad_key]; // never another rig's (or an older) clip in its place
            say(`! slide ${s.n}: ${String(e.message || e).slice(0, 200)}`);
          }
        }
      } finally {
        if (rp && !rp.page.isClosed()) await rp.page.close().catch(() => {});
      }
    };
    const n = Math.max(1, Math.min(Number(plan.workers) || 3, 6, slides.length || 1));
    await Promise.all(Array.from({ length: n }, worker));
    for (const c of done) index[c.pad_key] = `clips/${c.key}.mp4`;
    writeAtomic(idxFile, `${JSON.stringify(Object.fromEntries(Object.entries(index).sort(([a], [b]) => (a < b ? -1 : 1))), null, 1)}\n`);
    done.sort((a, b) => a.n - b.n);
    const stopped = Boolean(signal && signal.aborted);
    return { ok: !stopped && problems.length === 0 && done.length === slides.length, stopped, clips: done, problems, still,
      rig: `${rig.id}@${rig.version}`, rigSha, producer: rhubarbVer, ms: Date.now() - t0 };
  } finally {
    await browser.close().catch(() => {});
    rmSync(profile, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2));
  const ctrl = new AbortController();
  process.on('SIGTERM', () => ctrl.abort());
  let plan;
  try { plan = JSON.parse(readFileSync(a.plan, 'utf8')); } catch (e) { process.stdout.write(`${JSON.stringify({ ok: false, problems: [`no plan: ${e.message}`] })}\n`); process.exit(2); }
  makeClips(plan, { signal: ctrl.signal })
    .then((r) => { process.stdout.write(`${JSON.stringify(r)}\n`); process.exitCode = r.ok ? 0 : 1; })
    .catch((e) => { process.stdout.write(`${JSON.stringify({ ok: false, clips: [], problems: [String(e && e.message ? e.message : e).slice(0, 400)] })}\n`); process.exitCode = 1; });
}
