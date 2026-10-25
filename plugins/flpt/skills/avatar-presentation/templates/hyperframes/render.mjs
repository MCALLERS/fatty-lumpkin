#!/usr/bin/env node
// render.mjs — sync, render and verify one HyperFrames "live slide" (1920x1080, 30 fps, silent MP4).
//
//   node render.mjs --new <dest-dir> [--from live-slide|possible-worlds|whiteboard-sketch]   scaffold a slide folder
//   node render.mjs <slide-dir> --sync                                     regenerate beats.js + stamp duration (for Studio preview)
//   node render.mjs <slide-dir> --out <file.mp4> [options]                 sync, render, verify
//
// Options
//   --duration <s>        set the slide length (written back to beats.json) — match the slide's narration
//   --quality <q>         draft | looks | delivery (default: delivery)
//   --check-frames <dir>  write 4 PNGs (20%, 45%, 70%, last frame) + a hold test, for a visual check
//   --frames-at <list>    custom check-frame times, e.g. "2.5,9,14.2"
//   --guides              show the safe-area and presenter-bubble keep-out (check renders only, never deliver)
//   --check               also run `hyperframes check` (layout / contrast / runtime audit) before rendering
//   --hf <version>        HyperFrames CLI version (default 0.8.80; "latest" to float)
//
// Telemetry: runs the HyperFrames CLI with DO_NOT_TRACK=1 and HYPERFRAMES_NO_TELEMETRY=1.
// Docs: ../../references/hyperframes-slides.md

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_HF = "0.8.80";
const FPS = 30;
const W = 1920;
const H = 1080;
const DEF_DUR = { rise: 0.7, fade: 0.6, pop: 0.55, draw: 1.1, wipe: 0.8, grow: 0.8, words: 0.9, out: 0.45, focus: 0.5, dim: 0.5, unfocus: 0.5, pulse: 0.6, count: 1.4, to: 0.6 };
const TEMPLATES = {
  "live-slide": join(HERE, "live-slide"),
  "possible-worlds": join(HERE, "examples", "possible-worlds"),
  "whiteboard-sketch": join(HERE, "examples", "whiteboard-sketch"),
};

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i];
    if (!s.startsWith("--")) { a._.push(s); continue; }
    const key = s.slice(2);
    const flag = ["sync", "guides", "check", "help"].includes(key);
    a[key] = flag ? true : argv[++i];
  }
  return a;
}

const die = (m, code = 1) => { console.error(`render.mjs: ${m}`); process.exit(code); };
const log = (m) => console.log(m);
const env = { ...process.env, DO_NOT_TRACK: "1", HYPERFRAMES_NO_TELEMETRY: "1" };
// FLPT patch: the app's own pinned HyperFrames CLI instead of npx, so nothing is downloaded at render time.
// Only when the app sets FLPT_HYPERFRAMES (the CLI's path); otherwise npx, as before.
const hfRun = (hf, args, opts) => (process.env.FLPT_HYPERFRAMES
  ? run(process.execPath, [process.env.FLPT_HYPERFRAMES, ...args], opts)
  : run("npx", ["-y", hf, ...args], opts));
// FLPT_CAPTURE_V1 (engine/tools/patches/36_capture.py): with FLPT's pinned CLI, the capture spike K1 measured
// deterministic: --workers 4, --experimental-fast-capture=false, --no-browser-gpu, an empty HOME of its own for the
// render (gone after it), no update check.
const FLPT_CAPTURE = [["--workers", "4"], ["--experimental-fast-capture=false"], ["--no-browser-gpu"]];
const flptFlag = (a) => String(a).split("=")[0].replace(/^--no-/, "--");
const { mkdtempSync: flptMkdtemp, rmSync: flptRm } = await import("node:fs");
const { tmpdir: flptTmpdir } = await import("node:os");
function flptRender(cmd, args, opts) {
  const flags = FLPT_CAPTURE.filter(([f]) => !args.some((a) => flptFlag(a) === flptFlag(f))).flat();
  const home = env.HOME;
  let own = null;
  try { own = flptMkdtemp(join(flptTmpdir(), "flpt-hf-home-")); } catch (e) { console.error(`render.mjs: HyperFrames renders with this HOME (no private one: ${e.message})`); }
  if (own) env.HOME = own;
  try {
    return run(cmd, [...args, ...flags], { ...opts, flptCapture: true });
  } finally {
    if (own) {
      if (home === undefined) delete env.HOME; else env.HOME = home;
      try { flptRm(own, { recursive: true, force: true }); } catch { /* left in the temp folder */ }
    }
  }
}
if (process.env.FLPT_HYPERFRAMES) Object.assign(env, { HYPERFRAMES_NO_UPDATE_CHECK: "1", HYPERFRAMES_NO_AUTO_INSTALL: "1" });

function run(cmd, args, opts = {}) {
  if (process.env.FLPT_HYPERFRAMES && !opts.flptCapture && cmd === process.execPath && args[0] === process.env.FLPT_HYPERFRAMES && args[1] === "render") return flptRender(cmd, args, opts); // FLPT_CAPTURE_V1
  const tee = flptTweenLog !== null && !opts.capture; // FLPT_GSAP_FREE_V1: a flpt-tween slide's render log, shown and kept
  const r = spawnSync(cmd, args, { stdio: opts.capture || tee ? "pipe" : "inherit", encoding: "utf8", env, cwd: opts.cwd, maxBuffer: 1 << 28 });
  if (tee) { process.stdout.write(r.stdout || ""); process.stderr.write(r.stderr || ""); flptTweenLog += `${r.stdout || ""}\n${r.stderr || ""}`; }
  if (r.error) die(`${cmd} failed to start: ${r.error.message}`);
  return r;
}

function scaffold(dest, from = "live-slide") {
  const src = TEMPLATES[from] || resolve(from);
  if (!existsSync(join(src, "index.html"))) die(`template not found: ${from}`);
  const out = resolve(dest);
  if (existsSync(out) && readdirSync(out).length) die(`${out} exists and is not empty; refusing to overwrite`);
  mkdirSync(out, { recursive: true });
  cpSync(src, out, { recursive: true, filter: (p) => !/[\\/](renders|\.hyperframes|check-frames)([\\/]|$)/.test(p) });
  log(`✓ new slide at ${out} (from ${from})`);
  log(`  next: edit index.html (SCENE) + beats.json, then: node ${join(HERE, "render.mjs")} "${out}" --out <slide_NN.mp4> --check-frames <dir>`);
}

// keep beats one-per-line so the file stays readable
function fmtVal(v) {
  if (Array.isArray(v)) return "[" + v.map((x) => fmtVal(x)).join(", ") + "]";
  if (v && typeof v === "object") return "{" + Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${fmtVal(x)}`).join(", ") + "}";
  return JSON.stringify(v);
}
function formatBeats(j) {
  const { beats, ...rest } = j;
  const top = JSON.stringify(rest, null, 2).replace(/\n}$/, "");
  const lines = (beats || []).map((b) => "    { " + Object.entries(b).map(([k, v]) => `${JSON.stringify(k)}: ${fmtVal(v)}`).join(", ") + " }");
  return `${top},\n  "beats": [\n${lines.join(",\n")}\n  ]\n}\n`;
}

function beatEnds(beats) {
  let prev = 0;
  return beats.map((b) => {
    const t = typeof b.t === "number" ? b.t : prev + (typeof b.after === "number" ? b.after : 0);
    prev = t;
    const kind = (b.do && b.do !== "in") ? b.do : (b.anim || "rise");
    const n = Array.isArray(b.target) ? b.target.length : 1;
    const d = typeof b.dur === "number" ? b.dur : DEF_DUR[kind] ?? 0.7;
    const st = typeof b.stagger === "number" ? b.stagger : 0;
    return { t, end: t + d + st * Math.max(0, n - 1), b };
  });
}

// FLPT_GSAP_FREE_V1 · FLPT's slides run on flpt-tween, FLPT's own seekable subset of GSAP's timeline (W3-12). Its checks
// come from the engine's own copy next to this script, never from a slide folder's.
const TWEEN = join(HERE, "live-slide", "assets", "flpt-tween.js");
const onTween = (html) => /<script\b[^>]*\bsrc=["']assets\/flpt-tween\.js["']/i.test(html);
/** Each beat's `to` vars and eases that flpt-tween can't do, as "beat N (target): FlptTweenUnsupported: …". */
function flptTweenCheck(beats) {
  if (!existsSync(TWEEN)) return [];
  const { check } = createRequire(import.meta.url)(TWEEN);
  const out = [];
  beats.forEach((b, i) => {
    const found = [];
    if (b.do === "to" && b.to !== undefined) found.push(...check(b.to));
    for (const key of ["ease", "strokeEase"]) if (b[key] !== undefined) found.push(...check({ ease: b[key] }));
    for (const what of found) out.push(`beat ${i + 1}${b.target ? ` (${JSON.stringify(b.target)})` : ""}: FlptTweenUnsupported: ${what}`);
  });
  return out;
}
/** What flpt-tween reported on the page while HyperFrames ran it (its console.error lines, "FlptTweenUnsupported: …"). */
const flptTweenErrors = (text) => [...new Set([...text.matchAll(/FlptTweenUnsupported: ([^\n]*)/g)].map((m) => m[1].trim()))];
let flptTweenLog = null; // HyperFrames' log while it renders a flpt-tween slide (run() keeps it), else null

function sync(dir, opts = {}) {
  const beatsPath = join(dir, "beats.json");
  const htmlPath = join(dir, "index.html");
  if (!existsSync(beatsPath) || !existsSync(htmlPath)) die(`${dir} needs index.html and beats.json (scaffold with --new)`);
  let slide;
  try { slide = JSON.parse(readFileSync(beatsPath, "utf8")); } catch (e) { die(`beats.json is not valid JSON: ${e.message}`); }

  if (opts.duration != null) {
    const d = Number(opts.duration);
    if (!(d > 0)) die(`--duration must be a positive number of seconds`);
    slide.duration = d;
    writeFileSync(beatsPath, formatBeats(slide));
    log(`· beats.json duration set to ${d}s`);
  }
  if (!(slide.duration >= 1 && slide.duration <= 600)) die(`beats.json "duration" must be 1..600 seconds (got ${slide.duration})`);
  if (slide.fps && slide.fps !== FPS) log(`! beats.json fps ${slide.fps} ignored: the presentation pipeline is ${FPS} fps`);
  const frames = Math.round(slide.duration * FPS);
  const duration = frames / FPS;
  const hold = typeof slide.hold === "number" ? slide.hold : 1;

  // Static checks: referenced ids exist; motion ends before the hold.
  const html = readFileSync(htmlPath, "utf8");
  const problems = [];
  for (const b of slide.beats || []) {
    for (const t of [].concat(b.target || [])) {
      if (typeof t === "string" && /^[\w-]+$/.test(t) && !new RegExp(`id=["']${t}["']`).test(html)) problems.push(`beat target "${t}" has no id="${t}" in index.html`);
    }
    if (b.t == null && b.after == null) problems.push(`beat ${JSON.stringify(b.target)} has neither "t" nor "after"`);
  }
  const ends = beatEnds(slide.beats || []);
  const last = ends.reduce((m, e) => Math.max(m, e.end), 0);
  if (last > duration - hold) problems.push(`motion ends ~${last.toFixed(2)}s, but duration ${duration}s - hold ${hold}s = ${(duration - hold).toFixed(2)}s: move beats earlier or lengthen the slide (selector targets with stagger may run longer)`);
  if (problems.length) problems.forEach((p) => log(`! ${p}`));
  // FLPT_GSAP_FREE_V1: a move flpt-tween can't make is named now, and nothing renders while one is left
  const tween = onTween(html);
  const unsupported = tween ? flptTweenCheck(slide.beats || []) : [];
  unsupported.forEach((p) => log(`✗ ${p}`));

  const out = { ...slide, duration, fps: FPS, hold };
  if (opts.guides) out.guides = true;
  const js = `// GENERATED by render.mjs from beats.json — do not edit; edit beats.json and re-run --sync.\nwindow.__SLIDE__ = ${JSON.stringify(out, null, 2)};\n`
    + (process.env.FLPT_HYPERFRAMES ? FLPT_READY : ""); // FLPT_READY_V1
  writeFileSync(join(dir, "beats.js"), js);

  const rootRe = /(<div\b[^>]*\bid="slide"[^>]*>)/;
  const m = html.match(rootRe);
  if (!m) die(`index.html has no <div id="slide" …> root`);
  let tag = m[1];
  for (const [attr, val] of [["data-fps", FPS], ["data-duration", duration]]) {
    const re = new RegExp(`\\b${attr}="[^"]*"`);
    tag = re.test(tag) ? tag.replace(re, `${attr}="${val}"`) : tag.replace(/\s*>$/, ` ${attr}="${val}">`);
  }
  const html2 = html.replace(rootRe, () => tag);
  if (html2 !== html) writeFileSync(htmlPath, html2);
  log(`✓ synced ${dir}: ${+duration.toFixed(3)}s (${frames} frames), ${(slide.beats || []).length} beats, motion ends ~${last.toFixed(2)}s${opts.guides ? ", GUIDES ON" : ""}`);
  return { slide: out, frames, duration, hold, problems, tween, unsupported };
}

// FLPT_READY_V1 (engine/tools/patches/37_ready.py): with FLPT's pinned CLI, beats.js also makes the engine build after the
// fonts its page is loading, draws a whiteboard's paper texture as one picture, and holds HyperFrames' first capture for
// them and every picture's decode (window.__hf.buildReady), so no frame depends on how fast anything arrived. A deferred
// build that throws says "FlptReadyBuildFailed: …" on the page, and the render fails on it (main, below).
const FLPT_READY = `// FLPT_READY_V1: the engine builds once the fonts its page is loading have arrived; a whiteboard's paper texture is one
// picture; the first frame waits for the fonts and for every picture's decode. Nothing pending, nothing waits.
(function () {
  "use strict";
  var d = document, waits = [], held = true;
  var settle = function (p) { return Promise.resolve(p).then(null, function () {}); };
  var loading = function () { if (d.body) void d.body.offsetHeight; return !!d.fonts && d.fonts.status === "loading"; };
  // a deferred build that throws: said on the page, so the render fails (render.mjs reads it) instead of a still slide
  var failed = function (e) {
    var m = "FlptReadyBuildFailed: " + (e && e.message ? e.message : String(e));
    window.__flptReadyFailed = m;
    if (window.console && console.error) console.error(m);
  };
  var engine;
  Object.defineProperty(window, "LiveSlide", {
    configurable: true,
    enumerable: true,
    get: function () { return engine; },
    set: function (v) {
      engine = v && typeof v.build === "function" ? Object.assign({}, v, {
        build: function (slide) {
          // the fonts there, or the first frame already let go (waiting would leave it empty): built at once, as before
          if (!held || !loading()) return v.build(slide);
          var tl = gsap.timeline({ paused: true });
          waits.push(settle(d.fonts.ready).then(function () {
            try {
              var inner = v.build(slide);
              // the engine's timeline is made paused; GSAP never plays a paused child (flpt-tween's flag is only a flag)
              if (inner && typeof inner.paused === "function") inner.paused(false);
              tl.add(inner, 0);
            } catch (e) { failed(e); }
          }));
          return tl;
        },
      }) : v;
    },
  });
  // the paper's live SVG filters, redrawn wherever the pen passes, came out a little differently from run to run
  var paper = function () {
    Array.prototype.forEach.call(d.querySelectorAll("svg.board-tex"), function (svg) {
      var copy = svg.cloneNode(true), vb = svg.viewBox && svg.viewBox.baseVal, im = d.createElement("img");
      copy.removeAttribute("class");
      copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      if (vb && vb.width) { copy.setAttribute("width", String(vb.width)); copy.setAttribute("height", String(vb.height)); }
      im.className = svg.getAttribute("class");
      if (svg.getAttribute("style")) im.setAttribute("style", svg.getAttribute("style"));
      im.setAttribute("aria-hidden", "true");
      im.alt = "";
      im.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(copy));
      svg.parentNode.replaceChild(im, svg);
    });
  };
  paper();
  var hf = (window.__hf = window.__hf || {});
  (hf.buildReady = hf.buildReady || {})["flpt-ready"] = new Promise(function (done) {
    // every wait, those added while the first were pending too (a build after DOMContentLoaded), then the first frame
    var drain = function () {
      var n = waits.length;
      Promise.all(waits).then(function () { if (waits.length > n) drain(); else { held = false; done(); } });
    };
    var hold = function () {
      paper();
      if (loading()) waits.push(settle(d.fonts.ready));
      Array.prototype.forEach.call(d.querySelectorAll("img, image"), function (im) {
        if (im.loading === "lazy") im.loading = "eager";
        if (typeof im.decode === "function") waits.push(settle(im.decode()));
      });
      drain();
    };
    if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", hold, { once: true }); else hold();
  });
})();
`;

function ffprobe(file) {
  const r = run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { capture: true });
  if (r.status !== 0) die(`ffprobe failed on ${file}: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

function frameAt(video, t, png) {
  const r = run("ffmpeg", ["-v", "error", "-y", "-ss", t.toFixed(3), "-i", video, "-frames:v", "1", png], { capture: true });
  if (r.status !== 0 || !existsSync(png)) die(`could not extract frame at ${t}s: ${r.stderr}`);
  return png;
}

function lastFrame(video, png) {
  const r = run("ffmpeg", ["-v", "error", "-y", "-sseof", "-0.2", "-i", video, "-update", "1", "-q:v", "1", png], { capture: true });
  if (r.status !== 0 || !existsSync(png)) die(`could not extract last frame: ${r.stderr}`);
  return png;
}

function psnr(a, b) {
  const r = run("ffmpeg", ["-v", "info", "-i", a, "-i", b, "-lavfi", "psnr", "-f", "null", "-"], { capture: true });
  const m = (r.stderr || "").match(/average:(inf|[\d.]+)/);
  return m ? (m[1] === "inf" ? Infinity : parseFloat(m[1])) : NaN;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help) { log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 19).map((l) => l.replace(/^\/\/ ?/, "")).join("\n")); return; }
  if (a.new) return scaffold(a.new, a.from);

  const dir = resolve(a._[0] || ".");
  if (!existsSync(dir) || !statSync(dir).isDirectory()) die(`slide dir not found: ${dir}`);
  const s = sync(dir, { duration: a.duration, guides: a.guides });
  if (a.sync) return;
  if (!a.out) die(`--out <file.mp4> is required (or use --sync)`);
  if (s.unsupported.length) die(`not rendered: flpt-tween can't make ${s.unsupported.length === 1 ? "that move" : "those moves"} (✗ above)`, 2); // FLPT_GSAP_FREE_V1

  const out = resolve(a.out);
  mkdirSync(dirname(out), { recursive: true });
  const hf = `hyperframes@${a.hf || process.env.HYPERFRAMES_VERSION || DEFAULT_HF}`;
  const quality = a.quality || "delivery";

  if (a.check) {
    log(`· hyperframes check`);
    const c = hfRun(hf, ["check"], { cwd: dir }); // FLPT patch: hfRun
    if (c.status !== 0) die(`hyperframes check reported problems (see above)`);
  }

  log(`· rendering with ${hf} (quality ${quality}) → ${out}`);
  const t0 = Date.now();
  if (s.tween) flptTweenLog = ""; // FLPT_GSAP_FREE_V1: HyperFrames' log is kept, to read what flpt-tween reported on the page
  if (process.env.FLPT_HYPERFRAMES) flptTweenLog = ""; // FLPT_READY_V1: kept for every slide, to read whether its deferred build failed
  const r = hfRun(hf, ["render", ".", "--fps", String(FPS), "--quality", quality, "--output", out, "--strict"], { cwd: dir }); // FLPT patch: hfRun
  const flptReadyFailed = flptTweenLog === null ? [] : [...new Set([...flptTweenLog.matchAll(/FlptReadyBuildFailed: ([^\n]*)/g)].map((m) => m[1].trim()))]; // FLPT_READY_V1
  if (flptReadyFailed.length) {
    flptTweenLog = null;
    rmSync(out, { force: true });
    flptReadyFailed.forEach((w) => log(`✗ FlptReadyBuildFailed: ${w}`));
    die(`not rendered: the slide's engine failed when it built after its fonts (✗ above)`, 2);
  }
  const secs = (Date.now() - t0) / 1000;
  const onPage = flptTweenLog === null ? [] : flptTweenErrors(flptTweenLog); // FLPT_GSAP_FREE_V1
  flptTweenLog = null;
  if (onPage.length) {
    rmSync(out, { force: true });
    onPage.forEach((w) => log(`✗ FlptTweenUnsupported: ${w}`));
    die(`not rendered: the page stopped on what flpt-tween doesn't do (✗ above)`, 2);
  }
  if (r.status !== 0 || !existsSync(out)) die(`render failed (exit ${r.status})`);

  // Verify the file is exactly what the pipeline expects.
  const info = ffprobe(out);
  const v = info.streams.find((x) => x.codec_type === "video") || {};
  const hasAudio = info.streams.some((x) => x.codec_type === "audio");
  const dur = parseFloat(info.format.duration);
  const nb = parseInt(v.nb_frames || "0", 10);
  const issues = [];
  if (v.width !== W || v.height !== H) issues.push(`size ${v.width}x${v.height} (want ${W}x${H})`);
  if (v.r_frame_rate !== `${FPS}/1`) issues.push(`fps ${v.r_frame_rate} (want ${FPS}/1)`);
  if (Math.abs(nb - s.frames) > 1) issues.push(`${nb} frames (want ${s.frames})`);
  if (Math.abs(dur - s.duration) > 1.5 / FPS) issues.push(`duration ${dur}s (want ${s.duration}s)`);

  const summary = {
    out, seconds: +dur.toFixed(3), frames: nb, size_mb: +(statSync(out).size / 1e6).toFixed(2),
    codec: v.codec_name, pix_fmt: v.pix_fmt, fps: v.r_frame_rate, audio: hasAudio, render_seconds: +secs.toFixed(1),
    guides: !!a.guides,
  };

  if (a["check-frames"] || a["frames-at"]) {
    const fdir = resolve(a["check-frames"] || join(dirname(out), "check-frames"));
    mkdirSync(fdir, { recursive: true });
    const stem = out.replace(/^.*[\\/]/, "").replace(/\.mp4$/i, "");
    const times = a["frames-at"] ? String(a["frames-at"]).split(",").map(Number) : [0.2, 0.45, 0.7].map((f) => +(s.duration * f).toFixed(2));
    const pngs = times.map((t) => frameAt(out, Math.min(t, s.duration - 1 / FPS), join(fdir, `${stem}_t${t.toFixed(2)}.png`)));
    const lastPng = lastFrame(out, join(fdir, `${stem}_last.png`));
    pngs.push(lastPng);
    const holdPng = frameAt(out, Math.max(0, s.duration - s.hold + 0.1), join(fdir, `${stem}_holdstart.png`));
    const p = psnr(holdPng, lastPng);
    summary.check_frames = pngs;
    summary.hold_psnr_db = Number.isFinite(p) ? +p.toFixed(1) : "inf";
    if (Number.isFinite(p) && p < 45) issues.push(`last ${s.hold}s is not still (PSNR ${p.toFixed(1)} dB between ${s.duration - s.hold + 0.1}s and the last frame)`);
  }
  if (a.guides) issues.push("rendered WITH guides — re-render without --guides before handing it to the pipeline");

  log(JSON.stringify(summary, null, 2));
  if (issues.length) { issues.forEach((i) => log(`✗ ${i}`)); process.exit(2); }
  log(`✓ ${out} — ${W}x${H} ${FPS}fps, ${nb} frames, ${summary.size_mb} MB, rendered in ${secs.toFixed(1)}s`);
}

main();
