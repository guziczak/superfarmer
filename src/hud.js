/* ============================================================
   SUPERFARMER — HUD (DOM). Global: HUD
   ============================================================ */
var HUD = (function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var cb = {};
  var logItems = [];
  var bannerTimer = null;
  var labelTimer = null;
  var sheetOpen = null;
  var sheetTrigger = null;
  var eventGeneration = 0;
  var gainsTimer = null;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var installPrompt = null;
  var layoutFrame = null;
  var lastLayout = '';
  var sheetIds = ['sheetEx', 'sheetRules', 'sheetMenu', 'sheetLog', 'sheetReadability'];
  var READABILITY_KEY = 'sf3d.readability.v1';
  var readability = { readable: false, scale: 100, calm: false };
  var viewPlayer = 0, cardExpanded = [true, false], currentState = null;
  var lastRollMarkup = '', autoFlow = false;

  try {
    var storedReadability = JSON.parse(localStorage.getItem(READABILITY_KEY) || 'null');
    if (storedReadability && typeof storedReadability === 'object') {
      readability.readable = storedReadability.readable === true;
      if ([100, 125, 150, 200].indexOf(storedReadability.scale) >= 0) readability.scale = storedReadability.scale;
      readability.calm = storedReadability.calm === true;
    }
  } catch (e) {}

  function getReadability() {
    return { readable: readability.readable, scale: readability.scale, calm: readability.calm };
  }

  function readableLayout() { return document.documentElement.dataset.readable === 'true'; }

  function syncReadabilityRoot() {
    var root = document.documentElement;
    var flow = autoFlow || readability.readable || readability.scale > 100 || window.innerWidth < 350 || window.innerHeight < 600;
    root.dataset.readable = String(flow);
    root.dataset.uiScale = String(readability.scale);
    root.style.setProperty('--ui-scale', String(readability.scale / 100));
  }
  // Apply a saved layout before DiceScene measures its canvas on first boot.
  syncReadabilityRoot();

  function syncCardExpansion() {
    for (var i = 0; i < 2; i++) {
      var card = $('pcard' + i);
      if (!card) continue;
      var expanded = !readableLayout() || cardExpanded[i];
      card.classList.toggle('collapsed', !expanded);
      var toggle = card.querySelector('.pcard-toggle');
      if (toggle) {
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.setAttribute('aria-disabled', String(!readableLayout()));
        var mark = toggle.querySelector('.pcard-expand');
        if (mark) mark.textContent = expanded ? '−' : '+';
      }
    }
  }

  function setViewPlayer(player) {
    viewPlayer = player === 0 || player === 1 ? player : null;
    cardExpanded = viewPlayer === null ? [true, true] : [viewPlayer === 0, viewPlayer === 1];
    syncCardExpansion();
  }

  function syncReadabilityControls() {
    if ($('readableLayout')) $('readableLayout').checked = readability.readable;
    if ($('readabilityScale')) $('readabilityScale').value = String(readability.scale);
    if ($('readabilityCalm')) $('readabilityCalm').checked = readability.calm;
    if ($('readabilityNotice')) $('readabilityNotice').textContent = currentState && currentState.mode === 'net'
      ? 'W grze na dwóch urządzeniach tury przechodzą automatycznie. Wyniki obu graczy pozostają dostępne.'
      : 'Ustawienia czytelności są zapamiętywane na tym urządzeniu.';
  }

  function updateReadability() {
    autoFlow = false;
    readability.readable = $('readableLayout').checked;
    var scale = Number($('readabilityScale').value);
    readability.scale = [100, 125, 150, 200].indexOf(scale) >= 0 ? scale : 100;
    readability.calm = $('readabilityCalm').checked;
    try { localStorage.setItem(READABILITY_KEY, JSON.stringify(readability)); } catch (e) {}
    syncReadabilityRoot();
    syncCardExpansion();
    if (typeof cb.onReadabilityChange === 'function') cb.onReadabilityChange(getReadability());
    queueLayout();
  }

  function openReadability() {
    syncReadabilityControls();
    openSheet('sheetReadability');
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function syncFocusLayers() {
    var start = $('startov'), win = $('winov');
    var startOn = start.classList.contains('show'), winOn = win.classList.contains('show');
    start.inert = !!sheetOpen || !startOn;
    win.inert = !!sheetOpen || !winOn;
    $('hud').inert = !!sheetOpen || startOn || winOn;
    start.setAttribute('aria-hidden', String(!startOn));
    win.setAttribute('aria-hidden', String(!winOn));
  }

  function resetTransient() {
    eventGeneration++;
    clearTimeout(bannerTimer); clearTimeout(labelTimer); clearTimeout(gainsTimer);
    ['banner', 'dl0', 'dl1', 'swipehint', 'eventbig'].forEach(function (id) { $(id).classList.remove('show'); });
    $('gains').textContent = '';
    $('flash').className = '';
    cancelAnimationFrame(confettiRAF);
    var canvas = $('confetti');
    var context = canvas.getContext('2d');
    if (context) context.clearRect(0, 0, canvas.width, canvas.height);
  }

  function spr(sym, px) { return SYMBOLS.sprite(sym, px || 26); }
  function img(sym, px, decorative) { return '<img alt="' + (decorative ? '' : SYMBOLS.NAMES_PL[sym][0]) + '" src="' + spr(sym, px) + '">'; }

  /* ---------- obciążone kostki (tryb zaawansowany) ----------
     Suwak = POŁOŻENIE środka ciężkości wzdłuż osi drapieżnik↔ścianka przeciwległa:
     0 = środek kostki, +100% = na płaszczyźnie ścianki drapieżnika, −100% = przeciwnej.
     Prawdopodobieństwa z kalibracji dev/bias-sim.mjs (RARE: ciężarek ku drapieżnikowi;
     OFTEN — z symetrii środkowej bryły — ku przeciwnej). */
  var W_RARE = [[0, 8.33], [0.15, 4.6], [0.3, 4.3], [0.5, 2.2], [0.75, 1.5], [1, 1.3]];
  var W_OFTEN = [[0, 8.33], [0.15, 16.8], [0.3, 23.2], [0.5, 55.3], [0.75, 98.5], [1, 98.7]];
  var S_RARE = [[0, 8.33], [0.25, 3.6], [0.58, 0.96], [1, 0.36]];
  var S_OFTEN = [[0, 8.33], [0.6, 18.8], [1, 25.3]];
  var BMODE = 'w';

  function biasPct(m, e) {
    var t = e >= 0 ? (m === 's' ? S_RARE : W_RARE) : (m === 's' ? S_OFTEN : W_OFTEN);
    var x = Math.min(1, Math.abs(e));
    for (var i = 1; i < t.length; i++) {
      if (x <= t[i][0]) {
        var f = (x - t[i - 1][0]) / (t[i][0] - t[i - 1][0]);
        return t[i - 1][1] + f * (t[i][1] - t[i - 1][1]);
      }
    }
    return t[t.length - 1][1];
  }
  function fmtPct(p) { return '~' + p.toFixed(1).replace('.', ',') + '%'; }
  function fmtPos(e) { var v = Math.round(e * 100); return (v > 0 ? '+' : '') + v + '%'; }
  function sliderToE(v) { return v / 100; }
  function eToSlider(e) { return Math.round(e * 100); }
  function currentBias() { return { m: BMODE, v: [sliderToE(+$('biasA').value), sliderToE(+$('biasB').value)] }; }
  function refreshBiasUI() {
    var b = currentBias();
    $('biasPctA').textContent = fmtPos(b.v[0]);
    $('biasPctB').textContent = fmtPos(b.v[1]);
    $('biasSubA').textContent = 'wilk wypada ' + fmtPct(biasPct(b.m, b.v[0]));
    $('biasSubB').textContent = 'lis wypada ' + fmtPct(biasPct(b.m, b.v[1]));
    var endsW = function (who) { return '<span>−100% naprzeciw</span><span>+100% przy ' + who + '</span>'; };
    var endsS = '<span>−100% · częściej</span><span>+100% · rzadziej</span>';
    $('biasEndsA').innerHTML = b.m === 's' ? endsS : endsW('wilku');
    $('biasEndsB').innerHTML = b.m === 's' ? endsS : endsW('lisie');
    if (cb.onBiasPreview) cb.onBiasPreview(b);
  }
  function setBiasMode(m) {
    BMODE = m === 's' ? 's' : 'w';
    var rows = $('segMode').querySelectorAll('button');
    for (var i = 0; i < rows.length; i++) {
      var selected = rows[i].getAttribute('data-m') === BMODE;
      rows[i].classList.toggle('on', selected);
      rows[i].setAttribute('aria-pressed', String(selected));
    }
    refreshBiasUI();
  }
  function biasMenuText(S) {
    var b = S && S.bias ? S.bias : null;
    var m = 'w', v = [0, 0];
    if (b && b.length === 2) v = b;
    else if (b && b.v) { m = b.m === 's' ? 's' : 'w'; v = b.v; }
    if (!v[0] && !v[1]) return 'uczciwe';
    return (m === 's' ? 'szlif: ' : 'ciężarek: ') +
      'wilk ' + fmtPct(biasPct(m, v[0])) + ' · lis ' + fmtPct(biasPct(m, v[1]));
  }

  /* ---------- karty graczy ---------- */
  function buildCards(S) {
    resetTransient();
    currentState = S;
    lastRollMarkup = '';
    cardExpanded = viewPlayer === null ? [true, true] : [viewPlayer === 0, viewPlayer === 1];
    var tb = $('topbar');
    tb.innerHTML = '';
    var round = document.createElement('div');
    round.id = 'roundbadge';
    round.className = 'roundbadge';
    tb.appendChild(round);
    var turn = document.createElement('div');
    turn.id = 'turnbadge';
    turn.className = 'turnbadge';
    turn.setAttribute('role', 'status');
    turn.setAttribute('aria-live', 'polite');
    turn.setAttribute('aria-atomic', 'true');
    tb.appendChild(turn);
    logItems = [];
    for (var i = 0; i < S.players.length; i++) {
      var p = S.players[i];
      var card = document.createElement('div');
      card.className = 'pcard p' + i;
      card.id = 'pcard' + i;
      card.setAttribute('role', 'group');
      var chips = '';
      for (var a = 0; a < RULES.ANIMALS.length; a++) {
        var an = RULES.ANIMALS[a];
        chips += '<div class="chip" role="img" data-a="' + an + '" aria-label="' + esc(SYMBOLS.NAMES_PL[an][0]) + ': 0">' + img(an, 88, true) +
          '<div class="cnt">0</div><span class="chip-label">' + esc(SYMBOLS.NAMES_PL[an][0]) + '</span></div>';
      }
      card.innerHTML =
        '<div class="prow"><button type="button" class="pcard-toggle" aria-controls="herd' + i + '">' +
        '<span class="pdot" aria-hidden="true"></span><span class="pname"></span><span class="pcard-expand" aria-hidden="true"></span></button>' +
        '<span class="goal-count"><span class="goal-prefix">Gatunki: </span><span class="goal-value">0</span><span class="goal-suffix"> z 5</span></span></div>' +
        '<div class="chips" id="herd' + i + '">' + chips + '</div>' +
        '<div class="pgoal"><span class="goal-track" aria-hidden="true"><span class="goal-fill"></span></span></div>';
      card.querySelector('.pname').textContent = p.name;
      (function (index, button) {
        button.addEventListener('click', function () {
          if (!readableLayout()) return;
          cardExpanded[index] = !cardExpanded[index];
          syncCardExpansion();
          queueLayout();
        });
      })(i, card.querySelector('.pcard-toggle'));
      tb.appendChild(card);
    }
    syncCardExpansion();
    showLastRolls(S);
    queueLayout();
  }

  function refresh(S, fx) {
    currentState = S;
    var tb = $('topbar');
    if ($('roundbadge')) {
      $('roundbadge').textContent = 'Runda ' + S.turnCount;
      $('roundbadge').title = S.mode === 'solo' ? 'Ty i Zenek' : S.mode === 'net' ? 'Wspólna gra' : 'Przy jednym stole';
    }
    tb.classList.toggle('lead0', S.cur === 0);
    tb.classList.toggle('lead1', S.cur === 1);
    var turnText = S.phase === 'gameover' ? 'Koniec gry'
      : S.cur === viewPlayer ? 'Twoja tura' : 'Tura: ' + S.players[S.cur].name;
    if ($('turnbadge') && $('turnbadge').textContent !== turnText) $('turnbadge').textContent = turnText;
    for (var i = 0; i < S.players.length; i++) {
      var p = S.players[i];
      var card = $('pcard' + i);
      if (!card) continue;
      var complete = RULES.WIN_ANIMALS.filter(function (animal) { return p.herd[animal] > 0; }).length;
      var goalCount = card.querySelector('.goal-count');
      goalCount.querySelector('.goal-value').textContent = complete;
      goalCount.title = complete + ' z 5 gatunków do wygranej';
      goalCount.setAttribute('aria-label', goalCount.title);
      card.querySelector('.goal-fill').style.width = (complete * 20) + '%';
      card.setAttribute('aria-label', p.name + ', ' + complete + ' z 5 gatunków do wygranej' + (S.cur === i ? ', teraz gra' : ''));
      card.classList.toggle('active', S.cur === i && S.phase !== 'gameover');
      var chips = card.querySelectorAll('.chip');
      for (var c = 0; c < chips.length; c++) {
        var el = chips[c];
        var an = el.getAttribute('data-a');
        var n = p.herd[an];
        el.querySelector('.cnt').textContent = n;
        el.setAttribute('title', SYMBOLS.NAMES_PL[an][0] + ': ' + n);
        el.setAttribute('aria-label', SYMBOLS.NAMES_PL[an][0] + ': ' + n);
        el.classList.toggle('zero', n === 0);
        var isWin = RULES.WIN_ANIMALS.indexOf(an) >= 0;
        el.classList.toggle('req', isWin && n === 0);
        if (fx && fx.player === i && fx.anim && fx.anim[an]) {
          var cls = fx.anim[an] > 0 ? 'pulse' : 'hurt';
          el.classList.remove('pulse', 'hurt');
          void el.offsetWidth;
          el.classList.add(cls);
        }
      }
    }
    showLastRolls(S);
    queueLayout();
  }

  /* ---------- stałe wyniki, osobno dla każdego gracza ---------- */
  function rollEffect(record) {
    var parts = [], gain = [];
    (record.events || []).forEach(function (event) {
      if (event.t === 'fox') parts.push(event.saved ? 'Mały pies przegonił lisa i wrócił do Stada Głównego.'
        : event.lost ? 'Lis zabrał ' + event.lost + ' ' + SYMBOLS.plural('rabbit', event.lost) + '.'
        : 'Lis nie zabrał żadnego królika.');
      if (event.t === 'wolf') parts.push(event.saved ? 'Duży pies przegonił wilka i wrócił do Stada Głównego.'
        : event.total ? 'Wilk zabrał zwierzęta: ' + Object.keys(event.eaten).filter(function (animal) { return event.eaten[animal] > 0; })
          .map(function (animal) { return event.eaten[animal] + ' ' + SYMBOLS.plural(animal, event.eaten[animal]); }).join(', ') + '.'
        : 'Wilk nie zabrał żadnego zwierzęcia.');
      if (event.t === 'gain' && event.n > 0) gain.push('+' + event.n + ' ' + SYMBOLS.plural(event.animal, event.n));
    });
    parts.push(gain.length ? 'Przychówek: ' + gain.join(', ') + '.' : 'Bez przychówku.');
    if ((record.events || []).some(function (event) { return event.t === 'gain' && event.capped; })) {
      parts.push('Przychówek ograniczył zapas Stada Głównego.');
    }
    return parts.join(' ');
  }

  function showLastRolls(S, announcePlayer) {
    currentState = S;
    var container = $('lastRollList');
    if (!container || !S) return;
    var records = S.lastRolls || [null, null];
    var html = S.players.map(function (player, index) {
      var record = records[index];
      var owner = esc(player.name) + (record ? ' · runda ' + record.turn : '');
      return '<section class="last-roll" aria-label="Ostatni rzut: ' + esc(player.name) + '">' +
        '<div class="last-roll-owner">' + owner + '</div>' +
        (record ? '<div class="last-roll-faces">' + record.faces.map(function (symbol) {
          return '<span>' + img(symbol, 64, true) + '<span>' + esc(SYMBOLS.NAMES_PL[symbol][0]) + '</span></span>';
        }).join('<span class="roll-plus" aria-hidden="true">+</span>') + '</div><p class="last-roll-effect">' + esc(rollEffect(record)) + '</p>'
          : '<p class="last-roll-effect">Brak zapisanego rzutu.</p>') + '</section>';
    }).join('');
    if (lastRollMarkup !== html) {
      container.innerHTML = html;
      lastRollMarkup = html;
      queueLayout();
    }
    if ((announcePlayer === 0 || announcePlayer === 1) && records[announcePlayer] && $('rollAnnouncement')) {
      var result = records[announcePlayer];
      $('rollAnnouncement').textContent = S.players[announcePlayer].name + ', runda ' + result.turn + ': ' +
        result.faces.map(function (symbol) { return SYMBOLS.NAMES_PL[symbol][0]; }).join(' i ') + '. ' + rollEffect(result);
    }
  }

  /* ---------- dok ---------- */
  function setDock(mode, o) {
    o = o || {};
    document.documentElement.dataset.phase = mode;
    var dock = $('dock');
    dock.dataset.mode = mode;
    dock.classList.toggle('compact', mode !== 'preroll-human' && mode !== 'await-next');
    dock.classList.toggle('has-notice', mode === 'preroll-human' && !!o.hint);
    var ex = $('btnExchange'), roll = $('btnRoll'), hint = $('hintline');
    var show = function (el, on) { el.style.display = on ? '' : 'none'; };
    show(ex, false); show(roll, false);
    if ($('btnContinue')) $('btnContinue').hidden = mode !== 'await-next';
    hint.textContent = '';
    if (mode === 'preroll-human') {
      show(ex, true); show(roll, true);
      ex.disabled = !!o.exchangeUsed;
      ex.textContent = o.exchangeUsed ? 'Wymiana ✓' : 'Wymiana';
      roll.disabled = false;
      hint.textContent = o.hint || 'Przesuń kości lub wybierz „Rzuć”.';
    } else if (mode === 'rolling') {
      hint.textContent = 'Kostki w locie…';
    } else if (mode === 'held') {
      hint.textContent = 'Puść, żeby rzucić!';
    } else if (mode === 'bot') {
      hint.textContent = o.text || 'Zenek myśli…';
    } else if (mode === 'resolving') {
      hint.textContent = 'Liczymy przychówek…';
    } else if (mode === 'await-next') {
      hint.textContent = 'Wynik zapisany. Wybierz „Dalej”, gdy go przeczytasz.';
    }
    queueLayout();
  }

  /* ---------- baner ---------- */
  function banner(text, cls, ms) {
    var b = $('banner');
    clearTimeout(bannerTimer);
    b.textContent = text;
    b.className = 'display show' + (cls ? ' ' + cls : '');
    bannerTimer = setTimeout(function () { b.classList.remove('show'); }, ms || 1700);
  }

  /* ---------- etykiety kostek ---------- */
  function dieLabels(faces, posFn, ms) {
    clearTimeout(labelTimer);
    var stage = $('tableStage');
    var width = stage ? stage.clientWidth : innerWidth;
    var height = stage ? stage.clientHeight : innerHeight;
    for (var i = 0; i < 2; i++) {
      var el = $('dl' + i);
      if (!faces) { el.classList.remove('show'); continue; }
      var sym = faces[i];
      var pos = posFn(i);
      var bad = (sym === 'wolf' || sym === 'fox');
      el.innerHTML = img(sym, 22, true) + '<span>' + SYMBOLS.NAMES_PL[sym][0] + '</span>';
      el.className = 'dielabel' + (bad ? ' bad' : '');
      var topbarB = readableLayout() ? 0 : $('topbar').getBoundingClientRect().bottom;
      el.style.left = Math.min(Math.max(pos.x, 70), width - 70) + 'px';
      el.style.top = Math.min(height - 8, Math.max(pos.y, topbarB + 64)) + 'px';
      void el.offsetWidth;
      el.classList.add('show');
    }
    if (faces) {
      labelTimer = setTimeout(function () {
        $('dl0').classList.remove('show');
        $('dl1').classList.remove('show');
      }, ms || 2600);
    }
  }

  /* ---------- efekty zdarzeń ---------- */
  function flash(kind) {
    var f = $('flash');
    f.className = '';
    void f.offsetWidth;
    f.className = kind;
  }

  function eventBig(o, ms) {
    return new Promise(function (res) {
      var generation = ++eventGeneration;
      var e = $('eventbig');
      e.innerHTML = (o.icon ? '<img src="' + spr(o.icon, 84) + '" alt="">' : '') +
        '<div class="t1 display">' + esc(o.t1) + '</div>' +
        (o.t2 ? '<div class="t2">' + esc(o.t2) + '</div>' : '');
      e.className = o.cls || '';
      void e.offsetWidth;
      e.classList.add('show');
      setTimeout(function () {
        if (generation !== eventGeneration) { res(); return; }
        e.classList.remove('show');
        setTimeout(res, 240);
      }, ms || 1700);
    });
  }

  function gains(list, ms) {
    clearTimeout(gainsTimer);
    var g = $('gains');
    g.innerHTML = '';
    list.forEach(function (it) {
      var d = document.createElement('div');
      d.className = 'gainchip' + (it.n < 0 ? ' neg' : '');
      d.innerHTML = img(it.sym, 27) + '<span>' + (it.n > 0 ? '+' : '') + it.n + '</span>';
      g.appendChild(d);
    });
    gainsTimer = setTimeout(function () { g.innerHTML = ''; }, ms || 1600);
  }

  /* ---------- feed / log ---------- */
  function feed(entry) {
    logItems.push(entry);
    if (logItems.length > 60) logItems.shift();
    var f = $('feed');
    f.innerHTML = (entry.icon ? img(entry.icon, 20) : '') + '<span></span>';
    f.querySelector('span').textContent = entry.text;
    f.title = entry.text + ' · Otwórz historię gry';
    f.setAttribute('aria-label', entry.text + '. Otwórz historię gry.');
    queueLayout();
  }

  function renderLog() {
    var el = $('logContent');
    if (!logItems.length) { el.innerHTML = '<p class="log-empty">Jeszcze nic się nie wydarzyło.</p>'; return; }
    el.innerHTML = logItems.slice().reverse().map(function (e) {
      return '<div class="logrow"><span class="who p' + (e.who === 1 ? 1 : 0) + '">' + esc(e.whoName) + '</span>' +
        (e.icon ? img(e.icon, 18) : '') + '<span>' + esc(e.text) + '</span></div>';
    }).join('');
  }

  /* ---------- arkusze ---------- */
  function openSheet(name) {
    if (sheetIds.indexOf(name) < 0) return;
    if (!sheetOpen) sheetTrigger = document.activeElement;
    closeSheets(true);
    sheetOpen = name;
    $('backdrop').classList.add('show');
    $(name).classList.add('show');
    $(name).inert = false;
    $(name).setAttribute('aria-hidden', 'false');
    syncFocusLayers();
    var target = $(name).querySelector('.sheet-close') || $(name);
    target.focus({ preventScroll: true });
  }
  function closeSheets(keepBackdrop) {
    sheetIds.forEach(function (id) {
      $(id).classList.remove('show');
      $(id).inert = true;
      $(id).setAttribute('aria-hidden', 'true');
    });
    if (!keepBackdrop) $('backdrop').classList.remove('show');
    sheetOpen = null;
    if (!keepBackdrop) {
      syncFocusLayers();
      if (sheetTrigger && sheetTrigger.isConnected && sheetTrigger.getClientRects().length) sheetTrigger.focus({ preventScroll: true });
      sheetTrigger = null;
    }
  }

  /* ---------- wymiana ---------- */
  function exRowHTML(rate, dir, S) {
    var give = dir > 0 ? rate.give : rate.get;
    var giveN = dir > 0 ? rate.giveN : rate.getN;
    var get = dir > 0 ? rate.get : rate.give;
    var getN = dir > 0 ? rate.getN : rate.giveN;
    var p = S.players[S.cur];
    var ok = RULES.canExchange(p.herd, S.stock, rate, dir, 1);
    return '<button class="exrow" data-r="' + rate.id + '" data-d="' + dir + '" ' + (ok ? '' : 'disabled') + '>' +
      '<span class="side"><span class="n">' + giveN + '×</span><span class="ex-animal">' + img(give, 52, true) + '<span class="animal-label">' + esc(SYMBOLS.NAMES_PL[give][0]) + '</span></span></span>' +
      '<span class="arr">→</span>' +
      '<span class="side"><span class="n">' + getN + '×</span><span class="ex-animal">' + img(get, 52, true) + '<span class="animal-label">' + esc(SYMBOLS.NAMES_PL[get][0]) + '</span></span></span>' +
      '<span class="bank">masz: ' + p.herd[give] + '<br>w stadzie: ' + S.stock[get] + '</span>' +
      '</button>';
  }

  function buildExchange(S) {
    var el = $('exlist');
    var html = '';
    var i;
    for (i = 0; i < RULES.EXCHANGE_RATES.length; i++) html += exRowHTML(RULES.EXCHANGE_RATES[i], 1, S);
    html += '<div class="exsec">W drugą stronę</div>';
    for (i = 0; i < RULES.EXCHANGE_RATES.length; i++) html += exRowHTML(RULES.EXCHANGE_RATES[i], -1, S);
    el.innerHTML = html;
    var rows = el.querySelectorAll('.exrow');
    for (i = 0; i < rows.length; i++) {
      rows[i].addEventListener('click', function () {
        var id = this.getAttribute('data-r');
        var dir = parseInt(this.getAttribute('data-d'), 10);
        var rate = null;
        for (var r = 0; r < RULES.EXCHANGE_RATES.length; r++) {
          if (RULES.EXCHANGE_RATES[r].id === id) rate = RULES.EXCHANGE_RATES[r];
        }
        showStepper(this, rate, dir, S);
      });
    }
  }

  function showStepper(row, rate, dir, S) {
    var old = $('exlist').querySelector('.exstep');
    if (old) old.remove();
    var p = S.players[S.cur];
    var max = RULES.maxTimes(p.herd, S.stock, rate, dir);
    if (max < 1) return;
    var val = 1;
    var st = document.createElement('div');
    st.className = 'exstep';
    st.innerHTML =
      '<button class="stepbtn" data-k="-" aria-label="Zmniejsz liczbę wymian">−</button>' +
      '<div class="val"></div>' +
      '<button class="stepbtn" data-k="+" aria-label="Zwiększ liczbę wymian">+</button>' +
      '<button class="btn pri go">Wymień</button>';
    row.after(st);
    var giveN = dir > 0 ? rate.giveN : rate.getN;
    var getN = dir > 0 ? rate.getN : rate.giveN;
    var giveS = dir > 0 ? rate.give : rate.get;
    var getS = dir > 0 ? rate.get : rate.give;
    var upd = function () {
      st.querySelector('.val').innerHTML = (giveN * val) + '× → <b>' + (getN * val) + '×</b>';
      st.querySelector('[data-k="-"]').disabled = val <= 1;
      st.querySelector('[data-k="+"]').disabled = val >= max;
    };
    st.querySelector('[data-k="-"]').addEventListener('click', function () { val = Math.max(1, val - 1); AUDIO.ui(); upd(); });
    st.querySelector('[data-k="+"]').addEventListener('click', function () { val = Math.min(max, val + 1); AUDIO.ui(); upd(); });
    st.querySelector('.go').addEventListener('click', function () {
      cb.onExchangeApply(rate, dir, val, giveS, getS);
    });
    upd();
    st.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  /* ---------- zasady ---------- */
  function buildRules() {
    var d = function (sym) { return img(sym, 20); };
    var drow = function (sym, n) { return '<div class="drow">' + d(sym) + '<span>' + n + '× ' + SYMBOLS.NAMES_PL[sym][0] + '</span></div>'; };
    $('rulesContent').innerHTML =
      '<p><b>Cel:</b> zbierz w swoim stadzie co najmniej po jednym: ' +
      d('rabbit') + d('sheep') + d('pig') + d('cow') + d('horse') + ' — królika, owcę, świnię, krowę i konia.</p>' +
      '<p><b>Tura:</b> najpierw możesz wykonać <b>jedną wymianę</b> ze Stadem Głównym, potem <b>rzucasz obiema kostkami</b> — przeciągnij palcem po stole i puść.</p>' +
      '<p><b>Rozmnażanie:</b> dla każdego gatunku policz zwierzęta w zagrodzie <b>plus te na kostkach</b> — za każdą pełną <b>parę</b> dostajesz jedno nowe zwierzę. Przykład: masz 3 króliki, na kostce wypadł królik → 4 króliki to 2 pary → dostajesz +2.</p>' +
      '<p><b>' + d('fox') + ' Lis</b> porywa wszystkie króliki. Chroni przed nim ' + d('smallDog') + ' <b>mały pies</b> (wraca wtedy do Stada Głównego).</p>' +
      '<p><b>' + d('wolf') + ' Wilk</b> pożera całe stado oprócz koni i małego psa. Chroni przed nim ' + d('bigDog') + ' <b>duży pies</b> (wraca wtedy do Stada).</p>' +
      '<div class="exsec">Kursy wymiany</div>' +
      '<table>' +
      '<tr><td>6× ' + d('rabbit') + '</td><td>= 1× ' + d('sheep') + '</td></tr>' +
      '<tr><td>2× ' + d('sheep') + '</td><td>= 1× ' + d('pig') + '</td></tr>' +
      '<tr><td>3× ' + d('pig') + '</td><td>= 1× ' + d('cow') + '</td></tr>' +
      '<tr><td>2× ' + d('cow') + '</td><td>= 1× ' + d('horse') + '</td></tr>' +
      '<tr><td>1× ' + d('sheep') + '</td><td>= 1× ' + d('smallDog') + '</td></tr>' +
      '<tr><td>1× ' + d('cow') + '</td><td>= 1× ' + d('bigDog') + '</td></tr>' +
      '</table>' +
      '<div class="exsec">Kostki</div>' +
      '<div class="dice-legend">' +
      '<div class="dcard"><b>Kostka jasna</b>' + drow('rabbit', 6) + drow('sheep', 3) + drow('pig', 1) + drow('cow', 1) + drow('wolf', 1) + '</div>' +
      '<div class="dcard"><b>Kostka złota</b>' + drow('rabbit', 6) + drow('sheep', 2) + drow('pig', 2) + drow('horse', 1) + drow('fox', 1) + '</div>' +
      '</div>' +
      '<p class="rules-note">Pierwszą krowę i konia zdobędziesz tylko wymianą — na kostkach nie ułożysz z nich pary. Stado Główne jest ograniczone: 60 królików, 24 owce, 20 świń, 12 krów, 6 koni, 4 małe psy, 2 duże psy.</p>';
  }

  /* ---------- menu ---------- */
  function buildMenu(S) {
    $('menuContent').innerHTML =
      '<button type="button" class="menurow" id="mReadability"><span>Czytelność</span><span class="state">Aa · ' + readability.scale + '%</span></button>' +
      '<button class="menurow" id="mSound"><span>Dźwięk</span><span class="state">' + (AUDIO.isEnabled() ? 'włączony' : 'wyłączony') + '</span></button>' +
      '<button class="menurow" id="mRules"><span>Zasady gry</span><span class="state">›</span></button>' +
      '<button class="menurow" id="mLog"><span>Historia gry</span><span class="state">›</span></button>' +
      '<div class="menurow static"><span>Kostki</span><span class="state">' + biasMenuText(S) + '</span></div>' +
      '<button class="menurow" id="mInstall"' + (installPrompt ? '' : ' hidden') + '><span>Dodaj grę do urządzenia</span><span class="state">↗</span></button>' +
      '<button class="menurow" id="mBack"><span>' + (S && S.mode === 'net' ? 'Opuść grę' : 'Zapisz i wróć do menu') + '</span><span class="state">↗</span></button>' +
      '<button class="menurow" id="mRestart"><span>Nowa gra</span><span class="state">od początku</span></button>';
    $('mReadability').addEventListener('click', openReadability);
    $('mSound').addEventListener('click', function () {
      cb.onSoundToggle();
      buildMenu(S);
    });
    $('mRules').addEventListener('click', function () { openSheet('sheetRules'); });
    $('mLog').addEventListener('click', function () { renderLog(); openSheet('sheetLog'); });
    $('mBack').addEventListener('click', function () { closeSheets(); cb.onBackToMenu(); });
    $('mInstall').addEventListener('click', function () {
      if (!installPrompt) return;
      var prompt = installPrompt;
      prompt.prompt().then(function () { return prompt.userChoice; }).then(function () {
        installPrompt = null;
        if ($('mInstall')) $('mInstall').hidden = true;
      }).catch(function () {});
    });
    $('mRestart').addEventListener('click', function () {
      if (!this.dataset.confirm) {
        this.dataset.confirm = '1';
        this.querySelector('span').textContent = 'Zacząć od nowa?';
        this.querySelector('.state').textContent = 'Kliknij, aby potwierdzić';
        return;
      }
      closeSheets(); cb.onRestart();
    });
  }

  /* ---------- start / wygrana ---------- */
  function showStart(o) {
    resetTransient();
    currentState = null;
    $('startov').classList.remove('compact');
    $('btnResume').hidden = !o.canResume;
    if (o.canResume && o.resumeLabel) $('btnResume').textContent = o.resumeLabel;
    var nr0 = $('btnNetResume0');
    nr0.hidden = !o.netResume;
    if (o.netResume) nr0.textContent = '📶 Wznów przez sieć: ' + o.netResume;
    $('biasA').value = 0;
    $('biasB').value = 0;
    setBiasMode('w');
    $('advpanel').hidden = true;
    $('btnSound0').textContent = AUDIO.isEnabled() ? 'Dźwięk: wł.' : 'Dźwięk: wył.';
    $('btnSound0').setAttribute('aria-pressed', String(AUDIO.isEnabled()));
    $('btnAdv').setAttribute('aria-expanded', 'false');
    $('modeButtons').hidden = false;
    $('nameform').hidden = true;
    $('netform').hidden = true;
    $('netconn').hidden = true;
    $('btnNet').hidden = !(typeof NET !== 'undefined' && NET.available());
    var nr = $('btnNetResume');
    nr.hidden = !o.netResume;
    if (o.netResume) nr.textContent = 'Wznów: ' + o.netResume;
    if (o.netName) $('inpNetName').value = o.netName;
    else if (o.names && !$('inpNetName').value) $('inpNetName').value = o.names[0] || '';
    if (o.names) {
      $('inpName1').value = o.names[0] || '';
      $('inpName2').value = o.names[1] || '';
    }
    $('startov').classList.add('show');
    syncFocusLayers();
  }
  function hideStart() { $('startov').classList.remove('show'); syncFocusLayers(); }

  function showWin(o) {
    $('winEyebrow').textContent = o.eyebrow;
    $('winTitle').textContent = o.title;
    $('winSub').textContent = o.sub;
    $('winStats').innerHTML = o.stats.map(function (s) {
      return '<div class="stat"><div class="v">' + s.v + '</div><div class="l">' + s.l + '</div></div>';
    }).join('');
    $('winov').classList.add('show');
    syncFocusLayers();
    $('btnAgain').focus({ preventScroll: true });
  }
  function hideWin() { $('winov').classList.remove('show'); syncFocusLayers(); }

  function compatibilityMode(on) {
    var note = $('compatNote');
    if (!note) {
      note = document.createElement('div');
      note.id = 'compatNote'; note.className = 'compat-note';
      note.textContent = 'Widok 2D · pełna fizyka';
      note.title = 'Ta przeglądarka korzysta z widoku zgodności. Zasady i fizyka kostek pozostają takie same.';
      $('tableStage').appendChild(note);
    }
    note.hidden = !on;
  }

  /* ---------- konfetti z sylwetek ---------- */
  var confettiRAF = null;
  function confetti(atlas) {
    var cv = $('confetti');
    var ctx = cv.getContext('2d');
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    var parts = [];
    var cells = SYMBOLS.ORDER;
    for (var i = 0; i < 90; i++) {
      var sym = cells[Math.floor(Math.random() * cells.length)];
      var c = SYMBOLS.cellOf(sym);
      parts.push({
        x: Math.random() * cv.width,
        y: -Math.random() * cv.height * 0.5 - 40,
        vx: (Math.random() - 0.5) * 90 * dpr,
        vy: (140 + Math.random() * 200) * dpr,
        rot: Math.random() * 7,
        vr: (Math.random() - 0.5) * 5,
        s: (26 + Math.random() * 26) * dpr,
        col: c.col, row: c.row
      });
    }
    var cellW = atlas.width / SYMBOLS.GRID_X, cellH = atlas.height / SYMBOLS.GRID_Y;
    var t0 = performance.now(), last = t0;
    cancelAnimationFrame(confettiRAF);
    var step = function (now) {
      var dt = Math.min(0.04, (now - last) / 1000); last = now;
      ctx.clearRect(0, 0, cv.width, cv.height);
      var alive = false;
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        p.vy += 60 * dpr * dt;
        if (p.y < cv.height + 80) alive = true;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.drawImage(atlas, p.col * cellW, p.row * cellH, cellW, cellH, -p.s / 2, -p.s / 2, p.s, p.s);
        ctx.restore();
      }
      if (alive && now - t0 < 6000) confettiRAF = requestAnimationFrame(step);
      else ctx.clearRect(0, 0, cv.width, cv.height);
    };
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce) confettiRAF = requestAnimationFrame(step);
  }

  /* ---------- init ---------- */
  function init(callbacks) {
    cb = callbacks;
    syncReadabilityRoot();
    syncReadabilityControls();
    ['btnReadability', 'btnReadability0'].forEach(function (id) {
      $(id).addEventListener('click', function () { AUDIO.ui(); openReadability(); });
    });
    ['readableLayout', 'readabilityScale', 'readabilityCalm'].forEach(function (id) {
      $(id).addEventListener('change', updateReadability);
    });
    $('btnContinue').addEventListener('click', function () {
      if (typeof cb.onContinue === 'function') cb.onContinue();
    });
    var heroRabbit = $('heroRabbit'), heroSheep = $('heroSheep');
    if (heroRabbit) heroRabbit.setAttribute('href', spr('rabbit', 96));
    if (heroSheep) heroSheep.setAttribute('href', spr('sheep', 96));
    buildRules();
    // Changes to the HUD report real bounds; the scene decides when it is safe
    // to apply them, so shrinking the dock never moves a die during a throw.
    if (window.ResizeObserver) {
      var layoutObserver = new ResizeObserver(queueLayout);
      layoutObserver.observe($('topbar'));
      layoutObserver.observe($('dock'));
      layoutObserver.observe($('tableStage'));
    }
    window.addEventListener('resize', function () {
      autoFlow = false;
      syncReadabilityRoot();
      syncCardExpansion();
      queueLayout();
    });
    queueLayout();
    window.addEventListener('beforeinstallprompt', function (event) {
      event.preventDefault(); installPrompt = event;
      if ($('mInstall')) $('mInstall').hidden = false;
    });
    window.addEventListener('appinstalled', function () {
      installPrompt = null;
      if ($('mInstall')) $('mInstall').hidden = true;
    });
    $('hintline').setAttribute('role', 'status');
    $('hintline').setAttribute('aria-live', 'polite');
    $('eventbig').setAttribute('role', 'status');
    $('eventbig').setAttribute('aria-live', 'polite');
    $('banner').setAttribute('aria-live', 'polite');
    sheetIds.forEach(function (id) {
      $(id).inert = true;
      $(id).setAttribute('aria-hidden', 'true');
      $(id).setAttribute('aria-modal', 'true');
      $(id).setAttribute('tabindex', '-1');
    });
    document.querySelectorAll('[data-close-sheet]').forEach(function (button) {
      button.addEventListener('click', function () { closeSheets(); });
    });
    document.addEventListener('keydown', function (e) {
      if (!sheetOpen) return;
      if (e.key === 'Escape') { e.preventDefault(); closeSheets(); return; }
      if (e.key !== 'Tab') return;
      var nodes = Array.prototype.filter.call($(sheetOpen).querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]'), function (el) { return el.getClientRects().length; });
      if (!nodes.length) { e.preventDefault(); $(sheetOpen).focus(); return; }
      var first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === $(sheetOpen))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    $('btnRoll').addEventListener('click', function () { cb.onRollClick(); });
    $('btnExchange').addEventListener('click', function () { cb.onExchangeOpen(); });
    $('btnMenu').addEventListener('click', function () { cb.onMenuOpen(); });
    $('feed').addEventListener('click', function () { renderLog(); openSheet('sheetLog'); AUDIO.ui(); });
    $('backdrop').addEventListener('click', function () { closeSheets(); });
    $('btnAdv').addEventListener('click', function () {
      AUDIO.ui();
      var p = $('advpanel');
      p.hidden = !p.hidden;
      $('btnAdv').setAttribute('aria-expanded', String(!p.hidden));
      if (!p.hidden) refreshBiasUI();
    });
    $('biasA').addEventListener('input', refreshBiasUI);
    $('biasB').addEventListener('input', refreshBiasUI);
    $('segMode').addEventListener('click', function (ev) {
      var btn = ev.target.closest('button');
      if (!btn) return;
      AUDIO.ui();
      setBiasMode(btn.getAttribute('data-m'));
    });
    $('btnSolo').addEventListener('click', function () { cb.onModeStart('solo', null, currentBias()); });
    $('btnDuo').addEventListener('click', function () {
      AUDIO.ui();
      $('modeButtons').hidden = true;
      $('nameform').hidden = false;
      $('inpName1').focus();
    });
    $('btnDuoBack').addEventListener('click', function () {
      $('nameform').hidden = true;
      $('modeButtons').hidden = false;
    });
    $('btnNet').addEventListener('click', function () {
      AUDIO.ui();
      $('startov').classList.add('compact');
      $('modeButtons').hidden = true;
      $('netform').hidden = false;
      // Android zdradza typ łącza; iOS nie ma tego API (wtedy zostaje stała podpowiedź niżej)
      var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      $('netWarn').hidden = !(conn && conn.type === 'cellular');
    });
    $('btnNetBack').addEventListener('click', function () {
      $('netform').hidden = true;
      $('modeButtons').hidden = false;
      $('startov').classList.remove('compact');
    });
    $('btnNetResume').addEventListener('click', function () { AUDIO.ui(); cb.onNetResume(); });
    $('btnNetResume0').addEventListener('click', function () { AUDIO.ui(); cb.onNetResume(); });
    $('btnNetHost').addEventListener('click', function () { AUDIO.ui(); cb.onNetHost($('inpNetName').value.trim(), currentBias()); });
    $('btnNetJoin').addEventListener('click', function () { AUDIO.ui(); cb.onNetJoin($('inpNetName').value.trim()); });
    $('btnNetCancel').addEventListener('click', function () { AUDIO.ui(); cb.onNetCancel(); });
    $('qrOut').addEventListener('click', function () {
      $('qrOut').classList.toggle('big');
      $('qrOut').setAttribute('aria-expanded', String($('qrOut').classList.contains('big')));
    });
    $('qrOut').addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('qrOut').click(); }
    });
    $('btnNetPaste').addEventListener('click', function () {
      AUDIO.ui();
      $('pasteWrap').hidden = !$('pasteWrap').hidden;
    });
    $('btnPasteGo').addEventListener('click', function () { AUDIO.ui(); NET.acceptPeerCode($('pasteIn').value); });
    $('btnCopyCode').addEventListener('click', function () {
      var el = $('myCode');
      var button = $('btnCopyCode');
      el.focus();
      el.select();
      var fallback = function () {
        try { if (document.execCommand('copy')) return Promise.resolve(); } catch (e) {}
        return Promise.reject(new Error('copy'));
      };
      var copy;
      try { copy = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(el.value).catch(fallback) : fallback(); }
      catch (e) { copy = fallback(); }
      copy.then(function () {
        button.textContent = 'Skopiowano ✓';
        setTimeout(function () { button.textContent = 'Kopiuj mój kod'; }, 1800);
      }).catch(function () { $('netStatus').textContent = 'Kod zaznaczony — skopiuj go ręcznie.'; });
      AUDIO.ui();
    });
    var duoGo = function () {
      cb.onModeStart('duo', [$('inpName1').value.trim(), $('inpName2').value.trim()], currentBias());
    };
    $('btnDuoGo').addEventListener('click', duoGo);
    $('inpName1').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('inpName2').focus(); });
    $('inpName2').addEventListener('keydown', function (e) { if (e.key === 'Enter') duoGo(); });
    $('btnResume').addEventListener('click', function () { cb.onResume(); });
    $('btnRules0').addEventListener('click', function () { openSheet('sheetRules'); AUDIO.ui(); });
    $('btnSound0').addEventListener('click', function () {
      cb.onSoundToggle();
      $('btnSound0').textContent = AUDIO.isEnabled() ? 'Dźwięk: wł.' : 'Dźwięk: wył.';
      $('btnSound0').setAttribute('aria-pressed', String(AUDIO.isEnabled()));
    });
    $('btnAgain').addEventListener('click', function () { cb.onAgain(); });
    $('btnMenuBack').addEventListener('click', function () { cb.onBackToMenu(); });
  }

  function swipeHint(on) {
    $('swipehint').classList.toggle('show', !!on);
  }

  /** Kropka „online” (gra przez sieć): 'on' = zielona, 'off' = czerwona „łączę…”, null = schowana. */
  function netDot(state) {
    var el = $('netdot');
    if (!state) { el.hidden = true; return; }
    el.hidden = false;
    el.classList.toggle('bad', state === 'off');
    $('netdotTxt').textContent = state === 'off' ? 'łączę…' : 'online';
  }

  function measureInsets() {
    // In the readable layout, the 3D canvas has its own place in document flow.
    // Text panels can grow and scroll without covering the rendered table.
    if (readableLayout()) return { top: 8, right: 8, bottom: 8, left: 8 };
    var top = $('topbar').getBoundingClientRect();
    var dock = $('dock').getBoundingClientRect();
    // A small breathing space is enough with the thinner tray rim. Reserve only
    // what is actually visible; compact/remote states do not need a phantom row.
    return {
      top: Math.max(0, Math.ceil(top.bottom)) + 10,
      right: 0,
      bottom: Math.max(0, Math.ceil(window.innerHeight - dock.top)) + 8,
      left: 0
    };
  }

  function queueLayout() {
    if (layoutFrame !== null) return;
    layoutFrame = requestAnimationFrame(function () {
      layoutFrame = null;
      var insets = measureInsets();
      if (!readableLayout() && window.innerHeight - insets.top - insets.bottom < 240) {
        autoFlow = true;
        syncReadabilityRoot();
        syncCardExpansion();
        insets = measureInsets();
      }
      var canvas = $('scene3d');
      var key = [insets.top, insets.right, insets.bottom, insets.left, canvas.clientWidth, canvas.clientHeight, readableLayout()].join(':');
      document.documentElement.style.setProperty('--hud-top', insets.top + 'px');
      document.documentElement.style.setProperty('--hud-bottom', insets.bottom + 'px');
      if (key === lastLayout) return;
      lastLayout = key;
      if (typeof cb.onLayoutChange === 'function') cb.onLayoutChange(insets);
      window.dispatchEvent(new CustomEvent('superfarmer:layout', { detail: insets }));
    });
  }

  return {
    init: init,
    buildCards: buildCards,
    refresh: refresh,
    setDock: setDock,
    getReadability: getReadability,
    setViewPlayer: setViewPlayer,
    showLastRolls: showLastRolls,
    banner: banner,
    dieLabels: dieLabels,
    flash: flash,
    eventBig: eventBig,
    gains: gains,
    feed: feed,
    renderLog: renderLog,
    openSheet: openSheet,
    closeSheets: closeSheets,
    buildExchange: buildExchange,
    buildMenu: buildMenu,
    showStart: showStart,
    hideStart: hideStart,
    showWin: showWin,
    hideWin: hideWin,
    confetti: confetti,
    swipeHint: swipeHint,
    netDot: netDot,
    measureInsets: measureInsets,
    compatibilityMode: compatibilityMode
  };
})();
