import { geoToTileF, METERS_PER_TILE_AVG, distanceToPolyline } from './gpsGrid.js';

/**
 * Modelo del mapa en coordenadas de tile, construido a partir de:
 *   data/map.json            → OpenStreetMap geometry (npm run map:update)
 *   data/map-overrides.json  → manual adjustments (places, classes, extra roads…)
 * Everything lives in lat/lng on disk; here it is projected onto the grid once.
 */

async function fetchJson(url, fallback) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Could not load ${url}: ${err.message}`);
  }
}

/** Retries if it fails (a weak mobile signal often recovers within a second). */
async function withRetry(fn, { tries = 3, delayMs = 800, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let lastError;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < tries - 1) await wait(delayMs * (i + 1));
    }
  }
  throw lastError;
}

export { withRetry };

const project = (pts) => pts.map(([lat, lng]) => geoToTileF(lat, lng));

function bboxOf(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

function lengthOf(pts) {
  let len = 0;
  for (let i = 0; i < pts.length - 1; i++) len += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  return len;
}

function feature(base, pts) {
  return { ...base, pts, bbox: bboxOf(pts), len: lengthOf(pts) };
}

export function buildWorld(map, overrides = {}) {
  const hidden = new Set((overrides.hideWays || []).map(String));
  const classOf = overrides.roadClass || {};
  const rename = overrides.rename || {};

  const roads = [];
  for (const r of map.roads || []) {
    if (hidden.has(String(r.id)) || (r.name && hidden.has(r.name))) continue;
    const name = r.name ? rename[r.name] ?? r.name : null;
    const cls = (r.name && classOf[r.name]) || r.cls;
    roads.push(feature({ id: r.id, cls, name, bridge: r.bridge, oneway: r.oneway }, project(r.pts)));
  }
  for (const [i, r] of (overrides.extraRoads || []).entries()) {
    roads.push(feature({ id: `extra-${i}`, cls: r.cls || 'minor', name: r.name || null }, project(r.pts)));
  }

  const water = (map.water || []).map((w) =>
    feature({ id: w.id, kind: w.kind === 'river' ? 'river' : 'stream', name: rename[w.name] ?? w.name }, project(w.pts))
  );
  const waterBodies = (map.waterBodies || []).map((w) => feature({ id: w.id, name: w.name }, project(w.pts)));
  const areas = [
    ...(map.areas || []).map((a) => feature({ id: a.id, kind: a.kind, name: a.name }, project(a.pts))),
    ...(overrides.areas || []).map((a, i) => feature({ id: `ov-${i}`, kind: a.kind }, project(a.pts)))
  ];

  const places = (overrides.places || []).map((p) => {
    const [x, y] = geoToTileF(p.lat, p.lng);
    return { ...p, x, y };
  });

  const homeSrc = overrides.home || { lat: 7.005177, lng: -73.063214, label: 'HOGAR' };
  const [hx, hy] = geoToTileF(homeSrc.lat, homeSrc.lng);
  const home = { x: Math.round(hx), y: Math.round(hy), label: homeSrc.label || 'HOGAR' };

  const sectors = (overrides.sectors || []).map((s) => {
    const [x, y] = geoToTileF(s.lat, s.lng);
    return { name: s.name, x, y, radius: s.radiusM / METERS_PER_TILE_AVG };
  });

  return {
    attribution: map.attribution || '',
    generatedAt: map.generatedAt || null,
    roads,
    water,
    waterBodies,
    areas,
    places,
    home,
    sectors
  };
}

export async function loadMapData(options) {
  const [map, overrides] = await withRetry(
    () => Promise.all([fetchJson('./data/map.json'), fetchJson('./data/map-overrides.json', {})]),
    options
  );
  return buildWorld(map, overrides);
}

const near = (bbox, x, y, pad) => x >= bbox.x0 - pad && x <= bbox.x1 + pad && y >= bbox.y0 - pad && y <= bbox.y1 + pad;

function nearest(features, x, y, maxDist, accept = () => true) {
  let best = null;
  let bestD = maxDist;
  for (const f of features) {
    if (!accept(f) || !near(f.bbox, x, y, maxDist)) continue;
    const d = distanceToPolyline(x, y, f.pts);
    if (d < bestD) {
      best = f;
      bestD = d;
    }
  }
  return best;
}

/** Sector name of a tile: manual sectors → nearby street → nearby place → river → zone. */
export function detectSectorName(world, px, py) {
  if (!world) return 'Sector Piedecuesta';

  for (const s of world.sectors) {
    if (Math.hypot(px - s.x, py - s.y) <= s.radius) return s.name;
  }

  const street = nearest(world.roads, px, py, 1.8, (r) => r.name && r.cls !== 'trail');
  if (street) return `Cerca de ${street.name}`;

  const trail = nearest(world.roads, px, py, 2, (r) => r.name && r.cls === 'trail');
  if (trail) return trail.name;

  let place = null;
  let placeD = 9;
  for (const p of world.places) {
    const d = Math.hypot(px - p.x, py - p.y);
    if (d < placeD) {
      place = p;
      placeD = d;
    }
  }
  if (place) return place.label;

  if (nearest(world.water, px, py, 3)) return 'Ronda del Río del Hato';
  return nearest(world.roads, px, py, 6) ? 'Sector Piedecuesta' : 'Zona verde / Cuenca Río del Hato';
}

/** `(px, py) => name` already bound to a map: this is what is passed to the UI and the services. */
export const createSectorNamer = (world) => (px, py) => detectSectorName(world, px, py);
