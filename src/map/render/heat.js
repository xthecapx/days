import { TILE_SIZE } from '../worldSize.js';
/**
 * Converts a pixel's heat value into a balanced RGBA colour that lets the map show through underneath
 */
export function getHeatPixelColor(cell, pulsePhase = 0) {
  if (!cell) return null;

  // 1. Security (compact, translucent red so the map stays distinguishable)
  if (cell.heat > 0.08) {
    const h = cell.heat;
    const fresh = cell.maxFreshness;
    const pulseBoost = cell.isCenter ? Math.sin(pulsePhase * 4) * 0.06 : 0;

    if (cell.isCenter) {
      return {
        fill: fresh >= 0.85 ? 'rgba(255, 23, 68, 0.82)' : 'rgba(220, 38, 38, 0.78)',
        border: '#ffffff',
        level: 'EPICENTRO'
      };
    }

    if (h >= 0.65) {
      const alpha = Math.min(0.62, 0.52 + pulseBoost);
      return {
        fill: `rgba(239, 68, 68, ${alpha.toFixed(2)})`,
        border: 'rgba(255, 200, 200, 0.35)',
        level: 'ALTO'
      };
    }

    if (h >= 0.32) {
      return {
        fill: fresh >= 0.75
          ? 'rgba(239, 68, 68, 0.36)'
          : 'rgba(234, 88, 12, 0.34)',
        border: null,
        level: 'MEDIO'
      };
    }

    return {
      fill: fresh >= 0.75
        ? 'rgba(239, 68, 68, 0.20)'
        : 'rgba(249, 115, 22, 0.18)',
      border: null,
      level: 'PERIFERIA'
    };
  }

  // 2. Tranquilidad / Ruido (Amarillo claro moderado)
  if (cell.tranquilityHeat > 0.08) {
    const th = cell.tranquilityHeat;
    if (cell.isTranquilityCenter) {
      return {
        fill: 'rgba(253, 224, 71, 0.82)',
        border: '#fef9c3',
        level: 'TRANQUILIDAD / RUIDO'
      };
    }
    if (th >= 0.35) {
      return {
        fill: 'rgba(254, 240, 138, 0.52)',
        border: null,
        level: 'CONVIVENCIA MODERADA'
      };
    }
    return {
      fill: 'rgba(254, 249, 195, 0.30)',
      border: null,
      level: 'CONVIVENCIA SUAVE'
    };
  }

  return null;
}

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
