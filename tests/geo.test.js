import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GEO_BOUNDS, GRID_WIDTH, GRID_HEIGHT } from '../src/core/geo.js';
import * as grid from '../src/map/gpsGrid.js';
import { sanitizeIncident } from '../worker/github-wiki-bridge.js';
import { normalizeStore } from '../src/storage/normalize.js';

const valid = (o = {}) => ({
  date: '2026-10-22', time: '20:45', severity: 3, category: 'x', description: 'd',
  pixelX: 90, pixelY: 120, lat: 7.005, lng: -73.064, ...o
});

test('el mapa y el script de OpenStreetMap leen la misma geografía', () => {
  assert.equal(grid.GEO_BOUNDS, GEO_BOUNDS);
  assert.equal(grid.GRID_WIDTH, GRID_WIDTH);
  assert.equal(grid.GRID_HEIGHT, GRID_HEIGHT);
  const script = readFileSync(new URL('../scripts/update-map.mjs', import.meta.url), 'utf8');
  assert.match(script, /from '\.\.\/src\/core\/geo\.js'/);
  assert.doesNotMatch(script, /south:\s*[\d.]+/, 'el script no debe repetir los límites');
});

test('el Worker acepta el centro de CADA tile de la grilla', () => {
  // Si los límites del Worker fueran más estrictos que la grilla, un reporte legítimo se rechazaría.
  for (let y = 0; y < GRID_HEIGHT; y += 1) {
    for (let x = 0; x < GRID_WIDTH; x += 1) {
      const { lat, lng } = grid.pixelToGps(x, y);
      sanitizeIncident(valid({ pixelX: x, pixelY: y, lat, lng }));
    }
  }
});

test('el Worker rechaza fuera del área y fuera de la grilla', () => {
  for (const bad of [
    { lat: GEO_BOUNDS.north + 0.001 }, { lat: GEO_BOUNDS.south - 0.001 },
    { lng: GEO_BOUNDS.west - 0.001 }, { lng: GEO_BOUNDS.east + 0.001 },
    { pixelX: GRID_WIDTH }, { pixelY: GRID_HEIGHT }, { pixelX: -1 }
  ]) {
    assert.throws(() => sanitizeIncident(valid(bad)), (e) => e.status === 400);
  }
});

test('los incidentes y sectores guardados caen dentro del área', () => {
  const { incidents } = JSON.parse(readFileSync(new URL('../data/incidents.json', import.meta.url), 'utf8'));
  for (const inc of incidents) {
    assert.ok(grid.gpsToPixel(inc.lat, inc.lng).insideBounds, `${inc.id} fuera del área`);
    sanitizeIncident({ ...inc }); // lo que ya está publicado también pasaría el filtro del Worker
  }
});

test('normalizeStore: el centro por defecto sale del área, sin píxel inventado', () => {
  const { referenceCenter } = normalizeStore({});
  assert.equal(referenceCenter.lat, (GEO_BOUNDS.north + GEO_BOUNDS.south) / 2);
  assert.equal('userPositionPixel' in referenceCenter, false);
});
