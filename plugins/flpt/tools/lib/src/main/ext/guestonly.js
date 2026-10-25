'use strict';
// Guest narrators (W4-11; guestvoice.js): is a guest's narration all that's left to film? Read off the pipeline's own
// count (film.source 'pipeline'), before the cartoon presenter (35) prices its voice and keeps no count of the rest:
// order 34. The count has narration still to make (film.nothing false) but no avatar clip and no voice line of the
// presenter's (flow.js prices any of the presenter's at 5 s at least), so all of it is a guest's (the Mac's guests,
// free and made offline, aren't in it). film.guestOnly says so; ext/guestvoice.js (37) reads it.
const fs = require('fs');
const path = require('path');
const guest = require('../guestvoice');

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const scriptOf = (dir) => { try { return fs.readFileSync(path.join(dir, 'presentation', 'script.md'), 'utf8'); } catch { return ''; } };

module.exports = {
  id: 'guestonly',
  order: 34,
  hooks: {
    estimate(ctx, { dir, est }) {
      if (!isObj(est) || !isObj(est.film) || est.film.source !== 'pipeline' || est.film.nothing) return est;
      if ((Array.isArray(est.lines) ? est.lines : []).some((l) => Number(l && l.qty) > 0)) return est;
      if (!Object.keys(guest.tagsOf(scriptOf(dir))).length) return est;
      return { ...est, film: { ...est.film, guestOnly: true } };
    },
  },
};
