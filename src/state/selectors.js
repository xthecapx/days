import { computePixelHeatmap } from '../map/heatmapEngine.js';
import { toIsoDate } from '../core/dom.js';

export const selectIncidents = (s) => s.data.incidents || [];

/**
 * SOS mode = the person is listening for help signals. It is either that or the history: while listening, the days card,
 * the incident markers and the heat map are hidden so only help signals are on screen. The history comes back by itself
 * whenever the person is doing something that needs it: looking at an incident, reporting, picking or moving a point.
 */
export const selectSosMode = (s) => Boolean(s.signals.listening);
export const selectHistoryVisible = (s) => !selectSosMode(s) || Boolean(s.ui.popupIncidentId) || s.mode.type !== 'browse' || Boolean(s.draft);

export function findIncident(state, id) {
  return selectIncidents(state).find((i) => i.id === id) || null;
}

/** The form draft is drawn as a "ghost" on the map while being edited. */
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
 * Key of what the draft contributes to the heat map (location, severity, date, type). Typing the
 * description or the sector does NOT change it, so it does not force recomputing the 40,000 tiles.
 */
export function selectPreviewKey(s) {
  const p = draftToPreview(s.draft, toIsoDate(s.settings.referenceDate));
  return p ? `${p.pixelX},${p.pixelY},${p.severity},${p.date},${p.impactType}` : '';
}

let heatCache = { deps: null, value: null };

/** Memoised heat map: recomputed only if any of its inputs changes. */
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
