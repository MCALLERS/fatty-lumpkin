'use strict';
// Media helpers for the Library and Clippy: probe a video (ffprobe), make thumbnails (sips for pictures, an ffmpeg
// frame for videos, Quick Look for documents), pull a WAV out of a clip, and snapshot a web page (headless Chrome).
// Tool paths come in explicitly (the toolchain's ffmpeg and Chrome), so nothing here guesses what's installed.
// Every command reads its input and writes only the output path it's given.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

const THUMB_MAX = 600;
const SIPS = '/usr/bin/sips';
const QLMANAGE = '/usr/bin/qlmanage';

function run(file, args, { timeout = 120000, env } = {}) {
  return new Promise((resolve) => {
    if (!file) { resolve({ code: 127, out: '', err: 'tool missing' }); return; }
    execFile(file, args, { timeout, env: env || process.env, maxBuffer: 8 << 20 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: String(stdout || ''), err: String(stderr || '') });
    });
  });
}

const nonEmpty = (p) => { try { return fs.statSync(p).size > 0; } catch { return false; } };
const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * @param {{ffmpeg?: string, ffprobe?: string, chrome?: string}} tools  absolute paths (any may be missing)
 */
function createMedia(tools = {}) {
  const t = () => (typeof tools === 'function' ? tools() : tools) || {};

  /** Duration (s), width, height (as displayed: rotation applied) and codecs of a video or audio file, or null. */
  async function probe(file) {
    const r = await run(t().ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeout: 60000 });
    if (r.code !== 0) return null;
    let j;
    try { j = JSON.parse(r.out); } catch { return null; }
    const streams = j.streams || [];
    const v = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
    const a = streams.find((s) => s.codec_type === 'audio');
    const duration = Number(j.format && j.format.duration) || Number(v && v.duration) || Number(a && a.duration) || 0;
    let width = v ? Number(v.width) || null : null;
    let height = v ? Number(v.height) || null : null;
    const sd = (v && v.side_data_list) || [];
    const rot = Math.abs(Number((sd.find((d) => d.rotation != null) || {}).rotation || (v && v.tags && v.tags.rotate) || 0)) % 360;
    if (rot === 90 || rot === 270) [width, height] = [height, width];
    return { duration: round(duration), width, height, video: v ? v.codec_name : null, audio: a ? a.codec_name : null };
  }

  /** Pixel size of a picture (sips), or null. */
  async function imageSize(file) {
    const r = await run(SIPS, ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { timeout: 30000 });
    const w = /pixelWidth:\s*(\d+)/.exec(r.out);
    const h = /pixelHeight:\s*(\d+)/.exec(r.out);
    return w && h ? { width: Number(w[1]), height: Number(h[1]) } : null;
  }

  const SCALE = `scale='if(gt(iw,ih),min(${THUMB_MAX},iw),-2)':'if(gt(iw,ih),-2,min(${THUMB_MAX},ih))'`;

  /** A JPEG thumbnail (longest side at most 600 px) of a picture: sips first, ffmpeg if sips can't read it. */
  async function imageThumb(file, out) {
    const size = await imageSize(file);
    if (size) {
      const resize = Math.max(size.width, size.height) > THUMB_MAX ? ['-Z', String(THUMB_MAX)] : []; // -Z also enlarges
      const r = await run(SIPS, [...resize, '-s', 'format', 'jpeg', '-s', 'formatOptions', '82', file, '--out', out], { timeout: 60000 });
      if (r.code === 0 && nonEmpty(out)) return true;
    }
    const r = await run(t().ffmpeg, ['-v', 'error', '-y', '-i', file, '-frames:v', '1', '-vf', SCALE, '-q:v', '4', out], { timeout: 60000 });
    return r.code === 0 && nonEmpty(out);
  }

  /** A JPEG frame from a video, about a quarter of the way in (at most 10 s), falling back to the first frame. */
  async function videoThumb(file, out, duration) {
    const at = duration > 0 ? Math.min(duration * 0.25, 10) : 1;
    let r = await run(t().ffmpeg, ['-v', 'error', '-y', '-ss', at.toFixed(3), '-i', file, '-frames:v', '1', '-vf', SCALE, '-q:v', '4', out], { timeout: 60000 });
    if (r.code !== 0 || !nonEmpty(out)) r = await run(t().ffmpeg, ['-v', 'error', '-y', '-i', file, '-frames:v', '1', '-vf', SCALE, '-q:v', '4', out], { timeout: 60000 });
    return r.code === 0 && nonEmpty(out);
  }

  /** A thumbnail of a document (PDF, Keynote, Word…) through Quick Look, converted to JPEG. */
  async function documentThumb(file, out) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flpt-ql-'));
    try {
      await run(QLMANAGE, ['-t', '-s', String(THUMB_MAX), '-o', tmp, file], { timeout: 30000 });
      const png = fs.readdirSync(tmp).find((f) => f.endsWith('.png'));
      return png ? imageThumb(path.join(tmp, png), out) : false;
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  /** The sound of a clip as 48 kHz 16-bit WAV (what CapCut and the Cutaway Library use). */
  async function extractWav(file, out) {
    const r = await run(t().ffmpeg, ['-v', 'error', '-y', '-i', file, '-vn', '-acodec', 'pcm_s16le', '-ar', '48000', out], { timeout: 600000 });
    return r.code === 0 && nonEmpty(out);
  }

  /**
   * A 1280×900 PNG of a web page, so a page that later disappears isn't lost. Headless Chrome with a throwaway
   * profile (no cookies, no extensions), a few seconds to settle, and a hard stop.
   */
  function snapshot(url, out, { timeoutMs = 40000 } = {}) {
    const chrome = t().chrome;
    if (!chrome || !/^https?:\/\//i.test(String(url))) return Promise.resolve(false);
    return new Promise((resolve) => {
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'flpt-snap-'));
      const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
        '--disable-extensions', '--mute-audio', '--disable-background-networking', '--disable-sync', '--disable-notifications',
        `--user-data-dir=${profile}`, '--window-size=1280,900', '--virtual-time-budget=6000', `--screenshot=${out}`, String(url)],
      { stdio: 'ignore' });
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { child.kill('SIGKILL'); } catch { /* gone */ }
        setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 300);
        resolve(nonEmpty(out));
      };
      const timer = setTimeout(finish, timeoutMs);
      // Some Chrome builds write the screenshot and then linger, so watch for the file as well as the exit.
      const poll = setInterval(() => { if (nonEmpty(out)) { clearInterval(poll); setTimeout(finish, 500); } }, 500);
      child.on('error', () => { clearInterval(poll); finish(); });
      child.on('exit', () => { clearInterval(poll); finish(); });
    });
  }

  return { probe, imageSize, imageThumb, videoThumb, documentThumb, extractWav, snapshot };
}

module.exports = { createMedia, run, THUMB_MAX };
