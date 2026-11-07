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
// Ilustracje są częścią obu samodzielnych dokumentów, również w trybie offline.
const animalArt = readFileSync(join(root, 'assets/animals.webp'));
if (!animalArt.length) throw new Error('assets/animals.webp: pusty plik ilustracji');
if (animalArt.length < 12 || animalArt.toString('ascii', 0, 4) !== 'RIFF' || animalArt.toString('ascii', 8, 12) !== 'WEBP') {
  throw new Error('assets/animals.webp: plik nie jest obrazem WebP');
}
const artMarker = "'__ANIMAL_ART_DATA__'";
const symbolsSource = read('src/symbols.js');
if (symbolsSource.split(artMarker).length !== 2) {
  throw new Error('symbols.js: oczekiwano dokładnie jednego znacznika ilustracji');
}
const bundledSymbols = symbolsSource.replace(artMarker, JSON.stringify('data:image/webp;base64,' + animalArt.toString('base64')));
const srcs = ['symbols.js', 'rules.js', 'audio.js', 'ai.js', 'net.js', 'dice3d.js', 'hud.js', 'main.js']
  .map((f) => `/* ===== src/${f} ===== */\n` + (f === 'symbols.js' ? bundledSymbols : read('src/' + f)))
  .join('\n\n');

for (const chunk of [three, cannon, qrgen, jsqr, srcs]) {
  if (chunk.includes('</scr' + 'ipt>')) throw new Error('kod zawiera </scr' + 'ipt> — złamałby inline');
}

// Systemowe kroje: szybki start i identyczna dostępność także offline.
const fonts = '';

const iconSVG = read('src/icon.svg');
const faviconSVG = `data:image/svg+xml,${encodeURIComponent(iconSVG)}`;

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
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#183d32">
<meta name="description" content="Przy jednym stole. Rzucaj prawdziwymi kostkami, rozwijaj stado i graj z Zenkiem albo we dwoje — również offline.">
<meta name="color-scheme" content="light">
<meta name="application-name" content="Superfarmer">
<title>Superfarmer — przy jednym stole</title>
<link rel="icon" href="${faviconSVG}">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
${fonts}
<style>${css}</style>
</head>
<body>
<noscript><p style="padding:32px;font:18px system-ui;color:#183d32;background:#f7f3e8">Superfarmer potrzebuje JavaScript. Włącz go w przeglądarce i wróć do wspólnego stołu.</p></noscript>
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
const sw = read('src/sw.js').replace('__BUILD_ID__', ver);
writeFileSync(join(root, 'sw.js'), sw);

writeFileSync(join(root, 'manifest.webmanifest'), JSON.stringify({
  name: 'Superfarmer — przy jednym stole',
  short_name: 'Superfarmer',
  display: 'standalone',
  lang: 'pl',
  description: 'Fizyczne kostki, wspólne stado i rozgrywka offline.',
  background_color: '#f7f3e8',
  theme_color: '#183d32',
  scope: './',
  id: './',
  categories: ['games'],
  start_url: './',
  icons: [
    { src: './icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
    { src: './icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    { src: './icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
  ]
}, null, 1));

writeFileSync(join(root, 'icon.svg'), iconSVG);

/* ---------- wariant artefaktowy (bez szkieletu) ---------- */
const artifact = `<title>Superfarmer — przy jednym stole</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${fonts}
<style>${css}</style>
${markup}
${scripts}
`;
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'superfarmer.artifact.html'), artifact);

console.log('index.html:', (index.length / 1024).toFixed(0) + ' KB');
console.log('dist/superfarmer.artifact.html:', (artifact.length / 1024).toFixed(0) + ' KB');
