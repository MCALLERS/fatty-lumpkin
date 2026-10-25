'use strict';
// flpt.sound: the sound picker's side in main (PLAN §2.6, draft-ux §6; W2-06). The page names a sound, never a path.
//   options()                      the choices: the four scores, the shipped CC BY tracks that have a beat grid (in
//                                  the plugin's Desk, the Mac app's own when it finds them, DV13), the effects' three
//                                  levels, each module's default
//   preview(spec, episode?)        a few seconds of a sound, built as its stem is (the Stage's score Worker,
//                                  engine/runtime/flpt-live/stage/score-worker.js, run here): spec { music, sfx, kind,
//                                  seconds, seed, hits, beats } → { wav (base64, 16-bit stereo), seconds, sampleRate,
//                                  meter, lufs, hits }. Without the piece's hits, a hit on each bar shows the effects.
//   pickFile() · stageFile(path)   the user's own sound file, from the native dialog or a drop, held here behind a token
//                                  → { token, name }
//   useFile(episode, token, mine)  only with the ⚑ tick (mine: true): the file copied into the episode, once per content
//                                  (presentation/assets/sound/<id>.<ext> and <id>.json) → { music: 'file:<id>', name }
//   files(episode)                 the episode's own sound files: [{ music, name }]
// Also exported for the score pass (W2-02): filesOf(dir) → { <id>: path } (score.plan's `files`), seedFor(key) (the one
// integer seed a piece's stem and its Stage preview share), meter(kind, sound) (the picker's 3-bar level).
// Nothing here costs anything or reaches the network; ffmpeg (decoding a track or a file) runs in the sandbox.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const score = require('../score');
const mixer = require('../mixer');
const addons = require('../addons');
const episode = require('../episode');
const references = require('../references');
const { createStaging } = require('../staging');

const SR = mixer.SR;
const PREVIEW_SECONDS = 8;
const PREVIEW_MAX = 12;
const AUDIO_EXT = ['mp3', 'm4a', 'wav', 'aif', 'aiff', 'aac', 'flac', 'ogg'];
const AUDIO = new RegExp(`\\.(${AUDIO_EXT.join('|')})$`, 'i');
const EXT = new RegExp(`^(${AUDIO_EXT.join('|')})$`);
const FILE_MAX = 200 * 1024 * 1024;
const FILE_ID = /^snd-[0-9a-f]{12}$/;
const SOUND_DIR = path.join('presentation', 'assets', 'sound');
const DEMO_KINDS = ['swish', 'pop', 'tick', 'chime']; // a preview without the piece's own hits: one on each bar, in turn

// The user's own files, picked or dropped: held until useFile takes them (one file, by token, 30 minutes), one holder
// per app (its services' dirs), or one for this process where a host has none.
const makeHeld = () => createStaging({ kinds: { audio: AUDIO }, refuse: 'A sound file only.', max: 1 });
const HELD = new WeakMap();
let heldHere = null;
function held(c) {
  const k = c.dirs;
  if (!k || typeof k !== 'object') return (heldHere = heldHere || makeHeld());
  if (!HELD.has(k)) HELD.set(k, makeHeld());
  return HELD.get(k);
}

// ── the Stage's score Worker, as a module (the same file the harness runs) ───────────────────────────────────────────
const workers = new Map();
function worker(engineRoot) {
  const dir = path.join(score.runtimeDir(engineRoot), '..', 'stage');
  if (!workers.has(dir)) workers.set(dir, require(path.join(dir, 'score-worker.js')));
  return workers.get(dir);
}

// ── where the shipped tracks are (Resources/addons beside Resources/engine; app/assets/addons in development) ────────
function shippedRoot(c) {
  const e = c.engineRoot;
  for (const d of [c.addonsRoot, e && path.join(e, '..', 'addons'), e && path.join(e, '..', 'app', 'assets', 'addons')]) {
    if (d && fs.existsSync(path.join(d, 'manifest.json'))) return d;
  }
  return null;
}
/**
 * The shipped CC BY tracks that have a measured beat grid (the only ones `library:` plays in 2.0): beside the engine,
 * else the ones a Live Motion piece plays from where the host found them (livemotion.shippedLibrary: the plugin's Desk
 * lists the Mac app's own, common.appTracks, F-01's follow-up to DV13), so the picker offers what the pieces play.
 */
function tracks(c) {
  const root = shippedRoot(c);
  let found = [];
  if (root) found = addons.readShipped(root);
  else { try { found = require('../livemotion').shippedLibrary(c.engineRoot); } catch { found = []; } }
  return (Array.isArray(found) ? found : []).filter((it) => it && it.kind === 'music' && it.filePath && score.libraryGrid(it.id, { engineRoot: c.engineRoot }));
}

// ── small pure pieces ───────────────────────────────────────────────────────────────────────────────────────────────
const NARRATED = new Set(['solo', 'duet', 'cosmos']);
const kindOf = (k) => { try { return score.kindOf(k == null ? 'solo' : k); } catch { return 'solo'; } };

/**
 * The level a sound plays at, as the picker's 3-bar meter shows it (its tooltip; users never set dB):
 * nothing ▯▯▯ · effects only ▮▯▯ · music under the voice ▮▮▯ BED (-26 LUFS) · music alone ▮▮▮ FULL (-21 LUFS).
 */
function meter(kind, sound) {
  const k = kindOf(kind);
  const s = sound || {};
  const music = s.music != null && String(s.music) !== 'none' && String(s.music) !== '';
  const sfx = s.sfx != null && String(s.sfx) !== 'off';
  const bars = music ? (NARRATED.has(k) ? 2 : 3) : (sfx ? 1 : 0);
  const label = bars ? (NARRATED.has(k) ? 'BED' : 'FULL') : '';
  return { bars, label, text: `${'▮'.repeat(bars)}${'▯'.repeat(3 - bars)}${label ? ` ${label}` : ''}` };
}

/** The one integer seed a piece's stem (score.plan) and its Stage preview (load.seed) share: FNV-1a of its key. */
function seedFor(key) {
  let h = 0x811c9dc5;
  for (const ch of String(key)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h & 0x7fffffff;
}

/** 16-bit PCM WAV bytes of two channels. */
function wav16(left, right, sr) {
  const n = left.length;
  const b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  const q = (v) => Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  for (let i = 0; i < n; i++) { b.writeInt16LE(q(left[i]), 44 + i * 4); b.writeInt16LE(q(right[i]), 46 + i * 4); }
  return b;
}

// ── the episode's own sound files ───────────────────────────────────────────────────────────────────────────────────
/** An episode folder FLPT may write in (inside the projects folder, a record this FLPT can read). */
function guard(c, dir) {
  if (!c.flow || typeof c.flow.inProjects !== 'function' || !c.flow.inProjects(dir)) throw new Error('That isn\'t an FLPT episode folder.');
  const why = episode.tooNew(episode.readRaw(path.resolve(dir)));
  if (why) throw new Error(why);
  return path.resolve(dir);
}
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
/** The episode's sound files: [{ id, name, file (absolute) }], each one whose sidecar and file are both there. */
function listFiles(dir) {
  const d = path.join(dir, SOUND_DIR);
  let names = [];
  try { names = fs.readdirSync(d).filter((f) => f.endsWith('.json')).sort(); } catch { return []; }
  const out = [];
  for (const f of names) {
    const j = readJson(path.join(d, f));
    if (!j || !FILE_ID.test(String(j.id)) || `${j.id}.json` !== f || !EXT.test(String(j.ext))) continue;
    const file = path.join(d, `${j.id}.${j.ext}`);
    if (fs.existsSync(file)) out.push({ id: j.id, name: String(j.name || j.id).slice(0, 200), file });
  }
  return out;
}
/** For score.plan's `files`: { <id>: absolute path } of an episode's sound files (`file:<id>` names one). */
function filesOf(dir) { return Object.fromEntries(listFiles(path.resolve(dir)).map((x) => [x.id, x.file])); }

function sha256File(file) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(1 << 20);
    for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) h.update(buf.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return h.digest('hex');
}

function useFile(c, raw, token, mine) {
  const dir = guard(c, raw);
  if (mine !== true) throw new Error('Only music that\'s yours to use.');
  const [file] = held(c).take(token);
  references.assertNotReference(file);
  const st = fs.statSync(file);
  if (!st.isFile() || st.size > FILE_MAX) throw new Error('That sound file is too big.');
  const sha = sha256File(file);
  const id = `snd-${sha.slice(0, 12)}`;
  const ext = path.extname(file).slice(1).toLowerCase();
  const d = path.join(dir, SOUND_DIR);
  fs.mkdirSync(d, { recursive: true });
  const dest = path.join(d, `${id}.${ext}`);
  if (!fs.existsSync(dest)) fs.copyFileSync(file, dest);
  const name = path.basename(file).slice(0, 200);
  const side = path.join(d, `${id}.json`);
  const had = readJson(side);
  if (!had || had.id !== id) fs.writeFileSync(side, `${JSON.stringify({ v: 1, id, name, ext, sha256: sha, mine: true, at: new Date().toISOString() }, null, 1)}\n`);
  return { music: `file:${id}`, name: had && had.name ? had.name : name };
}

// ── the preview ─────────────────────────────────────────────────────────────────────────────────────────────────────
const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
function cleanSpec(c, spec) {
  const s = spec && typeof spec === 'object' && !Array.isArray(spec) ? spec : {};
  const music = score.parseMusic(s.music == null ? 'none' : s.music, { engineRoot: c.engineRoot });
  const sfx = score.parseSfx(s.sfx == null ? 'off' : s.sfx);
  const kind = kindOf(s.kind);
  const seconds = num(s.seconds, 1, PREVIEW_MAX, PREVIEW_SECONDS);
  const seed = typeof s.seed === 'number' && Number.isInteger(s.seed) && s.seed >= 0 ? s.seed : typeof s.seed === 'string' && /^[\w.:-]{1,64}$/.test(s.seed) ? s.seed : 'flpt';
  const hits = (Array.isArray(s.hits) ? s.hits : []).slice(0, 200).filter((h) => h && typeof h === 'object')
    .map((h) => ({ t: Number(h.t), kind: String(h.kind || ''), gain: Number(h.gain) || 0 }));
  const beats = (Array.isArray(s.beats) ? s.beats : []).slice(0, 200).filter((b) => b && typeof b === 'object' && b.sfx != null)
    .map((b) => ({ t: Number(b.t), sfx: b.sfx }));
  return { music, sfx, kind, seconds, seed, hits, beats, own: Array.isArray(s.hits) || Array.isArray(s.beats) };
}

let ffRun = null;
async function runner(c) {
  let t = typeof c.toolOf === 'function' ? c.toolOf('ffmpeg') : null;
  if (!t && typeof c.detectTools === 'function') { await c.detectTools(); t = c.toolOf('ffmpeg'); }
  const ffmpeg = (t && t.path) || 'ffmpeg';
  if (!ffRun || ffRun.ffmpeg !== ffmpeg) ffRun = { ffmpeg, run: mixer.runner({ ffmpeg, env: typeof c.toolEnv === 'function' ? c.toolEnv() : process.env, writable: [] }) };
  return ffRun.run;
}
async function decodeExcerpt(c, file, startSample, samples) {
  try {
    const d = await mixer.decode(await runner(c), file, { startSample, samples });
    return { left: d.channels[0], right: d.channels[1] };
  } catch { throw new Error('That sound can\'t be played here yet.'); }
}

const cache = new Map(); // the last few previews (a picker plays the same few sounds again and again)
const CACHE_MAX = 4;

async function preview(c, spec, raw) {
  const engineRoot = c.engineRoot;
  const s = cleanSpec(c, spec);
  const N = Math.round(s.seconds * SR);
  let music = null;
  let preset = null;
  let grid = null;
  let key = null;
  if (s.music.source === 'score') {
    preset = score.preset(s.music.id, { engineRoot });
    grid = score.sceneGrid({ sound: { music: s.music.ref }, frames: Math.round(s.seconds * 30), seed: s.seed, engineRoot });
  } else if (s.music.source === 'library') {
    const it = tracks(c).find((x) => x.id === s.music.id);
    if (!it) throw new Error(`The track "${s.music.id}" isn't here.`);
    const g = score.libraryGrid(it.id, { engineRoot });
    const fit = score.fitLibrary(g, { start: 0, seconds: s.seconds, samples: g.samples });
    grid = score.sceneGrid({ sound: { music: s.music.ref }, frames: Math.round(s.seconds * 30), start: 0, engineRoot });
    key = `${it.filePath}:${fit.start}`;
    music = { file: it.filePath, start: Math.round(fit.start * SR) };
  } else if (s.music.source === 'file') {
    if (raw == null) throw new Error('A file of your own needs its episode.');
    const f = filesOf(guard(c, raw))[s.music.id];
    if (!f) throw new Error('That sound file isn\'t here any more.');
    key = `${f}:${fs.statSync(f).mtimeMs}`;
    music = { file: f, start: 0 };
  }
  const narrated = NARRATED.has(s.kind);
  // the piece's own hits when the host knows them, else one on each bar (every 2 s without a grid) to hear the effects
  let hits = s.hits;
  if (!s.own && s.sfx !== 'off') {
    const marks = grid && grid.bars && grid.bars.length ? grid.bars : Array.from({ length: Math.ceil(s.seconds / 2) }, (_, i) => 0.5 + i * 2);
    hits = marks.filter((t) => t < s.seconds - 0.25).map((t, i) => ({ t, kind: DEMO_KINDS[i % DEMO_KINDS.length], gain: 0 }));
  }
  const id = JSON.stringify([s.music.ref, s.sfx, s.kind, s.seconds, s.seed, hits, s.beats, key]);
  if (cache.has(id)) { const v = cache.get(id); cache.delete(id); cache.set(id, v); return v; }

  if (music) music = await decodeExcerpt(c, music.file, music.start, N);
  const W = worker(engineRoot);
  const r = W.mix({ preset, music, seconds: s.seconds, seed: s.seed, sfx: s.sfx, hits, beats: s.beats, sampleRate: SR, level: narrated ? 'bed' : 'full', duck: 0 });
  const value = {
    wav: wav16(r.left, r.right, r.sampleRate).toString('base64'), seconds: r.n / r.sampleRate, sampleRate: r.sampleRate,
    meter: meter(s.kind, { music: s.music.ref, sfx: s.sfx }), lufs: Number.isFinite(r.lufs) ? +r.lufs.toFixed(2) : null,
    hits: r.placed.map((h) => h.at),
  };
  cache.set(id, value);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return value;
}

// ── the choices ─────────────────────────────────────────────────────────────────────────────────────────────────────
function options(c) {
  const engineRoot = c.engineRoot;
  const presets = score.presetIds(engineRoot).map((id) => {
    const p = score.preset(id, { engineRoot });
    return { id, name: String(p.name || id), bpm: p.bpm, music: `score:${id}` };
  });
  const library = tracks(c).map((it) => ({ id: it.id, name: it.name, author: it.author, license: it.license, seconds: it.duration, music: `library:${it.id}` }));
  const defaults = Object.fromEntries(score.KINDS.map((k) => [k, score.soundFor({ kind: k, engineRoot })]));
  return { presets, library, sfx: ['off', 'soft', 'on'], defaults };
}

const fileOut = (r) => (r && r.files && r.files.length ? { token: r.token, name: r.files[0].name } : null);

module.exports = {
  ns: 'sound',
  methods: {
    options: { args: [], handler: (c) => options(c) },
    preview: { args: ['json:32768', 'episode?'], handler: (c, spec, dir) => preview(c, spec, dir) },
    pickFile: { args: [], handler: async (c) => {
      const r = await c.dialogs.open({ title: 'Music', properties: ['openFile'], filters: [{ name: 'Sound', extensions: AUDIO_EXT }] });
      return r.canceled || !r.filePaths.length ? null : fileOut(held(c).stage(r.filePaths.slice(0, 1)));
    } },
    stageFile: { args: ['dropped1'], handler: (c, p) => { const h = held(c); return p ? fileOut(h.stage([p])) : null; } },
    useFile: { args: ['episode', 'token', 'bool'], handler: (c, dir, token, mine) => useFile(c, dir, token, mine) },
    files: { args: ['episode'], handler: (c, dir) => listFiles(guard(c, dir)).map((x) => ({ music: `file:${x.id}`, name: x.name })) },
  },
  // for the score pass and the tests (not methods)
  filesOf, seedFor, meter, PREVIEW_SECONDS, PREVIEW_MAX, SOUND_DIR, AUDIO_EXT,
};
