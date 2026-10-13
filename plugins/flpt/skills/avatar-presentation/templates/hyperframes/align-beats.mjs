#!/usr/bin/env node
// align-beats.mjs — set beat times from the narration's word timestamps.
//
//   node align-beats.mjs <slide-dir> --words <words.json> [--lead 0.2] [--offset 0] [--set-duration] [--tail 1.2] [--dry-run]
//
// Every beat with a "cue" (a phrase from the narration) gets t = (first word of the phrase).start + offset - lead.
// Beats that use "after" follow the beat before them, so they move with it. Cues are matched in order;
// punctuation and case are ignored. Unmatched cues keep their old t and are reported.
//
// --words      word timings for THIS slide's narration. Accepted shapes:
//                [{text|word, start, end}]            (hyperframes transcribe, most tools)
//                {words: [...]}                        (OpenAI verbose_json, ElevenLabs Scribe)
//                {segments: [{words: [...]}]}          (Whisper)
//                {alignment|normalized_alignment: {characters, character_start_times_seconds, character_end_times_seconds}}
//                                                      (ElevenLabs text-to-speech "with timestamps")
// --offset     seconds added to every word time: use it when the slide's video starts before the voice
//              (e.g. a 0.5 s lead-in), or negative when the words file covers the whole talk.
// --lead       how far ahead of the word the element starts (default: beats.json "lead", else 0.2 s)
// --set-duration  also set duration = last word end + offset + tail (default tail = hold + 0.3 s)
// --dry-run    print the plan without writing beats.json (a .bak copy is kept when writing)

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const FPS = 30;
const args = { _: [] };
for (let i = 2; i < process.argv.length; i++) {
  const s = process.argv[i];
  if (!s.startsWith("--")) args._.push(s);
  else if (["set-duration", "dry-run", "help"].includes(s.slice(2))) args[s.slice(2)] = true;
  else args[s.slice(2)] = process.argv[++i];
}
const die = (m) => { console.error(`align-beats.mjs: ${m}`); process.exit(1); };
if (args.help || !args.words) {
  console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 22).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(args.help ? 0 : 1);
}

const dir = resolve(args._[0] || ".");
const beatsPath = join(dir, "beats.json");
if (!existsSync(beatsPath)) die(`no beats.json in ${dir}`);
const slide = JSON.parse(readFileSync(beatsPath, "utf8"));
const raw = JSON.parse(readFileSync(resolve(args.words), "utf8"));

function wordsFrom(j) {
  const pick = (w) => ({
    text: String(w.text ?? w.word ?? w.punctuated_word ?? "").trim(),
    start: Number(w.start ?? w.start_time ?? w.startTime),
    end: Number(w.end ?? w.end_time ?? w.endTime),
  });
  if (Array.isArray(j)) return j.map(pick);
  if (Array.isArray(j.words)) return j.words.filter((w) => !w.type || w.type === "word").map(pick);
  if (Array.isArray(j.segments)) return j.segments.flatMap((s) => (s.words || []).map(pick));
  const al = j.alignment || j.normalized_alignment;
  if (al && Array.isArray(al.characters)) {
    const out = [];
    let cur = null;
    al.characters.forEach((ch, i) => {
      if (/\s/.test(ch)) { if (cur) out.push(cur); cur = null; return; }
      if (!cur) cur = { text: "", start: al.character_start_times_seconds[i], end: 0 };
      cur.text += ch;
      cur.end = al.character_end_times_seconds[i];
    });
    if (cur) out.push(cur);
    return out;
  }
  die("unrecognised words file (see --help for accepted shapes)");
}

const norm = (s) => s.toLowerCase().replace(/[’']/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const words = wordsFrom(raw).filter((w) => w.text && Number.isFinite(w.start));
if (!words.length) die("no timed words found");
// flat token list ("no-regrets" -> "no", "regrets"), each token remembers its word
const toks = [];
const owner = [];
words.forEach((w, wi) => norm(w.text).split(" ").filter(Boolean).forEach((t) => { toks.push(t); owner.push(wi); }));

// returns the index of the first WORD of the phrase, searching tokens from word index `from`
function find(cue, from) {
  const want = norm(cue).split(" ").filter(Boolean);
  const startTok = Math.max(0, owner.findIndex((wi) => wi >= from));
  outer: for (let i = startTok; i <= toks.length - want.length; i++) {
    for (let k = 0; k < want.length; k++) if (toks[i + k] !== want[k]) continue outer;
    return owner[i];
  }
  return -1;
}

const lead = Number(args.lead ?? slide.lead ?? 0.2);
const offset = Number(args.offset ?? 0);
let ptr = 0;
const rows = [];
for (const b of slide.beats || []) {
  if (!b.cue) continue;
  let i = find(b.cue, ptr);
  let note = "";
  if (i < 0) { i = find(b.cue, 0); if (i >= 0) note = " (out of order)"; }
  if (i < 0) { rows.push(`  ✗ "${b.cue}" not found — kept t=${b.t ?? "after " + b.after}`); continue; }
  const t = Math.max(0, Math.round((words[i].start + offset - lead) * 100) / 100);
  rows.push(`  ✓ "${b.cue}" → word ${i} @ ${(words[i].start + offset).toFixed(2)}s → t ${b.t ?? "—"} → ${t}${note}`);
  delete b.after;
  const rest = { ...b };
  delete rest.t;
  Object.keys(b).forEach((k) => delete b[k]);
  Object.assign(b, { t }, rest); // keep "t" as the first key
  ptr = i + 1;
}

if (args["set-duration"]) {
  const hold = typeof slide.hold === "number" ? slide.hold : 1;
  const tail = Number(args.tail ?? hold + 0.3);
  const end = words[words.length - 1].end + offset + tail;
  const d = Math.ceil(end * FPS) / FPS;
  rows.push(`  · duration ${slide.duration} → ${+d.toFixed(3)} (last word ends ${(words[words.length - 1].end + offset).toFixed(2)}s + tail ${tail}s)`);
  slide.duration = +d.toFixed(3);
}

// keep beats one-per-line so the file stays readable
function fmtVal(v) {
  if (Array.isArray(v)) return "[" + v.map((x) => fmtVal(x)).join(", ") + "]";
  if (v && typeof v === "object") return "{" + Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${fmtVal(x)}`).join(", ") + "}";
  return JSON.stringify(v);
}
function formatBeats(j) {
  const { beats, ...rest } = j;
  const top = JSON.stringify(rest, null, 2).replace(/\n}$/, "");
  const lines = (beats || []).map((b) => "    { " + Object.entries(b).map(([k, v]) => `${JSON.stringify(k)}: ${fmtVal(v)}`).join(", ") + " }");
  return `${top},\n  "beats": [\n${lines.join(",\n")}\n  ]\n}\n`;
}

console.log(`align-beats: ${words.length} words, lead ${lead}s, offset ${offset}s`);
rows.forEach((r) => console.log(r));
if (args["dry-run"]) { console.log("(dry run: beats.json unchanged)"); process.exit(0); }
copyFileSync(beatsPath, beatsPath + ".bak");
const text = formatBeats(slide);
JSON.parse(text);
writeFileSync(beatsPath, text);
console.log(`✓ wrote ${beatsPath} (backup: beats.json.bak). Next: node render.mjs "${dir}" --sync   (or render)`);
