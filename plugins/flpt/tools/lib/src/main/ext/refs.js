'use strict';
// ext/refs.js · references and styles in the flow (PLAN §2.2 seam 3, §2.11; W3-02), through the flow's hooks:
//   caps   what this surface can do with references and styles: a link captured as stills and motion (the Mac's
//          pinned headless shell; references.CAPS), pictures or a video of the user's, the style study and its price
//          (styleStudy: { usd }, stylestudy.STUDY_USD: the page shows what main asks), Save as style, and how Share
//          leaves the Mac (share: ['export'] today; 'queue' joins it once the review queue is deployed, D15/W4-09,
//          and only then does the Share sheet offer Send for review)
//   open   the episode's references as the REFERENCE well shows them (view.refs: [{ ref, title, kind }]), so a shot's
//          ids read as names; their pictures stay where they are (presentation/refs/, closed to every crew)
const fs = require('fs');
const path = require('path');
const references = require('../references');

const isPlain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

/** The episode's references: [{ ref, title, kind }] (no paths: the page asks flpt.refs.attached for pictures). */
function refsOf(dir) {
  const root = path.join(dir, 'presentation', 'refs');
  let names = [];
  try { names = fs.readdirSync(root).filter((n) => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(n)).sort(); } catch { return []; }
  return names.map((ref) => {
    const r = readJson(path.join(root, ref, 'ref.json')) || {};
    const card = readJson(path.join(root, ref, 'card.json'));
    return card ? { ref, title: String(r.title || ref).slice(0, 120), kind: references.validateCard(card).source.kind } : null;
  }).filter(Boolean);
}

module.exports = {
  id: 'refs',
  order: 60,
  hooks: {
    caps(ctx, caps) {
      const out = { ...caps };
      if (out.surface === 'mac') {
        if (!Array.isArray(out.referenceCapture) || !out.referenceCapture.length) out.referenceCapture = [...references.CAPS.link];
        out.referenceFiles = [...references.CAPS.files];
        out.styleStudy = { usd: require('../stylestudy').STUDY_USD };
        out.saveAsStyle = true;
        out.share = ['export'];
      }
      return out;
    },
    open(ctx, { dir, view }) {
      if (!isPlain(view)) return view;
      return { ...view, refs: refsOf(dir) };
    },
  },
  refsOf,
};
