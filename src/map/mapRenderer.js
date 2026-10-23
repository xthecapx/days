import { GRID_WIDTH, GRID_HEIGHT } from './gpsGrid.js';
import { WORLD_WIDTH, WORLD_HEIGHT } from './worldSize.js';
import { createBaseMap, BASE_SCALE } from './render/baseMap.js';
import { drawHeat, drawGrid } from './render/heat.js';
import { drawRiverShimmer, drawActors } from './render/actors.js';
import { drawRoadLabels, drawPlaces } from './render/labels.js';
import { drawIncidentMarkers, drawSelection } from './render/markers.js';

/**
 * Lienzo del tamaño de la pantalla (nítido en retina). La cámara se aplica
 * como transformación del contexto, así textos y marcadores se rasterizan a
 * resolución real en vez de escalarse por CSS.
 *
 * Cada capa vive en `render/` como función (ctx, datos) → dibujo; para sumar
 * una capa nueva basta con importarla y agregarla a `frame()`.
 */
export function createMapRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const base = createBaseMap();
  const reference = new Image();
  reference.src = './assets/google-maps-reference.png';
  let dpr = 1;

  function resize(vw, vh) {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    canvas.style.width = `${vw}px`;
    canvas.style.height = `${vh}px`;
  }

  return {
    resize,

    frame({ camera, heatmap, incidents, selection, settings, phase }) {
      const { zoom, panX, panY } = camera;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#c6e8b0';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * panX, dpr * panY);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(base, 0, 0, WORLD_WIDTH * BASE_SCALE, WORLD_HEIGHT * BASE_SCALE, 0, 0, WORLD_WIDTH, WORLD_HEIGHT);

      if (settings.showReference && reference.complete) {
        ctx.globalAlpha = 0.45;
        ctx.drawImage(reference, 0, 0, WORLD_WIDTH, WORLD_HEIGHT);
        ctx.globalAlpha = 1;
      }

      drawRiverShimmer(ctx, phase);
      drawHeat(ctx, heatmap, phase);
      drawActors(ctx, phase);
      if (settings.showGrid) drawGrid(ctx, GRID_WIDTH, GRID_HEIGHT, WORLD_WIDTH, WORLD_HEIGHT);
      drawSelection(ctx, selection.hovered, selection.pixel, phase);
      drawRoadLabels(ctx, zoom);
      drawPlaces(ctx, zoom, phase);
      drawIncidentMarkers(ctx, incidents, selection.incidentId, phase, zoom);
    }
  };
}
