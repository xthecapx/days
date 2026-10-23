import { TILE_SIZE } from '../worldSize.js';
import { samplePolyline } from '../geometry.js';
import { VEHICLE_ROUTES, PEDESTRIAN_ROUTES } from '../data/actors.js';
import { RIVER } from '../data/roads.js';

const toWorld = (tile) => (tile + 0.5) * TILE_SIZE;

export function drawRiverShimmer(ctx, phase) {
  const step = Math.floor(phase * 3.5) % 6;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  const pts = RIVER.pts;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const t = (phase * 0.45 + i * 0.23) % 1;
    const wx = Math.round(toWorld(x1 + (x2 - x1) * t));
    const wy = Math.round(toWorld(y1 + (y2 - y1) * t));
    ctx.fillRect(wx, wy, 4, 2);
    if ((i + step) % 2 === 0) ctx.fillRect(wx + 2, wy + 2, 3, 1);
  }
}

export function drawActors(ctx, phase) {
  ctx.save();
  for (const route of VEHICLE_ROUTES) {
    const pos = samplePolyline(route.path, phase * route.speed + route.offset);
    const vx = Math.round(toWorld(pos.x));
    const vy = Math.round(toWorld(pos.y));
    const horizontal = Math.abs(pos.dx) >= Math.abs(pos.dy);
    const bus = route.type === 'bus';
    const w = bus ? (horizontal ? 9 : 5) : (horizontal ? 6 : 4);
    const h = bus ? (horizontal ? 5 : 9) : (horizontal ? 4 : 6);
    ctx.fillStyle = 'rgba(15,23,42,0.85)';
    ctx.fillRect(vx - Math.floor(w / 2) - 1, vy - Math.floor(h / 2) - 1, w + 2, h + 2);
    ctx.fillStyle = route.color;
    ctx.fillRect(vx - Math.floor(w / 2), vy - Math.floor(h / 2), w, h);
    ctx.fillStyle = '#e0f2fe';
    ctx.fillRect(vx - 1, vy - 1, 2, 2);
  }

  const walk = Math.floor(phase * 6) % 2;
  for (const ped of PEDESTRIAN_ROUTES) {
    const pos = samplePolyline(ped.path, phase * ped.speed + ped.offset);
    const px = Math.round(toWorld(pos.x));
    const py = Math.round(toWorld(pos.y));
    ctx.fillStyle = 'rgba(15, 23, 42, 0.35)';
    ctx.fillRect(px - 2, py + 2, 4, 2);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(px - 1, py - 5, 3, 1);
    ctx.fillStyle = '#fde68a';
    ctx.fillRect(px - 1, py - 4, 3, 2);
    ctx.fillStyle = ped.shirt;
    ctx.fillRect(px - 2, py - 2, 5, 2);
    ctx.fillStyle = ped.pants;
    if (walk === 0) {
      ctx.fillRect(px - 2, py, 2, 2);
      ctx.fillRect(px + 1, py, 1, 1);
    } else {
      ctx.fillRect(px - 1, py, 1, 1);
      ctx.fillRect(px + 1, py, 2, 2);
    }
  }
  ctx.restore();
}
