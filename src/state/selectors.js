import { computePixelHeatmap } from '../map/heatmapEngine.js';
import { toIsoDate } from '../core/dom.js';

export const selectIncidents = (s) => s.data.incidents || [];

export function findIncident(state, id) {
  return selectIncidents(state).find((i) => i.id === id) || null;
}

/** El borrador del formulario se dibuja como "fantasma" en el mapa mientras se edita. */
function draftToPreview(draft, fallbackDate) {
  if (!draft || Number.isNaN(draft.pixelX) || Number.isNaN(draft.pixelY)) return null;
  return {
    id: 'preview-inc',
    pixelX: draft.pixelX,
    pixelY: draft.pixelY,
    severity: draft.severity || 4,
    date: draft.date || fallbackDate,
    impactType: draft.impactType || 'seguridad'
  };
}

/**
 * Clave de lo que el borrador aporta al mapa de calor (ubicación, gravedad, fecha, tipo). Escribir la
 * descripción o el sector NO la cambia, así que no obliga a recalcular los 40 000 tiles.
 */
export function selectPreviewKey(s) {
  const p = draftToPreview(s.draft, toIsoDate(s.settings.referenceDate));
  return p ? `${p.pixelX},${p.pixelY},${p.severity},${p.date},${p.impactType}` : '';
}

let heatCache = { deps: null, value: null };

/** Mapa de calor memoizado: solo se recalcula si cambia alguna de sus entradas. */
export function selectHeatmap(s) {
  const deps = [s.data.incidents, s.settings.decayMode, s.settings.referenceDate, selectPreviewKey(s)];
  if (heatCache.deps && deps.every((d, i) => Object.is(d, heatCache.deps[i]))) {
    return heatCache.value;
  }
  const value = computePixelHeatmap(selectIncidents(s), {
    now: s.settings.referenceDate,
    decayMode: s.settings.decayMode,
    previewIncident: draftToPreview(s.draft, toIsoDate(s.settings.referenceDate))
  });
  heatCache = { deps, value };
  return value;
}
