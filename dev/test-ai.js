// Exercise the actual browser AI module with the same RULES implementation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const RULES = require('../src/rules.js');
const context = { RULES };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/ai.js'), 'utf8'), context);
const AI = context.AI;

function herd(values) { return { ...RULES.emptyHerd(), ...values }; }
function stock(h) {
  return Object.fromEntries(RULES.ANIMALS.map(a => [a, RULES.STOCK_INIT[a] - h[a]]));
}
function next(h, s, move) { return move && RULES.applyExchange(h, s, move.rate, move.dir, move.times); }
function winsNow(h) {
  const s = stock(h), move = AI.chooseExchange(h, s), result = next(h, s, move);
  assert.ok(result && RULES.checkWin(result.herd), 'AI must take an available immediate win: ' + JSON.stringify(h));
  return move;
}

const rabbitRecovery = winsNow(herd({ sheep: 2, pig: 1, cow: 1, horse: 1 }));
assert.equal(rabbitRecovery.rate.id, 'r-s');
assert.equal(rabbitRecovery.dir, -1);
assert.equal(rabbitRecovery.times, 1);
winsNow(herd({ rabbit: 1, sheep: 1, pig: 1, horse: 1, bigDog: 1 }));
winsNow(herd({ rabbit: 1, pig: 1, cow: 1, horse: 1, smallDog: 1 }));
winsNow(herd({ rabbit: 1, sheep: 1, cow: 2, horse: 1 }));
winsNow(herd({ rabbit: 7, pig: 1, cow: 1, horse: 1 }));
winsNow(herd({ rabbit: 1, sheep: 1, pig: 1, cow: 3 }));
assert.equal(AI.chooseExchange(herd({}), { ...RULES.STOCK_INIT }), null);
assert.equal(AI.chooseExchange(null, { ...RULES.STOCK_INIT }), null);
const blocked = herd({ sheep: 2, pig: 1, cow: 1, horse: 1 });
assert.equal(AI.chooseExchange(blocked, { ...stock(blocked), rabbit: 0 }), null);

// Across representative conserved inventories, every selected move is legal;
// whenever a legal exchange wins, the selected move wins too (both directions).
let positions = 0, winningPositions = 0;
for (const rabbit of [0, 1, 6, 7, 13]) for (const sheep of [0, 1, 2, 3, 4])
for (const pig of [0, 1, 3, 4]) for (const cow of [0, 1, 2, 3])
for (const horse of [0, 1]) for (const smallDog of [0, 1]) for (const bigDog of [0, 1]) {
  const h = herd({ rabbit, sheep, pig, cow, horse, smallDog, bigDog }), s = stock(h);
  if (RULES.checkWin(h)) continue;
  const before = JSON.stringify([h, s]), move = AI.chooseExchange(h, s), selected = next(h, s, move);
  if (move) assert.ok(selected, 'AI selected an illegal exchange');
  assert.equal(JSON.stringify([h, s]), before, 'AI must not mutate the position');
  let winning = false;
  for (const rate of RULES.EXCHANGE_RATES) for (const dir of [-1, 1]) {
    for (let times = 1; times <= RULES.maxTimes(h, s, rate, dir); times++) {
      if (RULES.checkWin(RULES.applyExchange(h, s, rate, dir, times).herd)) winning = true;
    }
  }
  if (winning) {
    winningPositions++;
    assert.ok(selected && RULES.checkWin(selected.herd), 'AI missed a winning exchange');
  }
  positions++;
}
console.log(`AI OK: 6 immediate-win regressions; ${positions} positions, including ${winningPositions} winning exchanges.`);
