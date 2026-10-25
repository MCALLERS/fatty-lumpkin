'use strict';
// The Refine step: add-ons after filming, applied to the finished film with ffmpeg alone.
//
// The film can't take them through the pipeline's own media.json: a cut scene added there changes the leads and tails
// of the slides beside it, and that re-bills their avatar clips. So Refine works on the approved film and its
// timeline (video/output/presentation.timeline.json), frame by frame:
//   clip        a video (from the Library or a file) inserted as a cut scene after slide N, or right after a phrase
//               of slide N's narration; its own sound kept (levelled to the narration) or muted; short fades
//   transition  from Transitions & Music: a spoken card inserted between two slides like a clip, or a glitch
//               overlay blended (Screen) over the cut between slides N and N+1, its cut point on the cut
//   music       a bed under slide N or under an inserted clip, at about -26 LUFS, 1 s in and 1.8 s out
//   broll       a clip shown full frame over slide N (from its start or from a phrase) for its length or a set
//               time, the narration carrying on underneath
// It writes presentation_refined.mp4 (the film's own encoding), presentation_refined_for_editing.mov (the CapCut-safe
// master: no B-frames, PCM, no edit lists, voice +20 ms) and presentation_refined.timeline.json (for the web parts and
// the player). Nothing here touches HeyGen, the network or anything paid.
//
// Sync: every piece is cut on the film's own frame grid (30 fps, 1600 samples a frame at 48 kHz), its picture by frame
// and its sound by sample, so each piece starts with picture and sound together and stays that way when joined.
//
// Planned rows (V2, PLAN §2.7, spike K5): the storyboard's pieces between slides (a Solo ♪, a cut scene drawn in code)
// rendered to media/jsscene_<id>.mp4 and spliced here, never through media.json (interstitials.js makes the rows with
// plannedAddon; the page can't):
//   slide: 0          a cold open, before slide 1 (no breath after it: slide 1 has its own 0.5 s lead)
//   level: 'own'      the clip keeps its own level (rendered at -21 LUFS by the mixer) instead of the narration's
//   seam.in/out       cut | fade (0.25 s, as every other clip) | black (0.5 s of black and silence, hard edges, part of
//                     the piece's chapter); the breath after it fades up only after a `fade`
//   source            { kind: 'jsscene', id, shot }: the chapter takes the piece's id, and every row Refine inserts is
//                     `spliced: true` (narrationLead and retime.py give the slide after it no lead of its own)
// The editing master's +20 ms (EDIT_NUDGE_MS, for HeyGen's late lips) goes on the film's sound only: an insert's own
// sound stays on its picture (0.7.1 delayed the whole mix, so a clip's sound landed 20 ms late; K5 measured it).
// Nothing that is a reference (references.isReference) goes in: not as an add-on, not as the film.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const references = require('./references');
const sandbox = require('./sandbox');

const FPS = 30;
const SR = 48000;
const SPF = SR / FPS; // audio samples per video frame
const KINDS = ['clip', 'transition', 'music', 'broll'];
const VIDEO_RE = /\.(mp4|m4v|mov|webm|mkv|avi)$/i;
const AUDIO_RE = /\.(mp3|m4a|wav|aif|aiff|aac|flac|ogg)$/i;

const T = {
  insertFade: 0.25, // a clip's picture fades in from black and out to black
  insertAudioFade: 0.15,
  cardAudioFade: 0.02, // the cards are designed pieces: only a de-click
  declick: 0.02, // the film's own sound either side of a cut
  breath: 0.4, // after an insert the film picks up on its next frame, held and fading up, before the voice resumes
  bedFadeIn: 1.0,
  bedFadeOut: 1.8,
  bedLufs: -26, // music beds sit about here, and at least 10 LU under the narration
  brollLead: 0.2, // b-roll lands this far ahead of its phrase
  phraseGap: 0.3, // a cut after a phrase goes at most this far into the pause after it
  minBed: 1.0,
  black: 0.5, // a `black` seam: this long of black and silence
  nudgeMs: 20, // EDIT_NUDGE_MS: the editing master's voice delay
  sceneBedLufs: -32, // a bed under a scene that has its own music (the double-music guard)
};
const SEAMS = ['cut', 'fade', 'black'];
const EDITED = 'edited (trimmed, looped, mixed)'; // what a credit says was done to a CC BY track in the video (PLAN W2-03, G4)
/** A planned row's seams (`cut` when not said); every other add-on fades, as it always has. */
const seamOf = (a) => {
  if (!a || !a.planned) return { in: 'fade', out: 'fade' };
  const s = a.seam || {};
  return { in: SEAMS.includes(s.in) ? s.in : 'cut', out: SEAMS.includes(s.out) ? s.out : 'cut' };
};
const SOURCE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const LIMITS = { phrase: 200, title: 200, credit: 2000, seconds: [0.5, 120], gainDb: [-20, 15] };

const exists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const r3 = (x) => Math.round(x * 1000) / 1000;
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** Where Refine writes, next to the film. With tightening on, the add-ons go on the tightened film (tighten.js). */
function outputs(dir) {
  const out = path.join(dir, 'presentation', 'video', 'output');
  return {
    film: path.join(out, 'presentation.mp4'), filmTimeline: path.join(out, 'presentation.timeline.json'),
    video: path.join(out, 'presentation_refined.mp4'), master: path.join(out, 'presentation_refined_for_editing.mov'),
    timeline: path.join(out, 'presentation_refined.timeline.json'),
    tight: path.join(out, 'presentation_tight.mp4'), tightMaster: path.join(out, 'presentation_tight_for_editing.mov'),
    tightTimeline: path.join(out, 'presentation_tight.timeline.json'),
  };
}

// ── add-ons, as the episode records them ─────────────────────────────────────────────────────────────────────

/**
 * One add-on, checked (the page's types are never trusted). `ctx.slides` is the film's slide count (or the deck's),
 * `ctx.addons` the ones already there (for "under a clip"). Throws a plain message on anything wrong.
 */
function cleanAddon(spec, { slides = 0, addons = [] } = {}) {
  const s = spec && typeof spec === 'object' ? spec : {};
  const kind = KINDS.includes(s.kind) ? s.kind : null;
  if (!kind) throw new Error('Pick a clip, a transition, music or b-roll.');
  const file = typeof s.file === 'string' && path.isAbsolute(s.file) ? s.file : null;
  if (!file || !exists(file)) throw new Error('That file isn\'t there.');
  references.assertNotReference(file);
  if (kind === 'music' ? !AUDIO_RE.test(file) : !VIDEO_RE.test(file)) throw new Error(kind === 'music' ? 'Music is a sound file.' : 'That needs a video.');
  const text = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
  const out = { kind, title: text(s.title, LIMITS.title) || path.basename(file).replace(/\.[^.]+$/, ''), duration: Number(s.duration) > 0 ? r3(Number(s.duration)) : null };
  const under = kind === 'music' && typeof s.under === 'string' && s.under ? s.under : null;
  if (under) {
    const host = addons.find((a) => a.id === under);
    if (!host || !(host.kind === 'clip' || (host.kind === 'transition' && host.style !== 'overlay'))) throw new Error('Music goes under a slide or under an inserted clip.');
    out.under = under;
  } else {
    // slide 0 (a cold open) is the storyboard's alone (plannedAddon): an add-on of the user's goes after a slide
    const n = Number(s.slide);
    if (!Number.isInteger(n) || n < 1 || (slides && n > slides)) throw new Error(slides ? `Pick a slide from 1 to ${slides}.` : 'Pick a slide.');
    out.slide = n;
  }
  if (kind === 'clip' || kind === 'broll') {
    const phrase = text(s.phrase, LIMITS.phrase).replace(/^["“”']+|["“”']+$/g, '');
    if (phrase) out.phrase = phrase;
  }
  if (kind === 'clip') out.sound = s.sound === 'mute' ? 'mute' : 'keep';
  if (kind === 'broll' && s.seconds != null && s.seconds !== '') {
    const secs = Number(s.seconds);
    if (!(secs >= LIMITS.seconds[0] && secs <= LIMITS.seconds[1])) throw new Error('B-roll runs from half a second to two minutes.');
    out.seconds = r3(secs);
  }
  if (kind === 'transition') {
    const cut = Number(s.cut);
    out.style = s.style === 'overlay' && Number.isFinite(cut) && cut >= 0 ? 'overlay' : 'card';
    if (out.style === 'overlay') {
      out.cut = r3(cut);
      if (slides && out.slide >= slides) throw new Error('A glitch goes over the cut between two slides: pick one before the last.');
    }
    if (typeof s.group === 'string' && s.group) out.group = text(s.group, 60);
  }
  if (kind === 'music' && typeof s.credit === 'string' && s.credit.trim()) out.credit = s.credit.trim().slice(0, LIMITS.credit);
  if (kind === 'music' && typeof s.changes === 'string' && s.changes.trim()) out.changes = s.changes.trim().slice(0, 1000); // to the file itself (CC BY)
  if (s.from && typeof s.from === 'object') {
    out.from = { kind: ['library', 'addons', 'file'].includes(s.from.kind) ? s.from.kind : 'file', id: text(s.from.id, 100) || null, name: text(s.from.name, 200) || path.basename(file) };
  }
  return out;
}

/**
 * A planned row: a piece between slides from the storyboard (interstitials.js), spliced like a clip after slide N
 * (0: a cold open) at its own level, with its seams. `file` is relative to presentation/ (the record keeps it so);
 * `sha` is its render's (a new render makes Refine's outputs out of date); `music` says it has music of its own; `credit`
 * is its music's (score.json), for the credits. Throws a plain message on anything wrong.
 */
function plannedAddon(spec) {
  const s = spec && typeof spec === 'object' ? spec : {};
  const src = s.source && typeof s.source === 'object' ? s.source : {};
  if (src.kind !== 'jsscene' || !SOURCE_ID.test(String(src.id))) throw new Error('A planned piece needs its id.');
  const file = typeof s.file === 'string' ? s.file.replace(/\\/g, '/') : '';
  if (!/^media\/jsscene_[A-Za-z0-9_-]{1,64}\.mp4$/.test(file)) throw new Error('A planned piece plays its own render.');
  const n = Number(s.slide);
  if (!Number.isInteger(n) || n < 0) throw new Error('A planned piece goes before slide 1 or after a slide.');
  const text = (v, k) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, k) : '');
  const seam = s.seam && typeof s.seam === 'object' ? s.seam : {};
  return {
    id: `j:${src.id}`, kind: 'clip', planned: true, title: text(s.title, LIMITS.title) || String(src.id), file, slide: n, sound: 'keep', level: 'own',
    seam: { in: SEAMS.includes(seam.in) ? seam.in : 'cut', out: SEAMS.includes(seam.out) ? seam.out : 'cut' },
    source: { kind: 'jsscene', id: String(src.id), ...(typeof src.shot === 'string' && /^s[1-9][0-9]{0,3}$/.test(src.shot) ? { shot: src.shot } : {}) },
    sha: typeof s.sha === 'string' && /^[0-9a-f]{8,128}$/.test(s.sha) ? s.sha : null,
    music: s.music === true,
    credit: s.credit && typeof s.credit === 'object' ? s.credit : null,
    duration: Number(s.duration) > 0 ? r3(Number(s.duration)) : null,
  };
}

/** Where an add-on goes, in a few words ("after slide 3", "under slide 5", "before slide 1"). */
function where(a, addons = []) {
  const q = (p) => `“${p}”`;
  if (a.kind === 'music') {
    if (a.under) { const h = addons.find((x) => x.id === a.under); return `under ${h ? q(h.title) : 'a clip'}`; }
    return `under slide ${a.slide}`;
  }
  if (a.kind === 'transition') return a.style === 'overlay' ? `cut ${a.slide} → ${a.slide + 1}` : `after slide ${a.slide}`;
  if (a.kind === 'broll') return `over slide ${a.slide}${a.phrase ? `, from ${q(a.phrase)}` : ''}${a.seconds ? `, ${a.seconds} s` : ''}`;
  if (Number(a.slide) === 0) return 'before slide 1';
  return a.phrase ? `slide ${a.slide}, after ${q(a.phrase)}` : `after slide ${a.slide}`;
}

/** What the refined outputs were made from: they count only while the add-ons and the film are the same. */
function addonsKey(addons) {
  // a planned row adds what makes it (its seams, its render's hash); the user's add-ons keep 0.7.1's keys
  const keep = (a) => ({ id: a.id, kind: a.kind, file: a.file, slide: a.slide || null, under: a.under || null, phrase: a.phrase || '', sound: a.sound || null,
    seconds: a.seconds || null, style: a.style || null, cut: a.cut != null ? a.cut : null,
    ...(a.planned ? { planned: true, source: a.source || null, level: a.level || null, seam: seamOf(a), sha: a.sha || null } : {}) });
  return sha1(JSON.stringify((addons || []).map(keep)));
}
function filmKey(file) {
  try { const s = fs.statSync(file); return `${s.size}:${Math.round(s.mtimeMs)}`; } catch { return null; }
}

// ── narration and phrases ────────────────────────────────────────────────────────────────────────────────────

const norm = (s) => String(s).toLowerCase().replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * A phrase in a slide's word timings ([{text, start, end}], as real-words.py writes them): punctuation and case
 * ignored, the first place it occurs. Returns { start, end, next } (seconds into the narration) or null.
 */
function findPhrase(words, phrase) {
  const want = norm(phrase).split(' ').filter(Boolean);
  if (!want.length || !Array.isArray(words)) return null;
  const toks = [];
  const owner = [];
  words.forEach((w, i) => norm(w.text || w.word || '').split(' ').filter(Boolean).forEach((t) => { toks.push(t); owner.push(i); }));
  for (let i = 0; i + want.length <= toks.length; i++) {
    if (want.every((t, j) => toks[i + j] === t)) {
      const a = owner[i];
      const b = owner[i + want.length - 1];
      const next = words[b + 1];
      return { start: Number(words[a].start), end: Number(words[b].end), next: next ? Number(next.start) : null };
    }
  }
  return null;
}

/** The narration of slide n in script.md, the way retime.py reads it (stage notes left out). */
function slideNarration(script, n) {
  const m = new RegExp(`^## SLIDE ${n}\\b[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(String(script || ''));
  return m ? m[1].split('\n').filter((l) => !l.startsWith('>')).join('\n') : null;
}

/** A WAV's length in seconds, from its header (PCM, as the pipeline writes them), or null. */
function wavSeconds(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(4096);
    const n = fs.readSync(fd, head, 0, head.length, 0);
    if (head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE') return null;
    let off = 12;
    let byteRate = null;
    while (off + 8 <= n) {
      const id = head.toString('ascii', off, off + 4);
      const size = head.readUInt32LE(off + 4);
      if (id === 'fmt ') byteRate = head.readUInt32LE(off + 16);
      if (id === 'data') return byteRate ? size / byteRate : null;
      off += 8 + size + (size % 2);
    }
    return null;
  } catch { return null; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

/**
 * Slide n's narration WAV in the pipeline's audio cache: the voice the timeline was made with (the Mac's `say` for a
 * draft, the real voice for a film), and of those the one whose length is the timeline's narration time.
 */
function narrationWav(pres, n, { draft, seconds }) {
  const cache = path.join(pres, 'video', 'cache', 'audio');
  let engines = [];
  try { engines = fs.readdirSync(cache).filter((e) => e !== 'padded' && (e === 'say') === Boolean(draft)); } catch { return null; }
  const found = [];
  for (const e of engines) {
    let names = [];
    try { names = fs.readdirSync(path.join(cache, e)).filter((f) => f.endsWith('.json')); } catch { continue; }
    for (const f of names) {
      const meta = readJson(path.join(cache, e, f));
      const wav = path.join(cache, e, f.replace(/\.json$/, '.wav'));
      if (!meta || !new RegExp(`^slide\\s+${n}$`).test(String(meta.item || '').trim()) || !exists(wav)) continue;
      found.push({ wav, created: String(meta.created || ''), secs: wavSeconds(wav) });
    }
  }
  if (!found.length) return null;
  const exact = seconds ? found.filter((x) => x.secs != null && Math.abs(x.secs - seconds) < 0.02) : [];
  return (exact.length ? exact : found).sort((a, b) => b.created.localeCompare(a.created))[0].wav;
}

/**
 * Word timings for slide n (the method's real-words.py on its narration WAV), cached in presentation/refine/words/.
 * Returns [{text, start, end}] or null (no audio, no narration, or the aligner failed).
 */
async function slideWords({ pres, n, draft, seconds, python, realWords, env, signal }) {
  const script = (() => { try { return fs.readFileSync(path.join(pres, 'script.md'), 'utf8'); } catch { return ''; } })();
  const text = slideNarration(script, n);
  const wav = text ? narrationWav(pres, n, { draft, seconds }) : null;
  if (!wav || !python || !realWords || !exists(realWords)) return null;
  const dir = path.join(pres, 'refine', 'words');
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `slide_${String(n).padStart(2, '0')}`);
  const st = fs.statSync(wav);
  const key = sha1(`${wav}\n${st.size}\n${Math.round(st.mtimeMs)}\n${text}`);
  const cached = readJson(`${base}.json`);
  if (cached && cached.key === key && Array.isArray(cached.words)) return cached.words;
  fs.writeFileSync(`${base}.txt`, text);
  const r = await runScript(python, realWords, [wav, `${base}.txt`, `${base}.words.json`], { writable: [dir], env, signal });
  const words = r.code === 0 ? readJson(`${base}.words.json`) : null;
  if (!Array.isArray(words) || !words.length) return null;
  fs.writeFileSync(`${base}.json`, JSON.stringify({ key, wav: path.basename(wav), words }));
  return words;
}

// ── the plan ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The film's chapters (slides and cut scenes) in play order, on its frame grid. */
function filmChapters(timeline) {
  const rows = Array.isArray(timeline.chapters) && timeline.chapters.length ? timeline.chapters
    : (timeline.slides || []).map((s) => ({ ...s, kind: 'slide' }));
  let f = 0;
  return rows.map((r) => {
    const frames = Number.isInteger(r.frames) && r.frames > 0 ? r.frames : Math.round(Number(r.duration) * FPS);
    const c = { ...r, kind: r.kind === 'cutscene' ? 'cutscene' : 'slide', f0: f, f1: f + frames, frames };
    f += frames;
    return c;
  });
}

/**
 * The pipeline's own leads, as n → seconds: 0.5 s before slide 1's narration and after a cut scene, none elsewhere. A
 * spliced chapter (anything Refine or the splice put in after the pipeline) gave the slide after it no lead (K5).
 */
function narrationLead(chapters) {
  const slides = chapters.filter((c) => c.kind === 'slide');
  const first = slides.length ? Math.min(...slides.map((s) => Number(s.n))) : 1;
  const afterCut = new Set(chapters.filter((c) => c.kind === 'cutscene' && !c.spliced).map((c) => Number(c.after_slide)));
  return (n) => (Number(n) === first || afterCut.has(Number(n) - 1) ? 0.5 : 0);
}

/**
 * Plan the refined video: where every add-on lands on the film's frame grid, the pieces in play order, the music
 * beds, and the refined timeline's chapters. Pure: the inputs are the film's timeline, the add-ons (each with an
 * absolute `path`), each file's probe (`media[path]`: { duration, video, audio }) and word timings (`words[n]`).
 *
 * Pieces: { type: 'film', f0, f1, broll? } (the film's own frames, or a b-roll's picture over the film's sound),
 * { type: 'insert', a, offset, total } (a clip or a card), { type: 'black' } (a planned row's `black` seam) and
 * { type: 'hold', frame, from, holdTotal, fade } (the film's next frame, held, fading up after a `fade`, after an
 * insert); any of them may carry an overlay (a glitch). `video` names the output in its timeline.
 */
function plan({ timeline, addons, media = {}, words = {}, title = '', video = 'presentation_refined.mp4' }) {
  const notes = [];
  const chapters = filmChapters(timeline);
  const slides = chapters.filter((c) => c.kind === 'slide');
  const total = chapters.length ? chapters[chapters.length - 1].f1 : 0;
  const slideOf = (n) => slides.find((s) => Number(s.n) === Number(n)) || null;
  const lead = narrationLead(chapters);
  const framesOf = (a) => { const m = media[a.path] || {}; return Math.max(1, Math.round((Number(m.duration) || Number(a.duration) || 0) * FPS)); };
  const phraseAt = (a, s) => {
    const hit = a.phrase ? findPhrase(words[s.n], a.phrase) : null;
    if (a.phrase && !hit) notes.push(`“${a.phrase}” isn't in slide ${s.n}'s narration${words[s.n] ? '' : ' (no word timings)'}, so ${a.title} ${a.kind === 'broll' ? 'starts with the slide' : 'plays after the slide'}.`);
    return hit;
  };

  // 1. Where each add-on lands on the film: inserts at a frame, b-roll windows, glitch cuts (beds come later).
  const inserts = [];
  const brolls = [];
  const glitches = [];
  for (const a of addons) {
    if (a.kind === 'music') continue;
    if (a.kind === 'clip' && a.planned && Number(a.slide) === 0) { // a cold open, before the film's first frame
      inserts.push({ at: 0, a, frames: framesOf(a), sound: a.sound || 'keep', card: false, mid: false, slide: 0 });
      continue;
    }
    const s = slideOf(a.slide);
    if (!s) { notes.push(`${a.title}: slide ${a.slide} isn't in the film, so it's left out.`); continue; }
    if (a.kind === 'transition' && a.style === 'overlay') {
      if (!slideOf(Number(a.slide) + 1) || s.f1 >= total) { notes.push(`${a.title}: there's no slide after ${a.slide}, so it's left out.`); continue; }
      glitches.push({ cut: s.f1, a });
      continue;
    }
    if (a.kind === 'broll') {
      const hit = phraseAt(a, s);
      const f0 = hit ? clamp(s.f0 + Math.round((lead(s.n) + hit.start - T.brollLead) * FPS), s.f0, s.f1 - 1) : s.f0;
      const want = a.seconds ? Math.round(a.seconds * FPS) : framesOf(a);
      const f1 = Math.min(f0 + want, s.f1);
      if (f1 - f0 < 6) { notes.push(`${a.title}: too little of slide ${a.slide} is left for it, so it's left out.`); continue; }
      if (f0 + want > s.f1) notes.push(`${a.title} stops where slide ${a.slide} ends.`);
      brolls.push({ f0, f1, a });
      continue;
    }
    // A clip or a spoken card: after the slide, or (a clip) right after a phrase, in the pause that follows it.
    let at = s.f1;
    if (a.kind === 'clip' && a.phrase) {
      const hit = phraseAt(a, s);
      if (hit) {
        const gap = hit.next != null ? hit.next - hit.end : T.phraseGap * 2;
        const t = lead(s.n) + hit.end + (gap > 0.1 ? Math.min(T.phraseGap, gap / 2) : 0.05);
        at = clamp(s.f0 + Math.round(t * FPS), s.f0 + 1, s.f1);
      }
    }
    inserts.push({ at, a, frames: framesOf(a), sound: a.kind === 'clip' ? (a.sound || 'keep') : 'keep', card: a.kind === 'transition', mid: at < s.f1, slide: Number(s.n) });
  }
  // B-roll windows never overlap (a later one starts where the earlier one ends), and an insert inside one ends it.
  brolls.sort((x, y) => x.f0 - y.f0);
  for (let i = 1; i < brolls.length; i++) {
    if (brolls[i].f0 >= brolls[i - 1].f1) continue;
    brolls[i].f0 = brolls[i - 1].f1;
    if (brolls[i].f1 - brolls[i].f0 < 6) { notes.push(`${brolls[i].a.title} overlaps ${brolls[i - 1].a.title}, so it's left out.`); brolls.splice(i, 1); i -= 1; }
  }
  for (const b of brolls) for (const ins of inserts) if (ins.at > b.f0 && ins.at < b.f1) b.f1 = ins.at;

  // 2. The film cut at every insert point and b-roll edge; inserts in their order (cards lead in) and, after them,
  // a short breath of the film's next frame before it carries on.
  // (Cut at every chapter too, so each piece of film belongs to one chapter of the refined timeline.)
  const points = [...new Set([0, total, ...chapters.map((c) => c.f0), ...inserts.map((x) => x.at), ...brolls.flatMap((b) => [b.f0, b.f1])])].filter((x) => x >= 0 && x <= total).sort((x, y) => x - y);
  const order = new Map(addons.map((a, i) => [a.id, i]));
  const at = new Map();
  for (const ins of inserts) at.set(ins.at, [...(at.get(ins.at) || []), ins]);
  for (const list of at.values()) list.sort((x, y) => (x.card === y.card ? order.get(x.a.id) - order.get(y.a.id) : (x.card ? -1 : 1)));
  const chapterOf = (f) => chapters.find((c) => f >= c.f0 && f < c.f1) || chapters[chapters.length - 1];
  const breath = Math.round(T.breath * FPS);
  const blackFrames = Math.round(T.black * FPS);
  const segs = [];
  const block = (p) => {
    const list = at.get(p);
    if (!list) return;
    // A clip at a slide's end is a chapter of its own (each clip its own); cards lead into whatever comes next;
    // mid-slide, they're all the slide's.
    const mid = list[0].mid ? `film:${chapterOf(p - 1).f0}` : null;
    let owner = 'next';
    let lastOut = 'fade';
    for (const ins of list) {
      owner = mid || (ins.card ? 'next' : `insert:${ins.a.id}`);
      // a planned row's seams: `black` is 0.5 s of black and silence on that side, in the piece's own chapter
      const seam = seamOf(ins.a);
      const slug = () => ({ type: 'black', a: ins.a, frames: blackFrames, slide: ins.slide, owner, host: p });
      if (seam.in === 'black') segs.push(slug());
      segs.push({ type: 'insert', a: ins.a, path: ins.a.path, frames: ins.frames, offset: 0, total: ins.frames, sound: ins.sound, card: ins.card, slide: ins.slide, owner, host: p, seam });
      if (seam.out === 'black') segs.push(slug());
      lastOut = seam.out;
    }
    // The breath holds what comes next: the film's frame, or a b-roll's first frame when one starts right there. It
    // fades up only after a `fade` (as every add-on of the user's ends); after a `cut` or `black` it is held as it is.
    // A cold open has none unless it fades out: slide 1 has its own lead.
    const b = brolls.find((x) => x.f0 === p);
    if (p < total && (p > 0 || lastOut === 'fade')) segs.push({ type: 'hold', frame: p, frames: breath, from: 0, holdTotal: breath, owner, host: p, broll: b ? { a: b.a, path: b.a.path } : null, fade: lastOut === 'fade' });
  };
  block(0); // a cold open plays before the film's first frame
  for (let i = 0; i + 1 < points.length; i++) {
    const [f0, f1] = [points[i], points[i + 1]];
    const b = brolls.find((x) => f0 >= x.f0 && f1 <= x.f1);
    segs.push({ type: 'film', f0, f1, frames: f1 - f0, broll: b ? { a: b.a, path: b.a.path, offset: f0 - b.f0, total: b.f1 - b.f0 } : null, owner: `film:${chapterOf(f0).f0}` });
    block(f1);
  }
  for (let i = segs.length - 1; i >= 0; i--) {
    if (segs[i].owner === 'next') segs[i].owner = (segs.slice(i + 1).find((x) => x.owner !== 'next') || { owner: `film:${chapters[chapters.length - 1].f0}` }).owner;
  }
  let out = 0;
  for (const s of segs) { s.o0 = out; out += s.frames; s.o1 = out; }
  const frames = out;
  // A film frame on the output grid: a window's start comes after the inserts placed at it, its end before them.
  const inserted = (f, inclusive) => segs.filter((s) => s.type !== 'film' && (inclusive ? s.host <= f : s.host < f)).reduce((n, s) => n + s.frames, 0);
  const mapStart = (f) => f + inserted(f, true);
  const mapEnd = (f) => f + inserted(f, false);

  // 3. Glitch overlays, on the output grid: the cut is where slide N's film ends (before anything inserted there).
  const overlays = [];
  for (const g of glitches.sort((x, y) => x.cut - y.cut)) {
    const len = framesOf(g.a);
    const cutF = clamp(Math.round((Number(g.a.cut) || 0) * FPS), 0, len);
    let o0 = mapEnd(g.cut) - cutF;
    let skip = 0;
    if (o0 < 0) { skip = -o0; o0 = 0; }
    const o1 = Math.min(o0 + len - skip, frames);
    if (overlays.some((x) => o0 < x.o1 && x.o0 < o1)) { notes.push(`${g.a.title} would overlap another glitch, so it's left out.`); continue; }
    if (o1 > o0) overlays.push({ a: g.a, path: g.a.path, o0, o1, skip, total: len });
  }
  const edges = [...new Set(overlays.flatMap((x) => [x.o0, x.o1]))];
  const pieces = [];
  for (const s of segs) {
    const bounds = [s.o0, ...edges.filter((e) => e > s.o0 && e < s.o1).sort((x, y) => x - y), s.o1];
    for (let i = 0; i + 1 < bounds.length; i++) {
      const [p0, p1] = [bounds[i], bounds[i + 1]];
      const d = p0 - s.o0;
      const piece = { ...s, o0: p0, o1: p1, frames: p1 - p0 };
      if (s.type === 'film') { piece.f0 = s.f0 + d; piece.f1 = piece.f0 + piece.frames; if (s.broll) piece.broll = { ...s.broll, offset: s.broll.offset + d }; }
      if (s.type === 'insert') piece.offset = s.offset + d;
      if (s.type === 'hold') piece.from = s.from + d;
      const ov = overlays.find((x) => p0 >= x.o0 && p1 <= x.o1);
      if (ov) piece.overlay = { a: ov.a, path: ov.path, offset: ov.skip + (p0 - ov.o0), total: ov.total };
      pieces.push(piece);
    }
  }

  // 4. Music beds, on the output grid: under a slide (with whatever plays inside it), or under an inserted clip.
  const beds = [];
  for (const a of addons.filter((x) => x.kind === 'music')) {
    let o0;
    let o1;
    if (a.under) {
      const host = segs.find((s) => s.type === 'insert' && s.a.id === a.under);
      if (!host) { notes.push(`${a.title}: the clip it goes under isn't in the video, so it's left out.`); continue; }
      [o0, o1] = [host.o0, host.o1];
    } else {
      const s = slideOf(a.slide);
      if (!s) { notes.push(`${a.title}: slide ${a.slide} isn't in the film, so it's left out.`); continue; }
      [o0, o1] = [mapStart(s.f0), mapEnd(s.f1)];
    }
    if ((o1 - o0) / FPS < T.minBed) { notes.push(`${a.title}: too short a stretch for music, so it's left out.`); continue; }
    beds.push({ a, path: a.path, o0, o1, frames: o1 - o0 });
  }

  // 5. The refined timeline: the film's chapters moved along; a clip inserted at a slide's end is a chapter of its
  // own, as the pipeline's cut scenes are.
  const rows = [];
  let r = 0;
  for (const s of segs) {
    const last = rows[rows.length - 1];
    if (last && last.key === s.owner) { last.frames += s.frames; continue; }
    if (s.owner.startsWith('insert:')) {
      const ins = segs.find((x) => x.type === 'insert' && `insert:${x.a.id}` === s.owner);
      r += 1;
      // `spliced`: put in after the pipeline (the slide after it has no lead of its own); a planned row keeps its id
      const src = ins.a.planned && ins.a.source ? ins.a.source : null;
      rows.push({ key: s.owner, o0: s.o0, frames: s.frames, row: { kind: 'cutscene', id: src ? src.id : `R${r}`, title: ins.a.title, label: ins.a.title, after_slide: ins.slide, placeholder: false,
        media: path.basename(ins.a.path), spliced: true, ...(src ? { planned: true, source: src, seam: seamOf(ins.a) } : {}) } });
    } else {
      const { f0, f1, frames: f, ...row } = chapters.find((c) => `film:${c.f0}` === s.owner); // eslint-disable-line no-unused-vars
      rows.push({ key: s.owner, o0: s.o0, frames: s.frames, row });
    }
  }
  const chaptersOut = rows.map(({ o0, frames: f, row }) => ({ ...row, start: r3(o0 / FPS), duration: r3(f / FPS), frames: f }));
  // 6. Where each add-on landed on the output, and where the film's own frames went ([film frame, output frame,
  // frames]): the clip guide's timecodes come from these.
  const landed = {};
  const span = (id, o0, o1) => { const x = landed[id]; landed[id] = x ? [Math.min(x[0], o0), Math.max(x[1], o1)] : [o0, o1]; };
  for (const s of segs) {
    if (s.type === 'insert') span(s.a.id, s.o0, s.o1);
    if (s.type === 'film' && s.broll) span(s.broll.a.id, s.o0, s.o1);
  }
  for (const x of overlays) span(x.a.id, x.o0, x.o1);
  for (const b of beds) span(b.a.id, b.o0, b.o1);
  const map = [];
  for (const s of segs.filter((x) => x.type === 'film')) {
    const last = map[map.length - 1];
    if (last && last[0] + last[2] === s.f0 && last[1] + last[2] === s.o0) last[2] += s.frames;
    else map.push([s.f0, s.o0, s.frames]);
  }
  const refined = {
    video, draft: Boolean(timeline.draft), created: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), fps: FPS,
    total_duration: r3(frames / FPS),
    slides: chaptersOut.filter((c) => c.kind === 'slide'),
    cutscenes: chaptersOut.filter((c) => c.kind === 'cutscene'),
    chapters: chaptersOut,
    refined: { from: timeline.video || 'presentation.mp4', title, map,
      addons: addons.map((a) => ({ id: a.id, kind: a.kind, title: a.title, where: where(a, addons), ...(landed[a.id] ? { at: landed[a.id].map((f) => r3(f / FPS)) } : {}) })) },
  };
  return { fps: FPS, filmFrames: total, frames, pieces, beds, overlays, inserts: inserts.map((x) => ({ id: x.a.id, at: x.at, frames: x.frames })),
    brolls: brolls.map((b) => ({ id: b.a.id, f0: b.f0, f1: b.f1 })), timeline: refined, notes };
}

// ── the ffmpeg command ───────────────────────────────────────────────────────────────────────────────────────

// A clip conformed to the film: 30 fps from its own time 0, 1920x1080 (a cut scene keeps all its picture, letterboxed
// if it must be; b-roll fills the frame, cropped), bt709, yuv420p.
const VCONFORM = `fps=fps=${FPS}:start_time=0,scale=w=1920:h=1080:force_original_aspect_ratio=decrease:flags=lanczos:out_color_matrix=bt709:out_range=tv,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p`;
const VCOVER = `fps=fps=${FPS}:start_time=0,scale=w=1920:h=1080:force_original_aspect_ratio=increase:flags=lanczos:out_color_matrix=bt709:out_range=tv,crop=1920:1080,setsar=1,format=yuv420p`;
const AFORMAT = `aformat=sample_fmts=fltp:sample_rates=${SR}:channel_layouts=stereo`;
const ACONFORM = `aresample=${SR}:first_pts=0,${AFORMAT}`;
const SILENCE = `anullsrc=channel_layout=stereo:sample_rate=${SR},${AFORMAT}`;
const TO_RGB = 'scale=in_color_matrix=bt709:in_range=tv,format=gbrp';
const TO_YUV = 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p';
const VTB = `settb=1/${FPS},setpts=N`; // exact frame times
const ATB = `asetpts=N/${SR}/TB`; // exact sample times
const f3 = (x) => String(Math.round(x * 1000) / 1000);
const f6 = (x) => x.toFixed(6);

/**
 * The ffmpeg arguments for a plan: the film once, one input per add-on (music looped), one filter graph, two outputs
 * (the refined MP4 and the CapCut-safe master; the MP4 alone when `out.master` is null). `gains[addon id]` is the gain
 * (dB) for that add-on's sound. `nudge` 'film' (the default) builds the master's sound as its own chain: the film's
 * sound 20 ms late, every insert's (a piece's stem, a clip's, a card's) on its picture; 'global' is 0.7.1's (the whole
 * mix 20 ms late).
 */
function ffmpegArgs(p, { film, gains = {}, media = {}, out, nudge = 'film' }) {
  const N = p.frames;
  const inputs = [film];
  const byKey = new Map();
  const input = (key, file, loop = false) => {
    if (!byKey.has(key)) { byKey.set(key, inputs.length); inputs.push(loop ? { file, loop: true } : file); }
    return byKey.get(key);
  };
  const g = [];
  const L = (s) => g.push(s);
  const gainOf = (id) => clamp(Number(gains[id]) || 0, LIMITS.gainDb[0], LIMITS.gainDb[1]);
  const hasAudio = (file) => !media[file] || media[file].audio !== false;
  const pad = (frames) => `tpad=stop_mode=clone:stop_duration=${f3(frames / FPS + 1)},trim=end_frame=${frames},${VTB}`;
  const master = Boolean(out && out.master);
  const own = master && nudge !== 'global'; // the master's sound built piece by piece
  const nudgeSamples = Math.round((T.nudgeMs / 1000) * SR);
  // Each source (an add-on's picture or sound, a held frame) is prepared once, then cut into the pieces using it.
  const sources = new Map();
  const source = (key, make) => { if (!sources.has(key)) sources.set(key, { i: sources.size, uses: [], ...make() }); return sources.get(key); };
  const cut = (src, piece, offset) => { const label = `s${src.i}u${src.uses.length}`; src.uses.push({ piece, offset, label }); return label; };
  const afades = (total, din, dout = din) => `afade=t=in:st=0:d=${din},afade=t=out:st=${f3(total / FPS - dout)}:d=${dout}`;
  let fv = 0;
  let fa = 0;
  let fm = 0;
  const labels = p.pieces.map((x, i) => {
    let v;
    let a;
    let am = null; // this piece's sound in the master (its own chain only)
    if (x.type === 'film') {
      if (x.broll) {
        const n = input(`b:${x.broll.a.id}`, x.broll.path);
        v = cut(source(`bv:${x.broll.a.id}`, () => ({ type: 'v', from: `[${n}:v]${VCOVER},${pad(x.broll.total)}` })), x, x.broll.offset);
      } else {
        L(`[fv${fv++}]trim=start=${f3((x.f0 - 0.5) / FPS)}:end=${f3((x.f1 - 0.5) / FPS)},${VTB}[pv${i}]`);
        v = `pv${i}`;
      }
      const prev = p.pieces[i - 1];
      const next = p.pieces[i + 1];
      const fades = [prev && prev.type !== 'film' ? `afade=t=in:st=0:d=${T.declick}` : null,
        next && (next.type === 'insert' || next.type === 'black') ? `afade=t=out:st=${f3(x.frames / FPS - T.declick)}:d=${T.declick}` : null].filter(Boolean);
      const tail = `apad,atrim=end_sample=${x.frames * SPF}${fades.length ? `,${fades.join(',')}` : ''}`;
      L(`[fa${fa++}]atrim=start=${f6(x.f0 / FPS)}:end=${f6(x.f1 / FPS)},${AFORMAT},${ATB},${tail}[pa${i}]`);
      a = `pa${i}`;
      if (own) { // the film's sound, already 20 ms late (the [fm] chain), cut on the same samples
        L(`[fm${fm++}]atrim=start_sample=${x.f0 * SPF}:end_sample=${x.f1 * SPF},${ATB},${tail}[pm${i}]`);
        am = `pm${i}`;
      }
    } else if (x.type === 'hold') {
      const hold = `setpts=PTS-STARTPTS,loop=loop=-1:size=1:start=0,trim=end_frame=${x.holdTotal},${VTB}${x.fade === false ? '' : `,fade=t=in:st=0:d=${f3(x.holdTotal / FPS)}`}`;
      const src = source(`h:${x.frame}:${x.fade === false ? 'held' : 'fade'}`, () => ({ type: 'v', from: x.broll
        ? `[${input(`hb:${x.broll.a.id}`, x.broll.path)}:v]${VCOVER},trim=end_frame=1,${hold}`
        : `[fv${fv++}]trim=start=${f3((x.frame - 0.5) / FPS)}:end=${f3((x.frame + 0.5) / FPS)},${hold}` }));
      v = cut(src, x, x.from);
      L(`${SILENCE},atrim=end_sample=${x.frames * SPF},${ATB}[pa${i}]`);
      a = `pa${i}`;
      if (own) { L(`${SILENCE},atrim=end_sample=${x.frames * SPF},${ATB}[pm${i}]`); am = `pm${i}`; }
    } else if (x.type === 'black') { // a `black` seam: black picture (bt709, tv range), silence
      L(`color=c=black:s=1920x1080:r=${FPS},format=yuv420p,setsar=1,trim=end_frame=${x.frames},${VTB}[pv${i}]`);
      v = `pv${i}`;
      L(`${SILENCE},atrim=end_sample=${x.frames * SPF},${ATB}[pa${i}]`);
      a = `pa${i}`;
      if (own) { L(`${SILENCE},atrim=end_sample=${x.frames * SPF},${ATB}[pm${i}]`); am = `pm${i}`; }
    } else {
      const n = input(`i:${x.a.id}`, x.path);
      // the picture fades only on a `fade` seam (every add-on of the user's); the sound de-clicks on `cut` and `black`
      const seam = x.seam || { in: 'fade', out: 'fade' };
      const vf = x.card ? [] : [seam.in === 'fade' ? `fade=t=in:st=0:d=${T.insertFade}` : null, seam.out === 'fade' ? `fade=t=out:st=${f3(x.total / FPS - T.insertFade)}:d=${T.insertFade}` : null].filter(Boolean);
      v = cut(source(`iv:${x.a.id}`, () => ({ type: 'v', from: `[${n}:v]${VCONFORM},${pad(x.total)}${vf.length ? `,${vf.join(',')}` : ''}` })), x, x.offset);
      const sound = x.sound !== 'mute' && hasAudio(x.path) ? `[${n}:a]${ACONFORM},volume=${gainOf(x.a.id)}dB` : SILENCE;
      const ad = (s) => (x.card ? T.cardAudioFade : s === 'fade' ? T.insertAudioFade : T.declick);
      const asrc = source(`ia:${x.a.id}`, () => ({ type: 'a', from: `${sound},apad,atrim=end_sample=${x.total * SPF},${ATB},${afades(x.total, ad(seam.in), ad(seam.out))}` }));
      a = cut(asrc, x, x.offset);
      if (own) am = cut(asrc, x, x.offset); // the insert's own sound, on its picture, in the master too
    }
    if (x.overlay) {
      const o = x.overlay;
      const n = input(`o:${o.a.id}`, o.path);
      const ov = cut(source(`ov:${o.a.id}`, () => ({ type: 'v', from: `[${n}:v]${VCONFORM},${pad(o.total)},${TO_RGB}` })), x, o.offset);
      const sound = hasAudio(o.path) ? `[${n}:a]${ACONFORM},volume=${gainOf(o.a.id)}dB` : SILENCE;
      const osrc = source(`oa:${o.a.id}`, () => ({ type: 'a', from: `${sound},apad,atrim=end_sample=${o.total * SPF},${ATB},${afades(o.total, T.declick)}` }));
      const oa = cut(osrc, x, o.offset);
      L(`[${v}]${TO_RGB}[pb${i}]`);
      L(`[pb${i}][${ov}]blend=all_mode=screen:shortest=1,${TO_YUV}[px${i}]`);
      L(`[${a}][${oa}]amix=inputs=2:normalize=0:duration=first:dropout_transition=0,${AFORMAT}[py${i}]`);
      v = `px${i}`;
      a = `py${i}`;
      if (own) {
        L(`[${am}][${cut(osrc, x, o.offset)}]amix=inputs=2:normalize=0:duration=first:dropout_transition=0,${AFORMAT}[pz${i}]`);
        am = `pz${i}`;
      }
    }
    return [v, a, am];
  });
  if (fv) L(`[0:v]split=${fv}${Array.from({ length: fv }, (_, k) => `[fv${k}]`).join('')}`);
  if (fm) L('[0:a]asplit=2[fa_all][fm_all]');
  if (fa) L(`[${fm ? 'fa_all' : '0:a'}]asplit=${fa}${Array.from({ length: fa }, (_, k) => `[fa${k}]`).join('')}`);
  // the film's sound for the master: EDIT_NUDGE_MS of silence first, so every film piece's samples sit 20 ms late
  if (fm) L(`[fm_all]${AFORMAT},${ATB},adelay=delays=${nudgeSamples}S:all=1,${ATB},asplit=${fm}${Array.from({ length: fm }, (_, k) => `[fm${k}]`).join('')}`);
  for (const s of sources.values()) {
    const outs = s.uses.map((_, j) => `[s${s.i}x${j}]`).join('');
    if (s.type === 'v') {
      L(`${s.from},split=${s.uses.length}${outs}`);
      s.uses.forEach((u, j) => L(`[s${s.i}x${j}]trim=start_frame=${u.offset}:end_frame=${u.offset + u.piece.frames},${VTB}[${u.label}]`));
    } else {
      L(`${s.from},asplit=${s.uses.length}${outs}`);
      s.uses.forEach((u, j) => L(`[s${s.i}x${j}]atrim=start_sample=${u.offset * SPF}:end_sample=${(u.offset + u.piece.frames) * SPF},${ATB}[${u.label}]`));
    }
  }

  // Joined, with the music beds under it; then the two outputs.
  L(`${labels.map(([v, a]) => `[${v}][${a}]`).join('')}concat=n=${labels.length}:v=1:a=1[vcat][acat]`);
  if (own) L(`${labels.map(([, , am]) => `[${am}]`).join('')}concat=n=${labels.length}:v=0:a=1[mcat]`);
  const beds = p.beds.map((b, j) => {
    const n = input(`m:${b.a.id}`, b.path, true);
    L(`[${n}:a]${ACONFORM},atrim=end_sample=${b.frames * SPF},${ATB},volume=${gainOf(b.a.id)}dB,afade=t=in:st=0:d=${T.bedFadeIn},afade=t=out:st=${f3(Math.max(0, b.frames / FPS - T.bedFadeOut))}:d=${T.bedFadeOut},adelay=delays=${b.o0 * SPF}S:all=1,apad=whole_len=${N * SPF}${own ? `,asplit=2[bed${j}][bedm${j}]` : `[bed${j}]`}`);
    return j;
  });
  const mix = (from, pre, to) => L(beds.length ? `[${from}]${beds.map((j) => `[${pre}${j}]`).join('')}amix=inputs=${beds.length + 1}:normalize=0:duration=first:dropout_transition=0,${AFORMAT}[${to}]` : `[${from}]${AFORMAT}[${to}]`);
  mix('acat', 'bed', 'amix');
  if (!master) {
    L('[vcat]format=yuv420p[vout1]');
    L(`[amix]apad,atrim=end_sample=${N * SPF},${ATB}[aout1]`);
  } else if (own) {
    L('[vcat]format=yuv420p,split=2[vout1][vout2]');
    mix('mcat', 'bedm', 'mmix');
    L(`[amix]apad,atrim=end_sample=${N * SPF},${ATB}[aout1]`);
    L(`[mmix]apad,atrim=end_sample=${N * SPF},${ATB}[aout2]`);
  } else {
    L('[vcat]format=yuv420p,split=2[vout1][vout2]');
    L(`[amix]apad,atrim=end_sample=${N * SPF},${ATB},asplit=2[aout1][a2]`);
    // The editing master's voice goes 20 ms later (EDIT_NUDGE_MS), as the pipeline's own master does.
    L(`[a2]adelay=delays=${nudgeSamples}S:all=1,atrim=end_sample=${N * SPF},${ATB}[aout2]`);
  }

  const args = ['-hide_banner', '-nostdin', '-y', '-v', 'error', '-progress', 'pipe:1', '-nostats'];
  for (const i of inputs) {
    if (typeof i === 'object') args.push('-stream_loop', '-1', '-i', i.file);
    else args.push('-i', i);
  }
  args.push('-filter_complex', g.join(';\n'), ...outputArgs(N, out));
  return { args, graph: g, inputs: inputs.map((i) => (typeof i === 'object' ? i.file : i)) };
}

/**
 * The two outputs of a graph ending in [vout1][aout1] (the MP4, in the film's own encoding) and [vout2][aout2] (the
 * CapCut-safe master: no B-frames, PCM, no edit lists; left out when `out.master` is null). `frames`: the length
 * (exact: the graph already makes every stream that long).
 */
function outputArgs(frames, out) {
  const d = f6(frames / FPS);
  const mp4 = ['-map', '[vout1]', '-map', '[aout1]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-g', '300',
    '-r', String(FPS), '-fps_mode', 'cfr', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-video_track_timescale', '15360', '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-ar', String(SR), '-movflags', '+faststart', '-t', d, '-f', 'mp4', out.video];
  if (!out.master) return mp4;
  return [...mp4, '-map', '[vout2]', '-map', '[aout2]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-bf', '0', '-g', '30', '-pix_fmt', 'yuv420p',
    '-r', String(FPS), '-fps_mode', 'cfr', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'pcm_s16le', '-ar', String(SR), '-use_editlist', '0', '-t', d, '-f', 'mov', out.master];
}

// ── running it ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * One of the method's standard-library scripts (real-words.py, loudmatch.py, slack_pack.py) on a Python FLPT was
 * handed (the episode's own, maybe): isolated (-I: no PYTHON* variables, no user site, not its own folder on the path)
 * and without site (-S: no site-packages, so no .pth anyone planted there runs), and inside macOS's sandbox where it
 * exists (no network, the key files unreadable, writes only in `writable` and the temporary folders). T18's residual
 * for Refine and Deliver (W2-00 #3). → runTool's { code, out, err }
 */
function runScript(python, script, args, { writable = [], env, signal, onOut } = {}) {
  let cmd = python;
  let argv = ['-I', '-S', script, ...args];
  if (sandbox.available()) {
    try { [cmd, argv] = sandbox.wrap(cmd, argv, { writable }); } catch (e) { return Promise.resolve({ code: 126, out: '', err: `Not run: ${e.message}.` }); }
  }
  return runTool(cmd, argv, { env, signal, onOut });
}

/** Run a tool, collecting its output; the signal stops it. */
function runTool(cmd, args, { env, signal, onOut } = {}) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(cmd, args, { env: env || process.env, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { resolve({ code: 127, out: '', err: e.message }); return; }
    let out = '';
    let err = '';
    child.stdout.on('data', (b) => { out += b; if (onOut) onOut(String(b)); if (out.length > 1 << 20) out = out.slice(-(1 << 19)); });
    child.stderr.on('data', (b) => { err += b; if (err.length > 1 << 20) err = err.slice(-(1 << 19)); });
    const stop = () => child.kill('SIGTERM');
    if (signal) signal.addEventListener('abort', stop, { once: true });
    child.on('error', (e) => resolve({ code: 127, out, err: `${err}${e.message}` }));
    child.on('close', (code) => { if (signal) signal.removeEventListener('abort', stop); resolve({ code: code == null ? 1 : code, out, err }); });
  });
}

/** ffprobe: { duration, video, audio, frames } for a media file, or null. */
async function probeMedia(ffprobe, file, env) {
  const r = await runTool(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { env });
  if (r.code !== 0) return null;
  let j;
  try { j = JSON.parse(r.out); } catch { return null; }
  const st = j.streams || [];
  const v = st.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const a = st.find((s) => s.codec_type === 'audio');
  return { duration: Number(j.format && j.format.duration) || Number(v && v.duration) || Number(a && a.duration) || 0, video: Boolean(v), audio: Boolean(a),
    frames: v && Number(v.nb_frames) ? Number(v.nb_frames) : null, hasBFrames: v ? Number(v.has_b_frames) || 0 : null, vcodec: v ? v.codec_name : null, acodec: a ? a.codec_name : null,
    width: v ? v.width : null, height: v ? v.height : null, fps: v ? v.r_frame_rate : null, audioDuration: a ? Number(a.duration) || null : null, videoDuration: v ? Number(v.duration) || null : null,
    sampleRate: a ? Number(a.sample_rate) : null, channels: a ? a.channels : null };
}

/**
 * EBU R128 loudness of a file's sound, through the same conversion the mix uses: { lufs, tp } (dB; -Infinity for
 * silence), or null. `seconds` measures only the start (the part a bed uses).
 */
async function loudness(ffmpeg, file, { env, seconds, loop = false } = {}) {
  const args = ['-hide_banner', '-nostdin', '-nostats'];
  if (loop) args.push('-stream_loop', '-1');
  args.push('-i', file);
  if (seconds) args.push('-t', f3(seconds));
  args.push('-map', '0:a:0', '-af', `${ACONFORM},ebur128=peak=true`, '-f', 'null', '-');
  const r = await runTool(ffmpeg, args, { env });
  if (r.code !== 0) return null;
  const summary = r.err.slice(r.err.lastIndexOf('Summary:'));
  const num = (m) => (m ? (m[1] === '-inf' ? -Infinity : Number(m[1])) : null);
  const lufs = num(/I:\s+(-?[\d.]+|-inf) LUFS/.exec(summary));
  const tp = num(/True peak:\s+Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(summary));
  return lufs == null ? null : { lufs, tp };
}

/** The gain (dB) that brings a sound to a target loudness, never past -1 dBTP, never wild. */
function gainFor(meas, target) {
  if (!meas || !Number.isFinite(meas.lufs)) return 0;
  let gain = target - meas.lufs;
  if (Number.isFinite(meas.tp)) gain = Math.min(gain, -1 - meas.tp);
  return Math.round(clamp(gain, LIMITS.gainDb[0], LIMITS.gainDb[1]) * 10) / 10;
}

/** True when a QuickTime/MP4 file's movie header holds an edit list (an 'elst' box). */
function hasEditList(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const read = (pos, len) => { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, pos); return b; };
    const walk = (start, end, depth) => {
      let pos = start;
      while (pos + 8 <= end) {
        const h = read(pos, 16);
        let len = h.readUInt32BE(0);
        const type = h.toString('ascii', 4, 8);
        let hdr = 8;
        if (len === 1) { len = Number(h.readBigUInt64BE(8)); hdr = 16; } else if (len === 0) len = end - pos;
        if (len < hdr) return false;
        if (type === 'elst') return true;
        if (['moov', 'trak', 'edts', 'mdia', 'minf', 'stbl'].includes(type) && depth < 6 && walk(pos + hdr, pos + len, depth + 1)) return true;
        pos += len;
      }
      return false;
    };
    return walk(0, size, 0);
  } catch { return null; } finally { if (fd !== undefined) fs.closeSync(fd); }
}

/**
 * The slides whose Live Motion scene plays its own sound under the narration (media.json `flpt-scene` entries with
 * `audio: 'mix'`), and of those the ones with music in it (the scene's score/score.json). Read from the episode's
 * presentation folder as the last run left it. → { sound: Set<n>, music: Set<n> }
 */
function sceneSound(pres) {
  const out = { sound: new Set(), music: new Set() };
  const slides = (readJson(path.join(pres || '', 'media.json')) || {}).slides;
  if (!slides || typeof slides !== 'object') return out;
  for (const [k, e] of Object.entries(slides)) {
    const n = Number(k);
    if (!Number.isInteger(n) || n < 1 || !e || e.note !== 'flpt-scene' || e.audio !== 'mix' || !e.video) continue;
    out.sound.add(n);
    const score = readJson(path.join(pres, 'hyperframes', `slide_${String(n).padStart(2, '0')}`, 'score', 'score.json'));
    if (score && score.music) out.music.add(n);
  }
  return out;
}

/**
 * Where a music bed sits: about -26 LUFS (at least 10 LU under the narration), or -32 under a scene that has its own
 * music (a slide's Live Motion scene, or a planned piece's), with a line saying so. → { target, note }
 */
function bedTarget(a, { filmLufs, music = new Set(), addons = [] }) {
  const base = Math.min(T.bedLufs, filmLufs - 10);
  const host = a.under ? addons.find((x) => x.id === a.under) : null;
  const where = host ? (host.planned && host.music ? `“${host.title}”` : null) : music.has(Number(a.slide)) ? `Slide ${a.slide}` : null;
  if (!where) return { target: base, note: null };
  return { target: Math.min(base, T.sceneBedLufs), note: `${where} has its own music, so ${a.title} sits at ${T.sceneBedLufs} LUFS.` };
}

/**
 * Apply the add-ons to the film (or, with draft, to the free draft: the same shape) and write the refined outputs.
 * Returns { video, master, timeline, frames, seconds, lufs, tp, notes }; throws a plain message.
 *   d.pres          <episode>/presentation
 *   d.film, d.filmTimeline, d.out ({ video, master (null: the MP4 alone), timeline })
 *   d.addons        the episode's add-ons, each with `path` (absolute); planned rows among them (plannedAddon)
 *   d.ffmpeg, d.ffprobe, d.python (the episode's), d.realWords (the method's real-words.py), d.env (PATH)
 *   d.headline      the first log line (the splice says its own); d.meta: more top-level fields for the timeline
 *   d.nudge         'film' (the default) or 'global' (see ffmpegArgs)
 */
async function apply(d) {
  const say = d.onLine || (() => {});
  const { ffmpeg = 'ffmpeg', ffprobe = 'ffprobe', env, signal } = d;
  const timeline = readJson(d.filmTimeline);
  if (!timeline || !Array.isArray(timeline.slides) || !timeline.slides.length) throw new Error('The film has no timeline (presentation.timeline.json): film it again.');
  if (!exists(d.film)) throw new Error('The film isn\'t there.');
  const addons = d.addons || [];
  if (!addons.length) throw new Error('Add something first.');
  for (const a of addons) if (!exists(a.path)) throw new Error(`${a.title}: its file is missing (${path.basename(a.path)}).`);
  // nothing private goes into a video: not the film, not an add-on (W1-12)
  for (const f of [d.film, ...addons.map((a) => a.path)]) references.assertNotReference(f);
  const nudge = d.nudge === 'global' ? 'global' : 'film';

  say(d.headline || `Refine: ${addons.length} add-on${addons.length === 1 ? '' : 's'} on the film (ffmpeg only: nothing is filmed or paid for).`);
  const media = {};
  for (const file of [d.film, ...new Set(addons.map((a) => a.path))]) {
    media[file] = await probeMedia(ffprobe, file, env);
    if (!media[file]) throw new Error(`ffprobe couldn't read ${path.basename(file)}.`);
  }
  if (!media[d.film].video || !media[d.film].audio) throw new Error('The film needs both picture and sound.');
  for (const a of addons) {
    const m = media[a.path];
    if (a.kind === 'music' ? !m.audio : !m.video) throw new Error(`${a.title}: ${a.kind === 'music' ? 'no sound in it' : 'no picture in it'}.`);
  }

  // Word timings, for the add-ons placed on a phrase (moved along by d.mapWords when the film was tightened).
  const words = {};
  for (const n of [...new Set(addons.filter((a) => a.phrase && a.slide).map((a) => Number(a.slide)))]) {
    const s = timeline.slides.find((x) => Number(x.n) === n);
    say(`  timing slide ${n}'s narration…`);
    words[n] = await slideWords({ pres: d.pres, n, draft: Boolean(timeline.draft), seconds: s && s.narration_seconds, python: d.python, realWords: d.realWords, env, signal });
    if (words[n] && d.mapWords) words[n] = d.mapWords(n, words[n]);
  }
  const p = plan({ timeline, addons, media, words, title: d.title || '', video: path.basename(d.out.video) });
  if (d.meta && typeof d.meta === 'object') Object.assign(p.timeline, d.meta);

  // Levels: clips and cards to the narration, glitch sounds a little under it, beds at about -26 LUFS (-32 under a
  // scene with its own music); a planned piece keeps its own (-21 LUFS, the mixer's).
  const film = await loudness(ffmpeg, d.film, { env });
  const filmLufs = film && Number.isFinite(film.lufs) ? film.lufs : -16;
  const scene = sceneSound(d.pres);
  const gains = {};
  const why = [];
  for (const a of addons) {
    if (a.kind === 'broll' || (a.kind === 'clip' && a.sound === 'mute') || !media[a.path].audio) continue;
    if (a.level === 'own') { why.push(`${a.title} at its own level`); continue; }
    const bed = p.beds.find((b) => b.a.id === a.id);
    if (a.kind === 'music' && !bed) continue;
    let target = a.kind === 'transition' && a.style === 'overlay' ? filmLufs - 4 : filmLufs;
    if (a.kind === 'music') {
      const t = bedTarget(a, { filmLufs, music: scene.music, addons });
      target = t.target;
      if (t.note) p.notes.push(t.note);
    }
    const m = await loudness(ffmpeg, a.path, { env, seconds: bed ? bed.frames / FPS : undefined, loop: Boolean(bed) });
    gains[a.id] = gainFor(m, target);
    why.push(`${a.title} ${m && Number.isFinite(m.lufs) ? `${m.lufs.toFixed(1)} LUFS` : 'silent'} → ${gains[a.id] >= 0 ? '+' : ''}${gains[a.id]} dB`);
  }
  for (const n of p.notes) say(`  ! ${n}`);
  say(`  levels: the film ${film ? film.lufs.toFixed(1) : '?'} LUFS; ${why.join('; ') || 'nothing to level'}`);

  const tmp = { video: d.out.video.replace(/\.mp4$/, '.tmp.mp4'), master: d.out.master ? d.out.master.replace(/\.mov$/, '.tmp.mov') : null };
  const { args } = ffmpegArgs(p, { film: d.film, gains, media, out: tmp, nudge });
  say(`  rendering ${(p.frames / FPS).toFixed(1)} s (${p.pieces.length} pieces${p.beds.length ? `, ${p.beds.length} music bed${p.beds.length === 1 ? '' : 's'}` : ''}${p.overlays.length ? `, ${p.overlays.length} overlay${p.overlays.length === 1 ? '' : 's'}` : ''})…`);
  let shown = -1;
  const t0 = Date.now();
  const r = await runTool(ffmpeg, args, { env, signal, onOut: (chunk) => {
    const m = /out_time_us=(\d+)/g;
    let last = null;
    let x;
    while ((x = m.exec(chunk))) last = Number(x[1]);
    if (last == null) return;
    const pct = Math.min(99, Math.floor((last / 1e6 / (p.frames / FPS)) * 10) * 10);
    if (pct > shown) { shown = pct; say(`  ${pct} %`); }
  } });
  const clean = () => { for (const f of Object.values(tmp)) if (f) fs.rmSync(f, { force: true }); };
  if (signal && signal.aborted) { clean(); throw new Error('Stopped.'); }
  if (r.code !== 0) { clean(); throw new Error(`ffmpeg stopped: ${(r.err.trim().split('\n').pop() || `exit ${r.code}`).slice(0, 300)}`); }

  // Check what came out before it replaces anything.
  const want = p.frames / FPS;
  const v = await probeMedia(ffprobe, tmp.video, env);
  const mv = tmp.master ? await probeMedia(ffprobe, tmp.master, env) : null;
  const problems = [];
  if (!v || !v.video || !v.audio) problems.push('the MP4 has no picture or no sound');
  else {
    if (Math.abs(v.duration - want) > 0.1) problems.push(`the MP4 runs ${v.duration.toFixed(2)} s, not ${want.toFixed(2)} s`);
    if (v.frames && v.frames !== p.frames) problems.push(`the MP4 has ${v.frames} frames, not ${p.frames}`);
    if (v.videoDuration && v.audioDuration && Math.abs(v.videoDuration - v.audioDuration) > 0.15) problems.push('its picture and sound differ in length');
  }
  if (tmp.master) {
    if (!mv || !mv.video || mv.acodec !== 'pcm_s16le' || mv.hasBFrames) problems.push('the editing master isn\'t CapCut-safe (PCM sound, no B-frames)');
    else if (mv.frames && mv.frames !== p.frames) problems.push(`the editing master has ${mv.frames} frames, not ${p.frames}`);
    if (hasEditList(tmp.master)) problems.push('the editing master has an edit list');
  }
  if (problems.length) { clean(); throw new Error(`The refined video didn't check out: ${problems.join('; ')}.`); }
  fs.renameSync(tmp.video, d.out.video);
  if (tmp.master) fs.renameSync(tmp.master, d.out.master);
  fs.writeFileSync(d.out.timeline, `${JSON.stringify(p.timeline, null, 2)}\n`);
  const level = await loudness(ffmpeg, d.out.video, { env });
  say(`  ✓ ${path.basename(d.out.video)}: ${want.toFixed(1)} s, ${p.frames} frames, ${level ? `${level.lufs.toFixed(1)} LUFS, peak ${level.tp.toFixed(1)} dBTP` : 'level not measured'} (${Math.round((Date.now() - t0) / 1000)} s)`);
  if (tmp.master) say(`  ✓ ${path.basename(d.out.master)}: no B-frames, PCM sound, no edit lists, voice +20 ms${nudge === 'film' ? ' (the film\'s; inserts on their picture)' : ''}`);
  return { video: d.out.video, master: tmp.master ? d.out.master : null, timeline: d.out.timeline, frames: p.frames, seconds: r3(want),
    lufs: level ? Math.round(level.lufs * 10) / 10 : null, tp: level ? Math.round(level.tp * 10) / 10 : null, notes: p.notes };
}

/** A CC BY track's credit lines, from a score.json `credit` (score.plan) or a shipped item, as one text. */
function creditText(c) {
  if (!c || typeof c !== 'object') return '';
  if (typeof c.text === 'string' && c.text.trim()) return c.text.trim();
  const head = [c.name ? `"${c.name}"` : null, c.author || null].filter(Boolean).join(' ');
  return [head, c.license ? `Licensed under ${c.license}` : null, c.licenseUrl || null, c.source ? `Source: ${c.source}` : null].filter(Boolean).join('\n');
}

/**
 * The CC BY tracks a delivery plays, each once: [{ text (its credit lines), changes (to the shipped file itself), edit
 * (what was done to it in the video: a scene's own words from score.json, such as "edited (trimmed, mixed)", else
 * "edited (trimmed, looped, mixed)"), bed (Refine put it under the narration) }].
 *   addons   the episode's add-ons: Refine's beds and the planned pieces whose score plays a CC BY track (`credit`)
 *   scenes   [{ credit, changes }]: the Live Motion slides' tracks (score.json `credit`)
 * A track used both ways is credited once. music-credits.txt, DESCRIPTION.txt and the player page all say `edit`.
 */
function creditTracks(addons, { scenes = [] } = {}) {
  const tracks = new Map();
  const add = (text, { changes = null, edit = null, bed = false }) => {
    if (!text) return;
    const t = tracks.get(text) || { text, changes: null, edit: null, bed: false };
    t.changes = t.changes || changes;
    t.edit = t.edit || edit;
    t.bed = t.bed || bed;
    tracks.set(text, t);
  };
  for (const a of (addons || []).filter((x) => x.kind === 'music')) {
    add(a.credit || `${a.title} (no credit recorded: add one in Transitions & Music)`, { changes: a.changes || null, bed: true });
  }
  for (const s of [...(addons || []).filter((x) => x.planned && x.credit), ...(scenes || [])]) {
    add(creditText(s.credit), { changes: s.changes || (s.credit && s.credit.changes) || null, edit: (s.credit && s.credit.edit) || null });
  }
  return [...tracks.values()].map((t) => ({ ...t, edit: t.edit || EDITED }));
}

/** music-credits.txt: each track's credit lines and what was done to it (creditTracks), or null with no music. */
function musicCredits(addons, title, { scenes = [] } = {}) {
  const tracks = creditTracks(addons, { scenes });
  if (!tracks.length) return null;
  const blocks = tracks.map((t) => {
    const before = t.changes ? ` The file used: ${t.changes.replace(/\s*No other changes\.?\s*$/, '').replace(/^./, (c) => c.toLowerCase())}` : '';
    return `${t.text}\nChanges: ${t.edit}.${before}`;
  });
  return `Music in "${title}"\n\n${blocks.join('\n\n')}\n`;
}

module.exports = { outputs, cleanAddon, plannedAddon, where, addonsKey, filmKey, findPhrase, slideNarration, wavSeconds, narrationWav, slideWords, filmChapters,
  narrationLead, plan, ffmpegArgs, outputArgs, apply, loudness, gainFor, probeMedia, hasEditList, musicCredits, creditTracks, creditText, sceneSound, bedTarget, runTool, runScript,
  KINDS, T, FPS, SR, SEAMS, EDITED, seamOf };
