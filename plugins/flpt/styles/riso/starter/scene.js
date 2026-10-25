// Riso starter: a dawn on a printed hill. The bean watches the sun come up, hops, and a word presses onto the sign
// beside it, each letter's plates sliding into register; then the sun sets and the word wipes off, so it ends where
// it began (the Gallery's 7 s loop, 2-9 s, has no seam: drifts and sways repeat every 7 s). Copy it and change the
// world: the grammar stays.
// One far layer (sky, sun, far hills) on a coarse screen and its own camera depth, one world layer at the world pitch
// over it, nothing painted. The picture keeps the middle (a 4:5 crop of it still works) and, as a Duet, leaves the
// presenter's corner (x 0-380, y 700-1080) to the ground.
FLPT.scene({
  style: 'riso',
  layers: ['canvas'],
  keyframes: ['sun', 'hop', 'word', 'push', 'set'],

  setup(ctx) {
    const hill = (y0, amp, seed, x0, x1, n = 60) => {
      const r = ctx.rng('hill', seed), f1 = r.r(0.002, 0.0035), f2 = r.r(0.006, 0.01), p1 = r.r(0, 6), p2 = r.r(0, 6), P = [];
      for (let i = 0; i <= n; i++) { const x = x0 + (i / n) * (x1 - x0); P.push([x, y0 - amp * (0.75 * Math.sin(x * f1 + p1) + 0.25 * Math.sin(x * f2 + p2))]); }
      P.push([x1, 2200], [x0, 2200]);
      return P;
    };
    const R = ctx.rng('starter');
    const tufts = Array.from({ length: 16 }, (_, i) => [520 + i * 62 + R.n(16), 880 + R.n(26)]).filter((q) => Math.abs(q[0] - 740) > 150);
    const birds = Array.from({ length: 3 }, (_, i) => ({ x: 520 + i * 110 + R.n(30), y: 250 + R.n(40), s: R.r(0.8, 1.2) }));
    const puff = (cx, cy, w, seed) => { const r = ctx.rng('cloud', seed), P = []; for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2, k = 1 + 0.16 * Math.sin(a * 5 + r.r(0, 6)) + 0.08 * Math.sin(a * 9 + r.r(0, 6)); P.push([cx + Math.cos(a) * w * k, cy + Math.sin(a) * w * 0.34 * k * (Math.sin(a) > 0 ? 0.55 : 1)]); } return P; };
    const clouds = [puff(1360, 240, 210, 'a'), puff(250, 420, 140, 'b')];
    const flowers = Array.from({ length: 22 }, (_, i) => ({ x: 380 + i * 66 + R.n(22), y: 960 + R.n(60) + (i % 2) * 40, r: R.r(9, 14), c: i % 3 })).filter((f) => Math.abs(f.x - 740) > 150);
    return { far: hill(700, 60, 'far', -800, 2700), mid: hill(800, 44, 'mid', -800, 2700), near: hill(915, 30, 'near', -800, 2700), tufts, birds, clouds, flowers };
  },

  frame(ctx, T, S) {
    const K = ctx.kit, M = K.MIX, cue = ctx.cue, EZ = ctx.EZ, sp = ctx.spring, lerp = ctx.lerp, seg = ctx.seg;
    const duet = !!ctx.bubble;
    // the camera: wide, then a slow push toward the bean and the sign; as a Duet the picture sits further right
    const dx = duet ? 150 : 0;
    const z = ctx.springTrack([[0, 1.14], [cue('sun') - 0.4, 1.04], [cue('push'), 1.16], [cue('set') - 0.3, 1.14]], 'heavy');
    const cam = ctx.cam({ z, p: [ctx.springTrack([[0, 950], [cue('push'), 953], [cue('set') - 0.3, 950]], 'heavy'), ctx.springTrack([[0, 660], [cue('sun') - 0.4, 600], [cue('push'), 660]], 'heavy')], to: [960 + dx, 560] });
    const day = sp(T - (cue('sun') - 0.35), 'heavy') * (1 - EZ.io(seg(T, cue('set'), cue('set') + 0.6)));   // up, then down again (all back by set + 0.6)
    const sunY = lerp(860, 430, day), sun = [700, sunY];
    const loop = (T * Math.PI * 2) / 7;   // one turn per 7 s: what drifts or sways is back where it was when the loop wraps

    // ---- far: the sky, the sun and the far hills, on a coarse screen; depth 0.4 (it moves less than the world)
    ctx.apply(K.depth(cam, 0.4));
    K.sheet();
    K.printed(K.PITCH.field, { full: true }, () => {
      const warm = seg(T, cue('sun') - 0.4, cue('sun') + 1.2) * (1 - seg(T, cue('set'), cue('set') + 0.5));
      K.fill(K.rect(-2000, -2000, 6000, 6000), { teal: K.lin(0, -100, 0, 820, [[0, 0.72], [1, 0.16]]), yellow: K.lin(0, 200, 0, 820, [[0, 0], [1, 0.25 + 0.3 * warm]]), pink: K.lin(0, 300, 0, 820, [[0, 0], [1, 0.12 * warm]]) });
      K.fill(K.circ(sun[0], sun[1], 300), { yellow: K.rad(sun[0], sun[1], 90, 300, [[0, 0.85], [1, 0]]) }, { over: true });
      K.fill(K.circ(sun[0], sun[1], 92), M.coral);
      for (const [i, c] of S.clouds.entries()) K.place({ x: (16 - i * 6) * Math.sin(loop + i) }, () => K.fill(K.hand(c, 'cloud' + i, 2.5), {}));   // paper clouds: knocked out
      for (const [i, b] of S.birds.entries()) {
        const f = Math.sin(loop * 8 + i * 2) * 10 * b.s, bx = b.x + 40 * Math.sin(loop + i * 1.7), by = b.y + Math.sin(loop + i) * 6;
        K.line([[bx - 26 * b.s, by - f], [bx, by + 6], [bx + 26 * b.s, by - f]], M.dark, { w: 6, taper: 0.3, amt: 0.4, key: 'bird' + i, knock: true });
      }
      K.fill(K.hand(S.far, 'far', 2), { teal: 0.55, yellow: 0.7, pink: 0.15 });
    });

    // ---- the world: the hills the bean stands on, the sign, the word
    ctx.apply(cam);
    K.printed(K.PITCH.world, { shapes: true }, () => {
      K.fill(K.hand(S.mid, 'mid', 2), { teal: 0.68, yellow: 0.9 });
      K.fill(K.hand(S.near, 'near', 2), { teal: 0.95, yellow: 1, pink: 0.18 });
      for (const [i, f] of S.flowers.entries()) {
        if (duet && f.x < 560) continue;   // the presenter's corner stays plain ground
        const sw = Math.sin(loop * 2 + i) * 3, tones = [M.pink, M.coral, { yellow: 1 }][f.c];
        K.line([[f.x, f.y + 30], [f.x + sw, f.y]], M.dark, { w: 4, amt: 0.3, key: 'st' + i, knock: true });
        for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2 + i; K.fill(K.circ(f.x + sw + Math.cos(a) * f.r, f.y + Math.sin(a) * f.r, f.r * 0.7), tones); }
        K.fill(K.circ(f.x + sw, f.y, f.r * 0.55), f.c === 2 ? M.coral : { yellow: 1 });
      }
      for (const [i, q] of S.tufts.entries()) for (const d of [-8, 0, 8]) K.line([[q[0] + d, q[1]], [q[0] + d * 1.5 + Math.sin(loop * 2 + i) * 3, q[1] - 26 - Math.abs(d)]], M.dark, { w: 5, taper: 0.4, amt: 0.3, key: 'tuft' + i + d, knock: true });
      // the sign: a post and a paper card with a teal rim
      const sx = 1075, sy = 640, cw = 440, ch = 196;
      K.line([[sx, sy + ch / 2 - 10], [sx + 4, 920]], M.dark, { w: 20, amt: 0.8, key: 'post', knock: true });
      K.fill(K.hand(K.boxPts(sx - cw / 2 + 14, sy - ch / 2 + 16, cw, ch), 'signsh', 1.5), { teal: 0.55, pink: 0.45, yellow: 0.2 });
      K.fill(K.hand(K.boxPts(sx - cw / 2, sy - ch / 2, cw, ch), 'sign', 1.5), {});
      K.rimLine(K.boxPts(sx - cw / 2, sy - ch / 2, cw, ch), 'signrim', { w: 8, amt: 1.2, rough: 0.45 });
      // the word: pressed in on "word"; on "set" a wipe takes its inks back off the card, left to right
      const wipe = EZ.io(seg(T, cue('set'), cue('set') + 0.35));
      if (wipe < 1) K.letters('hello', sx, sy + 50, 140, M.blue, { at: cue('word'), stagger: 0.07, from: 'press', amount: 0.8, align: 'center', plates: { pink: [34, -22], yellow: [-26, 20] }, knock: false, key: 'hello', id: 'sign' });
      if (wipe > 0) K.erase(K.rect(sx - cw / 2 + 12, sy - ch / 2 + 12, (cw - 24) * wipe, ch - 24));
      // the bean: watches the sun, hops on "hop", waves while the word prints
      const hu = seg(T, cue('hop') - 0.05, cue('hop') + 0.5), hop = Math.sin(Math.PI * hu) * 70;
      const waving = T > cue('hop') && T < cue('push') + 0.6;
      const wave = waving ? 2.2 + 0.45 * Math.sin((T - cue('hop')) * 9) : 0.35;
      const dusk = T > cue('set') + 0.3;   // back to the opening pose, watching the sun go down
      K.hero(740, 770, 138, { key: 'hero', hop, mood: dusk ? 'smile' : T > cue('word') + 0.4 ? 'happy' : T > cue('sun') ? 'wow' : 'smile', look: !dusk && T > cue('word') - 0.1 ? [0.9, -0.1] : [-0.6, -0.8], arms: [0.35, wave] });
    });
    K.endSheet();
  },

  hits(ctx) {
    const c = ctx.cue;
    return [
      { t: c('sun') - 0.3, kind: 'riser', gain: -10 },
      { t: c('hop') - 0.04, kind: 'pop', gain: -5 },
      ...[0, 1, 2, 3, 4].map((i) => ({ t: c('word') + i * 0.07, kind: 'tick', gain: -9 })),
      { t: c('word') + 0.5, kind: 'chime', gain: -8 },
      { t: c('push'), kind: 'swish', gain: -12 },
      { t: c('set'), kind: 'swish', gain: -12 },
    ];
  },
});
