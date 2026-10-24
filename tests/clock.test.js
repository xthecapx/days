import test from 'node:test';
import assert from 'node:assert/strict';
import { startOfDay, msUntilNextDay, startDayClock } from '../src/core/clock.js';
import { createStore } from '../src/state/store.js';
import { createInitialState } from '../src/state/initialState.js';
import { pickReferenceDate } from '../src/ui/panes/settings.js';
import { alertSummary } from '../src/ui/alertCard.js';
import { toIsoDate } from '../src/core/dom.js';

const at = (y, m, d, h = 12, min = 0, s = 0) => new Date(y, m - 1, d, h, min, s);

/** Reloj y temporizadores falsos: el test avanza el tiempo a mano. */
function rig(start = at(2026, 10, 23, 15)) {
  const state = { now: start, timers: [], listeners: [], cleared: 0, hidden: false };
  const store = createStore(createInitialState(start));
  const deps = {
    now: () => state.now,
    setTimer: (fn, ms) => (state.timers.push({ fn, ms }), state.timers.length),
    clearTimer: () => { state.cleared++; },
    doc: {
      get hidden() { return state.hidden; },
      addEventListener: (_, fn) => state.listeners.push(fn),
      removeEventListener: (_, fn) => { state.listeners = state.listeners.filter((l) => l !== fn); }
    }
  };
  return { state, store, deps, today: () => toIsoDate(store.get().settings.referenceDate) };
}

test('startOfDay fija el mediodía del día local', () => {
  const d = startOfDay(at(2026, 10, 23, 23, 59, 59));
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()], [2026, 9, 23, 12]);
});

test('msUntilNextDay: faltan horas por la tarde, 1 s mínimo, y cruza fin de mes', () => {
  assert.equal(msUntilNextDay(at(2026, 10, 23, 23, 0, 0)), 3601_000);
  assert.equal(msUntilNextDay(at(2026, 10, 23, 23, 59, 59)), 2000);
  assert.ok(msUntilNextDay(at(2026, 10, 31, 12)) > 0);
});

test('createInitialState usa la fecha real (no una fija)', () => {
  assert.equal(toIsoDate(createInitialState(at(2031, 1, 5)).settings.referenceDate), '2031-01-05');
  assert.equal(createInitialState().settings.referenceOverride, false);
});

test('el reloj pasa a mañana a medianoche y el contador sube un día', () => {
  const { state, store, deps, today } = rig(at(2026, 10, 23, 23, 30));
  const incidents = [{ id: 'a', number: 1, date: '2026-10-22' }];
  startDayClock(store, deps);
  assert.equal(state.timers.length, 1);
  assert.equal(alertSummary(incidents, store.get().settings.referenceDate).days, '01');

  state.now = at(2026, 10, 24, 0, 0, 2);
  state.timers.at(-1).fn();
  assert.equal(today(), '2026-10-24');
  assert.equal(alertSummary(incidents, store.get().settings.referenceDate).days, '02');
  assert.equal(state.timers.length, 2, 'se programa la medianoche siguiente');
});

test('pestaña en segundo plano varios días: al volver se actualiza y se reprograma', () => {
  const { state, store, deps, today } = rig(at(2026, 10, 23, 15));
  startDayClock(store, deps);
  state.now = at(2026, 10, 27, 9);
  state.hidden = true;
  state.listeners[0]();
  assert.equal(today(), '2026-10-23', 'oculta: no hace nada');
  state.hidden = false;
  state.listeners[0]();
  assert.equal(today(), '2026-10-27');
  assert.equal(state.timers.length, 2);
});

test('no repinta si el día no cambió', () => {
  const { state, store, deps } = rig(at(2026, 10, 23, 8));
  startDayClock(store, deps);
  const before = store.get().settings;
  state.now = at(2026, 10, 23, 20);
  state.timers.at(-1).fn();
  assert.equal(store.get().settings, before, 'misma referencia: ningún suscriptor se entera');
});

test('una fecha elegida a mano en Ajustes no la pisa el reloj', () => {
  const { state, store, deps, today } = rig(at(2026, 10, 23, 15));
  startDayClock(store, deps);
  store.patch('settings', pickReferenceDate('2026-11-02', state.now));
  assert.equal(today(), '2026-11-02');
  state.now = at(2026, 10, 25, 1);
  state.timers.at(-1).fn();
  assert.equal(today(), '2026-11-02');
});

test('pickReferenceDate: vacío o igual a hoy vuelve a automática', () => {
  const now = at(2026, 10, 23, 15);
  const manual = pickReferenceDate('2026-11-02', now);
  assert.deepEqual([toIsoDate(manual.referenceDate), manual.referenceOverride], ['2026-11-02', true]);
  for (const v of ['', '2026-10-23']) {
    const auto = pickReferenceDate(v, now);
    assert.deepEqual([toIsoDate(auto.referenceDate), auto.referenceOverride], ['2026-10-23', false]);
  }
});

test('stop cancela el temporizador y deja de escuchar la pestaña', () => {
  const { state, store, deps } = rig();
  const stop = startDayClock(store, deps);
  const cleared = state.cleared;
  stop();
  assert.ok(state.cleared > cleared);
  assert.equal(state.listeners.length, 0);
});
