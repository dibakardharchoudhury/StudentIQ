import { readFileSync, readdirSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import vm from 'node:vm';

const root = new URL('../dist/', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');
const manifest = JSON.parse(read('manifest.webmanifest'));
const base = manifest.scope;
assert.equal(manifest.start_url, base);
assert.ok(read('index.html').includes(`${base}manifest.webmanifest`));
assert.ok(read('index.html').includes(`${base}assets/`));
for (const size of [192, 512]) {
  const image = readFileSync(new URL(`icon-${size}.png`, root));
  assert.equal(image.readUInt32BE(16), size);
  assert.equal(image.readUInt32BE(20), size);
}
const handlers = {};
const stored = [];
let networkCalls = 0;
const cache = { addAll: async files => stored.push(...files), match: async path => new Response(`static:${path}`) };
const context = {
  URL, self: { location: { origin: 'https://example.github.io' }, addEventListener: (type, fn) => { handlers[type] = fn; } },
  caches: { open: async () => cache, keys: async () => [], delete: async () => true },
  fetch: async () => { networkCalls++; return new Response('network'); },
};
vm.runInNewContext(read('sw.js'), context);
await new Promise(resolve => handlers.install({ waitUntil: promise => promise.then(resolve) }));
assert.ok(stored.includes(`${base}index.html`));
assert.ok(!stored.some(path => /config\.json|auth\.html|\/api\//.test(path)));
const asset = readdirSync(new URL('assets/', root)).find(name => name.endsWith('.js'));
function intercept(path, options = {}) {
  let response;
  handlers.fetch({
    request: new Request(`https://example.github.io${path}`, options),
    respondWith: value => { response = value; },
  });
  return response;
}
assert.ok(await intercept(`${base}assets/${asset}`));
let navigation;
handlers.fetch({
  request: { url: `https://example.github.io${base}`, method: 'GET', mode: 'navigate', headers: new Headers() },
  respondWith: value => { navigation = value; },
});
assert.equal(await (await navigation).text(), `static:${base}index.html`);
for (const path of [
  `${base}config.json`, `${base}auth.html`, `${base}api/sessions`, '/api/sessions', `${base}?code=private`,
  '/api/me', '/api/admin/reminders', '/api/preferences', '/api/practice/piano', '/api/quiz/attempts',
  '/api/sessions?cursor=private', '/api/practice/piano?cursor=private', '/api/quiz/attempts?cursor=private',
]) {
  assert.equal(intercept(path), undefined, `Must bypass worker: ${path}`);
}
assert.equal(intercept(`${base}assets/${asset}`, { headers: { authorization: 'Bearer private' } }), undefined);
assert.equal(intercept(`${base}index.html`, { method: 'POST', body: 'private' }), undefined);
assert.equal(networkCalls, 0);
console.log(`Production shell, ${base} paths, install icons and privacy cache boundaries verified.`);
