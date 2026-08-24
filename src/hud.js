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

  function spr(sym, px) { return SYMBOLS.sprite(sym, px || 26); }
  function img(sym, px) { return '<img alt="' + SYMBOLS.NAMES_PL[sym][0] + '" src="' + spr(sym, px) + '">'; }

  /* ---------- obciążone kostki (tryb zaawansowany) ----------
     Kalibracja z dev/bias-sim.mjs: % drapieżnika na górze przy ciężarku
     KU jego ściance (RARE) i — z symetrii bryły — na ściance przeciwnej (OFTEN). */
  var BIAS_MAX = 0.25;
  var BIAS_RARE = [[0, 8.33], [0.05, 6.7], [0.10, 5.0], [0.15, 5.0], [0.20, 4.5], [0.25, 3.6]];
  var BIAS_OFTEN = [[0, 8.33], [0.05, 11.0], [0.10, 14.7], [0.15, 15.9], [0.20, 19.8], [0.25, 23.4]];

  function biasPct(e) {
    var t = e >= 0 ? BIAS_RARE : BIAS_OFTEN;
    var x = Math.min(BIAS_MAX, Math.abs(e));
    for (var i = 1; i < t.length; i++) {
      if (x <= t[i][0]) {
        var f = (x - t[i - 1][0]) / (t[i][0] - t[i - 1][0]);
        return t[i - 1][1] + f * (t[i][1] - t[i - 1][1]);
      }
    }
    return t[t.length - 1][1];
  }
  function fmtPct(p) { return '~' + p.toFixed(1).replace('.', ',') + '%'; }
  function sliderToE(v) { return -(v / 100) * BIAS_MAX; }
  function eToSlider(e) { return Math.round(-(e / BIAS_MAX) * 100); }
  function currentBias() { return [sliderToE(+$('biasA').value), sliderToE(+$('biasB').value)]; }
  function refreshBiasUI() {
    var b = currentBias();
    $('biasPctA').textContent = fmtPct(biasPct(b[0]));
    $('biasPctB').textContent = fmtPct(biasPct(b[1]));
  }
  function biasMenuText(S) {
    var b = S && S.bias ? S.bias : [0, 0];
    if (!b[0] && !b[1]) return 'uczciwe';
    return 'wilk ' + fmtPct(biasPct(b[0])) + ' · lis ' + fmtPct(biasPct(b[1]));
  }

  /* ---------- karty graczy ---------- */
  function buildCards(S) {
    var tb = $('topbar');
    tb.innerHTML = '';
    for (var i = 0; i < S.players.length; i++) {
      var p = S.players[i];
      var card = document.createElement('div');
      card.className = 'pcard p' + i;
      card.id = 'pcard' + i;
      var chips = '';
      for (var a = 0; a < RULES.ANIMALS.length; a++) {
        var an = RULES.ANIMALS[a];
        chips += '<div class="chip" data-a="' + an + '">' + img(an, 26) + '<div class="cnt">0</div></div>';
      }
      card.innerHTML =
        '<div class="prow"><div class="pdot"></div><div class="pname">' + p.name + '</div></div>' +
        '<div class="chips">' + chips + '</div>';
      tb.appendChild(card);
    }
  }

  function refresh(S, fx) {
    var tb = $('topbar');
    tb.classList.toggle('lead0', S.cur === 0);
    tb.classList.toggle('lead1', S.cur === 1);
    for (var i = 0; i < S.players.length; i++) {
      var p = S.players[i];
      var card = $('pcard' + i);
      if (!card) continue;
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
      var e = $('eventbig');
      e.innerHTML = (o.icon ? '<img src="' + spr(o.icon, 84) + '" alt="">' : '') +
        '<div class="t1 display">' + o.t1 + '</div>' +
        (o.t2 ? '<div class="t2">' + o.t2 + '</div>' : '');
      e.className = o.cls || '';
      void e.offsetWidth;
      e.classList.add('show');
      setTimeout(function () {
        e.classList.remove('show');
        setTimeout(res, 240);
      }, ms || 1700);
    });
  }

  function gains(list, ms) {
    var g = $('gains');
    g.innerHTML = '';
    list.forEach(function (it) {
      var d = document.createElement('div');
      d.className = 'gainchip' + (it.n < 0 ? ' neg' : '');
      d.innerHTML = img(it.sym, 27) + '<span>' + (it.n > 0 ? '+' : '') + it.n + '</span>';
      g.appendChild(d);
    });
    setTimeout(function () { g.innerHTML = ''; }, ms || 1600);
  }

  /* ---------- feed / log ---------- */
  function feed(entry) {
    logItems.push(entry);
    if (logItems.length > 60) logItems.shift();
    var f = $('feed');
    f.innerHTML = (entry.icon ? img(entry.icon, 20) : '') + '<span>' + entry.text + '</span>';
  }

  function renderLog() {
    var el = $('logContent');
    if (!logItems.length) { el.innerHTML = '<p style="color:var(--cream-faint);font-size:14px;padding:8px">Jeszcze nic się nie wydarzyło.</p>'; return; }
    el.innerHTML = logItems.slice().reverse().map(function (e) {
      return '<div class="logrow"><span class="who p' + e.who + '">' + e.whoName + '</span>' +
        (e.icon ? img(e.icon, 18) : '') + '<span>' + e.text + '</span></div>';
    }).join('');
  }

  /* ---------- arkusze ---------- */
  function openSheet(name) {
    closeSheets(true);
    sheetOpen = name;
    $('backdrop').classList.add('show');
    $(name).classList.add('show');
  }
  function closeSheets(keepBackdrop) {
    ['sheetEx', 'sheetRules', 'sheetMenu', 'sheetLog'].forEach(function (id) {
      $(id).classList.remove('show');
    });
    if (!keepBackdrop) $('backdrop').classList.remove('show');
    sheetOpen = null;
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
      '<button class="stepbtn" data-k="-">−</button>' +
      '<div class="val"></div>' +
      '<button class="stepbtn" data-k="+">+</button>' +
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
    st.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
      '<button class="menurow" id="mRestart"><span>Nowa gra</span><span class="state">od początku</span></button>';
    $('mSound').addEventListener('click', function () {
      cb.onSoundToggle();
      buildMenu(S);
    });
    $('mRules').addEventListener('click', function () { openSheet('sheetRules'); });
    $('mLog').addEventListener('click', function () { renderLog(); openSheet('sheetLog'); });
    $('mRestart').addEventListener('click', function () { closeSheets(); cb.onRestart(); });
  }

  /* ---------- start / wygrana ---------- */
  function showStart(o) {
    $('btnResume').hidden = !o.canResume;
    if (o.canResume && o.resumeLabel) $('btnResume').textContent = o.resumeLabel;
    var nr0 = $('btnNetResume0');
    nr0.hidden = !o.netResume;
    if (o.netResume) nr0.textContent = '📶 Wznów przez sieć: ' + o.netResume;
    var b = o.bias && o.bias.length === 2 ? o.bias : [0, 0];
    $('biasA').value = eToSlider(b[0]);
    $('biasB').value = eToSlider(b[1]);
    refreshBiasUI();
    $('advpanel').hidden = !(b[0] || b[1]);
    $('btnSound0').textContent = AUDIO.isEnabled() ? 'Dźwięk: wł.' : 'Dźwięk: wył.';
    $('modeButtons').hidden = false;
    $('nameform').hidden = true;
    $('netform').hidden = true;
    $('netconn').hidden = true;
    $('btnNet').hidden = !(typeof NET !== 'undefined' && NET.available());
    var nr = $('btnNetResume');
    nr.hidden = !o.netResume;
    if (o.netResume) nr.textContent = 'Wznów: ' + o.netResume;
    if (o.names && !$('inpNetName').value) $('inpNetName').value = o.names[0] || '';
    if (o.names) {
      $('inpName1').value = o.names[0] || '';
      $('inpName2').value = o.names[1] || '';
    }
    $('startov').classList.add('show');
  }
  function hideStart() { $('startov').classList.remove('show'); }

  function showWin(o) {
    $('winEyebrow').textContent = o.eyebrow;
    $('winTitle').textContent = o.title;
    $('winSub').textContent = o.sub;
    $('winStats').innerHTML = o.stats.map(function (s) {
      return '<div class="stat"><div class="v">' + s.v + '</div><div class="l">' + s.l + '</div></div>';
    }).join('');
    $('winov').classList.add('show');
  }
  function hideWin() { $('winov').classList.remove('show'); }

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
    $('btnRoll').addEventListener('click', function () { cb.onRollClick(); });
    $('btnExchange').addEventListener('click', function () { cb.onExchangeOpen(); });
    $('btnMenu').addEventListener('click', function () { cb.onMenuOpen(); });
    $('feed').addEventListener('click', function () { renderLog(); openSheet('sheetLog'); AUDIO.ui(); });
    $('backdrop').addEventListener('click', function () { closeSheets(); });
    $('btnAdv').addEventListener('click', function () {
      AUDIO.ui();
      var p = $('advpanel');
      p.hidden = !p.hidden;
    });
    $('biasA').addEventListener('input', refreshBiasUI);
    $('biasB').addEventListener('input', refreshBiasUI);
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
      $('modeButtons').hidden = true;
      $('netform').hidden = false;
    });
    $('btnNetBack').addEventListener('click', function () {
      $('netform').hidden = true;
      $('modeButtons').hidden = false;
    });
    $('btnNetResume').addEventListener('click', function () { AUDIO.ui(); cb.onNetResume(); });
    $('btnNetResume0').addEventListener('click', function () { AUDIO.ui(); cb.onNetResume(); });
    $('btnNetHost').addEventListener('click', function () { AUDIO.ui(); cb.onNetHost($('inpNetName').value.trim(), currentBias()); });
    $('btnNetJoin').addEventListener('click', function () { AUDIO.ui(); cb.onNetJoin($('inpNetName').value.trim()); });
    $('btnNetCancel').addEventListener('click', function () { AUDIO.ui(); cb.onNetCancel(); });
    $('qrOut').addEventListener('click', function () {
      $('qrOut').classList.toggle('big');
    });
    $('btnNetPaste').addEventListener('click', function () {
      AUDIO.ui();
      $('pasteWrap').hidden = !$('pasteWrap').hidden;
    });
    $('btnPasteGo').addEventListener('click', function () { AUDIO.ui(); NET.acceptPeerCode($('pasteIn').value); });
    $('btnCopyCode').addEventListener('click', function () {
      var el = $('myCode');
      el.focus();
      el.select();
      try { navigator.clipboard.writeText(el.value); } catch (e) { try { document.execCommand('copy'); } catch (e2) {} }
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
    measureInsets: measureInsets
  };
})();
