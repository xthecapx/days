import { $, setHidden } from '../core/dom.js';
import { selectIncidents, findIncident } from '../state/selectors.js';
import { mountInsets } from './insets.js';
import { mountAlertCard } from './alertCard.js';
import { mountPeek } from './peek.js';
import { mountWhatsAppMenu } from './whatsappMenu.js';
import { mountSyncToast } from './syncToast.js';
import { mountHelpBanner } from './helpBanner.js';
import { listenersLabel, helpButtonView } from '../domain/signals.js';

/**
 * Top bar, mode banner, map controls and bottom area (card + navigation).
 * Each piece lives in its own file; here they are only wired together and the simple controls remain.
 */
export function mountHud({ store, camera, actions, gps, whatsapp, sectorName }) {
  const measureInsets = mountInsets({ camera });
  mountAlertCard({ store, actions, measureInsets });
  mountPeek({ store, actions, measureInsets, sectorName });
  mountWhatsAppMenu({ store, gps, whatsapp, sectorName });
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
