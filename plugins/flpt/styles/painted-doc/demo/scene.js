// Painted Documentary · the demo, Duet-safe: the valley at dawn, the presenter's corner (x 0-380, y 700-1080) kept
// quiet. The plates leave that corner calm (no grass, no detail), the finish darkens it a little more, and every
// word sits right of it (K.safe()). A slow push, the star's path painted across the sky, the river swelling, a
// label and a title brushed on. Neutral words only.
FLPT.scene({
  style: 'painted-doc',
  placement: 'duet',
  layers: ['canvas'],
  keyframes: [2.4, 4.4],   // seconds, just after each land (the arc drawn, the title brushed in)

  setup(ctx) {
    const K = ctx.kit, calm = [-700, 600, 720, 1400];   // in the plates' own coordinates: wide enough for the push
    const valley = K.world('demo-valley', {
      time: 'dawn', horizon: 560, light: [1380, 545], calm,
      clouds: [{ x: 560, y: 200, w: 1250, h: 210 }, { x: 1580, y: 330, w: 980, h: 150 }],
      far: { base: 548, amp: 46, scale: 420, seed: 71, peak: [520, 470, 260] }, mid: { base: 640, amp: 18, scale: 900, seed: 72, fields: 110 },
      near: { base: 1010, amp: 70, scale: 520, seed: 75, peak: [1780, 860, 420], grass: 420 },
    });
    // out of the distance at the far ridge, then one S toward the viewer (no hook)
    const river = [[880, 628, 1], [930, 642, 4], [1010, 662, 8], [1100, 690, 13], [1150, 724, 19], [1110, 764, 26], [1030, 812, 34], [1010, 880, 44], [1070, 980, 56], [1160, 1090, 68], [1240, 1200, 80]];
    return { valley, river };
  },

  frame(ctx, T, S) {
    const K = ctx.kit, cue = ctx.cue, EZ = ctx.EZ, g = ctx.g;
    K.view(K.breathe(K.path(T, [[0, { z: 1.0, p: [1000, 560] }], [cue('swell') + 0.4, { z: 1.1, p: [1060, 560] }, 'io']]), T, 0, { creep: 0.003 }));
    const u = EZ.o3(ctx.seg(T, cue('arc') - 0.1, cue('arc') + 1.3)), sw = EZ.io(ctx.seg(T, cue('swell') - 0.2, cue('swell') + 1.2));
    K.draw(S.valley, {
      between: {
        0.3: () => {
          K.shaft({ from: [1270, 300], to: [760, 860], w0: 120, w1: 700, a: 0.2, key: 'demo' });
          g.save(); g.lineCap = 'round';
          g.strokeStyle = K.rgba(K.col('cream'), 0.8); g.lineWidth = 4.5; g.beginPath(); g.arc(1380, 560, 340, Math.PI, Math.PI + Math.PI * 0.45 * u); g.stroke();
          g.restore();
          if (u > 0) { const an = Math.PI + Math.PI * 0.45 * u; K.star(1380 + Math.cos(an) * 340, 560 + Math.sin(an) * 340, 11, { a: ctx.clamp(u * 3) }); }
        },
        0.71: () => K.flood(S.river, { spread: 6 + 30 * sw, key: 'demo', glow: [1150, 640, 460], glowA: 0.6, glints: 40, c1: '#ecd29a', c2: '#557f7e', bankW: 34 }),
      },
    });
    K.motes([500, 260, 1600, 980], { n: 40, key: 'demo', in: (x, y) => ctx.clamp(1 - Math.abs((x - 1010) * 0.8 + (y - 580) * 0.6) / 340) });
    // the words go on the dark near hill, right of the river and far from the presenter's corner
    const x = Math.max(K.safe().x, 1250);
    K.label('place', 'THE RIVER VALLEY', x, 878, { at: cue('label'), size: 34 });
    K.title('title', 'At first light', x - 4, 984, { at: cue('title'), dur: 0.6, size: 92 });
    K.finish({ warm: 0.5, light: [1300, 520] });
  },

  hits(ctx) { return [{ t: ctx.cue('arc'), kind: 'swish', gain: -6 }, { t: ctx.cue('title'), kind: 'thump', gain: -6 }]; },
});
