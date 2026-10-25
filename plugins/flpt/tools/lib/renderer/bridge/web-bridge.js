'use strict';
// bridge/web-bridge.js · window.flpt in a browser (PLAN §2.2; W4-01): what preload.js is to the Mac app, for the web
// app and the plugin's Desk. flpt-server (engine/tools/server) adds this script, and the contract in front of it
// (window.FLPT_CONTRACT, from /bridge/contract.js), to every page it serves; on the Mac neither exists and this does
// nothing. It builds the same window.flpt from the same contract:
//   - every method at its place, as one POST /api/rpc/<ns>.<name> with the arguments as JSON; 0.7.1's raw methods
//     unwrapped as the preload does
//   - every event as on…(handler) → unsubscribe, read from one event stream (fetch, so the session header rides along)
//   - dropped files are sent to the server first (POST /api/upload), and their upload tokens go where the Mac sends
//     paths; page code never handles a path (pathForFile is '' here)
//   - fileUrl(p, v) → /files/<media token>?p=…&v=…, which the server checks against the user's folders
// No cookies: the session comes from the launch token in the address's fragment (#k=…, removed at once) and is kept
// in this tab's sessionStorage, sent as X-FLPT-Session on every call, upload, answer and on the stream.
// The approvals and dialogs the server asks (approval:request, dialog:ask, dialog:open) go to window.flptWeb, where
// ui-approval.js shows them; a file to open or download (file:open) opens here.
(() => {
  const C = window.FLPT_CONTRACT;
  if (!C || !Array.isArray(C.methods) || !Array.isArray(C.events) || window.flpt) return;
  const STORE = 'flpt.web.session';
  const PLACE = /^[A-Za-z_$][\w$]*$/;
  const BANNED = ['__proto__', 'prototype', 'constructor'];
  const INTERNAL = ['approval:request', 'approval:done', 'dialog:ask', 'dialog:open', 'dialog:done', 'bridge:reset'];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // ── the session ──
  let session = null;
  let media = null;
  let mode = null;
  try { const s = JSON.parse(sessionStorage.getItem(STORE) || 'null'); if (s && typeof s.session === 'string') ({ session, media, mode } = s); } catch { /* none kept */ }
  const fromHash = /(?:^#|&)k=([A-Za-z0-9_-]{20,128})/.exec(location.hash);
  const launch = fromHash ? fromHash[1] : null;
  if (launch) history.replaceState(null, '', location.pathname + location.search); // out of the address bar and the history
  const keep = () => { try { sessionStorage.setItem(STORE, JSON.stringify({ session, media, mode })); } catch { /* private window */ } };
  const ready = (async () => {
    if (session) {
      const r = await fetch('/api/session', { headers: { 'X-FLPT-Session': session }, cache: 'no-store' }).catch(() => null);
      if (r && r.ok) { const j = await r.json(); media = j.media; mode = j.mode; return; }
      session = null;
    }
    const r = await fetch('/api/session', { method: 'POST', headers: launch ? { 'X-FLPT-Launch': launch } : {}, cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.session) throw new Error('No session.');
    ({ session, media, mode } = j);
    keep();
  })();
  ready.catch(() => {});

  const headers = (extra = {}) => ({ 'X-FLPT-Session': session || '', ...extra });
  async function post(url, body, type = 'application/json') {
    await ready;
    const r = await fetch(url, { method: 'POST', headers: headers({ 'Content-Type': type }), body: type === 'application/json' ? JSON.stringify(body) : body, cache: 'no-store' });
    const j = await r.json().catch(() => null);
    if (j && typeof j === 'object') return j;
    return { ok: false, error: r.ok ? 'That didn\'t work.' : `The server said ${r.status}.` };
  }

  /** A file the page holds, sent to the server: its upload token (null when it isn't a file). */
  async function upload(file) {
    if (!(file instanceof Blob)) return null;
    const name = typeof file.name === 'string' && file.name ? file.name : 'file';
    const j = await post(`/api/upload?name=${encodeURIComponent(name.slice(0, 200))}`, file, 'application/octet-stream');
    if (!j.ok || !j.token) throw new Error(j.error || 'That file didn\'t upload.');
    return j.token;
  }
  async function uploadAll(files) {
    const list = Array.from(files && typeof files === 'object' && typeof files.length === 'number' ? files : []);
    const out = [];
    for (const f of list) { const t = await upload(f); if (t) out.push(t); }
    return out;
  }

  // ── methods ──
  function method(m) {
    const drops = new Map((m.dropped || []).map(([i, how]) => [i, how]));
    return async (...given) => {
      const args = given.slice(0, m.arity);
      for (const [i, how] of drops) {
        if (i >= args.length) continue;
        const tokens = await uploadAll(args[i]);
        args[i] = how === 'first' ? (tokens[0] || '') : tokens;
      }
      while (args.length && args[args.length - 1] === undefined) args.pop();
      const r = await post(`/api/rpc/${encodeURIComponent(m.key)}`, args.map((a) => (a === undefined ? null : a)));
      if (!m.raw) return r;
      if (r && r.ok) return r.value;
      throw new Error((r && r.error) || 'That didn\'t work.');
    };
  }

  /** Puts fn at a dotted place on api ('library.list'), refusing anything that isn't a plain name or is taken. */
  function place(api, dotted, fn) {
    const parts = String(dotted).split('.');
    if (!parts.every((p) => PLACE.test(p) && !BANNED.includes(p))) return;
    let o = api;
    for (const p of parts.slice(0, -1)) {
      if (!Object.prototype.hasOwnProperty.call(o, p)) o[p] = {};
      o = o[p];
      if (typeof o !== 'object') return;
    }
    const last = parts.at(-1);
    if (!Object.prototype.hasOwnProperty.call(o, last)) o[last] = fn;
  }

  // ── events ──
  const subs = new Map(); // channel → Set<handler>
  const on = (channel) => (handler) => {
    if (typeof handler !== 'function') return () => {};
    if (!subs.has(channel)) subs.set(channel, new Set());
    subs.get(channel).add(handler);
    return () => { const s = subs.get(channel); if (s) s.delete(handler); };
  };
  const deliver = (channel, data) => { for (const fn of [...(subs.get(channel) || [])]) { try { fn(data); } catch (e) { console.error(e); } } };

  // what ui-approval.js shows: requests still open are kept, so a modal that loads later still sees them
  const webSubs = new Set();
  const open = new Map(); // id → [kind, payload]
  function internal(kind, x) {
    if (!x || typeof x !== 'object') return;
    if (kind === 'approval:request' || kind === 'dialog:ask' || kind === 'dialog:open') open.set(x.id, [kind, x]);
    if (kind === 'approval:done' || kind === 'dialog:done') open.delete(x.id);
    for (const fn of [...webSubs]) { try { fn(kind, x); } catch (e) { console.error(e); } }
  }
  function opened(x) {
    if (!x || typeof x.url !== 'string' || !/^\/files\/|^https?:\/\//.test(x.url)) return;
    if (x.download) { const a = document.createElement('a'); a.href = x.url; a.download = ''; a.rel = 'noopener'; document.body.append(a); a.click(); a.remove(); return; }
    window.open(x.url, '_blank', 'noopener,noreferrer');
  }

  function dispatch(ev) {
    if (INTERNAL.includes(ev.event)) return internal(ev.event, ev.data);
    if (ev.event === 'file:open' || ev.event === 'file:external') return opened(ev.data);
    return deliver(ev.event, ev.data);
  }

  /** The event stream, read for as long as the page lives: reconnects with Last-Event-ID, so nothing is missed. */
  async function stream() {
    let last = null;
    let delay = 500;
    try { await ready; } catch { return; }
    for (;;) {
      try {
        const r = await fetch('/api/events', { headers: headers(last != null ? { 'Last-Event-ID': String(last) } : {}), cache: 'no-store' });
        if (r.status === 401) return;
        if (!r.ok || !r.body) throw new Error('stream');
        delay = 500;
        const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let at;
          while ((at = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, at);
            buf = buf.slice(at + 2);
            const ev = { id: null, event: '', data: '' };
            for (const line of block.split('\n')) {
              if (!line || line[0] === ':') continue;
              const i = line.indexOf(':');
              const k = i < 0 ? line : line.slice(0, i);
              const v = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
              if (k === 'id') ev.id = Number(v);
              else if (k === 'event') ev.event = v;
              else if (k === 'data') ev.data += v;
            }
            if (!ev.event) continue;
            if (Number.isFinite(ev.id) && ev.id > 0) last = ev.id;
            try { ev.data = JSON.parse(ev.data); } catch { /* left as text */ }
            dispatch(ev);
          }
        }
      } catch { /* dropped: try again */ }
      await wait(delay);
      delay = Math.min(delay * 2, 10000);
    }
  }

  // ── window.flpt ──
  const api = {
    fileUrl: (p, v) => `/files/${media || '-'}?p=${encodeURIComponent(String(p))}${v ? `&v=${encodeURIComponent(String(v))}` : ''}`,
    pathForFile: () => '', // no paths on the web
  };
  for (const m of C.methods) if (m && typeof m.key === 'string' && Number.isInteger(m.arity)) place(api, m.expose, method(m));
  for (const ev of C.events) for (const p of (ev && Array.isArray(ev.expose) ? ev.expose : [])) place(api, p, on(ev.name));
  window.flpt = api;

  window.flptWeb = Object.freeze({
    ready: () => ready.then(() => mode),
    /** (kind, payload) for approval:request, approval:done, dialog:ask, dialog:open, dialog:done; open ones replayed */
    on(fn) {
      if (typeof fn !== 'function') return () => {};
      webSubs.add(fn);
      for (const [kind, x] of open.values()) { try { fn(kind, x); } catch (e) { console.error(e); } }
      return () => webSubs.delete(fn);
    },
    approve: (id, hash, yes) => post('/api/approve', { id, hash, yes: yes === true }),
    answer: (id, hash, response) => post('/api/dialog', { id, hash, response }),
    pick: async (id, hash, files) => {
      if (!files || !files.length) return post('/api/dialog', { id, hash, canceled: true });
      return post('/api/dialog', { id, hash, uploads: await uploadAll(files) });
    },
  });

  stream();
})();
