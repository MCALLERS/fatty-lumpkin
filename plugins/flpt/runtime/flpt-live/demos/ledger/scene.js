// The month, in three receipts. A Motion Duet in Ledger (flpt-live demo, canvas only; from the K6 showcase): the presenter's bubble sits in the
// ledger's margin (bottom left, x 0-380, y 700-1080, kept clear); the receipts print in on their words, the
// amounts roll to the spoken number, the total rolls to 14,460 (2,400 + 11,200 + 860), and PAID thumps on "paid".
FLPT.scene({
  style: 'ledger',
  placement: 'duet',
  layers: ['canvas'],
  keyframes: ['month', 'rent$end', 'payroll$end', 'software$end', 'total$end', 'paid'],

  setup(ctx) {
    const K = ctx.kit;
    K.page(); K.stampFace('PAID', { size: 170 });   // the heavy parts, made once
    const R = ctx.rng('ledger');
    const receipts = [
      { label: 'RENT', amount: 2400, cue: 'rent', x: 500, y: 262, rot: -0.06, len: 470 },
      { label: 'PAYROLL', amount: 11200, cue: 'payroll', x: 912, y: 206, rot: 0.034, len: 490 },
      { label: 'SOFTWARE', amount: 860, cue: 'software', x: 1336, y: 280, rot: -0.022, len: 455 },
    ].map((r, i) => ({ ...r, key: 'r' + i, w: 384, bars: Array.from({ length: 30 }, () => [R.r(1.5, 6), R.r(0, 1) < 0.2 ? 6 : 2.6]) }));
    return { receipts };
  },

  frame(ctx, T, S) {
    const K = ctx.kit, g = ctx.g, cue = ctx.cue, ev = ctx.ev, EZ = ctx.EZ, beat = ctx.beat, tok = ctx.tokens;
    const paid = cue('paid'), hit = T - paid;

    // ---- camera: a slow lean in, a tilt towards the total, a jolt when the stamp lands
    const z = ctx.springTrack([[0, 1.0], [cue('rent') - 0.3, 1.025], [cue('total') - 0.4, 1.0], [paid - 0.9, 1.045]], 'heavy');
    const px = ctx.springTrack([[0, 1060], [cue('total') - 0.4, 1080], [paid - 0.9, 1110]], 'heavy');
    const py = ctx.springTrack([[0, 515], [cue('total') - 0.4, 548], [paid - 0.9, 556]], 'heavy');
    const shake = hit >= 0 ? Math.exp(-hit * 9) : 0, sx = Math.sin(hit * 61) * 9 * shake, sy = Math.cos(hit * 47) * 12 * shake;
    ctx.apply(ctx.cam({ z: z * (1 + 0.012 * shake), p: [px, py], to: [1060 + sx, 540 + sy] }));

    K.desk(g);
    K.fountain(g, 1585, 92, 0.42, 640);

    // ---- the eyebrow: THE MONTH, and an ink rule under it
    K.ink(g, 'The month', 500, 176, { font: K.FONT.italic, style: 'italic', weight: 480, size: 84, chars: 9 * EZ.o2(ev(cue('month') - 0.2, 0.5)), id: 'heading' });
    K.pen(g, [[502, 204], [835, 199]], { w: 3.6, frac: EZ.o3(ev(cue('month') + 0.2, 0.5)), key: 'brow' });

    // ---- the receipts: each unrolls as its line starts, its amount rolls to the spoken number
    for (const [i, r] of S.receipts.entries()) {
      const t0 = i === 0 ? cue('receipts') + 0.15 : cue(r.cue) - 0.45, t1 = t0 + 0.95;
      if (T < t0) continue;
      const feed = Math.floor(EZ.o2(ctx.seg(T, t0, t1)) * 28) / 28;          // the head steps, a line at a time
      const settle = ctx.spring(T - t1, 'snappy'), jump = hit >= 0 ? Math.sin(Math.min(1, hit / 0.22) * Math.PI) * 8 * Math.exp(-hit * 4) : 0;
      const a = cue(r.cue + '$'), b = beat(r.cue + '$end').end, u = EZ.o3(ctx.seg(T, a - 0.05, b));
      K.receipt(g, {
        x: r.x, y: r.y - 6 * (1 - settle) - jump, w: r.w, len: r.len, feed, rot: r.rot * settle, key: r.key, lift: 1 - settle,
        draw: (q, w, vis) => {
          const ink = tok.rink;
          K.ink(q, '* * * * * * * * * * *', w / 2, 52, { font: K.FONT.mono, weight: 400, size: 20, color: '#8a867e', align: 'center', id: false, bleed: 0.8 });
          K.ink(q, r.label, w / 2, 118, { font: K.FONT.mono, weight: 600, size: 44, tracking: 6, color: ink, align: 'center', id: 'label-' + r.key });
          q.save(); q.strokeStyle = '#8f8a80'; q.setLineDash([7, 6]); q.lineWidth = 2; q.beginPath(); q.moveTo(26, 158); q.lineTo(w - 26, 158); q.moveTo(26, 330); q.lineTo(w - 26, 330); q.stroke(); q.restore();
          K.ink(q, 'AMOUNT', 30, 212, { font: K.FONT.mono, weight: 400, size: 22, tracking: 3, color: '#77736b', id: false, bleed: 0.8 });
          if (T >= a - 0.05) K.odometer(q, r.amount * u, w - 30, 300, { font: K.FONT.mono, weight: 600, size: 80, align: 'right', color: ink, id: 'amt-' + r.key });
          else K.ink(q, '—', w - 30, 290, { font: K.FONT.mono, weight: 400, size: 48, color: '#8f8a80', align: 'right', id: false });
          // a barcode, printed last
          let bx = 44; q.fillStyle = ink;
          for (const [bw, gap] of r.bars) { if (bx + bw > w - 44) break; q.fillRect(bx, 364, bw, 64); bx += bw + gap; }
          // the tick: "every line of it", beside AMOUNT
          const tf = EZ.o3(ev(cue('every') + i * 0.17, 0.3));
          if (tf > 0) K.pen(q, [[150, 196], [166, 214], [198, 176]], { w: 7, frac: tf, color: tok.red, key: 'tick' + i });
        },
      });
      if (feed >= 1) { const c = Math.cos(r.rot * settle), s2 = Math.sin(r.rot * settle), tx = r.x + (r.w / 2) * c, ty = r.y - jump + (r.w / 2) * s2; K.tape(g, tx, ty - 2, 150, 44, r.rot * settle + (i - 1) * 0.06, 'tape' + i); }
    }

    // ---- the total: a double rule on "That's", the sum rolls to the word "sixty", "out the door" in the ledger hand
    const tr = cue('total') - 0.1;
    K.pen(g, [[560, 804], [1720, 798]], { w: 3.4, frac: EZ.io(ev(tr, 0.55)), key: 'rule1' });
    K.pen(g, [[560, 816], [1720, 810]], { w: 2.2, frac: EZ.io(ev(tr + 0.12, 0.55)), key: 'rule2' });
    if (T >= tr + 0.2) K.ink(g, 'Total', 560, 900, { font: K.FONT.italic, style: 'italic', weight: 480, size: 72, chars: 5 * EZ.o2(ev(tr + 0.2, 0.35)), id: 'total-label' });
    const ta = cue('total$'), tb = beat('total$end').end;
    if (T >= ta - 0.05) K.odometer(g, 14460 * EZ.o3(ctx.seg(T, ta - 0.05, tb)), 1720, 962, { size: 160, align: 'right', id: 'total' });
    if (T >= cue('door') - 0.05) K.ink(g, 'out the door', 562, 962, { font: K.FONT.italic, style: 'italic', weight: 480, size: 44, color: '#5b4632', chars: 12 * EZ.o2(ev(cue('door') - 0.05, 0.45)), id: 'door' });

    // ---- PAID: the stamp falls (its shadow converging), lands on the word, and stays
    const fall = paid - 0.16;
    if (T >= fall - 0.35 && T < paid) {
      const s = 1 + 0.55 * (1 - EZ.i2(ctx.seg(T, fall, paid)));
      K.stampShadow(g, 'PAID', 1180, 662, { s, rot: -0.15, size: 170 });
    }
    if (T >= paid) {
      // ink splatter thrown from the edge on impact
      const R = ctx.rng('splat');
      g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = tok.red;
      for (let i = 0; i < 26; i++) { const a = R.r(0, ctx.TAU), d = R.r(250, 330) * (0.85 + 0.15 * EZ.o3(ctx.seg(hit, 0, 0.08))), r = R.r(1.2, 4.5); g.globalAlpha = R.r(0.35, 0.8); g.beginPath(); g.arc(1180 + Math.cos(a) * d * 1.3, 662 + Math.sin(a) * d * 0.55, r, 0, ctx.TAU); g.fill(); }
      g.restore();
      K.stamp(g, 'PAID', 1180, 662, { s: 1, a: 0.92, rot: -0.15, size: 170 });
    }

    ctx.screen();
    K.lamp(g);
    K.grain(g);
  },

  hits(ctx) {
    const c = ctx.cue;
    return [
      { t: c('receipts') + 0.15, kind: 'click', gain: -10 }, { t: c('payroll') - 0.45, kind: 'click', gain: -10 }, { t: c('software') - 0.45, kind: 'click', gain: -10 },
      { t: c('total') - 0.1, kind: 'swish', gain: -14 }, { t: c('every'), kind: 'tick', gain: -12 }, { t: c('every') + 0.17, kind: 'tick', gain: -12 }, { t: c('every') + 0.34, kind: 'tick', gain: -12 },
      { t: c('paid'), kind: 'thump', gain: 0 },
    ];
  },
});
