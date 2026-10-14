'use strict';
// The key vault. Values are encrypted with Electron's safeStorage, whose key lives in the macOS Keychain, and the
// ciphertext is kept in userData/vault.json (mode 0600, atomic writes). Decrypted values exist only in the main
// process: the renderer sees "set / not set" plus the last four characters, agents never see them at all, and the
// one pipeline process that needs a key gets it through its environment (pipeline.js), never through a file.
const fs = require('fs');
const path = require('path');

// The keys FLPT knows. Anything else is refused, so a renderer bug can't fill the vault with junk. Only the two the
// app runs on are required: Anthropic (the crew) and HeyGen (narration and the avatar). The rest are for what comes
// later or is optional, so Setup folds them away.
const KEYS = {
  ANTHROPIC_API_KEY: { label: 'Anthropic (Claude)', required: true, help: 'console.anthropic.com → API keys' },
  HEYGEN_API_KEY: { label: 'HeyGen', required: true, help: 'app.heygen.com → Settings → API' },
  ELEVENLABS_API_KEY: { label: 'ElevenLabs (optional voice and music)', required: false, help: 'elevenlabs.io → Developers → API keys' },
  KIE_API_KEY: { label: 'Kie.ai (generated B-roll, cartoons and cut scenes)', required: false, help: 'kie.ai → API keys' },
  HIGGSFIELD_CREDENTIALS: { label: 'Higgsfield (generated B-roll, cartoons and cut scenes)', required: false, help: 'console.higgsfield.ai → API keys ("key id:secret")' },
  OPENART_API_KEY: { label: 'OpenArt (optional "film quality")', required: false, help: 'openart.ai → API' },
  GEMINI_API_KEY: { label: 'Gemini (optional voice clone)', required: false, help: 'aistudio.google.com → API keys' },
  OPENAI_API_KEY: { label: 'OpenAI (optional slop cleanse)', required: false, help: 'platform.openai.com → API keys' },
  FISH_API_KEY: { label: 'Fish Audio (optional stinger voices)', required: false, help: 'fish.audio → API' },
};

// Names the original avatar-presentation keys.env may hold, for a one-click import on Michael's machines.
const IMPORTABLE = ['ANTHROPIC_API_KEY', 'HEYGEN_API_KEY', 'ELEVENLABS_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY',
  'KIE_API_KEY', 'FISH_API_KEY'];

function hint(v) { return v && v.length > 8 ? `…${v.slice(-4)}` : '…'; }

function createVault({ dir, safeStorage }) {
  const file = path.join(dir, 'vault.json');
  let cache = null;

  function load() {
    if (cache) return cache;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      cache = raw && typeof raw === 'object' && raw.v === 1 && raw.items && typeof raw.items === 'object' ? raw : { v: 1, items: {} };
    } catch {
      cache = { v: 1, items: {} };
    }
    return cache;
  }

  function persist() {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  function available() {
    try { return Boolean(safeStorage && safeStorage.isEncryptionAvailable()); } catch { return false; }
  }

  function set(name, value) {
    if (!Object.prototype.hasOwnProperty.call(KEYS, name)) throw new Error(`Unknown key name: ${name}`);
    const v = typeof value === 'string' ? value.trim() : '';
    if (v.length < 8 || v.length > 4096 || /\s/.test(v)) throw new Error('That doesn\'t look like a key. Paste the whole key, with no spaces.');
    if (!available()) throw new Error('macOS Keychain encryption isn\'t available, so the key wasn\'t saved.');
    load().items[name] = { enc: safeStorage.encryptString(v).toString('base64'), hint: hint(v), savedAt: new Date().toISOString() };
    persist();
    return status()[name];
  }

  function get(name) {
    const item = load().items[name];
    if (!item) return null;
    try { return safeStorage.decryptString(Buffer.from(item.enc, 'base64')); } catch { return null; }
  }

  function remove(name) {
    if (load().items[name]) { delete cache.items[name]; persist(); }
  }

  function status() {
    const items = load().items;
    const out = {};
    for (const [name, meta] of Object.entries(KEYS)) {
      out[name] = { name, ...meta, set: Boolean(items[name]), hint: items[name] ? items[name].hint : null };
    }
    return out;
  }

  /** Values for a child process's environment. Main process only; never send this object to the renderer. */
  function env(names) {
    const out = {};
    for (const n of names) {
      const v = get(n);
      if (v) out[n] = v;
    }
    return out;
  }

  /** Every stored value, for scrubbing logs before anything reaches the renderer or disk. */
  function allValues() {
    return Object.keys(load().items).map(get).filter(Boolean);
  }

  /** Import known keys from an avatar-presentation keys.env (KEY=VALUE lines). Returns the names imported. */
  function importKeysEnv(text) {
    const imported = [];
    for (const line of String(text || '').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m || !IMPORTABLE.includes(m[1])) continue;
      const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
      if (!value) continue;
      try { set(m[1], value); imported.push(m[1]); } catch { /* skip malformed values */ }
    }
    return imported;
  }

  return { set, get, remove, status, env, allValues, importKeysEnv, available, file };
}

module.exports = { createVault, KEYS };
