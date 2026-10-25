'use strict';
// The cartoon presenter (PLAN §2.12; W3-05): who presents an episode, which voice speaks for the cartoon, what that
// costs, and the cartoon's own pass that draws the bubble. Electron-free (the plugin has a copy in engine/tools/lib).
//
// Who presents: settings.presenter.kind 'heygen' (your HeyGen twin, the default) or 'cartoon' (a stock rig, Ada or Bram,
// or later "Cartoon you"), with its voice { provider, id, name, engine, model }; an episode may say otherwise in
// intake.presenter (a 0.7.x episode was made for the twin). Once Spend is approved, the presenter it priced is kept on
// that approval (stages.spend.presenter, ext/presenter.js) and wins while it stands, so a later change in Setup never
// re-voices a film that was paid for. Everything (the estimate, the pipeline's runs, Spend) asks of() the same way, so
// they never disagree.
//
// The cartoon's voices (decisions.md "W3-05 voices"), each with its own broker rate, budget token, estimate line,
// loopback stand-in and free sample, and only its own key in a paid run (T19):
//   heygen      your HeyGen voice, narration only (heygen_tts_s, the HeyGen token)
//   elevenlabs  your ElevenLabs voice, e.g. a clone (elevenlabs_tts_char, the ElevenLabs token)
//   fish        your Fish.audio voice (fish_tts_byte, the Fish.audio token; FLPT_TTS=fish, patch FLPT_VOICES_V1)
//   say         the Mac's own voice: free, keyless and offline, the film made on the draft's path (cartoonFinal)
// No avatar clip is ever estimated or made for a cartoon (T4): every narrated second is voice. A paid voice is offered
// only when Spend can approve its provider (spendProviders(): flow.js's SPEND_PROVIDERS; HeyGen's alone until then).
//
// The cartoon's pass (render): after a run's narration exists, its timeline lists each bubble slide's padded narration
// (FLPT_PADKEYS_V1); engine/runtime/flpt-live/presenter/tools/make-clips.mjs turns each into a clip, inside macOS's
// sandbox, keyless, no network, writing only presentation/video/cache/cartoon/; the pipeline's next composite puts them
// in the bubble (FLPT_CARTOON_V1). FLPT's Rhubarb is checked against the app's toolchain manifest before it's first
// used; the plugin has no manifest beside its copy of this file and trusts its own bundle (the files and any list of
// their hashes would arrive together, so checking one against the other would add nothing).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const broker = require('./broker');
const sandbox = require('./sandbox');

const KINDS = ['heygen', 'cartoon'];
const STOCK = ['stock-ada', 'stock-bram'];
const DEFAULT_RIG = 'stock-ada';

// The voices a cartoon can speak with. key: the vault key that pays for it; rate: its broker rate; tts: the pipeline's
// narration engine; free: nothing to pay.
const VOICES = {
  heygen: { id: 'heygen', name: 'HeyGen', key: 'HEYGEN_API_KEY', rate: 'heygen_tts_s', tts: 'heygen' },
  elevenlabs: { id: 'elevenlabs', name: 'ElevenLabs', key: 'ELEVENLABS_API_KEY', rate: 'elevenlabs_tts_char', tts: 'elevenlabs', model: 'eleven_v3' },
  fish: { id: 'fish', name: 'Fish.audio', key: 'FISH_AUDIO_API_KEY', rate: 'fish_tts_byte', tts: 'fish', model: 's2.1-pro' },
  say: { id: 'say', name: 'Mac', key: null, rate: null, tts: 'say', free: true },
};
const PROVIDERS = Object.keys(VOICES);

/**
 * The providers Spend can approve a film for: flow.js says so (SPEND_PROVIDERS) once its approval takes every provider
 * in the estimate (W3-03); until then HeyGen's alone. Read when asked (flow.js loads this file).
 */
function spendProviders() {
  try {
    const f = require('./flow');
    if (Array.isArray(f.SPEND_PROVIDERS)) return f.SPEND_PROVIDERS.filter((p) => typeof p === 'string');
  } catch { /* no flow here */ }
  return ['heygen'];
}
/** The cartoon's voices on offer: the free ones, and the paid ones Spend can approve. */
const offered = (spend = spendProviders()) => PROVIDERS.filter((id) => VOICES[id].free || spend.includes(id));

// The voices' rates, read from the providers' own price pages (2026-10-23): ElevenLabs' API, 0.08 US dollars per 1,000
// characters for Eleven v3 and Multilingual v2 (elevenlabs.io/pricing/api; Flash and Turbo cost half, so v3's is the
// cautious one); Fish.audio's API, 15 US dollars per million UTF-8 bytes of text (docs.fish.audio, "API Pricing").
// HeyGen's voice is heygen_tts_s (broker.js). Estimates, shown before any approval.
const RATES = {
  elevenlabs_tts_char: { provider: 'elevenlabs', unit: 'character of narration (ElevenLabs)', usd: 0.08 / 1000 },
  fish_tts_byte: { provider: 'fish', unit: 'byte of narration text (Fish.audio)', usd: 15 / 1e6 },
};
/** Add the voices' rates to the broker's table (each once; never over one it has). */
function registerRates(table = broker.RATES) {
  for (const [k, v] of Object.entries(RATES)) if (!Object.prototype.hasOwnProperty.call(table, k)) table[k] = v;
  return table;
}
registerRates();

const ID = /^[A-Za-z0-9_\-.:]{1,128}$/;
const RIG_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const str = (v, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const readJson = (p, fallback = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } };

/**
 * A cartoon voice as saved: { provider, id, name, engine?, model? }, or null. The Mac voice's id is a `say` voice name
 * ('' for the Mac's own default); a paid voice's id may be '' while none is picked yet (Spend waits for one).
 */
function cleanVoice(v) {
  if (!isObj(v) || !PROVIDERS.includes(v.provider)) return null;
  const id = str(v.id, 128);
  if (v.provider !== 'say' && id && !ID.test(id)) return null; // no id yet: the provider is picked, its voice isn't
  if (v.provider === 'say' && id && !/^[\p{L}\p{N} ()._'-]{1,64}$/u.test(id)) return null;
  const out = { provider: v.provider, id, name: str(v.name) };
  if (v.provider === 'heygen') out.engine = ['elevenlabs_v3', 'starfish', 'orca', 'elevenlabs'].includes(v.engine) ? v.engine : 'starfish';
  if (v.provider === 'elevenlabs' || v.provider === 'fish') out.model = /^[a-z0-9_.-]{1,40}$/.test(String(v.model || '')) ? v.model : VOICES[v.provider].model;
  return out;
}

/** The cartoon part of a presenter choice, cleaned: { kind, rig, voice }. kind is 'heygen' unless it says 'cartoon'. */
function clean(p) {
  const kind = isObj(p) && KINDS.includes(p.kind) ? p.kind : 'heygen';
  if (kind !== 'cartoon') return { kind };
  return { kind, rig: isObj(p) && RIG_ID.test(String(p.rig || '')) ? p.rig : DEFAULT_RIG, voice: cleanVoice(isObj(p) ? p.voice : null) || { provider: 'say', id: '', name: '' } };
}

/**
 * Who presents this episode: the one its Spend approval priced while that approval stands, else its own
 * intake.presenter when it has one (a 0.7.x episode: the twin), else the settings'. `settingsPresenter` is
 * settings.presenter (or null). → { kind, rig?, voice?, from: 'spend' | 'episode' | 'settings' }.
 */
function of(dir, settingsPresenter = null) {
  let st = null;
  try { st = JSON.parse(fs.readFileSync(path.join(dir, 'flpt-project.json'), 'utf8')); } catch { /* no record */ }
  const spend = st && isObj(st.stages) && isObj(st.stages.spend) ? st.stages.spend : null;
  if (spend && spend.status === 'approved' && isObj(spend.presenter) && KINDS.includes(spend.presenter.kind)) return { ...clean(spend.presenter), from: 'spend' };
  const own = st && isObj(st.intake) && isObj(st.intake.presenter) ? st.intake.presenter : null;
  if (own && KINDS.includes(own.kind)) {
    // an episode that says only "cartoon" takes the settings' rig and voice
    const base = isObj(settingsPresenter) && settingsPresenter.kind === 'cartoon' ? settingsPresenter : {};
    return { ...clean({ ...base, ...own, voice: own.voice || base.voice, rig: own.rig || base.rig }), from: 'episode' };
  }
  if (st && !(Number(st.v) >= 2)) return { kind: 'heygen', from: 'episode' }; // made by 0.7.x for the twin
  return { ...clean(settingsPresenter), from: 'settings' };
}

const isCartoon = (p) => Boolean(p && p.kind === 'cartoon');
/** The provider a cartoon's film bills (heygen, elevenlabs, fish), or null: the Mac voice, or not a cartoon. */
function billedBy(p) {
  if (!isCartoon(p)) return null;
  const v = VOICES[(p.voice || {}).provider];
  return v && !v.free ? v.id : null;
}

/** The keys this presenter needs: the twin, or a cartoon's paid voice. Anthropic is the crew's (vault.requiredFor). */
function requiredKeys(p) {
  if (!isCartoon(p)) return ['HEYGEN_API_KEY'];
  const v = VOICES[(p.voice || {}).provider];
  return v && v.key ? [v.key] : [];
}

/**
 * What a pipeline run of this presenter adds: env (FLPT_PRESENTER, FLPT_TTS, FLPT_PRESENTER_SET: the cartoon's voice for
 * this run only, never written to a profile) and args (the Mac voice for the draft's path). The twin adds nothing.
 */
function runEnv(p) {
  if (!isCartoon(p)) return { env: {}, args: [] };
  const v = p.voice || {};
  const set = {};
  const env = { FLPT_PRESENTER: 'cartoon' };
  if (v.provider === 'heygen') Object.assign(set, { TTS_PROVIDER: 'heygen', ...(v.id ? { HEYGEN_VOICE_ID: v.id } : {}), ...(v.engine ? { HEYGEN_VOICE_ENGINE: v.engine } : {}) });
  if (v.provider === 'elevenlabs') Object.assign(set, { TTS_PROVIDER: 'elevenlabs', ...(v.id ? { ELEVENLABS_VOICE_ID: v.id } : {}), ELEVENLABS_MODEL: v.model || VOICES.elevenlabs.model });
  if (v.provider === 'fish') { env.FLPT_TTS = 'fish'; Object.assign(set, { ...(v.id ? { FISH_VOICE_ID: v.id } : {}), FISH_MODEL: v.model || VOICES.fish.model }); }
  if (Object.keys(set).length) env.FLPT_PRESENTER_SET = JSON.stringify(set);
  return { env, args: v.provider === 'say' && v.id ? ['--say-voice', v.id] : [] };
}

// ── the estimate (T4: no avatar clip for a cartoon; every narrated second is voice) ─────────────────────────────────
const PIPELINE_CPS = 14.5; // the pipeline's own pace for narration it hasn't made yet (CHARS_PER_SEC)

/** Enough of a unit to cost a cent at least: any voice still to make is priced, and approved, never at zero. */
function atLeastACent(rate, qty) {
  const r = broker.RATES[rate];
  return qty > 0 && r && r.usd ? Math.max(Math.ceil(0.01 / r.usd - 1e-9), Math.ceil(qty)) : Math.ceil(qty);
}

/**
 * The filming estimate as a cartoon presenter makes it, from the one flow.js worked out for the twin (est: { lines,
 * film }): the avatar's line goes (its seconds, when they came from the script, are voice too), and the voice is
 * priced by the cartoon's own provider. The Mac's voice costs nothing: no line, and `film.nothing` when there's
 * narration (Spend approves it free, with no dialog). → a new estimate (broker.estimate's shape) with film.presenter.
 */
function estimateFor(est, p, { narrated = true } = {}) {
  if (!isCartoon(p) || !isObj(est)) return est;
  const lines = Array.isArray(est.lines) ? est.lines : [];
  const film = isObj(est.film) ? est.film : {};
  const qty = (rate) => lines.filter((l) => l.rate === rate).reduce((a, l) => a + (Number(l.qty) || 0), 0);
  const seconds = (film.source === 'pipeline' ? 0 : qty('heygen_avatar_s')) + qty('heygen_tts_s');
  const v = VOICES[(p.voice || {}).provider] || VOICES.say;
  const out = [];
  if (seconds > 0 && !v.free) {
    if (v.id === 'heygen') out.push({ rate: 'heygen_tts_s', qty: Math.max(5, Math.round(seconds)), label: 'Your HeyGen voice · cartoon presenter' });
    if (v.id === 'elevenlabs') out.push({ rate: 'elevenlabs_tts_char', qty: atLeastACent('elevenlabs_tts_char', seconds * PIPELINE_CPS), label: 'Your ElevenLabs voice · cartoon presenter' });
    if (v.id === 'fish') out.push({ rate: 'fish_tts_byte', qty: atLeastACent('fish_tts_byte', seconds * PIPELINE_CPS), label: 'Your Fish.audio voice · cartoon presenter' });
  }
  const priced = broker.estimate(out);
  const nothing = !out.length && narrated;
  return { ...priced, film: { ...film, clips: 0, total: 0, filmed: 0, nothing: v.free ? narrated : Boolean(film.nothing) || nothing, presenter: 'cartoon', voice: v.id } };
}

// ── rigs ────────────────────────────────────────────────────────────────────────────────────────────────────────
const stockDir = (engineRoot) => path.join(engineRoot, 'runtime', 'flpt-live', 'presenter', 'rigs');

/**
 * A rig at rest as one SVG (its poster: Setup's tile), composed from its own layers in their order, framed by its camera:
 * text, made here, so no picture ships for it. PNG layers (a likeness) are composed the same way. → SVG text, or null.
 */
function rigPoster(dir) {
  const rig = readJson(path.join(dir, 'rig.json'));
  if (!rig || !Array.isArray(rig.layers)) return null;
  const W = 720;
  const cam = rig.camera && Number(rig.camera.scale) > 0 ? rig.camera : { scale: 1, focus: [360, 360] };
  const pick = { eyes: 'open', mouth: 'smile' };
  const parts = [];
  for (const L of rig.layers.slice().sort((a, b) => a.z - b.z)) {
    const file = L.type === 'swap' ? L.states && L.states[pick[L.id]] : L.src;
    if (typeof file !== 'string' || !/^[A-Za-z0-9_.-]{1,80}\.(svg|png)$/.test(file)) continue;
    let data = null;
    try { data = fs.readFileSync(path.join(dir, file)).toString('base64'); } catch { continue; }
    const type = file.endsWith('.png') ? 'image/png' : 'image/svg+xml';
    parts.push(`<image href="data:${type};base64,${data}" x="0" y="0" width="${W}" height="${W}"/>`);
  }
  const bg = /^#[0-9A-Fa-f]{6}$/.test(String(rig.background && rig.background.value)) ? rig.background.value : '#FFFFFF';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${W}" width="${W}" height="${W}"><rect width="${W}" height="${W}" fill="${bg}"/>`
    + `<g transform="translate(360 360) scale(${Number(cam.scale)}) translate(${-Number(cam.focus[0])} ${-Number(cam.focus[1])})">${parts.join('')}</g></svg>`;
}

/**
 * The rigs to pick from: the stock ones (engine), then the user's own in <projects>/Presenters/<id>/ (Cartoon you,
 * W3-10). Each { id, name, version, stock, dir, kind }; a rig that doesn't check out is left out, and a likeness without
 * its consent is never offered (checkRig).
 */
function rigs(engineRoot, presentersDir = null) {
  const { checkRig } = require(path.join(engineRoot, 'runtime', 'flpt-live', 'presenter', 'rig.js'));
  const out = [];
  const add = (dir, stock) => {
    const rig = readJson(path.join(dir, 'rig.json'));
    if (!rig || checkRig(rig).length || path.basename(dir) !== rig.id) return;
    out.push({ id: rig.id, name: rig.name, version: rig.version, stock, dir, kind: rig.provenance.kind });
  };
  for (const id of STOCK) add(path.join(stockDir(engineRoot), id), true);
  if (presentersDir) {
    let names = [];
    try { names = fs.readdirSync(presentersDir).filter((n) => RIG_ID.test(n) && !STOCK.includes(n)).sort(); } catch { /* none yet */ }
    for (const n of names) add(path.join(presentersDir, n), false);
  }
  return out;
}

/** A rig's folder by id (stock first), or null. */
function rigDir(engineRoot, id, presentersDir = null) {
  const r = rigs(engineRoot, presentersDir).find((x) => x.id === id);
  return r ? r.dir : null;
}

// ── the cartoon's pass ──────────────────────────────────────────────────────────────────────────────────────────
const videoDir = (dir) => path.join(dir, 'presentation', 'video');
const TIMELINE = { draft: 'draft_presentation.timeline.json', final: 'presentation.timeline.json' };

/** A run's timeline ('draft' or 'final'), or null. */
const timelineOf = (dir, which) => readJson(path.join(videoDir(dir), 'output', TIMELINE[which === 'draft' ? 'draft' : 'final']));

/** Inside the video folder, a relative path from the pipeline's timeline, or null. */
function inVideo(dir, rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel)) return null;
  const v = path.resolve(videoDir(dir));
  const p = path.resolve(v, rel);
  return p.startsWith(v + path.sep) ? p : null;
}

/**
 * The bubble slides a run's cartoon clips are for, from its timeline (FLPT_PADKEYS_V1): [{ n, pad_key, wav, frames,
 * spoken, words }]. words: the provider's word timings beside the narration (FLPT_WORDS_V1), when there are any.
 */
function slidesFor(dir, which) {
  const tl = timelineOf(dir, which);
  if (!tl || !Array.isArray(tl.slides)) return [];
  const out = [];
  for (const s of tl.slides) {
    if (!s || s.bubble === false || !/^[0-9a-f]{8,64}$/.test(String(s.pad_key || '')) || !Number.isInteger(s.frames)) continue;
    const wav = inVideo(dir, s.padded_wav);
    if (!wav) continue;
    const narr = inVideo(dir, s.narration);
    const words = narr ? path.join(path.dirname(narr), 'words', `${path.basename(narr, '.wav')}.json`) : null;
    out.push({ n: s.n, pad_key: s.pad_key, wav, frames: s.frames, spoken: typeof s.spoken === 'string' ? s.spoken.slice(0, 20000) : '', words: words && exists(words) ? words : null });
  }
  return out;
}

/** Slide n's cartoon clip in a run ('draft' or 'final'; the film's, else the draft's), or null: the Studio's bubble. */
function clipFor(dir, n, which = null) {
  const idx = readJson(path.join(videoDir(dir), 'cache', 'cartoon', 'index.json'), {}) || {};
  for (const w of which ? [which] : ['final', 'draft']) {
    const s = slidesFor(dir, w).find((x) => x.n === Number(n));
    const rel = s && idx[s.pad_key];
    const file = typeof rel === 'string' ? inVideo(dir, path.join('cache', 'cartoon', rel)) : null;
    if (file && exists(file)) return file;
  }
  return null;
}

/** The first `node` on the tools' PATH (the app's pinned Node first), else this process's when it is Node. */
function nodeFrom(env) {
  if (env && env.FLPT_NODE && path.isAbsolute(env.FLPT_NODE) && exists(env.FLPT_NODE)) return env.FLPT_NODE;
  for (const d of String((env && env.PATH) || '').split(path.delimiter)) {
    if (path.isAbsolute(d) && exists(path.join(d, 'node'))) return path.join(d, 'node');
  }
  return process.versions.electron ? null : process.execPath;
}

/** A program on the tools' PATH, or null. */
function onPath(env, name) {
  for (const d of String((env && env.PATH) || '').split(path.delimiter)) if (path.isAbsolute(d) && exists(path.join(d, name))) return path.join(d, name);
  return null;
}

/** FLPT's Rhubarb, checked: against the app's toolchain manifest (once: see toolchain.verifyRhubarb), else there. */
function rhubarbChecked(engineRoot, stampDir) {
  const manifestFile = path.join(__dirname, 'toolchain-manifest.json');
  if (exists(manifestFile)) return require('./toolchain').verifyRhubarb({ manifestFile, engineRoot, stampDir });
  const js = path.join(engineRoot, 'runtime', 'flpt-live', 'presenter', 'rhubarb', 'rhubarb.js');
  return exists(js) ? { ok: true, problem: null } : { ok: false, problem: 'not in this build' };
}

/**
 * What the cartoon's pass needs, checked free and offline (Setup's check, the pipeline's check of a cartoon): FLPT's
 * Rhubarb, Node, the headless browser and puppeteer-core that HyperFrames brings, ffmpeg, and macOS's sandbox.
 * o: { engineRoot, toolEnv, stampDir }. → { ok, lines: ['✓ …' | '✗ …'] }.
 */
function checkTools(o = {}) {
  const env = typeof o.toolEnv === 'function' ? o.toolEnv() : (o.toolEnv || {});
  const hf = env.FLPT_HYPERFRAMES && path.isAbsolute(env.FLPT_HYPERFRAMES) ? env.FLPT_HYPERFRAMES : null;
  const browser = [env.FLPT_HF_BROWSER, env.HYPERFRAMES_BROWSER_PATH].find((p) => p && path.isAbsolute(p) && exists(p));
  const puppeteer = [env.FLPT_PUPPETEER, hf && path.resolve(path.dirname(hf), '..', '..', 'puppeteer-core')].find((p) => p && path.isAbsolute(p) && exists(p));
  const ffmpeg = [env.FLPT_FFMPEG, env.HYPERFRAMES_FFMPEG_PATH].find((p) => p && path.isAbsolute(p) && exists(p)) || onPath(env, 'ffmpeg');
  const rh = rhubarbChecked(o.engineRoot, o.stampDir || null);
  const rows = [
    ['FLPT\'s Rhubarb (lip sync)', rh.ok, rh.problem],
    ['Node.js', Boolean(nodeFrom(env)), 'not set up (Setup → Tools)'],
    ['HyperFrames\' browser', Boolean(browser && puppeteer), 'not set up (Setup → Tools)'],
    ['ffmpeg', Boolean(ffmpeg), 'not set up (Setup → Tools)'],
    ['macOS\'s sandbox', sandbox.available(), 'not on this Mac'],
  ];
  return { ok: rows.every((r) => r[1]), lines: rows.map(([what, ok, why]) => `  ${ok ? '✓' : '✗'} cartoon presenter: ${what}${ok ? '' : `: ${why}`}`) };
}

/**
 * One run of the cartoon's pass (make-clips.mjs) on a plan, inside macOS's sandbox: writes only `cartoonDir` and its own
 * temp folder, no network, no key in its environment. o: { engineRoot, toolEnv, node, onLine, signal, sandbox (false:
 * without it, tests only), hidden }. Resolves make-clips' result ({ ok, clips, problems, … }).
 */
function runPass(plan, cartoonDir, o = {}) {
  const tool = path.join(o.engineRoot, 'runtime', 'flpt-live', 'presenter', 'tools', 'make-clips.mjs');
  const env0 = typeof o.toolEnv === 'function' ? o.toolEnv() : (o.toolEnv || {});
  const node = o.node || nodeFrom(env0);
  if (!node) return Promise.resolve({ ok: false, clips: [], problems: ['Node.js isn\'t set up yet (Setup → Tools).'] });
  fs.mkdirSync(cartoonDir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(sandbox.tmpdir(), 'flpt-cartoon-'));
  const planFile = path.join(tmp, 'plan.json');
  fs.writeFileSync(planFile, JSON.stringify(plan));
  // the pass's environment from nothing: the toolchain's tools, never a key
  const pick = ['PATH', 'FLPT_HYPERFRAMES', 'HYPERFRAMES_BROWSER_PATH', 'HYPERFRAMES_FFMPEG_PATH', 'HYPERFRAMES_FFPROBE_PATH', 'FLPT_PUPPETEER', 'FLPT_HF_BROWSER', 'FLPT_FFMPEG', 'FLPT_FFPROBE'];
  const env = { HOME: process.env.HOME || os.homedir(), USER: process.env.USER || '', LANG: 'en_US.UTF-8', TMPDIR: sandbox.tmpdir(), FLPT_SANDBOXED: '1', FLPT_NODE: node };
  for (const k of pick) if (env0[k]) env[k] = env0[k];
  if (!env.PATH) env.PATH = [path.dirname(node), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].join(':');
  let cmd = node;
  let args = [tool, '--plan', planFile];
  if (o.sandbox !== false) {
    if (!sandbox.available()) { fs.rmSync(tmp, { recursive: true, force: true }); return Promise.resolve({ ok: false, clips: [], problems: ['The cartoon is drawn inside macOS\'s sandbox, which isn\'t here.'] }); }
    [cmd, args] = sandbox.wrap(node, args, { writable: [cartoonDir, tmp], hidden: [...sandbox.hiddenDirs(), ...(o.hidden || [])] });
  }
  const onLine = o.onLine || (() => {});
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let rest = '';
    child.stdout.on('data', (b) => { out = (out + b).slice(-(1 << 20)); });
    child.stderr.on('data', (b) => {
      const parts = (rest + b).split('\n');
      rest = parts.pop();
      for (const l of parts) if (l.trim()) onLine(l.slice(0, 400));
    });
    const stop = () => child.kill('SIGTERM');
    if (o.signal) o.signal.addEventListener('abort', stop, { once: true });
    const done = (r) => { if (o.signal) o.signal.removeEventListener('abort', stop); fs.rmSync(tmp, { recursive: true, force: true }); resolve(r); };
    child.on('error', (e) => done({ ok: false, clips: [], problems: [`The cartoon couldn't start: ${e.message}`] }));
    child.on('close', () => {
      const line = out.trim().split('\n').reverse().find((l) => l.startsWith('{'));
      let r = null;
      try { r = JSON.parse(line); } catch { /* below */ }
      done(r && typeof r === 'object' ? { clips: [], problems: [], ...r } : { ok: false, clips: [], problems: ['The cartoon pass stopped without a result.'] });
    });
  });
}

/**
 * Draw the cartoon for a run ('draft' or 'final'): every bubble slide in its timeline, each clip made once (cached by
 * cartoonKey). Keyless, offline, sandboxed: writes only the episode's cartoon cache. o: { engineRoot, presenter (of()),
 * presentersDir, toolEnv, onLine, signal, sandbox, workers, hidden, stampDir (where Rhubarb's check is remembered: the
 * app's own folder; else the episode's cartoon cache) }. Resolves { ok, clips, problems, made } (never throws for a
 * slide: one whose clip didn't come shows the cartoon's still).
 */
async function render(dir, which, o = {}) {
  const p = o.presenter || of(dir, null);
  if (!isCartoon(p)) return { ok: true, skipped: true, clips: [], problems: [], made: 0 };
  const slides = slidesFor(dir, which);
  if (!slides.length) return { ok: true, clips: [], problems: [], made: 0 }; // no narration in that run yet: nothing to draw
  const rig = rigDir(o.engineRoot, p.rig, o.presentersDir) || rigDir(o.engineRoot, DEFAULT_RIG);
  if (!rig) return { ok: false, clips: [], problems: ['The presenter\'s rig isn\'t there.'], made: 0 };
  const cache = path.join(videoDir(dir), 'cache');
  // FLPT's Rhubarb, checked against the app's toolchain manifest before its first use (the plugin trusts its own bundle)
  const checked = rhubarbChecked(o.engineRoot, o.stampDir || path.join(cache, 'cartoon'));
  const r = await runPass({ cache, rig, workers: o.workers || 3, still: true, slides, rhubarb: checked.ok }, path.join(cache, 'cartoon'), o);
  if (!checked.ok) r.problems = [`FLPT's Rhubarb: ${checked.problem}`, ...(r.problems || [])];
  return { ...r, made: (r.clips || []).filter((c) => !c.cached).length };
}

/** Whether a run's video already shows the cartoon on every bubble slide (its timeline says "clip" for each). */
function allInBubble(dir, which) {
  const tl = timelineOf(dir, which);
  const rows = tl && Array.isArray(tl.slides) ? tl.slides.filter((s) => s && s.bubble !== false && s.pad_key) : [];
  return rows.length > 0 && rows.every((s) => s.avatar === 'clip');
}

/**
 * A short free sample of a rig talking, in the Mac's voice (Setup's ▶ on a rig): said with `say`, padded to whole
 * frames, drawn by the cartoon's own pass in `dir` (reused when it's there). o: { engineRoot, presentersDir, toolEnv,
 * sayVoice, say, sandbox }. Resolves the clip's path; throws when it can't be made.
 */
async function sampleClip(rigId, dir, o = {}) {
  const rig = rigDir(o.engineRoot, rigId, o.presentersDir);
  if (!rig) throw new Error('That presenter isn\'t there.');
  const C = require(path.join(o.engineRoot, 'runtime', 'flpt-live', 'presenter', 'compile.js'));
  const voice = o.sayVoice && /^[\p{L}\p{N} ()._'-]{1,64}$/u.test(o.sayVoice) ? o.sayVoice : '';
  const text = 'Hello! I\'m your presenter. Every slide, every word, right on cue.';
  const padKey = require('crypto').createHash('sha256').update(`sample|${voice}|${text}`).digest('hex').slice(0, 20);
  const cache = path.join(dir, 'cache');
  const idx = readJson(path.join(cache, 'cartoon', 'index.json'), {}) || {};
  const rigNow = readJson(path.join(rig, 'rig.json'), {});
  const wav = path.join(cache, 'audio', 'padded', `${padKey}.wav`);
  fs.mkdirSync(path.dirname(wav), { recursive: true });
  if (!exists(wav)) {
    const said = `${wav}.say.wav`;
    await new Promise((resolve, reject) => require('child_process').execFile(o.say || '/usr/bin/say', [...(voice ? ['-v', voice] : []), '-o', said, '--file-format=WAVE', '--data-format=LEI16@48000', text],
      { timeout: 30000 }, (err) => (err ? reject(new Error('The Mac couldn\'t say the sample.')) : resolve())));
    const { pcm } = C.readWav(fs.readFileSync(said));
    const lead = 14400; // 0.3 s
    const frames = Math.ceil((lead + pcm.length + 19200) / 1600);
    const total = frames * 1600;
    const data = Buffer.alloc(total * 2);
    for (let i = 0; i < pcm.length; i++) data.writeInt16LE(pcm[i], (lead + i) * 2);
    const head = Buffer.alloc(44);
    head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8); head.write('fmt ', 12);
    head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(48000, 24);
    head.writeUInt32LE(96000, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40);
    fs.writeFileSync(wav, Buffer.concat([head, data]));
    fs.rmSync(said, { force: true });
  }
  const frames = Math.round((fs.statSync(wav).size - 44) / 2 / 1600);
  const r = await runPass({ cache, rig, workers: 1, still: false, slides: [{ n: 1, pad_key: padKey, wav, frames, spoken: text }] }, path.join(cache, 'cartoon'), o);
  const after = readJson(path.join(cache, 'cartoon', 'index.json'), idx) || {};
  const clip = after[padKey] ? path.join(cache, 'cartoon', after[padKey]) : null;
  if (!r.ok || !clip || !exists(clip)) throw new Error((r.problems || [])[0] || `The sample of ${rigNow.name || rigId} wasn't made.`);
  return clip;
}

module.exports = { KINDS, STOCK, DEFAULT_RIG, VOICES, PROVIDERS, RATES, registerRates, spendProviders, offered, clean, cleanVoice, of, isCartoon,
  billedBy, requiredKeys, runEnv, estimateFor, rigs, rigDir, rigPoster, slidesFor, clipFor, timelineOf, render, runPass, allInBubble, sampleClip,
  nodeFrom, checkTools, PIPELINE_CPS };
