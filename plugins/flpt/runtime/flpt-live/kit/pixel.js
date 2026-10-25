/* kit/pixel.js · flpt-live shared kit: pixel art on a grid (FLPT.kit.pixel).
 *   pixel.snap(v, cell)                         a coordinate on the grid
 *   pixel.rect(g, x, y, w, h, color, cell)      a block snapped to the grid
 *   pixel.line(g, x0, y0, x1, y1, color, cell)  a stepped line, one cell at a time
 *   pixel.dither(g, x, y, w, h, { tone, cell, color })  a 4×4 Bayer ordered dither
 *   pixel.sprite(g, rows, x, y, { cell, palette })      rows of characters, each a palette colour ('.' or ' ' is empty)
 * No smoothing anywhere: every block lands on whole pixels. */
FLPT.kit.pixel = (() => {
  'use strict';
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const snap = (v, cell = 8) => Math.round(v / cell) * cell;
  function rect(g, x, y, w, h, color, cell = 8) {
    g.fillStyle = color;
    const x0 = snap(x, cell), y0 = snap(y, cell);
    g.fillRect(x0, y0, Math.max(cell, snap(x + w, cell) - x0), Math.max(cell, snap(y + h, cell) - y0));
  }
  function line(g, x0, y0, x1, y1, color, cell = 8) {
    let a = Math.round(x0 / cell), b = Math.round(y0 / cell);
    const c = Math.round(x1 / cell), d = Math.round(y1 / cell), dx = Math.abs(c - a), dy = -Math.abs(d - b), sx = a < c ? 1 : -1, sy = b < d ? 1 : -1;
    let err = dx + dy, guard = 0;
    g.fillStyle = color;
    for (;;) {
      g.fillRect(a * cell, b * cell, cell, cell);
      if ((a === c && b === d) || ++guard > 4096) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; a += sx; }
      if (e2 <= dx) { err += dx; b += sy; }
    }
  }
  function dither(g, x, y, w, h, o = {}) {
    const cell = o.cell || 4, tone = Math.max(0, Math.min(1, o.tone ?? 0.5));
    g.fillStyle = o.color || '#000';
    const x0 = snap(x, cell), y0 = snap(y, cell);
    for (let j = 0, yy = y0; yy < y + h; j++, yy += cell) {
      for (let i = 0, xx = x0; xx < x + w; i++, xx += cell) if ((BAYER[(j % 4) * 4 + (i % 4)] + 0.5) / 16 < tone) g.fillRect(xx, yy, cell, cell);
    }
  }
  function sprite(g, rows, x, y, o = {}) {
    const cell = o.cell || 8, pal = o.palette || {};
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '.' || ch === ' ' || !pal[ch]) continue;
        g.fillStyle = pal[ch];
        g.fillRect(snap(x, cell) + i * cell, snap(y, cell) + j * cell, cell, cell);
      }
    });
  }
  return { snap, rect, line, dither, sprite, BAYER };
})();
