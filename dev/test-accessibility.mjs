// Exercise the production HUD with a small browser shell. This is not a layout
// engine: CSS reflow, visual clipping, real keyboard traversal and WebGL need browser QA.
// Static IDs come from the actual markup. Generated menu buttons are modeled
// to detect focus loss when their container is replaced; other HTML is captured.
// RULES and Polish animal names/plurals are real; only sprite drawing is stubbed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const PREFS = 'sf3d.readability.v1';
const read = file => fs.readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');
const markup = read('markup.html');
const sources = ['rules.js', 'symbols.js', 'hud.js'].map(file => [file, read(file)]);
const copy = value => JSON.parse(JSON.stringify(value));
const defaults = { readable: false, scale: 100, calm: false };

function platform({ stored, blockedRead = false, blockedWrite = false, width = 1024, height = 900 } = {}) {
  const storage = new Map(stored === undefined ? [] : [[PREFS, stored]]);
  const elements = new Map(), frames = new Map(), timers = new Map();
  let document;
  let soundEnabled = true;
  let nextId = 1;
  class Target {
    listeners = new Map();
    addEventListener(type, callback) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(callback);
    }
    dispatchEvent(event) {
      for (const callback of this.listeners.get(event.type) || []) callback(event);
      return true;
    }
    emit(type) { this.dispatchEvent({ type, target: this, preventDefault() {} }); }
  }
  class Element extends Target {
    constructor(id) {
      super();
      this.id = id; this.dataset = {}; this.attributes = new Map();
      this.value = ''; this.checked = false; this.hidden = false; this.isConnected = true;
      this.clientWidth = width; this.clientHeight = height;
      this.rect = { left: 0, top: 0, right: width, bottom: height, width, height };
      this.textWrites = 0; this.htmlWrites = 0; this._text = ''; this._html = '';
      this.menuButtons = []; this.parts = new Map();
      const classes = new Set();
      this.classList = {
        add: (...names) => names.forEach(name => classes.add(name)),
        remove: (...names) => names.forEach(name => classes.delete(name)),
        contains: name => classes.has(name),
        toggle(name, force) {
          const on = force === undefined ? !classes.has(name) : !!force;
          if (on) classes.add(name); else classes.delete(name);
          return on;
        }
      };
      Object.defineProperty(this, 'className', {
        get: () => [...classes].join(' '),
        set: value => { classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach(name => classes.add(name)); }
      });
      const properties = new Map();
      this.style = {
        setProperty: (name, value) => properties.set(name, String(value)),
        getPropertyValue: name => properties.get(name) || ''
      };
      Object.defineProperty(this.style, 'display', {
        get: () => properties.get('display') || '',
        set: value => { properties.set('display', value); if (value === 'none') this.blur(); }
      });
    }
    set hidden(value) { this._hidden = !!value; if (value) this.blur(); }
    get hidden() { return this._hidden; }
    set disabled(value) { this._disabled = !!value; if (value) this.blur(); }
    get disabled() { return this._disabled; }
    focus(options) {
      if (!this.isConnected || this.hidden || this.style.display === 'none' || this.inert || this.disabled) return;
      if (document.activeElement === this) return;
      document.activeElement = this;
      this.focusOptions = options;
      document.dispatchEvent({ type: 'focusin', target: this });
    }
    blur() {
      if (document && document.activeElement === this) document.activeElement = document.body;
    }
    set textContent(value) { this._text = String(value); this.textWrites++; }
    get textContent() { return this._text; }
    set innerHTML(value) {
      this._html = String(value); this.htmlWrites++;
      if (this.id !== 'menuContent') return;
      for (const button of this.menuButtons) {
        button.isConnected = false;
        button.blur();
        elements.delete(button.id);
      }
      this.menuButtons = [];
      for (const match of this._html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
        const id = /\bid="([^"]+)"/.exec(match[1])?.[1];
        if (!id) continue;
        const button = new Element(id);
        button.hidden = /\bhidden\b/.test(match[1]);
        for (const span of match[2].matchAll(/<span(?: class="([^"]+)")?>([^<]*)<\/span>/g)) {
          const child = new Element('');
          child.textContent = span[2];
          if (!button.parts.has('span')) button.parts.set('span', child);
          for (const name of (span[1] || '').split(/\s+/).filter(Boolean)) button.parts.set('.' + name, child);
        }
        this.menuButtons.push(button);
        elements.set(id, button);
      }
    }
    get innerHTML() { return this._html; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    getBoundingClientRect() { return this.rect; }
    getClientRects() { return this.hidden || this.style.display === 'none' ? [] : [this.rect]; }
    querySelector(selector) { return this.parts.get(selector) || null; }
    querySelectorAll() { return []; }
  }
  for (const match of markup.matchAll(/\bid="([^"]+)"/g)) elements.set(match[1], new Element(match[1]));
  document = Object.assign(new Target(), {
    documentElement: new Element('html'),
    body: new Element('body'),
    baseURI: 'https://game.test/index.html',
    currentScript: null,
    getElementById: id => elements.get(id) || null,
    querySelectorAll: () => []
  });
  document.activeElement = document.body;
  elements.get('topbar').rect.bottom = 160;
  elements.get('dock').rect.top = height - 200;
  const window = Object.assign(new Target(), {
    innerWidth: width, innerHeight: height,
    matchMedia: () => ({ matches: false })
  });
  const context = vm.createContext({
    console, document, window, navigator: {}, URL,
    localStorage: {
      getItem(key) { if (blockedRead) throw new Error('Storage disabled'); return storage.get(key) ?? null; },
      setItem(key, value) { if (blockedWrite) throw new Error('Storage disabled'); storage.set(key, String(value)); }
    },
    requestAnimationFrame(callback) { const id = nextId++; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout(callback) { const id = nextId++; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    AUDIO: { ui() {}, isEnabled: () => soundEnabled, setEnabled: value => { soundEnabled = !!value; } }
  });
  for (const [file, source] of sources) {
    vm.runInContext(source, context, { filename: file });
    if (file === 'symbols.js') context.SYMBOLS.sprite = symbol => 'data:image/png;stub,' + symbol;
  }
  return {
    HUD: context.HUD, RULES: context.RULES, AUDIO: context.AUDIO, document, window, storage,
    el: id => elements.get(id),
    frame() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); },
    finishTimers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); }
  };
}

function state(b, names = ['Ada', 'Ola']) {
  return {
    mode: 'duo', phase: 'preroll', cur: 0, turnCount: 1,
    players: names.map(name => ({ name, herd: b.RULES.emptyHerd() })),
    lastRolls: [null, null]
  };
}
function record(b, faces, herd = {}, stock = {}, turn = 1) {
  const before = { ...b.RULES.emptyHerd(), ...herd };
  const stockBefore = Object.fromEntries(b.RULES.ANIMALS.map(animal => [animal, b.RULES.STOCK_INIT[animal] - before[animal]]));
  Object.assign(stockBefore, stock);
  const result = b.RULES.resolveRoll(before, stockBefore, ...faces);
  assert.ok(result, 'fixture roll must be accepted by the real rules');
  return { turn, faces, before, stockBefore, events: result.events };
}
function sections(b) {
  return b.el('lastRollList').innerHTML.split('<section class="last-roll"').slice(1);
}
let passed = 0;
function test(name, run) { run(); passed++; console.log('ok  ', name); }

test('default preferences are applied before HUD.init and returned as a copy', () => {
  const b = platform(), root = b.document.documentElement;
  assert.deepEqual(copy(b.HUD.getReadability()), defaults);
  assert.equal(root.dataset.readable, 'false');
  assert.equal(root.dataset.uiScale, '100');
  assert.equal(root.style.getPropertyValue('--ui-scale'), '1');
  const outside = b.HUD.getReadability(); outside.scale = 200; outside.calm = true;
  assert.deepEqual(copy(b.HUD.getReadability()), defaults);
});

test('saved preferences initialize controls and enable the readable layout at every larger scale', () => {
  for (const scale of [125, 150, 200]) {
    const b = platform({ stored: JSON.stringify({ readable: false, scale, calm: true }) });
    assert.equal(b.document.documentElement.dataset.readable, 'true');
    assert.equal(b.document.documentElement.style.getPropertyValue('--ui-scale'), String(scale / 100));
    b.HUD.init({});
    assert.equal(b.el('readabilityScale').value, String(scale));
    assert.equal(b.el('readabilityCalm').checked, true);
    assert.equal(b.el('readableLayout').checked, false);
  }
  const b = platform({ stored: JSON.stringify({ readable: true, scale: 100, calm: false }) });
  assert.equal(b.document.documentElement.dataset.readable, 'true');
});

test('malformed, primitive and wrong-type preference records safely use defaults', () => {
  for (const stored of ['{broken', 'null', 'false', '42', '"text"', '[]', '{"readable":"true","scale":"200","calm":1}', '{"scale":999}']) {
    const b = platform({ stored });
    assert.deepEqual(copy(b.HUD.getReadability()), defaults, stored);
    b.HUD.init({});
    assert.equal(b.el('readabilityScale').value, '100');
  }
});

test('registered change handlers persist preferences and update root and callbacks', () => {
  const b = platform(), changes = [], layouts = [];
  b.HUD.init({ onReadabilityChange: value => changes.push(copy(value)), onLayoutChange: value => layouts.push(copy(value)) });
  b.el('readableLayout').checked = true;
  b.el('readableLayout').emit('change');
  b.el('readabilityScale').value = '200';
  b.el('readabilityScale').emit('change');
  b.el('readabilityCalm').checked = true;
  b.el('readabilityCalm').emit('change');
  assert.deepEqual(changes, [
    { readable: true, scale: 100, calm: false },
    { readable: true, scale: 200, calm: false },
    { readable: true, scale: 200, calm: true }
  ]);
  assert.deepEqual(JSON.parse(b.storage.get(PREFS)), changes.at(-1));
  assert.equal(b.document.documentElement.dataset.uiScale, '200');
  assert.equal(b.document.documentElement.style.getPropertyValue('--ui-scale'), '2');
  b.frame();
  assert.deepEqual(layouts, [{ top: 8, right: 8, bottom: 8, left: 8 }]);
  b.el('readabilityScale').value = 'invalid';
  b.el('readabilityScale').emit('change');
  assert.equal(b.HUD.getReadability().scale, 100);
});

test('blocked localStorage does not prevent changing or using readability settings', () => {
  const b = platform({ blockedRead: true, blockedWrite: true });
  assert.deepEqual(copy(b.HUD.getReadability()), defaults);
  const changes = [];
  b.HUD.init({ onReadabilityChange: value => changes.push(copy(value)) });
  b.el('readabilityScale').value = '150';
  b.el('readabilityScale').emit('change');
  assert.equal(b.HUD.getReadability().scale, 150);
  assert.equal(b.document.documentElement.style.getPropertyValue('--ui-scale'), '1.5');
  assert.equal(changes.length, 1);
  assert.equal(b.storage.has(PREFS), false);
});

test('narrow or short viewports get readable insets without changing saved preferences', () => {
  for (const dimensions of [{ width: 320, height: 640 }, { width: 768, height: 500 }]) {
    const b = platform(dimensions);
    assert.deepEqual(copy(b.HUD.getReadability()), defaults);
    assert.equal(b.document.documentElement.dataset.readable, 'true');
    b.el('topbar').rect.bottom = 1500;
    b.el('dock').rect.top = 1800;
    assert.deepEqual(copy(b.HUD.measureInsets()), { top: 8, right: 8, bottom: 8, left: 8 });
  }
  const b = platform();
  assert.deepEqual(copy(b.HUD.measureInsets()), { top: 170, right: 0, bottom: 208, left: 0 });
});

test('both players have independent persistent roll summaries across turns and transient messages', () => {
  const b = platform(), s = state(b);
  b.HUD.init({});
  b.HUD.showLastRolls(s);
  assert.equal(sections(b).length, 2);
  assert.equal((b.el('lastRollList').innerHTML.match(/Brak zapisanego rzutu\./g) || []).length, 2);
  s.lastRolls[0] = record(b, ['rabbit', 'rabbit']);
  b.HUD.showLastRolls(s);
  const first = sections(b)[0];
  assert.match(first, /Ada · runda 1/);
  assert.match(first, /Przychówek: \+1 królik\./);
  assert.match(sections(b)[1], /Brak zapisanego rzutu\./);
  s.lastRolls[1] = record(b, ['sheep', 'sheep']);
  s.cur = 1;
  b.HUD.refresh(s);
  assert.equal(sections(b)[0], first);
  assert.match(sections(b)[1], /Ola · runda 1/);
  assert.match(sections(b)[1], /Przychówek: \+1 owca\./);
  const html = b.el('lastRollList').innerHTML, writes = b.el('lastRollList').htmlWrites;
  b.HUD.banner('Następna tura', 'green', 1);
  b.HUD.setDock('rolling');
  b.finishTimers();
  s.cur = 0; s.turnCount = 2;
  b.HUD.refresh(s);
  assert.equal(b.el('lastRollList').innerHTML, html);
  assert.equal(b.el('lastRollList').htmlWrites, writes, 'unchanged results are not replaced during refresh');
});

test('effect text describes predators, dog protection and limited stock using actual rule events', () => {
  const b = platform(), s = state(b);
  const examples = [
    [record(b, ['rabbit', 'fox'], { rabbit: 3 }), /Lis zabrał 3 króliki\./],
    [record(b, ['wolf', 'horse'], { rabbit: 2, sheep: 1 }), /Wilk zabrał zwierzęta: 2 króliki, 1 owca\./],
    [record(b, ['rabbit', 'fox'], { rabbit: 3, smallDog: 1 }), /Mały pies przegonił lisa i wrócił do Stada Głównego\./],
    [record(b, ['wolf', 'horse'], { bigDog: 1 }), /Duży pies przegonił wilka i wrócił do Stada Głównego\./],
    [record(b, ['rabbit', 'rabbit'], {}, { rabbit: 0 }), /Bez przychówku\. Przychówek ograniczył zapas Stada Głównego\./]
  ];
  for (const [roll, expected] of examples) {
    s.lastRolls[0] = roll;
    const before = JSON.stringify(s);
    b.HUD.showLastRolls(s);
    assert.match(sections(b)[0], expected);
    assert.equal(JSON.stringify(s), before, 'presenting a result must not mutate game state');
  }
});

test('player names are escaped in result HTML and only plain text is used for announcements', () => {
  const name = 'Ada"><img src=x onerror="bad()"> & \'rolnik\'';
  const b = platform(), s = state(b, [name, 'Ola']);
  s.lastRolls[0] = record(b, ['rabbit', 'rabbit']);
  b.HUD.showLastRolls(s, 0);
  const html = b.el('lastRollList').innerHTML;
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&quot;&gt;&lt;img src=x onerror=&quot;bad()&quot;&gt; &amp; &#39;rolnik&#39;'));
  assert.ok(b.el('rollAnnouncement').textContent.startsWith(name + ', runda 1:'));
  assert.equal(b.el('rollAnnouncement').htmlWrites, 0);
});

test('live result announcements require an explicit player and refresh does not repeat them', () => {
  const b = platform(), s = state(b), announcement = b.el('rollAnnouncement');
  s.lastRolls = [record(b, ['rabbit', 'rabbit']), record(b, ['sheep', 'sheep'])];
  b.HUD.showLastRolls(s);
  b.HUD.refresh(s);
  assert.equal(announcement.textWrites, 0);
  b.HUD.showLastRolls(s, 1);
  assert.equal(announcement.textWrites, 1);
  assert.match(announcement.textContent, /^Ola, runda 1: owca i owca\. Przychówek: \+1 owca\.$/);
  b.HUD.refresh(s);
  b.HUD.showLastRolls(s);
  b.HUD.showLastRolls(s, '1');
  b.HUD.showLastRolls(s, -1);
  assert.equal(announcement.textWrites, 1);
  s.lastRolls[0] = null;
  b.HUD.showLastRolls(s, 0);
  assert.equal(announcement.textWrites, 1, 'a player without a result has nothing to announce');
});

test('keyboard-started turns keep focus on results until the next available action', () => {
  const b = platform();
  b.HUD.init({});
  b.HUD.setDock('preroll-human');
  b.el('btnRoll').focus();
  b.HUD.setDock('rolling');
  assert.equal(b.document.activeElement, b.el('lastRollList'));
  b.HUD.setDock('resolving');
  assert.equal(b.document.activeElement, b.el('lastRollList'));
  b.HUD.setDock('await-next');
  assert.equal(b.document.activeElement, b.el('btnContinue'));
  b.HUD.setDock('bot');
  assert.equal(b.document.activeElement, b.el('lastRollList'));
  b.HUD.setDock('rolling');
  b.HUD.setDock('resolving');
  b.HUD.setDock('await-next');
  assert.equal(b.document.activeElement, b.el('btnContinue'));
  b.HUD.setDock('preroll-human');
  assert.equal(b.document.activeElement, b.el('btnRoll'));
  b.HUD.setDock('rolling');
  b.HUD.setDock('bot');
  b.HUD.setDock('preroll-human');
  assert.equal(b.document.activeElement, b.el('btnRoll'), 'automatic turns also return to the human action');
  assert.equal(b.el('lastRollList').focusOptions.preventScroll, true);
  assert.equal(b.el('btnContinue').focusOptions.preventScroll, true);
});

test('refreshing an available dock action preserves focus without temporarily hiding it', () => {
  const b = platform();
  b.HUD.init({});
  for (const [mode, id] of [['preroll-human', 'btnRoll'], ['await-next', 'btnContinue']]) {
    b.HUD.setDock(mode);
    b.el(id).focus();
    const focuses = [];
    b.document.addEventListener('focusin', event => focuses.push(event.target));
    b.HUD.setDock(mode);
    assert.equal(b.document.activeElement, b.el(id));
    assert.equal(focuses.length, 0, 'the visible action never loses and regains focus');
  }
});

test('a completed exchange moves focus to Roll while an available exchange keeps focus', () => {
  const b = platform();
  b.HUD.init({});
  b.HUD.setDock('preroll-human');
  b.el('btnExchange').focus();
  b.HUD.setDock('preroll-human');
  assert.equal(b.document.activeElement, b.el('btnExchange'), 'refreshing does not skip an available exchange');
  b.HUD.openSheet('sheetEx');
  b.HUD.closeSheets();
  assert.equal(b.document.activeElement, b.el('btnExchange'), 'the dialog restores its trigger before consuming the exchange');
  b.HUD.setDock('preroll-human', { exchangeUsed: true });
  assert.equal(b.el('btnExchange').disabled, true);
  assert.equal(b.document.activeElement, b.el('btnRoll'), 'the disabled exchange cannot leave focus on the body');
  b.el('btnMenu').focus();
  b.HUD.setDock('preroll-human', { exchangeUsed: true });
  assert.equal(b.document.activeElement, b.el('btnMenu'), 'an unrelated focused control is left alone');
});

test('an exchange hidden during a throw uses the result focus without interrupting a dialog', () => {
  const b = platform();
  b.HUD.init({});
  b.HUD.setDock('preroll-human');
  b.el('btnExchange').focus();
  b.HUD.setDock('rolling');
  assert.equal(b.document.activeElement, b.el('lastRollList'));
  b.HUD.setDock('preroll-human');
  assert.equal(b.document.activeElement, b.el('btnRoll'));
  b.el('btnExchange').focus();
  b.HUD.openSheet('sheetReadability');
  const dialogFocus = b.document.activeElement;
  b.HUD.setDock('rolling');
  assert.equal(b.document.activeElement, dialogFocus);
});

test('the sound toggle updates its accessible state without replacing the focused menu button', () => {
  const b = platform();
  b.HUD.init({ onSoundToggle: () => b.AUDIO.setEnabled(!b.AUDIO.isEnabled()) });
  b.HUD.buildMenu(state(b));
  b.el('btnMenu').focus();
  b.HUD.openSheet('sheetMenu');
  const button = b.el('mSound');
  button.focus();
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.equal(button.querySelector('.state').textContent, 'włączony');
  for (const enabled of [false, true]) {
    button.emit('click');
    assert.equal(b.AUDIO.isEnabled(), enabled);
    assert.equal(b.el('mSound'), button, 'the existing menu control survives each toggle');
    assert.equal(b.document.activeElement, button);
    assert.equal(button.getAttribute('aria-pressed'), String(enabled));
    assert.equal(button.querySelector('.state').textContent, enabled ? 'włączony' : 'wyłączony');
  }
  b.HUD.closeSheets();
  assert.equal(b.document.activeElement, b.el('btnMenu'));
});

test('player setup forms focus their input and return to the selected mode on Back', () => {
  for (const [mode, form, input, back] of [
    ['btnDuo', 'nameform', 'inpName1', 'btnDuoBack'],
    ['btnNet', 'netform', 'inpNetName', 'btnNetBack']
  ]) {
    const b = platform();
    b.HUD.init({});
    b.el(mode).focus();
    b.el(mode).emit('click');
    assert.equal(b.el('modeButtons').hidden, true);
    assert.equal(b.el(form).hidden, false);
    assert.equal(b.document.activeElement, b.el(input), 'entry places focus in the revealed form');
    b.el(back).focus();
    b.el(back).emit('click');
    assert.equal(b.el(form).hidden, true);
    assert.equal(b.el('modeButtons').hidden, false);
    assert.equal(b.document.activeElement, b.el(mode), 'Back restores the mode button instead of a hidden form control');
    assert.equal(b.el('startov').classList.contains('compact'), false);
  }
});

test('leaving the result panel cancels automatic action focus, even after returning to read it', () => {
  for (const returnToResults of [false, true]) {
    const b = platform();
    b.HUD.init({});
    b.HUD.setDock('preroll-human');
    b.el('btnRoll').focus();
    b.HUD.setDock('rolling');
    b.el('btnMenu').focus();
    if (returnToResults) b.el('lastRollList').focus();
    const chosen = b.document.activeElement;
    b.HUD.setDock('resolving');
    b.HUD.setDock('await-next');
    assert.equal(b.document.activeElement, chosen);
  }
  const b = platform();
  b.HUD.init({});
  b.HUD.setDock('preroll-human');
  b.el('btnRoll').focus();
  b.HUD.setDock('rolling');
  b.window.emit('blur');
  b.HUD.setDock('await-next');
  assert.equal(b.document.activeElement, b.el('lastRollList'), 'leaving the browser also cancels pending focus');
});

test('a dialog keeps focus through a turn change and closing it does not resume automatic focus', () => {
  const b = platform();
  b.HUD.init({});
  b.HUD.setDock('preroll-human');
  b.el('btnRoll').focus();
  b.HUD.setDock('rolling');
  b.HUD.openSheet('sheetReadability');
  const dialogFocus = b.document.activeElement;
  b.HUD.setDock('await-next');
  assert.equal(b.document.activeElement, dialogFocus);
  assert.equal(b.el('hud').inert, true);
  b.HUD.closeSheets();
  assert.equal(b.document.activeElement, b.el('lastRollList'));
  b.HUD.setDock('await-next');
  assert.equal(b.document.activeElement, b.el('lastRollList'), 'the explicitly restored dialog trigger retains focus');
});

console.log('\n' + passed + ' accessibility HUD scenarios passed (browser rendering not simulated).');
