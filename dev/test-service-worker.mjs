import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const origin = 'https://example.test/superfarmer/';
const prefix = 'sf3d-v2-%2Fsuperfarmer%2F-';
const handlers = {}, deleted = [], stored = new Map(), writes = [], precached = [];
const cache = {
  addAll: async (paths) => precached.push(...paths),
  put: async (request, response) => { writes.push(request.url); stored.set(request.url, response); },
  match: async (request, options) => {
    const url = new URL(typeof request === 'string' ? request : request.url, origin);
    if (options?.ignoreSearch) url.search = '';
    return stored.get(url.href)?.clone();
  }
};
let network = async () => { throw new Error('offline'); };
const context = {
  URL, Response,
  fetch: (...args) => network(...args),
  caches: {
    open: async () => cache,
    keys: async () => [prefix + 'old', prefix + 'test', 'another-app', 'sf3d-v2-%2Fanother-game%2F-old'],
    delete: async (name) => { deleted.push(name); return true; }
  },
  self: { registration: { scope: origin }, clients: { claim: async () => {} }, skipWaiting: async () => {}, addEventListener: (type, fn) => { handlers[type] = fn; } }
};
vm.runInNewContext(readFileSync(new URL('../src/sw.js', import.meta.url), 'utf8').replace('__BUILD_ID__', 'test'), context);
const lifecycle = async (name) => {
  let work;
  handlers[name]({ waitUntil: (promise) => { work = promise; } });
  await work;
};
await lifecycle('install');
assert.deepEqual(precached, ['./', './manifest.webmanifest', './icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png']);
await lifecycle('activate');
assert.deepEqual(deleted, [prefix + 'old'], 'activation preserves caches owned by other apps/scopes');

async function request(path, method = 'GET') {
  let response;
  const work = [];
  handlers.fetch({ request: { url: new URL(path, origin).href, method }, respondWith: (value) => { response = value; }, waitUntil: (value) => work.push(value) });
  const resolved = await response;
  await Promise.all(work);
  return resolved;
}
stored.set(origin, new Response('offline game', { headers: { 'content-type': 'text/html' } }));
assert.equal(await (await request('./?debug=1')).text(), 'offline game');
assert.equal(await (await request('./index.html')).text(), 'offline game');
assert.equal((await request('./icon.svg')).type, 'error', 'missing assets never receive HTML');
assert.equal(await request('https://outside.test/script.js'), undefined);
assert.equal(await request('./api/private'), undefined);
assert.equal(await request('./', 'POST'), undefined);
network = async () => new Response('fresh game');
assert.equal(await (await request('./')).text(), 'fresh game');
assert.deepEqual(writes, [origin]);
network = async () => Response.redirect('https://example.test/login');
await request('./');
assert.equal(writes.length, 1, 'redirects are not cached');
console.log('Service worker: 10 checks passed (offline, scope isolation, asset fallback, redirects).');
