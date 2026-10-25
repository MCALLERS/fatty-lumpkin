// Riso demo: a world opens in a printed circle (an iris with a dry-brush teal rim) on a dusk sea; the bean rows in,
// the sun goes down behind the bands of water, a flag runs up the mast. Seven seconds, no narration.
// Placed as a Duet it moves right and leaves the presenter's corner (x 0-380, y 700-1080) to plain sea.
FLPT.scene({
  style: 'riso',
  layers: ['canvas'],
  keyframes: ['iris', 'boat', 'sun', 'flag'],

  setup(ctx) {
    const band = (y, amp, len, seed) => { const r = ctx.rng('band', seed); return { y, amp, len, ph: r.r(0, 6), sp: r.r(0.6, 1.1) }; };
    return { bands: [band(650, 10, 260, 'a'), band(720, 13, 300, 'b'), band(800, 16, 340, 'c'), band(895, 20, 380, 'd')] };
  },

  frame(ctx, T, S) {
    const K = ctx.kit, M = K.MIX, cue = ctx.cue, EZ = ctx.EZ, sp = ctx.spring, lerp = ctx.lerp, seg = ctx.seg;
    const dx = ctx.bubble ? 170 : 0;
    const z = ctx.springTrack([[0, 1.04], [cue('flag') - 0.6, 1.16]], 'heavy');
    const cam = ctx.cam({ z, p: [980 + dx * 0.3, ctx.springTrack([[0, 560], [cue('flag') - 0.6, 520]], 'heavy')], to: [960 + dx, 540] });
    const ir = lerp(170, 1300, EZ.io(seg(T, 0, cue('iris') + 0.75)));   // the iris, opening
    const C = [1000 + dx * 0.5, 560], open = ir < 1250;
    const sunY = lerp(420, 640, EZ.io(seg(T, cue('sun') - 0.4, cue('sun') + 2.6)));
    const wave = (b, x, t) => b.y + b.amp * Math.sin(x / b.len * Math.PI * 2 + b.ph + t * b.sp * 2.2);
    const bandPts = (b, t, x0, x1) => { const P = []; for (let x = x0; x <= x1; x += 24) P.push([x, wave(b, x, t)]); P.push([x1, 1600], [x0, 1600]); return P; };

    // ---- far: the dusk sky and the sun, on a coarse screen at depth 0.5
    ctx.apply(K.depth(cam, 0.5));
    K.sheet();
    K.printed(K.PITCH.field, { full: true }, () => {
      const inside = () => {
        K.fill(K.rect(-1000, -1000, 4000, 4000), { pink: K.lin(0, 0, 0, 700, [[0, 0.46], [1, 0.14]]), yellow: K.lin(0, 0, 0, 700, [[0, 0.36], [1, 0.78]]) });
        K.fill(K.circ(1300, sunY, 230), { pink: K.rad(1300, sunY, 80, 230, [[0, 0.5], [1, 0]]) }, { over: true });
        K.fill(K.circ(1300, sunY, 96), M.coral);
      };
      if (open) K.iris(C[0], C[1], ir, 'irisfar', inside, { rim: false }); else inside();
    });
    // ---- the world: bands of sea (each a little further in: slower), the boat, the bean, the flag
    ctx.apply(cam);
    K.printed(K.PITCH.world, { shapes: true }, () => {
      if (open) K.clipTo(K.circ(C[0], C[1], ir));   // clip only: the far layer's sky shows through where nothing is printed
      const tones = [{ teal: 0.55, pink: 0.1 }, { teal: 0.72, pink: 0.18 }, { teal: 0.88, pink: 0.3 }, { teal: 1, pink: 0.45, yellow: 0.1 }];
      S.bands.forEach((b, i) => {
        if (i === 2) boat();
        K.fill(K.hand(bandPts(b, T, -400, 2400), 'sea' + i, 1.5), tones[i]);
        for (let k = 0; k < 6; k++) { const x = ((k * 340 + T * (40 + i * 25)) % 2200) - 200; K.line([[x, wave(b, x, T) + 22], [x + 60, wave(b, x + 60, T) + 22]], {}, { w: 4, amt: 0.4, taper: 0.3, key: 'glint' + i + k, knock: true }); }
      });
      if (open) { K.unclip(); K.rim(C[0], C[1], ir, 'iris', { w: 16, tones: { teal: 1 }, mask: true, knock: true }); }
    });
    K.endSheet();

    function boat() {
      const u = sp(T - (cue('boat') - 0.5), 'smooth'), bx = lerp(-400, 840 + dx * 0.4, u), by = 700 + Math.sin(T * 2.2) * 8, rot = 0.05 * Math.sin(T * 1.7) - (1 - u) * 0.12;
      if (bx < -380) return;
      K.place({ x: bx, y: by, rot, s: 1.3 }, () => {
        // the mast and its flag (runs up on "flag", the word pressed onto it)
        K.line([[34, -10], [38, -330]], M.dark, { w: 9, amt: 0.4, key: 'mast', knock: true });
        const fu = sp(T - (cue('flag') - 0.1), 'smooth'), fy = lerp(-60, -310, fu), fl = Math.sin(T * 6) * 6;
        if (T > cue('flag') - 0.4) {
          const P = [[40, fy], [300, fy + 10 + fl], [300, fy + 104 - fl], [40, fy + 96]];
          K.fill(K.hand(P, 'flag', 1.2), { yellow: 1 });
          K.letters('ahoy', 170, fy + 72, 64, M.blue, { face: 'mono', tracking: 6, align: 'center', at: cue('flag') + 0.25, stagger: 0.06, from: 'press', amount: 0.7, id: false, key: 'ahoy' });
        }
        K.hero(-30, -78, 74, { key: 'hero', mood: T > cue('flag') + 0.4 ? 'happy' : 'smile', look: T > cue('sun') - 0.3 ? [0.8, -0.5] : [0.6, 0.1], arms: [0.5, T > cue('flag') ? 2.3 + 0.4 * Math.sin(T * 8) : 1.2], shadow: false });
        K.fill(K.hand([[-190, -6], [200, -6], [150, 70], [-140, 70]], 'hull', 1.4), M.coral);
        K.line([[-180, 20], [190, 20]], {}, { w: 6, amt: 0.4, key: 'stripe', knock: true });
      });
      // the flag's word, boxed on screen for the checks (place() frames aren't registered)
      if (T > cue('flag') + 0.25) {
        const s = cam.z, fu = sp(T - (cue('flag') - 0.1), 'smooth'), fy = lerp(-60, -310, fu);
        const k = 1.3, wx = bx + 170 * k, wy = by + (fy + 72) * k;   // rot is small; the box allows for it
        ctx.registerBox('flag', 'ahoy', { x: cam.tx + s * (wx - 100 * k), y: cam.ty + s * (wy - 52 * k), w: s * 200 * k, h: s * 66 * k });
      }
    }
  },

  hits(ctx) {
    const c = ctx.cue;
    return [
      { t: c('iris') - 0.3, kind: 'swish', gain: -8 },
      { t: c('boat') - 0.1, kind: 'whoosh', gain: -10 },
      { t: c('sun'), kind: 'sub', gain: -12 },
      { t: c('flag') - 0.1, kind: 'riser', gain: -12 },
      ...[0, 1, 2, 3].map((i) => ({ t: c('flag') + 0.25 + i * 0.06, kind: 'tick', gain: -9 })),
    ];
  },
});
