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

console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
process.exit(fails ? 1 : 0);
