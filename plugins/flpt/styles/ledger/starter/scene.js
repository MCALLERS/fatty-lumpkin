// Ledger · the starter (a Motion Duet, 7 s, neutral). The heading is written, a receipt prints and its amount rolls,
// the amount becomes a line in the ledger, a red tick, PAID thumps; the camera pulls back from the receipt to the page
// and leans in for the stamp. The presenter's bubble lives in the margin (x 0–380, y 700–1080): nothing goes there.
// Every word sits in the centre 864 px (screen x 560–1360), so the 4:5 tile (a centre crop) keeps it whole.
// Swap the beats for cue words (beats.json "cue") and the numbers for the script's; every number must be said.
FLPT.scene({
  style: 'ledger',
  placement: 'duet',
  layers: ['canvas'],
  keyframes: ['print', 'amount', 'line', 'paid'],

  setup(ctx) {
    const K = ctx.kit;
    K.book(); K.stampFace('PAID', { size: 100 });   // the heavy parts, once
    return { line: K.RULE0 + K.RULE * 9 };
  },

  frame(ctx, T, S) {
    const K = ctx.kit, g = ctx.g, cue = ctx.cue, beat = ctx.beat, EZ = ctx.EZ, seg = ctx.seg;
    const paid = cue('paid'), hit = T - paid, jolt = hit >= 0 ? Math.exp(-hit * 8) : 0;

    // the camera: close on the receipt, back to the page for the line, a lean in for the stamp, a jolt when it lands
    const keys = [[0, 1.32, 870, 380], [cue('line') - 0.25, 1.04, 955, 482], [paid - 0.6, 1.1, 945, 462]];
    const track = (i) => ctx.springTrack(keys.map((k) => [k[0], k[i]]), 'heavy');
    K.view({ z: track(1) * (1 + 0.014 * jolt), p: [track(2), track(3)], to: [960 + Math.sin(hit * 57) * 8 * jolt, 540 + Math.cos(hit * 43) * 10 * jolt] });
    K.desk(g);

    const X = 600, AMT = 1222;   // the item column and the amounts (right-aligned), inside the 4:5 band
    const head = K.write(g, 'The month', X, 172, { font: K.FONT.italic, size: 124, at: cue('heading'), dur: 0.75, id: 'heading' });

    // the ledger line: the receipt's amount, written in; then checked
    const t0 = cue('line');
    K.write(g, 'Supplies', X, S.line - 12, { font: K.FONT.italic, size: 62, at: t0, dur: 0.42, id: 'item' });
    if (T >= t0) {
      const x0 = X + K.measure('Supplies', { font: K.FONT.italic, size: 62 }) + 20, x1 = AMT - K.measure('1,250', { size: 62 }) - 22;
      K.leader(g, x0, x1, S.line - 16, { frac: (EZ.o2(seg(T, t0, t0 + 0.42)) - 0.2) * 1.5 });
    }
    K.write(g, '1,250', AMT, S.line - 12, { size: 62, align: 'right', at: t0 + 0.2, dur: 0.3, id: 'line' });
    const tk = EZ.o3(ctx.ev(cue('tick'), 0.26));
    if (tk > 0) K.tick(g, 1262, S.line - 30, { frac: tk, key: 'line', s: 0.9 });

    // the receipt: it prints a line at a time, the amount rolls to its number, then it's taped down
    const p0 = cue('print'), p1 = beat('print').end;
    if (T >= p0) {
      K.depth(g, 1.012);
      const feed = Math.floor(EZ.o2(seg(T, p0, p1)) * 26) / 26, settle = ctx.spring(T - p1, 'snappy');
      const a = cue('amount'), b = beat('amount').end, v = 1250 * EZ.o3(seg(T, a, b));
      K.receipt(g, {
        x: 650, y: 238 - 6 * (1 - settle), w: 356, len: 410, scale: 0.92, feed, rot: -0.04 * settle, key: 'supplies', lift: 1 - settle,
        draw: (q, w) => K.slip(q, w, { label: 'SUPPLIES', value: T >= a ? v : null, key: 'supplies', ticked: EZ.o3(ctx.ev(t0 + 0.5, 0.24)) }),
      });
      if (feed >= 1) K.tape(g, 650 + 164, 238 - 8, 126, 40, -0.08, 'tape');
      K.depth(g, 1);
    }

    K.depth(g, 1.012);   // PAID goes on the receipt itself, across its barcode and onto the page, clear of every amount
    K.press(g, 'PAID', 846, 606, paid, { size: 100, rot: -0.14, fall: 0.2 });
    K.depth(g, 1);

    // the pen writes the heading, then is set down at the top right (its nib inside the 4:5 band)
    const rest = [1290, 118], lay = cue('heading') + 0.95, u = EZ.io(seg(T, lay, lay + 0.9));
    const pen = T < lay ? { p: head.nib, lift: 0, rot: -0.62 } : { p: [ctx.lerp(head.nib[0], rest[0], u), ctx.lerp(head.nib[1], rest[1], u)], lift: Math.sin(u * Math.PI) * 0.8, rot: ctx.lerp(-0.62, 0.42, u) };
    K.depth(g, 1.03 + 0.05 * pen.lift);
    K.nib(g, pen.p[0], pen.p[1], { lift: pen.lift, rot: pen.rot });
    K.depth(g, 1);

    K.motes(g);
    K.light(g);
    K.grain(g);
  },

  hits(ctx) {
    const c = ctx.cue, out = [];
    for (let j = 0; j < 9; j++) out.push({ t: c('print') + j * 0.1, kind: 'tick', gain: -18 + (j % 3 === 0 ? 3 : 0) });
    out.push({ t: c('line'), kind: 'swish', gain: -12 }, { t: c('tick'), kind: 'click', gain: -8 });
    out.push({ t: c('paid'), kind: 'thump', gain: 0 }, { t: c('paid'), kind: 'sub', gain: -6 });
    return out;
  },
});
