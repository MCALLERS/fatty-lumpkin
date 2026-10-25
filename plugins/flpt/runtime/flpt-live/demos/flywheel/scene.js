// The flywheel: every customer brings two more, until it doesn't. A Motion Solo in Riso (flpt-live demo, heavy print; from the K6 showcase).
// One world, a town on a sheet of paper: the hero's street, the wheel in the plaza, ~110 houses, and the edge.
// Colour means one thing: pink = word of mouth; teal = the wheel and the edge; yellow = a lit window (a customer).
// Fritsch-Carlson monotone cubic through [[t, v], ...]: a smooth count that never runs backwards
function monotone(keys) {
  const n = keys.length, xs = keys.map((k) => k[0]), ys = keys.map((k) => k[1]), d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) { if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; } const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b; if (h > 9) { const k = 3 / Math.sqrt(h); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; } }
  return (x) => {
    if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

FLPT.scene({
  style: 'riso',
  placement: 'solo',
  layers: ['canvas'],
  keyframes: ['one', 'friends', 'eight', 'spin', 'every', 'until', 'last', 'speeding', 'reached', 'edge'],

  setup(ctx) {
    const R = ctx.rng('town');
    const C = [2380, 1080], WR = 330;                       // the plaza and the wheel
    const H0 = [1150, 1420];                                  // the hero's street
    const BC = [2000, 1180], BRX = 2350, BRY = 1280;         // the town's edge: a hand-cut blob
    const blobR = (a) => 1 + 0.06 * Math.sin(2 * a + 0.7) + 0.045 * Math.sin(3 * a + 2.1) + 0.03 * Math.sin(5 * a + 4.0);
    const blob = (k = 1, n = 240) => Array.from({ length: n }, (_, i) => { const a = (i / n) * ctx.TAU, r = k * blobR(a); return [BC[0] + Math.cos(a) * BRX * r, BC[1] + Math.sin(a) * BRY * r]; });
    const inTown = (x, y, k = 1) => { const u = (x - BC[0]) / BRX, v = (y - BC[1]) / BRY; return Math.hypot(u, v) < k * blobR(Math.atan2(v, u)); };
    const houses = [{ x: H0[0] + 330, y: H0[1] + 60, s: 1.2 }];
    for (let gy = BC[1] - BRY * 1.2; gy < BC[1] + BRY * 1.2; gy += 168) for (let gx = BC[0] - BRX * 1.2; gx < BC[0] + BRX * 1.2; gx += 188) {
      const x = gx + R.n(40), y = gy + R.n(34);
      if (!inTown(x, y, 0.93)) continue;
      if (Math.hypot(x - C[0], y - C[1]) < WR + 230) continue;      // the plaza
      if (Math.hypot(x - H0[0], (y - H0[1] + 200) * 1.25) < 690) continue;  // the hero's green: the tree's stage
      if (Math.hypot(x - houses[0].x, y - houses[0].y) < 140) continue;
      houses.push({ x, y, s: R.r(0.85, 1.1) });
    }
    // the last neighbour: the easternmost house with room for two beans before the edge
    const edgeX = (y) => { let x = BC[0]; while (inTown(x, y)) x += 4; return x; };
    let L = null; for (const h of houses) if (Math.abs(h.y - BC[1]) < 500 && edgeX(h.y + 100) - h.x >= 430 && (!L || h.x > L.x)) L = h;
    const order = houses.filter((h) => h !== houses[0] && h !== L).map((h) => ({ h, d: Math.hypot(h.x - H0[0], h.y - H0[1]) + R.r(0, 380) })).sort((a, b) => a.d - b.d).map((o) => o.h);
    L.s = 1.3;
    const lit = [houses[0], ...order, L];
    lit.forEach((h, i) => { h.n = i; h.roof = R.pick([{ pink: 0.85, yellow: 0.9 }, { pink: 0.55, yellow: 1, teal: 0.2 }, { teal: 0.55, pink: 0.6 }]); });
    // the edge point beyond the last house, and the hero's last spot just inside it
    const N0 = [L.x + 95, L.y + 80];                                        // the last neighbour, at the door
    const E = [N0[0] + 215, N0[1] + 20];                                      // the hero's last spot, at the edge
    const dashes = Array.from({ length: 40 }, (_, i) => { const y = E[1] - 520 + i * 26; return [edgeX(y) + 2, y]; });
    // the word-of-mouth tree: gen 0 = the hero, then 2, 4, 8 fanned above him
    const tree = [{ g: 0, a: -Math.PI / 2, p: H0, r: 92, parent: -1 }];
    const ring = [0, 235, 405, 565], size = [92, 78, 64, 54], spread = [0, 1.05, 0.42, 0.2];
    for (let g = 1; g <= 3; g++) {
      for (const [pi, par] of tree.entries()) {
        if (par.g !== g - 1) continue;
        for (const s of [-1, 1]) {
          const a = par.a + s * spread[g] + R.n(0.03);
          tree.push({ g, a, p: [H0[0] + Math.cos(a) * ring[g], H0[1] - 60 + Math.sin(a) * ring[g] * 0.9], r: size[g], parent: pi });
        }
      }
    }
    const roads = [0.3, 1.25, 2.2, 3.1, 4.0, 5.1].map((a) => [[C[0] + Math.cos(a) * (WR + 150), C[1] + Math.sin(a) * (WR + 150)], [BC[0] + Math.cos(a) * BRX * 1.15, BC[1] + Math.sin(a) * BRY * 1.15]]);
    const tufts = Array.from({ length: 34 }, (_, i) => { const a = R.r(0, ctx.TAU), d = Math.sqrt(R.r(0.05, 1)); return [H0[0] + Math.cos(a) * 680 * d, H0[1] - 230 + Math.sin(a) * 500 * d]; }).filter((q) => Math.hypot(q[0] - H0[0], q[1] - H0[1]) > 160);
    return { C, WR, H0, BC, BRX, BRY, houses, lit, L, N0, E, tree, roads, dashes, tufts, edge: blob(1), blob };
  },

  frame(ctx, T, S) {
    const K = ctx.kit, cue = ctx.cue, ev = ctx.ev, EZ = ctx.EZ, M = K.MIX;
    const until = cue('until'), lerp = ctx.lerp, seg = ctx.seg;

    // ---- the count: how many houses are lit (integer steps; the S-curve the chart draws later)
    const KN = S.lit.length;
    // after the tree, a logistic: 10 % of the town on "spin", 90 % on "Until", everyone on "heard"
    const tm = (cue('spin') + until) / 2, tau = (until - cue('spin')) / (2 * Math.log(9)), logi = (t) => KN / (1 + Math.exp(-(t - tm) / tau));
    const NK = [[0, 0], [cue('one') + 0.25, 1], [cue('friends') + 0.2, 3], [cue('four') + 0.1, 7], [cue('eight') + 0.1, 15]];
    for (let t = cue('spin'); t < cue('people'); t += 0.75) NK.push([t, Math.max(16, logi(t))]);
    NK.push([cue('people'), KN - 1], [cue('last') + 0.86, KN], [cue('last') + 4, KN]);
    const countSmooth = monotone(NK);
    const countAt = (t) => { if (t >= NK[4][0]) return countSmooth(t); let v = 0; for (let i = 0; i < 5; i++) if (t >= NK[i][0]) v = NK[i][1]; return v; };
    const N = Math.floor(countAt(T) + 1e-6);

    // ---- the wheel: speed follows the growth; it never stops, it stops speeding up
    const t0w = cue('spin') - 0.1, D = until + 1.0 - t0w, WMAX = 2.1;
    const phi = (t) => { if (t <= t0w) return 0; const u = Math.min(1, (t - t0w) / D); return WMAX * D * (u ** 3 - u ** 4 / 2) + WMAX * Math.max(0, t - t0w - D) + 0.45 * ctx.spring(t - t0w, 'playful'); };
    const omega = T <= t0w ? 0 : WMAX * EZ.smooth((T - t0w) / D);

    // ---- the camera: one world, two tracks; the hard cut on "Until" is the piece's only cut
    const sp = (keys, p) => ctx.springTrack(keys, p);
    let cam;
    if (T < until) {
      const k = [[0, 1.75, S.H0[0] + 120, S.H0[1] - 40, 900, 600], [cue('friends') - 0.5, 1.45, S.H0[0], S.H0[1] - 90, 900, 610], [cue('more') - 0.3, 1.05, S.H0[0], S.H0[1] - 170, 960, 610],
        [cue('eight') - 0.6, 0.9, S.H0[0], S.H0[1] - 250, 960, 600], [cue('eight') + 0.55, 0.98, S.C[0], S.C[1], 1210, 560], [cue('flywheel') - 0.3, 1.08, S.C[0], S.C[1] + 10, 1360, 545], [cue('every') + 2.0, 1.16, S.C[0], S.C[1] + 10, 1380, 545]];
      const col = (j, p) => sp(k.map((r) => [r[0], r[j]]), p);
      // a small camera kick on the words that land: the numbers, "spin", "flywheel"
      const kick = [['friends', 0.03], ['four', 0.035], ['eight', 0.04], ['spin', 0.05], ['flywheel', 0.05]].reduce((k, [n, a]) => k + (T >= cue(n) - 0.03 ? a * Math.exp(-(T - cue(n) + 0.03) * 6) : 0), 0);
      cam = ctx.cam({ z: col(1, 'smooth') * (1 + kick), p: [col(2, 'heavy'), col(3, 'heavy')], to: [col(4, 'smooth'), col(5, 'smooth')] });
    } else {
      const k = [[until, 0.36, S.BC[0], S.BC[1] - 20, 960, 545], [until + 1.6, 0.52, S.BC[0] + 900, S.BC[1] - 20, 960, 545], [cue('last') - 0.9, 1.1, S.L.x + 30, S.L.y - 40, 840, 560],
        [cue('stop') - 0.55, 0.82, S.C[0], S.C[1] + 20, 700, 600], [cue('build') - 0.3, 1.75, (S.N0[0] + S.E[0]) / 2, S.E[1] - 70, 840, 610]];
      const col = (j, p) => sp(k.map((r) => [r[0], r[j]]), p);
      cam = ctx.cam({ z: col(1, 'heavy'), p: [col(2, 'heavy'), col(3, 'heavy')], to: [col(4, 'heavy'), col(5, 'heavy')] });
    }
    ctx.apply(cam);

    K.sheet();
    // ---- the far field: the town's ground, screened coarse, paper beyond the edge; roads and the plaza knocked out
    K.printed(10, { full: true }, () => {
      K.fill(K.hand(S.edge, 'ground', 3, 14), { yellow: 0.22, pink: 0.05 });
      for (const [i, r] of S.roads.entries()) K.line(r, {}, { w: 34, amt: 2, key: 'road' + i, knock: true });
      K.fill(K.hand(K.ellipsePts(S.C[0], S.C[1] + 40, S.WR + 200, S.WR + 160, 0, 60), 'plaza', 2.5), { teal: 0.12, yellow: 0.14 });
      K.fill(K.hand(K.ellipsePts(S.H0[0], S.H0[1] - 230, 720, 540, 0, 60), 'green', 2.5), { teal: 0.09, yellow: 0.24 });
      K.line([[S.houses[0].x - 10, S.houses[0].y + 20], [S.houses[0].x - 140, S.houses[0].y + 90], [S.H0[0] + 60, S.H0[1] + 150], [S.H0[0] - 260, S.H0[1] + 260]], {}, { w: 30, amt: 2, key: 'path', knock: true });
      for (const h of S.houses) if (h.n < N) { const r = h.s * 64 * 1.5 * (1 + 1.3 * (1 - ev(litTime(h.n), 0.45))); K.fill(K.circ(h.x, h.y - 20, r), { yellow: K.rad(h.x, h.y - 20, 0, r, [[0, 0.8], [0.5, 0.45], [1, 0.12]]) }, { over: true }); }
    });

    // ---- the world, one pitch
    K.printed(K.PITCH.world, { shapes: true }, () => {
      // houses: a lit window is a customer (yellow pops on with a glow)
      for (const [i, q] of S.tufts.entries()) { const sw = Math.sin(T * 2.2 + i) * 4; for (const d of [-9, 0, 9]) K.line([[q[0] + d, q[1]], [q[0] + d * 1.6 + sw, q[1] - 26 - Math.abs(d)]], M.green, { w: 5, taper: 0.4, amt: 0.4, key: 'tuft' + i + d, knock: true }); }
      for (const h of S.houses) house(h, h.n < N, T);
      // the edge of town: a rough teal rim; on "edge", a pink dashed edge prints over it
      K.rimLine(S.edge, 'edge', { w: 16, amt: 2.6 });
      wheel();
      tree();
      ripple();
      ending();
    });
    K.endSheet();
    ctx.screen();
    overlays();

    // ======== the parts ========
    function house(h, on, t) {
      const s = h.s * 64, x = h.x, y = h.y;
      K.fill(K.hand(K.boxPts(x - s / 2, y - s * 0.55, s, s * 0.85), 'hb' + h.n, 1), on ? { teal: 0.22, pink: 0.1, yellow: 0.12 } : { teal: 0.32, pink: 0.2, yellow: 0.08 });
      K.fill(K.hand([[x - s * 0.66, y - s * 0.5], [x, y - s * 1.05], [x + s * 0.66, y - s * 0.5]], 'hr' + h.n, 1), h.roof);
      const lt = on ? ev(litTime(h.n), 0.2) : 0;
      K.fill(K.rect(x - s * 0.3, y - s * 0.32, s * 0.24, s * 0.26), on ? { yellow: 1, pink: 0.15 * (1 - lt) } : { teal: 0.85, pink: 0.75, yellow: 0.5 });
      K.fill(K.rect(x + s * 0.08, y - s * 0.12, s * 0.2, s * 0.42), M.dark);
    }
    function litTime(n) { let a = 0, b = 40; for (let i = 0; i < 30; i++) { const m = (a + b) / 2; if (countAt(m) >= n + 1 - 1e-6) b = m; else a = m; } return b; }

    function seatPos(k, t) { const a = (k / 24) * ctx.TAU - phi(t) - Math.PI / 2; return [S.C[0] + Math.cos(a) * S.WR, S.C[1] + Math.sin(a) * S.WR]; }
    function wheel() {
      const c = S.C, rr = S.WR, a0 = -phi(T);
      // the stand: two olive-black legs to the plaza
      for (const s of [-1, 1]) K.line([[c[0], c[1]], [c[0] + s * 210, c[1] + rr + 150]], M.dark, { w: 20, amt: 1, key: 'leg' + s, knock: true });
      K.line([[c[0] - 250, c[1] + rr + 152], [c[0] + 250, c[1] + rr + 150]], M.dark, { w: 12, amt: 1, key: 'base', knock: true });
      K.speedLines(c[0], c[1], rr * 0.3, rr * 0.95, a0, Math.min(1.25, omega * 0.6), { pink: 0.9 }, 'whl');
      K.speedLines(c[0], c[1], rr * 1.25, rr * 1.42, a0 + 1, Math.min(0.9, omega * 0.4), { teal: 0.8 }, 'whl2');
      for (let i = 0; i < 12; i++) { const a = a0 + (i / 12) * ctx.TAU; K.line([[c[0] + Math.cos(a) * 30, c[1] + Math.sin(a) * 30], [c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr]], M.teal, { w: 7, amt: 0.6, key: 'spk' + i, knock: true }); }
      K.rim(c[0], c[1], rr * 0.62, 'inner', { w: 9, tones: { teal: 0.8 } });
      K.rim(c[0], c[1], rr, 'outer', { w: 26 });
      K.fill(K.circ(c[0], c[1], 40), M.dark); K.fill(K.circ(c[0] - 10, c[1] - 12, 9), {});
      // gondolas and their riders
      for (let k = 0; k < 24; k++) {
        const [px, py] = seatPos(k, T);
        K.fill(K.circ(px, py, 9), M.dark);
        K.line([[px, py], [px, py + 34]], M.dark, { w: 4, amt: 0.3, key: 'hang' + k, knock: true });
        K.fill(K.hand(K.arcPts(px, py + 40, 40, 0, Math.PI, 10), 'cup' + k, 0.8), k % 3 ? { pink: 0.85 } : M.coral);
      }
    }
    function riderSeat(i) { return i < 15 ? Math.round((i * 24) / 15) % 24 : [1, 3, 5, 6, 8, 10, 11, 13, 15, 17, 18, 20, 22, 23][(i - 15) % 14]; }

    function bean(p, r, key, o = {}) { if (r < 2) return; K.hero(p[0], p[1], r, { key, sprout: key === 'hero', ...o }); }
    function tree() {
      const tHop = cue('eight') + 0.55, appear = [cue('one') - 0.05, cue('friends') - 0.06, cue('four') - 0.08, cue('eight') - 0.08];
      const linkT = [0, cue('friends') - 0.3, cue('more') - 0.05, cue('four') + 0.4];
      // pink links: who told whom (before the riders leave for the wheel)
      if (T < tHop + 0.6) for (const [i, b] of S.tree.entries()) {
        if (b.parent < 0) continue;
        const pa = S.tree[b.parent].p, mid = [(pa[0] + b.p[0]) / 2 + (b.p[1] - pa[1]) * 0.12, (pa[1] + b.p[1]) / 2 - 40];
        const f = EZ.o2(ev(linkT[b.g] + (i % 4) * 0.04, 0.35)) * (1 - ev(tHop, 0.5));
        const side = Math.sign(b.p[0] - pa[0]) || 1, pr = S.tree[b.parent].r;
        if (f > 0) K.line([[pa[0] + side * pr * 0.75, pa[1] + pr * 0.1], mid, [b.p[0] - side * b.r * 0.7, b.p[1] + b.r * 0.25]], M.pink, { w: 11, taper: 0.2, amt: 1, key: 'lk' + i, frac: f });
        if (T < appear[b.g] && f >= 1) K.rim(b.p[0], b.p[1], b.r * 0.55, 'inv' + i, { tones: M.pink, w: 6, double: false });   // an invitation waiting
      }
      for (const [i, b] of S.tree.entries()) {
        const t0 = appear[b.g] + (b.g === 3 ? (i % 8) * 0.035 : b.g === 2 ? (i % 4) * 0.05 : 0);
        if (T < t0) continue;
        const pop = ctx.spring(T - t0, 'playful');
        const th = tHop + i * 0.045, u = EZ.io(seg(T, th, th + 0.55));
        if (b.g === 0 && T >= cue('build') - 0.8) continue;           // the hero has gone to the edge
        let p = b.p, r = b.r * pop;
        if (u > 0) { const sp2 = seatPos(riderSeat(i), Math.max(T, th + 0.55)); p = [lerp(b.p[0], sp2[0], u), lerp(b.p[1], sp2[1] + 18, u) - Math.sin(u * Math.PI) * 220]; r = lerp(b.r, 34, u); }
        const look = u > 0 ? [0, -1] : b.g === 0 ? (T > cue('friends') ? [0.6, -0.8] : [0.2, 0.2]) : [-Math.cos(b.a) * 0.6, 0.6];
        bean(p, r, i === 0 ? 'hero' : 'b' + i, { mood: u > 0 ? 'happy' : b.g === 0 ? 'happy' : 'smile', look, arms: b.g === 0 && T > cue('friends') && T < cue('more') ? [2.4, 2.5] : u > 0 ? [2.5, 2.5] : undefined, shadow: u === 0 });
      }
      // more riders on "Every customer brings two more"
      for (let j = 15; j < 24; j++) { const t0 = cue('every') + (j - 15) * 0.13; if (T < t0) continue; const sp2 = seatPos(riderSeat(j), T); bean([sp2[0], sp2[1] + 18], 34 * ctx.spring(T - t0, 'playful'), 'r' + j, { mood: 'happy', arms: [2.5, 2.5], shadow: false }); }
    }
    function ripple() {   // "Until it doesn't": the word spreads out, hits the edge, and stops there
      const a = until - 0.05, u = seg(T, a, cue('until') + 0.62);
      if (u <= 0 || T > a + 2.2) return;
      const k = EZ.o2(u), fade = 1 - seg(T, a + 0.9, a + 2.2);
      K.line(S.blob(lerp(0.16, 0.985, k), 120), { pink: 0.95 * fade }, { closed: true, w: 26 * (1 - 0.4 * k), rough: 0.5, amt: 3, key: 'rip' });
    }
    function ending() {
      // the last neighbour: waiting at the door, then lit
      const L = S.L, tl = cue('last') - 0.1;
      if (T >= tl) bean(S.N0, 56 * ctx.spring(T - tl, 'playful'), 'neighbour', { mood: T > cue('last') + 0.86 ? 'happy' : 'wow', look: [-0.7, -0.4] });
      if (T >= tl - 0.6 && T < cue('stop')) { const f = EZ.o2(ev(tl - 0.6, 0.7)); K.line([[L.x - 440, L.y + 190], [L.x - 160, L.y + 240], [S.N0[0] - 40, S.N0[1] + 30]], M.pink, { w: 8, taper: 0.25, amt: 1.5, key: 'lastlink', frac: f }); }
      // the hero at the edge, looking out
      const tb = cue('build') - 0.8;
      if (T >= tb) bean(S.E, 92, 'hero', { mood: T >= cue('edge') ? 'wow' : 'smile', look: T >= cue('edge') - 0.3 ? [1, -0.2] : [0.4, 0.3], arms: T >= cue('edge') ? [0.6, 2.4] : undefined });
      // the edge, marked: a pink dash along the rim near the hero
      const te = cue('edge') - 0.12;
      if (T >= te) {
        const f = EZ.o3(ev(te, 0.6)), P = S.dashes;
        for (let d = 0; d < 10; d++) { const seg2 = P.slice(d * 4, d * 4 + 3); if (seg2.length === 3 && d / 10 < f) K.line(seg2, M.pink, { w: 20, amt: 0.6, taper: 0.15, key: 'dash' + d, knock: true }); }
      }
    }

    function overlays() {
      // the round counter: 1, 2, 4, 8 slam in on the words
      const rounds = [[cue('one'), '1'], [cue('friends'), '2'], [cue('four'), '4'], [cue('eight'), '8']];
      let cur = null; for (const r of rounds) if (T >= r[0] - 0.04) cur = r;
      if (cur && T < cue('spin') - 0.3) K.tag(cur[1], 196, 190, 120, { s: K.popS(cur[0] - 0.04) * (1 - ev(cue('spin') - 0.6, 0.25)), rot: -0.05, id: 'round' });
      // the poster: Every customer / brings two more.
      const tp = cue('every') - 0.15;
      if (T >= tp && T < until) {
        const x = 118, y1 = 330, y2 = 468, size = 104, s = ctx.spring(T - tp, 'snappy');
        K.sheet([60, 190, 980, 560]);
        K.printed(K.PITCH.fine, { box: [60, 190, 980, 560], shapes: true, T: { s: 1, x: 0, y: (1 - s) * 40 } }, () => {
          K.fill(K.hand(K.boxPts(84, 240, 860, 290), 'postsh', 1.6), { pink: 0.7 });
          K.fill(K.hand(K.boxPts(70, 222, 860, 290), 'post', 1.6), {});
          K.rimLine(K.boxPts(70, 222, 860, 290), 'postrim', { w: 7, amt: 1.4, rough: 0.45, tones: M.blue });
          K.type('Every customer', x, y1, size, M.blue, { key: 'p1', frac: EZ.o2(ev(cue('every') - 0.1, 0.5)), id: 'poster-1' });
          const w1 = K.typeW('brings ', size);
          K.type('brings', x, y2, size, M.blue, { key: 'p2', frac: EZ.o2(ev(cue('every') + 0.85, 0.35)), id: 'poster-2' });
          K.type('two more.', x + w1, y2, size, M.pink, { key: 'p3', frac: EZ.o2(ev(cue('every') + 1.25, 0.4)), id: 'poster-3' });
        });
        K.endSheet();
      }
      chart();
    }
    function chart() {   // the S-curve: steep, then flat; the gap above it is everyone not reached yet
      const tin = cue('stop') - 0.5, tout = cue('build') - 0.35;
      if (T < tin || T > tout + 0.8) return;
      const s = ctx.spring(T - tin, 'smooth') - ctx.spring(T - tout, 'heavy');
      if (s <= 0.01) return;
      const X = 1066, Y = 140, Wd = 800, Hd = 590, oy = (1 - s) * 760;
      K.sheet([X - 40, Math.max(0, Y - 40 + oy), X + Wd + 40, Math.min(1080, Y + Hd + 40 + oy)]);
      K.printed(K.PITCH.fine, { box: [X - 40, Y - 40, X + Wd + 40, Y + Hd + 40], shapes: true, T: { s: 1, x: 0, y: oy } }, () => {
        const P = K.boxPts(X, Y, Wd, Hd);
        K.fill(K.hand(K.boxPts(X + 16, Y + 18, Wd, Hd), 'chsh', 1.4), { teal: 0.55, pink: 0.25 });
        K.fill(K.hand(P, 'ch', 1.4), {});
        K.rimLine(P, 'chrim', { w: 7, amt: 1.2, rough: 0.45 });
        const ox = X + 90, oy0 = Y + Hd - 80, gw = Wd - 160, gh = Hd - 210, t1 = until + 6.5;
        const pt = (u) => [ox + u * gw, oy0 - (countSmooth(u * t1) / KN) * gh];
        const curve = Array.from({ length: 90 }, (_, i) => pt(i / 89));
        const ceil = oy0 - gh;
        // the gap: everyone it hadn't reached yet (prints left to right on "hadn't reached")
        const gf = EZ.io(ev(cue('reached') - 0.1, 1.0));
        if (gf > 0) { K.clipTo(K.rect(ox, ceil - 4, gw * gf, gh + 8)); K.fill(K.poly([[ox, ceil], [ox + gw, ceil], ...curve.slice().reverse()]), { pink: 0.5 }); K.unclip(); }
        K.line([[ox, oy0 - gh - 30], [ox, oy0], [ox + gw + 20, oy0]], M.dark, { w: 6, amt: 0.8, key: 'axes', knock: true });
        for (let d = 0; d < 14; d++) K.line([[ox + (d / 14) * gw, ceil], [ox + ((d + 0.55) / 14) * gw, ceil]], M.teal, { w: 6, amt: 0.4, key: 'ceil' + d, knock: true });
        K.type('EVERYONE IN TOWN', ox + 14, ceil - 22, 34, M.teal, { key: 'ceilt', id: 'ceiling' });
        const f = lerp(0.42, 1, EZ.io(seg(T, tin + 0.35, cue('speeding') + 0.5)));
        K.line(curve, M.pink, { w: 12, taper: 0.06, amt: 0.6, key: 'curve', frac: f, knock: true });
        // "the speed was never the wheel": the steep middle reprints in ink-blue
        const nv = ev(cue('never') - 0.05, 0.45);
        if (nv > 0) K.line(curve.slice(34, 64), M.blue, { w: 16, amt: 0.6, key: 'steep', frac: EZ.o2(nv), knock: true });
        const tip = K.subPath(curve, f).at(-1);
        K.fill(K.circ(tip[0], tip[1], 15), M.blue);
      });
      K.endSheet();
    }
  },

  hits(ctx) {
    const c = ctx.cue;
    return [
      { t: c('one'), kind: 'pop', gain: -6 }, { t: c('friends'), kind: 'pop', gain: -4 }, { t: c('four'), kind: 'pop', gain: -4 }, { t: c('eight'), kind: 'pop', gain: -3 },
      { t: c('eight') + 0.5, kind: 'whoosh', gain: -8 }, { t: c('every'), kind: 'tick', gain: -8 }, { t: c('until') - 0.02, kind: 'thump', gain: -2 },
      { t: c('last') + 0.86, kind: 'chime', gain: -6 }, { t: c('stop') - 0.5, kind: 'swish', gain: -9 }, { t: c('build') - 0.35, kind: 'swish', gain: -10 }, { t: c('edge') - 0.1, kind: 'tick', gain: -6 },
    ];
  },
});
