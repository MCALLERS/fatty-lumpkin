'use strict';
// Fatty Lumpkin Clippy: clip one moment out of a video link into the Library. Only the user runs it, from its own
// window (library-ipc.js); nothing here is an agent tool, so the crew can't call it. Every clip keeps its source URL
// and its timestamps. The yt-dlp flags reproduce Michael's own recipe:
//   yt-dlp --js-runtimes node --no-playlist -f "bv[vcodec^=avc1][height<=1080]+ba[ext=m4a]/b[ext=mp4]" \
//     --download-sections "*00:01:51.00-00:02:09.00" --force-keyframes-at-cuts --merge-output-format mp4 -o …
// plus --ffmpeg-location (the toolchain's ffmpeg), --newline (progress a line at a time) and a temp output folder.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { parseHttpUrl, cleanYouTubeUrl, siteName } = require('./linkmeta');
const { parseTime, formatTime, shortTime } = require('./timecode');

const FORMAT = 'bv[vcodec^=avc1][height<=1080]+ba[ext=m4a]/b[ext=mp4]';
const LONG_CLIP_S = 180;
// YouTube now and then refuses a request that works a moment later (a 403 on the media URL, or "unavailable" from
// one of its player clients). Those get retried; anything else fails at once.
const TRANSIENT = /HTTP Error 403|403 Forbidden|HTTP Error 5\d\d|Video unavailable|Unable to download (webpage|API)|timed out|Connection reset|IncompleteRead/i;
const ATTEMPTS = { read: 2, clip: 3 };
const INFO_FIELDS = '%(.{id,title,uploader,channel,channel_url,uploader_url,duration,webpage_url,extractor_key})j';

/** The link Clippy works from: a YouTube link reduced to its video (no list=, index= or t=); others as given. */
function cleanClipUrl(input) {
  const u = parseHttpUrl(input);
  if (!u) return null;
  const yt = cleanYouTubeUrl(u.href);
  if (yt) return { url: yt, youtube: true };
  u.hash = '';
  return { url: u.href, youtube: false };
}

/** Check Clippy's form. Returns { ok, errors: {field: text}, warning, value }. */
function validateClip(form = {}) {
  const errors = {};
  const link = cleanClipUrl(form.url);
  if (!link) errors.url = 'Paste a video link (https://…).';
  const start = parseTime(form.start);
  const end = parseTime(form.end);
  if (start == null) errors.start = String(form.start || '').trim() ? 'Use h:mm:ss, mm:ss or seconds.' : 'Where does it start?';
  if (end == null) errors.end = String(form.end || '').trim() ? 'Use h:mm:ss, mm:ss or seconds.' : 'Where does it end?';
  if (start != null && end != null && end <= start) errors.end = 'The end comes after the start.';
  const length = start != null && end != null ? Math.round((end - start) * 1000) / 1000 : null;
  const ok = !Object.keys(errors).length;
  return {
    ok,
    errors,
    warning: ok && length > LONG_CLIP_S ? `That's ${shortTime(length)}. Long clips take a while.` : '',
    value: ok ? { url: link.url, youtube: link.youtube, title: String(form.title || '').trim().slice(0, 300), start, end, length } : null,
  };
}

/** yt-dlp's arguments for the clip itself (Michael's flags, in his order). */
function ytDlpArgs({ url, start, end, outDir, ffmpegDir }) {
  return [
    '--js-runtimes', 'node', '--no-playlist',
    '-f', FORMAT,
    '--download-sections', `*${formatTime(start)}-${formatTime(end)}`, '--force-keyframes-at-cuts',
    '--merge-output-format', 'mp4',
    ...(ffmpegDir ? ['--ffmpeg-location', ffmpegDir] : []),
    '--newline',
    '-o', path.join(outDir, 'clip.%(ext)s'),
    url,
  ];
}

/** yt-dlp's arguments for reading the video's title, uploader and channel first (for the source credit). */
function ytDlpInfoArgs({ url }) {
  return ['--js-runtimes', 'node', '--no-playlist', '-f', FORMAT, '--skip-download', '--no-warnings', '--print', INFO_FIELDS, url];
}

/** The credit from yt-dlp's --print line: { title, author, authorUrl, duration, site }, or {} if it isn't there. */
function parseInfo(stdout) {
  const line = String(stdout || '').split(/\r?\n/).reverse().find((l) => l.trim().startsWith('{'));
  if (!line) return {};
  try {
    const j = JSON.parse(line);
    const authorUrl = [j.channel_url, j.uploader_url].find((x) => parseHttpUrl(x)) || '';
    return {
      title: typeof j.title === 'string' ? j.title.slice(0, 300) : '',
      author: String(j.uploader || j.channel || '').slice(0, 200),
      authorUrl,
      duration: Number(j.duration) || null,
      site: j.extractor_key === 'Youtube' || /^Youtube/.test(String(j.extractor_key || '')) ? 'YouTube' : String(j.extractor_key || ''),
    };
  } catch { return {}; }
}

/** How far a download is (0–100) from one line of yt-dlp or ffmpeg output, or null. */
function parseProgress(line, clipSeconds) {
  const m = /\[download\]\s+(\d+(?:\.\d+)?)%/.exec(line);
  if (m) return Math.min(100, Number(m[1]));
  const t = /\btime=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(line);
  if (t && clipSeconds > 0) return Math.min(100, Math.round(((Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3])) / clipSeconds) * 1000) / 10);
  return null;
}

/** Plain words for the usual ways a clip fails; otherwise yt-dlp's own last error line. */
function friendlyError(lines) {
  const all = (lines || []).join('\n');
  const rules = [
    [/HTTP Error 403|403 Forbidden/i, 'YouTube refused the download just now (it does that now and then). Try again in a minute.'],
    [/Video unavailable|This video is private|has been removed|This video is no longer available|account associated with this video has been terminated/i, 'That video isn\'t available (it may be private or removed).'],
    [/Sign in to confirm|confirm you.re not a bot|age-restricted|inappropriate for some users/i, 'YouTube wants a sign-in for that one (an age or bot check). Try again later, or try another link.'],
    [/HTTP Error 429|Too Many Requests/i, 'YouTube is limiting downloads from this Mac right now. Try again in a while.'],
    [/Requested format is not available/i, 'That video has no MP4 version Clippy can use.'],
    [/Unsupported URL|is not a valid URL/i, 'yt-dlp doesn\'t know that site.'],
    [/ffmpeg.*not (found|installed)|ffprobe.*not (found|installed)/i, 'Clippy needs ffmpeg. Set it up in Setup → Tools.'],
    [/No supported JavaScript runtime|JS runtime|javascript runtime/i, 'yt-dlp needs Node.js for YouTube. Set it up in Setup → Tools.'],
    [/Unable to download webpage|Failed to resolve|Temporary failure in name resolution|Network is unreachable|timed out/i, 'Couldn\'t reach the video. Check the internet connection.'],
  ];
  for (const [re, text] of rules) if (re.test(all)) return text;
  const last = [...(lines || [])].reverse().find((l) => /ERROR:/.test(l));
  return last ? last.replace(/^.*?ERROR:\s*/, '').replace(/^\[[^\]]+\]\s*[\w-]+:\s*/, '').slice(0, 300) : '';
}

/** A file name from a title: "More cowbell!" → "More-cowbell". */
function fileStem(title) {
  return String(title || 'clip').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'clip';
}

/**
 * Run a program in its own process group (so stopping it also stops the ffmpeg it starts), a line at a time.
 * Returns { code, stdout, lines } (the last 300 lines).
 */
function runProcess(file, args, { env, signal, onLine = () => {}, spawnImpl = spawn, timeoutMs = 0 } = {}) {
  return new Promise((resolve) => {
    let child;
    try { child = spawnImpl(file, args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true }); } catch (e) { resolve({ code: 127, stdout: '', lines: [e.message] }); return; }
    let stdout = '';
    const lines = [];
    const rest = { out: '', err: '' };
    const emit = (raw) => {
      if (!raw.trim()) return;
      lines.push(raw);
      if (lines.length > 300) lines.shift();
      try { onLine(raw); } catch { /* the window went away */ }
    };
    const take = (which) => (buf) => {
      const s = String(buf);
      if (which === 'out') stdout += s;
      const parts = (rest[which] + s).split(/\r\n|\n|\r/);
      rest[which] = parts.pop();
      parts.forEach(emit);
    };
    child.stdout.on('data', take('out'));
    child.stderr.on('data', take('err'));
    let killed = false;
    const kill = () => {
      if (killed) return;
      killed = true;
      try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* gone */ } }
      setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }, 3000).unref();
    };
    if (signal) { if (signal.aborted) kill(); else signal.addEventListener('abort', kill, { once: true }); }
    const timer = timeoutMs ? setTimeout(kill, timeoutMs) : null;
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: 127, stdout, lines: [...lines, e.message] }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      emit(rest.out);
      emit(rest.err);
      resolve({ code: code == null ? 1 : code, stdout, lines, killed });
    });
  });
}

/**
 * Clip it: read the video's credit, download just the section, then probe it, make its thumbnail (and WAV, if
 * asked) and add it to the Library as kind "clip", addedBy "clippy", with source {url, site, author} and clip
 * {url, start, end}. onEvent gets { phase: 'step'|'progress'|'line'|'done', … }. Throws with a plain message.
 */
async function clip(form, { library, media, ytDlp, ffmpegDir, env, onEvent = () => {}, signal, redact = (s) => s, tmpRoot = os.tmpdir(), spawnImpl, retryPauseMs = 2000 } = {}) {
  const v = validateClip(form);
  if (!v.ok) throw Object.assign(new Error(Object.values(v.errors)[0]), { fields: v.errors });
  if (!ytDlp) throw new Error('Clippy needs yt-dlp.');
  const c = v.value;
  const say = (ev) => { try { onEvent(ev); } catch { /* the window went away */ } };
  const line = (l) => say({ phase: 'line', line: redact(l) });
  const shown = (args) => `$ yt-dlp ${args.map((a) => (/\s|[*"%]/.test(a) ? JSON.stringify(a) : a)).join(' ')}`;
  const stopped = () => signal && signal.aborted;
  /** Run yt-dlp, trying again (after a pause) when YouTube refuses something it usually allows. */
  const attempt = async (step, n, args, opts, before = () => {}) => {
    let r;
    for (let i = 1; i <= n; i++) {
      before();
      line(shown(args));
      r = await runProcess(ytDlp, args, { env, signal, spawnImpl, ...opts });
      if (stopped() || r.code === 0 || i === n || !TRANSIENT.test(r.lines.join('\n'))) return r;
      line(`YouTube said no; trying again (${i + 1} of ${n})…`);
      say({ phase: 'step', step, text: 'Trying again…' });
      await new Promise((res) => setTimeout(res, retryPauseMs * i));
      if (stopped()) return r;
    }
    return r;
  };
  const work = fs.mkdtempSync(path.join(tmpRoot, 'flpt-clippy-'));
  try {
    say({ phase: 'step', step: 'read', text: 'Reading the video…' });
    const info = await attempt('read', ATTEMPTS.read, ytDlpInfoArgs(c), { onLine: line, timeoutMs: 180000 });
    if (stopped()) throw new Error('Stopped.');
    if (info.code !== 0) throw new Error(friendlyError(info.lines) || 'yt-dlp couldn\'t read that video.');
    const meta = parseInfo(info.stdout);
    if (meta.duration && c.start >= meta.duration) throw new Error(`The video is only ${shortTime(meta.duration)} long.`);

    let best = 0;
    const args = ytDlpArgs({ ...c, outDir: work, ffmpegDir });
    const r = await attempt('clip', ATTEMPTS.clip, args, {
      timeoutMs: 30 * 60000,
      onLine: (l) => {
        line(l);
        const p = parseProgress(l, c.length);
        if (p != null && p > best) { best = p; say({ phase: 'progress', percent: p }); }
      },
    }, () => {
      // Each try starts clean: no part-files from the last one.
      for (const f of fs.readdirSync(work)) fs.rmSync(path.join(work, f), { recursive: true, force: true });
      best = 0;
      say({ phase: 'step', step: 'clip', text: 'Clipping…' });
    });
    if (stopped()) throw new Error('Stopped.');
    if (r.code !== 0) throw new Error(friendlyError(r.lines) || 'The clip didn\'t download.');
    const out = fs.readdirSync(work).find((f) => /^clip\.(mp4|m4v|mov|webm|mkv)$/i.test(f));
    if (!out) throw new Error('yt-dlp finished, but no clip came out.');

    say({ phase: 'step', step: 'save', text: 'Saving…' });
    const file = path.join(work, out);
    const title = c.title || (meta.title ? `${meta.title} (${shortTime(c.start)}–${shortTime(c.end)})` : 'Untitled clip');
    const stem = fileStem(c.title || meta.title || 'clip');
    let wav = null;
    if (form.wav) {
      wav = path.join(work, 'clip.wav');
      if (!(media && (await media.extractWav(file, wav)))) { wav = null; line('The WAV didn\'t come out; the clip itself is fine.'); }
    }
    const u = parseHttpUrl(c.url);
    const item = await library.add({
      kind: 'clip', file, fileName: `${stem}${path.extname(out).toLowerCase()}`, audio: wav, audioName: `${stem}__audio.wav`, move: true,
      title, notes: typeof form.notes === 'string' ? form.notes : '', tags: form.tags,
      source: { url: c.url, site: meta.site || (c.youtube ? 'YouTube' : siteName(u)), author: meta.author || '', authorUrl: meta.authorUrl || '' },
      clip: { url: c.url, start: formatTime(c.start), end: formatTime(c.end) },
      addedBy: 'clippy',
    });
    say({ phase: 'done', item });
    return item;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

module.exports = { clip, cleanClipUrl, validateClip, ytDlpArgs, ytDlpInfoArgs, parseInfo, parseProgress, friendlyError, fileStem, runProcess, FORMAT, LONG_CLIP_S };
