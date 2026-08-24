// Dowód sygnalizacji: SDP → slim → deflate → base64url → QR → skan (jsQR) →
// unpack → identyczny SDP. Na prawdziwych modułach gry (src/net.js + vendor).
// node dev/qr-test.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const qrcode = require('../vendor/qrcode.js');
const jsQR = require('../vendor/jsQR.js');
const NET = require('../src/net.js');

// realistyczna oferta DataChannel (Chrome-podobna, z kandydatami mDNS + srflx + tcp)
const SDP = [
  'v=0',
  'o=- 519734409171677154 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=application 53412 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 192.168.1.23',
  'a=candidate:2999745851 1 udp 2122260223 f3b2ae59-9a1f-4c9e-8b3a-a77f2f6c4de1.local 53412 typ host generation 0 network-id 1',
  'a=candidate:1510613869 1 udp 1686052607 89.64.112.7 53412 typ srflx raddr 0.0.0.0 rport 0 generation 0 network-id 1',
  'a=candidate:3345120395 1 tcp 1518280447 f3b2ae59-9a1f-4c9e-8b3a-a77f2f6c4de1.local 9 typ host tcptype active generation 0 network-id 1',
  'a=ice-ufrag:Xp9F',
  'a=ice-pwd:cJ8kQmVtR2sLuA4dHy6wEbZn',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 7B:8B:F0:65:5F:78:E2:51:3B:AC:6F:F3:3F:46:1B:35:DC:B8:5F:64:1A:24:C2:43:F0:A1:58:D0:A8:9C:19:44',
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144'
].join('\r\n') + '\r\n';

let fails = 0;
const ok = (name, cond) => { console.log((cond ? 'ok  ' : 'FAIL'), name); if (!cond) fails++; };

// 1. pack → unpack round-trip
const code = await NET._packSdp(SDP);
console.log(`kod: ${code.length} znaków (${code.slice(0, 24)}…)`);
ok('kod ma prefiks S1/S0', /^S[01]\./.test(code));
ok('kod jest zwięzły (<800 znaków)', code.length < 800);
const back = await NET._unpackSdp(code);
const slim = NET._slimSdp(SDP).split('\n').join('\r\n') + '\r\n';
ok('unpack == slim(SDP)', back === slim);
ok('slim zachował ufrag/pwd/fingerprint/sctp', ['a=ice-ufrag:Xp9F', 'a=ice-pwd:cJ8kQmVtR2sLuA4dHy6wEbZn', 'a=fingerprint:sha-256', 'a=sctp-port:5000', 'm=application'].every((s) => back.includes(s)));
ok('slim wyciął kandydata TCP', !back.includes(' tcp '));
ok('slim zachował kandydatów UDP (host mDNS + srflx)', (back.match(/a=candidate/g) || []).length === 2);

// 2. QR: matryca → piksele → jsQR
const qr = qrcode(0, 'M');
qr.addData(code);
qr.make();
const n = qr.getModuleCount();
const quiet = 4, px = 4;
const size = (n + quiet * 2) * px;
const img = new Uint8ClampedArray(size * size * 4).fill(255);
for (let r = 0; r < n; r++) {
  for (let c = 0; c < n; c++) {
    if (!qr.isDark(r, c)) continue;
    for (let dy = 0; dy < px; dy++) {
      for (let dx = 0; dx < px; dx++) {
        const x = (c + quiet) * px + dx, y = (r + quiet) * px + dy;
        const i = (y * size + x) * 4;
        img[i] = img[i + 1] = img[i + 2] = 0;
      }
    }
  }
}
console.log(`QR: wersja ${(n - 17) / 4} (${n}×${n} modułów)`);
const scanned = jsQR(img, size, size, { inversionAttempts: 'dontInvert' });
ok('jsQR odczytał kod z pikseli', !!scanned);
ok('odczyt == oryginał', scanned && scanned.data === code);

// 3. pełne domknięcie: zeskanowany kod → unpack → slim SDP
if (scanned) {
  const sdp2 = await NET._unpackSdp(scanned.data);
  ok('SDP po pełnej pętli identyczny', sdp2 === slim);
}

console.log(fails ? `\n${fails} FAILED` : '\nWSZYSTKO OK: sygnalizacja QR domknięta bez straty.');
process.exit(fails ? 1 : 0);
