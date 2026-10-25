'use strict';
// zipdet.js · deterministic zips for .flptstyle packages (PLAN §2.10, §2.14), and a reader that refuses what a hostile
// zip could do (§2.16 item 8). No dependency beyond Node.
//
//   pack(files)               [{ name, data }] → Buffer: entries sorted (bytewise, UTF-8), stored (method 0, so the
//                             bytes never depend on a zlib build), one fixed time stamp, mode 0644, no extra fields,
//                             no directory entries. The same files give the same bytes on every surface.
//   packDir(dir, {skip})      a folder's regular files, the same way; a symlink or a special file anywhere refuses
//   list(buf, limits)         the checked entries [{ name, size, csize, method, crc, dir }] (nothing inflated)
//   unpack(buf, limits)       [{ name, data }]: every entry checked, inflated with a ceiling, its CRC verified
//   extract(buf, dest, limits) into a fresh folder (it must not exist): written beside it, then renamed in one step
//
// Refused (a ZipError with .code): a name with "..", ".", an empty segment, a leading "/", a drive letter, a
// backslash, a control character or NUL ('zip-slip' / 'name'); a symlink ('symlink') or any other non-regular file
// ('special'); more than 8 MB uncompressed, counted from the headers and again while inflating, so a header can't lie
// ('too-big'); a compression ratio over 50, overall or for any entry of 64 KB or more ('ratio'); two names that are
// one on a case-insensitive disk, or a file that is also a folder ('duplicate'); encryption, zip64, split archives,
// overlapping entries, a local header that disagrees with the directory, a bad CRC ('corrupt' and friends).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const LIMITS = Object.freeze({ maxBytes: 8 * 1024 * 1024, maxRatio: 50, ratioFloor: 64 * 1024, maxEntries: 2000, maxPath: 512, maxSegment: 255 });
// One fixed time stamp for every entry: 2026-01-01 00:00:00 in MS-DOS form.
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME = 0;
const UTF8_FLAG = 0x0800;
const UNIX = 3;
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;
const FILE_MODE = (S_IFREG | 0o644) >>> 0;

class ZipError extends Error {
  constructor(code, message) { super(message); this.name = 'ZipError'; this.code = code; }
}

// ── CRC-32 (IEEE), table-driven ──
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ── names ──
/** The checked form of an entry name (posix, no "./", no trailing "/" for folders), or a ZipError. */
function checkName(raw, limits = LIMITS) {
  const name = String(raw);
  if (!name || name.length > limits.maxPath) throw new ZipError('name', `an entry name is empty or too long`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new ZipError('name', 'an entry name holds a control character');
  if (name.includes('\\')) throw new ZipError('zip-slip', `"${name.slice(0, 80)}" uses a backslash`);
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.includes(':')) throw new ZipError('zip-slip', `"${name.slice(0, 80)}" is an absolute path`);
  const isDir = name.endsWith('/');
  const segs = (isDir ? name.slice(0, -1) : name).split('/');
  for (const s of segs) {
    if (s === '..') throw new ZipError('zip-slip', `"${name.slice(0, 80)}" climbs out of the package`);
    if (s === '' || s === '.') throw new ZipError('name', `"${name.slice(0, 80)}" has an empty segment`);
    if (Buffer.byteLength(s, 'utf8') > limits.maxSegment) throw new ZipError('name', 'an entry name has a segment over 255 bytes');
  }
  return { name: segs.join('/'), dir: isDir };
}
const foldKey = (n) => n.normalize('NFC').toLowerCase();

// ── writing ──
/** A deterministic zip of [{ name, data }]: sorted, stored, one time stamp, mode 0644. */
function pack(files, limits = LIMITS) {
  const list = (files || []).map((f) => {
    const { name, dir } = checkName(f.name, limits);
    if (dir) throw new ZipError('name', `"${name}" is a folder: pack files only`);
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data == null ? '' : f.data);
    return { name, nameBuf: Buffer.from(name, 'utf8'), data };
  });
  list.sort((a, b) => Buffer.compare(a.nameBuf, b.nameBuf));
  const seen = new Set();
  let total = 0;
  for (const f of list) {
    const k = foldKey(f.name);
    if (seen.has(k)) throw new ZipError('duplicate', `"${f.name}" twice`);
    seen.add(k);
    total += f.data.length;
  }
  for (const f of list) {
    const parts = f.name.split('/');
    for (let i = 1; i < parts.length; i++) if (seen.has(foldKey(parts.slice(0, i).join('/')))) throw new ZipError('duplicate', `"${parts.slice(0, i).join('/')}" is a file and a folder`);
  }
  if (list.length > limits.maxEntries) throw new ZipError('too-many', `${list.length} files, over ${limits.maxEntries}`);
  if (total > limits.maxBytes) throw new ZipError('too-big', `${(total / 1048576).toFixed(1)} MB, over ${(limits.maxBytes / 1048576).toFixed(0)} MB`);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of list) {
    const crc = crc32(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(UTF8_FLAG, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(DOS_TIME, 10); lh.writeUInt16LE(DOS_DATE, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(f.data.length, 18); lh.writeUInt32LE(f.data.length, 22); lh.writeUInt16LE(f.nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, f.nameBuf, f.data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE((UNIX << 8) | 20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(UTF8_FLAG, 8);
    ch.writeUInt16LE(0, 10); ch.writeUInt16LE(DOS_TIME, 12); ch.writeUInt16LE(DOS_DATE, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(f.data.length, 20); ch.writeUInt32LE(f.data.length, 24); ch.writeUInt16LE(f.nameBuf.length, 28);
    ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE((FILE_MODE << 16) >>> 0, 38); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, f.nameBuf);
    offset += 30 + f.nameBuf.length + f.data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(list.length, 8); end.writeUInt16LE(list.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, end]);
}

/** Every regular file under dir as [{ name, data }] (posix names, sorted). skip(rel, isDir) leaves a path out. */
function readTree(dir, { skip = () => false } = {}) {
  const out = [];
  const walk = (abs, rel) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)))) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      const p = path.join(abs, e.name);
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink()) throw new ZipError('symlink', `"${r}" is a symlink`);
      if (st.isDirectory()) { if (!skip(r, true)) walk(p, r); continue; }
      if (!st.isFile()) throw new ZipError('special', `"${r}" isn't a regular file`);
      if (!skip(r, false)) out.push({ name: r, data: fs.readFileSync(p) });
    }
  };
  walk(dir, '');
  return out;
}

/** A deterministic zip of a folder's regular files. */
function packDir(dir, opts = {}) {
  return pack(readTree(dir, opts), opts.limits || LIMITS);
}

// ── reading ──
function findEnd(buf) {
  const min = Math.max(0, buf.length - 22 - 0xFFFF);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50 && i + 22 + buf.readUInt16LE(i + 20) === buf.length) return i;
  }
  throw new ZipError('corrupt', "this isn't a zip (no end record)");
}

/** The checked entries of a zip, without inflating anything. */
function list(buf, limits = LIMITS) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new ZipError('corrupt', "this isn't a zip");
  const L = { ...LIMITS, ...limits };
  const e = findEnd(buf);
  const disk = buf.readUInt16LE(e + 4), cdDisk = buf.readUInt16LE(e + 6), here = buf.readUInt16LE(e + 8), count = buf.readUInt16LE(e + 10);
  const cdSize = buf.readUInt32LE(e + 12), cdOff = buf.readUInt32LE(e + 16);
  if (disk !== 0 || cdDisk !== 0 || here !== count) throw new ZipError('split', 'a split archive');
  if (count === 0xFFFF || cdSize === 0xFFFFFFFF || cdOff === 0xFFFFFFFF) throw new ZipError('zip64', 'zip64 archives are refused');
  if (count > L.maxEntries) throw new ZipError('too-many', `${count} entries, over ${L.maxEntries}`);
  if (cdOff + cdSize > e) throw new ZipError('corrupt', 'the directory runs past its end');
  const entries = [];
  const keys = new Map();
  let p = cdOff, total = 0, ctotal = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cdOff + cdSize || buf.readUInt32LE(p) !== 0x02014b50) throw new ZipError('corrupt', 'a damaged directory');
    const madeBy = buf.readUInt16LE(p + 4), flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), diskStart = buf.readUInt16LE(p + 34);
    const ext = buf.readUInt32LE(p + 38), off = buf.readUInt32LE(p + 42);
    if (p + 46 + nlen + xlen + clen > cdOff + cdSize) throw new ZipError('corrupt', 'a damaged directory');
    const nameBuf = buf.subarray(p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    let raw;
    try { raw = new TextDecoder('utf-8', { fatal: true }).decode(nameBuf); } catch { throw new ZipError('name', 'an entry name isn\'t UTF-8'); }
    if (flags & 0x0001 || flags & 0x0040) throw new ZipError('encrypted', `"${raw.slice(0, 80)}" is encrypted`);
    if (diskStart !== 0) throw new ZipError('split', 'a split archive');
    if (size === 0xFFFFFFFF || csize === 0xFFFFFFFF || off === 0xFFFFFFFF) throw new ZipError('zip64', 'zip64 entries are refused');
    const { name, dir } = checkName(raw, L);
    // the file's type: Unix modes in the high half of the external attributes; MS-DOS has the folder bit
    const host = madeBy >> 8;
    const mode = (ext >>> 16) & 0xFFFF;
    const type = mode & S_IFMT;
    if (host === UNIX && type === S_IFLNK) throw new ZipError('symlink', `"${name}" is a symlink`);
    if (host === UNIX && type && type !== S_IFREG && type !== S_IFDIR) throw new ZipError('special', `"${name}" isn't a regular file`);
    const isDir = dir || (host === UNIX && type === S_IFDIR) || (host === 0 && (ext & 0x10) !== 0);
    if (isDir && (size || csize)) throw new ZipError('corrupt', `the folder "${name}" holds data`);
    if (!isDir && method !== 0 && method !== 8) throw new ZipError('method', `"${name}" uses compression method ${method}`);
    if (!isDir && method === 0 && size !== csize) throw new ZipError('corrupt', `"${name}" is stored but its sizes differ`);
    if (size > L.maxBytes) throw new ZipError('too-big', `"${name}" is ${(size / 1048576).toFixed(1)} MB`);
    if (!isDir && size >= L.ratioFloor && size / Math.max(1, csize) > L.maxRatio) throw new ZipError('ratio', `"${name}" expands ${Math.round(size / Math.max(1, csize))}×`);
    const k = foldKey(name);
    if (keys.has(k)) throw new ZipError('duplicate', `"${name}" twice`);
    keys.set(k, isDir);
    total += size; ctotal += csize;
    if (total > L.maxBytes) throw new ZipError('too-big', `over ${(L.maxBytes / 1048576).toFixed(0)} MB uncompressed`);
    entries.push({ name, size, csize, method, crc, dir: isDir, off, nameBuf, flags });
  }
  if (p !== cdOff + cdSize) throw new ZipError('corrupt', 'the directory has trailing bytes');
  if (total > 0 && total / Math.max(1, ctotal) > L.maxRatio) throw new ZipError('ratio', `the package expands ${Math.round(total / Math.max(1, ctotal))}×`);
  // a file can't also be a folder (on disk one would replace or hide the other)
  for (const en of entries) {
    const parts = en.name.split('/');
    for (let i = 1; i < parts.length; i++) if (keys.get(foldKey(parts.slice(0, i).join('/'))) === false) throw new ZipError('duplicate', `"${parts.slice(0, i).join('/')}" is a file and a folder`);
  }
  // local headers: present, agreeing with the directory, and the data of no two entries overlapping
  const spans = [];
  for (const en of entries) {
    if (en.off + 30 > cdOff || buf.readUInt32LE(en.off) !== 0x04034b50) throw new ZipError('corrupt', `"${en.name}" has no local header`);
    const lflags = buf.readUInt16LE(en.off + 6), lmethod = buf.readUInt16LE(en.off + 8), lnlen = buf.readUInt16LE(en.off + 26), lxlen = buf.readUInt16LE(en.off + 28);
    if (lflags & 0x0001 || lmethod !== en.method || lnlen !== en.nameBuf.length || !buf.subarray(en.off + 30, en.off + 30 + lnlen).equals(en.nameBuf)) throw new ZipError('corrupt', `"${en.name}": the local header disagrees with the directory`);
    en.data = en.off + 30 + lnlen + lxlen;
    const endAt = en.data + en.csize + (lflags & 0x0008 ? 12 : 0);
    if (en.data + en.csize > cdOff) throw new ZipError('corrupt', `"${en.name}" runs into the directory`);
    spans.push([en.off, endAt, en.name]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < spans.length; i++) if (spans[i][0] < spans[i - 1][1]) throw new ZipError('corrupt', `"${spans[i][2]}" overlaps another entry`);
  return entries.map(({ name, size, csize, method, crc, dir, data }) => ({ name, size, csize, method, crc, dir, data }));
}

/** Every file of a zip as [{ name, data }], each checked against its header and its CRC. */
function unpack(buf, limits = LIMITS) {
  const L = { ...LIMITS, ...limits };
  const out = [];
  let total = 0;
  for (const en of list(buf, L)) {
    if (en.dir) continue;
    const slice = buf.subarray(en.data, en.data + en.csize);
    let data;
    if (en.method === 0) data = Buffer.from(slice);
    else {
      try { data = zlib.inflateRawSync(slice, { maxOutputLength: Math.max(1, Math.min(L.maxBytes, en.size + 1)) }); } catch (e) {
        if (e && (e.code === 'ERR_BUFFER_TOO_LARGE' || e instanceof RangeError)) throw new ZipError('too-big', `"${en.name}" inflates past its header`);
        throw new ZipError('corrupt', `"${en.name}" won't inflate`);
      }
    }
    if (data.length !== en.size) throw new ZipError(data.length > en.size ? 'too-big' : 'corrupt', `"${en.name}" isn't the size its header says`);
    if (crc32(data) !== en.crc) throw new ZipError('crc', `"${en.name}" fails its CRC`);
    total += data.length;
    if (total > L.maxBytes) throw new ZipError('too-big', `over ${(L.maxBytes / 1048576).toFixed(0)} MB uncompressed`);
    out.push({ name: en.name, data });
  }
  return out;
}

/** Unpack into dest, a folder that must not exist yet (built beside it, then renamed in one step). */
function extract(buf, dest, limits = LIMITS, { skip = () => false } = {}) {
  const target = path.resolve(dest);
  if (fs.existsSync(target)) throw new ZipError('exists', `${path.basename(target)} already exists`);
  const files = unpack(buf, limits);
  const work = `${target}.part-${crypto.randomBytes(4).toString('hex')}`;
  fs.mkdirSync(work, { recursive: false });
  const written = [];
  try {
    for (const f of files) {
      if (skip(f.name)) continue;
      const abs = path.join(work, ...f.name.split('/'));
      if (!abs.startsWith(work + path.sep)) throw new ZipError('zip-slip', `"${f.name}" leaves the folder`);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, f.data, { flag: 'wx', mode: 0o644 });
      written.push(f.name);
    }
    fs.renameSync(work, target);
  } catch (e) {
    fs.rmSync(work, { recursive: true, force: true });
    throw e;
  }
  return written;
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

module.exports = { LIMITS, ZipError, crc32, checkName, pack, packDir, readTree, list, unpack, extract, sha256 };
