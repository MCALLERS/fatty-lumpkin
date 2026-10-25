// Painted Documentary · the starter. A traveller on a ridge at dusk looks up as the first star appears; an ink-wipe
// to the night, a fire, the chapter's title brushed on. Every part of the grammar once: painted plates at their depths,
// a push that lands on its beat and keeps breathing, a puppet that looks and blinks, the one light, an ink-wipe, a
// label and a title, the finish. Beats are in beats.json (seconds here; a narrated piece aligns them to its words).
FLPT.scene({
  style: 'painted-doc',
  layers: ['canvas'],
  keyframes: [1.9, 4.6],   // seconds, just after each land (the push on "look", the title brushed in)

  setup(ctx) {
    const K = ctx.kit;
    // every plate is painted here, once; a frame only composites them
    const dusk = K.world('starter-dusk', {
      time: 'dusk', horizon: 690, light: [1500, 660],
      clouds: [{ x: 640, y: 250, w: 1200, h: 190 }, { x: 1560, y: 420, w: 900, h: 140 }],
      far: { base: 640, amp: 60, seed: 61 }, mid: { base: 740, amp: 40, seed: 62 },
      hill: { base: 1000, amp: 30, seed: 63, peak: [700, 780, 560], trees: [{ x: 1250, h: 230 }] },
      near: { base: 1070, amp: 24, seed: 64 },
    });
    const night = K.world('starter-night', {
      time: 'night', horizon: 640, light: [960, 860], band: [[-100, -400], [2100, 380], 200],
      far: { base: 600, amp: 60, seed: 65 }, mid: { base: 700, amp: 40, seed: 66 },
      hill: { base: 925, amp: 14, scale: 900, seed: 67, rim: false, grass: 120, rocks: [{ x: 660, r: 28 }, { x: 1420, r: 34 }] },
      // the near ground: dark mounds at the corners, a bag by the right one, their tops lit by the fire behind
      near: { base: 1100, amp: 10, scale: 700, seed: 68, peaks: [[500, 985, 300], [1530, 992, 330]], grass: 120, grassScale: 1.2, outline: 0.2,
        rim: { color: 'amber', dir: [0, -1], a: 0.22 }, props: [{ kind: 'bag', x: 1440, h: 58 }] },
    });
    return { dusk, night };
  },

  frame(ctx, T, S) {
    const K = ctx.kit, cue = ctx.cue, EZ = ctx.EZ;

    const duskShot = () => {
      // a slow push that lands as he looks up, then keeps breathing
      K.view(K.breathe(K.path(T, [[0, { z: 1.0, p: [900, 560] }], [cue('look') + 0.3, { z: 1.16, p: [790, 590] }, 'o3']]), T, 0, { creep: 0.004 }));
      K.draw(S.dusk, {
        between: {
          0.3: () => K.star(1380, 330, 12, { a: EZ.o3(ctx.seg(T, cue('star') - 0.2, cue('star') + 0.6)) }),
          1.01: () => K.figure(700, K.ground(S.dusk, 'hill', 700), {
            h: 310, kind: 'coat', hat: 'bowler', cloak: true, staff: true, arms: [[8, 16], [26, 48]], light: [1500, 600], dark: 0.9, rim: 1,
            look: 22 * ctx.spring(T - cue('look'), 'heavy'), blink: K.blinking(T, 'traveller'), key: 'traveller',
          }),
        },
      });
    };

    const nightShot = () => {
      // low and close on the fire: the traveller on the lower third, the lit ground and the dark near mounds below
      K.view(K.breathe(K.path(T, [[cue('wipe'), { z: 1.58, p: [1010, 700] }], [ctx.duration, { z: 1.68, p: [1000, 708] }, 'io']]), T, cue('wipe'), { creep: 0 }));
      const f = K.flicker(T, 'starter');
      K.draw(S.night, {
        between: {
          0.3: () => K.twinkle([-100, -400, 2000, 420], { n: 14, key: 'starter' }),
          1.01: () => {
            K.firelight(960, 905, 100, { key: 'starter', reach: 7, squash: 0.22 });
            K.glow(960, 860, 560, 'amber', 0.2 + 0.1 * f, 'soft-light');
            K.figure(1160, 918, { h: 260, face: -1, kind: 'coat', hat: 'bowler', sit: true, arms: [[12, 48], [18, 42]], light: [960, 825], dark: 0.1, rim: 0.7 + 0.3 * f, cast: 0.85, warm: 0.62,
              look: 6, blink: K.blinking(T, 'sitter', 3.2), key: 'sitter' });
            K.fire(960, 905, 100, { key: 'starter', pool: false });
          },
        },
      });
    };

    K.wipe(T, cue('wipe'), 0.7, duskShot, nightShot, { dir: 'right', key: 'starter' });
    // left-aligned on the painting, inside the centre 4:5 crop the tall loop takes (x 528-1392)
    const x = Math.max(K.safe().x, 580);
    K.label('chapter', 'CHAPTER ONE', x + 4, 300, { at: cue('title') - 0.3, size: 34 });
    K.title('title', 'The long road', x, 420, { at: cue('title'), dur: 0.55, size: 120 });
    K.finish({ warm: T < cue('wipe') + 0.35 ? 0.5 : 0.15, light: [1300, 560] });
  },

  hits(ctx) { return [{ t: ctx.cue('star'), kind: 'chime', gain: -4 }, { t: ctx.cue('wipe'), kind: 'whoosh', gain: -4 }, { t: ctx.cue('title'), kind: 'thump', gain: -6 }]; },
});
