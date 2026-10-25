import test from 'node:test';
import assert from 'node:assert/strict';
import { gpsToPixel, pixelToGps, GRID_WIDTH, GRID_HEIGHT, GEO_BOUNDS } from '../src/map/gpsGrid.js';

test('pixelToGps -> gpsToPixel returns the same tile', () => {
  for (const [x, y] of [[0, 0], [90, 120], [199, 199], [100, 3]]) {
    const g = pixelToGps(x, y);
    const back = gpsToPixel(g.lat, g.lng);
    assert.deepEqual([back.pixelX, back.pixelY], [x, y]);
    assert.equal(back.insideBounds, true);
  }
});

test('gpsToPixel: outside the area sets insideBounds=false and clamps the tile', () => {
  const r = gpsToPixel(GEO_BOUNDS.north + 1, GEO_BOUNDS.west - 1);
  assert.equal(r.insideBounds, false);
  assert.equal(r.pixelX, 0);
  assert.equal(r.pixelY, 0);
});

test('pixelToGps clamps to the grid', () => {
  const r = pixelToGps(-5, 999);
  assert.equal(r.pixelX, 0);
  assert.equal(r.pixelY, GRID_HEIGHT - 1);
  assert.ok(GRID_WIDTH > 0);
});
