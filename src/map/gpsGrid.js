/**
 * Grilla del juego sobre coordenadas reales.
 *
 * lat/lng es la fuente de verdad (así se guardan los incidentes); la grilla
 * (200×200 tiles de ~14 m) es solo una vista sobre esas coordenadas.
 * Cambiar GEO_BOUNDS o el tamaño de grilla NO mueve ningún incidente.
 *
 * Convención de tiles: el centro del tile de índice i está en la coordenada
 * continua i (por eso geoToTileF resta 0.5).
 */

// El área y el tamaño de la grilla se definen una sola vez, en core/geo.js.
import { GEO_BOUNDS, GRID_WIDTH, GRID_HEIGHT } from '../core/geo.js';
export { GEO_BOUNDS, GRID_WIDTH, GRID_HEIGHT };

const LNG_SPAN = GEO_BOUNDS.east - GEO_BOUNDS.west;
const LAT_SPAN = GEO_BOUNDS.north - GEO_BOUNDS.south;

/** Metros por tile (aprox., en el centro del mapa). */
const METERS_PER_TILE = {
  x: (LNG_SPAN * 111320 * Math.cos((((GEO_BOUNDS.north + GEO_BOUNDS.south) / 2) * Math.PI) / 180)) / GRID_WIDTH,
  y: (LAT_SPAN * 110574) / GRID_HEIGHT
};
export const METERS_PER_TILE_AVG = (METERS_PER_TILE.x + METERS_PER_TILE.y) / 2;

/** lat/lng → coordenada continua de tile (convención: centro del tile i = i). */
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

/** Distancia (en tiles) de un punto a una polilínea. */
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
