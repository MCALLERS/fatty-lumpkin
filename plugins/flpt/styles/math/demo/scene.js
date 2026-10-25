// Math demo: a 16:9 port of animate's math demo. 8 s, on ones.
// a² + b² = c² is Written and drawn as a 4-3-5 right triangle with its squares: 16 + 9 = 25 unit cells, and the big
// square is Indicated. The square on c then morphs into the unit circle (a shape that is the next idea), where a and b
// become cos θ and sin θ: the equation Transforms term by term into cos²θ + sin²θ = 1 while θ sweeps and a live line
// keeps summing to exactly 1 (cos² rounded to 2 places, sin² shown as 1 minus it, so the line on screen is true).
// One colour per quantity, everywhere: a / cos θ red, b / sin θ green, c / 1 yellow, θ blue.
// Duet: ctx.bubble is set; the figure and the formulas move right, clear of the presenter's corner.
FLPT.scene({
  style: 'math',
  layers: ['canvas'],
  keyframes: ['sum', 'flash', 'transform', 'flash2'],

  setup(ctx) {
    const K = ctx.kit, MC = K.MC, dx = ctx.bubble ? 110 : 0;
    const QA = MC.red, QB = MC.green, QC = MC.yellow, QT = MC.blue;
    // era 1: the 4-3-5 triangle, 62 px a unit, the right angle at O; a runs right, b runs up
    const U = 62, O = [520 + dx, 640], A = [O[0] + 4 * U, O[1]], B = [O[0], O[1] - 3 * U];   // the square on a ends 33 px above the caption's card
    const SQ_A = K.squareOn(O[0], O[1], A[0], A[1], -1), SQ_B = K.squareOn(O[0], O[1], B[0], B[1], 1), SQ_C = K.squareOn(B[0], B[1], A[0], A[1], 1);
    // era 2: the unit circle, 300 px a unit; θ starts at the same 4-3-5 angle (cos 0.8, sin 0.6): the same triangle
    const UC = [660 + dx, 590], R = ctx.bubble ? 270 : 300;
    const ring = K.ellipsePts(UC[0], UC[1], R, R, 0, 96);
    // the square on c, dense, so the morph to the circle keeps its corners until it lets them go
    const dense = [];
    for (let i = 0; i < 4; i++) for (let k = 0; k < 24; k++) { const p = SQ_C[i], q = SQ_C[(i + 1) % 4]; dense.push([p[0] + (q[0] - p[0]) * k / 24, p[1] + (q[1] - p[1]) * k / 24]); }
    const EQ1 = [K.mv('a', QA, { sup: '2', id: 'a' }), '+', K.mv('b', QB, { sup: '2', id: 'b' }), '=', K.mv('c', QC, { sup: '2', id: 'c' })];
    const EQ2 = [K.mn('cos', QA, { sup: '2', id: 'a' }), { sp: 0.08 }, K.mv('θ', QT, { id: 'a' }), '+', K.mn('sin', QB, { sup: '2', id: 'b' }), { sp: 0.08 }, K.mv('θ', QT, { id: 'b' }), '=', K.mn('1', QC, { id: 'c' })];
    const SUM1 = [K.mn('16', QA, { id: 'a' }), '+', K.mn('9', QB, { id: 'b' }), '=', K.mn('25', QC, { id: 'c' })];
    return { dx, QA, QB, QC, QT, U, O, A, B, SQ_A, SQ_B, SQ_C, UC, R, ring, dense, EQ1, EQ2, SUM1, FX: 1420 + dx * 0.5, ES: ctx.bubble ? 96 : 104 };
  },

  frame(ctx, T, S) {
    const K = ctx.kit, MC = K.MC, cue = ctx.cue, g = ctx.g, clamp = ctx.clamp;
    const { QA, QB, QC, QT, O, A, B, SQ_A, SQ_B, SQ_C, UC, R, FX } = S;
    const m0 = cue('morph'), mu = K.smoothM((T - m0) / 0.8), out = 1 - clamp((T - m0) / 0.45);

    // ---- era 1: Pythagoras (it fades as the square on c becomes the circle)
    if (out > 0) {
      g.save(); g.globalAlpha = out;
      const sq = K.runS(cue('squares'), 1.0);
      [[SQ_A, QA, 4, '16'], [SQ_B, QB, 3, '9'], [SQ_C, QC, 5, '25']].forEach(([Q, c, n, area], i) => {
        if (i === 2 && T >= m0) return;   // the square on c is the morph's from here
        // the big square is Indicated (it swells a little and goes pure yellow, there and back): a Flash's rays would
        // cross its own edges, its label and the squares beside it
        const [x, y] = K.centroid(Q), ind = i === 2 ? K.thereBack(ctx.clamp((T - cue('flash')) / 0.6)) : 0, k = 1 + 0.03 * ind, cc = K.mixHex(c, MC.yellowP, ind);
        g.save(); g.translate(x, y); g.scale(k, k); g.translate(-x, -y);
        K.showCreation(Q, K.lagged(sq, i, 3, 0.5), { c: cc, w: 4, closed: true, fill: 0.14 + 0.1 * ind });
        K.cellGrid(Q, n, cc, 0.4 * K.runS(cue('cells') + i * 0.12, 0.4));
        K.writeTex([K.mn(area, cc)], x, y + 22, 62, K.runS(cue('cells') + 0.15 + i * 0.12, 0.45), { id: 'area:' + area });
        g.restore();
      });
      const sd = K.runS(cue('sides'), 0.8);
      K.showCreation([O, A], K.lagged(sd, 0, 3, 0.5), { c: QA, w: 7 });
      K.showCreation([O, B], K.lagged(sd, 1, 3, 0.5), { c: QB, w: 7 });
      K.showCreation([B, A], K.lagged(sd, 2, 3, 0.5), { c: QC, w: 7 });
      K.rightAngle(O[0], O[1], [1, 0], [0, -1], 22, MC.white, K.runS(cue('sides') + 0.5, 0.3));
      const lp = K.runS(cue('sides') + 0.45, 0.6);
      K.writeTex([K.mv('a', QA)], (O[0] + A[0]) / 2 + 40, O[1] - 16, 52, K.lagged(lp, 0, 3));
      K.writeTex([K.mv('b', QB)], O[0] + 20, (O[1] + B[1]) / 2 + 30, 52, K.lagged(lp, 1, 3), { align: 'left' });
      K.writeTex([K.mv('c', QC)], (A[0] + B[0]) / 2 - 22, (A[1] + B[1]) / 2 + 40, 52, K.lagged(lp, 2, 3));   // inside, off the stroke
      K.writeTex(S.SUM1, FX, 560, 70, K.runS(cue('sum'), 0.7));
      g.restore();
    }

    // ---- the bridge: the square on c becomes the circle of radius c
    if (T >= m0 && mu < 1) K.blob(ctx.morph(S.dense, S.ring, mu), QC, { fill: 0.32 * (1 - mu) + 0.0, w: 5 });

    // ---- era 2: the unit circle
    const c2 = K.runS(m0 + 0.3, 1.0);
    let th = Math.atan2(3, 4);
    if (c2 > 0) {
      const P0 = K.plane({ at: UC, u: R, x: [-1.2, 1.2], y: [-1.2, 1.2] });
      K.numberPlane(P0, { p: c2, step: 0.5, sub: 2, x: [-1.25, 1.25], y: [-1.15, 1.15] });
      K.axes2({ at: UC, u: R, x: [-1.2, 1.2], y: [-1.1, 1.1], ext: 0.1, p: K.runS(m0 + 0.35, 0.8), step: 0.5, tick: 8 });
      const ta = K.runS(m0 + 0.8, 0.4);
      K.writeTex([K.mn('1', MC.grey)], P0.to(1, 0)[0] + 22, UC[1] + 40, 32, ta, { align: 'left' });
      K.writeTex([K.mn('1', MC.grey)], UC[0] + 18, P0.to(0, 1)[1] - 10, 32, ta, { align: 'left' });
    }
    if (mu >= 1) {
      g.save(); g.strokeStyle = QC; g.lineWidth = 5; g.beginPath(); g.arc(UC[0], UC[1], R, 0, ctx.TAU); g.stroke(); g.restore();
      th = K.keysM([[cue('sweep'), Math.atan2(3, 4)], [cue('sweep') + 1.3, 2.35]]);
      const c = Math.cos(th), s = Math.sin(th), P = [UC[0] + c * R, UC[1] - s * R], FT = [UC[0] + c * R, UC[1]];
      // the numbers shown come from θ as shown (degrees, 1 place), so every line agrees at the precision on screen
      const thD = Math.round(th * 1800 / Math.PI) / 10, cS = Math.cos(thD * Math.PI / 180), sS = Math.sin(thD * Math.PI / 180);
      const on = K.runS(m0 + 0.8, 0.5);
      g.save(); g.globalAlpha = on;
      K.angleArc(UC[0], UC[1], 52, 0, -th, QT, 1, 4);
      K.writeTex([K.mv('θ', QT)], UC[0] + Math.cos(-th / 2) * 88, UC[1] + Math.sin(-th / 2) * 88 + 16, 44, 1);
      K.segLine(UC[0], UC[1], P[0], P[1], QC, 6);
      K.segLine(UC[0], UC[1], FT[0], FT[1], QA, 7);
      K.segLine(FT[0], FT[1], P[0], P[1], QB, 7);
      K.rightAngle(FT[0], FT[1], [-Math.sign(c) || -1, 0], [0, -1], 20, MC.white, 0.8 * clamp(Math.abs(c) * 6));
      // labels beside their segments; each fades when its segment is too short to carry it
      const nx = c >= 0 ? -s : s, ny = c >= 0 ? -c : c, room = clamp((Math.abs(c) * R - 100) / 30);
      K.writeTex([K.mn('1', QC)], (UC[0] + P[0]) / 2 + nx * 34, (UC[1] + P[1]) / 2 + ny * 34 + 14, 48, 1);
      K.writeTex([K.mn('cos', QA), { sp: 0.1 }, K.mv('θ', QT)], (UC[0] + FT[0]) / 2, UC[1] + 58, 42, 1, { alpha: clamp(Math.abs(c) * 4) });
      K.writeTex([K.mn('sin', QB), { sp: 0.1 }, K.mv('θ', QT)], FT[0] + (c >= 0 ? -16 : 16), FT[1] - s * R * 0.3 + 14, 42, 1, { align: c >= 0 ? 'right' : 'left', alpha: clamp(s * 4) * room });
      K.trackDot(P[0], P[1], QC);
      const lp = K.runS(cue('live'), 0.5);
      g.restore();
      // the point's coordinates sit in the column under θ, clear of the circle and the formula at every angle
      K.writeTex([K.mn('('), K.mn(K.fmtNum(cS, 2), QA), K.mn(','), { sp: 0.15 }, K.mn(K.fmtNum(sS, 2), QB), K.mn(')')], FX, 790, 50, K.runS(cue('live') + 0.15, 0.5), { id: 'point' });
      // the live check under the equation: the two squares still add to 1, at the precision shown
      const c2r = Math.round(cS * cS * 100) / 100;
      const lay = K.writeTex([K.mn(c2r.toFixed(2), QA, { id: 'a' }), '+', K.mn((1 - c2r).toFixed(2), QB, { id: 'b' }), '=', K.mn('1', QC, { id: 'c' })], FX, 560, 70, lp, { id: 'live sum' });
      // the line is Circumscribed: a Flash on its 1 would strike through the = beside it
      const ta = K.texBox(lay, 'a'), tc = K.texBox(lay, 'c');
      if (ta && tc) K.circumscribe({ x0: ta.x0, x1: tc.x1, y0: Math.min(ta.y0, tc.y0), y1: Math.max(ta.y1, tc.y1) }, (T - cue('flash2')) / 0.6, { pad: 12 });
      K.writeTex([K.mv('θ', QT), '=', K.mn(thD.toFixed(1) + '°', QT)], FX, 680, 50, K.runS(cue('live'), 0.5), { id: 'theta' });
    }

    // ---- the equation: Written, then Transformed term by term
    if (T < cue('transform')) K.writeTex(S.EQ1, FX, 430, S.ES, K.runS(cue('eq'), 0.9));
    else K.transformTex(S.EQ1, S.EQ2, FX, 430, S.ES, (T - cue('transform')) / 0.9);
    // each heading sits over its formula's right end, clear of the figure and the point's label
    K.heading('Pythagoras', FX + K.texW(S.EQ1, S.ES) / 2, 300, cue('eq') + 0.15, { alpha: out, align: 'right' });
    K.heading('unit circle', FX + K.texW(S.EQ2, S.ES) / 2, 300, cue('transform'), { align: 'right' });

    // ---- the hero reads, watches the triangle, then the big square, then the dot
    let look = T < 0.9 ? [FX, 400] : T < 1.8 ? [S.O[0] + 120, S.O[1] - 60] : K.centroid(SQ_C);
    if (mu >= 1) look = [UC[0] + Math.cos(th) * R, UC[1] - Math.sin(th) * R];
    const mood = T >= cue('flash2') ? 'happy' : T >= cue('flash') && T < cue('transform') + 0.8 ? 'wow' : 'calm';
    const hop = T < m0 ? (T - cue('flash')) / 0.5 : (T - cue('flash2')) / 0.5;
    K.piHero(1730, 1000, 0.9, { key: 'pi', look, mood, hop, blink: T < ctx.duration - ctx.hold - 0.3 });

    K.caption('the two small squares fill the big one', cue('squares') + 0.4, { alpha: out });
    K.caption([{ s: 'with ' }, { s: 'c', c: QC, it: true }, { s: ' = 1, the triangle lives on a circle' }], cue('transform') + 0.3);
  },

  hits(ctx) {
    const c = ctx.cue;
    return [
      { t: c('eq') + 0.1, kind: 'tick', gain: -8 }, { t: c('squares'), kind: 'tick', gain: -10 }, { t: c('squares') + 0.25, kind: 'tick', gain: -12 },
      { t: c('flash'), kind: 'chime', gain: -8 }, { t: c('morph'), kind: 'swish', gain: -8 }, { t: c('transform'), kind: 'swish', gain: -10 },
      { t: c('sweep'), kind: 'tick', gain: -12 }, { t: c('flash2'), kind: 'chime', gain: -6 },
    ];
  },
});
