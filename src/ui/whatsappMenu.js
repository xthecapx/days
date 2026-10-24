import { $, setHidden, showToast } from '../core/dom.js';
import { pixelToGps } from '../map/gpsGrid.js';
import { detectSectorName } from '../map/mapData.js';

// Punto de estado del GPS sobre el botón: verde = listo, ámbar = buscando o vencido, rojo = no disponible.
export const GPS_LABELS = {
  ok: 'GPS listo',
  searching: 'Buscando GPS…',
  stale: 'GPS desactualizado: se actualiza al usarlo',
  denied: 'GPS bloqueado: permite la ubicación en Ajustes > Safari',
  unavailable: 'GPS no disponible'
};

/** Mensaje cuando WhatsApp se abrió sin ubicación. Puro: no toca el DOM. */
export const noLocationMessage = (error) =>
  `Se abrió WhatsApp sin ubicación: ${
    error === 'denied' ? 'permiso de ubicación denegado (Ajustes > Safari > Ubicación)' : 'sin señal GPS'
  }`;

/**
 * Botón de WhatsApp: el icono abre un menú de dos acciones; nada se envía sin que la persona pulse enviar
 * en WhatsApp. También pinta el punto de estado del GPS.
 */
export function mountWhatsAppMenu({ store, gps, whatsapp }) {
  gps.subscribe((status, fix) => {
    const dot = $('gpsDot');
    dot.dataset.status = status;
    const acc = status === 'ok' && fix?.accuracy ? ` (±${fix.accuracy} m)` : '';
    dot.title = GPS_LABELS[status] + acc;
    $('btnWhatsapp').setAttribute('aria-label', `Compartir por WhatsApp. ${GPS_LABELS[status]}${acc}`);
  });

  const waMenu = $('waMenu');
  const closeWaMenu = () => {
    setHidden(waMenu, true);
    $('btnWhatsapp').setAttribute('aria-expanded', 'false');
  };
  $('btnWhatsapp').addEventListener('click', (e) => {
    e.stopPropagation();
    const open = waMenu.classList.contains('hidden');
    setHidden(waMenu, !open);
    $('btnWhatsapp').setAttribute('aria-expanded', String(open));
    if (open) {
      $('waHelp').focus();
      gps.ensureFresh();
    }
  });
  document.addEventListener('click', (e) => {
    if (!waMenu.contains(e.target)) closeWaMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeWaMenu();
  });
  $('mapViewport').addEventListener('pointerdown', closeWaMenu);

  const clearWaBusy = () => $('waHelp').removeAttribute('aria-busy');
  // Al volver de WhatsApp Safari restaura la página (bfcache) tal como quedó: sin esto el
  // botón seguiría "ocupado" y la segunda vez no haría nada.
  window.addEventListener('pageshow', clearWaBusy);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) clearWaBusy();
  });

  $('waHelp').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (btn.getAttribute('aria-busy') === 'true') return;
    closeWaMenu();
    if (gps.fix()) return void whatsapp.sendAlert(); // navega dentro del toque
    btn.setAttribute('aria-busy', 'true');
    showToast('Obteniendo tu ubicación…', 9000);
    try {
      const { located, error } = await whatsapp.sendAlert();
      if (!located) showToast(noLocationMessage(error), 7000);
    } finally {
      clearWaBusy();
    }
  });

  $('waShare').addEventListener('click', () => {
    closeWaMenu();
    const { pixel } = store.get().selection;
    const point = pixelToGps(pixel.x, pixel.y);
    whatsapp.sharePoint({ lat: point.lat, lng: point.lng }, detectSectorName(point.pixelX, point.pixelY));
  });
}
