'use strict';
// flpt.studio: the Studio (PLAN §2.5, §3.3 S8b; W2-05). A Live Motion piece on the Stage, live, by its episode and key;
// the page never names a path. The Stage itself (play, seek, overlays, voice, sound, close) is flpt.stage.
//   open(episode, key, t?, sound?)  the piece on the Stage at t (its host page made from the crew's files, watched
//                                   while it's open): → { stage (the Stage's state), piece } where piece says what the
//                                   Studio offers (voices: draft, filmed · reference · bubble · sound · editable ·
//                                   stageApproved: Live Motion approved, so no takes, Ask, Again or Approve · asks:
//                                   flpt.livemotion.run takes Ask for changes' notes).
//                                   sound { music, sfx }: play it with this sound instead of its own (the picker's ▶)
//   snapshot(t)                     "Snapshot this frame": the open piece's exact frame at t from the final renderer,
//                                   in FLPT's sandbox, shown on the Stage beside its paused preview (its snapshot event)
//   sound(episode, key, value)      keep a sound for a piece (its plan and its storyboard shot), before Live Motion is
//                                   approved and while its crew isn't at work → { sound, piece }
// Nothing here costs anything or reaches the network.
const path = require('path');
const episode = require('../episode');
const livemotion = require('../livemotion');
const scenecrew = require('../scenecrew');
const studio = require('../studio');

/** The Stage host (ctx.stageHost: the Mac's shell/stage.js), or "No Stage here." */
const hostOf = (c) => { if (!c.stageHost) throw new Error('No Stage here.'); return c.stageHost; };

/** The episode folder, checked: inside the projects folder, with a record this FLPT can read. */
function dirOf(c, dir) {
  if (!c.flow || !c.flow.inProjects(dir)) throw new Error('That isn\'t an FLPT episode folder.');
  const d = path.resolve(dir);
  const why = episode.tooNew(episode.readRaw(d));
  if (why) throw new Error(why);
  return d;
}
const keyOf = (k) => { if (typeof k !== 'string' || !livemotion.KEY.test(k)) throw new Error('That isn\'t a Live Motion piece.'); return k; };

/** What the piece's parts need from this host: the engine, the styles as the flow sees them, the toolchain. */
function depsOf(c) {
  const ext = require('../ext/livemotion');
  const own = c.studio && typeof c.studio === 'object' ? c.studio : {}; // a host's own (a server's renderer, the tests' stand-ins)
  return { engineRoot: c.engineRoot, styles: ext.stylesOf({ engineRoot: c.engineRoot, settings: c.settings }), ...own };
}
/**
 * Does flpt.livemotion.run take Ask for changes' notes (its third argument)? The preload drops arguments past a
 * method's arity, so until it does the Studio offers Again alone: notes are never dropped on a run that costs.
 */
function asks() {
  try { const run = require('./livemotion').methods.run; return Array.isArray(run.args) && run.args.length >= 3; } catch { return false; }
}
const withAsks = (info) => (info ? { ...info, asks: asks() } : info);

/** The toolchain's environment, its node named, for the final renderer (no keys: toolEnv carries none). */
function envOf(c) {
  const env = { ...(typeof c.toolEnv === 'function' ? c.toolEnv() : {}), HOME: process.env.HOME, USER: process.env.USER, LANG: 'en_US.UTF-8', TMPDIR: process.env.TMPDIR };
  // the toolchain's node (never Electron's own binary, which would start another app); a QA run may name one
  const node = (typeof c.toolOf === 'function' && c.toolOf('node') && c.toolOf('node').path) || process.env.FLPT_NODE;
  if (node) env.FLPT_NODE = node;
  return env;
}

module.exports = {
  ns: 'studio',
  methods: {
    open: { args: ['episode', 'text:80', 'num?', 'json:512?'], handler: async (c, dir, key, t, sound) => {
      const host = hostOf(c);
      const d = dirOf(c, dir);
      const k = keyOf(key);
      const deps = depsOf(c);
      const parts = studio.piece(d, k, deps, { sound: sound || null }); // refuses a piece that isn't drawn yet
      const id = studio.idFor(d, k, { sound: sound ? studio.cleanSound(sound, deps) : null });
      const stage = await host.open({ source: studio.SOURCE, id, t: Number.isFinite(t) ? Math.max(0, t) : 0 });
      return { stage, piece: withAsks(parts.info) };
    } },
    snapshot: { args: ['num'], handler: async (c, t) => {
      const host = hostOf(c);
      const s = host.state();
      const e = s && s.open && s.source === studio.SOURCE ? studio.entryOf(s.id) : null;
      if (!e) throw new Error('No Live Motion piece is open.');
      const r = await studio.snapshot(e.dir, e.key, t, { ...depsOf(c), env: envOf(c) });
      if (!r.ok) throw new Error(r.problem);
      const now = host.state();
      if (!now.open || now.source !== s.source || now.id !== s.id) return { t: r.t, F: r.F, shown: false }; // closed meanwhile
      host.updateMedia({ media: { 'snapshot.png': r.file } });
      host.send({ cmd: 'snapshot', t: r.t });
      return { t: r.t, F: r.F, shown: true };
    } },
    sound: { args: ['episode', 'text:80', 'json:512'], handler: (c, dir, key, value) => {
      const d = dirOf(c, dir);
      const k = keyOf(key);
      if (scenecrew.isBusy(d)) throw new Error('The scene crews are at work.');
      const deps = depsOf(c);
      const sound = studio.setSound(d, k, value, deps);
      try { c.send('livemotion:changed', { dir: d, key: k }); } catch { /* no window */ }
      let info = null;
      try { info = withAsks(studio.piece(d, k, deps).info); } catch { info = null; }
      return { sound, piece: info };
    } },
  },
  events: [],
};
