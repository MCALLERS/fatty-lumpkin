// rig.js · the cartoon presenter's rig format, flpt.rig/1 (PLAN §2.14, with K7's additions: camera, a static backdrop at
// z −1, the eyes' overPupils/hidesPupils, the pupils' clip ellipses, the brows' pivot, smoothing). checkRig(rig) lists
// what's wrong with one (nothing: it can be drawn); layerFiles(rig) the pictures it needs. A classic script that also
// loads as a CommonJS module (globalThis.FLPTRig in a page).
(function (root) {
  'use strict';

  const SCHEMA = 'flpt.rig/1';
  // Rhubarb's nine shapes (A–H, X) plus the two FLPT adds; a track's mouth uses one character per frame (s, l for these two)
  const MOUTHS = ['X', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'smile', 'laugh'];
  const EYES = ['open', 'half', 'closed'];
  const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
  const FILE = /^[A-Za-z0-9_.-]{1,80}\.(svg|png)$/;
  const SEMVER = /^\d+\.\d+\.\d+$/;
  const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  const pair = (v) => Array.isArray(v) && v.length === 2 && v.every(num);

  /** The layer files a rig needs, as { key: file } (key = layer id, or "<layer id>:<state>" for a swap layer). */
  function layerFiles(rig) {
    const out = {};
    for (const L of rig.layers) {
      if (L.type === 'swap') for (const [k, f] of Object.entries(L.states)) out[`${L.id}:${k}`] = f;
      else out[L.id] = L.src;
    }
    return out;
  }

  /** What's wrong with a rig, as short lines; [] when it can be drawn. */
  function checkRig(rig) {
    const out = [];
    if (!isObj(rig)) return ['not a rig'];
    if (rig.schema !== SCHEMA) out.push(`schema isn't ${SCHEMA}`);
    if (typeof rig.id !== 'string' || !ID.test(rig.id)) out.push('id: lower-case letters, digits and dashes');
    if (typeof rig.name !== 'string' || !rig.name.trim() || rig.name.length > 40) out.push('name: up to 40 characters');
    if (typeof rig.version !== 'string' || !SEMVER.test(rig.version)) out.push('version: x.y.z');
    if (!isObj(rig.canvas) || rig.canvas.w !== 720 || rig.canvas.h !== 720) out.push('canvas: 720 × 720');
    if (!isObj(rig.background) || typeof rig.background.value !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(rig.background.value)) out.push('background: a #rrggbb colour');
    if (rig.camera != null && !(isObj(rig.camera) && num(rig.camera.scale) && rig.camera.scale > 0 && rig.camera.scale <= 4 && pair(rig.camera.focus))) out.push('camera: { scale, focus: [x, y] }');
    if (!Array.isArray(rig.layers) || !rig.layers.length || rig.layers.length > 40) { out.push('layers: 1 to 40'); return out; }
    const ids = new Set();
    for (const L of rig.layers) {
      if (!isObj(L) || typeof L.id !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(L.id)) { out.push('a layer without a plain id'); continue; }
      if (ids.has(L.id)) out.push(`${L.id}: twice`);
      ids.add(L.id);
      if (!num(L.z)) out.push(`${L.id}: z`);
      if (L.type === 'swap') {
        if (!isObj(L.states) || !Object.values(L.states).every((f) => typeof f === 'string' && FILE.test(f))) out.push(`${L.id}: states name .svg or .png files`);
      } else if (typeof L.src !== 'string' || !FILE.test(L.src)) out.push(`${L.id}: src names an .svg or .png file`);
      if (L.parent != null && L.parent !== 'head') out.push(`${L.id}: parent can only be head`);
    }
    const by = Object.fromEntries(rig.layers.filter(isObj).map((L) => [L.id, L]));
    if (!by.head || !pair(by.head.pivot)) out.push('head: a layer with a pivot');
    if (!by.eyes || by.eyes.type !== 'swap' || !EYES.every((k) => isObj(by.eyes.states) && by.eyes.states[k])) out.push(`eyes: a swap layer with ${EYES.join(', ')}`);
    if (!by.mouth || by.mouth.type !== 'swap' || !MOUTHS.every((k) => isObj(by.mouth.states) && by.mouth.states[k])) out.push(`mouth: a swap layer with ${MOUTHS.join(', ')}`);
    if (!by.pupils) out.push('pupils: a layer');
    if (!by.brows) out.push('brows: a layer');
    const M = rig.motion;
    if (!isObj(M) || !isObj(M.blink) || !num(M.blink.meanGap) || !num(M.blink.dur) || !num(M.blink.doubleChance)
      || !isObj(M.bob) || !num(M.bob.fromEnvelope) || !num(M.bob.noise) || !isObj(M.breath) || !num(M.breath.period) || !num(M.breath.scale)
      || !num(M.browOnEmphasis)) out.push('motion: blink, bob, breath and browOnEmphasis');
    const p = rig.provenance;
    if (!isObj(p) || !['stock', 'likeness'].includes(p.kind)) out.push('provenance: kind stock or likeness');
    else if (p.kind === 'likeness' && !(isObj(p.consent) && p.consent.self === true)) out.push('provenance: a likeness needs consent.self');
    return out;
  }

  const api = { SCHEMA, MOUTHS, EYES, layerFiles, checkRig };
  root.FLPTRig = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
