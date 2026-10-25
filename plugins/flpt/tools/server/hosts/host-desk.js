'use strict';
// hosts/host-desk.js · flpt-server's host for --mode desk (PLAN §2.5 Desk row, R12; W4-01 builds the server side, W4-02
// the plugin's /flpt:desk and flpt-desk around it). The plugin's real renderer, on the plugin's own folders, in the
// pinned Chrome for Testing on 127.0.0.1. The Desk never spends: no approvals at all (every confirm is a no, caps
// approve: 'none'), no keys in it (its vault is empty and takes none), every paid kind refused and no provider reached
// from this process, as in local mode (host-local.js). Money stays in chat, where the paid CLIs ask in their own
// native dialog (T22).
const { createLocalHost } = require('./host-local');

/** @param {object} o  host-local's options; `projects` and `deliverables` are the plugin's own folders */
function createDeskHost(o) {
  return createLocalHost({ ...o, kind: 'desk', keys: {} });
}

module.exports = { createDeskHost };
