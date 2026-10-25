'use strict';
// sse.js · flpt-server's event channel (PLAN §2.2; W4-01). What the Mac sends a window over IPC (job lines, crew
// events, changes) goes to each session's stream instead, in order: every event gets the session's next id, waits in a
// short ring while no stream is open, and a stream that reconnects with Last-Event-ID gets what it missed. The page
// reads the stream with fetch (its session token in a header: no cookie, so no EventSource); the format is plain
// text/event-stream, one `id`, `event` and `data` per event, and a comment line every 15 s keeps proxies from closing it.
//   createBus({ ring, heartbeatMs })
//     open(sessionId)                 a session's queue (made once; ended by close)
//     send(sessionId, channel, data)  to one session (the caller's own progress)
//     broadcast(channel, data)        to every session (what the Mac sends the main window)
//     attach(sessionId, req, res)     serve one stream on an HTTP response (Last-Event-ID honoured)
//     close(sessionId) · closeAll() · stats()
// Data is sent as JSON; whatever can't be serialized is dropped with its event (counted in stats().dropped).

const RING = 1000;
const HEARTBEAT_MS = 15000;

function createBus({ ring = RING, heartbeatMs = HEARTBEAT_MS } = {}) {
  const sessions = new Map(); // id → { seq, ring: [{ id, text }], streams: Set<res> }
  let dropped = 0;

  function open(sid) {
    if (!sessions.has(sid)) sessions.set(sid, { seq: 0, ring: [], streams: new Set() });
    return sessions.get(sid);
  }

  /** One event's wire text: its id, its channel and its data on one line (JSON never holds a raw newline). */
  function frame(id, channel, data) {
    return `id: ${id}\nevent: ${channel}\ndata: ${JSON.stringify(data === undefined ? null : data)}\n\n`;
  }

  function send(sid, channel, data) {
    const s = sessions.get(sid);
    if (!s || typeof channel !== 'string' || !/^[\w-]+:[\w-]+$/.test(channel)) return false;
    let text;
    try { text = frame(s.seq + 1, channel, data); } catch { dropped += 1; return false; }
    s.seq += 1;
    s.ring.push({ id: s.seq, text });
    if (s.ring.length > ring) s.ring.splice(0, s.ring.length - ring);
    for (const res of s.streams) { try { res.write(text); } catch { /* the stream ended; its close handler removes it */ } }
    return true;
  }

  function broadcast(channel, data) {
    let n = 0;
    for (const sid of sessions.keys()) if (send(sid, channel, data)) n += 1;
    return n;
  }

  /**
   * Serve the session's stream on `res`: the events after Last-Event-ID first (or, with none, nothing old: a fresh
   * page asks for state itself), then each new one as it comes. A gap the ring no longer covers is said with a
   * `bridge:reset` event, so the page knows to read its state again.
   */
  function attach(sid, req, res) {
    const s = open(sid);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive',
    });
    res.write(': flpt\n\n');
    const last = Number(req.headers['last-event-id']);
    if (Number.isInteger(last) && last >= 0 && last < s.seq) {
      const oldest = s.ring.length ? s.ring[0].id : s.seq + 1;
      if (last + 1 < oldest) res.write(frame(0, 'bridge:reset', { from: last, oldest }));
      for (const e of s.ring) if (e.id > last) res.write(e.text);
    }
    s.streams.add(res);
    const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, heartbeatMs);
    beat.unref();
    const done = () => { clearInterval(beat); s.streams.delete(res); };
    req.on('close', done);
    res.on('close', done);
  }

  function close(sid) {
    const s = sessions.get(sid);
    if (!s) return;
    for (const res of s.streams) { try { res.end(); } catch { /* gone */ } }
    sessions.delete(sid);
  }

  function closeAll() { for (const sid of [...sessions.keys()]) close(sid); }

  const stats = () => ({ sessions: sessions.size, streams: [...sessions.values()].reduce((a, s) => a + s.streams.size, 0), dropped });

  return { open, send, broadcast, attach, close, closeAll, stats, has: (sid) => sessions.has(sid) };
}

/** A text/event-stream parser for the tests and the QA (the page has its own in web-bridge.js): feed chunks, get events. */
function createParser(onEvent) {
  let buf = '';
  return (chunk) => {
    buf += chunk;
    let at;
    while ((at = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, at);
      buf = buf.slice(at + 2);
      const ev = { id: null, event: 'message', data: '' };
      let any = false;
      for (const line of block.split('\n')) {
        if (!line || line.startsWith(':')) continue;
        const i = line.indexOf(':');
        const k = i < 0 ? line : line.slice(0, i);
        const v = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
        if (k === 'id') ev.id = Number(v);
        else if (k === 'event') ev.event = v;
        else if (k === 'data') ev.data += (ev.data ? '\n' : '') + v;
        any = true;
      }
      if (any) { try { ev.data = JSON.parse(ev.data); } catch { /* left as text */ } onEvent(ev); }
    }
  };
}

module.exports = { createBus, createParser, RING, HEARTBEAT_MS };
