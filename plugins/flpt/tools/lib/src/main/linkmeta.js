'use strict';
// Links for the Library: what a URL is (an image, a YouTube video, a Wikipedia page, an article or a website), its
// title, description and preview image. Pure helpers, plus a fetcher with a timeout and a size cap that takes its
// fetch as an argument (Electron's net.fetch in the app, a fake in tests). Nothing here downloads video.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0 Safari/537.36 FLPT-Library/1.0';
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|heic|tiff?|bmp)$/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi)$/i;

/** A URL object for an http(s) link, or null. */
function parseHttpUrl(s) {
  try {
    const u = new URL(String(s || '').trim());
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname ? u : null;
  } catch { return null; }
}

/** The 11-character video id of a YouTube link (watch, youtu.be, shorts, embed, live), or null. */
function youtubeId(input) {
  const u = parseHttpUrl(input);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  let id = null;
  if (host === 'youtu.be' || host === 'www.youtu.be') id = u.pathname.split('/')[1];
  else if (YT_HOSTS.has(host)) {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else {
      const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/);
      if (m) id = m[1];
    }
  }
  return id && YT_ID.test(id) ? id : null;
}

/** A YouTube link reduced to its video: https://www.youtube.com/watch?v=<id> (no list=, index= or t=), or null. */
function cleanYouTubeUrl(input) {
  const id = youtubeId(input);
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}

/** Loopback, private and link-local hosts: the crew may not make the app fetch these. */
function isPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h === '0.0.0.0' || h === '::' || h === '::1') return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  return /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h);
}

/** A link's site name, as people say it. */
function siteName(u) {
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (youtubeId(u.href) || host === 'youtube.com') return 'YouTube';
  if (/(^|\.)wikipedia\.org$/.test(host)) return 'Wikipedia';
  if (host === 'vimeo.com') return 'Vimeo';
  return host;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
function decodeEntities(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, e.toLowerCase()) ? ENTITIES[e.toLowerCase()] : all;
  });
}

const tidy = (s, max = 400) => decodeEntities(s).replace(/\s+/g, ' ').trim().slice(0, max);

/** Title, description, preview image, site, author and type from a page's <head> (Open Graph, Twitter, plain). */
function parseMeta(html, baseUrl) {
  const head = String(html || '').slice(0, 800000);
  const meta = {};
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const attr = (n) => {
      const r = new RegExp(`\\s${n}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(tag);
      return r ? (r[2] != null ? r[2] : r[3] != null ? r[3] : r[4]) : null;
    };
    const key = String(attr('property') || attr('name') || attr('itemprop') || '').toLowerCase().trim();
    const content = attr('content');
    if (key && content != null && content.trim() && !(key in meta)) meta[key] = content;
  }
  const titleTag = (head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  const abs = (u) => {
    if (!u) return null;
    try {
      const x = new URL(decodeEntities(u).trim(), baseUrl);
      return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null;
    } catch { return null; }
  };
  const author = tidy(meta.author || meta['article:author'] || meta['twitter:creator'] || '', 120);
  return {
    title: tidy(meta['og:title'] || meta['twitter:title'] || titleTag || '', 300),
    description: tidy(meta['og:description'] || meta['twitter:description'] || meta.description || '', 600),
    image: abs(meta['og:image:secure_url'] || meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] || meta['twitter:image:src'] || meta.image),
    site: tidy(meta['og:site_name'] || meta['application-name'] || '', 120),
    author: /^https?:/i.test(author) ? '' : author,
    type: String(meta['og:type'] || '').toLowerCase().trim(),
    published: tidy(meta['article:published_time'] || meta['date'] || '', 40),
  };
}

/** The Library kind for a fetched page. */
function pageKind(u, meta = {}) {
  if (/(^|\.)wikipedia\.org$/i.test(u.hostname)) return 'wiki';
  if (/^video/.test(meta.type || '')) return 'video-link';
  if (meta.type === 'article' || meta.published) return 'article';
  const p = u.pathname.replace(/\/+$/, '');
  if (!p) return 'website';
  const last = p.split('/').pop();
  if (/\/(19|20)\d\d\/\d{1,2}(\/|$)/.test(p) || /[a-z0-9]+(?:-[a-z0-9]+){3,}/i.test(last)) return 'article';
  return 'website';
}

/** What a URL looks like before fetching it: 'youtube' | 'image' | 'video' | 'page'. */
function guessFromUrl(u) {
  if (youtubeId(u.href)) return 'youtube';
  if (IMAGE_EXT.test(u.pathname)) return 'image';
  if (VIDEO_EXT.test(u.pathname)) return 'video';
  return 'page';
}

/**
 * Fetch a URL with a timeout and a size cap. Over the cap: an error, or (truncate) the first maxBytes, which is
 * all a page's <head> needs. limitFor(contentType) can set { maxBytes, truncate } once the type is known (0 bytes:
 * don't read the body at all). Returns { url (after redirects), status, type, body: Buffer }.
 */
async function fetchLimited(fetchImpl, url, { timeoutMs = 15000, maxBytes: cap = 2 << 20, truncate: trunc = false, accept = '*/*', limitFor = null } = {}) {
  let maxBytes = cap;
  let truncate = trunc;
  const u = parseHttpUrl(url);
  if (!u) throw new Error('Only http and https links can be saved.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let res;
    try {
      res = await fetchImpl(u.href, { redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': UA, accept, 'accept-language': 'en-US,en;q=0.8' } });
    } catch (e) {
      throw new Error(ctrl.signal.aborted ? 'The link took too long to answer.' : `Couldn't reach ${u.hostname}.`);
    }
    const finalUrl = res.url || u.href;
    if (!parseHttpUrl(finalUrl)) throw new Error('The link redirected somewhere that isn\'t a web page.');
    if (!res.ok) throw new Error(`${u.hostname} answered ${res.status}.`);
    const type = String(res.headers.get('content-type') || '').toLowerCase();
    if (limitFor) ({ maxBytes, truncate } = limitFor(type));
    if (maxBytes <= 0) {
      try { if (res.body && res.body.cancel) await res.body.cancel(); } catch { /* already closed */ }
      return { url: finalUrl, status: res.status, type, body: Buffer.alloc(0) };
    }
    const declared = Number(res.headers.get('content-length')) || 0;
    if (declared > maxBytes && !truncate) throw new Error('That file is too big to save from a link.');
    const chunks = [];
    let n = 0;
    if (res.body) {
      try {
        for await (const c of res.body) {
          const b = Buffer.from(c);
          if (n + b.length > maxBytes) {
            if (!truncate) throw Object.assign(new Error('That file is too big to save from a link.'), { tooBig: true });
            chunks.push(b.subarray(0, maxBytes - n));
            n = maxBytes;
            break;
          }
          chunks.push(b);
          n += b.length;
        }
      } catch (e) {
        if (e.tooBig) throw e;
        if (!chunks.length || !truncate) throw new Error(ctrl.signal.aborted ? 'The link took too long to answer.' : 'The download was cut off.');
      }
    }
    if (n >= maxBytes) ctrl.abort(); // stop the rest of a truncated page
    return { url: finalUrl, status: res.status, type, body: Buffer.concat(chunks) };
  } finally {
    clearTimeout(timer);
  }
}

/** YouTube's oEmbed answer for a video: { title, author, authorUrl, thumbnail }, or null. */
async function youtubeOembed(fetchImpl, cleanUrl) {
  try {
    const r = await fetchLimited(fetchImpl, `https://www.youtube.com/oembed?url=${encodeURIComponent(cleanUrl)}&format=json`, { maxBytes: 256 << 10, accept: 'application/json' });
    const j = JSON.parse(r.body.toString('utf8'));
    return { title: tidy(j.title, 300), author: tidy(j.author_name, 120), authorUrl: parseHttpUrl(j.author_url) ? j.author_url : '', thumbnail: parseHttpUrl(j.thumbnail_url) ? j.thumbnail_url : null };
  } catch { return null; }
}

/** Wikipedia's page summary (a clean extract and the lead image), or null. */
async function wikipediaSummary(fetchImpl, u) {
  const m = u.pathname.match(/^\/wiki\/(.+)$/);
  if (!m) return null;
  try {
    const r = await fetchLimited(fetchImpl, `${u.protocol}//${u.host}/api/rest_v1/page/summary/${m[1]}`, { maxBytes: 512 << 10, accept: 'application/json' });
    const j = JSON.parse(r.body.toString('utf8'));
    const img = (j.originalimage && j.originalimage.source) || (j.thumbnail && j.thumbnail.source) || null;
    return { title: tidy(j.title, 300), description: tidy(j.extract, 600), image: parseHttpUrl(img) ? img : null };
  } catch { return null; }
}

module.exports = {
  UA, parseHttpUrl, youtubeId, cleanYouTubeUrl, isPrivateHost, siteName, decodeEntities, parseMeta, pageKind, guessFromUrl,
  fetchLimited, youtubeOembed, wikipediaSummary, IMAGE_EXT, VIDEO_EXT,
};
