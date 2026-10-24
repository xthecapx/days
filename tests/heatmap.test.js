import test from 'node:test';
import assert from 'node:assert/strict';
import { computePixelHeatmap, getTemporalWeight } from '../src/map/heatmapEngine.js';
import { isTranquilityIncident } from '../src/domain/incident.js';
import { GRID_WIDTH } from '../src/map/gpsGrid.js';

const NOW = new Date(2026, 9, 23, 12);
const inc = (o) => ({ id: 'x', number: 1, date: '2026-10-22', severity: 4, pixelX: 50, pixelY: 60, category: 'Hurto', description: 'd', ...o });
const cellAt = (h, x, y) => h.grid[y * GRID_WIDTH + x];

test('heatmap: el centro es epicentro y el calor decae con la distancia', () => {
  const h = computePixelHeatmap([inc()], { now: NOW });
  const center = cellAt(h, 50, 60);
  assert.equal(center.isCenter, true);
  assert.ok(center.heat > cellAt(h, 52, 60).heat);
  assert.equal(cellAt(h, 80, 80).heat, 0);
  assert.ok(h.affectedPixelsCount > 0);
});

test('heatmap: incidente de tranquilidad no suma calor rojo', () => {
  const h = computePixelHeatmap([inc({ impactType: 'tranquilidad' })], { now: NOW });
  const c = cellAt(h, 50, 60);
  assert.equal(c.heat, 0);
  assert.ok(c.tranquilityHeat > 0);
  assert.equal(c.isTranquilityCenter, true);
});

test('heatmap: incidente fuera de la grilla se ignora; sin incidentes = 0 píxeles', () => {
  assert.equal(computePixelHeatmap([inc({ pixelX: 999 })], { now: NOW }).affectedPixelsCount, 0);
  assert.equal(computePixelHeatmap([], { now: NOW }).affectedPixelsCount, 0);
});

test('heatmap: más antiguo = menos calor en modo actual, igual en histórico', () => {
  const fresh = cellAt(computePixelHeatmap([inc({ date: '2026-10-22' })], { now: NOW }), 50, 60).heat;
  const old = cellAt(computePixelHeatmap([inc({ date: '2026-08-01' })], { now: NOW }), 50, 60).heat;
  const oldHist = cellAt(computePixelHeatmap([inc({ date: '2026-08-01' })], { now: NOW, decayMode: 'historico' }), 50, 60).heat;
  assert.ok(old < fresh);
  assert.equal(oldHist, computePixelHeatmap([inc({ date: '2026-10-22' })], { now: NOW, decayMode: 'historico' }).grid[60 * GRID_WIDTH + 50].heat);
});

test('heatmap: la vista previa no se lista como incidente de la celda', () => {
  const h = computePixelHeatmap([], { now: NOW, previewIncident: inc({ id: 'preview-inc' }) });
  const c = cellAt(h, 50, 60);
  assert.equal(c.isPreview, true);
  assert.equal(c.incidents.length, 0);
});

test('isTranquilityIncident y getTemporalWeight', () => {
  assert.equal(isTranquilityIncident({ impactType: 'tranquilidad' }), true);
  assert.equal(isTranquilityIncident({ category: 'Ruido Excesivo / Convivencia' }), true);
  assert.equal(isTranquilityIncident({ category: 'Hurto a Residencia' }), false);
  assert.equal(getTemporalWeight(1), 1);
  assert.ok(getTemporalWeight(100) < getTemporalWeight(10));
  assert.equal(getTemporalWeight(500, 'historico'), 1);
});
