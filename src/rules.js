/* ============================================================
   SUPERFARMER — zasady gry (wydanie Granna)
   Czysta logika, bez DOM/3D. Global: RULES (+ module.exports dla testów w node).
   ============================================================ */
var RULES = (function () {
  'use strict';

  var ANIMALS = ['rabbit', 'sheep', 'pig', 'cow', 'horse', 'smallDog', 'bigDog'];
  var WIN_ANIMALS = ['rabbit', 'sheep', 'pig', 'cow', 'horse'];

  var STOCK_INIT = { rabbit: 60, sheep: 24, pig: 20, cow: 12, horse: 6, smallDog: 4, bigDog: 2 };

  // Rozkład ścianek obu kostek (12-ściennych) wg oryginału:
  // Kostka A: 6 królików, 3 owce, 1 świnia, 1 krowa, 1 wilk
  // Kostka B: 6 królików, 2 owce, 2 świnie, 1 koń, 1 lis
  // Kolejność przeplatana, żeby identyczne symbole nie sąsiadowały na bryle.
  var DIE_A = ['rabbit', 'sheep', 'rabbit', 'pig', 'rabbit', 'sheep', 'rabbit', 'cow', 'rabbit', 'sheep', 'rabbit', 'wolf'];
  var DIE_B = ['rabbit', 'sheep', 'rabbit', 'pig', 'rabbit', 'horse', 'rabbit', 'sheep', 'rabbit', 'pig', 'rabbit', 'fox'];

  // Kursy wymiany ze Stadem Głównym (działają w obie strony, 1 wymiana na turę).
  var EXCHANGE_RATES = [
    { id: 'r-s', give: 'rabbit', giveN: 6, get: 'sheep', getN: 1 },
    { id: 's-p', give: 'sheep', giveN: 2, get: 'pig', getN: 1 },
    { id: 'p-c', give: 'pig', giveN: 3, get: 'cow', getN: 1 },
    { id: 'c-h', give: 'cow', giveN: 2, get: 'horse', getN: 1 },
    { id: 's-sd', give: 'sheep', giveN: 1, get: 'smallDog', getN: 1 },
    { id: 'c-bd', give: 'cow', giveN: 1, get: 'bigDog', getN: 1 }
  ];

  function emptyHerd() {
    var h = {};
    for (var i = 0; i < ANIMALS.length; i++) h[ANIMALS[i]] = 0;
    return h;
  }

  function clone(o) {
    var c = {};
    for (var k in o) c[k] = o[k];
    return c;
  }

  /**
   * Rozstrzyga rzut dwiema kostkami.
   * Najpierw drapieżniki (lis kradnie króliki, wilk pożera wszystko poza końmi
   * i małym psem; psy przeganiają drapieżniki kosztem powrotu do Stada),
   * potem rozmnażanie: za każdą PARĘ (stado + kostki) przybywa jedno zwierzę.
   * Zwraca { herd, stock, events } — kopie, bez mutacji wejścia.
   */
  function resolveRoll(herdIn, stockIn, faceA, faceB) {
    var herd = clone(herdIn);
    var stock = clone(stockIn);
    var events = [];

    // --- wilk (tylko kostka A) ---
    if (faceA === 'wolf') {
      if (herd.bigDog > 0) {
        herd.bigDog -= 1;
        stock.bigDog += 1;
        events.push({ t: 'wolf', saved: true });
      } else {
        var eaten = {};
        var total = 0;
        for (var i = 0; i < ANIMALS.length; i++) {
          var a = ANIMALS[i];
          if (a === 'horse' || a === 'smallDog') continue;
          if (herd[a] > 0) {
            eaten[a] = herd[a];
            total += herd[a];
            stock[a] += herd[a];
            herd[a] = 0;
          }
        }
        events.push({ t: 'wolf', saved: false, eaten: eaten, total: total });
      }
    }

    // --- lis (tylko kostka B) ---
    if (faceB === 'fox') {
      if (herd.smallDog > 0) {
        herd.smallDog -= 1;
        stock.smallDog += 1;
        events.push({ t: 'fox', saved: true });
      } else {
        var lost = herd.rabbit;
        stock.rabbit += lost;
        herd.rabbit = 0;
        events.push({ t: 'fox', saved: false, lost: lost });
      }
    }

    // --- rozmnażanie ---
    var gainedAny = false;
    for (var j = 0; j < WIN_ANIMALS.length; j++) {
      var an = WIN_ANIMALS[j];
      var onDice = (faceA === an ? 1 : 0) + (faceB === an ? 1 : 0);
      if (onDice === 0) continue;
      var pairs = Math.floor((herd[an] + onDice) / 2);
      if (pairs <= 0) continue;
      var gain = Math.min(pairs, stock[an]);
      if (gain > 0) {
        herd[an] += gain;
        stock[an] -= gain;
        gainedAny = true;
        events.push({ t: 'gain', animal: an, n: gain, capped: gain < pairs });
      } else if (pairs > 0) {
        events.push({ t: 'gain', animal: an, n: 0, capped: true });
      }
    }

    if (!gainedAny && faceA !== 'wolf' && faceB !== 'fox') {
      events.push({ t: 'nothing' });
    }

    return { herd: herd, stock: stock, events: events };
  }

  /** dir: +1 = give→get (w górę), -1 = get→give (w dół). */
  function canExchange(herd, stock, rate, dir, times) {
    times = times || 1;
    if (times < 1) return false;
    if (dir > 0) {
      return herd[rate.give] >= rate.giveN * times && stock[rate.get] >= rate.getN * times;
    }
    return herd[rate.get] >= rate.getN * times && stock[rate.give] >= rate.giveN * times;
  }

  function maxTimes(herd, stock, rate, dir) {
    if (dir > 0) {
      return Math.min(Math.floor(herd[rate.give] / rate.giveN), Math.floor(stock[rate.get] / rate.getN));
    }
    return Math.min(Math.floor(herd[rate.get] / rate.getN), Math.floor(stock[rate.give] / rate.giveN));
  }

  function applyExchange(herdIn, stockIn, rate, dir, times) {
    times = times || 1;
    var herd = clone(herdIn);
    var stock = clone(stockIn);
    if (!canExchange(herd, stock, rate, dir, times)) return null;
    if (dir > 0) {
      herd[rate.give] -= rate.giveN * times; stock[rate.give] += rate.giveN * times;
      herd[rate.get] += rate.getN * times; stock[rate.get] -= rate.getN * times;
    } else {
      herd[rate.get] -= rate.getN * times; stock[rate.get] += rate.getN * times;
      herd[rate.give] += rate.giveN * times; stock[rate.give] -= rate.giveN * times;
    }
    return { herd: herd, stock: stock };
  }

  /** Zwycięstwo: co najmniej po jednym z 5 zwierząt (psy niewymagane). */
  function checkWin(herd) {
    for (var i = 0; i < WIN_ANIMALS.length; i++) {
      if (herd[WIN_ANIMALS[i]] < 1) return false;
    }
    return true;
  }

  /** Wartość stada w królikach (do AI i statystyk). */
  var VALUE = { rabbit: 1, sheep: 6, pig: 12, cow: 36, horse: 72, smallDog: 6, bigDog: 36 };
  function herdValue(herd) {
    var v = 0;
    for (var k in VALUE) v += (herd[k] || 0) * VALUE[k];
    return v;
  }

  var api = {
    ANIMALS: ANIMALS,
    WIN_ANIMALS: WIN_ANIMALS,
    STOCK_INIT: STOCK_INIT,
    DIE_A: DIE_A,
    DIE_B: DIE_B,
    EXCHANGE_RATES: EXCHANGE_RATES,
    VALUE: VALUE,
    emptyHerd: emptyHerd,
    resolveRoll: resolveRoll,
    canExchange: canExchange,
    maxTimes: maxTimes,
    applyExchange: applyExchange,
    checkWin: checkWin,
    herdValue: herdValue
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  return api;
})();
