'use strict';
// flpt.presenter (W3-05): Setup's Presenter step for the cartoon (PLAN §2.12, S1). The HeyGen twin's own methods (looks,
// voices, preview, set) stay in legacy-setup.js under their 0.7.1 names (flpt.looks, flpt.voices…); these add who presents
// and the cartoon, as flpt.presenter.*:
//   options()            { kind, rig, voice, rigs: [{ id, name, stock, thumb }], voices: [{ provider, name, free, key,
//                        keySet }] }: the choice as saved, and what there is to choose from (thumbs as data: URLs; the
//                        voices Spend can approve: presenter.offered())
//   voiceList(provider)  the voices to pick from: the Mac's, or the user's own at HeyGen, ElevenLabs or Fish.audio (free
//                        GETs with their key); → { ok, voices: [{ id, name, sample }] } or { ok: false, error }
//   voiceSample(json)    { provider, id }: a free sample of that voice (the providers' own recordings; the Mac's said
//                        here) → { ok, url }
//   rigSample(id)        a short free clip of a rig talking in the Mac's voice, drawn here → { ok, url }
//   choose(json)         { kind, rig, voice }: saved in settings.presenter (a HeyGen voice gets the engine it can speak
//                        with; a voice that isn't offered is refused) → { ok, state }
// Nothing here spends anything: every call is a free GET or local work, and the page never names a path or an amount.
const path = require('path');
const presenter = require('../presenter');
const likeness = require('../likeness');
const voicelists = require('../voicelists');
const heygen = require('../heygen');

const PROVIDERS = presenter.PROVIDERS;
const pickerDir = (c, sub) => path.join(c.sampleDir(), 'presentation', 'video', 'output', 'picker', sub);
const presentersDir = (c) => path.join(c.settings.read().projectsDir, 'Presenters');
const thumbUrl = (dir) => { const svg = presenter.rigPoster(dir); return svg ? `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` : null; };

function options(c) {
  const s = c.settings.read();
  const p = presenter.clean(s.presenter && s.presenter.kind === 'cartoon' ? s.presenter : { ...(s.presenter || {}), kind: 'cartoon' });
  const keys = c.vault.status();
  return {
    kind: s.presenter && s.presenter.kind === 'cartoon' ? 'cartoon' : 'heygen',
    twin: Boolean(s.presenter && s.presenter.lookId),
    rig: p.rig, voice: p.voice,
    rigs: presenter.rigs(c.engineRoot, presentersDir(c)).map((r) => ({ id: r.id, name: r.name, stock: r.stock, likeness: r.kind === 'likeness', thumb: thumbUrl(r.dir) })),
    voices: presenter.offered().map((id) => {
      const v = presenter.VOICES[id];
      return { provider: id, name: v.name, free: Boolean(v.free), key: v.key, keySet: v.key ? Boolean(keys[v.key] && keys[v.key].set) : true };
    }),
  };
}

const keyOf = (c, provider) => { const v = presenter.VOICES[provider]; return v && v.key ? c.vault.get(v.key) : null; };

async function voices(c, provider) {
  if (!PROVIDERS.includes(provider)) return { ok: false, error: 'That isn\'t a voice FLPT knows.' };
  try {
    if (provider === 'say') return { ok: true, voices: (await voicelists.macVoices()).map((v) => ({ id: v.id, name: v.name, sample: true })) };
    const key = keyOf(c, provider);
    if (!key) return { ok: false, error: `Add your ${presenter.VOICES[provider].name} key first.` };
    if (provider === 'heygen') {
      const list = await heygen.voicesFor(key, []);
      for (const v of list) c.knownVoices.set(v.id, v);
      return { ok: true, voices: list.map((v) => ({ id: v.id, name: v.name, sample: Boolean(v.preview), speaks: heygen.pickEngine(v) !== null })) };
    }
    const list = provider === 'elevenlabs' ? await voicelists.elevenVoices(key) : await voicelists.fishVoices(key);
    return { ok: true, voices: list.map((v) => ({ id: v.id, name: v.name, sample: v.sample })) };
  } catch (e) {
    return { ok: false, error: c.redact(String(e.message || e)) };
  }
}

async function sample(c, spec) {
  const provider = spec && spec.provider;
  if (!PROVIDERS.includes(provider)) return { ok: false, error: 'That isn\'t a voice FLPT knows.' };
  try {
    const file = await voicelists.sample(provider, String((spec && spec.id) || ''), { dir: pickerDir(c, 'voices'), key: keyOf(c, provider), known: c.knownVoices });
    return { ok: true, url: c.fileUrl(file) };
  } catch (e) {
    return { ok: false, error: c.redact(String(e.message || e)) };
  }
}

async function rigSample(c, id) {
  if (!presenter.rigDir(c.engineRoot, id, presentersDir(c))) return { ok: false, error: 'That presenter isn\'t there.' };
  try {
    if (!c.lastDetect && c.detectTools) await c.detectTools();
    const s = c.settings.read().presenter || {};
    const sayVoice = s.voice && s.voice.provider === 'say' ? s.voice.id : '';
    const clip = await presenter.sampleClip(id, pickerDir(c, path.join('cartoon', id)), { engineRoot: c.engineRoot, presentersDir: presentersDir(c), toolEnv: c.toolEnv, sayVoice, hidden: c.appPrivate ? c.appPrivate() : [] });
    return { ok: true, url: c.fileUrl(clip) };
  } catch (e) {
    return { ok: false, error: c.redact(String(e.message || e)) };
  }
}

async function choose(c, spec) {
  const kind = spec && spec.kind === 'cartoon' ? 'cartoon' : 'heygen';
  const now = c.settings.read().presenter || {};
  const next = { ...now, kind };
  if (kind === 'cartoon') {
    const rig = spec.rig || now.rig || presenter.DEFAULT_RIG;
    const rigDir = presenter.rigDir(c.engineRoot, rig, presentersDir(c));
    if (!rigDir) return { ok: false, error: 'That presenter isn\'t there.' };
    // a cartoon of the user, newly picked with no voice: the voice it was made with, when Spend can approve that provider
    const pair = !spec.voice && spec.rig && spec.rig !== now.rig ? likeness.pairingOf(rigDir) : null;
    const paired = pair && presenter.offered().includes(pair.provider) ? { provider: pair.provider, id: '', name: pair.name || '' } : null;
    let voice = presenter.cleanVoice(spec.voice) || presenter.cleanVoice(paired) || presenter.cleanVoice(now.voice) || { provider: 'say', id: '', name: '' };
    if (!presenter.offered().includes(voice.provider)) {
      if (spec.voice) return { ok: false, error: `Filming with your ${presenter.VOICES[voice.provider].name} voice isn't ready yet.` };
      voice = { provider: 'say', id: '', name: '' }; // a voice kept from before that can't be filmed yet: the Mac's
    }
    if (voice.provider === 'heygen' && voice.id) {
      const key = keyOf(c, 'heygen');
      const r = await heygen.voiceOnly({ voiceId: voice.id }, { known: c.knownVoices, lookup: async (id) => (key ? heygen.voice(key, id) : null) });
      if (!r.ok) return r;
      voice = { ...r.voice, name: voice.name || r.voice.name };
    }
    Object.assign(next, { rig, voice });
  }
  c.settings.write({ presenter: next });
  return { ok: true, state: c.state() };
}

module.exports = {
  ns: 'presenter',
  methods: {
    options: { args: [], handler: (c) => options(c) },
    voiceList: { args: ['id'], handler: (c, provider) => voices(c, provider) },
    voiceSample: { args: ['json:1024'], handler: (c, spec) => sample(c, spec) },
    rigSample: { args: ['id'], handler: (c, id) => rigSample(c, id) },
    choose: { args: ['json:2048'], handler: (c, spec) => choose(c, spec) },
  },
};
