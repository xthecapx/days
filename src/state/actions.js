import { CATEGORIES, DEFAULT_CATEGORY } from '../core/config.js';
import { toIsoDate } from '../core/dom.js';
import { gpsToPixel, pixelToGps } from '../map/gpsGrid.js';
import { isTranquilityIncident } from '../domain/incident.js';
import { findIncident } from './selectors.js';

let draftSession = 0;

/**
 * Todas las operaciones de la app en un solo lugar. Los componentes de UI
 * solo llaman a estas funciones y leen el store; no se hablan entre sí.
 */
export function createActions({ store, camera, incidents, gps, world, sectorName }) {
  const { home } = world;
  const ui = (partial) => store.patch('ui', partial);

  const isMobile = () => window.innerWidth < 600;

  // ----- Cámara / selección -------------------------------------------------
  function goHome(zoom) {
    camera.focusTile(home.x, home.y - 1, zoom ?? (isMobile() ? 1.45 : 1.75));
    store.patch('selection', { pixel: { x: home.x, y: home.y } });
  }

  function selectPixel(x, y) {
    store.patch('selection', { pixel: { x, y } });
  }

  function focusIncident(inc) {
    closeSheet();
    store.patch('selection', { incidentId: inc.id, pixel: { x: inc.pixelX, y: inc.pixelY } });
    ui({ popupIncidentId: inc.id, alertExpanded: false });
    camera.focusTile(inc.pixelX, inc.pixelY, Math.max(camera.state.zoom, 1.8));
  }

  /** Centra el mapa en la posición del teléfono; reutiliza la lectura reciente en vez de pedir otra. */
  async function locateMe() {
    const fallback = () => {
        selectPixel(home.x, home.y);
      camera.focusTile(home.x, home.y, 1.8);
    };
    const position = gps.fix() || (await gps.read());
    if (!position) return fallback();
    const p = gpsToPixel(position.lat, position.lng);
    if (!p.insideBounds) return fallback();
    selectPixel(p.pixelX, p.pixelY);
    camera.focusTile(p.pixelX, p.pixelY, 2);
  }

  // ----- UI -----------------------------------------------------------------
  function openSheet(name) {
    ui({ sheet: name, popupIncidentId: null, alertExpanded: false });
  }

  function closeSheet() {
    const { mode } = store.get();
    if (mode.type === 'pick') return; // la hoja está oculta a propósito mientras se elige un píxel
    store.set({ ui: { ...store.get().ui, sheet: null }, draft: null });
  }

  function toggleAlert(force) {
    const open = typeof force === 'boolean' ? force : !store.get().ui.alertExpanded;
    ui({ alertExpanded: open });
  }

  function dismissOverlays() {
    ui({ alertExpanded: false });
  }

  function showPopup(id) {
    const patchSel = id ? { incidentId: id } : {};
    store.patch('selection', patchSel);
    ui({ popupIncidentId: id });
  }

  // ----- Modos de selección en el mapa --------------------------------------
  function startMove(inc) {
    store.set({
      mode: { type: 'move', incidentId: inc.id },
      ui: { ...store.get().ui, popupIncidentId: null, sheet: null }
    });
    store.patch('selection', { incidentId: inc.id });
  }

  function cancelMode() {
    const { mode, draft } = store.get();
    if (mode.type === 'pick' && draft) {
      store.set({ mode: { type: 'browse' }, ui: { ...store.get().ui, sheet: 'report' } });
    } else {
      store.set({ mode: { type: 'browse' } });
    }
  }

  // ----- Formulario de reporte ---------------------------------------------
  function openReport({ incident = null, pixel = null } = {}) {
    const state = store.get();
    const p = incident ? { x: incident.pixelX, y: incident.pixelY } : (pixel || state.selection.pixel);
    const gps = pixelToGps(p.x, p.y);
    const calm = incident ? isTranquilityIncident(incident) : false;

    const draft = incident
      ? {
          session: ++draftSession,
          editingId: incident.id,
          number: incident.number,
          pixelX: gps.pixelX,
          pixelY: gps.pixelY,
          sector: incident.sector || sectorName(gps.pixelX, gps.pixelY),
          sectorTouched: false,
          impactType: calm ? 'tranquilidad' : 'seguridad',
          category: incident.category || DEFAULT_CATEGORY,
          severity: incident.severity || 4,
          date: incident.date || toIsoDate(state.settings.referenceDate),
          time: incident.time || '19:00',
          dateConfirmed: Boolean(incident.dateConfirmed),
          timeConfirmed: Boolean(incident.timeConfirmed),
          resolved: incident.resolvedBy === 'policia',
          description: incident.description || ''
        }
      : {
          session: ++draftSession,
          editingId: null,
          pixelX: gps.pixelX,
          pixelY: gps.pixelY,
          sector: sectorName(gps.pixelX, gps.pixelY),
          sectorTouched: false,
          impactType: 'seguridad',
          category: DEFAULT_CATEGORY,
          severity: 4,
          date: toIsoDate(state.settings.referenceDate),
          time: '19:30',
          // La fecha propuesta es la de hoy (cuando se reporta), no necesariamente la del hecho:
          // la persona debe confirmarla para que cuente en "días desde el último incidente".
          dateConfirmed: false,
          timeConfirmed: false,
          resolved: false,
          description: ''
        };

    store.set({ draft, ui: { ...state.ui, sheet: 'report', popupIncidentId: null, alertExpanded: false } });
  }

  function patchDraft(partial) {
    const { draft } = store.get();
    if (!draft) return;
    const next = { ...draft, ...partial };
    if ('category' in partial) {
      const cat = CATEGORIES.find((c) => c.value === partial.category);
      if (cat && !('impactType' in partial)) next.impactType = cat.impact;
    }
    store.set({ draft: next });
  }

  function startPickForReport() {
    store.set({ mode: { type: 'pick' }, ui: { ...store.get().ui, sheet: null } });
  }

  async function submitDraft() {
    const { draft } = store.get();
    if (!draft) return null;
    const saved = await incidents.save(
      {
        pixelX: draft.pixelX,
        pixelY: draft.pixelY,
        impactType: draft.impactType,
        sector: draft.sector,
        date: draft.date,
        time: draft.time,
        dateConfirmed: draft.dateConfirmed,
        timeConfirmed: draft.timeConfirmed,
        resolvedBy: draft.resolved ? 'policia' : null,
        category: draft.category,
        severity: draft.severity,
        description: draft.description
      },
      draft.editingId
    );
    store.set({ draft: null, ui: { ...store.get().ui, sheet: null } });
    focusIncident(saved);
    return saved;
  }

  // ----- Toques sobre el mapa ----------------------------------------------
  async function tapTile(x, y, hitIncident) {
    selectPixel(x, y);
    const { mode, draft } = store.get();

    if (mode.type === 'move') {
      store.set({ mode: { type: 'browse' } });
      const saved = await incidents.move(mode.incidentId, x, y);
      if (saved) showPopup(saved.id);
      return;
    }

    if (mode.type === 'pick' && draft) {
      const gps = pixelToGps(x, y);
      const sector = draft.sectorTouched ? draft.sector : sectorName(gps.pixelX, gps.pixelY);
      store.set({
        mode: { type: 'browse' },
        draft: { ...draft, pixelX: gps.pixelX, pixelY: gps.pixelY, sector },
        ui: { ...store.get().ui, sheet: 'report' }
      });
      return;
    }

    showPopup(hitIncident ? hitIncident.id : null);
  }

  async function confirmIncident(id) {
    await incidents.confirm(id);
  }

  return {
    goHome,
    selectPixel,
    focusIncident,
    locateMe,
    openSheet,
    closeSheet,
    toggleAlert,
    dismissOverlays,
    showPopup,
    startMove,
    cancelMode,
    openReport,
    patchDraft,
    startPickForReport,
    submitDraft,
    tapTile,
    confirmIncident,
    findIncident: (id) => findIncident(store.get(), id)
  };
}
