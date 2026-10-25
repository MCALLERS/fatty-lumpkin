'use strict';
/* global flpt */
// Fatty Lumpkin Clippy: a link, a title, a start and an end, and the moment lands in the Library. The main process
// runs yt-dlp (src/main/clippy.js and library-ipc.js); this page only asks and shows how it's going.

const $ = (sel) => document.querySelector(sel);

const st = { running: false, status: null, item: null, log: [], prefilledFor: '' };

// The same timestamp rules as the main process (timecode.js): "1:51", "01:51.00", "0:01:51.5", "111".
function parseTime(input) {
  const m = /^(?:(?:(\d{1,3}):)?(\d{1,2}):)?(\d+)(?:[.,](\d{1,3}))?$/.exec(String(input || '').trim());
  if (!m) return null;
  const [, h, mm, ss, frac] = m;
  if (mm != null && (Number(ss) >= 60 || ss.length > 2)) return null;
  if (h != null && Number(mm) >= 60) return null;
  return ((Number(h || 0) * 60 + Number(mm || 0)) * 60 + Number(ss)) + (frac ? Number(frac.padEnd(3, '0')) / 1000 : 0);
}
const clock = (s) => { const t = Math.max(0, Math.round(s)); const h = Math.floor(t / 3600); const m = Math.floor(t / 60) % 60; const x = String(t % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
const isHttp = (u) => { try { return /^https?:$/.test(new URL(String(u).trim()).protocol); } catch { return false; } };

/** A YouTube link's own start time (t=111, t=1m51s, start=111), in seconds, or null. */
function linkStart(url) {
  try {
    const u = new URL(String(url).trim());
    const t = u.searchParams.get('t') || u.searchParams.get('start') || '';
    const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(t);
    if (!t || !m) return null;
    const s = Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
    return s > 0 ? s : null;
  } catch { return null; }
}

function form() {
  return {
    url: $('#f-url').value.trim(), title: $('#f-title').value.trim(), start: $('#f-start').value.trim(), end: $('#f-end').value.trim(),
    tags: $('#f-tags').value, notes: $('#f-notes').value, wav: $('#f-wav').checked,
  };
}

function check(f) {
  const errors = {};
  if (!isHttp(f.url)) errors.url = f.url ? 'That isn\'t a web link.' : 'Paste a video link.';
  const s = parseTime(f.start);
  const e = parseTime(f.end);
  if (s == null) errors.start = f.start ? 'Like 1:51 or 111.' : 'Where does it start?';
  if (e == null) errors.end = f.end ? 'Like 2:09 or 129.' : 'Where does it end?';
  if (s != null && e != null && e <= s) errors.end = 'After the start, please.';
  return errors;
}

function showErrors(errors = {}) {
  for (const k of ['url', 'start', 'end']) {
    $(`#e-${k}`).textContent = errors[k] || '';
    $(`#f-${k}`).setAttribute('aria-invalid', String(Boolean(errors[k])));
  }
}

/** The clip's length beside the times, and a friendly note when it's long. */
function showLength() {
  const s = parseTime($('#f-start').value);
  const e = parseTime($('#f-end').value);
  const ok = s != null && e != null && e > s;
  $('#f-len').textContent = ok ? clock(e - s) : '';
  const warn = $('#f-warn');
  warn.hidden = !(ok && e - s > 180);
  warn.textContent = warn.hidden ? '' : `That's ${clock(e - s)}. Long clips take a while.`;
}

function setError(text) {
  const p = $('#cl-error');
  p.textContent = text || '';
  p.hidden = !text;
}

function setLog(open) {
  const pre = $('#cl-log');
  pre.hidden = !open;
  $('#cl-log-btn').setAttribute('aria-expanded', String(open));
  $('#cl-log-btn').textContent = open ? 'Hide details' : 'Details';
  if (open) pre.scrollTop = pre.scrollHeight;
}

function addLog(line) {
  st.log.push(line);
  if (st.log.length > 400) st.log.shift();
  const pre = $('#cl-log');
  pre.textContent = st.log.join('\n');
  if (!pre.hidden) pre.scrollTop = pre.scrollHeight;
  $('#cl-log-btn').hidden = false;
}

/** form | running | done | missing */
function mode(m) {
  const missing = m === 'missing';
  $('#clip-form').hidden = m === 'done';
  $('#cl-result').hidden = m !== 'done';
  $('#cl-go').hidden = m !== 'form';
  $('#cl-progress').hidden = m !== 'running';
  $('#cl-missing').hidden = !missing;
  for (const x of document.querySelectorAll('#clip-form input, #clip-form textarea')) x.disabled = m === 'running';
  $('#clip-btn').disabled = missing;
}

function showTool(s) {
  const p = $('#cl-tool');
  if (!s || !s.ytDlp) { p.replaceChildren(); return; }
  const where = { chosen: 'your own', pinned: 'FLPT\'s copy', system: s.ytDlp.path.startsWith('/opt/homebrew/') ? 'Homebrew' : 'on this Mac' }[s.ytDlp.source] || '';
  const change = document.createElement('button');
  change.type = 'button';
  change.className = 'linkish';
  change.textContent = 'Change…';
  change.addEventListener('click', chooseYtDlp);
  p.replaceChildren(document.createTextNode(`yt-dlp ${s.ytDlp.version || ''}${where ? ` · ${where}` : ''} · `), change);
  p.title = s.ytDlp.path;
}

async function refreshStatus() {
  const r = await flpt.clippy.status();
  if (!r || !r.ok) { setError((r && r.error) || 'Clippy couldn\'t check its tools.'); return; }
  st.status = r.value;
  showTool(r.value);
  if (st.running) return;
  if (!r.value.ytDlp) {
    mode('missing');
    $('#m-install').hidden = !r.value.canInstall;
    $('#m-install').textContent = r.value.installVersion ? `Install it (${r.value.installVersion})` : 'Install it';
    if (r.value.chosenMissing) setError('The yt-dlp you chose isn\'t there any more.');
  } else if ($('#cl-result').hidden) {
    mode('form');
  }
  if (r.value.ytDlp && !r.value.ffmpeg) setError('Clippy needs ffmpeg: Setup → Tools, in the main window.');
}

async function chooseYtDlp() {
  setError('');
  const r = await flpt.clippy.chooseYtDlp();
  if (!r.ok) { setError(r.error); return; }
  await refreshStatus();
}

async function installYtDlp() {
  setError('');
  $('#m-install').disabled = true;
  $('#m-choose').disabled = true;
  $('#m-note').textContent = 'Downloading yt-dlp (checked against its published checksum)…';
  const r = await flpt.clippy.installYtDlp();
  $('#m-install').disabled = false;
  $('#m-choose').disabled = false;
  $('#m-note').replaceChildren(document.createTextNode('Or in Terminal: '), Object.assign(document.createElement('code'), { textContent: 'brew install yt-dlp' }));
  if (!r.ok) { setError(r.error); return; }
  await refreshStatus();
}

async function clipIt(e) {
  e.preventDefault();
  if (st.running) return;
  setError('');
  const f = form();
  const errors = check(f);
  showErrors(errors);
  if (Object.keys(errors).length) { $(`#f-${Object.keys(errors)[0]}`).focus(); return; }
  st.running = true;
  st.log = [];
  $('#cl-log').textContent = '';
  setLog(false);
  $('#cl-log-btn').hidden = true;
  $('#cl-step').textContent = 'Reading the video…';
  $('#cl-bar').removeAttribute('value'); // indeterminate until yt-dlp reports progress
  mode('running');
  const r = await flpt.clippy.run(f);
  st.running = false;
  if (r && r.ok) {
    showResult(r.value);
    return;
  }
  mode(st.status && !st.status.ytDlp ? 'missing' : 'form');
  if (r && r.fields) showErrors(r.fields);
  setError((r && r.error) || 'That didn\'t work.');
  if (st.log.length && !/^Stopped/.test((r && r.error) || '')) setLog(true); // the log, on error
}

function showResult(item) {
  st.item = item;
  const img = $('#r-thumb');
  if (item.thumbPath) { img.src = flpt.fileUrl(item.thumbPath, item.addedAt); img.hidden = false; } else { img.removeAttribute('src'); img.hidden = true; }
  $('#r-title').textContent = item.title;
  $('#r-meta').textContent = [item.duration ? clock(item.duration) : '', item.site].filter(Boolean).join(' · ');
  mode('done');
  $('#r-show').focus();
}

function clipAnother() {
  // Same video, new moment: keep the link, clear the rest.
  for (const id of ['#f-title', '#f-start', '#f-end']) $(id).value = '';
  showLength();
  showErrors();
  setError('');
  st.item = null;
  mode(st.status && !st.status.ytDlp ? 'missing' : 'form');
  $('#f-start').focus();
}

flpt.clippy.onEvent((ev) => {
  if (ev.phase === 'line') addLog(ev.line);
  else if (ev.phase === 'step') {
    $('#cl-step').textContent = ev.text;
    if (ev.step !== 'clip') $('#cl-bar').removeAttribute('value');
    else $('#cl-bar').value = 0;
  } else if (ev.phase === 'progress') $('#cl-bar').value = ev.percent;
  else if (ev.phase === 'install' && ev.total) $('#m-note').textContent = `Downloading yt-dlp… ${Math.round((100 * ev.bytes) / ev.total)} %`;
});

$('#clip-form').addEventListener('submit', clipIt);
$('#cl-stop').addEventListener('click', () => { $('#cl-step').textContent = 'Stopping…'; flpt.clippy.cancel(); });
$('#cl-log-btn').addEventListener('click', () => setLog($('#cl-log').hidden));
$('#m-install').addEventListener('click', installYtDlp);
$('#m-choose').addEventListener('click', chooseYtDlp);
$('#r-show').addEventListener('click', () => { if (st.item) flpt.clippy.showInLibrary(st.item.id); });
$('#r-again').addEventListener('click', clipAnother);
for (const id of ['#f-start', '#f-end']) $(id).addEventListener('input', () => { showLength(); $(`#e-${id.slice(3)}`).textContent = ''; });
$('#f-url').addEventListener('input', () => {
  $('#e-url').textContent = '';
  // A link that carries its own start (t=111) fills in Start, once, if it's empty.
  const url = $('#f-url').value.trim();
  const s = linkStart(url);
  if (s != null && !$('#f-start').value.trim() && st.prefilledFor !== url) { st.prefilledFor = url; $('#f-start').value = clock(s); showLength(); }
});
window.addEventListener('focus', () => { if (!st.running && st.status && !st.status.ytDlp) refreshStatus(); });

mode('form');
refreshStatus().then(() => { if (!$('#clip-form').hidden && !$('#cl-go').hidden) $('#f-url').focus(); });
