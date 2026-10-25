// Ledger · the demo (a Motion Solo, 7.5 s, neutral): the full frame is free. A crane down the column: three lines are
// written as the camera travels, the column is ruled off, the total rolls to its sum (2,400 + 11,200 + 860 = 14,460),
// and PAID is stamped letter by letter beside it; the camera settles back to the whole page.
FLPT.scene({
  style: 'ledger',
  placement: 'solo',
  layers: ['canvas'],
  keyframes: ['payroll', 'total', 'paid'],

  setup(ctx) {
    const K = ctx.kit;
    K.book();
    for (const ch of 'PAID') K.stampFace(ch, { size: 150, border: false });
    const rows = [['Rent', 2400, 'rent'], ['Payroll', 11200, 'payroll'], ['Software', 860, 'software']].map(([item, amount, cue], i) => ({ item, amount, cue, line: K.RULE0 + K.RULE * (4 + i) }));
    return { rows, total: K.RULE0 + K.RULE * 8 };
  },

  frame(ctx, T, S) {
    const K = ctx.kit, g = ctx.g, cue = ctx.cue, beat = ctx.beat, EZ = ctx.EZ, seg = ctx.seg, AMT = 1300;
    const paid = cue('paid') + 3 * 0.09, hit = T - paid, bump = hit >= 0 ? Math.exp(-hit * 10) : 0;

    // a crane: from the heading down the column to the total, then back to the whole page
    const keys = [[0, 1.4, 760, 160], [cue('payroll') - 0.2, 1.28, 900, 610], [cue('total') - 0.2, 1.2, 1080, 650], [paid + 0.3, 1.12, 1040, 470]];
    const track = (i) => ctx.springTrack(keys.map((k) => [k[0], k[i]]), 'heavy');
    K.view({ z: track(1) * (1 + 0.008 * bump), p: [track(2), track(3)], to: [960, 540 + Math.sin(hit * 50) * 5 * bump] });
    K.desk(g);

    K.write(g, 'The month', 486, 172, { font: K.FONT.italic, size: 124, at: cue('heading'), dur: 0.7, id: 'heading' });
    for (const r of S.rows) {
      const t0 = cue(r.cue), y = r.line - 12, amt = K.fmt(r.amount);
      if (T < t0) continue;
      K.write(g, r.item, 486, y, { font: K.FONT.italic, size: 62, at: t0, dur: 0.36, id: 'item-' + r.cue });
      const x0 = 486 + K.measure(r.item, { font: K.FONT.italic, size: 62 }) + 20, x1 = AMT - K.measure(amt, { size: 62 }) - 22;
      K.leader(g, x0, x1, y - 4, { frac: (EZ.o2(seg(T, t0, t0 + 0.36)) - 0.2) * 1.5 });
      K.write(g, amt, AMT, y, { size: 62, align: 'right', at: t0 + 0.16, dur: 0.28, id: 'amt-' + r.cue });
    }
    const add = cue('adds');
    if (T >= add) K.rule(g, 1040, 1314, S.rows[2].line + 22, { frac: EZ.io(seg(T, add, add + 0.4)), double: false, key: 'sum', w: 3 });
    if (T >= add + 0.15) K.write(g, 'Total', 486, S.total + 14, { font: K.FONT.italic, size: 84, at: add + 0.15, dur: 0.4, id: 'total-label' });
    const ta = cue('total'), tb = beat('total').end;
    if (T >= ta) K.odometer(g, 14460 * EZ.o3(seg(T, ta, tb)), AMT, S.total + 20, { size: 150, align: 'right', id: 'total' });
    if (T >= tb) K.rule(g, 900, 1314, S.total + 54, { frac: EZ.io(seg(T, tb, tb + 0.45)), key: 'close', w: 3.2 });
    K.letters(g, 'PAID', 1400, S.total + 20, { at: cue('paid'), step: 0.09, size: 150, id: 'paid' });

    K.fountain(g, 1560, 150, 0.42, 640);
    K.motes(g);
    K.light(g);
    K.grain(g);
  },

  hits(ctx) {
    const c = ctx.cue, out = [];
    for (const k of ['rent', 'payroll', 'software']) out.push({ t: c(k), kind: 'swish', gain: -14 });
    out.push({ t: c('adds'), kind: 'swish', gain: -10 });
    for (let i = 0; i < 4; i++) out.push({ t: c('paid') + i * 0.09, kind: 'click', gain: i === 3 ? -2 : -8 });
    out.push({ t: c('paid') + 0.27, kind: 'thump', gain: -6 });
    return out;
  },
});
