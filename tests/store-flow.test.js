import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state/store.js';
import { createInitialState } from '../src/state/initialState.js';
import { createIncidentService } from '../src/services/incidentService.js';
import { planSave, planConfirm } from '../src/domain/storePlans.js';

// Fixes the clock and simulates the browser to exercise the real save flow without a network.
const NOW = Date.UTC(2026, 9, 23, 15, 0, 0);
const sent = [];

function installBrowser({ host = 'vecinos.example.com', bridgeStatus = 200 } = {}) {
  sent.length = 0;
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k)
  };
  globalThis.location = { hostname: host };
  globalThis.fetch = async (url, init) => {
    sent.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    return { ok: bridgeStatus === 200, status: bridgeStatus };
  };
}

const base = () => ({
  incidents: [
    { id: 'inc-001', number: 1, date: '2026-08-30', time: '09:00', confirmations: 1, pixelX: 96, pixelY: 112, description: 'uno' },
    { id: 'inc-002', number: 2, date: '2026-09-14', time: '02:30', confirmations: 2, pixelX: 90, pixelY: 120, description: 'dos' }
  ]
});

const input = (o = {}) => ({
  pixelX: 85, pixelY: 121, impactType: 'seguridad', sector: ' Mi sector ', date: '2026-10-22', time: '20:45',
  dateConfirmed: true, timeConfirmed: false, resolvedBy: 'policia', category: 'Hurto a Residencia',
  severity: 4, description: '  Algo pasó  ', ...o
});

function setup(opts) {
  installBrowser(opts);
  mock.timers.enable({ apis: ['Date'], now: NOW });
  const store = createStore(createInitialState(new Date(NOW)));
  store.set({ data: base() });
  return { store, service: createIncidentService(store, { sectorName: () => 'Sector auto' }) };
}

test('save flow: create, edit and confirm', async () => {
  const { store, service } = setup();
  const data = () => store.get().data;
  const sync = () => store.get().sync;

  // CREATE
  const inc = await service.save(input());
  assert.match(inc.id, /^inc-003-[0-9a-z]{3}$/);
  assert.equal(inc.number, 3);
  assert.equal(inc.sector, 'Mi sector');
  assert.equal(inc.description, 'Algo pasó');
  assert.equal(inc.dateLabel, '22 de octubre - 20:45 (Hora por confirmar)');
  assert.equal(inc.confirmations, 1);
  assert.equal(inc.resolvedBy, 'policia');
  assert.equal(inc.updatedAt, '2026-10-23T15:00:00.000Z');
  assert.equal(data().incidents.length, 3);
  assert.equal(data().lastUpdated, '2026-10-23T15:00:00.000Z');
  assert.equal('revisions' in data(), false, 'history is no longer stored inside the JSON');
  assert.deepEqual(sync(), { message: 'Enviado para revisión (aparecerá cuando se apruebe)', ok: true });
  const post = sent.at(-1);
  assert.equal(post.body.change.type, 'create');
  assert.match(post.body.commitMessage, /^Wiki Vecinal: Nuevo incidente #3 en Píxel \(85, 121\) — Hurto a Residencia$/);
  assert.deepEqual(Object.keys(post.body.change.incident).sort(), [
    'category', 'date', 'dateConfirmed', 'dateLabel', 'description', 'id', 'impactType', 'lat', 'lng',
    'pixelX', 'pixelY', 'resolvedBy', 'sector', 'severity', 'time', 'timeConfirmed'
  ]);

  // EDIT
  const edited = await service.save(input({ description: 'Editado', severity: 2, resolvedBy: null }), inc.id);
  assert.equal(edited.number, 3);
  assert.equal(edited.description, 'Editado');
  assert.equal(edited.resolvedBy, null);
  assert.equal(edited.confirmations, 1);
  assert.equal(data().incidents.length, 3);
  assert.equal(sent.at(-1).body.change.type, 'edit');
  assert.match(sent.at(-1).body.commitMessage, /Edición de incidente #3/);

  // CONFIRM
  await service.confirm('inc-002');
  assert.equal(data().incidents.find((i) => i.id === 'inc-002').confirmations, 3);
  assert.deepEqual(sent.at(-1).body.change, { type: 'confirm', id: 'inc-002' });
  assert.match(sent.at(-1).body.commitMessage, /Confirmación vecinal anónima sumada al incidente #2/);

  mock.timers.reset();
});

test('the sync notice reflects the failure (for the toast)', async () => {
  const { store, service } = setup({ bridgeStatus: 429 });
  await service.save(input());
  assert.equal(store.get().sync.ok, false);
  assert.match(store.get().sync.message, /demasiados reportes pendientes/);
  mock.timers.reset();
});

test('moving an incident saves it as an edit with the sector of the new point', async () => {
  const { service } = setup();
  const moved = await service.move('inc-001', 100, 100);
  assert.equal([moved.pixelX, moved.pixelY].join(','), '100,100');
  assert.equal(moved.sector, 'Sector auto');
  assert.equal(sent.at(-1).body.change.type, 'edit');
  assert.equal(await service.move('nope', 1, 1), null);
  mock.timers.reset();
});

test('editing an incident that does not exist throws and neither saves nor sends anything', async () => {
  const { store, service } = setup();
  await assert.rejects(service.save(input(), 'inc-999'), /Incident inc-999 does not exist/);
  assert.equal(store.get().data.incidents.length, 2);
  assert.equal(sent.length, 0);
  mock.timers.reset();
});

test('the service no longer offers revert, import or restore', () => {
  const { service } = setup();
  for (const gone of ['revert', 'importJson', 'resetToSeed']) assert.equal(gone in service, false, gone);
  mock.timers.reset();
});

test('planSave and planConfirm are pure: they do not touch the state they receive', () => {
  const before = base();
  const snapshot = JSON.stringify(before);
  const coords = { pixelX: 85, pixelY: 121, lat: 7.0, lng: -73.06 };
  const save = planSave(before, input(), null, { coords, sector: 'S', now: new Date(NOW) });
  const confirm = planConfirm(before, 'inc-002', { now: new Date(NOW) });
  assert.equal(JSON.stringify(before), snapshot);
  assert.equal(save.nextStore.incidents.length, 3);
  assert.equal(confirm.nextStore.incidents[1].confirmations, 3);
  assert.equal('revisions' in save.nextStore, false);
});
