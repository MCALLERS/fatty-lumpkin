#!/usr/bin/env node
'use strict';
// Spend, Film and Deliver, through the app's flow.js and pipeline.js:
//   --draft    free: the slides with the Mac's own voice, to check timing before paying
//   --check    free: the pipeline's --check (nothing is generated) and the app's estimate for filming
//   --final    paid: HeyGen, only with --approved <the amount the user said yes to>, never above it, and only after a
//              draft of the current script. The approval is the app's broker (a capped budget, one filming run), with
//              its ledger in <episode>/spend/.
//   --deliver  the web parts and the player page, copied to the deliveries folder
// Every line the pipeline prints is redacted (keys, and their masked forms) before it is shown.
const fs = require('fs');
const path = require('path');
const { app, episodeDir, pipeline, flowFor, brokerFor, redactor, library, cli, usageError, main, say } = require('./common');

const USAGE = `
Usage: flpt-film [<episode>] --draft | --check | --final --approved <US dollars> | --deliver
  --draft     free: the slides with the Mac's own voice and a placeholder presenter
  --check     free: the pipeline's checks (nothing is generated) and what filming would cost
  --final     paid: films with your HeyGen avatar, only after the user said yes to the estimate, with
              --approved <that amount>, and only once there's a draft of the current script
  --deliver   the web parts and the player page, copied to your deliveries folder
<episode> defaults to the one you're in, else the newest.`;

const OPTIONS = { draft: { type: 'boolean' }, check: { type: 'boolean' }, final: { type: 'boolean' }, deliver: { type: 'boolean' }, approved: { type: 'string' } };
const mtime = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
const heygenUsd = (est) => (est.byProvider.heygen ? est.byProvider.heygen.usd : 0);

main(async () => {
  const { positionals, values } = cli(USAGE, OPTIONS);
  const modes = ['draft', 'check', 'final', 'deliver'].filter((m) => values[m]);
  if (modes.length !== 1) usageError(USAGE, 'Pick one of --draft, --check, --final or --deliver.');
  if (values.approved != null && !values.final) usageError(USAGE, '--approved goes with --final.');
  if (values.final && !(Number(values.approved) > 0)) usageError(USAGE, '--final needs --approved <the amount the user said yes to, in US dollars>.');

  const dir = episodeDir(positionals[0]);
  const episode = app('episode');
  const st = episode.read(dir);
  if (!st) throw new Error(`${dir} has no flpt-project.json, so it isn't an FLPT episode.`);
  const broker = brokerFor(dir);
  const pl = pipeline(dir, { broker });
  const lib = library();
  const flow = flowFor(path.dirname(dir), {
    broker, pipeline: pl, redact: redactor(dir),
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
    const est = flow.spendEstimate(dir);
    const usd = heygenUsd(est);
    say('');
    say(usd ? `Estimate: about ${usd.toFixed(2)} US dollars. ${est.lines[0].label}, on HeyGen at 4.1 cents a second. The approval allows up to 15 % more, for re-tries.`
      : 'The script has no narration to film yet.');
    say(draftIsCurrent() ? 'Draft: there is one of the current script.' : 'Draft: none of the current script yet. Make it first (free) with --draft.');
    if (usd) say(`Only after the user says yes: node "${__filename}" "${dir}" --final --approved ${usd.toFixed(2)}`);
    return r.code === 0 ? 0 : 1;
  }

  if (values.final) {
    const approved = Number(values.approved);
    if (!episode.canRun(st, 'spend')) throw new Error('Approve the script first.');
    if (!draftIsCurrent()) throw new Error('Make the free draft of the current script first (--draft), so the user can check its timing before paying.');
    const usd = heygenUsd(flow.spendEstimate(dir));
    if (!usd) throw new Error('The script has no narration to film.');
    if (usd > approved + 0.005) throw new Error(`Filming now comes to about ${usd.toFixed(2)} US dollars, more than the ${approved.toFixed(2)} the user approved. Show them the new estimate (--check) and ask again.`);
    // An older approval for a shorter script can't cover this one: close it, so this run gets its own.
    const old = st.budgets && st.budgets.heygen;
    if (old && st.stages.spend.status === 'approved' && (st.stages.spend.usd || 0) + 0.005 < usd) broker.close(old);
    const a = await flow.approveSpend(dir);
    if (!a.ok) throw new Error('Filming wasn\'t approved.');
    say(`Approved by the user: ${approved.toFixed(2)} US dollars (estimate ${usd.toFixed(2)}; ledger in ${path.join(dir, 'spend')}). Filming…`);
    const r = await flow.film(dir, line);
    if (!r.ok) throw new Error('Filming didn\'t finish. See the lines above.');
    say(`\nVideo: ${r.video}`);
    if (fs.existsSync(pl.editMasterOutput(dir))) say(`For CapCut: ${pl.editMasterOutput(dir)}`);
    return 0;
  }

  const r = await flow.deliver(dir, line);
  say(`\nDelivered to ${r.folder}${r.playerOk ? '' : ' (the player page didn\'t build; the video is there)'}`);
  return 0;
});
