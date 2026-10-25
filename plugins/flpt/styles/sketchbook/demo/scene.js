// Sketchbook demo, 8 s: a 16:9 port of cth9191/animate's sketchbook demo (MIT). A puzzled doodle gets an idea: a
// lightbulb is pencilled in, inked and scribbled yellow; on the bare page the bulb becomes the sun over a sketched
// hill, a house and a tree are written on, and the hero waves from the top. One shape bridge between two eras.
const BULB = { x: 1190, y: 300, r: 112 };
const SUN = { x: 1150, y: 250, r: 112 };
const MID = [960, 470];

function idea(ctx, K, T) {
  const S = K.SK, cue = ctx.cue;
  K.sketchPage({ grid: 'dots' });
  // the ground line the hero stands on, and an ant walking it
  K.gpencil([[430, 792], [820, 786], [1240, 794], [1560, 788]], { key: 'ground', w: 3, a: 0.75 });
  K.ant(1000 + 70 * T, 789, 1.4, 'ant');
  // margin stars that twinkle on twos, and a paper plane looping the top-right margin, its trail behind it
  [[210, 330, 0], [300, 520, 1], [190, 690, 2]].forEach(([x, y, i]) => K.doodleStar(x, y, 24 + 7 * ((ctx.B + i) % 3 === 0), 'mstar' + i, { w: 3.4 }));
  const at = (p) => [1640 + 150 * Math.sin(ctx.TAU * p), 250 + 60 * Math.sin(2 * ctx.TAU * p)];
  const p = T / 3.2, trail = [];
  for (let i = 0; i <= 24; i++) trail.push(at(p - 0.35 + 0.35 * i / 24));
  K.dashed(trail, { key: 'trail', w: 2.2, a: 0.6, dash: [10, 12] });
  const [px, py] = at(p), [qx, qy] = at(p + 0.01);
  K.paperPlane(px, py, Math.atan2(qy - py, qx - px), 1.15, 'plane');
  // the bulb: pencil construction, then ink, then a yellow scribble; it lights on "pop"
  const P = K.bulbPts(BULB.x, BULB.y, BULB.r), lit = ctx.ev(cue('pop'), 0.25);
  if (lit > 0) for (let i = 0; i < 12; i++) {
    const a = i / 12 * ctx.TAU - Math.PI / 2, r0 = BULB.r * 1.25, r1 = BULB.r * (1.5 + 0.12 * ((ctx.B + i) % 2));
    if (Math.sin(a) > 0.7) continue;   // not through the neck
    K.gline([[BULB.x + Math.cos(a) * r0, BULB.y + Math.sin(a) * r0], [BULB.x + Math.cos(a) * r1, BULB.y + Math.sin(a) * r1]], { w: 5, key: 'ray' + i, part: lit, second: false, amp: 0.8, step: 8 });
  }
  K.scribbleFill(P, S.hilite, { key: 'bulbfill', part: ctx.ev(cue('fill'), 0.5), gap: 12, w: 4.5, a: 0.95, base: 0.35 });
  K.gpencil(P, { closed: true, key: 'bulbc', w: 2.6, a: 0.7, part: ctx.ev(cue('draw'), cue('ink') - cue('draw')) });
  K.gline(P, { closed: true, key: 'bulb', w: 6, part: ctx.ev(cue('ink'), 0.3) });
  for (let i = 0; i < 3; i++) K.gline([[BULB.x - 0.4 * BULB.r, BULB.y + (1.2 + i * 0.1) * BULB.r], [BULB.x + 0.4 * BULB.r, BULB.y + (1.17 + i * 0.1) * BULB.r]], { w: 4, key: 'screw' + i, second: false, part: ctx.ev(cue('ink') + 0.15 + i * 0.04, 0.1) });
  K.gline([[BULB.x - 0.12 * BULB.r, BULB.y + 1.12 * BULB.r], [BULB.x - 0.2 * BULB.r, BULB.y + 0.3 * BULB.r], [BULB.x, BULB.y + 0.12 * BULB.r], [BULB.x + 0.2 * BULB.r, BULB.y + 0.3 * BULB.r], [BULB.x + 0.12 * BULB.r, BULB.y + 1.12 * BULB.r]], { w: 3, key: 'filament', second: false, part: ctx.ev(cue('ink') + 0.1, 0.25), col: S.graph });
  // the pencil that draws it: follows the construction line, then the ink, then scribbles, then leaves
  if (T >= cue('draw') && T < cue('pop') + 0.3) {
    let tip;
    if (T < cue('ink')) tip = K.writeEnd(K.closeP(P), ctx.ev(cue('draw'), cue('ink') - cue('draw')));
    else if (T < cue('fill')) tip = K.writeEnd(K.closeP(P), ctx.ev(cue('ink'), 0.3));
    else if (T < cue('pop')) tip = [BULB.x + 80 * Math.sin(ctx.B * 2.1), BULB.y - 70 + 140 * ctx.ev(cue('fill'), 0.5)];
    else { const k = ctx.EZ.i2(ctx.ev(cue('pop'), 0.3)); tip = [ctx.lerp(BULB.x + 60, 2000, k), ctx.lerp(BULB.y, 80, k)]; }
    K.pencilTool(tip[0], tip[1], -0.75 + 0.08 * Math.sin(ctx.B * 1.7), 1);
  }
  // the hero: puzzled, then it sees the idea and hops
  const hop = K.hop(cue('pop'), 0.25), sq = K.hop(cue('pop') + 0.25, 0.17);
  const hx = 760, hy = 640 - 60 * hop, wow = T >= cue('pop');
  K.doodleHero(hx, hy, 104, { key: 'hero', legs: true, mood: wow ? 'wow' : 'puzzled', look: [0.9, -0.8], sx: 1 + 0.1 * sq - 0.05 * hop, sy: 1 - 0.1 * sq + 0.08 * hop, arms: wow ? [1.2, 1.3] : [-0.9, 0.9] });
  if (!wow) K.handLetter('?', hx + 100, 470 + 6 * Math.sin(ctx.B * 0.9), 96, { col: S.graph, key: 'q', jit: 1.5, id: false });
  else K.handLetter('!', hx + 110, 460 - 30 * hop, 110, { face: 'marker', key: 'bang', reveal: ctx.ev(cue('pop'), 0.08), id: false });
  if (!wow) for (let i = 0; i < 2; i++) K.sweat(hx - 80 - i * 14, hy - 70 + i * 8, ((T * 1.3 + i * 0.5) % 1), 'sw' + i);
}

function hill(ctx, K, T) {
  const S = K.SK, cue = ctx.cue;
  K.sketchPage({ grid: 'dots' });
  // a cloud drifting, birds crossing on twos
  K.doodleCloud(380 + 26 * T, 260, 1.2, 'cloud');
  for (let i = 0; i < 3; i++) K.doodleBird(1700 - 110 * (T - 3) + i * 70, 420 + i * 30 - (i % 2) * 16, 1.3 - i * 0.2, (ctx.B + i) % 2, 'bird' + i);
  // the sun (the bridge's other end): a yellow scribble, inked, rays written on and turning
  K.doodleSun(SUN.x, SUN.y, SUN.r, { key: 'sun', part: ctx.ev(cue('rays'), 0.45) });
  // a far hill in graphite, the near hill in ink with hatching on its shady side
  K.gpencil([[-200, 760], [180, 640], [420, 610], [640, 650], [860, 700]], { key: 'farhill', w: 2.6, a: 0.6 });
  const HP = [[-200, 980], [200, 860], [560, 744], [860, 680], [1060, 676], [1300, 718], [1640, 820], [2120, 960]];
  const ridge = HP.filter(([x]) => x >= 1060), band = [...ridge, ...ridge.slice().reverse().map(([x, y]) => [x - 40, y + 150])];
  ctx.g.save(); K.gclip(band);
  K.ghatch(1000, 660, 2120, 1110, { ang: -0.9, gap: 9, col: S.graph, w: 2, a: 0.45, key: 'hillh' }); ctx.g.restore();
  K.gline(HP, { key: 'hill', w: 6 });
  // a path up the hill (dashed graphite), a house and a tree written on
  K.dashed([[260, 1000], [420, 900], [600, 800], [760, 728], [900, 690]], { key: 'path', part: ctx.ev(cue('house') - 0.25, 0.5) });
  K.doodleHouse(420, 818, 1, ctx.ev(cue('house'), 0.5), 'house');
  K.doodleTree(1480, 790, 1, ctx.ev(cue('tree'), 0.5), 'tree');
  // the hero on the hilltop: waves at the sun, hops on the beat
  const hop = Math.max(K.hop(cue('hop1')), K.hop(cue('hop2')));
  const wave = 1.0 + 0.5 * ((ctx.B % 4) < 2 ? 1 : -1);
  K.doodleHero(940, 546 - 50 * hop, 90, { key: 'hero', legs: true, mood: 'happy', look: [0.5, -1], sy: 1 + 0.06 * hop, sx: 1 - 0.04 * hop, arms: [-0.7, wave] });
  if (hop > 0) for (let i = 0; i < 2; i++) K.gline([[880 + i * 120, 680], [868 + i * 144, 692]], { w: 3, key: 'dust' + i, second: false, a: hop });
}

FLPT.scene({
  style: 'sketchbook',
  layers: ['canvas'],
  keyframes: ['fill', 'pop', 'tree'],

  frame(ctx, T) {
    const K = ctx.kit, S = K.SK, cue = ctx.cue, tc = cue('bridge'), seg = ctx.seg, lerp = ctx.lerp, EZ = ctx.EZ;
    const a = tc - 0.55, b = tc - 0.15, c = tc + 0.25, d = tc + 0.75;
    // era 0 leans in on the idea; the window closes on the bulb (it moves to mid-frame), the bulb becomes the sun on
    // the bare page, and the hill opens out of the sun, the camera pulling back: the bridge object is never under 150 px
    const lk = EZ.io(seg(T, cue('fill'), a)), lean = ctx.cam({ z: lerp(1, 1.1, lk), p: [lerp(960, 1060, lk), lerp(540, 520, lk)] });
    const bulbAt = (u, z) => ctx.cam({ z, p: [BULB.x, BULB.y + BULB.r * 0.3], to: [lerp(lean.tx + lean.z * BULB.x, MID[0], u), lerp(lean.ty + lean.z * (BULB.y + BULB.r * 0.3), MID[1], u)] });
    const sunAt = (u, z) => ctx.cam({ z, p: [SUN.x, SUN.y], to: [lerp(MID[0], SUN.x, u), lerp(MID[1], SUN.y, u)] });
    if (T < a) { ctx.apply(lean); idea(ctx, K, T); }
    else if (T < b) {
      const u = EZ.io(seg(T, a, b)), z = lerp(1.1, 1.95, u), R = lerp(2600, BULB.r * 1.95, EZ.o2(u));
      K.bare();
      ctx.screen();
      const cx = lerp(lean.tx + lean.z * BULB.x, MID[0], u), cy = lerp(lean.ty + lean.z * (BULB.y + BULB.r * 0.3), MID[1], u);
      K.windowFrame(K.bulbPts(cx, cy - R * 0.3, R), 'winA', () => { ctx.apply(bulbAt(u, z)); idea(ctx, K, T); });
    } else if (T < c) {
      const u = EZ.io(seg(T, b, c));
      K.bare(); ctx.screen();
      const r0 = BULB.r * 1.95, r1 = SUN.r * 1.95;
      K.blob(ctx.morph(K.bulbPts(MID[0], MID[1] - r0 * 0.3, r0), K.ellipsePts(MID[0], MID[1], r1, r1, 0, 72), u), S.hilite, 'bridge');
    } else if (T < d) {
      const u = EZ.io(seg(T, c, d)), z = lerp(1.95, 1, u);
      K.bare(); ctx.screen();
      const r = lerp(SUN.r * 1.95, 2600, EZ.i2(u));
      K.windowFrame(K.ellipsePts(lerp(MID[0], SUN.x, u), lerp(MID[1], SUN.y, u), r, r, 0, 72), 'winB', () => { ctx.apply(sunAt(u, z)); hill(ctx, K, T); });
    } else { ctx.screen(); hill(ctx, K, T); }
    // the lettering narrates, in screen space
    ctx.screen();
    if (T < a) {
      K.pageTag('the idea', { at: 0.15 });
      K.pageCaption(['every big idea', 'starts as a doodle'], [[1, 'doodle']], { at: 0.35, y: 905, size: 84 });
    } else if (T >= d) {
      K.pageTag('the world', { at: d });
      K.pageCaption(['then it lights up', 'the whole page'], [[1, 'whole page']], { at: d + 0.15, y: 905, size: 84 });
    }
    K.grain();
  },

  hits(ctx) {
    const c = ctx.cue;
    return [{ t: c('draw'), kind: 'tick', gain: -6 }, { t: c('pop'), kind: 'pop', gain: -2 }, { t: c('bridge') - 0.4, kind: 'swish', gain: -4 }, { t: c('bridge') + 0.25, kind: 'chime', gain: -6 }, { t: c('hop1'), kind: 'tick', gain: -6 }, { t: c('hop2'), kind: 'tick', gain: -6 }];
  },
});
