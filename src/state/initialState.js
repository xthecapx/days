import { startOfDay } from '../core/clock.js';

/**
 * Forma del estado de la app:
 *  data      → incidents.json (incidentes)
 *  sync      → último estado de sincronización con disco / GitHub
 *  settings  → preferencias de visualización
 *  selection → píxel / incidente seleccionado y píxel bajo el cursor
 *  mode      → { type: 'browse' | 'move' | 'pick', incidentId? }
 *  ui        → hoja abierta, popup, tarjeta expandida, modal de ajustes
 *  draft     → formulario de reporte en curso (null si está cerrado)
 */
export function createInitialState(now = new Date()) {
  return {
    data: { incidents: [] },
    sync: { message: '', ok: true },
    settings: {
      decayMode: 'actual',
      referenceDate: startOfDay(now), // "hoy"; lo mantiene al día core/clock.js
      showGrid: false
    },
    selection: { pixel: { x: 0, y: 0 }, incidentId: 'inc-006', hovered: null },
    mode: { type: 'browse' },
    ui: { sheet: null, popupIncidentId: null, alertExpanded: false, settingsOpen: false },
    draft: null
  };
}
