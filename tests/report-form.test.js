import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { whenChoice, dateForChoice, whenView, missingField } from '../src/ui/panes/report.js';
import { createActions } from '../src/state/actions.js';
import { createStore } from '../src/state/store.js';
import { createInitialState } from '../src/state/initialState.js';
import { CATEGORIES } from '../src/core/config.js';
import { buildIncident } from '../src/domain/incident.js';

const today = new Date(2026, 9, 24, 12); // sábado 24 de octubre de 2026
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function setup() {
  const store = createStore(createInitialState(today));
  const actions = createActions({
    store, camera: { focusTile() {}, state: { zoom: 1 } }, incidents: {}, gps: {},
    world: { home: { x: 90, y: 120 } }, sectorName: () => 'Sector X'
  });
  return { store, actions, draft: () => store.get().draft };
}

// ---------- "¿Cuándo ocurrió?" ----------

test('whenChoice: hoy, ayer, otro día o sin fecha', () => {
  assert.equal(whenChoice('2026-10-24', today), 'today');
  assert.equal(whenChoice('2026-10-23', today), 'yesterday');
  assert.equal(whenChoice('2026-10-10', today), 'other');
  assert.equal(whenChoice('2026-10-25', today), 'other', 'una fecha futura cae en "otro día"');
  assert.equal(whenChoice('', today), null);
});

test('dateForChoice: ayer cruza el fin de mes y el cambio de año', () => {
  assert.equal(dateForChoice('today', today), '2026-10-24');
  assert.equal(dateForChoice('yesterday', today), '2026-10-23');
  assert.equal(dateForChoice('yesterday', new Date(2026, 10, 1, 12)), '2026-10-31');
  assert.equal(dateForChoice('yesterday', new Date(2027, 0, 1, 12)), '2026-12-31');
  assert.equal(dateForChoice('other', today), '');
});

test('whenView: qué botón se marca y cuándo aparece el calendario', () => {
  assert.deepEqual(whenView({ date: '', pickDate: false, dateConfirmed: false }, today), { active: null, showDate: false, needsConfirm: false });
  assert.deepEqual(whenView({ date: '', pickDate: true, dateConfirmed: false }, today), { active: 'other', showDate: true, needsConfirm: false });
  assert.deepEqual(whenView({ date: '2026-10-23', pickDate: false, dateConfirmed: true }, today), { active: 'yesterday', showDate: false, needsConfirm: false });
  assert.deepEqual(whenView({ date: '2026-10-10', pickDate: false, dateConfirmed: true }, today), { active: 'other', showDate: true, needsConfirm: false });
});

test('whenView: un incidente viejo con fecha sin confirmar avisa para que la corrijan', () => {
  assert.equal(whenView({ date: '2026-10-22', pickDate: false, dateConfirmed: false }, today).needsConfirm, true);
});

// ---------- el borrador ----------

test('un reporte nuevo NO trae fecha ni hora puestas (nunca se guarda el día del reporte como el del hecho)', () => {
  const { actions, draft } = setup();
  actions.openReport();
  assert.deepEqual([draft().date, draft().time, draft().dateConfirmed, draft().timeConfirmed], ['', '', false, false]);
  assert.equal(missingField({ ...draft(), description: 'algo' }), 'repWhen');
});

test('elegir fecha u hora las confirma; vaciarlas las desconfirma', () => {
  const { actions, draft } = setup();
  actions.openReport();
  actions.patchDraft({ date: '2026-10-23' });
  assert.deepEqual([draft().date, draft().dateConfirmed], ['2026-10-23', true]);
  actions.patchDraft({ time: '20:45' });
  assert.deepEqual([draft().time, draft().timeConfirmed], ['20:45', true]);
  actions.patchDraft({ time: '' });
  assert.equal(draft().timeConfirmed, false);
  actions.patchDraft({ date: '' });
  assert.equal(draft().dateConfirmed, false);
});

test('"Otro día" deja la fecha vacía a la espera del calendario; al elegirla se apaga esa bandera', () => {
  const { actions, draft } = setup();
  actions.openReport();
  actions.patchDraft({ date: '', pickDate: true });
  assert.deepEqual([draft().date, draft().pickDate], ['', true]);
  actions.patchDraft({ date: '2026-10-10' });
  assert.deepEqual([draft().date, draft().pickDate, draft().dateConfirmed], ['2026-10-10', false, true]);
});

test('el color del mapa sale de la categoría (ya no hay botones de color)', () => {
  const { actions, draft } = setup();
  actions.openReport();
  for (const c of CATEGORIES) {
    actions.patchDraft({ category: c.value });
    assert.equal(draft().impactType, c.impact, c.value);
  }
  assert.equal(CATEGORIES.some((c) => c.impact === 'tranquilidad'), true);
  for (const gone of ['repImpact', 'repDateOk', 'repTimeOk', 'repGps', 'repPixel']) assert.equal(html.includes(`id="${gone}"`), false, gone);
});

test('editar: conserva lo guardado y el sector; las 12:00 sin confirmar quedan vacías', () => {
  const { actions, draft } = setup();
  const base = { id: 'a', number: 3, pixelX: 90, pixelY: 120, category: CATEGORIES[4].value, severity: 2, description: 'd', sector: 'Mi sector' };
  actions.openReport({ incident: { ...base, date: '2026-10-20', time: '20:45', dateConfirmed: true, timeConfirmed: true } });
  assert.deepEqual([draft().date, draft().time, draft().sector, draft().impactType], ['2026-10-20', '20:45', 'Mi sector', 'tranquilidad']);
  actions.openReport({ incident: { ...base, date: '2026-10-22', time: '12:00', dateConfirmed: false, timeConfirmed: false } });
  assert.equal(draft().time, '');
  assert.equal(draft().dateConfirmed, false, 'la fecha sin confirmar sigue marcada hasta que la elijan');
  actions.openReport({ incident: { ...base, date: '2026-10-22', time: '02:30', dateConfirmed: false, timeConfirmed: false } });
  assert.equal(draft().time, '02:30', 'una hora aproximada que sí escribieron se conserva');
});

test('mover el punto en el mapa recalcula el sector', () => {
  const { actions, draft, store } = setup();
  actions.openReport();
  store.set({ mode: { type: 'pick' } });
  return actions.tapTile(10, 20, null).then(() => {
    assert.deepEqual([draft().pixelX, draft().pixelY, draft().sector], [10, 20, 'Sector X']);
  });
});

// ---------- lo que se guarda ----------

test('sin hora: la etiqueta dice "Hora por confirmar" (no "12:00 (Hora por confirmar)")', () => {
  const coords = { pixelX: 1, pixelY: 1, lat: 7, lng: -73 };
  const mk = (time, timeConfirmed) => buildIncident({ date: '2026-10-23', time, dateConfirmed: true, timeConfirmed, category: 'x', description: 'd', severity: 3 }, { coords, sector: 's', incidents: [], now: today });
  assert.equal(mk('', false).dateLabel, '23 de octubre - Hora por confirmar');
  assert.equal(mk('', false).time, '12:00', 'el Worker pide una hora válida');
  assert.equal(mk('20:45', true).dateLabel, '23 de octubre - 8:45 p. m.');
});

// ---------- el HTML ----------

test('el formulario nuevo: botones Hoy/Ayer/Otro día, descripción con tope y botón que se bloquea', () => {
  const form = html.slice(html.indexOf('id="paneReport"'), html.indexOf('</form>'));
  for (const w of ['today', 'yesterday', 'other']) assert.match(form, new RegExp(`data-when="${w}"`));
  assert.match(form, /id="repDescription"[^>]*maxlength="500"/, 'el Worker corta en 500: la caja también');
  assert.match(form, /id="btnSubmitReport"/);
  assert.match(form, /id="repDate"[^>]*class="hidden"/, 'el calendario solo aparece con "Otro día"');
  assert.match(form, /aria-labelledby="repWhenLabel"/);
  assert.equal((form.match(/<input|<select|<textarea/g) || []).length, 6, 'descripción, categoría, fecha, hora, gravedad y policía');
});
