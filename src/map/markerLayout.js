import { TILE_SIZE } from './worldSize.js';

/**
 * Dónde cae la etiqueta de cada incidente y qué toca un dedo. Es geometría pura (sin canvas ni DOM):
 * la comparten el dibujo (render/markers.js) y los gestos (ui/mapInput.js), así lo que se ve y lo que
 * responde al toque nunca se desfasan.
 */

export const markerScale = (zoom) => 1 / Math.max(0.8, Math.min(zoom, 3));
export const MARKER_BOX = { h: 17 };

/** Ancho de la etiqueta en unidades de pantalla: crece con los dígitos y con el 👮 de los casos resueltos. */
export function markerWidth(inc) {
  const digits = String(inc.number ?? '').length;
  return 10 + digits * 7 + (inc.resolvedBy === 'policia' ? 10 : 0);
}

/** Desplazamiento (en unidades de mundo) de la etiqueta de cada incidente; evita que se encimen. */
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
 * Incidente tocado en el punto `world` ({x, y} en unidades de mundo): el que tiene su etiqueta o su píxel
 * más cerca. Devuelve null si el toque no cae en ninguno.
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
