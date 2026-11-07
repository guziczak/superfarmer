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
  var sheetIds = ['sheetEx', 'sheetRules', 'sheetMenu', 'sheetLog'];

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
  function img(sym, px) { return '<img alt="' + SYMBOLS.NAMES_PL[sym][0] + '" src="' + spr(sym, px) + '">'; }

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
    var tb = $('topbar');
    tb.innerHTML = '';
    var round = document.createElement('div');
    round.id = 'roundbadge';
    round.className = 'roundbadge';
    tb.appendChild(round);
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
        chips += '<div class="chip" data-a="' + an + '">' + img(an, 26) + '<div class="cnt">0</div></div>';
      }
      card.innerHTML =
        '<div class="prow"><div class="pdot" aria-hidden="true"></div><div class="pname"></div></div>' +
        '<div class="chips">' + chips + '</div>' +
        '<div class="pgoal"><span class="goal-count"></span><span class="goal-track" aria-hidden="true"><span class="goal-fill"></span></span></div>';
      card.querySelector('.pname').textContent = p.name;
      tb.appendChild(card);
    }
  }

  function refresh(S, fx) {
    var tb = $('topbar');
    if ($('roundbadge')) $('roundbadge').textContent = 'Runda ' + S.turnCount + ' · ' + (S.mode === 'solo' ? 'Ty i Zenek' : S.mode === 'net' ? 'Wspólna gra' : 'Przy jednym stole');
    tb.classList.toggle('lead0', S.cur === 0);
    tb.classList.toggle('lead1', S.cur === 1);
    for (var i = 0; i < S.players.length; i++) {
      var p = S.players[i];
      var card = $('pcard' + i);
      if (!card) continue;
      var complete = RULES.WIN_ANIMALS.filter(function (animal) { return p.herd[animal] > 0; }).length;
      card.querySelector('.goal-count').textContent = complete + ' z 5 gatunków';
      card.querySelector('.goal-fill').style.width = (complete * 20) + '%';
      card.setAttribute('aria-label', p.name + ', ' + complete + ' z 5 gatunków do wygranej' + (S.cur === i ? ', teraz gra' : ''));
      card.classList.toggle('active', S.cur === i && S.phase !== 'gameover');
      var chips = card.querySelectorAll('.chip');
      for (var c = 0; c < chips.length; c++) {
        var el = chips[c];
        var an = el.getAttribute('data-a');
        var n = p.herd[an];
        el.querySelector('.cnt').textContent = n;
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
  }

  /* ---------- dok ---------- */
  function setDock(mode, o) {
    o = o || {};
    document.documentElement.dataset.phase = mode;
    var ex = $('btnExchange'), roll = $('btnRoll'), hint = $('hintline');
    var show = function (el, on) { el.style.display = on ? '' : 'none'; };
    show(ex, false); show(roll, false);
    hint.textContent = '';
    if (mode === 'preroll-human') {
      show(ex, true); show(roll, true);
      ex.disabled = !!o.exchangeUsed;
      ex.textContent = o.exchangeUsed ? 'Wymiana ✓' : 'Wymiana';
      roll.disabled = false;
      hint.textContent = o.hint || 'Przeciągnij palcem po stole i puść — albo dotknij „Rzuć”.';
    } else if (mode === 'rolling') {
      hint.textContent = 'Kostki w locie…';
    } else if (mode === 'held') {
      hint.textContent = 'Puść, żeby rzucić!';
    } else if (mode === 'bot') {
      hint.textContent = o.text || 'Zenek myśli…';
    } else if (mode === 'resolving') {
      hint.textContent = 'Liczymy przychówek…';
    }
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
    for (var i = 0; i < 2; i++) {
      var el = $('dl' + i);
      if (!faces) { el.classList.remove('show'); continue; }
      var sym = faces[i];
      var pos = posFn(i);
      var bad = (sym === 'wolf' || sym === 'fox');
      el.innerHTML = img(sym, 22) + '<span>' + SYMBOLS.NAMES_PL[sym][0] + '</span>';
      el.className = 'dielabel' + (bad ? ' bad' : '');
      var topbarB = $('topbar').getBoundingClientRect().bottom;
      el.style.left = Math.min(Math.max(pos.x, 70), innerWidth - 70) + 'px';
      el.style.top = Math.max(pos.y, topbarB + 64) + 'px';
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
  }

  function renderLog() {
    var el = $('logContent');
    if (!logItems.length) { el.innerHTML = '<p style="color:var(--cream-faint);font-size:14px;padding:8px">Jeszcze nic się nie wydarzyło.</p>'; return; }
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
      '<span class="side"><span class="n">' + giveN + '×</span>' + img(give, 26) + '</span>' +
      '<span class="arr">→</span>' +
      '<span class="side"><span class="n">' + getN + '×</span>' + img(get, 26) + '</span>' +
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
      '<p style="font-size:12.5px;color:var(--cream-faint)">Pierwszą krowę i konia zdobędziesz tylko wymianą — na kostkach nie ułożysz z nich pary. Stado Główne jest ograniczone: 60 królików, 24 owce, 20 świń, 12 krów, 6 koni, 4 małe psy, 2 duże psy.</p>';
  }

  /* ---------- menu ---------- */
  function buildMenu(S) {
    $('menuContent').innerHTML =
      '<button class="menurow" id="mSound"><span>Dźwięk</span><span class="state">' + (AUDIO.isEnabled() ? 'włączony' : 'wyłączony') + '</span></button>' +
      '<button class="menurow" id="mRules"><span>Zasady gry</span><span class="state">›</span></button>' +
      '<button class="menurow" id="mLog"><span>Historia gry</span><span class="state">›</span></button>' +
      '<div class="menurow static"><span>Kostki</span><span class="state">' + biasMenuText(S) + '</span></div>' +
      '<button class="menurow" id="mInstall"' + (installPrompt ? '' : ' hidden') + '><span>Dodaj grę do urządzenia</span><span class="state">↗</span></button>' +
      '<button class="menurow" id="mBack"><span>' + (S && S.mode === 'net' ? 'Opuść grę' : 'Zapisz i wróć do menu') + '</span><span class="state">↗</span></button>' +
      '<button class="menurow" id="mRestart"><span>Nowa gra</span><span class="state">od początku</span></button>';
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
      $('hud').appendChild(note);
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
    buildRules();
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
    var top = $('topbar').getBoundingClientRect();
    var dock = $('dock').getBoundingClientRect();
    return { top: Math.ceil(top.bottom) + 26, right: 0, bottom: Math.ceil(innerHeight - dock.top) + 6, left: 0 };
  }

  return {
    init: init,
    buildCards: buildCards,
    refresh: refresh,
    setDock: setDock,
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
