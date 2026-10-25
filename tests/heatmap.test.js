import test from 'node:test';
import assert from 'node:assert/strict';
import { computePixelHeatmap, getTemporalWeight } from '../src/map/heatmapEngine.js';
import { getHeatPixelColor } from '../src/map/render/heat.js';
import { isTranquilityIncident } from '../src/domain/incident.js';
import { GRID_WIDTH } from '../src/map/gpsGrid.js';

const NOW = new Date(2026, 9, 23, 12);
const inc = (o) => ({ id: 'x', number: 1, date: '2026-10-22', severity: 4, pixelX: 50, pixelY: 60, category: 'Hurto', description: 'd', ...o });
const cellAt = (h, x, y) => h.grid[y * GRID_WIDTH + x];

test('heatmap: the centre is the epicentre and heat decays with distance', () => {
  const h = computePixelHeatmap([inc()], { now: NOW });
  const center = cellAt(h, 50, 60);
  assert.equal(center.isCenter, true);
  assert.ok(center.heat > cellAt(h, 52, 60).heat);
  assert.equal(cellAt(h, 80, 80).heat, 0);
  assert.ok(h.affectedPixelsCount > 0);
});

test('heatmap: a tranquility incident adds no red heat', () => {
  const h = computePixelHeatmap([inc({ impactType: 'tranquilidad' })], { now: NOW });
  const c = cellAt(h, 50, 60);
  assert.equal(c.heat, 0);
  assert.ok(c.tranquilityHeat > 0);
  assert.equal(c.isTranquilityCenter, true);
});

test('heatmap: an incident outside the grid is ignored; no incidents = 0 pixels', () => {
  assert.equal(computePixelHeatmap([inc({ pixelX: 999 })], { now: NOW }).affectedPixelsCount, 0);
  assert.equal(computePixelHeatmap([], { now: NOW }).affectedPixelsCount, 0);
});

test('heatmap: older = less heat in current mode, the same in historical', () => {
  const fresh = cellAt(computePixelHeatmap([inc({ date: '2026-10-22' })], { now: NOW }), 50, 60).heat;
  const old = cellAt(computePixelHeatmap([inc({ date: '2026-08-01' })], { now: NOW }), 50, 60).heat;
  const oldHist = cellAt(computePixelHeatmap([inc({ date: '2026-08-01' })], { now: NOW, decayMode: 'historico' }), 50, 60).heat;
  assert.ok(old < fresh);
  assert.equal(oldHist, computePixelHeatmap([inc({ date: '2026-10-22' })], { now: NOW, decayMode: 'historico' }).grid[60 * GRID_WIDTH + 50].heat);
});

test('heatmap: the preview is not listed as an incident of the cell', () => {
  const h = computePixelHeatmap([], { now: NOW, previewIncident: inc({ id: 'preview-inc' }) });
  const c = cellAt(h, 50, 60);
  assert.equal(c.isPreview, true);
  assert.equal(c.incidents.length, 0);
});

test('isTranquilityIncident and getTemporalWeight', () => {
  assert.equal(isTranquilityIncident({ impactType: 'tranquilidad' }), true);
  assert.equal(isTranquilityIncident({ category: 'Ruido Excesivo / Convivencia' }), true);
  assert.equal(isTranquilityIncident({ category: 'Hurto a Residencia' }), false);
  assert.equal(getTemporalWeight(1), 1);
  assert.ok(getTemporalWeight(100) < getTemporalWeight(10));
  assert.equal(getTemporalWeight(500, 'historico'), 1);
});

test('getHeatPixelColor: epicentre, safety scale, tranquility and empty cell', () => {
  const cell = (o) => ({ heat: 0, tranquilityHeat: 0, maxFreshness: 1, isCenter: false, isTranquilityCenter: false, ...o });
  assert.equal(getHeatPixelColor(null), null);
  assert.equal(getHeatPixelColor(cell({})), null);
  assert.equal(getHeatPixelColor(cell({ heat: 1, isCenter: true })).level, 'EPICENTRO');
  assert.equal(getHeatPixelColor(cell({ heat: 0.7 })).level, 'ALTO');
  assert.equal(getHeatPixelColor(cell({ heat: 0.4 })).level, 'MEDIO');
  assert.equal(getHeatPixelColor(cell({ heat: 0.1 })).level, 'PERIFERIA');
  assert.match(getHeatPixelColor(cell({ tranquilityHeat: 0.5, isTranquilityCenter: true })).level, /TRANQUILIDAD/);
  // older is more orange than recent
  assert.notEqual(getHeatPixelColor(cell({ heat: 0.4, maxFreshness: 1 })).fill, getHeatPixelColor(cell({ heat: 0.4, maxFreshness: 0.5 })).fill);
});
