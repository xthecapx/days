import { TILE_SIZE } from '../worldSize.js';
import { isTranquilityIncident } from '../heatmapEngine.js';

const markerScale = (zoom) => 1 / Math.max(0.8, Math.min(zoom, 3));
export const MARKER_BOX = { w: 24, h: 17 };

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
      offsets.set(cur.id, { dx: (idx - mid) * 27 * s, dy: (idx % 2 ? -34 : -17) * s });
    }
  }
  return offsets;
}

/**
 * Marcadores de incidente. Se dibujan en espacio de mundo pero con tamaño
 * compensado por el zoom, para que sean tocables con el dedo.
 */
export function drawIncidentMarkers(ctx, incidents, selectedId, phase, zoom) {
  const s = markerScale(zoom);
  const boxW = MARKER_BOX.w * s;
  const boxH = MARKER_BOX.h * s;
  const offsets = layoutMarkers(incidents, zoom);

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${11 * s}px "JetBrains Mono", monospace`;

  // El seleccionado va último para quedar encima.
  const ordered = [...incidents].sort((a, b) => (a.id === selectedId) - (b.id === selectedId));
  for (const inc of ordered) {
    const px = (inc.pixelX + 0.5) * TILE_SIZE;
    const py = (inc.pixelY + 0.5) * TILE_SIZE;
    const selected = inc.id === selectedId;
    const calm = isTranquilityIncident(inc);
    const { dx, dy } = offsets.get(inc.id);
    const bx = px + dx - boxW / 2;
    const by = py + dy - boxH / 2;

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(px, py, 2.4 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.4 * s;
    ctx.strokeStyle = selected ? '#facc15' : '#0f172a';
    ctx.beginPath();
    ctx.moveTo(px + dx, by + boxH);
    ctx.lineTo(px, py);
    ctx.stroke();

    if (selected) {
      const r = (7 + Math.sin(phase * 4) * 1.5) * s;
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 1.6 * s;
      ctx.strokeRect(px - r, py - r, r * 2, r * 2);
    }

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(bx + 1.2 * s, by + 1.2 * s, boxW, boxH);
    ctx.fillStyle = selected ? '#facc15' : calm ? '#fde047' : '#dc2626';
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.lineWidth = 1.4 * s;
    ctx.strokeStyle = selected || calm ? '#0f172a' : '#ffffff';
    ctx.strokeRect(bx, by, boxW, boxH);
    ctx.fillStyle = selected || calm ? '#0f172a' : '#ffffff';
    ctx.fillText(`#${inc.number ?? ''}`, bx + boxW / 2, by + boxH / 2 + 0.5 * s);
  }
  ctx.restore();
}

export function drawSelection(ctx, hovered, selected, phase) {
  if (hovered) {
    const hx = hovered.x * TILE_SIZE;
    const hy = hovered.y * TILE_SIZE;
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.strokeRect(hx - 1, hy - 1, TILE_SIZE + 2, TILE_SIZE + 2);
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 1;
    ctx.strokeRect(hx, hy, TILE_SIZE, TILE_SIZE);
  }
  if (selected) {
    const sx = selected.x * TILE_SIZE;
    const sy = selected.y * TILE_SIZE;
    ctx.fillStyle = 'rgba(250, 204, 21, 0.32)';
    ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
    ctx.strokeStyle = Math.sin(phase * 5) > 0 ? '#facc15' : '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(sx - 1, sy - 1, TILE_SIZE + 2, TILE_SIZE + 2);
  }
}
