import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSpanishDateLabel } from '../src/domain/incident.js';

test('formatSpanishDateLabel: confirmed', () => {
  assert.equal(formatSpanishDateLabel('2026-10-22', '20:45', true, true), '22 de octubre - 8:45 p. m.');
  assert.equal(formatSpanishDateLabel('2026-08-30', '09:00', true, true), '30 de agosto - 9:00 a. m.');
});

test('formatSpanishDateLabel: unconfirmed', () => {
  assert.equal(
    formatSpanishDateLabel('2026-10-22', '12:00', false, false),
    '22 de octubre (Por confirmar) - 12:00 (Hora por confirmar)'
  );
  assert.equal(formatSpanishDateLabel('', '', true, true), 'Fecha por confirmar - Hora por confirmar');
});
