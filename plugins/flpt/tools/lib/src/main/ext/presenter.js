'use strict';
// The cartoon presenter in the flow (PLAN §2.12; W3-05), as a flow extension:
//   estimate     a cartoon's film: no avatar clip (T4), its voice priced by its own provider (HeyGen, ElevenLabs,
//                Fish.audio), nothing at all on the Mac's voice (Spend then approves it free, with no dialog)
//   approved     Spend: the presenter its estimate priced is kept on the approval (stages.spend.presenter), so the film
//                and every re-composite of it follow what was approved, whatever Setup says later (presenter.of)
//   spendBlocked a cartoon whose voice isn't picked yet, whose voice Spend can't approve yet, or whose rig isn't there
//   afterDraft   the cartoon drawn for the draft's narration (its own sandboxed pass), then the draft put together
//                again with it in the bubble: the free draft's presenter moves
//   afterFilm    the same for the film, then the film re-composited from the cache (no key, no network)
//   caps         this surface can present a cartoon, with these voices (caps.voices)
// Order 35: after Live Motion (30), before the splice of the pieces between slides (40), which takes the draft or film
// as it then is.
const fs = require('fs');
const path = require('path');
const presenter = require('../presenter');

const settingsPresenter = (ctx) => { try { return (ctx.d.settings.read() || {}).presenter || null; } catch { return null; } };
const who = (ctx, dir) => presenter.of(dir, settingsPresenter(ctx));
const presentersDir = (ctx) => { try { return path.join(ctx.d.settings.read().projectsDir, 'Presenters'); } catch { return null; } };
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

// The presenter each episode's latest estimate priced (folder → it), for the approval that follows it.
const priced = new Map();

/** Whether the episode's script has anything to say (the flow's own rule for "nothing to film"). */
function narrated(ctx, dir) {
  let text = '';
  try { text = fs.readFileSync(path.join(dir, 'presentation', 'script.md'), 'utf8'); } catch { return false; }
  return ctx.episode.parseScript(text).some((s) => s.narration.replace(/\[[^\]]*\]/g, '').trim());
}

/** The app's own files no render may read (its vault, the crew's Claude folder), from the flow's deps. */
function appPrivate(d) {
  if (typeof d.appPrivate === 'function') { try { return d.appPrivate() || []; } catch { return []; } }
  return d.configDir ? [d.configDir, path.join(path.dirname(d.configDir), 'vault.json')] : [];
}

/** Draw the cartoon for a run, then put the run together again when anything new is in the bubble. */
async function drawAndCompose(ctx, dir, which, a = {}) {
  const p = who(ctx, dir);
  if (!presenter.isCartoon(p) || !ctx.d.pipeline) return;
  const log = (t) => { try { ctx.log(t); } catch { /* no log */ } };
  const onLine = typeof a.onLine === 'function' ? a.onLine : (l) => log(`cartoon presenter: ${l}`);
  const r = await presenter.render(dir, which, { engineRoot: ctx.d.engineRoot, presenter: p, presentersDir: presentersDir(ctx), toolEnv: ctx.d.toolEnv,
    hidden: appPrivate(ctx.d), onLine, signal: a.signal, stampDir: ctx.d.configDir ? path.dirname(ctx.d.configDir) : null });
  for (const x of r.problems || []) log(`cartoon presenter: ${x}`);
  if (!(r.clips || []).length || (!r.made && presenter.allInBubble(dir, which))) return;
  const o = { ...(typeof a.onLine === 'function' ? { onLine: a.onLine } : {}), ...(a.signal ? { signal: a.signal } : {}) };
  const again = which === 'draft' ? await ctx.d.pipeline.draft(dir, o) : await ctx.d.pipeline.recompose(dir, o);
  if (!again || again.code !== 0) log(`cartoon presenter: the ${which === 'draft' ? 'draft' : 'film'} keeps the cartoon's still (${((again && again.lines) || []).slice(-1)[0] || 'it didn\'t finish'})`);
}

module.exports = {
  id: 'presenter',
  order: 35,
  hooks: {
    async estimate(ctx, { dir, est }) {
      const p = who(ctx, dir);
      priced.set(path.resolve(dir), p);
      return presenter.isCartoon(p) ? presenter.estimateFor(est, p, { narrated: narrated(ctx, dir) }) : est;
    },
    approved(ctx, { dir, stageId }) {
      if (stageId !== 'spend') return;
      const st = ctx.episode.read(dir);
      if (!st || !isObj(st.stages) || !isObj(st.stages.spend) || st.stages.spend.status !== 'approved') return;
      const p = { ...(priced.get(path.resolve(dir)) || who(ctx, dir)) };
      priced.delete(path.resolve(dir));
      delete p.from;
      st.stages.spend = { ...st.stages.spend, presenter: p };
      ctx.episode.write(dir, st);
    },
    spendBlocked(ctx, { dir }) {
      const p = who(ctx, dir);
      if (!presenter.isCartoon(p)) return null;
      if (!presenter.rigDir(ctx.d.engineRoot, p.rig, presentersDir(ctx))) return 'The cartoon presenter isn\'t there any more. Pick one in Setup → Presenter.';
      const v = p.voice || {};
      if (!presenter.offered().includes(v.provider)) return `Filming with your ${presenter.VOICES[v.provider].name} voice isn't ready yet. Pick another voice in Setup → Presenter.`;
      if (v.provider !== 'say' && !v.id) return 'The cartoon has no voice yet. Pick one in Setup → Presenter.';
      return null;
    },
    async afterDraft(ctx, a) { await drawAndCompose(ctx, a.dir, 'draft', a); },
    async afterFilm(ctx, a) { await drawAndCompose(ctx, a.dir, 'final', a); },
    caps(ctx, caps) {
      const have = Array.isArray(caps.presenters) ? caps.presenters : ['heygen'];
      return { ...caps, presenters: have.includes('cartoon') ? have : [...have, 'cartoon'], voices: presenter.offered() };
    },
  },
};
