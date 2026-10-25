'use strict';
// 0.7.1's Library, B-roll and Clippy methods behind the bridge contract (bridge-contract.js), unchanged in behaviour.
// Page code never hands over a path of its own: files come from the native dialog or a drop (the preload turns the
// dropped File objects into paths with webUtils), and everything else names a Library item by its id. Clippy runs only
// from its own window, when the user presses Clip it. Nothing here is offered to the crew. `c.libraryHost` is the
// Library as the shell keeps it (library-ipc.js on the Mac); `c.sender` is the page that called, for its progress.
const fs = require('fs');
const path = require('path');
const toolchain = require('../toolchain');
const { EXTENSIONS } = require('../library');
const { parseHttpUrl, youtubeId } = require('../linkmeta');
const { parseTime } = require('../timecode');

const OPENABLE = /\.(mp4|m4v|mov|webm|png|jpe?g|gif|webp|heic|tiff?|mp3|m4a|wav|aiff?|pdf)$/i; // never anything that runs
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const ensureTools = async (c) => c.lastDetect || c.detectTools();

const library = {
  ns: 'library',
  methods: {
    list: { args: ['text:20000?', 'json?'], handler: (c, query, filters) => {
      const L = c.libraryHost;
      const l = L.library();
      const f = filters && typeof filters === 'object' ? filters : {};
      const items = l.search(typeof query === 'string' ? query.slice(0, 300) : '', { kind: typeof f.kind === 'string' ? f.kind : null, tag: typeof f.tag === 'string' ? f.tag : null });
      return { dir: l.dir, items: items.map(L.card), total: l.list().length, facets: l.facets(), cutaway: exists(path.join(L.CUTAWAY_DIR, 'catalog.json')), importing: L.running.import };
    } },
    get: { args: ['text:256?'], handler: (c, id) => c.libraryHost.library().get(id) },
    addFiles: { args: [], handler: async (c) => {
      const r = await c.dialogs.open({
        title: 'Add to the Library', buttonLabel: 'Add', properties: ['openFile', 'openDirectory', 'multiSelections'],
        filters: [{ name: 'Pictures, video, sound and documents', extensions: EXTENSIONS }],
      });
      if (r.canceled || !r.filePaths.length) return { cancelled: true };
      return c.libraryHost.addPaths(r.filePaths, c.sender);
    } },
    addPaths: { args: ['dropped'], expose: 'library.addDropped', handler: (c, paths) => c.libraryHost.addPaths(paths, c.sender) },
    addLink: { args: ['text:20000?'], handler: async (c, url) => {
      await ensureTools(c);
      const it = await c.libraryHost.library().saveLink({ url: typeof url === 'string' ? url.slice(0, 2000) : '', addedBy: 'you' });
      return { item: c.libraryHost.card(it), duplicate: Boolean(it.duplicate) };
    } },
    update: { args: ['text:256?', 'json?'], handler: (c, id, patch) => {
      const p = patch && typeof patch === 'object' ? patch : {};
      return c.libraryHost.library().update(id, { title: p.title, notes: p.notes, tags: p.tags });
    } },
    remove: { args: ['text:256?'], handler: async (c, id) => {
      const it = c.libraryHost.library().get(id);
      const { response } = await c.dialogs.ask({
        type: 'warning', buttons: ['Cancel', 'Move to Trash'], defaultId: 0, cancelId: 0,
        message: `Move “${it.title}” to the Trash?`, detail: 'You can put it back from the Trash.',
      });
      if (response !== 1) return { removed: false };
      await c.libraryHost.library().remove(id);
      return { removed: true };
    } },
    reveal: { args: ['text:256?'], handler: (c, id) => {
      const it = c.libraryHost.library().get(id);
      c.os.showItemInFolder(it.filePath || it.thumbPath || path.join(it.dir, 'item.json'));
      return true;
    } },
    open: { args: ['text:256?'], handler: async (c, id) => {
      const it = c.libraryHost.library().get(id);
      if (!it.filePath || !OPENABLE.test(it.filePath)) return false;
      const err = await c.os.openPath(it.filePath);
      if (err) throw new Error(err);
      return true;
    } },
    // Opens an item's source in the browser: only an http(s) link stored on a Library item, never a string from the page.
    openSource: { args: ['text:256?'], handler: async (c, id) => {
      const it = c.libraryHost.library().get(id);
      let url = it.source.url || (it.clip && it.clip.url) || '';
      const u = parseHttpUrl(url);
      if (!u) return false;
      if (it.clip && youtubeId(u.href) && it.clip.start) {
        const s = parseTime(it.clip.start);
        if (s != null) { u.searchParams.set('t', `${Math.floor(s)}s`); url = u.href; } // start at the moment
      }
      await c.os.openExternal(parseHttpUrl(url).href);
      return true;
    } },
    importCutaway: { args: [], handler: async (c) => {
      const L = c.libraryHost;
      if (L.running.import) throw new Error('Already importing.');
      if (!exists(path.join(L.CUTAWAY_DIR, 'catalog.json'))) throw new Error('No Cutaway Library at ~/Projects/Cutaway Library.');
      L.running.import = true;
      try {
        await ensureTools(c);
        return await L.library().importCutaway(L.CUTAWAY_DIR, {
          onProgress: (p) => { if (!c.sender.isDestroyed()) c.sender.send('library:progress', { what: 'import', ...p }); },
        });
      } finally {
        L.running.import = false;
        if (!c.sender.isDestroyed()) c.sender.send('library:progress', { what: 'import', finished: true });
      }
    } },
  },
  events: [
    { name: 'library:changed', expose: 'library.onChanged' },
    { name: 'library:progress', expose: 'library.onProgress' },
    { name: 'library:show', expose: 'library.onShow' },
    { name: 'generate:event', expose: 'library.onGenerate' },
  ],
};

// B-roll: the page sends the words and three choices; the price, the dialog and the money are all decided here.
const generate = {
  ns: 'generate',
  methods: {
    quote: { args: ['json?'], expose: 'library.brollQuote', handler: (c, form) => c.libraryHost.generator().quoteBroll(form) },
    broll: { args: ['json?'], expose: 'library.makeBroll', handler: async (c, form) => {
      const r = await c.libraryHost.generator().makeBroll(form);
      return r.item ? { item: c.libraryHost.card(r.item) } : r;
    } },
    status: { args: [], expose: 'library.generateStatus', handler: (c) => c.libraryHost.generator().status() },
  },
};

const clippy = {
  ns: 'clippy',
  methods: {
    open: { args: [], handler: (c) => c.windows.open('clippy') },
    status: { args: [], handler: (c) => c.libraryHost.clippyStatus() },
    run: { args: ['json?'], handler: (c, form) => c.libraryHost.runClip(form, c.sender) },
    cancel: { args: [], handler: (c) => { const L = c.libraryHost; if (L.running.clip) L.running.clip.abort(); return true; } },
    chooseYtDlp: { args: [], handler: async (c) => {
      const r = await c.dialogs.open({ title: 'Choose yt-dlp', buttonLabel: 'Use this one', properties: ['openFile', 'showHiddenFiles', 'treatPackageAsDirectory'] });
      if (r.canceled || !r.filePaths.length) return c.libraryHost.clippyStatus();
      const p = r.filePaths[0];
      const v = await toolchain.ytDlpVersion(p);
      if (!v) throw new Error('That doesn\'t look like yt-dlp (it didn\'t answer --version).');
      c.settings.write({ ytDlpPath: p });
      return c.libraryHost.clippyStatus();
    } },
    installYtDlp: { args: [], handler: async (c) => {
      const L = c.libraryHost;
      if (L.running.install) throw new Error('Already installing.');
      L.running.install = true;
      try {
        await toolchain.install({
          dir: c.dirs.toolchain, manifestFile: c.MANIFEST, only: ['yt-dlp'],
          onProgress: (p) => { if (!c.sender.isDestroyed()) c.sender.send('clippy:event', { phase: 'install', ...p }); },
        });
      } finally { L.running.install = false; }
      return L.clippyStatus();
    } },
    showInLibrary: { args: ['text:256?'], handler: (c, id) => {
      if (!c.windows.focusMain()) return false;
      c.send('library:show', { id: typeof id === 'string' ? id : null });
      return true;
    } },
  },
  events: [{ name: 'clippy:event', expose: 'clippy.onEvent' }],
};

module.exports = [library, generate, clippy];
