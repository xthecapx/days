import { $, setHidden, showToast } from '../core/dom.js';
import { pixelToGps } from '../map/gpsGrid.js';
import { detectSectorName } from '../map/mapData.js';
import { calculateDaysSince, latestIncident } from '../domain/incident.js';
import { selectHeatmap, selectIncidents, findIncident } from '../state/selectors.js';

/** Barra superior, banner de modo, controles del mapa y zona inferior (tarjeta + navegación). */
export function mountHud({ store, camera, actions, gps, whatsapp }) {
  // ----- Eventos ------------------------------------------------------------
  $('alertToggle').addEventListener('click', () => actions.toggleAlert());
  $('btnZoomIn').addEventListener('click', () => camera.zoomBy(1.3));
  $('btnZoomOut').addEventListener('click', () => camera.zoomBy(1 / 1.3));
  $('btnHome').addEventListener('click', () => actions.goHome());
  $('btnLocate').addEventListener('click', () => actions.locateMe());
  $('btnCancelMode').addEventListener('click', () => actions.cancelMode());

  $('navIncidents').addEventListener('click', () => actions.openSheet('incidents'));
  $('navSettings').addEventListener('click', () => actions.openSheet('settings'));
  $('navReport').addEventListener('click', () => actions.openReport());
  // Punto de estado del GPS sobre el botón de WhatsApp: verde = listo, ámbar = buscando, rojo = no disponible.
  const GPS_LABELS = {
    ok: 'GPS listo',
    searching: 'Buscando GPS…',
    stale: 'GPS desactualizado: se actualiza al usarlo',
    denied: 'GPS bloqueado: permite la ubicación en Ajustes > Safari',
    unavailable: 'GPS no disponible'
  };
  gps.subscribe((status, fix) => {
    const dot = $('gpsDot');
    dot.dataset.status = status;
    const acc = status === 'ok' && fix?.accuracy ? ` (±${fix.accuracy} m)` : '';
    dot.title = GPS_LABELS[status] + acc;
    $('btnWhatsapp').setAttribute('aria-label', `Compartir por WhatsApp. ${GPS_LABELS[status]}${acc}`);
  });

  // WhatsApp: el icono abre un menú de dos acciones; nada se envía sin que la persona pulse enviar en WhatsApp.
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
      const { located } = await whatsapp.sendAlert();
      if (!located) {
        const why = gps.error() === 'denied' ? 'permiso de ubicación denegado (Ajustes > Safari > Ubicación)' : 'sin señal GPS';
        showToast(`Se abrió WhatsApp sin ubicación: ${why}`, 7000);
      }
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

  $('btnClosePeek').addEventListener('click', () => actions.showPopup(null));
  const popupIncident = () => findIncident(store.get(), store.get().ui.popupIncidentId);
  $('btnPeekEdit').addEventListener('click', () => {
    const inc = popupIncident();
    if (inc) actions.openReport({ incident: inc });
  });
  $('btnPeekMove').addEventListener('click', () => {
    const inc = popupIncident();
    if (inc) actions.startMove(inc);
  });
  $('btnPeekConfirm').addEventListener('click', () => {
    const inc = popupIncident();
    if (inc) actions.confirmIncident(inc.id);
  });

  // ----- Render reactivo ------------------------------------------------------
  store.subscribe(
    (s) => [s.data.incidents, s.settings.referenceDate, s.settings.decayMode, s.draft],
    () => renderAlert(store.get())
  );
  store.subscribe((s) => [s.ui.alertExpanded], ([open]) => {
    setHidden($('alertDetails'), !open);
    $('alertChevron').textContent = open ? '▴' : '▾';
    $('alertToggle').setAttribute('aria-expanded', String(open));
    measureInsets();
  });
  store.subscribe((s) => [s.selection.pixel], ([pixel]) => {
    const gps = pixelToGps(pixel.x, pixel.y);
    $('pixelCoord').textContent = `Píxel (${gps.pixelX}, ${gps.pixelY})`;
    $('pixelSector').textContent = detectSectorName(gps.pixelX, gps.pixelY);
  });
  store.subscribe((s) => [s.ui.popupIncidentId, s.data.incidents], () => {
    const inc = popupIncident();
    setHidden($('peekIncident'), !inc);
    $('peek').classList.toggle('has-incident', Boolean(inc));
    if (inc) {
      $('peekTitle').textContent = `#${inc.number} · ${inc.dateLabel || inc.date}${inc.resolvedBy === 'policia' ? ' · 👮 Resuelto' : ''}`;
      $('peekDesc').textContent = inc.description;
      $('btnPeekConfirm').textContent = `👍 Confirmar (${inc.confirmations || 1})`;
    }
    measureInsets();
  });
  store.subscribe((s) => [s.mode, s.ui.sheet], ([mode, sheet]) => {
    const active = mode.type !== 'browse';
    setHidden($('modeBanner'), !active);
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

  window.addEventListener('resize', measureInsets);
  new ResizeObserver(measureInsets).observe($('dock'));
  new ResizeObserver(measureInsets).observe($('alertCard'));

  /** Mide la HUD para que el centro de la cámara sea el centro de la zona realmente libre. */
  function measureInsets() {
    const top = $('alertCard').getBoundingClientRect().bottom + 6;
    const dockHidden = $('dock').classList.contains('hidden');
    const dockTop = dockHidden ? window.innerHeight : $('dock').getBoundingClientRect().top;
    camera.setInsets(top, Math.max(0, window.innerHeight - dockTop + 6));
    document.documentElement.style.setProperty(
      '--controls-bottom',
      `${Math.max(120, window.innerHeight - dockTop + 8)}px`
    );
  }

  function renderAlert(state) {
    const incidents = selectIncidents(state);
    $('navCount').textContent = String(incidents.length);
    $('redPixels').textContent = `🔴 ${selectHeatmap(state).affectedPixelsCount} px`;

    const latest = latestIncident(incidents);
    if (!latest) {
      $('daysValue').textContent = '--';
      $('daysLabel').textContent = 'DÍAS DESDE EL ÚLTIMO INCIDENTE';
      $('alertPreview').textContent = 'Sin incidentes registrados.';
      $('latestDesc').textContent = 'Sin incidentes registrados.';
      return;
    }
    const days = calculateDaysSince(latest.date, state.settings.referenceDate);
    $('daysValue').textContent = String(days).padStart(2, '0');
    $('daysLabel').textContent = days === 1 ? 'DÍA DESDE EL ÚLTIMO INCIDENTE' : 'DÍAS DESDE EL ÚLTIMO INCIDENTE';
    $('alertPreview').textContent = `#${latest.number}: ${latest.description}`;
    $('latestDate').textContent = latest.dateLabel || latest.date;
    $('latestDesc').textContent = `#${latest.number}: ${latest.description}`;
    $('latestLocation').textContent = `📍 ${latest.sector}`;
    $('btnFocusLatest').onclick = () => actions.focusIncident(latest);
  }

  measureInsets();
  return { measureInsets };
}
