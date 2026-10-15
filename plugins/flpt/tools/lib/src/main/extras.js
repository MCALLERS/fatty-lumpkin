'use strict';
// What Deliver hands an editor besides the video, the method's way (references/delivery.md):
//   levels      the episode's extras (Refine's clips, transitions, music and B-roll, the video insets' clips, the cut
//               scenes) in extras/, at the house levels with the method's loudmatch.py: −14 LUFS integrated under a
//               −1 dBTP ceiling, and music twice, as .bed (−26 LUFS) and .full (−16). The main video is never touched:
//               the pipeline levels it.
//   clip guide  CAPCUT_CLIP_GUIDE.md, when the video has clip slots: each one's timecodes in the delivered video, its
//               sound and, for an inset, its rectangle.
//   Slack pack  later, from the user's own export (after their edit): the method's slack_pack.py, beside the rest.
const fs = require('fs');
const path = require('path');
const refine = require('./refine');
const { mapFrame } = require('./tighten');

const { FPS } = refine;
const LEVELLED = /\.(mp4|mov|m4v|m4a|mp3|wav|aif|aiff)$/i; // what loudmatch.py takes
const MEDIA = /\.(mp4|mov|m4v|webm|mkv|avi|m4a|mp3|wav|aif|aiff|aac|flac|ogg)$/i;
const MANIFEST = '.flpt-extras.json'; // in extras/: the files FLPT put there (anything else is the user's)
const KIND = { clip: 'Clip', transition: 'Transition', music: 'Music', broll: 'B-roll' };
const FRAME = { w: 1920, h: 1080 };

const exists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const lastLine = (text) => String(text || '').trim().split('\n').pop().slice(0, 300);
const safeName = (s) => String(s).normalize('NFC').replace(/[/\\:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) || 'extra';
const q = (s) => `“${s}”`;

// ── levels ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The extras an editor may want, as [{ name, src, bed }]: each add-on's file, each inset's clip, each cut scene's
 * video, named for what it is ("Clip - Reaction.mov"). `insets`: [{ n, rel, file }]; `cutscenes`: [{ id, title, file }].
 */
function collect({ pres, addons = [], insets = [], cutscenes = [] }) {
  const out = [];
  const seen = new Set();
  const add = (label, src, bed = false) => {
    if (!src || !exists(src) || seen.has(src) || !MEDIA.test(src)) return;
    seen.add(src);
    const ext = path.extname(src).toLowerCase();
    let name = `${safeName(label)}${ext}`;
    for (let k = 2; out.some((x) => x.name.toLowerCase() === name.toLowerCase()); k++) name = `${safeName(label)} ${k}${ext}`;
    out.push({ name, src, bed });
  };
  for (const a of addons) if (a.file) add(`${KIND[a.kind] || 'Clip'} - ${a.title}`, path.join(pres, a.file), a.kind === 'music');
  for (const i of insets) add(`Slide ${i.n} inset - ${path.basename(i.rel).replace(/\.[^.]+$/, '')}`, i.file);
  for (const c of cutscenes) add(`Cut scene ${c.id} - ${c.title || c.id}`, c.file);
  return out;
}

/** loudmatch.py's names for a music bed: "<stem>.bed<ext>" and "<stem>.full<ext>". */
const bedNames = (name) => { const ext = path.extname(name); const stem = name.slice(0, -ext.length); return [`${stem}.bed${ext}`, `${stem}.full${ext}`]; };

/**
 * Level the extras into `out` (extras/) with loudmatch.py: speech, clips and effects at −14 LUFS, music as .bed and
 * .full. What it can't level (no sound, too short, too quiet to lift safely, a format it doesn't take) goes in as it
 * is. FLPT's files from an earlier delivery go first (its manifest lists them); anything else in extras/ stays.
 * Returns { files, bySrc: { [src]: [names] }, notes }.
 */
async function levelExtras({ items, out, stage, python, script, env, signal, onLine = () => {} }) {
  const manifest = path.join(out, MANIFEST);
  const before = (readJson(manifest) || {}).files || [];
  for (const f of before) if (typeof f === 'string' && f && !/[/\\]/.test(f)) fs.rmSync(path.join(out, f), { force: true });
  if (!items.length) {
    fs.rmSync(manifest, { force: true });
    try { fs.rmdirSync(out); } catch { /* not there, or the user's files are in it */ }
    return { files: [], bySrc: {}, notes: [] };
  }
  fs.mkdirSync(out, { recursive: true });
  const names = (it) => (it.bed && LEVELLED.test(it.name) ? bedNames(it.name) : [it.name]);
  const writeManifest = (files) => fs.writeFileSync(manifest, `${JSON.stringify({ made: 'Fatty Lumpkin Presentation Tool', files }, null, 1)}\n`);
  writeManifest([...new Set(items.flatMap((it) => [...names(it), it.name]))]); // whatever happens next, these are FLPT's
  // loudmatch.py names what it writes after what it reads: each file is linked in under its name in extras/.
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  const report = [];
  try {
    for (const it of items) fs.symlinkSync(it.src, path.join(stage, it.name));
    for (const bed of [false, true]) {
      const group = items.filter((x) => x.bed === bed && LEVELLED.test(x.name));
      if (!group.length) continue;
      onLine(`  levelling ${group.length} ${bed ? 'music bed' : 'extra'}${group.length === 1 ? '' : 's'} (loudmatch.py${bed ? ' --bed' : ''})…`);
      const r = await refine.runTool(python, [script, ...group.map((x) => path.join(stage, x.name)), '--out', out, '--overwrite', ...(bed ? ['--bed'] : [])], { env, signal });
      if (signal && signal.aborted) throw new Error('Stopped.');
      if (r.code !== 0) throw new Error(`loudmatch.py stopped: ${lastLine(r.err) || `exit ${r.code}`}`);
      report.push(...r.out.split('\n'));
    }
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
  const files = [];
  const bySrc = {};
  const notes = [];
  for (const it of items) {
    let made = names(it).filter((f) => exists(path.join(out, f)));
    if (!made.length) {
      fs.copyFileSync(it.src, path.join(out, it.name), fs.constants.COPYFILE_FICLONE);
      made = [it.name];
      const said = report.find((l) => l.startsWith(it.name.slice(0, 52))) || '';
      if (/refused/.test(said)) notes.push(`${it.name} is too quiet to lift safely, so it's in extras/ as it was.`);
      else if (/failed/.test(said)) notes.push(`${it.name} couldn't be levelled, so it's in extras/ as it was.`);
      else if (!LEVELLED.test(it.name)) notes.push(`${it.name} is in extras/ as it was (loudmatch.py doesn't take ${path.extname(it.name)}).`);
    }
    files.push(...made);
    bySrc[it.src] = made;
  }
  writeManifest(files);
  return { files, bySrc, notes };
}

// ── the clip guide ───────────────────────────────────────────────────────────────────────────────────────────

/** m:ss.cc (h:mm:ss.cc from an hour). */
function tc(seconds) {
  const cs = Math.round(Math.max(0, seconds) * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const sec = ((cs % 6000) / 100).toFixed(2).padStart(5, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/**
 * Every clip slot in the delivered video, with its times in it (seconds): the video insets, the cut scenes and
 * Refine's add-ons. Film times are carried through the tightening (its removed frames) and the add-ons (refined.map).
 *   film       the film's timeline; tight: the tightened film's, or null; refined: the refined timeline, or null
 *   insets     [{ n, rel, rect, sound, at, seconds }] (at: seconds into the slide, as the motion engine played it)
 *   cutscenes  [{ id, title, sound: 'its own' | 'muted', placeholder }]
 *   addons     the episode's add-ons; files: { [src path]: [names in extras/] }; pres: the presentation folder
 */
function clipSlots({ film, tight = null, refined = null, insets = [], cutscenes = [], addons = [], files = {}, pres = '' }) {
  const removed = (tight && tight.tightened && tight.tightened.removed) || [];
  const map = (refined && refined.refined && refined.refined.map) || null;
  const deliveredFrame = (f, end = false) => {
    const g = mapFrame(f, removed);
    if (!map) return g;
    for (const [f0, o0, n] of map) if (end ? g > f0 && g <= f0 + n : g >= f0 && g < f0 + n) return o0 + g - f0;
    return null;
  };
  const chapters = refine.filmChapters(film);
  const slots = [];
  const push = (row, f0, f1) => {
    const a = deliveredFrame(f0);
    const b = deliveredFrame(f1, true);
    if (a == null || b == null || b <= a) return;
    slots.push({ ...row, in: a / FPS, out: b / FPS });
  };
  for (const i of insets) {
    const c = chapters.find((x) => x.kind === 'slide' && Number(x.n) === Number(i.n));
    if (!c || !(i.seconds > 0)) continue;
    const f0 = c.f0 + Math.round(i.at * FPS);
    push({ kind: 'inset', slot: `Slide ${i.n} inset: \`${path.basename(i.rel)}\``, sound: i.sound ? 'its own, under the voice' : 'muted',
      frame: `inset, ${i.rect.w} × ${i.rect.h} at x ${i.rect.x}, y ${i.rect.y}`, rect: i.rect, n: i.n, name: path.basename(i.rel), files: files[i.file] || [] },
    f0, Math.min(c.f1, f0 + Math.round(i.seconds * FPS)));
  }
  for (const s of cutscenes) {
    const c = chapters.find((x) => x.kind === 'cutscene' && String(x.id) === String(s.id));
    if (!c) continue;
    push({ kind: 'cutscene', slot: `Cut scene ${s.id}${s.title ? ` ${q(s.title)}` : ''}${s.placeholder ? ' (a placeholder: your clip goes here)' : ''}`,
      sound: s.placeholder ? 'yours' : s.sound, frame: 'full frame', files: files[s.file] || [] }, c.f0, c.f1);
  }
  for (const r of (refined && refined.refined && refined.refined.addons) || []) {
    const a = addons.find((x) => x.id === r.id);
    if (!a || !Array.isArray(r.at)) continue;
    const overlay = a.kind === 'transition' && a.style === 'overlay';
    const sound = a.kind === 'music' ? 'a bed, about −26 LUFS' : a.kind === 'broll' ? 'none: the voice carries on' : a.kind === 'clip' && a.sound === 'mute' ? 'muted' : 'its own';
    slots.push({ kind: a.kind, slot: `${KIND[a.kind] || 'Clip'} ${q(a.title)} (${r.where})`, sound, frame: a.kind === 'music' ? '–' : overlay ? 'full frame, Screen blend' : 'full frame',
      files: files[path.join(pres, a.file)] || [], in: r.at[0], out: r.at[1] });
  }
  return slots.sort((x, y) => x.in - y.in);
}

/** Where an inset sits, for the editor: its size, its corner, its centre against the canvas centre, a full clip's scale. */
function insetLine(s) {
  const { x, y, w, h } = s.rect;
  const dx = x + w / 2 - FRAME.w / 2;
  const dy = y + h / 2 - FRAME.h / 2;
  const scale = Math.max(w / FRAME.w, h / FRAME.h);
  const crop = Math.abs(w / h - FRAME.w / FRAME.h) > 0.01;
  const side = (v, pos, neg) => (Math.abs(v) < 0.5 ? null : `${Math.round(Math.abs(v) * 10) / 10} px ${v > 0 ? pos : neg}`);
  const centre = [side(dx, 'right of', 'left of'), side(dy, 'below', 'above')].filter(Boolean);
  return `- **Slide ${s.n}, \`${s.name}\`:** ${w} × ${h} px with its top-left corner at x ${x}, y ${y}; its centre is ${centre.length ? `${centre.join(' and ')} the canvas centre` : 'the canvas centre'}. `
    + `A 1920×1080 clip scales to ${(Math.round(scale * 10000) / 100).toFixed(2)} %${crop ? ' and is cropped to fit' : ''}.`;
}

/**
 * CAPCUT_CLIP_GUIDE.md for the delivery, or null when the video has no clip slots. `master`: the editing master's file
 * name; `seconds`: the delivered length; `slots`: clipSlots(); `levelled`: whether extras/ holds levelled files.
 */
function clipGuide({ title, master, seconds, slots, levelled = false }) {
  if (!slots.length) return null;
  const cell = (v) => String(v).replace(/\|/g, '\\|');
  const rows = slots.map((s) => `| ${cell(s.slot)} | ${tc(s.in)} – ${tc(s.out)} | ${(s.out - s.in).toFixed(1)} s | ${cell(s.sound)} | ${cell(s.frame)} | ${s.files.length ? s.files.map((f) => `\`extras/${cell(f)}\``).join(', ') : '–'} |`);
  const insets = slots.filter((s) => s.kind === 'inset');
  return [
    `# CapCut clip guide: ${title}`,
    '',
    `Work from the editing master, \`${master}\`: no edit lists, PCM sound, the voice 20 ms late on purpose, so the lips stay in sync in CapCut. Timecodes are from this cut (30 fps, 1920×1080, ${tc(seconds)} long).`,
    '',
    '| Slot | In – out | Length | Sound | Frame | File |',
    '|---|---|---|---|---|---|',
    ...rows,
    ...(insets.length ? ['', '**Insets**', ...insets.map(insetLine)] : []),
    ...(levelled ? ['', 'The files in `extras/` are levelled: clips at −14 LUFS under a −1 dBTP ceiling, music as `.bed` (−26 LUFS, under the voice) and `.full` (−16 LUFS).'] : []),
    '',
  ].join('\n');
}

// ── the Slack pack ───────────────────────────────────────────────────────────────────────────────────────────

/** What slack_pack.py makes for a title. */
const packNames = (title) => [`${title} (vF).mp4`, `${title} - 1.25x for Slack.mp4`, `${title}.mp3`, `${title}-Cover.jpg`];

/**
 * The Slack pack from the user's own final export, with the method's slack_pack.py, into `out` (the deliverables
 * folder): the (vF), the 1.25× cut, the MP3 and the cover. An earlier pack moves to old/ first; the export is only
 * read. Then the checks: the 1.25× cut is 1/1.25 of the (vF)'s length (to the frame), and every sound is under the
 * −1 dBTP ceiling. Returns { files, overs, vf, fast, lengthOk }.
 */
async function slackPack({ python, script, file, out, title, ffprobe = 'ffprobe', env, signal, onLine = () => {} }) {
  const names = packNames(title);
  if (names.some((n) => path.resolve(out, n) === path.resolve(file))) throw new Error(`Your export has the name the pack would use (${path.basename(file)}): rename it, then try again.`);
  const old = names.filter((n) => exists(path.join(out, n)));
  if (old.length) {
    const dest = path.join(out, 'old', `Slack pack ${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}`);
    fs.mkdirSync(dest, { recursive: true });
    for (const n of old) fs.renameSync(path.join(out, n), path.join(dest, n));
    onLine(`The earlier Slack pack is in ${path.relative(out, dest)}.`);
  }
  let seen = '';
  const r = await refine.runTool(python, [script, file, '--title', title, '--out', out, '--verify'], { env, signal, onOut: (chunk) => {
    seen += chunk;
    const lines = seen.split('\n');
    seen = lines.pop();
    for (const l of lines) if (l.trim()) onLine(l);
  } });
  if (seen.trim()) onLine(seen);
  if (signal && signal.aborted) throw new Error('Stopped.');
  if (r.code !== 0) throw new Error(`slack_pack.py stopped: ${lastLine(r.err) || `exit ${r.code}`}`);
  const files = names.filter((n) => exists(path.join(out, n)));
  const vf = await refine.probeMedia(ffprobe, path.join(out, names[0]), env);
  const fast = await refine.probeMedia(ffprobe, path.join(out, names[1]), env);
  const len = (m) => (m ? m.videoDuration || m.duration : null);
  const lengthOk = Boolean(vf && fast && Math.abs(len(fast) - len(vf) / 1.25) <= 1 / FPS);
  return { files, overs: r.out.split('\n').filter((l) => /OVER the ceiling/.test(l)).map((l) => l.trim()), vf: len(vf), fast: len(fast), lengthOk };
}

module.exports = { collect, levelExtras, bedNames, tc, clipSlots, clipGuide, insetLine, packNames, slackPack, MANIFEST };
