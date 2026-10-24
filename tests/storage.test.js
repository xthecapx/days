import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { sendChange } from '../src/storage/bridgeClient.js';
import * as cache from '../src/storage/localCache.js';
import { loadStore, persistStore, loadSeed } from '../src/storage/incidentStore.js';
import { normalizeStore } from '../src/storage/normalize.js';

const remote = { incidents: [{ id: 'r1', number: 1 }], revisions: [] };
const cached = { incidents: [{ id: 'c1', number: 1 }], revisions: [] };
let calls;

function env({ host = 'vecinos.example.com', routes = {}, storage = {} } = {}) {
  calls = [];
  const mem = new Map(Object.entries(storage));
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k)
  };
  globalThis.location = { hostname: host };
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method || 'GET' });
    const hit = Object.entries(routes).find(([k]) => String(url).includes(k));
    if (!hit) throw new Error('sin red');
    const [status, body] = hit[1];
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return mem;
}

test('sendChange: traduce cada respuesta del puente a un estado legible', async () => {
  const run = async (status) => {
    env({ routes: { 'bridge.test': [status, {}] } });
    return sendChange('https://bridge.test/', { type: 'confirm', id: 'x' }, 'resumen');
  };
  assert.equal((await run(200)).mode, 'pr');
  assert.equal((await run(429)).mode, 'github-limited');
  assert.equal((await run(500)).mode, 'github-error');
  env();
  const warn = mock.method(console, 'warn', () => {});
  const offline = await sendChange('https://bridge.test/', {}, 'x');
  assert.equal(offline.mode, 'github-offline');
  assert.equal(offline.ok, false);
  warn.mock.restore();
});

test('sendChange: el cuerpo lleva el prefijo del commit y el cambio', async () => {
  let body;
  env({ routes: { 'bridge.test': [200, {}] } });
  const original = globalThis.fetch;
  globalThis.fetch = async (u, init) => { body = JSON.parse(init.body); return original(u, init); };
  await sendChange('https://bridge.test/', { type: 'confirm', id: 'x' }, 'resumen');
  assert.deepEqual(body, { commitMessage: 'Wiki Vecinal: resumen', change: { type: 'confirm', id: 'x' } });
});

test('localCache: nunca lanza aunque localStorage falle', () => {
  env();
  const boom = () => { throw new Error('modo privado'); };
  globalThis.localStorage = { getItem: boom, setItem: boom, removeItem: boom };
  const warn = mock.method(console, 'warn', () => {});
  assert.equal(cache.readStore(), null);
  assert.equal(cache.writeStore({ a: 1 }), false);
  assert.doesNotThrow(() => cache.clearStore());
  assert.doesNotThrow(() => cache.purgeLegacyStores());
  assert.deepEqual(cache.readBridgeConfig(), { bridgeUrl: cache.DEFAULT_BRIDGE_URL, githubRepo: cache.DEFAULT_GITHUB_REPO });
  warn.mock.restore();
});

test('localCache: la configuración guardada completa los valores que faltan', () => {
  env({ storage: { vecinos_rio_hato_github_bridge_v1: JSON.stringify({ bridgeUrl: '' , githubRepo: 'a/b' }) } });
  assert.deepEqual(cache.readBridgeConfig(), { bridgeUrl: cache.DEFAULT_BRIDGE_URL, githubRepo: 'a/b' });
});

test('loadStore: el repositorio gana sobre la copia del navegador y la refresca', async () => {
  const mem = env({
    routes: { 'raw.githubusercontent.com': [200, remote] },
    storage: { vecinos_rio_hato_wiki_json_v4: JSON.stringify(cached), vecinos_rio_hato_wiki_json_v3: '{}' }
  });
  const store = await loadStore();
  assert.equal(store.incidents[0].id, 'r1');
  assert.equal(JSON.parse(mem.get('vecinos_rio_hato_wiki_json_v4')).incidents[0].id, 'r1');
  assert.equal(mem.has('vecinos_rio_hato_wiki_json_v3'), false, 'borra la copia v3');
});

test('loadStore: orden GitHub -> archivo servido -> copia local -> vacío', async () => {
  env({ routes: { './data/incidents.json': [200, remote] } }); // GitHub cae, el archivo servido responde
  assert.equal((await loadStore()).incidents[0].id, 'r1');
  assert.ok(calls[0].url.includes('raw.githubusercontent.com'));
  assert.ok(calls[1].url.startsWith('./data/incidents.json'));

  const warn = mock.method(console, 'warn', () => {});
  env({ storage: { vecinos_rio_hato_wiki_json_v4: JSON.stringify(cached) } }); // sin red: copia local
  assert.equal((await loadStore()).incidents[0].id, 'c1');
  env(); // sin red y sin copia
  assert.deepEqual((await loadStore()).incidents, []);
  warn.mock.restore();
});

test('loadStore: en localhost no se consulta GitHub', async () => {
  env({ host: 'localhost', routes: { './data/incidents.json': [200, remote] } });
  await loadStore();
  assert.equal(calls.some((c) => c.url.includes('githubusercontent')), false);
});

test('persistStore: en producción manda al puente solo si hay cambio', async () => {
  env({ routes: { 'workers.dev': [200, {}] } });
  const withChange = await persistStore(cached, 'nota', { type: 'confirm', id: 'c1' });
  assert.equal(withChange.syncStatus.mode, 'pr');
  assert.equal(calls.filter((c) => c.method === 'POST').length, 1);

  env({ routes: { 'workers.dev': [200, {}] } });
  const noChange = await persistStore(cached, 'importar');
  assert.equal(noChange.syncStatus.mode, 'local');
  assert.equal(calls.length, 0);
});

test('persistStore: en localhost guarda en disco y nunca llama al puente', async () => {
  env({ host: 'localhost', routes: { '/api/local-wiki-save': [200, {}], 'workers.dev': [200, {}] } });
  const ok = await persistStore(cached, 'nota', { type: 'confirm', id: 'c1' });
  assert.equal(ok.syncStatus.mode, 'disk');
  assert.deepEqual(calls.map((c) => c.url), ['/api/local-wiki-save']);

  const warn = mock.method(console, 'warn', () => {});
  env({ host: '127.0.0.1' }); // el servidor local no responde
  const down = await persistStore(cached, 'nota', { type: 'confirm', id: 'c1' });
  assert.equal(down.syncStatus.mode, 'local');
  warn.mock.restore();
});

test('persistStore: sigue funcionando si localStorage está bloqueado', async () => {
  env({ routes: { 'workers.dev': [200, {}] } });
  const boom = () => { throw new Error('lleno'); };
  globalThis.localStorage = { getItem: boom, setItem: boom, removeItem: boom };
  const warn = mock.method(console, 'warn', () => {});
  const out = await persistStore(cached, 'nota', { type: 'confirm', id: 'c1' });
  assert.equal(out.syncStatus.mode, 'pr');
  warn.mock.restore();
});

test('loadSeed borra la copia local y devuelve el archivo del despliegue', async () => {
  const mem = env({ routes: { './data/incidents.json': [200, remote] }, storage: { vecinos_rio_hato_wiki_json_v4: '{}' } });
  assert.equal((await loadSeed()).incidents[0].id, 'r1');
  assert.equal(mem.has('vecinos_rio_hato_wiki_json_v4'), false);
});

test('normalizeStore: ordena por número y completa los campos que faltan', () => {
  const n = normalizeStore({ incidents: [{ id: 'b', number: 2 }, { id: 'a', number: 1 }] });
  assert.deepEqual(n.incidents.map((i) => i.id), ['a', 'b']);
  assert.equal(n.schemaVersion, 3);
  assert.deepEqual(n.revisions, []);
  assert.ok(n.referenceCenter && n.lastUpdated);
});
