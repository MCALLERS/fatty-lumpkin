// Pixel demo, 6 s: a 16:9 port of cth9191/animate's pixel demo (MIT). A 4-colour handheld forest at dusk, drawn at
// 160x90 (12 px a pixel), where the hero spots the moon; the moon becomes a spinning coin while its grid steps
// 12 -> 10 -> 8 -> 6 px, and a 16-colour arcade night at 320x180 (6 px) opens out of it, where the hero jumps for
// coins. The resolution doubles at the morph: time told by sharpness. On twos; whole-pixel moves only.
// Duet: ctx.bubble is set; the hero and every word move right of the presenter's corner, the ground there stays plain.
const E1 = [160, 90], E2 = [320, 180];
const MOON = [118, 22];   // era 1 pixels; on screen (1422, 270); the coin sits on the same spot at era 2: (237, 45)

FLPT.scene({
  style: 'pixel',
  layers: ['canvas'],
  keyframes: ['spot', 'hop', 'bridge', 'jump1', 'jump2'],

  frame(ctx, T) {
    const K = ctx.kit, cue = ctx.cue, duet = !!ctx.bubble;
    const [H0, H1, H2, H3] = K.HANDHELD, Q = K.PAL16;
    const tb = cue('bridge');

    function dusk() {
      const GY = 66, hx = duet ? 58 : 40;
      K.lowres(E1, () => {
        K.pfill(H0);
        K.pgrad(0, 30, 160, 14, [H0, H1]);
        K.prect(0, 44, 160, GY - 44, H1);
        K.stars('dusk', 30, 2, 2, 157, 32, [H2, H3], { avoid: [MOON[0], MOON[1], 13] });
        K.pglow(MOON[0], MOON[1], 8, 14, H1, 0.6);
        K.pcircle(MOON[0], MOON[1], 7, H3);
        K.pdither(MOON[0] - 8, MOON[1] - 8, 17, 17, null, H2, (i, j) => ((i - MOON[0]) ** 2 + (j - MOON[1]) ** 2 <= 49 && i - MOON[0] > 2 ? 0.55 : 0));
        K.prect(MOON[0] - 4, MOON[1] - 3, 2, 2, H2); K.prect(MOON[0] + 2, MOON[1] + 3, 2, 1, H2); K.pset(MOON[0] + 3, MOON[1] - 3, H2);
        K.ridge('far1', -2, 162, GY + 1, 9, H0, { span: 30 });
        [[8, 40, 9, 0], [24, 28, 7, 1], [92, 24, 6, 0], [136, 36, 8, 1], [151, 46, 10, 0], [70, 20, 5, 1]].forEach(([x, h, w, k]) => K.pine(x, GY + 1, h, w, H0, H2, k, { left: x > MOON[0] }));
        K.prect(0, GY, 160, 90 - GY, H1);
        K.prect(0, GY, 160, 1, H2);
        if (!duet) {
          K.pgrad(0, GY + 6, 160, 90 - GY - 6, [H1, H0]);
          K.grass(2, 160, GY, H2);
          for (let i = 0; i < 14; i++) { const R = ctx.rng('peb', i); K.prect(R.i(2, 156), R.i(GY + 4, 86), R.i(1, 2), 1, H2); }
        } else {
          K.pgrad(36, GY + 6, 124, 90 - GY - 6, [H1, H0]);
          K.grass(42, 160, GY, H2);
        }
        K.fireflies('dusk', 9, duet ? 40 : 6, 30, 156, 60, H2, H3);
        // a beetle walks in from the right, a pixel a boil, legs flipping
        K.sprite(K.SPR.beetle[Math.floor(T * 12 + 1e-6) % 2], { a: H0, b: H2 }, 162 - Math.floor(T * 14 + 1e-6), GY - 4, { flip: true });
        // the hero watches the beetle, spots the moon, hops
        const hop = Math.round(4 * Math.sin(Math.PI * ctx.seg(T, cue('hop'), cue('hop') + 1 / 3)));
        const h = K.pixHero(hx, GY - 8, 6, { pal: K.HERO_HH, look: T < cue('spot') ? [1, 1] : [1, -1], hop, mood: T >= cue('hop') ? 'wow' : 'smile', key: 'hero' });
        if (T >= cue('spot') && T < cue('spot') + 0.75) K.pixBubble('!', hx + 3, h.head - 1, { bg: H3, edge: H0, fg: H0 });
        K.pixSign('LV1', hx + 26, GY, { wood: H1, dark: H0, light: H2, fg: H3, count: Math.floor(ctx.seg(T, 0.3, 0.6) * 3 + 1e-6) });
        K.pixCaption('THE MOON IS UP', { at: cue('spot') + 0.2, dur: 0.6, cx: duet ? 1150 : 960, y: 930, fg: H3, bg: H0, edge: H2 });   // the panel ends at y 1008, inside the safe area
      }, { fx: { pal: K.HANDHELD }, post: { lcd: 0.12 } });
    }

    function arcade() {
      const GY = 140, hx0 = duet ? 120 : 92;
      K.lowres(E2, () => {
        K.pgrad(0, 0, 320, GY, [Q.ink, Q.ink, Q.night, Q.purple], { ease: (u) => u ** 1.4 });
        K.stars('arcade', 70, 2, 4, 317, 110, [Q.grey, Q.white], { avoid: [237, 45, 30] });
        [[40, 70, 0], [180, 24, 1], [290, 96, 2]].forEach(([bx, y, k]) => K.cloud(((bx - Math.floor(T * 6 + 1e-6)) % 380 + 380) % 380 - 40, y, Q.slate, Q.grey, k));
        // the big coin (the moon's counterpart): face-on as it arrives, then it spins on 8ths
        K.pglow(237, 45, 17, 26, Q.purple, 0.7);
        const spin = T < tb + 0.9 ? 0 : Math.floor((T - tb - 0.9) / 0.25 + 1e-6) % 6, rx = Math.round(15 * [1, 0.72, 0.36, 0.06, 0.36, 0.72][spin]);
        if (rx <= 2) { K.prect(235, 30, 5, 31, Q.orange); K.prect(237, 31, 1, 29, Q.yellow); } else {
          K.pellipse(237, 45, rx, 15, Q.orange); K.pellipse(237, 45, rx - 2, 13, Q.yellow);
          if (rx >= 10) K.sprite(K.SPR.star7, { a: Q.orange }, 234, 42);
          if (rx >= 6) { K.prect(237 - rx + 3, 37, 2, 12, Q.white); K.prect(237 - rx + 4, 33, 1, 3, Q.white); }
        }
        for (let k = 0; k < 4; k++) { const [x, y] = [[212, 38], [262, 34], [218, 66], [258, 62]][k]; if ((Math.floor(T / 0.25 + 1e-6) + k) % 4 < 2) K.sprite(K.SPR.spark, { a: Q.white, b: Q.yellow }, x - 2, y - 2); }
        // a city on the horizon, windows changing on the beat
        for (let k = 0; k < 16; k++) { const R = ctx.rng('bld', k); K.building(k * 21 + R.i(-3, 3), GY, R.i(13, 19), R.i(22, 52), { key: k }); }
        // ground: grass over stone; a floating ledge with a patrolling slime and three coins
        K.prect(0, GY, 320, 3, Q.lime); K.prect(0, GY + 3, 320, 1, Q.green);
        K.prect(0, GY + 4, 320, 36, Q.slate);
        if (!duet) K.pdither(0, GY + 4, 320, 36, null, Q.night, (i, j) => (j - GY - 4) / 40 + 0.15);
        else K.pdither(64, GY + 4, 256, 36, null, Q.night, (i, j) => (j - GY - 4) / 40 + 0.15);
        for (let x = duet ? 70 : 4; x < 320; x += 16) K.prect(x, GY + 10 + ((x / 16) % 2) * 9, 9, 1, Q.grey);
        K.prect(192, 110, 56, 5, Q.slate); K.prect(192, 109, 56, 1, Q.lime); K.prect(192, 115, 56, 1, Q.ink);
        for (let k = 0; k < 3; k++) K.coin(206 + k * 14, 100, k);
        const sp = Math.floor(T * 12 + 1e-6), pp = sp % 72, sxp = 196 + (pp < 36 ? pp : 72 - pp);
        K.sprite(K.SPR.slime[Math.floor(sp / 3) % 2], { a: Q.ink, b: Q.green, c: Q.lime, w: Q.white, k: Q.ink }, sxp + 4, 109, { anchor: 'bc', flip: pp >= 36 });
        // the hero looks up, jumps for a coin, walks over, jumps for another
        const jump = (t0) => { const u = ctx.seg(T, t0, t0 + 0.5); return u > 0 && u < 1 ? Math.round(44 * 4 * u * (1 - u)) : 0; };
        const hop = jump(cue('jump1')) + jump(cue('jump2')), walking = T >= cue('walk') && T < cue('walk') + 0.5;
        const hx = hx0 + Math.round(30 * ctx.EZ.io(ctx.seg(T, cue('walk'), cue('walk') + 0.5)));
        [[hx0, cue('jump1') + 0.25], [hx0 + 30, cue('jump2') + 0.25]].forEach(([cx, tc], k) => {
          if (T < tc) { K.coin(cx, 86, k + 3); return; }
          const a = T - tc; if (a > 0.6) return;
          K.pixText('+100', cx, 72 - Math.floor(a * 30), Q.white, { align: 'center', shadow: Q.ink, id: `plus${k}` });
          if (a < 0.25) for (let q = 0; q < 4; q++) K.sprite(K.SPR.twinkle, { a: Q.yellow, b: Q.white }, cx - 1 + Math.round(Math.cos((q * ctx.TAU) / 4 + 0.8) * (4 + a * 40)), 85 + Math.round(Math.sin((q * ctx.TAU) / 4 + 0.8) * (4 + a * 40)));
        });
        K.prect(hx - 9 + Math.floor(hop / 8), GY, 19 - Math.floor(hop / 4), 1, Q.green);   // the shadow shrinks as it rises
        const happy = (T >= cue('jump1') + 0.25 && T < cue('walk')) || T >= cue('jump2') + 0.25;
        K.pixHero(hx, GY - 14, 12, { key: 'hero', hop, frame: walking ? Math.floor(T * 8 + 1e-6) % 2 : undefined, walk: walking, look: walking ? [1, 0] : T < cue('jump1') ? [1, -1] : [0, -1], mood: hop > 0 ? 'wow' : happy ? 'happy' : 'smile' });
        K.pixSign('LV2', hx0 - 34, GY, { count: Math.floor(ctx.seg(T, tb + 0.5, tb + 0.8) * 3 + 1e-6) });
        K.pixCaption('COINS AT NIGHT', { at: tb + 0.7, dur: 0.6, cx: duet ? 1150 : 960, y: 975, fg: Q.white, bg: Q.ink, edge: Q.yellow });   // the panel ends at y 1014
      }, { fx: { pal: K.PAL16, vignette: duet ? 0 : 2 }, post: { scan: 0.2 } });
    }

    // the bridge: the moon becomes the coin while its grid steps 12 -> 6 px, then the arcade opens out of it
    const at = [(MOON[0] + 0.5) * 12, (MOON[1] + 0.5) * 12];
    K.eraMorph(T, {
      t0: tb - 0.5, t1: tb, t2: tb + 0.55, a: dusk, b: arcade, at, r0: 100, Ga: 12, Gb: 6,
      rim: [Q.white, Q.ink],
      morph(G, u) {
        const A = K.pixToWorld(0, 0, 12), r = ctx.lerp(90, 96, u);
        K.blob(ctx.morph(Array.from({ length: 48 }, (_, i) => [at[0] + Math.cos((i / 48) * ctx.TAU) * 90, at[1] + Math.sin((i / 48) * ctx.TAU) * 90]), Array.from({ length: 48 }, (_, i) => [at[0] + Math.cos((i / 48) * ctx.TAU) * r * 0.8, at[1] + Math.sin((i / 48) * ctx.TAU) * r]), u), K.mixC(H3, Q.yellow, u), G, u < 0.5 ? K.HANDHELD : K.PAL16);
        return A;
      },
    });
  },

  hits(ctx) {
    const c = ctx.cue;
    return [
      { t: c('spot'), kind: 'pop', gain: -4 }, { t: c('hop'), kind: 'tick', gain: -6 },
      { t: c('bridge') - 0.5, kind: 'riser', gain: -6 }, { t: c('bridge'), kind: 'chime', gain: -4 },
      { t: c('jump1'), kind: 'swish', gain: -8 }, { t: c('jump1') + 0.25, kind: 'chime', gain: -6 },
      { t: c('walk'), kind: 'tick', gain: -10 }, { t: c('jump2'), kind: 'swish', gain: -8 }, { t: c('jump2') + 0.25, kind: 'chime', gain: -6 },
    ];
  },
});
