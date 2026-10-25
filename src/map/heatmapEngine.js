import { GRID_WIDTH, GRID_HEIGHT } from './gpsGrid.js';
import { calculateDaysSince, isTranquilityIncident } from '../domain/incident.js';

/**
 * Weight factor according to the incident date.
 */
export function getTemporalWeight(daysAgo, decayMode = 'actual') {
  if (decayMode === 'historico') {
    return 1.0;
  }
  if (daysAgo <= 2) return 1.0;
  if (daysAgo <= 7) return 0.9;
  if (daysAgo <= 18) return 0.78;
  if (daysAgo <= 40) return 0.62;
  return Math.max(0.45, Math.exp(-daysAgo / 95));
}

/**
 * Balanced radius (~2.5 to ~4.4 neighbouring pixels) to highlight the alert zone without covering the map
 */
function getIncidentPixelRadius(severity = 3, daysAgo = 0, decayMode = 'actual', isTranquility = false) {
  const sev = Math.max(1, Math.min(5, Number(severity) || 3));
  if (isTranquility) {
    return 1.6 + sev * 0.48; // ~2.5 px alrededor del incidente #3 (amarillo claro)
  }
  const baseRadius = 1.25 + sev * 0.64; // From ~1.9 to ~4.45 neighbouring pixels
  const timeFactor = decayMode === 'historico' ? 1.0 : (daysAgo <= 7 ? 1.02 : daysAgo <= 30 ? 0.92 : 0.85);
  return baseRadius * timeFactor;
}

/**
 * Generates the heat matrix (GRID_WIDTH × GRID_HEIGHT) with a compact radius so as not to cover the map
 */
export function computePixelHeatmap(incidents = [], options = {}) {
  const {
    now = new Date(),
    decayMode = 'actual',
    previewIncident = null
  } = options;

  const grid = new Array(GRID_WIDTH * GRID_HEIGHT).fill(null).map((_, idx) => ({
    x: idx % GRID_WIDTH,
    y: Math.floor(idx / GRID_WIDTH),
    heat: 0,
    tranquilityHeat: 0,
    maxFreshness: 0,
    isCenter: false,
    isTranquilityCenter: false,
    isPreview: false,
    incidents: []
  }));

  const allIncidents = previewIncident
    ? [...incidents, { ...previewIncident, isPreview: true }]
    : incidents;

  let affectedPixelsCount = 0;

  for (const inc of allIncidents) {
    const cx = Math.round(Number(inc.pixelX));
    const cy = Math.round(Number(inc.pixelY));
    if (Number.isNaN(cx) || Number.isNaN(cy)) continue;
    if (cx < 0 || cx >= GRID_WIDTH || cy < 0 || cy >= GRID_HEIGHT) continue;

    const daysAgo = calculateDaysSince(inc.date, now);
    const temporalWeight = getTemporalWeight(daysAgo, decayMode);
    const severity = Math.max(1, Math.min(5, Number(inc.severity) || 3));
    const tranquility = isTranquilityIncident(inc);
    const radius = getIncidentPixelRadius(severity, daysAgo, decayMode, tranquility);
    const rCeil = Math.ceil(radius);

    const centerIntensity = tranquility
      ? (0.42 + severity * 0.12) * Math.max(0.75, temporalWeight)
      : (0.42 + severity * 0.14) * temporalWeight;

    for (let dy = -rCeil; dy <= rCeil; dy++) {
      for (let dx = -rCeil; dx <= rCeil; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= GRID_WIDTH || ny < 0 || ny >= GRID_HEIGHT) continue;

        const dist = Math.hypot(dx, dy);
        if (dist > radius) continue;

        const cellIdx = ny * GRID_WIDTH + nx;
        const cell = grid[cellIdx];

        const normDist = dist / radius;
        const spatialFalloff = Math.pow(1 - normDist, 1.55);
        const contribution = centerIntensity * spatialFalloff;

        if (tranquility) {
          cell.tranquilityHeat = Math.min(1.1, cell.tranquilityHeat + contribution);
          if (dx === 0 && dy === 0) {
            cell.isTranquilityCenter = true;
            if (inc.isPreview) cell.isPreview = true;
          } else if (inc.isPreview) {
            cell.isPreview = true;
          }
        } else {
          cell.heat = Math.min(1.35, cell.heat + contribution);
          cell.maxFreshness = Math.max(cell.maxFreshness, temporalWeight);
          if (dx === 0 && dy === 0) {
            cell.isCenter = true;
            if (inc.isPreview) cell.isPreview = true;
          } else if (inc.isPreview) {
            cell.isPreview = true;
          }
        }

        if (!inc.isPreview && !cell.incidents.some((i) => i.id === inc.id)) {
          cell.incidents.push({
            id: inc.id,
            number: inc.number,
            title: inc.category,
            description: inc.description,
            date: inc.date,
            dateLabel: inc.dateLabel,
            daysAgo,
            severity,
            impactType: tranquility ? 'tranquilidad' : 'seguridad',
            distance: Number(dist.toFixed(1))
          });
        }
      }
    }
  }

  for (let i = 0; i < grid.length; i++) {
    if (grid[i].heat > 0.08) {
      affectedPixelsCount++;
    }
  }

  return {
    grid,
    affectedPixelsCount
  };
}
