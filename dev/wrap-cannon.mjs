// Generuje vendor/cannon-es.global.js (global CANNON) z buildu CJS.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let src = readFileSync(join(root, 'vendor', 'cannon-es.cjs.js'), 'utf8');

// nodowy polyfill perf_hooks → przeglądarkowe performance
src = src.replace(
  "const performance = require('perf_hooks') && require('perf_hooks').performance || {};",
  "const performance = (typeof globalThis !== 'undefined' && globalThis.performance) || {};"
);
if (src.includes('require(')) {
  console.error('BŁĄD: w źródle zostało require()');
  process.exit(1);
}
const out = '/* cannon-es 0.20.0 — opakowane do globala CANNON */\n'
  + 'var CANNON=(function(){var exports={};\n'
  + src.replace(/^'use strict';\s*/, '')
  + '\nreturn exports;})();\n';
writeFileSync(join(root, 'vendor', 'cannon-es.global.js'), out);
console.log('ok', out.length);
