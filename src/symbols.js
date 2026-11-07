/* ============================================================
   SUPERFARMER — autorskie portrety zwierząt
   Wspólne ilustracje wektorowe dla HUD-u i atlasu kostek.
   Siatka 100×100, równy zielony kontur, czyste kolory i lekki cień.
   Tło pozostaje przezroczyste; medaliony rysuje renderer kostek.
   Global: SYMBOLS
   ============================================================ */
var SYMBOLS = (function () {
  'use strict';

  // Kolejność jest częścią kontraktu atlasu i mapowania ścian kostek.
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

  var INK = '#214b3f';
  var CREAM = '#fff7df';
  var COLORS = {
    rabbit: '#e9c99a', sheep: '#d9e1cb', pig: '#ef9a9f', cow: '#b8d1bb',
    horse: '#dca058', smallDog: '#e7b96f', bigDog: '#71937b',
    wolf: '#88aeb1', fox: '#ef9a43'
  };

  /* ---------- elementy ilustracji ---------- */
  // P: ścieżka (M/L/Q/C/Z), E: elipsa, L: otwarta linia.
  // outline=false stosujemy do dużych plam barwnych i drobnych rysów.
  function P(fill, commands, outline) {
    return { fill: fill, commands: commands, outline: outline !== false };
  }
  function E(fill, x, y, rx, ry, outline, angle) {
    return { fill: fill, ellipse: [x, y, rx, ry, (angle || 0) * Math.PI / 180], outline: outline !== false };
  }
  function L(commands, width) {
    return { fill: null, commands: commands, outline: true, width: width || 0.72 };
  }
  function G(top, bottom) { return { top: top, bottom: bottom }; }

  var DEFS = {
    rabbit: [
      // Głowa i uszy mają jeden obrys: wyraźna sylwetka nawet przy 18 px.
      P(G('#fffaf0', '#efdfc0'), [
        ['M', 29, 45], ['C', 25, 32, 23, 11, 32, 8],
        ['C', 42, 5, 46, 26, 46, 41], ['L', 54, 41],
        ['C', 55, 26, 60, 7, 69, 10], ['C', 78, 13, 74, 33, 70, 45],
        ['C', 78, 51, 82, 58, 81, 68], ['C', 80, 82, 65, 90, 50, 90],
        ['C', 35, 90, 21, 82, 19, 69], ['C', 17, 58, 22, 50, 29, 45], ['Z']
      ]),
      E('#efb0a6', 35, 27, 4.5, 14, false, -10),
      E('#efb0a6', 64, 29, 4.5, 13, false, 12),
      E(CREAM, 50, 74, 18, 11, false),
      E(INK, 38, 62, 2.7, 3, false), E(INK, 62, 62, 2.7, 3, false),
      P('#d57e7d', [['M', 45, 71], ['Q', 50, 68, 55, 71], ['Q', 55, 74, 50, 77], ['Q', 45, 74, 45, 71], ['Z']], false),
      L([['M', 50, 77], ['L', 50, 80], ['M', 43, 80], ['Q', 47, 84, 50, 80], ['Q', 53, 84, 57, 80]])
    ],

    sheep: [
      E('#78917a', 19, 50, 11, 7, true, -15),
      E('#78917a', 81, 50, 11, 7, true, 15),
      P(G('#fffdf0', '#e6e7cc'), [
        ['M', 24, 32], ['C', 16, 23, 24, 12, 35, 16],
        ['C', 40, 6, 54, 6, 60, 15], ['C', 73, 8, 84, 19, 79, 30],
        ['C', 91, 34, 93, 48, 83, 55], ['C', 91, 66, 85, 78, 73, 79],
        ['C', 71, 91, 58, 97, 49, 88], ['C', 38, 96, 25, 88, 26, 78],
        ['C', 13, 76, 8, 63, 17, 54], ['C', 7, 45, 13, 33, 24, 32], ['Z']
      ]),
      P(G('#829a80', '#5b7b67'), [
        ['M', 34, 38], ['Q', 50, 31, 66, 38], ['C', 74, 46, 71, 67, 64, 77],
        ['Q', 50, 87, 36, 77], ['C', 29, 67, 26, 46, 34, 38], ['Z']
      ]),
      P(CREAM, [
        ['M', 28, 35], ['C', 25, 28, 31, 22, 38, 25],
        ['C', 42, 18, 52, 18, 56, 25], ['C', 66, 20, 75, 27, 71, 35],
        ['Q', 66, 41, 59, 36], ['Q', 50, 44, 42, 36], ['Q', 33, 42, 28, 35], ['Z']
      ]),
      E(CREAM, 39, 54, 2.7, 3, false), E(CREAM, 61, 54, 2.7, 3, false),
      P(INK, [['M', 45, 66], ['Q', 50, 64, 55, 66], ['L', 50, 71], ['Z']], false),
      L([['M', 50, 71], ['L', 50, 75], ['M', 44, 75], ['Q', 50, 79, 56, 75]])
    ],

    pig: [
      P('#ef9ca3', [['M', 26, 43], ['Q', 18, 29, 21, 15], ['Q', 38, 14, 43, 35], ['Z']]),
      P('#ef9ca3', [['M', 57, 35], ['Q', 62, 14, 79, 15], ['Q', 83, 29, 74, 43], ['Z']]),
      P('#dc7d89', [['M', 25, 21], ['L', 35, 27], ['L', 29, 36], ['Z']], false),
      P('#dc7d89', [['M', 75, 21], ['L', 65, 27], ['L', 71, 36], ['Z']], false),
      E(G('#ffdbcf', '#f1a2a0'), 50, 57, 33, 32),
      E(INK, 37, 51, 2.7, 3, false), E(INK, 63, 51, 2.7, 3, false),
      E('#ed8996', 50, 67, 20, 13),
      E(INK, 43, 67, 2.6, 3.5, false), E(INK, 57, 67, 2.6, 3.5, false),
      L([['M', 44, 83], ['Q', 50, 86, 56, 83]])
    ],

    cow: [
      E('#f1d3b9', 21, 41, 12, 8, true, 18),
      E('#f1d3b9', 79, 41, 12, 8, true, -18),
      P('#e6c178', [['M', 30, 32], ['Q', 24, 22, 25, 14], ['Q', 33, 22, 41, 24], ['L', 41, 34], ['Z']]),
      P('#e6c178', [['M', 59, 24], ['Q', 67, 22, 75, 14], ['Q', 76, 22, 70, 32], ['L', 59, 34], ['Z']]),
      P(G('#fffdf0', '#e7e9cf'), [
        ['M', 34, 28], ['Q', 50, 21, 66, 28], ['Q', 76, 38, 73, 55],
        ['L', 71, 72], ['Q', 65, 88, 50, 90], ['Q', 35, 88, 29, 72],
        ['L', 27, 55], ['Q', 24, 38, 34, 28], ['Z']
      ]),
      P('#365d4d', [
        ['M', 31, 34], ['C', 38, 28, 48, 31, 45, 42],
        ['C', 45, 51, 38, 57, 29, 53], ['Q', 26, 42, 31, 34], ['Z']
      ], false),
      P('#365d4d', [['M', 58, 27], ['Q', 69, 28, 71, 38], ['Q', 61, 43, 57, 35], ['Z']], false),
      E(CREAM, 36, 48, 2.7, 3, false), E(INK, 64, 48, 2.7, 3, false),
      E('#efb9ab', 50, 73, 24, 15),
      E(INK, 40, 72, 2.7, 3.5, false), E(INK, 60, 72, 2.7, 3.5, false)
    ],

    horse: [
      // Profil, długa szyja i szeroka grzywa odróżniają konia od rogaczy.
      P('#3e6855', [
        ['M', 48, 22], ['C', 64, 16, 77, 30, 80, 44], ['L', 76, 47],
        ['L', 84, 58], ['L', 79, 60], ['L', 86, 73], ['L', 79, 77],
        ['L', 82, 89], ['L', 57, 89], ['L', 55, 41], ['Z']
      ]),
      P('#e9b56a', [['M', 47, 29], ['Q', 39, 19, 42, 9], ['Q', 53, 13, 57, 27], ['Z']]),
      P(G('#edbc77', '#d49a52'), [
        ['M', 49, 24], ['Q', 38, 25, 34, 37], ['L', 20, 55],
        ['Q', 15, 59, 19, 67], ['Q', 22, 75, 31, 73], ['L', 49, 66],
        ['Q', 53, 77, 49, 89], ['L', 75, 89], ['Q', 75, 60, 64, 38],
        ['Q', 60, 28, 49, 24], ['Z']
      ]),
      P('#fff1d0', [['M', 42, 29], ['Q', 37, 36, 32, 45], ['L', 25, 58], ['L', 35, 61], ['L', 46, 36], ['Z']], false),
      P('#f7dcad', [
        ['M', 22, 55], ['Q', 28, 52, 34, 59], ['L', 38, 67],
        ['L', 30, 73], ['Q', 21, 75, 18, 66], ['Q', 16, 60, 22, 55], ['Z']
      ], false),
      P('#3e6855', [['M', 48, 24], ['Q', 40, 24, 34, 34], ['L', 34, 42], ['Q', 43, 37, 48, 29], ['Z']], false),
      E(INK, 43, 44, 2.8, 3, false), E(INK, 24, 63, 2.5, 3.5, false, -22),
      L([['M', 48, 53], ['Q', 52, 61, 43, 67]])
    ],

    wolf: [
      P(G('#a5c0be', '#779da2'), [
        ['M', 21, 12], ['L', 40, 28], ['L', 50, 23], ['L', 60, 28],
        ['L', 79, 12], ['L', 77, 45], ['L', 87, 57], ['L', 78, 59],
        ['L', 83, 69], ['L', 71, 68], ['L', 65, 79], ['L', 50, 90],
        ['L', 35, 79], ['L', 29, 68], ['L', 17, 69], ['L', 22, 59],
        ['L', 13, 57], ['L', 23, 45], ['Z']
      ]),
      P('#456c68', [['M', 27, 23], ['L', 36, 32], ['L', 27, 38], ['Z']], false),
      P('#456c68', [['M', 73, 23], ['L', 64, 32], ['L', 73, 38], ['Z']], false),
      P('#d6e5dd', [['M', 39, 34], ['L', 50, 29], ['L', 61, 34], ['L', 57, 48], ['L', 50, 59], ['L', 43, 48], ['Z']], false),
      P('#eef1df', [
        ['M', 24, 49], ['L', 42, 61], ['L', 50, 71], ['L', 58, 61],
        ['L', 76, 49], ['L', 75, 65], ['L', 64, 79], ['L', 50, 87],
        ['L', 36, 79], ['L', 25, 65], ['Z']
      ], false),
      P(INK, [['M', 29, 48], ['L', 41, 51], ['L', 36, 56], ['L', 30, 54], ['Z']], false),
      P(INK, [['M', 71, 48], ['L', 59, 51], ['L', 64, 56], ['L', 70, 54], ['Z']], false),
      E('#f3c264', 35, 52, 1.4, 1.4, false), E('#f3c264', 65, 52, 1.4, 1.4, false),
      P(INK, [['M', 45, 69], ['L', 55, 69], ['Q', 58, 71, 54, 75], ['L', 50, 78], ['L', 46, 75], ['Q', 42, 71, 45, 69], ['Z']], false),
      L([['M', 50, 78], ['L', 50, 83]])
    ],

    fox: [
      P(G('#ffc36b', '#ed9140'), [
        ['M', 18, 13], ['L', 39, 29], ['Q', 50, 25, 61, 29],
        ['L', 82, 13], ['L', 83, 49], ['L', 91, 57], ['L', 77, 68],
        ['Q', 62, 81, 50, 88], ['Q', 38, 81, 23, 68],
        ['L', 9, 57], ['L', 17, 49], ['Z']
      ]),
      P('#52644d', [['M', 24, 24], ['L', 35, 32], ['L', 24, 41], ['Z']], false),
      P('#52644d', [['M', 76, 24], ['L', 65, 32], ['L', 76, 41], ['Z']], false),
      P(CREAM, [
        ['M', 16, 49], ['Q', 33, 47, 50, 72], ['Q', 67, 47, 84, 49],
        ['L', 88, 56], ['Q', 70, 76, 50, 86], ['Q', 30, 76, 12, 56], ['Z']
      ], false),
      E(INK, 33, 54, 2.8, 3, false, -15), E(INK, 67, 54, 2.8, 3, false, 15),
      P(INK, [['M', 44, 69], ['Q', 50, 67, 56, 69], ['Q', 58, 71, 54, 75], ['L', 50, 78], ['L', 46, 75], ['Q', 42, 71, 44, 69], ['Z']], false),
      L([['M', 50, 78], ['L', 50, 82]])
    ],

    smallDog: [
      // Okrągły pysk, opadające uszy i koralowa obroża.
      P(G('#e3ad61', '#ce934b'), [
        ['M', 31, 29], ['C', 15, 22, 9, 37, 11, 54],
        ['C', 12, 68, 21, 74, 29, 64], ['L', 37, 40], ['Z']
      ]),
      P(G('#e3ad61', '#ce934b'), [
        ['M', 69, 29], ['C', 85, 22, 91, 37, 89, 54],
        ['C', 88, 68, 79, 74, 71, 64], ['L', 63, 40], ['Z']
      ]),
      P('#ea9890', [['M', 32, 78], ['Q', 50, 84, 68, 78], ['L', 68, 88], ['Q', 50, 94, 32, 88], ['Z']]),
      P(G('#ffe7b7', '#edc58c'), [
        ['M', 33, 28], ['Q', 50, 21, 67, 28], ['Q', 77, 43, 73, 63],
        ['Q', 68, 82, 50, 84], ['Q', 32, 82, 27, 63], ['Q', 23, 43, 33, 28], ['Z']
      ]),
      P('#dca357', [['M', 31, 35], ['Q', 40, 29, 44, 38], ['L', 41, 53], ['Q', 31, 57, 27, 48], ['Z']], false),
      E(CREAM, 50, 65, 18, 12, false),
      E(INK, 37, 49, 2.7, 3, false), E(INK, 63, 49, 2.7, 3, false),
      P('#ed9b9b', [['M', 45, 70], ['L', 55, 70], ['L', 55, 76], ['Q', 50, 83, 45, 76], ['Z']], false),
      P(INK, [['M', 44, 60], ['Q', 50, 57, 56, 60], ['Q', 58, 62, 54, 66], ['Q', 50, 70, 46, 66], ['Q', 42, 62, 44, 60], ['Z']], false),
      L([['M', 50, 68], ['L', 50, 71], ['M', 43, 70], ['Q', 47, 74, 50, 71], ['Q', 53, 74, 57, 70]]),
      E('#ffe2a1', 50, 88, 3.5, 3.5, false)
    ],

    bigDog: [
      // Szeroki pysk, stojące uszy, pasterska maska i bursztynowa obroża.
      P('#4a7159', [['M', 20, 12], ['L', 42, 29], ['L', 29, 46], ['Z']]),
      P('#4a7159', [['M', 80, 12], ['L', 58, 29], ['L', 71, 46], ['Z']]),
      P('#e4b66c', [['M', 27, 23], ['L', 35, 31], ['L', 28, 37], ['Z']], false),
      P('#e4b66c', [['M', 73, 23], ['L', 65, 31], ['L', 72, 37], ['Z']], false),
      P('#e1ad4f', [['M', 28, 79], ['Q', 50, 88, 72, 79], ['L', 72, 89], ['Q', 50, 97, 28, 89], ['Z']]),
      P(G('#efc984', '#dda862'), [
        ['M', 33, 28], ['Q', 50, 21, 67, 28], ['L', 76, 43], ['L', 74, 68],
        ['Q', 67, 82, 50, 85], ['Q', 33, 82, 26, 68], ['L', 24, 43], ['Z']
      ]),
      P('#436b54', [['M', 29, 35], ['Q', 38, 28, 45, 36], ['L', 43, 55], ['L', 30, 58], ['L', 26, 44], ['Z']], false),
      P('#436b54', [['M', 71, 35], ['Q', 62, 28, 55, 36], ['L', 57, 55], ['L', 70, 58], ['L', 74, 44], ['Z']], false),
      E(CREAM, 36, 46, 2.7, 3, false), E(CREAM, 64, 46, 2.7, 3, false),
      P('#fff0cd', [['M', 35, 57], ['Q', 50, 51, 65, 57], ['L', 67, 70], ['Q', 62, 80, 50, 80], ['Q', 38, 80, 33, 70], ['Z']], false),
      P(INK, [['M', 43, 60], ['Q', 50, 57, 57, 60], ['L', 56, 66], ['Q', 50, 71, 44, 66], ['Z']], false),
      L([['M', 50, 69], ['L', 50, 74], ['M', 44, 74], ['Q', 50, 78, 56, 74]]),
      E(CREAM, 50, 90, 3.5, 3.5, false)
    ]
  };

  function trace(ctx, layer) {
    ctx.beginPath();
    if (layer.ellipse) {
      var e = layer.ellipse;
      ctx.ellipse(e[0], e[1], e[2], e[3], e[4], 0, Math.PI * 2);
      return;
    }
    for (var i = 0; i < layer.commands.length; i++) {
      var p = layer.commands[i];
      if (p[0] === 'M') ctx.moveTo(p[1], p[2]);
      else if (p[0] === 'L') ctx.lineTo(p[1], p[2]);
      else if (p[0] === 'Q') ctx.quadraticCurveTo(p[1], p[2], p[3], p[4]);
      else if (p[0] === 'C') ctx.bezierCurveTo(p[1], p[2], p[3], p[4], p[5], p[6]);
      else if (p[0] === 'Z') ctx.closePath();
    }
  }

  /** Rysuje portret w kwadracie size×size zaczepionym w (x, y). */
  function drawAnimal(ctx, sym, x, y, size, outlineScale) {
    var layers = DEFS[sym];
    if (!layers) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 100, size / 100);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;
    var outline = 3.3 * (outlineScale || 1);
    for (var i = 0; i < layers.length; i++) {
      var layer = layers[i];
      trace(ctx, layer);
      if (layer.fill) {
        if (typeof layer.fill === 'string') ctx.fillStyle = layer.fill;
        else {
          // Delikatne światło na samym kształcie, bez brązowej poświaty.
          var g = ctx.createLinearGradient(34, 18, 66, 88);
          g.addColorStop(0, layer.fill.top);
          g.addColorStop(1, layer.fill.bottom);
          ctx.fillStyle = g;
        }
        ctx.fill();
      }
      if (layer.outline) {
        ctx.lineWidth = outline * (layer.width || 1);
        ctx.stroke();
      }
    }
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
      var c = cellOf(ORDER[i]);
      var pad = cw * 0.14;
      drawAnimal(ctx, ORDER[i], c.col * cw + pad, c.row * ch + pad, cw - pad * 2, 1);
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
