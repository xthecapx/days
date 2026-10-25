import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { whenChoice, dateForChoice, whenView, missingField } from '../src/ui/panes/report.js';
import { createActions } from '../src/state/actions.js';
import { createStore } from '../src/state/store.js';
import { createInitialState } from '../src/state/initialState.js';
import { CATEGORIES } from '../src/core/config.js';
import { buildIncident } from '../src/domain/incident.js';

const today = new Date(2026, 9, 24, 12); // Saturday, 24 October 2026
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function setup() {
  const store = createStore(createInitialState(today));
  const actions = createActions({
    store, camera: { focusTile() {}, state: { zoom: 1 } }, incidents: {}, gps: {},
    world: { home: { x: 90, y: 120 } }, sectorName: () => 'Sector X'
  });
  return { store, actions, draft: () => store.get().draft };
}

// ---------- "When did it happen?" ----------

test('whenChoice: today, yesterday, another day or no date', () => {
  assert.equal(whenChoice('2026-10-24', today), 'today');
  assert.equal(whenChoice('2026-10-23', today), 'yesterday');
  assert.equal(whenChoice('2026-10-10', today), 'other');
  assert.equal(whenChoice('2026-10-25', today), 'other', 'a future date falls under "other day"');
  assert.equal(whenChoice('', today), null);
});

test('dateForChoice: yesterday crosses month end and the year change', () => {
  assert.equal(dateForChoice('today', today), '2026-10-24');
  assert.equal(dateForChoice('yesterday', today), '2026-10-23');
  assert.equal(dateForChoice('yesterday', new Date(2026, 10, 1, 12)), '2026-10-31');
  assert.equal(dateForChoice('yesterday', new Date(2027, 0, 1, 12)), '2026-12-31');
  assert.equal(dateForChoice('other', today), '');
});

test('whenView: which button is marked and when the calendar appears', () => {
  assert.deepEqual(whenView({ date: '', pickDate: false, dateConfirmed: false }, today), { active: null, showDate: false, needsConfirm: false });
  assert.deepEqual(whenView({ date: '', pickDate: true, dateConfirmed: false }, today), { active: 'other', showDate: true, needsConfirm: false });
  assert.deepEqual(whenView({ date: '2026-10-23', pickDate: false, dateConfirmed: true }, today), { active: 'yesterday', showDate: false, needsConfirm: false });
  assert.deepEqual(whenView({ date: '2026-10-10', pickDate: false, dateConfirmed: true }, today), { active: 'other', showDate: true, needsConfirm: false });
});

test('whenView: an old incident with an unconfirmed date warns so it gets corrected', () => {
  assert.equal(whenView({ date: '2026-10-22', pickDate: false, dateConfirmed: false }, today).needsConfirm, true);
});

// ---------- the draft ----------

test('a new report does NOT come with a date or time set (the report day is never saved as the incident day)', () => {
  const { actions, draft } = setup();
  actions.openReport();
  assert.deepEqual([draft().date, draft().time, draft().dateConfirmed, draft().timeConfirmed], ['', '', false, false]);
  assert.equal(missingField({ ...draft(), description: 'algo' }), 'repWhen');
});

test('choosing a date or time confirms it; clearing it unconfirms it', () => {
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

test('"Otro día" leaves the date empty awaiting the calendar; picking one clears that flag', () => {
  const { actions, draft } = setup();
  actions.openReport();
  actions.patchDraft({ date: '', pickDate: true });
  assert.deepEqual([draft().date, draft().pickDate], ['', true]);
  actions.patchDraft({ date: '2026-10-10' });
  assert.deepEqual([draft().date, draft().pickDate, draft().dateConfirmed], ['2026-10-10', false, true]);
});

test('the map colour comes from the category (there are no colour buttons any more)', () => {
  const { actions, draft } = setup();
  actions.openReport();
  for (const c of CATEGORIES) {
    actions.patchDraft({ category: c.value });
    assert.equal(draft().impactType, c.impact, c.value);
  }
  assert.equal(CATEGORIES.some((c) => c.impact === 'tranquilidad'), true);
  for (const gone of ['repImpact', 'repDateOk', 'repTimeOk', 'repGps', 'repPixel']) assert.equal(html.includes(`id="${gone}"`), false, gone);
});

test('editing: keeps what was saved and the sector; an unconfirmed 12:00 is left empty', () => {
  const { actions, draft } = setup();
  const base = { id: 'a', number: 3, pixelX: 90, pixelY: 120, category: CATEGORIES[4].value, severity: 2, description: 'd', sector: 'Mi sector' };
  actions.openReport({ incident: { ...base, date: '2026-10-20', time: '20:45', dateConfirmed: true, timeConfirmed: true } });
  assert.deepEqual([draft().date, draft().time, draft().sector, draft().impactType], ['2026-10-20', '20:45', 'Mi sector', 'tranquilidad']);
  actions.openReport({ incident: { ...base, date: '2026-10-22', time: '12:00', dateConfirmed: false, timeConfirmed: false } });
  assert.equal(draft().time, '');
  assert.equal(draft().dateConfirmed, false, 'the unconfirmed date stays flagged until they pick one');
  actions.openReport({ incident: { ...base, date: '2026-10-22', time: '02:30', dateConfirmed: false, timeConfirmed: false } });
  assert.equal(draft().time, '02:30', 'an approximate time that they did type is kept');
});

test('moving the point on the map recalculates the sector', () => {
  const { actions, draft, store } = setup();
  actions.openReport();
  store.set({ mode: { type: 'pick' } });
  return actions.tapTile(10, 20, null).then(() => {
    assert.deepEqual([draft().pixelX, draft().pixelY, draft().sector], [10, 20, 'Sector X']);
  });
});

// ---------- what gets saved ----------

test('no time: the label says "Hora por confirmar" (not "12:00 (Hora por confirmar)")', () => {
  const coords = { pixelX: 1, pixelY: 1, lat: 7, lng: -73 };
  const mk = (time, timeConfirmed) => buildIncident({ date: '2026-10-23', time, dateConfirmed: true, timeConfirmed, category: 'x', description: 'd', severity: 3 }, { coords, sector: 's', incidents: [], now: today });
  assert.equal(mk('', false).dateLabel, '23 de octubre - Hora por confirmar');
  assert.equal(mk('', false).time, '12:00', 'the Worker requires a valid time');
  assert.equal(mk('20:45', true).dateLabel, '23 de octubre - 8:45 p. m.');
});

// ---------- the HTML ----------

test('the new form: Hoy/Ayer/Otro día buttons, a capped description and a button that locks', () => {
  const form = html.slice(html.indexOf('id="paneReport"'), html.indexOf('</form>'));
  for (const w of ['today', 'yesterday', 'other']) assert.match(form, new RegExp(`data-when="${w}"`));
  assert.match(form, /id="repDescription"[^>]*maxlength="500"/, 'the Worker cuts at 500: so does the box');
  assert.match(form, /id="btnSubmitReport"/);
  assert.match(form, /id="repDate"[^>]*class="hidden"/, 'the calendar only appears with "Otro día"');
  assert.match(form, /aria-labelledby="repWhenLabel"/);
  assert.equal((form.match(/<input|<select|<textarea/g) || []).length, 6, 'description, category, date, time, severity and police');
});
