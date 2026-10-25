'use strict';
// files.js · flpt-server's /files (PLAN §2.13 "Origins and files"; W4-01): the web's flpt://. The page shows slide
// pictures, plays videos and sound, and downloads what it made, from the user's own folders only (checked after
// resolving symlinks), with byte ranges so a video can seek.
//   - Pictures, video and sound (the same list as fileproto.js) are served inline with their type. Nothing else is:
//     HTML, SVG, text, JSON and the rest go as `Content-Disposition: attachment` (application/octet-stream), so nothing
//     a crew wrote ever runs on the app's origin.
//   - Every file response carries `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox;
//     default-src 'none'`, and no cookie.
//   - One range (`bytes=a-b`, `a-` or `-n`) → 206 with Content-Range; a range past the end → 416 with `bytes */size`.
// The caller resolves what the page named (a path, or an episode ref and the rest) and passes the absolute file.

const fs = require('fs');
const path = require('path');

// Inline: the media fileproto.js:9-14 serves (images, video, sound). Never HTML or SVG.
const TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.m4v': 'video/x-m4v', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.aac': 'audio/aac', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
};
const FILE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "sandbox; default-src 'none'",
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'private, no-cache',
};

/** Parse a single "bytes=a-b" range against a file size: { start, end }, null (no usable range), or 'bad'. */
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start;
  let end;
  if (m[1] === '') { start = Math.max(0, size - Number(m[2])); end = size - 1; } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return 'bad';
  return { start, end };
}

/** The real path of `p` when it sits inside one of `roots` (both resolved through symlinks), else null. */
async function inside(p, roots) {
  let real;
  try { real = await fs.promises.realpath(p); } catch { return null; }
  for (const r of roots) {
    if (typeof r !== 'string' || !path.isAbsolute(r)) continue;
    let root;
    try { root = await fs.promises.realpath(r); } catch { continue; }
    if (real.startsWith(root + path.sep)) return real;
  }
  return null;
}

/** How a file goes out: inline with its media type, or as a download (anything that isn't a picture, video or sound). */
function disposition(file) {
  const type = TYPES[path.extname(file).toLowerCase()];
  if (type) return { type, inline: true };
  const name = path.basename(file).replace(/[^\w.\- ]/g, '_').slice(0, 120) || 'file';
  return { type: 'application/octet-stream', inline: false, header: `attachment; filename="${name}"` };
}

function deny(res, status, text) {
  res.writeHead(status, { ...FILE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

/**
 * Answer one /files request for `abs` (an absolute path, or null when what the page named didn't resolve), allowed
 * only inside `roots` (absolute folders). GET and HEAD only.
 */
async function serveFile(req, res, abs, roots) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return deny(res, 405, 'not allowed');
  if (!abs || !path.isAbsolute(abs)) return deny(res, 403, 'not allowed');
  const real = await inside(abs, roots);
  if (!real) {
    // missing, but where a root would have it: 404; anything else (outside, or a link out of a root): 403
    const missing = !fs.existsSync(abs) && (await Promise.all(roots.map((r) => fs.promises.realpath(r).catch(() => null))))
      .some((r) => r && path.resolve(abs).startsWith(r + path.sep));
    return missing ? deny(res, 404, 'not found') : deny(res, 403, 'not allowed');
  }
  const stat = await fs.promises.stat(real).catch(() => null);
  if (!stat || !stat.isFile()) return deny(res, 404, 'not found');
  const how = disposition(real);
  const base = { ...FILE_HEADERS, 'Content-Type': how.type, 'Accept-Ranges': 'bytes', ...(how.inline ? {} : { 'Content-Disposition': how.header }) };
  const range = parseRange(req.headers.range, stat.size);
  if (range === 'bad') { res.writeHead(416, { ...base, 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
  const send = (status, headers, opts) => {
    res.writeHead(status, headers);
    if (req.method === 'HEAD') return res.end();
    const s = fs.createReadStream(real, opts);
    s.on('error', () => res.destroy());
    s.pipe(res);
    return undefined;
  };
  if (range) {
    return send(206, { ...base, 'Content-Length': String(range.end - range.start + 1), 'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}` },
      { start: range.start, end: range.end });
  }
  return send(200, { ...base, 'Content-Length': String(stat.size) });
}

module.exports = { serveFile, parseRange, inside, disposition, TYPES, FILE_HEADERS };
