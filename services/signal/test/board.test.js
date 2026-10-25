import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoard, BoardError, DEFAULTS, parseCoordinate, safeEqual } from '../src/board.js';
import { createMemoryStorage } from '../src/memoryStorage.js';
import { GEO_BOUNDS } from '../../../src/core/geo.js';
import { gpsToPixel, pixelToGps } from '../../../src/map/gpsGrid.js';

const MIN = 60_000;
const HOME = { lat: 7.005, lng: -73.064 }; // inside the map

/** Board with a manual clock and predictable ids. */
function setup(config) {
  const clock = { t: 1_800_000_000_000 };
  let n = 0;
  const storage = createMemoryStorage();
  const board = createBoard({
    storage, config,
    now: () => clock.t,
    newId: () => `sig${++n}`.padEnd(8, '0'),
    newToken: () => `token-${n}-secreto`
  });
  return { board, storage, clock, advance: (ms) => { clock.t += ms; } };
}
const send = (board, client = 'cliente-uno', where = HOME) => board.send({ client, ...where });
const rejects = (fn, status, code) => assert.throws(fn, (e) => e instanceof BoardError && e.status === status && e.code === code, `expected ${status} ${code}`);

// ---------- creating signals ----------

test('send: stores the map tile and returns token and expiry', () => {
  const { board, clock } = setup();
  const r = send(board);
  const tile = gpsToPixel(HOME.lat, HOME.lng);
  assert.deepEqual([r.x, r.y], [tile.pixelX, tile.pixelY]);
  assert.equal(r.at, clock.t);
  assert.equal(r.expiresAt, clock.t + DEFAULTS.signalTtlMs);
  assert.ok(r.cancelToken.length >= 8);
  assert.equal(board.state().signals.length, 1);
});

test('privacy: neither the state nor the polls reveal exact coordinates, client or token', () => {
  const { board } = setup();
  const r = send(board, 'cliente-secreto-123');
  const everything = JSON.stringify([board.state(), board.poll({ listener: 'oyente-abc123', listening: true }), r.x]);
  assert.doesNotMatch(everything, /cliente-secreto-123/, 'the client does not leak');
  assert.doesNotMatch(everything, new RegExp(r.cancelToken), 'only the sender receives the token');
  assert.doesNotMatch(everything, /7\.005|-73\.064|lat|lng|accuracy|client|token/i, 'no exact coordinates or internal fields');
  assert.deepEqual(Object.keys(board.state().signals[0]).sort(), ['at', 'expiresAt', 'id', 'x', 'y']);
});

test('send: stores the tile (~14 m), not the point: two points near a tile centre give the same tile', () => {
  const { board } = setup();
  const centre = pixelToGps(92, 120); // exact centre of a tile
  const near = (d) => ({ lat: centre.lat + d, lng: centre.lng + d });
  const a = send(board, 'cliente-aaaa', near(0.00001)); // ~1 m
  const b = send(board, 'cliente-bbbb', near(-0.00001));
  assert.deepEqual([a.x, a.y], [92, 120]);
  assert.deepEqual([b.x, b.y], [92, 120]);
  const far = send(board, 'cliente-cccc', near(0.0003)); // ~30 m: another tile
  assert.notDeepEqual([far.x, far.y], [92, 120]);
});

test('send: accepts numbers as text and with a decimal comma (how an iPhone Shortcut in Spanish sends them)', () => {
  const { board } = setup();
  const r = board.send({ client: 'cliente-uno', lat: '7,005', lng: '-73,064' });
  const tile = gpsToPixel(7.005, -73.064);
  assert.deepEqual([r.x, r.y], [tile.pixelX, tile.pixelY]);
  assert.equal(parseCoordinate('7.005'), 7.005);
  assert.equal(parseCoordinate(' -73,0640 '), -73.064);
  for (const bad of ['', 'abc', '7,0,5', '1e3', null, undefined, NaN, Infinity, {}, [], '7.0.5', '--7']) assert.ok(Number.isNaN(parseCoordinate(bad)), String(bad));
});

test('geofence: only locations inside the map area are accepted', () => {
  const { board } = setup();
  const { north, south, west, east } = GEO_BOUNDS;
  for (const where of [
    { lat: north + 0.01, lng: -73.064 }, { lat: south - 0.01, lng: -73.064 },
    { lat: 7.005, lng: west - 0.01 }, { lat: 7.005, lng: east + 0.01 }, { lat: 4.6, lng: -74.07 } /* Bogotá */
  ]) rejects(() => send(board, 'cliente-uno', where), 422, 'outside_area');
  assert.equal(board.state().signals.length, 0);
});

test('impossible or missing coordinates are rejected with 400', () => {
  const { board } = setup();
  for (const where of [{ lat: 91, lng: 0 }, { lat: 7, lng: 181 }, { lat: 'x', lng: 1 }, {}, { lat: null, lng: null }]) rejects(() => send(board, 'cliente-uno', where), 400, 'bad_coordinates');
});

test('the client identifier is required and well-formed', () => {
  const { board } = setup();
  for (const client of [undefined, '', 'corto', 'con espacios aqui', 'x'.repeat(200), 42, {}]) rejects(() => board.send({ client, ...HOME }), 400, 'bad_client');
});

// ---------- one per person, cap, expiry ----------

test('a single signal per client: the new one replaces the previous one', () => {
  const { board, advance } = setup();
  const first = send(board, 'cliente-uno', HOME);
  advance(MIN);
  const second = send(board, 'cliente-uno', { lat: 7.0100, lng: -73.0600 });
  const { signals } = board.state();
  assert.equal(signals.length, 1);
  assert.equal(signals[0].id, second.id);
  assert.notEqual(first.id, second.id);
});

test('different people can have signals at the same time, most recent first', () => {
  const { board, advance } = setup();
  const a = send(board, 'cliente-aaaa');
  advance(MIN);
  const b = send(board, 'cliente-bbbb');
  assert.deepEqual(board.state().signals.map((s) => s.id), [b.id, a.id]);
});

test('cap on active signals: when full the oldest drops and the new one is never rejected', () => {
  const { board, advance } = setup({ maxSignals: 3 });
  const ids = [];
  for (let i = 0; i < 5; i++) { ids.push(send(board, `cliente-${i}-xxxx`).id); advance(1000); }
  const active = board.state().signals.map((s) => s.id);
  assert.equal(active.length, 3);
  assert.deepEqual(active, [ids[4], ids[3], ids[2]]);
});

test('expiry: a signal disappears at exactly 30 minutes', () => {
  const { board, advance } = setup();
  send(board);
  advance(DEFAULTS.signalTtlMs - 1);
  assert.equal(board.state().signals.length, 1);
  advance(1);
  assert.equal(board.state().signals.length, 0);
});

test('nextExpiry: says when the first one expires (to schedule cleanup) or null', () => {
  const { board, advance, clock } = setup();
  assert.equal(board.nextExpiry(), null);
  const a = send(board, 'cliente-aaaa');
  advance(5 * MIN);
  send(board, 'cliente-bbbb');
  assert.equal(board.nextExpiry(), a.expiresAt);
  clock.t = a.expiresAt;
  assert.ok(board.nextExpiry() > a.expiresAt);
});

// ---------- cancelling ----------

test('cancel: with the correct token the signal is removed', () => {
  const { board } = setup();
  const r = send(board);
  const after = board.cancel({ id: r.id, token: r.cancelToken });
  assert.equal(after.signals.length, 0);
});

test('cancel: wrong token = 403 and the signal stays; nonexistent signal = 404; malformed data = 400', () => {
  const { board } = setup();
  const r = send(board);
  rejects(() => board.cancel({ id: r.id, token: 'token-equivocado-xx' }), 403, 'bad_token');
  rejects(() => board.cancel({ id: r.id, token: r.cancelToken.slice(0, -1) }), 403, 'bad_token');
  assert.equal(board.state().signals.length, 1);
  rejects(() => board.cancel({ id: 'noexiste1', token: 'lo-que-sea-aqui' }), 404, 'not_found');
  for (const bad of [{}, { id: r.id }, { token: 'x' }, { id: '', token: '' }, { id: 5, token: 5 }, { id: 'a b', token: 'x' }]) rejects(() => board.cancel(bad), 400, 'bad_cancel');
  assert.equal(board.state().signals.length, 1);
});

test('cancel: an already expired signal gives 404, not 403', () => {
  const { board, advance } = setup();
  const r = send(board);
  advance(DEFAULTS.signalTtlMs);
  rejects(() => board.cancel({ id: r.id, token: r.cancelToken }), 404, 'not_found');
});

test('safeEqual compares correctly and does not accept odd types', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual('abc', 5), false);
  assert.equal(safeEqual(undefined, undefined), false);
});

// ---------- listeners ----------

test('state() does NOT register anyone as a listener (opening the page only reads)', () => {
  const { board } = setup();
  board.state(); board.state();
  assert.equal(board.state().listeners, 0);
});

test('poll with listening:true counts the person only once, even if they poll many times', () => {
  const { board, advance } = setup();
  for (let i = 0; i < 5; i++) { board.poll({ listener: 'oyente-abc123', listening: true }); advance(30_000); }
  assert.equal(board.state().listeners, 1);
  board.poll({ listener: 'oyente-def456', listening: true });
  assert.equal(board.state().listeners, 2);
});

test('poll returns the full state (signals and how many are listening)', () => {
  const { board } = setup();
  send(board);
  const r = board.poll({ listener: 'oyente-abc123', listening: true });
  assert.equal(r.signals.length, 1);
  assert.equal(r.listeners, 1);
  assert.equal(typeof r.now, 'number');
});

test('a listener stops counting after 75 s without polling, and polling every 30 s keeps them', () => {
  const { board, advance } = setup();
  board.poll({ listener: 'oyente-abc123', listening: true });
  advance(DEFAULTS.listenerTtlMs - 1);
  assert.equal(board.state().listeners, 1);
  advance(1);
  assert.equal(board.state().listeners, 0);
  board.poll({ listener: 'oyente-abc123', listening: true });
  advance(30_000);
  board.poll({ listener: 'oyente-abc123', listening: true });
  advance(30_000);
  assert.equal(board.state().listeners, 1);
});

test('poll with listening:false removes the listener immediately', () => {
  const { board } = setup();
  board.poll({ listener: 'oyente-abc123', listening: true });
  assert.equal(board.poll({ listener: 'oyente-abc123', listening: false }).listeners, 0);
  assert.equal(board.poll({ listener: 'nunca-estuvo-1', listening: false }).listeners, 0, 'leaving without having joined does not fail');
});

test('listener cap: new ones do not get in, but those already in keep counting', () => {
  const { board } = setup({ maxListeners: 2 });
  board.poll({ listener: 'oyente-0000a', listening: true });
  board.poll({ listener: 'oyente-0000b', listening: true });
  board.poll({ listener: 'oyente-0000c', listening: true });
  assert.equal(board.state().listeners, 2);
  assert.equal(board.poll({ listener: 'oyente-0000a', listening: true }).listeners, 2, 'renewing an existing one works');
});

test('poll validates the identifier and the boolean', () => {
  const { board } = setup();
  for (const listener of [undefined, '', 'corto', 'con espacios aqui', 'x'.repeat(100), 7]) rejects(() => board.poll({ listener, listening: true }), 400, 'bad_listener');
  for (const listening of [undefined, 'true', 1, null]) rejects(() => board.poll({ listener: 'oyente-abc123', listening }), 400, 'bad_listening');
  assert.throws(() => board.poll(), BoardError);
});

// ---------- the storage is interchangeable ----------

test('the board keeps no references to the storage: modifying what is returned does not alter what is stored', () => {
  const { board, storage } = setup();
  const r = send(board);
  const s = board.state();
  s.signals[0].x = 9999;
  assert.notEqual(storage.list()[0].x, 9999);
  assert.equal(board.state().signals[0].x, r.x);
});

test('the listener memory does not survive a restart, the signals do (they live in the storage)', () => {
  const { board, storage, clock } = setup();
  send(board);
  board.poll({ listener: 'oyente-abc123', listening: true });
  const restarted = createBoard({ storage, now: () => clock.t });
  assert.equal(restarted.state().signals.length, 1, 'the signal remains');
  assert.equal(restarted.state().listeners, 0, 'the count is rebuilt with the next poll (≤30 s)');
});

test('the server imports the map bounds from the shared code, not copies', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/board.js', import.meta.url), 'utf8');
  assert.match(src, /from '\.\.\/\.\.\/\.\.\/src\/map\/gpsGrid\.js'/);
  assert.doesNotMatch(src, /6\.995|7\.02\b|-73\.076|-73\.05\b/, 'no hand-written bounds');
});
