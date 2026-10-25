// Isometric demo (animate's isometric demo, 16:9): a laptop on a stacked plinth drops in, opens on a spring, its keys
// rise in a wave and a prompt is typed; the dark cursor block becomes the front of a server blade (the morph
// renderer's shrink, morph and grow), which slides out of a rack with the cube-bot riding it. 7 s on ones.
// Each world sets its projection, then draws back to front (painter's order); every move settles on a spring.
FLPT.scene({
  style: 'isometric',
  layers: ['canvas'],
  keyframes: ['type', 'slide', 'hop2'],

  frame(ctx, T) {
    const K = ctx.kit, P = K.PAL, cue = ctx.cue;
    const ISO1 = { ox: 960, oy: 668, u: 1.05 }, ISO2 = { ox: 960, oy: 545, u: 0.9 };
    // ---- world 1: the laptop on its plinth
    const PL = { x: -210, y: -180, w: 420, d: 360 }, LP = { x: -175, y: -150 }, PZ = 16 + 6 + 14 + 6 + 22;
    const CUR = { u: 52, v: 168, w: 12, h: 20 };
    const lidAt = () => K.spring(T, cue('open'), { k: 80, damp: 0.6 });
    const lapZ = () => PZ + K.drop(cue('laptop'), 260, { k: 150, damp: 0.62 });
    const typed = (s, t0, cps = 22) => Math.floor(ctx.clamp((T - t0) * cps, 0, s.length));
    function screen(fp) {
      for (let i = 0; i < 3; i++) K.faceEll(fp, 28 + i * 14, 28, 4.5, 4.5, { stroke: P.inner });
      K.isoText(fp, '$ start', 26, 68, 24, { color: P.textD, count: typed('$ start', cue('type')) });
      K.isoText(fp, '> ship it today', 26, 100, 24, { count: typed('> ship it today', cue('type') + 0.38) });
      [170, 120, 200].forEach((L, i) => {   // output lines as hairline pills
        const s = K.spring(T, cue('type') + 0.85 + i * 0.1, { k: 200, damp: 0.7 });
        if (s > 0.02) K.faceSlab(fp, 26, 116 + i * 16, Math.max(10, L * s), 10, 3, { edge: P.edge, creaseC: P.inner });
      });
      if (T > cue('type') + 1.05) {
        K.isoText(fp, '>', 26, 187, 24);
        if (T > cue('type') + 1.1 || K.blinkOn(T, 0.5)) K.faceSlab(fp, CUR.u, CUR.v, CUR.w, CUR.h, 3, { r: 2, fill: P.accent, edge: P.accent, creaseC: P.accent });
      }
    }
    function laptopWorld() {
      K.setIso(ISO1);
      const dz = (i) => K.drop(cue('plates') + i * 0.08, 200, { k: 160, damp: 0.6 });
      if (T > cue('plates')) K.isoPlates(PL.x, PL.y, 0, PL.w, PL.d, [{ h: 16, r: 44, dz: dz(0) }, { h: 14, gap: 6, inset: 10, r: 38, dz: dz(1) - dz(0) }, { h: 22, gap: 6, inset: 20, r: 32, dz: dz(2) - dz(1) }]);
      const zb = lapZ();
      if (T > cue('laptop')) K.laptop(LP.x, LP.y, zb, { lid: lidAt(), keys: cue('keys'), screen });
      if (T > cue('laptop') + 0.25) K.isoCable([[LP.x + 320, -40, zb + 7], [LP.x + 330, -30, PZ + 3], [160, -6, PZ + 3], [170, 12, PZ + 6]], { w: 7 });
      if (T > cue('plates') + 0.3) K.isoMug(-138, 128, PZ + K.drop(cue('plates') + 0.35, 160, { k: 180 }), 30, 52);
      if (T > cue('plates') + 0.4) K.isoPlant(170, -128, PZ + K.drop(cue('plates') + 0.45, 160, { k: 180 }), 1);
      if (T > cue('plates') + 0.5) {
        const bz = PZ + K.drop(cue('plates') + 0.55, 160, { k: 180 });
        K.isoBox(152, 4, bz, 44, 30, 16, { r: 6 });
        K.lamp(K.faceOf([152, 34, bz + 16], [1, 0, 0], [0, 0, -1]), 34, 8, 2.6, !K.blinkOn(T, 1.0));
      }
      if (T > cue('laptop') + 0.1) K.cubeBot(72, 128, PZ + K.drop(cue('laptop') + 0.15, 220, { k: 170, damp: 0.5 }), 74, { key: 'hero', hop: cue('hop'), look: T > cue('type') ? -0.6 : 0 });
      K.tag('01', 'local', { at: 0.2 });
      K.caption('it starts on your laptop', { at: 0.45 });
    }
    // ---- world 2: the server rack
    const RK = { x: 8, y: 10, n: 5, bw: 344, bd: 250, bh: 50 };
    const slide = (i) => (i === RK.n - 1 ? 150 * K.spring(T, cue('slide'), { k: 55, damp: 0.72 }) : i === 2 ? 28 * K.spring(T, cue('slide') + 0.9, { k: 90, damp: 0.5 }) : 0);
    const names = (i) => (i === RK.n - 1 ? 'app-01' : 'db-0' + (i + 1));
    function rackWorld() {
      K.setIso(ISO2);
      ctx.apply(ctx.push(cue('slide'), cue('slide') + 1.5, { z: 1 }, { z: 1.04, p: [930, 520], to: [930, 520] }));
      const R = K.rack(RK.x, RK.y, 0, {
        n: RK.n, bw: RK.bw, bd: RK.bd, bh: RK.bh, live: RK.n - 1, names, nameSize: 28, slide,
        under() {   // a cable from blade 2's port to a floor socket, behind the live blade
          const pz = 30 + 8 + 58 + 24;
          K.isoCable([[318, RK.y + RK.bd, pz], [322, 300, pz - 20], [330, 322, 36], [362, 338, 34]], { w: 7 });
          K.isoBox(358, 326, 30, 30, 22, 12, { r: 5 });
        },
      });
      K.isoPlant(-6, 318, 30, 1, { ph: 1.3 });
      const sl = slide(RK.n - 1);
      K.cubeBot(250, RK.y + RK.bd - 46 + sl, R.bladeZ(RK.n - 1) + RK.bh, 74, { key: 'hero', hop: cue('hop2'), look: -0.4 });
      ctx.screen();
      K.tag('02', 'server', { at: cue('bridge') + 0.6 });
      K.caption('then it ships to the rack', { at: cue('bridge') + 0.75 });
    }
    // ---- the bridge: the cursor block becomes the blade's front
    K.bridgeAt(cue('bridge'),
      () => { K.setIso(ISO1); const L = K.laptopFaces(LP.x, LP.y, lapZ(), { lid: lidAt() }); return { P: K.screenPts(K.facePts(L.lid, K.rrectPts(CUR.u, CUR.v, CUR.w, CUR.h, 2, 3))), c: P.accent }; },
      () => { K.setIso(ISO2); const R = K.rackFaces(RK.x, RK.y, 0, { n: RK.n }); return { P: K.screenPts(K.facePts(R.face(RK.n - 1), K.rrectPts(0, 0, RK.bw, RK.bh, 6, 3))), c: P.edge }; },
      () => laptopWorld(),
      () => rackWorld());
  },

  hits(ctx) {
    const c = ctx.cue, out = [];
    for (let i = 0; i < 3; i++) out.push({ t: c('plates') + 0.12 + i * 0.08, kind: 'tick', gain: -8 });
    out.push({ t: c('laptop') + 0.18, kind: 'thump', gain: -10 }, { t: c('open') + 0.12, kind: 'click', gain: -6 });
    for (let i = 0; i < 6; i++) out.push({ t: c('type') + i * 0.09, kind: 'tick', gain: -12 });
    out.push({ t: c('hop'), kind: 'pop', gain: -6 }, { t: c('bridge') - 0.2, kind: 'swish', gain: -6 }, { t: c('slide'), kind: 'whoosh', gain: -8 }, { t: c('hop2'), kind: 'pop', gain: -6 });
    return out;
  },
});
