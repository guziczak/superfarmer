// Reprodukcja zawieszki fizyki bez przeglądarki: node dev/physrepro.mjs [wariant]
// warianty: full | nociel | nowalls | onedie | nofloorfriction
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const CANNON = require('../scratch-cannon.cjs');

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
    fnRaw.push([0, i, j * PHI]);
    fnRaw.push([i, j * PHI, 0]);
    fnRaw.push([i * PHI, 0, j]);
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
    if (dot(w, n) > 0) five.reverse();
    faces.push(five);
  }
  const h0 = dot(vs[faces[0][0]], normals[0]);
  const verts = vs.map(v => v.map(x => x / h0));
  return { verts, faces, normals };
}

const variant = process.argv[2] || 'full';
const U = 0.95;
const rect = { x0: -10, x1: 10, z0: -6, z1: 6, cx: 0, cz: 0, w: 20, h: 12 };

const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -34, 0) });
world.allowSleep = true;
const diceMat = new CANNON.Material('dice');
const floorMat = new CANNON.Material('floor');
const wallMat = new CANNON.Material('wall');
world.addContactMaterial(new CANNON.ContactMaterial(diceMat, floorMat, { friction: 0.26, restitution: 0.34 }));
world.addContactMaterial(new CANNON.ContactMaterial(diceMat, wallMat, { friction: 0.12, restitution: 0.5 }));
world.addContactMaterial(new CANNON.ContactMaterial(diceMat, diceMat, { friction: 0.2, restitution: 0.45 }));

const floor = new CANNON.Body({ mass: 0, material: floorMat, shape: new CANNON.Plane() });
floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(floor);

if (variant !== 'nowalls') {
  const wallH = U * 2.6, wallT = U * 0.55;
  const defs = [
    { x: rect.cx, z: rect.z0 - wallT / 2, sx: rect.w + wallT * 2, sz: wallT },
    { x: rect.cx, z: rect.z1 + wallT / 2, sx: rect.w + wallT * 2, sz: wallT },
    { x: rect.x0 - wallT / 2, z: rect.cz, sx: wallT, sz: rect.h + wallT * 2 },
    { x: rect.x1 + wallT / 2, z: rect.cz, sx: wallT, sz: rect.h + wallT * 2 }
  ];
  for (const d of defs) {
    const b = new CANNON.Body({ mass: 0, material: wallMat });
    b.addShape(new CANNON.Box(new CANNON.Vec3(1, 1, 1)));
    b.shapes[0].halfExtents.set(d.sx / 2, wallH * 2, d.sz / 2);
    b.shapes[0].updateConvexPolyhedronRepresentation();
    b.position.set(d.x, wallH, d.z);
    world.addBody(b);
  }
  if (variant !== 'nociel') {
    const c = new CANNON.Body({ mass: 0, material: wallMat });
    c.addShape(new CANNON.Box(new CANNON.Vec3(1, 1, 1)));
    c.shapes[0].halfExtents.set(rect.w, 0.5, rect.h);
    c.shapes[0].updateConvexPolyhedronRepresentation();
    c.position.set(rect.cx, U * 11, rect.cz);
    world.addBody(c);
  }
}

const dod = buildDodeca();
const hullVerts = dod.verts.map(v => new CANNON.Vec3(v[0] * U, v[1] * U, v[2] * U));
const nDice = variant === 'onedie' ? 1 : 2;
const dice = [];
for (let d = 0; d < nDice; d++) {
  const shape = new CANNON.ConvexPolyhedron({ vertices: hullVerts.map(v => v.clone()), faces: dod.faces.map(f => f.slice()) });
  const body = new CANNON.Body({ mass: 1.2, material: diceMat, shape });
  body.linearDamping = 0.04;
  body.angularDamping = 0.07;
  body.allowSleep = true;
  body.sleepSpeedLimit = 0.9;
  body.sleepTimeLimit = 0.35;
  body.position.set(rect.cx + (d === 0 ? -1.35 : 1.35) * U, U + 0.01, rect.cz + rect.h * 0.18);
  world.addBody(body);
  dice.push(body);
}

let rngSeed = 42;
const rng = () => (rngSeed = (rngSeed * 1103515245 + 12345) % 2147483648) / 2147483648;

console.log('wariant:', variant);
for (let throwN = 0; throwN < 30; throwN++) {
  for (const b of dice) {
    b.wakeUp();
    b.position.y = Math.max(b.position.y, U * 2.2);
    const dx = rect.cx - b.position.x, dz = rect.cz - b.position.z;
    const l = Math.hypot(dx, dz) || 1;
    const sp = U * (13 + rng() * 7);
    b.velocity.set(dx / l * sp + (rng() - 0.5) * U * 6, U * (5 + rng() * 2), dz / l * sp + (rng() - 0.5) * U * 6);
    const s = 14 + rng() * 9;
    b.angularVelocity.set((rng() - 0.5) * s * 2, (rng() - 0.5) * s, (rng() - 0.5) * s * 2);
  }
  const t0 = Date.now();
  let worst = 0;
  for (let i = 0; i < 1200; i++) {
    const s0 = Date.now();
    world.step(1 / 120);
    const el = Date.now() - s0;
    if (el > worst) worst = el;
    if (el > 500) {
      console.log(`rzut ${throwN} krok ${i}: KROK TRWAŁ ${el}ms — pozycje:`, dice.map(b => b.position.toString()).join(' | '));
      process.exit(2);
    }
  }
  const bad = dice.some(b => !isFinite(b.position.x + b.position.y + b.position.z));
  console.log(`rzut ${throwN}: ${Date.now() - t0}ms, najgorszy krok ${worst}ms, NaN=${bad}, y=[${dice.map(b => b.position.y.toFixed(2)).join(', ')}]`);
  if (bad) process.exit(3);
}
console.log('OK — bez zawieszki');
