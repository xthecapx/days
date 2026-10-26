import { GRID_WIDTH, GRID_HEIGHT } from './gpsGrid.js';
import { WORLD_WIDTH, WORLD_HEIGHT } from './worldSize.js';
import { createBaseMap, BASE_SCALE } from './render/baseMap.js';
import { drawHeat, drawGrid } from './render/heat.js';
import { createActorLayer } from './render/actors.js';
import { createLabelLayer } from './render/labels.js';
import { drawIncidentMarkers, drawSelection } from './render/markers.js';
import { drawHelpSignals } from './render/helpSignals.js';

/**
 * Screen-sized canvas (crisp on retina). The camera is applied
 * as a context transform, so texts and markers are rasterised at
 * real resolution instead of being scaled by CSS.
 *
 * Each layer lives in `render/` as a function (ctx, data) → drawing; to add
 * a new layer just import it and add it to `frame()`.
 */
export function createMapRenderer(canvas, world) {
  const ctx = canvas.getContext('2d');
  const base = createBaseMap(world);
  const actors = createActorLayer(world);
  const labels = createLabelLayer(world);
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

    frame({ camera, heatmap, incidents, selection, settings, phase, helpSignals = [] }) {
      const { zoom, panX, panY } = camera;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#c6e8b0';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * panX, dpr * panY);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(base, 0, 0, WORLD_WIDTH * BASE_SCALE, WORLD_HEIGHT * BASE_SCALE, 0, 0, WORLD_WIDTH, WORLD_HEIGHT);


      actors.drawRiverShimmer(ctx, phase);
      drawHeat(ctx, heatmap, phase);
      actors.drawActors(ctx, phase);
      if (settings.showGrid) drawGrid(ctx, GRID_WIDTH, GRID_HEIGHT, WORLD_WIDTH, WORLD_HEIGHT);
      drawSelection(ctx, selection.hovered, selection.pixel, phase);
      labels.drawRoadLabels(ctx, zoom);
      labels.drawPlaces(ctx, zoom, phase);
      drawIncidentMarkers(ctx, incidents, selection.incidentId, phase, zoom);
      drawHelpSignals(ctx, helpSignals, phase, zoom); // last: a help alert must be visible above everything
    }
  };
}
