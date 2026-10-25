/**
 * Game grid over real coordinates.
 *
 * lat/lng is the source of truth (that is how incidents are stored); the grid
 * (200×200 tiles of ~14 m) is just a view over those coordinates.
 * Changing GEO_BOUNDS or the grid size does NOT move any incident.
 *
 * Tile convention: the centre of the tile with index i is at the coordinate
 * continua i (por eso geoToTileF resta 0.5).
 */

// The area and the grid size are defined once, in core/geo.js.
import { GEO_BOUNDS, GRID_WIDTH, GRID_HEIGHT } from '../core/geo.js';
export { GEO_BOUNDS, GRID_WIDTH, GRID_HEIGHT };

const LNG_SPAN = GEO_BOUNDS.east - GEO_BOUNDS.west;
const LAT_SPAN = GEO_BOUNDS.north - GEO_BOUNDS.south;

/** Metres per tile (approx., at the centre of the map). */
const METERS_PER_TILE = {
  x: (LNG_SPAN * 111320 * Math.cos((((GEO_BOUNDS.north + GEO_BOUNDS.south) / 2) * Math.PI) / 180)) / GRID_WIDTH,
  y: (LAT_SPAN * 110574) / GRID_HEIGHT
};
export const METERS_PER_TILE_AVG = (METERS_PER_TILE.x + METERS_PER_TILE.y) / 2;

/** lat/lng → continuous tile coordinate (convention: centre of tile i = i). */
export function geoToTileF(lat, lng) {
  return [
    ((lng - GEO_BOUNDS.west) / LNG_SPAN) * GRID_WIDTH - 0.5,
    ((GEO_BOUNDS.north - lat) / LAT_SPAN) * GRID_HEIGHT - 0.5
  ];
}

/** Centro del tile (px, py) en lat/lng; admite tiles fraccionarios. */
function tileToGeo(px, py) {
  return {
    lng: GEO_BOUNDS.west + ((px + 0.5) / GRID_WIDTH) * LNG_SPAN,
    lat: GEO_BOUNDS.north - ((py + 0.5) / GRID_HEIGHT) * LAT_SPAN
  };
}

const clampX = (v) => Math.max(0, Math.min(GRID_WIDTH - 1, v));
const clampY = (v) => Math.max(0, Math.min(GRID_HEIGHT - 1, v));

export function pixelToGps(px, py) {
  const pixelX = clampX(Math.round(px));
  const pixelY = clampY(Math.round(py));
  const { lat, lng } = tileToGeo(pixelX, pixelY);
  return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), pixelX, pixelY };
}

export function gpsToPixel(lat, lng) {
  const [fx, fy] = geoToTileF(lat, lng);
  const px = Math.floor(fx + 0.5);
  const py = Math.floor(fy + 0.5);
  return {
    pixelX: clampX(px),
    pixelY: clampY(py),
    insideBounds: px >= 0 && px < GRID_WIDTH && py >= 0 && py < GRID_HEIGHT
  };
}

/** Distance (in tiles) from a point to a polyline. */
export function distanceToPolyline(px, py, polyline) {
  let min = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const [x1, y1] = polyline[i];
    const [x2, y2] = polyline[i + 1];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq > 0 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq)) : 0;
    const d = Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    if (d < min) min = d;
  }
  return min;
}
