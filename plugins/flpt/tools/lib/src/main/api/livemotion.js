'use strict';
// flpt.livemotion: the Live Motion pieces (W2-02; PLAN §2.3, §2.7, §2.9). The page names an episode and a piece's key
// (slide:<id> or between:<id>); every path, price and cap is worked out here, in main.
//   view(episode)              the pieces as the Live Motion wall draws them (livemotion.view), and whether the crews
//                              are at work
//   run(episode, key?, notes?) the scene crews for every piece that needs one (or that one, with the user's notes): its cap
//                              reserved on the episode's Claude planning budget first (the native dialog only when
//                              the plan's cap isn't approved yet), then the crews, a few at a time
//   cancel(episode)            stop them (each settles at what it really cost)
//   useTake(episode, key, n)   a piece back to one of its takes (free)
//   approve(episode, key)      one piece approved, with the on-screen words that aren't in the script or the deck
//                              already shown in its view
//   drawInCode(episode, key)   a Cosmos or cut scene drawn in code from now on (the Scenes step's ghost button):
//                              its plan changes, the deck isn't staled; after Spend, Spend opens again (T20)
//   render(episode, key)       a piece between slides rendered for the splice now (free; finished pieces only)
//   page(episode, key, host)   the piece's host page made again in its folder ('hf' or 'preview': the Stage's)
// Event: livemotion:changed { dir, key? } after every change made here.
const path = require('path');
const episode = require('../episode');
const livemotion = require('../livemotion');
const scenecrew = require('../scenecrew');
const animators = require('../animators');
const plan = require('../ext/livemotion');

/** The episode folder, checked: inside the projects folder, with a record this FLPT can read. */
function dirOf(c, dir) {
  if (!c.flow || !c.flow.inProjects(dir)) throw new Error('That isn\'t an FLPT episode folder.');
  const d = path.resolve(dir);
  const why = episode.tooNew(episode.readRaw(d));
  if (why) throw new Error(why);
  return d;
}
const keyOf = (k) => { if (typeof k !== 'string' || !livemotion.KEY.test(k)) throw new Error('That isn\'t a Live Motion piece.'); return k; };
const changed = (c, dir, key) => { try { c.send('livemotion:changed', key ? { dir, key } : { dir }); } catch { /* no window */ } };
/** Once Live Motion is approved, a piece's take, approval and crew stay as they were approved (W2-05 handoff 11). */
function notApproved(dir) {
  const st = episode.read(dir);
  if (st && st.stages && st.stages.animate && st.stages.animate.status === 'approved') throw new Error('Live Motion is approved.');
}

/** The flow's host as ext/livemotion sees it (engine, toolchain, styles, the pipeline's sandboxed scripts). */
const hostOf = (c) => ({ engineRoot: c.engineRoot, toolEnv: c.toolEnv, settings: c.settings, pipeline: c.pipeline });

/**
 * Reserve each piece's cap on the episode's Claude planning budget. The flow's own reservation when it offers one
 * (flow.reservePlanning: the first approval, or one top-up for the shortfall), else: the plan's cap approved through
 * flow.topUpPlanning (its lines count every Live Motion piece), then each piece reserved on it, in order, until one
 * doesn't fit. → { token, pieces } or null
 */
async function reserve(c, dir, pieces) {
  if (typeof c.flow.reservePlanning === 'function') return c.flow.reservePlanning(dir, pieces, 'plan');
  const top = await c.flow.topUpPlanning(dir, 'plan');
  if (!top || !top.ok) return null;
  const st = episode.read(dir);
  const token = st && st.budgets && st.budgets.anthropic;
  if (!token || !c.broker.isLive(token, 'anthropic')) return null;
  const got = [];
  for (const p of pieces) {
    try { c.broker.authorize(token, 'anthropic', { usd: p.usd, what: p.what }); got.push(p); } catch { break; }
  }
  if (!got.length) throw new Error('The Claude budget has less left than one Live Motion piece needs.');
  return { token, pieces: got };
}

/** The crews' in-process tools for one piece, as the app runs them: sandboxed, with the toolchain (no keys). */
function toolsFor(c, styles) {
  return (dir, key, signal) => {
    const env = { ...c.toolEnv(), HOME: process.env.HOME, USER: process.env.USER, LANG: 'en_US.UTF-8', TMPDIR: process.env.TMPDIR };
    const node = c.toolOf && c.toolOf('node') && c.toolOf('node').path;
    if (node) env.FLPT_NODE = node;
    const hidden = typeof c.appPrivate === 'function' ? c.appPrivate() : [];
    return scenecrew.makeTools(dir, key, c.engineRoot, {
      env, styles, signal, exec: animators.createExec({ env, hidden }), retime: (args, o = {}) => c.pipeline.retime(dir, args, o),
      library: livemotion.shippedLibrary(c.engineRoot), files: plan.soundFiles(dir),
    });
  };
}

module.exports = {
  ns: 'livemotion',
  methods: {
    view: { args: ['episode'], handler: (c, dir) => {
      const d = dirOf(c, dir);
      return { pieces: livemotion.view(d), running: scenecrew.isBusy(d), parallel: animators.PARALLEL };
    } },
    // notes: the Studio's Ask for changes, given to the crew as the user's feedback (W2-05 handoff 3)
    run: { args: ['episode', 'text:80?', 'text:2000?'], handler: async (c, dir, key, notes) => {
      const d = dirOf(c, dir);
      const keys = key == null || key === '' ? null : [keyOf(key)];
      // every piece's crew too (W3-03's finding): once Live Motion is approved, Make all doesn't run crews again
      notApproved(d);
      const feedback = typeof notes === 'string' ? notes.trim() : '';
      const apiKey = c.vault.get('ANTHROPIC_API_KEY');
      if (!apiKey) throw new Error('Add your Anthropic key in Setup → Keys first.');
      const hf = c.toolOf && c.toolOf('hyperframes');
      if (!hf || !hf.ok) throw new Error('Live Motion needs HyperFrames (Setup → Tools).');
      const styles = plan.stylesOf(hostOf(c));
      const sdk = typeof c.loadSdk === 'function' ? await c.loadSdk() : await import('@anthropic-ai/claude-agent-sdk');
      const r = await scenecrew.runPieces(d, { keys, feedback }, {
        sdk, z: require('zod').z, apiKey, toolEnvPath: c.toolEnv().PATH, configDir: path.join(c.dirs.userData, 'claude'),
        executable: typeof c.agentExecutable === 'function' ? c.agentExecutable() : undefined, engineRoot: c.engineRoot, broker: c.broker, styles,
        reserve: (dd, pieces) => reserve(c, dd, pieces), toolsFor: toolsFor(c, styles), send: (ch, p) => c.send(ch, p), redact: c.redact,
      });
      changed(c, d);
      return { ...r, view: livemotion.view(d) };
    } },
    cancel: { args: ['episode'], handler: (c, dir) => scenecrew.cancel(dirOf(c, dir)) },
    useTake: { args: ['episode', 'text:80', 'num'], handler: (c, dir, key, n) => {
      const d = dirOf(c, dir);
      if (scenecrew.isBusy(d)) throw new Error('The scene crews are at work.');
      notApproved(d);
      const p = livemotion.pieceOf(d, keyOf(key));
      livemotion.useTake(d, p, n);
      livemotion.noteLive(d, p, { status: livemotion.recordOf(d, p).ok ? 'ok' : 'failed', current: Math.round(n), approved: false });
      changed(c, d, p.key);
      return livemotion.view(d);
    } },
    approve: { args: ['episode', 'text:80'], handler: (c, dir, key) => {
      const d = dirOf(c, dir);
      if (scenecrew.isBusy(d)) throw new Error('The scene crews are at work.');
      notApproved(d);
      const p = livemotion.pieceOf(d, keyOf(key));
      const rec = livemotion.recordOf(d, p);
      if (!rec || rec.key !== p.key || !rec.ok) throw new Error('That piece isn\'t made yet.');
      livemotion.noteLive(d, p, { approved: true, approvedBy: 'you' });
      changed(c, d, p.key);
      return livemotion.view(d);
    } },
    drawInCode: { args: ['episode', 'text:80'], handler: (c, dir, key) => {
      const d = dirOf(c, dir);
      if (scenecrew.isBusy(d)) throw new Error('The scene crews are at work.');
      const r = livemotion.drawInCode(d, String(key), { broker: c.broker });
      changed(c, d, r.key);
      return { ...r, view: livemotion.view(d) };
    } },
    render: { args: ['episode', 'text:80'], handler: async (c, dir, key) => {
      const d = dirOf(c, dir);
      if (scenecrew.isBusy(d)) throw new Error('The scene crews are at work.');
      const p = livemotion.pieceOf(d, keyOf(key));
      const r = await livemotion.renderInterstitial(d, p, plan.depsFrom(hostOf(c), d));
      changed(c, d, p.key);
      return { ok: r.ok, seconds: r.seconds || null, audio: r.audio || null, problems: r.problems };
    } },
    page: { args: ['episode', 'text:80', 'text:16?'], handler: async (c, dir, key, host) => {
      const d = dirOf(c, dir);
      const p = livemotion.pieceOf(d, keyOf(key));
      const r = await livemotion.page(d, p, { ...plan.depsFrom(hostOf(c), d), host: host === 'preview' ? 'preview' : 'hf' });
      return { duration: r.duration, frames: r.frames, style: r.style };
    } },
  },
  events: ['livemotion:changed'],
};
