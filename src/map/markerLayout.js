import { TILE_SIZE } from './worldSize.js';

/**
 * Where each incident's label falls and what a finger touches. Pure geometry (no canvas or DOM):
 * shared by drawing (render/markers.js) and gestures (ui/mapInput.js), so what is seen and what
 * responds to touch never drift apart.
 */

export const markerScale = (zoom) => 1 / Math.max(0.8, Math.min(zoom, 3));
export const MARKER_BOX = { h: 17 };

/** Label width in screen units: grows with the digits and with the 👮 of resolved cases. */
export function markerWidth(inc) {
  const digits = String(inc.number ?? '').length;
  return 10 + digits * 7 + (inc.resolvedBy === 'policia' ? 10 : 0);
}

/** Offset (in world units) of each incident's label; keeps them from overlapping. */
export function layoutMarkers(incidents, zoom) {
  const s = markerScale(zoom);
  const sorted = [...incidents].sort((a, b) => a.pixelX - b.pixelX || a.pixelY - b.pixelY);
  const offsets = new Map();
  for (const cur of sorted) {
    const group = sorted.filter((o) => Math.hypot(o.pixelX - cur.pixelX, o.pixelY - cur.pixelY) <= 2.4);
    if (group.length <= 1) {
      offsets.set(cur.id, { dx: 0, dy: -17 * s });
    } else {
      const idx = group.findIndex((n) => n.id === cur.id);
      const mid = (group.length - 1) / 2;
      offsets.set(cur.id, { dx: (idx - mid) * 32 * s, dy: (idx % 2 ? -34 : -17) * s });
    }
  }
  return offsets;
}

/**
 * Incident touched at point `world` ({x, y} in world units): the one whose label or pixel is
 * closest. Returns null if the touch lands on none of them.
 */
export function incidentAtPoint(incidents, world, zoom) {
  const offsets = layoutMarkers(incidents, zoom);
  const s = markerScale(zoom);
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
