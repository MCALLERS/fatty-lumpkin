'use strict';
// 0.7.1's Setup methods behind the bridge contract (bridge-contract.js), unchanged in behaviour: the app's state and
// settings, the toolchain, the keys, the presenter, the free check, the free sample and the optional paid sample, jobs,
// and opening what this session made. Each keeps the name the page has always called it by (`expose`), and `raw`: the
// page gets the value itself. `c` is the context the shell builds (services.js plus its dialogs, OS calls and windows).
const fs = require('fs');
const path = require('path');
const toolchain = require('../toolchain');
const { testKey } = require('../keytests');
const { KEYS } = require('../vault');
const { estimate } = require('../broker');
const heygen = require('../heygen');

const LOCK_DIR = path.join(__dirname, '..', 'hyperframes'); // HyperFrames' pinned lockfile
// The paid sample films sample.js's slide 1 (219 characters, the same every time): about 15 s in the HeyGen voice, 16.1 s
// of avatar with its tail, billed by the started second. Priced as it is filmed (W6-02a: the web's broker meters each
// call, and the old 15 s with no voice came to less than the sample spends).
const SAMPLE = () => estimate([{ rate: 'heygen_avatar_s', qty: 17, label: 'Slide 1 with your avatar (about 16 s)' },
  { rate: 'heygen_tts_s', qty: 15, label: 'Its narration in your HeyGen voice (about 15 s)' }]);
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const MEDIA = /\.(mp4|mov|m4v|png|jpe?g)$/i;

/** The projects and deliverables folders, where the page may reveal anything and open media. */
function inUserFolders(c, p) {
  const folders = [c.settings.read().projectsDir, c.settings.read().deliverablesDir].map((d) => path.resolve(d));
  return typeof p === 'string' && path.isAbsolute(p) && exists(p) && folders.some((d) => path.resolve(p).startsWith(d + path.sep));
}

const app = {
  ns: 'app',
  methods: {
    state: { args: [], raw: true, expose: 'state', handler: async (c) => { if (!c.lastDetect) await c.detectTools(); return c.state(); } },
  },
};

const settings = {
  ns: 'settings',
  methods: {
    set: { args: ['json?'], raw: true, expose: 'saveSettings', handler: (c, patch) => {
      const allowed = ['seenWelcome', 'setupComplete', 'toolchainMode', 'providers', 'liveCrew'];
      const clean = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => allowed.includes(k)));
      const value = c.settings.write(clean);
      return { settings: value, persisted: c.settings.persisted() };
    } },
  },
};

const tools = {
  ns: 'tools',
  methods: {
    detect: { args: [], raw: true, expose: 'detectTools', handler: (c) => c.detectTools() },
    install: { args: [], raw: true, expose: 'installTools', handler: async (c) => {
      const mode = c.settings.read().toolchainMode;
      const onProgress = (p) => c.send('tools:progress', p);
      try {
        if (mode === 'pinned') await toolchain.install({ dir: c.dirs.toolchain, manifestFile: c.MANIFEST, onProgress });
        const det = await c.detectTools();
        const py = det.tools.find((t) => t.id === 'python');
        if (!py || !py.path) throw new Error('Python wasn\'t found.');
        // a venv made before requirements.lock (or not stamped from it) moves onto it here, in the explicit Install only
        if (!py.venv || !py.packages || !py.locked) await toolchain.setupPython({ dir: c.dirs.toolchain, pythonBase: py.path, onProgress });
        // Moving slides: HyperFrames. Not required, so a failure here (offline, say) doesn't fail the setup.
        let warning = null;
        const node = (await c.detectTools()).tools.find((t) => t.id === 'node');
        const hf = c.lastDetect.tools.find((t) => t.id === 'hyperframes');
        if (!(hf && hf.ok)) {
          try {
            if (!node || !node.path) throw new Error('Node.js wasn\'t found');
            await toolchain.setupHyperFrames({ dir: c.dirs.toolchain, manifestFile: c.MANIFEST, node: node.path, lockDir: LOCK_DIR, onProgress });
          } catch (e) {
            warning = `Moving slides aren't available yet: ${c.redact(e.message)}`;
          }
        }
        return { ok: true, warning, tools: await c.detectTools() };
      } catch (e) {
        return { ok: false, error: c.redact(e.message), tools: await c.detectTools() };
      }
    } },
  },
  events: [{ name: 'tools:progress', expose: 'onToolsProgress' }],
};

const keys = {
  ns: 'keys',
  methods: {
    set: { args: ['id', 'text:4096?'], raw: true, expose: 'setKey', handler: async (c, name, value) => {
      try {
        c.vault.set(name, value);
        const test = await testKey(name, c.vault.get(name));
        return { ok: true, keys: c.vault.status(), test: { name, ...test } };
      } catch (e) {
        return { ok: false, error: c.redact(e.message), keys: c.vault.status() };
      }
    } },
    test: { args: ['id'], raw: true, expose: 'testKey', handler: async (c, name) => ({ name, ...(await testKey(name, c.vault.get(name))) }) },
    remove: { args: ['id'], raw: true, expose: 'removeKey', handler: (c, name) => { if (KEYS[name]) c.vault.remove(name); return c.vault.status(); } },
    import: { args: [], raw: true, expose: 'importLegacy', handler: async (c) => ({ ...c.importLegacy(), state: c.state() }) },
  },
};

const presenter = {
  ns: 'presenter',
  methods: {
    looks: { args: [], raw: true, expose: 'looks', handler: async (c) => {
      const job = c.startJob('Reading your HeyGen looks');
      try {
        const dir = await c.ensureSampleProject(job);
        const r = await c.pipeline.looks(dir, { onLine: job.onLine, signal: job.signal });
        job.finish(r);
        if (r.code !== 0) return { ok: false, error: 'HeyGen didn\'t return your looks. Check the HeyGen key.', lines: r.lines.slice(-8) };
        const pdir = c.pipeline.pickerDir(dir);
        const items = JSON.parse(fs.readFileSync(path.join(pdir, 'looks.json'), 'utf8'));
        const looks = items.map((l, i) => {
          const img = path.join(pdir, `look_${String(i + 1).padStart(2, '0')}.img`);
          let thumb = null;
          try { thumb = `data:image/jpeg;base64,${fs.readFileSync(img).toString('base64')}`; } catch { /* no preview */ }
          return { n: i + 1, id: l.id, name: l.name || '', twin: l.avatar_type === 'digital_twin', voiceId: l.default_voice_id || null, thumb };
        });
        return { ok: true, looks };
      } catch (e) {
        job.finish({ code: 1 });
        return { ok: false, error: c.redact(e.message) };
      }
    } },
    // The user's own voices plus the looks' linked ones (free GETs with the HeyGen key, here in the main process).
    // Remembered, so choosing one knows which speech engines it can use.
    voices: { args: ['json?'], raw: true, expose: 'voices', handler: async (c, linkedIds) => {
      const key = c.vault.get('HEYGEN_API_KEY');
      if (!key) return { ok: false, error: 'Add your HeyGen key first.' };
      try {
        const list = await heygen.voicesFor(key, Array.isArray(linkedIds) ? linkedIds.slice(0, 50) : []);
        c.knownVoices.clear();
        for (const v of list) c.knownVoices.set(v.id, v);
        return { ok: true, voices: list.map((v) => ({ id: v.id, name: v.name, language: v.language, preview: Boolean(v.preview), speaks: heygen.pickEngine(v) !== null })) };
      } catch (e) {
        return { ok: false, error: c.redact(e.message) };
      }
    } },
    // HeyGen's own short sample of a voice (free), saved next to the looks so the page can play it through flpt://.
    preview: { args: ['text:256?'], raw: true, expose: 'voicePreview', handler: async (c, voiceId) => {
      const v = c.knownVoices.get(String(voiceId));
      if (!v || !v.preview) return { ok: false, error: 'HeyGen has no sample of this voice.' };
      try {
        const dir = path.join(c.sampleDir(), 'presentation', 'video', 'output', 'picker', 'voices');
        const file = path.join(dir, `${v.id.replace(/[^\w.-]/g, '_')}${/\.wav(\?|$)/i.test(v.preview) ? '.wav' : /\.m4a(\?|$)/i.test(v.preview) ? '.m4a' : '.mp3'}`);
        if (!exists(file)) {
          const res = await fetch(v.preview, { signal: AbortSignal.timeout(20000) });
          const buf = res.ok ? Buffer.from(await res.arrayBuffer()) : null;
          if (!buf || !buf.length || buf.length > 10 * 1024 * 1024) return { ok: false, error: 'The sample didn\'t download.' };
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(file, buf);
        }
        return { ok: true, url: c.fileUrl(file) };
      } catch (e) {
        return { ok: false, error: c.redact(e.message) };
      }
    } },
    set: { args: ['json?'], raw: true, expose: 'setPresenter', handler: async (c, p) => {
      const current = c.pipeline.readPresenter();
      const key = c.vault.get('HEYGEN_API_KEY');
      const choice = await heygen.presenterChoice(p || {}, {
        current, currentVoiceName: (c.settings.read().presenter || {}).voiceName || '', known: c.knownVoices,
        lookup: async (id) => (key ? heygen.voice(key, id) : null),
      });
      if (!choice.ok) return choice;
      c.pipeline.writePresenter({ ...current, ...choice.env });
      c.settings.write({ presenter: choice.presenter });
      return { ok: true, state: c.state() };
    } },
  },
};

const check = {
  ns: 'check',
  methods: {
    run: { args: [], raw: true, expose: 'runCheck', handler: async (c) => {
      const job = c.startJob('Free system check');
      try {
        const dir = await c.ensureSampleProject(job);
        const rr = await c.ensureRendered(dir, job);
        if (rr.code !== 0) return job.finish(rr);
        const r = await c.pipeline.check(dir, { onLine: job.onLine, signal: job.signal });
        // The pipeline checks the voice exists; this checks it can still speak with the chosen engine.
        const p = c.pipeline.readPresenter();
        const key = c.vault.get('HEYGEN_API_KEY');
        if (r.code === 0 && key && p.HEYGEN_VOICE_ID && p.HEYGEN_VOICE_ENGINE) {
          const e = await heygen.checkEngine(key, p.HEYGEN_VOICE_ID, p.HEYGEN_VOICE_ENGINE).catch(() => ({ ok: null }));
          if (e.ok === false) {
            const line = `✗ ${e.voice} can't speak with the ${p.HEYGEN_VOICE_ENGINE} engine (it can use ${e.engines.join(', ') || 'none'}). Pick the voice again in step 3.`;
            job.onLine(line);
            return job.finish({ ...r, code: 1, lines: [...r.lines, line] });
          }
          if (e.ok) job.onLine(`✓ ${e.voice} speaks with the ${p.HEYGEN_VOICE_ENGINE} engine`);
        }
        return job.finish(r);
      } catch (e) { return job.finish({ code: 1, lines: [c.redact(e.message)] }); }
    } },
  },
};

const sample = {
  ns: 'sample',
  methods: {
    draft: { args: [], raw: true, expose: 'draftSample', handler: async (c) => {
      const job = c.startJob('Free sample video');
      try {
        const dir = await c.ensureSampleProject(job);
        const r1 = await c.pipeline.render(dir, { onLine: job.onLine, signal: job.signal });
        if (r1.code !== 0) return job.finish({ code: r1.code, lines: r1.lines.slice(-10) });
        const r2 = await c.pipeline.draft(dir, { onLine: job.onLine, signal: job.signal });
        const out = c.pipeline.draftOutput(dir);
        if (r2.code === 0 && exists(out)) c.produced.add(out);
        return job.finish({ code: r2.code, output: exists(out) ? out : null, lines: r2.lines.slice(-10) });
      } catch (e) { return job.finish({ code: 1, lines: [c.redact(e.message)] }); }
    } },
    // Optional paid sample: estimate → the core's spend confirmation (c.confirm: the native dialog on the Mac, the
    // approval path on the web) → budget token → run.
    estimate: { args: [], raw: true, expose: 'estimateSample', handler: () => SAMPLE() },
    approveAndRun: { args: [], raw: true, expose: 'approveSample', handler: async (c) => {
      const e = SAMPLE(); // never trust the page's numbers
      const usd = e.byProvider.heygen.usd;
      const yes = await c.confirm({
        title: 'Paid sample', message: 'Spend money on HeyGen?', button: `Approve ${usd.toFixed(2)} US dollars`,
        detail: `This renders slide 1 of the sample with your avatar: about ${usd.toFixed(2)} US dollars (estimate, plus up to 15 % margin). Nothing else will be charged.`,
      });
      if (yes !== true) return { ok: false, cancelled: true };
      const tokens = c.broker.approve(e, { project: 'sample', stage: 'paid sample' });
      c.broker.authorize(tokens.heygen, 'heygen', { usd, what: 'sample slide 1' });
      const job = c.startJob('Paid sample slide');
      try {
        const dir = await c.ensureSampleProject(job);
        const r = await c.pipeline.sampleFinal(dir, tokens.heygen, { onLine: job.onLine, signal: job.signal });
        c.broker.record(tokens.heygen, { what: 'sample slide 1', code: r.code });
        c.broker.close(tokens.heygen);
        return job.finish(r);
      } catch (err) { c.broker.close(tokens.heygen); return job.finish({ code: 1, lines: [c.redact(err.message)] }); }
    } },
  },
};

const job = {
  ns: 'job',
  methods: {
    cancel: { args: ['text:64?'], raw: true, expose: 'cancelJob', handler: (c, id) => { const ctrl = c.jobs.get(id); if (ctrl) ctrl.abort(); return Boolean(ctrl); } },
  },
  events: [{ name: 'job:event', expose: 'onJob' }],
};

// The page may open or reveal what this session made, plus (open) videos and images and (reveal) anything inside the
// projects and deliverables folders. Opening is limited to media so nothing an agent wrote can run.
const file = {
  ns: 'file',
  methods: {
    open: { args: ['fileref?'], raw: true, expose: 'openFile', handler: (c, p) => ((c.produced.has(p) || (inUserFolders(c, p) && MEDIA.test(p))) ? c.os.openPath(p) : null) },
    reveal: { args: ['fileref?'], raw: true, expose: 'revealFile', handler: (c, p) => { const ok = c.produced.has(p) || inUserFolders(c, p); if (ok) c.os.showItemInFolder(p); return ok; } },
  },
};

module.exports = [app, settings, tools, keys, presenter, check, sample, job, file];
