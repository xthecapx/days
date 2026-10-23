import { REFERENCE_DATE, INITIAL_PIXEL } from '../core/config.js';

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
export function createInitialState() {
  return {
    data: { incidents: [], revisions: [] },
    sync: { message: '' },
    settings: {
      decayMode: 'actual',
      referenceDate: REFERENCE_DATE,
      showGrid: false
    },
    selection: { pixel: { ...INITIAL_PIXEL }, incidentId: 'inc-006', hovered: null },
    mode: { type: 'browse' },
    ui: { sheet: null, popupIncidentId: null, alertExpanded: false, settingsOpen: false },
    draft: null
  };
}
