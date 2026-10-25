// Crosshatch starter: the desk by morning, then the coffee in the mug opens into the machine.
// 8 s, on twos. Outside: paper and wood, the notes written on and a plan ringed in red pencil. The camera pushes
// into the mug; the coffee becomes an iris, a ragged hatched hole that opens onto the navy world inside, where the
// moon sits exactly where the coffee was and the hero stands where it stood on the desk (the hole sweeps over it,
// so it crosses between the worlds in place). The camera pulls back out of the moon; a terminal types; the hero glows.
// The inside's wide keeps the moon, the terminal and the hero inside the centre 4:5 crop (x 528-1392), and the iris
// at 3.5 s (the poster) already shows the moon, the hero and the word "inside".
// Every filled shape is shaded with a texture; the line boils even when nothing moves.
// Duet: ctx.bubble is set; the framing shifts right so the presenter's corner (x 0-380, y 700-1080) stays calm.
FLPT.scene({
  style: 'crosshatch',
  layers: ['canvas'],
  keyframes: ['notes', 'plan', 'push', 'inside', 'type'],

  setup(ctx) {
    const R = ctx.rng('desk');
    const crumbs = Array.from({ length: 11 }, () => [R.r(900, 1700), R.r(880, 1040), R.r(3, 7)]);
    const stars = Array.from({ length: 40 }, () => [R.r(60, 1860), R.r(40, 560), R.r(4, 10)]);
    // one world plan for both sides of the iris: the mug becomes the moon, the hero stands in the same place
    return { crumbs, stars, mug: [1180, 250], mugR: 130, hero: [1250, 545], floor: 600 };
  },

  frame(ctx, T, S) {
    const K = ctx.kit, C = K.C, g = ctx.g, cue = ctx.cue, ev = ctx.ev, EZ = ctx.EZ;
    const duet = !!ctx.bubble, dx = duet ? 90 : 0;
    const tIn = cue('inside'), irisEnd = tIn + 1.1, H = S.hero;
    const coffee = S.mugR * 0.78, close = { z: 1.6, p: S.mug, to: [1060 + dx, 450] };

    // ---- inside the machine (also what the iris shows while it opens)
    function inside() {
      const wide = ctx.cam({ z: 1, p: [950, 440], to: [960 + dx, 540] });   // the wide: everything inside the centre 4:5 crop
      const cam = ctx.push(irisEnd, irisEnd + 1.2, ctx.cam(close), wide, EZ.io);
      K.darkWorld('inside', { drift: [(cam.tx - wide.tx) * 0.15, (cam.ty - wide.ty) * 0.15] });
      ctx.apply(K.depth(cam, 0.5));   // the far layer: stars on twos, at half depth
      S.stars.forEach(([x, y, s], i) => K.star4(x, y, s * (0.7 + 0.3 * ((ctx.B + i) % 2)), C.white));
      ctx.apply(cam);
      g.save();
      if (duet) { ctx.screen(); g.beginPath(); g.rect(440, 0, 1480, 1080); g.rect(0, 0, 440, 660); g.clip(); ctx.apply(cam); }   // the floor stays out of the presenter's corner
      g.beginPath(); g.rect(-400, S.floor, 2720, 900); g.clip();
      K.hexGrid({ x0: -300, y0: S.floor, x1: 2220, y1: 1400 }, 64, { key: 'hex', c: C.periS, w: 1.4 });
      g.restore();
      K.ink([[-300, S.floor], [2220, S.floor + 4]], { w: 2, color: C.periD, key: 'horizon', alpha: 0.7 });
      // the moon, where the coffee was
      const moon = K.ellipsePts(S.mug[0], S.mug[1], coffee * 1.08, coffee * 1.08, 0, 64);
      K.paint(moon, { fill: C.peri, key: 'moon', line: C.white, w: 3, tex: [{ k: 'cross', c: C.periD, al: 0.45, gap: 6, dens: (x, y) => ctx.clamp(0.2 + (x - S.mug[0] + y - S.mug[1]) / (coffee * 1.6)) }] });
      const shimmer = 1 - ev(tIn + 0.3, 0.9);
      if (shimmer > 0) K.rainbow(moon, { key: 'moonrb', n: 3, spread: 0.08, al: 0.85 * shimmer });
      // a terminal, typed into: left of the moon, all of it inside the centre 4:5 crop
      const tp = ctx.spring(T - (irisEnd + 0.75), 'smooth');   // the terminal springs up once the camera has settled
      if (tp > 0.01) { g.save(); g.translate(795, 475); g.scale(tp, tp); g.translate(-795, -475); K.paint(K.rrectPts(550, 355, 490, 240, 18), { fill: C.navy2, key: 'term', line: C.peri, w: 3, tex: [{ k: 'hatch', a: 0.8, gap: 7, c: C.periD, al: 0.12 }] }); g.restore(); }
      const lines = ['$ read notes.txt', '  7 lines', '$ plan --one-step'];
      lines.forEach((s, i) => {
        const n = Math.floor(ctx.clamp((T - cue('type') - i * 0.45) / 0.4) * s.length);
        K.mono(s, 586, 415 + i * 65, 36, i % 2 ? C.cyan : C.white, { key: 'tl' + i, count: n, caret: i === lines.length - 1 && n > 0 });
      });
      // the label is written as the hole opens, so the iris already reads "inside"
      K.label('inside', 880, 175, tIn - 0.1, { size: 72, color: C.peri });
      const typed = T >= cue('type') + 0.4;
      K.hero(H[0], H[1], 92, { key: 'hero', dark: true, mood: 'happy', look: typed ? [-1, -0.4] : [-0.3, -1] });
      if (T >= cue('type') + 1.6) K.ink([[975, 535], [995, 557], [1025, 511]], { w: 9, color: C.glow, key: 'done', frac: ev(cue('type') + 1.6, 0.25), amt: 0.8 });   // done: a check, inked
    }

    if (T >= irisEnd) {
      inside();
      ctx.screen();
      K.grain({ dark: 'rgba(10,10,30,0.22)', light: 'rgba(200,210,255,0.10)', fibre: 'rgba(200,210,255,0.05)' });
      return;
    }

    // ---- outside: the desk. A slow drift, then the push into the mug.
    const drift = ctx.cam({ z: 1.04, p: [960 + 30 * EZ.io(ctx.seg(T, 0, cue('push'))), 540], to: [960 + dx, 540] });
    ctx.apply(ctx.push(cue('push'), tIn, drift, ctx.cam(close), EZ.io));
    K.woodSurface(-260, -220, 2180, 1300, 'desk');

    // the notes, written on, and the plan ringed in red pencil
    g.save(); g.translate(470 + dx, 210); g.rotate(-0.05);
    K.noteSheet(0, 0, 560, 640, { key: 'note', lines: 7, frac: ctx.seg(T, cue('notes'), cue('notes') + 1.0) });
    K.planInk(K.ellipsePts(205, 200, 175, 54, -0.04, 40), { closed: true, key: 'ring', frac: ev(cue('plan'), 0.55) });
    g.restore();
    const k = ev(cue('notes'), 1.0), px = 550 + dx + 330 * k, py = 300 + 64 * Math.floor(k * 6.99) - 30 * Math.sin(k * 40);
    K.drawPencil(px, py, -0.9, 300, 1, 'pen');

    // the desk's life: a paper clip, crumbs, a sticky note, the mug
    K.ink([[1760, 520], [1760, 430], [1790, 410], [1820, 430], [1820, 540], [1790, 560], [1780, 550], [1780, 450]], { w: 4, color: '#8a8590', key: 'clip' });
    g.save(); g.fillStyle = C.woodD; g.beginPath(); for (const [x, y, r] of S.crumbs) { g.moveTo(x + r, y); g.arc(x, y, r, 0, ctx.TAU); } g.fill(); g.restore();
    g.save(); g.translate(1530, 640); g.rotate(0.08);
    K.paint(K.box(0, 0, 230, 210), { fill: C.yellowL, key: 'sticky', w: 2.6, tex: [{ k: 'pencil', c: C.yellow, al: 0.5, per: 70 }, { k: 'hatch', a: 0.8, gap: 5, al: 0.18, dens: (x, y) => ctx.clamp((x + y - 260) / 200) }] });
    for (let i = 0; i < 3; i++) K.ink([[34, 62 + i * 48], [34 + [160, 130, 96][i], 64 + i * 48]], { w: 2.6, color: 'rgba(58,36,23,0.6)', key: 'stk' + i });
    g.restore();
    K.inkMug(S.mug[0], S.mug[1], S.mugR, 'mug', { steam: T < tIn });   // the steam goes when the coffee opens
    K.label('the desk', 600 + dx, 975, cue('notes') - 0.1, { size: 66 });

    // the hero reads, then looks up at the plan, then at the mug; the iris sweeps over it where it stands
    const mood = T < cue('plan') ? 'smile' : 'wow';
    K.hero(H[0], H[1], 92, { key: 'hero', mood, look: T < cue('plan') + 0.3 ? [-1, -0.3] : T < cue('push') ? [-0.8, -0.8] : [-0.3, -1] });

    // the coffee opens: an iris onto the machine, the moon where the coffee was
    if (T >= tIn) {
      const r = coffee * 1.6 + 1200 * EZ.i2(ctx.seg(T, tIn, irisEnd));
      K.irisHole(close.to[0], close.to[1], r, { key: 'cup', c: C.navy, inner: () => inside() });
    }
    ctx.screen();
    K.grain();
  },

  hits(ctx) {
    const c = ctx.cue;
    return [
      { t: c('notes'), kind: 'tick', gain: -6 }, { t: c('plan'), kind: 'swish', gain: -4 },
      { t: c('inside') - 0.35, kind: 'whoosh', gain: -2 }, { t: c('inside'), kind: 'sub', gain: -4 },
      { t: c('type'), kind: 'click', gain: -8 }, { t: c('type') + 1.6, kind: 'chime', gain: -6 },
    ];
  },
});
