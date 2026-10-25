import { CATEGORIES, DEFAULT_CATEGORY } from '../core/config.js';
import { toIsoDate } from '../core/dom.js';
import { gpsToPixel, pixelToGps } from '../map/gpsGrid.js';
import { isTranquilityIncident } from '../domain/incident.js';
import { findIncident } from './selectors.js';

/**
 * All the app's operations in one place. The UI components
 * only call these functions and read the store; they do not talk to each other.
 */
export function createActions({ store, camera, incidents, gps, world, sectorName }) {
  const { home } = world;
  let draftSession = 0; // identifies each opening of the form, to fill it in only once
  const ui = (partial) => store.patch('ui', partial);

  const isMobile = () => window.innerWidth < 600;

  // ----- Camera / selection -------------------------------------------------
  function goHome(zoom) {
    camera.focusTile(home.x, home.y - 1, zoom ?? (isMobile() ? 1.45 : 1.75));
    store.patch('selection', { pixel: { x: home.x, y: home.y } });
  }

  function selectPixel(x, y) {
    store.patch('selection', { pixel: { x, y } });
  }

  /** Centres the map on a help alert and closes the sheet so it can be seen. */
  function focusSignal(id) {
    const sig = store.get().signals.active.find((s) => s.id === id);
    if (!sig) return;
    closeSheet();
    ui({ popupIncidentId: null, alertExpanded: false });
    store.patch('selection', { pixel: { x: sig.x, y: sig.y } });
    camera.focusTile(sig.x, sig.y, Math.max(camera.state.zoom, 2));
  }

  function focusIncident(inc) {
    closeSheet();
    store.patch('selection', { incidentId: inc.id, pixel: { x: inc.pixelX, y: inc.pixelY } });
    ui({ popupIncidentId: inc.id, alertExpanded: false });
    camera.focusTile(inc.pixelX, inc.pixelY, Math.max(camera.state.zoom, 1.8));
  }

  /** Centres the map on the phone's position; reuses the recent read instead of requesting another. */
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
    ui({ sheet: name, popupIncidentId: null, alertExpanded: false, helpConfirm: false });
  }

  function closeSheet() {
    const { mode } = store.get();
    if (mode.type === 'pick') return; // the sheet is hidden on purpose while a pixel is being picked
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

  // ----- Selection modes on the map --------------------------------------
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
          impactType: calm ? 'tranquilidad' : 'seguridad',
          category: incident.category || DEFAULT_CATEGORY,
          severity: incident.severity || 4,
          date: incident.date || toIsoDate(state.settings.referenceDate),
          time: incident.timeConfirmed || incident.time !== '12:00' ? incident.time || '' : '', // the 12:00 without confirmation was filler
          pickDate: false,
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
          impactType: 'seguridad',
          category: DEFAULT_CATEGORY,
          severity: 4,
          // No date or time until the person chooses them: that way the day of the REPORT is never saved
          // as if it were the day of the EVENT (which is what "days since the last incident" counts).
          date: '',
          time: '',
          pickDate: false,
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
      if (cat && !('impactType' in partial)) next.impactType = cat.impact; // the colour comes from the category
    }
    // Choosing a date or time confirms it; leaving it empty leaves it unconfirmed.
    if ('date' in partial) {
      if (!('dateConfirmed' in partial)) next.dateConfirmed = Boolean(partial.date);
      if (!('pickDate' in partial)) next.pickDate = false;
    }
    if ('time' in partial && !('timeConfirmed' in partial)) next.timeConfirmed = Boolean(partial.time);
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

  // ----- Taps on the map ----------------------------------------------
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
      const sector = sectorName(gps.pixelX, gps.pixelY);
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
    focusSignal,
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
