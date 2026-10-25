'use strict';
// keys.js · what a cartoon clip's cache key is made of (PLAN §2.12): the slide's padded narration (pad_key, the same
// key HeyGen's clips are cached by), the rig's bytes, and the versions of everything that turns them into pictures.
//   cartoonKey = sha("cartoon", pad_key, rigSha, producer, compiler, renderer)
// So a clip is made again only when one of those changes, never because of a clock, a folder or a machine (K7: cues,
// track, frames and MP4 byte-identical across runs, sandboxed or not). Node only.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { layerFiles } = require('./rig');

const RENDERER_VERSION = 'flpt-presenter-render 1.0.0';
const RHUBARB = path.join(__dirname, 'rhubarb');

/** sha256 over parts, each followed by a unit separator, as hex. */
function sha(...parts) {
  const h = crypto.createHash('sha256');
  for (const p of parts) { h.update(String(p)); h.update('\x1f'); }
  return h.digest('hex');
}
const fileSha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

/** A rig's bytes as 16 hex: rig.json and every picture it names (not whatever else sits in its folder). */
function rigSha(dir) {
  const rig = JSON.parse(fs.readFileSync(path.join(dir, 'rig.json'), 'utf8'));
  const files = ['rig.json', ...new Set(Object.values(layerFiles(rig)))].sort();
  return sha(...files.map((f) => `${f}:${fileSha(path.join(dir, f))}`)).slice(0, 16);
}

/** FLPT's Rhubarb build, named by its bytes: "rhubarb-wasm 1.14.0+flpt <12 hex>". */
function rhubarbVersion(dir = RHUBARB) {
  return `rhubarb-wasm 1.14.0+flpt ${fileSha(path.join(dir, 'rhubarb.wasm')).slice(0, 12)}`;
}

/** The clip's key (20 hex). */
function cartoonKey({ padKey, rigSha: rs, producer, compiler, renderer = RENDERER_VERSION }) {
  for (const [k, v] of Object.entries({ padKey, rigSha: rs, producer, compiler, renderer })) {
    if (typeof v !== 'string' || !v) throw new Error(`cartoonKey needs ${k}`);
  }
  return sha('cartoon', padKey, rs, producer, compiler, renderer).slice(0, 20);
}

module.exports = { RENDERER_VERSION, RHUBARB, sha, fileSha, rigSha, rhubarbVersion, cartoonKey };
