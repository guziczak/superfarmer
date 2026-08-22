/* ============================================================
   SUPERFARMER — bot „Zenek”: heurystyka wymian
   Global: AI
   ============================================================ */
var AI = (function () {
  'use strict';

  function rateById(id) {
    for (var i = 0; i < RULES.EXCHANGE_RATES.length; i++) {
      if (RULES.EXCHANGE_RATES[i].id === id) return RULES.EXCHANGE_RATES[i];
    }
    return null;
  }

  /**
   * Jedna wymiana na turę (przed rzutem) albo null.
   * Priorytety: domknięcie kompletu → ochrona psami → budowa drabinki w górę.
   */
  function chooseExchange(herd, stock) {
    var t;
    var can = function (id, dir, times) {
      var r = rateById(id);
      return RULES.canExchange(herd, stock, r, dir, times || 1) ? r : null;
    };

    // 1. Ostatni brakujący do wygranej — bierz natychmiast
    if (herd.horse === 0 && (t = can('c-h', 1))) return { rate: t, dir: 1, times: 1 };
    if (herd.cow === 0 && (t = can('p-c', 1))) return { rate: t, dir: 1, times: 1 };
    if (herd.pig === 0 && (t = can('s-p', 1))) return { rate: t, dir: 1, times: 1 };
    if (herd.sheep === 0 && herd.rabbit >= 7 && (t = can('r-s', 1))) return { rate: t, dir: 1, times: 1 };

    // 2. Mały pies, gdy dużo królików i brak ochrony (nie oddawaj ostatniej owcy, gdy owce trudno odbudować)
    if (herd.smallDog === 0 && herd.rabbit >= 9 && herd.sheep >= 2 && (t = can('s-sd', 1))) {
      return { rate: t, dir: 1, times: 1 };
    }

    // 3. Duży pies, gdy stado ma dużą wartość, a krowa jest „zapasowa”
    var value = herd.sheep * 6 + herd.pig * 12 + herd.rabbit;
    if (herd.bigDog === 0 && herd.cow >= 2 && value >= 18 && (t = can('c-bd', 1))) {
      return { rate: t, dir: 1, times: 1 };
    }

    // 4. Drabinka w górę z nadwyżek (zostawiaj bazę do rozmnażania)
    if (herd.cow >= 3 && herd.horse === 0) { /* obsłużone w 1 */ }
    if (herd.pig >= 4 && (t = can('p-c', 1))) return { rate: t, dir: 1, times: 1 };
    if (herd.sheep >= 4 && (t = can('s-p', 1))) return { rate: t, dir: 1, times: 1 };
    if (herd.rabbit >= 13 && (t = can('r-s', 1))) {
      var times = Math.min(2, RULES.maxTimes(herd, stock, t, 1), Math.floor((herd.rabbit - 6) / 6));
      if (times >= 1) return { rate: t, dir: 1, times: times };
    }

    // 5. Odbuduj bazę królików, jeśli wyzerowana a jest nadmiar owiec
    if (herd.rabbit === 0 && herd.sheep >= 3 && (t = can('r-s', -1))) return { rate: t, dir: -1, times: 1 };

    return null;
  }

  return { chooseExchange: chooseExchange };
})();
