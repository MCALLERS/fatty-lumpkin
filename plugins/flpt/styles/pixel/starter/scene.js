// Pixel starter: night becomes morning, and the picture gets sharper. 8 s, on twos, whole pixels only.
// Era 1 is a 4-colour handheld night drawn at 80x45 (24 px a pixel, an LCD grid): the hero walks in under the moon,
// a house with one lit window. The moon becomes the sun while its grid steps 24 -> 12 px, and a stepped window opens
// out of the sun onto era 2, a 16-colour morning at 320x180 (6 px, scanlines): snowy mountains, hills and a town in
// parallax as the camera drifts, the river and the meadow, birds, the hero where it stood, one word dropping in.
// The sun and the hero stay inside the centre 4:5 crop (x 528-1392); the poster (3.5 s) is the window half open:
// the chunky night outside, the sharp morning inside.
// Duet: ctx.bubble is set; the hero and the word move right of the presenter's corner, the ground there stays plain.
const E1 = [80, 45], E2 = [320, 180];
const SKY = [40, 11];   // the moon in era 1 pixels; on screen (972, 276); the sun sits there in era 2: (161, 45)

FLPT.scene({
  style: 'pixel',
  layers: ['canvas'],
  keyframes: ['walk', 'look', 'bridge', 'open', 'morning', 'word'],

  setup() {
    return { sun: [(SKY[0] + 0.5) * 24, (SKY[1] + 0.5) * 24] };
  },

  frame(ctx, T, S) {
    const K = ctx.kit, cue = ctx.cue, EZ = ctx.EZ, duet = !!ctx.bubble;
    const [H0, H1, H2, H3] = K.HANDHELD, Q = K.PAL16;
    const heroX1 = duet ? 44 : 36;   // era 1 pixels; on screen the hero stands at x 876 (Solo) or 1068 (Duet)

    function night() {
      const GY = 34;
      K.lowres(E1, () => {
        K.pfill(H0);
        K.pgrad(0, 16, 80, 6, [H0, H1]);
        K.prect(0, 22, 80, GY - 22, H1);
        K.stars('n', 18, 1, 1, 78, 15, [H2, H3], { avoid: [SKY[0], SKY[1], 6] });
        K.pglow(SKY[0], SKY[1], 3, 7, H1, 0.5);
        K.pcircle(SKY[0], SKY[1], 3, H3);
        K.pset(SKY[0] + 1, SKY[1] + 1, H2); K.pset(SKY[0] - 1, SKY[1] - 1, H2);
        // dark hills under a lighter horizon; pine tops and a roof stand against it, rimmed by the moon
        K.ridge('n-hill', -2, 82, GY + 1, 8, H0, { span: 24 });
        K.pine(8, GY - 1, 20, 7, H0, H2, 0); K.pine(19, GY, 13, 5, H0, H2, 1);
        K.pine(67, GY, 15, 6, H0, H2, 1, { left: true }); K.pine(76, GY - 1, 21, 7, H0, H2, 0, { left: true });
        K.prect(52, GY - 7, 9, 8, H0); K.ppoly([[50.5, GY - 6.5], [56.5, GY - 12], [62.5, GY - 6.5]], H0); K.pline(57, GY - 11, 61, GY - 7, H2); K.prect(54, GY - 5, 2, 2, H3);
        K.prect(0, GY, 80, 45 - GY, H1);
        K.prect(duet ? 16 : 0, GY, duet ? 64 : 80, 1, H2);
        K.pdither(duet ? 16 : 0, GY + 3, duet ? 64 : 80, 45 - GY - 3, null, H0, (i, j) => (j - GY - 2) / 12);
        // the hero walks in, a pixel a boil, stops and looks up at the moon
        const x = Math.min(heroX1, -4 + Math.floor(T * 20 + 1e-6)), walking = x < heroX1;
        K.pixHero(x, GY - 5, 4, { pal: K.HERO_HH, key: 'hero', walk: walking, look: walking ? [1, 0] : [0.2, -1], mood: T >= cue('look') ? 'wow' : 'smile' });
      }, { fx: { pal: K.HANDHELD }, post: { lcd: 0.12 } });
    }

    function morning() {
      const drift = Math.floor(Math.max(0, T - cue('open')) * 4 + 1e-6);   // the camera drifts right, a pixel at a time
      const cam = { z: 1, tx: -drift, ty: 0 }, RB = 121, NB = 129;   // the river's far and near banks
      K.lowres(E2, () => {
        K.screenSpace(() => {
          K.pgrad(0, 0, 320, 112, [Q.blue, Q.sky, Q.sky, Q.ice], { ease: (u) => u ** 0.85 });
          K.pglow(161, 45, 15, 32, Q.white, 0.55);
          K.pcircle(161, 45, 14, Q.orange); K.pcircle(161, 45, 12, Q.yellow);
          K.prect(155, 37, 4, 2, Q.white); K.prect(154, 40, 2, 3, Q.white);
        });
        K.withView(K.depth(cam, 0.12), () => [[22, 26, 0], [226, 18, 1], [292, 52, 2], [80, 60, 3]].forEach(([x, y, k]) => K.cloud(x, y, Q.white, Q.ice, k, k === 3 ? 0.7 : 1)));
        K.birds('m', 3, -20, 66, 20, Q.night);
        K.withView(K.depth(cam, 0.3), () => K.ridge('m-far', -40, 420, 106, 50, Q.grey, { sharp: true, span: 34, dark: Q.slate, lightX: 161, snow: Q.white, snowAt: 0.74, y1: 130 }));
        K.withView(K.depth(cam, 0.6), () => {
          K.ridge('m-hill', -40, 440, RB - 1, 18, Q.lime, { span: 56, dark: Q.green, lightX: 161, y1: 130 });
          [[14, 112, 24, 6, 0], [30, 116, 16, 4, 1], [262, 110, 22, 6, 1], [282, 113, 28, 7, 0], [306, 115, 18, 5, 1], [330, 112, 24, 6, 0]].forEach(([x, b, h, w, k]) => K.pine(x, b, h, w, Q.green, Q.lime, k, { left: x < 161, trunk: Q.brown }));
        });
        K.withView(cam, () => {
          // the town on the far bank wakes on the beat: windows, a chimney's smoke
          [[196, 13, 10, 0], [212, 10, 8, 1], [225, 15, 13, 2], [243, 11, 9, 3]].forEach(([x, w, h, k]) => K.house(x, RB, w, h, { key: k, lit: T < cue('morning') ? 0.7 : 0.25, shade: Q.ice, roofHi: Q.orange }));
          for (let k = 0; k < 4; k++) if ((ctx.B + k) % 6 < 4) K.pset(234 + (k % 2), RB - 23 - k * 2 - (ctx.B % 2), Q.white);
          K.prect(-20, RB, 400, 1, Q.green);
          if (duet) { K.pgrad(-20, RB + 1, 84, NB - RB - 1, [Q.sky, Q.blue]); K.water('river', 64, RB + 1, 336, NB - RB - 1, [Q.sky, Q.blue], Q.white); } else K.water('river', -20, RB + 1, 420, NB - RB - 1, [Q.sky, Q.blue], Q.white);
          // the meadow: a near bank that waves, flowers that nod on the beat
          const bank = [[-21, 181]];
          for (let x = -20; x <= 400; x += 4) bank.push([x, NB + Math.round(Math.sin(x * 0.06) * 1.2)]);
          bank.push([401, 181]);
          K.ppoly(bank, Q.green);
          K.pdither(duet ? 64 : -20, NB, duet ? 336 : 420, 52, null, Q.lime, (i, j) => 0.55 - (j - NB) / 40);
          // the path: a road from the hero's feet that curves toward us and widens (narrow by the river, far away),
          // its sunlit verges a lighter dither, flowers along both sides
          const P0 = NB + 3, RX = (heroX1 + 0.5) * 4, road = (y) => { const t = ctx.clamp((y - P0) / (181 - P0)); return [RX + 14 * Math.sin(Math.PI * t) - 30 * t * t, 1 + 24 * t ** 1.6]; };
          for (let y = P0; y < 181; y++) {
            const [c, hw] = road(y), a = Math.round(c - hw), b = Math.round(c + hw);
            K.prect(a, y, b - a + 1, 1, Q.brown);
            for (const x of [a - 1, a, b, b + 1]) if (K.bayer(x, y) < (x === a || x === b ? 0.6 : 0.3)) K.pset(x, y, x === a || x === b ? Q.orange : Q.lime);
            if (b - a > 8 && (y - P0) % 3 === 0) K.pset(Math.round(c + hw * 0.3 * Math.sin(y * 0.7)), y, Q.ink);   // pebbles
          }
          for (let y = P0 + 3, k = 0; y < 178; y += 4, k++) for (const side of [-1, 1]) {
            const [c, hw] = road(y), x = Math.round(c + side * (hw + 3 + (k % 2))), nod = (Math.floor(T / 0.5 + 1e-6) + k + (side > 0 ? 1 : 0)) % 2;
            K.pset(x, y + 1, Q.green); K.pset(x + nod, y, [Q.yellow, Q.pink, Q.white][(k + (side > 0 ? 1 : 0)) % 3]);
          }
          for (let i = 0; i < 46; i++) {
            const R = ctx.rng('flower', i), x = R.i(duet ? 70 : -16, 396), y = R.i(NB + 6, 176), [c, hw] = road(y);
            if (Math.abs(x - c) < hw + 5) continue;
            const nod = (Math.floor(T / 0.5 + 1e-6) + i) % 2;
            K.pset(x, y + 1, Q.green); K.pset(x + nod, y, [Q.pink, Q.yellow, Q.white][i % 3]);
          }
        });
        K.withView(K.depth(cam, 1.3), () => {
          K.tree(294, 158, 17, { key: 'near', leaf: Q.green, light: Q.lime, edge: Q.night, trunk: Q.brown });
          if (!duet) K.tree(20, 166, 12, { key: 'bush', leaf: Q.green, light: Q.lime, edge: Q.night, trunk: Q.brown, k: 1 });
        });
        // the hero, where it stood at night, now in more pixels, looking at the sun; it stands in the world (at the
        // top of its path), so it travels with the camera's drift
        const hx = (heroX1 + 0.5) * 4 - 0.5;
        K.withView(cam, () => {
          const h = K.pixHero(hx, 122, 9, { key: 'hero', mood: T >= cue('morning') ? 'happy' : 'wow', look: [0.4, -1], hop: Math.round(5 * Math.sin(Math.PI * ctx.seg(T, cue('morning'), cue('morning') + 0.35))) });
          if (T >= cue('morning') && T < cue('morning') + 0.9) K.pixBubble('!', hx + 6, h.head - 1);
        });
        // one word drops in, a letter at a time, each landing with a whole-pixel bounce
        const t0 = cue('word');
        K.pixLetters('MORNING', 236, 76, Q.white, {
          scale: 2, align: 'center', outline: Q.ink, shadow: Q.night,
          each(i) {
            const u = T - t0 - i * 0.08;
            if (u < 0) return { show: false };
            const fall = u < 0.2 ? Math.round(-30 * (1 - u / 0.2) ** 2) : 0, bounce = u >= 0.2 && u < 0.4 ? -Math.round(3 * Math.sin((Math.PI * (u - 0.2)) / 0.2)) : 0;
            return { dy: fall + bounce, c: i === 0 ? Q.yellow : undefined };
          },
        });
      }, { fx: { pal: K.PAL16 }, post: { scan: 0.16 } });
    }

    K.eraMorph(T, {
      t0: cue('bridge'), t1: cue('open'), t2: cue('morning'), a: night, b: morning, at: S.sun, r0: 110, Ga: 24, Gm: 12, Gb: 6,
      rim: [Q.white, Q.ink], ease: EZ.io,
      morph(G, u) {
        const ring = (r) => Array.from({ length: 48 }, (_, i) => [S.sun[0] + Math.cos((i / 48) * ctx.TAU) * r, S.sun[1] + Math.sin((i / 48) * ctx.TAU) * r]);
        const k = ctx.spring(T - cue('bridge'), 'playful');
        K.blob(ctx.morph(ring(84), ring(90 + 10 * Math.sin(Math.PI * Math.min(1, k))), u), K.mixC(H3, Q.yellow, EZ.io(u)), G, u < 0.5 ? K.HANDHELD : K.PAL16, { rim: u < 0.5 ? H0 : Q.orange });
      },
    });
  },

  hits(ctx) {
    const c = ctx.cue;
    return [
      { t: c('walk'), kind: 'tick', gain: -10 }, { t: c('look'), kind: 'pop', gain: -6 },
      { t: c('bridge'), kind: 'riser', gain: -6 }, { t: c('open'), kind: 'whoosh', gain: -4 },
      { t: c('morning'), kind: 'chime', gain: -4 }, { t: c('word'), kind: 'click', gain: -6 }, { t: c('word') + 0.48, kind: 'thump', gain: -8 },
    ];
  },
});
