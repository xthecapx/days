import { startOfDay } from '../core/clock.js';

/**
 * Forma del estado de la app:
 *  data      → incidents.json (incidentes + revisiones)
 *  sync      → último estado de sincronización con disco / GitHub
 *  settings  → preferencias de visualización
 *  selection → píxel / incidente seleccionado y píxel bajo el cursor
 *  mode      → { type: 'browse' | 'move' | 'pick', incidentId? }
 *  ui        → hoja abierta, popup, tarjeta expandida, modal de ajustes
 *  draft     → formulario de reporte en curso (null si está cerrado)
 */
export function createInitialState(now = new Date()) {
  return {
    data: { incidents: [], revisions: [] },
    sync: { message: '' },
    settings: {
      decayMode: 'actual',
      referenceDate: startOfDay(now), // "hoy"; lo mantiene al día core/clock.js
      referenceOverride: false, // true = la persona eligió una fecha en Ajustes y no se actualiza sola
      showGrid: false
    },
    selection: { pixel: { x: 0, y: 0 }, incidentId: 'inc-006', hovered: null },
    mode: { type: 'browse' },
    ui: { sheet: null, popupIncidentId: null, alertExpanded: false, settingsOpen: false },
    draft: null
  };
}
