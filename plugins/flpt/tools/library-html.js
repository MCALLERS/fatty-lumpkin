'use strict';
// library.html: the Library as an offline, Pinterest-style wall (thumbnails in balanced columns, search, kind
// filters, and a detail panel that plays clips and opens sources). Plain HTML, CSS and JavaScript in one file, written
// into the Library folder so every thumbnail and clip loads by a relative path. Item text is shown as text, never as
// markup, and only http(s) sources become links.
const path = require('path');

const enc = (s) => String(s).split('/').map(encodeURIComponent).join('/');
const VIDEO = /\.(mp4|m4v|mov|webm)$/i;
const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp)$/i;
const AUDIO = /\.(mp3|m4a|wav|aiff?|aac|ogg|flac)$/i;

/** The page's data for one item: relative URLs, and only what the page shows. */
function card(it) {
  const rel = (f) => (f ? enc(`items/${it.id}/${f}`) : null);
  const type = !it.file ? null : VIDEO.test(it.file) ? 'video' : IMAGE.test(it.file) ? 'image' : AUDIO.test(it.file) ? 'audio' : 'file';
  return {
    id: it.id, kind: it.kind, title: it.title, notes: it.notes, tags: it.tags, addedAt: it.addedAt, addedBy: it.addedBy, usedIn: it.usedIn,
    site: it.source.site || '', author: it.source.author || '', url: /^https?:\/\//i.test(it.source.url) ? it.source.url : '',
    rights: it.source.rights || '', description: it.source.description || '',
    clip: it.clip, duration: it.duration, thumb: rel(it.thumb), w: it.thumbW, h: it.thumbH, file: rel(it.file), type, snapshot: rel(it.snapshot),
  };
}

function libraryHtml(items, { dir, at = new Date() } = {}) {
  const data = JSON.stringify({ dir, at: at.toISOString(), items: items.map(card) })
    .replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FLPT Library</title>
<style>
:root {
  --paper: #FBF7EE; --paper-2: #F3EDDF; --card: #FFFFFF; --ink: #1C1A15; --ink-2: #5A5448; --rule: #E2D9C6;
  --accent: #8E2C48; --gold: #8A5310; --focus: #22406F; --shade: rgba(28, 26, 21, .07);
  --serif: 'Iowan Old Style', 'Palatino', 'Book Antiqua', Georgia, serif;
  --sans: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --paper: #15141A; --paper-2: #1F1E25; --card: #24232B; --ink: #EEE8DA; --ink-2: #B9B2A2; --rule: #36343E;
    --accent: #E8B4C4; --gold: #D9AE5A; --focus: #8FB0E6; --shade: rgba(0, 0, 0, .3); }
}
:root[data-theme="dark"] { --paper: #15141A; --paper-2: #1F1E25; --card: #24232B; --ink: #EEE8DA; --ink-2: #B9B2A2; --rule: #36343E;
  --accent: #E8B4C4; --gold: #D9AE5A; --focus: #8FB0E6; --shade: rgba(0, 0, 0, .3); }
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--paper); color: var(--ink); font: 15px/1.45 var(--sans); }
button { font: inherit; color: inherit; }
header { position: sticky; top: 0; z-index: 5; background: var(--paper); border-bottom: 1px solid var(--rule); }
.bar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px; padding: 18px 32px 12px; }
h1 { margin: 0; font: 600 28px/1.1 var(--serif); letter-spacing: -.01em; }
.count { margin-left: 10px; font: 500 14px var(--sans); color: var(--ink-2); }
.search { flex: 0 1 320px; margin-left: auto; padding: 9px 16px; border: 1px solid var(--rule); border-radius: 999px; background: var(--card); color: var(--ink); font: 15px var(--sans); }
.search:focus-visible, .chip:focus-visible, .card:focus-visible, .close:focus-visible, .act:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 32px 14px; }
.chip { padding: 5px 12px; border: 1px solid var(--rule); border-radius: 999px; background: var(--card); color: var(--ink-2); font-size: 13.5px; cursor: pointer; }
.chip b { font-weight: 500; opacity: .7; margin-left: 4px; }
.chip[aria-pressed="true"] { background: var(--ink); border-color: var(--ink); color: var(--paper); }
main { padding: 22px 32px 90px; }
.wall { display: flex; gap: 18px; align-items: flex-start; }
.col { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 20px; }
.card { display: block; width: 100%; padding: 0; border: 0; background: none; text-align: left; cursor: pointer; border-radius: 14px; }
.thumb { position: relative; display: block; overflow: hidden; border-radius: 14px; background: var(--paper-2); box-shadow: 0 1px 3px var(--shade); }
.thumb img { display: block; width: 100%; height: auto; transition: transform .35s ease; }
.card:hover .thumb img { transform: scale(1.03); }
.len { position: absolute; right: 8px; bottom: 8px; padding: 2px 8px; border-radius: 999px; background: rgba(12, 12, 16, .74); color: #fff; font: 600 12px var(--sans); font-variant-numeric: tabular-nums; }
.play { position: absolute; left: 50%; top: 50%; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%; background: rgba(12, 12, 16, .5); box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, .85); }
.play::after { content: ''; position: absolute; left: 18px; top: 15px; border-left: 14px solid #fff; border-top: 8px solid transparent; border-bottom: 8px solid transparent; }
.plate { display: flex; flex-direction: column; gap: 8px; min-height: 120px; padding: 16px; border: 1px solid var(--rule); border-radius: 14px; background: var(--card); }
.kind { font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--gold); }
.plate .ptitle { font: 600 18px/1.3 var(--serif); }
.meta { display: block; padding: 8px 4px 0; }
.title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 14.5px; font-weight: 500; line-height: 1.35; }
.site { display: block; margin-top: 2px; font-size: 12.5px; color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.empty { padding: 90px 16px; text-align: center; font: 400 20px/1.5 var(--serif); color: var(--ink-2); }
.empty code { font: 15px ui-monospace, Menlo, monospace; color: var(--ink); }
footer { padding: 0 32px 40px; font-size: 12.5px; color: var(--ink-2); overflow-wrap: anywhere; }
dialog { width: min(1180px, 94vw); max-height: 90vh; padding: 0; border: 0; border-radius: 16px; overflow: hidden; background: var(--card); color: var(--ink); box-shadow: 0 30px 90px rgba(0, 0, 0, .4); }
dialog::backdrop { background: rgba(15, 13, 10, .62); }
dialog[open] { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(300px, 1fr); }
.media { display: flex; align-items: center; justify-content: center; min-height: 360px; max-height: 90vh; background: #0e0d12; }
.media video, .media img { display: block; max-width: 100%; max-height: 90vh; }
.media video { width: 100%; background: #000; }
.media .plate { width: 100%; min-height: 360px; border: 0; border-radius: 0; justify-content: center; align-items: center; text-align: center; background: var(--paper-2); }
.body { position: relative; display: flex; flex-direction: column; gap: 12px; max-height: 90vh; overflow: auto; padding: 30px 30px 24px; }
.body h2 { margin: 0 36px 0 0; font: 600 25px/1.2 var(--serif); }
.line { margin: 0; font-size: 14px; color: var(--ink-2); }
.moment { color: var(--ink); font-variant-numeric: tabular-nums; }
.notes { margin: 0; white-space: pre-wrap; font-size: 14.5px; line-height: 1.5; }
.rights { margin: 0; font-size: 12.5px; font-style: italic; color: var(--ink-2); }
.tags { display: flex; flex-wrap: wrap; gap: 6px; }
.tag { padding: 3px 10px; border-radius: 999px; background: var(--paper-2); font-size: 13px; }
.acts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
.act { display: inline-block; padding: 8px 16px; border: 1px solid var(--rule); border-radius: 999px; background: var(--paper); color: var(--ink); font-size: 14px; text-decoration: none; }
.act.primary { background: var(--accent); border-color: var(--accent); color: var(--card); }
.foot { margin-top: auto; padding-top: 12px; border-top: 1px solid var(--rule); font-size: 12.5px; color: var(--ink-2); overflow-wrap: anywhere; }
.close { position: absolute; top: 14px; right: 14px; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 50%; background: var(--paper-2); color: var(--ink-2); font-size: 19px; line-height: 1; cursor: pointer; }
@media (max-width: 900px) {
  dialog[open] { grid-template-columns: 1fr; overflow: auto; }
  .media, .media .plate { min-height: 240px; max-height: 52vh; }
  .media video, .media img { max-height: 52vh; }
  .body { max-height: none; overflow: visible; }
}
@media (max-width: 600px) {
  .bar { padding: 14px 16px 10px; }
  .chips { padding: 0 16px 12px; }
  main { padding: 16px 16px 60px; }
  footer { padding: 0 16px 32px; }
  .search { flex: 1 1 100%; margin-left: 0; }
  .wall { gap: 12px; } .col { gap: 14px; }
}
@media (prefers-reduced-motion: reduce) { .thumb img { transition: none; } .card:hover .thumb img { transform: none; } }
</style>
</head>
<body>
<header>
  <div class="bar"><h1>Library<span class="count" id="count"></span></h1>
    <input class="search" id="q" type="search" placeholder="Search titles, tags, notes, sources" aria-label="Search the Library" autocomplete="off"></div>
  <div class="chips" id="chips" role="group" aria-label="Show"></div>
</header>
<main id="main"><div class="wall" id="wall"></div></main>
<footer id="foot"></footer>
<dialog id="detail" aria-labelledby="d-title"></dialog>
<script id="data" type="application/json">${data}</script>
<script>
(() => {
  const DATA = JSON.parse(document.getElementById('data').textContent);
  const LABEL = { clip: 'Clips', image: 'Pictures', article: 'Articles', website: 'Websites', wiki: 'Wiki', 'video-link': 'Video links',
    audio: 'Sound', document: 'Documents', note: 'Notes', flpt: 'Made by FLPT' };
  const ONE = { clip: 'Clip', image: 'Picture', article: 'Article', website: 'Website', wiki: 'Wiki page', 'video-link': 'Video link',
    audio: 'Sound', document: 'Document', note: 'Note', flpt: 'Made by FLPT' };
  const BY = { you: 'you', clippy: 'Clippy', crew: 'the crew', import: 'an import', episode: 'an episode' };
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const fold = (s) => String(s || '').normalize('NFKD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
  const secs = (t) => { const m = /^(?:(\\d+):)?(\\d+):(\\d+(?:\\.\\d+)?)$/.exec(String(t || '')); return m ? (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) : null; };
  const short = (s) => { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = String(s % 60).padStart(2, '0'); return h ? h + ':' + String(m).padStart(2, '0') + ':' + x : m + ':' + x; };
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\\./, ''); } catch (e) { return ''; } };
  const state = { q: '', kind: null };
  for (const it of DATA.items) it.hay = fold([it.title, it.notes, it.kind, it.site, it.author, it.url, it.description, (it.tags || []).join(' '), (it.usedIn || []).join(' ')].join(' \\n '));

  function shown() {
    const words = fold(state.q).split(/\\s+/).filter(Boolean);
    return DATA.items.filter((it) => (!state.kind || it.kind === state.kind) && words.every((w) => it.hay.includes(w)));
  }

  function chips() {
    const counts = {};
    for (const it of DATA.items) counts[it.kind] = (counts[it.kind] || 0) + 1;
    const box = $('chips');
    box.textContent = '';
    const chip = (kind, text, n) => {
      const b = el('button', 'chip', text);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(state.kind === kind));
      b.appendChild(el('b', null, String(n)));
      b.onclick = () => { state.kind = kind; render(); };
      box.appendChild(b);
    };
    chip(null, 'All', DATA.items.length);
    for (const k of Object.keys(LABEL)) if (counts[k]) chip(k, LABEL[k], counts[k]);
  }

  function tile(it) {
    const b = el('button', 'card');
    b.type = 'button';
    b.setAttribute('aria-label', (ONE[it.kind] || it.kind) + ': ' + it.title);
    if (it.thumb) {
      const t = el('span', 'thumb');
      const img = el('img');
      img.src = it.thumb; img.alt = ''; img.loading = 'lazy';
      if (it.w && it.h) { img.width = it.w; img.height = it.h; }
      img.onerror = () => { t.replaceWith(plate(it)); };
      t.appendChild(img);
      if (it.type === 'video') t.appendChild(el('span', 'play'));
      const len = it.duration || (it.clip ? (secs(it.clip.end) || 0) - (secs(it.clip.start) || 0) : 0);
      if (len > 0) t.appendChild(el('span', 'len', short(len)));
      b.appendChild(t);
      const meta = el('span', 'meta');
      meta.appendChild(el('span', 'title', it.title));
      const where = it.site || host(it.url) || ONE[it.kind];
      if (where) meta.appendChild(el('span', 'site', where));
      b.appendChild(meta);
    } else {
      b.appendChild(plate(it));
    }
    b.onclick = () => open(it);
    return b;
  }

  function plate(it) {
    const p = el('span', 'plate');
    p.appendChild(el('span', 'kind', ONE[it.kind] || it.kind));
    p.appendChild(el('span', 'ptitle', it.title));
    const where = it.site || host(it.url);
    if (where) p.appendChild(el('span', 'site', where));
    return p;
  }

  // Pinterest-style columns: each card goes to the shortest column, so the wall stays level and reads left to right.
  function layout(list) {
    const wall = $('wall');
    wall.textContent = '';
    const width = $('main').clientWidth - parseFloat(getComputedStyle($('main')).paddingLeft) * 2;
    const gap = width < 560 ? 12 : 18;
    const n = Math.max(width < 560 ? 2 : 1, Math.min(7, Math.floor((width + gap) / (236 + gap))));
    const colW = (width - gap * (n - 1)) / n;
    const cols = Array.from({ length: n }, () => { const c = el('div', 'col'); wall.appendChild(c); return { c, h: 0 }; });
    for (const it of list) {
      const col = cols.reduce((a, b) => (b.h < a.h ? b : a));
      col.c.appendChild(tile(it));
      col.h += (it.thumb ? colW * ((it.h && it.w) ? it.h / it.w : 0.75) + 52 : 130) + 20;
    }
  }

  function render() {
    chips();
    const list = shown();
    $('count').textContent = list.length === DATA.items.length ? DATA.items.length + (DATA.items.length === 1 ? ' item' : ' items') : list.length + ' of ' + DATA.items.length;
    if (!DATA.items.length || !list.length) {
      $('wall').textContent = '';
      const e = el('div', 'empty');
      if (!DATA.items.length) {
        e.append('Nothing here yet. Add a file or a link with ', el('code', null, '/flpt:library add'), ', or clip a moment with ', el('code', null, '/flpt:clip'), '.');
      } else e.textContent = 'Nothing matches.';
      $('wall').appendChild(e);
      return;
    }
    layout(list);
  }

  function open(it) {
    const d = $('detail');
    d.textContent = '';
    const media = el('div', 'media');
    if (it.type === 'video' && it.file) {
      const v = el('video');
      v.controls = true; v.preload = 'metadata'; v.src = it.file;
      if (it.thumb) v.poster = it.thumb;
      media.appendChild(v);
    } else if (it.type === 'image' && it.file) {
      const i = el('img'); i.src = it.file; i.alt = it.title; media.appendChild(i);
    } else if (it.thumb || it.snapshot) {
      const i = el('img'); i.src = it.snapshot || it.thumb; i.alt = it.title; media.appendChild(i);
    } else media.appendChild(plate(it));
    if (it.type === 'audio' && it.file) { const a = el('audio'); a.controls = true; a.src = it.file; media.appendChild(a); }
    d.appendChild(media);

    const body = el('div', 'body');
    const close = el('button', 'close', '×');
    close.type = 'button'; close.setAttribute('aria-label', 'Close'); close.onclick = () => d.close();
    body.appendChild(close);
    const h = el('h2', null, it.title); h.id = 'd-title'; body.appendChild(h);
    body.appendChild(el('p', 'line', [ONE[it.kind] || it.kind, it.site || host(it.url), it.author].filter(Boolean).join(' · ')));
    if (it.clip && (it.clip.start || it.clip.end)) {
      const s = secs(it.clip.start), e = secs(it.clip.end);
      body.appendChild(el('p', 'line moment', 'The moment: ' + short(s) + ' to ' + short(e) + (s != null && e != null ? ' (' + short(e - s) + ')' : '')));
    }
    if (it.notes) body.appendChild(el('p', 'notes', it.notes));
    else if (it.description) body.appendChild(el('p', 'notes', it.description));
    if (it.tags && it.tags.length) { const t = el('div', 'tags'); for (const x of it.tags) t.appendChild(el('span', 'tag', x)); body.appendChild(t); }
    if (it.rights) body.appendChild(el('p', 'rights', it.rights));
    const acts = el('div', 'acts');
    const link = (href, text, primary) => { const a = el('a', 'act' + (primary ? ' primary' : ''), text); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; acts.appendChild(a); };
    const src = it.url || (it.clip && /^https?:/i.test(it.clip.url || '') ? it.clip.url : '');
    if (src) {
      let href = src;
      const s = it.clip && secs(it.clip.start);
      if (s && /youtube\\.com\\/watch|youtu\\.be\\//.test(src)) { try { const u = new URL(src); u.searchParams.set('t', Math.floor(s) + 's'); href = u.href; } catch (e) { /* as it is */ } }
      link(href, it.clip ? 'Watch the source' : 'Open the link', !it.file);
    }
    if (it.file) link(it.file, 'Open the file', true);
    if (acts.childNodes.length) body.appendChild(acts);
    const foot = el('div', 'foot');
    const when = it.addedAt ? new Date(it.addedAt) : null;
    foot.appendChild(el('div', null, 'Added by ' + (BY[it.addedBy] || it.addedBy) + (when && when.getFullYear() > 1970 ? ' on ' + when.toLocaleDateString() : '') + '.'));
    if (it.usedIn && it.usedIn.length) foot.appendChild(el('div', null, 'Used in ' + it.usedIn.join(', ') + '.'));
    foot.appendChild(el('div', null, 'Folder: ' + DATA.dir + '/items/' + it.id));
    body.appendChild(foot);
    d.appendChild(body);
    if (!d.open) d.showModal();
    history.replaceState(null, '', '#' + it.id); // a link to this item
  }
  $('detail').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  $('detail').addEventListener('close', () => {
    const v = $('detail').querySelector('video'); if (v) v.pause();
    history.replaceState(null, '', location.pathname + location.search);
  });

  let timer = null;
  $('q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { state.q = $('q').value; render(); }, 80); });
  let lastW = 0;
  addEventListener('resize', () => { if (Math.abs(innerWidth - lastW) > 40) { lastW = innerWidth; render(); } });
  $('foot').textContent = 'As of ' + new Date(DATA.at).toLocaleString() + '. /flpt:library open refreshes it.';
  lastW = innerWidth;
  render();
  const linked = DATA.items.find((x) => x.id === decodeURIComponent(location.hash.slice(1)));
  if (linked) open(linked);
})();
</script>
</body>
</html>
`;
}

/** Write <Library>/library.html. Returns its path. */
function writeLibraryHtml(lib, fs = require('fs')) {
  const file = path.join(lib.dir, 'library.html');
  fs.mkdirSync(lib.dir, { recursive: true });
  fs.writeFileSync(`${file}.tmp`, libraryHtml(lib.list(), { dir: lib.dir }));
  fs.renameSync(`${file}.tmp`, file);
  return file;
}

module.exports = { libraryHtml, writeLibraryHtml, card };
