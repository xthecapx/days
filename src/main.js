import { $ } from './core/dom.js';
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
  mountSheet({ store, actions });

  await incidents.load();
  actions.goHome();
  startDayClock(store); // "hoy" sigue al reloj (medianoche y al volver a la pestaña)
  gps.start(); // una sola lectura al cargar; después solo se relee si la posición venció

  requestAnimationFrame(function loop(ts) {
    const state = store.get();
    renderer.frame({
      camera: camera.state,
      heatmap: selectHeatmap(state),
      incidents: selectIncidents(state),
      selection: state.selection,
      settings: state.settings,
      phase: ts / 1000
    });
    requestAnimationFrame(loop);
  });

  // Útil para depurar desde la consola del navegador.
  window.__app = { store, camera, actions, gps, world };
}

boot();
