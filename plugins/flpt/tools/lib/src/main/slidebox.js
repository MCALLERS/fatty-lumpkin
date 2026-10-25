'use strict';
// The slide pictures inside macOS's sandbox (T18; decisions.md, "Lead's rulings for Wave 2"). render_slides.py runs on
// the episode's own Python (a crew could have planted a .pth in its .venv) and renders a crew's slide HTML in Chrome.
// Here both run inside sandbox.js's jail: no network beyond this Mac, writes only under the episode's presentation/
// folder, the key files and the app's private folders unreadable. Chrome can't start its own sandbox inside Seatbelt
// (W1-12), so in there it runs without it, exactly as HyperFrames' Chrome does for every moving slide (K1): the jail is
// the boundary. FLPT_SANDBOXED=1, set here only on a run handed its sandbox (pipeline.js then wraps it or refuses it),
// tells the episode's render_slides.py (FLPT_SLIDE_SANDBOX_V1) to start Chrome that way, once it has confirmed the jail
// itself, with every request sent to a dead proxy, this Mac's loopback included. The free draft gets the same, so its
// placeholder cards (the same Chrome) keep their text.
//
// sandboxSlides(pipeline) gives a pipeline whose render and draft run that way by default. `sandbox: false` still opts
// out (QA only); where macOS's sandbox isn't there, they run as before. Nothing else changes.
const fs = require('fs');
const path = require('path');
const sandbox = require('./sandbox');

const MARKER = 'FLPT_SLIDE_SANDBOX_V1';
const CHANGED = 'This episode\'s pipeline changed.';
// What render_slides.py gives Chrome in the jail (FLPT_SLIDE_SANDBOX_V1; a test keeps the two the same): no own sandbox,
// every request to a dead proxy the jail never lets out (loopback too), no name resolution, QUIC or DNS prefetch; and
// in its fresh profile, no WebRTC UDP outside a proxy (headless Chrome takes that from the profile, not a switch, and
// the jail lets UDP reach loopback).
const JAIL_FLAGS = ['--no-sandbox', '--proxy-server=192.0.2.1:9', '--proxy-bypass-list=<-loopback>', '--host-resolver-rules=MAP * ~NOTFOUND',
  '--disable-quic', '--blink-settings=dnsPrefetchingEnabled=false', '--no-pings'];
const JAIL_PREFS = { webrtc: { ip_handling_policy: 'disable_non_proxied_udp', multiple_routes_enabled: false, nonproxied_udp_enabled: false } };

const renderScript = (dir) => path.join(dir, 'presentation', 'video', 'render_slides.py');
/** Whether the episode's render_slides.py knows how to start Chrome in the jail. */
function knowsJail(dir) {
  try { return fs.readFileSync(renderScript(dir), 'utf8').includes(MARKER); } catch { return false; }
}

/**
 * The sandbox a slide render (or the free draft) of this episode runs in: writes only under its presentation/ folder,
 * nothing read from the key files or `hidden`. Null without macOS's sandbox or the folder.
 */
function boxFor(dir, { hidden = [] } = {}) {
  const pres = path.join(dir, 'presentation');
  if (!sandbox.available() || !fs.existsSync(pres)) return null;
  return { writable: [pres], hidden: [...sandbox.hiddenDirs(), ...hidden.filter(Boolean)] };
}

/**
 * `pipeline` (pipeline.js) with its slide pictures and its free draft in the sandbox. `box(dir)` gives the sandbox
 * (default boxFor(dir)); a caller's own `sandbox` is kept.
 */
function sandboxSlides(pipeline, { box = (dir) => boxFor(dir) } = {}) {
  const boxOf = (dir, opts) => (opts.sandbox === false ? null : opts.sandbox || box(dir) || null);
  const jailed = (opts, b) => ({ ...opts, sandbox: b, env: { ...(opts.env || {}), FLPT_SANDBOXED: '1' } });

  /**
   * Free: the slide pictures, in the sandbox. An episode made before FLPT_SLIDE_SANDBOX_V1 is patched first. (Without a
   * render_slides.py at all, the run goes ahead in the sandbox and fails there, as it would have outside.)
   */
  async function render(dir, opts = {}) {
    const b = boxOf(dir, opts);
    if (!b) return pipeline.render(dir, opts);
    const has = () => fs.existsSync(renderScript(dir));
    if (has() && !knowsJail(dir)) await pipeline.patchScripts(dir, { signal: opts.signal });
    if (has() && !knowsJail(dir)) {
      // a render_slides.py the patch can't place (changed by hand): refused, never run outside; Restore fixes it
      if (opts.onLine) opts.onLine(CHANGED);
      const t = typeof pipeline.trust === 'function' ? pipeline.trust(dir) : { changed: [] };
      return { code: 2, lines: [CHANGED], refused: true, changed: t.changed.length ? t.changed : ['render_slides.py'] };
    }
    return pipeline.render(dir, jailed(opts, b));
  }

  /** Free: the draft, in the same sandbox, so its placeholder cards keep their text. */
  function draft(dir, opts = {}) {
    const b = boxOf(dir, opts);
    return pipeline.draft(dir, b ? jailed(opts, b) : opts);
  }

  return { ...pipeline, render, draft, slideSandbox: (dir) => box(dir) };
}

/**
 * [program, args] for another headless Chrome FLPT starts on a crew's HTML (the layout check, layoutqa.js), the way
 * render_slides.py's runs in the jail: inside `box` (sandbox.wrap), with JAIL_FLAGS and its fresh `profile` (a folder
 * in the temporary folders) given JAIL_PREFS. Its environment needs TMPDIR = sandbox.tmpdir().
 */
function jailedChrome(chrome, args, { box, profile }) {
  fs.mkdirSync(path.join(profile, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(profile, 'Default', 'Preferences'), JSON.stringify(JAIL_PREFS));
  return sandbox.wrap(chrome, [...JAIL_FLAGS, ...args], box);
}

module.exports = { sandboxSlides, boxFor, knowsJail, jailedChrome, MARKER, CHANGED, JAIL_FLAGS, JAIL_PREFS };
