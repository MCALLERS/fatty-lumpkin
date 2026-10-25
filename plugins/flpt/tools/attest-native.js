'use strict';
// The plugin's Share ticks (PLAN §2.10.3, §3.3 S15; W3-02): the ⚑ lines a person ticks before a style leaves the Mac,
// asked in a native macOS dialog that flpt-refs shows itself, so the yes comes only from the person at the Mac, never
// from the model that ran the command (as confirm-native.js does for money). Cancel is the default button (Return
// cancels); after 120 seconds it answers Cancel; with no screen session to show it in, the answer is no.
// Nothing in the environment can answer it: tests replace ask() inside their own process (node -r <stub>).
const { execFile } = require('child_process');
// The ⚑ lines are styles.js's own (what submission.json records), so the dialog and the record never drift apart. One
// dialog and one yes cover both lines when a reference was used (the app has a tick for each: a divergence, W4-06).
const { SCRIPT, OSASCRIPT, LAUNCHCTL, TIMEOUT_S } = require('./confirm-native');
const { ATTEST, ATTEST_REFS } = require('./lib/src/main/styles');

const YES = 'I made this';

function exec(file, args, { timeoutMs }) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 1 << 20 }, (err, stdout, stderr) => resolve({
      code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || ''), timedOut: Boolean(err && err.killed) }));
  });
}

/** The dialog's words: the style's name, the ⚑ lines (the reference's too when one was used), the yes button. */
function words({ name = 'this style', refs = false } = {}) {
  return { title: `Share ${String(name).slice(0, 40)}?`, text: [`⚑ ${ATTEST}`, refs ? `⚑ ${ATTEST_REFS}` : null].filter(Boolean).join('\n\n'), yes: YES };
}

/**
 * Ask the person at the Mac to tick the ⚑ lines. → { ok: true, refs } on the yes (refs: the reference's line was in
 * it), else { ok: false, why: 'cancel' | 'timeout' | 'no-gui' | 'sandboxed' | 'error' }.
 * deps (tests only): { run(file, args, { timeoutMs }), platform, timeoutS }.
 */
async function ask({ name, refs = false } = {}, deps = {}) {
  const run = deps.run || exec;
  const timeoutS = deps.timeoutS || TIMEOUT_S;
  if ((deps.platform || process.platform) !== 'darwin') return { ok: false, why: 'no-gui' };
  const session = await run(LAUNCHCTL, ['managername'], { timeoutMs: 5000 });
  if (session.code !== 0 || session.stdout.trim() !== 'Aqua') return { ok: false, why: 'no-gui' };
  const w = words({ name, refs });
  const r = await run(OSASCRIPT, [...SCRIPT.flatMap((line) => ['-e', line]), w.title, w.text, w.yes, String(timeoutS)], { timeoutMs: (timeoutS + 15) * 1000 });
  const out = r.stdout.trim();
  if (r.code === 0 && out === `yes:${w.yes}`) return { ok: true, refs: Boolean(refs) };
  if ((r.code === 0 && out === 'timeout') || r.timedOut) return { ok: false, why: 'timeout' };
  if (/\(-128\)/.test(r.stderr)) return { ok: false, why: 'cancel' };
  if (/syntax error: .*\(-27\d\d\)/.test(r.stderr)) return { ok: false, why: 'sandboxed' };
  return { ok: false, why: 'error' };
}

module.exports = { ask, words, ATTEST, ATTEST_REFS, YES };
