import { startOfDay } from '../core/clock.js';

/**
 * Shape of the app state:
 *  data      → incidents.json (incidentes)
 *  sync      → last synchronisation state with disk / GitHub
 *  settings  → display preferences
 *  selection → selected pixel / incident and pixel under the cursor
 *  signals   → help signal: active signals, how many are listening, whether I am listening, my latest signal
 *  mode      → { type: 'browse' | 'move' | 'pick', incidentId? }
 *  ui        → hoja abierta, popup, tarjeta expandida, modal de ajustes
 *  draft     → report form in progress (null if closed)
 */
export function createInitialState(now = new Date()) {
  return {
    data: { incidents: [] },
    sync: { message: '', ok: true },
    settings: {
      decayMode: 'actual',
      referenceDate: startOfDay(now), // "today"; kept current by core/clock.js
      showGrid: false
    },
    selection: { pixel: { x: 0, y: 0 }, incidentId: 'inc-006', hovered: null },
    signals: { enabled: false, active: [], listeners: 0, listening: false, status: 'idle', mine: null, loaded: false, skew: 0 },
    mode: { type: 'browse' },
    ui: { sheet: null, popupIncidentId: null, alertExpanded: false, settingsOpen: false, helpConfirm: false },
    draft: null
  };
}
