'use strict';
// flpt.review.render(upload): the server render of a style someone sent for review (W4-09; decisions.md D15/M2,
// PLAN §2.10.3). Only on the web surface: the Worker's /admin/review asks Michael's own backend (his web container,
// with W4-04's bwrap render sandbox; under wrangler dev, flpt-server --mode local on this Mac) through that backend's
// own session, upload and bridge call. Nothing the submitter rendered is used: the package carries no media, and its
// poster and loop are cut here from its own starter.
//   0. refused unless this host runs code in its OS sandbox (sandbox.available(): bwrap in the web image, which also
//      requires it; Seatbelt on a Mac under wrangler dev): a submitted style's code never runs bare here
//   1. the package is imported into a scratch projects folder that goes when the call ends (styles.importStyle: the zip
//      checked, the folder linted, never Michael's own Styles)
//   2. the full lint (style-lint, deep: flpt-live's code lint, long comments and strings, fonts, pictures, hashes, and
//      the starter drawn twice in fresh pages to the same frame hashes)
//   3. with a clean lint, the poster and loop from its own starter (styles.renderMedia: render-scene and loop,
//      sandboxed, with the style's default score)
//   ok only when the determinism check and the render both ran sandboxed.
// → { ok, lint: { ok, errors, warnings, problems }, frames, loopSeconds (the loop's length), renderSeconds (step 3's
//     wall time: with frames, the admin page's ms a frame), sandboxed, toolchain, media: { name: base64 }, problem }.
//     The Worker keeps the media for the preview site; the admin page shows them from there.
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_BYTES = 9 * 1024 * 1024;
const MEDIA = ['poster.jpg', 'poster-tall.jpg', 'loop.mp4', 'loop-tall.mp4'];

const said = (c, e) => (typeof c.redact === 'function' ? c.redact(String(e && e.message ? e.message : e)) : String(e && e.message ? e.message : e)).slice(0, 300);

/** The lint's answer as the queue keeps it: counts and the first twenty problems. */
function lintOf(problems) {
  const list = Array.isArray(problems) ? problems : [];
  const errors = list.filter((p) => p.level === 'error');
  return {
    ok: errors.length === 0, errors: errors.length, warnings: list.length - errors.length,
    problems: [...errors, ...list.filter((p) => p.level !== 'error')].slice(0, 20).map((p) => ({ rule: String(p.rule || ''), level: p.level === 'error' ? 'error' : 'warning', file: String(p.file || ''), message: String(p.message || '').slice(0, 240) })),
  };
}

/**
 * The server render (the header's steps). Stand-ins for the tests: styleLib (createStyles), sandboxLib (available()),
 * determinism (style-lint's in-page check), clock.
 */
async function render(c, file, { styleLib = require('../styles'), sandboxLib = require('../sandbox'), determinism = require('../style-lint').determinism, clock = Date.now } = {}) {
  const caps = c.caps; // the host's first: a host that can't say what it is gets no render
  const surface = typeof caps === 'function' ? caps.call(c).surface : null;
  if (surface !== 'web') throw new Error('Review renders run on FLPT\'s web server.');
  if (!sandboxLib.available()) throw new Error('No render sandbox here.');
  if (typeof file !== 'string' || !file) throw new Error('No package.');
  const st = fs.statSync(file);
  if (!st.isFile() || st.size > MAX_BYTES) throw new Error('That isn\'t a style package.');
  const buf = fs.readFileSync(file);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'flpt-review-'));
  try {
    // the host's toolchain on top of its own environment (the pinned HyperFrames, its browser, ffmpeg), when it has one
    const te = typeof c.toolEnv === 'function' ? c.toolEnv() : null;
    const env = te && typeof te === 'object' && Object.keys(te).length ? { ...process.env, ...te } : undefined;
    const styles = styleLib.createStyles({ engineRoot: c.engineRoot, projectsDir: scratch, mediaRoot: null, env, catalog: false });
    let rec;
    try { rec = await styles.importStyle(buf); } catch (e) {
      return { ok: false, problem: said(c, e), lint: e && Array.isArray(e.problems) ? lintOf(e.problems) : { ok: false, errors: 1, warnings: 0, problems: [{ rule: e && e.code ? String(e.code) : 'package', level: 'error', file: '', message: said(c, e) }] }, media: {} };
    }
    let det = null; // the deep lint's determinism check, kept to see that it ran sandboxed
    const lint = lintOf((await styles.lint(rec.id, { deep: true, determinism: async (root, style) => (det = await determinism(root, style, { engineRoot: c.engineRoot })) })).problems);
    if (!lint.ok) return { ok: false, problem: 'Lint errors.', lint, media: {} };
    let r;
    const t0 = clock();
    try { r = await styles.renderMedia(rec.id); } catch (e) { return { ok: false, problem: said(c, e), lint, media: {} }; }
    const renderSeconds = Math.round(clock() - t0) / 1000;
    const frames = r.render && Number.isFinite(r.render.frames) ? r.render.frames : null;
    const sandboxed = r.sandboxed === true && Boolean(det && det.sandboxed === true);
    if (!sandboxed) return { ok: false, problem: 'Not sandboxed.', lint, frames, renderSeconds, sandboxed: false, media: {} };
    const media = {};
    for (const name of MEDIA) {
      const f = path.join(r.dir, name);
      if (fs.existsSync(f)) media[name] = fs.readFileSync(f).toString('base64');
    }
    if (!media['loop.mp4'] || !media['poster.jpg']) return { ok: false, problem: 'The render gave no poster or loop.', lint, media: {} };
    return { ok: true, lint, frames, loopSeconds: r.seconds, renderSeconds, sandboxed, toolchain: r.toolchain || null, media, problem: null };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    try { fs.rmSync(file, { force: true }); } catch { /* the upload's own folder goes with its token */ }
  }
}

module.exports = {
  ns: 'review',
  methods: {
    render: { args: ['dropped1'], handler: (c, file) => render(c, file) },
  },
  // for the tests
  render, lintOf,
};
