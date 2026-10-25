'use strict';
// The stem under a Live Motion piece (PLAN §2.6), with ffmpeg alone: the music and the sound effects in, one 48 kHz
// stereo WAV out, exactly frames × 1600 samples, at the level FLPT sets. Nothing here reaches the network.
//   bedStem()          narrated pieces (Solo, Duet, code Cosmos): music → fades 1.0/1.8 s → -26 LUFS → ducked under the
//                      narration (≈ 8 dB, ≥ 10 LU under the voice) → SFX on their samples → limiter → stem.wav
//   interstitialStem() unnarrated pieces (Solo ♪, code cut scenes): music → fades → SFX → -21 LUFS, true peak ≤ -2 dBTP
//   stemOk()           the check every stem passes before FLPT uses it: length to the sample, rate, channels, levels
// The rules spike K4 measured (research/wave0-results.md), each one load-bearing:
//   - every branch is padded (apad) and only merges are trimmed: sidechaincompress ends when either input ends, which
//     cut the tail at a run-dependent point; with the padding the stem is byte-identical run to run
//   - alimiter level=disabled latency=1 (the default re-levels and delays everything 239 samples)
//   - amix normalize=0 (the default lowers every input by the number of hits)
//   - adelay in samples: each hit's anchor lands on round(t·48000)
//   - levels are measured with ebur128 and applied with volume (loudnorm's first pass reads short percussive clips
//     0.3–0.55 LU low, so its linear second pass misses -21 ± 0.5)
//   - the duck's key is the narration high-passed and companded to one flat level, so the duck doesn't follow the
//     voice's loudness; threshold 0.027, ratio 4, attack 20 ms, release 400 ms
//   - "the voice wins": a voice quieter than about -22 LUFS can't sit 10 LU over a -26 bed, so the guard lowers the
//     bed by the shortfall; the sound effects follow the same cut (W1-08's ruling on K4's open question)
// Commands run through `run(args, { signal }) → { code, out: Buffer, err }`. runner() makes one around the toolchain's
// ffmpeg, inside macOS's sandbox when it's there (no network, writes only in the score folder).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const sandbox = require('./sandbox');

const SR = 48000;
const FPS = 30;
const SPF = SR / FPS; // 1600 samples per frame
const BED = { lufs: -26, fadeIn: 1.0, fadeOut: 1.8, underVoice: 10, limitDbfs: -3, tp: -2 };
const INTER = { I: -21, TP: -2, LRA: 11, tol: 0.5 };
const DUCK = { highpass: 120, keyDb: -18, gateDb: -42, keyDecay: 0.3, threshold: 0.027, ratio: 4, attack: 20, release: 400, knee: 2 };
const SFX_LEVEL = { off: null, soft: -6, on: 0 }; // dB on top of each one-shot's own -8 dBFS peak
const VOICE_REF = -22; // LUFS: the quietest voice a -26 bed stays 10 LU under (K4); an SFX-only stem uses it as its guard

const f6 = (x) => (+x).toFixed(6);
const f3 = (x) => (+x).toFixed(3);

// ── running ffmpeg ───────────────────────────────────────────────────────────────────────────────
/**
 * A `run` around ffmpeg: { ffmpeg (path), env, writable (the folders it may write in; not even the temporary folders
 * otherwise: ffmpeg needs none), sandbox (default true: inside macOS's sandbox when it exists), wrap(cmd, args) →
 * [cmd, args] (another surface's sandbox, e.g. bwrap) }.
 */
function runner({ ffmpeg = 'ffmpeg', env = process.env, writable = [], sandbox: inSandbox = true, wrap = null, timeoutMs = 10 * 60000 } = {}) {
  return (args, { signal } = {}) => new Promise((resolve) => {
    let cmd = ffmpeg;
    let argv = ['-hide_banner', '-nostdin', '-nostats', ...args];
    try {
      if (wrap) [cmd, argv] = wrap(cmd, argv);
      else if (inSandbox && sandbox.available()) [cmd, argv] = sandbox.wrap(cmd, argv, { writable, scratch: false });
    } catch (e) { resolve({ code: 126, out: Buffer.alloc(0), err: `Not run: ${e.message}.` }); return; }
    let child;
    try { child = spawn(cmd, argv, { env, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { resolve({ code: 127, out: Buffer.alloc(0), err: e.message }); return; }
    const out = [];
    let err = '';
    child.stdout.on('data', (b) => out.push(b));
    child.stderr.on('data', (b) => { err += b; if (err.length > 1 << 20) err = err.slice(-(1 << 19)); });
    const stop = () => child.kill('SIGTERM');
    const timer = setTimeout(stop, timeoutMs);
    if (signal) signal.addEventListener('abort', stop, { once: true });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: 127, out: Buffer.concat(out), err: `${err}${e.message}` }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', stop);
      resolve({ code: code == null ? 1 : code, out: Buffer.concat(out), err });
    });
  });
}

async function ff(run, args, opts) {
  const r = await run(args, opts);
  if (r.code !== 0) throw new Error(`ffmpeg failed (${r.code}): ${String(r.err).trim().split('\n').slice(-4).join(' ')}`);
  return r;
}

// ── WAV files ───────────────────────────────────────────────────────────────────────────────────
/** Walk a WAV's chunks: { tag, channels, sampleRate, bits, dataOffset, dataBytes, frames }. Reads only the headers. */
function info(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const head = Buffer.alloc(12);
    fs.readSync(fd, head, 0, 12, 0);
    if (head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${path.basename(file)} isn't a WAV file`);
    let off = 12;
    let fmt = null;
    const ch = Buffer.alloc(40);
    while (off + 8 <= size) {
      fs.readSync(fd, ch, 0, 8, off);
      const id = ch.toString('ascii', 0, 4);
      let n = ch.readUInt32LE(4);
      if (id === 'fmt ') {
        fs.readSync(fd, ch, 0, Math.min(40, n), off + 8);
        let tag = ch.readUInt16LE(0);
        if (tag === 0xFFFE && n >= 26) tag = ch.readUInt16LE(24);
        fmt = { tag, channels: ch.readUInt16LE(2), sampleRate: ch.readUInt32LE(4), bits: ch.readUInt16LE(14) };
      } else if (id === 'data') {
        if (!fmt) break;
        if (n === 0 || n === 0xFFFFFFFF || off + 8 + n > size) n = size - off - 8; // a piped header: to the end
        const frameBytes = fmt.channels * fmt.bits / 8;
        return { ...fmt, dataOffset: off + 8, dataBytes: n, frames: Math.floor(n / frameBytes) };
      }
      off += 8 + n + (n & 1);
    }
    throw new Error(`${path.basename(file)} has no audio`);
  } finally { fs.closeSync(fd); }
}

/** A WAV's samples as Float32Array channels (PCM 16/24/32, float 32/64): { sampleRate, channels, frames }. */
function read(file) {
  const h = info(file);
  const b = Buffer.alloc(h.dataBytes);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, b, 0, h.dataBytes, h.dataOffset); } finally { fs.closeSync(fd); }
  const bps = h.bits / 8;
  const chans = Array.from({ length: h.channels }, () => new Float32Array(h.frames));
  let o = 0;
  for (let i = 0; i < h.frames; i++) {
    for (let c = 0; c < h.channels; c++) {
      let v;
      if (h.tag === 3) v = h.bits === 64 ? b.readDoubleLE(o) : b.readFloatLE(o);
      else if (h.bits === 16) v = b.readInt16LE(o) / 32768;
      else if (h.bits === 24) v = b.readIntLE(o, 3) / 8388608;
      else if (h.bits === 32) v = b.readInt32LE(o) / 2147483648;
      else throw new Error(`${path.basename(file)}: ${h.bits}-bit audio isn't read here`);
      chans[c][i] = v;
      o += bps;
    }
  }
  return { sampleRate: h.sampleRate, channels: chans, frames: h.frames };
}

/** 32-bit float WAV bytes from channels (the format FLPT writes its music and one-shots in: no rounding). */
function encodeFloat(channels, sampleRate = SR) {
  const ch = channels.length;
  const n = channels[0].length;
  const bytes = n * ch * 4;
  const b = Buffer.alloc(44 + bytes);
  b.write('RIFF', 0); b.writeUInt32LE(36 + bytes, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(3, 20); b.writeUInt16LE(ch, 22);
  b.writeUInt32LE(sampleRate, 24); b.writeUInt32LE(sampleRate * ch * 4, 28); b.writeUInt16LE(ch * 4, 32); b.writeUInt16LE(32, 34);
  b.write('data', 36); b.writeUInt32LE(bytes, 40);
  const f = new Float32Array(b.buffer, b.byteOffset + 44, n * ch);
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) f[i * ch + c] = channels[c][i];
  return b;
}
function writeFloat(file, channels, sampleRate = SR) { fs.writeFileSync(file, encodeFloat(channels, sampleRate)); }

/** Decode any sound file to 48 kHz Float32Array channels through ffmpeg (stdout only, nothing written). */
async function decode(run, file, { channels = 2, startSample = 0, samples = null, signal } = {}) {
  const trim = `atrim=start_sample=${Math.max(0, Math.round(startSample))}${samples != null ? `:end_sample=${Math.round(startSample + samples)}` : ''}`;
  const layout = channels === 1 ? 'mono' : 'stereo';
  const r = await ff(run, ['-v', 'error', '-i', file, '-map', '0:a:0', '-af', `aresample=${SR},aformat=sample_fmts=flt:channel_layouts=${layout},${trim}`, '-f', 'f32le', '-'], { signal });
  const all = new Float32Array(r.out.buffer.slice(r.out.byteOffset, r.out.byteOffset + (r.out.length - (r.out.length % (4 * channels)))));
  const frames = all.length / channels;
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) out[c][i] = all[i * channels + c];
  return { sampleRate: SR, channels: out, frames };
}

const sha256 = (file) => `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;

// ── loudness in JS (BS.1770-4 at 48 kHz: K-weighting, 400 ms blocks, 100 ms hop, -70 / -10 LU gates) ──
// Used for the voice guard, which needs the bed's loudness only while the voice speaks (ffmpeg can't mask blocks).
// It agrees with ffmpeg's ebur128 within 0.05 LU (K4).
function kweight(x) {
  const y = new Float64Array(x.length);
  const s1 = [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585];
  const s2 = [1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621];
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, z1 = 0, z2 = 0, w1 = 0, w2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const a = s1[0] * v + s1[1] * x1 + s1[2] * x2 - s1[3] * y1 - s1[4] * y2; x2 = x1; x1 = v; y2 = y1; y1 = a;
    const b = s2[0] * a + s2[1] * z1 + s2[2] * z2 - s2[3] * w1 - s2[4] * w2; z2 = z1; z1 = a; w2 = w1; w1 = b;
    y[i] = b;
  }
  return y;
}
/** Per-block summed mean squares over the channels; block k covers [k·100 ms, k·100 ms + 400 ms). */
function blocks(channels) {
  const n = channels[0].length;
  const B = 0.4 * SR;
  const H = 0.1 * SR;
  const cs = channels.map((c) => { const k = kweight(c); const p = new Float64Array(n + 1); for (let i = 0; i < n; i++) p[i + 1] = p[i] + k[i] * k[i]; return p; });
  const z = [];
  for (let s = 0; s + B <= n; s += H) z.push(cs.reduce((acc, p) => acc + (p[s + B] - p[s]) / B, 0));
  return z;
}
const LK = (z) => -0.691 + 10 * Math.log10(z);
function integrated(z, mask) {
  const sel = z.filter((v, i) => (!mask || mask[i]) && LK(v) > -70);
  if (!sel.length) return -Infinity;
  const rel = LK(sel.reduce((a, b) => a + b, 0) / sel.length) - 10;
  const g = sel.filter((v) => LK(v) > rel);
  return LK(g.reduce((a, b) => a + b, 0) / g.length);
}
const blockLoud = (z) => z.map(LK);

// ── measuring with ffmpeg ───────────────────────────────────────────────────────────────────────
function summary(err) {
  const sum = err.slice(err.lastIndexOf('Summary:'));
  const num = (re) => { const m = sum.match(re); return m ? (m[1] === '-inf' ? -Infinity : Number(m[1])) : null; };
  return {
    I: num(/I:\s+(-?[\d.]+|-inf) LUFS/), LRA: num(/LRA:\s+(-?[\d.]+) LU/),
    TP: num(/True peak:\s+Peak:\s+(-?[\d.]+|-inf) dBFS/), samplePeak: num(/Sample peak:\s+Peak:\s+(-?[\d.]+|-inf) dBFS/),
  };
}
const EBU = 'ebur128=peak=true+sample:framelog=quiet';
/** ebur128's summary of a file: { I (LUFS), LRA (LU), TP (dBTP), samplePeak (dBFS) }. The acceptance meter (K4). */
async function measure(run, file, { signal } = {}) {
  return summary((await ff(run, ['-i', file, '-af', EBU, '-f', 'null', '-'], { signal })).err);
}
async function measureGraph(run, inputs, graph, label, signal) {
  return summary((await ff(run, [...inputs, '-filter_complex', `${graph};[${label}]${EBU}[mm]`, '-map', '[mm]', '-f', 'null', '-'], { signal })).err);
}

// ── the graphs (pure; exported for the tests) ────────────────────────────────────────────────────
/** Fades that fit: 1.0 s in and 1.8 s out, shortened for a piece under about 3 s. */
function fades(N) {
  const sec = N / SR;
  return { fadeIn: Math.min(BED.fadeIn, sec / 3), fadeOut: Math.min(BED.fadeOut, sec / 2) };
}
const ACONF = `aresample=${SR},aformat=sample_fmts=fltp:channel_layouts=stereo`;
function musicChain(input, N) {
  const { fadeIn, fadeOut } = fades(N);
  return `[${input}:a]${ACONF},atrim=end_sample=${N},asetpts=PTS-STARTPTS,`
    + `afade=t=in:st=0:d=${f3(fadeIn)},afade=t=out:st=${f6(N / SR - fadeOut)}:d=${f3(fadeOut)}`;
}
/** One chain per hit, so its anchor lands exactly on round(t·48000); mute keeps the graph with silent hits (a twin). */
function sfxChains(sfx, firstInput, mute, cutDb = 0) {
  return sfx.map((h, i) => {
    const d = Math.round(h.t * SR) - (h.anchor || 0);
    const place = d >= 0 ? `adelay=delays=${d}S:all=1` : `atrim=start_sample=${-d},asetpts=PTS-STARTPTS`;
    const db = (h.gainDb || 0) - cutDb;
    const gain = mute ? ',volume=0' : (db ? `,volume=${f3(db)}dB` : '');
    return `[${firstInput + i}:a]${ACONF}${gain},${place},apad[s${i}]`;
  });
}
const mixSfx = (head, sfx, N) => `${head}${sfx.map((_, i) => `[s${i}]`).join('')}amix=inputs=${sfx.length + 1}:normalize=0:duration=longest:dropout_transition=0,atrim=end_sample=${N}`;
const trimExact = (N) => `atrim=end_sample=${N},apad=whole_len=${N},asetpts=PTS-STARTPTS`;
const limiter = (dbfs, attack = 5, release = 60) => `alimiter=limit=${Math.pow(10, dbfs / 20).toFixed(5)}:attack=${attack}:release=${release}:level=disabled:latency=1`;
const SILENCE = `anullsrc=r=${SR}:cl=stereo`;
const ENC = ['-ar', String(SR), '-ac', '2', '-c:a', 'pcm_s24le'];

/**
 * The bed's graph. Inputs: 0 the music (when hasMusic), 1 the narration (when it keys the duck: music and a voice),
 * then one per hit. Outputs [out] (the stem), [pre] (the bed before the duck) and [dk] (the ducked bed alone), each
 * exactly N samples.
 */
function bedGraph({ N, gainDb = 0, lead = 0, sfx = [], duck = DUCK, mute = false, limitDbfs = BED.limitDbfs, sfxCutDb = 0, hasMusic = true, hasVoice = true }) {
  const d = { ...DUCK, ...(duck || {}) };
  const off = Math.round(lead * SR);
  const keyed = hasMusic && hasVoice;
  const g = [];
  if (!hasMusic) {
    g.push(`${SILENCE},asplit=3[duck][bedpre][duckout]`);
  } else if (!keyed) {
    g.push(`${musicChain(0, N)},volume=${f3(gainDb)}dB,apad,asplit=3[duck][bedpre][duckout]`);
  } else {
    const shift = off >= 0 ? `adelay=delays=${off}S:all=1` : `atrim=start_sample=${-off},asetpts=PTS-STARTPTS`;
    g.push(`${musicChain(0, N)},volume=${f3(gainDb)}dB,apad,asplit=2[bed][bedpre]`);
    // the key: the narration where it plays in the piece, high-passed, then companded to one flat level while it speaks
    g.push(`[1:a]${ACONF},${shift},apad,highpass=f=${d.highpass},`
      + `compand=attacks=0.005:decays=${d.keyDecay}:points=-90/-90|${d.gateDb - 4}/-90|${d.gateDb}/${d.keyDb}|0/${d.keyDb}:soft-knee=1:gain=0:volume=-90:delay=0[key]`);
    g.push(`[bed][key]sidechaincompress=threshold=${d.threshold}:ratio=${d.ratio}:attack=${d.attack}:release=${d.release}:knee=${d.knee}:makeup=1:detection=rms:link=maximum,atrim=end_sample=${N},apad,asplit=2[duck][duckout]`);
  }
  g.push(...sfxChains(sfx, (hasMusic ? 1 : 0) + (keyed ? 1 : 0), mute, sfxCutDb));
  g.push(`${mixSfx('[duck]', sfx, N)},${limiter(limitDbfs)},${trimExact(N)}[out]`);
  g.push(`[bedpre]${trimExact(N)}[pre]`, `[duckout]${trimExact(N)}[dk]`);
  return g.join(';');
}

/** The interstitial's graph before levelling: [mix] = music (0) with fades + hits; then volume (+ a limiter) → [out]. */
function interGraph({ N, sfx = [], mute = false, gainDb = 0, limitDbfs = null, hasMusic = true }) {
  const pre = [hasMusic ? `${musicChain(0, N)},apad[mus]` : `${SILENCE}[mus]`, ...sfxChains(sfx, hasMusic ? 1 : 0, mute), `${mixSfx('[mus]', sfx, N)}[mix]`].join(';');
  const tail = limitDbfs == null ? '' : `,${limiter(limitDbfs, 2, 50)}`;
  return { pre, full: `${pre};[mix]volume=${f3(gainDb)}dB${tail},${trimExact(N)}[out]` };
}

// ── the stems ───────────────────────────────────────────────────────────────────────────────────
function musicInputs(music, N) {
  if (!music) return [];
  let short = false;
  try { short = info(music).frames < N; } catch { /* not a WAV: played as it is */ }
  return [...(short ? ['-stream_loop', '-1'] : []), '-i', music]; // a hard loop, sample-continuous (K4)
}
const sfxInputs = (sfx) => sfx.flatMap((h) => ['-i', h.file]);

/** The narration's samples at 48 kHz (its own channels, as ebur128 counts them). */
async function voicePcm(run, file, signal) {
  try { const w = read(file); if (w.sampleRate === SR) return w.channels; } catch { /* not a plain WAV: decode it */ }
  return (await decode(run, file, { channels: 1, signal })).channels;
}

/**
 * The stem under a narrated piece.
 * { run, music (WAV path or null), voice (narration WAV or null), lead (s: where the narration starts in the piece),
 *   frames, sfx: [{ file, t, anchor, gainDb }], out, work (a scratch folder inside the score folder), twin, keep, signal }
 * → { kind: 'bed', N, gainDb, guard, underVoiceLU, voiceI, check, wav, limitDbfs, files }
 */
async function bedStem({ run, music = null, voice = null, lead = 0, frames, sfx = [], out, work, duck = null, twin = false, keep = false, signal }) {
  const N = frames * SPF;
  if (!(N > 0)) throw new Error('A stem needs at least one frame.');
  work = work || path.join(path.dirname(out), 'work');
  fs.mkdirSync(work, { recursive: true });
  const hasMusic = Boolean(music);
  const hasVoice = Boolean(voice);
  const minput = musicInputs(music, N);
  let gain = 0;
  let musicI = null;
  if (hasMusic) {
    musicI = (await measureGraph(run, minput, `${musicChain(0, N)}[m]`, 'm', signal)).I;
    gain = Number.isFinite(musicI) ? BED.lufs - musicI : 0;
  }
  const inputs = [...minput, ...(hasMusic && hasVoice ? ['-i', voice] : []), ...sfxInputs(sfx)];
  const files = { pre: keep ? path.join(work, 'pre.wav') : null, ducked: path.join(work, 'ducked.wav'), twin: twin ? path.join(work, 'twin.wav') : null };
  const opt = { N, lead, sfx, duck, hasMusic, hasVoice };
  const render = (g, cut, limitDbfs, mute = false, target = out) => ff(run, ['-y', ...inputs, '-filter_complex', bedGraph({ ...opt, gainDb: g, sfxCutDb: cut, limitDbfs, mute }),
    '-map', '[out]', ...ENC, target, '-map', '[pre]', ...(files.pre && !mute ? [...ENC, files.pre] : ['-f', 'null', '-']), '-map', '[dk]', ...(mute ? ['-f', 'null', '-'] : [...ENC, files.ducked])], { signal });

  // The voice: its loudness and, block by block, where it speaks (blocks within 12 LU of its own level).
  let vI = null;
  let voiced = null;
  if (hasVoice) {
    const zv = blocks(await voicePcm(run, voice, signal));
    vI = integrated(zv);
    const lv = blockLoud(zv);
    const shift = Math.round(lead / 0.1);
    voiced = (n) => Array.from({ length: n }, (_, i) => { const v = lv[i - shift]; return v != null && v > vI - 12 && v > -50; });
  }
  const margin = () => {
    if (!hasVoice || !hasMusic || !Number.isFinite(vI)) return null;
    const z = blocks(read(files.ducked).channels);
    return vI - integrated(z, voiced(z.length));
  };

  let cut = 0;
  let guard = null;
  let limitDbfs = BED.limitDbfs;
  if (!hasMusic && hasVoice && Number.isFinite(vI) && vI < VOICE_REF) {
    cut = VOICE_REF - vI; // no bed to measure: the sound effects step down with a quiet voice
    guard = { before: null, cutDb: +cut.toFixed(2), voiceI: +vI.toFixed(2) };
  }
  await render(gain, cut, limitDbfs);
  let under = margin();
  if (under != null && under < BED.underVoice) {
    cut = BED.underVoice + 0.5 - under;
    guard = { before: +under.toFixed(2), cutDb: +cut.toFixed(2), voiceI: +vI.toFixed(2) };
    gain -= cut;
    await render(gain, cut, limitDbfs);
    under = margin();
  }
  let check = await measure(run, out, { signal });
  for (let pass = 0; pass < 2 && check.TP != null && check.TP > BED.tp; pass++) {
    limitDbfs -= check.TP - BED.tp + 0.1; // a peak got over: limit lower
    await render(gain, cut, limitDbfs);
    check = await measure(run, out, { signal });
  }
  if (twin) await render(gain, cut, limitDbfs, true, files.twin);
  if (!keep) fs.rmSync(files.ducked, { force: true });
  return {
    kind: 'bed', N, frames, gainDb: +gain.toFixed(3), musicI, voiceI: vI == null ? null : +vI.toFixed(2), underVoiceLU: under == null ? null : +under.toFixed(2),
    guard, limitDbfs: +limitDbfs.toFixed(2), check, wav: info(out), files: { ...files, ducked: keep ? files.ducked : null },
  };
}

/**
 * The stem of an unnarrated piece: -21 LUFS, true peak ≤ -2 dBTP. Measured with ebur128, levelled with volume; a
 * limiter (and a re-trim of the gain) only when the gain would push a peak over -2 dBTP, at most 3 passes. With no
 * music the sound effects keep their own level (a few clicks brought to -21 LUFS would be deafening).
 * { run, music, frames, sfx, out, twin, signal } → { kind: 'interstitial', N, gainDb, limitDbfs, mode, passes, check, wav, files }
 */
async function interstitialStem({ run, music = null, frames, sfx = [], out, work, twin = false, signal }) {
  const N = frames * SPF;
  if (!(N > 0)) throw new Error('A stem needs at least one frame.');
  work = work || path.join(path.dirname(out), 'work');
  fs.mkdirSync(work, { recursive: true });
  const hasMusic = Boolean(music);
  const inputs = [...musicInputs(music, N), ...sfxInputs(sfx)];
  const files = { twin: twin ? path.join(work, 'twin.wav') : null };
  const graph = (o) => interGraph({ N, sfx, hasMusic, ...o });
  let gain = 0;
  let limit = hasMusic ? null : BED.limitDbfs;
  let pass1 = null;
  if (hasMusic) {
    pass1 = await measureGraph(run, inputs, graph({}).pre, 'mix', signal);
    gain = Number.isFinite(pass1.I) ? INTER.I - pass1.I : 0;
  }
  let check = null;
  let passes = 1;
  for (; passes <= 3; passes++) {
    await ff(run, ['-y', ...inputs, '-filter_complex', graph({ gainDb: gain, limitDbfs: limit }).full, '-map', '[out]', ...ENC, out], { signal });
    check = await measure(run, out, { signal });
    if (check.TP != null && check.TP > INTER.TP) { limit = (limit == null ? INTER.TP - 0.5 : limit) - (check.TP - INTER.TP) - 0.1; continue; } // peaks: limit lower
    if (hasMusic && limit != null && Number.isFinite(check.I) && Math.abs(check.I - INTER.I) > 0.1) { gain += INTER.I - check.I; continue; } // the limiter cost loudness
    break;
  }
  passes = Math.min(passes, 3);
  if (twin) await ff(run, ['-y', ...inputs, '-filter_complex', graph({ gainDb: gain, limitDbfs: limit, mute: true }).full, '-map', '[out]', ...ENC, files.twin], { signal });
  return { kind: 'interstitial', N, frames, pass1, gainDb: +gain.toFixed(3), limitDbfs: limit == null ? null : +limit.toFixed(2), mode: limit == null ? 'linear' : 'limited', passes, check, wav: info(out), files };
}

/**
 * Is this stem fit to use? Exactly frames × 1600 samples, 48 kHz, stereo; true peak ≤ -2 dBTP; an interstitial with
 * music at -21 ± 0.5 LUFS. → { ok, problems: [string], samples, lufs, tpDb }
 */
async function stemOk(run, file, { frames, level = 'bed', music = true, signal } = {}) {
  const problems = [];
  let h = null;
  try { h = info(file); } catch (e) { return { ok: false, problems: [e.message], samples: 0, lufs: null, tpDb: null }; }
  if (h.sampleRate !== SR) problems.push(`it runs at ${h.sampleRate} Hz, not ${SR}`);
  if (h.channels !== 2) problems.push(`it has ${h.channels} channel${h.channels === 1 ? '' : 's'}, not 2`);
  if (frames != null && h.frames !== frames * SPF) problems.push(`it is ${h.frames} samples long, not ${frames * SPF} (${frames} frames)`);
  let m = { I: null, TP: null };
  try { m = await measure(run, file, { signal }); } catch (e) { problems.push(e.message); }
  if (m.TP != null && m.TP > BED.tp) problems.push(`its true peak is ${m.TP} dBTP, over ${BED.tp}`);
  if (level === 'interstitial' && music && m.I != null && Math.abs(m.I - INTER.I) > INTER.tol) problems.push(`it is ${m.I} LUFS, not ${INTER.I} ± ${INTER.tol}`);
  return { ok: problems.length === 0, problems, samples: h.frames, lufs: m.I, tpDb: m.TP };
}

/** ffmpeg arguments that put a stem under a silent render: the picture copied, the sound AAC 192k (PLAN §2.6). */
function muxArgs({ video, stem, out }) {
  return ['-y', '-v', 'error', '-i', video, '-i', stem, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', out];
}

module.exports = {
  SR, FPS, SPF, BED, INTER, DUCK, SFX_LEVEL, VOICE_REF,
  runner, measure, stemOk, bedStem, interstitialStem, muxArgs, decode, sha256,
  wav: { info, read, encodeFloat, writeFloat },
  loudness: { blocks, integrated, blockLoud },
  graphs: { bedGraph, interGraph, musicChain, sfxChains, fades },
};
