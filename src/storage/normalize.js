import { gpsToPixel } from '../map/gpsGrid.js';

/**
 * lat/lng es la fuente de verdad del incidente; el tile se recalcula en cada carga
 * para que cambiar la grilla o el área del mapa nunca mueva un incidente.
 */
function anchorToGrid(inc) {
  if (!Number.isFinite(inc.lat) || !Number.isFinite(inc.lng)) return inc;
  const { pixelX, pixelY, insideBounds } = gpsToPixel(inc.lat, inc.lng);
  return insideBounds ? { ...inc, pixelX, pixelY } : inc;
}

/** Forma canónica de incidents.json, venga de donde venga (repositorio, caché, importación). */
export function normalizeStore(data) {
  const incidents = (Array.isArray(data.incidents) ? data.incidents : []).map(anchorToGrid);
  incidents.sort((a, b) => (a.number || 0) - (b.number || 0));
  return {
    schemaVersion: 3,
    neighborhood: data.neighborhood || 'Sendero Río del Hato y Ciudad Tierrabuena',
    referenceCenter: data.referenceCenter || {
      lat: 7.0060325,
      lng: -73.0640861,
      zoom: 16.21,
      userPositionPixel: { x: 68, y: 49, label: 'Hogar' }
    },
    lastUpdated: data.lastUpdated || new Date().toISOString(),
    incidents,
    revisions: Array.isArray(data.revisions) ? data.revisions : []
  };
}
