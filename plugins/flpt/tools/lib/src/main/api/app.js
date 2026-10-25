'use strict';
// flpt.app.caps(): what this surface can do (PLAN §2.2, "Capabilities"). The page branches only on these, never on
// which surface it runs in; every "no" maps to a divergence in parity/features.json. The shell supplies them (the Mac:
// shell/caps.js, extended by other shell modules with ctx.addCaps), then each flow extension's caps hook (flow.caps).
//   { surface: 'mac'|'web'|'desk', approve: 'native'|'modal'|'none', sandbox: 'seatbelt'|'bwrap'|'none',
//     toolchain: 'pinned'|'system', clippy, reveal, download, nativeWindows, presenters: […], referenceCapture: […],
//     paidSteps: […], crew: 'sdk'|'chat' }
module.exports = {
  ns: 'app',
  methods: {
    caps: { args: [], handler: (c) => c.flow.caps(c.caps()) },
  },
};
