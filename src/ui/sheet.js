import { $, setHidden } from '../core/dom.js';
import { selectIncidents, selectRevisions } from '../state/selectors.js';
import { mountIncidentsPane } from './panes/incidents.js';
import { mountHistoryPane } from './panes/history.js';
import { mountSettingsPane } from './panes/settings.js';
import { mountReportPane, reportTitle } from './panes/report.js';

const TITLES = {
  settings: '⚙️ Mapa y datos'
};

/**
 * Hoja inferior única. Cada panel (incidentes, historial, ajustes, reporte) vive en `panes/` y pinta su
 * contenido; la hoja solo decide cuál mostrar y dibuja el título y las pestañas.
 */
export function mountSheet({ store, actions, incidents }) {
  const panes = {
    incidents: $('paneIncidents'),
    history: $('paneHistory'),
    settings: $('paneSettings'),
    report: $('paneReport')
  };

  $('btnCloseSheet').addEventListener('click', () => actions.closeSheet());
  $('sheetBackdrop').addEventListener('click', () => actions.closeSheet());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') actions.closeSheet();
  });

  mountIncidentsPane({ store, actions, renderTabs });
  mountHistoryPane({ store, incidents, renderTabs });
  mountSettingsPane({ store, actions, incidents });
  mountReportPane({ store, actions });

  // ----- Visibilidad ------------------------------------------------------------
  store.subscribe((s) => [s.ui.sheet, s.draft?.editingId, s.draft?.number], ([sheet]) => {
    setHidden($('sheet'), !sheet);
    setHidden($('sheetBackdrop'), !sheet);
    $('sheet').classList.toggle('sheet-tall', sheet === 'report');
    for (const [name, el] of Object.entries(panes)) setHidden(el, name !== sheet);

    renderTabs(sheet);
    $('sheetTitle').textContent = sheet === 'report' ? reportTitle(store.get().draft) : TITLES[sheet] || '';
  });

  function renderTabs(sheet) {
    const tabs = $('sheetTabs');
    if (sheet !== 'incidents' && sheet !== 'history') {
      tabs.innerHTML = '';
      return;
    }
    const state = store.get();
    tabs.innerHTML = `
      <button class="tab ${sheet === 'incidents' ? 'active' : ''}" data-tab="incidents" type="button">📋 Incidentes (${selectIncidents(state).length})</button>
      <button class="tab ${sheet === 'history' ? 'active' : ''}" data-tab="history" type="button">🕓 Historial (${selectRevisions(state).length})</button>`;
    tabs.querySelectorAll('.tab').forEach((btn) =>
      btn.addEventListener('click', () => actions.openSheet(btn.dataset.tab))
    );
  }
}
