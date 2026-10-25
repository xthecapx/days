import { TILE_SIZE } from '../worldSize.js';

/**
 * Señales de ayuda de los vecinos: un anillo rojo que late sobre la casilla, con un 🆘 compensado por el zoom (como los
 * marcadores de incidente) para que se vea y se pueda tocar. `mineId` resalta la que envié yo.
 */
const markerScale = (zoom) => 1 / Math.max(0.8, Math.min(zoom, 3));

export function drawHelpSignals(ctx, signals, mineId, phase, zoom) {
  if (!signals?.length) return;
  const s = markerScale(zoom);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const sig of signals) {
    const cx = (sig.x + 0.5) * TILE_SIZE;
    const cy = (sig.y + 0.5) * TILE_SIZE;
    const mine = sig.id === mineId;
    // Dos ondas que se expanden y se desvanecen (sin parpadeo brusco).
    for (const offset of [0, 0.5]) {
      const t = (phase * 0.9 + offset) % 1;
      ctx.globalAlpha = (1 - t) * 0.65;
      ctx.strokeStyle = mine ? '#facc15' : '#ff1744';
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.arc(cx, cy, (6 + t * 22) * s, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = mine ? '#facc15' : '#ff1744';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.6 * s;
    ctx.beginPath();
    ctx.arc(cx, cy, 8 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.font = `${10 * s}px "Space Grotesk", system-ui, sans-serif`;
    ctx.fillStyle = mine ? '#0f172a' : '#ffffff';
    ctx.fillText('🆘', cx, cy + 0.5 * s);
  }
  ctx.restore();
}
