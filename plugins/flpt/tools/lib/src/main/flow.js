'use strict';
// The episode flow: create → bullets → fact-check → deck → script → spend → film → deliver.
// Agent stages run through agents.runStage; pipeline stages run the engine's scripts directly. Every paid step goes
// through the broker: Claude planning against an approved planning budget, filming against an approved HeyGen budget.
const fs = require('fs');
const path = require('path');
const episode = require('./episode');
const agents = require('./agents');
const stagetools = require('./stagetools');
const layoutqa = require('./layoutqa');
const modules = require('./modules');
const { estimate } = require('./broker');
const { spawn } = require('child_process');

const FILES = { bullets: 'bullets.md', claims: 'research/claims.md', script: 'script.md', brief: 'brief.md' };
// What a call may carry: images (a notebook photo, a chart screenshot), clips, and documents or stories to read.
const ATTACH = { image: /\.(png|jpe?g|gif|webp|heic|heif)$/i, video: /\.(mp4|mov|m4v)$/i, doc: /\.(pdf|txt|md|rtf|docx|html?)$/i };
const MAX_ATTACH = 500 * 1024 * 1024;
const EDITABLE = new Set(['bullets', 'script']);
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const mtime = (p) => { try { return Math.round(fs.statSync(p).mtimeMs); } catch { return null; } };

/** The {{placeholders}} an episode's stage prompts get (agents.stagePrompt adds the skill paths and the user's notes). */
function stageVars(st) {
  const target = episode.slideTarget(st.intake.minutes);
  return { title: st.title, minutes: st.intake.minutes, words: st.intake.minutes * 150, slides_min: target.min, slides_max: target.max,
    modules: modules.promptCatalog(), calls: modules.promptCalls(st.calls || []) };
}

function createFlow(d) {
  // d: { settings, vault, pipeline, broker, toolEnv, chrome(), engineRoot, configDir, executable, confirm(opts), send,
  //      basePython(), loadSdk(), redact }
  const running = new Map(); // dir → AbortController, for agent stages
  const busy = new Set(); // dirs with a pipeline step (draft, film, deliver) under way
  const exclusive = async (dir, fn) => {
    if (running.has(dir) || busy.has(dir)) throw new Error('Something is already running for this episode.');
    busy.add(dir);
    try { return await fn(); } finally { busy.delete(dir); }
  };

  const projectsDir = () => d.settings.read().projectsDir;
  const inProjects = (dir) => {
    const root = path.resolve(projectsDir());
    const r = path.resolve(dir);
    return r.startsWith(root + path.sep) && exists(path.join(r, 'flpt-project.json'));
  };
  const guard = (dir) => { if (!inProjects(dir)) throw new Error('That isn\'t an FLPT episode folder.'); return path.resolve(dir); };

  function list() {
    const root = projectsDir();
    if (!exists(root)) return [];
    return fs.readdirSync(root).filter((n) => n !== 'Samples').map((n) => path.join(root, n))
      .map((dir) => ({ dir, st: episode.read(dir) })).filter((x) => x.st)
      .map(({ dir, st }) => {
        const stage = episode.current(st);
        return { dir, title: st.title, stage, stageLabel: episode.STAGES.find((s) => s.id === stage).label, updatedAt: st.updatedAt,
          minutes: st.intake.minutes, delivered: st.stages.deliver.status === 'approved' };
      })
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async function create(intake, files = []) {
    const i = episode.clean(intake);
    const root = projectsDir();
    fs.mkdirSync(root, { recursive: true });
    let dir = path.join(root, episode.slugify(i.title));
    for (let n = 2; exists(dir); n++) dir = path.join(root, `${episode.slugify(i.title)} ${n}`);
    fs.mkdirSync(dir, { recursive: true });
    const base = await d.basePython();
    if (!base) throw new Error('Python isn\'t set up yet. Finish the Tools step of setup first.');
    const r = await d.pipeline.scaffold(dir, base, {});
    if (r.code !== 0) throw new Error('Setting up the episode folder failed.');
    episode.create(dir, i);
    // Files the user brought (notes, photos, a story): copied in, and listed in the brief the crew reads first.
    if (files.length) {
      const got = await copyIn(dir, files, path.join('assets', 'intake'), 'intake');
      fs.appendFileSync(path.join(dir, 'presentation', 'brief.md'), `\n## Their files\n${got.map((a) => `- \`${a.path}\`${a.poster ? ` (poster frame: \`${a.poster}\`)` : ''}`).join('\n')}\n`);
    }
    return dir;
  }

  /** The crew's record of which module each slide uses (deck/project/modules.json), or null. */
  function readModulesMap(dir) {
    try { return JSON.parse(fs.readFileSync(path.join(dir, 'presentation', 'deck', 'project', 'modules.json'), 'utf8')); } catch { return null; }
  }

  function readDeckOrder(dir) {
    try { return JSON.parse(fs.readFileSync(path.join(dir, 'presentation', 'deck', 'project', 'deck.json'), 'utf8')).order || []; } catch { return []; }
  }

  /** "## Slide 3 — Title" headings in bullets.md, for picking where a call goes. */
  function bulletSlides(text) {
    return String(text || '').split(/\r?\n/).map((l) => l.match(/^##\s+Slide\s+(\d+)\s*[—–-]\s*(.*)$/i)).filter(Boolean)
      .map((m) => ({ n: Number(m[1]), title: m[2].trim() }));
  }

  function slidesView(dir) {
    const sd = path.join(dir, 'presentation', 'slides');
    return exists(sd) ? fs.readdirSync(sd).filter((f) => /^slide_\d+\.png$/.test(f)).sort().map((f) => path.join(sd, f)) : [];
  }

  function open(dir) {
    dir = guard(dir);
    const st = episode.read(dir);
    const read = (rel) => { try { return fs.readFileSync(path.join(dir, 'presentation', rel), 'utf8').slice(0, 200000); } catch { return null; } };
    const files = Object.fromEntries(Object.entries(FILES).map(([k, rel]) => [k, read(rel)]));
    const video = d.pipeline.finalOutput(dir);
    const draft = d.pipeline.draftOutput(dir);
    const slides = slidesView(dir);
    const live = (provider) => Boolean(st.budgets && st.budgets[provider] && d.broker.isLive(st.budgets[provider], provider));
    return {
      dir, state: st, current: episode.current(st), stages: episode.STAGES, files, slides,
      // the *At times are file modification times: the renderer uses them to reload images and videos that changed
      slidesAt: slides.reduce((a, p) => Math.max(a, mtime(p) || 0), 0) || null,
      video: exists(video) ? video : null, videoAt: mtime(video), draft: exists(draft) ? draft : null, draftAt: mtime(draft),
      running: running.has(dir) || busy.has(dir),
      budgets: { anthropic: live('anthropic'), heygen: live('heygen') },
      estimateSeconds: files.script ? episode.estimateSeconds(episode.parseScript(files.script)) : null,
      calls: st.calls || [],
      modules: readModulesMap(dir),
      deckOrder: readDeckOrder(dir),
      slideTitles: bulletSlides(files.bullets),
      catalog: modules.MODULES.map(({ id, name, short, ask, now, withFile }) => ({ id, name, short, ask, now, withFile })),
    };
  }

  // ── Claude planning budget ──
  async function planningToken(dir, stage) {
    const st = episode.read(dir);
    const token = st.budgets && st.budgets.anthropic;
    const tryAuth = (t) => { d.broker.authorize(t, 'anthropic', { usd: stage.budgetUsd, what: `${st.title}: ${stage.id}` }); return t; };
    if (token && d.broker.isLive(token, 'anthropic')) {
      try { return tryAuth(token); } catch { /* over the cap: ask again below */ }
    }
    const cap = episode.STAGES.filter((s) => s.kind === 'agent').reduce((a, s) => a + s.budgetUsd, 0);
    const ok = await d.confirm({
      title: 'Spend on Claude?',
      message: `Planning "${st.title}" uses your Anthropic key.`,
      detail: `Up to ${cap} US dollars for bullets, fact-check, deck and script. Each run is capped, and only its real cost counts against this budget, so revisions draw on it too. You'll see the cost after each run, and you'll be asked again if it runs low.`,
      button: `Approve up to ${cap} US dollars`,
    });
    if (!ok) return null;
    const tokens = d.broker.approve(estimate([{ rate: 'anthropic_usd', qty: cap, label: 'Claude planning cap' }]), { project: st.title, stage: 'planning', marginPct: 0 });
    st.budgets = { ...(st.budgets || {}), anthropic: tokens.anthropic };
    episode.write(dir, st);
    return tryAuth(tokens.anthropic);
  }

  async function runStage(dir, stageId, feedback = '') {
    dir = guard(dir);
    const stage = episode.STAGES.find((s) => s.id === stageId && s.kind === 'agent');
    if (!stage) throw new Error('That stage isn\'t an agent stage.');
    const st = episode.read(dir);
    if (!episode.canRun(st, stageId)) throw new Error('Approve the earlier stages first.');
    if (running.has(dir) || busy.has(dir)) throw new Error('Something is already running for this episode.');
    const apiKey = d.vault.get('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('Add your Anthropic key in Setup → Keys first.');
    const token = await planningToken(dir, stage);
    if (!token) return { ok: false, cancelled: true };

    const ctrl = new AbortController();
    running.set(dir, ctrl);
    episode.setStage(dir, stageId, { status: 'running', feedback: feedback || null });
    const emit = (ev) => d.send('agent:event', { dir, stage: stageId, ...ev, text: ev.text ? d.redact(ev.text) : ev.text, detail: ev.detail ? d.redact(ev.detail) : ev.detail });
    try {
      const sdk = await d.loadSdk();
      const res = await agents.runStage({
        stage, projectDir: dir, engineRoot: d.engineRoot, feedback, onEvent: emit, signal: ctrl.signal, vars: stageVars(st),
      }, {
        sdk, z: d.loadZod ? await d.loadZod() : null, library: d.libraryFor ? d.libraryFor(dir) : undefined,
        apiKey, toolEnvPath: d.toolEnv().PATH, configDir: d.configDir, executable: d.executable,
        tools: {
          checkDeck: (p) => stagetools.checkDeck(p, { pipeline: d.pipeline, chrome: d.chrome() }),
          scriptStats: async (p) => stagetools.scriptStats(p, { minutes: st.intake.minutes }),
        },
      });
      d.broker.record(token, { what: `${st.title}: ${stageId}`, costUsd: res.costUsd, turns: res.turns, ok: res.ok });
      // The stage reserved its whole cap; once the real cost is known, the rest goes back to the planning budget.
      if (res.costKnown) d.broker.settle(token, { authorizedUsd: stage.budgetUsd, actualUsd: res.costUsd, what: `${st.title}: ${stageId}` });
      episode.addCost(dir, { provider: 'anthropic', stage: stageId, usd: res.costUsd, estimate: true });
      let qa = null;
      if (res.ok && stageId === 'deck' && d.chrome()) {
        qa = layoutqa.summarize(await layoutqa.checkDeck({ deckDir: path.join(dir, 'presentation', 'deck', 'project'), chrome: d.chrome() }));
        await d.pipeline.render(dir, {});
      }
      const error = res.error ? d.redact(String(res.error)).slice(0, 400) : null;
      episode.setStage(dir, stageId, { status: res.ok ? 'review' : 'error', sessionId: res.sessionId, report: res.report ? d.redact(res.report).slice(0, 8000) : null, error, costUsd: res.costUsd, qa });
      return { ok: res.ok, error, costUsd: res.costUsd };
    } catch (e) {
      const error = d.redact(String(e && e.message ? e.message : e)).slice(0, 400);
      episode.setStage(dir, stageId, { status: 'error', error });
      return { ok: false, error, costUsd: 0 };
    } finally {
      running.delete(dir);
    }
  }

  function cancel(dir) { const c = running.get(path.resolve(dir)); if (c) c.abort(); return Boolean(c); }

  /** Approve a stage's result. A stale agent stage (an earlier stage changed) can be kept as it is. */
  function approve(dir, stageId) {
    dir = guard(dir);
    const st = episode.read(dir);
    const s = episode.STAGES.find((x) => x.id === stageId);
    if (!s || !st.stages[stageId]) throw new Error('Unknown stage.');
    const status = st.stages[stageId].status;
    const ok = status === 'review' || (status === 'stale' && s.kind === 'agent');
    if (!ok) throw new Error('There\'s nothing to approve yet.');
    if (!episode.canRun(st, stageId)) throw new Error('Approve the earlier stages first.');
    const next = episode.setStage(dir, stageId, { status: 'approved' });
    // What the stage made goes to the Library too, for later episodes (in the background; never blocks approval).
    if (d.keep) Promise.resolve().then(() => d.keep(dir, stageId)).catch(() => {});
    return next;
  }

  function saveFile(dir, which, text) {
    dir = guard(dir);
    if (!EDITABLE.has(which) || typeof text !== 'string' || text.length > 400000) throw new Error('That file can\'t be edited here.');
    fs.writeFileSync(path.join(dir, 'presentation', FILES[which]), text);
    // Editing an approved file re-opens what was built on it.
    const st = episode.read(dir);
    const later = episode.STAGE_IDS.slice(episode.STAGE_IDS.indexOf(which === 'bullets' ? 'bullets' : 'script') + 1);
    for (const id of later) if (st.stages[id].status === 'approved') st.stages[id].status = 'stale';
    episode.write(dir, st);
    return open(dir);
  }

  // ── the user's calls for the deck ──
  const callEditable = (st) => st.stages.deck.status !== 'running';
  function addCall(dir, { module, slide = null, ask = '' } = {}) {
    dir = guard(dir);
    if (!modules.byId(module)) throw new Error('Pick one of the seven modules.');
    const text = String(ask || '').trim();
    if (!text) throw new Error('Say what you want, for example "animate the chart in this photo".');
    if (text.length > 2000) throw new Error('Keep the call under 2,000 characters.');
    const st = episode.read(dir);
    if (!callEditable(st)) throw new Error('The deck crew is working. Add calls when it\'s done.');
    const n = Number(slide);
    const calls = st.calls || [];
    const id = `c${calls.reduce((a, c) => Math.max(a, Number(String(c.id).slice(1)) || 0), 0) + 1}`;
    st.calls = [...calls, { id, module, slide: Number.isInteger(n) && n > 0 ? n : null, ask: text, attachments: [], at: new Date().toISOString() }];
    episode.write(dir, st);
    return open(dir);
  }

  function removeCall(dir, id) {
    dir = guard(dir);
    const st = episode.read(dir);
    if (!callEditable(st)) throw new Error('The deck crew is working. Change calls when it\'s done.');
    const call = (st.calls || []).find((c) => c.id === id);
    if (!call) throw new Error('That call is already gone.');
    for (const a of call.attachments || []) for (const rel of [a.path, a.poster]) if (rel) fs.rmSync(path.join(dir, 'presentation', rel), { force: true });
    st.calls = st.calls.filter((c) => c.id !== id);
    episode.write(dir, st);
    return open(dir);
  }

  const run = (cmd, args) => new Promise((resolve) => {
    const p = spawn(cmd, args, { env: { ...process.env, PATH: d.toolEnv().PATH }, stdio: 'ignore' });
    p.on('error', () => resolve(1));
    p.on('close', resolve);
  });

  /** Copy files the user picked (in a native dialog) into the episode, for one call. */
  async function attachFiles(dir, id, paths) {
    dir = guard(dir);
    const st = episode.read(dir);
    if (!callEditable(st)) throw new Error('The deck crew is working. Attach files when it\'s done.');
    const call = (st.calls || []).find((c) => c.id === id);
    if (!call) throw new Error('That call is gone.');
    call.attachments = [...(call.attachments || []), ...(await copyIn(dir, paths, path.join('assets', 'calls'), id))];
    episode.write(dir, st);
    return open(dir);
  }

  /**
   * Copy files into the episode's presentation/<rel>/ as <prefix>-<name>, after checking every one first (so a bad
   * file can't leave half a set behind). iPhone photos (HEIC) become JPEGs the crew can open; a clip gets a poster
   * frame. Returns [{ kind, name, path, poster? }] with paths relative to presentation/.
   */
  async function copyIn(dir, paths, rel, prefix) {
    const abs = path.join(dir, 'presentation', rel);
    fs.mkdirSync(abs, { recursive: true });
    const picked = (paths || []).map((src) => {
      const stat = fs.statSync(src);
      const kind = ATTACH.image.test(src) ? 'image' : ATTACH.video.test(src) ? 'video' : ATTACH.doc.test(src) ? 'doc' : null;
      if (!kind || !stat.isFile()) throw new Error(`${path.basename(src)}: attach a photo, a video clip, or a document (PDF, text, Word, web page).`);
      if (stat.size > MAX_ATTACH) throw new Error(`${path.basename(src)} is over 500 MB.`);
      return { src, kind };
    });
    const out = [];
    for (const { src, kind } of picked) {
      const safe = path.basename(src).normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/^-+/, '').slice(-80) || 'file';
      let name = `${prefix}-${safe}`;
      if (/\.(heic|heif)$/i.test(src)) {
        name = name.replace(/\.(heic|heif)$/i, '.jpg');
        if (await run('sips', ['-s', 'format', 'jpeg', src, '--out', path.join(abs, name)]) !== 0) throw new Error(`${path.basename(src)}: couldn't convert this photo. Try a JPEG or PNG.`);
      } else {
        fs.copyFileSync(src, path.join(abs, name));
      }
      const a = { kind, name: path.basename(src), path: path.join(rel, name) };
      if (kind === 'video') {
        const poster = `${name.replace(/\.[^.]+$/, '')}-poster.jpg`;
        if (await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '1', '-i', path.join(abs, name), '-frames:v', '1', '-q:v', '3', path.join(abs, poster)]) === 0) a.poster = path.join(rel, poster);
      }
      out.push(a);
    }
    return out;
  }

  function addCallLink(dir, id, url) {
    dir = guard(dir);
    let u;
    try { u = new URL(String(url || '').trim()); } catch { throw new Error('That doesn\'t look like a link.'); }
    if (!/^https?:$/.test(u.protocol)) throw new Error('Only web links (http or https).');
    const st = episode.read(dir);
    if (!callEditable(st)) throw new Error('The deck crew is working. Add links when it\'s done.');
    const call = (st.calls || []).find((c) => c.id === id);
    if (!call) throw new Error('That call is gone.');
    call.attachments = [...(call.attachments || []), { kind: 'link', name: u.host.replace(/^www\./, ''), url: u.toString() }];
    episode.write(dir, st);
    return open(dir);
  }

  function spendEstimate(dir) {
    dir = guard(dir);
    const v = open(dir);
    const secs = v.estimateSeconds || 0;
    return estimate([{ rate: 'heygen_avatar_s', qty: secs, label: `Your avatar for about ${Math.round(secs / 6) / 10} min of narration` }]);
  }

  async function approveSpend(dir) {
    dir = guard(dir);
    const st = episode.read(dir);
    if (!episode.canRun(st, 'spend')) throw new Error('Approve the script first.');
    const old = st.budgets && st.budgets.heygen;
    if (old && d.broker.isLive(old, 'heygen')) {
      if (st.stages.spend.status === 'approved') return { ok: true, usd: st.stages.spend.usd, already: true };
      d.broker.close(old); // the script changed since: that approval was for a different length
    }
    const est = spendEstimate(dir);
    const usd = est.byProvider.heygen ? est.byProvider.heygen.usd : 0;
    if (!usd) throw new Error('The script has no narration to film.');
    const ok = await d.confirm({ title: 'Spend money on HeyGen?', message: `Film "${st.title}" with your avatar?`,
      detail: `About ${usd.toFixed(2)} US dollars (4.1 cents a second of avatar video, plus up to 15 % margin). Nothing else will be charged.`,
      button: `Approve ${usd.toFixed(2)} US dollars` });
    if (!ok) return { ok: false, cancelled: true };
    const tokens = d.broker.approve(est, { project: st.title, stage: 'film' });
    st.budgets = { ...(st.budgets || {}), heygen: tokens.heygen };
    st.stages.spend = { status: 'approved', at: new Date().toISOString(), usd };
    episode.write(dir, st);
    return { ok: true, usd };
  }

  /** Free: render the slides and narrate them with the Mac's own voice, to check timing before paying for filming. */
  async function draft(dir, onLine, signal) {
    dir = guard(dir);
    const st = episode.read(dir);
    if (!episode.canRun(st, 'spend')) throw new Error('Approve the script first.');
    return exclusive(dir, async () => {
      const r1 = await d.pipeline.render(dir, { onLine, signal });
      if (r1.code !== 0) return { ok: false, error: 'The slides didn\'t render.', lines: r1.lines.slice(-10) };
      const r = await d.pipeline.draft(dir, { onLine, signal });
      const out = d.pipeline.draftOutput(dir);
      const ok = r.code === 0 && exists(out);
      return { ok, video: ok ? out : null, error: ok ? null : 'The draft didn\'t finish. See the log.', lines: r.lines.slice(-10) };
    });
  }

  async function film(dir, onLine, signal) {
    dir = guard(dir);
    const st = episode.read(dir);
    if (!episode.canRun(st, 'film')) throw new Error('Approve the spend first.');
    const token = st.budgets && st.budgets.heygen;
    if (!token || !d.broker.isLive(token, 'heygen')) throw new Error('The HeyGen budget isn\'t approved (or was already used). Approve the spend again.');
    return exclusive(dir, async () => {
      episode.setStage(dir, 'film', { status: 'running', error: null });
      try {
        const r1 = await d.pipeline.render(dir, { onLine, signal });
        if (r1.code !== 0) { episode.setStage(dir, 'film', { status: 'error', error: 'The slides didn\'t render.' }); return { ok: false, lines: r1.lines.slice(-10) }; }
        const est = spendEstimate(dir);
        d.broker.authorize(token, 'heygen', { usd: est.byProvider.heygen ? est.byProvider.heygen.usd : 0, what: `${st.title}: film` });
        let r;
        try {
          r = await d.pipeline.final(dir, token, { onLine, signal });
        } finally {
          // One approval, one filming run: whatever happened, the next attempt needs a fresh approval.
          d.broker.record(token, { what: `${st.title}: film`, code: r ? r.code : null });
          d.broker.close(token);
        }
        const ok = r.code === 0 && exists(d.pipeline.finalOutput(dir));
        episode.setStage(dir, 'film', { status: ok ? 'review' : 'error', error: ok ? null : (signal && signal.aborted ? 'Stopped.' : 'Filming didn\'t finish. See the log.') });
        return { ok, video: ok ? d.pipeline.finalOutput(dir) : null, lines: r.lines.slice(-12) };
      } catch (e) {
        episode.setStage(dir, 'film', { status: 'error', error: d.redact(String(e.message || e)).slice(0, 400) });
        throw e;
      }
    });
  }

  async function deliver(dir, onLine, signal) {
    dir = guard(dir);
    const st = episode.read(dir);
    if (!episode.canRun(st, 'deliver')) throw new Error('Approve the film first.');
    return exclusive(dir, async () => {
      episode.setStage(dir, 'deliver', { status: 'running', error: null });
      try {
        const w = await d.pipeline.web(dir, { onLine, signal });
        const p = w.code === 0 ? await d.pipeline.player(dir, { onLine, signal }) : w;
        const out = path.join(d.settings.read().deliverablesDir, episode.slugify(st.title));
        fs.mkdirSync(out, { recursive: true });
        const copies = [[d.pipeline.finalOutput(dir), 'presentation.mp4'], [d.pipeline.editMasterOutput(dir), `${episode.slugify(st.title)} (for CapCut).mov`],
          [path.join(dir, 'presentation', 'script.md'), 'script.md']];
        for (const [src, name] of copies) if (exists(src)) fs.copyFileSync(src, path.join(out, name));
        const playerDir = path.join(dir, 'presentation', 'player');
        if (p.code === 0 && exists(playerDir)) fs.cpSync(playerDir, path.join(out, 'player'), { recursive: true });
        episode.setStage(dir, 'deliver', { status: 'approved', folder: out, playerOk: p.code === 0 });
        if (d.keep) Promise.resolve().then(() => d.keep(dir, 'deliver', { finalVideo: d.pipeline.finalOutput(dir) })).catch(() => {});
        return { ok: true, folder: out, playerOk: p.code === 0, lines: p.lines ? p.lines.slice(-8) : [] };
      } catch (e) {
        episode.setStage(dir, 'deliver', { status: 'error', error: d.redact(String(e.message || e)).slice(0, 400) });
        throw e;
      }
    });
  }

  return { list, create, open, runStage, cancel, approve, saveFile, spendEstimate, approveSpend, draft, film, deliver, inProjects,
    addCall, removeCall, attachFiles, addCallLink };
}

module.exports = { createFlow, stageVars };
