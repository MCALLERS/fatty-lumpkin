/* live-slide.js — the beat engine for HyperFrames "live animation" slides.
 *
 * Turns window.__SLIDE__ (generated from beats.json by render.mjs) into ONE paused,
 * seek-safe GSAP timeline. index.html registers it:
 *
 *     window.__timelines["slide"] = LiveSlide.build(window.__SLIDE__);
 *
 * You normally never edit this file. Author the scene in index.html (elements with ids)
 * and schedule it in beats.json. A beat looks like:
 *
 *   { "t": 5.2, "target": ["ring", ".node"], "do": "in", "anim": "pop", "stagger": 0.08,
 *     "cue": "a ring of feasible worlds", "say": "Around it sits a ring of feasible worlds" }
 *
 *   t        seconds from the start of the slide (or "after": seconds after the previous beat)
 *   target   an id ("ring"), a CSS selector ("#ring", ".node", "g.remote circle"), or a list of them
 *            (optional for do:"unfocus", which brings everything back to full strength)
 *   do       in (default) | out | focus | unfocus | dim | pulse | count | to
 *   anim     entrance kind for do:"in" (overrides the element's data-anim; default "rise"):
 *            rise | fade | pop | draw | wipe | grow | words
 *            (draw: one continuous subpath per shape; SVG restarts dashes at every "M", so
 *            draw an arrow as "M a L tip L barb1 L tip L barb2", not two subpaths)
 *   dur, ease, stagger   optional overrides
 *   pen      (anim:"draw" on ONE svg shape) a pen nib rides the drawing tip, whiteboard style
 *   drawStagger  (anim:"draw" on a group) delay between its shapes
 *   to       (do:"to") GSAP vars, e.g. {"fill": "var(--ox)"} or {"attr": {"r": 30}}. var(--token) is resolved.
 *   value    (do:"count") the number to count to (else the element's data-to); data-from, data-decimals,
 *            data-prefix, data-suffix on the element shape the text.
 *   cue      a phrase from the narration; align-beats.mjs sets t from word timestamps
 *   say      free text for humans (ignored)
 *
 * Opacity has two independent channels so entrances and the spotlight never fight over
 * the same property: --in (entrance/exit) and --lit (focus/dim). Both are registered
 * non-inheriting in index.html, and every managed element gets opacity: calc(--in * --lit).
 */
(function () {
  "use strict";

  var DEF = {
    rise: { dur: 0.7, ease: "power3.out" },
    fade: { dur: 0.6, ease: "power1.out" },
    pop: { dur: 0.55, ease: "back.out(1.6)" },
    draw: { dur: 1.1, ease: "power2.inOut" },
    wipe: { dur: 0.8, ease: "power3.inOut" },
    grow: { dur: 0.8, ease: "power3.out" },
    words: { dur: 0.5, ease: "power3.out", stagger: 0.05 },
    out: { dur: 0.45, ease: "power2.in" },
    focus: { dur: 0.5, ease: "power2.inOut" },
    pulse: { dur: 0.6, ease: "power2.inOut" },
    count: { dur: 1.4, ease: "power2.out" },
    to: { dur: 0.6, ease: "power2.inOut" },
  };
  var SHAPES = "path,line,circle,ellipse,polyline,polygon,rect";
  var warn = function (m) {
    if (window.console) console.warn("[live-slide] " + m);
  };

  function resolve(target) {
    var list = Array.isArray(target) ? target : [target];
    var out = [];
    list.forEach(function (s) {
      if (!s) return;
      var sel = /^[#.\[]|[\s>:]/.test(s) ? s : "#" + s;
      var found = document.querySelectorAll(sel);
      if (!found.length) warn("no element matches " + JSON.stringify(s));
      found.forEach(function (el) {
        if (out.indexOf(el) < 0) out.push(el);
      });
    });
    return out;
  }

  function related(a, b) {
    return a === b || a.contains(b) || b.contains(a);
  }

  function drawables(el) {
    return el.matches(SHAPES) ? [el] : Array.prototype.slice.call(el.querySelectorAll(SHAPES));
  }

  // Wrap each word of el's own text in <span class="lv-w">; inline child elements count as one word.
  function splitWords(el) {
    if (el.querySelector(".lv-w")) return el.querySelectorAll(".lv-w");
    Array.prototype.slice.call(el.childNodes).forEach(function (node) {
      if (node.nodeType === 3) {
        var frag = document.createDocumentFragment();
        node.textContent.split(/(\s+)/).forEach(function (part) {
          if (!part) return;
          if (/^\s+$/.test(part)) frag.appendChild(document.createTextNode(part));
          else {
            var span = document.createElement("span");
            span.className = "lv-w lv";
            span.textContent = part;
            frag.appendChild(span);
          }
        });
        el.replaceChild(frag, node);
      } else if (node.nodeType === 1) {
        node.classList.add("lv-w", "lv");
      }
    });
    return el.querySelectorAll(".lv-w");
  }

  // Optional "pen" for draw beats: a nib that rides the tip of the stroke as it draws
  // (the whiteboard-ink look). Geometry only: seek-safe and deterministic.
  var SVGNS = "http://www.w3.org/2000/svg";
  function penFor(shape) {
    var svg = shape.ownerSVGElement;
    if (!svg || !shape.getScreenCTM || !svg.getScreenCTM()) return null;
    var pen = svg.querySelector(":scope > g.lv-pen");
    if (!pen) {
      pen = document.createElementNS(SVGNS, "g");
      pen.setAttribute("class", "lv-pen lv");
      [["lv-pen-halo", 15], ["lv-pen-nib", 6.5]].forEach(function (c) {
        var circle = document.createElementNS(SVGNS, "circle");
        circle.setAttribute("class", c[0]);
        circle.setAttribute("r", String(c[1]));
        pen.appendChild(circle);
      });
      pen.style.setProperty("--in", "0");
      svg.appendChild(pen);
    }
    var sc = shape.getScreenCTM();
    if (!sc) return null;
    var m = svg.getScreenCTM().inverse().multiply(sc); // shape user space -> svg user space (computed once)
    return { el: pen, m: m };
  }

  function tokenValue(root, v) {
    if (typeof v !== "string") return v;
    return v.replace(/var\((--[\w-]+)\)/g, function (_, name) {
      return getComputedStyle(root).getPropertyValue(name).trim() || _;
    });
  }

  function resolveVars(root, vars) {
    var out = {};
    Object.keys(vars || {}).forEach(function (k) {
      var v = vars[k];
      out[k] = v && typeof v === "object" && !Array.isArray(v) ? resolveVars(root, v) : tokenValue(root, v);
    });
    return out;
  }

  function fmt(n, el) {
    var dec = parseInt(el.getAttribute("data-decimals") || "0", 10);
    var s = n.toFixed(dec);
    if (el.getAttribute("data-grouping") !== "off") {
      var parts = s.split(".");
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      s = parts.join(".");
    }
    return (el.getAttribute("data-prefix") || "") + s + (el.getAttribute("data-suffix") || "");
  }

  function normalize(slide) {
    var prev = 0;
    var beats = (slide.beats || []).map(function (b, i) {
      var t = typeof b.t === "number" ? b.t : prev + (typeof b.after === "number" ? b.after : 0);
      prev = t;
      var copy = {};
      Object.keys(b).forEach(function (k) {
        copy[k] = b[k];
      });
      copy.t = Math.max(0, t);
      copy._i = i;
      copy.do = b.do || "in";
      return copy;
    });
    beats.sort(function (a, b) {
      return a.t - b.t || a._i - b._i;
    });
    return beats;
  }

  function build(slide) {
    if (!slide) throw new Error("window.__SLIDE__ is missing: run `node render.mjs <slide-dir> --sync`");
    var root = document.getElementById("slide") || document.body;
    Object.keys(slide.tokens || {}).forEach(function (k) {
      root.style.setProperty(k, slide.tokens[k]);
    });
    if (slide.guides) root.classList.add("show-guides");

    var DIM = parseFloat(getComputedStyle(root).getPropertyValue("--dim")) || 0.4;
    var tl = gsap.timeline({ paused: true, defaults: { overwrite: false } });
    var beats = normalize(slide);
    var lastEnd = 0;
    var mark = function (end) {
      lastEnd = Math.max(lastEnd, end);
    };

    // Pass 1: everything that enters on a beat starts hidden (and pre-set for its entrance kind).
    var prepared = new Set();
    beats.forEach(function (b) {
      if (b.do !== "in") return;
      resolve(b.target).forEach(function (el) {
        if (prepared.has(el)) return;
        prepared.add(el);
        var kind = b.anim || el.getAttribute("data-anim") || "rise";
        el.classList.add("lv");
        el.style.setProperty("--in", "0");
        if (kind === "draw") {
          drawables(el).forEach(function (d) {
            var len = Math.ceil(d.getTotalLength ? d.getTotalLength() : 0) + 2;
            d.style.strokeDasharray = len + " " + len;
            d.style.strokeDashoffset = String(len);
          });
        } else if (kind === "words") {
          splitWords(el).forEach(function (w) {
            w.style.setProperty("--in", "0");
          });
        } else if (kind === "wipe") {
          el.style.clipPath = "inset(-10% 100% -10% 0%)";
        }
      });
    });

    // Pass 2: schedule every beat in time order, tracking what is on screen for the spotlight.
    var shown = []; // elements that have entered and not exited
    var lit = new Map(); // element -> current --lit value

    function setLit(els, value, t, d, ease) {
      var changing = els.filter(function (el) {
        return (lit.has(el) ? lit.get(el) : 1) !== value;
      });
      changing.forEach(function (el) {
        el.classList.add("lv");
        lit.set(el, value);
      });
      if (changing.length) {
        tl.to(changing, { "--lit": value, duration: d, ease: ease }, t);
        mark(t + d);
      }
    }

    beats.forEach(function (b) {
      var els = b.target ? resolve(b.target) : [];
      if (!els.length && b.do !== "unfocus") return;
      var t = b.t;
      var def = DEF[b.do === "in" ? b.anim || els[0].getAttribute("data-anim") || "rise" : b.do === "unfocus" ? "focus" : b.do] || DEF.rise;
      var d = typeof b.dur === "number" ? b.dur : def.dur;
      var ease = b.ease || def.ease;
      var st = typeof b.stagger === "number" ? b.stagger : def.stagger || 0;
      var span = d + st * Math.max(0, els.length - 1);

      if (b.do === "in") {
        els.forEach(function (el, i) {
          var kind = b.anim || el.getAttribute("data-anim") || "rise";
          var at = t + st * i;
          var k = DEF[kind] || DEF.rise;
          var dd = typeof b.dur === "number" ? b.dur : k.dur;
          var ee = b.ease || k.ease;
          if (kind === "rise") {
            tl.fromTo(el, { "--in": 0, y: 26 }, { "--in": 1, y: 0, duration: dd, ease: ee }, at);
            mark(at + dd);
          } else if (kind === "fade") {
            tl.fromTo(el, { "--in": 0 }, { "--in": 1, duration: dd, ease: ee }, at);
            mark(at + dd);
          } else if (kind === "pop") {
            tl.fromTo(
              el,
              { "--in": 0, scale: 0.35, transformOrigin: "50% 50%" },
              { "--in": 1, scale: 1, duration: dd, ease: ee },
              at,
            );
            mark(at + dd);
          } else if (kind === "grow") {
            var origin = el.getAttribute("data-origin") || "0% 50%";
            tl.fromTo(
              el,
              { "--in": 1, scaleX: 0, transformOrigin: origin },
              { scaleX: 1, duration: dd, ease: ee },
              at,
            );
            mark(at + dd);
          } else if (kind === "wipe") {
            tl.set(el, { "--in": 1 }, at);
            tl.fromTo(
              el,
              { clipPath: "inset(-10% 100% -10% 0%)" },
              { clipPath: "inset(-10% -2% -10% 0%)", duration: dd, ease: ee },
              at,
            );
            mark(at + dd);
          } else if (kind === "draw") {
            var ds = drawables(el);
            tl.set(el, { "--in": 1 }, at);
            var dst = typeof b.drawStagger === "number" ? b.drawStagger : 0;
            var pen = b.pen && ds.length === 1 ? penFor(ds[0]) : null;
            if (b.pen && !pen) warn("pen needs a single visible SVG shape (" + (el.id || el.tagName) + ")");
            if (pen) {
              var shape = ds[0];
              var total = parseFloat(shape.style.strokeDashoffset) || 0;
              var follow = function () {
                var off = parseFloat(shape.style.strokeDashoffset) || 0;
                var pt = shape.getPointAtLength(Math.max(0, Math.min(total - 2, total - off)));
                var x = pen.m.a * pt.x + pen.m.c * pt.y + pen.m.e;
                var y = pen.m.b * pt.x + pen.m.d * pt.y + pen.m.f;
                pen.el.setAttribute("transform", "translate(" + x.toFixed(2) + " " + y.toFixed(2) + ")");
              };
              tl.set(pen.el, { "--in": 1 }, at);
              tl.to(shape, { strokeDashoffset: 0, duration: dd, ease: ee, onUpdate: follow, onStart: follow }, at);
              tl.to(pen.el, { "--in": 0, duration: 0.18, ease: "power1.out" }, at + dd);
              mark(at + dd + 0.18);
            } else {
              tl.to(ds, { strokeDashoffset: 0, duration: dd, ease: ee, stagger: dst }, at);
              mark(at + dd + dst * Math.max(0, ds.length - 1));
            }
          } else if (kind === "words") {
            var ws = el.querySelectorAll(".lv-w");
            var wst = typeof b.wordStagger === "number" ? b.wordStagger : DEF.words.stagger;
            tl.set(el, { "--in": 1 }, at);
            tl.fromTo(ws, { "--in": 0, y: 14 }, { "--in": 1, y: 0, duration: dd, ease: ee, stagger: wst }, at);
            mark(at + dd + wst * Math.max(0, ws.length - 1));
          } else {
            warn("unknown anim " + kind);
          }
          if (shown.indexOf(el) < 0) shown.push(el);
        });
      } else if (b.do === "out") {
        tl.to(els, { "--in": 0, duration: d, ease: ease, stagger: st }, t);
        mark(t + span);
        shown = shown.filter(function (s) {
          return els.indexOf(s) < 0;
        });
      } else if (b.do === "focus") {
        var dimmed = shown.filter(function (s) {
          return (
            !s.closest("[data-nodim]") &&
            !els.some(function (e) {
              return related(e, s);
            })
          );
        });
        var lifted = shown.filter(function (s) {
          return els.some(function (e) {
            return related(e, s);
          });
        });
        setLit(els.concat(lifted), 1, t, d, ease);
        setLit(dimmed, typeof b.level === "number" ? b.level : DIM, t, d, ease);
      } else if (b.do === "dim") {
        setLit(els, typeof b.level === "number" ? b.level : DIM, t, d, ease);
      } else if (b.do === "unfocus") {
        setLit(shown.concat(els), 1, t, d, ease);
      } else if (b.do === "pulse") {
        var s = typeof b.scale === "number" ? b.scale : 1.08;
        tl.to(els, { scale: s, transformOrigin: "50% 50%", duration: d / 2, ease: "power2.out" }, t);
        tl.to(els, { scale: 1, duration: d / 2, ease: "power2.in" }, t + d / 2);
        mark(t + d);
      } else if (b.do === "count") {
        els.forEach(function (el, i) {
          var from = parseFloat(el.getAttribute("data-from") || "0");
          var to = typeof b.value === "number" ? b.value : parseFloat(el.getAttribute("data-to") || "0");
          var state = { v: from };
          el.textContent = fmt(from, el);
          tl.to(
            state,
            {
              v: to,
              duration: d,
              ease: ease,
              onUpdate: function () {
                el.textContent = fmt(state.v, el);
              },
            },
            t + st * i,
          );
        });
        mark(t + span);
      } else if (b.do === "to") {
        tl.to(els, Object.assign(resolveVars(root, b.to), { duration: d, ease: ease, stagger: st }), t);
        mark(t + span);
      } else {
        warn("unknown do " + b.do);
      }
    });

    var dur = slide.duration || 0;
    var hold = typeof slide.hold === "number" ? slide.hold : 1;
    if (dur && lastEnd > dur - hold + 1e-6) {
      warn(
        "motion ends at " + lastEnd.toFixed(2) + "s but the slide is " + dur + "s with a " + hold +
          "s hold: the last frame will not be still. Move beats earlier or raise duration.",
      );
    }
    window.__SLIDE_REPORT__ = { lastMotionEnd: +lastEnd.toFixed(3), duration: dur, hold: hold, beats: beats.length };
    return tl;
  }

  window.LiveSlide = { build: build };
})();
