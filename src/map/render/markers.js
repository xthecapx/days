import { TILE_SIZE } from '../worldSize.js';
import { markerScale, markerWidth, layoutMarkers, MARKER_BOX } from '../markerLayout.js';
import { isTranquilityIncident } from '../../domain/incident.js';

/**
 * Marcadores de incidente. Se dibujan en espacio de mundo pero con tamaño
 * compensado por el zoom, para que sean tocables con el dedo.
 */
export function drawIncidentMarkers(ctx, incidents, selectedId, phase, zoom) {
  const s = markerScale(zoom);
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
    const boxW = markerWidth(inc) * s;
    const resolved = inc.resolvedBy === 'policia';
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
    const digits = String(inc.number ?? '').length;
    if (resolved) {
      // 👮 en línea con el número, un poco más pequeño
      ctx.font = `${8 * s}px "Space Grotesk", system-ui, sans-serif`;
      ctx.fillText('👮', bx + 10 * s, by + boxH / 2 + 0.5 * s);
      ctx.font = `800 ${11 * s}px "JetBrains Mono", monospace`;
      ctx.fillText(String(inc.number ?? ''), bx + (15 + digits * 3.5) * s, by + boxH / 2 + 0.5 * s);
    } else {
      ctx.fillText(String(inc.number ?? ''), bx + boxW / 2, by + boxH / 2 + 0.5 * s);
    }

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
