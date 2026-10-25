'use strict';
// The user's HeyGen voices, for the Presenter step: read in the main process with their key (GET only, free). The twin
// takes a look and its voice (presenterChoice); a cartoon presenter takes a voice alone (voiceOnly, W3-05).
//   - Every look carries default_voice_id: the voice HeyGen linked to it (a Digital Twin's is cloned from its footage).
//     Picking a look picks that voice; the user can change it.
//   - A voice speaks only through one of its available_engines (HeyGen refuses any other since 2026-10). Only the
//     voice list says which (GET /v3/voices; GET /v3/voices/{id} doesn't), so the engine comes from there.
//   - preview_audio_url is HeyGen's own short sample of a voice: free to play.
const API = 'https://api.heygen.com';
// The house voice first (natural delivery, keeps [short pause] and audio tags), then HeyGen's own engines.
const ENGINES = ['elevenlabs_v3', 'starfish', 'orca', 'elevenlabs'];
const ID_RE = /^[A-Za-z0-9_\-.:]{1,128}$/;

async function getJson(fetchImpl, key, pathQuery) {
  const res = await fetchImpl(API + pathQuery, { headers: { 'X-Api-Key': key, accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'HeyGen didn\'t accept the key.' : `HeyGen answered ${res.status}.`);
  return res.json();
}

const shape = (v) => ({
  id: String(v.voice_id), name: String(v.name || 'Untitled voice'), language: v.language || null, gender: v.gender || null,
  preview: typeof v.preview_audio_url === 'string' && /^https:\/\//.test(v.preview_audio_url) ? v.preview_audio_url : null,
  engines: Array.isArray(v.available_engines) ? v.available_engines.filter((e) => ENGINES.includes(e)) : null,
  defaultEngine: ENGINES.includes(v.default_engine) ? v.default_engine : null,
  private: v.type === 'private' || null,
});

/** The user's own (private, cloned) voices, every page. */
async function privateVoices(key, fetchImpl = globalThis.fetch) {
  const out = [];
  let token = null;
  for (let page = 0; page < 10; page++) {
    const j = await getJson(fetchImpl, key, `/v3/voices?type=private&limit=100${token ? `&token=${encodeURIComponent(token)}` : ''}`);
    for (const v of j.data || []) if (v && v.voice_id && ID_RE.test(String(v.voice_id))) out.push({ ...shape(v), private: true });
    token = j.next_token;
    if (!j.has_more || !token) break;
  }
  return out;
}

/** One voice by id (a look's linked voice may be a public one): its name and preview, but not its engines. */
async function voice(key, id, fetchImpl = globalThis.fetch) {
  if (!ID_RE.test(String(id))) throw new Error('That isn\'t a HeyGen voice id.');
  const d = (await getJson(fetchImpl, key, `/v3/voices/${encodeURIComponent(id)}`)).data || {};
  return { ...shape({ ...d, voice_id: d.voice_id || id }), engines: null, status: d.status || null };
}

/**
 * The speech engine to use with a voice: the house engine when the voice has it, else its own default, else HeyGen's
 * starfish, else whatever it has. Unknown engines (a public voice) → starfish, the engine every voice speaks with by
 * default. null when the voice can't speak at all.
 */
function pickEngine(v) {
  const avail = v && Array.isArray(v.engines) ? v.engines : null;
  if (!avail) return 'starfish';
  if (!avail.length) return null;
  if (avail.includes(ENGINES[0])) return ENGINES[0];
  if (v.defaultEngine && avail.includes(v.defaultEngine)) return v.defaultEngine;
  return ENGINES.find((e) => avail.includes(e)) || null;
}

/**
 * The voices to offer: the user's own, plus the looks' linked voices that aren't among them (looked up one by one).
 * A lookup that fails is skipped: the list still works.
 */
async function voicesFor(key, linkedIds = [], fetchImpl = globalThis.fetch) {
  const mine = await privateVoices(key, fetchImpl);
  const have = new Set(mine.map((v) => v.id));
  const extra = [];
  for (const id of [...new Set(linkedIds.filter((x) => x && ID_RE.test(String(x))))]) {
    if (have.has(id)) continue;
    try { extra.push(await voice(key, id, fetchImpl)); } catch { /* skip it */ }
  }
  return [...mine, ...extra];
}

/**
 * Is the presenter's voice still able to speak with its engine? (Plans and vendors change.) Only the user's own voices
 * list their engines, so a public voice can't be checked here: { ok: null }.
 */
async function checkEngine(key, voiceId, engine, fetchImpl = globalThis.fetch) {
  const v = (await privateVoices(key, fetchImpl)).find((x) => x.id === voiceId);
  if (!v || !v.engines) return { ok: null };
  return v.engines.includes(engine) ? { ok: true, voice: v.name } : { ok: false, voice: v.name, engines: v.engines };
}

/**
 * What the Presenter step saves when the user picks a look (and maybe a voice): presenter.env values and the settings
 * record, or an error to show. `current` is today's presenter.env; `known` the voices the step last listed (id → voice);
 * `lookup(id)` fetches a voice that isn't among them (null when it can't).
 */
async function presenterChoice({ lookId, twin, name, voiceId }, { current = {}, currentVoiceName = '', known = new Map(), lookup = async () => null }) {
  if (typeof lookId !== 'string' || !ID_RE.test(lookId)) return { ok: false, error: 'Pick a look.' };
  const id = typeof voiceId === 'string' && ID_RE.test(voiceId) ? voiceId : current.HEYGEN_VOICE_ID || '';
  if (!id) return { ok: false, error: 'This look has no voice yet. Add one in HeyGen, then show your looks again.' };
  const v = known.get(id) || (await lookup(id).catch(() => null));
  // Kept as it was when HeyGen can't be asked about an unchanged voice; otherwise one the voice can speak with.
  const engine = v ? pickEngine(v) : (id === current.HEYGEN_VOICE_ID && current.HEYGEN_VOICE_ENGINE) || 'starfish';
  if (!engine) return { ok: false, error: 'HeyGen can\'t speak with this voice on your plan. Pick another voice.' };
  const characterType = twin ? 'avatar' : 'talking_photo';
  return {
    ok: true,
    env: { HEYGEN_AVATAR_ID: lookId, HEYGEN_CHARACTER_TYPE: characterType, HEYGEN_VOICE_ID: id, HEYGEN_VOICE_ENGINE: engine },
    presenter: { lookId, lookName: name || '', voiceId: id, voiceName: (v && v.name) || (id === current.HEYGEN_VOICE_ID ? currentVoiceName : '') || '', engine, characterType },
  };
}

/**
 * A HeyGen voice for the cartoon presenter (W3-05): narration only, no look. → { ok, voice: { provider: 'heygen', id, name,
 * engine } } with the engine the voice can speak with, or { ok: false, error }. `known`/`lookup` as presenterChoice's.
 */
async function voiceOnly({ voiceId }, { known = new Map(), lookup = async () => null } = {}) {
  if (typeof voiceId !== 'string' || !ID_RE.test(voiceId)) return { ok: false, error: 'Pick a voice.' };
  const v = known.get(voiceId) || (await lookup(voiceId).catch(() => null));
  const engine = v ? pickEngine(v) : 'starfish';
  if (!engine) return { ok: false, error: 'HeyGen can\'t speak with this voice on your plan. Pick another voice.' };
  return { ok: true, voice: { provider: 'heygen', id: voiceId, name: (v && v.name) || '', engine } };
}

module.exports = { privateVoices, voice, voicesFor, pickEngine, checkEngine, presenterChoice, voiceOnly, ENGINES, ID_RE };
