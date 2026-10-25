'use strict';
// The generation providers, routed by settings.providers (Michael, 2026-10-12: Kie.ai and Higgsfield by default;
// OpenArt only as the opt-in "film quality" lane, not wired yet). Video and stills each go to the provider the
// settings name; cut-outs (background removal) always go to Kie.ai, because Higgsfield's API has none.
// Also here: every paid piece priced in the broker's terms (B-roll; and a whole Cosmos cartoon or cut scene, as the
// Scenes step makes it, from scenes.recipe).
// Clients hold the user's key in the main process only; nothing here returns a key.
const { createKie, NAME: KIE } = require('./kie');
const { createHiggsfield, NAME: HIGGSFIELD } = require('./higgsfield');
const { ProviderError, isLoopback } = require('./http');
const { estimate } = require('../broker');
const scenes = require('../scenes');

const PROVIDERS = {
  kie: { id: 'kie', name: KIE, key: 'KIE_API_KEY', video: 'Seedance 2.5', still: 'Nano Banana Pro', cutout: true },
  higgsfield: { id: 'higgsfield', name: HIGGSFIELD, key: 'HIGGSFIELD_CREDENTIALS', video: 'Seedance 2.5', still: 'Grok Imagine Image 2.0', cutout: false },
};
const IDS = Object.keys(PROVIDERS);

const info = (id) => PROVIDERS[id] || null;

/** Which provider does this kind of work: 'video' and 'stills' follow the settings; 'cutout' is always Kie.ai. */
function route(settings, what) {
  const p = (settings && settings.providers) || {};
  if (what === 'cutout') return 'kie';
  const choice = what === 'stills' ? p.stills : p.video;
  return IDS.includes(choice) ? choice : 'kie';
}

const missingKey = (id) => `Add a ${(info(id) || { name: id }).name} key in Setup → Keys`;

/**
 * QA only: point the clients at a local stand-in (app/qa/gen-standin.mjs). FLPT_QA_API_BASE is ignored unless
 * FLPT_QA is set, and only a loopback http(s) address is accepted, so a stray variable can never send a key elsewhere.
 */
function qaBases(env = process.env) {
  if (!env.FLPT_QA || !env.FLPT_QA_API_BASE) return null;
  let u;
  try { u = new URL(env.FLPT_QA_API_BASE); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || !isLoopback(u.hostname)) return null;
  const root = u.origin + u.pathname.replace(/\/+$/, '');
  return { kie: { base: `${root}/kie`, uploadBase: `${root}/kie-upload` }, higgsfield: { base: `${root}/higgsfield` }, elevenlabs: { base: `${root}/elevenlabs` } };
}

/**
 * A client for one provider, with the user's key from the vault. Throws "Add a Kie.ai key in Setup → Keys" (kind
 * nokey) when there's none.
 * @param {string} id      'kie' | 'higgsfield'
 * @param {object} deps    { vault, fetch, redact, bases (qaBases()), sleep, now, timeouts }
 */
function client(id, { vault, fetch: fetchImpl, redact, bases = null, sleep, now, timeouts } = {}) {
  const p = info(id);
  if (!p) throw new ProviderError('FLPT doesn\'t know that provider.', { kind: 'invalid' });
  const key = vault.get(p.key);
  if (!key) throw new ProviderError(missingKey(id), { kind: 'nokey', provider: id });
  const common = { fetch: fetchImpl, redact, sleep, now, timeouts, ...((bases && bases[id]) || {}) };
  for (const k of Object.keys(common)) if (common[k] === undefined) delete common[k];
  return id === 'kie' ? createKie({ key, ...common }) : createHiggsfield({ credentials: key, ...common });
}

const hasKey = (vault, id) => Boolean(info(id) && vault.status()[info(id).key] && vault.status()[info(id).key].set);

// ── prices, in the broker's terms ─────────────────────────────────────────────────────────────────────────────
const RESOLUTIONS = ['480p', '720p', '1080p'];
const res = (r) => (RESOLUTIONS.includes(r) ? r : '720p');

/** One estimate line for a Seedance shot. unitUsd: the provider's own quote per second, when it gave one. */
function videoLine(provider, { seconds, resolution = '720p', label, unitUsd } = {}) {
  const line = { rate: `${provider}_seedance_${res(resolution)}_s`, qty: Math.max(0, Number(seconds) || 0), label };
  if (unitUsd != null) line.unitUsd = unitUsd;
  return line;
}

/** One B-roll shot. quote: { usd } from the provider's own estimate (Higgsfield), replacing the table price. */
function estimateBroll({ provider = 'kie', duration = 5, resolution = '720p', quote = null } = {}) {
  const seconds = Math.max(4, Math.min(30, Math.round(Number(duration) || 5)));
  const unitUsd = quote && Number.isFinite(Number(quote.usd)) ? Number(quote.usd) / seconds : undefined;
  return estimate([videoLine(provider, { seconds, resolution, unitUsd, label: `One ${seconds} s ${res(resolution)} B-roll shot (${(info(provider) || {}).video || 'Seedance'})` })]);
}

/**
 * A Cosmos cartoon as the Scenes step makes it (scenes.recipe; the method's recipe in hyperframes-slides.md,
 * "Cartoon slides"): the episode's style frame, 4–6 painted keyframes and one 5 s hero shot from a keyframe (on
 * Kie.ai a 480p draft to check the motion, finished at 1080p as the same take). Re-rolls are priced one by one.
 */
function estimateCartoon({ stills = 'kie', video = 'kie', keyframes = 4, hero = true, style = true } = {}) {
  return scenes.recipe('cartoon', { stills, video, keyframes: Math.max(2, Math.min(6, Math.round(keyframes))), hero, style });
}

/**
 * A cut scene as the Scenes step makes it (cutscenes.md): a location plate, a start frame per shot, and 2–4 shots of
 * 4–10 s (on Kie.ai 480p drafts finished at 1080p as the same takes). Re-rolls are priced one by one.
 */
function estimateCutscene({ stills = 'kie', video = 'kie', shots = 2, secondsPerShot = 4 } = {}) {
  const n = Math.max(1, Math.min(4, Math.round(shots)));
  const s = Math.max(4, Math.min(10, Math.round(secondsPerShot)));
  return scenes.recipe('cutscene', { stills, video, shots: Array(n).fill(s) });
}

module.exports = { PROVIDERS, IDS, info, route, missingKey, qaBases, client, hasKey, estimateBroll, estimateCartoon, estimateCutscene, videoLine };
