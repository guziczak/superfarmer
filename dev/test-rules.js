const R = require('../src/rules.js');
let fails = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { console.log('FAIL', name, 'got', g, 'want', w); fails++; }
  else console.log('ok  ', name);
}

// RozkĹ‚ad kostek
const count = (arr) => arr.reduce((m, f) => (m[f] = (m[f] || 0) + 1, m), {});
eq('kostka A', count(R.DIE_A), { rabbit: 6, sheep: 3, pig: 1, cow: 1, wolf: 1 });
eq('kostka B', count(R.DIE_B), { rabbit: 6, sheep: 2, pig: 2, horse: 1, fox: 1 });

const S = () => ({ ...R.STOCK_INIT });

// Puste stado + para krĂłlikĂłw na kostkach => +1 krĂłlik
let r = R.resolveRoll(R.emptyHerd(), S(), 'rabbit', 'rabbit');
eq('para z kostek', r.herd.rabbit, 1);
eq('stado glowne ubylo', r.stock.rabbit, 59);

// 3 krĂłliki + 1 na kostce => floor(4/2)=2 pary => +2
let h = R.emptyHerd(); h.rabbit = 3;
r = R.resolveRoll(h, S(), 'rabbit', 'sheep');
eq('3+1 krolika => +2', r.herd.rabbit, 5);
eq('owca sama nie paruje', r.herd.sheep, 0);

// Krowa na kostce bez krowy w stadzie => nic
r = R.resolveRoll(R.emptyHerd(), S(), 'cow', 'sheep');
eq('krowa bez pary', r.herd.cow, 0);
eq('event nothing', r.events.some(e => e.t === 'nothing'), true);

// Lis bez psa: tracisz wszystkie krĂłliki, ale owce z kostki A dalej siÄ™ rozmnaĹĽajÄ… jeĹ›li para
h = R.emptyHerd(); h.rabbit = 7; h.sheep = 1;
r = R.resolveRoll(h, S(), 'sheep', 'fox');
eq('lis zabral kroliki', r.herd.rabbit, 0);
eq('lis: stock dostal kroliki', r.stock.rabbit, 67);
eq('owce paruja mimo lisa', r.herd.sheep, 2);

// Lis z maĹ‚ym psem: pies wraca do stada, krĂłliki zostajÄ… I rozmnaĹĽajÄ… siÄ™ z kostki A
h = R.emptyHerd(); h.rabbit = 4; h.smallDog = 1;
r = R.resolveRoll(h, S(), 'rabbit', 'fox');
eq('pies przegonil lisa', r.herd.smallDog, 0);
eq('pies wrocil do stada', r.stock.smallDog, 5);
eq('kroliki ocalone i +2', r.herd.rabbit, 6); // floor((4+1)/2)=2

// Wilk bez duĹĽego psa: poĹĽera wszystko oprĂłcz koni i maĹ‚ego psa
h = R.emptyHerd(); h.rabbit = 10; h.sheep = 3; h.pig = 2; h.cow = 1; h.horse = 1; h.smallDog = 1;
r = R.resolveRoll(h, S(), 'wolf', 'sheep');
eq('wilk: kon zostal', r.herd.horse, 1);
eq('wilk: maly pies zostal', r.herd.smallDog, 1);
eq('wilk: owce zjedzone (potem 0+1 z kostki=0 par)', r.herd.sheep, 0);
eq('wilk: swinie zjedzone', r.herd.pig, 0);
eq('wilk: total', r.events[0].total, 16);

// Wilk z duĹĽym psem: tylko pies wraca, reszta siÄ™ rozmnaĹĽa normalnie
h = R.emptyHerd(); h.sheep = 3; h.bigDog = 1;
r = R.resolveRoll(h, S(), 'wolf', 'sheep');
eq('duzy pies przegonil wilka', r.herd.bigDog, 0);
eq('owce ocalone: floor((3+1)/2)=2 => 5', r.herd.sheep, 5);

// Wilk + lis naraz
h = R.emptyHerd(); h.rabbit = 5; h.sheep = 2;
r = R.resolveRoll(h, S(), 'wolf', 'fox');
eq('wilk+lis: pusto', r.herd.rabbit + r.herd.sheep, 0);

// Limit stada gĹ‚Ăłwnego
h = R.emptyHerd(); h.horse = 5;
let st = S(); st.horse = 1;
r = R.resolveRoll(h, st, 'sheep', 'horse');
eq('cap: tylko 1 kon w stadzie glownym', r.herd.horse, 6);
eq('cap flag', r.events.find(e => e.t === 'gain' && e.animal === 'horse').capped, true);

// Wymiany
h = R.emptyHerd(); h.rabbit = 13;
let ex = R.applyExchange(h, S(), R.EXCHANGE_RATES[0], +1, 2);
eq('12 krolikow => 2 owce', [ex.herd.rabbit, ex.herd.sheep], [1, 2]);
eq('maxTimes', R.maxTimes(h, S(), R.EXCHANGE_RATES[0], +1), 2);
ex = R.applyExchange(h, S(), R.EXCHANGE_RATES[0], +1, 3);
eq('za duzo razy => null', ex, null);
h = R.emptyHerd(); h.sheep = 1;
ex = R.applyExchange(h, S(), R.EXCHANGE_RATES[0], -1, 1);
eq('owca => 6 krolikow (w dol)', [ex.herd.sheep, ex.herd.rabbit], [0, 6]);
h = R.emptyHerd(); h.cow = 1;
ex = R.applyExchange(h, S(), R.EXCHANGE_RATES[5], +1, 1);
eq('krowa => duzy pies', [ex.herd.cow, ex.herd.bigDog], [0, 1]);

// ZwyciÄ™stwo
h = R.emptyHerd(); h.rabbit = 1; h.sheep = 1; h.pig = 1; h.cow = 1; h.horse = 1;
eq('wygrana (psy niepotrzebne)', R.checkWin(h), true);
h.horse = 0;
eq('bez konia brak wygranej', R.checkWin(h), false);

// Input contracts: untrusted packets must never create fractional animals,
// invent exchange rates or put a predator on the wrong die.
const assert = require('node:assert/strict');
h = { ...R.emptyHerd(), rabbit: 24, sheep: 4 };
const before = JSON.stringify(h), rate = R.EXCHANGE_RATES[0];
for (const times of [0, -1, 1.5, NaN, Infinity, -Infinity, '1', null, true, Number.MAX_SAFE_INTEGER + 1]) {
  assert.equal(R.canExchange(h, S(), rate, 1, times), false);
  assert.equal(R.applyExchange(h, S(), rate, 1, times), null);
}
for (const dir of [0, 2, -2, '1', null, undefined]) {
  assert.equal(R.canExchange(h, S(), rate, dir, 1), false);
  assert.equal(R.maxTimes(h, S(), rate, dir), 0);
}
for (const badRate of [null, {}, { ...rate, giveN: 0 }, { ...rate, getN: 100 }, { ...rate, id: 'free' }]) {
  assert.equal(R.applyExchange(h, S(), badRate, 1, 1), null);
}
assert.ok(R.applyExchange(h, S(), { ...rate }, 1, 1), 'A faithful rate copy is allowed');
assert.equal(JSON.stringify(h), before, 'Exchange does not mutate its input');
for (const faces of [['horse', 'rabbit'], ['rabbit', 'cow'], ['fox', 'wolf'], [null, 'rabbit'], ['rabbit', 'smallDog']]) {
  assert.equal(R.resolveRoll(h, S(), ...faces), null);
}
assert.equal(R.checkWin({}), false);
assert.equal(R.resolveRoll({ ...h, rabbit: 0.5 }, S(), 'rabbit', 'rabbit'), null);
assert.equal(R.resolveRoll(h, { ...S(), sheep: -1 }, 'rabbit', 'rabbit'), null);
console.log('ok   malformed quantities, directions, rates, herds and faces are rejected');

// Conservation and immutable inputs for all 144 die combinations, with an
// empty farm, occupied farm, exhausted bank and both forms of protection.
let resolved = 0;
for (const initial of [
  R.emptyHerd(),
  { ...R.emptyHerd(), rabbit: 7, sheep: 3, pig: 2, cow: 1, horse: 1 },
  { ...R.emptyHerd(), rabbit: 7, sheep: 3, pig: 2, smallDog: 1, bigDog: 1 },
  { ...R.emptyHerd(), ...R.STOCK_INIT }
]) {
  const bank = Object.fromEntries(R.ANIMALS.map(a => [a, R.STOCK_INIT[a] - initial[a]]));
  const original = JSON.stringify([initial, bank]);
  for (const a of R.DIE_A) for (const b of R.DIE_B) {
    const outcome = R.resolveRoll(initial, bank, a, b);
    assert.ok(outcome);
    assert.ok(R.validHerd(outcome.herd) && R.validHerd(outcome.stock));
    for (const animal of R.ANIMALS) assert.equal(outcome.herd[animal] + outcome.stock[animal], R.STOCK_INIT[animal]);
    assert.equal(JSON.stringify([initial, bank]), original);
    resolved++;
  }
}
console.log(`ok   ${resolved} roll outcomes conserve every animal and leave inputs unchanged`);

console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
process.exit(fails ? 1 : 0);
