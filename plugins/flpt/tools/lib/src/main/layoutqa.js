'use strict';
// Deck layout QA: render each slide in headless Chrome with the same wrapper render_slides.py uses, measure it, and
// report what the series learned to check before any render (playbook Part 2, "Deck QA"):
//   overflow      an element's content is bigger than its box (more than 2 px), or text runs off the slide
//   overlap       two text boxes intersect
//   bubble-zone   text inside the presenter bubble's corner (x < 380, y > 700 on the 1920×1080 slide)
//   small-text    text under 24 px (unreadable at 720p)
//   wordy         more than 30 words on the slide (the target is about 20; the voice carries the rest)
// It runs Chrome with --dump-dom, so it needs no browser-automation library.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

// Mirrors BASE_CSS in render_slides.py so measurements match the real renders.
const BASE_CSS = `html,body{margin:0;padding:0;background:#000}
section{width:1920px;height:1080px;box-sizing:border-box;position:relative;overflow:hidden;display:flex;flex-direction:column}
h1,h2,h3,p,ul,ol,li,table{margin:0}
h1{font-size:96px;font-weight:600;line-height:1.1}
h2{font-size:64px;font-weight:600;line-height:1.15}
h3{font-size:44px;font-weight:600;line-height:1.2}
p{font-size:32px;font-weight:400;line-height:1.4}
ul,ol{padding-left:1.2em}
img{display:block}
table{border-collapse:collapse}
th,td{padding:0.35em 0.6em}
aside{display:none !important}`;

const MEASURE = `(async () => {
  try { await document.fonts.ready; } catch (e) {}
  const sec = document.querySelector('section');
  const out = [];
  if (!sec) { document.body.setAttribute('data-flpt-qa', JSON.stringify([{ kind: 'no-section' }])); return; }
  const S = sec.getBoundingClientRect();
  const visible = (e) => { const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity || '1') > 0.05; };
  const own = (e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').replace(/\\s+/g, ' ').trim();
  const texts = [...sec.querySelectorAll('*')].filter((e) => own(e) && visible(e));
  const label = (e) => own(e).slice(0, 48);
  const rel = (r) => ({ x: Math.round(r.left - S.left), y: Math.round(r.top - S.top), w: Math.round(r.width), h: Math.round(r.height) });
  for (const e of texts) {
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const cs = getComputedStyle(e);
    const fs = parseFloat(cs.fontSize);
    if (fs < 24) out.push({ kind: 'small-text', text: label(e), px: fs });
    if (r.right > S.right + 1 || r.bottom > S.bottom + 1 || r.left < S.left - 1 || r.top < S.top - 1) out.push({ kind: 'overflow', text: label(e), box: rel(r), why: 'off the slide' });
    if (cs.display !== 'inline' && (e.scrollWidth > e.clientWidth + 2 || e.scrollHeight > e.clientHeight + 2) && cs.overflow !== 'visible' ) out.push({ kind: 'overflow', text: label(e), box: rel(r), why: 'content bigger than its box' });
    const x0 = r.left - S.left, y1 = r.bottom - S.top;
    if (x0 < 380 && y1 > 700) out.push({ kind: 'bubble-zone', text: label(e), box: rel(r) });
  }
  // Boxes that clip their children (fixed size + overflow hidden) hide text silently: check those too.
  for (const e of sec.querySelectorAll('*')) {
    const cs = getComputedStyle(e);
    if (!visible(e) || cs.display === 'inline') continue;
    if ((cs.overflow === 'hidden' || cs.overflowY === 'hidden' || cs.overflowX === 'hidden') && (e.scrollHeight > e.clientHeight + 2 || e.scrollWidth > e.clientWidth + 2) && e.textContent.trim()) {
      out.push({ kind: 'overflow', text: e.textContent.trim().replace(/\\s+/g, ' ').slice(0, 48), box: rel(e.getBoundingClientRect()), why: 'text clipped by its box' });
    }
  }
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const a = texts[i], b = texts[j];
    if (a.contains(b) || b.contains(a)) continue;
    const r = a.getBoundingClientRect(), q = b.getBoundingClientRect();
    const w = Math.min(r.right, q.right) - Math.max(r.left, q.left), h = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top);
    if (w > 4 && h > 4) out.push({ kind: 'overlap', text: label(a) + ' ↔ ' + label(b), area: Math.round(w * h) });
  }
  const words = (sec.innerText || '').split(/\\s+/).filter(Boolean).length;
  if (words > 30) out.push({ kind: 'wordy', words });
  document.body.setAttribute('data-flpt-qa', JSON.stringify(out));
})();`;

function extractSection(raw) {
  const start = raw.search(/<section\b/i);
  if (start < 0) return null;
  const ends = [...raw.matchAll(/<\/section\s*>/gi)];
  return ends.length ? raw.slice(start, ends[ends.length - 1].index + ends[ends.length - 1][0].length) : raw.slice(start) + '</section>';
}

function runChrome(chrome, file) {
  // Some Chrome builds print the DOM and then never exit (render_slides.py notes the same for screenshots), so watch
  // stdout and stop Chrome as soon as the dump is complete.
  return new Promise((resolve) => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'flpt-qa-chrome-'));
    const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
      '--disable-extensions', '--mute-audio', '--allow-file-access-from-files', `--user-data-dir=${profile}`,
      '--window-size=1920,1080', '--virtual-time-budget=5000', '--run-all-compositor-stages-before-draw', '--dump-dom', `file://${file}`],
    { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    let done = false;
    const finish = (why) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { child.kill('SIGKILL'); } catch { /* gone */ }
      setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 200);
      const m = out.match(/data-flpt-qa="([^"]*)"/);
      if (!m) return resolve({ error: why || 'no measurement in the page' });
      const json = m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
      try { resolve({ issues: JSON.parse(json) }); } catch { resolve({ error: 'unreadable measurement' }); }
    };
    const timer = setTimeout(() => finish('Chrome timed out'), 45000);
    child.stdout.on('data', (b) => { out += b; if (/<\/html>\s*$/i.test(out)) finish(); });
    child.on('close', () => finish());
    child.on('error', (e) => finish(`couldn't start Chrome: ${e.message}`));
  });
}

/**
 * Pictures the user attached appear in slides as /_blob/<name>, mapped by deck/asset_map.json (as render_slides.py
 * does). Resolve them the same way, so a slide with a photo measures like the real render.
 */
function assetResolver(deckDir) {
  const presDir = path.resolve(deckDir, '..', '..');
  let map = {};
  for (const f of [path.join(deckDir, 'asset_map.json'), path.join(deckDir, '..', 'asset_map.json')]) {
    try { map = JSON.parse(fs.readFileSync(f, 'utf8')); break; } catch { /* try the next */ }
  }
  const bases = [deckDir, path.dirname(deckDir), presDir];
  return (html) => (html == null ? html : html.replace(/\/_blob\/[^"'()\s&<>]+/g, (key) => {
    const val = map[key] || map[key.slice('/_blob/'.length)];
    if (typeof val !== 'string') return key;
    const hit = bases.map((b) => path.resolve(b, val)).find((p) => fs.existsSync(p));
    return hit ? pathToFileURL(hit).href : key;
  }));
}

/** Check every slide in a deck folder (deck.json + slides/<id>.html). Returns [{ n, id, issues, error }]. */
async function checkDeck({ deckDir, chrome }) {
  const deck = JSON.parse(fs.readFileSync(path.join(deckDir, 'deck.json'), 'utf8'));
  const ids = (deck.order || []).map((x) => (typeof x === 'string' ? x : x && x.id)).filter(Boolean);
  // The deck's own fonts, loaded the way render_slides.py does, so text measures the same as in the real render.
  const faces = Array.isArray(deck.faces) ? deck.faces : (deck.faces && typeof deck.faces === 'object' ? Object.values(deck.faces) : []);
  const hrefs = faces.map((f) => (typeof f === 'string' ? f : f && (f.href || f.url))).filter((h) => typeof h === 'string' && /^https:\/\//.test(h));
  const fam = faces.map((f) => f && typeof f === 'object' && (f.family || f.name)).find(Boolean);
  const head = hrefs.map((h) => `<link rel="stylesheet" href="${h.replace(/"/g, '&quot;')}">`).join('') +
    (fam ? `<style>body{font-family:'${String(fam).replace(/'/g, '')}',system-ui,sans-serif}</style>` : '');
  const blobs = assetResolver(deckDir);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flpt-qa-'));
  const results = [];
  try {
    for (const [i, id] of ids.entries()) {
      const src = path.join(deckDir, 'slides', `${id}.html`);
      if (!fs.existsSync(src)) { results.push({ n: i + 1, id, error: 'slide file missing' }); continue; }
      const section = blobs(extractSection(fs.readFileSync(src, 'utf8')));
      if (!section) { results.push({ n: i + 1, id, error: 'no <section> in the file' }); continue; }
      const page = `<!doctype html><html><head><meta charset="utf-8">${head}<style>${BASE_CSS}</style></head><body>${section}<script>${MEASURE}</script></body></html>`;
      const file = path.join(tmp, `${String(i + 1).padStart(2, '0')}.html`);
      fs.writeFileSync(file, page);
      results.push({ n: i + 1, id, ...(await runChrome(chrome, file)) });
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return results;
}

/** One line per problem, for agents and the UI. */
function summarize(results) {
  const lines = [];
  for (const r of results) {
    if (r.error) lines.push(`slide ${r.n} (${r.id}): ${r.error}`);
    for (const i of r.issues || []) {
      const what = i.kind === 'small-text' ? `text under 24 px (${i.px}px): "${i.text}"`
        : i.kind === 'bubble-zone' ? `text in the presenter's corner (x<380, y>700): "${i.text}"`
          : i.kind === 'overlap' ? `overlapping text: ${i.text}`
            : i.kind === 'wordy' ? `${i.words} words on screen (target about 20)`
              : `${i.why || 'overflow'}: "${i.text}"`;
      lines.push(`slide ${r.n} (${r.id}): ${what}`);
    }
  }
  return lines;
}

module.exports = { assetResolver, checkDeck, summarize, extractSection, BASE_CSS };
