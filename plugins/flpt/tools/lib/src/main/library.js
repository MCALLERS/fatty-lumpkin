'use strict';
// The Asset Library: everything worth keeping (clips, photos, articles, websites, wiki pages, video links, notes),
// in one folder you can also browse in Finder, built so nothing is ever lost:
//   <dir>/items/<id>/item.json   the record, and the source of truth
//   <dir>/items/<id>/<file>      the media under its own (cleaned) name, plus thumb.jpg, maybe snapshot.png and a WAV
//   <dir>/library.json           an index of every item.json, rebuilt whenever it's missing, corrupt or out of step
// New items are assembled in <dir>/.incoming/<id> and moved into items/ with one rename, so items/ only ever holds
// whole items. Removing one moves its folder to the macOS Trash (trash() is injected; tests use a fake). Nothing here
// deletes anything outright, and imports only ever read from their source folder.
//
// For the crew (wired in by the episode flow later): saveLink() records links and saves pictures, but a video link
// is only ever recorded, never downloaded (Clippy, which only the user runs, is the one way video comes in).
//
// References (kind `reference`, references.js) are private: <id>/{source.*, frames/, motion.mp4?, card.json}. They're
// left out of list(), search(), facets() and get() unless the caller asks for them ({ includePrivate: true }), never
// match another item as a duplicate, can't be made by add() or addFile(), and stay references when recovered or when
// their record (or the index) is edited by hand: the folder's own mark and card decide. So nothing that offers the
// Library to a crew, a call, Refine or a film can reach one by accident.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const linkmeta = require('./linkmeta');
const { parseTime, formatTime } = require('./timecode');

// transition and music are the Transitions & Music repository's kinds (addons.js), which reuses this module.
const KINDS = ['clip', 'image', 'article', 'website', 'wiki', 'video-link', 'audio', 'document', 'note', 'flpt', 'transition', 'music'];
const PRIVATE_KINDS = ['reference']; // made only through addReference(); never offered without { includePrivate: true }
const ALL_KINDS = [...KINDS, ...PRIVATE_KINDS];
const REFERENCE_MARK = '.flpt-reference'; // written first into a reference's folder, so even a half-built one is known
const LINK_KINDS = ['article', 'website', 'wiki', 'video-link'];
const ADDED_BY = ['you', 'clippy', 'crew', 'import', 'episode', 'flpt'];
const ADDON_STYLES = ['card', 'overlay'];
const ID_RE = /^[a-z0-9][a-z0-9-]{2,90}$/;
const RESERVED = new Set(['item.json', 'thumb.jpg', 'snapshot.png']);
const EXTS = {
  video: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'tif', 'tiff', 'bmp', 'avif', 'psd'],
  audio: ['mp3', 'm4a', 'wav', 'aif', 'aiff', 'aac', 'flac', 'ogg'],
  document: ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'key', 'pages', 'numbers', 'xls', 'xlsx', 'txt', 'md', 'rtf', 'csv'],
};
const TYPES = Object.fromEntries(Object.entries(EXTS).map(([t, list]) => [t, new RegExp(`\\.(${list.join('|')})$`, 'i')]));
const EXTENSIONS = Object.values(EXTS).flat();
const KIND_FOR_TYPE = { video: 'clip', image: 'image', audio: 'audio', document: 'document' };
const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/avif': '.avif', 'image/heic': '.heic', 'image/tiff': '.tif', 'image/bmp': '.bmp' };
const MAX = { title: 300, notes: 20000, tag: 40, tags: 30 };

const CUTAWAY = 'Cutaway Library';
const CUTAWAY_CATEGORY = { setbacks: 'setback', transitions: 'transition', requests: 'request', results: 'result' };
// "Tag by use": the moments a cutaway is good for, read from its "good moment to use it" line.
const USE_TAGS = [
  ['budget', /\b(budget|revenue|return on investment|money|costs?|pric(e|ing)|spend)/i],
  ['launch', /\b(launch|prototype|kick off|kickoff|roll-?out|finally working|go live)/i],
  ['setback', /\b(setbacks?|bug|problem|obstacle|missed|going wrong|fail|blocked|error|unhelpful)/i],
  ['change', /\b(change|pivot|direction|strategy|transition|retire)/i],
  ['success', /\b(success|celebrat|good news|promising|smooth)/i],
  ['rejection', /\b(reject|hard stop|zero-result)/i],
  ['surprise', /\b(surpris|unexpected|implausible|breakthrough)/i],
  ['closing', /\b(closing|end a section|follow-up|sign-?off|farewell)/i],
  ['humor', /\b(joke|comic|fun at|break tension|wordplay)/i],
  ['scope', /\b(scope|capacity|more people)/i],
  ['tech', /\b(ai|automation|computer|system|simulation|demo|tool|technology)\b/i],
];

// ── small helpers ──────────────────────────────────────────────────────────────────────────────────────────────

const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const httpOrEmpty = (u) => (linkmeta.parseHttpUrl(u) ? String(u).trim().slice(0, 2000) : '');
const validIso = (s) => (typeof s === 'string' && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : null);

/** 'video' | 'image' | 'audio' | 'document' | null, from a file name. */
function mediaType(name) {
  for (const [t, re] of Object.entries(TYPES)) if (re.test(String(name))) return t;
  return null;
}
function kindForFile(name) { return KIND_FOR_TYPE[mediaType(name)] || null; }

/** A file name that is safe and readable inside an item folder (keeps the extension, lowercased). */
function safeName(name, fallback = 'file') {
  const base = path.basename(String(name || ''));
  const ext = (path.extname(base).match(/^\.[A-Za-z0-9]{1,8}$/) || [''])[0].toLowerCase();
  let stem = base.slice(0, base.length - path.extname(base).length).normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ._()-]+/g, ' ').replace(/\s+/g, ' ').replace(/-{2,}/g, '-').replace(/^[-. ]+|[-. ]+$/g, '').slice(0, 100);
  if (!stem) stem = fallback;
  const out = `${stem}${ext}`;
  return RESERVED.has(out.toLowerCase()) ? `file-${out}` : out;
}

/** "g-bruceLeeFight.mp4" → "Bruce Lee Fight": a readable first title for a file (people edit it later). */
function titleFromFilename(name) {
  let s = path.basename(String(name || '')).replace(/\.[A-Za-z0-9]{1,8}$/, '');
  s = s.replace(/^[a-z]-(?=\w)/, ''); // a one-letter prefix like "g-"
  s = s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : 'Untitled';
}

function slug(s, max = 40) {
  return fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/g, '');
}

function cleanTags(v) {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  const seen = new Set();
  const out = [];
  for (const t of list) {
    if (typeof t !== 'string') continue;
    const c = t.replace(/^#/, '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, MAX.tag);
    if (c && !seen.has(c)) { seen.add(c); out.push(c); }
    if (out.length >= MAX.tags) break;
  }
  return out;
}

/** A link reduced to what makes it the same page (no #fragment, no utm_ tracking, no trailing slash). */
function linkKey(url) {
  const u = linkmeta.parseHttpUrl(url);
  if (!u) return '';
  const yt = linkmeta.cleanYouTubeUrl(u.href);
  if (yt) return yt;
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|mc_)/i.test(k)) u.searchParams.delete(k);
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  return u.href.replace(/\/(?=$|\?)/, '');
}

/**
 * How a generated item was made (generate.js): provider, model, the prompt sent, the line it pays off, the job id and
 * what it cost. Null for anything that wasn't generated.
 */
function generatedOf(g) {
  if (!g || typeof g !== 'object' || !str(g.provider, 40)) return null;
  return {
    provider: str(g.provider, 40), model: str(g.model, 120), prompt: str(g.prompt, 4000), line: str(g.line, 1000),
    jobId: str(String(g.jobId == null ? '' : g.jobId), 200), costUsd: num(g.costUsd), credits: num(g.credits),
    duration: num(g.duration), resolution: str(g.resolution, 12), aspect: str(g.aspect, 12), at: validIso(g.at),
  };
}

/** Every item read from disk goes through here, so a hand-edited or damaged item.json can't break anything. */
function normalize(raw, id) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const src = o.source && typeof o.source === 'object' ? o.source : {};
  const inFolder = (v) => (typeof v === 'string' && v && !/[/\\]/.test(v) && v !== '.' && v !== '..' ? v : null);
  const clip = o.clip && typeof o.clip === 'object' ? { url: httpOrEmpty(o.clip.url), start: str(o.clip.start, 24), end: str(o.clip.end, 24) } : null;
  const origin = o.origin && typeof o.origin === 'object' ? { from: str(o.origin.from, 120), path: str(o.origin.path, 1000), id: str(String(o.origin.id == null ? '' : o.origin.id), 60) } : null;
  const generated = generatedOf(src.generated);
  // A transition or a piece of music: what FLPT needs to place it (a card or an overlay with its cut point) or credit it.
  const a = o.addon && typeof o.addon === 'object' ? o.addon : null;
  const addon = a ? {
    ref: str(a.ref, 80), group: str(a.group, 60), style: ADDON_STYLES.includes(a.style) ? a.style : null,
    cut: num(a.cut) != null && num(a.cut) >= 0 && num(a.cut) < 60 ? num(a.cut) : null,
    credit: str(a.credit, 2000), license: str(a.license, 80), licenseUrl: httpOrEmpty(a.licenseUrl), changes: str(a.changes, 1000),
  } : null;
  const kind = ALL_KINDS.includes(o.kind) ? o.kind : 'note';
  return {
    id: id || str(o.id, 100),
    kind,
    private: PRIVATE_KINDS.includes(kind),
    title: str(o.title, MAX.title).trim() || 'Untitled',
    notes: str(o.notes, MAX.notes),
    tags: cleanTags(o.tags),
    source: { url: httpOrEmpty(src.url), site: str(src.site, 120), author: str(src.author, 200), authorUrl: httpOrEmpty(src.authorUrl), rights: str(src.rights, 400),
      description: str(src.description, generated ? 4000 : 1000), ...(generated ? { generated } : {}) },
    file: inFolder(o.file),
    thumb: inFolder(o.thumb),
    snapshot: inFolder(o.snapshot),
    audio: inFolder(o.audio),
    thumbW: num(o.thumbW),
    thumbH: num(o.thumbH),
    width: num(o.width),
    height: num(o.height),
    duration: num(o.duration),
    bytes: num(o.bytes),
    clip: clip && (clip.url || clip.start || clip.end) ? clip : null,
    addedBy: ADDED_BY.includes(o.addedBy) ? o.addedBy : 'you',
    addedAt: validIso(o.addedAt) || new Date(0).toISOString(),
    updatedAt: validIso(o.updatedAt),
    usedIn: Array.isArray(o.usedIn) ? o.usedIn.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.slice(0, 200)).slice(0, 500) : [],
    sha256: typeof o.sha256 === 'string' && /^[0-9a-f]{64}$/.test(o.sha256) ? o.sha256 : null,
    origin: origin && (origin.from || origin.path) ? origin : null,
    addon: addon && Object.values(addon).some((v) => v !== null && v !== '') ? addon : null,
  };
}

/** A folder with a reference's own contents: its mark or its style card (whatever its record says). */
function hasReferenceContents(folder) {
  if (isFile(path.join(folder, REFERENCE_MARK))) return true;
  try { const j = JSON.parse(fs.readFileSync(path.join(folder, 'card.json'), 'utf8')); return Boolean(j && j.schema === 'flpt.stylecard/1'); } catch { return false; }
}

/** A Library folder that holds a reference: its mark, a style card, or a record saying so. */
function isReferenceFolder(folder) {
  if (hasReferenceContents(folder)) return true;
  try { const j = JSON.parse(fs.readFileSync(path.join(folder, 'item.json'), 'utf8')); return Boolean(j && PRIVATE_KINDS.includes(j.kind)); } catch { return false; }
}

function folderBytes(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) n += folderBytes(p);
    else if (e.isFile()) n += fs.statSync(p).size;
  }
  return n;
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function hashFile(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(p).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

/** Copy (or move) a file in. A clone on APFS when it can be: instant, and the source is never touched. */
async function bring(src, dest, move) {
  if (move) {
    try { fs.renameSync(src, dest); return; } catch (e) { if (e.code !== 'EXDEV') throw e; }
    await fs.promises.copyFile(src, dest, fs.constants.COPYFILE_FICLONE);
    fs.rmSync(src, { force: true });
    return;
  }
  await fs.promises.copyFile(src, dest, fs.constants.COPYFILE_FICLONE);
}

// ── the Cutaway Library (Michael's catalogue of brief pop-culture excerpts) ─────────────────────────────────────

/** The source interval of a catalogue entry, in seconds: [start, end] or null. */
function cutawayInterval(e) {
  const pair = (a) => (Array.isArray(a) && a.length === 2 && a.every((x) => Number.isFinite(Number(x))) ? a.map(Number) : null);
  const iv = pair(e.source_interval);
  if (iv) return iv;
  const m = /(\d+(?::\d{1,2}){0,2}(?:\.\d+)?)\s*[–—-]\s*(\d+(?::\d{1,2}){0,2}(?:\.\d+)?)/.exec(String(e.source_excerpt || ''));
  if (m && parseTime(m[1]) != null && parseTime(m[2]) != null) return [parseTime(m[1]), parseTime(m[2])];
  return pair(e.trim);
}

/** Item fields for one catalog.json entry: titles, the "good moment to use it" note, the source and its timestamps. */
function cutawayItem(e) {
  const source = String(e.source || '');
  const u = linkmeta.parseHttpUrl(source);
  const iv = cutawayInterval(e);
  const cat = String(e.category || '').toLowerCase().trim();
  const useText = [e.use, e.category, e.title].filter(Boolean).join(' ');
  const tags = cleanTags([CUTAWAY.toLowerCase().split(' ')[0], e.work, CUTAWAY_CATEGORY[cat] || cat,
    ...USE_TAGS.filter(([, re]) => re.test(useText)).map(([t]) => t)]).slice(0, 8);
  return {
    kind: 'clip',
    title: str(e.title || e.label || e.name || '', MAX.title) || 'Untitled clip',
    notes: [e.use, e.excerpt_note, e.quote ? `“${e.quote}”` : ''].filter((x) => typeof x === 'string' && x.trim()).join('\n'),
    tags,
    source: { url: u ? u.href : '', site: u ? linkmeta.siteName(u) : '', author: '', rights: `Brief excerpt, not rights-cleared.${e.watermark ? ` ${String(e.watermark).replace(/\.$/, '')}.` : ''}` },
    clip: u && iv ? { url: linkmeta.cleanYouTubeUrl(u.href) || u.href, start: formatTime(iv[0]), end: formatTime(iv[1]) } : null,
    width: num(e.width),
    height: num(e.height),
    duration: num(e.duration),
    addedBy: 'import',
    origin: { from: CUTAWAY, path: String(e.video || ''), id: String(e.id == null ? '' : e.id) },
  };
}

// ── the library ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} d
 * @param {string} d.dir             the Library folder
 * @param {(p: string) => Promise<void>} d.trash   moves a folder to the Trash (Electron's shell.trashItem)
 * @param {object} [d.media]         createMedia(): probe, imageSize, imageThumb, videoThumb, documentThumb, snapshot
 * @param {Function} [d.fetch]       fetch for links (Electron's net.fetch); without it, links can't be saved
 * @param {Function} [d.onChange]    called after anything changes (the app tells its windows)
 */
function createLibrary({ dir, trash, media = {}, fetch: fetchImpl = null, onChange = () => {}, log = () => {} }) {
  if (!dir || !path.isAbsolute(dir)) throw new Error('The Library needs an absolute folder.');
  const itemsDir = path.join(dir, 'items');
  const incoming = path.join(dir, '.incoming');
  const indexFile = path.join(dir, 'library.json');
  let cache = null; // { items, ids: Set }
  const changed = () => { try { onChange(); } catch { /* a window went away */ } };

  const assertId = (id) => { if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error('No such item.'); return id; };
  const itemDir = (id) => path.join(itemsDir, assertId(id));

  function folders() {
    try { return fs.readdirSync(itemsDir).filter((n) => ID_RE.test(n) && isDir(path.join(itemsDir, n))); } catch { return []; }
  }

  function sorted(items) { return items.sort((a, b) => b.addedAt.localeCompare(a.addedAt) || a.id.localeCompare(b.id)); }

  function writeIndex(items) {
    fs.mkdirSync(dir, { recursive: true });
    writeJsonAtomic(indexFile, { v: 1, note: 'An index of items/*/item.json. FLPT rebuilds it from those files whenever needed.', updatedAt: new Date().toISOString(), count: items.length, items });
    cache = { items, ids: new Set(items.map((i) => i.id)) };
  }

  /**
   * A record as its folder says it is: a reference's folder (its mark, its card) makes it a reference, private,
   * whatever a hand-edited item.json or index says about its kind.
   */
  function asStored(item) {
    if (item.kind === 'reference' || !hasReferenceContents(path.join(itemsDir, item.id))) return item;
    return normalize({ ...item, kind: 'reference', file: item.file, sha256: null }, item.id);
  }

  /** A folder that lost its item.json (or has a damaged one) still shows up: rebuilt from what's in it. */
  function recover(id) {
    const folder = path.join(itemsDir, id);
    const json = path.join(folder, 'item.json');
    if (exists(json)) fs.renameSync(json, path.join(folder, `item.json.unreadable-${Date.now()}`)); // keep it, never delete
    const st = fs.statSync(folder);
    if (isReferenceFolder(folder)) {
      // A reference stays a reference (private), whatever happened to its record.
      const file = ['motion.mp4', ...fs.readdirSync(folder).filter((f) => /^source\./.test(f)).sort()].find((f) => isFile(path.join(folder, f))) || null;
      const item = normalize({ kind: 'reference', title: id, file, thumb: exists(path.join(folder, 'thumb.jpg')) ? 'thumb.jpg' : null,
        addedBy: 'you', addedAt: st.birthtime.toISOString(), notes: '' }, id);
      writeJsonAtomic(path.join(folder, 'item.json'), item);
      return item;
    }
    const files = fs.readdirSync(folder).filter((f) => !f.startsWith('.') && !RESERVED.has(f) && !/\.unreadable-\d+$/.test(f) && mediaType(f));
    const file = files.find((f) => mediaType(f) !== 'audio' || files.length === 1) || null;
    const item = normalize({ kind: file ? kindForFile(file) : 'note', title: file ? titleFromFilename(file) : id, file, thumb: exists(path.join(folder, 'thumb.jpg')) ? 'thumb.jpg' : null,
      addedBy: 'you', addedAt: st.birthtime.toISOString(), notes: '' }, id);
    writeJsonAtomic(path.join(folder, 'item.json'), item);
    return item;
  }

  /** Re-read every item folder and rewrite the index. Finishes adds a crash interrupted. Returns { count, recovered }. */
  function rebuild() {
    // An add that had written its item.json but not yet been moved into items/: finish it.
    try {
      for (const n of fs.readdirSync(incoming)) {
        const from = path.join(incoming, n);
        if (ID_RE.test(n) && isFile(path.join(from, 'item.json')) && !exists(path.join(itemsDir, n))) {
          fs.mkdirSync(itemsDir, { recursive: true });
          fs.renameSync(from, path.join(itemsDir, n));
        }
      }
    } catch { /* nothing incoming */ }
    const items = [];
    const recovered = [];
    for (const id of folders()) {
      try {
        items.push(asStored(normalize(JSON.parse(fs.readFileSync(path.join(itemsDir, id, 'item.json'), 'utf8')), id)));
      } catch {
        try { items.push(recover(id)); recovered.push(id); } catch (e) { log(`library: couldn't recover ${id}: ${e.message}`); }
      }
    }
    writeIndex(sorted(items));
    return { count: items.length, recovered };
  }

  /** The items, from the index when it agrees with the folders on disk; otherwise rebuilt first. */
  function load() {
    const names = folders();
    if (cache && cache.ids.size === names.length && names.every((n) => cache.ids.has(n))) return cache.items;
    // Nothing kept yet: nothing to write either (the folder appears with the first item).
    if (!names.length && !exists(indexFile) && !isDir(incoming)) { cache = { items: [], ids: new Set() }; return cache.items; }
    try {
      const idx = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
      if (idx && idx.v === 1 && Array.isArray(idx.items)) {
        const items = idx.items.filter((i) => i && typeof i.id === 'string' && ID_RE.test(i.id)).map((i) => asStored(normalize(i, i.id)));
        const ids = new Set(items.map((i) => i.id));
        if (ids.size === items.length && ids.size === names.length && names.every((n) => ids.has(n))) {
          cache = { items: sorted(items), ids };
          return cache.items;
        }
      }
    } catch { /* missing or corrupt: rebuild */ }
    rebuild();
    return cache.items;
  }

  // Index updates start from the cached index (rereading every item.json on each add would make imports slow);
  // anything that changed behind our back is caught by the next load(), which compares against the folders.
  function put(item) {
    const items = (cache ? cache.items : load()).filter((i) => i.id !== item.id);
    items.push(item);
    writeIndex(sorted(items));
  }

  /** An item with absolute paths for its files, for the app (the index keeps them relative). */
  function resolve(item) {
    const d = path.join(itemsDir, item.id);
    const abs = (f) => (f ? path.join(d, f) : null);
    return { ...item, dir: d, filePath: abs(item.file), thumbPath: abs(item.thumb), snapshotPath: abs(item.snapshot), audioPath: abs(item.audio) };
  }

  function newId(title, kind) {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    for (;;) {
      const id = `${day}-${slug(title) || kind || 'item'}-${crypto.randomBytes(3).toString('hex').slice(0, 4)}`;
      if (!exists(path.join(itemsDir, id)) && !exists(path.join(incoming, id))) return id;
    }
  }

  // Never a reference: the same picture or link added to the Library is its own (public) item.
  const byHash = (sha) => load().find((i) => !i.private && i.sha256 && i.sha256 === sha) || null;
  // A saved link (or a picture saved from it). A clip isn't a copy of its video's link: it's one moment of it.
  const byLink = (key) => (key ? load().find((i) => !i.private && i.kind !== 'clip' && linkKey(i.source.url) === key) || null : null);
  const shown = (it, includePrivate) => includePrivate === true || !it.private;

  async function thumbnailFor(stage, mainFile, type, { thumbFrom, duration }) {
    const out = path.join(stage, 'thumb.jpg');
    let ok = false;
    try {
      if (thumbFrom && media.imageThumb) ok = await media.imageThumb(thumbFrom, out);
      if (!ok && mainFile && type === 'image' && media.imageThumb) ok = await media.imageThumb(mainFile, out);
      if (!ok && mainFile && type === 'video' && media.videoThumb) ok = await media.videoThumb(mainFile, out, duration || 0);
      if (!ok && mainFile && type === 'document' && media.documentThumb) ok = await media.documentThumb(mainFile, out);
    } catch (e) { log(`library: thumbnail failed: ${e.message}`); ok = false; }
    if (!ok || !isFile(out)) { fs.rmSync(out, { force: true }); return null; }
    const size = media.imageSize ? await media.imageSize(out).catch(() => null) : null;
    return { thumb: 'thumb.jpg', thumbW: size ? size.width : null, thumbH: size ? size.height : null };
  }

  /**
   * Add one item. Input: kind, title, notes, tags, source {url, site, author, rights, description}, clip {url, start,
   * end}, addedBy, origin; file (an absolute path to copy in, or move with move: true), audio (a companion WAV),
   * thumbFrom (a picture to make the thumbnail from), width/height/duration when already known.
   * The same file twice (by SHA-256) comes back as the existing item, marked duplicate.
   */
  async function add(input = {}) {
    const type = input.file ? mediaType(input.file) : null;
    if (input.file && !type) throw new Error(`FLPT's Library keeps pictures, video, sound and documents, not ${path.extname(String(input.file)) || 'that kind of file'}.`);
    const kind = KINDS.includes(input.kind) ? input.kind : (type ? KIND_FOR_TYPE[type] : (input.source && input.source.url ? 'website' : 'note'));
    if (input.file && !isFile(input.file)) throw new Error(`Couldn't find ${path.basename(String(input.file))}.`);
    let sha256 = null;
    if (input.file) {
      sha256 = await hashFile(input.file);
      const dup = input.dedupe === false ? null : byHash(sha256);
      if (dup) { if (input.move) fs.rmSync(input.file, { force: true }); return { ...resolve(dup), duplicate: true }; }
    }
    const title = str(input.title, MAX.title).trim() || (input.file ? titleFromFilename(input.file) : 'Untitled');
    const id = newId(title, kind);
    const stage = path.join(incoming, id);
    fs.mkdirSync(stage, { recursive: true });
    try {
      let file = null;
      let bytes = null;
      let mainFile = null;
      if (input.file) {
        file = safeName(input.fileName || path.basename(input.file), slug(title) || kind);
        mainFile = path.join(stage, file);
        await bring(input.file, mainFile, Boolean(input.move));
        bytes = fs.statSync(mainFile).size;
      }
      let audio = null;
      if (input.audio && isFile(input.audio)) {
        audio = safeName(input.audioName || path.basename(input.audio), 'sound');
        if (audio === file) audio = `sound-${audio}`;
        await bring(input.audio, path.join(stage, audio), Boolean(input.move));
      }
      let { width = null, height = null, duration = null } = input;
      if (mainFile && (type === 'video' || type === 'audio') && media.probe) {
        const p = await media.probe(mainFile).catch(() => null);
        if (p) { duration = p.duration || duration; width = p.width || width; height = p.height || height; }
      }
      if (mainFile && type === 'image' && media.imageSize && !(width && height)) {
        const s = await media.imageSize(mainFile).catch(() => null);
        if (s) ({ width, height } = s);
      }
      const t = await thumbnailFor(stage, mainFile, type, { thumbFrom: input.thumbFrom, duration });
      const item = normalize({
        id, kind, title, notes: str(input.notes, MAX.notes), tags: input.tags, source: input.source || {}, file, audio,
        ...(t || {}), width, height, duration, bytes, clip: input.clip || null,
        addedBy: ADDED_BY.includes(input.addedBy) ? input.addedBy : 'you', addedAt: new Date().toISOString(), usedIn: [], sha256, origin: input.origin || null,
        addon: input.addon || null,
      }, id);
      writeJsonAtomic(path.join(stage, 'item.json'), item);
      fs.mkdirSync(itemsDir, { recursive: true });
      fs.renameSync(stage, path.join(itemsDir, id));
      put(item);
      changed();
      return resolve(item);
    } catch (e) {
      fs.rmSync(stage, { recursive: true, force: true }); // only our own half-built copy
      throw e;
    }
  }

  /**
   * Add a reference (references.js): `build(folder)` fills a fresh folder (frames/, motion.mp4, source.*, card.json…)
   * and returns { file, thumbFrom, width, height, duration, title? } with paths inside it. The folder moves into items/ with
   * one rename once the record is written; anything that fails leaves nothing behind. Private, never deduplicated.
   */
  async function addReference({ title = '', notes = '', tags = [], source = {}, build } = {}) {
    if (typeof build !== 'function') throw new Error('A reference needs its contents.');
    const name = str(title, MAX.title).trim() || 'Reference';
    const id = newId(name, 'reference');
    const stage = path.join(incoming, id);
    fs.mkdirSync(stage, { recursive: true });
    fs.writeFileSync(path.join(stage, REFERENCE_MARK), '');
    try {
      const made = (await build(stage)) || {};
      const inside = (p) => (typeof p === 'string' && p && path.resolve(stage, p).startsWith(stage + path.sep) && isFile(path.resolve(stage, p)) ? path.resolve(stage, p) : null);
      const main = inside(made.file);
      const file = main && path.dirname(main) === stage ? path.basename(main) : null;
      const type = main ? mediaType(main) : null;
      const t = await thumbnailFor(stage, null, type, { thumbFrom: inside(made.thumbFrom) || main });
      const item = normalize({
        id, kind: 'reference', title: str(made.title, MAX.title).trim() || name, notes: str(notes, MAX.notes), tags, source, file, ...(t || {}),
        width: num(made.width), height: num(made.height), duration: num(made.duration), bytes: folderBytes(stage),
        addedBy: 'you', addedAt: new Date().toISOString(), usedIn: [], sha256: null, origin: null,
      }, id);
      writeJsonAtomic(path.join(stage, 'item.json'), item);
      fs.mkdirSync(itemsDir, { recursive: true });
      fs.renameSync(stage, path.join(itemsDir, id));
      put(item);
      changed();
      return resolve(item);
    } catch (e) {
      fs.rmSync(stage, { recursive: true, force: true }); // only our own half-built folder
      throw e;
    }
  }

  function get(id, { includePrivate = false } = {}) {
    assertId(id);
    const it = load().find((i) => i.id === id && shown(i, includePrivate));
    // The folder has the last word: a reference whose record was changed behind the Library's back still isn't offered.
    if (!it || (!includePrivate && hasReferenceContents(path.join(itemsDir, id)))) throw new Error('That item isn\'t in the Library any more.');
    return resolve(it);
  }

  function list({ includePrivate = false } = {}) { return load().filter((i) => shown(i, includePrivate)).map(resolve); }

  /** Items matching every word of the query (title, notes, tags, source), best first, then newest. */
  function search(query = '', { kind = null, tag = null, includePrivate = false } = {}) {
    const words = fold(query).split(/\s+/).filter(Boolean).slice(0, 12);
    const wantTag = tag ? fold(tag).trim() : null;
    const out = [];
    for (const it of load()) {
      if (!shown(it, includePrivate)) continue;
      if (kind && it.kind !== kind) continue;
      if (wantTag && !it.tags.includes(wantTag)) continue;
      let score = 0;
      if (words.length) {
        const title = fold(it.title);
        const tags = it.tags.map(fold);
        const rest = fold([it.notes, it.kind, it.source.url, it.source.site, it.source.author, it.source.description, it.source.rights, it.clip && it.clip.url, it.file, it.origin && it.origin.path, ...it.usedIn].join(' \n '));
        let all = true;
        for (const w of words) {
          if (title.includes(w)) score += 3;
          else if (tags.some((t) => t.includes(w))) score += 2;
          else if (rest.includes(w)) score += 1;
          else { all = false; break; }
        }
        if (!all) continue;
      }
      out.push({ it, score });
    }
    return out.sort((a, b) => b.score - a.score || b.it.addedAt.localeCompare(a.it.addedAt)).map((x) => resolve(x.it));
  }

  /** Tags and kinds in use, most common first (for the filters). */
  function facets({ includePrivate = false } = {}) {
    const tags = new Map();
    const kinds = new Map();
    for (const it of load()) {
      if (!shown(it, includePrivate)) continue;
      kinds.set(it.kind, (kinds.get(it.kind) || 0) + 1);
      for (const t of it.tags) tags.set(t, (tags.get(t) || 0) + 1);
    }
    const order = (m) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }));
    return { tags: order(tags), kinds: order(kinds) };
  }

  function readRaw(id) {
    const file = path.join(itemDir(id), 'item.json');
    try { return { file, raw: JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { throw new Error('That item isn\'t in the Library any more.'); }
  }

  /**
   * Change an item's title, notes or tags (and, for a piece of music in the Transitions & Music repository, its credit
   * line): nothing else. Unknown fields in item.json are kept as they are.
   */
  function update(id, patch = {}) {
    const { file, raw } = readRaw(id);
    if (typeof patch.title === 'string' && patch.title.trim()) raw.title = patch.title.trim().slice(0, MAX.title);
    if (typeof patch.notes === 'string') raw.notes = patch.notes.slice(0, MAX.notes);
    if (patch.tags !== undefined) raw.tags = cleanTags(patch.tags);
    if (typeof patch.credit === 'string' && raw.kind === 'music') raw.addon = { ...(raw.addon && typeof raw.addon === 'object' ? raw.addon : {}), credit: patch.credit.trim().slice(0, 2000) };
    raw.updatedAt = new Date().toISOString();
    writeJsonAtomic(file, raw);
    const item = normalize(raw, id);
    put(item);
    changed();
    return resolve(item);
  }

  /** Note that an episode used an item (the episode flow calls this). */
  function markUsed(id, episodeTitle) {
    const { file, raw } = readRaw(id);
    const t = String(episodeTitle || '').trim().slice(0, 200);
    if (!t) return get(id);
    raw.usedIn = [...new Set([...(Array.isArray(raw.usedIn) ? raw.usedIn : []), t])];
    writeJsonAtomic(file, raw);
    const item = normalize(raw, id);
    put(item);
    changed();
    return resolve(item);
  }

  /** Attach a page snapshot to a link item; it becomes the thumbnail too when the item has none. */
  async function attachSnapshot(id, png) {
    const { file, raw } = readRaw(id);
    const folder = itemDir(id);
    await bring(png, path.join(folder, 'snapshot.png'), true);
    raw.snapshot = 'snapshot.png';
    if (!raw.thumb && media.imageThumb && (await media.imageThumb(path.join(folder, 'snapshot.png'), path.join(folder, 'thumb.jpg')).catch(() => false))) {
      raw.thumb = 'thumb.jpg';
      const s = media.imageSize ? await media.imageSize(path.join(folder, 'thumb.jpg')).catch(() => null) : null;
      raw.thumbW = s ? s.width : null;
      raw.thumbH = s ? s.height : null;
    }
    raw.updatedAt = new Date().toISOString();
    writeJsonAtomic(file, raw);
    const item = normalize(raw, id);
    put(item);
    changed();
    return resolve(item);
  }

  /** Move an item's folder to the Trash. It can be put back from there; the Library notices it on its next look. */
  async function remove(id) {
    const folder = itemDir(id);
    if (!isDir(folder)) throw new Error('That item isn\'t in the Library any more.');
    await trash(folder);
    if (exists(folder)) throw new Error('Couldn\'t move it to the Trash.');
    writeIndex((cache ? cache.items : load()).filter((i) => i.id !== id));
    changed();
    return true;
  }

  // ── links ──

  async function downloadImage(url, maxBytes = 25 << 20) {
    const r = await linkmeta.fetchLimited(fetchImpl, url, { maxBytes, accept: 'image/*' });
    const type = r.type.split(';')[0].trim();
    const ext = IMAGE_TYPES[type] || (linkmeta.IMAGE_EXT.test(new URL(r.url).pathname) ? path.extname(new URL(r.url).pathname).toLowerCase() : null);
    if (!ext || !r.body.length) throw new Error('That link isn\'t a picture FLPT can keep.');
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'flpt-link-')), `image${ext}`);
    fs.writeFileSync(tmp, r.body);
    return { file: tmp, finalUrl: r.url };
  }

  const tmpCleanup = (p) => { if (p) fs.rmSync(path.dirname(p), { recursive: true, force: true }); };

  /**
   * Save a link: a picture is downloaded; a YouTube link becomes a video-link (title, channel and thumbnail from
   * YouTube's oEmbed, the video itself never downloaded); Wikipedia → wiki; anything else → article or website, with
   * its og:title, og:description and og:image, and then (in the background, one at a time) a snapshot of the page.
   * A link already in the Library comes back marked duplicate.
   */
  let snapQueue = Promise.resolve();
  async function saveLink(opts = {}) {
    const item = await saveLinkNow(opts);
    if (opts.snapshot !== false && !item.duplicate && media.snapshot) snapQueue = snapQueue.then(() => snapshotLink(item)).catch(() => null);
    return item;
  }

  async function saveLinkNow({ url, title = '', kind = null, notes = '', tags = [], addedBy = 'you' } = {}) {
    if (!fetchImpl) throw new Error('Saving links isn\'t available here.');
    const u = linkmeta.parseHttpUrl(url);
    if (!u) throw new Error('That isn\'t a web link (it should start with http:// or https://).');
    const by = ADDED_BY.includes(addedBy) ? addedBy : 'you';
    const crew = by === 'crew';
    if (crew && linkmeta.isPrivateHost(u.hostname)) throw new Error('The crew can only save public web links.');
    const base = { notes: str(notes, MAX.notes), tags: cleanTags(tags), addedBy: by };
    const key = linkKey(u.href);
    const dup = byLink(key);
    if (dup) return { ...resolve(dup), duplicate: true };

    // YouTube: recorded, never downloaded.
    const yt = linkmeta.cleanYouTubeUrl(u.href);
    if (yt) {
      const o = await linkmeta.youtubeOembed(fetchImpl, yt);
      let thumb = null;
      try { thumb = await downloadImage((o && o.thumbnail) || `https://i.ytimg.com/vi/${linkmeta.youtubeId(yt)}/hqdefault.jpg`, 5 << 20); } catch { /* no preview */ }
      try {
        return await add({ ...base, kind: 'video-link', title: title || (o && o.title) || `YouTube video ${linkmeta.youtubeId(yt)}`,
          source: { url: yt, site: 'YouTube', author: (o && o.author) || '', authorUrl: (o && o.authorUrl) || '' }, thumbFrom: thumb && thumb.file });
      } finally { tmpCleanup(thumb && thumb.file); }
    }
    // A direct link to a video file: recorded only, for the same reason.
    if (linkmeta.guessFromUrl(u) === 'video') {
      return add({ ...base, kind: 'video-link', title: title || titleFromFilename(u.pathname), source: { url: u.href, site: linkmeta.siteName(u) } });
    }

    const r = await linkmeta.fetchLimited(fetchImpl, u.href, {
      accept: 'text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.8',
      limitFor: (type) => {
        if (type.startsWith('image/')) return { maxBytes: 25 << 20, truncate: false };
        if (type.includes('pdf') && !crew) return { maxBytes: 80 << 20, truncate: false };
        if (type.startsWith('video/') || type.startsWith('audio/') || type.includes('pdf')) return { maxBytes: 0, truncate: true };
        return { maxBytes: 2 << 20, truncate: true };
      },
    });
    const finalUrl = linkmeta.parseHttpUrl(r.url) || u;
    const type = r.type.split(';')[0].trim();
    if (type.startsWith('image/')) {
      const ext = IMAGE_TYPES[type];
      if (!ext) throw new Error('That kind of picture can\'t be kept yet.');
      const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'flpt-link-')), safeName(`${titleFromFilename(u.pathname) || 'image'}${ext}`, 'image'));
      fs.writeFileSync(tmp, r.body);
      try {
        return await add({ ...base, kind: 'image', file: tmp, move: true, title: title || titleFromFilename(u.pathname), source: { url: u.href, site: linkmeta.siteName(finalUrl) } });
      } finally { tmpCleanup(tmp); }
    }
    if (type.startsWith('video/') || type.startsWith('audio/')) {
      return add({ ...base, kind: 'video-link', title: title || titleFromFilename(u.pathname), source: { url: u.href, site: linkmeta.siteName(finalUrl) } });
    }
    if (type.includes('pdf') && !crew) {
      const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'flpt-link-')), safeName(`${titleFromFilename(u.pathname)}.pdf`, 'document'));
      fs.writeFileSync(tmp, r.body);
      try {
        return await add({ ...base, kind: 'document', file: tmp, move: true, title: title || titleFromFilename(u.pathname), source: { url: u.href, site: linkmeta.siteName(finalUrl) } });
      } finally { tmpCleanup(tmp); }
    }

    // A page.
    let html = '';
    const charset = (/charset=([\w-]+)/i.exec(r.type) || /<meta[^>]+charset=["']?([\w-]+)/i.exec(r.body.subarray(0, 4096).toString('latin1')) || [])[1] || 'utf-8';
    try { html = new TextDecoder(charset.toLowerCase(), { fatal: false }).decode(r.body); } catch { html = r.body.toString('utf8'); }
    const meta = linkmeta.parseMeta(html, finalUrl.href);
    let k = LINK_KINDS.includes(kind) ? kind : linkmeta.pageKind(finalUrl, meta);
    if (k === 'wiki' || /(^|\.)wikipedia\.org$/i.test(finalUrl.hostname)) {
      k = 'wiki';
      const w = await linkmeta.wikipediaSummary(fetchImpl, finalUrl);
      if (w) { meta.title = w.title || meta.title; meta.description = w.description || meta.description; meta.image = w.image || meta.image; }
    }
    let thumb = null;
    if (meta.image) { try { thumb = await downloadImage(meta.image, 10 << 20); } catch { /* no preview */ } }
    try {
      return await add({ ...base, kind: k, title: title || meta.title || finalUrl.hostname.replace(/^www\./, ''),
        source: { url: u.href, site: meta.site || linkmeta.siteName(finalUrl), author: meta.author, description: meta.description }, thumbFrom: thumb && thumb.file });
    } finally { tmpCleanup(thumb && thumb.file); }
  }

  /** Snapshot a link item's page in the background (a page that disappears later isn't lost). */
  async function snapshotLink(item) {
    if (!media.snapshot || !item || item.file || item.snapshot || !['article', 'website', 'wiki'].includes(item.kind)) return null;
    const u = linkmeta.parseHttpUrl(item.source.url);
    if (!u || linkmeta.isPrivateHost(u.hostname)) return null;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flpt-snap-out-'));
    try {
      const png = path.join(tmpDir, 'snapshot.png');
      if (!(await media.snapshot(u.href, png))) return null;
      if (!exists(path.join(itemsDir, item.id))) return null; // removed meanwhile
      return await attachSnapshot(item.id, png);
    } catch (e) {
      log(`library: snapshot failed: ${e.message}`);
      return null;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  /** Add a file from this Mac. The crew may add pictures only. */
  async function addFile(filePath, meta = {}) {
    const p = typeof filePath === 'string' && path.isAbsolute(filePath) ? path.resolve(filePath) : null;
    if (!p || !isFile(p)) throw new Error('That file isn\'t there.');
    const type = mediaType(p);
    if (!type) throw new Error(`FLPT's Library keeps pictures, video, sound and documents, not ${path.extname(p) || 'that kind of file'}.`);
    const by = ADDED_BY.includes(meta.addedBy) ? meta.addedBy : 'you';
    if (by === 'crew' && type !== 'image') throw new Error('The crew can save links and pictures to the Library, nothing else.');
    const kind = KINDS.includes(meta.kind) && !LINK_KINDS.includes(meta.kind) ? meta.kind : KIND_FOR_TYPE[type];
    return add({ kind, file: p, title: meta.title, notes: meta.notes, tags: meta.tags, source: meta.source, clip: meta.clip, origin: meta.origin, addon: meta.addon, addedBy: by });
  }

  /**
   * Copy Michael's Cutaway Library in: every clip in catalog.json (its MP4, its WAV and its preview) with its title,
   * "good moment to use it" note, source and timestamps, plus the clips in "My Downloads". Read-only on the source:
   * files are copied out, nothing there is written, moved or renamed. Already-imported clips are skipped.
   */
  async function importCutaway(srcDir, { onProgress = () => {} } = {}) {
    const real = fs.realpathSync(srcDir);
    let catalog;
    try { catalog = JSON.parse(fs.readFileSync(path.join(real, 'catalog.json'), 'utf8')); } catch { throw new Error('That folder has no readable catalog.json.'); }
    if (!Array.isArray(catalog)) throw new Error('catalog.json isn\'t a list of clips.');
    const inside = (rel) => {
      if (typeof rel !== 'string' || !rel) return null;
      try { const p = fs.realpathSync(path.resolve(real, rel)); return p.startsWith(real + path.sep) && isFile(p) ? p : null; } catch { return null; }
    };
    const jobs = catalog.filter((e) => e && typeof e === 'object').map((e) => ({ rel: String(e.video || ''), meta: cutawayItem(e), audio: inside(e.audio), thumb: inside(e.thumbnail) }));
    const downloads = path.join(real, 'My Downloads');
    if (isDir(downloads)) {
      for (const f of fs.readdirSync(downloads).sort()) {
        if (f.startsWith('.') || !['video', 'image'].includes(mediaType(f))) continue;
        jobs.push({ rel: `My Downloads/${f}`, meta: { title: titleFromFilename(f), tags: ['cutaway', 'my downloads'], addedBy: 'import', origin: { from: CUTAWAY, path: `My Downloads/${f}` } } });
      }
    }
    const done = new Set(load().filter((i) => i.origin && i.origin.from === CUTAWAY).map((i) => i.origin.path));
    const out = { added: 0, skipped: 0, failed: [], total: jobs.length };
    for (let i = 0; i < jobs.length; i++) {
      const j = jobs[i];
      onProgress({ done: i, total: jobs.length, title: j.meta.title });
      if (done.has(j.rel)) { out.skipped += 1; continue; }
      const file = inside(j.rel);
      if (!file) { out.failed.push({ title: j.meta.title, error: 'file missing' }); continue; }
      try {
        const it = await add({ ...j.meta, file, audio: j.audio, thumbFrom: j.thumb });
        if (it.duplicate) out.skipped += 1; else out.added += 1;
      } catch (e) {
        out.failed.push({ title: j.meta.title, error: e.message });
      }
    }
    onProgress({ done: jobs.length, total: jobs.length });
    return out;
  }

  return {
    dir, itemsDir, indexFile, add, get, list, search, facets, update, remove, rebuild, markUsed, attachSnapshot, snapshotLink,
    saveLink, addFile, importCutaway, addReference, idle: () => snapQueue,
  };
}

module.exports = {
  createLibrary, normalize, cutawayItem, cutawayInterval, titleFromFilename, safeName, cleanTags, linkKey, mediaType, kindForFile,
  isReferenceFolder, KINDS, PRIVATE_KINDS, LINK_KINDS, ADDED_BY, ID_RE, TYPES, EXTENSIONS, REFERENCE_MARK,
};
