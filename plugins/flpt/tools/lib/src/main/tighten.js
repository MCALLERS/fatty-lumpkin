'use strict';
// Tightening, in the Refine step: the film's over-long pauses shortened and, with ElevenLabs Scribe, its laughs cut,
// with picture and sound kept in sync. The method's tighten.py plans the cuts by its own rules: a pause inside a slide
// over 1.1 s → 0.75 s after a sentence end, 0.6 s mid-sentence; across two slides → 1.0 s; never in a cut scene, a
// slide's first 0.4 s or its last frame; on whole frames, where the slide changes least (shorter, or none, over moving
// pictures); a scripted [long pause] held at 1.2 s.
//
// tighten.py reads Scribe's word timings. The free default gives it the method's real-words.py timings of each slide's
// narration (the WAV the film was made with), placed in the film. Laughs need Scribe's audio events, which cost cents:
// the caller gets them through the spend broker and hands them in.
//
// FLPT renders the cuts in one ffmpeg pass from the film (one generation, like Refine's): presentation_tight.mp4 and
// its CapCut-safe master, cut on the same frames and samples. The method's verify_tight.py then checks every word
// against the film, by sound and by picture, before anything is kept. The film itself is never touched.
const fs = require('fs');
const path = require('path');
const refine = require('./refine');

const { FPS, SR } = refine;
const SPF = SR / FPS;
const JUMP_MAX = 3.0; // tighten.py: a cut that has to stay over moving pictures (a laugh)…
const DISSOLVE = 6; // …is softened with a 0.2 s dissolve (frames)
const T = {
  hold: 1.2, // a scripted [long pause] keeps this long
  guard: 0.4, // nothing is cut in a slide's first 0.4 s (the crossfade)…
  edge: 0.04, // …or its last frame
  laughBefore: 0.3, // a laugh's cut leaves up to this much after the word before it,
  laughGap: 0.58, // and a sentence gap of about this much in all
  declick: 0.008, // the sound either side of a cut
};
const LAUGH = /laugh|chuckl|giggl|snicker|cackl/i;
const TOKEN = /<[^>]+>|\[[^\]]+\]|\S+/g; // how real-words.py reads a narration: tags, and words between them
const LONG_PAUSE = /^\[\s*(long pause|pause long)\s*\]$/i;

const exists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const readText = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const r3 = (x) => Math.round(x * 1000) / 1000;
const f3 = (x) => String(Math.round(x * 1000) / 1000);
const f6 = (x) => x.toFixed(6);
const s = (n) => (n === 1 ? '' : 's');
const isTag = (t) => t.startsWith('[') || t.startsWith('<');
const lastLine = (text) => String(text || '').trim().split('\n').pop().slice(0, 300);

const scriptsDir = (engineRoot) => path.join(engineRoot, 'skills', 'avatar-presentation', 'scripts', 'video');
const realWordsPath = (engineRoot) => path.join(engineRoot, 'skills', 'avatar-presentation', 'templates', 'hyperframes', 'real-words.py');
/** FLPT's work folder, laid out the way tighten.py and verify_tight.py expect a talk: <work>/presentation/video/output. */
const workDir = (pres) => path.join(pres, 'refine', 'tighten');
const talkOut = (work) => path.join(work, 'presentation', 'video', 'output');

// ── the words ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Scribe's shape ({ words: [{ text, start, end, type: 'word' }] }, seconds of the film) from each slide's narration
 * word timings (real-words.py's, seconds into the narration): where the film's timeline puts the slide, plus its lead.
 */
function scribeFromWords(timeline, words) {
  const chapters = refine.filmChapters(timeline);
  const lead = refine.narrationLead(chapters);
  const out = [];
  for (const c of chapters) {
    const list = c.kind === 'slide' ? words[c.n] : null;
    if (!Array.isArray(list)) continue;
    const t0 = c.f0 / FPS + lead(c.n);
    for (const w of list) {
      const a = Number(w.start);
      const b = Number(w.end);
      if (Number.isFinite(a) && Number.isFinite(b)) out.push({ text: String(w.text), start: r3(t0 + a), end: r3(t0 + Math.max(a, b)), type: 'word' });
    }
  }
  return { source: 'real-words.py (free)', words: out };
}

/**
 * The script's scripted beats: each [long pause] inside a slide's narration, as a film time in the pause after its
 * word (for tighten.py --hold). A slide whose word count no longer matches its narration gets none.
 */
function holdsFor(timeline, words, script) {
  const chapters = refine.filmChapters(timeline);
  const lead = refine.narrationLead(chapters);
  const out = [];
  for (const c of chapters) {
    const list = c.kind === 'slide' ? words[c.n] : null;
    const toks = (list && (refine.slideNarration(script, c.n) || '').match(TOKEN)) || [];
    if (!toks.length || toks.filter((t) => !isTag(t)).length !== list.length) continue;
    let i = -1;
    for (const t of toks) {
      if (!isTag(t)) { i += 1; continue; }
      if (LONG_PAUSE.test(t) && i >= 0 && i + 1 < list.length) out.push(r3(c.f0 / FPS + lead(c.n) + (Number(list[i].end) + Number(list[i + 1].start)) / 2));
    }
  }
  return [...new Set(out)];
}

/**
 * The laughs to cut, from Scribe's audio events: each with the silence around it, leaving a sentence gap of about
 * 0.58 s between the words either side, and only where a slide plays: never over words, in a cut scene, in a slide's
 * first 0.4 s or at its end. Returns [[start, end]] in seconds of the film.
 */
function laughRanges(scribe, timeline) {
  const items = (scribe && Array.isArray(scribe.words) ? scribe.words : []).map((w) => ({ ...w, start: Number(w.start), end: Number(w.end) }))
    .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start).sort((x, y) => x.start - y.start);
  const words = items.filter((w) => w.type === 'word');
  const slides = refine.filmChapters(timeline).filter((c) => c.kind === 'slide');
  const found = [];
  for (const e of items.filter((w) => w.type === 'audio_event' && LAUGH.test(String(w.text)))) {
    if (words.some((w) => w.start < e.end - 0.02 && w.end > e.start + 0.02)) continue; // laughing through words
    const sl = slides.find((c) => e.start >= c.f0 / FPS && e.start < c.f1 / FPS);
    if (!sl) continue;
    const before = words.filter((w) => w.end <= e.start + 0.02).pop();
    const after = words.find((w) => w.start >= e.end - 0.02);
    const lo = Math.max(sl.f0 / FPS + T.guard, before ? before.end + 0.05 : -Infinity);
    const hi = Math.min(sl.f1 / FPS - T.edge - DISSOLVE / FPS, after ? after.start - 0.05 : Infinity);
    const a = Math.max(lo, before ? Math.min(e.start, before.end + T.laughBefore) : e.start - 0.05);
    const kept = before ? a - before.end : T.laughBefore;
    const b = Math.min(hi, after ? Math.max(e.end, after.start - Math.max(0.05, T.laughGap - kept)) : e.end + 0.05);
    if (a > e.start + 0.05 || b < e.end - 0.05 || b - a < 0.2) continue; // not all of it can go
    found.push([r3(a), r3(b)]);
  }
  const out = [];
  for (const r of found.sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([...r]);
  }
  return out;
}

// ── the cuts, on the film's frames ───────────────────────────────────────────────────────────────────────────

/** What each cut takes out of the film, as [[a, b]] frames: a softened cut (a dissolve) takes 0.2 s more. */
function removedRanges(cuts) {
  return (cuts || []).map((c) => [c.a, c.b + (c.jump > JUMP_MAX ? DISSOLVE : 0)]).sort((x, y) => x[0] - y[0]);
}

/** A film frame on the tightened film (`removed` from removedRanges; a frame inside a cut lands where the cut was). */
function mapFrame(f, removed) {
  let gone = 0;
  for (const [a, b] of removed || []) {
    if (f >= b) gone += b - a;
    else if (f > a) gone += f - a;
  }
  return f - gone;
}

/** A slide's narration word timings ([{ text, start, end }], seconds into the narration) on the tightened film. */
function shiftWords(words, n, timeline, cuts) {
  const removed = removedRanges(cuts);
  const chapters = refine.filmChapters(timeline);
  const c = chapters.find((x) => x.kind === 'slide' && Number(x.n) === Number(n));
  if (!c || !removed.length || !Array.isArray(words)) return words;
  const from = c.f0 + refine.narrationLead(chapters)(n) * FPS; // the narration's start, in film frames
  const gone = (f) => f - mapFrame(f, removed);
  const at = (t) => r3(t - (gone(from + t * FPS) - gone(c.f0)) / FPS);
  return words.map((w) => ({ ...w, start: at(Number(w.start)), end: at(Number(w.end)) }));
}

/** The tightened film's timeline: the film's chapters moved along, and what was taken out (the clip guide maps by it). */
function remapTimeline(timeline, cuts, { laughs = 0, held = 0 } = {}) {
  const removed = removedRanges(cuts);
  const slideRows = new Map((timeline.slides || []).map((x) => [Number(x.n), x]));
  const chapters = refine.filmChapters(timeline).map(({ f0, f1, frames, ...row }) => { // eslint-disable-line no-unused-vars
    const g0 = mapFrame(f0, removed);
    const g1 = mapFrame(f1, removed);
    return { ...(row.kind === 'slide' ? slideRows.get(Number(row.n)) : {}), ...row, start: r3(g0 / FPS), duration: r3((g1 - g0) / FPS), frames: g1 - g0 };
  });
  const frames = chapters.reduce((a, c) => a + c.frames, 0);
  return {
    ...timeline, video: 'presentation_tight.mp4', created: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), fps: FPS, total_duration: r3(frames / FPS),
    slides: chapters.filter((c) => c.kind === 'slide'), cutscenes: chapters.filter((c) => c.kind === 'cutscene'), chapters,
    tightened: { from: timeline.video || 'presentation.mp4', removed, removed_s: r3(removed.reduce((a, [x, y]) => a + y - x, 0) / FPS), cuts: (cuts || []).length, laughs, held },
  };
}

/**
 * The ffmpeg arguments that cut the film: the frames between the cuts, joined (8 ms de-clicks either side of a cut;
 * a dissolve where a cut over moving pictures had to stay), into the tight MP4 and its master (refine.outputArgs).
 * Picture by frame, sound by sample, on the film's own grid. `frames`: the film's. Returns { args, graph, frames }.
 */
function renderArgs({ cuts, frames, film, out }) {
  const soft = new Set(cuts.filter((c) => c.jump > JUMP_MAX).map((c) => c.a));
  const keep = [];
  let f = 0;
  for (const c of [...cuts].sort((x, y) => x.a - y.a)) { if (c.a > f) keep.push([f, c.a]); f = Math.max(f, c.b); }
  if (f < frames) keep.push([f, frames]);
  const n = keep.length;
  const softAfter = (i) => i < n - 1 && soft.has(keep[i][1]);
  const g = [`[0:v]split=${n}${keep.map((_, i) => `[sv${i}]`).join('')}`, `[0:a]asplit=${n}${keep.map((_, i) => `[sa${i}]`).join('')}`];
  keep.forEach(([a, b], i) => {
    const fades = [i > 0 && !softAfter(i - 1) ? `afade=t=in:st=0:d=${T.declick}` : null,
      i < n - 1 && !softAfter(i) ? `afade=t=out:st=${f6((b - a) / FPS - T.declick)}:d=${T.declick}` : null].filter(Boolean);
    g.push(`[sv${i}]trim=start=${f3((a - 0.5) / FPS)}:end=${f3((b - 0.5) / FPS)},settb=1/${FPS},setpts=N[v${i}]`);
    g.push(`[sa${i}]atrim=start_sample=${a * SPF}:end_sample=${b * SPF},aformat=sample_fmts=fltp:sample_rates=${SR}:channel_layouts=stereo,`
      + `asetpts=N/${SR}/TB,apad,atrim=end_sample=${(b - a) * SPF}${fades.length ? `,${fades.join(',')}` : ''}[a${i}]`);
  });
  // Joined: hard cuts by concat; a softened one crosses picture and sound over the same 6 frames.
  const parts = [];
  let [cv, ca, cf] = ['v0', 'a0', keep[0][1] - keep[0][0]];
  let total = cf;
  for (let i = 1; i < n; i++) {
    const nf = keep[i][1] - keep[i][0];
    if (softAfter(i - 1)) {
      g.push(`[${cv}][v${i}]xfade=transition=fade:duration=${f6(DISSOLVE / FPS)}:offset=${f6((cf - DISSOLVE) / FPS)}[xv${i}]`);
      g.push(`[${ca}][a${i}]acrossfade=d=${f6(DISSOLVE / FPS)}[xa${i}]`);
      [cv, ca, cf] = [`xv${i}`, `xa${i}`, cf + nf - DISSOLVE];
      total += nf - DISSOLVE;
    } else {
      parts.push(`[${cv}][${ca}]`);
      [cv, ca, cf] = [`v${i}`, `a${i}`, nf];
      total += nf;
    }
  }
  parts.push(`[${cv}][${ca}]`);
  g.push(`${parts.join('')}concat=n=${parts.length}:v=1:a=1[vcat][acat]`);
  g.push('[vcat]format=yuv420p,split=2[vout1][vout2]');
  g.push(`[acat]apad,atrim=end_sample=${total * SPF},asetpts=N/${SR}/TB,asplit=2[aout1][a2]`);
  // The editing master's voice goes 20 ms later (EDIT_NUDGE_MS), as the pipeline's own master does.
  g.push(`[a2]adelay=delays=${0.02 * SR}S:all=1,atrim=end_sample=${total * SPF},asetpts=N/${SR}/TB[aout2]`);
  const args = ['-hide_banner', '-nostdin', '-y', '-v', 'error', '-progress', 'pipe:1', '-nostats', '-i', film, '-filter_complex', g.join(';\n'),
    ...refine.outputArgs(total, out)];
  return { args, graph: g, frames: total };
}

// ── running it ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * tighten.py's plan for the film, run on FLPT's stand-in talk folder (<pres>/refine/tighten: the film linked, its
 * timeline, the words). Returns { cuts: [{ a, b, why, jump }] (film frames), removed (s), skipped: [why] }.
 */
async function planCuts({ python, engineRoot, work, film, timeline, scribe, laughs = [], holds = [], env, signal }) {
  const out = talkOut(work);
  fs.rmSync(path.join(work, 'presentation'), { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'tighten'), { recursive: true });
  fs.symlinkSync(film, path.join(out, 'presentation.mp4'));
  fs.writeFileSync(path.join(out, 'presentation.timeline.json'), JSON.stringify({ ...timeline, cutscenes: timeline.cutscenes || [] }));
  fs.writeFileSync(path.join(out, 'tighten', 'scribe.json'), JSON.stringify(scribe));
  const args = [path.join(scriptsDir(engineRoot), 'tighten.py'), work];
  if (laughs.length) args.push('--laughs', laughs.map(([a, b]) => `${a}-${b}`).join(','));
  if (holds.length) args.push('--hold', holds.map((t) => `${t}=${T.hold}`).join(','));
  const r = await refine.runTool(python, args, { env, signal });
  if (signal && signal.aborted) throw new Error('Stopped.');
  if (r.code !== 0) {
    throw new Error(/No module named .?numpy/.test(r.err) ? `Tightening needs numpy, and ${python} doesn't have it.`
      : `tighten.py stopped: ${lastLine(r.err) || `exit ${r.code}`}`);
  }
  const plan = readJson(path.join(out, 'tighten', 'plan.json'));
  if (!plan || !Array.isArray(plan.cuts)) throw new Error('tighten.py wrote no plan.');
  return {
    cuts: plan.cuts.map(([a, b, why, jump]) => ({ a: Number(a), b: Number(b), why: String(why || ''), jump: Number(jump) || 0 })).filter((c) => c.b > c.a),
    removed: Number(plan.removed_s) || 0,
    skipped: r.out.split('\n').filter((l) => /^\s*skip\s/.test(l)).map((l) => l.trim().replace(/^skip\s+/, '')),
  };
}

/**
 * The method's verify_tight.py on the tight video: every word's sound against the film's (within 2 ms) and a sample of
 * frames (PSNR 30 dB or better). The words a dissolve blends are left out of it. Returns { ok, summary, lines }.
 */
async function verifySync({ python, engineRoot, work, film, tight, cuts, scribe, env, signal }) {
  const out = talkOut(work);
  for (const f of ['presentation.mp4', 'presentation_uncut.mp4']) fs.rmSync(path.join(out, f), { force: true });
  fs.symlinkSync(film, path.join(out, 'presentation_uncut.mp4'));
  fs.symlinkSync(tight, path.join(out, 'presentation.mp4'));
  const blended = cuts.filter((c) => c.jump > JUMP_MAX).map((c) => [(c.a - DISSOLVE) / FPS - 0.05, (c.b + DISSOLVE) / FPS + 0.05]);
  fs.writeFileSync(path.join(out, 'tighten', 'plan.json'), JSON.stringify({ fps: FPS, cuts: removedRanges(cuts).map(([a, b]) => [a, b, '', 0]) }));
  fs.writeFileSync(path.join(out, 'tighten', 'scribe.json'), JSON.stringify({
    words: scribe.words.filter((w) => w.type === 'word' && !blended.some(([x, y]) => w.start >= x && w.start < y)) }));
  const r = await refine.runTool(python, [path.join(scriptsDir(engineRoot), 'verify_tight.py'), work], { env, signal });
  const lines = r.out.split('\n').map((l) => l.trimEnd()).filter(Boolean);
  return { ok: r.code === 0, summary: lines[0] || lastLine(r.err), lines };
}

/**
 * Tighten the film. Writes d.out.tight, tightMaster and tightTimeline only once they check out. Returns { video,
 * master, timeline, cuts, removed (frames), seconds, frames, notes }.
 *   d.pres, d.film, d.filmTimeline, d.out (refine.outputs), d.engineRoot
 *   d.python       a Python with numpy (tighten.py, verify_tight.py); d.wordsPython runs real-words.py
 *   d.scribe       Scribe's JSON for this film (laughs; paid, through the broker), else the free word timings
 *   d.ffmpeg, d.ffprobe, d.env (PATH), d.signal, d.onLine
 */
async function apply(d) {
  const say = d.onLine || (() => {});
  const { ffmpeg = 'ffmpeg', ffprobe = 'ffprobe', env, signal } = d;
  const stopped = () => signal && signal.aborted;
  const timeline = readJson(d.filmTimeline);
  if (!timeline || !Array.isArray(timeline.slides) || !timeline.slides.length) throw new Error('The film has no timeline (presentation.timeline.json): film it again.');
  if (!exists(d.film)) throw new Error('The film isn\'t there.');
  const chapters = refine.filmChapters(timeline);
  const filmFrames = chapters.length ? chapters[chapters.length - 1].f1 : 0;
  const work = workDir(d.pres);
  fs.mkdirSync(work, { recursive: true });
  say(`Tightening the film's pauses${d.scribe ? ' and laughs' : ''} (nothing is filmed again).`);

  // 1. Words: each slide's narration timed with real-words.py (free, kept in presentation/refine/words), or Scribe's.
  const script = readText(path.join(d.pres, 'script.md'));
  const words = {};
  const untimed = [];
  for (const c of chapters.filter((x) => x.kind === 'slide')) {
    if (stopped()) throw new Error('Stopped.');
    words[c.n] = await refine.slideWords({ pres: d.pres, n: c.n, draft: Boolean(timeline.draft), seconds: c.narration_seconds, python: d.wordsPython,
      realWords: realWordsPath(d.engineRoot), env, signal });
    if (!words[c.n] && (refine.slideNarration(script, c.n) || '').trim()) untimed.push(c.n);
  }
  const scribe = d.scribe || scribeFromWords(timeline, words);
  if (!scribe.words.some((w) => w.type === 'word')) throw new Error('No word timings: the narration the film was made with isn\'t in video/cache/audio any more.');
  const holds = holdsFor(timeline, words, script);
  const laughs = d.scribe ? laughRanges(d.scribe, timeline) : [];

  // 2. The plan.
  say(`  planning the cuts (tighten.py, ${d.scribe ? 'Scribe\'s' : 'free'} word timings${laughs.length ? `, ${laughs.length} laugh${s(laughs.length)}` : ''}${holds.length ? `, ${holds.length} scripted long pause${s(holds.length)} held` : ''})…`);
  const p = await planCuts({ python: d.python, engineRoot: d.engineRoot, work, film: d.film, timeline, scribe, laughs, holds, env, signal });
  const removed = removedRanges(p.cuts);
  const gone = removed.reduce((a, [x, y]) => a + y - x, 0);
  const pauses = p.cuts.filter((c) => c.why.startsWith('pause')).length;
  const laughCuts = p.cuts.filter((c) => c.why.startsWith('laugh')).length;
  const notes = [p.cuts.length ? `${(gone / FPS).toFixed(1)} s shorter: ${pauses} pause${s(pauses)} tightened${laughCuts ? `, ${laughCuts} laugh${s(laughCuts)} cut` : ''}.`
    : 'No pause runs over 1.1 s, so the film keeps its length.'];
  if (holds.length) notes.push(`${holds.length} scripted long pause${s(holds.length)} kept at ${T.hold} s.`);
  if (p.skipped.length) notes.push(`${p.skipped.length} pause${s(p.skipped.length)} over moving pictures left as ${p.skipped.length === 1 ? 'it was' : 'they were'}.`);
  if (d.scribe && !laughs.length) notes.push('No laughs to cut.');
  if (!d.scribe && untimed.length) notes.push(`Slide${s(untimed.length)} ${untimed.join(', ')}: no word timings, so ${untimed.length === 1 ? 'its' : 'their'} pauses stay as they are.`);
  for (const c of p.cuts) say(`  −${((c.b - c.a) / FPS).toFixed(2)} s at ${(c.a / FPS).toFixed(2)} s: ${c.why}`);
  for (const w of p.skipped) say(`  skip ${w}`);

  const tl = remapTimeline(timeline, p.cuts, { laughs: laughCuts, held: holds.length });
  const filmMaster = path.join(path.dirname(d.film), 'presentation_for_editing.mov');
  if (!p.cuts.length && exists(filmMaster)) {
    // Nothing to take out: the film and its master, as they are.
    for (const [from, to] of [[d.film, d.out.tight], [filmMaster, d.out.tightMaster]]) fs.copyFileSync(from, to, fs.constants.COPYFILE_FICLONE);
    fs.writeFileSync(d.out.tightTimeline, `${JSON.stringify(tl, null, 2)}\n`);
    say('  ✓ nothing to cut');
    return { video: d.out.tight, master: d.out.tightMaster, timeline: d.out.tightTimeline, cuts: [], removed: [], frames: filmFrames, seconds: r3(filmFrames / FPS), notes };
  }

  // 3. One pass: the tight MP4 and its master.
  const tmp = { video: d.out.tight.replace(/\.mp4$/, '.tmp.mp4'), master: d.out.tightMaster.replace(/\.mov$/, '.tmp.mov') };
  const clean = () => { for (const f of Object.values(tmp)) fs.rmSync(f, { force: true }); };
  const { args, frames } = renderArgs({ cuts: p.cuts, frames: filmFrames, film: d.film, out: tmp });
  say(`  rendering ${(frames / FPS).toFixed(1)} s (${p.cuts.length} cut${s(p.cuts.length)})…`);
  let shown = -1;
  const r = await refine.runTool(ffmpeg, args, { env, signal, onOut: (chunk) => {
    const m = [...String(chunk).matchAll(/out_time_us=(\d+)/g)].pop();
    const pct = m ? Math.min(99, Math.floor((Number(m[1]) / 1e6 / (frames / FPS)) * 10) * 10) : -1;
    if (pct > shown) { shown = pct; say(`  ${pct} %`); }
  } });
  if (stopped()) { clean(); throw new Error('Stopped.'); }
  if (r.code !== 0) { clean(); throw new Error(`ffmpeg stopped: ${lastLine(r.err) || `exit ${r.code}`}`); }

  // 4. Checked before anything is kept: the lengths, the master, then every word against the film.
  const v = await refine.probeMedia(ffprobe, tmp.video, env);
  const mv = await refine.probeMedia(ffprobe, tmp.master, env);
  const problems = [];
  if (!v || !v.video || !v.audio) problems.push('the MP4 has no picture or no sound');
  else {
    if (v.frames && v.frames !== frames) problems.push(`the MP4 has ${v.frames} frames, not ${frames}`);
    if (v.videoDuration && v.audioDuration && Math.abs(v.videoDuration - v.audioDuration) > 0.15) problems.push('its picture and sound differ in length');
  }
  if (!mv || !mv.video || mv.acodec !== 'pcm_s16le' || mv.hasBFrames) problems.push('the editing master isn\'t CapCut-safe (PCM sound, no B-frames)');
  else if (mv.frames && mv.frames !== frames) problems.push(`the editing master has ${mv.frames} frames, not ${frames}`);
  if (refine.hasEditList(tmp.master)) problems.push('the editing master has an edit list');
  if (problems.length) { clean(); throw new Error(`The tightened film didn't check out: ${problems.join('; ')}.`); }
  say('  checking every word against the film (verify_tight.py)…');
  const check = await verifySync({ python: d.python, engineRoot: d.engineRoot, work, film: d.film, tight: tmp.video, cuts: p.cuts, scribe, env, signal });
  if (stopped()) { clean(); throw new Error('Stopped.'); }
  if (!check.ok) { clean(); throw new Error(`The tightened film didn't check out (verify_tight.py: ${check.summary}).`); }

  fs.renameSync(tmp.video, d.out.tight);
  fs.renameSync(tmp.master, d.out.tightMaster);
  fs.writeFileSync(d.out.tightTimeline, `${JSON.stringify(tl, null, 2)}\n`);
  say(`  ✓ ${path.basename(d.out.tight)}: ${(frames / FPS).toFixed(1)} s, ${frames} frames (${check.summary})`);
  say(`  ✓ ${path.basename(d.out.tightMaster)}: no B-frames, PCM sound, no edit lists, voice +20 ms`);
  return { video: d.out.tight, master: d.out.tightMaster, timeline: d.out.tightTimeline, cuts: p.cuts, removed, frames, seconds: r3(frames / FPS), notes };
}

module.exports = { scribeFromWords, holdsFor, laughRanges, removedRanges, mapFrame, shiftWords, remapTimeline, renderArgs, planCuts, verifySync,
  apply, workDir, T, JUMP_MAX, DISSOLVE };
