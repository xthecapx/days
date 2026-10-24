import { computePixelHeatmap } from '../map/heatmapEngine.js';

export const selectIncidents = (s) => s.data.incidents || [];
export const selectRevisions = (s) => s.data.revisions || [];

export function findIncident(state, id) {
  return selectIncidents(state).find((i) => i.id === id) || null;
}

/** El borrador del formulario se dibuja como "fantasma" en el mapa mientras se edita. */
function draftToPreview(draft) {
  if (!draft || Number.isNaN(draft.pixelX) || Number.isNaN(draft.pixelY)) return null;
  return {
    id: 'preview-inc',
    pixelX: draft.pixelX,
    pixelY: draft.pixelY,
    severity: draft.severity || 4,
    date: draft.date || '2026-10-22',
    impactType: draft.impactType || 'seguridad'
  };
}

let heatCache = { deps: null, value: null };

/** Mapa de calor memoizado: solo se recalcula si cambia alguna de sus entradas. */
export function selectHeatmap(s) {
  const deps = [s.data.incidents, s.settings.decayMode, s.settings.referenceDate, s.draft];
  if (heatCache.deps && deps.every((d, i) => Object.is(d, heatCache.deps[i]))) {
    return heatCache.value;
  }
  const value = computePixelHeatmap(selectIncidents(s), {
    now: s.settings.referenceDate,
    decayMode: s.settings.decayMode,
    previewIncident: draftToPreview(s.draft)
  });
  heatCache = { deps, value };
  return value;
}
