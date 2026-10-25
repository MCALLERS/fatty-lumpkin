'use strict';
// Paid generation. B-roll into the Library: one Seedance shot that pays off a line of the script ("wiped out by
// space ninjas in F-16s"), made on Kie.ai or Higgsfield (settings.providers.video picks the default). And the Scenes
// step's stills and shots for Cosmos cartoons and cut scenes (scenes.js says what each step makes), into the episode.
//
// The order never changes: an itemised estimate (the main process prices it; never the page) → the user's yes in a
// native dialog that states the amount (Cancel is the default) → a budget token for exactly that → authorize → the
// job at the provider → its id in the ledger → poll → download → the Library (or the episode) → settle to the real
// cost → close. B-roll is one job per approval; a Scenes step is one approval for its few jobs (four keyframes, say),
// each authorized on its own, and its token closes when the last one ends. A no starts nothing. A refused start
// settles to zero; a start that may or may not have reached Kie.ai keeps its whole reservation (it may be billed) and
// is never sent again.
//
// And (W3-10) "Cartoon you"'s plates and parts, into the presenter's own folder (likeness.js says what each step makes):
// one approval per step, its reserve of re-tries kept on the same budget until the free checks say whether it's needed.
//
// A job is written to <userData>/generate/jobs.json as soon as the provider accepts it, so it outlives the app:
// resume() finishes anything left over. It polls and downloads; it never submits again, except Higgsfield's
// documented replay of an unconfirmed start, which carries the same Idempotency-Key and so can't start a second job.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const providers = require('./providers');
const { ProviderError } = require('./providers/http');
const scenes = require('./scenes');
const { estimate, RATES } = require('./broker');

const BROLL = { durations: [5, 10], resolutions: ['720p', '1080p'], aspect: '16:9', audio: true };
const MAX_VIDEO_BYTES = 1 << 30;
const RETENTION_DAYS = { kie: 14, higgsfield: 7 }; // how long each provider keeps a result

// ── the shot ──────────────────────────────────────────────────────────────────────────────────────────────────

/** A line as pasted from script.md, reduced to its words: no [pause] tags, stage-note markers, markdown or quotes. */
function cleanLine(text) {
  let s = String(text == null ? '' : text)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\[[^\]\n]{1,40}\]/g, ' ')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*#+\s*/gm, '')
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(stage note|b-?roll(\s+payoff)?)\s*:\s*/i, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim();
  if (s.length > 600) {
    const cut = s.slice(0, 600);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    s = end > 200 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(' ') > 400 ? cut.lastIndexOf(' ') : 600);
  }
  return s;
}

/**
 * The line made into a concrete, cinematic shot, with the house rules every generated picture follows: no text in
 * the picture, no logos or brands, no real or famous people (or look-alikes), no music or speech.
 */
function shotPrompt(line, { duration = 5 } = {}) {
  const subject = cleanLine(line) || 'a quiet, ordinary moment';
  return [
    `Cinematic B-roll that shows this literally and concretely: ${/[.!?…]$/.test(subject) ? subject : `${subject}.`}`,
    `One continuous ${duration}-second shot in 16:9: one clear subject and one simple action in a real, specific place. `
      + 'A slow, deliberate camera move (a gentle push-in or a lateral dolly), shallow depth of field, 35 mm film look, '
      + 'natural motivated light, soft grain, documentary colour.',
    'Sound: the ambient sound of the scene only. No music, no voices, no dialogue.',
    'No text, captions, subtitles, signs or lettering of any kind. No logos, brands or trademarks. No real or famous '
      + 'people and no look-alikes: anyone in the shot is an anonymous stranger, seen at a distance or from behind.',
  ].join('\n\n');
}

/** A Library title for the shot: the line itself, kept short. */
function titleFor(line) {
  let s = cleanLine(line).replace(/[.!?…]+$/, '');
  if (s.length > 90) {
    s = s.slice(0, 90);
    const i = s.lastIndexOf(' ');
    s = `${i > 50 ? s.slice(0, i) : s}…`;
  }
  return s ? s[0].toUpperCase() + s.slice(1) : 'B-roll';
}

// ── jobs that outlive the app ────────────────────────────────────────────────────────────────────────────────

function createStore(dir) {
  const file = path.join(dir, 'jobs.json');
  const read = () => {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      return j && j.v === 1 && j.jobs && typeof j.jobs === 'object' ? j : { v: 1, jobs: {} };
    } catch { return { v: 1, jobs: {} }; }
  };
  const write = (j) => {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(j, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  };
  return {
    file,
    list: () => Object.values(read().jobs),
    put: (job) => { const j = read(); j.jobs[job.id] = job; write(j); },
    remove: (id) => { const j = read(); if (j.jobs[id]) { delete j.jobs[id]; write(j); } },
  };
}

// ── the generator ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} d
 *   dir          <userData>/generate (the pending-jobs file)
 *   broker, vault, settings
 *   library      () => the Library (library.js), or null before it's ready
 *   confirm      async ({ title, message, detail, button }) => boolean: the native dialog, Cancel the default
 *   send         (event) => void: progress for the windows ({ id, kind, title, name, phase, progress, elapsed, message, itemId })
 *   redact, log, fetch, bases (providers.qaBases()), sleep, now, timeouts, approvedBy
 *   pollTimeoutMs   how long to wait on one job before leaving it for later (default an hour)
 *   retryMs         when to look again at a job left for later (default two minutes)
 */
function createGenerator(d) {
  const store = createStore(d.dir);
  const active = new Map(); // job id → the promise finishing it
  const log = d.log || (() => {});
  const now = d.now || Date.now;
  let making = false;
  let resumeTimer = null;
  const clientFor = (id) => providers.client(id, { vault: d.vault, fetch: d.fetch, redact: d.redact, bases: d.bases, sleep: d.sleep, now: d.now, timeouts: d.timeouts });
  // Every message that leaves here (to the page, the ledger or a log) goes through the app's redactor first.
  const said = (e) => { const m = (e && e.message) || String(e); return d.redact ? d.redact(m) : m; };
  const emit = (job, phase, extra = {}) => {
    const where = job.kind === 'scene' ? { title: job.what, dir: job.dir, key: job.piece, slot: job.slot } : job.kind === 'likeness' ? { title: job.title, key: job.key } : { title: job.title };
    try { d.send({ id: job.id, kind: job.kind, provider: job.provider, name: job.providerName, phase, ...where, ...extra }); } catch { /* no window */ }
  };

  function brollForm(raw = {}) {
    const r = raw && typeof raw === 'object' ? raw : {};
    return {
      provider: providers.IDS.includes(r.provider) ? r.provider : providers.route(d.settings.read(), 'video'),
      // Michael's default (2026-10-14): 10 s at 1080p with sound, like the payoffs in his own films
      duration: BROLL.durations.includes(Number(r.duration)) ? Number(r.duration) : 10,
      resolution: BROLL.resolutions.includes(r.resolution) ? r.resolution : '1080p',
      line: cleanLine(typeof r.text === 'string' ? r.text.slice(0, 4000) : ''),
    };
  }
  const videoParams = (f, prompt) => ({ prompt, duration: f.duration, resolution: f.resolution, aspect: BROLL.aspect, audio: BROLL.audio });

  /** A shot's price: the table's, or Higgsfield's own free quote for this exact request when its key is there. */
  async function price(f, prompt, client) {
    let quote = null;
    let problem = null;
    if (client && f.provider === 'higgsfield') {
      try { quote = await client.quoteVideo(videoParams(f, prompt)); } catch (e) {
        if (['auth', 'credits', 'notfound', 'nokey'].includes(e.kind)) problem = said(e);
        else log(`generate: no quote from Higgsfield (${said(e)}); using the table price`);
      }
    }
    const est = providers.estimateBroll({ ...f, quote });
    const p = est.byProvider[f.provider];
    return { est, usd: p.usd, credits: p.credits || null, exact: Boolean(quote), problem };
  }

  /** What the B-roll form shows: the price for this provider, length and quality, or why it can't be made yet. */
  async function quoteBroll(raw) {
    const f = brollForm(raw);
    const p = providers.info(f.provider);
    const head = { provider: f.provider, name: p.name, model: p.video, duration: f.duration, resolution: f.resolution };
    if (!providers.hasKey(d.vault, f.provider)) return { ...head, ...strip(await price(f, '', null)), keyMissing: true, missing: providers.missingKey(f.provider) };
    let client;
    try { client = clientFor(f.provider); } catch (e) { return { ...head, ...strip(await price(f, '', null)), problem: said(e) }; }
    return { ...head, ...strip(await price(f, shotPrompt(f.line || 'B-roll', f), client)) };
  }
  const strip = ({ est, ...rest }) => rest; // the page gets the numbers, not the estimate object

  /**
   * Make one B-roll shot: { text, provider, duration, resolution } → { cancelled: true } or { item } once it's in
   * the Library. Resolves only when the clip has landed (minutes); progress goes out through d.send.
   */
  async function makeBroll(raw) {
    const f = brollForm(raw);
    if (f.line.length < 3) throw new Error('Write a line from your script, or the shot you see.');
    if (making) throw new Error('One B-roll shot is already being made.');
    if (!d.library()) throw new Error('The Library isn\'t ready yet.');
    const client = clientFor(f.provider); // "Add a Kie.ai key in Setup → Keys" when there's none
    making = true;
    try {
      const prompt = shotPrompt(f.line, f);
      const q = await price(f, prompt, client);
      if (q.problem) throw new Error(q.problem);
      // Kie.ai's table is its published price. Higgsfield's is a guess: its own quote is the price, so no quote, no spend.
      if (f.provider === 'higgsfield' && !q.exact) throw new Error('Couldn\'t get Higgsfield\'s price just now, so nothing was started. Try again in a minute.');
      const usd = q.usd.toFixed(2);
      const yes = await d.confirm({
        title: `Spend money on ${client.name}?`,
        message: 'Make this B-roll shot?',
        detail: `One ${f.duration}-second ${f.resolution} shot with ${client.models.video} on ${client.name}: about ${usd} US dollars`
          + `${q.exact ? ` (${client.name}'s own quote)` : ''}, plus up to 15 % margin. Nothing else will be charged.`,
        button: `Approve ${usd} US dollars`,
      });
      if (!yes) return { cancelled: true };

      const title = titleFor(f.line);
      const what = `B-roll: ${title}`;
      const token = d.broker.approve(q.est, { project: 'Library', stage: 'b-roll', approvedBy: d.approvedBy || 'user' })[f.provider];
      try {
        d.broker.authorize(token, f.provider, { usd: q.usd, credits: q.credits || 0, what });
      } catch (e) { d.broker.close(token); throw e; }
      const job = {
        id: `gen_${crypto.randomBytes(6).toString('hex')}`, kind: 'broll', provider: f.provider, providerName: client.name, model: client.models.video,
        token, what, title, line: f.line, prompt, duration: f.duration, resolution: f.resolution, aspect: BROLL.aspect, audio: BROLL.audio,
        usd: q.usd, credits: q.credits, exact: q.exact, jobId: null, createdAt: new Date(now()).toISOString(),
      };
      emit(job, 'starting');
      let started;
      try {
        started = await client.video(videoParams(f, prompt));
      } catch (e) {
        throw startFailed(job, e);
      }
      job.jobId = started.jobId;
      store.put(job);
      d.broker.record(token, { what, provider: job.provider, model: job.model, jobId: job.jobId, phase: 'submitted' });
      return { item: await finish(job, client) };
    } finally {
      making = false;
    }
  }

  // ── the Scenes step: stills and shots for cartoons and cut scenes, into the episode ──────────────────────────

  const submitting = new Set(); // budget tokens whose step is still starting its jobs
  const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];
  const count = (n, one, many = `${one}s`) => `${WORDS[n] || n} ${n === 1 ? one : many}`;
  const routes = () => ({ stills: providers.route(d.settings.read(), 'stills'), video: providers.route(d.settings.read(), 'video') });

  /** What a step makes, for its dialog: "Four 2K stills with Nano Banana Pro", "One 5-second 480p draft with Seedance 2.5"… */
  function describe(jobs, client) {
    const j = jobs[0];
    const secs = jobs.reduce((t, x) => t + (x.seconds || 0), 0);
    if (j.kind === 'still') return `${count(jobs.length, '2K still')} with ${client.models.still}`;
    if (j.kind === 'upgrade') return `${jobs.length === 1 ? `One ${secs}-second shot` : `${count(jobs.length, 'shot')} (${secs} seconds in all)`} finished at 1080p with ${client.models.video}`;
    const what = j.draft ? `${j.resolution} draft` : `${j.resolution} shot`;
    return `${jobs.length === 1 ? `One ${secs}-second ${what}` : `${count(jobs.length, what)} (${secs} seconds in all)`} with ${client.models.video}`;
  }

  /** The request a job sends: the still or shot, with its inputs as links the provider can read. */
  function request(job, links) {
    if (job.kind === 'still') return { prompt: job.prompt, references: job.refs.map((f) => links.get(f)), aspect: '16:9', resolution: '2K' };
    if (job.kind === 'video') {
      return { prompt: job.prompt, startImageUrl: links.get(job.start), endImageUrl: job.end ? links.get(job.end) : null, duration: job.seconds, resolution: job.resolution,
        aspect: '16:9', audio: job.audio, draft: job.draft };
    }
    return { draftJobId: job.draftJobId };
  }

  /** Upload a job's pictures (free) and keep their links; each file once per step. */
  async function upload(job, client, dir, links) {
    for (const f of [...(job.refs || []), job.start, job.end].filter(Boolean)) {
      if (!links.has(f)) links.set(f, await client.upload(path.join(dir, 'presentation', f)));
    }
  }

  /**
   * One paid step of the Scenes step: { dir, key, step } where step is what scenes.nextStep or rerollStep gave
   * ({ step, slots }). One estimate (Kie.ai's published prices; Higgsfield's own quote for each request, or no
   * spend), one dialog, one budget token; then per job: authorize, start, its id in the ledger, its take "on its
   * way". Resolves once they're started ({ started, failed: [messages] }) or { cancelled: true }; each job finishes
   * in the background (progress goes out through d.send) and the token closes when the last one ends. `allowance`
   * (ext/jazz.allowance, Jazz's one combined approval at Scenes, D13): a step it covers needs no dialog of its own and
   * its budget says Jazz approved it; a step past it asks as always.
   */
  async function makeScene({ dir, key, step, title = '', project = '', allowance = null }) {
    const piece = scenes.pieceOf(dir, key);
    const jobs = scenes.jobsFor(dir, piece, step, routes());
    if (!jobs.length) throw new Error('There\'s nothing to make there.');
    const provider = jobs[0].provider;
    if (jobs.some((j) => j.provider !== provider)) throw new Error('A step is made on one provider.');
    const client = clientFor(provider); // "Add a Kie.ai key in Setup → Keys" when there's none
    const links = new Map();
    const lines = jobs.map(scenes.lineFor);
    let exact = false;
    if (provider === 'higgsfield') {
      // Its table price is a guess: its own quote for each exact request is the price, so the pictures go up first (free).
      for (const [i, job] of jobs.entries()) {
        let q;
        try {
          await upload(job, client, dir, links);
          const req = request(job, links);
          q = job.kind === 'still' ? await client.quoteStill(req) : await client.quoteVideo(req);
        } catch (e) {
          if (['auth', 'credits', 'notfound', 'nokey', 'invalid'].includes(e.kind)) throw new Error(said(e));
          throw new Error('Couldn\'t get Higgsfield\'s price just now, so nothing was started. Try again in a minute.');
        }
        lines[i].unitUsd = q.usd / lines[i].qty;
      }
      exact = true;
    }
    const est = estimate(lines);
    const usd = est.byProvider[provider].usd;
    const name = title || piece.title;
    const byJazz = Boolean(allowance && typeof allowance.take === 'function' && allowance.take(usd));
    const yes = byJazz || await d.confirm({
      title: `Spend money on ${client.name}?`,
      message: step.step === 'reroll' ? `Make ${slotWords(jobs[0].slot)} again?` : `${stepWords(piece, step, jobs)} for "${name}"?`,
      detail: `${describe(jobs, client)} on ${client.name}: about ${usd.toFixed(2)} US dollars${exact ? ` (${client.name}'s own quote)` : ''}, plus up to 15 % margin. Nothing else will be charged.`,
      button: `Approve ${usd.toFixed(2)} US dollars`,
    });
    if (!yes) return { cancelled: true };

    const token = d.broker.approve(est, { project: project || name, stage: 'scenes', approvedBy: byJazz ? 'jazz' : (d.approvedBy || 'user') })[provider];
    submitting.add(token);
    const started = [];
    const failed = [];
    try {
      for (const [i, sj] of jobs.entries()) {
        const what = `${name}: ${sj.label}`;
        const line = est.lines[i];
        const job = {
          id: `gen_${crypto.randomBytes(6).toString('hex')}`, kind: 'scene', provider, providerName: client.name,
          model: sj.kind === 'still' ? client.models.still : client.models.video, token, what, dir, piece: key, key: sj.key, slot: sj.slot, take: sj.take,
          jobKind: sj.kind, dest: sj.dest, prompt: sj.prompt || null, draft: Boolean(sj.draft), resolution: sj.resolution || null, seconds: sj.seconds || null,
          usd: line.usd, credits: line.credits, exact, jobId: null, createdAt: new Date(now()).toISOString(),
        };
        const sceneJob = { ...sj, kind: sj.kind, usd: line.usd };
        try {
          if (provider !== 'higgsfield') await upload(sj, client, dir, links);
        } catch (e) {
          failed.push(said(e));
          break; // nothing was authorized for it, so nothing to settle
        }
        try {
          d.broker.authorize(token, provider, { usd: line.usd, credits: line.credits || 0, what });
        } catch (e) { failed.push(said(e)); break; }
        emit(job, 'starting');
        let s;
        try {
          const req = request(sj, links);
          s = sj.kind === 'still' ? await client.still(req) : sj.kind === 'video' ? await client.video(req) : await client.upgrade(req);
        } catch (e) {
          failed.push(sceneStartFailed(job, sceneJob, e));
          if (!(e && e.ambiguous && e.replay)) break; // refused or unknown: the rest would go the same way
          continue;
        }
        job.jobId = s.jobId;
        store.put(job);
        d.broker.record(token, { what, provider, model: job.model, jobId: job.jobId, phase: 'submitted' });
        scenes.startTake(dir, sceneJob, { jobId: job.jobId, model: job.model, usd: line.usd });
        started.push(job.id);
        finish(job, client).catch(() => {}); // lands in the background; its progress and result go out through d.send
      }
    } finally {
      submitting.delete(token);
      closeIfDone(token);
    }
    if (!started.length && failed.length) throw new Error(failed[0]);
    return { started: started.length, failed };
  }

  // ── "Cartoon you" (W3-10): the likeness's plates and parts, into the presenter's own folder ──────────────────────
  const likeness = () => require('./likeness');
  const holding = new Set(); // tokens kept open for their step's reserve (re-tries) until the free checks are done
  const starting = new Map(); // presenter folder → steps still sending their jobs (a job is in jobs.json only once Kie.ai took it)

  /**
   * One paid step of "Cartoon you": { dir (the presenter's folder), step: 'plates'|'again'|'parts'|'mouths', mouths
   * ('painted'|'drawn', for parts), engineRoot }. One estimate (Kie.ai's published prices; the reserve's re-tries on a
   * line of their own, spent only where a check fails), one native dialog that states it, one budget token; then each
   * job as startLikeness says. → { cancelled: true } or { started, failed: [messages], wait: () => Promise }.
   */
  async function makeLikeness({ dir, step, mouths = null, engineRoot }) {
    if (!['plates', 'again', 'parts', 'mouths'].includes(step)) throw new Error('That isn\'t a step FLPT knows.');
    const L = likeness();
    const p = L.plan(dir, step, { engineRoot, mouths });
    // every part is made already (a free pass that stopped, then Meet again): nothing to pay for, no dialog
    if (!p.jobs.length) return { free: true, started: 0, failed: [], wait: async () => [] };
    const client = clientFor('kie'); // "Add a Kie.ai key in Setup → Keys" when there's none
    const est = estimate(p.lines);
    const usd = est.byProvider.kie.usd;
    const yes = await d.confirm({
      title: `Spend money on ${client.name}?`,
      message: p.message,
      detail: `${p.describe}: about ${p.plannedUsd.toFixed(2)} US dollars${p.reserve ? `, up to ${usd.toFixed(2)} if a part needs a second try` : ''}, `
        + 'plus up to 15 % margin. Nothing else will be charged.',
      button: `Approve ${p.reserve ? 'up to ' : ''}${usd.toFixed(2)} US dollars`,
    });
    if (!yes) return { cancelled: true };
    const token = d.broker.approve(est, { project: 'Cartoon you', stage: 'likeness', approvedBy: d.approvedBy || 'user' }).kie;
    L.stepApproved(dir, step, { token, usd, mouths: step === 'parts' ? (mouths === 'drawn' ? 'drawn' : 'painted') : null, keys: p.jobs.map((j) => j.key) });
    if (p.reserve) holding.add(token);
    return startLikeness(dir, p.jobs, token, client, step);
  }

  /**
   * Re-tries from a step's reserve (likeness.rerollsWanted), on that step's own approval, so no second dialog: only
   * while its token is live and belongs to this presenter's parts or mouths step, and never past its cap.
   */
  async function likenessReroll({ dir, token, items, engineRoot }) {
    if (!Array.isArray(items) || !items.length) return { started: 0, failed: [], wait: async () => [] };
    const rec = likeness().read(dir);
    const own = rec && [rec.steps.parts, rec.steps.mouths].some((x) => x && x.token === token && !x.closed);
    if (!own || !d.broker.isLive(token, 'kie')) throw new Error('A re-try is made only on its own step\'s approval.');
    const p = likeness().plan(dir, 'reroll', { engineRoot, items });
    return startLikeness(dir, p.jobs, token, clientFor('kie'), 'reroll');
  }

  /** The reserve is no longer needed: the step's token closes once its last job has ended. */
  function releaseLikeness(token) { holding.delete(token); closeIfDone(token); }

  /**
   * Start a step's jobs: per job its pictures up (free), a free balance read first when the API has been idle (G3: a
   * paid start on a connection the other side had dropped came back "lost", which is never sent again), authorize,
   * recorded as starting in the presenter's record (so a crash before Kie.ai answers is never taken for nothing), start,
   * its id in jobs.json, the ledger and the record. Each lands in the background (finish); the token closes when the
   * last ends and the reserve is let go. A step that started none of its jobs undoes itself (likeness.stepUndone: the
   * step forgotten, the status as it was, the token closed), so it can be asked again once what stopped it is fixed.
   */
  async function startLikeness(dir, jobs, token, client, step) {
    const L = likeness();
    submitting.add(token);
    starting.set(dir, (starting.get(dir) || 0) + 1);
    const links = new Map();
    const started = [];
    const failed = [];
    const runs = [];
    let lastApi = 0;
    try {
      for (const lj of jobs) {
        const rate = lj.kind === 'cutout' ? RATES.kie_cutout : RATES.kie_still;
        const what = `Cartoon you: ${lj.label}`;
        const job = {
          id: `gen_${crypto.randomBytes(6).toString('hex')}`, kind: 'likeness', provider: 'kie', providerName: client.name, model: client.models[lj.kind === 'cutout' ? 'cutout' : 'still'],
          token, what, title: 'Cartoon you', dir, key: lj.key, dest: lj.dest, jobKind: lj.kind, usd: rate.usd, credits: rate.credits, jobId: null, createdAt: new Date(now()).toISOString(),
        };
        try {
          for (const f of lj.refs) if (!links.has(f)) links.set(f, await client.upload(f));
        } catch (e) { failed.push(said(e)); break; } // nothing authorized for it yet
        if (now() - lastApi > 1500) { try { await client.credits(); } catch { /* the read is only to renew the connection */ } }
        try {
          d.broker.authorize(token, 'kie', { usd: rate.usd, credits: rate.credits, what });
        } catch (e) { failed.push(said(e)); break; }
        L.jobStarting(dir, lj, { step, token, usd: rate.usd });
        emit(job, 'starting');
        let s;
        try {
          s = lj.kind === 'cutout' ? await client.cutout({ imageUrl: links.get(lj.refs[0]) })
            : await client.still({ prompt: lj.prompt, references: lj.refs.map((f) => links.get(f)), aspect: '1:1', resolution: '2K', format: 'png' });
        } catch (e) {
          lastApi = now();
          failed.push(likenessStartFailed(job, e));
          if (e && (e.ambiguous || ['auth', 'credits', 'limit', 'nokey', 'unavailable'].includes(e.kind))) break; // the rest would go the same way
          continue;
        }
        lastApi = now();
        job.jobId = s.jobId;
        store.put(job);
        d.broker.record(token, { what, provider: 'kie', model: job.model, jobId: job.jobId, phase: 'submitted' });
        L.jobStarted(dir, lj.key, { jobId: job.jobId });
        started.push(job.id);
        runs.push(finish(job, client).catch(() => null)); // lands in the background; its progress goes out through d.send
      }
    } finally {
      if (!started.length && step !== 'reroll') { // nothing went out: the step is taken back before anyone sees it idle
        try { L.stepUndone(dir, step, token); } catch (e) { log(`generate: couldn't take back ${step}: ${said(e)}`); }
        holding.delete(token);
      }
      submitting.delete(token);
      if (starting.get(dir) > 1) starting.set(dir, starting.get(dir) - 1); else starting.delete(dir);
      closeIfDone(token);
    }
    if (!started.length && failed.length) throw new Error(failed[0]);
    return { started: started.length, failed, wait: () => Promise.all(runs) };
  }

  /** A "Cartoon you" job's end, in the presenter's record (if the folder is still there). */
  function landLikeness(job, result) {
    try { likeness().jobLanded(job.dir, job.key, result); } catch (e) { log(`generate: couldn't record ${job.what}: ${said(e)}`); }
  }

  /** A start that didn't go through: refused (nothing charged, settled to zero) or maybe started (kept counted). */
  function likenessStartFailed(job, e) {
    const msg = said(e);
    if (e && e.ambiguous) {
      d.broker.record(job.token, { what: job.what, provider: job.provider, outcome: 'unknown', error: msg });
      landLikeness(job, { status: 'unknown', error: msg });
    } else {
      d.broker.settle(job.token, { authorizedUsd: job.usd, actualUsd: 0, ...creditTerms(job, 0), what: job.what });
      d.broker.record(job.token, { what: job.what, provider: job.provider, outcome: 'not started', error: msg });
      landLikeness(job, { status: 'failed', error: msg, costUsd: 0 });
    }
    emit(job, 'failed', { message: msg });
    return msg;
  }

  /** A "Cartoon you" picture that's done at Kie.ai: into the presenter's folder, its record, the money settled. */
  async function landLikenessFile(job, client, st, costUsd) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flpt-gen-'));
    try {
      const file = path.join(tmp, 'picture');
      try {
        await client.download(st.urls[0], file, { maxBytes: 64 << 20 });
      } catch (e) {
        if (e.retryable) throw keep(job, e, 'Couldn\'t download it yet');
        const msg = `It was made, but it couldn't be downloaded: ${said(e)}`;
        landLikeness(job, { status: 'failed', error: msg, costUsd });
        settleAndClose(job, 'lost', costUsd, st.credits, { error: said(e) });
        emit(job, 'failed', { message: msg });
        throw new Error(msg);
      }
      const ext = pictureType(file);
      if (!ext) {
        const msg = `${job.providerName} sent something that isn't a picture.`;
        landLikeness(job, { status: 'failed', error: msg, costUsd });
        settleAndClose(job, 'lost', costUsd, st.credits, { error: msg });
        emit(job, 'failed', { message: msg });
        throw new Error(msg);
      }
      if (!fs.existsSync(path.join(job.dir, 'likeness.json'))) { // the presenter folder is gone: the money is settled all the same
        settleAndClose(job, 'lost', costUsd, st.credits, { error: 'the presenter folder is gone' });
        emit(job, 'failed', { message: 'That cartoon isn\'t there any more.' });
        return null;
      }
      const rel = job.dest.replace(/\.[a-z0-9]+$/i, ext);
      const dest = path.join(job.dir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(file, `${dest}.part`);
      fs.renameSync(`${dest}.part`, dest);
      landLikeness(job, { status: 'made', file: rel, costUsd });
      settleAndClose(job, 'done', costUsd, st.credits, { file: rel });
      emit(job, 'done');
      return { file: dest };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  function slotWords(slot) {
    const m = /^(beat|start|shot)(\d+)$/.exec(slot);
    if (m) return `${{ beat: 'keyframe', start: 'start frame', shot: 'shot' }[m[1]]} ${m[2]}`;
    return { frame: 'the style frame', hero: 'the hero shot', plate: 'the plate' }[slot] || slot;
  }

  function stepWords(piece, step, jobs) {
    const n = jobs.length;
    if (step.step === 'style') return 'Make the style frame';
    if (step.step === 'plate') return 'Make the plate';
    if (step.step === 'stills') return piece.kind === 'cartoon' ? (n === 1 ? 'Make the keyframe' : `Make ${n} keyframes`) : (n === 1 ? 'Make the start frame' : `Make ${n} start frames`);
    if (step.step === 'finish') return piece.kind === 'cartoon' ? 'Finish the hero shot at 1080p' : (n === 1 ? 'Finish the shot at 1080p' : `Finish ${n} shots at 1080p`);
    return piece.kind === 'cartoon' ? 'Animate the hero shot' : (n === 1 ? 'Make the shot' : `Make ${n} shots`);
  }

  /** A Scenes job's start that didn't go through: its take says why; the money as for B-roll. Returns the message. */
  function sceneStartFailed(job, sceneJob, e) {
    const msg = said(e);
    if (e && e.ambiguous && e.replay) {
      // Higgsfield: asked again later with the same Idempotency-Key; it can't start a second job.
      job.replay = e.replay;
      store.put(job);
      scenes.startTake(job.dir, sceneJob, { usd: job.usd });
      d.broker.record(job.token, { what: job.what, provider: job.provider, outcome: 'unconfirmed', note: 'FLPT asks again with the same Idempotency-Key' });
      emit(job, 'waiting', { message: msg });
      scheduleResume();
      return msg;
    }
    if (e && e.ambiguous) {
      // Kie.ai may have started it (and will bill it), with no safe way to ask: the reservation stays counted.
      d.broker.record(job.token, { what: job.what, provider: job.provider, outcome: 'unknown', error: msg });
    } else {
      d.broker.settle(job.token, { authorizedUsd: job.usd, actualUsd: 0, ...creditTerms(job, 0), what: job.what });
      d.broker.record(job.token, { what: job.what, provider: job.provider, outcome: 'not started', error: msg });
    }
    landScene(job, { status: 'failed', error: msg });
    emit(job, 'failed', { message: msg });
    return msg;
  }

  /** The take's record in the episode (if the episode is still there). */
  function landScene(job, result) {
    if (!fs.existsSync(path.join(job.dir, 'presentation'))) return null;
    try {
      return scenes.landTake(job.dir, { key: job.key, slot: job.slot, take: job.take, kind: job.jobKind, dest: job.dest, provider: job.provider, draft: job.draft,
        resolution: job.resolution, seconds: job.seconds, prompt: job.prompt, jobId: job.jobId, model: job.model, usd: job.usd }, result);
    } catch (e) { log(`generate: couldn't record ${job.what}: ${said(e)}`); return null; }
  }

  /** A step's token closes once it has started what it will and its last job has ended (and its reserve is let go). */
  function closeIfDone(token) {
    if (submitting.has(token) || holding.has(token) || store.list().some((j) => j.token === token)) return;
    if (d.broker.isLive(token, (d.broker.list().find((b) => b.token === token) || {}).provider)) d.broker.close(token);
  }
  const closeFor = (job) => (job.kind === 'scene' || job.kind === 'likeness' ? closeIfDone(job.token) : d.broker.close(job.token));

  const creditTerms = (job, actual) => (job.credits != null ? { authorizedCredits: job.credits, actualCredits: actual != null ? actual : job.credits } : {});

  /** The provider didn't start the job (or may have): settle, record and close, and say what happened. */
  function startFailed(job, e) {
    const msg = said(e);
    if (e && e.ambiguous && e.replay) {
      // Higgsfield: asking again with the same Idempotency-Key returns the original job, or starts the one approved.
      job.replay = e.replay;
      store.put(job);
      d.broker.record(job.token, { what: job.what, provider: job.provider, outcome: 'unconfirmed', note: 'FLPT asks again with the same Idempotency-Key' });
      emit(job, 'waiting', { message: msg });
      scheduleResume();
      return new Error(msg);
    }
    if (e && e.ambiguous) {
      // Kie.ai may have started it (and will bill it), with no safe way to ask: the reservation stays counted.
      d.broker.record(job.token, { what: job.what, provider: job.provider, outcome: 'unknown', error: msg });
      closeFor(job);
      if (job.kind === 'scene') landScene(job, { status: 'failed', error: msg });
      emit(job, 'failed', { message: msg });
      return new Error(msg);
    }
    // Refused before anything started: nothing was charged.
    d.broker.settle(job.token, { authorizedUsd: job.usd, actualUsd: 0, ...creditTerms(job, 0), what: job.what });
    d.broker.record(job.token, { what: job.what, provider: job.provider, outcome: 'not started', error: msg });
    closeFor(job);
    if (job.kind === 'scene') landScene(job, { status: 'failed', error: msg });
    emit(job, 'failed', { message: msg });
    return new Error(msg);
  }

  function settleAndClose(job, outcome, actualUsd, actualCredits, extra = {}) {
    d.broker.settle(job.token, { authorizedUsd: job.usd, actualUsd, ...creditTerms(job, actualCredits), what: job.what });
    d.broker.record(job.token, { what: job.what, provider: job.provider, model: job.model, jobId: job.jobId, outcome, costUsd: actualUsd,
      credits: actualCredits == null ? null : actualCredits, ...extra });
    store.remove(job.id);
    closeFor(job);
  }

  /** The job stays in jobs.json, to be finished later: say why, and look again soon. */
  function keep(job, e, doing) {
    const why = said(e);
    const msg = e && e.kind === 'slow' ? why : `${doing}: ${why} FLPT will keep trying.`;
    emit(job, 'waiting', { message: msg });
    scheduleResume();
    return new Error(msg);
  }

  /** Library fields for a finished shot: a clip, credited to how it was made. */
  function itemFor(job, file, st, costUsd) {
    return {
      // dedupe: false, so each paid job is its own item, even in the unlikely case its bytes match an earlier one.
      kind: 'clip', file, move: true, dedupe: false, fileName: `${job.title.replace(/…$/, '')}.mp4`, title: job.title, tags: ['b-roll', 'generated'], addedBy: 'you',
      source: {
        site: job.providerName, rights: `AI-generated: ${job.model} on ${job.providerName}.`, description: job.prompt,
        generated: { provider: job.provider, model: job.model, prompt: job.prompt, line: job.line, jobId: job.jobId, costUsd, credits: st.credits,
          duration: job.duration, resolution: job.resolution, aspect: job.aspect, at: new Date(now()).toISOString() },
      },
    };
  }

  /** The kind of picture a provider sent back (whatever the link said): its extension, or null for anything else. */
  function pictureType(file) {
    let b = Buffer.alloc(0);
    try { const fd = fs.openSync(file, 'r'); b = Buffer.alloc(12); fs.readSync(fd, b, 0, 12, 0); fs.closeSync(fd); } catch { return null; }
    if (b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return '.png';
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return '.jpg';
    if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return '.webp';
    return null;
  }

  /** A Scenes job that's done at the provider: its file into the episode, its take landed, the money settled. */
  async function landSceneFile(job, client, st, costUsd) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flpt-gen-'));
    try {
      const file = path.join(tmp, path.basename(job.dest));
      try {
        await client.download(st.urls[0], file, { maxBytes: MAX_VIDEO_BYTES });
      } catch (e) {
        if (e.retryable) throw keep(job, e, 'Couldn\'t download it yet');
        const msg = `It was made, but it couldn't be downloaded: ${said(e)}`;
        landScene(job, { status: 'failed', error: msg, costUsd, credits: st.credits });
        settleAndClose(job, 'lost', costUsd, st.credits, { error: said(e) });
        emit(job, 'failed', { message: msg });
        throw new Error(msg);
      }
      let rel = job.dest;
      if (job.jobKind === 'still') {
        const ext = pictureType(file);
        if (!ext) {
          const msg = `${job.providerName} sent something that isn't a picture.`;
          landScene(job, { status: 'failed', error: msg, costUsd, credits: st.credits });
          settleAndClose(job, 'lost', costUsd, st.credits, { error: msg });
          emit(job, 'failed', { message: msg });
          throw new Error(msg);
        }
        rel = job.dest.replace(/\.[a-z0-9]+$/i, ext);
      }
      const pres = path.join(job.dir, 'presentation');
      if (!fs.existsSync(pres)) { // the episode is gone: the money is settled all the same
        settleAndClose(job, 'lost', costUsd, st.credits, { error: 'the episode folder is gone' });
        emit(job, 'failed', { message: 'The episode isn\'t there any more.' });
        return null;
      }
      const dest = path.join(pres, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(file, `${dest}.part`);
      fs.renameSync(`${dest}.part`, dest);
      landScene(job, { status: 'made', file: rel, costUsd, credits: st.credits });
      settleAndClose(job, 'done', costUsd, st.credits, { file: rel });
      emit(job, 'done', { file: dest });
      if (d.onSceneLanded) Promise.resolve().then(() => d.onSceneLanded(job.dir, job.piece)).catch(() => {});
      return { file: dest };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  /** Poll, download, keep (in the Library, or the episode for a Scenes job), settle, close. One run per job, however many times it's asked for. */
  function finish(job, client) {
    if (active.has(job.id)) return active.get(job.id);
    const run = (async () => {
      let st;
      try {
        st = await client.wait(job.jobId, {
          timeoutMs: d.pollTimeoutMs || 60 * 60000,
          onProgress: (s) => { if (s.state === 'queued' || s.state === 'running') emit(job, s.state, { progress: s.progress, elapsed: Math.round(s.elapsed || 0) }); },
        });
      } catch (e) {
        if (e.kind === 'auth') throw keep(job, e, `Can't check on it at ${job.providerName}`);
        throw keep(job, e, `Lost touch with ${job.providerName}`);
      }
      if (st.state === 'failed') {
        if (job.kind === 'scene') landScene(job, { status: 'failed', error: st.error, costUsd: st.costUsd != null ? st.costUsd : 0, credits: st.credits });
        if (job.kind === 'likeness') landLikeness(job, { status: 'failed', error: st.error, costUsd: st.costUsd != null ? st.costUsd : 0 });
        settleAndClose(job, 'failed', st.costUsd != null ? st.costUsd : 0, st.credits != null ? st.credits : 0, { error: st.error });
        emit(job, 'failed', { message: st.error });
        throw new Error(st.error);
      }
      emit(job, 'saving');
      const costUsd = st.costUsd != null ? st.costUsd : job.usd; // Kie.ai reports what it took; Higgsfield's quote is its price
      if (job.kind === 'scene') return landSceneFile(job, client, st, costUsd);
      if (job.kind === 'likeness') return landLikenessFile(job, client, st, costUsd);
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flpt-gen-'));
      try {
        const file = path.join(tmp, 'b-roll.mp4');
        try {
          await client.download(st.urls[0], file, { maxBytes: MAX_VIDEO_BYTES });
        } catch (e) {
          if (e.retryable) throw keep(job, e, 'Couldn\'t download it yet');
          const msg = `The shot was made, but it couldn't be downloaded: ${said(e)}`;
          settleAndClose(job, 'lost', costUsd, st.credits, { error: said(e) });
          emit(job, 'failed', { message: msg });
          throw new Error(msg);
        }
        const lib = d.library();
        if (!lib) throw keep(job, new Error('The Library isn\'t ready.'), 'Couldn\'t keep it yet');
        let item;
        try { item = await lib.add(itemFor(job, file, st, costUsd)); } catch (e) { throw keep(job, e, 'Couldn\'t keep it in the Library yet'); }
        settleAndClose(job, 'done', costUsd, st.credits, { itemId: item.id });
        emit(job, 'done', { itemId: item.id });
        return item;
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    })();
    active.set(job.id, run);
    run.then(() => active.delete(job.id), () => active.delete(job.id));
    return run;
  }

  function scheduleResume() {
    if (resumeTimer || d.retryMs === 0) return;
    resumeTimer = setTimeout(() => { resumeTimer = null; resume(); }, d.retryMs || 120000);
    if (resumeTimer.unref) resumeTimer.unref();
  }

  /**
   * Finish every job left in jobs.json (after a quit, a lost connection, a slow render). Runs in the background;
   * returns the promises (tests await them). A job past its provider's retention is given up on, its cost unknown.
   */
  function resume() {
    const runs = [];
    for (const job of store.list()) {
      if (active.has(job.id)) { runs.push(active.get(job.id).catch(() => null)); continue; }
      const ageDays = (now() - Date.parse(job.createdAt || 0)) / 86400000;
      if (!(ageDays < (RETENTION_DAYS[job.provider] || 7))) {
        d.broker.record(job.token, { what: job.what, provider: job.provider, jobId: job.jobId, outcome: 'expired', note: 'not finished before the provider deleted it' });
        store.remove(job.id);
        closeFor(job);
        if (job.kind === 'scene') landScene(job, { status: 'failed', error: `Not finished before ${job.providerName} deleted it.` });
        if (job.kind === 'likeness') landLikeness(job, { status: 'unknown', error: `Not finished before ${job.providerName} deleted it.` });
        continue;
      }
      let client;
      try { client = clientFor(job.provider); } catch { continue; } // no key right now: leave it for later
      const go = async () => {
        if (!job.jobId && job.replay) {
          let s;
          try {
            s = await client.replay(job.replay);
          } catch (e) {
            if (e.ambiguous) { scheduleResume(); throw e; }
            // Refused this time, so it never started (a refused request doesn't use up its key): nothing was charged.
            store.remove(job.id);
            throw startFailed({ ...job, replay: null }, e);
          }
          job.jobId = s.jobId;
          delete job.replay;
          store.put(job);
          d.broker.record(job.token, { what: job.what, provider: job.provider, model: job.model, jobId: job.jobId, phase: 'submitted' });
          if (job.kind === 'scene') landScene(job, { status: 'working' });
        }
        if (!job.jobId) { // nothing to ask about (it never got a job id)
          d.broker.record(job.token, { what: job.what, provider: job.provider, outcome: 'unknown', note: 'no job id to check' });
          store.remove(job.id);
          closeFor(job);
          if (job.kind === 'scene') landScene(job, { status: 'failed', error: 'It may or may not have started; nothing more can be found out.' });
          if (job.kind === 'likeness') landLikeness(job, { status: 'unknown', error: 'It may or may not have started; nothing more can be found out.' });
          return null;
        }
        return finish(job, client);
      };
      runs.push(go().catch((e) => { log(`generate: ${job.id} isn't finished yet: ${said(e)}`); return null; }));
    }
    return runs;
  }

  return {
    quoteBroll, makeBroll, makeScene, resume, finish,
    makeLikeness, likenessReroll, releaseLikeness,
    status: () => ({ making, pending: store.list().length }),
    /** Scenes jobs still on their way for one episode. */
    pendingFor: (dir) => store.list().filter((j) => j.kind === 'scene' && j.dir === dir).length,
    /** "Cartoon you" jobs still on their way for one presenter folder (a step still sending counts as one). */
    likenessPending: (dir) => store.list().filter((j) => j.kind === 'likeness' && j.dir === dir).length + (starting.has(dir) ? 1 : 0),
    store,
  };
}

module.exports = { createGenerator, cleanLine, shotPrompt, titleFor, BROLL, RETENTION_DAYS };
