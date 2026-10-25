/* host-export.js · a WebCodecs draft exporter for canvas-only scenes, 1.0.0 (FLPT V2, PLAN §2.3).
 *
 * Web drafts only, never finals (finals come from the pinned renderer): it seeks the scene frame by frame, encodes the
 * canvas with VideoEncoder (VP8, or VP9 when asked) and writes a WebM itself (a small Matroska muxer below, no
 * dependency). The DOM layer isn't captured, hence canvas-only.
 *
 *   const blob = await FLPTExport.webm({ instance?, canvas?, from: 0, to: duration, fps: 30, codec: 'vp8' | 'vp9',
 *                                        bitrate: 6e6, keyEvery: 60, onProgress(done, total) })
 *     instance: what FLPT.mount returned (its own canvas is encoded); without one, the page's scene (FLPT.canvas).
 *     canvas: another canvas to encode instead.
 *   FLPTExport.mux({ width, height, fps, codec, frames: [{ data: Uint8Array, key: bool }] }) -> Uint8Array (the muxer alone)
 */
(function (root) {
  'use strict';
  // ---- EBML / Matroska (WebM) writer
  function vint(n) {   // an EBML size: the shortest form that holds n (up to 8 bytes)
    for (let len = 1; len <= 8; len++) {
      if (n < 2 ** (7 * len) - 1) {
        const out = new Uint8Array(len);
        let v = n;
        for (let i = len - 1; i >= 0; i--) { out[i] = v % 256; v = Math.floor(v / 256); }
        out[0] |= 1 << (8 - len);
        return out;
      }
    }
    throw new Error('EBML size too large');
  }
  function idBytes(id) { const b = []; let v = id; while (v > 0) { b.unshift(v & 0xff); v = Math.floor(v / 256); } return Uint8Array.from(b); }
  function uint(n) { const b = []; let v = Math.max(0, Math.floor(n)); do { b.unshift(v & 0xff); v = Math.floor(v / 256); } while (v > 0); return Uint8Array.from(b); }
  function f64(x) { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, x); return b; }
  const ascii = (s) => Uint8Array.from(String(s), (c) => c.charCodeAt(0) & 0x7f);
  function cat(parts) { let n = 0; for (const p of parts) n += p.length; const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }
  const el = (id, payload) => { const body = Array.isArray(payload) ? cat(payload) : payload; return cat([idBytes(id), vint(body.length), body]); };

  /** frames: [{ data: Uint8Array, key: boolean }] in order, one per frame at fps. */
  function mux({ width, height, fps = 30, codec = 'vp8', frames }) {
    const ms = (n) => Math.round((n * 1000) / fps);
    const header = el(0x1A45DFA3, [el(0x4286, uint(1)), el(0x42F7, uint(1)), el(0x42F2, uint(4)), el(0x42F3, uint(8)), el(0x4282, ascii('webm')), el(0x4287, uint(4)), el(0x4285, uint(2))]);
    const info = el(0x1549A966, [el(0x2AD7B1, uint(1000000)), el(0x4D80, ascii('flpt-live')), el(0x5741, ascii('flpt-live host-export')), el(0x4489, f64((frames.length * 1000) / fps))]);
    const tracks = el(0x1654AE6B, [el(0xAE, [
      el(0xD7, uint(1)), el(0x73C5, uint(1)), el(0x83, uint(1)), el(0x86, ascii(codec === 'vp9' ? 'V_VP9' : 'V_VP8')),
      el(0x23E383, uint(Math.round(1e9 / fps))), el(0xE0, [el(0xB0, uint(width)), el(0xBA, uint(height))]),
    ])]);
    const clusters = [];
    let cur = null, base = 0;
    const flush = () => { if (cur) clusters.push(el(0x1F43B675, [el(0xE7, uint(base)), ...cur])); cur = null; };
    frames.forEach((f, n) => {
      const t = ms(n);
      if (!cur || f.key || t - base > 30000) { flush(); cur = []; base = t; }
      const rel = t - base, head = new Uint8Array(4);
      head[0] = 0x81; head[1] = (rel >> 8) & 0xff; head[2] = rel & 0xff; head[3] = f.key ? 0x80 : 0x00;
      cur.push(el(0xA3, [head, f.data]));
    });
    flush();
    return cat([header, el(0x18538067, [info, tracks, ...clusters])]);
  }

  async function webm(o = {}) {
    const F = root.FLPT;
    const inst = o.instance || null;
    const canvas = o.canvas || (inst ? inst.canvas : (F && F.canvas) || root.document.getElementById('stage'));
    if (!canvas) throw new Error('host-export: no canvas (pass instance, canvas, or run on a scene page)');
    if (typeof root.VideoEncoder !== 'function') throw new Error('host-export: this browser has no WebCodecs VideoEncoder');
    const seek = inst ? (t) => inst.seek(t) : (t) => F.seek(t);
    const dur = inst ? inst.duration : F.duration;
    const fps = o.fps || 30, from = Math.max(0, o.from || 0), to = Math.min(dur, o.to != null ? o.to : dur);
    const n0 = Math.floor(from * fps + 1e-6), n1 = Math.max(n0 + 1, Math.round(to * fps));
    const codec = o.codec === 'vp9' ? 'vp9' : 'vp8';
    const chunks = [];
    let failure = null;
    const enc = new root.VideoEncoder({
      output: (chunk) => { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); chunks.push({ data: b, key: chunk.type === 'key', ts: chunk.timestamp }); },
      error: (e) => { failure = e; },
    });
    enc.configure({ codec: codec === 'vp9' ? 'vp09.00.10.08' : 'vp8', width: canvas.width, height: canvas.height, bitrate: o.bitrate || 6e6, framerate: fps, latencyMode: 'quality' });
    for (let n = n0; n < n1; n++) {
      if (failure) throw failure;
      await seek((n + 0.5) / fps);
      const frame = new root.VideoFrame(canvas, { timestamp: Math.round(((n - n0) * 1e6) / fps), duration: Math.round(1e6 / fps) });
      enc.encode(frame, { keyFrame: (n - n0) % (o.keyEvery || 60) === 0 });
      frame.close();
      if (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
      if (o.onProgress) o.onProgress(n - n0 + 1, n1 - n0);
    }
    await enc.flush();
    enc.close();
    if (failure) throw failure;
    chunks.sort((a, b) => a.ts - b.ts);
    const bytes = mux({ width: canvas.width, height: canvas.height, fps, codec, frames: chunks });
    return new root.Blob([bytes], { type: 'video/webm' });
  }

  root.FLPTExport = Object.freeze({ version: '1.0.0', webm, mux });
})(typeof window !== 'undefined' ? window : globalThis);
