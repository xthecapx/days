import {
  GRID_WIDTH,
  GRID_HEIGHT,
  USER_REFERENCE_PIXEL,
  RIVER_PATH,
  SENDERO_PATH,
  RIVER_TRAIL_WEST,
  distanceToPolyline
} from './gpsGrid.js';
import { getHeatPixelColor, isTranquilityIncident } from './heatmapEngine.js';

export const TILE_SIZE = 8;
export const CANVAS_WIDTH = GRID_WIDTH * TILE_SIZE;
export const CANVAS_HEIGHT = GRID_HEIGHT * TILE_SIZE;

// Vías principales y calles exactas según las capturas de Google Maps con distinto zoom
const HIGHWAY_PATH = [
  [107, 0], [109, 10], [112, 22], [111, 36], [111, 47], [114, 58], [118, 70], [119, 79]
];

const GUATIGUARA_PATH = [
  [73, 79], [79, 73], [86, 68], [96, 65], [106, 61], [114, 58], [119, 55]
];

// Doble calzada Calle 13 N (pasando por Exploretheworld y cruzando Carrera 2)
const CALLE_13N_UPPER = [
  [44, 67], [56, 61.5], [66, 57], [75, 53], [83, 49.5]
];
const CALLE_13N_LOWER = [
  [45, 68.3], [56.5, 62.8], [66.5, 58.3], [75.5, 54.3], [83.5, 50.8]
];

// Carrera 2 (desde Pradera del Hato bajando por Calle 13 N hasta Vía Guatiguará)
const CARRERA_2_PATH = [
  [60.5, 46], [63, 51.5], [66, 57.8], [70, 68], [74, 79]
];

// Calles paralelas del Conjunto Residencial Pradera del Hato (donde está Hogar 68,49) + gancho derecho
const PRADERA_STREETS = [
  [[62.5, 45], [66.8, 54.5]], // Paralela 2
  [[64.8, 44], [69.0, 53.5]], // Paralela 3 (junto a Hogar)
  [[67.0, 43], [71.2, 52.5]], // Paralela 4
  [[61.8, 51.5], [69.5, 48.2]], // Calle transversal de Pradera del Hato
  [[69.8, 51.2], [71.5, 52.0], [73.2, 51.0], [73.5, 48.0], [74.8, 47.5]] // Cul-de-sac en forma de J junto a Vía Río del Hato
];

// Calles residenciales al sur de Calle 13 N y oriente
const SOUTH_RESIDENTIAL_STREETS = [
  [[63, 60], [65, 65]],
  [[64, 64], [66.5, 65]],
  [[69, 68], [70, 64], [74, 61], [79, 60], [81, 65], [84, 71]],
  [[72, 65], [77, 63], [82, 69]],
  [[76, 67], [80, 66]],
  [[82, 61], [86, 71]],
  [[46, 70], [56, 77]],
  [[50, 68], [59, 74]],
  [[88, 68], [91, 79]],
  [[95, 65], [98, 79]],
  [[103, 62], [101, 79]],
  [[88, 74], [105, 70]]
];

const WEST_RURAL_PATHS = [
  [[19, 79], [19, 71], [24, 65], [25, 57], [21, 51]],
  [[24, 65], [29, 73], [28, 79]],
  [[58, 18], [64, 14], [70, 19]],
  [[62, 11], [67, 16], [76, 11]]
];

// Rutas de vehículos en movimiento (Carros y Buses)
const VEHICLE_ROUTES = [
  { path: CALLE_13N_LOWER, speed: 0.055, offset: 0.1, color: '#ef4444', type: 'car' },
  { path: CALLE_13N_LOWER, speed: 0.055, offset: 0.62, color: '#3b82f6', type: 'car' },
  { path: [...CALLE_13N_UPPER].reverse(), speed: 0.05, offset: 0.35, color: '#f59e0b', type: 'car' },
  { path: CARRERA_2_PATH, speed: 0.045, offset: 0.2, color: '#ffffff', type: 'car' },
  { path: [...CARRERA_2_PATH].reverse(), speed: 0.048, offset: 0.72, color: '#10b981', type: 'car' },
  { path: [[75, 53], [72, 47], [72, 42]], speed: 0.06, offset: 0.4, color: '#6366f1', type: 'car' },
  { path: GUATIGUARA_PATH, speed: 0.042, offset: 0.15, color: '#eab308', type: 'bus' },
  { path: [...GUATIGUARA_PATH].reverse(), speed: 0.052, offset: 0.55, color: '#ec4899', type: 'car' },
  { path: HIGHWAY_PATH, speed: 0.065, offset: 0.08, color: '#ffffff', type: 'car' },
  { path: HIGHWAY_PATH, speed: 0.058, offset: 0.52, color: '#38bdf8', type: 'bus' },
  { path: [...HIGHWAY_PATH].reverse(), speed: 0.062, offset: 0.3, color: '#f97316', type: 'car' },
  { path: [...HIGHWAY_PATH].reverse(), speed: 0.068, offset: 0.78, color: '#a855f7', type: 'car' }
];

// Rutas de personas caminando (Sendero Río del Hato, Pradera del Hato y Calle 13 N)
const PEDESTRIAN_ROUTES = [
  { path: [[72, 43], [72, 37], [81, 36], [85, 31], [94, 25]], speed: 0.022, offset: 0.12, shirt: '#10b981', pants: '#1e3a8a' },
  { path: [[94, 25], [85, 31], [81, 36], [72, 37], [72, 43]], speed: 0.020, offset: 0.48, shirt: '#f97316', pants: '#0f172a' },
  { path: [[81, 36], [85, 31], [94, 25], [98, 28], [104, 19]], speed: 0.018, offset: 0.75, shirt: '#ec4899', pants: '#1e293b' },
  { path: [[62, 43], [65, 43], [72, 43]], speed: 0.025, offset: 0.30, shirt: '#38bdf8', pants: '#1e293b' },
  { path: [[64.8, 44.5], [68.5, 52.5]], speed: 0.032, offset: 0.25, shirt: '#a855f7', pants: '#0f172a' },
  { path: [[69.5, 48.2], [62.0, 51.5]], speed: 0.030, offset: 0.60, shirt: '#eab308', pants: '#1e3a8a' },
  { path: [[66, 57], [75, 53]], speed: 0.028, offset: 0.40, shirt: '#14b8a6', pants: '#0f172a' }
];

function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-7) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

const URBAN_RESIDENTIAL_POLY = [
  [59, 42], [73, 44], [76, 51], [83, 50], [87, 66], [118, 52],
  [119, 79], [48, 79], [44, 68], [59, 57], [58, 46], [59, 42]
];

const EAST_TAN_POLY = [
  [74, 48], [95, 36], [111, 42], [113, 57], [93, 65], [81, 56], [74, 48]
];

export function createBasePixelArtMap() {
  const offscreen = document.createElement('canvas');
  offscreen.width = CANVAS_WIDTH;
  offscreen.height = CANVAS_HEIGHT;
  const ctx = offscreen.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // 1. Terreno base
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;

      const isUrban = pointInPolygon(x, y, URBAN_RESIDENTIAL_POLY);
      const isTan = pointInPolygon(x, y, EAST_TAN_POLY);

      const hash = ((x * 73856093) ^ (y * 19349663)) >>> 0;

      if (isTan) {
        ctx.fillStyle = (hash % 5 === 0) ? '#ede3cd' : '#f3ead6';
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
      } else if (isUrban) {
        ctx.fillStyle = (hash % 4 === 0) ? '#e6e8ec' : '#eff1f4';
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        if (hash % 7 === 0 && x > 59 && x < 76 && y > 44 && y < 65) {
          ctx.fillStyle = '#dde1e7';
          ctx.fillRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
        }
      } else {
        ctx.fillStyle = (hash % 3 === 0) ? '#bcebc9' : '#c7f2d4';
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

        if (hash % 11 === 0) {
          ctx.fillStyle = '#8fd4a4';
          ctx.fillRect(px + 2, py + 2, 3, 3);
          ctx.fillStyle = '#6ebc87';
          ctx.fillRect(px + 3, py + 1, 2, 2);
        } else if (hash % 19 === 0) {
          ctx.fillStyle = '#9de0b2';
          ctx.fillRect(px + 1, py + 4, 2, 2);
        }
      }
    }
  }

  // 2. Caminos rurales
  for (const path of WEST_RURAL_PATHS) {
    drawPixelPolyline(ctx, path, '#c7d0d8', 0.95);
  }

  // 3. Calles del Conjunto Residencial Pradera del Hato y sur
  for (const street of PRADERA_STREETS) {
    drawPixelPolyline(ctx, street, '#cbd2dc', 0.9, '#b0b8c5');
  }
  for (const street of SOUTH_RESIDENTIAL_STREETS) {
    drawPixelPolyline(ctx, street, '#cfd5de', 0.9, '#b8c0cc');
  }

  // 4. Carrera 2 y Doble Calzada Calle 13 N
  drawPixelPolyline(ctx, CARRERA_2_PATH, '#c6cdd8', 1.35, '#9fa8b8');
  drawPixelPolyline(ctx, CALLE_13N_UPPER, '#c6cdd8', 1.1, '#9fa8b8');
  drawPixelPolyline(ctx, CALLE_13N_LOWER, '#c6cdd8', 1.1, '#9fa8b8');
  drawPixelPolyline(ctx, GUATIGUARA_PATH, '#c2cad6', 1.9, '#9fa9b8');

  // 5. Autopista Piedecuesta
  drawPixelPolyline(ctx, HIGHWAY_PATH, '#7d92b0', 2.7, '#5c7291');
  drawPixelPolyline(ctx, HIGHWAY_PATH, '#a8b9d1', 0.75);

  // 6. Río del Hato (Cauce azul celeste)
  drawPixelPolyline(ctx, RIVER_PATH, '#80d4ff', 2.0, '#4db8ff');
  drawPixelPolyline(ctx, RIVER_PATH, '#3aa6f5', 1.0);

  // 7. Vía Río del Hato + Sendero Río del Hato
  drawPixelPolyline(ctx, SENDERO_PATH, '#cbd5e1', 1.4, '#64748b');
  drawPixelPolyline(ctx, RIVER_TRAIL_WEST, '#cbd5e1', 1.1, '#64748b');

  for (let y = 10; y < 55; y++) {
    for (let x = 60; x < 110; x++) {
      if (distanceToPolyline(x, y, SENDERO_PATH) <= 0.8 || distanceToPolyline(x, y, RIVER_TRAIL_WEST) <= 0.7) {
        const px = x * TILE_SIZE;
        const py = y * TILE_SIZE;
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(px + 2, py + 2, 3, 3);
      }
    }
  }

  return offscreen;
}

function drawPixelPolyline(ctx, polyline, fillColor, radiusTiles = 1.2, borderColor = null) {
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      const d = distanceToPolyline(x, y, polyline);
      if (d <= radiusTiles) {
        const px = x * TILE_SIZE;
        const py = y * TILE_SIZE;
        if (borderColor && d > radiusTiles - 0.5) {
          ctx.fillStyle = borderColor;
        } else {
          ctx.fillStyle = fillColor;
        }
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
      }
    }
  }
}

export function renderPixelMapFrame(ctx, state, assets) {
  const {
    heatmap,
    incidents = [],
    selectedPixel = null,
    hoveredPixel = null,
    selectedIncidentId = null,
    showGrid = true,
    showReferenceOverlay = false,
    pulsePhase = 0
  } = state;

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  if (assets.baseMapCanvas) {
    ctx.drawImage(assets.baseMapCanvas, 0, 0);
  }

  if (showReferenceOverlay && assets.referenceImage && assets.referenceImage.complete) {
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.drawImage(assets.referenceImage, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.restore();
  }

  // 1. Animación del agua del Río del Hato
  drawRiverShimmer(ctx, pulsePhase);

  // 2. Píxeles de Calor (Rojo seguridad y Amarillo claro tranquilidad)
  if (heatmap && heatmap.grid) {
    for (let i = 0; i < heatmap.grid.length; i++) {
      const cell = heatmap.grid[i];
      if (cell.heat <= 0.08 && cell.tranquilityHeat <= 0.08) continue;

      const colorInfo = getHeatPixelColor(cell, pulsePhase);
      if (!colorInfo) continue;

      const px = cell.x * TILE_SIZE;
      const py = cell.y * TILE_SIZE;

      ctx.fillStyle = colorInfo.fill;
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

      if (cell.isPreview) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, py + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
      } else if (colorInfo.border) {
        ctx.strokeStyle = colorInfo.border;
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, py + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
      }
    }
  }

  // 3. Animación de personas caminando en el sendero/barrio y carros moviéndose en las vías
  drawAnimatedPedestriansAndCars(ctx, pulsePhase);

  // 4. Cuadrícula de Píxeles GPS
  if (showGrid) {
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.11)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= GRID_WIDTH; x++) {
      ctx.moveTo(x * TILE_SIZE + 0.5, 0);
      ctx.lineTo(x * TILE_SIZE + 0.5, CANVAS_HEIGHT);
    }
    for (let y = 0; y <= GRID_HEIGHT; y++) {
      ctx.moveTo(0, y * TILE_SIZE + 0.5);
      ctx.lineTo(CANVAS_WIDTH, y * TILE_SIZE + 0.5);
    }
    ctx.stroke();
  }

  // 5. Etiquetas, Hogar (68,49) y Marcadores de Incidentes
  drawMapLandmarksAndLabels(ctx, pulsePhase);
  drawIncidentMarkers(ctx, incidents, selectedIncidentId, pulsePhase);

  if (hoveredPixel) {
    const hx = hoveredPixel.x * TILE_SIZE;
    const hy = hoveredPixel.y * TILE_SIZE;
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.strokeRect(hx - 1, hy - 1, TILE_SIZE + 2, TILE_SIZE + 2);
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 1;
    ctx.strokeRect(hx, hy, TILE_SIZE, TILE_SIZE);
  }

  if (selectedPixel) {
    const sx = selectedPixel.x * TILE_SIZE;
    const sy = selectedPixel.y * TILE_SIZE;
    const blink = Math.sin(pulsePhase * 5) > 0;

    ctx.fillStyle = 'rgba(250, 204, 21, 0.32)';
    ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);

    ctx.strokeStyle = blink ? '#facc15' : '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(sx - 1, sy - 1, TILE_SIZE + 2, TILE_SIZE + 2);
  }

  ctx.restore();
}

function drawRiverShimmer(ctx, pulsePhase) {
  const step = Math.floor(pulsePhase * 3.5) % 6;
  ctx.fillStyle = 'rgba(224, 242, 254, 0.72)';
  for (let i = 0; i < RIVER_PATH.length - 1; i++) {
    const [x1, y1] = RIVER_PATH[i];
    const [x2, y2] = RIVER_PATH[i + 1];
    const t = ((pulsePhase * 0.45 + i * 0.23) % 1);
    const wx = Math.round((x1 + (x2 - x1) * t) * TILE_SIZE);
    const wy = Math.round((y1 + (y2 - y1) * t) * TILE_SIZE);
    ctx.fillRect(wx, wy, 4, 2);
    if ((i + step) % 2 === 0) {
      ctx.fillRect(wx + 2, wy + 2, 3, 1);
    }
  }
}

/**
 * Obtiene la posición en píxeles de canvas (x, y) y dirección a lo largo de una polilínea para t en [0, 1]
 */
function samplePolyline(polyline, tNorm) {
  const t = ((tNorm % 1) + 1) % 1;
  let totalLen = 0;
  const segLens = [];
  for (let i = 0; i < polyline.length - 1; i++) {
    const len = Math.hypot(polyline[i + 1][0] - polyline[i][0], polyline[i + 1][1] - polyline[i][1]);
    segLens.push(len);
    totalLen += len;
  }
  if (totalLen === 0) {
    return { x: polyline[0][0] * TILE_SIZE, y: polyline[0][1] * TILE_SIZE, dx: 1, dy: 0 };
  }

  let target = t * totalLen;
  for (let i = 0; i < segLens.length; i++) {
    if (target <= segLens[i] || i === segLens.length - 1) {
      const localT = segLens[i] > 0 ? target / segLens[i] : 0;
      const gx = polyline[i][0] + (polyline[i + 1][0] - polyline[i][0]) * localT;
      const gy = polyline[i][1] + (polyline[i + 1][1] - polyline[i][1]) * localT;
      const dx = polyline[i + 1][0] - polyline[i][0];
      const dy = polyline[i + 1][1] - polyline[i][1];
      return {
        x: gx * TILE_SIZE + TILE_SIZE / 2,
        y: gy * TILE_SIZE + TILE_SIZE / 2,
        dx,
        dy
      };
    }
    target -= segLens[i];
  }
  return { x: 0, y: 0, dx: 1, dy: 0 };
}

/**
 * Dibuja personas caminando en el sendero/urbanización y carros moviéndose en las vías
 */
function drawAnimatedPedestriansAndCars(ctx, pulsePhase) {
  ctx.save();

  // 1. Dibujar Carros y Buses en movimiento sobre las vías
  for (const route of VEHICLE_ROUTES) {
    const pos = samplePolyline(route.path, pulsePhase * route.speed + route.offset);
    const vx = Math.round(pos.x);
    const vy = Math.round(pos.y);
    const isHorizontal = Math.abs(pos.dx) >= Math.abs(pos.dy);
    const w = route.type === 'bus' ? (isHorizontal ? 9 : 5) : (isHorizontal ? 6 : 4);
    const h = route.type === 'bus' ? (isHorizontal ? 5 : 9) : (isHorizontal ? 4 : 6);

    // Sombra/ruedas del vehículo
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(vx - Math.floor(w / 2) - 1, vy - Math.floor(h / 2) - 1, w + 2, h + 2);

    // Carrocería
    ctx.fillStyle = route.color;
    ctx.fillRect(vx - Math.floor(w / 2), vy - Math.floor(h / 2), w, h);

    // Parabrisas / techo claro
    ctx.fillStyle = '#e0f2fe';
    ctx.fillRect(vx - 1, vy - 1, 2, 2);
  }

  // 2. Dibujar Personas caminando en 2D Pixel Art (con pasitos animados)
  const walkStep = Math.floor(pulsePhase * 6) % 2;
  for (const ped of PEDESTRIAN_ROUTES) {
    const pos = samplePolyline(ped.path, pulsePhase * ped.speed + ped.offset);
    const px = Math.round(pos.x);
    const py = Math.round(pos.y);

    // Sombra bajo los pies
    ctx.fillStyle = 'rgba(15, 23, 42, 0.35)';
    ctx.fillRect(px - 2, py + 2, 4, 2);

    // Cabeza (piel + cabello)
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(px - 1, py - 5, 3, 1);
    ctx.fillStyle = '#fde68a';
    ctx.fillRect(px - 1, py - 4, 3, 2);

    // Camiseta
    ctx.fillStyle = ped.shirt;
    ctx.fillRect(px - 2, py - 2, 5, 2);

    // Piernas alternando el paso al caminar
    ctx.fillStyle = ped.pants;
    if (walkStep === 0) {
      ctx.fillRect(px - 2, py, 2, 2);
      ctx.fillRect(px + 1, py, 1, 1);
    } else {
      ctx.fillRect(px - 1, py, 1, 1);
      ctx.fillRect(px + 1, py, 2, 2);
    }
  }

  ctx.restore();
}

function drawPixelHomeIcon(ctx, cx, cy, pulsePhase) {
  const halo = 9 + Math.sin(pulsePhase * 3) * 1.5;
  ctx.fillStyle = 'rgba(37, 99, 235, 0.22)';
  ctx.beginPath();
  ctx.arc(cx, cy, halo, 0, Math.PI * 2);
  ctx.fill();

  const x = Math.round(cx);
  const y = Math.round(cy);

  ctx.fillStyle = '#090d16';
  ctx.fillRect(x - 6, y - 2, 12, 8);
  ctx.fillRect(x - 7, y - 3, 14, 2);
  ctx.fillRect(x - 5, y - 5, 10, 2);
  ctx.fillRect(x - 3, y - 7, 6, 2);

  ctx.fillStyle = '#2563eb';
  ctx.fillRect(x - 6, y - 3, 12, 2);
  ctx.fillRect(x - 4, y - 5, 8, 2);
  ctx.fillRect(x - 2, y - 6, 4, 1);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x - 5, y - 1, 10, 6);

  ctx.fillStyle = '#1d4ed8';
  ctx.fillRect(x - 1, y + 1, 3, 4);
}

function drawMapLandmarksAndLabels(ctx, pulsePhase) {
  ctx.save();

  // 1. Ícono de Casita Pixel Art: "HOGAR" en (68, 49)
  const ux = USER_REFERENCE_PIXEL.x * TILE_SIZE + TILE_SIZE / 2;
  const uy = USER_REFERENCE_PIXEL.y * TILE_SIZE + TILE_SIZE / 2;
  drawPixelHomeIcon(ctx, ux, uy, pulsePhase);
  drawPixelBadgeLabel(ctx, ux, uy - 14, 'HOGAR', '#1d4ed8', '#ffffff');

  // 2. Conjunto Residencial Pradera del Hato (60, 51)
  drawSimpleMapText(ctx, 52 * TILE_SIZE, 50 * TILE_SIZE, 'Conj. Pradera del Hato', '#334155', 'rgba(255,255,255,0.86)');

  // 3. Carrera 2 y Calle 13 N (como en la captura con zoom)
  drawSimpleMapText(ctx, 62 * TILE_SIZE, 56 * TILE_SIZE, 'Carrera 2', '#475569', 'rgba(255,255,255,0.82)');
  drawSimpleMapText(ctx, 69 * TILE_SIZE, 58 * TILE_SIZE, 'Calle 13 N', '#475569', 'rgba(255,255,255,0.82)');

  // 4. Ícono Parque "Sendero Río del Hato" (81, 36)
  const sx = 81 * TILE_SIZE + 4;
  const sy = 36 * TILE_SIZE + 4;
  ctx.fillStyle = '#15803d';
  ctx.fillRect(sx - 6, sy - 6, 12, 12);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(sx - 2, sy - 4, 4, 5);
  ctx.fillRect(sx - 4, sy - 1, 8, 3);
  drawPixelBadgeLabel(ctx, sx, sy - 14, 'Sendero Río del Hato', '#166534', '#f0fdf4');

  // 5. Etiquetas de Río del Hato
  drawSimpleMapText(ctx, 76 * TILE_SIZE, 45 * TILE_SIZE, 'Río del Hato', '#1e293b', 'rgba(255,255,255,0.85)');
  drawSimpleMapText(ctx, 92 * TILE_SIZE, 27 * TILE_SIZE, 'Río del Hato', '#0f172a', 'rgba(255,255,255,0.8)');
  drawSimpleMapText(ctx, 46 * TILE_SIZE, 39 * TILE_SIZE, 'Río del Hato', '#0369a1', 'rgba(224,242,254,0.85)');

  // 6. Exploretheworld (75, 53)
  const ex = 75 * TILE_SIZE + 4;
  const ey = 53 * TILE_SIZE + 4;
  ctx.fillStyle = '#0d9488';
  ctx.fillRect(ex - 4, ey - 4, 8, 8);
  drawSimpleMapText(ctx, ex + 30, ey + 9, 'Exploretheworld', '#0f766e', 'rgba(255,255,255,0.85)');

  // 7. Azafrán - Ciudad Tierrabuena, Conjunto Terracota, Veterinaria, Autóktonos y Autopista
  drawSimpleMapText(ctx, 56 * TILE_SIZE, 70 * TILE_SIZE, 'Azafrán - Ciudad Tierrabuena', '#334155', 'rgba(255,255,255,0.82)');
  drawSimpleMapText(ctx, 45 * TILE_SIZE, 77 * TILE_SIZE, 'Conjunto Terracota', '#334155', 'rgba(255,255,255,0.82)');
  drawSimpleMapText(ctx, 84 * TILE_SIZE, 70 * TILE_SIZE, 'Veterinaria De Pelos.com', '#475569', 'rgba(255,255,255,0.8)');
  drawSimpleMapText(ctx, 100 * TILE_SIZE, 38 * TILE_SIZE, 'Autóktonos Parrilla', '#c2410c', 'rgba(255,247,237,0.9)');
  drawSimpleMapText(ctx, 108 * TILE_SIZE, 28 * TILE_SIZE, 'Autopista Piedecuesta', '#1e3a8a', 'rgba(239,246,255,0.9)');
  drawSimpleMapText(ctx, 103 * TILE_SIZE, 61 * TILE_SIZE, 'Vía Guatiguará', '#334155', 'rgba(255,255,255,0.85)');

  ctx.restore();
}

function drawIncidentMarkers(ctx, incidents, selectedIncidentId, pulsePhase) {
  ctx.save();

  const sorted = [...incidents].sort((a, b) => (a.pixelX - b.pixelX) || (a.pixelY - b.pixelY));

  const offsets = new Map();
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    const neighbors = sorted.filter(
      (other) => Math.hypot(other.pixelX - cur.pixelX, other.pixelY - cur.pixelY) <= 2.2
    );
    if (neighbors.length <= 1) {
      offsets.set(cur.id, { dx: 0, dy: -12 });
    } else {
      const idx = neighbors.findIndex((n) => n.id === cur.id);
      const mid = (neighbors.length - 1) / 2;
      const spreadX = (idx - mid) * 17;
      const liftY = idx % 2 === 1 ? -23 : -12;
      offsets.set(cur.id, { dx: spreadX, dy: liftY });
    }
  }

  for (const inc of incidents) {
    const px = inc.pixelX * TILE_SIZE + TILE_SIZE / 2;
    const py = inc.pixelY * TILE_SIZE + TILE_SIZE / 2;
    const isSelected = inc.id === selectedIncidentId;
    const isTranquility = isTranquilityIncident(inc);
    const offset = offsets.get(inc.id) || { dx: 0, dy: -12 };

    ctx.fillStyle = isTranquility ? '#fef08a' : '#ffffff';
    ctx.fillRect(px - 2, py - 2, 4, 4);

    if (isSelected) {
      const r = 6 + Math.sin(pulsePhase * 4) * 1.5;
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(px - r, py - r, r * 2, r * 2);
    }

    const boxW = 17;
    const boxH = 12;
    const bx = Math.round(px + offset.dx - boxW / 2);
    const by = Math.round(py + offset.dy - boxH / 2);

    ctx.strokeStyle = isSelected
      ? '#facc15'
      : isTranquility
        ? '#fde047'
        : '#ffffff';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(bx + boxW / 2, by + boxH);
    ctx.lineTo(px, py);
    ctx.stroke();

    ctx.fillStyle = '#090d16';
    ctx.fillRect(bx + 1, by + 1, boxW, boxH);

    if (isSelected) {
      ctx.fillStyle = '#facc15';
    } else if (isTranquility) {
      ctx.fillStyle = '#fef08a';
    } else {
      ctx.fillStyle = '#dc2626';
    }
    ctx.fillRect(bx, by, boxW, boxH);

    ctx.strokeStyle = (isSelected || isTranquility) ? '#090d16' : '#ffffff';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, boxW, boxH);

    ctx.fillStyle = (isSelected || isTranquility) ? '#090d16' : '#ffffff';
    ctx.font = 'bold 8px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`#${inc.number || ''}`, bx + boxW / 2, by + boxH / 2 + 0.5);
  }

  ctx.restore();
}

function drawPixelBadgeLabel(ctx, x, y, text, bgColor, textColor) {
  ctx.font = 'bold 8px "Courier New", monospace';
  const metrics = ctx.measureText(text);
  const padX = 4;
  const w = Math.ceil(metrics.width) + padX * 2;
  const h = 11;
  const rx = Math.round(x - w / 2);
  const ry = Math.round(y - h / 2);

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(rx + 1, ry + 1, w, h);
  ctx.fillStyle = bgColor;
  ctx.fillRect(rx, ry, w, h);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.strokeRect(rx, ry, w, h);

  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, rx + w / 2, ry + h / 2 + 0.5);
}

function drawSimpleMapText(ctx, x, y, text, textColor, bgFill) {
  ctx.font = 'bold 8px "Courier New", monospace';
  const metrics = ctx.measureText(text);
  const w = Math.ceil(metrics.width) + 6;
  const h = 11;
  const rx = Math.max(2, Math.min(CANVAS_WIDTH - w - 2, Math.round(x - w / 2)));
  const ry = Math.max(2, Math.min(CANVAS_HEIGHT - h - 2, Math.round(y - h / 2)));

  if (bgFill) {
    ctx.fillStyle = bgFill;
    ctx.fillRect(rx, ry, w, h);
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(rx, ry, w, h);
  }

  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, rx + w / 2, ry + h / 2 + 0.5);
}
