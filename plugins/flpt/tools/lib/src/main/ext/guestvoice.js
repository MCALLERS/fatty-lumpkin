'use strict';
// Guest narrators in the flow (W4-11; guestvoice.js), as a flow extension:
//   approved      the storyboard, the deck or the script approved: script.md's guest tags written from the plan
//                 (guestvoice.stamp), so the draft, the estimate and the film all read the same voices. Spend approved
//                 free with nothing but a guest's narration left to film: refused (see spendBlocked), and undone
//   estimate      the filming estimate with one line per guest provider ("FLPT voice · free" for the FLPT voices; a
//                 paid guest at its provider's rate) and the guests' seconds off the presenter's voice line
//   spendBlocked  a guest Spend can't pay for or reach: a guest other than the Mac's in a film made offline (a cartoon
//                 in the Mac's voice), an FLPT voice while the film run can't carry the sign-in (guestvoice.houseFilms:
//                 it can, under the T19 ruling) or without the sign-in (houseReady: for the Worker FLPT talks to now), a
//                 paid voice whose provider Spend can't approve yet, or a guest's free narration all that's left to film
//                 (no film run makes only that yet)
// The tags follow the plan (and the sign-in) at those approvals, before an estimate the pipeline counted, and before
// Spend's own check; never while a crew is at work, and never once Spend is approved (it priced the voices: they're
// set until Spend is open again). Only for an episode whose pipeline copy reads the tags (FLPT_GUEST_VOICE_V1;
// pipeline.knows): an older copy narrates every slide in the presenter's voice, so it gets no guest line and nothing is
// blocked. Order 37: after the presenter's estimate (35), which rewrites the voice lines a cartoon speaks, and after
// ext/guestonly.js (34), which tells whether a guest is all that's left.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const guest = require('../guestvoice');

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
/** The FLPT voices can speak in this film: signed in, filmed online (the Jazz default needs it). */
const houseFor = (ctx, dir) => guest.houseFor(ctx.d || {}, dir);
/** Signed in to the FLPT voices (a voice the user chose needs it). */
const signedIn = (ctx) => guest.houseReady(ctx.d && ctx.d.vault);
/** Is this episode's film made offline (a cartoon in the Mac's voice)? */
const offline = (ctx, dir) => guest.filmsOffline(guest.presenterOf(ctx.d || {}, dir));
/** Does this episode's pipeline read the guest tags? */
function knows(ctx, dir) {
  const p = ctx.d && ctx.d.pipeline;
  try { return Boolean(p && typeof p.knows === 'function' && p.knows(dir, guest.MARKER)); } catch { return false; }
}
const scriptOf = (dir) => { try { return fs.readFileSync(path.join(dir, 'presentation', 'script.md'), 'utf8'); } catch { return ''; } };
const recordOf = (ctx, dir) => { try { return (ctx.episode || require('../episode')).read(dir); } catch { return null; } };
/** The providers Spend can approve (presenter.js asks flow.js the same way). */
const spendable = () => { try { return require('../presenter').spendProviders(); } catch { return ['heygen']; } };

/** The script's tags made to match the plan, unless they're set now (guest.frozen); a log line when they changed. */
function stamp(ctx, dir) {
  if (guest.frozen(recordOf(ctx, dir))) return { changed: false, frozen: true, slides: null };
  const r = guest.stamp(dir, { house: houseFor(ctx, dir) });
  if (r.changed) { try { ctx.log(`guest voices: ${Object.keys(r.slides).length ? Object.entries(r.slides).map(([n, v]) => `slide ${n} ${v.name}`).join(', ') : 'none'}`); } catch { /* no log */ } }
  return r;
}

// The latest estimate's verdict on a guest-only film (guestvoice.guestOnly), by episode, with what it was worked out
// from (the script and the presenter): Spend's check uses it while they're the same, and the approval it led to is
// refused by it. Every estimate replaces it.
const verdicts = new Map();
function fingerprint(ctx, dir) {
  const p = guest.presenterOf(ctx.d || {}, dir) || {};
  return crypto.createHash('sha256').update(scriptOf(dir)).update(`\n${p.kind || ''}|${(p.voice && p.voice.provider) || ''}`).digest('hex');
}
function verdict(ctx, dir) {
  const v = verdicts.get(path.resolve(dir));
  return v && v.fp === fingerprint(ctx, dir) ? v.why : null;
}

module.exports = {
  id: 'guestvoice',
  order: 37,
  hooks: {
    approved(ctx, { dir, stageId }) {
      if (stageId === 'storyboard' || stageId === 'script' || stageId === 'deck') { stamp(ctx, dir); return; }
      if (stageId !== 'spend') return;
      // Spend approved free with a guest's narration all that's left: no film run makes it (Film would end where it
      // started), so the approval is refused and undone (ext/index.js) before anything relies on it
      const st = recordOf(ctx, dir);
      const spend = st && isObj(st.stages) && isObj(st.stages.spend) ? st.stages.spend : null;
      if (spend && spend.status === 'approved' && spend.free === true && knows(ctx, dir)) {
        const why = verdict(ctx, dir);
        if (why) throw new Error(why);
      }
    },
    async estimate(ctx, { dir, est }) {
      if (!isObj(est) || !knows(ctx, dir)) return est;
      // only before an estimate the pipeline counted (none is counted while a pipeline step is under way)
      if (isObj(est.film) && est.film.source === 'pipeline') stamp(ctx, dir);
      const next = guest.estimateWith(est, guest.guestSlides(scriptOf(dir)));
      verdicts.set(path.resolve(dir), { fp: fingerprint(ctx, dir), why: guest.guestOnly(next, { offline: offline(ctx, dir) }) });
      return next;
    },
    spendBlocked(ctx, { dir }) {
      if (!knows(ctx, dir)) return null;
      stamp(ctx, dir); // Spend's estimate, next, counts the voices as they are now
      return guest.blockedBy(guest.guestSlides(scriptOf(dir)), { house: signedIn(ctx), film: guest.houseFilms(), spend: spendable(), offline: offline(ctx, dir) })
        || verdict(ctx, dir);
    },
  },
  stamp,
};
