/* ============================================================
   SUPERFARMER — gra przez sieć: WebRTC DataChannel, sygnalizacja
   przez kody QR (albo wklejenie kodu ręcznie). Zero serwera gry:
   telefony łączą się bezpośrednio (P2P) po wspólnym WiFi/hotspocie.
   Wymaga globali: qrcode (generator), jsQR (skaner).
   Global: NET
   ============================================================ */
var NET = (function () {
  'use strict';

  var CFG = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };
  var pc = null, dc = null, ui = null, cb = {}, closed = true, openTimer = 0, graceTimer = 0;
  var scan = null;
  var scanGeneration = 0;
  var peerGeneration = 0;
  var cancelCameraWait = null, cancelIceWait = null;
  var acceptingCode = false;
  var MAX_CODE = 16000, MAX_SDP = 32768, MAX_MESSAGE = 65536;

  function available() {
    return typeof RTCPeerConnection === 'function' && typeof TextEncoder === 'function';
  }

  // Samo `closed` nie wystarcza: po anulowaniu może już trwać nowe parowanie.
  function currentPeer(target, generation) {
    return !closed && pc === target && peerGeneration === generation;
  }

  function cancelWaits() {
    if (cancelCameraWait) cancelCameraWait();
    if (cancelIceWait) cancelIceWait();
  }

  /* ---------- pakowanie SDP do kodu QR ----------
     Zostawiamy tylko linie niezbędne dla kanału danych (bez kandydatów TCP),
     potem deflate-raw + base64url. Prefiks S1/S0 mówi, czy było skompresowane. */
  var KEEP = /^(v=|o=|s=|t=|m=|c=|a=group|a=ice-ufrag|a=ice-pwd|a=ice-options|a=fingerprint|a=setup|a=mid|a=sctp-port|a=max-message-size|a=candidate)/;

  function slimSdp(sdp) {
    return sdp.split(/\r?\n/).filter(function (l) {
      if (!l || !KEEP.test(l)) return false;
      if (/^a=candidate/.test(l) && /\stcp\s/i.test(l)) return false;
      return true;
    }).join('\n');
  }

  function b64url(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function unb64url(str) {
    var b = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    var bin = atob(b), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* kind: 'O' = oferta założyciela, 'A' = odpowiedź dołączającego — wpisany
     w prefiks kodu, żeby pomyłkę (dwóch hostów, własny kod) wykryć PO POLSKU,
     zanim WebRTC wypluje kryptyczny błąd. */
  function packSdp(sdp, kind) {
    var bytes = new TextEncoder().encode(slimSdp(sdp));
    var tag = 'S0' + (kind || '') + '.';
    if (typeof CompressionStream !== 'function') {
      return Promise.resolve(tag + b64url(bytes));
    }
    try {
      var cs = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return new Response(cs).arrayBuffer().then(function (buf) {
        return 'S1' + (kind || '') + '.' + b64url(new Uint8Array(buf));
      }).catch(function () { return tag + b64url(bytes); });
    } catch (err) { return Promise.resolve(tag + b64url(bytes)); }
  }

  function unpackSdp(code) {
    if (typeof code !== 'string' || code.length > MAX_CODE) return Promise.reject(new Error('Kod jest zbyt długi lub nieprawidłowy'));
    var m = String(code).trim().match(/^(S[01])([OA])?\.([A-Za-z0-9_-]+)$/);
    if (!m) return Promise.reject(new Error('To nie jest kod Superfarmera'));
    var kind = m[2] || null;
    var bytes;
    try { bytes = unb64url(m[3]); } catch (err) { return Promise.reject(new Error('Kod jest uszkodzony — skopiuj go ponownie')); }
    var p;
    if (m[1] === 'S1') {
      if (typeof DecompressionStream !== 'function') return Promise.reject(new Error('Przeglądarka nie obsługuje tego kodu'));
      try {
        var reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
        var chunks = [], total = 0;
        var readNext = function () {
          return reader.read().then(function (part) {
            if (part.done) {
              var raw = new Uint8Array(total), at = 0;
              chunks.forEach(function (chunk) { raw.set(chunk, at); at += chunk.length; });
              return raw;
            }
            total += part.value.length;
            if (total > MAX_SDP) { reader.cancel().catch(function () {}); throw new Error('Kod zawiera zbyt dużo danych'); }
            chunks.push(part.value);
            return readNext();
          });
        };
        p = readNext();
      } catch (err) { return Promise.reject(new Error('Przeglądarka nie obsługuje tego kodu')); }
    } else {
      p = Promise.resolve(bytes);
    }
    return p.then(function (raw) {
      if (raw.length > MAX_SDP) throw new Error('Kod zawiera zbyt dużo danych');
      return { sdp: new TextDecoder().decode(raw).split('\n').join('\r\n') + '\r\n', kind: kind };
    });
  }

  /* ---------- QR: rysowanie i skanowanie ---------- */
  function drawQR(canvas, text) {
    var qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    var n = qr.getModuleCount();
    var quiet = 4;
    var px = Math.max(3, Math.floor(768 / (n + quiet * 2)));
    var size = (n + quiet * 2) * px;
    canvas.width = size;
    canvas.height = size;
    var c = canvas.getContext('2d');
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, size, size);
    c.fillStyle = '#1a120a';
    for (var r = 0; r < n; r++) {
      for (var col = 0; col < n; col++) {
        if (qr.isDark(r, col)) c.fillRect((col + quiet) * px, (r + quiet) * px, px, px);
      }
    }
  }

  function startScan(video, onCode, onFail) {
    stopScan();
    var generation = scanGeneration;
    var target = pc, peer = peerGeneration;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      onFail('Brak dostępu do kamery (potrzebne HTTPS)');
      return Promise.resolve(false);
    }
    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    }).then(function (stream) {
      if (generation !== scanGeneration || !currentPeer(target, peer)) {
        stream.getTracks().forEach(function (track) { track.stop(); });
        return false;
      }
      video.srcObject = stream;
      video.muted = true;
      video.setAttribute('playsinline', '');
      var pv = video.play();
      if (pv && pv.catch) pv.catch(function () {});
      // poproś o ciągły autofokus, jeśli kamera go ma (telefony tak, laptopy zwykle nie)
      try {
        var track = stream.getVideoTracks()[0];
        var caps = track.getCapabilities ? track.getCapabilities() : {};
        if (caps.focusMode && caps.focusMode.indexOf('continuous') >= 0) {
          track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(function () {});
        }
      } catch (e) {}
      var cv = document.createElement('canvas');
      var cx = cv.getContext('2d', { willReadFrequently: true });
      var hi = false;
      scan = {
        stream: stream,
        video: video,
        timer: setInterval(function () {
          if (generation !== scanGeneration || !currentPeer(target, peer)) return;
          if (!video.videoWidth) return;
          // na przemian: szybki skan 640px i pełna rozdzielczość — QR trzymany
          // daleko od kamery (laptop ze stałą ostrością!) potrzebuje dużo pikseli
          hi = !hi;
          var w = Math.min(hi ? 1280 : 640, video.videoWidth);
          var h = Math.round(video.videoHeight * w / video.videoWidth);
          cv.width = w; cv.height = h;
          cx.drawImage(video, 0, 0, w, h);
          var img = cx.getImageData(0, 0, w, h);
          var res = null;
          try { res = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' }); } catch (e) {}
          if (res && res.data && /^S[01][OA]?\./.test(res.data.trim())) {
            var code = res.data.trim();
            // odrzucony przed chwilą kod (np. własny/założyciela) — skanuj dalej
            if (code === lastRejected && Date.now() - lastRejectedAt < 4000) return;
            stopScan();
            onCode(code);
          }
        }, 180)
      };
      return true;
    }).catch(function (err) {
      if (generation !== scanGeneration || !currentPeer(target, peer)) return false;
      onFail(err && err.name === 'NotAllowedError'
        ? 'Nie zezwolono na kamerę — wpisz kod ręcznie'
        : 'Kamera niedostępna — wpisz kod ręcznie');
      return false;
    });
  }

  /** Kamera PRZED ofertą: zgoda na nią odblokowuje w przeglądarce prawdziwe adresy
      lokalne w kandydatach ICE (zamiast pseudonimów mDNS) — łączenie jest pewniejsze.
      Nie czekamy w nieskończoność na dialog zgody. */
  function camFirst(video, onCode, onFail, target, generation) {
    return new Promise(function (resolve) {
      var settled = false;
      var finish = function (result) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (cancelCameraWait === cancel) cancelCameraWait = null;
        resolve(result);
      };
      var cancel = function () { finish(false); };
      var timer = setTimeout(function () { finish(currentPeer(target, generation) ? 'pending' : false); }, 6500);
      cancelCameraWait = cancel;
      startScan(video, onCode, onFail).then(function (result) {
        finish(currentPeer(target, generation) ? result : false);
      }, function () { finish(false); });
    });
  }

  function stopScan() {
    scanGeneration++;
    if (!scan) return;
    clearInterval(scan.timer);
    try { scan.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    try { scan.video.srcObject = null; } catch (e) {}
    scan = null;
  }

  /* ---------- połączenie ---------- */
  function gathered(target, generation) {
    if (!currentPeer(target, generation) || target.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(function (res) {
      var settled = false;
      var finish = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        target.removeEventListener('icegatheringstatechange', changed);
        if (cancelIceWait === finish) cancelIceWait = null;
        res();
      };
      var changed = function () {
        if (!currentPeer(target, generation) || target.iceGatheringState === 'complete') finish();
      };
      var timer = setTimeout(finish, 5500); // mDNS/STUN: nie czekamy w nieskończoność
      cancelIceWait = finish;
      target.addEventListener('icegatheringstatechange', changed);
      changed();
    });
  }

  function wireChannel(ch, target, generation) {
    if (!currentPeer(target, generation)) {
      try { ch.close(); } catch (e) {}
      return;
    }
    dc = ch;
    var isCurrent = function () { return currentPeer(target, generation) && dc === ch; };
    ch.onopen = function () {
      if (!isCurrent()) return;
      clearTimeout(openTimer);
      if (cb.onOpen) cb.onOpen();
    };
    ch.onclose = function () { if (isCurrent()) fail(target, generation); };
    ch.onerror = function () { if (isCurrent()) fail(target, generation); };
    ch.onmessage = function (e) {
      if (!isCurrent() || typeof e.data !== 'string' || e.data.length > MAX_MESSAGE) return;
      var m = null;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m && typeof m === 'object' && !Array.isArray(m) && typeof m.t === 'string' && cb.onMsg) cb.onMsg(m);
    };
  }

  function watchConnection(target, generation) {
    target.onconnectionstatechange = function () {
      if (!currentPeer(target, generation)) return;
      var st = target.connectionState;
      if (st === 'connected') {
        clearTimeout(graceTimer);
        graceTimer = 0;
        if (cb.onLink) cb.onLink(true);
      } else if (st === 'disconnected') {
        // chwilowy zanik (np. mrugnięcie WiFi) często sam wraca — dajemy 10 s łaski
        if (cb.onLink) cb.onLink(false);
        if (!currentPeer(target, generation)) return;
        clearTimeout(graceTimer);
        graceTimer = setTimeout(function () {
          if (currentPeer(target, generation) && target.connectionState !== 'connected') fail(target, generation);
        }, 10000);
      } else if (st === 'failed' || st === 'closed') {
        fail(target, generation);
      }
    };
  }

  function fail(target, generation) {
    if (!currentPeer(target, generation)) return;
    closed = true;
    stopScan();
    clearTimeout(openTimer);
    clearTimeout(graceTimer);
    cancelWaits();
    if (cb.onClose) cb.onClose();
  }

  /* Licznik czasu TYLKO na automatyczną fazę łączenia (po wymianie kodów).
     Na czekanie, aż drugi gracz przepisze/prześle kod, limitu NIE MA —
     wymiana przez komunikator potrafi trwać minuty; od tego jest „anuluj”. */
  function armOpenTimeout(target, generation, ms) {
    if (!currentPeer(target, generation)) return;
    clearTimeout(openTimer);
    openTimer = setTimeout(function () {
      if (!currentPeer(target, generation)) return;
      if (dc && dc.readyState === 'open') return;
      if (ui) ui.status('Nie udało się połączyć — spróbujcie jeszcze raz (najpewniej: hotspot z telefonu)');
      fail(target, generation);
    }, ms || 60000);
  }

  /** Start jako założyciel: tworzy ofertę → pokazuje kod → skanuje/przyjmuje odpowiedź. */
  function startHost(uiEls, callbacks) {
    close();
    var target = new RTCPeerConnection(CFG), generation = peerGeneration;
    ui = uiEls; cb = callbacks; closed = false;
    pc = target;
    watchConnection(target, generation);
    wireChannel(target.createDataChannel('sf', { ordered: true }), target, generation);
    uiEls.status('Uruchamiam kamerę…');
    return camFirst(uiEls.video, function (code) {
      if (currentPeer(target, generation)) acceptPeerCode(code);
    }, function (msg) {
      if (currentPeer(target, generation)) uiEls.cameraFailed(msg);
    }, target, generation)
      .then(function () {
        if (!currentPeer(target, generation)) return;
        uiEls.status('Tworzę kod gry…');
        return target.createOffer()
          .then(function (o) {
            if (currentPeer(target, generation)) return target.setLocalDescription(o);
          })
          .then(function () { return gathered(target, generation); })
          .then(function () {
            if (currentPeer(target, generation)) return packSdp(target.localDescription.sdp, 'O');
          })
          .then(function (code) {
            if (!currentPeer(target, generation)) return;
            uiEls.showMyCode(code);
            uiEls.status('Gracz 2 skanuje ten kod (u siebie: „Dołącz”), a Ty zeskanuj jego odpowiedź poniżej');
          });
      })
      .catch(function (e) {
        if (!currentPeer(target, generation)) return;
        uiEls.status('Błąd: ' + (e && e.message || e));
        fail(target, generation);
      });
  }

  /** Start jako dołączający: skanuje kod founderа → odsyła własny kod-odpowiedź. */
  function startGuest(uiEls, callbacks) {
    close();
    var target = new RTCPeerConnection(CFG), generation = peerGeneration;
    ui = uiEls; cb = callbacks; closed = false;
    pc = target;
    watchConnection(target, generation);
    target.ondatachannel = function (e) { wireChannel(e.channel, target, generation); };
    uiEls.status('Zeskanuj kod z telefonu założyciela');
    return startScan(uiEls.video, function (code) {
      if (currentPeer(target, generation)) acceptPeerCode(code);
    }, function (msg) {
      if (currentPeer(target, generation)) uiEls.cameraFailed(msg);
    });
  }

  var lastRejected = '', lastRejectedAt = 0;

  function rescan(target, generation) {
    if (!currentPeer(target, generation)) return;
    var view = ui;
    startScan(view.video, function (code) {
      if (currentPeer(target, generation)) acceptPeerCode(code);
    }, function (msg) {
      if (currentPeer(target, generation)) view.cameraFailed(msg);
    });
  }

  function rejectCode(code, msg, target, generation) {
    if (!currentPeer(target, generation)) return;
    lastRejected = code;
    lastRejectedAt = Date.now();
    if (ui) ui.status(msg);
    rescan(target, generation);
  }

  /** Przyjmij kod od drugiej strony (ze skanera albo wklejony ręcznie). */
  function acceptPeerCode(code) {
    if (!pc || closed || acceptingCode || isOpen()) return;
    acceptingCode = true;
    var target = pc, generation = peerGeneration, view = ui;
    code = String(code).trim();
    return unpackSdp(code).then(function (res) {
      if (!currentPeer(target, generation)) return;
      var isHost = !!(target.localDescription && target.localDescription.type === 'offer');
      if (isHost && res.kind === 'O') {
        rejectCode(code, 'To kod ZAŁOŻYCIELA gry (może Twój własny?). Drugi gracz nie zakłada swojej — on tapa „Dołącz”, skanuje kod z TWOJEGO ekranu, a Ty potem jego odpowiedź.', target, generation);
        return;
      }
      if (!isHost && res.kind === 'A') {
        rejectCode(code, 'To kod-ODPOWIEDŹ. Jako dołączający zeskanuj pierwszy kod — ten z ekranu założyciela.', target, generation);
        return;
      }
      if (isHost) {
        // odpowiedź — od teraz łączenie jest automatyczne
        view.status('Łączę…');
        armOpenTimeout(target, generation, 60000);
        return target.setRemoteDescription({ type: 'answer', sdp: res.sdp }).catch(function (e) {
          if (!currentPeer(target, generation)) return;
          clearTimeout(openTimer);
          rejectCode(code, 'Nie udało się przyjąć odpowiedzi — zeskanuj ją jeszcze raz. (' + e.message + ')', target, generation);
        });
      }
      // jesteśmy gościem: oferta → tworzymy odpowiedź
      view.status('Odpowiadam…');
      return target.setRemoteDescription({ type: 'offer', sdp: res.sdp })
        .then(function () {
          if (currentPeer(target, generation)) return target.createAnswer();
        })
        .then(function (a) {
          if (currentPeer(target, generation)) return target.setLocalDescription(a);
        })
        .then(function () { return gathered(target, generation); })
        .then(function () {
          if (currentPeer(target, generation)) return packSdp(target.localDescription.sdp, 'A');
        })
        .then(function (myCode) {
          if (!currentPeer(target, generation)) return;
          stopScan();
          view.showMyCode(myCode);
          view.status('Pokaż ten kod założycielowi (albo mu go wyślij) — po jego przyjęciu gra ruszy sama');
        })
        .catch(function (e) {
          if (!currentPeer(target, generation)) return;
          rejectCode(code, 'Nie udało się przyjąć kodu — zeskanuj jeszcze raz. (' + e.message + ')', target, generation);
        });
    }).catch(function (e) {
      if (!currentPeer(target, generation)) return;
      rejectCode(code, 'Zły kod: ' + e.message, target, generation);
    }).finally(function () { if (currentPeer(target, generation)) acceptingCode = false; });
  }

  function send(m) {
    if (dc && dc.readyState === 'open') {
      // Pomiń wyłącznie przestarzałą klatkę animacji, nigdy ruch ani wynik.
      if (m && m.t === 'f' && dc.bufferedAmount > 262144) return;
      try { dc.send(JSON.stringify(m)); } catch (e) {}
    }
  }

  function close() {
    closed = true;
    peerGeneration++;
    acceptingCode = false;
    stopScan();
    clearTimeout(openTimer);
    clearTimeout(graceTimer);
    openTimer = graceTimer = 0;
    cancelWaits();
    try {
      if (dc) { dc.onopen = dc.onclose = dc.onerror = dc.onmessage = null; dc.close(); }
    } catch (e) {}
    try {
      if (pc) { pc.onconnectionstatechange = pc.ondatachannel = null; pc.close(); }
    } catch (e) {}
    lastRejected = ''; lastRejectedAt = 0;
    dc = null; pc = null; ui = null; cb = {};
  }

  function isOpen() { return !!(dc && dc.readyState === 'open'); }

  return {
    available: available,
    startHost: startHost,
    startGuest: startGuest,
    acceptPeerCode: acceptPeerCode,
    drawQR: drawQR,
    stopScan: stopScan,
    send: send,
    close: close,
    isOpen: isOpen,
    _packSdp: packSdp,     // eksport do testów w node
    _unpackSdp: unpackSdp,
    _slimSdp: slimSdp,
    _pc: function () { return pc; }
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = NET;
