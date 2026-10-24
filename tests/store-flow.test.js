import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/state/store.js';
import { createInitialState } from '../src/state/initialState.js';
import { createIncidentService } from '../src/services/incidentService.js';

// Fija el reloj y simula el navegador para ejercitar el flujo real de guardado sin red.
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
  ],
  revisions: []
});

const input = (o = {}) => ({
  pixelX: 85, pixelY: 121, impactType: 'seguridad', sector: ' Mi sector ', date: '2026-10-22', time: '20:45',
  dateConfirmed: true, timeConfirmed: false, resolvedBy: 'policia', category: 'Hurto a Residencia',
  severity: 4, description: '  Algo pasó  ', ...o
});

function setup(opts) {
  installBrowser(opts);
  mock.timers.enable({ apis: ['Date'], now: NOW });
  const store = createStore(createInitialState());
  store.set({ data: base() });
  return { store, service: createIncidentService(store) };
}

test('flujo de guardado: crear, editar, confirmar y revertir', async () => {
  const { store, service } = setup();
  const data = () => store.get().data;
  const sync = () => store.get().sync.message;

  // CREAR
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
  const rev = data().revisions[0];
  assert.equal(rev.revId, 'rev-001');
  assert.equal(rev.action, 'CREATE');
  assert.equal(rev.incidentId, inc.id);
  assert.match(rev.note, /^Nuevo incidente #3 en Píxel \(85, 121\) — Hurto a Residencia$/);
  assert.equal(rev.previousIncidentsSnapshot.length, 2);
  assert.equal(sync(), 'Enviado para revisión (aparecerá cuando se apruebe)');
  const post = sent.at(-1);
  assert.equal(post.body.change.type, 'create');
  assert.deepEqual(Object.keys(post.body.change.incident).sort(), [
    'category', 'date', 'dateConfirmed', 'dateLabel', 'description', 'id', 'impactType', 'lat', 'lng',
    'pixelX', 'pixelY', 'resolvedBy', 'sector', 'severity', 'time', 'timeConfirmed'
  ]);

  // EDITAR
  const edited = await service.save(input({ description: 'Editado', severity: 2, resolvedBy: null }), inc.id);
  assert.equal(edited.number, 3);
  assert.equal(edited.description, 'Editado');
  assert.equal(edited.resolvedBy, null);
  assert.equal(edited.confirmations, 1);
  assert.equal(data().revisions[0].revId, 'rev-002');
  assert.equal(data().revisions[0].action, 'EDIT');
  assert.match(data().revisions[0].note, /^Edición Wiki de incidente #3/);
  assert.equal(sent.at(-1).body.change.type, 'edit');

  // CONFIRMAR
  await service.confirm('inc-002');
  assert.equal(data().incidents.find((i) => i.id === 'inc-002').confirmations, 3);
  assert.equal(data().revisions[0].action, 'CONFIRM');
  assert.equal(data().revisions[0].note, 'Confirmación vecinal anónima sumada al incidente #2');
  assert.deepEqual(sent.at(-1).body.change, { type: 'confirm', id: 'inc-002' });

  // REVERTIR (la revisión 001 deja el estado previo a crear el #3)
  const postsBefore = sent.length;
  await service.revert('rev-001');
  assert.equal(data().incidents.length, 2);
  assert.equal(data().revisions[0].action, 'REVERT');
  assert.equal(data().revisions[0].revId, 'rev-004');
  assert.equal(data().revisions[0].note, 'Reversión Wiki ejecutada: se deshizo rev-001');
  assert.equal(data().revisions[0].previousIncidentsSnapshot.length, 3);
  assert.equal(sent.length, postsBefore, 'revertir no manda nada al puente');
  assert.equal(sync(), 'Guardado en memoria local');

  // Revertir algo sin foto deja el aviso y no toca los datos
  await service.revert('rev-999');
  assert.match(sync(), /no tiene un estado previo/);
  assert.equal(data().incidents.length, 2);

  mock.timers.reset();
});

test('mover un incidente lo guarda como edición con el nuevo sector', async () => {
  const { store, service } = setup();
  const moved = await service.move('inc-001', 100, 100);
  assert.equal([moved.pixelX, moved.pixelY].join(','), '100,100');
  assert.equal(store.get().data.revisions[0].action, 'EDIT');
  assert.equal(await service.move('nope', 1, 1), null);
  mock.timers.reset();
});

test('editar un incidente que no existe lanza y no guarda nada', async () => {
  const { store, service } = setup();
  await assert.rejects(service.save(input(), 'inc-999'), /No existe el incidente inc-999/);
  assert.equal(store.get().data.revisions.length, 0);
  assert.equal(sent.length, 0);
  mock.timers.reset();
});

test('el historial se corta en 40 revisiones', async () => {
  const { store, service } = setup();
  for (let i = 0; i < 43; i++) await service.confirm('inc-001');
  assert.equal(store.get().data.revisions.length, 40);
  mock.timers.reset();
});
