import { gpsToPixel } from '../map/gpsGrid.js';
import { GEO_BOUNDS } from '../core/geo.js';

/**
 * lat/lng is the incident's source of truth; the tile is recomputed on every load
 * so that changing the grid or the map area never moves an incident.
 */
function anchorToGrid(inc) {
  if (!Number.isFinite(inc.lat) || !Number.isFinite(inc.lng)) return inc;
  const { pixelX, pixelY, insideBounds } = gpsToPixel(inc.lat, inc.lng);
  return insideBounds ? { ...inc, pixelX, pixelY } : inc;
}

/** Canonical shape of incidents.json, wherever it comes from (repository, cache, import). */
export function normalizeStore(data) {
  const incidents = (Array.isArray(data.incidents) ? data.incidents : []).map(anchorToGrid);
  incidents.sort((a, b) => (a.number || 0) - (b.number || 0));
  return {
    schemaVersion: 4,
    neighborhood: data.neighborhood || 'Sendero Río del Hato y Ciudad Tierrabuena',
    referenceCenter: data.referenceCenter || {
      lat: (GEO_BOUNDS.north + GEO_BOUNDS.south) / 2,
      lng: (GEO_BOUNDS.east + GEO_BOUNDS.west) / 2,
      zoom: 16.21
    },
    lastUpdated: data.lastUpdated || new Date().toISOString(),
    incidents
  };
}
