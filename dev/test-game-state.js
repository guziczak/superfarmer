// Integration regressions execute the real RULES, AI and main.js in a small
// browser shell. Only rendering, storage, clocks and transport are replaced.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const RULES = require('../src/rules.js');
const LOCAL = 'sf3d.save.v1';
const NETWORK = 'sf3d.netsave.v1';
const sources = ['rules.js', 'ai.js', 'main.js'].map(file => ({
  file, text: fs.readFileSync(path.join(__dirname, '../src', file), 'utf8')
}));
const copy = value => JSON.parse(JSON.stringify(value));
const h = values => ({ ...RULES.emptyHerd(), ...values });

function position(mode = 'duo', overrides = {}, herds = [h({}), h({})]) {
  const stock = Object.fromEntries(RULES.ANIMALS.map(a => [a, RULES.STOCK_INIT[a] - herds[0][a] - herds[1][a]]));
  return {
    v: 2, mode, bias: { m: 'w', v: [0, 0] },
    players: herds.map((herd, i) => ({ name: i ? 'Ola' : 'Ada', isBot: mode === 'solo' && i === 1, herd: copy(herd) })),
    stock, cur: 0, turnCount: 1, exchangeUsed: false, phase: 'preroll',
    stats: { rolls: [0, 0], wolfEaten: [0, 0], foxStolen: [0, 0], dogSaves: [0, 0] },
    ...overrides
  };
}
function saved(s) { return new Map([[LOCAL, JSON.stringify(s)]]); }

function browser(storage = new Map(), options = {}) {
  let ui, callbacks, scene, now = 0, timerId = 0;
  let artworkCallbacks, artworkLoads = 0, atlasCount = 0;
  let readability = { readable: false, scale: 100, calm: !!options.calm };
  const timers = new Map(), elements = new Map(), windowEvents = new Map(), calls = [], sent = [];
  const record = (name, args) => calls.push({ name, args: copy(args) });
  const el = id => {
    if (!elements.has(id)) elements.set(id, {
      id, hidden: false, value: '', textContent: '', innerHTML: '', dataset: {},
      classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}
    });
    return elements.get(id);
  };
  const HUD = new Proxy({
    init(cbs) { ui = cbs; },
    getReadability() { return { ...readability }; },
    measureInsets() { return { top: 0, bottom: 0 }; },
    eventBig(...args) { record('eventBig', args); return Promise.resolve(); }
  }, { get(target, key) { return key in target ? target[key] : (...args) => record(key, args); } });
  class DiceScene {
    constructor(config) {
      this.config = config; this.throws = 0; this.frames = 0; this.busy = false;
      this.canvas = config.canvas; this.canvas.clientWidth = 800; this.canvas.clientHeight = 600;
      this.resizeCount = 0; this.resizes = []; this.insetCalls = []; this.remoteEnds = 0;
      this.compatibilityMode = !!options.compatibilityMode; scene = this;
    }
    setTuning() {}
    setInteractive(on) { this.interactive = on; }
    setRemoteDriven(on) { this.remote = on; }
    setInsets(insets) { this.insetCalls.push(copy(insets)); }
    resize() {
      this.resizeCount++;
      this.resizes.push({
        width: this.canvas.clientWidth, height: this.canvas.clientHeight,
        busy: this.busy, remote: !!this.remote,
        localSave: storage.get(LOCAL), networkSave: storage.get(NETWORK)
      });
      record('sceneResize', [this.canvas.clientWidth, this.canvas.clientHeight]);
    }
    shake() {}
    endRemoteRoll() { this.remote = false; this.remoteEnds++; }
    applyNetFrame() { this.frames++; }
    getDieScreenPos() { return { x: 10, y: 20 }; }
    getNetFrame() { return [[0, 1, 0, 0, 0, 0, 1], [0, 1, 0, 0, 0, 0, 1]]; }
    isBusy() { return this.busy; }
    throwAuto() { this.throws++; this.busy = true; this.config.onThrow(); }
    settle(faces) { this.busy = false; this.config.onSettle(faces); }
    abort(message) { this.busy = false; this.config.onRollError(message); }
  }
  const document = {
    readyState: 'complete', documentElement: { dataset: {} },
    getElementById: el, addEventListener() {}
  };
  const context = {
    console, document, location: { search: '' }, navigator: {},
    window: { addEventListener(type, callback) { windowEvents.set(type, callback); } },
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); }
    },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, due: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval() { return ++timerId; }, clearInterval() {},
    HUD, DiceScene,
    SYMBOLS: {
      load(done, onError) {
        artworkCallbacks = { done, onError }; artworkLoads++;
        if (!options.deferArtwork) done();
      },
      buildAtlas() { atlasCount++; return {}; }, plural(sym) { return sym; },
      NAMES_PL: Object.fromEntries([...RULES.ANIMALS, 'fox', 'wolf'].map(a => [a, [a]]))
    },
    AUDIO: new Proxy({ isEnabled() { return true; } }, {
      get(target, key) { return key in target ? target[key] : () => {}; }
    }),
    NET: {
      send(message) { sent.push(copy(message)); }, close() {}, stopScan() {}, drawQR() {},
      startGuest(_els, cbs) { callbacks = cbs; }, startHost(_els, cbs) { callbacks = cbs; }
    }
  };
  vm.createContext(context);
  for (const source of sources) vm.runInContext(source.text, context, { filename: source.file });
  async function microtasks() { for (let i = 0; i < 16; i++) await Promise.resolve(); }
  async function advance(ms) {
    const target = now + ms;
    await microtasks();
    let steps = 0;
    while (true) {
      const next = [...timers.entries()].filter(([, t]) => t.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      if (++steps > 200) throw Error('Timer loop did not settle');
      const [id, timer] = next;
      timers.delete(id); now = timer.due; timer.fn(); await microtasks();
    }
    now = target;
    await microtasks();
  }
  return {
    get ui() { return ui; }, get scene() { return scene; },
    calls, sent, storage, document, advance, microtasks,
    get artworkLoads() { return artworkLoads; }, get atlasCount() { return atlasCount; },
    resolveArtwork() { artworkCallbacks.done(); },
    rejectArtwork() { artworkCallbacks.onError(new Error('Artwork unavailable')); },
    get state() { return context.window.__SF.state; },
    get connection() { return callbacks; },
    peer(m) { callbacks.onMsg(m); },
    windowEvent(type) { windowEvents.get(type)(); },
    setReadability(changes) {
      readability = { ...readability, ...changes };
      ui.onReadabilityChange({ ...readability });
    },
    last(name) { return calls.filter(c => c.name === name).at(-1); },
    startNet(resume) {
      ui.onNetJoin('Ola'); callbacks.onOpen();
      callbacks.onMsg(resume
        ? { t: 'go', v: 2, resume }
        : { t: 'go', v: 2, names: ['Ada', 'Ola'], bias: { m: 'w', v: [0, 0] } });
    }
  };
}

async function twoCompletedRolls() {
  const b = browser(saved(position('duo', {}, [h({ rabbit: 3, sheep: 1 }), h({})])));
  b.ui.onResume(); b.ui.onRollClick(); b.scene.settle(['rabbit', 'sheep']); await b.advance(2000);
  b.ui.onRollClick(); b.scene.settle(['rabbit', 'rabbit']); await b.advance(2000);
  return b;
}

let passed = 0;
async function test(name, run) {
  await run(); passed++; console.log('ok  ', name);
}

(async () => {
  await test('boot waits for illustrations before constructing the atlas, scene or HUD', () => {
    const b = browser(new Map(), { deferArtwork: true });
    assert.equal(b.ui, undefined);
    assert.equal(b.scene, undefined);
    assert.equal(b.atlasCount, 0);
    assert.match(b.document.getElementById('modeButtons').innerHTML, /Przygotowuję ilustracje/);
    b.resolveArtwork();
    assert.ok(b.ui && b.scene);
    assert.equal(b.atlasCount, 1);
    const scene = b.scene;
    b.resolveArtwork();
    assert.equal(b.scene, scene);
    assert.equal(b.atlasCount, 1);
  });

  await test('an illustration load error leaves boot retryable without caching a blank atlas', () => {
    const b = browser(new Map(), { deferArtwork: true });
    b.rejectArtwork();
    assert.equal(b.ui, undefined);
    assert.equal(b.scene, undefined);
    assert.equal(b.atlasCount, 0);
    assert.match(b.document.getElementById('modeButtons').innerHTML, /Nie udało się/);
    b.document.getElementById('btnRetryArtwork').onclick();
    assert.equal(b.artworkLoads, 2);
    assert.equal(b.atlasCount, 0);
    b.resolveArtwork();
    assert.ok(b.ui && b.scene);
    assert.equal(b.atlasCount, 1);
  });

  await test('idle accessibility layout resizes a changed canvas without a window event, but insets alone do not', () => {
    const b = browser(); b.ui.onModeStart('duo', ['Ada', 'Ola'], [0, 0]);
    const initialResizes = b.scene.resizeCount;
    const initialState = copy(b.state);
    b.setReadability({ readable: true, scale: 150 });
    b.scene.canvas.clientWidth = 390; b.scene.canvas.clientHeight = 460;
    const readableInsets = { top: 0, right: 0, bottom: 0, left: 0 };
    b.ui.onLayoutChange(readableInsets);
    assert.equal(b.scene.resizeCount, initialResizes + 1);
    assert.deepEqual(b.last('sceneResize').args, [390, 460]);
    assert.deepEqual(b.scene.insetCalls.at(-1), readableInsets);
    const overlayInsets = { top: 86, right: 12, bottom: 164, left: 12 };
    b.ui.onLayoutChange(overlayInsets);
    assert.deepEqual(b.scene.insetCalls.at(-1), overlayInsets);
    assert.equal(b.scene.resizeCount, initialResizes + 1);
    b.windowEvent('resize');
    assert.equal(b.scene.resizeCount, initialResizes + 1);
    b.scene.canvas.clientHeight = 500; b.windowEvent('resize');
    assert.equal(b.scene.resizeCount, initialResizes + 2);
    assert.deepEqual(b.last('sceneResize').args, [390, 500]);
    assert.deepEqual(copy(b.state), initialState);
  });

  await test('a layout change waits for a local throw to end and preserves the committed faces and statistics', async () => {
    const b = browser(saved(position('duo', {}, [h({ rabbit: 3, sheep: 1 }), h({})])));
    b.ui.onResume(); b.ui.onRollClick();
    const initialResizes = b.scene.resizeCount;
    b.scene.canvas.clientWidth = 360; b.scene.canvas.clientHeight = 500;
    b.ui.onLayoutChange({ top: 0, bottom: 0 });
    b.scene.canvas.clientHeight = 540; b.windowEvent('resize');
    assert.equal(b.scene.isBusy(), true);
    assert.equal(b.scene.resizeCount, initialResizes);
    assert.deepEqual(copy(b.state.stats.rolls), [0, 0]);
    const beforeSettle = b.calls.length;
    b.scene.settle(['rabbit', 'sheep']);
    assert.equal(b.scene.resizeCount, initialResizes + 1);
    const resized = b.scene.resizes.at(-1);
    assert.equal(resized.busy, false); assert.equal(resized.remote, false);
    assert.deepEqual([resized.width, resized.height], [360, 540]);
    const committed = JSON.parse(resized.localSave);
    assert.equal(committed.phase, 'resolving');
    assert.deepEqual(committed.resolvedRoll, { player: 0, turn: 1, faces: ['rabbit', 'sheep'] });
    assert.deepEqual(committed.stats.rolls, [1, 0]);
    assert.deepEqual(committed.lastRolls[0].faces, ['rabbit', 'sheep']);
    assert.deepEqual(committed.lastRolls[0].changes, h({ rabbit: 2, sheep: 1 }));
    const presentation = b.calls.slice(beforeSettle).map(call => call.name);
    assert.ok(presentation.indexOf('sceneResize') < presentation.indexOf('showLastRolls'));
    assert.ok(presentation.indexOf('sceneResize') < presentation.indexOf('dieLabels'));
    b.ui.onLayoutChange({ top: 0, bottom: 0 }); await b.advance(2000);
    assert.equal(b.scene.resizeCount, initialResizes + 1);
    assert.equal(b.state.cur, 1); assert.equal(b.state.phase, 'preroll');
    assert.deepEqual(copy(b.state.stats.rolls), [1, 0]);
    assert.deepEqual(copy(b.state.lastRolls[0]), committed.lastRolls[0]);

    // A failed roll also releases a pending layout without changing the last result.
    b.ui.onRollClick(); b.scene.canvas.clientHeight = 600;
    b.ui.onLayoutChange({ top: 0, bottom: 0 });
    assert.equal(b.scene.resizeCount, initialResizes + 1);
    b.scene.abort('Ponów rzut.');
    assert.equal(b.scene.resizeCount, initialResizes + 2);
    assert.equal(b.state.phase, 'preroll'); assert.equal(b.state.cur, 1);
    assert.deepEqual(copy(b.state.stats.rolls), [1, 0]);
    assert.deepEqual(copy(b.state.lastRolls[0]), committed.lastRolls[0]);
  });

  await test('remote frames defer canvas resizing until the remote roll is ended and its result is committed', async () => {
    const b = browser(); b.startNet();
    const initialResizes = b.scene.resizeCount;
    const frame = { t: 'f', turn: 1, player: 0, d: b.scene.getNetFrame() };
    b.peer(frame);
    assert.equal(b.scene.remote, true); assert.equal(b.scene.isBusy(), false);
    b.scene.canvas.clientWidth = 375; b.scene.canvas.clientHeight = 650;
    b.ui.onLayoutChange({ top: 0, bottom: 0 });
    assert.equal(b.scene.resizeCount, initialResizes);
    b.peer({ t: 'roll', turn: 1, player: 0 }); b.peer(frame);
    b.scene.canvas.clientHeight = 700; b.windowEvent('resize');
    assert.equal(b.scene.frames, 2); assert.equal(b.scene.remoteEnds, 0);
    assert.equal(b.scene.resizeCount, initialResizes);
    b.peer({ t: 'set', turn: 1, player: 0, faces: ['rabbit', 'rabbit'] });
    assert.equal(b.scene.remote, false); assert.equal(b.scene.remoteEnds, 1);
    assert.equal(b.scene.resizeCount, initialResizes + 1);
    const resized = b.scene.resizes.at(-1);
    assert.equal(resized.remote, false); assert.equal(resized.busy, false);
    assert.deepEqual([resized.width, resized.height], [375, 700]);
    const committed = JSON.parse(resized.networkSave).state;
    assert.equal(committed.phase, 'resolving');
    assert.deepEqual(committed.resolvedRoll, { player: 0, turn: 1, faces: ['rabbit', 'rabbit'] });
    assert.deepEqual(committed.stats.rolls, [1, 0]);
    assert.deepEqual(committed.lastRolls[0].changes, h({ rabbit: 1 }));
    await b.advance(2000);
    assert.equal(b.scene.resizeCount, initialResizes + 1);
    assert.equal(b.state.cur, 1); assert.equal(b.state.phase, 'preroll');
    assert.deepEqual(copy(b.state.stats.rolls), [1, 0]);
    assert.deepEqual(copy(b.state.lastRolls), committed.lastRolls);
  });

  await test('resume preserves current player, round and the already used exchange', () => {
    const s = position('duo', { cur: 1, turnCount: 4, exchangeUsed: true }, [h({}), h({ rabbit: 12 })]);
    const b = browser(saved(s)); b.ui.onResume();
    assert.equal(b.state.cur, 1); assert.equal(b.state.turnCount, 4); assert.equal(b.state.exchangeUsed, true);
    assert.equal(b.last('setDock').args[1].exchangeUsed, true);
    const before = JSON.stringify(b.state);
    b.ui.onExchangeApply(RULES.EXCHANGE_RATES[0], 1, 1, 'rabbit', 'sheep');
    assert.equal(JSON.stringify(b.state), before);
  });

  await test('resuming the bot after its exchange does not allow a second exchange', async () => {
    const s = position('solo', { cur: 1, exchangeUsed: true }, [h({}), h({ rabbit: 13 })]);
    const b = browser(saved(s)); b.ui.onResume(); await b.advance(1800);
    assert.equal(b.state.players[1].herd.rabbit, 13);
    assert.equal(b.state.players[1].herd.sheep, 0);
    assert.equal(b.scene.throws, 1); assert.equal(b.state.phase, 'rolling');
    assert.equal(JSON.parse(b.storage.get(LOCAL)).exchangeUsed, true);
  });

  await test('settled result and statistics are stored before the first animation', () => {
    const b = browser(saved(position('duo', {}, [h({ rabbit: 3, sheep: 1 }), h({})])));
    b.ui.onResume(); b.ui.onRollClick(); b.scene.settle(['rabbit', 'sheep']);
    const state = JSON.parse(b.storage.get(LOCAL));
    assert.equal(state.phase, 'resolving');
    assert.equal(state.players[0].herd.rabbit, 5); assert.equal(state.players[0].herd.sheep, 2);
    assert.deepEqual(state.stats.rolls, [1, 0]);
    assert.deepEqual(state.resolvedRoll, { player: 0, turn: 1, faces: ['rabbit', 'sheep'] });
    assert.equal(state.lastRolls[0].turn, 1);
    assert.deepEqual(state.lastRolls[0].faces, ['rabbit', 'sheep']);
    assert.deepEqual(state.lastRolls[0].changes, h({ rabbit: 2, sheep: 1 }));
    assert.deepEqual(state.lastRolls[0].before, h({ rabbit: 3, sheep: 1 }));
    assert.equal(state.lastRolls[1], null);
    assert.deepEqual(b.last('showLastRolls').args, [state, 0]);
    const resumed = browser(b.storage); resumed.ui.onResume();
    assert.equal(resumed.state.cur, 1); assert.equal(resumed.state.turnCount, 1);
    assert.equal(resumed.state.phase, 'preroll'); assert.equal(resumed.state.exchangeUsed, false);
    assert.equal(resumed.state.players[0].herd.rabbit, 5);
    const again = browser(b.storage); again.ui.onResume();
    assert.equal(again.state.cur, 1); assert.deepEqual(copy(again.state.stats.rolls), [1, 0]);
    assert.deepEqual(copy(again.state.lastRolls), state.lastRolls);
    assert.equal(again.calls.filter(c => c.name === 'showLastRolls').length, 0);
  });

  await test('each player keeps an independent last roll across turns, exchanges and menu resume', async () => {
    const b = await twoCompletedRolls();
    const records = copy(b.state.lastRolls);
    assert.equal(b.state.turnCount, 2); assert.equal(b.state.cur, 0);
    assert.deepEqual(records.map(roll => roll.turn), [1, 1]);
    assert.deepEqual(records[0].changes, h({ rabbit: 2, sheep: 1 }));
    assert.deepEqual(records[1].changes, h({ rabbit: 1 }));
    assert.deepEqual(records[1].faces, ['rabbit', 'rabbit']);
    b.ui.onExchangeApply(RULES.EXCHANGE_RATES[0], -1, 1, 'sheep', 'rabbit');
    assert.equal(b.state.players[0].herd.rabbit, 11);
    assert.deepEqual(copy(b.state.lastRolls), records);
    b.ui.onBackToMenu(); b.ui.onResume();
    assert.equal(b.last('setViewPlayer').args[0], null);
    assert.deepEqual(copy(b.state.lastRolls), records);
    assert.deepEqual(copy(b.state.stats.rolls), [1, 1]);
    assert.equal(b.calls.filter(c => c.name === 'showLastRolls').length, 2);
    b.ui.onRollClick(); b.scene.config.onRollError('Ponów rzut.');
    assert.deepEqual(copy(b.state.lastRolls), records);
    assert.deepEqual(copy(b.state.stats.rolls), [1, 1]);
    b.ui.onRollClick(); b.scene.settle(['wolf', 'fox']);
    assert.equal(b.state.lastRolls[0].turn, 2);
    assert.deepEqual(copy(b.state.lastRolls[0].faces), ['wolf', 'fox']);
    assert.deepEqual(copy(b.state.lastRolls[1]), records[1]);
    assert.deepEqual(records[0].before, h({ rabbit: 3, sheep: 1 }));
    assert.equal(b.calls.filter(c => c.name === 'showLastRolls').length, 3);
  });

  await test('saved roll effects are rebuilt from bounded snapshots, ignoring untrusted descriptions', async () => {
    const source = await twoCompletedRolls();
    const original = copy(source.state.lastRolls);
    const s = copy(source.state);
    for (const roll of s.lastRolls) {
      roll.events = [{ t: 'gain', animal: '<img src=x>', n: 1e100 }, { t: 'wolf', total: -5 }];
      roll.changes = { rabbit: '<script>bad()</script>' };
      roll.description = '<img src=x onerror=bad()>';
      roll.before.extra = 'untrusted'; roll.stockBefore.extra = 123;
    }
    const b = browser(saved(s));
    assert.equal(b.last('showStart').args[0].canResume, true);
    b.ui.onResume();
    assert.deepEqual(copy(b.state.lastRolls), original);
    assert.deepEqual(JSON.parse(b.storage.get(LOCAL)).lastRolls, original);
  });

  await test('invalid optional roll metadata is dropped without rejecting a valid game or its other result', async () => {
    const source = await twoCompletedRolls();
    const good = copy(source.state);
    const corruptions = [
      s => { s.lastRolls[0] = '<script>bad()</script>'; },
      s => { s.lastRolls[0].turn = 0; }, s => { s.lastRolls[0].turn = 1.5; },
      s => { s.lastRolls[0].turn = s.turnCount; },
      s => { s.lastRolls[0].faces = ['horse', 'rabbit']; },
      s => { s.lastRolls[0].faces.push('wolf'); },
      s => { delete s.lastRolls[0].before.sheep; },
      s => { s.lastRolls[0].before.rabbit = -1; },
      s => { s.lastRolls[0].before.rabbit = '3'; },
      s => { s.lastRolls[0].before.rabbit = 3.5; },
      s => { s.lastRolls[0].before = h({ rabbit: 1, sheep: 1, pig: 1, cow: 1, horse: 1 }); },
      s => { s.lastRolls[0].stockBefore = null; },
      s => { s.lastRolls[0].stockBefore.rabbit = 60; },
      s => { s.stats.rolls[0] = 0; }
    ];
    for (const corrupt of corruptions) {
      const s = copy(good); corrupt(s);
      const b = browser(saved(s));
      assert.equal(b.last('showStart').args[0].canResume, true);
      b.ui.onResume();
      assert.equal(b.state.lastRolls[0], null);
      assert.deepEqual(copy(b.state.lastRolls[1]), good.lastRolls[1]);
      assert.deepEqual(copy(b.state.players), good.players);
      assert.equal(b.state.turnCount, good.turnCount);
    }
    for (const invalid of [undefined, null, {}, [], [good.lastRolls[0]], [null, null, null]]) {
      const s = copy(good); s.lastRolls = invalid;
      const b = browser(saved(s)); b.ui.onResume();
      assert.deepEqual(copy(b.state.lastRolls), [null, null]);
      assert.deepEqual(copy(b.state.players), good.players);
    }
  });

  await test('current roll metadata must agree with its already committed outcome', () => {
    const source = browser(); source.ui.onModeStart('duo', ['Ada', 'Ola'], [0, 0]);
    source.ui.onRollClick(); source.scene.settle(['rabbit', 'rabbit']);
    const good = JSON.parse(source.storage.get(LOCAL));
    for (const corrupt of [
      s => { s.lastRolls[0].faces = ['sheep', 'sheep']; },
      s => { s.lastRolls[0].stockBefore.rabbit -= 1; },
      s => { s.lastRolls[0].before.rabbit = 1; s.lastRolls[0].stockBefore.rabbit -= 1; }
    ]) {
      const s = copy(good); corrupt(s);
      const b = browser(saved(s)); b.ui.onResume();
      assert.equal(b.state.cur, 1);
      assert.deepEqual(copy(b.state.lastRolls), [null, null]);
      assert.deepEqual(copy(b.state.players), good.players);
      assert.deepEqual(copy(b.state.stats.rolls), [1, 0]);
    }
  });

  await test('resuming an already committed second-player roll advances the round exactly once', () => {
    const b = browser(saved(position('duo', { cur: 1, turnCount: 7 })));
    b.ui.onResume(); b.ui.onRollClick(); b.scene.settle(['rabbit', 'rabbit']);
    const resumed = browser(b.storage); resumed.ui.onResume();
    assert.equal(resumed.state.cur, 0); assert.equal(resumed.state.turnCount, 8);
    assert.equal(resumed.state.players[1].herd.rabbit, 1);
    assert.equal(resumed.state.stats.rolls[1], 1);
  });

  await test('reload during a winning roll shows the winner without another roll', () => {
    const b = browser(saved(position('duo', {}, [h({ sheep: 1, pig: 1, cow: 1, horse: 1 }), h({})])));
    b.ui.onResume(); b.ui.onRollClick(); b.scene.settle(['rabbit', 'rabbit']);
    assert.equal(JSON.parse(b.storage.get(LOCAL)).phase, 'resolving');
    const resumed = browser(b.storage); resumed.ui.onResume();
    assert.equal(resumed.state.phase, 'gameover'); assert.equal(resumed.scene.throws, 0);
    assert.ok(resumed.last('showWin')); assert.equal(resumed.storage.has(LOCAL), false);
  });

  await test('predator losses and both dog saves are committed once, before animations', async () => {
    for (const protect of [false, true]) {
      const herd = h({ rabbit: 6, sheep: 2, pig: 1, cow: 1, horse: 0, smallDog: protect ? 1 : 0, bigDog: protect ? 1 : 0 });
      const b = browser(saved(position('duo', {}, [herd, h({})])));
      b.ui.onResume(); b.ui.onRollClick(); b.scene.settle(['wolf', 'fox']);
      const s = JSON.parse(b.storage.get(LOCAL));
      assert.equal(s.stats.wolfEaten[0], protect ? 0 : 10);
      assert.equal(s.stats.dogSaves[0], protect ? 2 : 0);
      assert.equal(s.players[0].herd.rabbit, protect ? 6 : 0);
      assert.deepEqual(s.lastRolls[0].changes, protect
        ? h({ smallDog: -1, bigDog: -1 }) : h({ rabbit: -6, sheep: -2, pig: -1, cow: -1 }));
      assert.deepEqual(s.lastRolls[0].events, protect
        ? [{ t: 'wolf', saved: true }, { t: 'fox', saved: true }]
        : [{ t: 'wolf', saved: false, eaten: { rabbit: 6, sheep: 2, pig: 1, cow: 1 }, total: 10 },
          { t: 'fox', saved: false, lost: 0 }]);
      await b.advance(4000);
      assert.equal(b.state.stats.dogSaves[0], protect ? 2 : 0);
      assert.equal(b.state.stats.wolfEaten[0], protect ? 0 : 10);
      const resumed = browser(b.storage); resumed.ui.onResume();
      assert.deepEqual(copy(resumed.state.lastRolls[0]), s.lastRolls[0]);
    }
  });

  await test('readable roll effects include fox losses, defense with births and exhausted stock', () => {
    const cases = [
      { herd: h({ rabbit: 6, sheep: 1 }), faces: ['sheep', 'fox'], changes: h({ rabbit: -6, sheep: 1 }),
        events: [{ t: 'fox', saved: false, lost: 6 }, { t: 'gain', animal: 'sheep', n: 1, capped: false }] },
      { herd: h({ rabbit: 6, sheep: 1, smallDog: 1 }), faces: ['sheep', 'fox'], changes: h({ sheep: 1, smallDog: -1 }),
        events: [{ t: 'fox', saved: true }, { t: 'gain', animal: 'sheep', n: 1, capped: false }] },
      { herd: h({ rabbit: 60 }), faces: ['rabbit', 'rabbit'], changes: h({}),
        events: [{ t: 'gain', animal: 'rabbit', n: 0, capped: true }, { t: 'nothing' }] }
    ];
    for (const scenario of cases) {
      const b = browser(saved(position('duo', {}, [scenario.herd, h({})])));
      b.ui.onResume(); b.ui.onRollClick(); b.scene.settle(scenario.faces);
      const roll = JSON.parse(b.storage.get(LOCAL)).lastRolls[0];
      assert.deepEqual(roll.changes, scenario.changes);
      assert.deepEqual(roll.events, scenario.events);
      const resumed = browser(b.storage); resumed.ui.onResume();
      assert.deepEqual(copy(resumed.state.lastRolls[0]), roll);
    }
  });

  await test('calm play waits after either local player and Continue cannot apply a result or skip a turn twice', async () => {
    for (const mode of ['duo', 'solo']) {
      const b = browser(new Map(), { calm: true });
      b.ui.onModeStart(mode, ['Ada', 'Ola'], [0, 0]);
      assert.equal(b.last('setViewPlayer').args[0], mode === 'solo' ? 0 : null);
      b.ui.onRollClick(); b.scene.settle(['rabbit', 'rabbit']);
      b.ui.onContinue(); // An early click cannot cancel presentation or advance the transaction.
      assert.equal(b.state.cur, 0); assert.equal(b.state.phase, 'resolving');
      await b.advance(6000);
      assert.equal(b.state.cur, 0); assert.equal(b.state.phase, 'resolving');
      assert.equal(b.last('setDock').args[0], 'await-next');
      assert.equal(b.scene.interactive, false); assert.equal(b.scene.throws, 1);
      b.ui.onRollClick(); assert.equal(b.scene.throws, 1);
      b.ui.onContinue(); b.ui.onContinue();
      assert.equal(b.state.cur, 1); assert.equal(b.state.turnCount, 1);
      assert.deepEqual(copy(b.state.stats.rolls), [1, 0]);
      if (mode === 'solo') await b.advance(1800); else b.ui.onRollClick();
      assert.equal(b.scene.throws, 2);
      b.scene.settle(['rabbit', 'rabbit']); await b.advance(6000);
      assert.equal(b.state.cur, 1); assert.equal(b.state.phase, 'resolving');
      assert.equal(b.last('setDock').args[0], 'await-next');
      assert.equal(b.scene.throws, 2);
      b.ui.onContinue(); b.ui.onContinue();
      assert.equal(b.state.cur, 0); assert.equal(b.state.turnCount, 2);
      assert.deepEqual(copy(b.state.stats.rolls), [1, 1]);
      assert.deepEqual(copy(b.state.players.map(p => p.herd.rabbit)), [1, 1]);
      assert.deepEqual(copy(b.state.lastRolls.map(roll => roll.turn)), [1, 1]);
      assert.equal(b.calls.filter(c => c.name === 'showLastRolls').length, 2);
    }
  });

  await test('resuming a committed calm result waits without rerolling, reapplying or repeating its announcement', async () => {
    const b = browser(new Map(), { calm: true });
    b.ui.onModeStart('duo', ['Ada', 'Ola'], [0, 0]);
    b.ui.onRollClick(); b.scene.settle(['rabbit', 'rabbit']); await b.advance(2000);
    const committed = JSON.parse(b.storage.get(LOCAL));
    const resumed = browser(b.storage, { calm: true }); resumed.ui.onResume(); await resumed.advance(6000);
    assert.equal(resumed.state.phase, 'resolving'); assert.equal(resumed.state.cur, 0);
    assert.equal(resumed.last('setDock').args[0], 'await-next');
    assert.equal(resumed.scene.throws, 0);
    assert.deepEqual(copy(resumed.state.lastRolls), committed.lastRolls);
    assert.deepEqual(copy(resumed.state.stats.rolls), [1, 0]);
    assert.equal(resumed.calls.filter(c => c.name === 'showLastRolls').length, 0);
    resumed.ui.onContinue(); resumed.ui.onContinue();
    assert.equal(resumed.state.cur, 1); assert.equal(resumed.state.phase, 'preroll');
    assert.equal(resumed.state.players[0].herd.rabbit, 1);
    const old = copy(committed); delete old.lastRolls;
    const legacy = browser(saved(old), { calm: true }); legacy.ui.onResume();
    assert.deepEqual(copy(legacy.state.lastRolls), [null, null]);
    assert.equal(legacy.last('setDock').args[0], 'await-next');
    legacy.ui.onContinue(); assert.equal(legacy.state.cur, 1);
    const normal = browser(saved(committed)); normal.ui.onResume();
    assert.equal(normal.state.cur, 1); assert.equal(normal.state.phase, 'preroll');
  });

  await test('calm preference changes, menu and restart cannot leave a stale Continue action', async () => {
    const b = browser(); b.ui.onModeStart('duo', ['Ada', 'Ola'], [0, 0]);
    b.ui.onRollClick(); b.scene.settle(['rabbit', 'rabbit']);
    b.setReadability({ calm: true }); await b.advance(2000);
    assert.equal(b.last('setDock').args[0], 'await-next');
    b.setReadability({ readable: true, scale: 200 });
    assert.equal(b.state.phase, 'resolving'); assert.equal(b.state.cur, 0);
    b.setReadability({ calm: false }); b.setReadability({ calm: false });
    assert.equal(b.state.cur, 1); assert.equal(b.state.phase, 'preroll');
    b.ui.onContinue(); assert.equal(b.state.cur, 1);
    b.setReadability({ calm: true });
    b.ui.onRollClick(); b.scene.settle(['rabbit', 'rabbit']); await b.advance(2000);
    assert.equal(b.last('setDock').args[0], 'await-next');
    b.ui.onBackToMenu(); b.ui.onContinue(); await b.advance(6000);
    assert.equal(b.state, null);
    b.ui.onResume(); assert.equal(b.state.cur, 1); assert.equal(b.state.phase, 'resolving');
    b.ui.onRestart(); b.ui.onContinue(); await b.advance(6000);
    assert.equal(b.state.cur, 0); assert.equal(b.state.turnCount, 1); assert.equal(b.state.phase, 'preroll');
    assert.deepEqual(copy(b.state.lastRolls), [null, null]);
    assert.deepEqual(copy(b.state.stats.rolls), [0, 0]);
  });

  await test('a winning roll ends the game even when calm play is enabled', async () => {
    const b = browser(saved(position('duo', {}, [h({ sheep: 1, pig: 1, cow: 1, horse: 1 }), h({})])), { calm: true });
    b.ui.onResume(); b.ui.onRollClick(); b.scene.settle(['rabbit', 'rabbit']);
    const stored = new Map(b.storage);
    await b.advance(6000); b.ui.onContinue();
    assert.equal(b.state.phase, 'gameover'); assert.equal(b.state.cur, 0);
    assert.equal(b.state.stats.rolls[0], 1); assert.equal(b.storage.has(LOCAL), false);
    assert.equal(b.calls.some(c => c.name === 'setDock' && c.args[0] === 'await-next'), false);
    const resumed = browser(stored, { calm: true }); resumed.ui.onResume();
    assert.equal(resumed.state.phase, 'gameover'); assert.equal(resumed.scene.throws, 0);
    assert.ok(resumed.last('showWin'));
  });

  await test('returning to the menu invalidates late dice and animation callbacks', async () => {
    for (const settled of [false, true]) {
      const b = browser(); b.ui.onModeStart('duo', ['Ada', 'Ola'], [0, 0]); b.ui.onRollClick();
      if (settled) { b.scene.settle(['rabbit', 'rabbit']); await b.microtasks(); }
      b.ui.onBackToMenu();
      const stored = b.storage.get(LOCAL), callCount = b.calls.length;
      assert.equal(b.state, null);
      b.scene.settle(['rabbit', 'rabbit']); await b.advance(6000);
      assert.equal(b.state, null); assert.equal(b.storage.get(LOCAL), stored); assert.equal(b.calls.length, callCount);
      b.ui.onResume();
      assert.equal(b.state.cur, settled ? 1 : 0); assert.equal(b.state.phase, 'preroll');
      assert.equal(b.state.stats.rolls[0], settled ? 1 : 0);
    }
  });

  await test('malformed local saves are rejected instead of entering the game', () => {
    const corruptions = [
      s => { s.cur = -1; }, s => { s.turnCount = 0; }, s => { s.mode = 'invalid'; },
      s => { s.players[0].name = '<x>'.repeat(20); }, s => { s.players[1].isBot = true; },
      s => { s.players[0].herd.rabbit = 1.5; }, s => { s.stock.rabbit = -1; },
      s => { s.stock.rabbit = 59; }, s => { s.stats.rolls = [0]; },
      s => { s.exchangeUsed = 'false'; }, s => { s.bias.v = [0, 3]; },
      s => { s.phase = 'resolving'; }, s => { s.phase = 'gameover'; }, s => { s.v = 999; }
    ];
    for (const corrupt of corruptions) {
      const s = position(); corrupt(s);
      const b = browser(saved(s)); assert.equal(b.last('showStart').args[0].canResume, false);
    }
    const legacy = position(); delete legacy.v;
    const b = browser(saved(legacy)); b.ui.onResume(); assert.equal(b.state.v, 2);
  });

  await test('network handshake validates names, tuning, version and host/guest role', () => {
    const b = browser(); b.ui.onNetJoin('Ola'); b.connection.onOpen();
    assert.equal(b.sent[0].v, 2);
    for (const m of [null, [], { t: 'go' }, { t: 'go', v: 2, names: ['Ada'], bias: [0, 0] },
      { t: 'go', v: 2, names: ['Ada', 'Ola'], bias: ['0', 0] },
      { t: 'go', v: 2, names: ['Ada', '\u0000Ola'], bias: [0, 0] },
      { t: 'go', v: 2, resume: { hostIdx: 2, state: position('net') } },
      { t: 'go', v: 2, resume: { hostIdx: 0, state: position('solo') } }]) {
      assert.doesNotThrow(() => b.peer(m)); assert.equal(b.state, null);
    }
    b.peer({ t: 'go', v: 2, names: ['Ada', 'Ola'], bias: [0, 0] });
    assert.equal(b.last('setViewPlayer').args[0], 1);
    const same = b.state;
    b.peer({ t: 'go', v: 2, names: ['Changed', 'Names'], bias: [0, 0] });
    assert.equal(b.state, same);
    const host = browser(); host.ui.onNetHost('Ada', [0, 0]); host.connection.onOpen();
    host.peer({ t: 'go', v: 2, names: ['Ada', 'Ola'], bias: [0, 0] }); assert.equal(host.state, null);
    host.peer({ t: 'hi', v: 2, name: 'Ola' }); const hostState = host.state;
    assert.equal(host.last('setViewPlayer').args[0], 0);
    host.peer({ t: 'hi', v: 2, name: 'Again' }); assert.equal(host.state, hostState);
    assert.equal(host.sent.filter(m => m.t === 'go').length, 1);
  });

  await test('network exchange, frame and settle payloads enforce valid data and turn order', async () => {
    const s = position('net', {}, [h({ rabbit: 12 }), h({})]);
    const b = browser(); b.startNet({ hostIdx: 0, state: s });
    const before = JSON.stringify(b.state);
    const ex = { t: 'ex', turn: 1, player: 0, id: 'r-s', dir: 1, times: 1 };
    for (const m of [null, { ...ex, times: 1.5 }, { ...ex, times: 0 }, { ...ex, dir: 0 }, { ...ex, id: 'free' },
      { ...ex, turn: 2 }, { ...ex, player: 1 }, { ...ex, times: '1' },
      { t: 'set', turn: 1, player: 0, faces: ['rabbit', 'rabbit'] }]) {
      b.peer(m); assert.equal(JSON.stringify(b.state), before);
    }
    b.peer(ex);
    assert.equal(b.state.players[0].herd.rabbit, 6); assert.equal(b.state.exchangeUsed, true);
    assert.equal(JSON.parse(b.storage.get(NETWORK)).state.exchangeUsed, true);
    b.peer(ex); assert.equal(b.state.players[0].herd.rabbit, 6);
    b.peer({ t: 'roll', player: 0, turn: 1 }); assert.equal(b.state.phase, 'rolling');
    const frame = { t: 'f', player: 0, turn: 1, d: b.scene.getNetFrame() };
    b.peer(frame); assert.equal(b.scene.frames, 1);
    for (const d of [[], [[0, 1]], [[0, 0, 0, 0, 0, 0, 0], [0, 1, 0, 0, 0, 0, 1]],
      [[NaN, 0, 0, 0, 0, 0, 1], [0, 1, 0, 0, 0, 0, 1]],
      [[1e9, 0, 0, 0, 0, 0, 1], [0, 1, 0, 0, 0, 0, 1]]]) b.peer({ ...frame, d });
    assert.equal(b.scene.frames, 1);
    for (const faces of [null, ['horse', 'rabbit'], ['rabbit', 'cow'], ['rabbit', 'rabbit', 'fox']]) {
      b.peer({ t: 'set', player: 0, turn: 1, faces }); assert.equal(b.state.phase, 'rolling');
    }
    b.peer({ t: 'set', player: 0, turn: 2, faces: ['rabbit', 'rabbit'] }); assert.equal(b.state.phase, 'rolling');
    const result = { t: 'set', player: 0, turn: 1, faces: ['rabbit', 'rabbit'] };
    b.peer(result); b.peer(result); await b.advance(1800);
    assert.equal(b.state.cur, 1); assert.equal(b.state.players[0].herd.rabbit, 10);
    assert.deepEqual(copy(b.state.stats.rolls), [1, 0]);
  });

  await test('next-turn messages can wait for animation, but duplicate results cannot replay', async () => {
    const b = browser(); b.startNet({ hostIdx: 0, state: position('net', { cur: 1 }, [h({ rabbit: 12 }), h({})]) });
    b.ui.onRollClick(); b.scene.settle(['rabbit', 'sheep']);
    assert.equal(b.state.phase, 'resolving');
    const ex = { t: 'ex', turn: 2, player: 0, id: 'r-s', dir: 1, times: 1 };
    const roll = { t: 'roll', turn: 2, player: 0 };
    for (let i = 0; i < 20; i++) { b.peer(ex); b.peer(roll); }
    b.peer({ t: 'set', turn: 2, player: 0, faces: ['rabbit', 'rabbit'] });
    await b.advance(1000);
    assert.equal(b.state.cur, 0); assert.equal(b.state.turnCount, 2);
    assert.equal(b.state.players[0].herd.sheep, 1); assert.equal(b.state.players[0].herd.rabbit, 10);
    assert.deepEqual(copy(b.state.stats.rolls), [1, 1]);
  });

  await test('network resume preserves an exchange and recovers a committed outcome', () => {
    const state = position('net', { cur: 1, turnCount: 3, exchangeUsed: true }, [h({}), h({ rabbit: 3 })]);
    const b = browser(new Map(), { calm: true }); b.startNet({ hostIdx: 0, state });
    assert.equal(b.state.exchangeUsed, true); assert.equal(b.last('setDock').args[1].exchangeUsed, true);
    b.ui.onRollClick(); b.scene.settle(['rabbit', 'rabbit']);
    const savedNetwork = JSON.parse(b.storage.get(NETWORK));
    const resumed = browser(new Map(), { calm: true }); resumed.startNet({ hostIdx: 1, state: savedNetwork.state });
    assert.equal(resumed.state.cur, 0); assert.equal(resumed.state.turnCount, 4);
    assert.equal(resumed.state.players[1].herd.rabbit, 5);
    assert.equal(resumed.state.stats.rolls[1], 1);
    assert.deepEqual(copy(resumed.state.lastRolls), savedNetwork.state.lastRolls);
    assert.equal(resumed.last('setViewPlayer').args[0], 0);
    assert.equal(resumed.calls.some(c => c.name === 'setDock' && c.args[0] === 'await-next'), false);
  });

  await test('P2P never waits for a local calm preference and reconstructs both players’ persisted results', async () => {
    const b = browser(new Map(), { calm: true });
    b.startNet({ hostIdx: 0, state: position('net', { cur: 1 }) });
    b.ui.onRollClick(); b.scene.settle(['rabbit', 'rabbit']); await b.advance(2000);
    assert.equal(b.state.cur, 0); assert.equal(b.state.turnCount, 2);
    assert.equal(b.state.phase, 'preroll');
    b.ui.onContinue(); assert.equal(b.state.cur, 0);
    const secondPlayer = copy(b.state.lastRolls[1]);
    b.peer({ t: 'roll', turn: 2, player: 0 });
    const settled = { t: 'set', turn: 2, player: 0, faces: ['wolf', 'fox'] };
    b.peer(settled); b.peer(settled); await b.advance(2000);
    assert.equal(b.state.cur, 1); assert.equal(b.state.turnCount, 2);
    assert.deepEqual(copy(b.state.stats.rolls), [1, 1]);
    assert.deepEqual(copy(b.state.lastRolls[1]), secondPlayer);
    assert.equal(b.state.lastRolls[0].turn, 2);
    assert.equal(b.calls.some(c => c.name === 'setDock' && c.args[0] === 'await-next'), false);
    assert.equal(b.calls.filter(c => c.name === 'showLastRolls').length, 2);
    const stored = JSON.parse(b.storage.get(NETWORK)).state;
    const canonical = copy(stored.lastRolls);
    stored.lastRolls[0].events = [{ t: '<script>bad()</script>', total: 1e100 }];
    stored.lastRolls[0].changes = { rabbit: 999999 };
    const resumed = browser(new Map(), { calm: true });
    resumed.startNet({ hostIdx: 1, state: stored });
    assert.deepEqual(copy(resumed.state.lastRolls), canonical);
    assert.equal(resumed.state.cur, 1); assert.equal(resumed.state.turnCount, 2);
    assert.equal(resumed.last('setViewPlayer').args[0], 0);
    stored.lastRolls[0].before.rabbit = -1;
    const damaged = browser(); damaged.startNet({ hostIdx: 1, state: stored });
    assert.equal(damaged.state.lastRolls[0], null);
    assert.deepEqual(copy(damaged.state.lastRolls[1]), canonical[1]);
    assert.deepEqual(copy(damaged.state.players), stored.players);
  });

  await test('disconnect keeps the latest exchange and stale connection callbacks are ignored', () => {
    const b = browser(); b.startNet({ hostIdx: 0, state: position('net', {}, [h({ rabbit: 12 }), h({})]) });
    b.peer({ t: 'ex', turn: 1, player: 0, id: 'r-s', dir: 1, times: 1 });
    const old = b.connection; old.onClose();
    assert.equal(b.state, null);
    const savedNetwork = b.storage.get(NETWORK);
    assert.equal(JSON.parse(savedNetwork).state.players[0].herd.sheep, 1);
    old.onMsg({ t: 'again' }); old.onClose();
    assert.equal(b.state, null); assert.equal(b.storage.get(NETWORK), savedNetwork);
  });

  await test('network gameover leaves the independent local save intact', () => {
    const local = JSON.stringify(position()); const storage = new Map([[LOCAL, local]]);
    const state = position('net', {}, [h({ sheep: 2, pig: 1, cow: 1, horse: 1 }), h({})]);
    const b = browser(storage); b.startNet({ hostIdx: 0, state });
    b.peer({ t: 'ex', player: 0, turn: 1, id: 'r-s', dir: -1, times: 1 });
    assert.equal(b.state.phase, 'gameover'); assert.equal(storage.get(LOCAL), local);
    assert.equal(storage.has(NETWORK), false);
  });

  await test('an aborted physics roll preserves the exchange and never increments statistics', async () => {
    const b = browser(saved(position('duo', { exchangeUsed: true }, [h({ rabbit: 3 }), h({})])));
    b.ui.onResume(); b.ui.onRollClick(); b.scene.config.onRollError('Ponów rzut.');
    assert.equal(b.state.phase, 'preroll'); assert.equal(b.state.exchangeUsed, true);
    assert.equal(b.state.stats.rolls[0], 0); assert.equal(b.scene.interactive, true);
    assert.equal(JSON.parse(b.storage.get(LOCAL)).exchangeUsed, true);
    b.ui.onRollClick(); b.scene.settle(['rabbit', 'rabbit']);
    assert.equal(b.state.stats.rolls[0], 1);
    const bot = browser(saved(position('solo', { cur: 1, exchangeUsed: true }, [h({}), h({ rabbit: 13 })])));
    bot.ui.onResume(); await bot.advance(1800);
    bot.scene.config.onRollError('Ponów rzut.'); await bot.advance(1800);
    assert.equal(bot.scene.throws, 2); assert.equal(bot.state.stats.rolls[1], 0);
    assert.equal(bot.state.players[1].herd.rabbit, 13); assert.equal(bot.state.exchangeUsed, true);
  });

  await test('an aborted network roll recovers on both peers and a retry still settles', () => {
    const s = position('net', { cur: 1, exchangeUsed: true }, [h({}), h({ rabbit: 3 })]);
    const local = browser(); local.startNet({ hostIdx: 0, state: s });
    local.ui.onRollClick(); local.scene.config.onRollError('Ponów rzut.');
    const aborted = local.sent.find(m => m.t === 'abort');
    assert.deepEqual(aborted, { t: 'abort', turn: 1, player: 1 });
    const remote = browser(); remote.startNet({ hostIdx: 1, state: s });
    remote.peer({ t: 'roll', turn: 1, player: 1 }); remote.peer(aborted);
    assert.equal(remote.state.phase, 'preroll'); assert.equal(remote.state.exchangeUsed, true);
    assert.equal(remote.scene.interactive, false); assert.equal(remote.state.stats.rolls[1], 0);
    remote.peer({ t: 'roll', turn: 1, player: 1 });
    remote.peer({ t: 'set', turn: 1, player: 1, faces: ['rabbit', 'rabbit'] });
    assert.equal(remote.state.phase, 'resolving'); assert.equal(remote.state.stats.rolls[1], 1);
  });

  await test('compatibility renderer is announced through the real boot path', () => {
    const b = browser(new Map(), { compatibilityMode: true });
    assert.equal(b.document.documentElement.dataset.renderer, '2d');
    assert.equal(b.last('compatibilityMode').args[0], true);
  });

  console.log(`\nGame-state integration OK: ${passed} scenarios.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
