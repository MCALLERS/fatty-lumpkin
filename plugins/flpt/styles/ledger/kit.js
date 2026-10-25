// =====================================================================
//  Ledger · FLPT's house look (an FLPT original; the Duet default). An open ledger on a walnut desk under a brass
//  lamp: laid parchment with fibres and foxing, blue ruling and a red double margin (the presenter's bubble lives in
//  the margin), iron-gall ink that goes on wet and dries, thermal receipts that print a line at a time, a vermilion
//  rubber stamp that thumps, numbers that roll like an odometer. On ones.
//  World units: the neutral camera shows world (0,0)-(1920,1080) of the right-hand page. The page runs from the
//  gutter at x -150 to x 2150, y -130 to 1300; the desk lies around the book. Heavy parts (desk, book, grain, light,
//  stamp faces, shadows, motes) are made once and composited, so a frame is a few drawImage calls and type.
//    K.view(c)                          remember the scene's camera { z, p, to } (every depth and the motes use it)
//    K.depth(g, k)                      apply the camera for something k times nearer than the page (1 = the page)
//    K.desk(g)                          the desk (depth 0.9) and the book; leaves the page's depth set
//    K.inkwell(g, x, y, o)              an inkwell standing on the page: shoulder and cap nearer, so it leans (parallax)
//    K.write(g, str, x, y, o)           ink type written on left to right (o.frac 0..1, o.at/o.dur); returns the nib
//    K.ink(g, str, x, y, o)             iron-gall ink type (textured, a hair of bleed, wet then dry); registers its box
//    K.leader(g, x0, x1, y, o)          a dot leader between an item and its amount
//    K.pen(g, P, o) · K.tick · K.rule   a pressure stroke, a red check, a single or double rule (o.frac writes on)
//    K.nib(g, x, y, o)                  the fountain pen held writing, its nib at (x, y); K.fountain lies on the page
//    K.receipt(g, o) · K.slip(q, w, o)  thermal paper that prints (o.scale); the standard slip (label, amount, barcode)
//    K.odometer(g, v, x, y, o)          a number whose digits roll; tabular, so nothing jitters
//    K.stamp · K.stampShadow · K.press  a rubber stamp; its falling shadow; the whole fall + thump + splatter
//    K.letters(g, str, x, y, o)         letter stamps thumped one at a time (o.at = the first landing; the kinetic type move)
//    K.motes(g) · K.light(g) · K.grain(g)   dust in the lamp's light (three depths), the lamp's pool, grain; last
// =====================================================================
FLPT.style('ledger', {
  tokens: {
    paper: '#efe2c4', ink: '#2a1d15', wet: '#120b07', red: '#b3311c', blue: '#6f879c', receipt: '#f6f2e8', rink: '#353338',
    desk: '#3a2416', brass: '#b08a4a', font: '"Fraunces Display", serif',
  },
  fonts: [
    { family: 'Fraunces Display', file: 'fraunces-display-semibold.ttf', weight: 620 },
    { family: 'Fraunces Italic', file: 'fraunces-italic.ttf', weight: 480, style: 'italic' },
    { family: 'IBM Plex Mono', file: 'IBMPlexMono-SemiBold.ttf', weight: 600 },
  ],
  ones: true,
  make(env) {
    const { W, H, rng: RNG, clamp, lerp } = env, TAU = Math.PI * 2, tk = env.tokens;
    let F = 0, TT = 0, S = 1, VIEW = { z: 1, p: [W / 2, H / 2], to: [W / 2, H / 2] };
    const canvas = (w, h) => env.canvas(w, h);
    const FONT = { display: '"Fraunces Display"', italic: '"Fraunces Italic"', mono: '"IBM Plex Mono"' };
    const fmt = (n) => String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const mixHex = (a, b, u) => { const A = hex(a), B = hex(b); return `rgb(${A.map((v, i) => Math.round(lerp(v, B[i], clamp(u)))).join(',')})`; };
    const smooth = (u) => { u = clamp(u); return u * u * (3 - 2 * u); };

    // ───────── the camera, and depth: something k times nearer than the page moves and grows k times as much ─────────
    function view(c) { if (c) VIEW = { z: c.z ?? 1, p: c.p || [W / 2, H / 2], to: c.to || [W / 2, H / 2] }; return VIEW; }
    function depth(g, k = 1) {
      const z = VIEW.z * k;
      g.setTransform(z * S, 0, 0, z * S, (VIEW.to[0] - z * VIEW.p[0]) * S, (VIEW.to[1] - z * VIEW.p[1]) * S);
    }
    const toScreen = (g, x, y) => { const T = g.getTransform(); return [(T.a * x + T.c * y + T.e) / S, (T.b * x + T.d * y + T.f) / S]; };   // scene units

    // ───────── paper texture: a tile of fine grain, multiplied into every sheet ─────────
    let TOOTH = null;
    function tooth() {
      if (TOOTH) return TOOTH;
      const s = 256, c = canvas(s, s), p = c.getContext('2d'), d = p.createImageData(s, s), R = RNG('ledger-tooth');
      for (let i = 0; i < d.data.length; i += 4) { const v = 236 + R.n(1) * 18; d.data[i] = v; d.data[i + 1] = v - 2; d.data[i + 2] = v - 6; d.data[i + 3] = 255; }
      p.putImageData(d, 0, 0);
      return (TOOTH = c);
    }

    // ───────── the desk: walnut, grain running left to right, half resolution (always a little out of focus) ─────────
    const DX = -1100, DY = -760, DW = 4300, DH = 2700, DESK_K = 0.9;
    let DESK = null;
    function deskCanvas() {
      if (DESK) return DESK;
      const s = 0.5, c = canvas(DW * s, DH * s), p = c.getContext('2d'), R = RNG('ledger-desk');
      p.scale(s, s);
      const base = p.createLinearGradient(0, 0, 0, DH); base.addColorStop(0, '#2c1a10'); base.addColorStop(0.5, tk.desk); base.addColorStop(1, '#25150c');
      p.fillStyle = base; p.fillRect(0, 0, DW, DH);
      p.lineCap = 'round';
      for (let i = 0; i < 520; i++) {   // the grain: long, slow waves, light and dark
        let y = R.r(-40, DH + 40); const amp = R.r(4, 26), f = R.r(0.0012, 0.004), ph = R.r(0, TAU), lw = R.r(1, 7);
        p.strokeStyle = R.f() < 0.6 ? `rgba(20,10,4,${R.r(0.08, 0.28)})` : `rgba(150,96,52,${R.r(0.05, 0.16)})`; p.lineWidth = lw;
        p.beginPath(); for (let x = -20; x <= DW + 20; x += 40) p.lineTo(x, y + Math.sin(x * f + ph) * amp + Math.sin(x * f * 3.1 + ph * 2) * amp * 0.25); p.stroke();
      }
      for (let i = 0; i < 9000; i++) { p.fillStyle = `rgba(12,6,2,${R.r(0.1, 0.35)})`; p.fillRect(R.r(0, DW), R.r(0, DH), R.r(3, 14), R.r(0.8, 1.8)); }   // pores
      const sheen = p.createLinearGradient(0, DH * 0.2, DW, DH * 0.6); sheen.addColorStop(0, 'rgba(255,200,140,0)'); sheen.addColorStop(0.55, 'rgba(255,200,140,0.07)'); sheen.addColorStop(1, 'rgba(255,200,140,0)');
      p.fillStyle = sheen; p.fillRect(0, 0, DW, DH);
      return (DESK = c);
    }

    // ───────── the book: the right-hand page, a sliver of the left one, the page block and the cover boards ─────────
    const BX = -640, BY = -280, BW = 2990, BH = 1800;   // the book's canvas, world
    const PG = { x0: -150, y0: -130, x1: 2150, y1: 1300 };   // the right-hand page
    const CV = { x0: -600, y0: PG.y0 - 64, x1: PG.x1 + 64, y1: PG.y1 + 64 };   // the cover boards (the square around the page block)
    const RULE0 = 232, RULE = 58, MARGIN = 420, COLS = [1000, 1240];
    let BOOK = null;
    function book() {
      if (BOOK) return BOOK;
      const c = canvas(BW, BH), p = c.getContext('2d'), R = RNG('ledger-page');
      p.translate(-BX, -BY);
      const board = () => { p.beginPath(); p.roundRect(CV.x0, CV.y0, CV.x1 - CV.x0, CV.y1 - CV.y0, 20); };
      // the book's shadow on the desk: a close, soft one all round and a long one away from the lamp (down and left)
      p.save(); p.fillStyle = '#3e1712'; p.shadowColor = 'rgba(8,3,0,0.6)'; p.shadowBlur = 30; p.shadowOffsetY = 8; board(); p.fill(); p.restore();
      p.save(); p.fillStyle = '#3e1712'; p.shadowColor = 'rgba(8,3,0,0.62)'; p.shadowBlur = 90; p.shadowOffsetX = -30; p.shadowOffsetY = 44; board(); p.fill(); p.restore();
      // the cover: oxblood cloth over board, a fine weave and wear
      const cl = p.createLinearGradient(CV.x1, CV.y0, CV.x1 - 1400, CV.y1); cl.addColorStop(0, '#6b281f'); cl.addColorStop(1, '#4b1a14');
      p.fillStyle = cl; board(); p.fill();
      p.save(); board(); p.clip();
      for (let i = 0; i < 2600; i++) { p.fillStyle = `rgba(${R.f() < 0.5 ? '20,4,2' : '150,66,52'},${R.r(0.08, 0.22)})`; p.fillRect(R.r(CV.x0, CV.x1), R.r(CV.y0, CV.y1), R.r(1, 3), R.r(1, 3)); }
      for (let y = CV.y0; y < CV.y1; y += 3) { p.fillStyle = `rgba(${Math.round(y) % 2 ? '0,0,0' : '255,200,170'},0.06)`; p.fillRect(CV.x0, y, CV.x1 - CV.x0, 1); }   // the cloth's weave
      for (let x = CV.x0; x < CV.x1; x += 4) { p.fillStyle = 'rgba(20,4,0,0.05)'; p.fillRect(x, CV.y0, 1.4, CV.y1 - CV.y0); }
      const sheen = p.createLinearGradient(CV.x1 - 1600, CV.y0, CV.x1, CV.y0 + 400);   // the lamp glances off the cloth, up and to the right
      sheen.addColorStop(0, 'rgba(255,190,150,0)'); sheen.addColorStop(0.7, 'rgba(255,190,150,0.06)'); sheen.addColorStop(1, 'rgba(255,200,160,0.16)');
      p.fillStyle = sheen; p.fillRect(CV.x0, CV.y0, CV.x1 - CV.x0, CV.y1 - CV.y0);
      // gilt tooling: a double rule pressed into the cloth round the square, a little worn
      p.lineWidth = 2.2;
      for (const [d, a] of [[18, 0.7], [27, 0.45]]) {
        const gt = p.createLinearGradient(CV.x1, CV.y0, CV.x1 - 1200, CV.y1); gt.addColorStop(0, `rgba(236,198,120,${a})`); gt.addColorStop(1, `rgba(150,110,50,${a * 0.55})`);
        p.strokeStyle = gt; p.setLineDash([R.r(60, 140), 2.5, R.r(200, 400), 3]); p.beginPath(); p.roundRect(CV.x0 + d, CV.y0 + d, CV.x1 - CV.x0 - 2 * d, CV.y1 - CV.y0 - 2 * d, 12); p.stroke();
      }
      p.setLineDash([]);
      // the board's rounded edge: lit along the top and right (the lamp), in shade along the bottom and left
      const bev = p.createLinearGradient(CV.x1, CV.y0, CV.x1 - 900, CV.y1 + 300);
      bev.addColorStop(0, 'rgba(255,206,170,0.5)'); bev.addColorStop(0.45, 'rgba(255,196,160,0.16)'); bev.addColorStop(1, 'rgba(10,2,0,0.5)');
      p.strokeStyle = bev; p.lineWidth = 16; board(); p.globalAlpha = 0.45; p.stroke(); p.lineWidth = 3.5; p.globalAlpha = 1; board(); p.stroke();
      // the page block sits on the board: its contact shadow, deeper away from the lamp, and a tight dark seam all round
      p.filter = 'blur(12px)'; p.fillStyle = 'rgba(16,4,1,0.62)'; p.fillRect(-600, PG.y0 + 4, PG.x1 + 588, PG.y1 - PG.y0 + 20);
      p.filter = 'blur(3px)'; p.fillStyle = 'rgba(16,4,1,0.55)'; p.fillRect(-600, PG.y0 - 5, PG.x1 + 608, PG.y1 - PG.y0 + 30); p.filter = 'none';
      p.restore();
      for (let k = 4; k >= 1; k--) {   // the head of the page block: a few leaves stand a hair proud of the top page, unevenly
        const x0 = -600 + R.r(0, 300), x1 = PG.x1 - R.r(0, 260);
        p.fillStyle = k % 2 ? 'rgba(236,222,186,0.95)' : 'rgba(150,120,80,0.8)'; p.fillRect(x0, PG.y0 - k * 1.6, x1 - x0, 1.6);
      }
      for (let k = 28; k >= 1; k--) {   // the page block: many thin leaves below and beyond the page, darker as they go down
        p.fillStyle = `rgb(${Math.round(220 - k * 2.2 + R.n(5))},${Math.round(204 - k * 2.4 + R.n(5))},${Math.round(160 - k * 2.4 + R.n(5))})`;
        p.fillRect(-600, PG.y0 + k * 0.7, PG.x1 + 600 + k * 0.62, PG.y1 - PG.y0 + k * 0.78);
      }
      for (let k = 0; k < 9; k++) {   // the leaves' edges catch the lamp on the fore-edge; a hairline between each
        p.fillStyle = `rgba(${k % 2 ? '255,248,226,0.34' : '90,60,26,0.2'})`;
        p.fillRect(PG.x1 + 2 + k * 1.8, PG.y0 + 6 + k * 1.3, 1.2, PG.y1 - PG.y0 + k * 0.4);
        p.fillRect(-600, PG.y1 + 2 + k * 2.2, PG.x1 + 600 + k * 1.6, 1.2);
      }
      p.fillStyle = 'rgba(40,20,6,0.35)'; p.fillRect(-600, PG.y1, PG.x1 + 600, 2); p.fillRect(PG.x1, PG.y0, 2, PG.y1 - PG.y0);
      // the paper, both pages
      const sheet = (x0, x1) => {
        p.fillStyle = tk.paper; p.fillRect(x0, PG.y0, x1 - x0, PG.y1 - PG.y0);
        p.save(); p.globalCompositeOperation = 'multiply'; p.fillStyle = p.createPattern(tooth(), 'repeat'); p.fillRect(x0, PG.y0, x1 - x0, PG.y1 - PG.y0); p.restore();
      };
      sheet(-600, PG.x0); sheet(PG.x0, PG.x1);
      p.save(); p.beginPath(); p.rect(-600, PG.y0, PG.x1 + 600, PG.y1 - PG.y0); p.clip();
      for (let i = 0; i < 520; i++) {   // mottling: soft light and dark clouds
        const x = R.r(-600, PG.x1), y = R.r(PG.y0, PG.y1), r = R.r(40, 280), gr = p.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, R.f() < 0.6 ? 'rgba(255,250,235,0.05)' : 'rgba(150,108,58,0.014)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        p.fillStyle = gr; p.fillRect(x - r, y - r, 2 * r, 2 * r);
      }
      p.lineCap = 'round';
      for (let i = 0; i < 7600; i++) {   // fibres
        let x = R.r(-600, PG.x1), y = R.r(PG.y0, PG.y1), a = R.r(0, TAU); const L = R.r(6, 24), bend = R.n(0.4);
        p.strokeStyle = `rgba(${R.f() < 0.7 ? '110,80,45' : '255,250,235'},${R.r(0.05, 0.15)})`; p.lineWidth = R.r(0.5, 1.1);
        p.beginPath(); p.moveTo(x, y); for (let j = 0; j < 5; j++) { a += bend; x += (Math.cos(a) * L) / 5; y += (Math.sin(a) * L) / 5; p.lineTo(x, y); } p.stroke();
      }
      for (let y = PG.y0 + 8; y < PG.y1; y += 26) { p.strokeStyle = 'rgba(120,90,50,0.035)'; p.lineWidth = 1; p.beginPath(); p.moveTo(-600, y); p.lineTo(PG.x1, y + R.n(1)); p.stroke(); }   // laid lines
      for (let i = 0; i < 60; i++) {   // foxing: small rust clusters
        const cx = R.r(-600, PG.x1), cy = R.r(PG.y0, PG.y1), n = R.i(4, 26), s = R.r(4, 26);
        for (let k = 0; k < n; k++) { p.fillStyle = `rgba(${R.i(130, 160)},${R.i(80, 100)},40,${R.r(0.08, 0.28)})`; p.beginPath(); p.arc(cx + R.n(s), cy + R.n(s), R.r(0.6, 2.6), 0, TAU); p.fill(); }
      }
      { // one tea ring, low on the right, and its ghost
        const cx = 1990, cy = 690, r = 104;
        for (const [a, off] of [[0.13, 0], [0.05, 9]]) {
          p.strokeStyle = `rgba(140,95,45,${a})`; p.lineWidth = 5;
          p.beginPath(); for (let t = 0.3; t < TAU * 0.92; t += 0.04) { const rr = r * (1 + 0.03 * Math.sin(t * 5)); p.lineTo(cx + off + Math.cos(t) * rr, cy - off + Math.sin(t) * rr); } p.stroke();
        }
      }
      // the ruling: faded blue lines, a red double margin, the amount column
      p.lineWidth = 1.5;
      for (let y = RULE0; y < PG.y1 - 20; y += RULE) { p.strokeStyle = 'rgba(95,128,160,0.32)'; p.beginPath(); p.moveTo(PG.x0 + 30, y + R.n(0.6)); p.lineTo(PG.x1, y + R.n(0.6)); p.stroke(); }
      for (const [x, a] of [[MARGIN, 0.55], [MARGIN + 8, 0.45]]) { p.strokeStyle = `rgba(179,49,28,${a})`; p.lineWidth = 1.7; p.beginPath(); p.moveTo(x, PG.y0); p.lineTo(x + 1.5, PG.y1); p.stroke(); }
      for (const x of COLS) { p.strokeStyle = 'rgba(95,128,160,0.26)'; p.lineWidth = 1.3; p.beginPath(); p.moveTo(x, PG.y0); p.lineTo(x, PG.y1); p.stroke(); }
      p.restore();
      // the gutter: the pages curve down into the spine (shadow, then a lit crest)
      const gs = p.createLinearGradient(PG.x0 - 90, 0, PG.x0 + 260, 0);
      gs.addColorStop(0, 'rgba(50,28,10,0.05)'); gs.addColorStop(0.24, 'rgba(50,28,10,0.55)'); gs.addColorStop(0.28, 'rgba(50,28,10,0.6)');
      gs.addColorStop(0.42, 'rgba(50,28,10,0.16)'); gs.addColorStop(0.62, 'rgba(255,248,230,0.06)'); gs.addColorStop(1, 'rgba(50,28,10,0)');
      p.fillStyle = gs; p.fillRect(PG.x0 - 90, PG.y0, 350, PG.y1 - PG.y0);
      // the paper's edges: toned with age, and a lit hairline where the top and fore-edge catch the lamp
      const eg = p.createLinearGradient(0, PG.y1 - 40, 0, PG.y1); eg.addColorStop(0, 'rgba(60,35,10,0)'); eg.addColorStop(1, 'rgba(60,35,10,0.18)');
      p.fillStyle = eg; p.fillRect(-600, PG.y1 - 40, PG.x1 + 600, 40);
      const et = p.createLinearGradient(0, PG.y0, 0, PG.y0 + 34); et.addColorStop(0, 'rgba(70,40,12,0.2)'); et.addColorStop(1, 'rgba(70,40,12,0)');
      p.fillStyle = et; p.fillRect(-600, PG.y0, PG.x1 + 600, 34);
      const er = p.createLinearGradient(PG.x1 - 34, 0, PG.x1, 0); er.addColorStop(0, 'rgba(70,40,12,0)'); er.addColorStop(1, 'rgba(70,40,12,0.16)');
      p.fillStyle = er; p.fillRect(PG.x1 - 34, PG.y0, 34, PG.y1 - PG.y0);
      p.fillStyle = 'rgba(255,250,236,0.7)'; p.fillRect(-600, PG.y0, PG.x1 + 600, 1.6); p.fillRect(PG.x1 - 1.6, PG.y0, 1.6, PG.y1 - PG.y0);
      return (BOOK = c);
    }
    /** The desk (well below the page, so it slides slower: depth 0.9) and the book. */
    function desk(g) {
      const z = VIEW.z, x0 = VIEW.p[0] - VIEW.to[0] / z, y0 = VIEW.p[1] - VIEW.to[1] / z, x1 = x0 + W / z, y1 = y0 + H / z;
      const B = { x0: CV.x0 + 24, y0: CV.y0 + 24, x1: CV.x1 - 24, y1: CV.y1 - 24 };
      if (x0 < B.x0 || y0 < B.y0 || x1 > B.x1 || y1 > B.y1) { depth(g, DESK_K); g.drawImage(deskCanvas(), DX, DY, DW, DH); }
      depth(g, 1);
      g.drawImage(book(), BX, BY);
    }

    // ───────── an inkwell standing on the page: its base on the paper, its shoulder and cap nearer, so it leans as the
    //           camera passes (the strongest parallax on the desk); cast away from the lamp ─────────
    let WELL = null;
    function wellParts() {
      if (WELL) return WELL;
      const s = 300, q = 1.5, n = Math.round(s * q), r = s * 0.2;
      // the shoulder seen from above: thick glass (lit up and to the right), the ink dark inside it, a glass collar
      const glass = canvas(n, n), p = glass.getContext('2d'); p.scale(q, q);
      const sq = (i) => { p.beginPath(); p.roundRect(i, i, s - 2 * i, s - 2 * i, Math.max(4, r - i)); };
      const gl = p.createLinearGradient(s, 0, 0, s); gl.addColorStop(0, '#6c84a6'); gl.addColorStop(0.4, '#2b3a55'); gl.addColorStop(1, '#151d2c');
      p.fillStyle = gl; sq(0); p.fill();
      const ink = p.createRadialGradient(s * 0.44, s * 0.56, s * 0.04, s * 0.5, s * 0.5, s * 0.44);
      ink.addColorStop(0, '#04060b'); ink.addColorStop(0.75, '#0b1222'); ink.addColorStop(1, '#1c2a46');
      p.fillStyle = ink; sq(s * 0.09); p.fill();
      const rim = p.createLinearGradient(s, 0, 0, s); rim.addColorStop(0, 'rgba(255,244,222,0.95)'); rim.addColorStop(0.5, 'rgba(255,244,222,0.18)'); rim.addColorStop(1, 'rgba(255,244,222,0.05)');
      p.strokeStyle = rim; p.lineWidth = 2.4; sq(1.5); p.stroke(); p.lineWidth = 1.4; sq(s * 0.09); p.stroke();
      p.fillStyle = 'rgba(44,58,84,0.96)'; p.beginPath(); p.arc(s / 2, s / 2, s * 0.25, 0, TAU); p.fill();   // the collar
      p.strokeStyle = 'rgba(255,244,222,0.45)'; p.lineWidth = 1.6; p.beginPath(); p.arc(s / 2, s / 2, s * 0.25, -1.4, 0.1); p.stroke();
      p.strokeStyle = 'rgba(255,248,232,0.75)'; p.lineCap = 'round';
      for (const [a, b, w] of [[[s * 0.56, s * 0.055], [s * 0.82, s * 0.06], 3.2], [[s * 0.945, s * 0.2], [s * 0.94, s * 0.44], 2.6], [[s * 0.2, s * 0.94], [s * 0.3, s * 0.945], 1.6]]) { p.lineWidth = w; p.beginPath(); p.moveTo(a[0], a[1]); p.lineTo(b[0], b[1]); p.stroke(); }
      // the cap: a flat brass screw cap, knurled round its edge
      const cs = Math.round(s * 0.5 * q), cap = canvas(cs, cs), k = cap.getContext('2d'), cr = s * 0.19, cc = s * 0.25; k.scale(q, q);
      const br = k.createLinearGradient(cc + cr, cc - cr, cc - cr, cc + cr); br.addColorStop(0, '#f1d48e'); br.addColorStop(0.5, '#b8913f'); br.addColorStop(1, '#6e501c');
      k.fillStyle = br; k.beginPath(); k.arc(cc, cc, cr, 0, TAU); k.fill();
      k.strokeStyle = 'rgba(60,40,10,0.55)'; k.lineWidth = 1.1;
      for (let i = 0; i < 48; i++) { const a = (i / 48) * TAU; k.beginPath(); k.moveTo(cc + Math.cos(a) * cr * 0.84, cc + Math.sin(a) * cr * 0.84); k.lineTo(cc + Math.cos(a) * cr, cc + Math.sin(a) * cr); k.stroke(); }
      const face = k.createLinearGradient(cc + cr, cc - cr, cc - cr, cc + cr); face.addColorStop(0, '#e2c27c'); face.addColorStop(1, '#8a6928');
      k.fillStyle = face; k.beginPath(); k.arc(cc, cc, cr * 0.8, 0, TAU); k.fill();
      k.strokeStyle = 'rgba(255,240,200,0.6)'; k.lineWidth = 1.4; k.beginPath(); k.arc(cc, cc, cr * 0.8, -1.5, 0); k.stroke();
      k.strokeStyle = 'rgba(50,32,6,0.5)'; k.beginPath(); k.arc(cc, cc, cr * 0.8, 1.6, 3.1); k.stroke();
      const sh = canvas(n, n), h = sh.getContext('2d'); h.scale(q, q); h.filter = 'blur(18px)'; h.fillStyle = 'rgba(40,20,4,0.5)'; h.beginPath(); h.roundRect(s * 0.12, s * 0.12, s * 0.76, s * 0.76, r); h.fill();
      return (WELL = { s, r, glass, cap, sh });
    }
    /** An inkwell standing on the page at world (x, y) (its centre); o.size, o.height (depth added at the shoulder). Leaves depth 1 set. */
    function inkwell(g, x, y, o = {}) {
      const P = wellParts(), s = o.size || P.s, f = s / P.s, h = o.height ?? 0.1;
      const at = (k) => { const z = VIEW.z * k; return { x: VIEW.to[0] + z * (x - VIEW.p[0]), y: VIEW.to[1] + z * (y - VIEW.p[1]), z }; };
      const base = at(1), sho = at(1 + h), cap = at(1 + h * 1.5), half = (s / 2) * sho.z;
      if (sho.x + half < -40 || sho.x - half > W + 40 || sho.y + half < -40 || sho.y - half > H + 40) return;
      depth(g, 1);   // the shadow on the paper, long and away from the lamp
      g.save(); g.globalCompositeOperation = 'multiply'; g.drawImage(P.sh, x - s / 2 - s * 0.32, y - s / 2 + s * 0.4, s, s); g.restore();
      g.save(); g.setTransform(S, 0, 0, S, 0, 0);
      const ring = (c) => { const hs = (s / 2) * c.z, rr = P.r * f * c.z, out = []; for (const [cx, cy, a0] of [[1, -1, -Math.PI / 2], [1, 1, 0], [-1, 1, Math.PI / 2], [-1, -1, Math.PI]]) for (let i = 0; i <= 6; i++) { const a = a0 + (i / 6) * (Math.PI / 2); out.push([c.x + cx * (hs - rr) + Math.cos(a) * rr, c.y + cy * (hs - rr) + Math.sin(a) * rr]); } return out; };
      const pts = [...ring(base), ...ring(sho)].sort((a, b) => a[0] - b[0] || a[1] - b[1]), cross = (o2, a, b) => (a[0] - o2[0]) * (b[1] - o2[1]) - (a[1] - o2[1]) * (b[0] - o2[0]);
      const lo = [], hi = [];   // the body: the hull of the base and the shoulder (dark glass full of ink)
      for (const pt of pts) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], pt) <= 0) lo.pop(); lo.push(pt); }
      for (const pt of pts.slice().reverse()) { while (hi.length > 1 && cross(hi[hi.length - 2], hi[hi.length - 1], pt) <= 0) hi.pop(); hi.push(pt); }
      const hull = [...lo.slice(0, -1), ...hi.slice(0, -1)];
      const bg = g.createLinearGradient(base.x, base.y, sho.x, sho.y); bg.addColorStop(0, '#080b12'); bg.addColorStop(0.6, '#18233a'); bg.addColorStop(1, '#2c3d5c');
      g.fillStyle = bg; g.beginPath(); hull.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(255,240,215,0.28)'; g.lineWidth = 1.4; g.stroke();
      g.drawImage(P.glass, sho.x - half, sho.y - half, half * 2, half * 2);
      const cs = (P.s * 0.5 * f * cap.z) / 2;
      g.drawImage(P.cap, cap.x - cs, cap.y - cs, cs * 2, cs * 2);
      g.restore();
      depth(g, 1);
    }

    // ───────── light (screen space): the lamp's warm pool from the upper right, a breath of flicker; then grain ─────────
    let LIGHT = null; const GRAIN = [];
    function light(g, o = {}) {
      if (!LIGHT) {
        LIGHT = canvas(W, H); const p = LIGHT.getContext('2d');
        const gr = p.createRadialGradient(W * 0.6, H * 0.3, 60, W * 0.54, H * 0.46, W * 0.8);
        gr.addColorStop(0, 'rgba(255,226,170,0.0)'); gr.addColorStop(0.38, 'rgba(214,152,82,0.13)'); gr.addColorStop(0.7, 'rgba(120,66,24,0.46)'); gr.addColorStop(1, 'rgba(36,18,5,0.8)');
        p.fillStyle = gr; p.fillRect(0, 0, W, H);
      }
      const n = RNG('flicker', Math.floor(F / 5)).r(), n2 = RNG('flicker', Math.floor(F / 5) + 1).r(), fl = 1 + (o.flicker ?? 1) * 0.035 * (lerp(n, n2, (F % 5) / 5) - 0.5);
      g.save(); g.setTransform(S, 0, 0, S, 0, 0);
      g.globalCompositeOperation = 'multiply'; g.globalAlpha = clamp((o.dark ?? 1) * fl, 0, 1); g.drawImage(LIGHT, 0, 0);
      const warm = g.createRadialGradient(W * 0.7, H * 0.18, 20, W * 0.66, H * 0.3, W * 0.5);
      warm.addColorStop(0, `rgba(255,210,140,${0.15 * fl})`); warm.addColorStop(1, 'rgba(255,214,150,0)');
      g.globalCompositeOperation = 'screen'; g.globalAlpha = 1; g.fillStyle = warm; g.fillRect(0, 0, W, H);
      g.restore();
    }
    function grain(g, o = {}) {
      const v = Math.floor(F / 2) % 4;
      if (!GRAIN[v]) {
        const c = canvas(W / 2, H / 2), p = c.getContext('2d'), d = p.createImageData(W / 2, H / 2), R = RNG('grain', v);
        for (let i = 0; i < d.data.length; i += 4) { const n = 128 + R.n(1) * 64; d.data[i] = d.data[i + 1] = d.data[i + 2] = n; d.data[i + 3] = 255; }
        p.putImageData(d, 0, 0); GRAIN[v] = c;
      }
      g.save(); g.setTransform(S, 0, 0, S, 0, 0); g.globalCompositeOperation = 'overlay'; g.globalAlpha = o.amount ?? 0.15; g.imageSmoothingEnabled = false; g.drawImage(GRAIN[v], 0, 0, W, H); g.restore();
    }

    // ───────── motes: a few warm specks of dust in the lamp's light, out of focus, at three depths (parallax) ─────────
    let MOTE = null;
    function motes(g, o = {}) {
      if (!MOTE) {
        MOTE = canvas(64, 64); const p = MOTE.getContext('2d'), gr = p.createRadialGradient(32, 32, 0, 32, 32, 32);
        gr.addColorStop(0, 'rgba(255,236,196,1)'); gr.addColorStop(0.35, 'rgba(255,226,170,0.55)'); gr.addColorStop(1, 'rgba(255,220,160,0)');
        p.fillStyle = gr; p.fillRect(0, 0, 64, 64);
      }
      const R = RNG('motes'), n = o.n ?? 16, a = o.alpha ?? 1;
      g.save(); g.globalCompositeOperation = 'screen';
      for (let i = 0; i < n; i++) {
        const k = [1.3, 1.6, 2.0][i % 3], x = R.r(300, 2300), y = R.r(-200, 1100), r = R.r(5, 16) * k, ph = R.r(0, TAU), al = R.r(0.05, 0.16);
        const px = x + Math.sin(TT * 0.21 + ph) * 40, py = y - TT * R.r(4, 11) + Math.cos(TT * 0.17 + ph) * 22;
        depth(g, k);
        const [sx, sy] = toScreen(g, px, py);
        if (sx < 440 && sy > 640) continue;   // never in the presenter's corner
        g.globalAlpha = al * a * clamp((sx - 300) / 600);   // only where the lamp reaches
        g.drawImage(MOTE, px - r, py - r, 2 * r, 2 * r);
      }
      g.restore(); depth(g, 1);
    }

    // ───────── type in ink: multiply onto the paper, a hair of bleed, wet then dry; registered for the checks ─────────
    let INKTEX = null;
    function inkTex() {   // iron-gall ink: brown-black with pools and thin places, a fine grain
      if (INKTEX) return INKTEX;
      const s = 256, c = canvas(s, s), p = c.getContext('2d'), R = RNG('ledger-ink');
      p.fillStyle = tk.ink; p.fillRect(0, 0, s, s);
      for (let i = 0; i < 70; i++) {
        const x = R.r(0, s), y = R.r(0, s), r = R.r(8, 46), gr = p.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, R.f() < 0.5 ? 'rgba(96,66,40,0.28)' : 'rgba(6,3,2,0.4)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        for (const [dx, dy] of [[0, 0], [s, 0], [-s, 0], [0, s], [0, -s]]) { p.save(); p.translate(dx, dy); p.fillStyle = gr; p.fillRect(x - r, y - r, 2 * r, 2 * r); p.restore(); }
      }
      const d = p.getImageData(0, 0, s, s);
      for (let i = 0; i < d.data.length; i += 4) { const n = R.n(9); d.data[i] += n; d.data[i + 1] += n; d.data[i + 2] += n; }
      p.putImageData(d, 0, 0);
      return (INKTEX = c);
    }
    function fontOf(o) { return { family: o.font || FONT.display, style: o.style || (o.font === FONT.italic ? 'italic' : 'normal'), weight: o.weight || (o.font === FONT.italic ? 480 : o.font === FONT.mono ? 600 : 620), size: o.size || 40, tracking: o.tracking || 0 }; }
    function inkColor(o) { if (o.color) return o.color; return o.wet != null ? mixHex(tk.wet, tk.ink, 1 - o.wet) : tk.ink; }
    function register(g, id, str, x0, y, m) {
      const C = [toScreen(g, x0, y - m.asc), toScreen(g, x0 + m.w, y - m.asc), toScreen(g, x0 + m.w, y + m.desc), toScreen(g, x0, y + m.desc)];
      const xs = C.map((c) => c[0]), ys = C.map((c) => c[1]);
      env.registerBox(id, str, { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
    }
    function ink(g, str, x, y, o = {}) {
      const f = fontOf(o), m = env.measure(str, f), w = m.w, x0 = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x;
      const n = o.chars != null ? Math.max(0, Math.min(str.length, Math.floor(o.chars))) : str.length, s = str.slice(0, n);
      if (!s) return w;
      const col = inkColor(o), textured = !o.color && f.size >= 44;
      g.save();
      g.globalCompositeOperation = o.op || 'multiply'; g.fillStyle = textured ? g.createPattern(inkTex(), 'repeat') : col; g.globalAlpha = o.alpha ?? 1;
      if (o.bleed !== false) { g.shadowColor = col; g.shadowBlur = o.bleed || 1.8; }
      env.fillText(g, s, x0, y, f);
      if (textured && (o.wet ?? 0) > 0.02) { g.shadowBlur = 0; g.fillStyle = tk.wet; g.globalAlpha = (o.alpha ?? 1) * 0.75 * o.wet; env.fillText(g, s, x0, y, f); }
      g.restore();
      if (o.id !== false) register(g, o.id || str, str, x0, y, m);
      return w;
    }
    const measure = (str, o = {}) => env.measure(str, fontOf(o)).w;
    /** Written on, left to right, under a soft clip: o.frac (or o.at + o.dur). Returns { w, nib: [x, y] } (the pen's point). */
    function write(g, str, x, y, o = {}) {
      const f = fontOf(o), m = env.measure(str, f), x0 = o.align === 'center' ? x - m.w / 2 : o.align === 'right' ? x - m.w : x;
      const u = o.frac != null ? clamp(o.frac) : clamp((TT - (o.at ?? 0)) / (o.dur || 0.6));
      const edge = x0 + m.w * u, nib = [edge - f.size * 0.04, y - f.size * 0.2];
      if (u <= 0) return { w: m.w, nib, u };
      const dry = o.at != null ? clamp((TT - o.at - (o.dur || 0.6) * u) / 0.7) : 1, band = f.size * 0.09, y0c = y - m.asc * 1.6, hh = m.asc * 2.4 + m.desc;
      const slice = (a, b, alpha) => { g.save(); g.beginPath(); g.rect(a, y0c, b - a, hh); g.clip(); ink(g, str, x, y, { ...o, id: false, wet: o.wet ?? (1 - dry), alpha: (o.alpha ?? 1) * alpha }); g.restore(); };
      if (u >= 1) slice(x0 - m.asc, x0 + m.w + m.asc, 1);
      else { slice(x0 - m.asc, edge - band, 1); slice(edge - band, edge, 0.7); slice(edge, edge + band * 0.6, 0.3); }
      if (o.id !== false) register(g, o.id || str, str, x0, y, m);
      return { w: m.w, nib, u };
    }

    // ───────── the pen: a ribbon with pressure, keyed (never boiled); o.frac writes it on ─────────
    function pen(g, P, o = {}) {
      const R = RNG('pen', o.key || 'p'), Q = [];
      for (let i = 0; i < P.length - 1; i++) { const a = P[i], b = P[i + 1], k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 6)); for (let j = 0; j < k; j++) Q.push([lerp(a[0], b[0], j / k), lerp(a[1], b[1], j / k)]); }
      Q.push(P[P.length - 1]);
      const fr = clamp(o.frac ?? 1); if (fr <= 0) return null;
      const n = Math.max(2, Math.round(Q.length * fr));
      const w = o.w || 4, f1 = R.r(0.02, 0.05), p1 = R.r(0, TAU), L = [], Rt = [];
      for (let i = 0; i < n; i++) {
        const a = Q[Math.max(0, i - 1)], b = Q[Math.min(Q.length - 1, i + 1)]; let nx = a[1] - b[1], ny = b[0] - a[0]; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
        const t = i / (Q.length - 1), taper = Math.min(1, t / 0.06, (1 - t) / 0.12 + 0.35), hw = (w / 2) * taper * (1 + 0.28 * Math.sin(i * 6 * f1 + p1)) + R.n(0.25);
        const jx = R.n(0.4), jy = R.n(0.4);
        L.push([Q[i][0] + nx * hw + jx, Q[i][1] + ny * hw + jy]); Rt.push([Q[i][0] - nx * hw + jx, Q[i][1] - ny * hw + jy]);
      }
      const col = o.color || inkColor(o);
      g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = col; g.shadowColor = col; g.shadowBlur = 1.4; g.globalAlpha = o.alpha ?? 1;
      g.beginPath(); g.moveTo(L[0][0], L[0][1]); for (const q of L) g.lineTo(q[0], q[1]); for (const q of Rt.reverse()) g.lineTo(q[0], q[1]); g.closePath(); g.fill(); g.restore();
      return Q[n - 1];
    }
    /** A dot leader between an item and its amount (ink dots, not type), o.frac writes it on. */
    function leader(g, x0, x1, y, o = {}) {
      const n = Math.max(0, Math.floor((x1 - x0) / (o.gap || 22))), k = Math.floor(n * clamp(o.frac ?? 1)), R = RNG('leader', Math.round(x0), Math.round(y));
      g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = o.color || '#8a7458';
      for (let i = 0; i < k; i++) { g.globalAlpha = R.r(0.55, 0.9); g.beginPath(); g.arc(x0 + i * (o.gap || 22), y + R.n(0.8), R.r(2.2, 3.2), 0, TAU); g.fill(); }
      g.restore();
    }
    function tick(g, x, y, o = {}) { const s = o.s || 1; return pen(g, [[x, y], [x + 16 * s, y + 18 * s], [x + 48 * s, y - 22 * s]], { w: 7 * s, color: tk.red, key: 'tick' + (o.key || ''), frac: o.frac }); }
    function rule(g, x0, x1, y, o = {}) {
      const fr = clamp(o.frac ?? 1), dbl = o.double !== false;
      pen(g, [[x0, y], [x1, y - 5]], { w: o.w || 3.4, frac: fr, key: (o.key || 'rule') + 'a', color: o.color });
      if (dbl) pen(g, [[x0, y + 12], [x1, y + 7]], { w: (o.w || 3.4) * 0.66, frac: clamp((fr - 0.12) / 0.88), key: (o.key || 'rule') + 'b', color: o.color });
    }

    // ───────── the fountain pen: lacquer, a gold band, a steel nib; lying down, or held writing ─────────
    function penBody(g, len, lift) {
      g.save(); g.translate(10 + lift * 26, 18 + lift * 40); g.globalCompositeOperation = 'multiply'; g.fillStyle = `rgba(70,40,15,${0.3 - lift * 0.12})`; g.filter = `blur(${8 + lift * 10}px)`;
      g.beginPath(); g.roundRect(len * 0.08, -18, len * 0.92, 36, 18); g.fill(); g.restore();
      const gr = g.createLinearGradient(0, -19, 0, 19); gr.addColorStop(0, '#3d4a3a'); gr.addColorStop(0.3, '#1b261d'); gr.addColorStop(0.5, '#6d8270'); gr.addColorStop(0.62, '#17221a'); gr.addColorStop(1, '#0b120d');
      g.fillStyle = gr; g.beginPath(); g.roundRect(len * 0.18, -19, len * 0.82, 38, 19); g.fill();
      const gold = g.createLinearGradient(0, -19, 0, 19); gold.addColorStop(0, '#8a6a2a'); gold.addColorStop(0.4, '#f0d08a'); gold.addColorStop(0.6, '#a07c34'); gold.addColorStop(1, '#5a4214');
      g.fillStyle = gold; g.fillRect(len * 0.56, -19.5, 16, 39); g.fillRect(len * 0.6, -19.5, 5, 39); g.fillRect(len * 0.6 + 40, -24, len * 0.3, 7);
      const sec = g.createLinearGradient(0, -14, 0, 14); sec.addColorStop(0, '#2a2a2a'); sec.addColorStop(0.5, '#5a5a58'); sec.addColorStop(1, '#151515');
      g.fillStyle = sec; g.beginPath(); g.moveTo(len * 0.18, -15); g.lineTo(len * 0.1, -11); g.lineTo(len * 0.1, 11); g.lineTo(len * 0.18, 15); g.closePath(); g.fill();
      const nb = g.createLinearGradient(0, -10, 0, 10); nb.addColorStop(0, '#9a8f72'); nb.addColorStop(0.5, '#f2e6c0'); nb.addColorStop(1, '#7d7258');
      g.fillStyle = nb; g.beginPath(); g.moveTo(len * 0.1, -10); g.quadraticCurveTo(len * 0.04, -6, 0, 0); g.quadraticCurveTo(len * 0.04, 6, len * 0.1, 10); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(40,30,15,0.7)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(len * 0.075, 0); g.lineTo(4, 0); g.stroke();
    }
    function fountain(g, x, y, rot, len = 620, o = {}) { g.save(); g.translate(x, y); g.rotate(rot); penBody(g, len, o.lift || 0); g.restore(); }
    /** The pen held writing: its point at (x, y), the body up and to the right; o.lift 0..1 raises it off the page. */
    function nib(g, x, y, o = {}) {
      const lift = clamp(o.lift ?? 0), len = o.len || 640;
      g.save(); g.translate(x + lift * 18, y - lift * 46); g.rotate(o.rot ?? -0.62); penBody(g, len, 0.25 + lift); g.restore();
    }

    // ───────── receipts: thermal paper that feeds down a line at a time; torn teeth when done; tape ─────────
    const SHADOW = new Map();
    function shadowFor(w, h) {
      const k = `${Math.round(w)}x${Math.round(h / 8) * 8}`; if (SHADOW.has(k)) return SHADOW.get(k);
      const hh = Math.round(h / 8) * 8 || 8, pad = 44, c = canvas(w + pad * 2, hh + pad * 2), p = c.getContext('2d');
      p.shadowColor = 'rgba(60,35,10,0.6)'; p.shadowBlur = 20; p.fillStyle = '#000'; p.fillRect(pad, pad, w, hh);
      p.globalCompositeOperation = 'destination-out'; p.shadowColor = 'transparent'; p.fillRect(pad, pad, w, hh);
      SHADOW.set(k, c); return c;
    }
    let BANDS = null;
    function bands() {   // the print head's lines, faint, screened over the type
      if (BANDS) return BANDS;
      const c = canvas(8, 6), p = c.getContext('2d'); p.fillStyle = 'rgba(255,255,255,0.0)'; p.fillRect(0, 0, 8, 6); p.fillStyle = 'rgba(255,255,255,0.22)'; p.fillRect(0, 0, 8, 1.4);
      return (BANDS = c);
    }
    function receipt(g, o) {
      const w = o.w, len = o.len, feed = clamp(o.feed ?? 1), vis = Math.max(0, len * feed), R = RNG('rcpt', o.key);
      if (vis < 2) return;
      g.save(); g.translate(o.x, o.y); g.rotate(o.rot || 0); if (o.scale) g.scale(o.scale, o.scale);
      const lift = o.lift ?? 0, sh = shadowFor(w, vis);
      g.globalCompositeOperation = 'multiply'; g.globalAlpha = 0.82; g.drawImage(sh, -44 + 6 + lift * 12, -44 + 10 + lift * 18, sh.width, Math.max(vis + 88, 8)); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      const torn = feed >= 1, teeth = 14, tw = w / teeth;
      const path = () => { g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w, vis); if (torn) for (let i = teeth; i >= 0; i--) g.lineTo(i * tw, vis + (i % 2 ? 7 + R.n(2) : -3 + R.n(1.5))); else g.lineTo(0, vis); g.closePath(); };
      path(); const pg = g.createLinearGradient(0, 0, w, 0); pg.addColorStop(0, '#e9e3d6'); pg.addColorStop(0.1, tk.receipt); pg.addColorStop(0.55, '#fbf8f1'); pg.addColorStop(0.9, tk.receipt); pg.addColorStop(1, '#e2dccd');
      g.fillStyle = pg; g.fill();
      g.save(); path(); g.clip();
      if (o.draw) o.draw(g, w, vis);
      g.globalCompositeOperation = 'screen'; g.fillStyle = g.createPattern(bands(), 'repeat'); g.fillRect(0, 0, w, vis);
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(w * R.r(0.2, 0.4), 0, R.r(6, 16), vis); g.fillRect(w * R.r(0.6, 0.8), 0, R.r(4, 10), vis);
      for (let i = 0; i < 4; i++) { g.fillStyle = `rgba(255,255,255,${R.r(0.08, 0.2)})`; g.fillRect(0, R.r(40, Math.max(41, vis - 20)), w, R.r(2, 7)); }   // the head's faint misses
      g.globalCompositeOperation = 'multiply';
      const curl = g.createLinearGradient(0, 0, 0, vis); curl.addColorStop(0, 'rgba(150,140,120,0.14)'); curl.addColorStop(0.12, 'rgba(255,255,255,0)'); curl.addColorStop(0.86, 'rgba(255,255,255,0)'); curl.addColorStop(1, 'rgba(140,128,104,0.2)');
      g.fillStyle = curl; g.fillRect(0, 0, w, vis);
      g.restore();
      if (!torn) { const cg = g.createLinearGradient(0, vis - 30, 0, vis); cg.addColorStop(0, 'rgba(90,70,40,0)'); cg.addColorStop(1, 'rgba(90,70,40,0.34)'); g.fillStyle = cg; g.fillRect(0, vis - 30, w, 30); }
      g.restore();
    }
    /** The standard slip inside a receipt (call from its draw): o { label, value (rolled so far), key, ticked 0..1, bars }. */
    function slip(q, w, o = {}) {
      const c = tk.rink;
      ink(q, '* * * * * * * * * * *', w / 2, 48, { font: FONT.mono, size: 20, color: '#8a867e', align: 'center', id: false, bleed: 0.8 });
      ink(q, o.label, w / 2, 112, { font: FONT.mono, size: 44, tracking: 6, color: c, align: 'center', id: 'label-' + o.key });
      q.save(); q.strokeStyle = '#8f8a80'; q.setLineDash([7, 6]); q.lineWidth = 2; q.beginPath(); q.moveTo(26, 150); q.lineTo(w - 26, 150); q.moveTo(26, 314); q.lineTo(w - 26, 314); q.stroke(); q.restore();
      ink(q, 'AMOUNT', 30, 204, { font: FONT.mono, size: 26, tracking: 3, color: '#77736b', id: false, bleed: 0.8 });
      if (o.value != null) odometer(q, o.value, w - 30, 288, { font: FONT.mono, weight: 600, size: 80, align: 'right', color: c, id: 'amt-' + o.key });
      else ink(q, '—', w - 30, 278, { font: FONT.mono, size: 48, color: '#8f8a80', align: 'right', id: false });
      let bx = 44; q.fillStyle = c;
      const B = o.bars || RNG('bars', o.key);
      for (let i = 0; i < 40; i++) { const bw = B.r ? B.r(1.5, 6) : 3, gap = B.r ? (B.r(0, 1) < 0.2 ? 6 : 2.6) : 3; if (bx + bw > w - 44) break; q.fillRect(bx, 334, bw, 54); bx += bw + gap; }
      if ((o.ticked ?? 0) > 0) tick(q, 150, 186, { frac: o.ticked, key: o.key });
    }
    function tape(g, x, y, w, h, rot, key) {
      const R = RNG('tape', key);
      g.save(); g.translate(x, y); g.rotate(rot);
      g.beginPath(); g.moveTo(-w / 2, -h / 2);
      for (let i = 0; i <= 6; i++) g.lineTo(-w / 2 + (w * i) / 6, -h / 2 + R.n(1.5));
      for (let i = 0; i <= 5; i++) g.lineTo(w / 2 + R.n(4), -h / 2 + (h * i) / 5);
      for (let i = 6; i >= 0; i--) g.lineTo(-w / 2 + (w * i) / 6, h / 2 + R.n(1.5));
      for (let i = 5; i >= 0; i--) g.lineTo(-w / 2 + R.n(4), -h / 2 + (h * i) / 5);
      g.closePath(); g.fillStyle = 'rgba(226,206,160,0.72)'; g.fill();
      g.globalCompositeOperation = 'multiply'; g.strokeStyle = 'rgba(150,120,70,0.25)'; g.lineWidth = 1; g.stroke();
      g.globalCompositeOperation = 'screen'; g.fillStyle = 'rgba(255,250,235,0.18)'; g.fillRect(-w / 2 + 6, -h / 2 + 4, w - 12, h * 0.3);
      g.restore();
    }

    // ───────── stamps: an inked face made once (border, letters, uneven ink), pressed with multiply ─────────
    const STAMPS = new Map();
    function stampFace(str, o = {}) {
      const size = o.size || 150, border = o.border !== false, k = `${str}|${size}|${border}|${o.font || FONT.display}`; if (STAMPS.has(k)) return STAMPS.get(k);
      const ff = { family: o.font || FONT.display, weight: 620, size, tracking: border ? size * 0.12 : 0, style: o.font === FONT.italic ? 'italic' : 'normal' }, mm = env.measure(str, ff);
      const w = Math.ceil(mm.w + (border ? size * 1.02 : size * 0.4)), h = Math.ceil(border ? size * 1.45 : size * 1.25), c = canvas(w, h), p = c.getContext('2d'), R = RNG('stamp', str, size);
      p.fillStyle = tk.red; p.strokeStyle = tk.red;
      const rr = (x, y, ww, hh, r) => { p.beginPath(); p.moveTo(x + r, y); p.arcTo(x + ww, y, x + ww, y + hh, r); p.arcTo(x + ww, y + hh, x, y + hh, r); p.arcTo(x, y + hh, x, y, r); p.arcTo(x, y, x + ww, y, r); p.closePath(); };
      if (border) {
        p.lineWidth = size * 0.075; rr(size * 0.08, size * 0.08, w - size * 0.16, h - size * 0.16, size * 0.16); p.stroke();
        p.lineWidth = size * 0.028; rr(size * 0.2, size * 0.2, w - size * 0.4, h - size * 0.4, size * 0.08); p.stroke();
      }
      env.fillText(p, str, w / 2 + (border ? size * 0.06 : 0) - mm.w / 2, h / 2 + (mm.asc - mm.desc) / 2, ff);
      p.globalCompositeOperation = 'destination-out';   // uneven ink: speckled gaps, dry streaks, lighter to one corner
      for (let i = 0; i < w * h * 0.0045; i++) { p.fillStyle = `rgba(0,0,0,${R.r(0.3, 1)})`; p.beginPath(); p.arc(R.r(0, w), R.r(0, h), R.r(0.6, 3.2), 0, TAU); p.fill(); }
      for (let i = 0; i < 7; i++) { p.fillStyle = `rgba(0,0,0,${R.r(0.15, 0.4)})`; const y = R.r(0, h); p.fillRect(R.r(-20, w * 0.3), y, R.r(w * 0.3, w), R.r(1.5, 5)); }
      const fade = p.createLinearGradient(0, 0, w, h); fade.addColorStop(0, 'rgba(0,0,0,0.0)'); fade.addColorStop(1, 'rgba(0,0,0,0.3)'); p.fillStyle = fade; p.fillRect(0, 0, w, h);
      STAMPS.set(k, c); return c;
    }
    function stamp(g, str, x, y, o = {}) {
      const face = stampFace(str, o), s = o.s ?? 1, a = clamp(o.a ?? 1);
      if (a <= 0 || s <= 0) return;
      g.save(); g.translate(x, y); g.rotate(o.rot || 0); g.scale(s, s);
      g.globalCompositeOperation = 'multiply'; g.globalAlpha = a; g.drawImage(face, -face.width / 2, -face.height / 2);
      g.restore();
      if (o.id !== false) {
        const hw = (face.width / 2) * s, hh = (face.height / 2) * s, cr = Math.cos(o.rot || 0), sr = Math.sin(o.rot || 0);
        const C = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([u, v]) => toScreen(g, x + u * cr - v * sr, y + u * sr + v * cr));
        const xs = C.map((c) => c[0]), ys = C.map((c) => c[1]);
        env.registerBox(o.id || 'stamp:' + str, str, { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }, { overprint: true });
      }
    }
    /** The face's own silhouette on the paper, blurred by its height (s > 1: in the air), sliding in under the lamp. */
    function stampShadow(g, str, x, y, o = {}) {
      const face = stampFace(str, o), s = o.s ?? 1.3, k = clamp((s - 1) / 0.6);
      g.save(); g.translate(x + 40 * k, y + 60 * k); g.rotate(o.rot || 0); g.scale(1 + k * 0.18, 1 + k * 0.18);
      g.globalCompositeOperation = 'multiply'; g.globalAlpha *= 0.5 * (1 - k * 0.55); g.filter = `brightness(0.25) blur(${2 + k * 14}px)`;
      g.drawImage(face, -face.width / 2, -face.height / 2); g.restore();
    }
    /** A whole stamp: it falls (o.fall s before t0), lands on t0, throws a little ink, and stays. Returns the jolt 0..1. */
    function press(g, str, x, y, t0, o = {}) {
      const fall = o.fall ?? 0.18, T = TT;
      if (T < t0 - fall - 0.32) return 0;
      if (T < t0) {
        const s = 1 + (o.height ?? 0.55) * (1 - EZi2(clamp((T - (t0 - fall)) / fall)));
        g.save(); g.globalAlpha = o.shadow ?? 1; stampShadow(g, str, x, y, { ...o, s }); g.restore();
        return 0;
      }
      const hit = T - t0, R = RNG('splat', str, o.key || '');
      if (o.splat !== false) {
        g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = tk.red;
        const reach = 0.85 + 0.15 * clamp(hit / 0.08), face = stampFace(str, o), rx = face.width * 0.62 * (o.s ?? 1), ry = face.height * 0.62 * (o.s ?? 1);
        for (let i = 0; i < (o.drops ?? 22); i++) { const a = R.r(0, TAU), d = R.r(1.02, 1.3) * reach, r = R.r(1.2, 4.2); g.globalAlpha = R.r(0.3, 0.75); g.beginPath(); g.arc(x + Math.cos(a) * rx * d, y + Math.sin(a) * ry * d, r, 0, TAU); g.fill(); }
        g.restore();
      }
      const squash = 1 + 0.025 * Math.exp(-hit * 30);
      stamp(g, str, x, y, { ...o, s: (o.s ?? 1) * squash, a: (o.a ?? 0.92) });
      return Math.exp(-hit * 9);
    }
    const EZi2 = (u) => clamp(u) ** 2;
    /** Letter stamps, one per letter, thumped in turn: o.at is the FIRST landing, o.step (s between), so the word should
     *  cover at + step × (n − 1); o.size, o.font, o.fall (s in the air, 0.1). */
    function letters(g, str, x, y, o = {}) {
      const size = o.size || 150, font = o.font || FONT.display, step = o.step ?? 0.11, fall = o.fall ?? 0.1, f = { family: font, weight: 620, size, style: font === FONT.italic ? 'italic' : 'normal' };
      const chars = [...str], ws = chars.map((ch) => env.measure(ch, f).w), gap = o.gap ?? size * 0.06, total = ws.reduce((a, b) => a + b, 0) + gap * (chars.length - 1);
      let cx = o.align === 'center' ? x - total / 2 : o.align === 'right' ? x - total : x, landed = 0;
      const R = RNG('letters', str, o.key || '');
      chars.forEach((ch, i) => {
        const t0 = (o.at ?? 0) + i * step, rot = R.n(0.06), dy = R.n(size * 0.04);
        if (ch.trim()) {
          const cxx = cx + ws[i] / 2, j = press(g, ch, cxx, y - size * 0.34 + dy, t0, { size, border: false, font, rot, fall, height: o.height ?? 0.22, drops: 6, id: false, key: (o.key || '') + i, a: o.a ?? 0.9, shadow: 0.55 });
          if (TT >= t0) landed = Math.max(landed, j);
        }
        cx += ws[i] + gap;
      });
      const firstOn = (o.at ?? 0) - fall;
      if (o.id !== false && TT >= firstOn) {
        const x0 = o.align === 'center' ? x - total / 2 : o.align === 'right' ? x - total : x;
        register(g, o.id || 'letters:' + str, str, x0, y, { w: total, asc: size * 0.95, desc: size * 0.1 });
      }
      return landed;
    }

    // ───────── an odometer: digits in fixed cells; the units roll with the fraction, a column turns as the one below passes 9 ─────────
    function odometer(g, v, x, y, o = {}) {
      const size = o.size || 80, ff = { family: o.font || FONT.display, weight: o.weight || 620, size }, str = fmt(v);
      const cell = env.measure('0', ff).w * 1.02, comma = env.measure(',', ff).w, lh = size * 0.9;
      let total = 0; for (const ch of str) total += ch === ',' ? comma : cell;
      let cx = o.align === 'right' ? x - total : o.align === 'center' ? x - total / 2 : x;
      const digits = str.replace(/,/g, '').length, col = o.color || inkColor(o);
      g.save(); g.globalCompositeOperation = 'multiply'; g.fillStyle = !o.color && size >= 44 ? g.createPattern(inkTex(), 'repeat') : col; g.shadowColor = col; g.shadowBlur = o.bleed ?? 1.4;
      let k = digits - 1;
      for (const ch of str) {
        if (ch === ',') { env.fillText(g, ',', cx, y, ff); cx += comma; continue; }
        const p = 10 ** k, lower = v - Math.floor(v / p) * p, f = k === 0 ? v - Math.floor(v) : clamp(lower - (p - 1)), d = Math.floor(v / p) % 10;
        g.save(); g.beginPath(); g.rect(cx - 2, y - size * 0.8, cell + 4, size * 0.9); g.clip();
        const dx = (dd) => cx + (cell - env.measure(String(dd), ff).w) / 2;
        env.fillText(g, String(d), dx(d), y - f * lh, ff); if (f > 0.001) env.fillText(g, String((d + 1) % 10), dx((d + 1) % 10), y - f * lh + lh, ff);
        g.restore(); cx += cell; k--;
      }
      g.restore();
      if (o.id !== false) { const x0 = o.align === 'right' ? x - total : o.align === 'center' ? x - total / 2 : x; register(g, o.id || 'num', str, x0, y, { w: total, asc: size * 0.72, desc: size * 0.03 }); }
      return total;
    }

    return {
      FONT, PAGE: PG, RULE0, RULE, MARGIN, COLS,
      bind(c) { F = c.F; TT = c.TT; S = c.scale || 1; },
      view, depth, desk, book, inkwell, light, grain, motes, tooth,
      ink, write, measure, pen, leader, tick, rule, fountain, nib,
      receipt, slip, tape, stampFace, stamp, stampShadow, press, letters, odometer, fmt,
    };
  },
});
