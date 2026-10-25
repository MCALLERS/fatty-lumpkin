'use strict';
// The splice's flow extension (W2-03; PLAN §2.6, §2.7): the storyboard's pieces between slides spliced into the draft
// and the film, kept as Refine's planned rows, and Deliver's Live Motion parts, through the flow's hooks (ext/index.js),
// so flow.js stays as it is.
//
//   settle       the record's planned rows follow the storyboard once there's a film (interstitials.syncRecord): a
//                piece added, removed or rendered again re-opens Refine, free (written at once); a change to a row's
//                text alone is refreshed quietly; nothing ever enters media.json (T3)
//   afterDraft   the draft's pieces spliced in: draft_presentation_full.mp4
//   afterFilm    the rows written, the film's pieces spliced in: presentation_full.mp4 (Film review plays it). A failed
//                splice never fails the film it follows (it was made, maybe paid for): it's noted, and Refine splices
//                again from the base film
//   open         the spliced draft and film in place of the bare ones while they're current; Refine's planned rows
//                marked `planned` and `locked` (they're removed only from the storyboard); the slides whose scene has
//                its own music marked `music` (♪), and a bed placed under one `underMusic` (it sits at -32 LUFS); the
//                captions choice (view.deliverOptions); the last splice's notes (view.splice)
//   deliver      each Live Motion stem and its music in extras/; music-credits.txt with every CC BY track (Refine's
//                beds and the scenes'), a paste-ready DESCRIPTION.txt, and the captions (presentation.srt) when chosen
// Nothing here spends: ffmpeg and the method's free scripts only.
const fs = require('fs');
const path = require('path');
const interstitials = require('../interstitials');
const refine = require('../refine');
const extras = require('../extras');

const isPlain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const exists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const mtime = (p) => { try { return Math.round(fs.statSync(p).mtimeMs); } catch { return null; } };
const said = (e) => String(e && e.message ? e.message : e).slice(0, 300);

/** What the splice needs from the flow's host: ffmpeg (as Refine runs it), the toolchain's PATH, the engine. */
function depsFrom(d = {}, extra = {}) {
  const tools = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', ...(isPlain(d.refineTools) ? d.refineTools : {}) };
  let PATH = process.env.PATH || '';
  try { if (typeof d.toolEnv === 'function') PATH = d.toolEnv().PATH || PATH; } catch { /* the process's own */ }
  return { engineRoot: d.engineRoot, ffmpeg: tools.ffmpeg, ffprobe: tools.ffprobe, env: { PATH, HOME: process.env.HOME || '', LANG: 'en_US.UTF-8' }, ...extra };
}

/** Is the captions choice on for this episode (its Deliver record)? */
const captionsOn = (st) => Boolean(st && isPlain(st.stages) && isPlain(st.stages.deliver) && st.stages.deliver.captions === true);

/** A Python for the method's standard-library scripts: FLPT's own first (the app's toolchain), else the episode's. */
async function pythonFor(d, dir) {
  try { const p = typeof d.basePython === 'function' ? await d.basePython() : null; if (p && exists(p)) return p; } catch { /* next */ }
  try { const p = d.pipeline && typeof d.pipeline.projectPython === 'function' ? d.pipeline.projectPython(dir) : null; if (p && exists(p)) return p; } catch { /* none */ }
  return null;
}

module.exports = {
  id: 'interstitials',
  order: 40,
  hooks: {
    settle(ctx, { dir, st }) {
      let r;
      try { r = interstitials.syncRecord(dir, st); } catch (e) { ctx.log(`Splice: ${said(e)}`); return st; }
      if (!r.changed) return st;
      // A change to the video is written at once, not left for the flow's next write: the flow's stage records
      // (episode.setStage) read the record from disk, so Refine's own "review" would carry the old rows back, and the
      // next read would re-open Refine again. A quiet refresh (the rows' text alone) waits for the next write.
      if (r.stale) {
        try { ctx.episode.write(dir, r.st); } catch (e) { ctx.log(`Splice: ${said(e)}`); return st; }
      }
      return r.st;
    },
    async afterDraft(ctx, { dir }) {
      const st = ctx.episode.read(dir);
      try {
        await interstitials.applyDraft(dir, depsFrom(ctx.d, { title: (st && st.title) || '', onLine: (l) => ctx.log(l) }));
      } catch (e) {
        ctx.log(`! The draft keeps its pieces between slides out: ${said(e)}`);
      }
    },
    async afterFilm(ctx, { dir }) {
      const st = ctx.episode.read(dir);
      try {
        await interstitials.materialise(dir, depsFrom(ctx.d, { title: (st && st.title) || '', onLine: (l) => ctx.log(l) }),
          { read: (d) => ctx.episode.read(d), write: (d, next) => ctx.episode.write(d, next) });
      } catch (e) {
        ctx.log(`! The film keeps its pieces between slides out until Refine: ${said(e)}`);
      }
    },
    open(ctx, { dir, view }) {
      if (!isPlain(view)) return view;
      const next = { ...view };
      let rows = [];
      try { rows = interstitials.plannedRows(dir).rows; } catch { rows = []; }
      if (rows.length) {
        const film = view.video ? interstitials.current(dir, 'film', rows) : null;
        if (film) { next.video = film.video; next.videoAt = mtime(film.video); }
        const draft = view.draft ? interstitials.current(dir, 'draft', rows) : null;
        if (draft) { next.draft = draft.video; next.draftAt = mtime(draft.video); }
      }
      const st = isPlain(view.state) ? view.state : null;
      if (isPlain(view.refine)) {
        const all = st && Array.isArray(st.addons) ? st.addons.filter(isPlain) : [];
        const planned = new Set(all.filter((a) => a.planned).map((a) => a.id));
        const withMusic = new Set(all.filter((a) => a.planned && a.music).map((a) => a.id));
        let music = new Set();
        try { music = refine.sceneSound(path.join(dir, 'presentation')).music; } catch { music = new Set(); }
        // a bed placed under a scene with its own music (it sits at -32 LUFS there): the "Has its own music" chip
        const underMusic = (a) => a.kind === 'music' && (a.under ? withMusic.has(a.under) : music.has(Number(a.slide)));
        next.refine = {
          ...view.refine,
          addons: (Array.isArray(view.refine.addons) ? view.refine.addons : []).map((a) => (planned.has(a.id) ? { ...a, planned: true, locked: true, ...(withMusic.has(a.id) ? { music: true } : {}) }
            : underMusic(a) ? { ...a, underMusic: true } : a)),
          slides: (Array.isArray(view.refine.slides) ? view.refine.slides : []).map((x) => (music.has(Number(x.n)) ? { ...x, music: true } : x)),
        };
      }
      next.deliverOptions = { captions: captionsOn(st) };
      next.splice = interstitials.status(dir);
      return next;
    },
    async deliver(ctx, { dir, extras: items }) {
      const st = ctx.episode.read(dir);
      const d = ctx.d || {};
      const list = [...items, ...extras.liveItems(interstitials.liveFiles(dir), items)];
      let out = null;
      try { out = path.join(d.settings.read().deliverablesDir, ctx.episode.slugify(st.title)); } catch { out = null; }
      if (!out || !fs.existsSync(out)) return list;
      const t = interstitials.deliveredTimeline(dir, st);
      // Every CC BY track the delivered video plays, once: Refine's beds, the spliced pieces' and the scenes' music.
      const { tracks, text: credits } = interstitials.credits(dir, st.addons || [], { engineRoot: d.engineRoot, title: st.title });
      if (credits) fs.writeFileSync(path.join(out, 'music-credits.txt'), credits);
      else fs.rmSync(path.join(out, 'music-credits.txt'), { force: true });
      const text = extras.description({ point: st.intake && st.intake.point, timeline: t.delivered, tracks });
      if (text) fs.writeFileSync(path.join(out, 'DESCRIPTION.txt'), text);
      else fs.rmSync(path.join(out, 'DESCRIPTION.txt'), { force: true });
      // The captions, when chosen: the script's words where the delivered video says them.
      const srtFile = path.join(out, 'presentation.srt');
      if (!captionsOn(st)) { fs.rmSync(srtFile, { force: true }); return list; }
      try {
        const python = await pythonFor(d, dir);
        const words = python ? await interstitials.captionWords(dir, st, depsFrom(d, { python })) : [];
        const body = extras.srt(extras.captionCues(words));
        if (body) fs.writeFileSync(srtFile, body);
        else { fs.rmSync(srtFile, { force: true }); ctx.log('! No captions: the narration\'s words couldn\'t be timed.'); }
      } catch (e) {
        fs.rmSync(srtFile, { force: true });
        ctx.log(`! No captions: ${said(e)}`);
      }
      return list;
    },
  },
  // for api/delivery.js and the tests (the loader reads only id, order and hooks)
  depsFrom, captionsOn,
};
