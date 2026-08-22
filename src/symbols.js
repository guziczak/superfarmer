/* ============================================================
   SUPERFARMER — grafika zwierząt (atlas na kostki + sprite'y HUD)
   Sylwetki komponowane z prymitywów (elipsy + gładkie ścieżki).
   Obrys unii kształtów: najpierw wszystkie prymitywy grubym konturem,
   potem te same wypełnione kolorem — kontur zostaje tylko na krawędzi.
   Global: SYMBOLS
   ============================================================ */
var SYMBOLS = (function () {
  'use strict';

  var ORDER = ['rabbit', 'sheep', 'pig', 'cow', 'horse', 'wolf', 'fox'];

  var NAMES_PL = {
    rabbit: ['królik', 'króliki', 'królików'],
    sheep: ['owca', 'owce', 'owiec'],
    pig: ['świnia', 'świnie', 'świń'],
    cow: ['krowa', 'krowy', 'krów'],
    horse: ['koń', 'konie', 'koni'],
    smallDog: ['mały pies', 'małe psy', 'małych psów'],
    bigDog: ['duży pies', 'duże psy', 'dużych psów'],
    wolf: ['wilk', 'wilki', 'wilków'],
    fox: ['lis', 'lisy', 'lisów']
  };

  function plural(sym, n) {
    var f = NAMES_PL[sym];
    if (n === 1) return f[0];
    var d = n % 10, h = n % 100;
    if (d >= 2 && d <= 4 && !(h >= 12 && h <= 14)) return f[1];
    return f[2];
  }

  // Akcenty UI per zwierzę (chipy w HUD)
  var COLORS = {
    rabbit: '#b08d63', sheep: '#d9cdb4', pig: '#dfa0ab', cow: '#cfc9bd',
    horse: '#9c6b44', smallDog: '#c89a5b', bigDog: '#8a6a4f',
    wolf: '#7d7b85', fox: '#e0782f'
  };

  /* ---------- prymitywy ---------- */
  function E(cx, cy, rx, ry, rot) { return { k: 'e', cx: cx, cy: cy, rx: rx, ry: ry, rot: (rot || 0) * Math.PI / 180 }; }
  function P(pts) { return { k: 'p', pts: pts }; } // [x,y,sharp?]
  function S(pts, w) { return { k: 's', pts: pts, w: w }; } // otwarta linia (ogon świni)

  function tracePoly(ctx, pts) {
    var n = pts.length;
    var mx = (pts[0][0] + pts[1][0]) / 2, my = (pts[0][1] + pts[1][1]) / 2;
    ctx.moveTo(mx, my);
    for (var i = 1; i <= n; i++) {
      var c = pts[i % n], nx = pts[(i + 1) % n];
      var mx2 = (c[0] + nx[0]) / 2, my2 = (c[1] + nx[1]) / 2;
      if (c[2]) { ctx.lineTo(c[0], c[1]); ctx.lineTo(mx2, my2); }
      else ctx.quadraticCurveTo(c[0], c[1], mx2, my2);
    }
    ctx.closePath();
  }

  function traceOpen(ctx, pts) {
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length - 1; i++) {
      var mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    var l = pts[pts.length - 1];
    ctx.lineTo(l[0], l[1]);
  }

  function drawPrim(ctx, p, mode, fill, outline, ow) {
    ctx.beginPath();
    if (p.k === 'e') {
      ctx.ellipse(p.cx, p.cy, p.rx, p.ry, p.rot, 0, Math.PI * 2);
    } else if (p.k === 'p') {
      tracePoly(ctx, p.pts);
    } else if (p.k === 's') {
      traceOpen(ctx, p.pts);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (mode === 'outline') { ctx.strokeStyle = outline; ctx.lineWidth = p.w + ow * 2; ctx.stroke(); }
      else { ctx.strokeStyle = fill; ctx.lineWidth = p.w; ctx.stroke(); }
      return;
    }
    if (mode === 'outline') {
      ctx.fillStyle = outline; ctx.fill();
      ctx.strokeStyle = outline; ctx.lineWidth = ow * 2; ctx.lineJoin = 'round'; ctx.stroke();
    } else { ctx.fillStyle = fill; ctx.fill(); }
  }

  /* ---------- definicje zwierząt (siatka 100×100, profil w lewo) ----------
     body: prymitywy w kolorze głównym (z obrysem unii)
     details: [prim, kolor] rysowane na wierzchu bez obrysu               */
  var INK = '#33261b'; // kolor obrysu — ciepła sepia

  var DEFS = {
    rabbit: {
      fill: '#a17a4e',
      body: [
        E(64, 66, 21, 20),            // zad
        E(44, 64, 19, 16),            // korpus
        E(32, 68, 13, 14),            // pierś
        E(27, 50, 13, 12),            // głowa
        E(30, 28, 6, 19, -14),        // ucho przednie
        E(41, 27, 6, 19, 10),         // ucho tylne
        E(30, 85, 9, 5),              // łapka przednia
        E(66, 86, 13, 5.5),           // stopa tylna
        E(85, 66, 6.5, 6.5)           // ogonek
      ],
      details: [
        [E(30, 29, 3, 13, -14), '#c9a276'],  // wnętrze ucha
        [E(41, 28, 3, 13, 10), '#c9a276'],
        [E(85, 65, 4.5, 4.5), '#e8d9bd'],    // puch ogonka
        [E(22, 48, 2.2, 2.2), INK],          // oko
        [E(21.4, 47.4, 0.8, 0.8), '#f3ecd9'],
        [E(16.5, 53, 1.8, 1.4), INK]         // nosek
      ]
    },

    sheep: {
      fill: '#ece3cb',
      body: [
        E(50, 52, 17, 14), E(38, 56, 14, 12), E(63, 56, 14, 12),
        E(44, 46, 12, 10), E(58, 46, 12, 10), E(51, 62, 16, 12),
        E(29, 42, 8, 7)               // czupryna nad głową
      ],
      details: [
        [E(25, 51, 9.5, 11.5, 12), '#3a3231'],   // ciemna głowa (suffolk)
        [P([[19, 42, 1], [12, 46], [18, 50, 1]]), '#3a3231'], // ucho
        [E(24, 68, 3, 10), '#3a3231'],           // nogi
        [E(38, 74, 3, 12), '#3a3231'],
        [E(52, 75, 3, 12), '#3a3231'],
        [E(66, 73, 3, 12), '#3a3231'],
        [E(22, 49, 1.9, 1.9), '#e8dfc8'],        // oko
        [E(21.5, 48.5, 0.7, 0.7), '#2a2423']
      ]
    },

    pig: {
      fill: '#e39aa4',
      body: [
        E(54, 60, 27, 19),            // korpus
        E(29, 56, 14, 12),            // głowa
        E(16.5, 59, 5.5, 6.5),        // ryjek
        P([[24, 47, 1], [33, 38, 1], [36, 52, 1]]), // ucho
        E(36, 82, 5, 8), E(48, 84, 5, 8), E(62, 84, 5, 8), E(73, 81, 5, 8),
        S([[80, 54], [87, 50], [90, 55], [85, 59], [82, 55]], 3.4) // kręcony ogon
      ],
      details: [
        [E(15.8, 57.2, 1.2, 1.7), '#8f5560'],    // nozdrza
        [E(15.8, 61.4, 1.2, 1.7), '#8f5560'],
        [P([[26, 48, 1], [32, 42, 1], [34, 51, 1]]), '#c77e8b'], // wnętrze ucha
        [E(24, 52, 2, 2), INK],                  // oko
        [E(23.4, 51.4, 0.7, 0.7), '#f6e9ea']
      ]
    },

    cow: {
      fill: '#efe9da',
      body: [
        E(55, 57, 28, 18),            // korpus
        E(26, 49, 12, 11),            // głowa
        E(20, 57, 8.5, 6.5),          // pysk
        P([[20, 40, 1], [13, 33, 1], [22, 36, 1]]),  // róg
        P([[30, 38, 1], [27, 29, 1], [35, 35, 1]]),  // róg 2
        P([[34, 46, 1], [42, 40], [40, 50, 1]]),     // ucho
        E(36, 80, 4.5, 10), E(47, 83, 4.5, 10), E(63, 83, 4.5, 10), E(74, 80, 4.5, 10),
        S([[82, 48], [89, 60], [88, 74]], 3.2)       // ogon
      ],
      details: [
        [E(46, 50, 11, 9, 15), '#3b3532'],           // łaty
        [E(67, 61, 10, 8, -12), '#3b3532'],
        [E(56, 68, 6.5, 5, 5), '#3b3532'],
        [E(28, 42, 5, 4, 20), '#3b3532'],            // łata na głowie
        [E(66, 74, 7.5, 5.5), '#e2b6bd'],            // wymię
        [E(88, 77, 3.5, 5), '#3b3532'],              // kitka ogona
        [E(17.5, 55.5, 1.3, 1.8), '#8d7f70'],        // nozdrze
        [E(22.5, 47, 2, 2), INK],                    // oko
        [E(21.9, 46.4, 0.7, 0.7), '#f6f0e2']
      ]
    },

    horse: {
      fill: '#7c5233',
      body: [
        E(58, 58, 24, 14),            // korpus
        E(72, 56, 12, 13),            // zad
        E(43, 59, 12, 12),            // kłąb/pierś
        P([[35, 66, 1], [24, 38], [37, 29], [52, 54, 1]]),  // szyja skośna
        E(23, 33, 12, 6.8, -20),      // głowa pozioma
        E(13.5, 36, 4.6, 4, -20),     // pysk
        P([[30, 28, 1], [34, 18, 1], [37, 29, 1]]),         // ucho
        E(40, 78, 4, 12), E(50, 81, 4, 12), E(65, 81, 4, 12), E(75, 78, 4, 12)
      ],
      details: [
        [P([[33, 22, 1], [43, 27], [51, 45], [50, 58, 1], [44, 40]]), '#43301f'],  // grzywa
        [P([[28, 26, 1], [22, 23], [26, 31, 1]]), '#43301f'],                       // grzywka
        [P([[81, 48, 1], [94, 54], [97, 74], [90, 87, 1], [87, 64]]), '#43301f'],  // ogon
        [E(40, 88, 4, 2.8), '#3a2b1d'], [E(50, 91, 4, 2.8), '#3a2b1d'],            // kopyta
        [E(65, 91, 4, 2.8), '#3a2b1d'], [E(75, 88, 4, 2.8), '#3a2b1d'],
        [E(22, 30, 1.9, 1.9), INK],                  // oko
        [E(21.4, 29.4, 0.7, 0.7), '#f0e6d2'],
        [E(11.5, 34.5, 1.1, 1.4, -20), '#43301f']    // nozdrze
      ]
    },

    wolf: {
      fill: '#5c5a63',
      body: [
        E(54, 58, 24, 14),            // korpus
        E(37, 56, 13, 13),            // pierś
        E(28, 45, 12, 10),            // głowa
        P([[10, 48, 1], [29, 39], [29, 54, 1]]),     // pysk
        P([[24, 37, 1], [28, 25, 1], [33, 37, 1]]),  // ucho
        P([[33, 37, 1], [38, 27, 1], [42, 39, 1]]),  // ucho 2
        E(37, 78, 4.5, 11), E(47, 81, 4.5, 11), E(62, 81, 4.5, 11), E(72, 78, 4.5, 11),
        E(83, 55, 14, 6.5, 32)        // ogon
      ],
      details: [
        [E(36, 62, 9, 8), '#8b8892'],                // jaśniejsza pierś
        [P([[13, 48.5, 1], [24, 45.5], [24, 51, 1]]), '#8b8892'], // jasny dół pyska
        [E(11.5, 46.8, 1.5, 1.3), INK],              // nos
        [E(26, 43, 1.9, 1.7), '#e9b44c'],            // bursztynowe oko
        [E(25.6, 42.7, 0.7, 0.7), INK]
      ]
    },

    fox: {
      fill: '#e0762f',
      body: [
        E(52, 62, 21, 12),            // korpus
        E(37, 60, 12, 11),            // pierś
        E(30, 50, 11, 9),             // głowa
        P([[15, 54, 1], [30, 45], [31, 57, 1]]),     // pyszczek
        P([[24, 43, 1], [27, 30, 1], [34, 42, 1]]),  // ucho
        P([[34, 42, 1], [40, 31, 1], [44, 44, 1]]),  // ucho 2
        E(38, 79, 4, 9.5), E(47, 81, 4, 9.5), E(59, 81, 4, 9.5), E(67, 79, 4, 9.5),
        E(79, 64, 17, 8.5, -22)       // kita
      ],
      details: [
        [E(90, 58.5, 6.5, 5.5, -22), '#f2e7d4'],     // biały koniec kity
        [E(37, 67, 8, 6.5), '#f2e7d4'],              // biała pierś
        [P([[17, 54.5, 1], [27, 50.5], [28, 57, 1]]), '#f2e7d4'], // biały pyszczek
        [P([[26, 42, 1], [28, 33.5, 1], [32, 41.5, 1]]), '#42302a'], // ciemne wnętrze ucha
        [E(38, 86, 3.6, 3), '#42302a'], [E(47, 88, 3.6, 3), '#42302a'], // ciemne łapki
        [E(59, 88, 3.6, 3), '#42302a'], [E(67, 86, 3.6, 3), '#42302a'],
        [E(15.8, 53, 1.5, 1.3), INK],                // nos
        [E(27, 48, 1.8, 1.6), '#4c3018'],            // oko
        [E(26.6, 47.6, 0.6, 0.6), '#f6ecd8']
      ]
    }
  };

  // Psy do HUD — rysowane jak lis/wilk, w cieplejszych kolorach pasterskich
  DEFS.smallDog = {
    fill: '#c9913f',
    body: [
      E(52, 63, 20, 12), E(37, 60, 12, 11), E(30, 50, 11, 9.5),
      P([[16, 55, 1], [30, 46], [31, 58, 1]]),
      P([[23, 44, 1], [21, 31, 1], [32, 41, 1]]),   // oklapnięte ucho
      E(38, 79, 4, 9.5), E(47, 81, 4, 9.5), E(59, 81, 4, 9.5), E(67, 79, 4, 9.5),
      E(76, 53, 5, 11, 38)                          // ogon w górę
    ],
    details: [
      [E(37, 67, 8, 6.5), '#ecd9b4'],
      [E(16.8, 54, 1.5, 1.3), INK],
      [E(27, 48, 1.8, 1.7), '#4c3018'],
      [E(26.6, 47.6, 0.6, 0.6), '#f6ecd8'],
      [E(76.5, 46, 2.6, 4, 38), '#ecd9b4']          // jasny czub ogona
    ]
  };
  DEFS.bigDog = {
    fill: '#7a5a3c',
    body: [
      E(53, 58, 25, 15), E(36, 56, 13, 13), E(28, 45, 12, 10.5),
      P([[13, 50, 1], [28, 41], [29, 54, 1]]),
      P([[22, 39, 1], [19, 25, 1], [31, 36, 1]]),
      P([[33, 37, 1], [37, 26, 1], [42, 39, 1]]),
      E(37, 78, 4.5, 11), E(47, 81, 4.5, 11), E(62, 81, 4.5, 11), E(72, 78, 4.5, 11),
      E(82, 50, 6, 13, 30)
    ],
    details: [
      [E(36, 63, 9, 8), '#b39067'],
      [E(14.5, 48.5, 1.6, 1.4), INK],
      [E(26, 43, 1.9, 1.8), '#3d2a16'],
      [E(25.6, 42.6, 0.7, 0.7), '#f0e6d2']
    ]
  };

  /** Rysuje zwierzę w kwadracie size×size zaczepionym w (x, y). */
  function drawAnimal(ctx, sym, x, y, size, outlineScale) {
    var d = DEFS[sym];
    if (!d) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 100, size / 100);
    var ow = 2.6 * (outlineScale || 1);
    var i;
    for (i = 0; i < d.body.length; i++) drawPrim(ctx, d.body[i], 'outline', null, INK, ow);
    for (i = 0; i < d.body.length; i++) drawPrim(ctx, d.body[i], 'fill', d.fill, null, 0);
    for (i = 0; i < d.details.length; i++) drawPrim(ctx, d.details[i][0], 'fill', d.details[i][1], null, 0);
    ctx.restore();
  }

  /* ---------- atlas 4×2 dla shadera kostek ---------- */
  var GRID_X = 4, GRID_Y = 2;

  function cellOf(sym) {
    var i = ORDER.indexOf(sym);
    return { col: i % GRID_X, row: Math.floor(i / GRID_X), index: i };
  }

  function buildAtlas(size) {
    size = size || 2048;
    var cw = size / GRID_X, ch = (size / 2) / GRID_Y;
    var cv = document.createElement('canvas');
    cv.width = size; cv.height = size / 2;
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (var i = 0; i < ORDER.length; i++) {
      var sym = ORDER[i];
      var c = cellOf(sym);
      var pad = cw * 0.14;
      drawAnimal(ctx, sym, c.col * cw + pad, c.row * ch + pad, cw - pad * 2, 1);
    }
    return cv;
  }

  var spriteCache = {};
  /** Sprite HUD (przezroczyste tło), zwraca dataURL; renderowane 2× dla retiny. */
  function sprite(sym, px) {
    var key = sym + '@' + px;
    if (spriteCache[key]) return spriteCache[key];
    var cv = document.createElement('canvas');
    cv.width = px * 2; cv.height = px * 2;
    var ctx = cv.getContext('2d');
    drawAnimal(ctx, sym, px * 0.04, px * 0.04, px * 1.92, 1.35);
    var url = cv.toDataURL('image/png');
    spriteCache[key] = url;
    return url;
  }

  return {
    ORDER: ORDER,
    GRID_X: GRID_X,
    GRID_Y: GRID_Y,
    NAMES_PL: NAMES_PL,
    COLORS: COLORS,
    plural: plural,
    cellOf: cellOf,
    buildAtlas: buildAtlas,
    drawAnimal: drawAnimal,
    sprite: sprite
  };
})();
