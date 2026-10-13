'use strict';
// Timestamps for clips: "1:51", "01:51.00", "0:01:51.5", "111" or "111.25" in; seconds out. And back to the
// hh:mm:ss.ms form yt-dlp's --download-sections takes ("00:01:51.00").

/** Seconds (a number, millisecond precision) for "h:mm:ss", "mm:ss" or "ss", each with an optional ".ms"; else null. */
function parseTime(input) {
  const s = String(input == null ? '' : input).trim();
  const m = /^(?:(?:(\d{1,3}):)?(\d{1,2}):)?(\d+)(?:[.,](\d{1,3}))?$/.exec(s);
  if (!m) return null;
  const [, h, mm, ss, frac] = m;
  const hours = h ? Number(h) : 0;
  const mins = mm ? Number(mm) : 0;
  const secs = Number(ss);
  if (mm != null && (secs >= 60 || ss.length > 2)) return null; // "1:75" or "1:075" is a typo, not 2:15
  if (h != null && mins >= 60) return null;
  const ms = frac ? Number(frac.padEnd(3, '0')) : 0;
  return Math.round(((hours * 60 + mins) * 60 + secs) * 1000 + ms) / 1000;
}

/** "00:01:51.00" for 111; milliseconds when they matter ("01:02:05.125"). */
function formatTime(seconds) {
  const totalMs = Math.max(0, Math.round(Number(seconds) * 1000));
  const ms = totalMs % 1000;
  const total = Math.floor(totalMs / 1000);
  const p2 = (n) => String(n).padStart(2, '0');
  const frac = ms % 10 === 0 ? String(ms / 10).padStart(2, '0') : String(ms).padStart(3, '0');
  return `${p2(Math.floor(total / 3600))}:${p2(Math.floor(total / 60) % 60)}:${p2(total % 60)}.${frac}`;
}

/** "1:51" or "1:02:05" for showing a time or a length to people. */
function shortTime(seconds) {
  const t = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor(t / 60) % 60;
  const s = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

module.exports = { parseTime, formatTime, shortTime };
