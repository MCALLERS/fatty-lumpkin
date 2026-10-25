'use strict';
// 0.7.1's Transitions & Music methods behind the bridge contract (bridge-contract.js), unchanged in behaviour: the
// repository the Refine step picks from, shown in its own window. Files come only from the native dialog or a drop (the
// preload turns dropped File objects into paths); everything else names an item by its id. `c.addonsHost` is the
// repository as the shell keeps it (addons-ipc.js on the Mac).
const fs = require('fs');
const path = require('path');

const EXTS = ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'mp3', 'm4a', 'wav', 'aif', 'aiff', 'aac', 'flac', 'ogg'];

module.exports = {
  ns: 'addons',
  methods: {
    open: { args: [], handler: (c) => c.windows.open('addons') },
    list: { args: [], handler: (c) => c.addonsHost.shelves() },
    add: { args: [], handler: async (c) => {
      const r = await c.dialogs.open({ title: 'Add to Transitions & Music', buttonLabel: 'Add', properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Video and sound', extensions: EXTS }] });
      if (r.canceled || !r.filePaths.length) return { cancelled: true };
      return c.addonsHost.addPaths(r.filePaths);
    } },
    addPaths: { args: ['dropped'], expose: 'addons.addDropped', handler: (c, paths) => c.addonsHost.addPaths(paths) },
    remove: { args: ['text:256?'], handler: async (c, id) => {
      const it = c.addonsHost.addons().get(id);
      const { response } = await c.dialogs.ask({
        type: 'warning', buttons: ['Cancel', 'Move to Trash'], defaultId: 0, cancelId: 0,
        message: `Move “${it.title}” to the Trash?`, detail: 'You can put it back from the Trash.',
      });
      if (response !== 1) return { removed: false };
      await c.addonsHost.addons().remove(id);
      return { removed: true };
    } },
    reveal: { args: ['text:256?'], handler: (c, id) => {
      if (id == null) { const r = c.addonsHost.addons(); fs.mkdirSync(r.dir, { recursive: true }); c.os.openPath(r.dir); return true; }
      const it = c.addonsHost.addons().get(id);
      c.os.showItemInFolder(it.filePath || path.join(it.dir, 'item.json'));
      return true;
    } },
    credit: { args: ['text:256?', 'text:20000?'], expose: 'addons.setCredit', handler: (c, id, text) => c.addonsHost.addons().setCredit(id, typeof text === 'string' ? text.slice(0, 2000) : '') },
  },
  events: [{ name: 'addons:changed', expose: 'addons.onChanged' }],
};
