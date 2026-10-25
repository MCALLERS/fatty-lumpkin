'use strict';
// The crew's view of the user's Library (library.js), for the in-process tools in agents.js:
//   search  what's there (clips, pictures, links, and what earlier episodes made)
//   use     copy one item into this episode's presentation/assets/library/, so the crew can open it and put it on a
//           slide (through the deck's asset map), and note the episode in the item's "used in"
//   save    a good find: a link or a picture, with its source. Never video: library.js refuses that from the crew.
// And keep(): what FLPT itself made, saved back to the Library so later episodes can reuse it.
const fs = require('fs');
const path = require('path');
const episode = require('./episode');

// By exact module id (`motion`, `motion-solo` and `motion-duet` are three modules). Title cards aren't kept.
const MODULE_NAMES = { chart: 'Live chart', sketch: 'Hand-drawn chart', motion: 'Motion graphic', cosmos: 'Cosmos cartoon', inset: 'Video inset', infographic: 'Infographic',
  'motion-solo': 'Motion Solo', 'motion-duet': 'Motion Duet' };

function crewLibrary(lib, projectDir) {
  const pres = path.join(projectDir, 'presentation');
  return {
    async search(query, kind) {
      return lib.search(String(query || ''), { kind: kind || null }).slice(0, 25).map((it) => ({
        id: it.id, kind: it.kind, title: it.title, tags: it.tags, notes: String(it.notes || '').slice(0, 300),
        source: (it.source && (it.source.url || it.source.site)) || null, clip: it.clip || null, usedIn: it.usedIn || [],
      }));
    },
    async use(id) {
      const it = lib.get(String(id));
      // lib.get already refuses references; this holds even if a hand-edited index says otherwise.
      const { assertNotReference } = require('./references');
      assertNotReference(it.filePath);
      assertNotReference(it.thumbPath);
      const rel = path.join('assets', 'library');
      fs.mkdirSync(path.join(pres, rel), { recursive: true });
      const out = { id: it.id, kind: it.kind, title: it.title, source: it.source || null, clip: it.clip || null };
      if (it.filePath && fs.existsSync(it.filePath)) {
        const name = `${it.id}${path.extname(it.filePath).toLowerCase()}`;
        fs.copyFileSync(it.filePath, path.join(pres, rel, name));
        out.path = path.join(rel, name);
      }
      if (it.thumbPath && fs.existsSync(it.thumbPath)) {
        const poster = `${it.id}-poster.jpg`;
        fs.copyFileSync(it.thumbPath, path.join(pres, rel, poster));
        out.poster = path.join(rel, poster);
      }
      if (!out.path && it.source && it.source.url) out.link = it.source.url;
      const st = episode.read(projectDir);
      if (st && st.title) lib.markUsed(it.id, st.title);
      return out;
    },
    async save({ url, title, kind, notes = '', tags = [] } = {}) {
      const it = await lib.saveLink({ url, title, kind, notes, tags, addedBy: 'crew' });
      return { id: it.id, kind: it.kind, title: it.title, saved: !it.duplicate };
    },
  };
}

/**
 * Save what an approved stage made to the Library: the deck's module slides (charts, sketches, infographics…) when the
 * deck is approved, the animators' slides (their previews) when Animate is, and the finished video when it's
 * delivered. Identical files are recognised, so re-approving adds nothing new. Returns how many items were added.
 */
async function keep(lib, projectDir, stageId, { finalVideo } = {}) {
  const st = episode.read(projectDir);
  if (!st) return 0;
  const pres = path.join(projectDir, 'presentation');
  let added = 0;
  const add = async (file, meta) => {
    if (!fs.existsSync(file)) return;
    const it = await lib.addFile(file, { ...meta, kind: 'flpt', addedBy: 'episode' });
    if (it && !it.duplicate) added += 1;
  };
  if (stageId === 'deck') {
    let map = null;
    let order = [];
    try { map = JSON.parse(fs.readFileSync(path.join(pres, 'deck', 'project', 'modules.json'), 'utf8')); } catch { /* none */ }
    try { order = JSON.parse(fs.readFileSync(path.join(pres, 'deck', 'project', 'deck.json'), 'utf8')).order || []; } catch { /* none */ }
    for (const [i, id] of order.entries()) {
      const mod = map && map.slides && map.slides[id] && map.slides[id].module;
      if (typeof mod !== 'string' || !Object.prototype.hasOwnProperty.call(MODULE_NAMES, mod)) continue; // statement slides aren't worth keeping on their own
      const png = path.join(pres, 'slides', `slide_${String(i + 1).padStart(2, '0')}.png`);
      await add(png, { title: `${MODULE_NAMES[mod]}: ${st.title}, slide ${i + 1}`, tags: [MODULE_NAMES[mod], st.title], notes: `From "${st.title}" (${id}).` });
    }
  }
  if (stageId === 'animate') {
    for (const a of require('./animators').view(projectDir).filter((x) => x.made && x.preview)) {
      await add(a.preview, { title: `Animation: ${st.title}, slide ${a.n}`, tags: ['Animation', st.title], notes: `From "${st.title}" (${a.id}): ${a.brief}`.slice(0, 600) });
    }
  }
  if (stageId === 'deliver' && finalVideo) await add(finalVideo, { title: st.title, tags: ['Episode', st.title], notes: 'The delivered episode.' });
  if (stageId === 'scenes') {
    // Each cut scene that was made, as a clip: Refine can use it as B-roll in a later episode.
    const scenes = require('./scenes');
    const state = scenes.readState(projectDir);
    for (const p of scenes.view(projectDir).pieces.filter((x) => x.kind === 'cutscene' && x.clip)) {
      const shot = scenes.approvedTake(((state.pieces[p.key] || {}).slots || {}).shot1 || { takes: [] });
      const where = shot && shot.provider === 'higgsfield' ? 'Higgsfield' : 'Kie.ai';
      const it = await lib.addFile(p.clip, { kind: 'clip', addedBy: 'episode', title: p.title, tags: ['Cut scene', 'generated', st.title], notes: `A cut scene from "${st.title}".`,
        source: { site: where, rights: `AI-generated: Seedance 2.5 on ${where}.` } });
      if (it && !it.duplicate) added += 1;
    }
  }
  return added;
}

module.exports = { crewLibrary, keep, MODULE_NAMES };
