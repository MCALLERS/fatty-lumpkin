'use strict';
// flpt.gallery: the Style Gallery's window and its pick mode (PLAN §3.3 S12–S13, §3.4 ⌥⌘G; W3-01). The window itself is
// the surface's (the Mac: shell/gallery.js, given here as ctx.galleryHost); a surface without one answers "No Gallery
// window here." The page names an episode, a shot and a style key, never a path.
//   open({ episode, shot }?)  the Gallery, brought forward; with a shot, in pick mode for it (the Storyboard inspector's
//                             STYLE slot). Without one (⌥⌘G, the top bar's ◱) a pick in progress stays: pick mode ends
//                             only through Cancel (leave), Use, or closing the window.
//   state()                   { pick: { episode, shot, label, current } | null, catalog, latest }: what the window shows
//                             (catalog: a catalog client is here, so Check for new styles shows; latest: its line,
//                             "2.0.3 is out", or null)
//   forShot(episode, shot)    the style a shot is drawn in (its own, the episode's, else its kind's default), for the
//                             inspector's slot: { style, name, poster (a file the page shows through flpt://), own, editable }
//   use(key, episode?)        pick mode: the shot gets the style (the Storyboard's own edit, flpt.storyboard.op, checked
//                             there), the main window comes forward and hears gallery:picked to show that shot (Clippy's
//                             showInLibrary pattern). Without pick mode, with an episode: that episode's default style
//                             (only while its plan isn't approved: an edit there would send it back to review).
//   leave()                   pick mode ends
//   episodes()                the episodes whose plan may take a default style now (planning, not yet approved):
//                             [{ episode, title }]
//   yourLook({ inspiration }?) the reference sheet (W3-02's), in the main window, with one of the six places' links
//                             (and, in pick mode, the shot it's for)
//   share(key)                a Mine style's Share sheet (W3-02's), in the main window
//   check()                   Check for new styles: the signed catalog client's check() (W3-11), on this press only;
//                             → { added, revoked, latest } (counts, and the line); catalog:changed to the main window and
//                             styles:changed to both
// Events: gallery:state (to the Gallery), gallery:picked, gallery:your-look and gallery:share (to the main window).
// Nothing here costs anything; check() is the only call that may reach the network, and only through the catalog client.
const path = require('path');
const episode = require('../episode');
const storyboard = require('../storyboard');
const plan = require('../ext/storyboard');
const planview = require('../ext/planview');
const stylesApi = require('./styles');
const storyboardApi = require('./storyboard');

const SHOT = /^s[1-9][0-9]{0,3}$/;
const pad2 = (n) => String(n).padStart(2, '0');
// eslint-disable-next-line no-control-regex
const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

const hostOf = (c) => {
  if (!c || !c.galleryHost) throw new Error('No Gallery window here.');
  return c.galleryHost;
};

/** The episode folder, checked: inside the projects folder, with a record this FLPT can read. */
function dirOf(c, dir) {
  if (!c.flow || typeof c.flow.inProjects !== 'function' || !c.flow.inProjects(dir)) throw new Error('That isn\'t an FLPT episode folder.');
  const d = path.resolve(dir);
  const why = episode.tooNew(episode.readRaw(d));
  if (why) throw new Error(why);
  return d;
}

/** A shot of an episode's plan that can carry a style: its view entry, the style it's drawn in, whether it chose it. */
function shotOf(d, shotId) {
  if (!SHOT.test(String(shotId))) throw new Error('That isn\'t a shot.');
  const board = storyboard.read(d);
  const v = board ? storyboard.view(d, { board }) : null;
  if (!v) throw new Error('This episode has no storyboard.');
  const s = v.shots.find((x) => x.id === shotId);
  if (!s) throw new Error('That shot is gone.');
  if (!s.live) throw new Error(`${s.name || 'That shot'} has no style of its own.`);
  const own = board.shots.find((x) => x.id === shotId);
  const style = planview.stylesOf(board).shots[shotId] || null;
  return { s, style, own: Boolean(own && own.style), board };
}

/** "04 · The flywheel cracks · Shadow 4" (the shot's number or tile, its title, the episode's title). */
function labelOf(d, s) {
  let title = '';
  try { title = clean((episode.read(d) || {}).title, 60); } catch { title = ''; }
  return [s.n ? pad2(s.n) : clean(s.tile, 20), clean(s.title, 60), title || clean(path.basename(d), 60)].filter(Boolean).join(' · ');
}

/** The record of a style id ("riso", "riso-mine", "dusk@1.2.0") as the flow would resolve it, or null. */
function recOf(repo, id) {
  if (!id) return null;
  try { const r = repo.get(id); return r && r.ok ? r : null; } catch { return null; }
}

/** May this episode's plan take an edit now (the Storyboard's own rule)? */
function editableNow(d) {
  try { plan.editable(episode, d, 'style'); return true; } catch { return false; }
}
/** Is this episode's plan approved? (An edit there re-opens it for review and marks the deck onwards stale.) */
function approvedPlan(d) {
  try {
    const st = episode.read(d);
    const s = st && st.stages && st.stages.storyboard;
    return Boolean(s && s.status === 'approved');
  } catch { return false; }
}

/** The style value the Storyboard keeps for a record: the id, or id@version for a Shared one. */
const valueOf = (rec) => (rec.scope === 'shared' ? `${rec.id}@${rec.version}` : rec.id);

function stateOf(c) {
  const host = c.galleryHost || null;
  const pick = host && typeof host.pick === 'function' ? host.pick() : null;
  const cat = stylesApi.catalogOf(c);
  let latest = null; // the catalog's own words ("2.0.3 is out"), shown as they come
  try { latest = cat && typeof cat.latestLine === 'function' ? clean(cat.latestLine(), 32) || null : null; } catch { latest = null; }
  return { pick: pick ? { ...pick } : null, catalog: Boolean(cat && typeof cat.check === 'function'), latest };
}

module.exports = {
  ns: 'gallery',
  methods: {
    open: { args: ['json:1024?'], handler: (c, spec) => {
      const host = hostOf(c);
      if (isObj(spec) && spec.episode != null) {
        if (typeof spec.episode !== 'string') throw new Error('That isn\'t an FLPT episode folder.');
        const d = dirOf(c, spec.episode);
        const { s, style } = shotOf(d, spec.shot);
        const rec = recOf(stylesApi.repoFor(c), style);
        host.open({ pick: { episode: d, shot: s.id, label: labelOf(d, s), current: rec && !rec.revoked ? stylesApi.keyOf(rec) : null } });
      } else host.open({}); // brought forward as it is: a pick in progress stays
      return stateOf(c);
    } },
    state: { args: [], handler: (c) => stateOf(c) },
    forShot: { args: ['episode', 'id:16'], handler: (c, dir, shotId) => {
      const d = dirOf(c, dir);
      const { s, style, own } = shotOf(d, shotId);
      const rec = recOf(stylesApi.repoFor(c), style);
      return {
        shot: s.id, style, key: rec ? stylesApi.keyOf(rec) : null, name: rec ? clean(rec.name, 40) || rec.id : style,
        poster: rec ? stylesApi.mediaOf(c, rec).poster : null, own, editable: editableNow(d),
        flag: rec && rec.revoked ? clean(rec.revoked.line, 60) || null : null, // "Withdrawn from the catalog": time to pick another
      };
    } },
    use: { args: ['id:120', 'episode?'], handler: (c, key, dir) => {
      const rec = stylesApi.need(c, stylesApi.repoFor(c), key); // usable, here, not withdrawn by the catalog
      const value = valueOf(rec);
      const name = clean(rec.name, 40) || rec.id;
      const host = c.galleryHost || null;
      const pick = host && typeof host.pick === 'function' ? host.pick() : null;
      if (pick) {
        // the Storyboard's own edit, with its own checks (editable, the shot can carry a style); one undo step there
        storyboardApi.methods.op.handler(c, pick.episode, { op: 'style', id: pick.shot, style: value });
        host.setPick(null);
        if (c.windows && typeof c.windows.focusMain === 'function') c.windows.focusMain();
        if (typeof c.send === 'function') c.send('gallery:picked', { episode: pick.episode, shot: pick.shot, style: value, name });
        return { applied: 'shot', episode: pick.episode, shot: pick.shot, style: value, name, label: pick.label };
      }
      if (dir == null) throw new Error('Which episode?');
      const d = dirOf(c, dir);
      if (approvedPlan(d)) throw new Error('That plan is approved.');
      storyboardApi.methods.op.handler(c, d, { op: 'style', id: '', style: value });
      if (typeof c.send === 'function') c.send('gallery:picked', { episode: d, shot: null, style: value, name });
      let title = '';
      try { title = clean((episode.read(d) || {}).title, 60); } catch { title = ''; }
      return { applied: 'episode', episode: d, shot: null, style: value, name, title };
    } },
    leave: { args: [], handler: (c) => {
      const host = c.galleryHost || null;
      if (host && typeof host.setPick === 'function') host.setPick(null);
      return stateOf(c);
    } },
    episodes: { args: [], handler: (c) => {
      const items = c.flow && typeof c.flow.list === 'function' ? c.flow.list() : [];
      const out = [];
      for (const it of items) {
        if (out.length >= 12) break;
        if (!it || it.tooNew || it.delivered) continue;
        try {
          const d = dirOf(c, it.dir);
          if (storyboard.read(d) && editableNow(d) && !approvedPlan(d)) out.push({ episode: d, title: clean(it.title, 60) || path.basename(d) });
        } catch { /* not one this plan can take */ }
      }
      return out;
    } },
    yourLook: { args: ['json:256?'], handler: (c, spec) => {
      let link = null;
      if (isObj(spec) && spec.inspiration != null) {
        const l = stylesApi.repoFor(c).inspiration().links.find((x) => x.id === spec.inspiration);
        if (!l) throw new Error('That place isn\'t on the list.');
        if (!l.capture) throw new Error(`${l.name} can't be captured: use a video or pictures.`);
        link = l.url;
      }
      if (!c.windows || typeof c.windows.focusMain !== 'function' || !c.windows.focusMain()) throw new Error('The main window is closed.');
      const host = c.galleryHost || null;
      const pick = host && typeof host.pick === 'function' ? host.pick() : null;
      c.send('gallery:your-look', { link, episode: pick ? pick.episode : null, shot: pick ? pick.shot : null });
      return { routed: true };
    } },
    share: { args: ['id:120'], handler: (c, key) => {
      const repo = stylesApi.repoFor(c);
      const k = stylesApi.parseKey(key);
      if (!k || k.scope !== 'mine') throw new Error('Only your own styles are shared.');
      const rec = repo.get({ id: k.id, scope: 'mine' });
      if (!rec || !rec.ok) throw new Error('That style is gone.');
      if (!c.windows || typeof c.windows.focusMain !== 'function' || !c.windows.focusMain()) throw new Error('The main window is closed.');
      c.send('gallery:share', { id: rec.id, key: stylesApi.keyOf(rec), name: clean(rec.name, 40) || rec.id }); // the Share sheet takes the Mine id
      return { routed: true };
    } },
    check: { args: [], handler: async (c) => {
      const cat = stylesApi.catalogOf(c);
      if (!cat || typeof cat.check !== 'function') throw new Error('No catalog here yet.');
      const r = await cat.check(); // { ok, release, changed, added: [refs], revoked: [...], latest, … } or { ok: false, problem }
      if (!isObj(r) || !r.ok) throw new Error(clean(isObj(r) && r.problem, 200) || 'The catalog couldn\'t be reached.');
      // as flpt.catalog.check tells it (the main window's flags), then both windows re-read the styles
      try { if (typeof c.send === 'function') c.send('catalog:changed', { release: r.release, changed: r.changed }); } catch { /* no main window */ }
      if (c.galleryHost && typeof c.galleryHost.broadcast === 'function') c.galleryHost.broadcast('styles:changed', { catalog: true });
      const count = (x) => (Array.isArray(x) ? x.length : Number(x) || 0);
      return { added: count(r.added), revoked: count(r.revoked), latest: clean(r.latest, 32) || null };
    } },
  },
  events: ['gallery:state', 'gallery:picked', 'gallery:your-look', 'gallery:share'],
  // for the tests
  shotOf, labelOf, stateOf, approvedPlan,
};
