'use strict';
// "Cartoon you" in the flow (W3-10), as a flow extension: only its caps. The Mac app, with its native spend dialog and
// macOS's sandbox, can make a cartoon from the user's own photos (caps.likeness, and 'likeness' among the presenters);
// the web and the Desk can't (DV12: no face photos ever leave the Mac but what a paid step sends Kie.ai). The screen
// (ui-likeness.js) registers itself only where caps.likeness says so.
module.exports = {
  id: 'likeness',
  order: 36,
  hooks: {
    caps(ctx, caps) {
      if (!caps || caps.surface !== 'mac' || caps.approve !== 'native' || caps.sandbox !== 'seatbelt') return caps;
      const presenters = Array.isArray(caps.presenters) ? caps.presenters : ['heygen'];
      const paid = Array.isArray(caps.paidSteps) ? caps.paidSteps : [];
      return { ...caps, likeness: true, presenters: presenters.includes('likeness') ? presenters : [...presenters, 'likeness'],
        paidSteps: paid.includes('likeness') ? paid : [...paid, 'likeness'] };
    },
  },
};
