// Budowa: node build.mjs
// Tworzy:
//   index.html                — samodzielny plik (działa z file:// i dowolnego hostingu)
//   dist/superfarmer.artifact.html — wariant do publikacji jako Artifact (bez szkieletu dokumentu)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

/* ---------- vendor ---------- */
let three = read('vendor/three.min.js');
// zdejmij ostrzeżenie o deprecjacji buildu UMD (świadomie go używamy)
three = three.replace(/console\.warn\(\s*["']Scripts? ["“][^)]*deprecated[^)]*\)/i, 'void 0');

let cannon = read('vendor/cannon-es.cjs.js');
cannon = cannon.replace(
  "const performance = require('perf_hooks') && require('perf_hooks').performance || {};",
  "const performance = (typeof globalThis !== 'undefined' && globalThis.performance) || {};"
);
if (cannon.includes("require(")) throw new Error('cannon: zostało require()');
cannon = '/* cannon-es 0.20.0 — global CANNON */\nvar CANNON=(function(){var exports={};\n'
  + cannon.replace(/^'use strict';\s*/, '')
  + '\nreturn exports;})();';

const qrgen = read('vendor/qrcode.js');
const jsqr = read('vendor/jsQR.js');

/* ---------- źródła ---------- */
const css = read('src/style.css');
const markup = read('src/markup.html');
const srcs = ['symbols.js', 'rules.js', 'audio.js', 'ai.js', 'net.js', 'dice3d.js', 'hud.js', 'main.js']
  .map((f) => `/* ===== src/${f} ===== */\n` + read('src/' + f))
  .join('\n\n');

for (const chunk of [three, cannon, qrgen, jsqr, srcs]) {
  if (chunk.includes('</scr' + 'ipt>')) throw new Error('kod zawiera </scr' + 'ipt> — złamałby inline');
}

const fonts = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Alfa+Slab+One&family=Asap:wght@400;600;700;800&display=swap">`;

const faviconSVG = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="80" font-size="80">🎲</text></svg>`)}`;

const scripts = `<script>${three}</script>
<script>${cannon}</script>
<script>${qrgen}</script>
<script>${jsqr}</script>
<script>${srcs}</script>`;

/* ---------- index.html (pełny dokument) ---------- */
const index = `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#241a10">
<title>Superfarmer 3D</title>
<link rel="icon" href="${faviconSVG}">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icon.svg">
${fonts}
<style>${css}</style>
</head>
<body>
${markup}
${scripts}
<script>
/* PWA: po pierwszym załadowaniu gra działa offline (np. hotspot bez internetu) */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('./sw.js').catch(function () {});
}
</script>
</body>
</html>
`;
writeFileSync(join(root, 'index.html'), index);

/* ---------- PWA: service worker + manifest + ikona ---------- */
const ver = createHash('md5').update(index).digest('hex').slice(0, 10);
const sw = `// Superfarmer 3D — cache offline (network-first: online zawsze świeża wersja).
const VER = 'sf3d-${ver}';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VER).then((c) => c.addAll(['./'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VER).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then((resp) => {
      if (resp && (resp.ok || resp.type === 'opaque')) {
        const copy = resp.clone();
        caches.open(VER).then((c) => c.put(e.request, copy)).catch(() => {});
      }
      return resp;
    }).catch(() =>
      caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./'))
    )
  );
});
`;
writeFileSync(join(root, 'sw.js'), sw);

writeFileSync(join(root, 'manifest.webmanifest'), JSON.stringify({
  name: 'Superfarmer 3D',
  short_name: 'Superfarmer',
  display: 'standalone',
  background_color: '#241a10',
  theme_color: '#241a10',
  start_url: './',
  icons: [{ src: './icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }]
}, null, 1));

writeFileSync(join(root, 'icon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#241a10"/><path d="M50 13 83 37 70 75 30 75 17 37Z" fill="#f4ecd9" stroke="#8a5716" stroke-width="3" stroke-linejoin="round"/><circle cx="50" cy="51" r="7" fill="#33261b"/><circle cx="38" cy="38" r="4.5" fill="#33261b"/><circle cx="62" cy="38" r="4.5" fill="#33261b"/><circle cx="41" cy="64" r="4.5" fill="#33261b"/><circle cx="59" cy="64" r="4.5" fill="#33261b"/></svg>`);

/* ---------- wariant artefaktowy (bez szkieletu) ---------- */
const artifact = `<title>Superfarmer 3D</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
${fonts}
<style>${css}</style>
${markup}
${scripts}
`;
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'superfarmer.artifact.html'), artifact);

console.log('index.html:', (index.length / 1024).toFixed(0) + ' KB');
console.log('dist/superfarmer.artifact.html:', (artifact.length / 1024).toFixed(0) + ' KB');
