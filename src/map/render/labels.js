import { TILE_SIZE } from '../worldSize.js';
import { samplePolyline } from '../geometry.js';
import { LABEL_STYLES, ROAD_STYLES } from '../data/roadStyles.js';
import { distanceToPolyline } from '../gpsGrid.js';

const FONT = '"Space Grotesk", system-ui, sans-serif';
const SKIP_NAME = /^(Salida|Entrada|Retorno|Plazoleta|Calzada)/i;

function lodVisible(lod, zoom) {
  if (lod <= 1) return true;
  if (lod === 2) return zoom >= 1.4;
  return zoom >= 2.2;
}

/** Text with a light halo: legible on any background, no boxes. */
function haloText(ctx, text, x, y, color, size, weight = 700) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, size * 0.32);
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** The on-screen size stays almost constant: the camera zoom is compensated. */
const screenSize = (px, zoom) => px / Math.max(0.8, Math.min(zoom, 3));

const CANDIDATE_T = [0.5, 0.35, 0.65, 0.2, 0.8, 0.12, 0.88];

/** Does the point (in tiles) fall on a street of equal or higher hierarchy that is not its own? */
function onOtherRoad(world, label, x, y) {
  const ownOrder = ROAD_STYLES[label.kind]?.order ?? -1;
  for (const r of world.roads) {
    if (r.name === label.text || ROAD_STYLES[r.cls].order < ownOrder) continue;
    const pad = ROAD_STYLES[r.cls].width / 2 + 0.8;
    const b = r.bbox;
    if (x < b.x0 - pad || x > b.x1 + pad || y < b.y0 - pad || y > b.y1 + pad) continue;
    if (distanceToPolyline(x, y, r.pts) < pad) return true;
  }
  return false;
}

/**
 * Finds the first point along the street's own path where ALL of the text (not just its centre) is
 * clear of other streets. The text width depends on the zoom, so the result is
 * cached per zoom level. Returns null if there is no free spot.
 */
function placeLabel(world, label, halfTiles, zoomKey) {
  if (label.placed.has(zoomKey)) return label.placed.get(zoomKey);
  let spot = null;
  for (const p of label.candidates) {
    const len = Math.hypot(p.dx, p.dy) || 1;
    const ux = p.dx / len;
    const uy = p.dy / len;
    let free = true;
    for (const k of [-1, -0.5, 0, 0.5, 1]) {
      if (onOtherRoad(world, label, p.x + ux * halfTiles * k, p.y + uy * halfTiles * k)) {
        free = false;
        break;
      }
    }
    if (free) {
      spot = p;
      break;
    }
  }
  label.placed.set(zoomKey, spot);
  return spot;
}

/** One label per named street (two if very long), taken from the longest segments. */
function buildRoadLabels(world) {
  const byName = new Map();
  const add = (kind, f) => {
    if (!f.name || SKIP_NAME.test(f.name)) return;
    const key = `${kind}|${f.name}`;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(f);
  };
  for (const r of world.roads) add(r.cls, r);
  for (const w of world.water) add(w.kind, w);

  const labels = [];
  for (const [key, ways] of byName) {
    const kind = key.split('|')[0];
    const style = LABEL_STYLES[kind];
    if (!style) continue;
    const sorted = [...ways].sort((a, b) => b.len - a.len);
    const total = sorted.reduce((s, w) => s + w.len, 0);
    const picks = total > 90 && sorted.length > 1 ? sorted.slice(0, 2) : sorted.slice(0, 1);
    for (const w of picks) {
      if (w.len < 5) continue;
      labels.push({ text: w.name, pts: w.pts, len: w.len, kind, ...style });
    }
  }
  for (const l of labels) {
    l.candidates = CANDIDATE_T.map((t) => samplePolyline(l.pts, t));
    l.placed = new Map();
  }
  return labels.sort((a, b) => a.rank - b.rank || b.len - a.len);
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

function drawHome(ctx, home, zoom, phase) {
  const s = screenSize(1, zoom);
  const cx = (home.x + 0.5) * TILE_SIZE;
  const cy = (home.y + 0.5) * TILE_SIZE;
  const halo = (11 + Math.sin(phase * 3) * 1.8) * s;
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
  haloText(ctx, home.label, cx, cy - r - 2 * s, '#1d4ed8', 9 * s, 800);
}

/** Layer of labels, places and house. Built once per map. */
export function createLabelLayer(world) {
  const roadLabels = buildRoadLabels(world);

  return {
    drawRoadLabels(ctx, zoom) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const size = screenSize(11, zoom) * 1.05;
      const placed = [];
      for (const label of roadLabels) {
        if (!lodVisible(label.lod, zoom)) continue;
        const width = label.text.length * size * 0.58;
        if (label.len * TILE_SIZE < width * 1.1) continue; // the street is not long enough for the text
        const zoomKey = Math.round(zoom * 4);
        const halfTiles = width / TILE_SIZE / 2;
        const p = placeLabel(world, label, halfTiles, zoomKey);
        if (!p) continue; // without a free stretch, better not to write over another street
        const wx = (p.x + 0.5) * TILE_SIZE;
        const wy = (p.y + 0.5) * TILE_SIZE;
        if (placed.some((q) => Math.hypot(q.x - wx, q.y - wy) < (q.w + width) * 0.45)) continue;
        placed.push({ x: wx, y: wy, w: width });
        let angle = Math.atan2(p.dy, p.dx);
        if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI; // nunca de cabeza
        ctx.save();
        ctx.translate(wx, wy);
        ctx.rotate(angle);
        haloText(ctx, label.text, 0, 0, label.color, size, 700);
        ctx.restore();
      }
      ctx.restore();
    },

    drawPlaces(ctx, zoom, phase) {
      ctx.save();
      for (const place of world.places) {
        if (!lodVisible(place.lod || 1, zoom)) continue;
        if (place.kind === 'poi') {
          drawPoiPin(ctx, place, zoom);
        } else {
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          haloText(ctx, place.label, (place.x + 0.5) * TILE_SIZE, (place.y + 0.5) * TILE_SIZE, place.color || '#475569', screenSize(10, zoom), 600);
        }
      }
      drawHome(ctx, world.home, zoom, phase);
      ctx.restore();
    }
  };
}
