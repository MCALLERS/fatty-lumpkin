'use strict';
// ext/sharequeue.js · where Share's review queue is open (W4-09; decisions.md D15/M2), through the flow's caps hook:
// after ext/refs.js has said how Share leaves this surface (share: ['export'] on the Mac), 'queue' joins it when this
// host is signed in to FLPT's site (sharequeue.signInFor: the flow host's signIn, else W4-10's registered sign-in,
// { origin, headers() } with an origin FLPT may send to). Only then does the Share sheet offer Send for review
// (ui-share.js), and api/share.js's send reaches it; without a sign-in, Export is the one way out, as before. Nothing
// here reaches the network.
// The web: Save as style is the Mac's in 2.0 (ext/refs.js), so the web has no Mine style to share yet; its Worker
// already takes flpt.share.send (web/worker/routes/share.js) for when it does.
const sharequeue = require('../sharequeue');

module.exports = {
  id: 'sharequeue',
  order: 61, // after ext/refs.js (60), which sets share
  hooks: {
    caps(ctx, caps) {
      if (!Array.isArray(caps.share)) return caps;
      if (!sharequeue.signInFor(ctx && ctx.d) || caps.share.includes('queue')) return caps;
      return { ...caps, share: [...caps.share, 'queue'] };
    },
  },
};
