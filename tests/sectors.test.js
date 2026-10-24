import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildWorld, detectSectorName, createSectorNamer } from '../src/map/mapData.js';
import { pixelToGps, gpsToPixel } from '../src/map/gpsGrid.js';
import { createStore } from '../src/state/store.js';
import { createInitialState } from '../src/state/initialState.js';
import { selectHeatmap, selectPreviewKey } from '../src/state/selectors.js';

const read = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const world = buildWorld(read('map.json'), read('map-overrides.json'));
const overrides = read('map-overrides.json');

test('buildWorld: carga el mapa real con calles, agua, sectores y hogar dentro de la grilla', () => {
  assert.ok(world.roads.length > 50);
  assert.ok(world.water.length > 0);
  assert.ok(world.sectors.length > 0);
  assert.ok(world.home.x >= 0 && world.home.x < 200 && world.home.y >= 0 && world.home.y < 200);
});

test('detectSectorName: el centro de cada sector manual devuelve su nombre (el primero de la lista gana si se solapan)', () => {
  for (const s of world.sectors) {
    const first = world.sectors.find((c) => Math.hypot(s.x - c.x, s.y - c.y) <= c.radius);
    assert.equal(detectSectorName(world, Math.round(s.x), Math.round(s.y)), first.name, s.name);
  }
  assert.equal(detectSectorName(world, Math.round(world.sectors[0].x), Math.round(world.sectors[0].y)), world.sectors[0].name);
});

test('detectSectorName: cada incidente guardado recibe un nombre y nunca falla', () => {
  for (const inc of read('incidents.json').incidents) {
    const name = detectSectorName(world, inc.pixelX, inc.pixelY);
    assert.equal(typeof name, 'string');
    assert.ok(name.length > 2, inc.id);
  }
});

test('detectSectorName: sin mapa cargado devuelve el sector por defecto; fuera de todo, zona verde', () => {
  assert.equal(detectSectorName(null, 10, 10), 'Sector Piedecuesta');
  assert.equal(detectSectorName({ sectors: [], roads: [], places: [], water: [] }, 10, 10), 'Zona verde / Cuenca Río del Hato');
});

test('createSectorNamer ata el mapa y no comparte estado entre mapas', () => {
  const other = { sectors: [{ name: 'Otro', x: 5, y: 5, radius: 3 }], roads: [], places: [], water: [] };
  assert.equal(createSectorNamer(other)(5, 5), 'Otro');
  assert.notEqual(createSectorNamer(world)(5, 5), 'Otro');
});

test('detectSectorName da el mismo resultado que antes en una muestra de tiles del mapa real', () => {
  // Cobertura de las 6 ramas (sector, calle, sendero, lugar, río, zona): todas devuelven texto y varias distintas.
  const names = new Set();
  for (let y = 0; y < 200; y += 10) for (let x = 0; x < 200; x += 10) names.add(detectSectorName(world, x, y));
  assert.ok(names.size >= 4, [...names].join(' | '));
  assert.ok([...names].some((n) => n.startsWith('Cerca de ')));
});

// ---------- el mapa de calor no se recalcula al escribir en el formulario ----------

test('selectPreviewKey y selectHeatmap: escribir texto no recalcula; mover el punto sí', () => {
  const store = createStore(createInitialState());
  const base = { session: 1, pixelX: 50, pixelY: 60, severity: 4, date: '2026-10-22', impactType: 'seguridad', description: '', sector: 'a' };
  store.set({ data: { incidents: [], revisions: [] }, draft: base });
  const first = selectHeatmap(store.get());
  store.set({ draft: { ...base, description: 'escribiendo…', sector: 'otro nombre' } });
  assert.equal(selectHeatmap(store.get()), first, 'misma referencia: no se recalculó');
  store.set({ draft: { ...base, pixelX: 51 } });
  assert.notEqual(selectHeatmap(store.get()), first, 'cambió la ubicación: se recalcula');
  store.set({ draft: { ...base, severity: 2 } });
  assert.notEqual(selectHeatmap(store.get()).grid[60 * 200 + 50], first.grid[60 * 200 + 50]);
  store.set({ draft: null });
  assert.equal(selectPreviewKey(store.get()), '');
});
