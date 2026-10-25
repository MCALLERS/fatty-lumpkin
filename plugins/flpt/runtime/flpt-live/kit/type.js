/* kit/type.js · flpt-live shared kit: type helpers over ctx.text and the outline fonts (FLPT.kit.type).
 *   type.num(v, { decimals, sep, prefix, suffix })        14,460 / $2,400.50, the same on every machine (no locale tables)
 *   type.fit(str, { font, weight, style, maxWidth, maxSize, minSize })   the largest size that fits a width
 *   type.typeOn(str, u)                                    the first u (0..1) of a string, by characters
 *   type.odometer(g, v, x, y, { font, weight, size, align, color, id })  digits that roll in fixed cells; registers its box */
FLPT.kit.type = (() => {
  'use strict';
  let ctx = null;
  function num(v, o = {}) {
    const d = o.decimals || 0, neg = v < 0, a = Math.abs(Number(v) || 0);
    const [i, f] = a.toFixed(d).split('.');
    const body = i.replace(/\B(?=(\d{3})+(?!\d))/g, o.sep ?? ',') + (f ? '.' + f : '');
    return `${neg ? '-' : ''}${o.prefix || ''}${body}${o.suffix || ''}`;
  }
  function fit(str, o = {}) {
    const max = o.maxSize || 160, min = o.minSize || 12, w = o.maxWidth || 1792;
    let lo = min, hi = max;
    for (let k = 0; k < 14 && hi - lo > 0.5; k++) {
      const mid = (lo + hi) / 2;
      if (ctx.measure(str, { font: o.font, weight: o.weight, style: o.style, size: mid, tracking: o.tracking }).w <= w) lo = mid; else hi = mid;
    }
    return Math.floor(lo);
  }
  const typeOn = (str, u) => { const ch = [...String(str)]; return ch.slice(0, Math.round(ch.length * Math.max(0, Math.min(1, u)))).join(''); };
  function odometer(g, v, x, y, o = {}) {
    const f = { font: o.font, weight: o.weight || 600, size: o.size || 80 }, str = num(Math.floor(v), { sep: o.sep });
    const cell = ctx.measure('0', f).w * 1.02, comma = ctx.measure(o.sep ?? ',', f).w, lh = f.size * 0.9;
    let total = 0;
    for (const ch of str) total += /\d/.test(ch) ? cell : comma;
    const x0 = o.align === 'right' ? x - total : o.align === 'center' ? x - total / 2 : x;
    let cx = x0, k = str.replace(/\D/g, '').length - 1;
    g.save(); g.fillStyle = o.color || ctx.tokens.ink || '#222';
    for (const ch of str) {
      if (!/\d/.test(ch)) { ctx.fillText(g, ch, cx, y, f); cx += comma; continue; }
      const p = 10 ** k, lower = v - Math.floor(v / p) * p, fr = k === 0 ? v - Math.floor(v) : Math.max(0, Math.min(1, lower - (p - 1))), d = Math.floor(v / p) % 10;
      g.save(); g.beginPath(); g.rect(cx - 2, y - f.size * 0.8, cell + 4, f.size * 0.9); g.clip();
      const dx = (dd) => cx + (cell - ctx.measure(String(dd), f).w) / 2;
      ctx.fillText(g, String(d), dx(d), y - fr * lh, f);
      if (fr > 0.001) ctx.fillText(g, String((d + 1) % 10), dx((d + 1) % 10), y - fr * lh + lh, f);
      g.restore(); cx += cell; k--;
    }
    g.restore();
    if (o.id !== false) {
      const T = g.getTransform();
      ctx.registerBox(o.id || 'num', str, { x: T.a * x0 + T.e, y: T.d * (y - f.size * 0.72) + T.f, w: T.a * total, h: T.d * f.size * 0.75 });
    }
    return total;
  }
  return { bind(c) { ctx = c; }, num, fit, typeOn, odometer };
})();
