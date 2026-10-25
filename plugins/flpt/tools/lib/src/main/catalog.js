'use strict';
// catalog.js · the signed style catalog, client side (PLAN §2.10.3, §2.14 `catalog.json`; W3-11). Without
// auto-update this is the only channel by which a 2.0 install ever receives shared styles, revocations and the
// "2.0.x is out" line. Electron-free (the plugin's tools get a copy).
//
//   createCatalog({ projectsDir, engineRoot, version, surface, keys, base, fetch, now, styles })
//     check()            the one network call, made only when the user asks ("Check for new styles", flpt-styles
//                        fetch): a plain GET of catalog.json and catalog.json.sig, User-Agent FLPT/<version>, no
//                        cookies, no identifiers, no redirects. The exact bytes are verified (Ed25519, against the
//                        pinned keys of catalog-keys.js; with none pinned nothing is fetched at all), then refused
//                        when expired or when its release is below the highest this install has seen (the rollback
//                        floor; the same release with other bytes is refused too). The shared styles it adds come as
//                        content-addressed blobs, each checked for size and SHA-256 as it lands: a style whose blobs
//                        don't all arrive intact isn't installed and waits in `skipped` for the next check, while the
//                        verified catalog itself (its revocations, its latest line, the new floor) applies all the
//                        same: a revocation never waits on an unrelated blob. A package is then checked as a zip
//                        (zipdet: zip-slip, symlinks, bombs), its own posters and loops ignored, linted as Shared
//                        (style-lint) and installed atomically into <projects>/Styles/shared/<id>@<version>/ with the
//                        catalog's poster and loop (rendered from its code by catalog-build, never submitted media).
//                        → { ok, release, changed, added, skipped, revoked, latest, tooOld } or { ok: false, code,
//                        problem }
//     status()           what the stored catalog says (no network): { checked, release, issuedAt, expires, expired,
//                        fetchedAt, shared, revoked, tooOld, minClient, latest, keys }
//     revoked()          the verified revocations: [{ id, version, reason }] ('*' is every version)
//     revocationOf(x)    a style (its folder, a record, or { id, version }) → { reason, line, blocks } or null
//     flagFor(x)         the one-line flag a revoked style's snapshots carry ("Withdrawn from the catalog",
//                        "Withdrawn for security"), or null
//     assertRenderable(x) throws a CatalogError ('revoked') for a style revoked for security
//     hasShared()        a verified catalog is stored and a shared style it installed is here, usable, not revoked
//     latestLine()       "2.0.3 is out" when the catalog's line for this surface is newer than this FLPT, else null
//     inspiration()      the catalog's inspiration links, checked as engine/styles/inspiration.json's are
//     guard(styles)      a styles.createStyles repository with the catalog applied (what renders and the Stage
//                        should resolve styles through): revoked tiles hidden, Shared only as the catalog installed
//                        it (list, get, and every call that takes a ref resolves through that), a revoked style
//                        never taken up anew (snapshot, updateSnapshot, fork, saveAsStyle, exportStyle), and a
//                        security-revoked style's code never run (snapshotDir, crewView, renderMedia, the deep
//                        lint). get returns a revoked style marked { revoked: { reason, line, blocks } }, never
//                        null, so an episode that holds its snapshot still finds it; defaultFor(use) is DEFAULTS'
//                        style unless the catalog withdrew it. A guarded repository given to createCatalog or to
//                        guard is unwrapped first: the catalog's own work always reads the bare repository.
//
// Revocations (`revoked`): rights and quality hide the style's tiles and keep episode snapshots rendering with a
// one-line flag; security also blocks renders and Stage previews of those snapshots (the UI offers Replace style).
// A revocation names a catalog style, so it never matches the user's own: a Mine style, or an episode snapshot taken
// from Mine, that happens to share an id@version with a catalog style (every first fork of Riso is riso-mine@0.1.0).
// `minClient` above this FLPT: nothing is installed from that catalog, its revocations and latest line still apply.
// Each style's `minApp` and `runtime` must suit this FLPT too, or that style waits.
//
// Kept in <projects>/Styles/.catalog/ (the app and the plugin share the projects folder, as they share the Library):
// catalog.json and catalog.json.sig, the last verified catalog's exact bytes (verified again whenever they're read),
// and state.json { v, release, sha256, keyId, fetchedAt, installed: { "<id>@<version>": <package sha256> } }. The
// floor is the higher of state.json's release and the stored catalog's. One check at a time across processes: .lock/
// holds owner.json { pid, host, at } and is touched as each blob lands; a lock whose process is gone (this Mac), or
// untouched for 10 minutes, is stale. Nothing here spends or holds a secret.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const keysLib = require('./catalog-keys');
const zipdet = require('./zipdet');
const lintLib = require('./style-lint');

const { ID_RE, SEMVER_RE, RUNTIME_RE, MEDIA_FILES } = lintLib;
const SCHEMA = 'flpt.catalog/1';
const BASE = 'https://flpt.bombadillo-ai.com/catalog/v1/';
const REASONS = ['rights', 'quality', 'security'];
const COLLECTIONS = ['shipped', 'shared'];
const SURFACES = { mac: 'app', app: 'app', web: 'web', desk: 'plugin', plugin: 'plugin' };
const HEX64 = /^[0-9a-f]{64}$/;
// What each download may weigh (a response is cut off past these while it streams in, whatever it claims).
const LIMITS = Object.freeze({
  catalogBytes: 2 * 1024 * 1024, sigBytes: 256, styles: 500, revoked: 1000, addons: 200, inspiration: 12,
  packageBytes: zipdet.LIMITS.maxBytes + 1024 * 1024, posterBytes: 512 * 1024, loopBytes: 8 * 1024 * 1024,
  catalogMs: 30000, blobMs: 120000, lockMs: 10 * 60 * 1000, lockClaimMs: 30 * 1000, maxDays: 400,
});
// The catalog's media slots and the file each becomes in the style's folder.
const MEDIA_SLOTS = { poster: 'poster.jpg', loop: 'loop.mp4', posterTall: 'poster-tall.jpg', loopTall: 'loop-tall.mp4' };
const SLOT_MAX = { poster: 'posterBytes', posterTall: 'posterBytes', loop: 'loopBytes', loopTall: 'loopBytes' };
const LINES = { rights: 'Withdrawn from the catalog', quality: 'Withdrawn from the catalog', security: 'Withdrawn for security' };

class CatalogError extends Error {
  constructor(code, message) { super(message); this.name = 'CatalogError'; this.code = code; }
}

// ── small pieces ─────────────────────────────────────────────────────────────────────────────────────────────────────

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const readBuf = (f) => { try { return fs.readFileSync(f); } catch { return null; } };
const rand = () => crypto.randomBytes(4).toString('hex');
// eslint-disable-next-line no-control-regex
const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const styles = () => require('./styles'); // lazily: styles.js may come to ask this module about revocations
// A guarded repository → the bare one it wraps (a guard never stacks on another, and the catalog's own reads never see
// a guard, whoever made it: styles.js once it applies the catalog, a caller, another client with other keys).
const BARE = new WeakMap();
const bare = (repo) => (repo && BARE.has(repo) ? BARE.get(repo) : repo);

/** Compare two x.y.z versions (numbers, not strings): < 0, 0, > 0. */
function cmpSemver(a, b) {
  const x = String(a || '0.0.0').split('.').map(Number), y = String(b || '0.0.0').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
}

/** Bytes to a file, atomically (beside it, then renamed in one step). */
function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.tmp-${rand()}`);
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
const writeJson = (file, v) => writeAtomic(file, `${JSON.stringify(v, null, 2)}\n`);

/** Where the catalog's own files live: <projects>/Styles/.catalog. */
const catalogDir = (projectsDir) => path.join(projectsDir, 'Styles', '.catalog');
const sharedDir = (projectsDir) => path.join(projectsDir, 'Styles', 'shared');

/** The base URL the catalog comes from: https, or plain http on this Mac's loopback (QA's stand-ins) only. */
function checkBase(base) {
  let u;
  try { u = new URL(String(base)); } catch { throw new CatalogError('base', 'The catalog address isn\'t a URL.'); }
  const loop = u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  if (!(u.protocol === 'https:' || loop) || u.username || u.password || u.search || u.hash) throw new CatalogError('base', 'The catalog comes over https only.');
  return u.href.endsWith('/') ? u.href : `${u.href}/`;
}

// ── catalog.json, its shape ──────────────────────────────────────────────────────────────────────────────────────────

const isTime = (s) => typeof s === 'string' && s.length <= 40 && /^\d{4}-\d{2}-\d{2}T/.test(s) && Number.isFinite(Date.parse(s));
const isBlob = (b, max) => isObj(b) && HEX64.test(String(b.sha256 || '')) && Number.isInteger(b.bytes) && b.bytes > 0 && b.bytes <= max;

/** The problems with a parsed catalog.json (flpt.catalog/1): [] when it's one. Unknown fields are allowed. */
function validateCatalog(c) {
  const out = [];
  const bad = (field, msg) => out.push(`${field}: ${msg}`);
  if (!isObj(c)) return ['catalog.json: not an object'];
  if (c.schema !== SCHEMA) bad('schema', `must be "${SCHEMA}"`);
  if (!(Number.isInteger(c.release) && c.release >= 1 && c.release <= 1e9)) bad('release', 'a whole number from 1');
  if (!isTime(c.issuedAt)) bad('issuedAt', 'a time like 2026-11-20T10:00:00Z');
  if (!isTime(c.expires)) bad('expires', 'a time like 2027-05-20T00:00:00Z');
  if (isTime(c.issuedAt) && isTime(c.expires)) {
    const span = Date.parse(c.expires) - Date.parse(c.issuedAt);
    if (span <= 0) bad('expires', 'after issuedAt');
    else if (span > LIMITS.maxDays * 864e5) bad('expires', `within ${LIMITS.maxDays} days of issuedAt`);
  }
  if (!keysLib.ID_RE.test(String(c.keyId || ''))) bad('keyId', 'a key id');
  if (!SEMVER_RE.test(String(c.minClient || ''))) bad('minClient', 'a version like 2.0.0');
  if (c.latest != null) {
    if (!isObj(c.latest)) bad('latest', 'an object');
    else {
      for (const k of ['app', 'plugin', 'web']) if (c.latest[k] != null && !SEMVER_RE.test(String(c.latest[k]))) bad(`latest.${k}`, 'a version like 2.0.3');
      if (c.latest.notes != null) { try { if (new URL(String(c.latest.notes)).protocol !== 'https:') bad('latest.notes', 'https'); } catch { bad('latest.notes', 'a URL'); } }
    }
  }
  if (!Array.isArray(c.styles) || c.styles.length > LIMITS.styles) bad('styles', `a list of up to ${LIMITS.styles}`);
  else {
    const seen = new Set();
    c.styles.forEach((s, i) => {
      const at = `styles[${i}]`;
      if (!isObj(s)) { bad(at, 'not an object'); return; }
      if (!ID_RE.test(String(s.id || ''))) bad(`${at}.id`, 'a style id');
      if (!SEMVER_RE.test(String(s.version || ''))) bad(`${at}.version`, 'a version like 1.0.0');
      const ref = `${s.id}@${s.version}`;
      if (seen.has(ref)) bad(at, `${ref} twice`);
      seen.add(ref);
      if (!COLLECTIONS.includes(s.collection)) bad(`${at}.collection`, COLLECTIONS.join(' or '));
      if (s.name != null && !(typeof s.name === 'string' && s.name.length <= 40)) bad(`${at}.name`, '40 characters at most');
      if (!RUNTIME_RE.test(String(s.runtime || ''))) bad(`${at}.runtime`, 'like "flpt-live@^1"');
      if (s.minApp != null && !SEMVER_RE.test(String(s.minApp))) bad(`${at}.minApp`, 'a version like 2.0.0');
      if (s.tags != null && !(Array.isArray(s.tags) && s.tags.length <= 16 && s.tags.every((t) => typeof t === 'string' && t.length <= 24))) bad(`${at}.tags`, 'up to 16 short words');
      if (!isBlob(s.package, LIMITS.packageBytes)) bad(`${at}.package`, '{ sha256, bytes } within 9 MB');
      for (const slot of Object.keys(MEDIA_SLOTS)) {
        if (s[slot] == null) { if ((slot === 'poster' || slot === 'loop') && s.collection === 'shared') bad(`${at}.${slot}`, 'a shared style has one'); continue; }
        if (!isBlob(s[slot], LIMITS[SLOT_MAX[slot]])) bad(`${at}.${slot}`, '{ sha256, bytes }');
      }
    });
  }
  if (c.revoked != null) {
    if (!Array.isArray(c.revoked) || c.revoked.length > LIMITS.revoked) bad('revoked', `a list of up to ${LIMITS.revoked}`);
    else c.revoked.forEach((r, i) => {
      if (!isObj(r) || !ID_RE.test(String(r.id || '')) || !(r.version === '*' || SEMVER_RE.test(String(r.version || ''))) || !REASONS.includes(r.reason)) bad(`revoked[${i}]`, `{ id, version (or "*"), reason: ${REASONS.join('|')} }`);
    });
  }
  if (c.addons != null && !(Array.isArray(c.addons) && c.addons.length <= LIMITS.addons)) bad('addons', `a list of up to ${LIMITS.addons}`);
  if (c.inspiration != null && !(Array.isArray(c.inspiration) && c.inspiration.length <= LIMITS.inspiration)) bad('inspiration', `a list of up to ${LIMITS.inspiration}`);
  return out;
}

/**
 * The exact bytes of a catalog and its detached signature → the catalog, or a CatalogError:
 *   'no-key' (nothing pinned), 'signature' (no pinned key signed these bytes), 'schema', 'key' (signed by one pinned
 *   key while naming another), 'expired' (opts.now past `expires`), 'rollback' (release below opts.floor).
 */
function verifyCatalog(bytes, sig, { keys = keysLib.PINNED, now = Date.now(), floor = 0 } = {}) {
  if (!keysLib.usable(keys).length) throw new CatalogError('no-key', 'No catalog key is pinned in this FLPT.');
  if (!Buffer.isBuffer(bytes) || bytes.length > LIMITS.catalogBytes) throw new CatalogError('size', 'The catalog is too big.');
  const v = keysLib.verify(bytes, sig, keys);
  if (!v.ok) throw new CatalogError('signature', 'The catalog\'s signature doesn\'t check out.');
  let cat;
  try { cat = JSON.parse(bytes.toString('utf8')); } catch { throw new CatalogError('schema', 'The catalog isn\'t JSON.'); }
  const problems = validateCatalog(cat);
  if (problems.length) throw new CatalogError('schema', `The catalog is malformed (${problems[0]}).`);
  if (cat.keyId !== v.keyId) throw new CatalogError('key', 'The catalog names another key than the one that signed it.');
  if (Date.parse(cat.expires) <= now) throw new CatalogError('expired', `The catalog expired on ${cat.expires.slice(0, 10)}.`);
  if (cat.release < floor) throw new CatalogError('rollback', `The catalog is release ${cat.release}; this FLPT has seen release ${floor}.`);
  return cat;
}

/** The revocation that applies to id@version in a list, the strongest reason first (security, then rights, quality). */
function findRevocation(list, id, version) {
  const hits = (list || []).filter((r) => r.id === id && (r.version === '*' || r.version === version));
  if (!hits.length) return null;
  hits.sort((a, b) => REASONS.indexOf(b.reason) - REASONS.indexOf(a.reason));
  const reason = hits[0].reason;
  return { id, version, reason, line: LINES[reason], blocks: reason === 'security' };
}

/** A response body, read with a ceiling (a stream past max is cut off, whatever its Content-Length said). */
async function readCapped(res, max) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const b = Buffer.from(await res.arrayBuffer());
    if (b.length > max) throw new CatalogError('size', 'A download was bigger than it may be.');
    return b;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) { try { await reader.cancel(); } catch { /* gone */ } throw new CatalogError('size', 'A download was bigger than it may be.'); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, n);
}

/** The inspiration links in a verified catalog, checked as styles.inspiration checks engine/styles/inspiration.json. */
function inspirationOf(cat) {
  const out = [];
  for (const l of (cat && Array.isArray(cat.inspiration) ? cat.inspiration : []).slice(0, LIMITS.inspiration)) {
    if (!isObj(l) || !ID_RE.test(String(l.id || ''))) continue;
    let u;
    try { u = new URL(String(l.url)); } catch { continue; }
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.')) continue;
    out.push(Object.freeze({ id: l.id, name: clean(l.name, 40), url: u.href, blurb: clean(l.blurb, 60) }));
  }
  return out;
}

// ── the client ───────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} o
 * @param {string} o.projectsDir   the user's projects folder (Styles/shared and Styles/.catalog under it)
 * @param {string} [o.engineRoot]  the engine (the runtime's lint, the shipped styles a Shared one may descend from)
 * @param {string} [o.version]     this FLPT's version (package.json's by default)
 * @param {string} [o.surface]     'mac' | 'web' | 'desk' | 'plugin': which `latest` line is this one's
 * @param {Array}  [o.keys]        the pinned keys (catalog-keys.js); tests pass keys they made themselves
 * @param {string} [o.base]        where the catalog is (https, or loopback http for QA)
 * @param {Function} [o.fetch]     fetch (global fetch by default; never Electron's net, which carries the session)
 * @param {Function} [o.now]       () → ms since the epoch
 * @param {object} [o.styles]      a styles.createStyles repository on the same projects folder (made here otherwise,
 *                                 with catalog: false); a guarded one is unwrapped to the bare repository it guards
 */
function createCatalog({ projectsDir, engineRoot, version, surface = 'mac', keys = keysLib.PINNED, base = BASE, fetch: fetchFn, now = Date.now, styles: given } = {}) {
  if (!projectsDir) throw new CatalogError('projects', 'No projects folder.');
  const own = version || (() => { try { return require('../../package.json').version; } catch { return '0.0.0'; } })();
  const lineKey = SURFACES[surface] || 'app';
  const dir = catalogDir(projectsDir);
  const shared = sharedDir(projectsDir);
  const mineDir = path.join(projectsDir, 'Styles', 'mine');
  const files = { catalog: path.join(dir, 'catalog.json'), sig: path.join(dir, 'catalog.json.sig'), state: path.join(dir, 'state.json'), lock: path.join(dir, '.lock') };
  const doFetch = fetchFn || ((...a) => globalThis.fetch(...a));
  // the bare repository, always: what the catalog counts, installs and lints never passes through a guard (its own or
  // the one styles.js applies), so a check's report and the Shared count are the same before and after handoff 1
  let repo = bare(given) || null;
  const repoOf = () => repo || (repo = bare(styles().createStyles({ engineRoot, projectsDir, mediaRoot: null, catalog: false })));
  let running = null;

  // ── what's stored (verified again on every read; cached while the files are unchanged) ──
  let memo = { key: null, value: null };
  function stored() {
    let key;
    try {
      const a = fs.statSync(files.catalog), b = fs.statSync(files.sig);
      key = `${a.mtimeMs}:${a.size}:${b.mtimeMs}:${b.size}`;
    } catch { return { cat: null, bytes: null, problem: null }; }
    if (memo.key === key) return memo.value;
    const bytes = readBuf(files.catalog), sig = readBuf(files.sig);
    let value;
    // stored is past: its expiry and the floor were checked when it came in, and its revocations still hold after
    try { value = { cat: verifyCatalog(bytes, sig, { keys, now: 0 }), bytes, problem: null }; } catch (e) { value = { cat: null, bytes: null, problem: e.code }; }
    memo = { key, value };
    return value;
  }
  const state = () => {
    const s = readJson(files.state);
    return isObj(s) ? { release: Number.isInteger(s.release) ? s.release : 0, sha256: s.sha256 || null, keyId: s.keyId || null, fetchedAt: s.fetchedAt || null, installed: isObj(s.installed) ? s.installed : {} } : { release: 0, sha256: null, keyId: null, fetchedAt: null, installed: {} };
  };
  const floor = () => Math.max(state().release, (stored().cat && stored().cat.release) || 0);
  const revokedList = () => { const c = stored().cat; return c && Array.isArray(c.revoked) ? c.revoked.map((r) => ({ id: r.id, version: r.version, reason: r.reason })) : []; };

  /** id and version of a style given as its folder, a record or { id, version }. */
  function idOf(x) {
    if (typeof x === 'string') {
      const s = readJson(path.join(x, 'style.json'));
      if (s && ID_RE.test(String(s.id || '')) && SEMVER_RE.test(String(s.version || ''))) return { id: s.id, version: s.version };
      const m = /^([a-z0-9][a-z0-9-]{0,47})@(\d+\.\d+\.\d+)$/.exec(path.basename(x));
      return m ? { id: m[1], version: m[2] } : null;
    }
    return isObj(x) && ID_RE.test(String(x.id || '')) ? { id: x.id, version: x.version || null } : null;
  }
  const within = (p, root) => { const rel = path.relative(root, path.resolve(p)); return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel); };
  /**
   * The user's own style, which no catalog revocation names: a Mine record or folder, or an episode snapshot FLPT took
   * from Mine (buildSnapshot writes provenance.from itself). Mine ids often equal a catalog style's: every first fork
   * of Riso is riso-mine@0.1.0, and so was the one that someone shared.
   */
  function isOwn(x) {
    if (typeof x === 'string') {
      if (within(x, mineDir)) return true;
      if (within(x, shared)) return false; // the catalog's own, whatever its style.json says
      const s = readJson(path.join(x, 'style.json'));
      return Boolean(s && isObj(s.provenance) && s.provenance.kind === 'episode' && s.provenance.from === 'mine');
    }
    if (!isObj(x)) return false;
    if (x.scope === 'mine') return true;
    return x.scope === 'episode' && typeof x.dir === 'string' ? isOwn(x.dir) : false;
  }
  function revocationOf(x) {
    const r = idOf(x);
    return r && !isOwn(x) ? findRevocation(revokedList(), r.id, r.version) : null;
  }
  const flagFor = (x) => { const r = revocationOf(x); return r ? r.line : null; };
  function assertRenderable(x) {
    const r = revocationOf(x);
    if (r && r.blocks) throw new CatalogError('revoked', `${r.id} ${r.version} was withdrawn for security.`);
    return true;
  }

  const tooOldFor = (cat) => Boolean(cat && cmpSemver(own, cat.minClient) < 0);
  function latestLine(cat = stored().cat) {
    const v = cat && isObj(cat.latest) ? cat.latest[lineKey] : null;
    return v && SEMVER_RE.test(String(v)) && cmpSemver(v, own) > 0 ? `${v} is out` : null;
  }

  /** The Shared styles the catalog installed and that are still here as installed (by ref). */
  const installedRefs = () => new Set(Object.keys(state().installed));

  /** A styles repository with the catalog applied (see the header). */
  function guard(base0) {
    const st = bare(base0) || repoOf();
    const S = styles();
    const isDirArg = (x) => typeof x === 'string' && path.isAbsolute(x);
    /** Shared as the catalog installed it: each folder the catalog put here, still the style its name says. */
    const sharedHere = () => {
      if (!stored().cat) return [];
      const ok = installedRefs();
      return st.list('shared').filter((r) => ok.has(path.basename(r.dir)) && r.ref === path.basename(r.dir));
    };
    const list = (scope) => (scope === 'shared' ? sharedHere() : st.list(scope)).filter((r) => !revocationOf(r));
    const listAll = () => ({ shipped: list('shipped'), mine: list('mine'), shared: list('shared') });
    const mark = (rec) => { const r = revocationOf(rec); return r ? { ...rec, revoked: { reason: r.reason, line: r.line, blocks: r.blocks } } : rec; };
    /**
     * A style by ref, in styles.get's order (shipped, Mine, Shared; the newest version unless one is named), Shared only
     * as the catalog installed it (a newer version placed there by anything else isn't one). A revoked style comes
     * back marked, never null: an episode that holds its snapshot still finds it (Shared prefers a version that isn't).
     */
    const get = (ref) => {
      const want = S.parseRef(ref);
      if (!want) return null;
      for (const scope of want.scope ? [want.scope] : S.COLLECTIONS) {
        if (scope !== 'shared') {
          const rec = st.get({ id: want.id, version: want.version, scope });
          if (rec) return mark(rec);
          continue;
        }
        const hits = sharedHere().filter((r) => r.id === want.id && (!want.version || r.version === want.version)).sort((a, b) => cmpSemver(b.version, a.version));
        if (hits.length) return mark(hits.find((r) => !revocationOf(r)) || hits[0]);
      }
      return null;
    };
    /** The record a ref resolves to through get, or the refusal styles.need gives for a style that isn't here. */
    const need = (ref) => {
      const rec = get(ref);
      if (!rec) throw new S.StyleError('missing', `There's no style called "${String(isObj(ref) ? ref.id : ref).slice(0, 60)}".`);
      return rec;
    };
    // what the bare repository is then handed: that very record (its scope and version), so it can't resolve elsewhere
    const exact = (rec) => ({ id: rec.id, version: rec.version, scope: rec.scope });
    const withdrawn = (rec, r) => new CatalogError('revoked', `${rec.name || rec.id} ${rec.version} was ${r.blocks ? 'withdrawn for security' : 'withdrawn from the catalog'}.`);
    /** A new use of a style (a new snapshot, a fork, a style saved from it, an export): refused for any revocation. */
    const fresh = (ref) => {
      const rec = need(ref);
      const r = revocationOf(rec);
      if (r) throw withdrawn(rec, r);
      return rec;
    };
    /** Running a style's code (its media rendered, the deep lint): refused for a security revocation. */
    const runnable = (ref) => { const rec = need(ref); assertRenderable(rec); return rec; };

    /** An episode's first use: refused for any revocation, but an episode that already holds it keeps it (not security). */
    const snapshot = (episodeDir, ref) => {
      const rec = need(ref);
      const r = revocationOf(rec);
      if (r) {
        if (r.blocks) throw withdrawn(rec, r);
        const have = st.snapshotDir(episodeDir, rec.id);
        if (!(have && path.basename(have) === `${rec.id}@${rec.version}`)) throw withdrawn(rec, r);
      }
      return st.snapshot(episodeDir, exact(rec));
    };
    const updateSnapshot = (episodeDir, ref) => st.updateSnapshot(episodeDir, exact(fresh(ref)));
    const snapshotDir = (episodeDir, id) => {
      const d = st.snapshotDir(episodeDir, id);
      if (d) assertRenderable(d);
      return d;
    };
    const crewView = (refOrDir) => {
      if (isDirArg(refOrDir)) { assertRenderable(refOrDir); return st.crewView(refOrDir); }
      const rec = need(refOrDir);
      assertRenderable(rec);
      return st.crewView(exact(rec));
    };
    const apiSummary = (ref) => st.apiSummary(isDirArg(ref) ? ref : need(ref).dir);
    const lint = async (refOrDir, opts = {}) => {
      if (isDirArg(refOrDir)) { if (opts.deep) assertRenderable(refOrDir); return st.lint(refOrDir, opts); }
      const rec = need(refOrDir);
      if (opts.deep) assertRenderable(rec);
      return st.lint(exact(rec), opts);
    };
    const renderMedia = async (ref, opts) => st.renderMedia(exact(runnable(ref)), opts);
    const fork = async (ref, opts) => st.fork(exact(fresh(ref)), opts);
    const exportStyle = async (ref, file) => st.exportStyle(exact(fresh(ref)), file);
    const saveAsStyle = async (o = {}) => {
      if (o.styleDir) {
        const r = revocationOf(o.styleDir);
        if (r) throw withdrawn({ id: r.id, version: r.version }, r);
        return st.saveAsStyle(o);
      }
      return st.saveAsStyle(o.style == null ? o : { ...o, style: exact(fresh(o.style)) });
    };
    /** The style a new piece of this use starts in: styles.DEFAULTS' unless withdrawn, then the first shipped one listed. */
    const defaultFor = (use) => {
      const want = S.DEFAULTS[use] || 'riso';
      const rec = get(want);
      if (!rec || !rec.revoked) return want;
      const alt = list('shipped').find((r) => r.ok && (use !== 'duet' || r.duetSafe));
      return alt ? alt.id : want;
    };
    const out = {
      ...st, guarded: true, list, listAll, get, snapshot, updateSnapshot, snapshotDir, crewView, apiSummary, lint, renderMedia, fork, exportStyle, saveAsStyle,
      hasShared: () => list('shared').some((r) => r.ok), defaultFor, flagFor, revocationOf,
    };
    BARE.set(out, st);
    return out;
  }

  function hasShared() {
    if (!stored().cat) return false;
    try { return guard().hasShared(); } catch { return false; }
  }

  function status() {
    const { cat, problem } = stored();
    const s = state();
    let sharedN = 0;
    try { sharedN = cat ? guard().list('shared').filter((r) => r.ok).length : 0; } catch { sharedN = 0; }
    return {
      checked: Boolean(cat), release: cat ? cat.release : null, issuedAt: cat ? cat.issuedAt : null, expires: cat ? cat.expires : null,
      expired: cat ? Date.parse(cat.expires) <= now() : false, fetchedAt: s.fetchedAt, shared: sharedN, revoked: cat && Array.isArray(cat.revoked) ? cat.revoked.length : 0,
      tooOld: tooOldFor(cat), minClient: cat ? cat.minClient : null, latest: latestLine(cat), keys: keysLib.usable(keys).length, problem: cat ? null : problem,
    };
  }

  // ── the one network call ──
  async function get(url, max, ms) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ms);
    if (timer.unref) timer.unref();
    try {
      // a plain GET: our name and version, no cookie, no referrer, no identifier, no redirect
      const res = await doFetch(url, { method: 'GET', headers: { 'User-Agent': `FLPT/${own}` }, redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: ac.signal });
      if (!res || !res.ok) throw new CatalogError('http', `The catalog server answered ${res ? res.status : 'nothing'}.`);
      return await readCapped(res, max);
    } catch (e) {
      if (e instanceof CatalogError) throw e;
      throw new CatalogError('network', ac.signal.aborted ? 'The catalog took too long.' : 'The catalog couldn\'t be reached.');
    } finally { clearTimeout(timer); }
  }

  // ── one check at a time, across processes (the app and the plugin share the projects folder) ──
  const ownerFile = path.join(files.lock, 'owner.json');
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  /** Is the lock left by a check that's gone? Its process ended (on this Mac), or it went untouched for lockMs. */
  function lockStale() {
    let age;
    try { age = Date.now() - fs.statSync(files.lock).mtimeMs; } catch { return true; }
    const o = readJson(ownerFile);
    if (isObj(o) && Number.isInteger(o.pid) && o.pid > 0 && o.host === os.hostname()) {
      if (o.pid !== process.pid && !alive(o.pid)) return true;
    } else if (!isObj(o) && age > LIMITS.lockClaimMs) return true; // made, but its owner never written: that run died
    return age > LIMITS.lockMs;
  }
  function lock() {
    fs.mkdirSync(dir, { recursive: true });
    const take = () => { fs.mkdirSync(files.lock); writeJson(ownerFile, { pid: process.pid, host: os.hostname(), at: new Date().toISOString() }); };
    try { take(); } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (!lockStale()) throw new CatalogError('busy', 'Already checking.');
      const aside = `${files.lock}.stale-${rand()}`;
      try { fs.renameSync(files.lock, aside); } catch { /* another process took it aside first */ }
      fs.rmSync(aside, { recursive: true, force: true });
      try { take(); } catch (e2) { if (e2.code === 'EEXIST') throw new CatalogError('busy', 'Already checking.'); throw e2; }
    }
    return {
      touch: () => { try { const t = new Date(); fs.utimesSync(files.lock, t, t); } catch { /* gone */ } },
      release: () => fs.rmSync(files.lock, { recursive: true, force: true }),
    };
  }

  /** May this FLPT install a catalog style here (shared, not revoked, its minApp and runtime suit)? → null or why not */
  function waitReason(cat, s, runtime) {
    if (s.collection !== 'shared') return 'shipped';
    if (findRevocation(cat.revoked, s.id, s.version)) return 'revoked';
    if (tooOldFor(cat)) return 'minClient';
    if (s.minApp && cmpSemver(own, s.minApp) < 0) return `needs FLPT ${s.minApp}`;
    if (!runtime || !styles().runtimeOk(s.runtime, runtime)) return `made for ${s.runtime}`;
    const shippedHere = path.join(repoOf().roots.shipped, s.id);
    if (styles().SHIPPED.some((x) => x.id === s.id) || exists(shippedHere)) return 'a shipped style\'s name';
    return null;
  }

  async function checkNow() {
    if (!keysLib.usable(keys).length) throw new CatalogError('no-key', 'No catalog key is pinned in this FLPT.');
    const root = checkBase(base);
    const held = lock();
    const work = path.join(shared, `.incoming-${rand()}`);
    try {
      // 1 · the catalog, its signature, its freshness and the rollback floor
      const bytes = await get(`${root}catalog.json`, LIMITS.catalogBytes, LIMITS.catalogMs);
      const sig = await get(`${root}catalog.json.sig`, LIMITS.sigBytes, LIMITS.catalogMs);
      const st = state();
      const fl = floor();
      const cat = verifyCatalog(bytes, sig, { keys, now: now(), floor: fl });
      const sha = sha256(bytes);
      const storedSha = stored().bytes ? sha256(stored().bytes) : null;
      const priorSha = storedSha || st.sha256;
      if (cat.release === fl && priorSha && sha !== priorSha) throw new CatalogError('replay', `Release ${cat.release} came again with other contents.`);

      // 2 · what this release adds here
      const runtime = repoOf().runtime;
      const skipped = [];
      const todo = [];
      for (const s of cat.styles) {
        const why = waitReason(cat, s, runtime);
        const ref = `${s.id}@${s.version}`;
        if (why) { if (!['shipped', 'revoked', 'minClient'].includes(why)) skipped.push({ ref, problem: why }); continue; }
        const dest = path.join(shared, ref);
        if (st.installed[ref] === s.package.sha256 && isDir(dest)) continue; // here already, as the catalog has it
        if (st.installed[ref] && st.installed[ref] !== s.package.sha256) { skipped.push({ ref, problem: 'a published version never changes' }); continue; }
        todo.push(s);
      }

      // 3 · each style's blobs, each checked as it lands. A style missing one intact blob isn't installed and waits for
      //     the next check; the verified catalog (revocations, latest line, floor) applies all the same
      const got = new Map();
      const bad = new Map(); // sha256 → why, so a blob two styles share is asked for once
      const fetched = [];
      const why = (slot, e) => (e.code === 'blob' ? `its ${slot} doesn't match the catalog` : e.code === 'size' ? `its ${slot} is bigger than the catalog says` : `its ${slot} didn't download`);
      if (todo.length) fs.mkdirSync(path.join(work, 'blobs'), { recursive: true });
      for (const s of todo) {
        const want = [['package', s.package, 'packageBytes'], ...Object.keys(MEDIA_SLOTS).filter((k) => s[k]).map((k) => [k, s[k], SLOT_MAX[k]])];
        let problem = null;
        for (const [slot, blob, cap] of want) {
          if (got.has(blob.sha256)) continue;
          if (bad.has(blob.sha256)) { problem = bad.get(blob.sha256); break; }
          try {
            const b = await get(`${root}blobs/${blob.sha256}`, Math.min(blob.bytes, LIMITS[cap]), LIMITS.blobMs);
            if (b.length !== blob.bytes || sha256(b) !== blob.sha256) throw new CatalogError('blob', 'doesn\'t match');
            const f = path.join(work, 'blobs', blob.sha256);
            fs.writeFileSync(f, b);
            got.set(blob.sha256, f);
            held.touch();
          } catch (e) {
            if (!(e instanceof CatalogError)) throw e;
            problem = why(slot, e);
            bad.set(blob.sha256, problem);
            break;
          }
        }
        if (problem) skipped.push({ ref: `${s.id}@${s.version}`, problem });
        else fetched.push(s);
      }

      // 4 · each package as a style folder, checked, linted as Shared, with the catalog's poster and loop
      const ready = [];
      for (const s of fetched) {
        const ref = `${s.id}@${s.version}`;
        const staged = path.join(work, 'styles', ref);
        try {
          fs.mkdirSync(path.dirname(staged), { recursive: true });
          zipdet.extract(fs.readFileSync(got.get(s.package.sha256)), staged, zipdet.LIMITS, { skip: (name) => MEDIA_FILES.includes(name) });
          const sj = readJson(path.join(staged, 'style.json'));
          if (!sj || sj.id !== s.id || sj.version !== s.version) throw new CatalogError('package', 'its style.json names another style');
          const res = await repoOf().lint(staged, { scope: 'shared' });
          if (!res.ok) { const first = res.problems.find((p) => p.level === 'error'); throw new CatalogError('lint', `${first.file ? `${first.file}: ` : ''}${first.message}`); }
          for (const [slot, name] of Object.entries(MEDIA_SLOTS)) if (s[slot]) fs.copyFileSync(got.get(s[slot].sha256), path.join(staged, name));
          ready.push({ s, ref, staged });
        } catch (e) {
          fs.rmSync(staged, { recursive: true, force: true });
          skipped.push({ ref, problem: clean(e.message, 200) });
        }
      }

      // 5 · in place, one rename each; then the catalog's bytes; the floor last
      const installed = { ...st.installed };
      const added = [];
      for (const { s, ref, staged } of ready) {
        const dest = path.join(shared, ref);
        if (exists(dest)) {
          const same = styles().contentHash(dest, { demo: true }) === styles().contentHash(staged, { demo: true });
          if (same) {
            for (const [slot, name] of Object.entries(MEDIA_SLOTS)) if (s[slot]) fs.copyFileSync(path.join(staged, name), path.join(dest, name));
            installed[ref] = s.package.sha256;
            continue;
          }
          const aside = path.join(shared, '.replaced');
          fs.mkdirSync(aside, { recursive: true });
          fs.renameSync(dest, path.join(aside, `${ref}-${now()}`));
        }
        fs.renameSync(staged, dest);
        installed[ref] = s.package.sha256;
        added.push(ref);
      }
      const changed = sha !== priorSha || added.length > 0;
      if (sha !== storedSha) { writeAtomic(files.catalog, bytes); writeAtomic(files.sig, sig); }
      writeJson(files.state, { v: 1, release: Math.max(cat.release, st.release), sha256: sha, keyId: cat.keyId, fetchedAt: new Date(now()).toISOString(), installed });
      memo = { key: null, value: null };
      // what this release withdraws that's here: counted on the bare repository (a guard would have hidden it already)
      const here = [...repoOf().list('shared'), ...repoOf().list('shipped')];
      const revoked = (cat.revoked || []).filter((r) => here.some((x) => x.id === r.id && (r.version === '*' || x.version === r.version)))
        .map((r) => ({ id: r.id, version: r.version, reason: r.reason }));
      return { ok: true, release: cat.release, changed, added, skipped, revoked, latest: latestLine(cat), tooOld: tooOldFor(cat), shared: guard().list('shared').filter((r) => r.ok).length };
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
      held.release();
    }
  }

  /** "Check for new styles": one run at a time (a second call while one runs gets the same answer). */
  function check() {
    if (!running) {
      running = (async () => {
        try { return await checkNow(); } catch (e) {
          if (e instanceof CatalogError) return { ok: false, code: e.code, problem: e.message };
          if (e instanceof zipdet.ZipError) return { ok: false, code: 'package', problem: clean(e.message, 200) };
          throw e;
        } finally { running = null; }
      })();
    }
    return running;
  }

  return {
    dir, files, check, status, hasShared, latestLine: () => latestLine(), inspiration: () => inspirationOf(stored().cat),
    revoked: revokedList, revocationOf, flagFor, assertRenderable, guard, floor,
  };
}

/** One check's answer as a few short lines (the plugin's flpt-styles fetch prints them). */
function describe(r) {
  if (!r || !r.ok) return [r && r.problem ? r.problem : 'The catalog couldn\'t be checked.'];
  const out = [`Catalog release ${r.release}${r.changed ? '' : ' · up to date'}`];
  if (r.added.length) out.push(`New: ${r.added.join(', ')}`);
  for (const s of r.skipped) out.push(`Waiting: ${s.ref} · ${s.problem}`);
  for (const v of r.revoked) out.push(`${v.reason === 'security' ? 'Withdrawn for security' : 'Withdrawn from the catalog'}: ${v.id}@${v.version}`);
  if (r.tooOld) out.push('This FLPT is too old for the catalog\'s styles.');
  if (r.latest) out.push(r.latest);
  return out;
}

/** Does a verified catalog hold a shared style installed here (the Gallery's Shared tab, W3-01)? No network. */
function hasShared({ projectsDir, engineRoot, keys } = {}) {
  if (!projectsDir) return false;
  try { return createCatalog({ projectsDir, engineRoot, keys }).hasShared(); } catch { return false; }
}

module.exports = {
  SCHEMA, BASE, REASONS, LIMITS, MEDIA_SLOTS, CatalogError,
  createCatalog, validateCatalog, verifyCatalog, findRevocation, cmpSemver, checkBase, catalogDir, sharedDir, inspirationOf, describe, hasShared,
};
