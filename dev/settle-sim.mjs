// Symulacja PEŁNEJ maszyny osiadania z gry (dice3d._checkSettle) w node:
// rzut → calm 0.4s → (przechył >1.4° => przerzut, max 5; overtime 6.5s) → akcept.
// Wymóg: 30/30 rzutów rozstrzygniętych, finalny kąt < 0.3°.
// node dev/settle-sim.mjs
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
// opcjonalne obciążenie kostek jak w trybie zaawansowanym: node dev/settle-sim.mjs 0.25 | -0.25
const BIAS = Number(process.argv[2]) || 0;
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
const dice = [];
for (let d = 0; d < 2; d++) {
  const shape = new CANNON.ConvexPolyhedron({
    vertices: dod.verts.map(v => new CANNON.Vec3(v[0] * U, v[1] * U, v[2] * U)),
    faces: dod.faces.map(f => f.slice())
  });
  const body = new CANNON.Body({ mass: 1.2, material: diceMat });
  body.addShape(shape, new CANNON.Vec3(
    -BIAS * U * dod.normals[11][0], -BIAS * U * dod.normals[11][1], -BIAS * U * dod.normals[11][2]));
  body.linearDamping = 0.09;
  body.angularDamping = 0.14;
  body.allowSleep = true;
  body.sleepSpeedLimit = U * 0.28;
  body.sleepTimeLimit = 0.4;
  body.position.set((d === 0 ? -1.35 : 1.35) * U, U + 0.01, rect.h * 0.18);
  world.addBody(body);
  dice.push(body);
}

let seed = 1234;
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

const throwDice = () => {
  for (let i = 0; i < 2; i++) {
    const b = dice[i];
    b.wakeUp();
    b.position.y = Math.max(b.position.y, U * 2.2);
    const tx = rect.cx + (i === 0 ? -1 : 1) * rect.w * 0.14 + (rng() - 0.5) * U * 2;
    const tz = rect.cz + (rng() - 0.5) * rect.h * 0.3;
    const dx = tx - b.position.x, dz = tz - b.position.z;
    const l = Math.hypot(dx, dz) || 1;
    const sp = U * (9 + rng() * 5);
    b.velocity.set(dx / l * sp, U * (4.5 + rng() * 2), dz / l * sp);
    const s = 14 + rng() * 9;
    b.angularVelocity.set((rng() - 0.5) * s * 2, (rng() - 0.5) * s, (rng() - 0.5) * s * 2);
  }
};

let allOk = true;
for (let t = 0; t < 30; t++) {
  throwDice();
  let flight = 0, att = 0, settleT = 0, tries = 0, resolved = false, rerolls = 0;
  const step = 1 / 120;
  while (flight < 45 && !resolved) {
    // tłumik dogasania
    for (const b of dice) {
      if (b.sleepState !== CANNON.Body.SLEEPING && b.velocity.length() < U * 2.4) {
        b.velocity.scale(0.965, b.velocity);
        b.angularVelocity.scale(0.955, b.angularVelocity);
      }
    }
    world.step(step);
    flight += step;
    att += step;
    const overtime = att > 6.5; // jak w grze: czas od ostatniego przerzutu
    let calm = true;
    for (const b of dice) {
      if (b.sleepState !== CANNON.Body.SLEEPING) {
        if (b.velocity.length() > U * 0.55 || b.angularVelocity.length() > 0.6) { calm = false; break; }
      }
    }
    if (!calm && !overtime) { settleT = 0; continue; }
    settleT += step;
    if (settleT < 0.4 && !overtime) continue;
    let leaning = false;
    const dots = dice.map(topDot);
    for (const dd of dots) if (dd < 0.99999) leaning = true;
    if (leaning && tries < 5 && !overtime) {
      tries++; rerolls++;
      settleT = 0;
      att = 0;
      for (let m = 0; m < 2; m++) {
        const bb = dice[m];
        if (dots[m] < 0.99999) {
          bb.wakeUp();
          // lustro dice3d._checkSettle: przerzut w najbardziej wolny kierunek
          const ob = dice[1 - m];
          const px = bb.position.x, pz = bb.position.z;
          const cands = [];
          const cdx = rect.cx - px, cdz = rect.cz - pz;
          const cl = Math.hypot(cdx, cdz);
          if (cl > 1e-6) cands.push([cdx / cl, cdz / cl]);
          const ax = px - ob.position.x, az = pz - ob.position.z;
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
            const dOther = Math.hypot(tx - ob.position.x, tz - ob.position.z);
            const dWall = Math.min(tx - rect.x0, rect.x1 - tx, tz - rect.z0, rect.z1 - tz);
            const score = Math.min(dOther, dWall);
            if (score > bestScore) { bestScore = score; dirx = c[0]; dirz = c[1]; }
          }
          bb.position.y += U * 0.5;
          bb.position.x = Math.min(Math.max(px + dirx * U * 0.6, rect.x0 + U), rect.x1 - U);
          bb.position.z = Math.min(Math.max(pz + dirz * U * 0.6, rect.z0 + U), rect.z1 - U);
          bb.velocity.set(dirx * U * 2.4, U * 2.2, dirz * U * 2.4);
          bb.angularVelocity.set((rng() - 0.5) * 5, (rng() - 0.5) * 2.5, (rng() - 0.5) * 5);
        }
      }
      continue;
    }
    resolved = true;
    const angs = dots.map(dd => Math.acos(Math.min(1, dd)) * 180 / Math.PI);
    const worst = Math.max(...angs);
    const ok = worst < 0.3;
    if (!ok) allOk = false;
    console.log(`rzut ${t}: rozstrzygnięty po ${flight.toFixed(2)}s, przerzuty=${rerolls}, kąty=[${angs.map(a => a.toFixed(3)).join('°, ')}°] ${ok ? 'OK' : 'ZA KRZYWO!'}`);
  }
  if (!resolved) { console.log(`rzut ${t}: NIE ROZSTRZYGNIĘTY w 45s!`); allOk = false; }
}
console.log(allOk ? '\nWSZYSTKIE 30 rzutów: rozstrzygnięte, płasko.' : '\nSĄ PROBLEMY');
process.exit(allOk ? 0 : 1);
