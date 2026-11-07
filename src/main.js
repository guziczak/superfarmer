/* ============================================================
   SUPERFARMER — orkiestracja gry
   ============================================================ */
(function () {
  'use strict';

  var LS_SAVE = 'sf3d.save.v1';
  var LS_SOUND = 'sf3d.sound';
  var LS_TUT = 'sf3d.tutorial';
  var LS_NAMES = 'sf3d.names';
  var LS_NETNAME = 'sf3d.netname';
  var LS_NETSAVE = 'sf3d.netsave.v1';
  var PROTOCOL_VERSION = 2;
  var MAX_NAME = 32;
  var NET_SESSION = 0;
  var MAX_NET_QUEUE = 8;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  var S = null;        // stan gry
  var GEN = 0;         // generacja — unieważnia zawieszone sekwencje po restarcie
  var dice = null;
  var atlas = null;
  var awaitingContinue = false;
  var canvasWidth = 0, canvasHeight = 0;
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
    names = Array.isArray(names) ? names : [];
    names = [cleanName(names[0], 'Gracz 1'), cleanName(names[1], 'Gracz 2')];
    var players = mode === 'solo'
      ? [{ name: 'Ty', isBot: false }, { name: 'Zenek 🤖', isBot: true }]
      : [{ name: names[0] || 'Gracz 1', isBot: false }, { name: names[1] || 'Gracz 2', isBot: false }];
    players.forEach(function (p) { p.herd = RULES.emptyHerd(); });
    return {
      v: 2,
      mode: mode,
      bias: normTuning(bias),
      players: players,
      stock: JSON.parse(JSON.stringify(RULES.STOCK_INIT)),
      cur: 0,
      turnCount: 1,
      exchangeUsed: false,
      phase: 'preroll',
      lastRolls: [null, null],
      stats: { rolls: [0, 0], wolfEaten: [0, 0], foxStolen: [0, 0], dogSaves: [0, 0] }
    };
  }

  function validName(n) {
    return typeof n === 'string' && n.trim().length > 0 && n.length <= MAX_NAME && !/[\u0000-\u001f\u007f]/.test(n);
  }

  function cleanName(n, fallback) {
    if (typeof n !== 'string') return fallback;
    return n.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME) || fallback;
  }

  function validTuning(b) {
    var v = Array.isArray(b) ? b : b && (b.m === 'w' || b.m === 's') ? b.v : null;
    return Array.isArray(v) && v.length === 2 && v.every(function (x) {
      return typeof x === 'number' && Number.isFinite(x) && x >= -1 && x <= 1;
    });
  }

  function validFacePair(faces) {
    return Array.isArray(faces) && faces.length === 2 && RULES.validFaces(faces[0], faces[1]);
  }

  function copyHerd(herd) {
    var out = {};
    RULES.ANIMALS.forEach(function (animal) { out[animal] = herd[animal]; });
    return out;
  }

  // Ostatni wynik obu graczy jest informacją do spokojnego odczytania.
  // Przechowujemy wejście reguł, żeby przy wznowieniu odtworzyć skutek,
  // zamiast wyświetlać dowolne opisy lub zdarzenia otrzymane przez sieć.
  function makeLastRoll(turn, faces, before, stockBefore, result) {
    result = result || RULES.resolveRoll(before, stockBefore, faces[0], faces[1]);
    var changes = {};
    RULES.ANIMALS.forEach(function (animal) { changes[animal] = result.herd[animal] - before[animal]; });
    return {
      turn: turn, faces: faces.slice(), before: copyHerd(before), stockBefore: copyHerd(stockBefore),
      changes: changes, events: JSON.parse(JSON.stringify(result.events))
    };
  }

  function readLastRoll(raw, state, player) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
        !Number.isSafeInteger(raw.turn) || raw.turn < 1 || raw.turn > state.turnCount ||
        state.stats.rolls[player] < 1 || !validFacePair(raw.faces) ||
        !RULES.validHerd(raw.before) || !RULES.validHerd(raw.stockBefore) ||
        RULES.checkWin(raw.before)) return null;
    var before = copyHerd(raw.before), stockBefore = copyHerd(raw.stockBefore);
    // W bieżącej rundzie tylko zakończone już tury mogą mieć wynik.
    var latest = state.turnCount;
    if ((state.phase === 'preroll' || state.phase === 'rolling') && player >= state.cur) latest--;
    if (state.phase === 'resolving' && player > state.cur) latest--;
    if (raw.turn > latest || !RULES.ANIMALS.every(function (animal) {
      return before[animal] + stockBefore[animal] <= RULES.STOCK_INIT[animal];
    })) return null;
    var result = RULES.resolveRoll(before, stockBefore, raw.faces[0], raw.faces[1]);
    if (!result || !RULES.validHerd(result.herd) || !RULES.validHerd(result.stock)) return null;
    if (state.phase === 'resolving' && player === state.cur && raw.turn === state.turnCount) {
      if (raw.faces[0] !== state.resolvedRoll.faces[0] || raw.faces[1] !== state.resolvedRoll.faces[1] ||
          !RULES.ANIMALS.every(function (animal) {
            return result.herd[animal] === state.players[player].herd[animal] && result.stock[animal] === state.stock[animal];
          })) return null;
    }
    return makeLastRoll(raw.turn, raw.faces, before, stockBefore, result);
  }

  // Zapis i wznowienie P2P mają tę samą granicę zaufania: buduj pełny, nowy
  // obiekt wyłącznie z dozwolonych pól. Żaden stan nie omija walidacji zapasów.
  function readState(raw, expectedMode) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || (raw.v !== undefined && raw.v !== 2) ||
        ['solo', 'duo', 'net'].indexOf(raw.mode) < 0 || (expectedMode && raw.mode !== expectedMode) ||
        !Array.isArray(raw.players) || raw.players.length !== 2 ||
        (raw.cur !== 0 && raw.cur !== 1) || !Number.isSafeInteger(raw.turnCount) || raw.turnCount < 1 || raw.turnCount > 1000000 ||
        typeof raw.exchangeUsed !== 'boolean' || ['preroll', 'rolling', 'resolving', 'gameover'].indexOf(raw.phase) < 0 ||
        !RULES.validHerd(raw.stock) || (raw.bias !== undefined && !validTuning(raw.bias))) return null;
    var players = [];
    for (var i = 0; i < 2; i++) {
      var p = raw.players[i];
      if (!p || !validName(p.name) || !RULES.validHerd(p.herd) || p.isBot !== (raw.mode === 'solo' && i === 1)) return null;
      var herd = {};
      RULES.ANIMALS.forEach(function (a) { herd[a] = p.herd[a]; });
      players.push({ name: p.name, isBot: p.isBot, herd: herd });
    }
    var stock = {};
    for (var ai = 0; ai < RULES.ANIMALS.length; ai++) {
      var animal = RULES.ANIMALS[ai];
      if (raw.stock[animal] + players[0].herd[animal] + players[1].herd[animal] !== RULES.STOCK_INIT[animal]) return null;
      stock[animal] = raw.stock[animal];
    }
    var stats = {};
    var statNames = ['rolls', 'wolfEaten', 'foxStolen', 'dogSaves'];
    if (!raw.stats || typeof raw.stats !== 'object') return null;
    for (var si = 0; si < statNames.length; si++) {
      var key = statNames[si], counts = raw.stats[key];
      if (!Array.isArray(counts) || counts.length !== 2 || !counts.every(function (n) {
        return Number.isSafeInteger(n) && n >= 0 && n <= 1000000000;
      })) return null;
      stats[key] = counts.slice();
    }
    var out = {
      v: 2, mode: raw.mode, bias: normTuning(raw.bias), players: players, stock: stock,
      cur: raw.cur, turnCount: raw.turnCount, exchangeUsed: raw.exchangeUsed, phase: raw.phase, stats: stats
    };
    if (raw.phase === 'resolving') {
      var rr = raw.resolvedRoll;
      if (!rr || rr.player !== raw.cur || rr.turn !== raw.turnCount || !validFacePair(rr.faces) || stats.rolls[raw.cur] < 1) return null;
      out.resolvedRoll = { player: rr.player, turn: rr.turn, faces: rr.faces.slice() };
    }
    var winners = players.filter(function (p) { return RULES.checkWin(p.herd); });
    if (winners.length > 1 || (raw.phase === 'gameover' && winners.length !== 1)) return null;
    // Uszkodzony opcjonalny opis nie unieważnia prawidłowego stanu partii.
    // Starsze zapisy i starszy klient protokołu 2 po prostu nie mają historii.
    out.lastRolls = [null, null];
    if (Array.isArray(raw.lastRolls) && raw.lastRolls.length === 2) {
      out.lastRolls = [0, 1].map(function (player) { return readLastRoll(raw.lastRolls[player], out, player); });
    }
    return out;
  }

  function save() {
    if (!S || S.phase === 'gameover' || S.mode === 'net') return;
    // Jeden atomowy zapis obejmuje fazę, zużytą wymianę, wynik i statystyki.
    lsSet(LS_SAVE, JSON.stringify(S));
  }

  function persist() { save(); netSave(); }

  function loadSave() {
    var raw = lsGet(LS_SAVE);
    if (!raw) return null;
    try {
      var s = readState(JSON.parse(raw));
      return s && s.mode !== 'net' ? s : null;
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
      sendTurnMessage({ t: 'f', d: dice.getNetFrame() });
    }, 40);
  }

  function flushNetQ() {
    var pending = netQ;
    netQ = [];
    pending.forEach(onNetMsg);
  }

  function sendTurnMessage(m) {
    if (!isNet()) return;
    m.turn = S.turnCount;
    m.player = S.cur;
    NET.send(m);
  }

  function matchesTurn(m, player, turn) { return m.player === player && m.turn === turn; }

  /* Zapis przerwanej gry sieciowej: po każdej turze, na OBU urządzeniach.
     Zerwanie łącza go zostawia (można wznowić po ponownym sparowaniu),
     celowe wyjście do menu i koniec gry — czyszczą. */
  function netSave() {
    if (!isNet() || S.phase === 'gameover') return;
    if (NETLOCAL !== 0 && NETLOCAL !== 1) return;
    lsSet(LS_NETSAVE, JSON.stringify({ v: 1, myIdx: NETLOCAL, state: S }));
  }

  function loadNetSave() {
    try {
      var d = JSON.parse(lsGet(LS_NETSAVE) || 'null');
      if (!d || d.v !== 1 || (d.myIdx !== 0 && d.myIdx !== 1)) return null;
      var state = readState(d.state, 'net');
      if (state) return { v: 1, myIdx: d.myIdx, state: state };
    } catch (e) {}
    return null;
  }

  function clearNetSave() { lsDel(LS_NETSAVE); }

  function saveLabel() {
    var s = loadSave();
    if (!s) return null;
    if (s.mode === 'solo') return 'Wznów grę z Zenkiem (runda ' + s.turnCount + ')';
    return 'Wznów: ' + s.players[0].name + ' vs ' + s.players[1].name + ' (runda ' + s.turnCount + ')';
  }

  function netResumeLabel() {
    var ns = loadNetSave();
    if (!ns) return null;
    return ns.state.players[0].name + ' vs ' + ns.state.players[1].name + ' · runda ' + ns.state.turnCount;
  }

  /* ---------- pętla tury ---------- */
  function beginTurn(keepExchange) {
    if (!S) return;
    awaitingContinue = false;
    var g = GEN;
    S.phase = 'preroll';
    delete S.resolvedRoll;
    if (!keepExchange) S.exchangeUsed = false;
    dlog('beginTurn cur=', S.cur, 'turn=', S.turnCount);
    save();
    netSave();
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
      HUD.setDock('preroll-human', { exchangeUsed: S.exchangeUsed });
      if (!lsGet(LS_TUT)) HUD.swipeHint(true);
      flushNetQ();
    }
    syncInsets();
  }

  function advanceTurn() {
    S.cur = 1 - S.cur;
    if (S.cur === 0) S.turnCount++;
    beginTurn();
  }

  function calmPlay() {
    var preferences = HUD.getReadability();
    return !!S && S.mode !== 'net' && !!(preferences && preferences.calm);
  }

  function finishResolvedTurn() {
    if (!S || S.phase !== 'resolving') return;
    if (RULES.checkWin(curP().herd)) { finishGame(S.cur); return; }
    if (calmPlay()) {
      awaitingContinue = true;
      dice.setInteractive(false);
      HUD.refresh(S);
      HUD.setDock('await-next');
    } else {
      advanceTurn();
    }
  }

  function continueResolvedTurn() {
    if (!awaitingContinue || !S || S.phase !== 'resolving' || isNet()) return;
    // Ustaw flagę przed zmianą tury; drugi klik nie może przeskoczyć gracza.
    awaitingContinue = false;
    AUDIO.ui();
    advanceTurn();
  }

  function restoreTurn() {
    for (var i = 0; i < S.players.length; i++) {
      if (RULES.checkWin(S.players[i].herd)) { finishGame(i); return; }
    }
    // Wynik został już zastosowany przed zapisaniem „resolving”. Nie rzucaj
    // ponownie i nie stosuj go drugi raz; pozostała tylko prezentacja wyniku.
    if (S.phase === 'resolving') finishResolvedTurn();
    else beginTurn(true);
  }

  /* ---------- gra przez sieć: protokół ---------- */
  function validFrame(d) {
    return Array.isArray(d) && d.length === 2 && d.every(function (f) {
      if (!Array.isArray(f) || f.length !== 7 || !f.every(function (n) { return typeof n === 'number' && Number.isFinite(n); })) return false;
      if (Math.abs(f[0]) > 100 || Math.abs(f[1]) > 100 || Math.abs(f[2]) > 100) return false;
      var q = f.slice(3), norm = q.reduce(function (sum, n) { return sum + n * n; }, 0);
      return q.every(function (n) { return Math.abs(n) <= 1.001; }) && norm >= 0.5 && norm <= 1.5;
    });
  }

  function validNetMessage(m) {
    if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.t !== 'string') return false;
    if (m.t === 'hi') return m.v === PROTOCOL_VERSION && validName(m.name);
    if (m.t === 'go') {
      if (m.v !== PROTOCOL_VERSION) return false;
      if (m.resume !== undefined) {
        return !!m.resume && (m.resume.hostIdx === 0 || m.resume.hostIdx === 1) && !!readState(m.resume.state, 'net');
      }
      return Array.isArray(m.names) && m.names.length === 2 && m.names.every(validName) && validTuning(m.bias);
    }
    if (m.t === 'again' || m.t === 'bye') return true;
    if (['ex', 'roll', 'set', 'f', 'abort'].indexOf(m.t) < 0 ||
        (m.player !== 0 && m.player !== 1) || !Number.isSafeInteger(m.turn) || m.turn < 1 || m.turn > 1000000) return false;
    if (m.t === 'f') return validFrame(m.d);
    if (m.t === 'set') return validFacePair(m.faces);
    if (m.t === 'ex') return RULES.EXCHANGE_RATES.some(function (r) { return r.id === m.id; }) &&
      (m.dir === 1 || m.dir === -1) && Number.isSafeInteger(m.times) && m.times >= 1 && m.times <= 60;
    return true;
  }

  function handleNetMsg(m) {
    if (!isNet() || !validNetMessage(m)) return;
    if (['ex', 'roll', 'set', 'abort'].indexOf(m.t) >= 0 && !matchesTurn(m, S.cur, S.turnCount)) return;
    if (m.t === 'ex') {
      if (S.cur === NETLOCAL || S.phase !== 'preroll' || S.exchangeUsed) return;
      var rate = RULES.EXCHANGE_RATES.find(function (r) { return r.id === m.id; });
      var res = RULES.applyExchange(curP().herd, S.stock, rate, m.dir, m.times);
      if (!res) return;
      curP().herd = res.herd;
      S.stock = res.stock;
      S.exchangeUsed = true;
      persist();
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
      if (S.cur === NETLOCAL || S.phase !== 'preroll') return;
      dice.setRemoteDriven(true);
      S.phase = 'rolling';
      persist();
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
    if (m.t === 'abort') {
      if (S.cur !== NETLOCAL && S.phase === 'rolling') recoverRoll('Przeciwnik ponowi rzut — kostki nie ułożyły się płasko.', true);
      return;
    }
    if (m.t === 'again') {
      netStart(NETLOCAL === 0 ? 'host' : 'guest', S.players.map(function (p) { return p.name; }), S.bias);
      return;
    }
    if (m.t === 'bye') { clearNetSave(); netEnd('Przeciwnik wyszedł z gry', true); }
  }

  function onNetMsg(m) {
    if (!isNet() || !validNetMessage(m)) return;
    if (m.t === 'f') {
      if (matchesTurn(m, S.cur, S.turnCount) && S.cur !== NETLOCAL && (S.phase === 'preroll' || S.phase === 'rolling')) {
        dice.setRemoteDriven(true);
        dice.applyNetFrame(m.d);
      }
      return;
    }
    if (S.phase === 'resolving' && (m.t === 'ex' || m.t === 'roll' || m.t === 'set' || m.t === 'abort')) {
      var next = 1 - S.cur, nextRound = S.turnCount + (next === 0 ? 1 : 0);
      // Tylko następna tura drugiego gracza może wyprzedzić nasze animacje.
      if (next !== NETLOCAL && matchesTurn(m, next, nextRound) && netQ.length < MAX_NET_QUEUE) {
        var phase = 'preroll', exchanged = false;
        netQ.forEach(function (queued) {
          if (queued.t === 'ex') exchanged = true;
          else if (queued.t === 'roll') phase = 'rolling';
          else if (queued.t === 'abort') phase = 'preroll';
          else if (queued.t === 'set') phase = 'resolving';
        });
        if ((m.t === 'ex' && phase === 'preroll' && !exchanged) ||
            (m.t === 'roll' && phase === 'preroll') ||
            ((m.t === 'set' || m.t === 'abort') && phase === 'rolling')) netQ.push(m);
      }
      return;
    }
    handleNetMsg(m);
  }

  function netStart(role, names, bias, resume) {
    netQ = [];
    stopNetStream();
    if (resume) {
      var restored = readState(resume.state, 'net');
      if (!restored || (resume.hostIdx !== 0 && resume.hostIdx !== 1)) return false;
      NETLOCAL = role === 'host' ? resume.hostIdx : 1 - resume.hostIdx;
      GEN++;
      awaitingContinue = false;
      S = restored;
      S.bias = normTuning(S.bias);
      dice.setTuning(S.bias);
      HUD.hideStart();
      HUD.hideWin();
      HUD.closeSheets();
      HUD.setViewPlayer(NETLOCAL);
      HUD.buildCards(S);
      HUD.refresh(S);
      HUD.feed({ who: 0, whoName: '', text: 'Wznowiono przerwaną grę (runda ' + S.turnCount + ')' });
      syncInsets();
      restoreTurn();
    } else {
      NETLOCAL = role === 'host' ? 0 : 1;
      startGame('net', names, bias);
    }
    HUD.netDot('on');
  }

  function netEnd(msg, intentional) {
    var wasNet = isNet();
    if (wasNet && !intentional) netSave();
    NET_SESSION++;
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
        $id('qrHint').hidden = cv.hidden;
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

  function netConnectFlow(role, name, bias, wantResume) {
    var session = ++NET_SESSION;
    var started = false;
    netName = cleanName(name, role === 'host' ? 'Gracz 1' : 'Gracz 2');
    var netBias = normTuning(bias);
    $id('startov').classList.add('compact');
    $id('modeButtons').hidden = true;
    $id('netform').hidden = true;
    $id('netconn').hidden = false;
    $id('qrOut').hidden = true;
    $id('qrOut').classList.remove('big');
    $id('qrHint').hidden = true;
    $id('pasteWrap').hidden = true;
    $id('camWrap').hidden = false;
    $id('myCode').value = '';
    $id('pasteIn').value = '';
    var cbs = {
      onOpen: function () {
        if (session !== NET_SESSION) return;
        $id('netStatus').textContent = 'Połączono!';
        NET.send({ t: 'hi', v: PROTOCOL_VERSION, name: netName });
      },
      onLink: function (ok) {
        if (session !== NET_SESSION) return;
        if (isNet()) HUD.netDot(ok ? 'on' : 'off');
      },
      onMsg: function (m) {
        if (session !== NET_SESSION) return;
        if (!validNetMessage(m)) {
          if (!started && m && (m.t === 'hi' || m.t === 'go') && m.v !== PROTOCOL_VERSION) {
            $id('netStatus').textContent = 'Telefony mają różne wersje gry. Odśwież grę na obu urządzeniach i sparuj ponownie.';
          }
          return;
        }
        if (m.t === 'hi') {
          if (role === 'host' && !started) {
            started = true;
            var rs = wantResume ? loadNetSave() : null;
            if (rs) {
              NET.send({ t: 'go', v: PROTOCOL_VERSION, resume: { state: rs.state, hostIdx: rs.myIdx } });
              netUiDone();
              netStart('host', null, null, { state: rs.state, hostIdx: rs.myIdx });
            } else {
              var names = [netName, m.name || 'Gracz 2'];
              NET.send({ t: 'go', v: PROTOCOL_VERSION, names: names, bias: netBias });
              netUiDone();
              netStart('host', names, netBias);
            }
          }
          return;
        }
        if (m.t === 'go') {
          if (role !== 'guest' || started) return;
          started = true;
          netUiDone();
          if (m.resume && m.resume.state) netStart('guest', null, null, m.resume);
          else netStart('guest', m.names, m.bias);
          return;
        }
        onNetMsg(m);
      },
      onClose: function () {
        if (session !== NET_SESSION) return;
        if (isNet()) {
          netEnd('Połączenie z drugim telefonem przerwane');
        } else {
          // porażka jeszcze na etapie parowania: wyraźny toast + powrót do panelu
          HUD.eventBig({ icon: null, t1: 'NIE UDAŁO SIĘ', t2: 'Telefony się nie połączyły — spróbujcie jeszcze raz. Najpewniejszy ratunek: hotspot z jednego z telefonów.', cls: 'bad' }, 3000);
          netCancel();
        }
      }
    };
    if (role === 'host') NET.startHost(netUiEls(), cbs);
    else NET.startGuest(netUiEls(), cbs);
  }

  function netUiDone() {
    NET.stopScan();
    $id('qrOut').classList.remove('big');
    $id('netconn').hidden = true;
    $id('modeButtons').hidden = false;
  }

  function netCancel() {
    NET_SESSION++;
    NET.close();
    $id('netconn').hidden = true;
    $id('netform').hidden = false;
  }

  function botTurn(g) {
    sleep(1100).then(function () {
      if (g !== GEN || !S || S.phase !== 'preroll' || !isBotTurn()) return;
      var ex = S.exchangeUsed ? null : AI.chooseExchange(curP().herd, S.stock);
      var wait = 500;
      if (ex) {
        var res = RULES.applyExchange(curP().herd, S.stock, ex.rate, ex.dir, ex.times);
        if (res) {
          curP().herd = res.herd;
          S.stock = res.stock;
          S.exchangeUsed = true;
          persist();
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
        if (g !== GEN || !S || S.phase !== 'preroll') return;
        dlog('bot throwAuto, cur=', S.cur, 'phase=', S.phase);
        HUD.setDock('bot', { text: 'Zenek rzuca kośćmi…' });
        dice.throwAuto();
      });
    }).catch(function () {});
  }

  function recoverRoll(message, fromPeer) {
    if (!S || S.phase !== 'rolling' || (isNet() && !isNetLocalTurn() && !fromPeer)) return;
    stopNetStream();
    if (isNetLocalTurn() && !fromPeer) sendTurnMessage({ t: 'abort' });
    S.phase = 'preroll';
    // Nie było wyniku: nie naliczaj rzutu, nie zwracaj zużytej wymiany.
    persist();
    beginTurn(true);
    HUD.feed({ who: S.cur, whoName: whoName(), text: message || 'Kostki nie ułożyły się płasko. Ponów rzut.' });
    if (!isBotTurn() && (!isNet() || isNetLocalTurn())) {
      HUD.setDock('preroll-human', { exchangeUsed: S.exchangeUsed, hint: 'Kostki nie ułożyły się płasko — rzuć ponownie.' });
    }
  }

  /* ---------- rozstrzyganie rzutu ---------- */
  function resolveRoll(faces) {
    if (!S || S.phase !== 'rolling' || !validFacePair(faces)) return;
    var g = GEN;
    var player = S.cur;
    var p = curP();
    var r = RULES.resolveRoll(p.herd, S.stock, faces[0], faces[1]);
    if (!r) return;
    dlog('resolveRoll cur=', S.cur, 'faces=', faces.join('+'));
    // Zatwierdź całą transakcję logiczną synchronicznie. Animacje poniżej są
    // wyłącznie prezentacją i mogą zostać przerwane bez utraty wyniku.
    S.lastRolls[player] = makeLastRoll(S.turnCount, faces, p.herd, S.stock, r);
    p.herd = r.herd;
    S.stock = r.stock;
    S.stats.rolls[player]++;
    r.events.forEach(function (ev) {
      if ((ev.t === 'wolf' || ev.t === 'fox') && ev.saved) S.stats.dogSaves[player]++;
      else if (ev.t === 'wolf') S.stats.wolfEaten[player] += ev.total;
      else if (ev.t === 'fox') S.stats.foxStolen[player] += ev.lost;
    });
    S.phase = 'resolving';
    S.resolvedRoll = { player: player, turn: S.turnCount, faces: faces.slice() };
    persist();
    dice.setInteractive(false);
    syncInsets();
    HUD.showLastRolls(S, player);
    HUD.setDock('resolving');
    HUD.dieLabels(faces, function (i) { return dice.getDieScreenPos(i); });

    var seq = Promise.resolve();

    r.events.forEach(function (ev) {
      seq = seq.then(function () {
        if (g !== GEN) return Promise.reject('stale');
        if (ev.t === 'wolf') {
          if (ev.saved) {
            AUDIO.bark();
            HUD.flash('green');
            HUD.feed({ who: S.cur, whoName: whoName(), icon: 'bigDog', text: 'Duży pies przegonił wilka!' });
            return HUD.eventBig({ icon: 'bigDog', t1: 'HAU! HAU!', t2: 'Duży pies przegonił wilka i wrócił do Stada Głównego', cls: 'good' }, 1900);
          }
          AUDIO.sting();
          HUD.flash('red');
          dice.shake(0.9);
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
            HUD.feed({ who: S.cur, whoName: whoName(), icon: 'smallDog', text: 'Mały pies przegonił lisa!' });
            return HUD.eventBig({ icon: 'smallDog', t1: 'HAU!', t2: 'Mały pies przegonił lisa i wrócił do Stada Głównego', cls: 'good' }, 1900);
          }
          AUDIO.sting();
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

      HUD.refresh(S, { player: player, anim: animMap });

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
      finishResolvedTurn();
    }).catch(function () {});
  }

  /* ---------- koniec gry ---------- */
  function finishGame(winner) {
    if (!S || (winner !== 0 && winner !== 1)) return;
    awaitingContinue = false;
    S.phase = 'gameover';
    delete S.resolvedRoll;
    if (isNet()) clearNetSave(); else lsDel(LS_SAVE);
    stopNetStream();
    netQ = [];
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
    if (['solo', 'duo', 'net'].indexOf(mode) < 0) return;
    GEN++;
    awaitingContinue = false;
    S = newState(mode, names, bias);
    dice.setTuning(S.bias);
    HUD.hideStart();
    HUD.hideWin();
    HUD.closeSheets();
    HUD.setViewPlayer(mode === 'net' ? NETLOCAL : mode === 'solo' ? 0 : null);
    HUD.buildCards(S);
    HUD.refresh(S);
    HUD.feed({ who: 0, whoName: '', text: mode === 'solo' ? 'Nowa gra: Ty kontra Zenek. Powodzenia!' : mode === 'net' ? 'Połączono dwie zagrody. Powodzenia!' : 'Nowa gra na jednym telefonie. Powodzenia!' });
    syncInsets();
    beginTurn();
  }

  function resumeGame(saved) {
    var restored = readState(saved);
    if (!restored || restored.mode === 'net') return;
    GEN++;
    awaitingContinue = false;
    S = restored;
    S.bias = normTuning(S.bias);
    dice.setTuning(S.bias);
    HUD.hideStart();
    HUD.hideWin();
    HUD.closeSheets();
    HUD.setViewPlayer(S.mode === 'solo' ? 0 : null);
    HUD.buildCards(S);
    HUD.refresh(S);
    HUD.feed({ who: 0, whoName: '', text: 'Wznowiono zapisaną grę (runda ' + S.turnCount + ')' });
    syncInsets();
    restoreTurn();
  }

  function backToMenu() {
    persist();
    GEN++;
    awaitingContinue = false;
    S = null;
    stopNetStream();
    netQ = [];
    HUD.hideWin();
    HUD.closeSheets();
    dice.setInteractive(false);
    HUD.showStart({ canResume: !!loadSave(), resumeLabel: saveLabel(), names: storedNames(), netName: cleanName(lsGet(LS_NETNAME), ''), bias: [0, 0], netResume: netResumeLabel() });
  }

  function storedNames() {
    try {
      var names = JSON.parse(lsGet(LS_NAMES) || 'null');
      return Array.isArray(names) && names.length === 2 && names.every(validName) ? names : null;
    } catch (e) { return null; }
  }

  // Strojenie kostek celowo NIE jest zapamiętywane między sesjami:
  // każdy nowy start zaczyna od kostek uczciwych (suwaki na środku).
  /** Normalizacja strojenia: {m:'w'|'s', v:[a,b]}; legacy tablica = ciężarek. */
  function normTuning(b) {
    if (!validTuning(b)) return { m: 'w', v: [0, 0] };
    return Array.isArray(b) ? { m: 'w', v: b.slice() } : { m: b.m, v: b.v.slice() };
  }

  /* ---------- insets / resize ---------- */
  function syncInsets(insets) {
    if (!dice) return;
    dice.setInsets(insets || HUD.measureInsets());
    var canvas = dice.canvas;
    var width = canvas.clientWidth, height = canvas.clientHeight;
    if (!(width > 0 && height > 0) || (width === canvasWidth && height === canvasHeight)) return;
    // Powiększanie tekstu zmienia też obszar sceny, bez window.resize.
    // Poczekaj na zatwierdzenie rzutu: zmiana hullów w locie lub podczas
    // odtwarzania klatek drugiego telefonu mogłaby zmienić jego przebieg.
    if (dice.isBusy() || dice.remote) return;
    dice.resize();
    canvasWidth = width;
    canvasHeight = height;
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
          dlog('onSettle faces=', faces, 'phase=', S && S.phase, 'cur=', S && S.cur);
          if (!S || S.phase !== 'rolling' || !validFacePair(faces) || (isNet() && !isNetLocalTurn())) { syncInsets(); return; }
          if (isNetLocalTurn()) {
            sendTurnMessage({ t: 'f', d: dice.getNetFrame() });
            sendTurnMessage({ t: 'set', faces: faces });
            stopNetStream();
          }
          resolveRoll(faces);
        },
        onRollError: function (message) { recoverRoll(message, false); syncInsets(); },
        onImpact: function (kind, strength) {
          AUDIO.knock(kind, strength);
          if (navigator.vibrate && strength > 0.35) { try { navigator.vibrate(strength > 0.7 ? 12 : 6); } catch (e) {} }
        },
        onThrow: function () {
          dlog('onThrow phase=', S && S.phase, 'cur=', S && S.cur);
          if (!S || (S.phase !== 'preroll' && S.phase !== 'rolling') || (isNet() && !isNetLocalTurn())) return;
          S.phase = 'rolling';
          persist();
          HUD.swipeHint(false);
          lsSet(LS_TUT, '1');
          HUD.setDock('rolling');
          HUD.dieLabels(null);
          AUDIO.whoosh();
          HUD.closeSheets();
          if (isNetLocalTurn()) {
            sendTurnMessage({ t: 'roll' });
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
        'Ta przeglądarka nie udostępnia grafiki potrzebnej do gry. Odśwież stronę lub otwórz ją w aktualnej przeglądarce.' +
        '</div>';
      return;
    }

    HUD.init({
      onLayoutChange: syncInsets,
      onContinue: continueResolvedTurn,
      onReadabilityChange: function (preferences) {
        if (awaitingContinue && !preferences.calm) continueResolvedTurn();
      },
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
        if (!S || S.phase !== 'preroll' || isBotTurn() || S.exchangeUsed || (isNet() && S.cur !== NETLOCAL)) return;
        var res = RULES.applyExchange(curP().herd, S.stock, rate, dir, times);
        if (!res) return;
        curP().herd = res.herd;
        S.stock = res.stock;
        S.exchangeUsed = true;
        persist();
        if (isNetLocalTurn()) sendTurnMessage({ t: 'ex', id: rate.id, dir: dir, times: times });
        giveSym = dir > 0 ? rate.give : rate.get;
        getSym = dir > 0 ? rate.get : rate.give;
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
        startGame(mode, names, bias);
      },
      onResume: function () {
        AUDIO.unlock(); AUDIO.ui();
        var s = loadSave();
        if (s) resumeGame(s); else startGame('solo', null, [0, 0]);
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
        startGame(S ? S.mode : 'solo', S ? S.players.map(function (p) { return p.name; }) : null, S ? S.bias : [0, 0]);
      },
      onBackToMenu: function () {
        AUDIO.ui();
        if (isNet()) { clearNetSave(); NET.send({ t: 'bye' }); netEnd(null, true); return; }
        backToMenu();
      },
      onBiasPreview: function (bias) {
        if (dice && dice.previewBias) {
          try { dice.previewBias($id('bprevA'), $id('bprevB'), bias); } catch (e) {}
        }
      },
      onNetHost: function (name, bias) {
        AUDIO.unlock();
        if (name) lsSet(LS_NETNAME, name);
        netConnectFlow('host', name, bias);
      },
      onNetResume: function () { AUDIO.unlock(); netConnectFlow('host', null, null, true); },
      onNetJoin: function (name) {
        AUDIO.unlock();
        if (name) lsSet(LS_NETNAME, name);
        netConnectFlow('guest', name, null);
      },
      onNetCancel: function () { netCancel(); }
    });

    if (dice.compatibilityMode) {
      document.documentElement.dataset.renderer = '2d';
      if (HUD.compatibilityMode) HUD.compatibilityMode(true);
    }

    window.addEventListener('resize', function () { syncInsets(); });
    document.addEventListener('pointerdown', function once() {
      AUDIO.unlock();
    }, { capture: true });
    // iOS: blokuj gest przewijania / pull-to-refresh na scenie
    document.addEventListener('touchmove', function (e) {
      if (e.target && e.target.id === 'scene3d') e.preventDefault();
    }, { passive: false });

    syncInsets();
    HUD.showStart({ canResume: !!loadSave(), resumeLabel: saveLabel(), names: storedNames(), netName: cleanName(lsGet(LS_NETNAME), ''), bias: [0, 0], netResume: netResumeLabel() });
    // uchwyt diagnostyczny (devtools)
    window.__SF = { dice: dice, get state() { return S; } };
  }

  // Atlas i sprite'y powstają dopiero po zdekodowaniu ilustracji. Dzięki temu
  // ani cache HUD-u, ani tekstura kostek nie mogą zapamiętać pustego obrazu.
  var artworkLoading = false, booted = false, startChoices = null;
  function startWithArtwork() {
    if (artworkLoading || booted) return;
    artworkLoading = true;
    var choices = document.getElementById('modeButtons');
    if (startChoices === null) startChoices = choices.innerHTML;
    choices.innerHTML = '<p class="sub" role="status">Przygotowuję ilustracje zwierząt…</p>';
    SYMBOLS.load(function () {
      if (!artworkLoading || booted) return;
      artworkLoading = false;
      booted = true;
      choices.innerHTML = startChoices;
      boot();
    }, function () {
      if (!artworkLoading || booted) return;
      artworkLoading = false;
      choices.innerHTML = '<p class="sub" role="alert">Nie udało się wczytać ilustracji zwierząt.</p>' +
        '<button id="btnRetryArtwork" type="button" class="btn pri">Spróbuj ponownie</button>';
      document.getElementById('btnRetryArtwork').onclick = startWithArtwork;
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startWithArtwork);
  } else {
    startWithArtwork();
  }
})();
