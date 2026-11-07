// Regressions against the REAL DiceScene module, with real Three.js math and Cannon bodies.
// Canvas/RAF are small platform stubs: these tests do not copy the physics implementation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const THREE = require('../vendor/three.min.js');
const CANNON = require('../vendor/cannon-es.cjs.js');
const source = fs.readFileSync(new URL('../src/dice3d.js', import.meta.url), 'utf8');
const symbolsSource = fs.readFileSync(new URL('../src/symbols.js', import.meta.url), 'utf8');
const rulesSource = fs.readFileSync(new URL('../src/rules.js', import.meta.url), 'utf8');

function platform() {
  const rafs = new Map(), intervals = new Map(), events = new Map();
  let next = 1, seed = 21871;
  const seededMath = Object.create(Math);
  seededMath.random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
  class Canvas {
    constructor(width = 800, height = 600) {
      this.width = this.clientWidth = width; this.height = this.clientHeight = height;
      this.style = {}; this.id = 'scene3d'; this.listeners = new Map(); this.calls = {};
      const canvas = this;
      const gradient = { addColorStop() {} };
      this.ctx = new Proxy({ canvas, createLinearGradient: () => gradient, createRadialGradient: () => gradient,
        measureText: text => ({ width: text.length * 7 }) }, {
        get(target, property) {
          if (property in target) return target[property];
          return (...args) => { canvas.calls[property] = (canvas.calls[property] || 0) + 1; };
        }
      });
      this.parentNode = { replaceChild: (replacement, previous) => { this.replacement = replacement; replacement.parentNode = this.parentNode; } };
    }
    getContext(type) { return type === '2d' && !this.contextOccupied ? this.ctx : null; }
    addEventListener(type, callback) { this.listeners.set(type, callback); }
    removeEventListener(type) { this.listeners.delete(type); }
    setAttribute(name, value) { this[name] = value; }
    getAttribute(name) { return this[name]; }
    setPointerCapture() {}
    cloneNode() { const copy = new Canvas(this.clientWidth, this.clientHeight); copy.id = this.id; return copy; }
    toDataURL() { return 'data:image/png;base64,'; }
  }
  const document = {
    visibilityState: 'visible',
    createElement: () => new Canvas(),
    createElementNS: () => new Canvas(),
    addEventListener(type, callback) { if (!events.has(type)) events.set(type, []); events.get(type).push(callback); }
  };
  const context = vm.createContext({ THREE, CANNON, document,
    window: { innerWidth: 800, innerHeight: 600, devicePixelRatio: 1, matchMedia: () => ({ matches: false }) },
    performance: { now: () => 1000 }, Math: seededMath,
    console: { log() {}, warn() {}, error() {} },
    requestAnimationFrame: callback => { const id = next++; rafs.set(id, callback); return id; },
    cancelAnimationFrame: id => rafs.delete(id),
    setInterval: callback => { const id = next++; intervals.set(id, callback); return id; },
    clearInterval: id => intervals.delete(id)
  });
  vm.runInContext(symbolsSource, context);
  vm.runInContext(rulesSource, context);
  vm.runInContext(source, context);
  function scene(options = {}) {
    const results = [], errors = [];
    const canvas = options.canvas || new Canvas();
    const atlas = context.SYMBOLS.buildAtlas(128);
    const dice = new context.DiceScene({ canvas, atlasCanvas: atlas,
      symbolsA: context.RULES.DIE_A, symbolsB: context.RULES.DIE_B,
      onSettle: faces => results.push(Array.from(faces)), onRollError: error => errors.push(error), ...options });
    dice._clock = { getDelta: () => 1 / 60 };
    return { dice, canvas, results, errors };
  }
  function frame() {
    const pending = [...rafs.entries()]; rafs.clear();
    pending.forEach(([, callback]) => callback());
  }
  return { context, Canvas, rafs, intervals, document, events, scene, frame };
}

let assertions = 0;
function check(condition, message) { assert.ok(condition, message); assertions++; }

// A browser with no WebGL still constructs a usable scene and paints the table/dice.
const p = platform();
const realConsoleError = console.error;
console.error = () => {}; // Three.js emits its expected context-unavailable diagnostic.
let first;
try { first = p.scene(); } finally { console.error = realConsoleError; }
const { dice, results, errors } = first;
check(dice.compatibilityMode === true, 'WebGL failure chooses Canvas 2D');
p.frame();
check((dice.canvas.calls.drawImage || 0) >= 3, 'fallback paints the board and animal atlas');
check(p.rafs.size === 0, 'an idle scene does not keep a RAF loop alive');
const paints = dice.canvas.calls.drawImage;
p.frame();
check(dice.canvas.calls.drawImage === paints, 'idle board does not repaint');

// If a failed WebGL setup occupied a canvas, the replacement keeps the public canvas ID.
const occupied = new p.Canvas(); occupied.contextOccupied = true;
const replaced = p.scene({ forceCanvas: true, canvas: occupied });
check(replaced.dice.canvas !== occupied && replaced.dice.canvas.id === occupied.id, 'occupied canvas is safely replaced');
check(replaced.dice.canvas.listeners.has('pointerdown'), 'gestures bind to the replacement canvas');
replaced.dice._running = false;
p.rafs.clear();

// Preview, motion, remote transforms and resizing all remain part of the same API.
dice.previewBias(new p.Canvas(96, 96), new p.Canvas(96, 96), { m: 'w', v: [-0.4, 0.7] });
dice.previewBias(new p.Canvas(96, 96), new p.Canvas(96, 96), { m: 's', v: [-0.3, 0.8] });
check(true, 'both tuning previews work without WebGL');
dice.setInteractive(true);
const event = { pointerId: 1, clientX: 400, clientY: 300, preventDefault() {} };
dice.canvas.listeners.get('pointerdown')(event);
check(dice.state === 'held' && p.rafs.size === 1, 'touch wakes the scene');
dice.canvas.listeners.get('pointerup')(event);
check(dice.state === 'flying', 'touch release starts the physical throw');
dice._running = false; p.rafs.clear();

// The original regression: the time limit may rescue a roll but must never invent a result.
dice._flightTime = 6.5;
const beforeTimeout = results.length;
dice._checkSettle(0.02);
check(results.length === beforeTimeout && dice.state === 'flying', 'moving dice are not accepted after the timeout');
check(dice._cockedTries === 1 && dice._flightTime === 0, 'timeout starts a bounded physical retry');
for (let attempt = 0; attempt < 5; attempt++) {
  dice._flightTime = 6.6;
  dice._checkSettle(0.02);
}
check(errors.length === 1 && results.length === beforeTimeout && dice.state === 'idle', 'exhausted retries report an uncounted roll');

// A tilted, sleeping body is still not a valid settled die.
dice.throwAuto();
for (const d of dice.dice) { d.body.quaternion.set(0, 0, 0, 1); d.body.sleep(); }
dice._flightTime = 6.5;
dice._checkSettle(0.02);
check(results.length === beforeTimeout && dice.state === 'flying', 'sleeping at an angle does not count as a result');
check(dice.dice.every(d => d.body.quaternion.w === 1), 'rescue does not rotate a die to a selected face');

// Run repeated throws using the actual production methods, not copied simulation logic.
let successfulRolls = 0;
for (let round = 0; round < 30; round++) {
  const count = results.length;
  dice.throwAuto();
  for (let step = 0; step < 120 * 45 && dice.state === 'flying'; step++) {
    dice._physStep(1 / 120);
    dice._lockSettledDice();
    dice._checkSettle(1 / 120);
  }
  check(results.length === count + 1, 'real production roll ' + round + ' settles');
  check(dice.dice.every(d => d.locked && d.body.type === CANNON.Body.STATIC), 'accepted bodies remain static');
  assert.deepEqual(Array.from(dice.getFacesUp()), results.at(-1)); assertions++;
  successfulRolls++;
}
const finalFaces = Array.from(dice.getFacesUp());
const finalPose = dice.dice.map(d => [d.body.position.x, d.body.position.y, d.body.position.z, d.body.quaternion.x, d.body.quaternion.y, d.body.quaternion.z, d.body.quaternion.w]);
for (let i = 0; i < 300; i++) dice.world.step(1 / 120);
assert.deepEqual(dice.dice.map(d => [d.body.position.x, d.body.position.y, d.body.position.z, d.body.quaternion.x, d.body.quaternion.y, d.body.quaternion.z, d.body.quaternion.w]), finalPose); assertions++;
dice.canvas.clientWidth = 390; dice.canvas.clientHeight = 760;
dice.resize();
assert.deepEqual(Array.from(dice.getFacesUp()), finalFaces, 'resizing never changes an accepted symbol'); assertions++;

// Remote playback paints supplied transforms while leaving local physics asleep.
const frame = dice.getNetFrame();
dice._running = true;
dice.setRemoteDriven(true);
dice.applyNetFrame(frame);
const worldTime = dice.world.time;
p.frame();
check(dice.world.time === worldTime, 'remote frames do not advance local physics');
dice.endRemoteRoll();
assert.deepEqual(Array.from(dice.getFacesUp()), finalFaces); assertions++;
check(dice.dice.every(d => d.locked), 'remote final frames remain frozen');
p.frame();

// Hidden tabs finish the physical roll without drawing or leaving a timer alive afterwards.
dice.throwAuto();
p.document.visibilityState = 'hidden'; p.events.get('visibilitychange').forEach(callback => callback());
check(p.rafs.size === 0 && p.intervals.size === 1, 'hidden throws use one physics timer instead of rendering');
const hiddenPaints = dice.canvas.calls.drawImage;
dice._clock = { getDelta: () => 0.25 };
for (let tick = 0; tick < 180 && dice.state === 'flying'; tick++) dice._tickHidden();
check(dice.state === 'idle' && dice._hasResult, 'a background throw reaches a stable physical result');
check(dice.canvas.calls.drawImage === hiddenPaints, 'hidden physics never paints');
check(p.intervals.size === 0, 'background physics timer stops once the throw settles');
p.document.visibilityState = 'visible'; p.events.get('visibilitychange').forEach(callback => callback());
p.frame();
check(dice.canvas.calls.drawImage > hiddenPaints && p.rafs.size === 0, 'returning to the tab paints once and sleeps');

// The new visual bevel is a closed mesh with planar pentagons, wholly inside
// the unchanged physical hull. Check both regular and deliberately shaved dice.
function verifyBevel(scene, label) {
  for (const die of scene.dice) {
    const geometry = die.mesh.geometry, position = geometry.attributes.position, normal = geometry.attributes.normal;
    const heights = geometry.userData.sfBevel.heights;
    const edges = new Map();
    let inside = true, outward = true, unitNormals = true, planar = true;
    const keyOf = v => v.toArray().map(n => Math.round(n * 100000)).join(',');
    for (let i = 0; i < position.count; i += 3) {
      const vertices = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(position, i + j));
      const ns = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(normal, i + j));
      const cross = vertices[1].clone().sub(vertices[0]).cross(vertices[2].clone().sub(vertices[0]));
      outward &&= cross.lengthSq() > 1e-15 && cross.dot(ns[0].clone().add(ns[1]).add(ns[2])) > 0;
      for (let j = 0; j < 3; j++) {
        const v = vertices[j], n = ns[j];
        unitNormals &&= Number.isFinite(v.lengthSq()) && Math.abs(n.length() - 1) < 1e-5;
        scene.dod.normals.forEach((plane, fi) => { inside &&= new THREE.Vector3().fromArray(plane).dot(v) <= heights[fi] + 1e-5; });
        if (i < 12 * 5 * 3) {
          const faceIndex = Math.floor(i / 15), faceNormal = new THREE.Vector3().fromArray(scene.dod.normals[faceIndex]);
          planar &&= Math.abs(faceNormal.dot(v) - heights[faceIndex]) < 1e-5 && n.distanceTo(faceNormal) < 1e-5;
        }
        const edgeKey = [keyOf(v), keyOf(vertices[(j + 1) % 3])].sort().join('|');
        edges.set(edgeKey, (edges.get(edgeKey) || 0) + 1);
      }
    }
    check(unitNormals && outward, label + ': finite vertices, unit normals, outward nondegenerate faces');
    check(inside && planar, label + ': all twelve faces remain planar and the bevel stays inside the physical hull');
    check([...edges.values()].every(count => count === 2), label + ': visual mesh is watertight');
    check(position.count < 5000, label + ': the detailed bevel keeps a small mesh');
  }
}
verifyBevel(dice, 'regular dice');
for (const d of dice.dice) {
  check(d.body.shapes[0].vertices.length === 20 && d.body.shapes[0].faces.length === 12, 'collision hull remains a dodecahedron');
  check(d.body.shapes[0].vertices.every((v, i) => new THREE.Vector3(v.x, v.y, v.z).divideScalar(dice.U).distanceTo(new THREE.Vector3().fromArray(dice.dod.verts[i])) < 1e-9), 'visual bevel never alters collision vertices');
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  d.mesh.material.onBeforeCompile(shader);
  check(shader.vertexShader.includes('sfPos = position;') && shader.fragmentShader.includes('float flatMask = smoothstep('), 'production shader inserts flat face artwork');
  check(shader.uniforms.uFaceSym.value.every((index, i) => index === p.context.SYMBOLS.cellOf(d.symbols[i]).index), 'the shader preserves all twelve symbol assignments');
  check(shader.uniforms.uMedallionColor.value instanceof THREE.Color && shader.uniforms.uFrameColor.value instanceof THREE.Color, 'medallion and frame colors use Three color management');
}
check(dice.dice[0].mesh.material.color.getHexString() === 'f3edde' && dice.dice[1].mesh.material.color.getHexString() === 'df9c32', 'porcelain and amber are visibly distinct materials');
check((dice.canvas.calls.transform || 0) > 2, 'Canvas projects the actual individual face planes');

const shaved = p.scene({ forceCanvas: true }).dice;
shaved.setTuning({ m: 's', v: [0.75, -0.65] });
verifyBevel(shaved, 'shaved dice');
shaved._running = false; p.rafs.clear();

// HUD reflow must not resize a moving hull or move a frozen result. The layout
// keeps a conservative envelope and applies extra space only before a new throw.
const layout = p.scene({ forceCanvas: true, insets: { top: 80, right: 12, bottom: 120, left: 12 } }).dice;
const pose = scene => scene.dice.map(d => [d.body.position.toArray(), d.body.quaternion.toArray(), d.body.velocity.toArray()]);
const bounds = scene => JSON.stringify([scene.U, scene.rect, scene.insets]);
layout.throwAuto();
const flyingBounds = bounds(layout), flyingPose = pose(layout);
layout.setInsets({ top: 24, right: 12, bottom: 32, left: 12 });
check(bounds(layout) === flyingBounds, 'shrinking HUD is deferred during flight');
assert.deepEqual(pose(layout), flyingPose, 'HUD reflow never moves or changes velocity of flying dice'); assertions++;
for (let step = 0; step < 120 * 45 && layout.state === 'flying'; step++) {
  layout._physStep(1 / 120); layout._lockSettledDice(); layout._checkSettle(1 / 120);
}
check(layout._hasResult && bounds(layout) === flyingBounds, 'the tray does not expand after a result is accepted');
const acceptedPose = pose(layout);
layout.setInsets({ top: 110, right: 12, bottom: 170, left: 12 });
assert.deepEqual(pose(layout), acceptedPose, 'a larger next-turn dock leaves the accepted result in place'); assertions++;
check(bounds(layout) === flyingBounds, 'a larger next-turn dock waits for a new throw');
layout.throwAuto();
check(layout.insets.top === 110 && layout.insets.bottom === 170, 'pending safe layout is applied before the next throw');
layout.setRemoteDriven(true);
layout.applyNetFrame(frame);
const remoteBounds = bounds(layout), remotePositions = layout.dice.map(d => d.mesh.position.toArray());
layout.setInsets({ top: 140, right: 12, bottom: 200, left: 12 });
check(bounds(layout) === remoteBounds, 'HUD reflow is deferred during remote playback');
assert.deepEqual(layout.dice.map(d => d.mesh.position.toArray()), remotePositions, 'remote transforms remain untouched'); assertions++;
layout.endRemoteRoll();
check(layout._hasResult && bounds(layout) === remoteBounds, 'remote final frame also keeps its tray layout');
layout._running = false; p.rafs.clear();

console.log('OK: ' + assertions + ' assertions; ' + successfulRolls + '/30 real DiceScene throws; watertight bevels, planar faces, shader artwork, Canvas projection, deferred HUD, timeout, fixed results, remote playback and hidden/idle rendering.');
