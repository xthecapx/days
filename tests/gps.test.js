import test from 'node:test';
import assert from 'node:assert/strict';
import { createGps } from '../src/services/gps.js';
import { createWhatsApp, buildAlertMessage } from '../src/services/whatsapp.js';

const pos = (lat = 7.005, lng = -73.064, accuracy = 12.4) => ({ coords: { latitude: lat, longitude: lng, accuracy } });

/** Geolocalización falsa: cada llamada queda pendiente hasta que el test la resuelve. */
function rig(overrides = {}) {
  const calls = [];
  const geolocation = { getCurrentPosition: (ok, fail, opts) => calls.push({ ok, fail, opts }) };
  const clock = { t: 1_000_000 };
  const timers = [];
  const gps = createGps({
    geolocation,
    now: () => clock.t,
    setTimer: (fn, ms) => (timers.push({ fn, ms }), timers.length),
    clearTimer: () => {},
    ...overrides
  });
  return { gps, calls, clock, timers };
}

test('start: una sola lectura y el estado pasa de searching a ok', async () => {
  const { gps, calls } = rig();
  const seen = [];
  gps.subscribe((s) => seen.push(s));
  const read = gps.start();
  assert.equal(calls.length, 1);
  assert.equal(gps.status(), 'searching');
  calls[0].ok(pos());
  const fix = await read;
  assert.deepEqual([fix.lat, fix.lng, fix.accuracy], [7.005, -73.064, 12]);
  assert.equal(gps.status(), 'ok');
  assert.deepEqual(seen, ['searching', 'searching', 'ok']);
});

test('lecturas simultáneas comparten una sola petición al teléfono', async () => {
  const { gps, calls } = rig();
  const a = gps.read();
  const b = gps.read();
  assert.equal(a, b);
  assert.equal(calls.length, 1);
  calls[0].ok(pos());
  await a;
});

test('posición reciente: fix() responde al instante y ensureFresh() no vuelve a leer', async () => {
  const { gps, calls, clock } = rig();
  const p = gps.read();
  calls[0].ok(pos());
  await p;
  clock.t += 119_000;
  assert.ok(gps.fix());
  gps.ensureFresh();
  assert.equal(calls.length, 1, 'no hay lectura nueva antes de 2 minutos');
});

test('a los 2 minutos vence: estado stale, fix() = null y ensureFresh() relee UNA vez', async () => {
  const { gps, calls, clock } = rig();
  const p = gps.read();
  calls[0].ok(pos());
  await p;
  clock.t += 120_001;
  assert.equal(gps.fix(), null);
  assert.equal(gps.status(), 'stale');
  gps.ensureFresh();
  gps.ensureFresh();
  assert.equal(calls.length, 2);
  calls[1].ok(pos(7.006, -73.065));
  await gps.read();
  assert.equal(gps.status(), 'ok');
  assert.equal(gps.fix().lat, 7.006);
});

test('el temporizador solo repinta el indicador, no lee el GPS', async () => {
  const { gps, calls, clock, timers } = rig();
  const seen = [];
  gps.subscribe((s) => seen.push(s));
  const p = gps.read();
  calls[0].ok(pos());
  await p;
  assert.equal(timers.at(-1).ms, 120_100);
  clock.t += 121_000;
  timers.at(-1).fn();
  assert.equal(seen.at(-1), 'stale');
  assert.equal(calls.length, 1);
});

test('errores: denied, timeout y sin soporte; el motivo queda en error()', async () => {
  const denied = rig();
  const d = denied.gps.read();
  denied.calls[0].fail({ code: 1 });
  assert.equal(await d, null);
  assert.equal(denied.gps.status(), 'denied');
  assert.equal(denied.gps.error(), 'denied');

  const slow = rig();
  const t = slow.gps.read();
  slow.calls[0].fail({ code: 3 });
  assert.equal(await t, null);
  assert.equal(slow.gps.error(), 'timeout');
  assert.equal(slow.gps.status(), 'stale', 'sin posición previa un timeout queda pendiente: se reintenta al usarla');

  const none = createGps({ geolocation: null });
  assert.equal(await none.read(), null);
  assert.equal(none.status(), 'unavailable');
});

test('un fallo posterior conserva la última posición como stale', async () => {
  const { gps, calls, clock } = rig();
  const p = gps.read();
  calls[0].ok(pos());
  await p;
  clock.t += 200_000;
  const again = gps.read();
  calls[1].fail({ code: 2 });
  assert.equal(await again, null);
  assert.equal(gps.error(), 'unavailable');
  assert.equal(gps.status(), 'unavailable');
});

test('subscribe devuelve la función para darse de baja', async () => {
  const { gps, calls } = rig();
  const seen = [];
  const off = gps.subscribe((s) => seen.push(s));
  off();
  const p = gps.read();
  calls[0].ok(pos());
  await p;
  assert.deepEqual(seen, ['searching']);
});

// ---------- WhatsApp ----------

test('sendAlert con posición reciente abre WhatsApp en el acto (antes de cualquier await)', () => {
  const opened = [];
  const gps = { fix: () => ({ lat: 7.005, lng: -73.064, accuracy: 10 }), read: async () => assert.fail('no debe leer'), error: () => null };
  const wa = createWhatsApp({ gps, sectorAt: () => 'Sector X', open: (u) => opened.push(u) });
  const promise = wa.sendAlert();
  // Sin `await` previo, la parte síncrona de la función async ya navegó: es lo que exige iOS Safari
  // (la navegación debe ocurrir dentro del toque, no después de esperar algo).
  assert.equal(opened.length, 1, 'abre WhatsApp antes de devolver el control');
  return promise.then((r) => {
    assert.equal(r.located, true);
    assert.equal(opened.length, 1);
    assert.match(decodeURIComponent(opened[0]), /Sector X/);
  });
});

test('sendAlert sin posición espera la lectura y abre igual, con el motivo', async () => {
  const opened = [];
  const gps = { fix: () => null, read: async () => null, error: () => 'denied' };
  const wa = createWhatsApp({ gps, open: (u) => opened.push(u) });
  const r = await wa.sendAlert();
  assert.deepEqual([r.located, r.error], [false, 'denied']);
  assert.match(decodeURIComponent(opened[0]), /No pude obtener mi ubicación/);
});

test('sendAlert: un punto fuera del mapa no agrega sector', async () => {
  const gps = { fix: () => ({ lat: 1, lng: 1 }), read: async () => null, error: () => null };
  const opened = [];
  const wa = createWhatsApp({ gps, sectorAt: () => null, open: (u) => opened.push(u) });
  await wa.sendAlert();
  assert.doesNotMatch(decodeURIComponent(opened[0]), /📌/);
});

test('sharePoint abre WhatsApp con el sector y el enlace', () => {
  const opened = [];
  const wa = createWhatsApp({ gps: {}, open: (u) => opened.push(u) });
  const { url } = wa.sharePoint({ lat: 7.0, lng: -73.06 }, 'Sector Y');
  assert.equal(url, opened[0]);
  assert.match(decodeURIComponent(url), /📍 Ubicación compartida\nSector Y\nhttps:\/\/www\.google\.com\/maps/);
});

test('buildAlertMessage: el sector va entre el enlace y la precisión', () => {
  const msg = buildAlertMessage({ lat: 7.005, lng: -73.064, accuracy: 8 }, { sector: 'Sector Z', now: new Date(2026, 9, 22, 9, 5) });
  const lines = msg.split('\n');
  assert.equal(lines[0], '🚨 NECESITO AYUDA');
  assert.match(lines[1], /^📍 https:/);
  assert.equal(lines[2], '📌 Sector Z');
  assert.match(lines[3], /^Precisión: ±8 m · /);
});
