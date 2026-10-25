#!/usr/bin/env node
'use strict';
// The FLPT voices' sign-in for the plugin (decisions.md, "FLPT voices": "a free email sign-in at
// flpt.bombadillo-ai.com, used by the Mac app (device-code sign-in), the web app and the plugin"; W4-10), through the Mac
// app's own client (providers/fish-house.js). FLPT's Worker gives a code; its page opens in the browser, where Access
// signs the person in by email and they connect this device; the token it answers with is kept in the plugin's own
// folder (FLPT_PLUGIN_HOME/flpt-voices.json, mode 0600, with the Worker that issued it): never in keys.env, never
// printed, and sent only to that Worker. Nothing here costs anything.
//   status            signed in (who) or not, and this month's free FLPT voice videos
//   start [--no-open] [--wait <s>]   a code and FLPT's page for it (opened in the browser unless --no-open); waits up to
//                     --wait seconds (default 100) for the answer, then `wait` carries on
//   wait [--wait <s>] go on waiting for the code `start` showed
//   signout           FLPT's Worker forgets this device, then this folder does
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { app, cli, usageError, main, say, pluginHome } = require('./common');

const USAGE = `
Usage: flpt-signin <command>
  status
  start [--no-open] [--wait <seconds>]
  wait [--wait <seconds>]
  signout`;
const OPTIONS = { 'no-open': { type: 'boolean' }, wait: { type: 'string' } };
const house = () => app('providers/fish-house');

const file = () => path.join(pluginHome(), 'flpt-voices.json');
function read() {
  try { const j = JSON.parse(fs.readFileSync(file(), 'utf8')); return j && typeof j === 'object' ? j : {}; } catch { return {}; }
}
function write(value) {
  fs.mkdirSync(path.dirname(file()), { recursive: true, mode: 0o700 });
  const tmp = `${file()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(tmp, file());
}
/** The sign-in this folder keeps, if it's for the Worker this plugin talks to now. */
function signedIn() {
  const s = read();
  return s.token && house().TOKEN_RE.test(s.token) && s.base === house().baseUrl() ? s : null;
}

const seconds = (v, fallback) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 600 ? n : fallback; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cmdStatus() {
  const s = signedIn();
  const host = house().hostOf(house().baseUrl());
  if (!s) { say(`Not signed in to the FLPT voices (${host}).`); return 0; }
  say(`Signed in to the FLPT voices${s.email ? ` as ${s.email}` : ''} (${host}).`);
  try {
    const u = await house().client().usage(s.token);
    if (!u) { say('That sign-in has ended: flpt-signin start'); return 1; }
    say(`This month: ${u.videosUsed} of ${u.videosPerMonth} free videos, ${u.charsPerVideo.toLocaleString('en-US')} characters each.`);
  } catch (e) { say(`(This month's count isn't available: ${e.message})`); }
  return 0;
}

/** Poll the code this folder keeps until it's answered, it runs out, or `waitS` passes. */
async function waitFor(waitS) {
  const s = read();
  const p = s.pending;
  // a code is the Worker's that gave it: polled there, and only while this plugin still talks to that Worker
  if (!p || !p.deviceCode || p.base !== house().baseUrl()) { say('No code is waiting: flpt-signin start'); return 1; }
  const c = house().client({ base: p.base });
  const end = Date.now() + waitS * 1000;
  let interval = Math.max(1, Number(p.interval) || 5);
  for (;;) {
    if (Date.now() > p.expiresAt) { write({ ...read(), pending: null }); say('The code ran out: flpt-signin start'); return 1; }
    if (Date.now() + interval * 1000 > end) { say(`Still waiting for ${p.userCode}: flpt-signin wait`); return 3; }
    await sleep(interval * 1000);
    let r;
    try { r = await c.poll(p.deviceCode); } catch (e) { if (e.retryable) { interval = Math.min(60, interval + 5); continue; } throw e; }
    if (r.state === 'slow') { interval = Math.min(60, interval + 5); continue; }
    if (r.state === 'pending') continue;
    if (r.state === 'done') {
      write({ token: r.token, email: r.email || null, base: c.base, at: new Date().toISOString(), pending: null });
      say(`Signed in to the FLPT voices${r.email ? ` as ${r.email}` : ''}.`);
      return 0;
    }
    write({ ...read(), pending: null });
    say(r.state === 'denied' ? 'Not connected.' : 'The code ran out: flpt-signin start');
    return 1;
  }
}

async function cmdStart(values) {
  const c = house().client();
  const s = await c.start('plugin');
  write({ ...read(), pending: { deviceCode: s.deviceCode, userCode: s.userCode, url: s.url, interval: s.interval, expiresAt: Date.now() + s.expiresIn * 1000, base: c.base } });
  say(`Code: ${s.userCode}`);
  say(`Page: ${s.url}`);
  if (!values['no-open'] && process.platform === 'darwin') execFile('/usr/bin/open', [s.url], () => {}); // FLPT's own page, built here
  return waitFor(seconds(values.wait, 100));
}

async function cmdSignOut() {
  const s = read();
  // the Worker that issued it forgets it (no other is ever sent it); this folder forgets it either way
  if (s.token && house().isFlpt(s.base)) { try { await house().client({ base: s.base }).signOut(s.token); } catch { /* offline: forgotten here anyway */ } }
  try { fs.rmSync(file(), { force: true }); } catch { /* gone */ }
  say('Signed out of the FLPT voices.');
  return 0;
}

main(async () => {
  const { values, positionals } = cli(USAGE, OPTIONS);
  const [cmd] = positionals;
  if (!cmd || cmd === 'status') return cmdStatus();
  if (cmd === 'start') return cmdStart(values);
  if (cmd === 'wait') return waitFor(seconds(values.wait, 100));
  if (cmd === 'signout') return cmdSignOut();
  return usageError(USAGE, `Unknown command: ${cmd}`);
});
