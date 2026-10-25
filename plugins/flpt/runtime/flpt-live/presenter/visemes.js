'use strict';
// visemes.js · the fallback mouth-cue producer (PLAN §2.12, spike K7): text, and a provider's word timings when there are
// any (the FLPT_WORDS_V1 sidecars), → Rhubarb's shapes A–H/X in Rhubarb's own JSON. The order is Rhubarb with the
// spoken text as dialog, then Rhubarb without it, then this, and this only with word timings: without them it scored
// 33–44 % exact frames against Rhubarb (K7), which isn't shippable. Phones come from CMUdict (the copy Rhubarb ships),
// mapped with research 08 §4.1's table; without word timings they're spread over the voiced stretches of the padded WAV
// (10 ms loudness), vowels weighted 1.6 to consonants' 1. Pure and deterministic. Node only (it reads the dictionary).
const fs = require('fs');
const path = require('path');

const PRODUCER = 'flpt-text-visemes 1.0.0';
const DICT = path.join(__dirname, 'rhubarb', 'res', 'sphinx', 'cmudict-en-us.dict');

let dict = null;
function loadDict(file = DICT) {
  if (dict) return dict;
  dict = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const i = line.indexOf(' ');
    if (i < 1) continue;
    const w = line.slice(0, i);
    if (w.includes('(')) continue; // the first pronunciation only
    dict.set(w, line.slice(i + 1).trim().split(/\s+/));
  }
  return dict;
}

const SHAPE = { AA: 'D', AE: 'C', AH: 'C', AO: 'E', AW: ['D', 'F'], AY: ['D', 'B'], EH: 'C', ER: 'E', EY: ['C', 'B'],
  IH: 'B', IY: 'B', OW: ['E', 'F'], OY: ['E', 'B'], UH: 'F', UW: 'F', B: 'A', M: 'A', P: 'A', F: 'G', V: 'G', L: 'H',
  W: 'F', R: 'E', Y: 'B', CH: 'B', JH: 'B', SH: 'B', ZH: 'B', D: 'B', T: 'B', N: 'B', S: 'B', Z: 'B', TH: 'B', DH: 'B',
  K: 'B', G: 'B', NG: 'B', HH: 'C' };
const VOWEL = new Set(['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW']);
const LETTER = { a: ['AE'], b: ['B'], c: ['K'], d: ['D'], e: ['EH'], f: ['F'], g: ['G'], h: ['HH'], i: ['IH'], j: ['JH'],
  k: ['K'], l: ['L'], m: ['M'], n: ['N'], o: ['AA'], p: ['P'], q: ['K'], r: ['R'], s: ['S'], t: ['T'], u: ['AH'], v: ['V'],
  w: ['W'], x: ['K', 'S'], y: ['Y'], z: ['Z'] };
const DIGIT = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

function phonesOf(word) {
  const d = loadDict();
  if (d.has(word)) return d.get(word);
  if (/^\d+$/.test(word)) return [...word].flatMap((c) => d.get(DIGIT[+c]) || []);
  const base = word.replace(/'s$/, '');
  if (d.has(base)) return [...d.get(base), 'Z'];
  return [...word].flatMap((c) => LETTER[c] || []); // naive letter-to-sound for a word the dictionary doesn't know
}

/** Voiced stretches of 16-bit PCM as [startS, endS] (10 ms windows, −40 dBFS, gaps under 120 ms bridged). */
function voiced(pcm, rate) {
  const win = Math.round(rate / 100), on = [];
  for (let i = 0; i + win <= pcm.length; i += win) {
    let s = 0; for (let k = i; k < i + win; k += 2) s += pcm[k] * pcm[k];
    const db = 20 * Math.log10(Math.sqrt(s / (win / 2)) / 32768 + 1e-9);
    on.push(db > -40);
  }
  const segs = [];
  let st = -1;
  for (let w = 0; w <= on.length; w++) {
    if (w < on.length && on[w]) { if (st < 0) st = w; continue; }
    if (st >= 0) { segs.push([st, w]); st = -1; }
  }
  const merged = [];
  for (const g of segs) { if (merged.length && g[0] - merged[merged.length - 1][1] < 12) merged[merged.length - 1][1] = g[1]; else merged.push(g.slice()); }
  return merged.filter(([a, b]) => b - a >= 6).map(([a, b]) => [a / 100, b / 100]);
}

/**
 * Mouth cues from text. words: [{ text, start, end }] (seconds in the padded WAV) when a provider gave timings, else
 * null. → { metadata, mouthCues } in Rhubarb's shape.
 */
function textVisemes(text, pcm, rate, frames, words = null) {
  const toks = String(text).toLowerCase().replace(/[’]/g, "'").replace(/\[[^\]]*\]/g, ' ').match(/[a-z0-9']+/g) || [];
  const units = []; // [shape, weight], with a short gap after each word
  for (const w of toks) {
    for (const ph of phonesOf(w)) {
      const s = SHAPE[ph.replace(/\d/g, '')] || 'B';
      const wt = VOWEL.has(ph.replace(/\d/g, '')) ? 1.6 : 1;
      if (Array.isArray(s)) units.push([s[0], wt * 0.6], [s[1], wt * 0.4]); else units.push([s, wt]);
    }
    units.push([null, 0.25]);
  }
  const segs = words && words.length ? words.map((x) => [x.start, x.end]) : voiced(pcm, rate);
  const total = segs.reduce((a, [s, e]) => a + (e - s), 0);
  const wsum = units.reduce((a, u) => a + u[1], 0) || 1;
  const at = (x) => { // speech time x (0..total) → clock time
    for (const [s, e] of segs) { if (x <= e - s) return s + x; x -= e - s; }
    return segs.length ? segs[segs.length - 1][1] : 0;
  };
  const cues = [];
  const push = (start, end, value) => {
    if (end - start < 0.005) return;
    const last = cues[cues.length - 1];
    if (last && last.value === value && Math.abs(last.end - start) < 1e-6) last.end = end;
    else cues.push({ start, end, value });
  };
  let acc = 0;
  for (const [shape, wt] of units) {
    const x0 = (acc / wsum) * total, x1 = ((acc + wt) / wsum) * total;
    acc += wt;
    const t0 = at(x0), t1 = at(x1);
    if (!shape) continue;
    const cut = segs.find(([s, e]) => t0 < e && t1 > e); // a unit that straddles a silence ends at it
    push(+t0.toFixed(3), +(cut ? cut[1] : t1).toFixed(3), shape);
  }
  const dur = frames / 30, out = [];
  let t = 0;
  for (const c of cues) {
    if (c.start > t + 0.005) out.push({ start: t, end: c.start, value: 'X' });
    out.push(c); t = c.end;
  }
  if (t < dur) out.push({ start: t, end: dur, value: 'X' });
  const r = (v) => Math.round(v * 100) / 100;
  const mouthCues = out.map((c) => ({ start: r(c.start), end: r(c.end), value: c.value })).filter((c) => c.end > c.start);
  return { metadata: { soundFile: null, duration: r(dur), producer: PRODUCER, dialog: true, words: Boolean(words && words.length) }, mouthCues };
}

module.exports = { PRODUCER, textVisemes, phonesOf, voiced, DICT };
