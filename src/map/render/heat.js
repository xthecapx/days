import { TILE_SIZE } from '../worldSize.js';
import { getHeatPixelColor } from '../heatmapEngine.js';

export function drawHeat(ctx, heatmap, phase) {
  if (!heatmap?.grid) return;
  for (const cell of heatmap.grid) {
    if (cell.heat <= 0.08 && cell.tranquilityHeat <= 0.08) continue;
    const color = getHeatPixelColor(cell, phase);
    if (!color) continue;
    const px = cell.x * TILE_SIZE;
    const py = cell.y * TILE_SIZE;
    ctx.fillStyle = color.fill;
    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    const border = cell.isPreview ? 'rgba(255,255,255,0.9)' : color.border;
    if (border) {
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
    }
  }
}

export function drawGrid(ctx, gridW, gridH, worldW, worldH) {
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= gridW; x++) {
    ctx.moveTo(x * TILE_SIZE + 0.5, 0);
    ctx.lineTo(x * TILE_SIZE + 0.5, worldH);
  }
  for (let y = 0; y <= gridH; y++) {
    ctx.moveTo(0, y * TILE_SIZE + 0.5);
    ctx.lineTo(worldW, y * TILE_SIZE + 0.5);
  }
  ctx.stroke();
}
