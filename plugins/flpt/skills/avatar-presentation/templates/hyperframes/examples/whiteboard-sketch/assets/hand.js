/* hand.js — makes clean SVG paths look hand-drawn. Deterministic, runs once at load, before the engine.
 *
 * Two helpers, both keep ONE subpath per path (so `draw` still works):
 *
 *   data-arrow="18"   appends an arrowhead (barb, tip, barb) to the END of a path, from its end tangent:
 *                     "M a L tip L barb1 L tip L barb2" without doing the maths. Size = barb length in px.
 *   data-wobble="2"   hand wobble (below).
 *
 * Author clean-ish geometry, then let this add the hand:
 *
 *     <g id="chest" data-wobble="2.2"> <path d="M 10 60 C 10 10 …"/> … </g>
 *     <path id="road" data-wobble="3" data-seed="road" d="…"/>
 *
 * Every <path> on or under an element with data-wobble is resampled every ~4 px and displaced by a
 * smooth, seeded noise field (amplitude = data-wobble px; data-wave = wavelength, default 140 px),
 * plus a gentler along-the-stroke tremor, so long lines bow a little, circles go slightly egg-shaped
 * and closed shapes don't quite close. Same seed -> same wobble on every render (no Math.random).
 * The result is still ONE subpath per path, so `draw` keeps working. Call it BEFORE LiveSlide.build
 * (the engine measures path lengths at build time):
 *
 *     Hand.apply(document.getElementById("slide"));
 *     window.__timelines["slide"] = LiveSlide.build(window.__SLIDE__);
 *
 * Opt a path out with data-wobble="0" (tiny details such as eyes and sparkles look better crisp).
 * Only single-subpath paths are wobbled; a path with a second "M" is left alone (and warned about).
 */
(function () {
  "use strict";

  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Smooth 2-D displacement field: a few seeded plane waves per axis, normalised to about [-1, 1].
  function field(seed, wave) {
    var r = rng(seed);
    function waves() {
      var out = [];
      var amps = [1, 0.55, 0.3];
      for (var i = 0; i < 3; i++) {
        var th = r() * Math.PI * 2;
        var k = ((Math.PI * 2) / wave) * (1 + i * 0.9 + r() * 0.4);
        out.push({ kx: Math.cos(th) * k, ky: Math.sin(th) * k, ph: r() * Math.PI * 2, a: amps[i] });
      }
      return out;
    }
    var wx = waves();
    var wy = waves();
    var norm = 1 / 1.85;
    function sum(ws, x, y) {
      var s = 0;
      for (var i = 0; i < ws.length; i++) s += ws[i].a * Math.sin(ws[i].kx * x + ws[i].ky * y + ws[i].ph);
      return s * norm;
    }
    return function (x, y) {
      return [sum(wx, x, y), sum(wy, x, y)];
    };
  }

  // fieldSeed is shared by every path of one doodle, so strokes that meet stay joined;
  // pathSeed only drives the small along-the-stroke tremor.
  function wobblePath(p, amp, wave, fieldSeed, pathSeed) {
    var d = p.getAttribute("d") || "";
    if ((d.match(/[Mm]/g) || []).length > 1) {
      if (window.console) console.warn("[wobble] " + (p.id || "path") + " has several subpaths; left as is");
      return;
    }
    var L = p.getTotalLength ? p.getTotalLength() : 0;
    if (!(L > 1)) return;
    var f = field(fieldSeed, wave);
    var r = rng(pathSeed ^ 0x9e3779b9);
    var tPh = r() * Math.PI * 2;
    var tWave = wave * (0.45 + r() * 0.2);
    var n = Math.max(2, Math.ceil(L / 4));
    var out = [];
    for (var i = 0; i <= n; i++) {
      var s = (L * i) / n;
      var pt = p.getPointAtLength(s);
      var v = f(pt.x, pt.y);
      // along-the-stroke tremor (so a closed shape's two ends don't land on the same spot)
      var tr = Math.sin((s / tWave) * Math.PI * 2 + tPh) * 0.35;
      out.push((pt.x + amp * (v[0] + tr)).toFixed(1) + " " + (pt.y + amp * (v[1] - tr)).toFixed(1));
    }
    p.setAttribute("d", "M " + out.join(" L "));
    p.setAttribute("data-wobbled", "1");
  }

  // Arrowhead from the end tangent, appended to the same subpath (tip -> barb -> tip -> barb).
  function arrowPath(p, size) {
    var L = p.getTotalLength ? p.getTotalLength() : 0;
    if (!(L > 2)) return;
    var end = p.getPointAtLength(L);
    var back = p.getPointAtLength(Math.max(0, L - Math.min(18, L / 3)));
    var ang = Math.atan2(end.y - back.y, end.x - back.x);
    var spread = (parseFloat(p.getAttribute("data-arrow-angle")) || 32) * Math.PI / 180;
    function barb(sign) {
      var a = ang + Math.PI + sign * spread;
      return (end.x + Math.cos(a) * size).toFixed(1) + " " + (end.y + Math.sin(a) * size).toFixed(1);
    }
    var tip = end.x.toFixed(1) + " " + end.y.toFixed(1);
    p.setAttribute("d", (p.getAttribute("d") || "") + " L " + barb(1) + " L " + tip + " L " + barb(-1));
  }

  function apply(root) {
    root = root || document;
    var arrows = root.querySelectorAll("path[data-arrow]");
    for (var k = 0; k < arrows.length; k++) {
      if (arrows[k].getAttribute("data-arrowed")) continue;
      arrowPath(arrows[k], parseFloat(arrows[k].getAttribute("data-arrow")) || 18);
      arrows[k].setAttribute("data-arrowed", "1");
    }
    var hosts = root.querySelectorAll("[data-wobble]");
    for (var h = 0; h < hosts.length; h++) {
      var host = hosts[h];
      var amp = parseFloat(host.getAttribute("data-wobble"));
      if (!(amp > 0)) continue;
      var wave = parseFloat(host.getAttribute("data-wave")) || 140;
      var base = host.getAttribute("data-seed") || host.id || "wb" + h;
      var paths = host.tagName.toLowerCase() === "path" ? [host] : host.querySelectorAll("path");
      for (var i = 0; i < paths.length; i++) {
        var p = paths[i];
        if (p.getAttribute("data-wobbled")) continue;
        // the nearest data-wobble wins, so a detail can opt out with data-wobble="0"
        var own = p.closest("[data-wobble]");
        if (own !== host) continue;
        wobblePath(p, amp, wave, hash(base), hash(base + ":" + (p.id || i)));
      }
    }
  }

  window.Hand = { apply: apply };
})();
