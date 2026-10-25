import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeIncident, applyChange } from '../worker/github-wiki-bridge.js';

const valid = () => ({
  date: '2026-10-22', time: '20:45', dateLabel: '22 de octubre', dateConfirmed: true, timeConfirmed: true,
  impactType: 'seguridad', category: 'Hurto a Residencia', severity: 3, pixelX: 90, pixelY: 120,
  lat: 7.005, lng: -73.064, sector: 'Sector', description: 'Algo pasó', resolvedBy: 'policia'
});

test('sanitizeIncident: accepts a valid one and drops made-up fields', () => {
  const out = sanitizeIncident({ ...valid(), isAdmin: true, __proto__x: 1 });
  assert.equal(out.description, 'Algo pasó');
  assert.equal('isAdmin' in out, false);
  assert.equal(out.resolvedBy, 'policia');
});

test('sanitizeIncident: rejects an empty description and an invalid date, severity and location', () => {
  for (const bad of [{ description: '  ' }, { date: '22/10/2026' }, { severity: 9 }, { pixelX: 500 }, { pixelX: 1.5 }, { lat: 50 }]) {
    assert.throws(() => sanitizeIncident({ ...valid(), ...bad }), (e) => e.status === 400);
  }
});

test('sanitizeIncident: strips control characters and trims', () => {
  const out = sanitizeIncident({ ...valid(), description: 'a\u0000b' + 'x'.repeat(600) });
  assert.equal(out.description.includes('\u0000'), false);
  assert.equal(out.description.length, 500);
});

test('applyChange create: assigns the next number', () => {
  const data = { incidents: [{ id: 'inc-001', number: 1 }, { id: 'inc-008', number: 8 }] };
  const r = applyChange(data, { type: 'create', incident: valid() });
  assert.equal(r.number, 9);
  assert.equal(data.incidents.at(-1).id, 'inc-009');
  assert.equal(data.incidents.at(-1).confirmations, 1);
});

test('applyChange edit/confirm: finds by id and fails with 404 if it does not exist', () => {
  const data = { incidents: [{ id: 'inc-001', number: 1, confirmations: 1 }] };
  applyChange(data, { type: 'confirm', id: 'inc-001' });
  assert.equal(data.incidents[0].confirmations, 2);
  assert.throws(() => applyChange(data, { type: 'confirm', id: 'nope' }), (e) => e.status === 404);
  assert.throws(() => applyChange(data, { type: 'edit', incident: { ...valid(), id: 'nope' } }), (e) => e.status === 404);
  applyChange(data, { type: 'edit', incident: { ...valid(), id: 'inc-001', description: 'nueva' } });
  assert.equal(data.incidents[0].description, 'nueva');
  assert.equal(data.incidents[0].number, 1);
});

test('applyChange: unknown or empty type = 400', () => {
  assert.throws(() => applyChange({ incidents: [] }, { type: 'drop' }), (e) => e.status === 400);
  assert.throws(() => applyChange({ incidents: [] }, null), (e) => e.status === 400);
});
