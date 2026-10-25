#!/usr/bin/env node
// lint.mjs · flpt-live's static tripwire for crew-written scene.js and style kits (PLAN §2.3's rules table).
//
//   node lint.mjs <scene.js | scene-dir | kit.js> [--kind scene|kit] [--json]
//   import { lint, lintFile, lintFolder, textReport } from './lint.mjs'
//
// A small JavaScript tokenizer (comments, strings, template literals with ${} nesting, regex literals) so a banned
// name inside a comment doesn't count and one inside a string, template or computed member does. No dependency.
// Each problem: { rule, level: 'error' | 'warning', message, line }. Rules:
//   time · random · network · url · navigation · obfuscation · html · storage · clock · css-animation · async · api ·
//   scene-call · kit-global · size · syntax · raw-text (warning)
// The lint is a tripwire, not the boundary: guard.js fails the same mistakes at run time, and the OS sandbox / CSP
// hold the line. textReport() flags on-screen strings that look like URLs, handles, emails or phone numbers.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { isMain, parseArgs } from './lib.mjs';

const KEYWORDS_BEFORE_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

/** Tokens: { t: 'id'|'str'|'tpl'|'re'|'num'|'p', v, line }. Throws { syntax } on an unterminated string or comment. */
export function tokenize(src) {
  const toks = [];
  const n = src.length;
  let i = 0, line = 1;
  const stack = [];
  let last = null;
  const push = (t, v) => { const tok = { t, v, line }; toks.push(tok); last = tok; };
  const fail = (m) => { const e = new Error(m); e.syntax = true; e.line = line; throw e; };
  const regexOk = () => !last || (last.t === 'p' && !/^[)\]}]$/.test(last.v)) || (last.t === 'id' && KEYWORDS_BEFORE_REGEX.has(last.v));
  function readTemplate() {
    let s = '';
    while (i < n) {
      const c = src[i];
      if (c === '\\') { s += src.slice(i, i + 2); i += 2; continue; }
      if (c === '`') { i++; push('tpl', s); return; }
      if (c === '$' && src[i + 1] === '{') { i += 2; push('tpl', s); stack.push('tpl'); push('p', '${'); return; }
      if (c === '\n') line++;
      s += c; i++;
    }
    fail('unterminated template literal');
  }
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      if (e < 0) fail('unterminated comment');
      for (let k = i; k < e; k++) if (src[k] === '\n') line++;
      i = e + 2; continue;
    }
    if (c === '"' || c === "'") {
      let s = ''; i++;
      while (i < n && src[i] !== c) {
        if (src[i] === '\n') fail('unterminated string');
        if (src[i] === '\\') { s += src.slice(i, i + 2); i += 2; continue; }
        s += src[i++];
      }
      if (i >= n) fail('unterminated string');
      i++; push('str', s); continue;
    }
    if (c === '`') { i++; readTemplate(); continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let s = '';
      while (i < n && /[0-9a-zA-Z_.]/.test(src[i])) s += src[i++];
      push('num', s); continue;
    }
    if (/[A-Za-z_$\\]/.test(c) || c.charCodeAt(0) > 127) {
      let s = '';
      while (i < n && (/[A-Za-z0-9_$\\]/.test(src[i]) || src.charCodeAt(i) > 127)) s += src[i++];
      push('id', s); continue;
    }
    if (c === '/' && regexOk()) {
      let s = '', cls = false; i++;
      while (i < n) {
        const d = src[i];
        if (d === '\n') fail('unterminated regex');
        if (d === '\\') { s += src.slice(i, i + 2); i += 2; continue; }
        if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break;
        s += d; i++;
      }
      if (i >= n) fail('unterminated regex');
      i++;
      while (i < n && /[a-z]/i.test(src[i])) i++;
      push('re', s); continue;
    }
    if (c === '{') { stack.push('{'); push('p', '{'); i++; continue; }
    if (c === '}') {
      const top = stack.pop();
      i++;
      if (top === 'tpl') { push('p', '}'); readTemplate(); } else push('p', '}');
      continue;
    }
    if (c === '?' && src[i + 1] === '.' && !/[0-9]/.test(src[i + 2] || '')) { push('p', '?.'); i += 2; continue; }
    if (c === '=' && src[i + 1] === '>') { push('p', '=>'); i += 2; continue; }
    push('p', c); i++;
  }
  return toks;
}

// names banned wherever they appear (also as a property: x.fetch, x['fetch'])
const ANY = {
  time: ['Date', 'performance', 'requestAnimationFrame', 'setTimeout', 'setInterval', 'requestIdleCallback', 'queueMicrotask'],
  random: ['getRandomValues', 'randomUUID', 'crypto'],
  network: ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'EventSource', 'RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel',
    'WebTransport', 'sendBeacon', 'importScripts', 'Worker', 'SharedWorker', 'serviceWorker'],
  obfuscation: ['eval', 'Function', 'atob', 'btoa', 'fromCharCode', 'fromCodePoint', 'unescape', 'constructor', '__proto__', 'prototype',
    'getPrototypeOf', 'setPrototypeOf', 'defineProperty', 'defineProperties', '__defineGetter__', '__defineSetter__', '__lookupGetter__', 'Reflect',
    'Proxy', 'WebAssembly', 'globalThis', 'window', 'document', 'navigator', 'postMessage', 'ownerDocument', 'defaultView', 'getRootNode',
    '__flptGuard', '__SLIDE__', '__FLPT_BEATS', '__captureScenes', 'stackTraceLimit', 'prepareStackTrace', 'captureStackTrace'],
  html: ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'createContextualFragment', 'srcdoc', 'DOMParser', 'createElement', 'createElementNS',
    'setHTMLUnsafe', 'parseHTMLUnsafe', 'adoptedStyleSheets'],
  navigation: ['dispatchEvent'],
  storage: ['localStorage', 'sessionStorage', 'indexedDB', 'caches'],
  clock: ['MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'PerformanceObserver', 'MessageChannel', 'BroadcastChannel', 'AudioContext',
    'OfflineAudioContext', 'webkitAudioContext', 'Notification'],
};
// names banned only as a bare identifier (x.top, x.parent and x.location are ordinary properties)
const BARE = {
  navigation: ['location', 'history', 'top', 'parent', 'frames', 'opener', 'self', 'navigation', 'cookie', 'renderFrame'],
  clock: ['Audio'],
  network: ['import'],
  obfuscation: ['with'],
};
const RULE_OF = new Map();
for (const [rule, names] of Object.entries(ANY)) for (const nm of names) RULE_OF.set(nm, { rule, any: true });
for (const [rule, names] of Object.entries(BARE)) for (const nm of names) if (!RULE_OF.has(nm)) RULE_OF.set(nm, { rule, any: false });

const MESSAGES = {
  time: 'draw from t (ctx.t, ctx.cue, ctx.ev), not a clock or a timer',
  random: 'use ctx.rng(...keys)',
  network: 'no network, workers or imports in a scene',
  url: 'a URL in a string',
  navigation: 'no navigation',
  obfuscation: 'no globals or code-from-strings',
  html: 'no HTML strings or raw elements (ctx.el makes DOM-layer nodes)',
  storage: 'no storage',
  clock: 'no observers, channels or sound in a scene',
  'css-animation': 'no CSS animation or transitions (draw it from t)',
  async: 'a scene draws synchronously from t (an await resumes outside the scene\'s time)',
  api: 'the page API is fixed (a kit registers with FLPT.style or FLPT.kit.<name>)',
};

const URLISH = [
  [/\b[a-z][a-z0-9+.-]{1,20}:\/\//i, 'url'], [/(^|[^:\w/])\/\/[a-z0-9-]+(\.[a-z0-9-]+)+/i, 'url'], [/\bwww\.[a-z0-9-]+\./i, 'url'],
  [/\b(javascript|vbscript)\s*:/i, 'url'], [/\burl\s*\(|\bimage-set\s*\(|@import\b/i, 'url'], [/\bhttp-equiv\b/i, 'navigation'], [/\b(dns-prefetch|prefetch|preconnect|prerender)\b/i, 'navigation'],
  [/@keyframes\b/i, 'css-animation'], [/\btransition\s*:/i, 'css-animation'], [/\banimation(-[a-z]+)?\s*:/i, 'css-animation'],
  [/<(script|iframe|meta|link|form|base|object|embed|frame|img|svg)\b/i, 'html'], [/<a\s+[a-z-]+\s*=|<a>/i, 'html'],
  [/\bon(error|load|click|dblclick|mouse\w*|key\w*|focus|blur|submit|change|input|message|pointer\w*|touch\w*|animation\w*|transition\w*|begin|end|toggle|wheel|scroll|resize|unload|beforeunload|pageshow|pagehide|hashchange|popstate)\s*=/i, 'html'],
];

/** Lint source text. opts.kind: 'scene' (default) or 'kit'. */
export function lint(src, { kind = 'scene' } = {}) {
  const problems = [];
  const add = (rule, message, line, level = 'error') => { if (!problems.some((p) => p.rule === rule && p.message === message && p.line === line)) problems.push({ rule, level, message, line }); };
  const bytes = Buffer.byteLength(String(src), 'utf8');
  if (bytes > 200 * 1024) add('size', `${Math.round(bytes / 1024)} KB, over 200 KB`, 0);
  let toks;
  try { toks = tokenize(String(src)); } catch (e) { add('syntax', e.message, e.line || 0); return problems; }
  let depth = 0, sceneCalls = 0, styleCalls = 0;
  const close = (k) => { let d = 0; for (let j = k; j < toks.length; j++) { if (toks[j].t !== 'p') continue; if (toks[j].v === '[') d++; else if (toks[j].v === ']' && --d === 0) return j; } return toks.length; };
  const v = (j) => (toks[j] ? toks[j].v : undefined);
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k], prev = toks[k - 1], next = toks[k + 1];
    const member = prev && prev.t === 'p' && (prev.v === '.' || prev.v === '?.');
    if (tk.t === 'p') {
      if (tk.v === '{' || tk.v === '${') depth++;
      else if (tk.v === '}') depth = Math.max(0, depth - 1);
      else if (tk.v === '[' && prev && ((prev.t === 'id' && !KEYWORDS_BEFORE_REGEX.has(prev.v)) || prev.t === 'str' || prev.t === 'tpl' || (prev.t === 'p' && /^([)\]]|\?\.)$/.test(prev.v)))) {
        // a computed name built from strings (x['proto' + 'type'], x[`${a}b`]) spells a name the lint can't read
        const inner = toks.slice(k + 1, close(k));
        if ((inner.some((x) => x.t === 'str' || x.t === 'tpl') && inner.some((x) => x.t === 'p' && x.v === '+')) || inner.some((x, i) => x.t === 'tpl' && inner[i + 1] && inner[i + 1].v === '${')) add('obfuscation', 'a computed name built from strings: write the name', tk.line);
      }
      continue;
    }
    if (tk.t === 'id') {
      if (tk.v.includes('\\')) { add('obfuscation', `an escaped identifier (${tk.v.slice(0, 20)})`, tk.line); continue; }
      const r = RULE_OF.get(tk.v);
      const objectKey = next && next.v === ':' && prev && (prev.v === '{' || prev.v === ',');
      if (r && (r.any || (!member && !objectKey))) add(r.rule, `${tk.v}: ${MESSAGES[r.rule]}`, tk.line);
      if (tk.v === 'random' && member && toks[k - 2] && toks[k - 2].v === 'Math') add('random', 'Math.random: use ctx.rng(...keys)', tk.line);
      if ((tk.v === 'async' || tk.v === 'await') && !member && !objectKey) add('async', `${tk.v}: ${MESSAGES.async}`, tk.line);
      if (tk.v === 'FLPT' && !member) {
        // FLPT.<x> = …, FLPT.<x> += …, FLPT.<x>++, delete FLPT.<x>, ++FLPT.<x>: only FLPT.kit.<name> = … is a kit's to write
        const path = [];
        let j = k + 1;
        for (;;) {
          if ((v(j) === '.' || v(j) === '?.') && toks[j + 1] && toks[j + 1].t === 'id') { path.push(toks[j + 1].v); j += 2; } else if (v(j) === '[') { path.push('[]'); j = close(j) + 1; } else break;
        }
        const op = [v(j), v(j + 1), v(j + 2)];
        const assigns = (op[0] === '=' && op[1] !== '=') || ('+-*/%&|^'.includes(op[0] || 'x') && op[1] === '=' && op[2] !== '=') || (op[0] === '*' && op[1] === '*' && op[2] === '=')
          || (['|', '&', '?'].includes(op[0]) && op[1] === op[0] && op[2] === '=') || ((op[0] === '+' || op[0] === '-') && op[1] === op[0])
          || (prev && (prev.v === 'delete' || ((prev.v === '+' || prev.v === '-') && toks[k - 2] && toks[k - 2].v === prev.v)));
        if (path.length && assigns && !(path.length === 2 && path[0] === 'kit' && path[1] !== '[]')) add('api', `FLPT.${path.join('.')}: ${MESSAGES.api}`, tk.line);
      }
      if (tk.v === 'open' && next && next.v === '(') add('navigation', 'open(): no navigation', tk.line);
      if (member && next && next.v === '(' && ['click', 'submit', 'requestSubmit', 'animate'].includes(tk.v)) add(tk.v === 'animate' ? 'clock' : 'navigation', `.${tk.v}(): not in a scene`, tk.line);
      if (member && ['transition', 'animation', 'animationName', 'transitionProperty'].includes(tk.v) && toks[k - 2] && toks[k - 2].v === 'style') add('css-animation', `style.${tk.v}: ${MESSAGES['css-animation']}`, tk.line);
      if (member && (tk.v === 'fillText' || tk.v === 'strokeText')) {
        const owner = toks[k - 2] && toks[k - 2].v;
        if (owner !== 'ctx' && owner !== 'env') add('raw-text', `raw ${tk.v}: ctx.text (or the kit's type) registers the box the text checks need`, tk.line, 'warning');
        else if (kind === 'scene' && owner === 'ctx') add('raw-text', `ctx.${tk.v}: the text report sees it, the overlap and bubble checks only as loose pieces; ctx.text registers one box`, tk.line, 'warning');
      }
      if (tk.v === 'FLPT' && next && next.v === '.' && toks[k + 2] && toks[k + 3] && toks[k + 3].v === '(') {
        if (toks[k + 2].v === 'scene') sceneCalls++;
        if (toks[k + 2].v === 'style') styleCalls++;
      }
      const statementStart = !prev || (prev.t === 'p' && (prev.v === ';' || prev.v === '}'));
      if (kind === 'kit' && depth === 0 && !member && statementStart && ['var', 'let', 'const', 'function', 'class'].includes(tk.v)) add('kit-global', `a top-level ${tk.v}: a kit adds nothing to the page but FLPT.style / FLPT.kit`, tk.line);
      continue;
    }
    if (tk.t === 'str' || tk.t === 'tpl' || tk.t === 're') {
      const v = tk.v;
      for (const [re, rule] of URLISH) if (re.test(v)) add(rule, `${MESSAGES[rule]} ("${v.slice(0, 40)}")`, tk.line);
      const r = RULE_OF.get(v.trim());
      if (r && prev && prev.v === '[') add(r.rule, `['${v.trim()}']: ${MESSAGES[r.rule]}`, tk.line);
    }
  }
  if (kind === 'scene' && sceneCalls !== 1) add('scene-call', `FLPT.scene is called ${sceneCalls} times (exactly once)`, 0);
  if (kind === 'kit' && !styleCalls && !/\bFLPT\s*\.\s*kit\s*\./.test(src)) add('kit-global', 'a kit registers itself with FLPT.style(id, …) or FLPT.kit.<name>', 0);
  return problems;
}

export function lintFile(file, opts = {}) {
  const kind = opts.kind || (basename(file) === 'kit.js' ? 'kit' : 'scene');
  return lint(readFileSync(file, 'utf8'), { kind });
}

const dirBytes = (d) => (existsSync(d) ? readdirSync(d).reduce((n, f) => { const p = join(d, f); const s = statSync(p); return n + (s.isDirectory() ? dirBytes(p) : s.size); }, 0) : 0);
/** A scene folder: scene.js (+ kit-ext.js) and the size limits (folder ≤ 60 MB, each picture ≤ 50 MB). */
export function lintFolder(dir) {
  const problems = lintFile(join(dir, 'scene.js'));
  if (existsSync(join(dir, 'kit-ext.js'))) for (const p of lint(readFileSync(join(dir, 'kit-ext.js'), 'utf8'), { kind: 'kit' })) problems.push({ ...p, message: `kit-ext.js: ${p.message}` });
  const total = dirBytes(dir);
  if (total > 60 * 1024 * 1024) problems.push({ rule: 'size', level: 'error', message: `the scene folder is ${Math.round(total / 1048576)} MB, over 60 MB`, line: 0 });
  const pics = join(dir, 'assets', 'pictures');
  if (existsSync(pics)) for (const f of readdirSync(pics)) { const s = statSync(join(pics, f)).size; if (s > 50 * 1024 * 1024) problems.push({ rule: 'size', level: 'error', message: `${f} is over 50 MB`, line: 0 }); }
  return problems;
}

/** On-screen strings that look like a URL, a handle, an email or a phone number (the text report's flags). */
export function textReport(strings) {
  const out = [];
  for (const s of strings || []) {
    const str = String(s);
    const flags = [];
    const email = /[\w.+-]+@[\w-]+\.[\w.]+/.test(str);
    const bare = str.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, ' ');
    if (/\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\b[a-z0-9-]+\.(com|org|net|io|ai|dev|app|co|uk|de|fr|edu|gov)\b/i.test(bare)) flags.push('url');
    if (email) flags.push('email');
    else if (/(^|\s)@[A-Za-z0-9_]{2,}/.test(str)) flags.push('handle');
    if (/(\+?\d[\d\s().-]{7,}\d)/.test(str) && (str.match(/\d/g) || []).length >= 9) flags.push('phone');
    if (flags.length) out.push({ text: str.slice(0, 120), flags });
  }
  return out;
}

if (isMain(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2), ['json']);
  const target = a._[0];
  if (!target || !existsSync(target)) { console.error('usage: lint.mjs <scene.js | scene-dir | kit.js> [--kind scene|kit] [--json]'); process.exit(64); }
  const problems = statSync(target).isDirectory() ? lintFolder(target) : lintFile(target, { kind: a.kind });
  if (a.json) console.log(JSON.stringify(problems, null, 2));
  else console.log(problems.length ? problems.map((p) => `${p.level === 'error' ? '✗' : '!'} ${p.rule}${p.line ? ` (line ${p.line})` : ''}: ${p.message}`).join('\n') : 'lint: pass');
  process.exit(problems.some((p) => p.level === 'error') ? 1 : 0);
}
