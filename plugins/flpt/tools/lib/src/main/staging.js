'use strict';
// Files the user picked in a native dialog, or dropped on the window, held in the main process until they're used
// (a new call, a new episode, an add-on for Refine, a reference). The page only ever sees a token and the files'
// names, never their paths.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KINDS = { image: /\.(png|jpe?g|gif|webp|heic|heif)$/i, video: /\.(mp4|mov|m4v)$/i, doc: /\.(pdf|txt|md|rtf|docx|html?)$/i };
const kindOf = (p) => Object.keys(KINDS).find((k) => KINDS[k].test(p)) || null;
// A reference (references.js): pictures or one screen recording, nothing that opens as a document.
const REF_KINDS = { image: /\.(png|jpe?g|gif|webp|heic|heif|tiff?|bmp)$/i, video: /\.(mp4|mov|m4v|webm)$/i };
const REF_REFUSE = 'Pictures or a video only.';
const REF_MAX = 12;

/**
 * @param {object} [o]
 * @param {object} [o.kinds]   kind → file-name pattern (default: photos, clips and documents)
 * @param {string} [o.refuse]  what to say when none of the files will do
 * @param {number} [o.max]     at most this many files per token (the rest are left out)
 */
function createStaging({ ttlMs = 30 * 60 * 1000, now = () => Date.now(), kinds = KINDS, refuse = 'Add a photo, a clip, or a document (PDF, text, Word, web page).', max = Infinity } = {}) {
  const held = new Map();
  const kindFor = (p) => Object.keys(kinds).find((k) => kinds[k].test(p)) || null;
  const sweep = () => { for (const [t, v] of held) if (now() - v.at > ttlMs) held.delete(t); };

  /** Hold these files (absolute paths to photos, clips or documents; anything else is skipped). */
  function stage(paths) {
    sweep();
    const files = [];
    for (const p of paths || []) {
      if (typeof p !== 'string' || !path.isAbsolute(p)) continue;
      let st;
      try { st = fs.statSync(p); } catch { continue; }
      const kind = kindFor(p);
      if (st.isFile() && kind) files.push({ path: p, name: path.basename(p), kind });
      if (files.length >= max) break;
    }
    if (!files.length) throw new Error(refuse);
    const token = `st_${crypto.randomBytes(9).toString('hex')}`;
    held.set(token, { files, at: now() });
    return { token, files: files.map(({ name, kind }) => ({ name, kind })) };
  }

  /** The held files, once: a token can't be used twice. */
  function takeFiles(token) {
    sweep();
    const v = held.get(token);
    if (!v) throw new Error('Those files have expired. Add them again.');
    held.delete(token);
    return v.files.map((f) => ({ ...f }));
  }

  /** The held files' paths, once: a token can't be used twice. */
  const take = (token) => takeFiles(token).map((f) => f.path);

  return { stage, take, takeFiles };
}

/** Staging for references: pictures (up to 12) or a video, by token, like every other pick or drop. */
const createReferenceStaging = (o = {}) => createStaging({ kinds: REF_KINDS, refuse: REF_REFUSE, max: REF_MAX, ...o });

module.exports = { createStaging, createReferenceStaging, kindOf, REF_KINDS, REF_MAX };
