import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { alertSummary } from '../src/ui/alertCard.js';
import { peekTitle } from '../src/ui/peek.js';
import { incidentCardHtml } from '../src/ui/panes/incidents.js';
import { syncToastMs, mountSyncToast } from '../src/ui/syncToast.js';
import { createStore } from '../src/state/store.js';
import { createInitialState } from '../src/state/initialState.js';
import { missingField, reportTitle } from '../src/ui/panes/report.js';
import { hoverHtml } from '../src/ui/mapInput.js';
import { $ } from '../src/core/dom.js';

const today = new Date(2026, 9, 23, 12);
const inc = (o = {}) => ({
  id: 'a', number: 8, date: '2026-10-22', dateLabel: '22 de octubre', dateConfirmed: true, timeConfirmed: true,
  category: 'Hurto', severity: 3, description: 'Algo', sector: 'Sector', pixelX: 1, pixelY: 2, confirmations: 2, ...o
});

test('alertSummary: no incidents', () => {
  const s = alertSummary([], today);
  assert.deepEqual([s.latest, s.days, s.preview], [null, '--', 'Sin incidentes registrados.']);
});

test('alertSummary: days with two digits and singular/plural', () => {
  assert.equal(alertSummary([inc()], today).days, '01');
  assert.equal(alertSummary([inc()], today).label, 'DÍA DESDE EL ÚLTIMO INCIDENTE');
  const same = alertSummary([inc({ date: '2026-10-23' })], today);
  assert.deepEqual([same.days, same.label], ['00', 'DÍAS DESDE EL ÚLTIMO INCIDENTE']);
});

test('alertSummary: counts from the most recent incident date, not from the report', () => {
  const s = alertSummary([inc({ number: 9, date: '2026-10-14' }), inc({ number: 3, date: '2026-10-21' })], today);
  assert.equal(s.latest.number, 3);
  assert.equal(s.days, '02');
});

test('peekTitle: marks the ones resolved by the police', () => {
  assert.equal(peekTitle(inc()), '#8 · 22 de octubre');
  assert.equal(peekTitle(inc({ resolvedBy: 'policia' })), '#8 · 22 de octubre · 👮 Resuelto');
  assert.equal(peekTitle(inc({ dateLabel: '' })), '#8 · 2026-10-22');
});

test('incidentCardHtml: escapes the neighbour\'s text', () => {
  const html = incidentCardHtml(inc({ description: '<img src=x onerror=alert(1)>', sector: '"><script>', category: '<b>' }), today);
  assert.doesNotMatch(html, /<img|<script|<b>/);
  assert.match(html, /&lt;img/);
});

test('incidentCardHtml: labels for pending, resolved, tranquility and confirmations', () => {
  assert.match(incidentCardHtml(inc({ dateConfirmed: false }), today), /Por confirmar/);
  assert.doesNotMatch(incidentCardHtml(inc(), today), /Por confirmar/);
  assert.match(incidentCardHtml(inc({ resolvedBy: 'policia' }), today), /Resuelto/);
  assert.match(incidentCardHtml(inc({ impactType: 'tranquilidad' }), today), /Tranquilidad/);
  assert.match(incidentCardHtml(inc(), today), /🔴 3\/5 · 1d/);
  assert.match(incidentCardHtml(inc({ confirmations: 5 }), today), /👍 5/);
});

test('missingField: asks for the description and then "when"; reportTitle depends on create vs edit', () => {
  assert.equal(missingField({ description: '  ', date: '2026-10-22' }), 'repDescription');
  assert.equal(missingField({ description: 'x', date: '' }), 'repWhen');
  assert.equal(missingField({ description: 'x', date: '2026-10-22' }), null);
  assert.equal(reportTitle({ editingId: 'a', number: 4 }), '✏️ Editar incidente #4');
  assert.equal(reportTitle({ editingId: null }), '➕ Reportar evento anónimo');
  assert.equal(reportTitle(null), '➕ Reportar evento anónimo');
});

test('hoverHtml: uses classes (no inline styles) and escapes', () => {
  const cell = { incidents: [
    { number: 1, dateLabel: '<d>', description: '<i>', distance: 0, impactType: 'seguridad' },
    { number: 2, dateLabel: 'x', description: 'y', distance: 2.5, impactType: 'tranquilidad' }
  ] };
  const html = hoverHtml({ x: 90, y: 120 }, cell, '<Sector>');
  assert.doesNotMatch(html, /style=/);
  assert.doesNotMatch(html, /<d>|<i>|<Sector>/);
  assert.match(html, /tip-danger/);
  assert.match(html, /tip-calm/);
  assert.match(html, /Epicentro en este píxel/);
  assert.match(html, /A 2\.5 px del punto/);
  assert.match(hoverHtml({ x: 1, y: 1 }, undefined, 's'), /tip-sector/);
});

test('$ fails with the name of the missing id', () => {
  globalThis.document = { getElementById: () => null };
  assert.throws(() => $('btnNoExiste'), /#btnNoExiste/);
  delete globalThis.document;
});

// ---------- HTML and code must stay in sync ----------

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

test('every $("id") in the code exists in index.html', () => {
  const missing = [];
  for (const file of walk('src').filter((f) => f.endsWith('.js'))) {
    for (const m of readFileSync(file, 'utf8').matchAll(/\$\('([A-Za-z0-9_]+)'\)/g)) {
      if (!htmlIds.has(m[1])) missing.push(`${file}: #${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('the ids in index.html are not repeated', () => {
  const all = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(all.length, new Set(all).size);
});

test('the sheet uses only the panes that exist (no history or tabs)', () => {
  for (const id of ['paneIncidents', 'paneSettings', 'paneReport', 'sheetTitle']) assert.ok(htmlIds.has(id), id);
  for (const gone of ['paneHistory', 'sheetTabs', 'revisionList', 'syncBadge', 'btnHistory', 'btnDownload', 'btnResetSeed', 'inpImport', 'inpToday']) {
    assert.equal(htmlIds.has(gone), false, `${gone} must no longer be in the public interface`);
  }
});

test('Public settings: only grid and alert mode', () => {
  const start = html.indexOf('id="paneSettings"');
  const pane = html.slice(start, html.indexOf('id="paneReport"', start));
  assert.ok(pane.includes('id="chkGrid"') && pane.includes('id="selDecay"'));
  assert.doesNotMatch(pane, /<input type="(file|date)"|Descargar|Importar|Restaurar|Historial/);
  assert.match(pane, /OpenStreetMap/, 'the OpenStreetMap credit must remain visible');
});

// ---------- save notice ----------

test('syncToastMs: failures last longer', () => {
  assert.ok(syncToastMs(false) > syncToastMs(true));
});

test('mountSyncToast notifies on every save, even with the same message, and does not notify at startup', () => {
  const store = createStore(createInitialState());
  const shown = [];
  mountSyncToast({ store, toast: (m, ms) => shown.push([m, ms]) });
  assert.deepEqual(shown, [], 'no initial message');
  store.patch('sync', { message: 'Enviado para revisión', ok: true });
  store.patch('sync', { message: 'Enviado para revisión', ok: true });
  store.patch('sync', { message: 'Guardado localmente (sin conexión al puente)', ok: false });
  store.patch('sync', { message: '', ok: true });
  assert.deepEqual(shown.map(([m]) => m), ['Enviado para revisión', 'Enviado para revisión', 'Guardado localmente (sin conexión al puente)']);
  assert.equal(shown[2][1], syncToastMs(false));
});
