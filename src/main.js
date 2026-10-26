import { $, showToast } from './core/dom.js';
import { createStore } from './state/store.js';
import { createInitialState } from './state/initialState.js';
import { selectHeatmap, selectIncidents, selectHistoryVisible } from './state/selectors.js';
import { createIncidentService } from './services/incidentService.js';
import { createActions } from './state/actions.js';
import { createCamera } from './map/camera.js';
import { createMapRenderer } from './map/mapRenderer.js';
import { loadMapData, createSectorNamer } from './map/mapData.js';
import { mountMapInput } from './ui/mapInput.js';
import { mountHud } from './ui/hud.js';
import { mountSheet } from './ui/sheet.js';
import { startDayClock } from './core/clock.js';
import { createGps } from './services/gps.js';
import { createSignalApi } from './services/signalApi.js';
import { createSignalService } from './services/signalService.js';
import { resolveSignalConfig } from './domain/signals.js';
import { readSignalPrefs, writeSignalPrefs, readSignalOverride } from './storage/localCache.js';

/**
 * App composition (the only place where the pieces are wired together):
 *   store      → single state, with selector-based subscription
 *   services   → use cases over the data (persistence)
 *   actions    → app operations (camera + store + services)
 *   ui/*       → components that read the store and call actions
 *   map/*      → camera + layered renderer (unaware of the HUD DOM)
 */
async function boot() {
  const world = await loadMapData();
  const sectorName = createSectorNamer(world);
  const store = createStore(createInitialState());
  const camera = createCamera();
  const incidents = createIncidentService(store, { sectorName });
  // GPS only for the 📍 button: it is read when that button is tapped, never on page load (no permission prompt at startup).
  const gps = createGps();
  const actions = createActions({ store, camera, incidents, gps, world, sectorName });
  // Help signal: separate server, a single board. `vite dev` uses the local server (the published one does not accept localhost).
  const signalConfig = resolveSignalConfig({ dev: Boolean(import.meta.env?.DEV), hostname: location.hostname, override: readSignalOverride() });
  const signals = createSignalService({
    store,
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
  mountHud({ store, camera, actions, sectorName });
  mountSheet({ store, actions, signals });

  await incidents.load();
  actions.goHome();
  startDayClock(store); // "today" follows the clock (midnight and when returning to the tab)
  signals.start(); // one read on open; polls every 30 s only if the person turned listening on

  requestAnimationFrame(function loop(ts) {
    const state = store.get();
    const history = selectHistoryVisible(state);
    renderer.frame({
      camera: camera.state,
      // In SOS mode the heat map is not even computed.
      heatmap: history ? selectHeatmap(state) : null,
      incidents: history ? selectIncidents(state) : [],
      selection: state.selection,
      settings: state.settings,
      helpSignals: state.signals.active,
            phase: ts / 1000
    });
    requestAnimationFrame(loop);
  });

  // Useful for debugging from the console; not exposed on the published site.
  if (import.meta.env?.DEV) window.__app = { store, camera, actions, world, signals };
}

/** If something fails at startup, it is reported on screen with a retry button (instead of leaving it blank). */
function showBootError(err) {
  console.error('Could not start the app', err);
  $('bootErrorText').textContent = navigator.onLine === false
    ? 'Sin conexión. Conéctate a internet e inténtalo de nuevo.'
    : 'Revisa tu conexión e inténtalo de nuevo.';
  $('bootError').classList.remove('hidden');
}

$('btnRetryBoot').addEventListener('click', () => window.location.reload());
boot().catch(showBootError);
