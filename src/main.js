/* ============================================================
   SUPERFARMER — orkiestracja gry
   ============================================================ */
(function () {
  'use strict';

  var LS_SAVE = 'sf3d.save.v1';
  var LS_SOUND = 'sf3d.sound';
  var LS_TUT = 'sf3d.tutorial';
  var LS_NAMES = 'sf3d.names';
  var LS_BIAS = 'sf3d.bias';

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  var S = null;        // stan gry
  var GEN = 0;         // generacja — unieważnia zawieszone sekwencje po restarcie
  var dice = null;
  var atlas = null;
  var DBG = /[?&]debug/.test(location.search);
  function dlog() { if (DBG) console.log.apply(console, ['[SF]'].concat([].slice.call(arguments))); }

  function sleep(ms) {
    var g = GEN;
    return new Promise(function (res) {
      setTimeout(function () { if (g === GEN) res(); else res(Promise.reject('stale')); }, ms);
    });
  }

  function plural(sym, n) { return n + ' ' + SYMBOLS.plural(sym, n); }
  function pluralZw(n) {
    if (n === 1) return '1 zwierzę';
    var d = n % 10, h = n % 100;
    if (d >= 2 && d <= 4 && !(h >= 12 && h <= 14)) return n + ' zwierzęta';
    return n + ' zwierząt';
  }

  /* ---------- stan ---------- */
  function newState(mode, names, bias) {
    names = names || [];
    var players = mode === 'solo'
      ? [{ name: 'Ty', isBot: false }, { name: 'Zenek 🤖', isBot: true }]
      : [{ name: names[0] || 'Gracz 1', isBot: false }, { name: names[1] || 'Gracz 2', isBot: false }];
    players.forEach(function (p) { p.herd = RULES.emptyHerd(); });
    return {
      mode: mode,
      bias: bias && bias.length === 2 ? bias : [0, 0],
      players: players,
      stock: JSON.parse(JSON.stringify(RULES.STOCK_INIT)),
      cur: 0,
      turnCount: 1,
      exchangeUsed: false,
      phase: 'preroll',
      stats: { rolls: [0, 0], wolfEaten: [0, 0], foxStolen: [0, 0], dogSaves: [0, 0] }
    };
  }

  function save() {
    if (!S || S.phase === 'gameover' || S.mode === 'net') return;
    var c = JSON.parse(JSON.stringify(S));
    c.phase = 'preroll';
    lsSet(LS_SAVE, JSON.stringify(c));
  }

  function loadSave() {
    var raw = lsGet(LS_SAVE);
    if (!raw) return null;
    try {
      var s = JSON.parse(raw);
      if (!s.players || s.players.length !== 2) return null;
      return s;
    } catch (e) { return null; }
  }

  /* ---------- opisy ---------- */
  function curP() { return S.players[S.cur]; }
  function whoName() { return curP().name; }
  function isBotTurn() { return curP().isBot; }
  function turnBannerText() {
    if (S.mode === 'solo') return S.cur === 0 ? 'Twoja tura' : 'Teraz Zenek';
    if (S.mode === 'net') return S.cur === NETLOCAL ? 'Twoja tura' : 'Teraz: ' + curP().name;
    return 'Teraz: ' + curP().name;
  }

  /* ---------- gra przez sieć: stan lokalny ---------- */
  var NETLOCAL = -1;   // indeks lokalnego gracza w trybie net (host=0, gość=1)
  var netQ = [];       // wiadomości odroczone na czas animacji rozstrzygania
  var netStream = 0;

  function isNet() { return !!S && S.mode === 'net'; }
  function isNetLocalTurn() { return isNet() && S.cur === NETLOCAL; }

  function stopNetStream() { if (netStream) { clearInterval(netStream); netStream = 0; } }
  function startNetStream() {
    if (netStream) return;
    netStream = setInterval(function () {
      if (!isNetLocalTurn() || !dice.isBusy()) return;
      NET.send({ t: 'f', d: dice.getNetFrame() });
    }, 40);
  }

  function flushNetQ() {
    while (netQ.length) handleNetMsg(netQ.shift());
  }

  /* ---------- pętla tury ---------- */
  function beginTurn() {
    var g = GEN;
    S.phase = 'preroll';
    S.exchangeUsed = false;
    dlog('beginTurn cur=', S.cur, 'turn=', S.turnCount);
    save();
    HUD.refresh(S);
    HUD.banner(turnBannerText(), S.cur === 0 ? 'green' : 'orange');
    if (isNet() && S.cur !== NETLOCAL) {
      dice.setRemoteDriven(false);
      dice.setInteractive(false);
      HUD.setDock('bot', { text: curP().name + ' gra na swoim telefonie…' });
      flushNetQ();
    } else if (isBotTurn()) {
      dice.setInteractive(false);
      HUD.setDock('bot', { text: 'Zenek przygląda się stadu…' });
      botTurn(g);
    } else {
      if (isNet()) dice.setRemoteDriven(false);
      dice.setInteractive(true);
      HUD.setDock('preroll-human', { exchangeUsed: false });
      if (!lsGet(LS_TUT)) HUD.swipeHint(true);
      flushNetQ();
    }
  }

  /* ---------- gra przez sieć: protokół ---------- */
  function handleNetMsg(m) {
    if (!isNet()) return;
    if (m.t === 'ex') {
      if (S.cur === NETLOCAL || S.phase !== 'preroll' || S.exchangeUsed) return;
      var rate = null;
      for (var i = 0; i < RULES.EXCHANGE_RATES.length; i++) {
        if (RULES.EXCHANGE_RATES[i].id === m.id) rate = RULES.EXCHANGE_RATES[i];
      }
      if (!rate) return;
      var res = RULES.applyExchange(curP().herd, S.stock, rate, m.dir, m.times);
      if (!res) return;
      curP().herd = res.herd;
      S.stock = res.stock;
      S.exchangeUsed = true;
      AUDIO.coin();
      var gv = m.dir > 0 ? rate.give : rate.get;
      var gt = m.dir > 0 ? rate.get : rate.give;
      var gvN = (m.dir > 0 ? rate.giveN : rate.getN) * m.times;
      var gtN = (m.dir > 0 ? rate.getN : rate.giveN) * m.times;
      HUD.feed({ who: S.cur, whoName: whoName(), icon: gt, text: whoName() + ' wymienia ' + plural(gv, gvN) + ' na ' + plural(gt, gtN) });
      var anim = {}; anim[gt] = 1;
      HUD.refresh(S, { player: S.cur, anim: anim });
      if (RULES.checkWin(curP().herd)) finishGame(S.cur);
      return;
    }
    if (m.t === 'roll') {
      if (S.cur === NETLOCAL || (S.phase !== 'preroll' && S.phase !== 'rolling')) return;
      dice.setRemoteDriven(true);
      S.phase = 'rolling';
      HUD.setDock('rolling');
      HUD.dieLabels(null);
      AUDIO.whoosh();
      HUD.closeSheets();
      return;
    }
    if (m.t === 'set') {
      if (S.cur === NETLOCAL || S.phase !== 'rolling') return;
      dice.endRemoteRoll();
      resolveRoll(m.faces);
      return;
    }
    if (m.t === 'again') {
      netStart(NETLOCAL === 0 ? 'host' : 'guest', S.players.map(function (p) { return p.name; }), S.bias);
      return;
    }
    if (m.t === 'bye') { netEnd('Przeciwnik wyszedł z gry'); }
  }

  function onNetMsg(m) {
    if (!isNet()) return;
    if (m.t === 'f') {
      if (S.cur !== NETLOCAL && (S.phase === 'preroll' || S.phase === 'rolling')) {
        dice.setRemoteDriven(true);
        dice.applyNetFrame(m.d);
      }
      return;
    }
    if (S.phase === 'resolving' && (m.t === 'ex' || m.t === 'roll' || m.t === 'set')) {
      netQ.push(m);
      return;
    }
    handleNetMsg(m);
  }

  function netStart(role, names, bias) {
    NETLOCAL = role === 'host' ? 0 : 1;
    netQ = [];
    stopNetStream();
    startGame('net', names, bias);
    HUD.netDot('on');
  }

  function netEnd(msg) {
    var wasNet = isNet();
    NET.close();
    NETLOCAL = -1;
    stopNetStream();
    netQ = [];
    HUD.netDot(null);
    if (wasNet) {
      dice.setRemoteDriven(false);
      if (msg) {
        HUD.feed({ who: 0, whoName: '', text: msg });
        HUD.eventBig({ icon: null, t1: 'ROZŁĄCZONO', t2: msg, cls: 'bad' }, 2000);
      }
      backToMenu();
    }
  }

  /* ---------- gra przez sieć: przepływ łączenia ---------- */
  var $id = function (id) { return document.getElementById(id); };
  var netName = '';

  function netUiEls() {
    return {
      status: function (t) { $id('netStatus').textContent = t; },
      showMyCode: function (code) {
        var cv = $id('qrOut');
        cv.hidden = false;
        try { NET.drawQR(cv, code); } catch (e) { cv.hidden = true; }
        $id('myCode').value = code;
      },
      video: $id('qrCam'),
      cameraFailed: function (msg) {
        $id('camWrap').hidden = true;
        $id('netStatus').textContent = msg;
        $id('pasteWrap').hidden = false;
      }
    };
  }

  function netConnectFlow(role, name, bias) {
    netName = name || (role === 'host' ? 'Gracz 1' : 'Gracz 2');
    var netBias = bias && bias.length === 2 ? bias : [0, 0];
    $id('netform').hidden = true;
    $id('netconn').hidden = false;
    $id('qrOut').hidden = true;
    $id('pasteWrap').hidden = true;
    $id('camWrap').hidden = false;
    $id('myCode').value = '';
    $id('pasteIn').value = '';
    var cbs = {
      onOpen: function () {
        $id('netStatus').textContent = 'Połączono!';
        NET.send({ t: 'hi', name: netName });
      },
      onLink: function (ok) {
        if (isNet()) HUD.netDot(ok ? 'on' : 'off');
      },
      onMsg: function (m) {
        if (m.t === 'hi') {
          if (role === 'host') {
            var names = [netName, m.name || 'Gracz 2'];
            NET.send({ t: 'go', names: names, bias: netBias });
            netUiDone();
            netStart('host', names, netBias);
          }
          return;
        }
        if (m.t === 'go') {
          netUiDone();
          netStart('guest', m.names, m.bias);
          return;
        }
        onNetMsg(m);
      },
      onClose: function () {
        if (isNet()) netEnd('Połączenie z drugim telefonem przerwane');
        else $id('netStatus').textContent = 'Połączenie przerwane — spróbujcie od nowa';
      }
    };
    if (role === 'host') NET.startHost(netUiEls(), cbs);
    else NET.startGuest(netUiEls(), cbs);
  }

  function netUiDone() {
    NET.stopScan();
    $id('netconn').hidden = true;
    $id('modeButtons').hidden = false;
  }

  function netCancel() {
    NET.close();
    $id('netconn').hidden = true;
    $id('netform').hidden = false;
  }

  function botTurn(g) {
    sleep(1100).then(function () {
      if (g !== GEN) return;
      var ex = AI.chooseExchange(curP().herd, S.stock);
      var wait = 500;
      if (ex) {
        var res = RULES.applyExchange(curP().herd, S.stock, ex.rate, ex.dir, ex.times);
        if (res) {
          curP().herd = res.herd;
          S.stock = res.stock;
          S.exchangeUsed = true;
          var gv = ex.dir > 0 ? ex.rate.give : ex.rate.get;
          var gt = ex.dir > 0 ? ex.rate.get : ex.rate.give;
          var gvN = (ex.dir > 0 ? ex.rate.giveN : ex.rate.getN) * ex.times;
          var gtN = (ex.dir > 0 ? ex.rate.getN : ex.rate.giveN) * ex.times;
          HUD.feed({ who: S.cur, whoName: whoName(), icon: gt, text: 'Zenek wymienia ' + plural(gv, gvN) + ' na ' + plural(gt, gtN) });
          HUD.refresh(S, { player: S.cur, anim: (function () { var m = {}; m[gt] = 1; return m; })() });
          AUDIO.coin();
          wait = 1250;
          if (RULES.checkWin(curP().herd)) { finishGame(S.cur); return; }
        }
      }
      return sleep(wait).then(function () {
        if (g !== GEN) return;
        dlog('bot throwAuto, cur=', S.cur, 'phase=', S.phase);
        HUD.setDock('bot', { text: 'Zenek rzuca kośćmi…' });
        dice.throwAuto();
      });
    }).catch(function () {});
  }

  /* ---------- rozstrzyganie rzutu ---------- */
  function resolveRoll(faces) {
    var g = GEN;
    var p = curP();
    dlog('resolveRoll cur=', S.cur, 'faces=', faces.join('+'));
    S.phase = 'resolving';
    save();
    S.stats.rolls[S.cur]++;
    HUD.setDock('resolving');
    HUD.dieLabels(faces, function (i) { return dice.getDieScreenPos(i); });

    var r = RULES.resolveRoll(p.herd, S.stock, faces[0], faces[1]);
    var seq = Promise.resolve();

    r.events.forEach(function (ev) {
      seq = seq.then(function () {
        if (g !== GEN) return Promise.reject('stale');
        if (ev.t === 'wolf') {
          if (ev.saved) {
            AUDIO.bark();
            HUD.flash('green');
            S.stats.dogSaves[S.cur]++;
            HUD.feed({ who: S.cur, whoName: whoName(), icon: 'bigDog', text: 'Duży pies przegonił wilka!' });
            return HUD.eventBig({ icon: 'bigDog', t1: 'HAU! HAU!', t2: 'Duży pies przegonił wilka i wrócił do Stada Głównego', cls: 'good' }, 1900);
          }
          AUDIO.sting();
          HUD.flash('red');
          dice.shake(0.9);
          S.stats.wolfEaten[S.cur] += ev.total;
          HUD.feed({ who: S.cur, whoName: whoName(), icon: 'wolf', text: ev.total ? 'Wilk pożarł ' + pluralZw(ev.total) + '!' : 'Wilk warował przy pustej zagrodzie' });
          var t2 = ev.total > 0
            ? 'Pożarł ' + pluralZw(ev.total) + '! Ocalały konie i mały pies'
            : 'Warował przy pustej zagrodzie — nic nie stracono';
          return HUD.eventBig({ icon: 'wolf', t1: 'WILK!', t2: t2, cls: 'bad' }, 2000);
        }
        if (ev.t === 'fox') {
          if (ev.saved) {
            AUDIO.bark();
            HUD.flash('green');
            S.stats.dogSaves[S.cur]++;
            HUD.feed({ who: S.cur, whoName: whoName(), icon: 'smallDog', text: 'Mały pies przegonił lisa!' });
            return HUD.eventBig({ icon: 'smallDog', t1: 'HAU!', t2: 'Mały pies przegonił lisa i wrócił do Stada Głównego', cls: 'good' }, 1900);
          }
          AUDIO.sting();
          S.stats.foxStolen[S.cur] += ev.lost;
          if (ev.lost > 0) {
            HUD.flash('red');
            dice.shake(0.6);
            HUD.feed({ who: S.cur, whoName: whoName(), icon: 'fox', text: 'Lis porwał ' + plural('rabbit', ev.lost) + '!' });
            return HUD.eventBig({ icon: 'fox', t1: 'LIS!', t2: 'Porwał ' + plural('rabbit', ev.lost) + '!', cls: 'bad' }, 1900);
          }
          HUD.feed({ who: S.cur, whoName: whoName(), icon: 'fox', text: 'Lis myszkował, ale królików brak' });
          return HUD.eventBig({ icon: 'fox', t1: 'LIS!', t2: 'Węszył za królikami, ale zagroda była pusta', cls: 'bad' }, 1500);
        }
        return null;
      });
    });

    seq.then(function () {
      if (g !== GEN) return Promise.reject('stale');
      var gainEvents = r.events.filter(function (e) { return e.t === 'gain' && e.n > 0; });
      var capped = r.events.some(function (e) { return e.t === 'gain' && e.capped; });
      var animMap = {};
      r.events.forEach(function (e) {
        if (e.t === 'gain' && e.n > 0) animMap[e.animal] = 1;
        if (e.t === 'wolf' && !e.saved) Object.keys(e.eaten).forEach(function (k) { animMap[k] = -1; });
        if (e.t === 'fox' && !e.saved && e.lost > 0) animMap.rabbit = -1;
        if ((e.t === 'wolf' || e.t === 'fox') && e.saved) animMap[e.t === 'wolf' ? 'bigDog' : 'smallDog'] = -1;
      });

      p.herd = r.herd;
      S.stock = r.stock;
      HUD.refresh(S, { player: S.cur, anim: animMap });

      if (gainEvents.length) {
        AUDIO.gain();
        HUD.gains(gainEvents.map(function (e) { return { sym: e.animal, n: e.n }; }), 1700);
        var parts = gainEvents.map(function (e) { return '+' + plural(e.animal, e.n); });
        HUD.feed({ who: S.cur, whoName: whoName(), icon: gainEvents[0].animal, text: parts.join(', ') + (capped ? ' (Stado Główne na wyczerpaniu)' : '') });
        return sleep(1500);
      }
      if (r.events.some(function (e) { return e.t === 'nothing'; })) {
        HUD.feed({ who: S.cur, whoName: whoName(), icon: faces[0] === faces[1] ? faces[0] : null, text: 'Bez przychówku (' + SYMBOLS.NAMES_PL[faces[0]][0] + ' + ' + SYMBOLS.NAMES_PL[faces[1]][0] + ')' });
        return sleep(650);
      }
      return sleep(350);
    }).then(function () {
      if (g !== GEN) return;
      save();
      if (RULES.checkWin(p.herd)) return finishGame(S.cur);
      S.cur = 1 - S.cur;
      if (S.cur === 0) S.turnCount++;
      beginTurn();
    }).catch(function () {});
  }

  /* ---------- koniec gry ---------- */
  function finishGame(winner) {
    S.phase = 'gameover';
    lsDel(LS_SAVE);
    dice.setInteractive(false);
    HUD.refresh(S);
    HUD.setDock('off');
    var p = S.players[winner];
    var humanWon = !p.isBot;
    var st = S.stats;
    var rolls = st.rolls[0] + st.rolls[1];
    var attacks = [];
    var eaten = st.wolfEaten[0] + st.wolfEaten[1] + st.foxStolen[0] + st.foxStolen[1];
    var saves = st.dogSaves[0] + st.dogSaves[1];
    attacks.push({ v: S.turnCount, l: 'rund' });
    attacks.push({ v: rolls, l: 'rzutów kośćmi' });
    attacks.push({ v: eaten, l: 'zwierząt straconych' });
    attacks.push({ v: saves, l: saves === 1 ? 'obrona psa' : 'obrony psów' });
    if (humanWon) { AUDIO.fanfare(); HUD.confetti(atlas); } else { AUDIO.lose(); }
    HUD.showWin({
      eyebrow: 'Pełna zagroda!',
      title: S.mode === 'solo' ? (humanWon ? 'WYGRYWASZ!' : 'ZENEK WYGRAŁ') : (p.name.toUpperCase() + ' WYGRYWA!'),
      sub: p.name + ' ma komplet: koń, krowa, świnia, owca i królik!',
      stats: attacks
    });
  }

  /* ---------- akcje HUD ---------- */
  function startGame(mode, names, bias) {
    GEN++;
    S = newState(mode, names, bias);
    dice.setBias(S.bias);
    HUD.hideStart();
    HUD.hideWin();
    HUD.closeSheets();
    HUD.buildCards(S);
    HUD.refresh(S);
    HUD.feed({ who: 0, whoName: '', text: mode === 'solo' ? 'Nowa gra: Ty kontra Zenek. Powodzenia!' : 'Nowa gra na jednym telefonie. Powodzenia!' });
    syncInsets();
    beginTurn();
  }

  function resumeGame(saved) {
    GEN++;
    S = saved;
    if (!S.bias || S.bias.length !== 2) S.bias = [0, 0];
    dice.setBias(S.bias);
    HUD.hideStart();
    HUD.hideWin();
    HUD.closeSheets();
    HUD.buildCards(S);
    HUD.refresh(S);
    HUD.feed({ who: 0, whoName: '', text: 'Wznowiono zapisaną grę (runda ' + S.turnCount + ')' });
    syncInsets();
    beginTurn();
  }

  function backToMenu() {
    GEN++;
    HUD.hideWin();
    HUD.closeSheets();
    dice.setInteractive(false);
    HUD.showStart({ canResume: !!loadSave(), names: storedNames(), bias: storedBias() });
  }

  function storedNames() {
    try { return JSON.parse(lsGet(LS_NAMES) || 'null'); } catch (e) { return null; }
  }

  function storedBias() {
    try {
      var a = JSON.parse(lsGet(LS_BIAS) || 'null');
      if (a && a.length === 2 && isFinite(a[0]) && isFinite(a[1])) {
        return [
          Math.max(-0.25, Math.min(0.25, +a[0])),
          Math.max(-0.25, Math.min(0.25, +a[1]))
        ];
      }
    } catch (e) {}
    return [0, 0];
  }

  /* ---------- insets / resize ---------- */
  function syncInsets() {
    if (!dice) return;
    dice.setInsets(HUD.measureInsets());
  }

  /* ---------- start aplikacji ---------- */
  function boot() {
    if (lsGet(LS_SOUND) === '0') AUDIO.setEnabled(false);

    atlas = SYMBOLS.buildAtlas(2048);

    try {
      dice = new DiceScene({
        canvas: document.getElementById('scene3d'),
        atlasCanvas: atlas,
        symbolsA: RULES.DIE_A,
        symbolsB: RULES.DIE_B,
        onSettle: function (faces) {
          dlog('onSettle faces=', faces.join('+'), 'phase=', S && S.phase, 'cur=', S && S.cur);
          if (!S || S.phase !== 'rolling') return;
          if (isNetLocalTurn()) {
            NET.send({ t: 'f', d: dice.getNetFrame() });
            NET.send({ t: 'set', faces: faces });
            stopNetStream();
          }
          resolveRoll(faces);
        },
        onImpact: function (kind, strength) {
          AUDIO.knock(kind, strength);
          if (navigator.vibrate && strength > 0.35) { try { navigator.vibrate(strength > 0.7 ? 12 : 6); } catch (e) {} }
        },
        onThrow: function () {
          dlog('onThrow phase=', S && S.phase, 'cur=', S && S.cur);
          if (!S || (S.phase !== 'preroll' && S.phase !== 'rolling')) return;
          S.phase = 'rolling';
          HUD.swipeHint(false);
          lsSet(LS_TUT, '1');
          HUD.setDock('rolling');
          HUD.dieLabels(null);
          AUDIO.whoosh();
          HUD.closeSheets();
          if (isNetLocalTurn()) {
            NET.send({ t: 'roll' });
            startNetStream();
          }
        },
        onHold: function (held) {
          if (!S || S.phase !== 'preroll') return;
          if (held) {
            HUD.swipeHint(false);
            HUD.setDock('held');
            if (isNetLocalTurn()) startNetStream();
          }
        }
      });
    } catch (err) {
      document.getElementById('hud').innerHTML =
        '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:30px;text-align:center;font-size:16px;color:#f3e8d2">' +
        'Nie udało się uruchomić grafiki 3D (WebGL). Spróbuj w nowszej przeglądarce.' +
        '</div>';
      return;
    }

    HUD.init({
      onRollClick: function () {
        if (!S || S.phase !== 'preroll' || isBotTurn() || (isNet() && S.cur !== NETLOCAL)) return;
        AUDIO.ui();
        dice.throwAuto();
      },
      onExchangeOpen: function () {
        if (!S || S.phase !== 'preroll' || isBotTurn() || S.exchangeUsed || (isNet() && S.cur !== NETLOCAL)) return;
        AUDIO.ui();
        HUD.buildExchange(S);
        HUD.openSheet('sheetEx');
      },
      onExchangeApply: function (rate, dir, times, giveSym, getSym) {
        if (!S || S.phase !== 'preroll' || S.exchangeUsed || (isNet() && S.cur !== NETLOCAL)) return;
        var res = RULES.applyExchange(curP().herd, S.stock, rate, dir, times);
        if (!res) return;
        curP().herd = res.herd;
        S.stock = res.stock;
        S.exchangeUsed = true;
        if (isNetLocalTurn()) NET.send({ t: 'ex', id: rate.id, dir: dir, times: times });
        AUDIO.coin();
        var gvN = (dir > 0 ? rate.giveN : rate.getN) * times;
        var gtN = (dir > 0 ? rate.getN : rate.giveN) * times;
        HUD.feed({ who: S.cur, whoName: whoName(), icon: getSym, text: 'Wymiana: ' + plural(giveSym, gvN) + ' → ' + plural(getSym, gtN) });
        HUD.closeSheets();
        var anim = {}; anim[getSym] = 1;
        HUD.refresh(S, { player: S.cur, anim: anim });
        if (RULES.checkWin(curP().herd)) { finishGame(S.cur); return; }
        HUD.setDock('preroll-human', { exchangeUsed: true, hint: 'Wymiana za Tobą — teraz rzuć kośćmi!' });
        save();
      },
      onMenuOpen: function () {
        AUDIO.ui();
        HUD.buildMenu(S);
        HUD.openSheet('sheetMenu');
      },
      onSoundToggle: function () {
        AUDIO.setEnabled(!AUDIO.isEnabled());
        lsSet(LS_SOUND, AUDIO.isEnabled() ? '1' : '0');
        if (AUDIO.isEnabled()) AUDIO.ui();
      },
      onModeStart: function (mode, names, bias) {
        AUDIO.unlock(); AUDIO.ui();
        if (mode === 'duo' && names) lsSet(LS_NAMES, JSON.stringify(names));
        lsSet(LS_BIAS, JSON.stringify(bias && bias.length === 2 ? bias : [0, 0]));
        startGame(mode, names, bias);
      },
      onResume: function () {
        AUDIO.unlock(); AUDIO.ui();
        var s = loadSave();
        if (s) resumeGame(s); else startGame('solo', null, storedBias());
      },
      onRestart: function () {
        if (isNet()) {
          NET.send({ t: 'again' });
          netStart(NETLOCAL === 0 ? 'host' : 'guest', S.players.map(function (p) { return p.name; }), S.bias);
          return;
        }
        if (S && S.mode) startGame(S.mode, S.players.map(function (p) { return p.name; }), S.bias); else backToMenu();
      },
      onAgain: function () {
        AUDIO.ui();
        if (isNet()) {
          NET.send({ t: 'again' });
          netStart(NETLOCAL === 0 ? 'host' : 'guest', S.players.map(function (p) { return p.name; }), S.bias);
          return;
        }
        startGame(S ? S.mode : 'solo', S ? S.players.map(function (p) { return p.name; }) : null, S ? S.bias : storedBias());
      },
      onBackToMenu: function () {
        AUDIO.ui();
        if (isNet()) { NET.send({ t: 'bye' }); netEnd(null); return; }
        backToMenu();
      },
      onNetHost: function (name, bias) { AUDIO.unlock(); netConnectFlow('host', name, bias); },
      onNetJoin: function (name) { AUDIO.unlock(); netConnectFlow('guest', name, null); },
      onNetCancel: function () { netCancel(); }
    });

    window.addEventListener('resize', function () {
      dice.resize();
      syncInsets();
    });
    document.addEventListener('pointerdown', function once() {
      AUDIO.unlock();
    }, { capture: true });
    // iOS: blokuj gest przewijania / pull-to-refresh na scenie
    document.addEventListener('touchmove', function (e) {
      if (e.target && e.target.id === 'scene3d') e.preventDefault();
    }, { passive: false });

    syncInsets();
    HUD.showStart({ canResume: !!loadSave(), names: storedNames(), bias: storedBias() });
    // uchwyt diagnostyczny (devtools)
    window.__SF = { dice: dice, get state() { return S; } };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
