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

  function available() {
    return typeof RTCPeerConnection === 'function' && typeof TextEncoder === 'function';
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
    var tag = (typeof CompressionStream === 'function' ? 'S1' : 'S0') + (kind || '') + '.';
    if (typeof CompressionStream !== 'function') {
      return Promise.resolve(tag + b64url(bytes));
    }
    var cs = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Response(cs).arrayBuffer().then(function (buf) {
      return tag + b64url(new Uint8Array(buf));
    });
  }

  function unpackSdp(code) {
    var m = String(code).trim().match(/^(S[01])([OA])?\.([A-Za-z0-9_-]+)$/);
    if (!m) return Promise.reject(new Error('To nie jest kod Superfarmera'));
    var kind = m[2] || null;
    var bytes = unb64url(m[3]);
    var p;
    if (m[1] === 'S1') {
      if (typeof DecompressionStream !== 'function') return Promise.reject(new Error('Przeglądarka nie obsługuje tego kodu'));
      var ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      p = new Response(ds).arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
    } else {
      p = Promise.resolve(bytes);
    }
    return p.then(function (raw) {
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
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      onFail('Brak dostępu do kamery (potrzebne HTTPS)');
      return Promise.resolve(false);
    }
    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    }).then(function (stream) {
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
        timer: setInterval(function () {
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
      onFail(err && err.name === 'NotAllowedError'
        ? 'Nie zezwolono na kamerę — wpisz kod ręcznie'
        : 'Kamera niedostępna — wpisz kod ręcznie');
      return false;
    });
  }

  /** Kamera PRZED ofertą: zgoda na nią odblokowuje w przeglądarce prawdziwe adresy
      lokalne w kandydatach ICE (zamiast pseudonimów mDNS) — łączenie jest pewniejsze.
      Nie czekamy w nieskończoność na dialog zgody. */
  function camFirst(video, onCode, onFail) {
    return Promise.race([
      startScan(video, onCode, onFail),
      new Promise(function (r) { setTimeout(function () { r('pending'); }, 6500); })
    ]);
  }

  function stopScan() {
    if (!scan) return;
    clearInterval(scan.timer);
    try { scan.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    scan = null;
  }

  /* ---------- połączenie ---------- */
  function gathered() {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(function (res) {
      var t = setTimeout(res, 5500); // mDNS/STUN: nie czekamy w nieskończoność
      pc.addEventListener('icegatheringstatechange', function g() {
        if (pc && pc.iceGatheringState === 'complete') { clearTimeout(t); res(); }
      });
    });
  }

  function wireChannel(ch) {
    dc = ch;
    dc.onopen = function () {
      clearTimeout(openTimer);
      if (cb.onOpen) cb.onOpen();
    };
    dc.onclose = function () { fail(); };
    dc.onerror = function () { fail(); };
    dc.onmessage = function (e) {
      var m = null;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m && m.t && cb.onMsg) cb.onMsg(m);
    };
  }

  function watchConnection() {
    pc.onconnectionstatechange = function () {
      if (!pc) return;
      var st = pc.connectionState;
      if (st === 'connected') {
        clearTimeout(graceTimer);
        graceTimer = 0;
        if (cb.onLink) cb.onLink(true);
      } else if (st === 'disconnected') {
        // chwilowy zanik (np. mrugnięcie WiFi) często sam wraca — dajemy 10 s łaski
        if (cb.onLink) cb.onLink(false);
        clearTimeout(graceTimer);
        graceTimer = setTimeout(function () {
          if (pc && pc.connectionState !== 'connected') fail();
        }, 10000);
      } else if (st === 'failed' || st === 'closed') {
        fail();
      }
    };
  }

  function fail() {
    if (closed) return;
    closed = true;
    stopScan();
    clearTimeout(openTimer);
    clearTimeout(graceTimer);
    if (cb.onClose) cb.onClose();
  }

  /* Licznik czasu TYLKO na automatyczną fazę łączenia (po wymianie kodów).
     Na czekanie, aż drugi gracz przepisze/prześle kod, limitu NIE MA —
     wymiana przez komunikator potrafi trwać minuty; od tego jest „anuluj”. */
  function armOpenTimeout(ms) {
    clearTimeout(openTimer);
    openTimer = setTimeout(function () {
      if (dc && dc.readyState === 'open') return;
      if (ui) ui.status('Nie udało się połączyć — spróbujcie jeszcze raz (najpewniej: hotspot z telefonu)');
      fail();
    }, ms || 60000);
  }

  /** Start jako założyciel: tworzy ofertę → pokazuje kod → skanuje/przyjmuje odpowiedź. */
  function startHost(uiEls, callbacks) {
    ui = uiEls; cb = callbacks; closed = false;
    pc = new RTCPeerConnection(CFG);
    watchConnection();
    wireChannel(pc.createDataChannel('sf', { ordered: true }));
    ui.status('Uruchamiam kamerę…');
    camFirst(ui.video, acceptPeerCode, function (msg) { ui.cameraFailed(msg); })
      .then(function () {
        if (closed) return;
        ui.status('Tworzę kod gry…');
        return pc.createOffer()
          .then(function (o) { return pc.setLocalDescription(o); })
          .then(gathered)
          .then(function () { return packSdp(pc.localDescription.sdp, 'O'); })
          .then(function (code) {
            if (closed) return;
            ui.showMyCode(code);
            ui.status('Gracz 2 skanuje ten kod (u siebie: „Dołącz”), a Ty zeskanuj jego odpowiedź poniżej');
          });
      })
      .catch(function (e) { ui.status('Błąd: ' + (e && e.message || e)); fail(); });
  }

  /** Start jako dołączający: skanuje kod founderа → odsyła własny kod-odpowiedź. */
  function startGuest(uiEls, callbacks) {
    ui = uiEls; cb = callbacks; closed = false;
    pc = new RTCPeerConnection(CFG);
    watchConnection();
    pc.ondatachannel = function (e) { wireChannel(e.channel); };
    ui.status('Zeskanuj kod z telefonu założyciela');
    startScan(ui.video, acceptPeerCode, function (msg) { ui.cameraFailed(msg); });
  }

  var lastRejected = '', lastRejectedAt = 0;

  function rescan() {
    if (!ui || closed) return;
    startScan(ui.video, acceptPeerCode, function (msg) { ui.cameraFailed(msg); });
  }

  function rejectCode(code, msg) {
    lastRejected = code;
    lastRejectedAt = Date.now();
    if (ui) ui.status(msg);
    rescan();
  }

  /** Przyjmij kod od drugiej strony (ze skanera albo wklejony ręcznie). */
  function acceptPeerCode(code) {
    if (!pc || closed) return;
    code = String(code).trim();
    unpackSdp(code).then(function (res) {
      var isHost = !!(pc.localDescription && pc.localDescription.type === 'offer');
      if (isHost && res.kind === 'O') {
        rejectCode(code, 'To kod ZAŁOŻYCIELA gry (może Twój własny?). Drugi gracz nie zakłada swojej — on tapa „Dołącz”, skanuje kod z TWOJEGO ekranu, a Ty potem jego odpowiedź.');
        return;
      }
      if (!isHost && res.kind === 'A') {
        rejectCode(code, 'To kod-ODPOWIEDŹ. Jako dołączający zeskanuj pierwszy kod — ten z ekranu założyciela.');
        return;
      }
      if (isHost) {
        // odpowiedź — od teraz łączenie jest automatyczne
        ui.status('Łączę…');
        armOpenTimeout(60000);
        return pc.setRemoteDescription({ type: 'answer', sdp: res.sdp }).catch(function (e) {
          clearTimeout(openTimer);
          rejectCode(code, 'Nie udało się przyjąć odpowiedzi — zeskanuj ją jeszcze raz. (' + e.message + ')');
        });
      }
      // jesteśmy gościem: oferta → tworzymy odpowiedź
      ui.status('Odpowiadam…');
      return pc.setRemoteDescription({ type: 'offer', sdp: res.sdp })
        .then(function () { return pc.createAnswer(); })
        .then(function (a) { return pc.setLocalDescription(a); })
        .then(gathered)
        .then(function () { return packSdp(pc.localDescription.sdp, 'A'); })
        .then(function (myCode) {
          if (closed) return;
          stopScan();
          ui.showMyCode(myCode);
          ui.status('Pokaż ten kod założycielowi (albo mu go wyślij) — po jego przyjęciu gra ruszy sama');
        })
        .catch(function (e) {
          rejectCode(code, 'Nie udało się przyjąć kodu — zeskanuj jeszcze raz. (' + e.message + ')');
        });
    }).catch(function (e) {
      rejectCode(code, 'Zły kod: ' + e.message);
    });
  }

  function send(m) {
    if (dc && dc.readyState === 'open') {
      try { dc.send(JSON.stringify(m)); } catch (e) {}
    }
  }

  function close() {
    closed = true;
    stopScan();
    clearTimeout(openTimer);
    clearTimeout(graceTimer);
    try { if (dc) { dc.onclose = null; dc.close(); } } catch (e) {}
    try { if (pc) { pc.onconnectionstatechange = null; pc.close(); } } catch (e) {}
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
