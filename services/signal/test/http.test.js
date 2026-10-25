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

/** Complete in-memory server: one room per name, like Durable Objects. */
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

// ---------- routes and format ----------

test('GET / says the service is alive and what is left to configure (without revealing secrets)', async () => {
  const s = server();
  const r = await s.json('/');
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.service, r.body.pepperConfigured], ['days-signal', true]);
  assert.equal('rooms' in r.body, false, 'there are no rooms any more');
  assert.doesNotMatch(JSON.stringify(r.body), /pimienta/);
  assert.equal((await server({ SIGNAL_PEPPER: '' }).json('/')).body.pepperConfigured, false);
});

test('all responses are JSON, uncached and with nosniff', async () => {
  const s = server();
  for (const [path, opts] of [['/', {}], ['/state', {}], ['/nada', {}], ['/poll', {}], ['/signal', post({ lat: 'x', lng: 'y' })]]) {
    const r = await s.call(path, opts);
    assert.match(r.headers.get('Content-Type'), /^application\/json/, path);
    assert.equal(r.headers.get('Cache-Control'), 'no-store', path);
    assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff', path);
  }
});

test('nonexistent route = 404; wrong method = 405 with Allow; trailing slash tolerated', async () => {
  const s = server();
  assert.equal((await s.json('/nada')).status, 404);
  const wrong = await s.call('/poll');
  assert.equal(wrong.status, 405);
  assert.equal(wrong.headers.get('Allow'), 'POST');
  assert.equal((await s.call('/state', { method: 'DELETE' })).status, 405);
  assert.equal((await s.json('/state/')).status, 200);
});

// ---------- a single board (no rooms) ----------

test('there is a single board: what is sent is seen by anyone, and an old ?room=... is ignored without error', async () => {
  const s = server();
  await s.json('/signal', post({ ...HOME }));
  assert.equal((await s.json('/state')).body.signals.length, 1);
  for (const room of ['dev', 'main', 'prod', '', '../x']) {
    const r = await s.json(`/state?room=${encodeURIComponent(room)}`);
    assert.equal(r.status, 200, `room=${room}`);
    assert.equal(r.body.signals.length, 1, 'all old links see the same board');
  }
  // an old shortcut still pointing at ?room=dev sends to the real board
  await s.json('/signal?room=dev', { ...post({ ...HOME }), headers: { 'CF-Connecting-IP': '198.51.100.9' } });
  assert.equal((await s.json('/state')).body.signals.length, 2);
});

// ---------- full flow ----------

test('flow: send → view → poll as listener → cancel', async () => {
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

test('rule errors arrive with their HTTP code and a message in English', async () => {
  const s = server();
  const fuera = await s.json('/signal', post({ lat: 4.6, lng: -74.07 }));
  assert.deepEqual([fuera.status, fuera.body.code], [422, 'outside_area']);
  assert.match(fuera.body.error, /outside the map area/);
  assert.equal((await s.json('/poll', post({ listener: 'x', listening: true }))).status, 400);
  assert.equal((await s.json('/signal/cancel', post({ id: 'noexiste1', token: 'lo-que-sea-aqui' }))).status, 404);
});

// ---------- privacy and anonymous client ----------

test('the client hash never appears in a response, and the plain IP never reaches the board', async () => {
  const s = server();
  const sent = await s.json('/signal', post({ ...HOME }));
  const state = await s.json('/state');
  const everything = JSON.stringify([sent.body, state.body]);
  const hash = await clientHash(new Request('https://x', { headers: { 'CF-Connecting-IP': '203.0.113.7' } }), { SIGNAL_PEPPER: 'pimienta' });
  assert.doesNotMatch(everything, new RegExp(hash));
  assert.doesNotMatch(everything, /203\.0\.113\.7/);
  assert.doesNotMatch(JSON.stringify(s.calls), /203\.0\.113\.7/, 'the IP does not cross into the Durable Object');
});

test('the hash depends on the secret: without it the IP cannot be guessed by walking the IPv4 space', async () => {
  const req = (ip) => new Request('https://x', { headers: { 'CF-Connecting-IP': ip } });
  const a = await clientHash(req('203.0.113.7'), { SIGNAL_PEPPER: 'uno' });
  assert.notEqual(a, await clientHash(req('203.0.113.7'), { SIGNAL_PEPPER: 'otro' }));
  assert.notEqual(a, await clientHash(req('203.0.113.8'), { SIGNAL_PEPPER: 'uno' }));
  assert.equal(a, await clientHash(req('203.0.113.7'), { SIGNAL_PEPPER: 'uno' }));
  assert.match(a, /^[0-9a-f]{32}$/);
});

test('one signal per person uses the connection hash: the same IP replaces, another IP coexists', async () => {
  const s = server();
  await s.json('/signal', post({ ...HOME }));
  await s.json('/signal', post({ ...HOME }));
  assert.equal((await s.json('/state')).body.signals.length, 1);
  await s.json('/signal', { ...post({ ...HOME }), headers: { 'CF-Connecting-IP': '198.51.100.9' } });
  assert.equal((await s.json('/state')).body.signals.length, 2);
});

test('the client is never taken from the body: another person cannot be impersonated', async () => {
  const s = server();
  await s.json('/signal', post({ ...HOME, client: 'otro-cliente-123' }));
  assert.notEqual(s.calls.at(-1).input.client, 'otro-cliente-123');
  assert.deepEqual(Object.keys(s.calls.at(-1).input).sort(), ['client', 'lat', 'lng']);
});

test('only the expected fields are passed from the body', async () => {
  const s = server();
  await s.json('/poll', post({ listener: 'oyente-abc123', listening: true, extra: 'x', __proto__: { admin: true } }));
  assert.deepEqual(Object.keys(s.calls.at(-1).input).sort(), ['listener', 'listening']);
});

// ---------- body ----------

test('body: too large = 413 (by Content-Length and by actual size)', async () => {
  const s = server();
  const big = JSON.stringify({ lat: 7.005, lng: -73.064, basura: 'x'.repeat(MAX_BODY) });
  assert.equal((await s.json('/signal', { method: 'POST', raw: big, headers: { 'Content-Type': 'application/json' } })).status, 413);
  assert.equal((await s.json('/signal', { method: 'POST', raw: '{}', headers: { 'Content-Type': 'application/json', 'Content-Length': '999999' } })).status, 413);
  assert.equal(s.calls.length, 0);
});

test('body: broken JSON, non-object or unsupported type', async () => {
  const s = server();
  const json = (raw) => s.json('/signal', { method: 'POST', raw, headers: { 'Content-Type': 'application/json' } });
  for (const raw of ['{nope', 'null', '[1,2]', '"texto"', '']) assert.equal((await json(raw)).body.code, 'bad_body', JSON.stringify(raw));
  const plain = await s.json('/signal', { method: 'POST', raw: 'lat=7', headers: { 'Content-Type': 'text/plain' } });
  assert.deepEqual([plain.status, plain.body.code], [415, 'bad_content_type']);
  // Without a header, the content decides; a wrong type is still rejected.
  const none = (raw, ip) => s.json('/signal', { method: 'POST', raw, headers: { 'Content-Type': '', 'CF-Connecting-IP': ip } });
  assert.equal((await none('lat=7.005&lng=-73.064', '198.51.100.1')).status, 200, 'form without header');
  assert.equal((await none('{"lat":7.005,"lng":-73.064}', '198.51.100.2')).status, 200, 'JSON without header');
  assert.equal((await none('   {"lat":"7,005","lng":"-73,064"}', '198.51.100.3')).status, 200, 'JSON with leading spaces');
  assert.equal((await none('basura sin sentido', '198.51.100.4')).status, 400, 'without lat or lng: it reaches the board and is rejected there (bad_coordinates)');
  assert.equal((await none('', '198.51.100.5')).status, 400, 'empty body');
  assert.equal((await s.json('/signal', { method: 'POST', raw: 'lat=7', headers: { 'Content-Type': 'application/xml' } })).status, 415);
});

test('iPhone Shortcuts: a form is also accepted, with numbers as text and a decimal comma', async () => {
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

test('CORS: the GitHub Pages site can call and receives its headers', async () => {
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

test('CORS: an unknown origin is rejected (403), also on the preflight', async () => {
  const s = server();
  for (const origin of ['https://malo.example', 'https://xthecapx.github.io.malo.example', 'http://xthecapx.github.io', 'null']) {
    const r = await s.json('/state', { headers: { Origin: origin } });
    assert.deepEqual([r.status, r.body.code], [403, 'origin_not_allowed'], origin);
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), null, origin);
    assert.equal((await s.call('/signal', { method: 'OPTIONS', headers: { Origin: origin } })).status, 403, origin);
  }
  assert.equal(s.calls.length, 0);
});

test('without an Origin header (phone Shortcuts, curl) the request is served', async () => {
  const s = server();
  assert.equal((await s.json('/signal', post({ ...HOME }))).status, 200);
});

test('localhost and the local network are only allowed with ALLOW_LOCAL (development only)', () => {
  const local = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://192.168.68.54:5173', 'http://10.1.2.3:5173', 'http://172.20.0.5:5173', 'http://mi-mac.local:5173'];
  for (const o of local) {
    assert.equal(originAllowed(o, { ALLOW_LOCAL: 'false' }), false, `production rejects ${o}`);
    assert.equal(originAllowed(o, { ALLOW_LOCAL: 'true' }), true, `development accepts ${o}`);
  }
  for (const o of ['http://8.8.8.8:5173', 'http://172.32.0.1', 'https://192.168.1.1', 'http://evil.com', 'not a url']) assert.equal(originAllowed(o, { ALLOW_LOCAL: 'true' }), false, o);
  assert.equal(originAllowed(GITHUB, {}), true);
  assert.equal(originAllowed('https://otro.example', { ALLOWED_ORIGINS: 'https://otro.example, https://mas.example' }), true);
});

// ---------- rate limits ----------

function limiter(allowed) {
  const keys = [];
  return { keys, limit: async ({ key }) => { keys.push(key); return { success: allowed(keys.length) }; } };
}

test('rate limit: past the cap, 429 with Retry-After, and the board never finds out', async () => {
  const SIGNAL_LIMITER = limiter((n) => n <= 2);
  const s = server({ SIGNAL_LIMITER });
  assert.equal((await s.json('/signal', post({ ...HOME }))).status, 200);
  assert.equal((await s.json('/signal', post({ ...HOME }))).status, 200);
  const blocked = await s.json('/signal', post({ ...HOME }));
  assert.deepEqual([blocked.status, blocked.body.code], [429, 'rate_limited']);
  assert.equal(blocked.headers.get('Retry-After'), '60');
  assert.equal(s.calls.length, 2);
});

test('limits are measured by client hash, not plain IP, and by operation type', async () => {
  const SIGNAL_LIMITER = limiter(() => true);
  const POLL_LIMITER = limiter(() => true);
  const s = server({ SIGNAL_LIMITER, POLL_LIMITER });
  await s.json('/signal', post({ ...HOME }));
  await s.json('/state');
  await s.json('/poll', post({ listener: 'oyente-abc123', listening: true }));
  await s.json('/signal/cancel', post({ id: 'abcd', token: 'zzzzzzzz' }));
  assert.equal(SIGNAL_LIMITER.keys.length, 2, 'send and cancel share a limit');
  assert.equal(POLL_LIMITER.keys.length, 2, 'state and poll share a limit');
  assert.ok([...SIGNAL_LIMITER.keys, ...POLL_LIMITER.keys].every((k) => /^[0-9a-f]{32}$/.test(k)));
});

test('if the limiter fails or does not exist, a help request is NOT blocked', async () => {
  const roto = { limit: async () => { throw new Error('down'); } };
  assert.equal((await server({ SIGNAL_LIMITER: roto }).json('/signal', post({ ...HOME }))).status, 200);
  assert.equal((await server({}).json('/signal', post({ ...HOME }))).status, 200);
});

test('GET / does not count against any limit', async () => {
  const SIGNAL_LIMITER = limiter(() => false);
  const POLL_LIMITER = limiter(() => false);
  assert.equal((await server({ SIGNAL_LIMITER, POLL_LIMITER }).json('/')).status, 200);
  assert.equal(SIGNAL_LIMITER.keys.length + POLL_LIMITER.keys.length, 0);
});

// ---------- unexpected errors ----------

test('an internal failure gives a generic 500: it does not leak the message or the trace', async () => {
  const err = await handle(new Request('https://signal.test/state'), {}, { getBoard: () => ({ run: async () => { throw new Error('SECRETO: clave=abc'); } }) });
  assert.equal(err.status, 500);
  const text = await err.text();
  assert.doesNotMatch(text, /SECRETO|clave|abc|at \w+/);
  assert.equal(JSON.parse(text).code, 'internal');
});

// ---------- SQL storage (against a fake database that imitates exec().toArray()) ----------

/** Minimal in-memory SQLite to check the SQL that sql Storage generates: it does not validate the engine, only the shape of the calls. */
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

test('SQL storage: creates the table and meets the same contract as the in-memory one', () => {
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

test('SQL storage: every value goes as a parameter (?), never pasted into the query', () => {
  const sql = fakeSql();
  const store = createSqlStorage(sql);
  const evil = "x'); DROP TABLE signals;--";
  store.save({ id: evil, client: evil, token: evil, x: 1, y: 2, at: 1, expiresAt: 2 });
  store.remove(evil);
  for (const [q] of sql.log) assert.doesNotMatch(q, /DROP TABLE|x'\)/, q);
});

test('the board works the same with the SQL storage as with the in-memory one', () => {
  const clock = { t: 1_800_000_000_000 };
  for (const storage of [createMemoryStorage(), createSqlStorage(fakeSql())]) {
    const board = createBoard({ storage, now: () => clock.t });
    const r = board.send({ client: 'cliente-uno', ...HOME });
    assert.equal(board.state().signals.length, 1);
    board.cancel({ id: r.id, token: r.cancelToken });
    assert.equal(board.state().signals.length, 0);
  }
});

// ---------- configuration ----------

test('wrangler.jsonc: own name, Durable Object with SQLite, limits with own namespace_ids and Cloudflare logs enabled', () => {
  const raw = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const cfg = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));
  assert.equal(cfg.name, 'days-signal');
  assert.equal(cfg.main, 'src/index.js');
  assert.deepEqual(cfg.durable_objects.bindings, [{ name: 'SIGNAL_BOARD', class_name: 'SignalBoard' }]);
  assert.deepEqual(cfg.migrations[0].new_sqlite_classes, ['SignalBoard']);
  assert.equal(cfg.vars.ALLOW_LOCAL, 'false', 'production does not accept localhost');
  assert.deepEqual(cfg.observability, { logs: { enabled: true, invocation_logs: true } });
  const root = JSON.parse(readFileSync(new URL('../../../worker/wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
  const ids = [...root.ratelimits, ...cfg.ratelimits].map((r) => r.namespace_id);
  assert.equal(new Set(ids).size, ids.length, 'no namespace_id repeated between the two Workers');
  for (const r of cfg.ratelimits) assert.ok([10, 60].includes(r.simple.period), 'Cloudflare only supports 10 or 60 s');
  assert.deepEqual(cfg.ratelimits.map((r) => r.name).sort(), ['POLL_LIMITER', 'SIGNAL_LIMITER']);
  assert.notEqual(cfg.name, root.name);
});

test('index.js: no secrets or hard-coded coordinates, and the Durable Object exposes only `run` and `alarm`', () => {
  const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(src, /export class SignalBoard extends DurableObject/);
  assert.match(src, /idFromName\('main'\)/, 'the already-deployed Durable Object keeps being used');
  assert.doesNotMatch(src, /searchParams|\broom\b\s*[,)]/, 'the server no longer picks a board by parameter');
  assert.doesNotMatch(src, /SIGNAL_PEPPER\s*=|console\.log/, 'nothing that logs data');
  assert.doesNotMatch(readFileSync(new URL('../src/http.js', import.meta.url), 'utf8'), /console\./);
});

test('with Cloudflare logs enabled, OUR code writes nothing to them (no coordinates, no IP, no identifiers)', () => {
  for (const f of ['board.js', 'http.js', 'index.js', 'rpc.js', 'sqlStorage.js', 'memoryStorage.js']) {
    const src = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /\bconsole\s*\./, `${f} must not use console.*`);
  }
});

test('coordinates travel in the POST body, never in the URL (the URL does end up in Cloudflare logs)', async () => {
  const s = server();
  const r = await s.call('/signal?lat=7.005&lng=-73.064', { method: 'POST', body: {} });
  assert.equal(r.status, 400, 'lat/lng in the URL are not read: without a body there is no location');
  assert.equal(s.calls.length === 0 || s.calls.at(-1).input.lat === undefined, true);
  const src = readFileSync(new URL('../src/http.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /searchParams\.get\(['"](lat|lng)/);
});
