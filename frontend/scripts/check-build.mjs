import { readFileSync, readdirSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import vm from 'node:vm';

const root = new URL('../dist/', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');
const manifest = JSON.parse(read('manifest.webmanifest'));
const base = manifest.scope;
const release = JSON.parse(read('version.json'));
const packageVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
assert.ok(Number.isFinite(Date.parse(release.builtAt)));
assert.equal(release.version, `${packageVersion}-${release.builtAt.replace(/[-:.]/g, '')}`);
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
let networkMode = 'success';
let activated = 0;
let claimed = 0;
const deleted = [];
const cache = { addAll: async files => stored.push(...files), match: async path => new Response(`static:${path}`) };
const context = {
  URL, self: {
    location: { origin: 'https://example.github.io' }, addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: async () => { activated++; }, clients: { claim: async () => { claimed++; } },
  },
  caches: {
    open: async () => cache, keys: async () => [`studentiq-${base}-old`, 'another-app-cache'],
    delete: async key => { deleted.push(key); return true; },
  },
  fetch: async () => {
    networkCalls++;
    if (networkMode === 'offline') throw new Error('offline');
    return new Response('network', { status: networkMode === 'failure' ? 503 : 200 });
  },
};
vm.runInNewContext(read('sw.js'), context);
await new Promise(resolve => handlers.install({ waitUntil: promise => promise.then(resolve) }));
assert.ok(stored.includes(`${base}index.html`));
assert.equal(activated, 1, 'A new worker must not wait indefinitely behind old tabs');
await new Promise(resolve => handlers.activate({ waitUntil: promise => promise.then(resolve) }));
assert.equal(claimed, 1);
assert.deepEqual(deleted, [`studentiq-${base}-old`], 'Leave other apps caches untouched');
assert.ok(!stored.some(path => /config\.json|auth\.html|\/api\//.test(path)));
const asset = readdirSync(new URL('assets/', root)).find(name => name.endsWith('.js'));
const scripts = readdirSync(new URL('assets/', root)).filter(name => name.endsWith('.js')).map(name => read(`assets/${name}`)).join('\n');
assert.ok(scripts.includes(release.version));
assert.ok(scripts.includes(release.builtAt));
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
assert.equal(await (await navigation).text(), 'network', 'Navigation must request the latest shell');
assert.equal(await (await intercept(`${base}index.html`)).text(), 'network');
for (const mode of ['offline', 'failure']) {
  networkMode = mode;
  assert.equal(await (await intercept(`${base}index.html`)).text(), `static:${base}index.html`);
}
networkMode = 'success';
const beforePrivateRequests = networkCalls;
for (const path of [
  `${base}config.json`, `${base}version.json`, `${base}auth.html`, `${base}api/sessions`, '/api/sessions', `${base}?code=private`,
  '/api/me', '/api/planning/reminders', '/api/preferences', '/api/practice/piano', '/api/quiz/attempts',
  '/api/sessions?cursor=private', '/api/practice/piano?cursor=private', '/api/quiz/attempts?cursor=private',
  '/api/library?language=en', '/api/library/questions/maths-books', '/api/quiz/private', '/api/quiz/private/hint',
]) {
  assert.equal(intercept(path), undefined, `Must bypass worker: ${path}`);
}
assert.equal(intercept(`${base}assets/${asset}`, { headers: { authorization: 'Bearer private' } }), undefined);
assert.equal(intercept(`${base}index.html`, { method: 'POST', body: 'private' }), undefined);
assert.equal(networkCalls, beforePrivateRequests);
console.log(`Production shell, ${base} paths, install icons and privacy cache boundaries verified.`);
