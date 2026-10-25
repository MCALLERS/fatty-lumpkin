#!/usr/bin/env node
'use strict';
// Spend, Film and Deliver, through the app's flow.js and pipeline.js:
//   --draft    free: the slides with the Mac's own voice, to check timing before paying
//   --check    free: the pipeline's --check (nothing is generated) and the app's estimate for filming
//   --final    paid: HeyGen, only with --approved <the amount the user said yes to>, which must be today's estimate to
//              the cent, and only after a draft of the current script. Then the user says yes once more, in a native
//              dialog this CLI shows itself (confirm-native.js), so the model that ran it can't give the consent. The
//              approval is the app's broker (a capped budget, one filming run), with its ledger in <episode>/spend/.
//   --tighten  free: the film's over-long pauses shortened, picture and sound in sync (the Mac app's Refine step)
//   --deliver  the web parts, the player page and the extras (levelled, with a clip guide), copied to the deliveries folder.
//              With tightening off and no add-ons of the user's, it delivers the film as filmed, the storyboard's pieces
//              between slides spliced in (presentation_full) while that splice is current and Deliver's chapters and
//              captions follow it: Refine adds nothing to it, so it's skipped (the Wave 3 ruling; PLAN §2.7)
//   --captions on: Deliver also writes presentation.srt beside the video (free; the app's Deliver toggle); off: not
//   --slack    free: the Slack pack from the user's own export (after their edit), beside the deliveries
//   --restore  free: the plugin's own pipeline scripts put back into the episode (T18), anything else Python could load
//              from there set aside in a new folder, never deleted. --check, --final and a draft point to it when they're
//              refused because the episode's pipeline changed.
// Every line the pipeline prints is redacted (keys, and their masked forms) before it is shown. The slide pictures and the
// draft run inside macOS's sandbox (slidebox.js), as in the Mac app.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { app, places, tools, episodeDir, pipeline, flowFor, brokerFor, redactor, library, motionFor, cli, usageError, main, say } = require('./common');
const confirmNative = require('./confirm-native');

const USAGE = `
Usage: flpt-film [<episode>] --draft | --check | --final --approved <US dollars> | --tighten on|off | --deliver | --captions on|off | --slack <export> | --restore
  --draft     free: the slides with the Mac's own voice and a placeholder presenter
  --check     free: the pipeline's checks (nothing is generated) and what filming would cost
  --final     paid: films with your HeyGen avatar, only after the user said yes to the estimate, with
              --approved <that amount>, and only once there's a draft of the current script; a dialog
              on this Mac then asks the user once more
  --tighten   free: on shortens the film's over-long pauses (picture and sound stay in sync); off undoes it
  --deliver   the web parts, the player page and the extras (levelled, with a clip guide), copied to your deliveries folder;
              with tightening off, the film as filmed (with the storyboard's pieces between slides, when it has them)
  --captions  free: on, Deliver also writes captions (presentation.srt) beside the video; a change makes a delivery out of date
  --slack     free: the Slack pack (the (vF), a 1.25x cut, an MP3 and a cover) from your own export, after your edit
  --restore   free: puts the plugin's own pipeline scripts back into the episode; anything else there that Python
              could load is set aside in a new folder, not deleted
<episode> defaults to the one you're in, else the newest.`;

const OPTIONS = { draft: { type: 'boolean' }, check: { type: 'boolean' }, final: { type: 'boolean' }, deliver: { type: 'boolean' }, approved: { type: 'string' },
  tighten: { type: 'string' }, captions: { type: 'string' }, slack: { type: 'string' }, restore: { type: 'boolean' } };
const mtime = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
/** A Python with numpy, for tighten.py: FLPT_PYTHON, the Mac app's own, or python3 (the first that has it), or null. */
const numpyPython = () => [process.env.FLPT_PYTHON, path.join(places().userData, 'toolchain', 'venv', 'bin', 'python'), tools().python]
  .filter((p) => p && path.isAbsolute(p) && fs.existsSync(p)).find((p) => spawnSync(p, ['-c', 'import numpy'], { stdio: 'ignore', timeout: 30000 }).status === 0) || null;
const heygenUsd = (est) => (est.byProvider.heygen ? est.byProvider.heygen.usd : 0);
// Every avatar clip is already filmed (the pipeline counted what isn't): nothing to pay.
const nothingToPay = (est) => Boolean(!heygenUsd(est) && est.film && est.film.nothing);
const cents = (n) => Number(n).toFixed(2);
const { CHANGED } = app('pipeline');
/** A run refused because the episode's pipeline isn't the plugin's own (T18): Restore is free. */
const changedPipeline = (r) => Boolean(r && (Array.isArray(r.changed) || (r.lines || []).includes(CHANGED)));
const restoreHint = (dir) => `Restore the plugin's own pipeline (free; anything else is set aside, not deleted): node "${__filename}" "${dir}" --restore`;
const REFUSED = {
  other: (provider) => `Not approved: this step would spend money${provider ? ` on ${provider}` : ''}, and flpt-film asks only for filming with HeyGen (--final).`,
  mismatch: (asked, approved) => `The dialog would ask for ${cents(asked)} US dollars, not the ${cents(approved)} passed with --approved. Show the user the estimate (--check) and ask again.`,
  cancel: () => 'Filming wasn\'t approved: the user cancelled the dialog.',
  timeout: () => 'Filming wasn\'t approved: the dialog had no answer for 2 minutes.',
  'no-gui': () => 'Filming needs the user\'s yes in a dialog on this Mac, and there\'s no screen session here to show it in. Run it from Claude Code on the Mac itself.',
  sandboxed: () => 'Filming wasn\'t approved: the dialog can\'t open inside Claude Code\'s sandbox. Run this command outside the sandbox, so the user can answer it.',
  invalid: () => 'Filming wasn\'t approved: the amount to approve is missing.',
  error: () => 'Filming wasn\'t approved: the dialog didn\'t open.',
};

/**
 * Is another process running this episode's pipeline (the Mac app filming it, say)? Its command line names the
 * episode's own scripts in presentation/video/. --final waits for it: closing the approval that run is using would stop
 * it part-way. Where processes can't be listed, this says no, and --final goes on as before (it never spends more).
 */
function pipelineBusy(dir) {
  const r = spawnSync('/bin/ps', ['-axww', '-o', 'pid=,ppid=,command='], { encoding: 'utf8', timeout: 5000 });
  if (r.status !== 0 || !r.stdout) return false;
  let real = dir;
  try { real = fs.realpathSync(dir); } catch { /* as given */ }
  const marks = [...new Set([dir, real])].map((d) => path.join(d, 'presentation', 'video') + path.sep);
  return r.stdout.split('\n').some((l) => {
    const m = l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    return Boolean(m) && Number(m[1]) !== process.pid && Number(m[2]) !== process.pid && marks.some((v) => m[3].includes(v));
  });
}

main(async () => {
  const { positionals, values } = cli(USAGE, OPTIONS);
  const modes = ['draft', 'check', 'final', 'tighten', 'deliver', 'captions', 'slack', 'restore'].filter((m) => values[m] != null && values[m] !== false);
  if (modes.length !== 1) usageError(USAGE, 'Pick one of --draft, --check, --final, --tighten, --deliver, --captions, --slack or --restore.');
  if (values.approved != null && !values.final) usageError(USAGE, '--approved goes with --final.');
  if (values.tighten != null && !['on', 'off'].includes(values.tighten)) usageError(USAGE, '--tighten is on or off.');
  if (values.captions != null && !['on', 'off'].includes(values.captions)) usageError(USAGE, '--captions is on or off.');
  if (values.final && !/^\d+(\.\d+)?$/.test(String(values.approved || ''))) usageError(USAGE, '--final needs --approved <the amount the user said yes to, in US dollars>.');

  const dir = episodeDir(positionals[0]);
  const episode = app('episode');
  const st = episode.read(dir);
  if (!st) throw new Error(`${dir} has no flpt-project.json, so it isn't an FLPT episode.`);
  const tooNew = episode.tooNew(st);
  if (tooNew) throw new Error(tooNew);
  const broker = brokerFor(dir);
  // T18: common.js's pipeline renders the slide pictures and the draft in macOS's sandbox (slidebox.js)
  const pl = pipeline(dir, { broker });
  const lib = library();
  // Spending needs two yeses: the one in chat, passed with --approved, and the user's own in a native dialog that this
  // CLI shows for exactly that amount (T22). Anything else the flow might ask is a no.
  let refusal = null;
  const confirm = async (o) => {
    const { provider, usd: asked } = confirmNative.request(o);
    if (!values.final || provider !== 'HeyGen') {
      refusal = REFUSED.other(provider);
      say(refusal);
      return false;
    }
    const approved = Number(values.approved);
    if (asked == null || cents(asked) !== cents(approved)) {
      refusal = REFUSED.mismatch(asked || 0, approved);
      return false;
    }
    say(`A dialog on this Mac asks the user to approve ${cents(asked)} US dollars on ${provider}…`);
    const a = await confirmNative.ask({ provider, usd: asked, message: o.message, detail: o.detail });
    if (!a.ok) refusal = (REFUSED[a.why] || REFUSED.error)();
    return a.ok;
  };
  const flow = flowFor(path.dirname(dir), {
    broker, pipeline: pl, redact: redactor(dir), motion: motionFor(pl), confirm,
    keep: (d, id, extra) => app('crew-library').keep(lib, d, id, extra),
  });
  const line = (l) => say(l);
  const draftIsCurrent = () => mtime(pl.draftOutput(dir)) >= mtime(path.join(dir, 'presentation', 'script.md'));

  if (values.restore) {
    if (pipelineBusy(dir)) throw new Error('Something else is running this episode\'s pipeline (the Mac app?). Wait for it to finish, then restore.');
    const r = pl.restore(dir);
    if (r.error) throw new Error(`Nothing was restored: ${r.error}.`);
    say(`Episode: ${dir}`);
    say(r.restored.length ? `Restored: ${r.restored.join(', ')}` : 'Restored: nothing (every script was already the plugin\'s own).');
    if (r.setAside.length) say(`Set aside, not deleted: ${r.setAside.join(', ')}\n  in ${r.folder}`);
    const t = pl.trust(dir);
    say(t.ok ? 'The episode\'s pipeline is the plugin\'s own.' : `Still not the plugin's own: ${t.changed.join(', ')}`);
    return t.ok ? 0 : 1;
  }

  if (!fs.existsSync(pl.projectPython(dir))) throw new Error('This episode has no Python environment (presentation/video/.venv). Run /flpt:check-deck once to see how to make it.');
  say(`Episode: ${dir}`);

  if (values.draft) {
    const r = await flow.draft(dir, line);
    if (!r.ok) throw new Error(changedPipeline(r) ? `${r.error}\n${restoreHint(dir)}` : r.error);
    say(`\nDraft: ${r.video}`);
    return 0;
  }

  if (values.check) {
    const r1 = await pl.render(dir, { onLine: line });
    if (r1.code !== 0) throw new Error(changedPipeline(r1) ? `The slides didn't render.\n${restoreHint(dir)}` : 'The slides didn\'t render.');
    const r = await pl.check(dir, { onLine: line });
    if (changedPipeline(r)) say(restoreHint(dir));
    const est = await flow.spendEstimate(dir);
    const usd = heygenUsd(est);
    const voice = est.lines.some((l) => l.rate === 'heygen_tts_s');
    say('');
    if (usd) say(`Estimate: about ${usd.toFixed(2)} US dollars on HeyGen. ${est.lines.map((l) => l.label).join('; ')}: 4.1 cents a second of avatar video${voice ? ', 0.2 cents of voice alone' : ''}. The approval allows up to 15 % more, for re-tries.`);
    else say(nothingToPay(est) ? `Nothing to pay: ${est.film.total ? `all ${est.film.total} avatar clips are` : 'everything is'} already filmed.` : 'The script has no narration to film yet.');
    say(draftIsCurrent() ? 'Draft: there is one of the current script.' : 'Draft: none of the current script yet. Make it first (free) with --draft.');
    if (usd || nothingToPay(est)) say(`Only after the user says yes: node "${__filename}" "${dir}" --final --approved ${usd.toFixed(2)}`);
    if (usd) say('Then a dialog on this Mac asks the user to approve that amount, and filming waits up to 2 minutes for the answer.');
    return r.code === 0 ? 0 : 1;
  }

  if (values.final) {
    if (pipelineBusy(dir)) throw new Error('Something else is running this episode\'s pipeline (the Mac app?). Wait for it to finish, then film.');
    const approved = Number(values.approved);
    // Scenes (the Mac app's cartoons and cut scenes) is approved on the way when none is planned; else the user decides.
    const ready = flow.passScenes(dir);
    if (!episode.canRun(ready, 'spend')) throw new Error(app('flow').spendBlocked(ready));
    if (!draftIsCurrent()) throw new Error('Make the free draft of the current script first (--draft), so the user can check its timing before paying.');
    const est = await flow.spendEstimate(dir);
    const usd = heygenUsd(est);
    if (!usd && !nothingToPay(est)) throw new Error('The script has no narration to film.');
    if (usd > approved + 0.005) throw new Error(`Filming now comes to about ${usd.toFixed(2)} US dollars, more than the ${approved.toFixed(2)} the user approved. Show them the new estimate (--check) and ask again.`);
    if (usd && cents(usd) !== cents(approved)) throw new Error(`Filming now comes to about ${usd.toFixed(2)} US dollars, not the ${approved.toFixed(2)} passed with --approved. Show the user this estimate (--check) and ask again.`);
    // T18: paid filming runs only on the plugin's own pipeline. Asked before the dialog, so the user isn't asked for a
    // yes that filming would then refuse.
    const trusted = pl.trust(dir);
    if (usd && !trusted.ok) throw new Error(`${CHANGED} (${trusted.changed.join(', ')})\n${restoreHint(dir)}`);
    // Every run asks afresh: an earlier approval (this CLI's, or the Mac app's Spend) never carries over, so a paid
    // run always shows the dialog, and an unpaid one is put together from the cache with no keys. No run is using it
    // now (pipelineBusy, above).
    const old = st.budgets && st.budgets.heygen;
    if (old && broker.isLive(old, 'heygen')) broker.close(old);
    const a = await flow.approveSpend(dir);
    if (!a.ok) throw new Error(refusal || 'Filming wasn\'t approved.');
    say(a.free ? 'Nothing to pay: every avatar clip is already filmed, so the film is put together from them…'
      : `Approved by the user: ${approved.toFixed(2)} US dollars (estimate ${usd.toFixed(2)}; ledger in ${path.join(dir, 'spend')}). Filming…`);
    const r = await flow.film(dir, line);
    if (!r.ok) throw new Error(changedPipeline(r) ? `Filming didn't start: ${CHANGED}\n${restoreHint(dir)}` : 'Filming didn\'t finish. See the lines above.');
    say(`\nVideo: ${r.video}`);
    if (fs.existsSync(pl.editMasterOutput(dir))) say(`For CapCut: ${pl.editMasterOutput(dir)}`);
    return 0;
  }

  if (values.tighten) {
    // The Mac app's Refine step, free: the pauses are shortened on a copy of the film; the user watches it, then approves.
    if (!episode.canRun(st, 'refine')) throw new Error('Approve the film first.');
    flow.setTighten(dir, { on: values.tighten === 'on' });
    if (values.tighten === 'off') {
      say(`Tightening is off: the film is delivered as filmed${flow.deliversSpliced(dir) ? ', with the storyboard\'s pieces between slides in it' : ''}.`);
      return 0;
    }
    const python = numpyPython();
    if (!python) throw new Error('Tightening needs Python with numpy: the Mac app sets one up, or point FLPT_PYTHON at one.');
    const r = await flowFor(path.dirname(dir), { broker, pipeline: pl, redact: redactor(dir), motion: motionFor(pl), basePython: async () => python }).refine(dir, line);
    if (!r.ok) throw new Error(r.error || 'Tightening didn\'t finish.');
    say(`\nTightened: ${r.video}`);
    for (const n of r.notes || []) say(`  ${n}`);
    say(`Once the user approves it: node "${path.join(__dirname, 'flpt-episode.js')}" approve "${dir}" refine`);
    return 0;
  }

  if (values.captions) {
    // the app's Deliver toggle (api/delivery.js): the choice lives in the record's Deliver stage
    const r = app('api/delivery').setCaptions(dir, values.captions === 'on');
    say(r.captions ? 'Captions are on: Deliver writes presentation.srt beside the video.' : 'Captions are off.');
    return 0;
  }

  if (values.slack) {
    const r = await flow.slackPack(dir, path.resolve(values.slack.replace(/^~(?=$|\/)/, require('os').homedir())), line);
    if (!r.ok) throw new Error(r.error);
    say(`\nSlack pack, in ${r.folder}:`);
    for (const f of r.files) say(`  ${f}`);
    return 0;
  }

  const r = await flow.deliver(dir, line);
  say(`\nDelivered to ${r.folder}${r.playerOk ? '' : ' (the player page didn\'t build; the video is there)'}`);
  if (r.spliced) say('The video is the film with the storyboard\'s pieces between slides spliced in (nothing for Refine to add).');
  if ((r.extras || []).length) say(`Extras, levelled: ${path.join(r.folder, 'extras')}`);
  if (r.guide) say(`Clip guide: ${path.join(r.folder, 'CAPCUT_CLIP_GUIDE.md')}`);
  return 0;
});
