// Dowód mechaniki „ze stali": kostka wyrzucona i ustabilizowana płasko staje się
// ciałem statycznym (jak w dice3d._lockDie) i NIE WOLNO jej ruszyć — ani twardym
// ostrzałem drugą kostką, ani niczym innym. Po odblokowaniu wraca do normalnej fizyki.
// Wymóg: 30 rund ostrzału, dryf kostki A = 0 dokładnie; B zawsze rozstrzygnięta płasko.
// node dev/lock-sim.mjs
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

const U = 1.18;
const rect = { x0: -9, x1: 9, z0: -5.2, z1: 5.2, cx: 0, cz: 0, w: 18, h: 10.4 };
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -34, 0) });
world.allowSleep = true;
const diceMat = new CANNON.Material('dice');
const floorMat = new CANNON.Material('floor');
const wallMat = new CANNON.Material('wall');
world.addContactMaterial(new CANNON.ContactMaterial(diceMat, floorMat, { friction: 0.3, restitution: 0.3 }));
world.addContactMaterial(new CANNON.ContactMaterial(diceMat, wallMat, { friction: 0.06, restitution: 0.28 }));
world.addContactMaterial(new CANNON.ContactMaterial(diceMat, diceMat, { friction: 0.22, restitution: 0.38 }));
const floor = new CANNON.Body({ mass: 0, material: floorMat, shape: new CANNON.Plane() });
floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(floor);
const wallH = U * 2.6, wallT = U * 0.55;
for (const d of [
  { x: rect.cx, z: rect.z0 - wallT / 2, sx: rect.w + wallT * 2, sz: wallT },
  { x: rect.cx, z: rect.z1 + wallT / 2, sx: rect.w + wallT * 2, sz: wallT },
  { x: rect.x0 - wallT / 2, z: rect.cz, sx: wallT, sz: rect.h + wallT * 2 },
  { x: rect.x1 + wallT / 2, z: rect.cz, sx: wallT, sz: rect.h + wallT * 2 }
]) {
  const b = new CANNON.Body({ mass: 0, material: wallMat, shape: new CANNON.Box(new CANNON.Vec3(d.sx / 2, wallH * 2, d.sz / 2)) });
  b.position.set(d.x, wallH, d.z);
  world.addBody(b);
}
const dod = buildDodeca();
const mkDie = () => {
  const shape = new CANNON.ConvexPolyhedron({
    vertices: dod.verts.map(v => new CANNON.Vec3(v[0] * U, v[1] * U, v[2] * U)),
    faces: dod.faces.map(f => f.slice())
  });
  const body = new CANNON.Body({ mass: 1.2, material: diceMat, shape });
  body.linearDamping = 0.09;
  body.angularDamping = 0.14;
  body.allowSleep = true;
  body.sleepSpeedLimit = U * 0.28;
  body.sleepTimeLimit = 0.4;
  world.addBody(body);
  return body;
};
const A = mkDie(), B = mkDie();

let seed = 4242;
const rng = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

const topDot = (b) => {
  let bd = -2;
  for (let f = 0; f < 12; f++) {
    const n = dod.normals[f];
    const wv = b.quaternion.vmult(new CANNON.Vec3(n[0], n[1], n[2]));
    if (wv.y > bd) bd = wv.y;
  }
  return bd;
};

const step = 1 / 120;
const damp = (b) => { // tłumik dogasania jak w grze
  if (b.sleepState !== CANNON.Body.SLEEPING && b.velocity.length() < U * 2.4) {
    b.velocity.scale(0.965, b.velocity);
    b.angularVelocity.scale(0.955, b.angularVelocity);
  }
};

/** Symuluje aż `body` uśnie płasko (z nudge'ami jak w grze), inne ciała zostawia fizyce. */
function settleFlat(body, other, label) {
  let tries = 0;
  for (let t = 0; t < 30; t += step) {
    damp(A); damp(B);
    world.step(step);
    if (body.sleepState !== CANNON.Body.SLEEPING) continue;
    if (topDot(body) >= 0.99999 && body.position.y < U * 1.35) return true;
    if (tries >= 5) return false;
    tries++;
    // nudge — lustro dice3d._checkSettle: przerzut w najbardziej wolny kierunek
    body.wakeUp();
    const px = body.position.x, pz = body.position.z;
    const cands = [];
    const cdx = rect.cx - px, cdz = rect.cz - pz;
    const cl = Math.hypot(cdx, cdz);
    if (cl > 1e-6) cands.push([cdx / cl, cdz / cl]);
    const ax = px - other.position.x, az = pz - other.position.z;
    const ad = Math.hypot(ax, az);
    if (ad > 1e-6) {
      cands.push([ax / ad, az / ad]);
      cands.push([-az / ad, ax / ad]);
      cands.push([az / ad, -ax / ad]);
    }
    if (!cands.length) cands.push([1, 0]);
    let dirx = cands[0][0], dirz = cands[0][1], bestScore = -1e9;
    for (const c of cands) {
      const tx = px + c[0] * U * 2, tz = pz + c[1] * U * 2;
      const dOther = Math.hypot(tx - other.position.x, tz - other.position.z);
      const dWall = Math.min(tx - rect.x0, rect.x1 - tx, tz - rect.z0, rect.z1 - tz);
      const score = Math.min(dOther, dWall);
      if (score > bestScore) { bestScore = score; dirx = c[0]; dirz = c[1]; }
    }
    body.position.y += U * 0.5;
    body.position.x = Math.min(Math.max(px + dirx * U * 0.6, rect.x0 + U), rect.x1 - U);
    body.position.z = Math.min(Math.max(pz + dirz * U * 0.6, rect.z0 + U), rect.z1 - U);
    body.velocity.set(dirx * U * 2.4, U * 2.2, dirz * U * 2.4);
    body.angularVelocity.set((rng() - 0.5) * 5, (rng() - 0.5) * 2.5, (rng() - 0.5) * 5);
  }
  console.log(`  ${label}: NIE uspokojona w 30 s`);
  return false;
}

const lock = (b) => { // jak dice3d._lockDie
  b.velocity.setZero();
  b.angularVelocity.setZero();
  b.type = CANNON.Body.STATIC;
  b.mass = 0;
  b.updateMassProperties();
};
const unlock = (b) => { // jak dice3d._unlockDie
  b.type = CANNON.Body.DYNAMIC;
  b.mass = 1.2;
  b.updateMassProperties();
};

let allOk = true;
let maxDrift = 0;

for (let round = 0; round < 30; round++) {
  // 1. rzut kostką A, B zaparkowana z dala (śpi)
  B.position.set(rect.x1 - U * 1.2, U + 0.01, rect.z1 - U * 1.2);
  B.velocity.setZero(); B.angularVelocity.setZero(); B.sleep();
  A.wakeUp();
  A.position.set(rect.x0 + U * 2 + rng() * 4, U * 2.2, rect.z0 + U * 2 + rng() * 3);
  A.velocity.set(U * (6 + rng() * 8), U * (4 + rng() * 2), U * (3 + rng() * 5));
  A.angularVelocity.set((rng() - 0.5) * 20, (rng() - 0.5) * 10, (rng() - 0.5) * 20);
  if (!settleFlat(A, B, 'A')) { allOk = false; continue; }

  // 2. blokada + migawka stanu
  lock(A);
  const q0 = { x: A.quaternion.x, y: A.quaternion.y, z: A.quaternion.z, w: A.quaternion.w };
  const p0 = { x: A.position.x, y: A.position.y, z: A.position.z };
  const face0 = topDot(A);

  // 3. twardy ostrzał kostką B prosto w A (prędkości ponad limit rzutu z gry)
  B.wakeUp();
  const ang = rng() * Math.PI * 2;
  B.position.set(
    Math.min(rect.x1 - U, Math.max(rect.x0 + U, A.position.x + Math.cos(ang) * 6 * U)),
    U * (1.5 + rng()),
    Math.min(rect.z1 - U, Math.max(rect.z0 + U, A.position.z + Math.sin(ang) * 4 * U))
  );
  const dx = A.position.x - B.position.x, dz = A.position.z - B.position.z;
  const dl = Math.hypot(dx, dz) || 1;
  const sp = U * (24 + rng() * 12);
  B.velocity.set(dx / dl * sp, U * (2 + rng() * 3), dz / dl * sp);
  B.angularVelocity.set((rng() - 0.5) * 30, (rng() - 0.5) * 14, (rng() - 0.5) * 30);
  const bOk = settleFlat(B, A, 'B');

  // 4. pomiar dryfu A
  const drift = Math.max(
    Math.abs(A.quaternion.x - q0.x), Math.abs(A.quaternion.y - q0.y),
    Math.abs(A.quaternion.z - q0.z), Math.abs(A.quaternion.w - q0.w),
    Math.abs(A.position.x - p0.x), Math.abs(A.position.y - p0.y), Math.abs(A.position.z - p0.z)
  );
  maxDrift = Math.max(maxDrift, drift);
  const ok = drift === 0 && bOk;
  if (!ok) allOk = false;
  console.log(`runda ${round}: ostrzał ${sp.toFixed(1)} j/s, dryf A = ${drift.toExponential(1)}, ` +
    `A płasko: ${topDot(A) >= 0.99999 && face0 >= 0.99999 ? 'tak' : 'NIE'}, B płasko: ${bOk ? 'tak' : 'NIE'} ${ok ? 'OK' : 'PROBLEM'}`);

  // 5. odblokowanie i dowód, że A znów jest dynamiczna
  unlock(A);
  A.wakeUp();
  A.velocity.set(0, U * 3, 0);
  let moved = false;
  for (let t = 0; t < 0.5; t += step) { world.step(step); if (Math.abs(A.position.y - p0.y) > U * 0.1) { moved = true; break; } }
  if (!moved) { console.log('  po odblokowaniu A NIE rusza się!'); allOk = false; }
  A.velocity.setZero(); A.angularVelocity.setZero();
}

console.log(`\nmaksymalny dryf zablokowanej kostki w 30 rundach: ${maxDrift.toExponential(2)} (wymóg: dokładnie 0)`);
console.log(allOk ? 'WSZYSTKO OK: zablokowana kostka jest nieruszalna, druga rozstrzyga się płasko, odblokowanie działa.' : 'SĄ PROBLEMY');
process.exit(allOk ? 0 : 1);
