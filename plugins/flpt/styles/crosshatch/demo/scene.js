// Crosshatch demo: the plan, then the doing. 7 s, on twos, no narration.
// Two cliffs on a ruled sheet. A red pencil plan dashes a bridge across the gap; then the bridge is inked for real,
// plank by plank, shaded with hatch; the hero hops across and lands on the far side. The camera pushes in a little
// and follows the hero across (the paper's rules drift slower than the cliffs: parallax), then settles.
// The style's grammar in one piece: plan (red dashes) apart from the doing (ink), and the plan stays in view under
// the finished bridge, labelled; the boil, shading by density,
// springs for anything with mass. Duet: everything sits right of x 420, so the presenter's corner stays calm.
FLPT.scene({
  style: 'crosshatch',
  layers: ['canvas'],
  keyframes: ['plan', 'build', 'cross', 'arrive'],

  setup(ctx) {
    const K = ctx.kit, R = ctx.rng('cliffs');
    const cliff = (x0, x1, crest, flare) => {   // a rock mass: a jagged crest, rough sides flaring out to the bottom
      const P = [[x0 - flare, 1240]];
      for (let k = 1; k < 6; k++) P.push([x0 - flare * (1 - k / 6) + R.n(10), crest + (1240 - crest) * (1 - k / 6)]);
      for (let k = 0; k <= 10; k++) { const x = x0 + ((x1 - x0) * k) / 10; P.push([x, crest + R.n(14)]); }
      for (let k = 1; k < 6; k++) P.push([x1 + flare * (k / 6) + R.n(10), crest + (1240 - crest) * (k / 6)]);
      P.push([x1 + flare, 1240]);
      return P;
    };
    const L = cliff(480, 790, 600, 40), Rr = cliff(1170, 1520, 590, 40);
    const tufts = [[540, 598], [610, 596], [720, 600], [1230, 588], [1420, 590], [1480, 586]];
    const arch = K.arcPts(980, 940, 389.5, Math.PI * 1.338, Math.PI * 1.662, 24);   // the bridge's arch, cliff edge to cliff edge
    const planks = Array.from({ length: 9 }, (_, i) => K.pointAt(arch, (i + 0.5) / 9));
    return { L, Rr, arch, planks, tufts };
  },

  frame(ctx, T, S) {
    const K = ctx.kit, C = K.C, g = ctx.g, cue = ctx.cue, ev = ctx.ev, EZ = ctx.EZ, clamp = ctx.clamp, lerp = ctx.lerp;
    const tPlan = cue('plan'), tBuild = cue('build'), tCross = cue('cross'), tArrive = cue('arrive');
    // the hero's walk: hop plank to plank, then onto the far cliff
    const path = [[650, 532], ...S.planks.map(([x, y]) => [x, y - 58]), [1330, 522]];
    const step = (tArrive - tCross) / (path.length - 1);
    const k = clamp((T - tCross) / step, 0, path.length - 1), i0 = Math.min(path.length - 2, Math.floor(k)), u = k - i0;
    const hp = T < tCross ? path[0] : [lerp(path[i0][0], path[i0 + 1][0], u), lerp(path[i0][1], path[i0 + 1][1], u) - 60 * Math.sin(u * Math.PI)];
    // a push in while the plan is made, then the camera follows the hero across; in a Duet it looks further left, so
    // the cliffs sit clear of the presenter's corner
    const duet = !!ctx.bubble, px0 = duet ? 760 : 920, pan = duet ? 95 : 110;
    const cam = ctx.cam({ z: 1.22 + 0.16 * EZ.io(ctx.seg(T, 0, tCross)), p: [lerp(px0, px0 + pan, EZ.io(ctx.seg(T, tCross, tArrive + 0.4))), 640], to: [960, 560] });

    // the sheet drifts at half depth; the cliffs, the bridge and the hero are the world
    ctx.apply(K.depth(cam, 0.5));
    K.paperSheet('demo', { x0: -200, y0: -200, x1: 2120, y1: 1280 });
    ctx.apply(cam);
    // the river far below, in the gap
    K.paint(K.box(700, 1040, 560, 240), { fill: C.sky, key: 'river', w: 2.6, tex: [{ k: 'pencil', c: C.skyL, al: 0.6, per: 60, a: 0.05, len: 30 }, { k: 'hatch', a: 0.04, gap: 9, c: C.skyD, al: 0.55, dash: [20, 70] }] });
    for (const [P, key] of [[S.L, 'cl'], [S.Rr, 'cr']]) {
      const x0 = P[1][0], x1 = P[P.length - 2][0];
      K.paint(P, { fill: '#cdb48c', key, w: 3.4, tex: [
        { k: 'pencil', c: '#e6d2ac', al: 0.55, per: 120, dens: (x, y) => clamp(1 - (y - 560) / 500) },
        { k: 'hatch', a: 0.8, gap: 6, al: 0.5, dens: (x, y) => clamp((y - 640) / 360 + (key === 'cl' ? (x - x0) / (x1 - x0) * 0.3 : (x1 - x) / (x1 - x0) * 0.1)) },
        { k: 'cross', a: 0.7, gap: 7, al: 0.35, dens: (x, y) => clamp((y - 820) / 260) },
      ] });
      K.ink(P.slice(6, 17).map(([x, y]) => [x, y + 26]), { w: 2, color: 'rgba(58,36,23,0.45)', key: key + 'ledge' });
    }
    S.tufts.forEach(([x, y], i) => K.ink([[x - 12, y + 2], [x - 4, y - 18], [x, y], [x + 6, y - 22], [x + 12, y + 2]], { w: 2.4, color: C.green, key: 'tuft' + i, amt: 0.8 }));

    // the plan: red dashes across the gap, and its label. When the building starts, the plan steps down under the
    // bridge (drawn after the planks), so the red dashes stay readable beside the ink and the label keeps its line.
    const aside = ctx.spring(T - tBuild, 'smooth');
    const plan = () => K.planInk(aside > 0 ? S.arch.map(([x, y]) => [x, y + 30 * aside]) : S.arch, { key: 'plan', frac: ev(tPlan, 0.8), al: 1 - 0.2 * clamp(aside) });
    if (T < tBuild) plan();
    if (T >= tPlan + 0.3) K.hand('plan', 900, 690, 66, { weight: 700, color: C.red, key: 'planlbl', id: 'label:plan', frac: ev(tPlan + 0.3, 0.45), rot: -0.04 });

    // the doing: the bridge inked for real, plank by plank, then its rope
    S.planks.forEach(([x, y], i) => {
      const s = ctx.spring(T - (tBuild + i * 0.09), 'playful');
      if (s <= 0.001) return;
      const P = K.xform(K.box(-34, -14, 68, 30), x, y, Math.atan2(y - 940, x - 980) + Math.PI / 2, s);
      K.paint(P, { fill: C.wood, key: 'plank' + i, w: 2.8, tex: [{ k: 'hatch', a: 0.05, gap: 5, c: C.woodD, al: 0.6, dens: (px, py) => clamp((py - y + 14) / 30 + 0.2) }, { k: 'pencil', c: C.woodL, al: 0.5, per: 40 }] });
    });
    const rope = ev(tBuild + 0.4, 0.8);
    if (rope > 0) {
      K.ink(S.arch.map(([x, y]) => [x, y - 70]), { w: 3, key: 'rope', frac: rope, double: true });
      S.planks.forEach(([x, y], i) => { if ((i + 1) / 9 <= rope) K.ink([[x, y - 12], [x, y - 70]], { w: 2, key: 'post' + i }); });
    }

    if (T >= tBuild) plan();

    // the hero
    const land = ctx.spring(T - tArrive, 'playful');
    const squash = T >= tArrive ? 0.45 * (1 - land) : T >= tCross && u > 0.85 ? 0.25 : 0;
    K.hero(hp[0], hp[1], 68, { key: 'hero', mood: T >= tArrive ? 'happy' : T >= tCross ? 'wow' : 'smile', look: T < tPlan + 0.9 ? [1, -0.2] : [0.6, 0.3], squash, shadow: T < tCross || T >= tArrive });
    if (T >= tArrive && T < tArrive + 0.45) K.burst(1330, 540, 80, 130, { key: 'arrive', n: 12, al: 1 - ctx.seg(T, tArrive + 0.2, tArrive + 0.45) });

    ctx.screen();
    K.grain();
  },

  hits(ctx) {
    const c = ctx.cue, h = [{ t: c('plan'), kind: 'swish', gain: -6 }];
    for (let i = 0; i < 9; i++) h.push({ t: c('build') + i * 0.09, kind: 'tick', gain: -10 });
    h.push({ t: c('cross'), kind: 'pop', gain: -8 }, { t: c('arrive'), kind: 'thump', gain: -4 });
    return h;
  },
});
