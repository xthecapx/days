import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { alertSummary } from '../src/ui/alertCard.js';
import { peekTitle } from '../src/ui/peek.js';
import { noLocationMessage, GPS_LABELS } from '../src/ui/whatsappMenu.js';
import { incidentCardHtml } from '../src/ui/panes/incidents.js';
import { revisionHtml, formatRevisionTime } from '../src/ui/panes/history.js';
import { missingField, reportTitle } from '../src/ui/panes/report.js';
import { hoverHtml } from '../src/ui/mapInput.js';
import { $ } from '../src/core/dom.js';

const today = new Date(2026, 9, 23, 12);
const inc = (o = {}) => ({
  id: 'a', number: 8, date: '2026-10-22', dateLabel: '22 de octubre', dateConfirmed: true, timeConfirmed: true,
  category: 'Hurto', severity: 3, description: 'Algo', sector: 'Sector', pixelX: 1, pixelY: 2, confirmations: 2, ...o
});

test('alertSummary: sin incidentes', () => {
  const s = alertSummary([], today);
  assert.deepEqual([s.latest, s.days, s.preview], [null, '--', 'Sin incidentes registrados.']);
});

test('alertSummary: días con dos dígitos y singular/plural', () => {
  assert.equal(alertSummary([inc()], today).days, '01');
  assert.equal(alertSummary([inc()], today).label, 'DÍA DESDE EL ÚLTIMO INCIDENTE');
  const same = alertSummary([inc({ date: '2026-10-23' })], today);
  assert.deepEqual([same.days, same.label], ['00', 'DÍAS DESDE EL ÚLTIMO INCIDENTE']);
});

test('alertSummary: cuenta desde la fecha del hecho más reciente, no desde el reporte', () => {
  const s = alertSummary([inc({ number: 9, date: '2026-10-14' }), inc({ number: 3, date: '2026-10-21' })], today);
  assert.equal(s.latest.number, 3);
  assert.equal(s.days, '02');
});

test('peekTitle: marca los resueltos por la policía', () => {
  assert.equal(peekTitle(inc()), '#8 · 22 de octubre');
  assert.equal(peekTitle(inc({ resolvedBy: 'policia' })), '#8 · 22 de octubre · 👮 Resuelto');
  assert.equal(peekTitle(inc({ dateLabel: '' })), '#8 · 2026-10-22');
});

test('incidentCardHtml: escapa el texto del vecino', () => {
  const html = incidentCardHtml(inc({ description: '<img src=x onerror=alert(1)>', sector: '"><script>', category: '<b>' }), today);
  assert.doesNotMatch(html, /<img|<script|<b>/);
  assert.match(html, /&lt;img/);
});

test('incidentCardHtml: etiquetas de pendiente, resuelto, tranquilidad y confirmaciones', () => {
  assert.match(incidentCardHtml(inc({ dateConfirmed: false }), today), /Por confirmar/);
  assert.doesNotMatch(incidentCardHtml(inc(), today), /Por confirmar/);
  assert.match(incidentCardHtml(inc({ resolvedBy: 'policia' }), today), /Resuelto/);
  assert.match(incidentCardHtml(inc({ impactType: 'tranquilidad' }), today), /Tranquilidad/);
  assert.match(incidentCardHtml(inc(), today), /🔴 3\/5 · 1d/);
  assert.match(incidentCardHtml(inc({ confirmations: 5 }), today), /👍 5/);
});

test('revisionHtml: solo ofrece revertir si guardó foto; escapa notas', () => {
  const base = { revId: 'rev-001', action: 'CREATE', timestamp: '2026-10-23T15:00:00.000Z', note: '<x>' };
  assert.doesNotMatch(revisionHtml(base), /Revertir/);
  assert.match(revisionHtml({ ...base, previousIncidentsSnapshot: [] }), /Revertir/);
  assert.doesNotMatch(revisionHtml(base), /<x>/);
  assert.equal(formatRevisionTime('no es fecha'), 'no es fecha');
});

test('missingField y reportTitle', () => {
  assert.equal(missingField({ description: '  ', date: '2026-10-22' }), 'repDescription');
  assert.equal(missingField({ description: 'x', date: '' }), 'repDate');
  assert.equal(missingField({ description: 'x', date: '2026-10-22' }), null);
  assert.equal(reportTitle({ editingId: 'a', number: 4 }), '✏️ Editar incidente #4');
  assert.equal(reportTitle({ editingId: null }), '➕ Reportar evento anónimo');
  assert.equal(reportTitle(null), '➕ Reportar evento anónimo');
});

test('hoverHtml: usa clases (sin estilos en línea) y escapa', () => {
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

test('noLocationMessage y GPS_LABELS cubren todos los estados', () => {
  assert.match(noLocationMessage('denied'), /permiso de ubicación denegado/);
  assert.match(noLocationMessage('timeout'), /sin señal GPS/);
  for (const s of ['ok', 'searching', 'stale', 'denied', 'unavailable']) assert.ok(GPS_LABELS[s], s);
});

test('$ falla con el nombre del id que falta', () => {
  globalThis.document = { getElementById: () => null };
  assert.throws(() => $('btnNoExiste'), /#btnNoExiste/);
  delete globalThis.document;
});

// ---------- HTML y código tienen que seguir sincronizados ----------

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

test('cada $("id") del código existe en index.html', () => {
  const missing = [];
  for (const file of walk('src').filter((f) => f.endsWith('.js'))) {
    for (const m of readFileSync(file, 'utf8').matchAll(/\$\('([A-Za-z0-9_]+)'\)/g)) {
      if (!htmlIds.has(m[1])) missing.push(`${file}: #${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('los ids de index.html no se repiten', () => {
  const all = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(all.length, new Set(all).size);
});

test('la hoja y el HUD usan paneles con los ids que espera sheet.js', () => {
  for (const id of ['paneIncidents', 'paneHistory', 'paneSettings', 'paneReport', 'sheetTabs', 'sheetTitle']) {
    assert.ok(htmlIds.has(id), id);
  }
});
