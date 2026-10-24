import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Fija el reloj y simula el navegador para ejercitar el flujo real de guardado sin red.
const NOW = Date.UTC(2026, 9, 23, 15, 0, 0);
const sent = [];

function installBrowser() {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k)
  };
  globalThis.location = { hostname: 'vecinos.example.com' };
  globalThis.fetch = async (url, init) => {
    sent.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    return { ok: true, status: 200 };
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

test('flujo de guardado: crear, editar, confirmar y revertir', async () => {
  installBrowser();
  mock.timers.enable({ apis: ['Date'], now: NOW });
  const store = await import('../src/storage/wikiJsonStore.js');

  // CREAR
  const created = await store.saveIncidentWikiRevision(base(), input());
  const inc = created.savedIncident;
  assert.match(inc.id, /^inc-003-[0-9a-z]{3}$/);
  assert.equal(inc.number, 3);
  assert.equal(inc.sector, 'Mi sector');
  assert.equal(inc.description, 'Algo pasó');
  assert.equal(inc.dateLabel, '22 de octubre - 20:45 (Hora por confirmar)');
  assert.equal(inc.confirmations, 1);
  assert.equal(inc.resolvedBy, 'policia');
  assert.equal(inc.updatedAt, '2026-10-23T15:00:00.000Z');
  assert.equal(created.store.incidents.length, 3);
  assert.equal(created.store.lastUpdated, '2026-10-23T15:00:00.000Z');
  const rev = created.store.revisions[0];
  assert.equal(rev.revId, 'rev-001');
  assert.equal(rev.action, 'CREATE');
  assert.equal(rev.incidentId, inc.id);
  assert.match(rev.note, /^Nuevo incidente #3 en Píxel \(85, 121\) — Hurto a Residencia$/);
  assert.equal(rev.previousIncidentsSnapshot.length, 2);
  assert.equal(created.syncStatus.mode, 'pr');
  const post = sent.at(-1);
  assert.equal(post.body.change.type, 'create');
  assert.deepEqual(Object.keys(post.body.change.incident).sort(), [
    'category', 'date', 'dateConfirmed', 'dateLabel', 'description', 'id', 'impactType', 'lat', 'lng',
    'pixelX', 'pixelY', 'resolvedBy', 'sector', 'severity', 'time', 'timeConfirmed'
  ]);

  // EDITAR
  const edited = await store.saveIncidentWikiRevision(created.store, input({ description: 'Editado', severity: 2, resolvedBy: null }), inc.id);
  assert.equal(edited.savedIncident.number, 3);
  assert.equal(edited.savedIncident.description, 'Editado');
  assert.equal(edited.savedIncident.resolvedBy, null);
  assert.equal(edited.savedIncident.confirmations, 1);
  assert.equal(edited.store.revisions[0].revId, 'rev-002');
  assert.equal(edited.store.revisions[0].action, 'EDIT');
  assert.match(edited.store.revisions[0].note, /^Edición Wiki de incidente #3/);
  assert.equal(sent.at(-1).body.change.type, 'edit');

  // CONFIRMAR
  const confirmed = await store.confirmIncidentAnonymously(edited.store, 'inc-002');
  assert.equal(confirmed.store.incidents.find((i) => i.id === 'inc-002').confirmations, 3);
  assert.equal(confirmed.store.revisions[0].action, 'CONFIRM');
  assert.equal(confirmed.store.revisions[0].note, 'Confirmación vecinal anónima sumada al incidente #2');
  assert.deepEqual(sent.at(-1).body.change, { type: 'confirm', id: 'inc-002' });

  // REVERTIR (la revisión 001 deja el estado previo a crear el #3)
  const reverted = await store.revertWikiRevision(confirmed.store, 'rev-001');
  assert.equal(reverted.store.incidents.length, 2);
  assert.equal(reverted.store.revisions[0].action, 'REVERT');
  assert.equal(reverted.store.revisions[0].revId, 'rev-004');
  assert.equal(reverted.store.revisions[0].note, 'Reversión Wiki ejecutada: se deshizo rev-001');
  assert.equal(reverted.store.revisions[0].previousIncidentsSnapshot.length, 3);
  assert.equal(reverted.syncStatus.mode, 'local'); // revertir no manda nada al puente
  assert.throws && (await assert.rejects(store.revertWikiRevision(base(), 'rev-999'), /no tiene un estado previo/));

  mock.timers.reset();
});

test('el historial se corta en 40 revisiones', async () => {
  installBrowser();
  mock.timers.enable({ apis: ['Date'], now: NOW });
  const store = await import('../src/storage/wikiJsonStore.js');
  let current = base();
  for (let i = 0; i < 43; i++) {
    current = (await store.confirmIncidentAnonymously(current, 'inc-001')).store;
  }
  assert.equal(current.revisions.length, 40);
  mock.timers.reset();
});
