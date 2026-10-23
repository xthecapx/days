import { TILE_SIZE } from '../worldSize.js';
import { samplePolyline } from '../geometry.js';

const toWorld = (tile) => (tile + 0.5) * TILE_SIZE;
const CAR_COLORS = ['#ef4444', '#3b82f6', '#f59e0b', '#ffffff', '#10b981', '#6366f1', '#ec4899', '#f97316', '#a855f7', '#14b8a6'];
const SHIRTS = ['#10b981', '#f97316', '#ec4899', '#38bdf8', '#a855f7', '#eab308', '#14b8a6', '#f43f5e'];
const PANTS = ['#1e3a8a', '#0f172a', '#1e293b'];

const longest = (roads, n) => [...roads].sort((a, b) => b.len - a.len).slice(0, n);
const reversed = (pts) => [...pts].reverse();

/**
 * Autos, buses y peatones decorativos, generados a partir de las vías reales:
 * los tramos más largos de cada clase y las calles/senderos del Río del Hato.
 * Velocidades en tiles por segundo (se convierten a fracción del tramo).
 */
function buildActors(world) {
  const roads = world.roads;
  const vehicles = [];
  const walkers = [];
  let k = 0;

  const addVehicle = (way, tps, type) => {
    const pts = way.oneway || k % 2 === 0 ? way.pts : reversed(way.pts);
    vehicles.push({
      pts,
      speed: tps / Math.max(way.len, 1),
      offset: ((k * 0.37) % 1),
      color: type === 'bus' ? '#eab308' : CAR_COLORS[k % CAR_COLORS.length],
      type
    });
    k++;
  };

  const main = (cls, n) => longest(roads.filter((r) => r.cls === cls && r.len > 12 && !/Salida|Entrada|Retorno/.test(r.name || '')), n);
  for (const w of main('highway', 4)) { addVehicle(w, 3.2, 'car'); addVehicle(w, 2.8, 'bus'); }
  for (const w of main('collector', 3)) addVehicle(w, 2.4, 'car');
  for (const w of main('arterial', 4)) addVehicle(w, 2.0, 'car');

  const riverRoad = roads.filter((r) => /Vía Ciudadela Río del Hato/.test(r.name || ''));
  for (const w of longest(riverRoad, 3)) { addVehicle(w, 1.8, 'car'); addVehicle(w, 1.6, 'car'); }

  const addWalker = (way, tps) => {
    walkers.push({
      pts: k % 2 ? reversed(way.pts) : way.pts,
      speed: tps / Math.max(way.len, 1),
      offset: (k * 0.29) % 1,
      shirt: SHIRTS[k % SHIRTS.length],
      pants: PANTS[k % PANTS.length]
    });
    k++;
  };
  const trails = roads.filter((r) => /Sendero Río del Hato|Ciclo/.test(r.name || ''));
  for (const w of longest(trails, 6)) { addWalker(w, 0.4); addWalker(w, 0.34); }
  for (const w of longest(riverRoad, 2)) addWalker(w, 0.36);

  return { vehicles, walkers };
}

export function createActorLayer(world) {
  const { vehicles, walkers } = buildActors(world);
  const river = [...world.water].filter((w) => w.kind === 'river').sort((a, b) => b.len - a.len)[0];

  return {
    drawRiverShimmer(ctx, phase) {
      if (!river) return;
      const pts = river.pts;
      const step = Math.floor(phase * 3.5) % 6;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      for (let i = 0; i < pts.length - 1; i += 2) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[i + 1];
        const t = (phase * 0.45 + i * 0.23) % 1;
        const wx = Math.round(toWorld(x1 + (x2 - x1) * t));
        const wy = Math.round(toWorld(y1 + (y2 - y1) * t));
        ctx.fillRect(wx, wy, 4, 2);
        if ((i + step) % 2 === 0) ctx.fillRect(wx + 2, wy + 2, 3, 1);
      }
    },

    drawActors(ctx, phase) {
      ctx.save();
      for (const v of vehicles) {
        const pos = samplePolyline(v.pts, phase * v.speed + v.offset);
        const vx = Math.round(toWorld(pos.x));
        const vy = Math.round(toWorld(pos.y));
        const horizontal = Math.abs(pos.dx) >= Math.abs(pos.dy);
        const bus = v.type === 'bus';
        const w = bus ? (horizontal ? 9 : 5) : horizontal ? 6 : 4;
        const h = bus ? (horizontal ? 5 : 9) : horizontal ? 4 : 6;
        ctx.fillStyle = 'rgba(15,23,42,0.85)';
        ctx.fillRect(vx - Math.floor(w / 2) - 1, vy - Math.floor(h / 2) - 1, w + 2, h + 2);
        ctx.fillStyle = v.color;
        ctx.fillRect(vx - Math.floor(w / 2), vy - Math.floor(h / 2), w, h);
        ctx.fillStyle = '#e0f2fe';
        ctx.fillRect(vx - 1, vy - 1, 2, 2);
      }

      const walk = Math.floor(phase * 6) % 2;
      for (const p of walkers) {
        const pos = samplePolyline(p.pts, phase * p.speed + p.offset);
        const px = Math.round(toWorld(pos.x));
        const py = Math.round(toWorld(pos.y));
        ctx.fillStyle = 'rgba(15, 23, 42, 0.35)';
        ctx.fillRect(px - 2, py + 2, 4, 2);
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(px - 1, py - 5, 3, 1);
        ctx.fillStyle = '#fde68a';
        ctx.fillRect(px - 1, py - 4, 3, 2);
        ctx.fillStyle = p.shirt;
        ctx.fillRect(px - 2, py - 2, 5, 2);
        ctx.fillStyle = p.pants;
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
  };
}
