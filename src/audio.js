/* ============================================================
   SUPERFARMER — dźwięk (syntezowany WebAudio, zero plików)
   Global: AUDIO
   ============================================================ */
var AUDIO = (function () {
  'use strict';
  var ctx = null, master = null;
  var enabled = true;

  function ensure() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.85;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  function now() { return ctx.currentTime; }

  function env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  function tone(type, f0, f1, t, a, peak, d, dest) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + a + d);
    env(g, t, a, peak, d);
    o.connect(g); g.connect(dest || master);
    o.start(t); o.stop(t + a + d + 0.05);
  }

  var noiseBuf = null;
  function noise(t, a, peak, d, fLo, fHi, dest) {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      var ch = noiseBuf.getChannelData(0);
      for (var i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    }
    var s = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    s.buffer = noiseBuf;
    s.loop = true;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    f.type = 'bandpass';
    f.frequency.value = (fLo + fHi) / 2;
    f.Q.value = Math.max(0.0001, ((fLo + fHi) / 2) / Math.max(1, fHi - fLo));
    env(g, t, a, peak, d);
    s.connect(f); f.connect(g); g.connect(dest || master);
    s.start(t); s.stop(t + a + d + 0.05);
  }

  function guard(fn) {
    return function () {
      if (!enabled) return;
      if (!ensure()) return;
      try { fn.apply(null, arguments); } catch (e) { /* audio nie może wywalić gry */ }
    };
  }

  return {
    unlock: function () { if (enabled) ensure(); },
    setEnabled: function (on) { enabled = !!on; if (on) ensure(); },
    isEnabled: function () { return enabled; },

    /** stuk kostki: kind = floor|wall|die */
    knock: guard(function (kind, s) {
      var t = now();
      var v = 0.12 + s * 0.5;
      if (kind === 'die') {
        tone('triangle', 2100 + Math.random() * 500, 1500, t, 0.004, v * 0.5, 0.05);
        noise(t, 0.003, v * 0.55, 0.04, 2400, 5200);
      } else if (kind === 'wall') {
        tone('triangle', 240 + Math.random() * 60, 150, t, 0.005, v * 0.9, 0.09);
        noise(t, 0.004, v * 0.5, 0.07, 900, 2400);
      } else {
        tone('sine', 165 + Math.random() * 40, 105, t, 0.006, v, 0.11);
        noise(t, 0.005, v * 0.45, 0.08, 1300, 3200);
      }
    }),

    whoosh: guard(function () {
      var t = now();
      noise(t, 0.10, 0.10, 0.22, 400, 1600);
    }),

    ui: guard(function () {
      var t = now();
      tone('sine', 620, 850, t, 0.012, 0.10, 0.09);
    }),

    gain: guard(function () {
      var t = now();
      tone('triangle', 523, null, t, 0.015, 0.16, 0.22);
      tone('triangle', 784, null, t + 0.09, 0.015, 0.14, 0.26);
    }),

    coin: guard(function () {
      var t = now();
      tone('square', 987, null, t, 0.008, 0.06, 0.08);
      tone('square', 1318, null, t + 0.06, 0.008, 0.07, 0.16);
    }),

    sting: guard(function () {
      var t = now();
      tone('sawtooth', 220, 96, t, 0.03, 0.20, 0.5);
      tone('sawtooth', 262, 116, t + 0.03, 0.03, 0.14, 0.5);
      noise(t, 0.06, 0.12, 0.5, 90, 500);
    }),

    bark: guard(function () {
      var t = now();
      for (var i = 0; i < 2; i++) {
        var tt = t + i * 0.13;
        tone('sawtooth', 400, 190, tt, 0.012, 0.20, 0.08);
        noise(tt, 0.008, 0.12, 0.07, 700, 2200);
      }
    }),

    fanfare: guard(function () {
      var t = now();
      var seq = [392, 523, 659, 784];
      for (var i = 0; i < seq.length; i++) {
        tone('triangle', seq[i], null, t + i * 0.11, 0.02, 0.17, 0.3);
      }
      [523, 659, 784, 1046].forEach(function (f) {
        tone('sine', f, null, t + 0.5, 0.03, 0.10, 0.9);
      });
      noise(t + 0.5, 0.1, 0.05, 0.7, 4000, 9000);
    }),

    lose: guard(function () {
      var t = now();
      var seq = [392, 349, 311, 262];
      for (var i = 0; i < seq.length; i++) {
        tone('triangle', seq[i], null, t + i * 0.16, 0.02, 0.15, 0.34);
      }
    })
  };
})();
