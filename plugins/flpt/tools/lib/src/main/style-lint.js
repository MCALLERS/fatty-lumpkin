'use strict';
// style-lint.js · the checks a style folder passes before FLPT keeps, exports, imports or shares it (PLAN §2.10, §2.14,
// §2.16 items 4 and 8). The same code runs in the app, the plugin's copy and (later) on the server.
//
//   validate(style)                 style.json's shape (flpt.style/1): [{ rule, level, file, message }]
//   lintStyle(dir, opts)            Promise<{ ok, problems }> for a style folder; opts:
//       scope       'shipped' | 'mine' | 'shared' | 'episode' (what the folder is; the folder-name and long-text rules
//                   follow it)
//       engineRoot  where engine/runtime/flpt-live is (found from the app, the packaged app or the plugin otherwise)
//       trusted     { 'kit.js': source, … }: a vetted parent's files (the shipped style a Mine one was forked from);
//                   a long comment or string found verbatim in one of them isn't the author's
//       folderName  false to skip the folder-name rule (a package being imported sits in a scratch folder)
//       ported      true when the style descends from a shipped port (the repository follows provenance.parent), so
//                   it must carry the full MIT notice even if its credits were edited away
//       deep        true adds the determinism check: two fresh pages, the starter's frames in order and shuffled,
//                   the same hashes (needs the pinned toolchain); `determinism(dir, style)` replaces it (tests)
//   scan(src)                       a JavaScript token stream with comments and positions (no dependency)
//   longText(src, opts)             comments and strings over 200 characters (adjacent // lines and "a" + "b" runs
//                                   count as one), minus what a trusted source holds verbatim; a file V8 won't parse
//                                   fails it (the scan and V8 must agree on what is text)
//   apiOf(src, id)                  the kit's exported functions and their parameter names, read from the code (no
//                                   comment or string ever enters it; names of 32 characters at most): [{ fn, kind,
//                                   params }]
//
// Rules: schema · folder · size (kit.js ≤ 200 KB, the package ≤ 8 MB, STYLE.md ≤ 8,000 characters) · files (the
// declared files exist; only code, fonts, pictures under assets/ and the four media files) · fonts (declared, OFL-1.1
// or Apache-2.0, with their licence text beside them) · images (only under an assets/ folder, each named on a line of
// that folder's PROVENANCE.md; SVGs with no script and no outside reference) · refs (no refs/ anywhere) · reference
// (no Library reference: its mark, a style card or a reference record) · symlink · code (flpt-live's static lint:
// network, eval, navigation, time, randomness, globals) · kit-id · long-text (non-shipped code) · hashes · licence (a
// port carries the full MIT notice; Mine and Shared are MIT) · determinism (deep).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { pathToFileURL } = require('url');

const SCHEMA = 'flpt.style/1';
const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const SEMVER_RE = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,5})$/;
const RUNTIME_RE = /^flpt-live@\^?(0|[1-9]\d{0,3})(\.(0|[1-9]\d{0,4})){0,2}$/;
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const SHA_RE = /^sha256:[0-9a-f]{64}$/;
const SCOPES = ['shipped', 'mine', 'shared', 'episode'];
const SHARE = ['none', 'exported', 'submitted', 'staged', 'published', 'rejected'];
const SFX = ['off', 'soft', 'on'];
const LICENCES = { 'OFL-1.1': /SIL OPEN FONT LICEN[CS]E/i, 'Apache-2.0': /Apache License/i };
// apiEntries and apiName: what the API summary a crew reads may hold (author-chosen names, so kept short)
const LIMITS = Object.freeze({ kitBytes: 200 * 1024, packageBytes: 8 * 1024 * 1024, specChars: 8000, longText: 200, nameChars: 40, lineChars: 80, apiEntries: 120, apiName: 32 });
const FONT_EXT = new Set(['.ttf', '.otf', '.woff', '.woff2']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);
const TEXT_EXT = new Set(['.js', '.json', '.md', '.txt']);
// What FLPT renders for a style (loop.mjs) and what an import ignores: only these, only at the top of the folder.
const MEDIA_FILES = ['poster.jpg', 'poster-tall.jpg', 'loop.mp4', 'loop-tall.mp4'];
const IGNORED = new Set(['.DS_Store']);
const LICENCE_NAME = /^(LICEN[CS]E|COPYING|NOTICE)([-_.][A-Za-z0-9-]+)?(\.(md|txt))?$/i;
const REFERENCE_MARK = '.flpt-reference';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;

/** A relative path inside the style folder: posix, no "..", no leading "/", nothing odd. */
function safeRel(p) {
  if (typeof p !== 'string' || !p || p.length > 200 || p.startsWith('/') || p.includes('\\') || p.includes(':')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(p)) return false;
  return p.replace(/\/$/, '').split('/').every((s) => s && s !== '.' && s !== '..');
}

// ── style.json ──────────────────────────────────────────────────────────────────────────────────────────────

/** style.json's shape. Unknown fields are allowed (readers ignore them); known ones must be right. */
function validate(style) {
  const out = [];
  const bad = (field, message) => out.push({ rule: 'schema', level: 'error', file: 'style.json', message: `${field}: ${message}` });
  if (!isObj(style)) { bad('style.json', 'not an object'); return out; }
  if (style.schema !== SCHEMA) bad('schema', `must be "${SCHEMA}"`);
  if (!ID_RE.test(String(style.id || ''))) bad('id', 'lower-case letters, digits and hyphens, 48 at most');
  if (!SEMVER_RE.test(String(style.version || ''))) bad('version', 'a version like 1.0.0');
  if (!str(style.name, LIMITS.nameChars)) bad('name', `1–${LIMITS.nameChars} characters`);
  if (style.line != null && !(typeof style.line === 'string' && style.line.length <= LIMITS.lineChars)) bad('line', `${LIMITS.lineChars} characters at most`);
  if (!RUNTIME_RE.test(String(style.runtime || ''))) bad('runtime', 'like "flpt-live@^1"');
  if (style.minApp != null && !SEMVER_RE.test(String(style.minApp))) bad('minApp', 'a version like 2.0.0');
  if (style.frame != null && !(isObj(style.frame) && style.frame.w === 1920 && style.frame.h === 1080 && style.frame.fps === 30)) bad('frame', 'must be 1920×1080 at 30 fps');
  for (const k of ['duetSafe', 'ones']) if (style[k] != null && typeof style[k] !== 'boolean') bad(k, 'true or false');
  if (style.tags != null) {
    if (!isObj(style.tags)) bad('tags', 'an object');
    else for (const [k, v] of Object.entries(style.tags)) {
      const words = Array.isArray(v) ? v : [v];
      if (words.length > 8 || !words.every((w) => str(w, 24))) bad(`tags.${k}`, 'up to 8 short words');
    }
  }
  if (style.tokens != null) {
    const t = style.tokens;
    if (!isObj(t)) bad('tokens', 'an object');
    else {
      for (const k of ['paper', 'accent']) if (t[k] != null && !HEX_RE.test(String(t[k]))) bad(`tokens.${k}`, 'a colour like #F1EBE2');
      if (t.inks != null && !(Array.isArray(t.inks) && t.inks.length <= 12 && t.inks.every((c) => HEX_RE.test(String(c))))) bad('tokens.inks', 'up to 12 colours like #368AAB');
      if (t.type != null && !(isObj(t.type) && Object.values(t.type).every((f) => str(f, 48)))) bad('tokens.type', 'font family names');
    }
  }
  if (style.fonts != null) {
    if (!Array.isArray(style.fonts) || style.fonts.length > 16) bad('fonts', 'a list of up to 16 fonts');
    else style.fonts.forEach((f, i) => {
      if (!isObj(f) || !str(f.family, 48)) bad(`fonts[${i}].family`, 'a family name');
      if (!isObj(f) || !safeRel(f.file) || !FONT_EXT.has(path.extname(String(f.file)).toLowerCase())) bad(`fonts[${i}].file`, 'a .ttf, .otf, .woff or .woff2 under fonts/');
      if (!isObj(f) || !(f.licence in LICENCES)) bad(`fonts[${i}].licence`, `one of ${Object.keys(LICENCES).join(', ')}`);
      if (isObj(f) && f.licenceFile != null && !safeRel(f.licenceFile)) bad(`fonts[${i}].licenceFile`, 'a path in the style folder');
    });
  }
  if (style.motion != null && !isObj(style.motion)) bad('motion', 'an object');
  if (isObj(style.motion) && style.motion.vocab != null && !(Array.isArray(style.motion.vocab) && style.motion.vocab.length <= 16 && style.motion.vocab.every((w) => str(w, 24)))) bad('motion.vocab', 'up to 16 short words');
  for (const k of ['pace', 'easing']) if (isObj(style.motion) && style.motion[k] != null && !str(style.motion[k], 32)) bad(`motion.${k}`, 'a short word');
  if (style.sound != null) {
    if (!isObj(style.sound)) bad('sound', 'an object');
    else {
      if (style.sound.score != null && !ID_RE.test(String(style.sound.score))) bad('sound.score', 'a score preset id');
      if (style.sound.sfx != null && !SFX.includes(style.sound.sfx)) bad('sound.sfx', SFX.join(', '));
    }
  }
  if (style.cost != null && !(isObj(style.cost) && Number.isFinite(style.cost.msPerFrame) && style.cost.msPerFrame >= 0 && style.cost.msPerFrame <= 5000)) bad('cost.msPerFrame', '0–5000');
  if (!isObj(style.files)) bad('files', 'an object naming kit, spec and starter');
  else {
    for (const k of ['kit', 'spec', 'starter']) if (!safeRel(style.files[k])) bad(`files.${k}`, 'a path in the style folder');
    for (const k of ['demo', 'kitExt']) if (style.files[k] != null && !safeRel(style.files[k])) bad(`files.${k}`, 'a path in the style folder');
  }
  if (style.media != null) {
    if (!isObj(style.media)) bad('media', 'an object');
    else for (const [k, v] of Object.entries(style.media)) if (v != null && !MEDIA_FILES.includes(v)) bad(`media.${k}`, `one of ${MEDIA_FILES.join(', ')}`);
  }
  if (style.hashes != null) {
    if (!isObj(style.hashes)) bad('hashes', 'an object');
    else for (const [k, v] of Object.entries(style.hashes)) if (!safeRel(k) || !SHA_RE.test(String(v))) bad(`hashes.${String(k).slice(0, 40)}`, '"sha256:" and 64 hex digits');
  }
  if (style.provenance != null) {
    const p = style.provenance;
    if (!isObj(p)) bad('provenance', 'an object');
    else {
      if (p.kind != null && !SCOPES.includes(p.kind)) bad('provenance.kind', SCOPES.join(', '));
      if (p.parent != null && !(typeof p.parent === 'string' && /^[a-z0-9][a-z0-9-]{0,47}@\d+\.\d+\.\d+$/.test(p.parent))) bad('provenance.parent', 'like "riso@1.0.0"');
      if (p.refsUsed != null && typeof p.refsUsed !== 'boolean') bad('provenance.refsUsed', 'true or false');
      for (const k of ['from', 'fromEpisode', 'fromShot']) if (p[k] != null && !str(p[k], 160)) bad(`provenance.${k}`, 'a short string or null');
      if (p.rendered != null && !isObj(p.rendered)) bad('provenance.rendered', 'an object or null');
    }
  }
  if (style.credit != null && !(typeof style.credit === 'string' && style.credit.length <= 160)) bad('credit', '160 characters at most');
  if (style.licence != null && !str(style.licence, 32)) bad('licence', 'a licence id like MIT');
  if (style.licenceFile != null && !safeRel(style.licenceFile)) bad('licenceFile', 'a path in the style folder');
  if (style.authors != null && !(Array.isArray(style.authors) && style.authors.length <= 8 && style.authors.every((a) => str(a, 80)))) bad('authors', 'up to 8 names');
  const apiOk = (a) => isObj(a) && str(a.fn, 80) && (a.kind == null || a.kind === 'function' || a.kind === 'value')
    && (a.params == null || (Array.isArray(a.params) && a.params.length <= 12 && a.params.every((x) => str(x, 64)))) && (a.doc == null || (typeof a.doc === 'string' && a.doc.length <= 80));
  if (style.api != null && !(Array.isArray(style.api) && style.api.length <= LIMITS.apiEntries && style.api.every(apiOk))) bad('api', `a list of up to ${LIMITS.apiEntries} { fn, kind, params, doc } (docs of 80 characters at most)`);
  if (style.share != null && !(isObj(style.share) && (style.share.status == null || SHARE.includes(style.share.status)) && (style.share.at == null || typeof style.share.at === 'string'))) bad('share.status', SHARE.join(', '));
  return out;
}

// ── a JavaScript scanner with comments and positions ──────────────────────────────────────────────────────────

// Words after which a "/" starts a regex (when they act as keywords: never as a property name; "of" only in a for
// head, "yield" only in a generator, "await" only in an async function).
const BEFORE_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await', 'extends']);
const PAREN_KIND = { if: 'ctl', while: 'ctl', with: 'ctl', for: 'for', switch: 'switch', catch: 'catch' };
const LINE_END = /[\n\r\u2028\u2029]/;

/**
 * Tokens { t: 'id'|'str'|'tpl'|'re'|'num'|'p'|'comment', v, line, tid? (a template's chunks share it), block? }; ids,
 * strings, template chunks and comments also carry their source span { start, end }.
 *
 * A "/" is a regex or a division by what came before, as the language decides it: after the ")" of if/while/for/with,
 * a block's "}", a prefix ++/--, an operator or a keyword it is a regex; after an operand (a name, a literal, a call's
 * ")", "]", an object literal's or a function expression's "}", a postfix ++/--) a division. Line terminators are all
 * four of the language's, HTML-like comments ("<!--" anywhere, "-->" first on a line) and a leading "#!" are comments.
 * The scan agrees with V8 on where every string, template, regex and comment begins and ends for the code a kit is
 * (longText also has V8 parse the file, so code the scan reads differently can't pass).
 */
function scan(src) {
  const s = String(src);
  const n = s.length;
  const toks = [];
  const code = []; // the non-comment tokens
  const brk = []; // open brackets: { ch: '(' | '[' | '{' | 'tpl', … }
  const fns = []; // the function bodies we're in: { gen, async }
  let i = 0, line = 1, last = null, tid = 0, nl = true;
  let pendingFn = null; // after `function`: { expr, gen, async, depth }, taken by its "("
  let pendingClass = null; // after `class`: { expr, depth }, taken by its "{"
  let pendingCase = null; // after `case`: { depth, q }, ended by its ":"
  const fail = (m) => { const e = new Error(m); e.syntax = true; e.line = line; throw e; };
  const push = (t, v, extra) => {
    const tok = { t, v, line, ...extra };
    toks.push(tok);
    if (t !== 'comment') { tok.nlBefore = nl; nl = false; last = tok; code.push(tok); }
    return tok;
  };
  const back = (k) => code[code.length - k]; // back(1) is `last`
  const isId = (tok, v) => tok && tok.t === 'id' && !tok.prop && tok.v === v;
  // does this token end an operand (so "/" divides and ++ is postfix)?
  const operandEnd = (p) => {
    if (!p) return false;
    if (p.t === 'id') return !p.kw;
    if (p.t !== 'p') return true; // num, str, tpl, re
    if (p.v === ')') return !p.ctl;
    if (p.v === ']') return true;
    if (p.v === '}') return p.brace === 'expr';
    if (p.v === '++' || p.v === '--') return !!p.postfix;
    return false;
  };
  // is a "{", `function` or `class` right after p in an expression (not a statement)?
  const startsExpr = (p) => {
    if (!p) return false;
    if (p.t === 'id') return !!p.kw && p.v !== 'do' && p.v !== 'else';
    if (p.t !== 'p') return false;
    if ([';', '}', ')', ']', '{'].includes(p.v)) return false;
    if (p.v === ':') return !p.stmt;
    if (p.v === '++' || p.v === '--') return !p.postfix;
    return true;
  };
  // a line terminator at i (CR LF is one): its length, or 0
  const lt = (k) => (s[k] === '\r' && s[k + 1] === '\n' ? 2 : LINE_END.test(s[k] || '') ? 1 : 0);
  const lineComment = (from, skip) => {
    let e = from + skip;
    while (e < n && !LINE_END.test(s[e])) e++;
    push('comment', s.slice(from + skip, e), { block: false, start: from, end: e });
    i = e;
  };
  const tplChunk = (id, start) => {
    let v = '';
    while (i < n) {
      const c = s[i];
      if (c === '\\') { v += s.slice(i, i + 2); i += 2; continue; }
      if (c === '`') { i++; push('tpl', v, { tid: id, start, end: i }); return; }
      if (c === '$' && s[i + 1] === '{') { i += 2; push('tpl', v, { tid: id, start, end: i }); brk.push({ ch: 'tpl', id }); push('p', '${'); return; }
      const l = lt(i);
      if (l) { line++; v += s.slice(i, i + l); i += l; continue; }
      v += c; i++;
    }
    fail('unterminated template literal');
  };
  if (s.startsWith('#!')) lineComment(0, 2);
  while (i < n) {
    const c = s[i];
    const l = lt(i);
    if (l) { line++; nl = true; i += l; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && s[i + 1] === '/') { lineComment(i, 2); continue; }
    if (c === '<' && s.startsWith('<!--', i)) { lineComment(i, 4); continue; }
    if (c === '-' && nl && s.startsWith('-->', i)) { lineComment(i, 3); continue; }
    if (c === '/' && s[i + 1] === '*') {
      const e = s.indexOf('*/', i + 2);
      if (e < 0) fail('unterminated comment');
      const tok = push('comment', s.slice(i + 2, e), { block: true, start: i, end: e + 2 });
      for (let k = i; k < e;) { const m = lt(k); if (m) { line++; nl = true; k += m; } else k++; }
      tok.endLine = line;
      i = e + 2; continue;
    }
    if (c === '"' || c === "'") {
      const start = i;
      let v = ''; i++;
      while (i < n && s[i] !== c) {
        if (s[i] === '\n' || s[i] === '\r') fail('unterminated string');
        if (s[i] === '\\') { const m = lt(i + 1); if (m) line++; v += s.slice(i, i + 1 + Math.max(1, m)); i += 1 + Math.max(1, m); continue; }
        v += s[i++];
      }
      if (i >= n) fail('unterminated string');
      i++; push('str', v, { start, end: i }); continue;
    }
    if (c === '`') { i++; tplChunk(++tid, i - 1); continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] || ''))) { let v = ''; while (i < n && /[0-9a-zA-Z_.]/.test(s[i])) v += s[i++]; push('num', v); continue; }
    if (/[A-Za-z_$\\]/.test(c) || c.charCodeAt(0) > 127) {
      const start = i;
      let v = '';
      while (i < n && (/[A-Za-z0-9_$\\]/.test(s[i]) || (s.charCodeAt(i) > 127 && !LINE_END.test(s[i]) && !/\s/.test(s[i])))) v += s[i++];
      const prop = !!(last && last.t === 'p' && (last.v === '.' || last.v === '?.' || last.v === '#'));
      const top = brk[brk.length - 1];
      const fn = fns[fns.length - 1];
      let kw = !prop && BEFORE_REGEX.has(v);
      if (kw && v === 'of') kw = !!(top && top.ch === '(' && top.kind === 'for');
      if (kw && v === 'yield') kw = !!(fn && fn.gen);
      if (kw && v === 'await') kw = !!(fn && fn.async);
      const before = last;
      push('id', v, { start, end: i, prop, kw });
      if (prop) continue;
      if (v === 'function') {
        const lead = isId(before, 'async') ? back(3) : before;
        pendingFn = { expr: startsExpr(lead), gen: false, async: isId(before, 'async'), depth: brk.length };
      } else if (v === 'class') pendingClass = { expr: startsExpr(before), depth: brk.length };
      else if (v === 'case') pendingCase = { depth: brk.length, q: 0 };
      continue;
    }
    if (c === '/' && !operandEnd(last)) {
      const start = i;
      let v = '', cls = false; i++;
      while (i < n) {
        const d = s[i];
        if (LINE_END.test(d)) fail('unterminated regex');
        if (d === '\\') { if (LINE_END.test(s[i + 1] || '')) fail('unterminated regex'); v += s.slice(i, i + 2); i += 2; continue; }
        if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break;
        v += d; i++;
      }
      if (i >= n) fail('unterminated regex');
      i++;
      while (i < n && /[A-Za-z0-9_$]/.test(s[i])) i++;
      push('re', v, { start, end: i }); continue;
    }
    if (c === '(') {
      let kind = 'other', fn = null;
      if (last && last.t === 'id' && !last.prop && PAREN_KIND[last.v]) kind = PAREN_KIND[last.v];
      else if (isId(last, 'await') && isId(back(2), 'for')) kind = 'for';
      if (pendingFn && pendingFn.depth === brk.length) {
        kind = pendingFn.expr ? 'fnexpr' : 'fn';
        fn = { gen: pendingFn.gen, async: pendingFn.async };
        pendingFn = null;
      } else if (kind === 'other' && last && last.t === 'id') {
        // a method: name(…) {…}, *name(…), async name(…), async *name(…)
        const b2 = back(2), b3 = back(3);
        const gen = !!(b2 && b2.t === 'p' && b2.v === '*');
        const as = isId(b2, 'async') || (gen && isId(b3, 'async'));
        fn = { gen, async: as };
      }
      brk.push({ ch: '(', kind, fn, open: code.length });
      push('p', '('); i++; continue;
    }
    if (c === ')') {
      const top = brk[brk.length - 1] && brk[brk.length - 1].ch === '(' ? brk.pop() : null;
      push('p', ')', { ctl: !!top && ['ctl', 'for'].includes(top.kind), fnExpr: !!top && top.kind === 'fnexpr', fn: top ? top.fn : null, kind: top ? top.kind : 'other', open: top ? top.open : -1 });
      i++; continue;
    }
    if (c === '[') { brk.push({ ch: '[' }); push('p', '['); i++; continue; }
    if (c === ']') { if (brk[brk.length - 1] && brk[brk.length - 1].ch === '[') brk.pop(); push('p', ']'); i++; continue; }
    if (c === '{') {
      let kind, fn = null;
      if (pendingClass && pendingClass.depth === brk.length) { kind = pendingClass.expr ? 'expr' : 'block'; pendingClass = null; }
      else if (last && last.t === 'p' && last.v === '=>') { kind = 'block'; fn = { gen: false, async: !!last.async }; }
      else if (last && last.t === 'p' && last.v === ')' && ['fn', 'fnexpr', 'other'].includes(last.kind)) { kind = last.fnExpr ? 'expr' : 'block'; fn = last.fn || { gen: false, async: false }; }
      else kind = startsExpr(last) ? 'expr' : 'block';
      brk.push({ ch: '{', kind, fn: !!fn });
      if (fn) fns.push(fn);
      push('p', '{', { brace: kind }); i++; continue;
    }
    if (c === '}') {
      const top = brk.pop();
      i++;
      if (top && top.ch === 'tpl') { push('p', '}'); tplChunk(top.id, i - 1); continue; }
      if (top && top.fn) fns.pop();
      push('p', '}', { brace: top && top.ch === '{' ? top.kind : 'block' });
      continue;
    }
    if (c === '=' && s[i + 1] === '>') {
      // an async arrow: async x => …, async (…) => …
      const as = last && last.t === 'p' && last.v === ')' ? isId(code[last.open - 1], 'async') : last && last.t === 'id' && isId(back(2), 'async');
      push('p', '=>', { async: !!as }); i += 2; continue;
    }
    if ((c === '+' || c === '-') && s[i + 1] === c) { push('p', c + c, { postfix: operandEnd(last) && !nl }); i += 2; continue; }
    if (c === '.' && s[i + 1] === '.' && s[i + 2] === '.') { push('p', '...'); i += 3; continue; }
    if (c === '?' && s[i + 1] === '.' && !/[0-9]/.test(s[i + 2] || '')) { push('p', '?.'); i += 2; continue; }
    if (c === '?' && s[i + 1] === '?') { push('p', '??'); i += 2; continue; }
    if (c === '?') { if (pendingCase && pendingCase.depth === brk.length) pendingCase.q++; push('p', '?'); i++; continue; }
    // a header that turned out to be an object's key ({ class: 1 }, { function: f }) ends here
    if ((c === ':' || c === ',' || c === ';' || c === '=') && pendingClass && pendingClass.depth === brk.length) pendingClass = null;
    if ((c === ':' || c === ',' || c === ';' || c === '=') && pendingFn && pendingFn.depth === brk.length) pendingFn = null;
    if (c === ':') {
      // a statement's colon (case …:, default:, a label:) or an expression's (an object's key, a ternary)? Only a
      // block (or the top level) holds statements; directly inside an object literal it's always an expression's.
      const top = brk[brk.length - 1];
      const inBlock = !top || (top.ch === '{' && top.kind === 'block');
      let stmt = false;
      if (isId(last, 'case')) pendingCase = null; // { case: 1 }
      else if (pendingCase && pendingCase.depth === brk.length && inBlock) { if (pendingCase.q > 0) pendingCase.q--; else { stmt = true; pendingCase = null; } }
      else if (inBlock && isId(last, 'default')) stmt = true;
      else if (inBlock && last && last.t === 'id' && !last.prop && !last.kw) {
        const b = back(2);
        stmt = !b || (b.t === 'p' && (b.v === ';' || b.v === '}' || (b.v === '{' && b.brace === 'block') || (b.v === ')' && b.ctl) || (b.v === ':' && b.stmt))) || isId(b, 'else') || isId(b, 'do');
      }
      push('p', ':', { stmt }); i++; continue;
    }
    if (c === '*' && pendingFn && pendingFn.depth === brk.length && isId(last, 'function')) pendingFn.gen = true;
    push('p', c); i++;
  }
  return toks;
}

/** Does V8 parse this as a classic script (how the page loads kits and scenes)? null, or { message, line }. Never runs it. */
function v8Syntax(src) {
  try {
    // eslint-disable-next-line no-new
    new vm.Script(String(src), { filename: 'style-source.js' });
    return null;
  } catch (e) {
    const m = /style-source\.js:(\d+)/.exec(String(e && e.stack));
    return { message: String((e && e.message) || e).slice(0, 160), line: m ? Number(m[1]) : 0 };
  }
}

/**
 * Comments and strings over `max` characters. Adjacent // lines are one comment; strings joined by + and the chunks of
 * one template literal are one string. A run whose source text, whole, is found verbatim in a trusted source (FLPT's
 * own shipped files) is left out; its pieces one by one are not enough. A file V8 won't parse is a syntax error.
 */
function longText(src, { max = LIMITS.longText, trusted = [] } = {}) {
  const text = String(src);
  // fail closed: code V8 won't parse might hide text where the scan sees code
  const bad = v8Syntax(text);
  if (bad) return [{ rule: 'syntax', level: 'error', message: `doesn't parse: ${bad.message}`, line: bad.line }];
  let toks;
  try { toks = scan(text); } catch (e) { return [{ rule: 'syntax', level: 'error', message: e.message, line: e.line || 0 }]; }
  const vetted = (raw) => trusted.some((t) => typeof t === 'string' && t.includes(raw));
  const out = [];
  const report = (kind, pieces, first, last) => {
    const len = pieces.reduce((a, p) => a + p.length, 0);
    if (len > max && !vetted(text.slice(first.start, last.end))) out.push({ rule: 'long-text', level: 'error', message: `a ${kind} of ${len} characters (${max} at most in a kit that isn't shipped)`, line: first.line });
  };
  // comments: a run of // lines on consecutive lines counts as one
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k];
    if (tk.t !== 'comment') continue;
    if (tk.block) { report('comment', [tk.v], tk, tk); continue; }
    const pieces = [tk.v];
    let j = k, lastLine = tk.line;
    while (toks[j + 1] && toks[j + 1].t === 'comment' && !toks[j + 1].block && toks[j + 1].line === lastLine + 1) { j++; lastLine = toks[j].line; pieces.push(toks[j].v); }
    report('comment', pieces, tk, toks[j]);
    k = j;
  }
  // strings: "a" + "b" + `c${x}d` runs
  const code = toks.filter((t) => t.t !== 'comment');
  for (let k = 0; k < code.length; k++) {
    const tk = code[k];
    if (tk.t !== 'str' && tk.t !== 'tpl') continue;
    const pieces = [];
    let j = k;
    for (;;) {
      const cur = code[j];
      pieces.push(cur.v);
      if (cur.t === 'tpl') {
        // the rest of the same template literal: skip its ${ … } expressions
        let m = j + 1, more = false;
        while (m < code.length && !(code[m].t === 'tpl' && code[m].tid === cur.tid)) m++;
        if (m < code.length && code[j + 1] && code[j + 1].v === '${') { j = m; more = true; }
        if (more) continue;
      }
      if (code[j + 1] && code[j + 1].v === '+' && code[j + 2] && (code[j + 2].t === 'str' || code[j + 2].t === 'tpl')) { j += 2; continue; }
      break;
    }
    report('string', pieces, tk, code[j]);
    k = j;
  }
  return out;
}

// ── the kit's API, read from its code ──────────────────────────────────────────────────────────────────────────

const IDENT = new RegExp(`^[A-Za-z_$][A-Za-z0-9_$]{0,${LIMITS.apiName - 1}}$`); // longer names never reach the summary
function matchClose(toks, k) {
  const open = toks[k].v, close = open === '(' ? ')' : open === '[' ? ']' : '}';
  let d = 0;
  for (let j = k; j < toks.length; j++) {
    const v = toks[j].v;
    if (toks[j].t !== 'p') continue;
    if (v === open || (open === '{' && v === '${')) d++;
    else if (v === close && --d === 0) return j;
  }
  return toks.length - 1;
}
/** Parameter names between ( and ): identifiers, rest params, destructured patterns as {a,b} / [a,b], defaults dropped. */
function paramsAt(toks, open) {
  const close = matchClose(toks, open);
  const out = [];
  let k = open + 1;
  while (k < close) {
    const tk = toks[k];
    if (tk.v === '...') { k++; continue; }
    if (tk.t === 'p' && (tk.v === '{' || tk.v === '[')) {
      const end = matchClose(toks, k);
      const names = [];
      for (let m = k + 1; m < end; m++) {
        const nx = toks[m + 1];
        if (toks[m].t === 'id' && IDENT.test(toks[m].v) && nx && (nx.v === ',' || nx.v === '}' || nx.v === ']' || nx.v === '=' || nx.v === ':') && !(toks[m - 1] && toks[m - 1].v === '=')) {
          if (nx.v === ':') continue; // the key of a renaming pattern; the local name follows
          names.push(toks[m].v);
        }
      }
      const kept = [];
      for (const nm of names) { if ([...kept, nm].join(',').length > 62) break; kept.push(nm); }
      out.push(tk.v === '{' ? `{${kept.join(',')}}` : `[${kept.join(',')}]`);
      k = end + 1;
    } else if (tk.t === 'id' && IDENT.test(tk.v)) {
      out.push(tk.v);
      k++;
    } else { k++; continue; }
    // skip a default value up to the next comma at this level
    let d = 0;
    while (k < close) {
      const v = toks[k].v;
      if (toks[k].t === 'p' && (v === '(' || v === '[' || v === '{' || v === '${')) d++;
      else if (toks[k].t === 'p' && (v === ')' || v === ']' || v === '}')) d--;
      else if (d === 0 && v === ',') { k++; break; }
      k++;
    }
  }
  return out.slice(0, 12);
}
/** A function value starting at k (function …(…), (…) =>, x =>, async …): its parameter names, or null. */
function functionAt(toks, k) {
  let j = k;
  if (toks[j] && toks[j].v === 'async') j++;
  if (toks[j] && toks[j].v === 'function') { j++; if (toks[j] && toks[j].v === '*') j++; if (toks[j] && toks[j].t === 'id') j++; return toks[j] && toks[j].v === '(' ? paramsAt(toks, j) : null; }
  if (toks[j] && toks[j].v === '(') { const c = matchClose(toks, j); return toks[c + 1] && toks[c + 1].v === '=>' ? paramsAt(toks, j) : null; }
  if (toks[j] && toks[j].t === 'id' && toks[j + 1] && toks[j + 1].v === '=>') return [toks[j].v];
  return null;
}
/** Names declared at the top level of a block (between open and close): function f(…), const f = (…) => …, etc. */
function declarations(toks, open, close) {
  const decl = new Map();
  let d = 0;
  for (let k = open + 1; k < close; k++) {
    const v = toks[k].v;
    if (toks[k].t === 'p' && (v === '{' || v === '(' || v === '[' || v === '${')) { d++; continue; }
    if (toks[k].t === 'p' && (v === '}' || v === ')' || v === ']')) { d--; continue; }
    if (d !== 0 || toks[k].t !== 'id') continue;
    if (v === 'function' && toks[k + 1] && toks[k + 1].t === 'id') {
      const name = toks[k + 1].v, p = toks[k + 2] && toks[k + 2].v === '(' ? paramsAt(toks, k + 2) : [];
      if (!decl.has(name)) decl.set(name, p);
    } else if ((v === 'const' || v === 'let' || v === 'var')) {
      // const a = …, b = (x) => …: each name and whether its value is a function
      let m = k + 1;
      for (;;) {
        const nm = toks[m];
        if (!nm || nm.t !== 'id') break;
        if (toks[m + 1] && toks[m + 1].v === '=') {
          const p = functionAt(toks, m + 2);
          if (!decl.has(nm.v)) decl.set(nm.v, p);
          // skip the value to the next comma at this level
          let q = m + 2, dd = 0;
          while (q < close) {
            const w = toks[q].v;
            if (toks[q].t === 'p' && (w === '(' || w === '[' || w === '{' || w === '${')) dd++;
            else if (toks[q].t === 'p' && (w === ')' || w === ']' || w === '}')) { if (dd === 0) break; dd--; }
            else if (dd === 0 && (w === ',' || w === ';')) break;
            q++;
          }
          if (toks[q] && toks[q].v === ',') { m = q + 1; continue; }
        } else if (!decl.has(nm.v)) decl.set(nm.v, null);
        break;
      }
    }
  }
  return decl;
}
/** The members of an object literal at `open`: [{ name, params|null }] (functions have params). */
function members(toks, open, decl) {
  const close = matchClose(toks, open);
  const out = [];
  let k = open + 1;
  while (k < close) {
    const tk = toks[k];
    if (tk.v === ',') { k++; continue; }
    let name = null, params = null, next = k + 1;
    if (tk.v === '...') name = null;
    else if (tk.t === 'id' && (tk.v === 'get' || tk.v === 'set' || tk.v === 'async') && toks[k + 1] && toks[k + 1].t === 'id' && toks[k + 2] && toks[k + 2].v === '(') { name = toks[k + 1].v; params = paramsAt(toks, k + 2); }
    else if ((tk.t === 'id' || tk.t === 'str') && IDENT.test(tk.v)) {
      name = tk.v;
      const nx = toks[k + 1];
      if (nx && nx.v === '(') params = paramsAt(toks, k + 1);
      else if (nx && nx.v === ':') { params = functionAt(toks, k + 2); if (!params && toks[k + 2] && toks[k + 2].t === 'id' && toks[k + 3] && (toks[k + 3].v === ',' || toks[k + 3].v === '}') && decl.has(toks[k + 2].v)) params = decl.get(toks[k + 2].v); }
      else if (nx && (nx.v === ',' || nx.v === '}')) params = decl.has(name) ? decl.get(name) : null;
      else name = null;
    }
    if (name) out.push({ name, params });
    // on to the next member at this level
    let d = 0;
    for (next = k; next < close; next++) {
      const v = toks[next].v;
      if (toks[next].t === 'p' && (v === '(' || v === '[' || v === '{' || v === '${')) d++;
      else if (toks[next].t === 'p' && (v === ')' || v === ']' || v === '}')) d--;
      else if (d === 0 && v === ',') break;
    }
    k = next + 1;
  }
  return out;
}
/** The object a function body returns last at its own level (return { … }), as a token index, or -1. */
function returnedObject(toks, open, close) {
  let d = 0, at = -1;
  for (let k = open + 1; k < close; k++) {
    const v = toks[k].v;
    if (toks[k].t === 'p' && (v === '{' || v === '(' || v === '[' || v === '${')) { d++; continue; }
    if (toks[k].t === 'p' && (v === '}' || v === ')' || v === ']')) { d--; continue; }
    if (d === 0 && toks[k].t === 'id' && v === 'return' && toks[k + 1] && toks[k + 1].v === '{') at = k + 1;
  }
  return at;
}
/** A function's body { … } for a value starting at k (method, function, arrow with a block). */
function bodyOf(toks, k) {
  let j = k;
  if (toks[j] && toks[j].v === 'async') j++;
  if (toks[j] && toks[j].v === 'function') { j++; if (toks[j] && toks[j].t === 'id') j++; }
  if (toks[j] && toks[j].t === 'id' && toks[j + 1] && toks[j + 1].v === '=>') return toks[j + 2] && toks[j + 2].v === '{' ? j + 2 : -1;
  if (!toks[j] || toks[j].v !== '(') return -1;
  const c = matchClose(toks, j);
  let b = c + 1;
  if (toks[b] && toks[b].v === '=>') b++;
  return toks[b] && toks[b].v === '{' ? b : -1;
}

/**
 * What a kit file exports, from its code only: FLPT.style('<id>', { make(env) { …; return { a, b(x) {…} } } }) gives
 * ctx.kit.a, ctx.kit.b; FLPT.kit.<name> = { … } or = (() => { …; return { … } })() gives ctx.kit.<name>.<member>.
 * [{ fn, kind: 'function'|'value', params }]. No comment or string text can reach it.
 */
function apiOf(src) {
  let toks;
  try { toks = scan(src).filter((t) => t.t !== 'comment'); } catch { return []; }
  const out = [];
  const add = (prefix, list) => { for (const m of list) out.push({ fn: `${prefix}${m.name}`, kind: m.params ? 'function' : 'value', params: m.params || [] }); };
  for (let k = 0; k < toks.length; k++) {
    if (toks[k].v !== 'FLPT' || !toks[k + 1] || toks[k + 1].v !== '.') continue;
    // FLPT.style('id', { … make … })
    if (toks[k + 2] && toks[k + 2].v === 'style' && toks[k + 3] && toks[k + 3].v === '(' && toks[k + 4] && toks[k + 4].t === 'str' && toks[k + 5] && toks[k + 5].v === ',' && toks[k + 6] && toks[k + 6].v === '{') {
      const defOpen = k + 6, defClose = matchClose(toks, defOpen);
      for (let m = defOpen + 1; m < defClose; m++) {
        if (toks[m].v !== 'make' || toks[m - 1].v === '.') continue;
        const at = toks[m + 1] && toks[m + 1].v === ':' ? m + 2 : m + 1;
        const body = bodyOf(toks, at);
        if (body < 0) continue;
        const bodyClose = matchClose(toks, body);
        const ret = returnedObject(toks, body, bodyClose);
        if (ret >= 0) add('ctx.kit.', members(toks, ret, declarations(toks, body, bodyClose)));
        break;
      }
      k = defClose;
      continue;
    }
    // FLPT.kit.<name> = { … } | (function () { … return { … } })() | (() => { … })()
    if (toks[k + 2] && toks[k + 2].v === 'kit' && toks[k + 3] && toks[k + 3].v === '.' && toks[k + 4] && toks[k + 4].t === 'id' && toks[k + 5] && toks[k + 5].v === '=' && toks[k + 6]) {
      const name = toks[k + 4].v;
      if (!IDENT.test(name)) continue;
      let at = k + 6;
      if (toks[at].v === '{') { add(`ctx.kit.${name}.`, members(toks, at, new Map())); out.push({ fn: `ctx.kit.${name}`, kind: 'value', params: [] }); continue; }
      if (toks[at].v === '(') at++;
      const body = bodyOf(toks, at);
      if (body >= 0) {
        const bodyClose = matchClose(toks, body);
        const ret = returnedObject(toks, body, bodyClose);
        if (ret >= 0) add(`ctx.kit.${name}.`, members(toks, ret, declarations(toks, body, bodyClose)));
      }
      out.push({ fn: `ctx.kit.${name}`, kind: 'value', params: [] });
    }
  }
  const seen = new Set();
  return out.filter((e) => (seen.has(e.fn) ? false : seen.add(e.fn))).sort((a, b) => (a.fn < b.fn ? -1 : a.fn > b.fn ? 1 : 0));
}

/** The style ids a kit registers with FLPT.style('<id>', …). */
function registeredIds(src) {
  let toks;
  try { toks = scan(src).filter((t) => t.t !== 'comment'); } catch { return []; }
  const ids = [];
  for (let k = 0; k + 4 < toks.length; k++) if (toks[k].v === 'FLPT' && toks[k + 1].v === '.' && toks[k + 2].v === 'style' && toks[k + 3].v === '(' && toks[k + 4].t === 'str') ids.push(toks[k + 4].v);
  return ids;
}

// ── the folder ─────────────────────────────────────────────────────────────────────────────────────────────────

function engineCandidates(engineRoot) {
  if (engineRoot) return [engineRoot];
  return [
    path.resolve(__dirname, '..', '..', '..', 'engine'), // app/src/main → <repo>/engine
    process.resourcesPath ? path.join(process.resourcesPath, 'engine') : null, // the packaged app
    path.resolve(__dirname, '..', '..', '..', '..'), // engine/tools/lib/src/main → engine (the plugin's copy)
  ].filter(Boolean);
}
/** engine/runtime/flpt-live, wherever this copy runs. */
function runtimeDir(engineRoot) {
  for (const root of engineCandidates(engineRoot)) {
    const d = path.join(root, 'runtime', 'flpt-live');
    if (fs.existsSync(path.join(d, 'VERSION')) && fs.existsSync(path.join(d, 'tools', 'lint.mjs'))) return d;
  }
  throw new Error("FLPT's runtime is missing (engine/runtime/flpt-live).");
}
const tools = new Map();
/** One of the runtime's tools (an ES module), loaded once. */
async function runtimeTool(name, engineRoot) {
  const f = path.join(runtimeDir(engineRoot), 'tools', name);
  if (!tools.has(f)) tools.set(f, import(pathToFileURL(f).href));
  return tools.get(f);
}

/** Every entry under dir (lstat, never followed): [{ rel, abs, kind: 'file'|'dir'|'symlink'|'special', size }]. */
function walk(dir) {
  const out = [];
  const go = (abs, rel) => {
    let names;
    try { names = fs.readdirSync(abs); } catch { return; }
    for (const name of names.sort()) {
      if (IGNORED.has(name)) continue;
      const p = path.join(abs, name), r = rel ? `${rel}/${name}` : name;
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink()) out.push({ rel: r, abs: p, kind: 'symlink', size: 0 });
      else if (st.isDirectory()) { out.push({ rel: r, abs: p, kind: 'dir', size: 0 }); go(p, r); }
      else if (st.isFile()) out.push({ rel: r, abs: p, kind: 'file', size: st.size });
      else out.push({ rel: r, abs: p, kind: 'special', size: 0 });
    }
  };
  go(dir, '');
  return out;
}

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

/** The checks for one style folder. */
async function lintStyle(dir, opts = {}) {
  const scope = SCOPES.includes(opts.scope) ? opts.scope : 'mine';
  const problems = [];
  const add = (rule, file, message, level = 'error', line) => problems.push({ rule, level, file, message, ...(line ? { line } : {}) });
  const root = path.resolve(dir);
  const done = () => ({ ok: !problems.some((p) => p.level === 'error'), problems });
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) { add('files', '', 'not a folder'); return done(); }
  const entries = walk(root);
  const files = entries.filter((e) => e.kind === 'file');
  const has = (rel) => files.some((e) => e.rel === rel);
  const read = (rel) => fs.readFileSync(path.join(root, ...rel.split('/')));

  // style.json and its shape
  const style = readJson(path.join(root, 'style.json'));
  if (!style) { add('schema', 'style.json', 'missing or not JSON'); return done(); }
  problems.push(...validate(style));
  if (problems.some((p) => p.rule === 'schema' && /^(id|version|files)[:.]/.test(p.message))) return done();
  if (opts.folderName !== false) {
    const want = scope === 'shared' || scope === 'episode' ? `${style.id}@${style.version}` : style.id;
    if (path.basename(root) !== want) add('folder', '', `the folder is "${path.basename(root)}", style.json says "${want}"`);
  }

  // what's in the folder
  for (const e of entries) {
    const segs = e.rel.split('/');
    const lower = segs.map((s) => s.toLowerCase());
    if (e.kind === 'symlink') { add('symlink', e.rel, 'a symlink'); continue; }
    if (e.kind === 'special') { add('files', e.rel, "not a regular file"); continue; }
    if (lower.includes('refs')) { add('refs', e.rel, 'references stay private: no refs/ in a style'); continue; }
    if (segs[segs.length - 1] === REFERENCE_MARK) { add('reference', e.rel, 'a Library reference'); continue; }
    if (e.kind === 'dir') continue;
    const name = segs[segs.length - 1];
    const ext = path.extname(name).toLowerCase();
    if (segs.length === 1 && MEDIA_FILES.includes(name)) continue;
    if (segs.some((sg) => sg.startsWith('.'))) { add('files', e.rel, name.startsWith('.') ? 'a hidden file' : 'in a hidden folder'); continue; }
    if (FONT_EXT.has(ext)) { if (segs[0] !== 'fonts' && !(lower.includes('assets') && lower[lower.indexOf('assets') + 1] === 'fonts')) add('fonts', e.rel, 'fonts live under fonts/'); continue; }
    if (IMAGE_EXT.has(ext)) {
      const a = lower.lastIndexOf('assets');
      if (a < 0) { add('images', e.rel, 'pictures live under assets/ only'); continue; }
      const assets = segs.slice(0, a + 1).join('/');
      const within = segs.slice(a + 1).join('/');
      const prov = ['PROVENANCE.md', 'PROVENANCE.txt'].map((f) => `${assets}/${f}`).find(has);
      const lines = prov ? read(prov).toString('utf8').split(/\r?\n/) : [];
      if (!lines.some((l) => l.includes(within) || (within !== name && l.includes(name)))) add('images', e.rel, `no provenance line for it in ${assets}/PROVENANCE.md`);
      if (ext === '.svg') {
        const svg = read(e.rel).toString('utf8');
        if (/<script\b|\bon[a-z]+\s*=|<foreignObject\b/i.test(svg)) add('code', e.rel, 'an SVG with script');
        if (/\b(href|src)\s*=\s*["'](?!#)[^"']*["']|url\(\s*(?!["']?#)|@import\b/i.test(svg)) add('code', e.rel, 'an SVG that reaches outside itself');
      }
      continue;
    }
    if (!TEXT_EXT.has(ext) && !LICENCE_NAME.test(name)) { add('files', e.rel, `${ext || 'this file'} doesn't belong in a style`); continue; }
    if (name === 'card.json' || name === 'item.json') {
      const j = readJson(e.abs);
      if (j && (j.schema === 'flpt.stylecard/1' || j.kind === 'reference')) add('reference', e.rel, 'a Library reference');
    }
  }

  // declared files
  for (const k of ['kit', 'spec', 'starter']) if (!has(style.files[k])) add('files', style.files[k], `files.${k} is missing`);
  if (style.files.kitExt && !has(style.files.kitExt)) add('files', style.files.kitExt, 'files.kitExt is missing');
  if (style.files.demo && !entries.some((e) => e.rel === style.files.demo.replace(/\/$/, '') && e.kind === 'dir')) add('files', style.files.demo, 'files.demo is missing');

  // sizes
  const kitRel = style.files.kit;
  if (has(kitRel) && read(kitRel).length > LIMITS.kitBytes) add('size', kitRel, `${Math.round(read(kitRel).length / 1024)} KB, over 200 KB`);
  if (has(style.files.spec) && read(style.files.spec).toString('utf8').length > LIMITS.specChars) add('size', style.files.spec, `over ${LIMITS.specChars} characters`);
  const total = files.filter((e) => !(MEDIA_FILES.includes(e.rel))).reduce((n, e) => n + e.size, 0);
  if (total > LIMITS.packageBytes) add('size', '', `the style is ${(total / 1048576).toFixed(1)} MB, over 8 MB`);

  // fonts: declared, licensed, with the licence text beside them
  const declared = new Map((Array.isArray(style.fonts) ? style.fonts : []).filter(isObj).map((f) => [String(f.file || '').replace(/^fonts\//, ''), f]));
  for (const e of files.filter((f) => FONT_EXT.has(path.extname(f.rel).toLowerCase()) && f.rel.startsWith('fonts/'))) {
    const f = declared.get(e.rel.slice('fonts/'.length));
    if (!f) { add('fonts', e.rel, 'not declared in style.json fonts'); continue; }
    const marker = LICENCES[f.licence];
    if (!marker) continue; // validate() reported it
    const candidates = f.licenceFile ? [f.licenceFile] : files.filter((x) => x.rel.startsWith('fonts/') && /^(OFL|LICEN[CS]E)/i.test(path.basename(x.rel)) && TEXT_EXT.has(path.extname(x.rel).toLowerCase())).map((x) => x.rel);
    if (!candidates.some((c) => has(c) && marker.test(read(c).toString('utf8')))) add('fonts', e.rel, `no ${f.licence} licence text beside it`);
  }
  for (const [file] of declared) if (file && !has(`fonts/${file}`)) add('fonts', `fonts/${file}`, 'declared but missing');
  // a scene's own fonts (starter/ or demo/ assets/fonts/): an OFL or Apache licence text in the same folder
  for (const e of files.filter((f) => FONT_EXT.has(path.extname(f.rel).toLowerCase()) && !f.rel.startsWith('fonts/'))) {
    const folder = path.posix.dirname(e.rel);
    const texts = files.filter((x) => path.posix.dirname(x.rel) === folder && /^(OFL|LICEN[CS]E)/i.test(path.basename(x.rel)) && TEXT_EXT.has(path.extname(x.rel).toLowerCase()));
    if (!texts.some((x) => Object.values(LICENCES).some((m) => m.test(read(x.rel).toString('utf8'))))) add('fonts', e.rel, 'no OFL-1.1 or Apache-2.0 licence text beside it');
  }

  // hashes
  if (isObj(style.hashes)) {
    for (const [rel, want] of Object.entries(style.hashes)) {
      if (!safeRel(rel)) continue;
      if (!has(rel)) { add('hashes', rel, 'hashed but missing'); continue; }
      if (`sha256:${sha256(read(rel))}` !== want) add('hashes', rel, "doesn't match its hash");
    }
  }
  if (scope === 'shipped') for (const rel of [style.files.kit, style.files.spec, style.files.starter]) if (!(isObj(style.hashes) && style.hashes[rel])) add('hashes', rel, 'a shipped style hashes it');

  // licence (opts.ported: the repository knows this style descends from a shipped port, whatever its credits say now)
  const ported = opts.ported === true || (Array.isArray(style.authors) && style.authors.some((a) => /cth9191/i.test(String(a)))) || /cth9191|animate/i.test(String(style.credit || ''));
  const licFile = style.licenceFile || 'LICENSE';
  if (style.licenceFile && !has(style.licenceFile)) add('licence', style.licenceFile, 'licenceFile is missing');
  if (ported && !(has(licFile) && /MIT License/.test(read(licFile).toString('utf8')) && /cth9191/.test(read(licFile).toString('utf8')))) add('licence', licFile, 'a port carries the full MIT notice (Copyright (c) 2026 cth9191)');
  if ((scope === 'mine' || scope === 'shared') && style.licence !== 'MIT') add('licence', 'style.json', 'Mine and Shared styles are MIT');

  // code: flpt-live's static lint, the kit's id, long comments and strings
  let lint;
  try { lint = await runtimeTool('lint.mjs', opts.engineRoot); } catch (e) { add('code', '', `the runtime's lint didn't load: ${String(e.message || e).slice(0, 120)}`); }
  const codeFiles = files.filter((e) => e.rel.endsWith('.js'));
  for (const e of codeFiles) {
    const src = read(e.rel).toString('utf8');
    const base = path.basename(e.rel);
    const kind = base === 'scene.js' ? 'scene' : 'kit';
    if (lint) for (const p of lint.lint(src, { kind })) add(p.rule === 'size' ? 'size' : 'code', e.rel, `${p.rule}: ${p.message}`, p.level, p.line);
  }
  if (has(kitRel)) {
    const ids = registeredIds(read(kitRel).toString('utf8'));
    if (!ids.includes(style.id)) add('kit-id', kitRel, `registers ${ids.length ? ids.map((i) => `"${i}"`).join(', ') : 'nothing'}, not "${style.id}"`);
  }
  if (scope !== 'shipped') {
    // every code file but the private demo's scene (a saved piece's own words stay on this Mac), kit-ext.js wherever
    const pool = Object.values(opts.trusted || {}).filter((t) => typeof t === 'string');
    const demo = safeRel(style.files.demo) ? `${style.files.demo.replace(/\/$/, '')}/` : 'demo/';
    const checked = codeFiles.filter((e) => !e.rel.startsWith(demo) || path.basename(e.rel) === 'kit-ext.js').map((e) => e.rel);
    for (const rel of checked) for (const p of longText(read(rel).toString('utf8'), { trusted: pool })) add(p.rule, rel, p.message, p.level, p.line);
  }

  // determinism: two fresh pages, the same frames, the same hashes
  if (opts.deep && !problems.some((p) => p.level === 'error')) {
    try {
      const det = opts.determinism ? await opts.determinism(root, style) : await determinism(root, style, opts);
      if (!det || !det.ok) add('determinism', style.files.starter, `the starter isn't a pure function of t${det && det.problem ? ` (${String(det.problem).slice(0, 160)})` : ''}`);
    } catch (e) { add('determinism', style.files.starter, String(e.message || e).slice(0, 200)); }
  }
  return done();
}

/** The in-page check (framehash --scene): the starter drawn in two fresh pages, in order and shuffled. */
async function determinism(root, style, { engineRoot, n = 12 } = {}) {
  const fh = await runtimeTool('framehash.mjs', engineRoot);
  const scene = path.join(root, path.dirname(style.files.starter));
  const r = await fh.sceneHash({ scene, n, styles: { [style.id]: root } });
  return { ok: !!r.ok, frames: r.frames, problem: r.problem || (r.differ && r.differ.length ? `${r.differ.length} frames differ` : null), sandboxed: r.sandboxed };
}

module.exports = {
  SCHEMA, ID_RE, SEMVER_RE, RUNTIME_RE, LIMITS, LICENCES, MEDIA_FILES, SCOPES, SHARE,
  validate, lintStyle, scan, longText, apiOf, registeredIds, safeRel, runtimeDir, runtimeTool, walk, determinism,
};
