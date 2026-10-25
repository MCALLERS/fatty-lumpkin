'use strict';
// The plugin's spend consent (PLAN §2.16 item 5; billing trap T22: the plugin's model writes the spend consent). A
// paid CLI shows this native macOS dialog itself, so a yes comes only from the person at the Mac, never from the model
// that ran the command, whatever Claude Code's permission mode. It names the provider and the amount; Cancel is the
// default button (Return cancels), and after 120 seconds it answers Cancel. With no screen session to show it in,
// the answer is no.
// Nothing in the environment can answer it: tests replace ask() inside their own process (node -r <stub>).
const { execFile } = require('child_process');

// Absolute paths: an osascript or launchctl earlier on PATH can't answer for the user.
const OSASCRIPT = '/usr/bin/osascript';
const LAUNCHCTL = '/bin/launchctl';
const TIMEOUT_S = 120;

// Every text comes in as an argument, never spliced into the script.
const SCRIPT = [
  'on run argv',
  '  set {theTitle, theText, theYes, theWait} to {item 1 of argv, item 2 of argv, item 3 of argv, (item 4 of argv) as integer}',
  '  set r to display dialog theText with title theTitle buttons {"Cancel", theYes} default button "Cancel" cancel button "Cancel" with icon caution giving up after theWait',
  '  if gave up of r then return "timeout"',
  '  return "yes:" & (button returned of r)',
  'end run',
];

/** Run a program: { code, stdout, stderr, timedOut }. If this CLI is stopped meanwhile, the program (the dialog) goes too. */
function exec(file, args, { timeoutMs }) {
  return new Promise((resolve) => {
    const stop = (signal) => { child.kill(); process.exit(signal === 'SIGINT' ? 130 : 143); };
    const child = execFile(file, args, { timeout: timeoutMs, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || ''), timedOut: Boolean(err && err.killed) });
    });
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

/** The dialog's words: title, text and the yes button, from the provider and the amount. */
function words({ provider, usd, message, detail }) {
  const amount = usd.toFixed(2);
  return {
    title: `Spend money on ${provider}?`,
    text: [message, detail].filter((s) => typeof s === 'string' && s.trim()).join('\n\n') || `${amount} US dollars on ${provider}.`,
    yes: `Approve ${amount} US dollars`,
  };
}

/**
 * What a flow's spend question asks for: { provider, usd }, each null when it doesn't say. The provider is the one its
 * title names ("Spend money on HeyGen?", "Spend on Claude?"); the amount is its own figure, else its Approve button's.
 */
function request(o) {
  const provider = (String((o && o.title) || '').match(/^Spend (?:money )?on (.+)\?$/) || [])[1] || null;
  const usd = o && typeof o.usd === 'number' ? o.usd
    : Number((String((o && o.button) || '').match(/^Approve (?:up to )?(\d+(?:\.\d+)?) US dollars$/) || [])[1]);
  return { provider, usd: Number.isFinite(usd) ? usd : null };
}

/**
 * Ask the person at the Mac. Resolves { ok: true, usd } on Approve, else { ok: false, why }: 'cancel', 'timeout',
 * 'no-gui' (no screen session, or not a Mac), 'sandboxed' (the dialog can't open in this sandbox), 'invalid' (no
 * provider, or no amount) or 'error'.
 * deps (tests only): { run(file, args, { timeoutMs }), platform, timeoutS }.
 */
async function ask({ provider, usd, message, detail } = {}, deps = {}) {
  const run = deps.run || exec;
  const timeoutS = deps.timeoutS || TIMEOUT_S;
  if (typeof provider !== 'string' || !provider.trim() || typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0) return { ok: false, why: 'invalid' };
  if ((deps.platform || process.platform) !== 'darwin') return { ok: false, why: 'no-gui' };
  const session = await run(LAUNCHCTL, ['managername'], { timeoutMs: 5000 });
  if (session.code !== 0 || session.stdout.trim() !== 'Aqua') return { ok: false, why: 'no-gui' };
  const w = words({ provider, usd, message, detail });
  const r = await run(OSASCRIPT, [...SCRIPT.flatMap((line) => ['-e', line]), w.title, w.text, w.yes, String(timeoutS)], { timeoutMs: (timeoutS + 15) * 1000 });
  const out = r.stdout.trim();
  if (r.code === 0 && out === `yes:${w.yes}`) return { ok: true, usd: Number(usd.toFixed(2)) };
  if ((r.code === 0 && out === 'timeout') || r.timedOut) return { ok: false, why: 'timeout' };
  if (/\(-128\)/.test(r.stderr)) return { ok: false, why: 'cancel' };
  // The script (which compiles anywhere else) doesn't compile: "display dialog" is unknown where osascript can't load
  // its scripting additions, as inside Claude Code's Bash sandbox (measured with 2.1.42's Seatbelt profile: -2741).
  if (/syntax error: .*\(-27\d\d\)/.test(r.stderr)) return { ok: false, why: 'sandboxed' };
  return { ok: false, why: 'error' };
}

module.exports = { ask, request, words, SCRIPT, OSASCRIPT, LAUNCHCTL, TIMEOUT_S };
