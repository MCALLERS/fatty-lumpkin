// Math starter: y = sin θ, the circle and the wave. 8 s, on ones, on manim's near-black stage.
// The formula is Written; the circle's axes and the wave's axes sweep in; the unit circle draws its border; then θ
// turns once round the circle while its height (green) is carried across by a dashed line and traced out as the wave.
// The readouts are computed from the same θ as the dot, so the numbers on screen are always the figure's numbers.
// The full turn lands on 2π with a Flash, and the pi hero, which has watched the dot all along, hops.
// One colour per quantity, everywhere: θ blue, sin θ (the height) green, the radius 1 yellow.
// The framing keeps the circle, the wave's first half and both readouts inside the centre 4:5 crop (x 528-1392), and
// the presenter's corner (x 0-380, y 700-1080) empty, so the Duet needs no other framing.
FLPT.scene({
  style: 'math',
  layers: ['canvas'],
  keyframes: ['write', 'circle', 'sweep', 'full'],

  frame(ctx, T) {
    const K = ctx.kit, MC = K.MC, cue = ctx.cue, TAU = ctx.TAU;
    const QT = MC.blue, QS = MC.green, QR = MC.yellow;
    const R = 210, C = [770, 610], G0 = [1030, 610], ux = 117;

    // the turn: θ from 0 to 2π, eased at both ends
    const th = TAU * ctx.EZ.smooth(ctx.seg(T, cue('sweep'), cue('full')));
    const P = [C[0] + R * Math.cos(th), C[1] - R * Math.sin(th)];
    const wave = K.plane({ at: G0, ux, uy: R, x: [0, TAU], y: [-1.2, 1.2] });
    const Gp = wave.to(th, Math.sin(th));

    // the formula
    const EQ = [K.mv('y', QS), '=', K.mn('sin', QS), { sp: 0.1 }, K.mv('θ', QT)];
    const lay = K.writeTex(EQ, 960, 200, 104, K.runS(cue('write'), 0.9));

    // the axes: the circle's, then the wave's (with π and 2π under it)
    const ax = K.runS(cue('axes'), 0.9);
    K.numberPlane(K.plane({ at: C, u: R, x: [-1.25, 1.25], y: [-1.25, 1.25] }), { p: ax, step: 0.5, sub: 2, al: 0.8 });
    K.axes2({ at: C, u: R, x: [-1.2, 1.2], y: [-1.2, 1.2], ext: 0.08, p: ax, step: 1, tick: 9, tips: false });
    K.axes2({ at: G0, ux, uy: R, x: [0, TAU], y: [-1.2, 1.2], ext: 0.25, p: K.runS(cue('axes') + 0.25, 0.9), step: Math.PI / 2, ystep: 1, tick: 9 });
    const lp = K.runS(cue('axes') + 0.8, 0.6);
    // π and 2π sit above the axis, where the wave isn't (it falls through π and rises into 2π from below)
    for (const [v, toks, ox] of [[Math.PI, [K.mn('π')], 22], [TAU, [K.mn('2π')], 0]]) {
      const [x, y] = wave.to(v, 0);
      K.writeTex(toks, x + ox, y - 22, 38, lp);
    }

    // the unit circle draws its border
    K.showCreation(K.ellipsePts(C[0], C[1], R, R, 0, 121, 0, -TAU), K.runS(cue('circle'), 0.9), { c: QR, w: 5 });

    // the turn: radius (yellow), height (green), the angle (blue), the dashed carry across, the traced wave
    const on = K.runS(cue('circle') + 0.5, 0.5);
    if (on > 0) {
      K.angleArc(C[0], C[1], 46, 0, -th, QT, on, 4);
      K.segLine(C[0], C[1], P[0], P[1], QR, 5, on);
      // the radius's "1" sits beside it, on the side away from the green height
      const c = Math.cos(th), s = Math.sin(th), nx = c >= 0 ? -s : s, ny = c >= 0 ? -c : c;
      K.writeTex([K.mn('1', QR)], (C[0] + P[0]) / 2 + nx * 30, (C[1] + P[1]) / 2 + ny * 30 + 14, 40, on);
      K.segLine(P[0], C[1], P[0], P[1], QS, 6, on);
      if (Math.abs(Math.cos(th)) > 0.1) K.rightAngle(P[0], C[1], [-Math.sign(Math.cos(th)), 0], [0, -Math.sign(Math.sin(th)) || -1], 16, MC.white, 0.7 * on * K.smoothM(Math.abs(Math.sin(th)) * 6));
      const g = ctx.g;
      g.save(); g.setLineDash([9, 9]); K.segLine(P[0], P[1], Gp[0], Gp[1], MC.greyC, 2.5, 1, 0.8 * on); g.restore();
      K.graphM(wave, Math.sin, 0, TAU, th / TAU, { c: QS, w: 6 });
      K.segLine(Gp[0], G0[1], Gp[0], Gp[1], QS, 4, 1, 0.55 * on);
      K.trackDot(Gp[0], Gp[1], QS, { r: 10, al: on });
      K.trackDot(P[0], P[1], QR, { al: on });
    }

    // the readouts, from the same θ: sin of θ as shown (2 places), so the two lines agree at the precision on screen
    const rp = K.runS(cue('sweep'), 0.6), thShown = Math.round(th * 100) / 100;
    K.readout([K.mv('θ', QT)], thShown, 2, G0[0] + 36, 912, 48, { c: QT, p: rp, id: 'theta' });
    K.readout([K.mn('sin', QS), { sp: 0.1 }, K.mv('θ', QT)], Math.sin(thShown), 2, G0[0] + 36, 984, 48, { c: QS, p: K.runS(cue('sweep') + 0.15, 0.6), id: 'sin' });

    // a full turn: 2π flashes, the term Indicates, the hero hops
    const [fx, fy] = wave.to(TAU, 0);
    K.flashAt(fx, fy, (T - cue('full')) / 0.5, MC.yellowP, 30, 4);
    const bx = K.texBox(lay, 'θ#0');
    if (bx) K.surround(bx, K.runS(cue('full') + 0.1, 0.5), { c: QT, pad: 10, w: 3, al: 1 - K.runS(cue('full') + 1.0, 0.4) });

    const look = T < cue('circle') ? [lay.x0 + lay.w / 2, 170] : P;
    K.piHero(1730, 1010, 0.82, { key: 'pi', look, mood: T >= cue('full') ? 'happy' : T >= cue('sweep') ? 'wow' : 'calm', hop: (T - cue('full')) / 0.5, blink: T < ctx.duration - ctx.hold - 0.3 });
  },

  hits(ctx) {
    const c = ctx.cue;
    return [
      { t: c('write') + 0.05, kind: 'tick', gain: -8 }, { t: c('axes'), kind: 'swish', gain: -10 },
      { t: c('circle'), kind: 'tick', gain: -8 }, { t: c('sweep'), kind: 'click', gain: -10 },
      { t: c('full'), kind: 'chime', gain: -6 },
    ];
  },
});
