import { $, setHidden } from '../core/dom.js';
import { mountIncidentsPane } from './panes/incidents.js';
import { mountSettingsPane } from './panes/settings.js';
import { mountReportPane, reportTitle } from './panes/report.js';
import { mountHelpPane } from './panes/help.js';

const TITLES = {
  incidents: '📋 Incidentes',
  settings: '⚙️ Mapa',
  help: '🆘 Ayuda entre vecinos'
};

/**
 * Hoja inferior única. Cada panel (incidentes, ajustes, reporte) vive en `panes/` y pinta su contenido;
 * la hoja solo decide cuál mostrar y dibuja el título.
 */
export function mountSheet({ store, actions, signals }) {
  const panes = {
    incidents: $('paneIncidents'),
    settings: $('paneSettings'),
    help: $('paneHelp'),
    report: $('paneReport')
  };

  $('btnCloseSheet').addEventListener('click', () => actions.closeSheet());
  $('sheetBackdrop').addEventListener('click', () => actions.closeSheet());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') actions.closeSheet();
  });

  mountIncidentsPane({ store, actions });
  mountSettingsPane({ store });
  mountReportPane({ store, actions });
  mountHelpPane({ store, actions, signals });

  store.subscribe((s) => [s.ui.sheet, s.draft?.editingId, s.draft?.number], ([sheet]) => {
    setHidden($('sheet'), !sheet);
    setHidden($('sheetBackdrop'), !sheet);
    $('sheet').classList.toggle('sheet-tall', sheet === 'report');
    for (const [name, el] of Object.entries(panes)) setHidden(el, name !== sheet);
    $('sheetTitle').textContent = sheet === 'report' ? reportTitle(store.get().draft) : TITLES[sheet] || '';
  });
}
