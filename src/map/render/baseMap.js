import { GRID_WIDTH, GRID_HEIGHT } from '../gpsGrid.js';
import { TILE_SIZE, WORLD_WIDTH, WORLD_HEIGHT } from '../worldSize.js';
import { pointInPolygon, tileHash } from '../geometry.js';
import { ROAD_STYLES, ROAD_CLASS_ORDER, WATER_STYLES, TERRAIN_COLORS, BUILDING_ROOFS } from '../data/roadStyles.js';

/**
 * The base map is painted once on a large canvas. With 200×200 tiles the
 * canvas measures 1600×1600 times BASE_SCALE², so it is capped at 2× (3200×3200).
 */
export const BASE_SCALE = 2;

const T = TILE_SIZE * BASE_SCALE;
const tc = (v) => (v + 0.5) * T; // (continuous) tile coordinate → base canvas pixel

function path(ctx, pts) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(tc(x), tc(y)) : ctx.moveTo(tc(x), tc(y))));
}

function stroke(ctx, pts, widthTiles, color, dash = []) {
  ctx.lineWidth = widthTiles * T;
  ctx.strokeStyle = color;
  ctx.setLineDash(dash.map((d) => d * T * 0.5));
  path(ctx, pts);
  ctx.stroke();
  ctx.setLineDash([]);
}

function fillPoly(ctx, pts, color) {
  ctx.fillStyle = color;
  path(ctx, pts);
  ctx.closePath();
  ctx.fill();
}

const AREA_KINDS = {
  forest: 'forest',
  wood: 'forest',
  residential: 'urban',
  industrial: 'industrial',
  commercial: 'urban',
  retail: 'urban',
  openLand: 'openLand',
  farmland: 'grass',
  meadow: 'grass',
  grass: 'grass',
  park: 'park',
  garden: 'park',
  recreation_ground: 'park',
  pitch: 'park'
};

/** Mask per tile: 0 = field, 1 = forest, 2 = urban, 3 = industrial, 4 = open ground, 5 = park. */
function buildLandMask(world) {
  const mask = new Uint8Array(GRID_WIDTH * GRID_HEIGHT);
  const code = { grass: 0, forest: 1, urban: 2, industrial: 3, openLand: 4, park: 5 };
  const area = (a) => (a.bbox.x1 - a.bbox.x0) * (a.bbox.y1 - a.bbox.y0);
  const polys = world.areas
    .filter((a) => a.pts.length > 3 && AREA_KINDS[a.kind])
    .map((a) => ({ a, code: code[AREA_KINDS[a.kind]] }))
    // big ones first so the small ones end up on top
    .sort((p, q) => area(q.a) - area(p.a));
  for (const { a, code: c } of polys) {
    const x0 = Math.max(0, Math.floor(a.bbox.x0));
    const x1 = Math.min(GRID_WIDTH - 1, Math.ceil(a.bbox.x1));
    const y0 = Math.max(0, Math.floor(a.bbox.y0));
    const y1 = Math.min(GRID_HEIGHT - 1, Math.ceil(a.bbox.y1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) if (pointInPolygon(x, y, a.pts)) mask[y * GRID_WIDTH + x] = c;
    }
  }
  return mask;
}

/** Approximate distance (in tiles) from each tile to the nearest road/watercourse, to avoid placing houses on top of them. */
function buildClearance(world) {
  const clearance = new Float32Array(GRID_WIDTH * GRID_HEIGHT).fill(99);
  const stamp = (pts, half) => {
    const r = Math.ceil(half + 1.6);
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[i + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2));
      for (let s = 0; s <= steps; s++) {
        const cx = x1 + ((x2 - x1) * s) / steps;
        const cy = y1 + ((y2 - y1) * s) / steps;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const tx = Math.round(cx) + dx;
            const ty = Math.round(cy) + dy;
            if (tx < 0 || ty < 0 || tx >= GRID_WIDTH || ty >= GRID_HEIGHT) continue;
            const d = Math.hypot(tx - cx, ty - cy) - half;
            const idx = ty * GRID_WIDTH + tx;
            if (d < clearance[idx]) clearance[idx] = d;
          }
        }
      }
    }
  };
  for (const r of world.roads) stamp(r.pts, ROAD_STYLES[r.cls].width / 2);
  for (const w of world.water) stamp(w.pts, (w.kind === 'river' ? WATER_STYLES.river.width : WATER_STYLES.stream.width) / 2);
  return clearance;
}

function paintTerrain(ctx, mask) {
  const { grass, park, urban, industrial, openLand } = TERRAIN_COLORS;
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      const h = tileHash(x, y);
      const m = mask[y * GRID_WIDTH + x];
      let color;
      if (m === 2) color = urban;
      else if (m === 3) color = industrial;
      else if (m === 4) color = openLand;
      else if (m === 5) color = park[h % park.length];
      else color = grass[h % grass.length];
      ctx.fillStyle = color;
      ctx.fillRect(x * T, y * T, T + 1, T + 1);
    }
  }
}

function paintTrees(ctx, mask, clearance) {
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      const m = mask[y * GRID_WIDTH + x];
      if (m === 2 || m === 3 || m === 4) continue;
      if (clearance[y * GRID_WIDTH + x] < 0.9) continue;
      const h = tileHash(x, y, 7);
      const density = m === 1 ? 70 : m === 5 ? 28 : 55;
      if (h % 100 > density) continue;
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

/** Procedural houses: OSM has no buildings here. Only on urban ground and away from roads. */
function paintBuildings(ctx, mask, clearance) {
  for (let y = 0; y < GRID_HEIGHT; y++) {
    for (let x = 0; x < GRID_WIDTH; x++) {
      const m = mask[y * GRID_WIDTH + x];
      if (m !== 2 && m !== 3) continue;
      if (clearance[y * GRID_WIDTH + x] < 0.8) continue;
      const h = tileHash(x, y, 3);
      if (h % 100 > (m === 3 ? 40 : 66)) continue;
      const roof = BUILDING_ROOFS[h % BUILDING_ROOFS.length];
      const bx = x * T + T * 0.14;
      const by = y * T + T * 0.14;
      const s = T * 0.72;
      ctx.fillStyle = 'rgba(30, 30, 40, 0.22)';
      ctx.fillRect(bx + T * 0.08, by + T * 0.1, s, s);
      ctx.fillStyle = roof;
      ctx.fillRect(bx, by, s, s);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.fillRect(bx, by, s, T * 0.1);
    }
  }
}

function paintWater(ctx, world) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const b of world.waterBodies) {
    if (b.pts.length < 4) continue;
    fillPoly(ctx, b.pts, WATER_STYLES.body.fill);
    ctx.lineWidth = T * 0.2;
    ctx.strokeStyle = WATER_STYLES.body.edge;
    path(ctx, b.pts);
    ctx.stroke();
  }
  const streams = world.water.filter((w) => w.kind !== 'river');
  const rivers = world.water.filter((w) => w.kind === 'river');
  for (const w of streams) {
    stroke(ctx, w.pts, WATER_STYLES.stream.width + 0.2, WATER_STYLES.stream.edge);
    stroke(ctx, w.pts, WATER_STYLES.stream.width, WATER_STYLES.stream.fill);
  }
  for (const w of rivers) stroke(ctx, w.pts, WATER_STYLES.river.width + 0.4, WATER_STYLES.river.edge);
  for (const w of rivers) stroke(ctx, w.pts, WATER_STYLES.river.width, WATER_STYLES.river.fill);
  for (const w of rivers) stroke(ctx, w.pts, 0.3, WATER_STYLES.river.core);
}

function paintRoads(ctx, world) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // By class from lowest to highest; within each class, outlines first and then fills,
  // so intersections come out clean and big roads pass over small ones.
  for (const cls of ROAD_CLASS_ORDER) {
    const s = ROAD_STYLES[cls];
    const group = world.roads.filter((r) => r.cls === cls);
    if (s.casing) for (const r of group) stroke(ctx, r.pts, s.width + 0.24, s.casing);
    for (const r of group) stroke(ctx, r.pts, s.width, s.fill, s.dash);
  }
}

export function createBaseMap(world) {
  const canvas = document.createElement('canvas');
  canvas.width = WORLD_WIDTH * BASE_SCALE;
  canvas.height = WORLD_HEIGHT * BASE_SCALE;
  const ctx = canvas.getContext('2d');

  const mask = buildLandMask(world);
  const clearance = buildClearance(world);
  paintTerrain(ctx, mask);
  paintTrees(ctx, mask, clearance);
  paintBuildings(ctx, mask, clearance);
  paintWater(ctx, world); // water goes underneath: roads cross it like bridges
  paintRoads(ctx, world);
  return canvas;
}
