import { GRID_WIDTH, GRID_HEIGHT, distanceToPolyline } from '../gpsGrid.js';
import { TILE_SIZE, WORLD_WIDTH, WORLD_HEIGHT } from '../worldSize.js';
import { pointInPolygon, tileHash } from '../geometry.js';
import { ROADS, TRAILS, RIVER, URBAN_POLY, OPEN_LAND_POLY, LANDMARK_BLOCKS } from '../data/roads.js';
import { ROAD_STYLES, TERRAIN_COLORS, BUILDING_ROOFS, BUILDING_TONES } from '../data/roadStyles.js';

/** El mapa base se pinta una sola vez a mayor resolución para que las vías salgan nítidas. */
export const BASE_SCALE = 3;

const T = TILE_SIZE * BASE_SCALE;
const tc = (v) => (v + 0.5) * T; // centro del tile en píxeles del lienzo base

function strokePath(ctx, pts) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(tc(x), tc(y)) : ctx.moveTo(tc(x), tc(y))));
  ctx.stroke();
}

function strokeLayer(ctx, pts, width, color, dash = []) {
  ctx.lineWidth = width * T;
  ctx.strokeStyle = color;
  ctx.setLineDash(dash.map((d) => d * T * 0.5));
  strokePath(ctx, pts);
  ctx.setLineDash([]);
}

/** Distancia de cada tile al borde de la vía/río/sendero más cercano (negativa = encima). */
function buildClearance() {
  const clearance = new Float32Array(GRID_WIDTH * GRID_HEIGHT).fill(99);
  const features = [
    ...ROADS.map((r) => ({ pts: r.pts, half: ROAD_STYLES[r.cls].width / 2 })),
    ...TRAILS.map((t) => ({ pts: t.pts, half: 0.4 })),
    { pts: RIVER.pts, half: 1.1 }
  ];
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      let best = 99;
      for (const f of features) {
        const d = distanceToPolyline(x, y, f.pts) - f.half;
        if (d < best) best = d;
      }
      clearance[y * GRID_WIDTH + x] = best;
    }
  }
  return clearance;
}

function paintTerrain(ctx) {
  const { grass, urban, openLand } = TERRAIN_COLORS;
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      const h = tileHash(x, y);
      let color;
      if (pointInPolygon(x, y, OPEN_LAND_POLY)) color = openLand;
      else if (pointInPolygon(x, y, URBAN_POLY)) color = urban;
      else color = grass[h % grass.length];
      ctx.fillStyle = color;
      ctx.fillRect(x * T, y * T, T + 1, T + 1);
    }
  }
}

function paintForest(ctx, clearance) {
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      if (pointInPolygon(x, y, URBAN_POLY) || pointInPolygon(x, y, OPEN_LAND_POLY)) continue;
      if (clearance[y * GRID_WIDTH + x] < 0.9) continue;
      const h = tileHash(x, y, 7);
      if (h % 100 > 58) continue;
      const cx = (x + 0.2 + ((h >> 3) % 60) / 100) * T;
      const cy = (y + 0.2 + ((h >> 9) % 60) / 100) * T;
      const r = T * (0.34 + ((h >> 15) % 20) / 100);
      ctx.fillStyle = 'rgba(20, 60, 30, 0.18)';
      ctx.beginPath();
      ctx.arc(cx + r * 0.25, cy + r * 0.3, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = h % 3 === 0 ? TERRAIN_COLORS.forestDark : TERRAIN_COLORS.forest;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function paintBuildings(ctx, clearance) {
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      if (!pointInPolygon(x, y, URBAN_POLY) || pointInPolygon(x, y, OPEN_LAND_POLY)) continue;
      if (clearance[y * GRID_WIDTH + x] < 0.75) continue;
      const h = tileHash(x, y, 3);
      if (h % 100 > 66) continue;
      const roof = BUILDING_ROOFS[h % BUILDING_ROOFS.length];
      const bx = x * T + T * 0.14;
      const by = y * T + T * 0.14;
      const bw = T * 0.72;
      const bh = T * 0.72;
      ctx.fillStyle = 'rgba(30, 30, 40, 0.22)';
      ctx.fillRect(bx + T * 0.08, by + T * 0.1, bw, bh);
      ctx.fillStyle = roof;
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.fillRect(bx, by, bw, T * 0.1);
    }
  }
  for (const b of LANDMARK_BLOCKS) {
    const tone = BUILDING_TONES[b.tone];
    const x = tc(b.x) - T / 2;
    const y = tc(b.y) - T / 2;
    ctx.fillStyle = 'rgba(30, 30, 40, 0.28)';
    ctx.fillRect(x + T * 0.18, y + T * 0.2, b.w * T, b.h * T);
    ctx.fillStyle = tone.side;
    ctx.fillRect(x, y, b.w * T, b.h * T);
    ctx.fillStyle = tone.roof;
    ctx.fillRect(x + T * 0.12, y + T * 0.12, b.w * T - T * 0.24, b.h * T - T * 0.24);
  }
}

function paintRoads(ctx) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const sorted = [...ROADS].sort((a, b) => ROAD_STYLES[a.cls].order - ROAD_STYLES[b.cls].order);
  // Primero todos los bordes, luego los rellenos: las intersecciones quedan limpias.
  for (const r of sorted) {
    const s = ROAD_STYLES[r.cls];
    strokeLayer(ctx, r.pts, s.width + 0.28, s.casing);
  }
  for (const r of sorted) {
    const s = ROAD_STYLES[r.cls];
    strokeLayer(ctx, r.pts, s.width, s.fill, s.dash);
    if (s.centerLine) {
      ctx.lineCap = 'butt';
      strokeLayer(ctx, r.pts, 0.1, s.centerLine, [2.2, 2.2]);
      ctx.lineCap = 'round';
    }
  }
}

function paintWater(ctx) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  strokeLayer(ctx, RIVER.pts, 2.1, TERRAIN_COLORS.waterEdge);
  strokeLayer(ctx, RIVER.pts, 1.7, TERRAIN_COLORS.water);
  strokeLayer(ctx, RIVER.pts, 0.4, TERRAIN_COLORS.waterLight);
}

function paintTrails(ctx) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const trail of TRAILS) {
    strokeLayer(ctx, trail.pts, 0.34, TERRAIN_COLORS.trail, [1.3, 1.2]);
  }
}

export function createBaseMap() {
  const canvas = document.createElement('canvas');
  canvas.width = WORLD_WIDTH * BASE_SCALE;
  canvas.height = WORLD_HEIGHT * BASE_SCALE;
  const ctx = canvas.getContext('2d');

  const clearance = buildClearance();
  paintTerrain(ctx);
  paintForest(ctx, clearance);
  paintBuildings(ctx, clearance);
  paintWater(ctx); // el río va debajo: las vías lo cruzan como puentes
  paintRoads(ctx);
  paintTrails(ctx);
  return canvas;
}
