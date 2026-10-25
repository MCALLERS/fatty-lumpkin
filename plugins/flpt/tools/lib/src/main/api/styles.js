'use strict';
// flpt.styles: the styles repository (styles.js, W1-10) as the Style Gallery sees it (PLAN §2.10, §3.3 S12–S13; W3-01).
// The page names a style by its key, "<scope>:<id>" ("shipped:riso", "mine:riso-mine", "shared:dusk@1.2.0"), never a
// path; media reach it as URLs the surface's host makes (the Mac: shell/gallery.js's flpt-gallery:// scheme, which
// serves only a style's poster, loops and declared fonts, with CORS so the wall's one AudioContext can hear them).
//   list()              every usable tile in Gallery order (shipped, then Mine, then Shared once a verified catalog holds
//                       one): { tiles, counts, shared }
//   get(key)            one style's detail: swatches, type, three tags, the sound default, credit, licence, the recipe
//                       (STYLE.md, read-only), what may be done with it
//   fork(key, name?)    Duplicate: a Mine copy (<id>-mine, 0.1.0; its LICENSE and credits kept; the media copied)
//   remove(key)         a Mine style set aside (Styles/mine/.removed/), never deleted → { token } for restore(token)
//   restore(token)      Undo: the style back where it was
//   importFile()        a .flptstyle from the native dialog into Mine, checked and linted (styles.importStyle); its poster
//                       and loops are rendered here from its own starter, sandboxed, then styles:changed says so
//   inspiration()       engine/styles/inspiration.json's six places (names, lines, tags, whether Capture is offered)
//   openLink(id)        one of them, in the user's browser (the URL from the file, never from the page)
// Event: styles:changed after anything here changes a collection. Nothing here costs anything or reaches the network.
// The catalog (W3-11, PLAN §2.10.3): every call reads the repository through the signed catalog client's guard
// (catalog.guard), so a style withdrawn for rights, quality or security has no tile, no media served, and can't be
// Used, Duplicated or detailed; Shared shows only as the catalog installed it.
// Also exported for the host (shell/gallery.js): repoFor(c), keyOf, parseKey, mediaOf(c, rec), resolveMedia(c, scope,
// ref, file), resolveFont(c, scope, ref, n), sharedShown(c), catalogOf(c).
const fs = require('fs');
const path = require('path');
const stylesLib = require('../styles');

const KEY_RE = /^(shipped|mine|shared):([a-z0-9][a-z0-9-]{0,47})(?:@((?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,4})\.(?:0|[1-9]\d{0,5})))?$/;
const TOKEN_RE = /^([a-z0-9][a-z0-9-]{0,47})-(\d{13})$/;
const MEDIA = { poster: 'poster.jpg', posterTall: 'poster-tall.jpg', loop: 'loop.mp4', loopTall: 'loop-tall.mp4' };
const FONT_EXT = { '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const RECIPE_MAX = 8000;
const SWATCHES = 6;
const USES = { solo: 'Solo', duet: 'Duet', cosmos: 'Cosmos', interstitial: 'Solo ♪', cutscene: 'Cut scene', history: 'Histories', tech: 'Tech', maths: 'Maths', 'hand-drawn': 'Hand-drawn' };

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
// eslint-disable-next-line no-control-regex
const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const HEX = /^#[0-9a-fA-F]{6}$/;

// ── the repository, as this surface keeps it ────────────────────────────────────────────────────────────────────────

/** Where the shipped posters and loops are: the host's own (QA), else as ext/planview finds them (flpt:// serves them). */
function mediaRootFor(c) {
  if (c && c.stylesMediaRoot !== undefined) return c.stylesMediaRoot;
  try { return require('../ext/planview').mediaRoot(); } catch { return stylesLib.shippedMediaRoot(); }
}

/** The toolchain a render runs on, stamped on rendered media: the manifest's date when pinned, else "system". */
function toolchainOf(c, s) {
  if (!s || s.toolchainMode !== 'pinned') return 'system';
  try { const m = JSON.parse(fs.readFileSync(c.MANIFEST || path.join(__dirname, '..', 'toolchain-manifest.json'), 'utf8')); return /^\d{4}-\d{2}-\d{2}$/.test(String(m.version)) ? m.version : 'system'; } catch { return 'system'; }
}

/**
 * The signed catalog client (W3-11) for this call, or null: the host's own (c.catalog: QA, a server), else the one
 * api/catalog.js keeps for this projects folder (catalog.js createCatalog's instance: hasShared(), check(),
 * latestLine(), guard(repo)) once W3-11 merges. Without one, Shared, Check for new styles and the version line stay
 * hidden.
 */
const CATALOG_API = path.join(__dirname, 'catalog.js');
function catalogOf(c) {
  if (c && c.catalog) return c.catalog;
  if (!exists(CATALOG_API)) return null;
  try {
    const m = require(CATALOG_API); // eslint-disable-line global-require, import/no-dynamic-require
    const cat = m && typeof m.catalogOf === 'function' ? m.catalogOf(c || {}) : null; // throws without a projects folder
    return cat && typeof cat.hasShared === 'function' ? cat : null;
  } catch { return null; }
}

/**
 * The styles repository for this call: the engine, the projects folder's Mine and Shared, the shipped media, the
 * toolchain; through the catalog's guard when there's a catalog client (withdrawn styles hidden and refused, Shared
 * only as the catalog installed it). A repository styles.js already guards is unwrapped by guard, never guarded twice.
 */
function repoFor(c) {
  const s = c && c.settings && typeof c.settings.read === 'function' ? c.settings.read() : {};
  const cat = catalogOf(c);
  const guarded = Boolean(cat && typeof cat.guard === 'function');
  // with this call's own client, styles.js's own guard (W3-11's handoff, in createStyles) is left out: one guard, one client
  const bare = stylesLib.createStyles({
    engineRoot: c && c.engineRoot, projectsDir: (s && s.projectsDir) || null, mediaRoot: mediaRootFor(c),
    env: c && typeof c.toolEnv === 'function' ? c.toolEnv() : undefined, toolchain: toolchainOf(c, s),
    ...(guarded ? { catalog: false } : {}),
  });
  return guarded ? cat.guard(bare) : bare;
}

/** "shipped:riso" from a record; Shared carries its version (each published version is its own folder). */
const keyOf = (rec) => `${rec.scope}:${rec.id}${rec.scope === 'shared' && rec.version ? `@${rec.version}` : ''}`;
/** A key → { scope, id, version } or null. */
function parseKey(key) {
  const m = KEY_RE.exec(String(key || ''));
  return m ? { scope: m[1], id: m[2], version: m[3] || null } : null;
}

/** Is the Shared tab shown? Only when a verified catalog holds a shared style installed here (catalog.hasShared()). */
function sharedShown(c) {
  const cat = catalogOf(c);
  if (!cat || typeof cat.hasShared !== 'function') return false;
  try { return cat.hasShared() === true; } catch { return false; }
}

/**
 * A record by key; throws when there's no such style here: none by that key, a Shared one while no verified catalog
 * shows Shared, one the catalog withdrew (the guard hands it back marked, for an episode that holds its snapshot; the
 * Gallery never offers it), or, when usable, one that can't be used.
 */
function need(c, repo, key, { usable = true } = {}) {
  const k = parseKey(key);
  if (!k) throw new Error('That isn\'t a style.');
  const rec = repo.get({ id: k.id, version: k.version, scope: k.scope });
  if (!rec || rec.scope !== k.scope) throw new Error('That style is gone.');
  if (rec.scope === 'shared' && !sharedShown(c)) throw new Error('That style is gone.');
  if (rec.revoked) throw new Error(`${clean(rec.name, 40) || rec.id} was withdrawn.`);
  if (usable && !rec.ok) throw new Error(`${rec.name || rec.id}: ${rec.problem}`);
  return rec;
}

// ── what the page sees ──────────────────────────────────────────────────────────────────────────────────────────────

/** The URL the page loads one of a style's files from: the host's (flpt-gallery://), else flpt:// by path, else none. */
function urlOf(c, rec, name, abs) {
  if (!abs) return null;
  const host = c && c.galleryHost;
  if (host && typeof host.mediaUrl === 'function') return host.mediaUrl(rec.scope, rec.scope === 'shared' ? `${rec.id}@${rec.version}` : rec.id, name);
  return c && typeof c.fileUrl === 'function' ? c.fileUrl(abs) : null;
}

/** "PULSE 112" from "pulse-112"; null for none. */
const scoreLabel = (score) => (score && /^[a-z0-9-]{1,32}$/.test(score) ? score.replace(/-/g, ' ').toUpperCase() : null);

/** The sound a style plays with by default (style.json sound): { score, sfx, label }. */
function soundOf(style) {
  const s = isObj(style && style.sound) ? style.sound : {};
  const score = typeof s.score === 'string' && /^[a-z0-9-]{1,32}$/.test(s.score) ? s.score : null;
  const sfx = ['off', 'soft', 'on'].includes(s.sfx) ? s.sfx : null;
  return { score, sfx, label: scoreLabel(score) };
}

/** Three short mono tags: the pace, ones or twos, and the first look word. */
function tagsOf(rec, style) {
  const t = isObj(rec.tags) ? rec.tags : {};
  const first = (v) => clean(Array.isArray(v) ? v[0] : v, 16);
  const out = [first(t.pace), style && style.ones === true ? 'on ones' : 'on twos', first(t.look) || first(t.mood)].filter(Boolean);
  return [...new Set(out.map((x) => x.toUpperCase()))].slice(0, 3);
}

/** What a shipped style is the default for ("Solo", "Duet"…). */
function usesOf(rec) {
  if (rec.scope !== 'shipped') return [];
  return Object.entries(stylesLib.DEFAULTS).filter(([, id]) => id === rec.id).map(([u]) => USES[u] || u).slice(0, 4);
}

/** One tile: what the wall needs, no path in it. */
function tileOf(c, rec, style) {
  const m = mediaOf(c, rec);
  const credit = clean(rec.credit, 120);
  return {
    key: keyOf(rec), id: rec.id, version: rec.version, scope: rec.scope, name: clean(rec.name, 40) || rec.id, line: clean(rec.line, 80),
    tags: tagsOf(rec, style), sound: soundOf(style), uses: usesOf(rec), duetSafe: rec.duetSafe === true, port: /cth9191/i.test(`${credit} ${(rec.authors || []).join(' ')}`),
    share: ['submitted', 'approved', 'rejected'].includes(rec.share) ? rec.share : 'none',
    media: Object.fromEntries(Object.entries(MEDIA).map(([k, f]) => [k, urlOf(c, rec, f, m[k])])),
    rendering: false,
  };
}

/** One style's detail: the tile, its swatches, type, credit and licence, the recipe, and what may be done with it. */
function detailOf(c, rec) {
  const { style } = stylesLib.readStyle(rec.dir);
  const tile = tileOf(c, rec, style);
  const t = isObj(style && style.tokens) ? style.tokens : {};
  const swatches = [...new Set([t.paper, ...(Array.isArray(t.inks) ? t.inks : []), t.accent].filter((x) => HEX.test(String(x || ''))).map((x) => x.toUpperCase()))].slice(0, SWATCHES);
  const type = isObj(t.type) ? Object.entries(t.type).slice(0, 4).map(([role, family]) => ({ role: clean(role, 16), family: clean(family, 48) })).filter((x) => x.family) : [];
  const fonts = (Array.isArray(style && style.fonts) ? style.fonts : []).slice(0, 8).map((f, n) => ({ n, family: clean(f && f.family, 48) }))
    .filter((f) => f.family && fontPath(rec, style, f.n))
    .map((f) => ({ family: f.family, url: urlOfFont(c, rec, f.n) })).filter((f) => f.url);
  let recipe = '';
  try { recipe = fs.readFileSync(path.join(rec.dir, ...String(style.files.spec || 'STYLE.md').split('/')), 'utf8').slice(0, RECIPE_MAX); } catch { recipe = ''; }
  return {
    ...tile, swatches, type, fonts, credit: clean(rec.credit, 120) || null, licence: clean(rec.licence, 20) || null,
    authors: (rec.authors || []).map((a) => clean(a, 80)).slice(0, 4), recipe, rendering: rendering.has(tile.key),
    can: { use: rec.ok, compare: rec.ok, duplicate: rec.ok, share: rec.scope === 'mine' && rec.ok, remove: rec.scope === 'mine' && !rendering.has(tile.key) },
  };
}

// ── the files a host serves (shell/gallery.js) ──────────────────────────────────────────────────────────────────────

/** A declared font's file inside the style (fonts[n].file, a font type, no climbing out), or null. */
function fontPath(rec, style, n) {
  const f = Array.isArray(style && style.fonts) ? style.fonts[n] : null;
  const rel = f && typeof f.file === 'string' ? f.file : '';
  if (!rel || rel.includes('\\') || rel.split('/').some((p) => !p || p === '.' || p === '..') || !FONT_EXT[path.extname(rel).toLowerCase()]) return null;
  const abs = path.join(rec.dir, ...rel.split('/'));
  try {
    const real = fs.realpathSync(abs);
    if (!real.startsWith(fs.realpathSync(rec.dir) + path.sep) || !fs.lstatSync(abs).isFile()) return null;
    return real;
  } catch { return null; }
}
function urlOfFont(c, rec, n) {
  const host = c && c.galleryHost;
  if (host && typeof host.fontUrl === 'function') return host.fontUrl(rec.scope, rec.scope === 'shared' ? `${rec.id}@${rec.version}` : rec.id, n);
  return null; // fonts reach a page only through a host that serves them with CORS (the specimen falls back to the UI face)
}

/**
 * A style's own posters and loops ({ poster, posterTall, loop, loopTall }: real paths or null), each a file that really
 * sits inside the style's folder (a shipped style's: inside its media folder), whatever the name says: a poster.jpg or
 * loop.mp4 that is a link to anywhere else (a Mine or Shared folder is the user's or someone else's) isn't served.
 */
function mediaOf(c, rec) {
  const m = (rec && rec.media) || {};
  const out = { poster: null, posterTall: null, loop: null, loopTall: null };
  const media = rec && rec.scope === 'shipped' ? mediaRootFor(c) : null;
  const base = rec ? (rec.scope === 'shipped' ? (media ? path.join(media, rec.id) : null) : rec.dir) : null;
  let root = null;
  try { root = base ? fs.realpathSync(base) : null; } catch { root = null; }
  if (!root) return out;
  for (const k of Object.keys(out)) {
    if (typeof m[k] !== 'string') continue;
    try {
      const real = fs.realpathSync(m[k]);
      if (real.startsWith(root + path.sep) && fs.statSync(real).isFile()) out[k] = real;
    } catch { /* not there */ }
  }
  return out;
}

/** The file behind flpt-gallery://media/<scope>/<ref>/<file>: { path, type } or null (only a style's own media). */
function resolveMedia(c, scope, ref, file, repo = repoFor(c)) {
  const k = parseKey(`${scope}:${ref}`);
  const key = Object.entries(MEDIA).find(([, f]) => f === file);
  if (!k || !key) return null;
  if (k.scope === 'shared' && !sharedShown(c)) return null;
  const rec = repo.get({ id: k.id, version: k.version, scope: k.scope });
  if (!rec || rec.scope !== k.scope || rec.revoked) return null;
  const abs = mediaOf(c, rec)[key[0]];
  return abs ? { path: abs, type: file.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg' } : null;
}
/** The file behind flpt-gallery://font/<scope>/<ref>/<n>: { path, type } or null (a font style.json declares). */
function resolveFont(c, scope, ref, n, repo = repoFor(c)) {
  const k = parseKey(`${scope}:${ref}`);
  if (!k || !Number.isInteger(n) || n < 0 || n > 15) return null;
  if (k.scope === 'shared' && !sharedShown(c)) return null;
  const rec = repo.get({ id: k.id, version: k.version, scope: k.scope });
  if (!rec || rec.scope !== k.scope || rec.revoked) return null;
  const { style } = stylesLib.readStyle(rec.dir);
  const p = fontPath(rec, style, n);
  return p ? { path: p, type: FONT_EXT[path.extname(p).toLowerCase()] } : null;
}

// ── changes ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const rendering = new Set(); // Mine styles whose poster and loops are being rendered now (by key)

/** styles:changed to every window that shows styles (the host's broadcast; else the main window). */
function changed(c, detail = {}) {
  try {
    if (c.galleryHost && typeof c.galleryHost.broadcast === 'function') c.galleryHost.broadcast('styles:changed', detail);
    else if (typeof c.send === 'function') c.send('styles:changed', detail);
  } catch { /* no window */ }
}

/** Where removed Mine styles wait (never deleted): Styles/mine/.removed. */
const removedRoot = (repo) => path.join(repo.roots.mine, '.removed');

function list(c) {
  const repo = repoFor(c);
  const all = repo.listAll(); // through the catalog's guard: nothing it withdrew
  const shared = sharedShown(c);
  const tiles = [];
  for (const scope of ['shipped', 'mine', ...(shared ? ['shared'] : [])]) {
    for (const rec of all[scope] || []) {
      if (!rec.ok || rec.revoked) continue;
      const { style } = stylesLib.readStyle(rec.dir);
      const t = tileOf(c, rec, style);
      t.rendering = rendering.has(t.key);
      tiles.push(t);
    }
  }
  const counts = { shipped: all.shipped.filter((r) => r.ok && !r.revoked).length, mine: all.mine.filter((r) => r.ok).length, shared: shared ? all.shared.filter((r) => r.ok && !r.revoked).length : 0 };
  return { tiles, counts, shared };
}

/** Render a new Mine style's poster and loops in the background; the wall hears when they land (or why not). */
function renderInBackground(c, repo, rec) {
  const key = keyOf(rec);
  rendering.add(key);
  changed(c, { key, rendering: true });
  Promise.resolve().then(() => repo.renderMedia({ id: rec.id, scope: 'mine' }))
    .then(() => { rendering.delete(key); changed(c, { key, rendering: false }); },
      (e) => { rendering.delete(key); changed(c, { key, rendering: false, problem: clean(c.redact ? c.redact(e.message) : e.message, 200) }); });
}

module.exports = {
  ns: 'styles',
  methods: {
    list: { args: [], handler: (c) => list(c) },
    get: { args: ['id:120'], handler: (c, key) => detailOf(c, need(c, repoFor(c), key, { usable: false })) },
    fork: { args: ['id:120', 'text:40?'], handler: async (c, key, name) => {
      const repo = repoFor(c);
      const rec = need(c, repo, key);
      const made = await repo.fork({ id: rec.id, version: rec.version, scope: rec.scope }, { name: typeof name === 'string' ? name : undefined });
      changed(c, { key: keyOf(made) });
      const { style } = stylesLib.readStyle(made.dir);
      return tileOf(c, made, style);
    } },
    remove: { args: ['id:120'], handler: (c, key) => {
      const repo = repoFor(c);
      const rec = need(c, repo, key, { usable: false });
      if (rec.scope !== 'mine') throw new Error('Only your own styles can go.');
      // an import's poster and loops are still being rendered into its folder: it goes once they've landed
      if (rendering.has(keyOf(rec))) throw new Error(`${clean(rec.name, 40) || rec.id} is still rendering.`);
      const root = removedRoot(repo);
      if (path.dirname(fs.realpathSync(rec.dir)) !== fs.realpathSync(repo.roots.mine)) throw new Error('That style is gone.');
      fs.mkdirSync(root, { recursive: true });
      const token = `${rec.id}-${Date.now()}`;
      fs.renameSync(rec.dir, path.join(root, token));
      changed(c, { key: keyOf(rec), removed: true });
      return { token, name: clean(rec.name, 40) || rec.id };
    } },
    restore: { args: ['id:80'], handler: (c, token) => {
      const repo = repoFor(c);
      const m = TOKEN_RE.exec(String(token));
      if (!m) throw new Error('Nothing to undo.');
      const from = path.join(removedRoot(repo), token);
      const to = path.join(repo.roots.mine, m[1]);
      if (!isDir(from)) throw new Error('Nothing to undo.');
      if (exists(to)) throw new Error(`You already have a style called ${m[1]}.`);
      fs.renameSync(from, to);
      const rec = repo.record('mine', to);
      changed(c, { key: keyOf(rec) });
      const { style } = stylesLib.readStyle(rec.dir);
      return tileOf(c, rec, style);
    } },
    importFile: { args: [], handler: async (c) => {
      if (!c.dialogs || typeof c.dialogs.open !== 'function') throw new Error('No file picker here.');
      const r = await c.dialogs.open({ title: 'A style file', buttonLabel: 'Add', properties: ['openFile'], filters: [{ name: 'FLPT style', extensions: ['flptstyle'] }] });
      if (!r || r.canceled || !r.filePaths || !r.filePaths.length) return { cancelled: true };
      const repo = repoFor(c);
      const rec = await repo.importStyle(r.filePaths[0]);
      const { style } = stylesLib.readStyle(rec.dir);
      if (rec.needsMedia) renderInBackground(c, repo, rec); else changed(c, { key: keyOf(rec) });
      return { tile: { ...tileOf(c, rec, style), rendering: Boolean(rec.needsMedia) }, unchanged: Boolean(rec.unchanged) };
    } },
    inspiration: { args: [], handler: (c) => {
      const ins = repoFor(c).inspiration();
      return { checked: ins.checked, links: ins.links.map((l) => ({ id: l.id, name: l.name, blurb: l.blurb, detail: l.detail, tags: l.tags, access: l.access, capture: l.capture, host: new URL(l.url).hostname })) };
    } },
    openLink: { args: ['id:48'], handler: async (c, id) => {
      const l = repoFor(c).inspiration().links.find((x) => x.id === id);
      if (!l) throw new Error('That place isn\'t on the list.');
      if (!c.os || typeof c.os.openExternal !== 'function') throw new Error('No browser here.');
      await c.os.openExternal(l.url);
      return true;
    } },
  },
  events: ['styles:changed'],
  // for the host (shell/gallery.js) and the tests
  repoFor, keyOf, parseKey, need, tileOf, detailOf, mediaOf, resolveMedia, resolveFont, soundOf, tagsOf, catalogOf, sharedShown, mediaRootFor, MEDIA, rendering, changed,
};
