// Kalibracja „szlifu": płaszczyzna ścianki 11 (wilk/lis) przesunięta na dystans h
// (h<1 = ścianka WIĘKSZA i wcięta, h>1 = MNIEJSZA i odsunięta), pozostałe h=1.
// Wierzchołki = przecięcia trójek płaszczyzn ścianek → normalne bez zmian.
// Mierzy rozkład ścianek. Rozstrzyga spór intuicji: powierzchnia vs środek masy.
// node dev/shape-sim.mjs [N=2500] [poziomy h]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const CANNON = require('../vendor/cannon-es.cjs.js');

const PHI = (1 + Math.sqrt(5)) / 2;
function buildDodeca() {
  const vs = [];
  const s = [1, -1];
  for (const i of s) for (const j of s) for (const k of s) vs.push([i, j, k]);
  for (const i of s) for (const j of s) {
    vs.push([0, i / PHI, j * PHI]);
    vs.push([i / PHI, j * PHI, 0]);
    vs.push([i * PHI, 0, j / PHI]);
  }
  const fnRaw = [];
  for (const i of s) for (const j of s) {
    fnRaw.push([0, i * PHI, j]);
    fnRaw.push([i * PHI, j, 0]);
    fnRaw.push([i, 0, j * PHI]);
  }
  const norm = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const normals = fnRaw.map(norm);
  const faces = [];
  for (let i = 0; i < 12; i++) {
    const n = normals[i];
    const scored = vs.map((v, idx) => ({ idx, d: dot(v, n) }));
    scored.sort((a, b) => b.d - a.d);
    const five = scored.slice(0, 5).map(x => x.idx);
    let ref = norm([n[1] - n[2], n[2] - n[0], n[0] - n[1]]);
    if (Math.abs(dot(ref, n)) > 0.9) ref = norm(cross(n, [1, 0.3, 0.2]));
    const t = norm(cross(n, ref)), b = cross(n, t);
    const c = [0, 0, 0];
    five.forEach(vi => { c[0] += vs[vi][0] / 5; c[1] += vs[vi][1] / 5; c[2] += vs[vi][2] / 5; });
    five.sort((va, vb) => {
      const A = vs[va], B = vs[vb];
      const aa = Math.atan2(dot([A[0] - c[0], A[1] - c[1], A[2] - c[2]], b), dot([A[0] - c[0], A[1] - c[1], A[2] - c[2]], t));
      const bb = Math.atan2(dot([B[0] - c[0], B[1] - c[1], B[2] - c[2]], b), dot([B[0] - c[0], B[1] - c[1], B[2] - c[2]], t));
      return aa - bb;
    });
    const A = vs[five[0]], B = vs[five[1]], C = vs[five[2]];
    const w = cross([B[0] - A[0], B[1] - A[1], B[2] - A[2]], [C[0] - A[0], C[1] - A[1], C[2] - A[2]]);
    if (dot(w, n) < 0) five.reverse();
    faces.push(five);
  }
  const h0 = dot(vs[faces[0][0]], normals[0]);
  const verts = vs.map(v => v.map(x => x / h0));
  return { verts, faces, normals };
}

/** Wierzchołki bryły z płaszczyzn n_i·x = hs[i] (przecięcia trójek jak w oryginale). */
function deformVerts(dod, hs) {
  const vFaces = dod.verts.map(() => []);
  dod.faces.forEach((f, fi) => f.forEach(vi => vFaces[vi].push(fi)));
  return dod.verts.map((v, vi) => {
    const [a, b, c] = vFaces[vi];
    const n1 = dod.normals[a], n2 = dod.normals[b], n3 = dod.normals[c];
    const d = det3(n1, n2, n3);
    // Cramer
    const x = det3([hs[a], n1[1], n1[2]], [hs[b], n2[1], n2[2]], [hs[c], n3[1], n3[2]]) / d;
    const y = det3([n1[0], hs[a], n1[2]], [n2[0], hs[b], n2[2]], [n3[0], hs[c], n3[2]]) / d;
    const z = det3([n1[0], n1[1], hs[a]], [n2[0], n2[1], hs[b]], [n3[0], n3[1], hs[c]]) / d;
    return [x, y, z];
  });
  function det3(r1, r2, r3) {
    return r1[0] * (r2[1] * r3[2] - r2[2] * r3[1])
         - r1[1] * (r2[0] * r3[2] - r2[2] * r3[0])
         + r1[2] * (r2[0] * r3[1] - r2[1] * r3[0]);
  }
}

const U = 1.18;
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -34, 0) });
world.allowSleep = true;
const diceMat = new CANNON.Material('dice');
const floorMat = new CANNON.Material('floor');
world.addContactMaterial(new CANNON.ContactMaterial(diceMat, floorMat, { friction: 0.3, restitution: 0.3 }));
const floor = new CANNON.Body({ mass: 0, material: floorMat, shape: new CANNON.Plane() });
floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(floor);
const dod = buildDodeca();

let anti = -1;
for (let f = 0; f < 12; f++) {
  const d = dod.normals[f][0] * dod.normals[11][0] + dod.normals[f][1] * dod.normals[11][1] + dod.normals[f][2] * dod.normals[11][2];
  if (d < -0.9999) anti = f;
}

let seed = 13579;
const rng = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

const topFace = (b) => {
  let bd = -2, best = -1;
  for (let f = 0; f < 12; f++) {
    const n = dod.normals[f];
    const wv = b.quaternion.vmult(new CANNON.Vec3(n[0], n[1], n[2]));
    if (wv.y > bd) { bd = wv.y; best = f; }
  }
  return { face: best, dot: bd };
};

function runLevel(h, N) {
  const hs = new Array(12).fill(1);
  hs[11] = h;
  const dverts = deformVerts(dod, hs);
  const shape = new CANNON.ConvexPolyhedron({
    vertices: dverts.map(v => new CANNON.Vec3(v[0] * U, v[1] * U, v[2] * U)),
    faces: dod.faces.map(f => f.slice())
  });
  const body = new CANNON.Body({ mass: 1.2, material: diceMat });
  body.addShape(shape);
  body.linearDamping = 0.09;
  body.angularDamping = 0.14;
  body.allowSleep = true;
  body.sleepSpeedLimit = U * 0.28;
  body.sleepTimeLimit = 0.4;
  world.addBody(body);
  const maxH = Math.max(1, h);

  const counts = new Array(12).fill(0);
  let crooked = 0, done = 0;
  while (done < N && crooked < N * 0.05 + 50) {
    body.wakeUp();
    body.position.set((rng() - 0.5) * 2, U * (maxH + 1.4 + rng() * 0.8), (rng() - 0.5) * 2);
    const u1 = rng(), u2 = rng(), u3 = rng();
    body.quaternion.set(
      Math.sqrt(1 - u1) * Math.sin(2 * Math.PI * u2),
      Math.sqrt(1 - u1) * Math.cos(2 * Math.PI * u2),
      Math.sqrt(u1) * Math.sin(2 * Math.PI * u3),
      Math.sqrt(u1) * Math.cos(2 * Math.PI * u3)
    );
    body.velocity.set((rng() - 0.5) * U * 8, 0, (rng() - 0.5) * U * 8);
    const s = 14 + rng() * 9;
    body.angularVelocity.set((rng() - 0.5) * s * 2, (rng() - 0.5) * s, (rng() - 0.5) * s * 2);
    let time = 0;
    while (time < 15 && body.sleepState !== CANNON.Body.SLEEPING) {
      if (body.velocity.length() < U * 2.4) {
        body.velocity.scale(0.965, body.velocity);
        body.angularVelocity.scale(0.955, body.angularVelocity);
      }
      world.step(1 / 120);
      time += 1 / 120;
    }
    const r = topFace(body);
    if (body.sleepState !== CANNON.Body.SLEEPING || r.dot < 0.9999) { crooked++; continue; }
    counts[r.face]++;
    done++;
  }
  world.removeBody(body);
  return { counts, crooked, done };
}

const N = Number(process.argv[2]) || 2500;
const levels = (process.argv[3] || '0.75,0.85,1,1.15,1.35,1.6').split(',').map(Number);
console.log(`ścianka szlifowana: 11 (wilk/lis), przeciwległa: ${anti}; ${N} rzutów/poziom`);
console.log('h<1 = ścianka WIĘKSZA (wcięta), h>1 = MNIEJSZA (odsunięta)\n');
for (const h of levels) {
  const { counts, crooked, done } = runLevel(h, N);
  const pct = counts.map(c => 100 * c / done);
  const others = pct.filter((_, f) => f !== 11 && f !== anti);
  console.log(`h=${h.toFixed(2)}: drapieżnik(11) = ${pct[11].toFixed(2)}%,  antypod = ${pct[anti].toFixed(2)}%,  boczne: ${Math.min(...others).toFixed(1)}–${Math.max(...others).toFixed(1)}%  (odrzuty: ${crooked})`);
}
