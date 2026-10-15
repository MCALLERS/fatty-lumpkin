'use strict';
// macOS's sandbox (Seatbelt, through /usr/bin/sandbox-exec) around the programs that render what a crew wrote. A
// HyperFrames render is a headless Chrome running the composition's own scripts, and on its own it reaches the web
// (measured: a fetch() to example.com from a composition succeeds during a normal render). Inside the sandbox:
//   - no network beyond this Mac (HyperFrames serves the page to its Chrome on localhost); names don't even resolve
//   - writes only inside the folders named, the per-user temporary folders and /dev
//   - nothing read from the plain-text key files or the usual credential folders
// The same profile applies to everything the command starts (Node, Chrome, ffmpeg, Python).
const fs = require('fs');
const os = require('os');
const path = require('path');

const EXEC = '/usr/bin/sandbox-exec';

function available() {
  if (process.platform !== 'darwin') return false;
  try { fs.accessSync(EXEC, fs.constants.X_OK); return true; } catch { return false; }
}

/** The real path the sandbox will see (it matches resolved paths), also for a folder that doesn't exist yet. */
function real(p) {
  let head = path.resolve(p);
  const rest = [];
  for (;;) {
    try { return path.join(fs.realpathSync(head), ...rest); } catch { /* go up */ }
    if (path.dirname(head) === head) return path.resolve(p);
    rest.unshift(path.basename(head));
    head = path.dirname(head);
  }
}

/** The per-user temporary folders (/private/var/folders/xx/yyyy, which holds T/ and C/): Chrome's and HyperFrames' scratch. */
function scratchDirs() {
  const t = real(os.tmpdir());
  return /^\/private\/var\/folders\/[^/]+\/[^/]+\/T$/.test(t) ? [path.dirname(t)] : [t];
}

/** The temporary folder a sandboxed command must be told about (TMPDIR): without it, Chrome and Node use /tmp, closed here. */
const tmpdir = () => real(os.tmpdir());

/** Never readable inside: avatar-presentation's keys.env (plain text) and the usual places credentials live. */
function hiddenDirs(home = os.homedir()) {
  return ['.config/avatar-presentation', '.ssh', '.aws', '.gnupg', '.netrc', '.docker'].map((p) => path.join(home, p));
}

/** The profile, with the folders as parameters (-D), so no path is ever spliced into the policy text. */
function profile(nWritable, nHidden) {
  return [
    '(version 1)',
    '(allow default)',
    '(deny network-outbound)',
    '(allow network-outbound (remote ip "localhost:*"))',
    '(deny file-write*)',
    `(allow file-write* (subpath "/dev")${Array.from({ length: nWritable }, (_, i) => ` (subpath (param "W${i}"))`).join('')})`,
    ...(nHidden ? [`(deny file-read*${Array.from({ length: nHidden }, (_, i) => ` (subpath (param "H${i}"))`).join('')})`] : []),
  ].join('\n');
}

/**
 * [program, args] that run `cmd args` inside the sandbox, writing only inside `writable` (and, unless `scratch` is
 * false, the temp folders). Throws when the sandbox isn't there: callers decide whether a command may run without it.
 */
function wrap(cmd, args = [], { writable = [], hidden = hiddenDirs(), scratch = true } = {}) {
  if (!available()) throw new Error('macOS\'s sandbox (sandbox-exec) isn\'t available');
  const w = [...new Set([...writable.filter(Boolean).map(real), ...(scratch ? scratchDirs() : [])])];
  const h = [...new Set(hidden.filter(Boolean).map(real))];
  const params = [...w.flatMap((p, i) => ['-D', `W${i}=${p}`]), ...h.flatMap((p, i) => ['-D', `H${i}=${p}`])];
  return [EXEC, ['-p', profile(w.length, h.length), ...params, cmd, ...args]];
}

module.exports = { available, wrap, profile, scratchDirs, hiddenDirs, tmpdir, EXEC };
