'use strict';
// flpt.share: Save as style and Share (PLAN §2.10.2–§2.10.3, §3.3 S8b's ⋯ and S15; decisions.md D15; W3-02). The page
// names an episode and a piece, or a Mine style by its id, or a package by its token; every path is worked out here.
//   saveAsStyle(episode, key, name?)  an approved Live Motion piece as a Mine style (free: no model call): the style it
//                                     used, its kit-ext.js, the piece as a private demo (it may hold the talk's words,
//                                     so it never leaves this Mac as it is), its poster and loop cut from that demo
//   build(style)                      Share's neutral package of a Mine style (styles.sharePackage: the starter as the
//                                     demo, no talk text, no talk picture, no reference, linted), with a poster and loop
//                                     rendered from its own demo → { token, files, bytes, media, refsUsed, … } to show
//   view(token) · discard(token)
//   send(token, ticks)                to the review queue (D15; W4-09): the package as a .flptstyle, POSTed to FLPT's
//                                     site as the signed-in user (sharequeue.js, through the host's c.signIn). With no
//                                     sign-in here: { status: 'not-deployed' } and nothing leaves (the sheet offers
//                                     Export only). When the site can't be reached or the sign-in has lapsed, the
//                                     package is exported instead ({ status: 'exported', file }), so it isn't lost, and
//                                     the label says it wasn't sent and why ("Not sent · signed out · exported …"); the
//                                     queue's own no (a lint, a limit) comes back as the error. Refused without the
//                                     ticks, as Export is. On the web the Worker answers this call itself (it asks for
//                                     package below and queues the bytes as the Access user)
//   package(token, ticks)             the web only: the package's bytes for the Worker (base64), behind the same ticks
//   export(token, ticks)              the package as a .flptstyle in the deliverables folder (the ticks: { attest,
//                                     refsAttested }; "The reference is mine." is needed when the style used one)
// Event: share:changed { id } when a Mine style is made, or its share state changes (styles.markShare writes it), and
// styles:changed for the Gallery when a style's first Share gives it its own id (styles.sharePackage's per-person id,
// taken as the package leaves). Nothing here costs anything.
const fs = require('fs');
const os = require('os');
const path = require('path');
const episode = require('../episode');
const livemotion = require('../livemotion');
const sharequeue = require('../sharequeue');

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const said = (c, e) => (typeof c.redact === 'function' ? c.redact(String(e && e.message ? e.message : e)) : String(e && e.message ? e.message : e)).slice(0, 400);
const tell = (c, payload) => { try { c.send('share:changed', payload); } catch { /* no window */ } };
const STYLE_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const APP_VERSION = (() => { try { return require('../../../package.json').version; } catch { return null; } })();

/** The styles as the flow sees them (the projects folder's Mine and Shared, the engine's shipped), or a host's own (tests). */
function stylesOf(c) { return c.styles && typeof c.styles.get === 'function' ? c.styles : require('../ext/livemotion').stylesOf({ engineRoot: c.engineRoot, settings: c.settings }); }

/** The episode folder, checked: inside the projects folder, with a record this FLPT can read. */
function dirOf(c, dir) {
  if (!c.flow || !c.flow.inProjects(dir)) throw new Error('That isn\'t an FLPT episode folder.');
  const d = path.resolve(dir);
  const why = episode.tooNew(episode.readRaw(d));
  if (why) throw new Error(why);
  return d;
}

/** Is this piece approved (on its own, or Live Motion as a whole), and made? */
function approvedPiece(dir, key) {
  const p = livemotion.pieceOf(dir, key);
  const v = livemotion.view(dir).find((x) => x.key === p.key);
  const st = episode.read(dir) || {};
  const stage = Boolean(st.stages && st.stages.animate && st.stages.animate.status === 'approved');
  if (!v || !['ok', 'stale'].includes(v.status) || !(v.approved || stage)) throw new Error('Only an approved piece is saved as a style.');
  return p;
}

/** Did the piece draw on a reference (its plan's, or its storyboard shot's)? Then Share asks "The reference is mine." */
function usedRefs(dir, p) {
  if (p.plan.refs.length) return true;
  try {
    const board = require('../storyboard').read(dir);
    const s = board && p.shot ? board.shots.find((x) => x.id === p.shot) : null;
    return Boolean(s && Array.isArray(s.refs) && s.refs.length);
  } catch { return false; }
}

/**
 * Save an approved piece as a Mine style: styles.saveAsStyle with the episode's own copy of its style, then its poster
 * and loop from the piece itself (renderMedia from 'demo'; when the toolchain can't render, the style is kept and
 * media says why). → { style: { id, name, version, poster, loop }, media }
 */
async function saveAsStyle(c, dir, key, name) {
  const d = dirOf(c, dir);
  if (typeof key !== 'string' || !livemotion.KEY.test(key)) throw new Error('That isn\'t a Live Motion piece.');
  const p = approvedPiece(d, key);
  const styles = stylesOf(c);
  const styleDir = livemotion.styleDirOf(d, p, { engineRoot: c.engineRoot, styles });
  if (!styleDir) throw new Error('The episode has no copy of its style.');
  const rec = await styles.saveAsStyle({ sceneDir: livemotion.folderOf(d, p), styleDir, name: typeof name === 'string' ? name : '', fromEpisode: path.basename(d), fromShot: p.shot || null, refsUsed: usedRefs(d, p), episodeDir: d });
  let media = null;
  try { media = await styles.renderMedia(rec.id, { from: 'demo' }); media = { ok: true, seconds: media.seconds, score: media.score }; } catch (e) { media = { ok: false, problem: said(c, e) }; }
  const now = styles.get(rec.id);
  tell(c, { id: rec.id });
  return { style: { id: now.id, name: now.name, version: now.version, poster: now.media.poster, loop: now.media.loop }, media };
}

/**
 * A package for the page: its files, its media (flpt:// paths for the page to show), whether a reference was used, and
 * whether the talk it was saved from had gone with no print left (talkGone: its words weren't checked).
 */
function packView(p) {
  return { token: p.token, id: p.id, version: p.version, name: p.name, refsUsed: p.refsUsed, talkGone: p.talkGone === true, files: p.files, bytes: p.bytes,
    media: p.media ? { poster: p.media.poster, loop: p.media.loop } : null, mediaProblem: p.mediaProblem || null };
}

/** The ticks, as the page sends them: { attest, refsAttested } (true only when ticked). */
const ticks = (t) => ({ attest: isObj(t) && t.attest === true, refsAttested: isObj(t) && t.refsAttested === true });

/** A file name in the deliverables folder for an export that never overwrites one: <id>-<version>[ n].flptstyle. */
function exportPath(folder, id, version) {
  fs.mkdirSync(folder, { recursive: true });
  let f = path.join(folder, `${id}-${version}.flptstyle`);
  for (let n = 2; fs.existsSync(f); n++) f = path.join(folder, `${id}-${version} ${n}.flptstyle`);
  return f;
}

/** The review queue as a host without a sign-in has it (sharequeue.queueFor gives this one when c.signIn is absent). */
const QUEUE = sharequeue.createQueue({});
const NOT_DEPLOYED = Object.freeze({ status: 'not-deployed', label: 'The review queue isn\'t open yet.' });
/** Why Send for review exported instead, as the sheet's label says it. */
const NOT_SENT = Object.freeze({ unreachable: 'site out of reach', 'signed-out': 'signed out', 'not-deployed': 'queue not open' });

/** Which surface this is, for submission.json (mac, web, plugin, desk). */
function surfaceOf(c) {
  const caps = c.caps; // read outside the try: a host's own throw isn't swallowed here
  try { const s = typeof caps === 'function' ? caps.call(c).surface : null; return ['mac', 'web', 'plugin', 'desk'].includes(s) ? s : 'mac'; } catch { return 'mac'; }
}

/** The package's ticks, checked as Export checks them (a shareView of the token first: it must still be there). */
function checkedTicks(v, t) {
  const k = ticks(t);
  if (!k.attest) throw new Error('Not without the rights tick.');
  if (v.refsUsed && !k.refsAttested) throw new Error('Not without "The reference is mine."');
  return k;
}

/** The Gallery's tiles again when the package's leaving gave its style its own id (v.was: the id it had). */
function moved(c, v) { if (v.was) require('./styles').changed(c, { key: `mine:${v.id}` }); }

/** The package as a .flptstyle in the deliverables folder, never over an earlier export. */
async function exportTo(c, styles, token, k, v) {
  const folder = (c.settings.read().deliverablesDir) || path.join(os.homedir(), 'Desktop');
  const r = await styles.exportShare(token, exportPath(folder, v.id, v.version), { ...k, surface: surfaceOf(c), appVersion: APP_VERSION });
  if (c.produced && typeof c.produced.add === 'function') c.produced.add(r.file);
  moved(c, v);
  tell(c, { id: r.id });
  return { file: r.file, name: path.basename(r.file), bytes: r.bytes, sha256: r.sha256 };
}

/** The package's .flptstyle bytes (exportShare's own, in a scratch folder that goes at once). */
async function bytesOf(c, styles, token, k, v) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flpt-share-'));
  try {
    const r = await styles.exportShare(token, path.join(dir, `${v.id}-${v.version}.flptstyle`), { ...k, surface: surfaceOf(c), appVersion: APP_VERSION });
    moved(c, v);
    return { data: fs.readFileSync(r.file), sha256: r.sha256, name: path.basename(r.file) };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** The Mine style it came from: share { status: 'submitted' } (styles.markShare, as Export marks 'exported'). */
function markSubmitted(styles, id) {
  try { styles.markShare(id, 'submitted'); } catch { /* the queue has it either way */ }
}

/**
 * Send for review (D15): the package to the queue as the signed-in user; Export when the queue can't take it now.
 */
async function send(c, token, t) {
  const styles = stylesOf(c);
  const v = styles.shareView(token);
  const k = checkedTicks(v, t);
  const queue = sharequeue.queueFor(c);
  if (!queue.configured) return { ...NOT_DEPLOYED };
  const pkg = await bytesOf(c, styles, token, k, v);
  try {
    const r = await queue.send(pkg.data);
    markSubmitted(styles, v.id);
    tell(c, { id: v.id });
    return { status: r.status, id: r.id, label: r.label };
  } catch (e) {
    if (!e || e.code === 'refused' || !['unreachable', 'signed-out', 'not-deployed'].includes(e.code)) throw new Error(said(c, e));
    const x = await exportTo(c, styles, token, k, v);
    return { status: 'exported', reason: e.code, label: `Not sent · ${NOT_SENT[e.code]} · exported ${x.name}`, file: x.file, name: x.name };
  }
}

module.exports = {
  ns: 'share',
  methods: {
    saveAsStyle: { args: ['episode', 'text:80', 'text:40?'], handler: (c, dir, key, name) => saveAsStyle(c, dir, key, name) },
    build: { args: ['id:48'], handler: async (c, id) => {
      if (!STYLE_ID.test(id)) throw new Error('There\'s no style by that name.');
      return packView(await stylesOf(c).sharePackage({ id, scope: 'mine' }));
    } },
    view: { args: ['token'], handler: (c, token) => packView(stylesOf(c).shareView(token)) },
    discard: { args: ['token'], handler: (c, token) => stylesOf(c).discardShare(token) },
    send: { args: ['token', 'json:256'], handler: (c, token, t) => send(c, token, t) },
    package: { args: ['token', 'json:256'], handler: async (c, token, t) => {
      if (surfaceOf(c) !== 'web') throw new Error('Share sends it from here.');
      const styles = stylesOf(c);
      const v = styles.shareView(token);
      const p = await bytesOf(c, styles, token, checkedTicks(v, t), v);
      return { name: p.name, bytes: p.data.length, sha256: p.sha256, data: p.data.toString('base64') };
    } },
    export: { args: ['token', 'json:256'], handler: async (c, token, t) => {
      const styles = stylesOf(c);
      const v = styles.shareView(token);
      return exportTo(c, styles, token, ticks(t), v);
    } },
  },
  events: ['share:changed'],
  // for the tests and the plugin's flpt-refs (not methods)
  approvedPiece, usedRefs, exportPath, QUEUE, NOT_DEPLOYED, NOT_SENT, send, surfaceOf,
};
