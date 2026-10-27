'use strict';
// 0.7.1's episode methods behind the bridge contract (bridge-contract.js), unchanged in behaviour: the episodes list,
// each step, the user's calls, Scenes, Refine's add-ons, the pipeline steps (as jobs, so the log panel shows their lines
// and its Stop button works), and files picked in a native dialog or dropped on the window. The page names an episode
// and what to do; paths are worked out here (a dropped file's path comes from the preload, never from page code).
// Each keeps the name the page has always called it by (`expose`); the page gets { ok, value } or { ok: false, error }.
const fs = require('fs');
const modules = require('../modules');

// Files for a call or a new episode: the page gets back a token and the files' names (and the likely module).
// macOS's file picker shows the Photos library, but its pictures aren't files it hands over: said in the picker itself
const FROM_PHOTOS = 'From Photos: export the picture first (File → Export), then pick it here.';
const DOCS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif', 'mp4', 'mov', 'm4v', 'pdf', 'txt', 'md', 'rtf', 'docx', 'html', 'htm'];
const held = (c, paths) => { const s = c.staging.stage(paths); return { ...s, guess: modules.guessFor(s.files) }; };

/** A pipeline step as a job: the log panel shows its lines and its Stop button works. */
const asJob = (label, fn) => async (c, dir, ...rest) => {
  const job = c.startJob(label);
  let r = { ok: false };
  try { r = await fn(c, dir, job, ...rest); return r; } finally { job.finish({ code: r.ok ? 0 : 1 }); }
};
const slackJob = asJob('Making the Slack pack', (c, dir, job, file) => c.flow.slackPack(dir, file, job.onLine, job.signal));
const made = (c, r, key) => { if (r[key]) c.produced.add(r[key]); return r; };

const episodes = {
  ns: 'episodes',
  methods: {
    list: { args: [], expose: 'episodes', handler: (c) => c.flow.list() },
  },
};

const files = {
  ns: 'files',
  methods: {
    pick: { args: [], expose: 'pickFiles', handler: async (c) => {
      const r = await c.dialogs.open({ title: 'Add a photo, a clip or a document', message: FROM_PHOTOS, properties: ['openFile', 'multiSelections'], filters: [{ name: 'Photos, clips and documents', extensions: DOCS }] });
      return r.canceled || !r.filePaths.length ? null : held(c, r.filePaths);
    } },
    stage: { args: ['dropped'], expose: 'stageDropped', handler: (c, paths) => held(c, paths) },
  },
};

const refine = {
  ns: 'refine',
  methods: {
    // Refine: add-ons on the finished film. A file the page picked or dropped is held here behind a token.
    pick: { args: ['text:16?'], expose: 'pickAddonFile', handler: async (c, kind) => {
      const audio = kind === 'audio';
      const r = await c.dialogs.open({ title: audio ? 'Add music' : 'Add a video', properties: ['openFile'],
        filters: [{ name: audio ? 'Sound' : 'Video', extensions: audio ? ['mp3', 'm4a', 'wav', 'aif', 'aiff', 'aac', 'flac', 'ogg'] : ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'] }] });
      return r.canceled || !r.filePaths.length ? null : c.addonStaging.stage(r.filePaths.slice(0, 1));
    } },
    stage: { args: ['dropped'], expose: 'stageAddonDropped', handler: (c, paths) => c.addonStaging.stage((Array.isArray(paths) ? paths : []).slice(0, 1)) },
  },
};

const episode = {
  ns: 'episode',
  methods: {
    create: { args: ['json:4194304?'], expose: 'createEpisode', handler: (c, intake) => c.flow.create(intake, intake && intake.staged ? [].concat(intake.staged).flatMap((t) => c.staging.take(t)) : []) },
    open: { args: ['episode'], expose: 'openEpisode', handler: (c, dir) => c.flow.open(dir) },
    run: { args: ['episode', 'stage', 'text:100000?'], expose: 'runStage', handler: (c, dir, stage, feedback) => c.flow.runStage(dir, stage, feedback) },
    // The animator crew: every marked slide, or one ({ slide: n }), with the user's notes ({ feedback }).
    animate: { args: ['episode', 'json?'], expose: 'animate', handler: (c, dir, opts) => c.flow.animate(dir, { slide: opts && opts.slide != null ? Number(opts.slide) : null,
      feedback: opts && typeof opts.feedback === 'string' ? opts.feedback.slice(0, 4000) : '' }) },
    cancel: { args: ['episode'], expose: 'cancelStage', handler: (c, dir) => c.flow.cancel(dir) },
    approve: { args: ['episode', 'stage'], expose: 'approveStage', handler: (c, dir, stage) => c.flow.approve(dir, stage) },
    // Fact-check, skipped: the claims go into the deck unchecked (2.0.1)
    skipFactcheck: { args: ['episode'], expose: 'episode.skipFactcheck', handler: (c, dir) => c.flow.approve(dir, 'factcheck', { skip: true }) },
    // Your answers to a crew's questions, for every later crew (presentation/answers.md, 2.0.1)
    answer: { args: ['episode', 'stage', 'text:8000?'], expose: 'episode.answer', handler: (c, dir, stage, text) => c.flow.saveAnswers(dir, stage, text) },
    save: { args: ['episode', 'id', 'text:400000?'], expose: 'saveEpisodeFile', handler: (c, dir, which, text) => c.flow.saveFile(dir, which, text) },
    estimate: { args: ['episode'], expose: 'spendEstimate', handler: (c, dir) => c.flow.spendEstimate(dir) },
    // The user's calls for the deck: a module, where, what to do, and any files or links to use.
    addCall: { args: ['episode', 'json?'], expose: 'addCall', handler: async (c, dir, call) => {
      const v = c.flow.addCall(dir, call);
      return call && call.staged ? c.flow.attachFiles(dir, v.calls.at(-1).id, c.staging.take(call.staged)) : v;
    } },
    dropOnCall: { args: ['episode', 'id', 'dropped'], expose: 'dropOnCall', handler: (c, dir, id, paths) => c.flow.attachFiles(dir, id, paths) },
    removeCall: { args: ['episode', 'id'], expose: 'removeCall', handler: (c, dir, id) => c.flow.removeCall(dir, id) },
    addCallLink: { args: ['episode', 'id', 'text:4096?'], expose: 'addCallLink', handler: (c, dir, id, url) => c.flow.addCallLink(dir, id, url) },
    attachLibrary: { args: ['episode', 'id', 'id:128'], expose: 'attachLibraryItem', handler: async (c, dir, id, itemId) => {
      const lib = c.getLibrary();
      if (!lib) throw new Error('The Library isn\'t ready yet.');
      const it = lib.get(itemId);
      const v = it.filePath ? await c.flow.attachFiles(dir, id, [it.filePath]) : it.source && it.source.url ? c.flow.addCallLink(dir, id, it.source.url) : null;
      if (!v) throw new Error('That item has nothing to attach.');
      lib.markUsed(it.id, v.state.title);
      return v;
    } },
    attach: { args: ['episode', 'id'], expose: 'attachToCall', handler: async (c, dir, id) => {
      const r = await c.dialogs.open({ title: 'Attach to this call', message: FROM_PHOTOS, properties: ['openFile', 'multiSelections'], filters: [{ name: 'Photos, clips and documents', extensions: DOCS }] });
      return r.canceled || !r.filePaths.length ? c.flow.open(dir) : c.flow.attachFiles(dir, id, r.filePaths);
    } },
    approveSpend: { args: ['episode'], expose: 'approveSpend', handler: (c, dir) => c.flow.approveSpend(dir) },
    // Scenes: the page names a piece, an action and a part; what it costs and what it makes is decided here.
    scene: { args: ['episode', 'json?'], expose: 'sceneAction', handler: (c, dir, act) => c.flow.sceneAction(dir, act && typeof act === 'object' ? { key: act.key, action: act.action, slot: act.slot } : {}) },
    // Refine: the page names what to add (a Library item, a Transitions & Music item, or a file it picked or dropped,
    // held here behind a token) and where; the path is worked out here, never sent in.
    addAddon: { args: ['episode', 'json?'], expose: 'addAddon', handler: (c, dir, spec) => c.addAddonFrom(dir, spec) },
    removeAddon: { args: ['episode', 'id'], expose: 'removeAddon', handler: (c, dir, id) => c.flow.removeAddon(dir, id) },
    draft: { args: ['episode'], expose: 'draft', handler: asJob('Free draft (the Mac\'s voice)', async (c, dir, job) => made(c, await c.flow.draft(dir, job.onLine, job.signal), 'video')) },
    film: { args: ['episode'], expose: 'film', handler: asJob('Filming', async (c, dir, job) => made(c, await c.flow.film(dir, job.onLine, job.signal), 'video')) },
    tighten: { args: ['episode', 'json?'], expose: 'setTighten', handler: (c, dir, t) => c.flow.setTighten(dir, t) },
    refine: { args: ['episode'], expose: 'refine', handler: asJob('Refining (ffmpeg)', async (c, dir, job) => made(c, await c.flow.refine(dir, job.onLine, job.signal), 'video')) },
    deliver: { args: ['episode'], expose: 'deliver', handler: asJob('Delivering', async (c, dir, job) => made(c, await c.flow.deliver(dir, job.onLine, job.signal), 'folder')) },
    // The Slack pack, from the user's own export: picked in the native dialog, or dropped (its path comes from the preload).
    slackPick: { args: ['episode'], expose: 'slackPick', handler: async (c, dir) => {
      let at; // the picker opens at the delivery
      try { at = c.flow.open(dir).state.stages.deliver.folder || undefined; } catch { at = undefined; }
      const r = await c.dialogs.open({ title: 'Your CapCut export', message: 'Pick the video you exported from CapCut after your edit.', defaultPath: at,
        properties: ['openFile'], filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'm4v'] }] });
      return r.canceled || !r.filePaths.length ? { ok: false, cancelled: true } : slackJob(c, dir, r.filePaths[0]);
    } },
    // The Slack pack from the video Deliver made, when there's no edit of your own (2.0.1)
    slackDelivered: { args: ['episode'], expose: 'episode.slackDelivered', handler: (c, dir) => {
      const del = c.flow.open(dir).state.stages.deliver;
      if (!del.video || !fs.existsSync(del.video)) throw new Error('Deliver again first: this delivery is from before 2.0.1.');
      return slackJob(c, dir, del.video);
    } },
    slackPack: { args: ['episode', 'dropped1'], expose: 'slackDrop', handler: (c, dir, file) => slackJob(c, dir, file) },
  },
  events: [
    { name: 'agent:event', expose: 'onAgent' },
    // Scenes: a still or shot on its way (generate:event), and one landed or put together (scenes:changed).
    { name: 'scenes:changed', expose: 'onScenes' },
    { name: 'generate:event', expose: 'onGenerate' },
  ],
};

module.exports = [episodes, episode, files, refine];
