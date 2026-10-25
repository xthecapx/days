import { $, showToast } from './core/dom.js';
import { createStore } from './state/store.js';
import { createInitialState } from './state/initialState.js';
import { selectHeatmap, selectIncidents } from './state/selectors.js';
import { createIncidentService } from './services/incidentService.js';
import { createActions } from './state/actions.js';
import { createCamera } from './map/camera.js';
import { createMapRenderer } from './map/mapRenderer.js';
import { loadMapData, createSectorNamer } from './map/mapData.js';
import { mountMapInput } from './ui/mapInput.js';
import { mountHud } from './ui/hud.js';
import { mountSheet } from './ui/sheet.js';
import { createGps } from './services/gps.js';
import { createWhatsApp } from './services/whatsapp.js';
import { startDayClock } from './core/clock.js';
import { createSignalApi } from './services/signalApi.js';
import { createSignalService } from './services/signalService.js';
import { resolveSignalConfig } from './domain/signals.js';
import { readSignalPrefs, writeSignalPrefs, readSignalOverride } from './storage/localCache.js';
import { gpsToPixel } from './map/gpsGrid.js';

/**
 * Composición de la app (único lugar donde se conectan las piezas):
 *   store      → estado único, con suscripción por selectores
 *   services   → casos de uso sobre los datos (persistencia)
 *   actions    → operaciones de la app (cámara + store + services)
 *   ui/*       → componentes que leen el store y llaman a actions
 *   map/*      → cámara + renderer por capas (sin conocer el DOM de la HUD)
 */
async function boot() {
  const world = await loadMapData();
  const sectorName = createSectorNamer(world);
  const store = createStore(createInitialState());
  const camera = createCamera();
  const incidents = createIncidentService(store, { sectorName });
  const gps = createGps();
  const actions = createActions({ store, camera, incidents, gps, world, sectorName });
  const whatsapp = createWhatsApp({
    gps,
    sectorAt: (lat, lng) => {
      const tile = gpsToPixel(lat, lng);
      return tile.insideBounds ? sectorName(tile.pixelX, tile.pixelY) : null;
    }
  });
  // Señal de ayuda: servidor aparte. `vite dev` usa el servidor local y la sala "dev" (nunca la de producción).
  const signalConfig = resolveSignalConfig({ dev: Boolean(import.meta.env?.DEV), hostname: location.hostname, override: readSignalOverride() });
  const signals = createSignalService({
    store, gps,
    api: createSignalApi(signalConfig),
    prefs: { read: readSignalPrefs, write: writeSignalPrefs },
    onNew: (fresh) => {
      showToast(`🆘 ${fresh.length > 1 ? `${fresh.length} vecinos piden ayuda` : 'Un vecino pide ayuda'}`, 8000);
      navigator.vibrate?.([200, 100, 200]);
    }
  });
  const viewport = $('mapViewport');
  const renderer = createMapRenderer($('mapCanvas'), world);

  const fit = () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    renderer.resize(vw, vh);
    camera.resize(vw, vh);
  };
  fit();
  window.addEventListener('resize', fit);

  mountMapInput({ viewport, tooltip: $('mapHoverTooltip'), store, camera, actions, sectorName });
  mountHud({ store, camera, actions, gps, whatsapp, sectorName });
  mountSheet({ store, actions, signals });

  await incidents.load();
  actions.goHome();
  startDayClock(store); // "hoy" sigue al reloj (medianoche y al volver a la pestaña)
  signals.start(); // una lectura al abrir; sondea cada 30 s solo si la persona activó la escucha
  if (new URLSearchParams(location.search).get('sos') === '1' && store.get().signals.enabled) actions.openSheet('help'); // acceso directo desde el icono
  gps.start(); // una sola lectura al cargar; después solo se relee si la posición venció

  requestAnimationFrame(function loop(ts) {
    const state = store.get();
    renderer.frame({
      camera: camera.state,
      heatmap: selectHeatmap(state),
      incidents: selectIncidents(state),
      selection: state.selection,
      settings: state.settings,
      helpSignals: state.signals.active,
      mineHelpId: state.signals.mine?.id ?? null,
      phase: ts / 1000
    });
    requestAnimationFrame(loop);
  });

  // Útil para depurar desde la consola; no se expone en el sitio publicado.
  if (import.meta.env?.DEV) window.__app = { store, camera, actions, gps, world, signals };
}

/** Si algo falla al arrancar, se avisa en pantalla con un botón para reintentar (en vez de dejarla en blanco). */
function showBootError(err) {
  console.error('No se pudo iniciar la app', err);
  $('bootErrorText').textContent = navigator.onLine === false
    ? 'Sin conexión. Conéctate a internet e inténtalo de nuevo.'
    : 'Revisa tu conexión e inténtalo de nuevo.';
  $('bootError').classList.remove('hidden');
}

$('btnRetryBoot').addEventListener('click', () => window.location.reload());
boot().catch(showBootError);
