'use strict';
// What each crew may write, and read (PLAN §2.16 item 2; billing trap T18: a crew plants code that later runs with the
// keys). A crew works in the episode's presentation/ folder. Every path it names is resolved there, then followed to
// where it really leads: the realpath of its deepest existing part, with the rest appended. A write must land inside
// presentation/, match its stage's allowlist and nothing on the global deny list, and must not be a link, or a file
// with a second name. Reads stay inside presentation/ or the bundled method, never under refs/ or anything the caller
// denies.
//
// Two layers enforce it. The crew's canUseTool asks write() and read() (agents.js wraps every crew's own policy in
// guard()). The CLI also gets the deny lists as its own permission rules (cliRules()): it refuses them before asking,
// in any permission mode, and it leaves refs/ out of Grep and Glob, whose reads inside the working folder never reach
// canUseTool (measured with the real CLI, qa/trust-boundary.mjs).
//
// Every stage, the Wave 2 crews included, is defined here: later work passes options, it doesn't edit this file.
const fs = require('fs');
const path = require('path');

// Patterns are relative to presentation/ (or to the crew's own folder, where a stage says so), '/'-separated, and
// matched without regard to case (Mac volumes usually ignore it). '**/' is any number of folders, none included; a
// final '/**' is everything below; '*' is any run of characters within one name. No braces: the same strings are the
// CLI's gitignore-style rules.
const GLOBAL_DENY = [
  // §2.16: the pipeline and the player, Python's environment, scripts, the app's records, the score and references
  'video/**', 'player/**', '**/.venv/**',
  '**/*.py', '**/*.pth', '**/*.sh', '**/*.command',
  'hyperframes/**/render.mjs', 'hyperframes/**/retime.py',
  '**/flpt-project.json', '**/storyboard.json', '**/score/**', '**/refs/**',
  // and whatever else runs, or steers what runs, outside a browser: hidden files and folders (.npmrc, .env, .venv,
  // .flpt), compiled Python, Node modules and packages, other shells, native libraries
  '**/.*', '**/.*/**', '**/__pycache__/**', '**/*.pyc', '**/node_modules/**', '**/package.json',
  '**/*.mjs', '**/*.cjs', '**/*.node', '**/*.zsh', '**/*.bash', '**/*.so', '**/*.dylib',
];

// Never readable by a crew: reference captures and their cards (only the app's crewView of a card reaches a prompt),
// and the pipeline's per-project keys file (the plugin's scene guard closes it by name too: W2-12 handoff 2).
const READ_DENY = ['**/refs/**', '**/video/api_keys.txt'];

const DECK_TYPES = ['html', 'css', 'json', 'md', 'svg', 'png', 'jpg', 'jpeg', 'webp'];

// Each stage's allowlist. `folder: true`: the patterns are inside the crew's own folder (opts.folder, which must be in
// hyperframes/), and `deny` is subtracted there.
const STAGES = {
  bullets: { write: ['bullets.md', 'research/**'] },
  factcheck: { write: ['bullets.md', 'research/**'] },
  deck: { write: DECK_TYPES.map((x) => `deck/**/*.${x}`) },
  script: { write: ['script.md'] },
  // one animator per slide: anything in its hyperframes/slide_NN/ but the method's scripts and the app's records (a Live
  // Motion scene's record too: its rendered.sha would make motion.clipIsOurs take a clip of the user's for FLPT's)
  animate: { folder: true, write: ['**'], deny: ['**/render.mjs', '**/retime.py', 'flpt-animator.json', 'flpt-motion.json', 'scene.json'] },
  // the storyboard is written only by its tool (save_storyboard)
  storyboard: { write: [] },
  // a Live Motion crew: its scene and beats, its notes and its kit extension; pictures come in through use_picture
  scene: { folder: true, write: ['scene.js', 'beats.json', 'notes.md', 'kit-ext.js'] },
};

const cache = new Map();
/** A pattern as a RegExp over '/'-separated relative paths (see the rules above). */
function globRe(pattern) {
  if (cache.has(pattern)) return cache.get(pattern);
  let re = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*' && (i === 0 || pattern[i - 1] === '/')) {
      if (pattern[i + 2] === '/') { re += '(?:[^/]*/)*'; i += 2; continue; }
      if (i + 2 === pattern.length) { re += '.*'; i += 1; continue; }
    }
    if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  const out = new RegExp(`^${re}$`, 'i');
  cache.set(pattern, out);
  return out;
}

/** Does a '/'-separated relative path match any of the patterns? */
const matches = (rel, patterns) => patterns.some((p) => globRe(p).test(rel));

const lstat = (p) => { try { return fs.lstatSync(p); } catch { return null; } };

/**
 * Where an absolute path really leads: the realpath of its deepest existing part, with the rest appended. null when a
 * link that leads nowhere (or in a loop) is on the way: a write there would land wherever the link points.
 */
function realOf(abs) {
  const tail = [];
  let probe = path.resolve(abs);
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(probe), ...tail.reverse());
    } catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') return null;
      if (lstat(probe)) return null; // it exists, yet has no real path: a dangling link
    }
    const up = path.dirname(probe);
    if (up === probe) return null;
    tail.push(path.basename(probe));
    probe = up;
  }
}

/** child relative to root, '/'-separated ('' for root itself), or null when it's outside. */
function relIn(child, root) {
  if (!child || !root) return null;
  const r = path.relative(root, child);
  if (r === '') return '';
  if (r === '..' || r.startsWith(`..${path.sep}`) || path.isAbsolute(r)) return null;
  return r.split(path.sep).join('/');
}

/** Is p (relative ones resolved against base, root by default) really inside root, or root itself? */
function within(p, root, base = root) {
  if (typeof p !== 'string' || !p || p.includes('\0') || typeof root !== 'string' || !root) return false;
  return relIn(realOf(path.resolve(base, p)), realOf(root)) != null;
}

/** The fixed part of a glob pattern (the folders before the first wildcard), resolved against base. */
function globBase(pattern, base) {
  const parts = String(pattern).split(/[/\\]/);
  const fixed = [];
  for (const part of parts.slice(0, -1)) {
    if (/[*?[\]{}]/.test(part)) break;
    fixed.push(part);
  }
  const joined = fixed.join('/') || (String(pattern).startsWith('/') ? '/' : '.');
  return path.resolve(base, joined);
}

/** The paths a read-only tool call touches: Read's file, Grep's folder, Glob's folder and its pattern's fixed part. */
function readPaths(toolName, input, cwd) {
  const i = input && typeof input === 'object' ? input : {};
  if (toolName === 'Glob') {
    const base = typeof i.path === 'string' && i.path ? path.resolve(cwd, i.path) : cwd;
    return typeof i.pattern === 'string' && i.pattern ? [base, globBase(i.pattern, base)] : [base];
  }
  const p = i.file_path || i.path || cwd;
  return [typeof p === 'string' ? path.resolve(cwd, p) : ''];
}

const toPosix = (p) => p.split(path.sep).join('/');
const ok = { ok: true };
const no = (why) => ({ ok: false, why });

/**
 * The rules every crew shares, whatever its stage: writes inside presentation/ and off the global deny list, never
 * through a link; reads inside presentation/ or the method, never under refs/ or readDeny (patterns relative to
 * presentation/, or absolute paths, each denying itself and everything below it).
 */
function guard({ presDir, engineRoot = null, readDeny = [] }) {
  if (typeof presDir !== 'string' || !path.isAbsolute(presDir)) throw new Error('writepolicy: presDir must be an absolute path.');
  const pres = path.resolve(presDir);
  const realPres = () => realOf(pres);
  const roots = () => [realPres(), engineRoot ? realOf(engineRoot) : null].filter(Boolean);
  const denyRel = [...READ_DENY, ...readDeny.filter((d) => typeof d === 'string' && d && !path.isAbsolute(d))];
  const denyAbs = readDeny.filter((d) => typeof d === 'string' && path.isAbsolute(d)).map((d) => realOf(d)).filter(Boolean);

  /** Where a write lands: { real, rel, lex } (rel and lex relative to presentation/), or a refusal. */
  function target(p) {
    if (typeof p !== 'string' || !p.trim() || p.includes('\0')) return no('Name the file to write, as a path inside the episode\'s presentation folder.');
    const abs = path.resolve(pres, p);
    const st = lstat(abs);
    if (st && st.isSymbolicLink()) return no('That path is a link. Write a plain file instead.');
    if (st && !st.isFile()) return no('That path isn\'t a file.');
    if (st && st.nlink > 1) return no('That file has a second name somewhere else. Write a new file instead.');
    const real = realOf(abs);
    if (!real) return no('That path goes through a link that leads nowhere.');
    const rel = relIn(real, realPres());
    if (rel == null || rel === '') return no('Write only inside the episode\'s presentation folder.');
    return { ok: true, real, rel, lex: relIn(abs, pres) };
  }

  function write(p) {
    const t = target(p);
    if (!t.ok) return t;
    if (matches(t.rel, GLOBAL_DENY) || (t.lex && matches(t.lex, GLOBAL_DENY))) {
      return no(`${t.rel} is FLPT's own (the pipeline, the player, scripts and settings, the app's records, the score, references): no crew writes it.`);
    }
    return t;
  }

  function read(p) {
    if (typeof p !== 'string' || !p || p.includes('\0')) return no('Read only inside the episode folder or the bundled method.');
    const real = realOf(path.resolve(pres, p));
    if (!real || !roots().some((r) => relIn(real, r) != null)) return no('Read only inside the episode folder or the bundled method.');
    // a closed folder itself is closed too (a search there reads everything below it)
    const closed = (r) => r != null && r !== '' && (matches(r, denyRel) || matches(`${r}/-`, denyRel));
    if (closed(relIn(real, realPres())) || closed(relIn(path.resolve(pres, p), pres)) || denyAbs.some((d) => relIn(real, d) != null)) {
      return no('That folder is closed to the crew.');
    }
    return ok;
  }

  return { write, read, target, presDir: pres };
}

/**
 * One stage's policy: { stage, write(path), read(path) }, each answering { ok, why }. opts: { presDir, engineRoot,
 * folder (animate, scene: the crew's own folder in hyperframes/), readDeny }.
 */
function policyFor(stage, opts = {}) {
  const def = STAGES[stage];
  if (!def) throw new Error(`writepolicy: no stage "${stage}".`);
  const g = guard(opts);
  let folderRel = null;
  if (def.folder) {
    const f = typeof opts.folder === 'string' && opts.folder ? realOf(path.resolve(g.presDir, opts.folder)) : null;
    folderRel = f ? relIn(f, realOf(g.presDir)) : null;
    if (!folderRel || !/^hyperframes\/[^/]+(\/[^/]+)*$/i.test(folderRel)) throw new Error(`writepolicy: the ${stage} crew's folder must be inside hyperframes/.`);
  }
  const allowed = def.folder ? `${folderRel}/` : def.write.length ? def.write.join(', ') : 'nothing (its tool saves its work)';

  function write(p) {
    const t = g.write(p);
    if (!t.ok) return t;
    if (def.folder) {
      const inner = t.rel.toLowerCase().startsWith(`${folderRel.toLowerCase()}/`) ? t.rel.slice(folderRel.length + 1) : null;
      if (inner == null) return no(`Write only inside your folder, ${folderRel}/.`);
      if (matches(inner, def.deny || [])) return no(`${t.rel} is the app's or the method's, not yours.`);
      return matches(inner, def.write) ? ok : no(`In ${folderRel}/ this crew writes only ${def.write.join(', ')}.`);
    }
    return matches(t.rel, def.write) ? ok : no(`This stage writes only ${allowed}.`);
  }

  return { stage, write, read: g.read, folder: folderRel, allowed };
}

/** The deny lists as the CLI's own permission rules, for a session's disallowedTools. */
function cliRules({ readDeny = [] } = {}) {
  const reads = [];
  for (const d of readDeny) {
    if (typeof d !== 'string' || !d) continue;
    if (!path.isAbsolute(d)) { reads.push(d); continue; }
    for (const a of new Set([path.resolve(d), realOf(d)].filter(Boolean))) reads.push(`/${toPosix(a)}`, `/${toPosix(a)}/**`);
  }
  return [...GLOBAL_DENY.map((p) => `Edit(${p})`), ...[...READ_DENY, ...reads].map((p) => `Read(${p})`)];
}

module.exports = { STAGES, GLOBAL_DENY, READ_DENY, policyFor, guard, cliRules, realOf, relIn, within, readPaths, globBase, globRe, matches };
