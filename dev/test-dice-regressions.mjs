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

console.log('OK: ' + assertions + ' assertions; ' + successfulRolls + '/30 real DiceScene throws; Canvas 2D, timeout, fixed final results, remote playback and hidden/idle rendering.');
