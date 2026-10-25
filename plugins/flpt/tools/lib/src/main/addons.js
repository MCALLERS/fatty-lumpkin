'use strict';
// Transitions & Music: a small repository of add-ons for the Refine step, beside the Library (never inside it):
//   <projects>/Transitions & Music/items/<id>/…   the same layout as the Library (this reuses library.js), with
//                                                 kinds "transition" and "music"
//   <projects>/Transitions & Music/.flpt-seeded.json   which shipped add-ons were copied in, so each comes in once
// The first time it's opened it's seeded from the set that ships with the app (app/assets/addons/manifest.json),
// addedBy "flpt". Seeding never touches an item that's there, and never brings back one the user put in the Trash.
// The user adds their own (addedBy "you"): a video becomes a transition (a card, played full screen between slides),
// a sound file becomes music. Removing moves an item to the Trash, as in the Library.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createLibrary, mediaType } = require('./library');

const DIR_NAME = 'Transitions & Music';
const SEED_FILE = '.flpt-seeded.json';
const ID_RE = /^[a-z0-9][a-z0-9-]{1,79}$/;
const GROUP_ORDER = ['Glitch', 'Meanwhile', 'Hours later'];

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const httpOr = (u) => (typeof u === 'string' && /^https?:\/\/\S+$/.test(u) ? u.slice(0, 2000) : '');

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

/** A path inside the shipped folder, or null (the manifest can't point anywhere else). */
function inside(root, rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel)) return null;
  const p = path.resolve(root, rel);
  return p.startsWith(path.resolve(root) + path.sep) ? p : null;
}

/**
 * The shipped add-ons (manifest.json in the shipped folder), checked: [{ id, kind, name, …, filePath, thumbPath }].
 * A missing or damaged manifest is an empty set, never an error.
 */
function readShipped(root) {
  const m = root ? readJson(path.join(root, 'manifest.json')) : null;
  if (!m || m.v !== 1 || !Array.isArray(m.items)) return [];
  const out = [];
  for (const raw of m.items) {
    if (!raw || typeof raw !== 'object' || !ID_RE.test(String(raw.id)) || !['transition', 'music'].includes(raw.kind)) continue;
    const filePath = inside(root, raw.file);
    if (!filePath) continue;
    const cut = Number(raw.cut_seconds);
    out.push({
      id: raw.id, kind: raw.kind, name: str(raw.name, 200) || raw.id, group: str(raw.group, 60), description: str(raw.description, 500),
      style: raw.kind === 'transition' ? (raw.style === 'overlay' && Number.isFinite(cut) ? 'overlay' : 'card') : null,
      cut: raw.kind === 'transition' && raw.style === 'overlay' && Number.isFinite(cut) ? cut : null,
      duration: Number(raw.duration) || null, author: str(raw.author, 200), license: str(raw.license, 80), licenseUrl: httpOr(raw.license_url),
      source: httpOr(raw.source), credit: str(raw.credit, 2000), changes: str(raw.changes, 1000), sha256: str(raw.sha256, 64),
      filePath, thumbPath: inside(root, raw.thumb),
    });
  }
  return out;
}

/**
 * The shipped tracks a repository holds (what seed() copied in: addedBy "flpt", its shipped id in addon.ref), in
 * readShipped()'s shape, read only (no index rebuilt, nothing written): the plugin plays the Mac app's own (DV13).
 */
function installed(dir) {
  const items = dir ? path.join(dir, 'items') : null;
  let names = [];
  try { names = fs.readdirSync(items).sort(); } catch { return []; }
  const out = [];
  for (const n of names) {
    const j = readJson(path.join(items, n, 'item.json'));
    const a = j && j.addon;
    if (!j || j.kind !== 'music' || j.addedBy !== 'flpt' || !a || !ID_RE.test(String(a.ref)) || out.some((x) => x.id === a.ref)) continue;
    const filePath = inside(path.join(items, n), j.file);
    if (!filePath || !isFile(filePath)) continue;
    const src = j.source || {};
    out.push({
      id: a.ref, kind: 'music', name: str(j.title, 200) || a.ref, group: '', description: str(j.notes, 500), style: null, cut: null,
      duration: Number(j.duration) || null, author: str(src.author, 200), license: str(a.license, 80), licenseUrl: httpOr(a.licenseUrl),
      source: httpOr(src.url), credit: str(a.credit, 2000), changes: str(a.changes, 1000), sha256: str(j.sha256, 64), filePath, thumbPath: null,
    });
  }
  return out;
}

/** The Library item fields for one shipped add-on. */
function itemFor(s) {
  const site = s.source ? new URL(s.source).hostname.replace(/^www\./, '') : 'FLPT';
  return {
    kind: s.kind, file: s.filePath, fileName: path.basename(s.filePath), title: s.name, notes: s.description,
    tags: s.kind === 'transition' ? [s.group, s.style === 'overlay' ? 'overlay' : 'card'] : ['music', s.author],
    source: s.kind === 'music'
      ? { url: s.source, site, author: s.author, rights: [s.license, s.licenseUrl].filter(Boolean).join(' · '), description: s.description }
      : { site: 'FLPT', author: 'Bombadillo AI', rights: 'Ships with FLPT.' },
    addedBy: 'flpt', thumbFrom: s.thumbPath && isFile(s.thumbPath) ? s.thumbPath : undefined,
    addon: s.kind === 'transition' ? { ref: s.id, group: s.group, style: s.style, cut: s.cut }
      : { ref: s.id, credit: s.credit, license: s.license, licenseUrl: s.licenseUrl, changes: s.changes },
  };
}

/** What a shelf shows for one item (the Refine step's pickers get the same). */
function card(it) {
  const a = it.addon || {};
  return {
    id: it.id, kind: it.kind, title: it.title, description: it.notes || '', duration: it.duration, addedBy: it.addedBy,
    addedAt: it.addedAt, updatedAt: it.updatedAt, thumbPath: it.thumbPath, filePath: it.filePath,
    group: a.group || '', style: it.kind === 'transition' ? (a.style || 'card') : null, cut: a.cut != null ? a.cut : null,
    author: (it.source && it.source.author) || '', credit: a.credit || '', license: a.license || '', ref: a.ref || null,
  };
}

/**
 * @param {object} d
 * @param {string} d.dir           the repository folder (addonsDirOf(settings))
 * @param {string} d.shippedRoot   the shipped set (paths.addonsRoot)
 * @param {(p: string) => Promise<void>} d.trash   moves a folder to the Trash
 * @param {object} [d.media]       createMedia(): probes, thumbnails
 */
function createAddons({ dir, shippedRoot, trash, media = {}, onChange = () => {}, log = () => {} }) {
  const lib = createLibrary({ dir, trash, media, onChange, log });
  const seedFile = path.join(dir, SEED_FILE);
  let seeding = null;

  /**
   * Copy in the shipped add-ons not seeded yet. Idempotent: each shipped id comes in once (the record says which),
   * the same file already there (by its SHA-256) isn't copied again, and nothing there is changed.
   * Returns { added, total }.
   */
  function seed() {
    if (seeding) return seeding;
    seeding = (async () => {
      const shipped = readShipped(shippedRoot);
      const rec = readJson(seedFile);
      const done = rec && rec.v === 1 && rec.items && typeof rec.items === 'object' ? rec.items : {};
      let added = 0;
      for (const s of shipped) {
        if (done[s.id]) continue;
        if (!isFile(s.filePath)) { log(`addons: ${s.id} isn't in the app`); continue; }
        try {
          const it = await lib.add(itemFor(s));
          if (!it.duplicate) added += 1;
          done[s.id] = { id: it.id, at: new Date().toISOString() };
          writeJsonAtomic(seedFile, { v: 1, note: 'The add-ons that shipped with FLPT and were copied in here. Each comes in once.', items: done });
        } catch (e) {
          log(`addons: couldn't add ${s.id}: ${e.message}`);
        }
      }
      return { added, total: shipped.length };
    })().finally(() => { seeding = null; });
    return seeding;
  }

  /** Both shelves: your own first (newest first), then the shipped ones in their groups' order. */
  function list() {
    const shippedOrder = new Map(readShipped(shippedRoot).map((s, i) => [s.id, i]));
    const rank = (c) => {
      if (c.addedBy !== 'flpt') return [0, -Date.parse(c.addedAt) || 0];
      const g = GROUP_ORDER.indexOf(c.group);
      return [1, (g < 0 ? GROUP_ORDER.length : g) * 1000 + (shippedOrder.has(c.ref) ? shippedOrder.get(c.ref) : 999)];
    };
    const cmp = (a, b) => { const x = rank(a); const y = rank(b); return x[0] - y[0] || x[1] - y[1]; };
    const all = lib.list().map(card);
    return {
      dir,
      transitions: all.filter((c) => c.kind === 'transition').sort(cmp),
      music: all.filter((c) => c.kind === 'music').sort(cmp),
    };
  }

  /** Add a file of yours: a video becomes a transition (a card), a sound file becomes music. */
  async function addFile(file) {
    const type = mediaType(file);
    const kind = type === 'video' ? 'transition' : type === 'audio' ? 'music' : null;
    if (!kind) throw new Error('Transitions are videos and music is sound: that file is neither.');
    return lib.addFile(file, { kind, addedBy: 'you', addon: kind === 'transition' ? { style: 'card' } : { credit: '' } });
  }

  return {
    dir, seed, list, addFile, library: lib,
    get: (id) => lib.get(id),
    remove: (id) => lib.remove(id),
    setCredit: (id, text) => {
      const it = lib.get(id);
      if (it.kind !== 'music') throw new Error('Only music has a credit line.');
      return card(lib.update(id, { credit: String(text || '') }));
    },
  };
}

module.exports = { createAddons, readShipped, installed, card, DIR_NAME, SEED_FILE };
