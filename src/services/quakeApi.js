/**
 * Earthquake sources. Primary: USGS. Fallback: EMSC (used only when USGS fails). Both are public, free and send
 * `Access-Control-Allow-Origin: *`, so the browser calls them directly: no server of ours, nothing stored, no user data sent.
 * NEVER throws: returns { ok: true, quakes, source } or { ok: false, error }.
 */
import { QUAKE_CENTER, QUAKE_MIN_MAG, QUAKE_RADIUS_KM, lookbackDate, normalizeQuakes, parseEmsc, parseUsgs } from '../domain/quakes.js';

const TIMEOUT_MS = 8000;
const KM_PER_DEGREE = 111.2;

export function usgsUrl(now) {
  const q = new URLSearchParams({
    format: 'geojson',
    latitude: QUAKE_CENTER.lat.toFixed(4),
    longitude: QUAKE_CENTER.lng.toFixed(4),
    maxradiuskm: String(QUAKE_RADIUS_KM),
    minmagnitude: String(QUAKE_MIN_MAG),
    starttime: lookbackDate(now),
    orderby: 'time',
    limit: '5'
  });
  return `https://earthquake.usgs.gov/fdsnws/event/1/query?${q}`;
}

export function emscUrl(now) {
  const q = new URLSearchParams({
    format: 'json',
    lat: QUAKE_CENTER.lat.toFixed(4),
    lon: QUAKE_CENTER.lng.toFixed(4),
    maxradius: (QUAKE_RADIUS_KM / KM_PER_DEGREE).toFixed(3),
    minmag: String(QUAKE_MIN_MAG),
    start: lookbackDate(now),
    orderby: 'time',
    limit: '5'
  });
  return `https://www.seismicportal.eu/fdsnws/event/1/query?${q}`;
}

export function createQuakeApi({ fetchImpl = globalThis.fetch?.bind(globalThis), now = Date.now, timeoutMs = TIMEOUT_MS } = {}) {
  async function get(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { signal: controller.signal });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  const sources = [
    { name: 'USGS', url: usgsUrl, parse: parseUsgs },
    { name: 'EMSC', url: emscUrl, parse: parseEmsc }
  ];

  return {
    enabled: typeof fetchImpl === 'function',
    async latest() {
      if (typeof fetchImpl !== 'function') return { ok: false, error: 'not_configured' };
      for (const s of sources) {
        const payload = await get(s.url(now()));
        if (payload) return { ok: true, source: s.name, quakes: normalizeQuakes(s.parse(payload)) };
      }
      return { ok: false, error: 'network' };
    }
  };
}
