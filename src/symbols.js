/* ============================================================
   SUPERFARMER — ilustracje zwierząt (atlas na kostki + sprite'y HUD)
   Naturalistyczne ilustracje w przezroczystym arkuszu WebP.
   Jeden zestaw nadruków dla kostek i interfejsu, osadzany w HTML.
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
  /* ---------- ilustracje: jeden wspólny arkusz dla kości i HUD-u ---------- */
  // build.mjs osadza obraz jako data URI. W dev arkusz jest czytany obok źródeł.
  var ART_SOURCE = '__ANIMAL_ART_DATA__';
  var scriptBase = document.currentScript && document.currentScript.src || document.baseURI;
  var ART_ORDER = ['rabbit', 'sheep', 'pig', 'cow', 'horse', 'smallDog', 'bigDog', 'wolf', 'fox'];
  var artwork = null, loading = false, waiters = [];
  var spriteCache = Object.create(null);

  /** Dekoduje ilustracje przed budową atlasu i pierwszym wywołaniem HUD-u. */
  function load(done, onError) {
    if (artwork) { if (done) done(); return; }
    waiters.push({ done: done, error: onError });
    if (loading) return;
    loading = true;
    var img = new Image(), settled = false;
    function finish(error) {
      if (settled) return;
      settled = true;
      img.onload = img.onerror = null;
      loading = false;
      if (!error) artwork = img;
      var pending = waiters; waiters = [];
      pending.forEach(function (entry) {
        var callback = error ? entry.error : entry.done;
        if (!callback) return;
        try { callback(error); }
        catch (callbackError) {
          // Błąd jednego odbiorcy nie zatrzymuje pozostałych oczekujących.
          setTimeout(function () { throw callbackError; }, 0);
        }
      });
    }
    img.onload = function () {
      var w = img.naturalWidth, h = img.naturalHeight;
      if (!w || w !== h || w % 3 !== 0) {
        finish(new Error('Nieprawidłowy arkusz ilustracji zwierząt.'));
        return;
      }
      finish();
    };
    img.onerror = function () { finish(new Error('Nie udało się wczytać ilustracji zwierząt.')); };
    try {
      img.src = ART_SOURCE.indexOf('data:') === 0 ? ART_SOURCE
        : scriptBase ? new URL('../assets/animals.webp', scriptBase).href : '../assets/animals.webp';
    } catch (error) { finish(error); }
  }

  function requireArtwork() {
    if (!artwork) throw new Error('Wywołaj SYMBOLS.load przed rysowaniem zwierząt.');
  }

  /** Ten sam obraz na kościach i w interfejsie; outlineScale zostaje w API. */
  function drawAnimal(ctx, sym, x, y, size, outlineScale) {
    var i = ART_ORDER.indexOf(sym);
    if (i < 0) return;
    requireArtwork();
    var cell = artwork.naturalWidth / 3;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(artwork, (i % 3) * cell, Math.floor(i / 3) * cell, cell, cell, x, y, size, size);
    ctx.restore();
  }

  /* ---------- atlas 4×2: niezmienna kolejność ścian kostek ---------- */
  var GRID_X = 4, GRID_Y = 2;

  function cellOf(sym) {
    var i = ORDER.indexOf(sym);
    return { col: i % GRID_X, row: Math.floor(i / GRID_X), index: i };
  }

  function buildAtlas(size) {
    requireArtwork();
    size = size || 2048;
    var cw = size / GRID_X, ch = (size / 2) / GRID_Y;
    var cv = document.createElement('canvas');
    cv.width = size; cv.height = size / 2;
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (var i = 0; i < ORDER.length; i++) {
      var c = cellOf(ORDER[i]), pad = cw * 0.14;
      drawAnimal(ctx, ORDER[i], c.col * cw + pad, c.row * ch + pad, cw - pad * 2, 1);
    }
    return cv;
  }

  /** Przezroczysty sprite HUD renderowany 2× dla ekranów Retina. */
  function sprite(sym, px) {
    requireArtwork();
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
    load: load,
    buildAtlas: buildAtlas,
    drawAnimal: drawAnimal,
    sprite: sprite
  };
})();
