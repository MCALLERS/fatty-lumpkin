'use strict';
// Guest narrators (decisions.md, Michael's notes 2026-10-23: "a different voice jumps in"; W4-11). A slide with no
// presenter on screen (a Cosmos, a narrated Motion Solo) may be narrated by another voice: one of the FLPT voices
// (Michael's Fish.audio house voices, served free through FLPT's own Worker as the `fish-house` provider, W4-10), or a
// voice of the user's own (Fish.audio, ElevenLabs, HeyGen) or the Mac's. Avatar slides always keep the presenter's voice.
//
//   the storyboard   a shot's `voice`: null (the presenter) or { provider, id } (storyboard.js keeps it; voiceOf()
//                    says what a shot gets, the Jazz default included: in Jazz, a Cosmos is told by Hobbiton Narrator
//                    where the FLPT voices can speak, houseFor: a film run that carries the sign-in (houseFilms:
//                    pipeline.js's `final`, under the lead's T19 ruling), signed in, and a film made online)
//   the script       one tag per slide, a stage direction every reader of script.md already skips:
//                      > flpt-voice: fish-house/81dcca64ec094339b4dcd6508d04c28b · Hobbiton Narrator
//                    written by FLPT from the storyboard (stamp), never by a crew; the pipeline patch reads it
//                    (engine/tools/patches/42_guest_voice.py, FLPT_GUEST_VOICE_V1): that slide's narration is made by the
//                    guest's provider, under a new cache key; every other slide's keys stay as they were
//   the estimate     one line per guest provider (estimateWith): the FLPT voices "FLPT voice · free"; a paid guest at
//                    its provider's rate; the presenter's voice line loses the guest's seconds
//   Spend            blockedBy and guestOnly say why a film can't be approved with its guests (ext/guestvoice.js)
//
// Electron-free and pure but for stamp() (reads the storyboard and the deck, writes script.md when it changes) and
// houseReady() (reads the sign-in's account file, never its token); the plugin has a copy in engine/tools/lib.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const modules = require('./modules');

const MARKER = 'FLPT_GUEST_VOICE_V1';

// The FLPT voices (Michael's account; decisions.md "Voice list changed", 2026-10-23 08:35): six, Suzanne cut, Rin and
// Profound Narrator JD added. Ids are Fish.audio model ids; the Worker accepts only these.
const HOUSE = Object.freeze([
  { id: '362c984bbb7143aebbcf1b87f7ca7624', name: 'Epic Storyteller Female' },
  { id: 'a1f443e46ae74ecbb84b5ef9ab9555f6', name: 'Sarcastic Old Man' },
  { id: '81dcca64ec094339b4dcd6508d04c28b', name: 'Hobbiton Narrator' },
  { id: '0d63fefbbba84269884f80c4718af930', name: 'Young Professional Analyst' },
  { id: 'a57d512e30bf40cb996f14ab9be3f16a', name: 'Rin' },
  { id: '3274196bca8f4208a36aba959bff5746', name: 'Profound Narrator JD' },
].map((v) => Object.freeze({ provider: 'fish-house', ...v })));
const HOUSE_IDS = new Set(HOUSE.map((v) => v.id));
// Jazz's storyteller for a Cosmos (Michael: "e.g. Hobbiton Narrator").
const JAZZ_DEFAULT = HOUSE.find((v) => v.name === 'Hobbiton Narrator');
// The sign-in FLPT's Worker meters the FLPT voices by (W4-10 stores it in the vault; never read here, only its status).
const HOUSE_TOKEN = 'FLPT_VOICES_TOKEN';

// The providers a guest can speak with: how its id looks, its name for people, and how its narration is billed
// (rate: broker rate; per: 'char' (characters), 'byte' (UTF-8 bytes) or 'second'; free: nothing to pay).
const PROVIDERS = Object.freeze({
  'fish-house': { name: 'FLPT voice', id: (s) => HOUSE_IDS.has(s), rate: 'flpt_voice_char', per: 'char', free: true },
  fish: { name: 'Fish.audio', id: (s) => /^[0-9a-f]{32}$/.test(s), rate: 'fish_tts_byte', per: 'byte' },
  elevenlabs: { name: 'ElevenLabs', id: (s) => /^[A-Za-z0-9]{8,64}$/.test(s), rate: 'elevenlabs_tts_char', per: 'char' },
  heygen: { name: 'HeyGen', id: (s) => /^[A-Za-z0-9_-]{6,128}$/.test(s), rate: 'heygen_tts_s', per: 'second' },
  say: { name: 'Mac', id: (s) => /^[\p{L}\p{N} ()._'-]{1,64}$/u.test(s), rate: null, per: null, free: true },
});
const PROVIDER_IDS = Object.keys(PROVIDERS);

// The FLPT voices cost the user nothing: a zero rate, so they show in the estimate and never in an approval. Added to
// the broker's table once (never over a rate it has: W4-10 may bring its own).
const RATES = { flpt_voice_char: { provider: 'fish-house', unit: 'character of narration (FLPT voice, free)', usd: 0 } };
function registerRates(table = null) {
  const t = table || require('./broker').RATES;
  for (const [k, v] of Object.entries(RATES)) if (!Object.prototype.hasOwnProperty.call(t, k)) t[k] = v;
  return t;
}

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const text = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** A guest voice as kept: { provider, id, name }, or null (not one FLPT can speak with). An FLPT voice keeps its own name. */
function cleanVoice(v) {
  if (!isObj(v) || !PROVIDER_IDS.includes(v.provider)) return null;
  const id = typeof v.id === 'string' ? v.id.trim() : '';
  if (!id || !PROVIDERS[v.provider].id(id)) return null;
  if (v.provider === 'fish-house') return { provider: 'fish-house', id, name: HOUSE.find((h) => h.id === id).name };
  const name = text(v.name, 60);
  return { provider: v.provider, id, name: name || (v.provider === 'say' ? id : PROVIDERS[v.provider].name) };
}

/** A voice by an FLPT voice's name or id (any case), else null: what a CLI or a test names. */
function byName(s) {
  const k = String(s || '').trim().toLowerCase();
  return HOUSE.find((h) => h.id === k || h.name.toLowerCase() === k) || null;
}

/** Can this storyboard shot take a guest voice? A slide with no presenter on screen (its module hides the bubble). */
function canTake(shot) {
  if (!isObj(shot) || shot.placement !== 'slide') return false;
  const m = modules.meta(shot.module);
  return Boolean(m && m.bubble === false);
}

/**
 * The voice a shot is narrated by: null (the presenter's) or { provider, id, name, default? }. A shot's own choice wins
 * (`voice: null` is the user saying "the presenter"); with none, a Cosmos in a Jazz plan gets Hobbiton Narrator, but
 * only where the FLPT voices can speak in this film (house: houseFor), else the presenter narrates it.
 */
function voiceOf(board, shot, { house = false } = {}) {
  if (!canTake(shot)) return null;
  if (Object.prototype.hasOwnProperty.call(shot, 'voice')) return shot.voice ? cleanVoice(shot.voice) : null;
  if (house && isObj(board) && board.mode === 'jazz' && shot.module === 'cosmos') return { ...JAZZ_DEFAULT, default: true };
  return null;
}

// ── who can speak in this film ─────────────────────────────────────────────────────────────────────────────────

/** The presenter an episode films with (presenter.of: Spend's, the episode's, else the settings'); null when unknown. */
function presenterOf(d = {}, dir = null) {
  try {
    const presenter = require('./presenter');
    let sp = null;
    try { sp = d && d.settings && typeof d.settings.read === 'function' ? (d.settings.read() || {}).presenter || null : null; } catch { sp = null; }
    if (dir) return presenter.of(dir, sp);
    return sp ? presenter.clean(sp) : null;
  } catch { return null; }
}

/** Does this presenter's film get made offline (a cartoon in the Mac's voice: the draft's path, FLPT_DRAFT_FINAL)? */
function filmsOffline(p) {
  try {
    const presenter = require('./presenter');
    return Boolean(p) && presenter.isCartoon(p) && !presenter.billedBy(p);
  } catch { return false; }
}

/**
 * Does FLPT's film run carry the FLPT voices sign-in? pipeline.js says so (HOUSE_SIGNIN: true): under the lead's T19
 * ruling (2026-10-24) `final` gets it beside the keys of its live budgets, only for a script that names an FLPT voice and
 * a sign-in of the Worker FLPT talks to now (houseReady). Without it an FLPT voice can't be filmed: Spend says so
 * (blockedBy) and Jazz plans none (houseFor).
 */
function houseFilms(pipeline = null) {
  try { return (pipeline || require('./pipeline')).HOUSE_SIGNIN === true; } catch { return false; }
}

/**
 * Can the FLPT voices speak in this film? The film run carries the sign-in (houseFilms), the user is signed in to them
 * (d.vault), and the film is made online (not a cartoon in the Mac's voice). The Jazz default needs it; a voice the
 * user chose stays (Spend says why it can't be).
 */
function houseFor(d = {}, dir = null) {
  return houseFilms() && houseReady(d && d.vault) && !filmsOffline(presenterOf(d, dir));
}

/** No new tags now: the film's spend is approved (it priced the voices), or a crew is at work on the episode. */
function frozen(st) {
  if (!isObj(st) || !isObj(st.stages)) return false;
  if (isObj(st.stages.spend) && st.stages.spend.status === 'approved') return true;
  return Object.values(st.stages).some((s) => isObj(s) && s.status === 'running');
}

// ── the script's tags ──────────────────────────────────────────────────────────────────────────────────────────

// "## SLIDE n — …" as the pipeline reads it (HEADING_RE), and "## CUTSCENE …"; a tag: "> flpt-voice: provider/id · name"
const SLIDE_HEAD = /^\s{0,3}#{1,6}\s*SLIDE\s+(\d+)\b/i;
const OTHER_HEAD = /^\s{0,3}#{1,6}\s/;
const TAG = /^\s*>\s*flpt-voice:\s*([a-z][a-z-]{1,15})\/([A-Za-z0-9%._:()'~*!-]{1,192})(?:\s+·\s+.*)?\s*$/;

/** A voice's tag line (its id percent-encoded: a Mac voice's name may hold spaces). */
function tagLine(v) {
  return `> flpt-voice: ${v.provider}/${encodeURIComponent(v.id)} · ${text(v.name, 60) || v.id}`;
}

/** A tag line read back: { provider, id } (cleaned), or null. */
function parseTag(line) {
  const m = TAG.exec(String(line || ''));
  if (!m) return null;
  let id;
  try { id = decodeURIComponent(m[2]); } catch { return null; }
  return cleanVoice({ provider: m[1], id });
}

/** The tags in a script: { n: { provider, id, name } } (the first tag under each slide's first heading). */
function tagsOf(script) {
  const out = {};
  let n = null;
  for (const line of String(script || '').split(/\r?\n/)) {
    const h = SLIDE_HEAD.exec(line);
    if (h) { n = Object.prototype.hasOwnProperty.call(out, h[1]) ? null : Number(h[1]); continue; }
    if (OTHER_HEAD.test(line)) { n = null; continue; }
    if (n == null) continue;
    const v = parseTag(line);
    if (v) { out[n] = v; n = null; }
  }
  return out;
}

/**
 * The script with exactly these tags (want: { n: voice }): every flpt-voice line goes, then each slide in `want` gets
 * its tag right under its (first) heading. The narration is untouched, line endings kept. Idempotent.
 */
function stampText(script, want) {
  const src = String(script || '');
  const eol = /\r\n/.test(src) ? '\r\n' : '\n';
  const out = [];
  const done = new Set();
  for (const line of src.split(/\r?\n/)) {
    if (TAG.test(line)) continue;
    out.push(line);
    const h = SLIDE_HEAD.exec(line);
    if (!h) continue;
    const n = Number(h[1]);
    if (done.has(n)) continue;
    done.add(n);
    if (want && want[n]) out.push(tagLine(want[n]));
  }
  return out.join(eol);
}

// ── the episode: what each slide gets, stamped into script.md ──────────────────────────────────────────────────

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

/**
 * Each slide's guest voice in this episode, by slide number: the deck's slides (in order) carry their storyboard shot;
 * a slide whose shot can take a guest, and whose deck module hides the presenter, gets that shot's voiceOf(). The Jazz
 * default speaks only where the FLPT voices can (house: houseFor, signed in and filmed online); a voice the user chose
 * stays (Spend says if it can't be used). → { n: { provider, id, name, default? } }
 */
function planFor(dir, { house = false } = {}) {
  const storyboard = require('./storyboard');
  const board = storyboard.read(dir);
  if (!board) return {};
  const project = path.join(dir, 'presentation', 'deck', 'project');
  const deck = readJson(path.join(project, 'deck.json')) || {};
  const map = readJson(path.join(project, 'modules.json')) || {};
  const order = (Array.isArray(deck.order) ? deck.order : []).map((x) => (typeof x === 'string' ? x : x && x.id)).filter((x) => typeof x === 'string');
  const entries = isObj(map.slides) ? map.slides : {};
  const shots = new Map(board.shots.map((s) => [s.id, s]));
  const out = {};
  order.forEach((id, i) => {
    const e = Object.prototype.hasOwnProperty.call(entries, id) && isObj(entries[id]) ? entries[id] : null;
    const shot = e && typeof e.shot === 'string' ? shots.get(e.shot) : null;
    if (!shot || !modules.hidesBubble(e)) return;
    const v = voiceOf(board, shot, { house });
    if (v) out[i + 1] = v;
  });
  return out;
}

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/**
 * script.md's tags made to match the plan (planFor): written only when they change. No script yet: nothing.
 * → { changed, slides: { n: voice } }
 */
function stamp(dir, opts = {}) {
  const file = path.join(dir, 'presentation', 'script.md');
  let script;
  try { script = fs.readFileSync(file, 'utf8'); } catch { return { changed: false, slides: {} }; }
  const want = planFor(dir, opts);
  const next = stampText(script, want);
  if (next !== script) writeAtomic(file, next);
  return { changed: next !== script, slides: want };
}

// ── the estimate ──────────────────────────────────────────────────────────────────────────────────────────────────

const PIPELINE_CPS = 14.5; // the pipeline's pace for narration it hasn't made yet (CHARS_PER_SEC)
const spokenOf = (s) => String(s || '').replace(/\[[^\]]*\]/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

/**
 * The guest-voiced slides in a script, from its tags: [{ n, voice, chars, bytes, seconds }] (characters and bytes of
 * what's said, tags left out; seconds as episode.slideSeconds estimates them).
 */
function guestSlides(script) {
  const episode = require('./episode');
  const tags = tagsOf(script);
  const parsed = episode.parseScript(script);
  const secs = new Map(episode.slideSeconds(parsed).map((x) => [x.n, x.seconds]));
  const out = [];
  for (const s of parsed) {
    const v = tags[s.n];
    if (!v) continue;
    const said = spokenOf(s.narration);
    if (!said) continue;
    out.push({ n: s.n, voice: v, chars: said.length, bytes: Buffer.byteLength(said, 'utf8'), seconds: secs.get(s.n) || 0 });
  }
  return out;
}

// The presenter's own voice lines an estimate may carry (flow.js's twin, presenter.estimateFor's cartoon voices).
const VOICE_RATES = { heygen_tts_s: 'second', elevenlabs_tts_char: 'char', fish_tts_byte: 'char' };

/**
 * The pipeline estimate's own guest line, checked: {"flpt_guests": {provider: characters still to make}} (FLPT_GUEST_
 * VOICE_V1 prints it first, only when there are guests) → { provider: n }, or null (no line, or one FLPT can't read).
 * pipeline.estimate passes it on as its estimate's `guests`, and flow.js's count as film.guestChars (W4-04, INT).
 */
function parseGuests(lines) {
  const line = [...(lines || [])].reverse().find((l) => String(l).trim().startsWith('{"flpt_guests"'));
  let g;
  try { g = JSON.parse(line).flpt_guests; } catch { return null; }
  if (!isObj(g)) return null;
  const out = {};
  for (const [p, n] of Object.entries(g)) {
    if (!PROVIDER_IDS.includes(p) || !Number.isInteger(n) || n < 0) return null;
    out[p] = n;
  }
  return out;
}

/**
 * The filming estimate with the guests in it (the 'estimate' hook, after the presenter's): one line per guest provider
 * (the FLPT voices "FLPT voice · free"), and, when the estimate came from the script (est.film.source !== 'pipeline'),
 * the guests' seconds taken off the presenter's voice line (the pipeline's own count already leaves them out). With
 * the pipeline's count of each guest provider's characters still to make (film.guestChars: parseGuests), a guest's
 * narration already made costs nothing and gets no line; without it, all of it is priced. A guest provider's line is
 * never under a cent unless it's free. → a new estimate (broker.estimate's shape), with film.guests
 * [{ n, provider, id, name }]; the estimate as it was when there are no guests.
 */
function estimateWith(est, guests) {
  if (!isObj(est) || !Array.isArray(guests) || !guests.length) return est;
  const broker = require('./broker');
  registerRates(broker.RATES);
  require('./presenter').registerRates(broker.RATES); // the voices' rates (ElevenLabs, Fish.audio): presenter.js's
  const film = isObj(est.film) ? est.film : {};
  const items = (Array.isArray(est.lines) ? est.lines : []).map((l) => ({ rate: l.rate, qty: l.qty, label: l.label }));
  const emptied = new Set();
  if (film.source !== 'pipeline') {
    // the guests' seconds, in each voice line's own unit, off the presenter's voice (never below nothing)
    let left = guests.reduce((a, g) => a + g.seconds, 0);
    items.forEach((l, i) => {
      const per = VOICE_RATES[l.rate];
      if (!per || left <= 0 || /^Guest voice|^FLPT voice/.test(String(l.label || ''))) return;
      const unit = per === 'second' ? 1 : PIPELINE_CPS;
      const was = Number(l.qty) || 0;
      l.qty = Math.max(0, Math.round(was - left * unit));
      left -= (was - l.qty) / unit;
      if (!l.qty) emptied.add(i);
    });
  }
  const byProvider = new Map();
  const charsOf = new Map();
  for (const g of guests) {
    const p = PROVIDERS[g.voice.provider];
    if (!p || !p.rate) continue; // the Mac's voice: free, no line
    const qty = p.per === 'second' ? g.seconds : p.per === 'byte' ? g.bytes : g.chars;
    byProvider.set(g.voice.provider, (byProvider.get(g.voice.provider) || 0) + qty);
    charsOf.set(g.voice.provider, (charsOf.get(g.voice.provider) || 0) + g.chars);
  }
  // the pipeline's count: what's still to make of each provider's narration, in that provider's own unit
  const left = film.source === 'pipeline' && isObj(film.guestChars) ? film.guestChars : null;
  if (left) {
    for (const [provider, qty] of byProvider) {
      const n = left[provider];
      if (!Number.isInteger(n) || n < 0 || !(charsOf.get(provider) > 0)) continue; // not counted: all of it priced
      byProvider.set(provider, (qty * n) / charsOf.get(provider));
    }
  }
  const kept = items.filter((l, i) => !emptied.has(i));
  for (const [provider, qty] of byProvider) {
    if (!(qty > 0)) continue;
    const p = PROVIDERS[provider];
    const r = broker.RATES[p.rate];
    // a paid voice still to make is priced at a cent at least (presenter.js's rule), never at zero
    const q = !p.free && r && r.usd ? Math.max(Math.ceil(qty), Math.ceil(0.01 / r.usd - 1e-9)) : Math.ceil(qty);
    kept.push({ rate: p.rate, qty: q, label: p.free ? 'FLPT voice · free' : `Guest voice · ${p.name}` });
  }
  return { ...broker.estimate(kept), film: { ...film, guests: guests.map((g) => ({ n: g.n, provider: g.voice.provider, id: g.voice.id, name: g.voice.name })) } };
}

// An FLPT voice while the film run can't carry the sign-in (houseFilms): signed in or not, Film would stop at it.
const HOUSE_NOT_YET = 'Filming with an FLPT voice isn\'t ready yet.';

/**
 * Why Spend can't be approved with these guests, or null: a film made offline (offline: a cartoon in the Mac's voice)
 * has only the Mac's voices, an FLPT voice needs a film run that carries the sign-in (film: houseFilms) and the sign-in
 * itself (house: signed in), and a paid guest needs a provider Spend can approve (spend: the providers it can;
 * presenter.spendProviders()).
 */
function blockedBy(guests, { house = false, film = false, spend = ['heygen'], offline = false } = {}) {
  for (const g of guests || []) {
    const p = g.voice.provider;
    if (offline && p !== 'say') return `Slide ${g.n}'s guest voice needs the network, and a cartoon in the Mac's voice is filmed offline.`;
    if (p === 'fish-house' && !film) return HOUSE_NOT_YET;
    if (p === 'fish-house' && !house) return 'The FLPT voices need you signed in.';
    if (!PROVIDERS[p].free && !spend.includes(p)) return `Filming with a ${PROVIDERS[p].name} guest voice isn't ready yet.`;
  }
  return null;
}

// What's left to film is a guest's narration alone, and nothing else costs anything: Spend would approve it free, but
// FLPT has no film run yet that makes only a guest's voice for a presenter filmed online (the twin's and a paid
// cartoon voice's film runs on a budget; the free re-composite is offline). film.guestOnly: ext/guestonly.js.
const GUEST_ONLY = 'Filming only a guest voice isn\'t ready yet.';

/** Is this estimate (estimateWith's) one Spend can't film: a guest's narration all that's left, and free? → why, or null. */
function guestOnly(est, { offline = false } = {}) {
  if (offline || !isObj(est) || !isObj(est.film) || est.film.guestOnly !== true || est.film.nothing) return null;
  const paid = Object.values(est.byProvider || {}).reduce((a, p) => a + (Number(p && p.usd) || 0), 0);
  return paid > 0 ? null : GUEST_ONLY;
}

// The sign-in's account (api/signin.js, the plugin's flpt-signin): who signed in and the Worker that issued the token
// (`base`). The Mac app keeps it beside its vault; a vault that keeps it elsewhere names it (`account`: the plugin's).
const HOUSE_ACCOUNT = 'flpt-voices.json';
function accountOf(vault) {
  if (vault && typeof vault.account === 'string' && path.isAbsolute(vault.account)) return vault.account;
  return vault && typeof vault.file === 'string' && path.isAbsolute(vault.file) ? path.join(path.dirname(vault.file), HOUSE_ACCOUNT) : null;
}

/**
 * Is the FLPT voices' sign-in in the vault, and is it the sign-in of the Worker FLPT talks to now (its account's base is
 * fish-house.baseUrl(), as api/signin.js and pipeline.js's film ask)? Its status only: the token is never read here.
 * A vault with no account (a host that can't sign in) is signed out.
 */
function houseReady(vault) {
  try {
    const s = vault && typeof vault.status === 'function' ? vault.status() : null;
    if (!(s && s[HOUSE_TOKEN] && s[HOUSE_TOKEN].set)) return false;
    const file = accountOf(vault);
    const account = file ? readJson(file) : null;
    return Boolean(isObj(account) && typeof account.base === 'string' && account.base === require('./providers/fish-house').baseUrl());
  } catch { return false; }
}

module.exports = {
  MARKER, HOUSE, JAZZ_DEFAULT, HOUSE_TOKEN, HOUSE_ACCOUNT, PROVIDERS, PROVIDER_IDS, RATES, PIPELINE_CPS, GUEST_ONLY, HOUSE_NOT_YET,
  registerRates, cleanVoice, byName, canTake, voiceOf, presenterOf, filmsOffline, houseFilms, houseFor, frozen, tagLine, parseTag, tagsOf,
  stampText, planFor, stamp, guestSlides, parseGuests, estimateWith, blockedBy, guestOnly, houseReady,
};
