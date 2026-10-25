// The Welcome hero (W3-04, PLAN §3.3 S0): Fatty Lumpkin's valley in three layers cut by hand from the painting
// (app/scripts/hero-layers.mjs), breathing on a 20 s cycle, with forty dandelion seeds on the wind. FLPT's own scene,
// run by the trusted host (vendor/flpt-live/host-inline.js) in the app and, later, on the landing page.
//
// Parallax: no layer ever moves more than 1.5 % of the width (PLAN §3.2), and the front layer moves less, relative to
// the painting under it, than the margin its matte carries (front.grow), so nothing hidden behind the pony shows.
// The pointer (window.FLPTHeroInput, kept by ui-hero.js on fine pointers, smoothed there) adds to the breath and
// parts the seeds; without it the scene is a pure function of t. The loop is seamless at 40 s.
(() => {
  const BASE = document.currentScript && document.currentScript.src ? document.currentScript.src : location.href;
  const W = 1920;
  const H = 1080;
  const LOOP = 40; // the scene's length: two breaths, one crossing of the seeds
  const BREATH = 20;
  const TAU = Math.PI * 2;
  // The painting on the canvas: 1600 × 678 drawn at S, so the pony stands right of centre with its tail in frame and
  // every layer keeps a margin past each edge for its largest move.
  const S = 1.64;
  const X0 = -672;
  const Y0 = -16;
  // Each layer's largest move, in canvas pixels: the breath plus the pointer, x and y. 1.5 % of 1920 is 28.8.
  const MOVE = Object.freeze({
    back: { bx: 3, by: 2, px: 3, py: 2 },
    mid: { bx: 6, by: 3, px: 8, py: 4 },
    front: { bx: 10, by: 5, px: 15, py: 7 },
  });
  const CAP = 0.015 * W;
  const SEEDS = 40;
  // Each layer's box in the painting, as app/scripts/hero-layers.mjs cut it (layers.json; a test keeps them equal).
  const BOXES = Object.freeze({ back: { x: 0, y: 0, w: 1600, h: 678 }, mid: { x: 0, y: 129, w: 1600, h: 549 }, front: { x: 528, y: 42, w: 1072, h: 636 } });

  /** Each layer's offset at time t for a pointer (x, y in −1…1, `on` 0…1): exported for QA and the tests. */
  function offsets(t, p) {
    const b = Math.sin((TAU * t) / BREATH);
    const b2 = Math.sin((TAU * 2 * t) / BREATH + 0.7);
    const px = p ? p.x * p.on : 0;
    const py = p ? p.y * p.on : 0;
    const out = {};
    for (const [k, m] of Object.entries(MOVE)) out[k] = { x: m.bx * b - m.px * px, y: m.by * b2 - m.py * py };
    return out;
  }

  const load = (name) => new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error(`hero: ${name} not loaded`));
    img.src = new URL(name, BASE).href;
  });

  /** A layer pre-scaled to its drawn size, on a canvas the host's (CPU) canvas can blit from. */
  function scaled(ctx, img, box) {
    const c = ctx.canvas(box.w * S, box.h * S);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, c.width, c.height);
    return { c, x: X0 + box.x * S, y: Y0 + box.y * S };
  }

  /**
   * A dandelion seed, drawn once (setup) at a large size and blitted per frame: a pappus of fine filaments fanned
   * upward over a long beak, a faint glow round it, the dark seed at the foot.
   */
  const SPRITE_R = 26;
  function seedSprite(ctx) {
    const R = SPRITE_R;
    const c = ctx.canvas(R * 2.6, R * 3.4);
    const g = c.getContext('2d', { willReadFrequently: true });
    const cx = c.width / 2;
    const cy = R * 1.15;
    const glow = g.createRadialGradient(cx, cy, 0, cx, cy, R * 1.2);
    glow.addColorStop(0, 'rgba(255, 252, 240, .34)');
    glow.addColorStop(1, 'rgba(255, 252, 240, 0)');
    g.fillStyle = glow;
    g.beginPath(); g.arc(cx, cy, R * 1.2, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(255, 251, 240, .9)';
    g.lineCap = 'round';
    g.lineWidth = 1.1;
    g.beginPath();
    const N = 19;
    for (let k = 0; k < N; k++) {
      const a = -Math.PI / 2 + ((k / (N - 1)) * 2 - 1) * 1.62;
      const len = R * (0.82 + 0.18 * Math.abs(Math.sin(k * 2.3)));
      g.moveTo(cx, cy);
      g.quadraticCurveTo(cx + Math.cos(a) * len * 0.5, cy + Math.sin(a) * len * 0.5 - 1.5, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
    }
    g.stroke();
    g.fillStyle = 'rgba(255, 251, 240, .95)';
    for (let k = 0; k < N; k++) {
      const a = -Math.PI / 2 + ((k / (N - 1)) * 2 - 1) * 1.62;
      const len = R * (0.82 + 0.18 * Math.abs(Math.sin(k * 2.3)));
      g.beginPath(); g.arc(cx + Math.cos(a) * len, cy + Math.sin(a) * len, 1.3, 0, TAU); g.fill();
    }
    g.lineWidth = 1.3;
    g.strokeStyle = 'rgba(245, 236, 214, .85)';
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx, cy + R * 1.55); g.stroke();
    g.fillStyle = 'rgba(92, 64, 34, .9)';
    g.beginPath(); g.ellipse(cx, cy + R * 1.75, 2.1, 5.2, 0, 0, TAU); g.fill();
    return { c, cx, cy };
  }

  window.FLPTHeroScene = Object.freeze({ offsets, MOVE, CAP, LOOP, BREATH, S, X0, Y0, W, H, BOXES, GROW: 16 });

  FLPT.scene({
    layers: ['canvas'],
    ones: true,
    keyframes: [0],

    // setup returns a promise (the pictures decode first); a hook is never an async function (flpt-live's rule)
    setup(ctx) {
      return Promise.all(['back.webp', 'mid.webp', 'front.webp'].map(load)).then(([back, mid, front]) => {
        const seeds = [];
        for (let i = 0; i < SEEDS; i++) {
          const r = ctx.rng('seed', i);
          const depth = 0.35 + 0.65 * r.r() ** 1.6; // most far away, a few close
          seeds.push({ depth, phase: r.r(), y: 90 + 700 * r.r() ** 1.3, rise: 40 + 90 * r.r(), bob: 10 + 22 * r.r(), ph: r.r(), ph2: r.r(), ph3: r.r() });
        }
        seeds.sort((a, b) => a.depth - b.depth);
        return { back: scaled(ctx, back, BOXES.back), mid: scaled(ctx, mid, BOXES.mid), front: scaled(ctx, front, BOXES.front), seeds, sprite: seedSprite(ctx) };
      });
    },

    frame(ctx, t, s) {
      const g = ctx.g;
      const input = window.FLPTHeroInput || null;
      const p = input ? { x: Number(input.x) || 0, y: Number(input.y) || 0, on: Math.max(0, Math.min(1, Number(input.on) || 0)) } : null;
      const o = offsets(t, p);
      const draw = (L, k) => g.drawImage(L.c, L.x + o[k].x, L.y + o[k].y);
      const u = t / LOOP;
      // the pointer in canvas pixels, for the seeds
      const pcx = p ? (W / 2) * (1 + p.x) : 0;
      const pcy = p ? (H / 2) * (1 + p.y) : 0;
      const seedsAt = (pred) => {
        for (const sd of s.seeds) {
          if (!pred(sd)) continue;
          const f = (sd.phase + u) % 1; // one crossing per loop: seamless
          let x = -160 + (W + 320) * f;
          let y = sd.y - sd.rise * f + sd.bob * Math.sin(TAU * (2 * u + sd.ph)) + 5 * Math.sin(TAU * (7 * u + sd.ph2));
          if (p && p.on > 0.01) {
            const dx = x - pcx;
            const dy = y - pcy;
            const d = Math.hypot(dx, dy) || 1;
            const R = 260;
            if (d < R) {
              const k = (1 - d / R) ** 2 * p.on;
              x += (dx / d) * 110 * k - (dy / d) * 70 * k;
              y += (dy / d) * 110 * k + (dx / d) * 70 * k;
            }
          }
          const k = (4 + 9 * sd.depth) / SPRITE_R; // the pappus's radius, 4 to 13 px
          const tilt = 0.35 * Math.sin(TAU * (3 * u + sd.ph3));
          g.save();
          g.globalAlpha = 0.3 + 0.62 * sd.depth;
          g.translate(x, y);
          g.rotate(tilt);
          g.scale(k, k);
          g.drawImage(s.sprite.c, -s.sprite.cx, -s.sprite.cy);
          g.restore();
        }
      };
      draw(s.back, 'back');
      draw(s.mid, 'mid');
      seedsAt((sd) => sd.depth < 0.6); // the far seeds drift behind the pony
      draw(s.front, 'front');
      seedsAt((sd) => sd.depth >= 0.6);
    },
  });
})();
