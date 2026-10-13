'use strict';
// Vendored from Present Studio (~/Projects/Loom_presentation/public/js/shared/slop.js) for FLPT's script stage.
// That file is itself a JavaScript port of SlopMonster's tools/deslop.py, MIT, Jack Roberts:
// https://github.com/ItsssssJack/SlopMonster (see THIRD-PARTY-NOTICES.md). Converted to CommonJS; logic unchanged.
// SlopMonster linter, ported to JavaScript from tools/deslop.py
// Original: https://github.com/ItsssssJack/SlopMonster (MIT, Jack Roberts).
// Regex, no opinions. Five groups, one point each: AI vocabulary, AI constructions,
// punctuation cadence, rule-of-three rhythm, invented proof. 5/5 = clean.
// Adapted for spoken scripts: "journey"/"landscape" stay exact-match only, as upstream.

const VOCAB = [
  'delve', 'leverage', 'seamless', 'elevate', 'robust', 'unlock', 'unleash',
  'empower', 'streamline', 'cutting-edge', 'state-of-the-art', 'game-changer',
  'game-changing', 'revolutionize', 'revolutionise', 'transformative',
  'transformation', 'innovate', 'holistic', 'synergy', 'synergies', 'paradigm', 'bespoke',
  'meticulous', 'tapestry', 'testament', 'beacon', 'unparalleled', 'supercharge',
  'turbocharge', 'effortless', 'next-level',
  'pivotal', 'foster', 'showcase', 'compelling', 'intuitive', 'world-class',
  'best-in-class',
];

const VOCAB_EXACT = [
  'crafted', 'curated', 'harnessing', 'harness the power', 'journey', 'realm', 'landscape',
  'navigate the', 'in the world of', "in today's", 'ever-evolving', 'fast-paced',
  'look no further', 'dive in', "let's dive", 'deep dive', 'embark',
  'unlock the power', 'buckle up', 'the secret sauce', 'level up',
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function rootPattern(word) {
  const root = word.replace(/(ed|ing|ly|e)$/, '');
  if (root.length < 4) return new RegExp(`(?<!\\w)${esc(word)}(?!\\w)`, 'g');
  return new RegExp(`(?<!\\w)${esc(root)}(?:e|es|ed|ing|ion|ions|ional|ive|al|ally|s|ly|ness)?(?!\\w)`, 'g');
}

const NEG_JUST = String.raw`(?:\bnot|n['’]t)\s+(?:just|only|merely|simply)\b`;
const XY_TAIL = String.raw`[^!?]{0,80}?[,.]\s*(?:it|this|that|they|we|you|he|she|i)\b`;

const PHRASES = [
  [NEG_JUST + String.raw`[^.!?]{0,80}\bbut\b`, "the 'not just X, but Y' construction"],
  [NEG_JUST + XY_TAIL, "the 'not just X, it's Y' construction"],
  [String.raw`\bwhether you(?:'?re| are)\b[^.!?]{0,40}\bor\b`, "the 'whether you're X or Y' opener"],
  [String.raw`\bmore than just\b`, "'more than just'"],
  [String.raw`\b(that|this)(?:'?s| is) where\b[^.!?]{0,30}\bcomes? in\b`, "'that's where X comes in'"],
  [String.raw`\bsay goodbye to\b`, "'say goodbye to'"],
  [String.raw`\bimagine (a|an|the)\b`, "the 'imagine a…' opener"],
  [String.raw`\bin conclusion\b|\bto sum up\b`, 'essay-summary phrasing'],
  [String.raw`\bwhen it comes to\b`, "'when it comes to' filler"],
  [String.raw`\bat the end of the day\b`, "'at the end of the day'"],
  [String.raw`\bthe key is\b|\bthe truth is\b`, 'throat-clearing opener'],
  [String.raw`\bhelps? you to\b|\bcan help you\b`, "hedged benefit ('helps you to…')"],
  [String.raw`\bmay potentially\b|\bcould potentially\b|\bmight possibly\b`, 'stacked hedging'],
  [String.raw`\bvery unique\b|\bquite literally\b`, 'intensifier padding'],
  [String.raw`\bhere'?s the thing\b|\blet'?s break (it|this) down\b|\bthe best part\b`, 'throat-clearing opener'],
  [String.raw`\bready to get started\b|\blet'?s get started\b`, 'boilerplate CTA'],
  [String.raw`\bthe (result|answer|catch|kicker|upshot)\?\s`, 'self-answering question'],
].map(([p, label]) => [new RegExp(p, 'g'), label]);

const COMPOUND = /\b[a-z]{2,}-[a-z]{2,}(?:-[a-z]{2,})*\b/gi;
const COMPOUND_FLOOR = 4;

const PROOF = new RegExp(
  String.raw`([\d][\d,]*(?:\.\d+)?)\s*\+?\s*` +
  String.raw`((?:happy|early|active|satisfied|verified|trusted|delighted)\s+)?` +
  String.raw`(?:\w+\s+){0,1}` +
  String.raw`(users?|customers?|learners?|students?|teams?|members?|companies|businesses` +
  String.raw`|homeowners?|subscribers?|clients?|patients?|readers?|sites?|projects?)` +
  String.raw`(?!\w)`, 'gi');

function normalise(t) {
  return String(t || '').replace(/‑/g, '-').replace(/ /g, ' ').replace(/’/g, "'")
    .replace(/\s+/g, ' ').trim();
}

const count = (re, s) => (s.match(re) || []).length;

function windows(text, fn) {
  for (const s of text.split(/(?<=[.!?])\s+/)) {
    for (let i = 0; i < Math.max(1, s.length); i += 220) {
      if (fn(s.slice(i, i + 220))) break;
    }
  }
}

function audit(raw) {
  const text = normalise(raw);
  const hits = { vocab: [], phrases: [], punctuation: [], rhythm: [], proof: [] };
  const low = text.toLowerCase();

  for (const w of VOCAB) { const n = count(rootPattern(w), low); if (n) hits.vocab.push([w, n]); }
  for (const w of VOCAB_EXACT) {
    const n = count(new RegExp(`(?<!\\w)${esc(w)}(?!\\w)`, 'g'), low);
    if (n) hits.vocab.push([w, n]);
  }
  for (const [re, label] of PHRASES) { const n = count(re, low); if (n) hits.phrases.push([label, n]); }

  windows(text, (w) => {
    if ((w.match(/—/g) || []).length >= 2) {
      hits.punctuation.push(['two or more em-dashes in one sentence', w.slice(0, 70).trim()]);
      return true;
    }
  });
  windows(text, (w) => {
    const found = w.match(COMPOUND) || [];
    if (found.length >= COMPOUND_FLOOR) {
      hits.punctuation.push([`${found.length} hyphenated compounds stacked in one sentence`, found.slice(0, 4).join(', ')]);
      return true;
    }
  });
  const semis = count(/;/g, text);
  if (semis > Math.max(3, Math.floor(text.length / 1200))) hits.punctuation.push(['semicolon-heavy', `${semis} found`]);

  for (const re of [/\b(\w{4,}),\s+(\w{4,}),\s+and\s+(\w{4,})\b/g,
    /\b(\w{4,}),\s+(\w{4,})\s+and\s+((?:\w+\s+){1,2}\w+)\s*[.!?,;:]/g]) {
    for (const m of text.matchAll(re)) hits.rhythm.push(['rule-of-three list', m[0].slice(0, 60)]);
  }
  for (const m of text.matchAll(PROOF)) hits.proof.push([m[0].trim()]);
  return hits;
}

const TITLES = {
  vocab: 'AI vocabulary', phrases: 'AI constructions', punctuation: 'punctuation cadence',
  rhythm: 'rule-of-three rhythm', proof: 'possible invented proof',
};

/** Score text out of 5. allowProof: numbers come from the user's sources, so proof is advisory. */
function score(text, { allowProof = false } = {}) {
  if (!normalise(text)) return { score: 0, hits: {}, words: 0, clean: false, empty: true };
  const hits = audit(text);
  let s = 5;
  for (const k of Object.keys(hits)) if (hits[k].length && !(k === 'proof' && allowProof)) s -= 1;
  return { score: Math.max(0, s), hits, words: normalise(text).split(' ').length, clean: s === 5 };
}

/** Human-readable list of what the linter flagged, for prompts and the UI. */
function describe(hits) {
  const out = [];
  for (const k of ['proof', 'phrases', 'vocab', 'punctuation', 'rhythm']) {
    for (const item of (hits[k] || []).slice(0, 8)) {
      out.push(`${TITLES[k]}: ${item[0]}${item[1] !== undefined ? ` (${item[1]})` : ''}`);
    }
  }
  return out;
}

module.exports = { normalise, audit, TITLES, score, describe };
