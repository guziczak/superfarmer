// Dowód: każda ścianka k12 ma ściankę dokładnie przeciwległą i równoległą.
// node dev/check-parallel.mjs
const PHI = (1 + Math.sqrt(5)) / 2;
const norm = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// identyczna konstrukcja normalnych jak w src/dice3d.js
const s = [1, -1];
const fnRaw = [];
for (const i of s) for (const j of s) {
  fnRaw.push([0, i, j * PHI]);
  fnRaw.push([i, j * PHI, 0]);
  fnRaw.push([i * PHI, 0, j]);
}
const normals = fnRaw.map(norm);

// wierzchołki i płaszczyzny ścianek (h musi być identyczne dla wszystkich)
const vs = [];
for (const i of s) for (const j of s) for (const k of s) vs.push([i, j, k]);
for (const i of s) for (const j of s) {
  vs.push([0, i / PHI, j * PHI]);
  vs.push([i / PHI, j * PHI, 0]);
  vs.push([i * PHI, 0, j / PHI]);
}

let worstPair = 1, worstH = 0;
const hs = [];
for (let i = 0; i < 12; i++) {
  // najbliższa -n_i
  let best = 1;
  for (let j = 0; j < 12; j++) {
    if (j !== i) best = Math.min(best, dot(normals[i], normals[j]));
  }
  worstPair = Math.min(worstPair, -best); // 1.0 = idealnie antyrównoległa para
  // odległość płaszczyzny ścianki (max po wierzchołkach)
  let h = -1e9;
  for (const v of vs) h = Math.max(h, dot(v, normals[i]));
  hs.push(h);
}
const hMin = Math.min(...hs), hMax = Math.max(...hs);
console.log('Antyrównoległość najgorszej pary ścianek: dot(n_i, n_j) = -' + worstPair.toFixed(15));
console.log('  (dokładnie -1 = idealnie równoległe, przeciwległe)');
console.log('Odległości płaszczyzn 12 ścianek od środka: min=' + hMin.toFixed(15) + ' max=' + hMax.toFixed(15));
console.log('  (identyczne => bryła foremna, każda ścianka tak samo daleko)');
console.log('Różnica h: ' + (hMax - hMin).toExponential(3));
if (Math.abs(worstPair - 1) < 1e-12 && Math.abs(hMax - hMin) < 1e-12) {
  console.log('\nOK: 6 par ścianek DOKŁADNIE równoległych, bryła foremna.');
} else {
  console.log('\nBŁĄD GEOMETRII!');
  process.exit(1);
}
