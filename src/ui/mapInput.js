import { GRID_WIDTH, GRID_HEIGHT, pixelToGps } from '../map/gpsGrid.js';
import { layoutMarkers, markerWidth, MARKER_BOX } from '../map/render/markers.js';
import { TILE_SIZE } from '../map/worldSize.js';
import { selectHeatmap, selectIncidents } from '../state/selectors.js';
import { escapeHtml } from '../core/dom.js';
import { ZOOM } from '../core/config.js';

const TAP_SLOP = 8; // px de movimiento tolerado para seguir contando como "tap"

/** Contenido del cuadro que aparece al pasar el mouse por un tile. Puro; los estilos viven en base.css (.tip-*). */
export function hoverHtml(tile, cell, sector) {
  const gps = pixelToGps(tile.x, tile.y);
  let html = `<div><strong>Píxel (${tile.x}, ${tile.y})</strong> · <span class="tip-coords">${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}</span></div>`;
  html += `<div class="tip-sector">${escapeHtml(sector)}</div>`;
  for (const item of cell?.incidents || []) {
    const calm = item.impactType === 'tranquilidad';
    const dist = item.distance === 0 ? 'Epicentro en este píxel' : `A ${item.distance} px del punto`;
    html += `<div class="tip-incident"><span class="tip-title ${calm ? 'tip-calm' : 'tip-danger'}">#${item.number} (${escapeHtml(item.dateLabel)})</span><br/>${escapeHtml(item.description)}<br/><small class="tip-dist">${dist}</small></div>`;
  }
  return html;
}

/** Gestos del mapa: arrastre, pellizco, rueda, tap y hover de escritorio. */
export function mountMapInput({ viewport, tooltip, store, camera, actions, sectorName }) {
  const pointers = new Map();
  let startPan = { x: 0, y: 0 };
  let startPt = { x: 0, y: 0 };
  let moved = 0;
  let pinch = null;

  const tileAt = (cx, cy) => camera.screenToTile(cx, cy, GRID_WIDTH, GRID_HEIGHT);

  /** Un tap cuenta como "tocó un incidente" si cae en su etiqueta o cerca de su píxel. */
  function incidentAt(cx, cy) {
    const { zoom } = camera.state;
    const world = camera.screenToWorld(cx, cy);
    const incidents = selectIncidents(store.get());
    const offsets = layoutMarkers(incidents, zoom);
    const s = 1 / Math.max(0.8, Math.min(zoom, 3));
    const pad = 6 * s;
    let best = null;
    let bestD = Infinity;
    for (const inc of incidents) {
      const px = (inc.pixelX + 0.5) * TILE_SIZE;
      const py = (inc.pixelY + 0.5) * TILE_SIZE;
      const { dx, dy } = offsets.get(inc.id);
      const inBox =
        Math.abs(world.x - (px + dx)) <= (markerWidth(inc) * s) / 2 + pad &&
        Math.abs(world.y - (py + dy)) <= (MARKER_BOX.h * s) / 2 + pad;
      const d = Math.hypot(world.x - px, world.y - py);
      const nearPin = d <= 14 * s;
      if ((inBox || nearPin) && d < bestD) {
        best = inc;
        bestD = d;
      }
    }
    return best;
  }

  function showHover(clientX, clientY, tile) {
    const cell = selectHeatmap(store.get()).grid[tile.y * GRID_WIDTH + tile.x];
    tooltip.innerHTML = hoverHtml(tile, cell, sectorName(tile.x, tile.y));
    tooltip.classList.remove('hidden');
    tooltip.style.left = `${Math.min(window.innerWidth - 270, Math.max(10, clientX + 12))}px`;
    tooltip.style.top = `${Math.min(window.innerHeight - 160, Math.max(90, clientY - 20))}px`;
  }

  viewport.addEventListener('pointerdown', (e) => {
    actions.dismissOverlays();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    viewport.setPointerCapture(e.pointerId);
    if (pointers.size === 1) {
      moved = 0;
      startPt = { x: e.clientX, y: e.clientY };
      startPan = { x: camera.state.panX, y: camera.state.panY };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      pinch = {
        dist: Math.hypot(b.x - a.x, b.y - a.y),
        zoom: camera.state.zoom,
        world: camera.screenToWorld(mid.x, mid.y)
      };
    }
  });

  viewport.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2 && pinch && pinch.dist > 10) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const z = pinch.zoom * (dist / pinch.dist);
      // Se fija el punto del mundo bajo los dedos; camera.set aplica los límites.
      const clamped = Math.max(ZOOM.min, Math.min(ZOOM.max, z));
      camera.set(clamped, mid.x - pinch.world.x * clamped, mid.y - pinch.world.y * clamped);
      moved = 99;
      return;
    }

    if (e.pointerType === 'mouse' && pointers.size === 0) {
      const tile = tileAt(e.clientX, e.clientY);
      store.patch('selection', { hovered: tile });
      if (tile) showHover(e.clientX, e.clientY, tile);
      else tooltip.classList.add('hidden');
      return;
    }

    if (pointers.size === 1) {
      const dx = e.clientX - startPt.x;
      const dy = e.clientY - startPt.y;
      moved = Math.max(moved, Math.hypot(dx, dy));
      if (moved > 4) camera.set(camera.state.zoom, startPan.x + dx, startPan.y + dy);
    }
  });

  viewport.addEventListener('pointerup', (e) => {
    pointers.delete(e.pointerId);
    try { viewport.releasePointerCapture(e.pointerId); } catch { /* ya liberado */ }

    if (pointers.size === 1) {
      const rest = [...pointers.values()][0];
      startPt = { ...rest };
      startPan = { x: camera.state.panX, y: camera.state.panY };
      pinch = null;
      return;
    }
    pinch = null;

    if (pointers.size === 0 && moved < TAP_SLOP) {
      const hit = incidentAt(e.clientX, e.clientY);
      const tile = hit ? { x: hit.pixelX, y: hit.pixelY } : tileAt(e.clientX, e.clientY);
      if (tile) actions.tapTile(tile.x, tile.y, hit);
    }
  });

  viewport.addEventListener('pointercancel', (e) => {
    pointers.delete(e.pointerId);
    pinch = null;
  });

  viewport.addEventListener('pointerleave', () => {
    tooltip.classList.add('hidden');
    store.patch('selection', { hovered: null });
  });

  viewport.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      camera.zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX, e.clientY);
    },
    { passive: false }
  );
}
