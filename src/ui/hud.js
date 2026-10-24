import { $, setHidden } from '../core/dom.js';
import { selectIncidents, findIncident } from '../state/selectors.js';
import { mountInsets } from './insets.js';
import { mountAlertCard } from './alertCard.js';
import { mountPeek } from './peek.js';
import { mountWhatsAppMenu } from './whatsappMenu.js';

/**
 * Barra superior, banner de modo, controles del mapa y zona inferior (tarjeta + navegación).
 * Cada pieza vive en su archivo; aquí solo se conectan y quedan los controles sencillos.
 */
export function mountHud({ store, camera, actions, gps, whatsapp }) {
  const measureInsets = mountInsets({ camera });
  mountAlertCard({ store, actions, measureInsets });
  mountPeek({ store, actions, measureInsets });
  mountWhatsAppMenu({ store, gps, whatsapp });

  // ----- Controles del mapa y navegación --------------------------------------
  $('btnZoomIn').addEventListener('click', () => camera.zoomBy(1.3));
  $('btnZoomOut').addEventListener('click', () => camera.zoomBy(1 / 1.3));
  $('btnHome').addEventListener('click', () => actions.goHome());
  $('btnLocate').addEventListener('click', () => actions.locateMe());
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
    // Con una hoja abierta el dock queda tapado por la hoja.
    setHidden($('dock'), Boolean(sheet));
    setHidden($('mapControls'), Boolean(sheet));
    setHidden($('mapCredit'), Boolean(sheet));
  });

  return { measureInsets };
}
