import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDaysSince, latestIncident as selectLatestIncident } from '../src/domain/incident.js';

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h);

test('calculateDaysSince: same day = 0, yesterday = 1', () => {
  assert.equal(calculateDaysSince('2026-10-22', at(2026, 10, 22)), 0);
  assert.equal(calculateDaysSince('2026-10-22', at(2026, 10, 23)), 1);
});

test('calculateDaysSince: ignores the time of day', () => {
  assert.equal(calculateDaysSince('2026-10-22', at(2026, 10, 23, 0)), 1);
  assert.equal(calculateDaysSince('2026-10-22', at(2026, 10, 23, 23)), 1);
});

test('calculateDaysSince: future date = 0, no date = 30', () => {
  assert.equal(calculateDaysSince('2026-10-30', at(2026, 10, 22)), 0);
  assert.equal(calculateDaysSince('', at(2026, 10, 22)), 30);
  assert.equal(calculateDaysSince('basura', at(2026, 10, 22)), 30);
});

test('calculateDaysSince: crosses month end', () => {
  assert.equal(calculateDaysSince('2026-09-30', at(2026, 10, 2)), 2);
});

test('selectLatestIncident: the incident date wins, not the report number', () => {
  const list = [
    { id: 'a', number: 7, date: '2026-10-14' },
    { id: 'b', number: 6, date: '2026-10-21' }
  ];
  assert.equal(selectLatestIncident(list).id, 'b');
});

test('selectLatestIncident: on a date tie the higher number wins; empty = null', () => {
  const list = [
    { id: 'a', number: 1, date: '2026-10-21' },
    { id: 'b', number: 2, date: '2026-10-21' }
  ];
  assert.equal(selectLatestIncident(list).id, 'b');
  assert.equal(selectLatestIncident([]), null);
});
