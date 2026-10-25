import test from 'node:test';
import assert from 'node:assert/strict';
import { toNumber } from '../src/core/dom.js';
import { incidentCardHtml } from '../src/ui/panes/incidents.js';
import { hoverHtml } from '../src/ui/mapInput.js';
import { withRetry } from '../src/map/mapData.js';
import { layoutMarkers, markerWidth, incidentAtPoint, markerScale } from '../src/map/markerLayout.js';
import { TILE_SIZE } from '../src/map/worldSize.js';

const today = new Date(2026, 9, 23, 12);
const evil = '3"><img src=x onerror=alert(1)>';
const inc = (o = {}) => ({
  id: 'a', number: 8, date: '2026-10-22', dateConfirmed: true, timeConfirmed: true, category: 'Hurto',
  severity: 3, description: 'd', sector: 's', pixelX: 1, pixelY: 2, confirmations: 2, ...o
});

// ---------- numbers that reach innerHTML ----------

test('toNumber: only lets finite numbers through', () => {
  assert.equal(toNumber('12'), 12);
  assert.equal(toNumber(evil), 0);
  assert.equal(toNumber(undefined, 5), 5);
  assert.equal(toNumber(NaN, 7), 7);
  assert.equal(toNumber(Infinity), 0);
  assert.equal(toNumber(null), 0);
});

test('incidentCardHtml: no numeric field can inject HTML', () => {
  for (const field of ['number', 'severity', 'pixelX', 'pixelY', 'confirmations']) {
    const html = incidentCardHtml(inc({ [field]: evil }), today);
    assert.doesNotMatch(html, /<img/, field);
    assert.doesNotMatch(html, /onerror/, field);
  }
});

test('incidentCardHtml: odd values fall back to reasonable values', () => {
  const html = incidentCardHtml(inc({ severity: 'x', confirmations: undefined, number: undefined }), today);
  assert.match(html, /🔴 3\/5/);
  assert.match(html, /👍 1/);
  assert.doesNotMatch(html, /NaN|undefined|null/);
  assert.match(incidentCardHtml(inc({ confirmations: 0 }), today), /👍 1/);
});

test('hoverHtml: the number and the distance cannot inject either', () => {
  const cell = { incidents: [{ number: evil, dateLabel: 'x', description: 'y', distance: evil, impactType: 'seguridad' }] };
  const html = hoverHtml({ x: 1, y: 1 }, cell, 's');
  assert.doesNotMatch(html, /<img|onerror/);
});

// ---------- retries when loading the map ----------

test('withRetry: retries and ends on the first success', async () => {
  let calls = 0;
  const waits = [];
  const out = await withRetry(async () => { if (++calls < 3) throw new Error('sin red'); return 'ok'; }, { wait: async (ms) => waits.push(ms), delayMs: 100 });
  assert.equal(out, 'ok');
  assert.equal(calls, 3);
  assert.deepEqual(waits, [100, 200], 'waits longer each time');
});

test('withRetry: after running out of attempts it throws the last error, without waiting needlessly', async () => {
  let calls = 0;
  const waits = [];
  await assert.rejects(
    withRetry(async () => { calls++; throw new Error(`fallo ${calls}`); }, { tries: 3, wait: async (ms) => waits.push(ms) }),
    /fallo 3/
  );
  assert.equal(calls, 3);
  assert.equal(waits.length, 2);
});

test('withRetry: if it works the first time it does not wait at all', async () => {
  const waits = [];
  assert.equal(await withRetry(async () => 1, { wait: async (ms) => waits.push(ms) }), 1);
  assert.deepEqual(waits, []);
});

// ---------- marker geometry (previously only checked by eye) ----------

test('layoutMarkers: a lone incident goes on top; several nearby ones spread out without overlapping', () => {
  const alone = layoutMarkers([inc({ id: 'a', pixelX: 10, pixelY: 10 })], 1);
  assert.equal(alone.get('a').dx, 0);
  const group = layoutMarkers([inc({ id: 'a', pixelX: 10, pixelY: 10 }), inc({ id: 'b', pixelX: 11, pixelY: 10 }), inc({ id: 'c', pixelX: 10, pixelY: 11 })], 1);
  const xs = ['a', 'b', 'c'].map((id) => group.get(id).dx);
  assert.equal(new Set(xs).size, 3, 'each label in its own place');
  assert.ok(Math.abs(xs.reduce((a, b) => a + b, 0)) < 1e-9, 'centred on the group');
});

test('markerWidth: grows with the digits and with the 👮', () => {
  assert.ok(markerWidth({ number: 10 }) > markerWidth({ number: 1 }));
  assert.equal(markerWidth({ number: 1, resolvedBy: 'policia' }) - markerWidth({ number: 1 }), 10);
});

test('incidentAtPoint: tapping the pixel or the label returns the incident; tapping far away returns null', () => {
  const list = [inc({ id: 'a', pixelX: 50, pixelY: 50 }), inc({ id: 'b', number: 9, pixelX: 120, pixelY: 120 })];
  const at = (id) => ({ x: (list.find((i) => i.id === id).pixelX + 0.5) * TILE_SIZE, y: (list.find((i) => i.id === id).pixelY + 0.5) * TILE_SIZE });
  assert.equal(incidentAtPoint(list, at('a'), 2).id, 'a');
  assert.equal(incidentAtPoint(list, at('b'), 2).id, 'b');
  const { dx, dy } = layoutMarkers(list, 2).get('a');
  assert.equal(incidentAtPoint(list, { x: at('a').x + dx, y: at('a').y + dy }, 2).id, 'a', 'the label responds too');
  assert.equal(incidentAtPoint(list, { x: 5, y: 5 }, 2), null);
  assert.equal(incidentAtPoint([], { x: 5, y: 5 }, 2), null);
});

test('incidentAtPoint: with two incidents nearby, the one closest to the finger wins', () => {
  const list = [inc({ id: 'a', pixelX: 50, pixelY: 50 }), inc({ id: 'b', number: 9, pixelX: 51, pixelY: 50 })];
  const near = (i) => ({ x: (i.pixelX + 0.5) * TILE_SIZE, y: (i.pixelY + 0.5) * TILE_SIZE });
  assert.equal(incidentAtPoint(list, near(list[1]), 2).id, 'b');
});

test('markerScale: the on-screen size holds when zooming (with limits)', () => {
  assert.equal(markerScale(1), 1);
  assert.equal(markerScale(5), 1 / 3);
  assert.equal(markerScale(0.1), 1 / 0.8);
});
