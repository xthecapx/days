import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSpanishDateLabel } from '../src/domain/incident.js';
import { buildAlertMessage, buildPointMessage, whatsappUrl, mapsLink } from '../src/services/whatsapp.js';

test('formatSpanishDateLabel: confirmada', () => {
  assert.equal(formatSpanishDateLabel('2026-10-22', '20:45', true, true), '22 de octubre - 8:45 p. m.');
  assert.equal(formatSpanishDateLabel('2026-08-30', '09:00', true, true), '30 de agosto - 9:00 a. m.');
});

test('formatSpanishDateLabel: sin confirmar', () => {
  assert.equal(
    formatSpanishDateLabel('2026-10-22', '12:00', false, false),
    '22 de octubre (Por confirmar) - 12:00 (Hora por confirmar)'
  );
  assert.equal(formatSpanishDateLabel('', '', true, true), 'Fecha por confirmar - Hora por confirmar');
});

test('whatsappUrl codifica el texto', () => {
  assert.equal(whatsappUrl('a b\nc'), 'https://wa.me/?text=a%20b%0Ac');
});

test('mapsLink usa 6 decimales', () => {
  assert.equal(
    mapsLink(7.0060321, -73.0640864),
    'https://www.google.com/maps/search/?api=1&query=7.006032%2C-73.064086'
  );
});

test('buildAlertMessage: con y sin GPS', () => {
  const withGps = buildAlertMessage({ lat: 7.0060325, lng: -73.0640861, accuracy: 12 }, new Date(2026, 9, 22, 14, 5));
  assert.match(withGps, /^🚨 NECESITO AYUDA\n📍 https:\/\/www\.google\.com\/maps/);
  assert.match(withGps, /Precisión: ±12 m/);
  const noGps = buildAlertMessage(null);
  assert.equal(noGps, '🚨 NECESITO AYUDA\n⚠️ No pude obtener mi ubicación GPS.');
});

test('buildPointMessage: con y sin sector', () => {
  const m = buildPointMessage({ lat: 7.0, lng: -73.06 }, 'Sector X');
  assert.deepEqual(m.split('\n').slice(0, 2), ['📍 Ubicación compartida', 'Sector X']);
  assert.equal(buildPointMessage({ lat: 7.0, lng: -73.06 }, '').split('\n').length, 2);
});
