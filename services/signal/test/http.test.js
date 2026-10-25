import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handle, originAllowed, clientHash, MAX_BODY } from '../src/http.js';
import { createBoard } from '../src/board.js';
import { createMemoryStorage } from '../src/memoryStorage.js';
import { runBoard } from '../src/rpc.js';
import { createSqlStorage } from '../src/sqlStorage.js';

const GITHUB = 'https://xthecapx.github.io';
const HOME = { lat: 7.005, lng: -73.064 };

/** Servidor completo en memoria: una sala por nombre, como los Durable Objects. */
function server(env = {}) {
  const clock = { t: 1_800_000_000_000 };
  const calls = [];
  const board = createBoard({ storage: createMemoryStorage(), now: () => clock.t });
  const getBoard = () => ({ run: async (op, input) => { calls.push({ op, input }); return runBoard(board, op, input); } });
  const call = (path, { method = 'GET', body, headers = {}, raw } = {}) => {
    const init = { method, headers: { 'CF-Connecting-IP': '203.0.113.7', ...headers } };
    if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] ??= 'application/json'; }
    if (raw !== undefined) init.body = raw;
    return handle(new Request(`https://signal.test${path}`, init), { SIGNAL_PEPPER: 'pimienta', ...env }, { getBoard });
  };
  return { call, calls, clock, board, json: async (p, o) => { const r = await call(p, o); return { status: r.status, headers: r.headers, body: await r.json() }; } };
}
const post = (body, headers) => ({ method: 'POST', body, headers });

// ---------- rutas y formato ----------

test('GET / dice que el servicio vive y qué falta configurar (sin revelar secretos)', async () => {
  const s = server();
  const r = await s.json('/');
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.service, r.body.pepperConfigured], ['days-signal', true]);
  assert.equal('rooms' in r.body, false, 'ya no hay salas');
  assert.doesNotMatch(JSON.stringify(r.body), /pimienta/);
  assert.equal((await server({ SIGNAL_PEPPER: '' }).json('/')).body.pepperConfigured, false);
});

test('todas las respuestas son JSON, sin caché y con nosniff', async () => {
  const s = server();
  for (const [path, opts] of [['/', {}], ['/state', {}], ['/nada', {}], ['/poll', {}], ['/signal', post({ lat: 'x', lng: 'y' })]]) {
    const r = await s.call(path, opts);
    assert.match(r.headers.get('Content-Type'), /^application\/json/, path);
    assert.equal(r.headers.get('Cache-Control'), 'no-store', path);
    assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff', path);
  }
});

test('ruta inexistente = 404; método equivocado = 405 con Allow; barra final tolerada', async () => {
  const s = server();
  assert.equal((await s.json('/nada')).status, 404);
  const wrong = await s.call('/poll');
  assert.equal(wrong.status, 405);
  assert.equal(wrong.headers.get('Allow'), 'POST');
  assert.equal((await s.call('/state', { method: 'DELETE' })).status, 405);
  assert.equal((await s.json('/state/')).status, 200);
});

// ---------- un solo tablero (sin salas) ----------

test('hay un solo tablero: lo que se envía lo ve cualquiera, y un ?room=... antiguo se ignora sin error', async () => {
  const s = server();
  await s.json('/signal', post({ ...HOME }));
  assert.equal((await s.json('/state')).body.signals.length, 1);
  for (const room of ['dev', 'main', 'prod', '', '../x']) {
    const r = await s.json(`/state?room=${encodeURIComponent(room)}`);
    assert.equal(r.status, 200, `room=${room}`);
    assert.equal(r.body.signals.length, 1, 'todos los enlaces viejos ven el mismo tablero');
  }
  // un atajo antiguo que aún apunte a ?room=dev envía al tablero real
  await s.json('/signal?room=dev', { ...post({ ...HOME }), headers: { 'CF-Connecting-IP': '198.51.100.9' } });
  assert.equal((await s.json('/state')).body.signals.length, 2);
});

// ---------- flujo completo ----------

test('flujo: enviar → ver → sondear como oyente → cancelar', async () => {
  const s = server();
  const sent = await s.json('/signal', post({ ...HOME }));
  assert.equal(sent.status, 200);
  assert.equal(sent.body.ok, true);
  assert.ok(sent.body.cancelToken && sent.body.id);

  const seen = await s.json('/state');
  assert.equal(seen.body.signals.length, 1);
  assert.equal(seen.body.listeners, 0);

  const polled = await s.json('/poll', post({ listener: 'oyente-abc123', listening: true }));
  assert.equal(polled.body.listeners, 1);
  assert.equal(polled.body.signals.length, 1);

  const bad = await s.json('/signal/cancel', post({ id: sent.body.id, token: 'token-equivocado-xx' }));
  assert.equal(bad.status, 403);
  const ok = await s.json('/signal/cancel', post({ id: sent.body.id, token: sent.body.cancelToken }));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.signals.length, 0);
});

test('errores de las reglas llegan con su código HTTP y un mensaje en español', async () => {
  const s = server();
  const fuera = await s.json('/signal', post({ lat: 4.6, lng: -74.07 }));
  assert.deepEqual([fuera.status, fuera.body.code], [422, 'outside_area']);
  assert.match(fuera.body.error, /fuera del área/);
  assert.equal((await s.json('/poll', post({ listener: 'x', listening: true }))).status, 400);
  assert.equal((await s.json('/signal/cancel', post({ id: 'noexiste1', token: 'lo-que-sea-aqui' }))).status, 404);
});

// ---------- privacidad y cliente anónimo ----------

test('el hash del cliente nunca sale en una respuesta, y la IP en claro no llega al tablero', async () => {
  const s = server();
  const sent = await s.json('/signal', post({ ...HOME }));
  const state = await s.json('/state');
  const everything = JSON.stringify([sent.body, state.body]);
  const hash = await clientHash(new Request('https://x', { headers: { 'CF-Connecting-IP': '203.0.113.7' } }), { SIGNAL_PEPPER: 'pimienta' });
  assert.doesNotMatch(everything, new RegExp(hash));
  assert.doesNotMatch(everything, /203\.0\.113\.7/);
  assert.doesNotMatch(JSON.stringify(s.calls), /203\.0\.113\.7/, 'la IP no cruza al Durable Object');
});

test('el hash depende del secreto: sin conocerlo no se puede adivinar la IP recorriendo las IPv4', async () => {
  const req = (ip) => new Request('https://x', { headers: { 'CF-Connecting-IP': ip } });
  const a = await clientHash(req('203.0.113.7'), { SIGNAL_PEPPER: 'uno' });
  assert.notEqual(a, await clientHash(req('203.0.113.7'), { SIGNAL_PEPPER: 'otro' }));
  assert.notEqual(a, await clientHash(req('203.0.113.8'), { SIGNAL_PEPPER: 'uno' }));
  assert.equal(a, await clientHash(req('203.0.113.7'), { SIGNAL_PEPPER: 'uno' }));
  assert.match(a, /^[0-9a-f]{32}$/);
});

test('una señal por persona usa el hash de la conexión: la misma IP reemplaza, otra IP convive', async () => {
  const s = server();
  await s.json('/signal', post({ ...HOME }));
  await s.json('/signal', post({ ...HOME }));
  assert.equal((await s.json('/state')).body.signals.length, 1);
  await s.json('/signal', { ...post({ ...HOME }), headers: { 'CF-Connecting-IP': '198.51.100.9' } });
  assert.equal((await s.json('/state')).body.signals.length, 2);
});

test('el cliente nunca se toma del cuerpo: no se puede suplantar a otra persona', async () => {
  const s = server();
  await s.json('/signal', post({ ...HOME, client: 'otro-cliente-123' }));
  assert.notEqual(s.calls.at(-1).input.client, 'otro-cliente-123');
  assert.deepEqual(Object.keys(s.calls.at(-1).input).sort(), ['client', 'lat', 'lng']);
});

test('del cuerpo solo se pasan los campos esperados', async () => {
  const s = server();
  await s.json('/poll', post({ listener: 'oyente-abc123', listening: true, extra: 'x', __proto__: { admin: true } }));
  assert.deepEqual(Object.keys(s.calls.at(-1).input).sort(), ['listener', 'listening']);
});

// ---------- cuerpo ----------

test('cuerpo: demasiado grande = 413 (por Content-Length y por tamaño real)', async () => {
  const s = server();
  const big = JSON.stringify({ lat: 7.005, lng: -73.064, basura: 'x'.repeat(MAX_BODY) });
  assert.equal((await s.json('/signal', { method: 'POST', raw: big, headers: { 'Content-Type': 'application/json' } })).status, 413);
  assert.equal((await s.json('/signal', { method: 'POST', raw: '{}', headers: { 'Content-Type': 'application/json', 'Content-Length': '999999' } })).status, 413);
  assert.equal(s.calls.length, 0);
});

test('cuerpo: JSON roto, no-objeto o tipo no soportado', async () => {
  const s = server();
  const json = (raw) => s.json('/signal', { method: 'POST', raw, headers: { 'Content-Type': 'application/json' } });
  for (const raw of ['{nope', 'null', '[1,2]', '"texto"', '']) assert.equal((await json(raw)).body.code, 'bad_body', JSON.stringify(raw));
  const plain = await s.json('/signal', { method: 'POST', raw: 'lat=7', headers: { 'Content-Type': 'text/plain' } });
  assert.deepEqual([plain.status, plain.body.code], [415, 'bad_content_type']);
  // Sin cabecera, el contenido decide; un tipo equivocado sigue rechazado.
  const none = (raw, ip) => s.json('/signal', { method: 'POST', raw, headers: { 'Content-Type': '', 'CF-Connecting-IP': ip } });
  assert.equal((await none('lat=7.005&lng=-73.064', '198.51.100.1')).status, 200, 'formulario sin cabecera');
  assert.equal((await none('{"lat":7.005,"lng":-73.064}', '198.51.100.2')).status, 200, 'JSON sin cabecera');
  assert.equal((await none('   {"lat":"7,005","lng":"-73,064"}', '198.51.100.3')).status, 200, 'JSON con espacios delante');
  assert.equal((await none('basura sin sentido', '198.51.100.4')).status, 400, 'sin lat ni lng: llega al tablero y se rechaza ahí (bad_coordinates)');
  assert.equal((await none('', '198.51.100.5')).status, 400, 'cuerpo vacío');
  assert.equal((await s.json('/signal', { method: 'POST', raw: 'lat=7', headers: { 'Content-Type': 'application/xml' } })).status, 415);
});

test('Atajos de iPhone: también se acepta un formulario, con números como texto y coma decimal', async () => {
  const s = server();
  const form = await s.json('/signal', { method: 'POST', raw: 'lat=7%2C005&lng=-73%2C064', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal(form.status, 200, JSON.stringify(form.body));
  const multi = new FormData(); multi.set('lat', '7.005'); multi.set('lng', '-73.064');
  const m = await s.call('/signal', { method: 'POST', raw: multi, headers: { 'CF-Connecting-IP': '198.51.100.1' } });
  assert.equal(m.status, 200);
  const asJson = await s.json('/signal', { ...post({ lat: '7,005', lng: '-73,064' }), headers: { 'CF-Connecting-IP': '198.51.100.2' } });
  assert.equal(asJson.status, 200);
});

// ---------- CORS ----------

test('CORS: el sitio de GitHub Pages puede llamar y recibe sus cabeceras', async () => {
  const s = server();
  const r = await s.call('/state', { headers: { Origin: GITHUB } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), GITHUB);
  assert.equal(r.headers.get('Vary'), 'Origin');
  const pre = await s.call('/signal', { method: 'OPTIONS', headers: { Origin: GITHUB, 'Access-Control-Request-Method': 'POST' } });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('Access-Control-Allow-Methods'), /POST/);
  assert.equal(pre.headers.get('Access-Control-Allow-Headers'), 'Content-Type');
});

test('CORS: un origen desconocido se rechaza (403), también en la precomprobación', async () => {
  const s = server();
  for (const origin of ['https://malo.example', 'https://xthecapx.github.io.malo.example', 'http://xthecapx.github.io', 'null']) {
    const r = await s.json('/state', { headers: { Origin: origin } });
    assert.deepEqual([r.status, r.body.code], [403, 'origin_not_allowed'], origin);
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), null, origin);
    assert.equal((await s.call('/signal', { method: 'OPTIONS', headers: { Origin: origin } })).status, 403, origin);
  }
  assert.equal(s.calls.length, 0);
});

test('sin cabecera Origin (Atajos del teléfono, curl) se atiende', async () => {
  const s = server();
  assert.equal((await s.json('/signal', post({ ...HOME }))).status, 200);
});

test('localhost y la red local solo se permiten con ALLOW_LOCAL (solo en desarrollo)', () => {
  const local = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://192.168.68.54:5173', 'http://10.1.2.3:5173', 'http://172.20.0.5:5173', 'http://mi-mac.local:5173'];
  for (const o of local) {
    assert.equal(originAllowed(o, { ALLOW_LOCAL: 'false' }), false, `producción rechaza ${o}`);
    assert.equal(originAllowed(o, { ALLOW_LOCAL: 'true' }), true, `desarrollo acepta ${o}`);
  }
  for (const o of ['http://8.8.8.8:5173', 'http://172.32.0.1', 'https://192.168.1.1', 'http://evil.com', 'not a url']) assert.equal(originAllowed(o, { ALLOW_LOCAL: 'true' }), false, o);
  assert.equal(originAllowed(GITHUB, {}), true);
  assert.equal(originAllowed('https://otro.example', { ALLOWED_ORIGINS: 'https://otro.example, https://mas.example' }), true);
});

// ---------- límites de ritmo ----------

function limiter(allowed) {
  const keys = [];
  return { keys, limit: async ({ key }) => { keys.push(key); return { success: allowed(keys.length) }; } };
}

test('límite de ritmo: pasado el tope, 429 con Retry-After, y el tablero ni se entera', async () => {
  const SIGNAL_LIMITER = limiter((n) => n <= 2);
  const s = server({ SIGNAL_LIMITER });
  assert.equal((await s.json('/signal', post({ ...HOME }))).status, 200);
  assert.equal((await s.json('/signal', post({ ...HOME }))).status, 200);
  const blocked = await s.json('/signal', post({ ...HOME }));
  assert.deepEqual([blocked.status, blocked.body.code], [429, 'rate_limited']);
  assert.equal(blocked.headers.get('Retry-After'), '60');
  assert.equal(s.calls.length, 2);
});

test('los límites se miden por hash de cliente, no por IP en claro, y por tipo de operación', async () => {
  const SIGNAL_LIMITER = limiter(() => true);
  const POLL_LIMITER = limiter(() => true);
  const s = server({ SIGNAL_LIMITER, POLL_LIMITER });
  await s.json('/signal', post({ ...HOME }));
  await s.json('/state');
  await s.json('/poll', post({ listener: 'oyente-abc123', listening: true }));
  await s.json('/signal/cancel', post({ id: 'abcd', token: 'zzzzzzzz' }));
  assert.equal(SIGNAL_LIMITER.keys.length, 2, 'enviar y cancelar comparten límite');
  assert.equal(POLL_LIMITER.keys.length, 2, 'state y poll comparten límite');
  assert.ok([...SIGNAL_LIMITER.keys, ...POLL_LIMITER.keys].every((k) => /^[0-9a-f]{32}$/.test(k)));
});

test('si el limitador falla o no existe, una petición de ayuda NO se bloquea', async () => {
  const roto = { limit: async () => { throw new Error('caído'); } };
  assert.equal((await server({ SIGNAL_LIMITER: roto }).json('/signal', post({ ...HOME }))).status, 200);
  assert.equal((await server({}).json('/signal', post({ ...HOME }))).status, 200);
});

test('GET / no cuenta contra ningún límite', async () => {
  const SIGNAL_LIMITER = limiter(() => false);
  const POLL_LIMITER = limiter(() => false);
  assert.equal((await server({ SIGNAL_LIMITER, POLL_LIMITER }).json('/')).status, 200);
  assert.equal(SIGNAL_LIMITER.keys.length + POLL_LIMITER.keys.length, 0);
});

// ---------- errores inesperados ----------

test('un fallo interno da 500 genérico: no filtra el mensaje ni la traza', async () => {
  const err = await handle(new Request('https://signal.test/state'), {}, { getBoard: () => ({ run: async () => { throw new Error('SECRETO: clave=abc'); } }) });
  assert.equal(err.status, 500);
  const text = await err.text();
  assert.doesNotMatch(text, /SECRETO|clave|abc|at \w+/);
  assert.equal(JSON.parse(text).code, 'internal');
});

// ---------- almacén SQL (contra una base falsa que imita a exec().toArray()) ----------

/** SQLite mínimo en memoria para comprobar el SQL que genera sql Storage: no valida el motor, sí la forma de las llamadas. */
function fakeSql() {
  const rows = new Map();
  const log = [];
  return {
    log, rows,
    exec(query, ...v) {
      log.push([query.replace(/\s+/g, ' ').trim(), v]);
      if (/^INSERT OR REPLACE/.test(query.trim())) rows.set(v[0], { id: v[0], client: v[1], token: v[2], x: v[3], y: v[4], created_at: v[5], expires_at: v[6] });
      if (/^DELETE FROM signals WHERE id/.test(query.trim())) rows.delete(v[0]);
      if (/^DELETE FROM signals WHERE expires_at/.test(query.trim())) for (const [id, r] of rows) if (r.expires_at <= v[0]) rows.delete(id);
      return { toArray: () => (/^SELECT/.test(query.trim()) ? [...rows.values()] : []) };
    }
  };
}

test('almacén SQL: crea la tabla y cumple el mismo contrato que el de memoria', () => {
  const sql = fakeSql();
  const store = createSqlStorage(sql);
  assert.match(sql.log[0][0], /^CREATE TABLE IF NOT EXISTS signals/);
  assert.match(sql.log[1][0], /^CREATE INDEX IF NOT EXISTS/);
  store.save({ id: 'a1b2', client: 'c', token: 't', x: 1, y: 2, at: 100, expiresAt: 200 });
  assert.deepEqual(store.list(), [{ id: 'a1b2', client: 'c', token: 't', x: 1, y: 2, at: 100, expiresAt: 200 }]);
  store.removeExpired(150); assert.equal(store.list().length, 1);
  store.removeExpired(200); assert.equal(store.list().length, 0);
  store.save({ id: 'a1b2', client: 'c', token: 't', x: 1, y: 2, at: 100, expiresAt: 999 });
  store.remove('a1b2'); assert.equal(store.list().length, 0);
});

test('almacén SQL: todo valor va como parámetro (?), nunca pegado dentro de la consulta', () => {
  const sql = fakeSql();
  const store = createSqlStorage(sql);
  const evil = "x'); DROP TABLE signals;--";
  store.save({ id: evil, client: evil, token: evil, x: 1, y: 2, at: 1, expiresAt: 2 });
  store.remove(evil);
  for (const [q] of sql.log) assert.doesNotMatch(q, /DROP TABLE|x'\)/, q);
});

test('el tablero funciona igual con el almacén SQL que con el de memoria', () => {
  const clock = { t: 1_800_000_000_000 };
  for (const storage of [createMemoryStorage(), createSqlStorage(fakeSql())]) {
    const board = createBoard({ storage, now: () => clock.t });
    const r = board.send({ client: 'cliente-uno', ...HOME });
    assert.equal(board.state().signals.length, 1);
    board.cancel({ id: r.id, token: r.cancelToken });
    assert.equal(board.state().signals.length, 0);
  }
});

// ---------- configuración ----------

test('wrangler.jsonc: nombre propio, Durable Object con SQLite, límites con namespace_id propios y sin registros', () => {
  const raw = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const cfg = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));
  assert.equal(cfg.name, 'days-signal');
  assert.equal(cfg.main, 'src/index.js');
  assert.deepEqual(cfg.durable_objects.bindings, [{ name: 'SIGNAL_BOARD', class_name: 'SignalBoard' }]);
  assert.deepEqual(cfg.migrations[0].new_sqlite_classes, ['SignalBoard']);
  assert.equal(cfg.vars.ALLOW_LOCAL, 'false', 'producción no acepta localhost');
  assert.equal(cfg.observability.enabled, false, 'las ubicaciones no deben llegar a ningún registro');
  const root = JSON.parse(readFileSync(new URL('../../../wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
  const ids = [...root.ratelimits, ...cfg.ratelimits].map((r) => r.namespace_id);
  assert.equal(new Set(ids).size, ids.length, 'ningún namespace_id repetido entre los dos Workers');
  for (const r of cfg.ratelimits) assert.ok([10, 60].includes(r.simple.period), 'Cloudflare solo admite 10 o 60 s');
  assert.deepEqual(cfg.ratelimits.map((r) => r.name).sort(), ['POLL_LIMITER', 'SIGNAL_LIMITER']);
  assert.notEqual(cfg.name, root.name);
});

test('index.js: no hay secretos ni coordenadas escritas, y el Durable Object expone solo `run` y `alarm`', () => {
  const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(src, /export class SignalBoard extends DurableObject/);
  assert.match(src, /idFromName\('main'\)/, 'el Durable Object ya desplegado se sigue usando');
  assert.doesNotMatch(src, /searchParams|\broom\b\s*[,)]/, 'el servidor ya no elige tablero por parámetro');
  assert.doesNotMatch(src, /SIGNAL_PEPPER\s*=|console\.log/, 'nada que registre datos');
  assert.doesNotMatch(readFileSync(new URL('../src/http.js', import.meta.url), 'utf8'), /console\./);
});
