'use strict';
// The cartoon presenter's voices to pick from, and a free sample of each (W3-05; decisions.md "W3-05 voices"). GETs
// only, with the user's own key, in the main process: nothing here spends money, logs a key or returns one.
//   say         the Mac's own voices (`say -v ?`, English ones); a sample is said here with `say` (local, free)
//   heygen      the user's HeyGen voices (heygen.js); a sample is HeyGen's own preview
//   elevenlabs  GET /v1/voices (the user's clones first); a sample is the voice's preview_url, else the first recording
//               it was made from (GET /v1/voices/{id}/samples/{sample}/audio)
//   fish        GET /model?self=true (the user's voice models); a sample is the model's first samples[].audio
// QA (FLPT_QA with a loopback FLPT_QA_API_BASE) sends ElevenLabs and Fish.audio to FLPT's stand-in.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const heygen = require('./heygen');

const BASES = { elevenlabs: 'https://api.elevenlabs.io', fish: 'https://api.fish.audio' };
const ID_RE = /^[A-Za-z0-9_\-.:]{1,128}$/;
const MAX_SAMPLE = 10 * 1024 * 1024;
const SAMPLE_LINE = 'Hello. This is how I sound when I present your talk.';

/** The APIs' origins: the real ones, or (QA only) FLPT's loopback stand-in. */
function bases(env = process.env) {
  const b = env.FLPT_QA && /^http:\/\/127\.0\.0\.1:\d{2,5}\/?$/.test(env.FLPT_QA_API_BASE || '') ? env.FLPT_QA_API_BASE.replace(/\/$/, '') : null;
  return b ? { elevenlabs: `${b}/elevenlabs`, fish: `${b}/fish` } : { ...BASES };
}
const okUrl = (u, env) => {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' || (bases(env).fish !== BASES.fish && x.protocol === 'http:' && x.hostname === '127.0.0.1');
  } catch { return false; }
};

async function getJson(fetchImpl, url, headers) {
  const res = await fetchImpl(url, { headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(20000) });
  if (res.status === 401 || res.status === 403) throw new Error('The key wasn\'t accepted.');
  if (!res.ok) throw new Error(`Unexpected reply (HTTP ${res.status}).`);
  return res.json();
}

/** The Mac's English voices: [{ id, name, language }] (`say -v ?`). */
function macVoices(run = (cb) => execFile('/usr/bin/say', ['-v', '?'], { timeout: 15000 }, cb)) {
  return new Promise((resolve) => run((err, out) => {
    if (err) { resolve([]); return; }
    const voices = [];
    for (const line of String(out).split('\n')) {
      const m = /^(.+?)\s{2,}([a-z]{2}_[A-Z]{2}|[a-z]{2}-[A-Z]{2})\s+#/.exec(line);
      if (m && /^en[_-]/.test(m[2]) && /^[\p{L}\p{N} ()._'-]{1,64}$/u.test(m[1].trim())) voices.push({ id: m[1].trim(), name: m[1].trim(), language: m[2] });
    }
    resolve(voices);
  }));
}

/** The user's ElevenLabs voices (clones and designs first): [{ id, name, sample, category }]. */
async function elevenVoices(key, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const j = await getJson(fetchImpl, `${bases(env).elevenlabs}/v1/voices`, { 'xi-api-key': key });
  const mine = (v) => ['cloned', 'generated', 'professional'].includes(v.category);
  return (Array.isArray(j.voices) ? j.voices : [])
    .filter((v) => v && ID_RE.test(String(v.voice_id)))
    .map((v) => ({ id: String(v.voice_id), name: String(v.name || 'Untitled voice').slice(0, 120), category: v.category || null,
      sample: Boolean(v.preview_url || (Array.isArray(v.samples) && v.samples.length)) }))
    .sort((a, b) => Number(mine(b)) - Number(mine(a)));
}

/** The user's Fish.audio voice models: [{ id, name, sample }]. */
async function fishVoices(key, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const j = await getJson(fetchImpl, `${bases(env).fish}/model?self=true&page_size=100`, { Authorization: `Bearer ${key}` });
  return (Array.isArray(j.items) ? j.items : [])
    .filter((m) => m && ID_RE.test(String(m._id)) && m.state !== 'failed')
    .map((m) => ({ id: String(m._id), name: String(m.title || 'Untitled voice').slice(0, 120), sample: Array.isArray(m.samples) && m.samples.length > 0 }));
}

/** Where a voice's free sample can be fetched from: { url, headers } or null. */
async function sampleSource(provider, id, key, { fetchImpl = globalThis.fetch, env = process.env, known = new Map() } = {}) {
  if (!ID_RE.test(String(id))) return null;
  if (provider === 'heygen') {
    const v = known.get(id) || (key ? await heygen.voice(key, id, fetchImpl).catch(() => null) : null);
    return v && v.preview ? { url: v.preview, headers: {} } : null;
  }
  if (provider === 'elevenlabs') {
    const b = bases(env).elevenlabs;
    const v = await getJson(fetchImpl, `${b}/v1/voices/${encodeURIComponent(id)}`, { 'xi-api-key': key });
    if (typeof v.preview_url === 'string' && v.preview_url) return { url: v.preview_url, headers: {} };
    const s = Array.isArray(v.samples) && v.samples.find((x) => x && ID_RE.test(String(x.sample_id)));
    return s ? { url: `${b}/v1/voices/${encodeURIComponent(id)}/samples/${encodeURIComponent(s.sample_id)}/audio`, headers: { 'xi-api-key': key } } : null;
  }
  if (provider === 'fish') {
    const m = await getJson(fetchImpl, `${bases(env).fish}/model/${encodeURIComponent(id)}`, { Authorization: `Bearer ${key}` });
    const s = Array.isArray(m.samples) && m.samples.find((x) => x && typeof x.audio === 'string' && x.audio);
    return s ? { url: s.audio, headers: {} } : null;
  }
  return null;
}

const extOf = (type, url) => (/wav/.test(type) || /\.wav(\?|$)/i.test(url) ? '.wav' : /mp4|m4a|aac/.test(type) || /\.m4a(\?|$)/i.test(url) ? '.m4a' : /ogg|opus/.test(type) ? '.ogg' : '.mp3');

/**
 * A free sample of one voice, saved in `dir` (reused when it's there): the file's path. The Mac's is said here; the
 * others are the providers' own recordings, fetched with a GET (never a synthesis: that would cost).
 */
async function sample(provider, id, { dir, key = null, fetchImpl = globalThis.fetch, env = process.env, known = new Map(), say = '/usr/bin/say' } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `${provider}-${String(id || 'default').replace(/[^\w.-]/g, '_').slice(0, 80)}`);
  if (provider === 'say') {
    const file = `${base}.wav`;
    if (fs.existsSync(file)) return file;
    if (id && !/^[\p{L}\p{N} ()._'-]{1,64}$/u.test(id)) throw new Error('That isn\'t a Mac voice.');
    await new Promise((resolve, reject) => execFile(say, [...(id ? ['-v', id] : []), '-o', `${file}.tmp.wav`, '--file-format=WAVE', '--data-format=LEI16@22050', SAMPLE_LINE],
      { timeout: 30000 }, (err) => (err ? reject(new Error('The Mac couldn\'t say it with that voice.')) : resolve())));
    fs.renameSync(`${file}.tmp.wav`, file);
    return file;
  }
  for (const ext of ['.mp3', '.wav', '.m4a', '.ogg']) if (fs.existsSync(base + ext)) return base + ext;
  const src = await sampleSource(provider, id, key, { fetchImpl, env, known });
  if (!src || !okUrl(src.url, env)) throw new Error('There\'s no sample of this voice.');
  const res = await fetchImpl(src.url, { headers: src.headers, signal: AbortSignal.timeout(20000) });
  const buf = res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  if (!buf || !buf.length || buf.length > MAX_SAMPLE) throw new Error('The sample didn\'t download.');
  const file = base + extOf(String(res.headers.get('content-type') || ''), src.url);
  fs.writeFileSync(file, buf);
  return file;
}

module.exports = { BASES, bases, macVoices, elevenVoices, fishVoices, sampleSource, sample, SAMPLE_LINE };
