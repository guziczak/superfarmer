import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';
const root = fileURLToPath(new URL('..', import.meta.url));
const commands = [
  ...readdirSync(new URL('../src/', import.meta.url)).filter((name) => name.endsWith('.js')).map((name) => ['--check', 'src/' + name]),
  ['dev/test-rules.js'],
  ['dev/test-ai.js'],
  ['dev/test-game-state.js'],
  ['dev/test-accessibility.mjs'],
  ['dev/test-symbols.mjs'],
  ['dev/test-dice-regressions.mjs'],
  ['dev/test-service-worker.mjs'],
  ['dev/test-net.mjs'],
  ['dev/qr-test.mjs'],
  ['dev/check-parallel.mjs'],
  ['dev/settle-sim.mjs'],
  ['dev/lock-sim.mjs']
];
for (const args of commands) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('\nAll Superfarmer checks passed.');
