'use strict';
// The OS sandbox around the programs that render what a crew wrote. A HyperFrames render is a headless Chrome running
// the composition's own scripts, and on its own it reaches the web (measured: a fetch() to example.com from a
// composition succeeds during a normal render). One API, two backends:
//
//   macOS (Seatbelt, /usr/bin/sandbox-exec)
//     - no network beyond this Mac (HyperFrames serves the page to its Chrome on localhost); names don't even resolve.
//       A caller that knows its port (render-direct, the Stage's snapshot) passes `ports` and gets only those
//       (localhost:<port>, never localhost:*); `loopback: false` closes loopback too (a Python run needs none)
//     - writes only inside the folders named, the per-user temporary folders and /dev
//     - nothing read from the plain-text key files or the usual credential folders
//
//   Linux (bubblewrap, the web image; spike K3's "V3"): a root launcher builds the sandbox, and what runs inside is
//   uid 1000 in a user namespace of its own (no further one can be made inside) with every capability dropped, in new
//   network (loopback only, its own), IPC, UTS, cgroup and PID namespaces with a fresh /proc (so no other process's
//   environ is there to read). The system is read-only, the hidden folders are covered (a credential file by
//   /dev/null; one inside a writable folder too), writes go only to the folders named (and the temp folder unless
//   `scratch: false`, which gives a private /tmp instead), and the environment is the one passed in `env` (--clearenv)
//   or, without it, the caller's minus anything shaped like a secret. A weaker sandbox (no PID namespace) is never used.
//
// Required (the web image): where FLPT_SANDBOX_REQUIRED=1 (host-web sets it) or the image's marker file is there,
// available() is true whatever kind() finds, so every caller goes through wrap(), and wrap() throws when no sandbox
// can be built here (an unprivileged container, `wrangler dev`): every render refuses, nothing runs bare. Elsewhere (the
// plugin on a Linux machine without bwrap) available() is false and the caller decides, as on a Mac without
// sandbox-exec. kind() always names the sandbox that actually runs, or null.
//
// Never writable, however a path gets there: the system folders, and those the image's marker and FLPT_SANDBOX_PROTECT
// name (the web host's code, toolchain and profile; the toolchain's font cache excepted). A link an earlier sandboxed run planted in a folder it could write (<piece>/snapshots →
// /opt/flpt/repo/engine) would otherwise hand that folder to the next run, and trusted code outside would load it.
//
// The same sandbox applies to everything the command starts (Node, Chrome, ffmpeg, Python).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const EXEC = '/usr/bin/sandbox-exec';
const BWRAP = ['/usr/bin/bwrap', '/bin/bwrap', '/usr/local/bin/bwrap'];
// The uid and gid a render runs as inside bwrap's user namespace (never root; capabilities all dropped).
const UID = 1000;
// Variables never passed into a Linux sandbox when the caller doesn't give the whole environment (`env`): keys,
// tokens, secrets, passwords, credentials, the web's Worker secret and per-job capabilities.
const SECRET_ENV = /(_KEY|_TOKEN|_SECRET|_PASSWORD|_CREDENTIALS|_CAPABILITY)$|^FLPT_(WEB_SECRET|HEYGEN_JOB|JOB)|^ANTHROPIC_CUSTOM_HEADERS$/i;
// The web image's marker: a sandbox is required in every process there, also one started with a fresh environment.
const REQUIRED_MARK = '/etc/flpt/sandbox-required';
// Never writable inside a sandbox (with FLPT_SANDBOX_PROTECT's folders): the system's own.
const SYSTEM = ['/bin', '/boot', '/etc', '/lib', '/lib32', '/lib64', '/libx32', '/sbin', '/usr', '/opt/homebrew', '/System', '/Library', '/Applications', '/private/etc'];

/** Whether this process may run nothing outside a sandbox: FLPT_SANDBOX_REQUIRED=1, or (Linux) the web image's marker. */
function required({ env = process.env, platform = process.platform, exists = (p) => fs.existsSync(p) } = {}) {
  if (String(env.FLPT_SANDBOX_REQUIRED || '') === '1') return true;
  return platform === 'linux' && exists(REQUIRED_MARK);
}

/** 'seatbelt' on a Mac with sandbox-exec, 'bwrap' on Linux where bubblewrap can build the full sandbox, else null. */
let linuxState = null; // cached: { bwrap, ok, why }
function bwrapPath() { return BWRAP.find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } }) || null; }

/**
 * Whether bubblewrap can build the whole sandbox here (user, network, IPC, UTS and PID namespaces, a fresh /proc).
 * Probed once per process with `true` inside. → { bwrap, ok, why }.
 */
function probeLinux({ fresh = false } = {}) {
  if (linuxState && !fresh) return linuxState;
  const bwrap = bwrapPath();
  if (!bwrap) return (linuxState = { bwrap: null, ok: false, why: 'bubblewrap isn\'t installed' });
  const t = firstExisting(['/usr/bin/true', '/bin/true']) || 'true';
  const r = spawnSync(bwrap, [...namespaceArgs(), '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--', t], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 15000, env: {} });
  const ok = r.status === 0;
  return (linuxState = { bwrap, ok, why: ok ? null : String((r.stderr || '') || (r.error && r.error.message) || `exit ${r.status}`).trim().split('\n')[0].slice(0, 200) });
}

function kind() {
  if (process.platform === 'darwin') { try { fs.accessSync(EXEC, fs.constants.X_OK); return 'seatbelt'; } catch { return null; } }
  if (process.platform === 'linux') return probeLinux().ok ? 'bwrap' : null;
  return null;
}

/** Whether commands go through wrap() here: a sandbox runs, or one is required (then wrap() refuses without it). */
function available() { return kind() !== null || required(); }

const firstExisting = (cands) => cands.find((c) => { try { fs.accessSync(c); return true; } catch { return false; } }) || null;

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

/**
 * Never readable inside: avatar-presentation's keys.env (plain text) and the usual places credentials live. On Linux
 * also /run/flpt (the web container's per-job sockets, spike K10), the shadow files (inside, uid 1000 is the launcher's
 * root to the files it owns, so a root-only file must be covered, not just unreadable), and what FLPT_SANDBOX_HIDE
 * names (absolute paths, ':'-separated: the web host's own private folders).
 */
function hiddenDirs(home = os.homedir(), platform = process.platform, env = process.env) {
  const mine = ['.config/avatar-presentation', '.ssh', '.aws', '.gnupg', '.netrc', '.docker'].map((p) => path.join(home, p));
  if (platform !== 'linux') return mine;
  const extra = String(env.FLPT_SANDBOX_HIDE || '').split(':').filter((p) => path.isAbsolute(p) && p !== '/');
  return [...mine, '/run/flpt', '/etc/shadow', '/etc/gshadow', ...extra];
}

/** Seatbelt's outbound rule: localhost:<port> for each port named, localhost:* without ports, nothing when loopback is off. */
function loopbackRule({ ports = null, loopback = true } = {}) {
  if (loopback === false) return [];
  const list = Array.isArray(ports) ? [...new Set(ports.map(Number))] : null;
  if (list) {
    for (const p of list) if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error(`not a port: ${p}`);
    return list.length ? [`(allow network-outbound${list.map((p) => ` (remote ip "localhost:${p}")`).join('')})`] : [];
  }
  return ['(allow network-outbound (remote ip "localhost:*"))'];
}

/** The Seatbelt profile, with the folders as parameters (-D), so no path is ever spliced into the policy text. */
function profile(nWritable, nHidden, net = {}) {
  return [
    '(version 1)',
    '(allow default)',
    '(deny network-outbound)',
    ...loopbackRule(net),
    '(deny file-write*)',
    `(allow file-write* (subpath "/dev")${Array.from({ length: nWritable }, (_, i) => ` (subpath (param "W${i}"))`).join('')})`,
    ...(nHidden ? [`(deny file-read*${Array.from({ length: nHidden }, (_, i) => ` (subpath (param "H${i}"))`).join('')})`] : []),
  ].join('\n');
}

/** bwrap's namespaces and identity: K3's V3 (a root launcher; inside, uid 1000 with no capabilities). */
function namespaceArgs() {
  return ['--unshare-user', '--disable-userns', '--uid', String(UID), '--gid', String(UID), '--cap-drop', 'ALL',
    '--unshare-net', '--unshare-ipc', '--unshare-uts', '--unshare-cgroup-try', '--unshare-pid',
    '--hostname', 'flpt-sandbox', '--die-with-parent', '--new-session',
    // no bwrap reaper inside: it would be PID 1 there with the launcher's whole environment, readable as its owner
    '--as-pid-1'];
}

/**
 * The bwrap arguments (everything before the command) for one sandboxed run. Pure, so it's tested anywhere.
 * @param {object} o  writable (folders it may write; made when missing), hidden (covered), scratch (share the temp
 *                    folder, default true; false: a private /tmp), env (the whole environment: --clearenv + --setenv),
 *                    envNames (without env: the names to drop, default those in process.env shaped like a secret),
 *                    isDir (path → true|false|null for a missing one; tests pass their own)
 */
function bwrapArgs({ writable = [], hidden = hiddenDirs(), scratch = true, env = null, envNames = Object.keys(process.env), isDir = statKind,
  home = os.homedir(), launcherIsRoot = typeof process.getuid === 'function' && process.getuid() === 0 } = {}) {
  const args = [...namespaceArgs(), '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--tmpfs', '/dev/shm'];
  const tmp = tmpdir();
  if (!scratch) for (const t of new Set(['/tmp', tmp])) args.push('--tmpfs', t); // a private, empty temp folder
  // the root launcher's own home (the web image's /root): private, empty and writable inside. Nothing a render needs is
  // there, and Chrome must be able to write its crash settings under $HOME (it stops with SIGTRAP when it can't)
  const ownHome = launcherIsRoot && home && path.isAbsolute(home) && home !== '/' && isDir(home) === true ? real(home) : null;
  if (ownHome) args.push('--tmpfs', ownHome);
  const covers = [];
  for (const h of [...new Set(hidden.filter(Boolean).map(real))]) {
    if (ownHome && (h === ownHome || h.startsWith(`${ownHome}/`))) continue; // already covered
    const k = isDir(h);
    if (k === true) covers.push([h, ['--tmpfs', h]]);
    else if (k === false) covers.push([h, ['--ro-bind', '/dev/null', h]]);
  }
  for (const [, c] of covers) args.push(...c);
  // the outermost of nested folders only: one inside another is writable already, and a bind would make it a mount
  // point that can't be removed and made again inside (Seatbelt allows that; a render that empties its folder does it)
  const all = [...new Set([...writable.filter(Boolean).map(real), ...(scratch ? [tmp] : [])])];
  const w = all.filter((p) => !all.some((q) => q !== p && p.startsWith(q === '/' ? '/' : `${q}/`)));
  for (const p of w) args.push('--bind', p, p);
  // a hidden path inside a writable folder is covered again, over the bind (which would show it: Seatbelt's deny keeps
  // it hidden there too). A folder named writable inside a hidden one stays writable.
  for (const [h, c] of covers) if (w.some((p) => h.startsWith(p === '/' ? '/' : `${p}/`))) args.push(...c);
  if (env) {
    args.push('--clearenv');
    for (const [k, v] of Object.entries(env)) if (v != null && /^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) args.push('--setenv', k, String(v));
  } else {
    for (const k of envNames) if (SECRET_ENV.test(k)) args.push('--unsetenv', k);
  }
  return args;
}

/** true for a folder, false for anything else that exists, null when nothing's there. */
function statKind(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return null; }
}

/** The web image's marker file (Linux), or '' (none, or another system). */
function markText(platform = process.platform) {
  if (platform !== 'linux') return '';
  try { return fs.readFileSync(REQUIRED_MARK, 'utf8'); } catch { return ''; }
}

/**
 * The folders no sandbox may write, as real paths: { roots, except }. The system's, the web image's marker (one
 * absolute path a line) and FLPT_SANDBOX_PROTECT's (':'-separated); `!` before a path keeps that one writable inside
 * them (the toolchain's font cache, which HyperFrames fills while it renders).
 */
function protectedDirs({ env = process.env, mark = markText() } = {}) {
  const items = [...String(mark || '').split('\n'), ...String(env.FLPT_SANDBOX_PROTECT || '').split(':')].map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
  const abs = (p) => path.isAbsolute(p) && p !== '/';
  const roots = [...SYSTEM, ...items.filter((s) => !s.startsWith('!') && abs(s))];
  const except = items.filter((s) => s.startsWith('!')).map((s) => s.slice(1)).filter(abs);
  return { roots: [...new Set(roots.map(real))], except: [...new Set(except.map(real))] };
}

/** Throws for a writable folder that is / or, followed through every link, a protected folder or inside one. */
function checkWritable(writable, { roots, except } = protectedDirs()) {
  const inside = (r, q) => r === q || r.startsWith(`${q}/`);
  for (const p of writable.filter(Boolean)) {
    const r = real(p);
    if (r === '/' || (roots.some((q) => inside(r, q)) && !except.some((q) => inside(r, q)))) throw new Error(`${p} can't be written in the sandbox`);
  }
}

/**
 * [program, args] that run `cmd args` inside the sandbox, writing only inside `writable` (and, unless `scratch` is
 * false, the temp folders). Throws when the sandbox isn't there (required or not: callers that may run without it ask
 * available() first), and for a writable folder that's protected (checkWritable).
 * Options: writable, hidden (default hiddenDirs()), scratch (default true), ports (Seatbelt: the only loopback ports it
 * may reach), loopback (false: no loopback either), env (Linux: the whole environment inside), envNames (Linux, without
 * env: the names of the environment the caller will start it with, so each one shaped like a secret is dropped; default
 * this process's).
 */
function wrap(cmd, args = [], { writable = [], hidden = hiddenDirs(), scratch = true, ports = null, loopback = true, env = null, envNames = null } = {}) {
  const k = kind();
  if (k) checkWritable(writable);
  if (k === 'seatbelt') {
    const w = [...new Set([...writable.filter(Boolean).map(real), ...(scratch ? scratchDirs() : [])])];
    const h = [...new Set(hidden.filter(Boolean).map(real))];
    const params = [...w.flatMap((p, i) => ['-D', `W${i}=${p}`]), ...h.flatMap((p, i) => ['-D', `H${i}=${p}`])];
    return [EXEC, ['-p', profile(w.length, h.length, { ports, loopback }), ...params, cmd, ...args]];
  }
  if (k === 'bwrap') {
    for (const p of writable.filter(Boolean)) { try { fs.mkdirSync(real(p), { recursive: true }); } catch { /* bwrap says so */ } }
    return [linuxState.bwrap, [...bwrapArgs({ writable, hidden, scratch, env, ...(Array.isArray(envNames) ? { envNames } : {}) }), '--', cmd, ...args]];
  }
  if (process.platform === 'linux') throw new Error(`the Linux sandbox (bubblewrap) isn't available${linuxState && linuxState.why ? `: ${linuxState.why}` : ''}`);
  if (process.platform === 'darwin') throw new Error('macOS\'s sandbox (sandbox-exec) isn\'t available');
  throw new Error('there\'s no sandbox on this machine');
}

module.exports = { available, kind, required, wrap, profile, bwrapArgs, probeLinux, scratchDirs, hiddenDirs, protectedDirs, checkWritable, tmpdir, loopbackRule,
  EXEC, UID, SECRET_ENV, REQUIRED_MARK, SYSTEM };
