import { GRID_WIDTH, GRID_HEIGHT, pixelToGps } from '../map/gpsGrid.js';
import { incidentAtPoint } from '../map/markerLayout.js';
import { selectHeatmap, selectIncidents, selectHistoryVisible } from '../state/selectors.js';
import { escapeHtml, toNumber } from '../core/dom.js';
import { ZOOM } from '../core/config.js';

const TAP_SLOP = 8; // px of movement tolerated to still count as a "tap"

/** Content of the box shown when hovering over a tile. Pure; the styles live in base.css (.tip-*). */
export function hoverHtml(tile, cell, sector) {
  const gps = pixelToGps(tile.x, tile.y);
  let html = `<div><strong>Píxel (${tile.x}, ${tile.y})</strong> · <span class="tip-coords">${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}</span></div>`;
  html += `<div class="tip-sector">${escapeHtml(sector)}</div>`;
  for (const item of cell?.incidents || []) {
    const calm = item.impactType === 'tranquilidad';
    const distance = toNumber(item.distance);
    const dist = distance === 0 ? 'Epicentro en este píxel' : `A ${distance} px del punto`;
    html += `<div class="tip-incident"><span class="tip-title ${calm ? 'tip-calm' : 'tip-danger'}">#${toNumber(item.number)} (${escapeHtml(item.dateLabel)})</span><br/>${escapeHtml(item.description)}<br/><small class="tip-dist">${dist}</small></div>`;
  }
  return html;
}

/** Map gestures: drag, pinch, wheel, tap and desktop hover. */
export function mountMapInput({ viewport, tooltip, store, camera, actions, sectorName }) {
  const pointers = new Map();
  let startPan = { x: 0, y: 0 };
  let startPt = { x: 0, y: 0 };
  let moved = 0;
  let pinch = null;

  const tileAt = (cx, cy) => camera.screenToTile(cx, cy, GRID_WIDTH, GRID_HEIGHT);

  /** A tap counts as "touched an incident" if it lands on its label or near its pixel. */
  const incidentAt = (cx, cy) =>
    selectHistoryVisible(store.get())
      ? incidentAtPoint(selectIncidents(store.get()), camera.screenToWorld(cx, cy), camera.state.zoom)
      : null; // in SOS mode the markers are not drawn, so they do not answer taps either

  function showHover(clientX, clientY, tile) {
    const cell = selectHistoryVisible(store.get()) ? selectHeatmap(store.get()).grid[tile.y * GRID_WIDTH + tile.x] : undefined;
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
      // The world point under the fingers is pinned; camera.set applies the limits.
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
