'use strict';
// ElevenLabs Speech to Text (Scribe v2), for cutting laughs: Refine's tightening needs Scribe's word timings with its
// audio events ("(laughs)"), which the free word timings don't have (elevenlabs.io/docs/api-reference/speech-to-text):
//   POST /v1/speech-to-text, multipart: model_id, file, tag_audio_events, timestamps_granularity=word, diarize
//   → 200 { language_code, text, words: [{ text, start, end, type: word | spacing | audio_event }] }
// Paid: 0.22 US dollars an hour of sound (elevenlabs.io/pricing/api, 2026-10), so it's sent once and never repeated:
// a reply that never came may have been billed, and is reported as such. Main process only; the key goes in the
// xi-api-key header and nowhere else, and nothing here logs or returns it.
const fs = require('fs');
const path = require('path');
const { ProviderError, scrubber, requestJson } = require('./http');

const ID = 'elevenlabs';
const NAME = 'ElevenLabs';
const BASE = 'https://api.elevenlabs.io';
const MODEL = 'scribe_v2';
const USD_PER_HOUR = 0.22;
const MAX_BYTES = 1 << 30;

/**
 * @param {object} o
 * @param {string} o.key        the user's ElevenLabs key (from the vault)
 * @param {Function} [o.fetch]  fetch (tests pass a stand-in)
 * @param {string} [o.base]     API origin (the QA stand-in overrides it; see providers/index.js)
 * @param {Function} [o.redact] the app's redactor, for anything ElevenLabs sends back
 * @param {object} [o.timeouts] { transcribe } in ms
 */
function createElevenLabs({ key, fetch: fetchImpl = globalThis.fetch, base = BASE, redact = (s) => s, timeouts = {} } = {}) {
  if (!key) throw new ProviderError(`Add an ${NAME} key in Setup → Keys`, { kind: 'nokey', provider: ID });
  const t = { transcribe: 15 * 60000, ...timeouts };
  const scrub = scrubber([key], redact);
  const fail = (message, o = {}) => new ProviderError(message, { provider: ID, ...o });

  function failure(status, json) {
    const d = json && json.detail;
    const why = scrub(typeof d === 'string' ? d : d && typeof d === 'object' ? (d.message || d.status || JSON.stringify(d)) : '');
    if (status === 401 || status === 403) return fail(`${NAME} didn't accept the key. Check it in Setup → Keys.`, { kind: 'auth', status });
    if (status === 402 || /quota|credits?|limit/i.test(why)) return fail(`Not enough ${NAME} credits for this. Top up at elevenlabs.io, then try again.`, { kind: 'credits', status });
    if (status === 429) return fail(`${NAME} is busy right now. Try again in a minute.`, { kind: 'rate', status });
    if (status === 400 || status === 422) return fail(`${NAME} didn't accept the sound file${why ? `: ${why}` : '.'}`, { kind: 'invalid', status });
    return fail(`${NAME} sent an unexpected reply (${status}).`, { kind: 'unexpected', status });
  }

  /**
   * One transcription of a sound file (FLAC, WAV…): Scribe's JSON, with word timings and audio events. Paid, so it's
   * sent once: a refusal (4xx) cost nothing; a reply that never came, or a server error, may have been billed
   * (ambiguous). Throws a ProviderError.
   */
  async function transcribe(file, { signal } = {}) {
    const st = fs.statSync(file);
    if (!st.isFile() || !st.size || st.size > MAX_BYTES) throw fail('The sound to transcribe is missing or too big.', { kind: 'invalid' });
    const form = new FormData();
    form.append('model_id', MODEL);
    form.append('tag_audio_events', 'true');
    form.append('timestamps_granularity', 'word');
    form.append('diarize', 'false');
    form.append('file', new Blob([fs.readFileSync(file)], { type: /\.wav$/i.test(file) ? 'audio/wav' : 'audio/flac' }), path.basename(file));
    let r;
    try {
      r = await requestJson(fetchImpl, `${base}/v1/speech-to-text`, { method: 'POST', headers: { 'xi-api-key': key, Accept: 'application/json' }, body: form, signal, timeoutMs: t.transcribe });
    } catch (e) {
      if (e.kind === 'stopped') throw e;
      throw fail(`Lost touch with ${NAME} during the transcription, so it may have been billed (a few cents). Check elevenlabs.io before trying again.`, { kind: 'ambiguous', ambiguous: true });
    }
    if (r.status >= 500) throw fail(`${NAME} had a problem (${r.status}) during the transcription, so it may have been billed (a few cents).`, { kind: 'server', status: r.status, ambiguous: true });
    if (r.status !== 200) throw failure(r.status, r.json);
    if (!r.json || !Array.isArray(r.json.words)) throw fail(`${NAME} sent no word timings.`, { kind: 'unexpected', ambiguous: true });
    return r.json;
  }

  return { id: ID, name: NAME, model: MODEL, transcribe };
}

module.exports = { createElevenLabs, ID, NAME, MODEL, USD_PER_HOUR };
