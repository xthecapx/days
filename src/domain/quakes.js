/**
 * Pure rules of the earthquake notice: what counts as "relevant", how far it was, how it is worded. No DOM, no network.
 * The time always comes in as a parameter.
 */
import { GEO_BOUNDS } from '../core/geo.js';
import { calculateDaysSince } from './incident.js';
import { ageLabel } from './signals.js';
import { toIsoDate } from '../core/dom.js';

/** Centre of the map area; distances are measured from here. */
export const QUAKE_CENTER = {
  lat: (GEO_BOUNDS.north + GEO_BOUNDS.south) / 2,
  lng: (GEO_BOUNDS.east + GEO_BOUNDS.west) / 2
};
export const QUAKE_RADIUS_KM = 100;
export const QUAKE_MIN_MAG = 4;
/** How far back we look for "the last earthquake". */
export const QUAKE_LOOKBACK_DAYS = 365;
/** A quake this recent is shown as an alert ("hace 12 min") instead of a day counter. */
export const FRESH_MS = 6 * 60 * 60_000;

const DAY_MS = 86_400_000;

/** Great-circle distance in km. */
export function distanceKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** YYYY-MM-DD, `days` before `now` (ms), in UTC. Used for the `starttime` of the queries. */
export const lookbackDate = (now, days = QUAKE_LOOKBACK_DAYS) => new Date(now - days * DAY_MS).toISOString().slice(0, 10);

/** USGS GeoJSON → common shape. Anything malformed is dropped by `normalizeQuakes`. */
export function parseUsgs(payload) {
  return (Array.isArray(payload?.features) ? payload.features : []).map((f) => ({
    id: `usgs:${f?.id}`,
    time: f?.properties?.time,
    mag: f?.properties?.mag,
    depthKm: f?.geometry?.coordinates?.[2],
    lat: f?.geometry?.coordinates?.[1],
    lng: f?.geometry?.coordinates?.[0],
    place: f?.properties?.place,
    url: f?.properties?.url,
    source: 'USGS'
  }));
}

/** EMSC (seismicportal.eu) GeoJSON → common shape. Its depth is negative in the geometry; `properties.depth` is positive. */
export function parseEmsc(payload) {
  return (Array.isArray(payload?.features) ? payload.features : []).map((f) => {
    const p = f?.properties || {};
    return {
      id: `emsc:${f?.id}`,
      time: Date.parse(p.time),
      mag: p.mag,
      depthKm: Number.isFinite(p.depth) ? Math.abs(p.depth) : undefined,
      lat: p.lat,
      lng: p.lon,
      place: p.flynn_region ? p.flynn_region.toLowerCase().replace(/^./, (c) => c.toUpperCase()) : undefined,
      url: p.unid ? `https://www.emsc-csem.org/Earthquake_information/earthquake.php?id=${encodeURIComponent(p.source_id || p.unid)}` : undefined,
      source: 'EMSC'
    };
  });
}

/**
 * Cleans a list of parsed quakes: valid numbers only, inside the radius and magnitude we care about, newest first.
 * Protects the screen from odd data (and from a server that ignores our filters).
 */
export function normalizeQuakes(list, { minMag = QUAKE_MIN_MAG, radiusKm = QUAKE_RADIUS_KM, center = QUAKE_CENTER } = {}) {
  return list
    .filter((q) => q && Number.isFinite(q.time) && Number.isFinite(q.mag) && Number.isFinite(q.lat) && Number.isFinite(q.lng))
    .map((q) => ({
      id: String(q.id),
      time: q.time,
      mag: q.mag,
      depthKm: Number.isFinite(q.depthKm) ? q.depthKm : null,
      lat: q.lat,
      lng: q.lng,
      place: typeof q.place === 'string' ? q.place : '',
      url: typeof q.url === 'string' && /^https:\/\//.test(q.url) ? q.url : null,
      source: q.source || '',
      distanceKm: distanceKm(center, q)
    }))
    .filter((q) => q.mag >= minMag && q.distanceKm <= radiusKm)
    .sort((a, b) => b.time - a.time);
}

/** The newest quake, or null. */
export const latestQuake = (quakes) => quakes[0] || null;

/** Quakes newer than anything seen before (by time, so switching source never repeats an old one as "new"). */
export const newQuakes = (quakes, lastSeenTime) => quakes.filter((q) => q.time > lastSeenTime);

export const isFresh = (quake, now) => now - quake.time < FRESH_MS && now >= quake.time - 60_000;

const km = (n) => `${Math.round(n)} km`;

/** What the quake row shows. Pure: `referenceDate` is the app's "today", `now` is ms. */
export function quakeSummary(quakes, referenceDate, now) {
  const q = latestQuake(quakes);
  if (!q) return { quake: null, fresh: false, days: '--', label: 'DÍAS DESDE EL ÚLTIMO SISMO', preview: 'Sin sismos recientes cerca.' };
  const fresh = isFresh(q, now);
  const days = calculateDaysSince(toIsoDate(new Date(q.time)), referenceDate);
  return {
    quake: q,
    fresh,
    days: fresh ? '!' : String(days).padStart(2, '0'),
    label: fresh ? `SISMO ${ageLabel(q.time, now).toUpperCase()}` : days === 1 ? 'DÍA DESDE EL ÚLTIMO SISMO' : 'DÍAS DESDE EL ÚLTIMO SISMO',
    preview: `M${q.mag.toFixed(1)} · a ${km(q.distanceKm)}${q.depthKm == null ? '' : ` · prof. ${km(q.depthKm)}`}`
  };
}

/** Longer description for the expanded row and the toast. */
export function quakeDetail(q) {
  return `Sismo M${q.mag.toFixed(1)} a ${km(q.distanceKm)}${q.depthKm == null ? '' : `, profundidad ${km(q.depthKm)}`}${q.place ? ` · ${q.place}` : ''}`;
}
