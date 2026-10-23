import { TILE_SIZE } from '../worldSize.js';
import { samplePolyline } from '../geometry.js';
import { ROADS, RIVER } from '../data/roads.js';
import { PLACES, ROAD_LABELS } from '../data/places.js';

const FONT = '"Space Grotesk", system-ui, sans-serif';

function lodVisible(lod, zoom) {
  if (lod <= 1) return true;
  if (lod === 2) return zoom >= 1.4;
  return zoom >= 2.2;
}

function geometryFor(label) {
  if (label.source === 'river') return RIVER.pts;
  return ROADS.find((r) => r.name === label.road)?.pts;
}

/** Texto con halo claro: legible sobre cualquier fondo, sin cajas. */
function haloText(ctx, text, x, y, color, size, weight = 700) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, size * 0.32);
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** El tamaño en pantalla se mantiene casi constante: se compensa el zoom de la cámara. */
function screenSize(px, zoom) {
  return px / Math.max(0.8, Math.min(zoom, 3));
}

export function drawRoadLabels(ctx, zoom) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const size = screenSize(11, zoom) * 1.05;
  for (const label of ROAD_LABELS) {
    if (!lodVisible(label.lod, zoom)) continue;
    const pts = geometryFor(label);
    if (!pts) continue;
    const p = samplePolyline(pts, label.t);
    let angle = Math.atan2(p.dy, p.dx);
    if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI; // nunca de cabeza
    ctx.save();
    ctx.translate((p.x + 0.5) * TILE_SIZE, (p.y + 0.5) * TILE_SIZE);
    ctx.rotate(angle);
    haloText(ctx, label.text ?? label.road, 0, 0, label.color, size, 700);
    ctx.restore();
  }
  ctx.restore();
}

function drawPoiPin(ctx, place, zoom) {
  const s = screenSize(1, zoom);
  const cx = (place.x + 0.5) * TILE_SIZE;
  const cy = (place.y + 0.5) * TILE_SIZE;
  const r = 7.5 * s;
  ctx.fillStyle = 'rgba(15,23,42,0.35)';
  ctx.beginPath();
  ctx.arc(cx + 0.8 * s, cy + 1.2 * s, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = place.color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1.4 * s;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.font = `${9 * s}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(place.icon, cx, cy + 0.5 * s);
  ctx.textBaseline = 'top';
  haloText(ctx, place.label, cx, cy + r + 1.5 * s, '#1f2937', 9 * s, 700);
}

export function drawPlaces(ctx, zoom, pulsePhase) {
  ctx.save();
  for (const place of PLACES) {
    if (!lodVisible(place.lod, zoom)) continue;
    if (place.kind === 'poi') {
      drawPoiPin(ctx, place, zoom);
    } else if (place.kind === 'area') {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      haloText(ctx, place.label, (place.x + 0.5) * TILE_SIZE, (place.y + 0.5) * TILE_SIZE, place.color, screenSize(10, zoom), 600);
    } else if (place.kind === 'home') {
      drawHome(ctx, place, zoom, pulsePhase);
    }
  }
  ctx.restore();
}

function drawHome(ctx, place, zoom, pulsePhase) {
  const s = screenSize(1, zoom);
  const cx = (place.x + 0.5) * TILE_SIZE;
  const cy = (place.y + 0.5) * TILE_SIZE;
  const halo = (11 + Math.sin(pulsePhase * 3) * 1.8) * s;
  ctx.fillStyle = 'rgba(37, 99, 235, 0.22)';
  ctx.beginPath();
  ctx.arc(cx, cy, halo, 0, Math.PI * 2);
  ctx.fill();

  const r = 8 * s;
  ctx.fillStyle = '#1d4ed8';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1.8 * s;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.font = `${10 * s}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('🏠', cx, cy + 0.5 * s);
  ctx.textBaseline = 'bottom';
  haloText(ctx, place.label, cx, cy - r - 2 * s, '#1d4ed8', 9 * s, 800);
}
