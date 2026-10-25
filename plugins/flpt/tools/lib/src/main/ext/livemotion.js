'use strict';
// Live Motion's flow extension (W2-02; PLAN §2.4, §2.6, §2.7, §2.9): the scene pieces through the flow's hooks
// (ext/index.js), so flow.js stays as it is.
//
//   planning     the Claude planning cap's lines for Live Motion pieces the storyboard doesn't already count (an older
//                episode without a board, a piece whose shot isn't on it): ext/storyboard.js counts the board's pieces
//                by shot, so nothing is counted twice
//   afterRender  after a run's moving slides (the free draft, or the film): every finished narrated piece timed to that
//                run's voice, scored again (the score pass reruns after every retime) and rendered to
//                media/slide_NN.mp4, handed back for media.json as `flpt-scene` clips, then checked again at that
//                timing (lint, words, text, and the pacing check on its clip, Q-01: a failure or a flag is "needs a
//                look", G1); every finished piece between slides rendered for the splice when its clip is missing
//                or out of date (never in media.json)
//   approved     Live Motion approved: refused while the scene crews are at work (the flow undoes it); else each
//                finished piece approved by whoever approved the stage, and the stage not "skipped" when a piece was made
//   open         the pieces as the Live Motion wall draws them (view.livemotion)
//   settle       a run of scene crews FLPT quit in the middle of: its pieces "running" become failed, and the stage it
//                ran (crew: 'scene') an error, so nothing stays stuck "running"
//   spendBlocked while the scene crews are at work
// Nothing here spends: the crews run through api/livemotion.js, on the episode's Claude planning budget.
const livemotion = require('../livemotion');
const scenecrew = require('../scenecrew');
const animators = require('../animators');
const stylesLib = require('../styles');

const isPlain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** The episode's own sound files (`file:<id>`), for the score pass. */
function soundFiles(dir) {
  try { return require('../api/sound').filesOf(dir); } catch { return {}; }
}

/** The styles, as the flow's host sees them (its engine and the user's projects folder). */
function stylesOf(d = {}) {
  let projectsDir = null;
  try { projectsDir = d.settings && typeof d.settings.read === 'function' ? d.settings.read().projectsDir : null; } catch { projectsDir = null; }
  return stylesLib.createStyles({ engineRoot: d.engineRoot, projectsDir: projectsDir || null, mediaRoot: null });
}

/**
 * What the pieces' renders need, from the flow's host (d): the engine, the toolchain's environment, the styles, the
 * method's scripts on the episode's Python in the sandbox (pipeline.retime), the shipped tracks and the episode's own
 * sound files.
 */
function depsFrom(d, dir, extra = {}) {
  const env = d && typeof d.toolEnv === 'function' ? d.toolEnv() : process.env;
  return {
    engineRoot: d.engineRoot, env, styles: stylesOf(d),
    retime: d.pipeline && typeof d.pipeline.retime === 'function' ? (args, o = {}) => d.pipeline.retime(dir, args, o) : null,
    library: livemotion.shippedLibrary(d.engineRoot), files: soundFiles(dir),
    // a host may give its own renderer and page meta (a server's sandbox, the tests' stand-ins)
    ...(isPlain(d.livemotion) ? d.livemotion : {}), ...extra,
  };
}

/** Can this host render scenes (its HyperFrames, when it says)? */
const canRender = (d) => !(d && d.motion && typeof d.motion.available === 'function' && !d.motion.available());

module.exports = {
  id: 'livemotion',
  order: 30,
  hooks: {
    async planning(ctx, { dir }) {
      const lines = livemotion.planningLines(dir).map(({ label, usd }) => ({ label, usd }));
      return lines.length ? { lines } : null;
    },
    async afterRender(ctx, { dir, which }) {
      const pieces = livemotion.pieces(dir);
      if (!pieces.length) return null;
      const made = pieces.filter((p) => { const r = livemotion.recordOf(dir, p); return r && r.key === p.key && r.ok; });
      if (!made.length) return null;
      if (!canRender(ctx.d)) return { problems: ['Live Motion scenes need HyperFrames, so they show their posters for now.'] };
      const deps = depsFrom(ctx.d, dir);
      const out = await livemotion.renderNarrated(dir, which, deps);
      // the checks again at this run's timing (G1: the crew's ran on the draft's): a failure is "needs a look" on the
      // wall and in the Studio, never a silent ok; a pass clears it
      for (const p of made.filter((x) => livemotion.NARRATED.has(x.kind) && out.scenes[x.n])) {
        const c = await scenecrew.checkPiece(dir, p, deps);
        livemotion.noteLive(dir, p, { look: c.ok ? null : { which, sha: livemotion.filesSha(livemotion.folderOf(dir, p)), problems: c.problems.slice(0, 8) } });
        if (!c.ok) out.problems.push(`Slide ${p.n} needs a look: ${c.problems[0]}.`);
      }
      for (const p of made.filter((x) => x.placement === 'between')) {
        try {
          const r = await livemotion.renderInterstitial(dir, p, deps);
          if (!r.ok) out.problems.push(`${p.title} isn't spliced in: ${r.problems[0] || 'it didn\'t render'}.`);
          else if (r.problems.length) out.problems.push(...r.problems.map((x) => `${p.title}: ${x}.`));
        } catch (e) {
          out.problems.push(`${p.title} isn't spliced in: ${String(e && e.message ? e.message : e).slice(0, 200)}.`);
        }
      }
      return { scenes: out.scenes, mix: {}, problems: out.problems };
    },
    approved(ctx, { dir, stageId, by }) {
      if (stageId !== 'animate') return;
      if (scenecrew.isBusy(dir)) throw new Error('The Live Motion crews are still drawing.');
      const pieces = livemotion.pieces(dir).filter((p) => { const r = livemotion.recordOf(dir, p); return r && r.key === p.key && r.ok; });
      if (!pieces.length) return;
      for (const p of pieces) livemotion.noteLive(dir, p, { approved: true, approvedBy: by });
      const st = ctx.episode.read(dir);
      if (st && st.stages && isPlain(st.stages.animate) && st.stages.animate.skipped) {
        st.stages.animate = { ...st.stages.animate, skipped: false };
        ctx.episode.write(dir, st);
      }
    },
    open(ctx, { dir, view }) {
      let pieces = [];
      try { pieces = livemotion.view(dir); } catch { pieces = []; }
      // the scene crews count as running for the episode too, so the Live Motion step polls rather than reading
      // "Interrupted" while they work (W2-05 handoff 4)
      const crews = scenecrew.isBusy(dir);
      return { ...view, running: Boolean(view && view.running) || crews, livemotion: { pieces, running: crews } };
    },
    settle(ctx, { dir, st }) {
      if (!isPlain(st) || scenecrew.isBusy(dir)) return st;
      let changed = false;
      const live = isPlain(st.live) ? { ...st.live } : st.live;
      if (isPlain(live)) {
        for (const [id, e] of Object.entries(live)) {
          if (isPlain(e) && e.status === 'running') { live[id] = { ...e, status: 'failed', error: e.error || livemotion.INTERRUPTED }; changed = true; }
        }
      }
      let stages = st.stages;
      const a = isPlain(stages) ? stages.animate : null;
      if (isPlain(a) && a.status === 'running' && a.crew === 'scene' && animators.crewsAt(dir) === 0) {
        stages = { ...stages, animate: { ...a, status: 'error', error: livemotion.INTERRUPTED, crew: null } };
        changed = true;
      }
      return changed ? { ...st, live, stages } : st;
    },
    spendBlocked(ctx, { dir }) {
      return scenecrew.isBusy(dir) ? 'The Live Motion crews are still drawing.' : null;
    },
  },
  // for api/livemotion.js and the tests (the loader reads only id, order and hooks)
  depsFrom, stylesOf, soundFiles,
};
