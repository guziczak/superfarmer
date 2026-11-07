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
  const timers = new Map(), elements = new Map(), calls = [], sent = [];
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
    measureInsets() { return { top: 0, bottom: 0 }; },
    eventBig(...args) { record('eventBig', args); return Promise.resolve(); }
  }, { get(target, key) { return key in target ? target[key] : (...args) => record(key, args); } });
  class DiceScene {
    constructor(config) {
      this.config = config; this.throws = 0; this.frames = 0; this.busy = false;
      this.compatibilityMode = !!options.compatibilityMode; scene = this;
    }
    setTuning() {}
    setInteractive(on) { this.interactive = on; }
    setRemoteDriven(on) { this.remote = on; }
    setInsets() {}
    resize() {}
    shake() {}
    endRemoteRoll() { this.remote = false; }
    applyNetFrame() { this.frames++; }
    getDieScreenPos() { return { x: 10, y: 20 }; }
    getNetFrame() { return [[0, 1, 0, 0, 0, 0, 1], [0, 1, 0, 0, 0, 0, 1]]; }
    isBusy() { return this.busy; }
    throwAuto() { this.throws++; this.busy = true; this.config.onThrow(); }
    settle(faces) { this.busy = false; this.config.onSettle(faces); }
  }
  const document = {
    readyState: 'complete', documentElement: { dataset: {} },
    getElementById: el, addEventListener() {}
  };
  const context = {
    console, document, location: { search: '' }, navigator: {},
    window: { addEventListener() {} },
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
    last(name) { return calls.filter(c => c.name === name).at(-1); },
    startNet(resume) {
      ui.onNetJoin('Ola'); callbacks.onOpen();
      callbacks.onMsg(resume
        ? { t: 'go', v: 2, resume }
        : { t: 'go', v: 2, names: ['Ada', 'Ola'], bias: { m: 'w', v: [0, 0] } });
    }
  };
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
    const resumed = browser(b.storage); resumed.ui.onResume();
    assert.equal(resumed.state.cur, 1); assert.equal(resumed.state.turnCount, 1);
    assert.equal(resumed.state.phase, 'preroll'); assert.equal(resumed.state.exchangeUsed, false);
    assert.equal(resumed.state.players[0].herd.rabbit, 5);
    const again = browser(b.storage); again.ui.onResume();
    assert.equal(again.state.cur, 1); assert.deepEqual(copy(again.state.stats.rolls), [1, 0]);
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
      await b.advance(4000);
      assert.equal(b.state.stats.dogSaves[0], protect ? 2 : 0);
      assert.equal(b.state.stats.wolfEaten[0], protect ? 0 : 10);
    }
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
    const same = b.state;
    b.peer({ t: 'go', v: 2, names: ['Changed', 'Names'], bias: [0, 0] });
    assert.equal(b.state, same);
    const host = browser(); host.ui.onNetHost('Ada', [0, 0]); host.connection.onOpen();
    host.peer({ t: 'go', v: 2, names: ['Ada', 'Ola'], bias: [0, 0] }); assert.equal(host.state, null);
    host.peer({ t: 'hi', v: 2, name: 'Ola' }); const hostState = host.state;
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
    const b = browser(); b.startNet({ hostIdx: 0, state });
    assert.equal(b.state.exchangeUsed, true); assert.equal(b.last('setDock').args[1].exchangeUsed, true);
    b.ui.onRollClick(); b.scene.settle(['rabbit', 'rabbit']);
    const savedNetwork = JSON.parse(b.storage.get(NETWORK));
    const resumed = browser(); resumed.startNet({ hostIdx: 1, state: savedNetwork.state });
    assert.equal(resumed.state.cur, 0); assert.equal(resumed.state.turnCount, 4);
    assert.equal(resumed.state.players[1].herd.rabbit, 5);
    assert.equal(resumed.state.stats.rolls[1], 1);
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
