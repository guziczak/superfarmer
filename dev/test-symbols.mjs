// Exercise the real symbol loader and drawing API with manually delivered image
// events. Pixel-level art/readability checks use the real asset separately.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/symbols.js', import.meta.url), 'utf8');
const marker = "'__ANIMAL_ART_DATA__'";

function platform(options = {}) {
  const images = [], canvases = [], scheduled = [];
  let sourceFailures = options.sourceFailures || 0;
  class Image {
    constructor() {
      this.naturalWidth = this.naturalHeight = 0;
      images.push(this);
    }
    set src(value) {
      this.source = value;
      if (sourceFailures > 0) {
        sourceFailures--;
        throw new Error('Image source could not be assigned');
      }
    }
    get src() { return this.source; }
    succeed(width = 1536, height = 1536) {
      this.naturalWidth = width; this.naturalHeight = height;
      if (this.onload) this.onload();
    }
    fail() { if (this.onerror) this.onerror(); }
  }
  class Canvas {
    constructor() {
      this.width = this.height = 0;
      this.draws = [];
      this.serial = canvases.length + 1;
      this.context = {
        save() {}, restore() {}, clearRect() {},
        drawImage: (...args) => this.draws.push(args)
      };
      canvases.push(this);
    }
    getContext(kind) { assert.equal(kind, '2d'); return this.context; }
    toDataURL(kind) {
      assert.equal(kind, 'image/png');
      return 'data:image/png;base64,' + Buffer.from('test-canvas-' + this.serial).toString('base64');
    }
  }
  const document = {
    currentScript: { src: 'https://game.test/superfarmer/src/symbols.js' },
    baseURI: 'https://game.test/superfarmer/dev/atlas.html',
    createElement(tag) { assert.equal(tag, 'canvas'); return new Canvas(); }
  };
  const context = vm.createContext({ document, Image, URL,
    setTimeout(callback, delay) { scheduled.push({ callback, delay }); return scheduled.length; }
  });
  const code = options.inlineSource ? source.replace(marker, JSON.stringify(options.inlineSource)) : source;
  vm.runInContext(code, context, { filename: 'src/symbols.js' });
  return { symbols: context.SYMBOLS, images, canvases, scheduled };
}

function requireReady(p) {
  assert.throws(() => p.symbols.buildAtlas(2048), /SYMBOLS\.load/);
  assert.throws(() => p.symbols.sprite('rabbit', 22), /SYMBOLS\.load/);
  assert.throws(() => p.symbols.drawAnimal({}, 'rabbit', 0, 0, 64), /SYMBOLS\.load/);
  assert.equal(p.canvases.length, 0, 'failed early drawing must not allocate/cache blank sprites');
}

let scenarios = 0;
function test(name, run) {
  run(); scenarios++;
  console.log('ok  ', name);
}

test('drawing is unavailable before a delayed image load completes', () => {
  const p = platform();
  assert.equal(p.images.length, 0, 'decoding starts only when requested');
  requireReady(p);
  let ready = 0;
  p.symbols.load(() => { ready++; });
  assert.equal(p.images.length, 1);
  assert.equal(ready, 0);
  requireReady(p);
  p.images[0].succeed();
  assert.equal(ready, 1);
  assert.match(p.symbols.sprite('rabbit', 22), /^data:image\/png;base64,/);
  assert.equal(p.canvases.length, 1);
  assert.equal(p.canvases[0].draws.length, 1, 'the first cached sprite contains a loaded animal');
});

test('concurrent callers share one image and completion is delivered exactly once', () => {
  const p = platform(), ready = [0, 0], errors = [];
  p.symbols.load(() => { ready[0]++; }, e => errors.push(e));
  p.symbols.load(() => { ready[1]++; }, e => errors.push(e));
  assert.equal(p.images.length, 1);
  const image = p.images[0], lateLoad = image.onload, lateError = image.onerror;
  image.succeed();
  assert.deepEqual(ready, [1, 1]);
  assert.equal(image.onload, null);
  assert.equal(image.onerror, null);
  lateLoad(); lateError();
  assert.deepEqual(ready, [1, 1]);
  assert.equal(errors.length, 0);
  let synchronous = false;
  p.symbols.load(() => { synchronous = true; });
  assert.equal(synchronous, true, 'a ready image must not add an asynchronous boot delay');
  assert.equal(p.images.length, 1);
});

test('decode errors notify all callers, preserve the drawing guard, and allow retry', () => {
  const p = platform(), errors = [];
  let ready = 0;
  p.symbols.load(() => { ready++; }, e => errors.push(e));
  p.symbols.load(() => { ready++; }, e => errors.push(e));
  const failed = p.images[0], staleLoad = failed.onload, staleError = failed.onerror;
  failed.fail();
  assert.equal(errors.length, 2);
  assert.equal(errors[0], errors[1]);
  assert.match(errors[0].message, /wczytać ilustracji/);
  assert.equal(ready, 0);
  requireReady(p);
  p.symbols.load(() => { ready++; }, e => errors.push(e));
  assert.equal(p.images.length, 2);
  failed.naturalWidth = failed.naturalHeight = 1536;
  staleLoad(); staleError();
  assert.equal(ready, 0, 'late events from a failed attempt cannot complete its replacement');
  p.images[1].succeed();
  assert.equal(ready, 1);
  assert.equal(errors.length, 2);
  const sprite = p.symbols.sprite('sheep', 28);
  assert.equal(p.canvases[0].draws[0][0], p.images[1]);
  assert.equal(p.symbols.sprite('sheep', 28), sprite);
  assert.equal(p.canvases.length, 1);
});

test('a throwing observer does not prevent other queued callers from being notified', () => {
  for (const outcome of ['success', 'error']) {
    const p = platform(), observerError = new Error('Observer failed');
    const notified = [];
    const throws = () => { throw observerError; };
    p.symbols.load(throws, throws);
    p.symbols.load(() => notified.push('success'), () => notified.push('error'));
    if (outcome === 'success') p.images[0].succeed();
    else p.images[0].fail();
    assert.deepEqual(notified, [outcome]);
    assert.equal(p.scheduled.length, 1, 'the observer failure is surfaced after notifying the queue');
    assert.equal(p.scheduled[0].delay, 0);
    assert.throws(p.scheduled[0].callback, error => error === observerError);
  }
});

test('empty, nonsquare and indivisible source dimensions are rejected and can be retried', () => {
  for (const [width, height] of [[0, 0], [1536, 1024], [1024, 1024]]) {
    const p = platform();
    let ready = 0, error;
    p.symbols.load(() => { ready++; }, e => { error = e; });
    p.images[0].succeed(width, height);
    assert.equal(ready, 0);
    assert.match(error.message, /Nieprawidłowy arkusz/);
    requireReady(p);
    p.symbols.load(() => { ready++; }, () => assert.fail('valid replacement should load'));
    p.images[1].succeed();
    assert.equal(ready, 1);
  }
});

test('a synchronous image-source error releases the loader for another attempt', () => {
  const p = platform({ sourceFailures: 1 });
  let error, ready = 0;
  assert.doesNotThrow(() => p.symbols.load(() => { ready++; }, e => { error = e; }));
  assert.match(error.message, /could not be assigned/);
  requireReady(p);
  p.symbols.load(() => { ready++; }, () => assert.fail('retry should succeed'));
  p.images[1].succeed();
  assert.equal(ready, 1);
});

test('development URLs resolve beside the source and bundled data needs no external asset', () => {
  const development = platform();
  development.symbols.load();
  assert.equal(development.images[0].src, 'https://game.test/superfarmer/assets/animals.webp');
  const data = 'data:image/webp;base64,UklGRg==';
  const bundled = platform({ inlineSource: data });
  bundled.symbols.load();
  assert.equal(bundled.images[0].src, data);
});

test('all nine animals crop distinct source cells and retina sprites are cached only after drawing', () => {
  const p = platform();
  p.symbols.load(); p.images[0].succeed();
  const sourceCells = {
    rabbit: [0, 0], sheep: [512, 0], pig: [1024, 0],
    cow: [0, 512], horse: [512, 512], smallDog: [1024, 512],
    bigDog: [0, 1024], wolf: [512, 1024], fox: [1024, 1024]
  };
  for (const [animal, origin] of Object.entries(sourceCells)) {
    for (const px of [18, 22, 28]) {
      const count = p.canvases.length;
      const sprite = p.symbols.sprite(animal, px);
      assert.equal(p.canvases.length, count + 1);
      const canvas = p.canvases.at(-1);
      assert.equal(canvas.width, px * 2);
      assert.equal(canvas.height, px * 2);
      assert.equal(canvas.draws.length, 1);
      assert.equal(canvas.draws[0][0], p.images[0]);
      assert.deepEqual(canvas.draws[0].slice(1, 5), [...origin, 512, 512]);
      const [x, y, width, height] = canvas.draws[0].slice(5);
      assert.ok(x > 0 && y > 0 && x + width < canvas.width && y + height < canvas.height);
      assert.equal(p.symbols.sprite(animal, px), sprite);
      assert.equal(p.canvases.length, count + 1, 'a cached request must not redraw');
    }
  }
});

test('the dice atlas preserves seven 4×2 cells and leaves the eighth cell untouched', () => {
  const p = platform();
  p.symbols.load(); p.images[0].succeed();
  const order = ['rabbit', 'sheep', 'pig', 'cow', 'horse', 'wolf', 'fox'];
  assert.deepEqual(Array.from(p.symbols.ORDER), order);
  assert.equal(p.symbols.GRID_X, 4); assert.equal(p.symbols.GRID_Y, 2);
  const atlas = p.symbols.buildAtlas(2048);
  assert.equal(atlas.width, 2048); assert.equal(atlas.height, 1024);
  assert.equal(atlas.draws.length, 7);
  const expectedSources = [[0, 0], [512, 0], [1024, 0], [0, 512], [512, 512], [512, 1024], [1024, 1024]];
  atlas.draws.forEach((draw, index) => {
    assert.deepEqual(draw.slice(1, 5), [...expectedSources[index], 512, 512]);
    const cell = p.symbols.cellOf(order[index]);
    assert.equal(cell.index, index);
    assert.equal(cell.col, index % 4); assert.equal(cell.row, Math.floor(index / 4));
    const [x, y, width, height] = draw.slice(5);
    assert.ok(x > cell.col * 512 && y > cell.row * 512);
    assert.ok(x + width < (cell.col + 1) * 512 && y + height < (cell.row + 1) * 512,
      'every animal must remain inside its own padded dice cell');
  });
});

console.log('\nSymbol artwork integration OK: ' + scenarios + ' scenarios.');
