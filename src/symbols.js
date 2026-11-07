/* ============================================================
   SUPERFARMER — grafika zwierząt (atlas na kostki + sprite'y HUD)
   Nowe sylwetki z krzywych Béziera: naturalne proporcje, warstwowe
   umaszczenie i lekki sepiowy kontur. Wspólny nadruk dla kostek i HUD.
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

  // Paleta nadruków: naturalne pigmenty, czytelne także na kremowej żywicy.
  var COLORS = {
    rabbit: '#b8a07f', sheep: '#ded3bb', pig: '#dba99a', cow: '#e8e0d0',
    horse: '#9d6b45', smallDog: '#bd925e', bigDog: '#a28355',
    wolf: '#7c8b87', fox: '#c97c3a'
  };
  var INK = '#493f34';

  /* ---------- płynne sylwetki, rysowane bez zewnętrznych plików ---------- */
  // Własne, małe polecenia ścieżki zapewniają ten sam rysunek w atlasie i HUD.
  // Są parsowane raz, przy inicjalizacji; nie wymagają Path2D ani SVG w DOM.
  function commands(text) {
    var tokens = text.match(/[MLCQZ]|-?\d+(?:\.\d+)?/g), out = [], i = 0;
    var sizes = { M: 2, L: 2, C: 6, Q: 4, Z: 0 };
    while (i < tokens.length) {
      var op = tokens[i++], args = [];
      for (var j = 0; j < sizes[op]; j++) args.push(+tokens[i++]);
      out.push([op, args]);
    }
    return out;
  }
  function F(d, fill, outline) { return { path: commands(d), fill: fill, stroke: outline === false ? null : INK }; }
  function L(d, color, width) { return { path: commands(d), stroke: color || INK, width: width || 1.6, detail: true }; }
  function E(x, y, rx, ry, fill, outline) { return { ellipse: [x, y, rx, ry], fill: fill, stroke: outline ? INK : null }; }
  function G(top, bottom) { return { top: top, bottom: bottom }; }

  function trace(ctx, layer) {
    ctx.beginPath();
    if (layer.ellipse) {
      var e = layer.ellipse;
      ctx.ellipse(e[0], e[1], e[2], e[3], 0, 0, Math.PI * 2);
      return;
    }
    for (var i = 0; i < layer.path.length; i++) {
      var part = layer.path[i], a = part[1];
      if (part[0] === 'M') ctx.moveTo(a[0], a[1]);
      else if (part[0] === 'L') ctx.lineTo(a[0], a[1]);
      else if (part[0] === 'C') ctx.bezierCurveTo(a[0], a[1], a[2], a[3], a[4], a[5]);
      else if (part[0] === 'Q') ctx.quadraticCurveTo(a[0], a[1], a[2], a[3]);
      else ctx.closePath();
    }
  }

  /* Nowe rysunki w siatce 100×100. Zwierzęta patrzą w prawo; ważniejsze od
     drobnych szczegółów są uszy, szyja, grzbiet i charakterystyczny ruch ogona.
     Dalsze nogi leżą pod korpusem, a cieniowanie pozostaje wewnątrz nadruku. */
  var DEFS = {
    rabbit: [
      F('M43 39 C39 31 32 15 37 11 C42 8 51 26 53 35 Z', '#aa8d70'),
      F('M52 37 C49 25 50 8 55 7 C62 7 64 23 59 36 Z', G('#c4ad90', '#aa9071')),
      F('M54 31 C53 21 53 12 55 12 C58 14 59 24 56 32 Z', '#d6b8a5', false),
      F('M42 32 C38 23 36 16 38 15 C41 18 45 26 47 32 Z', '#d1b19a', false),
      E(23, 69, 9, 8, '#eee6d6', true),
      F('M40 49 C39 41 44 35 53 34 C61 31 70 35 74 42 L80 46 C84 49 81 54 75 54 L68 55 C66 64 68 72 72 79 C76 82 74 86 69 86 L60 86 C56 85 58 80 60 79 L57 72 C56 81 49 87 39 87 L22 87 C16 86 18 81 25 79 C22 67 26 54 40 49 Z', G('#c7b293', '#aa8d6b')),
      F('M63 51 C64 61 60 67 61 75 L65 80 L64 83 L69 83 C66 72 65 64 68 55 Z', '#eee3cf', false),
      F('M34 77 C30 65 35 57 45 56 C54 57 57 66 51 73 C47 78 42 79 34 77 Z', '#b49a79', false),
      L('M36 78 C45 82 52 77 53 71', '#887254', 1.5),
      L('M25 83 L35 83 M64 83 L70 83', '#8b755a', 1.3),
      E(68, 43, 1.9, 2.2, '#3e3930'),
      E(68.5, 42.3, 0.65, 0.7, '#f7efe0'),
      E(79.1, 49, 1.7, 1.4, '#735747'),
      L('M75 52 Q72 54 70 52', '#896c55', 1.2)
    ],

    sheep: [
      F('M34 62 L40 64 L39 85 L43 88 L34 88 Z', '#9b8b72'),
      F('M66 61 L73 61 L75 85 L79 88 L69 88 Z', '#9b8b72'),
      F('M22 53 Q11 49 13 56 Q14 62 23 62 Z', '#d8ccb4'),
      F('M27 62 L34 65 L31 86 L35 89 L25 89 Z', '#695b48'),
      F('M63 63 L70 61 L66 86 L70 89 L60 89 Z', '#695b48'),
      F('M25 34 Q27 27 36 30 Q42 23 50 29 Q59 24 66 31 Q77 28 80 38 Q88 41 82 50 Q88 58 78 64 Q76 74 66 71 Q58 77 50 72 Q40 77 33 70 Q24 75 21 65 Q12 61 18 53 Q11 46 18 41 Q17 35 25 34 Z', G('#f1e9d8', '#d7c9ac')),
      F('M75 37 C82 35 87 42 87 50 L91 61 C92 67 85 69 80 64 L74 55 C69 49 69 41 75 37 Z', G('#8d7b61', '#625542')),
      F('M77 40 C71 34 65 36 66 41 C69 46 73 46 77 43 Z', '#6e5e49'),
      F('M82 40 Q90 34 93 38 Q94 43 87 45 Z', '#7a6850'),
      F('M73 37 Q77 31 82 36 Q87 35 88 41 Q79 43 73 41 Z', '#ebe1ca'),
      L('M27 43 Q32 39 37 43 M46 36 Q52 32 57 37 M40 58 Q47 63 53 58 M62 47 Q68 43 72 48 M24 57 Q28 61 33 58', '#bcad90', 1.5),
      E(83, 47, 1.5, 1.6, '#302f29'),
      L('M86 61 L88 62', '#40392e', 1.8)
    ],

    pig: [
      F('M34 68 L42 68 L41 85 L45 88 L35 88 Z', '#ba8578'),
      F('M64 68 L71 67 L74 85 L77 88 L67 88 Z', '#ba8578'),
      L('M19 50 C8 44 4 50 8 55 C13 60 17 54 13 51', '#9c6a5c', 3.1),
      F('M21 42 C33 33 56 33 68 41 L77 38 L79 30 L87 36 L85 45 C91 47 93 52 92 57 L96 58 L95 66 L88 69 L81 66 C77 72 72 75 66 76 L65 87 L57 87 L56 78 L37 77 L34 87 L26 87 L26 75 C18 71 14 63 14 54 C14 48 17 44 21 42 Z', G('#e7bbab', '#cc9687')),
      F('M79 35 L83 37 L81 45 L76 42 Z', '#bd8275', false),
      E(91.2, 61.5, 5, 5.7, '#e9b6a2', true),
      E(92.6, 60.3, 1.1, 1.5, '#9f6b5d'),
      E(90.4, 64.1, 1, 1.3, '#9f6b5d'),
      F('M25 81 L34 81 L34 87 L26 87 Z', '#8b6657', false),
      F('M57 81 L65 81 L65 87 L57 87 Z', '#8b6657', false),
      L('M25 52 C21 57 23 66 29 69 M69 49 Q73 53 73 59', '#b48070', 1.5),
      E(84, 51, 1.7, 1.8, '#46382f'),
      E(84.4, 50.5, 0.55, 0.6, '#f9e8da')
    ],

    cow: [
      F('M38 61 L46 61 L45 84 L48 88 L38 88 Z', '#bab3a1'),
      F('M67 60 L75 60 L79 84 L82 88 L71 88 Z', '#b4ab97'),
      F('M47 65 C48 73 51 78 57 78 C64 77 66 72 63 66 Z', '#d4aaa0'),
      L('M20 43 C12 52 15 65 10 75', '#716553', 2.8),
      F('M10 70 C6 73 4 79 7 81 C11 82 15 75 13 72 Z', '#625747'),
      F('M22 40 C33 34 50 35 64 40 L74 34 L77 25 L82 30 L86 26 L87 37 C91 42 91 49 95 53 L94 60 C90 64 84 61 80 59 L75 55 L72 65 L72 85 L64 86 L64 68 C54 72 40 72 32 67 L29 86 L21 86 L23 65 C17 60 16 47 22 40 Z', G('#f1ecdf', '#dbd3bf')),
      F('M27 42 C33 38 40 38 43 44 C47 52 40 59 33 57 C27 56 24 49 27 42 Z', '#686050', false),
      F('M49 38 C55 37 60 39 63 42 L60 50 C55 52 49 47 49 38 Z', '#605949', false),
      F('M57 55 C63 51 69 55 70 62 C66 69 59 69 56 65 Z', '#726756', false),
      F('M76 37 Q69 28 66 32 Q66 39 74 42 Z', '#e7dfcb'),
      F('M87 37 Q94 30 96 35 Q97 41 90 43 Z', '#e7dfcb'),
      F('M77 33 Q72 26 74 21 Q80 24 81 32 Z', '#cbb58b'),
      F('M84 31 Q84 22 89 22 Q91 28 87 34 Z', '#cbb58b'),
      F('M78 36 C83 32 87 37 88 42 L87 51 L81 51 L77 46 Z', '#6c6050', false),
      E(89, 55.8, 7.1, 5.3, '#cfae9d', true),
      E(92, 55.2, 1.2, 1.4, '#856d59'),
      E(84.5, 42.4, 1.6, 1.8, '#302f28'),
      F('M21 81 L29 81 L29 86 L21 86 Z', '#605546', false),
      F('M64 81 L72 81 L72 86 L64 86 Z', '#605546', false),
      L('M35 64 Q43 68 49 67', '#b6ad97', 1.4)
    ],

    horse: [
      F('M31 52 L40 56 L37 72 L40 87 L33 88 L29 72 Z', '#7d573d'),
      F('M57 51 L63 53 L67 69 L79 83 L77 88 L71 87 L59 73 Z', '#7d573d'),
      F('M21 41 C10 41 9 52 7 64 C6 70 4 74 7 77 C14 72 18 62 18 53 L25 48 Z', G('#64503a', '#40382d')),
      F('M21 43 C31 36 45 38 55 42 L64 26 L67 16 L72 22 L78 18 L82 26 C88 28 92 31 94 36 L92 42 C88 45 82 40 78 36 L73 39 C69 47 69 52 63 58 L60 80 L63 88 L53 88 L52 81 L54 61 C45 65 35 63 29 60 L24 73 L23 87 L14 87 L17 69 L17 57 C13 53 14 47 21 43 Z', G('#b4885a', '#95623e')),
      F('M68 18 C62 22 59 33 53 42 L55 48 C63 41 66 33 73 29 L79 27 Z', '#56402f', false),
      F('M79 27 L82 29 L85 36 L81 34 Z', '#e9dac0', false),
      F('M17 81 L24 81 L23 87 L14 87 Z', '#50402f', false),
      F('M52 82 L59 82 L63 88 L53 88 Z', '#50402f', false),
      E(90, 37.6, 3.6, 2.7, '#b58b67'),
      E(91.6, 37.8, 1.2, 1.3, '#58432f'),
      E(82.9, 30.8, 1.6, 1.7, '#352f26'),
      L('M26 55 C30 58 31 64 28 69 M57 48 Q61 51 60 56', '#785136', 1.6),
      L('M19 45 Q26 41 34 42', '#c9a379', 1.6)
    ],

    wolf: [
      F('M29 48 C20 43 10 49 6 57 C3 63 7 68 10 69 C13 61 22 61 30 59 Z', G('#8e9a93', '#5d6b64')),
      F('M39 49 L46 52 L41 69 L34 84 L26 85 L27 81 L35 66 Z', '#596a63'),
      F('M61 48 L68 48 L72 66 L86 81 L83 86 L76 83 L64 69 Z', '#596a63'),
      F('M27 39 C39 35 52 38 62 36 L69 29 L72 17 L78 28 L83 23 L84 34 L95 40 L93 45 L85 47 L77 43 L73 54 L71 68 L76 84 L69 86 L63 70 L60 56 C52 60 41 59 33 56 L28 73 L19 85 L13 84 L23 67 L22 49 Z', G('#a0aaa1', '#718178')),
      F('M27 40 C38 36 50 38 59 39 L58 49 C48 47 37 49 27 46 Z', '#61716a', false),
      F('M71 37 L76 41 L77 47 L73 54 L71 62 L66 56 L67 48 L64 46 Z', '#d3d5c6', false),
      F('M85 40 L92 43 L86 46 L80 43 Z', '#d9d8c9', false),
      F('M72 23 L75 29 L71 31 Z', '#5a6258', false),
      F('M80 29 L82 27 L82 34 Z', '#5a6258', false),
      E(94, 41.2, 1.9, 1.5, '#343d35'),
      E(80.2, 35.6, 1.5, 1.5, '#c1a46b'),
      E(80.5, 35.6, 0.7, 0.9, '#303b32'),
      L('M28 51 Q32 54 33 58 M64 59 L67 68', '#58675d', 1.5)
    ],

    fox: [
      F('M35 50 C24 39 8 45 5 58 C1 71 13 82 27 77 C36 74 40 63 35 50 Z', G('#d69b5b', '#b86d36')),
      F('M9 49 C4 54 3 64 7 70 C13 70 19 66 20 61 C15 61 15 55 9 49 Z', '#f0e5cd', false),
      F('M43 56 L49 57 L45 73 L39 84 L32 84 L36 76 Z', '#a35f33'),
      F('M61 54 L66 55 L75 72 L84 79 L81 84 L75 82 L65 70 Z', '#8a5633'),
      F('M33 49 C42 43 54 44 64 47 L69 38 L69 23 L77 32 L84 26 L84 40 L95 47 L91 53 L80 54 L74 50 L70 65 L75 82 L68 85 L62 69 L59 61 C52 66 44 67 38 65 L31 80 L21 85 L16 81 L27 67 C24 61 26 53 33 49 Z', G('#db9b55', '#c27b3c')),
      F('M72 43 L78 47 L82 50 L90 50 L87 53 L79 53 L74 50 L70 63 L66 58 Z', '#f4e8cf', false),
      F('M70 28 L75 34 L71 38 Z', '#6a4b33', false),
      F('M81 32 L83 30 L82 39 L79 38 Z', '#6a4b33', false),
      F('M23 77 L29 78 L25 83 L21 85 L16 81 Z', '#5e4833', false),
      F('M66 76 L72 76 L75 82 L68 85 Z', '#5e4833', false),
      E(93.8, 47.9, 1.9, 1.5, '#493a2b'),
      E(80.2, 42.6, 1.7, 1.6, '#4a3926'),
      L('M32 55 Q38 50 45 50', '#e5b77b', 1.4)
    ],

    smallDog: [
      F('M25 54 C17 47 13 38 10 34 C7 33 6 36 8 41 C10 49 13 59 22 63 Z', '#d3ac74'),
      F('M10 34 Q6 32 7 39 L11 46 L15 44 Z', '#efe4cd', false),
      F('M38 66 L45 66 L44 84 L48 88 L39 88 Z', '#c4b8a1'),
      F('M63 64 L69 64 L76 85 L79 87 L70 88 Z', '#b6a78e'),
      F('M25 49 C35 43 51 47 62 48 C66 38 73 33 82 36 C90 39 91 48 88 53 L96 57 Q97 63 90 64 L82 64 L77 59 L71 72 L71 86 L63 87 L61 73 L41 73 L37 87 L29 87 L29 72 C21 70 19 60 25 49 Z', G('#f3ead8', '#dbceb5')),
      F('M25 49 C33 44 43 46 49 49 L49 61 C41 66 32 65 23 61 Z', '#9c7a50', false),
      F('M33 47 C38 45 45 47 48 49 L48 58 Q41 59 35 55 Z', '#625442', false),
      F('M62 48 C66 38 73 33 82 36 C90 39 91 47 88 53 L83 57 L77 56 L72 62 L67 58 Z', '#c49964', false),
      F('M74 38 C66 36 63 45 66 54 C68 63 74 65 77 56 C80 48 80 41 74 38 Z', G('#9e784f', '#7d583a')),
      F('M86 52 L94 56 L95 61 L88 63 L82 60 Z', '#f1e2c7', false),
      L('M73 61 L78 62 L75 67 L71 65', '#9a6553', 2.7),
      E(75, 65.9, 1.7, 1.7, '#c5a259'),
      E(94.8, 57.9, 2, 1.6, '#4a3d2d'),
      E(84.1, 45.9, 1.6, 1.7, '#3c3429')
    ],

    bigDog: [
      F('M37 73 C29 77 19 80 12 79 C8 79 8 83 12 86 C20 91 34 90 43 84 Z', G('#a48758', '#725e42')),
      F('M59 59 L65 58 L68 82 L75 87 L73 90 L64 90 L60 83 Z', '#826a48'),
      F('M37 55 C39 48 44 43 51 39 L55 28 L55 13 L64 23 L73 11 L74 29 L84 36 L92 41 L90 47 L80 50 L72 45 L67 55 L66 79 L72 86 L71 90 L59 90 L55 83 L55 66 C50 70 46 75 45 81 L52 85 L50 90 L30 90 C24 88 26 81 32 77 C28 71 29 62 37 55 Z', G('#c0a476', '#98764c')),
      F('M39 54 C42 47 48 43 53 42 L59 51 L55 66 C49 69 44 75 43 81 L34 80 C31 73 31 63 39 54 Z', '#655c49', false),
      F('M56 26 L59 21 L64 29 L72 18 L72 31 L81 36 L79 43 L72 43 L68 51 L62 46 L57 37 Z', '#615744', false),
      F('M74 38 L80 39 L88 44 L82 47 L74 43 L67 54 L64 48 Z', '#d0b488', false),
      F('M57 17 L61 25 L57 27 Z', '#8a6d4c', false),
      F('M69 20 L72 15 L71 28 L67 29 Z', '#8a6d4c', false),
      L('M58 47 Q65 53 71 49', '#50694b', 3.2),
      E(66.3, 52.4, 2, 2.4, '#c1a269'),
      E(90.6, 42.3, 2, 1.6, '#40382d'),
      E(73.1, 34, 1.6, 1.5, '#d3b579'),
      E(73.4, 34, 0.7, 0.8, '#393b2d'),
      L('M37 83 L44 85 M60 85 L66 86', '#7d6546', 1.5)
    ]
  };

  /** Rysuje nowy nadruk w kwadracie size×size zaczepionym w (x, y). */
  function drawAnimal(ctx, sym, x, y, size, outlineScale) {
    var layers = DEFS[sym];
    if (!layers) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 100, size / 100);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (var i = 0; i < layers.length; i++) {
      var layer = layers[i];
      trace(ctx, layer);
      if (layer.fill) {
        if (typeof layer.fill === 'string') ctx.fillStyle = layer.fill;
        else {
          var gradient = ctx.createLinearGradient(26, 25, 69, 90);
          gradient.addColorStop(0, layer.fill.top);
          gradient.addColorStop(1, layer.fill.bottom);
          ctx.fillStyle = gradient;
        }
        ctx.fill();
      }
      if (layer.stroke) {
        ctx.strokeStyle = layer.stroke;
        ctx.lineWidth = (layer.width || 2.7) * (layer.detail ? 1 : (outlineScale || 1));
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
