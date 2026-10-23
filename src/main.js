import { $ } from './core/dom.js';
import { createStore } from './state/store.js';
import { createInitialState } from './state/initialState.js';
import { selectHeatmap, selectIncidents } from './state/selectors.js';
import { createIncidentService } from './services/incidentService.js';
import { createActions } from './state/actions.js';
import { createCamera } from './map/camera.js';
import { createMapRenderer } from './map/mapRenderer.js';
import { loadMapData } from './map/mapData.js';
import { mountMapInput } from './ui/mapInput.js';
import { mountHud } from './ui/hud.js';
import { mountSheet } from './ui/sheet.js';

/**
 * Composición de la app (único lugar donde se conectan las piezas):
 *   store      → estado único, con suscripción por selectores
 *   services   → casos de uso sobre los datos (persistencia)
 *   actions    → operaciones de la app (cámara + store + services)
 *   ui/*       → componentes que leen el store y llaman a actions
 *   map/*      → cámara + renderer por capas (sin conocer el DOM de la HUD)
 */
async function boot() {
  const store = createStore(createInitialState());
  const camera = createCamera();
  const incidents = createIncidentService(store);
  const actions = createActions({ store, camera, incidents });
  const viewport = $('mapViewport');
  const world = await loadMapData();
  const renderer = createMapRenderer($('mapCanvas'), world);

  const fit = () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    renderer.resize(vw, vh);
    camera.resize(vw, vh);
  };
  fit();
  window.addEventListener('resize', fit);

  mountMapInput({ viewport, tooltip: $('mapHoverTooltip'), store, camera, actions });
  mountHud({ store, camera, actions });
  mountSheet({ store, actions, incidents });

  await incidents.load();
  actions.goHome();

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
  window.__app = { store, camera, actions };
}

boot();
