import test from 'node:test';
import assert from 'node:assert/strict';
import { createGps } from '../src/services/gps.js';

const pos = (lat = 7.005, lng = -73.064, accuracy = 12.4) => ({ coords: { latitude: lat, longitude: lng, accuracy } });

/** Fake geolocation: each call stays pending until the test resolves it. */
function rig(overrides = {}) {
  const calls = [];
  const geolocation = { getCurrentPosition: (ok, fail, opts) => calls.push({ ok, fail, opts }) };
  const clock = { t: 1_000_000 };
  const gps = createGps({ geolocation, now: () => clock.t, ...overrides });
  return { gps, calls, clock };
}

test('nothing is requested until read() is called (no read when the service is created)', () => {
  const { calls } = rig();
  assert.equal(calls.length, 0);
});

test('read: one request to the phone; the position is rounded and returned', async () => {
  const { gps, calls } = rig();
  const read = gps.read();
  assert.equal(calls.length, 1);
  calls[0].ok(pos());
  const fix = await read;
  assert.deepEqual([fix.lat, fix.lng, fix.accuracy], [7.005, -73.064, 12]);
  assert.equal(gps.error(), null);
});

test('simultaneous reads share a single request to the phone', async () => {
  const { gps, calls } = rig();
  const a = gps.read();
  const b = gps.read();
  assert.equal(a, b);
  assert.equal(calls.length, 1);
  calls[0].ok(pos());
  await a;
});

test('a recent position is reused: fix() answers instantly and a second tap needs no new request', async () => {
  const { gps, calls, clock } = rig();
  assert.equal(gps.fix(), null, 'no position before the first read');
  const p = gps.read();
  calls[0].ok(pos());
  await p;
  clock.t += 119_000;
  assert.ok(gps.fix());
  assert.equal(calls.length, 1);
});

test('after 2 minutes the position expires: fix() = null and the next read asks the phone again', async () => {
  const { gps, calls, clock } = rig();
  const p = gps.read();
  calls[0].ok(pos());
  await p;
  clock.t += 120_001;
  assert.equal(gps.fix(), null);
  const again = gps.read();
  assert.equal(calls.length, 2);
  calls[1].ok(pos(7.006, -73.065));
  assert.equal((await again).lat, 7.006);
  assert.equal(gps.fix().lat, 7.006);
});

test('errors: denied, timeout and unsupported; the reason is left in error() and read() never throws', async () => {
  const denied = rig();
  const d = denied.gps.read();
  denied.calls[0].fail({ code: 1 });
  assert.equal(await d, null);
  assert.equal(denied.gps.error(), 'denied');

  const slow = rig();
  const t = slow.gps.read();
  slow.calls[0].fail({ code: 3 });
  assert.equal(await t, null);
  assert.equal(slow.gps.error(), 'timeout');

  const gone = rig();
  const g = gone.gps.read();
  gone.calls[0].fail({ code: 2 });
  assert.equal(await g, null);
  assert.equal(gone.gps.error(), 'unavailable');

  const none = createGps({ geolocation: null });
  assert.equal(await none.read(), null);
  assert.equal(none.error(), 'unavailable');
});

test('a later success clears an earlier error', async () => {
  const { gps, calls } = rig();
  const first = gps.read();
  calls[0].fail({ code: 1 });
  await first;
  assert.equal(gps.error(), 'denied');
  const second = gps.read();
  calls[1].ok(pos());
  await second;
  assert.equal(gps.error(), null);
});

test('the service has no status indicator, no subscription and no background timer: it is on-demand only', () => {
  const { gps } = rig();
  assert.deepEqual(Object.keys(gps).sort(), ['error', 'fix', 'read']);
});
