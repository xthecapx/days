import { $, setHidden } from '../core/dom.js';
import { selectIncidents, findIncident, selectSosMode, selectHistoryVisible } from '../state/selectors.js';
import { mountInsets } from './insets.js';
import { mountAlertCard } from './alertCard.js';
import { mountQuakeRow } from './quakeRow.js';
import { mountPeek } from './peek.js';
import { mountSyncToast } from './syncToast.js';
import { mountHelpBanner } from './helpBanner.js';
import { listenersLabel, helpButtonView, listenBarText } from '../domain/signals.js';

/**
 * Top bar, mode banner, map controls and bottom area (card + navigation).
 * Each piece lives in its own file; here they are only wired together and the simple controls remain.
 */
export function mountHud({ store, camera, actions, sectorName }) {
  const measureInsets = mountInsets({ camera });
  mountAlertCard({ store, actions, measureInsets });
  mountQuakeRow({ store, measureInsets });
  mountPeek({ store, actions, measureInsets, sectorName });
  mountSyncToast({ store });
  mountHelpBanner({ store, actions });

  // ----- Map controls and navigation --------------------------------------
  $('btnZoomIn').addEventListener('click', () => camera.zoomBy(1.3));
  $('btnZoomOut').addEventListener('click', () => camera.zoomBy(1 / 1.3));
  $('btnHome').addEventListener('click', () => actions.goHome());
  $('btnLocate').addEventListener('click', () => actions.locateMe());

  // 🆘 only exists if this build has a signal server configured; without one, the interface stays as it was before.
  $('btnHelp').addEventListener('click', () => actions.openSheet('help'));
  store.subscribe((s) => [s.signals.enabled, s.signals.loaded, s.signals.listeners], ([enabled, loaded, n]) => {
    const v = helpButtonView({ enabled, loaded, listeners: n });
    setHidden($('btnHelp'), v.hidden);
    setHidden($('helpCount'), v.badgeHidden);
    $('helpCount').textContent = v.badge;
    $('helpCount').classList.toggle('dim', v.badgeDim);
    $('btnHelp').setAttribute('aria-label', v.label);
    setHidden($('listenersChip'), !(enabled && loaded));
    $('listenersChip').textContent = `👂 ${listenersLabel(n)}`;
  });
  $('btnCancelMode').addEventListener('click', () => actions.cancelMode());

  // SOS mode (listening) vs history: either one or the other. While listening, the days card is replaced by a slim bar
  // and the incident markers / heat map are not drawn (see main.js). The history reappears whenever the person starts
  // doing something that needs it (looking at an incident, reporting, picking a point).
  $('listenBar').addEventListener('click', () => actions.openSheet('help'));
  store.subscribe((s) => [selectSosMode(s), selectHistoryVisible(s), s.signals.listeners, s.signals.status, s.signals.enabled], ([sos, history, n, status, enabled]) => {
    const showBar = enabled && sos && !history;
    setHidden($('listenBar'), !showBar);
    setHidden($('alertCard'), showBar);
    $('listenBarText').textContent = listenBarText({ listeners: n, status });
    measureInsets();
  });

  $('navIncidents').addEventListener('click', () => actions.openSheet('incidents'));
  $('navSettings').addEventListener('click', () => actions.openSheet('settings'));
  $('navReport').addEventListener('click', () => actions.openReport());
  store.subscribe((s) => [s.data.incidents], () => {
    $('navCount').textContent = String(selectIncidents(store.get()).length);
  });

  // ----- Banner de modo (mover / ubicar) ----------------------------------------
  store.subscribe((s) => [s.mode, s.ui.sheet], ([mode, sheet]) => {
    setHidden($('modeBanner'), mode.type === 'browse');
    if (mode.type === 'move') {
      const inc = findIncident(store.get(), mode.incidentId);
      $('modeBannerText').textContent = `📍 Moviendo #${inc?.number ?? ''}: toca el nuevo píxel`;
    } else if (mode.type === 'pick') {
      $('modeBannerText').textContent = '🎯 Toca el mapa para ubicar el reporte';
    }
    // With a sheet open the dock is covered by the sheet.
    setHidden($('dock'), Boolean(sheet));
    setHidden($('mapControls'), Boolean(sheet));
    setHidden($('mapCredit'), Boolean(sheet));
  });

  return { measureInsets };
}
