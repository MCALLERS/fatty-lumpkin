/*!
 * flpt-tween 1.2.2 · the Fatty Lumpkin Presentation Tool's own seekable tween engine. © 2026 Bombadillo AI.
 *
 * The moving slides (the method's beat engine, live-slide.js, and its starters) were written against GSAP's timeline API.
 * FLPT ships this instead: the part of that API they call, exposed as window.gsap, so they run unchanged. Anything else
 * throws a FlptTweenUnsupported error that names it. A move it can't make (a tween's vars or ease, a position, a seek) is
 * also reported where it's asked for, whoever catches the throw, as is any other such error the page doesn't catch:
 * listed in window.__flptTweenErrors, logged with console.error ("FlptTweenUnsupported: …") and shown across the bottom
 * of the page, so neither a render (render.mjs reads HyperFrames' log) nor a still can miss it. check(vars) runs the same
 * checks on a tween's vars outside a page (render.mjs checks every beat with it).
 *
 * Where each part comes from:
 *   - the timeline, its positions, seeking and callbacks: FLPT's own design (README.md: "How a seek works"), its times
 *     held in whole flicks (1/705,600,000 s, the unit Oculus published for frame-exact time);
 *   - the easing curves: Robert Penner's easing equations (BSD License, the notice below), each family's easeIn, easeOut
 *     and easeInOut written out as he wrote them, and CSS Easing Level 1's steps;
 *   - colours: the browser's own CSS parser (a canvas reads any CSS colour), mixed premultiplied by alpha as CSS Color
 *     Level 4 specifies; outside a browser, hex, rgb() and transparent only;
 *   - transforms: CSS Transforms Level 1's matrices, composed and taken apart with FLPT's own matrix code and written
 *     as one translate() and one matrix(); the share of an element's box in its own CSS translate (such as
 *     translate(-50%, -50%)) is read from CSS Typed OM; transform-origin is read by CSS's own grammar;
 *   - numbers written to CSS: six decimals, as CSSOM serializes a <number>.
 * GSAP's behaviour was the reference the moving slides were compared against, as a black box (whole renders of every
 * fixture, app/qa/flpt-tween.mjs).
 *
 * The subset (engine/runtime/flpt-tween/README.md has the detail):
 *   gsap.timeline({ paused, defaults: { duration, ease } }); tl.to / from / fromTo / set (targets, vars, position);
 *   tl.call(fn, params, position); tl.add(tween | timeline | fn | [...], position); tl.remove(child);
 *   gsap.to / from / fromTo / set outside a timeline (set renders at once; the others wait for tl.add);
 *   positions: seconds, "+=n" / "-=n" (after / before the end), "<" / ">" (the last child's start / end), "<+=n";
 *   vars: duration, delay, ease, stagger (number, { each | amount, from } or a function), immediateRender, onStart,
 *         onUpdate, onComplete, onReverseComplete (and their Params), callbackScope, id, data, overwrite: false;
 *   properties: CSS properties (numbers with units, colours, strings with numbers such as clip-path insets), CSS
 *         custom properties (--name), transforms (x, y, xPercent, yPercent, rotation, skewX, skewY, scale, scaleX,
 *         scaleY, transformOrigin, svgOrigin, force3D, smoothOrigin), autoAlpha, attr: {...}, css: {...}, and the
 *         numbers (or strings with numbers) of plain objects;
 *   values: numbers, strings with units, "+=" / "-=" / "*=", function-based values (i, target, targets);
 *   eases: none, linear, power0-4 (quad, cubic, quart, quint, strong), sine, expo, circ, back(overshoot),
 *         elastic(amplitude, period), bounce, steps(n), each with .in / .out / .inOut, the older Power2.easeOut
 *         names, functions, and eases added with gsap.registerEase.
 *
 * Easing equations: TERMS OF USE - EASING EQUATIONS. Open source under the BSD License.
 * Copyright © 2001 Robert Penner. All rights reserved.
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the
 * following conditions are met:
 *   * Redistributions of source code must retain the above copyright notice, this list of conditions and the following
 *     disclaimer.
 *   * Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the
 *     following disclaimer in the documentation and/or other materials provided with the distribution.
 *   * Neither the name of the author nor the names of contributors may be used to endorse or promote products derived
 *     from this software without specific prior written permission.
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES,
 * INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
 * WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
(function (root) {
  'use strict';

  var VERSION = '1.2.2';
  var DEG = Math.PI / 180;
  var RAD = 180 / Math.PI;

  /** The error anything outside the subset throws: its name is FlptTweenUnsupported, its `what` says what. */
  function FlptTweenUnsupported(what) {
    var message = what + ' is outside flpt-tween\'s subset (FLPT\'s moving slides run on flpt-tween, not GSAP: engine/runtime/flpt-tween/README.md)';
    this.name = 'FlptTweenUnsupported';
    this.message = message;
    this.what = what;
    this.stack = new Error(message).stack;
  }
  FlptTweenUnsupported.prototype = Object.create(Error.prototype);
  FlptTweenUnsupported.prototype.constructor = FlptTweenUnsupported;
  FlptTweenUnsupported.prototype.name = 'FlptTweenUnsupported';
  function unsupported(what) { return new FlptTweenUnsupported(what); }
  // by name and `what`, so an error from another copy of this file (a nested composition's) counts too
  var isOurs = function (e) { return !!e && e.name === 'FlptTweenUnsupported' && typeof e.what === 'string'; };

  var isFn = function (v) { return typeof v === 'function'; };
  var isObj = function (v) { return v !== null && typeof v === 'object'; };
  var own = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  var clamp = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };
  /** A number as CSS gets it: at most six decimals (as CSSOM serializes a <number>), and never "-0". */
  var fix = function (v) { var r = Math.round(v * 1e6) / 1e6; return r === 0 ? 0 : r; };
  /** A plain object's number: a double's 15 significant decimal digits (ISO C's DBL_DIG), so binary noise such as
   * 0.30000000000000004 never reaches a slide's own code, and never "-0". */
  var digits = function (v) { var r = Number(v.toPrecision(15)); return r === 0 ? 0 : r; };

  // ── time: whole flicks ──────────────────────────────────────────────────────────────────────────────────────────
  // A flick is 1/705,600,000 s, the unit Oculus published (github.com/OculusVR/Flicks) so that a frame at every common
  // rate (24, 25, 30, 48, 50, 60, 90, 100 and 120 fps, and the 1000/1001 rates) is a whole number of them. Every time a
  // timeline holds (a child's start, a duration, a stagger offset, the playhead) is a whole number of flicks, and so is
  // any decimal time to 1e-5 s, so sums are exact: a child placed at 16.8 + 1.35 + 0.75 s (18.900000000000002 in
  // seconds) starts on frame 567 at 30 fps, exactly. Seconds come in and go out at the edges.
  var FLICKS = 705600000;
  var flicks = function (s) { var f = Math.round(s * FLICKS); return f === 0 ? 0 : f; };
  var seconds = function (f) { return f / FLICKS; };

  // ── eases: Robert Penner's easing equations, for progress p in [0, 1] ─────────────────────────────────────────────
  // Each family's easeIn, easeOut and easeInOut are his three equations, written out with b = 0, c = 1 and d = 1 (so t is
  // p, and t /= d / 2 is 2p), his guards at the ends included.

  var LINEAR = function (p) { return p; }; // linearTween / easeNone
  var STILL = { in: LINEAR, out: LINEAR, inOut: LINEAR };
  var QUAD = {
    in: function (p) { return p * p; },
    out: function (p) { return -p * (p - 2); },
    inOut: function (p) {
      var t = 2 * p;
      if (t < 1) return (t * t) / 2;
      t -= 1;
      return -(t * (t - 2) - 1) / 2;
    },
  };
  var CUBIC = {
    in: function (p) { return p * p * p; },
    out: function (p) { var t = p - 1; return t * t * t + 1; },
    inOut: function (p) {
      var t = 2 * p;
      if (t < 1) return (t * t * t) / 2;
      t -= 2;
      return (t * t * t + 2) / 2;
    },
  };
  var QUART = {
    in: function (p) { return p * p * p * p; },
    out: function (p) { var t = p - 1; return -(t * t * t * t - 1); },
    inOut: function (p) {
      var t = 2 * p;
      if (t < 1) return (t * t * t * t) / 2;
      t -= 2;
      return -(t * t * t * t - 2) / 2;
    },
  };
  var QUINT = {
    in: function (p) { return p * p * p * p * p; },
    out: function (p) { var t = p - 1; return t * t * t * t * t + 1; },
    inOut: function (p) {
      var t = 2 * p;
      if (t < 1) return (t * t * t * t * t) / 2;
      t -= 2;
      return (t * t * t * t * t + 2) / 2;
    },
  };
  // the names the slides call them by (GSAP's documented API): power0 is linear, power1 to power4 are Quad to Quint,
  // and strong is Quint again
  var POWERS = { power0: STILL, linear: STILL, power1: QUAD, quad: QUAD, power2: CUBIC, cubic: CUBIC, power3: QUART, quart: QUART, power4: QUINT, quint: QUINT, strong: QUINT };
  var SINE = {
    in: function (p) { return 1 - Math.cos(p * (Math.PI / 2)); },
    out: function (p) { return Math.sin(p * (Math.PI / 2)); },
    inOut: function (p) { return -(Math.cos(Math.PI * p) - 1) / 2; },
  };
  var EXPO = {
    in: function (p) { return p === 0 ? 0 : Math.pow(2, 10 * (p - 1)); },
    out: function (p) { return p === 1 ? 1 : 1 - Math.pow(2, -10 * p); },
    inOut: function (p) {
      if (p === 0) return 0;
      if (p === 1) return 1;
      var t = 2 * p;
      return t < 1 ? Math.pow(2, 10 * (t - 1)) / 2 : (2 - Math.pow(2, -10 * (t - 1))) / 2;
    },
  };
  var CIRC = {
    in: function (p) { return -(Math.sqrt(1 - p * p) - 1); },
    out: function (p) { var t = p - 1; return Math.sqrt(1 - t * t); },
    inOut: function (p) {
      var t = 2 * p;
      if (t < 1) return -(Math.sqrt(1 - t * t) - 1) / 2;
      t -= 2;
      return (Math.sqrt(1 - t * t) + 1) / 2;
    },
  };
  /** back(s): his overshoot s (1.70158 by default), scaled by 1.525 for easeInOutBack as his equation does. */
  function back(s) {
    return {
      in: function (p) { return p * p * ((s + 1) * p - s); },
      out: function (p) { var t = p - 1; return t * t * ((s + 1) * t + s) + 1; },
      inOut: function (p) {
        var k = s * 1.525, t = 2 * p;
        if (t < 1) return (t * t * ((k + 1) * t - k)) / 2;
        t -= 2;
        return (t * t * ((k + 1) * t + k) + 2) / 2;
      },
    };
  }
  /**
   * elastic(a, p): his three decaying sines, each setting its own period, amplitude and shift as his equation does: the
   * period p is 0.3 when none (or 0) is given (0.3 × 1.5 in easeInOutElastic); an amplitude under 1 (or none) is 1, with
   * the shift s a quarter period; else s is p / 2π · asin(1 / a).
   */
  function elastic(args) {
    var amplitude = args.length > 0 ? args[0] : 0;
    var period = args.length > 1 ? args[1] : 0;
    return {
      in: function (t) {
        if (t === 0) return 0;
        if (t === 1) return 1;
        var p = period || 0.3, a = amplitude, s;
        if (!a || a < 1) { a = 1; s = p / 4; } else s = p / (2 * Math.PI) * Math.asin(1 / a);
        t -= 1;
        return -(a * Math.pow(2, 10 * t) * Math.sin((t - s) * (2 * Math.PI) / p));
      },
      out: function (t) {
        if (t === 0) return 0;
        if (t === 1) return 1;
        var p = period || 0.3, a = amplitude, s;
        if (!a || a < 1) { a = 1; s = p / 4; } else s = p / (2 * Math.PI) * Math.asin(1 / a);
        return a * Math.pow(2, -10 * t) * Math.sin((t - s) * (2 * Math.PI) / p) + 1;
      },
      inOut: function (t) {
        if (t === 0) return 0;
        t *= 2;
        if (t === 2) return 1;
        var p = period || 0.3 * 1.5, a = amplitude, s;
        if (!a || a < 1) { a = 1; s = p / 4; } else s = p / (2 * Math.PI) * Math.asin(1 / a);
        if (t < 1) {
          t -= 1;
          return -0.5 * (a * Math.pow(2, 10 * t) * Math.sin((t - s) * (2 * Math.PI) / p));
        }
        t -= 1;
        return a * Math.pow(2, -10 * t) * Math.sin((t - s) * (2 * Math.PI) / p) * 0.5 + 1;
      },
    };
  }
  // easeOutBounce: his four parabolic arcs, in his order
  function bounceOut(t) {
    if (t < 1 / 2.75) return 7.5625 * t * t;
    if (t < 2 / 2.75) { t -= 1.5 / 2.75; return 7.5625 * t * t + 0.75; }
    if (t < 2.5 / 2.75) { t -= 2.25 / 2.75; return 7.5625 * t * t + 0.9375; }
    t -= 2.625 / 2.75;
    return 7.5625 * t * t + 0.984375;
  }
  // easeInBounce and easeInOutBounce are his, from easeOutBounce
  function bounceIn(t) { return 1 - bounceOut(1 - t); }
  var BOUNCE = {
    in: bounceIn,
    out: bounceOut,
    inOut: function (t) { return t < 0.5 ? bounceIn(t * 2) * 0.5 : bounceOut(t * 2 - 1) * 0.5 + 0.5; },
  };
  var FAMILIES = {
    sine: function () { return SINE; },
    expo: function () { return EXPO; },
    circ: function () { return CIRC; },
    back: function (args) { return back(args.length ? args[0] : 1.70158); },
    elastic: elastic,
    bounce: function () { return BOUNCE; },
  };
  /** One family's three forms, { in, out, inOut }, or null for a name that isn't one. */
  function family(name, args) {
    if (own(POWERS, name)) return POWERS[name];
    return own(FAMILIES, name) ? FAMILIES[name](args) : null;
  }
  /** Exactly 0 at the start and 1 at the end, whatever a curve's float arithmetic gives there. */
  var pinned = function (f) { return function (p) { return p === 0 ? 0 : p === 1 ? 1 : f(p); }; };
  /**
   * steps(n): n + 1 flat levels from 0 to 1, the last reached before the end: CSS Easing Level 1's steps(n + 1,
   * jump-none), by its step easing algorithm (a seek has no direction, so the before flag is never set).
   */
  function steps(n) {
    var count = Math.max(1, Math.round(n) || 1) + 1;
    var jumps = count - 1; // jump-none
    return function (p) {
      var step = Math.floor(p * count);
      if (p >= 0 && step < 0) step = 0;
      if (p <= 1 && step > jumps) step = jumps;
      return step / jumps;
    };
  }
  var FORMS = { in: 'in', out: 'out', inout: 'inOut', easein: 'in', easeout: 'out', easeinout: 'inOut' };
  var EASE_NAME = /^([a-z][a-z0-9]*)(?:\.([a-z]+))?(?:\.config)?(?:\(([^)]*)\))?$/i;

  /** A parser for ease names, with the page's registered eases and its default. */
  function easeParser(registered, fallback) {
    return function parse(e) {
      if (isFn(e)) return e;
      if (e === undefined || e === null || e === '') return parse(fallback());
      var text = String(e).trim();
      if (own(registered, text)) return registered[text];
      var m = EASE_NAME.exec(text);
      if (!m) throw unsupported('the ease "' + text + '"');
      var args = m[3] === undefined ? [] : m[3].split(',').map(function (x) { return x.trim(); }).filter(Boolean).map(Number);
      if (args.some(isNaN)) throw unsupported('the ease "' + text + '"');
      var name = m[1].toLowerCase();
      var formName = m[2] ? m[2].toLowerCase() : '';
      if (!formName && own(registered, m[1])) {
        // a registered ease is one function: it takes no settings (gsap.registerEase(name, ease) in GSAP's documentation)
        if (args.length) throw unsupported('the ease "' + text + '" (a registered ease takes no settings)');
        return registered[m[1]];
      }
      if (name === 'none' || formName === 'easenone') return LINEAR;
      var form = formName ? FORMS[formName] : 'out';
      if (!form) throw unsupported('the ease "' + text + '"');
      if (name === 'steps') {
        if (args.length > 1) throw unsupported('the ease "' + text + '" (steps takes one number)');
        return steps(args.length ? args[0] : 1);
      }
      var f = family(name, args);
      if (!f) throw unsupported('the ease "' + text + '"');
      return pinned(f[form]);
    };
  }

  // ── values ──────────────────────────────────────────────────────────────────────────────────────────────────

  var NUMBER = '[-+]?(?:\\d*\\.)?\\d+(?:e[-+]?\\d+)?';
  var WITH_UNIT = new RegExp('^(' + NUMBER + ')([a-z%]*)$', 'i');
  var RELATIVE = new RegExp('^([-+*])=\\s*(' + NUMBER + ')([a-z%]*)$', 'i');

  /** "12.5px" → { n: 12.5, u: 'px' }; a number → { n, u: '' }; anything else → null. */
  function numUnit(v) {
    if (typeof v === 'number') return isFinite(v) ? { n: v, u: '' } : null;
    if (typeof v !== 'string') return null;
    var m = WITH_UNIT.exec(v.trim());
    return m ? { n: parseFloat(m[1]), u: m[2] } : null;
  }
  /** A relative value ("+=10", "-=5px", "*=2"): { op, n, u }, else null. */
  function relative(v) {
    if (typeof v !== 'string') return null;
    var m = RELATIVE.exec(v.trim());
    return m ? { op: m[1], n: parseFloat(m[2]), u: m[3] } : null;
  }
  var COMBINE = { '+': function (a, n) { return a + n; }, '-': function (a, n) { return a - n; }, '*': function (a, n) { return a * n; } };
  var applyRelative = function (rel, start) { return COMBINE[rel.op](start, rel.n); };

  // transform components and the units each takes (anything else is outside the subset rather than read wrong)
  var ANGLE = { '': 1, deg: 1, rad: RAD, turn: 360 };
  var ANGLES = { rotation: 1, skewX: 1, skewY: 1 };
  /** A transform component's value in px, degrees, a percentage or a scale; `size` is the box for x / y in %. */
  function transformNumber(key, v, size) {
    var nu = numUnit(v);
    if (!nu) throw unsupported(key + ': ' + JSON.stringify(v));
    var u = nu.u.toLowerCase();
    if (own(ANGLES, key)) {
      if (!own(ANGLE, u)) throw unsupported('the unit "' + u + '" on ' + key);
      return nu.n * ANGLE[u];
    }
    if (key === 'x' || key === 'y') {
      if (u === '' || u === 'px') return nu.n;
      if (u === '%') return size ? (nu.n / 100) * size : 0;
      throw unsupported('the unit "' + u + '" on ' + key);
    }
    if (u !== '' && !((key === 'xPercent' || key === 'yPercent') && u === '%')) throw unsupported('the unit "' + u + '" on ' + key);
    return nu.n;
  }
  /** A transform value as written: a number with a unit it takes, or a relative one; throws one that isn't. */
  function checkTransformValue(key, v) {
    if (isFn(v) || (typeof v === 'string' && v.indexOf('var(') >= 0)) return; // resolved later, on the page
    var rel = relative(v);
    transformNumber(key, rel ? rel.n + rel.u : v);
  }

  // ── colours ─────────────────────────────────────────────────────────────────────────────────────────────────
  // A colour is [r, g, b, a]: channels 0-255, alpha 0-1.

  /** hex, rgb() / rgba() and transparent, as written or as a browser writes them back: [r, g, b, a] or null. */
  function readColor(text) {
    var s = String(text).trim().toLowerCase();
    if (s === 'transparent') return [0, 0, 0, 0];
    var hex = /^#([0-9a-f]+)$/.exec(s);
    if (hex) {
      var h = hex[1];
      if (h.length === 3 || h.length === 4) h = h.replace(/./g, function (c) { return c + c; });
      if (h.length !== 6 && h.length !== 8) return null;
      var byte = function (i) { return parseInt(h.slice(2 * i, 2 * i + 2), 16); };
      return [byte(0), byte(1), byte(2), h.length === 8 ? byte(3) / 255 : 1];
    }
    var fn = /^rgba?\(([^)]*)\)$/.exec(s);
    if (!fn) return null;
    var parts = fn[1].trim().split(/\s*[,/]\s*|\s+/);
    if (parts.length !== 3 && parts.length !== 4) return null;
    var value = function (x, scale) { var n = parseFloat(x); return /%$/.test(x) ? (n / 100) * scale : n; };
    var c = [value(parts[0], 255), value(parts[1], 255), value(parts[2], 255), parts.length === 4 ? value(parts[3], 1) : 1];
    return c.some(isNaN) ? null : c;
  }
  /** Two colours mixed at t, premultiplied by alpha (CSS Color Level 4), so a fade from transparent never greys. */
  function mixColor(from, to, t) {
    var a0 = clamp(from[3], 0, 1), a1 = clamp(to[3], 0, 1);
    var alpha = clamp(a0 + (a1 - a0) * t, 0, 1);
    var out = [];
    for (var i = 0; i < 3; i++) {
      var v = alpha ? (from[i] * a0 + (to[i] * a1 - from[i] * a0) * t) / alpha : from[i] + (to[i] - from[i]) * t;
      out.push(Math.round(clamp(v, 0, 255)));
    }
    return 'rgba(' + out[0] + ', ' + out[1] + ', ' + out[2] + ', ' + fix(alpha) + ')';
  }

  // ── transforms: 2D affine matrices [a, b, c, d, e, f], as CSS and SVG write them (x' = a·x + c·y + e) ─────────────

  var IDENTITY = [1, 0, 0, 1, 0, 0];
  function multiply(m, n) {
    return [
      m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
    ];
  }
  var translation = function (x, y) { return [1, 0, 0, 1, x, y]; };
  var applyTo = function (m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; };
  /** rotate(rotation) skew(skewX, skewY) scale(scaleX, scaleY), as one matrix (no translation). */
  function linearPart(c) {
    var r = c.rotation * DEG;
    var rotate = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
    var skew = [1, Math.tan(c.skewY * DEG), Math.tan(c.skewX * DEG), 1, 0, 0];
    return multiply(multiply(rotate, skew), [c.scaleX, 0, 0, c.scaleY, 0, 0]);
  }
  /** A matrix's 2×2 part as rotation, skewX, scaleX and scaleY (rotate · skewX · scale; skewY 0). */
  function takeApart(m) {
    var scaleX = Math.sqrt(m[0] * m[0] + m[1] * m[1]);
    var angle = scaleX ? Math.atan2(m[1], m[0]) : 0;
    var cos = Math.cos(angle), sin = Math.sin(angle);
    // turned back by the angle, the second column is (scaleY · tan(skewX), scaleY)
    var slant = m[2] * cos + m[3] * sin, scaleY = m[3] * cos - m[2] * sin;
    return { rotation: fix(angle * RAD), skewX: scaleY ? fix(Math.atan(slant / scaleY) * RAD) : 0, skewY: 0, scaleX: fix(scaleX), scaleY: fix(scaleY) };
  }
  /** "matrix(…)" or "matrix3d(…)" (its 2D part) as [a, b, c, d, e, f]; null for "none" or anything else. */
  function readMatrix(text) {
    var m = /^matrix(3d)?\(([^)]*)\)$/.exec(String(text || '').trim());
    if (!m) return null;
    var n = m[2].split(',').map(parseFloat);
    return m[1] ? [n[0], n[1], n[4], n[5], n[12], n[13]] : n.slice(0, 6);
  }
  /**
   * A transform-origin ("50% 100%", "left top", "bottom", "10px 20px") as px in a w × h box, read by CSS Transforms 1's
   * grammar: left and right place the horizontal position and top and bottom the vertical, in either order; center and
   * lengths take the positions still open, horizontal first; an open position is center. A keyword is its CSS
   * percentage (left and top 0%, center 50%, right and bottom 100%); the third (z) value is 3D and isn't read.
   */
  var ORIGIN_KEYWORD = { left: 0, top: 0, center: 50, right: 100, bottom: 100 };
  function originIn(text, w, h) {
    var across = null, down = null, open = [];
    String(text).trim().split(/\s+/).forEach(function (part) {
      if (part === 'left' || part === 'right') across = part;
      else if (part === 'top' || part === 'bottom') down = part;
      else open.push(part);
    });
    open.forEach(function (part) { if (across === null) across = part; else if (down === null) down = part; });
    var px = function (part, size) {
      if (part === null || part === '') part = 'center';
      if (own(ORIGIN_KEYWORD, part)) return (ORIGIN_KEYWORD[part] / 100) * size;
      var n = parseFloat(part);
      return isNaN(n) ? 0 : /%$/.test(part) ? (n / 100) * size : n;
    };
    return [px(across, w), px(down, h)];
  }

  // ── what a tween's vars ask for ─────────────────────────────────────────────────────────────────────────────

  // the component each 2D transform name moves (rotate, rotateZ and rotationZ are rotation's other names)
  var TRANSFORMS = { rotate: 'rotation', rotateZ: 'rotation', rotation: 'rotation', rotationZ: 'rotation', scaleX: 'scaleX', scaleY: 'scaleY',
    skewX: 'skewX', skewY: 'skewY', x: 'x', xPercent: 'xPercent', y: 'y', yPercent: 'yPercent' };
  var TRANSFORM_SETTINGS = { force3D: 1, smoothOrigin: 1, svgOrigin: 1, transformOrigin: 1 };
  var NOT_2D = { z: 1, rotationX: 1, rotationY: 1, rotateX: 1, rotateY: 1, transformPerspective: 1, perspective: 1, transform: 1, translate: 1 };
  var CONTROL = {
    duration: 1, delay: 1, ease: 1, stagger: 1, immediateRender: 1, overwrite: 1, lazy: 1, id: 1, data: 1, callbackScope: 1,
    onStart: 1, onStartParams: 1, onUpdate: 1, onUpdateParams: 1, onComplete: 1, onCompleteParams: 1,
    onReverseComplete: 1, onReverseCompleteParams: 1, repeat: 1, yoyo: 1, repeatDelay: 1, paused: 1, startAt: 1, inherit: 1,
  };
  var PLUGIN_PROPS = { motionPath: 1, morphSVG: 1, drawSVG: 1, text: 1, scrambleText: 1, scrollTo: 1, scrollTrigger: 1, pixi: 1, physics2D: 1,
    physicsProps: 1, inertia: 1, keyframes: 1, snap: 1, modifiers: 1, clearProps: 1, roundProps: 1, splitText: 1, flip: 1, easel: 1, endArray: 1, runBackwards: 1 };
  var camel = function (p) { return p.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); }); };

  function checkControl(vars) {
    if (vars.repeat) throw unsupported('repeat');
    if (vars.yoyo) throw unsupported('yoyo');
    if (vars.repeatDelay) throw unsupported('repeatDelay');
    if (vars.paused) throw unsupported('a paused tween');
    if (vars.overwrite !== undefined && vars.overwrite !== false && vars.overwrite !== 'none') throw unsupported('overwrite: ' + JSON.stringify(vars.overwrite));
  }

  /**
   * A tween's vars for one target as property specs { kind: css | var | tf | tfset | attr | plain, key, value, autoAlpha? }.
   * `dom`: the target is an element; `hasStyle(name)`: whether its style has a property (null: not known, as in check()).
   */
  function specsOf(vars, dom, hasStyle, plugins) {
    var out = [];
    Object.keys(vars).forEach(function (key) {
      if (own(CONTROL, key)) return;
      var v = vars[key];
      if (own(PLUGIN_PROPS, key) || own(plugins, key)) throw unsupported('the "' + key + '" property');
      if (!dom) { out.push({ kind: 'plain', key: key, value: v }); return; }
      if (key === 'css' || key === 'attr') {
        if (!isObj(v)) throw unsupported(key + ': ' + typeof v);
        if (key === 'css') specsOf(v, dom, hasStyle, plugins).forEach(function (s) { out.push(s); });
        else Object.keys(v).forEach(function (name) { out.push({ kind: 'attr', key: name, value: v[name] }); });
        return;
      }
      if (own(NOT_2D, key)) throw unsupported('the "' + key + '" property');
      if (key === 'scale') {
        checkTransformValue('scaleX', v);
        out.push({ kind: 'tf', key: 'scaleX', value: v }, { kind: 'tf', key: 'scaleY', value: v });
        return;
      }
      if (own(TRANSFORMS, key)) { checkTransformValue(TRANSFORMS[key], v); out.push({ kind: 'tf', key: TRANSFORMS[key], value: v }); return; }
      if (own(TRANSFORM_SETTINGS, key)) { out.push({ kind: 'tfset', key: key, value: v }); return; }
      if (key === 'autoAlpha') { out.push({ kind: 'css', key: 'opacity', value: v, autoAlpha: true }); return; }
      if (key.slice(0, 2) === '--') { out.push({ kind: 'var', key: key, value: v }); return; }
      var name = key.indexOf('-') > 0 ? camel(key) : key;
      if (!hasStyle || hasStyle(name)) { out.push({ kind: 'css', key: name, value: v }); return; }
      throw unsupported('the "' + key + '" property');
    });
    // settings (an origin) go before the components they apply to
    return out.filter(function (s) { return s.kind === 'tfset'; }).concat(out.filter(function (s) { return s.kind !== 'tfset'; }));
  }

  /** stagger as each target's offset in seconds. */
  function staggerOffsets(st, targets) {
    var n = targets.length;
    if (typeof st === 'number') return targets.map(function (_, i) { return i * st; });
    if (isFn(st)) return targets.map(function (t, i) { return Number(st(i, t, targets)) || 0; });
    if (!isObj(st)) throw unsupported('stagger ' + JSON.stringify(st));
    Object.keys(st).forEach(function (k) { if (['each', 'amount', 'from'].indexOf(k) < 0) throw unsupported('stagger.' + k); });
    var from = st.from === undefined ? 'start' : st.from, middle = (n - 1) / 2;
    var distance = targets.map(function (_, i) {
      if (from === 'start' || from === 0) return i;
      if (from === 'end') return n - 1 - i;
      if (from === 'center') return Math.abs(i - middle);
      if (from === 'edges') return middle - Math.abs(i - middle);
      if (typeof from === 'number') return Math.abs(i - from);
      throw unsupported('stagger.from ' + JSON.stringify(from));
    });
    var nearest = Math.min.apply(null, distance), span = Math.max.apply(null, distance) - nearest || 1;
    var each = st.amount !== undefined ? Number(st.amount) / span : Number(st.each) || 0;
    return distance.map(function (d) { return (d - nearest) * each; });
  }

  var checkParse = easeParser({}, function () { return 'power1.out'; });
  /**
   * What a tween's vars ask for that flpt-tween doesn't do, without a page: a list of what (empty when it's all inside the
   * subset). The vars are taken as an element's (CSS property names are only checked on the page). render.mjs runs it on
   * every beat's `to` vars and eases before a render.
   */
  function check(vars) {
    var found = [];
    var probe = function (fn) { try { fn(); } catch (e) { if (isOurs(e)) found.push(e.what); else throw e; } };
    if (!isObj(vars)) { probe(function () { throw unsupported('tween vars of type ' + typeof vars); }); return found; }
    probe(function () { checkControl(vars); });
    if (vars.ease !== undefined) probe(function () { checkParse(vars.ease); });
    if (vars.stagger !== undefined && vars.stagger !== null && vars.stagger !== 0) probe(function () { staggerOffsets(vars.stagger, [null, null]); });
    Object.keys(vars).forEach(function (key) {
      if (own(CONTROL, key)) return;
      var one = {};
      one[key] = vars[key];
      probe(function () { specsOf(one, true, null, {}); });
    });
    return found;
  }

  // ── the library, bound to one window ─────────────────────────────────────────────────────────────────────────

  function create(win) {
    win = win || {};
    var doc = win.document || null;
    var seq = 0; // numbers, in order: creations (immediate renders), placings (ties at one position) and timeline changes
    var registeredEases = {};
    var plugins = {};
    var globalDefaults = { duration: 0.5, ease: 'power1.out' };
    var warn = function (m) { if (win.console && win.console.warn) win.console.warn('[flpt-tween] ' + m); };
    var parseEase = easeParser(registeredEases, function () { return globalDefaults.ease; });

    // ── errors that would otherwise go unseen ──
    var reported = [];
    var banner = null;
    /** List an error, log it and show it on the page: once each. */
    function report(e) {
      if (!isOurs(e) || reported.indexOf(e.what) >= 0) return;
      reported.push(e.what);
      (win.__flptTweenErrors = win.__flptTweenErrors || []).push(e.what);
      if (win.console && win.console.error) win.console.error('FlptTweenUnsupported: ' + e.what);
      var host = doc && (doc.body || doc.documentElement);
      if (!host || !doc.createElement) return;
      if (!banner) {
        banner = doc.createElement('div');
        banner.setAttribute('data-flpt-tween-error', '');
        banner.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;padding:20px 32px;background:#b3261e;color:#fff;' +
          'font:600 26px/1.35 ui-monospace,Menlo,monospace;white-space:pre-wrap;pointer-events:none';
        host.appendChild(banner);
      }
      banner.textContent = reported.map(function (w) { return 'FlptTweenUnsupported: ' + w; }).join('\n');
    }
    // a move that can't be made is reported where it's asked for, whoever catches the throw: HyperFrames' render queues a
    // slide's to / from / fromTo / set / add calls and replays them inside its own page.evaluate, where a throw never
    // reaches the page's error event
    var reporting = function (fn) {
      return function () {
        try { return fn.apply(this, arguments); } catch (e) { report(e); throw e; }
      };
    };
    // and an error the page's own code doesn't catch (a slide's build stopping half-way, say)
    if (isFn(win.addEventListener)) win.addEventListener('error', function (event) { if (event && isOurs(event.error)) report(event.error); });

    // ── colours, through the browser's own parser when there is one ──
    var paint;
    function colorOf(text) {
      if (typeof text !== 'string' || /^\s*currentcolor\s*$/i.test(text)) return null;
      if (paint === undefined) {
        paint = null;
        try {
          if (isFn(win.OffscreenCanvas)) paint = new win.OffscreenCanvas(1, 1).getContext('2d');
          else if (doc && isFn(doc.createElement)) paint = doc.createElement('canvas').getContext('2d');
        } catch (e) { paint = null; }
      }
      if (!paint) return readColor(text);
      // a string the canvas doesn't take leaves its colour as it was: so it's a colour if two starts agree
      paint.fillStyle = '#000000';
      paint.fillStyle = text;
      var first = paint.fillStyle;
      paint.fillStyle = '#ffffff';
      paint.fillStyle = text;
      return first === paint.fillStyle ? readColor(first) : null;
    }
    var COLORISH = /color$|^fill$|^stroke$|^background$/i;
    // a string's parts: colours (hex, colour functions, names), numbers with their units, and the text between
    var PIECES = new RegExp('#[0-9a-f]{3,8}\\b|\\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\\([^)]*\\)|(' + NUMBER + ')([a-z%]*)|\\b[a-z]+\\b', 'gi');
    function pieces(text) {
      var out = { text: [], values: [] }, last = 0, m;
      PIECES.lastIndex = 0;
      while ((m = PIECES.exec(text))) {
        var value = m[1] !== undefined ? { n: parseFloat(m[1]), u: m[2] } : (function (c) { return c ? { color: c } : null; })(colorOf(m[0]));
        if (!value) continue; // a word that isn't a colour stays text
        out.text.push(text.slice(last, m.index));
        out.values.push(value);
        last = m.index + m[0].length;
      }
      out.text.push(text.slice(last));
      return out;
    }
    /** A tween between two strings with numbers or colours in them: the end's text, each value from the start's. */
    function stringTween(start, end) {
      var from = pieces(start === null || start === undefined ? '' : String(start));
      var to = pieces(String(end));
      var nums = from.values.filter(function (v) { return !v.color; }), cols = from.values.filter(function (v) { return v.color; });
      var ni = 0, ci = 0;
      var pairs = to.values.map(function (v) {
        if (v.color) { var c0 = cols[ci++]; return { color: true, a: c0 ? c0.color : [v.color[0], v.color[1], v.color[2], 0], b: v.color }; }
        var n0 = nums[ni++];
        return { a: n0 ? n0.n : 0, b: v.n, u: v.u || (n0 ? n0.u : '') };
      });
      var endText = String(end);
      return function (ratio) {
        if (ratio === 1) return endText;
        var s = to.text[0];
        for (var k = 0; k < pairs.length; k++) {
          var p = pairs[k];
          s += (p.color ? mixColor(p.a, p.b, ratio) : fix(p.a + (p.b - p.a) * ratio) + p.u) + to.text[k + 1];
        }
        return s;
      };
    }

    // ── targets ──

    var isEl = function (t) { return !!(t && t.nodeType === 1 && t.style); };
    /**
     * Whether an element is one of CSS Transforms 1's "SVG elements without associated CSS layout box", so its transform
     * is its transform attribute: the elements its user agent style sheet names in the SVG namespace, `*:not(svg),
     * *:not(foreignObject) > svg`. An <svg> that starts a fragment (in HTML, or in a foreignObject) is a CSS box.
     */
    var SVG_NS = 'http://www.w3.org/2000/svg';
    var nameOf = function (el) { return el ? String(el.localName || el.nodeName || '') : ''; };
    var isSVG = function (el) {
      if (el.namespaceURI !== SVG_NS) return false;
      if (nameOf(el) !== 'svg') return true;
      var parent = el.parentNode;
      return !!parent && parent.namespaceURI === SVG_NS && nameOf(parent) !== 'foreignObject';
    };
    var kebab = function (p) { return p.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); }); };
    var computed = function (el) { return win.getComputedStyle ? win.getComputedStyle(el) : el.style; };

    function toTargets(t) {
      if (t === null || t === undefined) return [];
      if (typeof t === 'string') {
        if (!doc) throw unsupported('a selector without a document');
        return Array.prototype.slice.call(doc.querySelectorAll(t));
      }
      if (Array.isArray(t)) return t.reduce(function (a, x) { return a.concat(toTargets(x)); }, []);
      if (isEl(t) || !isObj(t)) return [t];
      if (typeof t.length === 'number' && (isFn(t.item) || isFn(t.forEach))) return Array.prototype.slice.call(t);
      return [t];
    }
    function propSpecs(target, vars) {
      var dom = isEl(target);
      return specsOf(vars, dom, dom ? function (name) { return name in target.style; } : null, plugins);
    }
    var keyOf = function (s) { return s.kind + ':' + s.key; };

    // ── an element's transform as components ──
    // translate (x, y, and xPercent / yPercent of its own box), rotation, skewX / skewY, scaleX / scaleY, applied in that
    // order. HTML: written as its CSS transform (one translate(), then the rest as one matrix()), its origin as CSS
    // transform-origin. SVG: written as a matrix in its transform attribute, around an origin in its own coordinates (by
    // default the top-left of its box, plus any CSS transform-origin), plus a shift that keeps it still when the origin
    // moves (smoothOrigin). Both are written in 2D: force3D is taken and has nothing to do (a seek draws every frame).

    var recs = typeof WeakMap === 'function' ? new WeakMap() : null;
    var recList = [];
    function tfRec(el) {
      if (recs && recs.has(el)) return recs.get(el);
      for (var i = 0; !recs && i < recList.length; i++) if (recList[i].el === el) return recList[i];
      var rec = readTransform(el);
      if (recs) recs.set(el, rec); else recList.push(rec);
      return rec;
    }
    function bbox(el) {
      try { var b = el.getBBox(); return { x: b.x, y: b.y, width: b.width, height: b.height }; } catch (e) { return { x: 0, y: 0, width: 0, height: 0 }; }
    }
    var STATE = ['x', 'y', 'xPercent', 'yPercent', 'rotation', 'skewX', 'skewY', 'scaleX', 'scaleY', 'ox', 'oy', 'shiftX', 'shiftY', 'smoothOrigin', 'originKey', 'cssOrigin'];
    var snapshot = function (rec) { var s = {}; STATE.forEach(function (k) { s[k] = rec[k]; }); return s; };
    var inlineOf = function (el, svg) {
      return { transform: el.style.getPropertyValue('transform'), transformOrigin: el.style.getPropertyValue('transform-origin'), attr: svg ? el.getAttribute('transform') : null };
    };
    /** The share of its own box an element's CSS translate moves it by (translate(-50%, -50%) → [-50, -50]), from CSS Typed OM. */
    function boxShare(el) {
      if (!isFn(el.computedStyleMap) || !win.CSSTranslate) return null;
      try {
        var list = el.computedStyleMap().get('transform');
        var first = list && list.length ? list[0] : null;
        if (!(first instanceof win.CSSTranslate)) return null;
        var pct = function (v) { return v && v.unit === 'percent' ? v.value : 0; };
        var share = { x: pct(first.x), y: pct(first.y), alone: list.length === 1 };
        return share.x || share.y ? share : null;
      } catch (e) { return null; }
    }

    function readTransform(el) {
      var svg = isSVG(el);
      var style = computed(el);
      var m = readMatrix(style.transform);
      if (!m && svg && el.transform && el.transform.baseVal && el.transform.baseVal.numberOfItems) {
        var t = el.transform.baseVal.consolidate();
        if (t) m = [t.matrix.a, t.matrix.b, t.matrix.c, t.matrix.d, t.matrix.e, t.matrix.f];
      }
      m = m || IDENTITY;
      var rec = takeApart(m);
      rec.el = el;
      rec.svg = svg;
      rec.xPercent = rec.yPercent = 0;
      rec.ox = rec.oy = rec.shiftX = rec.shiftY = 0;
      rec.smoothOrigin = svg;
      rec.originKey = null;
      rec.cssOrigin = null;
      rec.inline = inlineOf(el, svg);
      var x = m[4], y = m[5];
      if (svg) {
        // an SVG origin is measured from the corner of the element's own box (the slides' API); its computed
        // transform-origin is in px, CSS Transforms 1's 0 0 when the page sets none
        var box = bbox(el), o = String(style.transformOrigin || '0 0').split(/\s+/).map(parseFloat);
        rec.ox = box.x + (o[0] || 0);
        rec.oy = box.y + (o[1] || 0);
        // x and y are how far the matrix moves the origin
        var moved = applyTo(m, rec.ox, rec.oy);
        x = moved[0] - rec.ox;
        y = moved[1] - rec.oy;
      } else {
        var share = boxShare(el);
        if (share) {
          rec.xPercent = share.x;
          rec.yPercent = share.y;
          // alone, a translate by a share leaves no px on that axis; else the share (of the box's whole px) comes out of the matrix
          x = share.alone && share.x ? 0 : x - (share.x / 100) * (el.offsetWidth || 0);
          y = share.alone && share.y ? 0 : y - (share.y / 100) * (el.offsetHeight || 0);
        }
      }
      rec.x = fix(x);
      rec.y = fix(y);
      rec.base = snapshot(rec);
      return rec;
    }

    /** The SVG matrix: translate by x, y (and xPercent / yPercent of the box) plus the shift, the rest about the origin. */
    function svgMatrix(rec) {
      var box = rec.xPercent || rec.yPercent ? bbox(rec.el) : null;
      var tx = rec.x + rec.shiftX + (box ? (rec.xPercent / 100) * box.width : 0);
      var ty = rec.y + rec.shiftY + (box ? (rec.yPercent / 100) * box.height : 0);
      return multiply(multiply(translation(tx + rec.ox, ty + rec.oy), linearPart(rec)), translation(-rec.ox, -rec.oy));
    }
    /**
     * The CSS transform of an HTML element, always the same two functions: translate() by x / y in px plus xPercent /
     * yPercent of its own box (one calc() per axis, CSS Values 4), then matrix() with the rest (linearPart: rotate · skew
     * · scale, as on SVG). CSS turns it about the element's transform-origin.
     */
    function cssTransform(rec) {
      var axis = function (px, share) { return share ? 'calc(' + fix(px) + 'px + ' + fix(share) + '%)' : fix(px) + 'px'; };
      var m = linearPart(rec);
      return 'translate(' + axis(rec.x, rec.xPercent) + ', ' + axis(rec.y, rec.yPercent) + ') matrix(' + [m[0], m[1], m[2], m[3]].map(fix).join(', ') + ', 0, 0)';
    }

    function applyTfSetting(rec, key, v) {
      if (key === 'force3D') return; // a compositing hint; flpt-tween writes 2D transforms
      if (key === 'smoothOrigin') { rec.smoothOrigin = !!v; return; }
      var id = key + ':' + v;
      if (rec.originKey === id) return;
      rec.originKey = id;
      if (!rec.svg) { rec.cssOrigin = String(v); return; }
      var o;
      if (key === 'svgOrigin') { o = String(v).trim().split(/[\s,]+/).map(parseFloat); if (o.length < 2) o.push(o[0]); }
      else { var box = bbox(rec.el), at = originIn(v, box.width, box.height); o = [box.x + at[0], box.y + at[1]]; }
      var nx = o[0] || 0, ny = o[1] || 0;
      if (rec.smoothOrigin) {
        // keep the picture where it is: the new origin's move under today's matrix, less the old one's, becomes the shift
        var m = svgMatrix(rec), before = applyTo(m, rec.ox, rec.oy), after = applyTo(m, nx, ny);
        rec.shiftX += (after[0] - nx) - (before[0] - rec.ox);
        rec.shiftY += (after[1] - ny) - (before[1] - rec.oy);
      }
      rec.ox = nx;
      rec.oy = ny;
    }

    // ── tweens ──

    function Tween(targets, vars, kind, fromVars) {
      vars = vars || {};
      if (!isObj(vars)) throw unsupported('tween vars of type ' + typeof vars);
      checkControl(vars);
      if (fromVars) { if (!isObj(fromVars)) throw unsupported('fromTo() first vars of type ' + typeof fromVars); checkControl(fromVars); }
      if (vars.startAt !== undefined && !isObj(vars.startAt)) throw unsupported('startAt of type ' + typeof vars.startAt);
      this._seq = ++seq;
      this._ins = this._seq;
      this._kind = kind; // to | from | fromTo | set | call
      this._subjects = toTargets(targets);
      if (!this._subjects.length && kind !== 'call') warn(typeof targets === 'string' ? 'nothing on the page matches ' + JSON.stringify(targets) : 'a tween with nothing to move');
      this.vars = vars;
      this._fromVars = fromVars || vars.startAt || null;
      if (vars.startAt && kind === 'to') this._kind = 'fromTo';
      this._owner = null; // the timeline it's placed in
      this._at = 0;       // where it starts on its owner's clock
      this._wait = flicks(Number(vars.delay) || 0); // times are whole flicks from here on
      this._locals = [];
      this._inited = [];
      this._resolveTiming();
      // property names and transform values are checked now, so a bad one stops the slide's build and not its render
      var self = this;
      this._subjects.forEach(function (t) {
        propSpecs(t, vars);
        if (self._fromVars) propSpecs(t, self._fromVars);
      });
    }
    var TW = Tween.prototype;
    TW._defaults = function () {
      var d = {}, chain = [], p = this._owner;
      while (p) { if (p.vars && p.vars.defaults) chain.unshift(p.vars.defaults); p = p._owner; }
      chain.forEach(function (x) { Object.keys(x).forEach(function (k) { d[k] = x[k]; }); });
      return d;
    };
    TW._resolveTiming = function () {
      var vars = this.vars, defs = this._defaults();
      var dur = this._kind === 'set' || this._kind === 'call' ? 0
        : vars.duration !== undefined ? Number(vars.duration) : defs.duration !== undefined ? Number(defs.duration) : globalDefaults.duration;
      if (!(dur >= 0)) throw unsupported('duration ' + JSON.stringify(vars.duration));
      this._run = flicks(dur); // one target's run
      this._curve = parseEase(vars.ease !== undefined ? vars.ease : defs.ease !== undefined ? defs.ease : globalDefaults.ease);
      var st = vars.stagger;
      this._offsets = this._subjects.map(function () { return 0; });
      if (st !== undefined && st !== null && st !== 0) {
        var offsets = staggerOffsets(st, this._subjects.length ? this._subjects : [null]);
        if (this._subjects.length > 1) this._offsets = offsets.map(flicks);
      }
      this._span = this._run + Math.max.apply(null, this._offsets.concat(0)); // every target's run, staggered
    };
    TW._length = function () { return this._span; };
    TW.duration = function (v) { if (v === undefined) return seconds(this._span); throw unsupported('changing a tween\'s duration'); };
    TW.totalDuration = function () { return seconds(this._span); };
    TW.startTime = function () { return seconds(this._at); };
    TW.endTime = function () { return seconds(this._at + this._span); };
    TW.targets = function () { return this._subjects.slice(); };
    TW.delay = function () { return seconds(this._wait); };
    TW.progress = function () { return this._locals.length ? Math.max.apply(null, this._locals.map(Number).filter(isFinite).concat(0)) : 0; };
    TW.isActive = function () { return false; };
    TW.paused = function (v) { if (v === undefined) return false; throw unsupported('pausing a tween'); };
    TW.kill = function () { if (this._owner) this._owner.remove(this); return this; };
    TW.invalidate = function () { if (this._owner) this._owner.invalidate(); return this; };
    // a tween's callbacks live in its vars, as the slides write them (onComplete, onCompleteParams): eventCallback reads
    // one, or replaces it and its parameters together (none given: none kept), or removes both
    TW.eventCallback = function (type, fn, params) {
      if (['onStart', 'onUpdate', 'onComplete', 'onReverseComplete'].indexOf(type) < 0) throw unsupported('eventCallback("' + type + '")');
      if (arguments.length < 2) return this.vars[type];
      var vars = this.vars, name = type + 'Params';
      [type, name].forEach(function (k) { delete vars[k]; });
      if (isFn(fn)) {
        vars[type] = fn;
        if (Array.isArray(params)) vars[name] = params;
      }
      return this;
    };
    // one leaf per target (a stagger's are its targets at their offsets), absolute times
    TW._leaves = function (abs) {
      var self = this;
      if (this._kind === 'call') return [{ tween: this, target: null, i: 0, start: abs, dur: 0 }];
      return this._subjects.map(function (t, i) { return { tween: self, target: t, i: i, start: abs + self._offsets[i], dur: self._run }; });
    };
    var immediate = function (tw) {
      return tw._kind === 'from' || tw._kind === 'fromTo' ? tw.vars.immediateRender !== false : tw._kind === 'set' && tw.vars.immediateRender === true;
    };

    // ── timelines ──

    var TL_OPTIONS = ['paused', 'defaults', 'id', 'data', 'smoothChildTiming', 'autoRemoveChildren', 'repeat', 'yoyo', 'repeatDelay', 'overwrite', 'delay',
      'onUpdate', 'onComplete', 'onStart', 'callbackScope'];
    function Timeline(vars) {
      vars = vars || {};
      if (!isObj(vars)) throw unsupported('timeline vars of type ' + typeof vars);
      Object.keys(vars).forEach(function (k) { if (TL_OPTIONS.indexOf(k) < 0 && !/Params$/.test(k)) throw unsupported('the timeline option "' + k + '"'); });
      if (vars.repeat) throw unsupported('repeat');
      if (vars.yoyo) throw unsupported('yoyo');
      if (vars.delay) throw unsupported('a delayed timeline');
      if (vars.onUpdate || vars.onComplete || vars.onStart) throw unsupported('timeline callbacks');
      if (vars.autoRemoveChildren) throw unsupported('autoRemoveChildren');
      if (vars.defaults !== undefined) {
        if (!isObj(vars.defaults)) throw unsupported('defaults of type ' + typeof vars.defaults);
        Object.keys(vars.defaults).forEach(function (k) {
          if (['duration', 'ease', 'overwrite', 'lazy', 'immediateRender'].indexOf(k) < 0) throw unsupported('defaults.' + k);
        });
        checkControl(vars.defaults);
        if (vars.defaults.ease !== undefined) parseEase(vars.defaults.ease);
      }
      this.vars = vars;
      this.data = vars.data;
      this._isTimeline = true;
      this._seq = ++seq;
      this._ins = this._seq;
      this.children = [];   // in the order they were placed
      this._owner = null;
      this._at = 0;
      this._wait = 0;
      this._paused = !!vars.paused;
      this._playhead = 0;   // seconds
      this._scale = 1;
      this._changed = this._seq;
      this._state = null;   // the recording (TL._init)
    }
    var TL = Timeline.prototype;
    TL._length = function () {
      var end = 0;
      this.children.forEach(function (c) { end = Math.max(end, c._at + c._length()); });
      return end;
    };
    // "<" and ">" are the start and end of the previous animation (GSAP's documented position syntax), here the child
    // placed last. Children are numbered as they're placed (_ins), so once that one is removed it's the latest placed
    // that's still here (none: the timeline's start), and nothing has to be kept up to date when a child leaves.
    TL._placedLast = function () {
      var out = null;
      this.children.forEach(function (c) { if (!out || c._ins > out._ins) out = c; });
      return out;
    };
    TL._position = function (pos) {
      if (pos === undefined || pos === null) return this._length();
      if (typeof pos === 'number') { if (!isFinite(pos)) throw unsupported('the position ' + pos); return flicks(pos); }
      var s = String(pos).trim();
      if (/^-?(?:\d*\.)?\d+$/.test(s)) return flicks(parseFloat(s));
      var m = /^([<>])?(?:([-+])=\s*((?:\d*\.)?\d+))?$/.exec(s);
      if (!m || (!m[1] && !m[2])) throw unsupported('the position ' + JSON.stringify(pos) + ' (labels and percentages)');
      var prev = this._placedLast();
      var base = m[1] === '<' ? (prev ? prev._at : 0) : m[1] === '>' ? (prev ? prev._at + prev._length() : 0) : this._length();
      return base + (m[2] ? (m[2] === '-' ? -1 : 1) * flicks(parseFloat(m[3])) : 0);
    };
    // A recording holds while nothing under it changes. Each change to a timeline (a child placed or removed, an
    // invalidate) takes the next number; a seek records again when a timeline in its tree has a newer one than its
    // recording (TL._render).
    TL._newest = function () {
      var n = this._changed;
      this.children.forEach(function (c) { if (c._isTimeline) n = Math.max(n, c._newest()); });
      return n;
    };
    TL._insert = function (child, pos) {
      if (child._owner) child._owner.remove(child);
      var at = this._position(pos);
      child._owner = this;
      if (!child._isTimeline) child._resolveTiming(); // its defaults come from its new owners
      child._at = Math.max(0, at + child._wait);
      child._ins = this._changed = ++seq;
      this.children.push(child);
      return this;
    };
    TL._make = function (kind, targets, vars, fromVars, pos) { return this._insert(new Tween(targets, vars, kind, fromVars), pos); };
    TL.to = reporting(function (targets, vars, position) { return this._make('to', targets, vars, null, position); });
    TL.from = reporting(function (targets, vars, position) { return this._make('from', targets, vars, null, position); });
    TL.fromTo = reporting(function (targets, fromVars, toVars, position) { return this._make('fromTo', targets, toVars, fromVars || {}, position); });
    TL.set = reporting(function (targets, vars, position) { return this._make('set', targets, vars, null, position); });
    // a call is a child of its own kind, at a time and with no length: its function runs whenever the playhead crosses
    // that time, either way (README: "How a seek works")
    TL.call = reporting(function (fn, params, position) {
      if (!isFn(fn)) throw unsupported('call() without a function');
      var c = new Tween(null, {}, 'call');
      c._callback = fn;
      c._callbackParams = params || [];
      return this._insert(c, position);
    });
    TL.add = reporting(function (child, position) {
      var self = this;
      if (Array.isArray(child)) { var at = seconds(this._position(position)); child.forEach(function (c) { self.add(c, at); }); return this; }
      if (isFn(child)) return this.call(child, [], position);
      if (child instanceof Tween || child instanceof Timeline) {
        for (var p = this; p; p = p._owner) if (p === child) throw unsupported('adding a timeline to itself');
        return this._insert(child, position);
      }
      if (typeof child === 'string') throw unsupported('labels ("' + child + '")');
      throw unsupported('add() of ' + typeof child);
    });
    TL.remove = function (child) {
      var self = this;
      if (Array.isArray(child)) { child.forEach(function (c) { self.remove(c); }); return this; }
      var i = this.children.indexOf(child);
      if (i >= 0) {
        this.children.splice(i, 1);
        child._owner = null;
        this._changed = ++seq;
      }
      return this;
    };
    ['addLabel', 'addPause', 'currentLabel', 'delay', 'getById', 'getTweensOf', 'iteration', 'nextLabel', 'previousLabel', 'recent', 'removeLabel',
      'removePause', 'repeat', 'repeatDelay', 'reverse', 'reversed', 'shiftChildren', 'tweenFromTo', 'tweenTo', 'yoyo'].forEach(function (name) {
      TL[name] = function () { throw unsupported('timeline.' + name + '()'); };
    });
    TL.duration = function (v) { if (v === undefined) return seconds(this._length()); throw unsupported('changing a timeline\'s duration'); };
    TL.totalDuration = function (v) { return this.duration(v); };
    TL.startTime = function () { return seconds(this._at); };
    TL.endTime = function () { return seconds(this._at + this._length()); };
    // flpt-tween has no clock: HyperFrames' player and renderer move a timeline by seeking it. These are here for their
    // calls; timeScale is remembered and play / resume / restart only change the paused flag (README: "For HyperFrames").
    TL.timeScale = function (v) { if (v === undefined) return this._scale; this._scale = Number(v) || 1; return this; };
    TL.play = function (from, suppressEvents) { if (from !== undefined && from !== null) this.totalTime(Number(from), suppressEvents); this._paused = false; return this; };
    TL.pause = function (at, suppressEvents) { if (at !== undefined && at !== null) this.totalTime(Number(at), suppressEvents); this._paused = true; return this; };
    TL.resume = function () { this._paused = false; return this; };
    TL.paused = function (v) { if (v === undefined) return this._paused; this._paused = !!v; return this; };
    TL.restart = function (includeDelay, suppressEvents) { this.totalTime(0, suppressEvents); this._paused = false; return this; };
    TL.isActive = function () { return false; };
    TL.time = function (t, suppressEvents) { return this.totalTime(t, suppressEvents); };
    TL.seek = function (t, suppressEvents) {
      if (typeof t === 'string' && !/^-?(?:\d*\.)?\d+$/.test(t.trim())) throw unsupported('seeking a label');
      return this.totalTime(Number(t), suppressEvents);
    };
    TL.progress = TL.totalProgress = function (p, suppressEvents) {
      var d = seconds(this._length());
      if (p === undefined) return d ? this._playhead / d : 0;
      return this.totalTime(Number(p) * d, suppressEvents);
    };
    // a seek that stops on something outside the subset (a function's value, a unit change) is reported, then thrown
    TL.totalTime = reporting(function (t, suppressEvents) {
      if (t === undefined) return this._playhead;
      t = Number(t);
      this._render(isFinite(t) ? t : 0, !!suppressEvents);
      return this;
    });
    TL.eventCallback = function (type, fn) {
      if (arguments.length === 1) return this.vars[type];
      if (fn) throw unsupported('timeline callbacks');
      delete this.vars[type];
      return this;
    };
    /**
     * The timeline's children, in time order (GSAP's documented getChildren(nested, tweens, timelines, ignoreBeforeTime);
     * each flag true when not given): a timeline's own children follow it when `nested`; a call counts as a tween. A
     * child that starts before `ignoreBeforeTime` (seconds on this timeline, nested children included) is left out.
     */
    TL.getChildren = function (nested, tweens, timelines, ignoreBeforeTime) {
      var want = { tween: tweens !== false, timeline: timelines !== false };
      var deep = nested !== false;
      var from = ignoreBeforeTime === undefined || ignoreBeforeTime === null ? null : flicks(Number(ignoreBeforeTime) || 0);
      var found = [];
      var visit = function (tl, at) {
        tl._ordered().forEach(function (c) {
          var start = at + c._at;
          if ((from === null || start >= from) && want[c._isTimeline ? 'timeline' : 'tween']) found.push(c);
          if (c._isTimeline && deep) visit(c, start);
        });
      };
      visit(this, 0);
      return found;
    };
    TL.kill = function () { this.revert(); if (this._owner) this._owner.remove(this); return this; };
    TL.invalidate = function () { this._changed = ++seq; return this; };
    TL.clear = function () { var self = this; this.children.slice().forEach(function (c) { self.remove(c); }); return this; };
    TL._ordered = function () { return this.children.slice().sort(function (a, b) { return a._at - b._at || a._ins - b._ins; }); };
    /** Every leaf in render order (a nested timeline or a stagger renders as a unit at its place), absolute times. */
    TL._flatten = function (abs, out) {
      out = out || [];
      this._ordered().forEach(function (c) {
        if (c._isTimeline) c._flatten(abs + c._at, out);
        else c._leaves(abs + c._at).forEach(function (l) { out.push(l); });
      });
      return out;
    };

    // ── recording: originals, the first values, and each leaf's property tweens ──

    /** What a property holds before this library touches it: { value (to start from), write (to put back) }. */
    function readOriginal(t, spec) {
      if (spec.kind === 'plain') return { value: t[spec.key], write: t[spec.key] };
      if (spec.kind === 'attr') { var a = t.getAttribute(spec.key); return { value: a, write: a }; }
      if (spec.kind === 'tf') return { value: tfRec(t).base[spec.key], write: null };
      if (spec.kind === 'tfset') return { value: null, write: null };
      var prop = spec.kind === 'var' ? spec.key : kebab(spec.key);
      var style = computed(t);
      var c = style.getPropertyValue ? style.getPropertyValue(prop) : '';
      var out = { value: c === undefined || c === null ? '' : String(c).trim(), write: t.style.getPropertyValue(prop) };
      if (spec.autoAlpha) out.visibility = t.style.getPropertyValue('visibility');
      return out;
    }

    /** The value a spec moves to from `cur`: units kept, relative values resolved (numbers for transforms). */
    function endValue(t, spec, cur, v) {
      if (spec.kind === 'tfset') return v;
      var rel = relative(v);
      if (spec.kind === 'tf') {
        var size = spec.key === 'x' ? t.offsetWidth : spec.key === 'y' ? t.offsetHeight : 0;
        if (rel) return fix(applyRelative({ op: rel.op, n: rel.op === '*' ? rel.n : transformNumber(spec.key, rel.n + rel.u, size) }, Number(cur) || 0));
        return transformNumber(spec.key, v, size);
      }
      if (spec.kind === 'plain') return rel ? applyRelative(rel, Number(cur) || 0) : v;
      if (rel) { var s = numUnit(cur); return (s ? applyRelative(rel, s.n) : rel.n) + (rel.u || (s ? s.u : '')); }
      return v;
    }

    var UNITLESS = { opacity: 1, zIndex: 1, fontWeight: 1, lineHeight: 1, flexGrow: 1, flexShrink: 1, order: 1, zoom: 1, fillOpacity: 1, strokeOpacity: 1, stopOpacity: 1, strokeMiterlimit: 1 };
    /** ratio → what to write: numbers (with units), colours, strings with numbers, else a switch at the end. */
    function interpolator(t, spec, start, end) {
      if (spec.kind === 'tfset') return function () { return end; };
      if (spec.kind === 'tf') {
        var a = Number(start) || 0, b = Number(end);
        return function (ratio) { return ratio === 1 ? b : fix(a + (b - a) * ratio); };
      }
      if (spec.kind === 'plain') {
        if (typeof end === 'number') { var p0 = Number(start) || 0; return function (ratio) { return ratio === 1 ? end : digits(p0 + (end - p0) * ratio); }; }
        if (typeof end === 'string' && /\d/.test(end)) return stringTween(start, end);
        return function (ratio) { return ratio === 1 ? end : start; };
      }
      var endText = typeof end === 'number' ? null : String(end);
      var to = endText !== null ? colorOf(endText) : null;
      var from = start === null || start === undefined || start === '' ? null : colorOf(String(start));
      if (to && (from || COLORISH.test(spec.key) || spec.kind === 'var')) {
        from = from || [to[0], to[1], to[2], 0];
        return function (ratio) { return ratio === 1 ? endText : mixColor(from, to, ratio); };
      }
      var e = numUnit(end);
      var s = numUnit(start === '' || start === null || start === undefined ? 0 : start);
      if (e) {
        var unit = e.u || (spec.kind === 'var' || spec.kind === 'attr' ? '' : s && s.u ? s.u : UNITLESS[spec.key] ? '' : 'px');
        var sn = s ? fix(convertUnit(t, spec, s, unit)) : 0, en = e.n;
        return function (ratio) { return (ratio === 1 ? en : fix(sn + (en - sn) * ratio)) + unit; };
      }
      if (endText !== null && /\d/.test(endText)) return stringTween(start, endText);
      return function (ratio) { return ratio === 1 ? end : start; };
    }

    /**
     * A CSS length in another unit, through px: %, em, rem, vw, vh, vmin, vmax; any other change of unit is refused. A %
     * of a margin or padding is of the width on every side (CSS 2.1 §8.3, §8.4).
     */
    function convertUnit(t, spec, s, unit) {
      if (!s.u || s.u === unit || s.n === 0 || spec.kind !== 'css') return s.n;
      var across = /^(width|left|right|minWidth|maxWidth)$|^(margin|padding)/.test(spec.key);
      var parent = t.parentNode && t.parentNode.nodeType === 1 ? t.parentNode : null;
      var size = function () { return parent ? (across ? parent.offsetWidth || parent.clientWidth : parent.offsetHeight || parent.clientHeight) || 0 : 0; };
      var fontSize = function (el) { return el ? parseFloat(computed(el).fontSize) || 16 : 16; };
      var vw = (win.innerWidth || 0) / 100, vh = (win.innerHeight || 0) / 100;
      var PX = {
        px: function () { return 1; }, '%': function () { return size() / 100; }, em: function () { return fontSize(t); },
        rem: function () { return fontSize(doc && doc.documentElement); }, vw: function () { return vw; }, vh: function () { return vh; },
        vmin: function () { return Math.min(vw, vh); }, vmax: function () { return Math.max(vw, vh); },
      };
      if (!own(PX, s.u) || !own(PX, unit)) throw unsupported('changing ' + spec.key + ' from ' + s.u + ' to ' + unit);
      var per = PX[unit]();
      return per ? (s.n * PX[s.u]()) / per : 0;
    }

    TL._init = function () {
      var prev = this._state;
      var st = {
        stamp: seq,                           // newer than every change so far (TL._newest)
        leaves: this._flatten(0),
        origs: prev ? prev.origs : new Map(), // target → Map(key → original); kept across re-inits (the DOM is ours by then)
        props: new Map(),                     // target → Map(key → spec), every property this timeline animates
        tf: [],                               // the transform recs it touches
        immediates: [],                       // leaves rendered at once (from, fromTo; set with immediateRender), creation order
        lastWritten: prev ? prev.lastWritten : new Map(),
        pending: new Map(),
      };
      var touch = function (t, spec) {
        var key = keyOf(spec);
        var o = st.origs.get(t);
        if (!o) st.origs.set(t, o = new Map());
        if (!o.has(key)) o.set(key, readOriginal(t, spec));
        var p = st.props.get(t);
        if (!p) st.props.set(t, p = new Map());
        if (!p.has(key)) p.set(key, spec);
        if ((spec.kind === 'tf' || spec.kind === 'tfset') && st.tf.indexOf(tfRec(t)) < 0) st.tf.push(tfRec(t));
      };
      // each leaf's property tweens: { spec, kind: to | from | fromTo | set | hold (a fromTo first-vars-only value), key }
      st.leaves.forEach(function (leaf) {
        var tw = leaf.tween, t = leaf.target;
        leaf.pts = [];
        if (tw._kind === 'call') return;
        var toSpecs = propSpecs(t, resolveFns(tw.vars, leaf.i, t, tw._subjects));
        var fromSpecs = tw._fromVars ? propSpecs(t, resolveFns(tw._fromVars, leaf.i, t, tw._subjects)) : [];
        var fromBy = {}, inTo = {};
        fromSpecs.forEach(function (s) { fromBy[keyOf(s)] = s; });
        toSpecs.forEach(function (s) { inTo[keyOf(s)] = 1; });
        // a value only in fromTo's first vars (an origin, a "--in": 1) is set at the start and stays
        fromSpecs.forEach(function (s) { if (!inTo[keyOf(s)]) leaf.pts.push({ spec: s, kind: 'hold', key: keyOf(s) }); });
        toSpecs.forEach(function (s) { leaf.pts.push({ spec: s, from: fromBy[keyOf(s)] || null, kind: tw._kind, key: keyOf(s) }); });
        leaf.pts.sort(function (a, b) { return (a.spec.kind === 'tfset' ? 0 : 1) - (b.spec.kind === 'tfset' ? 0 : 1); });
        leaf.pts.forEach(function (pt) { pt.target = t; touch(t, pt.spec); });
      });
      // the values as they'd stand: the originals, then the immediate renders in creation order, then every leaf at its end
      var sim = new Map();
      var get = function (t, key) {
        var m = sim.get(t);
        if (m && m.has(key)) return m.get(key);
        return st.origs.get(t).get(key).value;
      };
      var set = function (t, key, v) { var m = sim.get(t); if (!m) sim.set(t, m = new Map()); m.set(key, v); };
      var firstValue = function (pt) {
        // the value an immediate render writes for this property, or undefined if it doesn't touch it
        if (pt.kind === 'set' || pt.kind === 'from' || pt.kind === 'hold') return pt.spec.value;
        if (pt.kind === 'fromTo' && pt.from) return pt.from.value;
        return undefined;
      };
      st.leaves.filter(function (l) { return immediate(l.tween); })
        .sort(function (a, b) { return a.tween._seq - b.tween._seq || a.i - b.i; })
        .forEach(function (leaf) {
          leaf.pts.forEach(function (pt) {
            var fv = firstValue(pt);
            if (fv !== undefined) set(pt.target, pt.key, endValue(pt.target, pt.spec, get(pt.target, pt.key), fv));
          });
          st.immediates.push(leaf);
        });
      st.leaves.forEach(function (leaf) {
        leaf.pts.forEach(function (pt) {
          var cur = get(pt.target, pt.key);
          var s = pt.spec, start, end;
          if (pt.kind === 'from') { start = endValue(pt.target, s, cur, s.value); end = st.origs.get(pt.target).get(pt.key).value; }
          else if (pt.kind === 'hold') { start = end = endValue(pt.target, s, cur, s.value); }
          else if (pt.from) { start = endValue(pt.target, s, cur, pt.from.value); end = endValue(pt.target, s, start, s.value); }
          else { start = cur; end = endValue(pt.target, s, cur, s.value); }
          pt.start = start;
          pt.end = end;
          pt.interp = interpolator(pt.target, s, start, end);
          // a transform component a tween leaves where it is has nothing to draw: so an element no tween moves keeps the
          // page's own transform (any transform but none makes an element a stacking context and a containing block,
          // CSS Transforms 1 §3)
          pt.still = s.kind === 'tf' && pt.kind !== 'hold' && start === end;
          set(pt.target, pt.key, end);
        });
      });
      this._state = st;
      return st;
    };

    function resolveFns(vars, i, target, targets) {
      var out = {};
      Object.keys(vars).forEach(function (k) {
        var v = vars[k];
        if (isFn(v) && !/^on[A-Z]/.test(k) && k !== 'ease' && k !== 'stagger') v = v(i, target, targets);
        else if ((k === 'attr' || k === 'css') && isObj(v)) v = resolveFns(v, i, target, targets);
        out[k] = v;
      });
      return out;
    }

    // ── writing: pending values reach the DOM at a flush (before each callback, and at the end of a seek) ──

    function write(st, t, key, value) {
      var p = st.pending.get(t);
      if (!p) st.pending.set(t, p = new Map());
      p.delete(key); // keep the order of the last writes
      p.set(key, value);
    }
    function flush(st) {
      st.pending.forEach(function (m, t) {
        var lw = st.lastWritten.get(t);
        if (!lw) st.lastWritten.set(t, lw = new Map());
        m.forEach(function (v, key) {
          if (lw.has(key) && lw.get(key) === v) return;
          lw.set(key, v);
          var i = key.indexOf(':'), kind = key.slice(0, i), name = key.slice(i + 1);
          if (kind === 'attr') { if (v === null || v === undefined) t.removeAttribute(name); else t.setAttribute(name, String(v)); return; }
          var prop = kind === 'css' ? kebab(name) : name; // var: and style: names are written as they are
          if (v === null || v === undefined || v === '') t.style.removeProperty(prop);
          else t.style.setProperty(prop, String(v));
        });
      });
      st.pending = new Map();
    }
    function writeTf(st, rec) {
      var el = rec.el;
      if (rec.svg) {
        // the matrix is the whole transform, about its own origin: the element's transform-origin goes back to what CSS
        // Transforms 1 gives such an element (its user agent style sheet's `transform-origin: 0 0`), whatever the page set
        write(st, el, 'style:transform-origin', '0 0');
        write(st, el, 'attr:transform', 'matrix(' + svgMatrix(rec).map(fix).join(' ') + ')');
      } else {
        if (rec.cssOrigin !== null) write(st, el, 'style:transform-origin', rec.cssOrigin);
        write(st, el, 'style:transform', cssTransform(rec));
      }
    }
    /** A target's transform as it was before this library: its own strings, its components as read. */
    function resetTf(st, rec) {
      STATE.forEach(function (k) { rec[k] = rec.base[k]; });
      var o = rec.inline, el = rec.el;
      write(st, el, 'style:transform-origin', o.transformOrigin);
      if (rec.svg) write(st, el, 'attr:transform', o.attr);
      else write(st, el, 'style:transform', o.transform);
    }
    function renderPts(st, pts, ratioOf) {
      var touched = [];
      pts.forEach(function (pt) {
        var ratio = ratioOf(pt);
        if (ratio === undefined) return;
        if (pt.still) return;
        var v = pt.interp(ratio), s = pt.spec;
        if (s.kind === 'tf' || s.kind === 'tfset') {
          var rec = tfRec(pt.target);
          if (s.kind === 'tf') rec[s.key] = v; else applyTfSetting(rec, s.key, v);
          if (touched.indexOf(rec) < 0) touched.push(rec);
        } else if (s.kind === 'plain') pt.target[s.key] = v;
        else {
          write(st, pt.target, s.kind + ':' + s.key, v);
          if (s.autoAlpha) write(st, pt.target, 'style:visibility', parseFloat(v) === 0 ? 'hidden' : 'inherit');
        }
      });
      return touched;
    }
    function callback(tw, name) {
      var fn = tw.vars[name];
      if (isFn(fn)) fn.apply(tw.vars.callbackScope || tw, tw.vars[name + 'Params'] || []);
    }
    var runCall = function (c) { c._callback.apply(c, c._callbackParams); };
    var hasCallbacks = function (tw) { return isFn(tw.vars.onStart) || isFn(tw.vars.onUpdate) || isFn(tw.vars.onComplete) || isFn(tw.vars.onReverseComplete); };
    /** Every property the timeline animates back to the page's own value (transforms to their components as read). */
    function putBack(st) {
      st.tf.forEach(function (rec) { resetTf(st, rec); });
      st.props.forEach(function (m, t) {
        m.forEach(function (spec, key) {
          if (spec.kind === 'tf' || spec.kind === 'tfset') return;
          var orig = st.origs.get(t).get(key);
          if (spec.kind === 'plain') { t[spec.key] = orig.write; return; }
          write(st, t, key, orig.write);
          if (spec.autoAlpha) write(st, t, 'style:visibility', orig.visibility);
        });
      });
    }

    TL._render = function (time, suppressEvents) {
      var st = this._state && this._state.stamp >= this._newest() ? this._state : this._init();
      var T = Math.min(flicks(time < 0 ? 0 : time), this._length()); // the playhead, in flicks
      this._playhead = seconds(T);
      st.pending = new Map();
      var leaves = st.leaves, i, leaf, tw, was;
      // 1. leaves not started by T that a seek had moved past their start: back to their start, last first (their callbacks)
      for (i = leaves.length - 1; i >= 0; i--) {
        leaf = leaves[i]; tw = leaf.tween;
        if (leaf.start <= T || !tw._locals[leaf.i]) continue;
        was = tw._locals[leaf.i];
        tw._locals[leaf.i] = 0;
        if (suppressEvents) continue;
        if (tw._callback) { flush(st); runCall(tw); continue; } // the playhead went back across a call
        if (!hasCallbacks(tw)) continue;
        renderPts(st, leaf.pts, function () { return 0; }).forEach(function (rec) { writeTf(st, rec); });
        flush(st);
        callback(tw, 'onUpdate');
        if (was > 0) callback(tw, 'onReverseComplete');
      }
      // 2. the starting picture: the page's own values, then the first values of from() and fromTo()
      putBack(st);
      var firstRecs = [];
      st.immediates.forEach(function (l) {
        renderPts(st, l.pts, function (pt) {
          return pt.kind === 'set' ? 1 : pt.kind === 'from' || pt.kind === 'hold' || (pt.kind === 'fromTo' && pt.from) ? 0 : undefined;
        }).forEach(function (rec) { if (firstRecs.indexOf(rec) < 0) firstRecs.push(rec); });
      });
      firstRecs.forEach(function (rec) { writeTf(st, rec); });
      // 3. every leaf started by T, in timeline order, at its own progress
      var calls = [];
      for (i = 0; i < leaves.length; i++) {
        leaf = leaves[i]; tw = leaf.tween;
        if (leaf.start > T) continue;
        was = tw._locals[leaf.i] || 0;
        var local = leaf.dur ? clamp((T - leaf.start) / leaf.dur, 0, 1) : 1;
        var ratio = local === 1 ? 1 : local === 0 ? 0 : tw._curve(local);
        renderPts(st, leaf.pts, function () { return ratio; }).forEach(function (rec) { writeTf(st, rec); });
        tw._locals[leaf.i] = local;
        var first = !tw._inited[leaf.i];
        tw._inited[leaf.i] = true;
        if (suppressEvents) continue;
        if (tw._callback) { if (was < 1 || first) calls.push({ call: tw }); continue; } // the playhead crossed a call
        if (hasCallbacks(tw)) calls.push({ tw: tw, start: Boolean(local && (!was || first)), complete: local === 1 && (was < 1 || first) });
      }
      // 4. the page as it stands at T, then the callbacks of every started tween, in timeline order: the method's draw
      // from their own tween's values (the pen's nib, a count's text), so what they leave depends on T alone (and a
      // frame that lands exactly on a pen stroke's start puts the nib there)
      flush(st);
      calls.forEach(function (c) {
        if (c.call) { runCall(c.call); return; }
        if (c.start) callback(c.tw, 'onStart');
        callback(c.tw, 'onUpdate');
        if (c.complete) callback(c.tw, 'onComplete');
      });
    };

    /** Put back everything the timeline changed. */
    TL.revert = function () {
      var st = this._state;
      if (!st) return this;
      st.pending = new Map();
      putBack(st);
      flush(st);
      st.leaves.forEach(function (l) { l.tween._locals = []; l.tween._inited = []; });
      this._state = null;
      this._playhead = 0;
      return this;
    };

    // ── outside a timeline, and the gsap object ──

    function standalone(kind, targets, vars, fromVars) {
      var tw = new Tween(targets, vars, kind, fromVars);
      if (kind === 'set') {
        // gsap.set renders now (through a throwaway timeline, so transforms and units go the usual way), and what it
        // set becomes the page's own value for any timeline after it
        var tl = new Timeline({ paused: true });
        tl._insert(tw, 0);
        tl._render(0, true);
        tl._state.tf.forEach(function (rec) { rec.base = snapshot(rec); rec.inline = inlineOf(rec.el, rec.svg); });
        tl.remove(tw);
      }
      return tw;
    }

    function getProperty(target, prop, unit) {
      var t = toTargets(target)[0];
      if (!t) return undefined;
      if (!isEl(t)) return t[prop];
      if (prop === 'scale' || own(TRANSFORMS, prop)) {
        var v = tfRec(t)[prop === 'scale' ? 'scaleX' : TRANSFORMS[prop]];
        return unit ? v + unit : v;
      }
      var c = String(computed(t).getPropertyValue(prop.slice(0, 2) === '--' ? prop : kebab(prop)) || '').trim();
      var nu = numUnit(c);
      return unit === undefined && nu ? nu.n : c;
    }

    var gsap = {
      version: 'flpt-tween ' + VERSION,
      flptTween: VERSION,
      FlptTweenUnsupported: FlptTweenUnsupported,
      timeline: reporting(function (vars) { return new Timeline(vars); }),
      to: reporting(function (targets, vars) { return standalone('to', targets, vars); }),
      from: reporting(function (targets, vars) { return standalone('from', targets, vars); }),
      fromTo: reporting(function (targets, fromVars, toVars) { return standalone('fromTo', targets, toVars, fromVars || {}); }),
      set: reporting(function (targets, vars) { return standalone('set', targets, vars); }),
      parseEase: function (e) { return parseEase(e); },
      registerEase: function (name, fn) {
        if (typeof name !== 'string' || !isFn(fn)) throw unsupported('registerEase() without a name and a function');
        registeredEases[name] = fn;
      },
      // a plugin can be registered, but a tween that uses a property it adds stops with an error
      registerPlugin: function () {
        Array.prototype.slice.call(arguments).forEach(function (p) { if (p && typeof p.name === 'string' && p.name.charAt(0) !== '_') plugins[p.name] = p; });
      },
      defaults: function (vars) {
        if (vars === undefined) return { duration: globalDefaults.duration, ease: globalDefaults.ease };
        Object.keys(vars).forEach(function (k) {
          if (['duration', 'ease', 'overwrite'].indexOf(k) < 0) throw unsupported('gsap.defaults({ ' + k + ' })');
          if (k === 'overwrite') { if (vars[k] !== false) throw unsupported('overwrite'); return; }
          if (k === 'ease') parseEase(vars[k]);
          globalDefaults[k] = vars[k];
        });
        return { duration: globalDefaults.duration, ease: globalDefaults.ease };
      },
      config: function (vars) {
        Object.keys(vars || {}).forEach(function (k) { if (['nullTargetWarn', 'autoSleep', 'force3D', 'trialWarn'].indexOf(k) < 0) throw unsupported('gsap.config({ ' + k + ' })'); });
        return {};
      },
      getProperty: getProperty,
    };
    ['quickTo', 'quickSetter', 'delayedCall', 'getTweensOf', 'killTweensOf', 'isTweening', 'exportRoot', 'updateRoot', 'matchMedia',
      'matchMediaRefresh', 'context', 'getById', 'registerEffect'].forEach(function (name) {
      gsap[name] = function () { throw unsupported('gsap.' + name + '()'); };
    });
    ['utils', 'globalTimeline', 'effects', 'plugins'].forEach(function (name) {
      Object.defineProperty(gsap, name, { enumerable: false, get: function () { throw unsupported('gsap.' + name); } });
    });
    // nothing plays on its own here, so a tick has nothing to do (HyperFrames' snapshot calls gsap.ticker.tick() after a
    // seek); the ticker's real-time hooks are outside the subset
    gsap.ticker = { tick: function () {} };
    ['add', 'remove', 'lagSmoothing', 'fps', 'sleep', 'wake'].forEach(function (name) {
      gsap.ticker[name] = function () { throw unsupported('gsap.ticker.' + name + '()'); };
    });
    return gsap;
  }

  if (typeof module === 'object' && module && module.exports) {
    module.exports = { create: create, check: check, VERSION: VERSION, FlptTweenUnsupported: FlptTweenUnsupported };
  } else if (root) {
    root.gsap = create(root);
    root.flptTween = { version: VERSION, create: create, check: check, FlptTweenUnsupported: FlptTweenUnsupported };
  }
})(typeof window !== 'undefined' ? window : this);
