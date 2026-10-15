#!/usr/bin/env node
'use strict';
// Spend, Film and Deliver, through the app's flow.js and pipeline.js:
//   --draft    free: the slides with the Mac's own voice, to check timing before paying
//   --check    free: the pipeline's --check (nothing is generated) and the app's estimate for filming
//   --final    paid: HeyGen, only with --approved <the amount the user said yes to>, never above it, and only after a
//              draft of the current script. The approval is the app's broker (a capped budget, one filming run), with
//              its ledger in <episode>/spend/.
//   --tighten  free: the film's over-long pauses shortened, picture and sound in sync (the Mac app's Refine step)
//   --deliver  the web parts, the player page and the extras (levelled, with a clip guide), copied to the deliveries folder
//   --slack    free: the Slack pack from the user's own export (after their edit), beside the deliveries
// Every line the pipeline prints is redacted (keys, and their masked forms) before it is shown.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { app, places, tools, episodeDir, pipeline, flowFor, brokerFor, redactor, library, motionFor, cli, usageError, main, say } = require('./common');

const USAGE = `
Usage: flpt-film [<episode>] --draft | --check | --final --approved <US dollars> | --tighten on|off | --deliver | --slack <export>
  --draft     free: the slides with the Mac's own voice and a placeholder presenter
  --check     free: the pipeline's checks (nothing is generated) and what filming would cost
  --final     paid: films with your HeyGen avatar, only after the user said yes to the estimate, with
              --approved <that amount>, and only once there's a draft of the current script
  --tighten   free: on shortens the film's over-long pauses (picture and sound stay in sync); off undoes it
  --deliver   the web parts, the player page and the extras (levelled, with a clip guide), copied to your deliveries folder
  --slack     free: the Slack pack (the (vF), a 1.25x cut, an MP3 and a cover) from your own export, after your edit
<episode> defaults to the one you're in, else the newest.`;

const OPTIONS = { draft: { type: 'boolean' }, check: { type: 'boolean' }, final: { type: 'boolean' }, deliver: { type: 'boolean' }, approved: { type: 'string' },
  tighten: { type: 'string' }, slack: { type: 'string' } };
const mtime = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
/** A Python with numpy, for tighten.py: FLPT_PYTHON, the Mac app's own, or python3 (the first that has it), or null. */
const numpyPython = () => [process.env.FLPT_PYTHON, path.join(places().userData, 'toolchain', 'venv', 'bin', 'python'), tools().python]
  .filter((p) => p && path.isAbsolute(p) && fs.existsSync(p)).find((p) => spawnSync(p, ['-c', 'import numpy'], { stdio: 'ignore', timeout: 30000 }).status === 0) || null;
const heygenUsd = (est) => (est.byProvider.heygen ? est.byProvider.heygen.usd : 0);
// Every avatar clip is already filmed (the pipeline counted what isn't): nothing to pay.
const nothingToPay = (est) => Boolean(!heygenUsd(est) && est.film && est.film.nothing);

main(async () => {
  const { positionals, values } = cli(USAGE, OPTIONS);
  const modes = ['draft', 'check', 'final', 'tighten', 'deliver', 'slack'].filter((m) => values[m] != null && values[m] !== false);
  if (modes.length !== 1) usageError(USAGE, 'Pick one of --draft, --check, --final, --tighten, --deliver or --slack.');
  if (values.approved != null && !values.final) usageError(USAGE, '--approved goes with --final.');
  if (values.tighten != null && !['on', 'off'].includes(values.tighten)) usageError(USAGE, '--tighten is on or off.');
  if (values.final && !/^\d+(\.\d+)?$/.test(String(values.approved || ''))) usageError(USAGE, '--final needs --approved <the amount the user said yes to, in US dollars>.');

  const dir = episodeDir(positionals[0]);
  const episode = app('episode');
  const st = episode.read(dir);
  if (!st) throw new Error(`${dir} has no flpt-project.json, so it isn't an FLPT episode.`);
  const broker = brokerFor(dir);
  const pl = pipeline(dir, { broker });
  const lib = library();
  const flow = flowFor(path.dirname(dir), {
    broker, pipeline: pl, redact: redactor(dir), motion: motionFor(pl),
    confirm: async () => true, // the user's yes was given in chat, for the amount passed with --approved (checked below)
    keep: (d, id, extra) => app('crew-library').keep(lib, d, id, extra),
  });
  const line = (l) => say(l);
  const draftIsCurrent = () => mtime(pl.draftOutput(dir)) >= mtime(path.join(dir, 'presentation', 'script.md'));
  if (!fs.existsSync(pl.projectPython(dir))) throw new Error('This episode has no Python environment (presentation/video/.venv). Run /flpt:check-deck once to see how to make it.');
  say(`Episode: ${dir}`);

  if (values.draft) {
    const r = await flow.draft(dir, line);
    if (!r.ok) throw new Error(r.error);
    say(`\nDraft: ${r.video}`);
    return 0;
  }

  if (values.check) {
    const r1 = await pl.render(dir, { onLine: line });
    if (r1.code !== 0) throw new Error('The slides didn\'t render.');
    const r = await pl.check(dir, { onLine: line });
    const est = await flow.spendEstimate(dir);
    const usd = heygenUsd(est);
    const voice = est.lines.some((l) => l.rate === 'heygen_tts_s');
    say('');
    if (usd) say(`Estimate: about ${usd.toFixed(2)} US dollars on HeyGen. ${est.lines.map((l) => l.label).join('; ')}: 4.1 cents a second of avatar video${voice ? ', 0.2 cents of voice alone' : ''}. The approval allows up to 15 % more, for re-tries.`);
    else say(nothingToPay(est) ? `Nothing to pay: ${est.film.total ? `all ${est.film.total} avatar clips are` : 'everything is'} already filmed.` : 'The script has no narration to film yet.');
    say(draftIsCurrent() ? 'Draft: there is one of the current script.' : 'Draft: none of the current script yet. Make it first (free) with --draft.');
    if (usd || nothingToPay(est)) say(`Only after the user says yes: node "${__filename}" "${dir}" --final --approved ${usd.toFixed(2)}`);
    return r.code === 0 ? 0 : 1;
  }

  if (values.final) {
    const approved = Number(values.approved);
    // Scenes (the Mac app's cartoons and cut scenes) is approved on the way when none is planned; else the user decides.
    const ready = flow.passScenes(dir);
    if (!episode.canRun(ready, 'spend')) throw new Error(app('flow').spendBlocked(ready));
    if (!draftIsCurrent()) throw new Error('Make the free draft of the current script first (--draft), so the user can check its timing before paying.');
    const est = await flow.spendEstimate(dir);
    const usd = heygenUsd(est);
    if (!usd && !nothingToPay(est)) throw new Error('The script has no narration to film.');
    if (usd > approved + 0.005) throw new Error(`Filming now comes to about ${usd.toFixed(2)} US dollars, more than the ${approved.toFixed(2)} the user approved. Show them the new estimate (--check) and ask again.`);
    // An older approval for a shorter script can't cover this one: close it, so this run gets its own.
    const old = st.budgets && st.budgets.heygen;
    if (old && st.stages.spend.status === 'approved' && (st.stages.spend.usd || 0) + 0.005 < usd) broker.close(old);
    const a = await flow.approveSpend(dir);
    if (!a.ok) throw new Error('Filming wasn\'t approved.');
    say(a.free ? 'Nothing to pay: every avatar clip is already filmed, so the film is put together from them…'
      : `Approved by the user: ${approved.toFixed(2)} US dollars (estimate ${usd.toFixed(2)}; ledger in ${path.join(dir, 'spend')}). Filming…`);
    const r = await flow.film(dir, line);
    if (!r.ok) throw new Error('Filming didn\'t finish. See the lines above.');
    say(`\nVideo: ${r.video}`);
    if (fs.existsSync(pl.editMasterOutput(dir))) say(`For CapCut: ${pl.editMasterOutput(dir)}`);
    return 0;
  }

  if (values.tighten) {
    // The Mac app's Refine step, free: the pauses are shortened on a copy of the film; the user watches it, then approves.
    if (!episode.canRun(st, 'refine')) throw new Error('Approve the film first.');
    flow.setTighten(dir, { on: values.tighten === 'on' });
    if (values.tighten === 'off') { say('Tightening is off: the film is delivered as filmed.'); return 0; }
    const python = numpyPython();
    if (!python) throw new Error('Tightening needs Python with numpy: the Mac app sets one up, or point FLPT_PYTHON at one.');
    const r = await flowFor(path.dirname(dir), { broker, pipeline: pl, redact: redactor(dir), motion: motionFor(pl), basePython: async () => python }).refine(dir, line);
    if (!r.ok) throw new Error(r.error || 'Tightening didn\'t finish.');
    say(`\nTightened: ${r.video}`);
    for (const n of r.notes || []) say(`  ${n}`);
    say(`Once the user approves it: node "${path.join(__dirname, 'flpt-episode.js')}" approve "${dir}" refine`);
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
  if ((r.extras || []).length) say(`Extras, levelled: ${path.join(r.folder, 'extras')}`);
  if (r.guide) say(`Clip guide: ${path.join(r.folder, 'CAPCUT_CLIP_GUIDE.md')}`);
  return 0;
});
